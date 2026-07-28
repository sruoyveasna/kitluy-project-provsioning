/**
 * Trusted time — provider boundary, signed-token verification and the §12
 * evaluation, in TypeScript.
 *
 * Authority: KLD-2026-07-28-002 §12 and the owner's trusted-time instructions
 * (2026-07-28). Migration group 0123 is the authoritative persistence contract;
 * `trusted-time-conformance.test.ts` asserts this file and that migration still
 * agree, so the two cannot drift into agreeing with separate assumptions.
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO WALL CLOCK IN THIS FILE
 * ---------------------------------------------------------------------------
 * No system-clock call appears anywhere below, and a conformance test greps
 * this file to keep it that way. Every instant arrives from a provider that can
 * say whether it is trustworthy, because "what time is it" is precisely the
 * question an attacker answers for you. A module that quietly fell back to the
 * host clock would make certificate expiry advisory, which is the failure §12
 * exists to prevent.
 *
 * Token expiry is therefore checked against a TRUSTED COMPARISON SOURCE, not
 * against the machine's clock. When no comparison source exists — genuine first
 * boot — expiry is UNKNOWABLE and is not pretended otherwise. What remains
 * checkable without any clock is the token's internal consistency and its
 * declared lifetime against signed policy, which is exactly why those policy
 * values are `[REQUIRED]` rather than defaulted.
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { RequiredCryptographicValueError } from "./errors.js";

// ---------------------------------------------------------------------------
// Vocabulary — held equal with migration 0123 by the conformance test
// ---------------------------------------------------------------------------

export type TrustedTimeStatus =
  | "uninitialized"
  | "trusted"
  | "restricted_rtc_failure"
  | "restricted_clock_rollback"
  | "restricted_forward_jump"
  | "restricted_no_trusted_source";

export const TRUSTED_TIME_STATUSES: readonly TrustedTimeStatus[] = [
  "uninitialized",
  "trusted",
  "restricted_rtc_failure",
  "restricted_clock_rollback",
  "restricted_forward_jump",
  "restricted_no_trusted_source",
] as const;

export type TrustedTimeSource =
  "rtc" | "authenticated_network" | "signed_cloud_token" | "persisted_floor" | "none";

export const TRUSTED_TIME_SOURCES: readonly TrustedTimeSource[] = [
  "rtc",
  "authenticated_network",
  "signed_cloud_token",
  "persisted_floor",
  "none",
] as const;

/** Certificate windows, per environment (KLD-2026-07-28-002 §5). */
export interface CertificateWindowPolicy {
  readonly certificateLifetimeDays: number;
  readonly renewalWindowDays: number;
  readonly overlapWindowDays: number;
}

export const CERTIFICATE_WINDOWS: Readonly<Record<TrustEnvironment, CertificateWindowPolicy>> = {
  development: { certificateLifetimeDays: 30, renewalWindowDays: 10, overlapWindowDays: 3 },
  pilot: { certificateLifetimeDays: 180, renewalWindowDays: 60, overlapWindowDays: 14 },
  production: { certificateLifetimeDays: 365, renewalWindowDays: 90, overlapWindowDays: 14 },
};

/** Maximum signed-revocation-snapshot age before restricted mode (§6). */
export const MAX_REVOCATION_SNAPSHOT_AGE_HOURS: Readonly<Record<TrustEnvironment, number>> = {
  development: 30 * 24,
  pilot: 14 * 24,
  production: 14 * 24,
};

export function isRestricted(status: TrustedTimeStatus): boolean {
  return status.startsWith("restricted");
}

/** The purpose a trusted-time bootstrap token is bound to. */
export const TRUSTED_TIME_TOKEN_PURPOSE = "trusted_time_bootstrap" as const;

/**
 * The signing purpose authorized to sign bootstrap tokens. A token signed by
 * the release or configuration signer is a cross-purpose signature and is
 * rejected even if the signature itself verifies (§7).
 */
