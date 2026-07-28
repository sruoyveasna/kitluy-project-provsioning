/**
 * `revocation_snapshot.validity` — governed consumer #3.
 *
 * Authority: KLD-2026-07-28-002 §6.
 *
 * Decided against TRUSTED TIME. No host clock.
 *
 * §6.7 is the rule this module exists to keep: "No stale snapshot may be
 * represented as current." A stale snapshot is still USABLE — its known
 * revocations are enforced immediately (§6.1) — but it may not authorize
 * anything new, and the Hub enters restricted offline trust mode.
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { trustedInstant, type RevocationLookup } from "./certificate-validity.js";
import {
  MAX_REVOCATION_SNAPSHOT_AGE_HOURS,
  isRestricted,
  type TrustedTimeEvaluation,
} from "./trusted-time.js";

export const REVOCATION_SNAPSHOT_PURPOSE: SigningPurpose = "configuration_signing";

export type SnapshotRejectionCode =
  | "SNAPSHOT_NO_TRUSTED_TIME"
  | "SNAPSHOT_RESTRICTED_TRUST_MODE"
  | "SNAPSHOT_WRONG_ENVIRONMENT"
  | "SNAPSHOT_WRONG_PURPOSE"
  | "SNAPSHOT_CROSS_PURPOSE_SIGNER"
  | "SNAPSHOT_SIGNATURE_INVALID"
  | "SNAPSHOT_CHECKSUM_MISMATCH"
  | "SNAPSHOT_WINDOW_MALFORMED"
  | "SNAPSHOT_NOT_YET_VALID"
  | "SNAPSHOT_VERSION_ROLLBACK"
  | "SNAPSHOT_STALE";

export interface RevocationSnapshot {
  readonly snapshotVersion: number;
  readonly purpose: SigningPurpose;
  readonly environment: string;
  readonly issuedAt: Date;
  readonly validUntil: Date;
  readonly payloadSha256: string;
  readonly computedPayloadSha256: string;
  readonly signerKeyId: string;
  readonly signerPurpose: SigningPurpose;
  readonly revokedCertificateSerials: readonly string[];
  readonly revokedDeviceRecordIds: readonly string[];
  /**
   * CALLER-SUPPLIED, and deliberately still so — review condition C4.
   *
   * The configuration signer does not exist until Step 6, so there is no
   * verifier to route this through. Marking it verified internally would be a
   * fabrication; taking it from the caller is at least honest about where the
   * trust currently comes from. C4 closes for THIS purpose only when Step 6
   * lands a real signer, and the certificate path (which no longer accepts a
   * boolean) is the shape it must follow.
   */
  readonly signatureValid: boolean;
}

export interface SnapshotVerificationContext {
  readonly snapshot: RevocationSnapshot;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  /** The highest snapshot version this Hub has already accepted. */
  readonly acceptedVersion: number | null;
}

export interface SnapshotValidity {
  readonly accepted: boolean;
  readonly rejectionCode?: SnapshotRejectionCode;
  readonly detail?: string;
  /**
   * TRUE when the Hub must enter restricted offline trust mode. Distinct from
   * `accepted`: a stale snapshot is not accepted as CURRENT, yet its contents
   * remain enforceable.
   */
  readonly entersRestrictedMode: boolean;
  /**
   * TRUE when the snapshot's revocations must still be enforced even though it
   * was not accepted as current (§6.1).
   */
  readonly enforceKnownRevocations: boolean;
  readonly ageHours?: number;
}

const MS_PER_HOUR = 1000 * 60 * 60;

/**
 * Decides whether a signed revocation snapshot may be treated as CURRENT.
 *
 * The staleness verdict is deliberately not a plain rejection: a Hub that
 * discarded a stale snapshot would lose the revocations it already knows, which
 * is worse than holding them. So a stale snapshot returns
 * `accepted: false, enforceKnownRevocations: true, entersRestrictedMode: true`.
 */
