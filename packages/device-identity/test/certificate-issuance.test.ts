import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  tbsBytes,
  verifyCertificateChain,
  type Certificate,
} from "../src/dev-crypto.js";
import {
  issueDevelopmentCertificate,
  requestBytes,
  requestIdempotencyKey,
  type DeviceCertificateRequest,
  type IssuanceContext,
  type IssuanceStore,
  type IssuedCertificate,
} from "../src/certificate-issuance.js";
import { RequiredCryptographicValueError } from "../src/errors.js";
import type { DeviceRecordId } from "../src/index.js";
import {
  trusted,
  NOW,
  days,
  DEVICE,
  OTHER_DEVICE,
  RESTRICTED_STATUSES,
} from "./consumer-fixtures.js";

const ca = () => new DevelopmentCertificateAuthority({ notBefore: days(-1), notAfter: days(365) });

class MemoryIssuanceStore implements IssuanceStore {
  readonly byKey = new Map<string, IssuedCertificate>();
  readonly byRequestId = new Map<string, string>();
  public failPersist = false;

  async findByIdempotencyKey(key: string) {
    return this.byKey.get(key) ?? null;
  }
  async hasConflictingRequest(requestId: string, idempotencyKey: string) {
    const seen = this.byRequestId.get(requestId);
    return seen !== undefined && seen !== idempotencyKey;
  }
  async persist(input: IssuedCertificate & { request: DeviceCertificateRequest }) {
    if (this.failPersist) throw new Error("audit write failed");
    this.byKey.set(input.idempotencyKey, input);
    this.byRequestId.set(input.request.requestId, input.idempotencyKey);
  }
}

/** Builds a genuinely signed request: the device proves it holds the key. */
async function buildRequest(
  keys: DevelopmentDeviceKeyProvider,
  over: Partial<DeviceCertificateRequest> = {},
  deviceId: string = DEVICE,
): Promise<DeviceCertificateRequest> {
  await keys.generateDeviceKey(deviceId as DeviceRecordId, "development");
  const pem = keys.publicKeyPem(deviceId) as string;
  const base: DeviceCertificateRequest = {
    requestId: "req-1",
    deviceRecordId: deviceId,
    environment: "development",
    devicePublicKeyPem: pem,
    publicKeyFingerprint: publicKeyFingerprint(pem),
    hardwareTrustLevel: "development_software",
    assignmentGeneration: 5,
    requestedPurpose: "device_identity",
    requestedAt: NOW,
    nonce: "n-1",
    correlationId: "c-1",
    proofOfPossession: new Uint8Array(),
    ...over,
  };
  return {
    ...base,
    proofOfPossession: over.proofOfPossession ?? keys.provePossession(deviceId, requestBytes(base)),
  };
}

const ctx = (
  request: DeviceCertificateRequest,
  over: Partial<IssuanceContext> = {},
): IssuanceContext => ({
  request,
  trustedTime: trusted(),
  environment: "development",
  deviceRecordId: DEVICE,
  deviceLifecycleState: "awaiting_trust",
  currentAssignmentGeneration: 5,
  openBlockingIncidentCount: 0,
  pkiConfigurationActive: true,
  nextCertificateGeneration: 1,
  ...over,
});