export const TRUSTED_TIME_TOKEN_SIGNER_PURPOSE: SigningPurpose = "device_identity";

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Signed trust policy. The three nullable fields are the values the owner
 * refused to let anyone invent; a null makes the affected check FAIL CLOSED
 * rather than fall back to a guess.
 */
export interface TrustedTimePolicy {
  readonly environment: TrustEnvironment;
  readonly policyVersion: number;
  /** Ruled by §12.3. Not a required value. */
  readonly maxClockLagSeconds: number;
  /** `[REQUIRED: trusted_time_max_forward_jump_seconds]` when null. */
  readonly maxForwardJumpSeconds: number | null;
  /** `[REQUIRED: trusted_time_token_max_lifetime_seconds]` when null. */
  readonly tokenMaxLifetimeSeconds: number | null;
  /** `[REQUIRED: trusted_time_token_allowed_skew_seconds]` when null. */
  readonly tokenAllowedSkewSeconds: number | null;
  readonly signatureVerified: boolean;
  readonly source: "signed_configuration" | "deterministic_test_policy";
  readonly productionEligible: boolean;
}

export interface TrustedTimePolicyProvider {
  getPolicy(environment: TrustEnvironment): Promise<TrustedTimePolicy>;
}

/**
 * Refuses a policy that cannot authorize the environment it claims.
 *
 * Development may use a `deterministic_test_policy`. Pilot and production may
 * not: the owner ruled their values must come from signed configuration, and no
 * code default may silently authorize them.
 */
export function assertPolicyUsable(policy: TrustedTimePolicy): void {
  const required: Array<[string, number | null]> = [
    ["trusted_time_max_forward_jump_seconds", policy.maxForwardJumpSeconds],
    ["trusted_time_token_max_lifetime_seconds", policy.tokenMaxLifetimeSeconds],
    ["trusted_time_token_allowed_skew_seconds", policy.tokenAllowedSkewSeconds],
  ];
  for (const [name, value] of required) {
    if (value === null) {
      throw new RequiredCryptographicValueError(name, policy.environment);
    }
  }

  if (policy.environment === "development") {
    if (policy.productionEligible) {
      throw new RequiredCryptographicValueError(
        "a development policy must be marked production_eligible = false",
        policy.environment,
      );
    }
    return;
  }

  if (policy.source !== "signed_configuration") {
    throw new RequiredCryptographicValueError(
      `signed configuration for environment ${policy.environment} — a ${policy.source} may not authorize it`,
      policy.environment,
    );
  }
  if (!policy.signatureVerified) {
    throw new RequiredCryptographicValueError(
      `a VERIFIED policy signature for environment ${policy.environment}`,
      policy.environment,
    );
  }
}

// ---------------------------------------------------------------------------
// Source providers
// ---------------------------------------------------------------------------

export interface RtcTimeReading {
  readonly available: boolean;
  /** Present only when the RTC could be read and is not faulted. */
  readonly time?: Date;
  /** Battery loss, oscillator fault, reset marker — anything §12.8 calls RTC failure. */
  readonly faulted: boolean;
  readonly detail?: string;
}

export interface RtcTimeProvider {
  read(): Promise<RtcTimeReading>;
}

export interface AuthenticatedTimeReading {
  readonly available: boolean;
  readonly time?: Date;
  /**
   * FALSE for plain NTP. An unauthenticated network time is not a trusted
   * source; it is an attacker-controlled number with a plausible shape.
   */
  readonly authenticated: boolean;
  readonly detail?: string;
}

export interface AuthenticatedNetworkTimeProvider {
  fetch(): Promise<AuthenticatedTimeReading>;
}

// ---------------------------------------------------------------------------
// Signed bootstrap token
// ---------------------------------------------------------------------------

/**
 * A device-specific, single-use activation challenge.
 *
 * WHY THIS EXISTS. A signature plus a declared lifetime does NOT establish
 * freshness: without a trusted comparison source, an old but correctly signed
 * token could bootstrap a wrong floor. Binding the token to a challenge the Hub
 * generated for THIS boot proves REQUEST freshness instead — an old token from
 * another boot or another activation attempt cannot be replayed, even though
 * conventional wall-clock freshness remains unprovable offline.
 */
