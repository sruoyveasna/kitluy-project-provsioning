/**
 * Factory enrollment gateway composition.
 *
 * ===========================================================================
 * THIS REUSES CANONICAL SQL. IT DOES NOT REPLACE IT.
 * ===========================================================================
 * The device registry, manufacturing enrollment, hardware manifest and trust
 * model were delivered by WS-11 in migration group 0120. This module is a thin
 * composition over the governed entry points that already exist:
 *
 *   kitluy_devices.enroll_device_v1(...)            -> creates the device record
 *   kitluy_devices.record_hardware_observation_v1() -> post-enrollment evidence
 *   kitluy_devices.devices / device_assignments     -> canonical state read
 *
 * It creates no table, no enum and no parallel identity model. Every scope
 * value — device_class, lifecycle_state, device_record_id — is DERIVED BY THE
 * DATABASE from the hardware profile and the governed function, never asserted
 * by the caller. A device names what it is enrolling, never what it is.
 *
 * The `DatabaseHandle` port keeps this testable and keeps the agent free of a
 * driver dependency: the caller supplies the connection, so the agent package
 * still declares zero runtime dependencies.
 */

import type { DeviceClass, DeviceLifecycleState } from "./enrollment.js";
import type { HardwareSignal, QaReport } from "./factory.js";

/**
 * The canonical fingerprint format, mirrored from
 * `manufacturing_enrollments_fingerprint_format_chk`: 64 lowercase hex
 * characters (a SHA-256 digest).
 */
export const CANONICAL_FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

/** Minimal query port — satisfied by `pg.Client`, `pg.Pool`, or a fake. */
export interface DatabaseHandle {
  query<R = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: R[] }>;
}

export interface FactoryEnrollmentRequest {
  readonly assetTag: string;
  readonly hardwareProfileKey: string;
  readonly devicePublicKeyFingerprint: string;
  readonly publicKeyAlgorithm: string;
  readonly keyStorageClass: string;
  readonly enrollmentStationKey: string;
  readonly enrollmentOperatorRef: string;
  readonly signals: readonly HardwareSignal[];
  readonly enrollmentBatchRef?: string;
}

export type FactoryEnrollmentResult =
  | {
      readonly kind: "enrolled";
      readonly deviceRecordId: string;
      /** Server-derived from the hardware profile — never supplied by the device. */
      readonly deviceClass: DeviceClass;
      readonly lifecycleState: DeviceLifecycleState;
      readonly hasActiveAssignment: boolean;
      /** True when this call created the record; false when it was already present. */
      readonly created: boolean;
    }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly detail: string;
      readonly retryable: boolean;
    };

/**
 * Canonical error codes the governed functions raise. Mapped rather than
 * passed through so a caller never sees a SQLSTATE, a function name or a
 * schema identity — those leak the shape of the security model.
 */
const REFUSAL_CODES: readonly (readonly [RegExp, string, boolean])[] = [
  [/KLUY-DEVICE-EVIDENCE-MISSING/, "KLUY-DEVICE-EVIDENCE-MISSING", false],
  [/KLUY-DEVICE-EVIDENCE-DUPLICATE/, "KLUY-DEVICE-EVIDENCE-DUPLICATE", false],
  [/KLUY-DEVICE-PROFILE/, "KLUY-DEVICE-PROFILE-INVALID", false],
  [/KLUY-DEVICE-STATION/, "KLUY-DEVICE-STATION-INVALID", false],
  [/KLUY-DEVICE-PKI-UNCONFIGURED/, "KLUY-DEVICE-PKI-UNCONFIGURED", false],
  [/connection|ECONNREFUSED|timeout|terminated/i, "KLUY-ENROLLMENT-UNAVAILABLE", true],
];

function classifyRefusal(error: unknown): { code: string; detail: string; retryable: boolean } {
  const raw = error instanceof Error ? error.message : String(error);
  for (const [pattern, code, retryable] of REFUSAL_CODES) {
    if (pattern.test(raw)) {
      return { code, detail: code, retryable };
    }
  }
  // Deliberately opaque: an unrecognised database error is not forwarded
  // verbatim to a factory-floor client.
  return { code: "KLUY-ENROLLMENT-REFUSED", detail: "enrollment refused", retryable: false };
}