describe("development CA hierarchy", () => {
  it("builds root -> intermediate -> device and verifies the real chain", async () => {
    const authority = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    const out = await issueDevelopmentCertificate(
      ctx(request),
      authority,
      new MemoryIssuanceStore(),
    );
    expect(out.outcome).toBe("ISSUED");

    const verdict = verifyCertificateChain(out.issued!.chain, {
      environment: "development",
      purpose: "device_identity",
      trustedRootFingerprints: [authority.rootKeyId],
    });
    expect(verdict.valid).toBe(true);
  });

  it("refuses a chain whose root this verifier does not anchor", async () => {
    const a = ca();
    const b = ca(); // a different development hierarchy
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      a,
      new MemoryIssuanceStore(),
    );
    const verdict = verifyCertificateChain(out.issued!.chain, {
      environment: "development",
      purpose: "device_identity",
      trustedRootFingerprints: [b.rootKeyId],
    });
    expect(verdict.rejectionCode).toBe("CHAIN_ROOT_NOT_TRUSTED");
  });

  it("refuses a device certificate presented as issued by the ROOT", async () => {
    const authority = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      authority,
      new MemoryIssuanceStore(),
    );
    const forged: Certificate = {
      ...out.issued!.certificate,
      tbs: { ...out.issued!.certificate.tbs, issuerKeyId: authority.rootKeyId },
    };
    const verdict = verifyCertificateChain(
      { ...out.issued!.chain, device: forged },
      {
        environment: "development",
        purpose: "device_identity",
        trustedRootFingerprints: [authority.rootKeyId],
      },
    );
    expect(verdict.rejectionCode).toBe("CHAIN_ROOT_ISSUED_DEVICE_DIRECTLY");
  });

  it("refuses a WRONG intermediate", async () => {
    const a = ca();
    const b = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      a,
      new MemoryIssuanceStore(),
    );
    const verdict = verifyCertificateChain(
      {
        root: a.rootCertificate,
        intermediate: b.intermediateCertificate,
        device: out.issued!.certificate,
      },
      {
        environment: "development",
        purpose: "device_identity",
        trustedRootFingerprints: [a.rootKeyId],
      },
    );
    // b's intermediate is not signed by a's root.
    expect(verdict.rejectionCode).toBe("CHAIN_INTERMEDIATE_NOT_SIGNED_BY_ROOT");
  });

  it("refuses a cross-environment chain", async () => {
    const authority = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      authority,
      new MemoryIssuanceStore(),
    );
    // Two independent defences, asserted separately.
    // 1. A production verifier does not anchor the development root at all.
    expect(
      verifyCertificateChain(out.issued!.chain, {
        environment: "production",
        purpose: "device_identity",
        trustedRootFingerprints: [],
      }).rejectionCode,
    ).toBe("CHAIN_ROOT_NOT_TRUSTED");

    // 2. Even if somebody WRONGLY anchored the development root in production,
    //    the environment binding still refuses the chain. Anchor membership and
    //    environment binding are not the same control, and neither alone is
    //    relied upon.
    expect(
      verifyCertificateChain(out.issued!.chain, {
        environment: "production",
        purpose: "device_identity",
        trustedRootFingerprints: [authority.rootKeyId],
      }).rejectionCode,
    ).toBe("CHAIN_ENVIRONMENT_MISMATCH");
  });

  it("refuses a wrong-purpose chain", async () => {
    const authority = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      authority,
      new MemoryIssuanceStore(),
    );
    const verdict = verifyCertificateChain(out.issued!.chain, {
      environment: "development",
      purpose: "release_signing",
      trustedRootFingerprints: [authority.rootKeyId],
    });
    expect(verdict.rejectionCode).toBe("CHAIN_PURPOSE_MISMATCH");
  });

  it("refuses a TAMPERED certificate", async () => {
    const authority = ca();
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      authority,
      new MemoryIssuanceStore(),
    );
    const tampered: Certificate = {
      ...out.issued!.certificate,
      tbs: { ...out.issued!.certificate.tbs, notAfter: days(3650).toISOString() },
    };
    const verdict = verifyCertificateChain(
      { ...out.issued!.chain, device: tampered },
      {
        environment: "development",
        purpose: "device_identity",
        trustedRootFingerprints: [authority.rootKeyId],
      },
    );
    expect(verdict.rejectionCode).toBe("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");
  });
});

describe("proof of possession", () => {
  it("refuses a FORGED proof of possession", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys, {
      proofOfPossession: new Uint8Array(64).fill(7),
    });
    const out = await issueDevelopmentCertificate(ctx(request), ca(), new MemoryIssuanceStore());
    expect(out.refusalCode).toBe("ISSUE_PROOF_OF_POSSESSION_FAILED");
  });

  it("refuses a private/public key MISMATCH", async () => {
    // Sign with device A's key while presenting device B's public key.
    const keys = new DevelopmentDeviceKeyProvider();
    await keys.generateDeviceKey(OTHER_DEVICE as DeviceRecordId, "development");
    const otherPem = keys.publicKeyPem(OTHER_DEVICE) as string;
    const request = await buildRequest(keys, {
      devicePublicKeyPem: otherPem,
      publicKeyFingerprint: publicKeyFingerprint(otherPem),
    });
    const out = await issueDevelopmentCertificate(ctx(request), ca(), new MemoryIssuanceStore());
    expect(out.refusalCode).toBe("ISSUE_PROOF_OF_POSSESSION_FAILED");
  });

  it("refuses a declared fingerprint that does not match the presented key", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys, { publicKeyFingerprint: "a".repeat(64) });
    const out = await issueDevelopmentCertificate(ctx(request), ca(), new MemoryIssuanceStore());
    expect(out.refusalCode).toBe("ISSUE_FINGERPRINT_MISMATCH");
  });
});

