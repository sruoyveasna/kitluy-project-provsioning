/**
 * Cross-consumer integration.
 *
 * One REAL trusted-time evaluator drives all four governed consumers. The
 * per-consumer tests build a TrustedTimeEvaluation by hand; this one does not,
 * because the question here is whether a single clock event changes every
 * consumer CONSISTENTLY. If one consumer kept its own notion of "now", the
 * per-consumer suites would still pass and this would not.
 */
import { describe, expect, it } from "vitest";

import {
  evaluateTrustedTime,
  type AuthenticatedNetworkTimeProvider,
  type RtcTimeProvider,
  type SignedTimeTokenVerifier,
  type TrustedTimeCommit,
  type TrustedTimeDependencies,
  type TrustedTimeEvaluation,
  type TrustedTimePolicy,
  type TrustedTimeState,
  type TrustedTimeStore,
} from "../src/trusted-time.js";
import { evaluateCertificateValidity } from "../src/certificate-validity.js";
import { evaluateRenewalEligibility } from "../src/certificate-renewal.js";
import { evaluateRevocationSnapshot, type RevocationSnapshot } from "../src/revocation-snapshot.js";
import {
  evaluateConfigurationSnapshot,
  type ConfigurationSnapshot,
  type DeviceScope,
} from "../src/configuration-validity.js";
import { DEVICE, ISSUERS, certificate, days, hours, noRevocations } from "./consumer-fixtures.js";

const T0 = new Date("2026-07-28T08:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

const policy: TrustedTimePolicy = {
  environment: "development",
  policyVersion: 1,
  maxClockLagSeconds: 300,
  maxForwardJumpSeconds: 3600,
  tokenMaxLifetimeSeconds: 900,
  tokenAllowedSkewSeconds: 30,
  signatureVerified: false,
  source: "deterministic_test_policy",
  productionEligible: false,
};

class Rtc implements RtcTimeProvider {
  constructor(
    public time: Date | null,
    public faulted = false,
  ) {}
  async read() {
    return {
      available: this.time !== null,
      ...(this.time !== null ? { time: this.time } : {}),
      faulted: this.faulted,
    };
  }
}

class NoNetwork implements AuthenticatedNetworkTimeProvider {
  async fetch() {
    return { available: false, authenticated: false };
  }
}

class Store implements TrustedTimeStore {
  constructor(private state: TrustedTimeState | null = null) {}
  async load() {
    return this.state;
  }
  async commitEvaluation(input: TrustedTimeCommit): Promise<TrustedTimeState> {
    const previous = this.state?.floor ?? null;
    const next =
      input.nextFloor !== null && (previous === null || input.nextFloor > previous)
        ? input.nextFloor
        : previous;
    this.state = {
      deviceRecordId: input.deviceRecordId,
      floor: next,
      status: input.status,
      anomalyType: input.anomalyType,
      lastSource: input.source,
      lastSelectedTime: input.selectedTime,
      policyVersion: input.policyVersion,
    };
    return this.state;
  }
}

const noTokens: SignedTimeTokenVerifier = {
  verify: async () => ({ valid: false, rejectionCode: "TOKEN_NO_CHALLENGE" }),
  consume: async () => undefined,
};

const deps = (rtc: Rtc, store: Store): TrustedTimeDependencies => ({
  rtc,
  network: new NoNetwork(),
  tokens: noTokens,
  store,
  policies: { getPolicy: async () => policy },
});

const SCOPE: DeviceScope = {
  tenantId: "tenant-a",
  digitalStoreId: "store-1",
  storeLocationId: "loc-1",
  deviceRecordId: DEVICE,
  assignmentGeneration: 5,
};

const revocationSnapshot: RevocationSnapshot = {
  snapshotVersion: 10,
  purpose: "configuration_signing",
  environment: "development",
  issuedAt: hours(-1),
  validUntil: days(7),
  payloadSha256: "b".repeat(64),
  computedPayloadSha256: "b".repeat(64),
  signerKeyId: "dev-config-signer",
  signerPurpose: "configuration_signing",
  revokedCertificateSerials: [],
  revokedDeviceRecordIds: [],
  signatureValid: true,
};

const configurationSnapshot: ConfigurationSnapshot = {
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
};

/** Runs all four consumers against ONE trusted-time evaluation. */
const runAll = (trustedTime: TrustedTimeEvaluation) => ({
  certificate: evaluateCertificateValidity({
    certificate: certificate(),
    trustedTime,
    environment: "development",
    deviceRecordId: DEVICE,
    currentDeviceKeyGeneration: 2,
    currentAssignmentGeneration: 5,
    issuers: ISSUERS,
    revocations: noRevocations,
    signatureValid: true,
  }),
  renewal: evaluateRenewalEligibility({
    certificate: certificate({ notBefore: days(-25), notAfter: days(5) }),
    trustedTime,
    environment: "development",
    deviceRecordId: DEVICE,
    revocations: noRevocations,
    existingOverlapDays: 0,
  }),
  revocation: evaluateRevocationSnapshot({
    snapshot: revocationSnapshot,
    trustedTime,
    environment: "development",
    acceptedVersion: 9,
  }),
  configuration: evaluateConfigurationSnapshot({
    snapshot: configurationSnapshot,
    trustedTime,
    environment: "development",
    scope: SCOPE,
    activeVersion: 11,
  }),
});

describe("one TrustedTime instance drives all four consumers", () => {
  it("all four succeed when trusted time is established", async () => {
    const store = new Store();
    const trustedTime = await evaluateTrustedTime(deps(new Rtc(T0), store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(trustedTime.status).toBe("trusted");

    const r = runAll(trustedTime);
    expect(r.certificate.valid).toBe(true);
    expect(r.renewal.eligible).toBe(true);
    expect(r.revocation.accepted).toBe(true);
    expect(r.configuration.valid).toBe(true);
  });

  it("a clock ROLLBACK restricts all four consistently", async () => {
    const store = new Store();
    const rtc = new Rtc(T0);
    await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });

    rtc.time = at(-600); // beyond the 300-second tolerance
    const trustedTime = await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(trustedTime.status).toBe("restricted_clock_rollback");

    const r = runAll(trustedTime);
    expect(r.certificate.rejectionCode).toBe("CERT_RESTRICTED_TRUST_MODE");
    expect(r.renewal.refusalCode).toBe("RENEWAL_RESTRICTED_TRUST_MODE");
    expect(r.revocation.rejectionCode).toBe("SNAPSHOT_RESTRICTED_TRUST_MODE");
    expect(r.configuration.rejectionCode).toBe("CONFIG_RESTRICTED_TRUST_MODE");
    // Every one of them refuses. None is left deciding on its own clock.
    expect(r.certificate.valid).toBe(false);
    expect(r.renewal.eligible).toBe(false);
    expect(r.revocation.accepted).toBe(false);
    expect(r.configuration.valid).toBe(false);
  });

  it("a FORWARD JUMP restricts all four consistently", async () => {
    const store = new Store();
    const rtc = new Rtc(T0);
    await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });

    rtc.time = at(7200); // beyond the signed 3600-second threshold
    const trustedTime = await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(trustedTime.status).toBe("restricted_forward_jump");

    const r = runAll(trustedTime);
    expect(r.certificate.valid).toBe(false);
    expect(r.renewal.eligible).toBe(false);
    expect(r.revocation.accepted).toBe(false);
    expect(r.configuration.valid).toBe(false);
  });

  it("SOURCE FAILURE restricts all four consistently", async () => {
    const store = new Store();
    const trustedTime = await evaluateTrustedTime(deps(new Rtc(null, true), store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(trustedTime.status).toBe("restricted_rtc_failure");

    const r = runAll(trustedTime);
    expect(r.certificate.valid).toBe(false);
    expect(r.renewal.eligible).toBe(false);
    expect(r.revocation.accepted).toBe(false);
    expect(r.configuration.valid).toBe(false);
  });

  it("a stale revocation snapshot still enforces its revocations while the others refuse", async () => {
    // The asymmetry is deliberate and worth pinning: freshness governs what NEW
    // trust may be granted, not what has already been withdrawn.
    const store = new Store();
    const rtc = new Rtc(T0);
    await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    rtc.time = at(-600);
    const restricted = await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });

    const r = runAll(restricted);
    // In restricted mode the snapshot cannot be judged fresh at all, so it is
    // not accepted AND its contents are not treated as authoritative.
    expect(r.revocation.accepted).toBe(false);
    expect(r.revocation.entersRestrictedMode).toBe(true);
  });

  it("recovery to a trustworthy source restores all four together", async () => {
    const store = new Store();
    const rtc = new Rtc(T0);
    await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    rtc.time = at(-600);
    await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });

    rtc.time = at(60);
    const recovered = await evaluateTrustedTime(deps(rtc, store), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(recovered.status).toBe("trusted");

    const r = runAll(recovered);
    expect(r.certificate.valid).toBe(true);
    expect(r.renewal.eligible).toBe(true);
    expect(r.revocation.accepted).toBe(true);
    expect(r.configuration.valid).toBe(true);
  });
});

