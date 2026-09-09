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
  /**
   * `store_code — name` and `location_code — name`: the same human labels the
   * Partner route builds in `listPartnerStores`. The `*Reference` fields above
   * are raw ids and were never rendered; an Admin telling a Terminal's Store
   * apart needs the words.
   */
  readonly digitalStoreLabel: string | null;
  readonly locationLabel: string | null;
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
  digital_store_label: string | null;
  location_label: string | null;
  terminal_assignment_count: string | number | null;
  open_incident_count: string | number | null;
  last_observed_at: string | null;
  /** Group 0216. The 60s registration beat; null until a board has polled once. */
  last_seen_at: string | null;
  fleet_status: string | null;
}

/**
 * The most recent moment ANY source saw this device, or null when none did.
 *
 * There are two independent sources and neither subsumes the other:
 * `last_observed_at` is enrolment-time hardware evidence, which is null for
 * every board still waiting for approval, and `last_seen_at` is the 60s
 * registration beat `bin/cloud-registration.ts` sends for as long as the board
 * is powered. Reporting only the first is why a running Pi read `NEVER_SEEN`.
 *
 * Composed HERE rather than in the view: `device_fleet_status.last_observed_at`
 * has a settled meaning that group 0122 owns, and widening it in place would
 * change that column for every other reader. This route decides what "seen"
 * means for an operator looking at a badge.
 */
function mostRecent(a: string | null | undefined, b: string | null | undefined): string | null {
  // `undefined`, not just `null`: a row from a query that did not select the
  // column has the field ABSENT. Treating that as a date produced NaN, which
  // `deriveFreshness` reports as UNKNOWN — a device that was plainly ONLINE
  // read as unknowable because of a column nobody asked for.
  const left = a ?? null;
  const right = b ?? null;
  if (left === null) return right;
  if (right === null) return left;
  const lt = new Date(left).getTime();
  const rt = new Date(right).getTime();
  // An unparseable timestamp must not win the comparison and blank out a good one.
  if (Number.isNaN(lt)) return Number.isNaN(rt) ? null : right;
  if (Number.isNaN(rt)) return left;
  return lt >= rt ? left : right;
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
    digitalStoreLabel: row.digital_store_label ?? null,
    locationLabel: row.location_label ?? null,
    terminalAssignmentCount: Number(row.terminal_assignment_count ?? 0),
    openIncidentCount: Number(row.open_incident_count ?? 0),
    lastSeenAt: mostRecent(row.last_observed_at, row.last_seen_at),
    fleetStatus: row.fleet_status,
    freshness: deriveFreshness(mostRecent(row.last_observed_at, row.last_seen_at), policy, now),
    requiresAttention:
      ATTENTION_LIFECYCLES.has(row.lifecycle_state) || Number(row.open_incident_count ?? 0) > 0,
  };
}

// The Store and Location names are read here, with the server's trusted
// identity, only after `authorizeRequest` has decided the caller may see the
// fleet at all — the same precedent as `resolveStoreScope` reading
// `kitluy_core` for the Partner route. Left joins: an unassigned device has no
// Store, and that is a null, not a missing row.
const FLEET_COLUMNS = `f.device_record_id, f.asset_tag, f.device_class, f.lifecycle_state,
       f.hardware_trust_level, f.certificate_status, f.profile_key, f.assignment_state,
       f.tenant_id, f.digital_store_id, f.store_location_id,
       ds.store_code || ' — ' || ds.name as digital_store_label,
       sl.location_code || ' — ' || sl.name as location_label,
       f.terminal_assignment_count, f.open_incident_count, f.last_observed_at,
       f.last_seen_at, f.fleet_status`;

const FLEET_FROM = `kitluy_devices.device_fleet_status f
       left join kitluy_core.digital_stores ds on ds.id = f.digital_store_id
       left join kitluy_core.store_locations sl on sl.id = f.store_location_id`;