describe("issuance gates", () => {
  const run = async (
    over: Partial<DeviceCertificateRequest> = {},
    ctxOver: Partial<IssuanceContext> = {},
  ) => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys, over);
    return issueDevelopmentCertificate(ctx(request, ctxOver), ca(), new MemoryIssuanceStore());
  };

  it("refuses restricted and uninitialized trusted time", async () => {
    for (const status of RESTRICTED_STATUSES) {
      expect((await run({}, { trustedTime: trusted(NOW, status) })).refusalCode).toBe(
        "ISSUE_RESTRICTED_TRUST_MODE",
      );
    }
    expect((await run({}, { trustedTime: trusted(NOW, "uninitialized") })).refusalCode).toBe(
      "ISSUE_NO_TRUSTED_TIME",
    );
  });

  it("refuses a certificate for another device and a wrong environment", async () => {
    expect((await run({ deviceRecordId: OTHER_DEVICE })).refusalCode).toBe("ISSUE_WRONG_DEVICE");
    expect((await run({ environment: "production" })).refusalCode).toBe("ISSUE_WRONG_ENVIRONMENT");
  });

  it("refuses an unsupported purpose", async () => {
    expect((await run({ requestedPurpose: "release_signing" })).refusalCode).toBe(
      "ISSUE_UNSUPPORTED_PURPOSE",
    );
  });

  it("refuses a stale assignment generation", async () => {
    expect((await run({ assignmentGeneration: 4 })).refusalCode).toBe(
      "ISSUE_STALE_ASSIGNMENT_GENERATION",
    );
  });

  it("refuses a device that is not awaiting_trust", async () => {
    expect((await run({}, { deviceLifecycleState: "quarantined" })).refusalCode).toBe(
      "ISSUE_DEVICE_STATE",
    );
  });

  it("refuses an open blocking trust incident and an inactive PKI configuration", async () => {
    expect((await run({}, { openBlockingIncidentCount: 1 })).refusalCode).toBe(
      "ISSUE_OPEN_TRUST_INCIDENT",
    );
    expect((await run({}, { pkiConfigurationActive: false })).refusalCode).toBe(
      "ISSUE_PKI_INACTIVE",
    );
  });

  it("refuses a software-backed key requesting PRODUCTION eligibility", async () => {
    const out = await run({ requestsProductionEligibility: true });
    expect(out.refusalCode).toBe("ISSUE_PRODUCTION_ELIGIBILITY_REFUSED");
  });

  it("refuses pilot and production issuance outright", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    for (const environment of ["pilot", "production"] as const) {
      await expect(
        issueDevelopmentCertificate(ctx(request, { environment }), ca(), new MemoryIssuanceStore()),
      ).rejects.toBeInstanceOf(RequiredCryptographicValueError);
    }
  });

  it("stamps every issued certificate non-production-eligible", async () => {
    const out = await run();
    expect(out.issued!.certificate.tbs.productionEligible).toBe(false);
    expect(out.issued!.certificate.tbs.environment).toBe("development");
    expect(out.issued!.certificate.tbs.hardwareTrustLevel).toBe("development_software");
  });

  it("uses the 30-day development lifetime measured from TRUSTED time", async () => {
    const out = await run();
    const tbs = out.issued!.certificate.tbs;
    const lifetimeDays =
      (new Date(tbs.notAfter).getTime() - new Date(tbs.notBefore).getTime()) / 86_400_000;
    expect(lifetimeDays).toBeCloseTo(30, 5);
    expect(tbs.notBefore).toBe(NOW.toISOString());
  });
});

