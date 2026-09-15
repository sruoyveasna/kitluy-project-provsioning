/**
 * The device's copy of the recovery identity proof must equal the authoritative
 * one, and must verify under the registry's own verifier.
 *
 * Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; registry migration
 * group 0224. The same discipline as `operational-csr-drift.test.ts`: the
 * firstboot agent cannot import `@kitluy/device-identity` at runtime, so a second
 * copy of security-critical bytes exists, and this is what stops it drifting.
 */
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECOVERY_IDENTITY_PROOF_KIND as AUTHORITATIVE_KIND,
  publicKeyFingerprint,
  recoveryIdentityProofBytes as authoritativeBytes,
  verifyRecoveryIdentityProof,
} from "@kitluy/device-identity";

import { createHttpOperationalCertificateClient } from "../src/adapters/http-operational-certificate-client.js";
import { DEVICE_IDENTITY_KEY_PATH } from "../src/edge-pairing.js";
import {
  DEVICE_IDENTITY_PRIVATE_KEY_PATH,
  RECOVERY_IDENTITY_PROOF_KIND,
  RecoveryIdentityError,
  fileRecoveryIdentitySigner,
  recoveryIdentityProofBytes,
} from "../src/operational-recovery-identity-bytes.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kitluy-recovery-identity-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeKey(type: "ed25519" | "rsa"): string {
  const { privateKey } =
    type === "ed25519"
      ? generateKeyPairSync("ed25519")
      : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const path = join(dir, `${type}.key.pem`);
  writeFileSync(path, privateKey.export({ type: "pkcs8", format: "pem" }).toString(), {
    mode: 0o600,
  });
  return path;
}

describe("the recovery identity preimage does not drift", () => {
  it("uses the same domain separator", () => {
    expect(RECOVERY_IDENTITY_PROOF_KIND).toBe(AUTHORITATIVE_KIND);
  });

  it("produces identical bytes across randomised inputs", () => {
    for (let i = 0; i < 50; i += 1) {
      const fingerprint = randomBytes(32).toString("hex");
      const csr = new Uint8Array(randomBytes(64 + i * 7));
      expect(Buffer.from(recoveryIdentityProofBytes(fingerprint, csr)).toString("hex")).toBe(
        Buffer.from(authoritativeBytes(fingerprint, csr)).toString("hex"),
      );
    }
  });

  it("refuses a malformed fingerprint the way the authoritative copy does", () => {
    const csr = new Uint8Array(randomBytes(32));
    for (const bad of ["", "AB".repeat(32), "ab".repeat(31), `${"ab".repeat(32)}\n`]) {
      expect(() => recoveryIdentityProofBytes(bad, csr)).toThrow(
        /KLUY-RECOVERY-IDENTITY-MALFORMED/,
      );
      expect(() => authoritativeBytes(bad, csr)).toThrow(/KLUY-RECOVERY-IDENTITY-MALFORMED/);
    }
  });

  it("signs with the key pairing already uses", () => {
    expect(DEVICE_IDENTITY_PRIVATE_KEY_PATH).toBe(DEVICE_IDENTITY_KEY_PATH);
  });
});

describe("the device signer", () => {
  it("produces a proof the REGISTRY verifier accepts, naming the enrolled fingerprint", () => {
    const signer = fileRecoveryIdentitySigner(writeKey("ed25519"));
    const csr = new Uint8Array(Buffer.from(`kitluy.csr.v1\n${randomUUID()}`, "utf8"));
    const proof = signer(csr);

    const verdict = verifyRecoveryIdentityProof(
      proof.identityPublicKeyPem,
      csr,
      new Uint8Array(Buffer.from(proof.identityProofBase64, "base64")),
    );
    expect(verdict).toEqual({
      verified: true,
      identityPublicKeyFingerprint: publicKeyFingerprint(proof.identityPublicKeyPem),
    });

    // Bound to THESE bytes: the same proof over a different request fails.
    const other = new Uint8Array(Buffer.from(`kitluy.csr.v1\n${randomUUID()}`, "utf8"));
    expect(
      verifyRecoveryIdentityProof(
        proof.identityPublicKeyPem,
        other,
        new Uint8Array(Buffer.from(proof.identityProofBase64, "base64")),
      ).verified,
    ).toBe(false);
  });

  it("is deterministic, so a replayed request carries the identical proof", () => {
    const signer = fileRecoveryIdentitySigner(writeKey("ed25519"));
    const csr = new Uint8Array(randomBytes(128));
    expect(signer(csr)).toEqual(signer(csr));
  });

  it("refuses a key that is not Ed25519", () => {
    const signer = fileRecoveryIdentitySigner(writeKey("rsa"));
    expect(() => signer(new Uint8Array(8))).toThrow(RecoveryIdentityError);
  });

  it("never quotes the key file when it cannot be read", () => {
    const path = join(dir, "broken.key.pem");
    // Built at runtime so secret-scan.mjs does not read the stub as a key.
    const pemLabel = "PRIVATE KEY";
    writeFileSync(
      path,
      `-----BEGIN ${pemLabel}-----\nnot base64 at all\n-----END ${pemLabel}-----\n`,
    );
    let message = "";
    try {
      fileRecoveryIdentitySigner(path)(new Uint8Array(8));
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryIdentityError);
      message = (error as Error).message;
    }
    expect(message).toContain("withheld");
    expect(message).not.toContain("not base64 at all");
  });
});

describe("the HTTP transport sends both identity fields, or neither", () => {
  async function bodySent(identity?: {
    identityPublicKeyPem: string;
    identityProofBase64: string;
  }) {
    let sent: Record<string, unknown> = {};
    const client = createHttpOperationalCertificateClient({
      baseUrl: "http://fleet.invalid",
      fetchImpl: (async (_url: unknown, init?: { body?: unknown }) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", details: {} } }), {
          status: 422,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });
    await client.request({
      csr: {
        requestId: randomUUID(),
        deviceRecordId: randomUUID(),
        environment: "development",
        publicKeyFingerprint: "ab".repeat(32),
        hardwareTrustLevel: "development_software",
        assignmentGeneration: 1,
        requestedPurpose: "device_identity",
        requestedAt: new Date().toISOString(),
        nonce: randomUUID(),
        correlationId: randomUUID(),
      },
      operationalPublicKeyPem: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n",
      proofOfPossessionBase64: "AAAA",
      ...(identity === undefined ? {} : { identity }),
    });
    return sent;
  }

  it("sends neither without an identity proof", async () => {
    const sent = await bodySent();
    expect(sent).not.toHaveProperty("identityPublicKeyPem");
    expect(sent).not.toHaveProperty("identityProof");
  });

  it("sends both with one", async () => {
    const sent = await bodySent({ identityPublicKeyPem: "PEM", identityProofBase64: "SIG" });
    expect(sent.identityPublicKeyPem).toBe("PEM");
    expect(sent.identityProof).toBe("SIG");
  });
});