/**
 * Perform factory enrollment.
 *
 * IDEMPOTENCY. The device's public-key fingerprint is the natural idempotency
 * key: a device that reboots mid-enrollment and retries presents the same
 * fingerprint, and must end up as the SAME device rather than a second one.
 * This looks up an existing record by fingerprint before enrolling, so a
 * replayed request has one business effect.
 */
export async function enrollDeviceAtFactory(
  db: DatabaseHandle,
  request: FactoryEnrollmentRequest,
): Promise<FactoryEnrollmentResult> {
  // Local shape check before the request leaves the device. The canonical
  // schema enforces `^[0-9a-f]{64}$` too, but a constraint violation surfaces
  // as an opaque refusal — catching it here names the actual problem and
  // saves a factory-floor round trip.
  if (!CANONICAL_FINGERPRINT_PATTERN.test(request.devicePublicKeyFingerprint)) {
    return {
      kind: "refused",
      code: "KLUY-DEVICE-FINGERPRINT-MALFORMED",
      detail: "device public key fingerprint must be 64 lowercase hex characters",
      retryable: false,
    };
  }

  try {
    const existing = await findDeviceByFingerprint(db, request.devicePublicKeyFingerprint);
    if (existing !== null) {
      return { ...existing, kind: "enrolled", created: false };
    }

    const { rows } = await db.query<{ device_id: string }>(
      `select kitluy_devices.enroll_device_v1(
         $1::text,
         (select id from kitluy_devices.hardware_profiles
           where profile_key = $2 and is_active),
         now(),
         $3::text, $4::text, $5::text, $6::text, $7::text,
         $8::jsonb, $9::text
       ) as device_id`,
      [
        request.assetTag,
        request.hardwareProfileKey,
        request.devicePublicKeyFingerprint,
        request.publicKeyAlgorithm,
        request.keyStorageClass,
        request.enrollmentStationKey,
        request.enrollmentOperatorRef,
        JSON.stringify(request.signals),
        request.enrollmentBatchRef ?? null,
      ],
    );

    const deviceId = rows[0]?.device_id;
    if (deviceId === undefined) {
      return {
        kind: "refused",
        code: "KLUY-ENROLLMENT-REFUSED",
        detail: "no device id returned",
        retryable: false,
      };
    }

    const state = await readCanonicalState(db, deviceId);
    if (state === null) {
      return {
        kind: "refused",
        code: "KLUY-ENROLLMENT-REFUSED",
        detail: "device not readable after enrollment",
        retryable: false,
      };
    }
    return { ...state, kind: "enrolled", created: true };
  } catch (error) {
    const { code, detail, retryable } = classifyRefusal(error);
    return { kind: "refused", code, detail, retryable };
  }
}

interface CanonicalState {
  readonly deviceRecordId: string;
  readonly deviceClass: DeviceClass;
  readonly lifecycleState: DeviceLifecycleState;
  readonly hasActiveAssignment: boolean;
}

/**
 * Read canonical device state.
 *
 * `hasActiveAssignment` is computed from `device_assignments`, not from a
 * column on `devices` — which is what makes "enrolled and unassigned" a
 * derived fact rather than a second stored state that could disagree.
 */
export async function readCanonicalState(
  db: DatabaseHandle,
  deviceRecordId: string,
): Promise<CanonicalState | null> {
  const { rows } = await db.query<{
    id: string;
    device_class: DeviceClass;
    lifecycle_state: DeviceLifecycleState;
    active_assignments: string;
  }>(
    `select d.id,
            d.device_class::text   as device_class,
            d.lifecycle_state::text as lifecycle_state,
            (select count(*) from kitluy_devices.device_assignments a
              where a.device_id = d.id and a.state = 'active') as active_assignments
       from kitluy_devices.devices d
      where d.id = $1::uuid`,
    [deviceRecordId],
  );

  const row = rows[0];
  if (row === undefined) return null;
  return {
    deviceRecordId: row.id,
    deviceClass: row.device_class,
    lifecycleState: row.lifecycle_state,
    hasActiveAssignment: Number(row.active_assignments) > 0,
  };
}

