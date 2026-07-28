import { describe, expect, it } from "vitest";

import { RequiredCryptographicValueError } from "../src/index.js";
import {
  DefaultSignedTimeTokenVerifier,
  TRUSTED_TIME_TOKEN_PURPOSE,
  assertPolicyUsable,
  canActivateOffline,
  evaluateTrustedTime,
  isRestricted,
  timeTokenPreimage,
  validateTimeCorrection,
  type AuthenticatedNetworkTimeProvider,
  type RtcTimeProvider,
  type SignedTimeToken,
  type ActivationChallenge,
  type ActivationChallengeStore,
  type TokenReplayStore,
  type TokenSignatureVerifier,
  type TokenSignerRegistration,
  type TrustedTimeCommit,
  type TrustedTimeDependencies,
  type TrustedTimePolicy,
  type TrustedTimePolicyProvider,
  type TrustedTimeState,
  type TrustedTimeStore,
} from "../src/trusted-time.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const T0 = new Date("2026-07-28T08:00:00.000Z");
const at = (offsetSeconds: number) => new Date(T0.getTime() + offsetSeconds * 1000);

/**
 * A deterministic DEVELOPMENT policy. Marked as a test policy and
 * production-ineligible, per the owner's instruction — a test policy that could
 * pass for a signed one is how a test fixture ends up authorizing production.
 */
const devPolicy = (over: Partial<TrustedTimePolicy> = {}): TrustedTimePolicy => ({
  environment: "development",
  policyVersion: 1,
  maxClockLagSeconds: 300,
  maxForwardJumpSeconds: 3600,
  tokenMaxLifetimeSeconds: 900,
  tokenAllowedSkewSeconds: 30,
  signatureVerified: false,
  source: "deterministic_test_policy",
  productionEligible: false,
  ...over,
});

class FixedRtc implements RtcTimeProvider {
  constructor(
    private readonly time: Date | null,
    private readonly faulted = false,
  ) {}
  async read() {
    return {
      available: this.time !== null,
      ...(this.time !== null ? { time: this.time } : {}),
      faulted: this.faulted,
      ...(this.faulted ? { detail: "battery lost" } : {}),
    };
  }
}

class FixedNetwork implements AuthenticatedNetworkTimeProvider {
  constructor(
    private readonly time: Date | null,
    private readonly authenticated = true,
  ) {}
  async fetch() {
    return {
      available: this.time !== null,
      ...(this.time !== null ? { time: this.time } : {}),
      authenticated: this.authenticated,
    };
  }
}