export interface ActivationChallenge {
  readonly challengeId: string;
  readonly nonce: string;
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly assignmentGeneration: number;
  /** Boot counter or activation attempt id — whichever the Hub can advance. */
  readonly activationAttemptId: string;
  readonly consumed: boolean;
}

export interface ActivationChallengeStore {
  load(challengeId: string): Promise<ActivationChallenge | null>;
  /**
   * Marks the challenge and its nonce consumed. Called ONLY after the trusted
   * floor and its audit have committed — a challenge burned before the commit
   * would be lost if the commit failed, stranding the device.
   */
  markConsumed(challengeId: string): Promise<void>;
}

export interface SignedTimeToken {
  readonly tokenId: string;
  readonly schemaVersion: number;
  readonly purpose: string;
  readonly environment: string;
  readonly deviceRecordId: string;
  /** Binds the token to the challenge this Hub issued for this boot. */
  readonly challengeId: string;
  readonly assignmentGeneration: number;
  readonly activationAttemptId: string;
  readonly issuedAt: Date;
  readonly trustedTime: Date;
  readonly notBefore: Date;
  readonly expiresAt: Date;
  readonly nonce: string;
  readonly issuerKeyId: string;
  readonly signature: Uint8Array;
}

export type TokenRejectionCode =
  | "TOKEN_SCHEMA_UNSUPPORTED"
  | "TOKEN_WRONG_PURPOSE"
  | "TOKEN_WRONG_DEVICE"
  | "TOKEN_WRONG_ENVIRONMENT"
  | "TOKEN_UNKNOWN_SIGNER"
  | "TOKEN_CROSS_PURPOSE_SIGNER"
  | "TOKEN_SIGNER_REVOKED"
  | "TOKEN_SIGNATURE_INVALID"
  | "TOKEN_REPLAYED"
  | "TOKEN_WINDOW_MALFORMED"
  | "TOKEN_LIFETIME_EXCEEDS_POLICY"
  | "TOKEN_NOT_YET_VALID"
  | "TOKEN_EXPIRED"
  | "TOKEN_TIME_BELOW_FLOOR"
  | "TOKEN_NO_CHALLENGE"
  | "TOKEN_CHALLENGE_UNKNOWN"
  | "TOKEN_CHALLENGE_CONSUMED"
  | "TOKEN_CHALLENGE_MISMATCH";

export interface VerifiedTimeToken {
  readonly valid: boolean;
  readonly trustedTime?: Date;
  readonly rejectionCode?: TokenRejectionCode;
  readonly detail?: string;
}

export interface SignedTimeTokenInput {
  readonly token: SignedTimeToken;
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly persistedFloor: Date | null;
  readonly policy: TrustedTimePolicy;
  /**
   * The best INDEPENDENTLY trusted instant available, used to judge expiry.
   * NULL on genuine first boot, where expiry is unknowable and is not guessed.
   */
  readonly comparisonTime: Date | null;
  /** The outstanding local challenge, if the Hub issued one for this boot. */
  readonly challenge: ActivationChallenge | null;
}

export interface SignedTimeTokenVerifier {
  verify(input: SignedTimeTokenInput): Promise<VerifiedTimeToken>;
  /**
   * Records the token and its challenge as used. Deliberately SEPARATE from
   * verify: the owner requires the nonce to be marked consumed only after the
   * trusted-time floor and audit commit successfully.
   */
  consume(input: SignedTimeTokenInput): Promise<void>;
}

/** A registered bootstrap-token signing key. Public metadata only. */
export interface TokenSignerRegistration {
  readonly issuerKeyId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: SigningPurpose;
  readonly revoked: boolean;
}

/** Verifies raw signature bytes. Never sees or returns private key material. */
export interface TokenSignatureVerifier {
  verifySignature(
    issuerKeyId: string,
    preimage: Uint8Array,
    signature: Uint8Array,
  ): Promise<boolean>;
}

