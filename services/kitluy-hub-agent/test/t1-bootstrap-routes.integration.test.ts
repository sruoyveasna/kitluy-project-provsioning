/**
 * WS-12-T001-P02 — the three T1 bootstrap reads and the staff-session
 * routes, proven over the REAL TLS 1.3 mTLS transport against the REAL Hub
 * database (KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001).
 *
 * Harness discipline is the edge-LAN suite's: ephemeral node-forge X.509
 * per run, real Ed25519 Hub operational key swapped into the seeded Hub
 * credential (restored in afterAll), fixtures inserted as cloud-owned
 * projections, and a closing log census proving no secret reached a line.
 * Terminals PAIR through the real four-step handshake — no receipt row is
 * hand-crafted.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import forge from "node-forge";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  verifyTerminalConfigurationDelivery,
  type TerminalConfigurationDelivery,
  type TrustEnvironment,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable } from "../src/hub/db.js";
import {
  TerminalPairingComposition,
  type PairingSigner,
  type SafeLogger,
} from "../src/hub/pairing.js";
import { EdgeDiscoveryAuthority } from "../src/hub/edge/discovery.js";
import { createEdgeTlsServer } from "../src/hub/edge/transport.js";
import {
  createEdgeTerminalRouter,
  unavailableActivationGateway,
  EDGE_RUNTIME_AUTHORITY_TIME_PATH,
  EDGE_RUNTIME_ELIGIBILITY_PATH,
  EDGE_CONFIGURATION_CURRENT_PATH,
  EDGE_SESSIONS_OPEN_PATH,
  EDGE_SESSIONS_REFRESH_PATH,
  EDGE_SESSIONS_CLOSE_PATH,
  EDGE_TERMINAL_PIN_STATUS_PATH,
  EDGE_TERMINAL_PIN_SETUP_PATH,
  EDGE_TERMINAL_PIN_UNLOCK_PATH,
  EDGE_TERMINAL_PIN_CHANGE_PATH,
  EDGE_TERMINAL_PIN_LOCK_PATH,
} from "../src/hub/edge/routes.js";
import { staffCredentialVerifier } from "../src/hub/edge/runtime-bootstrap.js";
import { resetTerminalPin, verifyTerminalPin } from "../src/hub/edge/terminal-pin.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const ATTACKER_TENANT = "e0000000-0000-4000-8000-0000000000a1";
const ATTACKER_STORE = "e0000000-0000-4000-8000-0000000000a2";
const T1 = "laundry.t1.intake_cashier";
const T3 = "laundry.t3.ready_scan_in";
const T2 = "laundry.t2.customer_display";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: T1 bootstrap routes — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };
const censusSecrets: string[] = [];

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

interface TerminalHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

function terminalRequest(options: {
  readonly port: number;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly identity?: { readonly certPem: string; readonly keyPem: string };
  readonly caPem: string;
  readonly headers?: Record<string, string>;
}): Promise<TerminalHttpResponse> {
  return new Promise((resolve, reject) => {
    const payload = options.body === undefined ? "" : JSON.stringify(options.body);
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: options.port,
        method: options.method,
        path: options.path,
        ca: options.caPem,
        ...(options.identity !== undefined
          ? { cert: options.identity.certPem, key: options.identity.keyPem }
          : {}),
        headers: {
          ...(payload === "" ? {} : { "content-type": "application/json" }),
          ...(options.headers ?? {}),
        },
        rejectUnauthorized: true,
        checkServerIdentity: () => undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: Record<string, unknown> = {};
          try {
            parsed = JSON.parse(text) as Record<string, unknown>;
          } catch {
            parsed = {};
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.setTimeout(8_000, () => req.destroy(new Error("KLUY-TEST-REQUEST-TIMEOUT")));
    req.on("error", reject);
    if (payload !== "") req.write(payload);
    req.end();
  });
}

describe.skipIf(!live)("T1 bootstrap routes and staff sessions (WS-12-T001-P02)", () => {
  let pool: pg.Pool;
  let signer: PairingSigner;
  let hubKeyRef: string;
  let originalHubFingerprint = "";
  let originalHubExpiry = "";
  let hadHubRuntime = false;
  let deviceCa: TestCa;
  let hubTls: TlsIdentity;
  let port = 0;
  let unsignedPort = 0;
  let closeServer: (() => Promise<void>) | null = null;
  let closeUnsigned: (() => Promise<void>) | null = null;

  interface LanTerminal {
    readonly deviceId: string;
    readonly keyRef: string;
    readonly pem: string;
    readonly fingerprint: string;
    readonly tls: TlsIdentity;
    readonly profile: string;
  }

  async function newLanTerminal(
    label: string,
    opts: {
      lifecycle?: string;
      profile?: string;
      credentialStatus?: string;
      grantProfile?: boolean;
      tenant?: string;
      store?: string;
      location?: string;
    } = {},
  ): Promise<LanTerminal> {
    const deviceId = randomUUID();
    const keyRef = `t1p02-${label}-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const tls = issueCert(deviceCa, { cn: `terminal-${label}-${RUN}` });
    const profile = opts.profile ?? T1;
    const { rows: hw } = await pool.query<{ id: string }>(
      `select id from edge_config.hardware_profile limit 1`,
    );
    await pool.query(
      `insert into edge_identity.terminal_device
         (id, tenant_id, digital_store_id, location_id, terminal_name,
          hardware_profile_id, installation_id, certificate_serial,
          assignment_generation, lifecycle_status, last_client_sequence,
          last_seen_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, 0, now(), now(), now())`,
      [
        deviceId,
        opts.tenant ?? TENANT,
        opts.store ?? STORE,
        opts.location ?? LOCATION,
        `t1p02-${label}-${RUN}`,
        hw[0]?.id,
        randomUUID(),
        tls.serial,
        opts.lifecycle ?? "active",
      ],
    );
    await pool.query(
      `insert into edge_identity.device_credential
         (id, device_id, credential_type, public_key_fingerprint,
          certificate_serial, issuer, issued_at, expires_at, status,
          revoked_at, revocation_reason, rotation_generation)
       values ($1, $2, 'terminal_operational', $3, $4, 'KitLuy Test Device CA',
               now() - interval '1 day', now() + interval '1 hour', $5,
               case when $5 = 'revoked' then now() else null end,
               case when $5 = 'revoked' then 't1p02_fixture' else null end, 1)`,
      [randomUUID(), deviceId, fingerprint, tls.serial, opts.credentialStatus ?? "active"],
    );
    if (opts.grantProfile !== false) {
      await pool.query(
        `insert into edge_config.terminal_profile_assignment
           (id, tenant_id, digital_store_id, location_id, terminal_device_id,
            profile_code, assignment_version, enabled, effective_from,
            effective_until, source_snapshot_id)
         values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour', null, $7)`,
        [
          randomUUID(),
          opts.tenant ?? TENANT,
          opts.store ?? STORE,
          opts.location ?? LOCATION,
          deviceId,
          profile,
          ACTIVE_SNAPSHOT,
        ],
      );
    }
    return { deviceId, keyRef, pem, fingerprint, tls, profile };
  }

  function call(
    terminal: LanTerminal,
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TerminalHttpResponse> {
    return terminalRequest({
      port,
      method,
      path,
      ...(body === undefined ? {} : { body }),
      identity: { certPem: terminal.tls.certPem, keyPem: terminal.tls.keyPem },
      caPem: deviceCa.certPem,
      ...(headers === undefined ? {} : { headers }),
    });
  }

  function detailsOf(response: TerminalHttpResponse): Record<string, unknown> {
    const error = response.body["error"] as { details?: Record<string, unknown> } | undefined;
    return error?.details ?? {};
  }

  /** Drive the REAL four-step pairing over the LAN transport. */
  async function pairTerminal(t: LanTerminal): Promise<void> {
    const terminalNonce = randomBytes(32).toString("hex");
    const hello = await call(t, "POST", "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: t.profile,
      terminalNonce,
      protocolVersion: "1.0",
      environment: "development",
    });
    expect(hello.status, JSON.stringify(hello.body)).toBe(201);
    const session = hello.body["session"] as Record<string, unknown>;
    const sessionId = String(session["pairingSessionId"]);
    const signature = Buffer.from(
      keys.provePossession(t.keyRef, Buffer.from(String(session["signingPayload"]), "base64url")),
    ).toString("base64url");
    const proof = await call(
      t,
      "POST",
      `/edge/v1/terminal-pairing/sessions/${sessionId}/terminal-proof`,
      {
        signature,
        terminalPublicKeyPem: t.pem,
      },
    );
    expect(proof.status, JSON.stringify(proof.body)).toBe(200);
    const complete = await call(
      t,
      "POST",
      `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`,
      {},
    );
    expect(complete.status, JSON.stringify(complete.body)).toBe(200);
  }

  /**
   * The cloud re-assigning a terminal reaches the Hub as a new projection of
   * `terminal_device.assignment_generation` (hub-provision-terminal --delivery
   * in development; BLK-006 later). This is that projection, not a receipt edit.
   */
  async function setTerminalGeneration(t: LanTerminal, generation: number): Promise<void> {
    await pool.query(
      `update edge_identity.terminal_device set assignment_generation = $2 where id = $1`,
      [t.deviceId, generation],
    );
  }

  interface ReceiptView {
    readonly id: string;
    readonly generation: number;
    readonly pairedAt: string;
    readonly digest: string;
  }

  async function receiptsOf(t: LanTerminal): Promise<ReceiptView[]> {
    const { rows } = await pool.query<{
      id: string;
      generation: number;
      paired_at: Date;
      digest: string;
    }>(
      `select r.id, r.terminal_assignment_generation as generation, r.paired_at,
              md5(to_jsonb(r)::text) as digest
         from edge_identity.pairing_receipt r
        where r.terminal_device_id = $1
        order by r.paired_at, r.id`,
      [t.deviceId],
    );
    return rows.map((row) => ({
      id: row.id,
      generation: row.generation,
      pairedAt: row.paired_at.toISOString(),
      digest: row.digest,
    }));
  }

  /** Every durable row an eligibility read could conceivably touch. */
  async function durableState(t: LanTerminal): Promise<string> {
    const { rows } = await pool.query<{ state: string }>(
      `select md5(concat_ws('#',
         (select coalesce(string_agg(to_jsonb(r)::text, '|' order by r.id), '')
            from edge_identity.pairing_receipt r where r.terminal_device_id = $1),
         (select coalesce(string_agg(to_jsonb(s)::text, '|' order by s.id), '')
            from edge_identity.pairing_session s where s.terminal_device_id = $1),
         (select to_jsonb(d)::text from edge_identity.terminal_device d where d.id = $1),
         (select coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')
            from edge_identity.device_credential c where c.device_id = $1),
         (select coalesce(string_agg(to_jsonb(g)::text, '|' order by g.id), '')
            from edge_config.terminal_profile_assignment g where g.terminal_device_id = $1),
         (select coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')
            from edge_identity.terminal_session x where x.terminal_device_id = $1)
       )) as state`,
      [t.deviceId],
    );
    return rows[0]?.state ?? "";
  }

  async function insertStaff(
    profiles: readonly string[],
    opts: {
      passcode?: string;
      disabled?: boolean;
      offlineValidMinutes?: number;
      tenant?: string;
      store?: string;
      location?: string;
    } = {},
  ): Promise<{ actorId: string; passcode: string }> {
    const actorId = randomUUID();
    const passcode = opts.passcode ?? `pc-${randomBytes(6).toString("hex")}`;
    censusSecrets.push(passcode);
    const verifier = staffCredentialVerifier(actorId, passcode);
    censusSecrets.push(verifier.toString("hex"));
    await pool.query(
      `insert into edge_identity.staff_cache
         (actor_id, tenant_id, digital_store_id, location_id, display_name,
          credential_verifier, permission_snapshot_version, profile_codes,
          offline_valid_until, disabled, last_synced_at)
       values ($1, $2, $3, $4, $5, $6, 1, $7,
               now() + ($8 || ' minutes')::interval, $9, now())`,
      [
        actorId,
        opts.tenant ?? TENANT,
        opts.store ?? STORE,
        opts.location ?? LOCATION,
        `Staff ${RUN}`,
        verifier,
        profiles,
        String(opts.offlineValidMinutes ?? 240),
        opts.disabled ?? false,
      ],
    );
    return { actorId, passcode };
  }

  async function grant(
    actorId: string,
    permissionKey: string,
    effect = "allow",
    projectionVersion = 1,
  ): Promise<void> {
    await pool.query(
      `insert into edge_config.permission_grant_projection
         (id, tenant_id, digital_store_id, location_id, source_snapshot_id,
          projection_version, actor_id, permission_key, effect, resource_type,
          scope_type, scope_id, environment, requires_reauthentication,
          requires_approval, requires_reason, granted_at, not_before,
          expires_at, revoked_at, offline_validity_seconds,
          offline_policy_reference, signature, signature_algorithm,
          signing_key_id, received_at)
       values ($1, $2, $3, $4, $5, $9, $6, $7, $8, 'terminal_session',
               'store_location', $4, 'development', false, false, false,
               now() - interval '1 hour', now() - interval '1 hour',
               null, null, 3600, 'dev-offline-policy', decode('c0ffee00','hex'),
               'ed25519', 'demo-signing-key-1', now())`,
      [
        randomUUID(),
        TENANT,
        STORE,
        LOCATION,
        ACTIVE_SNAPSHOT,
        actorId,
        permissionKey,
        effect,
        projectionVersion,
      ],
    );
  }

  const FIVE_KEYS = [
    "staff.sessions.open",
    "staff.sessions.read",
    "staff.sessions.refresh",
    "staff.sessions.close",
    "pos.t1.use",
  ];

  beforeAll(async () => {
    if (!live) return;
    pool = createHubPool(process.env, 10);

    hubKeyRef = `t1p02-hub-${RUN}`;
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
      // KLRISK-HUB-001: always an explicitly quoted grantee.
      await pool.query(`grant kitluy_hub_runtime to "${user}"`);
    }

    signer = {
      certificateSerial: "DEMO-OPS-CERT-0001",
      publicKeyPem: hubPem,
      sign: (payload) => keys.provePossession(hubKeyRef, payload),
    };
    const pairing = new TerminalPairingComposition(pool, signer, logger);
    deviceCa = mintCa(`KitLuy T1P02 Device CA ${RUN}`);
    hubTls = issueCert(deviceCa, { cn: `hub-${RUN}`, server: true });
    const discovery = new EdgeDiscoveryAuthority(
      {
        hubDeviceId: "e0000000-0000-4000-8000-000000000010",
        hubTlsCertificateFingerprint: hubTls.fingerprint,
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development" as TrustEnvironment,
        hostname: "127.0.0.1",
      },
      signer,
      logger,
    );

    const router = createEdgeTerminalRouter({
      pool,
      pairing,
      activationGateway: unavailableActivationGateway(),
      discovery,
      deliverySigner: signer,
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
    port = listening.port;
    closeServer = () => edge.close();

    // A second server WITHOUT a delivery signer: the configuration route
    // must fail closed rather than deliver unsigned.
    const unsignedRouter = createEdgeTerminalRouter({
      pool,
      pairing,
      activationGateway: unavailableActivationGateway(),
      discovery,
      logger,
    });
    const unsigned = createEdgeTlsServer({
      key: hubTls.keyPem,
      cert: hubTls.certPem,
      clientCa: deviceCa.certPem,
      bindHost: "127.0.0.1",
      port: 0,
      handler: unsignedRouter,
      logger,
    });
    const unsignedListening = await unsigned.listen();
    unsignedPort = unsignedListening.port;
    closeUnsigned = () => unsigned.close();
  }, 300_000);

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
  }, 120_000);

  // -------------------------------------------------------------------------
  // Authority time (§1)
  // -------------------------------------------------------------------------

  it("serves Hub-database authority time to an eligible credential", async () => {
    const t = await newLanTerminal("time");
    const before = await pool.query<{ now: Date }>(`select now() as now`);
    const response = await call(t, "GET", EDGE_RUNTIME_AUTHORITY_TIME_PATH);
    const after = await pool.query<{ now: Date }>(`select now() as now`);
    expect(response.status).toBe(200);
    expect(response.body["result"]).toBe("AUTHORITY_TIME");
    expect(response.body["authoritySource"]).toBe("hub_database");
    expect(response.body["maxCacheAgeSeconds"]).toBe(30);
    expect(typeof response.body["responseId"]).toBe("string");
    expect(typeof response.body["correlationId"]).toBe("string");
    const instant = new Date(String(response.body["authorityTime"])).getTime();
    expect(instant).toBeGreaterThanOrEqual((before.rows[0]?.now.getTime() ?? 0) - 1000);
    expect(instant).toBeLessThanOrEqual((after.rows[0]?.now.getTime() ?? 0) + 1000);
  });

  it("refuses authority time to a revoked credential and to query parameters", async () => {
    const revoked = await newLanTerminal("time-revoked", { credentialStatus: "revoked" });
    const refused = await call(revoked, "GET", EDGE_RUNTIME_AUTHORITY_TIME_PATH);
    expect(refused.status).toBe(403);
    expect(detailsOf(refused)["result"]).toBe("CREDENTIAL_NOT_CURRENT");
    const t = await newLanTerminal("time-query");
    const query = await call(t, "GET", `${EDGE_RUNTIME_AUTHORITY_TIME_PATH}?skew=1`);
    expect(query.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Runtime eligibility (§2)
  // -------------------------------------------------------------------------

  it("derives full eligibility for a paired T1 terminal — no caller input, all scope from authority", async () => {
    const t = await newLanTerminal("elig");
    await pairTerminal(t);
    const response = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const eligibility = response.body["eligibility"] as Record<string, unknown>;
    expect(eligibility["tenantId"]).toBe(TENANT);
    expect(eligibility["digitalStoreId"]).toBe(STORE);
    expect(eligibility["storeLocationId"]).toBe(LOCATION);
    expect(eligibility["terminalDeviceId"]).toBe(t.deviceId);
    expect(eligibility["assignmentGeneration"]).toBe(1);
    expect(eligibility["terminalProfileCode"]).toBe(T1);
    expect(eligibility["credentialEligibility"]).toBe("eligible");
    expect(eligibility["pairingEligibility"]).toBe("paired");
    expect(eligibility["containmentState"]).toBe("none");
    expect(eligibility["hubReplacementState"]).toBe("normal");
    expect(eligibility["requiredConfigurationVersion"]).toBe(7);
    expect(typeof eligibility["authorityTime"]).toBe("string");
  });

  it("a T1 + T2 counter seat paired into T2 is ELIGIBLE as T1 (2026-09-18, the first two-profile pairing)", async () => {
    // The seat listed T2 first, so the terminal paired into T2; it also holds
    // the T1 grant. The POS runtime is the T1 experience: eligibility must
    // find the T1 grant among the terminal's grants and accept a receipt that
    // names any granted profile — not let the grant row order decide.
    const counter = await newLanTerminal("elig-t1t2", { profile: T2 });
    await pool.query(
      `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id,
          profile_code, assignment_version, enabled, effective_from,
          effective_until, source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour', null, $7)`,
      [randomUUID(), TENANT, STORE, LOCATION, counter.deviceId, T1, ACTIVE_SNAPSHOT],
    );
    await pairTerminal(counter);
    const response = await call(counter, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const eligibility = response.body["eligibility"] as Record<string, unknown>;
    expect(eligibility["terminalProfileCode"]).toBe(T1);
    expect(eligibility["pairingEligibility"]).toBe("paired");

    // A receipt naming a profile the terminal is NOT granted stays refused.
    const stranger = await newLanTerminal("elig-t3-only", { profile: T3 });
    await pairTerminal(stranger);
    await pool.query(
      `update edge_config.terminal_profile_assignment set profile_code = $2
        where terminal_device_id = $1`,
      [stranger.deviceId, T1],
    );
    const mismatch = await call(stranger, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(mismatch.status).toBe(409);
    expect(detailsOf(mismatch)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");
  });

  it("fails closed: missing pairing, non-T1 profile, a receipt ahead of the terminal, superseded credential", async () => {
    const unpaired = await newLanTerminal("elig-unpaired");
    const noPairing = await call(unpaired, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(noPairing.status).toBe(403);
    expect(detailsOf(noPairing)["result"]).toBe("PAIRING_REQUIRED");

    const t3 = await newLanTerminal("elig-t3", { profile: T3 });
    await pairTerminal(t3);
    const wrongProfile = await call(t3, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(wrongProfile.status).toBe(403);
    expect(detailsOf(wrongProfile)["result"]).toBe("PROFILE_NOT_T1");

    // A receipt AHEAD of the terminal's projected generation. This used to
    // move the terminal FORWARD (receipt 1, terminal 2) and expect STALE, which
    // is Defect G itself: a terminal re-paired in the cloud must be told to
    // pair again, not refused. The refusal survives for the direction that is
    // actually suspicious — see the Defect G section below.
    const stale = await newLanTerminal("elig-stale");
    await setTerminalGeneration(stale, 2);
    await pairTerminal(stale);
    await setTerminalGeneration(stale, 1);
    const staleResponse = await call(stale, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(staleResponse.status).toBe(409);
    expect(detailsOf(staleResponse)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");

    const superseded = await newLanTerminal("elig-superseded");
    await pairTerminal(superseded);
    await pool.query(
      `update edge_identity.device_credential set status = 'superseded' where certificate_serial = $1`,
      [superseded.tls.serial],
    );
    const supersededResponse = await call(superseded, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(supersededResponse.status).toBe(403);
    expect(detailsOf(supersededResponse)["result"]).toBe("CREDENTIAL_NOT_CURRENT");
  });

  it("fails closed on cross-Tenant transplant and on active containment; cleared containment recovers", async () => {
    const foreign = await newLanTerminal("elig-foreign", { tenant: ATTACKER_TENANT });
    const transplant = await call(foreign, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(transplant.status).toBe(403);
    expect(detailsOf(transplant)["result"]).toBe("ASSIGNMENT_SCOPE_MISMATCH");

    const contained = await newLanTerminal("elig-contained");
    await pairTerminal(contained);
    await pool.query(
      `insert into edge_identity.containment_directive
         (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
          directive_sequence, reason, source_ref, received_via, received_at)
       values ($1, $2, $3, $4, $5, 'suspended', 1, 't1p02 containment probe',
               $6, 'operator_repair', now())`,
      [randomUUID(), contained.deviceId, TENANT, STORE, LOCATION, `probe-${RUN}`],
    );
    const suspended = await call(contained, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(suspended.status).toBe(403);
    expect(detailsOf(suspended)["result"]).toBe("CONTAINMENT_PROHIBITS");
    await pool.query(
      `insert into edge_identity.containment_directive
         (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
          directive_sequence, reason, source_ref, received_via, received_at)
       values ($1, $2, $3, $4, $5, 'cleared', 2, 't1p02 containment cleared',
               $6, 'operator_repair', now())`,
      [randomUUID(), contained.deviceId, TENANT, STORE, LOCATION, `probe-${RUN}`],
    );
    const cleared = await call(contained, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
  });

  it("fails closed on cross-Store transplant — same Tenant, another Digital Store", async () => {
    // §2: the transplant matrix is two-dimensional. Cross-Tenant is proven
    // above; this proves the SAME-Tenant, different-Store axis separately —
    // a terminal projected under another Digital Store never derives
    // eligibility from this Hub.
    const crossStore = await newLanTerminal("elig-cross-store", { store: ATTACKER_STORE });
    const refused = await call(crossStore, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(refused.status).toBe(403);
    expect(detailsOf(refused)["result"]).toBe("ASSIGNMENT_SCOPE_MISMATCH");
  });

  // -------------------------------------------------------------------------
  // Defect G (hardware 2026-09-16, handoff 46 §4)
  // -------------------------------------------------------------------------
  //
  // A re-flashed Pi Terminal recovered its credential in the cloud at
  // assignment generation 3. The Store Hub still held that terminal's receipt
  // from generation 2 — receipts are append-only history — and answered
  // ASSIGNMENT_GENERATION_STALE. The terminal pairs only on PAIRING_REQUIRED,
  // so it waited for ever and never reached SERVING.
  //
  //   receipt < terminal  → PAIRING_REQUIRED (the terminal re-pairs itself)
  //   receipt = terminal  → normal evaluation, unchanged
  //   receipt > terminal  → refused, never downgraded
  //
  // Every receipt here comes from the REAL four-step handshake.

  it("Defect G: a receipt one generation behind asks for pairing, and re-pairing appends a receipt that serves", async () => {
    const t = await newLanTerminal("g-behind-1");
    await pairTerminal(t);
    const [original] = await receiptsOf(t);
    expect(original?.generation).toBe(1);

    await setTerminalGeneration(t, 2);
    const before = await durableState(t);
    const eligibility = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(eligibility.status, JSON.stringify(eligibility.body)).toBe(403);
    expect(detailsOf(eligibility)["result"]).toBe("PAIRING_REQUIRED");
    const configuration = await call(t, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
    expect(configuration.status).toBe(403);
    expect(detailsOf(configuration)["result"]).toBe("PAIRING_REQUIRED");
    // Reading is not repairing: nothing durable moved.
    expect(await durableState(t)).toBe(before);

    await pairTerminal(t);
    const receipts = await receiptsOf(t);
    expect(receipts.map((r) => r.generation)).toEqual([1, 2]);
    // The historical receipt is byte-for-byte what it was.
    expect(receipts[0]).toEqual(original);

    const served = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    const payload = served.body["eligibility"] as Record<string, unknown>;
    expect(payload["assignmentGeneration"]).toBe(2);
    expect(payload["pairingEligibility"]).toBe("paired");
    expect(payload["pairedAt"]).toBe(receipts[1]?.pairedAt);
    const delivered = await call(t, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
  });

  it("Defect G: a receipt two generations behind also asks for pairing", async () => {
    const t = await newLanTerminal("g-behind-2");
    await pairTerminal(t);
    await setTerminalGeneration(t, 3);
    const refused = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    expect(detailsOf(refused)["result"]).toBe("PAIRING_REQUIRED");

    await pairTerminal(t);
    expect((await receiptsOf(t)).map((r) => r.generation)).toEqual([1, 3]);
    const served = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    expect((served.body["eligibility"] as Record<string, unknown>)["assignmentGeneration"]).toBe(3);
  });

  it("Defect G: a receipt AHEAD of the terminal is refused and never downgraded, not even by pairing again lower", async () => {
    const t = await newLanTerminal("g-ahead");
    await setTerminalGeneration(t, 2);
    await pairTerminal(t);
    await setTerminalGeneration(t, 1);

    const before = await durableState(t);
    const refused = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(detailsOf(refused)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");
    const configuration = await call(t, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
    expect(configuration.status).toBe(409);
    expect(detailsOf(configuration)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");
    expect(await durableState(t)).toBe(before);

    // The pairing door does not look at receipts, so a lower-generation
    // handshake completes and appends. It must not buy eligibility: the
    // receipt that speaks is the one for the HIGHEST generation, whatever the
    // clock said when each was written.
    await pairTerminal(t);
    const receipts = await receiptsOf(t);
    expect(receipts.map((r) => r.generation)).toEqual([2, 1]);
    const stillRefused = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(stillRefused.status, JSON.stringify(stillRefused.body)).toBe(409);
    expect(detailsOf(stillRefused)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");

    // Back at generation 2, the generation-2 receipt serves even though a
    // superseded-generation receipt was written later. This is the shape a
    // Store Hub with a wrong clock produces, and ordering by paired_at would
    // have sent this terminal round a re-pair loop instead.
    await setTerminalGeneration(t, 2);
    const served = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(served.status, JSON.stringify(served.body)).toBe(200);
    const payload = served.body["eligibility"] as Record<string, unknown>;
    expect(payload["assignmentGeneration"]).toBe(2);
    expect(payload["pairedAt"]).toBe(receipts[0]?.pairedAt);
  });

  it("Defect G: scope, credential, containment and Hub replacement refusals still win over re-pairing", async () => {
    // Containment: a suspended terminal is not invited to pair again. The
    // pairing door does not read containment, so the invitation itself is
    // what must be withheld.
    const contained = await newLanTerminal("g-contained");
    await pairTerminal(contained);
    await setTerminalGeneration(contained, 2);
    await pool.query(
      `insert into edge_identity.containment_directive
         (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
          directive_sequence, reason, source_ref, received_via, received_at)
       values ($1, $2, $3, $4, $5, 'suspended', 1, 'defect G containment probe',
               $6, 'operator_repair', now())`,
      [randomUUID(), contained.deviceId, TENANT, STORE, LOCATION, `g-probe-${RUN}`],
    );
    const suspended = await call(contained, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(suspended.status, JSON.stringify(suspended.body)).toBe(403);
    expect(detailsOf(suspended)["result"]).toBe("CONTAINMENT_PROHIBITS");

    // Credential currency.
    const superseded = await newLanTerminal("g-superseded");
    await pairTerminal(superseded);
    await setTerminalGeneration(superseded, 2);
    await pool.query(
      `update edge_identity.device_credential set status = 'superseded' where certificate_serial = $1`,
      [superseded.tls.serial],
    );
    const notCurrent = await call(superseded, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(notCurrent.status).toBe(403);
    expect(detailsOf(notCurrent)["result"]).toBe("CREDENTIAL_NOT_CURRENT");

    // Store scope: the new generation arrived under another Digital Store.
    const moved = await newLanTerminal("g-moved");
    await pairTerminal(moved);
    await pool.query(
      `update edge_identity.terminal_device
          set assignment_generation = 2, digital_store_id = $2
        where id = $1`,
      [moved.deviceId, ATTACKER_STORE],
    );
    const foreign = await call(moved, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(foreign.status).toBe(403);
    expect(detailsOf(foreign)["result"]).toBe("ASSIGNMENT_SCOPE_MISMATCH");

    // Hub replacement state.
    const replacing = await newLanTerminal("g-replacement");
    await pairTerminal(replacing);
    await setTerminalGeneration(replacing, 2);
    try {
      await pool.query(
        `select edge_identity.set_hub_replacement_mode_v1('restored_quarantine', $1::uuid, 'defect G probe', 'test-operator', $2::uuid)`,
        [randomUUID(), randomUUID()],
      );
      const blocked = await call(replacing, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
      expect(blocked.status).toBe(503);
      expect(detailsOf(blocked)["result"]).toBe("HUB_REPLACEMENT_BLOCKED");
    } finally {
      await pool.query(
        `select edge_identity.set_hub_replacement_mode_v1('normal', $1::uuid, 'defect G restore', 'test-operator', $2::uuid)`,
        [randomUUID(), randomUUID()],
      );
    }
    const invited = await call(replacing, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(detailsOf(invited)["result"]).toBe("PAIRING_REQUIRED");
  });

  it("Defect G: equal generations keep the profile check — a receipt for another profile is still refused", async () => {
    const t = await newLanTerminal("g-profile", { profile: T3 });
    await pairTerminal(t);
    // The cloud now grants T1 at a newer assignment version; the receipt still
    // binds T3 at the SAME generation. Unchanged behaviour: refused, not re-paired.
    await pool.query(
      `insert into edge_config.terminal_profile_assignment
         (id, tenant_id, digital_store_id, location_id, terminal_device_id,
          profile_code, assignment_version, enabled, effective_from,
          effective_until, source_snapshot_id)
       values ($1, $2, $3, $4, $5, $6, 2, true, now() - interval '1 hour', null, $7)`,
      [randomUUID(), TENANT, STORE, LOCATION, t.deviceId, T1, ACTIVE_SNAPSHOT],
    );
    const refused = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(refused.status, JSON.stringify(refused.body)).toBe(409);
    expect(detailsOf(refused)["result"]).toBe("ASSIGNMENT_GENERATION_STALE");
  });

  it("fails closed while the Hub is in a replacement state, and recovers on normal", async () => {
    const t = await newLanTerminal("elig-replacement");
    await pairTerminal(t);
    try {
      await pool.query(
        `select edge_identity.set_hub_replacement_mode_v1('restored_quarantine', $1::uuid, 't1p02 probe', 'test-operator', $2::uuid)`,
        [randomUUID(), randomUUID()],
      );
      const blocked = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
      expect(blocked.status).toBe(503);
      expect(detailsOf(blocked)["result"]).toBe("HUB_REPLACEMENT_BLOCKED");
    } finally {
      await pool.query(
        `select edge_identity.set_hub_replacement_mode_v1('normal', $1::uuid, 't1p02 restore', 'test-operator', $2::uuid)`,
        [randomUUID(), randomUUID()],
      );
    }
    const recovered = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
  });

  // -------------------------------------------------------------------------
  // A re-identified Hub (U1 hardware report 2026-09-12 §11)
  // -------------------------------------------------------------------------
  //
  // On hardware a cloud reset gave the Hub a NEW identity while its local
  // database kept the previous one: `pairing_receipt` references it and is
  // append-only, so it was marked `revoked` and the current identity projected
  // alongside it. Pairing (hub migration 0042) chose the trusted, deployed row
  // and succeeded; eligibility chose the OLDEST row, found it revoked, and
  // refused every read with 503 HUB_NOT_OPERATIONAL.
  //
  // The synthetic rows below reference nothing, so they are removed in
  // `finally`; the seeded Hub is restored the same way.

  async function currentHubIdentity(): Promise<{ id: string; created_at: Date }> {
    const { rows } = await pool.query<{ id: string; created_at: Date }>(
      `select id, created_at from edge_identity.hub_device
        where device_kind = 'store_hub' and trust_status = 'trusted' and lifecycle_status = 'deployed'
        order by created_at limit 1`,
    );
    expect(rows[0], "the seeded Hub must be trusted and deployed").toBeDefined();
    return rows[0]!;
  }

  async function insertStaleHubIdentity(id: string, olderThan: Date): Promise<void> {
    const h = (label: string) => createHash("sha256").update(`${label}:${id}`).digest("hex");
    await pool.query(
      `insert into edge_identity.hub_device
         (id, asset_number, device_kind, lifecycle_status, trust_status,
          board_serial_hash, factory_duid_hash, root_key_fingerprint,
          manufacturing_cert_serial, created_at, updated_at)
       values ($1::uuid, $2, 'store_hub', 'deployed', 'revoked', $3, $4, $5,
               'STALE-PRE-REIDENTIFICATION', $6::timestamptz - interval '30 days', now())`,
      [id, `STALE-HUB-${RUN}-${id.slice(0, 8)}`, h("board"), h("duid"), h("root"), olderThan],
    );
  }

  it("serves a RE-IDENTIFIED Hub: a stale revoked identity beside the current one refuses nothing", async () => {
    const t = await newLanTerminal("elig-reidentified");
    await pairTerminal(t);
    const current = await currentHubIdentity();
    const staleId = randomUUID();
    try {
      await insertStaleHubIdentity(staleId, current.created_at);

      // The exact hardware shape: the stale identity is now the OLDEST Hub row.
      const { rows: oldest } = await pool.query<{ id: string }>(
        `select id from edge_identity.hub_device where device_kind = 'store_hub' order by created_at limit 1`,
      );
      expect(oldest[0]!.id).toBe(staleId);

      const eligibility = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
      expect(eligibility.status, JSON.stringify(eligibility.body)).toBe(200);
      expect((eligibility.body["eligibility"] as Record<string, unknown>)["hubDeviceId"]).toBe(
        current.id,
      );

      // The configuration route is gated by the same derivation and was the
      // second 503 on hardware.
      const configuration = await call(t, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
      expect(configuration.status, JSON.stringify(configuration.body)).toBe(200);
      expect((configuration.body["delivery"] as Record<string, unknown>)["hubDeviceId"]).toBe(
        current.id,
      );
    } finally {
      await pool.query(`delete from edge_identity.hub_device where id = $1::uuid`, [staleId]);
    }
  });

  it("still fails closed: a stale identity alone is HUB_NOT_OPERATIONAL, a retired current one HUB_RETIRED", async () => {
    const t = await newLanTerminal("elig-no-operational-hub");
    await pairTerminal(t);
    const current = await currentHubIdentity();
    const staleId = randomUUID();
    try {
      await insertStaleHubIdentity(staleId, current.created_at);

      // No trusted, deployed identity remains: the stale row must not stand in.
      await pool.query(
        `update edge_identity.hub_device set trust_status = 'quarantined' where id = $1::uuid`,
        [current.id],
      );
      const notOperational = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
      expect(notOperational.status).toBe(503);
      expect(detailsOf(notOperational)["result"]).toBe("HUB_NOT_OPERATIONAL");

      // The NEWEST identity is retired: the Hub is retired, whatever older rows say.
      await pool.query(
        `update edge_identity.hub_device set lifecycle_status = 'retired' where id = $1::uuid`,
        [current.id],
      );
      const retired = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
      expect(retired.status).toBe(403);
      expect(detailsOf(retired)["result"]).toBe("HUB_RETIRED");
    } finally {
      await pool.query(
        `update edge_identity.hub_device set trust_status = 'trusted', lifecycle_status = 'deployed'
          where id = $1::uuid`,
        [current.id],
      );
      await pool.query(`delete from edge_identity.hub_device where id = $1::uuid`, [staleId]);
    }
    const restored = await call(t, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(restored.status, JSON.stringify(restored.body)).toBe(200);
  });

  // -------------------------------------------------------------------------
  // Current configuration (§3)
  // -------------------------------------------------------------------------

  it("delivers the ACTIVE snapshot bound to the terminal, attested by the Hub operational key", async () => {
    const t = await newLanTerminal("config");
    await pairTerminal(t);
    const response = await call(t, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect(response.body["result"]).toBe("CONFIGURATION_DELIVERY");
    const delivery = response.body["delivery"] as Record<string, unknown>;
    const payloadJson = String(response.body["payloadJson"]);
    const deliverySignature = String(response.body["deliverySignature"]);
    censusSecrets.push(deliverySignature);
    expect(delivery["snapshotId"]).toBe(ACTIVE_SNAPSHOT);
    expect(delivery["configurationVersion"]).toBe(7);
    expect(delivery["terminalDeviceId"]).toBe(t.deviceId);
    expect(delivery["terminalProfileCode"]).toBe(T1);
    expect(delivery["assignmentGeneration"]).toBe(1);
    // The DELIVERY signer self-describes (owner decision §3 "signer and
    // public-key identifier"): the envelope names the Hub operational key
    // that produced the signature — distinct from delivery.signingKeyId,
    // which is the CLOUD manifest key (provenance).
    expect(response.body["deliverySignerCertificateSerial"]).toBe(signer.certificateSerial);
    expect(response.body["deliverySignerPublicKeyFingerprint"]).toBe(
      publicKeyFingerprint(signer.publicKeyPem),
    );
    // Terminal-side INDEPENDENT verification with the REAL verifier:
    const verdict = verifyTerminalConfigurationDelivery(
      {
        snapshotId: String(delivery["snapshotId"]),
        configurationVersion: Number(delivery["configurationVersion"]),
        schemaVersion: Number(delivery["schemaVersion"]),
        tenantId: String(delivery["tenantId"]),
        digitalStoreId: String(delivery["digitalStoreId"]),
        storeLocationId: String(delivery["storeLocationId"]),
        environment: String(delivery["environment"]) as TrustEnvironment,
        hubDeviceId: String(delivery["hubDeviceId"]),
        terminalDeviceId: String(delivery["terminalDeviceId"]),
        assignmentGeneration: Number(delivery["assignmentGeneration"]),
        terminalProfileCode: String(delivery["terminalProfileCode"]),
        minimumApplicationVersion: String(delivery["minimumApplicationVersion"]),
        maximumApplicationVersion:
          delivery["maximumApplicationVersion"] === null
            ? null
            : String(delivery["maximumApplicationVersion"]),
        issuedAt: new Date(String(delivery["issuedAt"])),
        effectiveAt: new Date(String(delivery["effectiveAt"])),
        validUntil: new Date(String(delivery["validUntil"])),
        manifestSha256: String(delivery["manifestSha256"]),
        payloadSha256: String(delivery["payloadSha256"]),
        signingKeyId: String(delivery["signingKeyId"]),
        correlationId: String(delivery["correlationId"]),
      } satisfies TerminalConfigurationDelivery,
      new Uint8Array(Buffer.from(deliverySignature, "base64url")),
      signer.publicKeyPem,
      {
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development",
        hubDeviceId: String(delivery["hubDeviceId"]),
        terminalDeviceId: t.deviceId,
        assignmentGeneration: 1,
        terminalProfileCode: T1,
      },
      createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"),
    );
    expect(verdict.verified, verdict.detail).toBe(true);
  });

  it("refuses configuration to an unpaired terminal and fails closed without a delivery signer", async () => {
    const unpaired = await newLanTerminal("config-unpaired");
    const refused = await call(unpaired, "GET", EDGE_CONFIGURATION_CURRENT_PATH);
    expect(refused.status).toBe(403);
    expect(detailsOf(refused)["result"]).toBe("PAIRING_REQUIRED");

    const t = await newLanTerminal("config-unsigned");
    await pairTerminal(t);
    const unsigned = await terminalRequest({
      port: unsignedPort,
      method: "GET",
      path: EDGE_CONFIGURATION_CURRENT_PATH,
      identity: { certPem: t.tls.certPem, keyPem: t.tls.keyPem },
      caPem: deviceCa.certPem,
    });
    expect(unsigned.status).toBe(503);
    expect(detailsOf(unsigned)["result"]).toBe("DELIVERY_SIGNER_UNAVAILABLE");
  });

  // -------------------------------------------------------------------------
  // Staff sessions (§4)
  // -------------------------------------------------------------------------

  async function readyTerminal(label: string): Promise<LanTerminal> {
    const t = await newLanTerminal(label);
    await pairTerminal(t);
    return t;
  }

  it("opens, refreshes and closes a staff session under the registered permissions", async () => {
    const t = await readyTerminal("sess");
    const staff = await insertStaff([T1]);
    for (const key of FIVE_KEYS) await grant(staff.actorId, key);
    const opened = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `open-${RUN}-1` },
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    expect(opened.body["result"]).toBe("SESSION_OPENED");
    const session = opened.body["session"] as Record<string, unknown>;
    expect(session["effectivePermissions"]).toContain("pos.t1.use");
    const sessionId = String(session["sessionId"]);

    // Same-actor replay returns the SAME open session.
    const replay = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `open-${RUN}-1` },
    );
    expect(replay.body["result"]).toBe("SESSION_ALREADY_OPEN");
    expect((replay.body["session"] as Record<string, unknown>)["sessionId"]).toBe(sessionId);

    const refreshed = await call(
      t,
      "POST",
      EDGE_SESSIONS_REFRESH_PATH,
      { sessionId },
      { "idempotency-key": `refresh-${RUN}-1` },
    );
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    // The governed bound: never beyond staff offline validity.
    const { rows } = await pool.query<{ bound: Date }>(
      `select offline_valid_until as bound from edge_identity.staff_cache where actor_id = $1`,
      [staff.actorId],
    );
    const expiresAt = new Date(
      String((refreshed.body["session"] as Record<string, unknown>)["expiresAt"]),
    );
    expect(expiresAt.getTime()).toBeLessThanOrEqual(rows[0]?.bound.getTime() ?? 0);

    const closed = await call(
      t,
      "POST",
      EDGE_SESSIONS_CLOSE_PATH,
      { sessionId },
      { "idempotency-key": `close-${RUN}-1` },
    );
    expect(closed.status).toBe(200);
    expect(closed.body["result"]).toBe("SESSION_CLOSED");
    const closedAgain = await call(
      t,
      "POST",
      EDGE_SESSIONS_CLOSE_PATH,
      { sessionId },
      { "idempotency-key": `close-${RUN}-2` },
    );
    expect(closedAgain.status).toBe(409);
    expect(detailsOf(closedAgain)["result"]).toBe("SESSION_CLOSED");
  });

  it("each route requires its exact permission; nothing is grantable from the terminal side", async () => {
    const t = await readyTerminal("sess-perm");
    const staff = await insertStaff([T1]);
    // NO grants at all: open refuses on staff.sessions.open.
    const denied = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `perm-${RUN}-1` },
    );
    expect(denied.status).toBe(403);
    expect(detailsOf(denied)["result"]).toBe("SESSION_PERMISSION_DENIED");
    // Grant ONLY open: the session opens but carries no pos.t1.use, and
    // refresh/close still refuse on their own keys — the renderer cannot
    // grant itself anything; grants come only from the projection.
    await grant(staff.actorId, "staff.sessions.open");
    const opened = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `perm-${RUN}-2` },
    );
    expect(opened.status).toBe(200);
    const session = opened.body["session"] as Record<string, unknown>;
    expect(session["effectivePermissions"]).not.toContain("pos.t1.use");
    const sessionId = String(session["sessionId"]);
    const refreshDenied = await call(
      t,
      "POST",
      EDGE_SESSIONS_REFRESH_PATH,
      { sessionId },
      { "idempotency-key": `perm-${RUN}-3` },
    );
    expect(refreshDenied.status).toBe(403);
    expect(detailsOf(refreshDenied)["result"]).toBe("SESSION_PERMISSION_DENIED");
    const closeDenied = await call(
      t,
      "POST",
      EDGE_SESSIONS_CLOSE_PATH,
      { sessionId },
      { "idempotency-key": `perm-${RUN}-4` },
    );
    expect(closeDenied.status).toBe(403);
    expect(detailsOf(closeDenied)["result"]).toBe("SESSION_PERMISSION_DENIED");
  });

  it("refuses wrong passcode, disabled staff, foreign-Store staff, unauthorized profile and occupied terminal", async () => {
    const t = await readyTerminal("sess-refusals");
    const staff = await insertStaff([T1]);
    for (const key of FIVE_KEYS) await grant(staff.actorId, key);

    const wrongPasscode = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: "wrong-passcode", profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-1` },
    );
    expect(wrongPasscode.status).toBe(401);
    expect(detailsOf(wrongPasscode)["result"]).toBe("STAFF_CREDENTIAL_INVALID");

    const disabled = await insertStaff([T1], { disabled: true });
    await grant(disabled.actorId, "staff.sessions.open");
    const disabledResponse = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: disabled.actorId, passcode: disabled.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-2` },
    );
    expect(detailsOf(disabledResponse)["result"]).toBe("STAFF_DISABLED");

    const foreign = await insertStaff([T1], { tenant: ATTACKER_TENANT });
    await grant(foreign.actorId, "staff.sessions.open");
    const transplant = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: foreign.actorId, passcode: foreign.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-3` },
    );
    expect(transplant.status).toBe(403);
    expect(detailsOf(transplant)["result"]).toBe("STAFF_SCOPE_MISMATCH");

    const t3only = await insertStaff([T3]);
    await grant(t3only.actorId, "staff.sessions.open");
    const wrongProfile = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: t3only.actorId, passcode: t3only.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-4` },
    );
    expect(detailsOf(wrongProfile)["result"]).toBe("STAFF_PROFILE_NOT_AUTHORIZED");

    // Occupy the terminal, then a SECOND actor is refused.
    const first = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-5` },
    );
    expect(first.status).toBe(200);
    const second = await insertStaff([T1]);
    await grant(second.actorId, "staff.sessions.open");
    const occupied = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: second.actorId, passcode: second.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-6` },
    );
    expect(occupied.status).toBe(409);
    expect(detailsOf(occupied)["result"]).toBe("SESSION_OCCUPIED");

    // A session id from another terminal never acts here.
    const other = await readyTerminal("sess-other");
    const otherStaff = await insertStaff([T1]);
    for (const key of FIVE_KEYS) await grant(otherStaff.actorId, key);
    const otherOpen = await call(
      other,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: otherStaff.actorId, passcode: otherStaff.passcode, profileCode: T1 },
      { "idempotency-key": `ref-${RUN}-7` },
    );
    const foreignSession = String(
      (otherOpen.body["session"] as Record<string, unknown>)["sessionId"],
    );
    const crossTerminal = await call(
      t,
      "POST",
      EDGE_SESSIONS_CLOSE_PATH,
      { sessionId: foreignSession },
      { "idempotency-key": `ref-${RUN}-8` },
    );
    expect(crossTerminal.status).toBe(404);
    expect(detailsOf(crossTerminal)["result"]).toBe("SESSION_UNKNOWN");

    // Idempotency-Key is required on every session mutation.
    const missingKey = await call(t, "POST", EDGE_SESSIONS_REFRESH_PATH, {
      sessionId: foreignSession,
    });
    expect(missingKey.status).toBe(422);
  });

  it("refuses a cross-Store staff transplant — same Tenant, another Digital Store", async () => {
    // §8 staff-session matrix: cross-STORE, not merely cross-Tenant. A staff
    // member cached under another Digital Store of the SAME Tenant never
    // opens a session on this Store's terminal.
    const t = await readyTerminal("sess-cross-store");
    const crossStore = await insertStaff([T1], { store: ATTACKER_STORE });
    await grant(crossStore.actorId, "staff.sessions.open");
    const transplant = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: crossStore.actorId, passcode: crossStore.passcode, profileCode: T1 },
      { "idempotency-key": `xstore-${RUN}-1` },
    );
    expect(transplant.status).toBe(403);
    expect(detailsOf(transplant)["result"]).toBe("STAFF_SCOPE_MISMATCH");
  });

  it("a grant revoked after open takes effect at the very next session action", async () => {
    // §8: "revoked staff membership fails" — beyond the disabled flag. The
    // projection is cloud-authored and deny-anywhere-wins (0025 resolver);
    // a deny row landing AFTER a session opened must bite on the next
    // action, because every route re-resolves — nothing is cached.
    const t = await readyTerminal("sess-revoked-grant");
    const staff = await insertStaff([T1]);
    for (const key of FIVE_KEYS) await grant(staff.actorId, key);
    const opened = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `revk-${RUN}-1` },
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const sessionId = String((opened.body["session"] as Record<string, unknown>)["sessionId"]);
    await grant(staff.actorId, "staff.sessions.refresh", "deny", 2);
    const refreshDenied = await call(
      t,
      "POST",
      EDGE_SESSIONS_REFRESH_PATH,
      { sessionId },
      { "idempotency-key": `revk-${RUN}-2` },
    );
    expect(refreshDenied.status).toBe(403);
    expect(detailsOf(refreshDenied)["result"]).toBe("SESSION_PERMISSION_DENIED");
    // Close still works under its own (unrevoked) key — the deny is exact.
    const closed = await call(
      t,
      "POST",
      EDGE_SESSIONS_CLOSE_PATH,
      { sessionId },
      { "idempotency-key": `revk-${RUN}-3` },
    );
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
  });

  it("session routes refuse query parameters outright — the URL carries no inputs", async () => {
    const t = await readyTerminal("sess-query");
    const staff = await insertStaff([T1]);
    for (const key of FIVE_KEYS) await grant(staff.actorId, key);
    const widened = await call(
      t,
      "POST",
      `${EDGE_SESSIONS_OPEN_PATH}?actorId=someone-else`,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `qs-${RUN}-1` },
    );
    expect(widened.status).toBe(422);
    expect(widened.body["error"]).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // WS-12-T002 — the T1 intake surface (customers, consent, Booking Drafts)
  // over the same live mTLS transport (KLD-2026-08-06-WS12-T002-001).
  // -------------------------------------------------------------------------

  const INTAKE_KEYS = [
    ...FIVE_KEYS,
    "customers.read",
    "customers.create",
    "customers.consent.record",
    "laundry.bookings.read",
    "laundry.bookings.create",
  ];

  async function openIntakeSession(
    t: LanTerminal,
    keys: readonly string[] = INTAKE_KEYS,
  ): Promise<{ sessionId: string; actorId: string }> {
    const staff = await insertStaff([T1]);
    for (const key of keys) await grant(staff.actorId, key);
    const opened = await call(
      t,
      "POST",
      EDGE_SESSIONS_OPEN_PATH,
      { actorId: staff.actorId, passcode: staff.passcode, profileCode: T1 },
      { "idempotency-key": `t002-open-${RUN}-${randomUUID().slice(0, 8)}` },
    );
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    return {
      sessionId: String((opened.body["session"] as Record<string, unknown>)["sessionId"]),
      actorId: staff.actorId,
    };
  }

  function intakeCall(
    t: LanTerminal,
    sessionId: string,
    method: string,
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<TerminalHttpResponse> {
    return call(t, method, path, body, {
      "x-kitluy-session-id": sessionId,
      ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
    });
  }

  it("T002: creates a minimal customer ONCE, searches it scoped, labels it honestly", async () => {
    const t = await readyTerminal("t002-cust");
    const { sessionId } = await openIntakeSession(t);
    const key = `t002-cust-${RUN}-1`;
    const created = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "Sokneang Test", phone: "012 911 222", preferredLanguage: "km-KH" },
      key,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect(created.body["result"]).toBe("CUSTOMER_CREATED");
    const customer = created.body["customer"] as Record<string, unknown>;
    expect(customer["origin"]).toBe("local_created");
    expect(customer["syncState"]).toBe("pending_sync"); // never cloud-labelled early
    expect(customer["phoneVerified"]).toBe(false); // presence is not verification
    const customerId = String(customer["customerId"]);

    // Idempotent replay: SAME key + body = the ORIGINAL effect, once.
    const replay = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "Sokneang Test", phone: "012 911 222", preferredLanguage: "km-KH" },
      key,
    );
    expect(replay.body["result"]).toBe("CUSTOMER_ALREADY_CREATED");
    expect(String((replay.body["customer"] as Record<string, unknown>)["customerId"])).toBe(
      customerId,
    );
    const events = await pool.query(
      `select count(*)::int as n from edge_sync.local_event
        where event_type = 'customer.local_customer_created' and aggregate_id = $1::uuid`,
      [customerId],
    );
    expect(events.rows[0]?.n).toBe(1); // one durable outbox fact

    // Conflicting reuse of the key refuses.
    const conflicting = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "Different Person", preferredLanguage: "km-KH" },
      key,
    );
    expect(conflicting.status).toBe(409);
    expect(detailsOf(conflicting)["result"]).toBe("CUSTOMER_IDEMPOTENCY_CONFLICT");

    // Scoped exact search over the NORMALIZED phone; raw input accepted.
    const search = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012911222",
    );
    expect(search.status, JSON.stringify(search.body)).toBe(200);
    expect(search.body["normalizedPhone"]).toBe("+85512911222");
    const matches = search.body["matches"] as readonly Record<string, unknown>[];
    expect(matches.map((m) => m["customerId"])).toContain(customerId);

    // A malformed phone is refused, never fabricated into zero results.
    const bad = await intakeCall(t, sessionId, "GET", "/edge/v1/customers/search?phone=abc");
    expect(bad.status).toBe(422);
    // An unknown query parameter is rejected outright.
    const widened = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012911222&tenant=other",
    );
    expect(widened.status).toBe(422);
  });

  it("T002: consent decisions are explicit, purpose-separated, append-only and idempotent", async () => {
    const t = await readyTerminal("t002-consent");
    const { sessionId } = await openIntakeSession(t);
    const created = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "Consent Probe", phone: "012 933 444" },
      `t002-consent-cust-${RUN}`,
    );
    const customerId = String((created.body["customer"] as Record<string, unknown>)["customerId"]);
    const consentPath = `/edge/v1/customers/${customerId}/consent-decisions`;

    // Privacy acknowledgement — its own decision kind.
    const ack = await intakeCall(
      t,
      sessionId,
      "POST",
      consentPath,
      {
        purposeKey: "privacy_notice_acknowledgement",
        policyRef: "DEMO-PRIVACY",
        policyVersion: 1,
        decision: "acknowledged",
        channel: "t1_terminal",
        staffAssisted: true,
      },
      `t002-ack-${RUN}`,
    );
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);
    // `granted` for the privacy notice is refused (one purpose never
    // authorizes another; acknowledgement is not consent).
    const wrongPair = await intakeCall(
      t,
      sessionId,
      "POST",
      consentPath,
      {
        purposeKey: "privacy_notice_acknowledgement",
        policyRef: "DEMO-PRIVACY",
        policyVersion: 1,
        decision: "granted",
        channel: "t1_terminal",
        staffAssisted: true,
      },
      `t002-wrongpair-${RUN}`,
    );
    expect(wrongPair.status).toBe(422);

    // SMS marketing granted, then WITHDRAWN — a NEW fact, nothing erased.
    const grantKey = `t002-sms-grant-${RUN}`;
    const granted = await intakeCall(
      t,
      sessionId,
      "POST",
      consentPath,
      {
        purposeKey: "sms_marketing",
        policyRef: "DEMO-SMS",
        policyVersion: 1,
        decision: "granted",
        channel: "t1_terminal",
        staffAssisted: true,
      },
      grantKey,
    );
    expect(granted.body["result"]).toBe("CONSENT_RECORDED");
    const replay = await intakeCall(
      t,
      sessionId,
      "POST",
      consentPath,
      {
        purposeKey: "sms_marketing",
        policyRef: "DEMO-SMS",
        policyVersion: 1,
        decision: "granted",
        channel: "t1_terminal",
        staffAssisted: true,
      },
      grantKey,
    );
    expect(replay.body["result"]).toBe("CONSENT_ALREADY_RECORDED");
    expect(replay.body["decisionId"]).toBe(granted.body["decisionId"]);
    const withdrawn = await intakeCall(
      t,
      sessionId,
      "POST",
      consentPath,
      {
        purposeKey: "sms_marketing",
        policyRef: "DEMO-SMS",
        policyVersion: 1,
        decision: "withdrawn",
        channel: "t1_terminal",
        staffAssisted: true,
      },
      `t002-sms-withdraw-${RUN}`,
    );
    expect(withdrawn.status).toBe(200);
    const ledger = await pool.query(
      `select decision, staff_assisted from edge_core.consent_decision
        where customer_id = $1::uuid order by recorded_at asc`,
      [customerId],
    );
    // Three facts, all preserved, all labelled staff-assisted.
    expect(ledger.rows.map((r) => (r as { decision: string }).decision)).toEqual([
      "acknowledged",
      "granted",
      "withdrawn",
    ]);
    for (const row of ledger.rows) {
      expect((row as { staff_assisted: boolean }).staff_assisted).toBe(true);
    }
    const facts = await pool.query(
      `select count(*)::int as n from edge_sync.local_event
        where event_type = 'customer.consent_decision_recorded'
          and payload -> 'payload' ->> 'local_customer_id' = $1`,
      [customerId],
    );
    expect(facts.rows[0]?.n).toBe(3); // every decision is a durable outbox fact
  });

  it("T002: the Booking Draft lifecycle — snapshot frozen, version exact, terminal states final", async () => {
    const t = await readyTerminal("t002-draft");
    const { sessionId } = await openIntakeSession(t);
    const created = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "Draft Customer", phone: "012 955 666" },
      `t002-draft-cust-${RUN}`,
    );
    const customerId = String((created.body["customer"] as Record<string, unknown>)["customerId"]);

    const draftKey = `t002-draft-${RUN}-1`;
    const draftCreated = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/laundry/bookings/drafts",
      { customerId, walkIn: false, customerNotes: "wash and fold" },
      draftKey,
    );
    expect(draftCreated.status, JSON.stringify(draftCreated.body)).toBe(200);
    const draft = draftCreated.body["draft"] as Record<string, unknown>;
    const draftId = String(draft["draftId"]);
    expect(draft["lifecycle"]).toBe("open");
    expect(draft["version"]).toBe(1);
    expect(draft["syncState"]).toBe("local_authoritative");
    // No Booking, no money: the draft carries no price/payment surface.
    expect(Object.keys(draft).join(",")).not.toMatch(/price|payment|total|amount/i);

    // Replay of the create returns the SAME draft.
    const createReplay = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/laundry/bookings/drafts",
      { customerId, walkIn: false, customerNotes: "wash and fold" },
      draftKey,
    );
    expect(String((createReplay.body["draft"] as Record<string, unknown>)["draftId"])).toBe(
      draftId,
    );

    // The snapshot is IMMUTABLE: a later customer-master edit changes nothing.
    await pool.query(`update edge_core.customer set display_name = 'Renamed Later' where id = $1`, [
      customerId,
    ]);
    const reread = await intakeCall(
      t,
      sessionId,
      "GET",
      `/edge/v1/laundry/bookings/drafts/${draftId}`,
    );
    const snapshot = (reread.body["draft"] as Record<string, unknown>)[
      "customerSnapshot"
    ] as Record<string, unknown>;
    expect(snapshot["displayName"]).toBe("Draft Customer");

    // Update requires the EXACT current version; duplicate replays once.
    const updateKey = `t002-draft-upd-${RUN}`;
    const updated = await intakeCall(
      t,
      sessionId,
      "PATCH",
      `/edge/v1/laundry/bookings/drafts/${draftId}`,
      { expectedVersion: 1, staffNotes: "stain on collar" },
      updateKey,
    );
    expect((updated.body["draft"] as Record<string, unknown>)["version"]).toBe(2);
    const updateReplay = await intakeCall(
      t,
      sessionId,
      "PATCH",
      `/edge/v1/laundry/bookings/drafts/${draftId}`,
      { expectedVersion: 1, staffNotes: "stain on collar" },
      updateKey,
    );
    expect((updateReplay.body["draft"] as Record<string, unknown>)["version"]).toBe(2);
    const stale = await intakeCall(
      t,
      sessionId,
      "PATCH",
      `/edge/v1/laundry/bookings/drafts/${draftId}`,
      { expectedVersion: 1, staffNotes: "second edit on stale version" },
      `t002-draft-stale-${RUN}`,
    );
    expect(stale.status).toBe(409);
    expect(detailsOf(stale)["result"]).toBe("DRAFT_VERSION_STALE");

    // Cancel with a governed reason; a cancelled draft is FINAL.
    const cancelled = await intakeCall(
      t,
      sessionId,
      "POST",
      `/edge/v1/laundry/bookings/drafts/${draftId}/cancel`,
      { reasonCode: "customer_left" },
      `t002-draft-cancel-${RUN}`,
    );
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    expect((cancelled.body["draft"] as Record<string, unknown>)["lifecycle"]).toBe("cancelled");
    const editAfter = await intakeCall(
      t,
      sessionId,
      "PATCH",
      `/edge/v1/laundry/bookings/drafts/${draftId}`,
      { expectedVersion: 3, staffNotes: "edit after cancel" },
      `t002-draft-after-${RUN}`,
    );
    expect(editAfter.status).toBe(409);
    expect(detailsOf(editAfter)["result"]).toBe("DRAFT_NOT_OPEN");

    // An ungoverned cancel reason is refused.
    const walkInDraft = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/laundry/bookings/drafts",
      { walkIn: true },
      `t002-draft-walkin-${RUN}`,
    );
    const walkInId = String((walkInDraft.body["draft"] as Record<string, unknown>)["draftId"]);
    const badReason = await intakeCall(
      t,
      sessionId,
      "POST",
      `/edge/v1/laundry/bookings/drafts/${walkInId}/cancel`,
      { reasonCode: "because" },
      `t002-draft-badreason-${RUN}`,
    );
    expect(badReason.status).toBe(422);
  });

  it("T002: the full §6 authorization stack gates every intake route", async () => {
    const t = await readyTerminal("t002-authz");

    // No session header at all.
    const bare = await call(t, "GET", "/edge/v1/customers/search?phone=012911222");
    expect(bare.status).toBe(422);

    // A fabricated session id.
    const forged = await intakeCall(
      t,
      randomUUID(),
      "GET",
      "/edge/v1/customers/search?phone=012911222",
    );
    expect(forged.status).toBe(404);

    // A session WITHOUT pos.t1.use cannot use any intake route.
    const noShell = await openIntakeSession(t, ["staff.sessions.open", "customers.read"]);
    const refusedShell = await intakeCall(
      t,
      noShell.sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012911222",
    );
    expect(refusedShell.status).toBe(403);
    expect(detailsOf(refusedShell)["result"]).toBe("T1_NOT_AUTHORIZED");

    // pos.t1.use alone is not the route permission either. (One active
    // session per terminal, so each stage uses a fresh terminal.)
    const t2 = await readyTerminal("t002-authz-2");
    const noRouteKey = await openIntakeSession(t2, ["staff.sessions.open", "pos.t1.use"]);
    const refusedRoute = await intakeCall(
      t2,
      noRouteKey.sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012911222",
    );
    expect(refusedRoute.status).toBe(403);
    expect(detailsOf(refusedRoute)["result"]).toBe("SESSION_PERMISSION_DENIED");

    // A session from ANOTHER terminal never authorizes this one.
    const other = await readyTerminal("t002-authz-other");
    const foreign = await openIntakeSession(other);
    const crossTerminal = await intakeCall(
      t,
      foreign.sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012911222",
    );
    expect(crossTerminal.status).toBe(404);
    expect(detailsOf(crossTerminal)["result"]).toBe("SESSION_UNKNOWN");

    // Mutations additionally demand an Idempotency-Key.
    const t3 = await readyTerminal("t002-authz-3");
    const session = await openIntakeSession(t3);
    const noKey = await intakeCall(t3, session.sessionId, "POST", "/edge/v1/customers", {
      displayName: "No Key",
    });
    expect(noKey.status).toBe(422);

    // Unknown body fields are rejected, not ignored.
    const unknownField = await intakeCall(
      t3,
      session.sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "X", tenantId: "attacker-supplied" },
      `t002-unknown-${RUN}`,
    );
    expect(unknownField.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // The Terminal PIN (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§15;
  // KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001): one shared PIN per
  // device, PIN alone, the device credential checked first.
  // -------------------------------------------------------------------------

  const pinKey = (label: string): Record<string, string> => ({
    "idempotency-key": `pin-${label}-${RUN}-${randomUUID().slice(0, 8)}`,
  });

  async function setupPin(t: LanTerminal, pin: string): Promise<TerminalHttpResponse> {
    censusSecrets.push(`"${pin}"`);
    return call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_SETUP_PATH,
      { pin, pinConfirmation: pin },
      pinKey("setup"),
    );
  }

  function unlock(t: LanTerminal, pin: string, onPort = port): Promise<TerminalHttpResponse> {
    return terminalRequest({
      port: onPort,
      method: "POST",
      path: EDGE_TERMINAL_PIN_UNLOCK_PATH,
      body: { pin },
      identity: { certPem: t.tls.certPem, keyPem: t.tls.keyPem },
      caPem: deviceCa.certPem,
      headers: pinKey("unlock"),
    });
  }

  function pinOf(response: TerminalHttpResponse): Record<string, unknown> {
    const direct = response.body["pin"] as Record<string, unknown> | undefined;
    return direct ?? (detailsOf(response)["pin"] as Record<string, unknown> | undefined) ?? {};
  }

  async function pinRow(t: LanTerminal): Promise<Record<string, unknown> | undefined> {
    const { rows } = await pool.query<Record<string, unknown>>(
      `select * from edge_identity.terminal_pin where terminal_device_id = $1`,
      [t.deviceId],
    );
    return rows[0];
  }

  it("Terminal PIN: set up twice on a trusted terminal, stored only as an Argon2id verifier", async () => {
    // An untrusted terminal is refused before any PIN is read.
    const revoked = await newLanTerminal("pin-revoked", { credentialStatus: "revoked" });
    const refusedDevice = await call(
      revoked,
      "POST",
      EDGE_TERMINAL_PIN_SETUP_PATH,
      { pin: "4826", pinConfirmation: "4826" },
      pinKey("revoked"),
    );
    expect(refusedDevice.status).toBe(403);
    expect(detailsOf(refusedDevice)["result"]).toBe("CREDENTIAL_NOT_CURRENT");
    // A trusted but unpaired terminal may not operate, so it may not set a PIN.
    const unpaired = await newLanTerminal("pin-unpaired");
    const refusedUnpaired = await call(
      unpaired,
      "POST",
      EDGE_TERMINAL_PIN_SETUP_PATH,
      { pin: "4826", pinConfirmation: "4826" },
      pinKey("unpaired"),
    );
    expect(detailsOf(refusedUnpaired)["result"]).toBe("PAIRING_REQUIRED");
    expect(await pinRow(unpaired)).toBeUndefined();

    const t = await readyTerminal("pin-setup");
    const before = await call(t, "GET", EDGE_TERMINAL_PIN_STATUS_PATH);
    expect(before.status, JSON.stringify(before.body)).toBe(200);
    expect(pinOf(before)).toMatchObject({ state: "setup_required", attemptsBeforeLock: 5 });

    const noKey = await call(t, "POST", EDGE_TERMINAL_PIN_SETUP_PATH, {
      pin: "4826",
      pinConfirmation: "4826",
    });
    expect(noKey.status).toBe(422);
    const mismatch = await call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_SETUP_PATH,
      { pin: "4826", pinConfirmation: "4862" },
      pinKey("mismatch"),
    );
    expect(mismatch.status).toBe(422);
    expect(detailsOf(mismatch)["result"]).toBe("PIN_CONFIRMATION_MISMATCH");
    for (const bad of ["48a6", "48260", "482", " 4826"]) {
      const malformed = await call(
        t,
        "POST",
        EDGE_TERMINAL_PIN_SETUP_PATH,
        { pin: bad, pinConfirmation: bad },
        pinKey("format"),
      );
      expect(malformed.status).toBe(422);
    }
    expect(await pinRow(t)).toBeUndefined();

    const established = await setupPin(t, "4826");
    expect(established.status, JSON.stringify(established.body)).toBe(200);
    expect(established.body["result"]).toBe("PIN_ESTABLISHED");
    const session = established.body["session"] as Record<string, unknown>;
    expect(session["credentialKind"]).toBe("terminal_pin");
    expect(session["actorId"]).toBe(t.deviceId);
    expect(session["profileCode"]).toBe(T1);
    expect(session["effectivePermissions"]).toContain("pos.t1.use");
    const hours =
      (Date.parse(String(session["expiresAt"])) - Date.parse(String(session["openedAt"]))) /
      3_600_000;
    expect(hours).toBe(8);
    expect(pinOf(established)).toMatchObject({ state: "set", pinVersion: 1, lockedUntil: null });

    const row = await pinRow(t);
    const verifier = String(row?.["verifier"]);
    expect(verifier).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(JSON.stringify(row)).not.toContain('"4826"');
    expect(await verifyTerminalPin("4826", verifier)).toBe(true);
    expect(await verifyTerminalPin("4827", verifier)).toBe(false);
    censusSecrets.push(verifier);

    const again = await setupPin(t, "1111");
    expect(again.status).toBe(409);
    expect(detailsOf(again)["result"]).toBe("PIN_ALREADY_SET");

    const { rows: audits } = await pool.query<{ event_code: string; details_json: unknown }>(
      `select event_code, details_json from edge_audit.audit_event
        where terminal_device_id = $1 and event_code like 'terminal_pin.%'`,
      [t.deviceId],
    );
    expect(audits.map((a) => a.event_code)).toContain("terminal_pin.established");
    expect(JSON.stringify(audits)).not.toContain("4826");
    expect(JSON.stringify(audits)).not.toContain(verifier);
  });

  it("Terminal PIN: failures are counted on the Hub; five in fifteen minutes lock it for fifteen, across router instances", async () => {
    const t = await readyTerminal("pin-lock");
    expect((await setupPin(t, "2580")).status).toBe(200);

    for (const left of [4, 3, 2, 1]) {
      const wrong = await unlock(t, "0000");
      expect(wrong.status, JSON.stringify(wrong.body)).toBe(401);
      expect(detailsOf(wrong)["result"]).toBe("PIN_INCORRECT");
      expect(pinOf(wrong)["attemptsBeforeLock"]).toBe(left);
    }
    const locking = await unlock(t, "0001");
    expect(locking.status).toBe(429);
    expect(detailsOf(locking)["result"]).toBe("PIN_LOCKED");
    const { rows: clock } = await pool.query<{ now: Date }>(`select now() as now`);
    const lockedFor =
      Date.parse(String(pinOf(locking)["lockedUntil"])) - (clock[0]?.now.getTime() ?? 0);
    expect(lockedFor).toBeGreaterThan(14 * 60_000);
    expect(lockedFor).toBeLessThanOrEqual(15 * 60_000);

    // The correct PIN is not even verified while locked — and a second, fresh
    // router instance over the same database (a restart) sees the same lock.
    const sessionsBefore = await pool.query(
      `select 1 from edge_identity.terminal_session where terminal_device_id = $1 and credential_kind = 'terminal_pin'`,
      [t.deviceId],
    );
    for (const onPort of [port, unsignedPort]) {
      const whileLocked = await unlock(t, "2580", onPort);
      expect(whileLocked.status).toBe(429);
      expect(detailsOf(whileLocked)["result"]).toBe("PIN_LOCKED");
    }
    const sessionsAfter = await pool.query(
      `select 1 from edge_identity.terminal_session where terminal_device_id = $1 and credential_kind = 'terminal_pin'`,
      [t.deviceId],
    );
    expect(sessionsAfter.rowCount).toBe(sessionsBefore.rowCount);

    const { rows: events } = await pool.query<{ event_code: string; details_json: unknown }>(
      `select event_code, details_json from edge_audit.security_event where device_id = $1`,
      [t.deviceId],
    );
    const codes = events.map((e) => e.event_code);
    expect(codes.filter((c) => c === "TERMINAL_PIN_INCORRECT")).toHaveLength(4);
    expect(codes.filter((c) => c === "TERMINAL_PIN_LOCKED")).toHaveLength(1);
    expect(codes).toContain("TERMINAL_PIN_ATTEMPT_WHILE_LOCKED");
    expect(JSON.stringify(events)).not.toContain("2580");

    // The lock ends; the correct PIN unlocks and the count starts over.
    await pool.query(
      `update edge_identity.terminal_pin set locked_until = now() - interval '1 second' where terminal_device_id = $1`,
      [t.deviceId],
    );
    const unlocked = await unlock(t, "2580");
    expect(unlocked.status, JSON.stringify(unlocked.body)).toBe(200);
    expect(pinOf(unlocked)).toMatchObject({ attemptsBeforeLock: 5, lockedUntil: null });

    // The window: failures older than fifteen minutes no longer count.
    for (let i = 0; i < 3; i += 1) expect((await unlock(t, "9999")).status).toBe(401);
    await pool.query(
      `update edge_identity.terminal_pin set first_failed_at = now() - interval '16 minutes' where terminal_device_id = $1`,
      [t.deviceId],
    );
    const fresh = await unlock(t, "9999");
    expect(pinOf(fresh)["attemptsBeforeLock"]).toBe(4);
  });

  it("Terminal PIN: an unlock opens T1 for THIS terminal only — no staff login, no other terminal, gone once locked", async () => {
    const t = await readyTerminal("pin-intake");
    const other = await readyTerminal("pin-intake-other");
    expect((await setupPin(t, "1357")).status).toBe(200);
    expect((await setupPin(other, "2468")).status).toBe(200);

    // A PIN is per device: another terminal's PIN is simply wrong here.
    expect((await unlock(t, "2468")).status).toBe(401);
    const opened = await unlock(t, "1357");
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const sessionId = String((opened.body["session"] as Record<string, unknown>)["sessionId"]);

    // No staff member, no grant row: the device's T1 profile is the authority.
    const created = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/customers",
      { displayName: "PIN Intake", phone: "012 555 811", preferredLanguage: "en-US" },
      `pin-intake-cust-${RUN}`,
    );
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const searched = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(searched.status, JSON.stringify(searched.body)).toBe(200);
    const draft = await intakeCall(
      t,
      sessionId,
      "POST",
      "/edge/v1/laundry/bookings/drafts",
      {
        customerId: String((created.body["customer"] as Record<string, unknown>)["customerId"]),
        walkIn: false,
        preferredLanguage: "en-US",
        customerNotes: "",
        staffNotes: "",
      },
      `pin-intake-draft-${RUN}`,
    );
    expect(draft.status, JSON.stringify(draft.body)).toBe(200);

    // The session belongs to its terminal.
    const foreign = await intakeCall(
      other,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(foreign.status).toBe(404);
    expect(detailsOf(foreign)["result"]).toBe("SESSION_UNKNOWN");
    // It is not a staff session: the staff routes do not touch it.
    const staffRefresh = await call(
      t,
      "POST",
      EDGE_SESSIONS_REFRESH_PATH,
      { sessionId },
      pinKey("staff-refresh"),
    );
    expect(detailsOf(staffRefresh)["result"]).toBe("SESSION_UNKNOWN");

    const status = await call(t, "GET", EDGE_TERMINAL_PIN_STATUS_PATH, undefined, {
      "x-kitluy-session-id": sessionId,
    });
    expect(status.body["session"]).toMatchObject({ state: "open" });

    const locked = await call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_LOCK_PATH,
      { sessionId },
      pinKey("lock"),
    );
    expect(locked.status, JSON.stringify(locked.body)).toBe(200);
    expect(locked.body["result"]).toBe("TERMINAL_LOCKED");
    const afterLock = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(afterLock.status).toBe(409);
    expect(detailsOf(afterLock)["result"]).toBe("SESSION_CLOSED");
    const lockedStatus = await call(t, "GET", EDGE_TERMINAL_PIN_STATUS_PATH, undefined, {
      "x-kitluy-session-id": sessionId,
    });
    expect(lockedStatus.body["session"]).toMatchObject({ state: "closed" });
    const foreignLock = await call(
      other,
      "POST",
      EDGE_TERMINAL_PIN_LOCK_PATH,
      { sessionId },
      pinKey("lock-other"),
    );
    expect(detailsOf(foreignLock)["result"]).toBe("SESSION_UNKNOWN");

    // A second unlock supersedes the first open session rather than stacking.
    const first = await unlock(t, "1357");
    const second = await unlock(t, "1357");
    const firstId = String((first.body["session"] as Record<string, unknown>)["sessionId"]);
    const superseded = await intakeCall(
      t,
      firstId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(detailsOf(superseded)["result"]).toBe("SESSION_CLOSED");
    expect(second.status).toBe(200);
  });

  it("Terminal PIN: the device credential is checked before the PIN — contained, ungranted or revoked terminals get nothing", async () => {
    const t = await readyTerminal("pin-device");
    expect((await setupPin(t, "3690")).status).toBe(200);
    const opened = await unlock(t, "3690");
    const sessionId = String((opened.body["session"] as Record<string, unknown>)["sessionId"]);

    await pool.query(
      `insert into edge_identity.containment_directive
         (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
          directive_sequence, reason, source_ref, received_via, received_at)
       values ($1, $2, $3, $4, $5, 'suspended', 1, 'pin containment probe',
               $6, 'operator_repair', now())`,
      [randomUUID(), t.deviceId, TENANT, STORE, LOCATION, `pin-probe-${RUN}`],
    );
    const contained = await unlock(t, "3690");
    expect(contained.status).toBe(403);
    expect(detailsOf(contained)["result"]).toBe("CONTAINMENT_PROHIBITS");
    const containedIntake = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(containedIntake.status).toBe(403);
    expect(detailsOf(containedIntake)["result"]).toBe("T1_NOT_AUTHORIZED");
    await pool.query(
      `insert into edge_identity.containment_directive
         (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
          directive_sequence, reason, source_ref, received_via, received_at)
       values ($1, $2, $3, $4, $5, 'cleared', 2, 'pin containment cleared',
               $6, 'operator_repair', now())`,
      [randomUUID(), t.deviceId, TENANT, STORE, LOCATION, `pin-probe-${RUN}`],
    );
    expect(
      (await intakeCall(t, sessionId, "GET", "/edge/v1/customers/search?phone=012555811")).status,
    ).toBe(200);

    // The T1 profile grant ends: the PIN session stops authorizing at once.
    await pool.query(
      `update edge_config.terminal_profile_assignment set effective_until = now() - interval '1 second'
        where terminal_device_id = $1`,
      [t.deviceId],
    );
    const ungranted = await intakeCall(
      t,
      sessionId,
      "GET",
      "/edge/v1/customers/search?phone=012555811",
    );
    expect(ungranted.status).toBe(403);
    expect(detailsOf(ungranted)["result"]).toBe("T1_NOT_AUTHORIZED");
    const ungrantedUnlock = await unlock(t, "3690");
    expect(detailsOf(ungrantedUnlock)["result"]).toBe("PROFILE_NOT_GRANTED");

    // A revoked credential: the correct PIN reaches nothing, not even the status.
    await pool.query(
      `update edge_identity.device_credential set status = 'revoked', revoked_at = now(),
              revocation_reason = 'pin_probe' where device_id = $1`,
      [t.deviceId],
    );
    const revokedUnlock = await unlock(t, "3690");
    expect(revokedUnlock.status).toBe(403);
    expect(detailsOf(revokedUnlock)["result"]).toBe("CREDENTIAL_NOT_CURRENT");
    const revokedStatus = await call(t, "GET", EDGE_TERMINAL_PIN_STATUS_PATH);
    expect(detailsOf(revokedStatus)["result"]).toBe("CREDENTIAL_NOT_CURRENT");
  });

  it("Terminal PIN: change needs the current PIN; a governed reset clears the verifier, closes sessions and asks again", async () => {
    const t = await readyTerminal("pin-change");
    expect((await setupPin(t, "1470")).status).toBe(200);

    const wrongCurrent = await call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_CHANGE_PATH,
      { currentPin: "0000", newPin: "8642", newPinConfirmation: "8642" },
      pinKey("change-wrong"),
    );
    expect(wrongCurrent.status).toBe(401);
    expect(pinOf(wrongCurrent)["attemptsBeforeLock"]).toBe(4);
    const mismatch = await call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_CHANGE_PATH,
      { currentPin: "1470", newPin: "8642", newPinConfirmation: "8624" },
      pinKey("change-mismatch"),
    );
    expect(detailsOf(mismatch)["result"]).toBe("PIN_CONFIRMATION_MISMATCH");
    censusSecrets.push('"8642"');
    const changed = await call(
      t,
      "POST",
      EDGE_TERMINAL_PIN_CHANGE_PATH,
      { currentPin: "1470", newPin: "8642", newPinConfirmation: "8642" },
      pinKey("change"),
    );
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    expect(pinOf(changed)).toMatchObject({ state: "set", pinVersion: 2, attemptsBeforeLock: 5 });
    expect((await unlock(t, "1470")).status).toBe(401);
    const opened = await unlock(t, "8642");
    expect(opened.status).toBe(200);

    expect(
      await resetTerminalPin(pool, {
        terminalDeviceId: t.deviceId,
        actorRef: "x",
        reasonCode: "forgotten_pin",
        correlationId: randomUUID(),
      }),
    ).toMatchObject({ outcome: "refused", refusal: "PIN_FORMAT_INVALID" });
    const reset = await resetTerminalPin(pool, {
      terminalDeviceId: t.deviceId,
      actorRef: `OP-PIN-${RUN}`,
      reasonCode: "forgotten_pin",
      correlationId: randomUUID(),
    });
    expect(reset).toMatchObject({ outcome: "ok", result: "PIN_RESET" });
    if (reset.outcome === "ok") {
      expect(reset.value.sessionsClosed).toBe(1);
      expect(reset.value.pin.state).toBe("reset_required");
    }
    const row = await pinRow(t);
    expect(row?.["verifier"]).toBeNull();
    const afterReset = await unlock(t, "8642");
    expect(afterReset.status).toBe(409);
    expect(detailsOf(afterReset)["result"]).toBe("PIN_SETUP_REQUIRED");
    expect(pinOf(afterReset)["state"]).toBe("reset_required");

    const reestablished = await setupPin(t, "5791");
    expect(reestablished.status).toBe(200);
    expect(pinOf(reestablished)).toMatchObject({ state: "set", pinVersion: 3 });

    const { rows: audits } = await pool.query<{
      event_code: string;
      reason_code: string | null;
      details_json: Record<string, unknown>;
    }>(
      `select event_code, reason_code, details_json from edge_audit.audit_event
        where terminal_device_id = $1 and event_code like 'terminal_pin.%' order by local_sequence`,
      [t.deviceId],
    );
    expect(audits.map((a) => a.event_code)).toEqual([
      "terminal_pin.established",
      "terminal_pin.changed",
      "terminal_pin.unlocked",
      "terminal_pin.reset",
      "terminal_pin.established",
    ]);
    const resetEvent = audits.find((a) => a.event_code === "terminal_pin.reset");
    expect(resetEvent?.reason_code).toBe("forgotten_pin");
    expect(resetEvent?.details_json["operatorReference"]).toBe(`OP-PIN-${RUN}`);

    // No role removes a PIN record — not even the superuser this suite runs as.
    await expect(
      pool.query(`delete from edge_identity.terminal_pin where terminal_device_id = $1`, [
        t.deviceId,
      ]),
    ).rejects.toThrow(/KLUY-EDGE-TERMINAL-PIN-KEPT/);
  });

  // -------------------------------------------------------------------------
  // Security census
  // -------------------------------------------------------------------------

  it("no passcode, verifier, delivery signature or key material reached a log line", () => {
    expect(censusSecrets.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logLines);
    for (const secret of censusSecrets) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(serialized).not.toContain(signer.publicKeyPem.replace(/\s/g, "").slice(30, 60));
  });
});
