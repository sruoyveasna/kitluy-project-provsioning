/**
 * `certificate.validity` — now driven by REAL cryptography.
 *
 * Every credential in this suite is genuinely issued and genuinely signed.
 * There is no `signatureValid` input any more: a forged credential is built by
 * actually tampering with signed bytes, and the verifier catches it or the test
 * fails. That distinction is the whole point of the cutover.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  type Certificate,
  type CertificateChain,
} from "../src/dev-crypto.js";
import {
  issueDevelopmentCertificate,
  requestBytes,
  type DeviceCertificateRequest,
  type IssuanceStore,
  type IssuedCertificate,
} from "../src/certificate-issuance.js";
import {
  CREDENTIAL_KIND,
  certificateGrantsProductionEligibility,
  credentialView,
  evaluateCertificateValidity,
  type CertificateVerificationContext,
} from "../src/certificate-validity.js";
import type { DeviceRecordId } from "../src/index.js";
import {
  DEVICE,
  NOW,
  OTHER_DEVICE,
  RESTRICTED_STATUSES,
  days,
  noRevocations,
  revokes,
  trusted,
} from "./consumer-fixtures.js";

class NullStore implements IssuanceStore {
  async findByIdempotencyKey() {
    return null;
  }
  async hasConflictingRequest() {
    return false;
  }
  async persist() {
    /* nothing to keep for these probes */
  }
}

/** Issues a real credential for DEVICE and returns everything needed to verify. */
async function issued(deviceId: string = DEVICE, generation = 1) {
  const ca = new DevelopmentCertificateAuthority({ notBefore: days(-1), notAfter: days(365) });
  const keys = new DevelopmentDeviceKeyProvider();
  await keys.generateDeviceKey(deviceId as DeviceRecordId, "development");
  const pem = keys.publicKeyPem(deviceId) as string;
  const base: DeviceCertificateRequest = {
    requestId: `req-${deviceId}`,
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
  };
  const request: DeviceCertificateRequest = {
    ...base,
    proofOfPossession: keys.provePossession(deviceId, requestBytes(base)),
  };
  const out = await issueDevelopmentCertificate(
    {
      request,
      trustedTime: trusted(),
      environment: "development",
      deviceRecordId: deviceId,
      deviceLifecycleState: "awaiting_trust",
      currentAssignmentGeneration: 5,
      openBlockingIncidentCount: 0,
      pkiConfigurationActive: true,
      nextCertificateGeneration: generation,
    },
    ca,
    new NullStore(),
  );
  return {
    ca,
    keys,
    fingerprint: publicKeyFingerprint(pem),
    issued: out.issued as IssuedCertificate,
  };
}

const ctxFor = async (over: Partial<CertificateVerificationContext> = {}) => {
  const { ca, fingerprint, issued: cert } = await issued();
  return {
    chain: cert.chain,
    trustedTime: trusted(),
    environment: "development" as const,
    deviceRecordId: DEVICE,
    currentKeyFingerprint: fingerprint,
    currentCertificateGeneration: 1,
    revocations: noRevocations,
    trustedRootFingerprints: [ca.rootKeyId],
    ...over,
  } satisfies CertificateVerificationContext;
};

