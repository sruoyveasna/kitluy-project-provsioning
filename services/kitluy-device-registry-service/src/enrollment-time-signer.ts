/**
 * Mints the signed trusted-time token a freshly enrolled device receives.
 *
 * Authority:
 *   KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2).
 *   KLD-2026-07-28-002 §12 (trusted time) and ballot item 7 (purpose separation).
 *
 * ===========================================================================
 * ONE SIGNER IMPLEMENTATION, A DIFFERENT KEY
 * ===========================================================================
 * The Ed25519 signing implementation, its key-custody rules and its
 * fail-closed default all live in `snapshot-signer.ts` and are REUSED here
 * unchanged. This module supplies only two things that must differ:
 *
 *   1. a DISTINCT key, because BLK-005 ballot item 7 requires purpose
 *      separation and `pki_trust_configuration` enforces it structurally —
 *      `configuration_signing_key_reference`, `release_signing_key_reference`
 *      and `transport_signing_key_reference` are constrained to be different
 *      values. A time assertion is transport-layer trust, so the DATABASE
 *      authority for this key is `transport_signing_key_reference`;
 *   2. distinct canonical bytes, from `@kitluy/device-identity`, whose kind
 *      string leads the signed material so a token signature can never be
 *      replayed as a snapshot or discovery signature.
 *
 * The private key is read from the process environment BY NAME at the moment
 * of signing and dropped when the call returns. It is never a parameter, a
 * return value, a log field or an error message — those rules are stated once,
 * in `snapshot-signer.ts`, and this module inherits them by reusing it.
 *
 * ===========================================================================
 * NO UNSIGNED FALLBACK
 * ===========================================================================
 * A deployment with no key reference cannot mint a token, and therefore cannot
 * enroll a device past the point where trusted time is required. That is the
 * intended failure: an unsigned "temporary" time assertion a device accepted
 * would be one an attacker could also mint, and it would set the monotonic
 * floor that every certificate window is later judged against.
 */
import { randomUUID } from "node:crypto";

import { ConfigError, type Env } from "@kitluy/shared-config";
import {
  ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS,
  enrollmentTimeTokenBytes,
  findEnrollmentTokenSeparatorInjection,
  type EnrollmentTimeToken,
  type SnapshotSignatureEnvelope,
  type SnapshotSigner,
  type SnapshotSigningKeyReference,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { SnapshotSignerUnavailableError } from "./snapshot-signer.js";

/**
 * Environment variables naming the ENROLLMENT TIME key.
 *
 * Deliberately not the snapshot variables. Sharing them would defeat the
 * purpose separation the PKI configuration enforces in the database, and would
 * mean a rotation of one purpose silently rotated the other.
 */
export const ENROLLMENT_TIME_SIGNING_KEY_ENV = "DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ENV" as const;
export const ENROLLMENT_TIME_SIGNING_KEY_ID = "DEVICE_ENROLLMENT_TIME_SIGNING_KEY_ID" as const;
export const ENROLLMENT_TIME_SIGNING_KEY_VERSION =
  "DEVICE_ENROLLMENT_TIME_SIGNING_KEY_VERSION" as const;

/** Who the device expects to have minted its token. */
export const ENROLLMENT_TIME_TOKEN_ISSUER = "kitluy.cloud.device-registry" as const;

export function resolveEnrollmentTimeSigningKeyReference(
  env: Env = process.env,
): SnapshotSigningKeyReference | null {
  const secretEnvVar = env[ENROLLMENT_TIME_SIGNING_KEY_ENV]?.trim() ?? "";
  const keyId = env[ENROLLMENT_TIME_SIGNING_KEY_ID]?.trim() ?? "";
  const rawVersion = env[ENROLLMENT_TIME_SIGNING_KEY_VERSION]?.trim() ?? "";
  if (secretEnvVar === "" || keyId === "") return null;

  const keyVersion = Number(rawVersion);
  if (!Number.isInteger(keyVersion) || keyVersion < 1) {
    // Absent or nonsense is a MISCONFIGURATION, not a default. Signing as
    // version 1 would let a rotated key masquerade as its predecessor and keep
    // verifying against the wrong public half.
    throw new ConfigError(
      ENROLLMENT_TIME_SIGNING_KEY_VERSION,
      `${ENROLLMENT_TIME_SIGNING_KEY_VERSION} must be a positive integer naming the key version.`,
    );
  }
  return { secretEnvVar, keyId, keyVersion };
}

export interface MintedEnrollmentTimeToken {
  readonly token: EnrollmentTimeToken;
  readonly signature: SnapshotSignatureEnvelope;
}

export interface MintEnrollmentTimeTokenRequest {
  /** The device the enrollment just created. The token is welded to it. */
  readonly deviceRecordId: string;
  /** The enrollment exchange that produced it, so a token cannot outlive its enrollment. */
  readonly challengeId: string;
  readonly environment: TrustEnvironment;
}

/**
 * Mints and signs one device-bound time token.
 *
 * `now` is injected rather than read from the clock so a test can prove the
 * window arithmetic without waiting, and so the authoritative instant is a
 * decision of the caller — the service — rather than a hidden side effect here.
 */
export async function mintEnrollmentTimeToken(
  request: MintEnrollmentTimeTokenRequest,
  signer: SnapshotSigner,
  keyReference: SnapshotSigningKeyReference | null,
  now: Date,
): Promise<MintedEnrollmentTimeToken> {
  if (keyReference === null) {
    throw new SnapshotSignerUnavailableError(
      `no enrollment-time signing key is configured (${ENROLLMENT_TIME_SIGNING_KEY_ENV})`,
    );
  }

  const token: EnrollmentTimeToken = {
    protocolVersion: "1",
    issuer: ENROLLMENT_TIME_TOKEN_ISSUER,
    deviceRecordId: request.deviceRecordId,
    challengeId: request.challengeId,
    environment: request.environment,
    issuedAt: now,
    expiresAt: new Date(now.getTime() + ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS * 1000),
  };

  // Refuse to SIGN ambiguous bytes, not merely to verify them. A signature over
  // an encoding that two different tokens share would be valid for both, and the
  // device-side check would then be verifying something we should never have
  // minted.
  const injected = findEnrollmentTokenSeparatorInjection(token);
  if (injected !== null) {
    throw new ConfigError(
      "enrollment-time-token",
      `field ${injected} contains a line separator and cannot be canonically encoded`,
    );
  }

  const signature = await signer.signCanonicalSnapshot(
    enrollmentTimeTokenBytes(token),
    keyReference,
  );
  return { token, signature };
}

/** The shipped default. Refuses, so nothing can enroll past trusted time unsigned. */
export function createUnavailableEnrollmentTimeSigner(reason: string): SnapshotSigner {
  return {
    signCanonicalSnapshot(): Promise<SnapshotSignatureEnvelope> {
      return Promise.reject(new SnapshotSignerUnavailableError(reason));
    },
  };
}

/**
 * A correlation id for one mint, for the audit trail. Exported so the route and
 * the signer agree on the shape rather than each inventing one.
 */
export function enrollmentTimeCorrelationId(): string {
  return randomUUID();
}
