/**
 * T1-STORE-OPERATIONS-001 — the Pi Terminal path, END TO END, on real parts.
 *
 *   REAL Hub database (kitluy_hub_local)
 *   REAL Store Hub edge router + TLS 1.3 mutual-TLS listener (hub-agent build)
 *   REAL terminal-edge attempt: discovery check, PAIRING_REQUIRED, its own
 *        Ed25519 pairing, SERVING, the pinned endpoint (firstboot-agent build)
 *   REAL edge bridge on a unix socket (firstboot-agent build)
 *   REAL POS Pi composition (`PiTerminalRuntime`, `bootstrapT1ThroughEdge`)
 *
 *   bridge -> authority time -> eligibility (bound to device, Hub, generation)
 *   -> T1 -> configuration (bound, digest, Hub-time window)
 *   -> LOCKED (PIN setup required) -> Terminal PIN created twice -> READY
 *   -> customer created locally -> Laundry Booking Draft created, edited,
 *      reopened -> rows in the Hub database -> sync facts in the Hub outbox
 *   -> THE STORE OPERATION (T1-REAL-OPERATIONS-001 slice 2): the Hub quotes
 *      the cart from its delivered catalog -> confirm-intake with cash
 *      (KHR + USD) under the terminal's own kl1 command key -> Booking,
 *      lines, payment, receipt on the Hub; draft converted; Orders view
 *   -> locked -> wrong PIN refused -> unlocked
 *
 * No staff record, no grant row and no passcode exist anywhere in this run: the
 * device credential plus the Terminal PIN is the whole credential
 * (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001).
 *
 * and the refusals that must still hold on this path: a seat generation the
 * Hub does not serve, a revoked credential, a pairing route asked of the bridge.
 *
 * The POS side touches no database, no key and no TLS: every POS interaction is
 * the unix socket. The harness's own inserts arrange the CLOUD's projections on
 * the Hub, exactly as the WS-12-T001 e2e and every hub-agent suite do.
 */
import { createHash, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  type DeviceRecordId,
  type TrustEnvironment,
} from "@kitluy/device-identity";
import {
  runEdgeAttempt,
  startEdgeBridge,
  type EdgeStatus,
  type PinnedHubEndpoint,
} from "@kitluy-services/kitluy-device-firstboot-agent";
import {
  createHubPool,
  isHubDatabaseReachable,
} from "@kitluy-services/kitluy-hub-agent/dist/hub/db.js";
import { TerminalPairingComposition } from "@kitluy-services/kitluy-hub-agent/dist/hub/pairing.js";
import type {
  PairingSigner,
  SafeLogger,
} from "@kitluy-services/kitluy-hub-agent/dist/hub/pairing.js";
import { EdgeDiscoveryAuthority } from "@kitluy-services/kitluy-hub-agent/dist/hub/edge/discovery.js";
import { createEdgeTlsServer } from "@kitluy-services/kitluy-hub-agent/dist/hub/edge/transport.js";
import {
  createEdgeTerminalRouter,
  unavailableActivationGateway,
} from "@kitluy-services/kitluy-hub-agent/dist/hub/edge/routes.js";

import { bridgeCall } from "../electron/edge-bridge-client.js";
import { PiTerminalRuntime } from "../electron/pi-runtime.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const T1 = "laundry.t1.intake_cashier";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: T1 Pi edge e2e — local Hub database unreachable");

