/**
 * Data-driven acceptance harness for the canonical payment vectors.
 *
 * Loads docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json
 * (THE acceptance contract) and executes every vector PAY-VEC-001..026 against
 * the engine. Every expected_* field is asserted; an expected key the harness
 * does not understand fails the test (no silent skipping).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyKhqrCallback,
  applyKhqrClientConfirm,
  applyRefund,
  BookingPaymentLedger,
  closeCashSession,
  createKhqrAttempt,
  PaymentError,
  requestVoidOfFinalizedPayment,
  SettlementReconciler,
  stableStringify,
  voidAttempt,
  type CashCloseResult,
  type CashTenderResult,
  type CommandEnvelope,
  type MissingSettlementFinding,
  type SettlementMatchResult,
  type VoidFinalizedDecision,
} from "../src/index.js";
import type { CurrencyCode } from "@kitluy/money";

interface VectorTender {
  type: string;
  [key: string]: unknown;
}

interface Vector {
  id: string;
  name: string;
  currency: CurrencyCode;
  booking_total_minor: number;
  input_tenders: VectorTender[];
  expected: Record<string, unknown>;
  notes: string[];
}

interface VectorDocument {
  schema_version: string;
  vectors: Vector[];
}

const doc: VectorDocument = JSON.parse(
  readFileSync(
    new URL(
      "../../../docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

const num = (t: VectorTender, key: string): number => {
  const v = t[key];
  if (typeof v !== "number") throw new Error(`Tender field ${key} missing/not a number`);
  return v;
};
const str = (t: VectorTender, key: string): string => {
  const v = t[key];
  if (typeof v !== "string") throw new Error(`Tender field ${key} missing/not a string`);
  return v;
};
const opt = <T>(t: VectorTender, key: string): T | undefined =>
  key in t ? (t[key] as T) : undefined;

interface OpResult {
  ok: boolean;
  error?: PaymentError;
}

interface VectorContext {
  ledger: BookingPaymentLedger;
  reconciler: SettlementReconciler;
  opResults: OpResult[];
  cashEnvelopes: CommandEnvelope<CashTenderResult>[];
  settlementResults: SettlementMatchResult[];
  originalPayments: { seq: number; amountMinor: bigint }[];
  voidFinalized?: VoidFinalizedDecision;
  lastAttemptId?: string;
  lastError?: PaymentError;
  preRefundEffectCount?: number;
  expectedCashMinor?: number;
  countedCashMinor?: number;
  cashClose?: CashCloseResult;
  usedSettlement: boolean;
  missingFindings: MissingSettlementFinding[];
}

function runVector(vector: Vector): VectorContext {
  const ledger = new BookingPaymentLedger({
    currency: vector.currency,
    bookingTotalMinor: vector.booking_total_minor,
  });
  const reconciler = new SettlementReconciler(vector.currency);
  const ctx: VectorContext = {
    ledger,
    reconciler,
    opResults: [],
    cashEnvelopes: [],
    settlementResults: [],
    originalPayments: [],
    usedSettlement: false,
    missingFindings: [],
  };

  const attempt = (fn: () => void): void => {
    try {
      fn();
      ctx.opResults.push({ ok: true });
    } catch (e) {
      if (!(e instanceof PaymentError)) throw e;
      ctx.lastError = e;
      ctx.opResults.push({ ok: false, error: e });
    }
  };

  for (const t of vector.input_tenders) {
    switch (t.type) {
      case "CASH":
      case "CASH_REPLAY":
        attempt(() => {
          const envelope = ledger.applyCashTender({
            ...("amount_minor" in t ? { amountMinor: num(t, "amount_minor") } : {}),
            ...("amount_tendered_minor" in t
              ? { tenderedMinor: num(t, "amount_tendered_minor") }
              : {}),
            ...("applied_minor" in t ? { appliedMinor: num(t, "applied_minor") } : {}),
            ...("currency" in t ? { currency: str(t, "currency") as CurrencyCode } : {}),
            ...("idempotency_key" in t ? { idempotencyKey: str(t, "idempotency_key") } : {}),
          });
          ctx.cashEnvelopes.push(envelope);
        });
        break;

      case "KHQR": {
        const attemptId =
          opt<string>(t, "attempt_id") ??
          `attempt-${opt<string>(t, "provider_transaction_id") ?? "khqr"}`;
        ctx.lastAttemptId = attemptId;
        attempt(() => {
          createKhqrAttempt(ledger, {
            attemptId,
            ...("amount_minor" in t ? { amountMinor: num(t, "amount_minor") } : {}),
            ...("client_result" in t ? { clientResult: str(t, "client_result") } : {}),
            ...("idempotency_key" in t ? { idempotencyKey: str(t, "idempotency_key") } : {}),
          });
          // A tender declared SUCCEEDED with a provider transaction id is the
          // compressed vector form of attempt + verified provider callback
          // (KBR-PAY-003: only verified provider evidence completes it).
          if (opt<string>(t, "status") === "SUCCEEDED") {
            applyKhqrCallback(ledger, {
              providerTransactionId: str(t, "provider_transaction_id"),
              status: "SUCCEEDED",
              amountMinor: num(t, "amount_minor"),
              signatureVerified: true,
              attemptId,
            });
          }
        });
        break;
      }

      case "KHQR_CALLBACK":
        attempt(() => {
          applyKhqrCallback(ledger, {
            providerTransactionId: str(t, "provider_transaction_id"),
            ...("delivery_id" in t ? { deliveryId: str(t, "delivery_id") } : {}),
            status: str(t, "status") as "SUCCEEDED" | "FAILED" | "EXPIRED",
            amountMinor: num(t, "amount_minor"),
            signatureVerified: true, // vectors assume verified signature
          });
        });
        break;

      case "KHQR_CLIENT_CONFIRM":
        attempt(() => {
          applyKhqrClientConfirm(ledger, {
            providerTransactionId: str(t, "provider_transaction_id"),
            amountMinor: num(t, "amount_minor"),
          });
        });
        break;

      case "ORIGINAL_PAYMENT":
        attempt(() => {
          const { result } = ledger.applyFinalizedPayment({
            amountMinor: num(t, "amount_minor"),
          });
          ctx.originalPayments.push({
            seq: result.recordSeq,
            amountMinor: BigInt(num(t, "amount_minor")),
          });
        });
        break;

      case "REFUND":
        ctx.preRefundEffectCount = ledger.financialEffectCount;
        attempt(() => {
          applyRefund(ledger, {
            amountMinor: num(t, "amount_minor"),
            approvalId: str(t, "approval_id"),
            ...("reason_code" in t ? { reasonCode: str(t, "reason_code") } : {}),
          });
        });
        break;

      case "VOID_ATTEMPT":
        attempt(() => {
          voidAttempt(ledger, {
            attemptId: str(t, "attempt_id"),
            ...("reason_code" in t ? { reasonCode: str(t, "reason_code") } : {}),
          });
          ctx.lastAttemptId = str(t, "attempt_id");
        });
        break;

      case "VOID_FINALIZED_REQUEST":
        attempt(() => {
          ctx.voidFinalized = requestVoidOfFinalizedPayment(ledger, {
            ...("approval_id" in t ? { approvalId: str(t, "approval_id") } : {}),
          });
        });
        break;

      case "PAYMENT":
        ctx.usedSettlement = true;
        attempt(() => {
          reconciler.registerLedgerPayment({
            providerTransactionId: str(t, "provider_transaction_id"),
            amountMinor: num(t, "amount_minor"),
            ...("age_hours" in t ? { ageHours: num(t, "age_hours") } : {}),
          });
        });
        break;

      case "SETTLEMENT":
        ctx.usedSettlement = true;
        attempt(() => {
          ctx.settlementResults.push(
            reconciler.applySettlementLine({
              providerTransactionId: str(t, "provider_transaction_id"),
              grossMinor: num(t, "gross_minor"),
              feeMinor: num(t, "fee_minor"),
              netMinor: num(t, "net_minor"),
            }),
          );
        });
        break;

      case "EXPECTED_CASH":
        ctx.expectedCashMinor = num(t, "amount_minor");
        ctx.opResults.push({ ok: true });
        break;

      case "COUNTED_CASH":
        ctx.countedCashMinor = num(t, "amount_minor");
        ctx.opResults.push({ ok: true });
        break;

      default:
        throw new Error(`Vector ${vector.id}: unhandled tender type "${t.type}"`);
    }
  }

  if (ctx.expectedCashMinor !== undefined && ctx.countedCashMinor !== undefined) {
    ctx.cashClose = closeCashSession({
      currency: vector.currency,
      expectedMinor: ctx.expectedCashMinor,
      countedMinor: ctx.countedCashMinor,
    });
  }
  if (ctx.usedSettlement) {
    ctx.missingFindings = reconciler.reviewMissingSettlements();
  }
  return ctx;
}

function assertExpectedField(vector: Vector, ctx: VectorContext, key: string, raw: unknown): void {
  const { ledger, reconciler } = ctx;
  const lastOp = ctx.opResults[ctx.opResults.length - 1];
  const lastCash = ctx.cashEnvelopes[ctx.cashEnvelopes.length - 1];
  const lastSettlement = ctx.settlementResults[ctx.settlementResults.length - 1];
  const asBigint = (): bigint => BigInt(raw as number);

  switch (key) {
    case "paid_minor":
      expect(ledger.paidMinor).toBe(asBigint());
      break;
    case "balance_minor":
      expect(ledger.balanceMinor).toBe(asBigint());
      break;
    case "deposit_minor":
      expect(ledger.depositMinor).toBe(asBigint());
      break;
    case "payment_state":
      expect(ledger.paymentState).toBe(raw);
      break;
    case "ledger_balanced":
      expect(ledger.isBalanced()).toBe(raw);
      if (ctx.usedSettlement) expect(reconciler.isBalanced()).toBe(raw);
      break;
    case "stored_total_minor":
      expect(ledger.storedTotalMinor).toBe(asBigint());
      break;
    case "display_rounding_not_applied_to_truth":
      // Stored truth is exactly the integer supplied — the engine has no
      // rounding code path, so nearest-100 display rounding can never leak in.
      expect(
        ledger.storedTotalMinor === BigInt(vector.booking_total_minor) &&
          ledger.paidMinor === BigInt(vector.booking_total_minor),
      ).toBe(raw);
      break;
    case "change_due_minor":
      expect(lastCash?.result.changeDueMinor).toBe(asBigint());
      break;
    case "cash_drawer_net_minor":
      expect(ledger.cashDrawerNetMinor).toBe(asBigint());
      break;
    case "reconciled":
      expect(ledger.reconciled).toBe(raw);
      break;
    case "business_effect_count":
      expect(ledger.businessEffectCount).toBe(raw);
      break;
    case "duplicate_delivery_count":
      expect(ledger.duplicateDeliveryCount).toBe(raw);
      break;
    case "requires_status_refresh":
      expect(ledger.requiresStatusRefresh).toBe(raw);
      break;
    case "tender_count":
      expect(ledger.tenderCount).toBe(raw);
      break;
    case "variance_minor":
      if (ctx.cashClose) {
        expect(ctx.cashClose.varianceMinor).toBe(asBigint());
      } else if (lastSettlement) {
        expect(lastSettlement.varianceMinor).toBe(asBigint());
      } else {
        expect(ledger.lastReconciliationVarianceMinor).toBe(asBigint());
      }
      break;
    case "replay_response_consistent": {
      const [first, second] = ctx.cashEnvelopes;
      expect(second?.replayed).toBe(true);
      expect(stableStringify(second?.result) === stableStringify(first?.result)).toBe(raw);
      break;
    }
    case "first_effect_applied":
      expect(ctx.opResults[0]?.ok === true && ledger.businessEffectCount === 1).toBe(raw);
      break;
    case "second_accepted":
      expect(ctx.opResults[1]?.ok).toBe(raw);
      break;
    case "accepted":
      expect(lastOp?.ok).toBe(raw);
      break;
    case "error_code":
      expect(ctx.lastError?.code).toBe(raw);
      break;
    case "no_ledger_effect":
      expect(ledger.financialEffectCount === 0 && ledger.getRecords().length === 0).toBe(raw);
      break;
    case "refund_accepted":
      expect(lastOp?.ok).toBe(raw);
      break;
    case "no_new_financial_effect":
      expect(ledger.financialEffectCount === ctx.preRefundEffectCount).toBe(raw);
      break;
    case "original_retained":
      for (const original of ctx.originalPayments) {
        const record = ledger.getRecord(original.seq);
        expect(record?.kind).toBe("PAYMENT");
        expect(record?.amount?.minorUnits).toBe(original.amountMinor);
        expect(Object.isFrozen(record)).toBe(true);
      }
      expect(ctx.originalPayments.length > 0).toBe(raw);
      break;
    case "append_only": {
      const records = ledger.getRecords();
      const frozen = records.every((r) => Object.isFrozen(r) && Object.isFrozen(r.meta));
      const ordered = records.every((r, i) => i === 0 || r.seq > (records[i - 1]?.seq ?? 0));
      expect(frozen && ordered).toBe(raw);
      break;
    }
    case "refund_minor":
      expect(ledger.refundedMinor).toBe(asBigint());
      break;
    case "net_paid_minor":
      expect(ledger.netPaidMinor).toBe(asBigint());
      break;
    case "destructive_void_allowed":
      expect(ctx.voidFinalized?.allowed).toBe(raw);
      break;
    case "required_action":
      expect(ctx.voidFinalized?.requiredAction).toBe(raw);
      break;
    case "attempt_state":
      expect(ledger.attempts.get(ctx.lastAttemptId ?? "")?.state).toBe(raw);
      break;
    case "ledger_payment_effect_count":
      expect(ledger.businessEffectCount).toBe(raw);
      break;
    case "reconciliation_state":
      if (lastSettlement) {
        expect(lastSettlement.reconciliationState).toBe(raw);
      } else {
        expect(ctx.missingFindings[0]?.reconciliationState).toBe(raw);
      }
      break;
    case "auto_close_allowed":
      if (ctx.cashClose) {
        expect(ctx.cashClose.autoCloseAllowed).toBe(raw);
      } else if (lastSettlement) {
        expect(lastSettlement.autoCloseAllowed).toBe(raw);
      } else {
        expect(ctx.missingFindings[0]?.autoCloseAllowed).toBe(raw);
      }
      break;
    case "alert_required":
      expect(ctx.missingFindings[0]?.alertRequired).toBe(raw);
      break;
    case "gross_minor":
      expect(lastSettlement?.grossMinor).toBe(asBigint());
      break;
    case "fee_minor":
      expect(lastSettlement?.feeMinor).toBe(asBigint());
      break;
    case "net_minor":
      expect(lastSettlement?.netMinor).toBe(asBigint());
      break;
    case "close_state":
      expect(ctx.cashClose?.closeState).toBe(raw);
      break;
    default:
      throw new Error(
        `Vector ${vector.id}: expected field "${key}" is not asserted by the harness`,
      );
  }
}

describe("kitluy-payment-and-reconciliation-test-vectors-v1.0.0", () => {
  it("contains exactly the 26 canonical vectors PAY-VEC-001..026", () => {
    const ids = doc.vectors.map((v) => v.id);
    expect(ids).toHaveLength(26);
    for (let i = 1; i <= 26; i++) {
      expect(ids).toContain(`PAY-VEC-${String(i).padStart(3, "0")}`);
    }
  });

  for (const vector of doc.vectors) {
    describe(vector.id, () => {
      it(vector.name, () => {
        const ctx = runVector(vector);
        const entries = Object.entries(vector.expected);
        expect(entries.length).toBeGreaterThan(0);
        for (const [key, raw] of entries) {
          assertExpectedField(vector, ctx, key, raw);
        }
      });
    });
  }
});
