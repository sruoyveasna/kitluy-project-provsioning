/**
 * TERMINAL-SIGNABLE PROVISIONING CHALLENGE CONTRACT — WS-11-T004-P04A1.
 *
 * The property under test: a REAL terminal — no database access, no
 * server-internal helper, no knowledge of authoritative rows — can complete
 * the cloud bootstrap using ONLY the public HTTP challenge response and its
 * manufacturing private key. The terminal in these tests is
 * {@link blackBoxTerminalSign}: it sees the response `challenge` object and a
 * key, nothing else. Server-side reconstruction independence, byte identity,
 * timestamp precision, replay stability (migration 0175), tampering and the
 * privacy census are proven around it.
 *
 * Authority: the P04A1 package; KLD-2026-08-05-TERMINAL-TRANSPORT-001;
 * migration 0175 (issuance reconciliation); `kitluy.provisioning-pop.v1`.
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

import { TerminalProvisioningComposition } from "../src/provisioning-composition.js";
import {
  BootstrapRateLimiter,
  createTerminalProvisioningRouter,
  type BootstrapRouteResponse,
  type TerminalProvisioningRouter,
  type TerminalSignableChallenge,
} from "../src/provisioning-routes.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const SOURCE_IP = "203.0.113.88";

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
if (!live) console.warn("SKIPPED: terminal contract — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
  keyRef: string;
}

const keys = new DevelopmentDeviceKeyProvider();
const rawCodes: string[] = [];
const signingPayloads: string[] = [];
const signatures: string[] = [];
const logLines: Array<Record<string, string | number | boolean>> = [];
const captureLog = {
  info: (fields: Record<string, string | number | boolean>) => logLines.push({ ...fields }),
};

/**
 * THE BLACK-BOX TERMINAL. Its entire world is the public `challenge` object
 * and its own manufacturing key. It decodes the opaque payload and signs
 * those exact bytes — no timestamps, no JSON re-serialization, no database,
 * no server canonicalizer.
 */
function blackBoxTerminalSign(
  challenge: TerminalSignableChallenge,
  keyRef: string,
): { readonly signature: string; readonly protocolVersion: string } {
  if (challenge.signatureAlgorithm !== "ed25519") {
    throw new Error(`terminal cannot sign with ${challenge.signatureAlgorithm}`);
  }
  if (challenge.signingPayloadEncoding !== "base64url") {
    throw new Error(`terminal cannot decode ${challenge.signingPayloadEncoding}`);
  }
  const payload = Buffer.from(challenge.signingPayload, "base64url");
  const signature = Buffer.from(keys.provePossession(keyRef, Uint8Array.from(payload))).toString(
    "base64url",
  );
  signatures.push(signature);
  return { signature, protocolVersion: challenge.challengeVersion };
}