describe("certificate.validity with real cryptography", () => {
  it("accepts a genuinely issued and signed development credential", async () => {
    const v = evaluateCertificateValidity(await ctxFor());
    expect(v.valid).toBe(true);
    expect(v.credentialKind).toBe(CREDENTIAL_KIND);
    expect(v.evaluatedAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("names the artifact so it cannot be reported as X.509 or mTLS evidence", async () => {
    const v = evaluateCertificateValidity(await ctxFor());
    expect(v.credentialKind).toBe("kitluy.development-device-credential.v1");
  });

  it("fails closed with no trusted time and in every restricted mode", async () => {
    expect(
      evaluateCertificateValidity(await ctxFor({ trustedTime: trusted(NOW, "uninitialized") }))
        .rejectionCode,
    ).toBe("CERT_NO_TRUSTED_TIME");
    for (const status of RESTRICTED_STATUSES) {
      expect(
        evaluateCertificateValidity(await ctxFor({ trustedTime: trusted(NOW, status) }))
          .rejectionCode,
      ).toBe("CERT_RESTRICTED_TRUST_MODE");
    }
  });

  it("REJECTS a tampered credential — the signature is checked, not claimed", async () => {
    const base = await ctxFor();
    const tampered: Certificate = {
      ...base.chain.device,
      tbs: { ...base.chain.device.tbs, notAfter: days(3650).toISOString() },
    };
    const v = evaluateCertificateValidity({
      ...base,
      chain: { ...base.chain, device: tampered } as CertificateChain,
    });
    expect(v.rejectionCode).toBe("CERT_CHAIN_INVALID");
    expect(v.detail).toContain("CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE");
  });

  it("REJECTS an unanchored root and a foreign intermediate", async () => {
    const base = await ctxFor();
    const other = new DevelopmentCertificateAuthority({
      notBefore: days(-1),
      notAfter: days(365),
    });
    expect(
      evaluateCertificateValidity({ ...base, trustedRootFingerprints: [other.rootKeyId] }).detail,
    ).toContain("CHAIN_ROOT_NOT_TRUSTED");
    expect(
      evaluateCertificateValidity({
        ...base,
        chain: { ...base.chain, intermediate: other.intermediateCertificate },
      }).detail,
    ).toContain("CHAIN_INTERMEDIATE_NOT_SIGNED_BY_ROOT");
  });

  it("REJECTS a credential presented as issued directly by the root", async () => {
    const base = await ctxFor();
    const rootFp = base.chain.root.tbs.subjectFingerprint;
    const forged: Certificate = {
      ...base.chain.device,
      tbs: { ...base.chain.device.tbs, issuerKeyId: rootFp },
    };
    expect(
      evaluateCertificateValidity({ ...base, chain: { ...base.chain, device: forged } }).detail,
    ).toContain("CHAIN_ROOT_ISSUED_DEVICE_DIRECTLY");
  });

  it("REJECTS a cross-environment credential", async () => {
    const base = await ctxFor();
    const v = evaluateCertificateValidity({ ...base, environment: "production" });
    expect(v.rejectionCode).toBe("CERT_CHAIN_INVALID");
  });

  it("REJECTS a credential for another device", async () => {
    const base = await ctxFor();
    expect(
      evaluateCertificateValidity({ ...base, deviceRecordId: OTHER_DEVICE }).rejectionCode,
    ).toBe("CERT_WRONG_DEVICE");
  });

  it("REJECTS a credential attesting to a key the device no longer holds", async () => {
    const base = await ctxFor();
    expect(
      evaluateCertificateValidity({ ...base, currentKeyFingerprint: "f".repeat(64) }).rejectionCode,
    ).toBe("CERT_KEY_FINGERPRINT_MISMATCH");
  });

  it("REJECTS a stale certificate generation", async () => {
    const base = await ctxFor();
    expect(
      evaluateCertificateValidity({ ...base, currentCertificateGeneration: 3 }).rejectionCode,
    ).toBe("CERT_STALE_CERTIFICATE_GENERATION");
  });

  it("expires purely by trusted time advancing", async () => {
    const base = await ctxFor();
    expect(evaluateCertificateValidity({ ...base, trustedTime: trusted(days(20)) }).valid).toBe(
      true,
    );
    expect(
      evaluateCertificateValidity({ ...base, trustedTime: trusted(days(40)) }).rejectionCode,
    ).toBe("CERT_EXPIRED");
  });

  it("REJECTS a not-yet-valid credential", async () => {
    const base = await ctxFor();
    expect(
      evaluateCertificateValidity({ ...base, trustedTime: trusted(days(-5)) }).rejectionCode,
    ).toBe("CERT_NOT_YET_VALID");
  });

  it("reports REVOKED, not EXPIRED, for a revoked AND lapsed credential", async () => {
    // §5.4 precedence, preserved through the cutover.
    const base = await ctxFor();
    const serial = base.chain.device.tbs.serialNumber;
    const v = evaluateCertificateValidity({
      ...base,
      trustedTime: trusted(days(40)),
      revocations: revokes(serial),
    });
    expect(v.rejectionCode).toBe("CERT_REVOKED");
  });

  it("projects a credential view without exposing signed internals", async () => {
    const base = await ctxFor();
    const view = credentialView(base.chain.device.tbs);
    expect(view.deviceRecordId).toBe(DEVICE);
    expect(view.certificateGeneration).toBe(1);
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE KEY/);
  });

  it("never grants production eligibility", () => {
    expect(certificateGrantsProductionEligibility()).toBe(false);
  });

  it("has no way for a caller to assert a signature verdict", () => {
    // The legacy `signatureValid` entry point is gone, not deprecated. If it
    // came back, this test is where that would be noticed.
    const source = readFileSync(join(process.cwd(), "src", "certificate-validity.ts"), "utf8");
    // Comments stripped first. The header legitimately EXPLAINS that the input
    // is gone, and matching that sentence would fail a correct file — the same
    // trap the clock gate fell into (RV-A4).
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/signatureValid/);
  });
});
