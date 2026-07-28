/**
 * `certificate.validity` — governed consumer #1.
 *
 * Authority: KLD-2026-07-28-002 §5, §6, §7, §12.6.
 *
 * Certificate validity is decided against TRUSTED TIME. No host clock, no SQL
 * `now()`, no `clock_timestamp()`. The trusted-time evaluation is an INPUT, so
 * this module cannot reach for a clock even by accident — there is nothing here
 * to reach with.
 *
 * The separation the owner fixed, restated because it is easy to blur:
 *   device trusted time  -> certificate, revocation and configuration validity
 *   server/database time -> human approval creation, expiry and consumption
 * Approval expiry stays outside this file entirely.
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { CERTIFICATE_WINDOWS, isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";

/** The purpose a device identity certificate is issued for. */
export const DEVICE_CERTIFICATE_PURPOSE: SigningPurpose = "device_identity";

export type CertificateRejectionCode =
  | "CERT_NO_TRUSTED_TIME"
  | "CERT_RESTRICTED_TRUST_MODE"
  | "CERT_WRONG_DEVICE"
  | "CERT_WRONG_ENVIRONMENT"
  | "CERT_WRONG_PURPOSE"
  | "CERT_UNKNOWN_ISSUER"
  | "CERT_CROSS_PURPOSE_ISSUER"
  | "CERT_ISSUER_REVOKED"
  | "CERT_SIGNATURE_INVALID"
  | "CERT_WINDOW_MALFORMED"
  | "CERT_LIFETIME_EXCEEDS_POLICY"
  | "CERT_NOT_YET_VALID"
  | "CERT_EXPIRED"
  | "CERT_REVOKED"
  | "CERT_STALE_KEY_GENERATION"
  | "CERT_ASSIGNMENT_MISMATCH";

export interface DeviceCertificate {
  readonly certificateSerial: string;
  readonly purpose: SigningPurpose;
  readonly environment: string;
  readonly deviceRecordId: string;
  readonly publicKeyFingerprint: string;
  /**
   * Which device-key generation this certificate was issued against. A
   * certificate that predates the current key is not merely old — it attests to
   * a key the device no longer holds.
   */
  readonly deviceKeyGeneration: number;
  readonly assignmentGeneration: number | null;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly issuerKeyId: string;
  readonly signature: Uint8Array;
}

export interface CertificateIssuerRegistration {
  readonly issuerKeyId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: SigningPurpose;
  readonly revoked: boolean;
}

/** Revocation facts the Hub holds locally. Supplied by consumer #3. */
export interface RevocationLookup {
  isCertificateRevoked(certificateSerial: string): boolean;
  isDeviceRevoked(deviceRecordId: string): boolean;
}

export interface CertificateVerificationContext {
  readonly certificate: DeviceCertificate;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly deviceRecordId: string;
  /** The generation of the key the device currently holds. */
  readonly currentDeviceKeyGeneration: number;
  /** Null when the device holds no assignment yet. */
  readonly currentAssignmentGeneration: number | null;
  readonly issuers: readonly CertificateIssuerRegistration[];
  readonly revocations: RevocationLookup;
  readonly signatureValid: boolean;
}

export interface CertificateValidity {
  readonly valid: boolean;
  readonly rejectionCode?: CertificateRejectionCode;
  readonly detail?: string;
  /** Present only when the certificate is valid. */
  readonly evaluatedAt?: Date;
  readonly expiresAt?: Date;
}

/**
 * Extracts the instant every validity decision is made against, or null when
 * there is none. Shared by all four consumers so they cannot disagree about
 * what "now" means.
 */
export function trustedInstant(evaluation: TrustedTimeEvaluation): Date | null {
  if (isRestricted(evaluation.status)) return null;
  return evaluation.trustedTime;
}

/**
 * Decides whether a device identity certificate is valid RIGHT NOW, where "now"
 * is trusted time.
 *
 * Checks are ordered cheapest-and-most-specific first, so the rejection names
 * the actual fault rather than a downstream symptom. Every path is fail-closed:
 * there is no branch that returns `valid: true` by omission.
 */
