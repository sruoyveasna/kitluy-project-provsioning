/**
 * The canonical bytes of a device registration request.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001;
 * `docs/api/device-registration-edge-function-v1.md` §5.
 *
 * ===========================================================================
 * WHY THIS IS NOT `manufacturingEnrollmentChallengeBytes`
 * ===========================================================================
 * That proof answers a server-minted challenge: the device signs a nonce the
 * server chose, inside a validity window the server set. It is the right shape
 * for factory enrollment, where a station has already authorized the device and
 * the question is only "is this key yours?".
 *
 * A first-boot Pi registering itself has no challenge to answer, because getting
 * one would require a round trip and a challenge table for a request that grants
 * nothing. So this proof covers the request's own CONTENT instead: the board
 * evidence, the installation, the hostname and the key. A captured request
 * cannot be replayed against a different public key, which is the one property
 * worth having here.
 *
 * The domain separator therefore differs, deliberately. A signature made for one
 * purpose must never verify for the other.
 *
 * ===========================================================================
 * WHY THE CANONICAL FORM IS NOT JSON
 * ===========================================================================
 * Two implementations sign these bytes — this one, and a Deno copy inside the
 * Edge Function — and they must agree exactly. JSON gives them several ways to
 * disagree: object key order, unicode escaping, whitespace, number formatting.
 * So values are rendered as sorted `key=value` pairs joined by `;`, which has
 * exactly one form.
 *
 * `;` and `=` are REFUSED inside values rather than escaped. An escaping rule is
 * one more thing the two implementations could implement differently, and no
 * legitimate hardware signal or storage identifier contains either character.
 */

