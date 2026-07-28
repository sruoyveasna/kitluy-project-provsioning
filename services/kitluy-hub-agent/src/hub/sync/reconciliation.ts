/**
 * WS-10-T005 — independent delivery-state and conflict-state transitions, and
 * the GOVERNED path that clears a reconciliation.
 *
 * Authority: owner amendment KLD-2026-07-28-001-A01 §3 (the two dimensions are
 * orthogonal and transition independently) and §5, verbatim in substance:
 *
 *   "A delivery worker must NOT independently clear `reconciliation_required`
 *    — clearing requires an authorized actor or governed automated
 *    reconciliation, a reason, prior and resulting states, immutable audit, and
 *    correlation to the repair or compensating action."
 *
 * WHERE EACH GUARANTEE LIVES.
 *   - "not independently"  : hub migration 0015's trigger refuses any bare
 *                            UPDATE of a reconciliation_* column, so the
 *                            delivery worker's UPDATE grant is not enough.
 *   - "a reason", "prior and resulting states", "correlation" :
 *                            the 0015 CHECK constraints make the evidence
 *                            non-optional at the storage layer.
 *   - "an authorized actor or governed automated reconciliation" and
 *     "immutable audit" :    this module, which is the only place that calls
 *                            `edge_sync.clear_reconciliation` and writes the
 *                            `edge_audit.audit_event` row in the SAME
 *                            transaction.
 *
 * KLREQ-029 (NEW OPEN ITEM, recorded not resolved). The canonical RBAC registry
 * has NO permission key for an operator clearing a reconciliation. The nearest
 * key, `fleet.sync.trigger`, permits REQUESTING a safe sync/reconciliation
 * cycle — a different act from DECLARING a divergence resolved, and reusing it
 * would silently widen it. Following KLREQ-015 discipline, the operator path is
 * therefore INACTIVE and fails closed carrying its `[REQUIRED: ...]` marker; no
 * key is invented and no check is relaxed to make it pass. The GOVERNED
 * AUTOMATED path stays active because its authority is a signed cloud
 * reconciliation decision, not a Hub-side actor permission.
 */
import type { HubClient } from "../db.js";
import { HubCommandError } from "../errors.js";
import { auditRepo, syncRepo } from "../repositories/index.js";
import { uuidv7 } from "../uuid.js";
import { SyncDeliveryError } from "./errors.js";

/** The permission key that does not exist yet (KLREQ-029). Never guessed. */
export const OPERATOR_CLEARANCE_PERMISSION =
  "[REQUIRED: canonical RBAC permission key for an operator clearing a sync reconciliation. " +
  "The registry has no such key; fleet.sync.trigger permits REQUESTING a reconciliation cycle, " +
  "not DECLARING a divergence resolved. Tracked as KLREQ-029.]";

export interface ReconciliationScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly hubDeviceId: string;
}

export interface RaiseReconciliationInput extends ReconciliationScope {
  readonly eventId: string;
  readonly conflictId: string;
  readonly reason: string;
  readonly correlationId?: string;
  /** Present when a human observed the divergence; absent for the worker. */
  readonly actorId?: string | null;
}

interface OutboxDimensions {
  readonly delivery_state: string;
  readonly reconciliation_state: string;
}

