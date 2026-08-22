/**
 * Pending device registrations, and the HET decision that admits one.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001; plan v1.0.0 §4.1,
 *   §4.3, §4.4; migration 0197 `approve_device_enrollment_v1`.
 *
 * ===========================================================================
 * WHY A READ MODEL SEPARATE FROM device_fleet_status
 * ===========================================================================
 * `device_fleet_status` answers "how is the fleet doing" — lifecycle, freshness,
 * assignment, incident counts. Approving a board is a different question:
 * "is this specific physical device the one HET verified?" That needs the
 * evidence a person compares against the hardware in front of them — the board
 * serial, its corroborating signals, the registration key fingerprint, which
 * installation generation this is — none of which the fleet view carries, and
 * none of which belongs in a list built for operations dashboards.
 *
 * ===========================================================================
 * THIS MODULE READS EVIDENCE. IT DOES NOT DECIDE TRUST.
 * ===========================================================================
 * Everything here is SELF-REPORTED by the device (contract §6). A row in this
 * list is a claim, not a verified fact — that is the whole reason an approval
 * step exists. The UI is required to present it as "Verify & Approve", never as
 * a one-click "Trust Device" (plan §4.4), and this module names its fields so
 * that reading them out loud against real hardware is the natural action.
 */
import type pg from "pg";

import type { DatabaseHandle } from "./authorization.js";

/**
 * One pending board, with the evidence a verifier compares against hardware.
 *
 * Field names deliberately say what the value IS rather than what it proves:
 * `reportedHostname`, not `hostname`; `claimedBoardSerial`, not `boardSerial`.
 * A verifier reading this list must never be able to forget that the device
 * chose these values.
 */
export interface PendingRegistrationDto {
  /** Opaque, server-generated. The one identifier safe to quote over the phone. */
  readonly deviceId: string;
  readonly deviceReference: string;
  readonly deviceClass: string;
  readonly hardwareProfile: string | null;
  readonly lifecycle: string;
  readonly trustLevel: string | null;
  /** Self-reported by the device. Mutable, non-secret, never an identity. */
  readonly reportedHostname: string | null;
  /** The signal that RESOLVES a board, per plan §1.4. Self-reported. */
  readonly claimedBoardSerial: string | null;
  /** Corroborating only — never sufficient alone to merge two devices. */
  readonly claimedSocSerial: string | null;
  readonly claimedMacAddress: string | null;
  /** Which installation generation this board is currently on. */
  readonly installationGeneration: number | null;
  readonly imageRelease: string | null;
  /** SHA-256 of the registration key's SPKI DER, as the database stores it. */
  readonly registrationKeyFingerprint: string | null;
  readonly enrollmentSequence: number | null;
  readonly firstSeenAt: string | null;
  readonly lastRegistrationAt: string | null;
  /**
   * Open trust incidents. A non-empty list makes the device UNAPPROVABLE — the
   * governed door refuses it — so the UI must disable approval and say why
   * rather than letting a verifier discover it as a server error.
   */
  readonly openIncidents: readonly PendingIncidentDto[];
  readonly suspectedCredentialReuse: boolean;
  /** Derived, never stored: approval is what records verification. */
  readonly verificationEvidenceRecorded: false;
  readonly approvable: boolean;
  readonly blockingReasons: readonly string[];
}

export interface PendingIncidentDto {
  readonly incidentType: string;
  readonly severity: string;
  readonly detectedAt: string;
  readonly detail: string | null;
}

interface PendingRow {
  device_id: string;
  asset_tag: string;
  device_class: string;
  lifecycle_state: string;
  hardware_trust_level: string | null;
  profile_key: string | null;
  reported_hostname: string | null;
  board_serial: string | null;
  soc_serial: string | null;
  mac_address: string | null;
  installation_generation: string | number | null;
  image_release_ref: string | null;
  key_fingerprint: string | null;
  enrollment_sequence: string | number | null;
  first_seen_at: string | null;
  last_registration_at: string | null;
  incidents: readonly PendingIncidentDto[] | null;
}

/**
 * The predicate MUST match `approve_device_enrollment_v1`'s own open-incident
 * check, `activation_blocked` exclusion included. If the list said "approvable"
 * and the door disagreed, every verifier would meet an unexplained refusal after
 * typing a reason.
 */
const OPEN_INCIDENT_PREDICATE = `cleared_at is null and incident_type <> 'activation_blocked'`;

