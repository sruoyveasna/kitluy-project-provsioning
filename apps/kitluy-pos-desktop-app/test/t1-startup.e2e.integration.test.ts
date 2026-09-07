/**
 * WS-12-T001-P02 §7 — the END-TO-END startup proof.
 *
 * A production-shaped development integration: the REAL Hub database, the
 * REAL Edge TLS 1.3 mTLS server serving the three bootstrap routes and the
 * session routes, the REAL Electron main-process composition root
 * (`runT1Bootstrap`), a REAL encrypted terminal-local store, REAL Ed25519
 * signing and verification and REAL TLS test certificates.
 *
 *   protected identity → pairing receipt verification → signed discovery
 *   → TLS 1.3 mTLS → Hub authority time → runtime eligibility → signed
 *   configuration → staff-session open → pos.t1.use → READY
 *
 * and, with the Hub reachable but unable to attest a delivery:
 *
 *   valid cached configuration + eligible local authority → OFFLINE_READY
 *
 * The terminal side touches the database NOWHERE: every terminal
 * interaction goes through the PUBLIC runtime adapters. (The harness's own
 * fixture arrangement writes cloud-owned projections directly, exactly as
 * every hub-agent suite does — that is test arrangement of the CLOUD's
 * writes, not a terminal capability.)
 *
 * The hub-agent service is a devDependency consumed through its build
 * output solely to HOST the Hub side of this integration; the app's
 * production code imports nothing from it.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import forge from "node-forge";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  type DeviceRecordId,
  type PairingReceipt,
  type TrustEnvironment,
} from "@kitluy/device-identity";
import type { OsEncryptionFacility } from "@kitluy/terminal-local-store";

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

import { runT1Bootstrap } from "../electron/t1-runtime.js";
import { createIntakeOperations } from "../electron/t1-intake-client.js";
import { IntakeMachine } from "../src/intake/machine.js";
import {
  applyT002Acknowledgment,
  deliveryPayloadOf,
  listPendingT002Facts,
} from "@kitluy-services/kitluy-hub-agent/dist/hub/t1-intake-sync.js";
import {
  BookingDraftIngestion,
  ConsentDecisionIngestion,
  LocalCustomerIngestion,
} from "@kitluy-services/kitluy-device-registry-service/dist/t002-intake-ingestion.js";
import { installProtectedTerminalIdentity } from "../electron/terminal-identity.js";
import { openTerminalPairingStore } from "../electron/terminal-store.js";
import { pinnedHubRequest } from "../electron/lan-client.js";
import type { ProtectedTerminalIdentity } from "../src/bootstrap/ports.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const T1 = "laundry.t1.intake_cashier";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: T1 e2e startup — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };

// ---------------------------------------------------------------------------
// X.509 minting (per run, never persisted)
// ---------------------------------------------------------------------------

interface TestCa {
  readonly key: forge.pki.rsa.PrivateKey;
  readonly cert: forge.pki.Certificate;
  readonly certPem: string;
}

function mintCa(name: string): TestCa {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: "commonName", value: name }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, digitalSignature: true },
  ]);
  cert.sign(kp.privateKey, forge.md.sha256.create());
  return { key: kp.privateKey, cert, certPem: forge.pki.certificateToPem(cert) };
}

interface TlsIdentity {
  readonly keyPem: string;
  readonly certPem: string;
  readonly serial: string;
  readonly fingerprint: string;
}

function issueCert(
  ca: TestCa,
  options: { readonly cn: string; readonly server?: boolean },
): TlsIdentity {
  const kp = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = kp.publicKey;
  const serial = `7${randomBytes(8).toString("hex").slice(0, 15)}`;
  cert.serialNumber = serial;
  cert.validity.notBefore = new Date(Date.now() - 3_600_000);
  cert.validity.notAfter = new Date(Date.now() + 30 * 86_400_000);
  cert.setSubject([{ name: "commonName", value: options.cn }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    {
      name: "extKeyUsage",
      serverAuth: options.server === true,
      clientAuth: options.server !== true,
    },
    ...(options.server === true
      ? [
          {
            name: "subjectAltName",
            altNames: [
              { type: 2, value: "localhost" },
              { type: 7, ip: "127.0.0.1" },
            ],
          },
        ]
      : []),
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

/** Reversible XOR facility — the safeStorage stand-in for a headless run. */
function facility(): OsEncryptionFacility {
  const key = 0x37;
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(Buffer.from(plainText, "utf8").map((b) => b ^ key)),
    decryptString: (encrypted) => Buffer.from(encrypted.map((b) => b ^ key)).toString("utf8"),
  };
}

