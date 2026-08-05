/**
 * Terminal activation acknowledgment — the replays it must refuse.
 *
 * WS-11-T004-P03A. Every replay test transplants a GENUINE signature into a
 * slightly wrong context: the crypto passes each time, only the binding is
 * wrong. What distinguishes this domain from the provisioning proof is the
 * CREDENTIAL binding — an acknowledgment must name the exact certificate the
 * terminal received, which a provisioning proof cannot do because the
 * certificate did not exist yet.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyDetachedSignature,
} from "../src/dev-crypto.js";
import {
  activationAckBytes,
  activationAckHash,
  verifyActivationAck,
  ACTIVATION_ACK_KIND,
  ACTIVATION_ACK_PURPOSE,
  type ActivationAckChallenge,
  type ActivationAckExpectation,
} from "../src/activation-ack.js";
import {
  provisioningChallengeBytes,
  PROVISIONING_POP_KIND,
  PROVISIONING_POP_PURPOSE,
  type ProvisioningPopChallenge,
} from "../src/provisioning-pop.js";
import type { TrustedTimeEvaluation } from "../src/trusted-time.js";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const TRUSTED: TrustedTimeEvaluation = {
  status: "trusted",
  trustedTime: NOW,
} as TrustedTimeEvaluation;

interface Fixture {
  challenge: ActivationAckChallenge;
  signature: Uint8Array;
  pem: string;
  expectation: ActivationAckExpectation;
  sign: (c: ActivationAckChallenge) => Uint8Array;
}

async function fixture(): Promise<Fixture> {
  const keys = new DevelopmentDeviceKeyProvider();
  const terminalDeviceId = randomUUID();
  await keys.generateDeviceKey(terminalDeviceId, "development");
  const pem = keys.publicKeyPem(terminalDeviceId) ?? "";
  const fingerprint = publicKeyFingerprint(pem);

  const challenge: ActivationAckChallenge = {
    activationChallengeId: randomUUID(),
    purpose: ACTIVATION_ACK_PURPOSE,
    activationId: randomUUID(),
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
    environment: "development",
    storeHubDeviceId: randomUUID(),
    terminalDeviceId,
    terminalAssignmentId: randomUUID(),
    terminalProfileKey: "laundry.t1.cashier",
    provisioningCodeId: randomUUID(),
    popChallengeId: randomUUID(),
    terminalKeyFingerprint: fingerprint,
    certificateId: randomUUID(),
    certificateSerial: `SERIAL-${randomUUID()}`,
    certificateFingerprint: "c1".repeat(32),
    nonce: randomUUID().replace(/-/g, ""),
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 300_000),
  };

  const sign = (c: ActivationAckChallenge): Uint8Array =>
    keys.provePossession(terminalDeviceId, activationAckBytes(c));

  return {
    challenge,
    signature: sign(challenge),
    pem,
    expectation: {
      activationChallengeId: challenge.activationChallengeId,
      purpose: ACTIVATION_ACK_PURPOSE,
      activationId: challenge.activationId,
      tenantId: challenge.tenantId,
      digitalStoreId: challenge.digitalStoreId,
      storeLocationId: challenge.storeLocationId,
      environment: "development",
      storeHubDeviceId: challenge.storeHubDeviceId,
      terminalDeviceId,
      terminalAssignmentId: challenge.terminalAssignmentId,
      terminalProfileKey: challenge.terminalProfileKey,
      provisioningCodeId: challenge.provisioningCodeId,
      popChallengeId: challenge.popChallengeId,
      certificateId: challenge.certificateId,
      certificateSerial: challenge.certificateSerial,
      certificateFingerprint: challenge.certificateFingerprint,
      enrolledKeyFingerprint: fingerprint,
      enrollmentState: "sealed",
    },
    sign,
  };
}

const verify = (
  f: Fixture,
  over?: Partial<ActivationAckChallenge>,
  exp?: Partial<ActivationAckExpectation>,
) => {
  const challenge = { ...f.challenge, ...over };
  return verifyActivationAck(
    challenge,
    over === undefined ? f.signature : f.sign(challenge),
    f.pem,
    { ...f.expectation, ...exp },
    TRUSTED,
    publicKeyFingerprint,
  );
};

describe("terminal activation acknowledgment", () => {
  it("verifies a correctly bound acknowledgment", async () => {
    const f = await fixture();
    const verdict = verify(f);
    expect(verdict.verified).toBe(true);
    expect(verdict.challengeHash).toBe(activationAckHash(f.challenge));
    expect(verdict.challengeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Each case signs a GENUINE acknowledgment, then presents it against a
  // database expectation that says something else.
  const replays: ReadonlyArray<[string, Partial<ActivationAckChallenge>, string]> = [
    ["another challenge", { activationChallengeId: randomUUID() }, "ACK_WRONG_CHALLENGE"],
    ["another activation", { activationId: randomUUID() }, "ACK_WRONG_ACTIVATION"],
    ["another Tenant", { tenantId: randomUUID() }, "ACK_WRONG_SCOPE"],
    ["another Digital Store", { digitalStoreId: randomUUID() }, "ACK_WRONG_SCOPE"],
    ["another Location", { storeLocationId: randomUUID() }, "ACK_WRONG_SCOPE"],
    ["a different Store Hub", { storeHubDeviceId: randomUUID() }, "ACK_WRONG_HUB"],
    ["another terminal", { terminalDeviceId: randomUUID() }, "ACK_WRONG_TERMINAL"],
    ["a reassigned terminal", { terminalAssignmentId: randomUUID() }, "ACK_WRONG_ASSIGNMENT"],
    [
      "a different T1-T4 profile",
      { terminalProfileKey: "laundry.t2.display" },
      "ACK_WRONG_PROFILE",
    ],
    [
      "a different provisioning result",
      { provisioningCodeId: randomUUID() },
      "ACK_WRONG_PROVISIONING_RESULT",
    ],
    [
      "a decoupled possession proof",
      { popChallengeId: randomUUID() },
      "ACK_WRONG_PROVISIONING_RESULT",
    ],
    ["another credential id", { certificateId: randomUUID() }, "ACK_WRONG_CREDENTIAL"],
    ["another credential serial", { certificateSerial: "SERIAL-OTHER" }, "ACK_WRONG_CREDENTIAL"],
    ["another credential key", { certificateFingerprint: "d2".repeat(32) }, "ACK_WRONG_CREDENTIAL"],
  ];

  for (const [name, override, code] of replays) {
    it(`refuses a genuine acknowledgment from ${name}`, async () => {
      const f = await fixture();
      const verdict = verify(f, override);
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe(code);
    });
  }

  it("refuses any purpose other than the activation acknowledgment purpose", async () => {
    const f = await fixture();
    expect(verify(f, { purpose: PROVISIONING_POP_PURPOSE }).refusalCode).toBe("ACK_WRONG_PURPOSE");
  });

  it("refuses a wrong-environment acknowledgment", async () => {
    const f = await fixture();
    const challenge = { ...f.challenge, environment: "pilot" as const };
    const verdict = verifyActivationAck(
      challenge,
      f.sign(challenge),
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("ACK_WRONG_ENVIRONMENT");
  });

  it("refuses an expired challenge against trusted time — the equality boundary expires", async () => {
    const f = await fixture();
    expect(
      verify(f, {
        issuedAt: new Date(NOW.getTime() - 600_000),
        expiresAt: new Date(NOW.getTime() - 300_000),
      }).refusalCode,
    ).toBe("ACK_EXPIRED");
    expect(verify(f, { expiresAt: NOW }).refusalCode, "expiry AT the boundary").toBe("ACK_EXPIRED");
    expect(verify(f, { expiresAt: new Date(NOW.getTime() + 1) }).verified).toBe(true);
  });

  it("refuses a future-dated challenge", async () => {
    const f = await fixture();
    const verdict = verify(f, {
      issuedAt: new Date(NOW.getTime() + 60_000),
      expiresAt: new Date(NOW.getTime() + 300_000),
    });
    expect(verdict.refusalCode).toBe("ACK_NOT_YET_VALID");
  });

  it("refuses without trusted time and in restricted trust mode", async () => {
    const f = await fixture();
    const noTime = verifyActivationAck(
      f.challenge,
      f.signature,
      f.pem,
      f.expectation,
      { status: "untrusted", trustedTime: null } as TrustedTimeEvaluation,
      publicKeyFingerprint,
    );
    expect(noTime.verified).toBe(false);
    expect(noTime.refusalCode).toBe("ACK_NO_TRUSTED_TIME");
  });

  it("refuses a SUPERSEDED enrollment even though its signature is valid", async () => {
    const f = await fixture();
    const verdict = verify(f, undefined, { enrollmentState: "superseded" });
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("ACK_ENROLLMENT_NOT_ELIGIBLE");
  });

  it("refuses a key that is not the enrolled key", async () => {
    const f = await fixture();
    const verdict = verify(f, undefined, { enrolledKeyFingerprint: "b".repeat(64) });
    expect(verdict.refusalCode).toBe("ACK_FINGERPRINT_MISMATCH");
  });

  it("refuses an acknowledgment made with a DIFFERENT private key", async () => {
    const f = await fixture();
    const other = new DevelopmentDeviceKeyProvider();
    const otherDevice = randomUUID();
    await other.generateDeviceKey(otherDevice, "development");
    const forged = other.provePossession(otherDevice, activationAckBytes(f.challenge));
    const verdict = verifyActivationAck(
      f.challenge,
      forged,
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("ACK_SIGNATURE_INVALID");
  });

  it("refuses malformed, empty and oversized signatures", async () => {
    const f = await fixture();
    for (const bad of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(4096)]) {
      const verdict = verifyActivationAck(
        f.challenge,
        bad,
        f.pem,
        f.expectation,
        TRUSTED,
        publicKeyFingerprint,
      );
      expect(verdict.refusalCode, `signature of ${bad.length} bytes`).toBe("ACK_SIGNATURE_INVALID");
    }
  });

  it("refuses a valid signature over an ALTERED payload", async () => {
    const f = await fixture();
    const altered = { ...f.challenge, nonce: "someone-else-chose-this" };
    const verdict = verifyActivationAck(
      altered,
      f.signature,
      f.pem,
      f.expectation,
      TRUSTED,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("ACK_SIGNATURE_INVALID");
  });

  it("cannot be satisfied by a provisioning possession proof — the domains differ", async () => {
    const f = await fixture();
    const ackBytes = Buffer.from(activationAckBytes(f.challenge)).toString("utf8");
    expect(ackBytes.startsWith(ACTIVATION_ACK_KIND)).toBe(true);
    // A provisioning proof over the SAME identifiers is a signature over
    // DIFFERENT bytes; the domain separator refuses it before any field
    // comparison — a proof captured before the credential existed can never
    // acknowledge receiving it.
    const pop: ProvisioningPopChallenge = {
      challengeId: f.challenge.popChallengeId,
      purpose: PROVISIONING_POP_PURPOSE,
      tenantId: f.challenge.tenantId,
      digitalStoreId: f.challenge.digitalStoreId,
      storeLocationId: f.challenge.storeLocationId,
      environment: f.challenge.environment,
      storeHubDeviceId: f.challenge.storeHubDeviceId,
      terminalDeviceId: f.challenge.terminalDeviceId,
      terminalAssignmentId: f.challenge.terminalAssignmentId,
      terminalProfileKey: f.challenge.terminalProfileKey,
      provisioningCodeId: f.challenge.provisioningCodeId,
      terminalKeyFingerprint: f.challenge.terminalKeyFingerprint,
      nonce: f.challenge.nonce,
      issuedAt: f.challenge.issuedAt,
      expiresAt: f.challenge.expiresAt,
    };
    const popBytes = Buffer.from(provisioningChallengeBytes(pop)).toString("utf8");
    expect(popBytes).toContain(PROVISIONING_POP_KIND);
    expect(popBytes).not.toContain(ACTIVATION_ACK_KIND);
    expect(ackBytes).not.toContain(PROVISIONING_POP_KIND);
    expect(verifyDetachedSignature(f.pem, activationAckBytes(f.challenge), f.signature)).toBe(true);
  });

  it("binds the credential the provisioning proof could not know", async () => {
    const f = await fixture();
    const bytes = Buffer.from(activationAckBytes(f.challenge)).toString("utf8");
    expect(bytes).toContain(f.challenge.certificateId);
    expect(bytes).toContain(f.challenge.certificateSerial);
    expect(bytes).toContain(f.challenge.certificateFingerprint);
    // And still never the raw provisioning code: no line of the canonical
    // payload is an eight-character Crockford token standing alone.
    for (const line of bytes.split("\n")) {
      expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(line), `line "${line}"`).toBe(false);
    }
    expect(bytes).toContain(f.challenge.provisioningCodeId);
  });
});
