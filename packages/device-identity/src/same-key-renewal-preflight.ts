/**
 * Same-key renewal preflight and reservation — WS-11-T003 Step 4.
 *
 * Authority: KLD-2026-07-28-002 §5, §6, §7, §12.6; the owner renewal
 * instruction of 2026-07-29; migration groups 0125, 0127, 0129 and 0130.
 *
 * ===========================================================================
 * WHAT THIS UNIT DOES, AND WHERE IT STOPS
 * ===========================================================================
 *   load the credential head
 *     -> load the incumbent credential the head points at
 *     -> load the stored chain
 *     -> evaluate trusted time
 *     -> verify the chain with REAL Ed25519 cryptography
 *     -> evaluate renewal eligibility
 *     -> reserve a `reuse_current_key` renewal IN THE DATABASE
 *     -> return the frozen reservation
 *
 * It STOPS there. No credential is prepared, signed or finalized here; no key
 * is generated, rotated or activated; no head is advanced; no lifecycle status
 * is promoted. Those belong to later units and are deliberately absent rather
 * than stubbed, because a stub is what makes a blocked programme look finished.
 *
 * ===========================================================================
 * THE INCUMBENT IS DERIVED, NEVER ACCEPTED
 * ===========================================================================
 * `assertedCurrentCredentialId` exists so a caller's belief can be CHECKED. It
 * is never used to look anything up. The credential this preflight renews is
 * whichever one the authoritative head points at — otherwise a caller could
 * nominate an older issued credential and have a renewal reserved against it.
 *
 * ===========================================================================
 * NO CALLER-SUPPLIED TRUST
 * ===========================================================================
 * There is no `signatureValid`, no `isVerified` and no injectable verifier on
 * this boundary. The chain is verified INSIDE this module by
 * `evaluateCertificateValidity`, which runs the real verifier. A caller can
 * hand this function a forged credential; it cannot hand it a verdict.
 *
 * `state = 'issued'`, the existence of a row and the existence of an issuance
 * audit are all treated as facts about BOOKKEEPING, never as evidence that a
 * signature verifies. The only thing that establishes that here is the curve
 * maths.
 *
 * The result carries no caller-usable "verified" boolean either. Consumers at
 * the actual authentication boundary must run the real verifier themselves;
 * {@link SameKeyRenewalDiagnostics} says so in a field name rather than in a
 * comment somebody can skip.
 *
 * Every time judgement is TRUSTED TIME. No host clock, no SQL `now()`.
 */

