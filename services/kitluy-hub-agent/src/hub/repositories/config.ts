/**
 * `edge_config` repository adapters (schema contract §6.2).
 *
 * The Hub reads configuration; it never authors it. Snapshots are signed,
 * immutable cloud projections and exactly one is ACTIVE per Location — the
 * `edge_config.active_configuration` view is the only surface that exposes it.
 */
import type { HubClient } from "../db.js";

export interface ActiveConfigurationRow {
  snapshot_id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  snapshot_version: bigint;
  schema_version: number;
  manifest_sha256: string;
  signing_key_id: string;
  not_before: Date;
  expires_at: Date | null;
  activated_at: Date | null;
}

export async function findActiveConfiguration(
  client: HubClient,
  locationId: string,
): Promise<ActiveConfigurationRow | undefined> {
  const result = await client.query<ActiveConfigurationRow>(
    `select snapshot_id, tenant_id, digital_store_id, location_id, snapshot_version,
            schema_version, manifest_sha256, signing_key_id, not_before, expires_at,
            activated_at
       from edge_config.active_configuration where location_id = $1`,
    [locationId],
  );
  return result.rows[0];
}

export interface ConfigurationSectionRow {
  id: string;
  snapshot_id: string;
  section_code: string;
  section_version: bigint;
  content_sha256: string;
  content_json: Record<string, unknown>;
  required: boolean;
  validation_state: string;
}

export async function findConfigurationSection(
  client: HubClient,
  snapshotId: string,
  sectionCode: string,
): Promise<ConfigurationSectionRow | undefined> {
  const result = await client.query<ConfigurationSectionRow>(
    `select id, snapshot_id, section_code, section_version, content_sha256,
            content_json, required, validation_state
       from edge_config.configuration_section
      where snapshot_id = $1 and section_code = $2`,
    [snapshotId, sectionCode],
  );
  return result.rows[0];
}

export interface TerminalProfileAssignmentRow {
  id: string;
  tenant_id: string;
  digital_store_id: string;
  location_id: string;
  terminal_device_id: string;
  profile_code: string;
  assignment_version: bigint;
  enabled: boolean;
  effective_from: Date;
  effective_until: Date | null;
  source_snapshot_id: string;
}

/**
 * Cloud-assigned logical profile grants (§6.2; terminal profile contract §2
 * "Installer cannot self-select profiles"). Only the ACTIVE grant counts.
 */
export async function findActiveProfileAssignment(
  client: HubClient,
  terminalDeviceId: string,
  profileCode: string,
): Promise<TerminalProfileAssignmentRow | undefined> {
  const result = await client.query<TerminalProfileAssignmentRow>(
    `select id, tenant_id, digital_store_id, location_id, terminal_device_id,
            profile_code, assignment_version, enabled, effective_from,
            effective_until, source_snapshot_id
       from edge_config.terminal_profile_assignment
      where terminal_device_id = $1 and profile_code = $2
        and enabled and effective_until is null`,
    [terminalDeviceId, profileCode],
  );
  return result.rows[0];
}

export interface PeripheralBindingRow {
  id: string;
  location_id: string;
  logical_role: string;
  connection_uri: string;
  terminal_device_id: string | null;
  fallback_priority: number;
  enabled: boolean;
}

export async function findPeripheralBinding(
  client: HubClient,
  locationId: string,
  logicalRole: string,
): Promise<PeripheralBindingRow | undefined> {
  const result = await client.query<PeripheralBindingRow>(
    `select id, location_id, logical_role, connection_uri, terminal_device_id,
            fallback_priority, enabled
       from edge_config.peripheral_binding
      where location_id = $1 and logical_role = $2 and enabled
      order by fallback_priority asc
      limit 1`,
    [locationId, logicalRole],
  );
  return result.rows[0];
}
