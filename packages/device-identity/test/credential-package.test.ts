/**
 * TERMINAL CREDENTIAL PACKAGE — the shared verifier, WS-11-T004-P04C1.
 *
 * Pure crypto and canonicalization: no database, no transport. What the
 * TERMINAL must be able to decide, entirely on its own, before it installs
 * anything — including on a Store LAN with no cloud reachable.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DevelopmentCertificateAuthority,
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
} from "../src/dev-crypto.js";
import {
  CREDENTIAL_PACKAGE_KIND,
  assertNoPrivateKeyMaterial,
  credentialPackageBytes,
  projectionFactsFromPackage,
  verifyCredentialPackage,
  type CredentialPackageExpectation,
  type SignedTerminalCredentialPackage,
  type TerminalCredentialPackage,
} from "../src/credential-package.js";
import type { TrustEnvironment } from "../src/environments.js";

const ENV: TrustEnvironment = "development";
const T1 = "laundry.t1.intake_cashier";

function harness() {
  const keys = new DevelopmentDeviceKeyProvider();
  const ca = new DevelopmentCertificateAuthority({
    notBefore: new Date(Date.now() - 3_600_000),
    notAfter: new Date(Date.now() + 365 * 24 * 3_600_000),
  });

  const authorityRef = `authority-${randomUUID().slice(0, 8)}`;
  keys.generateDeviceKey(authorityRef, ENV);
  const authorityPem = keys.publicKeyPem(authorityRef) ?? "";
  const authorityFingerprint = publicKeyFingerprint(authorityPem);

  function terminal(label: string) {
    const ref = `${label}-${randomUUID().slice(0, 8)}`;
    keys.generateDeviceKey(ref, ENV);
    const pem = keys.publicKeyPem(ref) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const credentialId = randomUUID();
    const serial = `PKG-${label}-${randomUUID().slice(0, 8)}`;
    const terminalDeviceId = randomUUID();
    const notBefore = new Date(Date.now() - 60_000);
    const notAfter = new Date(Date.now() + 30 * 24 * 3_600_000);
    const device = ca.issueDeviceCertificate({
      certificateId: credentialId,
      serialNumber: serial,
      subjectPublicKeyPem: pem,
      subjectFingerprint: fingerprint,
      deviceRecordId: terminalDeviceId,
      certificateGeneration: 1,
      hardwareTrustLevel: "software_only",
      notBefore,
      notAfter,
    });
    const pkg: TerminalCredentialPackage = {
      packageVersion: "1",
      credentialId,
      certificateSerial: serial,
      publicKeyFingerprint: fingerprint,
      environment: ENV,
      issuedAt: notBefore.toISOString(),
      expiresAt: notAfter.toISOString(),
      terminalDeviceId,
      terminalAssignmentId: randomUUID(),
      terminalAssignmentGeneration: 1,
      terminalProfileKey: T1,
      storeHubDeviceId: randomUUID(),
      tenantId: randomUUID(),
      digitalStoreId: randomUUID(),
      storeLocationId: randomUUID(),
      chain: { root: ca.rootCertificate, intermediate: ca.intermediateCertificate, device },
    };
    const expectation: CredentialPackageExpectation = {
      terminalDeviceId: pkg.terminalDeviceId,
      terminalAssignmentId: pkg.terminalAssignmentId,
      terminalAssignmentGeneration: 1,
      terminalProfileKey: T1,
      storeHubDeviceId: pkg.storeHubDeviceId,
      tenantId: pkg.tenantId,
      digitalStoreId: pkg.digitalStoreId,
      storeLocationId: pkg.storeLocationId,
      environment: ENV,
      subjectKeyFingerprint: fingerprint,
      trustedRootFingerprints: [ca.rootCertificate.tbs.subjectFingerprint],
      trustedAuthorityKeys: new Map([[authorityFingerprint, authorityPem]]),
    };
    return { ref, pem, fingerprint, pkg, expectation };
  }

  const sign = (pkg: TerminalCredentialPackage): SignedTerminalCredentialPackage => ({
    package: pkg,
    authorityKeyFingerprint: authorityFingerprint,
    signature: keys.provePossession(authorityRef, credentialPackageBytes(pkg)),
  });

  return { keys, ca, terminal, sign, authorityFingerprint, authorityPem };
}

describe("terminal credential package (P04C1)", () => {
  it("verifies a well-formed package and reports what may be installed", () => {
    const h = harness();
    const t = h.terminal("ok");
    const verdict = verifyCredentialPackage(h.sign(t.pkg), t.expectation, new Date());
    expect(verdict.verified, verdict.detail).toBe(true);
    expect(verdict.installable?.credentialId).toBe(t.pkg.credentialId);
    expect(verdict.installable?.certificateFingerprint).toBe(t.fingerprint);
  });

  it("canonical bytes are field-ordered and domain-separated", () => {
    const h = harness();
    const t = h.terminal("bytes");
    const text = Buffer.from(credentialPackageBytes(t.pkg)).toString("utf8");
    expect(text.startsWith(`${CREDENTIAL_PACKAGE_KIND}\n1\n`)).toBe(true);
    // Re-serializing an identical structure produces identical bytes: the
    // signature cannot depend on object key order.
    const reordered = JSON.parse(
      JSON.stringify({ ...t.pkg }),
    ) as unknown as TerminalCredentialPackage;
    const rebuilt: TerminalCredentialPackage = {
      ...reordered,
      chain: t.pkg.chain,
    };
    expect(Buffer.from(credentialPackageBytes(rebuilt)).toString("utf8")).toBe(text);
    // The certificate is bound by its CANONICAL bytes, so a chain swap changes
    // the payload even when every scalar field is identical.
    const other = h.terminal("bytes2");
    const swapped = { ...t.pkg, chain: other.pkg.chain };
    expect(Buffer.from(credentialPackageBytes(swapped)).toString("utf8")).not.toBe(text);
  });

  it("refuses an unsigned, wrongly-signed or unknown authority", () => {
    const h = harness();
    const t = h.terminal("auth");
    const good = h.sign(t.pkg);

    expect(
      verifyCredentialPackage({ ...good, signature: Buffer.alloc(64) }, t.expectation, new Date())
        .rejectionCode,
    ).toBe("PACKAGE_AUTHORITY_INVALID");
    expect(
      verifyCredentialPackage(
        { ...good, authorityKeyFingerprint: "a".repeat(64) },
        t.expectation,
        new Date(),
      ).rejectionCode,
    ).toBe("PACKAGE_AUTHORITY_UNKNOWN");
    // An empty trust set opens nothing, whatever the signature says.
    expect(
      verifyCredentialPackage(
        good,
        { ...t.expectation, trustedAuthorityKeys: new Map() },
        new Date(),
      ).rejectionCode,
    ).toBe("PACKAGE_AUTHORITY_UNKNOWN");
  });

  it("refuses a package built over another terminal's key", () => {
    const h = harness();
    const mine = h.terminal("mine");
    const theirs = h.terminal("theirs");
    // Everything about the package is internally consistent; it simply is not
    // this terminal's credential.
    const verdict = verifyCredentialPackage(h.sign(theirs.pkg), mine.expectation, new Date());
    expect(verdict.rejectionCode).toBe("PACKAGE_TERMINAL_MISMATCH");
  });

  it("recomputes the fingerprint rather than trusting the package's claim", () => {
    const h = harness();
    const t = h.terminal("fp");
    const other = h.terminal("fp2");
    const lying = { ...t.pkg, publicKeyFingerprint: other.fingerprint };
    expect(verifyCredentialPackage(h.sign(lying), t.expectation, new Date()).rejectionCode).toBe(
      "PACKAGE_FINGERPRINT_MISMATCH",
    );
  });

  it("refuses an untrusted chain anchor — a pilot verifier cannot use a dev chain", () => {
    const h = harness();
    const t = h.terminal("anchor");
    expect(
      verifyCredentialPackage(
        h.sign(t.pkg),
        { ...t.expectation, trustedRootFingerprints: ["b".repeat(64)] },
        new Date(),
      ).rejectionCode,
    ).toBe("PACKAGE_CHAIN_INVALID");
  });

  it("judges the validity window against the caller's trusted instant", () => {
    const h = harness();
    const t = h.terminal("window");
    const before = new Date(Date.parse(t.pkg.issuedAt) - 1000);
    const after = new Date(Date.parse(t.pkg.expiresAt) + 1000);
    expect(verifyCredentialPackage(h.sign(t.pkg), t.expectation, before).rejectionCode).toBe(
      "PACKAGE_WINDOW_INVALID",
    );
    expect(verifyCredentialPackage(h.sign(t.pkg), t.expectation, after).rejectionCode).toBe(
      "PACKAGE_WINDOW_INVALID",
    );
    // A window that disagrees with the certificate's own window is refused
    // even while "current" — the package cannot extend a credential.
    const stretched = {
      ...t.pkg,
      expiresAt: new Date(Date.parse(t.pkg.expiresAt) + 86_400_000).toISOString(),
    };
    expect(
      verifyCredentialPackage(h.sign(stretched), t.expectation, new Date()).rejectionCode,
    ).toBe("PACKAGE_WINDOW_INVALID");
  });

  it("refuses private key material anywhere in the delivered value", () => {
    const h = harness();
    const t = h.terminal("private");
    const poisoned = {
      ...h.sign(t.pkg),
      recovery: { blob: "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----" },
    } as unknown as SignedTerminalCredentialPackage;
    expect(verifyCredentialPackage(poisoned, t.expectation, new Date()).rejectionCode).toBe(
      "PACKAGE_PRIVATE_MATERIAL_PRESENT",
    );
    expect(() => assertNoPrivateKeyMaterial(h.sign(t.pkg))).not.toThrow();
    for (const label of ["EC", "RSA", "ENCRYPTED"]) {
      expect(() =>
        assertNoPrivateKeyMaterial({ x: `-----BEGIN ${label} PRIVATE KEY-----` }),
      ).toThrow(/PRIVATE-MATERIAL/);
    }
    // A cyclic payload is walked without hanging.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic["self"] = cyclic;
    expect(() => assertNoPrivateKeyMaterial(cyclic)).not.toThrow();
  });

  it("projection facts are derived from the package, never hand-built", () => {
    const h = harness();
    const t = h.terminal("facts");
    const facts = projectionFactsFromPackage(t.pkg, {
      issuer: "KitLuy Development Device CA",
      credentialType: "terminal_operational",
      status: "active",
      rotationGeneration: 1,
    });
    // What the Hub is told is exactly what the terminal was told.
    expect(facts.credentialId).toBe(t.pkg.credentialId);
    expect(facts.certificateSerial).toBe(t.pkg.certificateSerial);
    expect(facts.publicKeyFingerprint).toBe(t.pkg.publicKeyFingerprint);
    expect(facts.terminalDeviceId).toBe(t.pkg.terminalDeviceId);
    expect(facts.environment).toBe(t.pkg.environment);
    // And the chain is deliberately NOT projected: the Hub authorizes against
    // credential identity and status, it does not decide certificate validity.
    expect(Object.keys(facts)).not.toContain("chain");
    expect(() => assertNoPrivateKeyMaterial(facts)).not.toThrow();
  });

  it("refuses an unsupported package version before interpreting anything", () => {
    const h = harness();
    const t = h.terminal("version");
    const future = { ...t.pkg, packageVersion: "2" };
    expect(verifyCredentialPackage(h.sign(future), t.expectation, new Date()).rejectionCode).toBe(
      "PACKAGE_VERSION_UNSUPPORTED",
    );
  });
});
