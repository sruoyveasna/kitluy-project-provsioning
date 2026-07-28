/**
 * `certificate.validity` — governed consumer #1.
 *
 * Authority: KLD-2026-07-28-002 §5, §6, §7, §12.6.
 *
 * ===========================================================================
 * KITLUY DEVELOPMENT DEVICE CREDENTIAL
 * ===========================================================================
 * What this module validates is a **KitLuy development device credential**, not
 * an X.509 certificate. It is a canonical to-be-signed structure with a
 * detached Ed25519 signature.
 *
 * A passing result here is NOT evidence of pilot or production mTLS
 * compatibility and must never be cited as such. Real X.509 and mTLS are
 * pilot/production concerns that KLD-2026-07-28-002 §14 leaves BLOCKED.
 *
 * ===========================================================================
 * NO CALLER-SUPPLIED TRUST
 * ===========================================================================
 * There is no `signatureValid` input. The chain and every signature are
 * verified INSIDE this module by the real Ed25519 verifier. A caller can hand
 * this function a forged credential; it cannot hand it a verdict.
 *
 * Validity is decided against TRUSTED TIME. No host clock, no SQL `now()`.
 *
 * The separation the owner fixed:
 *   device trusted time  -> certificate, revocation and configuration validity
 *   server/database time -> human approval creation, expiry and consumption
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { CERTIFICATE_WINDOWS, isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import {
  verifyCertificateChain,
  type CertificateChain,
  type TbsCertificate,
} from "./dev-crypto.js";

/** Names the artifact so it cannot be mistaken for X.509 in a report. */
export const CREDENTIAL_KIND = "kitluy.development-device-credential.v1" as const;

/** A passing verdict is never evidence of mTLS compatibility. */
export const CREDENTIAL_IS_NOT_X509 = true as const;

export const DEVICE_CERTIFICATE_PURPOSE: SigningPurpose = "device_identity";

export type CertificateRejectionCode =
  | "CERT_NO_TRUSTED_TIME"
  | "CERT_RESTRICTED_TRUST_MODE"
  | "CERT_CHAIN_INVALID"
  | "CERT_WRONG_DEVICE"
  | "CERT_WRONG_ENVIRONMENT"
  | "CERT_WRONG_PURPOSE"
  | "CERT_KEY_FINGERPRINT_MISMATCH"
  | "CERT_WINDOW_MALFORMED"
  | "CERT_LIFETIME_EXCEEDS_POLICY"
  | "CERT_NOT_YET_VALID"
  | "CERT_EXPIRED"
  | "CERT_REVOKED"
  | "CERT_STALE_CERTIFICATE_GENERATION"
  | "CERT_PRODUCTION_ELIGIBILITY_CLAIMED";

/** Revocation facts the Hub holds locally. Supplied by consumer #3. */
export interface RevocationLookup {
  isCertificateRevoked(certificateSerial: string): boolean;
  isDeviceRevoked(deviceRecordId: string): boolean;
}

export interface CertificateVerificationContext {
  /** root -> intermediate -> device. Verified here, not asserted by the caller. */
  readonly chain: CertificateChain;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly deviceRecordId: string;
  /** Fingerprint of the key the device currently holds. */
  readonly currentKeyFingerprint: string;
  /** The device's current certificate generation. */
  readonly currentCertificateGeneration: number;
  readonly revocations: RevocationLookup;
  /** This verifier's trust anchors. A development root is absent in production. */
  readonly trustedRootFingerprints: readonly string[];
}

export interface CertificateValidity {
  readonly valid: boolean;
  readonly rejectionCode?: CertificateRejectionCode;
  readonly detail?: string;
  readonly evaluatedAt?: Date;
  readonly expiresAt?: Date;
  readonly credentialKind: typeof CREDENTIAL_KIND;
}

/**
 * Extracts the instant every validity decision is made against, or null.
 *
 * ONLY `trusted` yields an instant (review finding RV-TT-001). `uninitialized`
 * is not restricted but is not trusted either, and the gap between those two
 * was a fail-open.
 */
export function trustedInstant(evaluation: TrustedTimeEvaluation): Date | null {
  if (evaluation.status !== "trusted") return null;
  return evaluation.trustedTime;
}

/** Read-only projection of the signed credential, for callers that need fields. */
export interface CredentialView {
  readonly certificateSerial: string;
  readonly deviceRecordId: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly certificateGeneration: number;
  readonly publicKeyFingerprint: string;
}

export function credentialView(tbs: TbsCertificate): CredentialView {
  return {
    certificateSerial: tbs.serialNumber,
    deviceRecordId: tbs.deviceRecordId ?? "",
    notBefore: new Date(tbs.notBefore),
    notAfter: new Date(tbs.notAfter),
    certificateGeneration: tbs.certificateGeneration ?? 0,
    publicKeyFingerprint: tbs.subjectFingerprint,
  };
}

/**
 * Decides whether a KitLuy development device credential is valid RIGHT NOW,
 * where "now" is trusted time.
 *
 * Order is the owner's: trusted time -> parse -> chain -> signature -> purpose
 * -> environment -> device/key binding -> window -> revocation -> generation.
 * Chain verification covers signature, purpose and environment at EVERY hop, so
 * those hold before any field of the device credential is read.
 */
