/**
 * TERMINAL PROVISIONING-CODE REVOCATION UNDER REAL CONCURRENCY.
 *
 * WS-11-T004-P02B2B1 §13. Four races, on genuinely separate backends
 * (recorded PIDs), against the governed door
 * `revoke_terminal_provisioning_code_v1` (migration 0165) and, for C and D,
 * the 0164 presentation evaluator on the SAME authoritative code boundary.
 *
 *   A. two concurrent revocations, same code/key/reason
 *        → one REVOKED, one canonical ALREADY_REVOKED replay, one transition,
 *          exactly one REVOKED event
 *   B. two concurrent revocations, same code, DIFFERENT keys, same reason
 *        → one REVOKED, one stable ALREADY_REVOKED terminal answer, one
 *          REVOKED event, no uncontrolled constraint exception
 *   C. primed to 4 failed attempts: one revocation races one wrong-code
 *      presentation
 *        → exactly one terminal state (REVOKED xor LOCKED), attempts at most
 *          five, consistent terminal timestamps, no duplicate terminal event
 *   D. one revocation races one CORRECT-code presentation
 *        → final state REVOKED either way; MATCH_READY, when returned first,
 *          remains a transient recheck result; no redemption; one REVOKED
 *          event; no state reversal
 *
 * Every race gets its OWN terminal/assignment: one outstanding code per
 * assignment means a previous race's state would otherwise contaminate.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const REASON = "race fixture: installer reported the terminal compromised";

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
if (!live) console.warn("SKIPPED: revocation concurrency — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
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

/** A code that is well-formed Crockford but deterministically NOT `raw`. */
function wrongCode(raw: string, salt: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const flipped = alphabet[(alphabet.indexOf(raw[0] ?? "0") + 1 + salt) % alphabet.length];
  return flipped + raw.slice(1);
}

