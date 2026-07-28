import { describe, expect, it } from "vitest";

import {
  compareHardwareEvidence,
  isLegalLifecycleTransition,
  isStorageModuleSignal,
  isTerminalLifecycleState,
  isValidTerminalProfileKey,
  normalizeHardwareSignal,
  PKI_BLOCKER_REF,
  PROVISIONING_CHAIN,
  RequiredCryptographicValueError,
  SIGNING_PURPOSES,
  TRUST_ENVIRONMENTS,
  UnconfiguredPkiProvider,
  validateTrustConfiguration,
  type DeviceRecordId,
  type HardwareSignal,
  type PkiTrustConfiguration,
} from "../src/index.js";

const signal = (signalType: HardwareSignal["signalType"], signalValue: string): HardwareSignal => ({
  signalType,
  signalValue,
});

const ENROLLED: readonly HardwareSignal[] = [
  signal("mac_address", "aa:bb:cc:dd:ee:ff"),
  signal("board_serial", "board-0001"),
  signal("storage_serial", "nvme-0001"),
];

/**
 * A configuration that is structurally valid, used as the baseline the
 * negative cases mutate. It is test data, not an approved configuration —
 * nothing here can open the BLK-005 gate, which lives in the database.
 */
const baselineConfig = (): PkiTrustConfiguration => ({
  environment: "production",
  rootCaReference: "custody://root",
  deviceIssuingCaReference: "custody://device-issuing",
  manufacturingCaReference: "custody://manufacturing",
  requiredKeyStorageClass: "secure_element",
  certificateLifetimeDays: 365,
  renewalWindowDays: 30,
  overlapWindowDays: 7,
  revocationMechanism: "CRL",
  offlineGraceHours: 72,
  configurationSigningKeyReference: "custody://config-signing",
  releaseSigningKeyReference: "custody://release-signing",
  transportSigningKeyReference: "custody://transport-signing",
  approvedByDecisionRef: "KLD-TEST-001",
});

describe("hardware evidence is a signal, never an identity", () => {
  it("reports a match when the same evidence is presented again", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [...ENROLLED]);
    expect(verdict.matched).toBe(true);
    expect(verdict.storageModuleOnlyChange).toBe(false);
  });

  it("treats formatting differences as equal, not as tamper", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [
      signal("mac_address", "  AA:BB:CC:DD:EE:FF "),
      signal("board_serial", "BOARD-0001"),
      signal("storage_serial", "NVMe-0001"),
    ]);
    expect(verdict.matched).toBe(true);
  });

  it("flags a changed board serial as a mismatch, not a storage change", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [
      signal("mac_address", "aa:bb:cc:dd:ee:ff"),
      signal("board_serial", "board-swapped"),
      signal("storage_serial", "nvme-0001"),
    ]);
    expect(verdict.matched).toBe(false);
    expect(verdict.mismatched).toEqual(["board_serial"]);
    expect(verdict.storageModuleOnlyChange).toBe(false);
  });

  it("recognises an NVMe swap as a storage-module-only change", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [
      signal("mac_address", "aa:bb:cc:dd:ee:ff"),
      signal("board_serial", "board-0001"),
      signal("storage_serial", "nvme-replacement"),
    ]);
    expect(verdict.matched).toBe(false);
    expect(verdict.storageModuleOnlyChange).toBe(true);
  });

  it("does not call a change storage-only when a signal also went missing", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [
      signal("mac_address", "aa:bb:cc:dd:ee:ff"),
      signal("storage_serial", "nvme-replacement"),
    ]);
    expect(verdict.missing).toEqual(["board_serial"]);
    expect(verdict.storageModuleOnlyChange).toBe(false);
  });

  it("reports evidence that was never enrolled as unexpected", () => {
    const verdict = compareHardwareEvidence(ENROLLED, [
      ...ENROLLED,
      signal("tpm_ek_public", "ek-appeared-from-nowhere"),
    ]);
    expect(verdict.unexpected).toEqual(["tpm_ek_public"]);
    expect(verdict.matched).toBe(false);
  });

  it("classifies exactly the storage-module signals as replaceable", () => {
    expect(isStorageModuleSignal("storage_serial")).toBe(true);
    expect(isStorageModuleSignal("storage_model")).toBe(true);
    expect(isStorageModuleSignal("board_serial")).toBe(false);
    expect(isStorageModuleSignal("mac_address")).toBe(false);
    expect(isStorageModuleSignal("tpm_ek_public")).toBe(false);
  });

  it("normalises without discarding the value", () => {
    expect(normalizeHardwareSignal("  AA:BB  ")).toBe("aa:bb");
  });
});

