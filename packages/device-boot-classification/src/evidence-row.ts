/**
 * The wire shape of the registry's boot evidence doors (group 0227), read
 * strictly into the contract's types.
 *
 * Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001.
 *
 * A SEPARATE ENTRY POINT (`@kitluy/device-boot-classification/evidence-row`),
 * deliberately not re-exported from the index: the index is the pure decision
 * and is shipped to boards byte for byte, and boards never read a database row.
 * The registry service (the board's door) and the Management API (the Admin's
 * door) both read the same row shape, so the mapping lives here once rather
 * than in each of them.
 *
 * WHY FIELD BY FIELD: the database is authoritative, but a jsonb document is
 * still a wire format. A lifecycle this code does not know, or a generation
 * that is not an integer, would otherwise reach `classifyBoot` as `undefined`
 * and quietly select a branch. An unrecognised row throws instead.
 */
import type {
  BoardResolution,
  CloudDeviceClass,
  CloudDeviceFacts,
  DeviceEnvironment,
  DeviceLifecycle,
} from "./index.js";

export class BootEvidenceUnreadableError extends Error {
  constructor(detail: string) {
    super(`boot evidence row is not understood: ${detail}`);
    this.name = "BootEvidenceUnreadableError";
  }
}

/** What a CLOUD door may answer. Never `unresolved`: only a board produces that. */
const CLOUD_RESOLUTIONS: readonly BoardResolution[] = [
  "resolved",
  "unknown",
  "review_mac_only",
  "conflict",
];
const CLOUD_CLASSES: readonly CloudDeviceClass[] = [
  "store_hub",
  "terminal",
  "manufacturing_station",
  "peripheral",
];
const LIFECYCLES: readonly DeviceLifecycle[] = [
  "manufactured",
  "enrolled",
  "awaiting_trust",
  "quarantined",
  "restricted_investigation",
  "active",
  "suspended",
  "retired",
  "replaced",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new BootEvidenceUnreadableError(`${field} is not an object`);
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new BootEvidenceUnreadableError(`${field} has an unrecognised value`);
  }
  return value as T;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new BootEvidenceUnreadableError(`${field} is not a uuid`);
  }
  return value;
}

function generation(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new BootEvidenceUnreadableError(`${field} is not a non-negative integer`);
  }
  return value;
}

function optionalGeneration(value: unknown, field: string): number | undefined {
  return value === null || value === undefined ? undefined : generation(value, field);
}

/** One device object from either door, as the contract's `CloudDeviceFacts`. */
export function cloudDeviceFactsFromRow(
  row: unknown,
  environment: DeviceEnvironment,
): CloudDeviceFacts {
  const d = record(row, "device");

  const assignmentRow = d.assignment;
  const assignment =
    assignmentRow === null || assignmentRow === undefined
      ? undefined
      : (() => {
          const a = record(assignmentRow, "device.assignment");
          return {
            state: oneOf(a.state, ["pending_trust", "active"] as const, "device.assignment.state"),
            digitalStoreId: uuid(a.digital_store_id, "device.assignment.digital_store_id"),
            storeLocationId: uuid(a.store_location_id, "device.assignment.store_location_id"),
          };
        })();

  const certificateRow = d.active_certificate;
  const activeCertificate =
    certificateRow === null || certificateRow === undefined
      ? undefined
      : (() => {
          const c = record(certificateRow, "device.active_certificate");
          return {
            generation: generation(c.generation, "device.active_certificate.generation"),
            enrollmentId: uuid(c.enrollment_id, "device.active_certificate.enrollment_id"),
          };
        })();

  const seatRow = d.seat;
  const seat =
    seatRow === null || seatRow === undefined
      ? undefined
      : (() => {
          const s = record(seatRow, "device.seat");
          if (typeof s.occupied_by_other_device !== "boolean") {
            throw new BootEvidenceUnreadableError(
              "device.seat.occupied_by_other_device is not a boolean",
            );
          }
          return {
            physicalTerminalId: uuid(s.physical_terminal_id, "device.seat.physical_terminal_id"),
            occupiedByOtherDevice: s.occupied_by_other_device,
          };
        })();

  const fingerprintRow = d.current_identity_key_fingerprint;
  if (
    fingerprintRow !== null &&
    fingerprintRow !== undefined &&
    (typeof fingerprintRow !== "string" || !/^[0-9a-f]{64}$/i.test(fingerprintRow))
  ) {
    throw new BootEvidenceUnreadableError(
      "device.current_identity_key_fingerprint is not a sha-256",
    );
  }
  const currentIdentityKeyFingerprint =
    typeof fingerprintRow === "string" ? fingerprintRow.toLowerCase() : undefined;

  const credentialHeadGeneration = optionalGeneration(
    d.credential_head_generation,
    "device.credential_head_generation",
  );
  const honouredPreviousGeneration = optionalGeneration(
    d.honoured_previous_generation,
    "device.honoured_previous_generation",
  );

  return {
    deviceRecordId: uuid(d.device_record_id, "device.device_record_id"),
    deviceClass: oneOf(d.device_class, CLOUD_CLASSES, "device.device_class"),
    // A device record carries no environment of its own: it lives in the
    // deployment that holds it, and that is what an image is compared against.
    environment,
    lifecycle: oneOf(d.lifecycle, LIFECYCLES, "device.lifecycle"),
    openTrustIncidentCount: generation(
      d.open_trust_incident_count,
      "device.open_trust_incident_count",
    ),
    currentEnrollmentId: uuid(d.current_enrollment_id, "device.current_enrollment_id"),
    ...(currentIdentityKeyFingerprint === undefined ? {} : { currentIdentityKeyFingerprint }),
    assignmentGeneration: generation(d.assignment_generation, "device.assignment_generation"),
    ...(assignment === undefined ? {} : { assignment }),
    ...(credentialHeadGeneration === undefined ? {} : { credentialHeadGeneration }),
    ...(honouredPreviousGeneration === undefined ? {} : { honouredPreviousGeneration }),
    ...(activeCertificate === undefined ? {} : { activeCertificate }),
    ...(seat === undefined ? {} : { seat }),
  };
}

/** The top level of either door's answer: how the board resolved, and its device. */
export interface EvidenceRow {
  readonly boardResolution: BoardResolution;
  readonly resolutionDetail?: string;
  readonly cloudDevice?: CloudDeviceFacts;
}

export function evidenceRowFrom(row: unknown, environment: DeviceEnvironment): EvidenceRow {
  const top = record(row, "evidence");
  const boardResolution = oneOf(top.board_resolution, CLOUD_RESOLUTIONS, "board_resolution");
  const resolutionDetail =
    typeof top.resolution_detail === "string" ? top.resolution_detail : undefined;
  const cloudDevice =
    top.device === null || top.device === undefined
      ? undefined
      : cloudDeviceFactsFromRow(top.device, environment);
  return {
    boardResolution,
    ...(resolutionDetail === undefined ? {} : { resolutionDetail }),
    ...(cloudDevice === undefined ? {} : { cloudDevice }),
  };
}
