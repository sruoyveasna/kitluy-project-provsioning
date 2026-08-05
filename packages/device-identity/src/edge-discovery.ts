/**
 * Signed Store-LAN discovery record — WS-11-T004-P04B.
 *
 * Authority: the P04B owner package §4 (signed mDNS/DNS-SD discovery;
 * advertisement refresh 30 s, record validity 90 s; the record binds
 * protocol version, record id, Hub, Hub certificate fingerprint, Tenant,
 * Digital Store, Location, environment, hostname, port and both instants);
 * Hub spec §3.1 ("IP address never establishes trust").
 *
 * THE ONE RULE: mDNS, hostnames and IPs are DISCOVERY ONLY. A terminal may
 * learn "something claiming to be my Hub is at host:7443" from an unsigned
 * multicast packet — it may TRUST nothing until this record verifies under
 * the Hub's operational signing key AND its bindings match the terminal's
 * cloud-provisioned expectation. The record's `hubCertificateFingerprint` is
 * the SHA-256 of the TLS server certificate the Hub will present on 7443,
 * so a verified record pins the very handshake that follows it.
 *
 * Same discipline as every other domain in this package: fixed field order,
 * domain separator first, `toISOString()` instants, bindings checked before
 * the signature, expiry judged against the caller's trusted time. No second
 * canonicalizer may exist — the Hub signs and the terminal verifies exactly
 * these bytes.
 */

import { createHash } from "node:crypto";

import type { TrustEnvironment } from "./environments.js";
import { verifyDetachedSignature } from "./dev-crypto.js";

/** Domain separator. Distinct from every pairing/PoP/activation domain. */
export const EDGE_DISCOVERY_KIND = "kitluy.edge-discovery.v1" as const;

/** The one service type a KitLuy Store Hub advertises (owner package §4). */
export const EDGE_DISCOVERY_SERVICE_TYPE = "_kitluy-edge._tcp.local" as const;

/** Locked timing (owner package §4). */
export const EDGE_DISCOVERY_REFRESH_SECONDS = 30 as const;
export const EDGE_DISCOVERY_VALIDITY_SECONDS = 90 as const;

/** The one LAN port a KitLuy Store Hub serves (owner package §3). */
export const EDGE_LAN_PORT = 7443 as const;

export interface EdgeDiscoveryRecord {
  readonly protocolVersion: string;
  readonly recordId: string;
  readonly hubDeviceId: string;
  /** SHA-256 (lowercase hex) of the TLS server certificate presented on 7443. */
  readonly hubCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hostname: string;
  readonly port: number;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

/** The exact bytes the Hub's operational key signs. Field order is FIXED. */
export function edgeDiscoveryRecordBytes(record: EdgeDiscoveryRecord): Uint8Array {
  return Buffer.from(
    [
      EDGE_DISCOVERY_KIND,
      record.protocolVersion,
      record.recordId,
      record.hubDeviceId,
      record.hubCertificateFingerprint,
      record.tenantId,
      record.digitalStoreId,
      record.storeLocationId,
      record.environment,
      record.hostname,
      String(record.port),
      record.issuedAt.toISOString(),
      record.expiresAt.toISOString(),
    ].join("\n"),
    "utf8",
  );
}

export function edgeDiscoveryRecordHash(record: EdgeDiscoveryRecord): string {
  return createHash("sha256")
    .update(Buffer.from(edgeDiscoveryRecordBytes(record)))
    .digest("hex");
}

export type EdgeDiscoveryRefusalCode =
  | "DISCOVERY_WRONG_VERSION"
  | "DISCOVERY_WRONG_HUB"
  | "DISCOVERY_WRONG_SCOPE"
  | "DISCOVERY_WRONG_ENVIRONMENT"
  | "DISCOVERY_WRONG_PORT"
  | "DISCOVERY_EXPIRED"
  | "DISCOVERY_NOT_YET_VALID"
  | "DISCOVERY_SIGNATURE_INVALID";

/**
 * What the terminal's CLOUD-PROVISIONED configuration says the record must
 * be about. Never derived from the record itself — a record that asserts its
 * own correctness proves nothing.
 */
export interface EdgeDiscoveryExpectation {
  readonly hubDeviceId?: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
}

export interface EdgeDiscoveryVerdict {
  readonly verified: boolean;
  readonly refusalCode?: EdgeDiscoveryRefusalCode;
  readonly detail?: string;
}

/**
 * Verifies a signed discovery record. Bindings first, signature last —
 * exactly the house discipline. `now` is the terminal's best available
 * time; the 90-second validity window keeps a replayed record short-lived
 * even under a poor clock.
 */
export function verifyEdgeDiscoveryRecord(
  record: EdgeDiscoveryRecord,
  signature: Uint8Array,
  hubOperationalPublicKeyPem: string,
  expectation: EdgeDiscoveryExpectation,
  now: Date,
  verifySignature: (
    pem: string,
    payload: Uint8Array,
    sig: Uint8Array,
  ) => boolean = verifyDetachedSignature,
): EdgeDiscoveryVerdict {
  const refuse = (refusalCode: EdgeDiscoveryRefusalCode, detail: string): EdgeDiscoveryVerdict => ({
    verified: false,
    refusalCode,
    detail,
  });

  if (record.protocolVersion !== EDGE_DISCOVERY_KIND) {
    return refuse("DISCOVERY_WRONG_VERSION", `record speaks ${record.protocolVersion}`);
  }
  if (expectation.hubDeviceId !== undefined && record.hubDeviceId !== expectation.hubDeviceId) {
    return refuse("DISCOVERY_WRONG_HUB", "the record names another Store Hub");
  }
  if (
    record.tenantId !== expectation.tenantId ||
    record.digitalStoreId !== expectation.digitalStoreId ||
    record.storeLocationId !== expectation.storeLocationId
  ) {
    return refuse("DISCOVERY_WRONG_SCOPE", "the record names another Store scope");
  }
  if (record.environment !== expectation.environment) {
    return refuse("DISCOVERY_WRONG_ENVIRONMENT", `the record is for ${record.environment}`);
  }
  if (record.port !== EDGE_LAN_PORT) {
    return refuse("DISCOVERY_WRONG_PORT", `the record advertises port ${record.port}`);
  }
  if (now.getTime() < record.issuedAt.getTime()) {
    return refuse("DISCOVERY_NOT_YET_VALID", "the record is dated in the future");
  }
  if (now.getTime() >= record.expiresAt.getTime()) {
    return refuse("DISCOVERY_EXPIRED", "the record is past its validity window");
  }
  if (!verifySignature(hubOperationalPublicKeyPem, edgeDiscoveryRecordBytes(record), signature)) {
    return refuse(
      "DISCOVERY_SIGNATURE_INVALID",
      "the record signature does not verify under the Hub operational key",
    );
  }
  return { verified: true };
}