async function readDimensions(client: HubClient, eventId: string): Promise<OutboxDimensions> {
  const result = await client.query<OutboxDimensions>(
    `select delivery_state::text, reconciliation_state::text
       from edge_sync.outbox where event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new SyncDeliveryError("EDGE_ACK_UNMATCHED_LEASE", `No outbox row for event ${eventId}.`, {
      eventId,
    });
  }
  return row;
}

async function appendDimensionAudit(
  client: HubClient,
  input: {
    readonly scope: ReconciliationScope;
    readonly eventId: string;
    readonly eventCode: string;
    readonly actorType: string;
    readonly actorId: string | null;
    readonly reasonCode: string;
    readonly correlationId: string;
    readonly before: OutboxDimensions;
    readonly after: OutboxDimensions;
    readonly details: Readonly<Record<string, unknown>>;
  },
): Promise<void> {
  // PRIOR AND RESULTING STATES, both dimensions, in one immutable row: reading
  // the audit alone must answer what changed and what did not.
  const details = {
    ...input.details,
    delivery_state_before: input.before.delivery_state,
    delivery_state_after: input.after.delivery_state,
    reconciliation_state_before: input.before.reconciliation_state,
    reconciliation_state_after: input.after.reconciliation_state,
  };
  const localSequence = await syncRepo.allocateHubSequence(client);
  await auditRepo.appendAuditEvent(client, {
    id: uuidv7(),
    tenantId: input.scope.tenantId,
    digitalStoreId: input.scope.digitalStoreId,
    locationId: input.scope.locationId,
    eventCode: input.eventCode,
    actorType: input.actorType,
    actorId: input.actorId,
    requesterId: null,
    approverId: null,
    terminalDeviceId: null,
    hubDeviceId: input.scope.hubDeviceId,
    profileCode: null,
    resourceType: "sync_outbox_item",
    resourceId: input.eventId,
    reasonCode: input.reasonCode,
    correlationId: input.correlationId,
    payloadSha256: "0".repeat(64),
    details,
    localSequence,
  });
}

/**
 * Raise the conflict dimension, with audit. The delivery dimension is NOT
 * touched — an item that was mid-flight stays mid-flight.
 */
export async function raiseReconciliation(
  client: HubClient,
  input: RaiseReconciliationInput,
): Promise<void> {
  const before = await readDimensions(client, input.eventId);
  await client.query(`select edge_sync.raise_reconciliation($1::uuid, $2::uuid, $3::text)`, [
    input.eventId,
    input.conflictId,
    input.reason,
  ]);
  const after = await readDimensions(client, input.eventId);
  await appendDimensionAudit(client, {
    scope: input,
    eventId: input.eventId,
    eventCode: "sync.reconciliation_raised",
    actorType: input.actorId ? "user" : "service",
    actorId: input.actorId ?? null,
    reasonCode: "RECONCILIATION_RAISED",
    correlationId: input.correlationId ?? uuidv7(),
    before,
    after,
    details: { conflict_id: input.conflictId, reason: input.reason },
  });
}

export interface AutomatedClearanceInput extends ReconciliationScope {
  readonly eventId: string;
  /**
   * The signed cloud reconciliation decision that authorises this clearance —
   * in practice the `edge_sync.inbox.message_id` of the delivery that carried
   * it. This is the "governed automated reconciliation" of amendment §5, and
   * it is REQUIRED: without it there is no authority, only a state change.
   */
  readonly governingDeliveryId: string;
  /** The approved policy the automated clearance acted under. */
  readonly policyReference: string;
  readonly reason: string;
  /** The compensating or repair event this clearance correlates to. */
  readonly resolutionEventId: string;
  readonly correlationId?: string;
}

/**
 * Clear a reconciliation under GOVERNED AUTOMATED authority.
 *
 * The authority is the signed cloud decision, not a Hub-side actor, so
 * `reconciliation_cleared_by` stays NULL and
 * `reconciliation_cleared_authority` names the governing policy — the 0015
 * CHECK accepts exactly that combination and refuses a clearance with neither.
 */
export async function clearReconciliationByGovernedAutomation(
  client: HubClient,
  input: AutomatedClearanceInput,
): Promise<void> {
  if (!input.governingDeliveryId) {
    throw new SyncDeliveryError(
      "EDGE_REPAIR_NOT_AUTHORIZED",
      "Automated clearance requires the signed cloud reconciliation delivery that authorises it (amendment §5).",
      { eventId: input.eventId },
    );
  }
  if (!input.policyReference) {
    throw new SyncDeliveryError(
      "EDGE_REPAIR_NOT_AUTHORIZED",
      "Automated clearance requires the approved policy it acted under (amendment §5).",
      { eventId: input.eventId },
    );
  }

  const before = await readDimensions(client, input.eventId);
  await client.query(
    `select edge_sync.clear_reconciliation($1::uuid, null, $2::text, $3::text, $4::uuid)`,
    [
      input.eventId,
      `automation:${input.policyReference}:delivery:${input.governingDeliveryId}`,
      input.reason,
      input.resolutionEventId,
    ],
  );
  const after = await readDimensions(client, input.eventId);
  await appendDimensionAudit(client, {
    scope: input,
    eventId: input.eventId,
    eventCode: "sync.reconciliation_cleared",
    actorType: "service",
    actorId: null,
    reasonCode: "RECONCILIATION_CLEARED_AUTOMATED",
    correlationId: input.correlationId ?? uuidv7(),
    before,
    after,
    details: {
      authority: "governed_automated_reconciliation",
      policy_reference: input.policyReference,
      governing_delivery_id: input.governingDeliveryId,
      resolution_event_id: input.resolutionEventId,
      reason: input.reason,
    },
  });
}

export interface OperatorClearanceInput extends ReconciliationScope {
  readonly eventId: string;
  readonly actorId: string;
  readonly reason: string;
  readonly resolutionEventId: string;
  readonly correlationId?: string;
}

/**
 * Clear a reconciliation as an AUTHORIZED OPERATOR.
 *
 * INACTIVE and fails closed (KLREQ-029). Every other precondition is already
 * implemented — the governed procedure, the evidence constraints, the audit
 * row — so this becomes callable the moment a canonical permission key exists.
 * Until then it refuses, carrying the `[REQUIRED: ...]` marker, because the
 * alternative is to reuse a key that permits a different act.
 */
export function clearReconciliationByOperator(_input: OperatorClearanceInput): never {
  throw new HubCommandError(
    "EDGE_PERMISSION_KEY_UNREGISTERED",
    `Operator-initiated reconciliation clearance is INACTIVE: ${OPERATOR_CLEARANCE_PERMISSION}`,
    { permission: OPERATOR_CLEARANCE_PERMISSION, openItem: "KLREQ-029" },
  );
}

/**
 * The two dimensions of one outbox item, plus the shared external projection.
 *
 * Reads both, so a caller can never accidentally reason about one while
 * assuming the other (amendment §3 "separately queryable").
 */
export interface ItemDimensions {
  readonly eventId: string;
  readonly deliveryState: string;
  readonly reconciliationState: string;
  readonly externalStatus: string;
  readonly conflictId: string | null;
  readonly clearedAuthority: string | null;
}

export async function readItemDimensions(
  client: HubClient,
  eventId: string,
): Promise<ItemDimensions | undefined> {
  const result = await client.query<{
    event_id: string;
    delivery_state: string;
    reconciliation_state: string;
    external_status: string;
    reconciliation_conflict_id: string | null;
    reconciliation_cleared_authority: string | null;
  }>(
    `select o.event_id, o.delivery_state::text, o.reconciliation_state::text,
            edge_sync.external_sync_status(o.delivery_state, o.reconciliation_state) as external_status,
            o.reconciliation_conflict_id, o.reconciliation_cleared_authority
       from edge_sync.outbox o where o.event_id = $1`,
    [eventId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    eventId: row.event_id,
    deliveryState: row.delivery_state,
    reconciliationState: row.reconciliation_state,
    externalStatus: row.external_status,
    conflictId: row.reconciliation_conflict_id,
    clearedAuthority: row.reconciliation_cleared_authority,
  };
}
