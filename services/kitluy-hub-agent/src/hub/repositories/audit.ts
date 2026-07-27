/**
 * `edge_audit` repository adapters (schema contract §6.10).
 *
 * `audit_event` is IMMUTABLE: the 0012 trigger rejects UPDATE and DELETE
 * unconditionally, and `details_json` carries redacted evidence only — never a
 * raw secret, credential or unmasked contact value (repository rule 4).
 *
 * `local_sequence` is `not null unique`. It is allocated from the Hub's single
 * `edge_sync.hub_sequence_seq` so uniqueness and monotonicity are guaranteed by
 * the same never-reused allocator that orders the event journal (offline
 * contract §5). Contiguity is NOT claimed and is not required by the DDL.
 */
import type { HubClient } from "../db.js";

export interface AppendAuditEventInput {
  readonly id: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly locationId: string;
  /** Canonical `<bounded_context>.<past_tense_fact>` name. */
  readonly eventCode: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly requesterId: string | null;
  readonly approverId: string | null;
  readonly terminalDeviceId: string | null;
  readonly hubDeviceId: string;
  readonly profileCode: string | null;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly reasonCode: string | null;
  readonly correlationId: string;
  readonly payloadSha256: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly localSequence: bigint;
}

export async function appendAuditEvent(
  client: HubClient,
  input: AppendAuditEventInput,
): Promise<void> {
  await client.query(
    `insert into edge_audit.audit_event
       (id, tenant_id, digital_store_id, location_id, event_code, actor_type, actor_id,
        requester_id, approver_id, terminal_device_id, hub_device_id, profile_code,
        resource_type, resource_id, reason_code, correlation_id, occurred_at,
        payload_sha256, details_json, local_sequence)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
             now(), $17, $18::jsonb, $19)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.eventCode,
      input.actorType,
      input.actorId,
      input.requesterId,
      input.approverId,
      input.terminalDeviceId,
      input.hubDeviceId,
      input.profileCode,
      input.resourceType,
      input.resourceId,
      input.reasonCode,
      input.correlationId,
      input.payloadSha256,
      JSON.stringify(input.details),
      input.localSequence.toString(),
    ],
  );
}

export interface AuditEventRow {
  id: string;
  event_code: string;
  actor_id: string | null;
  requester_id: string | null;
  approver_id: string | null;
  resource_type: string;
  resource_id: string | null;
  correlation_id: string;
  local_sequence: bigint;
  details_json: Record<string, unknown>;
}

export async function listAuditEventsForResource(
  client: HubClient,
  resourceId: string,
): Promise<readonly AuditEventRow[]> {
  const result = await client.query<AuditEventRow>(
    `select id, event_code, actor_id, requester_id, approver_id, resource_type,
            resource_id, correlation_id, local_sequence, details_json
       from edge_audit.audit_event where resource_id = $1 order by local_sequence`,
    [resourceId],
  );
  return result.rows;
}

export interface RecordSecurityEventInput {
  readonly id: string;
  /** NULLABLE by contract (§6.10): a pre-assignment device still emits evidence. */
  readonly tenantId: string | null;
  readonly digitalStoreId: string | null;
  readonly locationId: string | null;
  readonly eventCode: string;
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly deviceId: string | null;
  readonly certificateSerial: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

/**
 * Security/integrity evidence (§6.10). Sources include
 * EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH (offline contract §3) and every fail-closed
 * authorisation denial: a blocked attempt is EVIDENCE, never a silent drop.
 */
export async function recordSecurityEvent(
  client: HubClient,
  input: RecordSecurityEventInput,
): Promise<void> {
  await client.query(
    `insert into edge_audit.security_event
       (id, tenant_id, digital_store_id, location_id, event_code, severity, device_id,
        certificate_serial, detected_at, details_json)
     values ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9::jsonb)`,
    [
      input.id,
      input.tenantId,
      input.digitalStoreId,
      input.locationId,
      input.eventCode,
      input.severity,
      input.deviceId,
      input.certificateSerial,
      JSON.stringify(input.details),
    ],
  );
}

export async function countSecurityEvents(client: HubClient, eventCode: string): Promise<number> {
  const result = await client.query<{ count: string }>(
    `select count(*)::text as count from edge_audit.security_event where event_code = $1`,
    [eventCode],
  );
  return Number(result.rows[0]?.count ?? "0");
}
