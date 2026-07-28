/**
 * WS-10-T003 — idempotent cloud ingestion of a signed Hub batch.
 *
 * Authority: Store Hub spec §11.5 (per-event results), §11.4 (per-data-class
 * conflict policy — no generic last-write-wins), owner decision
 * KLD-2026-07-28-001 Group 6 (KLREQ-026: the dedupe key is the Hub-issued
 * `kh1.{command_result_uuid}.{event_ordinal}`, deterministic across replay) and
 * amendment KLD-2026-07-28-001-A01 §2 (a rejection recorded here is DURABLE; a
 * transport failure is never one).
 *
 * PURE BY DESIGN. Signature verification, the already-ingested lookup, the
 * acknowledgement-id minting and the business application are all INJECTED. The
 * decision this module makes — apply, duplicate, or durably reject — is then
 * testable without a database, a network or a key, and the same decision runs
 * in production against the real ports.
 *
 * THE ORDER OF CHECKS IS THE CONTRACT:
 *   1. verify the signature. An unverified batch applies NOTHING — not even
 *      the events that would have been fine. Partial application of an
 *      unauthenticated batch is how a forged tail rides in on a genuine head.
 *   2. check the declared ordering. Out-of-order items mean the Hub's own
 *      guarantee is broken, and applying them would commit to an order the Hub
 *      cannot reproduce.
 *   3. per event: malformed key -> durable rejection; already ingested ->
 *      return the ORIGINAL outcome; otherwise apply.
 */

/** Disjoint by prefix, exactly as the Hub emits them (KLREQ-020 / KLREQ-026). */
const EFFECT_KEY_PATTERN =
  /^kh1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,10}$/;
const TERMINAL_KEY_PATTERN =
  /^kl1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,20}$/;

export function isIngestibleEffectKey(key: string): boolean {
  return EFFECT_KEY_PATTERN.test(key) || TERMINAL_KEY_PATTERN.test(key);
}

export interface IncomingBatchItem {
  readonly eventId: string;
  /** Decimal string: a hub_sequence past 2^53 must survive the wire exactly. */
  readonly hubSequence: string;
  readonly idempotencyKey: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: string;
  readonly occurredAt: string;
  readonly payloadSha256: string;
}

export interface IncomingBatch {
  readonly envelopeVersion: number;
  readonly batchId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly leaseId: string;
  readonly itemCount: number;
  readonly firstHubSequence: string;
  readonly lastHubSequence: string;
  readonly knownGaps: readonly string[];
  readonly items: readonly IncomingBatchItem[];
}

export interface IngestedEffect {
  readonly effectKey: string;
  readonly cloudAckId: string;
  readonly status: "APPLIED" | "REJECTED";
  readonly rejectionCode?: string;
}

export type EventOutcome = "applied" | "duplicate_ignored" | "rejected";

export interface EventResult {
  readonly eventId: string;
  readonly outcome: EventOutcome;
  readonly cloudAckId?: string;
  readonly rejectionCode?: string;
  readonly rejectionReason?: string;
}

export interface BatchIngestionResult {
  readonly batchId: string;
  readonly cloudBatchId: string;
  readonly status: "APPLIED" | "REJECTED";
  readonly signatureVerified: boolean;
  readonly results: readonly EventResult[];
  readonly appliedCount: number;
  readonly duplicateCount: number;
  readonly rejectedCount: number;
  /** Set when the WHOLE batch was refused before any event was considered. */
  readonly batchRejectionCode?: string;
}

/**
 * Applying one effect to cloud business truth. A thrown error is treated as a
 * DURABLE rejection only when the port says so — see {@link ApplyOutcome} — so
 * an infrastructure failure can never be recorded as "the cloud said no".
 */
export type ApplyOutcome =
  | { readonly kind: "applied" }
  | { readonly kind: "rejected"; readonly code: string; readonly reason: string };

export interface IngestionPorts {
  /** Verify the batch signature over the canonical manifest bytes. */
  verifySignature(batch: IncomingBatch): boolean | Promise<boolean>;
  /** The already-ingested effect for this Location, if any. */
  findIngested(
    locationId: string,
    effectKey: string,
  ): (IngestedEffect | undefined) | Promise<IngestedEffect | undefined>;
  /** Mint the CLOUD acknowledgement identity. Never supplied by the Hub. */
  mintCloudAckId(): string | Promise<string>;
  /** Apply one effect to cloud business truth. */
  apply(batch: IncomingBatch, item: IncomingBatchItem): ApplyOutcome | Promise<ApplyOutcome>;
  /** Record the ingestion decision durably (sync_batches / sync_inbox). */
  record(
    batch: IncomingBatch,
    item: IncomingBatchItem,
    effect: IngestedEffect,
  ): void | Promise<void>;
}

function tally(results: readonly EventResult[]) {
  return {
    appliedCount: results.filter((r) => r.outcome === "applied").length,
    duplicateCount: results.filter((r) => r.outcome === "duplicate_ignored").length,
    rejectedCount: results.filter((r) => r.outcome === "rejected").length,
  };
}

