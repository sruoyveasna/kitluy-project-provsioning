/**
 * WS-10 synchronization error vocabulary.
 *
 * DELIBERATELY SEPARATE from `../errors.ts`. Those codes describe why the Hub
 * REFUSED A TERMINAL COMMAND; these describe what happened to a DELIVERY. A
 * shared list would let a transport failure be reported as a business refusal,
 * and — the direction that actually matters — would let a local transport
 * problem masquerade as a cloud verdict.
 *
 * Authority:
 *   - Store Hub spec §11.5 (push, acknowledgement and retry behaviour).
 *   - Owner amendment KLD-2026-07-28-001-A01 §2: `rejected` means a DURABLE
 *     cloud rejection and must never be used for a temporary network error,
 *     rate limiting, a scheduled retry, an in-progress attempt, a local
 *     operator pause or an unverified timeout.
 */

/**
 * TRANSIENT: the attempt did not produce a cloud verdict. Every code here
 * routes to `retry_wait` with backoff — never to `rejected`.
 */
export const SYNC_TRANSIENT_ERROR_CODES = [
  "EDGE_TRANSPORT_UNREACHABLE",
  "EDGE_TRANSPORT_TIMEOUT",
  "EDGE_TRANSPORT_INTERRUPTED",
  "EDGE_CLOUD_UNAVAILABLE",
  "EDGE_CLOUD_RATE_LIMITED",
  "EDGE_LEASE_EXPIRED",
  "EDGE_WORKER_SHUTDOWN",
  "EDGE_OPERATOR_PAUSED",
] as const;
export type SyncTransientErrorCode = (typeof SYNC_TRANSIENT_ERROR_CODES)[number];

/**
 * DURABLE: the cloud answered and the answer will not change on retry. Only
 * these may drive `delivery_state = 'rejected'` (amendment §2).
 */
export const SYNC_DURABLE_REJECTION_CODES = [
  "EDGE_CLOUD_REJECTED_SCHEMA",
  "EDGE_CLOUD_REJECTED_SCOPE",
  "EDGE_CLOUD_REJECTED_SIGNATURE",
  "EDGE_CLOUD_REJECTED_BUSINESS_RULE",
  "EDGE_CLOUD_REJECTED_UNKNOWN_AGGREGATE",
  "EDGE_CLOUD_REJECTED_PERMANENT",
] as const;
export type SyncDurableRejectionCode = (typeof SYNC_DURABLE_REJECTION_CODES)[number];

/** Local integrity refusals raised by the delivery pipeline itself. */
export const SYNC_INTEGRITY_ERROR_CODES = [
  "EDGE_BATCH_ORDERING_VIOLATION",
  "EDGE_BATCH_SIGNATURE_MISSING",
  "EDGE_PAYLOAD_HASH_MISMATCH",
  "EDGE_ACK_UNMATCHED_LEASE",
  "EDGE_ACK_IDENTITY_MISSING",
  "EDGE_EFFECT_KEY_MALFORMED",
  "EDGE_EFFECT_ORDINAL_UNREGISTERED",
  "EDGE_INBOX_SIGNATURE_INVALID",
  "EDGE_INBOX_SEQUENCE_GAP",
  "EDGE_INBOX_EXPIRED",
  "EDGE_SNAPSHOT_SIGNATURE_INVALID",
  "EDGE_SNAPSHOT_MANIFEST_MISMATCH",
  "EDGE_SNAPSHOT_VERSION_UNSUPPORTED",
  "EDGE_PROVIDER_CALLBACK_DIRECT_REFUSED",
  "EDGE_PROVIDER_OUTCOME_CONFLICT",
  "EDGE_CURSOR_REGRESSION_REFUSED",
  "EDGE_REPAIR_NOT_AUTHORIZED",
] as const;
export type SyncIntegrityErrorCode = (typeof SYNC_INTEGRITY_ERROR_CODES)[number];

export type SyncErrorCode =
  SyncTransientErrorCode | SyncDurableRejectionCode | SyncIntegrityErrorCode;

const TRANSIENT = new Set<string>(SYNC_TRANSIENT_ERROR_CODES);
const DURABLE = new Set<string>(SYNC_DURABLE_REJECTION_CODES);

/**
 * The single gate between "try again" and "the cloud said no".
 *
 * Fails CLOSED toward retry: an unrecognised code is treated as transient, so
 * a code nobody classified can never silently become a durable rejection. The
 * cost of being wrong in this direction is a retry; in the other direction it
 * is a fabricated cloud verdict on a real business effect.
 */
export function isDurableCloudRejection(code: string): boolean {
  return DURABLE.has(code);
}

export function isTransientDeliveryFailure(code: string): boolean {
  return !DURABLE.has(code);
}

/** True when `code` was actually classified, rather than defaulted to retry. */
export function isClassifiedDeliveryOutcome(code: string): boolean {
  return TRANSIENT.has(code) || DURABLE.has(code);
}

export class SyncDeliveryError extends Error {
  constructor(
    readonly code: SyncErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "SyncDeliveryError";
  }
}
