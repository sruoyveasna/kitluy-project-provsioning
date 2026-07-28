/**
 * WS-10-T004 — durable acknowledgement, rejection, retry/backoff and
 * dead-letter handling.
 *
 * Authority: Store Hub spec §11.5, schema contract §6.8 ("a dead letter is
 * never silently discarded"), owner amendment KLD-2026-07-28-001-A01 §2
 * (`rejected` is a DURABLE cloud rejection; no acknowledgement is fabricated)
 * and §3 (the delivery and conflict dimensions move independently).
 *
 * THE ROUTING DECISION lives in {@link classifyOutcome} and is pure, so the
 * question "could a transport failure ever be recorded as a cloud verdict?" is
 * answerable by reading one function rather than by tracing a worker loop. The
 * database refuses the same mistake independently: `reject_outbox_event` will
 * not accept a non-durable code, and `defer_outbox_event` will not accept a
 * durable one.
 */
import { randomUUID } from "node:crypto";
import type { HubClient } from "../db.js";
import { SyncDeliveryError, isDurableCloudRejection } from "./errors.js";
import type { CloudEventOutcome, SignedBatch } from "./transmission.js";

/**
 * OPERATIONAL defaults, not business policy.
 *
 * These bound how hard the Hub retries a cloud that is not answering. They are
 * deliberately NOT an offline authorization window: KLD-2026-07-28-001 Group 5
 * forbids inventing an offline grace period in code, and nothing here grants
 * any permission or extends any validity — an exhausted item stops being
 * retried and becomes an operator's problem, which is the opposite of granting
 * itself more time.
 */
export const DEFAULT_MAX_DELIVERY_ATTEMPTS = 8;
export const DEFAULT_BACKOFF_BASE_SECONDS = 5;
export const DEFAULT_BACKOFF_MAX_SECONDS = 900;

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseSeconds: number;
  readonly maxSeconds: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: DEFAULT_MAX_DELIVERY_ATTEMPTS,
  baseSeconds: DEFAULT_BACKOFF_BASE_SECONDS,
  maxSeconds: DEFAULT_BACKOFF_MAX_SECONDS,
};

export type DeliveryRouting =
  | { readonly kind: "acknowledge"; readonly cloudAckId: string }
  | { readonly kind: "reject"; readonly code: string; readonly reason: string }
  | { readonly kind: "defer"; readonly code: string }
  | { readonly kind: "dead_letter"; readonly code: string; readonly reason: string };

/**
 * Route ONE cloud outcome.
 *
 * FAILS TOWARD RETRY. An outcome the cloud reported as applied but WITHOUT its
 * acknowledgement identity is deferred, not acknowledged: recording an
 * acknowledgement the cloud did not identify would be fabricating one. An
 * unclassified rejection code is likewise deferred rather than being promoted
 * to a durable verdict.
 *
 * Exhaustion is checked LAST and only for outcomes that would otherwise retry:
 * a durable rejection is a final answer regardless of how many attempts it
 * took, and an acknowledgement is never overridden by an attempt count.
 */
export function classifyOutcome(
  outcome: CloudEventOutcome,
  attemptCount: number,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): DeliveryRouting {
  if (outcome.outcome === "applied" || outcome.outcome === "duplicate_ignored") {
    if (typeof outcome.cloudAckId === "string" && outcome.cloudAckId.length > 0) {
      return { kind: "acknowledge", cloudAckId: outcome.cloudAckId };
    }
    return { kind: "defer", code: "EDGE_ACK_IDENTITY_MISSING" };
  }

  const code = outcome.rejectionCode ?? "EDGE_TRANSPORT_INTERRUPTED";
  if (isDurableCloudRejection(code)) {
    return {
      kind: "reject",
      code,
      reason: outcome.rejectionReason ?? "The cloud durably rejected this effect.",
    };
  }

  if (attemptCount >= policy.maxAttempts) {
    return {
      kind: "dead_letter",
      code,
      reason:
        `Delivery exhausted after ${attemptCount} attempt(s); last transport outcome '${code}'. ` +
        "No cloud verdict was ever observed, so none is recorded.",
    };
  }
  return { kind: "defer", code };
}

export interface OutcomeApplication {
  readonly eventId: string;
  readonly routing: DeliveryRouting["kind"];
  readonly changed: boolean;
  readonly nextAttemptAt?: Date;
}