describe.skipIf(!live)("provisioning-code revocation, four races on separate backends", () => {
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

  /** Issue one code through the 0163 door, as the authorized operator. */
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
      return { id: String(result.provisioning_code_id), raw: String(result.code) };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One revoker per backend: claims identity, then revokes through the door. */
  async function raceRevoke(
    codeId: string,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
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
        [codeId, idempotencyKey, REASON],
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

  /** One presenter per backend: presents through the 0164 evaluator. */
  async function racePresent(
    assignmentId: string,
    presented: string,
    terminalRef: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
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
    revocation_reason: string | null;
  }> {
    const { rows } = await keeper.query<{
      state: string;
      failed_attempt_count: number;
      revoked_at: string | null;
      locked_at: string | null;
      revocation_reason: string | null;
    }>(
      `select state, failed_attempt_count, revoked_at, locked_at, revocation_reason
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return (
      rows[0] ?? {
        state: "",
        failed_attempt_count: -1,
        revoked_at: null,
        locked_at: null,
        revocation_reason: null,
      }
    );
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

    // The 0164 evaluator is harness-only; the pool borrows the membership for
    // the run and returns it in afterAll (the presentation suite's pattern).
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enroll("WS11-RRACE-HUB", "f1".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RACE')`,
      [hub, `SERIAL-RRACE-HUB-${RUN}-${randomUUID()}`, "f1".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const terminalA = await enroll("WS11-RRACE-TERMA", "f2".repeat(32));
    await claimAndRedeem(terminalA);
    const { rows: aa } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminalA, LOCATION],
    );
    const terminalB = await enroll("WS11-RRACE-TERMB", "f3".repeat(32));
    await claimAndRedeem(terminalB);
    const { rows: ab } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t2.display', $2::uuid, 'OP-RACE') as id`,
      [terminalB, LOCATION],
    );
    const terminalC = await enroll("WS11-RRACE-TERMC", "f4".repeat(32));
    await claimAndRedeem(terminalC);
    const { rows: ac } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t3.ready_scan', $2::uuid, 'OP-RACE') as id`,
      [terminalC, LOCATION],
    );
    const terminalD = await enroll("WS11-RRACE-TERMD", "f5".repeat(32));
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
      [operator, `revocation-race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `revocation race fixture ${RUN}`, REVOKE_PERMISSION],
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
    await keeper.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("A: same code, same key, same reason — one REVOKED, one canonical replay, one event", async () => {
    const code = await issueCode(fixture.assignmentA, `rrace-a-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const key = `rrace-a-${RUN}`;
    const first = raceRevoke(code.id, key, barrier);
    const second = raceRevoke(code.id, key, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_REVOKED", "REVOKED"]);
    const winner = r1.result.outcome === "REVOKED" ? r1.result : r2.result;
    const replayer = r1.result.outcome === "REVOKED" ? r2.result : r1.result;
    expect(replayer.provisioning_code_id, "the replay names the canonical revocation").toBe(
      winner.provisioning_code_id,
    );
    expect(replayer.revoked_at, "the replay returns the original timestamp").toBe(
      winner.revoked_at,
    );
    const state = await codeState(code.id);
    expect(state.state).toBe("revoked");
    expect(state.revocation_reason).toBe(REASON);
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(code.id, "CREATED"), "exactly one CREATED event").toBe(1);
  }, 60_000);

  it("B: same code, different keys — one REVOKED, one stable ALREADY_REVOKED, one event", async () => {
    const code = await issueCode(fixture.assignmentB, `rrace-b-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = raceRevoke(code.id, `rrace-b1-${RUN}`, barrier);
    const second = raceRevoke(code.id, `rrace-b2-${RUN}`, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes, "one winner, one stable terminal answer — never a constraint crash").toEqual([
      "ALREADY_REVOKED",
      "REVOKED",
    ]);
    const state = await codeState(code.id);
    expect(state.state).toBe("revoked");
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
  }, 60_000);

  it("C: revoke versus fifth failure — exactly one terminal state wins", async () => {
    const code = await issueCode(fixture.assignmentC, `rrace-c-issue-${RUN}`);
    // Prime the count to four genuine failures.
    for (let i = 0; i < 4; i += 1) {
      const primed = await racePresent(
        fixture.assignmentC,
        wrongCode(code.raw, i),
        fixture.terminalC,
        Promise.resolve(),
      );
      expect(primed.result.outcome).toBe("FAILED_PRESENTATION");
    }
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revoker = raceRevoke(code.id, `rrace-c-${RUN}`, barrier);
    const fifthFailure = racePresent(
      fixture.assignmentC,
      wrongCode(code.raw, 9),
      fixture.terminalC,
      barrier,
    );
    release();
    const [rev, pres] = await Promise.all([revoker, fifthFailure]);
    expect(rev.pid, "the racers must be different backends").not.toBe(pres.pid);

    const state = await codeState(code.id);
    expect(["revoked", "locked"], "exactly one terminal state").toContain(state.state);
    expect(state.failed_attempt_count, "attempts never exceed five").toBeLessThanOrEqual(5);
    if (state.state === "revoked") {
      // Revocation committed first: the presentation classified terminally
      // with NO fifth attempt and NO lockout residue.
      expect(pres.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-REVOKED");
      expect(state.failed_attempt_count).toBe(4);
      expect(state.revoked_at, "revoked carries its timestamp").not.toBeNull();
      expect(state.locked_at, "a revoked row never carries locked_at").toBeNull();
      expect(await eventCount(code.id, "REVOKED")).toBe(1);
      expect(await eventCount(code.id, "FAILED_ATTEMPT")).toBe(4);
      expect(await eventCount(code.id, "LOCKED")).toBe(0);
    } else {
      // The fifth failure committed first: revocation answers the stable
      // terminal classification with no mutation.
      expect(rev.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-LOCKED");
      expect(state.failed_attempt_count).toBe(5);
      expect(state.locked_at, "locked carries its timestamp").not.toBeNull();
      expect(state.revoked_at, "a locked row never carries revoked_at").toBeNull();
      expect(await eventCount(code.id, "LOCKED")).toBe(1);
      expect(await eventCount(code.id, "FAILED_ATTEMPT")).toBe(5);
      expect(await eventCount(code.id, "REVOKED")).toBe(0);
    }
  }, 60_000);

  it("D: revoke versus correct presentation — final state REVOKED, no redemption", async () => {
    const code = await issueCode(fixture.assignmentD, `rrace-d-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const revoker = raceRevoke(code.id, `rrace-d-${RUN}`, barrier);
    const matcher = racePresent(fixture.assignmentD, code.raw, fixture.terminalD, barrier);
    release();
    const [rev, pres] = await Promise.all([revoker, matcher]);
    expect(rev.pid, "the racers must be different backends").not.toBe(pres.pid);

    // One operation commits first. If revocation committed first, the
    // presentation classifies ALREADY-REVOKED; if the presentation committed
    // first, MATCH_READY is a transient recheck result — never a redemption,
    // and revocation still commits afterwards.
    expect(rev.result.outcome, "revocation always commits").toBe("REVOKED");
    expect(
      ["MATCH_READY", "PRESENTATION_REFUSED"],
      "the presentation is either the transient recheck or the terminal classification",
    ).toContain(String(pres.result.outcome));
    if (pres.result.outcome === "PRESENTATION_REFUSED") {
      expect(pres.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-REVOKED");
    }
    const state = await codeState(code.id);
    expect(state.state, "the final state is REVOKED — never reversed, never redeemed").toBe(
      "revoked",
    );
    expect(
      state.failed_attempt_count,
      "a correct presentation and a revocation count nothing",
    ).toBe(0);
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(code.id, "REDEEMED"), "MATCH_READY is never a redemption").toBe(0);
    const presented = await eventCount(code.id, "PRESENTED");
    expect(presented, "PRESENTED residue matches the winning serialization").toBe(
      pres.result.outcome === "MATCH_READY" ? 1 : 0,
    );
  }, 60_000);
});
