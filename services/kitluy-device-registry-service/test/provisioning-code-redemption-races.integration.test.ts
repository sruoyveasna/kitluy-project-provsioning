/**
 * REDEMPTION RACE, REPLAY AND COMPOSITION HARDENING.
 *
 * WS-11-T004-P02B3C. Proves the 0171 atomic PoP-bound redemption door against
 * concurrent explicit revocation (0165), canonical boundary expiration
 * (0166), governed Hub withdrawal (0121), enrollment supersession, credential
 * revocation and atomic lost-code recovery (0169), on separate recorded
 * backends — plus lost-response, credential-change, Hub/enrollment-change and
 * hostile replays, and two transaction-local failure injections.
 *
 * PRE-EDIT LOCK-ORDER AUDIT (verified against 0165/0166/0169/0170/0171/0121):
 *   redeem     : DEVICE -> ASSIGNMENT -> CODE -> CHALLENGE; enrollment read
 *                and certificate select/insert UNDER the held device lock
 *                (the device lock IS the enrollment-currency lock)
 *   revoke     : idempotency row -> unlocked read -> ASSIGNMENT -> CODE
 *   expire     : unlocked read -> ASSIGNMENT -> CODE
 *   recover    : recovery-key row -> ASSIGNMENT -> ... -> CODE
 *   attest     : challenge read -> ASSIGNMENT -> CODE -> CHALLENGE
 *   hub door   : DEVICE -> assignment rows (0121)
 *   Global partial order DEVICE < ASSIGNMENT < CODE < CHALLENGE holds across
 *   every door; no cycle exists. State decisions all re-run under the final
 *   locks; replay disclosure precedes no authorization on any runtime path
 *   (the doors are harness-only until P02C).
 *
 * RACE MATRIX (staggered release; asserted residue inline):
 *   A1 redeem first vs revoke   -> REDEEMED stands; revocation gets the 0165
 *      ALREADY-REDEEMED classification; no reason overwrite
 *   A2 revoke first vs redeem   -> REVOKED stands; proof VERIFIED unconsumed;
 *      no credential; no REDEEMED/consumption
 *   B  redeem vs canonical expiry at the exact µs boundary -> EXPIRED stands,
 *      one EXPIRED event, proof unconsumed, no credential
 *      (control at boundary-1s: full redemption)
 *   C1 redeem first vs Hub withdrawal -> commit-time Hub binding is
 *      immutable history; C2 withdrawal first -> HUB-INACTIVE, zero residue
 *   D  enrollment superseded first (sanctioned governor fixture — the
 *      governed reenroll path requires TPM continuity software fixtures
 *      cannot prove; recorded) -> ENROLLMENT-INELIGIBLE, zero residue
 *   E  credential revoked between cycles -> the revoked credential is never
 *      re-bound; a fresh eligible credential is issued; replay of the FIRST
 *      redemption names the ORIGINAL credential and issues nothing
 *   F1 redeem first vs recovery -> recovery gets ALREADY-REDEEMED, no
 *      successor; F2 recovery first -> predecessor proof cannot redeem the
 *      REVOKED predecessor nor the successor (the door derives the code FROM
 *      the proof), successor stays ISSUED un-redeemed
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DevelopmentDeviceKeyProvider,
  publicKeyFingerprint,
  provisioningChallengeBytes,
  verifyProvisioningPop,
  type ProvisioningPopChallenge,
  type ProvisioningPopExpectation,
  type TrustedTimeEvaluation,
} from "@kitluy/device-identity";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const STAGGER_MS = 250;

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
if (!live) console.warn("SKIPPED: redemption race hardening — local database unreachable");

interface Station {
  assignmentId: string;
  terminalId: string;
  pem: string;
  fingerprint: string;
  enrollmentId: string;
}

interface RacerOutcome {
  pid: number;
  result: Record<string, unknown>;
  error: string | null;
  sqlstate: string | null;
}

interface ProvisionedProof {
  challengeId: string;
  codeId: string;
  raw: string;
  issueKey: string;
}

const keys = new DevelopmentDeviceKeyProvider();
const rawCodes: string[] = [];

describe.skipIf(!live)("redemption race and replay hardening (0171), separate backends", () => {
  let keeper: pg.Pool;
  let operator = "";
  let hubC1 = "";
  let hubC2 = "";
  const stations: Record<string, Station> = {};

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-RRX')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-RRX')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RRX')`,
      [hubId, serial, "f8".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  async function enrollDevice(
    label: string,
  ): Promise<{ id: string; pem: string; fingerprint: string }> {
    const keyRef = `${label}-key-${RUN}`;
    await keys.generateDeviceKey(keyRef, "development");
    const pem = keys.publicKeyPem(keyRef) ?? "";
    const fingerprint = publicKeyFingerprint(pem);
    const { rows: profileRows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RRX', 'OP-RRX', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profileRows[0]?.id,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `aa:99:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return { id: rows[0]?.id ?? "", pem, fingerprint };
  }

  async function newStation(label: string, location: string = LOCATION): Promise<Station> {
    const dev = await enrollDevice(label);
    await claimAndRedeem(dev.id, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RRX') as id`,
      [dev.id, location],
    );
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [dev.id],
    );
    const { rows: enrRows } = await keeper.query<{ e: string }>(
      `select current_enrollment_id::text as e from kitluy_devices.devices where id = $1::uuid`,
      [dev.id],
    );
    return {
      assignmentId: rows[0]?.id ?? "",
      terminalId: dev.id,
      pem: dev.pem,
      fingerprint: dev.fingerprint,
      enrollmentId: String(enrRows[0]?.e),
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
      expect(result.outcome, `issuance for ${key}`).toBe("ISSUED");
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

  async function verifiedProof(
    station: Station,
    label: string,
    issueKey: string,
  ): Promise<ProvisionedProof> {
    const code = await issueCode(station.assignmentId, issueKey);
    const { rows: chalRows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.issue_terminal_provisioning_pop_challenge_v1($1::uuid) as result`,
      [station.assignmentId],
    );
    const issued = chalRows[0]?.result ?? {};
    expect(issued.outcome, `challenge for ${issueKey}`).toBe("POP_CHALLENGE_ISSUED");
    const challenge: ProvisioningPopChallenge = {
      challengeId: String(issued.challenge_id),
      purpose: String(issued.purpose),
      tenantId: String(issued.tenant_id),
      digitalStoreId: String(issued.digital_store_id),
      storeLocationId: String(issued.store_location_id),
      environment: String(issued.environment) as ProvisioningPopChallenge["environment"],
      storeHubDeviceId: String(issued.store_hub_device_id),
      terminalDeviceId: String(issued.terminal_device_id),
      terminalAssignmentId: String(issued.terminal_assignment_id),
      terminalProfileKey: String(issued.terminal_profile_key),
      provisioningCodeId: String(issued.provisioning_code_id),
      terminalKeyFingerprint: String(issued.terminal_key_fingerprint),
      nonce: String(issued.nonce),
      issuedAt: new Date(String(issued.created_at)),
      expiresAt: new Date(String(issued.expires_at)),
    };
    const signature = keys.provePossession(
      `${label}-key-${RUN}`,
      provisioningChallengeBytes(challenge),
    );
    const expectation: ProvisioningPopExpectation = {
      challengeId: challenge.challengeId,
      purpose: challenge.purpose,
      tenantId: challenge.tenantId,
      digitalStoreId: challenge.digitalStoreId,
      storeLocationId: challenge.storeLocationId,
      environment: challenge.environment,
      storeHubDeviceId: challenge.storeHubDeviceId,
      terminalDeviceId: challenge.terminalDeviceId,
      terminalAssignmentId: challenge.terminalAssignmentId,
      terminalProfileKey: challenge.terminalProfileKey,
      provisioningCodeId: challenge.provisioningCodeId,
      enrolledKeyFingerprint: station.fingerprint,
      enrollmentState: "sealed",
    };
    const trusted: TrustedTimeEvaluation = {
      status: "trusted",
      trustedTime: new Date(challenge.issuedAt.getTime() + 1000),
    } as TrustedTimeEvaluation;
    const verdict = verifyProvisioningPop(
      challenge,
      signature,
      station.pem,
      expectation,
      trusted,
      publicKeyFingerprint,
    );
    expect(
      verdict.verified,
      `service verification for ${issueKey}: ${verdict.refusalCode ?? ""}`,
    ).toBe(true);
    const { rows: attRows } = await keeper.query<{ result: Record<string, unknown> }>(
      `select kitluy_devices.record_terminal_provisioning_pop_verification_v1($1::uuid, true, $2, $3) as result`,
      [challenge.challengeId, verdict.challengeHash, station.fingerprint],
    );
    expect(attRows[0]?.result.outcome, `attestation for ${issueKey}`).toBe("POP_VERIFIED");
    return { challengeId: challenge.challengeId, codeId: code.id, raw: code.raw, issueKey };
  }

  async function redeem(
    assignmentId: string,
    presented: string,
    challengeId: string,
    idempotencyKey: string,
    serial: string,
    clock?: string,
    ready: Promise<void> = Promise.resolve(),
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      if (clock !== undefined) {
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [clock]);
      }
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5) as result`,
        [assignmentId, presented, challengeId, idempotencyKey, serial],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  async function raceRevoke(
    codeId: string,
    key: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
        [codeId, key, "redemption race audit revocation"],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  async function raceExpire(
    codeId: string,
    clock: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [clock]);
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.expire_terminal_provisioning_code_v1($1::uuid, gen_random_uuid(), 'TEST_HARNESS') as result`,
        [codeId],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  async function raceRecover(
    assignmentId: string,
    originalKey: string,
    recoveryKey: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4) as result`,
        [assignmentId, originalKey, recoveryKey, "redemption race audit recovery"],
      );
      await client.query("commit");
      const result = rows[0]?.result ?? {};
      if (typeof result.code === "string") rawCodes.push(result.code);
      return { pid: pidRows[0]?.pid ?? 0, result, error: null, sqlstate: null };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  function barrier(delayMs = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function expectNoUncontrolled(...racers: RacerOutcome[]): void {
    for (const racer of racers) {
      expect(racer.error, `no uncontrolled error (sqlstate ${racer.sqlstate ?? "n/a"})`).toBeNull();
      expect(racer.sqlstate).toBeNull();
    }
  }

  async function codeRow(codeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, redeemed_at, revocation_reason, redemption_idempotency_key,
              redeemed_with_challenge_id, redeemed_certificate_id
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function challengeRow(challengeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, consumed_at from kitluy_devices.device_provisioning_pop_challenges
        where id = $1::uuid`,
      [challengeId],
    );
    return (rows[0] as Record<string, unknown>) ?? {};
  }

  async function certs(terminalId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await keeper.query(
      `select id, status::text, certificate_serial from kitluy_devices.device_certificates
        where device_id = $1::uuid and environment = 'development' order by created_at`,
      [terminalId],
    );
    return rows as Array<Record<string, unknown>>;
  }

  async function eventCount(codeId: string, type: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = $2`,
      [codeId, type],
    );
    return Number(rows[0]?.n ?? -1);
  }

  /** Sanctioned governor fixture (assertions.sql precedent): close a state. */
  async function governorFixture(sql: string, params: unknown[]): Promise<void> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query("grant kitluy_activation_governor to postgres");
      await client.query("set local role kitluy_activation_governor");
      await client.query(sql, params);
      await client.query("reset role");
      await client.query("revoke kitluy_activation_governor from postgres");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'redemption-race-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enrollDevice("WS11-RRX-HUB");
    await claimAndRedeem(hub.id);
    await activateHub(hub.id, `SERIAL-RRX-HUB-${RUN}-${randomUUID()}`);

    const { rows: pre } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(pre[0]?.n), "LOCATION_E must start with zero projections").toBe(0);
    const hubC1Dev = await enrollDevice("WS11-RRX-HUBC1");
    hubC1 = hubC1Dev.id;
    await claimAndRedeem(hubC1, LOCATION_E);
    await activateHub(hubC1, `SERIAL-RRX-HUBC1-${RUN}-${randomUUID()}`);
    const hubC2Dev = await enrollDevice("WS11-RRX-HUBC2");
    hubC2 = hubC2Dev.id;
    await claimAndRedeem(hubC2, LOCATION_E);

    for (const key of ["a1", "a2", "b1", "d", "e", "f1", "f2", "ra", "fa", "fb"]) {
      stations[key] = await newStation(`WS11-RRX-${key.toUpperCase()}`, LOCATION);
    }
    stations.c1 = await newStation("WS11-RRX-C1", LOCATION_E);
    stations.c2 = await newStation("WS11-RRX-C2", LOCATION_E);

    operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `rrx-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `rrx fixture ${RUN}`, REVOKE_PERMISSION],
    );
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [`rrx fixture ${RUN}`])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("A1: redemption first vs revocation — REDEEMED stands, revocation gets the stable classification", async () => {
    const s = stations.a1;
    const proof = await verifiedProof(s, "WS11-RRX-A1", `rrx-a1-issue-${RUN}`);
    const red = redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `rrx-a1-red-${RUN}`,
      `SER-A1-${RUN}`,
      undefined,
      barrier(0),
    );
    const rev = raceRevoke(proof.codeId, `rrx-a1-rev-${RUN}`, barrier(STAGGER_MS));
    const [rRed, rRev] = await Promise.all([red, rev]);
    console.log(`race A1 backends: redemption pid=${rRed.pid}, revocation pid=${rRev.pid}`);
    expect(rRed.pid).not.toBe(rRev.pid);
    expectNoUncontrolled(rRed, rRev);
    expect(rRed.result.outcome).toBe("REDEEMED");
    expect(rRev.result.outcome).toBe("REVOCATION_REFUSED");
    expect(rRev.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-REDEEMED");
    const code = await codeRow(proof.codeId);
    expect(String(code.state), "never both REVOKED and REDEEMED").toBe("redeemed");
    expect(code.revocation_reason ?? null, "no reason overwrite").toBeNull();
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("consumed");
    expect(await eventCount(proof.codeId, "REDEEMED")).toBe(1);
    expect(await eventCount(proof.codeId, "REVOKED"), "no REVOKED event").toBe(0);
    expect((await certs(s.terminalId)).filter((c) => c.status === "active").length).toBe(1);
  }, 60_000);

  it("A2: revocation first vs redemption — REVOKED stands, proof unconsumed, no credential", async () => {
    const s = stations.a2;
    const proof = await verifiedProof(s, "WS11-RRX-A2", `rrx-a2-issue-${RUN}`);
    const rev = raceRevoke(proof.codeId, `rrx-a2-rev-${RUN}`, barrier(0));
    const red = redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `rrx-a2-red-${RUN}`,
      `SER-A2-${RUN}`,
      undefined,
      barrier(STAGGER_MS),
    );
    const [rRev, rRed] = await Promise.all([rev, red]);
    console.log(`race A2 backends: revocation pid=${rRev.pid}, redemption pid=${rRed.pid}`);
    expect(rRev.pid).not.toBe(rRed.pid);
    expectNoUncontrolled(rRev, rRed);
    expect(rRev.result.outcome).toBe("REVOKED");
    expect(rRed.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(rRed.result.refusal_code).toBe("KLUY-REDEEM-CODE-ALREADY-REVOKED");
    expect(String((await codeRow(proof.codeId)).state)).toBe("revoked");
    const chal = await challengeRow(proof.challengeId);
    expect(String(chal.state), "the proof survives, unconsumed").toBe("verified");
    expect(chal.consumed_at).toBeNull();
    expect(await eventCount(proof.codeId, "REVOKED")).toBe(1);
    expect(await eventCount(proof.codeId, "REDEEMED"), "no REDEEMED event").toBe(0);
    expect((await certs(s.terminalId)).length, "no credential").toBe(0);
  }, 60_000);

  it("B: at the exact µs boundary expiration wins and redemption refuses; strictly before, redemption commits", async () => {
    const s = stations.b1;
    // Control: full redemption strictly before the boundary.
    const control = await verifiedProof(s, "WS11-RRX-B1", `rrx-b1c-issue-${RUN}`);
    const { rows: ctlRows } = await keeper.query<{ e: string }>(
      `select (expires_at - interval '1 second')::text as e
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [control.codeId],
    );
    const before = await redeem(
      s.assignmentId,
      control.raw,
      control.challengeId,
      `rrx-b1c-red-${RUN}`,
      `SER-B1C-${RUN}`,
      String(ctlRows[0]?.e),
    );
    expect(before.error).toBeNull();
    expect(before.result.outcome, "before the boundary the redemption commits").toBe("REDEEMED");

    // The boundary race, on the authoritative microsecond representation.
    const proof = await verifiedProof(s, "WS11-RRX-B1", `rrx-b1-issue-${RUN}`);
    const { rows: bRows } = await keeper.query<{ e: string }>(
      `select expires_at::text as e from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [proof.codeId],
    );
    const boundary = String(bRows[0]?.e);
    const red = redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `rrx-b1-red-${RUN}`,
      `SER-B1-${RUN}`,
      boundary,
      barrier(0),
    );
    const exp = raceExpire(proof.codeId, boundary, barrier(STAGGER_MS));
    const [rRed, rExp] = await Promise.all([red, exp]);
    console.log(`race B backends: redemption pid=${rRed.pid}, expiration pid=${rExp.pid}`);
    expect(rRed.pid).not.toBe(rExp.pid);
    expectNoUncontrolled(rRed, rExp);
    expect(rRed.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(["KLUY-REDEEM-CODE-EXPIRED", "KLUY-REDEEM-PROOF-EXPIRED"]).toContain(
      String(rRed.result.refusal_code),
    );
    expect(rExp.result.outcome).toBe("EXPIRED");
    expect(String((await codeRow(proof.codeId)).state), "EXPIRED is the one terminal state").toBe(
      "expired",
    );
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("verified");
    expect(await eventCount(proof.codeId, "EXPIRED")).toBe(1);
    expect(await eventCount(proof.codeId, "REDEEMED")).toBe(0);
  }, 60_000);

  it("C: Hub withdrawal — redemption-first history is immutable; withdrawal-first fails closed", async () => {
    // C1: redemption first, withdrawal second.
    const s1 = stations.c1;
    const p1 = await verifiedProof(s1, "WS11-RRX-C1", `rrx-c1-issue-${RUN}`);
    const red = redeem(
      s1.assignmentId,
      p1.raw,
      p1.challengeId,
      `rrx-c1-red-${RUN}`,
      `SER-C1-${RUN}`,
      undefined,
      barrier(0),
    );
    const hubDown = (async () => {
      const client = await keeper.connect();
      try {
        const { rows: pidRows } = await client.query<{ pid: number }>(
          "select pg_backend_pid() as pid",
        );
        await client.query("begin");
        await barrier(STAGGER_MS);
        await client.query(
          `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RRX-HUB-TRANSITION', 'OP-RRX')`,
          [hubC1],
        );
        await client.query("commit");
        return {
          pid: pidRows[0]?.pid ?? 0,
          result: { outcome: "ASSIGNMENT_REVOKED" },
          error: null,
          sqlstate: null,
        };
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        return {
          pid: 0,
          result: {},
          error: error instanceof Error ? error.message : String(error),
          sqlstate: (error as { code?: string }).code ?? null,
        };
      } finally {
        client.release();
      }
    })();
    const [rRed, rHub] = await Promise.all([red, hubDown]);
    console.log(`race C1 backends: redemption pid=${rRed.pid}, hub-transition pid=${rHub.pid}`);
    expect(rRed.pid).not.toBe(rHub.pid);
    expectNoUncontrolled(rRed, rHub);
    expect(rRed.result.outcome, "redemption committed on commit-time Hub authority").toBe(
      "REDEEMED",
    );
    expect(rHub.result.outcome).toBe("ASSIGNMENT_REVOKED");
    expect(String((await codeRow(p1.codeId)).state), "history never rewritten").toBe("redeemed");
    expect(String((await challengeRow(p1.challengeId)).state)).toBe("consumed");
    expect((await certs(s1.terminalId)).filter((c) => c.status === "active").length).toBe(1);

    // C2: withdrawal first, redemption second.
    await activateHub(hubC2, `SERIAL-RRX-HUBC2-${RUN}-${randomUUID()}`);
    const s2 = stations.c2;
    const p2 = await verifiedProof(s2, "WS11-RRX-C2", `rrx-c2-issue-${RUN}`);
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RRX-HUB-TRANSITION', 'OP-RRX')`,
      [hubC2],
    );
    const refused = await redeem(
      s2.assignmentId,
      p2.raw,
      p2.challengeId,
      `rrx-c2-red-${RUN}`,
      `SER-C2-${RUN}`,
    );
    expect(refused.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(refused.result.refusal_code).toBe("KLUY-REDEEM-HUB-INACTIVE");
    expect(String((await codeRow(p2.codeId)).state)).toBe("issued");
    expect(String((await challengeRow(p2.challengeId)).state)).toBe("verified");
    expect((await certs(s2.terminalId)).length, "no credential from stale authority").toBe(0);
    expect(await eventCount(p2.codeId, "REDEEMED")).toBe(0);
  }, 60_000);

  it("D: enrollment superseded first — the E1-bound proof can no longer redeem; zero residue", async () => {
    // SANCTIONED GOVERNOR FIXTURE (recorded): the governed reenroll path
    // requires TPM/secure-element continuity that software-trust fixtures
    // cannot prove (KLD-2026-07-28-002 §11), so the enrollment is closed
    // through the state machine directly, exactly as assertions.sql plants
    // its terminal-state fixtures.
    const s = stations.d;
    const proof = await verifiedProof(s, "WS11-RRX-D", `rrx-d-issue-${RUN}`);
    // The enrollment table is owned by the migration authority (0120): the
    // state-closing fixture runs directly, the same authority reenroll uses.
    await keeper.query(
      `update kitluy_devices.manufacturing_enrollments
          set state = 'superseded', superseded_at = now() where id = $1::uuid`,
      [s.enrollmentId],
    );
    const refused = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `rrx-d-red-${RUN}`,
      `SER-D-${RUN}`,
    );
    expect(refused.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(refused.result.refusal_code, "a stale enrollment binding never redeems").toBe(
      "KLUY-REDEEM-ENROLLMENT-INELIGIBLE",
    );
    expect(String((await codeRow(proof.codeId)).state)).toBe("issued");
    const chal = await challengeRow(proof.challengeId);
    expect(String(chal.state), "the proof is not consumed on a stale binding").toBe("verified");
    expect((await certs(s.terminalId)).length, "no credential to a non-current enrollment").toBe(0);
    expect(await eventCount(proof.codeId, "REDEEMED")).toBe(0);
  }, 60_000);

  it("E: credential revoked between cycles — never re-bound, fresh issue allowed, replay names the ORIGINAL", async () => {
    const s = stations.e;
    // Cycle 1: redeem (ISSUES certificate 1).
    const p1 = await verifiedProof(s, "WS11-RRX-E", `rrx-e1-issue-${RUN}`);
    const r1 = await redeem(
      s.assignmentId,
      p1.raw,
      p1.challengeId,
      `rrx-e1-red-${RUN}`,
      `SER-E1-${RUN}`,
    );
    expect(r1.result.outcome).toBe("REDEEMED");
    const cert1 = String(r1.result.certificate_id);

    // The bound credential is revoked (governor fixture — no governed
    // status-table revocation door exists; recorded).
    await governorFixture(
      `update kitluy_devices.device_certificates
          set status = 'revoked', revoked_at = now(), revocation_reason = 'RRX-FIXTURE'
        where id = $1::uuid`,
      [cert1],
    );

    // Replay of the FIRST redemption: names the ORIGINAL credential and
    // issues nothing (redemption replay is never credential recovery).
    const replay = await redeem(
      s.assignmentId,
      p1.raw,
      p1.challengeId,
      `rrx-e1-red-${RUN}`,
      `SER-E1-${RUN}`,
    );
    expect(replay.result.outcome).toBe("ALREADY_REDEEMED");
    expect(String(replay.result.certificate_id), "the replay names the original credential").toBe(
      cert1,
    );
    expect((await certs(s.terminalId)).length, "the replay issued nothing").toBe(1);

    // Cycle 2: a fresh code + proof — the revoked credential is never
    // re-bound; a fresh eligible development credential is issued (the
    // authority explicitly allows issuance when no ACTIVE credential exists).
    const p2 = await verifiedProof(s, "WS11-RRX-E", `rrx-e2-issue-${RUN}`);
    const r2 = await redeem(
      s.assignmentId,
      p2.raw,
      p2.challengeId,
      `rrx-e2-red-${RUN}`,
      `SER-E2-${RUN}`,
    );
    expect(r2.error).toBeNull();
    expect(r2.result.outcome).toBe("REDEEMED");
    expect(r2.result.credential_action, "a fresh credential is issued, never the revoked one").toBe(
      "ISSUED",
    );
    expect(String(r2.result.certificate_id)).not.toBe(cert1);
    const all = await certs(s.terminalId);
    expect(all.filter((c) => c.status === "active").length, "exactly one active credential").toBe(
      1,
    );
    expect(
      all.filter((c) => c.status === "revoked").length,
      "the revoked one stands as history",
    ).toBe(1);
  }, 60_000);

  it("F: redemption versus lost-code recovery — one serial winner in both orders", async () => {
    // F1: redemption first — recovery answers the stable already-redeemed.
    const s1 = stations.f1;
    const p1 = await verifiedProof(s1, "WS11-RRX-F1", `rrx-f1-issue-${RUN}`);
    const red = redeem(
      s1.assignmentId,
      p1.raw,
      p1.challengeId,
      `rrx-f1-red-${RUN}`,
      `SER-F1-${RUN}`,
      undefined,
      barrier(0),
    );
    const rec = raceRecover(
      s1.assignmentId,
      `rrx-f1-issue-${RUN}`,
      `rrx-f1-recover-${RUN}`,
      barrier(STAGGER_MS),
    );
    const [rRed, rRec] = await Promise.all([red, rec]);
    console.log(`race F1 backends: redemption pid=${rRed.pid}, recovery pid=${rRec.pid}`);
    expect(rRed.pid).not.toBe(rRec.pid);
    expectNoUncontrolled(rRed, rRec);
    expect(rRed.result.outcome).toBe("REDEEMED");
    expect(rRec.result.outcome).toBe("RECOVERY_REFUSED");
    expect(rRec.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-REDEEMED");
    const { rows: f1Rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid`,
      [s1.assignmentId],
    );
    expect(Number(f1Rows[0]?.n), "no recovery successor").toBe(1);
    expect(await eventCount(p1.codeId, "REVOKED"), "no recovery REVOKED event").toBe(0);

    // F2: recovery first — the predecessor proof can redeem neither the
    // REVOKED predecessor nor the fresh successor.
    const s2 = stations.f2;
    const p2 = await verifiedProof(s2, "WS11-RRX-F2", `rrx-f2-issue-${RUN}`);
    const rec2 = raceRecover(
      s2.assignmentId,
      `rrx-f2-issue-${RUN}`,
      `rrx-f2-recover-${RUN}`,
      barrier(0),
    );
    const red2 = redeem(
      s2.assignmentId,
      p2.raw,
      p2.challengeId,
      `rrx-f2-red-${RUN}`,
      `SER-F2-${RUN}`,
      undefined,
      barrier(STAGGER_MS),
    );
    const [rRec2, rRed2] = await Promise.all([rec2, red2]);
    console.log(`race F2 backends: recovery pid=${rRec2.pid}, redemption pid=${rRed2.pid}`);
    expect(rRec2.pid).not.toBe(rRed2.pid);
    expectNoUncontrolled(rRec2, rRed2);
    expect(rRec2.result.outcome).toBe("RECOVERED");
    const successorId = String(rRec2.result.provisioning_code_id);
    expect(rRed2.result.outcome).toBe("REDEMPTION_REFUSED");
    expect(rRed2.result.refusal_code, "the predecessor proof meets the revoked predecessor").toBe(
      "KLUY-REDEEM-CODE-ALREADY-REVOKED",
    );
    expect(String((await codeRow(p2.codeId)).state)).toBe("revoked");
    expect(
      String((await codeRow(successorId)).state),
      "the successor stands ISSUED, un-redeemed",
    ).toBe("issued");
    expect(
      String((await challengeRow(p2.challengeId)).state),
      "the predecessor proof unconsumed",
    ).toBe("verified");
    expect((await certs(s2.terminalId)).length, "no credential from either racer").toBe(0);
    expect(await eventCount(successorId, "REDEEMED")).toBe(0);
  }, 60_000);

  it("replays: lost response is a pure history lookup — across Hub, enrollment and credential changes", async () => {
    const s = stations.ra;
    const proof = await verifiedProof(s, "WS11-RRX-RA", `rrx-ra-issue-${RUN}`);
    const key = `rrx-ra-red-${RUN}`;
    const r = await redeem(s.assignmentId, proof.raw, proof.challengeId, key, `SER-RA-${RUN}`);
    expect(r.result.outcome).toBe("REDEEMED");
    const certId = String(r.result.certificate_id);
    const redeemedAt = String(r.result.redeemed_at);

    // Plain lost-response replay: identical ids and timestamp (the replay
    // answer carries the committed row's identity; the correlation identity
    // is proven by the unchanged one-event set below).
    const rep1 = await redeem(s.assignmentId, proof.raw, proof.challengeId, key, `SER-RA-${RUN}`);
    expect(rep1.result.outcome).toBe("ALREADY_REDEEMED");
    expect(String(rep1.result.provisioning_code_id)).toBe(proof.codeId);
    expect(String(rep1.result.pop_challenge_id)).toBe(proof.challengeId);
    expect(String(rep1.result.certificate_id)).toBe(certId);
    expect(new Date(String(rep1.result.redeemed_at)).getTime()).toBe(
      new Date(redeemedAt).getTime(),
    );
    expect("code" in rep1.result).toBe(false);
    expect(await eventCount(proof.codeId, "REDEEMED"), "no new event").toBe(1);

    // A different serial with the SAME immutable identity: RECORDED POLICY —
    // the serial is first-issuance input, not replay identity; the committed
    // certificate's serial is authoritative and nothing is re-issued.
    const rep2 = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      key,
      `SER-RA-DIFFERENT-${RUN}`,
    );
    expect(rep2.result.outcome).toBe("ALREADY_REDEEMED");
    expect(String(rep2.result.certificate_id)).toBe(certId);

    // After enrollment supersession AND credential revocation, the replay is
    // STILL the same historical answer — current operational eligibility is a
    // different question and history is never rewritten.
    // The enrollment table is owned by the migration authority (0120): the
    // state-closing fixture runs directly, the same authority reenroll uses.
    await keeper.query(
      `update kitluy_devices.manufacturing_enrollments
          set state = 'superseded', superseded_at = now() where id = $1::uuid`,
      [s.enrollmentId],
    );
    await governorFixture(
      `update kitluy_devices.device_certificates
          set status = 'revoked', revoked_at = now(), revocation_reason = 'RRX-FIXTURE'
        where id = $1::uuid`,
      [certId],
    );
    const rep3 = await redeem(s.assignmentId, proof.raw, proof.challengeId, key, `SER-RA-${RUN}`);
    expect(rep3.result.outcome, "history survives enrollment and credential changes").toBe(
      "ALREADY_REDEEMED",
    );
    expect(String(rep3.result.certificate_id), "the ORIGINAL credential is named").toBe(certId);
    expect(
      (await certs(s.terminalId)).filter((c) => c.status === "active").length,
      "nothing re-issued",
    ).toBe(0);
    expect(String((await codeRow(proof.codeId)).state)).toBe("redeemed");
    expect(String((await challengeRow(proof.challengeId)).state)).toBe("consumed");

    // Hostile: the same key with a different assignment or challenge.
    const other = stations.a1;
    const wrongAssignment = await redeem(
      other.assignmentId,
      proof.raw,
      proof.challengeId,
      key,
      `SER-RA-${RUN}`,
    );
    expect(wrongAssignment.result.refusal_code).toBe("KLUY-REDEEM-CONFLICTING-REPLAY");
    const wrongChallenge = await redeem(
      s.assignmentId,
      proof.raw,
      randomUUID(),
      key,
      `SER-RA-${RUN}`,
    );
    expect(wrongChallenge.result.refusal_code).toBe("KLUY-REDEEM-CONFLICTING-REPLAY");
    const blankKey = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      "  ",
      `SER-RA-${RUN}`,
    );
    expect(blankKey.result.refusal_code).toBe("KLUY-REDEEM-NO-IDEMPOTENCY-KEY");
  }, 60_000);

  it("fault A: a code-transition fault after proof consumption aborts everything", async () => {
    const s = stations.fa;
    const proof = await verifiedProof(s, "WS11-RRX-FA", `rrx-fa-issue-${RUN}`);
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query("grant kitluy_activation_governor to postgres");
      await client.query(
        `create function public.ws11_rrx_fa_${RUN}() returns trigger language plpgsql as $f$
           begin raise exception 'WS11-RRX-FAULT-A' using errcode = 'KL930'; end $f$`,
      );
      await client.query(
        `grant execute on function public.ws11_rrx_fa_${RUN}() to kitluy_activation_governor`,
      );
      await client.query("set local role kitluy_activation_governor");
      await client.query(
        `create trigger zz_ws11_rrx_fa before update on kitluy_devices.device_provisioning_codes
           for each row when (new.state = 'redeemed' and new.id = '${proof.codeId}')
           execute function public.ws11_rrx_fa_${RUN}()`,
      );
      await client.query("reset role");
      await expect(
        client.query(
          `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5)`,
          [s.assignmentId, proof.raw, proof.challengeId, `rrx-fa-red-${RUN}`, `SER-FA-${RUN}`],
        ),
      ).rejects.toMatchObject({ code: "KL930" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    // The proof transition that happened IN-FLIGHT rolled back with the rest.
    const chal = await challengeRow(proof.challengeId);
    expect(String(chal.state), "the proof remains VERIFIED").toBe("verified");
    expect(chal.consumed_at).toBeNull();
    const code = await codeRow(proof.codeId);
    expect(String(code.state)).toBe("issued");
    expect(code.redeemed_at ?? null).toBeNull();
    expect(code.redemption_idempotency_key ?? null, "no idempotency residue").toBeNull();
    expect((await certs(s.terminalId)).length, "the credential rolled back too").toBe(0);
    expect(await eventCount(proof.codeId, "REDEEMED")).toBe(0);
    const { rows: residue } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger where tgname like 'zz_ws11_rrx%'`,
    );
    expect(Number(residue[0]?.n), "no fault residue").toBe(0);
    const clean = await redeem(
      s.assignmentId,
      proof.raw,
      proof.challengeId,
      `rrx-fa-clean-${RUN}`,
      `SER-FA2-${RUN}`,
    );
    expect(clean.result.outcome, "the undamaged state redeems cleanly").toBe("REDEEMED");
  }, 60_000);

  it("fault B: an event fault on the BIND path leaves the existing binding untouched", async () => {
    const s = stations.fb;
    // Cycle 1 issues the credential; cycle 2 will BIND it.
    const p1 = await verifiedProof(s, "WS11-RRX-FB", `rrx-fb1-issue-${RUN}`);
    const r1 = await redeem(
      s.assignmentId,
      p1.raw,
      p1.challengeId,
      `rrx-fb1-red-${RUN}`,
      `SER-FB1-${RUN}`,
    );
    expect(r1.result.outcome).toBe("REDEEMED");
    const certId = String(r1.result.certificate_id);

    const p2 = await verifiedProof(s, "WS11-RRX-FB", `rrx-fb2-issue-${RUN}`);
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query("grant kitluy_activation_governor to postgres");
      await client.query(
        `create function public.ws11_rrx_fb_${RUN}() returns trigger language plpgsql as $f$
           begin raise exception 'WS11-RRX-FAULT-B' using errcode = 'KL931'; end $f$`,
      );
      await client.query(
        `grant execute on function public.ws11_rrx_fb_${RUN}() to kitluy_activation_governor`,
      );
      await client.query("set local role kitluy_activation_governor");
      await client.query(
        `create trigger zz_ws11_rrx_fb before insert on kitluy_devices.device_provisioning_code_events
           for each row when (new.event_type = 'REDEEMED' and new.provisioning_code_id = '${p2.codeId}')
           execute function public.ws11_rrx_fb_${RUN}()`,
      );
      await client.query("reset role");
      await expect(
        client.query(
          `select kitluy_devices.redeem_terminal_provisioning_code_v1($1::uuid, $2, $3::uuid, $4, $5)`,
          [s.assignmentId, p2.raw, p2.challengeId, `rrx-fb2-red-${RUN}`, `SER-FB2-${RUN}`],
        ),
      ).rejects.toMatchObject({ code: "KL931" });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    expect(String((await codeRow(p2.codeId)).state)).toBe("issued");
    expect(String((await challengeRow(p2.challengeId)).state)).toBe("verified");
    const all = await certs(s.terminalId);
    expect(all.length, "the existing binding is untouched — no new row, no loss").toBe(1);
    expect(String(all[0]?.id)).toBe(certId);
    expect(String(all[0]?.status)).toBe("active");
    expect(await eventCount(p2.codeId, "REDEEMED")).toBe(0);
    const clean = await redeem(
      s.assignmentId,
      p2.raw,
      p2.challengeId,
      `rrx-fb2-clean-${RUN}`,
      `SER-FB3-${RUN}`,
    );
    expect(clean.result.outcome).toBe("REDEEMED");
    expect(clean.result.credential_action, "the clean retry BINDS the standing credential").toBe(
      "BOUND",
    );
  }, 60_000);

  it("security: doors stay harness-only and no raw material or residue exists anywhere", async () => {
    const deniedAsRole = async (role: string, probe: string): Promise<void> => {
      const client = await keeper.connect();
      try {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: operator, role }),
        ]);
        await client.query(`set local role ${role}`);
        await expect(client.query(probe), `${role}: ${probe}`).rejects.toMatchObject({
          code: "42501",
        });
        await client.query("rollback");
      } finally {
        client.release();
      }
    };
    // See the P02C note in the PoP suite: service_role reaches these doors
    // only through the 0172 composition membership, never a direct grant.
    for (const role of ["anon", "authenticated"]) {
      await deniedAsRole(
        role,
        `select kitluy_devices.redeem_terminal_provisioning_code_v1(gen_random_uuid(), 'AAAAAAAA', gen_random_uuid(), 'k', 's')`,
      );
    }
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_pop_challenges set state = 'consumed' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `insert into kitluy_devices.device_provisioning_code_events
         (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
          event_type, actor_type) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
          gen_random_uuid(), 'development', 'REDEEMED', 'TERMINAL')`,
    );

    expect(rawCodes.length).toBeGreaterThan(0);
    for (const raw of rawCodes) {
      const { rows } = await keeper.query<{ n: string }>(
        `select (select count(*) from kitluy_devices.device_provisioning_code_events where detail::text like '%' || $1 || '%')
              + (select count(*) from kitluy_devices.device_certificates where certificate_serial = $1)
              as n`,
        [raw],
      );
      expect(Number(rows[0]?.n), `raw code ${raw} leaked`).toBe(0);
    }
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n)).toBe(0);
    const { rows: faults } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger where tgname like 'zz_ws11_rrx%'`,
    );
    expect(Number(faults[0]?.n), "no fault mechanism survives the suite").toBe(0);
  }, 60_000);
});
