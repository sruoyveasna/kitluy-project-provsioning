/**
 * @kitluy/payments — refunds and voids as compensating records.
 *
 * KBR-PAY-005 (kitluy-payment-refund-and-void-rules-v1.0.0.md): "Return money
 * through a linked compensating payment, never by changing the original
 * receipt." KBR-PAY-006: a settled/finalized payment is never destructively
 * voided — it converts to the refund workflow.
 *
 * Vector coverage: PAY-VEC-016 (full refund, original retained, append-only),
 * 017 (partial refund), 018 (refund exceeding refundable balance rejected with
 * no new financial effect), 020 (destructive void of finalized payment
 * refused; required action is a compensating refund/adjustment).
 */

import type { CurrencyCode } from "@kitluy/money";
import { PaymentError } from "./errors.js";
import type {
  BookingPaymentLedger,
  CommandEnvelope,
  RefundResult,
  VoidFinalizedDecision,
} from "./ledger.js";

export interface RefundCommand {
  amountMinor: bigint | number;
  currency?: CurrencyCode;
  /**
   * KBR-PAY-005: refund authorization is separated and recorded. The vectors
   * always carry an approval id; the strictest reading makes it mandatory.
   * (Threshold policy itself is PAY-OD-002 — an open owner decision.)
   */
  approvalId: string;
  reasonCode?: string;
  idempotencyKey?: string;
}

/**
 * Post a refund as a NEW compensating record linked to the payment stream.
 * The original payment records are untouched (they are frozen; there is no
 * mutation API). Refundable amount = net paid so far.
 */
export function applyRefund(
  ledger: BookingPaymentLedger,
  cmd: RefundCommand,
): CommandEnvelope<RefundResult> {
  const amount = ledger.toMoney(cmd.amountMinor, cmd.currency);
  if (amount.minorUnits <= 0n) {
    throw new PaymentError("AMOUNT_NOT_POSITIVE", "Refund amount must be positive.");
  }
  if (!cmd.approvalId) {
    throw new PaymentError(
      "REFUND_APPROVAL_REQUIRED",
      "Refunds require recorded approval evidence (KBR-PAY-005).",
    );
  }
  return ledger.runIdempotent(
    cmd.idempotencyKey,
    {
      type: "REFUND",
      currency: amount.currency,
      amountMinor: amount.minorUnits,
      approvalId: cmd.approvalId,
    },
    () => {
      // Review RV-001 (WS-08-T001): the refundable-balance check lives INSIDE
      // the idempotent execution so that replaying an identical accepted
      // refund returns the original result instead of a false rejection.
      const refundable = ledger.netPaidMinor;
      if (amount.minorUnits > refundable) {
        // PAY-VEC-018: reject with NO new financial effect. A non-financial
        // audit event records the rejection, carrying no postings.
        ledger.append("REFUND_REJECTED", {
          meta: {
            requestedMinor: amount.minorUnits,
            refundableMinor: refundable,
            approvalId: cmd.approvalId,
          },
        });
        throw new PaymentError(
          "REFUND_EXCEEDS_AVAILABLE_AMOUNT",
          `Refund of ${amount.minorUnits} exceeds refundable ${refundable} (PAY-VEC-018).`,
        );
      }
      const record = ledger.append("REFUND", {
        amount,
        postings: [
          // Mirror image of the payment posting: money leaves the tender
          // asset, the customer's receivable position is restored.
          { account: "ACCOUNTS_RECEIVABLE", direction: "DEBIT", amount },
          { account: "TENDER_ASSET", direction: "CREDIT", amount },
        ],
        meta: {
          approvalId: cmd.approvalId,
          ...(cmd.reasonCode !== undefined ? { reasonCode: cmd.reasonCode } : {}),
          compensating: true,
        },
      });
      return {
        recordSeq: record.seq,
        refundMinor: amount.minorUnits,
        netPaidMinor: ledger.netPaidMinor,
      };
    },
  );
}

/**
 * PAY-VEC-020 / KBR-PAY-006: a request to void a finalized payment is ALWAYS
 * refused as a destructive operation — regardless of approval — and redirected
 * to the compensating refund/adjustment workflow. The refusal itself is
 * appended as an audit event; no existing record is modified.
 */
export function requestVoidOfFinalizedPayment(
  ledger: BookingPaymentLedger,
  cmd: { approvalId?: string; reasonCode?: string } = {},
): VoidFinalizedDecision {
  ledger.append("VOID_FINALIZED_REFUSED", {
    meta: {
      requiredAction: "COMPENSATING_REFUND_OR_ADJUSTMENT",
      ...(cmd.approvalId !== undefined ? { approvalId: cmd.approvalId } : {}),
      ...(cmd.reasonCode !== undefined ? { reasonCode: cmd.reasonCode } : {}),
    },
  });
  return { allowed: false, requiredAction: "COMPENSATING_REFUND_OR_ADJUSTMENT" };
}
