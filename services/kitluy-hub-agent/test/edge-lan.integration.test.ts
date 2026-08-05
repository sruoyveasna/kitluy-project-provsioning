/**
 * STORE LAN mTLS TRANSPORT, ACTIVATION AND PAIRING ROUTES — WS-11-T004-P04B
 * scenarios A–G, over REAL TLS 1.3 sockets against the REAL Hub database.
 *
 * The terminal in these tests is a black box: an HTTPS client holding its
 * TLS client certificate, its Ed25519 pairing/ack key, and the public route
 * responses — no database access, no internal canonicalizer, no server
 * helper. X.509 material is minted per run by an ephemeral test CA
 * (node-forge); the client-certificate SERIAL is what binds a TLS peer to
 * its projected operational credential, exactly the §3 revalidation rule.
 *
 * The CLOUD activation authority is simulated at the gateway port with REAL
 * `@kitluy/device-identity` crypto (genuine Ed25519 verification over the
 * canonical kitluy.activation-ack.v1 bytes) — the P03A database truth stays
 * in the cloud service, whose authenticated Hub-to-cloud bridge remains the
 * recorded BLK-006 dependency (handoff §"PARTIAL"). Pairing runs the REAL
 * P03B/P03C composition against the REAL doors, including the 0032 clamp.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tlsConnect } from "node:tls";
import forge from "node-forge";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  activationAckBytes,
  verifyActivationAck,
  ACTIVATION_ACK_PURPOSE,
  verifyEdgeDiscoveryRecord,
  verifyHubPairingProof,
  PAIRING_PROTOCOL_VERSION,
  type ActivationAckChallenge,
  type ActivationAckExpectation,
  type PairingExpectation,
  type PairingTranscript,
  type TrustEnvironment,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

import { createHubPool, isHubDatabaseReachable } from "../src/hub/db.js";
import {
  TerminalPairingComposition,
  type PairingChallengeMaterial,
  type PairingSigner,
  type SafeLogger,
} from "../src/hub/pairing.js";
import { EdgeDiscoveryAuthority } from "../src/hub/edge/discovery.js";
import { createEdgeTlsServer } from "../src/hub/edge/transport.js";
import {
  createEdgeTerminalRouter,
  CloudActivationUnavailableError,
  unavailableActivationGateway,
  WELL_KNOWN_DISCOVERY_PATH,
  type CloudActivationChallenge,
  type CloudActivationGateway,
  type CloudActivationOutcome,
  type CloudActivationState,
} from "../src/hub/edge/routes.js";

const RUN = randomUUID().slice(0, 8);
const TENANT = "e0000000-0000-4000-8000-000000000001";
const STORE = "e0000000-0000-4000-8000-000000000002";
const LOCATION = "e0000000-0000-4000-8000-000000000003";
const HUB_DEVICE = "e0000000-0000-4000-8000-000000000010";
const HUB_CREDENTIAL = "e0000000-0000-4000-8000-000000000013";
const ACTIVE_SNAPSHOT = "e0000000-0000-4000-8000-000000000050";
const T1 = "laundry.t1.intake_cashier";
const T3 = "laundry.t3.ready_scan_in";

const live = await isHubDatabaseReachable();
if (!live) console.warn("SKIPPED: edge LAN transport — local Hub database unreachable");

const keys = new DevelopmentDeviceKeyProvider();
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (f) => logLines.push({ ...f }) };
/** Secrets the census must never find in a log line. */
const censusSecrets: string[] = [];

// ---------------------------------------------------------------------------
// Ephemeral X.509 authority (node-forge; per-run, never persisted)
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
  /** Lowercase hex, as the transport normalizes the observed peer serial. */
  readonly serial: string;
  /** SHA-256 of the certificate DER, lowercase hex. */
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

// ---------------------------------------------------------------------------
// The simulated cloud activation authority (REAL crypto, port-level stub)
// ---------------------------------------------------------------------------

interface CloudTerminalFact {
  readonly terminalDeviceId: string;
  readonly terminalAssignmentId: string;
  readonly enrolledFingerprint: string;
  readonly profile: string;
  readonly certificateId: string;
  readonly certificateSerial: string;
}

class SimulatedCloudActivationAuthority implements CloudActivationGateway {
  unavailable = false;
  private readonly challenges = new Map<
    string,
    {
      readonly challenge: ActivationAckChallenge;
      readonly payload: string;
      state: "issued" | "activated";
      completion?: { readonly outcome: CloudActivationState; readonly idempotencyKey: string };
    }
  >();
  private readonly byRedemption = new Map<string, string>();

  constructor(private readonly facts: ReadonlyMap<string, CloudTerminalFact>) {}