export function evaluateRevocationSnapshot(context: SnapshotVerificationContext): SnapshotValidity {
  const s = context.snapshot;
  const reject = (
    rejectionCode: SnapshotRejectionCode,
    detail: string,
    extra: Partial<SnapshotValidity> = {},
  ): SnapshotValidity => ({
    accepted: false,
    rejectionCode,
    detail,
    entersRestrictedMode: true,
    // A snapshot that failed INTEGRITY is not a source of revocation facts.
    // Only staleness preserves enforcement, and it sets this explicitly.
    enforceKnownRevocations: false,
    ...extra,
  });

  if (isRestricted(context.trustedTime.status)) {
    return reject(
      "SNAPSHOT_RESTRICTED_TRUST_MODE",
      `cannot judge snapshot freshness in restricted trust mode (${context.trustedTime.status})`,
    );
  }
  const now = trustedInstant(context.trustedTime);
  if (now === null) {
    return reject("SNAPSHOT_NO_TRUSTED_TIME", "no trusted time is established");
  }

  if (s.environment !== context.environment) {
    return reject(
      "SNAPSHOT_WRONG_ENVIRONMENT",
      `snapshot is for ${s.environment}, this device is ${context.environment}`,
    );
  }
  if (s.purpose !== REVOCATION_SNAPSHOT_PURPOSE) {
    return reject("SNAPSHOT_WRONG_PURPOSE", `snapshot purpose is ${s.purpose}`);
  }
  // §7: the signer must be authorized for THIS purpose.
  if (s.signerPurpose !== REVOCATION_SNAPSHOT_PURPOSE) {
    return reject(
      "SNAPSHOT_CROSS_PURPOSE_SIGNER",
      `signer ${s.signerKeyId} is authorized for ${s.signerPurpose}`,
    );
  }
  if (s.payloadSha256 !== s.computedPayloadSha256) {
    return reject(
      "SNAPSHOT_CHECKSUM_MISMATCH",
      "the declared payload checksum does not match the payload",
    );
  }
  if (!s.signatureValid) {
    return reject("SNAPSHOT_SIGNATURE_INVALID", "snapshot signature does not verify");
  }
  if (s.issuedAt.getTime() >= s.validUntil.getTime()) {
    return reject("SNAPSHOT_WINDOW_MALFORMED", "issued_at is not before valid_until");
  }

  // Monotonic version. An older snapshot cannot replace a newer one, or a
  // revocation could be undone by replaying yesterday's list.
  if (context.acceptedVersion !== null && s.snapshotVersion < context.acceptedVersion) {
    return reject(
      "SNAPSHOT_VERSION_ROLLBACK",
      `snapshot version ${s.snapshotVersion} is older than the accepted ${context.acceptedVersion}`,
    );
  }

  if (now.getTime() < s.issuedAt.getTime()) {
    return reject("SNAPSHOT_NOT_YET_VALID", "snapshot is not yet valid");
  }

  const ageHours = (now.getTime() - s.issuedAt.getTime()) / MS_PER_HOUR;
  const maxAge = MAX_REVOCATION_SNAPSHOT_AGE_HOURS[context.environment];

  if (now.getTime() > s.validUntil.getTime() || ageHours > maxAge) {
    // STALE, not corrupt. Its revocations are still true; what it cannot do is
    // authorize anything new.
    return reject(
      "SNAPSHOT_STALE",
      `snapshot is ${ageHours.toFixed(1)}h old; the ${context.environment} maximum is ${maxAge}h`,
      { enforceKnownRevocations: true, ageHours },
    );
  }

  return {
    accepted: true,
    entersRestrictedMode: false,
    enforceKnownRevocations: true,
    ageHours,
  };
}

/**
 * A revocation lookup backed by an accepted or stale snapshot.
 *
 * Deliberately usable in BOTH cases: §6.1 requires a locally known revocation
 * to be enforced immediately, and freshness governs what new trust may be
 * granted, not what has already been withdrawn.
 */
export function revocationLookupFrom(snapshot: RevocationSnapshot): RevocationLookup {
  const certs = new Set(snapshot.revokedCertificateSerials);
  const devices = new Set(snapshot.revokedDeviceRecordIds);
  return {
    isCertificateRevoked: (serial) => certs.has(serial),
    isDeviceRevoked: (deviceRecordId) => devices.has(deviceRecordId),
  };
}
