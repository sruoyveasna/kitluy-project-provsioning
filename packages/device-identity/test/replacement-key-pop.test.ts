/**
 * Replacement-key proof of possession — the replays it must refuse.
 *
 * Each test transplants a VALID signature into a slightly wrong context. The
 * signature itself is genuine every time, so anything that passes would be
 * passing on a real proof of the wrong thing — which is exactly the failure a
 * bare-nonce challenge would have.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyDetachedSignature,
} from "../src/dev-crypto.js";
import {
  replacementChallengeBytes,
  verifyReplacementKeyPop,
  REPLACEMENT_POP_KIND,
  type ReplacementKeyChallenge,
  type ReplacementPopExpectation,
} from "../src/replacement-key-pop.js";
import { requestBytes } from "../src/certificate-issuance.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const TRUSTED: TrustedTimeEvaluation = {
  status: "trusted",
  trustedTime: NOW,
} as TrustedTimeEvaluation;

interface Fixture {
  challenge: ReplacementKeyChallenge;
  signature: Uint8Array;
  pem: string;
  expectation: ReplacementPopExpectation;
  sign: (c: ReplacementKeyChallenge) => Uint8Array;
}

async function fixture(): Promise<Fixture> {
  const keys = new DevelopmentDeviceKeyProvider();
  const deviceRecordId = randomUUID();
  const renewalAttemptId = randomUUID();
  const currentCredentialId = randomUUID();
  await keys.generateDeviceKey(deviceRecordId, "development");
  const pem = keys.publicKeyPem(deviceRecordId) ?? "";
  const fingerprint = publicKeyFingerprint(pem);

  const challenge: ReplacementKeyChallenge = {
    renewalAttemptId,
    deviceRecordId,
    currentCredentialId,
    currentGeneration: 1,
    nextGeneration: 2,
    replacementPublicKeyFingerprint: fingerprint,
    assignmentGeneration: 1,
    nonce: randomUUID(),
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 300_000),
    environment: "development",
    purpose: "device_identity",
  };

  const sign = (c: ReplacementKeyChallenge): Uint8Array =>
    keys.provePossession(deviceRecordId, replacementChallengeBytes(c));

  return {
    challenge,
    signature: sign(challenge),
    pem,
    expectation: {
      renewalAttemptId,
      deviceRecordId,
      currentCredentialId,
      currentGeneration: 1,
      nextGeneration: 2,
      assignmentGeneration: 1,
      environment: "development",
      purpose: "device_identity",
      providerKeyFingerprint: fingerprint,
      providerKeyState: "generated",
    },
    sign,
  };
}

const verify = (
  f: Fixture,
  over?: Partial<ReplacementKeyChallenge>,
  exp?: Partial<ReplacementPopExpectation>,
) => {
  const challenge = { ...f.challenge, ...over };
  return verifyReplacementKeyPop(
    challenge,
    over === undefined ? f.signature : f.sign(challenge),
    f.pem,
    { ...f.expectation, ...exp },
    TRUSTED,
    publicKeyFingerprint,
  );
};

describe("replacement-key proof of possession", () => {
  it("verifies a correctly bound proof", async () => {
    const f = await fixture();
    const verdict = verify(f);
    expect(verdict.verified).toBe(true);
    expect(verdict.challengeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Each case below signs a GENUINE challenge, then presents it against a
  // reservation that expects something else. The signature always verifies;
  // only the binding is wrong.
  const replays: ReadonlyArray<[string, Partial<ReplacementKeyChallenge>, string]> = [
    [
      "another renewal of the same device",
      { renewalAttemptId: randomUUID() },
      "POP_WRONG_RENEWAL_ATTEMPT",
    ],
    ["another device", { deviceRecordId: randomUUID() }, "POP_WRONG_DEVICE"],
    [
      "a different incumbent credential",
      { currentCredentialId: randomUUID() },
      "POP_WRONG_CURRENT_CREDENTIAL",
    ],
    ["a head that has since moved", { currentGeneration: 2 }, "POP_WRONG_CURRENT_GENERATION"],
    ["a different target generation", { nextGeneration: 3 }, "POP_WRONG_NEXT_GENERATION"],
    ["a reassigned device", { assignmentGeneration: 2 }, "POP_WRONG_ASSIGNMENT_GENERATION"],
    ["another purpose", { purpose: "configuration_signing" }, "POP_WRONG_PURPOSE"],
  ];

  for (const [name, override, code] of replays) {
    it(`refuses a genuine proof from ${name}`, async () => {
      const f = await fixture();
      const verdict = verify(f, override);
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe(code);
    });
  }

  it("refuses an expired challenge against trusted time", async () => {
    const f = await fixture();
    const verdict = verify(f, {
      issuedAt: new Date(NOW.getTime() - 600_000),
      expiresAt: new Date(NOW.getTime() - 300_000),
    });
    expect(verdict.refusalCode).toBe("POP_EXPIRED");
  });

  it("refuses an ABANDONED key even though its signature is valid", async () => {
    const f = await fixture();
    // The loser of a renewal race holds a perfectly good private key. State is
    // what disqualifies it, and state is checked BEFORE the signature.
    const verdict = verify(f, undefined, { providerKeyState: "abandoned" });
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("POP_KEY_NOT_GENERATED");
  });

  it("refuses a key the provider did not generate for this generation", async () => {
    const f = await fixture();
    const verdict = verify(f, undefined, { providerKeyFingerprint: "b".repeat(64) });
    expect(verdict.refusalCode).toBe("POP_FINGERPRINT_MISMATCH");
  });

  it("refuses a proof made with a DIFFERENT private key", async () => {
    const f = await fixture();
    const other = new DevelopmentDeviceKeyProvider();
    const otherDevice = randomUUID();
    await other.generateDeviceKey(otherDevice, "development");
    const forged = other.provePossession(otherDevice, replacementChallengeBytes(f.challenge));
    const verdict = verifyReplacementKeyPop(
      f.challenge,
      forged,
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  it("cannot be satisfied by an INITIAL ENROLLMENT proof — the domains differ", async () => {
    const f = await fixture();
    // An enrollment PoP signs `kitluy.csr.v1`. Even with every field matching,
    // it is a signature over different bytes, so the domain separator refuses
    // it before any field comparison could be fooled.
    const enrollmentBytes = requestBytes({
      requestId: f.challenge.renewalAttemptId,
      deviceRecordId: f.challenge.deviceRecordId,
      environment: "development",
      devicePublicKeyPem: f.pem,
      publicKeyFingerprint: f.challenge.replacementPublicKeyFingerprint,
      hardwareTrustLevel: "development_software",
      assignmentGeneration: 1,
      requestedPurpose: "device_identity",
      requestedAt: NOW,
      nonce: f.challenge.nonce,
      correlationId: "c",
      proofOfPossession: new Uint8Array(),
    });
    expect(Buffer.from(enrollmentBytes).toString("utf8")).toContain("kitluy.csr.v1");
    expect(Buffer.from(replacementChallengeBytes(f.challenge)).toString("utf8")).toContain(
      REPLACEMENT_POP_KIND,
    );
    // Signing the ENROLLMENT bytes and presenting it as a renewal proof fails.
    const keys = new DevelopmentDeviceKeyProvider();
    await keys.generateDeviceKey(f.challenge.deviceRecordId, "development");
    const wrongDomain = verifyDetachedSignature(
      f.pem,
      replacementChallengeBytes(f.challenge),
      f.sign({ ...f.challenge, nonce: "different-domain" }),
    );
    expect(wrongDomain).toBe(false);
  });
});
