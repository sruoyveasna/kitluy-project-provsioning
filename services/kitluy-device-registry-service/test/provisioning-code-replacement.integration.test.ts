/**
 * EXPIRED-CODE REPLACEMENT ISSUANCE UNDER REAL CONCURRENCY.
 *
 * WS-11-T004-P02B2B2B1 §15. Two core races, on genuinely separate backends
 * (recorded PIDs), against the governed issuance door
 * `issue_terminal_provisioning_code_v1` as extended by migration 0167. Each
 * race starts with ONE overdue ISSUED code on its OWN assignment and fires
 * two concurrent issuance calls through the door as the authorized operator.
 *
 *   A. two DIFFERENT new replacement keys
 *        → predecessor EXPIRED; exactly one replacement ISSUED; one caller
 *          succeeds, the other receives the stable OUTSTANDING result;
 *          exactly one EXPIRED event; exactly one replacement CREATED event;
 *          one direct successor link; no uncontrolled unique-constraint error
 *   B. the SAME new replacement key twice
 *        → one predecessor expiration; one replacement row; the raw code is
 *          returned by the creating call only; the replay is ALREADY_ISSUED;
 *          one EXPIRED event; one CREATED event
 *
 * Due time is driven by the sanctioned test clock: one committed policy row
 * (removed in afterAll) and a transaction-local `kitluy.test_clock_instant`
 * override inside each racer's own transaction — never a schema change,
 * never caller time reaching the door as an argument.
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
if (!live) console.warn("SKIPPED: replacement concurrency — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
  expiresAt: string;
}

interface Fixture {
  assignmentA: string;
  assignmentB: string;
  operator: string;
}

describe.skipIf(!live)("expired-code replacement, two core races on separate backends", () => {
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
          { signal_type: "mac_address", signal_value: `dd:cc:${randomUUID().slice(0, 8)}` },
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

  /** The initial (soon-to-be predecessor) code, issued on the live clock. */
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

  /** One replacement racer per backend: the door, as the operator, past due. */
  async function raceReplace(
    code: IssuedCode,
    assignmentId: string,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown>; error: string | null }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>(
        "select pg_backend_pid() as pid",
      );
      await client.query("begin");
      // Shift only THIS transaction's authoritative clock past the TTL.
      const due = new Date(new Date(code.expiresAt).getTime() + 1000);
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
        due.toISOString(),
      ]);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, idempotencyKey],
      );
      await client.query("commit");
      return { pid: pidRows[0]?.pid ?? 0, result: rows[0]?.result ?? {}, error: null };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return { pid: 0, result: {}, error: error instanceof Error ? error.message : String(error) };
    } finally {
      client.release();
    }
  }

  async function codeRows(assignmentId: string): Promise<
    Array<{
      id: string;
      state: string;
      idempotency_key: string | null;
      replaces_provisioning_code_id: string | null;
      failed_attempt_count: number;
    }>
  > {
    const { rows } = await keeper.query<{
      id: string;
      state: string;
      idempotency_key: string | null;
      replaces_provisioning_code_id: string | null;
      failed_attempt_count: number;
    }>(
      `select id, state::text, idempotency_key, replaces_provisioning_code_id, failed_attempt_count
         from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid order by created_at`,
      [assignmentId],
    );
    return rows;
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

    // The sanctioned test-clock policy row is committed for the run and
    // removed in afterAll (the 0166 race pattern).
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'replacement-race-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );

    const hub = await enroll("WS11-RRACE-HUB", "b1".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RACE')`,
      [hub, `SERIAL-RRACE-HUB-${RUN}-${randomUUID()}`, "b1".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const terminalA = await enroll("WS11-RRACE-TERMA", "b2".repeat(32));
    await claimAndRedeem(terminalA);
    const { rows: aa } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminalA, LOCATION],
    );
    const terminalB = await enroll("WS11-RRACE-TERMB", "b3".repeat(32));
    await claimAndRedeem(terminalB);
    const { rows: ab } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t2.display', $2::uuid, 'OP-RACE') as id`,
      [terminalB, LOCATION],
    );

    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `replacement-race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `replacement race fixture ${RUN}`],
    );

    fixture = {
      assignmentA: aa[0]?.id ?? "",
      assignmentB: ab[0]?.id ?? "",
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
    await keeper?.end().catch(() => undefined);
  });

  it("A: two different replacement keys — one ISSUED, one OUTSTANDING, one successor", async () => {
    const code = await issueCode(fixture.assignmentA, `rrace-a-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = raceReplace(code, fixture.assignmentA, `rrace-a-replace-1-${RUN}`, barrier);
    const second = raceReplace(code, fixture.assignmentA, `rrace-a-replace-2-${RUN}`, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    console.log(`race A backends: racer1 pid=${r1.pid}, racer2 pid=${r2.pid}`);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    expect(r1.error, "no uncontrolled error from racer 1").toBeNull();
    expect(r2.error, "no uncontrolled error from racer 2").toBeNull();

    const outcomes = [String(r1.result.outcome), String(r2.result.outcome)].sort();
    expect(outcomes, "exactly one winner, exactly one stable OUTSTANDING").toEqual([
      "ISSUED",
      "OUTSTANDING",
    ]);
    const winner = r1.result.outcome === "ISSUED" ? r1.result : r2.result;
    const loser = r1.result.outcome === "ISSUED" ? r2.result : r1.result;
    expect(winner.code, "the winner receives the raw replacement code once").toMatch(
      /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/,
    );
    expect(winner.replaces_provisioning_code_id, "the winner names the predecessor").toBe(code.id);
    expect(loser.code, "the loser never receives a code").toBeUndefined();

    const rows = await codeRows(fixture.assignmentA);
    expect(rows.length, "predecessor + exactly one replacement").toBe(2);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state, "the predecessor is immutable EXPIRED history").toBe("expired");
    expect(predecessor?.replaces_provisioning_code_id, "the predecessor never points forward").toBeNull();
    expect(successor?.state, "the successor is the one outstanding code").toBe("issued");
    expect(successor?.replaces_provisioning_code_id, "one direct successor link").toBe(code.id);
    expect(successor?.failed_attempt_count, "the successor starts at zero attempts").toBe(0);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "CREATED"), "exactly one predecessor CREATED event").toBe(1);
    expect(
      await eventCount(String(successor?.id), "CREATED"),
      "exactly one replacement CREATED event",
    ).toBe(1);
  }, 60_000);

  it("B: the same replacement key twice — one creation, one canonical replay", async () => {
    const code = await issueCode(fixture.assignmentB, `rrace-b-issue-${RUN}`);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const key = `rrace-b-replace-${RUN}`;
    const first = raceReplace(code, fixture.assignmentB, key, barrier);
    const second = raceReplace(code, fixture.assignmentB, key, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    console.log(`race B backends: racer1 pid=${r1.pid}, racer2 pid=${r2.pid}`);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    expect(r1.error, "no uncontrolled error from racer 1").toBeNull();
    expect(r2.error, "no uncontrolled error from racer 2").toBeNull();

    const outcomes = [String(r1.result.outcome), String(r2.result.outcome)].sort();
    expect(outcomes, "one creator, one canonical replay").toEqual(["ALREADY_ISSUED", "ISSUED"]);
    const creator = r1.result.outcome === "ISSUED" ? r1.result : r2.result;
    const replay = r1.result.outcome === "ISSUED" ? r2.result : r1.result;
    expect(creator.code, "the creating call returns the raw code").toMatch(
      /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/,
    );
    expect(replay.code, "the replay never returns or reconstructs the raw code").toBeUndefined();
    expect(
      replay.provisioning_code_id,
      "the replay returns the replacement row identity",
    ).toBe(creator.provisioning_code_id);

    const rows = await codeRows(fixture.assignmentB);
    expect(rows.length, "one predecessor expiration, one replacement row").toBe(2);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state).toBe("expired");
    expect(successor?.state).toBe("issued");
    expect(successor?.idempotency_key, "the replacement carries the new key").toBe(key);
    expect(successor?.replaces_provisioning_code_id).toBe(code.id);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(String(successor?.id), "CREATED"), "exactly one CREATED event").toBe(1);
  }, 60_000);
});
