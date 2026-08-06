/**
 * T1 customer intake, consent decisions and Booking Drafts — WS-12-T002.
 *
 * Authority: KLD-2026-08-06-WS12-T002-001 (LOCKED). The Hub is the
 * Store-local authority for the WORKING draft (edge_laundry.booking_draft,
 * group 0040) and the local ledger of consent-decision facts
 * (edge_core.consent_decision); customer identity truth stays CLOUD —
 * edge_core.customer is a projection, and a T1-created customer is labelled
 * `pending_sync` until the 0186 ingestion door acknowledges it.
 *
 * IDEMPOTENCY: every mutating operation takes the terminal's
 * Idempotency-Key plus the SHA-256 request hash; the SQL doors (0040) and
 * the draft-event unique index make the reservation atomic. A replay
 * returns the ORIGINAL effect; a reused key with a different hash refuses.
 *
 * OUTBOX: a locally created customer and every consent decision become
 * durable outbox facts (`customer.local_customer_created` v1,
 * `customer.consent_decision_recorded` v1, keys `kh1.{row_id}.1`) in the
 * SAME transaction as the local write — the terminal-health emit pattern.
 * Drafts emit nothing in T002: the Hub IS the draft authority and nothing
 * reconciles until conversion (a later task).
 */
import { createHash, randomUUID } from "node:crypto";

import { buildHubEffectKey } from "@kitluy/sync-protocol";
import { assertValidEnvelope, type DomainEventEnvelope } from "@kitluy/event-contracts";
import { asId } from "@kitluy/shared-types";

import { withHubTransaction, HUB_RUNTIME_ROLE, type HubClient, type HubPool } from "./db.js";
import { payloadChecksum } from "./outbox.js";
import * as syncRepo from "./repositories/sync.js";
import { SERVICE_NAME, SERVICE_VERSION } from "../index.js";
import { authorizeT1IntakeSession, type T1IntakeAuthority } from "./edge/runtime-bootstrap.js";

export const CUSTOMER_CREATED_EVENT_NAME = "customer.local_customer_created" as const;
export const CONSENT_DECISION_EVENT_NAME = "customer.consent_decision_recorded" as const;
export const T1_INTAKE_SCHEMA_VERSION = 1 as const;

export const CONSENT_PURPOSE_KEYS = [
  "privacy_notice_acknowledgement",
  "operational_communication",
  "sms_marketing",
  "telegram_marketing",
  "email_marketing",
] as const;

export const DRAFT_CANCEL_REASONS = [
  "customer_left",
  "duplicate_intake",
  "entered_in_error",
  "customer_declined",
] as const;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function maskPhone(e164: string): string {
  return `${e164.slice(0, 4)}••••${e164.slice(-4)}`;
}

export type IntakeRefusal =
  | "CUSTOMER_UNKNOWN"
  | "CUSTOMER_IDEMPOTENCY_CONFLICT"
  | "CONSENT_IDEMPOTENCY_CONFLICT"
  | "DRAFT_UNKNOWN"
  | "DRAFT_NOT_OPEN"
  | "DRAFT_VERSION_STALE"
  | "DRAFT_IDEMPOTENCY_CONFLICT"
  | "REQUEST_INVALID_SHAPE";

export class IntakeRefusalError extends Error {
  constructor(
    readonly refusal: IntakeRefusal,
    detail: string,
  ) {
    super(detail);
  }
}

/** Map the 0040 door sentinels onto the closed refusal vocabulary. */
function mapDoorError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("KLUY-EDGE-CUSTOMER-IDEMPOTENCY-CONFLICT")) {
    throw new IntakeRefusalError("CUSTOMER_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  if (message.includes("KLUY-EDGE-CONSENT-IDEMPOTENCY-CONFLICT")) {
    throw new IntakeRefusalError("CONSENT_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  if (message.includes("KLUY-EDGE-CONSENT-CUSTOMER-UNKNOWN")) {
    throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "no such customer in this Store scope");
  }
  if (message.includes("KLUY-EDGE-CUSTOMER-REQUEST") || message.includes("violates check")) {
    throw new IntakeRefusalError("REQUEST_INVALID_SHAPE", "the request shape was refused");
  }
  throw error;
}