// The delivered sections for the run (slice 2): the fixture Location's ACTIVE
// snapshot gets a KHR money contract (restored afterwards) and a catalog
// (upserted; sections are append-only on the Hub).
const SUIT = "0a000000-0000-4000-8000-00000000e002";
const KG = "0a000000-0000-4000-8000-00000000e001";
const E2E_CATALOG = {
  schema: "kitluy.config.catalog.v1",
  currency_code: "KHR",
  content_hash: "e".repeat(64),
  families: [
    { code: "WASH_FOLD", lane: "per_weight", name: "Wash & Fold", sort_order: 1 },
    { code: "DRY_CLEAN", lane: "per_piece", name: "Dry Clean", sort_order: 2 },
  ],
  categories: [],
  services: [
    {
      service_id: KG,
      service_code: "WF-KG",
      family_code: "WASH_FOLD",
      name: "Wash & Fold per kg",
      pricing_mode: "PER_WEIGHT",
      currency_code: "KHR",
      unit_price_minor: 4000,
    },
    {
      service_id: SUIT,
      service_code: "DC-SUIT_2PC",
      family_code: "DRY_CLEAN",
      name: "Suit (2 pc)",
      pricing_mode: "PER_PIECE",
      currency_code: "KHR",
      unit_price_minor: 25000,
    },
  ],
  garment_types: [],
};
const E2E_MONEY = {
  schema: "kitluy.config.money.v1",
  currency_code: "KHR",
  currency_exponent: 0,
  money_rounding: "round_half_up_minor_unit",
  weight_rule: { unit: "kg", increment: 1, rounding: "up", minimum: 1 },
  location_code: "DEMO-PP-01",
  fx: { USD: { khr_per_usd: 4100, effective_from: "2026-09-19T00:00:00Z" } },
};

const keys = new DevelopmentDeviceKeyProvider();
const logger: SafeLogger = { info: () => undefined };

interface Ca {
  readonly key: forge.pki.rsa.PrivateKey;
  readonly cert: forge.pki.Certificate;
  readonly certPem: string;
}

function mintCa(cn: string): Ca {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: cn }]);
  cert.setIssuer([{ name: "commonName", value: cn }]);
  cert.setExtensions([{ name: "basicConstraints", cA: true }]);
  cert.sign(kp.privateKey, forge.md.sha256.create());
  return { key: kp.privateKey, cert, certPem: forge.pki.certificateToPem(cert) };
}

/** A device leaf shaped like a KitLuy operational certificate: URI SANs, no DNS name. */
function issueDeviceCert(
  ca: Ca,
  deviceId: string,
  server: boolean,
): { keyPem: string; certPem: string; serial: string; fingerprint: string } {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  const serial = `7${randomBytes(8).toString("hex").slice(0, 15)}`;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 3_600_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: `kitluy-device:${deviceId}` }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: server, clientAuth: !server },
    {
      name: "subjectAltName",
      altNames: [
        { type: 6, value: `kitluy-device://${deviceId}` },
        { type: 6, value: "kitluy-environment://development" },
      ],
    },
  ]);
  cert.sign(ca.key, forge.md.sha256.create());
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  return {
    keyPem: forge.pki.privateKeyToPem(kp.privateKey),
    certPem: forge.pki.certificateToPem(cert),
    serial: serial.toLowerCase(),
    fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
  };
}

