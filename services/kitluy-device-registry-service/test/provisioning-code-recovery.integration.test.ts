/**
 * ATOMIC CONTROLLED LOST-CODE RECOVERY.
 *
 * WS-11-T004-P02B2B2B2A §16–§19. An authorized human who reconciled (0168) a
 * committed issuance as committed-but-lost recovers it through the governed
 * door `recover_terminal_provisioning_code_v1` (migration 0169): the old code
 * is revoked and exactly one fresh code is issued, atomically, under a new
 * recovery idempotency key. The raw recovery code is returned ONCE, from the
 * creating transaction only.
 *
 *   Success  — authorized scoped human recovers; old REVOKED + new ISSUED
 *              commit together; one REVOKED + one CREATED event share one
 *              correlation; raw code returned once and persisted nowhere
 *   Replay   — identical recovery replay answers ALREADY_RECOVERED with no
 *              raw code and no new work; conflicting replay fails closed
 *   Lineage  — replacement lineage stays NULL (recovery is NOT expired-code
 *              replacement); the old key still identifies the old REVOKED
 *              code; the recovery key identifies the new ISSUED code
 *   Refusals — unauthenticated / missing issue / missing revoke / wrong
 *              environment / not found / wrong assignment / expired /
 *              revoked / locked / redeemed / inactive assignment / inactive
 *              Hub / blank / overlong reason / malformed keys — each with
 *              ZERO residue (old code unchanged, no events, no new row)
 *   Race A   — two identical recovery calls on separate backends: one creator
 *              receives the raw code, one replay receives none; one REVOKED
 *              event, one CREATED event
 *   Race B   — two different recovery keys: one winner, one stable
 *              RECOVERY_ALREADY_COMPLETED; exactly one successor
 *   Security — anon/PUBLIC denied; bridges governor-only; direct table
 *              mutation denied; raw-code and digest census across events
 */
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
const ISSUE_PERMISSION = "fleet.device_provisioning_code.issue";
const REVOKE_PERMISSION = "fleet.device_provisioning_code.revoke";
const REASON = "recovery fixture: installer lost the printed provisioning code";
const CROCKFORD = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

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
if (!live) console.warn("SKIPPED: atomic recovery — local database unreachable");

interface Fixture {
  operator: string;
  operatorIssueOnly: string;
  operatorRevokeOnly: string;
  operatorWrongEnv: string;
  operatorNoGrant: string;
  hub: string;
  assignmentA: string;
  assignmentB: string;
  assignmentC: string;
  assignmentD: string;
  assignmentE: string;
  assignmentF: string;
  assignmentG: string;
  assignmentH: string;
  assignmentI: string;
  assignmentJ: string;
  assignmentK: string;
  terminalK: string;
}

/** Every raw code the fixture ever received — census evidence only. */
const rawCodes: string[] = [];

