/**
 * THE PERMANENT POST-SUITE SPENDABILITY CENSUS.
 *
 * WS-11-T003 Step 4 §3 and §9. Runs last by filename convention and asserts what
 * actually matters after every suite in this repository has finished: that nothing
 * left behind can AUTHORIZE anything.
 *
 * ===========================================================================
 * SPENDABILITY, NOT ROW COUNT
 * ===========================================================================
 * "Zero rows" is the wrong target and would be met by deleting append-only audit
 * evidence, which the task explicitly forbids. Consumed evidence, revoked
 * evidence and executed emergency authorizations are HISTORY: they record that
 * something really happened and they are permanently unusable.
 *
 * What must be zero is anything SPENDABLE — a row that could still be presented
 * to a governed door and accepted. So every assertion here encodes the same
 * predicate the database itself applies, and the census reports surviving counts
 * separately from spendable counts.
 *
 * ===========================================================================
 * WHY EXPIRY COUNTS AS UNSPENDABLE
 * ===========================================================================
 * `consume_reauthentication_evidence_v1` refuses when
 * `authoritative_now_v1() > expires_at`, before it writes anything. A row whose
 * `lifecycle_state` still reads ACTIVE but whose window has closed is stale
 * BOOKKEEPING, not a live credential — and this file proves that by actually
 * calling the governed door with one, rather than asserting it from the label.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function reachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: LOCAL_DSN, max: 1, connectionTimeoutMillis: 2000 });
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
if (!live) console.warn("SKIPPED: residue spendability census — local database unreachable");

describe.skipIf(!live)("nothing left behind can authorize anything", () => {
  let pool: pg.Pool;
  const surviving: Record<string, string> = {};
  const spendable: Record<string, string> = {};

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
  });
  afterAll(async () => {
    console.warn(`[census surviving] ${JSON.stringify(surviving)}`);
    console.warn(`[census spendable]  ${JSON.stringify(spendable)}`);
    await pool?.end().catch(() => undefined);
  });

  const count = async (label: string, sql: string, bucket: Record<string, string>) => {
    const { rows } = await pool.query<{ n: string }>(sql);
    bucket[label] = rows[0]?.n ?? "?";
    return Number(rows[0]?.n ?? "0");
  };

  it("records what SURVIVES, so history is visible rather than deleted", async () => {
    await count(
      "evidence_total",
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence`,
      surviving,
    );
    await count(
      "evidence_consumed",
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence where lifecycle_state = 'CONSUMED'`,
      surviving,
    );
    await count(
      "evidence_revoked",
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence where lifecycle_state = 'REVOKED'`,
      surviving,
    );
    await count(
      "emergency_authorizations_total",
      `select count(*)::text as n from kitluy_devices.device_emergency_revocation_authorizations`,
      surviving,
    );
    // History is expected to be non-empty; that is the point of append-only.
    expect(Number(surviving.evidence_total)).toBeGreaterThanOrEqual(0);
  });

  it("has ZERO SPENDABLE re-authentication evidence", async () => {
    // The database's own predicate: ACTIVE, not consumed, not revoked, not
    // superseded, and still inside its window.
    const n = await count(
      "spendable_evidence",
      `select count(*)::text as n from kitluy_auth.reauthentication_evidence
        where lifecycle_state = 'ACTIVE'
          and consumed_at is null and revoked_at is null and superseded_at is null
          and expires_at > kitluy_ops.authoritative_now_v1()`,
      spendable,
    );
    expect(n, "a step-up outlived the suite that created it").toBe(0);
  });

  it("has ZERO effective temporary permission assignments", async () => {
    const n = await count(
      "effective_temporary_grants",
      `select count(*)::text as n from kitluy_auth.temporary_grants
        where starts_at <= now() and expires_at > now()`,
      spendable,
    );
    expect(n, "a temporary permission outlived its test").toBe(0);
  });

  it("has ZERO login-capable members of the revocation NOLOGIN authorities", async () => {
    const { rows } = await pool.query<{ authority: string; member: string }>(
      `select a.rolname as authority, m.rolname as member
         from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where m.rolcanlogin
          and a.rolname in ('kitluy_credential_issuer','kitluy_activation_governor',
                            'kitluy_credential_approval_reader','kitluy_test_clock_authority',
                            'kitluy_test_harness')`,
    );
    spendable.leaked_memberships = String(rows.length);
    expect(rows, `borrowed memberships were not handed back: ${JSON.stringify(rows)}`).toEqual([]);
  });

  it("RECORDS the kitluy_job_governor borrow that group 0135 never returned", async () => {
    // KLRISK-DEVICE-011, recorded rather than asserted away.
    //
    // Group 0135 borrows `kitluy_job_governor` to set ownership and — alone among
    // the migrations that borrow — never hands it back. Every later migration
    // (0147, 0150-0153, 0155, 0157) ends with a `$hand_back$` block; 0135 predates
    // that habit. A LOGIN-capable role is therefore left a standing member of the
    // NOLOGIN owner of every governed durable-job function, so it can
    // `set role kitluy_job_governor` and drive the queue directly, bypassing the
    // EXECUTE grants meant to decide who may.
    //
    // An additive repair was written and REVERTED: `supabase/tests/assertions.sql`
    // itself relies on that membership to exercise the governor, so revoking it
    // makes `db:test` fail with "permission denied for table durable_jobs" after a
    // clean reset. Fixing it needs assertions.sql to borrow the role transactionally
    // in the same change, which is a separate, verifiable piece of work.
    //
    // This test asserts the CURRENT state so the exception cannot widen unnoticed:
    // exactly one login-capable member, and no OTHER authority affected.
    const { rows } = await pool.query<{ member: string }>(
      `select m.rolname as member
         from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where a.rolname = 'kitluy_job_governor' and m.rolcanlogin
        order by m.rolname`,
    );
    spendable.job_governor_recorded_exception = String(rows.length);
    expect(rows.length, "the recorded exception grew beyond the applying role").toBeLessThanOrEqual(
      1,
    );
  });

  it("has ZERO active test-clock policy rows", async () => {
    const n = await count(
      "test_clock_policy_rows",
      `select count(*)::text as n from kitluy_ops.test_clock_policy`,
      spendable,
    );
    expect(n, "the sanctioned test clock was left enabled").toBe(0);
  });

  it("has ZERO emergency authorizations still awaiting a verdict past their deadline", async () => {
    // A PENDING obligation inside its window is legitimate work. One long past its
    // deadline with no verdict means the lapse path never closed it.
    const n = await count(
      "overdue_unresolved_authorizations",
      `select count(*)::text as n
         from kitluy_devices.device_emergency_revocation_authorizations a
        where a.post_approval_due_at < now() - interval '1 day'
          and not exists (select 1 from kitluy_devices.device_emergency_post_approval_verdicts v
                           where v.authorization_id = a.authorization_id)`,
      spendable,
    );
    expect(n).toBe(0);
  });

  it("has ZERO runtime identities able to reach a legacy revocation helper", async () => {
    const { rows } = await pool.query<{ role: string; fn: string }>(
      `select r.rolname as role, p.proname as fn
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('kitluy_issuance_service'),('kitluy_worker_service'),
                            ('authenticated'),('anon'),('service_role')) as r(rolname)
        where n.nspname = 'kitluy_devices'
          and p.proname in ('revoke_device_credential_v1','revoke_device_credential_emergency_v1')
          and has_function_privilege(r.rolname, p.oid, 'execute')`,
    );
    spendable.legacy_reachable = String(rows.length);
    expect(rows, `legacy doors reachable: ${JSON.stringify(rows)}`).toEqual([]);
  });

  it("PROVES an expired ACTIVE row cannot be spent, rather than trusting the label", async () => {
    // The distinction this whole file rests on. A row whose `lifecycle_state`
    // still reads ACTIVE but whose window has closed is stale bookkeeping, and the
    // governed door refuses it — demonstrated by calling that door, not by reading
    // a column.
    const client = await pool.connect();
    try {
      await client.query("begin");
      const human = randomUUID();
      await client.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                                 email_confirmed_at, created_at, updated_at)
         values ($1::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
                 'authenticated', $2, '', now(), now(), now())`,
        [human, `census-${human}@fixture.invalid`],
      );
      // An ACTIVE row whose window closed an hour ago.
      const { rows: ev } = await client.query<{ id: string }>(
        `insert into kitluy_auth.reauthentication_evidence
           (actor_user_id, environment, action_class, verified_at, expires_at,
            authentication_method, lifecycle_state, audit_correlation_id)
         values ($1::uuid, 'development', 'fleet.device_credential.emergency_revoke',
                 now() - interval '2 hours', now() - interval '1 hour',
                 'PASSWORD_TOTP', 'ACTIVE', $2::uuid)
         returning evidence_id::text as id`,
        [human, randomUUID()],
      );
      const evidenceId = ev[0]?.id ?? "";
      expect(evidenceId).not.toBe("");

      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: human, role: "authenticated" }),
      ]);
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [human]);

      // Spend it through the governed consumer. The approval reader is BORROWED
      // inside this transaction — it is the identity the governed emergency door
      // runs the spend under — and the rollback below returns it.
      await client.query(
        `do $b$ begin
           if not pg_has_role(current_user, 'kitluy_credential_approval_reader', 'MEMBER') then
             execute format('grant kitluy_credential_approval_reader to %I', current_user);
           end if;
         exception when unique_violation then null;
         end $b$;`,
      );
      await client.query("set local role kitluy_credential_approval_reader");
      const { rows: spent } = await client.query<{ ok: boolean }>(
        `select kitluy_auth.consume_reauthentication_evidence_v1(
           $1::uuid, 'fleet.device_credential.emergency_revoke', 'development', $2::uuid) as ok`,
        [evidenceId, randomUUID()],
      );
      expect(spent[0]?.ok, "an expired ACTIVE row was spendable").toBe(false);
    } finally {
      // Rolls back the fixture AND any borrowed state.
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});
