/**
 * Cloud T002 intake ingestion (WS-12-T002-P02) — the consumers of the Hub's
 * three T002 outbox facts, feeding the group-0186 and group-0187 doors:
 *
 *   customer.local_customer_created  v1 → kitluy_core.ingest_local_customer_v1
 *   customer.consent_decision_recorded v1 → kitluy_core.ingest_consent_decision_v1
 *   laundry.booking_draft_recorded   v1 → kitluy_laundry.ingest_booking_draft_event_v1
 *
 * Mirrors HealthReportIngestion exactly: directly-callable classes whose
 * `AuthenticatedHubDelivery` scope is supplied by the transport that
 * authenticated the batch — that signed Hub→cloud transport remains the
 * recorded BLK-006 gap, so the only production caller today is absent by
 * design and the integration tests drive these classes instead.
 *
 * Order of operations: shape → scope → door. Doors own idempotency (effect
 * key), collision/conflict verdicts and fail-closed policy versions; these
 * classes never invent an outcome and never leak a raw SQLSTATE — an
 * unmapped door error becomes INTERNAL_ERROR with the sentinel captured
 * for the acknowledgment only.
 *
 * DATA MINIMIZATION: each consumer forwards exactly the fields its target
 * door requires — nothing from the envelope beyond the public payload.
 */
import { createHash } from "node:crypto";
import type pg from "pg";

import { REGISTRY_ROLES, withServiceRole, type ClientSource } from "./database.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EFFECT_KEY = /^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$/;

export interface AuthenticatedHubDelivery {
  readonly hubDeviceId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
}

export interface SafeLogger {
  info(fields: Record<string, string | number | boolean>): void;
}

/**
 * The authenticated acknowledgment returned to the Hub for ONE delivered
 * fact (§10). It binds the effect identity and the governed cloud result;
 * it never carries local business identity changes.
 */
export interface T002Acknowledgment {
  readonly effectKey: string;
  readonly aggregateId: string;
  readonly schemaVersion: number;
  readonly cloudResult: string;
  readonly cloudReferenceId: string | null;
  readonly acknowledgedAt: string;
  readonly correlationId: string;
}

function hashPayload(payload: Record<string, unknown>): string {
  const sorted = Object.keys(payload)
    .sort()
    .map((key) => `${key}=${JSON.stringify(payload[key] ?? null)}`)
    .join("&");
  return createHash("sha256").update(Buffer.from(sorted, "utf8")).digest("hex");
}

interface DoorRow {
  readonly result: Record<string, unknown>;
}

async function callDoor(
  client: pg.PoolClient,
  sql: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const { rows } = await client.query<DoorRow>(`select ${sql} as result`, params);
  return rows[0]?.result ?? {};
}

function ackFrom(
  effectKey: string,
  aggregateId: string,
  correlationId: string,
  cloudResult: string,
  cloudReferenceId: string | null,
): T002Acknowledgment {
  return {
    effectKey,
    aggregateId,
    schemaVersion: 1,
    cloudResult,
    cloudReferenceId,
    acknowledgedAt: new Date().toISOString(),
    correlationId,
  };
}

