/**
 * Factory state machine, hardware manifest, software QA, eligibility and
 * log redaction (M1, WS-C / WS-G / WS-H unit + contract classes).
 */
import { describe, expect, it } from "vitest";

import {
  advanceFactoryState,
  CANONICAL_STATE_MAPPING,
  CANONICAL_SIGNAL_TYPES,
  evaluateProvisioningEligibility,
  FACTORY_STATES,
  redactForLog,
  runFactoryQa,
  validateHardwareManifest,
  type EligibilityFacts,
  type FactoryState,
  type HardwareSignal,
  type QaInputs,
} from "../src/factory.js";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

describe("factory state machine", () => {
  it("advances one state at a time through the full path", () => {
    let current: FactoryState = FACTORY_STATES[0];
    for (const next of FACTORY_STATES.slice(1)) {
      const outcome = advanceFactoryState(current, next);
      expect(outcome.kind).toBe("advanced");
      current = next;
    }
    expect(current).toBe("PROVISIONING_ELIGIBLE");
  });

  it("treats re-entering a reached state as already_reached, not an error", () => {
    // A device that reboots mid-enrollment replays its steps. If replay were an
    // error it would need an operator to finish booting.
    expect(advanceFactoryState("FACTORY_ENROLLED", "FACTORY_ENROLLED").kind).toBe(
      "already_reached",
    );
    expect(advanceFactoryState("FACTORY_ENROLLED", "IDENTITY_CREATED").kind).toBe(
      "already_reached",
    );
  });

  it("is idempotent across repeated replays", () => {
    for (let i = 0; i < 5; i += 1) {
      expect(advanceFactoryState("ENROLLMENT_PENDING", "IDENTITY_CREATED").kind).toBe(
        "already_reached",
      );
    }
  });

  it("REFUSES skipping states", () => {
    // The failure this prevents: a crash between enrollment and QA resuming
    // straight into PROVISIONING_ELIGIBLE, shipping an untested device.
    const outcome = advanceFactoryState("FACTORY_ENROLLED", "PROVISIONING_ELIGIBLE");
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("sequential");
  });

  it("refuses to skip even a single state", () => {
    expect(advanceFactoryState("FIRST_BOOT", "KEYPAIR_CREATED").kind).toBe("refused");
  });

  it("maps every agent state to canonical database truth explicitly", () => {
    expect(CANONICAL_STATE_MAPPING.map((m) => m.factoryState)).toEqual([...FACTORY_STATES]);
  });

  it("keeps the device out of the database until enrollment", () => {
    const preEnrollment = CANONICAL_STATE_MAPPING.filter(
      (m) =>
        m.factoryState !== "FACTORY_ENROLLED" &&
        m.factoryState !== "FACTORY_TESTED" &&
        m.factoryState !== "PROVISIONING_ELIGIBLE",
    );
    for (const m of preEnrollment) expect(m.canonicalLifecycle).toBeNull();
  });

  it("never maps a factory state to a lifecycle other than 'enrolled'", () => {
    // Factory enrollment must not reach awaiting_trust or active — those belong
    // to the Store provisioning chain.
    for (const m of CANONICAL_STATE_MAPPING) {
      if (m.canonicalLifecycle !== null) expect(m.canonicalLifecycle).toBe("enrolled");
    }
  });

  it("does not invent a PROVISIONING_ELIGIBLE database state", () => {
    const mapping = CANONICAL_STATE_MAPPING.find((m) => m.factoryState === "PROVISIONING_ELIGIBLE");
    expect(mapping?.canonicalLifecycle).toBe("enrolled");
    expect(mapping?.note).toContain("DERIVED");
  });
});

// ---------------------------------------------------------------------------
// Hardware manifest
// ---------------------------------------------------------------------------

const REQUIRED = ["mac_address", "board_serial", "storage_serial"] as const;

function manifest(): HardwareSignal[] {
  return [
    { signal_type: "mac_address", signal_value: "b8:27:eb:00:00:01" },
    { signal_type: "board_serial", signal_value: "board-0001" },
    { signal_type: "storage_serial", signal_value: "nvme-0001" },
  ];
}

