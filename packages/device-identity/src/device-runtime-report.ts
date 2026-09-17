/**
 * The runtime report a Pi Terminal signs about itself.
 *
 * Authority: owner mission T1-STORE-OPERATIONS-001 (2026-09-17) §15-§17; cloud
 * migration group 0229 (`record_device_runtime_report_v1`).
 *
 * ===========================================================================
 * WHAT IS REPORTED, AND WHAT IS NOT
 * ===========================================================================
 * Three facts only the Terminal can observe, each already produced by a
 * component that owns it:
 *
 *   hubLink       terminal-edge's link to its Store Hub (edge-status.json);
 *   application   the POS release the update agent installed and the release
 *                 its launcher actually started (the release journal and the
 *                 launcher witness);
 *   pos           the POS runtime state (pos-runtime.json): the closed T1
 *                 vocabulary, the configuration version, whether a staff member
 *                 is signed in — never who.
 *
 * No key, certificate, fingerprint, Store/customer data, staff identity or free
 * text beyond bounded refusal reasons. The shape is CLOSED: an unknown field is
 * refused, not ignored, so the report cannot grow a channel by accident.
 *
 * ===========================================================================
 * WHO MAY SAY IT
 * ===========================================================================
 * The Terminal signs with its Ed25519 DEVICE IDENTITY key. The service verifies
 * the signature (as for every proof in this repository); the database binds the
 * verified fingerprint to the device's current sealed enrollment (group 0229,
 * the group 0224 predicate). The preimage binds a domain separator (so the
 * signature is useless as a pairing proof, a discovery record or a recovery
 * proof, all signed by the same key), the key's own fingerprint, the device id,
 * the report sequence, the device's observation instant and SHA-256 of the
 * CANONICAL report JSON.
 *
 * This is DEVICE-ATTESTED status, not a Store Hub observation (group 0177,
 * blocked on BLK-006) — every consumer must say so.
 *
 * The device builds the same bytes in
 * `services/kitluy-device-firstboot-agent/src/runtime-report-bytes.ts`, kept
 * identical by that service's drift test.
 */
import { createHash, createPublicKey, verify as cryptoVerify } from "node:crypto";

import { publicKeyFingerprint } from "./dev-crypto.js";

/** Domain separator AND the report's `schema` value. The device copy MUST match. */
export const DEVICE_RUNTIME_REPORT_KIND = "kitluy.device-runtime-report.v1" as const;

export const RUNTIME_EDGE_PHASES = [
  "NOT_ACTIVATED",
  "NO_HUB_FOUND",
  "HUB_REFUSED",
  "NOT_RECOGNIZED",
  "PAIRING_REFUSED",
  "DEGRADED",
  "SERVING",
] as const;

export const RUNTIME_INSTALL_PHASES = [
  "IDLE",
  "ACTIVATING",
  "HEALTH_PENDING",
  "COMMITTED",
  "ROLLED_BACK",
  "FAILED",
] as const;

export const RUNTIME_INSTALL_OUTCOMES = [
  "INSTALLED",
  "ROLLED_BACK",
  "REFUSED",
  "INTERRUPTED",
] as const;

/** The closed T1 runtime vocabulary (apps/kitluy-pos-desktop-app/src/bootstrap/states.ts). */
export const RUNTIME_POS_STATES = [
  "starting",
  "connecting_to_hub",
  "configuration_loading",
  "staff_authentication_required",
  "ready",
  "offline_ready",
  "stale_configuration",
  "hub_unavailable",
  "assignment_invalid",
  "credential_invalid",
  "profile_not_authorized",
  "configuration_incompatible",
  "recovery_required",
] as const;

