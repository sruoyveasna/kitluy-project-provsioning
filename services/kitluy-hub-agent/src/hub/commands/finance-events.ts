/**
 * Finance EVENTS ONLY (amendment KLREQ-022 / recorded gap G8).
 *
 * OWNER RULING RECORDED: finance posting stays CLOUD-AUTHORITATIVE. The Hub
 * records the payment, refund/void, cash-movement and settlement SOURCE EVENTS
 * that cloud finance derives its authoritative journal from, plus the
 * deduplication reference that makes a replayed event produce ONE posting.
 * Creating a Hub-side journal would establish a SECOND authoritative ledger,
 * which KLD-FIN-002 forbids — so this module deliberately contains no journal,
 * no account, no posting rule and no balance, and NO `edge_finance` schema
 * exists anywhere in `hub/migrations/**`.
 *
 * `cloud_posting_status` is always `unknown`: the Hub genuinely does not know
 * whether cloud finance posted the event. WS-10 owns transmission and
 * acknowledgement; claiming anything else would be a fabricated cloud outcome
 * (amendment §2).
 */

/** Finance source-event names emitted by the Hub, in canonical Group 4 grammar. */
export const HUB_FINANCE_EVENT_NAMES = {
  /** EVT-PAY-001, REGISTERED in the Domain Event Registry. */
  paymentRecorded: "payment.recorded",
  /** PROPOSED — must be registered before release. */
  refundRequested: "payment.refund_requested",
  /** PROPOSED. */
  voidRequested: "payment.void_requested",
  /** PROPOSED. */
  cashMovementRecorded: "cash.movement_recorded",
} as const;

export type HubFinanceEventName =
  (typeof HUB_FINANCE_EVENT_NAMES)[keyof typeof HUB_FINANCE_EVENT_NAMES];

/**
 * The only value WS-09 may report for a finance event's cloud posting status.
 * It is a TRUTHFUL "not known here", never an optimistic default.
 */
export const CLOUD_POSTING_STATUS_UNKNOWN = "unknown" as const;

/** Fields every Hub finance event carries so cloud finance can post safely. */
export interface HubFinanceEventEnvelopeFields {
  /** SHA-256 over (source_type, source_id): the cloud posting dedup key. */
  readonly posting_dedup_key: string;
  /** Provider/settlement correlation, when the tender has one. Never truth. */
  readonly settlement_reference: string | null;
  readonly cloud_posting_status: typeof CLOUD_POSTING_STATUS_UNKNOWN;
}

/**
 * Schemas the Hub-local database is allowed to contain (§2, ten schemas plus
 * the `edge_ops` migration control plane). Exposed so a test can PROVE that no
 * finance schema was created by this cycle.
 */
export const FORBIDDEN_HUB_SCHEMAS = [
  "edge_finance",
  "edge_commands",
  "edge_events",
  "edge_print",
] as const;