/** Replay defence. A bootstrap token is single-use per device. */
export interface TokenReplayStore {
  hasSeen(deviceRecordId: string, tokenId: string, nonce: string): Promise<boolean>;
  remember(deviceRecordId: string, tokenId: string, nonce: string): Promise<void>;
}

/**
 * Canonical bytes a bootstrap token is signed over. Every field that scopes the
 * token is inside the signature, so none of them can be swapped by whoever
 * relays it.
 */
export function timeTokenPreimage(token: SignedTimeToken): Uint8Array {
  return new TextEncoder().encode(
    [
      "kitluy.time-token.v1",
      String(token.schemaVersion),
      token.purpose,
      token.environment,
      token.deviceRecordId,
      token.challengeId,
      String(token.assignmentGeneration),
      token.activationAttemptId,
      token.issuedAt.toISOString(),
      token.trustedTime.toISOString(),
      token.notBefore.toISOString(),
      token.expiresAt.toISOString(),
      token.nonce,
      token.issuerKeyId,
    ].join("\n"),
  );
}

const SUPPORTED_TOKEN_SCHEMA = 1;

/**
 * The default verifier.
 *
 * Order matters and is deliberate: structural and scoping checks run BEFORE the
 * cryptographic one, so a token aimed at the wrong device or environment is
 * rejected without spending a verification, and the rejection reason is the
 * specific thing that was wrong rather than a generic signature failure.
 */
export class DefaultSignedTimeTokenVerifier implements SignedTimeTokenVerifier {
  constructor(
    private readonly signers: readonly TokenSignerRegistration[],
    private readonly signatures: TokenSignatureVerifier,
    private readonly replay: TokenReplayStore,
    private readonly challenges: ActivationChallengeStore,
  ) {}

  async consume(input: SignedTimeTokenInput): Promise<void> {
    await this.replay.remember(input.deviceRecordId, input.token.tokenId, input.token.nonce);
    if (input.challenge !== null) {
      await this.challenges.markConsumed(input.challenge.challengeId);
    }
  }