describe.skipIf(!live)("terminal-signable provisioning challenge (P04A1)", () => {
  let keeper: pg.Pool;
  let composition: TerminalProvisioningComposition;
  let router: TerminalProvisioningRouter;
  let operator = "";
  const stations: Record<string, Station> = {};

  // -------------------------------------------------------------------------
  // Fixtures (the proven suite pattern; the TERMINAL path never uses these)
  // -------------------------------------------------------------------------

  async function claimAndRedeem(deviceId: string): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-TSC')`,
      [deviceId, TENANT, STORE, LOCATION, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-TSC')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-TSC')`,
      [hubId, serial, "d3".repeat(32)],
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
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-TSC', 'OP-TSC', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `33:22:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return { id: rows[0]?.id ?? "", pem, fingerprint, keyRef };
  }

  async function newStation(label: string): Promise<Station> {
    const dev = await enrollDevice(label);
    await claimAndRedeem(dev.id);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-TSC') as id`,
      [dev.id, LOCATION],
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
  ): Promise<{ id: string; raw: string; expiresAt: string }> {
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
      return {
        id: String(result.provisioning_code_id),
        raw: String(result.code),
        expiresAt: String(result.expires_at),
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  // -------------------------------------------------------------------------
  // Route plumbing
  // -------------------------------------------------------------------------

  async function post(
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<BootstrapRouteResponse> {
    return router.handle({
      method: "POST",
      path,
      headers: {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey ?? `tsc-${RUN}-${randomUUID().slice(0, 12)}`,
      },
      sourceIp: SOURCE_IP,
      rawBody: JSON.stringify(body ?? {}),
    });
  }

  function challengeOf(response: BootstrapRouteResponse): TerminalSignableChallenge {
    expect(response.status).toBe(201);
    const challenge = response.body["challenge"] as TerminalSignableChallenge;
    signingPayloads.push(challenge.signingPayload);
    return challenge;
  }

  function detailsOf(response: BootstrapRouteResponse): Record<string, unknown> {
    return (
      ((response.body["error"] as Record<string, unknown> | undefined)?.["details"] as
        Record<string, unknown> | undefined) ?? {}
    );
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    composition = new TerminalProvisioningComposition(keeper, captureLog);
    let autoClock = 1_700_000_000_000;
    router = createTerminalProvisioningRouter({
      composition,
      rateLimiter: new BootstrapRateLimiter({ now: () => (autoClock += 7_000) }),
      logger: captureLog,
    });

    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'terminal-contract-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enrollDevice("WS11-TSC-HUB");
    await claimAndRedeem(hub.id);
    await activateHub(hub.id, `SERIAL-TSC-HUB-${RUN}-${randomUUID()}`);

    for (const key of ["a", "b", "d", "e1", "e2", "x"]) {
      stations[key] = await newStation(`WS11-TSC-${key.toUpperCase()}`);
    }

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `tsc-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `tsc fixture ${RUN}`],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      ?.query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`tsc fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      ?.query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  // -------------------------------------------------------------------------
  // A — real terminal flow, strictly black box
  // -------------------------------------------------------------------------

  it("A: a terminal completes bootstrap from the public response and its key alone", async () => {
    const s = stations.a;
    const code = await issueCode(s.assignmentId, `tsc-a-issue-${RUN}`);

    const challenged = await post("/v1/terminal-provisioning/challenges", {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: s.fingerprint,
    });
    const challenge = challengeOf(challenged);
    expect(challenge.signatureAlgorithm).toBe("ed25519");
    expect(challenge.signingPayloadEncoding).toBe("base64url");
    expect(challenge.signingPayload).toMatch(/^[A-Za-z0-9_-]+$/); // unpadded base64url

    // THE TERMINAL. No database read, no internal helper, no authoritative
    // row, no timestamp handling — the public object and the private key.
    const signed = blackBoxTerminalSign(challenge, s.keyRef);
    const verified = await post(
      `/v1/terminal-provisioning/challenges/${challenge.challengeId}/verify`,
      {
        protocolVersion: signed.protocolVersion,
        signature: signed.signature,
        terminalPublicKeyPem: s.pem,
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.body["result"]).toBe("PROOF_VERIFIED");

    const redeemed = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        challengeId: challenge.challengeId,
      },
      `tsc-a-red-${RUN}`,
    );
    expect(redeemed.status).toBe(201);
    expect(redeemed.body["result"]).toBe("REDEEMED");
    const credential = redeemed.body["credential"] as Record<string, unknown>;
    expect(credential["certificateFingerprint"]).toBe(s.fingerprint);

    // The payload never contains the raw code, and the response never leaks
    // beyond the approved contract fields.
    const payloadText = Buffer.from(challenge.signingPayload, "base64url").toString("utf8");
    expect(payloadText.includes(code.raw), "raw code never in the signed bytes").toBe(false);
    expect(payloadText.startsWith("kitluy.provisioning-pop.v1\n")).toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // B — byte identity with the server crypto authority
  // -------------------------------------------------------------------------

  it("B: decoded payload bytes are exactly the server's independent canonical reconstruction", async () => {
    const s = stations.b;
    const code = await issueCode(s.assignmentId, `tsc-b-issue-${RUN}`);
    const challenge = challengeOf(
      await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        enrollmentKeyFingerprint: s.fingerprint,
      }),
    );
    const terminalBytes = Buffer.from(challenge.signingPayload, "base64url");

    // INDEPENDENT reconstruction from the AUTHORITATIVE row through the
    // crypto authority — the exact procedure the verification path performs.
    // (Server-side evidence; the terminal never does this.)
    const { rows } = await keeper.query(
      `select c.*, c.created_at::text as created_text, c.expires_at::text as expires_text
         from kitluy_devices.device_provisioning_pop_challenges c where c.id = $1::uuid`,
      [challenge.challengeId],
    );
    const row = rows[0] as Record<string, unknown>;
    const serverBytes = Buffer.from(
      provisioningChallengeBytes({
        challengeId: challenge.challengeId,
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
    expect(terminalBytes.equals(serverBytes), "byte-identical canonical payload").toBe(true);
  }, 60_000);

  // -------------------------------------------------------------------------
  // C — timestamp precision
  // -------------------------------------------------------------------------

  it("C: canonical timestamps survive database precision without String(Date) or locale drift", async () => {
    // The payload just proven byte-identical in B carries the timestamps in
    // canonical toISOString form — millisecond precision, Z-suffixed, no
    // locale text — parsed from the authoritative microsecond-precision
    // database text, never round-tripped through String(Date).
    const payloadText = Buffer.from(
      signingPayloads[signingPayloads.length - 1] ?? "",
      "base64url",
    ).toString("utf8");
    const lines = payloadText.split("\n");
    expect(lines).toHaveLength(16);
    const issuedAt = lines[14] ?? "";
    const expiresAt = lines[15] ?? "";
    for (const value of [issuedAt, expiresAt]) {
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    // No locale/implicit-Date artifacts anywhere in the canonical text.
    expect(payloadText.includes("GMT")).toBe(false);
    expect(/[A-Z][a-z]{2}\s[A-Z][a-z]{2}\s\d{2}\s\d{4}/.test(payloadText)).toBe(false);

    // The authoritative database text for the same challenge carries AT LEAST
    // the same instants: parsing it yields exactly the canonical strings.
    const { rows } = await keeper.query<{ created_text: string; expires_text: string }>(
      `select created_at::text as created_text, expires_at::text as expires_text
         from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
      [(await latestChallengeIdFor(stations.b)) ?? ""],
    );
    expect(new Date(String(rows[0]?.created_text)).toISOString()).toBe(issuedAt);
    expect(new Date(String(rows[0]?.expires_text)).toISOString()).toBe(expiresAt);
  }, 60_000);

  async function latestChallengeIdFor(station: Station): Promise<string | null> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.device_provisioning_pop_challenges
        where terminal_assignment_id = $1::uuid
        order by created_at desc, id desc limit 1`,
      [station.assignmentId],
    );
    return rows[0]?.id ?? null;
  }

  // -------------------------------------------------------------------------
  // D — replay (migration 0175)
  // -------------------------------------------------------------------------

  it("D: an identical challenge retry returns the same challenge with a byte-identical payload and no new row", async () => {
    const s = stations.d;
    const code = await issueCode(s.assignmentId, `tsc-d-issue-${RUN}`);
    const request = {
      terminalAssignmentId: s.assignmentId,
      provisioningCode: code.raw,
      enrollmentKeyFingerprint: s.fingerprint,
    };
    const first = challengeOf(await post("/v1/terminal-provisioning/challenges", request));
    const retry = challengeOf(await post("/v1/terminal-provisioning/challenges", request));

    expect(retry.challengeId).toBe(first.challengeId);
    expect(retry.challengeVersion).toBe(first.challengeVersion);
    expect(retry.nonce, "the nonce is NOT regenerated").toBe(first.nonce);
    expect(retry.expiresAt, "expiry is NOT extended").toBe(first.expiresAt);
    expect(retry.issuedAt).toBe(first.issuedAt);
    expect(
      Buffer.from(retry.signingPayload, "base64url").equals(
        Buffer.from(first.signingPayload, "base64url"),
      ),
      "byte-identical signing payload",
    ).toBe(true);

    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_pop_challenges
        where provisioning_code_id = $1::uuid`,
      [code.id],
    );
    expect(Number(rows[0]?.n), "no second challenge exists").toBe(1);

    // The replayed challenge still verifies — the black-box terminal signs
    // the RETRY response (the lost-response case a real terminal hits).
    const signed = blackBoxTerminalSign(retry, s.keyRef);
    const verified = await post(
      `/v1/terminal-provisioning/challenges/${retry.challengeId}/verify`,
      {
        protocolVersion: signed.protocolVersion,
        signature: signed.signature,
        terminalPublicKeyPem: s.pem,
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.body["result"]).toBe("PROOF_VERIFIED");
  }, 60_000);

  // -------------------------------------------------------------------------
  // E — tampering
  // -------------------------------------------------------------------------

  it("E: tampered, transplanted and expired payload signatures all refuse with zero residue", async () => {
    const e1 = stations.e1;
    const e2 = stations.e2;
    const code1 = await issueCode(e1.assignmentId, `tsc-e1-issue-${RUN}`);
    const code2 = await issueCode(e2.assignmentId, `tsc-e2-issue-${RUN}`);
    const c1 = challengeOf(
      await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: e1.assignmentId,
        provisioningCode: code1.raw,
        enrollmentKeyFingerprint: e1.fingerprint,
      }),
    );
    const c2 = challengeOf(
      await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: e2.assignmentId,
        provisioningCode: code2.raw,
        enrollmentKeyFingerprint: e2.fingerprint,
      }),
    );

    const verify = (challengeId: string, signature: string, pem: string) =>
      post(`/v1/terminal-provisioning/challenges/${challengeId}/verify`, {
        protocolVersion: c1.challengeVersion,
        signature,
        terminalPublicKeyPem: pem,
      });

    // 1. ONE CHANGED PAYLOAD BYTE, correctly signed — the signature is over
    // bytes that are not the authoritative ones.
    const tampered = Buffer.from(c1.signingPayload, "base64url");
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0x01;
    const overTampered = Buffer.from(
      keys.provePossession(e1.keyRef, Uint8Array.from(tampered)),
    ).toString("base64url");
    const r1 = await verify(c1.challengeId, overTampered, e1.pem);
    expect(r1.status).toBe(403);
    expect(detailsOf(r1)["result"]).toBe("PROOF_INVALID");

    // 2. ANOTHER CHALLENGE'S payload (same terminal key, wrong challenge).
    const overOtherChallenge = blackBoxTerminalSign(c2, e1.keyRef).signature;
    const r2 = await verify(c1.challengeId, overOtherChallenge, e1.pem);
    expect(r2.status).toBe(403);
    expect(detailsOf(r2)["result"]).toBe("PROOF_INVALID");

    // 3. ANOTHER ASSIGNMENT'S payload signed by ITS OWN key, presented on
    // this challenge — a cross-assignment transplant.
    const overOtherAssignment = blackBoxTerminalSign(c2, e2.keyRef).signature;
    const r3 = await verify(c1.challengeId, overOtherAssignment, e2.pem);
    expect(r3.status).toBe(403);
    expect(detailsOf(r3)["result"]).toBe("PROOF_INVALID");

    // Zero residue so far: both challenges stay ISSUED, nothing verified.
    for (const id of [c1.challengeId, c2.challengeId]) {
      const { rows } = await keeper.query<{ state: string }>(
        `select state::text from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
        [id],
      );
      expect(rows[0]?.state).toBe("issued");
    }

    // 4. AN EXPIRED CHALLENGE with its ORIGINAL, correctly signed payload.
    // The challenge lifetime IS the code lifetime (recorded 0170 decision),
    // so expiry is driven through the CANONICAL governed transition — the
    // 0166 expirer under the sanctioned transaction-local test clock — and
    // the terminal's retained payload must then be useless.
    const expiring = await keeper.connect();
    try {
      await expiring.query("begin");
      const due = new Date(new Date(c2.expiresAt).getTime() + 1000);
      await expiring.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
        due.toISOString(),
      ]);
      const { rows } = await expiring.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.expire_terminal_provisioning_code_v1(
           $1::uuid, gen_random_uuid(), 'TEST_HARNESS') as result`,
        [code2.id],
      );
      await expiring.query("commit");
      expect(rows[0]?.result?.outcome).toBe("EXPIRED");
    } catch (error) {
      await expiring.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      expiring.release();
    }
    const retained = blackBoxTerminalSign(c2, e2.keyRef);
    const r4 = await post(`/v1/terminal-provisioning/challenges/${c2.challengeId}/verify`, {
      protocolVersion: retained.protocolVersion,
      signature: retained.signature,
      terminalPublicKeyPem: e2.pem,
    });
    expect(r4.status).toBe(403);
    expect(detailsOf(r4)["result"]).toBe("CODE_EXPIRED");

    // No proof, no redemption, no credential anywhere in this scenario.
    const { rows: residue } = await keeper.query<{ verified: string; certs: string }>(
      `select (select count(*)::text from kitluy_devices.device_provisioning_pop_challenges
                where terminal_assignment_id in ($1::uuid, $2::uuid)
                  and state in ('verified', 'consumed')) as verified,
              (select count(*)::text from kitluy_devices.device_certificates
                where device_id in ($3::uuid, $4::uuid)) as certs`,
      [e1.assignmentId, e2.assignmentId, e1.terminalId, e2.terminalId],
    );
    expect(Number(residue[0]?.verified), "no verified proof").toBe(0);
    expect(Number(residue[0]?.certs), "no credential").toBe(0);

    // A redemption attempt on the expired flow also refuses.
    const redeemAttempt = await post(
      "/v1/terminal-provisioning/redemptions",
      {
        terminalAssignmentId: e2.assignmentId,
        provisioningCode: code2.raw,
        challengeId: c2.challengeId,
      },
      `tsc-e-red-${RUN}`,
    );
    expect(redeemAttempt.status).toBe(403);
  }, 60_000);

  // -------------------------------------------------------------------------
  // F — request independence
  // -------------------------------------------------------------------------

  it("F: verification needs no authoritative binding fields, and an echoed payload is refused by name", async () => {
    // The successful verifications in A and D already carried ONLY
    // protocolVersion + signature + the terminal's own public key. Here the
    // negative half: every authoritative binding field — and an echoed
    // signingPayload — is refused BY NAME, never consumed.
    const s = stations.x;
    const code = await issueCode(s.assignmentId, `tsc-f-issue-${RUN}`);
    const challenge = challengeOf(
      await post("/v1/terminal-provisioning/challenges", {
        terminalAssignmentId: s.assignmentId,
        provisioningCode: code.raw,
        enrollmentKeyFingerprint: s.fingerprint,
      }),
    );
    const signed = blackBoxTerminalSign(challenge, s.keyRef);

    for (const [field, value] of [
      ["signingPayload", challenge.signingPayload],
      ["tenantId", TENANT],
      ["digitalStoreId", STORE],
      ["storeLocationId", LOCATION],
      ["storeHubDeviceId", randomUUID()],
      ["environment", "development"],
      ["nonce", challenge.nonce],
      ["issuedAt", challenge.issuedAt],
      ["expiresAt", challenge.expiresAt],
    ] as const) {
      const refused = await post(
        `/v1/terminal-provisioning/challenges/${challenge.challengeId}/verify`,
        {
          protocolVersion: signed.protocolVersion,
          signature: signed.signature,
          terminalPublicKeyPem: s.pem,
          [field]: value,
        },
      );
      expect(refused.status, `field ${field} must be refused`).toBe(422);
      expect((detailsOf(refused)["fields"] as string[]).includes(field)).toBe(true);
    }

    // And the clean request still succeeds afterwards — refusals consumed nothing.
    const verified = await post(
      `/v1/terminal-provisioning/challenges/${challenge.challengeId}/verify`,
      {
        protocolVersion: signed.protocolVersion,
        signature: signed.signature,
        terminalPublicKeyPem: s.pem,
      },
    );
    expect(verified.status).toBe(200);
    expect(verified.body["result"]).toBe("PROOF_VERIFIED");
  }, 60_000);

  // -------------------------------------------------------------------------
  // G — privacy and logging census
  // -------------------------------------------------------------------------

  it("G: no code, signing payload, nonce, signature, digest or key material ever reached a log", () => {
    expect(rawCodes.length).toBeGreaterThan(0);
    expect(signingPayloads.length).toBeGreaterThan(0);
    expect(signatures.length).toBeGreaterThan(0);
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      const flat = JSON.stringify(line);
      for (const code of rawCodes) {
        expect(flat.includes(code), "a raw provisioning code reached a log").toBe(false);
      }
      for (const payload of signingPayloads) {
        expect(flat.includes(payload.slice(0, 32)), "a signing payload reached a log").toBe(false);
      }
      for (const signature of signatures) {
        expect(flat.includes(signature.slice(0, 24)), "a signature reached a log").toBe(false);
      }
      expect(flat.includes("BEGIN PUBLIC KEY"), "key material reached a log").toBe(false);
      expect(
        /[0-9a-f]{64}/.test(flat),
        "a nonce/digest/fingerprint-shaped secret reached a log",
      ).toBe(false);
      expect(flat.includes("kitluy.provisioning-pop.v1\n"), "canonical text reached a log").toBe(
        false,
      );
    }
  });
});