export interface CustomerSummary {
  readonly customerId: string;
  readonly displayName: string;
  readonly phoneMasked: string | null;
  readonly phoneE164: string | null;
  readonly phoneVerified: boolean;
  readonly preferredLanguage: string;
  readonly origin: string;
  readonly syncState: string;
}

interface CustomerRow extends Record<string, unknown> {
  readonly id: string;
  readonly display_name: string;
  readonly phone_e164: string | null;
  readonly language_code: string;
  readonly origin: string;
  readonly sync_state: string;
  readonly masked_value: string | null;
  readonly verified_at: Date | null;
}

function toSummary(row: CustomerRow): CustomerSummary {
  return {
    customerId: row.id,
    displayName: row.display_name,
    phoneMasked: row.masked_value ?? (row.phone_e164 === null ? null : maskPhone(row.phone_e164)),
    phoneE164: row.phone_e164,
    phoneVerified: row.verified_at !== null,
    preferredLanguage: row.language_code,
    origin: row.origin,
    syncState: row.sync_state,
  };
}

/**
 * Exact normalized-phone search, scoped to the authenticated Tenant AND
 * Digital Store (owner decision §2.4) — the hashed-identifier probe, never
 * a fuzzy match. Every eligible match is returned; AMBIGUITY is the
 * CALLER's explicit state, never silently resolved here.
 */
export async function searchCustomersByPhone(
  pool: HubPool,
  authority: T1IntakeAuthority,
  phoneE164: string,
): Promise<readonly CustomerSummary[]> {
  return withHubTransaction(
    pool,
    async (client) => {
      const hash = sha256Hex(phoneE164);
      const rows = await client.query<CustomerRow>(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer_identifier i
           join edge_core.customer c on c.id = i.customer_id
          where i.digital_store_id = $1::uuid and i.identifier_type = 'PHONE'
            and i.normalized_value_hash = $2
            and c.tenant_id = $3::uuid and c.deleted_at is null
          order by c.created_at asc`,
        [authority.digitalStoreId, hash, authority.tenantId],
      );
      return rows.rows.map(toSummary);
    },
    HUB_RUNTIME_ROLE,
  );
}

export async function readCustomer(
  pool: HubPool,
  authority: T1IntakeAuthority,
  customerId: string,
): Promise<CustomerSummary | null> {
  return withHubTransaction(
    pool,
    async (client) => {
      const rows = await client.query<CustomerRow>(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer c
           left join edge_core.customer_identifier i
             on i.customer_id = c.id and i.identifier_type = 'PHONE'
          where c.id = $1::uuid and c.tenant_id = $2::uuid
            and c.digital_store_id = $3::uuid and c.deleted_at is null`,
        [customerId, authority.tenantId, authority.digitalStoreId],
      );
      const row = rows.rows[0];
      return row === undefined ? null : toSummary(row);
    },
    HUB_RUNTIME_ROLE,
  );
}

async function hubIdentity(
  client: HubClient,
): Promise<{ hubDeviceId: string; assignmentGeneration: number }> {
  const { rows } = await client.query<{ hub_device_id: string; assignment_generation: number }>(
    `select hub_device_id, assignment_generation
       from edge_identity.hub_assignment
      where ended_at is null
      order by assignment_generation desc
      limit 1`,
  );
  const row = rows[0];
  if (row === undefined)
    throw new IntakeRefusalError("REQUEST_INVALID_SHAPE", "no live hub assignment");
  return { hubDeviceId: row.hub_device_id, assignmentGeneration: row.assignment_generation };
}