class MemoryStore implements TrustedTimeStore {
  public commits: TrustedTimeCommit[] = [];
  constructor(private state: TrustedTimeState | null = null) {}
  async load() {
    return this.state;
  }
  async commitEvaluation(input: TrustedTimeCommit): Promise<TrustedTimeState> {
    // Monotonic, exactly as the database trigger is. A store that let the floor
    // slip backwards would make the TypeScript layer weaker than the SQL one.
    const previous = this.state?.floor ?? null;
    const next =
      input.nextFloor !== null && (previous === null || input.nextFloor > previous)
        ? input.nextFloor
        : previous;
    this.commits.push(input);
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

class MemoryReplay implements TokenReplayStore {
  private seen = new Set<string>();
  async hasSeen(deviceRecordId: string, tokenId: string, nonce: string) {
    return this.seen.has(`${deviceRecordId}|${tokenId}|${nonce}`);
  }
  async remember(deviceRecordId: string, tokenId: string, nonce: string) {
    this.seen.add(`${deviceRecordId}|${tokenId}|${nonce}`);
  }
}

const CHALLENGE_ID = "chal-1";
const ATTEMPT = "boot-7";

const challenge = (over: Partial<ActivationChallenge> = {}): ActivationChallenge => ({
  challengeId: CHALLENGE_ID,
  nonce: "nonce-1",
  deviceRecordId: DEVICE,
  environment: "development",
  assignmentGeneration: 3,
  activationAttemptId: ATTEMPT,
  consumed: false,
  ...over,
});

class MemoryChallenges implements ActivationChallengeStore {
  public consumedIds: string[] = [];
  constructor(private readonly current: ActivationChallenge | null = challenge()) {}
  async load(challengeId: string) {
    return this.current?.challengeId === challengeId ? this.current : null;
  }
  async markConsumed(challengeId: string) {
    this.consumedIds.push(challengeId);
  }
}

const GOOD_KEY = "dev-device-identity-key-1";
const SIGNERS: TokenSignerRegistration[] = [
  {
    issuerKeyId: GOOD_KEY,
    environment: "development",
    purpose: "device_identity",
    revoked: false,
  },
  {
    issuerKeyId: "dev-release-key-1",
    environment: "development",
    purpose: "release_signing",
    revoked: false,
  },
  {
    issuerKeyId: "dev-revoked-key",
    environment: "development",
    purpose: "device_identity",
    revoked: true,
  },
  {
    issuerKeyId: "prod-device-identity-key-1",
    environment: "production",
    purpose: "device_identity",
    revoked: false,
  },
];

/**
 * A deterministic signature scheme: the "signature" is the preimage bytes. It
 * proves the verifier checks the signature OVER THE PREIMAGE, so any tampered
 * field changes the preimage and fails — without pulling in real crypto that
 * BLK-005 has not authorized a key for.
 */
class PreimageSignatures implements TokenSignatureVerifier {
  async verifySignature(_keyId: string, preimage: Uint8Array, signature: Uint8Array) {
    return Buffer.from(preimage).equals(Buffer.from(signature));
  }
}

const token = (over: Partial<SignedTimeToken> = {}): SignedTimeToken => {
  const base: SignedTimeToken = {
    tokenId: "tok-1",
    schemaVersion: 1,
    purpose: TRUSTED_TIME_TOKEN_PURPOSE,
    environment: "development",
    deviceRecordId: DEVICE,
    challengeId: CHALLENGE_ID,
    assignmentGeneration: 3,
    activationAttemptId: ATTEMPT,
    issuedAt: at(-60),
    trustedTime: T0,
    notBefore: at(-60),
    expiresAt: at(240),
    nonce: "nonce-1",
    issuerKeyId: GOOD_KEY,
    signature: new Uint8Array(),
    ...over,
  };
  return { ...base, signature: over.signature ?? timeTokenPreimage(base) };
};

const verifier = (replay = new MemoryReplay(), challenges = new MemoryChallenges()) =>
  new DefaultSignedTimeTokenVerifier(SIGNERS, new PreimageSignatures(), replay, challenges);

const deps = (over: Partial<TrustedTimeDependencies> = {}): TrustedTimeDependencies => ({
  rtc: new FixedRtc(null),
  network: new FixedNetwork(null),
  tokens: verifier(),
  store: new MemoryStore(),
  policies: { getPolicy: async () => devPolicy() } as TrustedTimePolicyProvider,
  ...over,
});

// ===========================================================================

describe("source selection", () => {
  it("establishes trusted time from a valid RTC alone", async () => {
    const result = await evaluateTrustedTime(deps({ rtc: new FixedRtc(T0) }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(result.status).toBe("trusted");
    expect(result.source).toBe("rtc");
    expect(result.floorAdvanced).toBe(true);
  });

  it("establishes trusted time from authenticated network time alone", async () => {
    const result = await evaluateTrustedTime(deps({ network: new FixedNetwork(T0) }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(result.status).toBe("trusted");
    expect(result.source).toBe("authenticated_network");
  });

  it("establishes trusted time from a valid signed token alone", async () => {
    const result = await evaluateTrustedTime(deps(), {
      deviceRecordId: DEVICE,
      environment: "development",
      token: token(),
      challenge: challenge(),
    });
    expect(result.status).toBe("trusted");
    expect(result.source).toBe("signed_cloud_token");
  });

  it("chooses the maximum when several sources are valid", async () => {
    const result = await evaluateTrustedTime(
      deps({ rtc: new FixedRtc(at(10)), network: new FixedNetwork(at(90)) }),
      {
        deviceRecordId: DEVICE,
        environment: "development",
        token: token(),
        challenge: challenge(),
      },
    );
    expect(result.source).toBe("authenticated_network");
    expect(result.trustedTime?.toISOString()).toBe(at(90).toISOString());
  });

  it("refuses an UNAUTHENTICATED network reading as a source", async () => {
    // Plain NTP is an attacker-controlled number with a plausible shape.
    const result = await evaluateTrustedTime(deps({ network: new FixedNetwork(T0, false) }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(result.status).toBe("restricted_no_trusted_source");
    expect(result.floorAdvanced).toBe(false);
  });

  it("keeps the persisted floor across a restart", async () => {
    const store = new MemoryStore();
    await evaluateTrustedTime(deps({ rtc: new FixedRtc(T0), store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    // Restart: no sources at all, only what was persisted.
    const result = await evaluateTrustedTime(deps({ store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(result.trustedTime?.toISOString()).toBe(T0.toISOString());
    expect(result.source).toBe("persisted_floor");
    expect(isRestricted(result.status)).toBe(true);
  });

  it("keeps the floor monotonic under concurrent evaluations", async () => {
    const store = new MemoryStore();
    await evaluateTrustedTime(deps({ rtc: new FixedRtc(at(600)), store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    const results = await Promise.all([
      evaluateTrustedTime(deps({ rtc: new FixedRtc(at(700)), store }), {
        deviceRecordId: DEVICE,
        environment: "development",
      }),
      evaluateTrustedTime(deps({ rtc: new FixedRtc(at(650)), store }), {
        deviceRecordId: DEVICE,
        environment: "development",
      }),
      evaluateTrustedTime(deps({ rtc: new FixedRtc(at(680)), store }), {
        deviceRecordId: DEVICE,
        environment: "development",
      }),
    ]);
    const final = await store.load();
    expect(final?.floor?.getTime()).toBe(at(700).getTime());
    expect(results.every((r) => r.status === "trusted")).toBe(true);
  });
});

describe("rollback and forward-jump", () => {
  const seeded = () =>
    new MemoryStore({
      deviceRecordId: DEVICE,
      floor: T0,
      status: "trusted",
      anomalyType: null,
      lastSource: "rtc",
      lastSelectedTime: T0,
      policyVersion: 1,
    });

  it("accepts a clock inside the 300-second tolerance without advancing", async () => {
    const store = seeded();
    const result = await evaluateTrustedTime(deps({ rtc: new FixedRtc(at(-120)), store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(result.status).toBe("trusted");
    expect(result.floorAdvanced).toBe(false);
    expect((await store.load())?.floor?.getTime()).toBe(T0.getTime());
  });

  it("treats a clock more than 300 seconds behind as rollback", async () => {
    const result = await evaluateTrustedTime(
      deps({ rtc: new FixedRtc(at(-600)), store: seeded() }),
      { deviceRecordId: DEVICE, environment: "development" },
    );
    expect(result.status).toBe("restricted_clock_rollback");
    expect(isRestricted(result.status)).toBe(true);
  });

  it("refuses a forward jump beyond the signed policy", async () => {
    const result = await evaluateTrustedTime(
      deps({ rtc: new FixedRtc(at(7200)), store: seeded() }),
      { deviceRecordId: DEVICE, environment: "development" },
    );
    expect(result.status).toBe("restricted_forward_jump");
    expect(result.floorAdvanced).toBe(false);
  });

  it("reports RTC failure distinctly from having no source", async () => {
    const faulted = await evaluateTrustedTime(
      deps({ rtc: new FixedRtc(null, true), store: seeded() }),
      { deviceRecordId: DEVICE, environment: "development" },
    );
    expect(faulted.status).toBe("restricted_rtc_failure");

    const absent = await evaluateTrustedTime(deps({ store: seeded() }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(absent.status).toBe("restricted_no_trusted_source");
  });
});

describe("policy fails closed", () => {
  it("refuses when the forward-jump threshold is absent", async () => {
    await expect(
      evaluateTrustedTime(
        deps({
          rtc: new FixedRtc(T0),
          policies: { getPolicy: async () => devPolicy({ maxForwardJumpSeconds: null }) },
        }),
        { deviceRecordId: DEVICE, environment: "development" },
      ),
    ).rejects.toBeInstanceOf(RequiredCryptographicValueError);
  });

  it("refuses when either token policy value is absent", () => {
    for (const over of [
      { tokenMaxLifetimeSeconds: null },
      { tokenAllowedSkewSeconds: null },
    ] as Array<Partial<TrustedTimePolicy>>) {
      expect(() => assertPolicyUsable(devPolicy(over))).toThrow(RequiredCryptographicValueError);
    }
  });

  it("refuses an UNSIGNED pilot or production policy", () => {
    for (const environment of ["pilot", "production"] as const) {
      expect(() =>
        assertPolicyUsable(
          devPolicy({ environment, source: "signed_configuration", signatureVerified: false }),
        ),
      ).toThrow(RequiredCryptographicValueError);
    }
  });

  it("refuses a deterministic TEST policy outside development", () => {
    // A test fixture must not be able to authorize pilot or production.
    expect(() =>
      assertPolicyUsable(
        devPolicy({
          environment: "production",
          source: "deterministic_test_policy",
          signatureVerified: true,
        }),
      ),
    ).toThrow(RequiredCryptographicValueError);
  });

  it("refuses a development policy that claims production eligibility", () => {
    expect(() => assertPolicyUsable(devPolicy({ productionEligible: true }))).toThrow(
      RequiredCryptographicValueError,
    );
  });
});

describe("signed time-token attacks", () => {
  const verifyToken = async (
    over: Partial<SignedTimeToken>,
    extra: {
      floor?: Date | null;
      comparison?: Date | null;
      policy?: TrustedTimePolicy;
      challenge?: ActivationChallenge | null;
    } = {},
  ) =>
    verifier().verify({
      token: token(over),
      deviceRecordId: DEVICE,
      environment: "development",
      persistedFloor: extra.floor ?? null,
      policy: extra.policy ?? devPolicy(),
      // `in`, not `??`. An explicit `comparison: null` means "there is no
      // comparison source" and `??` would silently replace it with T0 — the
      // test would then pass while never exercising the first-boot path.
      comparisonTime: "comparison" in extra ? (extra.comparison ?? null) : T0,
      challenge: extra.challenge === undefined ? challenge() : extra.challenge,
    });

  it("accepts a well-formed token", async () => {
    expect((await verifyToken({})).valid).toBe(true);
  });

  it("rejects an expired token when a comparison source exists", async () => {
    const v = await verifyToken({
      issuedAt: at(-600),
      notBefore: at(-600),
      expiresAt: at(-300),
    });
    expect(v.rejectionCode).toBe("TOKEN_EXPIRED");
  });

  it("rejects a not-yet-valid token", async () => {
    const v = await verifyToken({ issuedAt: at(600), notBefore: at(600), expiresAt: at(900) });
    expect(v.rejectionCode).toBe("TOKEN_NOT_YET_VALID");
  });

  it("cannot judge expiry with NO comparison source, and says so by accepting", async () => {
    // Genuine first boot. Expiry is unknowable; inventing a clock to judge it
    // would be the exact failure this module refuses. The token is still bound
    // by its signature and its declared lifetime.
    const v = await verifyToken(
      { issuedAt: at(-600), notBefore: at(-600), expiresAt: at(-300) },
      { comparison: null },
    );
    expect(v.valid).toBe(true);
  });

  it("rejects the wrong device", async () => {
    const v = await verifyToken({ deviceRecordId: "22222222-2222-4222-8222-222222222222" });
    expect(v.rejectionCode).toBe("TOKEN_WRONG_DEVICE");
  });

  it("rejects the wrong environment", async () => {
    const v = await verifyToken({ environment: "production" });
    expect(v.rejectionCode).toBe("TOKEN_WRONG_ENVIRONMENT");
  });

  it("rejects a signer registered to another environment", async () => {
    const v = await verifyToken({ issuerKeyId: "prod-device-identity-key-1" });
    expect(v.rejectionCode).toBe("TOKEN_WRONG_ENVIRONMENT");
  });

  it("rejects the wrong token purpose", async () => {
    const v = await verifyToken({ purpose: "configuration_snapshot" });
    expect(v.rejectionCode).toBe("TOKEN_WRONG_PURPOSE");
  });

  it("rejects a CROSS-PURPOSE signer even though its signature verifies", async () => {
    // The release key signs perfectly well. It is simply not authorized for
    // this purpose, and §7 says that is enough to reject.
    const v = await verifyToken({ issuerKeyId: "dev-release-key-1" });
    expect(v.rejectionCode).toBe("TOKEN_CROSS_PURPOSE_SIGNER");
  });

  it("rejects an unknown key id", async () => {
    const v = await verifyToken({ issuerKeyId: "who-is-this" });
    expect(v.rejectionCode).toBe("TOKEN_UNKNOWN_SIGNER");
  });

  it("rejects a revoked signer", async () => {
    const v = await verifyToken({ issuerKeyId: "dev-revoked-key" });
    expect(v.rejectionCode).toBe("TOKEN_SIGNER_REVOKED");
  });

  it("rejects a tampered payload", async () => {
    const good = token();
    const tampered: SignedTimeToken = { ...good, trustedTime: at(99999) };
    const v = await verifier().verify({
      token: tampered, // signature still covers the ORIGINAL trustedTime
      deviceRecordId: DEVICE,
      environment: "development",
      persistedFloor: null,
      policy: devPolicy(),
      comparisonTime: T0,
      challenge: challenge(),
    });
    expect(v.rejectionCode).toBe("TOKEN_SIGNATURE_INVALID");
  });

  it("rejects a replayed token", async () => {
    const replay = new MemoryReplay();
    const v = verifier(replay);
    const input = {
      token: token(),
      deviceRecordId: DEVICE,
      environment: "development" as const,
      persistedFloor: null,
      policy: devPolicy(),
      comparisonTime: T0,
      challenge: challenge(),
    };
    expect((await v.verify(input)).valid).toBe(true);
    // Consumption is the CALLER step now, taken after the floor commits. A
    // token that verified but whose commit never happened is still presentable,
    // which is exactly the point.
    await v.consume(input);
    expect((await v.verify(input)).rejectionCode).toBe("TOKEN_REPLAYED");
  });

  it("rejects a token whose time is below the persisted floor", async () => {
    const v = await verifyToken({}, { floor: at(3600) });
    expect(v.rejectionCode).toBe("TOKEN_TIME_BELOW_FLOOR");
  });

  it("rejects a declared lifetime beyond signed policy", async () => {
    const v = await verifyToken({ issuedAt: at(-60), notBefore: at(-60), expiresAt: at(7200) });
    expect(v.rejectionCode).toBe("TOKEN_LIFETIME_EXCEEDS_POLICY");
  });

  it("rejects a malformed window", async () => {
    const v = await verifyToken({ notBefore: at(300), expiresAt: at(100) });
    expect(v.rejectionCode).toBe("TOKEN_WINDOW_MALFORMED");
  });

  it("rejects an unsupported schema version", async () => {
    const v = await verifyToken({ schemaVersion: 99 });
    expect(v.rejectionCode).toBe("TOKEN_SCHEMA_UNSUPPORTED");
  });

  it("does not remember a token it rejected", async () => {
    // A rejected token must not burn its own nonce, or an attacker could
    // invalidate a legitimate token by presenting a broken copy first.
    const replay = new MemoryReplay();
    const v = verifier(replay);
    await v.verify({
      token: token({ deviceRecordId: "22222222-2222-4222-8222-222222222222" }),
      deviceRecordId: DEVICE,
      environment: "development",
      persistedFloor: null,
      policy: devPolicy(),
      comparisonTime: T0,
      challenge: challenge(),
    });
    expect(await replay.hasSeen(DEVICE, "tok-1", "nonce-1")).toBe(false);
  });
});

describe("first boot", () => {
  it("refuses activation when only a persisted floor exists", async () => {
    const store = new MemoryStore();
    await evaluateTrustedTime(deps({ rtc: new FixedRtc(T0), store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    const restart = await evaluateTrustedTime(deps({ store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    // The device is RESTRICTED (no trustworthy source), and that reason wins —
    // it is the more specific truth. The persisted-floor branch below is
    // defence in depth for a caller that constructs an evaluation by hand.
    const verdict = canActivateOffline(restart);
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toContain("no trustworthy time source");
  });

  it("refuses a hand-built evaluation whose only source is the persisted floor", () => {
    // evaluateTrustedTime cannot currently produce this shape — a floor with no
    // source is always restricted first. The guard exists so a future caller
    // that assembles an evaluation itself cannot activate on a floor alone,
    // which is the §12.5 rule stated independently of how it is reached.
    const verdict = canActivateOffline({
      status: "trusted",
      trustedTime: T0,
      source: "persisted_floor",
      floorAdvanced: false,
      anomalyType: null,
      detail: "hand-built",
    });
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toContain("persisted floor alone");
  });

  it("permits activation on a validated token alone", async () => {
    const result = await evaluateTrustedTime(deps(), {
      deviceRecordId: DEVICE,
      environment: "development",
      token: token(),
      challenge: challenge(),
    });
    expect(canActivateOffline(result).permitted).toBe(true);
  });

  it("refuses activation when the token was rejected", async () => {
    const result = await evaluateTrustedTime(deps(), {
      deviceRecordId: DEVICE,
      environment: "development",
      token: token({ issuerKeyId: "who-is-this" }),
      challenge: challenge(),
    });
    expect(result.status).toBe("restricted_no_trusted_source");
    expect(result.anomalyType).toContain("TOKEN_UNKNOWN_SIGNER");
    expect(canActivateOffline(result).permitted).toBe(false);
  });

  it("refuses activation in restricted trust mode", async () => {
    const store = new MemoryStore({
      deviceRecordId: DEVICE,
      floor: T0,
      status: "trusted",
      anomalyType: null,
      lastSource: "rtc",
      lastSelectedTime: T0,
      policyVersion: 1,
    });
    const result = await evaluateTrustedTime(deps({ rtc: new FixedRtc(at(-600)), store }), {
      deviceRecordId: DEVICE,
      environment: "development",
    });
    expect(canActivateOffline(result).permitted).toBe(false);
  });
});

describe("emergency correction", () => {
  const request = (over: Record<string, unknown> = {}) => ({
    deviceRecordId: DEVICE,
    proposedTrustedTime: at(86400),
    evidenceSource: "signed cloud token",
    reason: "RTC battery replaced",
    approvalId: "APPR-1",
    approvalRiskClass: "A4_OWNER_SECURITY",
    actorRef: "OP-FIELD",
    approverRef: "OP-SECURITY",
    correlationId: null,
    ...over,
  });

  it("applies a four-eyes forward correction", () => {
    const out = validateTimeCorrection(request(), T0);
    expect(out.outcome).toBe("APPLIED");
    expect(out.newTrustedTime?.getTime()).toBe(at(86400).getTime());
  });

  it("refuses a missing approval", () => {
    expect(validateTimeCorrection(request({ approvalId: "  " }), T0).refusalCode).toBe(
      "KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED",
    );
  });

  it("refuses self-approval", () => {
    expect(validateTimeCorrection(request({ approverRef: "OP-FIELD" }), T0).refusalCode).toBe(
      "KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED",
    );
  });

  it("refuses an insufficient risk class", () => {
    expect(validateTimeCorrection(request({ approvalRiskClass: "A2" }), T0).refusalCode).toBe(
      "KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS",
    );
  });

  it("refuses missing evidence", () => {
    expect(validateTimeCorrection(request({ evidenceSource: "" }), T0).refusalCode).toBe(
      "KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED",
    );
    expect(validateTimeCorrection(request({ reason: "" }), T0).refusalCode).toBe(
      "KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED",
    );
  });

  it("refuses a BACKWARD correction under full authority", () => {
    const out = validateTimeCorrection(request({ proposedTrustedTime: at(-86400) }), T0);
    expect(out.refusalCode).toBe("KLUY-DEVICE-TIME-ROLLBACK");
  });

  it("carries the old value on every refusal, so the audit is complete", () => {
    const out = validateTimeCorrection(request({ approvalId: "" }), T0);
    expect(out.oldTrustedTime?.getTime()).toBe(T0.getTime());
    expect(out.refusalMessage).toBeTruthy();
  });
});

describe("status vocabulary", () => {
  it("classifies exactly the restricted statuses as restricted", () => {
    expect(isRestricted("trusted")).toBe(false);
    expect(isRestricted("uninitialized")).toBe(false);
    expect(isRestricted("restricted_rtc_failure")).toBe(true);
    expect(isRestricted("restricted_clock_rollback")).toBe(true);
    expect(isRestricted("restricted_forward_jump")).toBe(true);
    expect(isRestricted("restricted_no_trusted_source")).toBe(true);
  });
});

describe("first-boot challenge binding", () => {
  const verifyWith = async (
    tokenOver: Partial<SignedTimeToken>,
    chal: ActivationChallenge | null,
  ) =>
    new DefaultSignedTimeTokenVerifier(
      SIGNERS,
      new PreimageSignatures(),
      new MemoryReplay(),
      new MemoryChallenges(chal),
    ).verify({
      token: token(tokenOver),
      deviceRecordId: DEVICE,
      environment: "development",
      persistedFloor: null,
      policy: devPolicy(),
      comparisonTime: null,
      challenge: chal,
    });

  it("refuses a token with no outstanding challenge", async () => {
    // This is the case signature-plus-lifetime alone could not catch: a
    // correctly signed token from an earlier boot, on a device that cannot
    // judge expiry.
    const v = await verifyWith({}, null);
    expect(v.rejectionCode).toBe("TOKEN_NO_CHALLENGE");
  });

  it("refuses a token answering a different challenge", async () => {
    const v = await verifyWith({ challengeId: "chal-other" }, challenge());
    expect(v.rejectionCode).toBe("TOKEN_CHALLENGE_UNKNOWN");
  });

  it("refuses an already-answered challenge", async () => {
    const v = await verifyWith({}, challenge({ consumed: true }));
    expect(v.rejectionCode).toBe("TOKEN_CHALLENGE_CONSUMED");
  });

  it("refuses a stale assignment generation or activation attempt", async () => {
    expect((await verifyWith({ assignmentGeneration: 2 }, challenge())).rejectionCode).toBe(
      "TOKEN_CHALLENGE_MISMATCH",
    );
    expect((await verifyWith({ activationAttemptId: "boot-6" }, challenge())).rejectionCode).toBe(
      "TOKEN_CHALLENGE_MISMATCH",
    );
  });

  it("accepts a token that answers the outstanding challenge", async () => {
    const v = await verifyWith({}, challenge());
    expect(v.valid).toBe(true);
  });

  it("consumes the nonce and challenge only AFTER the floor commits", async () => {
    const replay = new MemoryReplay();
    const challenges = new MemoryChallenges();
    const store = new MemoryStore();
    const tokens = new DefaultSignedTimeTokenVerifier(
      SIGNERS,
      new PreimageSignatures(),
      replay,
      challenges,
    );
    const result = await evaluateTrustedTime(deps({ tokens, store }), {
      deviceRecordId: DEVICE,
      environment: "development",
      token: token(),
      challenge: challenge(),
    });
    expect(result.status).toBe("trusted");
    expect(challenges.consumedIds).toEqual([CHALLENGE_ID]);
    expect(await replay.hasSeen(DEVICE, "tok-1", "nonce-1")).toBe(true);
  });

  it("does NOT consume when the commit never happens", async () => {
    // A challenge burned before the commit would strand the device: it could
    // neither re-present the token nor answer the challenge again.
    const replay = new MemoryReplay();
    const challenges = new MemoryChallenges();
    const tokens = new DefaultSignedTimeTokenVerifier(
      SIGNERS,
      new PreimageSignatures(),
      replay,
      challenges,
    );
    const failing: TrustedTimeStore = {
      load: async () => null,
      commitEvaluation: async () => {
        throw new Error("store unavailable");
      },
    };
    await expect(
      evaluateTrustedTime(deps({ tokens, store: failing }), {
        deviceRecordId: DEVICE,
        environment: "development",
        token: token(),
        challenge: challenge(),
      }),
    ).rejects.toThrow("store unavailable");
    expect(challenges.consumedIds).toEqual([]);
    expect(await replay.hasSeen(DEVICE, "tok-1", "nonce-1")).toBe(false);
  });
});
