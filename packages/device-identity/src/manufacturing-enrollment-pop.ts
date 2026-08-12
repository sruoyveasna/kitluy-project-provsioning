/**
 * Proof of possession for FACTORY enrollment.
 *
 * Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2).
 *
 * ===========================================================================
 * WHY THIS IS NOT `verifyProvisioningPop`
 * ===========================================================================
 * Reusing the terminal-provisioning proof was the first thing tried, and it
 * does not fit for two structural reasons — neither of them stylistic:
 *
 *  1. **Its bindings do not exist yet.** `ProvisioningPopChallenge` requires
 *     `tenantId`, `digitalStoreId`, `storeLocationId`, `storeHubDeviceId`,
 *     `terminalAssignmentId` and `terminalProfileKey`. At factory enrollment
 *     none of those exist — that is the entire point of KLSRC-0162 §35, which
 *     keeps fleet enrollment and Store pairing as separate credential scopes.
 *     Supplying placeholders would be signing over fiction.
 *
 *  2. **It requires trusted time.** `verifyProvisioningPop` refuses with
 *     `POP_NO_TRUSTED_TIME` unless a floor is established. A factory-fresh
 *     device has none — establishing the first floor is what enrollment
 *     RETURNS, via the signed time token. Requiring it here would recreate the
 *     chicken-and-egg the enrollment ordering was designed to avoid.
 *
 * So this is a separate PURPOSE with its own domain separator, defined ONCE
 * here and imported by both the cloud service and the device agent, so the two
 * cannot drift. Everything else is deliberately the same discipline as
 * `provisioning-pop.ts`: fixed field order, bindings checked BEFORE the
 * signature, refusals rather than exceptions, and the same
 * `verifyDetachedSignature` primitive.
 *
 * ===========================================================================
 * WHAT THIS PROOF ACTUALLY ESTABLISHES
 * ===========================================================================
 * That the caller holds the private half of the public key it is presenting —
 * nothing more. The key is NOT yet enrolled, so unlike the terminal proof
 * there is no database fingerprint to check it against; the check is that the
 * presented PEM hashes to the presented fingerprint and that the signature
 * verifies against that PEM over the server's nonce.
 *
 * Possession alone is not enrollment authority. The ticket is what authorizes;
 * this proves the key being enrolled is the caller's own, so a captured ticket
 * cannot be redeemed against somebody else's public key.
 */
import { createHash } from "node:crypto";

import { verifyDetachedSignature, publicKeyFingerprint } from "./dev-crypto.js";
import type { TrustEnvironment } from "./environments.js";

/** Domain separator. Distinct from `kitluy.provisioning-pop.v1`. */
export const MANUFACTURING_ENROLLMENT_POP_KIND = "kitluy.manufacturing-enrollment-pop.v1" as const;

/** The one purpose this proof may serve. */
export const MANUFACTURING_ENROLLMENT_POP_PURPOSE = "manufacturing_enrollment_redemption" as const;

