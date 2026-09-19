/**
 * HUB-TERMINAL-SYNC-001 — applying a verified envelope to a REAL Hub database.
 *
 * What an operator used to do by hand, proven as one function against
 * `kitluy_hub_local`: the Hub projects itself; a delivered terminal becomes a
 * `terminal_device` with its two credentials; the configuration is published
 * with its grants; a second identical pass changes NOTHING (no new snapshot);
 * a changed profile set republishes and CLOSES the previous grants; a
 * re-flashed board (new identity, same asset tag) retires the previous row and
 * takes the name; a delivery for another Store is refused and never written;
 * a terminal that leaves the cloud answer loses its grants.
 *
 * The suite runs in its OWN Tenant / Store / Location so it never touches the
 * shared fixture grants other suites depend on. SKIPS (never fails) without the
 * local Hub database — a skipped run is no evidence (KLD-EVIDENCE-001).
 */
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import { afterAll, describe, expect, it } from "vitest";

import { createHubPool, isHubDatabaseReachable, withHubTransaction } from "../src/hub/db.js";
import { loadOrCreateDevelopmentSigner } from "../src/hub/dev-configuration.js";
import {
  applyEnvelope,
  readActiveGrantSet,
  type HubSelfFacts,
  type TerminalDelivery,
} from "../src/hub/terminal-sync/apply.js";
import { publicKeyFingerprint } from "../src/hub/terminal-sync/contract.js";

const live = await isHubDatabaseReachable();
if (!live) {
  console.warn(
    "[terminal-sync.integration] kitluy_hub_local is unreachable — SKIPPED, not evidence",
  );
}

const T1 = "laundry.t1.intake_cashier";
const T2 = "laundry.t2.customer_display";
const T3 = "laundry.t3.ready_scan_in";

