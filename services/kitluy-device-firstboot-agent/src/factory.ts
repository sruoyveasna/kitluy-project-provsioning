/**
 * Factory identity and enrollment path (M1).
 *
 * Authority:
 *   00_AI_HANDOFF/000_ACTIVE_PHASE.md §10 — the locked provisioning chain
 *   migration group 0120 — `enroll_device_v1`, manufacturing enrollment
 *   docs/source/offline/kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md
 *
 * ===========================================================================
 * FACTORY ENROLLMENT IS NOT STORE PROVISIONING
 * ===========================================================================
 * Nothing in this module assigns a Tenant, Digital Store, Store Location,
 * Store Hub, POS template or terminal profile. A factory-enrolled device is
 * platform-fleet inventory; it becomes Store inventory later, through the
 * operational provisioning path, which is a different contract entirely.
 *
 * The separation is not stylistic. A device that could acquire Store scope on
 * the factory floor would let manufacturing decide where hardware ends up,
 * and would make the governed assignment chain optional.
 *
 * ===========================================================================
 * VERTICAL NEUTRALITY
 * ===========================================================================
 * No Laundry concept appears here, and none may. This module runs on every
 * device class the platform supports; the vertical arrives with the POS
 * template long after the device leaves the factory.
 */

import type { DeviceClass, DeviceLifecycleState } from "./enrollment.js";

// ---------------------------------------------------------------------------
// The factory state machine
// ---------------------------------------------------------------------------

/**
 * Agent-side factory states. These are the AGENT's states — its own progress
 * through first boot — and are deliberately NOT database enum values.
 *
 * The database models device truth; the agent models where it has got to. The
 * two are related by `CANONICAL_STATE_MAPPING` below rather than by being the
 * same list, because forcing one to mirror the other means every agent
 * progress step would need a migration.
 */
export const FACTORY_STATES = [
  "IMAGE_PREPARED",
  "FIRST_BOOT",
  "IDENTITY_CREATED",
  "KEYPAIR_CREATED",
  "HARDWARE_MANIFEST_READY",
  "ENROLLMENT_PENDING",
  "ENROLLMENT_AUTHENTICATED",
  "FACTORY_ENROLLED",
  "FACTORY_TESTED",
  "PROVISIONING_ELIGIBLE",
] as const;

export type FactoryState = (typeof FACTORY_STATES)[number];

/**
 * How each agent state relates to canonical database truth.
 *
 * `canonicalLifecycle: null` means the database does not know about this
 * device yet — everything before enrollment is purely local. Recording that
 * explicitly is the point: it makes visible exactly where the device stops
 * being a private local process and becomes a fleet record.
 */
export interface CanonicalStateMapping {
  readonly factoryState: FactoryState;
  readonly canonicalLifecycle: DeviceLifecycleState | null;
  readonly note: string;
}

export const CANONICAL_STATE_MAPPING: readonly CanonicalStateMapping[] = [
  {
    factoryState: "IMAGE_PREPARED",
    canonicalLifecycle: null,
    note: "golden image; no device record exists",
  },
  { factoryState: "FIRST_BOOT", canonicalLifecycle: null, note: "local only" },
  {
    factoryState: "IDENTITY_CREATED",
    canonicalLifecycle: null,
    note: "local installation identity",
  },
  {
    factoryState: "KEYPAIR_CREATED",
    canonicalLifecycle: null,
    note: "private key local and non-exportable",
  },
  {
    factoryState: "HARDWARE_MANIFEST_READY",
    canonicalLifecycle: null,
    note: "signals collected, not yet submitted",
  },
  {
    factoryState: "ENROLLMENT_PENDING",
    canonicalLifecycle: null,
    note: "request in flight; may be retried",
  },
  {
    factoryState: "ENROLLMENT_AUTHENTICATED",
    canonicalLifecycle: null,
    note: "proof of possession accepted",
  },
  {
    factoryState: "FACTORY_ENROLLED",
    canonicalLifecycle: "enrolled",
    note: "enroll_device_v1 returned a device_record_id; no assignment exists",
  },
  {
    factoryState: "FACTORY_TESTED",
    canonicalLifecycle: "enrolled",
    note: "software QA recorded; lifecycle unchanged — QA is not a lifecycle transition",
  },
  {
    factoryState: "PROVISIONING_ELIGIBLE",
    canonicalLifecycle: "enrolled",
    note: "DERIVED, not stored: enrolled + sealed manifest + QA pass + no assignment",
  },
];