async function emitIntakeFact(
  client: HubClient,
  input: {
    readonly eventName: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly payload: Record<string, unknown>;
    readonly correlationId: string;
  },
): Promise<void> {
  const hub = await hubIdentity(client);
  const idempotencyKey = buildHubEffectKey(input.aggregateId, 1);
  const nowIso = new Date().toISOString();
  const hubSequence = await syncRepo.allocateHubSequence(client);
  const envelope: DomainEventEnvelope = {
    event_id: randomUUID(),
    event_name: input.eventName,
    schema_version: T1_INTAKE_SCHEMA_VERSION,
    occurred_at: nowIso,
    recorded_at: nowIso,
    tenant_id: input.authority.tenantId,
    digital_store_id: input.authority.digitalStoreId,
    location_id: input.authority.locationId,
    aggregate: { type: input.aggregateType, id: input.aggregateId, version: 1 },
    producer: SERVICE_NAME,
    source: {
      source_type: "store_hub",
      source_id: hub.hubDeviceId,
      device_id: input.terminalDeviceId,
      software_version: SERVICE_VERSION,
    },
    actor: null,
    correlation_id: asId.correlationId(input.correlationId),
    causation_id: null,
    idempotency_key: asId.idempotencyKey(idempotencyKey),
    payload: input.payload,
    payload_sha256: payloadChecksum(input.payload),
    replay: { is_replay: false },
  };
  assertValidEnvelope(envelope);
  await syncRepo.insertLocalEventWithOutbox(client, {
    id: envelope.event_id,
    tenantId: input.authority.tenantId,
    digitalStoreId: input.authority.digitalStoreId,
    locationId: input.authority.locationId,
    hubDeviceId: hub.hubDeviceId,
    originDeviceId: input.terminalDeviceId,
    actorId: null,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    aggregateVersion: 1n,
    eventType: input.eventName,
    schemaVersion: T1_INTAKE_SCHEMA_VERSION,
    businessDate: nowIso.slice(0, 10),
    hubSequence,
    originSequence: 0n,
    assignmentGeneration: hub.assignmentGeneration,
    idempotencyKey,
    payloadSha256: envelope.payload_sha256,
    payload: envelope as unknown as Record<string, unknown>,
  });
}

/**
 * Minimal unverified customer creation (owner decision §2.6/§2.7). The
 * 0040 door owns idempotency; the outbox fact is emitted ONLY when the
 * door actually created the row (a replay emits nothing — one effect).
 */
export async function registerLocalCustomer(
  pool: HubPool,
  input: {
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly displayName: string;
    readonly phoneE164: string | null;
    readonly phoneRaw: string | null;
    readonly preferredLanguage: string;
    readonly requestKey: string;
    readonly requestHash: string;
    readonly correlationId: string;
  },
): Promise<{ readonly customer: CustomerSummary; readonly created: boolean }> {
  return withHubTransaction(
    pool,
    async (client) => {
      const customerId = randomUUID();
      const before = await client.query<{ id: string }>(
        `select id from edge_core.customer where created_request_key = $1`,
        [input.requestKey],
      );
      const replay = before.rows[0] !== undefined;
      let row: Record<string, unknown>;
      try {
        const result = await client.query<Record<string, unknown>>(
          `select * from edge_core.register_local_customer_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8, $9,
             't1_intake', $10, $11, $12::uuid)`,
          [
            customerId,
            input.authority.tenantId,
            input.authority.digitalStoreId,
            input.authority.locationId,
            input.displayName,
            input.phoneE164,
            input.phoneE164 === null ? null : sha256Hex(input.phoneE164),
            input.phoneE164 === null ? null : maskPhone(input.phoneE164),
            input.preferredLanguage,
            input.requestKey,
            input.requestHash,
            input.correlationId,
          ],
        );
        row = result.rows[0] ?? {};
      } catch (error) {
        mapDoorError(error);
      }
      const effectiveId = String((row as { id?: unknown }).id ?? customerId);
      if (!replay) {
        await emitIntakeFact(client, {
          eventName: CUSTOMER_CREATED_EVENT_NAME,
          aggregateType: "customer",
          aggregateId: effectiveId,
          authority: input.authority,
          terminalDeviceId: input.terminalDeviceId,
          correlationId: input.correlationId,
          payload: {
            local_customer_id: effectiveId,
            tenant_id: input.authority.tenantId,
            digital_store_id: input.authority.digitalStoreId,
            display_name: input.displayName,
            phone_e164: input.phoneE164,
            phone_display: input.phoneRaw,
            preferred_locale: input.preferredLanguage,
            source_code: "t1_intake",
            correlation_id: input.correlationId,
          },
        });
      }
      const summary = await client.query<CustomerRow>(
        `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                c.sync_state, i.masked_value, i.verified_at
           from edge_core.customer c
           left join edge_core.customer_identifier i
             on i.customer_id = c.id and i.identifier_type = 'PHONE'
          where c.id = $1::uuid`,
        [effectiveId],
      );
      const summaryRow = summary.rows[0];
      if (summaryRow === undefined) {
        throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "registration produced no row");
      }
      return { customer: toSummary(summaryRow), created: !replay };
    },
    HUB_RUNTIME_ROLE,
  );
}

