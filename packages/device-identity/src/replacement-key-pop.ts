/**
 * Replacement-key proof of possession — WS-11-T003 Step 4, closure item 2.
 *
 * Authority: KLD-2026-07-28-002 §5.1; the owner's renewal instruction of
 * 2026-07-28.
 *
 * ===========================================================================
 * WHY THE CHALLENGE BINDS TWELVE FIELDS AND NOT ONE
 * ===========================================================================
 * A signature over a bare nonce proves only that SOMEONE holds SOME private
 * key. It does not say which device, which generation, or which renewal — so
 * the same proof would be replayable across all three. Every field below exists
 * to kill one specific replay:
 *
 *   renewalAttemptId      — a PoP from ANOTHER renewal of the same device
 *   deviceRecordId        — a PoP from another device
 *   currentCredentialId   — a PoP raised against a different incumbent
 *   currentGeneration     — a PoP replayed after the head moved
 *   nextGeneration        — a PoP for a different target generation
 *   replacementFingerprint— a PoP transplanted onto another key
 *   assignmentGeneration  — a PoP replayed across a reassignment
 *   nonce                 — a verbatim replay of this same challenge
 *   issuedAt / expiresAt  — an indefinitely old proof
 *   environment / purpose — a development proof presented as pilot/production
 *
 * A PoP from INITIAL ENROLLMENT cannot satisfy this at all: enrollment signs
 * `kitluy.csr.v1` and this signs `kitluy.renewal-pop.v1`, so the domain
 * separator alone refuses it before any field is compared.
 *
 * Expiry is judged against TRUSTED TIME. No host clock appears here.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from `kitluy.csr.v1` so the two never collide. */
export const REPLACEMENT_POP_KIND = "kitluy.renewal-pop.v1" as const;

export interface ReplacementKeyChallenge {
  readonly renewalAttemptId: string;
  readonly deviceRecordId: string;
  readonly currentCredentialId: string;
  readonly currentGeneration: number;
  readonly nextGeneration: number;
  readonly replacementPublicKeyFingerprint: string;
  readonly assignmentGeneration: number;
  readonly nonce: string;
  /** Trusted time at issue. Never a host clock. */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
}

/**
 * The exact bytes the NEW private key signs.
 *
 * Field order is fixed here rather than taken from object key order, so a
 * re-serialized challenge cannot verify differently from the original — the
 * same discipline as `tbsBytes`.
 */
export function replacementChallengeBytes(challenge: ReplacementKeyChallenge): Uint8Array {
  return Buffer.from(
    [
      REPLACEMENT_POP_KIND,
      challenge.renewalAttemptId,
      challenge.deviceRecordId,
      challenge.currentCredentialId,
      String(challenge.currentGeneration),
      String(challenge.nextGeneration),
      challenge.replacementPublicKeyFingerprint,
      String(challenge.assignmentGeneration),
      challenge.nonce,
      challenge.issuedAt.toISOString(),
      challenge.expiresAt.toISOString(),
      challenge.environment,
      challenge.purpose,
    ].join("\n"),
    "utf8",
  );
}

export function replacementChallengeHash(challenge: ReplacementKeyChallenge): string {
  return createHash("sha256")
    .update(Buffer.from(replacementChallengeBytes(challenge)))
    .digest("hex");
}

export type ReplacementPopRefusalCode =
  | "POP_NO_TRUSTED_TIME"
  | "POP_RESTRICTED_TRUST_MODE"
  | "POP_EXPIRED"
  | "POP_NOT_YET_VALID"
  | "POP_WRONG_RENEWAL_ATTEMPT"
  | "POP_WRONG_DEVICE"
  | "POP_WRONG_CURRENT_CREDENTIAL"
  | "POP_WRONG_CURRENT_GENERATION"
  | "POP_WRONG_NEXT_GENERATION"
  | "POP_WRONG_ASSIGNMENT_GENERATION"
  | "POP_WRONG_ENVIRONMENT"
  | "POP_WRONG_PURPOSE"
  | "POP_FINGERPRINT_MISMATCH"
  | "POP_KEY_NOT_GENERATED"
  | "POP_SIGNATURE_INVALID";

/** What the RESERVATION says this proof must be about. Not caller-supplied. */
export interface ReplacementPopExpectation {
  readonly renewalAttemptId: string;
  readonly deviceRecordId: string;
  readonly currentCredentialId: string;
  readonly currentGeneration: number;
  readonly nextGeneration: number;
  readonly assignmentGeneration: number;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  /** Fingerprint the PROVIDER generated. Never taken from the request. */
  readonly providerKeyFingerprint: string;
  /** Provider key state. Only `generated` may prove possession. */
  readonly providerKeyState: string;
}

