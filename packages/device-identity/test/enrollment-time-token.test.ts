/**
 * The signed trusted-time token a freshly enrolled device receives.
 *
 * These tests exist because this token is the ONLY thing standing between a
 * factory-fresh device and its first trusted-time floor — and that floor is
 * what every certificate window is later judged against. A token that verified
 * when it should not would let an attacker set a device's notion of time.
 */
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ENROLLMENT_TIME_TOKEN_KIND,
  ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS,
  enrollmentTimeTokenBytes,
  enrollmentTimeTokenHash,
  findEnrollmentTokenSeparatorInjection,
  verifyEnrollmentTimeToken,
  type EnrollmentTimeToken,
  type EnrollmentTimeTokenExpectation,
  type SnapshotSignatureEnvelope,
  type TrustedSnapshotKey,
} from "../src/index.js";

const DEVICE = "11111111-1111-4111-8111-111111111111";
const CHALLENGE = "22222222-2222-4222-8222-222222222222";
const ISSUER = "kitluy.cloud.device-registry";
const ISSUED = new Date("2026-08-12T09:00:00.000Z");

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

function token(overrides: Partial<EnrollmentTimeToken> = {}): EnrollmentTimeToken {
  return {
    protocolVersion: "1",
    issuer: ISSUER,
    deviceRecordId: DEVICE,
    challengeId: CHALLENGE,
    environment: "development",
    issuedAt: ISSUED,
    expiresAt: new Date(ISSUED.getTime() + ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS * 1000),
    ...overrides,
  };
}

function expectation(
  overrides: Partial<EnrollmentTimeTokenExpectation> = {},
): EnrollmentTimeTokenExpectation {
  return {
    issuer: ISSUER,
    deviceRecordId: DEVICE,
    challengeId: CHALLENGE,
    environment: "development",
    ...overrides,
  };
}

function signWith(
  t: EnrollmentTimeToken,
  privateKeyPem: string,
  envelope: Partial<SnapshotSignatureEnvelope> = {},
): SnapshotSignatureEnvelope {
  return {
    keyId: "enrollment-time-dev",
    keyVersion: 1,
    algorithm: "ed25519",
    signature: Buffer.from(
      nodeSign(null, Buffer.from(enrollmentTimeTokenBytes(t)), privateKeyPem),
    ).toString("base64"),
    ...envelope,
  };
}

function trusted(publicKeyPem: string, state: TrustedSnapshotKey["state"] = "current") {
  return [{ keyId: "enrollment-time-dev", keyVersion: 1, publicKeyPem, state }];
}

describe("canonical bytes", () => {
  it("lead with the kind, so a signature cannot be replayed across record types", () => {
    const text = Buffer.from(enrollmentTimeTokenBytes(token())).toString("utf8");
    expect(text.startsWith(ENROLLMENT_TIME_TOKEN_KIND)).toBe(true);
  });

  it("are stable for the same token", () => {
    expect(enrollmentTimeTokenHash(token())).toBe(enrollmentTimeTokenHash(token()));
  });

  it("differ when the device binding differs", () => {
    expect(enrollmentTimeTokenHash(token())).not.toBe(
      enrollmentTimeTokenHash(token({ deviceRecordId: "33333333-3333-4333-8333-333333333333" })),
    );
  });

  it("differ when the challenge binding differs", () => {
    expect(enrollmentTimeTokenHash(token())).not.toBe(
      enrollmentTimeTokenHash(token({ challengeId: "44444444-4444-4444-8444-444444444444" })),
    );
  });

  it("reject a field carrying a line separator, which would make the encoding ambiguous", () => {
    expect(findEnrollmentTokenSeparatorInjection(token({ issuer: "a\nb" }))).toBe("issuer");
    expect(findEnrollmentTokenSeparatorInjection(token())).toBeNull();
  });
});

describe("the authorised path", () => {
  it("accepts a correctly signed, correctly bound token and returns issuedAt as trusted time", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      signWith(t, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict.accepted).toBe(true);
    if (verdict.accepted) {
      expect(verdict.trustedTime.toISOString()).toBe(ISSUED.toISOString());
      expect(verdict.keyId).toBe("enrollment-time-dev");
    }
  });
});

