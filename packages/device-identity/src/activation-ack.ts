/**
 * Terminal provisioning activation acknowledgment — WS-11-T004-P03A.
 *
 * Authority: pairing protocol §7 ("mark terminal active" is a LATER step than
 * receiving the credential); migration group 0174; the OPTION B ruling of
 * group 0127 (Ed25519 verification lives in this package, the database
 * records the attestation).
 *
 * ===========================================================================
 * WHY A SEPARATE DOMAIN FROM kitluy.provisioning-pop.v1
 * ===========================================================================
 * The provisioning proof answers "does this terminal hold its enrolled key?".
 * This answers a strictly later question: "did this terminal actually receive
 * and install THIS credential?". Reusing the provisioning domain would let a
 * proof captured before the credential existed activate a terminal that never
 * received it — so the domain separator differs, the purpose differs, and the
 * payload binds the CREDENTIAL (id, serial, public fingerprint) that a
 * provisioning proof cannot mention.
 *
 * Every field kills one specific replay:
 *
 *   activationChallengeId  — a verbatim replay of another activation
 *   activationId           — an acknowledgment moved to another activation
 *   tenant/store/location  — transplanted across scope
 *   environment            — a development ack presented as pilot/production
 *   storeHubDeviceId       — an ack bound to a different Hub
 *   terminalDeviceId       — an ack from another terminal
 *   terminalAssignmentId   — an ack replayed across a reassignment
 *   terminalProfileKey     — an ack for a different T1-T4 role
 *   provisioningCodeId     — an ack for a different provisioning result
 *   popChallengeId         — an ack decoupled from the proof that redeemed it
 *   terminalKeyFingerprint — an ack transplanted onto another enrolled key
 *   certificateId/serial/fingerprint — an ack for a credential the terminal
 *                            never received (the whole point of this proof)
 *   nonce                  — a verbatim replay of this same challenge
 *   issuedAt / expiresAt   — an indefinitely old acknowledgment
 *
 * The RAW PROVISIONING CODE and its digest appear NOWHERE. Expiry is judged
 * against TRUSTED TIME; no host clock appears here.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from every other proof domain in the repository. */
export const ACTIVATION_ACK_KIND = "kitluy.activation-ack.v1" as const;

/** The one purpose this acknowledgment may serve. */
export const ACTIVATION_ACK_PURPOSE = "terminal_provisioning_activation_acknowledgment" as const;

