/**
 * Verified Store Hub endpoint resolution — WS-12-T001.
 *
 * Authority: `@kitluy/device-identity` edge-discovery (P04B): hostnames and
 * IPs are DISCOVERY ONLY; nothing is trusted until the signed record
 * verifies under the Hub operational key AND matches the terminal's
 * cloud-provisioned expectation. The verified record pins the very TLS
 * handshake that follows it (`hubCertificateFingerprint`).
 */

import {
  TRUST_ENVIRONMENTS,
  verifyEdgeDiscoveryRecord,
  type EdgeDiscoveryExpectation,
  type EdgeDiscoveryRecord,
  type EdgeDiscoveryRefusalCode,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import type { SignedDiscoveryWirePayload, VerifiedHubEndpoint } from "./ports.js";

export type HubResolutionResult =
  | { readonly outcome: "resolved"; readonly endpoint: VerifiedHubEndpoint }
  | {
      readonly outcome: "refused";
      readonly refusalCode: EdgeDiscoveryRefusalCode | "DISCOVERY_MALFORMED";
      readonly detail: string;
    };

function parseInstant(value: string): Date | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Unpadded base64url → bytes. Refuses padding and non-url alphabets. */
function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/**
 * Verify a signed discovery payload and produce the pinned endpoint.
 *
 * Shape first, bindings next, signature last — and every refusal names why.
 * The expectation comes from the terminal's protected identity, never from
 * the record itself.
 */
export function resolveVerifiedHubEndpoint(
  payload: SignedDiscoveryWirePayload,
  hubOperationalPublicKeyPem: string,
  expectation: EdgeDiscoveryExpectation,
  now: Date,
): HubResolutionResult {
  const refuse = (
    refusalCode: EdgeDiscoveryRefusalCode | "DISCOVERY_MALFORMED",
    detail: string,
  ): HubResolutionResult => ({ outcome: "refused", refusalCode, detail });

  const wire = payload.record;
  if (payload.signatureAlgorithm !== "ed25519") {
    return refuse("DISCOVERY_MALFORMED", `unsupported algorithm ${payload.signatureAlgorithm}`);
  }
  const issuedAt = parseInstant(wire.issuedAt);
  const expiresAt = parseInstant(wire.expiresAt);
  if (issuedAt === null || expiresAt === null) {
    return refuse("DISCOVERY_MALFORMED", "a record instant is not a valid ISO instant");
  }
  if (!(TRUST_ENVIRONMENTS as readonly string[]).includes(wire.environment)) {
    return refuse("DISCOVERY_MALFORMED", `unknown environment ${wire.environment}`);
  }
  const signature = decodeBase64Url(payload.signature);
  if (signature === null) {
    return refuse("DISCOVERY_MALFORMED", "the signature is not unpadded base64url");
  }

  const record: EdgeDiscoveryRecord = {
    protocolVersion: wire.protocolVersion,
    recordId: wire.recordId,
    hubDeviceId: wire.hubDeviceId,
    hubCertificateFingerprint: wire.hubCertificateFingerprint,
    tenantId: wire.tenantId,
    digitalStoreId: wire.digitalStoreId,
    storeLocationId: wire.storeLocationId,
    environment: wire.environment as TrustEnvironment,
    hostname: wire.hostname,
    port: wire.port,
    issuedAt,
    expiresAt,
  };

  const verdict = verifyEdgeDiscoveryRecord(
    record,
    signature,
    hubOperationalPublicKeyPem,
    expectation,
    now,
  );
  if (!verdict.verified) {
    return refuse(
      verdict.refusalCode ?? "DISCOVERY_SIGNATURE_INVALID",
      verdict.detail ?? "the discovery record did not verify",
    );
  }
  return {
    outcome: "resolved",
    endpoint: {
      hubDeviceId: record.hubDeviceId,
      hostname: record.hostname,
      port: record.port,
      pinnedCertificateFingerprint: record.hubCertificateFingerprint,
    },
  };
}