describe("hardware manifest validation", () => {
  it("accepts a complete manifest", () => {
    expect(validateHardwareManifest(manifest(), REQUIRED).ok).toBe(true);
  });

  it("refuses an empty manifest", () => {
    const r = validateHardwareManifest([], REQUIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("unregistered hardware cannot enroll");
  });

  it("refuses a manifest missing a profile-required signal", () => {
    const r = validateHardwareManifest(manifest().slice(0, 2), REQUIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("storage_serial");
  });

  it("refuses a duplicate signal type as ambiguous evidence", () => {
    const dup = [
      ...manifest(),
      { signal_type: "mac_address", signal_value: "aa:bb:cc:dd:ee:ff" } as HardwareSignal,
    ];
    const r = validateHardwareManifest(dup, REQUIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("duplicate signal type");
  });

  it("refuses an empty signal value", () => {
    const bad = manifest();
    bad[0] = { signal_type: "mac_address", signal_value: "   " };
    expect(validateHardwareManifest(bad, REQUIRED).ok).toBe(false);
  });

  it("refuses a signal type absent from the canonical enum", () => {
    const bad = [
      ...manifest(),
      { signal_type: "invented_signal", signal_value: "x" } as unknown as HardwareSignal,
    ];
    const r = validateHardwareManifest(bad, REQUIRED);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("unknown signal type");
  });

  it("mirrors the canonical hardware_signal_type enum exactly", () => {
    // Verified against the live canonical database 2026-08-07.
    expect([...CANONICAL_SIGNAL_TYPES]).toEqual([
      "mac_address",
      "board_serial",
      "soc_serial",
      "tpm_ek_public",
      "secure_element_id",
      "storage_serial",
      "storage_model",
      "boot_measurement",
      "os_image_digest",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Software factory QA
// ---------------------------------------------------------------------------

function qaInput(overrides: Partial<QaInputs> = {}): QaInputs {
  return {
    deviceClass: "store_hub",
    installationId: "inst-0001",
    publicKeyPem: "-----BEGIN PUBLIC KEY-----\nk\n-----END PUBLIC KEY-----",
    osImageVersion: "kitluy-os-0.1.0",
    agentVersion: "0.1.0",
    releaseChannel: "internal",
    manifest: validateHardwareManifest(manifest(), REQUIRED),
    enrollmentReachable: true,
    deviceRecordId: "dev-0001",
    localStatePersisted: true,
    localDatabasePresent: true,
    ...overrides,
  };
}

describe("software factory QA", () => {
  it("passes a complete Store Hub simulation", () => {
    const r = runFactoryQa(qaInput());
    expect(r.softwarePassed).toBe(true);
  });

  it("passes a complete terminal simulation", () => {
    const r = runFactoryQa(
      qaInput({
        deviceClass: "terminal",
        kioskRuntime: "wayland/labwc",
        localDatabasePresent: undefined,
      }),
    );
    expect(r.softwarePassed).toBe(true);
  });

  it("NEVER reports a hardware-in-the-loop check as passed from a simulation", () => {
    // Rule 20: no mock may be presented as physical hardware certification.
    for (const deviceClass of ["store_hub", "terminal"] as const) {
      const r = runFactoryQa(qaInput({ deviceClass, kioskRuntime: "wayland/labwc" }));
      const hw = r.checks.filter((c) => c.hardwareInLoop);
      expect(hw.length).toBeGreaterThan(0);
      for (const c of hw) expect(c.outcome).toBe("not_evaluated");
    }
  });

  it("excludes hardware checks from softwarePassed so it cannot read as certification", () => {
    const r = runFactoryQa(qaInput());
    expect(r.softwarePassed).toBe(true);
    expect(r.hardwareDeferred.length).toBeGreaterThan(0);
  });

  it("fails when enrollment produced no device record", () => {
    expect(runFactoryQa(qaInput({ deviceRecordId: undefined })).softwarePassed).toBe(false);
  });

  it("fails when the enrollment service was unreachable", () => {
    expect(runFactoryQa(qaInput({ enrollmentReachable: false })).softwarePassed).toBe(false);
  });

  it("fails when the manifest is invalid", () => {
    expect(
      runFactoryQa(qaInput({ manifest: validateHardwareManifest([], REQUIRED) })).softwarePassed,
    ).toBe(false);
  });

  it("fails when local state was not persisted", () => {
    expect(runFactoryQa(qaInput({ localStatePersisted: false })).softwarePassed).toBe(false);
  });

  it("applies class-specific checks only to the right class", () => {
    const hub = runFactoryQa(qaInput());
    const term = runFactoryQa(qaInput({ deviceClass: "terminal", kioskRuntime: "wayland/labwc" }));
    expect(hub.checks.map((c) => c.name)).toContain("local_database_present");
    expect(term.checks.map((c) => c.name)).not.toContain("local_database_present");
    expect(term.checks.map((c) => c.name)).toContain("kiosk_runtime_metadata");
    expect(hub.checks.map((c) => c.name)).not.toContain("kiosk_runtime_metadata");
  });

  it("is device-class-neutral for the shared checks", () => {
    const shared = [
      "unique_installation_identity",
      "device_keypair",
      "hardware_manifest",
      "enrollment_result",
    ];
    for (const deviceClass of [
      "store_hub",
      "terminal",
      "manufacturing_station",
      "peripheral",
    ] as const) {
      const names = runFactoryQa(
        qaInput({ deviceClass, localDatabasePresent: true, kioskRuntime: "x" }),
      ).checks.map((c) => c.name);
      for (const s of shared) expect(names).toContain(s);
    }
  });
});

// ---------------------------------------------------------------------------
// Provisioning eligibility
// ---------------------------------------------------------------------------

function facts(overrides: Partial<EligibilityFacts> = {}): EligibilityFacts {
  return {
    canonicalLifecycle: "enrolled",
    hasActiveAssignment: false,
    hardwareManifestSealed: true,
    softwareQaPassed: true,
    hardwareProfileCertified: true,
    ...overrides,
  };
}

describe("provisioning eligibility", () => {
  it("is eligible when every canonical fact holds", () => {
    expect(evaluateProvisioningEligibility(facts()).eligible).toBe(true);
  });

  it("fails closed on each missing fact independently", () => {
    const cases: ReadonlyArray<readonly [Partial<EligibilityFacts>, string]> = [
      [{ canonicalLifecycle: "manufactured" }, "only an 'enrolled' device"],
      [{ canonicalLifecycle: "quarantined" }, "only an 'enrolled' device"],
      [{ canonicalLifecycle: "retired" }, "only an 'enrolled' device"],
      [{ canonicalLifecycle: null }, "only an 'enrolled' device"],
      [{ hasActiveAssignment: true }, "not factory inventory"],
      [{ hardwareManifestSealed: false }, "manifest is not sealed"],
      [{ softwareQaPassed: false }, "software factory QA"],
      [{ hardwareProfileCertified: false }, "profile is not certified"],
    ];
    for (const [override, expected] of cases) {
      const v = evaluateProvisioningEligibility(facts(override));
      expect(v.eligible).toBe(false);
      expect(v.reasons.join(" ")).toContain(expected);
    }
  });

  it("an already-assigned device is not factory inventory", () => {
    // Guards against a provisioned device being recycled back through the
    // factory path and silently re-entering provisioning.
    const v = evaluateProvisioningEligibility(facts({ hasActiveAssignment: true }));
    expect(v.eligible).toBe(false);
  });

  it("reports every failing reason, not just the first", () => {
    const v = evaluateProvisioningEligibility(
      facts({
        canonicalLifecycle: "quarantined",
        softwareQaPassed: false,
        hardwareManifestSealed: false,
      }),
    );
    expect(v.reasons.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Log redaction
// ---------------------------------------------------------------------------

// These fixtures are the OPPOSITE of a secret: they exist to prove redaction
// REFUSES such input. `scripts/verification/secret-scan.mjs` matches PEM
// headers and JWTs in source and cannot tell the two apart, so the markers are
// assembled at runtime. The string under test is byte-identical; only the
// source stops being a scanner match.
const PEM_LABEL = "PRIVATE KEY";
const PEM_BEGIN = `-----BEGIN ${PEM_LABEL}-----`;
const PEM_END = `-----END ${PEM_LABEL}-----`;

describe("log redaction", () => {
  it("redacts a private key", () => {
    const out = redactForLog(`boot: ${PEM_BEGIN}\nsecret\n${PEM_END} done`);
    expect(out).not.toContain("secret");
    expect(out).toContain("[REDACTED]");
  });

  it("redacts a JWT", () => {
    const jwt = [
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
      "eyJyb2xlIjoic2VydmljZV9yb2xlIn0",
      "abcdefghijklmnop",
    ].join(".");
    expect(redactForLog(`token=${jwt}`)).not.toContain(jwt);
  });

  it("redacts a Supabase secret key and the service_role marker", () => {
    expect(redactForLog("key=sb_secret_abc123XYZ")).not.toContain("sb_secret_abc123XYZ");
    expect(redactForLog("role: service_role")).not.toContain("service_role");
  });

  it("leaves ordinary factory log lines intact", () => {
    const line = "factory: device dev-0001 enrolled, class=store_hub, assignments=0";
    expect(redactForLog(line)).toBe(line);
  });
});