export function evaluateCertificateValidity(
  context: CertificateVerificationContext,
): CertificateValidity {
  const reject = (
    rejectionCode: CertificateRejectionCode,
    detail: string,
  ): CertificateValidity => ({
    valid: false,
    rejectionCode,
    detail,
    credentialKind: CREDENTIAL_KIND,
  });

  // 1. TRUSTED TIME. Without it there is no "now", and guessing one is the
  //    failure §12 exists to prevent.
  if (isRestricted(context.trustedTime.status)) {
    return reject(
      "CERT_RESTRICTED_TRUST_MODE",
      `device is in restricted trust mode (${context.trustedTime.status})`,
    );
  }
  const now = trustedInstant(context.trustedTime);
  if (now === null) {
    return reject("CERT_NO_TRUSTED_TIME", "no trusted time is established");
  }

  // 2. CHAIN + SIGNATURES + PURPOSE + ENVIRONMENT, verified here with real
  //    cryptography. Nothing below this line runs on an unverified credential.
  const chainVerdict = verifyCertificateChain(context.chain, {
    environment: context.environment,
    purpose: DEVICE_CERTIFICATE_PURPOSE,
    trustedRootFingerprints: context.trustedRootFingerprints,
  });
  if (!chainVerdict.valid) {
    return reject(
      "CERT_CHAIN_INVALID",
      `${chainVerdict.rejectionCode}: ${chainVerdict.detail ?? "chain verification failed"}`,
    );
  }

  const tbs = context.chain.device.tbs;

  // 3. §4: nothing from a development hierarchy is production-eligible. The
  //    field is typed `false`, so this can only fire for a credential built
  //    outside the type system — which is exactly when a check earns its keep.
  if ((tbs.productionEligible as boolean) !== false) {
    return reject(
      "CERT_PRODUCTION_ELIGIBILITY_CLAIMED",
      "the credential claims production eligibility; §4 refuses it",
    );
  }

  if (tbs.purpose !== DEVICE_CERTIFICATE_PURPOSE) {
    return reject("CERT_WRONG_PURPOSE", `credential purpose is ${tbs.purpose}`);
  }
  if (tbs.environment !== context.environment) {
    return reject("CERT_WRONG_ENVIRONMENT", `credential is for ${tbs.environment}`);
  }
  if (tbs.deviceRecordId !== context.deviceRecordId) {
    return reject("CERT_WRONG_DEVICE", "credential was issued for another device");
  }
  // The credential must attest to the key the device ACTUALLY holds. One for a
  // superseded key is not merely stale — it vouches for a key that is gone.
  if (tbs.subjectFingerprint !== context.currentKeyFingerprint) {
    return reject(
      "CERT_KEY_FINGERPRINT_MISMATCH",
      "the credential attests to a key this device does not currently hold",
    );
  }

  const notBefore = new Date(tbs.notBefore);
  const notAfter = new Date(tbs.notAfter);
  if (notBefore.getTime() >= notAfter.getTime()) {
    return reject("CERT_WINDOW_MALFORMED", "not_before is not before not_after");
  }
  const window = CERTIFICATE_WINDOWS[context.environment];
  const lifetimeDays = (notAfter.getTime() - notBefore.getTime()) / 86_400_000;
  if (lifetimeDays > window.certificateLifetimeDays) {
    return reject(
      "CERT_LIFETIME_EXCEEDS_POLICY",
      `lifetime ${lifetimeDays} days exceeds the ${window.certificateLifetimeDays}-day ${context.environment} policy`,
    );
  }

  // 4. Generation. A credential from before the current generation attests to
  //    a superseded identity state.
  if ((tbs.certificateGeneration ?? 0) < context.currentCertificateGeneration) {
    return reject(
      "CERT_STALE_CERTIFICATE_GENERATION",
      `credential generation ${tbs.certificateGeneration}, device is at ${context.currentCertificateGeneration}`,
    );
  }

  // 5. REVOCATION BEFORE EXPIRY. §5.4: a revoked credential is invalid even
  //    before expiry, so reporting "expired" for a revoked AND lapsed
  //    credential would understate what happened.
  if (context.revocations.isDeviceRevoked(tbs.deviceRecordId ?? "")) {
    return reject("CERT_REVOKED", "the device is revoked");
  }
  if (context.revocations.isCertificateRevoked(tbs.serialNumber)) {
    return reject("CERT_REVOKED", `credential ${tbs.serialNumber} is revoked`);
  }

  // 6. The window, against TRUSTED time.
  if (now.getTime() < notBefore.getTime()) {
    return reject("CERT_NOT_YET_VALID", `not valid until ${tbs.notBefore}`);
  }
  if (now.getTime() > notAfter.getTime()) {
    return reject("CERT_EXPIRED", `expired at ${tbs.notAfter}`);
  }

  return {
    valid: true,
    evaluatedAt: now,
    expiresAt: notAfter,
    credentialKind: CREDENTIAL_KIND,
  };
}

/**
 * §4: no credential makes a device production-eligible on its own. A function
 * rather than a constant, so a caller cannot infer eligibility from a valid
 * result — the hardware SKU gate is a separate, still-closed decision.
 */
export function certificateGrantsProductionEligibility(): false {
  return false;
}