async function findDeviceByFingerprint(
  db: DatabaseHandle,
  fingerprint: string,
): Promise<CanonicalState | null> {
  const { rows } = await db.query<{ device_id: string }>(
    `select e.device_id
       from kitluy_devices.manufacturing_enrollments e
      where e.device_public_key_fingerprint = $1
        and e.state = 'sealed'
      limit 1`,
    [fingerprint],
  );
  const deviceId = rows[0]?.device_id;
  return deviceId === undefined ? null : readCanonicalState(db, deviceId);
}

/**
 * Read the facts `evaluateProvisioningEligibility` needs, in one query.
 *
 * `hardwareManifestSealed` and `hardwareProfileCertified` come from the
 * database rather than from the device's own claims — a device asserting its
 * own manifest was sealed would make the seal meaningless.
 */
export async function readEligibilityFacts(
  db: DatabaseHandle,
  deviceRecordId: string,
): Promise<{
  canonicalLifecycle: DeviceLifecycleState | null;
  hasActiveAssignment: boolean;
  hardwareManifestSealed: boolean;
  hardwareProfileCertified: boolean;
} | null> {
  const { rows } = await db.query<{
    lifecycle_state: DeviceLifecycleState;
    active_assignments: string;
    sealed_manifests: string;
    profile_certified: boolean;
  }>(
    `select d.lifecycle_state::text as lifecycle_state,
            (select count(*) from kitluy_devices.device_assignments a
              where a.device_id = d.id and a.state = 'active') as active_assignments,
            (select count(*) from kitluy_devices.manufacturing_enrollments e
              where e.device_id = d.id and e.state = 'sealed') as sealed_manifests,
            (p.certification_status = 'CERTIFIED') as profile_certified
       from kitluy_devices.devices d
       join kitluy_devices.hardware_profiles p on p.id = d.hardware_profile_id
      where d.id = $1::uuid`,
    [deviceRecordId],
  );

  const row = rows[0];
  if (row === undefined) return null;
  return {
    canonicalLifecycle: row.lifecycle_state,
    hasActiveAssignment: Number(row.active_assignments) > 0,
    hardwareManifestSealed: Number(row.sealed_manifests) > 0,
    hardwareProfileCertified: row.profile_certified === true,
  };
}

// ---------------------------------------------------------------------------
// Durable factory QA (migration group 0188)
// ---------------------------------------------------------------------------

/**
 * WHY THIS EXISTS.
 *
 * `runFactoryQa` produces a report in memory, and eligibility used to read
 * `softwareQaPassed` straight out of that object. A process restart erased it,
 * so "this device passed QA" survived only as long as the process that said
 * so. Everything below writes the result to canonical storage and reads it
 * back from there, which is what makes the claim outlive the claimant.
 */

export interface PersistQaRequest {
  readonly deviceRecordId: string;
  /**
   * Idempotency key for ONE physical test run. A retry after a network failure
   * must not record a second execution, so this is stable across retries and
   * regenerated only for a genuinely new run.
   */
  readonly executionRef: string;
  readonly qaProfileKey: string;
  readonly qaProfileVersion: string;
  readonly stationId: string;
  readonly operatorRef: string;
  readonly report: QaReport;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly agentVersion?: string;
  readonly osImageVersion?: string;
  readonly releaseChannel?: string;
}

export type PersistQaResult =
  | { readonly kind: "recorded"; readonly executionId: string }
  | { readonly kind: "refused"; readonly code: string; readonly detail: string };