function mapSentinel(message: string): string {
  if (message.includes("KLUY-CUSTOMER-INGEST-IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("KLUY-CONSENT-INGEST-IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("KLUY-DRAFT-INGEST-IDEMPOTENCY")) return "IDEMPOTENCY_CONFLICT";
  if (message.includes("KLUY-CONSENT-INGEST-POLICY-VERSION-UNKNOWN"))
    return "POLICY_VERSION_UNKNOWN";
  if (message.includes("KLUY-CONSENT-INGEST-CUSTOMER-UNKNOWN")) return "CUSTOMER_UNKNOWN";
  if (
    message.includes("KLUY-CUSTOMER-INGEST-SCOPE") ||
    message.includes("KLUY-DRAFT-INGEST-WRONG-SCOPE")
  )
    return "REJECTED_SCOPE";
  if (message.includes("KLUY-DRAFT-INGEST-HUB-UNASSIGNED")) return "REJECTED_IDENTITY";
  if (
    message.includes("KLUY-CUSTOMER-INGEST-SCHEMA") ||
    message.includes("KLUY-CONSENT-INGEST-SCHEMA") ||
    message.includes("KLUY-DRAFT-INGEST-SCHEMA")
  )
    return "REJECTED_SCHEMA";
  return "INTERNAL_ERROR";
}

/** `customer.local_customer_created` v1 — public payload shape. */
export interface LocalCustomerEvent {
  readonly effectKey: string;
  readonly localCustomerId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly displayName: string;
  readonly phoneE164: string | null;
  readonly phoneDisplay: string | null;
  readonly preferredLocale: string;
  readonly sourceCode: string;
  readonly correlationId: string;
}

export class LocalCustomerIngestion {
  public constructor(
    private readonly source: ClientSource,
    private readonly logger?: SafeLogger,
  ) {}

  public async ingest(
    delivery: AuthenticatedHubDelivery,
    event: LocalCustomerEvent,
  ): Promise<T002Acknowledgment> {
    const ack = (result: string, ref: string | null): T002Acknowledgment =>
      ackFrom(event.effectKey, event.localCustomerId, event.correlationId, result, ref);
    if (
      !EFFECT_KEY.test(event.effectKey) ||
      !UUID.test(event.localCustomerId) ||
      event.effectKey !== `kh1.${event.localCustomerId.toLowerCase()}.1` ||
      !UUID.test(event.tenantId) ||
      !UUID.test(event.digitalStoreId) ||
      !UUID.test(event.correlationId) ||
      typeof event.displayName !== "string"
    ) {
      return ack("REJECTED_SCHEMA", null);
    }
    if (
      delivery.tenantId.toLowerCase() !== event.tenantId.toLowerCase() ||
      delivery.digitalStoreId.toLowerCase() !== event.digitalStoreId.toLowerCase()
    ) {
      return ack("REJECTED_SCOPE", null);
    }
    const payloadHash = hashPayload({
      k: event.effectKey,
      n: event.displayName,
      p: event.phoneE164,
      t: event.tenantId,
      s: event.digitalStoreId,
    });
    try {
      const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
        callDoor(
          client,
          `kitluy_core.ingest_local_customer_v1($1, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9, $10::uuid)`,
          [
            event.effectKey,
            payloadHash,
            event.tenantId,
            event.digitalStoreId,
            event.displayName,
            event.phoneE164,
            event.phoneDisplay,
            event.preferredLocale,
            event.sourceCode,
            event.correlationId,
          ],
        ),
      );
      const outcome = String(row["outcome"] ?? "INTERNAL_ERROR");
      const cloudCustomerId =
        typeof row["cloudCustomerId"] === "string" ? row["cloudCustomerId"] : null;
      this.logger?.info({ event: "t002.customer_ingested", outcome });
      return ack(outcome, cloudCustomerId);
    } catch (error) {
      return ack(mapSentinel(error instanceof Error ? error.message : ""), null);
    }
  }
}

/** `customer.consent_decision_recorded` v1 — public payload shape. */
export interface ConsentDecisionEvent {
  readonly effectKey: string;
  readonly consentDecisionId: string;
  readonly localCustomerId: string;
  readonly cloudCustomerId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly purposeKey: string;
  readonly policyRef: string;
  readonly policyVersion: number;
  readonly decision: string;
  readonly channel: string;
  readonly staffAssisted: boolean;
  readonly correlationId: string;
}

export class ConsentDecisionIngestion {
  public constructor(
    private readonly source: ClientSource,
    private readonly logger?: SafeLogger,
  ) {}

  public async ingest(
    delivery: AuthenticatedHubDelivery,
    event: ConsentDecisionEvent,
  ): Promise<T002Acknowledgment> {
    const ack = (result: string, ref: string | null): T002Acknowledgment =>
      ackFrom(event.effectKey, event.consentDecisionId, event.correlationId, result, ref);
    if (
      !EFFECT_KEY.test(event.effectKey) ||
      !UUID.test(event.consentDecisionId) ||
      event.effectKey !== `kh1.${event.consentDecisionId.toLowerCase()}.1` ||
      !UUID.test(event.tenantId) ||
      !UUID.test(event.cloudCustomerId) ||
      !UUID.test(event.correlationId) ||
      !Number.isInteger(event.policyVersion)
    ) {
      return ack("REJECTED_SCHEMA", null);
    }
    if (delivery.tenantId.toLowerCase() !== event.tenantId.toLowerCase()) {
      return ack("REJECTED_SCOPE", null);
    }
    const payloadHash = hashPayload({
      k: event.effectKey,
      c: event.cloudCustomerId,
      p: event.purposeKey,
      v: event.policyVersion,
      d: event.decision,
    });
    try {
      const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
        callDoor(
          client,
          `kitluy_core.ingest_consent_decision_v1($1, $2, $3::uuid, $4::uuid, $5, $6::bigint, $7, $8, $9, $10, $11::uuid)`,
          [
            event.effectKey,
            payloadHash,
            event.tenantId,
            event.cloudCustomerId,
            event.purposeKey,
            event.policyVersion,
            event.decision,
            event.channel,
            event.staffAssisted ? "staff_assisted" : "customer_self",
            `hub-consent:${event.consentDecisionId}`,
            event.correlationId,
          ],
        ),
      );
      const outcome = String(row["outcome"] ?? "INTERNAL_ERROR");
      const grantId = typeof row["consentGrantId"] === "string" ? row["consentGrantId"] : null;
      this.logger?.info({ event: "t002.consent_ingested", outcome });
      return ack(outcome, grantId);
    } catch (error) {
      return ack(mapSentinel(error instanceof Error ? error.message : ""), null);
    }
  }
}

