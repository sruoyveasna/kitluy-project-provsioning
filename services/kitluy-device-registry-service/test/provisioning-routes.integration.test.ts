/**
 * CLOUD TERMINAL-PROVISIONING BOOTSTRAP ROUTES — WS-11-T004-P04A scenarios A–H.
 *
 * Drives the REAL route layer over the REAL TerminalProvisioningComposition
 * against the REAL local database: every request travels the full path a
 * deployed instance serves — raw text in, content-type/size/JSON gates, the
 * owner rate limiter, whitelist validation, the governed doors under the
 * explicitly entered NOLOGIN composer (0172/0173), canonical
 * `@kitluy/api-errors` mapping out. Terminal keys are EPHEMERAL in-memory
 * Ed25519 (never committed, never reusable).
 *
 * Authority: KLD-2026-08-05-TERMINAL-TRANSPORT-001; migrations 0162–0174.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  provisioningChallengeBytes,
  type ProvisioningPopChallenge,
} from "@kitluy/device-identity";

import { withServiceRole, REGISTRY_ROLES } from "../src/database.js";
import { TerminalProvisioningComposition } from "../src/provisioning-composition.js";
import {
  BootstrapRateLimiter,
  createTerminalProvisioningRouter,
  CHALLENGE_PROTOCOL_VERSION,
  type BootstrapRouteResponse,
  type TerminalProvisioningRouter,
} from "../src/provisioning-routes.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const SOURCE_IP = "203.0.113.77";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const live = await reachable();
if (!live) console.warn("SKIPPED: provisioning routes — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
  keyRef: string;
}

const keys = new DevelopmentDeviceKeyProvider();
/** Every secret the suite ever creates, for the closing log/response census. */
const rawCodes: string[] = [];
const rawSignatures: string[] = [];
const logLines: Array<Record<string, string | number | boolean>> = [];
const captureLog = {
  info: (fields: Record<string, string | number | boolean>) => logLines.push({ ...fields }),
};

