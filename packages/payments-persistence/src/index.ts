/**
 * @kitluy/payments-persistence — WS-08 persistence adapters (Cycle-6).
 *
 * Layering (Cycle-6 §17): domain engine (@kitluy/payments) -> repository/
 * command services (this package) -> local Supabase dev database. No provider
 * clients, no credentials (PAY-OD-001/BLK-006 open); the KHQR path runs the
 * DEV_KHQR_SIM simulator identity only. LOCAL ONLY (KL-INF-P1-037).
 */
export const PACKAGE_NAME = "@kitluy/payments-persistence" as const;

export {
  createDevPool,
  devDatabaseUrl,
  isDevDatabaseReachable,
  withServiceTransaction,
  appendAuditLog,
  DEV_DB_URL_ENV,
  type CommandActor,
} from "./db.js";
export {
  FinancePostingError,
  postJournalEntry,
  type JournalLeg,
  type PostJournalCommand,
  type PostJournalResult,
  type PostingDirection,
} from "./finance-posting.js";
export {
  DEV_KHQR_PROVIDER,
  PaymentPersistenceError,
  applySimulatedKhqrCallback,
  approveRefund,
  captureCashTender,
  completeRefund,
  createKhqrIntent,
  requestRefund,
  sha256,
  type CashCaptureCommand,
  type CashCaptureResult,
  type Currency,
  type KhqrCallbackCommandInput,
  type KhqrCallbackOutcome,
  type KhqrIntentCommand,
  type KhqrIntentResult,
  type RefundApprovalCommand,
  type RefundCompletionResult,
  type RefundRequestCommand,
} from "./payment-command-service.js";
