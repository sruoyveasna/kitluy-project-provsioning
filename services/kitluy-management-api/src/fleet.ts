/**
 * Governed fleet read model.
 *
 * Reads `kitluy_devices.device_fleet_status` with the server's TRUSTED
 * identity, only after `authorizeRequest` has already decided the CALLER may.
 * Authorization happens first and separately; this module performs no
 * permission checks and must never be called without one.
 *
 * ===========================================================================
 * WHY A DTO AND NOT THE ROW
 * ===========================================================================
 * The read model carries binding evidence a fleet screen has no need for —
 * `device_public_key_fingerprint`, `manifest_sha256`, `enrollment_sequence`.
 * None of those are secrets, but they are device-identity evidence, and
 * returning a whole row "because it was already selected" is how internal
 * evidence ends up in a browser, a screenshot and eventually a support ticket.
 * Fields are therefore selected explicitly, never spread.
 */

import type { DatabaseHandle } from "./authorization.js";

/** Non-secret fleet summary safe for an authorized Admin browser. */
export interface FleetDeviceDto {
  readonly deviceId: string;
  readonly deviceReference: string;
  readonly deviceClass: string;
  readonly hardwareProfile: string | null;
  readonly lifecycle: string;
  readonly trustLevel: string | null;
  readonly certificateStatus: string | null;
  readonly assignmentState: string | null;
  readonly tenantReference: string | null;
  readonly digitalStoreReference: string | null;
  readonly locationReference: string | null;
  readonly terminalAssignmentCount: number;
  readonly openIncidentCount: number;
  readonly lastSeenAt: string | null;
  readonly fleetStatus: string | null;
  /** Derived, never stored. See `deriveFreshness`. */
  readonly freshness: FleetFreshness;
  /** Derived from canonical lifecycle/trust facts. Presentation only. */
  readonly requiresAttention: boolean;
}

export type FleetFreshness = "ONLINE" | "STALE" | "OFFLINE" | "NEVER_SEEN" | "UNKNOWN";

/**
 * Lifecycle states that must never read as an ordinary healthy device.
 * Mirrors `kitluy_devices.device_lifecycle_state`.
 */
const ATTENTION_LIFECYCLES: ReadonlySet<string> = new Set([
  "quarantined",
  "restricted_investigation",
  "suspended",
  "retired",
  "replaced",
]);

/**
 * Freshness thresholds are an owner value the repository has NOT ruled.
 *
 * Until it does, every device with a heartbeat reports `UNKNOWN` rather than a
 * guessed `ONLINE`. Inventing "5 minutes" here would put a number an operator
 * trusts in front of them with nothing behind it. `NEVER_SEEN` is still
 * reported, because "no heartbeat has ever arrived" is a fact, not a threshold.
 */
export interface FreshnessPolicy {
  readonly staleAfterSeconds: number | null;
  readonly offlineAfterSeconds: number | null;
}

export const UNRULED_FRESHNESS_POLICY: FreshnessPolicy = {
  staleAfterSeconds: null,
  offlineAfterSeconds: null,
};

