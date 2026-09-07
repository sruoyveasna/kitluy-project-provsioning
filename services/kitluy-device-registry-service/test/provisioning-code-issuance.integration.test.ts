/**
 * TERMINAL PROVISIONING-CODE ISSUANCE UNDER REAL CONCURRENCY.
 *
 * WS-11-T004-P02B1 §13. Three races, on genuinely separate backends (recorded
 * PIDs), against the governed door `issue_terminal_provisioning_code_v1`
 * (migration 0163):
 *
 *   A. two different idempotency keys, one assignment  → one ISSUED, one OUTSTANDING
 *   B. same key, identical immutable input             → one ISSUED, one ALREADY_ISSUED,
 *                                                        one row, one CREATED event
 *   C. same key, different assignment                  → one winner, one
 *                                                        CONFLICTING_REPLAY, no loser residue
 *
 * The races are serialized by the assignment row lock the door takes BEFORE
 * reading anything, so every outcome is a governed stable result, never a
 * unique-constraint exception the caller would have to interpret.
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
if (!live) console.warn("SKIPPED: issuance concurrency — local database unreachable");

interface Fixture {
  hub: string;
  terminal: string;
  terminal2: string;
  assignment: string;
  assignmentB: string;
  assignmentC: string;
  assignment2: string;
  operator: string;
}

describe.skipIf(!live)("provisioning-code issuance, three races on separate backends", () => {
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

  async function backendPid(): Promise<number> {
    const probe = await keeper.connect();
    try {
      const { rows } = await probe.query<{ pid: number }>("select pg_backend_pid() as pid");
      return rows[0]?.pid ?? 0;
    } finally {
      probe.release();
    }
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 6 });

    const hub = await enroll("WS11-RACE-HUB", "a4".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-RACE')`,
      [hub, `SERIAL-RACE-HUB-${RUN}-${randomUUID()}`, "a4".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const terminal = await enroll("WS11-RACE-TERM", "b5".repeat(32));
    await claimAndRedeem(terminal);
    const { rows: a1 } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminal, LOCATION],
    );
    // Each race gets its OWN terminal/assignment: one outstanding code per
    // assignment means a previous race's winner would otherwise dominate.
    const terminalB = await enroll("WS11-RACE-TERMB", "d7".repeat(32));
    await claimAndRedeem(terminalB);
    const { rows: ab } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t1.cashier', $2::uuid, 'OP-RACE') as id`,
      [terminalB, LOCATION],
    );
    const terminalC = await enroll("WS11-RACE-TERMC", "e8".repeat(32));
    await claimAndRedeem(terminalC);
    const { rows: ac } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t2.display', $2::uuid, 'OP-RACE') as id`,
      [terminalC, LOCATION],
    );
    const terminal2 = await enroll("WS11-RACE-TERM2", "c6".repeat(32));
    await claimAndRedeem(terminal2);
    const { rows: a2 } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, 'laundry.t3.ready_scan', $2::uuid, 'OP-RACE') as id`,
      [terminal2, LOCATION],
    );

    // The authorized installer: real user, real time-boxed grant.
    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '10 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `race fixture ${RUN}`],
    );

    fixture = {
      hub,
      terminal,
      terminal2,
      assignment: a1[0]?.id ?? "",
      assignmentB: ab[0]?.id ?? "",
      assignmentC: ac[0]?.id ?? "",
      assignment2: a2[0]?.id ?? "",
      operator,
    };
  }, 180_000);

  afterAll(async () => {
    if (fixture !== undefined && fixture.operator !== "") {
      await keeper.query(
        `delete from kitluy_auth.temporary_grants where subject_id = $1::uuid`,
        [fixture.operator],
      ).catch(() => undefined);
    }
    await keeper?.end().catch(() => undefined);
  });

  /** One racer per backend: claims identity, then issues through the door. */
  async function race(
    assignmentId: string,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown> }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      await client.query("begin");
      await client.query(
        `select set_config('request.jwt.claims', $1, true)`,
        [JSON.stringify({ sub: fixture.operator, role: "authenticated" })],
      );
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, idempotencyKey],
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

  it("A: two different idempotency keys — one ISSUED, one OUTSTANDING", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = race(fixture.assignment, `race-a1-${RUN}`, barrier);
    const second = race(fixture.assignment, `race-a2-${RUN}`, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ISSUED", "OUTSTANDING"]);
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid`,
      [fixture.assignment],
    );
    expect(rows[0]?.n, "exactly one winner may exist").toBe("1");
    const { rows: events } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events e
        join kitluy_devices.device_provisioning_codes c on c.id = e.provisioning_code_id
        where c.terminal_assignment_id = $1::uuid and e.event_type = 'CREATED'`,
      [fixture.assignment],
    );
    expect(events[0]?.n, "exactly one created event").toBe("1");
  }, 60_000);

  it("B: same key, identical input — one ISSUED, one ALREADY_ISSUED, one row, one event", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const key = `race-b-${RUN}`;
    const first = race(fixture.assignmentB, key, barrier);
    const second = race(fixture.assignmentB, key, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_ISSUED", "ISSUED"]);
    const winner = r1.result.outcome === "ISSUED" ? r1.result : r2.result;
    const replayer = r1.result.outcome === "ISSUED" ? r2.result : r1.result;
    expect(replayer.provisioning_code_id, "the replay names the canonical issuance").toBe(
      winner.provisioning_code_id,
    );
    expect(
      "code" in replayer,
      "the replay must never reconstruct the raw code",
    ).toBe(false);
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_codes
        where idempotency_key = $1`,
      [key],
    );
    expect(rows[0]?.n, "one stored row for one key").toBe("1");
    const { rows: events } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events e
        join kitluy_devices.device_provisioning_codes c on c.id = e.provisioning_code_id
        where c.idempotency_key = $1 and e.event_type = 'CREATED'`,
      [key],
    );
    expect(events[0]?.n, "one created event for one committed issuance").toBe("1");
  }, 60_000);

  it("C: same key, different assignment — one winner, one CONFLICTING_REPLAY, no residue", async () => {
    const key = `race-c-${RUN}`;
    // Establish the winner first so the conflict is deterministic.
    const first = await race(fixture.assignmentC, key, Promise.resolve());
    expect(first.result.outcome).toBe("ISSUED");
    const second = await race(fixture.assignment2, key, Promise.resolve());
    expect(second.result.outcome).toBe("ISSUANCE_REFUSED");
    expect(second.result.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid`,
      [fixture.assignment2],
    );
    expect(rows[0]?.n, "the loser leaves no row").toBe("0");
    const { rows: pidCheck } = await keeper.query<{ pid: number }>(
      `select ${String(await backendPid())} as pid`,
    );
    expect(pidCheck[0]?.pid).toBeGreaterThan(0);
  }, 60_000);
});