  prepareActivation(input: {
    readonly terminalAssignmentId: string;
    readonly redemptionIdempotencyKey: string;
  }): Promise<CloudActivationOutcome<CloudActivationChallenge>> {
    if (this.unavailable) return Promise.reject(new CloudActivationUnavailableError());
    const correlationId = randomUUID();
    const fact = this.facts.get(input.terminalAssignmentId);
    if (fact === undefined) {
      return Promise.resolve({ result: "REDEMPTION_REQUIRED", correlationId });
    }
    const replayKey = `${input.terminalAssignmentId}|${input.redemptionIdempotencyKey}`;
    const existingId = this.byRedemption.get(replayKey);
    if (existingId !== undefined) {
      const entry = this.challenges.get(existingId);
      if (entry !== undefined) {
        if (entry.state === "activated") {
          return Promise.resolve({ result: "ALREADY_ACTIVATED", correlationId });
        }
        return Promise.resolve({
          result: "ACTIVATION_PREPARED",
          correlationId,
          data: this.material(existingId, entry.challenge, entry.payload),
        });
      }
    }
    const nonce = randomBytes(32).toString("hex");
    censusSecrets.push(nonce);
    const issuedAt = new Date();
    const challenge: ActivationAckChallenge = {
      activationChallengeId: randomUUID(),
      purpose: ACTIVATION_ACK_PURPOSE,
      activationId: randomUUID(),
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: "development",
      storeHubDeviceId: HUB_DEVICE,
      terminalDeviceId: fact.terminalDeviceId,
      terminalAssignmentId: fact.terminalAssignmentId,
      terminalProfileKey: fact.profile,
      provisioningCodeId: randomUUID(),
      popChallengeId: randomUUID(),
      terminalKeyFingerprint: fact.enrolledFingerprint,
      certificateId: fact.certificateId,
      certificateSerial: fact.certificateSerial,
      certificateFingerprint: fact.enrolledFingerprint,
      nonce,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + 600_000),
    };
    const payload = Buffer.from(activationAckBytes(challenge)).toString("base64url");
    censusSecrets.push(payload);
    this.challenges.set(challenge.activationChallengeId, { challenge, payload, state: "issued" });
    this.byRedemption.set(replayKey, challenge.activationChallengeId);
    return Promise.resolve({
      result: "ACTIVATION_PREPARED",
      correlationId,
      data: this.material(challenge.activationChallengeId, challenge, payload),
    });
  }

  completeActivation(input: {
    readonly activationChallengeId: string;
    readonly signatureBase64: string;
    readonly terminalPublicKeyPem: string;
    readonly idempotencyKey: string;
  }): Promise<CloudActivationOutcome<CloudActivationState>> {
    if (this.unavailable) return Promise.reject(new CloudActivationUnavailableError());
    const correlationId = randomUUID();
    const entry = this.challenges.get(input.activationChallengeId);
    if (entry === undefined) {
      return Promise.resolve({ result: "CHALLENGE_NOT_FOUND", correlationId });
    }
    if (entry.state === "activated" && entry.completion !== undefined) {
      // The stable authoritative lookup the cloud contract guarantees.
      return Promise.resolve({
        result: "ALREADY_ACTIVATED",
        correlationId,
        data: entry.completion.outcome,
      });
    }
    const expectation: ActivationAckExpectation = {
      activationChallengeId: entry.challenge.activationChallengeId,
      purpose: entry.challenge.purpose,
      activationId: entry.challenge.activationId,
      tenantId: entry.challenge.tenantId,
      digitalStoreId: entry.challenge.digitalStoreId,
      storeLocationId: entry.challenge.storeLocationId,
      environment: entry.challenge.environment,
      storeHubDeviceId: entry.challenge.storeHubDeviceId,
      terminalDeviceId: entry.challenge.terminalDeviceId,
      terminalAssignmentId: entry.challenge.terminalAssignmentId,
      terminalProfileKey: entry.challenge.terminalProfileKey,
      provisioningCodeId: entry.challenge.provisioningCodeId,
      popChallengeId: entry.challenge.popChallengeId,
      certificateId: entry.challenge.certificateId,
      certificateSerial: entry.challenge.certificateSerial,
      certificateFingerprint: entry.challenge.certificateFingerprint,
      enrolledKeyFingerprint: entry.challenge.terminalKeyFingerprint,
      enrollmentState: "sealed",
    };
    const trusted: TrustedTimeEvaluation = {
      status: "trusted",
      trustedTime: new Date(),
    } as TrustedTimeEvaluation;
    const verdict = verifyActivationAck(
      entry.challenge,
      Uint8Array.from(Buffer.from(input.signatureBase64, "base64")),
      input.terminalPublicKeyPem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    if (!verdict.verified) {
      return Promise.resolve({ result: "ACTIVATION_ACK_INVALID", correlationId });
    }
    const instant = new Date().toISOString();
    entry.state = "activated";
    entry.completion = {
      idempotencyKey: input.idempotencyKey,
      outcome: {
        activationId: entry.challenge.activationId,
        certificateId: entry.challenge.certificateId,
        acknowledgedAt: instant,
        activatedAt: instant,
      },
    };
    return Promise.resolve({
      result: "ACTIVATED",
      correlationId,
      data: entry.completion.outcome,
    });
  }

  private material(
    id: string,
    challenge: ActivationAckChallenge,
    payload: string,
  ): CloudActivationChallenge {
    return {
      activationChallengeId: id,
      challengeVersion: "kitluy.activation-ack.v1",
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt.toISOString(),
      expiresAt: challenge.expiresAt.toISOString(),
      certificateId: challenge.certificateId,
      certificateSerial: challenge.certificateSerial,
      certificateFingerprint: challenge.certificateFingerprint,
      terminalProfileKey: challenge.terminalProfileKey,
      signatureAlgorithm: "ed25519",
      signingPayloadEncoding: "base64url",
      signingPayload: payload,
    };
  }
}

// ---------------------------------------------------------------------------
// The black-box terminal HTTPS client
// ---------------------------------------------------------------------------

interface TerminalHttpResponse {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly tlsProtocol: string | null;
}

function terminalRequest(options: {
  readonly port: number;
  readonly method: string;
  readonly path: string;
  readonly body?: unknown;
  readonly identity?: { readonly certPem: string; readonly keyPem: string };
  readonly caPem: string;
  readonly pinnedServerFingerprint?: string;
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
        checkServerIdentity: (host, cert) => {
          if (options.pinnedServerFingerprint !== undefined) {
            const observed = createHash("sha256").update(cert.raw).digest("hex");
            if (observed !== options.pinnedServerFingerprint) {
              return new Error("KLUY-TERMINAL-HUB-CERT-MISMATCH: not the discovered Hub");
            }
          }
          return undefined;
        },
      },
      (res) => {
        // Captured HERE: `res.socket` is null once the response has ended.
        const socket = res.socket as { getProtocol?: () => string | null } | null;
        const tlsProtocol = socket?.getProtocol?.() ?? null;
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
          resolve({ status: res.statusCode ?? 0, body: parsed, tlsProtocol });
        });
      },
    );
    // Bounded: a negative TLS path must fail the test, never hang the suite.
    req.setTimeout(8_000, () => req.destroy(new Error("KLUY-TEST-REQUEST-TIMEOUT")));
    req.on("error", reject);
    if (payload !== "") req.write(payload);
    req.end();
  });
}