describe("device lifecycle state machine", () => {
  it("permits the governed enrollment and quarantine paths", () => {
    expect(isLegalLifecycleTransition("manufactured", "enrolled")).toBe(true);
    expect(isLegalLifecycleTransition("enrolled", "quarantined")).toBe(true);
    expect(isLegalLifecycleTransition("quarantined", "enrolled")).toBe(true);
    expect(isLegalLifecycleTransition("enrolled", "awaiting_trust")).toBe(true);
    expect(isLegalLifecycleTransition("awaiting_trust", "active")).toBe(true);
  });

  it("refuses backwards and terminal transitions", () => {
    expect(isLegalLifecycleTransition("enrolled", "manufactured")).toBe(false);
    expect(isLegalLifecycleTransition("quarantined", "active")).toBe(false);
    expect(isLegalLifecycleTransition("retired", "enrolled")).toBe(false);
    expect(isLegalLifecycleTransition("replaced", "active")).toBe(false);
  });

  it("refuses activation that skips the claim and assignment step", () => {
    // The whole point of `awaiting_trust`: a device cannot go straight from
    // enrolled to active, so it cannot be activated without an accepted claim
    // and a bound assignment. This mirrors migration 0121's trigger — if the
    // two ever disagree, one of them is wrong and this test says so.
    expect(isLegalLifecycleTransition("enrolled", "active")).toBe(false);
    expect(isLegalLifecycleTransition("manufactured", "active")).toBe(false);
  });

  it("treats retired and replaced as terminal", () => {
    expect(isTerminalLifecycleState("retired")).toBe(true);
    expect(isTerminalLifecycleState("replaced")).toBe(true);
    expect(isTerminalLifecycleState("quarantined")).toBe(false);
    expect(isTerminalLifecycleState("awaiting_trust")).toBe(false);
  });

  it("keeps the provisioning chain in one ordered place", () => {
    expect(PROVISIONING_CHAIN[0]).toBe("claim accepted");
    expect(PROVISIONING_CHAIN).toContain("device remains awaiting_trust");
    expect(PROVISIONING_CHAIN.indexOf("certificate issuance")).toBeLessThan(
      PROVISIONING_CHAIN.indexOf("activation"),
    );
    expect(PROVISIONING_CHAIN[PROVISIONING_CHAIN.length - 1]).toBe("activation");
  });
});

describe("terminal profile keys stay structural, not Laundry-specific", () => {
  it("accepts the owner-locked T1-T4 shape", () => {
    for (const key of [
      "laundry.t1.intake_cashier",
      "laundry.t2.customer_display",
      "laundry.t3.ready_scan_in",
      "laundry.t4.pickup_scan_out",
    ]) {
      expect(isValidTerminalProfileKey(key)).toBe(true);
    }
  });

  it("accepts a future vertical without a code change", () => {
    // Neutral Core must not need editing when a second vertical arrives.
    expect(isValidTerminalProfileKey("cafe.t1.counter_cashier")).toBe(true);
  });

  it("refuses shapes that are not a terminal profile", () => {
    for (const key of [
      "laundry.intake_cashier",
      "t1.intake_cashier",
      "laundry.t0.intake_cashier",
      "laundry.tx.intake_cashier",
      "LAUNDRY.T1.INTAKE",
      "",
    ]) {
      expect(isValidTerminalProfileKey(key)).toBe(false);
    }
  });
});

