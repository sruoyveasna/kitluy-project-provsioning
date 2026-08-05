/**
 * Hub-terminal pairing protocol — the substitutions and reflections it must
 * refuse.
 *
 * WS-11-T004-P03B. Every replay test transplants a GENUINE signature into a
 * slightly wrong context: the crypto passes each time, only the binding is
 * wrong. The property unique to this domain is DIRECTION: terminal proof and
 * Hub proof sign the same transcript under different separators, so a
 * reflected proof — one side's genuine signature presented as the other
 * side's — can never verify.
 */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyDetachedSignature,
} from "../src/dev-crypto.js";
import {
  pairingTranscriptBytes,
  pairingTranscriptHash,
  terminalPairingProofBytes,
  hubPairingProofBytes,
  pairingReceiptBytes,
  verifyTerminalPairingProof,
  verifyHubPairingProof,
  verifyPairingReceipt,
  PAIRING_PROTOCOL_VERSION,
  PAIRING_PURPOSE,
  PAIRING_TERMINAL_PROOF_KIND,
  PAIRING_HUB_PROOF_KIND,
  PAIRING_RECEIPT_KIND,
  PAIRING_TRANSCRIPT_KIND,
  type PairingTranscript,
  type PairingExpectation,
  type PairingReceipt,
  type ReceiptExpectation,
} from "../src/pairing.js";

const NOW = new Date("2026-08-05T12:00:00.000Z");

interface Fixture {
  transcript: PairingTranscript;
  terminalSignature: Uint8Array;
  hubSignature: Uint8Array;
  terminalPem: string;
  hubPem: string;
  terminalExpectation: PairingExpectation;
  hubExpectation: PairingExpectation;
  signTerminal: (t: PairingTranscript) => Uint8Array;
  signHub: (t: PairingTranscript) => Uint8Array;
  signHubRaw: (payload: Uint8Array) => Uint8Array;
}

async function fixture(): Promise<Fixture> {
  const keys = new DevelopmentDeviceKeyProvider();
  const terminalDeviceId = randomUUID();
  const hubDeviceId = randomUUID();
  await keys.generateDeviceKey(terminalDeviceId, "development");
  await keys.generateDeviceKey(hubDeviceId, "development");
  const terminalPem = keys.publicKeyPem(terminalDeviceId) ?? "";
  const hubPem = keys.publicKeyPem(hubDeviceId) ?? "";
  const terminalFingerprint = publicKeyFingerprint(terminalPem);
  const hubFingerprint = publicKeyFingerprint(hubPem);

  const transcript: PairingTranscript = {
    pairingSessionId: randomUUID(),
    protocolVersion: PAIRING_PROTOCOL_VERSION,
    purpose: PAIRING_PURPOSE,
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
    environment: "development",
    hubDeviceId,
    hubAssignmentGeneration: 7,
    hubCertificateSerial: `HUB-CERT-${randomUUID()}`,
    hubCertificateFingerprint: hubFingerprint,
    terminalDeviceId,
    terminalAssignmentGeneration: 4,
    terminalProfileKey: "laundry.t1.intake_cashier",
    terminalCertificateSerial: `TERM-CERT-${randomUUID()}`,
    terminalCertificateFingerprint: terminalFingerprint,
    terminalNonce: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
    hubNonce: randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 300_000),
  };

  const base = {
    pairingSessionId: transcript.pairingSessionId,
    protocolVersion: PAIRING_PROTOCOL_VERSION,
    purpose: PAIRING_PURPOSE,
    tenantId: transcript.tenantId,
    digitalStoreId: transcript.digitalStoreId,
    storeLocationId: transcript.storeLocationId,
    environment: "development" as const,
    hubDeviceId,
    hubAssignmentGeneration: 7,
    hubCertificateSerial: transcript.hubCertificateSerial,
    hubCertificateFingerprint: hubFingerprint,
    terminalDeviceId,
    terminalAssignmentGeneration: 4,
    terminalProfileKey: transcript.terminalProfileKey,
    terminalCertificateSerial: transcript.terminalCertificateSerial,
    terminalCertificateFingerprint: terminalFingerprint,
    terminalNonce: transcript.terminalNonce,
    hubNonce: transcript.hubNonce,
  };

  const signTerminal = (t: PairingTranscript): Uint8Array =>
    keys.provePossession(terminalDeviceId, terminalPairingProofBytes(t));
  const signHub = (t: PairingTranscript): Uint8Array =>
    keys.provePossession(hubDeviceId, hubPairingProofBytes(t));

  return {
    transcript,
    terminalSignature: signTerminal(transcript),
    hubSignature: signHub(transcript),
    terminalPem,
    hubPem,
    terminalExpectation: { ...base, signerKeyFingerprint: terminalFingerprint },
    hubExpectation: { ...base, signerKeyFingerprint: hubFingerprint },
    signTerminal,
    signHub,
    signHubRaw: (payload) => keys.provePossession(hubDeviceId, payload),
  };
}

