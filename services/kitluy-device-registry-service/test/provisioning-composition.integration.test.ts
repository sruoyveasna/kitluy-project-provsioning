/**
 * CONTROLLED PROVISIONING COMPOSITION — end-to-end scenarios A–F.
 *
 * WS-11-T004-P02C. Drives the REAL TerminalProvisioningComposition service
 * against the REAL local database as the REAL machine identity: the pool
 * connects and each operation runs `set local role
 * kitluy_provisioning_service` (0172) exactly as production composition
 * will. Terminal keys are in-memory Ed25519 (never committed, never
 * reusable). The suite proves the full development flow, governed lockout,
 * invalid proofs, ambiguous-outcome replay, mid-flight Hub withdrawal and
 * the BLK-005 fail-closed posture — plus the identity boundary itself
 * (composer executes exactly its five capabilities; nothing else can).
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

import {
  TerminalProvisioningComposition,
  type SafeLogger,
} from "../src/provisioning-composition.js";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";

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
if (!live) console.warn("SKIPPED: provisioning composition — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
  keyRef: string;
}

const keys = new DevelopmentDeviceKeyProvider();
const rawCodes: string[] = [];
/** Captures every safe-log line so the census can prove secret-free logging. */
const logLines: Array<Record<string, string | number | boolean>> = [];
const logger: SafeLogger = { info: (fields) => logLines.push({ ...fields }) };

