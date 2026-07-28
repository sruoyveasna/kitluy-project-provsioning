/**
 * WS-10-T009 — sync cursor recovery, observability and audited operator repair.
 *
 * Authority: Store Hub spec §11.5, schema contract §6.8, offline contract §5
 * (a journalled burnt sequence is a KNOWN gap, never a missing event), owner
 * amendment KLD-2026-07-28-001-A01 §3 and §5.
 *
 * OBSERVABILITY THAT CANNOT FLATTER ITSELF. `describeStreamHealth` reports both
 * dimensions and says explicitly whether the stream is BLOCKED and why. A queue
 * depth on its own is the classic misleading metric here: a stream can be one
 * item deep and completely stuck, or a thousand deep and draining fine.
 */
import type { HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";
import { auditRepo, syncRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";

/**
 * The registry key that permits requeueing. `fleet.sync.trigger` is
 * "Request a safe sync/reconciliation cycle" — which is exactly what a requeue
 * is: asking the system to try again. It is NOT reused for anything that
 * declares an outcome.
 */
export const REQUEUE_PERMISSION = "fleet.sync.trigger" as const;

/**
 * KLREQ-030 (NEW OPEN ITEM). Abandoning a dead letter accepts PERMANENT LOSS of
 * a recorded business effect. No registry key permits that, and
 * `fleet.sync.trigger` certainly does not — it permits retrying, whose whole
 * point is that nothing is lost. The path is therefore absent rather than
 * implemented behind a borrowed key.
 */
export const ABANDON_PERMISSION =
  "[REQUIRED: canonical RBAC permission key for ABANDONING a dead-lettered sync item, which " +
  "accepts permanent loss of a recorded business effect. fleet.sync.trigger permits requesting a " +
  "retry and must not be reused. Likely warrants four-eyes and a reason. Tracked as KLREQ-030.]";

export interface StreamHealth {
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly total: number;
  readonly pending: number;
  readonly inFlight: number;
  readonly retryWait: number;
  readonly acknowledged: number;
  readonly rejected: number;
  readonly deadLetter: number;
  readonly reconciliationRequired: number;
  readonly oldestUnacknowledgedSequence: bigint | null;
  readonly lastSequence: bigint | null;
  readonly nextRetryAt: Date | null;
  /** TRUE when the head cannot move without intervention. */
  readonly blocked: boolean;
  readonly blockedReason: string | null;
}

export async function describeStreamHealth(
  client: HubClient,
  locationId: string,
  assignmentGeneration: number,
): Promise<StreamHealth | undefined> {
  const result = await client.query<{
    total_items: string;
    pending_items: string;
    in_flight_items: string;
    retry_wait_items: string;
    acknowledged_items: string;
    rejected_items: string;
    dead_letter_items: string;
    reconciliation_required_items: string;
    oldest_unacknowledged_sequence: bigint | null;
    last_sequence: bigint | null;
    next_retry_at: Date | null;
  }>(
    `select * from edge_sync.stream_health
      where location_id = $1 and assignment_generation = $2`,
    [locationId, assignmentGeneration],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  // The BLOCKED question is answered from the head of the stream, not from the
  // counts: the counts cannot distinguish "draining" from "stuck".
  const head = await client.query<{
    delivery_state: string;
    reconciliation_state: string;
    next_attempt_at: Date;
    lease_owner: string | null;
    lease_expires_at: Date | null;
  }>(
    `select o.delivery_state::text, o.reconciliation_state::text, o.next_attempt_at,
            o.lease_owner, o.lease_expires_at
       from edge_sync.outbox o
      where o.location_id = $1 and o.assignment_generation = $2
        and o.delivery_state not in ('acknowledged', 'rejected', 'dead_letter')
      order by o.hub_sequence
      limit 1`,
    [locationId, assignmentGeneration],
  );

  let blocked = false;
  let blockedReason: string | null = null;
  const headRow = head.rows[0];
  if (headRow) {
    if (headRow.reconciliation_state === "required") {
      blocked = true;
      blockedReason =
        "The head of the stream requires reconciliation; delivery stops rather than sending past a known divergence.";
    } else if (
      headRow.delivery_state === "retry_wait" &&
      headRow.next_attempt_at.getTime() > Date.now()
    ) {
      blocked = true;
      blockedReason = `Head is backing off until ${headRow.next_attempt_at.toISOString()}.`;
    } else if (
      headRow.delivery_state === "in_flight" &&
      headRow.lease_expires_at !== null &&
      headRow.lease_expires_at.getTime() > Date.now()
    ) {
      blocked = true;
      blockedReason = `Head is leased by '${headRow.lease_owner}' until ${headRow.lease_expires_at.toISOString()}.`;
    }
  }

  return {
    locationId,
    assignmentGeneration,
    total: Number(row.total_items),
    pending: Number(row.pending_items),
    inFlight: Number(row.in_flight_items),
    retryWait: Number(row.retry_wait_items),
    acknowledged: Number(row.acknowledged_items),
    rejected: Number(row.rejected_items),
    deadLetter: Number(row.dead_letter_items),
    reconciliationRequired: Number(row.reconciliation_required_items),
    oldestUnacknowledgedSequence: row.oldest_unacknowledged_sequence,
    lastSequence: row.last_sequence,
    nextRetryAt: row.next_retry_at,
    blocked,
    blockedReason,
  };
}

export interface RecoveredCursor {
  readonly pushed: bigint;
  readonly acknowledged: bigint;
}

/**
 * Rebuild a stream cursor from stored rows after a crash or restart.
 *
 * The Hub does not remember its cursor in process, so recovery is a query
 * rather than a replay: whatever the rows say happened, happened. Journalled
 * burnt sequences do not break acknowledged contiguity; an unacknowledged row
 * does.
 */
export async function recoverSyncCursor(
  client: HubClient,
  input: {
    readonly locationId: string;
    readonly assignmentGeneration: number;
    readonly streamCode: string;
  },
): Promise<RecoveredCursor> {
  const result = await client.query<{ recovered_pushed: bigint; recovered_acked: bigint }>(
    `select * from edge_sync.recover_sync_cursor($1::uuid, $2::integer, $3::text)`,
    [input.locationId, input.assignmentGeneration, input.streamCode],
  );
  const row = result.rows[0]!;
  return { pushed: row.recovered_pushed, acknowledged: row.recovered_acked };
}

export interface RequeueInput {
  readonly deadLetterId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly delaySeconds?: number;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly hubDeviceId: string;
  readonly correlationId?: string;
}

/**
 * Requeue a dead-lettered item, with immutable audit.
 *
 * Touches the DELIVERY dimension only. An operator who repaired the transport
 * has not thereby declared the divergence resolved, so the reconciliation
 * raised when the item was dead-lettered stays raised and still needs its own
 * governed clearance.
 */
export async function requeueDeadLetter(client: HubClient, input: RequeueInput): Promise<string> {
  const before = await client.query<{ delivery_state: string; reconciliation_state: string }>(
    `select o.delivery_state::text, o.reconciliation_state::text
       from edge_sync.outbox o
       join edge_sync.dead_letter_item d on d.source_id = o.event_id
      where d.id = $1`,
    [input.deadLetterId],
  );

  const result = await client.query<{ requeue_dead_letter: string }>(
    `select edge_sync.requeue_dead_letter($1::uuid, $2::uuid, $3::text, $4::integer)`,
    [input.deadLetterId, input.actorId, input.reason, input.delaySeconds ?? 0],
  );
  const eventId = result.rows[0]!.requeue_dead_letter;

  const after = await client.query<{ delivery_state: string; reconciliation_state: string }>(
    `select delivery_state::text, reconciliation_state::text
       from edge_sync.outbox where event_id = $1`,
    [eventId],
  );

  const localSequence = await syncRepo.allocateHubSequence(client);
  await auditRepo.appendAuditEvent(client, {
    id: uuidv7(),
    tenantId: input.tenantId,
    digitalStoreId: input.digitalStoreId,
    locationId: input.locationId,
    eventCode: "sync.dead_letter_requeued",
    actorType: "user",
    actorId: input.actorId,
    requesterId: null,
    approverId: null,
    terminalDeviceId: null,
    hubDeviceId: input.hubDeviceId,
    profileCode: null,
    resourceType: "sync_dead_letter_item",
    resourceId: input.deadLetterId,
    reasonCode: "OPERATOR_REQUEUE",
    correlationId: input.correlationId ?? uuidv7(),
    payloadSha256: "0".repeat(64),
    details: {
      permission: REQUEUE_PERMISSION,
      event_id: eventId,
      reason: input.reason,
      delivery_state_before: before.rows[0]?.delivery_state ?? null,
      delivery_state_after: after.rows[0]?.delivery_state ?? null,
      reconciliation_state_before: before.rows[0]?.reconciliation_state ?? null,
      reconciliation_state_after: after.rows[0]?.reconciliation_state ?? null,
    },
    localSequence,
  });
  return eventId;
}

/**
 * Abandon a dead-lettered item. INACTIVE (KLREQ-030) — see
 * {@link ABANDON_PERMISSION}. Accepting permanent loss of a recorded business
 * effect needs its own owner-approved key, and borrowing the retry key would
 * make "try again" and "give up" the same authority.
 */
export function abandonDeadLetter(_deadLetterId: string): never {
  throw new HubCommandError(
    "EDGE_PERMISSION_KEY_UNREGISTERED",
    `Abandoning a dead-lettered sync item is INACTIVE: ${ABANDON_PERMISSION}`,
    { permission: ABANDON_PERMISSION, openItem: "KLREQ-030" },
  );
}
