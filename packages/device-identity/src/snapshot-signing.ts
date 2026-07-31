/**
 * Canonical bytes, detached Ed25519 signature and verification for Store Hub
 * revocation snapshots.
 *
 * Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked);
 * KLD-2026-07-28-002 §6; WS-11-T003 Step 4 final offline completion §2.
 *
 * ===========================================================================
 * WHERE VERIFICATION HAPPENS, AND WHERE IT DOES NOT
 * ===========================================================================
 * Signing is CLOUD-SIDE. Verification is HUB-SIDE, in TypeScript, using Node's
 * `crypto.verify` with a `null` algorithm — the Ed25519 form.
 *
 * **PostgreSQL does not verify Ed25519.** No function in this repository asks it
 * to, `pgsodium` is not installed, and nothing here should be read as implying
 * otherwise. The database governs WHO may revoke; it does not check signatures.
 *
 * ===========================================================================
 * WHY THE SCOPE IS INSIDE THE SIGNED BYTES
 * ===========================================================================
 * An earlier iteration put the relational scope in a wrapper OUTSIDE the object
 * carrying the signature fields, protected by a keyless digest. A reviewer pointed
 * out the obvious consequence: anyone holding a snapshot could relabel it for
 * another Store and recompute that digest in one line, so it detected accidents
 * and not attackers.
 *
 * {@link canonicalSnapshotBytes} therefore covers the Tenant, Digital Store,
 * Location and environment along with the payload, the sequence and the key
 * identity. Changing any of them invalidates the signature, and only the holder
 * of the private key can produce a new one.
 */
import { createHash, sign as nodeSign, verify as nodeVerify, createPublicKey } from "node:crypto";

/** Owner-locked. Not a parameter, not negotiable per environment. */
export const SNAPSHOT_SIGNATURE_ALGORITHM = "ed25519" as const;

/** Bumped when the canonical byte layout changes. A Hub refuses what it cannot parse. */
export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** The four values that scope a snapshot to exactly one place. All required. */
export interface SnapshotRelationalScope {
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: string;
}

/** What the signer produces. Never contains key material. */
export interface SnapshotSignatureEnvelope {
  readonly keyId: string;
  readonly keyVersion: number;
  readonly algorithm: typeof SNAPSHOT_SIGNATURE_ALGORITHM;
  /** Detached. Base64, so it survives JSON transport unchanged. */
  readonly signature: string;
}

/**
 * The signed body. Every field here is covered by the signature.
 *
 * `revokedCertificateSerials` and `revokedDeviceRecordIds` are the ONLY payload,
 * and they are the identifiers relevant to THIS Hub's scope — never another
 * Tenant's, Store's, Location's or environment's.
 */
export interface SignedSnapshotBody {
  readonly schemaVersion: number;
  readonly scope: SnapshotRelationalScope;
  /** The Hub this snapshot was produced for. Binds it to one device, not just a Store. */
  readonly hubDeviceRecordId: string;
  readonly snapshotVersion: number;
  /**
   * Monotonic per Hub. Distinct from `snapshotVersion`: the version identifies the
   * CONTENT generation, the sequence orders DELIVERIES, and the Hub refuses one
   * that goes backwards.
   */
  readonly sequence: number;
  /** Highest revocation ordinal included. Lets a Hub say what it has, not just when. */
  readonly revocationWatermark: string;
  readonly generatedAt: string;
  readonly effectiveAt: string;
  readonly revokedCertificateSerials: readonly string[];
  readonly revokedDeviceRecordIds: readonly string[];
}

export interface SignedRevocationSnapshot extends SignedSnapshotBody {
  readonly signature: SnapshotSignatureEnvelope;
}

/**
 * ASCII control separators. U+001F between elements, U+001E between fields.
 *
 * Named constants rather than literals because as raw bytes they are INVISIBLE in
 * diffs and review tools — an independent reviewer of an earlier version read
 * `join(US)` as `join("")` and reported a collision that did not exist.
 *
 * Neither byte can occur in a uuid, a certificate serial, an ISO instant or an
 * environment name, so no field can absorb its neighbour.
 */
const US = "";
const RS = "";

/** Terminated, not joined: what distinguishes `[]` from `[""]`. */
function encodeList(values: readonly string[]): string {
  return [...values].sort().reduce((acc, value) => acc + value + US, "");
}

/**
 * The bytes that are signed and verified.
 *
 * Deterministic by construction: fixed field order, sorted identifier lists, and
 * no clock read. Two producers given the same facts emit the same bytes, which is
 * what makes a signature reproducible and a replay detectable.
 */
export function canonicalSnapshotBytes(body: SignedSnapshotBody): Uint8Array {
  const fields: readonly string[] = [
    `kitluy.revocation-snapshot.v${body.schemaVersion}`,
    body.scope.tenantId,
    body.scope.digitalStoreId,
    body.scope.storeLocationId,
    body.scope.environment,
    body.hubDeviceRecordId,
    String(body.snapshotVersion),
    String(body.sequence),
    body.revocationWatermark,
    body.generatedAt,
    body.effectiveAt,
    encodeList(body.revokedCertificateSerials),
    encodeList(body.revokedDeviceRecordIds),
  ];
  return new TextEncoder().encode(fields.join(RS));
}

