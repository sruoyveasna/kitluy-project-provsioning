/**
 * @kitluy/sync-protocol — edge sync vocabulary, key namespaces, delivery-state
 * mapping and batch ordering.
 *
 * Source authority:
 *   - Store Hub spec §11.2 (outbox in the same local transaction), §11.4
 *     (per-data-class conflict policy — no generic last-write-wins for
 *     payment, inventory, finance, custody or audit truth), §11.5 (push
 *     ordering).
 *   - `kitluy-offline-idempotency-and-sequencing-v1.0.0.md` §2 (terminal
 *     idempotency key), §5/§5.1 (Hub sequence and ordering namespace).
 *   - Owner decision **KLD-2026-07-28-001** Group 1 (KLREQ-020): the canonical
 *     terminal key is `kl1.{terminal_device_uuid}.{terminal_client_sequence}`;
 *     Group 6 (KLREQ-026): Hub-issued multi-event effects use
 *     `kh1.{command_result_uuid}.{event_ordinal}`.
 *   - Owner amendment **KLD-2026-07-28-001-A01** §2/§3/§4: the aligned
 *     delivery states, the orthogonal conflict dimension, and ONE shared
 *     external-status mapping with conflict override first.
 *
 * CORRECTION RECORD (KLREQ-020, executed in Cycle 9 / WS-10-T002 as the
 * governed task the decision required). This module previously emitted
 * `location:{location_id}:hub:{hub_id}:seq:{n}` and mis-cited the Hub spec as
 * its source. That form is REJECTED: it is Hub-issued, so two terminals could
 * not be told apart and a Hub replacement would restart the namespace. The
 * canonical key is TERMINAL-issued. No runtime alias for the old shape is
 * provided — no production or pilot deployment exists, so an alias would only
 * preserve the mistake. The Hub database CHECKs the canonical shape on every
 * relation that stores a key, so the old form cannot be persisted either.
 *
 * `OutboxItemState` is likewise RETIRED (KLD-2026-07-28-001 Group 2): its
 * values `dispatching` and `retrying` never existed in the persisted
 * `edge_sync.delivery_state` enum, so it was a third vocabulary for a subject
 * that already had two.
 */

// ---------------------------------------------------------------------------
// Conflict policy (Hub spec §11.4).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Key namespaces.
//
// The two namespaces are DISJOINT BY PREFIX and must stay that way: a
// Hub-generated effect must never be able to claim it was a terminal command
// (KLREQ-026), and Hub jobs, cloud deliveries and provider events use their own
// namespaces rather than impersonating `kl1.*` (KLREQ-020).
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Offline contract §2: `kl1.{terminal_device_uuid}.{terminal_client_sequence}`. */
export const TERMINAL_KEY_PATTERN =
  /^kl1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,20}$/;

/** KLREQ-026: `kh1.{command_result_uuid}.{event_ordinal}`. */
export const HUB_EFFECT_KEY_PATTERN =
  /^kh1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,10}$/;

/** Unsigned 64-bit ceiling for the terminal client sequence (offline §2). */
export const MAX_CLIENT_SEQUENCE = 18446744073709551615n;

/**
 * Build the canonical TERMINAL-issued idempotency key.
 *
 * The sequence is `bigint`, not `number`: it is an unsigned 64-bit counter, and
 * silently losing precision past 2^53 would let two distinct commands share a
 * key — which is the one failure this key exists to prevent.
 */
export function buildTerminalIdempotencyKey(
  terminalDeviceId: string,
  clientSequence: bigint,
): string {
  if (!UUID_PATTERN.test(terminalDeviceId)) {
    throw new Error(
      `Terminal device id must be a UUID (offline contract §2); received '${terminalDeviceId}'.`,
    );
  }
  if (clientSequence < 0n || clientSequence > MAX_CLIENT_SEQUENCE) {
    throw new Error("Client sequence must be an unsigned 64-bit integer (offline contract §2).");
  }
  return `kl1.${terminalDeviceId}.${clientSequence}`;
}

export function isValidTerminalIdempotencyKey(key: string): boolean {
  return TERMINAL_KEY_PATTERN.test(key);
}

/**
 * Build the Hub-issued business-effect key for one event of a multi-event
 * command (KLREQ-026).
 *
 * `eventOrdinal` is defined by the COMMAND CONTRACT, not by insertion order, so
 * a replay produces the same key for the same business effect. An ordinal the
 * command contract does not register must FAIL rather than emit — see
 * {@link assertRegisteredEffectOrdinal}.
 */
