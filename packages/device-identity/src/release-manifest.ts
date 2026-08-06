/**
 * Signed release manifest v1 (WS-11-T006-P03).
 *
 * Authority: KLD-2026-08-06-WS11-T006-001 §5 (LOCKED: manifest version 1,
 * SHA-256 artifact digest, Ed25519 manifest signature, channels
 * Internal → Pilot → Stable; a URL, filename or channel label is never
 * sufficient trust); release-channel and promotion policy v1.0.0 §3/§9.
 *
 * Mirrors snapshot-signing.ts deliberately: the SAME canonical-bytes
 * discipline (domain tag + fixed field order + unit/record separators +
 * injection guard), the SAME trusted-key model (id AND version matched,
 * `revoked` refused even with a good signature), the SAME fail-closed verify
 * union. Every Store Hub and terminal verifies INDEPENDENTLY with this
 * module — the Hub cannot make an invalid release trustworthy for a
 * terminal, because the terminal runs the same closed verifier over its own
 * trust registry.
 */
import { createHash, verify as nodeVerify, createPublicKey } from "node:crypto";

export const RELEASE_MANIFEST_VERSION = 1 as const;
export const RELEASE_SIGNATURE_ALGORITHM = "ed25519" as const;
export const RELEASE_CHANNELS = ["internal", "pilot", "stable"] as const;
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];

const US = "";
const RS = "";

/** Every field below is covered by the signature. */
export interface SignedReleaseManifestBody {
  readonly manifestVersion: number;
  readonly releaseId: string;
  readonly productKey: string;
  readonly version: string;
  readonly buildId: string;
  readonly architecture: string;
  readonly hardwareProfile: string;
  readonly environment: string;
  readonly channel: string;
  readonly artifactDigestSha256: string;
  readonly artifactSizeBytes: number;
  readonly minSchemaVersion: number;
  readonly maxSchemaVersion: number;
  /** 0 = no configuration prerequisite. */
  readonly configPrerequisiteVersion: number;
  /** Empty string = no rollback target (first install of a product). */
  readonly rollbackReleaseId: string;
}

export interface ReleaseSignatureEnvelope {
  readonly keyId: string;
  readonly keyVersion: number;
  readonly algorithm: typeof RELEASE_SIGNATURE_ALGORITHM;
  /** Detached Ed25519 signature. Base64. */
  readonly signature: string;
}

export interface TrustedReleaseKey {
  readonly keyId: string;
  readonly keyVersion: number;
  /** SPKI PEM. PUBLIC half only — a device never holds a signing key. */
  readonly publicKeyPem: string;
  readonly state: "current" | "next" | "revoked";
}

export class ReleaseSeparatorInjectionError extends Error {
  constructor(readonly field: string) {
    super(`release manifest field ${field} carries a canonical separator`);
    this.name = "ReleaseSeparatorInjectionError";
  }
}

function canonicalStrings(
  body: SignedReleaseManifestBody,
): ReadonlyArray<readonly [string, string]> {
  return [
    ["releaseId", body.releaseId],
    ["productKey", body.productKey],
    ["version", body.version],
    ["buildId", body.buildId],
    ["architecture", body.architecture],
    ["hardwareProfile", body.hardwareProfile],
    ["environment", body.environment],
    ["channel", body.channel],
    ["artifactDigestSha256", body.artifactDigestSha256],
    ["rollbackReleaseId", body.rollbackReleaseId],
  ];
}

/** Pre-crypto injectivity guard — the snapshot-signing discipline. */
export function findReleaseSeparatorInjection(body: SignedReleaseManifestBody): string | null {
  for (const [field, value] of canonicalStrings(body)) {
    if (value.includes(US) || value.includes(RS)) return field;
  }
  return null;
}

/**
 * Deterministic by construction: domain tag, fixed field order, record
 * separators. No clock read, no JSON ambiguity.
 */
export function canonicalReleaseManifestBytes(body: SignedReleaseManifestBody): Uint8Array {
  const injected = findReleaseSeparatorInjection(body);
  if (injected !== null) throw new ReleaseSeparatorInjectionError(injected);
  const fields: readonly string[] = [
    `kitluy.release-manifest.v${String(body.manifestVersion)}`,
    body.releaseId,
    body.productKey,
    body.version,
    body.buildId,
    body.architecture,
    body.hardwareProfile,
    body.environment,
    body.channel,
    body.artifactDigestSha256,
    String(body.artifactSizeBytes),
    String(body.minSchemaVersion),
    String(body.maxSchemaVersion),
    String(body.configPrerequisiteVersion),
    body.rollbackReleaseId,
  ];
  return new TextEncoder().encode(fields.join(RS) + RS);
}

/** Correlation/logging digest of the canonical bytes. Never a signature. */
export function canonicalReleaseManifestDigest(body: SignedReleaseManifestBody): string {
  return createHash("sha256").update(canonicalReleaseManifestBytes(body)).digest("hex");
}