export interface ConsentDecisionInput {
  readonly authority: T1IntakeAuthority;
  readonly terminalDeviceId: string;
  readonly customerId: string;
  readonly purposeKey: string;
  readonly policyRef: string;
  readonly policyVersion: number;
  readonly decision: string;
  readonly channel: string;
  readonly staffAssisted: boolean;
  readonly requestKey: string;
  readonly requestHash: string;
  readonly correlationId: string;
}

export async function recordConsentDecision(
  pool: HubPool,
  input: ConsentDecisionInput,
): Promise<{
  readonly decisionId: string;
  readonly recordedAt: string;
  readonly created: boolean;
}> {
  return withHubTransaction(
    pool,
    async (client) => {
      const before = await client.query<{ id: string }>(
        `select id from edge_core.consent_decision where request_key = $1`,
        [input.requestKey],
      );
      const replay = before.rows[0] !== undefined;
      let row: { id?: unknown; recorded_at?: unknown };
      try {
        const result = await client.query<Record<string, unknown>>(
          `select * from edge_core.record_consent_decision_v1(
             $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7, $8::bigint,
             $9, $10, $11, $12::boolean, $13::uuid, $14::uuid, $15::uuid,
             $16, $17, $18::uuid)`,
          [
            randomUUID(),
            input.authority.tenantId,
            input.authority.digitalStoreId,
            input.authority.locationId,
            input.customerId,
            input.purposeKey,
            input.policyRef,
            input.policyVersion,
            input.decision,
            input.channel,
            input.staffAssisted ? "staff_assisted" : "customer_self",
            input.staffAssisted,
            input.authority.actorId,
            input.terminalDeviceId,
            input.authority.sessionId,
            input.requestKey,
            input.requestHash,
            input.correlationId,
          ],
        );
        row = (result.rows[0] ?? {}) as { id?: unknown; recorded_at?: unknown };
      } catch (error) {
        mapDoorError(error);
      }
      const decisionId = String(row.id ?? "");
      if (!replay) {
        await emitIntakeFact(client, {
          eventName: CONSENT_DECISION_EVENT_NAME,
          aggregateType: "consent_decision",
          aggregateId: decisionId,
          authority: input.authority,
          terminalDeviceId: input.terminalDeviceId,
          correlationId: input.correlationId,
          payload: {
            consent_decision_id: decisionId,
            local_customer_id: input.customerId,
            tenant_id: input.authority.tenantId,
            digital_store_id: input.authority.digitalStoreId,
            purpose_key: input.purposeKey,
            policy_ref: input.policyRef,
            policy_version: input.policyVersion,
            decision: input.decision,
            channel: input.channel,
            staff_assisted: input.staffAssisted,
            actor_id: input.authority.actorId,
            terminal_device_id: input.terminalDeviceId,
            correlation_id: input.correlationId,
          },
        });
      }
      return {
        decisionId,
        recordedAt:
          row.recorded_at instanceof Date ? row.recorded_at.toISOString() : String(row.recorded_at),
        created: !replay,
      };
    },
    HUB_RUNTIME_ROLE,
  );
}