export function buildHubEffectKey(commandResultId: string, eventOrdinal: number): string {
  if (!UUID_PATTERN.test(commandResultId)) {
    throw new Error(`Command result id must be a UUID (KLREQ-026); received '${commandResultId}'.`);
  }
  if (!Number.isSafeInteger(eventOrdinal) || eventOrdinal < 0 || eventOrdinal > 4294967295) {
    throw new Error("Event ordinal must be a non-negative 32-bit integer (KLREQ-026).");
  }
  return `kh1.${commandResultId}.${eventOrdinal}`;
}

export function isValidHubEffectKey(key: string): boolean {
  return HUB_EFFECT_KEY_PATTERN.test(key);
}

/**
 * Which namespace a key belongs to. `unknown` is a REFUSAL, not a default: a
 * key that fits neither shape is never treated as either.
 */
export function keyNamespace(key: string): "terminal" | "hub_effect" | "unknown" {
  if (isValidTerminalIdempotencyKey(key)) return "terminal";
  if (isValidHubEffectKey(key)) return "hub_effect";
  return "unknown";
}

/**
 * KLREQ-026: "an unregistered ambiguous ordinal must fail rather than emit."
 * The command contract declares the ordinals it produces; anything else would
 * silently mint a new business-effect identity.
 */
export function assertRegisteredEffectOrdinal(
  commandType: string,
  eventOrdinal: number,
  registeredOrdinals: readonly number[],
): void {
  if (!registeredOrdinals.includes(eventOrdinal)) {
    throw new Error(
      `Event ordinal ${eventOrdinal} is not registered for command '${commandType}' ` +
        `(registered: ${registeredOrdinals.join(", ") || "none"}). ` +
        "An unregistered ordinal fails rather than emits (KLREQ-026).",
    );
  }
}

// ---------------------------------------------------------------------------
// State vocabularies (amendment KLD-2026-07-28-001-A01 §2, §3, §4).
// ---------------------------------------------------------------------------

/**
 * Persisted per-event delivery state — the TRANSPORT AND CLOUD-PROCESSING
 * lifecycle. Mirrors `edge_sync.delivery_state`. `rejected` means a DURABLE
 * cloud rejection, never a transport failure.
 */
export const DELIVERY_STATES = [
  "pending",
  "in_flight",
  "retry_wait",
  "acknowledged",
  "rejected",
  "dead_letter",
] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/** The ORTHOGONAL conflict dimension. Mirrors `edge_sync.reconciliation_state`. */
export const RECONCILIATION_STATES = ["none", "required", "cleared"] as const;
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

/**
 * The external/operator-facing status vocabulary, verbatim from amendment
 * KLD-2026-07-28-001-A01 §3.
 *
 * A DIFFERENT SUBJECT from the five-value COMMAND sync-state registry on
 * `edge_sync.command_result.sync_state`, which describes a COMMAND outcome.
 * Conflating the two is what produced the original wrong mapping: three of the
 * six rows below were collapsed on the mistaken ground that a sixth value would
 * be "invented".
 */
export const EXTERNAL_SYNC_STATUSES = [
  "pending_cloud_sync",
  "sync_in_progress",
  "retry_scheduled",
  "cloud_acknowledged",
  "cloud_rejected",
  "delivery_failed",
  "reconciliation_required",
] as const;
export type ExternalSyncStatus = (typeof EXTERNAL_SYNC_STATUSES)[number];

/**
 * THE shared external-status mapping (amendment §4), with CONFLICT OVERRIDE
 * FIRST.
 *
 * It lives in the shared package because BOTH sides need it and neither may
 * keep its own: the Hub reports status to terminals, the cloud reports it to
 * management surfaces. The Hub database expresses the SAME mapping as
 * `edge_sync.external_sync_status(...)` so it is usable inside SQL; the two are
 * held equivalent by an executable conformance test over the entire
 * delivery x reconciliation cross product, so changing one without the other
 * fails the build instead of drifting silently.
 *
 * CORRECTION. An earlier version collapsed `in_flight` and `retry_wait` into
 * `pending_cloud_sync` and mapped `dead_letter` to `reconciliation_required`,
 * reasoning that the five-value COMMAND registry forbade a sixth value. That
 * confused two subjects — the command registry describes a COMMAND outcome, §3
 * describes an OUTBOX ROW — and it also made `dead_letter + none`, a state §2
 * names explicitly, impossible to report.
 */
