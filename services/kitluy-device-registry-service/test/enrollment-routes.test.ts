/**
 * The factory-enrollment HTTP surface.
 *
 * The test that matters most here is ENUMERATION RESISTANCE. Migration 0190
 * makes an unknown ticket reference and a wrong ticket secret indistinguishable
 * at the database; this layer is where that property is easiest to destroy by
 * accident, because mapping "expired" or "already redeemed" to their own status
 * would each prove a ticket EXISTS.
 */
import { describe, expect, it } from "vitest";

import { httpStatusFor } from "@kitluy/api-errors";

import { createEnrollmentRouter, DEVICE_ENROLLMENT_PREFIX } from "../src/enrollment-routes.js";
import type {
  EnrollmentComposition,
  EnrollmentCompositionResult,
  EnrollmentChallengeMaterial,
  EnrolledDeviceMaterial,
  EnrollmentResultCode,
} from "../src/enrollment-composition.js";
import { BootstrapRateLimiter, type BootstrapRouteRequest } from "../src/provisioning-routes.js";

const HEX64 = "a".repeat(64);
const PEM = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA\n-----END PUBLIC KEY-----\n";

function request(overrides: Partial<BootstrapRouteRequest> = {}): BootstrapRouteRequest {
  return {
    method: "POST",
    path: `${DEVICE_ENROLLMENT_PREFIX}/challenges`,
    headers: { "content-type": "application/json" },
    sourceIp: "10.0.0.1",
    rawBody: JSON.stringify({
      ticketReference: "KL-TKT-1",
      ticketDigest: HEX64,
      publicKeyFingerprint: HEX64,
      publicKeyPem: PEM,
      publicKeyAlgorithm: "ed25519",
      keyStorageClass: "software",
    }),
    ...overrides,
  };
}

/** A composition stub: the route layer is what is under test here. */
function stubComposition(
  challenge: EnrollmentCompositionResult<EnrollmentChallengeMaterial>,
  redeem?: EnrollmentCompositionResult<EnrolledDeviceMaterial>,
): EnrollmentComposition {
  return {
    openChallenge: () => Promise.resolve(challenge),
    redeem: () =>
      Promise.resolve(
        redeem ?? { result: "INTERNAL_ERROR" as EnrollmentResultCode, correlationId: "x" },
      ),
  } as unknown as EnrollmentComposition;
}

function ticketRefused(
  auditDetail: string,
): EnrollmentCompositionResult<EnrollmentChallengeMaterial> {
  return { result: "TICKET_REFUSED", correlationId: "c", auditDetail };
}

describe("enumeration resistance", () => {
  it("returns an identical status and body for every ticket-authority refusal", async () => {
    // Each of these proves something different INTERNALLY. None may be
    // distinguishable on the wire: "expired" and "already redeemed" both
    // confirm the reference is real.
    const causes = [
      "unknown reference or wrong secret",
      "ticket expired",
      "ticket revoked",
      "ticket already produced a device",
      "key storage class not permitted in this environment",
    ];

    const responses = [];
    for (const cause of causes) {
      const router = createEnrollmentRouter({ composition: stubComposition(ticketRefused(cause)) });
      const response = await router.handle(request());
      responses.push(response);
    }

    const first = responses[0];
    expect(first).toBeDefined();
    for (const response of responses) {
      expect(response.status).toBe(first?.status);
      // Correlation id is per-request by design, so it is excluded from the
      // comparison; everything an attacker could measure must be identical.
      const strip = (b: Record<string, unknown>) =>
        JSON.stringify(b, (key, value) => (key === "correlationId" ? undefined : value));
      expect(strip(response.body)).toBe(strip(first?.body ?? {}));
    }
  });

  it("never places the internal cause in the response body", async () => {
    const router = createEnrollmentRouter({
      composition: stubComposition(ticketRefused("ticket revoked")),
    });
    const response = await router.handle(request());
    expect(JSON.stringify(response.body)).not.toContain("revoked");
    expect(JSON.stringify(response.body)).not.toContain("expired");
  });

  it("maps a failed proof to the same response as a refused ticket", async () => {
    const ticket = createEnrollmentRouter({
      composition: stubComposition(ticketRefused("unknown reference or wrong secret")),
    });
    const proof = createEnrollmentRouter({
      composition: stubComposition({ result: "PROOF_INVALID", correlationId: "c" }),
    });
    const a = await ticket.handle(request());
    const b = await proof.handle(request());
    expect(a.status).toBe(b.status);
    expect((a.body as { code?: string }).code).toBe((b.body as { code?: string }).code);
  });
});

