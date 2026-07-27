/**
 * `edge_sync` repository adapters (schema contract §6.8, §9).
 *
 * THE TRANSACTION INVARIANT (§9): a business mutation without its event and
 * outbox row is invalid and must fail the transaction. The event -> outbox half
 * is enforced STRUCTURALLY by the deferred constraint trigger in 0012, so these
 * adapters never expose a way to insert a `local_event` without its outbox row —
 * {@link insertLocalEventWithOutbox} writes both.
 *
 * AMENDMENT §2 (KLREQ-021): WS-09 writes ONLY `delivery_state = 'pending'`.
 * `sending`, `acknowledged`, `retry_wait`, `blocked` and `dead_letter` belong to
 * WS-10; a fabricated acknowledgement is refused here AND by the 0009
 * `outbox_ack_ck` CHECK.
 */
import type { HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";

/** The only persisted delivery state WS-09 may write (amendment §2). */
export const WS09_DELIVERY_STATE = "pending" as const;

/** The only wire sync state WS-09 may report (amendment §2). */
export const WS09_WIRE_SYNC_STATE = "pending_cloud_sync" as const;

/** Allocate the next `hub_sequence` (offline contract §5). Never reused. */
export async function allocateHubSequence(client: HubClient): Promise<bigint> {
  const result = await client.query<{ allocate_hub_sequence: bigint }>(
    `select edge_sync.allocate_hub_sequence()`,
  );
  const value = result.rows[0]?.allocate_hub_sequence;
  if (value === undefined) {
    throw new Error("edge_sync.allocate_hub_sequence() returned no row.");
  }
  return value;
}

export interface InsertLocalEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly hubDeviceId: string;
  readonly originDeviceId: string;
  readonly actorId: string | null;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  /** Canonical `<bounded_context>.<past_tense_fact>` name (@kitluy/event-contracts). */
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly businessDate: string;
  readonly hubSequence: bigint;
  readonly originSequence: bigint;
  readonly assignmentGeneration: number;
  readonly idempotencyKey: string;
  readonly payloadSha256: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * Insert the immutable local event AND its outbox row in the SAME statement
 * batch, inside the caller's transaction (§9; Hub spec §11.2). Power loss
 * between the two is impossible: the deferred constraint trigger refuses the
 * COMMIT if the outbox row is missing.
 */
export async function insertLocalEventWithOutbox(
  client: HubClient,
  input: InsertLocalEventInput,
): Promise<void> {
  await client.query(
    `insert into edge_sync.local_event
       (id, tenant_id, digital_store_id, location_id, hub_device_id, origin_device_id,
        actor_id, aggregate_type, aggregate_id, aggregate_version, event_type,
        schema_version, business_date, occurred_at, hub_sequence, origin_sequence,
        assignment_generation, idempotency_key, payload_sha256, payload, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::date, now(),
             $14, $15, $16, $17, $18, $19::jsonb, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.hubDeviceId,
      input.originDeviceId,
      input.actorId,
      input.aggregateType,
      input.aggregateId,
      input.aggregateVersion.toString(),
      input.eventType,
      input.schemaVersion,
      input.businessDate,
      input.hubSequence.toString(),
      input.originSequence.toString(),
      input.assignmentGeneration,
      input.idempotencyKey,
      input.payloadSha256,
      JSON.stringify(input.payload),
    ],
  );
  await client.query(
    `insert into edge_sync.outbox
       (event_id, tenant_id, digital_store_id, location_id, hub_sequence,
        assignment_generation, delivery_state, attempt_count, next_attempt_at)
     values ($1, $2, $3, $4, $5, $6, $7::edge_sync.delivery_state, 0, now())`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.hubSequence.toString(),
      input.assignmentGeneration,
      WS09_DELIVERY_STATE,
    ],
  );
}

export interface LocalEventRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: bigint;
  event_type: string;
  schema_version: number;
  hub_sequence: bigint;
  origin_sequence: bigint;
  assignment_generation: number;
  idempotency_key: string;
  payload_sha256: string;
  payload: Record<string, unknown>;
}

export async function listLocalEventsForAggregate(
  client: HubClient,
  aggregateId: string,
): Promise<readonly LocalEventRow[]> {
  const result = await client.query<LocalEventRow>(
    `select id, aggregate_type, aggregate_id, aggregate_version, event_type,
            schema_version, hub_sequence, origin_sequence, assignment_generation,
            idempotency_key, payload_sha256, payload
       from edge_sync.local_event where aggregate_id = $1 order by hub_sequence`,
    [aggregateId],
  );
  return result.rows;
}

export interface OutboxRow {
  event_id: string;
  hub_sequence: bigint;
  assignment_generation: number;
  delivery_state: string;
  attempt_count: number;
  cloud_ack_id: string | null;
  acknowledged_at: Date | null;
}

export async function findOutboxEntry(
  client: HubClient,
  eventId: string,
): Promise<OutboxRow | undefined> {
  const result = await client.query<OutboxRow>(
    `select event_id, hub_sequence, assignment_generation, delivery_state,
            attempt_count, cloud_ack_id, acknowledged_at
       from edge_sync.outbox where event_id = $1`,
    [eventId],
  );
  return result.rows[0];
}

export async function countPendingOutbox(client: HubClient, locationId: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from edge_sync.outbox
      where location_id = $1 and delivery_state = 'pending'`,
    [locationId],
  );
  return Number(result.rows[0]?.count ?? "0");
}

/**
 * Refuse, at the service boundary, any attempt to write a delivery state WS-09
 * does not own. WS-10 implements transmission; this guard makes the fence
 * executable rather than aspirational (amendment §2 acceptance rule 5).
 */
export function assertWs09DeliveryState(state: string): void {
  if (state !== WS09_DELIVERY_STATE) {
    throw new HubCommandError(
      "EDGE_COMMAND_INACTIVE",
      `WS-09 may only write delivery_state '${WS09_DELIVERY_STATE}'; '${state}' belongs to WS-10 (amendment §2).`,
      { deliveryState: state },
    );
  }
}

export interface SequenceGapInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly hubSequence: bigint;
  readonly gapReason:
    | "transaction_rollback"
    | "allocation_abandoned"
    | "restore_reconciliation"
    | "assignment_transition";
  readonly recordedBy: string;
  readonly note: string | null;
}