export type ReleaseVerificationFailure =
  | "SIGNATURE_ALGORITHM_UNSUPPORTED"
  | "SIGNATURE_MALFORMED"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_UNKNOWN"
  | "SIGNING_KEY_REVOKED"
  | "SIGNATURE_MISSING"
  | "MANIFEST_VERSION_UNSUPPORTED"
  | "MANIFEST_SEPARATOR_INJECTION";

export type ReleaseVerificationResult =
  | { readonly verified: true; readonly keyId: string; readonly keyVersion: number }
  | { readonly verified: false; readonly failure: ReleaseVerificationFailure };

/**
 * Fails CLOSED on every path — unknown key, revoked key, wrong algorithm,
 * unparseable base64, bad signature and a throwing crypto.verify all REFUSE
 * rather than raise. The wire is hostile; a rejection is not an outage.
 */
export function verifyReleaseManifestSignature(
  body: SignedReleaseManifestBody,
  envelope: ReleaseSignatureEnvelope | null | undefined,
  trustedKeys: readonly TrustedReleaseKey[],
): ReleaseVerificationResult {
  if (envelope === null || envelope === undefined || typeof envelope !== "object") {
    return { verified: false, failure: "SIGNATURE_MISSING" };
  }
  if (envelope.algorithm !== RELEASE_SIGNATURE_ALGORITHM) {
    return { verified: false, failure: "SIGNATURE_ALGORITHM_UNSUPPORTED" };
  }
  if (body.manifestVersion !== RELEASE_MANIFEST_VERSION) {
    return { verified: false, failure: "MANIFEST_VERSION_UNSUPPORTED" };
  }
  if (findReleaseSeparatorInjection(body) !== null) {
    return { verified: false, failure: "MANIFEST_SEPARATOR_INJECTION" };
  }
  const key = trustedKeys.find(
    (candidate) =>
      candidate.keyId === envelope.keyId && candidate.keyVersion === envelope.keyVersion,
  );
  if (key === undefined) return { verified: false, failure: "SIGNING_KEY_UNKNOWN" };
  if (key.state === "revoked") return { verified: false, failure: "SIGNING_KEY_REVOKED" };

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(envelope.signature, "base64");
  } catch {
    return { verified: false, failure: "SIGNATURE_MALFORMED" };
  }
  if (signatureBytes.length !== 64) {
    return { verified: false, failure: "SIGNATURE_MALFORMED" };
  }
  try {
    const ok = nodeVerify(
      null,
      canonicalReleaseManifestBytes(body),
      createPublicKey(key.publicKeyPem),
      signatureBytes,
    );
    return ok
      ? { verified: true, keyId: key.keyId, keyVersion: key.keyVersion }
      : { verified: false, failure: "SIGNATURE_INVALID" };
  } catch {
    return { verified: false, failure: "SIGNATURE_INVALID" };
  }
}

/**
 * The independent device-side acceptance gate beyond the signature: exact
 * scope, identity and compatibility matching (owner decision §5 list). A
 * mismatch names its first failing check; the caller records it as the
 * refusal code.
 */
export interface ReleaseAcceptanceContext {
  readonly productKey: string;
  readonly architecture: string;
  readonly hardwareProfile: string;
  readonly environment: string;
  readonly eligibleChannels: readonly string[];
  readonly schemaVersion: number;
  readonly configurationVersion: number;
  readonly expectedArtifactSizeBytes?: number;
}

export function findReleaseAcceptanceRefusal(
  body: SignedReleaseManifestBody,
  context: ReleaseAcceptanceContext,
): string | null {
  if (body.productKey !== context.productKey) return "RELEASE_WRONG_PRODUCT";
  if (body.architecture !== context.architecture) return "RELEASE_WRONG_ARCHITECTURE";
  if (body.hardwareProfile !== context.hardwareProfile) return "RELEASE_WRONG_HARDWARE_PROFILE";
  if (body.environment !== context.environment) return "RELEASE_WRONG_ENVIRONMENT";
  if (!context.eligibleChannels.includes(body.channel)) return "RELEASE_CHANNEL_INELIGIBLE";
  if (
    context.schemaVersion < body.minSchemaVersion ||
    context.schemaVersion > body.maxSchemaVersion
  ) {
    return "RELEASE_SCHEMA_INCOMPATIBLE";
  }
  if (
    body.configPrerequisiteVersion > 0 &&
    context.configurationVersion < body.configPrerequisiteVersion
  ) {
    return "RELEASE_CONFIGURATION_PREREQUISITE_MISSING";
  }
  if (
    context.expectedArtifactSizeBytes !== undefined &&
    context.expectedArtifactSizeBytes !== body.artifactSizeBytes
  ) {
    return "RELEASE_ARTIFACT_SIZE_MISMATCH";
  }
  return null;
}
