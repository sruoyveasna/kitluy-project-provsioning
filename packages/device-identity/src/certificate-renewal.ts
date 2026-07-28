/**
 * `certificate.renewal_eligibility` — governed consumer #2.
 *
 * Authority: KLD-2026-07-28-002 §5.
 *
 * A SEPARATE consumer from validity, deliberately. "Is this certificate valid"
 * and "may this device renew" are different questions with different answers:
 * a certificate can be valid and not yet renewable, and an expired one is
 * invalid AND not renewable — expiry is a recovery case, not a renewal case.
 *
 * Decided against TRUSTED TIME. No host clock.
 */

import type { TrustEnvironment } from "./environments.js";
import type { DeviceCertificate, RevocationLookup } from "./certificate-validity.js";
import { trustedInstant } from "./certificate-validity.js";
import { CERTIFICATE_WINDOWS, isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";

export type RenewalRefusalCode =
  | "RENEWAL_NO_TRUSTED_TIME"
  | "RENEWAL_RESTRICTED_TRUST_MODE"
  | "RENEWAL_TOO_EARLY"
  | "RENEWAL_CERTIFICATE_EXPIRED"
  | "RENEWAL_CERTIFICATE_REVOKED"
  | "RENEWAL_OVERLAP_EXCEEDED"
  | "RENEWAL_WRONG_DEVICE";

export interface RenewalContext {
  readonly certificate: DeviceCertificate;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly deviceRecordId: string;
  readonly revocations: RevocationLookup;
  /**
   * How long the device has already been holding a second, overlapping
   * certificate. Zero when there is no overlap in progress.
   */
  readonly existingOverlapDays: number;
  /**
   * Set only by an explicitly approved provider policy. §5.1: renewal creates a
   * NEW key pair unless a hardware-backed rotation policy permits reuse, and no
   * such policy is approved, so this is false everywhere today.
   */
  readonly approvedKeyReusePolicy?: boolean;
}

export interface RenewalEligibility {
  readonly eligible: boolean;
  readonly refusalCode?: RenewalRefusalCode;
  readonly detail?: string;
  readonly daysRemaining?: number;
  /** True when renewal must generate a new key pair (§5.1). */
  readonly requiresNewKeyPair: boolean;
  /** Set when the refusal means recovery rather than renewal. */
  readonly requiresRecovery?: boolean;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Decides whether a device may renew its certificate now.
 *
 * `daysRemaining` is computed against trusted time and compared with the signed
 * renewal window — 10 days in development. The boundary is INCLUSIVE: exactly
 * ten days remaining is eligible, because a device that wakes once a day would
 * otherwise skip its window entirely.
 */
export function evaluateRenewalEligibility(context: RenewalContext): RenewalEligibility {
  const { certificate: cert } = context;
  const requiresNewKeyPair = context.approvedKeyReusePolicy !== true;

  const refuse = (
    refusalCode: RenewalRefusalCode,
    detail: string,
    extra: Partial<RenewalEligibility> = {},
  ): RenewalEligibility => ({
    eligible: false,
    refusalCode,
    detail,
    requiresNewKeyPair,
    ...extra,
  });

  if (isRestricted(context.trustedTime.status)) {
    return refuse(
      "RENEWAL_RESTRICTED_TRUST_MODE",
      `renewal is blocked in restricted trust mode (${context.trustedTime.status})`,
    );
  }
  const now = trustedInstant(context.trustedTime);
  if (now === null) {
    return refuse("RENEWAL_NO_TRUSTED_TIME", "no trusted time is established");
  }

  if (cert.deviceRecordId !== context.deviceRecordId) {
    return refuse("RENEWAL_WRONG_DEVICE", "certificate belongs to another device");
  }

  // Revocation before expiry: a revoked certificate does not renew, it is
  // replaced through recovery, and saying "expired" would be the wrong story.
  if (
    context.revocations.isCertificateRevoked(cert.certificateSerial) ||
    context.revocations.isDeviceRevoked(cert.deviceRecordId)
  ) {
    return refuse(
      "RENEWAL_CERTIFICATE_REVOKED",
      "a revoked certificate is not renewed; it is replaced through approved recovery",
      { requiresRecovery: true },
    );
  }

  const daysRemaining = (cert.notAfter.getTime() - now.getTime()) / MS_PER_DAY;

  if (daysRemaining < 0) {
    return refuse(
      "RENEWAL_CERTIFICATE_EXPIRED",
      "an expired certificate is not renewed; reissuance goes through recovery",
      { daysRemaining, requiresRecovery: true },
    );
  }

  const window = CERTIFICATE_WINDOWS[context.environment];

  // Overlap is checked BEFORE the window: a device already holding two
  // certificates past the overlap limit must not be told it is simply too early.
  if (context.existingOverlapDays > window.overlapWindowDays) {
    return refuse(
      "RENEWAL_OVERLAP_EXCEEDED",
      `an overlap of ${context.existingOverlapDays} days exceeds the ${window.overlapWindowDays}-day ${context.environment} maximum`,
      { daysRemaining },
    );
  }

  if (daysRemaining > window.renewalWindowDays) {
    return refuse(
      "RENEWAL_TOO_EARLY",
      `renewal begins ${window.renewalWindowDays} days before expiry; ${daysRemaining} days remain`,
      { daysRemaining },
    );
  }

  return { eligible: true, daysRemaining, requiresNewKeyPair };
}
