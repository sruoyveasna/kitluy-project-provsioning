/**
 * The device's copy of `kitluy.csr.v1` must equal the authoritative one, byte
 * for byte.
 *
 * The firstboot agent ships with zero runtime dependencies, so it cannot import
 * `@kitluy/device-identity` at runtime — see the header of
 * `src/operational-csr-bytes.ts`. That leaves a second copy of security-critical
 * canonical bytes, which is exactly the thing that drifts silently and is
 * discovered in the field.
 *
 * This test is the thing that stops it. `@kitluy/device-identity` is a DEV
 * dependency, so importing it here costs the image nothing.
 */
import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { requestBytes, type DeviceCertificateRequest } from "@kitluy/device-identity";

import { operationalCsrBytes, OPERATIONAL_CSR_KIND } from "../src/operational-csr-bytes.js";

describe("kitluy.csr.v1 canonical bytes do not drift", () => {
  it("produces identical bytes to packages/device-identity for a representative request", () => {
    const requestedAt = new Date("2026-08-28T04:05:06.789Z");
    const shared = {
      requestId: "11111111-1111-4111-8111-111111111111",
      deviceRecordId: "22222222-2222-4222-8222-222222222222",
      environment: "development",
      publicKeyFingerprint: "ab".repeat(32),
      hardwareTrustLevel: "development_software" as const,
      assignmentGeneration: 7,
      requestedPurpose: "device_identity",
      nonce: "33333333-3333-4333-8333-333333333333",
      correlationId: "44444444-4444-4444-8444-444444444444",
    };

    const authoritative: DeviceCertificateRequest = {
      ...shared,
      devicePublicKeyPem: "-----BEGIN PUBLIC KEY-----\nnot-read-by-requestBytes\n-----END PUBLIC KEY-----\n",
      requestedAt,
      proofOfPossession: new Uint8Array(),
    };

    const device = operationalCsrBytes({ ...shared, requestedAt: requestedAt.toISOString() });

    expect(Buffer.from(device).toString("hex")).toBe(
      Buffer.from(requestBytes(authoritative)).toString("hex"),
    );
  });

  it("stays identical across randomised inputs, including the awkward ones", () => {
    for (let i = 0; i < 50; i += 1) {
      const requestedAt = new Date(Date.UTC(2026, 7, 28, i % 24, i % 60, i % 60, (i * 7) % 1000));
      const shared = {
        requestId: randomUUID(),
        deviceRecordId: randomUUID(),
        environment: i % 2 === 0 ? "development" : "development",
        publicKeyFingerprint: randomUUID().replace(/-/g, "").repeat(2),
        hardwareTrustLevel: "development_software" as const,
        // Zero and large values both render through String(), and a mismatch
        // there would be invisible in a hand-picked example.
        assignmentGeneration: i === 0 ? 0 : i * 1000,
        requestedPurpose: "device_identity",
        nonce: randomUUID(),
        correlationId: randomUUID(),
      };
      const authoritative: DeviceCertificateRequest = {
        ...shared,
        devicePublicKeyPem: "-----BEGIN PUBLIC KEY-----\nx\n-----END PUBLIC KEY-----\n",
        requestedAt,
        proofOfPossession: new Uint8Array(),
      };
      expect(
        Buffer.from(operationalCsrBytes({ ...shared, requestedAt: requestedAt.toISOString() })).toString("hex"),
        `drift at iteration ${i}`,
      ).toBe(Buffer.from(requestBytes(authoritative)).toString("hex"));
    }
  });

  it("pins the domain separator", () => {
    // A changed kind string silently invalidates every signature the fleet has
    // ever produced, and would look like a mass proof-of-possession failure.
    expect(OPERATIONAL_CSR_KIND).toBe("kitluy.csr.v1");
    expect(Buffer.from(operationalCsrBytes({
      requestId: "r", deviceRecordId: "d", environment: "e", publicKeyFingerprint: "f",
      hardwareTrustLevel: "h", assignmentGeneration: 1, requestedPurpose: "p",
      requestedAt: "t", nonce: "n", correlationId: "c",
    })).toString("utf8")).toBe("kitluy.csr.v1\nr\nd\ne\nf\nh\n1\np\nt\nn\nc");
  });
});
