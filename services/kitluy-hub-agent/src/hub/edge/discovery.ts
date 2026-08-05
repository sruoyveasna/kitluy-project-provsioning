/**
 * Store Hub signed-discovery authority — WS-11-T004-P04B (§4).
 *
 * Owns the SIGNED discovery record: minting through the Hub's operational
 * signing authority (the same `PairingSigner` the pairing receipt uses),
 * 30-second refresh, 90-second validity, and the `_kitluy-edge._tcp.local`
 * advertisement payload. The record's canonical bytes and verification live
 * in `@kitluy/device-identity` (`edge-discovery.ts`) — one canonicalizer,
 * signed here, verified on the terminal.
 *
 * mDNS IS DISCOVERY ONLY. The multicast advertisement carries a hint (the
 * service, the port, the record id) and NO trust: a terminal that hears it
 * must fetch `GET /.well-known/kitluy-edge-discovery/v1` over the mTLS
 * transport and verify the SIGNED record before believing anything. Nothing
 * in this module logs a signature body or a raw discovery payload.
 */
import { randomUUID } from "node:crypto";

import {
  EDGE_DISCOVERY_KIND,
  EDGE_DISCOVERY_SERVICE_TYPE,
  EDGE_DISCOVERY_REFRESH_SECONDS,
  EDGE_DISCOVERY_VALIDITY_SECONDS,
  EDGE_LAN_PORT,
  edgeDiscoveryRecordBytes,
  type EdgeDiscoveryRecord,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import type { PairingSigner, SafeLogger } from "../pairing.js";

const NO_LOG: SafeLogger = { info: () => undefined };

/** The Hub identity a discovery record binds. All values are Hub-authoritative. */
export interface EdgeDiscoveryIdentity {
  readonly hubDeviceId: string;
  /** SHA-256 (lowercase hex) of the TLS server certificate served on 7443. */
  readonly hubTlsCertificateFingerprint: string;
  readonly tenantId: string;
  readonly digitalStoreId: string;
  readonly storeLocationId: string;
  readonly environment: TrustEnvironment;
  readonly hostname: string;
  readonly port?: number;
}

/** What the well-known route returns: the record plus its detached signature. */
export interface SignedDiscoveryPayload {
  readonly record: {
    readonly protocolVersion: string;
    readonly recordId: string;
    readonly hubDeviceId: string;
    readonly hubCertificateFingerprint: string;
    readonly tenantId: string;
    readonly digitalStoreId: string;
    readonly storeLocationId: string;
    readonly environment: string;
    readonly hostname: string;
    readonly port: number;
    readonly issuedAt: string;
    readonly expiresAt: string;
  };
  /** Unpadded base64url over the canonical record bytes (locked encoding). */
  readonly signature: string;
  readonly signatureAlgorithm: "ed25519";
}

/**
 * The UNSIGNED multicast hint. Deliberately carries no scope, no fingerprint
 * and no signature: everything trustworthy comes from the signed record the
 * hint points at.
 */
export interface MdnsAnnouncement {
  readonly serviceType: typeof EDGE_DISCOVERY_SERVICE_TYPE;
  readonly instanceName: string;
  readonly port: number;
  readonly txt: Readonly<Record<string, string>>;
}

/** Transport port for the multicast side. Injectable; tests capture. */
export interface MdnsAnnouncer {
  announce(announcement: MdnsAnnouncement): void;
  stop(): void;
}

export class EdgeDiscoveryAuthority {
  private current: { record: EdgeDiscoveryRecord; signatureBase64Url: string } | null = null;

  constructor(
    private readonly identity: EdgeDiscoveryIdentity,
    private readonly signer: PairingSigner,
    private readonly logger: SafeLogger = NO_LOG,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * The live signed record, re-minted when older than the 30-second refresh
   * or within 5 s of expiry. A refresh changes the record id and instants —
   * never the Hub identity, fingerprint or scope.
   */
  currentSignedRecord(): { record: EdgeDiscoveryRecord; signatureBase64Url: string } {
    const nowMs = this.now().getTime();
    const live = this.current;
    if (
      live !== null &&
      nowMs - live.record.issuedAt.getTime() < EDGE_DISCOVERY_REFRESH_SECONDS * 1000 &&
      live.record.expiresAt.getTime() - nowMs > 5_000
    ) {
      return live;
    }
    const issuedAt = new Date(nowMs);
    const record: EdgeDiscoveryRecord = {
      protocolVersion: EDGE_DISCOVERY_KIND,
      recordId: randomUUID(),
      hubDeviceId: this.identity.hubDeviceId,
      hubCertificateFingerprint: this.identity.hubTlsCertificateFingerprint,
      tenantId: this.identity.tenantId,
      digitalStoreId: this.identity.digitalStoreId,
      storeLocationId: this.identity.storeLocationId,
      environment: this.identity.environment,
      hostname: this.identity.hostname,
      port: this.identity.port ?? EDGE_LAN_PORT,
      issuedAt,
      expiresAt: new Date(nowMs + EDGE_DISCOVERY_VALIDITY_SECONDS * 1000),
    };
    const signatureBase64Url = Buffer.from(
      this.signer.sign(edgeDiscoveryRecordBytes(record)),
    ).toString("base64url");
    this.current = { record, signatureBase64Url };
    // Safe fields only — never the signature body or the record payload.
    this.logger.info({
      operation: "discoveryRecordMinted",
      correlationId: record.recordId,
      result: "SIGNED",
    });
    return this.current;
  }

  /** The `GET /.well-known/kitluy-edge-discovery/v1` body. */
  wellKnownPayload(): SignedDiscoveryPayload {
    const { record, signatureBase64Url } = this.currentSignedRecord();
    return {
      record: {
        protocolVersion: record.protocolVersion,
        recordId: record.recordId,
        hubDeviceId: record.hubDeviceId,
        hubCertificateFingerprint: record.hubCertificateFingerprint,
        tenantId: record.tenantId,
        digitalStoreId: record.digitalStoreId,
        storeLocationId: record.storeLocationId,
        environment: record.environment,
        hostname: record.hostname,
        port: record.port,
        issuedAt: record.issuedAt.toISOString(),
        expiresAt: record.expiresAt.toISOString(),
      },
      signature: signatureBase64Url,
      signatureAlgorithm: "ed25519",
    };
  }

  /** The unsigned multicast hint for `_kitluy-edge._tcp.local`. */
  announcement(): MdnsAnnouncement {
    const { record } = this.currentSignedRecord();
    return {
      serviceType: EDGE_DISCOVERY_SERVICE_TYPE,
      instanceName: `kitluy-hub-${record.hubDeviceId.slice(0, 8)}`,
      port: record.port,
      // A pointer, not a claim: the record id lets a terminal correlate the
      // hint with the signed record it MUST fetch and verify.
      txt: { rid: record.recordId, v: "1" },
    };
  }
}

/**
 * Runs the locked 30-second advertisement cadence: each tick refreshes the
 * signed record (via the authority) and re-announces the hint. Returns a
 * stopper. The announcer is a port — production wiring supplies a multicast
 * responder; tests supply a capture.
 */
export function startDiscoveryAdvertisement(
  authority: EdgeDiscoveryAuthority,
  announcer: MdnsAnnouncer,
  intervalMs: number = EDGE_DISCOVERY_REFRESH_SECONDS * 1000,
): { stop(): void } {
  announcer.announce(authority.announcement());
  const timer = setInterval(() => {
    announcer.announce(authority.announcement());
  }, intervalMs);
  timer.unref?.();
  return {
    stop() {
      clearInterval(timer);
      announcer.stop();
    },
  };
}
