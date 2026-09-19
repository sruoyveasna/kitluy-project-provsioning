/**
 * The hub-sync WIRE CONTRACT, Hub copy — HUB-TERMINAL-SYNC-001 (2026-09-19).
 *
 * The producer's copy is `scripts/development/hub-sync-contract.mjs`; the two
 * must build the SAME bytes, and `test/terminal-sync-contract.drift.test.ts`
 * imports that file and fails on a one-byte difference.
 *
 * Two signed things:
 *   1. the Hub's REQUEST, signed by its own Ed25519 device identity key — the
 *      key the cloud fingerprinted at registration (groups 0224/0229);
 *   2. the producer's ENVELOPE, signed by the hub-sync delivery key (purpose
 *      `transport_signing`), verified against the PUBLIC trust record the Hub
 *      image carries at /etc/kitluy/hub-sync-trust.json.
 */
import {
  createHash,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";

export const HUB_SYNC_REQUEST_KIND = "kitluy.hub-sync.request.v1" as const;
export const HUB_SYNC_ENVELOPE_KIND = "kitluy.hub-sync.terminal-projections.v1" as const;
/** The per-terminal delivery — the SAME shape `hub-provision-terminal` applied by hand. */
export const TERMINAL_PROJECTION_KIND = "kitluy.hub.development-terminal-projection.v1" as const;
export const HUB_SYNC_TRUST_RECORD_KIND = "kitluy.hub-sync-trust-key.v1" as const;
export const HUB_SYNC_SIGNING_PURPOSE = "transport_signing" as const;
export const REQUEST_MAX_SKEW_SECONDS = 300;

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
export const HEX64 = /^[0-9a-f]{64}$/u;
export const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
export const NONCE = /^[0-9a-f]{32}$/u;

/** A control character anywhere in a signed field is a refusal, by code point. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Canonical JSON: keys sorted at every depth, arrays in order, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",")}}`;
}

/** SHA-256 over the DER SPKI encoding — the fingerprint the cloud enrolled. */
export function publicKeyFingerprint(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("hex");
}

export interface HubSyncRequestPreimage {
  readonly identityPublicKeyFingerprint: string;
  readonly hubDeviceId: string;
  readonly requestedAt: string;
  readonly nonce: string;
}

export function hubSyncRequestBytes(input: HubSyncRequestPreimage): Buffer {
  if (!HEX64.test(input.identityPublicKeyFingerprint)) {
    throw new Error(
      "KLUY-HUB-SYNC-MALFORMED: the identity key fingerprint must be lowercase sha-256 hex",
    );
  }
  if (!UUID.test(input.hubDeviceId)) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: hubDeviceId is not a uuid");
  }
  if (!NONCE.test(input.nonce)) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: nonce must be 32 hex characters");
  }
  if (input.requestedAt.length > 64 || hasControlCharacter(input.requestedAt)) {
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

export function hubSyncEnvelopeBytes(envelope: { readonly kind: string }): Buffer {
  if (envelope.kind !== HUB_SYNC_ENVELOPE_KIND) {
    throw new Error("KLUY-HUB-SYNC-MALFORMED: the envelope declares the wrong kind");
  }
  const digest = createHash("sha256").update(canonicalJson(envelope), "utf8").digest("hex");
  return Buffer.from([HUB_SYNC_ENVELOPE_KIND, digest].join("\n"), "utf8");
}

export function signBytes(privateKey: KeyObject, bytes: Buffer): string {
  return Buffer.from(edSign(null, bytes, privateKey)).toString("base64url");
}

export function verifyBytes(publicKey: KeyObject, bytes: Buffer, signature: string): boolean {
  if (!SIGNATURE.test(signature)) return false;
  try {
    return edVerify(null, bytes, publicKey, Buffer.from(signature, "base64url"));
  } catch {
    return false;
  }
}
