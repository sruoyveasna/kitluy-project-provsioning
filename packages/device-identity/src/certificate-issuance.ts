/**
 * Development certificate issuance — WS-11-T003 Step 4.
 *
 * Authority: KLD-2026-07-28-002 §4, §5, §12.6; the owner's Step 4 instruction.
 *
 * DEVELOPMENT ONLY. Pilot and production issuance stay BLOCKED (§14) and this
 * module refuses both environments outright rather than deferring to a
 * configuration that could later be filled in.
 *
 * Issuance is decided against TRUSTED TIME. No host clock appears here.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { RequiredCryptographicValueError } from "./errors.js";
import { CERTIFICATE_WINDOWS, isRestricted, type TrustedTimeEvaluation } from "./trusted-time.js";
import type { HardwareTrustLevel } from "./index.js";
import {
  DEV_SIGNATURE_ALGORITHM,
  verifyDetachedSignature,
  type Certificate,
  type CertificateChain,
  type DevelopmentCertificateAuthority,
} from "./dev-crypto.js";

const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface DeviceCertificateRequest {
  readonly requestId: string;
  readonly deviceRecordId: string;
  readonly environment: string;
  readonly devicePublicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly hardwareTrustLevel: HardwareTrustLevel;
  readonly assignmentGeneration: number;
  readonly requestedPurpose: string;
  /** Trusted time at request. Not a host clock. */
  readonly requestedAt: Date;
  readonly nonce: string;
  readonly correlationId: string;
  /** Signature over the canonical request bytes, made with the DEVICE key. */
  readonly proofOfPossession: Uint8Array;
  /** Set only by a caller claiming production eligibility. Always refused. */
  readonly requestsProductionEligibility?: boolean;
}

/** Canonical bytes the device signs to prove it holds the private key. */
export function requestBytes(request: DeviceCertificateRequest): Uint8Array {
  return Buffer.from(
    [
      "kitluy.csr.v1",
      request.requestId,
      request.deviceRecordId,
      request.environment,
      request.publicKeyFingerprint,
      request.hardwareTrustLevel,
      String(request.assignmentGeneration),
      request.requestedPurpose,
      request.requestedAt.toISOString(),
      request.nonce,
      request.correlationId,
    ].join("\n"),
    "utf8",
  );
}

/** Deterministic idempotency key: same request payload, same key. */
export function requestIdempotencyKey(request: DeviceCertificateRequest): string {
  return createHash("sha256")
    .update(Buffer.from(requestBytes(request)))
    .digest("hex");
}

export type IssuanceRefusalCode =
  | "ISSUE_NO_TRUSTED_TIME"
  | "ISSUE_RESTRICTED_TRUST_MODE"
  | "ISSUE_ENVIRONMENT_BLOCKED"
  | "ISSUE_WRONG_ENVIRONMENT"
  | "ISSUE_WRONG_DEVICE"
  | "ISSUE_UNSUPPORTED_PURPOSE"
  | "ISSUE_FINGERPRINT_MISMATCH"
  | "ISSUE_PROOF_OF_POSSESSION_FAILED"
  | "ISSUE_STALE_ASSIGNMENT_GENERATION"
  | "ISSUE_DEVICE_STATE"
  | "ISSUE_OPEN_TRUST_INCIDENT"
  | "ISSUE_PKI_INACTIVE"
  | "ISSUE_PRODUCTION_ELIGIBILITY_REFUSED"
  | "ISSUE_DUPLICATE_REQUEST_DIFFERENT_PAYLOAD"
  | "ISSUE_PERSISTENCE_FAILED";

export interface IssuanceContext {
  readonly request: DeviceCertificateRequest;
  readonly trustedTime: TrustedTimeEvaluation;
  readonly environment: TrustEnvironment;
  readonly deviceRecordId: string;
  readonly deviceLifecycleState: string;
  readonly currentAssignmentGeneration: number;
  readonly openBlockingIncidentCount: number;
  readonly pkiConfigurationActive: boolean;
  /** The next certificate generation for this device. */
  readonly nextCertificateGeneration: number;
}