/**
 * Apply one routed outcome to the outbox.
 *
 * `conflictFactory` is only invoked on the dead-letter path, and it must create
 * the `edge_sync.sync_conflict` row that NAMES the divergence — the dead-letter
 * procedure refuses to raise reconciliation against a conflict that does not
 * exist, so an item can never be dead-lettered into silence.
 */
export async function applyOutcome(
  client: HubClient,
  input: {
    readonly eventId: string;
    readonly leaseId: string;
    readonly routing: DeliveryRouting;
    readonly policy?: RetryPolicy;
    readonly conflictFactory?: (eventId: string, reason: string) => Promise<string>;
  },
): Promise<OutcomeApplication> {
  const policy = input.policy ?? DEFAULT_RETRY_POLICY;
  const { routing } = input;

  switch (routing.kind) {
    case "acknowledge": {
      const result = await client.query<{ acknowledge_outbox_event: boolean }>(
        `select edge_sync.acknowledge_outbox_event($1::uuid, $2::uuid, $3::text)`,
        [input.eventId, input.leaseId, routing.cloudAckId],
      );
      return {
        eventId: input.eventId,
        routing: "acknowledge",
        changed: result.rows[0]?.acknowledge_outbox_event === true,
      };
    }
    case "reject": {
      const result = await client.query<{ reject_outbox_event: boolean }>(
        `select edge_sync.reject_outbox_event($1::uuid, $2::uuid, $3::text, $4::text)`,
        [input.eventId, input.leaseId, routing.code, routing.reason],
      );
      return {
        eventId: input.eventId,
        routing: "reject",
        changed: result.rows[0]?.reject_outbox_event === true,
      };
    }
    case "defer": {
      const result = await client.query<{ defer_outbox_event: Date }>(
        `select edge_sync.defer_outbox_event($1::uuid, $2::uuid, $3::text, $4::integer, $5::integer)`,
        [input.eventId, input.leaseId, routing.code, policy.baseSeconds, policy.maxSeconds],
      );
      return {
        eventId: input.eventId,
        routing: "defer",
        changed: true,
        nextAttemptAt: result.rows[0]!.defer_outbox_event,
      };
    }
    case "dead_letter": {
      if (!input.conflictFactory) {
        throw new SyncDeliveryError(
          "EDGE_REPAIR_NOT_AUTHORIZED",
          "Dead-lettering requires a conflict record naming the divergence; a dead letter with nothing to act on is a silent discard (§6.8).",
          { eventId: input.eventId },
        );
      }
      const conflictId = await input.conflictFactory(input.eventId, routing.reason);
      const result = await client.query<{ dead_letter_outbox_event: boolean }>(
        `select edge_sync.dead_letter_outbox_event($1::uuid, $2::uuid, $3::text, $4::text, $5::uuid)`,
        [input.eventId, input.leaseId, routing.reason, routing.code, conflictId],
      );
      return {
        eventId: input.eventId,
        routing: "dead_letter",
        changed: result.rows[0]?.dead_letter_outbox_event === true,
      };
    }
  }
}

/**
 * Create the `sync_conflict` a dead letter must name.
 *
 * `data_class` follows Hub §11.4, so the conflict inherits the right policy —
 * a finance or custody divergence can never be swept up by a generic
 * last-write-wins rule later.
 */
export async function recordDeliveryConflict(
  client: HubClient,
  input: {
    readonly eventId: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly locationId: string;
    readonly dataClass: string;
    readonly reason: string;
  },
): Promise<string> {
  const id = randomUUID();
  await client.query(
    `insert into edge_sync.sync_conflict
       (id, tenant_id, digital_store_id, location_id, conflict_type, data_class,
        local_event_id, detected_at, state, severity, local_summary)
     values ($1, $2, $3, $4, 'delivery_exhausted', $5, $6, now(), 'operator_required', 'high',
             jsonb_build_object('reason', $7::text))`,
    [
      id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.dataClass,
      input.eventId,
      input.reason,
    ],
  );
  return id;
}

/** Advance the stream cursor. Monotonic, and only on progress that happened. */
export async function advanceSyncCursor(
  client: HubClient,
  input: {
    readonly locationId: string;
    readonly streamCode: string;
    readonly pushed?: bigint;
    readonly acked?: bigint;
  },
): Promise<void> {
  await client.query(
    `select edge_sync.advance_sync_cursor($1::uuid, $2::text, $3::bigint, $4::bigint)`,
    [
      input.locationId,
      input.streamCode,
      input.pushed?.toString() ?? null,
      input.acked?.toString() ?? null,
    ],
  );
}

