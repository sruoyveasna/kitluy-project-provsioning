/**
 * Transactional outbox recorder (schema contract §9; Hub spec §11.2).
 *
 * "Every local mutation produces its outbox item in the SAME local transaction;
 * power loss between the mutation and the outbox insertion is impossible."
 * This recorder is the ONLY way the command layer emits an event, so that
 * invariant cannot be forgotten at a call site — and the deferred constraint
 * trigger in 0012 refuses the COMMIT if it ever were.
 *
 * The wire form is the CANONICAL `@kitluy/event-contracts` envelope: stable
 * snake_case `event_name`, integer `schema_version`, `payload_sha256`,
 * `correlation_id`, `causation_id`, `idempotency_key`, `source`, `actor` and
 * `replay`. The envelope is validated BEFORE it is written, so a malformed
 * event can never reach the outbox.
 *
 * AMENDMENT §2 (KLREQ-021): the outbox row is written with
 * `delivery_state = 'pending'` and NOTHING ELSE. There is no WAN sender, no
 * cloud acknowledgement and no reconciliation here — WS-10 owns all three.
 */
import { createHash } from "node:crypto";
import { assertValidEnvelope, type DomainEventEnvelope } from "@kitluy/event-contracts";
import { asId } from "@kitluy/shared-types";
import { canonicalJson } from "../hub-database.js";
import { SERVICE_NAME, SERVICE_VERSION } from "../index.js";
import type { HubClient } from "./db.js";
import { deriveHubEventKey } from "./idempotency.js";
import { syncRepo } from "./repositories/index.js";
import { uuidv7 } from "./uuid.js";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** SHA-256 over the RFC 8785-canonical encoding of the business payload. */
export function payloadChecksum(payload: Readonly<Record<string, unknown>>): string {
  return sha256Hex(canonicalJson(payload));
}

export interface HubEventContext {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly hubDeviceId: string;
  /** Terminal that originated the command (`local_event.origin_device_id`). */
  readonly originDeviceId: string;
  readonly actorId: string | null;
  readonly assignmentGeneration: number;
  readonly businessDate: string;
  readonly correlationId: string;
  readonly originSequence: bigint;
  /** Terminal-issued command key; carried by the FIRST event of the command. */
  readonly commandIdempotencyKey: string;
}

export interface RecordEventInput {
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly aggregateVersion: bigint;
  /** Canonical `<bounded_context>.<past_tense_fact>` name — never `.v1`-suffixed. */
  readonly eventName: string;
  readonly schemaVersion?: number;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly causationId?: string | null;
}

export interface RecordedEvent {
  readonly eventId: string;
  readonly hubSequence: bigint;
  readonly idempotencyKey: string;
  readonly envelope: DomainEventEnvelope;
}

/**
 * Records domain events for ONE command. Instantiate inside the command's
 * transaction and never share it across commands: the first-event key rule and
 * the sequence range both belong to a single command.
 */
export class HubEventRecorder {
  private readonly recorded: RecordedEvent[] = [];
  private readonly allocated: bigint[] = [];

  constructor(
    private readonly client: HubClient,
    private readonly context: HubEventContext,
  ) {}

  /** Every `hub_sequence` this command has taken from the allocator (offline §5). */
  get allocatedSequences(): readonly bigint[] {
    return [...this.allocated];
  }

  get events(): readonly RecordedEvent[] {
    return [...this.recorded];
  }

  get eventIds(): readonly string[] {
    return this.recorded.map((e) => e.eventId);
  }

  get hubSequenceFirst(): bigint | null {
    return this.recorded[0]?.hubSequence ?? null;
  }

  get hubSequenceLast(): bigint | null {
    return this.recorded.at(-1)?.hubSequence ?? null;
  }

  /**
   * Allocate the sequence, build and VALIDATE the canonical envelope, then
   * write `local_event` + `edge_sync.outbox` in this transaction.
   */
  async record(input: RecordEventInput): Promise<RecordedEvent> {
    const hubSequence = await syncRepo.allocateHubSequence(this.client);
    this.allocated.push(hubSequence);

    const eventId = uuidv7();
    // The FIRST event of a command carries the terminal-issued command key;
    // later events carry a Hub-issued key derived from the never-reused
    // hub_sequence (see hub/idempotency.ts for the recorded finding).
    const idempotencyKey =
      this.recorded.length === 0
        ? this.context.commandIdempotencyKey
        : deriveHubEventKey(this.context.hubDeviceId, hubSequence);

    const payloadSha256 = payloadChecksum(input.payload);
    const occurredAt = new Date().toISOString();
    const envelope: DomainEventEnvelope = {
      event_id: eventId,
      event_name: input.eventName,
      schema_version: input.schemaVersion ?? 1,
      occurred_at: occurredAt,
      recorded_at: occurredAt,
      tenant_id: this.context.tenantId,
      digital_store_id: this.context.digitalStoreId,
      location_id: this.context.locationId,
      aggregate: {
        type: input.aggregateType,
        id: input.aggregateId,
        version: Number(input.aggregateVersion),
      },
      producer: SERVICE_NAME,
      source: {
        source_type: "store_hub",
        source_id: this.context.hubDeviceId,
        device_id: this.context.originDeviceId,
        software_version: SERVICE_VERSION,
      },
      actor:
        this.context.actorId === null
          ? null
          : { actor_type: "user", actor_id: this.context.actorId },
      correlation_id: asId.correlationId(this.context.correlationId),
      causation_id: input.causationId ?? this.recorded.at(-1)?.eventId ?? null,
      idempotency_key: asId.idempotencyKey(idempotencyKey),
      payload: input.payload,
      payload_sha256: payloadSha256,
      replay: { is_replay: false },
    };
    assertValidEnvelope(envelope);

    await syncRepo.insertLocalEventWithOutbox(this.client, {
      id: eventId,
      tenantId: this.context.tenantId,
      digitalStoreId: this.context.digitalStoreId,
      locationId: this.context.locationId,
      hubDeviceId: this.context.hubDeviceId,
      originDeviceId: this.context.originDeviceId,
      actorId: this.context.actorId,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      aggregateVersion: input.aggregateVersion,
      eventType: input.eventName,
      schemaVersion: envelope.schema_version,
      businessDate: this.context.businessDate,
      hubSequence,
      originSequence: this.context.originSequence,
      assignmentGeneration: this.context.assignmentGeneration,
      idempotencyKey,
      payloadSha256,
      // The FULL canonical envelope is persisted so the outbox item is
      // self-contained for WS-10 transmission: `local_event` has no
      // correlation/causation/source/actor columns of its own.
      payload: envelope as unknown as Record<string, unknown>,
    });

    const recorded: RecordedEvent = { eventId, hubSequence, idempotencyKey, envelope };
    this.recorded.push(recorded);
    return recorded;
  }
}