export interface IssuedCertificate {
  readonly certificate: Certificate;
  readonly chain: CertificateChain;
  readonly idempotencyKey: string;
  readonly certificateGeneration: number;
}

export interface IssuanceOutcome {
  readonly outcome: "ISSUED" | "REFUSED" | "REPLAYED";
  readonly issued?: IssuedCertificate;
  readonly refusalCode?: IssuanceRefusalCode;
  readonly detail?: string;
  /**
   * Set when the CA signed but persistence failed. The signature EXISTS in the
   * world and is not accounted for, which is a security event in its own right
   * — silently retrying would mint a second valid certificate for one request.
   */
  readonly orphanSignatureIncident?: {
    readonly idempotencyKey: string;
    readonly serialNumber: string;
    readonly detail: string;
  };
}

/**
 * What issuance must persist, atomically with its audit. Implemented by the
 * caller; `persist` throwing is what produces an orphan-signature incident.
 */
export interface IssuanceStore {
  /** Returns a prior result for this idempotency key, or null. */
  findByIdempotencyKey(key: string): Promise<IssuedCertificate | null>;
  /** A prior request with the same requestId but a DIFFERENT payload. */
  hasConflictingRequest(requestId: string, idempotencyKey: string): Promise<boolean>;
  /** Certificate metadata AND issuance audit, in one transaction. */
  persist(input: IssuedCertificate & { request: DeviceCertificateRequest }): Promise<void>;
}

/**
 * Issues a development device certificate.
 *
 * Every gate is checked BEFORE the CA is asked to sign, so a refusal never
 * produces a signature. The single exception is persistence failure, which by
 * definition happens after signing — and that path is reported as an orphan
 * signature rather than swallowed.
 */
