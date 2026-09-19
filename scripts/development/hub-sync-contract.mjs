/**
 * The hub-sync WIRE CONTRACT — HUB-TERMINAL-SYNC-001 (2026-09-19).
 *
 * Two signed things travel between a Store Hub and the development hub-sync
 * producer, and both sides must build the SAME bytes for them:
 *
 *   1. the Hub's REQUEST, signed by the Hub's own Ed25519 device identity key
 *      (the key the cloud fingerprinted at registration — group 0224/0229);
 *   2. the producer's ENVELOPE, signed by the development hub-sync delivery
 *      key (purpose `transport_signing`, trust record baked into the Hub image).
 *
 * This file is the producer's copy, in plain JavaScript because the
 * development services under scripts/ run without a build step. The Hub agent
 * carries a TypeScript copy in `services/kitluy-hub-agent/src/hub/terminal-sync/
 * contract.ts`, and `test/terminal-sync-contract.drift.test.ts` there imports
 * THIS file and fails if the two disagree by one byte.
 *
 * Nothing here is a secret: kinds, field names and preimage layouts.
 */
import { createHash, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";

export const HUB_SYNC_REQUEST_KIND = "kitluy.hub-sync.request.v1";
export const HUB_SYNC_ENVELOPE_KIND = "kitluy.hub-sync.terminal-projections.v1";
/** The per-terminal delivery — the SAME shape `hub-provision-terminal` applies. */
export const TERMINAL_PROJECTION_KIND = "kitluy.hub.development-terminal-projection.v1";
export const HUB_SYNC_TRUST_RECORD_KIND = "kitluy.hub-sync-trust-key.v1";
export const HUB_SYNC_SIGNING_PURPOSE = "transport_signing";

/** A request older or newer than this is refused: replay window. */
export const REQUEST_MAX_SKEW_SECONDS = 300;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const HEX64 = /^[0-9a-f]{64}$/u;
/** A detached Ed25519 signature: 64 bytes, unpadded base64url. */
export const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
export const NONCE = /^[0-9a-f]{32}$/u;

/** A control character anywhere in a signed field is a refusal, by code point. */
function hasControlCharacter(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Canonical JSON: keys sorted at every depth, arrays in order, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
    .join(",")}}`;
}

/** SHA-256 over the DER SPKI encoding — the same fingerprint the cloud enrolled. */
export function publicKeyFingerprint(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

/**
 * The request preimage. The identity FINGERPRINT (not the PEM) is what is
 * signed, so a re-encoded PEM of the same key verifies and a different key
 * does not.
 */
export function hubSyncRequestBytes(input) {
  if (!HEX64.test(input.identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-HUB-SYNC-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex",
    );
  }
  if (!UUID.test(input.hubDeviceId))
    throw new Error("KLUY-HUB-SYNC-MALFORMED: hubDeviceId is not a uuid");
  if (!NONCE.test(input.nonce))
    throw new Error("KLUY-HUB-SYNC-MALFORMED: nonce must be 32 hex characters");
  if (
    typeof input.requestedAt !== "string" ||
    input.requestedAt.length > 64 ||
    hasControlCharacter(input.requestedAt)
  ) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: requestedAt is invalid");
  }
  return Buffer.from(
    [
      HUB_SYNC_REQUEST_KIND,
      input.identityPublicKeyFingerprint,
      input.hubDeviceId.toLowerCase(),
      input.requestedAt,
      input.nonce,
    ].join("\n"),
    "utf8",
  );
}

/** The envelope preimage: the kind and a digest of the canonical envelope. */
export function hubSyncEnvelopeBytes(envelope) {
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    envelope.kind !== HUB_SYNC_ENVELOPE_KIND
  ) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: the envelope declares the wrong kind");
  }
  const digest = createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex");
  return Buffer.from([HUB_SYNC_ENVELOPE_KIND, digest].join("\n"), "utf8");
}

export function signBytes(privateKey, bytes) {
  return Buffer.from(edSign(null, bytes, privateKey)).toString("base64url");
}

export function verifyBytes(publicKey, bytes, signatureBase64Url) {
  if (!SIGNATURE.test(signatureBase64Url)) return false;
  try {
    return edVerify(null, bytes, publicKey, Buffer.from(signatureBase64Url, "base64url"));
  } catch {
    return false;
  }
}