/** Standard base64 (as the harness signer emits) to unpadded base64url (the wire form). */
function toBase64Url(signatureBase64: string): string {
  return signatureBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe.skipIf(!live)("cloud terminal-provisioning bootstrap routes (P04A)", () => {
  let keeper: pg.Pool;
  let composition: TerminalProvisioningComposition;
  let router: TerminalProvisioningRouter;
  let operator = "";
  let hubE = "";
  const stations: Record<string, Station> = {};

  // -------------------------------------------------------------------------
  // Fixtures (the proven composition-suite pattern, unchanged)
  // -------------------------------------------------------------------------

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-RTE')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-RTE')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RTE')`,
      [hubId, serial, "e7".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  async function enrollDevice(
    label: string,
  ): Promise<{ id: string; pem: string; fingerprint: string; keyRef: string }> {
    const keyRef = `${label}-key-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RTE', 'OP-RTE', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `77:66:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return { id: rows[0]?.id ?? "", pem, fingerprint, keyRef };
  }

  async function newStation(label: string, location: string = LOCATION): Promise<Station> {
    const dev = await enrollDevice(label);
    await claimAndRedeem(dev.id, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RTE') as id`,
      [dev.id, location],
    );
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [dev.id],
    );
    return {
      assignmentId: rows[0]?.id ?? "",
      terminalId: dev.id,
      pem: dev.pem,
      fingerprint: dev.fingerprint,
      keyRef: dev.keyRef,
    };
  }

  async function issueCode(
    assignmentId: string,
    key: string,
  ): Promise<{ id: string; raw: string }> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, key],
      );
      await client.query("commit");
      const result = rows[0]?.result ?? {};
      expect(result.outcome).toBe("ISSUED");
      rawCodes.push(String(result.code));
      return { id: String(result.provisioning_code_id), raw: String(result.code) };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Signs the AUTHORITATIVE challenge row, as the real terminal-side client will. */
  async function signForChallenge(station: Station, challengeId: string): Promise<string> {
    const { rows } = await keeper.query(
      `select c.*, c.created_at::text as created_text, c.expires_at::text as expires_text
         from kitluy_devices.device_provisioning_pop_challenges c where c.id = $1::uuid`,
      [challengeId],
    );
    const row = rows[0] as Record<string, unknown>;
    const challenge: ProvisioningPopChallenge = {
      challengeId,
      purpose: String(row.purpose),
      tenantId: String(row.tenant_id),
      digitalStoreId: String(row.digital_store_id),
      storeLocationId: String(row.store_location_id),
      environment: String(row.environment) as ProvisioningPopChallenge["environment"],
      storeHubDeviceId: String(row.store_hub_device_id),
      terminalDeviceId: String(row.terminal_device_id),
      terminalAssignmentId: String(row.terminal_assignment_id),
      terminalProfileKey: String(row.terminal_profile_key),
      provisioningCodeId: String(row.provisioning_code_id),
      terminalKeyFingerprint: String(row.terminal_key_fingerprint),
      nonce: String(row.nonce),
      issuedAt: new Date(String(row.created_text)),
      expiresAt: new Date(String(row.expires_text)),
    };
    const signature = keys.provePossession(station.keyRef, provisioningChallengeBytes(challenge));
    const base64 = Buffer.from(signature).toString("base64");
    rawSignatures.push(base64);
    return base64;
  }

  // -------------------------------------------------------------------------
  // Route plumbing
  // -------------------------------------------------------------------------

  interface PostOptions {
    readonly idempotencyKey?: string | readonly string[] | null;
    readonly contentType?: string | null;
    readonly correlationId?: string;
    readonly sourceIp?: string;
    readonly rawBody?: string;
    readonly method?: string;
    readonly router?: TerminalProvisioningRouter;
  }

  async function post(
    path: string,
    body: unknown,
    options: PostOptions = {},
  ): Promise<BootstrapRouteResponse> {
    const headers: Record<string, string | string[]> = {};
    if (options.contentType !== null) {
      headers["content-type"] = options.contentType ?? "application/json";
    }
    if (options.idempotencyKey !== null) {
      const key = options.idempotencyKey ?? `rte-${RUN}-${randomUUID().slice(0, 12)}`;
      headers["idempotency-key"] = Array.isArray(key) ? [...key] : (key as string);
    }
    if (options.correlationId !== undefined) {
      headers["x-correlation-id"] = options.correlationId;
    }
    const target = options.router ?? router;
    return target.handle({
      method: options.method ?? "POST",
      path,
      headers,
      sourceIp: options.sourceIp ?? SOURCE_IP,
      rawBody: options.rawBody ?? JSON.stringify(body ?? {}),
    });
  }

  function errorOf(response: BootstrapRouteResponse): Record<string, unknown> {
    return (response.body["error"] ?? {}) as Record<string, unknown>;
  }
  function detailsOf(response: BootstrapRouteResponse): Record<string, unknown> {
    return (errorOf(response)["details"] ?? {}) as Record<string, unknown>;
  }

  /** Full bootstrap through the ROUTES for a station; returns the credential body. */
  async function bootstrapViaRoutes(
    station: Station,
    code: { id: string; raw: string },
    redemptionKey: string,
  ): Promise<Record<string, unknown>> {
    const challenged = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: station.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: station.fingerprint,
    });
    expect(challenged.status).toBe(201);
    const challenge = challenged.body["challenge"] as Record<string, unknown>;
    const challengeId = String(challenge["challengeId"]);

    const signature = await signForChallenge(station, challengeId);
    const verified = await post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(signature),
      terminalPublicKeyPem: station.pem,
    });
    expect(verified.status).toBe(200);
    expect(verified.body["result"]).toBe("PROOF_VERIFIED");

    const redeemed = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: station.assignmentId,
        provisioningCode: code.raw,
        challengeId,
      },
      { idempotencyKey: redemptionKey },
    );
    expect(redeemed.status).toBe(201);
    expect(redeemed.body["result"]).toBe("REDEEMED");
    return redeemed.body;
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    composition = new TerminalProvisioningComposition(keeper, captureLog);
    // The auto-advancing clock keeps every scenario inside the limiter's
    // budget without disabling it: the policy itself is measured in H with a
    // CONTROLLED clock on a dedicated router instance.
    let autoClock = 1_700_000_000_000;
    router = createTerminalProvisioningRouter({
      composition,
      rateLimiter: new BootstrapRateLimiter({ now: () => (autoClock += 7_000) }),
      logger: captureLog,
    });

    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'routes-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enrollDevice("WS11-RTE-HUB");
    await claimAndRedeem(hub.id);
    await activateHub(hub.id, `SERIAL-RTE-HUB-${RUN}-${randomUUID()}`);

    const hubEDev = await enrollDevice("WS11-RTE-HUBE");
    hubE = hubEDev.id;
    await claimAndRedeem(hubE, LOCATION_E);
    await activateHub(hubE, `SERIAL-RTE-HUBE-${RUN}-${randomUUID()}`);

    for (const key of ["a", "b", "c", "d", "f", "g"]) {
      stations[key] = await newStation(`WS11-RTE-${key.toUpperCase()}`);
    }
    stations.e = await newStation("WS11-RTE-E", LOCATION_E);

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `rte-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `rte fixture ${RUN}`],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      ?.query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`rte fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      ?.query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // A — successful development bootstrap
  // -------------------------------------------------------------------------

  it("A: full development bootstrap over the routes — challenge, real proof, redemption, safe material only", async () => {
    const s = stations.a;
    const code = await issueCode(s.assignmentId, `rte-a-issue-${RUN}`);

    const challenged = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: s.fingerprint,
    });
    expect(challenged.status).toBe(201);
    expect(challenged.body["result"]).toBe("CHALLENGE_ISSUED");
    const challenge = challenged.body["challenge"] as Record<string, unknown>;
    expect(challenge["challengeVersion"]).toBe(CHALLENGE_PROTOCOL_VERSION);
    expect(challenge["purpose"]).toBe("terminal_provisioning_redemption");
    expect(String(challenge["nonce"])).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge["terminalAssignmentId"]).toBe(s.assignmentId);
    // Safe material ONLY: no digest, no scope identifiers, no enrollment data.
    const challengePayload = JSON.stringify(challenged.body);
    expect(challengePayload.includes("digest")).toBe(false);
    expect(challengePayload.includes(TENANT)).toBe(false);
    expect(challengePayload.includes(STORE)).toBe(false);
    expect(challengePayload.includes(code.raw), "no raw code echo").toBe(false);

    const challengeId = String(challenge["challengeId"]);
    const signature = await signForChallenge(s, challengeId);
    const verified = await post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(signature),
      terminalPublicKeyPem: s.pem,
    });
    expect(verified.status).toBe(200);
    expect(verified.body["result"]).toBe("PROOF_VERIFIED");
    const verification = verified.body["verification"] as Record<string, unknown>;
    expect(typeof verification["verifiedAt"]).toBe("string");

    const redeemed = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        challengeId,
      },
      { idempotencyKey: `rte-a-red-${RUN}` },
    );
    expect(redeemed.status).toBe(201);
    expect(redeemed.body["result"]).toBe("REDEEMED");
    const credential = redeemed.body["credential"] as Record<string, unknown>;
    expect(credential["credentialAction"]).toBe("ISSUED");
    expect(credential["certificateSerial"], "server-derived serial").toBe(
      `TERM-DEV-rte-a-red-${RUN}`,
    );
    expect(credential["certificateFingerprint"], "bound to the enrolled key").toBe(s.fingerprint);
    expect(credential["environment"]).toBe("development");

    // No raw code, no private material, and NO activation/delivery/pairing
    // claim (§5.4) in the successful response.
    const payload = JSON.stringify(redeemed.body);
    expect(payload.includes(code.raw)).toBe(false);
    expect(payload.toLowerCase().includes("private")).toBe(false);
    for (const word of ["activat", "deliver", "pair", "sync", "connect"]) {
      expect(payload.toLowerCase().includes(word), `no "${word}" claim`).toBe(false);
    }

    const { rows } = await keeper.query<{ state: string }>(
      `select state::text from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [code.id],
    );
    expect(rows[0]?.state).toBe("redeemed");
  }, 60_000);

  // -------------------------------------------------------------------------
  // B — wrong code and lockout
  // -------------------------------------------------------------------------

  it("B: wrong codes run the governed attempt counting to lockout; no challenge, no proof, no credential", async () => {
    const s = stations.b;
    const code = await issueCode(s.assignmentId, `rte-b-issue-${RUN}`);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const r = await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: wrong,
        enrollmentKeyFingerprint: s.fingerprint,
      });
      expect(r.status, `attempt ${attempt}`).toBe(403);
      expect(errorOf(r)["code"]).toBe("SCOPE_PERMISSION_DENIED");
      expect(detailsOf(r)["result"]).toBe("CODE_INVALID");
    }
    const fifth = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: wrong,
      enrollmentKeyFingerprint: s.fingerprint,
    });
    expect(fifth.status).toBe(403);
    expect(detailsOf(fifth)["result"], "the fifth failure locks").toBe("CODE_LOCKED");

    const after = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: s.fingerprint,
    });
    expect(detailsOf(after)["result"], "even the correct code meets the lock").toBe("CODE_LOCKED");

    const { rows } = await keeper.query<{ state: string; challenges: string; certs: string }>(
      `select c.state::text as state,
              (select count(*)::text from kitluy_devices.device_provisioning_pop_challenges p
                where p.provisioning_code_id = c.id) as challenges,
              (select count(*)::text from kitluy_devices.device_certificates d
                where d.device_id = $2::uuid) as certs
         from kitluy_devices.device_provisioning_codes c where c.id = $1::uuid`,
      [code.id, s.terminalId],
    );
    expect(rows[0]?.state).toBe("locked");
    expect(Number(rows[0]?.challenges), "no challenge issued").toBe(0);
    expect(Number(rows[0]?.certs), "no credential issued").toBe(0);
  }, 60_000);

  // -------------------------------------------------------------------------
  // C — invalid proof
  // -------------------------------------------------------------------------

  it("C: a forged or transplanted signature refuses; no verified proof, no redemption, no credential", async () => {
    const s = stations.c;
    const other = stations.a;
    const code = await issueCode(s.assignmentId, `rte-c-issue-${RUN}`);
    const challenged = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: s.fingerprint,
    });
    expect(challenged.status).toBe(201);
    const challengeId = String(
      (challenged.body["challenge"] as Record<string, unknown>)["challengeId"],
    );

    // Transplant: ANOTHER terminal's genuine key signs the correct bytes.
    const { rows } = await keeper.query(
      `select c.*, c.created_at::text as created_text, c.expires_at::text as expires_text
         from kitluy_devices.device_provisioning_pop_challenges c where c.id = $1::uuid`,
      [challengeId],
    );
    const row = rows[0] as Record<string, unknown>;
    const forged = keys.provePossession(
      other.keyRef,
      provisioningChallengeBytes({
        challengeId,
        purpose: String(row.purpose),
        tenantId: String(row.tenant_id),
        digitalStoreId: String(row.digital_store_id),
        storeLocationId: String(row.store_location_id),
        environment: String(row.environment) as ProvisioningPopChallenge["environment"],
        storeHubDeviceId: String(row.store_hub_device_id),
        terminalDeviceId: String(row.terminal_device_id),
        terminalAssignmentId: String(row.terminal_assignment_id),
        terminalProfileKey: String(row.terminal_profile_key),
        provisioningCodeId: String(row.provisioning_code_id),
        terminalKeyFingerprint: String(row.terminal_key_fingerprint),
        nonce: String(row.nonce),
        issuedAt: new Date(String(row.created_text)),
        expiresAt: new Date(String(row.expires_text)),
      }),
    );
    const transplanted = await post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(Buffer.from(forged).toString("base64")),
      terminalPublicKeyPem: s.pem,
    });
    expect(transplanted.status).toBe(403);
    expect(detailsOf(transplanted)["result"]).toBe("PROOF_INVALID");

    // Pure garbage of the right SHAPE refuses the same way.
    const garbage = await post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(Buffer.from(new Uint8Array(64).fill(7)).toString("base64")),
      terminalPublicKeyPem: s.pem,
    });
    expect(garbage.status).toBe(403);
    expect(detailsOf(garbage)["result"]).toBe("PROOF_INVALID");

    const { rows: state } = await keeper.query<{ state: string }>(
      `select state::text from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
      [challengeId],
    );
    expect(state[0]?.state, "no verified proof").toBe("issued");

    const redeemAttempt = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        challengeId,
      },
      { idempotencyKey: `rte-c-red-${RUN}` },
    );
    expect(redeemAttempt.status).toBe(403);
    expect(detailsOf(redeemAttempt)["result"], "no redemption without proof").toBe("PROOF_INVALID");

    const { rows: certs } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates where device_id = $1::uuid`,
      [s.terminalId],
    );
    expect(Number(certs[0]?.n), "no credential").toBe(0);
  }, 60_000);

  // -------------------------------------------------------------------------
  // D — ambiguous successful redemption
  // -------------------------------------------------------------------------

  it("D: a discarded redemption response reconciles by the same key — identical credential, no duplicates", async () => {
    const s = stations.d;
    const code = await issueCode(s.assignmentId, `rte-d-issue-${RUN}`);
    const first = await bootstrapViaRoutes(s, code, `rte-d-red-${RUN}`);
    const firstCredential = first["credential"] as Record<string, unknown>;
    // The response is "discarded"; the terminal retries the SAME immutable request.
    const retry = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        challengeId: String(
          (
            await keeper.query<{ id: string }>(
              `select id from kitluy_devices.device_provisioning_pop_challenges
                where provisioning_code_id = $1::uuid`,
              [code.id],
            )
          ).rows[0]?.id,
        ),
      },
      { idempotencyKey: `rte-d-red-${RUN}` },
    );
    expect(retry.status).toBe(200);
    expect(retry.body["result"]).toBe("REDEMPTION_REPLAYED");
    const replayed = retry.body["credential"] as Record<string, unknown>;
    expect(replayed["certificateId"]).toBe(firstCredential["certificateId"]);
    expect(new Date(String(replayed["redeemedAt"])).getTime()).toBe(
      new Date(String(firstCredential["redeemedAt"])).getTime(),
    );

    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and environment = 'development' and status = 'active'`,
      [s.terminalId],
    );
    expect(Number(rows[0]?.n), "exactly one credential").toBe(1);

    // The same key with a CHANGED immutable input is the canonical conflict.
    const conflict = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        challengeId: randomUUID(),
      },
      { idempotencyKey: `rte-d-red-${RUN}` },
    );
    expect(conflict.status).toBe(409);
    expect(errorOf(conflict)["code"]).toBe("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST");
  }, 60_000);

  // -------------------------------------------------------------------------
  // E — cross-scope refusal
  // -------------------------------------------------------------------------

  it("E: wrong scope reveals no row identity and leaves no mutation residue; scope fields cannot be supplied", async () => {
    // A nonexistent assignment and a withdrawn/inactive one answer with the
    // SAME merged result (0164 vocabulary) — no existence oracle.
    const ghostAssignment = randomUUID();
    const ghost = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: ghostAssignment,
      provisioningCode: "2ABCDEFG",
      enrollmentKeyFingerprint: stations.a.fingerprint,
    });
    expect(ghost.status).toBe(403);
    expect(errorOf(ghost)["code"]).toBe("SCOPE_PERMISSION_DENIED");
    expect(detailsOf(ghost)["result"]).toBe("ASSIGNMENT_INACTIVE");
    const ghostPayload = JSON.stringify(ghost.body);
    expect(ghostPayload.includes(TENANT)).toBe(false);
    expect(ghostPayload.includes(STORE)).toBe(false);
    expect(ghostPayload.includes(LOCATION)).toBe(false);
    expect(ghostPayload.includes("2ABCDEFG"), "no code echo").toBe(false);

    // No mutation residue for the probed identifier.
    const { rows } = await keeper.query<{ codes: string; challenges: string }>(
      `select (select count(*)::text from kitluy_devices.device_provisioning_codes
                where terminal_assignment_id = $1::uuid) as codes,
              (select count(*)::text from kitluy_devices.device_provisioning_pop_challenges
                where terminal_assignment_id = $1::uuid) as challenges`,
      [ghostAssignment],
    );
    expect(Number(rows[0]?.codes)).toBe(0);
    expect(Number(rows[0]?.challenges)).toBe(0);

    // A verify against a nonexistent challenge id is a plain 404 with no
    // scope information.
    const ghostVerify = await post(`/v1/terminal-provisioning/challenges/${randomUUID()}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(Buffer.from(new Uint8Array(64).fill(3)).toString("base64")),
      terminalPublicKeyPem: stations.a.pem,
    });
    expect(ghostVerify.status).toBe(404);
    expect(errorOf(ghostVerify)["code"]).toBe("RESOURCE_NOT_FOUND");

    // Tenant, Store, Location, Hub, profile, environment, state, credential
    // and timestamps are NOT accepted from the caller (§5.2) — refused by
    // name, never ignored.
    for (const [field, value] of [
      ["tenantId", TENANT],
      ["digitalStoreId", STORE],
      ["storeLocationId", LOCATION],
      ["storeHubDeviceId", randomUUID()],
      ["environment", "production"],
      ["terminalProfileKey", "laundry.t1.cashier"],
      ["terminalState", "active"],
      ["credentialId", randomUUID()],
      ["issuedAt", new Date(1_700_000_000_000).toISOString()],
    ] as const) {
      const refused = await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: stations.a.assignmentId,
        provisioningCode: "2ABCDEFG",
        enrollmentKeyFingerprint: stations.a.fingerprint,
        [field]: value,
      });
      expect(refused.status, `field ${field} must be refused`).toBe(422);
      expect((detailsOf(refused)["fields"] as string[]).includes(field)).toBe(true);
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // F — pilot and production stay fail-closed; failed redemption leaves no residue
  // -------------------------------------------------------------------------

  it("F: pilot/production fail closed under BLK-005; a failed redemption consumes nothing", async () => {
    // The authoritative BLK-005 gate itself (the same assert the redemption
    // path calls through issue_device_certificate_v1) raises for BOTH.
    const s = stations.f;
    const client = await keeper.connect();
    try {
      for (const environment of ["pilot", "production"]) {
        await client.query("begin");
        await expect(
          client.query(
            `select kitluy_devices.issue_device_certificate_v1($1::uuid, '${environment}', $2, $3, 'OP-RTE')`,
            [s.terminalId, `SERIAL-RTE-${environment}-${RUN}`, s.fingerprint],
          ),
        ).rejects.toMatchObject({ code: "P0001" });
        await client.query("rollback");
      }
    } finally {
      client.release();
    }
    const { rows: blocked } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates
        where environment in ('pilot', 'production')`,
    );
    expect(Number(blocked[0]?.n), "zero pilot/production credentials exist").toBe(0);

    // Route-level: when redemption fails AFTER a verified proof (governed Hub
    // withdrawal — the same fail-closed family BLK-005 uses), the proof stays
    // unconsumed, the code unredeemed and no credential exists.
    const e = stations.e;
    const code = await issueCode(e.assignmentId, `rte-f-issue-${RUN}`);
    const challenged = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: e.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: e.fingerprint,
    });
    expect(challenged.status).toBe(201);
    const challengeId = String(
      (challenged.body["challenge"] as Record<string, unknown>)["challengeId"],
    );
    const signature = await signForChallenge(e, challengeId);
    const verified = await post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: toBase64Url(signature),
      terminalPublicKeyPem: e.pem,
    });
    expect(verified.status).toBe(200);

    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RTE-HUB-TRANSITION', 'OP-RTE')`,
      [hubE],
    );
    const refused = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: e.assignmentId,
        provisioningCode: code.raw,
        challengeId,
      },
      { idempotencyKey: `rte-f-red-${RUN}` },
    );
    expect(refused.status).toBe(403);
    expect(detailsOf(refused)["result"]).toBe("HUB_INACTIVE");

    const { rows } = await keeper.query<{ code_state: string; chal_state: string; certs: string }>(
      `select c.state::text as code_state, p.state::text as chal_state,
              (select count(*)::text from kitluy_devices.device_certificates d
                where d.device_id = $3::uuid) as certs
         from kitluy_devices.device_provisioning_codes c
         join kitluy_devices.device_provisioning_pop_challenges p on p.id = $2::uuid
        where c.id = $1::uuid`,
      [code.id, challengeId, e.terminalId],
    );
    expect(rows[0]?.code_state, "code unredeemed").toBe("issued");
    expect(rows[0]?.chal_state, "proof unconsumed").toBe("verified");
    expect(Number(rows[0]?.certs), "no credential issued").toBe(0);
  }, 60_000);

  // -------------------------------------------------------------------------
  // G — capability-role boundary
  // -------------------------------------------------------------------------

  const DOORS: ReadonlyArray<readonly [string, string]> = [
    [
      "evaluate_terminal_provisioning_code_v1",
      `kitluy_devices.evaluate_terminal_provisioning_code_v1(gen_random_uuid(),'AAAAAAAA',gen_random_uuid(),'TERMINAL','probe')`,
    ],
    [
      "issue_terminal_provisioning_pop_challenge_v1",
      `kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(gen_random_uuid())`,
    ],
    [
      "read_terminal_provisioning_pop_challenge_context_v1",
      `kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(gen_random_uuid())`,
    ],
    [
      "record_terminal_provisioning_pop_verification_v1",
      `kitluy_devices.record_terminal_provisioning_pop_verification_v1(gen_random_uuid(), true, repeat('a',64), repeat('b',64))`,
    ],
    [
      "redeem_terminal_provisioning_code_v1",
      `kitluy_devices.redeem_terminal_provisioning_code_v1(gen_random_uuid(),'AAAAAAAA',gen_random_uuid(),'probe','probe')`,
    ],
  ];

  it("G: the routes work only through explicit composer entry; service_role cannot reach the doors; role state dies with the transaction", async () => {
    // (a) service_role WITHOUT entry: no effective privilege, and a REAL call
    // is denied 42501 — the 0173 boundary, re-proven at the route package.
    const client = await keeper.connect();
    try {
      for (const [name, call] of DOORS) {
        const { rows } = await keeper.query<{ ok: boolean }>(
          `select has_function_privilege('service_role', $1, 'EXECUTE') as ok`,
          [
            `kitluy_devices.${name}(${
              {
                evaluate_terminal_provisioning_code_v1: "uuid,text,uuid,text,text",
                issue_terminal_provisioning_pop_challenge_v1: "uuid",
                read_terminal_provisioning_pop_challenge_context_v1: "uuid",
                record_terminal_provisioning_pop_verification_v1: "uuid,boolean,text,text",
                redeem_terminal_provisioning_code_v1: "uuid,text,uuid,text,text",
              }[name]
            })`,
          ],
        );
        expect(rows[0]?.ok, `${name}: no effective service_role privilege`).toBe(false);

        await client.query("begin");
        await client.query("set local role service_role");
        const { rows: who } = await client.query<{ u: string }>(`select current_user as u`);
        expect(who[0]?.u).toBe("service_role");
        await expect(client.query(`select ${call}`)).rejects.toMatchObject({ code: "42501" });
        await client.query("rollback");
      }

      // (b) the composer has ZERO direct table reach.
      await client.query("begin");
      await client.query(`set local role ${REGISTRY_ROLES.provisioning}`);
      await expect(
        client.query(`select count(*) from kitluy_devices.device_provisioning_codes`),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      client.release();
    }

    // (c) role state resets after COMMIT: a route call runs on a ONE-connection
    // pool, and the connection comes back as the connecting identity with no
    // composer capability retained.
    const single = new pg.Pool({ connectionString: DSN, max: 1 });
    try {
      const singleComposition = new TerminalProvisioningComposition(single);
      const outcome = await singleComposition.presentCodeAndIssueChallenge({
        terminalAssignmentId: randomUUID(),
        presentedCode: "2ABCDEFG",
        terminalReference: "probe",
      });
      expect(outcome.result).toBe("ASSIGNMENT_INACTIVE"); // committed via the composer
      const after = await single.connect();
      try {
        const { rows: who } = await after.query<{ u: string }>(`select current_user as u`);
        expect(who[0]?.u, "the pooled connection is the connecting identity again").toBe(
          "postgres",
        );
        await after.query("begin");
        await after.query("set local role service_role");
        await expect(after.query(`select ${DOORS[0]?.[1] ?? ""}`)).rejects.toMatchObject({
          code: "42501",
        });
        await after.query("rollback");
      } finally {
        after.release();
      }

      // (d) role state resets after ROLLBACK of the same mechanism the routes use.
      await expect(
        withServiceRole(single, REGISTRY_ROLES.provisioning, async () => {
          throw new Error("forced rollback");
        }),
      ).rejects.toThrow("forced rollback");
      const rolled = await single.connect();
      try {
        const { rows: who } = await rolled.query<{ u: string }>(`select current_user as u`);
        expect(who[0]?.u).toBe("postgres");
      } finally {
        rolled.release();
      }
    } finally {
      await single.end().catch(() => undefined);
    }
  }, 60_000);

  // -------------------------------------------------------------------------
  // H — request hardening
  // -------------------------------------------------------------------------

  it("H1: transport shape — oversize, content type, malformed JSON, method, unknown route", async () => {
    const oversized = await post("/v1/terminal-provisioning/challenges", undefined, {
      rawBody: `{"pad":"${"x".repeat(17_000)}"}`,
    });
    expect(oversized.status).toBe(422);
    expect(errorOf(oversized)["code"]).toBe("VALIDATION_FAILED");

    const wrongType = await post(
      "/v1/terminal-provisioning/challenges",
      { terminalAssignmentId: stations.a.assignmentId },
      { contentType: "text/plain" },
    );
    expect(wrongType.status).toBe(422);

    const noType = await post(
      "/v1/terminal-provisioning/challenges",
      { terminalAssignmentId: stations.a.assignmentId },
      { contentType: null },
    );
    expect(noType.status).toBe(422);

    const notJson = await post("/v1/terminal-provisioning/challenges", undefined, {
      rawBody: "{not json",
    });
    expect(notJson.status).toBe(422);

    const arrayBody = await post("/v1/terminal-provisioning/challenges", undefined, {
      rawBody: "[1,2,3]",
    });
    expect(arrayBody.status).toBe(422);

    const wrongMethod = await post("/v1/terminal-provisioning/challenges", {}, { method: "GET" });
    expect(wrongMethod.status).toBe(405);

    const unknownRoute = await post("/v1/terminal-provisioning/certificates", {});
    expect(unknownRoute.status).toBe(404);
    expect(errorOf(unknownRoute)["code"]).toBe("RESOURCE_NOT_FOUND");

    // A malformed challenge id in the verify path is an unmatched route, not
    // a probe result.
    const badPathId = await post("/v1/terminal-provisioning/challenges/not-a-uuid/verify", {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: "AA",
      terminalPublicKeyPem: stations.a.pem,
    });
    expect(badPathId.status).toBe(404);
  });

  it("H2: field shape — malformed UUID, code, signature, protocol version, unknown fields", async () => {
    const badUuid = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: "not-a-uuid",
      provisioningCode: "2ABCDEFG",
      enrollmentKeyFingerprint: stations.a.fingerprint,
    });
    expect(badUuid.status).toBe(422);
    expect((detailsOf(badUuid)["fields"] as string[]).includes("terminalAssignmentId")).toBe(true);

    for (const badCode of ["SHORT", "TOOLONGCODE", "ABC-EFGH", ""]) {
      const r = await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: stations.a.assignmentId,
        provisioningCode: badCode,
        enrollmentKeyFingerprint: stations.a.fingerprint,
      });
      expect(r.status, `code "${badCode}"`).toBe(422);
    }

    const badFingerprint = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: stations.a.assignmentId,
      provisioningCode: "2ABCDEFG",
      enrollmentKeyFingerprint: "UPPERCASE-IS-WRONG",
    });
    expect(badFingerprint.status).toBe(422);

    const verifyPath = `/v1/terminal-provisioning/challenges/${randomUUID()}/verify`;
    // Padded (not the wire form), wrong charset, oversized, empty.
    for (const badSignature of ["abc=", "has+plus/slash", "A".repeat(200), ""]) {
      const r = await post(verifyPath, {
        protocolVersion: CHALLENGE_PROTOCOL_VERSION,
        signature: badSignature,
        terminalPublicKeyPem: stations.a.pem,
      });
      expect(r.status, `signature "${badSignature.slice(0, 12)}…"`).toBe(422);
      expect((detailsOf(r)["fields"] as string[]).includes("signature")).toBe(true);
    }

    const badVersion = await post(verifyPath, {
      protocolVersion: "kitluy.provisioning-pop.v999",
      signature: "AA",
      terminalPublicKeyPem: stations.a.pem,
    });
    expect(badVersion.status).toBe(422);
    expect((detailsOf(badVersion)["fields"] as string[]).includes("protocolVersion")).toBe(true);

    const oversizedPem = await post(verifyPath, {
      protocolVersion: CHALLENGE_PROTOCOL_VERSION,
      signature: "AA",
      terminalPublicKeyPem: `-----BEGIN PUBLIC KEY-----${"A".repeat(2000)}-----END PUBLIC KEY-----`,
    });
    expect(oversizedPem.status).toBe(422);

    const unknownField = await post("/v1/terminal-provisioning/redemptions", {
      terminalAssignmentId: stations.a.assignmentId,
      provisioningCode: "2ABCDEFG",
      challengeId: randomUUID(),
      certificateSerial: "CALLER-CHOSEN",
    });
    expect(unknownField.status).toBe(422);
    expect((detailsOf(unknownField)["fields"] as string[]).includes("certificateSerial")).toBe(
      true,
    );
  });

  it("H3: idempotency key — missing, conflicting, malformed", async () => {
    const body = {
      terminalAssignmentId: stations.a.assignmentId,
      provisioningCode: "2ABCDEFG",
      challengeId: randomUUID(),
    };
    const missing = await post("/v1/terminal-provisioning/redemptions", body, {
      idempotencyKey: null,
    });
    expect(missing.status).toBe(422);
    expect((detailsOf(missing)["fields"] as string[]).includes("idempotency-key")).toBe(true);

    const conflicting = await post("/v1/terminal-provisioning/redemptions", body, {
      idempotencyKey: ["key-one", "key-two"],
    });
    expect(conflicting.status).toBe(422);

    const identicalDuplicates = await post("/v1/terminal-provisioning/redemptions", body, {
      idempotencyKey: ["same-key", "same-key"],
    });
    // Identical repeats are ONE key, not a conflict — the request proceeds to
    // the governed door (and refuses there for its ghost challenge).
    expect(identicalDuplicates.status).not.toBe(422);

    const malformed = await post("/v1/terminal-provisioning/redemptions", body, {
      idempotencyKey: "has spaces and, commas",
    });
    expect(malformed.status).toBe(422);

    const oversizedKey = await post("/v1/terminal-provisioning/redemptions", body, {
      idempotencyKey: "k".repeat(97),
    });
    expect(oversizedKey.status).toBe(422);
  });

  it("H4: rate-limit exhaustion — burst 3, 10 per minute, malformed attempts count, Retry-After", async () => {
    // A dedicated router with a CONTROLLED clock measures the policy itself.
    let clock = 1_800_000_000_000;
    const limited = createTerminalProvisioningRouter({
      composition,
      rateLimiter: new BootstrapRateLimiter({ now: () => clock }),
    });
    const fire = () =>
      post("/v1/terminal-provisioning/challenges", undefined, {
        router: limited,
        rawBody: "{not json", // MALFORMED on purpose: malformed attempts count
      });

    // Burst: three immediate attempts pass the limiter (and fail validation);
    // the fourth is rate limited.
    for (let i = 0; i < 3; i += 1) expect((await fire()).status).toBe(422);
    const fourth = await fire();
    expect(fourth.status).toBe(429);
    expect(errorOf(fourth)["code"]).toBe("RATE_LIMITED");
    expect(Number(fourth.headers?.["retry-after"])).toBeGreaterThanOrEqual(1);

    // One refill interval later a token exists again.
    clock += 6_001;
    expect((await fire()).status).toBe(422);

    // Sustained: spaced exactly at the refill rate, the 10-per-minute window
    // is the binding constraint.
    clock += 10 * 60_000; // far ahead: fresh window, full bucket
    let allowed = 0;
    let firstDenied: BootstrapRouteResponse | null = null;
    for (let i = 0; i < 11; i += 1) {
      const r = await fire();
      if (r.status === 429) {
        firstDenied = r;
        break;
      }
      allowed += 1;
      clock += 5_900; // just under the window pace: tokens refill, window fills
    }
    expect(allowed).toBe(10);
    expect(firstDenied?.status).toBe(429);

    // A DIFFERENT key (other source IP) is unaffected by the exhausted one.
    const otherIp = await post("/v1/terminal-provisioning/challenges", undefined, {
      router: limited,
      rawBody: "{not json",
      sourceIp: "198.51.100.9",
    });
    expect(otherIp.status).toBe(422);
  });

  // -------------------------------------------------------------------------
  // Closing census — structural redaction held across the whole suite
  // -------------------------------------------------------------------------

  it("census: no raw code, signature, nonce or key material ever reached a log line", () => {
    expect(rawCodes.length).toBeGreaterThan(0);
    expect(rawSignatures.length).toBeGreaterThan(0);
    for (const line of logLines) {
      const flat = JSON.stringify(line);
      for (const code of rawCodes) {
        expect(flat.includes(code), "a raw provisioning code reached a log").toBe(false);
      }
      for (const signature of rawSignatures) {
        expect(flat.includes(signature.slice(0, 24)), "a signature reached a log").toBe(false);
      }
      expect(flat.includes("BEGIN PUBLIC KEY"), "key material reached a log").toBe(false);
      expect(/[0-9a-f]{64}/.test(flat), "a nonce/fingerprint-shaped secret reached a log").toBe(
        false,
      );
    }
  });
});