const verifyTerminal = (
  f: Fixture,
  over?: Partial<PairingTranscript>,
  exp?: Partial<PairingExpectation>,
) => {
  const transcript = { ...f.transcript, ...over };
  return verifyTerminalPairingProof(
    transcript,
    over === undefined ? f.terminalSignature : f.signTerminal(transcript),
    f.terminalPem,
    { ...f.terminalExpectation, ...exp },
    NOW,
    publicKeyFingerprint,
  );
};

describe("hub-terminal pairing protocol", () => {
  it("verifies a correctly bound terminal proof and a correctly bound Hub proof", async () => {
    const f = await fixture();
    const terminal = verifyTerminal(f);
    expect(terminal.verified).toBe(true);
    expect(terminal.transcriptHash).toBe(pairingTranscriptHash(f.transcript));

    const hub = verifyHubPairingProof(
      f.transcript,
      f.hubSignature,
      f.hubPem,
      f.hubExpectation,
      NOW,
      publicKeyFingerprint,
    );
    expect(hub.verified).toBe(true);
    expect(hub.transcriptHash).toBe(terminal.transcriptHash);
  });

  it("the canonical transcript is deterministic and domain-separated", async () => {
    const f = await fixture();
    const a = Buffer.from(pairingTranscriptBytes(f.transcript)).toString("utf8");
    const b = Buffer.from(pairingTranscriptBytes({ ...f.transcript })).toString("utf8");
    expect(a).toBe(b);
    expect(a.startsWith(PAIRING_TRANSCRIPT_KIND)).toBe(true);
    const terminalBytes = Buffer.from(terminalPairingProofBytes(f.transcript)).toString("utf8");
    const hubBytes = Buffer.from(hubPairingProofBytes(f.transcript)).toString("utf8");
    expect(terminalBytes.startsWith(PAIRING_TERMINAL_PROOF_KIND)).toBe(true);
    expect(hubBytes.startsWith(PAIRING_HUB_PROOF_KIND)).toBe(true);
    expect(terminalBytes).not.toBe(hubBytes);
    // Identical after the separator: the ONLY difference is direction.
    expect(terminalBytes.split("\n").slice(1)).toEqual(hubBytes.split("\n").slice(1));
  });

  it("REFLECTION: a genuine terminal proof can never verify as a Hub proof, nor the reverse", async () => {
    const f = await fixture();
    // The terminal's own genuine signature, presented as the Hub's proof
    // (even with the terminal's own key as the claimed signer).
    const reflected = verifyHubPairingProof(
      f.transcript,
      f.terminalSignature,
      f.terminalPem,
      { ...f.hubExpectation, signerKeyFingerprint: publicKeyFingerprint(f.terminalPem) },
      NOW,
      publicKeyFingerprint,
    );
    expect(reflected.verified).toBe(false);
    const reverse = verifyTerminalPairingProof(
      f.transcript,
      f.hubSignature,
      f.hubPem,
      { ...f.terminalExpectation, signerKeyFingerprint: publicKeyFingerprint(f.hubPem) },
      NOW,
      publicKeyFingerprint,
    );
    expect(reverse.verified).toBe(false);
  });

  // Each case signs a GENUINE transcript, then presents it against an
  // expectation that says something else.
  const replays: ReadonlyArray<[string, Partial<PairingTranscript>, string]> = [
    ["another session", { pairingSessionId: randomUUID() }, "PAIR_SESSION_MISMATCH"],
    ["another Tenant", { tenantId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
    ["another Digital Store", { digitalStoreId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
    ["another Location", { storeLocationId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
    ["another Hub device", { hubDeviceId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
    ["another Hub generation", { hubAssignmentGeneration: 8 }, "PAIR_ASSIGNMENT_MISMATCH"],
    [
      "another Hub credential",
      { hubCertificateSerial: "HUB-CERT-OTHER" },
      "PAIR_ASSIGNMENT_MISMATCH",
    ],
    ["another terminal", { terminalDeviceId: randomUUID() }, "PAIR_ASSIGNMENT_MISMATCH"],
    [
      "another terminal generation",
      { terminalAssignmentGeneration: 5 },
      "PAIR_ASSIGNMENT_MISMATCH",
    ],
    [
      "another terminal credential",
      { terminalCertificateSerial: "TERM-CERT-OTHER" },
      "PAIR_ASSIGNMENT_MISMATCH",
    ],
    [
      "an unassigned profile",
      { terminalProfileKey: "laundry.t2.customer_display" },
      "PAIR_PROFILE_FORBIDDEN",
    ],
    ["an altered terminal nonce", { terminalNonce: "ab".repeat(32) }, "PAIR_NONCE_MISMATCH"],
    ["an altered Hub nonce", { hubNonce: "cd".repeat(32) }, "PAIR_NONCE_MISMATCH"],
  ];

  for (const [name, override, code] of replays) {
    it(`refuses a genuine proof from ${name}`, async () => {
      const f = await fixture();
      const verdict = verifyTerminal(f, override);
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe(code);
    });
  }

  it("refuses an incompatible protocol version and a wrong environment", async () => {
    const f = await fixture();
    expect(verifyTerminal(f, { protocolVersion: "2.0" }).refusalCode).toBe(
      "PAIR_VERSION_INCOMPATIBLE",
    );
    const wrongEnv = { ...f.transcript, environment: "pilot" as const };
    const verdict = verifyTerminalPairingProof(
      wrongEnv,
      f.signTerminal(wrongEnv),
      f.terminalPem,
      f.terminalExpectation,
      NOW,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("PAIR_ASSIGNMENT_MISMATCH");
  });

  it("refuses an expired challenge — the equality boundary expires — and a future-dated one", async () => {
    const f = await fixture();
    expect(
      verifyTerminal(f, {
        issuedAt: new Date(NOW.getTime() - 600_000),
        expiresAt: new Date(NOW.getTime() - 300_000),
      }).refusalCode,
    ).toBe("PAIR_CHALLENGE_EXPIRED");
    expect(verifyTerminal(f, { expiresAt: NOW }).refusalCode, "expiry AT the boundary").toBe(
      "PAIR_CHALLENGE_EXPIRED",
    );
    expect(verifyTerminal(f, { expiresAt: new Date(NOW.getTime() + 1) }).verified).toBe(true);
    expect(
      verifyTerminal(f, {
        issuedAt: new Date(NOW.getTime() + 60_000),
        expiresAt: new Date(NOW.getTime() + 300_000),
      }).refusalCode,
    ).toBe("PAIR_CHALLENGE_NOT_YET_VALID");
  });

  it("refuses a proof made with a DIFFERENT private key, and malformed signatures", async () => {
    const f = await fixture();
    const other = new DevelopmentDeviceKeyProvider();
    const otherId = randomUUID();
    await other.generateDeviceKey(otherId, "development");
    const forged = other.provePossession(otherId, terminalPairingProofBytes(f.transcript));
    const verdict = verifyTerminalPairingProof(
      f.transcript,
      forged,
      f.terminalPem,
      f.terminalExpectation,
      NOW,
      publicKeyFingerprint,
    );
    expect(verdict.refusalCode).toBe("PAIR_CHALLENGE_FAILED");

    for (const bad of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(4096)]) {
      expect(
        verifyTerminalPairingProof(
          f.transcript,
          bad,
          f.terminalPem,
          f.terminalExpectation,
          NOW,
          publicKeyFingerprint,
        ).refusalCode,
        `signature of ${bad.length} bytes`,
      ).toBe("PAIR_CHALLENGE_FAILED");
    }
  });

  it("refuses a key that is not the credentialed key — a valid certificate alone is not possession", async () => {
    const f = await fixture();
    const verdict = verifyTerminal(f, undefined, { signerKeyFingerprint: "b".repeat(64) });
    expect(verdict.refusalCode).toBe("PAIR_CERT_INVALID");
  });

  it("refuses a valid signature over an ALTERED transcript", async () => {
    const f = await fixture();
    const altered = { ...f.transcript, hubNonce: f.transcript.terminalNonce };
    const verdict = verifyTerminalPairingProof(
      altered,
      f.terminalSignature,
      f.terminalPem,
      { ...f.terminalExpectation, hubNonce: altered.hubNonce },
      NOW,
      publicKeyFingerprint,
    );
    expect(verdict.verified).toBe(false);
  });

  describe("pairing receipt", () => {
    async function receiptFixture(): Promise<{
      f: Fixture;
      receipt: PairingReceipt;
      signature: Uint8Array;
      expectation: ReceiptExpectation;
    }> {
      const f = await fixture();
      const receipt: PairingReceipt = {
        receiptId: randomUUID(),
        receiptVersion: PAIRING_PROTOCOL_VERSION,
        pairingSessionId: f.transcript.pairingSessionId,
        transcriptHash: pairingTranscriptHash(f.transcript),
        hubDeviceId: f.transcript.hubDeviceId,
        hubCertificateFingerprint: f.transcript.hubCertificateFingerprint,
        terminalDeviceId: f.transcript.terminalDeviceId,
        terminalCertificateFingerprint: f.transcript.terminalCertificateFingerprint,
        tenantId: f.transcript.tenantId,
        digitalStoreId: f.transcript.digitalStoreId,
        storeLocationId: f.transcript.storeLocationId,
        environment: "development",
        terminalAssignmentGeneration: f.transcript.terminalAssignmentGeneration,
        terminalProfileKey: f.transcript.terminalProfileKey,
        pairedAt: NOW,
        validUntil: null,
        correlationId: randomUUID(),
      };
      return {
        f,
        receipt,
        signature: f.signHubRaw(pairingReceiptBytes(receipt)),
        expectation: {
          pairingSessionId: receipt.pairingSessionId,
          transcriptHash: receipt.transcriptHash,
          hubDeviceId: receipt.hubDeviceId,
          hubCertificateFingerprint: receipt.hubCertificateFingerprint,
          terminalDeviceId: receipt.terminalDeviceId,
          terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
          tenantId: receipt.tenantId,
          digitalStoreId: receipt.digitalStoreId,
          storeLocationId: receipt.storeLocationId,
          environment: "development",
          terminalAssignmentGeneration: receipt.terminalAssignmentGeneration,
          terminalProfileKey: receipt.terminalProfileKey,
        },
      };
    }

    it("verifies a genuine Hub-signed receipt with no expiry when valid_until is null (§9)", async () => {
      const { f, receipt, signature, expectation } = await receiptFixture();
      const farFuture = new Date("2036-01-01T00:00:00.000Z");
      const verdict = verifyPairingReceipt(
        receipt,
        signature,
        f.hubPem,
        expectation,
        farFuture,
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(true);
      const bytes = Buffer.from(pairingReceiptBytes(receipt)).toString("utf8");
      expect(bytes.startsWith(PAIRING_RECEIPT_KIND)).toBe(true);
      // The receipt binds the transcript but carries NO nonce and NO secret.
      expect(bytes).toContain(receipt.transcriptHash);
      expect(bytes.includes(f.transcript.terminalNonce)).toBe(false);
      expect(bytes.includes(f.transcript.hubNonce)).toBe(false);
    });

    it("refuses a tampered receipt field even though the signature is genuine", async () => {
      const { f, receipt, signature, expectation } = await receiptFixture();
      const tampered: PairingReceipt = { ...receipt, terminalAssignmentGeneration: 99 };
      const verdict = verifyPairingReceipt(
        tampered,
        signature,
        f.hubPem,
        { ...expectation, terminalAssignmentGeneration: 99 },
        NOW,
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe("PAIR_RECEIPT_INVALID");
    });

    it("refuses a receipt transplanted to another transcript, terminal, Hub or scope", async () => {
      const { f, receipt, signature, expectation } = await receiptFixture();
      const cases: ReadonlyArray<Partial<ReceiptExpectation>> = [
        { transcriptHash: "e".repeat(64) },
        { terminalDeviceId: randomUUID() },
        { hubDeviceId: randomUUID() },
        { tenantId: randomUUID() },
        { terminalProfileKey: "laundry.t3.ready_scan_in" },
      ];
      for (const over of cases) {
        const verdict = verifyPairingReceipt(
          receipt,
          signature,
          f.hubPem,
          { ...expectation, ...over },
          NOW,
          publicKeyFingerprint,
        );
        expect(verdict.verified, JSON.stringify(over)).toBe(false);
        expect(verdict.refusalCode).toBe("PAIR_RECEIPT_INVALID");
      }
    });

    it("refuses a receipt signed by a key that is not the named Hub credential", async () => {
      const { receipt, expectation } = await receiptFixture();
      const rogue = new DevelopmentDeviceKeyProvider();
      const rogueId = randomUUID();
      await rogue.generateDeviceKey(rogueId, "development");
      const roguePem = rogue.publicKeyPem(rogueId) ?? "";
      const rogueSignature = rogue.provePossession(rogueId, pairingReceiptBytes(receipt));
      const verdict = verifyPairingReceipt(
        receipt,
        rogueSignature,
        roguePem,
        expectation,
        NOW,
        publicKeyFingerprint,
      );
      expect(verdict.verified).toBe(false);
      expect(verdict.refusalCode).toBe("PAIR_RECEIPT_INVALID");
    });

    it("expires a receipt with a validity window at the boundary", async () => {
      const g = await receiptFixture();
      const withWindow: PairingReceipt = {
        ...g.receipt,
        validUntil: new Date(NOW.getTime() + 1000),
      };
      const sig = g.f.signHubRaw(pairingReceiptBytes(withWindow));
      expect(
        verifyPairingReceipt(withWindow, sig, g.f.hubPem, g.expectation, NOW, publicKeyFingerprint)
          .verified,
      ).toBe(true);
      expect(
        verifyPairingReceipt(
          withWindow,
          sig,
          g.f.hubPem,
          g.expectation,
          new Date(NOW.getTime() + 1000),
          publicKeyFingerprint,
        ).refusalCode,
        "expiry AT the boundary",
      ).toBe("PAIR_RECEIPT_EXPIRED");
    });
  });

  it("shares no domain with any other proof in the repository", async () => {
    const f = await fixture();
    const domains = [
      Buffer.from(terminalPairingProofBytes(f.transcript)).toString("utf8"),
      Buffer.from(hubPairingProofBytes(f.transcript)).toString("utf8"),
      Buffer.from(pairingTranscriptBytes(f.transcript)).toString("utf8"),
    ];
    for (const bytes of domains) {
      expect(bytes.includes("kitluy.provisioning-pop.v1")).toBe(false);
      expect(bytes.includes("kitluy.activation-ack.v1")).toBe(false);
      expect(bytes.includes("kitluy.renewal-pop.v1")).toBe(false);
      expect(bytes.includes("kitluy.cert.v1")).toBe(false);
      // No line is a raw eight-character Crockford provisioning token.
      for (const line of bytes.split("\n")) {
        expect(/^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/.test(line), `line "${line}"`).toBe(false);
      }
    }
    expect(
      verifyDetachedSignature(
        f.terminalPem,
        terminalPairingProofBytes(f.transcript),
        f.terminalSignature,
      ),
    ).toBe(true);
  });
});
