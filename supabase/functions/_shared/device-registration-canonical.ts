/**
 * Deno copy of the device-registration canonical form.
 *
 * ===========================================================================
 * WHY A COPY EXISTS
 * ===========================================================================
 * An Edge Function runs on Deno and cannot import a pnpm workspace package. The
 * canonical definition lives in `@kitluy/device-identity`
 * (`packages/device-identity/src/device-registration-request.ts`); this is the
 * importable twin, and the same discipline the enrollment client already uses
 * for its copy.
 *
 * A copy is only safe if drift is detectable, so
 * `packages/device-identity/test/device-registration-canonical-parity.test.ts`
 * reads THIS FILE and asserts both implementations produce identical bytes for
 * the same inputs, including the ordering and reserved-character rules. If the
 * two ever diverge, that test fails rather than a device silently failing to
 * register.
 *
 * Keep this file dependency-free. It uses only WebCrypto and TextEncoder, both
 * of which Deno provides, so nothing here needs a lockfile.
 */

export const DEVICE_REGISTRATION_REQUEST_KIND = "kitluy.device-registration-request.v1" as const;

const RESERVED = [";", "="] as const;

export interface DeviceRegistrationSignal {
  readonly signalType: string;
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

const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const hasReserved = (value: string): boolean => RESERVED.some((c) => value.includes(c));

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

export function canonicalSignals(signals: readonly DeviceRegistrationSignal[]): string {
  return signals
    .map((s) => `${s.signalType}=${s.signalValue}`)
    .sort()
    .join(";");
}

export function canonicalInstallationEvidence(evidence: Readonly<Record<string, string>>): string {
  return Object.keys(evidence)
    .sort()
    .map((k) => `${k}=${evidence[k] ?? ""}`)
    .join(";");
}

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

// ---------------------------------------------------------------------------
// Crypto, via WebCrypto rather than node:crypto
// ---------------------------------------------------------------------------
// The Node twin uses `createPublicKey(...).export({type:'spki'})`. Here the PEM
// is decoded to SPKI DER by hand and imported, which reaches the same bytes:
// a PEM body IS base64 of the DER, so the fingerprint is a digest of the decoded
// body. The parity test pins the two together.

const PEM_BODY = /-----BEGIN PUBLIC KEY-----([\s\S]+?)-----END PUBLIC KEY-----/;

function spkiDer(publicKeyPem: string): Uint8Array {
  const match = PEM_BODY.exec(publicKeyPem);
  if (match === null) throw new Error("not an SPKI public-key PEM");
  const base64 = (match[1] ?? "").replace(/\s+/g, "");
  const binary = atob(base64);
  const der = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) der[i] = binary.charCodeAt(i);
  return der;
}

const HEX = "0123456789abcdef";
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += (HEX[b >> 4] ?? "") + (HEX[b & 15] ?? "");
  return out;
}

/** SHA-256 over the SPKI DER — byte-identical to `publicKeyFingerprint`. */
export async function publicKeyFingerprint(publicKeyPem: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", spkiDer(publicKeyPem));
  return toHex(new Uint8Array(digest));
}

export interface DeviceRegistrationVerdict {
  readonly verified: boolean;
  readonly rejection: DeviceRegistrationRejection | null;
}

export async function verifyDeviceRegistrationRequest(
  request: DeviceRegistrationRequest,
  publicKeyPem: string,
  signature: Uint8Array,
): Promise<DeviceRegistrationVerdict> {
  const structural = validateDeviceRegistrationRequest(request);
  if (structural !== null) return { verified: false, rejection: structural };

  let derived: string;
  let der: Uint8Array;
  try {
    der = spkiDer(publicKeyPem);
    derived = await publicKeyFingerprint(publicKeyPem);
  } catch {
    return { verified: false, rejection: "REGISTRATION_FINGERPRINT_MISMATCH" };
  }
  if (derived !== request.registrationPublicKeyFingerprint) {
    return { verified: false, rejection: "REGISTRATION_FINGERPRINT_MISMATCH" };
  }

  try {
    const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signature,
      deviceRegistrationRequestBytes(request),
    );
    return ok
      ? { verified: true, rejection: null }
      : { verified: false, rejection: "REGISTRATION_BAD_SIGNATURE" };
  } catch {
    // An unusable key or a wrong-length signature is a bad signature, not a
    // server fault. Nothing is reported to the caller beyond the refusal.
    return { verified: false, rejection: "REGISTRATION_BAD_SIGNATURE" };
  }
}