export interface DraftView {
  readonly draftId: string;
  readonly lifecycle: string;
  readonly version: number;
  readonly customerId: string | null;
  readonly walkIn: boolean;
  readonly customerSnapshot: Record<string, unknown>;
  readonly preferredLanguage: string;
  readonly intakeSource: string;
  readonly customerNotes: string;
  readonly staffNotes: string;
  readonly cancelReasonCode: string | null;
  readonly syncState: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface DraftRow extends Record<string, unknown> {
  readonly id: string;
  readonly lifecycle: string;
  readonly version: bigint;
  readonly customer_id: string | null;
  readonly walk_in: boolean;
  readonly customer_snapshot: Record<string, unknown>;
  readonly preferred_language: string;
  readonly intake_source: string;
  readonly customer_notes: string;
  readonly staff_notes: string;
  readonly cancel_reason_code: string | null;
  readonly sync_state: string;
  readonly created_at: Date;
  readonly updated_at: Date;
}

function toDraftView(row: DraftRow): DraftView {
  return {
    draftId: row.id,
    lifecycle: row.lifecycle,
    version: Number(row.version),
    customerId: row.customer_id,
    walkIn: row.walk_in,
    customerSnapshot: row.customer_snapshot,
    preferredLanguage: row.preferred_language,
    intakeSource: row.intake_source,
    customerNotes: row.customer_notes,
    staffNotes: row.staff_notes,
    cancelReasonCode: row.cancel_reason_code,
    syncState: row.sync_state,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadScopedDraft(
  client: HubClient,
  authority: T1IntakeAuthority,
  draftId: string,
): Promise<DraftRow | null> {
  const rows = await client.query<DraftRow>(
    `select * from edge_laundry.booking_draft
      where id = $1::uuid and tenant_id = $2::uuid and digital_store_id = $3::uuid`,
    [draftId, authority.tenantId, authority.digitalStoreId],
  );
  return rows.rows[0] ?? null;
}

/** One draft-mutation receipt; the unique request_key IS the dedup gate. */
async function recordDraftEvent(
  client: HubClient,
  input: {
    readonly draftId: string;
    readonly eventType: "created" | "updated" | "cancelled";
    readonly requestKey: string;
    readonly requestHash: string;
    readonly changes: Record<string, unknown>;
    readonly versionAfter: number;
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly correlationId: string;
  },
): Promise<void> {
  await client.query(
    `insert into edge_laundry.booking_draft_event
       (id, draft_id, event_type, request_key, request_hash, changes,
        version_after, actor_id, terminal_device_id, session_id, correlation_id)
     values ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb, $7, $8::uuid, $9::uuid,
             $10::uuid, $11::uuid)`,
    [
      randomUUID(),
      input.draftId,
      input.eventType,
      input.requestKey,
      input.requestHash,
      JSON.stringify(input.changes),
      input.versionAfter,
      input.authority.actorId,
      input.terminalDeviceId,
      input.authority.sessionId,
      input.correlationId,
    ],
  );
}

async function replayedDraft(
  client: HubClient,
  authority: T1IntakeAuthority,
  requestKey: string,
  requestHash: string,
): Promise<DraftView | null> {
  const prior = await client.query<{ draft_id: string; request_hash: string }>(
    `select draft_id, request_hash from edge_laundry.booking_draft_event where request_key = $1`,
    [requestKey],
  );
  const row = prior.rows[0];
  if (row === undefined) return null;
  if (row.request_hash !== requestHash) {
    throw new IntakeRefusalError("DRAFT_IDEMPOTENCY_CONFLICT", "idempotency key reused");
  }
  const draft = await loadScopedDraft(client, authority, row.draft_id);
  if (draft === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
  return toDraftView(draft);
}

export async function createBookingDraft(
  pool: HubPool,
  input: {
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly environment: string;
    readonly customerId: string | null;
    readonly walkIn: boolean;
    readonly preferredLanguage: string;
    readonly intakeSource: string;
    readonly customerNotes: string;
    readonly staffNotes: string;
    readonly requestKey: string;
    readonly requestHash: string;
    readonly correlationId: string;
  },
): Promise<DraftView> {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash,
      );
      if (replay !== null) return replay;

      // The IMMUTABLE customer/contact snapshot, taken NOW from the
      // projection — later customer-master edits never rewrite it (§4.3).
      let snapshot: Record<string, unknown> = { walkIn: true };
      if (!input.walkIn) {
        if (input.customerId === null) {
          throw new IntakeRefusalError(
            "REQUEST_INVALID_SHAPE",
            "a customer or walk-in is required",
          );
        }
        const rows = await client.query<CustomerRow>(
          `select c.id, c.display_name, c.phone_e164, c.language_code, c.origin,
                  c.sync_state, i.masked_value, i.verified_at
             from edge_core.customer c
             left join edge_core.customer_identifier i
               on i.customer_id = c.id and i.identifier_type = 'PHONE'
            where c.id = $1::uuid and c.tenant_id = $2::uuid
              and c.digital_store_id = $3::uuid and c.deleted_at is null`,
          [input.customerId, input.authority.tenantId, input.authority.digitalStoreId],
        );
        const customer = rows.rows[0];
        if (customer === undefined) {
          throw new IntakeRefusalError("CUSTOMER_UNKNOWN", "no such customer in this Store scope");
        }
        snapshot = {
          walkIn: false,
          customerId: customer.id,
          displayName: customer.display_name,
          phoneE164: customer.phone_e164,
          phoneMasked: customer.masked_value,
          phoneVerified: customer.verified_at !== null,
          preferredLanguage: customer.language_code,
          snapshotSyncState: customer.sync_state,
        };
      }

      const draftId = randomUUID();
      const inserted = await client.query<DraftRow>(
        `insert into edge_laundry.booking_draft
           (id, tenant_id, digital_store_id, location_id, environment,
            terminal_device_id, session_id, staff_actor_id, customer_id, walk_in,
            customer_snapshot, preferred_language, intake_source,
            customer_notes, staff_notes, created_request_key,
            created_request_hash, correlation_id)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid,
                 $8::uuid, $9::uuid, $10, $11::jsonb, $12, $13, $14, $15, $16,
                 $17, $18::uuid)
         returning *`,
        [
          draftId,
          input.authority.tenantId,
          input.authority.digitalStoreId,
          input.authority.locationId,
          input.environment,
          input.terminalDeviceId,
          input.authority.sessionId,
          input.authority.actorId,
          input.customerId,
          input.walkIn,
          JSON.stringify(snapshot),
          input.preferredLanguage,
          input.intakeSource,
          input.customerNotes,
          input.staffNotes,
          input.requestKey,
          input.requestHash,
          input.correlationId,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "insert returned nothing");
      await recordDraftEvent(client, {
        draftId,
        eventType: "created",
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes: { created: true },
        versionAfter: 1,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId,
      });
      return toDraftView(row);
    },
    HUB_RUNTIME_ROLE,
  );
}

export async function readBookingDraft(
  pool: HubPool,
  authority: T1IntakeAuthority,
  draftId: string,
): Promise<DraftView | null> {
  return withHubTransaction(
    pool,
    async (client) => {
      const row = await loadScopedDraft(client, authority, draftId);
      return row === null ? null : toDraftView(row);
    },
    HUB_RUNTIME_ROLE,
  );
}

export async function updateBookingDraft(
  pool: HubPool,
  input: {
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly draftId: string;
    readonly expectedVersion: number;
    readonly customerNotes: string | undefined;
    readonly staffNotes: string | undefined;
    readonly preferredLanguage: string | undefined;
    readonly requestKey: string;
    readonly requestHash: string;
    readonly correlationId: string;
  },
): Promise<DraftView> {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash,
      );
      if (replay !== null) return replay;
      const row = await loadScopedDraft(client, input.authority, input.draftId);
      if (row === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
      if (row.lifecycle !== "open") {
        throw new IntakeRefusalError("DRAFT_NOT_OPEN", `the draft is ${row.lifecycle}`);
      }
      if (Number(row.version) !== input.expectedVersion) {
        throw new IntakeRefusalError(
          "DRAFT_VERSION_STALE",
          `expected version ${input.expectedVersion}, current ${Number(row.version)}`,
        );
      }
      const changes: Record<string, unknown> = {};
      if (input.customerNotes !== undefined) changes["customerNotes"] = input.customerNotes;
      if (input.staffNotes !== undefined) changes["staffNotes"] = input.staffNotes;
      if (input.preferredLanguage !== undefined) {
        changes["preferredLanguage"] = input.preferredLanguage;
      }
      const nextVersion = Number(row.version) + 1;
      const updated = await client.query<DraftRow>(
        `update edge_laundry.booking_draft
            set customer_notes = coalesce($3, customer_notes),
                staff_notes = coalesce($4, staff_notes),
                preferred_language = coalesce($5, preferred_language),
                version = $2
          where id = $1::uuid
          returning *`,
        [
          input.draftId,
          nextVersion,
          input.customerNotes ?? null,
          input.staffNotes ?? null,
          input.preferredLanguage ?? null,
        ],
      );
      const next = updated.rows[0];
      if (next === undefined)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "update returned nothing");
      await recordDraftEvent(client, {
        draftId: input.draftId,
        eventType: "updated",
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes,
        versionAfter: nextVersion,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId,
      });
      return toDraftView(next);
    },
    HUB_RUNTIME_ROLE,
  );
}