const STATE_INDEX: ReadonlyMap<FactoryState, number> = new Map(
  FACTORY_STATES.map((s, i) => [s, i]),
);

export function factoryStateIndex(state: FactoryState): number {
  const i = STATE_INDEX.get(state);
  if (i === undefined) throw new Error(`unknown factory state: ${state}`);
  return i;
}

export type TransitionOutcome =
  | { readonly kind: "advanced"; readonly from: FactoryState; readonly to: FactoryState }
  | { readonly kind: "already_reached"; readonly state: FactoryState }
  | {
      readonly kind: "refused";
      readonly from: FactoryState;
      readonly to: FactoryState;
      readonly reason: string;
    };

/**
 * Advance the factory state machine.
 *
 * Two properties make this restart-safe, and both are deliberate:
 *
 *   - Re-entering a state already passed is `already_reached`, NOT an error.
 *     A device that reboots mid-enrollment replays its steps; if replay were
 *     an error the device would need operator intervention to finish booting.
 *   - Skipping forward is REFUSED. Without this, a crash between "enrolled"
 *     and "QA recorded" could resume straight into PROVISIONING_ELIGIBLE and
 *     ship an untested device.
 */
export function advanceFactoryState(current: FactoryState, next: FactoryState): TransitionOutcome {
  const from = factoryStateIndex(current);
  const to = factoryStateIndex(next);

  if (to <= from) return { kind: "already_reached", state: next };
  if (to > from + 1) {
    return {
      kind: "refused",
      from: current,
      to: next,
      reason: `cannot skip ${to - from - 1} state(s); factory progress is sequential`,
    };
  }
  return { kind: "advanced", from: current, to: next };
}

// ---------------------------------------------------------------------------
// Hardware manifest
// ---------------------------------------------------------------------------

/**
 * Signal types the canonical schema accepts
 * (`kitluy_devices.hardware_signal_type`). Mirrored, not invented — a signal
 * type absent from the enum is refused by the database anyway, and refusing it
 * here turns a mid-enrollment failure into a local one.
 */
export const CANONICAL_SIGNAL_TYPES = [
  "mac_address",
  "board_serial",
  "soc_serial",
  "tpm_ek_public",
  "secure_element_id",
  "storage_serial",
  "storage_model",
  "boot_measurement",
  "os_image_digest",
] as const;

export type SignalType = (typeof CANONICAL_SIGNAL_TYPES)[number];

export interface HardwareSignal {
  readonly signal_type: SignalType;
  readonly signal_value: string;
}

export type ManifestValidation =
  | { readonly ok: true; readonly signals: readonly HardwareSignal[] }
  | { readonly ok: false; readonly problems: readonly string[] };

/**
 * Validate a manifest before it is ever sent.
 *
 * `requiredSignalTypes` comes from the device's hardware profile — the profile
 * decides what evidence a device of that class must present, so this function
 * takes it as input rather than hardcoding a list per class.
 */
export function validateHardwareManifest(
  signals: readonly HardwareSignal[],
  requiredSignalTypes: readonly string[],
): ManifestValidation {
  const problems: string[] = [];

  if (signals.length === 0) {
    problems.push("manifest is empty; unregistered hardware cannot enroll");
  }

  const seen = new Set<string>();
  for (const s of signals) {
    if (!CANONICAL_SIGNAL_TYPES.includes(s.signal_type)) {
      problems.push(`unknown signal type '${s.signal_type}'`);
    }
    if (typeof s.signal_value !== "string" || s.signal_value.trim() === "") {
      problems.push(`signal '${s.signal_type}' has an empty value`);
    }
    // A duplicated signal type is ambiguous evidence, and ambiguous binding
    // evidence is worse than missing evidence: it silently picks one.
    if (seen.has(s.signal_type)) problems.push(`duplicate signal type '${s.signal_type}'`);
    seen.add(s.signal_type);
  }

  for (const required of requiredSignalTypes) {
    if (!seen.has(required)) problems.push(`hardware profile requires signal '${required}'`);
  }

  return problems.length === 0 ? { ok: true, signals } : { ok: false, problems };
}