const QA_REFUSAL_CODES: readonly (readonly [RegExp, string])[] = [
  [/KLUY-DEVICE-QA-EVIDENCE-CONFLICT/, "KLUY-DEVICE-QA-EVIDENCE-CONFLICT"],
  [/KLUY-DEVICE-QA-NO-SEALED-ENROLLMENT/, "KLUY-DEVICE-QA-NO-SEALED-ENROLLMENT"],
  [/KLUY-DEVICE-QA-EMPTY/, "KLUY-DEVICE-QA-EMPTY"],
  [/factory_qa_check_results_hil_never_pass_chk/, "KLUY-DEVICE-QA-HIL-PASS-REFUSED"],
];

/**
 * Persist a QA report through the one governed door.
 *
 * The overall verdict is NOT sent. `record_factory_qa_v1` derives it from the
 * checks, so a caller cannot submit failing checks alongside a `passed`
 * verdict — the database would have to trust the caller's arithmetic, and the
 * one thing a QA record must not be is self-reported.
 */
export async function persistFactoryQa(
  db: DatabaseHandle,
  request: PersistQaRequest,
): Promise<PersistQaResult> {
  const checks = request.report.checks.map((c) => ({
    name: c.name,
    outcome: c.outcome,
    hardware_in_loop: c.hardwareInLoop,
    detail: c.detail,
  }));

  try {
    const { rows } = await db.query<{ execution_id: string }>(
      `select kitluy_devices.record_factory_qa_v1(
         $1::uuid, $2::text, $3::text, $4::text, $5::text, $6::text,
         $7::jsonb, $8::timestamptz, $9::timestamptz,
         null::text, $10::text, $11::text, $12::text
       ) as execution_id`,
      [
        request.deviceRecordId,
        request.executionRef,
        request.qaProfileKey,
        request.qaProfileVersion,
        request.stationId,
        request.operatorRef,
        JSON.stringify(checks),
        request.startedAt.toISOString(),
        request.completedAt.toISOString(),
        request.agentVersion ?? null,
        request.osImageVersion ?? null,
        request.releaseChannel ?? null,
      ],
    );

    const executionId = rows[0]?.execution_id;
    if (executionId === undefined) {
      return {
        kind: "refused",
        code: "KLUY-DEVICE-QA-REFUSED",
        detail: "no execution id returned",
      };
    }
    return { kind: "recorded", executionId };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    for (const [pattern, code] of QA_REFUSAL_CODES) {
      if (pattern.test(raw)) return { kind: "refused", code, detail: code };
    }
    return { kind: "refused", code: "KLUY-DEVICE-QA-REFUSED", detail: "factory QA refused" };
  }
}

export interface DurableQaRecord {
  readonly executionId: string;
  readonly result: "passed" | "failed";
  readonly qaProfileKey: string;
  readonly qaProfileVersion: string;
  readonly failureReasonCode: string | null;
  readonly checksTotal: number;
  readonly checksPassed: number;
  readonly checksFailed: number;
  readonly checksNotEvaluated: number;
  readonly completedAt: string;
  readonly evidenceSha256: string;
}

/**
 * Read the QA record that currently counts — the latest execution bound to the
 * device's CURRENT sealed enrollment. Re-enrollment after repair therefore
 * makes prior QA invisible here rather than merely stale, because QA performed
 * against different hardware evidence is not evidence about this device.
 */
export async function readCurrentFactoryQa(
  db: DatabaseHandle,
  deviceRecordId: string,
): Promise<DurableQaRecord | null> {
  const { rows } = await db.query<{
    id: string;
    result: "passed" | "failed";
    qa_profile_key: string;
    qa_profile_version: string;
    failure_reason_code: string | null;
    checks_total: number;
    checks_passed: number;
    checks_failed: number;
    checks_not_evaluated: number;
    completed_at: string;
    evidence_sha256: string;
  }>(`select * from kitluy_devices.current_factory_qa_v1($1::uuid)`, [deviceRecordId]);

  const row = rows[0];
  if (row === undefined || row.id === null) return null;
  return {
    executionId: row.id,
    result: row.result,
    qaProfileKey: row.qa_profile_key,
    qaProfileVersion: row.qa_profile_version,
    failureReasonCode: row.failure_reason_code,
    checksTotal: Number(row.checks_total),
    checksPassed: Number(row.checks_passed),
    checksFailed: Number(row.checks_failed),
    checksNotEvaluated: Number(row.checks_not_evaluated),
    completedAt: String(row.completed_at),
    evidenceSha256: row.evidence_sha256,
  };
}

