/**
 * RECOVERY RACE AND REPLAY HARDENING.
 *
 * WS-11-T004-P02B2B2B2B. Proves the 0169 atomic lost-code recovery door
 * against concurrent explicit revocation (0165), canonical expiration at the
 * authoritative boundary (0166), fifth-failure lockout and correct
 * presentation (0164/0166), and the REAL governed Hub projection withdrawal
 * (0121 `revoke_device_assignment_v1`), on genuinely separate pooled backends
 * with recorded PIDs — plus lost-response replays, successor-state replays,
 * hostile/conflicting keys, and a transaction-local failure-injection proof
 * of atomic rollback.
 *
 * PRE-EDIT LOCK-ORDER AUDIT (verified against migrations 0163/0165/0166/
 * 0164/0169):
 *   recovery   : recovery-key row FOR UPDATE (replay path RETURNS while
 *                holding it — it never proceeds to any later lock) ->
 *                ASSIGNMENT for update -> key recheck -> liveness -> derived
 *                scope -> Hub projection read (unlocked, statement snapshot)
 *                -> exact scoped permissions -> original CODE for update ->
 *                state recheck UNDER the lock -> guarded mutation -> events
 *   revocation : idempotency row -> unlocked read -> ASSIGNMENT for update
 *                -> CODE for update -> idempotency recheck -> guarded update
 *   expiration : unlocked read -> ASSIGNMENT for update -> CODE for update
 *                -> boundary check -> guarded update
 *   evaluator  : ASSIGNMENT for update -> outstanding CODE for update ->
 *                delegated expiry (0166 helper, re-entrant) -> digest ->
 *                attempt/lock mutation
 *   hub door   : DEVICE row for update -> assignment updates -> projection
 *                DELETE (committed, governed)
 *   Every door locks ASSIGNMENT first, CODE second; no reversed order. No
 *   unlocked terminal-state decision survives to a mutation (recovery
 *   rechecks state under the code lock; the guarded UPDATE re-tests
 *   state='issued'). Key-row holders never request the assignment lock
 *   (found -> immediate return), so no lock cycle exists between the
 *   idempotency stage and the assignment stage of any door.
 *
 * RACE MATRIX (staggered release; both racers always on separate recorded
 * backends; winner rules and required residue asserted inline):
 *   A1 recovery first vs revocation      -> old REVOKED by recovery, one
 *      successor, late revocation gets ALREADY-REVOKED, no reason overwrite
 *   A2 revocation first vs recovery      -> old REVOKED by 0165, recovery
 *      gets ALREADY-REVOKED, NO successor, no recovery events
 *   B  recovery vs canonical expiry at the exact authoritative boundary ->
 *      old EXPIRED, one EXPIRED event, recovery ALREADY-EXPIRED, no raw code
 *      (+ separate control: recovery SUCCEEDS strictly before the boundary)
 *   C1 fifth failure first (primed to 4) -> old LOCKED at 5, recovery gets
 *      ALREADY-LOCKED, no successor
 *   C2 recovery first (primed to 4)      -> old REVOKED with count frozen at
 *      4, late wrong presentation meets the LIVE successor (one bounded
 *      failure on the successor — DOCUMENTED GOVERNED OUTCOME, 0166
 *      evaluator step 2 evaluates the CURRENT outstanding code; never a
 *      fifth attempt on the predecessor, never LOCKED)
 *   D1 correct presentation first        -> MATCH_READY + PRESENTED event is
 *      NON-AUTHORITATIVE: recovery still revokes and reissues; no redemption
 *   D2 recovery first                    -> the superseded correct value is
 *      an ordinary mismatch against the successor; never MATCH_READY, no
 *      PRESENTED after the revocation (same documented outcome as C2)
 *   E1 recovery first vs governed Hub withdrawal -> successor binds the Hub
 *      that was eligible at commit; later withdrawal never rewrites history;
 *      follow-on issuance revalidates and fails HUB-INACTIVE
 *   E2 Hub withdrawal first              -> recovery fails closed
 *      HUB-INACTIVE; old stays ISSUED; zero residue
 *
 * REPLAYS: lost-response replay (ALREADY_RECOVERED, ids only, no raw code,
 * no new work); successor revoked/expired/locked then replayed (current
 * terminal state reported safely, no second recovery); hostile keys (wrong
 * assignment / wrong original key / wrong reason -> CONFLICTING-REPLAY fail
 * closed; wrong environment / no permission -> safe refusal with no row
 * identity; 0168 issuance-door replay privacy re-proven).
 *
 * FAILURE INJECTION: a transaction-local fault trigger (installed by the
 * NOLOGIN table owner INSIDE the doomed transaction, on the poisoned
 * recovery key only) forces the successor INSERT to fail AFTER the old code
 * was already revoked in-flight — the whole transaction aborts and the
 * rollback leaves the old code ISSUED with zero residue; the fault mechanism
 * itself rolls back with it and cannot survive to production state.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
// The sibling seeded branch: race E must own EVERY projection at its scope so
// a governed withdrawal really leaves zero (same choice as the cross-race
// suite; the two files run serially and each activates its own Hub here).
const LOCATION_E = "00000000-0000-4000-8000-000000000019";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const REASON = "recovery race fixture: printed code sleeve lost during install";
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
if (!live) console.warn("SKIPPED: recovery race hardening — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
  expiresAt: string;
}

interface RacerOutcome {
  pid: number;
  result: Record<string, unknown>;
  error: string | null;
  sqlstate: string | null;
}

interface Station {
  assignmentId: string;
  terminalId: string;
}

interface Fixture {
  hub: string;
  hubE1: string;
  hubE2: string;
  operator: string;
  operatorWrongEnv: string;
  operatorNoGrant: string;
  stations: Record<string, Station>;
}

const STATION_KEYS = [
  "a1",
  "a2",
  "b1",
  "b2",
  "c1",
  "c2",
  "d1",
  "d2",
  "e1",
  "e1b",
  "e2",
  "ra",
  "rb1",
  "rb2",
  "rb3",
  "rc",
  "fi",
] as const;

/** Every raw code this fixture ever received — census evidence only. */
const rawCodes: string[] = [];

