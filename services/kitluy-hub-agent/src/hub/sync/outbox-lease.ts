/**
 * WS-10-T001 — outbox leasing and the `pending -> in_flight` transition.
 *
 * Authority: Store Hub spec §11.5 (oldest-unacknowledged-first), offline
 * contract §5.1 (ordering namespace `(location_id, assignment_generation,
 * hub_sequence)`), owner amendment KLD-2026-07-28-001-A01 §2 and §3.
 *
 * The ordering and stop/step-over rules live in
 * `edge_sync.lease_outbox_batch` (hub migration 0016), not here. That is
 * deliberate: the claim must be atomic with the row lock, and a second
 * implementation of the ordering rule in TypeScript would be a second place to
 * get it wrong. This module owns the worker's side — identity, lease window,
 * batch bounds and truthful release.
 */
import { randomUUID } from "node:crypto";
import type { HubClient } from "../db.js";
import { SyncDeliveryError, isDurableCloudRejection } from "./errors.js";

/**
 * Lease window default. Short enough that a dead worker's rows return to the
 * queue promptly; long enough that a slow-but-alive WAN attempt is not reaped
 * out from under itself. Overridable per worker — never inferred from a cloud
 * response.
 */
export const DEFAULT_LEASE_SECONDS = 60;

/** Batch bound. §11.5 pushes oldest-first; an unbounded batch is not a batch. */
export const DEFAULT_MAX_BATCH_ITEMS = 100;

export interface OutboxLeaseItem {
  readonly eventId: string;
  readonly hubSequence: bigint;
  readonly assignmentGeneration: number;
  readonly attemptCount: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly originDeviceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly businessDate: string;
  readonly occurredAt: Date;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly payload: Record<string, unknown>;
}

export interface OutboxLease {
  readonly leaseId: string;
  readonly leaseOwner: string;
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly items: readonly OutboxLeaseItem[];
}

export interface LeaseOptions {
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly leaseOwner: string;
  readonly leaseSeconds?: number;
  readonly maxItems?: number;
  /** Injectable for tests; production always mints a fresh attempt identity. */
  readonly leaseId?: string;
}

interface LeaseRow {
  event_id: string;
  hub_sequence: bigint;
  assignment_generation: number;
  attempt_count: number;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  origin_device_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: bigint;
  event_type: string;
  schema_version: number;
  business_date: string;
  occurred_at: Date;
  idempotency_key: string;
  payload_sha256: string;
  payload: Record<string, unknown>;
}

/**
 * Claim the next ordered batch. Returns an empty `items` array when the head of
 * the stream is blocked — a blocked stream is a normal, reportable state, not
 * an error, and the worker must not treat "nothing leased" as "nothing left".
 */
export async function leaseOutboxBatch(
  client: HubClient,
  options: LeaseOptions,
): Promise<OutboxLease> {
  const leaseId = options.leaseId ?? randomUUID();
  const leaseSeconds = options.leaseSeconds ?? DEFAULT_LEASE_SECONDS;
  const maxItems = options.maxItems ?? DEFAULT_MAX_BATCH_ITEMS;

  const result = await client.query<LeaseRow>(
    `select * from edge_sync.lease_outbox_batch($1::uuid, $2::integer, $3::text,
                                                $4::uuid, $5::integer, $6::integer)`,
    [
      options.locationId,
      options.assignmentGeneration,
      options.leaseOwner,
      leaseId,
      leaseSeconds,
      maxItems,
    ],
  );

  const items = result.rows.map((r): OutboxLeaseItem => ({
    eventId: r.event_id,
    hubSequence: r.hub_sequence,
    assignmentGeneration: r.assignment_generation,
    attemptCount: r.attempt_count,
    tenantId: r.tenant_id,
    digitalStoreId: r.digital_store_id,
    locationId: r.location_id,
    originDeviceId: r.origin_device_id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    aggregateVersion: r.aggregate_version,
    eventType: r.event_type,
    schemaVersion: r.schema_version,
    businessDate: r.business_date,
    occurredAt: r.occurred_at,
    idempotencyKey: r.idempotency_key,
    payloadSha256: r.payload_sha256,
    payload: r.payload,
  }));

  assertStrictlyIncreasing(items);

  return {
    leaseId,
    leaseOwner: options.leaseOwner,
    locationId: options.locationId,
    assignmentGeneration: options.assignmentGeneration,
    items,
  };
}

