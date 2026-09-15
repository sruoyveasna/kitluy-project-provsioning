/**
 * The recovery identity proof verifier (KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001).
 *
 * The registry trusts this verdict before it reserves a recovery, so every way
 * a proof can be wrong must come back `verified: false` rather than throw or
 * pass.
 */
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  RECOVERY_IDENTITY_PROOF_KIND,
  publicKeyFingerprint,
  recoveryIdentityProofBytes,
  verifyRecoveryIdentityProof,
} from "../src/index.js";

function ed25519() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privateKey,
  };
}

function prove(key: ReturnType<typeof ed25519>, csr: Uint8Array): Uint8Array {
  return new Uint8Array(
    sign(
      null,
      Buffer.from(recoveryIdentityProofBytes(publicKeyFingerprint(key.publicKeyPem), csr)),
      key.privateKey,
    ),
  );
}

describe("recoveryIdentityProofBytes", () => {
  it("is domain-separated, names the key, and binds the request digest", () => {
    const fingerprint = "ab".repeat(32);
    const text = Buffer.from(
      recoveryIdentityProofBytes(fingerprint, new Uint8Array([1, 2, 3])),
    ).toString("utf8");
    const [kind, named, digest] = text.split("\n");
    expect(kind).toBe(RECOVERY_IDENTITY_PROOF_KIND);
    expect(named).toBe(fingerprint);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyRecoveryIdentityProof", () => {
  const csr = new Uint8Array(randomBytes(96));

  it("verifies a proof by the named key over the exact request", () => {
    const key = ed25519();
    expect(verifyRecoveryIdentityProof(key.publicKeyPem, csr, prove(key, csr))).toEqual({
      verified: true,
      identityPublicKeyFingerprint: publicKeyFingerprint(key.publicKeyPem),
    });
  });

  it("refuses a proof over a different request", () => {
    const key = ed25519();
    const other = new Uint8Array(randomBytes(96));
    expect(verifyRecoveryIdentityProof(key.publicKeyPem, other, prove(key, csr)).verified).toBe(
      false,
    );
  });

  it("refuses a proof presented under someone else's key", () => {
    const signer = ed25519();
    const presented = ed25519();
    expect(
      verifyRecoveryIdentityProof(presented.publicKeyPem, csr, prove(signer, csr)).verified,
    ).toBe(false);
  });

  it("refuses a key that is not Ed25519", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const verdict = verifyRecoveryIdentityProof(
      publicKey.export({ type: "spki", format: "pem" }).toString(),
      csr,
      new Uint8Array(64),
    );
    expect(verdict.verified).toBe(false);
  });

  it("refuses an unreadable key and a malformed signature without throwing", () => {
    expect(verifyRecoveryIdentityProof("not a pem", csr, new Uint8Array(64)).verified).toBe(false);
    expect(
      verifyRecoveryIdentityProof(ed25519().publicKeyPem, csr, new Uint8Array(3)).verified,
    ).toBe(false);
  });
});