describe("fail-closed refusals", () => {
  it("refuses a payload whose time was moved forward under a captured signature", () => {
    // THE attack this token has to survive: replay a legitimate signature over
    // a body whose clock has been advanced. Both ends of the window shift
    // together, so the token stays internally consistent and every binding
    // still matches — only the signature can catch it.
    const { privateKeyPem, publicKeyPem } = keypair();
    const original = token();
    const envelope = signWith(original, privateKeyPem);

    const shifted = new Date("2027-01-01T00:00:00.000Z");
    const tampered = token({
      issuedAt: shifted,
      expiresAt: new Date(shifted.getTime() + ENROLLMENT_TIME_TOKEN_VALIDITY_SECONDS * 1000),
    });

    const verdict = verifyEnrollmentTimeToken(
      tampered,
      envelope,
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNATURE_INVALID" });
  });

  it("refuses a token signed by the wrong key", () => {
    const attacker = keypair();
    const legitimate = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      signWith(t, attacker.privateKeyPem),
      trusted(legitimate.publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNATURE_INVALID" });
  });

  it("refuses a token minted for a DIFFERENT device, even though the signature is valid", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const other = token({ deviceRecordId: "99999999-9999-4999-8999-999999999999" });
    const verdict = verifyEnrollmentTimeToken(
      other,
      signWith(other, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WRONG_DEVICE" });
  });

  it("refuses a token from a DIFFERENT enrollment exchange — replay of an earlier token", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const replayed = token({ challengeId: "88888888-8888-4888-8888-888888888888" });
    const verdict = verifyEnrollmentTimeToken(
      replayed,
      signWith(replayed, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WRONG_CHALLENGE" });
  });

  it("refuses a token minted for another environment", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const other = token({ environment: "production" });
    const verdict = verifyEnrollmentTimeToken(
      other,
      signWith(other, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WRONG_ENVIRONMENT" });
  });

  it("refuses a token from an unexpected issuer", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const other = token({ issuer: "attacker.example" });
    const verdict = verifyEnrollmentTimeToken(
      other,
      signWith(other, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WRONG_ISSUER" });
  });

  it("refuses an unsigned token — a missing envelope is not a soft failure", () => {
    expect(verifyEnrollmentTimeToken(token(), null, [], expectation())).toEqual({
      accepted: false,
      refusal: "TIME_TOKEN_MISSING",
    });
    expect(verifyEnrollmentTimeToken(null, null, [], expectation())).toEqual({
      accepted: false,
      refusal: "TIME_TOKEN_MISSING",
    });
  });

  it("refuses an unknown signing key id", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      signWith(t, privateKeyPem, { keyId: "some-other-key" }),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNING_KEY_UNKNOWN" });
  });

  it("refuses a rotated key version reusing the same key id", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      signWith(t, privateKeyPem, { keyVersion: 2 }),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNING_KEY_UNKNOWN" });
  });

  it("refuses a revoked key even when its signature is good", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      signWith(t, privateKeyPem),
      trusted(publicKeyPem, "revoked"),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNING_KEY_REVOKED" });
  });

  it("refuses an unsupported algorithm before doing any cryptography", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      { ...signWith(t, privateKeyPem), algorithm: "rsa" as never },
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_ALGORITHM_UNSUPPORTED" });
  });

  it("refuses a malformed signature rather than throwing", () => {
    const { publicKeyPem } = keypair();
    const t = token();
    const verdict = verifyEnrollmentTimeToken(
      t,
      { keyId: "enrollment-time-dev", keyVersion: 1, algorithm: "ed25519", signature: "!!not-b64" },
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SIGNATURE_MALFORMED" });
  });

  it("refuses a window wider than policy, because a long-lived time assertion is standing authority", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const wide = token({ expiresAt: new Date(ISSUED.getTime() + 30 * 24 * 3600 * 1000) });
    const verdict = verifyEnrollmentTimeToken(
      wide,
      signWith(wide, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WINDOW_INVALID" });
  });

  it("refuses an inverted window", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const inverted = token({ expiresAt: new Date(ISSUED.getTime() - 1000) });
    const verdict = verifyEnrollmentTimeToken(
      inverted,
      signWith(inverted, privateKeyPem),
      trusted(publicKeyPem),
      expectation(),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_WINDOW_INVALID" });
  });

  it("refuses separator injection before any cryptography", () => {
    const { privateKeyPem, publicKeyPem } = keypair();
    const injected = token({ deviceRecordId: `${DEVICE}\nkitluy.enrollment-time-token.v1` });
    const verdict = verifyEnrollmentTimeToken(
      injected,
      signWith(injected, privateKeyPem),
      trusted(publicKeyPem),
      expectation({ deviceRecordId: injected.deviceRecordId }),
    );
    expect(verdict).toEqual({ accepted: false, refusal: "TIME_TOKEN_SEPARATOR_INJECTION" });
  });
});
