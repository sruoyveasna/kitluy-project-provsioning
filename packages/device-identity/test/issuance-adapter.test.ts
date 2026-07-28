/**
 * Transactional issuance adapter — the crash points, one by one.
 *
 * The owner named seven interruption points. Each one is exercised here by
 * making the corresponding gateway call fail, and the assertions are about
 * what must NOT have happened: no second serial, no second generation, no
 * silent re-signing, and — the distinction that matters most — no confusion
 * between "the signature is loose" and "the signature is safely on disk".
 */
import { describe, it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";

import { DevelopmentCertificateAuthority, tbsBytes, type Certificate } from "../src/dev-crypto.js";
import {
  runGovernedIssuance,
  type ChainLinkInput,
  type FinalizedCredential,
  type GovernedIssuanceGateway,
  type PipelineInput,
  type PreparedReservation,
} from "../src/issuance-adapter.js";
import { DevelopmentDeviceKeyProvider, publicKeyFingerprint } from "../src/dev-crypto.js";

const NOT_BEFORE = "2026-07-28T10:00:00.000Z";
const NOT_AFTER = "2026-08-27T10:00:00.000Z";
const SERIAL = "DEV-0123456789ABCDEF";
const CREDENTIAL_ID = "01234567-89ab-4cde-8f01-23456789abcd";
const ISSUER_KEY_ID = "ica-key-under-test";

function makeCa(): DevelopmentCertificateAuthority {
  return new DevelopmentCertificateAuthority({
    notBefore: new Date("2026-01-01T00:00:00.000Z"),
    notAfter: new Date("2027-01-01T00:00:00.000Z"),
  });
}

async function makeInput(): Promise<PipelineInput> {
  const keys = new DevelopmentDeviceKeyProvider();
  const deviceRecordId = randomUUID();
  await keys.generateDeviceKey(deviceRecordId, "development");
  const pem = keys.publicKeyPem(deviceRecordId) ?? "";
  return {
    requestId: `rq-${randomUUID()}`,
    deviceRecordId,
    environment: "development",
    purpose: "device_identity",
    assignmentGeneration: 1,
    publicKeyPem: pem,
    publicKeyFingerprint: publicKeyFingerprint(pem),
    idempotencyKey: createHash("sha256").update("fixed-request").digest("hex"),
    canonicalPayloadHash: createHash("sha256").update("payload").digest("hex"),
    popAlgorithm: "ed25519",
    popSignedPreimageHash: createHash("sha256").update("preimage").digest("hex"),
    popSignature: new Uint8Array([1, 2, 3]),
    popServiceVerified: true,
    issuerKeyId: ISSUER_KEY_ID,
    trustedTime: new Date(NOT_BEFORE),
    trustedTimeStatus: "trusted",
    actorRef: "TEST-SVC",
    hardwareTrustLevel: "development_software",
  };
}

/**
 * Builds the canonical TBS the way the DATABASE does, using the same reserved
 * values. The database-vs-package agreement is proven separately against the
 * real server; here it only has to be internally consistent so the adapter's
 * failure paths are what is under test.
 */
function reservationFor(
  input: PipelineInput,
  ca: DevelopmentCertificateAuthority,
  overrides: Partial<PreparedReservation> = {},
): PreparedReservation {
  const canonicalTbs = Buffer.from(
    tbsBytes({
      certificateId: CREDENTIAL_ID,
      serialNumber: SERIAL,
      role: "device",
      purpose: "device_identity",
      environment: "development",
      subjectFingerprint: input.publicKeyFingerprint,
      subjectPublicKeyPem: input.publicKeyPem,
      issuerKeyId: ca.intermediateKeyId,
      deviceRecordId: input.deviceRecordId,
      certificateGeneration: 1,
      hardwareTrustLevel: "development_software",
      productionEligible: false,
      notBefore: NOT_BEFORE,
      notAfter: NOT_AFTER,
    }),
  ).toString("utf8");

  return {
    outcome: "RESERVED",
    attemptId: randomUUID(),
    requestId: input.requestId,
    credentialId: CREDENTIAL_ID,
    serialNumber: SERIAL,
    certificateGeneration: 1,
    assignmentGeneration: 1,
    issuerKeyId: ca.intermediateKeyId,
    notBefore: NOT_BEFORE,
    notAfter: NOT_AFTER,
    canonicalTbs,
    canonicalTbsHash: createHash("sha256").update(canonicalTbs, "utf8").digest("hex"),
    headVersionSeen: 0,
    alreadySigned: false,
    ...overrides,
  };
}

interface Recorder {
  prepareCalls: number;
  recordCalls: number;
  finalizeCalls: number;
  orphanCalls: number;
  lastLinks: readonly ChainLinkInput[] | null;
}

function makeGateway(
  reservation: PreparedReservation,
  failures: {
    prepare?: Error;
    record?: Error;
    finalize?: Error;
    orphan?: Error;
  } = {},
): { gateway: GovernedIssuanceGateway; recorder: Recorder } {
  const recorder: Recorder = {
    prepareCalls: 0,
    recordCalls: 0,
    finalizeCalls: 0,
    orphanCalls: 0,
    lastLinks: null,
  };
  const gateway: GovernedIssuanceGateway = {
    async prepare() {
      recorder.prepareCalls += 1;
      if (failures.prepare) throw failures.prepare;
      return reservation;
    },
    async recordSignature() {
      recorder.recordCalls += 1;
      if (failures.record) throw failures.record;
      return { outcome: "RECORDED" };
    },
    async finalize(args): Promise<FinalizedCredential> {
      recorder.finalizeCalls += 1;
      recorder.lastLinks = args.chainLinks;
      if (failures.finalize) throw failures.finalize;
      return {
        outcome: "ISSUED",
        credentialId: reservation.credentialId,
        serialNumber: reservation.serialNumber,
        certificateGeneration: reservation.certificateGeneration,
      };
    },
    async recordOrphanSignature() {
      recorder.orphanCalls += 1;
      if (failures.orphan) throw failures.orphan;
    },
  };
  return { gateway, recorder };
}

describe("governed issuance adapter", () => {
  it("issues, signing exactly once and sending only the two CA chain links", async () => {
    const ca = makeCa();
    const input = await makeInput();
    let signCalls = 0;
    const counting = new Proxy(ca, {
      get(target, prop, receiver) {
        if (prop === "issueDeviceCertificate") {
          return (arg: Parameters<typeof ca.issueDeviceCertificate>[0]) => {
            signCalls += 1;
            return target.issueDeviceCertificate(arg);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const { gateway, recorder } = makeGateway(reservationFor(input, ca));

    const result = await runGovernedIssuance(input, gateway, counting);

    expect(result.outcome).toBe("ISSUED");
    expect(signCalls).toBe(1);
    expect(recorder.recordCalls).toBe(1);
    expect(recorder.finalizeCalls).toBe(1);
    // The DEVICE link is the database's to build. Sending one would let a
    // caller bind a signature other than the one it had signed.
    expect(recorder.lastLinks?.map((l) => l.role)).toEqual(["root", "intermediate"]);
    // Nothing was allocated here: the issued identifiers are the reserved ones.
    expect(result.credential?.serialNumber).toBe(SERIAL);
    expect(result.credential?.certificateGeneration).toBe(1);
  });

  it("carries a database refusal through verbatim, and never asks the CA to sign", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway, recorder } = makeGateway(reservationFor(input, ca), {
      prepare: new Error("KLUY-CRED-STALE-ASSIGNMENT: generation moved from 1 to 2"),
    });

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.outcome).toBe("REFUSED");
    expect(result.refusalCode).toBe("ISSUE_REFUSED_BY_DATABASE");
    // The typed database code survives. Flattening it would leave the caller
    // unable to tell a stale assignment from a quarantine.
    expect(result.detail).toContain("KLUY-CRED-STALE-ASSIGNMENT");
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.finalizeCalls).toBe(0);
  });

  it("replays an already-issued request without signing again", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway, recorder } = makeGateway(
      reservationFor(input, ca, { outcome: "ALREADY_ISSUED" }),
    );

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.outcome).toBe("REPLAYED");
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.finalizeCalls).toBe(0);
  });

  it("refuses when the reserved TBS does not hash to the reserved hash", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway, recorder } = makeGateway(
      reservationFor(input, ca, { canonicalTbsHash: "0".repeat(64) }),
    );

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.refusalCode).toBe("ISSUE_CANONICAL_TBS_HASH_DIVERGENCE");
    expect(recorder.recordCalls).toBe(0);
  });

  it("refuses when the database and the package disagree about canonical bytes", async () => {
    const ca = makeCa();
    const input = await makeInput();
    // A TBS that is internally consistent (hash matches) but is NOT what this
    // package would build. Signing it would produce a signature the database
    // could never re-derive.
    const drifted = "kitluy.cert.v1\nsomething-else";
    const { gateway, recorder } = makeGateway(
      reservationFor(input, ca, {
        canonicalTbs: drifted,
        canonicalTbsHash: createHash("sha256").update(drifted, "utf8").digest("hex"),
      }),
    );

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.refusalCode).toBe("ISSUE_CANONICAL_TBS_DIVERGENCE");
    expect(result.detail).toContain("nothing was signed");
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.finalizeCalls).toBe(0);
  });

  it("CRASH: signing fails — nothing is recorded and there is no orphan", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const throwing = new Proxy(ca, {
      get(target, prop, receiver) {
        if (prop === "issueDeviceCertificate") {
          return () => {
            throw new Error("HSM unreachable");
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const { gateway, recorder } = makeGateway(reservationFor(input, ca));

    const result = await runGovernedIssuance(input, gateway, throwing);

    expect(result.refusalCode).toBe("ISSUE_SIGNING_FAILED");
    // No signature exists, so this is NOT an orphan — calling it one would
    // send an operator hunting for something that was never created.
    expect(result.orphanSignature).toBeUndefined();
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.orphanCalls).toBe(0);
  });

  it("never records a signature that does not verify under the issuing key", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const corrupting = new Proxy(ca, {
      get(target, prop, receiver) {
        if (prop === "issueDeviceCertificate") {
          return (arg: Parameters<typeof ca.issueDeviceCertificate>[0]): Certificate => {
            const real = target.issueDeviceCertificate(arg);
            const broken = Uint8Array.from(real.signature);
            broken[0] = (broken[0] ?? 0) ^ 0xff;
            return { tbs: real.tbs, signature: broken };
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const { gateway, recorder } = makeGateway(reservationFor(input, ca));

    const result = await runGovernedIssuance(input, gateway, corrupting);

    // Under OPTION B this is the ONLY cryptographic check in the pipeline, and
    // the database cannot repeat it — so failing to make it here would let a
    // garbage signature become a persisted credential.
    expect(result.refusalCode).toBe("ISSUE_SIGNATURE_SELF_VERIFICATION_FAILED");
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.finalizeCalls).toBe(0);
  });

  it("CRASH: the signature does not become durable — reported as an ORPHAN", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway, recorder } = makeGateway(reservationFor(input, ca), {
      record: new Error("connection reset"),
    });

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.refusalCode).toBe("ISSUE_SIGNATURE_NOT_PERSISTED");
    expect(result.orphanSignature?.serialNumber).toBe(SERIAL);
    expect(result.orphanSignature?.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(recorder.orphanCalls).toBe(1);
    // NOT retried here. A retry would ask the CA to sign again for one request.
    expect(recorder.finalizeCalls).toBe(0);
  });

  it("still reports the orphan when recording the incident ALSO fails", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway } = makeGateway(reservationFor(input, ca), {
      record: new Error("connection reset"),
      orphan: new Error("still down"),
    });

    const result = await runGovernedIssuance(input, gateway, ca);

    // The fact must survive the failure to write it down, or it is lost.
    expect(result.orphanSignature).toBeDefined();
    expect(result.refusalCode).toBe("ISSUE_SIGNATURE_NOT_PERSISTED");
  });

  it("CRASH: finalization fails — RECOVERABLE, and explicitly not an orphan", async () => {
    const ca = makeCa();
    const input = await makeInput();
    const { gateway, recorder } = makeGateway(reservationFor(input, ca), {
      finalize: new Error("KLUY-CRED-RENEWAL-GENERATION-CONFLICT: head moved"),
    });

    const result = await runGovernedIssuance(input, gateway, ca);

    expect(result.refusalCode).toBe("ISSUE_FINALIZATION_FAILED");
    expect(result.recoverableFromRecordedSignature).toBe(true);
    // The signature IS on disk. Conflating this with an orphan would send an
    // operator looking for a loose signature that is in fact safely recorded.
    expect(result.orphanSignature).toBeUndefined();
    expect(recorder.recordCalls).toBe(1);
  });

  it("RECOVERY: an already-signed reservation finalizes without re-signing", async () => {
    const ca = makeCa();
    const input = await makeInput();
    let signCalls = 0;
    const counting = new Proxy(ca, {
      get(target, prop, receiver) {
        if (prop === "issueDeviceCertificate") {
          return (arg: Parameters<typeof ca.issueDeviceCertificate>[0]) => {
            signCalls += 1;
            return target.issueDeviceCertificate(arg);
          };
        }
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });
    const { gateway, recorder } = makeGateway(
      reservationFor(input, ca, { outcome: "REPLAYED_RESERVATION", alreadySigned: true }),
    );

    const result = await runGovernedIssuance(input, gateway, counting);

    expect(result.outcome).toBe("ISSUED");
    // The whole point of making the signature durable: recovery uses the
    // ORIGINAL one and never asks the CA for a second.
    expect(signCalls).toBe(0);
    expect(recorder.recordCalls).toBe(0);
    expect(recorder.finalizeCalls).toBe(1);
    expect(recorder.lastLinks?.map((l) => l.role)).toEqual(["root", "intermediate"]);
  });
});