// ---------------------------------------------------------------------------
// Factory QA
// ---------------------------------------------------------------------------

export type QaOutcome = "pass" | "fail" | "not_evaluated";

export interface QaCheck {
  readonly name: string;
  readonly outcome: QaOutcome;
  readonly detail: string;
  /**
   * True when this check can only be settled on real hardware. Such a check
   * may NEVER report `pass` from a simulation — see `runFactoryQa`.
   */
  readonly hardwareInLoop: boolean;
}

export interface QaReport {
  readonly deviceClass: DeviceClass;
  readonly checks: readonly QaCheck[];
  readonly softwarePassed: boolean;
  readonly hardwareDeferred: readonly string[];
}

export interface QaInputs {
  readonly deviceClass: DeviceClass;
  readonly installationId?: string;
  readonly publicKeyPem?: string;
  readonly osImageVersion?: string;
  readonly agentVersion?: string;
  readonly releaseChannel?: string;
  readonly manifest?: ManifestValidation;
  readonly enrollmentReachable?: boolean;
  readonly deviceRecordId?: string;
  readonly localStatePersisted?: boolean;
  /** Terminal-only: the kiosk/compositor configuration the image reports. */
  readonly kioskRuntime?: string;
  /** Store-Hub-only: whether a local database is present. */
  readonly localDatabasePresent?: boolean;
}

function check(name: string, ok: boolean, pass: string, fail: string): QaCheck {
  return { name, outcome: ok ? "pass" : "fail", detail: ok ? pass : fail, hardwareInLoop: false };
}

function deferred(name: string, detail: string): QaCheck {
  return { name, outcome: "not_evaluated", detail, hardwareInLoop: true };
}

/**
 * Software factory QA.
 *
 * The rule this function exists to enforce: **a simulation never reports a
 * hardware check as passed.** Touchscreen, NVMe, thermal, printer, scanner,
 * scale and power certification are hardware-in-the-loop and are emitted as
 * `not_evaluated` with an explicit reason. `softwarePassed` deliberately
 * ignores them so it cannot be read as hardware certification.
 */
