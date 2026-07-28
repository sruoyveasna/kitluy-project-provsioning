/**
 * `configuration_snapshot.validity` — governed consumer #4.
 *
 * Authority: KLD-2026-07-28-002 §6, §7, §12.6; trust policy §12.
 *
 * Decided against TRUSTED TIME. No host clock.
 *
 * Activation is ATOMIC and rollback goes only to a PREVIOUSLY VERIFIED
 * snapshot: a rollback target that was never verified is not a safe state to
 * return to, it is an unverified state with a reassuring name.
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import { trustedInstant } from "./certificate-validity.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";

export const CONFIGURATION_SNAPSHOT_PURPOSE: SigningPurpose = "configuration_signing";

export type ConfigurationRejectionCode =
  | "CONFIG_NO_TRUSTED_TIME"
  | "CONFIG_RESTRICTED_TRUST_MODE"
  | "CONFIG_WRONG_ENVIRONMENT"
  | "CONFIG_WRONG_PURPOSE"
  | "CONFIG_CROSS_PURPOSE_SIGNER"
  | "CONFIG_SIGNATURE_INVALID"
  | "CONFIG_CHECKSUM_MISMATCH"
  | "CONFIG_WINDOW_MALFORMED"
  | "CONFIG_NOT_YET_VALID"
  | "CONFIG_EXPIRED"
  | "CONFIG_VERSION_ROLLBACK"
  | "CONFIG_SCOPE_MISMATCH"
  | "CONFIG_DEVICE_MISMATCH"
  | "CONFIG_ASSIGNMENT_MISMATCH";

export interface ConfigurationSnapshot {
  readonly configurationVersion: number;
  readonly purpose: SigningPurpose;
  readonly environment: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly deviceRecordId: string;
  readonly assignmentGeneration: number;
  readonly issuedAt: Date;
  readonly validUntil: Date;
  readonly payloadSha256: string;
  readonly computedPayloadSha256: string;
  readonly signerKeyId: string;
  readonly signerPurpose: SigningPurpose;
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

export interface DeviceScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly deviceRecordId: string;
  readonly assignmentGeneration: number;
}

export interface ConfigurationVerificationContext {
  readonly snapshot: ConfigurationSnapshot;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly scope: DeviceScope;
  /** The highest configuration version this device has verified and activated. */
  readonly activeVersion: number | null;
}

export interface ConfigurationValidity {
  readonly valid: boolean;
  readonly rejectionCode?: ConfigurationRejectionCode;
  readonly detail?: string;
  readonly evaluatedAt?: Date;
}

/**
 * Decides whether a signed configuration snapshot may be ACTIVATED.
 *
 * Every check is fail-closed. Unlike a revocation snapshot, a stale or invalid
 * configuration is simply not activated — there is no partial-credit path,
 * because a configuration that is half-applied is a Store running on a mixture
 * of two rulesets.
 */
