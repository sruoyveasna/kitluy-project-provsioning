/**
 * The cloud-registration proof-of-possession canonical bytes, as the DEVICE
 * builds them.
 *
 * Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001;
 *   `docs/api/device-registration-edge-function-v1.md` §5; plan v1.0.0 §2.2, §3.1.
 *
 * ===========================================================================
 * WHY THIS IS A THIRD COPY, AND WHY THAT IS SAFE
 * ===========================================================================
 * The authoritative definition lives in
 * `packages/device-identity/src/device-registration-request.ts`. The Edge
 * Function carries a Deno copy (`supabase/functions/_shared/`) because Deno
 * cannot import a pnpm workspace package. This is the third: the firstboot
 * agent ships INSIDE the golden image with **zero runtime dependencies**, and
 * `package-bootstrap-runtime.sh` refuses the build outright if that ever stops
 * being true —
 *
 *     REFUSED: the firstboot agent gained runtime dependencies;
 *              the image ships no node_modules.
 *
 * This is the same trade already made for `enrollment-pop-bytes.ts`, for the
 * same reason, and it is kept honest the same way: `test/device-registration-
 * bytes-drift.test.ts` builds one input through BOTH implementations and fails
 * if a single byte differs. The duplication is checked by CI, not by memory.
 *
 * If you change the field order, the separator, or the kind string here, that
 * test fails — which is the point.
 *
 * ===========================================================================
 * WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
 * ===========================================================================
 * No verification. A device signs; it never verifies another party's
 * registration proof. Shipping `verifyDeviceRegistrationRequest` here would put
 * a signature-checking path on an appliance that has no use for one, and the
 * public-key parsing it needs is exactly the surface worth not shipping.
 */

/** Domain separator. MUST equal `DEVICE_REGISTRATION_REQUEST_KIND`. */
export const DEVICE_REGISTRATION_REQUEST_KIND = "kitluy.device-registration-request.v1" as const;

/** Characters with structural meaning in the canonical form. */
const RESERVED = [";", "="] as const;

export interface DeviceRegistrationSignal {
  readonly signalType: string;
  /** Already normalised: `lower(btrim(value))`. */
  readonly signalValue: string;
}

export interface DeviceRegistrationRequestFields {
  readonly assetTag: string;
  readonly hardwareProfileKey: string;
  readonly hostname: string;
  readonly registrationPublicKeyFingerprint: string;
  readonly signals: readonly DeviceRegistrationSignal[];
  readonly installationEvidence: Readonly<Record<string, string>>;
}

/**
 * Why the device validates before signing, when the server validates too.
 *
 * A refusal the device can see is a refusal it can REPORT on its own console. A
 * Pi that sent an unnormalised signal and got back `400
 * KLUY-REG-SIGNAL-NOT-NORMALISED` can only say "the cloud refused me"; one that
 * checked first can say which signal, before spending a round trip. The server
 * check stays authoritative — this one exists so the device is not blind.
 */
export type DeviceRegistrationRejection =
  | "REGISTRATION_MISSING_FIELD"
  | "REGISTRATION_NO_SIGNALS"
  | "REGISTRATION_SIGNAL_NOT_NORMALISED"
  | "REGISTRATION_RESERVED_CHARACTER"
  | "REGISTRATION_FINGERPRINT_FORMAT";

/** 64 lowercase hex characters, matching the database's fingerprint constraint. */
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

const hasReserved = (value: string): boolean => RESERVED.some((c) => value.includes(c));

/** Returns null when the request is well-formed. */
export function validateDeviceRegistrationRequest(
  request: DeviceRegistrationRequestFields,
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
    // Normalise BEFORE signing so the bytes signed and the bytes stored are one
    // form. If the server normalised afterwards, a value could verify in one
    // form and be stored in another, and the signature would no longer cover
    // what the database holds.
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
export function deviceRegistrationRequestBytes(
  request: DeviceRegistrationRequestFields,
): Uint8Array {
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
