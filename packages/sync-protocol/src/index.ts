/**
 * @kitluy/sync-protocol — edge sync envelopes, sequencing and conflict policy.
 *
 * Source authority: Store Hub spec v1.0.0 §8.5 (event envelope and idempotency
 * key format), §11.2 (outbox in the same local transaction), §11.4
 * (per-data-class conflict policy — no generic last-write-wins for payment,
 * inventory, finance, custody or audit truth).
 *
 * STATUS: BUILT + TESTED (test/sync-protocol.test.ts). Wire transport and
 * durable storage are service implementations.
 */

/** Data classes with their locked conflict-resolution policy (Hub §11.4). */
export const CONFLICT_POLICIES = {
  finance_payment: "append_only_with_reconciliation",
  custody_pickup: "append_only_with_operator_review",
  inventory_movement: "ledger_based_no_lww",
  configuration: "versioned_cloud_wins",
  device_status: "latest_signed_observation_with_history",
  safe_profile_metadata: "audited_lww_where_approved",
} as const;
export type SyncDataClass = keyof typeof CONFLICT_POLICIES;

/** True when a data class may EVER use last-write-wins (only safe metadata). */
export function allowsLastWriteWins(dataClass: SyncDataClass): boolean {
  return CONFLICT_POLICIES[dataClass] === "audited_lww_where_approved";
}

/**
 * Outbox event envelope (Hub §8.5). Every local mutation produces one of these
 * in the SAME local database transaction as the mutation itself (§11.2).
 */
export interface OutboxEvent {
  readonly eventId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly hubId: string;
  readonly terminalId?: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly aggregateVersion: number;
  /** Strictly increasing per-location local ordering. */
  readonly localSequence: number;
  readonly idempotencyKey: string;
  readonly schemaVersion: string;
  readonly payloadSha256: string;
  readonly occurredAt: string;
}

/**
 * Canonical idempotency key format (Hub §8.5, verbatim):
 * `location:{location_id}:hub:{hub_id}:seq:{n}`
 */
export function buildIdempotencyKey(locationId: string, hubId: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new Error("Sequence must be a non-negative integer.");
  }
  return `location:${locationId}:hub:${hubId}:seq:${sequence}`;
}

const IDEMPOTENCY_KEY_PATTERN = /^location:[^:]+:hub:[^:]+:seq:\d+$/;
export function isValidIdempotencyKey(key: string): boolean {
  return IDEMPOTENCY_KEY_PATTERN.test(key);
}

export type OutboxItemState =
  "pending" | "dispatching" | "acknowledged" | "retrying" | "dead_letter";

/** Per-event push result returned by the cloud (Hub §11.5). */
export interface SyncPushResult {
  readonly eventId: string;
  readonly outcome: "applied" | "duplicate_ignored" | "rejected";
  readonly rejectionReason?: string;
}

/**
 * Validate ordering: events must be pushed oldest-unacknowledged first with
 * strictly increasing local sequence numbers (Hub §11.5).
 */
export function validateBatchOrdering(batch: readonly OutboxEvent[]): void {
  for (let i = 1; i < batch.length; i++) {
    const prev = batch[i - 1]!;
    const cur = batch[i]!;
    if (cur.localSequence <= prev.localSequence) {
      throw new Error(
        `Outbox batch ordering violation: sequence ${cur.localSequence} after ${prev.localSequence}.`,
      );
    }
  }
}
