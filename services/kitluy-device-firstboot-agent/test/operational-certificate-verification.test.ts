/**
 * The Hub verifies its own certificate, and REFUSES every way it can be wrong.
 *
 * Authority: owner instruction 2026-08-28, "DEVICE-SIDE CERTIFICATE
 * VERIFICATION — this is mandatory".
 *
 * Every negative case below is a certificate that a device trusting the
 * transport would have adopted. The control case at the top is what makes the
 * rest meaningful: if the happy path did not pass, "everything is refused" would
 * be trivially true and prove nothing.
 */
import { createHash, createPublicKey, generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  verifyOperationalCertificate,
  type VerificationCheck,
} from "../src/operational-certificate-verification.js";
import { buildChain, mintLeaf, testRsaKey, type TestChain } from "./support/operational-fixtures.js";

const DEVICE = "9f1c2b3a-4d5e-4f60-8a71-b2c3d4e5f607";
const SERIAL_HEX = "0abcdef012345678";

const chain: TestChain = buildChain();
const device = testRsaKey();

const fingerprintOf = (publicKeyPem: string): string =>
  createHash("sha256")
    .update(new Uint8Array(createPublicKey(publicKeyPem).export({ type: "spki", format: "der" })))
    .digest("hex");

function baseInput(overrides: Partial<Parameters<typeof verifyOperationalCertificate>[0]> = {}) {
  const leaf = mintLeaf({
    chain,
    subjectPublicKeyPem: device.publicKeyPem,
    deviceRecordId: DEVICE,
    serialHex: SERIAL_HEX,
  });
  return {
    certificatePem: leaf.certificatePem,
    chainPem: chain.chainPem,
    localPublicKeyPem: device.publicKeyPem,
    expectedRootSha256: chain.rootSha256,
    expectedPublicKeyFingerprint: fingerprintOf(device.publicKeyPem),
    expectedX509Serial: "abcdef012345678",
    expectedCredentialGeneration: 1,
    expectedAssignmentGeneration: 3,
    deviceRecordId: DEVICE,
    environment: "development",
    trustedTime: new Date(),
    expectedAlgorithm: "rsa-2048",
    ...overrides,
  };
}

/** Assert that verification failed, and that it failed for the RIGHT reason. */
function expectRefusal(
  input: Parameters<typeof verifyOperationalCertificate>[0],
  check: VerificationCheck,
): void {
  const outcome = verifyOperationalCertificate(input);
  expect(outcome.ok, `expected a refusal on ${check}`).toBe(false);
  if (outcome.ok) return;
  expect(
    outcome.failures.map((f) => f.check),
    `refused, but not on ${check}: ${JSON.stringify(outcome.failures)}`,
  ).toContain(check);
}

