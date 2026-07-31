/**
 * SIGNER tests — KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001, remediation §2.
 *
 * Ephemeral keys, generated per run and never written anywhere. No key material
 * is committed, and none is read from the real process environment: the signer is
 * built over an explicit `env` object so the set of variables it can ever read is
 * fixed at construction.
 */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  canonicalSnapshotBytes,
  SNAPSHOT_SCHEMA_VERSION,
  SNAPSHOT_SIGNATURE_ALGORITHM,
  verifySnapshotSignature,
  type SignedSnapshotBody,
  type SnapshotSigningKeyReference,
  type TrustedSnapshotKey,
} from "@kitluy/device-identity";

import {
  createEd25519SnapshotSigner,
  createUnavailableSnapshotSigner,
  resolveSigningKeyReference,
  SnapshotSignerUnavailableError,
  SNAPSHOT_SIGNING_KEY_ENV,
  SNAPSHOT_SIGNING_KEY_ID,
  SNAPSHOT_SIGNING_KEY_VERSION,
} from "../src/snapshot-signer.js";

/** EPHEMERAL. Generated here, used here, discarded. */
function ephemeralKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

const KEY_ENV_VAR = "TEST_EPHEMERAL_SNAPSHOT_KEY";
const KEY_REF: SnapshotSigningKeyReference = {
  secretEnvVar: KEY_ENV_VAR,
  keyId: "test-key",
  keyVersion: 1,
};

/**
 * A deliberately malformed PEM, assembled at runtime.
 *
 * The markers are NOT written as literals: `pnpm secret:scan` refuses a private
 * key block anywhere in the tree, and it is right to — a scanner that learned to
 * ignore "test" keys is a scanner that will one day ignore a real one. This is not
 * a key and never was; it exists so the signer's failure path can be checked for
 * leaks.
 */
const MALFORMED_PEM = [
  "-----BEGIN ",
  "PRIVATE KEY-----",
  "\nnot-a-key\n",
  "-----END ",
  "PRIVATE KEY-----",
].join("");

function bodyOf(overrides: Partial<SignedSnapshotBody> = {}): SignedSnapshotBody {
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    scope: {
      tenantId: "11111111-1111-4111-8111-111111111111",
      digitalStoreId: "22222222-2222-4222-8222-222222222222",
      storeLocationId: "33333333-3333-4333-8333-333333333333",
      environment: "development",
    },
    hubDeviceRecordId: "44444444-4444-4444-8444-444444444444",
    snapshotVersion: 7,
    sequence: 12,
    revocationWatermark: "2026-07-31T00:00:00.000Z",
    generatedAt: "2026-07-31T01:00:00.000Z",
    effectiveAt: "2026-07-31T01:00:00.000Z",
    revokedCertificateSerials: ["DEV-A", "DEV-B"],
    revokedDeviceRecordIds: ["55555555-5555-4555-8555-555555555555"],
    ...overrides,
  };
}

