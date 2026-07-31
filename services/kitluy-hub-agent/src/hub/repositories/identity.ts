/**
 * `edge_identity` repository adapters (schema contract §6.1).
 *
 * THIN and TYPED: these functions read and write rows. They contain NO business
 * logic and make NO authorisation decision — the decisions live in
 * hub/authorization.ts, and every transition decision belongs to the canonical
 * engines (repository rule 5).
 */
import type { HubClient } from "../db.js";

export interface HubAssignmentRow {
  id: string;
  hub_device_id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  assignment_generation: number;
  status: string;
  ended_at: Date | null;
}

/**
 * The single ACTIVE Hub assignment (§6.1; the partial unique index in 0012
 * guarantees at most one). `assignment_generation` is the first element of the
 * ordering namespace (offline contract §5.1).
 */
export async function findActiveHubAssignment(
  client: HubClient,
): Promise<HubAssignmentRow | undefined> {
  const result = await client.query<HubAssignmentRow>(
    `select id, hub_device_id, tenant_id, digital_store_id, location_id,
            assignment_generation, status, ended_at
       from edge_identity.hub_assignment
      where ended_at is null`,
  );
  return result.rows[0];
}

export interface TerminalDeviceRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  terminal_name: string;
  assignment_generation: number;
  lifecycle_status: string;
  certificate_serial: string;
  last_client_sequence: bigint;
}

export async function findTerminalDevice(
  client: HubClient,
  terminalDeviceId: string,
): Promise<TerminalDeviceRow | undefined> {
  const result = await client.query<TerminalDeviceRow>(
    `select id, tenant_id, digital_store_id, location_id, terminal_name,
            assignment_generation, lifecycle_status, certificate_serial,
            last_client_sequence
       from edge_identity.terminal_device where id = $1`,
    [terminalDeviceId],
  );
  return result.rows[0];
}

export interface DeviceCredentialRow {
  id: string;
  device_id: string;
  /**
   * The identifier a signed revocation snapshot names.
   *
   * Selected because the live device gate consults the persisted offline
   * snapshot by serial: the replicated `status` column is only as fresh as the
   * last successful sync, and the whole point of the snapshot is to answer
   * "is this revoked" when that sync has not happened.
   */
  certificate_serial: string;
  status: string;
  expires_at: Date;
  revoked_at: Date | null;
  revocation_reason: string | null;
}

/**
 * Credential metadata only — no key material is ever stored (§6.1; repository
 * rule 4). A revoked or expired credential must fail the device gate.
 */
export async function findDeviceCredentials(
  client: HubClient,
  deviceId: string,
): Promise<readonly DeviceCredentialRow[]> {
  const result = await client.query<DeviceCredentialRow>(
    `select id, device_id, certificate_serial, status, expires_at, revoked_at, revocation_reason
       from edge_identity.device_credential where device_id = $1`,
    [deviceId],
  );
  return result.rows;
}

export interface TerminalSessionRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  terminal_device_id: string;
  actor_id: string;
  profile_code: string;
  opened_at: Date;
  expires_at: Date;
  closed_at: Date | null;
  session_generation: number;
  status: string;
}

export async function findTerminalSession(
  client: HubClient,
  sessionId: string,
): Promise<TerminalSessionRow | undefined> {
  const result = await client.query<TerminalSessionRow>(
    `select id, tenant_id, digital_store_id, location_id, terminal_device_id,
            actor_id, profile_code, opened_at, expires_at, closed_at,
            session_generation, status
       from edge_identity.terminal_session where id = $1`,
    [sessionId],
  );
  return result.rows[0];
}

export interface StaffCacheRow {
  actor_id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  display_name: string;
  permission_snapshot_version: bigint;
  profile_codes: string[];
  offline_valid_until: Date;
  disabled: boolean;
}

/**
 * Offline-capable actor projection (§6.1). Identity truth is CLOUD; this is a
 * cache, which is why business relations carry `actor_id` without an FK (D11).
 */
export async function findStaffCache(
  client: HubClient,
  actorId: string,
): Promise<StaffCacheRow | undefined> {
  const result = await client.query<StaffCacheRow>(
    `select actor_id, tenant_id, digital_store_id, location_id, display_name,
            permission_snapshot_version, profile_codes, offline_valid_until,
            disabled
       from edge_identity.staff_cache where actor_id = $1`,
    [actorId],
  );
  return result.rows[0];
}