export function projectExternalSyncStatus(
  deliveryState: DeliveryState,
  reconciliationState: ReconciliationState,
): ExternalSyncStatus {
  // §3 "First: conflict override".
  if (reconciliationState === "required") return "reconciliation_required";
  // §3 "Otherwise: delivery-state mapping", verbatim.
  switch (deliveryState) {
    case "pending":
      return "pending_cloud_sync";
    case "in_flight":
      return "sync_in_progress";
    case "retry_wait":
      return "retry_scheduled";
    case "acknowledged":
      return "cloud_acknowledged";
    case "rejected":
      return "cloud_rejected";
    case "dead_letter":
      return "delivery_failed";
  }
}

// ---------------------------------------------------------------------------
// Wire shapes.
// ---------------------------------------------------------------------------

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
  /** The terminal that ISSUED the command, and therefore the idempotency key. */
  readonly terminalDeviceId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly aggregateVersion: number;
  /**
   * Hub ordering. The COMPLETE namespace is
   * `(storeLocationId, assignmentGeneration, hubSequence)` (offline §5.1): a
   * replacement Hub receives a NEW generation, so its sequence can never
   * collide with the failed Hub's.
   */
  readonly hubSequence: bigint;
  readonly assignmentGeneration: number;
  /** Canonical `kl1.*` terminal key, or `kh1.*` for a Hub-issued effect. */
  readonly idempotencyKey: string;
  readonly schemaVersion: number;
  readonly payloadSha256: string;
  readonly occurredAt: string;
}

/** Per-event push result returned by the cloud (Hub §11.5). */
export interface SyncPushResult {
  readonly eventId: string;
  readonly outcome: "applied" | "duplicate_ignored" | "rejected";
  /**
   * REQUIRED for `applied` and `duplicate_ignored`: the cloud's OWN
   * acknowledgement identity. The Hub refuses to record an acknowledgement
   * without it, so none can be fabricated locally.
   */
  readonly cloudAckId?: string;
  /** REQUIRED for `rejected`: a DURABLE reason, never a transport error. */
  readonly rejectionCode?: string;
  readonly rejectionReason?: string;
}

/**
 * Validate ordering: events are pushed oldest-unacknowledged first with
 * strictly increasing `(assignmentGeneration, hubSequence)` (Hub §11.5,
 * offline §5.1).
 */
export function validateBatchOrdering(batch: readonly OutboxEvent[]): void {
  for (let i = 1; i < batch.length; i += 1) {
    const previous = batch[i - 1]!;
    const current = batch[i]!;
    if (current.assignmentGeneration < previous.assignmentGeneration) {
      throw new Error(
        `Outbox batch ordering violation: generation ${current.assignmentGeneration} after ${previous.assignmentGeneration}.`,
      );
    }
    if (
      current.assignmentGeneration === previous.assignmentGeneration &&
      current.hubSequence <= previous.hubSequence
    ) {
      throw new Error(
        `Outbox batch ordering violation: hub_sequence ${current.hubSequence} after ${previous.hubSequence}.`,
      );
    }
  }
}

/**
 * A batch declares its first and last ACTUAL `hub_sequence`. Values journalled
 * in the Hub's sequence-gap ledger are KNOWN gaps and are never treated as
 * missing events (offline contract §5).
 */
export interface BatchSequenceRange {
  readonly assignmentGeneration: number;
  readonly firstHubSequence: bigint;
  readonly lastHubSequence: bigint;
  /** Journalled burnt values inside the range. DECLARED, never inferred. */
  readonly knownGaps: readonly bigint[];
}

/**
 * Distinguish "this sequence is genuinely missing" from "this sequence was
 * burnt by a rolled-back transaction", for a stream the caller KNOWS to be
 * dense.
 *
 * DENSITY IS THE CALLER'S CLAIM, NOT THIS FUNCTION'S ASSUMPTION. The Hub
 * sequence is a single allocator for the whole Hub (offline §5) while ordering
 * is per `(location_id, assignment_generation)` (§5.1), so a stream's
 * sequences are sparse in general and a value absent from a range may simply
 * belong to another stream. Pass `expectedSequences` — the sequences the
 * consumer independently knows should exist for this stream — rather than
 * letting the range imply them.
 */
export function missingSequences(
  range: BatchSequenceRange,
  presentSequences: readonly bigint[],
  expectedSequences: readonly bigint[],
): readonly bigint[] {
  const present = new Set(presentSequences.map(String));
  const gaps = new Set(range.knownGaps.map(String));
  const missing: bigint[] = [];
  for (const expected of expectedSequences) {
    if (expected < range.firstHubSequence || expected > range.lastHubSequence) continue;
    const key = String(expected);
    if (!present.has(key) && !gaps.has(key)) missing.push(expected);
  }
  return missing;
}
