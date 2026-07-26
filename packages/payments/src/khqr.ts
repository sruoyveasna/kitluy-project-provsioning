/**
 * @kitluy/payments — KHQR attempt lifecycle and provider-event processing.
 *
 * KBR-PAY-003 (kitluy-payment-refund-and-void-rules-v1.0.0.md): verified
 * provider/acquirer evidence is THE authority for remote payment success.
 * "Browser return or customer screenshot is non-authoritative evidence only" —
 * a UI success screen never completes a payment. Provider events are
 * deduplicated by provider transaction id, amount/currency matched, and
 * mismatches quarantined as reconciliation exceptions.
 *
 * Vector coverage: PAY-VEC-007 (pending), 008 (verified success), 009
 * (duplicate delivery → one business effect), 010 (amount mismatch →
 * RECONCILIATION_EXCEPTION with variance), 011 (callback races client
 * confirm → exactly one effect), 012 (client timeout, provider truth wins,
 * status refresh required), 019 (void pending attempt).
 */

import type { CurrencyCode } from "@kitluy/money";
import { PaymentError } from "./errors.js";
import type {
  BookingPaymentLedger,
  CommandEnvelope,
  KhqrAttempt,
  ProviderCallbackResult,
} from "./ledger.js";

export interface CreateKhqrAttemptCommand {
  attemptId: string;
  /** Optional: a refresh-driven flow may not carry the amount (PAY-VEC-012). */
  amountMinor?: bigint | number;
  currency?: CurrencyCode;
  /** Non-authoritative client-side outcome, e.g. "TIMEOUT". */
  clientResult?: string;
  idempotencyKey?: string;
}

export interface KhqrCallbackCommand {
  providerTransactionId: string;
  /** Provider delivery id — distinct deliveries of the same transaction. */
  deliveryId?: string;
  status: "SUCCEEDED" | "FAILED" | "EXPIRED";
  amountMinor: bigint | number;
  currency?: CurrencyCode;
  /**
   * Transport/signature verification result supplied by the (out-of-scope)
   * provider adapter. This engine trusts the FLAG, not the payload: an
   * unverified event is quarantined with zero business effect (KBR-PAY-003).
   */
  signatureVerified: boolean;
  attemptId?: string;
}

/** KBR-PAY-001 — create a payment attempt without declaring money received. */
export function createKhqrAttempt(
  ledger: BookingPaymentLedger,
  cmd: CreateKhqrAttemptCommand,
): CommandEnvelope<{ attemptId: string; state: "PENDING" }> {
  const amount =
    cmd.amountMinor !== undefined ? ledger.toMoney(cmd.amountMinor, cmd.currency) : undefined;
  return ledger.runIdempotent(
    cmd.idempotencyKey,
    {
      type: "KHQR_ATTEMPT",
      attemptId: cmd.attemptId,
      amountMinor: amount?.minorUnits ?? null,
    },
    () => {
      const attempt: KhqrAttempt = {
        attemptId: cmd.attemptId,
        ...(amount !== undefined ? { amount } : {}),
        state: "PENDING",
      };
      if (cmd.clientResult !== undefined) {
        attempt.clientResult = cmd.clientResult;
        if (cmd.clientResult === "TIMEOUT") {
          // PAY-VEC-012: the client's timeout is not payment truth; the
          // authoritative outcome must come from a provider status refresh.
          ledger.markStatusRefreshRequired();
        }
      }
      ledger.attempts.set(cmd.attemptId, attempt);
      ledger.append("ATTEMPT_CREATED", {
        meta: {
          attemptId: cmd.attemptId,
          ...(amount !== undefined ? { amountMinor: amount.minorUnits } : {}),
          ...(cmd.clientResult !== undefined ? { clientResult: cmd.clientResult } : {}),
        },
      });
      return { attemptId: cmd.attemptId, state: "PENDING" as const };
    },
  );
}

/** Pick the attempt a callback resolves: explicit id, else oldest open PENDING. */
function resolveAttempt(
  ledger: BookingPaymentLedger,
  cmd: KhqrCallbackCommand,
): KhqrAttempt | undefined {
  if (cmd.attemptId !== undefined) return ledger.attempts.get(cmd.attemptId);
  for (const attempt of ledger.attempts.values()) {
    if (attempt.state === "PENDING" && attempt.providerTransactionId === undefined) {
      return attempt; // Map preserves insertion order → deterministic (oldest first)
    }
  }
  return undefined;
}

/**
 * KBR-PAY-003 — apply a provider callback. Exactly one business effect per
 * provider transaction id regardless of delivery count; duplicate deliveries
 * are recorded and counted but replay the original result (PAY-VEC-009).
 * Races between callback and client confirmation resolve deterministically:
 * the first VERIFIED provider event wins, everything else is a no-op
 * observation (PAY-VEC-011).
 */
