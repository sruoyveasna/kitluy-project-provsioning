/**
 * @kitluy/event-contracts — immutable domain-event envelope and event registry.
 *
 * Source authority:
 * - KLD-2026-07-26-002 Group 4 (APPROVED WITH CORRECTION) — canonical event
 *   names are stable semantic facts `<bounded_context>.<past_tense_fact>`;
 *   schema versions are carried ONLY in `schema_version`; the canonical wire
 *   envelope uses the snake_case fields of the Domain Event Registry.
 * - Domain Event Registry v1.0.0 §1.1 (naming) and §2 (common envelope v1).
 * - Rebuild bible v4.0.0 §10.3 — events are immutable, versioned and
 *   retry-safe with correlation/causation IDs and an idempotency key.
 *
 * Vertical-specific event names live in the vertical packages
 * (e.g. verticals/phase1-laundry), not in neutral Core.
 *
 * STATUS: IMPLEMENTED-IN-DEV (envelope + registry contract). Registry content
 * grows with spec citations only. No event is published by this package.
 */
import type { CorrelationId, IdempotencyKey } from "@kitluy/shared-types";

/**
 * Canonical event-name grammar: `<bounded_context>.<past_tense_fact>`
 * (Domain Event Registry v1.0.0 §1.1; KLD-2026-07-26-002 Group 4).
 *
 * Two lowercase snake_case segments, each starting with a letter. A `.v<major>`
 * suffix must NOT be embedded in the canonical name — the schema version lives
 * in the envelope's `schema_version` field only.
 *
 * Divergence recorded: the registry's JSON Schema writes the looser pattern
 * `^[a-z0-9_]+\.[a-z0-9_]+$` (which would admit leading digits). The owner
 * decision's corrected pattern is authoritative (registry §0.1 authority
 * order — owner decisions outrank this contract family).
 */
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

/** SHA-256 payload checksum: 64 lowercase hex characters (registry §2). */
export const PAYLOAD_SHA256_PATTERN = /^[a-f0-9]{64}$/;

/** Minimum schema version; versions start at 1 (registry §2). */
export const MIN_SCHEMA_VERSION = 1;

/** True when `name` matches the canonical two-segment event-name grammar. */
export function isValidEventName(name: string): boolean {
  return EVENT_NAME_PATTERN.test(name);
}

/**
 * True when `version` is an integer >= 1. Schema versions are the ONLY carrier
 * of event versioning (KLD-2026-07-26-002 Group 4).
 */
export function isValidSchemaVersion(version: unknown): version is number {
  return typeof version === "number" && Number.isInteger(version) && version >= MIN_SCHEMA_VERSION;
}

/** True when `checksum` is a 64-character lowercase hex SHA-256 digest. */
export function isValidPayloadChecksum(checksum: string): boolean {
  return PAYLOAD_SHA256_PATTERN.test(checksum);
}

/** Producer classes permitted to emit events (registry §2 `source.source_type`). */
export const EVENT_SOURCE_TYPES = [
  "cloud_service",
  "store_hub",
  "terminal",
  "mobile_client",
  "connector",
  "operator",
] as const;

export type EventSourceType = (typeof EVENT_SOURCE_TYPES)[number];

/** Actor classes permitted to cause events (registry §2 `actor.actor_type`). */
export const EVENT_ACTOR_TYPES = ["user", "service", "device", "connector", "system"] as const;

export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

/** Emitting runtime that produced the event (registry §2 `source`). */
export interface EventSource {
  readonly source_type: EventSourceType;
  readonly source_id: string;
  readonly device_id?: string | null;
  readonly software_version?: string | null;
}

/** Principal that caused the event, when one exists (registry §2 `actor`). */
export interface EventActor {
  readonly actor_type: EventActorType;
  readonly actor_id: string;
  readonly permission_key?: string | null;
  readonly approval_request_id?: string | null;
}

