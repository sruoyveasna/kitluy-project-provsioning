import { describe, expect, it } from "vitest";

import {
  activateConfiguration,
  evaluateConfigurationSnapshot,
  rollbackConfiguration,
  type ActivationState,
  type ConfigurationSnapshot,
  type ConfigurationVerificationContext,
  type DeviceScope,
} from "../src/configuration-validity.js";
import {
  DEVICE,
  NOW,
  OTHER_DEVICE,
  RESTRICTED_STATUSES,
  days,
  hours,
  trusted,
} from "./consumer-fixtures.js";

const SCOPE: DeviceScope = {
  tenantId: "tenant-a",
  digitalStoreId: "store-1",
  storeLocationId: "loc-1",
  deviceRecordId: DEVICE,
  assignmentGeneration: 5,
};

const snapshot = (over: Partial<ConfigurationSnapshot> = {}): ConfigurationSnapshot => ({
  configurationVersion: 12,
  purpose: "configuration_signing",
  environment: "development",
  tenantId: SCOPE.tenantId,
  digitalStoreId: SCOPE.digitalStoreId,
  storeLocationId: SCOPE.storeLocationId,
  deviceRecordId: DEVICE,
  assignmentGeneration: 5,
  issuedAt: hours(-1),
  validUntil: days(7),
  payloadSha256: "d".repeat(64),
  computedPayloadSha256: "d".repeat(64),
  signerKeyId: "dev-config-signer",
  signerPurpose: "configuration_signing",
  signatureValid: true,
  ...over,
});

const ctx = (
  over: Partial<ConfigurationVerificationContext> = {},
): ConfigurationVerificationContext => ({
  snapshot: snapshot(),
  trustedTime: trusted(),
  environment: "development",
  scope: SCOPE,
  activeVersion: 11,
  ...over,
});

describe("configuration_snapshot.validity", () => {
  it("accepts a well-formed, in-scope snapshot", () => {
    expect(evaluateConfigurationSnapshot(ctx()).valid).toBe(true);
  });

  it("fails closed with no trusted time and in restricted trust mode", () => {
    expect(
      evaluateConfigurationSnapshot(ctx({ trustedTime: { ...trusted(), trustedTime: null } }))
        .rejectionCode,
    ).toBe("CONFIG_NO_TRUSTED_TIME");
    for (const status of RESTRICTED_STATUSES) {
      expect(
        evaluateConfigurationSnapshot(ctx({ trustedTime: trusted(NOW, status) })).rejectionCode,
      ).toBe("CONFIG_RESTRICTED_TRUST_MODE");
    }
  });

  it("enforces signer purpose and integrity", () => {
    expect(
      evaluateConfigurationSnapshot(
        ctx({ snapshot: snapshot({ signerPurpose: "release_signing" }) }),
      ).rejectionCode,
    ).toBe("CONFIG_CROSS_PURPOSE_SIGNER");
    expect(
      evaluateConfigurationSnapshot(
        ctx({ snapshot: snapshot({ computedPayloadSha256: "e".repeat(64) }) }),
      ).rejectionCode,
    ).toBe("CONFIG_CHECKSUM_MISMATCH");
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ signatureValid: false }) }))
        .rejectionCode,
    ).toBe("CONFIG_SIGNATURE_INVALID");
  });

  it("enforces environment, device, scope and assignment binding", () => {
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ environment: "production" }) }))
        .rejectionCode,
    ).toBe("CONFIG_WRONG_ENVIRONMENT");
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ deviceRecordId: OTHER_DEVICE }) }))
        .rejectionCode,
    ).toBe("CONFIG_DEVICE_MISMATCH");
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ storeLocationId: "loc-2" }) }))
        .rejectionCode,
    ).toBe("CONFIG_SCOPE_MISMATCH");
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ assignmentGeneration: 4 }) }))
        .rejectionCode,
    ).toBe("CONFIG_ASSIGNMENT_MISMATCH");
  });

  it("refuses a version rollback", () => {
    // Replaying an older configuration is how a withdrawn price, permission or
    // rule comes back.
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: snapshot({ configurationVersion: 10 }) }))
        .rejectionCode,
    ).toBe("CONFIG_VERSION_ROLLBACK");
  });

  it("expires purely by trusted time advancing", () => {
    const s = snapshot();
    expect(evaluateConfigurationSnapshot(ctx({ snapshot: s })).valid).toBe(true);
    expect(
      evaluateConfigurationSnapshot(ctx({ snapshot: s, trustedTime: trusted(days(9)) }))
        .rejectionCode,
    ).toBe("CONFIG_EXPIRED");
  });
});

describe("configuration activation and rollback", () => {
  const state: ActivationState = { activeVersion: 11, verifiedVersions: [10, 11] };

  it("activates atomically and records the version as verified", () => {
    const out = activateConfiguration(ctx(), state);
    expect(out.outcome).toBe("ACTIVATED");
    expect(out.state.activeVersion).toBe(12);
    expect(out.state.verifiedVersions).toEqual([10, 11, 12]);
  });

  it("leaves state COMPLETELY unchanged when activation is refused", () => {
    // No partial application: a Store running on a mixture of two rulesets is
    // worse than a Store running on the old one.
    const out = activateConfiguration(
      ctx({ snapshot: snapshot({ signatureValid: false }) }),
      state,
    );
    expect(out.outcome).toBe("REFUSED");
    expect(out.state).toBe(state);
    expect(out.refusalCode).toBe("CONFIG_SIGNATURE_INVALID");
  });

  it("rolls back only to a PREVIOUSLY VERIFIED version", () => {
    expect(rollbackConfiguration(state, 10).state.activeVersion).toBe(10);
  });

  it("refuses rollback to a version this device never verified", () => {
    // "Last known good" is only meaningful if the thing was ever known good;
    // otherwise rollback launders an unverified version into the active slot.
    const out = rollbackConfiguration(state, 7);
    expect(out.outcome).toBe("REFUSED");
    expect(out.refusalCode).toBe("ROLLBACK_TARGET_UNVERIFIED");
    expect(out.state).toBe(state);
  });
});