/** Only `manufactured` is approvable — every other state is a containment exit. */
const PENDING_QUERY = `
  select d.id                                   as device_id,
         d.asset_tag,
         d.device_class::text                   as device_class,
         d.lifecycle_state::text                as lifecycle_state,
         d.hardware_trust_level::text           as hardware_trust_level,
         hp.profile_key,
         d.reported_hostname,
         sig.board_serial,
         sig.soc_serial,
         sig.mac_address,
         di.generation                          as installation_generation,
         di.image_release_ref,
         me.device_public_key_fingerprint       as key_fingerprint,
         me.enrollment_sequence,
         d.created_at                           as first_seen_at,
         di.created_at                          as last_registration_at,
         inc.incidents
    from kitluy_devices.devices d
    left join kitluy_devices.hardware_profiles hp on hp.id = d.hardware_profile_id
    left join kitluy_devices.manufacturing_enrollments me on me.id = d.current_enrollment_id
    -- The CURRENT installation only. Superseded generations are history and
    -- would multiply every device row if joined without this filter.
    left join lateral (
      select generation, image_release_ref, created_at
        from kitluy_devices.device_installations
       where device_record_id = d.id and superseded_at is null
       order by generation desc
       limit 1
    ) di on true
    -- Board evidence, pivoted from the latest sealed manifest. Storage signals
    -- are deliberately NOT selected: plan §1.4 excludes them from board
    -- resolution, and showing them beside board serials would invite a verifier
    -- to treat a card as identity.
    left join lateral (
      select max(hms.signal_value) filter (where hms.signal_type::text = 'board_serial') as board_serial,
             max(hms.signal_value) filter (where hms.signal_type::text = 'soc_serial')   as soc_serial,
             max(hms.signal_value) filter (where hms.signal_type::text = 'mac_address')  as mac_address
        from kitluy_devices.hardware_manifests hm
        join kitluy_devices.hardware_manifest_signals hms on hms.manifest_id = hm.id
       where hm.device_id = d.id
    ) sig on true
    left join lateral (
      select jsonb_agg(jsonb_build_object(
               'incidentType', ti.incident_type::text,
               'severity',     ti.severity::text,
               'detectedAt',   ti.detected_at,
               'detail',       ti.detail
             ) order by ti.detected_at desc) as incidents
        from kitluy_devices.device_trust_incidents ti
       where ti.device_id = d.id and ${OPEN_INCIDENT_PREDICATE}
    ) inc on true
   where d.lifecycle_state = 'manufactured'
   order by d.created_at desc
   limit $1`;

function toDto(row: PendingRow): PendingRegistrationDto {
  const incidents = row.incidents ?? [];
  const suspectedCredentialReuse = incidents.some(
    (i) => i.incidentType === "credential_reuse_detected",
  );

  // Stated as REASONS, not as a bare boolean. A verifier who cannot approve is
  // owed the cause; "Approve is disabled" with no explanation is how an operator
  // concludes the tool is broken.
  const blockingReasons: string[] = [];
  if (incidents.length > 0) {
    blockingReasons.push(
      `${incidents.length} open trust incident(s) must be cleared through the containment door first`,
    );
  }
  if (row.board_serial === null) {
    // Not fatal to the DOOR, but a verifier has nothing to compare against the
    // hardware, which makes "verified" a word without content.
    blockingReasons.push(
      "no board serial was reported, so this board cannot be identified by hand",
    );
  }

  return {
    deviceId: row.device_id,
    deviceReference: row.asset_tag,
    deviceClass: row.device_class,
    hardwareProfile: row.profile_key,
    lifecycle: row.lifecycle_state,
    trustLevel: row.hardware_trust_level,
    reportedHostname: row.reported_hostname,
    claimedBoardSerial: row.board_serial,
    claimedSocSerial: row.soc_serial,
    claimedMacAddress: row.mac_address,
    installationGeneration:
      row.installation_generation === null ? null : Number(row.installation_generation),
    imageRelease: row.image_release_ref,
    registrationKeyFingerprint: row.key_fingerprint,
    enrollmentSequence: row.enrollment_sequence === null ? null : Number(row.enrollment_sequence),
    firstSeenAt: row.first_seen_at,
    lastRegistrationAt: row.last_registration_at,
    openIncidents: incidents,
    suspectedCredentialReuse,
    verificationEvidenceRecorded: false,
    approvable: blockingReasons.length === 0,
    blockingReasons,
  };
}

export async function listPendingRegistrations(
  db: DatabaseHandle,
  options: { readonly limit?: number } = {},
): Promise<readonly PendingRegistrationDto[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 500);
  const { rows } = await db.query<PendingRow>(PENDING_QUERY, [limit]);
  return rows.map(toDto);
}

// ---------------------------------------------------------------------------
// The approval itself
// ---------------------------------------------------------------------------