export async function cancelBookingDraft(
  pool: HubPool,
  input: {
    readonly authority: T1IntakeAuthority;
    readonly terminalDeviceId: string;
    readonly draftId: string;
    readonly reasonCode: string;
    readonly requestKey: string;
    readonly requestHash: string;
    readonly correlationId: string;
  },
): Promise<DraftView> {
  return withHubTransaction(
    pool,
    async (client) => {
      const replay = await replayedDraft(
        client,
        input.authority,
        input.requestKey,
        input.requestHash,
      );
      if (replay !== null) return replay;
      const row = await loadScopedDraft(client, input.authority, input.draftId);
      if (row === null) throw new IntakeRefusalError("DRAFT_UNKNOWN", "no such draft");
      if (row.lifecycle !== "open") {
        throw new IntakeRefusalError("DRAFT_NOT_OPEN", `the draft is ${row.lifecycle}`);
      }
      const nextVersion = Number(row.version) + 1;
      const updated = await client.query<DraftRow>(
        `update edge_laundry.booking_draft
            set lifecycle = 'cancelled', cancel_reason_code = $2, version = $3
          where id = $1::uuid
          returning *`,
        [input.draftId, input.reasonCode, nextVersion],
      );
      const next = updated.rows[0];
      if (next === undefined)
        throw new IntakeRefusalError("DRAFT_UNKNOWN", "cancel returned nothing");
      await recordDraftEvent(client, {
        draftId: input.draftId,
        eventType: "cancelled",
        requestKey: input.requestKey,
        requestHash: input.requestHash,
        changes: { cancelReasonCode: input.reasonCode },
        versionAfter: nextVersion,
        authority: input.authority,
        terminalDeviceId: input.terminalDeviceId,
        correlationId: input.correlationId,
      });
      return toDraftView(next);
    },
    HUB_RUNTIME_ROLE,
  );
}

export { authorizeT1IntakeSession };