describe.skipIf(!live)("recovery race and replay hardening (0169), separate backends", () => {
  let keeper: pg.Pool;
  let fixture: Fixture;

  async function enroll(label: string, fingerprint: string): Promise<string> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const profile = rows[0]?.id;
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RREC', 'OP-RREC', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profile,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `ee:dd:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return enrolled[0]?.id ?? "";
  }

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<void> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-RREC')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    await keeper.query(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-RREC')`,
      [token, payload, deviceId],
    );
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RREC')`,
      [hubId, serial, "d1".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
  }

  async function newStation(label: string, location: string = LOCATION): Promise<Station> {
    const terminal = await enroll(
      label,
      randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
    );
    await claimAndRedeem(terminal, location);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RREC') as id`,
      [terminal, location],
    );
    return { assignmentId: rows[0]?.id ?? "", terminalId: terminal };
  }

  async function issueCode(assignmentId: string, key: string): Promise<IssuedCode> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, key],
      );
      await client.query("commit");
      const result = rows[0]?.result ?? {};
      expect(result.outcome, `issuance for ${key} must succeed`).toBe("ISSUED");
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

  /** Recovery racer through the 0169 door, optional clock, optional actor. */
  async function raceRecover(
    assignmentId: string,
    originalKey: string,
    recoveryKey: string,
    ready: Promise<void>,
    clock?: string,
    actor?: string,
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
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: actor ?? fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4) as result`,
        [assignmentId, originalKey, recoveryKey, REASON],
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

  /** Revocation racer through the 0165 door (live clock). */
  async function raceRevoke(
    codeId: string,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
        [codeId, idempotencyKey, "race audit: operator revocation of the same code"],
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

  /** Canonical-expiration racer: the harness-only 0166 helper, clocked. */
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

  /** Presentation racer: the internal evaluator as the harness (live clock). */
  async function racePresent(
    assignmentId: string,
    presented: string,
    terminalRef: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
           $1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3::text) as result`,
        [assignmentId, presented, terminalRef],
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

  /** Hub-transition racer: the REAL governed projection withdrawal (0121). */
  async function raceHubRevoke(hubId: string, ready: Promise<void>): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await ready;
      await client.query(
        `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RREC-HUB-TRANSITION', 'OP-RREC')`,
        [hubId],
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
  }

  function barrier(delayMs = 0): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  function expectNoUncontrolled(...racers: RacerOutcome[]): void {
    for (const racer of racers) {
      expect(racer.error, `no uncontrolled error (sqlstate ${racer.sqlstate ?? "n/a"})`).toBeNull();
      expect(racer.sqlstate, "no raw SQLSTATE escaped to a caller").toBeNull();
    }
  }

  async function codeRows(assignmentId: string): Promise<
    Array<{
      id: string;
      state: string;
      idempotency_key: string | null;
      revocation_idempotency_key: string | null;
      revocation_reason: string | null;
      replaces_provisioning_code_id: string | null;
      failed_attempt_count: number;
      store_hub_device_id: string;
      revoked_at: string | null;
      expires_at: string;
      correlation_id: string;
    }>
  > {
    const { rows } = await keeper.query(
      `select id, state::text, idempotency_key, revocation_idempotency_key, revocation_reason,
              replaces_provisioning_code_id, failed_attempt_count, store_hub_device_id,
              revoked_at, expires_at, correlation_id
         from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid order by created_at`,
      [assignmentId],
    );
    return rows as never;
  }

  async function eventCount(codeId: string, eventType: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = $2`,
      [codeId, eventType],
    );
    return Number(rows[0]?.n ?? -1);
  }

  /** Prime failures the sanctioned way: genuine wrong evaluator presentations. */
  async function primeAttempts(station: Station, code: IssuedCode, count: number): Promise<void> {
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    for (let attempt = 1; attempt <= count; attempt += 1) {
      const { rows } = await keeper.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
           $1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3::text) as result`,
        [station.assignmentId, wrong, station.terminalId],
      );
      expect(rows[0]?.result.outcome, `priming failure ${attempt}`).toBe("FAILED_PRESENTATION");
      expect(rows[0]?.result.failed_attempt_count).toBe(attempt);
    }
  }

  async function recoverOnce(
    station: Station,
    originalKey: string,
    recoveryKey: string,
  ): Promise<{ oldId: string; newId: string; raw: string }> {
    const issued = await issueCode(station.assignmentId, originalKey);
    const recovered = await raceRecover(
      station.assignmentId,
      originalKey,
      recoveryKey,
      Promise.resolve(),
    );
    expect(recovered.error).toBeNull();
    expect(recovered.result.outcome, `recovery for ${recoveryKey} must succeed`).toBe("RECOVERED");
    return {
      oldId: issued.id,
      newId: String(recovered.result.provisioning_code_id),
      raw: String(recovered.result.code),
    };
  }

  async function makeUser(label: string): Promise<string> {
    const id = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [id, `${label}-${RUN}@fixture.invalid`],
    );
    return id;
  }

  async function grant(subject: string, permission: string, environment: string): Promise<void> {
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, $3, now() - interval '1 minute', now() + interval '30 minutes', $4)`,
      [subject, permission, environment, `recovery race fixture ${RUN}`],
    );
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });

    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'recovery-race-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enroll("WS11-RREC-HUB", "a1".repeat(32));
    await claimAndRedeem(hub);
    await activateHub(hub, `SERIAL-RREC-HUB-${RUN}-${randomUUID()}`);
    // Race E owns LOCATION_E outright: hubE1 activated now (withdrawn in E1);
    // hubE2 enrolled+claimed only, activated inside E2 so E1's follow-on
    // revalidation check really sees zero projections at the scope.
    const hubE1 = await enroll("WS11-RREC-HUBE1", "a2".repeat(32));
    await claimAndRedeem(hubE1, LOCATION_E);
    await activateHub(hubE1, `SERIAL-RREC-HUBE1-${RUN}-${randomUUID()}`);
    const hubE2 = await enroll("WS11-RREC-HUBE2", "a3".repeat(32));
    await claimAndRedeem(hubE2, LOCATION_E);

    const stations: Record<string, Station> = {};
    for (const key of STATION_KEYS) {
      const location = key.startsWith("e") ? LOCATION_E : LOCATION;
      stations[key] = await newStation(`WS11-RREC-${key.toUpperCase()}`, location);
    }

    const operator = await makeUser("rrec-operator");
    await grant(operator, ISSUE_PERMISSION, "development");
    await grant(operator, REVOKE_PERMISSION, "development");
    const operatorWrongEnv = await makeUser("rrec-wrong-env");
    await grant(operatorWrongEnv, ISSUE_PERMISSION, "pilot");
    await grant(operatorWrongEnv, REVOKE_PERMISSION, "pilot");
    const operatorNoGrant = await makeUser("rrec-nogrant");

    fixture = { hub, hubE1, hubE2, operator, operatorWrongEnv, operatorNoGrant, stations };
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [
        `recovery race fixture ${RUN}`,
      ])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  // -----------------------------------------------------------------------
  // RACE A — recovery versus explicit revocation of the same code.
  // -----------------------------------------------------------------------

  it("A1: recovery first — old REVOKED by recovery, one successor; late revocation is a stable classification", async () => {
    const station = fixture.stations.a1;
    const code = await issueCode(station.assignmentId, `rrace-a1-issue-${RUN}`);
    const recover = raceRecover(
      station.assignmentId,
      `rrace-a1-issue-${RUN}`,
      `rrace-a1-recover-${RUN}`,
      barrier(0),
    );
    const revoke = raceRevoke(code.id, `rrace-a1-revoke-${RUN}`, barrier(STAGGER_MS));
    const [rRecover, rRevoke] = await Promise.all([recover, revoke]);
    console.log(`race A1 backends: recovery pid=${rRecover.pid}, revocation pid=${rRevoke.pid}`);
    expect(rRecover.pid).not.toBe(rRevoke.pid);
    expectNoUncontrolled(rRecover, rRevoke);

    expect(rRecover.result.outcome, "the recovery wins the serialization").toBe("RECOVERED");
    const newId = String(rRecover.result.provisioning_code_id);
    // The 0165 stable classification for an already-revoked code (any key):
    // ALREADY_REVOKED, "the original revocation stands unchanged" — zero
    // mutation, zero event, zero reason overwrite.
    expect(rRevoke.result.outcome, "the losing revocation gets the stable classification").toBe(
      "ALREADY_REVOKED",
    );
    expect(rRevoke.result.state).toBe("revoked");

    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "exactly one successor").toBe(2);
    const old = rows.find((row) => row.id === code.id);
    expect(old?.state).toBe("revoked");
    expect(old?.revocation_reason, "the recovery reason is never overwritten by the loser").toBe(
      REASON,
    );
    expect(old?.revocation_idempotency_key, "the recovery key marks the revocation").toBe(
      `rrace-a1-recover-${RUN}`,
    );
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(newId, "CREATED"), "exactly one successor CREATED event").toBe(1);
    expect(rows.find((row) => row.id === newId)?.state).toBe("issued");
  }, 60_000);

  it("A2: revocation first — old REVOKED by 0165; recovery is a stable terminal refusal with NO successor", async () => {
    const station = fixture.stations.a2;
    const code = await issueCode(station.assignmentId, `rrace-a2-issue-${RUN}`);
    const revoke = raceRevoke(code.id, `rrace-a2-revoke-${RUN}`, barrier(0));
    const recover = raceRecover(
      station.assignmentId,
      `rrace-a2-issue-${RUN}`,
      `rrace-a2-recover-${RUN}`,
      barrier(STAGGER_MS),
    );
    const [rRevoke, rRecover] = await Promise.all([revoke, recover]);
    console.log(`race A2 backends: revocation pid=${rRevoke.pid}, recovery pid=${rRecover.pid}`);
    expect(rRevoke.pid).not.toBe(rRecover.pid);
    expectNoUncontrolled(rRevoke, rRecover);

    expect(rRevoke.result.outcome, "the revocation wins the serialization").toBe("REVOKED");
    expect(rRecover.result.outcome).toBe("RECOVERY_REFUSED");
    expect(rRecover.result.refusal_code, "a plainly revoked code is never recoverable").toBe(
      "KLUY-PROVCODE-ALREADY-REVOKED",
    );
    expect("code" in rRecover.result, "no raw code on the losing recovery").toBe(false);

    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "no successor was created").toBe(1);
    expect(rows[0]?.state, "one terminal state, never reversed").toBe("revoked");
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(code.id, "CREATED"), "only the original CREATED event").toBe(1);
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE B — recovery versus canonical expiration at the exact boundary.
  // -----------------------------------------------------------------------

  it("B: at the authoritative boundary the code EXPIRES and recovery refuses; strictly before it, recovery succeeds", async () => {
    // Control first (separate assignment): recovery on the still-valid code.
    const control = fixture.stations.b2;
    const controlCode = await issueCode(control.assignmentId, `rrace-b2-issue-${RUN}`);
    const beforeBoundary = new Date(new Date(controlCode.expiresAt).getTime() - 1000).toISOString();
    const rControl = await raceRecover(
      control.assignmentId,
      `rrace-b2-issue-${RUN}`,
      `rrace-b2-recover-${RUN}`,
      Promise.resolve(),
      beforeBoundary,
    );
    expect(rControl.error).toBeNull();
    expect(rControl.result.outcome, "immediately before expiry the code is recoverable").toBe(
      "RECOVERED",
    );
    const controlRows = await codeRows(control.assignmentId);
    expect(controlRows.find((row) => row.id === controlCode.id)?.state).toBe("revoked");
    expect(controlRows.length).toBe(2);

    // The boundary race: BOTH racers on the sanctioned clock at exactly
    // expires_at (the 0166 equality boundary expires). Recovery released
    // first proves the door's OWN authoritative-boundary refusal; the helper
    // then owns the one EXPIRED transition.
    const station = fixture.stations.b1;
    const code = await issueCode(station.assignmentId, `rrace-b1-issue-${RUN}`);
    // The EXACT stored boundary, at full microsecond precision — a JS Date
    // round-trip truncates to milliseconds and lands strictly BEFORE the
    // stored expires_at, silently turning the boundary race into the control
    // case.
    const { rows: boundaryRows } = await keeper.query<{ e: string }>(
      `select expires_at::text as e from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [code.id],
    );
    const boundary = String(boundaryRows[0]?.e);
    const recover = raceRecover(
      station.assignmentId,
      `rrace-b1-issue-${RUN}`,
      `rrace-b1-recover-${RUN}`,
      barrier(0),
      boundary,
    );
    const expire = raceExpire(code.id, boundary, barrier(STAGGER_MS));
    const [rRecover, rExpire] = await Promise.all([recover, expire]);
    console.log(`race B backends: recovery pid=${rRecover.pid}, expiration pid=${rExpire.pid}`);
    expect(rRecover.pid).not.toBe(rExpire.pid);
    expectNoUncontrolled(rRecover, rExpire);

    expect(rRecover.result.outcome).toBe("RECOVERY_REFUSED");
    expect(
      rRecover.result.refusal_code,
      "at the boundary recovery classifies, never recovers",
    ).toBe("KLUY-PROVCODE-ALREADY-EXPIRED");
    expect("code" in rRecover.result, "no raw code is returned at or past the boundary").toBe(
      false,
    );
    expect(rExpire.result.outcome, "the canonical helper owns the one transition").toBe("EXPIRED");

    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "no recovery successor").toBe(1);
    expect(rows[0]?.state, "the one terminal state is EXPIRED").toBe("expired");
    expect(rows[0]?.revoked_at, "no revocation residue from the refused recovery").toBeNull();
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "REVOKED"), "no REVOKED event").toBe(0);
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE C — recovery versus the fifth failed presentation (primed to 4).
  // -----------------------------------------------------------------------

  it("C1: fifth failure first — old LOCKED at exactly 5; recovery refuses; no successor", async () => {
    const station = fixture.stations.c1;
    const code = await issueCode(station.assignmentId, `rrace-c1-issue-${RUN}`);
    await primeAttempts(station, code, 4);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const present = racePresent(station.assignmentId, wrong, station.terminalId, barrier(0));
    const recover = raceRecover(
      station.assignmentId,
      `rrace-c1-issue-${RUN}`,
      `rrace-c1-recover-${RUN}`,
      barrier(STAGGER_MS),
    );
    const [rPresent, rRecover] = await Promise.all([present, recover]);
    console.log(`race C1 backends: presentation pid=${rPresent.pid}, recovery pid=${rRecover.pid}`);
    expect(rPresent.pid).not.toBe(rRecover.pid);
    expectNoUncontrolled(rPresent, rRecover);

    expect(rPresent.result.outcome).toBe("PRESENTATION_REFUSED");
    expect(rPresent.result.refusal_code, "the fifth failure locks terminally").toBe(
      "KLUY-PROVCODE-LOCKED",
    );
    expect(rPresent.result.failed_attempt_count).toBe(5);
    expect(rRecover.result.outcome).toBe("RECOVERY_REFUSED");
    expect(rRecover.result.refusal_code, "a locked code is never recoverable").toBe(
      "KLUY-PROVCODE-ALREADY-LOCKED",
    );

    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "no successor from a locked predecessor").toBe(1);
    expect(rows[0]?.state, "LOCKED and REVOKED never coexist").toBe("locked");
    expect(rows[0]?.failed_attempt_count, "attempts never exceed five").toBe(5);
    expect(await eventCount(code.id, "LOCKED"), "exactly one LOCKED event").toBe(1);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "exactly five failed attempts").toBe(5);
    expect(await eventCount(code.id, "REVOKED"), "no recovery REVOKED event").toBe(0);
  }, 60_000);

  it("C2: recovery first — old REVOKED with count frozen at 4; the late wrong value meets the LIVE successor", async () => {
    const station = fixture.stations.c2;
    const code = await issueCode(station.assignmentId, `rrace-c2-issue-${RUN}`);
    await primeAttempts(station, code, 4);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const recover = raceRecover(
      station.assignmentId,
      `rrace-c2-issue-${RUN}`,
      `rrace-c2-recover-${RUN}`,
      barrier(0),
    );
    const present = racePresent(
      station.assignmentId,
      wrong,
      station.terminalId,
      barrier(STAGGER_MS),
    );
    const [rRecover, rPresent] = await Promise.all([recover, present]);
    console.log(`race C2 backends: recovery pid=${rRecover.pid}, presentation pid=${rPresent.pid}`);
    expect(rRecover.pid).not.toBe(rPresent.pid);
    expectNoUncontrolled(rRecover, rPresent);

    expect(rRecover.result.outcome, "the recovery wins the serialization").toBe("RECOVERED");
    const newId = String(rRecover.result.provisioning_code_id);

    // DOCUMENTED GOVERNED OUTCOME (0166 evaluator step 2 evaluates the
    // CURRENT outstanding code; cross-race B2 precedent): the late wrong
    // presentation is one ordinary bounded failure against the LIVE
    // successor — never a fifth attempt on the predecessor, never a lock.
    expect(rPresent.result.outcome).toBe("FAILED_PRESENTATION");
    expect(rPresent.result.provisioning_code_id, "the attempt lands on the successor").toBe(newId);
    expect(rPresent.result.failed_attempt_count, "one bounded failure on the successor").toBe(1);

    const rows = await codeRows(station.assignmentId);
    const old = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id === newId);
    expect(old?.state, "the predecessor's one terminal state is REVOKED").toBe("revoked");
    expect(old?.failed_attempt_count, "the predecessor count is frozen at 4").toBe(4);
    expect(successor?.state).toBe("issued");
    expect(successor?.failed_attempt_count, "never above five anywhere").toBeLessThanOrEqual(5);
    expect(await eventCount(code.id, "LOCKED"), "no LOCKED event on the predecessor").toBe(0);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "exactly the four priming attempts").toBe(
      4,
    );
    expect(await eventCount(code.id, "REVOKED"), "one REVOKED event").toBe(1);
    expect(await eventCount(newId, "CREATED"), "one successor CREATED event").toBe(1);
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE D — recovery versus CORRECT presentation (MATCH_READY).
  // -----------------------------------------------------------------------

  it("D1: correct presentation first — MATCH_READY is non-authoritative; recovery still revokes and reissues", async () => {
    const station = fixture.stations.d1;
    const code = await issueCode(station.assignmentId, `rrace-d1-issue-${RUN}`);
    const present = racePresent(station.assignmentId, code.raw, station.terminalId, barrier(0));
    const recover = raceRecover(
      station.assignmentId,
      `rrace-d1-issue-${RUN}`,
      `rrace-d1-recover-${RUN}`,
      barrier(STAGGER_MS),
    );
    const [rPresent, rRecover] = await Promise.all([present, recover]);
    console.log(`race D1 backends: presentation pid=${rPresent.pid}, recovery pid=${rRecover.pid}`);
    expect(rPresent.pid).not.toBe(rRecover.pid);
    expectNoUncontrolled(rPresent, rRecover);

    expect(rPresent.result.outcome, "the correct value of a live code matches").toBe("MATCH_READY");
    expect(
      rRecover.result.outcome,
      "MATCH_READY is a recheck input, never a lock or reservation",
    ).toBe("RECOVERED");
    const newId = String(rRecover.result.provisioning_code_id);

    const rows = await codeRows(station.assignmentId);
    const old = rows.find((row) => row.id === code.id);
    expect(old?.state, "recovery revoked the matched-but-unredeemed code").toBe("revoked");
    expect(
      await eventCount(code.id, "PRESENTED"),
      "the serialized-first PRESENTED event stands",
    ).toBe(1);
    expect(await eventCount(code.id, "REVOKED"), "one REVOKED event").toBe(1);
    expect(await eventCount(code.id, "REDEEMED"), "no redemption exists before P02B3").toBe(0);
    expect(rows.find((row) => row.id === newId)?.state).toBe("issued");
    expect(await eventCount(newId, "CREATED")).toBe(1);
  }, 60_000);

  it("D2: recovery first — the superseded correct value never yields MATCH_READY and no PRESENTED after revocation", async () => {
    const station = fixture.stations.d2;
    const code = await issueCode(station.assignmentId, `rrace-d2-issue-${RUN}`);
    const recover = raceRecover(
      station.assignmentId,
      `rrace-d2-issue-${RUN}`,
      `rrace-d2-recover-${RUN}`,
      barrier(0),
    );
    const present = racePresent(
      station.assignmentId,
      code.raw,
      station.terminalId,
      barrier(STAGGER_MS),
    );
    const [rRecover, rPresent] = await Promise.all([recover, present]);
    console.log(`race D2 backends: recovery pid=${rRecover.pid}, presentation pid=${rPresent.pid}`);
    expect(rRecover.pid).not.toBe(rPresent.pid);
    expectNoUncontrolled(rRecover, rPresent);

    expect(rRecover.result.outcome).toBe("RECOVERED");
    const newId = String(rRecover.result.provisioning_code_id);

    // DOCUMENTED GOVERNED OUTCOME (same authority as C2): the evaluator
    // compares against the LIVE successor's digest only — the revoked
    // predecessor's correct value is an ordinary mismatch, never MATCH_READY.
    expect(rPresent.result.outcome, "never MATCH_READY for a revoked code").not.toBe("MATCH_READY");
    expect(rPresent.result.outcome).toBe("FAILED_PRESENTATION");
    expect(rPresent.result.provisioning_code_id, "the mismatch lands on the successor").toBe(newId);

    expect(await eventCount(code.id, "PRESENTED"), "no PRESENTED event after the revocation").toBe(
      0,
    );
    expect(await eventCount(code.id, "REVOKED"), "one REVOKED event").toBe(1);
    const rows = await codeRows(station.assignmentId);
    expect(rows.find((row) => row.id === code.id)?.state).toBe("revoked");
    expect(rows.find((row) => row.id === newId)?.state).toBe("issued");
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE E — recovery versus the governed Hub projection withdrawal (0121).
  // -----------------------------------------------------------------------

  it("E1: recovery first — successor binds the Hub eligible at commit; later withdrawal never rewrites history; follow-on provisioning revalidates", async () => {
    const station = fixture.stations.e1;
    const code = await issueCode(station.assignmentId, `rrace-e1-issue-${RUN}`);
    const recover = raceRecover(
      station.assignmentId,
      `rrace-e1-issue-${RUN}`,
      `rrace-e1-recover-${RUN}`,
      barrier(0),
    );
    const hubDown = raceHubRevoke(fixture.hubE1, barrier(STAGGER_MS));
    const [rRecover, rHub] = await Promise.all([recover, hubDown]);
    console.log(`race E1 backends: recovery pid=${rRecover.pid}, hub-transition pid=${rHub.pid}`);
    expect(rRecover.pid).not.toBe(rHub.pid);
    expectNoUncontrolled(rRecover, rHub);

    expect(rRecover.result.outcome, "recovery committed while the Hub was still projected").toBe(
      "RECOVERED",
    );
    expect(rHub.result.outcome).toBe("ASSIGNMENT_REVOKED");
    const newId = String(rRecover.result.provisioning_code_id);

    const rows = await codeRows(station.assignmentId);
    const successor = rows.find((row) => row.id === newId);
    expect(
      successor?.store_hub_device_id,
      "the successor binds the Hub that was eligible at commit",
    ).toBe(fixture.hubE1);
    expect(
      rows.find((row) => row.id === code.id)?.state,
      "history is never rewritten by the withdrawal",
    ).toBe("revoked");
    expect(await eventCount(code.id, "REVOKED")).toBe(1);
    expect(await eventCount(newId, "CREATED")).toBe(1);

    // Future terminal provisioning at the scope must revalidate NOW: with the
    // projection withdrawn, a fresh issuance on a sibling assignment fails
    // closed before any mutation.
    const { rows: projections } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION_E],
    );
    expect(Number(projections[0]?.n), "the governed withdrawal really left zero projections").toBe(
      0,
    );
    const followOn = await raceRecover(
      fixture.stations.e1b.assignmentId,
      `rrace-e1b-any-${RUN}`,
      `rrace-e1b-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(followOn.error).toBeNull();
    expect(followOn.result.outcome).toBe("RECOVERY_REFUSED");
    expect(followOn.result.refusal_code, "post-withdrawal provisioning fails the Hub gate").toBe(
      "KLUY-PROVCODE-HUB-INACTIVE",
    );
  }, 60_000);

  it("E2: governed Hub withdrawal first — recovery fails closed HUB-INACTIVE; old code stays ISSUED with zero residue", async () => {
    // Activate this race's own Hub only now, so E1's zero-projection check
    // stayed true, then issue while it is active.
    await activateHub(fixture.hubE2, `SERIAL-RREC-HUBE2-${RUN}-${randomUUID()}`);
    const station = fixture.stations.e2;
    const code = await issueCode(station.assignmentId, `rrace-e2-issue-${RUN}`);
    const hubDown = raceHubRevoke(fixture.hubE2, barrier(0));
    const recover = raceRecover(
      station.assignmentId,
      `rrace-e2-issue-${RUN}`,
      `rrace-e2-recover-${RUN}`,
      barrier(STAGGER_MS),
    );
    const [rHub, rRecover] = await Promise.all([hubDown, recover]);
    console.log(`race E2 backends: hub-transition pid=${rHub.pid}, recovery pid=${rRecover.pid}`);
    expect(rHub.pid).not.toBe(rRecover.pid);
    expectNoUncontrolled(rHub, rRecover);

    expect(rHub.result.outcome, "the governed withdrawal committed first").toBe(
      "ASSIGNMENT_REVOKED",
    );
    expect(rRecover.result.outcome).toBe("RECOVERY_REFUSED");
    expect(rRecover.result.refusal_code, "no stale Hub authority can reissue").toBe(
      "KLUY-PROVCODE-HUB-INACTIVE",
    );
    expect("code" in rRecover.result, "no raw code on the refusal").toBe(false);

    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "no successor").toBe(1);
    expect(rows[0]?.state, "the old code remains ISSUED").toBe("issued");
    expect(rows[0]?.revoked_at, "no revocation timestamp").toBeNull();
    expect(rows[0]?.revocation_idempotency_key, "no idempotency residue").toBeNull();
    expect(await eventCount(code.id, "REVOKED"), "no REVOKED event").toBe(0);
    expect(await eventCount(code.id, "CREATED"), "only the original CREATED event").toBe(1);
  }, 60_000);

  // -----------------------------------------------------------------------
  // REPLAYS — lost responses, successor transitions, hostile keys.
  // -----------------------------------------------------------------------

  it("replay A: a lost-response replay reconciles the pair with no raw code and no new work", async () => {
    const station = fixture.stations.ra;
    const pair = await recoverOnce(station, `rrace-ra-issue-${RUN}`, `rrace-ra-recover-${RUN}`);
    const before = await codeRows(station.assignmentId);
    const successorBefore = before.find((row) => row.id === pair.newId);

    const replay = await raceRecover(
      station.assignmentId,
      `rrace-ra-issue-${RUN}`,
      `rrace-ra-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(replay.error).toBeNull();
    expect(replay.result.outcome).toBe("ALREADY_RECOVERED");
    expect(replay.result.provisioning_code_id, "the successor is named safely").toBe(pair.newId);
    expect(replay.result.revoked_provisioning_code_id, "the predecessor is named safely").toBe(
      pair.oldId,
    );
    expect(replay.result.state, "the successor's current state is reported").toBe("issued");
    expect("code" in replay.result, "the raw code is never reconstructed").toBe(false);
    expect(
      replay.result.raw_code_available,
      "the replay never claims the raw code is available",
    ).toBe(false);

    const after = await codeRows(station.assignmentId);
    expect(after.length, "no new row").toBe(2);
    const successorAfter = after.find((row) => row.id === pair.newId);
    expect(new Date(String(successorAfter?.expires_at)).getTime(), "no expiry extension").toBe(
      new Date(String(successorBefore?.expires_at)).getTime(),
    );
    expect(successorAfter?.correlation_id, "no correlation change").toBe(
      successorBefore?.correlation_id,
    );
    expect(
      after.find((row) => row.id === pair.oldId)?.revocation_reason,
      "no reason overwrite",
    ).toBe(REASON);
    expect(await eventCount(pair.oldId, "REVOKED"), "no duplicate REVOKED event").toBe(1);
    expect(await eventCount(pair.newId, "CREATED"), "no duplicate CREATED event").toBe(1);
  }, 60_000);

  it("replay B: successor revoked, expired or locked through governed paths — the replay reports the pair safely and creates nothing", async () => {
    // (i) successor REVOKED through the 0165 door.
    const s1 = fixture.stations.rb1;
    const p1 = await recoverOnce(s1, `rrace-rb1-issue-${RUN}`, `rrace-rb1-recover-${RUN}`);
    const revoked = await raceRevoke(p1.newId, `rrace-rb1-revoke-${RUN}`, Promise.resolve());
    expect(revoked.result.outcome).toBe("REVOKED");
    const replay1 = await raceRecover(
      s1.assignmentId,
      `rrace-rb1-issue-${RUN}`,
      `rrace-rb1-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(
      replay1.result.outcome,
      "the pair identity survives the successor's own revocation",
    ).toBe("ALREADY_RECOVERED");
    expect(replay1.result.provisioning_code_id).toBe(p1.newId);
    expect(replay1.result.state, "the successor's terminal state is reported safely").toBe(
      "revoked",
    );
    expect("code" in replay1.result).toBe(false);
    expect((await codeRows(s1.assignmentId)).length, "no third row").toBe(2);
    expect(
      await eventCount(p1.oldId, "REVOKED"),
      "the original recovery events are not duplicated",
    ).toBe(1);

    // (ii) successor EXPIRED through the canonical 0166 helper on the clock.
    const s2 = fixture.stations.rb2;
    const p2 = await recoverOnce(s2, `rrace-rb2-issue-${RUN}`, `rrace-rb2-recover-${RUN}`);
    const successorRow = (await codeRows(s2.assignmentId)).find((row) => row.id === p2.newId);
    const pastExpiry = new Date(
      new Date(String(successorRow?.expires_at)).getTime() + 1000,
    ).toISOString();
    const expired = await raceExpire(p2.newId, pastExpiry, Promise.resolve());
    expect(expired.result.outcome).toBe("EXPIRED");
    const replay2 = await raceRecover(
      s2.assignmentId,
      `rrace-rb2-issue-${RUN}`,
      `rrace-rb2-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(replay2.result.outcome).toBe("ALREADY_RECOVERED");
    expect(replay2.result.state).toBe("expired");
    expect("code" in replay2.result).toBe(false);
    expect((await codeRows(s2.assignmentId)).length).toBe(2);

    // (iii) successor LOCKED by five genuine failures through the evaluator.
    const s3 = fixture.stations.rb3;
    const p3 = await recoverOnce(s3, `rrace-rb3-issue-${RUN}`, `rrace-rb3-recover-${RUN}`);
    await primeAttempts(s3, { id: p3.newId, raw: p3.raw, expiresAt: "" }, 4);
    const wrong = p3.raw === "00000000" ? "11111111" : "00000000";
    const fifth = await racePresent(s3.assignmentId, wrong, s3.terminalId, Promise.resolve());
    expect(fifth.result.refusal_code).toBe("KLUY-PROVCODE-LOCKED");
    const replay3 = await raceRecover(
      s3.assignmentId,
      `rrace-rb3-issue-${RUN}`,
      `rrace-rb3-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(replay3.result.outcome).toBe("ALREADY_RECOVERED");
    expect(replay3.result.state).toBe("locked");
    expect("code" in replay3.result).toBe(false);
    expect((await codeRows(s3.assignmentId)).length, "no second recovery of the pair").toBe(2);
    // Redeemed-state replay stays structurally guarded but unprovable until
    // P02B3 builds redemption (recorded evidence condition, as in 0169).
  }, 90_000);

  it("replay C: conflicting and hostile keys fail closed with zero residue and no cross-scope identity", async () => {
    const station = fixture.stations.rc;
    const pair = await recoverOnce(station, `rrace-rc-issue-${RUN}`, `rrace-rc-recover-${RUN}`);
    const otherAssignment = fixture.stations.ra.assignmentId;

    // Same recovery key, different assignment.
    const wrongAssignment = await raceRecover(
      otherAssignment,
      `rrace-rc-issue-${RUN}`,
      `rrace-rc-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(wrongAssignment.result.outcome).toBe("RECOVERY_REFUSED");
    expect(wrongAssignment.result.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");

    // Same recovery key, different original key.
    const wrongOriginal = await raceRecover(
      station.assignmentId,
      `rrace-rc-OTHER-${RUN}`,
      `rrace-rc-recover-${RUN}`,
      Promise.resolve(),
    );
    expect(wrongOriginal.result.outcome).toBe("RECOVERY_REFUSED");
    expect(wrongOriginal.result.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");

    // Same recovery key, different reason (immutable-input policy).
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4) as result`,
        [
          station.assignmentId,
          `rrace-rc-issue-${RUN}`,
          `rrace-rc-recover-${RUN}`,
          "a different reason entirely",
        ],
      );
      await client.query("commit");
      expect(rows[0]?.result.outcome).toBe("RECOVERY_REFUSED");
      expect(rows[0]?.result.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");
    } finally {
      client.release();
    }

    // Historical keys stay separated through the issuance door's replay.
    const oldKeyView = await (async () => {
      const c = await keeper.connect();
      try {
        await c.query("begin");
        await c.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
        ]);
        await c.query("set local role authenticated");
        const { rows } = await c.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
          [station.assignmentId, `rrace-rc-issue-${RUN}`],
        );
        await c.query("commit");
        return rows[0]?.result ?? {};
      } finally {
        c.release();
      }
    })();
    expect(oldKeyView.outcome).toBe("ALREADY_ISSUED");
    expect(oldKeyView.provisioning_code_id, "the original key identifies ONLY the old code").toBe(
      pair.oldId,
    );
    expect(oldKeyView.state).toBe("revoked");
    expect("code" in oldKeyView, "no raw code from history").toBe(false);

    // Cross-scope and permissionless probes disclose nothing (0168 pattern).
    const wrongEnv = await raceRecover(
      station.assignmentId,
      `rrace-rc-issue-${RUN}`,
      `rrace-rc-recover-${RUN}`,
      Promise.resolve(),
      undefined,
      fixture.operatorWrongEnv,
    );
    expect(
      wrongEnv.result.refusal_code,
      "wrong environment learns nothing, not even the conflict",
    ).toBe("KLUY-PROVCODE-PERMISSION-DENIED");
    expect("provisioning_code_id" in wrongEnv.result, "no row identity disclosed").toBe(false);
    const noGrant = await raceRecover(
      station.assignmentId,
      `rrace-rc-issue-${RUN}`,
      `rrace-rc-recover-${RUN}`,
      Promise.resolve(),
      undefined,
      fixture.operatorNoGrant,
    );
    expect(noGrant.result.refusal_code).toBe("KLUY-PROVCODE-PERMISSION-DENIED");
    expect("provisioning_code_id" in noGrant.result).toBe(false);

    // Zero loser residue anywhere.
    expect((await codeRows(station.assignmentId)).length, "the pair is still the whole story").toBe(
      2,
    );
    expect((await codeRows(otherAssignment)).length, "the other assignment gained nothing").toBe(2);
    expect(await eventCount(pair.oldId, "REVOKED")).toBe(1);
    expect(await eventCount(pair.newId, "CREATED")).toBe(1);
  }, 60_000);

  // -----------------------------------------------------------------------
  // FAILURE INJECTION — atomic rollback after the in-flight revocation.
  // -----------------------------------------------------------------------

  it("failure injection: a successor-insert fault aborts the WHOLE recovery — old code stays ISSUED, zero residue, no surviving fault mechanism", async () => {
    const station = fixture.stations.fi;
    const code = await issueCode(station.assignmentId, `rrace-fi-issue-${RUN}`);
    const faultKey = `rrace-fi-recover-${RUN}`;
    const faultFn = `ws11_rrec_fault_${RUN}`;
    const faultTrigger = `zz_ws11_rrec_fault_${RUN}`;

    const client = await keeper.connect();
    try {
      await client.query("begin");
      // Transaction-local fault mechanism: the NOLOGIN table owner installs a
      // BEFORE INSERT trigger that fires ONLY for the poisoned recovery key.
      // Everything here — membership, function, trigger — lives and dies
      // inside this one doomed transaction; nothing can survive to
      // production state.
      await client.query("grant kitluy_activation_governor to postgres");
      await client.query(
        `create function public.${faultFn}() returns trigger language plpgsql as $fault$
           begin
             raise exception 'WS11-RREC-FAULT-INJECTED: successor insert refused by test fault'
               using errcode = 'KL919';
           end
         $fault$`,
      );
      await client.query(
        `grant execute on function public.${faultFn}() to kitluy_activation_governor`,
      );
      await client.query("set local role kitluy_activation_governor");
      await client.query(
        `create trigger ${faultTrigger}
           before insert on kitluy_devices.device_provisioning_codes
           for each row when (new.idempotency_key = '${faultKey}')
           execute function public.${faultFn}()`,
      );
      await client.query("reset role");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      // The door revokes the old code IN-FLIGHT, then the successor INSERT
      // hits the fault: the controlled SQLSTATE aborts the transaction.
      await expect(
        client.query(
          `select kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4)`,
          [station.assignmentId, `rrace-fi-issue-${RUN}`, faultKey, REASON],
        ),
      ).rejects.toMatchObject({ code: "KL919" });
      await client.query("rollback");
    } finally {
      client.release();
    }

    // Atomic rollback: the in-flight revocation vanished with the successor.
    const rows = await codeRows(station.assignmentId);
    expect(rows.length, "no successor row").toBe(1);
    expect(rows[0]?.state, "the old code remains ISSUED").toBe("issued");
    expect(rows[0]?.revoked_at, "no revocation timestamp").toBeNull();
    expect(rows[0]?.revocation_reason, "no recovery reason residue").toBeNull();
    expect(rows[0]?.revocation_idempotency_key, "no recovery key residue").toBeNull();
    expect(await eventCount(code.id, "REVOKED"), "no REVOKED event").toBe(0);
    const { rows: keyResidue } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_codes where idempotency_key = $1`,
      [faultKey],
    );
    expect(Number(keyResidue[0]?.n), "the poisoned recovery key committed nothing").toBe(0);

    // The fault mechanism itself rolled back: no trigger, no function, no
    // borrowed membership.
    const { rows: trg } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_trigger
        where tgrelid = 'kitluy_devices.device_provisioning_codes'::regclass and tgname = $1`,
      [faultTrigger],
    );
    expect(Number(trg[0]?.n), "the fault trigger did not survive").toBe(0);
    const { rows: fn } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_proc where proname = $1`,
      [faultFn],
    );
    expect(Number(fn[0]?.n), "the fault function did not survive").toBe(0);
    const { rows: membership } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
        join pg_roles r on r.oid = m.member
       where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
         and r.rolname = 'postgres'`,
    );
    expect(Number(membership[0]?.n), "the borrowed ownership did not survive").toBe(0);

    // The undamaged code recovers normally afterwards — the fault was the
    // only obstacle, and its rollback left a fully recoverable state.
    const clean = await raceRecover(
      station.assignmentId,
      `rrace-fi-issue-${RUN}`,
      `rrace-fi-recover-clean-${RUN}`,
      Promise.resolve(),
    );
    expect(clean.error).toBeNull();
    expect(clean.result.outcome).toBe("RECOVERED");
  }, 60_000);

  // -----------------------------------------------------------------------
  // SECURITY, PRIVACY AND RESIDUE.
  // -----------------------------------------------------------------------

  it("security: roles, direct access, replay privacy, raw-code census and membership residue", async () => {
    // anon cannot execute the door; each denied probe in its own transaction.
    const anon = await keeper.connect();
    try {
      await anon.query("begin");
      await anon.query(`select set_config('request.jwt.claims', '{}', true)`);
      await anon.query("set local role anon");
      await expect(
        anon.query(
          `select kitluy_devices.recover_terminal_provisioning_code_v1(gen_random_uuid(), 'a', 'b', 'c')`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
      await anon.query("rollback");
    } finally {
      anon.release();
    }

    const deniedAsRole = async (role: string, probe: string): Promise<void> => {
      const client = await keeper.connect();
      try {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: fixture.operator, role }),
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

    // service_role holds no door execution and no direct mutation.
    await deniedAsRole(
      "service_role",
      `select kitluy_devices.recover_terminal_provisioning_code_v1(gen_random_uuid(), 'a', 'b', 'c')`,
    );
    await deniedAsRole(
      "service_role",
      `update kitluy_devices.device_provisioning_codes set revocation_reason = 'x' where false`,
    );
    // authenticated: no internal helpers, no direct key/lineage mutation, no
    // event table writes.
    await deniedAsRole("authenticated", `select kitluy_devices.provisioning_code_issue_held_v1()`);
    await deniedAsRole("authenticated", `select kitluy_devices.provisioning_code_revoke_held_v1()`);
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_codes set idempotency_key = 'stolen' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `update kitluy_devices.device_provisioning_codes set revocation_idempotency_key = 'stolen' where false`,
    );
    await deniedAsRole(
      "authenticated",
      `delete from kitluy_devices.device_provisioning_code_events where false`,
    );
    await deniedAsRole(
      "authenticated",
      `insert into kitluy_devices.device_provisioning_code_events
         (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
          event_type, actor_type) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
          gen_random_uuid(), 'development', 'CREATED', 'OPERATOR')`,
    );

    // 0168 replay privacy stands: a wrong-environment caller replaying a real
    // original key through the ISSUANCE door learns nothing.
    const probe = await keeper.connect();
    try {
      await probe.query("begin");
      await probe.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operatorWrongEnv, role: "authenticated" }),
      ]);
      await probe.query("set local role authenticated");
      const { rows } = await probe.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [fixture.stations.rc.assignmentId, `rrace-rc-issue-${RUN}`],
      );
      await probe.query("commit");
      const result = rows[0]?.result ?? {};
      expect(result.outcome, "the issuance replay gate refuses cross-scope reads").not.toBe(
        "ALREADY_ISSUED",
      );
      expect("provisioning_code_id" in result, "no row identity for the wrong environment").toBe(
        false,
      );
    } finally {
      probe.release();
    }

    // Raw-code and digest census: nothing this suite ever received appears in
    // any event or reason field.
    expect(rawCodes.length, "the suite exercised raw-code returns").toBeGreaterThan(0);
    for (const raw of rawCodes) {
      const { rows } = await keeper.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
          where detail::text like '%' || $1 || '%' or coalesce(reason_code, '') = $1`,
        [raw],
      );
      expect(Number(rows[0]?.n), `raw code ${raw} leaked into events`).toBe(0);
    }

    // Membership and clock residue: no login-capable governor member; the
    // policy row belongs to this suite and dies in afterAll.
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n), "no login-capable governor membership").toBe(0);
  }, 60_000);
});