/**
 * Aggregate identity the event was committed against.
 *
 * KLD-2026-07-26-002 Group 4 names a single `aggregate` wire field; the
 * registry's JSON Schema still spells the three flat fields
 * `aggregate_type` / `aggregate_id` / `aggregate_version`. The owner decision
 * is authoritative (registry §0.1 authority order); the flat spelling is a
 * documentation-only reconciliation mapping.
 */
export interface EventAggregateRef {
  readonly type: string;
  readonly id: string;
  /** Aggregate stream position; integer >= 1. */
  readonly version: number;
}

/** Replay provenance for re-emitted events (registry §2 `replay`). */
export interface EventReplayMetadata {
  readonly is_replay: boolean;
  readonly replay_run_id?: string | null;
  readonly original_event_id?: string | null;
}

/**
 * Canonical WIRE envelope — snake_case per Domain Event Registry v1.0.0 §2 and
 * KLD-2026-07-26-002 Group 4. Every field is readonly: a committed event is an
 * immutable fact; corrections are compensating events, never mutations.
 */
export interface DomainEventEnvelope<TPayload = Readonly<Record<string, unknown>>> {
  /** UUID (UUIDv7 preferred) — the immutable event identity. */
  readonly event_id: string;
  /** Canonical event name, e.g. "payment.recorded". Never version-suffixed. */
  readonly event_name: string;
  /** Integer >= 1. The sole carrier of event versioning. */
  readonly schema_version: number;
  /** ISO-8601 instant the fact occurred. */
  readonly occurred_at: string;
  /** ISO-8601 instant the fact was durably recorded. */
  readonly recorded_at: string;
  readonly tenant_id: string;
  readonly digital_store_id?: string | null;
  readonly location_id?: string | null;
  readonly aggregate: EventAggregateRef;
  /** Logical producing component (registry §2 `producer`). */
  readonly producer: string;
  readonly source: EventSource;
  readonly actor?: EventActor | null;
  readonly correlation_id: CorrelationId;
  readonly causation_id?: string | null;
  readonly trace_id?: string | null;
  readonly idempotency_key: IdempotencyKey;
  readonly payload: TPayload;
  /** SHA-256 of the canonical payload encoding; 64 lowercase hex characters. */
  readonly payload_sha256: string;
  readonly replay?: EventReplayMetadata;
  /** Optional non-authoritative metadata only (registry §2 `metadata`). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Structurally validates a wire envelope, returning one message per violation.
 * An empty array means the envelope satisfies the registry §2 contract.
 */
export function validateEnvelope(envelope: DomainEventEnvelope<unknown>): readonly string[] {
  const violations: string[] = [];

  if (!isValidEventName(envelope.event_name)) {
    violations.push(
      `Invalid event_name "${envelope.event_name}"; expected <bounded_context>.<past_tense_fact> (two lowercase segments, no version suffix).`,
    );
  }
  if (!isValidSchemaVersion(envelope.schema_version)) {
    violations.push(
      `Invalid schema_version ${String(envelope.schema_version)}; expected an integer >= ${MIN_SCHEMA_VERSION}.`,
    );
  }
  if (!isValidPayloadChecksum(envelope.payload_sha256)) {
    violations.push(
      `Invalid payload_sha256 "${envelope.payload_sha256}"; expected 64 lowercase hex characters.`,
    );
  }
  if (envelope.event_id.length === 0) {
    violations.push("Missing event_id; event identity is required and immutable.");
  }
  if (envelope.correlation_id.length === 0) {
    violations.push("Missing correlation_id; every event must be traceable to its cause chain.");
  }
  if (envelope.causation_id !== undefined && envelope.causation_id !== null) {
    if (envelope.causation_id.length === 0) {
      violations.push("causation_id, when present, must be a non-empty event identity.");
    } else if (envelope.causation_id === envelope.event_id) {
      violations.push("causation_id must not reference the event's own event_id.");
    }
  }
  if (envelope.idempotency_key.length < 8 || envelope.idempotency_key.length > 200) {
    violations.push("idempotency_key must be between 8 and 200 characters.");
  }
  if (!isValidSchemaVersion(envelope.aggregate.version)) {
    violations.push(
      `Invalid aggregate.version ${String(envelope.aggregate.version)}; expected an integer >= 1.`,
    );
  }
  if (envelope.replay !== undefined) {
    if (typeof envelope.replay.is_replay !== "boolean") {
      violations.push("replay.is_replay is required when replay metadata is present.");
    } else if (envelope.replay.is_replay && !envelope.replay.original_event_id) {
      violations.push("A replayed event must carry replay.original_event_id.");
    }
  }

  return violations;
}

/** Throws unless `envelope` satisfies the registry §2 contract. */
export function assertValidEnvelope(envelope: DomainEventEnvelope<unknown>): void {
  const violations = validateEnvelope(envelope);
  if (violations.length > 0) {
    throw new Error(`Invalid domain event envelope: ${violations.join(" ")}`);
  }
}

/**
 * Deep-freezes an envelope so a committed event cannot be mutated at runtime,
 * matching the `readonly` type surface (RB v4 §10.3 — events are immutable).
 */
export function freezeEnvelope<TPayload>(
  envelope: DomainEventEnvelope<TPayload>,
): DomainEventEnvelope<TPayload> {
  deepFreeze(envelope);
  return envelope;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return;
  }
  Object.freeze(value);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
}