/**
 * Hub spec §11.5: a batch is pushed with strictly increasing local sequence.
 * The SQL claim already orders the scan; this is the independent check that the
 * batch handed to transmission really is ordered, so a future change to the
 * claim cannot silently ship an out-of-order batch.
 */
export function assertStrictlyIncreasing(items: readonly OutboxLeaseItem[]): void {
  for (let i = 1; i < items.length; i += 1) {
    const previous = items[i - 1]!;
    const current = items[i]!;
    if (current.assignmentGeneration < previous.assignmentGeneration) {
      throw new SyncDeliveryError(
        "EDGE_BATCH_ORDERING_VIOLATION",
        `Batch generation went backwards: ${current.assignmentGeneration} after ${previous.assignmentGeneration}.`,
        { previous: previous.eventId, current: current.eventId },
      );
    }
    if (
      current.assignmentGeneration === previous.assignmentGeneration &&
      current.hubSequence <= previous.hubSequence
    ) {
      throw new SyncDeliveryError(
        "EDGE_BATCH_ORDERING_VIOLATION",
        `Batch ordering violation: hub_sequence ${current.hubSequence} after ${previous.hubSequence}.`,
        { previous: previous.eventId, current: current.eventId },
      );
    }
  }
}

/**
 * Hand a leased row back WITHOUT claiming a cloud outcome.
 *
 * Refuses a durable-rejection code outright: recording "the cloud said no" is
 * {@link recordCloudRejection}'s job (WS-10-T004) and requires an actual cloud
 * response. Releasing a lease means the opposite — no answer was observed.
 */
export async function releaseOutboxLease(
  client: HubClient,
  input: {
    readonly eventId: string;
    readonly leaseId: string;
    readonly reasonCode: string;
    readonly backoffSeconds?: number;
  },
): Promise<boolean> {
  if (isDurableCloudRejection(input.reasonCode)) {
    throw new SyncDeliveryError(
      "EDGE_ACK_IDENTITY_MISSING",
      `Releasing a lease cannot record '${input.reasonCode}': a durable cloud rejection requires an actual cloud response (KLD-2026-07-28-001-A01 §2).`,
      { eventId: input.eventId, reasonCode: input.reasonCode },
    );
  }
  const result = await client.query<{ release_outbox_lease: boolean }>(
    `select edge_sync.release_outbox_lease($1::uuid, $2::uuid, $3::text, $4::integer)`,
    [input.eventId, input.leaseId, input.reasonCode, input.backoffSeconds ?? 0],
  );
  return result.rows[0]?.release_outbox_lease === true;
}

/** Reclaim every expired lease for a Location; returns the true count. */
export async function reapExpiredLeases(client: HubClient, locationId: string): Promise<number> {
  const result = await client.query<{ reap_expired_outbox_leases: number }>(
    `select edge_sync.reap_expired_outbox_leases($1::uuid)`,
    [locationId],
  );
  return result.rows[0]?.reap_expired_outbox_leases ?? 0;
}

/**
 * Why the stream is not moving, for observability (WS-10-T009) and for the
 * operator. Returns `undefined` when the queue is simply empty — "drained" and
 * "blocked" are different facts and must never be reported as one.
 */
export interface StreamHead {
  readonly eventId: string;
  readonly hubSequence: bigint;
  readonly deliveryState: string;
  readonly reconciliationState: string;
  readonly externalStatus: string;
  readonly nextAttemptAt: Date | null;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: Date | null;
}

export async function describeStreamHead(
  client: HubClient,
  locationId: string,
  assignmentGeneration: number,
): Promise<StreamHead | undefined> {
  const result = await client.query<{
    event_id: string;
    hub_sequence: bigint;
    delivery_state: string;
    reconciliation_state: string;
    external_status: string;
    next_attempt_at: Date | null;
    lease_owner: string | null;
    lease_expires_at: Date | null;
  }>(
    `select o.event_id, o.hub_sequence, o.delivery_state, o.reconciliation_state,
            edge_sync.external_sync_status(o.delivery_state, o.reconciliation_state) as external_status,
            o.next_attempt_at, o.lease_owner, o.lease_expires_at
       from edge_sync.outbox o
      where o.location_id = $1 and o.assignment_generation = $2
        and o.delivery_state not in ('acknowledged', 'rejected', 'dead_letter')
      order by o.assignment_generation, o.hub_sequence
      limit 1`,
    [locationId, assignmentGeneration],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    eventId: row.event_id,
    hubSequence: row.hub_sequence,
    deliveryState: row.delivery_state,
    reconciliationState: row.reconciliation_state,
    externalStatus: row.external_status,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
  };
}