function orderingProblem(batch: IncomingBatch): string | undefined {
  if (batch.items.length !== batch.itemCount) {
    return `itemCount ${batch.itemCount} does not match ${batch.items.length} item(s)`;
  }
  if (batch.items.length === 0) return "batch carries no items";
  let previous: bigint | undefined;
  for (const item of batch.items) {
    let sequence: bigint;
    try {
      sequence = BigInt(item.hubSequence);
    } catch {
      return `hub_sequence '${item.hubSequence}' is not an integer`;
    }
    if (previous !== undefined && sequence <= previous) {
      return `hub_sequence ${sequence} does not increase past ${previous}`;
    }
    previous = sequence;
  }
  const first = BigInt(batch.firstHubSequence);
  const last = BigInt(batch.lastHubSequence);
  if (BigInt(batch.items[0]!.hubSequence) !== first) {
    return `declared firstHubSequence ${first} is not the first item`;
  }
  if (BigInt(batch.items[batch.items.length - 1]!.hubSequence) !== last) {
    return `declared lastHubSequence ${last} is not the last item`;
  }
  return undefined;
}

/**
 * Ingest one signed batch.
 *
 * The returned `cloudBatchId` is the cloud's own identity for this ingestion;
 * the Hub records it and never mints one itself, so an acknowledgement in the
 * Hub's ledger always traces to a real cloud decision.
 */
export async function ingestBatch(
  batch: IncomingBatch,
  ports: IngestionPorts,
  cloudBatchId: string,
): Promise<BatchIngestionResult> {
  const signatureVerified = await ports.verifySignature(batch);
  if (!signatureVerified) {
    // NOTHING is applied and NOTHING is recorded as an effect. Every item is
    // reported as a durable rejection so the Hub stops retrying a batch that
    // will never be accepted in this form.
    const results = batch.items.map((item): EventResult => ({
      eventId: item.eventId,
      outcome: "rejected",
      rejectionCode: "EDGE_CLOUD_REJECTED_SIGNATURE",
      rejectionReason: "The batch signature did not verify; no item was applied.",
    }));
    return {
      batchId: batch.batchId,
      cloudBatchId,
      status: "REJECTED",
      signatureVerified: false,
      results,
      ...tally(results),
      batchRejectionCode: "EDGE_CLOUD_REJECTED_SIGNATURE",
    };
  }

  const ordering = orderingProblem(batch);
  if (ordering !== undefined) {
    const results = batch.items.map((item): EventResult => ({
      eventId: item.eventId,
      outcome: "rejected",
      rejectionCode: "EDGE_CLOUD_REJECTED_SCHEMA",
      rejectionReason: `Batch ordering is not what the Hub guarantees: ${ordering}.`,
    }));
    return {
      batchId: batch.batchId,
      cloudBatchId,
      status: "REJECTED",
      signatureVerified: true,
      results,
      ...tally(results),
      batchRejectionCode: "EDGE_CLOUD_REJECTED_SCHEMA",
    };
  }

  const results: EventResult[] = [];
  for (const item of batch.items) {
    if (!isIngestibleEffectKey(item.idempotencyKey)) {
      // Unshaped keys are DURABLY rejected: retrying will not reshape them, and
      // ingesting one would create an effect identity nothing can dedupe on.
      results.push({
        eventId: item.eventId,
        outcome: "rejected",
        rejectionCode: "EDGE_CLOUD_REJECTED_SCHEMA",
        rejectionReason: `Effect key '${item.idempotencyKey}' is neither the kh1 nor the kl1 namespace (KLREQ-026).`,
      });
      continue;
    }

    const existing = await ports.findIngested(batch.locationId, item.idempotencyKey);
    if (existing !== undefined) {
      // REPLAY. The original outcome is re-reported verbatim, including the
      // original acknowledgement identity, so the Hub records the same cloud
      // fact it would have recorded the first time and nothing is applied twice.
      results.push(
        existing.status === "APPLIED"
          ? {
              eventId: item.eventId,
              outcome: "duplicate_ignored",
              cloudAckId: existing.cloudAckId,
            }
          : {
              eventId: item.eventId,
              outcome: "rejected",
              rejectionCode: existing.rejectionCode ?? "EDGE_CLOUD_REJECTED_PERMANENT",
              rejectionReason: "Previously rejected; the outcome is unchanged on replay.",
            },
      );
      continue;
    }

    const outcome = await ports.apply(batch, item);
    const cloudAckId = await ports.mintCloudAckId();
    const effect: IngestedEffect =
      outcome.kind === "applied"
        ? { effectKey: item.idempotencyKey, cloudAckId, status: "APPLIED" }
        : {
            effectKey: item.idempotencyKey,
            cloudAckId,
            status: "REJECTED",
            rejectionCode: outcome.code,
          };
    await ports.record(batch, item, effect);
    results.push(
      outcome.kind === "applied"
        ? { eventId: item.eventId, outcome: "applied", cloudAckId }
        : {
            eventId: item.eventId,
            outcome: "rejected",
            rejectionCode: outcome.code,
            rejectionReason: outcome.reason,
          },
    );
  }

  const counts = tally(results);
  return {
    batchId: batch.batchId,
    cloudBatchId,
    // A batch is APPLIED when it was authentic and ordered, even if individual
    // effects were durably rejected: the batch itself was processed. Per-event
    // truth stays in the per-event results.
    status: "APPLIED",
    signatureVerified: true,
    results,
    ...counts,
  };
}