/** Registry entry describing one event name at one schema version. */
export interface EventRegistration {
  /** Canonical event name, e.g. "laundry_booking.created". */
  readonly eventName: string;
  /** Integer >= 1; versioning lives here, never in the name. */
  readonly schemaVersion: number;
  readonly description: string;
  readonly owningBoundary: string;
  /** Spec citation that authorizes this event, e.g. "Domain Event Registry v1.0.0 §5". */
  readonly source: string;
}

function registrationKey(eventName: string, schemaVersion: number): string {
  return `${eventName}@${schemaVersion}`;
}

/**
 * In-memory registry of event contracts.
 *
 * Backward-compatible evolution: a new `schemaVersion` for an already-known
 * event name is accepted (additive contract change). Re-registering the same
 * name at the same version is a conflict — published contracts are immutable.
 */
export class EventRegistry {
  private readonly entries = new Map<string, EventRegistration>();

  register(entry: EventRegistration): void {
    if (!isValidEventName(entry.eventName)) {
      throw new Error(
        `Invalid event name "${entry.eventName}"; expected <bounded_context>.<past_tense_fact> (two lowercase segments, no version suffix).`,
      );
    }
    if (!isValidSchemaVersion(entry.schemaVersion)) {
      throw new Error(
        `Invalid schema version ${String(entry.schemaVersion)} for "${entry.eventName}"; expected an integer >= ${MIN_SCHEMA_VERSION}.`,
      );
    }
    const key = registrationKey(entry.eventName, entry.schemaVersion);
    if (this.entries.has(key)) {
      throw new Error(
        `Event ${entry.eventName} schema version ${entry.schemaVersion} already registered; event contracts are immutable.`,
      );
    }
    this.entries.set(key, entry);
  }

  /** Returns the requested version, or the latest registered version when omitted. */
  get(eventName: string, schemaVersion?: number): EventRegistration | undefined {
    if (schemaVersion !== undefined) {
      return this.entries.get(registrationKey(eventName, schemaVersion));
    }
    const latest = this.versionsOf(eventName).at(-1);
    return latest === undefined ? undefined : this.entries.get(registrationKey(eventName, latest));
  }

  /** Ascending list of schema versions registered for `eventName`. */
  versionsOf(eventName: string): readonly number[] {
    return this.all()
      .filter((entry) => entry.eventName === eventName)
      .map((entry) => entry.schemaVersion)
      .sort((a, b) => a - b);
  }

  all(): readonly EventRegistration[] {
    return [...this.entries.values()];
  }
}
