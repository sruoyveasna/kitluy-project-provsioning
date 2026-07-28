/**
 * WS-10-T002 — signed Hub-to-cloud transmission.
 *
 * Authority: Store Hub spec §11.5 (push ordering and per-event results),
 * offline contract §5 (the sequence-gap ledger: a journalled burnt value is a
 * KNOWN gap and is never sent as a missing event) and §5.1 (the ordering
 * namespace), owner amendment KLD-2026-07-28-001-A01 §2.
 *
 * WHAT IS SIGNED. The signature covers the canonical JSON MANIFEST, not the
 * payloads: the manifest names the Hub, the Location, the assignment
 * generation, the DECLARED first/last actual `hub_sequence`, the declared known
 * gaps, and the per-item digest of every event. Because each item digest is the
 * event's own `payload_sha256`, altering any payload invalidates the manifest
 * hash and therefore the signature, while the manifest itself stays small
 * enough to log and audit without carrying business data.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../../hub-database.js";
import type { HubClient } from "../db.js";
// The SAME digest function the WS-09 command layer used to write
// `local_event.payload_sha256`. Recomputing it a second way here would make a
// mismatch mean "two hashers disagree" instead of "the payload changed".
import { payloadChecksum } from "../outbox.js";
import { SyncDeliveryError } from "./errors.js";
import type { BatchSignature, HubBatchSigner } from "./signing.js";
import type { OutboxLease, OutboxLeaseItem } from "./outbox-lease.js";

/** Wire version of the batch envelope. Bumped only by a governed change. */
export const BATCH_ENVELOPE_VERSION = 1;

