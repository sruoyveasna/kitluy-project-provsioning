/**
 * The device's MIRROR of the signed release-manifest verifier.
 *
 * ===========================================================================
 * WHY THIS IS A MIRROR AND NOT AN IMPORT
 * ===========================================================================
 * `@kitluy/device-identity` owns the canonical release-manifest contract, and
 * the Store Hub imports it directly. This agent does not — not here and nowhere
 * else. Every other cross-contract surface in this service (registration bytes,
 * the operational CSR, the Hub claim, enrolment proof-of-possession) is the same
 * shape: a MIRROR built on `node:` built-ins only, with a DRIFT TEST in `test/`
 * that imports the real package and fails the build if the two ever disagree.
 *
 * The reason is the device closure. `package-bootstrap-runtime.sh` ships an
 * explicit list of modules into `/usr/lib/kitluy/lib/firstboot-agent`, and it
 * verifies that the list is the transitive import closure of the device
 * entrypoints. Importing a workspace package here would pull that package — and
 * everything it imports, including `pg` — onto a shop-floor appliance that has
 * no business carrying any of it.
 *
 * So: the contract lives in one place, the device carries a small mirror of it,
 * and `test/release-verify-drift.test.ts` is what makes "mirror" mean something.
 * If you change either side, that test tells you.
 *
 * ===========================================================================
 * THE SEPARATOR BYTES ARE PART OF THE SIGNATURE
 * ===========================================================================
 * US = 0x1F, RS = 0x1E. The field order, the `kitluy.release-manifest.v1`
 * domain tag and the TRAILING record separator are all inside the signed bytes.
 * None of it is formatting, and a "tidy-up" here silently rejects every genuine
 * release.
 */
import { createHash, createPublicKey, verify as nodeVerify } from "node:crypto";

export const RELEASE_MANIFEST_VERSION = 1 as const;
export const RELEASE_SIGNATURE_ALGORITHM = "ed25519" as const;

/** Unit and record separators. Mirrors @kitluy/device-identity exactly. */
const US = "";
const RS = "";

/** Mirrors `SignedReleaseManifestBody`. Every field is covered by the signature. */
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
  readonly configPrerequisiteVersion: number;
  readonly rollbackReleaseId: string;
}

export interface ReleaseSignatureEnvelope {
  readonly keyId: string;
  readonly keyVersion: number;
  readonly algorithm: typeof RELEASE_SIGNATURE_ALGORITHM;
  readonly signature: string;
}