  async verify(input: SignedTimeTokenInput): Promise<VerifiedTimeToken> {
    const { token, policy } = input;

    // Policy must be usable before any of its numbers are trusted. Missing
    // token lifetime or skew fails closed, which is the point.
    assertPolicyUsable(policy);

    const reject = (rejectionCode: TokenRejectionCode, detail: string): VerifiedTimeToken => ({
      valid: false,
      rejectionCode,
      detail,
    });

    if (token.schemaVersion !== SUPPORTED_TOKEN_SCHEMA) {
      return reject("TOKEN_SCHEMA_UNSUPPORTED", `schema ${token.schemaVersion} is not supported`);
    }
    if (token.purpose !== TRUSTED_TIME_TOKEN_PURPOSE) {
      return reject("TOKEN_WRONG_PURPOSE", `token purpose is ${token.purpose}`);
    }
    if (token.deviceRecordId !== input.deviceRecordId) {
      return reject("TOKEN_WRONG_DEVICE", "token was issued for another device");
    }
    if (token.environment !== input.environment) {
      return reject(
        "TOKEN_WRONG_ENVIRONMENT",
        `token is for ${token.environment}, this device is ${input.environment}`,
      );
    }

    // REQUEST FRESHNESS. Without this, a correctly signed token from an earlier
    // boot would still verify on a device that cannot judge expiry.
    if (input.challenge === null) {
      return reject(
        "TOKEN_NO_CHALLENGE",
        "no outstanding activation challenge; a bootstrap token is accepted only in answer to one",
      );
    }
    if (input.challenge.challengeId !== token.challengeId) {
      return reject("TOKEN_CHALLENGE_UNKNOWN", "token answers a different challenge");
    }
    if (input.challenge.consumed) {
      return reject("TOKEN_CHALLENGE_CONSUMED", "this challenge was already answered");
    }
    if (
      input.challenge.nonce !== token.nonce ||
      input.challenge.deviceRecordId !== token.deviceRecordId ||
      input.challenge.environment !== token.environment ||
      input.challenge.assignmentGeneration !== token.assignmentGeneration ||
      input.challenge.activationAttemptId !== token.activationAttemptId
    ) {
      return reject(
        "TOKEN_CHALLENGE_MISMATCH",
        "token does not match the outstanding challenge on nonce, device, environment, assignment generation or activation attempt",
      );
    }

    const signer = this.signers.find((s) => s.issuerKeyId === token.issuerKeyId);
    if (signer === undefined) {
      return reject("TOKEN_UNKNOWN_SIGNER", `unknown issuer key ${token.issuerKeyId}`);
    }
    if (signer.revoked) {
      return reject("TOKEN_SIGNER_REVOKED", `issuer key ${token.issuerKeyId} is revoked`);
    }
    if (signer.environment !== input.environment) {
      return reject(
        "TOKEN_WRONG_ENVIRONMENT",
        `issuer key ${token.issuerKeyId} belongs to ${signer.environment}`,
      );
    }
    // §7: a key authorized for another purpose does not become authorized for
    // this one just because its signature is mathematically valid.
    if (signer.purpose !== TRUSTED_TIME_TOKEN_SIGNER_PURPOSE) {
      return reject(
        "TOKEN_CROSS_PURPOSE_SIGNER",
        `issuer key ${token.issuerKeyId} is authorized for ${signer.purpose}, not ${TRUSTED_TIME_TOKEN_SIGNER_PURPOSE}`,
      );
    }

    // Internal window consistency needs no clock at all.
    if (token.notBefore.getTime() >= token.expiresAt.getTime()) {
      return reject("TOKEN_WINDOW_MALFORMED", "not_before is not before expires_at");
    }
    if (token.issuedAt.getTime() > token.notBefore.getTime()) {
      return reject("TOKEN_WINDOW_MALFORMED", "issued_at is after not_before");
    }

    // The declared lifetime is checkable without a clock, which is why this
    // policy value earns its keep on a device that cannot tell the time.
    const lifetimeSeconds = (token.expiresAt.getTime() - token.issuedAt.getTime()) / 1000;
    if (lifetimeSeconds > (policy.tokenMaxLifetimeSeconds as number)) {
      return reject(
        "TOKEN_LIFETIME_EXCEEDS_POLICY",
        `declared lifetime ${lifetimeSeconds}s exceeds the signed maximum ${policy.tokenMaxLifetimeSeconds}s`,
      );
    }

    if (await this.replay.hasSeen(input.deviceRecordId, token.tokenId, token.nonce)) {
      return reject("TOKEN_REPLAYED", `token ${token.tokenId} was already used`);
    }

    const signatureValid = await this.signatures.verifySignature(
      token.issuerKeyId,
      timeTokenPreimage(token),
      token.signature,
    );
    if (!signatureValid) {
      return reject("TOKEN_SIGNATURE_INVALID", "signature does not verify over the token");
    }

    // A token can never lower the floor. §12.1 holds for every source.
    if (
      input.persistedFloor !== null &&
      token.trustedTime.getTime() < input.persistedFloor.getTime()
    ) {
      return reject(
        "TOKEN_TIME_BELOW_FLOOR",
        `token time ${token.trustedTime.toISOString()} is below the trusted floor ${input.persistedFloor.toISOString()}`,
      );
    }

    // Expiry is judged against an INDEPENDENTLY trusted instant. With none —
    // genuine first boot — expiry is unknowable, and pretending otherwise would
    // mean inventing the very clock this module refuses to invent. The token is
    // still bounded by its declared lifetime and its signature.
    const skewMs = (policy.tokenAllowedSkewSeconds as number) * 1000;
    if (input.comparisonTime !== null) {
      const now = input.comparisonTime.getTime();
      if (now + skewMs < token.notBefore.getTime()) {
        return reject("TOKEN_NOT_YET_VALID", "token is not yet valid");
      }
      if (now - skewMs > token.expiresAt.getTime()) {
        return reject("TOKEN_EXPIRED", "token has expired");
      }
    }

    // NOT consumed here. The caller consumes after the floor and audit commit.
    return { valid: true, trustedTime: token.trustedTime };
  }
}

