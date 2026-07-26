/**
 * @kitluy/payments — pure, in-memory, append-only payment ledger engine.
 *
 * Canonical acceptance contract:
 * docs/source/qa/kitluy-payment-and-reconciliation-test-vectors-v1.0.0.json
 * (PAY-VEC-001..026, executed data-driven in test/vectors.test.ts).
 * Rule semantics: docs/source/business-rules/
 * kitluy-payment-refund-and-void-rules-v1.0.0.md (KBR-PAY-001..009).
 *
 * Scope: provider-independent orchestration semantics only — no DB, no
 * provider adapters (approved KHQR/acquirer contract is PAY-OD-001,
 * [REQUIRED]), no FX conversion (rejected without an approved contract).
 *
 * STATUS: BUILT + TESTED (test/vectors.test.ts, test/engine.test.ts).
 */

export const PACKAGE_NAME = "@kitluy/payments" as const;

export { PaymentError, type PaymentErrorCode } from "./errors.js";
export {
  BookingPaymentLedger,
  stableStringify,
  type CashTenderResult,
  type CommandEnvelope,
  type KhqrAttempt,
  type KhqrAttemptState,
  type LedgerAccount,
  type LedgerRecord,
  type LedgerRecordKind,
  type PaymentState,
  type Posting,
  type ProviderCallbackResult,
  type RefundResult,
  type VoidFinalizedDecision,
} from "./ledger.js";
export {
  applyKhqrCallback,
  applyKhqrClientConfirm,
  createKhqrAttempt,
  voidAttempt,
  type CreateKhqrAttemptCommand,
  type KhqrCallbackCommand,
} from "./khqr.js";
export { applyRefund, requestVoidOfFinalizedPayment, type RefundCommand } from "./refunds.js";
export {
  DEFAULT_SETTLEMENT_SLA_HOURS,
  SettlementReconciler,
  type MissingSettlementFinding,
  type ReconciliationState,
  type SettlementMatchResult,
} from "./settlement.js";
export { closeCashSession, type CashCloseResult, type CashCloseState } from "./cash-session.js";