export interface TrustedReleaseKey {
  readonly keyId: string;
  readonly keyVersion: number;
  /** SPKI PEM. PUBLIC half only — a device never holds a signing key. */
  readonly publicKeyPem: string;
  readonly state: "current" | "next" | "revoked";
  /**
   * NOT in the canonical package's type. Added by U1 so the device can refuse a
   * key minted for another purpose (KLD-2026-07-28-002 §1/§7 keeps the six
   * signing purposes separate). The check lives in `release-trust.ts`, which
   * refuses before a key ever reaches this module — this field is what it reads.
   */
  readonly purpose: string;
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

/** Pre-crypto injectivity guard. A field carrying a separator could otherwise
 * be split differently by the signer and the verifier over the same bytes. */
export function findReleaseSeparatorInjection(body: SignedReleaseManifestBody): string | null {
  for (const [field, value] of canonicalStrings(body)) {
    if (value.includes(US) || value.includes(RS)) return field;
  }
  return null;
}

export class ReleaseSeparatorInjectionError extends Error {
  constructor(readonly field: string) {
    super(`release manifest field ${field} carries a canonical separator`);
    this.name = "ReleaseSeparatorInjectionError";
  }
}

/** Deterministic by construction: domain tag, fixed order, record separators,
 * trailing separator. No clock read, no JSON ambiguity. */
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

/** Correlation digest of the canonical bytes. Never a signature. */
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
  if (signatureBytes.length !== 64) return { verified: false, failure: "SIGNATURE_MALFORMED" };
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

/** Mirrors `ReleaseAcceptanceContext`. */
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

/**
 * The device-side acceptance gate beyond the signature: exact scope, identity
 * and compatibility matching. A mismatch names its FIRST failing check, and the
 * caller records that as the refusal code.
 */
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

// ===========================================================================
// THE RELEASE ASSIGNMENT — a SECOND signed statement, domain-separated
// ===========================================================================
// The manifest signature says "this release is genuine". It says nothing about
// WHO it is for, WHICH assignment it is, or WHERE it sits in the order — those
// three are what the device's replay protection depends on, and before group
// 0222 they arrived unauthenticated over plain HTTP.
//
// That was exploitable in two ways, and the second is the worse one:
//
//   1. a genuine, validly-signed OLD release served with a forged high
//      sequence installs AND poisons `lastAssignmentSequence`, after which
//      every real assignment is refused ASSIGNMENT_STALE for ever — a durable
//      denial of update, because the journal is meant to survive reboots;
//   2. an assignment minted for device A is accepted by device B.
//
// So the assignment is signed too, over its own canonical bytes, with the
// SAME key and the SAME trust registry — and a different DOMAIN TAG. The tag is
// what makes one key safe for two message types: `kitluy.release-manifest.v1`
// bytes can never be read as `kitluy.release-assignment.v1` bytes, so neither
// signature can be replayed as the other.

export const RELEASE_ASSIGNMENT_VERSION = 1 as const;

/** Exactly the facts a device must not let a transport choose. */
export interface ReleaseAssignmentBinding {
  /** `device_installations.id` — WHICH assignment this is. */
  readonly assignmentId: string;
  /** The device it was minted for. */
  readonly deviceId: string;
  readonly releaseId: string;
  readonly assignmentSequence: number;
  readonly environment: string;
}

export function findAssignmentSeparatorInjection(binding: ReleaseAssignmentBinding): string | null {
  const fields: ReadonlyArray<readonly [string, string]> = [
    ["assignmentId", binding.assignmentId],
    ["deviceId", binding.deviceId],
    ["releaseId", binding.releaseId],
    ["environment", binding.environment],
  ];
  for (const [name, value] of fields) {
    if (value.includes(US) || value.includes(RS)) return name;
  }
  return null;
}

/**
 * Deterministic by construction, like the manifest's: domain tag, fixed order,
 * record separators, trailing separator. No clock read.
 */
export function canonicalReleaseAssignmentBytes(binding: ReleaseAssignmentBinding): Uint8Array {
  const injected = findAssignmentSeparatorInjection(binding);
  if (injected !== null) throw new ReleaseSeparatorInjectionError(injected);
  const fields: readonly string[] = [
    `kitluy.release-assignment.v${String(RELEASE_ASSIGNMENT_VERSION)}`,
    binding.assignmentId,
    binding.deviceId,
    binding.releaseId,
    String(binding.assignmentSequence),
    binding.environment,
  ];
  return new TextEncoder().encode(fields.join(RS) + RS);
}

export type AssignmentVerificationFailure =
  ReleaseVerificationFailure | "ASSIGNMENT_NOT_FOR_THIS_DEVICE" | "ASSIGNMENT_BINDING_MALFORMED";

export type AssignmentVerificationResult =
  | { readonly verified: true; readonly keyId: string; readonly keyVersion: number }
  | { readonly verified: false; readonly failure: AssignmentVerificationFailure };

/**
 * Verify an assignment, and that it is for THIS device.
 *
 * `expectedDeviceId` is the device's own server record id, from
 * `registration-state.json`. Passing it is not optional: a signature that is
 * valid but names another device is exactly attack (2) above, and checking the
 * signature without checking the binding would let it through.
 *
 * Fails CLOSED on every path, like its sibling.
 */
export function verifyReleaseAssignmentSignature(
  binding: ReleaseAssignmentBinding,
  envelope: ReleaseSignatureEnvelope | null | undefined,
  trustedKeys: readonly TrustedReleaseKey[],
  expectedDeviceId: string,
): AssignmentVerificationResult {
  if (
    typeof binding.assignmentId !== "string" ||
    binding.assignmentId === "" ||
    typeof binding.deviceId !== "string" ||
    binding.deviceId === "" ||
    typeof binding.releaseId !== "string" ||
    binding.releaseId === "" ||
    !Number.isInteger(binding.assignmentSequence) ||
    binding.assignmentSequence < 1 ||
    typeof binding.environment !== "string" ||
    binding.environment === ""
  ) {
    return { verified: false, failure: "ASSIGNMENT_BINDING_MALFORMED" };
  }
  // Checked BEFORE the signature: a mismatch here is not a cryptographic
  // failure and reporting it as one would send the reader to the wrong place.
  if (expectedDeviceId === "" || binding.deviceId !== expectedDeviceId) {
    return { verified: false, failure: "ASSIGNMENT_NOT_FOR_THIS_DEVICE" };
  }
  if (envelope === null || envelope === undefined || typeof envelope !== "object") {
    return { verified: false, failure: "SIGNATURE_MISSING" };
  }
  if (envelope.algorithm !== RELEASE_SIGNATURE_ALGORITHM) {
    return { verified: false, failure: "SIGNATURE_ALGORITHM_UNSUPPORTED" };
  }
  if (findAssignmentSeparatorInjection(binding) !== null) {
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
  if (signatureBytes.length !== 64) return { verified: false, failure: "SIGNATURE_MALFORMED" };
  try {
    const ok = nodeVerify(
      null,
      canonicalReleaseAssignmentBytes(binding),
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
