/**
 * The signed trusted-time token a freshly enrolled device receives.
 *
 * Authority:
 *   KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2) — flash-time ticket + PoP.
 *   KLD-2026-07-28-002 §12 — the owner-fixed trusted-time model.
 *   KLSRC-0162 §4, §34 — automatic enrollment; nothing secret in the image.
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHY IT IS ISSUED WHEN IT IS
 * ===========================================================================
 * `issue_device_certificate_v1` calls `assert_trusted_time_v1`, so a device
 * cannot obtain a certificate until it has established a trusted-time floor.
 * The canonical model accepts three sources (RTC, authenticated network,
 * signed cloud token). A factory-fresh Raspberry Pi has none of them: the BOM
 * carries no RTC battery, and the image ships `systemd-timesyncd`, which is
 * plain SNTP and therefore NOT an authenticated source.
 *
 * This token is the third source, and it is minted at ENROLLMENT REDEMPTION —
 * never at the challenge step. That ordering is forced by the schema, not
 * chosen for convenience:
 *
 *     kitluy_devices.device_trusted_time.device_id
 *       uuid primary key REFERENCES kitluy_devices.devices (id)
 *
 * No device row exists until `enroll_device_v1` returns, so no floor can be
 * attached to anything earlier. A token minted at challenge time would also
 * have no device to name, and a device-unbound time token is replayable across
 * every device that receives one.
 *
 * ===========================================================================
 * WHAT THE SIGNATURE BINDS
 * ===========================================================================
 * The kind string leads the canonical bytes, so a signature over a token can
 * never be replayed as a signature over an edge-discovery record or a
 * revocation snapshot even under the same key — domain separation is part of
 * the signed material, not a convention.
 *
 * `deviceRecordId` binds the token to ONE device. `challengeId` binds it to the
 * ONE enrollment exchange that produced that device, so a token captured from a
 * previous enrollment of the same device is refused too.
 *
 * ===========================================================================
 * WHAT A DEVICE HOLDS
 * ===========================================================================
 * Public verification material only. The signing private key lives in the cloud
 * service environment and is never written to an image, a database row, a log
 * line or an error message — see `snapshot-signer.ts`, whose custody rules this
 * module reuses rather than restates.
 */
import { createHash, verify as nodeVerify, createPublicKey } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import {
  SNAPSHOT_SIGNATURE_ALGORITHM,
  type SnapshotSignatureEnvelope,
  type TrustedSnapshotKey,
} from "./snapshot-signing.js";

/** Domain separator. Leads the canonical bytes; see the header. */
export const ENROLLMENT_TIME_TOKEN_KIND = "kitluy.enrollment-time-token.v1" as const;

/**
 * How long a token may be offered as a time source.
 *
 * Short on purpose. The token's job is to get a device from "no floor at all"
 * to its first floor during the enrollment exchange; it is not a standing time
 * service. A device that could not use it within this window should re-enroll
 * rather than establish a floor from a stale assertion.
 */
export const ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS = 300 as const;