export interface ActivationAckChallenge {
  readonly activationChallengeId: string;
  readonly purpose: string;
  readonly activationId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly storeHubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  /** The provisioning-code ROW id — never the raw code, never its digest. */
  readonly provisioningCodeId: string;
  readonly popChallengeId: string;
  readonly terminalKeyFingerprint: string;
  /** The credential the terminal is acknowledging it received. */
  readonly certificateId: string;
  readonly certificateSerial: string;
  readonly certificateFingerprint: string;
  readonly nonce: string;
  /** Authoritative database time. Never a host clock. */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * The exact bytes the terminal's enrolled private key signs.
 *
 * Field order is FIXED here rather than taken from object key order, so a
 * re-serialized challenge cannot verify differently from the original — the
 * same discipline as `tbsBytes` and `provisioningChallengeBytes`.
 */
export function activationAckBytes(challenge: ActivationAckChallenge): Uint8Array {
  return Buffer.from(
    [
      ACTIVATION_ACK_KIND,
      challenge.activationChallengeId,
      challenge.purpose,
      challenge.activationId,
      challenge.tenantId,
      challenge.digitalStoreId,
      challenge.storeLocationId,
      challenge.environment,
      challenge.storeHubDeviceId,
      challenge.terminalDeviceId,
      challenge.terminalAssignmentId,
      challenge.terminalProfileKey,
      challenge.provisioningCodeId,
      challenge.popChallengeId,
      challenge.terminalKeyFingerprint,
      challenge.certificateId,
      challenge.certificateSerial,
      challenge.certificateFingerprint,
      challenge.nonce,
      challenge.issuedAt.toISOString(),
      challenge.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}

export function activationAckHash(challenge: ActivationAckChallenge): string {
  return createHash("sha256")
    .update(Buffer.from(activationAckBytes(challenge)))
    .digest("hex");
}

export type ActivationAckRefusalCode =
  | "ACK_NO_TRUSTED_TIME"
  | "ACK_RESTRICTED_TRUST_MODE"
  | "ACK_EXPIRED"
  | "ACK_NOT_YET_VALID"
  | "ACK_WRONG_CHALLENGE"
  | "ACK_WRONG_PURPOSE"
  | "ACK_WRONG_ACTIVATION"
  | "ACK_WRONG_SCOPE"
  | "ACK_WRONG_ENVIRONMENT"
  | "ACK_WRONG_HUB"
  | "ACK_WRONG_TERMINAL"
  | "ACK_WRONG_ASSIGNMENT"
  | "ACK_WRONG_PROFILE"
  | "ACK_WRONG_PROVISIONING_RESULT"
  | "ACK_WRONG_CREDENTIAL"
  | "ACK_ENROLLMENT_NOT_ELIGIBLE"
  | "ACK_FINGERPRINT_MISMATCH"
  | "ACK_SIGNATURE_INVALID";

/** What the DATABASE rows say this acknowledgment must be about. */
export interface ActivationAckExpectation {
  readonly activationChallengeId: string;
  readonly purpose: string;
  readonly activationId: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly storeHubDeviceId: string;
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly terminalProfileKey: string;
  readonly provisioningCodeId: string;
  readonly popChallengeId: string;
  readonly certificateId: string;
  readonly certificateSerial: string;
  readonly certificateFingerprint: string;
  /** Fingerprint from the CURRENT manufacturing enrollment. */
  readonly enrolledKeyFingerprint: string;
  /** Only a `sealed` enrollment may acknowledge. */
  readonly enrollmentState: string;
}

export interface ActivationAckVerdict {
  readonly verified: boolean;
  readonly refusalCode?: ActivationAckRefusalCode;
  readonly detail?: string;
  readonly challengeHash?: string;
}

/**
 * Verifies a terminal activation acknowledgment.
 *
 * Bindings first, signature last — a mis-bound acknowledgment is refused with
 * a specific code rather than an opaque signature failure, and every binding
 * is checked against the DATABASE's expectation rather than the challenge's
 * own claims.
 *
 * A `verified: true` verdict is attestation input for the governed
 * `complete_terminal_provisioning_activation_v1` door, which re-locks and
 * re-derives every relational fact before activating anything.
 */
export function verifyActivationAck(
  challenge: ActivationAckChallenge,
  signature: Uint8Array,
  terminalPublicKeyPem: string,
  expectation: ActivationAckExpectation,
  trustedTime: TrustedTimeEvaluation,
  computeFingerprint: (pem: string) => string,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): ActivationAckVerdict {
  const refuse = (refusalCode: ActivationAckRefusalCode, detail: string): ActivationAckVerdict => ({
    verified: false,
    refusalCode,
    detail,
  });

  if (isRestricted(trustedTime.status)) {
    return refuse(
      "ACK_RESTRICTED_TRUST_MODE",
      `an acknowledgment cannot be judged in restricted trust mode (${trustedTime.status})`,
    );
  }
  if (trustedTime.status !== "trusted" || trustedTime.trustedTime === null) {
    return refuse("ACK_NO_TRUSTED_TIME", "no trusted time is established");
  }
  const now = trustedTime.trustedTime;

  if (challenge.activationChallengeId !== expectation.activationChallengeId) {
    return refuse("ACK_WRONG_CHALLENGE", "the acknowledgment belongs to another challenge");
  }
  if (
    challenge.purpose !== ACTIVATION_ACK_PURPOSE ||
    expectation.purpose !== ACTIVATION_ACK_PURPOSE
  ) {
    return refuse("ACK_WRONG_PURPOSE", `the acknowledgment is for purpose ${challenge.purpose}`);
  }
  if (challenge.activationId !== expectation.activationId) {
    return refuse("ACK_WRONG_ACTIVATION", "the acknowledgment belongs to another activation");
  }
  if (
    challenge.tenantId !== expectation.tenantId ||
    challenge.digitalStoreId !== expectation.digitalStoreId ||
    challenge.storeLocationId !== expectation.storeLocationId
  ) {
    return refuse(
      "ACK_WRONG_SCOPE",
      "the acknowledgment belongs to another Tenant, Store or Location",
    );
  }
  if (challenge.environment !== expectation.environment) {
    return refuse("ACK_WRONG_ENVIRONMENT", `the acknowledgment is for ${challenge.environment}`);
  }
  if (challenge.storeHubDeviceId !== expectation.storeHubDeviceId) {
    return refuse("ACK_WRONG_HUB", "the acknowledgment is bound to a different Store Hub");
  }
  if (challenge.terminalDeviceId !== expectation.terminalDeviceId) {
    return refuse("ACK_WRONG_TERMINAL", "the acknowledgment belongs to another terminal");
  }
  if (challenge.terminalAssignmentId !== expectation.terminalAssignmentId) {
    return refuse("ACK_WRONG_ASSIGNMENT", "the acknowledgment was raised across a reassignment");
  }
  if (challenge.terminalProfileKey !== expectation.terminalProfileKey) {
    return refuse("ACK_WRONG_PROFILE", "the acknowledgment targets a different terminal profile");
  }
  if (
    challenge.provisioningCodeId !== expectation.provisioningCodeId ||
    challenge.popChallengeId !== expectation.popChallengeId
  ) {
    return refuse(
      "ACK_WRONG_PROVISIONING_RESULT",
      "the acknowledgment names a different provisioning result",
    );
  }
  // The credential binding — the fact this proof exists to establish.
  if (
    challenge.certificateId !== expectation.certificateId ||
    challenge.certificateSerial !== expectation.certificateSerial ||
    challenge.certificateFingerprint !== expectation.certificateFingerprint
  ) {
    return refuse("ACK_WRONG_CREDENTIAL", "the acknowledgment names a different credential");
  }

  if (now.getTime() < challenge.issuedAt.getTime()) {
    return refuse("ACK_NOT_YET_VALID", "the challenge is dated in the future against trusted time");
  }
  if (now.getTime() >= challenge.expiresAt.getTime()) {
    return refuse("ACK_EXPIRED", "the activation challenge expired against trusted time");
  }

  if (expectation.enrollmentState !== "sealed") {
    return refuse(
      "ACK_ENROLLMENT_NOT_ELIGIBLE",
      `the terminal enrollment is ${expectation.enrollmentState}; only a sealed enrollment may acknowledge`,
    );
  }
  const actualFingerprint = computeFingerprint(terminalPublicKeyPem);
  if (
    actualFingerprint !== expectation.enrolledKeyFingerprint ||
    challenge.terminalKeyFingerprint !== expectation.enrolledKeyFingerprint
  ) {
    return refuse(
      "ACK_FINGERPRINT_MISMATCH",
      "the presented key is not the terminal's enrolled key",
    );
  }

  if (!verifySignature(terminalPublicKeyPem, activationAckBytes(challenge), signature)) {
    return refuse(
      "ACK_SIGNATURE_INVALID",
      "the acknowledgment signature does not verify under the enrolled public key",
    );
  }

  return { verified: true, challengeHash: activationAckHash(challenge) };
}
