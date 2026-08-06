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
} from "../src/hub/edge/routes.js";
import { staffCredentialVerifier } from "../src/hub/edge/runtime-bootstrap.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const ATTACKER_TENANT = "e0000000-0000-4000-8000-0000000000a1";
const T1 = "laundry.t1.intake_cashier";
const T3 = "laundry.t3.ready_scan_in";

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

  async function grant(actorId: string, permissionKey: string, effect = "allow"): Promise<void> {
    await pool.query(
      `insert into edge_config.permission_grant_projection
         (id, tenant_id, digital_store_id, location_id, source_snapshot_id,
          projection_version, actor_id, permission_key, effect, resource_type,
          scope_type, scope_id, environment, requires_reauthentication,
          requires_approval, requires_reason, granted_at, not_before,
          expires_at, revoked_at, offline_validity_seconds,
          offline_policy_reference, signature, signature_algorithm,
          signing_key_id, received_at)
       values ($1, $2, $3, $4, $5, 1, $6, $7, $8, 'terminal_session',
               'store_location', $4, 'development', false, false, false,
               now() - interval '1 hour', now() - interval '1 hour',
               null, null, 3600, 'dev-offline-policy', decode('c0ffee00','hex'),
               'ed25519', 'demo-signing-key-1', now())`,
      [randomUUID(), TENANT, STORE, LOCATION, ACTIVE_SNAPSHOT, actorId, permissionKey, effect],
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

  it("fails closed: missing pairing, non-T1 profile, stale generation, superseded credential", async () => {
    const unpaired = await newLanTerminal("elig-unpaired");
    const noPairing = await call(unpaired, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(noPairing.status).toBe(403);
    expect(detailsOf(noPairing)["result"]).toBe("PAIRING_REQUIRED");

    const t3 = await newLanTerminal("elig-t3", { profile: T3 });
    await pairTerminal(t3);
    const wrongProfile = await call(t3, "GET", EDGE_RUNTIME_ELIGIBILITY_PATH);
    expect(wrongProfile.status).toBe(403);
    expect(detailsOf(wrongProfile)["result"]).toBe("PROFILE_NOT_T1");

    const stale = await newLanTerminal("elig-stale");
    await pairTerminal(stale);
    await pool.query(
      `update edge_identity.terminal_device set assignment_generation = 2 where id = $1`,
      [stale.deviceId],
    );
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