export interface DeviceRuntimeReport {
  readonly schema: typeof DEVICE_RUNTIME_REPORT_KIND;
  readonly deviceClass: "terminal";
  readonly imageVersion: string | null;
  readonly agentVersion: string;
  readonly hubLink: {
    readonly phase: (typeof RUNTIME_EDGE_PHASES)[number];
    readonly hubDeviceId: string | null;
    readonly checkedAt: string;
    readonly reads: {
      readonly authorityTime: string;
      readonly eligibility: string;
      readonly configuration: string;
    } | null;
  } | null;
  readonly application: {
    readonly product: "kitluy-terminal";
    readonly installedReleaseId: string | null;
    readonly installedVersion: string | null;
    readonly journalPhase: (typeof RUNTIME_INSTALL_PHASES)[number];
    readonly lastOutcome: (typeof RUNTIME_INSTALL_OUTCOMES)[number] | null;
    readonly lastReason: string | null;
    readonly runningReleaseId: string | null;
    readonly runningSince: string | null;
    readonly unitActive: boolean;
  } | null;
  readonly pos: {
    readonly state: (typeof RUNTIME_POS_STATES)[number];
    readonly refusalCode: string | null;
    readonly applicationVersion: string;
    readonly configurationVersion: number | null;
    readonly configurationFreshness: "current" | "cached_offline" | null;
    readonly staffSignedIn: boolean;
    readonly observedAt: string;
  } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HEX64 = /^[0-9a-f]{64}$/u;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/u;

/**
 * Canonical JSON: object keys sorted at every depth, arrays in order, no
 * whitespace. The device and the service hash THIS, so key order in transit
 * can never change what was signed.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

/** The bytes the device identity key signs. Throws on a malformed binding. */
export function deviceRuntimeReportBytes(input: {
  readonly identityPublicKeyFingerprint: string;
  readonly deviceId: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: DeviceRuntimeReport;
}): Uint8Array {
  if (!HEX64.test(input.identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-RUNTIME-REPORT-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex",
    );
  }
  if (
    !UUID.test(input.deviceId) ||
    !Number.isSafeInteger(input.reportSequence) ||
    input.reportSequence < 1
  ) {
    throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: device id or report sequence is invalid");
  }
  if (CONTROL.test(input.observedAt) || input.observedAt.length > 64) {
    throw new Error("KLUY-RUNTIME-REPORT-MALFORMED: observedAt is invalid");
  }
  const digest = createHash("sha256").update(canonicalJson(input.report), "utf8").digest("hex");
  return new Uint8Array(
    Buffer.from(
      [
        DEVICE_RUNTIME_REPORT_KIND,
        input.identityPublicKeyFingerprint,
        input.deviceId.toLowerCase(),
        String(input.reportSequence),
        input.observedAt,
        digest,
      ].join("\n"),
      "utf8",
    ),
  );
}

type Parsed<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly detail: string };

function fail(detail: string): { readonly ok: false; readonly detail: string } {
  return { ok: false, detail };
}

function exactKeys(
  value: unknown,
  keys: readonly string[],
  where: string,
): Record<string, unknown> | string {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return `${where} must be an object`;
  const record = value as Record<string, unknown>;
  const present = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (present.length !== expected.length || present.some((k, i) => k !== expected[i])) {
    return `${where} must carry exactly: ${expected.join(", ")}`;
  }
  return record;
}

function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !CONTROL.test(value);
}

function nullableUuid(value: unknown): boolean {
  return value === null || (typeof value === "string" && UUID.test(value));
}

function instant(value: unknown): boolean {
  return boundedString(value, 40) && !Number.isNaN(new Date(value).getTime());
}