export function evaluateConfigurationSnapshot(
  context: ConfigurationVerificationContext,
): ConfigurationValidity {
  const s = context.snapshot;
  const reject = (
    rejectionCode: ConfigurationRejectionCode,
    detail: string,
  ): ConfigurationValidity => ({ valid: false, rejectionCode, detail });

  if (isRestricted(context.trustedTime.status)) {
    return reject(
      "CONFIG_RESTRICTED_TRUST_MODE",
      `configuration cannot be activated in restricted trust mode (${context.trustedTime.status})`,
    );
  }
  const now = trustedInstant(context.trustedTime);
  if (now === null) {
    return reject("CONFIG_NO_TRUSTED_TIME", "no trusted time is established");
  }

  if (s.environment !== context.environment) {
    return reject(
      "CONFIG_WRONG_ENVIRONMENT",
      `snapshot is for ${s.environment}, this device is ${context.environment}`,
    );
  }
  if (s.purpose !== CONFIGURATION_SNAPSHOT_PURPOSE) {
    return reject("CONFIG_WRONG_PURPOSE", `snapshot purpose is ${s.purpose}`);
  }
  if (s.signerPurpose !== CONFIGURATION_SNAPSHOT_PURPOSE) {
    return reject(
      "CONFIG_CROSS_PURPOSE_SIGNER",
      `signer ${s.signerKeyId} is authorized for ${s.signerPurpose}`,
    );
  }
  if (s.payloadSha256 !== s.computedPayloadSha256) {
    return reject("CONFIG_CHECKSUM_MISMATCH", "declared checksum does not match payload");
  }
  if (!s.signatureValid) {
    return reject("CONFIG_SIGNATURE_INVALID", "signature does not verify");
  }

  // Scope binding, each hop separately so the refusal names the wrong one.
  if (s.deviceRecordId !== context.scope.deviceRecordId) {
    return reject("CONFIG_DEVICE_MISMATCH", "snapshot is bound to another device");
  }
  if (
    s.tenantId !== context.scope.tenantId ||
    s.digitalStoreId !== context.scope.digitalStoreId ||
    s.storeLocationId !== context.scope.storeLocationId
  ) {
    return reject(
      "CONFIG_SCOPE_MISMATCH",
      "snapshot Tenant/Digital Store/Location does not match this device's assignment",
    );
  }
  if (s.assignmentGeneration !== context.scope.assignmentGeneration) {
    return reject(
      "CONFIG_ASSIGNMENT_MISMATCH",
      `snapshot binds assignment generation ${s.assignmentGeneration}, device carries ${context.scope.assignmentGeneration}`,
    );
  }

  if (s.issuedAt.getTime() >= s.validUntil.getTime()) {
    return reject("CONFIG_WINDOW_MALFORMED", "issued_at is not before valid_until");
  }

  // Monotonic version. Replaying an older configuration is how a withdrawn
  // price, permission or rule comes back.
  if (context.activeVersion !== null && s.configurationVersion < context.activeVersion) {
    return reject(
      "CONFIG_VERSION_ROLLBACK",
      `configuration version ${s.configurationVersion} is older than the active ${context.activeVersion}`,
    );
  }

  if (now.getTime() < s.issuedAt.getTime()) {
    return reject("CONFIG_NOT_YET_VALID", "snapshot is not yet valid");
  }
  if (now.getTime() > s.validUntil.getTime()) {
    return reject("CONFIG_EXPIRED", `snapshot expired at ${s.validUntil.toISOString()}`);
  }

  return { valid: true, evaluatedAt: now };
}

export interface ActivationState {
  readonly activeVersion: number | null;
  /** Versions this device has previously VERIFIED and activated. */
  readonly verifiedVersions: readonly number[];
}

export interface ActivationOutcome {
  readonly outcome: "ACTIVATED" | "REFUSED";
  readonly state: ActivationState;
  readonly refusalCode?: ConfigurationRejectionCode | "ROLLBACK_TARGET_UNVERIFIED";
  readonly detail?: string;
}

/**
 * Atomic activation. The state is replaced wholesale or not at all — there is
 * no intermediate value a reader could observe, because the new state object is
 * only constructed on the success path.
 */
export function activateConfiguration(
  context: ConfigurationVerificationContext,
  state: ActivationState,
): ActivationOutcome {
  const validity = evaluateConfigurationSnapshot(context);
  if (!validity.valid) {
    return {
      outcome: "REFUSED",
      state,
      ...(validity.rejectionCode !== undefined ? { refusalCode: validity.rejectionCode } : {}),
      ...(validity.detail !== undefined ? { detail: validity.detail } : {}),
    };
  }
  const version = context.snapshot.configurationVersion;
  return {
    outcome: "ACTIVATED",
    state: {
      activeVersion: version,
      verifiedVersions: state.verifiedVersions.includes(version)
        ? state.verifiedVersions
        : [...state.verifiedVersions, version],
    },
  };
}

/**
 * Rolls back to a PREVIOUSLY VERIFIED configuration version.
 *
 * A target that was never verified is refused. "Roll back to last known good"
 * is only meaningful if the thing was ever known good; rolling back to an
 * unverified version would launder it into the active slot.
 */
export function rollbackConfiguration(
  state: ActivationState,
  targetVersion: number,
): ActivationOutcome {
  if (!state.verifiedVersions.includes(targetVersion)) {
    return {
      outcome: "REFUSED",
      state,
      refusalCode: "ROLLBACK_TARGET_UNVERIFIED",
      detail: `version ${targetVersion} was never verified on this device; rollback goes only to a previously verified snapshot`,
    };
  }
  return {
    outcome: "ACTIVATED",
    state: { activeVersion: targetVersion, verifiedVersions: state.verifiedVersions },
  };
}
