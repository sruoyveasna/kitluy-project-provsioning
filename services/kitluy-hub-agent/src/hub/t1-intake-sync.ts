/**
 * T002 Hub→cloud delivery and acknowledgment reconciliation — WS-12-T002-P02.
 *
 * The Hub side of the §10 loop. The authenticated Hub→cloud TRANSPORT
 * remains the recorded BLK-006 gap (exactly as for pairing receipts and
 * health reports), so the production carrier is absent by design; what IS
 * production-shaped here is everything around it:
 *
 *   listPendingT002Facts     — claim pending T002 outbox rows in
 *                              hub_sequence order (the WS-10 ordering rule).
 *   deliveryPayloadOf        — the versioned PUBLIC payload for one fact
 *                              (payload minimization: the stored envelope's
 *                              payload only, never internal columns).
 *   applyT002Acknowledgment  — the ONLY writer of T002 delivery truth:
 *                              outbox → acknowledged (cloud_ack_id +
 *                              acknowledged_at, the 0009 outbox_ack_ck
 *                              contract — no fabricated acknowledgment),
 *                              plus the domain writeback (customer/draft
 *                              sync_state). It never rewrites local ids,
 *                              local timestamps, snapshots or history; a
 *                              cancelled draft still takes its ack through
 *                              the 0041 sync-metadata carve-out.
 *
 * CONFLICT MAPPING (§10): CONFLICT (phone collision) → customer sync_state
 * 'conflict' — visible, never merged. POLICY_VERSION_UNKNOWN and other
 * governed refusals leave the outbox row PENDING (fail closed, retry when
 * policy exists) unless terminally classified. DUPLICATE_IGNORED is a
 * SUCCESS (the original effect stands). Temporary transport failure writes
 * nothing at all — the fact stays pending.
 */
import { withHubTransaction, HUB_RUNTIME_ROLE, type HubPool } from "./db.js";
import {
  BOOKING_DRAFT_EVENT_NAME,
  CONSENT_DECISION_EVENT_NAME,
  CUSTOMER_CREATED_EVENT_NAME,
} from "./t1-intake.js";

export const T002_EVENT_NAMES = [
  CUSTOMER_CREATED_EVENT_NAME,
  CONSENT_DECISION_EVENT_NAME,
  BOOKING_DRAFT_EVENT_NAME,
] as const;

export interface PendingT002Fact {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly effectKey: string;
  readonly hubSequence: bigint;
  readonly payload: Record<string, unknown>;
}

/** Pending T002 facts in hub_sequence order (never reordered). */
export async function listPendingT002Facts(
  pool: HubPool,
  limit = 50,
): Promise<readonly PendingT002Fact[]> {
  return withHubTransaction(
    pool,
    async (client) => {
      const { rows } = await client.query<{
        id: string;
        event_type: string;
        aggregate_type: string;
        aggregate_id: string;
        idempotency_key: string;
        hub_sequence: bigint;
        payload: Record<string, unknown>;
      }>(
        `select e.id, e.event_type, e.aggregate_type, e.aggregate_id,
                e.idempotency_key, o.hub_sequence, e.payload
           from edge_sync.outbox o
           join edge_sync.local_event e on e.id = o.event_id
          where o.delivery_state = 'pending'
            and e.event_type = any($1::text[])
          order by o.hub_sequence asc
          limit $2`,
        [[...T002_EVENT_NAMES], limit],
      );
      return rows.map((row) => ({
        eventId: row.id,
        eventType: row.event_type,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        effectKey: row.idempotency_key,
        hubSequence: row.hub_sequence,
        payload: row.payload,
      }));
    },
    HUB_RUNTIME_ROLE,
  );
}

/** The versioned PUBLIC payload of a stored fact (the envelope's payload —
 * exactly what the emitters published, nothing internal added). */
export function deliveryPayloadOf(fact: PendingT002Fact): Record<string, unknown> {
  const envelope = fact.payload as { readonly payload?: Record<string, unknown> };
  return envelope.payload ?? {};
}

/** The §10 acknowledgment shape the cloud consumer returns. */
export interface T002AcknowledgmentInput {
  readonly eventId: string;
  readonly effectKey: string;
  readonly aggregateId: string;
  readonly schemaVersion: number;
  readonly cloudResult: string;
  readonly cloudReferenceId: string | null;
  readonly acknowledgedAt: string;
  readonly correlationId: string;
}

export type T002AckApplication =
  | { readonly applied: true; readonly disposition: "acknowledged" | "pending_retry" }
  | { readonly applied: false; readonly reason: string };

/** Results that COMPLETE the delivery (the effect stands cloud-side). */
const ACK_SUCCESS = new Set([
  "APPLIED",
  "DUPLICATE_IGNORED",
  "ACKNOWLEDGED",
  "DECLINED_RECORDED",
  "WITHDRAWN_NO_GRANT",
  "CONFLICT",
  "PROJECTED",
  "STALE_RECORDED",
  "CONFLICT_QUARANTINED",
]);