export function runFactoryQa(input: QaInputs): QaReport {
  const checks: QaCheck[] = [
    check(
      "unique_installation_identity",
      typeof input.installationId === "string" && input.installationId.length > 0,
      "installation identity present",
      "no unique installation identity",
    ),
    check(
      "device_keypair",
      typeof input.publicKeyPem === "string" && input.publicKeyPem.includes("PUBLIC KEY"),
      "device key pair generated",
      "no device key pair",
    ),
    check(
      "image_version_metadata",
      typeof input.osImageVersion === "string" && input.osImageVersion.length > 0,
      "OS image version reported",
      "OS image version missing",
    ),
    check(
      "agent_version_metadata",
      typeof input.agentVersion === "string" && input.agentVersion.length > 0,
      "agent version reported",
      "agent version missing",
    ),
    check(
      "release_channel",
      typeof input.releaseChannel === "string" && input.releaseChannel.length > 0,
      "release channel reported",
      "release channel missing",
    ),
    check(
      "hardware_manifest",
      input.manifest?.ok === true,
      "hardware manifest valid",
      // Narrowed rather than cast: `check` evaluates both message arguments
      // eagerly, so reaching into `problems` on a VALID manifest would throw.
      input.manifest === undefined
        ? "no hardware manifest collected"
        : input.manifest.ok
          ? "hardware manifest valid"
          : `manifest invalid: ${input.manifest.problems.join("; ")}`,
    ),
    check(
      "enrollment_connectivity",
      input.enrollmentReachable === true,
      "enrollment service reachable",
      "enrollment service unreachable",
    ),
    check(
      "enrollment_result",
      typeof input.deviceRecordId === "string" && input.deviceRecordId.length > 0,
      "device record created",
      "no device record created",
    ),
    check(
      "local_state_persistence",
      input.localStatePersisted === true,
      "local factory state persisted",
      "local factory state not persisted",
    ),
  ];

  if (input.deviceClass === "terminal") {
    checks.push(
      check(
        "kiosk_runtime_metadata",
        typeof input.kioskRuntime === "string" && input.kioskRuntime.length > 0,
        "kiosk runtime configured",
        "kiosk runtime metadata missing",
      ),
      deferred("touchscreen_input", "requires physical touchscreen"),
      deferred("peripheral_certification", "printer/scanner/scale require hardware"),
    );
  }

  if (input.deviceClass === "store_hub") {
    checks.push(
      check(
        "local_database_present",
        input.localDatabasePresent === true,
        "local database present",
        "local database absent",
      ),
      deferred("nvme_storage", "requires physical NVMe"),
      deferred("thermal_and_power", "requires physical Pi under load"),
    );
  }

  const evaluated = checks.filter((c) => !c.hardwareInLoop);
  return {
    deviceClass: input.deviceClass,
    checks,
    softwarePassed: evaluated.every((c) => c.outcome === "pass"),
    hardwareDeferred: checks.filter((c) => c.hardwareInLoop).map((c) => c.name),
  };
}

// ---------------------------------------------------------------------------
// Provisioning eligibility — DERIVED, never stored
// ---------------------------------------------------------------------------

export interface EligibilityFacts {
  readonly canonicalLifecycle: DeviceLifecycleState | null;
  readonly hasActiveAssignment: boolean;
  readonly hardwareManifestSealed: boolean;
  readonly softwareQaPassed: boolean;
  readonly hardwareProfileCertified: boolean;
}

export interface EligibilityVerdict {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
}

/**
 * Is this device eligible to ENTER Store provisioning?
 *
 * Derived from canonical facts rather than stored as a flag — the same
 * discipline the schema already applies to "enrolled and unassigned". A stored
 * flag is a second copy of the truth, and the copy is what goes stale: a
 * device revoked after being marked eligible would still read as eligible.
 *
 * Fail-closed: every reason must clear. Eligibility is permission to BEGIN
 * provisioning, never permission to skip any step of the governed chain.
 */
export function evaluateProvisioningEligibility(facts: EligibilityFacts): EligibilityVerdict {
  const reasons: string[] = [];

  if (facts.canonicalLifecycle !== "enrolled") {
    reasons.push(
      `lifecycle is '${facts.canonicalLifecycle ?? "none"}'; only an 'enrolled' device may enter provisioning`,
    );
  }
  if (facts.hasActiveAssignment) {
    reasons.push("device already holds an active assignment; it is not factory inventory");
  }
  if (!facts.hardwareManifestSealed) {
    reasons.push("hardware manifest is not sealed");
  }
  if (!facts.softwareQaPassed) {
    reasons.push("software factory QA has not passed");
  }
  if (!facts.hardwareProfileCertified) {
    reasons.push("hardware profile is not certified");
  }

  return { eligible: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Log redaction
// ---------------------------------------------------------------------------

const REDACT_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
  /\bsb_secret_[A-Za-z0-9_-]+/g,
  /\bservice_role\b/g,
];

/**
 * Redact secret material from anything about to be logged.
 *
 * Factory logs are shipped off the device and read by operators, so a private
 * key or token that reaches a log line has effectively left the device — the
 * same outcome the whole identity model exists to prevent.
 */
export function redactForLog(message: string): string {
  let out = message;
  for (const pattern of REDACT_PATTERNS) out = out.replace(pattern, "[REDACTED]");
  return out;
}
