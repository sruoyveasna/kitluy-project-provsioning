/**
 * Pairing-receipt replication to cloud — WS-11-T004-P04C3.
 *
 * Authority: the P04C owner package §21-§23; Hub spec §11.2 ("every local
 * mutation produces its outbox item in the SAME local transaction"); KLREQ-026
 * / KLD-2026-07-28-001 Group 6 (the Hub-issued `kh1.*` effect key); offline
 * contract §5 (the ordering namespace) and §9 (the transactional outbox).
 *
 * ===========================================================================
 * WHO IS AUTHORITATIVE, AND WHAT THE CLOUD IS FOR
 * ===========================================================================
 * The LOCAL Hub pairing fact stays authoritative — ownership classification A,
 * unchanged since P03B. Cloud availability is NOT part of the pairing commit
 * path: the event is written to the outbox in the same transaction as the
 * paired state, the receipt and the `device.paired` audit fact, and then the
 * existing WS-10 sender delivers it whenever the WAN comes back. A Store with
 * no internet pairs a terminal exactly as fast as one with internet.
 *
 * The cloud stores FLEET EVIDENCE and a read projection. It never authors
 * pairing, never changes `paired_at`, never becomes the LAN pairing authority
 * and never causes a second local receipt.
 *
 * ===========================================================================
 * THE EFFECT KEY, AND ONE RECORDED DIVERGENCE
 * ===========================================================================
 * The owner package fixes the effect key at `kh1.{command_result_uuid}.1`.
 * Two things about that are worth stating rather than quietly resolving, and
 * both are RECORDED in the decision and reconciliation register:
 *
 * 1. THERE IS NO COMMAND RESULT. `edge_sync.command_result` keeps the STRICT
 *    terminal check (`kl1.{terminal_device_uuid}.{client_sequence}`, migration
 *    0018) precisely because "a command result always belongs to a terminal
 *    command". Pairing is not a terminal command — it is a Hub-originated
 *    identity fact with no client sequence — so minting a synthetic `kl1.*`
 *    key to create a command-result row would be the Hub claiming to be a
 *    terminal, which KLREQ-026 forbids in as many words. The key's namespace
 *    UUID is therefore the PAIRING RECEIPT ID, which is also the business
 *    deduplication identity the same package specifies. It is stable across
 *    replay (the receipt is immutable and unique per session), which is the
 *    property KLREQ-026 actually requires of the namespace.
 *
 * 2. THE ORDINAL IS DECLARED, NOT DERIVED FROM THE COMMAND STRIDE.
 *    `effect-contract.ts` derives ordinals as `slot * 1000 + occurrence` for
 *    events emitted by registered COMMANDS. This event has no command
 *    contract, so its ordinal comes from the declaration below — registered,
 *    deterministic, not insertion order, and an unregistered name fails rather
 *    than emits, which are exactly KLREQ-026's stated requirements. The owner
 *    package's literal `1` is used.
 *
 * ===========================================================================
 * WHAT THE PAYLOAD MAY AND MAY NOT CARRY
 * ===========================================================================
 * Public receipt material only. Nonces, ephemeral proof signatures, private
 * keys, the provisioning code or its digest and database credentials are
 * absent from the payload TYPE, and {@link assertPublishableReceiptPayload}
 * re-checks the value before the envelope is built — so a future field that
 * widened the payload fails here rather than replicating a secret to cloud.
 */
import { assertValidEnvelope, type DomainEventEnvelope } from "@kitluy/event-contracts";
import { buildHubEffectKey, isValidHubEffectKey } from "@kitluy/sync-protocol";
import { asId } from "@kitluy/shared-types";

import { SERVICE_NAME, SERVICE_VERSION } from "../index.js";
import type { HubClient } from "./db.js";
import { HubCommandError } from "./errors.js";
import { payloadChecksum } from "./outbox.js";
import { syncRepo } from "./repositories/index.js";

