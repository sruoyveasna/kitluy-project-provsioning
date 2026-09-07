/**
 * CROSS-OPERATION REPLACEMENT RACE HARDENING.
 *
 * WS-11-T004-P02B2B2B2A. Proves the 0167 replacement path inside the one
 * governed issuance door against concurrent revocation (0165), concurrent
 * presentation/lockout evaluation (0164/0166), governed Hub-state change
 * (0121 `revoke_device_assignment_v1` — the only canonical projection
 * withdrawal) and successive replacement, on genuinely separate pooled
 * backends with recorded PIDs.
 *
 * PRE-EDIT LOCK-ORDER AUDIT (all four doors, verified against migrations
 * 0163/0167, 0166, 0165, 0164/0166):
 *   issuance door : idempotency row -> ASSIGNMENT for update -> idempotency
 *                   recheck -> outstanding CODE for update -> (0166 helper,
 *                   re-entrant) -> insert
 *   expiration    : unlocked read -> ASSIGNMENT for update -> CODE for update
 *   revocation    : idempotency row -> unlocked read -> ASSIGNMENT for update
 *                   -> CODE for update -> idempotency recheck
 *   evaluator     : ASSIGNMENT for update -> outstanding CODE for update
 *   Every door locks ASSIGNMENT first, CODE second; no reversed order exists.
 *   Hub-state validation point: the issuance door reads the CURRENT
 *   activation projection (unlocked) BEFORE locating the outstanding code
 *   and BEFORE inserting the successor; projection withdrawal is a committed
 *   governed DELETE, so a gate read that saw the projection is serial-
 *   equivalent to "issuance ordered before the Hub transition".
 *
 * RACE MATRIX (winner rules / required residue per branch are asserted
 * inline; staggered release makes each serialization deterministic while
 * both racers run on separate backends with recorded PIDs):
 *   A  replacement vs revoke-predecessor
 *   B  replacement vs 5th-failure presentation (count primed to 4)
 *   C  replacement vs correct-predecessor presentation
 *   D  replacement vs governed Hub deactivation
 *   E  successive replacement lineage A->B->C under a true barrier race
 *   H  hostile lineage / privilege probes (runtime roles + constraint layer)
 *
 * DOCUMENTED GOVERNED OUTCOMES (recorded per the package's own rule "if
 * repository execution proves a different serializable order is permitted,
 * document the exact authority before accepting it"):
 *   - When a concurrent terminal transition (revocation in A2, evaluator-side
 *     expiration in B1/C1) commits FIRST, the replacement call finds NO
 *     outstanding code and takes the unchanged 0163 initial-issuance path
 *     (0167 door step 6: "no outstanding code -> the 0163 initial-issuance
 *     path, unchanged"). The new row carries NULL lineage — it is never a
 *     successor of a REVOKED/expired-elsewhere predecessor. Every package
 *     invariant (one terminal state per code, one direct successor, at most
 *     one outstanding ISSUED row, no duplicate events, raw code returned
 *     once) holds.
 *   - When the replacement commits FIRST in B2/C2, the presentation meets
 *     the LIVE successor (0166 evaluator step 2 evaluates the CURRENT
 *     outstanding code): a wrong/correct-but-superseded value is an ordinary
 *     MISMATCH against the successor digest — one bounded failed attempt on
 *     the successor (1 of 5), never an increment on the predecessor, never
 *     MATCH_READY for an overdue code, never a PRESENTED event after the
 *     expiry transition.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DSN = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";
const RUN = randomUUID().slice(0, 8);
const TENANT = "00000000-0000-4000-8000-000000000011";
const STORE = "00000000-0000-4000-8000-000000000015";
const LOCATION = "00000000-0000-4000-8000-000000000018";
// Race D needs a scope whose projection set this file fully controls: the
// seeded sibling branch DEMO-PP-02 is used by no other test file, so withdrawing
// this file's own Hub projection there really leaves ZERO projections.
const LOCATION_D = "00000000-0000-4000-8000-000000000019";
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
if (!live) console.warn("SKIPPED: cross-race hardening — local database unreachable");

interface IssuedCode {
  id: string;
  raw: string;
  expiresAt: string;
}

interface RacerOutcome {
  pid: number;
  role: string;
  result: Record<string, unknown>;
  error: string | null;
  sqlstate: string | null;
}

interface Fixture {
  hub: string;
  hubD1: string;
  hubD2: string;
  assignments: Record<string, string>;
  terminals: Record<string, string>;
  operator: string;
}

const RACE_KEYS = ["a1", "a2", "b1", "b2", "c1", "c2", "e", "d1", "d2", "h"] as const;

describe.skipIf(!live)("replacement cross-operation races, separate backends, recorded PIDs", () => {
  let keeper: pg.Pool;
  let fixture: Fixture;

  async function enroll(label: string, fingerprint: string): Promise<string> {
    const { rows } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.hardware_profiles where profile_key = 'WS11-T001-HUB-PROBE'`,
    );
    const profile = rows[0]?.id;
    const { rows: enrolled } = await keeper.query<{ id: string }>(
      `select kitluy_devices.enroll_device_v1($1, $2::uuid, now() - interval '30 days', $3, 'ed25519', 'software', 'STATION-XRACE', 'OP-XRACE', $4::jsonb) as id`,
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

  async function claimAndRedeem(deviceId: string, location: string = LOCATION): Promise<string> {
    const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const token = hex();
    const payload = hex();
    await keeper.query(
      `select kitluy_devices.create_device_claim_v1($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, 900, 'OP-XRACE')`,
      [deviceId, TENANT, STORE, location, token, payload],
    );
    const { rows } = await keeper.query<{ id: string }>(
      `select kitluy_devices.redeem_device_claim_v1($1, $2, $3::uuid, 'AGENT-XRACE') as id`,
      [token, payload, deviceId],
    );
    return rows[0]?.id ?? "";
  }

  async function activateHub(hubId: string, serial: string): Promise<void> {
    await keeper.query(
      `select kitluy_devices.evaluate_trusted_time_v1($1::uuid, 'development', null, now(), null, gen_random_uuid())`,
      [hubId],
    );
    await keeper.query(
      `select kitluy_devices.issue_device_certificate_v1($1::uuid, 'development', $2, $3, 'OP-XRACE')`,
      [hubId, serial, "b1".repeat(32)],
    );
    const { rows } = await keeper.query<{ outcome: string }>(
      `select (kitluy_devices.attempt_activate_device_v1($1::uuid, 'development', 'OP-ACTIVATE')).outcome as outcome`,
      [hubId],
    );
    expect(rows[0]?.outcome).toBe("ACTIVATED");
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

  /** Replacement racer: the 0167 door as the operator, past due. */
  async function raceReplace(
    code: IssuedCode,
    assignmentId: string,
    idempotencyKey: string,
    ready: Promise<void>,
  ): Promise<RacerOutcome> {
    const client = await keeper.connect();
    try {
      const { rows: pidRows } = await client.query<{ pid: number; role: string }>(
        "select pg_backend_pid() as pid, current_role as role",
      );
      await client.query("begin");
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
      return {
        pid: pidRows[0]?.pid ?? 0,
        role: "authenticated",
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        role: "authenticated",
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  /** Revocation racer: the 0165 door as the operator (live clock). */
  async function raceRevoke(
    codeId: string,
    idempotencyKey: string,
    reason: string,
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
        [codeId, idempotencyKey, reason],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        role: "authenticated",
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        role: "authenticated",
        result: {},
        error: error instanceof Error ? error.message : String(error),
        sqlstate: (error as { code?: string }).code ?? null,
      };
    } finally {
      client.release();
    }
  }

  /** Presentation racer: the internal evaluator as the harness, past due. */
  async function racePresent(
    code: IssuedCode,
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
      const due = new Date(new Date(code.expiresAt).getTime() + 1000);
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
        due.toISOString(),
      ]);
      await ready;
      const { rows } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
           $1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3) as result`,
        [assignmentId, presented, terminalRef],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        role: "postgres(harness)",
        result: rows[0]?.result ?? {},
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        role: "postgres(harness)",
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
      const { rows } = await client.query<{ revoked: number }>(
        `select kitluy_devices.revoke_device_assignment_v1($1::uuid, 'XRACE-HUB-TRANSITION', 'OP-XRACE') as revoked`,
        [hubId],
      );
      await client.query("commit");
      return {
        pid: pidRows[0]?.pid ?? 0,
        role: "postgres(harness)",
        result: { outcome: "ASSIGNMENT_REVOKED", revoked: rows[0]?.revoked ?? 0 },
        error: null,
        sqlstate: null,
      };
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      return {
        pid: 0,
        role: "postgres(harness)",
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

  async function codeRows(assignmentId: string): Promise<
    Array<{
      id: string;
      state: string;
      idempotency_key: string | null;
      replaces_provisioning_code_id: string | null;
      failed_attempt_count: number;
      code_digest: string;
    }>
  > {
    const { rows } = await keeper.query<{
      id: string;
      state: string;
      idempotency_key: string | null;
      replaces_provisioning_code_id: string | null;
      failed_attempt_count: number;
      code_digest: string;
    }>(
      `select id, state::text, idempotency_key, replaces_provisioning_code_id, failed_attempt_count, code_digest
         from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid order by created_at`,
      [assignmentId],
    );
    return rows;
  }

  async function eventRows(
    codeId: string,
  ): Promise<Array<{ event_type: string; detail: Record<string, unknown> | null }>> {
    const { rows } = await keeper.query<{
      event_type: string;
      detail: Record<string, unknown> | null;
    }>(
      `select event_type, detail from kitluy_devices.device_provisioning_code_events
        where provisioning_code_id = $1::uuid order by id`,
      [codeId],
    );
    return rows;
  }

  async function eventCount(codeId: string, eventType: string): Promise<number> {
    return (await eventRows(codeId)).filter((row) => row.event_type === eventType).length;
  }

  /**
   * Prime the failed-attempt count the sanctioned way: genuine wrong
   * presentations through the 0164/0166 evaluator on the LIVE clock (the
   * code is not yet due), never a direct table write.
   */
  async function primeAttempts(
    code: IssuedCode,
    assignmentId: string,
    terminalRef: string,
    count: number,
  ): Promise<void> {
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const client = await keeper.connect();
    try {
      for (let attempt = 1; attempt <= count; attempt += 1) {
        const { rows } = await client.query<{ result: Record<string, unknown> }>(
          `select kitluy_devices.evaluate_terminal_provisioning_code_v1(
             $1::uuid, $2, gen_random_uuid(), 'TERMINAL', $3) as result`,
          [assignmentId, wrong, terminalRef],
        );
        const result = rows[0]?.result ?? {};
        expect(result.outcome, `priming presentation ${attempt} must be an ordinary failure`).toBe(
          "FAILED_PRESENTATION",
        );
        expect(result.failed_attempt_count).toBe(attempt);
      }
    } finally {
      client.release();
    }
  }

  function expectNoUncontrolled(...racers: RacerOutcome[]): void {
    for (const racer of racers) {
      expect(racer.error, `no uncontrolled error (sqlstate ${racer.sqlstate ?? "n/a"})`).toBeNull();
      expect(racer.sqlstate, "no raw SQLSTATE escaped to a caller").toBeNull();
    }
  }

  beforeAll(async () => {
    keeper = new pg.Pool({ connectionString: DSN, max: 10 });

    // Sanctioned test clock (committed policy row, removed in afterAll) and
    // harness membership for the internal evaluator (revoked in afterAll).
    await keeper.query(
      `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'cross-race-${RUN}', 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001')
       on conflict (environment) do nothing`,
    );
    await keeper.query("grant kitluy_test_harness to postgres");

    const hub = await enroll("WS11-XRACE-HUB", "c1".repeat(32));
    await claimAndRedeem(hub);
    await activateHub(hub, `SERIAL-XRACE-HUB-${RUN}-${randomUUID()}`);
    // Race D owns the sibling branch's scope outright: hubD1 is activated now
    // for D1 and withdrawn there; hubD2 is enrolled but NOT activated until
    // D2, so D1's follow-on check sees zero projections at LOCATION_D.
    const hubD1 = await enroll("WS11-XRACE-HUBD1", "c2".repeat(32));
    await claimAndRedeem(hubD1, LOCATION_D);
    await activateHub(hubD1, `SERIAL-XRACE-HUBD1-${RUN}-${randomUUID()}`);
    const hubD2 = await enroll("WS11-XRACE-HUBD2", "c3".repeat(32));
    await claimAndRedeem(hubD2, LOCATION_D);

    const assignments: Record<string, string> = {};
    const terminals: Record<string, string> = {};
    let index = 0;
    for (const raceKey of RACE_KEYS) {
      index += 1;
      const raceLocation = raceKey === "d1" || raceKey === "d2" ? LOCATION_D : LOCATION;
      const terminal = await enroll(
        `WS11-XRACE-T${index}`,
        randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, ""),
      );
      await claimAndRedeem(terminal, raceLocation);
      const profile = index % 2 === 0 ? "laundry.t1.cashier" : "laundry.t2.display";
      const { rows } = await keeper.query<{ id: string }>(
        `select kitluy_devices.assign_terminal_profile_v1($1::uuid, 1, $2, $3::uuid, 'OP-XRACE') as id`,
        [terminal, profile, raceLocation],
      );
      assignments[raceKey] = rows[0]?.id ?? "";
      terminals[raceKey] = terminal;
    }

    const operator = randomUUID();
    await keeper.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                               email_confirmed_at, created_at, updated_at)
       values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
               'authenticated', $2, '', now(), now(), now())`,
      [operator, `cross-race-operator-${RUN}@fixture.invalid`],
    );
    await keeper.query(
      `insert into kitluy_auth.temporary_grants (subject_id, permission_key, environment, starts_at, expires_at, reason)
       values ($1::uuid, $2, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3),
              ($1::uuid, $4, 'development', now() - interval '1 minute', now() + interval '30 minutes', $3)`,
      [operator, ISSUE_PERMISSION, `cross race fixture ${RUN}`, REVOKE_PERMISSION],
    );

    fixture = { hub, hubD1, hubD2, assignments, terminals, operator };
  }, 300_000);

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

  // -----------------------------------------------------------------------
  // RACE A — replacement versus revocation of the overdue predecessor.
  // -----------------------------------------------------------------------

  it("A1: replacement serialized first — predecessor EXPIRED, revocation gets the stable terminal classification", async () => {
    const assignment = fixture.assignments.a1;
    const code = await issueCode(assignment, `xrace-a1-issue-${RUN}`);
    const replace = raceReplace(code, assignment, `xrace-a1-replace-${RUN}`, barrier(0));
    const revoke = raceRevoke(code.id, `xrace-a1-revoke-${RUN}`, "cross race audit revocation", barrier(STAGGER_MS));
    const [rReplace, rRevoke] = await Promise.all([replace, revoke]);
    console.log(`race A1 backends: replacement pid=${rReplace.pid}, revocation pid=${rRevoke.pid}`);
    expect(rReplace.pid).not.toBe(rRevoke.pid);
    expectNoUncontrolled(rReplace, rRevoke);

    expect(rReplace.result.outcome, "the replacement wins the serialization").toBe("ISSUED");
    expect(rReplace.result.replaces_provisioning_code_id).toBe(code.id);
    expect(rRevoke.result.outcome, "revocation of an expired code is a stable refusal").toBe(
      "REVOCATION_REFUSED",
    );
    expect(rRevoke.result.refusal_code).toBe("KLUY-PROVCODE-ALREADY-EXPIRED");

    const rows = await codeRows(assignment);
    expect(rows.length).toBe(2);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state, "EXPIRED is never overwritten by the losing revocation").toBe("expired");
    expect(successor?.state).toBe("issued");
    expect(successor?.replaces_provisioning_code_id).toBe(code.id);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "REVOKED"), "no REVOKED event on the expired predecessor").toBe(0);
    expect(await eventCount(String(successor?.id), "CREATED"), "exactly one successor CREATED event").toBe(1);
  }, 60_000);

  it("A2: revocation serialized first — predecessor REVOKED, no successor lineage, no EXPIRED event", async () => {
    const assignment = fixture.assignments.a2;
    const code = await issueCode(assignment, `xrace-a2-issue-${RUN}`);
    const revoke = raceRevoke(code.id, `xrace-a2-revoke-${RUN}`, "cross race audit revocation", barrier(0));
    const replace = raceReplace(code, assignment, `xrace-a2-replace-${RUN}`, barrier(STAGGER_MS));
    const [rRevoke, rReplace] = await Promise.all([revoke, replace]);
    console.log(`race A2 backends: revocation pid=${rRevoke.pid}, replacement pid=${rReplace.pid}`);
    expect(rRevoke.pid).not.toBe(rReplace.pid);
    expectNoUncontrolled(rRevoke, rReplace);

    expect(rRevoke.result.outcome, "the revocation wins the serialization").toBe("REVOKED");

    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    expect(predecessor?.state, "REVOKED is the one terminal state").toBe("revoked");
    expect(await eventCount(code.id, "REVOKED"), "exactly one REVOKED event").toBe(1);
    expect(await eventCount(code.id, "EXPIRED"), "no EXPIRED event").toBe(0);
    // NEVER ALLOW: a successor created from a REVOKED predecessor.
    const lineage = rows.filter((row) => row.replaces_provisioning_code_id === code.id);
    expect(lineage.length, "no successor lineage from the revoked predecessor").toBe(0);

    // DOCUMENTED GOVERNED OUTCOME (file header): with no outstanding code the
    // raced call takes the unchanged 0163 initial-issuance path — a fresh
    // NULL-lineage row, serial-equivalent to an authorized operator issuing
    // after the revocation. It is never a successor; every invariant holds.
    if (rReplace.result.outcome === "ISSUED") {
      expect(rReplace.result.replaces_provisioning_code_id, "no lineage to the revoked code").toBeUndefined();
      const fresh = rows.find((row) => row.id !== code.id);
      expect(fresh?.state).toBe("issued");
      expect(fresh?.replaces_provisioning_code_id).toBeNull();
      const created = (await eventRows(String(fresh?.id))).filter((row) => row.event_type === "CREATED");
      expect(created.length, "exactly one CREATED event for the fresh row").toBe(1);
      expect(created[0]?.detail ?? {}, "the fresh CREATED event carries no predecessor").toEqual({});
    } else {
      // A fail-closed terminal classification is equally acceptable.
      expect(rReplace.result.outcome).toBe("ISSUANCE_REFUSED");
      expect(rows.length, "no new row when the raced call refuses").toBe(1);
    }
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE B — replacement versus fifth failure (count primed to 4).
  // -----------------------------------------------------------------------

  it("B1: presentation serialized first — expiry precedes digest/attempt; count stays 4; no LOCKED", async () => {
    const assignment = fixture.assignments.b1;
    const code = await issueCode(assignment, `xrace-b1-issue-${RUN}`);
    await primeAttempts(code, assignment, fixture.terminals.b1, 4);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const present = racePresent(code, assignment, wrong, fixture.terminals.b1, barrier(0));
    const replace = raceReplace(code, assignment, `xrace-b1-replace-${RUN}`, barrier(STAGGER_MS));
    const [rPresent, rReplace] = await Promise.all([present, replace]);
    console.log(`race B1 backends: presentation pid=${rPresent.pid}, replacement pid=${rReplace.pid}`);
    expect(rPresent.pid).not.toBe(rReplace.pid);
    expectNoUncontrolled(rPresent, rReplace);

    expect(rPresent.result.outcome, "an overdue code is a bookkeeping fact, not an attempt").toBe(
      "PRESENTATION_REFUSED",
    );
    expect(rPresent.result.refusal_code, "the stable expired classification").toBe("KLUY-PROVCODE-EXPIRED");

    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    expect(predecessor?.state).toBe("expired");
    expect(predecessor?.failed_attempt_count, "expiry never counts an attempt").toBe(4);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "LOCKED"), "no LOCKED event").toBe(0);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "exactly the four priming attempts, never a fifth").toBe(4);

    // The raced replacement then finds no outstanding code: DOCUMENTED
    // GOVERNED OUTCOME (0163 initial issuance, NULL lineage) or fail-closed.
    if (rReplace.result.outcome === "ISSUED") {
      const fresh = rows.find((row) => row.id !== code.id);
      expect(fresh?.state).toBe("issued");
      expect(fresh?.replaces_provisioning_code_id, "fresh row is not a lineage successor").toBeNull();
      expect(await eventCount(String(fresh?.id), "CREATED"), "exactly one CREATED event").toBe(1);
    } else {
      expect(rReplace.result.outcome).toBe("ISSUANCE_REFUSED");
    }
    expect(rows.filter((row) => row.state === "issued").length, "at most one outstanding code").toBeLessThanOrEqual(1);
  }, 60_000);

  it("B2: replacement serialized first — successor stands; the late wrong presentation meets the live successor", async () => {
    const assignment = fixture.assignments.b2;
    const code = await issueCode(assignment, `xrace-b2-issue-${RUN}`);
    await primeAttempts(code, assignment, fixture.terminals.b2, 4);
    const wrong = code.raw === "00000000" ? "11111111" : "00000000";
    const replace = raceReplace(code, assignment, `xrace-b2-replace-${RUN}`, barrier(0));
    const present = racePresent(code, assignment, wrong, fixture.terminals.b2, barrier(STAGGER_MS));
    const [rReplace, rPresent] = await Promise.all([replace, present]);
    console.log(`race B2 backends: replacement pid=${rReplace.pid}, presentation pid=${rPresent.pid}`);
    expect(rReplace.pid).not.toBe(rPresent.pid);
    expectNoUncontrolled(rReplace, rPresent);

    expect(rReplace.result.outcome).toBe("ISSUED");
    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state).toBe("expired");
    expect(predecessor?.failed_attempt_count, "predecessor count frozen at 4").toBe(4);
    expect(successor?.state).toBe("issued");
    expect(successor?.replaces_provisioning_code_id).toBe(code.id);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "LOCKED"), "no LOCKED event").toBe(0);
    expect(await eventCount(String(successor?.id), "CREATED"), "exactly one successor CREATED event").toBe(1);

    // DOCUMENTED GOVERNED OUTCOME (package race-B escape hatch): the
    // evaluator evaluates the CURRENT outstanding code (0166 step 2). The
    // wrong value is one ordinary bounded failure against the LIVE successor
    // — never against the expired predecessor, never a fifth attempt,
    // never a lock.
    expect(rPresent.result.outcome).toBe("FAILED_PRESENTATION");
    expect(rPresent.result.failed_attempt_count, "one bounded failure on the successor").toBe(1);
    expect(successor?.failed_attempt_count, "never above five").toBeLessThanOrEqual(5);
    expect(await eventCount(code.id, "FAILED_ATTEMPT"), "exactly the four priming attempts on the predecessor, none after replacement").toBe(4);
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE C — replacement versus correct presentation of the predecessor.
  // -----------------------------------------------------------------------

  it("C1: presentation serialized first — expiry precedes the digest, so MATCH_READY is impossible", async () => {
    const assignment = fixture.assignments.c1;
    const code = await issueCode(assignment, `xrace-c1-issue-${RUN}`);
    const present = racePresent(code, assignment, code.raw, fixture.terminals.c1, barrier(0));
    const replace = raceReplace(code, assignment, `xrace-c1-replace-${RUN}`, barrier(STAGGER_MS));
    const [rPresent, rReplace] = await Promise.all([present, replace]);
    console.log(`race C1 backends: presentation pid=${rPresent.pid}, replacement pid=${rReplace.pid}`);
    expect(rPresent.pid).not.toBe(rReplace.pid);
    expectNoUncontrolled(rPresent, rReplace);

    expect(rPresent.result.outcome, "the correct code of an overdue row is EXPIRED, never MATCH_READY").toBe(
      "PRESENTATION_REFUSED",
    );
    expect(rPresent.result.refusal_code).toBe("KLUY-PROVCODE-EXPIRED");

    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    expect(predecessor?.state).toBe("expired");
    expect(predecessor?.failed_attempt_count, "no failed-attempt increment").toBe(0);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(code.id, "PRESENTED"), "no PRESENTED event after the expiry transition").toBe(0);
    expect(await eventCount(code.id, "REDEEMED"), "no redemption").toBe(0);

    // Raced replacement: DOCUMENTED GOVERNED OUTCOME (0163 initial issuance,
    // NULL lineage) or fail-closed — never a second terminal transition.
    if (rReplace.result.outcome === "ISSUED") {
      const fresh = rows.find((row) => row.id !== code.id);
      expect(fresh?.state).toBe("issued");
      expect(fresh?.replaces_provisioning_code_id).toBeNull();
      expect(await eventCount(String(fresh?.id), "CREATED"), "exactly one CREATED event").toBe(1);
    } else {
      expect(rReplace.result.outcome).toBe("ISSUANCE_REFUSED");
    }
  }, 60_000);

  it("C2: replacement serialized first — the superseded correct code never produces MATCH_READY", async () => {
    const assignment = fixture.assignments.c2;
    const code = await issueCode(assignment, `xrace-c2-issue-${RUN}`);
    const replace = raceReplace(code, assignment, `xrace-c2-replace-${RUN}`, barrier(0));
    const present = racePresent(code, assignment, code.raw, fixture.terminals.c2, barrier(STAGGER_MS));
    const [rReplace, rPresent] = await Promise.all([replace, present]);
    console.log(`race C2 backends: replacement pid=${rReplace.pid}, presentation pid=${rPresent.pid}`);
    expect(rReplace.pid).not.toBe(rPresent.pid);
    expectNoUncontrolled(rReplace, rPresent);

    expect(rReplace.result.outcome).toBe("ISSUED");
    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state).toBe("expired");
    expect(predecessor?.failed_attempt_count, "no increment on the predecessor").toBe(0);
    expect(successor?.state).toBe("issued");
    expect(successor?.replaces_provisioning_code_id).toBe(code.id);
    expect(await eventCount(code.id, "EXPIRED"), "exactly one EXPIRED event").toBe(1);
    expect(await eventCount(String(successor?.id), "CREATED"), "exactly one successor CREATED event").toBe(1);
    expect(await eventCount(code.id, "PRESENTED"), "no PRESENTED event after expiry").toBe(0);

    // DOCUMENTED GOVERNED OUTCOME: the evaluator compares against the LIVE
    // successor digest only (the predecessor's raw value is stored nowhere).
    // A superseded correct code is an ordinary mismatch against the
    // successor — durable MATCH_READY is impossible either way.
    expect(rPresent.result.outcome, "never MATCH_READY for a superseded code").not.toBe("MATCH_READY");
    expect(rPresent.result.outcome).toBe("FAILED_PRESENTATION");
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE E — successive replacement lineage A -> B -> C (serial + race).
  // -----------------------------------------------------------------------

  it("E: A expired into B, then two concurrent replacements of B — exactly one C, one clean chain", async () => {
    const assignment = fixture.assignments.e;
    const codeA = await issueCode(assignment, `xrace-e-issue-a-${RUN}`);
    const rB = await raceReplace(codeA, assignment, `xrace-e-replace-b-${RUN}`, Promise.resolve());
    expect(rB.error).toBeNull();
    expect(rB.result.outcome, "B replaces A serially").toBe("ISSUED");
    const codeB: IssuedCode = {
      id: String(rB.result.provisioning_code_id),
      raw: String(rB.result.code),
      expiresAt: String(rB.result.expires_at),
    };
    expect(rB.result.replaces_provisioning_code_id).toBe(codeA.id);

    // True barrier race: two different new keys against the overdue B.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = raceReplace(codeB, assignment, `xrace-e-replace-c1-${RUN}`, gate);
    const second = raceReplace(codeB, assignment, `xrace-e-replace-c2-${RUN}`, gate);
    release();
    const [r1, r2] = await Promise.all([first, second]);
    console.log(`race E backends: racer1 pid=${r1.pid}, racer2 pid=${r2.pid}, serial-B pid=${rB.pid}`);
    expect(r1.pid).not.toBe(r2.pid);
    expectNoUncontrolled(r1, r2);

    const outcomes = [String(r1.result.outcome), String(r2.result.outcome)].sort();
    expect(outcomes, "exactly one C is created").toEqual(["ISSUED", "OUTSTANDING"]);

    const rows = await codeRows(assignment);
    expect(rows.length, "A, B and exactly one C").toBe(3);
    const rowA = rows.find((row) => row.id === codeA.id);
    const rowB = rows.find((row) => row.id === codeB.id);
    const rowC = rows.find((row) => row.id !== codeA.id && row.id !== codeB.id);
    expect(rowA?.state, "A remains EXPIRED").toBe("expired");
    expect(rowA?.replaces_provisioning_code_id, "A is the chain head").toBeNull();
    expect(rowB?.state, "B becomes EXPIRED").toBe("expired");
    expect(rowB?.replaces_provisioning_code_id, "B replaces A").toBe(codeA.id);
    expect(rowC?.state, "C is the one outstanding code").toBe("issued");
    expect(rowC?.replaces_provisioning_code_id, "C replaces B").toBe(codeB.id);
    expect(rowC?.id, "no self-reference").not.toBe(rowC?.replaces_provisioning_code_id);

    expect(rows.filter((row) => row.replaces_provisioning_code_id === codeA.id).length,
      "no direct second successor of A").toBe(1);
    expect(rows.filter((row) => row.replaces_provisioning_code_id === codeB.id).length,
      "exactly one successor of B").toBe(1);

    expect(await eventCount(codeA.id, "EXPIRED"), "one EXPIRED event for A").toBe(1);
    expect(await eventCount(codeB.id, "EXPIRED"), "one EXPIRED event for B").toBe(1);
    expect(await eventCount(codeA.id, "CREATED"), "one CREATED event for A").toBe(1);
    expect(await eventCount(codeB.id, "CREATED"), "one CREATED event for B").toBe(1);
    expect(await eventCount(String(rowC?.id), "CREATED"), "one CREATED event for C").toBe(1);

    // Raw-code census on event residue: no event detail may contain a raw
    // code or a digest of any chain member.
    const secrets = [codeA.raw, codeB.raw, rowA?.code_digest ?? "", rowB?.code_digest ?? "", rowC?.code_digest ?? ""];
    for (const codeId of [codeA.id, codeB.id, String(rowC?.id)]) {
      for (const event of await eventRows(codeId)) {
        const text = JSON.stringify(event.detail ?? {});
        for (const secret of secrets) {
          expect(text.includes(secret), `event residue must not contain secret material`).toBe(false);
        }
      }
    }
  }, 90_000);

  // -----------------------------------------------------------------------
  // HOSTILE — runtime-role denials and constraint-layer lineage proofs.
  // -----------------------------------------------------------------------

  it("H1: runtime identities cannot write lineage, force EXPIRED, create successors or call the helper", async () => {
    // The door's signature carries NO lineage parameter: callers cannot
    // supply replaces_provisioning_code_id through the governed path.
    const { rows: args } = await keeper.query<{ args: string }>(
      `select pg_get_function_arguments(p.oid) as args from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_code_v1'`,
    );
    expect(args[0]?.args).not.toContain("replaces");

    const client = await keeper.connect();
    try {
      const attacks: Array<{ label: string; sql: string }> = [
        {
          label: "direct INSERT with caller-supplied lineage",
          sql: `insert into kitluy_devices.device_provisioning_codes
                  (id, tenant_id, digital_store_id, store_location_id, store_hub_device_id,
                   terminal_device_id, terminal_assignment_id, terminal_profile_key, environment,
                   code_digest, payload_sha256, created_at, expires_at, issued_by_operator_ref,
                   correlation_id, idempotency_key, replaces_provisioning_code_id)
                values (gen_random_uuid(), '${TENANT}', '${STORE}', '${LOCATION}', gen_random_uuid(),
                        gen_random_uuid(), '${fixture.assignments.h}', 'laundry.t1.cashier', 'development',
                        'aa', 'bb', now(), now() + interval '15 minutes', 'attacker',
                        gen_random_uuid(), 'hostile-${RUN}', gen_random_uuid())`,
        },
        {
          label: "direct UPDATE of the lineage column",
          sql: `update kitluy_devices.device_provisioning_codes
                   set replaces_provisioning_code_id = gen_random_uuid() where false`,
        },
        {
          label: "direct UPDATE forcing EXPIRED",
          sql: `update kitluy_devices.device_provisioning_codes set state = 'expired' where false`,
        },
        {
          label: "direct INSERT of a fabricated event",
          sql: `insert into kitluy_devices.device_provisioning_code_events
                  (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
                   event_type, actor_type)
                values (gen_random_uuid(), '${TENANT}', '${STORE}', '${LOCATION}', 'development',
                        'EXPIRED', 'OPERATOR')`,
        },
        {
          label: "direct EXECUTE of the canonical expiration helper",
          sql: `select kitluy_devices.expire_terminal_provisioning_code_v1(
                  gen_random_uuid(), gen_random_uuid(), 'HOSTILE', 'OPERATOR', 'attacker')`,
        },
      ];
      // Each probe runs in its OWN transaction: a denied statement aborts its
      // transaction in PostgreSQL, so sharing one would mask every later
      // probe behind 25P02 instead of the real 42501.
      for (const attack of attacks) {
        await client.query("begin");
        await client.query(`select set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
        ]);
        await client.query("set local role authenticated");
        const denied = await client.query(attack.sql).then(
          () => null,
          (error: { code?: string; message?: string }) => error,
        );
        await client.query("rollback").catch(() => undefined);
        expect(denied, `${attack.label} must be denied`).not.toBeNull();
        expect(denied?.code, `${attack.label}: insufficient_privilege, not a table error`).toBe("42501");
        console.log(`hostile runtime probe "${attack.label}" denied with SQLSTATE ${denied?.code}`);
      }
    } finally {
      client.release();
    }
  }, 60_000);

  it("H2: constraint layer — self-reference, second successor and every cross-scope lineage is denied", async () => {
    const assignment = fixture.assignments.h;
    const { rows: scopeRows } = await keeper.query<{
      tenant_id: string;
      digital_store_id: string;
      store_location_id: string;
      store_hub_device_id: string;
      terminal_device_id: string;
      terminal_profile_key: string;
    }>(
      `select c.tenant_id, c.digital_store_id, c.store_location_id, c.store_hub_device_id,
              c.terminal_device_id, c.terminal_profile_key
         from kitluy_devices.device_provisioning_codes c
        where c.terminal_assignment_id = $1::uuid order by c.created_at limit 1`,
      [fixture.assignments.a1],
    );
    const scope = scopeRows[0];
    expect(scope).toBeDefined();
    const { rows: expiredElsewhere } = await keeper.query<{ id: string }>(
      `select id from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid and state = 'expired' order by created_at limit 1`,
      [fixture.assignments.e],
    );
    const foreignExpired = expiredElsewhere[0]?.id;
    expect(foreignExpired).toBeDefined();
    const { rows: a1Predecessor } = await keeper.query<{ id: string }>(
      `select replaces_provisioning_code_id as id from kitluy_devices.device_provisioning_codes
        where terminal_assignment_id = $1::uuid and replaces_provisioning_code_id is not null limit 1`,
      [fixture.assignments.a1],
    );
    const alreadySucceeded = a1Predecessor[0]?.id;
    expect(alreadySucceeded).toBeDefined();

    // The constraint layer is proven from inside the DEFINER authority: the
    // harness borrows the NOLOGIN governor membership exactly as migrations
    // 0125-0167 do on apply, exercises the trigger and the unique index, and
    // hands the membership back in `finally` (the census below then proves
    // zero residue). Runtime-role denials were already proven in H1 — this
    // borrow is never claimed as runtime proof.
    await keeper.query("grant kitluy_activation_governor to postgres");
    try {

    async function insertHostile(overrides: Record<string, string>): Promise<{ code?: string; message?: string } | null> {
      const base: Record<string, string> = {
        id: "gen_random_uuid()",
        tenant_id: `'${TENANT}'`,
        digital_store_id: `'${STORE}'`,
        store_location_id: `'${LOCATION}'`,
        store_hub_device_id: `(select store_hub_device_id from kitluy_devices.device_provisioning_codes where terminal_assignment_id = '${fixture.assignments.a1}' limit 1)`,
        terminal_device_id: `'${fixture.terminals.h}'`,
        terminal_assignment_id: `'${assignment}'`,
        terminal_profile_key: `'laundry.t1.cashier'`,
        environment: `'development'`,
        state: `'issued'`,
        replaces: "null",
      };
      const merged = { ...base, ...overrides };
      const sql = `insert into kitluy_devices.device_provisioning_codes
        (id, tenant_id, digital_store_id, store_location_id, store_hub_device_id,
         terminal_device_id, terminal_assignment_id, terminal_profile_key, environment,
         code_digest, payload_sha256, created_at, expires_at, issued_by_operator_ref,
         correlation_id, idempotency_key, state, replaces_provisioning_code_id)
        values (${merged.id}, ${merged.tenant_id}, ${merged.digital_store_id}, ${merged.store_location_id},
                ${merged.store_hub_device_id}, ${merged.terminal_device_id}, ${merged.terminal_assignment_id},
                ${merged.terminal_profile_key}, ${merged.environment}, '${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}',
                '${randomUUID().replace(/-/g, "")}${randomUUID().replace(/-/g, "")}', now(), now() + interval '15 minutes', 'hostile',
                gen_random_uuid(), 'hostile-${RUN}-${randomUUID()}', ${merged.state}, ${merged.replaces})`;
      return await keeper.query(sql).then(
        () => null,
        (error: { code?: string; message?: string }) => error,
      );
    }

    // Self-reference is denied (governed trigger or the no-self check).
    const selfId = randomUUID();
    const self = await insertHostile({ id: `'${selfId}'`, replaces: `'${selfId}'` });
    expect(self, "self-reference must be denied").not.toBeNull();
    console.log(`hostile self-reference denied: ${self?.code} ${(self?.message ?? "").slice(0, 80)}`);

    // A direct second successor of an already-succeeded predecessor is denied.
    const second = await insertHostile({
      terminal_device_id: `'${fixture.terminals.a1}'`,
      terminal_assignment_id: `'${fixture.assignments.a1}'`,
      terminal_profile_key: `(select terminal_profile_key from kitluy_devices.device_terminal_assignments where id = '${fixture.assignments.a1}')`,
      store_hub_device_id: `(select store_hub_device_id from kitluy_devices.device_provisioning_codes where terminal_assignment_id = '${fixture.assignments.a1}' and state = 'issued' limit 1)`,
      state: `'expired'`,
      replaces: `'${alreadySucceeded}'`,
    });
    expect(second, "a second direct successor must be denied").not.toBeNull();
    expect(second?.code, "the one-successor unique index is the backstop").toBe("23505");
    console.log(`hostile second-successor denied: ${second?.code}`);

    // Cross-assignment predecessor link is denied by the lineage rule.
    const crossAssignment = await insertHostile({ replaces: `'${foreignExpired}'` });
    expect(crossAssignment, "cross-assignment lineage must be denied").not.toBeNull();
    expect(crossAssignment?.message).toContain("KLUY-PROVCODE-");

    // Every other cross-scope fabrication is denied by a governed KLUY error
    // (scope-consistency, Hub binding or lineage), never silently accepted.
    const variants: Array<[string, Record<string, string>]> = [
      ["cross-tenant", { tenant_id: `'${randomUUID()}'`, replaces: `'${foreignExpired}'` }],
      ["cross-store", { digital_store_id: `'${randomUUID()}'`, replaces: `'${foreignExpired}'` }],
      ["cross-location", { store_location_id: `'${randomUUID()}'`, replaces: `'${foreignExpired}'` }],
      ["cross-hub", { store_hub_device_id: `'${randomUUID()}'`, replaces: `'${foreignExpired}'` }],
      ["cross-profile", { terminal_profile_key: `'laundry.t9.ghost'`, replaces: `'${foreignExpired}'` }],
      ["cross-environment", { environment: `'production'`, replaces: `'${foreignExpired}'` }],
    ];
    for (const [label, overrides] of variants) {
      const denied = await insertHostile(overrides);
      expect(denied, `${label} lineage must be denied`).not.toBeNull();
      expect(denied?.message, `${label}: a governed KLUY refusal, never a silent accept`).toContain(
        "KLUY-PROVCODE-",
      );
      console.log(`hostile ${label} denied: ${denied?.code} ${(denied?.message ?? "").slice(0, 72)}`);
    }
    } finally {
      await keeper.query("revoke kitluy_activation_governor from postgres").catch(() => undefined);
    }

    // No broad owner membership and no login-capable member of the NOLOGIN
    // definer authorities (the sanctioned harness borrow lives only inside
    // this suite and is revoked in afterAll; the post-suite verification
    // census proves zero residue including the harness).
    const { rows: members } = await keeper.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members m
         join pg_roles r on r.oid = m.member
        where m.roleid in (select oid from pg_roles where rolname in
              ('kitluy_activation_governor', 'kitluy_governor_reader'))
          and r.rolcanlogin`,
    );
    expect(Number(members[0]?.n ?? -1), "no login-capable role holds a NOLOGIN authority").toBe(0);
  }, 60_000);

  // -----------------------------------------------------------------------
  // RACE D — replacement versus governed Hub deactivation (0121 door).
  // -----------------------------------------------------------------------

  it("D1: replacement commits while the Hub is authoritatively active — evidence survives the later transition", async () => {
    const assignment = fixture.assignments.d1;
    const code = await issueCode(assignment, `xrace-d1-issue-${RUN}`);
    const replace = raceReplace(code, assignment, `xrace-d1-replace-${RUN}`, barrier(0));
    const hubRevoke = raceHubRevoke(fixture.hubD1, barrier(STAGGER_MS));
    const [rReplace, rHub] = await Promise.all([replace, hubRevoke]);
    console.log(`race D1 backends: replacement pid=${rReplace.pid}, hub-transition pid=${rHub.pid}`);
    expect(rReplace.pid).not.toBe(rHub.pid);
    expectNoUncontrolled(rReplace, rHub);

    expect(rReplace.result.outcome, "the gate saw an authoritatively active Hub").toBe("ISSUED");
    expect(rHub.result.outcome, "the governed 0121 transition ran").toBe("ASSIGNMENT_REVOKED");

    // Later Hub deactivation never rewrites historical issuance evidence.
    const rows = await codeRows(assignment);
    const predecessor = rows.find((row) => row.id === code.id);
    const successor = rows.find((row) => row.id !== code.id);
    expect(predecessor?.state).toBe("expired");
    expect(successor?.state, "the successor binds the Hub state valid at its commit").toBe("issued");
    expect(successor?.replaces_provisioning_code_id).toBe(code.id);
    expect(await eventCount(code.id, "EXPIRED"), "the EXPIRED evidence stands").toBe(1);
    expect(await eventCount(String(successor?.id), "CREATED"), "the CREATED evidence stands").toBe(1);

    // Follow-on terminal provisioning revalidates Hub eligibility: with the
    // projection withdrawn (hub 2 enrolled but NOT yet activated), the door
    // must fail closed.
    const client = await keeper.connect();
    try {
      await client.query("begin");
      await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
        new Date(Date.now() + 20 * 60 * 1000).toISOString(),
      ]);
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: fixture.operator, role: "authenticated" }),
      ]);
      await client.query("set local role authenticated");
      const { rows: follow } = await client.query<{ result: Record<string, unknown> }>(
        `select kitluy_devices.issue_terminal_provisioning_code_v1($1::uuid, $2, null) as result`,
        [assignment, `xrace-d1-followup-${RUN}`],
      );
      await client.query("commit");
      expect(follow[0]?.result.outcome, "follow-on issuance revalidates Hub eligibility").toBe(
        "ISSUANCE_REFUSED",
      );
      expect(follow[0]?.result.refusal_code).toBe("KLUY-PROVCODE-HUB-INACTIVE");
      expect(follow[0]?.result.code, "a refusal never returns a raw code").toBeUndefined();
    } finally {
      client.release();
    }
    const after = await codeRows(assignment);
    expect(after.length, "no partial expiration and no new row without an active Hub").toBe(2);
    expect(after.find((row) => row.id === code.id)?.state, "predecessor remains exactly EXPIRED").toBe("expired");
  }, 60_000);

  it("D2: Hub ineligible before the replacement's validation — fail closed, no successor, no partial expiration", async () => {
    // Activate hub 2 only now (D1's follow-on check needed zero projections).
    await activateHub(fixture.hubD2, `SERIAL-XRACE-HUBD2-${RUN}-${randomUUID()}`);
    const assignment = fixture.assignments.d2;
    const code = await issueCode(assignment, `xrace-d2-issue-${RUN}`);

    const hubRevoke = raceHubRevoke(fixture.hubD2, barrier(0));
    const replace = raceReplace(code, assignment, `xrace-d2-replace-${RUN}`, barrier(STAGGER_MS));
    const [rHub, rReplace] = await Promise.all([hubRevoke, replace]);
    console.log(`race D2 backends: hub-transition pid=${rHub.pid}, replacement pid=${rReplace.pid}`);
    expect(rHub.pid).not.toBe(rReplace.pid);
    expectNoUncontrolled(rHub, rReplace);

    expect(rHub.result.outcome, "the governed 0121 transition committed first").toBe("ASSIGNMENT_REVOKED");
    expect(rReplace.result.outcome, "the replacement fails closed").toBe("ISSUANCE_REFUSED");
    expect(rReplace.result.refusal_code).toBe("KLUY-PROVCODE-HUB-INACTIVE");
    expect(rReplace.result.code, "no raw-code return on a refusal").toBeUndefined();

    const rows = await codeRows(assignment);
    expect(rows.length, "no successor was created").toBe(1);
    const predecessor = rows[0];
    expect(predecessor?.id).toBe(code.id);
    expect(predecessor?.state, "no partial expiration without a valid replacement").toBe("issued");
    expect(await eventCount(code.id, "EXPIRED"), "no EXPIRED event").toBe(0);
    expect(await eventCount(code.id, "CREATED"), "only the predecessor's own CREATED event").toBe(1);
  }, 60_000);
});