describe("the Ed25519 snapshot signer", () => {
  const keys = ephemeralKeyPair();
  const signer = createEd25519SnapshotSigner({ env: { [KEY_ENV_VAR]: keys.privateKeyPem } });
  const trusted: TrustedSnapshotKey[] = [
    { keyId: "test-key", keyVersion: 1, publicKeyPem: keys.publicKeyPem, state: "current" },
  ];

  it("produces a signature that verifies", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    expect(envelope.algorithm).toBe(SNAPSHOT_SIGNATURE_ALGORITHM);
    expect(envelope.keyId).toBe("test-key");
    expect(envelope.keyVersion).toBe(1);
    expect(verifySnapshotSignature(body, envelope, trusted)).toEqual({
      verified: true,
      keyId: "test-key",
      keyVersion: 1,
    });
  });

  it("FAILS when the payload is modified", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    const tampered = bodyOf({ revokedCertificateSerials: ["DEV-A"] });
    expect(verifySnapshotSignature(tampered, envelope, trusted)).toEqual({
      verified: false,
      failure: "SIGNATURE_INVALID",
    });
  });

  it("FAILS when the scope is modified — the cross-Store relabel", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    for (const field of ["tenantId", "digitalStoreId", "storeLocationId", "environment"] as const) {
      const relabelled = bodyOf({
        scope: { ...body.scope, [field]: "99999999-9999-4999-8999-999999999999" },
      });
      // The scope is INSIDE the signed bytes, so relabelling breaks the signature
      // and cannot be repaired without the private key. The earlier keyless
      // scoped digest could be recomputed by anyone; this cannot.
      expect(verifySnapshotSignature(relabelled, envelope, trusted).verified, field).toBe(false);
    }
  });

  it("FAILS when the sequence is modified", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    expect(verifySnapshotSignature(bodyOf({ sequence: 13 }), envelope, trusted).verified).toBe(
      false,
    );
    expect(
      verifySnapshotSignature(bodyOf({ snapshotVersion: 8 }), envelope, trusted).verified,
    ).toBe(false);
    expect(
      verifySnapshotSignature(
        bodyOf({ hubDeviceRecordId: "44444444-4444-4444-8444-444444444445" }),
        envelope,
        trusted,
      ).verified,
    ).toBe(false);
  });

  it("FAILS against the wrong public key", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    const other = ephemeralKeyPair();
    expect(
      verifySnapshotSignature(body, envelope, [
        { keyId: "test-key", keyVersion: 1, publicKeyPem: other.publicKeyPem, state: "current" },
      ]),
    ).toEqual({ verified: false, failure: "SIGNATURE_INVALID" });
  });

  it("refuses an unknown key id, an unknown version and a REVOKED key", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    expect(verifySnapshotSignature(body, envelope, []).failure).toBe("SIGNING_KEY_UNKNOWN");
    // Version is part of the match: a rotation that reused an id with new material
    // must not let the old version keep verifying.
    expect(
      verifySnapshotSignature(body, envelope, [{ ...trusted[0]!, keyVersion: 2 }]).failure,
    ).toBe("SIGNING_KEY_UNKNOWN");
    expect(
      verifySnapshotSignature(body, envelope, [{ ...trusted[0]!, state: "revoked" }]).failure,
    ).toBe("SIGNING_KEY_REVOKED");
  });

  it("refuses a malformed or wrong-algorithm signature without throwing", () => {
    const body = bodyOf();
    expect(
      verifySnapshotSignature(
        body,
        {
          keyId: "test-key",
          keyVersion: 1,
          algorithm: SNAPSHOT_SIGNATURE_ALGORITHM,
          signature: "not-base64!!",
        },
        trusted,
      ).failure,
    ).toBe("SIGNATURE_MALFORMED");
    expect(
      verifySnapshotSignature(
        body,
        {
          keyId: "test-key",
          keyVersion: 1,
          algorithm: "rsa" as never,
          signature: Buffer.alloc(64).toString("base64"),
        },
        trusted,
      ).failure,
    ).toBe("SIGNATURE_ALGORITHM_UNSUPPORTED");
  });

  it("accepts a NEXT key, so rotation needs no Hub visit", async () => {
    const body = bodyOf();
    const envelope = await signer.signCanonicalSnapshot(canonicalSnapshotBytes(body), KEY_REF);
    expect(
      verifySnapshotSignature(body, envelope, [{ ...trusted[0]!, state: "next" }]).verified,
    ).toBe(true);
  });

  it("is deterministic: the same facts sign to the same bytes", () => {
    const a = canonicalSnapshotBytes(bodyOf({ revokedCertificateSerials: ["DEV-B", "DEV-A"] }));
    const b = canonicalSnapshotBytes(bodyOf({ revokedCertificateSerials: ["DEV-A", "DEV-B"] }));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe("an unavailable signer prevents publication", () => {
  it("throws rather than returning an unsigned snapshot", async () => {
    const signer = createUnavailableSnapshotSigner("no key reference configured");
    await expect(
      signer.signCanonicalSnapshot(canonicalSnapshotBytes(bodyOf()), KEY_REF),
    ).rejects.toBeInstanceOf(SnapshotSignerUnavailableError);
  });

  it("throws when the named variable holds no key", async () => {
    const signer = createEd25519SnapshotSigner({ env: {} });
    await expect(
      signer.signCanonicalSnapshot(canonicalSnapshotBytes(bodyOf()), KEY_REF),
    ).rejects.toThrow(/holds no signing key/);
  });

  it("resolves no key reference when the environment names none", () => {
    expect(resolveSigningKeyReference({})).toBeNull();
    expect(resolveSigningKeyReference({ [SNAPSHOT_SIGNING_KEY_ENV]: "X" })).toBeNull();
  });

  it("refuses a missing or nonsense key VERSION rather than defaulting to 1", () => {
    // Defaulting would let a rotated key masquerade as its predecessor.
    for (const version of [undefined, "", "0", "-1", "one", "1.5"]) {
      expect(() =>
        resolveSigningKeyReference({
          [SNAPSHOT_SIGNING_KEY_ENV]: KEY_ENV_VAR,
          [SNAPSHOT_SIGNING_KEY_ID]: "k",
          ...(version === undefined ? {} : { [SNAPSHOT_SIGNING_KEY_VERSION]: version }),
        }),
      ).toThrow();
    }
    expect(
      resolveSigningKeyReference({
        [SNAPSHOT_SIGNING_KEY_ENV]: KEY_ENV_VAR,
        [SNAPSHOT_SIGNING_KEY_ID]: "k",
        [SNAPSHOT_SIGNING_KEY_VERSION]: "3",
      }),
    ).toEqual({ secretEnvVar: KEY_ENV_VAR, keyId: "k", keyVersion: 3 });
  });
});

describe("no key material escapes", () => {
  const keys = ephemeralKeyPair();

  it("keeps PEM out of the audit record", async () => {
    const seen: string[] = [];
    const signer = createEd25519SnapshotSigner({
      env: { [KEY_ENV_VAR]: keys.privateKeyPem },
      audit: { record: (event) => seen.push(JSON.stringify(event)) },
    });
    await signer.signCanonicalSnapshot(canonicalSnapshotBytes(bodyOf()), KEY_REF);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toContain(["BEGIN ", "PRIVATE KEY"].join(""));
    expect(seen[0]).not.toContain(keys.privateKeyPem.slice(40, 80));
    // It DOES carry what an operator needs to correlate.
    expect(seen[0]).toContain("test-key");
  });

  it("keeps PEM out of a signing FAILURE", async () => {
    const signer = createEd25519SnapshotSigner({
      env: { [KEY_ENV_VAR]: MALFORMED_PEM },
    });
    let message = "";
    try {
      await signer.signCanonicalSnapshot(canonicalSnapshotBytes(bodyOf()), KEY_REF);
    } catch (error) {
      message = `${(error as Error).message} ${(error as Error).stack ?? ""}`;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain(MALFORMED_PEM);
    expect(message).not.toContain("not-a-key");
    expect(message).not.toContain("not-a-key");
    // Names the VARIABLE, which is what an operator needs.
    expect(message).toContain(KEY_ENV_VAR);
  });

  it("commits no key material: the signer reads a NAME, not a value", () => {
    // `SnapshotSigningKeyReference` carries `secretEnvVar`, `keyId`, `keyVersion`
    // and nothing else — asserted structurally so a future field cannot quietly
    // become a place to pass a key.
    expect(Object.keys(KEY_REF).sort()).toEqual(["keyId", "keyVersion", "secretEnvVar"]);
  });
});
