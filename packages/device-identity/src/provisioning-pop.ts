/**
 * Terminal provisioning proof of possession — WS-11-T004-P02B3A.
 *
 * Authority: pairing protocol §7 ("terminal creates/proves non-exportable
 * key" — the CLOUD-side proof before any redemption), the P01 capability
 * audit threat row 14 ("redeem requires PoP against the ENROLLED
 * fingerprint"), and the OPTION B ruling of group 0127: PostgreSQL cannot
 * verify Ed25519, so THIS package is the signature authority and the
 * database enforces every relational binding plus the service's attestation.
 *
 * SCOPE: verification only. A verified provisioning proof is a PREREQUISITE
 * for redemption, never an authorization — P02B3B must re-lock and recheck
 * the provisioning code, assignment, Hub and enrollment before consuming the
 * proof atomically with the REDEEMED transition. Nothing here touches
 * provisioning-code state, issues credentials or activates terminals.
 *
 * ===========================================================================
 * WHY THE CHALLENGE BINDS FIFTEEN FIELDS AND NOT ONE
 * ===========================================================================
 * The discipline of `kitluy.renewal-pop.v1` (replacement-key-pop.ts), applied
 * to provisioning. A signature over a bare nonce proves only that SOMEONE
 * holds SOME key. Every field exists to kill one replay:
 *
 *   challengeId            — a verbatim replay of another challenge
 *   purpose                — a proof minted for any other use
 *   tenant/store/location  — a proof transplanted across scope
 *   environment            — a development proof presented elsewhere
 *   storeHubDeviceId       — a proof bound to a withdrawn or different Hub
 *   terminalDeviceId       — a proof from another terminal
 *   terminalAssignmentId   — a proof across a reassignment
 *   terminalProfileKey     — a proof for a different T1–T4 role
 *   provisioningCodeId     — a proof raised against a different code row
 *   terminalKeyFingerprint — a proof transplanted onto another enrolled key
 *   nonce                  — a verbatim replay of this same challenge
 *   issuedAt / expiresAt   — an indefinitely old proof
 *
 * The RAW PROVISIONING CODE NEVER APPEARS in the signed payload, in the
 * challenge, or anywhere in this module — the code row ID is the binding.
 * An enrollment proof (`kitluy.csr.v1`) or renewal proof
 * (`kitluy.renewal-pop.v1`) cannot satisfy this: the domain separator alone
 * refuses them before any field is compared.
 *
 * Expiry is judged against TRUSTED TIME. No host clock appears here.
 *
 * ALGORITHM: the repository's existing crypto authority is reused unchanged —
 * Ed25519 via `verifyDetachedSignature`, SPKI-DER SHA-256 fingerprints via
 * `publicKeyFingerprint` (both dev-crypto.ts, recorded PROVISIONAL under
 * `[REQUIRED: device_certificate_signature_algorithm]`). No algorithm,
 * encoding or serialization is invented here.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from `kitluy.csr.v1` and `kitluy.renewal-pop.v1`. */
export const PROVISIONING_POP_KIND = "kitluy.provisioning-pop.v1" as const;

/** The one purpose this proof may serve. Distinct from every other proof use. */
export const PROVISIONING_POP_PURPOSE = "terminal_provisioning_redemption" as const;

