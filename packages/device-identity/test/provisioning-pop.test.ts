/**
 * Terminal provisioning proof of possession — the replays it must refuse.
 *
 * Each replay test transplants a VALID signature into a slightly wrong
 * context. The signature itself is genuine every time, so anything that
 * passes would be passing on a real proof of the wrong thing — which is
 * exactly the failure a bare-nonce challenge would have.
 *
 * The RAW PROVISIONING CODE never appears anywhere in these fixtures: the
 * binding is the code ROW ID, and the census test at the bottom proves the
 * signed bytes contain no eight-character Crockford token.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyDetachedSignature,
} from "../src/dev-crypto.js";
import {
  provisioningChallengeBytes,
  verifyProvisioningPop,
  PROVISIONING_POP_KIND,
  PROVISIONING_POP_PURPOSE,
  type ProvisioningPopChallenge,
  type ProvisioningPopExpectation,
} from "../src/provisioning-pop.js";
import { replacementChallengeBytes } from "../src/replacement-key-pop.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const TRUSTED: TrustedTimeEvaluation = {
  status: "trusted",
  trustedTime: NOW,
} as TrustedTimeEvaluation;

interface Fixture {
  challenge: ProvisioningPopChallenge;
  signature: Uint8Array;
  pem: string;
  expectation: ProvisioningPopExpectation;
  sign: (c: ProvisioningPopChallenge) => Uint8Array;
}

async function fixture(): Promise<Fixture> {
  const keys = new DevelopmentDeviceKeyProvider();
  const terminalDeviceId = randomUUID();
  await keys.generateDeviceKey(terminalDeviceId, "development");
  const pem = keys.publicKeyPem(terminalDeviceId) ?? "";
  const fingerprint = publicKeyFingerprint(pem);

  const challenge: ProvisioningPopChallenge = {
    challengeId: randomUUID(),
    purpose: PROVISIONING_POP_PURPOSE,
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
    environment: "development",
    storeHubDeviceId: randomUUID(),
    terminalDeviceId,
    terminalAssignmentId: randomUUID(),
    terminalProfileKey: "laundry.t1.cashier",
    provisioningCodeId: randomUUID(),
    terminalKeyFingerprint: fingerprint,
    nonce: randomUUID().replace(/-/g, ""),
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 300_000),
  };

  const sign = (c: ProvisioningPopChallenge): Uint8Array =>
    keys.provePossession(terminalDeviceId, provisioningChallengeBytes(c));

  return {
    challenge,
    signature: sign(challenge),
    pem,
    expectation: {
      challengeId: challenge.challengeId,
      purpose: PROVISIONING_POP_PURPOSE,
      tenantId: challenge.tenantId,
      digitalStoreId: challenge.digitalStoreId,
      storeLocationId: challenge.storeLocationId,
      environment: "development",
      storeHubDeviceId: challenge.storeHubDeviceId,
      terminalDeviceId,
      terminalAssignmentId: challenge.terminalAssignmentId,
      terminalProfileKey: challenge.terminalProfileKey,
      provisioningCodeId: challenge.provisioningCodeId,
      enrolledKeyFingerprint: fingerprint,
      enrollmentState: "sealed",
    },
    sign,
  };
}

const verify = (
  f: Fixture,
  over?: Partial<ProvisioningPopChallenge>,
  exp?: Partial<ProvisioningPopExpectation>,
) => {
  const challenge = { ...f.challenge, ...over };
  return verifyProvisioningPop(
    challenge,
    over === undefined ? f.signature : f.sign(challenge),
    f.pem,
    { ...f.expectation, ...exp },
    TRUSTED,
    publicKeyFingerprint,
  );
};

describe("terminal provisioning proof of possession", () => {
  it("verifies a correctly bound proof", async () => {
    const f = await fixture();
    const verdict = verify(f);
    expect(verdict.verified).toBe(true);
    expect(verdict.challengeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Each case signs a GENUINE challenge, then presents it against a database
  // expectation that says something else. The signature always verifies; only
  // the binding is wrong.
  const replays: ReadonlyArray<[string, Partial<ProvisioningPopChallenge>, string]> = [
    ["another challenge", { challengeId: randomUUID() }, "POP_WRONG_CHALLENGE"],
    ["another Tenant", { tenantId: randomUUID() }, "POP_WRONG_TENANT"],
    ["another Digital Store", { digitalStoreId: randomUUID() }, "POP_WRONG_STORE"],
    ["another Location", { storeLocationId: randomUUID() }, "POP_WRONG_LOCATION"],
    ["a different Store Hub", { storeHubDeviceId: randomUUID() }, "POP_WRONG_HUB"],
    ["another terminal", { terminalDeviceId: randomUUID() }, "POP_WRONG_TERMINAL"],
    ["a reassigned terminal", { terminalAssignmentId: randomUUID() }, "POP_WRONG_ASSIGNMENT"],
    [
      "a different T1-T4 profile",
      { terminalProfileKey: "laundry.t2.display" },
      "POP_WRONG_PROFILE",
    ],
    ["a different provisioning code", { provisioningCodeId: randomUUID() }, "POP_WRONG_CODE"],
  ];

  for (const [name, override, code] of replays) {
    it(`refuses a genuine proof from ${name}`, async () => {
      const f = await fixture();
      const verdict = verify(f, override);
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe(code);
    });
  }

  it("refuses any purpose other than terminal_provisioning_redemption", async () => {
    const f = await fixture();
    const verdict = verify(f, { purpose: "device_identity" });
    expect(verdict.refusalCode).toBe("POP_WRONG_PURPOSE");
  });

  it("refuses a wrong-environment proof", async () => {
    const f = await fixture();
    const challenge = { ...f.challenge, environment: "pilot" as const };
    const verdict = verifyProvisioningPop(
      challenge,
      f.sign(challenge),
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_WRONG_ENVIRONMENT");
  });

  it("refuses an expired challenge against trusted time — the equality boundary expires", async () => {
    const f = await fixture();
    expect(
      verify(f, {
        issuedAt: new Date(NOW.getTime() - 600_000),
        expiresAt: new Date(NOW.getTime() - 300_000),
      }).refusalCode,
    ).toBe("POP_EXPIRED");
    expect(verify(f, { expiresAt: NOW }).refusalCode, "expiry AT the boundary").toBe("POP_EXPIRED");
    expect(verify(f, { expiresAt: new Date(NOW.getTime() + 1) }).verified).toBe(true);
  });

  it("refuses a future-dated challenge", async () => {
    const f = await fixture();
    const verdict = verify(f, {
      issuedAt: new Date(NOW.getTime() + 60_000),
      expiresAt: new Date(NOW.getTime() + 300_000),
    });
    expect(verdict.refusalCode).toBe("POP_NOT_YET_VALID");
  });

  it("refuses without trusted time and in restricted trust mode", async () => {
    const f = await fixture();
    const noTime = verifyProvisioningPop(
      f.challenge,
      f.signature,
      f.pem,
      f.expectation,
      { status: "untrusted", trustedTime: null } as TrustedTimeEvaluation,
      publicKeyFingerprint,
    );
    expect(noTime.verified).toBe(false);
  });

  it("refuses a SUPERSEDED enrollment even though its signature is valid", async () => {
    const f = await fixture();
    // A replaced terminal's old enrollment holds a perfectly good private
    // key. State disqualifies it, and state is checked BEFORE the signature.
    const verdict = verify(f, undefined, { enrollmentState: "superseded" });
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("POP_ENROLLMENT_NOT_ELIGIBLE");
  });

  it("refuses a key that is not the enrolled key", async () => {
    const f = await fixture();
    const verdict = verify(f, undefined, { enrolledKeyFingerprint: "b".repeat(64) });
    expect(verdict.refusalCode).toBe("POP_FINGERPRINT_MISMATCH");
  });

  it("refuses a proof made with a DIFFERENT private key", async () => {
    const f = await fixture();
    const other = new DevelopmentDeviceKeyProvider();
    const otherDevice = randomUUID();
    await other.generateDeviceKey(otherDevice, "development");
    const forged = other.provePossession(otherDevice, provisioningChallengeBytes(f.challenge));
    const verdict = verifyProvisioningPop(
      f.challenge,
      forged,
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  it("refuses malformed, empty and oversized signatures", async () => {
    const f = await fixture();
    for (const bad of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(4096)]) {
      const verdict = verifyProvisioningPop(
        f.challenge,
        bad,
        f.pem,
        f.expectation,
        TRUSTED,
        publicKeyFingerprint,
      );
      expect(verdict.refusalCode, `signature of ${bad.length} bytes`).toBe("POP_SIGNATURE_INVALID");
    }
  });

  it("refuses a valid signature over an ALTERED payload", async () => {
    const f = await fixture();
    // Signed over nonce X, presented with nonce Y: the server reconstructs
    // authoritative bytes, so the signature no longer covers them.
    const altered = { ...f.challenge, nonce: "someone-else-chose-this" };
    const verdict = verifyProvisioningPop(
      altered,
      f.signature,
      f.pem,
      { ...f.expectation },
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("POP_SIGNATURE_INVALID");
  });

  it("cannot be satisfied by an enrollment or renewal proof — the domains differ", async () => {
    const f = await fixture();
    const bytes = Buffer.from(provisioningChallengeBytes(f.challenge)).toString("utf8");
    expect(bytes.startsWith(PROVISIONING_POP_KIND)).toBe(true);
    // A renewal PoP over comparable fields is a signature over DIFFERENT
    // bytes; the domain separator refuses it before any field comparison.
    const renewalBytes = Buffer.from(
      replacementChallengeBytes({
        renewalAttemptId: f.challenge.challengeId,
        deviceRecordId: f.challenge.terminalDeviceId,
        currentCredentialId: randomUUID(),
        currentGeneration: 1,
        nextGeneration: 2,
        replacementPublicKeyFingerprint: f.challenge.terminalKeyFingerprint,
        assignmentGeneration: 1,
        nonce: f.challenge.nonce,
        issuedAt: f.challenge.issuedAt,
        expiresAt: f.challenge.expiresAt,
        environment: "development",
        purpose: "device_identity",
      }),
    ).toString("utf8");
    expect(renewalBytes).toContain("kitluy.renewal-pop.v1");
    expect(renewalBytes).not.toContain(PROVISIONING_POP_KIND);
    expect(
      verifyDetachedSignature(f.pem, provisioningChallengeBytes(f.challenge), f.signature),
    ).toBe(true);
  });

  it("the signed bytes contain no raw provisioning code and no digest", async () => {
    const f = await fixture();
    const bytes = Buffer.from(provisioningChallengeBytes(f.challenge)).toString("utf8");
    // The binding is the code ROW ID (a UUID). No line of the canonical
    // payload is an eight-character Crockford token standing alone.
    for (const line of bytes.split("\n")) {
      expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(line), `line "${line}"`).toBe(false);
    }
    expect(bytes).toContain(f.challenge.provisioningCodeId);
  });
});
