/**
 * CANONICAL TERMINAL-CODE EXPIRATION UNDER REAL CONCURRENCY.
 *
 * WS-11-T004-P02B2B2A §12. Four races, on genuinely separate backends
 * (recorded PIDs), against the canonical helper
 * `expire_terminal_provisioning_code_v1` (migration 0166) and the functions
 * that share its authoritative code boundary: the 0165 revocation door and
 * the 0164 presentation evaluator (which now delegates expiry to the helper).
 * The helper and evaluator are harness-only, so the pool borrows
 * `kitluy_test_harness` membership for the run and revokes it afterwards.
 *
 * Due time is driven by the sanctioned test clock: one committed policy row
 * (removed in afterAll), and a transaction-local `kitluy.test_clock_instant`
 * override inside each racer's own transaction — never a schema change,
 * never caller time reaching the functions as an argument.
 *
 *   A. two concurrent expiration calls on one due issued code
 *        → one EXPIRED, one canonical ALREADY_EXPIRED, one EXPIRED event
 *   B. expiration versus revocation on one due issued code
 *        → exactly one terminal state (EXPIRED xor REVOKED), one winning
 *          terminal event, consistent timestamps, no state reversal
 *   C. expiration versus CORRECT presentation on a due code
 *        → final state EXPIRED either way, no durable MATCH_READY, no
 *          attempt increment, exactly one EXPIRED event
 *   D. primed to 4, expiration versus a wrong presentation on a due code
 *        → final state EXPIRED (the evaluator's expiry-first ordering can
 *          never count a fifth attempt on a due code), count stays 4, one
 *          EXPIRED event, no LOCKED residue
 *
 * Every race gets its OWN terminal/assignment/code.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const REASON = "expiration race fixture: operator revocation";

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
if (!live) console.warn("SKIPPED: expiration concurrency — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
  expiresAt: string;
}

interface Fixture {
  assignmentA: string;
  assignmentB: string;
  assignmentC: string;
  assignmentD: string;
  terminalA: string;
  terminalB: string;
  terminalC: string;
  terminalD: string;
  operator: string;
}

function wrongCode(raw: string, salt: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const flipped = alphabet[(alphabet.indexOf(raw[0] ?? "0") + 1 + salt) % alphabet.length];
  return flipped + raw.slice(1);
}

describe.skipIf(!live)("canonical expiration, four races on separate backends", () => {
  let keeper: pg.Pool;
  let fixture: Fixture;

  async function enroll(label: string, fingerprint: string): Promise<string> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const profile = rows[0]?.id;
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-RACE', 'OP-RACE', $4::jsonb) as id`,
      [
        `${label}-${RUN}-${randomUUID()}`,
        profile,
        fingerprint,
        JSON.stringify([
          { signal_type: "mac_address", signal_value: `ff:ee:${randomUUID().slice(0, 8)}` },
          { signal_type: "board_serial", signal_value: `board-${randomUUID()}` },
          { signal_type: "storage_serial", signal_value: `nvme-${randomUUID()}` },
        ]),
      ],
    );
    return enrolled[0]?.id ?? "";
  }

  async function claimAndRedeem(deviceId: string): Promise<string> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-RACE')`,
      [deviceId, TENANT, STORE, LOCATION, token, payload],
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-RACE') as id`,
      [token, payload, deviceId],
    );
    return rows[0]?.id ?? "";
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

  /** Shift only THIS transaction's authoritative clock past the code's TTL. */
  async function makeDue(
    client: pg.PoolClient,
    code: IssuedCode,
    offsetSeconds = 1,
  ): Promise<void> {
    const due = new Date(new Date(code.expiresAt).getTime() + offsetSeconds * 1000);
    await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
      due.toISOString(),
    ]);
  }

  /** One expirer per backend: the canonical helper, harness-borrowed. */
  async function raceExpire(
    code: IssuedCode,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await makeDue(client, code);
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.expire_terminal_provisioning_code_v1(
           $1::uuid, gen_random_uuid(), 'TEST_HARNESS') as result`,
        [code.id],
      );
      await client.query("commit");
      return { pid: pidRows[0]?.pid ?? 0, result: rows[0]?.result ?? {} };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One revoker per backend: the 0165 door, as the authorized operator. */
  async function raceRevoke(
    code: IssuedCode,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      await makeDue(client, code);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
        [code.id, idempotencyKey, REASON],
      );
      await client.query("commit");
      return { pid: pidRows[0]?.pid ?? 0, result: rows[0]?.result ?? {} };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One presenter per backend: the 0164 evaluator (delegating expiry). */
  async function racePresent(
    code: IssuedCode,
    assignmentId: string,
    presented: string,
    terminalRef: string,
    due: boolean,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      if (due) await makeDue(client, code);
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
           $1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3) as result`,
        [assignmentId, presented, terminalRef],
      );
      await client.query("commit");
      return { pid: pidRows[0]?.pid ?? 0, result: rows[0]?.result ?? {} };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function codeState(codeId: string): Promise<{
    state: string;
    failed_attempt_count: number;
    revoked_at: string | null;
    locked_at: string | null;
  }> {
    const { rows } = await keeper.query<{
      state: string;
      failed_attempt_count: number;
      revoked_at: string | null;
      locked_at: string | null;
    }>(
      `select state, failed_attempt_count, revoked_at, locked_at
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return rows[0] ?? { state: "", failed_attempt_count: -1, revoked_at: null, locked_at: null };
  }

  async function eventCount(codeId: string, eventType: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = $2`,
      [codeId, eventType],
    );
    return Number(rows[0]?.n ?? -1);
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 8 });

    // Harness borrow for the internal helper and evaluator (0164/0166
    // pattern), returned in afterAll. The sanctioned test-clock policy row is
    // committed for the run and removed in afterAll.
    await keeper.query("grant kitluy_test_harness to postgres");
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'expiration-race-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );

    const hub = await enroll("WS11-XRACE-HUB", "f6".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RACE')`,
      [hub, `SERIAL-XRACE-HUB-${RUN}-${randomUUID()}`, "f6".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const terminalA = await enroll("WS11-XRACE-TERMA", "f7".repeat(32));
    await claimAndRedeem(terminalA);
    const { rows: aa } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminalA, LOCATION],
    );
    const terminalB = await enroll("WS11-XRACE-TERMB", "f8".repeat(32));
    await claimAndRedeem(terminalB);
    const { rows: ab } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t2.display', $2::uuid, 'OP-RACE') as id`,
      [terminalB, LOCATION],
    );
    const terminalC = await enroll("WS11-XRACE-TERMC", "f9".repeat(32));
    await claimAndRedeem(terminalC);
    const { rows: ac } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t3.ready_scan', $2::uuid, 'OP-RACE') as id`,
      [terminalC, LOCATION],
    );
    const terminalD = await enroll("WS11-XRACE-TERMD", "fa".repeat(32));
    await claimAndRedeem(terminalD);
    const { rows: ad } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t4.pickup_scan', $2::uuid, 'OP-RACE') as id`,
      [terminalD, LOCATION],
    );

    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `expiration-race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `expiration race fixture ${RUN}`, REVOKE_PERMISSION],
    );

    fixture = {
      assignmentA: aa[0]?.id ?? "",
      assignmentB: ab[0]?.id ?? "",
      assignmentC: ac[0]?.id ?? "",
      assignmentD: ad[0]?.id ?? "",
      terminalA,
      terminalB,
      terminalC,
      terminalD,
      operator,
    };
  }, 180_000);

  afterAll(async () => {
    if (fixture !== undefined && fixture.operator !== "") {
      await keeper
        .query(`delete from kitluy_auth.temporary_grants where subject_id = $1::uuid`, [
          fixture.operator,
        ])
        .catch(() => undefined);
    }
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("A: two concurrent expirations — one EXPIRED, one canonical ALREADY_EXPIRED, one event", async () => {
    const code = await issueCode(fixture.assignmentA, `xrace-a-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = raceExpire(code, barrier);
    const second = raceExpire(code, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_EXPIRED", "EXPIRED"]);
    const state = await codeState(code.id);
    expect(state.state).toBe("expired");
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "CREATED"), "exactly one CREATED event").toBe(1);
  }, 60_000);

  it("B: expiration versus revocation — exactly one terminal state wins", async () => {
    const code = await issueCode(fixture.assignmentB, `xrace-b-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const expirer = raceExpire(code, barrier);
    const revoker = raceRevoke(code, `xrace-b-${RUN}`, barrier);
    release();
    const [exp, rev] = await Promise.all([expirer, revoker]);
    expect(exp.pid, "the racers must be different backends").not.toBe(rev.pid);

    const state = await codeState(code.id);
    expect(["expired", "revoked"], "exactly one terminal state").toContain(state.state);
    if (state.state === "expired") {
      expect(rev.result.refusal_code, "revocation answers the terminal classification").toBe(
        "KLUY-PROVCODE-ALREADY-EXPIRED",
      );
      expect(state.revoked_at, "an expired row never carries revoked_at").toBeNull();
      expect(await eventCount(code.id, "EXPIRED")).toBe(1);
      expect(await eventCount(code.id, "REVOKED")).toBe(0);
    } else {
      expect(exp.result.outcome, "expiration answers the terminal classification").toBe(
        "ALREADY_REVOKED",
      );
      expect(state.revoked_at, "revoked carries its timestamp").not.toBeNull();
      expect(await eventCount(code.id, "REVOKED")).toBe(1);
      expect(await eventCount(code.id, "EXPIRED")).toBe(0);
    }
    const terminalEvents =
      (await eventCount(code.id, "EXPIRED")) + (await eventCount(code.id, "REVOKED"));
    expect(terminalEvents, "exactly one winning terminal event").toBe(1);
  }, 60_000);

  it("C: expiration versus correct presentation — final EXPIRED, no durable MATCH_READY", async () => {
    const code = await issueCode(fixture.assignmentC, `xrace-c-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const expirer = raceExpire(code, barrier);
    const matcher = racePresent(
      code,
      fixture.assignmentC,
      code.raw,
      fixture.terminalC,
      true,
      barrier,
    );
    release();
    const [exp, pres] = await Promise.all([expirer, matcher]);
    expect(exp.pid, "the racers must be different backends").not.toBe(pres.pid);

    // A due code can never MATCH: whichever commits first, the evaluator's
    // delegated expiry runs before any digest comparison.
    expect(pres.result.outcome, "a due code never authorizes").toBe("PRESENTATION_REFUSED");
    expect(["KLUY-PROVCODE-EXPIRED", "KLUY-PROVCODE-ALREADY-EXPIRED"]).toContain(
      String(pres.result.refusal_code),
    );
    expect(["EXPIRED", "ALREADY_EXPIRED"]).toContain(String(exp.result.outcome));
    const state = await codeState(code.id);
    expect(state.state, "the final state is EXPIRED").toBe("expired");
    expect(state.failed_attempt_count, "expiry never counts an attempt").toBe(0);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "PRESENTED"), "no MATCH residue").toBe(0);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "no attempt residue").toBe(0);
  }, 60_000);

  it("D: primed to 4, expiration versus wrong presentation — EXPIRED, count stays 4", async () => {
    const code = await issueCode(fixture.assignmentD, `xrace-d-issue-${RUN}`);
    // Prime four genuine failures on the LIVE clock (code not yet due).
    for (let i = 0; i < 4; i += 1) {
      const primed = await racePresent(
        code,
        fixture.assignmentD,
        wrongCode(code.raw, i),
        fixture.terminalD,
        false,
        Promise.resolve(),
      );
      expect(primed.result.outcome).toBe("FAILED_PRESENTATION");
    }
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const expirer = raceExpire(code, barrier);
    const fifthFailure = racePresent(
      code,
      fixture.assignmentD,
      wrongCode(code.raw, 9),
      fixture.terminalD,
      true,
      barrier,
    );
    release();
    const [exp, pres] = await Promise.all([expirer, fifthFailure]);
    expect(exp.pid, "the racers must be different backends").not.toBe(pres.pid);

    // The evaluator's canonical ordering checks expiry BEFORE counting: a
    // due code can never take a fifth attempt, whichever lock wins first.
    const state = await codeState(code.id);
    expect(state.state, "the due-time check always wins under evaluator ordering").toBe("expired");
    expect(state.failed_attempt_count, "no fifth attempt on a due code").toBe(4);
    expect(state.locked_at, "an expired row never carries locked_at").toBeNull();
    expect(
      ["KLUY-PROVCODE-EXPIRED", "KLUY-PROVCODE-ALREADY-EXPIRED"],
      "the presentation classifies as expiry, never a counted failure",
    ).toContain(String(pres.result.refusal_code));
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "exactly the four primed failures").toBe(4);
    expect(await eventCount(code.id, "LOCKED"), "no lockout residue").toBe(0);
  }, 60_000);
});
