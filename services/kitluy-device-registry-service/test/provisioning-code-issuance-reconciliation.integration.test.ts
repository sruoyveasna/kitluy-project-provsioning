/**
 * AMBIGUOUS ISSUANCE-OUTCOME RECONCILIATION.
 *
 * WS-11-T004-P02B2B2B1 §11–§13. A network timeout or lost response must never
 * cause automatic duplicate issuance: the caller retries the SAME assignment
 * and idempotency key, and the governed door
 * `issue_terminal_provisioning_code_v1` (0163/0167, replay-hardened by 0168)
 * must identify the canonical committed row with SAFE reconciliation fields
 * only — never a raw code, never a digest, never a second row or event.
 *
 *   A. initial issuance response lost      → replay identifies the committed
 *                                            row; one row, one CREATED event
 *   B. replacement response lost           → replay identifies the successor;
 *                                            lineage unchanged; one EXPIRED,
 *                                            two CREATED events total
 *   C. initial request still in flight     → two backends, one ISSUED (raw
 *                                            code) + one ALREADY_ISSUED (none)
 *   D. replacement request still in flight → two backends on an overdue
 *                                            predecessor; raw code only for
 *                                            the creator
 *   E. response lost, then state changes   → revoke / expire / lock through
 *                                            the canonical governed paths;
 *                                            the replay reports the terminal
 *                                            state without duplicating work
 *
 * Plus: expired-predecessor vs revoked-history key semantics, conflicting-
 * assignment replay, and hostile probes (unauthenticated, permissionless,
 * anon, direct table access, raw-code/digest census).
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
const REASON = "ambiguity fixture: installer reported the terminal compromised";

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
if (!live) console.warn("SKIPPED: issuance reconciliation — local database unreachable");

interface Fixture {
  operator: string;
  operatorNoGrant: string;
  assignmentA: string;
  assignmentB: string;
  assignmentC: string;
  assignmentD: string;
  assignmentE1: string;
  assignmentE2: string;
  assignmentE3: string;
  assignmentX: string;
}

/** Every raw code the fixture ever received — census evidence only. */
const rawCodes: string[] = [];