export async function issueDevelopmentCertificate(
  context: IssuanceContext,
  ca: DevelopmentCertificateAuthority,
  store: IssuanceStore,
  verifyProof: (
    publicKeyPem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): Promise<IssuanceOutcome> {
  const r = context.request;
  const refuse = (refusalCode: IssuanceRefusalCode, detail: string): IssuanceOutcome => ({
    outcome: "REFUSED",
    refusalCode,
    detail,
  });

  // Pilot and production are refused HERE, not delegated to a configuration
  // lookup that a later row could satisfy.
  if (context.environment !== "development") {
    throw new RequiredCryptographicValueError(
      `an approved ${context.environment} certificate authority — KLD-2026-07-28-002 §14 leaves ${context.environment} issuance BLOCKED`,
      context.environment,
    );
  }

  if (isRestricted(context.trustedTime.status)) {
    return refuse(
      "ISSUE_RESTRICTED_TRUST_MODE",
      `issuance is blocked in restricted trust mode (${context.trustedTime.status})`,
    );
  }
  if (context.trustedTime.status !== "trusted" || context.trustedTime.trustedTime === null) {
    return refuse("ISSUE_NO_TRUSTED_TIME", "no trusted time is established");
  }
  const now = context.trustedTime.trustedTime;

  if (r.requestsProductionEligibility === true) {
    // §4. A software-backed key can never be production-eligible, and asking is
    // itself the finding.
    return refuse(
      "ISSUE_PRODUCTION_ELIGIBILITY_REFUSED",
      "a development software-backed key requested production eligibility; §4 refuses it and certified_hardware_skus is empty",
    );
  }
  if (r.environment !== context.environment) {
    return refuse("ISSUE_WRONG_ENVIRONMENT", `request is for ${r.environment}`);
  }
  if (r.deviceRecordId !== context.deviceRecordId) {
    return refuse("ISSUE_WRONG_DEVICE", "request names another device");
  }
  if (r.requestedPurpose !== "device_identity") {
    return refuse(
      "ISSUE_UNSUPPORTED_PURPOSE",
      `purpose ${r.requestedPurpose} is not issuable here`,
    );
  }
  if (r.assignmentGeneration !== context.currentAssignmentGeneration) {
    return refuse(
      "ISSUE_STALE_ASSIGNMENT_GENERATION",
      `request carries generation ${r.assignmentGeneration}, device is at ${context.currentAssignmentGeneration}`,
    );
  }
  if (context.deviceLifecycleState !== "awaiting_trust") {
    return refuse(
      "ISSUE_DEVICE_STATE",
      `device is ${context.deviceLifecycleState}; only awaiting_trust is issuable`,
    );
  }
  if (context.openBlockingIncidentCount > 0) {
    return refuse(
      "ISSUE_OPEN_TRUST_INCIDENT",
      `${context.openBlockingIncidentCount} unresolved blocking trust incident(s)`,
    );
  }
  if (!context.pkiConfigurationActive) {
    return refuse("ISSUE_PKI_INACTIVE", "no active development PKI configuration");
  }

  const idempotencyKey = requestIdempotencyKey(r);

  // Idempotency BEFORE proof-of-possession: a replay of an identical request
  // must return the SAME certificate, not mint a second one.
  const prior = await store.findByIdempotencyKey(idempotencyKey);
  if (prior !== null) {
    return { outcome: "REPLAYED", issued: prior, idempotencyKey } as IssuanceOutcome;
  }
  if (await store.hasConflictingRequest(r.requestId, idempotencyKey)) {
    return refuse(
      "ISSUE_DUPLICATE_REQUEST_DIFFERENT_PAYLOAD",
      `request id ${r.requestId} was already used with a different payload`,
    );
  }

  // PROOF OF POSSESSION. The fingerprint must match the presented key AND the
  // signature must verify under it — the first alone proves nothing, since a
  // fingerprint is public.
  const { publicKeyFingerprint } = await import("./dev-crypto.js");
  if (publicKeyFingerprint(r.devicePublicKeyPem) !== r.publicKeyFingerprint) {
    return refuse(
      "ISSUE_FINGERPRINT_MISMATCH",
      "the declared fingerprint does not match the presented public key",
    );
  }
  if (!verifyProof(r.devicePublicKeyPem, requestBytes(r), r.proofOfPossession)) {
    return refuse(
      "ISSUE_PROOF_OF_POSSESSION_FAILED",
      "the request signature does not verify under the presented public key",
    );
  }

  // Every gate has passed. Only now is the CA asked to sign.
  const window = CERTIFICATE_WINDOWS.development;
  const notAfter = new Date(now.getTime() + window.certificateLifetimeDays * MS_PER_DAY);
  const serialNumber = `DEV-${idempotencyKey.slice(0, 16).toUpperCase()}`;

  const certificate = ca.issueDeviceCertificate({
    deviceRecordId: r.deviceRecordId,
    subjectPublicKeyPem: r.devicePublicKeyPem,
    subjectFingerprint: r.publicKeyFingerprint,
    hardwareTrustLevel: r.hardwareTrustLevel,
    certificateGeneration: context.nextCertificateGeneration,
    notBefore: now,
    notAfter,
    serialNumber,
    certificateId: idempotencyKey.slice(0, 32),
  });

  const issued: IssuedCertificate = {
    certificate,
    chain: {
      root: ca.rootCertificate,
      intermediate: ca.intermediateCertificate,
      device: certificate,
    },
    idempotencyKey,
    certificateGeneration: context.nextCertificateGeneration,
  };

  try {
    await store.persist({ ...issued, request: r });
  } catch (error) {
    // The signature exists and is unaccounted for. Reported, never retried
    // here: a silent retry would produce two valid certificates for one
    // request, and the operator needs to know a signature is loose.
    return {
      outcome: "REFUSED",
      refusalCode: "ISSUE_PERSISTENCE_FAILED",
      detail: "the CA signed but certificate metadata and audit did not commit",
      orphanSignatureIncident: {
        idempotencyKey,
        serialNumber,
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }

  return { outcome: "ISSUED", issued };
}

export const DEVELOPMENT_ISSUANCE_ALGORITHM = DEV_SIGNATURE_ALGORITHM;