export interface ProvisioningPopChallenge {
  readonly challengeId: string;
  readonly purpose: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly storeHubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  /** The provisioning-code ROW ID — never the raw code, never its digest. */
  readonly provisioningCodeId: string;
  /** The ENROLLED public-key fingerprint (manufacturing enrollment). */
  readonly terminalKeyFingerprint: string;
  readonly nonce: string;
  /** Authoritative database time at issue. Never a host clock. */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * The exact bytes the terminal's non-exportable private key signs.
 *
 * Field order is FIXED here rather than taken from object key order, so a
 * re-serialized challenge cannot verify differently from the original — the
 * same discipline as `tbsBytes` and `replacementChallengeBytes`.
 */
export function provisioningChallengeBytes(challenge: ProvisioningPopChallenge): Uint8Array {
  return Buffer.from(
    [
      PROVISIONING_POP_KIND,
      challenge.challengeId,
      challenge.purpose,
      challenge.tenantId,
      challenge.digitalStoreId,
      challenge.storeLocationId,
      challenge.environment,
      challenge.storeHubDeviceId,
      challenge.terminalDeviceId,
      challenge.terminalAssignmentId,
      challenge.terminalProfileKey,
      challenge.provisioningCodeId,
      challenge.terminalKeyFingerprint,
      challenge.nonce,
      challenge.issuedAt.toISOString(),
      challenge.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}

export function provisioningChallengeHash(challenge: ProvisioningPopChallenge): string {
  return createHash("sha256")
    .update(Buffer.from(provisioningChallengeBytes(challenge)))
    .digest("hex");
}

export type ProvisioningPopRefusalCode =
  | "POP_NO_TRUSTED_TIME"
  | "POP_RESTRICTED_TRUST_MODE"
  | "POP_EXPIRED"
  | "POP_NOT_YET_VALID"
  | "POP_WRONG_CHALLENGE"
  | "POP_WRONG_PURPOSE"
  | "POP_WRONG_TENANT"
  | "POP_WRONG_STORE"
  | "POP_WRONG_LOCATION"
  | "POP_WRONG_ENVIRONMENT"
  | "POP_WRONG_HUB"
  | "POP_WRONG_TERMINAL"
  | "POP_WRONG_ASSIGNMENT"
  | "POP_WRONG_PROFILE"
  | "POP_WRONG_CODE"
  | "POP_ENROLLMENT_NOT_ELIGIBLE"
  | "POP_FINGERPRINT_MISMATCH"
  | "POP_SIGNATURE_INVALID";

/**
 * What the DATABASE CHALLENGE ROW says this proof must be about. Built from
 * authoritative records by the caller — never from the terminal's request.
 */
export interface ProvisioningPopExpectation {
  readonly challengeId: string;
  readonly purpose: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly storeHubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  readonly provisioningCodeId: string;
  /** Fingerprint from the CURRENT manufacturing enrollment. Never the request. */
  readonly enrolledKeyFingerprint: string;
  /** Current enrollment state. Only `sealed` may prove possession. */
  readonly enrollmentState: string;
}

export interface ProvisioningPopVerdict {
  readonly verified: boolean;
  readonly refusalCode?: ProvisioningPopRefusalCode;
  readonly detail?: string;
  readonly challengeHash?: string;
}

/**
 * Verifies a terminal provisioning proof of possession.
 *
 * Every binding is checked against the DATABASE row's expectation, not the
 * challenge's own claims — a challenge that asserts its own correctness
 * proves nothing. The signature is checked LAST, so a mis-bound proof is
 * refused with a specific code rather than a generic signature failure.
 *
 * A `verified: true` verdict is attestation input for the governed
 * `record_terminal_provisioning_pop_verification_v1` door (migration 0170),
 * which re-derives every relational fact before recording anything. It is
 * NEVER redemption authority on its own.
 */
export function verifyProvisioningPop(
  challenge: ProvisioningPopChallenge,
  signature: Uint8Array,
  terminalPublicKeyPem: string,
  expectation: ProvisioningPopExpectation,
  trustedTime: TrustedTimeEvaluation,
  computeFingerprint: (pem: string) => string,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): ProvisioningPopVerdict {
  const refuse = (
    refusalCode: ProvisioningPopRefusalCode,
    detail: string,
  ): ProvisioningPopVerdict => ({ verified: false, refusalCode, detail });

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

  // Bindings first, signature last. A proof for another code must fail with
  // POP_WRONG_CODE — not an opaque signature error that leaves an operator
  // unable to tell a replay from a broken key.
  if (challenge.challengeId !== expectation.challengeId) {
    return refuse("POP_WRONG_CHALLENGE", "the proof belongs to another challenge");
  }
  if (
    challenge.purpose !== PROVISIONING_POP_PURPOSE ||
    expectation.purpose !== PROVISIONING_POP_PURPOSE
  ) {
    return refuse("POP_WRONG_PURPOSE", `the proof is for purpose ${challenge.purpose}`);
  }
  if (challenge.tenantId !== expectation.tenantId) {
    return refuse("POP_WRONG_TENANT", "the proof belongs to another Tenant");
  }
  if (challenge.digitalStoreId !== expectation.digitalStoreId) {
    return refuse("POP_WRONG_STORE", "the proof belongs to another Digital Store");
  }
  if (challenge.storeLocationId !== expectation.storeLocationId) {
    return refuse("POP_WRONG_LOCATION", "the proof belongs to another Location");
  }
  if (challenge.environment !== expectation.environment) {
    return refuse("POP_WRONG_ENVIRONMENT", `the proof is for ${challenge.environment}`);
  }
  if (challenge.storeHubDeviceId !== expectation.storeHubDeviceId) {
    return refuse("POP_WRONG_HUB", "the proof is bound to a different Store Hub");
  }
  if (challenge.terminalDeviceId !== expectation.terminalDeviceId) {
    return refuse("POP_WRONG_TERMINAL", "the proof belongs to another terminal");
  }
  if (challenge.terminalAssignmentId !== expectation.terminalAssignmentId) {
    return refuse("POP_WRONG_ASSIGNMENT", "the proof was raised across a reassignment");
  }
  if (challenge.terminalProfileKey !== expectation.terminalProfileKey) {
    return refuse("POP_WRONG_PROFILE", "the proof targets a different terminal profile");
  }
  if (challenge.provisioningCodeId !== expectation.provisioningCodeId) {
    return refuse("POP_WRONG_CODE", "the proof was raised against a different provisioning code");
  }

  if (now.getTime() < challenge.issuedAt.getTime()) {
    return refuse("POP_NOT_YET_VALID", "the challenge is dated in the future against trusted time");
  }
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    // The equality boundary expires — the same rule the canonical 0166
    // expiration applies to the provisioning code whose lifetime this
    // challenge inherits.
    return refuse("POP_EXPIRED", "the challenge expired against trusted time");
  }

  // The key must be the CURRENT sealed manufacturing enrollment's key. A
  // superseded or revoked enrollment holds a perfectly good private half —
  // state disqualifies it BEFORE any signature is checked.
  if (expectation.enrollmentState !== "sealed") {
    return refuse(
      "POP_ENROLLMENT_NOT_ELIGIBLE",
      `the terminal enrollment is ${expectation.enrollmentState}; only a sealed enrollment may prove possession`,
    );
  }
  const actualFingerprint = computeFingerprint(terminalPublicKeyPem);
  if (
    actualFingerprint !== expectation.enrolledKeyFingerprint ||
    challenge.terminalKeyFingerprint !== expectation.enrolledKeyFingerprint
  ) {
    return refuse(
      "POP_FINGERPRINT_MISMATCH",
      "the presented key is not the terminal's enrolled key",
    );
  }

  if (!verifySignature(terminalPublicKeyPem, provisioningChallengeBytes(challenge), signature)) {
    return refuse(
      "POP_SIGNATURE_INVALID",
      "the challenge signature does not verify under the enrolled public key",
    );
  }

  return { verified: true, challengeHash: provisioningChallengeHash(challenge) };
}