import type { SigningPurpose, TrustEnvironment } from "./environments.js";
import {
  DEVICE_CERTIFICATE_PURPOSE,
  credentialView,
  evaluateCertificateValidity,
  trustedInstant,
  type CertificateRejectionCode,
  type RevocationLookup,
} from "./certificate-validity.js";
import { evaluateRenewalEligibility } from "./certificate-renewal.js";
import { isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import { tbsFromCanonicalBytes, type CertificateChain } from "./dev-crypto.js";
import type { HardwareTrustLevel } from "./index.js";

/**
 * The ONLY mode this unit implements. Rotation is a different unit and a
 * different owner decision: migration 0129 records that §5.1 was a
 * RECOMMENDATION rather than a ruling, and `kitluy_devices.renewal_policy`
 * keeps `rotate_key` disabled pending
 * `[REQUIRED: renewal_key_rotation_owner_decision]`.
 *
 * Reuse needs no owner decision — rotation does. That asymmetry is why this
 * module can proceed while rotation cannot.
 */
export const SAME_KEY_RENEWAL_MODE = "reuse_current_key" as const;
export type SameKeyRenewalMode = typeof SAME_KEY_RENEWAL_MODE;

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

export type SameKeyRenewalRefusalCode =
  // -- trusted time ---------------------------------------------------------
  | "RENEWAL_PREFLIGHT_NO_TRUSTED_TIME"
  | "RENEWAL_PREFLIGHT_RESTRICTED_TRUST_MODE"
  // -- incumbent selection --------------------------------------------------
  | "RENEWAL_PREFLIGHT_NO_CREDENTIAL_HEAD"
  | "RENEWAL_PREFLIGHT_NO_CURRENT_CREDENTIAL"
  | "RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT"
  | "RENEWAL_PREFLIGHT_WRONG_DEVICE"
  | "RENEWAL_PREFLIGHT_WRONG_ENVIRONMENT"
  | "RENEWAL_PREFLIGHT_WRONG_PURPOSE"
  | "RENEWAL_PREFLIGHT_GENERATION_MISMATCH"
  | "RENEWAL_PREFLIGHT_STALE_ASSIGNMENT_GENERATION"
  | "RENEWAL_PREFLIGHT_STALE_HEAD_VERSION"
  | "RENEWAL_PREFLIGHT_INCOMPLETE_CHAIN"
  // -- verification ---------------------------------------------------------
  | "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED"
  | "RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED"
  | "RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED"
  // -- eligibility ----------------------------------------------------------
  | "RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW"
  | "RENEWAL_PREFLIGHT_OVERLAP_EXCEEDED"
  | "RENEWAL_PREFLIGHT_PROVIDER_KEY_MISSING"
  | "RENEWAL_PREFLIGHT_PROVIDER_KEY_NOT_ACTIVE"
  | "RENEWAL_PREFLIGHT_PROVIDER_KEY_FINGERPRINT_MISMATCH"
  | "RENEWAL_PREFLIGHT_PROVIDER_KEY_WRONG_SCOPE"
  // -- reservation ----------------------------------------------------------
  | "RENEWAL_PREFLIGHT_ALREADY_RESERVED"
  | "RENEWAL_PREFLIGHT_GENERATION_CONFLICT"
  | "RENEWAL_PREFLIGHT_RESERVATION_REFUSED"
  | "RENEWAL_PREFLIGHT_RESERVATION_MODE_MISMATCH"
  | "RENEWAL_PREFLIGHT_RESERVATION_GENERATION_UNEXPECTED"
  | "RENEWAL_PREFLIGHT_RESERVATION_CARRIES_REPLACEMENT_KEY";

/**
 * The database's typed refusal codes, mapped WITHOUT losing the original. The
 * database text always travels on in `detail`; this only decides which typed
 * code a caller can branch on.
 */
const DATABASE_REFUSAL_CODES: ReadonlyArray<readonly [string, SameKeyRenewalRefusalCode]> = [
  ["KLUY-RENEWAL-ALREADY-RESERVED", "RENEWAL_PREFLIGHT_ALREADY_RESERVED"],
  // The LATE compare-and-swap failure at the head. Distinct from the early
  // fast-fail above, and migration 0130 is explicit that the two must not be
  // collapsed into one code.
  ["RENEWAL_GENERATION_CONFLICT", "RENEWAL_PREFLIGHT_GENERATION_CONFLICT"],
  ["KLUY-CRED-RENEWAL-GENERATION-CONFLICT", "RENEWAL_PREFLIGHT_GENERATION_CONFLICT"],
  ["KLUY-RENEWAL-NO-TRUSTED-TIME", "RENEWAL_PREFLIGHT_NO_TRUSTED_TIME"],
  ["KLUY-RENEWAL-NO-CURRENT-CREDENTIAL", "RENEWAL_PREFLIGHT_NO_CURRENT_CREDENTIAL"],
  ["KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY", "RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED"],
  ["KLUY-RENEWAL-EXPIRED-REQUIRES-RECOVERY", "RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED"],
  ["KLUY-RENEWAL-TOO-EARLY", "RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW"],
  ["KLUY-RENEWAL-STALE-ASSIGNMENT", "RENEWAL_PREFLIGHT_STALE_ASSIGNMENT_GENERATION"],
];

/** Certificate rejections, translated into renewal-preflight refusals. */
const VERIFICATION_REFUSAL_CODES: Readonly<
  Record<CertificateRejectionCode, SameKeyRenewalRefusalCode>
> = {
  CERT_NO_TRUSTED_TIME: "RENEWAL_PREFLIGHT_NO_TRUSTED_TIME",
  CERT_RESTRICTED_TRUST_MODE: "RENEWAL_PREFLIGHT_RESTRICTED_TRUST_MODE",
  CERT_CHAIN_INVALID: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
  CERT_WRONG_DEVICE: "RENEWAL_PREFLIGHT_WRONG_DEVICE",
  CERT_WRONG_ENVIRONMENT: "RENEWAL_PREFLIGHT_WRONG_ENVIRONMENT",
  CERT_WRONG_PURPOSE: "RENEWAL_PREFLIGHT_WRONG_PURPOSE",
  // The credential does not attest to the key recorded against it. That is a
  // binding failure inside the signed structure, not a provider-key problem —
  // the provider key is compared separately, in eligibility.
  CERT_KEY_FINGERPRINT_MISMATCH: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
  CERT_WINDOW_MALFORMED: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
  CERT_LIFETIME_EXCEEDS_POLICY: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
  CERT_NOT_YET_VALID: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
  CERT_EXPIRED: "RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED",
  CERT_REVOKED: "RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED",
  CERT_STALE_CERTIFICATE_GENERATION: "RENEWAL_PREFLIGHT_GENERATION_MISMATCH",
  CERT_PRODUCTION_ELIGIBILITY_CLAIMED: "RENEWAL_PREFLIGHT_CHAIN_VERIFICATION_FAILED",
};

// ---------------------------------------------------------------------------
// What the repository must supply
// ---------------------------------------------------------------------------

export interface RenewalScope {
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
}

/** `kitluy_devices.device_credential_heads`. The AUTHORITY on what is current. */
export interface CredentialHeadRecord {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly currentGeneration: number;
  readonly previousGeneration: number | null;
  readonly overlapEndsAt: Date | null;
  /** Compare-and-swap version. Frozen into the reservation by the database. */
  readonly version: number;
}

/** `kitluy_devices.device_credentials`, minus anything secret. */
export interface IncumbentCredentialRecord {
  readonly credentialId: string;
  readonly serialNumber: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly certificateGeneration: number;
  readonly assignmentGeneration: number;
  readonly publicKeyFingerprint: string;
  readonly issuerKeyId: string;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  readonly state: string;
  readonly revokedAt: Date | null;
  /** The bytes that were signed, exactly as stored. */
  readonly canonicalTbs: string;
  /** The detached signature over those bytes. */
  readonly detachedSignature: Uint8Array;
}

/** One row of `kitluy_devices.device_credential_chain_links`. */
export interface StoredChainLink {
  readonly linkPosition: number;
  readonly role: string;
  readonly canonicalTbs: string;
  readonly detachedSignature: Uint8Array;
}

/** Revocation FACTS. Not a verdict about any signature. */
export interface RevocationStateRecord {
  readonly credentialRevoked: boolean;
  readonly deviceRevoked: boolean;
}

/** `kitluy_devices.device_generation_keys` — PUBLIC metadata only. */
export interface ProviderKeyRecord {
  readonly keyId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  /** The CREDENTIAL generation the key was registered against. */
  readonly generation: number;
  /**
   * The KEY generation, which is NOT the credential generation. Under
   * `reuse_current_key` the credential generation advances and this does not.
   * Null for keys registered before migration 0130 split the two fields.
   */
  readonly keyGeneration: number | null;
  readonly publicKeyFingerprint: string;
  /** Provider key reference. A HANDLE — never key material. */
  readonly providerKeyReference: string;
  readonly state: string;
}

/**
 * Reads only. There is no write method on this interface, deliberately: every
 * write in this unit goes through the governed database function.
 */
export interface IncumbentCredentialRepository {
  loadCredentialHead(scope: RenewalScope): Promise<CredentialHeadRecord | null>;
  /**
   * Loads the credential at a generation the HEAD named. The generation is an
   * argument rather than a credential id precisely so a caller cannot pick one.
   */
  loadCredentialAtGeneration(
    scope: RenewalScope,
    generation: number,
  ): Promise<IncumbentCredentialRecord | null>;
  loadCredentialChainLinks(credentialId: string): Promise<readonly StoredChainLink[]>;
  loadRevocationState(scope: RenewalScope, serialNumber: string): Promise<RevocationStateRecord>;
  /** The key the device currently holds, per the provider registry. */
  loadCurrentProviderKey(scope: RenewalScope): Promise<ProviderKeyRecord | null>;
}

// ---------------------------------------------------------------------------
// The governed reservation boundary
// ---------------------------------------------------------------------------

/** What `reserve_device_credential_renewal_v1` returns, mapped one-to-one. */
export interface ReservedRenewalRow {
  readonly outcome: "RESERVED" | "REPLAYED_RESERVATION";
  readonly renewalAttemptId: string;
  readonly renewalMode: string;
  readonly currentCredentialId: string;
  readonly currentCredentialGeneration: number;
  readonly nextCredentialGeneration: number;
  readonly assignmentGeneration: number;
  readonly credentialHeadVersion: number;
  readonly status: string;
  /**
   * Present only if some future path attaches a replacement key to a
   * reservation. Under `reuse_current_key` it must be absent, and this
   * preflight refuses rather than ignores a value here.
   */
  readonly replacementKeyReference?: string | null;
}

export interface ReserveRenewalInput {
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly purpose: string;
  readonly idempotencyKey: string;
  /** Trusted time. The database refuses anything but a `trusted` status. */
  readonly trustedTime: Date;
  readonly trustedTimeStatus: string;
  readonly renewalMode: SameKeyRenewalMode;
  readonly actorRef: string;
}

/**
 * The single governed write. Implemented against the real database in the
 * integration suite; injectable so the refusal semantics can be exercised
 * without one.
 *
 * The reservation is BUILT BY THE DATABASE. Nothing in this package allocates a
 * renewal attempt id, a next generation or a head version.
 */
export interface RenewalReservationGateway {
  reserveRenewal(input: ReserveRenewalInput): Promise<ReservedRenewalRow>;
}

// ---------------------------------------------------------------------------
// Input and outcome
// ---------------------------------------------------------------------------

export interface SameKeyRenewalPreflightInput {
  readonly deviceRecordId: string;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  /** Stable per renewal intent. A retry reuses it and receives the SAME attempt. */
  readonly idempotencyKey: string;
  readonly actorRef: string;
  readonly trustedTime: TrustedTimeEvaluation;
  /** This verifier's anchor set. A development root is absent in production. */
  readonly trustedRootFingerprints: readonly string[];
  /** The device's CURRENT assignment generation, read from the device record. */
  readonly currentAssignmentGeneration: number;
  /**
   * CHECKED, never used to look anything up. Supplying a credential that is not
   * the head's is refused with `RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT`.
   */
  readonly assertedCurrentCredentialId?: string;
  /** The head version the caller last observed. A stale one is refused. */
  readonly expectedCredentialHeadVersion?: number;
  /** Days the device has already held a second, overlapping credential. */
  readonly existingOverlapDays?: number;
}

/**
 * DIAGNOSTIC ONLY.
 *
 * There is no `verified: true` here. The longest field name in this package is
 * the point: a consumer that reaches an authentication boundary must run the
 * real verifier against the credential itself, and nothing in this result is a
 * substitute for that.
 */
export interface SameKeyRenewalDiagnostics {
  readonly credentialKind: string;
  readonly evaluatedAtTrustedTime: Date;
  readonly incumbentExpiresAt: Date;
  readonly consumersMustReVerifyAtAuthenticationBoundary: true;
}

/**
 * Everything the next unit needs, and nothing it does not. No private key
 * material, no key handles beyond the provider REFERENCE, no signature verdict.
 */
export interface SameKeyRenewalReservation {
  readonly renewalAttemptId: string;
  readonly renewalMode: SameKeyRenewalMode;
  readonly deviceRecordId: string;
  readonly currentCredentialId: string;
  readonly currentCredentialGeneration: number;
  readonly nextCredentialGeneration: number;
  readonly credentialHeadVersion: number;
  readonly assignmentGeneration: number;
  readonly environment: TrustEnvironment;
  readonly purpose: string;
  readonly currentPublicKeyFingerprint: string;
  readonly currentKeyGeneration: number | null;
  readonly reservationStatus: string;
  /** Always null in this mode. Present so its absence is explicit, not implied. */
  readonly replacementKeyReference: null;
}

export interface SameKeyRenewalPreflightOutcome {
  readonly outcome: "RESERVED" | "REPLAYED" | "REFUSED";
  readonly reservation?: SameKeyRenewalReservation;
  readonly refusalCode?: SameKeyRenewalRefusalCode;
  /** The underlying reason, preserved verbatim. Never flattened. */
  readonly detail?: string;
  /** Set when the refusal means RECOVERY rather than renewal. */
  readonly requiresRecovery?: boolean;
  readonly daysRemaining?: number;
  readonly diagnostics?: SameKeyRenewalDiagnostics;
}

// ---------------------------------------------------------------------------
// The preflight
// ---------------------------------------------------------------------------

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs the same-key renewal preflight and, if every gate passes, reserves the
 * renewal in the database.
 *
 * ORDER IS THE OWNER'S and is load-bearing:
 *
 *   trusted time -> incumbent selection -> chain -> signature -> purpose ->
 *   environment -> device/key binding -> validity window -> revocation ->
 *   generation -> eligibility -> provider key -> reservation
 *
 * Nothing is reserved until the incumbent has verified. A reservation made
 * against an unverified credential would be a database row asserting that a
 * renewal of something trustworthy is under way, which is the exact claim this
 * ordering refuses to make on faith.
 */
export async function prepareSameKeyCredentialRenewal(
  input: SameKeyRenewalPreflightInput,
  repository: IncumbentCredentialRepository,
  gateway: RenewalReservationGateway,
): Promise<SameKeyRenewalPreflightOutcome> {
  const refuse = (
    refusalCode: SameKeyRenewalRefusalCode,
    detail: string,
    extra: Partial<SameKeyRenewalPreflightOutcome> = {},
  ): SameKeyRenewalPreflightOutcome => ({
    outcome: "REFUSED",
    refusalCode,
    detail,
    ...extra,
  });

  const scope: RenewalScope = {
    deviceRecordId: input.deviceRecordId,
    environment: input.environment,
    purpose: input.purpose,
  };

  // -- 1. TRUSTED TIME ------------------------------------------------------
  // Before anything else, and only `trusted` counts. `uninitialized` is not
  // restricted but is not trusted either, and RV-TT-001 lived in that gap.
  if (isRestricted(input.trustedTime.status)) {
    return refuse(
      "RENEWAL_PREFLIGHT_RESTRICTED_TRUST_MODE",
      `renewal preflight is blocked in restricted trust mode (${input.trustedTime.status})`,
    );
  }
  const now = trustedInstant(input.trustedTime);
  if (now === null) {
    return refuse(
      "RENEWAL_PREFLIGHT_NO_TRUSTED_TIME",
      `no trusted time is established (status ${input.trustedTime.status})`,
    );
  }

  // The purpose is PINNED, matching the `purpose = 'device_identity'` CHECK on
  // every credential table. It is stated here rather than left to
  // `evaluateCertificateValidity`, which verifies the chain against
  // device_identity unconditionally — so a caller asking to renew a
  // transport-signing credential would otherwise have had a device-identity
  // chain verified on its behalf and never learn the purposes differed.
  if (input.purpose !== DEVICE_CERTIFICATE_PURPOSE) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_PURPOSE",
      `this preflight renews ${DEVICE_CERTIFICATE_PURPOSE} credentials; ${input.purpose} is not renewable here`,
    );
  }

  // -- 2. THE INCUMBENT, DERIVED FROM THE HEAD ------------------------------
  const head = await repository.loadCredentialHead(scope);
  if (head === null) {
    return refuse(
      "RENEWAL_PREFLIGHT_NO_CREDENTIAL_HEAD",
      "no credential head exists for this device, environment and purpose; there is nothing to renew",
    );
  }
  if (head.deviceRecordId !== input.deviceRecordId) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_DEVICE",
      "the credential head belongs to another device",
    );
  }
  if (head.environment !== input.environment) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_ENVIRONMENT",
      `the credential head is for ${head.environment}`,
    );
  }
  if (head.purpose !== input.purpose) {
    return refuse("RENEWAL_PREFLIGHT_WRONG_PURPOSE", `the credential head is for ${head.purpose}`);
  }
  if (
    input.expectedCredentialHeadVersion !== undefined &&
    input.expectedCredentialHeadVersion !== head.version
  ) {
    return refuse(
      "RENEWAL_PREFLIGHT_STALE_HEAD_VERSION",
      `the caller observed head version ${input.expectedCredentialHeadVersion}, the head is at ${head.version}`,
    );
  }

  const incumbent = await repository.loadCredentialAtGeneration(scope, head.currentGeneration);
  if (incumbent === null) {
    return refuse(
      "RENEWAL_PREFLIGHT_NO_CURRENT_CREDENTIAL",
      `the head points at generation ${head.currentGeneration} but no credential exists there`,
    );
  }

  // The caller's belief is COMPARED against what the head resolved to. It was
  // never used to fetch anything, so a caller naming an older issued credential
  // is refused here rather than silently renewing the wrong generation.
  if (
    input.assertedCurrentCredentialId !== undefined &&
    input.assertedCurrentCredentialId !== incumbent.credentialId
  ) {
    return refuse(
      "RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT",
      "the nominated credential is not the one the credential head points at",
    );
  }

  if (incumbent.deviceRecordId !== input.deviceRecordId) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_DEVICE",
      "the current credential was issued for another device",
    );
  }
  if (incumbent.environment !== input.environment) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_ENVIRONMENT",
      `the current credential is for ${incumbent.environment}`,
    );
  }
  if (incumbent.purpose !== input.purpose) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_PURPOSE",
      `the current credential is for purpose ${incumbent.purpose}`,
    );
  }
  if (incumbent.certificateGeneration !== head.currentGeneration) {
    return refuse(
      "RENEWAL_PREFLIGHT_GENERATION_MISMATCH",
      `credential generation ${incumbent.certificateGeneration} does not match head generation ${head.currentGeneration}`,
    );
  }
  if (incumbent.assignmentGeneration !== input.currentAssignmentGeneration) {
    return refuse(
      "RENEWAL_PREFLIGHT_STALE_ASSIGNMENT_GENERATION",
      `the device was reassigned (${incumbent.assignmentGeneration} -> ${input.currentAssignmentGeneration}) since the current credential`,
    );
  }

  // -- 3. THE STORED CHAIN --------------------------------------------------
  const links = await repository.loadCredentialChainLinks(incumbent.credentialId);
  const chain = buildChainFromStoredLinks(links);
  if (chain === null) {
    return refuse(
      "RENEWAL_PREFLIGHT_INCOMPLETE_CHAIN",
      `credential ${incumbent.credentialId} does not have a complete, parseable root -> intermediate -> device chain`,
    );
  }

  // -- 4. REAL VERIFICATION -------------------------------------------------
  // `state = 'issued'`, the row's existence and its issuance audit are all
  // bookkeeping. None of them is passed to the verifier as evidence, and none
  // of them can substitute for the curve maths below.
  const revocations = await repository.loadRevocationState(scope, incumbent.serialNumber);

  const validity = evaluateCertificateValidity({
    chain,
    trustedTime: input.trustedTime,
    environment: input.environment,
    deviceRecordId: input.deviceRecordId,
    // The credential must attest to the key RECORDED AGAINST IT. Whether the
    // provider still holds that key is a separate question, asked below with
    // its own refusal code.
    currentKeyFingerprint: incumbent.publicKeyFingerprint,
    currentCertificateGeneration: head.currentGeneration,
    revocations: revocationLookup(incumbent, revocations),
    trustedRootFingerprints: input.trustedRootFingerprints,
  });

  if (!validity.valid) {
    const rejectionCode = validity.rejectionCode ?? "CERT_CHAIN_INVALID";
    // §5.4 order is preserved by the verifier itself: a credential that is BOTH
    // revoked and expired reports CERT_REVOKED, and that survives this mapping.
    const requiresRecovery = rejectionCode === "CERT_REVOKED" || rejectionCode === "CERT_EXPIRED";
    return refuse(
      VERIFICATION_REFUSAL_CODES[rejectionCode],
      `${rejectionCode}: ${validity.detail ?? "the incumbent credential did not verify"}`,
      requiresRecovery ? { requiresRecovery: true } : {},
    );
  }

  const verifiedTbs = chain.device.tbs;

  // The SIGNED purpose, compared against the requested one. Unreachable while
  // the pin above holds, and kept because the guarantee should not depend on
  // that pin never being relaxed.
  if (verifiedTbs.purpose !== input.purpose) {
    return refuse(
      "RENEWAL_PREFLIGHT_WRONG_PURPOSE",
      `the signed credential is for purpose ${verifiedTbs.purpose}, not ${input.purpose}`,
    );
  }

  const diagnostics: SameKeyRenewalDiagnostics = {
    credentialKind: validity.credentialKind,
    evaluatedAtTrustedTime: validity.evaluatedAt ?? now,
    incumbentExpiresAt: validity.expiresAt ?? new Date(verifiedTbs.notAfter),
    consumersMustReVerifyAtAuthenticationBoundary: true,
  };

  // -- 5. ELIGIBILITY -------------------------------------------------------
  // Judged on the SIGNED structure, not on the row: the window that matters is
  // the one inside the bytes that verified.
  const eligibility = evaluateRenewalEligibility({
    certificate: credentialView(verifiedTbs),
    trustedTime: input.trustedTime,
    environment: input.environment,
    deviceRecordId: input.deviceRecordId,
    revocations: revocationLookup(incumbent, revocations),
    existingOverlapDays: input.existingOverlapDays ?? 0,
    // Reuse is a supported MODE, not an exception granted to this call.
    // Migration 0129 withdrew the rotation mandate; nothing here re-invents it.
    approvedKeyReusePolicy: true,
  });

  if (!eligibility.eligible) {
    const detail = eligibility.detail ?? "renewal is not permitted";
    switch (eligibility.refusalCode) {
      case "RENEWAL_TOO_EARLY":
        // Outside the window is a POLICY ANSWER, not an internal error.
        return refuse("RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW", detail, {
          daysRemaining: eligibility.daysRemaining,
          diagnostics,
        });
      case "RENEWAL_CERTIFICATE_REVOKED":
        return refuse("RENEWAL_PREFLIGHT_CREDENTIAL_REVOKED", detail, {
          requiresRecovery: true,
          diagnostics,
        });
      case "RENEWAL_CERTIFICATE_EXPIRED":
        return refuse("RENEWAL_PREFLIGHT_CREDENTIAL_EXPIRED", detail, {
          requiresRecovery: true,
          daysRemaining: eligibility.daysRemaining,
          diagnostics,
        });
      case "RENEWAL_OVERLAP_EXCEEDED":
        return refuse("RENEWAL_PREFLIGHT_OVERLAP_EXCEEDED", detail, {
          daysRemaining: eligibility.daysRemaining,
          diagnostics,
        });
      case "RENEWAL_WRONG_DEVICE":
        return refuse("RENEWAL_PREFLIGHT_WRONG_DEVICE", detail, { diagnostics });
      case "RENEWAL_RESTRICTED_TRUST_MODE":
        return refuse("RENEWAL_PREFLIGHT_RESTRICTED_TRUST_MODE", detail);
      default:
        return refuse("RENEWAL_PREFLIGHT_NO_TRUSTED_TIME", detail);
    }
  }

  // -- 6. THE PROVIDER KEY THIS RENEWAL WILL REUSE --------------------------
  // `reuse_current_key` means the device keeps the key it already holds, so
  // that key has to actually be there, be active, and be the one the incumbent
  // credential attests to. No key is generated, and none is required.
  const providerKey = await repository.loadCurrentProviderKey(scope);
  if (providerKey === null) {
    return refuse(
      "RENEWAL_PREFLIGHT_PROVIDER_KEY_MISSING",
      "no provider key is registered for this device, environment and purpose; reuse_current_key has nothing to reuse",
      { diagnostics },
    );
  }
  if (
    providerKey.deviceRecordId !== input.deviceRecordId ||
    providerKey.environment !== input.environment ||
    providerKey.purpose !== input.purpose
  ) {
    return refuse(
      "RENEWAL_PREFLIGHT_PROVIDER_KEY_WRONG_SCOPE",
      "the provider key belongs to another device, environment or purpose",
      { diagnostics },
    );
  }
  if (providerKey.state !== "active") {
    return refuse(
      "RENEWAL_PREFLIGHT_PROVIDER_KEY_NOT_ACTIVE",
      `the current provider key is ${providerKey.state}; only an active key may be reused`,
      { diagnostics },
    );
  }
  if (providerKey.publicKeyFingerprint !== incumbent.publicKeyFingerprint) {
    return refuse(
      "RENEWAL_PREFLIGHT_PROVIDER_KEY_FINGERPRINT_MISMATCH",
      "the active provider key is not the key the incumbent credential attests to",
      { diagnostics },
    );
  }
  // Belt and braces: the verified structure must agree too. If these ever
  // diverge, the row and the signed bytes disagree about the subject key.
  if (verifiedTbs.subjectFingerprint !== providerKey.publicKeyFingerprint) {
    return refuse(
      "RENEWAL_PREFLIGHT_PROVIDER_KEY_FINGERPRINT_MISMATCH",
      "the verified credential attests to a key the provider does not hold",
      { diagnostics },
    );
  }

  // -- 7. THE GOVERNED RESERVATION ------------------------------------------
  // Built by the DATABASE. Nothing above allocated an attempt id, a next
  // generation or a head version, and nothing below invents one.
  let reserved: ReservedRenewalRow;
  try {
    reserved = await gateway.reserveRenewal({
      deviceRecordId: input.deviceRecordId,
      environment: input.environment,
      purpose: input.purpose,
      idempotencyKey: input.idempotencyKey,
      trustedTime: now,
      trustedTimeStatus: input.trustedTime.status,
      renewalMode: SAME_KEY_RENEWAL_MODE,
      actorRef: input.actorRef,
    });
  } catch (error) {
    const detail = errorText(error);
    const mapped = DATABASE_REFUSAL_CODES.find(([marker]) => detail.includes(marker));
    return refuse(mapped?.[1] ?? "RENEWAL_PREFLIGHT_RESERVATION_REFUSED", detail, { diagnostics });
  }

  // The database froze the mode. A caller cannot change it, and this preflight
  // will not report success against a reservation that says something else.
  if (reserved.renewalMode !== SAME_KEY_RENEWAL_MODE) {
    return refuse(
      "RENEWAL_PREFLIGHT_RESERVATION_MODE_MISMATCH",
      `the database reserved mode ${reserved.renewalMode}, not ${SAME_KEY_RENEWAL_MODE}`,
      { diagnostics },
    );
  }
  if (reserved.nextCredentialGeneration !== reserved.currentCredentialGeneration + 1) {
    return refuse(
      "RENEWAL_PREFLIGHT_RESERVATION_GENERATION_UNEXPECTED",
      `the reservation targets generation ${reserved.nextCredentialGeneration} from ${reserved.currentCredentialGeneration}`,
      { diagnostics },
    );
  }
  if (reserved.currentCredentialId !== incumbent.credentialId) {
    return refuse(
      "RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT",
      "the database reserved against a different incumbent credential than the one that verified",
      { diagnostics },
    );
  }
  if (reserved.replacementKeyReference !== undefined && reserved.replacementKeyReference !== null) {
    return refuse(
      "RENEWAL_PREFLIGHT_RESERVATION_CARRIES_REPLACEMENT_KEY",
      "a reuse_current_key reservation must carry no replacement key reference",
      { diagnostics },
    );
  }

  return {
    outcome: reserved.outcome === "REPLAYED_RESERVATION" ? "REPLAYED" : "RESERVED",
    daysRemaining: eligibility.daysRemaining,
    diagnostics,
    reservation: {
      renewalAttemptId: reserved.renewalAttemptId,
      renewalMode: SAME_KEY_RENEWAL_MODE,
      deviceRecordId: input.deviceRecordId,
      currentCredentialId: reserved.currentCredentialId,
      currentCredentialGeneration: reserved.currentCredentialGeneration,
      nextCredentialGeneration: reserved.nextCredentialGeneration,
      credentialHeadVersion: reserved.credentialHeadVersion,
      assignmentGeneration: reserved.assignmentGeneration,
      environment: input.environment,
      purpose: input.purpose,
      currentPublicKeyFingerprint: providerKey.publicKeyFingerprint,
      currentKeyGeneration: providerKey.keyGeneration ?? providerKey.generation,
      reservationStatus: reserved.status,
      replacementKeyReference: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rebuilds a verifiable chain from the STORED links.
 *
 * Every link is parsed from its canonical bytes and must round-trip; a link
 * that does not is treated as absent rather than repaired. The device link's
 * position is not assumed from ordering — the role is read from the row, so a
 * chain with two intermediates and no device is refused rather than
 * mis-assembled.
 */
export function buildChainFromStoredLinks(
  links: readonly StoredChainLink[],
): CertificateChain | null {
  const byRole = new Map<string, StoredChainLink>();
  for (const link of links) {
    // A duplicate role is ambiguous, and picking one would be a guess.
    if (byRole.has(link.role)) return null;
    byRole.set(link.role, link);
  }

  const root = byRole.get("root");
  const intermediate = byRole.get("intermediate");
  const device = byRole.get("device");
  if (root === undefined || intermediate === undefined || device === undefined) return null;

  const rootTbs = tbsFromCanonicalBytes(root.canonicalTbs);
  const intermediateTbs = tbsFromCanonicalBytes(intermediate.canonicalTbs);
  const deviceTbs = tbsFromCanonicalBytes(device.canonicalTbs);
  if (rootTbs === null || intermediateTbs === null || deviceTbs === null) return null;

  return {
    root: { tbs: rootTbs, signature: root.detachedSignature },
    intermediate: { tbs: intermediateTbs, signature: intermediate.detachedSignature },
    device: { tbs: deviceTbs, signature: device.detachedSignature },
  };
}

/**
 * Revocation facts, from the credential row AND the revocation state.
 *
 * `state = 'revoked'` on the row counts as revoked even if the revocation
 * snapshot has not caught up: a locally known revocation is enforced
 * immediately (§6.1), and waiting for a snapshot would be a fail-open.
 */
function revocationLookup(
  incumbent: IncumbentCredentialRecord,
  state: RevocationStateRecord,
): RevocationLookup {
  const credentialRevoked =
    state.credentialRevoked || incumbent.state === "revoked" || incumbent.revokedAt !== null;
  return {
    isCertificateRevoked: (serial) => credentialRevoked && serial === incumbent.serialNumber,
    isDeviceRevoked: (deviceRecordId) =>
      state.deviceRevoked && deviceRecordId === incumbent.deviceRecordId,
  };
}

/** Re-exported so callers name the purpose the same way issuance does. */
export const SAME_KEY_RENEWAL_PURPOSE: SigningPurpose = DEVICE_CERTIFICATE_PURPOSE;