export function applyKhqrCallback(
  ledger: BookingPaymentLedger,
  cmd: KhqrCallbackCommand,
): ProviderCallbackResult {
  if (!cmd.signatureVerified) {
    ledger.append("PROVIDER_EVENT_QUARANTINED", {
      meta: {
        providerTransactionId: cmd.providerTransactionId,
        reason: "SIGNATURE_NOT_VERIFIED",
      },
    });
    // Fail closed: unverified evidence produces no payment effect.
    return { accepted: false, state: "QUARANTINED" };
  }

  const prior = ledger.processedProviderTxns.get(cmd.providerTransactionId);
  if (prior) {
    ledger.noteDuplicateDelivery();
    ledger.append("PROVIDER_EVENT_DUPLICATE", {
      meta: {
        providerTransactionId: cmd.providerTransactionId,
        ...(cmd.deliveryId !== undefined ? { deliveryId: cmd.deliveryId } : {}),
      },
    });
    return prior; // original business result; no second effect
  }

  const amount = ledger.toMoney(cmd.amountMinor, cmd.currency);
  const attempt = resolveAttempt(ledger, cmd);

  if (cmd.status !== "SUCCEEDED") {
    if (attempt) {
      attempt.state = cmd.status === "EXPIRED" ? "EXPIRED" : "FAILED";
      attempt.providerTransactionId = cmd.providerTransactionId;
      ledger.append("ATTEMPT_STATE_CHANGED", {
        meta: { attemptId: attempt.attemptId, state: attempt.state },
      });
    }
    const result: ProviderCallbackResult = { accepted: false, state: "ATTEMPT_CLOSED" };
    ledger.processedProviderTxns.set(cmd.providerTransactionId, result);
    return result;
  }

  // Amount matching: against the attempt's requested amount when it carries
  // one, otherwise against the outstanding balance (strictest reading — a
  // provider success for any other amount is quarantined, never partially
  // applied). Variance = provider amount − expected (PAY-VEC-010: −1000).
  const expectedMinor =
    attempt?.amount !== undefined ? attempt.amount.minorUnits : ledger.balanceMinor;
  if (amount.minorUnits !== expectedMinor) {
    const varianceMinor = amount.minorUnits - expectedMinor;
    ledger.append("RECONCILIATION_EXCEPTION", {
      meta: {
        providerTransactionId: cmd.providerTransactionId,
        providerAmountMinor: amount.minorUnits,
        expectedMinor,
        varianceMinor,
      },
    });
    const result: ProviderCallbackResult = {
      accepted: false,
      state: "RECONCILIATION_EXCEPTION",
      varianceMinor,
    };
    // Still dedup: redelivering the mismatched event must not double-report.
    ledger.processedProviderTxns.set(cmd.providerTransactionId, result);
    return result;
  }

  const record = ledger.append("PAYMENT", {
    amount,
    postings: [
      { account: "PROVIDER_CLEARING", direction: "DEBIT", amount },
      { account: "ACCOUNTS_RECEIVABLE", direction: "CREDIT", amount },
    ],
    meta: {
      tender: "KHQR",
      providerTransactionId: cmd.providerTransactionId,
      finalized: true,
      ...(attempt !== undefined ? { attemptId: attempt.attemptId } : {}),
    },
  });
  if (attempt) {
    attempt.state = "SUCCEEDED";
    attempt.providerTransactionId = cmd.providerTransactionId;
    ledger.append("ATTEMPT_STATE_CHANGED", {
      meta: { attemptId: attempt.attemptId, state: "SUCCEEDED" },
    });
  }
  const result: ProviderCallbackResult = {
    accepted: true,
    state: "APPLIED",
    recordSeq: record.seq,
  };
  ledger.processedProviderTxns.set(cmd.providerTransactionId, result);
  return result;
}

/**
 * KBR-PAY-003 / lifecycle §4: "A user-interface success screen is not payment
 * authority." A client confirmation is recorded as an observation only — it
 * NEVER creates a payment effect. If the verified provider event already
 * arrived (PAY-VEC-011), this is a harmless second observation of the same
 * truth; if it has not, the payment stays pending until provider evidence.
 */
export function applyKhqrClientConfirm(
  ledger: BookingPaymentLedger,
  cmd: { providerTransactionId: string; amountMinor?: bigint | number },
): { providerEventAlreadyApplied: boolean } {
  const prior = ledger.processedProviderTxns.get(cmd.providerTransactionId);
  ledger.append("CLIENT_CONFIRM_OBSERVED", {
    meta: {
      providerTransactionId: cmd.providerTransactionId,
      authoritative: false,
      providerEventAlreadyApplied: prior !== undefined,
    },
  });
  return { providerEventAlreadyApplied: prior !== undefined };
}

/**
 * KBR-PAY-006 / PAY-VEC-019 — void an attempt that has produced no payment
 * effect. Only PENDING attempts are eligible; anything finalized must go
 * through the compensating path (see refunds.ts).
 */
export function voidAttempt(
  ledger: BookingPaymentLedger,
  cmd: { attemptId: string; reasonCode?: string },
): { attemptId: string; state: "VOIDED" } {
  const attempt = ledger.attempts.get(cmd.attemptId);
  if (!attempt) {
    throw new PaymentError("UNKNOWN_ATTEMPT", `No attempt "${cmd.attemptId}".`);
  }
  if (attempt.state !== "PENDING") {
    throw new PaymentError(
      "VOID_NOT_ALLOWED_FOR_STATE",
      `Attempt "${cmd.attemptId}" is ${attempt.state}; only PENDING attempts can be voided (KBR-PAY-006).`,
    );
  }
  attempt.state = "VOIDED";
  ledger.append("ATTEMPT_STATE_CHANGED", {
    meta: {
      attemptId: cmd.attemptId,
      state: "VOIDED",
      ...(cmd.reasonCode !== undefined ? { reasonCode: cmd.reasonCode } : {}),
    },
  });
  return { attemptId: cmd.attemptId, state: "VOIDED" };
}