describe("device-side certificate verification", () => {
  it("ACCEPTS a certificate that is correct in every respect", () => {
    const outcome = verifyOperationalCertificate(baseInput());
    expect(outcome.ok, JSON.stringify(outcome.ok ? {} : outcome.failures)).toBe(true);
  });

  it("refuses an unparseable leaf", () => {
    expectRefusal(
      baseInput({ certificatePem: "-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----\n" }),
      "LEAF_PARSES",
    );
  });

  it("refuses a chain that is too short to build a path", () => {
    expectRefusal(baseInput({ chainPem: chain.intermediatePem }), "INTERMEDIATE_PARSES");
  });

  it("refuses a leaf signed by the WRONG issuing CA", () => {
    const rogue = buildChain("Rogue Development Root CA");
    const forged = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      // Correct key, correct metadata, signed by somebody else.
      signerKeyPem: rogue.intermediateKeyPem,
    });
    expectRefusal(
      baseInput({ certificatePem: forged.certificatePem }),
      "LEAF_SIGNED_BY_INTERMEDIATE",
    );
  });

  it("refuses a self-consistent chain that is not OUR root", () => {
    // The case a chain check alone cannot catch. This chain verifies perfectly
    // — it is simply someone else's, and the pin is the only thing that knows.
    const rogue = buildChain();
    const forged = mintLeaf({
      chain: rogue,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
    });
    expectRefusal(
      baseInput({ certificatePem: forged.certificatePem, chainPem: rogue.chainPem }),
      "ROOT_IS_THE_EXPECTED_DEVELOPMENT_ROOT",
    );
  });

  it("refuses a certificate over somebody else's key", () => {
    const stranger = testRsaKey();
    const forged = mintLeaf({
      chain,
      subjectPublicKeyPem: stranger.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
    });
    // Signed by the real CA, naming the real device — and useless, because the
    // Hub does not hold the private half. This is finding C-1 from the device's
    // side.
    expectRefusal(baseInput({ certificatePem: forged.certificatePem }), "LEAF_KEY_IS_THE_LOCAL_KEY");
  });

  it("refuses when the governed fingerprint does not describe the leaf", () => {
    expectRefusal(
      baseInput({ expectedPublicKeyFingerprint: "ab".repeat(32) }),
      "SPKI_FINGERPRINT_MATCHES_GOVERNED",
    );
  });

  it("refuses a serial that is not the governed one", () => {
    expectRefusal(baseInput({ expectedX509Serial: "0102030405060708" }), "SERIAL_MATCHES_GOVERNED");
  });

  it("accepts a serial that differs only by DER sign-byte display", () => {
    // R2-1: Node drops the sign byte when printing. Comparing as integers is
    // what makes roughly half of all serials verifiable at all.
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: "00ff34c1a664c9e512",
    });
    const outcome = verifyOperationalCertificate(
      baseInput({ certificatePem: leaf.certificatePem, expectedX509Serial: "00ff34c1a664c9e512" }),
    );
    expect(outcome.ok, JSON.stringify(outcome.ok ? {} : outcome.failures)).toBe(true);
  });

  it("refuses an inverted validity window", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      notBefore: new Date(Date.now() + 86_400_000),
      notAfter: new Date(Date.now() - 86_400_000),
    });
    expectRefusal(baseInput({ certificatePem: leaf.certificatePem }), "VALIDITY_WINDOW_IS_SANE");
  });

  it("refuses a lifetime longer than this profile issues", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      notAfter: new Date(Date.now() + 3650 * 86_400_000),
    });
    // A ten-year development certificate did not come from our governed doors,
    // whoever signed it.
    expectRefusal(baseInput({ certificatePem: leaf.certificatePem }), "VALIDITY_WINDOW_IS_SANE");
  });

  it("refuses an EXPIRED certificate, judged by TRUSTED time", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      notBefore: new Date(Date.now() - 40 * 86_400_000),
      notAfter: new Date(Date.now() - 10 * 86_400_000),
    });
    expectRefusal(
      baseInput({ certificatePem: leaf.certificatePem }),
      "CURRENTLY_USABLE_AT_TRUSTED_TIME",
    );
  });

  it("ACCEPTS a notBefore just ahead of the device's trusted-time observation", () => {
    // THE NORMAL CASE, and it was a real defect until the end-to-end suite
    // caught it under load. The device observes trusted time BEFORE it asks; the
    // server stamps notBefore when it issues. Real seconds pass between the two,
    // so notBefore is ALWAYS slightly ahead of what the device observed — and a
    // Hub that refused that would refuse every certificate it is ever issued.
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      notBefore: new Date(Date.now() + 90_000),
      notAfter: new Date(Date.now() + 30 * 86_400_000),
    });
    const outcome = verifyOperationalCertificate(baseInput({ certificatePem: leaf.certificatePem }));
    expect(outcome.ok, JSON.stringify(outcome.ok ? {} : outcome.failures)).toBe(true);
  });

  it("refuses a NOT-YET-VALID certificate, judged by TRUSTED time", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      // Days ahead — far beyond the bounded allowance, so this is a real
      // anomaly and must still be refused.
      notBefore: new Date(Date.now() + 5 * 86_400_000),
      notAfter: new Date(Date.now() + 20 * 86_400_000),
    });
    expectRefusal(
      baseInput({ certificatePem: leaf.certificatePem }),
      "CURRENTLY_USABLE_AT_TRUSTED_TIME",
    );
  });

  it("uses TRUSTED time and not the host clock", () => {
    // A Store Hub has no battery-backed RTC. A certificate that is valid now
    // must be refused if trusted time says otherwise — which is the entire
    // reason the trusted-time authority exists.
    expectRefusal(
      baseInput({ trustedTime: new Date(Date.now() + 400 * 86_400_000) }),
      "CURRENTLY_USABLE_AT_TRUSTED_TIME",
    );
  });

  it("refuses a certificate issued to a DIFFERENT device", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: "00000000-0000-4000-8000-000000000000",
      serialHex: SERIAL_HEX,
    });
    expectRefusal(baseInput({ certificatePem: leaf.certificatePem }), "SAN_IDENTIFIES_THIS_DEVICE");
  });

  it("refuses a non-development environment, under BLK-005", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      environment: "production",
    });
    expectRefusal(
      baseInput({ certificatePem: leaf.certificatePem, environment: "production" }),
      "ENVIRONMENT_IS_DEVELOPMENT",
    );
  });

  it("refuses a credential generation that is not the governed one", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      credentialGeneration: 9,
    });
    expectRefusal(
      baseInput({ certificatePem: leaf.certificatePem }),
      "CREDENTIAL_GENERATION_MATCHES",
    );
  });

  it("refuses a nonsensical assignment generation", () => {
    expectRefusal(baseInput({ expectedAssignmentGeneration: 0 }), "ASSIGNMENT_GENERATION_MATCHES");
  });

  it("refuses a leaf that claims to be a CA", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      ca: true,
    });
    expectRefusal(baseInput({ certificatePem: leaf.certificatePem }), "KEY_USAGE_PROFILE_MATCHES");
  });

  it("refuses a leaf missing clientAuth", () => {
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: device.publicKeyPem,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
      extendedKeyUsage: { serverAuth: true },
    });
    expectRefusal(baseInput({ certificatePem: leaf.certificatePem }), "KEY_USAGE_PROFILE_MATCHES");
  });

  it("refuses an unsupported key algorithm", () => {
    const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 3072 });
    const wide = publicKey.export({ type: "spki", format: "pem" }).toString();
    const leaf = mintLeaf({
      chain,
      subjectPublicKeyPem: wide,
      deviceRecordId: DEVICE,
      serialHex: SERIAL_HEX,
    });
    expectRefusal(
      baseInput({ certificatePem: leaf.certificatePem, localPublicKeyPem: wide }),
      "ALGORITHM_IS_SUPPORTED",
    );
  });

  it("refuses when the governed response names an unsupported algorithm", () => {
    expectRefusal(baseInput({ expectedAlgorithm: "ed25519" }), "ALGORITHM_IS_SUPPORTED");
  });

  it("collects EVERY failure rather than stopping at the first", () => {
    // One failure is a mistake; six is an attack or a badly wrong deployment,
    // and an operator shown only the first cannot tell those apart.
    const rogue = buildChain();
    const stranger = testRsaKey();
    const forged = mintLeaf({
      chain: rogue,
      subjectPublicKeyPem: stranger.publicKeyPem,
      deviceRecordId: "00000000-0000-4000-8000-000000000000",
      serialHex: "01",
      credentialGeneration: 4,
    });
    const outcome = verifyOperationalCertificate(
      baseInput({ certificatePem: forged.certificatePem, chainPem: rogue.chainPem }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failures.length).toBeGreaterThanOrEqual(5);
  });
});