/** Results that leave the fact PENDING for retry (fail-closed cloud state,
 * e.g. a consent policy version the owner has not published yet, or a
 * transient internal error). */
const ACK_RETRY = new Set(["POLICY_VERSION_UNKNOWN", "INTERNAL_ERROR"]);

export async function applyT002Acknowledgment(
  pool: HubPool,
  ack: T002AcknowledgmentInput,
): Promise<T002AckApplication> {
  return withHubTransaction(
    pool,
    async (client) => {
      const { rows } = await client.query<{
        id: string;
        event_type: string;
        aggregate_id: string;
        idempotency_key: string;
        delivery_state: string;
      }>(
        `select e.id, e.event_type, e.aggregate_id, e.idempotency_key, o.delivery_state
           from edge_sync.local_event e
           join edge_sync.outbox o on o.event_id = e.id
          where e.id = $1::uuid`,
        [ack.eventId],
      );
      const fact = rows[0];
      if (fact === undefined) {
        return { applied: false, reason: "no such outbox fact" };
      }
      // The acknowledgment must BIND the fact it claims to settle.
      if (fact.idempotency_key !== ack.effectKey || fact.aggregate_id !== ack.aggregateId) {
        return { applied: false, reason: "the acknowledgment does not bind this fact" };
      }
      if (fact.delivery_state === "acknowledged") {
        return { applied: true, disposition: "acknowledged" }; // idempotent
      }
      if (ACK_RETRY.has(ack.cloudResult)) {
        // Fail closed: the fact stays pending; nothing is rewritten.
        return { applied: true, disposition: "pending_retry" };
      }
      if (!ACK_SUCCESS.has(ack.cloudResult)) {
        return { applied: false, reason: `unrecognised cloud result ${ack.cloudResult}` };
      }

      // The 0009/A01 delivery-state machine forbids pending → acknowledged:
      // an acknowledgment REQUIRES a transmission attempt. The applier walks
      // the legal path — the delivery genuinely happened (the consumer just
      // returned its governed result), so recording the attempt is truthful.
      if (fact.delivery_state === "pending" || fact.delivery_state === "retry_wait") {
        await client.query(
          `update edge_sync.outbox
              set delivery_state = 'in_flight',
                  attempt_count = attempt_count + 1,
                  lease_id = gen_random_uuid(),
                  lease_owner = 't002-ack-applier',
                  leased_at = now(),
                  lease_expires_at = now() + interval '1 minute'
            where event_id = $1::uuid`,
          [ack.eventId],
        );
      }
      await client.query(
        `update edge_sync.outbox
            set delivery_state = 'acknowledged',
                cloud_ack_id = $2::uuid,
                acknowledged_at = $3::timestamptz,
                lease_id = null,
                lease_owner = null,
                leased_at = null,
                lease_expires_at = null
          where event_id = $1::uuid`,
        [ack.eventId, ack.correlationId, ack.acknowledgedAt],
      );

      // Domain writeback — sync metadata ONLY; never identity, timestamps,
      // snapshots or history (§10).
      if (fact.event_type === CUSTOMER_CREATED_EVENT_NAME) {
        if (ack.cloudResult === "CONFLICT") {
          await client.query(
            `update edge_core.customer set sync_state = 'conflict' where id = $1::uuid`,
            [fact.aggregate_id],
          );
        } else {
          await client.query(
            `update edge_core.customer
                set sync_state = 'cloud_acknowledged',
                    cloud_customer_id = coalesce($2::uuid, cloud_customer_id),
                    cloud_ack_id = $3::uuid,
                    cloud_acknowledged_at = $4::timestamptz
              where id = $1::uuid`,
            [ack.aggregateId, ack.cloudReferenceId, ack.correlationId, ack.acknowledgedAt],
          );
        }
      } else if (fact.event_type === BOOKING_DRAFT_EVENT_NAME) {
        // Rides the 0041 sync-metadata carve-out: any lifecycle, no
        // version advance, updated_at untouched.
        const nextState =
          ack.cloudResult === "CONFLICT_QUARANTINED" ? "conflict" : "cloud_acknowledged";
        await client.query(
          `update edge_laundry.booking_draft
              set sync_state = $2,
                  cloud_ack_id = $3::uuid,
                  cloud_acknowledged_at = $4::timestamptz
            where id = $1::uuid`,
          [ack.aggregateId, nextState, ack.correlationId, ack.acknowledgedAt],
        );
      }
      // Consent decisions are append-only facts with no sync column: the
      // outbox acknowledgment IS their delivery truth.
      return { applied: true, disposition: "acknowledged" };
    },
    HUB_RUNTIME_ROLE,
  );
}