export interface DerivedEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

/**
 * Ask the DATABASE whether this device may enter provisioning.
 *
 * The agent-side `evaluateProvisioningEligibility` still exists and still
 * matters — it lets a device reason about itself before it has a connection.
 * But it is advisory. This is the authority: it reads durable QA, containment,
 * incidents and evidence collisions that the device cannot see and must not be
 * trusted to report about itself.
 */
export async function readProvisioningEligibility(
  db: DatabaseHandle,
  deviceRecordId: string,
): Promise<DerivedEligibility> {
  const { rows } = await db.query<{ eligible: boolean; reasons: string[] | null }>(
    `select eligible, reasons from kitluy_devices.evaluate_provisioning_eligibility_v1($1::uuid)`,
    [deviceRecordId],
  );
  const row = rows[0];
  if (row === undefined) {
    return { eligible: false, reasons: ["eligibility could not be evaluated"] };
  }
  return { eligible: row.eligible === true, reasons: row.reasons ?? [] };
}

// ---------------------------------------------------------------------------
// Flash-time enrollment tickets (DEC-2)
// ---------------------------------------------------------------------------

/**
 * Issue the per-device ticket that authorizes ONE physical unit to enroll.
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001. §8's reuse constraint
 * is why this lives here rather than in a new module: the flashing step IS the
 * manufacturing station, so it belongs on the station's existing gateway,
 * speaking the same `DatabaseHandle` and the same refusal vocabulary as
 * `enrollDeviceAtFactory`.
 *
 * ===========================================================================
 * THE SECRET IS GENERATED BY THE CALLER AND NEVER SENT
 * ===========================================================================
 * This function takes a DIGEST. The server stores a digest, exactly as
 * `device_provisioning_codes` does (§5, "secret-free at rest server-side"), so
 * the plaintext exists in exactly two places: the caller's memory for the
 * moment it takes to write the card, and the card itself.
 *
 * That is also why the secret is not a parameter of the RESULT. Nothing this
 * function returns can be logged into disclosing a ticket.
 */
export interface EnrollmentTicketRequest {
  /** Names the ticket. Unique; a taken reference is refused, never reused. */
  readonly ticketReference: string;
  /** SHA-256 of the secret, lowercase hex. The secret itself stays with the caller. */
  readonly ticketDigest: string;
  /**
   * Already resolved — see `resolveHardwareProfileId`.
   *
   * Deliberately NOT a profile key resolved by a subselect in the argument
   * list. A subselect passed as an argument to a SECURITY DEFINER function is
   * evaluated in the CALLER's context, so it needs the caller to hold SELECT on
   * `hardware_profiles` — which `kitluy_fleet_service`, the role 0190 grants
   * issuance to, deliberately does not have. Resolving inside the argument
   * would therefore force the station to connect as something stronger, and the
   * only role holding both capabilities is `kitluy_fleet_governor`, which OWNS
   * these definer doors. Calling as the owner defeats the boundary the definer
   * exists to create.
   */
  readonly hardwareProfileId: string;
  /** `development` | `pilot` | `production` — a development ticket cannot enroll into pilot. */
  readonly environment: string;
  readonly enrollmentStationKey: string;
  readonly enrollmentOperatorRef: string;
  readonly issuedByOperatorRef: string;
  readonly validForHours?: number;
  readonly enrollmentBatchRef?: string;
}

export type EnrollmentTicketResult =
  | {
      readonly kind: "issued";
      readonly ticketId: string;
      readonly ticketReference: string;
      readonly environment: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "refused";
      readonly code: string;
      readonly detail: string;
    };