// ---------------------------------------------------------------------------
// State store
// ---------------------------------------------------------------------------

export interface TrustedTimeState {
  readonly deviceRecordId: string;
  readonly floor: Date | null;
  readonly status: TrustedTimeStatus;
  readonly anomalyType: string | null;
  readonly lastSource: TrustedTimeSource;
  readonly lastSelectedTime: Date | null;
  readonly policyVersion: number | null;
}

export interface TrustedTimeCommit {
  readonly deviceRecordId: string;
  readonly previousFloor: Date | null;
  readonly nextFloor: Date | null;
  readonly floorAdvanced: boolean;
  readonly selectedTime: Date | null;
  readonly source: TrustedTimeSource;
  readonly status: TrustedTimeStatus;
  readonly anomalyType: string | null;
  readonly policyVersion: number;
  readonly correlationId: string | null;
}

export interface TrustedTimeStore {
  load(deviceId: string): Promise<TrustedTimeState | null>;
  /**
   * Writes the state change AND its audit record. §12.2 requires them to commit
   * atomically, so this is one call rather than two — a store that wrote them
   * separately could leave an advanced floor with no evidence of why.
   */
  commitEvaluation(input: TrustedTimeCommit): Promise<TrustedTimeState>;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface TrustedTimeEvaluation {
  readonly status: TrustedTimeStatus;
  readonly trustedTime: Date | null;
  readonly source: TrustedTimeSource;
  readonly floorAdvanced: boolean;
  readonly anomalyType: string | null;
  readonly restricted: boolean;
  readonly detail: string;
}

export interface TrustedTimeEvaluationInput {
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly correlationId?: string;
  /** Supplied only when the device is presenting a bootstrap token. */
  readonly token?: SignedTimeToken;
  /** The outstanding challenge this Hub issued for this boot. */
  readonly challenge?: ActivationChallenge;
}

export interface TrustedTimeDependencies {
  readonly rtc: RtcTimeProvider;
  readonly network: AuthenticatedNetworkTimeProvider;
  readonly tokens: SignedTimeTokenVerifier;
  readonly store: TrustedTimeStore;
  readonly policies: TrustedTimePolicyProvider;
}

/**
 * The §12 evaluation. Mirrors `kitluy_devices.evaluate_trusted_time_v1`, and
 * the conformance test holds the two together.
 *
 * Returns a typed evaluation for every ANOMALY so the anomaly and its audit
 * survive; throws only for missing or unusable policy, because there is then
 * nothing trustworthy to record against.
 */
export async function evaluateTrustedTime(
  deps: TrustedTimeDependencies,
  input: TrustedTimeEvaluationInput,
): Promise<TrustedTimeEvaluation> {
  const policy = await deps.policies.getPolicy(input.environment);
  assertPolicyUsable(policy);

  const state = await deps.store.load(input.deviceRecordId);
  const floor = state?.floor ?? null;
  const lagMs = policy.maxClockLagSeconds * 1000;
  const jumpMs = (policy.maxForwardJumpSeconds as number) * 1000;

  const rtc = await deps.rtc.read();
  const net = await deps.network.fetch();

  // Only VALIDATED sources are candidates. An unauthenticated network reading
  // and a faulted RTC are discarded here rather than weighed later — an
  // untrusted source must never reach the floor.
  const candidates: Array<{ source: TrustedTimeSource; time: Date }> = [];
  if (rtc.available && !rtc.faulted && rtc.time !== undefined) {
    candidates.push({ source: "rtc", time: rtc.time });
  }
  if (net.available && net.authenticated && net.time !== undefined) {
    candidates.push({ source: "authenticated_network", time: net.time });
  }

  // The best independently trusted instant, used to judge token expiry. The
  // token cannot vouch for its own freshness.
  const comparisonTime =
    candidates.length === 0 ? null : new Date(Math.max(...candidates.map((c) => c.time.getTime())));

  let tokenRejection: string | null = null;
  let acceptedTokenInput: SignedTimeTokenInput | null = null;
  if (input.token !== undefined) {
    const tokenInput: SignedTimeTokenInput = {
      token: input.token,
      deviceRecordId: input.deviceRecordId,
      environment: input.environment,
      persistedFloor: floor,
      policy,
      comparisonTime,
      challenge: input.challenge ?? null,
    };
    const verdict = await deps.tokens.verify(tokenInput);
    if (verdict.valid && verdict.trustedTime !== undefined) {
      candidates.push({ source: "signed_cloud_token", time: verdict.trustedTime });
      acceptedTokenInput = tokenInput;
    } else {
      tokenRejection = verdict.rejectionCode ?? "TOKEN_SIGNATURE_INVALID";
    }
  }

  // A source more than the ruled lag behind the floor is rollback, whatever
  // its provenance. Provenance does not buy leniency; only the value matters.
  const withinLag = candidates.filter(
    (c) => floor === null || c.time.getTime() >= floor.getTime() - lagMs,
  );

  let status: TrustedTimeStatus;
  let anomalyType: string | null = null;
  let selected: { source: TrustedTimeSource; time: Date } | null = null;

  if (withinLag.length === 0 && candidates.length > 0) {
    status = "restricted_clock_rollback";
    anomalyType = `every offered source is more than ${policy.maxClockLagSeconds} seconds behind the trusted floor`;
  } else if (withinLag.length === 0) {
    // Distinguish a FAULTED RTC from simply having nothing. §12.8 treats RTC
    // failure as its own restricted status, and an operator dispatched for the
    // wrong reason is an operator dispatched twice.
    status = rtc.faulted ? "restricted_rtc_failure" : "restricted_no_trusted_source";
    anomalyType = rtc.faulted
      ? `RTC failure: ${rtc.detail ?? "unspecified"}`
      : tokenRejection !== null
        ? `no trustworthy time source; token rejected: ${tokenRejection}`
        : "no trustworthy time source was available";
  } else {
    selected = withinLag.reduce((a, b) => (b.time.getTime() > a.time.getTime() ? b : a));
    if (floor !== null && selected.time.getTime() > floor.getTime() + jumpMs) {
      status = "restricted_forward_jump";
      anomalyType = `selected time is more than ${policy.maxForwardJumpSeconds} seconds ahead of the trusted floor`;
    } else {
      status = "trusted";
    }
  }

  const floorAdvanced =
    status === "trusted" &&
    selected !== null &&
    (floor === null || selected.time.getTime() > floor.getTime());

  const committed = await deps.store.commitEvaluation({
    deviceRecordId: input.deviceRecordId,
    previousFloor: floor,
    nextFloor: floorAdvanced && selected !== null ? selected.time : floor,
    floorAdvanced,
    selectedTime: selected?.time ?? null,
    source: selected?.source ?? "none",
    status,
    anomalyType,
    policyVersion: policy.policyVersion,
    correlationId: input.correlationId ?? null,
  });

  // The nonce and challenge are consumed ONLY after the floor and its audit
  // have committed. Burning them earlier would strand a device whose commit
  // failed: it would hold a token it can no longer present and a challenge it
  // can no longer answer.
  if (acceptedTokenInput !== null && selected?.source === "signed_cloud_token") {
    await deps.tokens.consume(acceptedTokenInput);
  }

  const reported =
    committed.floor !== null && selected !== null
      ? new Date(Math.max(committed.floor.getTime(), selected.time.getTime()))
      : (committed.floor ?? selected?.time ?? null);

  return {
    status,
    trustedTime: reported,
    source: selected?.source ?? (committed.floor !== null ? "persisted_floor" : "none"),
    floorAdvanced,
    anomalyType,
    restricted: isRestricted(status),
    detail: status === "trusted" ? "trusted time established" : (anomalyType ?? "restricted"),
  };
}

/**
 * §12.5 / §12.10 first boot. A persisted floor alone is NOT sufficient: a brand
 * new device has to hear the time from something that can vouch for it.
 */
export function canActivateOffline(evaluation: TrustedTimeEvaluation): {
  permitted: boolean;
  reason: string;
} {
  if (evaluation.restricted) {
    return { permitted: false, reason: evaluation.anomalyType ?? "restricted trust mode" };
  }
  if (evaluation.source === "persisted_floor" || evaluation.source === "none") {
    return {
      permitted: false,
      reason:
        "a persisted floor alone is not a trustworthy time source; a new device needs a valid RTC, authenticated network time or a valid signed time token",
    };
  }
  return { permitted: true, reason: "trusted time established from a validated source" };
}

// ---------------------------------------------------------------------------
// Emergency correction
// ---------------------------------------------------------------------------

export type TimeCorrectionRefusalCode =
  | "KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED"
  | "KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED"
  | "KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED"
  | "KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS"
  | "KLUY-DEVICE-TIME-ROLLBACK";

export interface TimeCorrectionRequest {
  readonly deviceRecordId: string;
  readonly proposedTrustedTime: Date;
  readonly evidenceSource: string;
  readonly reason: string;
  readonly approvalId: string;
  readonly approvalRiskClass: string;
  readonly actorRef: string;
  readonly approverRef: string;
  readonly correlationId: string | null;
}

export interface TimeCorrectionOutcome {
  readonly outcome: "APPLIED" | "REFUSED";
  readonly oldTrustedTime: Date | null;
  readonly newTrustedTime: Date | null;
  readonly refusalCode: TimeCorrectionRefusalCode | null;
  readonly refusalMessage: string | null;
}

/** §12.9 requires A3 or A4. Anything lower is not an emergency authority. */
const ACCEPTED_CORRECTION_RISK_CLASSES = new Set(["A3", "A4", "A4_OWNER_SECURITY"]);

/**
 * Validates an emergency correction. Returns a typed refusal rather than
 * throwing, so a refused correction leaves the same durable evidence an applied
 * one does — the C37 lesson.
 *
 * This function decides; the STORE performs the correction and its audit
 * atomically. Splitting them is what lets a store failure roll back both.
 */
export function validateTimeCorrection(
  request: TimeCorrectionRequest,
  currentFloor: Date | null,
): TimeCorrectionOutcome {
  const refuse = (
    refusalCode: TimeCorrectionRefusalCode,
    refusalMessage: string,
  ): TimeCorrectionOutcome => ({
    outcome: "REFUSED",
    oldTrustedTime: currentFloor,
    newTrustedTime: null,
    refusalCode,
    refusalMessage,
  });

  if (request.approvalId.trim() === "") {
    return refuse(
      "KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED",
      "emergency time correction requires an approval id",
    );
  }
  if (request.approverRef.trim() === "") {
    return refuse(
      "KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED",
      "emergency time correction requires a named approver",
    );
  }
  if (request.actorRef === request.approverRef) {
    return refuse(
      "KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED",
      `${request.actorRef} cannot approve their own time correction`,
    );
  }
  if (!ACCEPTED_CORRECTION_RISK_CLASSES.has(request.approvalRiskClass)) {
    return refuse(
      "KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS",
      `risk class ${request.approvalRiskClass} is below the A3/A4 required for a time correction`,
    );
  }
  if (request.evidenceSource.trim() === "" || request.reason.trim() === "") {
    return refuse(
      "KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED",
      "emergency time correction requires an evidence source and a reason",
    );
  }
  if (currentFloor !== null && request.proposedTrustedTime.getTime() < currentFloor.getTime()) {
    // Emergency authority does not buy rollback. Backwards is the attack.
    return refuse(
      "KLUY-DEVICE-TIME-ROLLBACK",
      `proposed ${request.proposedTrustedTime.toISOString()} is behind the trusted floor ${currentFloor.toISOString()}; trusted time never moves backwards`,
    );
  }

  return {
    outcome: "APPLIED",
    oldTrustedTime: currentFloor,
    newTrustedTime: request.proposedTrustedTime,
    refusalCode: null,
    refusalMessage: null,
  };
}