/** Parse a report against the CLOSED v1 shape. Unknown fields are refused. */
export function parseDeviceRuntimeReport(value: unknown): Parsed<DeviceRuntimeReport> {
  const top = exactKeys(
    value,
    ["schema", "deviceClass", "imageVersion", "agentVersion", "hubLink", "application", "pos"],
    "report",
  );
  if (typeof top === "string") return fail(top);
  if (top["schema"] !== DEVICE_RUNTIME_REPORT_KIND) return fail("report.schema is not v1");
  if (top["deviceClass"] !== "terminal") return fail("report.deviceClass must be terminal");
  if (!(top["imageVersion"] === null || boundedString(top["imageVersion"], 64))) {
    return fail("report.imageVersion is invalid");
  }
  if (!boundedString(top["agentVersion"], 32)) return fail("report.agentVersion is invalid");

  if (top["hubLink"] !== null) {
    const hub = exactKeys(
      top["hubLink"],
      ["phase", "hubDeviceId", "checkedAt", "reads"],
      "report.hubLink",
    );
    if (typeof hub === "string") return fail(hub);
    if (!(RUNTIME_EDGE_PHASES as readonly unknown[]).includes(hub["phase"])) {
      return fail("report.hubLink.phase is not an edge phase");
    }
    if (!nullableUuid(hub["hubDeviceId"]) || !instant(hub["checkedAt"])) {
      return fail("report.hubLink hub id or instant is invalid");
    }
    if (hub["reads"] !== null) {
      const reads = exactKeys(
        hub["reads"],
        ["authorityTime", "eligibility", "configuration"],
        "report.hubLink.reads",
      );
      if (typeof reads === "string") return fail(reads);
      for (const key of ["authorityTime", "eligibility", "configuration"]) {
        if (!boundedString(reads[key], 80)) return fail(`report.hubLink.reads.${key} is invalid`);
      }
    }
  }

  if (top["application"] !== null) {
    const app = exactKeys(
      top["application"],
      [
        "product",
        "installedReleaseId",
        "installedVersion",
        "journalPhase",
        "lastOutcome",
        "lastReason",
        "runningReleaseId",
        "runningSince",
        "unitActive",
      ],
      "report.application",
    );
    if (typeof app === "string") return fail(app);
    if (app["product"] !== "kitluy-terminal")
      return fail("report.application.product must be kitluy-terminal");
    if (!nullableUuid(app["installedReleaseId"]) || !nullableUuid(app["runningReleaseId"])) {
      return fail("report.application release ids must be uuids or null");
    }
    if (!(app["installedVersion"] === null || boundedString(app["installedVersion"], 64))) {
      return fail("report.application.installedVersion is invalid");
    }
    if (!(RUNTIME_INSTALL_PHASES as readonly unknown[]).includes(app["journalPhase"])) {
      return fail("report.application.journalPhase is not an install phase");
    }
    if (!(
      app["lastOutcome"] === null ||
      (RUNTIME_INSTALL_OUTCOMES as readonly unknown[]).includes(app["lastOutcome"])
    )) {
      return fail("report.application.lastOutcome is not an install outcome");
    }
    if (!(app["lastReason"] === null || boundedString(app["lastReason"], 160))) {
      return fail("report.application.lastReason is invalid");
    }
    if (!(app["runningSince"] === null || instant(app["runningSince"]))) {
      return fail("report.application.runningSince is invalid");
    }
    if (typeof app["unitActive"] !== "boolean")
      return fail("report.application.unitActive must be a boolean");
  }

  if (top["pos"] !== null) {
    const pos = exactKeys(
      top["pos"],
      [
        "state",
        "refusalCode",
        "applicationVersion",
        "configurationVersion",
        "configurationFreshness",
        "staffSignedIn",
        "observedAt",
      ],
      "report.pos",
    );
    if (typeof pos === "string") return fail(pos);
    if (!(RUNTIME_POS_STATES as readonly unknown[]).includes(pos["state"])) {
      return fail("report.pos.state is not a T1 runtime state");
    }
    if (!(
      pos["refusalCode"] === null ||
      (boundedString(pos["refusalCode"], 64) && /^[A-Z0-9_]+$/u.test(pos["refusalCode"]))
    )) {
      return fail("report.pos.refusalCode is invalid");
    }
    if (!boundedString(pos["applicationVersion"], 32))
      return fail("report.pos.applicationVersion is invalid");
    const version = pos["configurationVersion"];
    if (!(
      version === null ||
      (typeof version === "number" && Number.isSafeInteger(version) && version >= 0)
    )) {
      return fail("report.pos.configurationVersion is invalid");
    }
    if (!(
      pos["configurationFreshness"] === null ||
      pos["configurationFreshness"] === "current" ||
      pos["configurationFreshness"] === "cached_offline"
    )) {
      return fail("report.pos.configurationFreshness is invalid");
    }
    if (typeof pos["staffSignedIn"] !== "boolean" || !instant(pos["observedAt"])) {
      return fail("report.pos staff flag or instant is invalid");
    }
  }

  return { ok: true, value: top as unknown as DeviceRuntimeReport };
}

export type DeviceRuntimeReportVerdict =
  | { readonly verified: true; readonly identityPublicKeyFingerprint: string }
  | { readonly verified: false; readonly detail: string };

/**
 * Verify a runtime report signature, inside the trusted computing base.
 * Ed25519 only, for the same reason as the recovery identity proof.
 */
export function verifyDeviceRuntimeReport(input: {
  readonly identityPublicKeyPem: string;
  readonly deviceId: string;
  readonly reportSequence: number;
  readonly observedAt: string;
  readonly report: DeviceRuntimeReport;
  readonly signature: Uint8Array;
}): DeviceRuntimeReportVerdict {
  let fingerprint: string;
  try {
    const key = createPublicKey(input.identityPublicKeyPem);
    if (key.asymmetricKeyType !== "ed25519") {
      return { verified: false, detail: "the device identity key must be Ed25519" };
    }
    fingerprint = publicKeyFingerprint(input.identityPublicKeyPem);
  } catch {
    return {
      verified: false,
      detail: "the identity public key is not a readable PEM SubjectPublicKeyInfo",
    };
  }
  let bytes: Uint8Array;
  try {
    bytes = deviceRuntimeReportBytes({
      identityPublicKeyFingerprint: fingerprint,
      deviceId: input.deviceId,
      reportSequence: input.reportSequence,
      observedAt: input.observedAt,
      report: input.report,
    });
  } catch (error) {
    return {
      verified: false,
      detail: error instanceof Error ? error.message : "malformed binding",
    };
  }
  try {
    const ok = cryptoVerify(
      null,
      Buffer.from(bytes),
      createPublicKey(input.identityPublicKeyPem),
      Buffer.from(input.signature),
    );
    return ok
      ? { verified: true, identityPublicKeyFingerprint: fingerprint }
      : {
          verified: false,
          detail: "the runtime report signature does not verify under the presented identity key",
        };
  } catch {
    return { verified: false, detail: "the runtime report signature could not be verified" };
  }
}