export interface DeviceApprovalDeps {
  readonly pool: pg.Pool;
}

export interface ApproveEnrollmentInput {
  readonly deviceId: string;
  /** Names the human. Recorded in the immutable lifecycle event. */
  readonly actorRef: string;
  readonly reason: string;
  readonly verificationEvidenceRef: string;
  /** Required by the door in pilot/production, and refused if it equals actorRef. */
  readonly secondApproverRef?: string;
  readonly environment: string;
}

export type ApproveEnrollmentResult =
  | { readonly kind: "approved"; readonly deviceId: string; readonly lifecycleState: string }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

/**
 * Every refusal the governed door can raise, mapped to operator-facing text.
 *
 * The door's own message is NOT forwarded verbatim: it is a PostgreSQL exception
 * string that names internal state and counts. What a verifier needs is what to
 * do next, and the machine-readable code is returned alongside so a client can
 * branch without parsing prose.
 */
const REFUSAL_MESSAGES: Readonly<Record<string, string>> = {
  "KLUY-APPROVE-NO-REASON": "A reason is required to admit hardware to the trusted fleet.",
  "KLUY-APPROVE-NO-VERIFICATION":
    "A verification evidence reference is required — approval records WHAT was verified, not only who approved.",
  "KLUY-APPROVE-NO-ACTOR": "The approver could not be identified.",
  "KLUY-APPROVE-FOUR-EYES-REQUIRED":
    "This environment requires a second, different approver before a device may be admitted.",
  "KLUY-APPROVE-FOUR-EYES-SAME-ACTOR": "The second approver must be a different person.",
  "KLUY-APPROVE-NO-DEVICE": "No such device.",
  "KLUY-APPROVE-WRONG-STATE":
    "Only a pending device may be approved. This device is in another state, and containment decisions are never undone by an approval.",
  "KLUY-APPROVE-OPEN-INCIDENT":
    "This device has an open trust incident. Clear it through the containment door first — a suspected clone must not be approved past its own security finding.",
};

/** `KLUY-…` prefix of a governed refusal, or null when the error is not one. */
function refusalCode(message: string): string | null {
  const match = /^(KLUY-[A-Z0-9-]+):/.exec(message);
  return match?.[1] ?? null;
}

/**
 * Admit one verified board to the trusted fleet.
 *
 * ===========================================================================
 * WHY THIS ENTERS service_role
 * ===========================================================================
 * Migration 0197 grants `approve_device_enrollment_v1` to `service_role` and to
 * nothing else — deliberately, so the identity that ACCEPTS an untrusted
 * registration (`kitluy_device_registration_service`) cannot APPROVE one.
 * There is no narrower role holding this capability today, so this is the
 * authorized path rather than a chosen one. A dedicated
 * `kitluy_device_approval_service` holding exactly this one EXECUTE would be
 * better and needs a migration; it is recorded as a follow-up.
 *
 * The role is entered INSIDE the transaction (`set local`), so it lasts exactly
 * as long as this one call and cannot leak to the next request on a pooled
 * connection.
 *
 * Authority to ACT was already decided by `authorizeRequest` against the human's
 * permissions before this function is reached. This transaction is the mechanism,
 * never the decision.
 */
export async function approveDeviceEnrollment(
  deps: DeviceApprovalDeps,
  input: ApproveEnrollmentInput,
): Promise<ApproveEnrollmentResult> {
  const client = await deps.pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");

    const { rows } = await client.query<{ result: { lifecycle_state?: string } }>(
      `select kitluy_devices.approve_device_enrollment_v1($1::uuid, $2, $3, $4, $5, $6) as result`,
      [
        input.deviceId,
        input.actorRef,
        input.reason,
        input.environment,
        input.verificationEvidenceRef,
        input.secondApproverRef ?? null,
      ],
    );
    await client.query("commit");

    return {
      kind: "approved",
      deviceId: input.deviceId,
      lifecycleState: rows[0]?.result?.lifecycle_state ?? "enrolled",
    };
  } catch (error) {
    // Roll back before anything else. A failed approval must leave no partial
    // lifecycle event behind — the event and the state change are one decision.
    try {
      await client.query("rollback");
    } catch {
      /* the connection is already unusable; the pool will discard it */
    }

    const message = error instanceof Error ? error.message : String(error);
    const code = refusalCode(message);
    if (code !== null) {
      return {
        kind: "refused",
        code,
        detail: REFUSAL_MESSAGES[code] ?? "This approval was refused.",
      };
    }
    // Not a governed refusal: a real fault. Rethrown so it surfaces as a 500
    // rather than being reported to a verifier as a decision about their device.
    throw error;
  } finally {
    client.release();
  }
}