/**
 * Journal a KNOWN `hub_sequence` gap (offline contract §5). Sequence allocation
 * is non-transactional, so a rolled-back command burns its values; a journalled
 * value is a known gap and is NEVER sent as a missing event.
 *
 * MUST be called in a transaction that will COMMIT — journalling inside the
 * transaction being rolled back would roll the journal back with it.
 */
export async function recordSequenceGap(client: HubClient, input: SequenceGapInput): Promise<void> {
  await client.query(
    `select edge_sync.record_sequence_gap($1::uuid, $2::uuid, $3::uuid, $4::uuid,
              $5::integer, $6::bigint, $7::text, $8::text, $9::text)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.assignmentGeneration,
      input.hubSequence.toString(),
      input.gapReason,
      input.recordedBy,
      input.note,
    ],
  );
}

export interface SyncCursorRow {
  location_id: string;
  stream_code: string;
  last_pushed_hub_sequence: bigint;
  last_acked_hub_sequence: bigint;
  last_pulled_cloud_sequence: bigint;
  last_applied_cloud_sequence: bigint;
}

export async function findSyncCursor(
  client: HubClient,
  locationId: string,
  streamCode: string,
): Promise<SyncCursorRow | undefined> {
  const result = await client.query<SyncCursorRow>(
    `select location_id, stream_code, last_pushed_hub_sequence, last_acked_hub_sequence,
            last_pulled_cloud_sequence, last_applied_cloud_sequence
       from edge_sync.sync_cursor where location_id = $1 and stream_code = $2`,
    [locationId, streamCode],
  );
  return result.rows[0];
}
