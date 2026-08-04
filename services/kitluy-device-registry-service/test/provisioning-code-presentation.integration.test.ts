/**
 * TERMINAL PROVISIONING-CODE PRESENTATION UNDER REAL CONCURRENCY.
 *
 * WS-11-T004-P02B2A §13. Three races, on genuinely separate backends (recorded
 * PIDs), against the internal evaluator
 * `evaluate_terminal_provisioning_code_v1` (migration 0164). The evaluator is
 * harness-only, so the pool borrows `kitluy_test_harness` membership for the
 * run and revokes it afterwards.
 *
 *   A. five concurrent wrong presentations on one issued code
 *        → count exactly 5, terminally locked, 5 FAILED_ATTEMPT events,
 *          exactly 1 LOCKED event
 *   B. primed to 4, then two concurrent wrong presentations
 *        → one locks 4→5, the other gets the ALREADY-LOCKED terminal answer,
 *          exactly one new FAILED_ATTEMPT and one LOCKED event
 *   C. primed to 4, then the CORRECT code races a wrong one
 *        → the assignment row lock serializes them, so either the match lands
 *          first (MATCH_READY + one PRESENTED event, then the wrong one locks)
 *          or the wrong one locks first (the match then gets ALREADY-LOCKED);
 *          both orderings end count 5, state locked, events consistent
 *
 * Every race gets its OWN terminal/assignment: one outstanding code per
 * assignment means a previous race's state would otherwise contaminate.
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
if (!live) console.warn("SKIPPED: presentation concurrency — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
}

interface Fixture {
  assignmentA: string;
  assignmentB: string;
  assignmentC: string;
  terminalA: string;
  terminalB: string;
  terminalC: string;
  operator: string;
  codeA: IssuedCode;
  codeB: IssuedCode;
  codeC: IssuedCode;
}

/** A code that is well-formed Crockford but deterministically NOT `raw`. */
function wrongCode(raw: string, salt: number): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const flipped = alphabet[(alphabet.indexOf(raw[0] ?? "0") + 1 + salt) % alphabet.length];
  return flipped + raw.slice(1);
}

