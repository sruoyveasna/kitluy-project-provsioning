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

import {
  HUB_RUNTIME_ROLE,
  createHubPool,
  isHubDatabaseReachable,
  withHubTransaction,
} from "../src/hub/db.js";
import { loadOrCreateDevelopmentSigner } from "../src/hub/dev-configuration.js";
import {
  applyEnvelope,
  readActiveGrantSet,
  type HubSelfFacts,
  type TerminalDelivery,
} from "../src/hub/terminal-sync/apply.js";
import { publicKeyFingerprint } from "../src/hub/terminal-sync/contract.js";
import { deriveEligibility } from "../src/hub/edge/runtime-bootstrap.js";

const live = await isHubDatabaseReachable();
if (!live) {
  console.warn(
    "[terminal-sync.integration] kitluy_hub_local is unreachable — SKIPPED, not evidence",
  );
}

/**
 * The shared development fixture's Hub assignment (`hub/seed/dev-fixtures.sql`).
 * This suite displaces it and must restore it — see `afterAll`.
 */
const HUB_FIXTURE_ASSIGNMENT_ID = "e0000000-0000-4000-8000-000000000012";

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
    // ... and PUT THE FIXTURE BACK. Ending this suite's own assignment is only
    // half of it: `applyEnvelope` ends EVERY other active assignment when it
    // projects itself (production design — "a Hub database serves exactly one
    // board"), and the shared `kitluy_hub_local` fixture is one of them. So
    // after this suite ran, the database held ZERO live assignments and nothing
    // restored it: every command suite scheduled afterwards refused with
    // `EDGE_DEVICE_NOT_ASSIGNED` / "holds no active assignment" against a Hub
    // that was perfectly healthy. That is the true cause of the "pre-existing"
    // failures carried since handoff 53, diagnosed in handoff 55 §1 and fixed
    // here rather than re-diagnosed again: a suite that displaces shared state
    // restores it. Scoped to the fixture row by id, and a no-op in a database
    // that has none (a fresh Hub, or the board's own).
    await withHubTransaction(pool, (c) =>
      c.query(
        `update edge_identity.hub_assignment
            set status = 'active', ended_at = null
          where id = $1::uuid`,
        [HUB_FIXTURE_ASSIGNMENT_ID],
      ),
    );
    await pool.end();
  });

  it("projects the Hub itself and the delivered terminal, and publishes the grants", async () => {
    const outcome = await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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
      primaryVertical: "laundry",
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

  // 2026-09-23, on hardware: reflashing the Store Hub's SD card gives the board a
  // NEW identity in the cloud, while the SAME database unlocks underneath it —
  // the volume is on the NVMe and the development key is derived from the board
  // serial. The old identity's assignment stayed ACTIVE beside the new one, the
  // Hub answered its own terminal 403 PAIRING_REQUIRED, and the terminal sat at
  // "Connected to the Store Hub" until the Store's database was wiped by hand.
  it("ends the assignment of a Hub identity this database used to serve (a reflashed board)", async () => {
    const previousHub = randomUUID();
    const previousAssignment = randomUUID();
    await withHubTransaction(pool, async (client) => {
      await client.query(
        `insert into edge_identity.hub_device
           (id, asset_number, device_kind, lifecycle_status, trust_status,
            board_serial_hash, factory_duid_hash, root_key_fingerprint,
            manufacturing_cert_serial, created_at, updated_at)
         values ($1::uuid, 'KITLUY-DEV-HUB-PREV-' || left(replace($1::text, '-', ''), 8),
                 'store_hub', 'deployed', 'trusted',
                 repeat('a', 64), repeat('b', 64), repeat('c', 64), 'PREVIOUS-BOARD', now(), now())
         on conflict (id) do nothing`,
        [previousHub],
      );
      await client.query(
        `insert into edge_identity.hub_assignment
           (id, hub_device_id, tenant_id, digital_store_id, location_id,
            assignment_generation, assigned_at, ended_at, status, operational_cert_serial)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 5, now(), null, 'active', 'PREV-CERT')`,
        [
          previousAssignment,
          previousHub,
          scope.tenantId,
          scope.digitalStoreId,
          scope.storeLocationId,
        ],
      );
    });

    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [delivery()],
      environment: "development",
      signer,
    });

    // Asserted on the two rows this case owns, not on "one row in the database":
    // the local Hub database is shared by every suite here, and a neighbour's
    // fixture may be live at the same instant. On a real Hub there is one board
    // and one database, which is exactly why the previous identity must end.
    const rows = await withHubTransaction(pool, (client) =>
      client.query(
        `select id::text as id, status, ended_at is not null as ended
           from edge_identity.hub_assignment where id = any($1::uuid[])`,
        [[previousAssignment, self.assignmentId]],
      ),
    );
    const byId = new Map(rows.rows.map((r: Record<string, unknown>) => [r["id"], r]));
    expect(byId.get(previousAssignment)).toMatchObject({ status: "ended", ended: true });
    expect(byId.get(self.assignmentId)).toMatchObject({ status: "active", ended: false });
  });

  // 2026-09-25, on hardware (Cycle B): the SAME board, a new SD card. The Hub
  // keeps its device id, the NVMe database keeps the previous installation's
  // identity and operational credential -- and until this fix both stayed
  // 'active' at rotation_generation 1 beside the new ones. The pairing door's
  // `order by rotation_generation desc limit 1` then bound the session to the
  // OLD identity, and completion refused KLUY-EDGE-PAIRING-CERT-INVALID.
  it("supersedes the Hub's own credentials from a previous installation of the same board", async () => {
    const staleOperational = randomUUID();
    const staleIdentity = randomUUID();
    const staleFingerprint = publicKeyFingerprint(edPublicPem());
    await withHubTransaction(pool, async (client) => {
      for (const [id, type, serial] of [
        [staleOperational, "operational_tls", hexSerial()],
        [staleIdentity, "device_identity", staleFingerprint],
      ] as const) {
        await client.query(
          `insert into edge_identity.device_credential
             (id, device_id, credential_type, public_key_fingerprint, certificate_serial,
              issuer, issued_at, expires_at, status, rotation_generation)
           values ($1::uuid, $2::uuid, $3, $4, $5, 'CN=cycle-a', now() - interval '2 days',
                   now() + interval '28 days', 'active', 1)`,
          [id, self.hubDeviceId, type, staleFingerprint, serial],
        );
      }
    });

    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [delivery()],
      environment: "development",
      signer,
    });

    const rows = await withHubTransaction(pool, (client) =>
      client.query<{
        id: string;
        credential_type: string;
        certificate_serial: string;
        status: string;
        rotation_generation: number;
      }>(
        `select id::text as id, credential_type, certificate_serial, status, rotation_generation
           from edge_identity.device_credential where device_id = $1::uuid`,
        [self.hubDeviceId],
      ),
    );
    const byId = new Map(rows.rows.map((r) => [r.id, r]));
    expect(byId.get(staleOperational)?.status).toBe("superseded");
    expect(byId.get(staleIdentity)?.status).toBe("superseded");

    // Exactly one current credential of each kind: the board's own.
    const active = rows.rows.filter((r) => r.status === "active");
    expect(active.map((r) => r.credential_type).sort()).toEqual([
      "device_identity",
      "operational_tls",
    ]);
    const currentIdentity = publicKeyFingerprint(self.identityPublicKeyPem ?? "");
    expect(active.find((r) => r.credential_type === "device_identity")?.certificate_serial).toBe(
      currentIdentity,
    );
    expect(active.find((r) => r.credential_type === "operational_tls")?.certificate_serial).toBe(
      hubCert.serial,
    );

    // The pairing door's own selection (Hub migration 0042) now has one answer.
    const signing = await withHubTransaction(pool, (client) =>
      client.query<{ certificate_serial: string }>(
        `select c.certificate_serial from edge_identity.device_credential c
          where c.device_id = $1::uuid and c.credential_type = 'device_identity'
            and c.status = 'active' and c.revoked_at is null and c.expires_at > now()
          order by c.rotation_generation desc limit 1`,
        [self.hubDeviceId],
      ),
    );
    expect(signing.rows.map((r) => r.certificate_serial)).toEqual([currentIdentity]);
  });

  it("refuses to publish outside development (the projections' door refused there too)", async () => {
    await expect(
      applyEnvelope(pool, {
        self,
        primaryVertical: "laundry",
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

  // -------------------------------------------------------------------------
  // PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001 — the column the whole hardware
  // path was waiting on, written by the sync itself.
  // -------------------------------------------------------------------------

  async function assignmentVertical(assignmentId: string): Promise<string | null> {
    return withHubTransaction(pool, async (c) => {
      const r = await c.query<{ primary_vertical_code: string | null }>(
        `select primary_vertical_code from edge_identity.hub_assignment where id = $1::uuid`,
        [assignmentId],
      );
      return r.rows[0]?.primary_vertical_code ?? null;
    });
  }

  it("writes primary_vertical_code on the Hub assignment — the first projection fills it", async () => {
    // The suite's first `it` already applied an envelope for this assignment,
    // so the value is here because the SYNC wrote it. Nothing was hand-edited.
    expect(await assignmentVertical(self.assignmentId)).toBe("laundry");
  });

  it("turns an existing NULL assignment into laundry on the next valid sync", async () => {
    // Exactly the state of all 32 rows the sync wrote before this change, and
    // of any Hub already in the field: the row EXISTS and its vertical is NULL,
    // so the fix has to land on the `on conflict do update` path, not only on
    // insert. Blank it and re-sync.
    await withHubTransaction(pool, (c) =>
      c.query(
        `update edge_identity.hub_assignment set primary_vertical_code = null where id = $1::uuid`,
        [self.assignmentId],
      ),
    );
    expect(await assignmentVertical(self.assignmentId)).toBeNull();

    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(await assignmentVertical(self.assignmentId)).toBe("laundry");
  });

  it("is idempotent: the same envelope again leaves the same value", async () => {
    const before = await assignmentVertical(self.assignmentId);
    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(await assignmentVertical(self.assignmentId)).toBe(before);
    expect(await assignmentVertical(self.assignmentId)).toBe("laundry");
  });

  it("applies a legitimate authoritative change, and refuses a value outside the registry", async () => {
    // The cloud is the sole author: if the Store's vertical genuinely changes,
    // the governed projection carries it and the Hub follows.
    await applyEnvelope(pool, {
      self,
      primaryVertical: "cafe_restaurant",
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(await assignmentVertical(self.assignmentId)).toBe("cafe_restaurant");

    // Migration 0044's CHECK is the last line: an unregistered SHAPE cannot be
    // written at all, whatever the caller believes.
    await expect(
      withHubTransaction(pool, (c) =>
        c.query(
          `update edge_identity.hub_assignment set primary_vertical_code = $2 where id = $1::uuid`,
          [self.assignmentId, "LAUNDRY"],
        ),
      ),
    ).rejects.toThrow(/hub_assignment_primary_vertical_shape_ck/u);

    // Put the Laundry Store back for the eligibility tests below.
    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(await assignmentVertical(self.assignmentId)).toBe("laundry");
  });

  it("does not disturb assignments this envelope does not name", async () => {
    // A second, ENDED assignment of a previous pairing keeps the vertical it
    // served under; the sync rewrites only the row the envelope is about.
    const historic = randomUUID();
    await withHubTransaction(pool, (c) =>
      c.query(
        `insert into edge_identity.hub_assignment
           (id, hub_device_id, tenant_id, digital_store_id, location_id,
            assignment_generation, assigned_at, ended_at, status, operational_cert_serial,
            primary_vertical_code)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, 1,
                 now() - interval '10 days', now() - interval '5 days', 'ended', $6, 'laundry')`,
        [
          historic,
          self.hubDeviceId,
          scope.tenantId,
          scope.digitalStoreId,
          scope.storeLocationId,
          hexSerial(),
        ],
      ),
    );
    await applyEnvelope(pool, {
      self,
      primaryVertical: "cafe_restaurant",
      deliveries: [first],
      environment: "development",
      signer,
    });
    expect(await assignmentVertical(historic)).toBe("laundry");

    await applyEnvelope(pool, {
      self,
      primaryVertical: "laundry",
      deliveries: [first],
      environment: "development",
      signer,
    });
  });

  /**
   * Eligibility, in an isolated transaction that is ALWAYS rolled back.
   *
   * `deriveEligibility` asks `selectOperationalHubIdentity` which Hub this is,
   * and that picks the OLDEST trusted, deployed `store_hub` in the database —
   * in the shared `kitluy_hub_local` that is the fixture's board, not this
   * suite's. So the transaction demotes every other Hub first, making this
   * suite's the operational one, runs the check, and rolls the whole thing
   * back. Nothing here reaches the shared fixture, and no test below sees it.
   */
  async function eligibilityInIsolation(
    vertical: string | null,
  ): Promise<{ outcome: string; refusal?: string; detail?: string }> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `update edge_identity.hub_device set lifecycle_status = 'provisioned'
          where device_kind = 'store_hub' and id <> $1::uuid`,
        [self.hubDeviceId],
      );
      await client.query(
        `update edge_identity.hub_assignment set primary_vertical_code = $2
          where id = $1::uuid`,
        [self.assignmentId, vertical],
      );
      await client.query(`set local role ${HUB_RUNTIME_ROLE}`);
      return (await deriveEligibility(
        client,
        terminalA,
        first.x509CertificateSerial,
        "development",
      )) as { outcome: string; refusal?: string; detail?: string };
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  it("stops VERTICAL_UNAVAILABLE once the sync has written the vertical", async () => {
    // The sync wrote `laundry` in the tests above; this is the state a real
    // Store Hub is in after one pass.
    expect(await assignmentVertical(self.assignmentId)).toBe("laundry");
    const eligible = await eligibilityInIsolation("laundry");
    // The terminal may still be refused for an unrelated reason — it never
    // paired in this suite, and pairing is a different gate. What must not
    // happen any more is the vertical refusal that blocked every board.
    expect(eligible.refusal).not.toBe("VERTICAL_UNAVAILABLE");
  });

  it("still refuses a NULL vertical — migration 0044 was not weakened", async () => {
    expect(await eligibilityInIsolation(null)).toMatchObject({
      outcome: "refused",
      refusal: "VERTICAL_UNAVAILABLE",
    });
  });

  it("refuses a vertical the registry does not name, though the CHECK allows its shape", async () => {
    // `bakery` satisfies 0044's `^[a-z][a-z0-9_]*$` and is still not a locked
    // vertical. Shape is not membership.
    const unknown = await eligibilityInIsolation("bakery");
    expect(unknown).toMatchObject({ outcome: "refused", refusal: "VERTICAL_UNAVAILABLE" });
    expect(unknown.detail).toMatch(/not a registered vertical/u);
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