/**
 * Complete the transmission ledger row for an ANSWERED batch.
 *
 * The tally is derived from the outcomes actually recorded, not from what the
 * cloud claimed in aggregate; the 0017 `transmission_batch_answered_ck` refuses
 * a tally that does not add up to what was sent.
 */
export async function completeTransmissionBatch(
  client: HubClient,
  input: {
    readonly batchId: string;
    readonly cloudBatchId: string;
    readonly outcomes: readonly CloudEventOutcome[];
  },
): Promise<void> {
  if (!input.cloudBatchId) {
    throw new SyncDeliveryError(
      "EDGE_ACK_IDENTITY_MISSING",
      "A batch cannot be completed as answered without the cloud's own batch identity.",
      { batchId: input.batchId },
    );
  }
  const applied = input.outcomes.filter((o) => o.outcome === "applied").length;
  const duplicates = input.outcomes.filter((o) => o.outcome === "duplicate_ignored").length;
  const rejected = input.outcomes.filter((o) => o.outcome === "rejected").length;

  await client.query(
    `update edge_sync.transmission_batch
        set outcome = 'answered', cloud_batch_id = $2, completed_at = now(),
            applied_count = $3, duplicate_count = $4, rejected_count = $5
      where id = $1`,
    [input.batchId, input.cloudBatchId, applied, duplicates, rejected],
  );

  for (const outcome of input.outcomes) {
    await client.query(
      `update edge_sync.transmission_batch_item
          set outcome = $3, cloud_ack_id = $4, rejection_code = $5
        where batch_id = $1 and event_id = $2`,
      [
        input.batchId,
        outcome.eventId,
        outcome.outcome,
        outcome.cloudAckId ?? null,
        outcome.rejectionCode ?? null,
      ],
    );
  }
}

/**
 * Apply an entire cloud response: route every outcome, then advance the cursor
 * to the highest CONTIGUOUSLY acknowledged sequence.
 *
 * "Contiguously" matters. If sequences 10, 11 and 12 were sent and 11 was
 * rejected, the acknowledged cursor stops at 10 — moving it to 12 would claim
 * the stream is acknowledged through a point it is not, and a later recovery
 * would skip 11 entirely.
 */
export async function applyBatchResponse(
  client: HubClient,
  input: {
    readonly batch: SignedBatch;
    readonly leaseId: string;
    readonly cloudBatchId: string;
    readonly outcomes: readonly CloudEventOutcome[];
    readonly attemptCounts: ReadonlyMap<string, number>;
    readonly streamCode: string;
    readonly policy?: RetryPolicy;
    readonly conflictFactory?: (eventId: string, reason: string) => Promise<string>;
  },
): Promise<readonly OutcomeApplication[]> {
  const applications: OutcomeApplication[] = [];
  const acknowledged = new Set<string>();

  for (const outcome of input.outcomes) {
    const routing = classifyOutcome(
      outcome,
      input.attemptCounts.get(outcome.eventId) ?? 1,
      input.policy,
    );
    applications.push(
      await applyOutcome(client, {
        eventId: outcome.eventId,
        leaseId: input.leaseId,
        routing,
        ...(input.policy ? { policy: input.policy } : {}),
        ...(input.conflictFactory ? { conflictFactory: input.conflictFactory } : {}),
      }),
    );
    if (routing.kind === "acknowledge") acknowledged.add(outcome.eventId);
  }

  await completeTransmissionBatch(client, {
    batchId: input.batch.manifest.batchId,
    cloudBatchId: input.cloudBatchId,
    outcomes: input.outcomes,
  });

  let contiguousAck: bigint | undefined;
  for (const item of input.batch.manifest.items) {
    if (!acknowledged.has(item.eventId)) break;
    contiguousAck = BigInt(item.hubSequence);
  }

  await advanceSyncCursor(client, {
    locationId: input.batch.manifest.locationId,
    streamCode: input.streamCode,
    pushed: BigInt(input.batch.manifest.lastHubSequence),
    ...(contiguousAck !== undefined ? { acked: contiguousAck } : {}),
  });

  return applications;
}
