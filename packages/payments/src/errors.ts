/**
 * @kitluy/payments — error contract.
 *
 * Error codes that appear literally in the canonical acceptance contract
 * (docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json)
 * MUST keep their exact spelling:
 * - CURRENCY_MISMATCH_OR_CONVERSION_REQUIRED (PAY-VEC-004)
 * - IDEMPOTENCY_KEY_PAYLOAD_CONFLICT (PAY-VEC-015)
 * - REFUND_EXCEEDS_AVAILABLE_AMOUNT (PAY-VEC-018)
 */

export type PaymentErrorCode =
  /** PAY-VEC-004 — mixed-currency tender without an approved FX contract. */
  | "CURRENCY_MISMATCH_OR_CONVERSION_REQUIRED"
  /** PAY-VEC-015 — idempotency key reused with a different payload. */
  | "IDEMPOTENCY_KEY_PAYLOAD_CONFLICT"
  /** PAY-VEC-018 — refund exceeds remaining refundable amount (KBR-PAY-005). */
  | "REFUND_EXCEEDS_AVAILABLE_AMOUNT"
  /** KBR-PAY-005 — refunds require recorded approval evidence. */
  | "REFUND_APPROVAL_REQUIRED"
  /** KBR-PAY-006 / PAY-VEC-019 — void only on eligible (pending) attempts. */
  | "VOID_NOT_ALLOWED_FOR_STATE"
  /** KBR-PAY-003 — unverified provider evidence is never payment authority. */
  | "UNVERIFIED_PROVIDER_EVENT"
  /** KBR-PAY-009 — settlement line where gross != fee + net. */
  | "SETTLEMENT_LINE_INCONSISTENT"
  /** money contract — amounts must be integer minor units (no floats). */
  | "NON_INTEGER_AMOUNT"
  /** Command referenced an attempt/record that does not exist. */
  | "UNKNOWN_ATTEMPT"
  /** Tender/refund amounts must be positive. */
  | "AMOUNT_NOT_POSITIVE"
  /** Tendered cash must cover the applied amount (KBR-PAY-002). */
  | "INSUFFICIENT_TENDER";

export class PaymentError extends Error {
  constructor(
    readonly code: PaymentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