describe.skipIf(!live)("ambiguous issuance-outcome reconciliation", () => {
  let keeper: pg.Pool;
  let fixture: Fixture;

  async function enroll(label: string, fingerprint: string): Promise<string> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const profile = rows[0]?.id;
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-AMB', 'OP-AMB', $4::jsonb) as id`,
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
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-AMB')`,
      [deviceId, TENANT, STORE, LOCATION, token, payload],
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-AMB') as id`,
      [token, payload, deviceId],
    );
    return rows[0]?.id ?? "";
  }

  async function newAssignment(label: string, fingerprint: string, profile: string): Promise<string> {
    const terminal = await enroll(label, fingerprint);
    await claimAndRedeem(terminal);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, $2, $3::uuid, 'OP-AMB') as id`,
      [terminal, profile, LOCATION],
    );
    return rows[0]?.id ?? "";
  }

  /** The governed door, as the authorized operator; optionally past due. */
  async function issue(
    assignmentId: string,
    key: string,
    dueAfter?: string,
  ): Promise<Record<string, unknown>> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      if (dueAfter !== undefined) {
        const due = new Date(new Date(dueAfter).getTime() + 1000);
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
          due.toISOString(),
        ]);
      }
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
      if (typeof result.code === "string") rawCodes.push(result.code);
      return result;
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** One racer per backend: claims identity, then issues through the door. */
  async function race(
    assignmentId: string,
    key: string,
    ready: Promise<void>,
    dueAfter?: string,
  ): Promise<{ pid: number; result: Record<string, unknown>; error: string | null }> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      await client.query("begin");
      if (dueAfter !== undefined) {
        const due = new Date(new Date(dueAfter).getTime() + 1000);
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
          due.toISOString(),
        ]);
      }
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignmentId, key],
      );
      await client.query("commit");
      const result = rows[0]?.result ?? {};
      if (typeof result.code === "string") rawCodes.push(result.code);
      return { pid: pidRows[0]?.pid ?? 0, result, error: null };
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
    }>
  > {
    const { rows } = await keeper.query(
      `select id, state::text, idempotency_key, replaces_provisioning_code_id
         from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid order by created_at`,
      [assignmentId],
    );
    return rows as Array<{
      id: string;
      state: string;
      idempotency_key: string | null;
      replaces_provisioning_code_id: string | null;
    }>;
  }

  async function eventCount(codeId: string, eventType: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = $2`,
      [codeId, eventType],
    );
    return Number(rows[0]?.n ?? -1);
  }

  /** The reconciliation-contract assertions every ALREADY_ISSUED must satisfy. */
  function expectSafeReplay(
    replay: Record<string, unknown>,
    expected: {
      codeId: string;
      assignmentId: string;
      state: string;
      replaces: string | null;
      recoveryRequired: boolean;
    },
  ): void {
    expect(replay.outcome, "the replay reconciles the committed request").toBe("ALREADY_ISSUED");
    expect(replay.provisioning_code_id, "the replay names the canonical row").toBe(expected.codeId);
    expect(replay.terminal_assignment_id, "the replay names the assignment").toBe(
      expected.assignmentId,
    );
    expect(replay.state, "the replay reports the authoritative state").toBe(expected.state);
    expect(replay.replaces_provisioning_code_id ?? null, "the replay reports lineage").toBe(
      expected.replaces,
    );
    expect(replay.raw_code_available, "the raw code is flagged unavailable on replay").toBe(false);
    expect(replay.recovery_required, "the recovery flag matches the state").toBe(
      expected.recoveryRequired,
    );
    expect(typeof replay.created_at, "created_at is present").toBe("string");
    expect(typeof replay.expires_at, "expires_at is present").toBe("string");
    expect(typeof replay.terminal_profile_key, "the profile is present").toBe("string");
    expect(typeof replay.store_hub_device_id, "the Hub is present").toBe("string");
    expect(typeof replay.correlation_id, "the correlation id is present").toBe("string");
    expect("code" in replay, "the replay must never reconstruct the raw code").toBe(false);
    expect("code_digest" in replay, "the replay must never disclose the digest").toBe(false);
    expect("payload_sha256" in replay, "the replay must never disclose the payload binding").toBe(
      false,
    );
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 8 });

    // The sanctioned test-clock policy row is committed for the run and
    // removed in afterAll (the 0166/0167 race pattern). The harness borrow
    // (evaluator + canonical expiration helper) is revoked in afterAll.
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'ambiguity-reconciliation-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enroll("WS11-AMB-HUB", "f1".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-AMB')`,
      [hub, `SERIAL-AMB-HUB-${RUN}-${randomUUID()}`, "f1".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const assignmentA = await newAssignment("WS11-AMB-TERMA", "f2".repeat(32), "laundry.t1.cashier");
    const assignmentB = await newAssignment("WS11-AMB-TERMB", "f3".repeat(32), "laundry.t2.display");
    const assignmentC = await newAssignment("WS11-AMB-TERMC", "f4".repeat(32), "laundry.t3.ready_scan");
    const assignmentD = await newAssignment("WS11-AMB-TERMD", "f5".repeat(32), "laundry.t4.pickup_scan");
    const assignmentE1 = await newAssignment("WS11-AMB-TERME1", "f6".repeat(32), "laundry.t1.cashier");
    const assignmentE2 = await newAssignment("WS11-AMB-TERME2", "f7".repeat(32), "laundry.t2.display");
    const assignmentE3 = await newAssignment("WS11-AMB-TERME3", "f8".repeat(32), "laundry.t3.ready_scan");
    const assignmentX = await newAssignment("WS11-AMB-TERMX", "f9".repeat(32), "laundry.t4.pickup_scan");

    // The authorized installer: real user, real time-boxed grants.
    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `amb-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '15 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `ambiguity fixture ${RUN}`, REVOKE_PERMISSION],
    );

    // A second real authenticated identity with NO grant anywhere.
    const operatorNoGrant = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operatorNoGrant, `amb-nogrant-${RUN}@fixture.invalid`],
    );

    fixture = {
      operator,
      operatorNoGrant,
      assignmentA,
      assignmentB,
      assignmentC,
      assignmentD,
      assignmentE1,
      assignmentE2,
      assignmentE3,
      assignmentX,
    };
  }, 240_000);

  afterAll(async () => {
    if (fixture !== undefined) {
      await keeper
        .query(`delete from kitluy_auth.temporary_grants where subject_id = $1::uuid`, [
          fixture.operator,
        ])
        .catch(() => undefined);
    }
    // RUN-scoped sweep: no fixture grant or policy row survives even a
    // partially constructed beforeAll.
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [
        `ambiguity fixture ${RUN}`,
      ])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("A: initial issuance response lost — replay reconciles the committed row", async () => {
    const key = `amb-a-${RUN}`;
    const first = await issue(fixture.assignmentA, key);
    expect(first.outcome).toBe("ISSUED");
    expect(typeof first.code).toBe("string");
    // The response is deliberately discarded: only the id and expiry survive.
    const codeId = String(first.provisioning_code_id);
    const expiresAt = String(first.expires_at);

    const replay = await issue(fixture.assignmentA, key);
    expectSafeReplay(replay, {
      codeId,
      assignmentId: fixture.assignmentA,
      state: "issued",
      replaces: null,
      recoveryRequired: true,
    });
    expect(String(replay.expires_at), "the replay must not extend expiry").toBe(expiresAt);

    const rows = await codeRows(fixture.assignmentA);
    expect(rows.length, "exactly one row — no duplicate issuance").toBe(1);
    expect(await eventCount(codeId, "CREATED"), "exactly one CREATED event").toBe(1);
  }, 60_000);

  it("B: replacement response lost — replay identifies the successor, lineage intact", async () => {
    const keyPredecessor = `amb-b1-${RUN}`;
    const predecessor = await issue(fixture.assignmentB, keyPredecessor);
    expect(predecessor.outcome).toBe("ISSUED");
    const predecessorId = String(predecessor.provisioning_code_id);

    // The predecessor expires canonically inside the replacement call.
    const keySuccessor = `amb-b2-${RUN}`;
    const successor = await issue(
      fixture.assignmentB,
      keySuccessor,
      String(predecessor.expires_at),
    );
    expect(successor.outcome).toBe("ISSUED");
    expect(successor.replaces_provisioning_code_id).toBe(predecessorId);
    const successorId = String(successor.provisioning_code_id);
    // The replacement response is deliberately discarded.

    const replaySuccessor = await issue(fixture.assignmentB, keySuccessor);
    expectSafeReplay(replaySuccessor, {
      codeId: successorId,
      assignmentId: fixture.assignmentB,
      state: "issued",
      replaces: predecessorId,
      recoveryRequired: true,
    });

    const rows = await codeRows(fixture.assignmentB);
    expect(rows.length, "predecessor + exactly one successor").toBe(2);
    expect(rows[0]?.state).toBe("expired");
    expect(rows[1]?.state).toBe("issued");
    expect(rows[1]?.replaces_provisioning_code_id, "lineage unchanged by the replay").toBe(
      predecessorId,
    );
    expect(await eventCount(predecessorId, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(predecessorId, "CREATED")).toBe(1);
    expect(await eventCount(successorId, "CREATED"), "exactly one successor CREATED").toBe(1);
  }, 60_000);

  it("C: initial request still in flight — one creator, one canonical replay", async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const key = `amb-c-${RUN}`;
    const first = race(fixture.assignmentC, key, barrier);
    const second = race(fixture.assignmentC, key, barrier);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r2.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);

    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_ISSUED", "ISSUED"]);
    const winner = r1.result.outcome === "ISSUED" ? r1.result : r2.result;
    const replayer = r1.result.outcome === "ISSUED" ? r2.result : r1.result;
    expect(typeof winner.code, "the raw code is returned by the creating transaction only").toBe(
      "string",
    );
    expectSafeReplay(replayer, {
      codeId: String(winner.provisioning_code_id),
      assignmentId: fixture.assignmentC,
      state: "issued",
      replaces: null,
      recoveryRequired: true,
    });

    const rows = await codeRows(fixture.assignmentC);
    expect(rows.length, "one row for the in-flight duplicate").toBe(1);
    expect(await eventCount(String(winner.provisioning_code_id), "CREATED")).toBe(1);
  }, 60_000);

  it("D: replacement request still in flight — raw code only for the creator", async () => {
    const keyPredecessor = `amb-d1-${RUN}`;
    const predecessor = await issue(fixture.assignmentD, keyPredecessor);
    expect(predecessor.outcome).toBe("ISSUED");
    const predecessorId = String(predecessor.provisioning_code_id);
    const expiresAt = String(predecessor.expires_at);

    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const keySuccessor = `amb-d2-${RUN}`;
    const first = race(fixture.assignmentD, keySuccessor, barrier, expiresAt);
    const second = race(fixture.assignmentD, keySuccessor, barrier, expiresAt);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r2.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);

    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_ISSUED", "ISSUED"]);
    const winner = r1.result.outcome === "ISSUED" ? r1.result : r2.result;
    const replayer = r1.result.outcome === "ISSUED" ? r2.result : r1.result;
    expect(typeof winner.code, "the raw replacement code is returned by the creator only").toBe(
      "string",
    );
    expect(winner.replaces_provisioning_code_id).toBe(predecessorId);
    expectSafeReplay(replayer, {
      codeId: String(winner.provisioning_code_id),
      assignmentId: fixture.assignmentD,
      state: "issued",
      replaces: predecessorId,
      recoveryRequired: true,
    });

    const rows = await codeRows(fixture.assignmentD);
    expect(rows.length, "predecessor + exactly one successor").toBe(2);
    expect(rows[0]?.state).toBe("expired");
    expect(rows[1]?.replaces_provisioning_code_id).toBe(predecessorId);
    expect(await eventCount(predecessorId, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(String(winner.provisioning_code_id), "CREATED")).toBe(1);
  }, 60_000);

  it("E1: response lost, then REVOKED — replay reports the terminal state; fresh reissue keeps NULL lineage", async () => {
    const key = `amb-e1-${RUN}`;
    const first = await issue(fixture.assignmentE1, key);
    expect(first.outcome).toBe("ISSUED");
    const codeId = String(first.provisioning_code_id);
    // The response is deliberately discarded; the code is then revoked
    // through the canonical governed door.
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3) as result`,
        [codeId, `amb-e1-rev-${RUN}`, REASON],
      );
      await client.query("commit");
      expect(rows[0]?.result.outcome).toBe("REVOKED");
    } finally {
      client.release();
    }

    const replay = await issue(fixture.assignmentE1, key);
    expectSafeReplay(replay, {
      codeId,
      assignmentId: fixture.assignmentE1,
      state: "revoked",
      replaces: null,
      recoveryRequired: false,
    });
    expect(await eventCount(codeId, "CREATED"), "no duplicated CREATED event").toBe(1);
    expect(await eventCount(codeId, "REVOKED"), "no duplicated REVOKED event").toBe(1);

    // Fresh issuance after revocation follows the normal path: NULL lineage,
    // and the revoked row is never relabeled an expired predecessor.
    const freshKey = `amb-e1-fresh-${RUN}`;
    const fresh = await issue(fixture.assignmentE1, freshKey);
    expect(fresh.outcome).toBe("ISSUED");
    expect(fresh.replaces_provisioning_code_id ?? null, "no fabricated predecessor link").toBeNull();

    const replayOld = await issue(fixture.assignmentE1, key);
    expectSafeReplay(replayOld, {
      codeId,
      assignmentId: fixture.assignmentE1,
      state: "revoked",
      replaces: null,
      recoveryRequired: false,
    });
    const replayFresh = await issue(fixture.assignmentE1, freshKey);
    expectSafeReplay(replayFresh, {
      codeId: String(fresh.provisioning_code_id),
      assignmentId: fixture.assignmentE1,
      state: "issued",
      replaces: null,
      recoveryRequired: true,
    });

    const rows = await codeRows(fixture.assignmentE1);
    expect(rows.length).toBe(2);
    expect(rows[0]?.state, "the revoked row is never relabeled EXPIRED").toBe("revoked");
    expect(rows[1]?.replaces_provisioning_code_id).toBeNull();
  }, 60_000);

  it("E2: response lost, then canonically EXPIRED — replay reports the terminal state", async () => {
    const key = `amb-e2-${RUN}`;
    const first = await issue(fixture.assignmentE2, key);
    expect(first.outcome).toBe("ISSUED");
    const codeId = String(first.provisioning_code_id);
    // The response is deliberately discarded; the code is then expired through
    // the canonical 0166 helper (harness-only) on the shifted test clock.
    const client = await keeper.connect();
    try {
      await client.query("begin");
      const due = new Date(new Date(String(first.expires_at)).getTime() + 1000);
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
        due.toISOString(),
      ]);
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.expire_terminal_provisioning_code_v1(
           $1::uuid, gen_random_uuid(), 'AMBIGUITY_TEST', 'OPERATOR', 'OP-AMB') as result`,
        [codeId],
      );
      await client.query("commit");
      expect(rows[0]?.result.outcome).toBe("EXPIRED");
    } finally {
      client.release();
    }

    const replay = await issue(fixture.assignmentE2, key);
    expectSafeReplay(replay, {
      codeId,
      assignmentId: fixture.assignmentE2,
      state: "expired",
      replaces: null,
      recoveryRequired: false,
    });
    expect(await eventCount(codeId, "CREATED")).toBe(1);
    expect(await eventCount(codeId, "EXPIRED"), "no duplicated EXPIRED event").toBe(1);
    const rows = await codeRows(fixture.assignmentE2);
    expect(rows.length, "the replay created no replacement").toBe(1);
  }, 60_000);

  it("E3: response lost, then LOCKED — replay reports the terminal state", async () => {
    const key = `amb-e3-${RUN}`;
    const first = await issue(fixture.assignmentE3, key);
    expect(first.outcome).toBe("ISSUED");
    const codeId = String(first.provisioning_code_id);
    // The response is deliberately discarded; the code is then locked through
    // the canonical 0164 evaluator (harness-only) by five wrong presentations.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { rows } = await keeper.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
           $1::uuid, $2, gen_random_uuid(), 'TERMINAL', 'AMB-E3') as result`,
        [fixture.assignmentE3, `WRONG${attempt}${RUN}`.slice(0, 8).toUpperCase()],
      );
      void rows;
    }
    const replay = await issue(fixture.assignmentE3, key);
    expectSafeReplay(replay, {
      codeId,
      assignmentId: fixture.assignmentE3,
      state: "locked",
      replaces: null,
      recoveryRequired: false,
    });
    expect(await eventCount(codeId, "CREATED")).toBe(1);
    expect(await eventCount(codeId, "LOCKED"), "exactly one LOCKED event").toBe(1);
    const rows = await codeRows(fixture.assignmentE3);
    expect(rows.length, "the replay created no new code").toBe(1);
    expect(rows[0]?.state).toBe("locked");
  }, 60_000);

  it("lineage keys: the predecessor key never returns the successor and vice versa", async () => {
    // Fixture B already holds A EXPIRED → B ISSUED. Replaying either key must
    // identify exactly its own row and append no event.
    const keyPredecessor = `amb-b1-${RUN}`;
    const keySuccessor = `amb-b2-${RUN}`;
    const before = await codeRows(fixture.assignmentB);
    const predecessorId = before[0]?.id ?? "";
    const successorId = before[1]?.id ?? "";
    const expiredBefore = await eventCount(predecessorId, "EXPIRED");
    const createdBefore = await eventCount(successorId, "CREATED");

    const replayPredecessor = await issue(fixture.assignmentB, keyPredecessor);
    expectSafeReplay(replayPredecessor, {
      codeId: predecessorId,
      assignmentId: fixture.assignmentB,
      state: "expired",
      replaces: null,
      recoveryRequired: false,
    });
    expect(replayPredecessor.provisioning_code_id, "the old key never returns the successor").not.toBe(
      successorId,
    );

    const replaySuccessor = await issue(fixture.assignmentB, keySuccessor);
    expect(replaySuccessor.provisioning_code_id, "the new key never returns the predecessor").not.toBe(
      predecessorId,
    );

    expect(await eventCount(predecessorId, "EXPIRED"), "replays append no event").toBe(expiredBefore);
    expect(await eventCount(successorId, "CREATED"), "replays append no event").toBe(createdBefore);
    expect((await codeRows(fixture.assignmentB)).length).toBe(2);
  }, 60_000);

  it("conflicting assignment: the same key with another assignment refuses with no residue", async () => {
    const key = `amb-a-${RUN}`;
    const refused = await issue(fixture.assignmentX, key);
    expect(refused.outcome).toBe("ISSUANCE_REFUSED");
    expect(refused.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");
    expect("provisioning_code_id" in refused, "the conflict reveals no row identity").toBe(false);
    expect((await codeRows(fixture.assignmentX)).length, "the conflict created no row").toBe(0);
  }, 60_000);

  it("hostile: unauthenticated, permissionless and anon callers cannot reconcile", async () => {
    const key = `amb-a-${RUN}`;
    // Unauthenticated: no actor context at all.
    const anonymous = await keeper.connect();
    try {
      await anonymous.query("begin");
      await anonymous.query(`select set_config('request.jwt.claims', '{}', true)`);
      await anonymous.query("set local role authenticated");
      const { rows } = await anonymous.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [fixture.assignmentA, key],
      );
      await anonymous.query("commit");
      expect(rows[0]?.result.outcome).toBe("ISSUANCE_REFUSED");
      expect(rows[0]?.result.refusal_code).toBe("KLUY-PROVCODE-UNAUTHENTICATED");
    } finally {
      anonymous.release();
    }

    // Authenticated but holding the issuance permission NOWHERE: the replay
    // must answer the safe refusal and disclose no row detail (0168 gate).
    const nogrant = await keeper.connect();
    try {
      await nogrant.query("begin");
      await nogrant.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operatorNoGrant, role: "authenticated" }),
      ]);
      await nogrant.query("set local role authenticated");
      const { rows } = await nogrant.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [fixture.assignmentA, key],
      );
      await nogrant.query("commit");
      const result = rows[0]?.result ?? {};
      expect(result.outcome).toBe("ISSUANCE_REFUSED");
      expect(result.refusal_code).toBe("KLUY-PROVCODE-PERMISSION-DENIED");
      expect("provisioning_code_id" in result, "cross-scope existence is not leaked").toBe(false);
      expect("state" in result, "cross-scope state is not leaked").toBe(false);
    } finally {
      nogrant.release();
    }

    // The anon role holds no EXECUTE on the door at all.
    const anon = await keeper.connect();
    try {
      await anon.query("begin");
      await anon.query("set local role anon");
      await expect(
        anon.query(
          `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null)`,
          [fixture.assignmentA, key],
        ),
      ).rejects.toThrow(/permission denied/i);
      await anon.query("rollback").catch(() => undefined);
    } finally {
      anon.release();
    }
  }, 60_000);

  it("hostile: direct table access stays denied and no raw code or digest reaches any event", async () => {
    // Direct reads as a runtime role see nothing (FORCE RLS, no runtime policy).
    const reader = await keeper.connect();
    try {
      await reader.query("begin");
      await reader.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await reader.query("set local role authenticated");
      await expect(
        reader.query(`select count(*) from kitluy_devices.device_provisioning_codes`),
        "runtime roles hold no direct read on the code table",
      ).rejects.toThrow(/permission denied/i);
      await reader.query("rollback");
      await reader.query("begin");
      await reader.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await reader.query("set local role authenticated");
      await expect(
        reader.query(`select count(*) from kitluy_devices.device_provisioning_code_events`),
        "runtime roles hold no direct read on the event table",
      ).rejects.toThrow(/permission denied/i);
      await reader.query("rollback").catch(() => undefined);
    } finally {
      reader.release();
    }

    // Census: no fixture raw code and no fixture digest appears in any event.
    expect(rawCodes.length, "the fixture produced raw codes to census").toBeGreaterThan(0);
    const { rows: digests } = await keeper.query<{ code_digest: string }>(
      `select c.code_digest from kitluy_devices.device_provisioning_codes c
        where c.idempotency_key like 'amb-%-${RUN}'`,
    );
    const { rows: events } = await keeper.query<{ blob: string }>(
      `select e.*::text as blob from kitluy_devices.device_provisioning_code_events e
        join kitluy_devices.device_provisioning_codes c on c.id = e.provisioning_code_id
        where c.idempotency_key like 'amb-%-${RUN}'`,
    );
    expect(events.length, "the fixture produced events to census").toBeGreaterThan(0);
    for (const raw of rawCodes) {
      for (const event of events) {
        expect(event.blob.includes(raw), "no raw code in any event").toBe(false);
      }
    }
    for (const { code_digest: digest } of digests) {
      for (const event of events) {
        expect(event.blob.includes(digest), "no digest in any event").toBe(false);
      }
    }
  }, 60_000);
});