export async function issueEnrollmentTicket(
  db: DatabaseHandle,
  request: EnrollmentTicketRequest,
): Promise<EnrollmentTicketResult> {
  // Named locally rather than surfaced as an opaque `KLUY-MFGTICKET-DIGEST-INVALID`
  // after a round trip, for the same reason `enrollDeviceAtFactory` checks its
  // fingerprint here: a flashing station should learn what it got wrong.
  if (!CANONICAL_FINGERPRINT_PATTERN.test(request.ticketDigest)) {
    return {
      kind: "refused",
      code: "KLUY-MFGTICKET-DIGEST-INVALID",
      detail: "the ticket digest must be 64 lowercase hex characters",
    };
  }

  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    `select kitluy_devices.issue_manufacturing_enrollment_ticket_v1(
       $1::text, $2::text, $3::uuid,
       $4::text, $5::text, $6::text, $7::text, $8::integer, $9::text
     ) as result`,
    [
      request.ticketReference,
      request.ticketDigest,
      request.hardwareProfileId,
      request.environment,
      request.enrollmentStationKey,
      request.enrollmentOperatorRef,
      request.issuedByOperatorRef,
      request.validForHours ?? 168,
      request.enrollmentBatchRef ?? null,
    ],
  );

  const result = rows[0]?.result;
  if (result === undefined) {
    return {
      kind: "refused",
      code: "KLUY-MFGTICKET-NO-RESULT",
      detail: "the issuance door returned no outcome",
    };
  }
  if (result.outcome !== "ISSUED") {
    return {
      kind: "refused",
      code: String(result.refusal_code ?? "KLUY-MFGTICKET-ISSUANCE-REFUSED"),
      detail: String(result.detail ?? "the issuance door refused this ticket"),
    };
  }
  return {
    kind: "issued",
    ticketId: String(result.ticket_id),
    ticketReference: String(result.ticket_reference),
    environment: String(result.environment),
    expiresAt: String(result.expires_at),
  };
}

/**
 * Resolve a human-readable hardware profile key to its id.
 *
 * Separated from issuance ON PURPOSE, and called BEFORE the caller drops into
 * `kitluy_fleet_service`. Reading the profile catalogue and minting a
 * credential are different privileges, and collapsing them would mean granting
 * the issuance role a table read it has no other reason to hold.
 *
 * Returns null for an unknown or inactive profile, which the caller reports as
 * a refusal rather than passing a null id to the door — the door would refuse
 * it too, but a station operator deserves to be told the profile key is wrong
 * rather than that issuance failed.
 */
export async function resolveHardwareProfileId(
  db: DatabaseHandle,
  profileKey: string,
): Promise<string | null> {
  const { rows } = await db.query<{ id: string }>(
    `select id from kitluy_devices.hardware_profiles
      where profile_key = $1 and is_active`,
    [profileKey],
  );
  return rows[0]?.id ?? null;
}

export interface EnrollmentStationFacts {
  readonly registered: boolean;
  readonly status: string | null;
  readonly environment: string | null;
}

/**
 * Read the registration facts for a flashing station.
 *
 * Checked BEFORE a ticket is issued, because an unregistered station is not a
 * refusal — it is worse. `enroll_device_v1` records the finding and QUARANTINES
 * the device (0122:475), so the card is spent, the device enrolls, and the
 * operator discovers only afterwards that the unit is unusable. Refusing at
 * preparation time costs nothing and is diagnosable while the card is still in
 * the operator's hand.
 *
 * Like `resolveHardwareProfileId`, this reads a catalogue table and therefore
 * runs as the connecting identity, before the drop into the issuance role.
 */
export async function readEnrollmentStation(
  db: DatabaseHandle,
  stationKey: string,
): Promise<EnrollmentStationFacts> {
  const { rows } = await db.query<{ status: string; environment: string }>(
    `select status::text as status, environment::text as environment
       from kitluy_devices.enrollment_stations
      where station_key = $1`,
    [stationKey],
  );
  const row = rows[0];
  if (row === undefined) return { registered: false, status: null, environment: null };
  return { registered: true, status: row.status, environment: row.environment };
}