export interface BatchItemDescriptor {
  readonly eventId: string;
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

export interface BatchManifest {
  readonly envelopeVersion: number;
  readonly batchId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly assignmentGeneration: number;
  readonly leaseId: string;
  readonly itemCount: number;
  /** The FIRST and LAST sequence actually present in this batch. */
  readonly firstHubSequence: string;
  readonly lastHubSequence: string;
  /**
   * Burnt sequences journalled in `edge_sync.sequence_gap` inside the declared
   * range. DECLARED so the cloud can tell a known gap from a missing event
   * (offline contract §5) — never inferred from what happens to be absent.
   */
  readonly knownGaps: readonly string[];
  readonly items: readonly BatchItemDescriptor[];
}

export interface SignedBatch {
  readonly manifest: BatchManifest;
  /** RFC 8785-canonical JSON of `manifest`; the exact bytes that were signed. */
  readonly canonicalManifest: string;
  readonly manifestSha256: string;
  readonly signature: BatchSignature;
  /** Payloads travel beside the manifest, bound to it by their digests. */
  readonly payloads: ReadonlyMap<string, Record<string, unknown>>;
}

/**
 * Read the journalled sequence gaps inside `[first, last]` for one stream.
 *
 * The Hub DECLARES its gaps. A cloud that had to infer them would have to
 * choose between "assume absent means burnt" (which hides real data loss) and
 * "assume absent means missing" (which raises a false alarm on every
 * rolled-back command).
 */
export async function readKnownGaps(
  client: HubClient,
  locationId: string,
  assignmentGeneration: number,
  firstHubSequence: bigint,
  lastHubSequence: bigint,
): Promise<readonly bigint[]> {
  const result = await client.query<{ hub_sequence: bigint }>(
    `select hub_sequence
       from edge_sync.sequence_gap
      where location_id = $1 and assignment_generation = $2
        and hub_sequence between $3::bigint and $4::bigint
      order by hub_sequence`,
    [locationId, assignmentGeneration, firstHubSequence.toString(), lastHubSequence.toString()],
  );
  return result.rows.map((r) => r.hub_sequence);
}

function describeItem(item: OutboxLeaseItem): BatchItemDescriptor {
  return {
    eventId: item.eventId,
    hubSequence: item.hubSequence.toString(),
    idempotencyKey: item.idempotencyKey,
    eventType: item.eventType,
    schemaVersion: item.schemaVersion,
    aggregateType: item.aggregateType,
    aggregateId: item.aggregateId,
    aggregateVersion: item.aggregateVersion.toString(),
    occurredAt: item.occurredAt.toISOString(),
    payloadSha256: item.payloadSha256,
  };
}

/**
 * Build the manifest for a leased batch.
 *
 * Every bigint is rendered as a decimal STRING. JSON numbers are IEEE-754
 * doubles, so a `hub_sequence` past 2^53 would be silently rounded on the wire
 * and two distinct events could arrive claiming the same position.
 */
export function buildBatchManifest(input: {
  readonly batchId: string;
  readonly lease: OutboxLease;
  readonly knownGaps: readonly bigint[];
}): BatchManifest {
  const items = input.lease.items;
  if (items.length === 0) {
    throw new SyncDeliveryError(
      "EDGE_BATCH_ORDERING_VIOLATION",
      "An empty batch is not transmitted: there is nothing for the cloud to acknowledge.",
    );
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  return {
    envelopeVersion: BATCH_ENVELOPE_VERSION,
    batchId: input.batchId,
    tenantId: first.tenantId,
    digitalStoreId: first.digitalStoreId,
    locationId: first.locationId,
    assignmentGeneration: input.lease.assignmentGeneration,
    leaseId: input.lease.leaseId,
    itemCount: items.length,
    firstHubSequence: first.hubSequence.toString(),
    lastHubSequence: last.hubSequence.toString(),
    knownGaps: input.knownGaps.map(String),
    items: items.map(describeItem),
  };
}

/**
 * Verify each payload against the digest the manifest declares, then sign.
 *
 * The digest check runs BEFORE signing on purpose: signing a manifest whose
 * digests do not match the payloads being shipped would produce a valid
 * signature over a lie.
 */
export function signBatch(
  manifest: BatchManifest,
  payloads: ReadonlyMap<string, Record<string, unknown>>,
  signer: HubBatchSigner,
): SignedBatch {
  for (const item of manifest.items) {
    const payload = payloads.get(item.eventId);
    if (payload === undefined) {
      throw new SyncDeliveryError("EDGE_PAYLOAD_HASH_MISMATCH", `No payload for ${item.eventId}.`, {
        eventId: item.eventId,
      });
    }
    const actual = payloadChecksum(payload);
    if (actual !== item.payloadSha256) {
      throw new SyncDeliveryError(
        "EDGE_PAYLOAD_HASH_MISMATCH",
        `Payload digest for ${item.eventId} does not match the manifest.`,
        { eventId: item.eventId, declared: item.payloadSha256, actual },
      );
    }
  }

  const canonicalManifest = canonicalJson(manifest);
  return {
    manifest,
    canonicalManifest,
    manifestSha256: createHash("sha256").update(canonicalManifest, "utf8").digest("hex"),
    signature: signer.sign(canonicalManifest),
    payloads,
  };
}

/**
 * Assemble and sign the batch for a lease.
 *
 * NOTE ON PAYLOAD DIGESTS. The digests stored on `edge_sync.local_event` are
 * computed by the WS-09 command layer over its own canonical payload bytes.
 * When a stored digest disagrees with the payload this function is handed, that
 * is a local integrity problem and it is surfaced as one — the batch is refused
 * rather than transmitted with a digest nobody can reproduce.
 */
export async function prepareSignedBatch(
  client: HubClient,
  input: {
    readonly batchId: string;
    readonly lease: OutboxLease;
    readonly signer: HubBatchSigner;
  },
): Promise<SignedBatch> {
  const items = input.lease.items;
  if (items.length === 0) {
    throw new SyncDeliveryError(
      "EDGE_BATCH_ORDERING_VIOLATION",
      "An empty batch is not transmitted: there is nothing for the cloud to acknowledge.",
    );
  }
  const knownGaps = await readKnownGaps(
    client,
    input.lease.locationId,
    input.lease.assignmentGeneration,
    items[0]!.hubSequence,
    items[items.length - 1]!.hubSequence,
  );
  const manifest = buildBatchManifest({
    batchId: input.batchId,
    lease: input.lease,
    knownGaps,
  });
  const payloads = new Map<string, Record<string, unknown>>(
    items.map((item) => [item.eventId, item.payload]),
  );
  return signBatch(manifest, payloads, input.signer);
}

/**
 * Sequences inside the declared range that are neither present nor declared as
 * known gaps. A non-empty result is REAL data loss and must never be treated as
 * a rounding detail.
 */
export function unexplainedSequences(manifest: BatchManifest): readonly string[] {
  const present = new Set(manifest.items.map((i) => i.hubSequence));
  const gaps = new Set(manifest.knownGaps);
  const missing: string[] = [];
  const first = BigInt(manifest.firstHubSequence);
  const last = BigInt(manifest.lastHubSequence);
  for (let s = first; s <= last; s += 1n) {
    const key = s.toString();
    if (!present.has(key) && !gaps.has(key)) missing.push(key);
  }
  return missing;
}

/**
 * Record WHAT was signed, before it is sent.
 *
 * Written first on purpose: if the Hub crashes between sending and hearing
 * back, the evidence that a push happened must already be durable. Recording it
 * afterwards would make a lost response indistinguishable from a push that
 * never occurred.
 */
export async function recordTransmissionBatch(
  client: HubClient,
  batch: SignedBatch,
  leaseOwner: string,
): Promise<void> {
  const m = batch.manifest;
  await client.query(
    `insert into edge_sync.transmission_batch
       (id, tenant_id, digital_store_id, location_id, assignment_generation, lease_id,
        lease_owner, envelope_version, item_count, first_hub_sequence, last_hub_sequence,
        known_gap_count, manifest_sha256, signature_algorithm, signing_key_id, signature,
        sent_at, outcome)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint, $11::bigint, $12, $13, $14, $15,
             decode($16, 'base64'), now(), 'in_flight')`,
    [
      m.batchId,
      m.tenantId,
      m.digitalStoreId,
      m.locationId,
      m.assignmentGeneration,
      m.leaseId,
      leaseOwner,
      m.envelopeVersion,
      m.itemCount,
      m.firstHubSequence,
      m.lastHubSequence,
      m.knownGaps.length,
      batch.manifestSha256,
      batch.signature.algorithm,
      batch.signature.keyId,
      batch.signature.signature,
    ],
  );
  for (const item of m.items) {
    await client.query(
      `insert into edge_sync.transmission_batch_item (batch_id, event_id, hub_sequence)
       values ($1, $2, $3::bigint)`,
      [m.batchId, item.eventId, item.hubSequence],
    );
  }
}

/**
 * Record that a transmission FAILED LOCALLY — no cloud response was observed.
 * The batch keeps no cloud identity, so this can never later be mistaken for an
 * answer (0017 `transmission_batch_failed_ck`).
 */
export async function failTransmissionBatch(
  client: HubClient,
  batchId: string,
  failureCode: string,
): Promise<void> {
  await client.query(
    `update edge_sync.transmission_batch
        set outcome = 'failed', failure_code = $2, completed_at = now()
      where id = $1`,
    [batchId, failureCode],
  );
}

/** The outbound transport. Production is mTLS outbound to the cloud sync service. */
export interface SignedBatchTransport {
  send(batch: SignedBatch): Promise<CloudBatchResponse>;
}

export interface CloudEventOutcome {
  readonly eventId: string;
  readonly outcome: "applied" | "duplicate_ignored" | "rejected";
  readonly cloudAckId?: string;
  readonly rejectionCode?: string;
  readonly rejectionReason?: string;
}

export interface CloudBatchResponse {
  readonly batchId: string;
  /** The cloud's own identity for this ingestion. Never minted by the Hub. */
  readonly cloudBatchId: string;
  readonly results: readonly CloudEventOutcome[];
}

/**
 * A response is only usable if it answers THIS batch and every item in it.
 *
 * A partial response is refused rather than partially applied: silently
 * treating an unmentioned event as "still pending" would be fine, but treating
 * it as anything else would invent a cloud outcome, and the two are easy to
 * confuse once a partial response is accepted at all.
 */
export function assertResponseCoversBatch(batch: SignedBatch, response: CloudBatchResponse): void {
  if (response.batchId !== batch.manifest.batchId) {
    throw new SyncDeliveryError(
      "EDGE_ACK_UNMATCHED_LEASE",
      `Response is for batch ${response.batchId}, not ${batch.manifest.batchId}.`,
    );
  }
  if (!response.cloudBatchId) {
    throw new SyncDeliveryError(
      "EDGE_ACK_IDENTITY_MISSING",
      "The cloud response carries no cloud batch identity; the Hub does not mint one.",
    );
  }
  const answered = new Set(response.results.map((r) => r.eventId));
  const unanswered = batch.manifest.items.filter((i) => !answered.has(i.eventId));
  if (unanswered.length > 0) {
    throw new SyncDeliveryError(
      "EDGE_ACK_UNMATCHED_LEASE",
      `The cloud response leaves ${unanswered.length} of ${batch.manifest.items.length} item(s) unanswered.`,
      { unanswered: unanswered.map((i) => i.eventId) },
    );
  }
  const unknown = response.results.filter(
    (r) => !batch.manifest.items.some((i) => i.eventId === r.eventId),
  );
  if (unknown.length > 0) {
    throw new SyncDeliveryError(
      "EDGE_ACK_UNMATCHED_LEASE",
      `The cloud response mentions ${unknown.length} event(s) this batch never sent.`,
      { unknown: unknown.map((r) => r.eventId) },
    );
  }
}
