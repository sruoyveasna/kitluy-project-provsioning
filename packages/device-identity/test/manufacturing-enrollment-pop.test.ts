/**
 * Factory-enrollment proof of possession.
 *
 * What this proof must establish: the caller holds the private half of the key
 * it is presenting. A captured manufacturing ticket must not be redeemable
 * against somebody else's public key, and that is what the fingerprint binding
 * below enforces — the signature alone would verify perfectly against the
 * attacker's own key.
 */
import {
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  createHash,
} from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  MANUFACTURING_ENROLLMENT_POP_KIND,
  MANUFACTURING_ENROLLMENT_POP_PURPOSE,
  manufacturingEnrollmentChallengeBytes,
  verifyManufacturingEnrollmentPop,
  type ManufacturingEnrollmentPopChallenge,
  type ManufacturingEnrollmentPopExpectation,
} from "../src/index.js";

const CHALLENGE_ID = "11111111-1111-4111-8111-111111111111";
const NONCE = "b".repeat(64);
const ISSUED = new Date("2026-08-12T09:00:00.000Z");
const EXPIRES = new Date("2026-08-12T09:05:00.000Z");
const NOW = new Date("2026-08-12T09:01:00.000Z");

function fingerprint(pem: string): string {
  const der = createPublicKey(pem).export({ type: "spki", format: "der" });
  return createHash("sha256").update(new Uint8Array(der)).digest("hex");
}

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem,
    fingerprint: fingerprint(publicKeyPem),
  };
}

function challenge(
  fp: string,
  overrides: Partial<ManufacturingEnrollmentPopChallenge> = {},
): ManufacturingEnrollmentPopChallenge {
  return {
    challengeId: CHALLENGE_ID,
    purpose: MANUFACTURING_ENROLLMENT_POP_PURPOSE,
    environment: "development",
    presentedKeyFingerprint: fp,
    nonce: NONCE,
    issuedAt: ISSUED,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function expectation(
  fp: string,
  overrides: Partial<ManufacturingEnrollmentPopExpectation> = {},
): ManufacturingEnrollmentPopExpectation {
  return {
    challengeId: CHALLENGE_ID,
    environment: "development",
    presentedKeyFingerprint: fp,
    nonce: NONCE,
    expiresAt: EXPIRES,
    ...overrides,
  };
}

function sign(c: ManufacturingEnrollmentPopChallenge, privateKeyPem: string): Uint8Array {
  return new Uint8Array(
    nodeSign(null, Buffer.from(manufacturingEnrollmentChallengeBytes(c)), privateKeyPem),
  );
}

const verify = (pem: string, payload: Uint8Array, sig: Uint8Array): boolean =>
  nodeVerify(null, Buffer.from(payload), createPublicKey(pem), sig);

describe("canonical bytes", () => {
  it("lead with the kind, so the proof cannot be replayed as another proof type", () => {
    const k = keypair();
    const text = Buffer.from(
      manufacturingEnrollmentChallengeBytes(challenge(k.fingerprint)),
    ).toString("utf8");
    expect(text.startsWith(MANUFACTURING_ENROLLMENT_POP_KIND)).toBe(true);
  });
});

describe("the authorised path", () => {
  it("accepts a proof signed by the presented key", () => {
    const k = keypair();
    const c = challenge(k.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.verified).toBe(true);
    expect(verdict.challengeHash).toBeDefined();
  });
});

describe("fail-closed refusals", () => {
  it("refuses a proof signed by the WRONG private key", () => {
    const legit = keypair();
    const attacker = keypair();
    const c = challenge(legit.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, attacker.privateKeyPem),
      legit.publicKeyPem,
      expectation(legit.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  it("refuses when the presented KEY is not the key the challenge names", () => {
    // The attack this binding exists for: a captured ticket redeemed against
    // an attacker's own key pair. The signature verifies — against the wrong key.
    const legit = keypair();
    const attacker = keypair();
    const c = challenge(attacker.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, attacker.privateKeyPem),
      attacker.publicKeyPem,
      expectation(legit.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_KEY_MISMATCH");
  });

  it("refuses a PEM that does not hash to its claimed fingerprint", () => {
    const k = keypair();
    const other = keypair();
    const c = challenge(k.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      other.publicKeyPem, // PEM and fingerprint disagree
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_KEY_MISMATCH");
  });

  it("refuses a proof for a different challenge — replay of an earlier exchange", () => {
    const k = keypair();
    const c = challenge(k.fingerprint, { challengeId: "99999999-9999-4999-8999-999999999999" });
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_WRONG_CHALLENGE");
  });

  it("refuses a proof that does not carry the issued nonce", () => {
    const k = keypair();
    const c = challenge(k.fingerprint, { nonce: "c".repeat(64) });
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_WRONG_CHALLENGE");
  });

  it("refuses a proof naming another purpose", () => {
    const k = keypair();
    const c = challenge(k.fingerprint, { purpose: "terminal_provisioning_redemption" });
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_WRONG_PURPOSE");
  });

  it("refuses a proof naming another environment", () => {
    const k = keypair();
    const c = challenge(k.fingerprint, { environment: "production" });
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_WRONG_ENVIRONMENT");
  });

  it("refuses a tampered payload under a captured signature", () => {
    const k = keypair();
    const original = challenge(k.fingerprint);
    const signature = sign(original, k.privateKeyPem);
    // Same bindings, different signed time window — only the signature catches it.
    const tampered = challenge(k.fingerprint, {
      issuedAt: new Date("2026-08-12T08:00:00.000Z"),
    });
    const verdict = verifyManufacturingEnrollmentPop(
      tampered,
      signature,
      k.publicKeyPem,
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  it("refuses an expired challenge", () => {
    const k = keypair();
    const c = challenge(k.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(k.fingerprint),
      new Date("2026-08-12T09:10:00.000Z"),
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_EXPIRED");
  });

  it("refuses separator injection before any cryptography", () => {
    const k = keypair();
    const injected = `${k.fingerprint}\nkitluy.manufacturing-enrollment-pop.v1`;
    const c = challenge(injected);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      k.publicKeyPem,
      expectation(injected),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.refusalCode).toBe("POP_SEPARATOR_INJECTION");
  });

  it("refuses a malformed public key rather than throwing", () => {
    const k = keypair();
    const c = challenge(k.fingerprint);
    const verdict = verifyManufacturingEnrollmentPop(
      c,
      sign(c, k.privateKeyPem),
      "not-a-pem",
      expectation(k.fingerprint),
      NOW,
      fingerprint,
      verify,
    );
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("POP_KEY_MISMATCH");
  });
});