export interface ManufacturingEnrollmentPopChallenge {
  readonly challengeId: string;
  readonly purpose: string;
  readonly environment: TrustEnvironment;
  /** SHA-256 of the SPKI DER of the key the device is claiming. */
  readonly presentedKeyFingerprint: string;
  /** Server-minted. Never client-supplied. */
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * The exact bytes the device's private key signs. Field order is FIXED here
 * rather than taken from object key order, so a re-serialized challenge cannot
 * verify differently from the original.
 */
export function manufacturingEnrollmentChallengeBytes(
  challenge: ManufacturingEnrollmentPopChallenge,
): Uint8Array {
  return Buffer.from(
    [
      MANUFACTURING_ENROLLMENT_POP_KIND,
      challenge.challengeId,
      challenge.purpose,
      challenge.environment,
      challenge.presentedKeyFingerprint,
      challenge.nonce,
      challenge.issuedAt.toISOString(),
      challenge.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}

export function manufacturingEnrollmentChallengeHash(
  challenge: ManufacturingEnrollmentPopChallenge,
): string {
  return createHash("sha256")
    .update(Buffer.from(manufacturingEnrollmentChallengeBytes(challenge)))
    .digest("hex");
}

export type ManufacturingEnrollmentPopRefusalCode =
  | "POP_WRONG_KIND"
  | "POP_WRONG_PURPOSE"
  | "POP_WRONG_CHALLENGE"
  | "POP_WRONG_ENVIRONMENT"
  | "POP_KEY_MISMATCH"
  | "POP_SEPARATOR_INJECTION"
  | "POP_EXPIRED"
  | "POP_NOT_YET_VALID"
  | "POP_SIGNATURE_INVALID";

/**
 * What the SERVER independently knows the proof must be about, read from the
 * challenge row it minted — never from the request body.
 */
export interface ManufacturingEnrollmentPopExpectation {
  readonly challengeId: string;
  readonly environment: TrustEnvironment;
  /** The fingerprint recorded on the challenge row at issue. */
  readonly presentedKeyFingerprint: string;
  readonly nonce: string;
  readonly expiresAt: Date;
}

export interface ManufacturingEnrollmentPopVerdict {
  readonly verified: boolean;
  readonly refusalCode?: ManufacturingEnrollmentPopRefusalCode;
  readonly detail?: string;
  readonly challengeHash?: string;
}

/** A value that would make the newline-joined encoding ambiguous. */
function hasSeparator(value: string): boolean {
  return typeof value !== "string" || value.includes("\n") || value.includes("\r");
}

/**
 * Verifies a factory-enrollment proof of possession.
 *
 * `now` is the SERVER's clock, which is legitimate here: this is the cloud
 * judging a request, not a device judging its own time. The device's clock is
 * never consulted.
 *
 * Bindings are checked before the signature so a mis-bound proof refuses with
 * a specific code rather than an opaque signature failure — an operator must
 * be able to tell a replay from a broken key.
 */
export function verifyManufacturingEnrollmentPop(
  challenge: ManufacturingEnrollmentPopChallenge,
  signature: Uint8Array,
  devicePublicKeyPem: string,
  expectation: ManufacturingEnrollmentPopExpectation,
  now: Date,
  computeFingerprint: (pem: string) => string = publicKeyFingerprint,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): ManufacturingEnrollmentPopVerdict {
  const refuse = (
    refusalCode: ManufacturingEnrollmentPopRefusalCode,
    detail: string,
  ): ManufacturingEnrollmentPopVerdict => ({ verified: false, refusalCode, detail });

  if (challenge.purpose !== MANUFACTURING_ENROLLMENT_POP_PURPOSE) {
    return refuse("POP_WRONG_PURPOSE", "the proof names a different purpose");
  }
  if (challenge.challengeId !== expectation.challengeId) {
    return refuse("POP_WRONG_CHALLENGE", "the proof names a different challenge");
  }
  if (challenge.environment !== expectation.environment) {
    return refuse("POP_WRONG_ENVIRONMENT", "the proof names a different environment");
  }
  if (challenge.nonce !== expectation.nonce) {
    return refuse("POP_WRONG_CHALLENGE", "the proof does not carry the issued nonce");
  }
  if (challenge.presentedKeyFingerprint !== expectation.presentedKeyFingerprint) {
    return refuse("POP_KEY_MISMATCH", "the proof names a key the challenge was not issued for");
  }

  // Before any cryptography: ambiguous bytes bind nothing.
  if (
    hasSeparator(challenge.challengeId) ||
    hasSeparator(challenge.purpose) ||
    hasSeparator(challenge.environment) ||
    hasSeparator(challenge.presentedKeyFingerprint) ||
    hasSeparator(challenge.nonce)
  ) {
    return refuse("POP_SEPARATOR_INJECTION", "a field contains a line separator");
  }

  if (now.getTime() > expectation.expiresAt.getTime()) {
    return refuse("POP_EXPIRED", "the challenge expired before the proof arrived");
  }
  if (now.getTime() < challenge.issuedAt.getTime()) {
    return refuse("POP_NOT_YET_VALID", "the challenge is not yet valid");
  }

  // The presented KEY must be the key the challenge names. Without this a
  // captured ticket could be redeemed against an attacker's key pair, and the
  // signature would verify perfectly — against the wrong key.
  let actualFingerprint: string;
  try {
    actualFingerprint = computeFingerprint(devicePublicKeyPem);
  } catch {
    return refuse("POP_KEY_MISMATCH", "the presented public key could not be parsed");
  }
  if (actualFingerprint.toLowerCase() !== expectation.presentedKeyFingerprint.toLowerCase()) {
    return refuse("POP_KEY_MISMATCH", "the presented key does not match its fingerprint");
  }

  let ok: boolean;
  try {
    ok = verifySignature(
      devicePublicKeyPem,
      manufacturingEnrollmentChallengeBytes(challenge),
      signature,
    );
  } catch {
    // A malformed PEM or signature. Refused, never thrown — a verifier that
    // threw could be turned into an outage by a malformed request.
    return refuse("POP_SIGNATURE_INVALID", "the proof could not be verified");
  }
  if (!ok) {
    return refuse("POP_SIGNATURE_INVALID", "the proof did not verify against the presented key");
  }

  return { verified: true, challengeHash: manufacturingEnrollmentChallengeHash(challenge) };
}