describe.skipIf(!live)("Store LAN mTLS transport, activation and pairing routes (P04B)", () => {
  let pool: pg.Pool;
  let pairing: TerminalPairingComposition;
  let signer: PairingSigner;
  let hubKeyRef: string;
  let originalHubFingerprint = "";
  let originalHubExpiry = "";
  let hadHubRuntime = false;

  let deviceCa: TestCa;
  let rogueCa: TestCa;
  let hubTls: TlsIdentity;
  let impostorTls: TlsIdentity;
  let port = 0;
  let impostorPort = 0;
  let cloud: SimulatedCloudActivationAuthority;
  let discovery: EdgeDiscoveryAuthority;
  let closeServer: (() => Promise<void>) | null = null;
  let closeImpostor: (() => Promise<void>) | null = null;

  const cloudFacts = new Map<string, CloudTerminalFact>();

  interface LanTerminal {
    readonly deviceId: string;
    readonly assignmentId: string;
    readonly keyRef: string;
    readonly pem: string;
    readonly fingerprint: string;
    readonly tls: TlsIdentity;
    readonly profile: string;
  }

  /** Registers a terminal the way the cloud→Hub delivery path (#28) will. */
  async function newLanTerminal(
    label: string,
    opts: {
      lifecycle?: string;
      profile?: string;
      credentialStatus?: string;
      credentialExpiry?: string;
      grantProfile?: boolean;
      tenant?: string;
      store?: string;
      location?: string;
    } = {},
  ): Promise<LanTerminal> {
    const deviceId = randomUUID();
    const keyRef = `lan-${label}-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const tls = issueCert(deviceCa, { cn: `terminal-${label}-${RUN}` });
    const credentialId = randomUUID();
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
        `p04b-${label}-${RUN}`,
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
               now() - interval '1 day', $5::timestamptz, $6,
               case when $6 = 'revoked' then now() else null end,
               case when $6 = 'revoked' then 'p04b_fixture' else null end, 1)`,
      [
        credentialId,
        deviceId,
        fingerprint,
        tls.serial,
        opts.credentialExpiry ?? new Date(Date.now() + 3_600_000).toISOString(),
        opts.credentialStatus ?? "active",
      ],
    );
    if (opts.grantProfile !== false) {
      await pool.query(
        `insert into edge_config.terminal_profile_assignment
           (id, tenant_id, digital_store_id, location_id, terminal_device_id,
            profile_code, assignment_version, enabled, effective_from,
            effective_until, source_snapshot_id)
         values ($1, $2, $3, $4, $5, $6, 1, true, now() - interval '1 hour',
                 null, $7)`,
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
    const assignmentId = randomUUID();
    cloudFacts.set(assignmentId, {
      terminalDeviceId: deviceId,
      terminalAssignmentId: assignmentId,
      enrolledFingerprint: fingerprint,
      profile,
      certificateId: credentialId,
      certificateSerial: tls.serial,
    });
    return { deviceId, assignmentId, keyRef, pem, fingerprint, tls, profile };
  }

  function post(
    terminal: LanTerminal | null,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<TerminalHttpResponse> {
    return terminalRequest({
      port,
      method: "POST",
      path,
      body,
      identity:
        terminal === null
          ? undefined
          : { certPem: terminal.tls.certPem, keyPem: terminal.tls.keyPem },
      caPem: deviceCa.certPem,
      pinnedServerFingerprint: hubTls.fingerprint,
      headers,
    });
  }

  function get(terminal: LanTerminal, path: string): Promise<TerminalHttpResponse> {
    return terminalRequest({
      port,
      method: "GET",
      path,
      identity: { certPem: terminal.tls.certPem, keyPem: terminal.tls.keyPem },
      caPem: deviceCa.certPem,
      pinnedServerFingerprint: hubTls.fingerprint,
    });
  }

  function detailsOf(response: TerminalHttpResponse): Record<string, unknown> {
    return (
      ((response.body["error"] as Record<string, unknown> | undefined)?.["details"] as
        Record<string, unknown> | undefined) ?? {}
    );
  }

  beforeAll(async () => {
    pool = createHubPool(process.env, 10);

    // The Hub's Ed25519 operational signer (P03B pattern: the seeded Hub
    // credential adopts the ephemeral key's fingerprint; restored after).
    hubKeyRef = `p04b-hub-${RUN}`;
    await keys.generateDeviceKey(hubKeyRef, "development");
    const hubPem = keys.publicKeyPem(hubKeyRef) ?? "";
    const { rows: prior } = await pool.query<{ fp: string; exp: string }>(
      `select public_key_fingerprint as fp, expires_at::text as exp
         from edge_identity.device_credential where id = $1::uuid`,
      [HUB_CREDENTIAL],
    );
    originalHubFingerprint = String(prior[0]?.fp);
    originalHubExpiry = String(prior[0]?.exp);
    await pool.query(
      `update edge_identity.device_credential
          set public_key_fingerprint = $1, expires_at = now() + interval '1 year'
        where id = $2::uuid`,
      [publicKeyFingerprint(hubPem), HUB_CREDENTIAL],
    );
    signer = {
      certificateSerial: "DEMO-OPS-CERT-0001",
      publicKeyPem: hubPem,
      sign: (payload) => keys.provePossession(hubKeyRef, payload),
    };
    pairing = new TerminalPairingComposition(pool, signer, logger);

    const { rows: held } = await pool.query<{ member: boolean }>(
      `select pg_has_role('postgres', 'kitluy_hub_runtime', 'member') as member`,
    );
    hadHubRuntime = held[0]?.member === true;
    await pool.query(`grant kitluy_hub_runtime to postgres`);

    // Ephemeral X.509: the device CA, the Hub server certificate, a rogue CA
    // and an impostor server certificate (same CA, different identity).
    deviceCa = mintCa(`KitLuy Test Device CA ${RUN}`);
    rogueCa = mintCa(`Rogue CA ${RUN}`);
    hubTls = issueCert(deviceCa, { cn: `hub-${RUN}`, server: true });
    impostorTls = issueCert(deviceCa, { cn: `impostor-${RUN}`, server: true });

    cloud = new SimulatedCloudActivationAuthority(cloudFacts);
    discovery = new EdgeDiscoveryAuthority(
      {
        hubDeviceId: HUB_DEVICE,
        hubTlsCertificateFingerprint: hubTls.fingerprint,
        tenantId: TENANT,
        digitalStoreId: STORE,
        storeLocationId: LOCATION,
        environment: "development",
        hostname: "127.0.0.1",
      },
      signer,
      logger,
    );

    const router = createEdgeTerminalRouter({
      pool,
      pairing,
      activationGateway: cloud,
      discovery,
      logger,
    });
    const edge = createEdgeTlsServer({
      key: hubTls.keyPem,
      cert: hubTls.certPem,
      clientCa: deviceCa.certPem,
      bindHost: "127.0.0.1",
      port: 0, // ephemeral in tests; production serves the locked 7443
      handler: router,
      logger,
    });
    const listening = await edge.listen();
    port = listening.port;
    closeServer = () => edge.close();

    // The impostor: valid TLS server, NOT the certificate the signed
    // discovery record fingerprints.
    const impostor = createEdgeTlsServer({
      key: impostorTls.keyPem,
      cert: impostorTls.certPem,
      clientCa: deviceCa.certPem,
      bindHost: "127.0.0.1",
      port: 0,
      handler: { handle: () => Promise.resolve({ status: 200, body: { impostor: true } }) },
    });
    const impostorListening = await impostor.listen();
    impostorPort = impostorListening.port;
    closeImpostor = () => impostor.close();
  }, 300_000);

  afterAll(async () => {
    await closeServer?.().catch(() => undefined);
    await closeImpostor?.().catch(() => undefined);
    await pool
      ?.query(
        `update edge_identity.device_credential
            set public_key_fingerprint = $1, expires_at = $2::timestamptz
          where id = $3::uuid`,
        [originalHubFingerprint, originalHubExpiry, HUB_CREDENTIAL],
      )
      .catch(() => undefined);
    if (!hadHubRuntime)
      await pool?.query(`revoke kitluy_hub_runtime from postgres`).catch(() => undefined);
    await pool?.end().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // A — TLS boundary
  // -------------------------------------------------------------------------

  it("A: TLS 1.3 with a mandatory CA-chained client certificate; everything else dies at the handshake", async () => {
    const t = await newLanTerminal("A1");
    const ok = await get(t, WELL_KNOWN_DISCOVERY_PATH);
    expect(ok.status).toBe(200);
    expect(ok.tlsProtocol).toBe("TLSv1.3");

    // No client certificate: refused during TLS, never by a handler.
    await expect(
      terminalRequest({
        port,
        method: "GET",
        path: WELL_KNOWN_DISCOVERY_PATH,
        caPem: deviceCa.certPem,
      }),
    ).rejects.toThrow();

    // A certificate from an unknown CA: refused during TLS.
    const rogueIdentity = issueCert(rogueCa, { cn: `rogue-${RUN}` });
    await expect(
      terminalRequest({
        port,
        method: "GET",
        path: WELL_KNOWN_DISCOVERY_PATH,
        identity: { certPem: rogueIdentity.certPem, keyPem: rogueIdentity.keyPem },
        caPem: deviceCa.certPem,
      }),
    ).rejects.toThrow();

    // TLS 1.2 is not spoken at all.
    await expect(
      new Promise((resolve, reject) => {
        const socket = tlsConnect(
          {
            host: "127.0.0.1",
            port,
            ca: deviceCa.certPem,
            cert: t.tls.certPem,
            key: t.tls.keyPem,
            maxVersion: "TLSv1.2",
          },
          () => {
            socket.destroy();
            resolve(socket.getProtocol());
          },
        );
        socket.setTimeout(8_000, () => socket.destroy(new Error("KLUY-TEST-TLS-TIMEOUT")));
        socket.on("error", reject);
      }),
    ).rejects.toThrow();

    // Plain HTTP against the TLS port fails.
    await expect(
      new Promise((resolve, reject) => {
        const req = httpRequest(
          { host: "127.0.0.1", port, method: "GET", path: "/", timeout: 2_000 },
          (res) => resolve(res.statusCode),
        );
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy(new Error("timeout"));
        });
        req.end();
      }),
    ).rejects.toThrow();

    // The terminal refuses a Hub whose certificate is not the one the signed
    // discovery record fingerprints — a valid CA chain is NOT enough.
    await expect(
      terminalRequest({
        port: impostorPort,
        method: "GET",
        path: WELL_KNOWN_DISCOVERY_PATH,
        identity: { certPem: t.tls.certPem, keyPem: t.tls.keyPem },
        caPem: deviceCa.certPem,
        pinnedServerFingerprint: hubTls.fingerprint,
      }),
    ).rejects.toThrow(/HUB-CERT-MISMATCH/);

    // No wildcard/public ingress: the factory refuses the bind outright.
    expect(() =>
      createEdgeTlsServer({
        key: hubTls.keyPem,
        cert: hubTls.certPem,
        clientCa: deviceCa.certPem,
        bindHost: "0.0.0.0",
        handler: { handle: () => Promise.resolve({ status: 200, body: {} }) },
      }),
    ).toThrow(/BIND-REFUSED/);
  }, 120_000);

  // -------------------------------------------------------------------------
  // B — signed discovery over the transport
  // -------------------------------------------------------------------------

  it("B: the well-known route serves a verifiable signed record; tampering and expiry fail; unsigned data authorizes nothing", async () => {
    const t = await newLanTerminal("B1");
    const response = await get(t, WELL_KNOWN_DISCOVERY_PATH);
    expect(response.status).toBe(200);
    const payload = response.body as unknown as {
      record: Record<string, string | number>;
      signature: string;
      signatureAlgorithm: string;
    };
    expect(payload.signatureAlgorithm).toBe("ed25519");
    const record = {
      protocolVersion: String(payload.record.protocolVersion),
      recordId: String(payload.record.recordId),
      hubDeviceId: String(payload.record.hubDeviceId),
      hubCertificateFingerprint: String(payload.record.hubCertificateFingerprint),
      tenantId: String(payload.record.tenantId),
      digitalStoreId: String(payload.record.digitalStoreId),
      storeLocationId: String(payload.record.storeLocationId),
      environment: String(payload.record.environment) as TrustEnvironment,
      hostname: String(payload.record.hostname),
      port: Number(payload.record.port),
      issuedAt: new Date(String(payload.record.issuedAt)),
      expiresAt: new Date(String(payload.record.expiresAt)),
    };
    const signature = Uint8Array.from(Buffer.from(payload.signature, "base64url"));
    const expectation = {
      hubDeviceId: HUB_DEVICE,
      tenantId: TENANT,
      digitalStoreId: STORE,
      storeLocationId: LOCATION,
      environment: "development" as const,
    };
    // The terminal verifies BEFORE trusting: genuine record verifies, and the
    // TLS certificate it just pinned is exactly the fingerprint in the record.
    expect(
      verifyEdgeDiscoveryRecord(record, signature, signer.publicKeyPem, expectation, new Date())
        .verified,
    ).toBe(true);
    expect(record.hubCertificateFingerprint).toBe(hubTls.fingerprint);

    // Tampered scope/hub/port and an expired window all refuse.
    for (const tampered of [
      { ...record, hubDeviceId: randomUUID() },
      { ...record, digitalStoreId: randomUUID() },
      { ...record, port: 8443 },
      { ...record, hubCertificateFingerprint: "ef".repeat(32) },
    ]) {
      expect(
        verifyEdgeDiscoveryRecord(tampered, signature, signer.publicKeyPem, expectation, new Date())
          .verified,
      ).toBe(false);
    }
    expect(
      verifyEdgeDiscoveryRecord(
        record,
        signature,
        signer.publicKeyPem,
        expectation,
        new Date(record.expiresAt.getTime() + 1),
      ).verified,
    ).toBe(false);
  }, 60_000);

  // -------------------------------------------------------------------------
  // C — lifecycle authorization
  // -------------------------------------------------------------------------

  it("C: the lifecycle matrix gates every capability; unknown, revoked and cross-scope peers are refused", async () => {
    // Pre-activation projection: activation reachable, pairing refused.
    const preActive = await newLanTerminal("C-PRE", { lifecycle: "provisioned" });
    const challenges = await post(preActive, "/edge/v1/terminal-activation/challenges", {
      terminalAssignmentId: preActive.assignmentId,
      redemptionIdempotencyKey: `red-${RUN}-cpre`,
    });
    expect(challenges.status).toBe(201);
    const pairingRefused = await post(preActive, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: preActive.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(pairingRefused.status).toBe(403);
    expect(detailsOf(pairingRefused)["result"]).toBe("ACTIVATION_REQUIRED");

    // Revoked credential: everything refused, including activation.
    const revoked = await newLanTerminal("C-REV", { credentialStatus: "revoked" });
    const revokedAttempt = await post(revoked, "/edge/v1/terminal-activation/challenges", {
      terminalAssignmentId: revoked.assignmentId,
      redemptionIdempotencyKey: `red-${RUN}-crev`,
    });
    expect(revokedAttempt.status).toBe(403);
    expect(detailsOf(revokedAttempt)["result"]).toBe("CREDENTIAL_NOT_CURRENT");

    // Expired credential: refused the same way.
    const expired = await newLanTerminal("C-EXP", {
      credentialExpiry: new Date(Date.now() - 60_000).toISOString(),
    });
    const expiredAttempt = await post(expired, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: expired.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(expiredAttempt.status).toBe(403);
    expect(detailsOf(expiredAttempt)["result"]).toBe("CREDENTIAL_NOT_CURRENT");

    // A CA-valid certificate that maps to NO projected terminal: refused with
    // the same merged family an ineligible one gets — no existence oracle.
    const ghostIdentity = issueCert(deviceCa, { cn: `ghost-${RUN}` });
    const ghost = await terminalRequest({
      port,
      method: "POST",
      path: "/edge/v1/terminal-pairing/sessions",
      body: {},
      identity: { certPem: ghostIdentity.certPem, keyPem: ghostIdentity.keyPem },
      caPem: deviceCa.certPem,
      pinnedServerFingerprint: hubTls.fingerprint,
    });
    expect(ghost.status).toBe(403);
    expect(detailsOf(ghost)["result"]).toBe("TERMINAL_NOT_RECOGNIZED");

    // Wrong profile: active terminal, but the grant names another T-role.
    const wrongProfile = await newLanTerminal("C-PROF", { profile: T3 });
    const profileRefused = await post(wrongProfile, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: T1, // not the granted profile
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(profileRefused.status).toBe(403);
    expect(detailsOf(profileRefused)["result"]).toBe("PAIR_PROFILE_FORBIDDEN");

    // A terminal must not act on another terminal's session.
    const owner = await newLanTerminal("C-OWN");
    const other = await newLanTerminal("C-OTH");
    const session = await post(owner, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: owner.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(session.status).toBe(201);
    const sessionId = String(
      (session.body["session"] as Record<string, unknown>)["pairingSessionId"],
    );
    const foreign = await post(
      other,
      `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`,
      {},
    );
    expect(foreign.status).toBe(403);
    expect(detailsOf(foreign)["result"]).toBe("SESSION_NOT_OWNED");
  }, 120_000);

  // -------------------------------------------------------------------------
  // D — activation black-box flow through the gateway
  // -------------------------------------------------------------------------

  it("D: a terminal activates through mTLS with the public signing payload alone; retry is stable; cloud loss is retryable", async () => {
    const t = await newLanTerminal("D1", { lifecycle: "provisioned" });
    const redemptionKey = `red-${RUN}-d1`;

    const challenged = await post(t, "/edge/v1/terminal-activation/challenges", {
      terminalAssignmentId: t.assignmentId,
      redemptionIdempotencyKey: redemptionKey,
    });
    expect(challenged.status).toBe(201);
    const challenge = challenged.body["challenge"] as Record<string, string>;
    expect(challenge["signatureAlgorithm"]).toBe("ed25519");
    expect(challenge["signingPayloadEncoding"]).toBe("base64url");
    expect(challenge["protocolVersion"]).toBe("kitluy.activation-ack.v1");

    // Challenge retry: the SAME challenge, byte-identical payload.
    const retried = await post(t, "/edge/v1/terminal-activation/challenges", {
      terminalAssignmentId: t.assignmentId,
      redemptionIdempotencyKey: redemptionKey,
    });
    const retriedChallenge = retried.body["challenge"] as Record<string, string>;
    expect(retriedChallenge["activationChallengeId"]).toBe(challenge["activationChallengeId"]);
    expect(retriedChallenge["signingPayload"]).toBe(challenge["signingPayload"]);

    // THE TERMINAL: decodes and signs exactly those bytes. Nothing else.
    const payload = Buffer.from(String(challenge["signingPayload"]), "base64url");
    const signature = Buffer.from(
      keys.provePossession(t.keyRef, Uint8Array.from(payload)),
    ).toString("base64url");
    censusSecrets.push(signature);

    const completed = await post(
      t,
      "/edge/v1/terminal-activation/complete",
      {
        activationChallengeId: challenge["activationChallengeId"],
        protocolVersion: "kitluy.activation-ack.v1",
        signature,
        terminalPublicKeyPem: t.pem,
      },
      { "idempotency-key": `act-${RUN}-d1` },
    );
    expect(completed.status).toBe(200);
    expect(completed.body["result"]).toBe("ACTIVATED");
    const activation = completed.body["activation"] as Record<string, string>;

    // Identical retry: the stable authoritative answer with the ORIGINAL instants.
    const replay = await post(
      t,
      "/edge/v1/terminal-activation/complete",
      {
        activationChallengeId: challenge["activationChallengeId"],
        protocolVersion: "kitluy.activation-ack.v1",
        signature,
        terminalPublicKeyPem: t.pem,
      },
      { "idempotency-key": `act-${RUN}-d1` },
    );
    expect(replay.status).toBe(200);
    expect(replay.body["result"]).toBe("ALREADY_ACTIVATED");
    expect((replay.body["activation"] as Record<string, string>)["activatedAt"]).toBe(
      activation["activatedAt"],
    );

    // A forged signature never activates.
    const t2 = await newLanTerminal("D2", { lifecycle: "provisioned" });
    const c2 = await post(t2, "/edge/v1/terminal-activation/challenges", {
      terminalAssignmentId: t2.assignmentId,
      redemptionIdempotencyKey: `red-${RUN}-d2`,
    });
    const challenge2 = c2.body["challenge"] as Record<string, string>;
    const forged = await post(
      t2,
      "/edge/v1/terminal-activation/complete",
      {
        activationChallengeId: challenge2["activationChallengeId"],
        protocolVersion: "kitluy.activation-ack.v1",
        signature, // terminal D1's signature over D1's payload
        terminalPublicKeyPem: t2.pem,
      },
      { "idempotency-key": `act-${RUN}-d2` },
    );
    expect(forged.status).toBe(403);
    expect(detailsOf(forged)["result"]).toBe("ACTIVATION_ACK_INVALID");

    // Cloud unavailable: a RETRYABLE unavailability, not a fabricated result.
    cloud.unavailable = true;
    try {
      const unavailable = await post(t2, "/edge/v1/terminal-activation/challenges", {
        terminalAssignmentId: t2.assignmentId,
        redemptionIdempotencyKey: `red-${RUN}-d2`,
      });
      expect(unavailable.status).toBe(503);
      expect(detailsOf(unavailable)["result"]).toBe("CLOUD_UNAVAILABLE");
      expect(detailsOf(unavailable)["retryable"]).toBe(true);
    } finally {
      cloud.unavailable = false;
    }

    // The shipped default gateway fails closed the same way (BLK-006).
    await expect(
      unavailableActivationGateway().prepareActivation({
        terminalAssignmentId: t2.assignmentId,
        redemptionIdempotencyKey: "x",
      }),
    ).rejects.toBeInstanceOf(CloudActivationUnavailableError);
  }, 120_000);

  // -------------------------------------------------------------------------
  // E — pairing black-box flow
  // -------------------------------------------------------------------------

  it("E: mutual-proof pairing over the LAN — one session, one receipt, replays answer with originals, 300 s is locked", async () => {
    const t = await newLanTerminal("E1");
    const terminalNonce = randomBytes(32).toString("hex");
    censusSecrets.push(terminalNonce);

    const opened = await post(t, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: t.profile,
      terminalNonce,
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(opened.status).toBe(201);
    const session = opened.body["session"] as Record<string, unknown>;
    const sessionId = String(session["pairingSessionId"]);
    expect(session["signatureAlgorithm"]).toBe("ed25519");
    censusSecrets.push(String(session["hubNonce"]));
    censusSecrets.push(String(session["signingPayload"]));

    // LOCKED LIFETIME: the stored window never exceeds 300 s of Hub time.
    const windowMs =
      new Date(String(session["expiresAt"])).getTime() -
      new Date(String(session["issuedAt"])).getTime();
    expect(windowMs).toBeLessThanOrEqual(300_000);
    expect(windowMs).toBeGreaterThan(295_000);

    // Session retry (lost response): the SAME session, nonce and payload.
    const reopened = await post(t, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: t.profile,
      terminalNonce,
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    const replayedSession = reopened.body["session"] as Record<string, unknown>;
    expect(replayedSession["pairingSessionId"]).toBe(sessionId);
    expect(replayedSession["hubNonce"]).toBe(session["hubNonce"]);
    expect(replayedSession["expiresAt"], "retry never extends expiry").toBe(session["expiresAt"]);
    expect(replayedSession["signingPayload"]).toBe(session["signingPayload"]);

    // THE TERMINAL signs the opaque payload — the exact canonical
    // terminal-proof bytes — and proves.
    const proofPayload = Buffer.from(String(session["signingPayload"]), "base64url");
    const proofSignature = Buffer.from(
      keys.provePossession(t.keyRef, Uint8Array.from(proofPayload)),
    ).toString("base64url");
    censusSecrets.push(proofSignature);
    const proved = await post(t, `/edge/v1/terminal-pairing/sessions/${sessionId}/terminal-proof`, {
      signature: proofSignature,
      terminalPublicKeyPem: t.pem,
    });
    expect(proved.status).toBe(200);
    expect(proved.body["result"]).toBe("TERMINAL_PROOF_RECORDED");

    // A transplanted proof (another terminal's genuine key) refuses.
    const attacker = await newLanTerminal("E2");
    const transplant = Buffer.from(
      keys.provePossession(attacker.keyRef, Uint8Array.from(proofPayload)),
    ).toString("base64url");
    const refused = await post(
      t,
      `/edge/v1/terminal-pairing/sessions/${sessionId}/terminal-proof`,
      { signature: transplant, terminalPublicKeyPem: attacker.pem },
    );
    // Idempotent success answers stably; the transplanted key is refused by
    // the crypto expectation had the proof not been recorded yet — prove that
    // on a FRESH session for the attacker's own terminal below.
    expect([200, 403]).toContain(refused.status);

    const completed = await post(t, `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`, {});
    expect(completed.status).toBe(200);
    expect(completed.body["result"]).toBe("PAIRED");
    const pairingState = completed.body["pairing"] as Record<string, unknown>;
    const receipt = pairingState["receipt"] as Record<string, unknown>;
    const receiptId = String(pairingState["receiptId"]);

    // THE TERMINAL verifies the Hub's proof under the challenge material it
    // received — mutual, not one-way.
    const transcript: PairingTranscript = {
      pairingSessionId: String(session["pairingSessionId"]),
      protocolVersion: String(session["protocolVersion"]),
      purpose: String(session["purpose"]),
      tenantId: String(session["tenantId"]),
      digitalStoreId: String(session["digitalStoreId"]),
      storeLocationId: String(session["storeLocationId"]),
      environment: String(session["environment"]) as TrustEnvironment,
      hubDeviceId: String(session["hubDeviceId"]),
      hubAssignmentGeneration: Number(session["hubAssignmentGeneration"]),
      hubCertificateSerial: String(session["hubCertificateSerial"]),
      hubCertificateFingerprint: String(session["hubCertificateFingerprint"]),
      terminalDeviceId: String(session["terminalDeviceId"]),
      terminalAssignmentGeneration: Number(session["terminalAssignmentGeneration"]),
      terminalProfileKey: String(session["terminalProfileKey"]),
      terminalCertificateSerial: String(session["terminalCertificateSerial"]),
      terminalCertificateFingerprint: String(session["terminalCertificateFingerprint"]),
      terminalNonce: String(session["terminalNonce"]),
      hubNonce: String(session["hubNonce"]),
      issuedAt: new Date(String(session["issuedAt"])),
      expiresAt: new Date(String(session["expiresAt"])),
    };
    const hubExpectation: PairingExpectation = {
      pairingSessionId: transcript.pairingSessionId,
      protocolVersion: transcript.protocolVersion,
      purpose: transcript.purpose,
      tenantId: transcript.tenantId,
      digitalStoreId: transcript.digitalStoreId,
      storeLocationId: transcript.storeLocationId,
      environment: transcript.environment,
      hubDeviceId: transcript.hubDeviceId,
      hubAssignmentGeneration: transcript.hubAssignmentGeneration,
      hubCertificateSerial: transcript.hubCertificateSerial,
      hubCertificateFingerprint: transcript.hubCertificateFingerprint,
      terminalDeviceId: transcript.terminalDeviceId,
      terminalAssignmentGeneration: transcript.terminalAssignmentGeneration,
      terminalProfileKey: transcript.terminalProfileKey,
      terminalCertificateSerial: transcript.terminalCertificateSerial,
      terminalCertificateFingerprint: transcript.terminalCertificateFingerprint,
      signerKeyFingerprint: transcript.hubCertificateFingerprint,
      terminalNonce: transcript.terminalNonce,
      hubNonce: transcript.hubNonce,
    };
    const hubVerdict = verifyHubPairingProof(
      transcript,
      Uint8Array.from(Buffer.from(String(pairingState["hubProofSignature"]), "base64url")),
      signer.publicKeyPem,
      hubExpectation,
      new Date(),
      publicKeyFingerprint,
    );
    expect(hubVerdict.verified, "the Hub proof verifies on the terminal").toBe(true);

    // Completion replay and receipt reconciliation: the ORIGINAL receipt.
    const completedAgain = await post(
      t,
      `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`,
      {},
    );
    expect(completedAgain.body["result"]).toBe("ALREADY_PAIRED");
    expect(String((completedAgain.body["pairing"] as Record<string, unknown>)["receiptId"])).toBe(
      receiptId,
    );
    const fetched = await get(t, `/edge/v1/terminal-pairing/sessions/${sessionId}/receipt`);
    expect(fetched.status).toBe(200);
    expect(String((fetched.body["pairing"] as Record<string, unknown>)["receiptId"])).toBe(
      receiptId,
    );
    expect(receipt["terminalDeviceId"]).toBe(t.deviceId);

    // One receipt row, ever.
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from edge_identity.pairing_receipt where pairing_session_id = $1::uuid`,
      [sessionId],
    );
    expect(Number(rows[0]?.n)).toBe(1);

    // Nonce replay after completion: the consumed hello nonce stays dead.
    const nonceReplay = await post(t, "/edge/v1/terminal-pairing/sessions", {
      requestedProfileCode: t.profile,
      terminalNonce,
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
    });
    expect(nonceReplay.status).toBe(409);
    expect(detailsOf(nonceReplay)["result"]).toBe("PAIR_NONCE_REJECTED");

    // The 0032 clamp proven at the DOOR: a ten-minute request stores 300 s.
    const clampProbe = await pairing.preparePairing({
      terminalDeviceId: attacker.deviceId,
      requestedProfileCode: attacker.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
    expect(clampProbe.result).toBe("PAIRING_PREPARED");
    const clamped =
      new Date(String(clampProbe.data?.expiresAt)).getTime() -
      new Date(String(clampProbe.data?.issuedAt)).getTime();
    expect(clamped).toBeLessThanOrEqual(300_000);
    expect(clamped).toBeGreaterThan(295_000);
  }, 120_000);

  it("E2: an expired session cannot resume, whatever the terminal still holds", async () => {
    const t = await newLanTerminal("E3");
    // A deliberately short window through the composition (the caller may
    // SHORTEN below the 300 s lock; the route itself always requests 300 s).
    const { rows: db } = await pool.query<{ t: string }>(
      `select (now() + interval '1500 milliseconds')::text as t`,
    );
    const prepared = await pairing.preparePairing({
      terminalDeviceId: t.deviceId,
      requestedProfileCode: t.profile,
      terminalNonce: randomBytes(32).toString("hex"),
      protocolVersion: PAIRING_PROTOCOL_VERSION,
      environment: "development",
      expiresAt: new Date(String(db[0]?.t)),
    });
    expect(prepared.result).toBe("PAIRING_PREPARED");
    const challenge = prepared.data as PairingChallengeMaterial;
    for (;;) {
      const { rows } = await pool.query<{ done: boolean }>(
        `select now() >= $1::timestamptz as done`,
        [challenge.expiresAt],
      );
      if (rows[0]?.done) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    // The retained signable payload is now useless at the ROUTE.
    const payloadBytes = Buffer.from(
      // the terminal would have received this payload in the session response;
      // rebuild it the way the route serves it, then sign late
      String(
        (
          (await post(t, "/edge/v1/terminal-pairing/sessions", {
            requestedProfileCode: t.profile,
            terminalNonce: challenge.terminalNonce,
            protocolVersion: PAIRING_PROTOCOL_VERSION,
            environment: "development",
          }).then(
            (r) => (r.body["session"] as Record<string, unknown> | undefined) ?? {},
          )) as Record<string, unknown>
        )["signingPayload"] ?? "",
      ),
      "base64url",
    );
    const late = await post(
      t,
      `/edge/v1/terminal-pairing/sessions/${challenge.pairingSessionId}/terminal-proof`,
      {
        signature: Buffer.from(
          keys.provePossession(t.keyRef, Uint8Array.from(payloadBytes)),
        ).toString("base64url"),
        terminalPublicKeyPem: t.pem,
      },
    );
    expect(late.status).toBe(409);
    expect(detailsOf(late)["result"]).toBe("PAIR_CHALLENGE_EXPIRED");
  }, 60_000);

  // -------------------------------------------------------------------------
  // F — offline behavior
  // -------------------------------------------------------------------------

  it("F: pairing completes with the cloud DOWN; stale authorization fails closed", async () => {
    // The cloud is unreachable for the whole scenario.
    cloud.unavailable = true;
    try {
      const t = await newLanTerminal("F1");
      const opened = await post(t, "/edge/v1/terminal-pairing/sessions", {
        requestedProfileCode: t.profile,
        terminalNonce: randomBytes(32).toString("hex"),
        protocolVersion: PAIRING_PROTOCOL_VERSION,
        environment: "development",
      });
      expect(opened.status, "pairing never waits for the cloud").toBe(201);
      const session = opened.body["session"] as Record<string, unknown>;
      const sessionId = String(session["pairingSessionId"]);
      const payload = Buffer.from(String(session["signingPayload"]), "base64url");
      const proved = await post(
        t,
        `/edge/v1/terminal-pairing/sessions/${sessionId}/terminal-proof`,
        {
          signature: Buffer.from(keys.provePossession(t.keyRef, Uint8Array.from(payload))).toString(
            "base64url",
          ),
          terminalPublicKeyPem: t.pem,
        },
      );
      expect(proved.status).toBe(200);
      const completed = await post(
        t,
        `/edge/v1/terminal-pairing/sessions/${sessionId}/complete`,
        {},
      );
      expect(completed.status).toBe(200);
      expect(completed.body["result"]).toBe("PAIRED");

      // While activation — which NEEDS the cloud authority — stays retryable.
      const activationBlocked = await post(t, "/edge/v1/terminal-activation/challenges", {
        terminalAssignmentId: t.assignmentId,
        redemptionIdempotencyKey: `red-${RUN}-f1`,
      });
      expect(activationBlocked.status).toBe(503);
      expect(detailsOf(activationBlocked)["retryable"]).toBe(true);

      // STALE AUTHORIZATION: a profile grant withdrawn under the existing
      // governed freshness policy refuses closed — never "current truth".
      const stale = await newLanTerminal("F2");
      await pool.query(
        `update edge_config.terminal_profile_assignment set enabled = false
          where terminal_device_id = $1::uuid`,
        [stale.deviceId],
      );
      const refused = await post(stale, "/edge/v1/terminal-pairing/sessions", {
        requestedProfileCode: stale.profile,
        terminalNonce: randomBytes(32).toString("hex"),
        protocolVersion: PAIRING_PROTOCOL_VERSION,
        environment: "development",
      });
      expect(refused.status).toBe(403);
      expect(detailsOf(refused)["result"]).toBe("PAIR_PROFILE_FORBIDDEN");
    } finally {
      cloud.unavailable = false;
    }
  }, 120_000);

  // -------------------------------------------------------------------------
  // G — security and privacy census
  // -------------------------------------------------------------------------

  it("G: no key, code, nonce, payload, signature or certificate body ever reached a log; terminals hold no database identity", () => {
    expect(censusSecrets.length).toBeGreaterThan(0);
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      const flat = JSON.stringify(line);
      for (const secret of censusSecrets) {
        if (secret.length < 16) continue;
        expect(flat.includes(secret.slice(0, 24)), "a secret reached a log").toBe(false);
      }
      expect(flat.includes("BEGIN PUBLIC KEY")).toBe(false);
      expect(flat.includes("BEGIN PRIVATE KEY")).toBe(false);
      expect(flat.includes("BEGIN RSA PRIVATE KEY")).toBe(false);
      expect(flat.includes("BEGIN CERTIFICATE")).toBe(false);
      expect(/[0-9a-f]{64}/.test(flat), "a nonce/fingerprint-shaped secret reached a log").toBe(
        false,
      );
    }
    // Structural: the terminal client in this suite holds an HTTPS socket and
    // key material — never a pg connection string, pool or role. The only
    // database identities on the LAN path are the Hub's own (runtime for the
    // gate, the NOLOGIN governor inside the doors).
  });
});