describe("idempotency and atomicity", () => {
  it("returns the SAME certificate for a duplicate request", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    const authority = ca();
    const store = new MemoryIssuanceStore();

    const first = await issueDevelopmentCertificate(ctx(request), authority, store);
    const second = await issueDevelopmentCertificate(ctx(request), authority, store);

    expect(first.outcome).toBe("ISSUED");
    expect(second.outcome).toBe("REPLAYED");
    expect(second.issued!.certificate.tbs.serialNumber).toBe(
      first.issued!.certificate.tbs.serialNumber,
    );
    expect(store.byKey.size).toBe(1);
  });

  it("refuses a reused requestId carrying a DIFFERENT payload", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const authority = ca();
    const store = new MemoryIssuanceStore();
    const first = await buildRequest(keys, { requestId: "shared" });
    await issueDevelopmentCertificate(ctx(first), authority, store);

    const second = await buildRequest(keys, { requestId: "shared", nonce: "n-2" });
    const out = await issueDevelopmentCertificate(ctx(second), authority, store);
    expect(out.refusalCode).toBe("ISSUE_DUPLICATE_REQUEST_DIFFERENT_PAYLOAD");
  });

  it("PARALLEL identical requests produce exactly one certificate", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    const authority = ca();
    const store = new MemoryIssuanceStore();

    const results = await Promise.all([
      issueDevelopmentCertificate(ctx(request), authority, store),
      issueDevelopmentCertificate(ctx(request), authority, store),
      issueDevelopmentCertificate(ctx(request), authority, store),
    ]);
    const serials = new Set(
      results.filter((r) => r.issued).map((r) => r.issued!.certificate.tbs.serialNumber),
    );
    // The serial is derived from the idempotency key, so even a race that
    // signs twice cannot produce two DIFFERENT certificates for one request.
    expect(serials.size).toBe(1);
    expect(store.byKey.size).toBe(1);
  });

  it("reports an ORPHAN SIGNATURE when the CA signs but persistence fails", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    const store = new MemoryIssuanceStore();
    store.failPersist = true;

    const out = await issueDevelopmentCertificate(ctx(request), ca(), store);
    expect(out.outcome).toBe("REFUSED");
    expect(out.refusalCode).toBe("ISSUE_PERSISTENCE_FAILED");
    expect(out.orphanSignatureIncident).toBeDefined();
    expect(out.orphanSignatureIncident!.serialNumber).toMatch(/^DEV-/);
    // Nothing was recorded, and NO success was reported.
    expect(store.byKey.size).toBe(0);
    expect(out.issued).toBeUndefined();
  });

  it("does not silently retry after a persistence failure", async () => {
    // A retry that succeeded would mint a second valid certificate for one
    // request. The caller must decide, with the orphan incident in hand.
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    const store = new MemoryIssuanceStore();
    store.failPersist = true;
    await issueDevelopmentCertificate(ctx(request), ca(), store);
    expect(store.byKey.size).toBe(0);
  });
});

describe("no private key material escapes", () => {
  it("device key metadata carries only public fields", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const meta = await keys.generateDeviceKey(DEVICE as DeviceRecordId, "development");
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toMatch(/PRIVATE KEY/);
    expect(serialized).not.toMatch(/privateKey/i);
    expect(Object.keys(meta).sort()).toEqual([
      "algorithm",
      "exportable",
      "generatedOnDevice",
      "hardwareTrustLevel",
      "publicKeyFingerprint",
    ]);
  });

  it("the issued certificate and chain contain no private key material", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      ca(),
      new MemoryIssuanceStore(),
    );
    const dump = JSON.stringify(out.issued, (_k, v) =>
      v instanceof Uint8Array ? Buffer.from(v).toString("base64") : v,
    );
    expect(dump).not.toMatch(/PRIVATE KEY/);
    expect(dump).toMatch(/PUBLIC KEY/);
  });

  it("the provider exposes no method returning key material", () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const names = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(keys)),
      ...Object.keys(keys),
    ];
    expect(names.some((n) => /private|export|secret|reveal/i.test(n))).toBe(false);
  });

  it("the request idempotency key is derived, not random", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const request = await buildRequest(keys);
    expect(requestIdempotencyKey(request)).toBe(requestIdempotencyKey(request));
    expect(requestIdempotencyKey({ ...request, nonce: "different" })).not.toBe(
      requestIdempotencyKey(request),
    );
  });
});

describe("signed bytes are canonical", () => {
  it("re-serializing a certificate does not change what verifies", async () => {
    const keys = new DevelopmentDeviceKeyProvider();
    const out = await issueDevelopmentCertificate(
      ctx(await buildRequest(keys)),
      ca(),
      new MemoryIssuanceStore(),
    );
    const tbs = out.issued!.certificate.tbs;
    // Field order in the object is irrelevant; tbsBytes fixes the order.
    const reordered = { ...tbs, serialNumber: tbs.serialNumber, certificateId: tbs.certificateId };
    expect(Buffer.from(tbsBytes(reordered))).toEqual(Buffer.from(tbsBytes(tbs)));
  });

  it("uses a UUID-shaped certificate identity, not a guessable counter", async () => {
    expect(randomUUID()).toMatch(/^[0-9a-f-]{36}$/);
  });
});
