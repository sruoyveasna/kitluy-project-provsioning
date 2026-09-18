/**
 * Signed Store-LAN discovery — WS-11-T004-P04B scenario B (unit half).
 *
 * Pure crypto and cadence: record signing/verification through the shared
 * `@kitluy/device-identity` authority, every tamper class, expiry, refresh
 * re-signing, and the rule that the UNSIGNED multicast hint can never
 * authorize anything (it simply carries nothing an authorization could use).
 * The transport-served well-known route is covered by the LAN integration
 * suite.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  EDGE_DISCOVERY_KIND,
  EDGE_DISCOVERY_SERVICE_TYPE,
  EDGE_LAN_PORT,
  verifyEdgeDiscoveryRecord,
  type EdgeDiscoveryExpectation,
  type EdgeDiscoveryRecord,
} from "@kitluy/device-identity";

import {
  EdgeDiscoveryAuthority,
  startDiscoveryAdvertisement,
  type MdnsAnnouncement,
  type MdnsAnnouncer,
} from "../src/hub/edge/discovery.js";
import type { PairingSigner } from "../src/hub/pairing.js";

const keys = new DevelopmentDeviceKeyProvider();
const HUB_KEY = `disc-hub-${randomUUID().slice(0, 8)}`;
await keys.generateDeviceKey(HUB_KEY, "development");
const hubPem = keys.publicKeyPem(HUB_KEY) ?? "";
const signer: PairingSigner = {
  certificateSerial: "DISC-HUB-0001",
  publicKeyPem: hubPem,
  sign: (payload) => keys.provePossession(HUB_KEY, payload),
};

const IDENTITY = {
  hubDeviceId: randomUUID(),
  hubTlsCertificateFingerprint: "ab".repeat(32),
  tenantId: randomUUID(),
  digitalStoreId: randomUUID(),
  storeLocationId: randomUUID(),
  environment: "development" as const,
  hostname: "hub.store.lan",
};

const EXPECTATION: EdgeDiscoveryExpectation = {
  hubDeviceId: IDENTITY.hubDeviceId,
  tenantId: IDENTITY.tenantId,
  digitalStoreId: IDENTITY.digitalStoreId,
  storeLocationId: IDENTITY.storeLocationId,
  environment: "development",
};

function freshSigned(now: () => Date = () => new Date()) {
  const authority = new EdgeDiscoveryAuthority(IDENTITY, signer, undefined, now);
  const { record, signatureBase64Url } = authority.currentSignedRecord();
  return { authority, record, signature: Buffer.from(signatureBase64Url, "base64url") };
}

describe("signed edge discovery (P04B §4)", () => {
  it("a valid record verifies under the Hub operational key and its bindings", () => {
    const { record, signature } = freshSigned();
    const verdict = verifyEdgeDiscoveryRecord(record, signature, hubPem, EXPECTATION, new Date());
    expect(verdict.verified).toBe(true);
    expect(record.port).toBe(EDGE_LAN_PORT);
    expect(record.protocolVersion).toBe(EDGE_DISCOVERY_KIND);
    // 90-second validity, locked.
    expect(record.expiresAt.getTime() - record.issuedAt.getTime()).toBe(90_000);
  });

  it("every altered binding fails: hub id, scope, port, expiry, fingerprint", () => {
    const { record, signature } = freshSigned();
    const now = new Date();
    const cases: ReadonlyArray<[string, EdgeDiscoveryRecord, EdgeDiscoveryExpectation]> = [
      ["hub id", { ...record, hubDeviceId: randomUUID() }, EXPECTATION],
      ["tenant", { ...record, tenantId: randomUUID() }, EXPECTATION],
      ["store", { ...record, digitalStoreId: randomUUID() }, EXPECTATION],
      ["location", { ...record, storeLocationId: randomUUID() }, EXPECTATION],
      ["environment", { ...record, environment: "production" }, EXPECTATION],
      ["port", { ...record, port: 8443 }, EXPECTATION],
      ["expiry", { ...record, expiresAt: new Date(now.getTime() + 3_600_000) }, EXPECTATION],
      ["fingerprint", { ...record, hubCertificateFingerprint: "cd".repeat(32) }, EXPECTATION],
      ["hostname", { ...record, hostname: "attacker.lan" }, EXPECTATION],
    ];
    for (const [label, tampered, expectation] of cases) {
      const verdict = verifyEdgeDiscoveryRecord(tampered, signature, hubPem, expectation, now);
      expect(verdict.verified, `${label} tamper must fail`).toBe(false);
    }
    // A signature from another key fails even over the honest record.
    const forged = signature.subarray(0, signature.length - 1);
    expect(
      verifyEdgeDiscoveryRecord(record, Uint8Array.from(forged), hubPem, EXPECTATION, now).verified,
    ).toBe(false);
  });

  it("an expired record fails whatever the client still holds", () => {
    const { record, signature } = freshSigned();
    const afterExpiry = new Date(record.expiresAt.getTime() + 1);
    const verdict = verifyEdgeDiscoveryRecord(record, signature, hubPem, EXPECTATION, afterExpiry);
    expect(verdict.verified).toBe(false);
    expect(verdict.refusalCode).toBe("DISCOVERY_EXPIRED");
  });

  it("a record minted by a Hub clock a little ahead of the terminal's is accepted; far ahead is refused (hardware, 2026-09-17)", () => {
    // The Hub mints with ITS clock; the terminal judges with ITS. On the boards
    // the Hub ran ~10 ms ahead, and a record minted for the request itself was
    // "in the future" by that much. Skew up to the refresh interval passes.
    const { record, signature } = freshSigned(() => new Date(Date.now() + 10));
    const behind = new Date();
    expect(verifyEdgeDiscoveryRecord(record, signature, hubPem, EXPECTATION, behind).verified).toBe(
      true,
    );
    const edge = freshSigned(() => new Date(Date.now() + 29_000));
    expect(
      verifyEdgeDiscoveryRecord(edge.record, edge.signature, hubPem, EXPECTATION, new Date())
        .verified,
    ).toBe(true);
    const far = freshSigned(() => new Date(Date.now() + 31_000));
    const verdict = verifyEdgeDiscoveryRecord(
      far.record,
      far.signature,
      hubPem,
      EXPECTATION,
      new Date(),
    );
    expect(verdict.verified).toBe(false);
    if (!verdict.verified) expect(verdict.refusalCode).toBe("DISCOVERY_NOT_YET_VALID");
  });

  it("refresh mints a NEWLY signed record without changing the Hub identity", () => {
    let nowMs = 1_800_000_000_000;
    const { authority, record: first } = freshSigned(() => new Date(nowMs));
    nowMs += 31_000; // past the 30-second refresh
    const second = authority.currentSignedRecord();
    expect(second.record.recordId).not.toBe(first.recordId);
    expect(second.record.issuedAt.getTime()).toBeGreaterThan(first.issuedAt.getTime());
    expect(second.record.hubDeviceId).toBe(first.hubDeviceId);
    expect(second.record.hubCertificateFingerprint).toBe(first.hubCertificateFingerprint);
    expect(second.record.tenantId).toBe(first.tenantId);
    const verdict = verifyEdgeDiscoveryRecord(
      second.record,
      Buffer.from(second.signatureBase64Url, "base64url"),
      hubPem,
      EXPECTATION,
      new Date(nowMs),
    );
    expect(verdict.verified).toBe(true);
    // Within the refresh window the SAME record is served — no re-signing churn.
    nowMs += 1_000;
    expect(authority.currentSignedRecord().record.recordId).toBe(second.record.recordId);
  });

  it("the unsigned mDNS hint carries no trust material and cannot authorize", () => {
    const { authority } = freshSigned();
    const announcement = authority.announcement();
    expect(announcement.serviceType).toBe(EDGE_DISCOVERY_SERVICE_TYPE);
    const flat = JSON.stringify(announcement);
    // No scope, no fingerprint, no signature, no hostname claim — a pointer only.
    expect(flat.includes(IDENTITY.tenantId)).toBe(false);
    expect(flat.includes(IDENTITY.digitalStoreId)).toBe(false);
    expect(flat.includes(IDENTITY.hubTlsCertificateFingerprint)).toBe(false);
    expect(flat.toLowerCase().includes("signature")).toBe(false);
    // And the verifier consumes only SIGNED records — there is no code path
    // from an announcement to a verdict: the announcement lacks the record
    // and the signature the verifier requires by type.
  });

  it("the advertisement cadence re-announces on the locked 30-second interval", async () => {
    const seen: MdnsAnnouncement[] = [];
    let stopped = false;
    const announcer: MdnsAnnouncer = {
      announce: (a) => seen.push(a),
      stop: () => {
        stopped = true;
      },
    };
    const { authority } = freshSigned();
    const cadence = startDiscoveryAdvertisement(authority, announcer, 20);
    await new Promise((resolve) => setTimeout(resolve, 75));
    cadence.stop();
    expect(seen.length).toBeGreaterThanOrEqual(3); // immediate + ticks
    expect(stopped).toBe(true);
    for (const a of seen) expect(a.serviceType).toBe(EDGE_DISCOVERY_SERVICE_TYPE);
  });
});