function selfSignedPem(cn: string): { pem: string; serial: string } {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  cert.serialNumber = "3f" + forge.util.bytesToHex(forge.random.getBytesSync(7));
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  const attrs = [{ name: "commonName", value: cn }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(kp.privateKey, forge.md.sha256.create());
  return { pem: forge.pki.certificateToPem(cert), serial: cert.serialNumber.toLowerCase() };
}

function edPublicPem(): string {
  return generateKeyPairSync("ed25519")
    .publicKey.export({ type: "spki", format: "pem" })
    .toString();
}

function hexSerial(): string {
  return "3f" + forge.util.bytesToHex(forge.random.getBytesSync(7));
}

describe.skipIf(!live)("applying a terminal-projection envelope to a real Hub database", () => {
  const pool = createHubPool();
  // The publisher's signing key lives on the Hub's encrypted volume; a test
  // signs with a key of its own in a temporary directory.
  const signer = loadOrCreateDevelopmentSigner(
    join(mkdtempSync(join(tmpdir(), "kitluy-sync-signer-")), "signing.key"),
  );
  const scope = {
    tenantId: randomUUID(),
    digitalStoreId: randomUUID(),
    storeLocationId: randomUUID(),
  };
  const hubCert = selfSignedPem("hub");
  const self: HubSelfFacts = {
    hubDeviceId: randomUUID(),
    assignmentId: randomUUID(),
    assignmentGeneration: 3,
    scope,
    boardSerial: "10000000deadbeef",
    operationalCertificatePem: hubCert.pem,
    identityPublicKeyPem: edPublicPem(),
  };
  const terminalA = randomUUID();
  const identityA = publicKeyFingerprint(edPublicPem());

  function delivery(overrides: Partial<TerminalDelivery> = {}): TerminalDelivery {
    return {
      kind: "kitluy.hub.development-terminal-projection.v1",
      terminalDeviceId: terminalA,
      terminalName: "KL-TEST-SYNC-0001",
      hardwareProfileCode: "hw.compute.terminal",
      installationId: randomUUID(),
      tenantId: scope.tenantId,
      digitalStoreId: scope.digitalStoreId,
      storeLocationId: scope.storeLocationId,
      assignmentGeneration: 1,
      profileCodes: [T2, T1],
      seatLabel: "T1T2",
      credentialId: randomUUID(),
      certificateGeneration: 1,
      x509CertificateSerial: hexSerial(),
      identityKeyFingerprint: identityA,
      credentialSerialLabel: "DEV-TEST-SYNC-0001",
      publicKeyFingerprint: "a".repeat(64),
      issuer: "KitLuy Development Device Issuing CA NON-PRODUCTION",
      issuedAt: new Date(Date.now() - 3_600_000).toISOString(),
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      ...overrides,
    };
  }
  const first = delivery();

  afterAll(async () => {
    // A Hub database holds ONE live hub_assignment (the command layer reads
    // "the" active one without a scope). This suite's Hub must not stay live in
    // the shared local database, or every command suite after it would refuse
    // EDGE_ASSIGNMENT_GENERATION_MISMATCH against a Hub that is not the fixture's.
    await withHubTransaction(pool, (c) =>
      c.query(
        `update edge_identity.hub_assignment set status = 'ended', ended_at = now()
          where hub_device_id = $1::uuid and ended_at is null`,
        [self.hubDeviceId],
      ),
    );
    await pool.end();
  });

  it("projects the Hub itself and the delivered terminal, and publishes the grants", async () => {
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(outcome.hubIdentityCredential).toBe(true);
    expect(outcome.terminals).toEqual([
      { terminalName: first.terminalName, terminalDeviceId: terminalA, action: "projected" },
    ]);
    expect(outcome.configuration).toMatchObject({ published: true, grantsWritten: 2 });

    const rows = await withHubTransaction(pool, async (client) => {
      const hub = await client.query(
        `select h.lifecycle_status, h.trust_status, h.manufacturing_cert_serial, a.status, a.assignment_generation, a.operational_cert_serial
           from edge_identity.hub_device h join edge_identity.hub_assignment a on a.hub_device_id = h.id
          where h.id = $1::uuid`,
        [self.hubDeviceId],
      );
      const hubCreds = await client.query(
        `select credential_type, status from edge_identity.device_credential where device_id = $1::uuid order by 1`,
        [self.hubDeviceId],
      );
      const term = await client.query(
        `select t.terminal_name, t.certificate_serial, t.lifecycle_status, t.assignment_generation, hp.profile_code
           from edge_identity.terminal_device t join edge_config.hardware_profile hp on hp.id = t.hardware_profile_id
          where t.id = $1::uuid`,
        [terminalA],
      );
      const termCreds = await client.query(
        `select credential_type, certificate_serial, status from edge_identity.device_credential where device_id = $1::uuid order by 1`,
        [terminalA],
      );
      return {
        hub: hub.rows[0],
        hubCreds: hubCreds.rows,
        term: term.rows[0],
        termCreds: termCreds.rows,
      };
    });
    expect(rows.hub).toMatchObject({
      lifecycle_status: "deployed",
      trust_status: "trusted",
      manufacturing_cert_serial: hubCert.serial,
      status: "active",
      assignment_generation: 3,
      operational_cert_serial: hubCert.serial,
    });
    expect(rows.hubCreds).toEqual([
      { credential_type: "device_identity", status: "active" },
      { credential_type: "operational_tls", status: "active" },
    ]);
    expect(rows.term).toMatchObject({
      terminal_name: first.terminalName,
      certificate_serial: first.x509CertificateSerial,
      lifecycle_status: "active",
      assignment_generation: 1,
      profile_code: "hw.compute.terminal",
    });
    expect(rows.termCreds).toEqual([
      { credential_type: "device_identity", certificate_serial: identityA, status: "active" },
      {
        credential_type: "operational_tls",
        certificate_serial: first.x509CertificateSerial,
        status: "active",
      },
    ]);
    const grants = await withHubTransaction(pool, (c) =>
      readActiveGrantSet(c, scope.storeLocationId),
    );
    expect([...grants]).toEqual([[terminalA, [T1, T2]]]);
  });

  it("changes nothing on an identical second pass — no new snapshot, no new grant rows", async () => {
    const before = await snapshotCount();
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(outcome.terminals[0]).toMatchObject({ action: "unchanged" });
    expect(outcome.configuration).toEqual({ published: false, reason: "unchanged" });
    expect(await snapshotCount()).toBe(before);
  });

  it("republishes when the profile set changes, closing the previous grants in the same transaction", async () => {
    const changed: TerminalDelivery = { ...first, profileCodes: [T1, T3] };
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [changed],
      environment: "development",
      signer,
    });
    // The terminal row itself did not change (same serial, generation, name).
    expect(outcome.terminals[0]).toMatchObject({ action: "unchanged" });
    expect(outcome.configuration).toMatchObject({ published: true, grantsWritten: 2 });
    const grants = await withHubTransaction(pool, (c) =>
      readActiveGrantSet(c, scope.storeLocationId),
    );
    expect([...grants]).toEqual([[terminalA, [T1, T3]]]);
    const open = await withHubTransaction(pool, async (c) => {
      const r = await c.query<{ profile_code: string }>(
        `select profile_code from edge_config.terminal_profile_assignment
          where terminal_device_id = $1::uuid and enabled and effective_until is null order by 1`,
        [terminalA],
      );
      return r.rows.map((x) => x.profile_code);
    });
    // Only the NEW grants are open; T2's old row and T1's old row are closed.
    expect(open).toEqual([T1, T3]);
  });

  it("refuses a delivery for another Store and writes nothing for it", async () => {
    const foreign = delivery({
      terminalDeviceId: randomUUID(),
      terminalName: "KL-FOREIGN-0001",
      storeLocationId: randomUUID(),
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      identityKeyFingerprint: publicKeyFingerprint(edPublicPem()),
    });
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [{ ...first, profileCodes: [T1, T3] }, foreign],
      environment: "development",
      signer,
    });
    expect(outcome.terminals.find((t) => t.terminalName === "KL-FOREIGN-0001")).toMatchObject({
      action: "refused",
      detail: "the delivery names another Store's scope",
    });
    const rows = await withHubTransaction(pool, (c) =>
      c.query(`select 1 from edge_identity.terminal_device where id = $1::uuid`, [
        foreign.terminalDeviceId,
      ]),
    );
    expect(rows.rowCount).toBe(0);
    expect(outcome.configuration).toEqual({ published: false, reason: "unchanged" });
  });

  it("lets a re-flashed board (new identity, same asset tag) take the name and retires the previous row", async () => {
    const reflashed = delivery({
      terminalDeviceId: randomUUID(),
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      identityKeyFingerprint: publicKeyFingerprint(edPublicPem()),
      profileCodes: [T1, T3],
    });
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [reflashed],
      environment: "development",
      signer,
    });
    expect(outcome.terminals[0]).toMatchObject({ action: "projected", retiredPrevious: terminalA });
    expect(outcome.configuration).toMatchObject({ published: true, grantsWritten: 2 });
    const rows = await withHubTransaction(pool, async (c) => {
      const r = await c.query<{ id: string; terminal_name: string; lifecycle_status: string }>(
        `select id, terminal_name, lifecycle_status from edge_identity.terminal_device
          where location_id = $1::uuid order by created_at`,
        [scope.storeLocationId],
      );
      const creds = await c.query<{ status: string }>(
        `select status from edge_identity.device_credential where device_id = $1::uuid`,
        [terminalA],
      );
      return { devices: r.rows, oldCredStatuses: creds.rows.map((x) => x.status) };
    });
    expect(rows.devices).toEqual([
      {
        id: terminalA,
        terminal_name: `KL-TEST-SYNC-0001~retired-${terminalA.slice(0, 8)}`,
        lifecycle_status: "retired",
      },
      {
        id: reflashed.terminalDeviceId,
        terminal_name: "KL-TEST-SYNC-0001",
        lifecycle_status: "active",
      },
    ]);
    expect(new Set(rows.oldCredStatuses)).toEqual(new Set(["superseded"]));
    const grants = await withHubTransaction(pool, (c) =>
      readActiveGrantSet(c, scope.storeLocationId),
    );
    expect([...grants]).toEqual([[reflashed.terminalDeviceId, [T1, T3]]]);
  });

  it("retires the terminals the cloud no longer names and withdraws every grant, without activating an empty configuration", async () => {
    const before = await snapshotCount();
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [],
      environment: "development",
      signer,
    });
    expect(outcome.retiredAbsent).toEqual(["KL-TEST-SYNC-0001"]);
    expect(outcome.configuration).toMatchObject({
      published: false,
      reason: "no_grants",
      grantsWithdrawn: 2,
    });
    expect(await snapshotCount()).toBe(before);
    const grants = await withHubTransaction(pool, (c) =>
      readActiveGrantSet(c, scope.storeLocationId),
    );
    expect(grants.size).toBe(0);
    const live = await withHubTransaction(pool, (c) =>
      c.query(
        `select 1 from edge_identity.terminal_device where location_id = $1::uuid and lifecycle_status = 'active'`,
        [scope.storeLocationId],
      ),
    );
    expect(live.rowCount).toBe(0);
  });

  it("refuses an expired credential and a hardware profile this Hub does not hold", async () => {
    const expired = delivery({
      terminalDeviceId: randomUUID(),
      terminalName: "KL-EXPIRED-0001",
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      issuedAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const unknownHardware = delivery({
      terminalDeviceId: randomUUID(),
      terminalName: "KL-NOHW-0001",
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      hardwareProfileCode: "hw.compute.toaster",
    });
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [expired, unknownHardware],
      environment: "development",
      signer,
    });
    expect(outcome.terminals).toEqual([
      expect.objectContaining({
        terminalName: "KL-EXPIRED-0001",
        action: "refused",
        detail: "the credential has expired",
      }),
      expect.objectContaining({
        terminalName: "KL-NOHW-0001",
        action: "refused",
        detail: "this Hub holds no hardware profile hw.compute.toaster",
      }),
    ]);
    expect(outcome.configuration).toEqual({ published: false, reason: "unchanged" });
  });

  it("re-projects a terminal as active when the cloud names it again", async () => {
    const back = delivery({
      terminalDeviceId: randomUUID(),
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      identityKeyFingerprint: publicKeyFingerprint(edPublicPem()),
      profileCodes: [T1],
    });
    // A retired row keeps its name, so this is the same-name path again: the
    // previous row is renamed and this one takes the name.
    const outcome = await applyEnvelope(pool, {
      self,
      deliveries: [back],
      environment: "development",
      signer,
    });
    expect(outcome.terminals[0]).toMatchObject({ action: "projected" });
    expect(outcome.retiredAbsent).toEqual([]);
    expect(outcome.configuration).toMatchObject({ published: true, grantsWritten: 1 });
  });

  it("publishes the catalog and the money contract as sections, and only when their content changed", async () => {
    const catalog = {
      schema: "kitluy.config.catalog.v1" as const,
      currency_code: "KHR",
      content_hash: "1".repeat(64),
      families: [{ code: "WASH_FOLD", lane: "per_weight", name: "Wash & Fold", sort_order: 10 }],
      categories: [],
      services: [
        {
          service_code: "WF-KG",
          family_code: "WASH_FOLD",
          pricing_mode: "PER_WEIGHT",
          unit_price_minor: 4000,
          display_name: "Wash & Fold (per kg)",
        },
      ],
      garment_types: [],
    };
    const money = {
      schema: "kitluy.config.money.v1" as const,
      currency_code: "KHR",
      currency_exponent: 0,
      money_rounding: "round_half_up_minor_unit",
      weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
      location_code: "TEST-01",
    };
    const live = delivery({
      terminalDeviceId: randomUUID(),
      terminalName: "KL-CATALOG-0001",
      credentialId: randomUUID(),
      x509CertificateSerial: hexSerial(),
      identityKeyFingerprint: publicKeyFingerprint(edPublicPem()),
      profileCodes: [T1],
    });
    // First: grants unchanged from the previous test? The previous terminal was
    // named again with T1; this is a NEW terminal, so grants change too.
    const first = await applyEnvelope(pool, {
      self,
      deliveries: [live],
      environment: "development",
      signer,
      catalog,
      money,
    });
    expect(first.configuration).toMatchObject({
      published: true,
      sections: ["terminal_profiles", "pricing", "catalog"],
    });
    if (!first.configuration.published) return;
    expect(first.configuration.because).toEqual(
      expect.arrayContaining(["grants", "catalog", "money"]),
    );
    const held = await withHubTransaction(pool, async (c) => {
      const r = await c.query<{ section_code: string; content_json: Record<string, unknown> }>(
        `select s.section_code, s.content_json from edge_config.configuration_section s
           join edge_config.active_configuration a on a.snapshot_id = s.snapshot_id
          where a.location_id = $1::uuid order by 1`,
        [scope.storeLocationId],
      );
      return r.rows;
    });
    expect(held.map((h) => h.section_code)).toEqual(["catalog", "pricing", "terminal_profiles"]);
    expect(held.find((h) => h.section_code === "pricing")?.content_json).toMatchObject({
      currency_code: "KHR",
      currency_exponent: 0,
      location_code: "TEST-01",
    });
    expect(held.find((h) => h.section_code === "catalog")?.content_json).toMatchObject({
      content_hash: "1".repeat(64),
    });

    // Same everything → nothing published.
    const same = await applyEnvelope(pool, {
      self,
      deliveries: [live],
      environment: "development",
      signer,
      catalog,
      money,
    });
    expect(same.configuration).toEqual({ published: false, reason: "unchanged" });

    // A new catalog hash alone → republished, because catalog only.
    const priced = await applyEnvelope(pool, {
      self,
      deliveries: [live],
      environment: "development",
      signer,
      catalog: { ...catalog, content_hash: "2".repeat(64) },
      money,
    });
    expect(priced.configuration).toMatchObject({ published: true, because: ["catalog"] });

    // A new FX rate alone → republished, because money only.
    const fx = await applyEnvelope(pool, {
      self,
      deliveries: [live],
      environment: "development",
      signer,
      catalog: { ...catalog, content_hash: "2".repeat(64) },
      money: { ...money, fx: { USD: { khr_per_usd: 4100 } } },
    });
    expect(fx.configuration).toMatchObject({ published: true, because: ["money"] });
    const grants = await withHubTransaction(pool, (c) =>
      readActiveGrantSet(c, scope.storeLocationId),
    );
    expect([...grants]).toEqual([[live.terminalDeviceId, [T1]]]);
  });

  it("refuses to publish outside development (the projections' door refused there too)", async () => {
    await expect(
      applyEnvelope(pool, {
        self,
        deliveries: [
          delivery({
            terminalDeviceId: randomUUID(),
            terminalName: "KL-PILOT-0001",
            credentialId: randomUUID(),
            x509CertificateSerial: hexSerial(),
          }),
        ],
        environment: "pilot",
        signer,
      }),
    ).rejects.toThrow(/KLUY-HUB-DEV-CONFIG-ENVIRONMENT/);
  });

  async function snapshotCount(): Promise<number> {
    return withHubTransaction(pool, async (c) => {
      const r = await c.query<{ n: string }>(
        `select count(*)::text as n from edge_config.configuration_snapshot where location_id = $1::uuid`,
        [scope.storeLocationId],
      );
      return Number(r.rows[0]?.n ?? 0);
    });
  }
});
