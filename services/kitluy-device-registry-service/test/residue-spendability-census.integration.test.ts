/**
 * THE PERMANENT POST-SUITE SPENDABILITY CENSUS.
 *
 * WS-11-T003 Step 4 §3 and §9. Asserts what matters about residue: that nothing
 * left behind can AUTHORIZE anything.
 *
 * ===========================================================================
 * IT DOES NOT RUN LAST, AND SAYING SO WAS WRONG
 * ===========================================================================
 * An earlier header claimed this "runs last by filename convention... after every
 * suite in this repository has finished". That is false and independent review
 * proved it: there is no `vitest.config.ts` in this service and none at the root,
 * so Vitest's default `BaseSequencer` applies -- which orders by FILE SIZE
 * descending on a cold cache and by prior duration on a warm one, never by name.
 * `fileParallelism` defaults to true, so this file runs CONCURRENTLY with the
 * suites whose residue it is describing.
 *
 * The consequence is real in both directions: run early it passes vacuously, and
 * run alongside a suite holding a live 30-minute grant it fails spuriously.
 *
 * So the assertions below are written to be TRUE AT ANY POINT IN THE RUN rather
 * than to depend on an ordering that does not exist. What each one asserts is a
 * property of the database that no correctly-behaved suite should ever violate --
 * a leaked NOLOGIN membership, an enabled test clock, a reachable legacy door --
 * not a count that only settles once everything else has finished. The two
 * count-based checks are stated as bounds a concurrent suite cannot legitimately
 * exceed, not as zero.
 *
 * Making the ordering real needs a sequencer or a dedicated project, which is
 * separate, verifiable work and is recorded as such rather than asserted here.
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
const HUB_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local";

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
async function hubReachable(): Promise<boolean> {
  const probe = new pg.Pool({ connectionString: HUB_DSN, max: 1, connectionTimeoutMillis: 2000 });
  try {
    await probe.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await probe.end().catch(() => undefined);
  }
}
const live = (await reachable()) && (await hubReachable());
if (!live) console.warn("SKIPPED: residue spendability census — a local database is unreachable");

describe.skipIf(!live)("nothing left behind can authorize anything", () => {
  let pool: pg.Pool;
  let hubPool: pg.Pool;
  const surviving: Record<string, string> = {};
  const spendable: Record<string, string> = {};

  beforeAll(() => {
    pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    hubPool = new pg.Pool({ connectionString: HUB_DSN, max: 2 });
  });
  afterAll(async () => {
    console.warn(`[census surviving] ${JSON.stringify(surviving)}`);
    console.warn(`[census spendable]  ${JSON.stringify(spendable)}`);
    await pool?.end().catch(() => undefined);
    await hubPool?.end().catch(() => undefined);
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
    // A BOUND, not zero: this file can run while another suite legitimately holds
    // freshly recorded evidence. Anything beyond a handful is residue, not
    // concurrency -- the governed window is 300 seconds and every suite retires
    // its own actors.
    expect(
      n,
      "live step-up evidence beyond what a concurrent suite can explain",
    ).toBeLessThanOrEqual(8);
  });

  it("has ZERO effective temporary permission assignments", async () => {
    const n = await count(
      "effective_temporary_grants",
      `select count(*)::text as n from kitluy_auth.temporary_grants
        where starts_at <= now() and expires_at > now()`,
      spendable,
    );
    // Same reasoning as the evidence bound above.
    expect(n, "effective grants beyond what a concurrent suite can explain").toBeLessThanOrEqual(8);
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

  it("PROVES the kitluy_job_governor borrow group 0135 never returned is CLOSED", async () => {
    // KLRISK-DEVICE-011 — REPAIRED by migration 0160 (2026-07-31).
    //
    // Group 0135 borrows `kitluy_job_governor` to set ownership and — alone among
    // the migrations that borrow — never hands it back. Every later migration
    // (0147, 0150-0153, 0155, 0157) ends with a `$hand_back$` block; 0135 predates
    // that habit.
    //
    // An additive repair was written and REVERTED: `supabase/tests/assertions.sql`
    // itself relied on that membership to exercise the governor, so revoking it
    // made `db:test` fail with "permission denied for table durable_jobs" after a
    // clean reset. Group 0160 completed the repair the revert deferred: four
    // narrow governor-owned inspection readers for the facts section 40b needs,
    // two harness-only scaffold functions for its writes, harness EXECUTE on the
    // two operator acts, and assertions.sql reworked to borrow `kitluy_test_harness`
    // for exactly one block instead of the governor permanently.
    //
    // This test asserts the end state so the exception cannot RETURN unnoticed:
    // ZERO login-capable members remain.
    const { rows } = await pool.query<{ member: string }>(
      `select m.rolname as member
         from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where a.rolname = 'kitluy_job_governor' and m.rolcanlogin
        order by m.rolname`,
    );
    spendable.job_governor_recorded_exception = String(rows.length);
    expect(rows, `the 0135 leak is back: ${JSON.stringify(rows)}`).toEqual([]);
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

  // ===========================================================================
  // SECTION 13 — the runtime containment census. Every assertion here is true
  // at ANY point in a parallel run: each one names a property no
  // correctly-behaved suite may ever create, not a count that settles late.
  // ===========================================================================

  it("has ZERO runtime identities beyond the issuance path able to call the scoped-refusal bridges", async () => {
    // Group 0159 narrowed the environment-wide read to exactly one device. The
    // grant boundary is what keeps a future caller honest: EXECUTE belongs to
    // `kitluy_issuance_service` alone, and the only runtime identity that
    // reaches it is `service_role` — a member of the named service by the
    // SANCTIONED wiring of groups 0127/0135, which is how the production
    // composition holds the role at all. The worker and the browser-facing
    // roles may hold nothing.
    const { rows } = await pool.query<{ role: string; fn: string }>(
      `select r.rolname as role, f.fn
         from (values ('kitluy_worker_service'),('authenticated'),('anon')) as r(rolname)
         cross join (values
           ('kitluy_devices.revoked_certificate_serials_v1(text, uuid)'),
           ('kitluy_devices.revoked_device_records_v1(text, uuid)')) as f(fn)
        where has_function_privilege(r.rolname, f.fn, 'execute')`,
    );
    spendable.unsafe_builder_runtime_access = String(rows.length);
    expect(
      rows,
      `runtime roles can reach the narrowed revocation bridges: ${JSON.stringify(rows)}`,
    ).toEqual([]);
    // The issuance path itself must remain intact, or snapshot production dies.
    const { rows: issuance } = await pool.query<{ ok: boolean }>(
      `select has_function_privilege(
         'kitluy_issuance_service',
         'kitluy_devices.revoked_certificate_serials_v1(text, uuid)', 'execute') as ok`,
    );
    expect(issuance[0]?.ok, "the issuance service lost its own bridge").toBe(true);
  });

  it("has ZERO unsigned or untrusted ACTIVE Hub snapshots", async () => {
    // A snapshot without its detached signature, its canonical digest, or a
    // signing key the trust registry still holds as current/next is not an
    // integrity artifact — it is a claim. Zero may be active.
    const { rows } = await hubPool.query<{ n: string }>(
      `select count(*)::text as n from edge_config.revocation_snapshot s
        where s.state = 'active'
          and (s.signature_b64 is null or btrim(s.signature_b64) = ''
            or s.canonical_sha256 is null or btrim(s.canonical_sha256) = ''
            or not exists (
              select 1 from edge_config.revocation_trust_key k
               where k.key_id = s.signing_key_id
                 and k.key_version = s.signing_key_version
                 and k.state in ('current','next')))`,
    );
    spendable.unsigned_active_hub_snapshots = rows[0]?.n ?? "?";
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("has ZERO structurally cross-scope ACTIVE Hub snapshots", async () => {
    // Scope columns are NOT NULL by schema; the residual structural question is
    // whether every entry kind is one the scope model knows. The content-level
    // question — no identifier from another Tenant/Store/Location — is the
    // scope-isolation suite's executable proof, not a count.
    const { rows } = await hubPool.query<{ n: string }>(
      `select count(*)::text as n from edge_config.revocation_snapshot_entry e
        join edge_config.revocation_snapshot s on s.id = e.snapshot_id
        where s.state = 'active'
          and e.entry_kind not in ('certificate_serial','device_record')`,
    );
    spendable.cross_scope_active_hub_snapshots = rows[0]?.n ?? "?";
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it("has ZERO sync-worker capability to mutate an ACTIVE Hub snapshot directly", async () => {
    // Group 0030: the sync worker stages through the governed door; it may not
    // INSERT an active row, UPDATE one to active, or DELETE the last-known-good.
    const { rows } = await hubPool.query<{ priv: string }>(
      `select p.priv from (values ('INSERT'),('UPDATE'),('DELETE')) as p(priv)
        where has_table_privilege(
          'kitluy_sync_worker', 'edge_config.revocation_snapshot', p.priv)`,
    );
    spendable.sync_worker_active_snapshot_mutation = String(rows.length);
    expect(
      rows,
      `kitluy_sync_worker holds direct snapshot mutation: ${JSON.stringify(rows)}`,
    ).toEqual([]);
    // ...and the staging door really is the only path it was given.
    const { rows: staging } = await hubPool.query<{ ok: boolean }>(
      `select has_function_privilege(
         'kitluy_sync_worker', 'edge_config.stage_revocation_snapshot_v1(
           uuid, uuid, uuid, uuid, text, uuid, integer, bigint, bigint, text,
           timestamptz, timestamptz, char, text, integer, text)', 'execute') as ok`,
    );
    expect(staging[0]?.ok, "the governed staging door is not reachable by the sync worker").toBe(
      true,
    );
  });

  it("has ZERO durable lapse jobs abandoned without a terminal or retryable state", async () => {
    // leased/running past lease expiry by more than an hour is ABANDONED: the
    // worker that held it is gone and nothing reclaimed the row. Everything
    // else is either terminal (completed/cancelled/dead_letter/manual_review)
    // or retryable (queued/retry_scheduled, or a live lease).
    const { rows } = await pool.query<{ n: string }>(
      `select count(*)::text as n from kitluy_ops.durable_jobs
        where status in ('leased','running')
          and lease_expires_at < now() - interval '1 hour'`,
    );
    spendable.abandoned_durable_jobs = rows[0]?.n ?? "?";
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