import { publicKeyFingerprint, verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from every other KitLuy signing purpose. */
export const DEVICE_REGISTRATION_REQUEST_KIND = "kitluy.device-registration-request.v1" as const;

/** Characters with structural meaning in the canonical form. */
const RESERVED = [";", "="] as const;

export interface DeviceRegistrationSignal {
  readonly signalType: string;
  /** Already normalised: `lower(btrim(value))`. */
  readonly signalValue: string;
}

export interface DeviceRegistrationRequest {
  readonly assetTag: string;
  readonly hardwareProfileKey: string;
  readonly hostname: string;
  readonly registrationPublicKeyFingerprint: string;
  readonly signals: readonly DeviceRegistrationSignal[];
  readonly installationEvidence: Readonly<Record<string, string>>;
}

export type DeviceRegistrationRejection =
  | "REGISTRATION_MISSING_FIELD"
  | "REGISTRATION_NO_SIGNALS"
  | "REGISTRATION_SIGNAL_NOT_NORMALISED"
  | "REGISTRATION_RESERVED_CHARACTER"
  | "REGISTRATION_FINGERPRINT_FORMAT"
  | "REGISTRATION_FINGERPRINT_MISMATCH"
  | "REGISTRATION_BAD_SIGNATURE";

/** 64 lowercase hex characters, matching the database's fingerprint constraint. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const hasReserved = (value: string): boolean => RESERVED.some((c) => value.includes(c));

/**
 * Structural validation, separated from signature verification so a malformed
 * request is refused without any cryptography being attempted on it.
 *
 * Returns `null` when the request is well-formed.
 */
export function validateDeviceRegistrationRequest(
  request: DeviceRegistrationRequest,
): DeviceRegistrationRejection | null {
  const required = [
    request.assetTag,
    request.hardwareProfileKey,
    request.hostname,
    request.registrationPublicKeyFingerprint,
  ];
  if (required.some((v) => typeof v !== "string" || v.length === 0)) {
    return "REGISTRATION_MISSING_FIELD";
  }
  if (!FINGERPRINT_PATTERN.test(request.registrationPublicKeyFingerprint)) {
    return "REGISTRATION_FINGERPRINT_FORMAT";
  }
  if (request.signals.length === 0) {
    return "REGISTRATION_NO_SIGNALS";
  }
  for (const signal of request.signals) {
    if (
      typeof signal.signalType !== "string" ||
      signal.signalType.length === 0 ||
      typeof signal.signalValue !== "string" ||
      signal.signalValue.length === 0
    ) {
      return "REGISTRATION_MISSING_FIELD";
    }
    // The device normalises BEFORE signing so the bytes signed and the bytes
    // stored are one form. If the server normalised afterwards, a value could
    // verify in one form and be stored in another, and the signature would no
    // longer cover what the database holds.
    if (signal.signalValue !== signal.signalValue.trim().toLowerCase()) {
      return "REGISTRATION_SIGNAL_NOT_NORMALISED";
    }
    if (hasReserved(signal.signalType) || hasReserved(signal.signalValue)) {
      return "REGISTRATION_RESERVED_CHARACTER";
    }
  }
  for (const [key, value] of Object.entries(request.installationEvidence)) {
    if (typeof value !== "string") return "REGISTRATION_MISSING_FIELD";
    if (hasReserved(key) || hasReserved(value)) return "REGISTRATION_RESERVED_CHARACTER";
  }
  return null;
}

/** `signalType=signalValue` pairs, sorted by the rendered pair, joined by `;`. */
export function canonicalSignals(signals: readonly DeviceRegistrationSignal[]): string {
  return signals
    .map((s) => `${s.signalType}=${s.signalValue}`)
    .sort()
    .join(";");
}

/** `key=value` pairs, sorted BY KEY, joined by `;`. */
export function canonicalInstallationEvidence(evidence: Readonly<Record<string, string>>): string {
  return Object.keys(evidence)
    .sort()
    .map((k) => `${k}=${evidence[k] ?? ""}`)
    .join(";");
}

/**
 * The exact bytes the registration key signs. Field order is FIXED here rather
 * than taken from object key order.
 */
export function deviceRegistrationRequestBytes(request: DeviceRegistrationRequest): Uint8Array {
  return new TextEncoder().encode(
    [
      DEVICE_REGISTRATION_REQUEST_KIND,
      request.assetTag,
      request.hardwareProfileKey,
      request.hostname,
      request.registrationPublicKeyFingerprint,
      canonicalSignals(request.signals),
      canonicalInstallationEvidence(request.installationEvidence),
    ].join("\n"),
  );
}

export interface DeviceRegistrationVerdict {
  readonly verified: boolean;
  readonly rejection: DeviceRegistrationRejection | null;
}

/**
 * Verifies proof of possession.
 *
 * ===========================================================================
 * WHAT A `verified: true` RESULT MEANS
 * ===========================================================================
 * That the caller holds the private half of the key it presented. NOTHING about
 * which physical board sent the request: hardware evidence is self-reported and
 * unauthenticated, and no signature can change that. This is why registration
 * produces an untrusted record and why HET approval exists downstream.
 *
 * The fingerprint is RECOMPUTED from the PEM rather than trusted, because the
 * fingerprint is what the database stores and what an operator compares. A
 * request whose claimed fingerprint differs from its own key would otherwise
 * store one value while proving possession of another.
 */
export function verifyDeviceRegistrationRequest(
  request: DeviceRegistrationRequest,
  publicKeyPem: string,
  signature: Uint8Array,
): DeviceRegistrationVerdict {
  const structural = validateDeviceRegistrationRequest(request);
  if (structural !== null) {
    return { verified: false, rejection: structural };
  }

  let derived: string;
  try {
    derived = publicKeyFingerprint(publicKeyPem);
  } catch {
    return { verified: false, rejection: "REGISTRATION_FINGERPRINT_MISMATCH" };
  }
  if (derived !== request.registrationPublicKeyFingerprint) {
    return { verified: false, rejection: "REGISTRATION_FINGERPRINT_MISMATCH" };
  }

  const ok = verifyDetachedSignature(
    publicKeyPem,
    deviceRegistrationRequestBytes(request),
    signature,
  );
  return ok
    ? { verified: true, rejection: null }
    : { verified: false, rejection: "REGISTRATION_BAD_SIGNATURE" };
}