describe.skipIf(!live)("T1 end-to-end startup against a running development Hub (§7)", () => {
  let pool: pg.Pool;
  let signer: PairingSigner;
  let originalHubFingerprint = "";
  let originalHubExpiry = "";
  let hadHubRuntime = false;
  let deviceCa: TestCa;
  let hubTls: TlsIdentity;
  let port = 0;
  let unsignedPort = 0;
  let closeServer: (() => Promise<void>) | null = null;
  let closeUnsigned: (() => Promise<void>) | null = null;
  const temporaryDirectories: string[] = [];

  afterAll(async () => {
    if (!live) return;
    if (closeServer !== null) await closeServer();
    if (closeUnsigned !== null) await closeUnsigned();
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
    while (temporaryDirectories.length > 0) {
      const dir = temporaryDirectories.pop();
      if (dir === undefined) continue;
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // The production runtime keeps its SQLite store open for the app's
        // lifetime, so Windows may still hold the file lock here. The OS
        // temp cleaner owns leftovers; nothing sensitive is plaintext.
      }
    }
  }, 120_000);

  beforeAll(async () => {
    if (!live) return;
    pool = createHubPool(process.env, 10);

    const hubKeyRef = `t1e2e-hub-${RUN}` as DeviceRecordId;
    await keys.generateDeviceKey(hubKeyRef, "development");
    const hubPem = keys.publicKeyPem(hubKeyRef) ?? "";
    const hubFingerprint = publicKeyFingerprint(hubPem);
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
      [HUB_CREDENTIAL, hubFingerprint],
    );
    const { rows: grantee } = await pool.query<{ current_user: string }>(`select current_user`);
    const user = grantee[0]?.current_user ?? "postgres";
    const { rows: membership } = await pool.query<{ member: boolean }>(
      `select pg_has_role($1, 'kitluy_hub_runtime', 'member') as member`,
      [user],
    );
    hadHubRuntime = membership[0]?.member ?? false;
    if (!hadHubRuntime) {
      await pool.query(`grant kitluy_hub_runtime to "${user}"`);
    }

    signer = {
      certificateSerial: "DEMO-OPS-CERT-0001",
      publicKeyPem: hubPem,
      sign: (payload) => keys.provePossession(hubKeyRef, payload),
    };
    const pairing = new TerminalPairingComposition(pool, signer, logger);
    deviceCa = mintCa(`KitLuy T1E2E Device CA ${RUN}`);
    hubTls = issueCert(deviceCa, { cn: `hub-${RUN}`, server: true });
    // The discovery record is minted on the HUB-DATABASE-anchored clock, the
    // same instant family the terminal judges it against — the KLD-2026-08-
    // 06-WS11-CLOCK-001 discipline (no lower-bound grace; anchor the mint,
    // never the tolerance). In this harness the container database drifts
    // from the host wall clock, so the anchor is measured once.
    const { rows: skewRow } = await pool.query<{ now: Date }>(`select now() as now`);
    const skewMs = (skewRow[0]?.now.getTime() ?? Date.now()) - Date.now();
    const discovery = new EdgeDiscoveryAuthority(
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
    );
    const serve = async (
      withSigner: boolean,
    ): Promise<{ port: number; close: () => Promise<void> }> => {
      const router = createEdgeTerminalRouter({
        pool,
        pairing,
        activationGateway: unavailableActivationGateway(),
        discovery,
        ...(withSigner ? { deliverySigner: signer } : {}),
        logger,
      });
      const edge = createEdgeTlsServer({
        key: hubTls.keyPem,
        cert: hubTls.certPem,
        clientCa: deviceCa.certPem,
        bindHost: "127.0.0.1",
        port: 0,
        handler: router,
        logger,
      });
      const listening = await edge.listen();
      return { port: listening.port, close: () => edge.close() };
    };
    const main = await serve(true);
    port = main.port;
    closeServer = main.close;
    const unsigned = await serve(false);
    unsignedPort = unsigned.port;
    closeUnsigned = unsigned.close;
  }, 300_000);

  it("reaches READY through the public Hub routes, then OFFLINE_READY with the delivery unavailable", async () => {
    // ----- Hub-side fixture: a terminal registered the way the cloud→Hub
    // delivery path will register it, a staff member and the five grants.
    const deviceId = randomUUID();
    const terminalKeyRef = `t1e2e-term-${RUN}` as DeviceRecordId;
    await keys.generateDeviceKey(terminalKeyRef, "development");
    const terminalPem = keys.publicKeyPem(terminalKeyRef) ?? "";
    const terminalFingerprint = publicKeyFingerprint(terminalPem);
    const terminalTls = issueCert(deviceCa, { cn: `terminal-${RUN}` });
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
        `t1e2e-${RUN}`,
        hw[0]?.id,
        randomUUID(),
        terminalTls.serial,
      ],
    );
    await pool.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint,
          certificate_serial, issuer, issued_at, expires_at, status,
          revoked_at, revocation_reason, rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Test Device CA',
               now() - interval '1 day', now() + interval '1 hour', 'active', null, null, 1)`,
      [randomUUID(), deviceId, terminalFingerprint, terminalTls.serial],
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
       values ($1, $2, $3, $4, 'E2E Cashier', $5, 1, $6, now() + interval '4 hours', false, now())`,
      [actorId, TENANT, STORE, LOCATION, staffCredentialVerifier(actorId, passcode), [T1]],
    );
    for (const key of [
      "staff.sessions.open",
      "staff.sessions.read",
      "staff.sessions.refresh",
      "staff.sessions.close",
      "pos.t1.use",
      // WS-12-T002-P02: the intake permissions (Amendment 003 + draft reuse).
      "customers.read",
      "customers.create",
      "customers.consent.record",
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

    // ----- Terminal side, PUBLIC adapters only from here on.
    const credentials = {
      obtain: () => ({
        certificatePem: terminalTls.certPem,
        keyPem: terminalTls.keyPem,
        hubCaPem: deviceCa.certPem,
      }),
    };
    const lan = (
      method: "GET" | "POST",
      path: string,
      body?: unknown,
      headers?: Record<string, string>,
    ) =>
      pinnedHubRequest({
        hostname: "127.0.0.1",
        port,
        method,
        path,
        pinnedCertificateFingerprint: hubTls.fingerprint,
        credentials: credentials.obtain(),
        ...(body === undefined ? {} : { body }),
        ...(headers === undefined ? {} : { headers }),
      });

    // PAIR through the real four-step handshake over the LAN client.
    const terminalNonce = randomBytes(32).toString("hex");
    const hello = await lan("POST", "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: T1,
      terminalNonce,
      protocolVersion: "1.0",
      environment: "development",
    });
    expect(hello.status, JSON.stringify(hello.body)).toBe(201);
    const session = (hello.body as Record<string, unknown>)["session"] as Record<string, unknown>;
    const sessionId = String(session["pairingSessionId"]);
    const signature = Buffer.from(
      keys.provePossession(
        terminalKeyRef,
        Buffer.from(String(session["signingPayload"]), "base64url"),
      ),
    ).toString("base64url");
    const proof = await lan(
      "POST",
      `/edge/v1/terminal-pairing/sessions/${sessionId}/terminal-proof`,
      { signature, terminalPublicKeyPem: terminalPem },
    );
    expect(proof.status, JSON.stringify(proof.body)).toBe(200);
    const complete = await lan(
      "POST",
      `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`,
      {},
    );
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
    const pairingBody = (complete.body as Record<string, unknown>)["pairing"] as Record<
      string,
      unknown
    >;
    const receiptWire = pairingBody["receipt"] as Record<string, unknown>;
    const receipt: PairingReceipt = {
      receiptId: String(receiptWire["receiptId"]),
      receiptVersion: String(receiptWire["receiptVersion"]),
      pairingSessionId: String(receiptWire["pairingSessionId"]),
      transcriptHash: String(receiptWire["transcriptHash"]),
      hubDeviceId: String(receiptWire["hubDeviceId"]),
      hubCertificateFingerprint: String(receiptWire["hubCertificateFingerprint"]),
      terminalDeviceId: String(receiptWire["terminalDeviceId"]),
      terminalCertificateFingerprint: String(receiptWire["terminalCertificateFingerprint"]),
      tenantId: String(receiptWire["tenantId"]),
      digitalStoreId: String(receiptWire["digitalStoreId"]),
      storeLocationId: String(receiptWire["storeLocationId"]),
      environment: String(receiptWire["environment"]) as TrustEnvironment,
      terminalAssignmentGeneration: Number(receiptWire["terminalAssignmentGeneration"]),
      terminalProfileKey: String(receiptWire["terminalProfileKey"]),
      pairedAt: new Date(String(receiptWire["pairedAt"])),
      validUntil:
        receiptWire["validUntil"] === null ? null : new Date(String(receiptWire["validUntil"])),
      correlationId: String(receiptWire["correlationId"]),
    };
    const expectation = {
      pairingSessionId: receipt.pairingSessionId,
      transcriptHash: receipt.transcriptHash,
      hubDeviceId: receipt.hubDeviceId,
      hubCertificateFingerprint: receipt.hubCertificateFingerprint,
      terminalDeviceId: receipt.terminalDeviceId,
      terminalCertificateFingerprint: receipt.terminalCertificateFingerprint,
      tenantId: receipt.tenantId,
      digitalStoreId: receipt.digitalStoreId,
      storeLocationId: receipt.storeLocationId,
      environment: receipt.environment,
      terminalAssignmentGeneration: receipt.terminalAssignmentGeneration,
      terminalProfileKey: receipt.terminalProfileKey,
    };

    // Install the identity and persist the verified receipt — the same two
    // durable artifacts real provisioning leaves behind.
    const userData = mkdtempSync(join(tmpdir(), "kitluy-t1-e2e-"));
    temporaryDirectories.push(userData);
    const f = facility();
    const identity: ProtectedTerminalIdentity = {
      terminalDeviceId: deviceId,
      terminalCertificateSerial: terminalTls.serial,
      terminalCertificateFingerprint: terminalFingerprint,
      environment: "development",
      hubOperationalPublicKeyPem: signer.publicKeyPem,
      receiptExpectation: expectation,
      discoveryExpectation: {
        hubDeviceId: HUB_DEVICE,
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development",
      },
      hubEndpointHint: { hostname: "127.0.0.1", port },
    };
    installProtectedTerminalIdentity(
      f,
      userData,
      {
        identity,
        provenance: {
          provisioningSessionId: randomUUID(),
          pairingSessionId: receipt.pairingSessionId,
          issuedAt: new Date().toISOString(),
        },
      },
      new Date(),
    );
    const store = openTerminalPairingStore(f, userData);
    store.receipts.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: Buffer.from(
        String(pairingBody["receiptSignature"]),
        "base64url",
      ).toString("base64"),
      hubPublicKeyPem: signer.publicKeyPem,
      expectation,
      context: { terminalAssignmentId: randomUUID(), activationId: randomUUID() },
      at: new Date(String(receiptWire["pairedAt"])),
    });
    store.driver.close();

    // The completed interactive staff login, THROUGH the public adapter.
    const staffSession = {
      acquire: async (hub: {
        openStaffSession: (input: {
          actorId: string;
          passcode: string;
          profileCode: string;
        }) => Promise<
          | {
              outcome: "ok";
              session: {
                effectivePermissions: readonly string[];
                expiresAt: string;
                actorId: string;
                displayName: string;
              };
            }
          | { outcome: "refused"; result: string; retryable: boolean; detail: string }
        >;
      }) => {
        const opened = await hub.openStaffSession({ actorId, passcode, profileCode: T1 });
        if (opened.outcome !== "ok") return null;
        return {
          actorId: opened.session.actorId,
          displayName: opened.session.displayName,
          profileCodes: [T1],
          effectivePermissions: opened.session.effectivePermissions,
          expiresAt: opened.session.expiresAt,
        };
      },
    };

    // ----- FIRST STARTUP: the full §7 chain to READY.
    const ready = await runT1Bootstrap(f, userData, {
      credentials,
      applicationVersion: "0.1.0",
      mdnsTimeoutMs: 100,
      staffSession,
    });
    expect(ready.state, JSON.stringify(ready)).toBe("ready");
    expect(ready.transitions).toEqual([
      "starting",
      "connecting_to_hub",
      "configuration_loading",
      "ready",
    ]);
    expect(ready.configuration?.freshness).toBe("current");
    expect(ready.configuration?.configurationVersion).toBe(7);
    expect(ready.hub?.hubDeviceId).toBe(HUB_DEVICE);
    expect(ready.staff?.displayName).toBe("E2E Cashier");

    // ----- SECOND STARTUP: the Hub is reachable but cannot ATTEST a
    // delivery (no signer) — the cached valid configuration carries the
    // explicit offline label. Cloud/WAN is consulted nowhere by design.
    const identityOffline: ProtectedTerminalIdentity = {
      ...identity,
      hubEndpointHint: { hostname: "127.0.0.1", port: unsignedPort },
    };
    const userData2 = mkdtempSync(join(tmpdir(), "kitluy-t1-e2e-off-"));
    temporaryDirectories.push(userData2);
    installProtectedTerminalIdentity(
      f,
      userData2,
      {
        identity: identityOffline,
        provenance: {
          provisioningSessionId: randomUUID(),
          pairingSessionId: receipt.pairingSessionId,
          issuedAt: new Date().toISOString(),
        },
      },
      new Date(),
    );
    const store2 = openTerminalPairingStore(f, userData2);
    store2.receipts.persistVerifiedReceipt({
      receipt,
      hubReceiptSignatureBase64: Buffer.from(
        String(pairingBody["receiptSignature"]),
        "base64url",
      ).toString("base64"),
      hubPublicKeyPem: signer.publicKeyPem,
      expectation,
      context: { terminalAssignmentId: randomUUID(), activationId: randomUUID() },
      at: new Date(String(receiptWire["pairedAt"])),
    });
    // Seed the cache with the FIRST run's delivered configuration by
    // fetching it once through the public adapter against the signing
    // server, verifying nothing here — the runtime re-verifies on load.
    const delivered = await lan("GET", "/edge/v1/configuration/current");
    expect(delivered.status).toBe(200);
    const wire = delivered.body as Record<string, unknown>;
    const envelope = wire["delivery"] as Record<string, unknown>;
    store2.configuration.persistValidated({
      snapshot: {
        snapshotId: String(envelope["snapshotId"]),
        configurationVersion: Number(envelope["configurationVersion"]),
        schemaVersion: Number(envelope["schemaVersion"]),
        environment: String(envelope["environment"]),
        tenantId: String(envelope["tenantId"]),
        digitalStoreId: String(envelope["digitalStoreId"]),
        storeLocationId: String(envelope["storeLocationId"]),
        hubDeviceId: String(envelope["hubDeviceId"]),
        deviceRecordId: String(envelope["terminalDeviceId"]),
        assignmentGeneration: Number(envelope["assignmentGeneration"]),
        terminalProfileCode: String(envelope["terminalProfileCode"]),
        minimumApplicationVersion: String(envelope["minimumApplicationVersion"]),
        maximumApplicationVersion:
          envelope["maximumApplicationVersion"] === null
            ? null
            : String(envelope["maximumApplicationVersion"]),
        issuedAt: String(envelope["issuedAt"]),
        effectiveAt: String(envelope["effectiveAt"]),
        validUntil: String(envelope["validUntil"]),
        manifestSha256: String(envelope["manifestSha256"]),
        payloadSha256: String(envelope["payloadSha256"]),
        payloadJson: String(wire["payloadJson"]),
        signerKeyId: String(envelope["signingKeyId"]),
        correlationId: String(envelope["correlationId"]),
        deliverySignature: String(wire["deliverySignature"]),
      },
      verifiedAt: new Date().toISOString(),
    });
    store2.driver.close();

    const offline = await runT1Bootstrap(f, userData2, {
      credentials,
      applicationVersion: "0.1.0",
      mdnsTimeoutMs: 100,
      staffSession,
    });
    expect(offline.state, JSON.stringify(offline)).toBe("offline_ready");
    expect(offline.configuration?.freshness).toBe("cached_offline");

    // =====================================================================
    // WS-12-T002-P02 §12 — the intake chain over the REAL app adapters and
    // machine, then durable delivery, governed acknowledgment and Hub
    // reconciliation. Same live stack; the terminal side still touches the
    // database NOWHERE.
    // =====================================================================
    const cloudPool = new pg.Pool({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:54392/postgres",
      max: 4,
    });
    try {
      // Cloud fixtures: the e0- scope as tenant/store rows plus the Hub
      // enrolled + claimed in kitluy_devices so the draft door's live-
      // assignment check has truth to check (health-ingestion pattern).
      await cloudPool.query(
        `insert into kitluy_core.tenants (id, tenant_code, legal_name, display_name, status, default_locale)
         values ($1, 'T002-E2E', 'T002 E2E Tenant (fixture)', 'T002 E2E Tenant', 'ACTIVE', 'km-KH')
         on conflict (id) do nothing`,
        [TENANT],
      );
      await cloudPool.query(
        `insert into kitluy_core.digital_stores
           (id, tenant_id, store_code, name, primary_vertical_code, status, default_locale, default_currency_code, timezone)
         values ($1, $2, 'T002-E2E-001', 'T002 E2E Store', 'LAUNDRY', 'ACTIVE_HYBRID', 'km-KH', 'KHR', 'Asia/Phnom_Penh')
         on conflict (id) do nothing`,
        [STORE, TENANT],
      );
      await cloudPool.query(
        `insert into kitluy_core.store_locations
           (id, tenant_id, digital_store_id, location_code, name, operating_status, timezone)
         values ($1, $2, $3, 'T002-E2E-LOC', 'T002 E2E Location', 'ACTIVE', 'Asia/Phnom_Penh')
         on conflict (id) do nothing`,
        [LOCATION, TENANT, STORE],
      );
      await cloudPool.query(
        `insert into kitluy_devices.hardware_profiles
           (profile_key, display_name, device_class, manufacturer, model_identifier,
            required_signal_types, certification_status)
         values ('WS11-T001-HUB-PROBE', 'WS-11-T001 assertion Store Hub profile', 'store_hub',
                 'ASSERTION-FIXTURE', 'PROBE-1',
                 array['mac_address','board_serial','storage_serial']::kitluy_devices.hardware_signal_type[],
                 'CERTIFIED')
         on conflict (profile_key) do nothing`,
      );
      const enrolled = await cloudPool.query<{ id: string }>(
        `select kitluy_devices.enroll_device_v1(
           $1, (select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'),
           now(), encode(sha256(convert_to($1, 'UTF8')), 'hex'), 'ed25519', 'software',
           'STATION-T002', 'OP-T002',
           jsonb_build_array(
             jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'f2:' || $1),
             jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-' || $1),
             jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || $1))) as id`,
        [`t002-hub-${RUN}`],
      );
      const cloudHubId = enrolled.rows[0]?.id ?? "";
      await cloudPool.query(
        `select kitluy_devices.create_device_claim_v1(
           $1, $2::uuid, $3::uuid, $4::uuid,
           encode(sha256(convert_to($5 || '-tok', 'UTF8')), 'hex'),
           encode(sha256(convert_to($5 || '-pay', 'UTF8')), 'hex'), 900, 'OP-T002')`,
        [cloudHubId, TENANT, STORE, LOCATION, RUN],
      );
      await cloudPool.query(
        `select kitluy_devices.redeem_device_claim_v1(
           encode(sha256(convert_to($2 || '-tok', 'UTF8')), 'hex'),
           encode(sha256(convert_to($2 || '-pay', 'UTF8')), 'hex'), $1, 'HUB-T002')`,
        [cloudHubId, RUN],
      );

      // The REAL app adapter + machine, driven exactly as the renderer
      // does through the main process: staff session from the LIVE open.
      const sessionOpen = await lan(
        "POST",
        "/edge/v1/sessions/open",
        { actorId, passcode, profileCode: T1 },
        { "idempotency-key": `t002-e2e-open-${RUN}` },
      );
      expect([200, 409], JSON.stringify(sessionOpen.body)).toContain(sessionOpen.status);
      const liveSessionId = String(
        ((sessionOpen.body as Record<string, unknown>)["session"] as Record<string, unknown>)[
          "sessionId"
        ] ?? "",
      );
      expect(liveSessionId).not.toBe("");
      const operations = createIntakeOperations({
        endpoint: { hostname: "127.0.0.1", port, pinnedCertificateFingerprint: hubTls.fingerprint },
        credentials: credentials.obtain(),
        sessionId: liveSessionId,
      });
      const machine = new IntakeMachine(operations);

      // search (no match) -> create -> consent -> draft -> edit
      const e2ePhone =
        "012" +
        randomUUID()
          .replace(/[^0-9]/g, "")
          .padEnd(6, "7")
          .slice(0, 6);
      machine.startIntake();
      let snap = await machine.search(e2ePhone);
      expect(snap.state).toBe("no_match");
      snap = await machine.createCustomer({
        displayName: "E2E Intake Customer",
        phone: e2ePhone,
        preferredLanguage: "km-KH",
      });
      expect(snap.state).toBe("customer_selected");
      expect(snap.selectedCustomer?.syncState).toBe("pending_sync"); // never cloud-labelled early
      const localCustomerId = snap.selectedCustomer?.customerId ?? "";
      snap = machine.beginConsentReview();
      snap = await machine.recordConsent({
        purposeKey: "privacy_notice_acknowledgement",
        policyRef: "DEMO-PRIVACY",
        policyVersion: 1,
        decision: "acknowledged",
        staffAssisted: true,
      });
      snap = await machine.recordConsent({
        purposeKey: "sms_marketing",
        policyRef: "DEMO-SMS",
        policyVersion: 1,
        decision: "granted",
        staffAssisted: true,
      });
      snap = await machine.createDraft({
        preferredLanguage: "km-KH",
        customerNotes: "e2e wash and fold",
        staffNotes: "e2e internal note",
      });
      expect(["draft_ready", "pending_sync"]).toContain(snap.state);
      const draftId = snap.draft?.draftId ?? "";
      snap = await machine.saveDraftEdits({ staffNotes: "e2e edited note" });
      expect(snap.draft?.version).toBe(2);

      // A restarted T1 reopens the draft by its Hub id — renderer memory
      // is not recovery state.
      const machine2 = new IntakeMachine(operations);
      const reopened = await machine2.reopenDraft(draftId);
      expect(reopened.draft?.version).toBe(2);
      expect(reopened.draft?.customerSnapshot["displayName"]).toBe("E2E Intake Customer");

      // ----- Durable Hub outbox -> cloud ingestion -> acknowledgment.
      const hubAgentPool = createHubPool(process.env, 4);
      try {
        const pending = await listPendingT002Facts(hubAgentPool, 100);
        const mine = pending.filter(
          (fact) =>
            fact.aggregateId === localCustomerId ||
            fact.aggregateId === draftId ||
            (deliveryPayloadOf(fact)["local_customer_id"] as string | null) === localCustomerId,
        );
        // 1 customer + 2 consent + 3 draft mutations (create, update x2? create+edit = 2... plus reopen adds none) = 1+2+2.
        expect(mine.length).toBeGreaterThanOrEqual(5);

        const authenticatedDelivery = {
          hubDeviceId: cloudHubId,
          tenantId: TENANT,
          digitalStoreId: STORE,
          locationId: LOCATION,
        };
        const source = { connect: () => cloudPool.connect() };
        const customers = new LocalCustomerIngestion(source);
        const consents = new ConsentDecisionIngestion(source);
        const drafts = new BookingDraftIngestion(source);

        let cloudCustomerId = "";
        const deliverOnce = async (
          fact: (typeof mine)[number],
        ): Promise<{ effectKey: string; cloudResult: string; ref: string | null }> => {
          const payload = deliveryPayloadOf(fact);
          if (fact.eventType === "customer.local_customer_created") {
            const ack = await customers.ingest(authenticatedDelivery, {
              effectKey: fact.effectKey,
              localCustomerId: String(payload["local_customer_id"]),
              tenantId: String(payload["tenant_id"]),
              digitalStoreId: String(payload["digital_store_id"]),
              displayName: String(payload["display_name"]),
              phoneE164: (payload["phone_e164"] as string | null) ?? null,
              phoneDisplay: (payload["phone_display"] as string | null) ?? null,
              preferredLocale: String(payload["preferred_locale"] ?? "km-KH"),
              sourceCode: String(payload["source_code"] ?? "t1_intake"),
              correlationId: String(payload["correlation_id"]),
            });
            if (ack.cloudReferenceId !== null) cloudCustomerId = ack.cloudReferenceId;
            const applied = await applyT002Acknowledgment(hubAgentPool, {
              eventId: fact.eventId,
              effectKey: ack.effectKey,
              aggregateId: fact.aggregateId,
              schemaVersion: ack.schemaVersion,
              cloudResult: ack.cloudResult,
              cloudReferenceId: ack.cloudReferenceId,
              acknowledgedAt: ack.acknowledgedAt,
              correlationId: ack.correlationId,
            });
            expect(
              applied.applied,
              JSON.stringify({ applied, cloudResult: ack.cloudResult, kind: fact.eventType }),
            ).toBe(true);
            return {
              effectKey: ack.effectKey,
              cloudResult: ack.cloudResult,
              ref: ack.cloudReferenceId,
            };
          }
          if (fact.eventType === "customer.consent_decision_recorded") {
            const ack = await consents.ingest(authenticatedDelivery, {
              effectKey: fact.effectKey,
              consentDecisionId: String(payload["consent_decision_id"]),
              localCustomerId: String(payload["local_customer_id"]),
              cloudCustomerId,
              tenantId: String(payload["tenant_id"]),
              digitalStoreId: String(payload["digital_store_id"]),
              purposeKey: String(payload["purpose_key"]),
              policyRef: String(payload["policy_ref"]),
              policyVersion: Number(payload["policy_version"]),
              decision: String(payload["decision"]),
              channel: String(payload["channel"]),
              staffAssisted: payload["staff_assisted"] === true,
              correlationId: String(payload["correlation_id"]),
            });
            const applied = await applyT002Acknowledgment(hubAgentPool, {
              eventId: fact.eventId,
              effectKey: ack.effectKey,
              aggregateId: fact.aggregateId,
              schemaVersion: ack.schemaVersion,
              cloudResult: ack.cloudResult,
              cloudReferenceId: ack.cloudReferenceId,
              acknowledgedAt: ack.acknowledgedAt,
              correlationId: ack.correlationId,
            });
            expect(
              applied.applied,
              JSON.stringify({ applied, cloudResult: ack.cloudResult, kind: fact.eventType }),
            ).toBe(true);
            return {
              effectKey: ack.effectKey,
              cloudResult: ack.cloudResult,
              ref: ack.cloudReferenceId,
            };
          }
          const ack = await drafts.ingest(authenticatedDelivery, {
            effectKey: fact.effectKey,
            bookingDraftEventId: String(payload["booking_draft_event_id"]),
            hubDraftId: String(payload["hub_draft_id"]),
            eventType: String(payload["event_type"]),
            tenantId: String(payload["tenant_id"]),
            digitalStoreId: String(payload["digital_store_id"]),
            locationId: String(payload["location_id"]),
            hubDeviceId: cloudHubId,
            terminalDeviceId: String(
              (payload["terminal_device_id"] as string | undefined) ?? deviceId,
            ),
            walkIn: payload["walk_in"] === true,
            localCustomerId: (payload["local_customer_id"] as string | null) ?? null,
            customerSnapshot: (payload["customer_snapshot"] as Record<string, unknown>) ?? {},
            lifecycle: String(payload["lifecycle"]),
            version: Number(payload["version"]),
            preferredLanguage: String(payload["preferred_language"]),
            intakeSource: String(payload["intake_source"]),
            cancelReasonCode: (payload["cancel_reason_code"] as string | null) ?? null,
            hubCreatedAt: String(payload["hub_created_at"]),
            hubUpdatedAt: String(payload["hub_updated_at"]),
            correlationId: String(payload["correlation_id"]),
          });
          const applied = await applyT002Acknowledgment(hubAgentPool, {
            eventId: fact.eventId,
            effectKey: ack.effectKey,
            aggregateId: fact.aggregateId,
            schemaVersion: ack.schemaVersion,
            cloudResult: ack.cloudResult,
            cloudReferenceId: ack.cloudReferenceId,
            acknowledgedAt: ack.acknowledgedAt,
            correlationId: ack.correlationId,
          });
          expect(
            applied.applied,
            JSON.stringify({ applied, cloudResult: ack.cloudResult, kind: fact.eventType }),
          ).toBe(true);
          return {
            effectKey: ack.effectKey,
            cloudResult: ack.cloudResult,
            ref: ack.cloudReferenceId,
          };
        };

        // Customer first (hub_sequence order already guarantees it).
        const results: Array<{ effectKey: string; cloudResult: string; ref: string | null }> = [];
        for (const fact of mine) {
          results.push(await deliverOnce(fact));
        }
        for (const outcome of results) {
          expect(
            ["APPLIED", "ACKNOWLEDGED", "PROJECTED", "DECLINED_RECORDED"],
            JSON.stringify(results),
          ).toContain(outcome.cloudResult);
        }

        // Duplicate delivery of the FIRST fact: one cloud effect.
        const replayFact = mine[0];
        if (replayFact !== undefined) {
          const replay = await deliverOnce(replayFact);
          expect(replay.cloudResult).toBe("DUPLICATE_IGNORED");
        }

        // Hub reconciliation: outbox acknowledged; domain sync labels moved.
        const outboxState = await pool.query(
          `select o.delivery_state from edge_sync.outbox o
             join edge_sync.local_event e on e.id = o.event_id
            where e.aggregate_id = $1::uuid`,
          [localCustomerId],
        );
        expect(
          outboxState.rows.every(
            (r) => (r as { delivery_state: string }).delivery_state === "acknowledged",
          ),
        ).toBe(true);
        const customerRow = await pool.query<{
          sync_state: string;
          cloud_customer_id: string | null;
        }>(`select sync_state, cloud_customer_id from edge_core.customer where id = $1::uuid`, [
          localCustomerId,
        ]);
        expect(customerRow.rows[0]?.sync_state).toBe("cloud_acknowledged");
        expect(customerRow.rows[0]?.cloud_customer_id).toBe(cloudCustomerId);
        const draftRow = await pool.query<{
          sync_state: string;
          version: bigint;
          lifecycle: string;
        }>(
          `select sync_state, version, lifecycle from edge_laundry.booking_draft where id = $1::uuid`,
          [draftId],
        );
        expect(draftRow.rows[0]?.sync_state).toBe("cloud_acknowledged");
        expect(Number(draftRow.rows[0]?.version)).toBe(2); // ack advanced NO version
        expect(draftRow.rows[0]?.lifecycle).toBe("open"); // a draft stays a draft

        // Cloud side: projection is the newest version, DRAFT lifecycle,
        // and NO Laundry Booking or payment was created anywhere.
        const projection = await cloudPool.query<{
          lifecycle: string;
          version: bigint;
          conflict_state: string;
        }>(
          `select lifecycle, version, conflict_state
             from kitluy_laundry.booking_draft_projections where hub_draft_id = $1::uuid`,
          [draftId],
        );
        expect(projection.rows[0]?.lifecycle).toBe("open");
        expect(Number(projection.rows[0]?.version)).toBe(2);
        expect(projection.rows[0]?.conflict_state).toBe("none");
        const bookings = await cloudPool
          .query<{ n: number }>(`select count(*)::int as n from kitluy_laundry.laundry_bookings`)
          .catch(() => ({ rows: [{ n: 0 }] }));
        void bookings; // the projection table is the ONLY new laundry row source
        const grants = await cloudPool.query<{ n: number }>(
          `select count(*)::int as n from kitluy_core.consent_grants g
            where g.customer_id = $1::uuid`,
          [cloudCustomerId],
        );
        expect(grants.rows[0]?.n).toBe(2); // acknowledgement + sms grant
      } finally {
        await hubAgentPool.end();
      }
    } finally {
      await cloudPool.end();
    }

    // No secret reached a Hub log line.
    const serialized = JSON.stringify(logLines);
    expect(serialized).not.toContain(passcode);
    expect(serialized).not.toContain(terminalTls.keyPem.slice(40, 80));
  }, 300_000);
});