export interface EnrollmentTimeToken {
  /** Token version, carried explicitly so a future shape is refused, not guessed. */
  readonly protocolVersion: string;
  /** Who minted it. Checked against the device's expectation, never trusted from the token. */
  readonly issuer: string;
  /** THE device binding. One token, one device. */
  readonly deviceRecordId: string;
  /** The enrollment exchange that produced the device — replay resistance. */
  readonly challengeId: string;
  readonly environment: TrustEnvironment;
  /** The authoritative instant. This is what becomes the device's first floor. */
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/**
 * The exact bytes the cloud signs and the device verifies. Field order is FIXED
 * and the kind leads.
 */
export function enrollmentTimeTokenBytes(token: EnrollmentTimeToken): Uint8Array {
  return Buffer.from(
    [
      ENROLLMENT_TIME_TOKEN_KIND,
      token.protocolVersion,
      token.issuer,
      token.deviceRecordId,
      token.challengeId,
      token.environment,
      token.issuedAt.toISOString(),
      token.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}

export function enrollmentTimeTokenHash(token: EnrollmentTimeToken): string {
  return createHash("sha256").update(Buffer.from(enrollmentTimeTokenBytes(token))).digest("hex");
}

/**
 * A field value that would make the newline-joined encoding AMBIGUOUS.
 *
 * Two different tokens must never encode to the same bytes. A `deviceRecordId`
 * containing a newline could shift every following field by one line, so a
 * signature over the result would bind a token nobody minted. Checked BEFORE
 * any cryptography, and treated as malformed input rather than as a signature
 * failure, because the two have different causes.
 */
export function findEnrollmentTokenSeparatorInjection(token: EnrollmentTimeToken): string | null {
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["protocolVersion", token.protocolVersion],
    ["issuer", token.issuer],
    ["deviceRecordId", token.deviceRecordId],
    ["challengeId", token.challengeId],
    ["environment", token.environment],
  ];
  for (const [name, value] of fields) {
    if (typeof value !== "string" || value.includes("\n") || value.includes("\r")) {
      return name;
    }
  }
  return null;
}

export type EnrollmentTimeTokenRefusalCode =
  | "TIME_TOKEN_MISSING"
  | "TIME_TOKEN_WRONG_VERSION"
  | "TIME_TOKEN_WRONG_ISSUER"
  | "TIME_TOKEN_WRONG_DEVICE"
  | "TIME_TOKEN_WRONG_CHALLENGE"
  | "TIME_TOKEN_WRONG_ENVIRONMENT"
  | "TIME_TOKEN_SEPARATOR_INJECTION"
  | "TIME_TOKEN_WINDOW_INVALID"
  | "TIME_TOKEN_EXPIRED"
  | "TIME_TOKEN_ALGORITHM_UNSUPPORTED"
  | "TIME_TOKEN_SIGNING_KEY_UNKNOWN"
  | "TIME_TOKEN_SIGNING_KEY_REVOKED"
  | "TIME_TOKEN_SIGNATURE_MALFORMED"
  | "TIME_TOKEN_SIGNATURE_INVALID";

/**
 * What the DEVICE independently knows the token must be about.
 *
 * Never derived from the token: a token that asserts its own correctness proves
 * nothing. `deviceRecordId` is the id the device just received from its own
 * enrollment call, and `challengeId` is the challenge it itself opened.
 */
export interface EnrollmentTimeTokenExpectation {
  readonly issuer: string;
  readonly deviceRecordId: string;
  readonly challengeId: string;
  readonly environment: TrustEnvironment;
}

export type EnrollmentTimeTokenVerdict =
  | { readonly accepted: true; readonly trustedTime: Date; readonly keyId: string }
  | { readonly accepted: false; readonly refusal: EnrollmentTimeTokenRefusalCode };

/**
 * Verifies a token before it may be offered to the trusted-time gateway.
 *
 * Fails CLOSED on every path and REFUSES rather than throws: this runs against
 * bytes that arrived over a network on a device with no clock, and a verifier
 * that threw on malformed input would be an outage rather than a rejection.
 *
 * Deliberately NOT checked here: whether `issuedAt` is close to the device's own
 * wall clock. The device has no trusted clock yet — that is the entire reason
 * this token exists — so comparing against it would either reject every valid
 * token or accept a forged one, depending on how wrong the local clock is. The
 * token's freshness is bounded by its own signed window, and the monotonic floor
 * rule in `evaluate_trusted_time_v1` is what stops it moving time backwards.
 */
export function verifyEnrollmentTimeToken(
  token: EnrollmentTimeToken | null | undefined,
  envelope: SnapshotSignatureEnvelope | null | undefined,
  trustedKeys: readonly TrustedSnapshotKey[],
  expectation: EnrollmentTimeTokenExpectation,
): EnrollmentTimeTokenVerdict {
  if (token === null || token === undefined || typeof token !== "object") {
    return { accepted: false, refusal: "TIME_TOKEN_MISSING" };
  }
  if (envelope === null || envelope === undefined || typeof envelope !== "object") {
    return { accepted: false, refusal: "TIME_TOKEN_MISSING" };
  }

  const injected = findEnrollmentTokenSeparatorInjection(token);
  if (injected !== null) {
    return { accepted: false, refusal: "TIME_TOKEN_SEPARATOR_INJECTION" };
  }

  if (token.protocolVersion !== "1") {
    return { accepted: false, refusal: "TIME_TOKEN_WRONG_VERSION" };
  }
  if (token.issuer !== expectation.issuer) {
    return { accepted: false, refusal: "TIME_TOKEN_WRONG_ISSUER" };
  }
  if (token.deviceRecordId !== expectation.deviceRecordId) {
    return { accepted: false, refusal: "TIME_TOKEN_WRONG_DEVICE" };
  }
  if (token.challengeId !== expectation.challengeId) {
    return { accepted: false, refusal: "TIME_TOKEN_WRONG_CHALLENGE" };
  }
  if (token.environment !== expectation.environment) {
    return { accepted: false, refusal: "TIME_TOKEN_WRONG_ENVIRONMENT" };
  }

  const issuedMs = token.issuedAt instanceof Date ? token.issuedAt.getTime() : Number.NaN;
  const expiresMs = token.expiresAt instanceof Date ? token.expiresAt.getTime() : Number.NaN;
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    return { accepted: false, refusal: "TIME_TOKEN_WINDOW_INVALID" };
  }
  // A window wider than the policy allows is refused even when signed: a
  // long-lived time assertion is a standing authority to set a device's clock.
  if (expiresMs - issuedMs > ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS * 1000) {
    return { accepted: false, refusal: "TIME_TOKEN_WINDOW_INVALID" };
  }

  if (envelope.algorithm !== SNAPSHOT_SIGNATURE_ALGORITHM) {
    return { accepted: false, refusal: "TIME_TOKEN_ALGORITHM_UNSUPPORTED" };
  }

  // Matched on key id AND version, so a rotation that reused an id with new
  // material does not let the old version keep verifying.
  const key = trustedKeys.find(
    (candidate) =>
      candidate.keyId === envelope.keyId && candidate.keyVersion === envelope.keyVersion,
  );
  if (key === undefined) {
    return { accepted: false, refusal: "TIME_TOKEN_SIGNING_KEY_UNKNOWN" };
  }
  if (key.state === "revoked") {
    return { accepted: false, refusal: "TIME_TOKEN_SIGNING_KEY_REVOKED" };
  }

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(envelope.signature, "base64");
    // Ed25519 signatures are exactly 64 bytes; base64 decoding is lenient
    // enough to turn junk into a short buffer, so the length is checked.
    if (signatureBytes.length !== 64) {
      return { accepted: false, refusal: "TIME_TOKEN_SIGNATURE_MALFORMED" };
    }
  } catch {
    return { accepted: false, refusal: "TIME_TOKEN_SIGNATURE_MALFORMED" };
  }

  try {
    const ok = nodeVerify(
      null,
      Buffer.from(enrollmentTimeTokenBytes(token)),
      createPublicKey(key.publicKeyPem),
      signatureBytes,
    );
    return ok
      ? { accepted: true, trustedTime: token.issuedAt, keyId: key.keyId }
      : { accepted: false, refusal: "TIME_TOKEN_SIGNATURE_INVALID" };
  } catch {
    // A malformed PEM or a non-Ed25519 key. Refused, never thrown.
    return { accepted: false, refusal: "TIME_TOKEN_SIGNATURE_INVALID" };
  }
}