export function evaluateCertificateValidity(
  context: CertificateVerificationContext,
): CertificateValidity {
  const { certificate: cert } = context;
  const reject = (
    rejectionCode: CertificateRejectionCode,
    detail: string,
  ): CertificateValidity => ({ valid: false, rejectionCode, detail });

  // 1. TRUSTED TIME FIRST. Without it there is no "now" to judge against, and
  //    guessing one is the failure §12 exists to prevent.
  if (isRestricted(context.trustedTime.status)) {
    return reject(
      "CERT_RESTRICTED_TRUST_MODE",
      `device is in restricted trust mode (${context.trustedTime.status}); certificate validity cannot be decided`,
    );
  }
  const now = trustedInstant(context.trustedTime);
  if (now === null) {
    return reject("CERT_NO_TRUSTED_TIME", "no trusted time is established");
  }

  // 2. Binding.
  if (cert.deviceRecordId !== context.deviceRecordId) {
    return reject("CERT_WRONG_DEVICE", "certificate was issued for another device");
  }
  if (cert.environment !== context.environment) {
    return reject(
      "CERT_WRONG_ENVIRONMENT",
      `certificate is for ${cert.environment}, this device is ${context.environment}`,
    );
  }
  if (cert.purpose !== DEVICE_CERTIFICATE_PURPOSE) {
    return reject("CERT_WRONG_PURPOSE", `certificate purpose is ${cert.purpose}`);
  }

  // 3. Issuer.
  const issuer = context.issuers.find((i) => i.issuerKeyId === cert.issuerKeyId);
  if (issuer === undefined) {
    return reject("CERT_UNKNOWN_ISSUER", `unknown issuer key ${cert.issuerKeyId}`);
  }
  if (issuer.revoked) {
    return reject("CERT_ISSUER_REVOKED", `issuer key ${cert.issuerKeyId} is revoked`);
  }
  if (issuer.environment !== context.environment) {
    return reject(
      "CERT_WRONG_ENVIRONMENT",
      `issuer ${cert.issuerKeyId} belongs to ${issuer.environment}`,
    );
  }
  // §7: an issuer authorized for another purpose is not authorized for this
  // one, however well its signature verifies.
  if (issuer.purpose !== DEVICE_CERTIFICATE_PURPOSE) {
    return reject(
      "CERT_CROSS_PURPOSE_ISSUER",
      `issuer ${cert.issuerKeyId} is authorized for ${issuer.purpose}`,
    );
  }

  // 4. Window shape, checkable without any clock.
  if (cert.notBefore.getTime() >= cert.notAfter.getTime()) {
    return reject("CERT_WINDOW_MALFORMED", "not_before is not before not_after");
  }
  const window = CERTIFICATE_WINDOWS[context.environment];
  const lifetimeDays = (cert.notAfter.getTime() - cert.notBefore.getTime()) / (1000 * 60 * 60 * 24);
  if (lifetimeDays > window.certificateLifetimeDays) {
    return reject(
      "CERT_LIFETIME_EXCEEDS_POLICY",
      `lifetime ${lifetimeDays} days exceeds the ${window.certificateLifetimeDays}-day ${context.environment} policy`,
    );
  }

  // 5. Signature.
  if (!context.signatureValid) {
    return reject("CERT_SIGNATURE_INVALID", "certificate signature does not verify");
  }

  // 6. Key generation. A certificate issued before the device's current key
  //    attests to a key the device no longer holds.
  if (cert.deviceKeyGeneration < context.currentDeviceKeyGeneration) {
    return reject(
      "CERT_STALE_KEY_GENERATION",
      `certificate attests to key generation ${cert.deviceKeyGeneration}, device holds ${context.currentDeviceKeyGeneration}`,
    );
  }

  // 7. Assignment, where the certificate binds one.
  if (
    cert.assignmentGeneration !== null &&
    cert.assignmentGeneration !== context.currentAssignmentGeneration
  ) {
    return reject(
      "CERT_ASSIGNMENT_MISMATCH",
      `certificate binds assignment generation ${cert.assignmentGeneration}, device carries ${context.currentAssignmentGeneration ?? "none"}`,
    );
  }

  // 8. Revocation BEFORE expiry. §5.4: a revoked certificate is invalid even
  //    when its expiry has not passed, so reporting "expired" for a revoked
  //    certificate would understate what happened.
  if (context.revocations.isDeviceRevoked(cert.deviceRecordId)) {
    return reject("CERT_REVOKED", "the device is revoked");
  }
  if (context.revocations.isCertificateRevoked(cert.certificateSerial)) {
    return reject("CERT_REVOKED", `certificate ${cert.certificateSerial} is revoked`);
  }

  // 9. The window, against TRUSTED time.
  if (now.getTime() < cert.notBefore.getTime()) {
    return reject("CERT_NOT_YET_VALID", `not valid until ${cert.notBefore.toISOString()}`);
  }
  if (now.getTime() > cert.notAfter.getTime()) {
    return reject("CERT_EXPIRED", `expired at ${cert.notAfter.toISOString()}`);
  }

  return { valid: true, evaluatedAt: now, expiresAt: cert.notAfter };
}

/**
 * §4: no certificate makes a device production-eligible on its own. Stated as a
 * function so a caller cannot infer eligibility from a valid certificate — the
 * hardware SKU gate is a separate, still-closed decision.
 */
export function certificateGrantsProductionEligibility(): false {
  return false;
}