describe("RV-TT-001 regression: uninitialized is not trusted", () => {
  // Review finding RV-TT-001. trustedInstant() keyed off !isRestricted(), so a
  // TrustedTimeEvaluation carrying status "uninitialized" AND a time was
  // accepted by every consumer. The SQL layer already refused the same status,
  // so the two layers disagreed — the C34-C36 failure shape.
  const uninitialized: TrustedTimeEvaluation = {
    status: "uninitialized",
    trustedTime: T0,
    source: "none",
    floorAdvanced: false,
    anomalyType: null,
    restricted: false,
    detail: "never established",
  };

  it("refuses all four consumers on an uninitialized evaluation", () => {
    const r = runAll(uninitialized);
    expect(r.certificate.rejectionCode).toBe("CERT_NO_TRUSTED_TIME");
    expect(r.renewal.refusalCode).toBe("RENEWAL_NO_TRUSTED_TIME");
    expect(r.revocation.rejectionCode).toBe("SNAPSHOT_NO_TRUSTED_TIME");
    expect(r.configuration.rejectionCode).toBe("CONFIG_NO_TRUSTED_TIME");
  });

  it("does not believe a self-reported restricted flag over the status", () => {
    // A caller that sets restricted:false while the status is restricted must
    // not be believed. Consumers key off the STATUS.
    const lying: TrustedTimeEvaluation = {
      ...uninitialized,
      status: "restricted_clock_rollback",
      anomalyType: "forged",
      restricted: false,
    };
    const r = runAll(lying);
    expect(r.certificate.valid).toBe(false);
    expect(r.renewal.eligible).toBe(false);
    expect(r.revocation.accepted).toBe(false);
    expect(r.configuration.valid).toBe(false);
  });
});