/** The one event this module emits (owner package §21). */
export const PAIRING_RECEIPT_EVENT_NAME = "terminal_pairing.receipt_issued" as const;
export const PAIRING_RECEIPT_SCHEMA_VERSION = 1 as const;
export const PAIRING_RECEIPT_AGGREGATE_TYPE = "terminal_pairing" as const;

/**
 * The declared ordinal registry for Hub-originated identity facts.
 *
 * The command stride does not apply here (see the header): these events have
 * no command contract. An unregistered name FAILS rather than emitting, which
 * is the KLREQ-026 rule this registry exists to keep.
 */
const HUB_ORIGINATED_EFFECT_ORDINALS: Readonly<Record<string, number>> = {
  [PAIRING_RECEIPT_EVENT_NAME]: 1,
};

/**
 * The Hub-issued business-effect key for a pairing receipt.
 *
 * Namespace is the RECEIPT id — the business deduplication identity — because
 * a Hub-originated fact has no command result to name (header note 1).
 */
export function pairingReceiptEffectKey(receiptId: string, eventName: string): string {
  const ordinal = HUB_ORIGINATED_EFFECT_ORDINALS[eventName];
  if (ordinal === undefined) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Hub-originated effect '${eventName}' has no registered ordinal. An unregistered ordinal ` +
        "fails rather than emits (KLREQ-026).",
      { eventName },
    );
  }
  const key = buildHubEffectKey(receiptId, ordinal);
  if (!isValidHubEffectKey(key)) {
    throw new HubCommandError(
      "EDGE_COMMAND_UNKNOWN",
      `Derived effect key '${key}' is not the canonical kh1 shape (KLREQ-026).`,
      { receiptId, ordinal },
    );
  }
  return key;
}

/** PUBLIC receipt material only (owner package §22). */
export interface PairingReceiptEventPayload {
  readonly receipt_id: string;
  readonly receipt_version: string;
  readonly pairing_session_id: string;
  readonly hub_device_id: string;
  readonly terminal_device_id: string;
  readonly terminal_assignment_generation: number;
  readonly terminal_profile_code: string;
  readonly tenant_id: string;
  readonly digital_store_id: string;
  readonly location_id: string;
  readonly environment: string;
  readonly hub_certificate_fingerprint: string;
  readonly terminal_certificate_fingerprint: string;
  readonly transcript_hash: string;
  readonly paired_at: string;
  /** The Hub's detached signature over the canonical receipt bytes, base64. */
  readonly hub_receipt_signature: string;
  readonly hub_certificate_serial: string;
  readonly correlation_id: string;
}

const FORBIDDEN_PAYLOAD_KEY_FRAGMENTS = [
  "nonce",
  "privatekey",
  "proofsignature",
  "provisioningcode",
  "codedigest",
  "password",
  "secret",
  "connectionstring",
] as const;
const FORBIDDEN_PAYLOAD_VALUE = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|postgres(?:ql)?:\/\//;

/**
 * Structural refusal, checked on the VALUE rather than the type.
 *
 * `hub_receipt_signature` is deliberately allowed: it is the Hub's signature
 * over the PUBLIC receipt, which is the evidence the cloud is being sent. The
 * refused `proofSignature` family is the EPHEMERAL handshake proof, which
 * proves possession of a nonce and has no business meaning after the session.
 */
export function assertPublishableReceiptPayload(payload: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(payload)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    if (FORBIDDEN_PAYLOAD_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `Field '${key}' must never be replicated to cloud: nonces, ephemeral proof signatures, ` +
          "provisioning codes, private keys and database credentials stay on the Hub (P04C §22).",
        { field: key },
      );
    }
    if (typeof value === "string" && FORBIDDEN_PAYLOAD_VALUE.test(value)) {
      throw new HubCommandError(
        "EDGE_COMMAND_UNKNOWN",
        `Field '${key}' carries private key material or a database credential; refusing to ` +
          "replicate it (P04C §22).",
        { field: key },
      );
    }
  }
}

export interface PairingReceiptEventInput {
  readonly payload: PairingReceiptEventPayload;
  /** The Hub's ordering-namespace generation (offline §5.1), never the terminal's. */
  readonly hubAssignmentGeneration: number;
  /** Hub-local business date, derived from the SAME transaction's `now()`. */
  readonly businessDate: string;
  readonly eventId: string;
}

export interface RecordedPairingReceiptEvent {
  readonly eventId: string;
  readonly hubSequence: bigint;
  readonly idempotencyKey: string;
  readonly envelope: DomainEventEnvelope;
}

/**
 * Write the receipt-issued event and its outbox row inside the CALLER's
 * transaction.
 *
 * Called from the pairing completion door's transaction, so the paired state,
 * the immutable receipt, the `device.paired` audit fact and this event commit
 * together or not at all. There is no branch here that can succeed while the
 * pairing fails, and no cloud call — that is what makes pairing WAN-independent.
 */
export async function recordPairingReceiptEvent(
  client: HubClient,
  input: PairingReceiptEventInput,
): Promise<RecordedPairingReceiptEvent> {
  const payload = { ...input.payload } as unknown as Record<string, unknown>;
  assertPublishableReceiptPayload(payload);

  const idempotencyKey = pairingReceiptEffectKey(
    input.payload.receipt_id,
    PAIRING_RECEIPT_EVENT_NAME,
  );
  const hubSequence = await syncRepo.allocateHubSequence(client);
  const payloadSha256 = payloadChecksum(payload);
  // The receipt's own instant IS when this fact occurred; `recorded_at` is when
  // the Hub journalled it. Keeping them distinct matters at the cloud, which
  // must never confuse "when the terminal paired" with "when we heard about it".
  const occurredAt = input.payload.paired_at;
  const envelope: DomainEventEnvelope = {
    event_id: input.eventId,
    event_name: PAIRING_RECEIPT_EVENT_NAME,
    schema_version: PAIRING_RECEIPT_SCHEMA_VERSION,
    occurred_at: occurredAt,
    recorded_at: new Date().toISOString(),
    tenant_id: input.payload.tenant_id,
    digital_store_id: input.payload.digital_store_id,
    location_id: input.payload.location_id,
    aggregate: {
      type: PAIRING_RECEIPT_AGGREGATE_TYPE,
      id: input.payload.pairing_session_id,
      version: 1,
    },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: input.payload.hub_device_id,
      device_id: input.payload.terminal_device_id,
      software_version: SERVICE_VERSION,
    },
    // Pairing is a DEVICE fact: no staff actor performs it, and naming one
    // would be a fabricated attribution in an append-only record.
    actor: null,
    correlation_id: asId.correlationId(input.payload.correlation_id),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload,
    payload_sha256: payloadSha256,
    replay: { is_replay: false },
  };
  assertValidEnvelope(envelope);

  await syncRepo.insertLocalEventWithOutbox(client, {
    id: input.eventId,
    tenantId: input.payload.tenant_id,
    digitalStoreId: input.payload.digital_store_id,
    locationId: input.payload.location_id,
    hubDeviceId: input.payload.hub_device_id,
    originDeviceId: input.payload.terminal_device_id,
    actorId: null,
    aggregateType: PAIRING_RECEIPT_AGGREGATE_TYPE,
    aggregateId: input.payload.pairing_session_id,
    aggregateVersion: 1n,
    eventType: PAIRING_RECEIPT_EVENT_NAME,
    schemaVersion: PAIRING_RECEIPT_SCHEMA_VERSION,
    businessDate: input.businessDate,
    hubSequence,
    // A Hub-originated fact has no terminal sequence. Zero is the contract's
    // "no origin sequence" value (`local_event_origin_sequence_ck` admits it),
    // not a claim that some terminal command numbered zero produced this.
    originSequence: 0n,
    assignmentGeneration: input.hubAssignmentGeneration,
    idempotencyKey,
    payloadSha256,
    payload: envelope as unknown as Record<string, unknown>,
  });

  return { eventId: input.eventId, hubSequence, idempotencyKey, envelope };
}