describe.skipIf(!live)("atomic controlled lost-code recovery (0169)", () => {
  let keeper: pg.Pool;
  let fixture: Fixture;

  async function enroll(label: string, fingerprint: string): Promise<string> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const profile = rows[0]?.id;
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-REC', 'OP-REC', $4::jsonb) as id`,
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
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-REC')`,
      [deviceId, TENANT, STORE, LOCATION, token, payload],
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-REC') as id`,
      [token, payload, deviceId],
    );
    return rows[0]?.id ?? "";
  }

  async function newAssignment(
    label: string,
    fingerprint: string,
    profile: string,
  ): Promise<string> {
    const terminal = await enroll(label, fingerprint);
    await claimAndRedeem(terminal);
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, $2, $3::uuid, 'OP-REC') as id`,
      [terminal, profile, LOCATION],
    );
    return rows[0]?.id ?? "";
  }

  /** Call a door as a specific actor; actor=null means no JWT claims at all. */
  async function callDoor(
    sql: string,
    params: unknown[],
    actor: string | null,
    env?: string,
  ): Promise<Record<string, unknown>> {
    const client = await keeper.connect();
    try {
      await client.query("begin");
      if (env !== undefined) {
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [env]);
      }
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        actor === null ? "{}" : JSON.stringify({ sub: actor, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select ${sql} as result`,
        params,
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

  async function issue(
    assignmentId: string,
    key: string,
    dueAfter?: string,
  ): Promise<Record<string, unknown>> {
    const due =
      dueAfter === undefined
        ? undefined
        : new Date(new Date(dueAfter).getTime() + 1000).toISOString();
    return callDoor(
      `kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null)`,
      [assignmentId, key],
      fixture.operator,
      due,
    );
  }

  async function recover(
    assignmentId: string,
    originalKey: string,
    recoveryKey: string,
    reason: string | null,
    actor: string | null = fixture.operator,
    clock?: string,
  ): Promise<Record<string, unknown>> {
    return callDoor(
      `kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4)`,
      [assignmentId, originalKey, recoveryKey, reason],
      actor,
      clock,
    );
  }

  /** One racer per backend: claims identity, then recovers through the door. */
  async function raceRecover(
    assignmentId: string,
    originalKey: string,
    recoveryKey: string,
    ready: Promise<void>,
  ): Promise<{ pid: number; result: Record<string, unknown>; error: string | null }> {
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
        `select kitluy_devices.recover_terminal_provisioning_code_v1($1::uuid, $2, $3, $4) as result`,
        [assignmentId, originalKey, recoveryKey, REASON],
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

  async function codeRow(codeId: string): Promise<Record<string, unknown>> {
    const { rows } = await keeper.query(
      `select id, state::text, code_digest, payload_sha256, failed_attempt_count,
              created_at, expires_at, redeemed_at, revoked_at, locked_at,
              revocation_reason, idempotency_key, revocation_idempotency_key,
              replaces_provisioning_code_id, correlation_id
         from kitluy_devices.device_provisioning_codes where id = $1::uuid`,
      [codeId],
    );
    return rows[0] ?? {};
  }

  async function codeRows(assignmentId: string): Promise<Array<Record<string, unknown>>> {
    const { rows } = await keeper.query(
      `select id, state::text, idempotency_key, replaces_provisioning_code_id
         from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid order by created_at`,
      [assignmentId],
    );
    return rows as Array<Record<string, unknown>>;
  }

  async function eventCount(codeId: string, eventType: string): Promise<number> {
    const { rows } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = $2`,
      [codeId, eventType],
    );
    return Number(rows[0]?.n ?? -1);
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
      [subject, permission, environment, `recovery fixture ${RUN}`],
    );
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });

    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'atomic-recovery-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enroll("WS11-REC-HUB", "f1".repeat(32));
    await claimAndRedeem(hub);
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hub],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-REC')`,
      [hub, `SERIAL-REC-HUB-${RUN}-${randomUUID()}`, "f1".repeat(32)],
    );
    const { rows: activation } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hub],
    );
    expect(activation[0]?.outcome).toBe("ACTIVATED");

    const assignmentA = await newAssignment(
      "WS11-REC-TERMA",
      "f2".repeat(32),
      "laundry.t1.cashier",
    );
    const assignmentB = await newAssignment(
      "WS11-REC-TERMB",
      "f3".repeat(32),
      "laundry.t2.display",
    );
    const assignmentC = await newAssignment(
      "WS11-REC-TERMC",
      "f4".repeat(32),
      "laundry.t3.ready_scan",
    );
    const assignmentD = await newAssignment(
      "WS11-REC-TERMD",
      "f5".repeat(32),
      "laundry.t4.pickup_scan",
    );
    const assignmentE = await newAssignment(
      "WS11-REC-TERME",
      "e1".repeat(32),
      "laundry.t1.cashier",
    );
    const assignmentF = await newAssignment(
      "WS11-REC-TERMF",
      "e2".repeat(32),
      "laundry.t2.display",
    );
    const assignmentG = await newAssignment(
      "WS11-REC-TERMG",
      "e3".repeat(32),
      "laundry.t3.ready_scan",
    );
    const assignmentH = await newAssignment(
      "WS11-REC-TERMH",
      "e4".repeat(32),
      "laundry.t4.pickup_scan",
    );
    const assignmentI = await newAssignment(
      "WS11-REC-TERMI",
      "e5".repeat(32),
      "laundry.t1.cashier",
    );
    const assignmentJ = await newAssignment(
      "WS11-REC-TERMJ",
      "e6".repeat(32),
      "laundry.t2.display",
    );
    const assignmentK = await newAssignment(
      "WS11-REC-TERMK",
      "e7".repeat(32),
      "laundry.t3.ready_scan",
    );
    const { rows: kTerminal } = await keeper.query<{ device_id: string }>(
      `select device_id from kitluy_devices.device_terminal_assignments where id = $1::uuid`,
      [assignmentK],
    );

    const operator = await makeUser("rec-operator");
    await grant(operator, ISSUE_PERMISSION, "development");
    await grant(operator, REVOKE_PERMISSION, "development");

    const operatorIssueOnly = await makeUser("rec-issue-only");
    await grant(operatorIssueOnly, ISSUE_PERMISSION, "development");

    const operatorRevokeOnly = await makeUser("rec-revoke-only");
    await grant(operatorRevokeOnly, REVOKE_PERMISSION, "development");

    const operatorWrongEnv = await makeUser("rec-wrong-env");
    await grant(operatorWrongEnv, ISSUE_PERMISSION, "pilot");
    await grant(operatorWrongEnv, REVOKE_PERMISSION, "pilot");

    const operatorNoGrant = await makeUser("rec-nogrant");

    fixture = {
      operator,
      operatorIssueOnly,
      operatorRevokeOnly,
      operatorWrongEnv,
      operatorNoGrant,
      hub,
      assignmentA,
      assignmentB,
      assignmentC,
      assignmentD,
      assignmentE,
      assignmentF,
      assignmentG,
      assignmentH,
      assignmentI,
      assignmentJ,
      assignmentK,
      terminalK: kTerminal[0]?.device_id ?? "",
    };
  }, 300_000);

  afterAll(async () => {
    await keeper
      .query(`delete from kitluy_auth.temporary_grants where reason = $1`, [
        `recovery fixture ${RUN}`,
      ])
      .catch(() => undefined);
    await keeper
      .query(`delete from kitluy_ops.test_clock_policy where environment = 'test'`)
      .catch(() => undefined);
    await keeper?.query("revoke kitluy_test_harness from postgres").catch(() => undefined);
    await keeper?.end().catch(() => undefined);
  });

  it("success: authorized scoped human recovers atomically; raw code once, never persisted", async () => {
    const originalKey = `rec-a-issue-${RUN}`;
    const first = await issue(fixture.assignmentA, originalKey);
    expect(first.outcome).toBe("ISSUED");
    const oldId = String(first.provisioning_code_id);
    const oldRow = await codeRow(oldId);

    const recoveryKey = `rec-a-recover-${RUN}`;
    const recovered = await recover(fixture.assignmentA, originalKey, recoveryKey, REASON);
    expect(recovered.outcome, "the authorized recovery succeeds").toBe("RECOVERED");
    expect(typeof recovered.code, "the raw recovery code is returned by the creator").toBe(
      "string",
    );
    expect(CROCKFORD.test(String(recovered.code)), "fresh 8-char Crockford code").toBe(true);
    const newId = String(recovered.provisioning_code_id);
    expect(String(recovered.revoked_provisioning_code_id)).toBe(oldId);
    expect(newId, "a completely new row").not.toBe(oldId);

    const oldAfter = await codeRow(oldId);
    expect(oldAfter.state, "the old code finishes REVOKED — never relabeled EXPIRED").toBe(
      "revoked",
    );
    expect(oldAfter.revocation_reason, "the recovery reason is recorded immutably").toBe(REASON);
    expect(oldAfter.revoked_at, "revoked carries its authoritative timestamp").not.toBeNull();
    expect(oldAfter.revocation_idempotency_key, "the old row names the recovery key").toBe(
      recoveryKey,
    );
    expect(oldAfter.idempotency_key, "the old row keeps its original issuance key").toBe(
      originalKey,
    );
    expect(oldAfter.code_digest, "the old digest is untouched").toBe(oldRow.code_digest);

    const newRow = await codeRow(newId);
    expect(newRow.state).toBe("issued");
    expect(newRow.idempotency_key, "the successor is issued under the recovery key").toBe(
      recoveryKey,
    );
    expect(newRow.replaces_provisioning_code_id, "replacement lineage stays NULL").toBeNull();
    expect(newRow.failed_attempt_count, "zero attempts").toBe(0);
    expect(newRow.redeemed_at ?? null, "no terminal timestamps").toBeNull();
    expect(newRow.revoked_at ?? null).toBeNull();
    expect(newRow.locked_at ?? null).toBeNull();
    expect(
      createHash("sha256").update(String(recovered.code)).digest("hex"),
      "the digest is sha256(raw) and the raw value is stored nowhere",
    ).toBe(newRow.code_digest);
    expect(newRow.code_digest, "a fresh digest").not.toBe(oldRow.code_digest);
    expect(newRow.payload_sha256, "a fresh payload binding").not.toBe(oldRow.payload_sha256);
    const ttlMs =
      new Date(String(newRow.expires_at)).getTime() - new Date(String(newRow.created_at)).getTime();
    expect(ttlMs, "expiry is exactly 15 minutes after creation").toBe(15 * 60 * 1000);
    expect(newRow.correlation_id, "one shared recovery correlation").toBe(
      String(recovered.correlation_id),
    );

    // Exactly one REVOKED and one CREATED event, sharing the correlation.
    expect(await eventCount(oldId, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(oldId, "CREATED"), "the original CREATED event stands").toBe(1);
    expect(await eventCount(newId, "CREATED"), "exactly one successor CREATED event").toBe(1);
    expect(await eventCount(oldId, "EXPIRED"), "recovery never expires").toBe(0);
    const { rows: revEvents } = await keeper.query<{ correlation_id: string; reason_code: string }>(
      `select correlation_id, reason_code from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = 'REVOKED'`,
      [oldId],
    );
    expect(revEvents[0]?.reason_code).toBe("LOST_CODE_RECOVERY");
    expect(revEvents[0]?.correlation_id).toBe(String(recovered.correlation_id));
    const { rows: creEvents } = await keeper.query<{ correlation_id: string }>(
      `select correlation_id from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid and event_type = 'CREATED'`,
      [newId],
    );
    expect(creEvents[0]?.correlation_id, "both events share the recovery correlation").toBe(
      String(recovered.correlation_id),
    );

    // The raw code appears in NO event detail anywhere.
    const { rows: leaks } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
        where detail::text like '%' || $1 || '%'`,
      [String(recovered.code)],
    );
    expect(Number(leaks[0]?.n), "the raw code never appears in any event").toBe(0);
  }, 60_000);

  it("replay: identical recovery is ALREADY_RECOVERED with no raw code and no new work", async () => {
    const originalKey = `rec-b-issue-${RUN}`;
    const first = await issue(fixture.assignmentB, originalKey);
    const oldId = String(first.provisioning_code_id);
    const recoveryKey = `rec-b-recover-${RUN}`;
    const recovered = await recover(fixture.assignmentB, originalKey, recoveryKey, REASON);
    expect(recovered.outcome).toBe("RECOVERED");
    const newId = String(recovered.provisioning_code_id);

    const replay = await recover(fixture.assignmentB, originalKey, recoveryKey, REASON);
    expect(replay.outcome, "identical replay reconciles the completed recovery").toBe(
      "ALREADY_RECOVERED",
    );
    expect(replay.provisioning_code_id, "the replay names the successor").toBe(newId);
    expect(replay.revoked_provisioning_code_id, "the replay names the predecessor").toBe(oldId);
    expect("code" in replay, "the replay must never reconstruct the raw code").toBe(false);
    expect("code_digest" in replay).toBe(false);
    expect("payload_sha256" in replay).toBe(false);
    expect(replay.raw_code_available).toBe(false);
    expect(replay.recovery_completed).toBe(true);

    const rows = await codeRows(fixture.assignmentB);
    expect(rows.length, "no duplicate recovery work").toBe(2);
    expect(await eventCount(oldId, "REVOKED")).toBe(1);
    expect(await eventCount(newId, "CREATED")).toBe(1);

    // Conflicting replay: same recovery key, different reason.
    const conflict = await recover(
      fixture.assignmentB,
      originalKey,
      recoveryKey,
      "a different reason for the same key",
    );
    expect(conflict.outcome).toBe("RECOVERY_REFUSED");
    expect(conflict.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REPLAY");
    expect((await codeRows(fixture.assignmentB)).length, "conflict creates nothing").toBe(2);
  }, 60_000);

  it("keys: old key identifies the old REVOKED code; recovery key identifies the new ISSUED code", async () => {
    const originalKey = `rec-c-issue-${RUN}`;
    const first = await issue(fixture.assignmentC, originalKey);
    const oldId = String(first.provisioning_code_id);
    const recoveryKey = `rec-c-recover-${RUN}`;
    const recovered = await recover(fixture.assignmentC, originalKey, recoveryKey, REASON);
    expect(recovered.outcome).toBe("RECOVERED");
    const newId = String(recovered.provisioning_code_id);

    // The ORIGINAL issuance key still reconciles the OLD code — now REVOKED —
    // and never returns the new code (0168 reconciliation contract).
    const oldReplay = await issue(fixture.assignmentC, originalKey);
    expect(oldReplay.outcome).toBe("ALREADY_ISSUED");
    expect(oldReplay.provisioning_code_id, "the old key names the old code").toBe(oldId);
    expect(oldReplay.state, "the old key reports REVOKED history").toBe("revoked");
    expect(oldReplay.recovery_required, "nothing to recover from a revoked code").toBe(false);
    expect("code" in oldReplay, "the old key never reconstructs any raw code").toBe(false);

    // The RECOVERY key identifies the NEW issued code through the issuance
    // door's own replay (the successor's idempotency key IS the recovery key).
    const newReplay = await issue(fixture.assignmentC, recoveryKey);
    expect(newReplay.outcome).toBe("ALREADY_ISSUED");
    expect(newReplay.provisioning_code_id, "the recovery key names the successor").toBe(newId);
    expect(newReplay.state).toBe("issued");
    expect("code" in newReplay).toBe(false);

    // A second recovery with a DIFFERENT recovery key against the same
    // already-recovered code: stable completion, no third code.
    const second = await recover(fixture.assignmentC, originalKey, `rec-c-second-${RUN}`, REASON);
    expect(second.outcome).toBe("RECOVERY_ALREADY_COMPLETED");
    expect(second.provisioning_code_id, "the standing successor is named").toBe(newId);
    expect(second.revoked_provisioning_code_id).toBe(oldId);
    expect("code" in second, "no raw code on the stable completion answer").toBe(false);
    expect((await codeRows(fixture.assignmentC)).length, "no third code exists").toBe(2);
    expect(await eventCount(oldId, "REVOKED"), "the successor is never revoked").toBe(1);
    const successorRow = await codeRow(newId);
    expect(successorRow.state, "the successor stands ISSUED").toBe("issued");
  }, 60_000);

  it("race A: two identical recovery calls — one creator, one replay, one event pair", async () => {
    const originalKey = `rec-d-issue-${RUN}`;
    const first = await issue(fixture.assignmentD, originalKey);
    const oldId = String(first.provisioning_code_id);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const recoveryKey = `rec-d-recover-${RUN}`;
    const r1p = raceRecover(fixture.assignmentD, originalKey, recoveryKey, barrier);
    const r2p = raceRecover(fixture.assignmentD, originalKey, recoveryKey, barrier);
    release();
    const [r1, r2] = await Promise.all([r1p, r2p]);
    console.log(`race A backends: pid1=${r1.pid}, pid2=${r2.pid}`);
    expect(r1.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r2.error, "no uncontrolled SQLSTATE").toBeNull();
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes).toEqual(["ALREADY_RECOVERED", "RECOVERED"]);
    const winner = r1.result.outcome === "RECOVERED" ? r1.result : r2.result;
    const replayer = r1.result.outcome === "RECOVERED" ? r2.result : r1.result;
    expect(typeof winner.code, "the raw code is returned by the creating transaction only").toBe(
      "string",
    );
    expect("code" in replayer, "the replay receives no raw code").toBe(false);
    expect(replayer.provisioning_code_id).toBe(winner.provisioning_code_id);

    const oldAfter = await codeRow(oldId);
    expect(oldAfter.state).toBe("revoked");
    expect((await codeRows(fixture.assignmentD)).length, "exactly one successor").toBe(2);
    expect(await eventCount(oldId, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(String(winner.provisioning_code_id), "CREATED"), "one CREATED").toBe(1);
  }, 60_000);

  it("race B: two different recovery keys — one winner, one stable completion, one successor", async () => {
    const originalKey = `rec-e-issue-${RUN}`;
    const first = await issue(fixture.assignmentE, originalKey);
    const oldId = String(first.provisioning_code_id);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const r1p = raceRecover(fixture.assignmentE, originalKey, `rec-e-r1-${RUN}`, barrier);
    const r2p = raceRecover(fixture.assignmentE, originalKey, `rec-e-r2-${RUN}`, barrier);
    release();
    const [r1, r2] = await Promise.all([r1p, r2p]);
    console.log(`race B backends: pid1=${r1.pid}, pid2=${r2.pid}`);
    expect(r1.error, "no uncontrolled SQLSTATE or constraint escape").toBeNull();
    expect(r2.error, "no uncontrolled SQLSTATE or constraint escape").toBeNull();
    expect(r1.pid, "the racers must be different backends").not.toBe(r2.pid);
    const outcomes = [r1.result.outcome, r2.result.outcome].sort();
    expect(outcomes, "one winner, one stable completion").toEqual([
      "RECOVERED",
      "RECOVERY_ALREADY_COMPLETED",
    ]);
    const winner = r1.result.outcome === "RECOVERED" ? r1.result : r2.result;
    const loser = r1.result.outcome === "RECOVERED" ? r2.result : r1.result;
    expect(typeof winner.code).toBe("string");
    expect("code" in loser, "the loser receives no raw code").toBe(false);
    expect(loser.provisioning_code_id, "the loser names the standing successor").toBe(
      winner.provisioning_code_id,
    );

    const oldAfter = await codeRow(oldId);
    expect(oldAfter.state).toBe("revoked");
    const rows = await codeRows(fixture.assignmentE);
    expect(rows.length, "exactly one successor — no third code").toBe(2);
    expect(await eventCount(oldId, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(String(winner.provisioning_code_id), "CREATED"), "one CREATED").toBe(1);
  }, 60_000);

  it("refusals: actor and permission boundary, with zero residue", async () => {
    const originalKey = `rec-f-issue-${RUN}`;
    const first = await issue(fixture.assignmentF, originalKey);
    expect(first.outcome).toBe("ISSUED");
    const oldId = String(first.provisioning_code_id);

    const unauthenticated = await recover(
      fixture.assignmentF,
      originalKey,
      `rec-f-r1-${RUN}`,
      REASON,
      null,
    );
    expect(unauthenticated.outcome).toBe("RECOVERY_REFUSED");
    expect(unauthenticated.refusal_code).toBe("KLUY-PROVCODE-UNAUTHENTICATED");

    const noGrant = await recover(
      fixture.assignmentF,
      originalKey,
      `rec-f-r2-${RUN}`,
      REASON,
      fixture.operatorNoGrant,
    );
    expect(
      noGrant.refusal_code,
      "an actor holding neither permission is refused at the coarse gate",
    ).toBe("KLUY-PROVCODE-PERMISSION-DENIED");

    const issueOnly = await recover(
      fixture.assignmentF,
      originalKey,
      `rec-f-r3-${RUN}`,
      REASON,
      fixture.operatorIssueOnly,
    );
    expect(issueOnly.refusal_code, "the revoke permission is required too").toBe(
      "KLUY-PROVCODE-PERMISSION-DENIED",
    );

    const revokeOnly = await recover(
      fixture.assignmentF,
      originalKey,
      `rec-f-r4-${RUN}`,
      REASON,
      fixture.operatorRevokeOnly,
    );
    expect(revokeOnly.refusal_code, "the issue permission is required too").toBe(
      "KLUY-PROVCODE-PERMISSION-DENIED",
    );

    const wrongEnv = await recover(
      fixture.assignmentF,
      originalKey,
      `rec-f-r5-${RUN}`,
      REASON,
      fixture.operatorWrongEnv,
    );
    expect(wrongEnv.refusal_code, "grants in another environment authorize nothing here").toBe(
      "KLUY-PROVCODE-PERMISSION-DENIED",
    );

    const after = await codeRow(oldId);
    expect(after.state, "every refusal left the old code ISSUED").toBe("issued");
    expect(await eventCount(oldId, "REVOKED"), "no REVOKED residue").toBe(0);
    expect((await codeRows(fixture.assignmentF)).length, "no successor residue").toBe(1);
  }, 60_000);

  it("refusals: contract violations — blank/overlong reason, malformed keys, null assignment", async () => {
    const originalKey = `rec-g-issue-${RUN}`;
    await issue(fixture.assignmentG, originalKey);

    const noReason = await recover(fixture.assignmentG, originalKey, `rec-g-r1-${RUN}`, null);
    expect(noReason.refusal_code).toBe("KLUY-PROVCODE-NO-REASON");
    const blankReason = await recover(fixture.assignmentG, originalKey, `rec-g-r2-${RUN}`, "   ");
    expect(blankReason.refusal_code).toBe("KLUY-PROVCODE-NO-REASON");
    const longReason = await recover(
      fixture.assignmentG,
      originalKey,
      `rec-g-r3-${RUN}`,
      `x${"y".repeat(500)}`,
    );
    expect(longReason.refusal_code).toBe("KLUY-PROVCODE-REASON-TOO-LONG");
    const codeShaped = await recover(
      fixture.assignmentG,
      originalKey,
      `rec-g-r4-${RUN}`,
      "the code was ABCDEFGH I think",
    );
    expect(codeShaped.refusal_code, "a code-shaped token in the reason is refused").toBe(
      "KLUY-PROVCODE-REASON-INVALID",
    );
    const noOriginal = await recover(fixture.assignmentG, "", `rec-g-r5-${RUN}`, REASON);
    expect(noOriginal.refusal_code).toBe("KLUY-PROVCODE-NO-ORIGINAL-KEY");
    const noRecovery = await recover(fixture.assignmentG, originalKey, "  ", REASON);
    expect(noRecovery.refusal_code).toBe("KLUY-PROVCODE-NO-RECOVERY-KEY");

    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.recover_terminal_provisioning_code_v1(null, $1, $2, $3) as result`,
        [originalKey, `rec-g-r6-${RUN}`, REASON],
      );
      expect(rows[0]?.result.refusal_code).toBe("KLUY-PROVCODE-NO-ASSIGNMENT");
      await client.query("commit");
    } finally {
      client.release();
    }

    const notFound = await recover(
      fixture.assignmentG,
      `rec-g-never-issued-${RUN}`,
      `rec-g-r7-${RUN}`,
      REASON,
    );
    expect(notFound.refusal_code, "an unknown original key is a stable not-found").toBe(
      "KLUY-PROVCODE-REQUEST-NOT-FOUND",
    );

    const rows = await codeRows(fixture.assignmentG);
    expect(rows.length, "no contract violation left residue").toBe(1);
  }, 60_000);

  it("refusals: original key belonging to another assignment conflicts without disclosure", async () => {
    const originalKey = `rec-h-issue-${RUN}`;
    const first = await issue(fixture.assignmentH, originalKey);
    expect(first.outcome).toBe("ISSUED");

    // Same scope, authorized operator, but the key names assignment H's code
    // while the request names assignment K.
    const conflict = await recover(fixture.assignmentK, originalKey, `rec-h-r1-${RUN}`, REASON);
    expect(conflict.outcome).toBe("RECOVERY_REFUSED");
    expect(conflict.refusal_code).toBe("KLUY-PROVCODE-CONFLICTING-REQUEST");

    // A cross-scope caller (grants in another environment) learns nothing:
    // the same request is the safe permission refusal, not the conflict.
    const probe = await recover(
      fixture.assignmentK,
      originalKey,
      `rec-h-r2-${RUN}`,
      REASON,
      fixture.operatorWrongEnv,
    );
    expect(probe.refusal_code, "no cross-scope existence disclosure").toBe(
      "KLUY-PROVCODE-PERMISSION-DENIED",
    );

    const hRows = await codeRows(fixture.assignmentH);
    expect(hRows.length, "the other assignment's code is untouched").toBe(1);
    expect(hRows[0]?.state).toBe("issued");
    expect((await codeRows(fixture.assignmentK)).length, "nothing created").toBe(0);
  }, 60_000);

  it("refusals: expired, revoked, locked and redeemed codes are stable terminal classifications", async () => {
    // EXPIRED: an overdue ISSUED code is the replacement path's input, not
    // recovery's — recovery refuses and mutates NOTHING (never expires).
    const expiredKey = `rec-i1-issue-${RUN}`;
    const expiredFirst = await issue(fixture.assignmentI, expiredKey);
    const expiredId = String(expiredFirst.provisioning_code_id);
    const pastExpiry = new Date(
      new Date(String(expiredFirst.expires_at)).getTime() + 1000,
    ).toISOString();
    const expiredAttempt = await recover(
      fixture.assignmentI,
      expiredKey,
      `rec-i1-r-${RUN}`,
      REASON,
      fixture.operator,
      pastExpiry,
    );
    expect(expiredAttempt.refusal_code).toBe("KLUY-PROVCODE-ALREADY-EXPIRED");
    const expiredRow = await codeRow(expiredId);
    expect(expiredRow.state, "recovery never expires the overdue code itself").toBe("issued");
    expect(await eventCount(expiredId, "EXPIRED"), "no EXPIRED event from recovery").toBe(0);
    expect(await eventCount(expiredId, "REVOKED"), "no REVOKED residue").toBe(0);

    // REVOKED (plain operator revocation, no successor): stable ALREADY-REVOKED.
    const revokedKey = `rec-i2-issue-${RUN}`;
    const revokedFirst = await issue(fixture.assignmentJ, revokedKey);
    const revokedId = String(revokedFirst.provisioning_code_id);
    const revoked = await callDoor(
      `kitluy_devices.revoke_terminal_provisioning_code_v1($1::uuid, $2, $3)`,
      [revokedId, `rec-i2-revoke-${RUN}`, REASON],
      fixture.operator,
    );
    expect(revoked.outcome).toBe("REVOKED");
    const recoverRevoked = await recover(
      fixture.assignmentJ,
      revokedKey,
      `rec-i2-r-${RUN}`,
      REASON,
    );
    expect(recoverRevoked.refusal_code).toBe("KLUY-PROVCODE-ALREADY-REVOKED");
    expect(await eventCount(revokedId, "REVOKED"), "no duplicate revocation").toBe(1);
    expect((await codeRows(fixture.assignmentJ)).length, "no successor").toBe(1);

    // LOCKED: five genuine failures through the evaluator.
    const lockedKey = `rec-i3-issue-${RUN}`;
    const lockedFirst = await issue(fixture.assignmentK, lockedKey);
    const lockedId = String(lockedFirst.provisioning_code_id);
    for (let i = 0; i < 5; i += 1) {
      const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
      const raw = String(lockedFirst.code);
      const flipped =
        alphabet[(alphabet.indexOf(raw[0] ?? "0") + 1 + i) % alphabet.length] + raw.slice(1);
      await keeper.query(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1($1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3::text)`,
        [fixture.assignmentK, flipped, fixture.terminalK],
      );
    }
    expect((await codeRow(lockedId)).state, "fixture: five failures lock the code").toBe("locked");
    const recoverLocked = await recover(fixture.assignmentK, lockedKey, `rec-i3-r-${RUN}`, REASON);
    expect(recoverLocked.refusal_code).toBe("KLUY-PROVCODE-ALREADY-LOCKED");
    expect((await codeRows(fixture.assignmentK)).length, "no successor").toBe(1);
  }, 60_000);

  it("refusals: inactive assignment is a stable classification with zero residue", async () => {
    // NOTE — ALREADY-REDEEMED shares the exact state-guard branch proven here
    // and for LOCKED/EXPIRED/REVOKED, but the redeemed state is structurally
    // unreachable until P02B3 builds redemption: no door can create it and
    // direct table mutation is denied to every identity (including this
    // fixture's own role — itself the intended posture). The 0165 revocation
    // suite recorded the same evidence position.
    const assignmentM = await newAssignment(
      "WS11-REC-TERMM",
      "e9".repeat(32),
      "laundry.t1.cashier",
    );
    const inactiveKey = `rec-j2-issue-${RUN}`;
    const inactiveFirst = await issue(assignmentM, inactiveKey);
    const inactiveId = String(inactiveFirst.provisioning_code_id);

    // Close the assignment through the governed 0121 door (terminal
    // assignments fall with the device assignment that authorized them) —
    // never by direct mutation.
    const { rows: mRows } = await keeper.query<{ device_id: string }>(
      `select device_id from kitluy_devices.device_terminal_assignments where id = $1::uuid`,
      [assignmentM],
    );
    await keeper.query(
      `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'RECOVERY-FIXTURE-INACTIVE', 'OP-REC')`,
      [mRows[0]?.device_id],
    );

    const recoverInactive = await recover(assignmentM, inactiveKey, `rec-j2-r-${RUN}`, REASON);
    expect(recoverInactive.outcome).toBe("RECOVERY_REFUSED");
    expect(recoverInactive.refusal_code).toBe("KLUY-PROVCODE-ASSIGNMENT-INACTIVE");
    const inactiveRow = await codeRow(inactiveId);
    expect(inactiveRow.state, "the inactive-assignment refusal mutates nothing").toBe("issued");
    expect(await eventCount(inactiveId, "REVOKED"), "no residue").toBe(0);
    expect((await codeRows(assignmentM)).length, "no successor").toBe(1);
  }, 60_000);

  it("rollback: inactive Hub refuses BEFORE any mutation — old code ISSUED, zero residue", async () => {
    const assignmentN = await newAssignment(
      "WS11-REC-TERMN",
      "ea".repeat(32),
      "laundry.t2.display",
    );
    const originalKey = `rec-k-issue-${RUN}`;
    const first = await issue(assignmentN, originalKey);
    const oldId = String(first.provisioning_code_id);

    // Withdraw EVERY active Hub at the scope: the Hub gate counts projections
    // per Tenant/Store/Location, and this shared fixture scope carries
    // projections planted by the db:test assertion fixtures too. All rows are
    // saved and restored in finally, so no later suite observes a Hub-less
    // scope.
    const { rows: projection } = await keeper.query(
      `select device_id, assignment_id, assignment_generation, tenant_id, digital_store_id,
              store_location_id, terminal_profile_keys, projected_at, environment
         from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION],
    );
    expect(
      projection.length,
      "fixture: at least the recovery Hub projection exists",
    ).toBeGreaterThan(0);
    await keeper.query(
      `delete from kitluy_devices.device_assignment_projections
        where tenant_id = $1::uuid and digital_store_id = $2::uuid and store_location_id = $3::uuid`,
      [TENANT, STORE, LOCATION],
    );
    try {
      const refused = await recover(assignmentN, originalKey, `rec-k-r-${RUN}`, REASON);
      expect(refused.outcome).toBe("RECOVERY_REFUSED");
      expect(refused.refusal_code).toBe("KLUY-PROVCODE-HUB-INACTIVE");

      const after = await codeRow(oldId);
      expect(after.state, "the old code remains ISSUED").toBe("issued");
      expect(after.revoked_at ?? null, "no revocation timestamp").toBeNull();
      expect(after.revocation_idempotency_key ?? null, "no idempotency residue").toBeNull();
      expect(await eventCount(oldId, "REVOKED"), "no REVOKED event").toBe(0);
      expect((await codeRows(assignmentN)).length, "no new code row").toBe(1);
    } finally {
      for (const row of projection as Array<Record<string, unknown>>) {
        await keeper.query(
          `insert into kitluy_devices.device_assignment_projections
             (device_id, assignment_id, assignment_generation, tenant_id, digital_store_id,
              store_location_id, terminal_profile_keys, projected_at, environment)
           values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, $6::uuid, $7, $8, $9)`,
          [
            row.device_id,
            row.assignment_id,
            row.assignment_generation,
            row.tenant_id,
            row.digital_store_id,
            row.store_location_id,
            row.terminal_profile_keys,
            row.projected_at,
            row.environment,
          ],
        );
      }
    }
  }, 60_000);

  it("security: anon/PUBLIC denied, bridges governor-only, tables unreachable, no raw material anywhere", async () => {
    // anon cannot even EXECUTE the door.
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

    // authenticated cannot EXECUTE the internal bridges and holds no direct
    // table access at all. Each denied probe aborts its transaction, so every
    // probe runs in a FRESH one — a probe must prove 42501, never 25P02.
    const denied = [
      `select kitluy_devices.provisioning_code_issue_held_v1()`,
      `select kitluy_devices.provisioning_code_revoke_held_v1()`,
      `select id from kitluy_devices.device_provisioning_codes limit 1`,
      `insert into kitluy_devices.device_provisioning_code_events
         (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
          event_type, actor_type) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
          gen_random_uuid(), 'development', 'CREATED', 'OPERATOR')`,
    ];
    const authed = await keeper.connect();
    try {
      for (const probe of denied) {
        await authed.query("begin");
        await authed.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
        ]);
        await authed.query("set local role authenticated");
        await expect(authed.query(probe), probe).rejects.toMatchObject({ code: "42501" });
        await authed.query("rollback");
      }
    } finally {
      authed.release();
    }

    // Raw-code census: no raw code this fixture ever saw appears in any event
    // row or audit-shaped text; no code-shaped column exists on either table.
    expect(rawCodes.length, "the fixture exercised raw-code returns").toBeGreaterThan(0);
    for (const raw of rawCodes) {
      const { rows } = await keeper.query<{ n: string }>(
        `select count(*)::text as n from kitluy_devices.device_provisioning_code_events
          where detail::text like '%' || $1 || '%' or coalesce(reason_code, '') = $1`,
        [raw],
      );
      expect(Number(rows[0]?.n), `raw code ${raw} leaked into events`).toBe(0);
    }
    const { rows: columns } = await keeper.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'kitluy_devices'
          and table_name in ('device_provisioning_codes', 'device_provisioning_code_events')
          and column_name ~ '(^|_)(code|raw|plain|secret)(_|$)'
          and column_name not in ('code_digest', 'provisioning_code_id', 'reason_code',
                                  'replaces_provisioning_code_id')`,
    );
    expect(columns.length, "no raw-code-capable column exists").toBe(0);

    // Grant and membership census: no login-capable role holds the governor.
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n), "no login-capable governor membership").toBe(0);
  }, 60_000);
});