describe.skipIf(!live)("provisioning-code presentation, three races on separate backends", () => {
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

  /** One racer per backend: presents a code through the internal evaluator. */
  async function race(
    assignmentId: string,
    presented: string,
    terminalRef: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
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

  /** Sequential presentation (no barrier) for priming a count. */
  async function present(
    assignmentId: string,
    presented: string,
    terminalRef: string,
  ): Promise<Record<string, unknown>> {
    return (await race(assignmentId, presented, terminalRef, Promise.resolve())).result;
  }

  async function codeState(codeId: string): Promise<{
    state: string;
    failed_attempt_count: number;
    locked_reason: string | null;
  }> {
    const { rows } = await keeper.query<{
      state: string;
      failed_attempt_count: number;
      locked_reason: string | null;
    }>(
      `select state, failed_attempt_count, locked_reason
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return rows[0] ?? { state: "", failed_attempt_count: -1, locked_reason: null };
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

    const hub = await enroll("WS11-PRACE-HUB", "a3".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RACE')`,
      [hub, `SERIAL-PRACE-HUB-${RUN}-${randomUUID()}`, "a3".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const terminalA = await enroll("WS11-PRACE-TERMA", "b4".repeat(32));
    await claimAndRedeem(terminalA);
    const { rows: aa } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminalA, LOCATION],
    );
    const terminalB = await enroll("WS11-PRACE-TERMB", "c5".repeat(32));
    await claimAndRedeem(terminalB);
    const { rows: ab } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t2.display', $2::uuid, 'OP-RACE') as id`,
      [terminalB, LOCATION],
    );
    const terminalC = await enroll("WS11-PRACE-TERMC", "d6".repeat(32));
    await claimAndRedeem(terminalC);
    const { rows: ac } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t3.ready_scan', $2::uuid, 'OP-RACE') as id`,
      [terminalC, LOCATION],
    );

    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `presentation-race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '10 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `presentation race fixture ${RUN}`],
    );

    // The evaluator is harness-only: borrow membership for the whole run.
    await keeper.query("grant kitluy_test_harness to postgres");

    fixture = {
      assignmentA: aa[0]?.id ?? "",
      assignmentB: ab[0]?.id ?? "",
      assignmentC: ac[0]?.id ?? "",
      terminalA,
      terminalB,
      terminalC,
      operator,
      codeA: { id: "", raw: "" },
      codeB: { id: "", raw: "" },
      codeC: { id: "", raw: "" },
    };

    fixture.codeA = await issueCode(fixture.assignmentA, `prace-a-${RUN}`);
    fixture.codeB = await issueCode(fixture.assignmentB, `prace-b-${RUN}`);
    fixture.codeC = await issueCode(fixture.assignmentC, `prace-c-${RUN}`);
  }, 180_000);

  afterAll(async () => {
    if (fixture !== undefined && fixture.operator !== "") {
      await keeper
        .query(`delete from kitluy_auth.temporary_grants where subject_id = $1::uuid`, [fixture.operator])
        .catch(() => undefined);
    }
    await keeper.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("A: five concurrent wrong presentations — count 5, locked, 5 FAILED_ATTEMPT + 1 LOCKED", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const racers = [0, 1, 2, 3, 4].map((salt) =>
      race(fixture.assignmentA, wrongCode(fixture.codeA.raw, salt), fixture.terminalA, barrier),
    );
    release();
    const results = await Promise.all(racers);
    const pids = new Set(results.map((r) => r.pid));
    expect(pids.size, "the five racers must be different backends").toBe(5);

    const outcomes = results.map((r) => String(r.result.outcome)).sort();
    expect(outcomes).toEqual([
      "FAILED_PRESENTATION",
      "FAILED_PRESENTATION",
      "FAILED_PRESENTATION",
      "FAILED_PRESENTATION",
      "PRESENTATION_REFUSED",
    ]);
    const lockRefusal = results.find((r) => r.result.outcome === "PRESENTATION_REFUSED");
    expect(lockRefusal?.result.refusal_code).toBe("KLUY-PROVCODE-LOCKED");
    expect(Number(lockRefusal?.result.failed_attempt_count)).toBe(5);

    const state = await codeState(fixture.codeA.id);
    expect(state.state).toBe("locked");
    expect(state.failed_attempt_count).toBe(5);
    expect(state.locked_reason).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(await eventCount(fixture.codeA.id, "FAILED_ATTEMPT")).toBe(5);
    expect(await eventCount(fixture.codeA.id, "LOCKED")).toBe(1);
    expect(await eventCount(fixture.codeA.id, "PRESENTED")).toBe(0);
  }, 60_000);

  it("B: primed to 4, two concurrent wrong presentations — one locks, one ALREADY-LOCKED", async () => {
    for (let salt = 0; salt < 4; salt += 1) {
      const primed = await present(
        fixture.assignmentB,
        wrongCode(fixture.codeB.raw, salt),
        fixture.terminalB,
      );
      expect(primed.outcome).toBe("FAILED_PRESENTATION");
      expect(Number(primed.failed_attempt_count)).toBe(salt + 1);
    }

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = race(fixture.assignmentB, wrongCode(fixture.codeB.raw, 40), fixture.terminalB, barrier);
    const second = race(fixture.assignmentB, wrongCode(fixture.codeB.raw, 41), fixture.terminalB, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);

    const refusals = [r1.result.refusal_code, r2.result.refusal_code].sort();
    expect(refusals).toEqual(["KLUY-PROVCODE-ALREADY-LOCKED", "KLUY-PROVCODE-LOCKED"]);

    const state = await codeState(fixture.codeB.id);
    expect(state.state).toBe("locked");
    expect(state.failed_attempt_count, "the ALREADY-LOCKED answer must not count").toBe(5);
    expect(state.locked_reason).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(await eventCount(fixture.codeB.id, "FAILED_ATTEMPT")).toBe(5);
    expect(await eventCount(fixture.codeB.id, "LOCKED")).toBe(1);
  }, 60_000);

  it("C: primed to 4, the correct code races a wrong one — serialized, consistent either way", async () => {
    for (let salt = 0; salt < 4; salt += 1) {
      const primed = await present(
        fixture.assignmentC,
        wrongCode(fixture.codeC.raw, salt),
        fixture.terminalC,
      );
      expect(primed.outcome).toBe("FAILED_PRESENTATION");
      expect(Number(primed.failed_attempt_count)).toBe(salt + 1);
    }

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const correct = race(fixture.assignmentC, fixture.codeC.raw, fixture.terminalC, barrier);
    const wrong = race(fixture.assignmentC, wrongCode(fixture.codeC.raw, 42), fixture.terminalC, barrier);
    release();
    const [rCorrect, rWrong] = await Promise.all([correct, wrong]);
    expect(rCorrect.pid, "the racers must be different backends").not.toBe(rWrong.pid);

    // The wrong presentation always runs while the code is still issued
    // (either first, or after a MATCH that changes nothing), so it always
    // takes the count 4→5 and locks.
    expect(rWrong.result.outcome).toBe("PRESENTATION_REFUSED");
    expect(rWrong.result.refusal_code).toBe("KLUY-PROVCODE-LOCKED");

    // The correct presentation either matched first, or found the terminal
    // state the wrong presentation left.
    if (rCorrect.result.outcome === "MATCH_READY") {
      expect(await eventCount(fixture.codeC.id, "PRESENTED")).toBe(1);
    } else {
      expect(rCorrect.result.outcome).toBe("PRESENTATION_REFUSED");
      expect(rCorrect.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-LOCKED");
      expect(await eventCount(fixture.codeC.id, "PRESENTED")).toBe(0);
    }

    const state = await codeState(fixture.codeC.id);
    expect(state.state).toBe("locked");
    expect(state.failed_attempt_count).toBe(5);
    expect(state.locked_reason).toBe("MAX_ATTEMPTS_EXCEEDED");
    expect(await eventCount(fixture.codeC.id, "FAILED_ATTEMPT")).toBe(5);
    expect(await eventCount(fixture.codeC.id, "LOCKED")).toBe(1);
  }, 60_000);
});