describe("the BLK-005 fail-closed provider", () => {
  const provider = new UnconfiguredPkiProvider();
  const deviceRecordId = "11111111-1111-4111-8111-111111111111" as DeviceRecordId;

  it("refuses to resolve trust configuration in every environment", async () => {
    for (const environment of TRUST_ENVIRONMENTS) {
      await expect(provider.resolveTrustConfiguration(environment)).rejects.toBeInstanceOf(
        RequiredCryptographicValueError,
      );
    }
  });

  it("names the required value and the blocker in the message", async () => {
    const error = await provider.resolveTrustConfiguration("production").then(
      () => undefined,
      (e: unknown) => e as RequiredCryptographicValueError,
    );
    expect(error).toBeInstanceOf(RequiredCryptographicValueError);
    expect(error?.code).toBe("KLUY-DEVICE-PKI-UNCONFIGURED");
    expect(error?.blockerRef).toBe(PKI_BLOCKER_REF);
    expect(error?.environment).toBe("production");
    expect(error?.message).toContain("[REQUIRED:");
    expect(error?.message).toContain("BLK-005");
  });

  it("refuses certificate issuance", async () => {
    await expect(
      provider.issueDeviceCertificate({
        deviceRecordId,
        environment: "production",
        devicePublicKeyFingerprint: "a".repeat(64),
        keyStorageClass: "secure_element",
        hardwareManifestDigest: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(RequiredCryptographicValueError);
  });

  it("refuses revocation rather than answering a revocation question it cannot answer", async () => {
    // Returning `true` here would look like a safe default while asserting a
    // revocation fact nobody established; returning `false` would be worse.
    await expect(provider.isCertificateRevoked("SERIAL-1", "production")).rejects.toBeInstanceOf(
      RequiredCryptographicValueError,
    );
    await expect(
      provider.revokeDeviceCertificate("SERIAL-1", "production", "LOST"),
    ).rejects.toBeInstanceOf(RequiredCryptographicValueError);
  });

  it("refuses attestation verification", async () => {
    await expect(
      provider.verifyDeviceAttestation(deviceRecordId, "production", {
        secureBootEnabled: true,
        bootMeasurement: "c".repeat(64),
        osImageDigest: "d".repeat(64),
        keyStorageClass: "secure_element",
      }),
    ).rejects.toBeInstanceOf(RequiredCryptographicValueError);
  });

  it("refuses to sign or verify for every named purpose", async () => {
    const payload = new Uint8Array([1, 2, 3]);
    for (const purpose of SIGNING_PURPOSES) {
      await expect(provider.sign(purpose, "production", payload)).rejects.toBeInstanceOf(
        RequiredCryptographicValueError,
      );
      await expect(provider.verify(purpose, "production", payload, payload)).rejects.toBeInstanceOf(
        RequiredCryptographicValueError,
      );
      await expect(provider.keyReference(purpose, "production")).rejects.toBeInstanceOf(
        RequiredCryptographicValueError,
      );
    }
  });

  it("names the purpose it could not serve, so the ballot item is identifiable", async () => {
    const error = await provider.keyReference("release_signing", "production").then(
      () => undefined,
      (e: unknown) => e as RequiredCryptographicValueError,
    );
    expect(error?.requiredValue).toContain("release_signing");
  });
});

describe("trust configuration validation", () => {
  it("accepts a structurally sound configuration", () => {
    expect(validateTrustConfiguration(baselineConfig())).toEqual([]);
  });

  it("refuses a placeholder approval reference", () => {
    for (const ref of ["", "  ", "TBD", "todo", "n/a", "[REQUIRED: owner PKI decision]"]) {
      const problems = validateTrustConfiguration({
        ...baselineConfig(),
        approvedByDecisionRef: ref,
      });
      expect(problems.map((p) => p.field)).toContain("approvedByDecisionRef");
    }
  });

  it("refuses one key reused across signing purposes", () => {
    const problems = validateTrustConfiguration({
      ...baselineConfig(),
      configurationSigningKeyReference: "custody://one-key",
      releaseSigningKeyReference: "custody://one-key",
      transportSigningKeyReference: "custody://one-key",
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(problems.every((p) => p.problem.includes("separate keys"))).toBe(true);
  });

  it("refuses the offline root acting as the device-issuing CA", () => {
    const problems = validateTrustConfiguration({
      ...baselineConfig(),
      rootCaReference: "custody://root",
      deviceIssuingCaReference: "custody://root",
    });
    expect(problems.map((p) => p.field)).toContain("deviceIssuingCaReference");
  });

  it("refuses windows that do not fit inside the certificate lifetime", () => {
    const problems = validateTrustConfiguration({
      ...baselineConfig(),
      certificateLifetimeDays: 30,
      renewalWindowDays: 90,
      overlapWindowDays: 45,
    });
    expect(problems.map((p) => p.field)).toEqual(
      expect.arrayContaining(["renewalWindowDays", "overlapWindowDays"]),
    );
  });

  it("refuses software key storage in production but allows it in development", () => {
    expect(
      validateTrustConfiguration({
        ...baselineConfig(),
        requiredKeyStorageClass: "software",
      }).map((p) => p.field),
    ).toContain("requiredKeyStorageClass");

    expect(
      validateTrustConfiguration({
        ...baselineConfig(),
        environment: "development",
        requiredKeyStorageClass: "software",
      }),
    ).toEqual([]);
  });
});