describe.skipIf(!live)("controlled provisioning composition (0172), real identity", () => {
  let keeper: pg.Pool;
  let composition: TerminalProvisioningComposition;
  let operator = "";
  let hubE = "";
  const stations: Record<string, Station> = {};

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-CMP')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-CMP')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-CMP')`,
      [hubId, serial, "f9".repeat(32)],
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
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-CMP', 'OP-CMP', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `99:88:${randomUUID().slice(0, 8)}` },
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
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-CMP') as id`,
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

  /** Signs the AUTHORITATIVE challenge context, as a real terminal would. */
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
      // The ::text casts, NOT the driver Date: String(Date) drops
      // milliseconds, which would sign different canonical bytes than the
      // service reconstructs from the authoritative context.
      issuedAt: new Date(String(row.created_text)),
      expiresAt: new Date(String(row.expires_text)),
    };
    const signature = keys.provePossession(station.keyRef, provisioningChallengeBytes(challenge));
    return Buffer.from(signature).toString("base64");
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    composition = new TerminalProvisioningComposition(keeper, logger);
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'composition-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");
    // The test process connects as postgres, not service_role; borrow the
    // composer membership the way service_role holds it (censused, revoked
    // in afterAll) so `set local role kitluy_provisioning_service` works.
    await keeper.query("grant kitluy_provisioning_service to postgres");

    const hub = await enrollDevice("WS11-CMP-HUB");
    await claimAndRedeem(hub.id);
    await activateHub(hub.id, `SERIAL-CMP-HUB-${RUN}-${randomUUID()}`);

    const { rows: pre } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(pre[0]?.n), "LOCATION_E must start with zero projections").toBe(0);
    const hubEDev = await enrollDevice("WS11-CMP-HUBE");
    hubE = hubEDev.id;
    await claimAndRedeem(hubE, LOCATION_E);
    await activateHub(hubE, `SERIAL-CMP-HUBE-${RUN}-${randomUUID()}`);

    for (const key of ["a", "b", "c", "d", "f"]) {
      const location = key === "e" ? LOCATION_E : LOCATION;
      stations[key] = await newStation(`WS11-CMP-${key.toUpperCase()}`, location);
    }
    stations.e = await newStation("WS11-CMP-E", LOCATION_E);

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `cmp-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `cmp fixture ${RUN}`],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`cmp fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_provisioning_service from postgres").catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("scenario A: the full development composition — challenge, proof, redemption, safe response", async () => {
    const s = stations.a;
    const code = await issueCode(s.assignmentId, `cmp-a-issue-${RUN}`);

    const challenge = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      terminalReference: s.terminalId,
    });
    expect(challenge.result).toBe("CHALLENGE_ISSUED");
    const material = challenge.data;
    expect(material?.challengeVersion).toBe("kitluy.provisioning-pop.v1");
    expect(material?.purpose).toBe("terminal_provisioning_redemption");
    expect(material?.nonce).toMatch(/^[0-9a-f]{64}$/);

    const signature = await signForChallenge(s, String(material?.challengeId));
    const verified = await composition.verifyProofAndRecord({
      challengeId: String(material?.challengeId),
      signatureBase64: signature,
      terminalPublicKeyPem: s.pem,
    });
    expect(verified.result).toBe("PROOF_VERIFIED");

    const redeemed = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId: String(material?.challengeId),
      idempotencyKey: `cmp-a-red-${RUN}`,
    });
    expect(redeemed.result).toBe("REDEEMED");
    expect(redeemed.data?.credentialAction).toBe("ISSUED");
    expect(redeemed.data?.certificateFingerprint, "the credential uses the enrolled key").toBe(
      s.fingerprint,
    );
    expect(redeemed.data?.certificateSerial, "the serial is server-derived").toBe(
      `TERM-DEV-cmp-a-red-${RUN}`,
    );
    const payload = JSON.stringify(redeemed);
    expect(payload.includes(code.raw), "no raw code in the response").toBe(false);
    expect(payload.toLowerCase().includes("private"), "no private material").toBe(false);
    expect(payload.includes("activation"), "no activation claim").toBe(false);

    const { rows } = await keeper.query<{ state: string }>(
      `select state::text from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [code.id],
    );
    expect(rows[0]?.state).toBe("redeemed");
  }, 60_000);

  it("scenario B: wrong codes follow governed attempt counting through to lockout; no challenge, no proof, no credential", async () => {
    const s = stations.b;
    const code = await issueCode(s.assignmentId, `cmp-b-issue-${RUN}`);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const r = await composition.presentCodeAndIssueChallenge({
        terminalAssignmentId: s.assignmentId,
        presentedCode: wrong,
        terminalReference: s.terminalId,
      });
      expect(r.result, `attempt ${attempt} is the governed bounded failure`).toBe("CODE_INVALID");
    }
    const fifth = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: wrong,
      terminalReference: s.terminalId,
    });
    expect(fifth.result, "the fifth failure locks terminally").toBe("CODE_LOCKED");
    const after = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      terminalReference: s.terminalId,
    });
    expect(after.result, "even the correct code meets the locked state").toBe("CODE_LOCKED");

    const { rows } = await keeper.query<{ state: string; n: string }>(
      `select c.state::text as state,
              (select count(*)::text from kitluy_devices.device_provisioning_pop_challenges p
                where p.provisioning_code_id = c.id) as n
         from kitluy_devices.device_provisioning_codes c where c.id = $1::uuid`,
      [code.id],
    );
    expect(rows[0]?.state).toBe("locked");
    expect(Number(rows[0]?.n), "no challenge was ever issued").toBe(0);
  }, 60_000);

  it("scenario C: an invalid proof is refused with no verified record and secret-safe logs", async () => {
    const s = stations.c;
    const other = stations.a;
    const code = await issueCode(s.assignmentId, `cmp-c-issue-${RUN}`);
    const challenge = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      terminalReference: s.terminalId,
    });
    expect(challenge.result).toBe("CHALLENGE_ISSUED");
    const challengeId = String(challenge.data?.challengeId);

    // Another terminal's genuine key signs — a forged proof.
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
    const refused = await composition.verifyProofAndRecord({
      challengeId,
      signatureBase64: Buffer.from(forged).toString("base64"),
      terminalPublicKeyPem: s.pem,
    });
    expect(refused.result).toBe("PROOF_INVALID");

    const { rows: state } = await keeper.query<{ state: string }>(
      `select state::text from kitluy_devices.device_provisioning_pop_challenges where id = $1::uuid`,
      [challengeId],
    );
    expect(state[0]?.state, "no verified record").toBe("issued");
    const redeemAttempt = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId,
      idempotencyKey: `cmp-c-red-${RUN}`,
    });
    expect(redeemAttempt.result, "no redemption without a verified proof").toBe("PROOF_INVALID");
  }, 60_000);

  it("scenario D: an ambiguous redemption response reconciles with the same key — no duplicate work", async () => {
    const s = stations.d;
    const code = await issueCode(s.assignmentId, `cmp-d-issue-${RUN}`);
    const challenge = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      terminalReference: s.terminalId,
    });
    const challengeId = String(challenge.data?.challengeId);
    const signature = await signForChallenge(s, challengeId);
    expect(
      (
        await composition.verifyProofAndRecord({
          challengeId,
          signatureBase64: signature,
          terminalPublicKeyPem: s.pem,
        })
      ).result,
    ).toBe("PROOF_VERIFIED");

    const first = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId,
      idempotencyKey: `cmp-d-red-${RUN}`,
    });
    expect(first.result).toBe("REDEEMED");

    // The response is "lost"; the client retries the SAME immutable request.
    const retry = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId,
      idempotencyKey: `cmp-d-red-${RUN}`,
    });
    expect(retry.result).toBe("REDEMPTION_REPLAYED");
    expect(retry.data?.certificateId).toBe(first.data?.certificateId);
    expect(new Date(String(retry.data?.redeemedAt)).getTime()).toBe(
      new Date(String(first.data?.redeemedAt)).getTime(),
    );
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and environment = 'development' and status = 'active'`,
      [s.terminalId],
    );
    expect(Number(rows[0]?.n), "no duplicate credential").toBe(1);

    // A changed immutable input under the same key is the canonical conflict.
    const conflict = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId: randomUUID(),
      idempotencyKey: `cmp-d-red-${RUN}`,
    });
    expect(conflict.result).toBe("IDEMPOTENCY_CONFLICT");
  }, 60_000);

  it("scenario E: Hub withdrawn mid-flow — earlier presentation and proof never authorize the final redemption", async () => {
    const s = stations.e;
    const code = await issueCode(s.assignmentId, `cmp-e-issue-${RUN}`);
    const challenge = await composition.presentCodeAndIssueChallenge({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      terminalReference: s.terminalId,
    });
    expect(challenge.result).toBe("CHALLENGE_ISSUED");
    const challengeId = String(challenge.data?.challengeId);
    const signature = await signForChallenge(s, challengeId);
    expect(
      (
        await composition.verifyProofAndRecord({
          challengeId,
          signatureBase64: signature,
          terminalPublicKeyPem: s.pem,
        })
      ).result,
    ).toBe("PROOF_VERIFIED");

    // The governed withdrawal lands between proof and redemption.
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'CMP-HUB-TRANSITION', 'OP-CMP')`,
      [hubE],
    );
    const refused = await composition.redeemProvisioning({
      terminalAssignmentId: s.assignmentId,
      presentedCode: code.raw,
      challengeId,
      idempotencyKey: `cmp-e-red-${RUN}`,
    });
    expect(refused.result).toBe("HUB_INACTIVE");
    const { rows } = await keeper.query<{ code_state: string; chal_state: string }>(
      `select c.state::text as code_state, p.state::text as chal_state
         from kitluy_devices.device_provisioning_codes c
         join kitluy_devices.device_provisioning_pop_challenges p on p.id = $2::uuid
        where c.id = $1::uuid`,
      [code.id, challengeId],
    );
    expect(rows[0]?.code_state, "code unredeemed").toBe("issued");
    expect(rows[0]?.chal_state, "proof unconsumed").toBe("verified");
  }, 60_000);

  it("scenario F: pilot and production stay fail-closed under BLK-005 — a grant is never signing approval", async () => {
    const s = stations.f;
    // The authoritative refusal itself (the same assert the redemption path
    // calls through issue_device_certificate_v1): pilot has no approved PKI
    // configuration, so certificate issuance RAISES — proven via the harness.
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await expect(
        client.query(
          `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'pilot', $2, $3, 'OP-CMP')`,
          [s.terminalId, `SERIAL-CMP-PILOT-${RUN}`, s.fingerprint],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await client.query("rollback");
      await client.query("begin");
      await expect(
        client.query(
          `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'production', $2, $3, 'OP-CMP')`,
          [s.terminalId, `SERIAL-CMP-PROD-${RUN}`, s.fingerprint],
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await client.query("rollback");
    } finally {
      client.release();
    }
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_certificates
        where device_id = $1::uuid and environment in ('pilot', 'production')`,
      [s.terminalId],
    );
    expect(Number(rows[0]?.n), "no pilot or production credential exists").toBe(0);
  }, 60_000);

  it("identity: the composer executes exactly its five capabilities and nothing else; hostile identities cannot", async () => {
    // As the composer: a NON-capability door refuses even though the human
    // door exists (the five-capability boundary, live).
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query("set local role kitluy_provisioning_service");
      await expect(
        client.query(
          `select kitluy_devices.issue_terminal_provisioning_code_v1(gen_random_uuid(), 'k', null)`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
      await client.query("begin");
      await client.query("set local role kitluy_provisioning_service");
      await expect(
        client.query(`select id from kitluy_devices.device_provisioning_codes limit 1`),
      ).rejects.toMatchObject({ code: "42501" });
      await client.query("rollback");
    } finally {
      client.release();
    }
    // Hostile identities: anon and authenticated cannot reach the
    // composition capabilities.
    const denied = async (role: string, probe: string): Promise<void> => {
      const c = await keeper.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role }),
        ]);
        await c.query(`set local role ${role}`);
        await expect(c.query(probe), `${role}: ${probe}`).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback");
      } finally {
        c.release();
      }
    };
    for (const role of ["anon", "authenticated"]) {
      await denied(
        role,
        `select kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(gen_random_uuid())`,
      );
      await denied(
        role,
        `select kitluy_devices.redeem_terminal_provisioning_code_v1(gen_random_uuid(), 'AAAAAAAA', gen_random_uuid(), 'k', 's')`,
      );
    }

    // The safe-log census: no raw code, nonce, signature or key material
    // ever reached the logger.
    expect(logLines.length).toBeGreaterThan(0);
    const allLogText = JSON.stringify(logLines);
    for (const raw of rawCodes) {
      expect(allLogText.includes(raw), `raw code ${raw} reached the logs`).toBe(false);
    }
    expect(allLogText.includes("BEGIN PUBLIC KEY")).toBe(false);
    for (const line of logLines) {
      const keysOf = Object.keys(line).sort().join(",");
      expect(keysOf, "only the safe field set is ever logged").toBe(
        "correlationId,operation,result",
      );
    }
  }, 60_000);
});