/** A stable digest of the canonical bytes, for logging and correlation only. */
export function canonicalSnapshotDigest(body: SignedSnapshotBody): string {
  return createHash("sha256").update(canonicalSnapshotBytes(body)).digest("hex");
}

/**
 * A custody locator for a signing key. NEVER key material.
 *
 * The value is an environment-variable NAME plus a key identity — the private key
 * itself is read from the process environment by the signer and never travels
 * through an argument, a return value, a log line or an error.
 */
export interface SnapshotSigningKeyReference {
  /** The env var holding the PKCS#8 PEM. A NAME, never a value. */
  readonly secretEnvVar: string;
  readonly keyId: string;
  readonly keyVersion: number;
}

export interface SnapshotSigner {
  signCanonicalSnapshot(
    canonicalBytes: Uint8Array,
    keyReference: SnapshotSigningKeyReference,
  ): Promise<SnapshotSignatureEnvelope>;
}

export type SnapshotVerificationFailure =
  | "SIGNATURE_ALGORITHM_UNSUPPORTED"
  | "SIGNATURE_MALFORMED"
  | "SIGNATURE_INVALID"
  | "SIGNING_KEY_UNKNOWN"
  | "SIGNING_KEY_REVOKED";

export type SnapshotVerificationResult =
  | { readonly verified: true; readonly keyId: string; readonly keyVersion: number }
  | { readonly verified: false; readonly failure: SnapshotVerificationFailure };

/** One trusted public key as a Hub holds it. Public halves only. */
export interface TrustedSnapshotKey {
  readonly keyId: string;
  readonly keyVersion: number;
  /** SPKI PEM. A PUBLIC key — a Hub never holds a signing private key. */
  readonly publicKeyPem: string;
  /**
   * `current` signs today, `next` is pre-provisioned so a rotation does not need a
   * Hub visit, `revoked` is refused outright even if its signature is good.
   */
  readonly state: "current" | "next" | "revoked";
}

/**
 * Verifies a detached Ed25519 signature over the canonical bytes.
 *
 * Fails CLOSED on every path: an unknown key id, a revoked key, an unsupported
 * algorithm, unparseable base64 and a bad signature all return `verified: false`,
 * and a throwing `crypto.verify` is caught rather than propagated — a verifier
 * that threw could be turned into an outage by a malformed input.
 */
export function verifySnapshotSignature(
  body: SignedSnapshotBody,
  envelope: SnapshotSignatureEnvelope,
  trustedKeys: readonly TrustedSnapshotKey[],
): SnapshotVerificationResult {
  if (envelope.algorithm !== SNAPSHOT_SIGNATURE_ALGORITHM) {
    return { verified: false, failure: "SIGNATURE_ALGORITHM_UNSUPPORTED" };
  }

  // Matched on key id AND version: a rotation that reused an id with new material
  // must not let the old version's signature keep verifying.
  const key = trustedKeys.find(
    (candidate) =>
      candidate.keyId === envelope.keyId && candidate.keyVersion === envelope.keyVersion,
  );
  if (key === undefined) return { verified: false, failure: "SIGNING_KEY_UNKNOWN" };
  if (key.state === "revoked") return { verified: false, failure: "SIGNING_KEY_REVOKED" };

  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(envelope.signature, "base64");
    // Ed25519 signatures are exactly 64 bytes. Base64 decoding is lenient enough
    // to turn junk into a short buffer, so the length is checked rather than
    // trusted.
    if (signatureBytes.length !== 64) {
      return { verified: false, failure: "SIGNATURE_MALFORMED" };
    }
  } catch {
    return { verified: false, failure: "SIGNATURE_MALFORMED" };
  }

  try {
    const ok = nodeVerify(
      null,
      Buffer.from(canonicalSnapshotBytes(body)),
      createPublicKey(key.publicKeyPem),
      signatureBytes,
    );
    return ok
      ? { verified: true, keyId: key.keyId, keyVersion: key.keyVersion }
      : { verified: false, failure: "SIGNATURE_INVALID" };
  } catch {
    // A malformed PEM or a non-Ed25519 key. Refused, never thrown.
    return { verified: false, failure: "SIGNATURE_INVALID" };
  }
}

/**
 * Signs with a private key held ONLY in memory for the duration of the call.
 *
 * Exported for the signer adapters to share; it is deliberately not a
 * `SnapshotSigner` itself, because a `SnapshotSigner` must decide WHERE the key
 * comes from and this function must not be able to.
 */
export function signCanonicalBytesWithPem(
  canonicalBytes: Uint8Array,
  privateKeyPem: string,
): string {
  // `null` algorithm is the Ed25519 form: the curve fixes the hash, so passing a
  // digest name would be rejected by Node.
  return Buffer.from(nodeSign(null, Buffer.from(canonicalBytes), privateKeyPem)).toString("base64");
}