describe.skipIf(!live)(
  "T1 on a Pi Terminal, through terminal-edge and the edge bridge (e2e)",
  () => {
    let pool: pg.Pool;
    let originalHubFingerprint = "";
    let originalHubExpiry = "";
    let hadHubRuntime = false;
    let closeHub: (() => Promise<void>) | null = null;
    let bridge: Server | null = null;
    let hubPort = 0;
    let work = "";
    let originalPricing: unknown;

    beforeAll(async () => {
      if (!live) return;
      pool = createHubPool(process.env, 6);
      work = mkdtempSync(join(tmpdir(), "kitluy-pi-edge-"));
      const savedPricing = await pool.query<{ content_json: unknown }>(
        `select content_json from edge_config.configuration_section
          where snapshot_id = $1 and section_code = 'pricing'`,
        [ACTIVE_SNAPSHOT],
      );
      originalPricing = savedPricing.rows[0]?.content_json;
      await pool.query(
        `update edge_config.configuration_section set content_json = $2::jsonb
          where snapshot_id = $1 and section_code = 'pricing'`,
        [ACTIVE_SNAPSHOT, JSON.stringify(E2E_MONEY)],
      );
      await pool.query(
        `insert into edge_config.configuration_section
           (id, snapshot_id, section_code, section_version, content_sha256, content_json,
            required, validation_state, validation_error)
         values ($1, $2, 'catalog', 7, encode(sha256(convert_to($3::text, 'UTF8')), 'hex'), $3::jsonb, false, 'valid', null)
         on conflict (snapshot_id, section_code) do update
           set content_json = excluded.content_json, content_sha256 = excluded.content_sha256`,
        [randomUUID(), ACTIVE_SNAPSHOT, JSON.stringify(E2E_CATALOG)],
      );

      const hubKeyRef = `piedge-hub-${RUN}` as DeviceRecordId;
      await keys.generateDeviceKey(hubKeyRef, "development");
      const hubPem = keys.publicKeyPem(hubKeyRef) ?? "";
      const { rows: saved } = await pool.query<{
        public_key_fingerprint: string;
        expires_at: string;
      }>(
        `select public_key_fingerprint, expires_at::text as expires_at
         from edge_identity.device_credential where id = $1`,
        [HUB_CREDENTIAL],
      );
      originalHubFingerprint = saved[0]?.public_key_fingerprint ?? "";
      originalHubExpiry = saved[0]?.expires_at ?? "";
      await pool.query(
        `update edge_identity.device_credential
          set public_key_fingerprint = $2, expires_at = now() + interval '1 year'
        where id = $1`,
        [HUB_CREDENTIAL, publicKeyFingerprint(hubPem)],
      );
      const { rows: who } = await pool.query<{ current_user: string }>(`select current_user`);
      const user = who[0]?.current_user ?? "postgres";
      const { rows: membership } = await pool.query<{ member: boolean }>(
        `select pg_has_role($1, 'kitluy_hub_runtime', 'member') as member`,
        [user],
      );
      hadHubRuntime = membership[0]?.member ?? false;
      if (!hadHubRuntime) await pool.query(`grant kitluy_hub_runtime to "${user}"`);
    }, 120_000);

    afterAll(async () => {
      if (!live) return;
      if (bridge !== null) await new Promise<void>((r) => bridge?.close(() => r()));
      if (closeHub !== null) await closeHub();
      if (originalPricing !== undefined) {
        await pool.query(
          `update edge_config.configuration_section set content_json = $2::jsonb
            where snapshot_id = $1 and section_code = 'pricing'`,
          [ACTIVE_SNAPSHOT, JSON.stringify(originalPricing)],
        );
      }
      if (originalHubFingerprint !== "") {
        await pool.query(
          `update edge_identity.device_credential
            set public_key_fingerprint = $2, expires_at = $3::timestamptz
          where id = $1`,
          [HUB_CREDENTIAL, originalHubFingerprint, originalHubExpiry],
        );
      }
      if (!hadHubRuntime) {
        const { rows } = await pool.query<{ current_user: string }>(`select current_user`);
        await pool.query(`revoke kitluy_hub_runtime from "${rows[0]?.current_user ?? "postgres"}"`);
      }
      await pool.end();
      rmSync(work, { recursive: true, force: true });
    }, 120_000);

    it("pairs, serves, sets up and unlocks the Terminal PIN into T1, commits a Booking Draft, and CONFIRMS a paid Booking on the Hub with its receipt", async () => {
      // ----------------------------------------------------------------- Hub
      const hubKeyRef = `piedge-hub-${RUN}` as DeviceRecordId;
      const hubPem = keys.publicKeyPem(hubKeyRef) ?? "";
      const signer: PairingSigner = {
        certificateSerial: "DEMO-OPS-CERT-0001",
        publicKeyPem: hubPem,
        sign: (payload) => keys.provePossession(hubKeyRef, payload),
      };
      const ca = mintCa(`KitLuy PiEdge Device CA ${RUN}`);
      const hubTls = issueDeviceCert(ca, HUB_DEVICE, true);
      const { rows: skew } = await pool.query<{ now: Date }>(`select now() as now`);
      const skewMs = (skew[0]?.now.getTime() ?? Date.now()) - Date.now();
      const router = createEdgeTerminalRouter({
        pool,
        pairing: new TerminalPairingComposition(pool, signer, logger),
        activationGateway: unavailableActivationGateway(),
        discovery: new EdgeDiscoveryAuthority(
          {
            hubDeviceId: HUB_DEVICE,
            hubTlsCertificateFingerprint: hubTls.fingerprint,
            tenantId: TENANT,
            digitalStoreId: STORE,
            storeLocationId: LOCATION,
            environment: "development" as TrustEnvironment,
            hostname: "127.0.0.1",
          },
          signer,
          logger,
          () => new Date(Date.now() + skewMs),
        ),
        deliverySigner: signer,
        logger,
      });
      const edge = createEdgeTlsServer({
        key: hubTls.keyPem,
        cert: hubTls.certPem,
        clientCa: ca.certPem,
        bindHost: "127.0.0.1",
        port: 0,
        handler: router,
        logger,
      });
      const listening = await edge.listen();
      hubPort = listening.port;
      closeHub = () => edge.close();

      // ------------------------------------ the cloud's projections on the Hub
      const deviceId = randomUUID();
      const identity = generateKeyPairSync("ed25519");
      const identityPublicPem = identity.publicKey
        .export({ type: "spki", format: "pem" })
        .toString();
      const terminalTls = issueDeviceCert(ca, deviceId, false);
      const { rows: hw } = await pool.query<{ id: string }>(
        `select id from edge_config.hardware_profile limit 1`,
      );
      await pool.query(
        `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name,
          hardware_profile_id, installation_id, certificate_serial,
          assignment_generation, lifecycle_status, last_client_sequence,
          last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', 0, now(), now(), now())`,
        [
          deviceId,
          TENANT,
          STORE,
          LOCATION,
          `piedge-${RUN}`,
          hw[0]?.id,
          randomUUID(),
          terminalTls.serial,
        ],
      );
      const credentialId = randomUUID();
      await pool.query(
        `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint,
          certificate_serial, issuer, issued_at, expires_at, status,
          revoked_at, revocation_reason, rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Test Device CA',
               now() - interval '1 day', now() + interval '1 hour', 'active', null, null, 1)`,
        [credentialId, deviceId, publicKeyFingerprint(identityPublicPem), terminalTls.serial],
      );
      await pool.query(
        `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id,
          profile_code, assignment_version, enabled, effective_from,
          effective_until, source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour', null, $7)`,
        [randomUUID(), TENANT, STORE, LOCATION, deviceId, T1, ACTIVE_SNAPSHOT],
      );

      // ------------------------------- the board: files terminal-edge reads
      const operationalDir = join(work, "operational");
      mkdirSync(operationalDir, { recursive: true });
      writeFileSync(join(operationalDir, "operational-tls.crt.pem"), terminalTls.certPem);
      writeFileSync(join(operationalDir, "operational-tls.key.pem"), terminalTls.keyPem);
      writeFileSync(join(operationalDir, "operational-tls.chain.pem"), ca.certPem);
      const identityKeyPath = join(work, "device-identity.key.pem");
      writeFileSync(
        identityKeyPath,
        identity.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      );

      // ------------------------------------------------ REAL terminal-edge
      let pinned: PinnedHubEndpoint | null = null;
      const attempt = (): Promise<EdgeStatus> =>
        runEdgeAttempt({
          environment: "development",
          operationalDir,
          statusPath: join(work, "terminal", "edge-status.json"),
          lastEndpointPath: join(work, "terminal", "last-hub-endpoint.json"),
          expectation: { digitalStoreId: STORE, storeLocationId: LOCATION },
          profileCodes: [T1],
          identityKeyPath,
          discover: () => Promise.resolve([{ host: "127.0.0.1", port: hubPort, instance: "e2e" }]),
          onPinnedEndpoint: (endpoint) => {
            pinned = endpoint;
          },
        });
      const edgeStatus = await attempt();
      expect(edgeStatus.phase, JSON.stringify(edgeStatus)).toBe("SERVING");
      // The Hub asked for pairing and terminal-edge did it BY ITSELF (Defect G path).
      expect(edgeStatus.pairing).toMatchObject({
        attempted: true,
        result: "PAIRED",
        profileCode: T1,
      });
      expect(pinned).toMatchObject({
        hubDeviceId: HUB_DEVICE,
        certificateFingerprint: hubTls.fingerprint,
      });

      // --------------------------------------------------- REAL edge bridge
      let seatGeneration = 1;
      const runDir = join(work, "run");
      mkdirSync(runDir, { mode: 0o700 });
      const groupFile = join(work, "group");
      writeFileSync(groupFile, `kitluy-terminal:x:${String(userInfo().gid)}:\n`);
      const socketPath = join(runDir, "bridge.sock");
      bridge = await startEdgeBridge(
        {
          environment: "development",
          pinnedEndpoint: () => pinned,
          latestStatus: () => edgeStatus,
          terminalFacts: () => ({
            deviceId,
            assignmentGeneration: seatGeneration,
            profileCodes: [T1],
          }),
          readCredentials: () => ({
            available: true,
            credentials: {
              certificatePem: terminalTls.certPem,
              keyPem: terminalTls.keyPem,
              trustAnchorsPem: ca.certPem,
            },
          }),
        },
        { socketPath, directory: runDir, groupFile },
      );

      // --------------------------------------------- the POS, socket only
      const statusPath = join(work, "terminal", "pos-runtime.json");
      const pos = new PiTerminalRuntime({
        socketPath,
        applicationVersion: "0.1.0",
        statusPath,
        logger: { log: () => undefined },
      });

      const waiting = await pos.refresh();
      expect(waiting.state, JSON.stringify(waiting)).toBe("staff_authentication_required");
      expect(waiting.transitions).toEqual([
        "starting",
        "connecting_to_hub",
        "configuration_loading",
        "staff_authentication_required",
      ]);
      expect(waiting.configuration?.freshness).toBe("current");
      expect(waiting.hub?.hubDeviceId).toBe(HUB_DEVICE);
      expect(waiting.link?.hubSignatures).toBe("not_verified_hub_key_not_provisioned");
      expect(pos.intakeOperations()).toBeNull();

      expect(waiting.pin).toMatchObject({ state: "setup_required", lockedUntil: null });
      const published = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
      expect(published).toMatchObject({
        schema: "kitluy.pos-runtime-status.v2",
        product: "kitluy-terminal",
        state: "staff_authentication_required",
        hubDeviceId: HUB_DEVICE,
        terminalUnlocked: false,
        link: "edge_bridge",
      });

      // No PIN yet: nothing unlocks, and a mismatched setup is refused by the Hub.
      expect(await pos.unlock({ pin: "4826" })).toMatchObject({
        ok: false,
        code: "PIN_SETUP_REQUIRED",
      });
      expect(await pos.setupPin({ pin: "4826", pinConfirmation: "4862" })).toMatchObject({
        ok: false,
        code: "PIN_CONFIRMATION_MISMATCH",
      });
      expect(pos.intakeOperations()).toBeNull();

      // §10: created twice on the trusted terminal; the Hub keeps a verifier.
      const established = await pos.setupPin({ pin: "4826", pinConfirmation: "4826" });
      expect(established.ok, JSON.stringify(established)).toBe(true);
      expect(pos.report?.state).toBe("ready");
      expect(pos.report?.pin).toMatchObject({ state: "set", lockedUntil: null });
      expect(pos.report?.staff?.actorId).toBe(deviceId);
      const afterSetup = readFileSync(statusPath, "utf8");
      expect(afterSetup).toContain('"state": "ready"');
      expect(afterSetup).toContain('"terminalUnlocked": true');
      expect(afterSetup).not.toContain("4826");
      const { rows: pinRows } = await pool.query<{ verifier: string; state: string }>(
        `select verifier, state from edge_identity.terminal_pin where terminal_device_id = $1`,
        [deviceId],
      );
      expect(pinRows[0]?.state).toBe("set");
      expect(pinRows[0]?.verifier).toMatch(/^\$argon2id\$/);
      expect(pinRows[0]?.verifier).not.toContain("4826");
      // Nothing about a person exists on the Hub for this run.
      const { rows: staff } = await pool.query(
        `select 1 from edge_identity.terminal_session where terminal_device_id = $1 and credential_kind <> 'terminal_pin'`,
        [deviceId],
      );
      expect(staff).toEqual([]);

      // ------------------------------------------- THE STORE OPERATION
      const ops = pos.intakeOperations();
      expect(ops).not.toBeNull();
      if (ops === null) return;
      const phone = `012${randomUUID()
        .replace(/[^0-9]/g, "")
        .padEnd(6, "3")
        .slice(0, 6)}`;
      const none = await ops.searchCustomers(phone);
      expect(none).toEqual({ ok: true, value: [] });
      const created = await ops.createCustomer({
        displayName: "Pi Edge Customer",
        phone,
        preferredLanguage: "km-KH",
      });
      expect(created.ok, JSON.stringify(created)).toBe(true);
      if (!created.ok) return;
      expect(created.value.syncState).toBe("pending_sync");
      const draft = await ops.createDraft({
        customerId: created.value.customerId,
        walkIn: false,
        preferredLanguage: "km-KH",
        customerNotes: "pi edge: wash and fold",
        staffNotes: "pi edge: first T1 operation",
      });
      expect(draft.ok, JSON.stringify(draft)).toBe(true);
      if (!draft.ok) return;
      expect(draft.value.lifecycle).toBe("open");
      expect(draft.value.version).toBe(1);
      const edited = await ops.updateDraft({
        draftId: draft.value.draftId,
        expectedVersion: 1,
        staffNotes: "pi edge: edited",
      });
      expect(edited.ok && edited.value.version).toBe(2);
      const stale = await ops.updateDraft({
        draftId: draft.value.draftId,
        expectedVersion: 1,
        staffNotes: "pi edge: stale write",
      });
      expect(stale).toMatchObject({ ok: false, kind: "stale_version" });
      const reopened = await ops.readDraft(draft.value.draftId);
      expect(reopened.ok && reopened.value.staffNotes).toBe("pi edge: edited");

      // ---------------------------------------- Hub-local authority, proven
      const { rows: drafts } = await pool.query<{ version: number; lifecycle: string }>(
        `select version::int as version, lifecycle from edge_laundry.booking_draft where id = $1`,
        [draft.value.draftId],
      );
      expect(drafts).toEqual([{ version: 2, lifecycle: "open" }]);
      const { rows: facts } = await pool.query<{ event_type: string; delivery_state: string }>(
        `select e.event_type, o.delivery_state
         from edge_sync.outbox o
         join edge_sync.local_event e on e.id = o.event_id
        where e.aggregate_id in ($1, $2)
        order by o.hub_sequence`,
        [created.value.customerId, draft.value.draftId],
      );
      expect(facts).toEqual([
        { event_type: "customer.local_customer_created", delivery_state: "pending" },
        { event_type: "laundry.booking_draft_recorded", delivery_state: "pending" },
        { event_type: "laundry.booking_draft_recorded", delivery_state: "pending" },
      ]);

      // ---------------------- THE STORE OPERATION (slice 2): quote → confirm
      const cart = [
        { serviceId: SUIT, pieceCount: 1 },
        { serviceId: KG, weighedGrams: 2400 }, // 3 kg billable
      ];
      const quoted = await ops.quote({ draftId: draft.value.draftId, lines: cart, express: false });
      expect(quoted.ok, JSON.stringify(quoted)).toBe(true);
      if (!quoted.ok) return;
      expect(quoted.value).toMatchObject({
        currencyCode: "KHR",
        subtotalMinor: "37000",
        totalMinor: "37000",
        khrPerUsd: 4100,
        locationCode: "DEMO-PP-01",
      });
      expect(
        quoted.value.lines.map((l) => [l.serviceCode, l.quantity, l.lineSubtotalMinor]),
      ).toEqual([
        ["DC-SUIT_2PC", "1.0000", "25000"],
        ["WF-KG", "3.0000", "12000"],
      ]);
      // The Hub refuses a displayed total that is not its own; nothing is written.
      const priceMismatch = await ops.confirmIntake({
        draftId: draft.value.draftId,
        expectedVersion: 2,
        lines: cart,
        express: false,
        displayedTotalMinor: "36000",
        tender: { localMinor: "40000", usdCents: "0" },
      });
      expect(priceMismatch).toMatchObject({
        ok: false,
        kind: "price_mismatch",
        detail: "PRICE_MISMATCH",
      });
      // Cash in full: 10 000 riel + 10 dollars at the delivered rate; change 14 000.
      const confirmedResult = await ops.confirmIntake({
        draftId: draft.value.draftId,
        expectedVersion: 2,
        lines: cart,
        express: false,
        displayedTotalMinor: quoted.value.totalMinor,
        tender: { localMinor: "10000", usdCents: "1000" },
      });
      expect(confirmedResult.ok, JSON.stringify(confirmedResult)).toBe(true);
      if (!confirmedResult.ok) return;
      const confirmed = confirmedResult.value;
      expect(confirmed.outcome).toBe("confirmed");
      expect(confirmed.booking).toMatchObject({
        status: "intake_confirmed",
        total_minor: "37000",
        paid_minor: "37000",
        balance_minor: "0",
        line_count: 2,
      });
      expect(confirmed.booking.booking_number).toMatch(/^KLB-DEMO-PP-01-\d{6}-\d{6}$/);
      expect(confirmed.payment).toMatchObject({
        tendered_minor: "51000",
        change_due_minor: "14000",
      });
      expect(confirmed.payment?.legs.map((l) => [l.currency_code, l.amount_minor])).toEqual([
        ["KHR", "10000"],
        ["USD", "1000"],
      ]);
      expect(confirmed.receipt.receipt_number).toMatch(/^KLR-DEMO-PP-01-/);
      expect(confirmed.receipt.payload["total_minor"]).toBe("37000");
      expect(confirmed.draft).toEqual({
        draft_id: draft.value.draftId,
        lifecycle: "converted",
        version: 3,
        converted_booking_id: confirmed.booking.booking_id,
      });
      // The command was keyed by THIS terminal's own sequence, seeded from the
      // Hub's eligibility answer: kl1.{device}.1 — and the Hub now expects 2.
      const { rows: command } = await pool.query<{
        idempotency_key: string;
        commit_status: string;
        actor_id: string;
      }>(
        `select idempotency_key, commit_status, actor_id from edge_sync.command_result
          where aggregate_id = $1`,
        [confirmed.booking.booking_id],
      );
      expect(command).toEqual([
        { idempotency_key: `kl1.${deviceId}.1`, commit_status: "committed", actor_id: deviceId },
      ]);
      const { rows: seq } = await pool.query<{ last_client_sequence: string }>(
        `select last_client_sequence::text from edge_identity.terminal_device where id = $1`,
        [deviceId],
      );
      expect(seq[0]?.last_client_sequence).toBe("1");
      const { rows: bookingRows } = await pool.query<Record<string, unknown>>(
        `select b.status, b.customer_id, b.paid_minor::text as paid,
                (select count(*)::text from edge_laundry.booking_line l where l.booking_id = b.id) as lines,
                (select count(*)::text from edge_payments.tender_leg t join edge_payments.payment p on p.id = t.payment_id where p.booking_id = b.id) as legs,
                (select r.receipt_number from edge_documents.receipt r where r.booking_id = b.id) as receipt
           from edge_laundry.booking b where b.id = $1`,
        [confirmed.booking.booking_id],
      );
      expect(bookingRows[0]).toEqual({
        status: "intake_confirmed",
        customer_id: created.value.customerId,
        paid: "37000",
        lines: "2",
        legs: "2",
        receipt: confirmed.receipt.receipt_number,
      });
      const { rows: bookingFacts } = await pool.query<{ event_type: string; actor: string }>(
        `select e.event_type, e.payload -> 'actor' ->> 'actor_type' as actor
           from edge_sync.local_event e where e.aggregate_id in ($1, $2, $3) and e.hub_sequence > $4
          order by e.hub_sequence`,
        [confirmed.booking.booking_id, confirmed.payment?.payment_id, draft.value.draftId, 0],
      );
      expect(bookingFacts.map((f) => f.event_type)).toEqual([
        "laundry.booking_draft_recorded",
        "laundry.booking_draft_recorded",
        "laundry_booking.created",
        "payment.recorded",
        "payment.tender_recorded",
        "payment.tender_recorded",
        "document.receipt_issued",
        "laundry.booking_draft_recorded",
      ]);
      expect(bookingFacts.slice(2).every((f) => f.actor === "device")).toBe(true);
      // A converted draft cannot be confirmed again (a fresh key is minted;
      // the Hub answers DRAFT_NOT_OPEN and names the Booking).
      const twice = await ops.confirmIntake({
        draftId: draft.value.draftId,
        expectedVersion: 3,
        lines: cart,
        express: false,
        displayedTotalMinor: "37000",
        tender: { localMinor: "37000", usdCents: "0" },
      });
      expect(twice).toMatchObject({ ok: false, kind: "conflict", detail: "DRAFT_NOT_OPEN" });
      // The Orders view lists it, from the Hub.
      const recent = await ops.listRecentBookings();
      expect(
        recent.ok && recent.value.find((b) => b.bookingId === confirmed.booking.booking_id),
      ).toMatchObject({
        bookingNumber: confirmed.booking.booking_number,
        customerDisplayName: "Pi Edge Customer",
        walkIn: false,
        receiptNumber: confirmed.receipt.receipt_number,
      });

      // ------------------------------ lock, wrong PIN, unlock again
      await pos.lock();
      expect(pos.report?.state).toBe("staff_authentication_required");
      expect(pos.intakeOperations()).toBeNull();
      const lockedWrite = await ops.createDraft({
        customerId: null,
        walkIn: true,
        preferredLanguage: "km-KH",
        customerNotes: "",
        staffNotes: "must not land while locked",
      });
      expect(lockedWrite.ok).toBe(false);
      const wrong = await pos.unlock({ pin: "0000" });
      expect(wrong).toMatchObject({
        ok: false,
        code: "PIN_INCORRECT",
        pin: { attemptsBeforeLock: 4 },
      });
      const unlocked = await pos.unlock({ pin: "4826" });
      expect(unlocked.ok, JSON.stringify(unlocked)).toBe(true);
      expect(pos.report?.state).toBe("ready");
      const ops2 = pos.intakeOperations();
      expect(ops2).not.toBeNull();
      const reread = await ops2?.readDraft(draft.value.draftId);
      expect(reread?.ok && reread.value.version).toBe(3);
      expect(reread?.ok && reread.value.lifecycle).toBe("converted");

      // --------------------------- the bridge is still a narrow door
      const staffDoor = await bridgeCall(socketPath)("POST", "/edge/v1/sessions/open", {
        actorId: randomUUID(),
        passcode: "anything",
        profileCode: T1,
      });
      expect(staffDoor.status).toBe(404);
      const pairingAsked = await bridgeCall(socketPath)(
        "POST",
        "/edge/v1/terminal-pairing/sessions",
        {
          requestedProfileCode: "laundry.t2.customer_display",
        },
      );
      expect(pairingAsked.status).toBe(404);

      // ----- a seat generation the Hub does not serve: assignment_invalid
      seatGeneration = 2;
      const mismatch = await pos.refresh();
      expect(mismatch.state).toBe("assignment_invalid");
      expect(mismatch.refusalCode).toBe("ASSIGNMENT_GENERATION_MISMATCH");
      expect(pos.intakeOperations()).toBeNull();
      seatGeneration = 1;
      expect((await pos.refresh()).state).toBe("ready");

      // ----- a revoked credential: refused by the Hub, intake closed
      await pool.query(
        `update edge_identity.device_credential
          set status = 'revoked', revoked_at = now(), revocation_reason = 'e2e'
        where id = $1`,
        [credentialId],
      );
      const revoked = await pos.refresh();
      expect(revoked.state, JSON.stringify(revoked)).toBe("credential_invalid");
      expect(pos.intakeOperations()).toBeNull();
      const refusedWrite = await ops.createDraft({
        customerId: null,
        walkIn: true,
        preferredLanguage: "km-KH",
        customerNotes: "",
        staffNotes: "must not land",
      });
      expect(refusedWrite.ok).toBe(false);
    }, 240_000);
  },
);