export function deriveFreshness(
  lastSeenAt: string | null,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FleetFreshness {
  if (lastSeenAt === null) return "NEVER_SEEN";
  if (policy.staleAfterSeconds === null || policy.offlineAfterSeconds === null) return "UNKNOWN";
  const ageSeconds = (now.getTime() - new Date(lastSeenAt).getTime()) / 1000;
  if (Number.isNaN(ageSeconds)) return "UNKNOWN";
  if (ageSeconds >= policy.offlineAfterSeconds) return "OFFLINE";
  if (ageSeconds >= policy.staleAfterSeconds) return "STALE";
  return "ONLINE";
}

interface FleetRow {
  device_record_id: string;
  asset_tag: string;
  device_class: string;
  lifecycle_state: string;
  hardware_trust_level: string | null;
  certificate_status: string | null;
  profile_key: string | null;
  assignment_state: string | null;
  tenant_id: string | null;
  digital_store_id: string | null;
  store_location_id: string | null;
  terminal_assignment_count: string | number | null;
  open_incident_count: string | number | null;
  last_observed_at: string | null;
  fleet_status: string | null;
}

function toDto(row: FleetRow, policy: FreshnessPolicy, now: Date): FleetDeviceDto {
  return {
    deviceId: row.device_record_id,
    deviceReference: row.asset_tag,
    deviceClass: row.device_class,
    hardwareProfile: row.profile_key,
    lifecycle: row.lifecycle_state,
    trustLevel: row.hardware_trust_level,
    certificateStatus: row.certificate_status,
    assignmentState: row.assignment_state,
    tenantReference: row.tenant_id,
    digitalStoreReference: row.digital_store_id,
    locationReference: row.store_location_id,
    terminalAssignmentCount: Number(row.terminal_assignment_count ?? 0),
    openIncidentCount: Number(row.open_incident_count ?? 0),
    lastSeenAt: row.last_observed_at,
    fleetStatus: row.fleet_status,
    freshness: deriveFreshness(row.last_observed_at, policy, now),
    requiresAttention:
      ATTENTION_LIFECYCLES.has(row.lifecycle_state) || Number(row.open_incident_count ?? 0) > 0,
  };
}

const FLEET_COLUMNS = `device_record_id, asset_tag, device_class, lifecycle_state,
       hardware_trust_level, certificate_status, profile_key, assignment_state,
       tenant_id, digital_store_id, store_location_id,
       terminal_assignment_count, open_incident_count, last_observed_at, fleet_status`;

export async function listFleet(
  db: DatabaseHandle,
  options: { readonly limit?: number; readonly policy?: FreshnessPolicy; readonly now?: Date } = {},
): Promise<readonly FleetDeviceDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const { rows } = await db.query<FleetRow>(
    `select ${FLEET_COLUMNS}
       from kitluy_devices.device_fleet_status
      order by asset_tag
      limit $1`,
    [limit],
  );
  const policy = options.policy ?? UNRULED_FRESHNESS_POLICY;
  const now = options.now ?? new Date();
  return rows.map((r) => toDto(r, policy, now));
}

export async function getFleetDevice(
  db: DatabaseHandle,
  deviceId: string,
  options: { readonly policy?: FreshnessPolicy; readonly now?: Date } = {},
): Promise<FleetDeviceDto | null> {
  const { rows } = await db.query<FleetRow>(
    `select ${FLEET_COLUMNS}
       from kitluy_devices.device_fleet_status
      where device_record_id = $1::uuid`,
    [deviceId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return toDto(row, options.policy ?? UNRULED_FRESHNESS_POLICY, options.now ?? new Date());
}

// ---------------------------------------------------------------------------
// Provisioning readiness
// ---------------------------------------------------------------------------

export interface ProvisioningReadiness {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

/**
 * May a provisioning session be issued for this device?
 *
 * DERIVED from canonical facts — there is no stored `PROVISIONING_ELIGIBLE`
 * flag and none is created. A stored flag is a second copy of the truth, and
 * the copy is what goes stale: a device quarantined after being marked
 * eligible would still read as eligible.
 *
 * This is a PRESENTATION gate that lets the UI disable a button and explain
 * why. It is not the security boundary — the governed issuance path revalidates
 * everything server-side, and a caller who defeats this still gets refused.
 */
export function evaluateProvisioningReadiness(device: FleetDeviceDto): ProvisioningReadiness {
  const reasons: string[] = [];

  if (device.lifecycle !== "enrolled") {
    reasons.push(`lifecycle is '${device.lifecycle}'; only an enrolled device may be provisioned`);
  }
  if (ATTENTION_LIFECYCLES.has(device.lifecycle)) {
    reasons.push(`device is ${device.lifecycle} — provisioning is forbidden`);
  }
  if (device.openIncidentCount > 0) {
    reasons.push(`${device.openIncidentCount} open trust incident(s)`);
  }
  if (device.certificateStatus === "revoked") {
    reasons.push("device certificate is revoked");
  }
  if (device.assignmentState === "active") {
    reasons.push("device already holds an active assignment");
  }

  return { eligible: reasons.length === 0, reasons };
}
