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
 *   -> STAFF AUTHENTICATION REQUIRED -> staff sign-in (T1) -> READY
 *   -> customer created locally -> Laundry Booking Draft created, edited,
 *      reopened -> rows in the Hub database -> sync facts in the Hub outbox
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
import { staffCredentialVerifier } from "@kitluy-services/kitluy-hub-agent/dist/hub/edge/runtime-bootstrap.js";

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

    beforeAll(async () => {
      if (!live) return;
      pool = createHubPool(process.env, 6);
      work = mkdtempSync(join(tmpdir(), "kitluy-pi-edge-"));

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

    it("pairs, serves, signs a staff member into T1, and commits a Booking Draft on the Hub with its outbox facts", async () => {
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
      const actorId = randomUUID();
      const passcode = `pc-${randomBytes(8).toString("hex")}`;
      await pool.query(
        `insert into edge_identity.staff_cache
         (actor_id, tenant_id, digital_store_id, location_id, display_name,
          credential_verifier, permission_snapshot_version, profile_codes,
          offline_valid_until, disabled, last_synced_at)
       values ($1, $2, $3, $4, 'Pi Edge Cashier', $5, 1, $6, now() + interval '4 hours', false, now())`,
        [actorId, TENANT, STORE, LOCATION, staffCredentialVerifier(actorId, passcode), [T1]],
      );
      for (const key of [
        "staff.sessions.open",
        "staff.sessions.read",
        "staff.sessions.refresh",
        "staff.sessions.close",
        "pos.t1.use",
        "customers.read",
        "customers.create",
        "laundry.bookings.read",
        "laundry.bookings.create",
      ]) {
        await pool.query(
          `insert into edge_config.permission_grant_projection
           (id, tenant_id, digital_store_id, location_id, source_snapshot_id,
            projection_version, actor_id, permission_key, effect, resource_type,
            scope_type, scope_id, environment, requires_reauthentication,
            requires_approval, requires_reason, granted_at, not_before,
            expires_at, revoked_at, offline_validity_seconds,
            offline_policy_reference, signature, signature_algorithm,
            signing_key_id, received_at)
         values ($1, $2, $3, $4, $5, 1, $6, $7, 'allow', 'terminal_session',
                 'store_location', $4, 'development', false, false, false,
                 now() - interval '1 hour', now() - interval '1 hour',
                 null, null, 3600, 'dev-offline-policy', decode('c0ffee00','hex'),
                 'ed25519', 'demo-signing-key-1', now())`,
          [randomUUID(), TENANT, STORE, LOCATION, ACTIVE_SNAPSHOT, actorId, key],
        );
      }

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

      const published = JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
      expect(published).toMatchObject({
        schema: "kitluy.pos-runtime-status.v1",
        product: "kitluy-terminal",
        state: "staff_authentication_required",
        hubDeviceId: HUB_DEVICE,
        staffSignedIn: false,
        link: "edge_bridge",
      });

      const wrong = await pos.signIn({ actorId, passcode: "0000-not-it" });
      expect(wrong.ok).toBe(false);
      expect(pos.intakeOperations()).toBeNull();

      const signedIn = await pos.signIn({ actorId, passcode });
      expect(signedIn.ok, JSON.stringify(signedIn)).toBe(true);
      expect(pos.report?.state).toBe("ready");
      expect(pos.report?.staff?.displayName).toBe("Pi Edge Cashier");
      const afterSignIn = readFileSync(statusPath, "utf8");
      expect(afterSignIn).toContain('"state": "ready"');
      expect(afterSignIn).not.toContain(passcode);
      expect(afterSignIn).not.toContain(actorId);

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

      // --------------------------- the bridge is still a narrow door
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