describe("transport guards", () => {
  const ok = stubComposition({
    result: "CHALLENGE_ISSUED",
    correlationId: "c",
    data: {
      challengeId: "11111111-1111-4111-8111-111111111111",
      nonce: HEX64,
      purpose: "manufacturing_enrollment_redemption",
      environment: "development",
      issuedAt: new Date("2026-08-12T00:00:00.000Z"),
      expiresAt: new Date("2026-08-12T00:05:00.000Z"),
      signatureAlgorithm: "ed25519",
      signingPayloadEncoding: "base64url",
    },
  });

  it("refuses an oversized body before parsing it", async () => {
    const router = createEnrollmentRouter({ composition: ok });
    const response = await router.handle(request({ rawBody: "x".repeat(17 * 1024) }));
    // 422 is what the canonical registry maps VALIDATION_FAILED to; asserting
    // the registry's value rather than a guessed 400 keeps this test honest if
    // the mapping ever moves.
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses a non-JSON content type", async () => {
    const router = createEnrollmentRouter({ composition: ok });
    const response = await router.handle(request({ headers: { "content-type": "text/plain" } }));
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("refuses an unknown route and a wrong method", async () => {
    const router = createEnrollmentRouter({ composition: ok });
    expect((await router.handle(request({ path: "/v1/nope" }))).status).toBe(
      httpStatusFor("RESOURCE_NOT_FOUND"),
    );
    expect((await router.handle(request({ method: "GET" }))).status).toBe(405);
  });

  it("rate limits per source and returns retry-after", async () => {
    const router = createEnrollmentRouter({
      composition: ok,
      rateLimiter: new BootstrapRateLimiter({ now: () => 1_000 }),
    });
    let limited: Awaited<ReturnType<typeof router.handle>> | undefined;
    for (let i = 0; i < 8; i += 1) {
      const response = await router.handle(request());
      if (response.status === 429) {
        limited = response;
        break;
      }
    }
    expect(limited).toBeDefined();
    expect(limited?.headers?.["retry-after"]).toBeDefined();
  });

  it("refuses malformed required fields", async () => {
    const router = createEnrollmentRouter({ composition: ok });
    const response = await router.handle(
      request({ rawBody: JSON.stringify({ ticketReference: "x", ticketDigest: "short" }) }),
    );
    expect(response.status).toBe(httpStatusFor("VALIDATION_FAILED"));
  });

  it("issues a challenge with the locked wire forms", async () => {
    const router = createEnrollmentRouter({ composition: ok });
    const response = await router.handle(request());
    expect(response.status).toBe(201);
    const challenge = (response.body as { challenge: Record<string, unknown> }).challenge;
    expect(challenge.purpose).toBe("manufacturing_enrollment_redemption");
    expect(challenge.signatureAlgorithm).toBe("ed25519");
    expect(challenge.signingPayloadEncoding).toBe("base64url");
    expect(challenge.nonce).toBe(HEX64);
  });
});

describe("successful enrollment response", () => {
  const enrolled = stubComposition(
    { result: "INTERNAL_ERROR", correlationId: "c" },
    {
      result: "ENROLLED",
      correlationId: "c",
      data: {
        deviceRecordId: "22222222-2222-4222-8222-222222222222",
        fleetEnrollment: "enrolled",
        storeAssignment: "unassigned",
        environment: "development",
        timeToken: {
          protocolVersion: "1",
          issuer: "kitluy.cloud.device-registry",
          deviceRecordId: "22222222-2222-4222-8222-222222222222",
          challengeId: "11111111-1111-4111-8111-111111111111",
          environment: "development",
          issuedAt: new Date("2026-08-12T00:00:00.000Z"),
          expiresAt: new Date("2026-08-12T00:05:00.000Z"),
        },
        timeTokenSignature: {
          keyId: "k",
          keyVersion: 1,
          algorithm: "ed25519",
          signature: "sig",
        },
      },
    },
  );

  const redemption = request({
    path: `${DEVICE_ENROLLMENT_PREFIX}/redemptions`,
    rawBody: JSON.stringify({
      challengeId: "11111111-1111-4111-8111-111111111111",
      signature: "AAAA",
      publicKeyPem: PEM,
      assetTag: "ASSET-1",
      nonce: HEX64,
      presentedKeyFingerprint: HEX64,
      issuedAt: "2026-08-12T00:00:00.000Z",
      expiresAt: "2026-08-12T00:05:00.000Z",
      signals: [{ signal_type: "mac_address", signal_value: "aa:bb" }],
    }),
  });

  it("returns ENROLLED + UNASSIGNED and the signed time token", async () => {
    const router = createEnrollmentRouter({ composition: enrolled });
    const response = await router.handle(redemption);
    expect(response.status).toBe(201);
    const body = response.body as Record<string, unknown>;
    expect(body.fleetEnrollment).toBe("enrolled");
    expect(body.storeAssignment).toBe("unassigned");
    expect(body.trustedTimeToken).toBeDefined();
  });

  it("carries NO Store ownership fields, because none exists before pairing", async () => {
    const router = createEnrollmentRouter({ composition: enrolled });
    const response = await router.handle(redemption);
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      "tenantId",
      "digitalStoreId",
      "storeLocationId",
      "storeHubDeviceId",
      "terminalProfile",
      "primaryVertical",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("never returns device private key material", async () => {
    const router = createEnrollmentRouter({ composition: enrolled });
    const response = await router.handle(redemption);
    const serialized = JSON.stringify(response.body).toLowerCase();
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("begin ");
  });
});