export interface ReplacementPopVerdict {
  readonly verified: boolean;
  readonly refusalCode?: ReplacementPopRefusalCode;
  readonly detail?: string;
  readonly challengeHash?: string;
}

/**
 * Verifies a replacement-key proof of possession.
 *
 * Every binding is checked against the RESERVATION's expectation, not against
 * the challenge's own claims — a challenge that asserts its own correctness
 * proves nothing. The signature is checked LAST, so a mis-bound proof is
 * refused with a specific code rather than a generic signature failure.
 */
export function verifyReplacementKeyPop(
  challenge: ReplacementKeyChallenge,
  signature: Uint8Array,
  replacementPublicKeyPem: string,
  expectation: ReplacementPopExpectation,
  trustedTime: TrustedTimeEvaluation,
  computeFingerprint: (pem: string) => string,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): ReplacementPopVerdict {
  const refuse = (
    refusalCode: ReplacementPopRefusalCode,
    detail: string,
  ): ReplacementPopVerdict => ({ verified: false, refusalCode, detail });

  if (isRestricted(trustedTime.status)) {
    return refuse(
      "POP_RESTRICTED_TRUST_MODE",
      `proof of possession cannot be judged in restricted trust mode (${trustedTime.status})`,
    );
  }
  if (trustedTime.status !== "trusted" || trustedTime.trustedTime === null) {
    return refuse("POP_NO_TRUSTED_TIME", "no trusted time is established");
  }
  const now = trustedTime.trustedTime;

  // Bindings first, signature last. A proof for another renewal must fail with
  // POP_WRONG_RENEWAL_ATTEMPT — not with an opaque signature error that leaves
  // an operator unable to tell a replay from a broken key.
  if (challenge.renewalAttemptId !== expectation.renewalAttemptId) {
    return refuse("POP_WRONG_RENEWAL_ATTEMPT", "the proof belongs to another renewal attempt");
  }
  if (challenge.deviceRecordId !== expectation.deviceRecordId) {
    return refuse("POP_WRONG_DEVICE", "the proof belongs to another device");
  }
  if (challenge.currentCredentialId !== expectation.currentCredentialId) {
    return refuse(
      "POP_WRONG_CURRENT_CREDENTIAL",
      "the proof was raised against a different incumbent credential",
    );
  }
  if (challenge.currentGeneration !== expectation.currentGeneration) {
    return refuse("POP_WRONG_CURRENT_GENERATION", "the head moved since this proof was raised");
  }
  if (challenge.nextGeneration !== expectation.nextGeneration) {
    return refuse("POP_WRONG_NEXT_GENERATION", "the proof targets a different generation");
  }
  if (challenge.assignmentGeneration !== expectation.assignmentGeneration) {
    return refuse(
      "POP_WRONG_ASSIGNMENT_GENERATION",
      "the device was reassigned since this proof was raised",
    );
  }
  if (challenge.environment !== expectation.environment) {
    return refuse("POP_WRONG_ENVIRONMENT", `the proof is for ${challenge.environment}`);
  }
  if (challenge.purpose !== expectation.purpose) {
    return refuse("POP_WRONG_PURPOSE", `the proof is for purpose ${challenge.purpose}`);
  }

  if (now.getTime() < challenge.issuedAt.getTime()) {
    return refuse("POP_NOT_YET_VALID", "the challenge is dated in the future against trusted time");
  }
  if (now.getTime() > challenge.expiresAt.getTime()) {
    return refuse("POP_EXPIRED", "the challenge expired against trusted time");
  }

  // The key must be one the PROVIDER generated for this generation, and it must
  // still be `generated`. An abandoned loser key is refused here, before any
  // signature is checked — it could hold a perfectly valid private half.
  if (expectation.providerKeyState !== "generated") {
    return refuse(
      "POP_KEY_NOT_GENERATED",
      `the replacement key is ${expectation.providerKeyState}; only a generated key may prove possession`,
    );
  }
  const actualFingerprint = computeFingerprint(replacementPublicKeyPem);
  if (
    actualFingerprint !== expectation.providerKeyFingerprint ||
    challenge.replacementPublicKeyFingerprint !== expectation.providerKeyFingerprint
  ) {
    return refuse(
      "POP_FINGERPRINT_MISMATCH",
      "the presented key is not the one the provider generated for this generation",
    );
  }

  if (!verifySignature(replacementPublicKeyPem, replacementChallengeBytes(challenge), signature)) {
    return refuse(
      "POP_SIGNATURE_INVALID",
      "the challenge signature does not verify under the replacement public key",
    );
  }

  return { verified: true, challengeHash: replacementChallengeHash(challenge) };
}