/** `laundry.booking_draft_recorded` v1 — public payload shape. */
export interface BookingDraftEvent {
  readonly effectKey: string;
  readonly bookingDraftEventId: string;
  readonly hubDraftId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  readonly hubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly walkIn: boolean;
  readonly localCustomerId: string | null;
  readonly customerSnapshot: Record<string, unknown>;
  readonly lifecycle: string;
  readonly version: number;
  readonly preferredLanguage: string;
  readonly intakeSource: string;
  readonly cancelReasonCode: string | null;
  readonly hubCreatedAt: string;
  readonly hubUpdatedAt: string;
  readonly correlationId: string;
}

export class BookingDraftIngestion {
  public constructor(
    private readonly source: ClientSource,
    private readonly logger?: SafeLogger,
  ) {}

  public async ingest(
    delivery: AuthenticatedHubDelivery,
    event: BookingDraftEvent,
  ): Promise<T002Acknowledgment> {
    const ack = (result: string, ref: string | null): T002Acknowledgment =>
      ackFrom(event.effectKey, event.hubDraftId, event.correlationId, result, ref);
    if (
      !EFFECT_KEY.test(event.effectKey) ||
      !UUID.test(event.bookingDraftEventId) ||
      event.effectKey !== `kh1.${event.bookingDraftEventId.toLowerCase()}.1` ||
      !UUID.test(event.hubDraftId) ||
      !UUID.test(event.tenantId) ||
      !UUID.test(event.digitalStoreId) ||
      !UUID.test(event.locationId) ||
      !UUID.test(event.hubDeviceId) ||
      !UUID.test(event.terminalDeviceId) ||
      !UUID.test(event.correlationId) ||
      !Number.isInteger(event.version) ||
      event.version < 1
    ) {
      return ack("REJECTED_SCHEMA", null);
    }
    if (
      delivery.hubDeviceId.toLowerCase() !== event.hubDeviceId.toLowerCase() ||
      delivery.tenantId.toLowerCase() !== event.tenantId.toLowerCase() ||
      delivery.digitalStoreId.toLowerCase() !== event.digitalStoreId.toLowerCase() ||
      delivery.locationId.toLowerCase() !== event.locationId.toLowerCase()
    ) {
      return ack("REJECTED_SCOPE", null);
    }
    const payload: Record<string, unknown> = {
      event_type: event.eventType,
      lifecycle: event.lifecycle,
      version: event.version,
      walk_in: event.walkIn,
      local_customer_id: event.localCustomerId,
      preferred_language: event.preferredLanguage,
      intake_source: event.intakeSource,
      cancel_reason_code: event.cancelReasonCode,
      hub_created_at: event.hubCreatedAt,
      hub_updated_at: event.hubUpdatedAt,
    };
    const payloadHash = hashPayload({ k: event.effectKey, ...payload });
    try {
      const row = await withServiceRole(this.source, REGISTRY_ROLES.edgeSync, async (client) =>
        callDoor(
          client,
          `kitluy_laundry.ingest_booking_draft_event_v1(
             $1, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
             $9, $10::bigint, $11, $12::boolean, $13::uuid, $14::jsonb, $15, $16,
             $17, $18::timestamptz, $19::timestamptz, $20::jsonb, $21::uuid)`,
          [
            event.effectKey,
            payloadHash,
            event.hubDeviceId,
            event.terminalDeviceId,
            event.tenantId,
            event.digitalStoreId,
            event.locationId,
            event.hubDraftId,
            event.eventType,
            event.version,
            event.lifecycle,
            event.walkIn,
            event.localCustomerId,
            JSON.stringify(event.customerSnapshot),
            event.preferredLanguage,
            event.intakeSource,
            event.cancelReasonCode,
            event.hubCreatedAt,
            event.hubUpdatedAt,
            JSON.stringify(payload),
            event.correlationId,
          ],
        ),
      );
      const outcome = String(row["outcome"] ?? "INTERNAL_ERROR");
      this.logger?.info({ event: "t002.draft_ingested", outcome, draftVersion: event.version });
      return ack(outcome, event.hubDraftId);
    } catch (error) {
      return ack(mapSentinel(error instanceof Error ? error.message : ""), null);
    }
  }
}