export async function listFleet(
  db: DatabaseHandle,
  options: { readonly limit?: number; readonly policy?: FreshnessPolicy; readonly now?: Date } = {},
): Promise<readonly FleetDeviceDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const { rows } = await db.query<FleetRow>(
    `select ${FLEET_COLUMNS}
       from ${FLEET_FROM}
      order by f.asset_tag
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
       from ${FLEET_FROM}
      where f.device_record_id = $1::uuid`,
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
 * ===========================================================================
 * ONE PREDICATE, IN THE DATABASE
 * ===========================================================================
 * This used to re-implement the rule in TypeScript, and it was one of THREE
 * definitions that disagreed (recorded under KLD-2026-09-03-FACTORY-ENROLLMENT-001).
 * Since group 0214 there is exactly one: `evaluate_provisioning_eligibility_v1`.
 * The terminal pairing door reads it, and so does this route. The DTO shape is
 * unchanged; the reasons are the door's own text, rendered verbatim.
 *
 * Still a PRESENTATION gate, never the security boundary: the governed doors
 * re-evaluate under their own locks.
 */
export function toProvisioningReadiness(
  row:
    { readonly eligible: boolean | null; readonly reasons: readonly string[] | null } | undefined,
): ProvisioningReadiness {
  if (row === undefined) {
    // Fail CLOSED: no verdict is not a yes.
    return { eligible: false, reasons: ["eligibility could not be evaluated"] };
  }
  return { eligible: row.eligible === true, reasons: row.reasons ?? [] };
}

export async function readProvisioningReadiness(
  db: DatabaseHandle,
  deviceId: string,
): Promise<ProvisioningReadiness> {
  const { rows } = await db.query<{ eligible: boolean | null; reasons: string[] | null }>(
    `select eligible, reasons from kitluy_devices.evaluate_provisioning_eligibility_v1($1::uuid)`,
    [deviceId],
  );
  return toProvisioningReadiness(rows[0]);
}

// ---------------------------------------------------------------------------
// Assignment context — where a device is, in words
// ---------------------------------------------------------------------------

/**
 * The live assignment of a device, with human labels, its terminal profile
 * keys and the physical terminal (seat) it holds. Null when unassigned. Read
 * with the trusted identity after `fleet.read` has been decided.
 */
export interface DeviceAssignmentContext {
  readonly assignmentState: string;
  readonly tenantReference: string | null;
  readonly digitalStoreReference: string | null;
  readonly locationReference: string | null;
  readonly terminalProfileKeys: readonly string[];
  readonly physicalTerminalId: string | null;
  readonly physicalTerminalLabel: string | null;
}

export async function readDeviceAssignmentContext(
  db: DatabaseHandle,
  deviceId: string,
): Promise<DeviceAssignmentContext | null> {
  const { rows } = await db.query<{
    assignment_state: string;
    tenant_reference: string | null;
    digital_store_reference: string | null;
    location_reference: string | null;
    terminal_profile_keys: string[] | null;
    physical_terminal_id: string | null;
    physical_terminal_label: string | null;
  }>(
    `select a.state::text                                               as assignment_state,
            t.tenant_code || ' — ' || coalesce(t.display_name, t.legal_name) as tenant_reference,
            ds.store_code || ' — ' || ds.name                             as digital_store_reference,
            sl.location_code || ' — ' || sl.name                          as location_reference,
            coalesce((select array_agg(ta.terminal_profile_key order by ta.assigned_at)
                        from kitluy_devices.device_terminal_assignments ta
                       where ta.assignment_id = a.id and ta.state <> 'revoked'),
                     '{}'::text[])                                        as terminal_profile_keys,
            pt.id                                                         as physical_terminal_id,
            pt.label                                                      as physical_terminal_label
       from kitluy_devices.device_assignments a
       join kitluy_core.tenants t on t.id = a.tenant_id
       join kitluy_core.digital_stores ds on ds.id = a.digital_store_id
       join kitluy_core.store_locations sl on sl.id = a.store_location_id
       left join kitluy_devices.physical_terminals pt
              on pt.bound_device_id = a.device_id and pt.bound_assignment_id = a.id
      where a.device_id = $1::uuid and a.state in ('pending_trust', 'active')
      order by a.assignment_generation desc
      limit 1`,
    [deviceId],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    assignmentState: row.assignment_state,
    tenantReference: row.tenant_reference,
    digitalStoreReference: row.digital_store_reference,
    locationReference: row.location_reference,
    terminalProfileKeys: row.terminal_profile_keys ?? [],
    physicalTerminalId: row.physical_terminal_id,
    physicalTerminalLabel: row.physical_terminal_label,
  };
}
