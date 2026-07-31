/**
 * CAPABILITY CENSUS for the authoritative assignment readers.
 *
 * WS-11-T003 Step 4 §5. Catalog grants are not capability: group 0154 shipped a
 * real EXECUTE grant that was unusable for want of schema USAGE (RC-028), and a
 * previous session of mine published a defect that did not exist because a
 * diagnostic evaluated its own subselect in the caller's context.
 *
 * So every assertion here EXECUTES as the role under test. Nothing is inferred
 * from `pg_proc.proacl`, and `postgres` succeeding is never accepted as proof.
 */
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
if (!live) console.warn("SKIPPED: assignment capability census — local database unreachable");

/** The NOLOGIN definer owners. Neither may ever be loginable. */
const NOLOGIN_AUTHORITIES = ["kitluy_activation_governor", "kitluy_credential_issuer"] as const;
/** Roles a deployment actually connects as. */
const RUNTIME_ROLES = ["kitluy_issuance_service", "kitluy_worker_service"] as const;

describe.skipIf(!live)("the authoritative assignment readers, exercised as real callers", () => {
  let pool: pg.Pool;
  let hubDeviceId = "";

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    const { rows } = await pool.query<{ device_id: string }>(
      `select device_id::text as device_id from kitluy_devices.device_assignments
        where state in ('pending_trust','active') limit 1`,
    );
    hubDeviceId = rows[0]?.device_id ?? "";
    expect(hubDeviceId).not.toBe("");
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => undefined);
  });

  /**
   * Runs `sql` as `role` in a transaction that ALWAYS rolls back.
   *
   * The rollback matters twice: it discards any fixture, and `grant role` is
   * catalog state and catalog state is transactional, so nothing this file does
   * can leave a membership behind.
   */
  async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      const { rows } = await client.query(sql, params);
      return rows as T[];
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  }

  async function refusedAsRole(role: string, sql: string, params: unknown[] = []): Promise<string> {
    try {
      await asRole(role, sql, params);
      return "NOT_REFUSED";
    } catch (error) {
      return (error as { code?: string }).code ?? "UNKNOWN";
    }
  }

  it("the SNAPSHOT PRODUCER's identity can resolve a Hub scope", async () => {
    const rows = await asRole<{ result: Record<string, unknown> | null }>(
      "kitluy_issuance_service",
      `select kitluy_devices.hub_revocation_scope_v1($1::uuid) as result`,
      [hubDeviceId],
    );
    const scope = rows[0]?.result;
    expect(scope).not.toBeNull();
    expect(String(scope?.tenant_id ?? "")).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(scope?.digital_store_id ?? "")).toMatch(/^[0-9a-f-]{36}$/);
    expect(String(scope?.store_location_id ?? "")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the EMERGENCY path's effective identity can resolve tenancy", async () => {
    // The governed emergency RPC is owned by `kitluy_credential_issuer`, so THAT
    // is the effective role when the tenancy bridge is reached — not the human's
    // `authenticated`, and not `kitluy_issuance_service`.
    //
    // No login role may be a standing member of that authority (asserted below),
    // so the membership is BORROWED inside a transaction that rolls back. `grant
    // role` is catalog state and catalog state is transactional, so the rollback
    // returns it and nothing survives this test. This is the same discipline the
    // containment suites use, and it is why the borrow is not a contradiction of
    // the no-standing-membership assertion.
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        `do $borrow$ begin execute format('grant kitluy_credential_issuer to %I', current_user); end $borrow$;`,
      );
      await client.query("set local role kitluy_credential_issuer");
      const { rows } = await client.query<{ result: Record<string, unknown> | null }>(
        `select kitluy_devices.emergency_device_tenancy_v1($1::uuid) as result`,
        [hubDeviceId],
      );
      expect(rows[0]?.result).not.toBeNull();
      expect(String(rows[0]?.result?.tenant_id ?? "")).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      // Un-grants the borrow as well as discarding the read.
      await client.query("rollback").catch(() => undefined);
      client.release();
    }

    // And the borrow really is gone.
    const { rows: leaked } = await pool.query<{ n: string }>(
      `select count(*)::text as n from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where a.rolname = 'kitluy_credential_issuer' and m.rolcanlogin`,
    );
    expect(leaked[0]?.n).toBe("0");
  });

  it("DIRECT table access stays denied for every runtime role", async () => {
    for (const role of RUNTIME_ROLES) {
      for (const table of ["device_assignments", "device_credentials", "devices"]) {
        const code = await refusedAsRole(role, `select 1 from kitluy_devices.${table} limit 1`);
        expect(code, `${role} could read ${table}`).toBe("42501");
      }
    }
  });

  it("the tenancy bridge is NOT reachable by the snapshot producer's identity", async () => {
    // Least privilege, not a defect: issuance builds snapshots and has no business
    // in the emergency tenancy path.
    const code = await refusedAsRole(
      "kitluy_issuance_service",
      `select kitluy_devices.emergency_device_tenancy_v1($1::uuid)`,
      [hubDeviceId],
    );
    expect(code).toBe("42501");
  });

  it("the readers are NOT reachable by anon, authenticated or the worker", async () => {
    for (const role of ["anon", "authenticated", "kitluy_worker_service"]) {
      for (const fn of [
        `kitluy_devices.hub_revocation_scope_v1('${hubDeviceId}'::uuid)`,
        `kitluy_devices.revoked_serials_for_scope_v1(null,null,null,'development')`,
      ]) {
        const code = await refusedAsRole(role, `select ${fn}`);
        expect(code, `${role} reached ${fn}`).toBe("42501");
      }
    }
  });

  it("an ABSENT or NULL device yields no scope rather than someone else's", async () => {
    const absent = await asRole<{ result: unknown }>(
      "kitluy_issuance_service",
      `select kitluy_devices.hub_revocation_scope_v1('00000000-0000-4000-8000-0000000abcde'::uuid) as result`,
    );
    expect(absent[0]?.result).toBeNull();

    const nulled = await asRole<{ result: unknown }>(
      "kitluy_issuance_service",
      `select kitluy_devices.hub_revocation_scope_v1(null) as result`,
    );
    expect(nulled[0]?.result).toBeNull();
  });

  it("a SUPERSEDED or REVOKED assignment yields no scope", async () => {
    // Provisioning history must not scope a snapshot: a Hub would receive the
    // Store it used to belong to.
    const { rows } = await pool.query<{ device_id: string; state: string }>(
      `select device_id::text as device_id, state::text as state
         from kitluy_devices.device_assignments
        where state in ('superseded','revoked')
          and device_id not in (select device_id from kitluy_devices.device_assignments
                                 where state in ('pending_trust','active'))
        limit 1`,
    );
    const stale = rows[0];
    if (stale === undefined) return; // dataset has no such device
    const result = await asRole<{ result: unknown }>(
      "kitluy_issuance_service",
      `select kitluy_devices.hub_revocation_scope_v1($1::uuid) as result`,
      [stale.device_id],
    );
    expect(result[0]?.result, `a ${stale.state} assignment produced a scope`).toBeNull();
  });

  it("the NOLOGIN authorities cannot log in, and no login role may become them", async () => {
    const { rows } = await pool.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolbypassrls: boolean;
    }>(`select rolname, rolcanlogin, rolbypassrls from pg_roles where rolname = any($1::text[])`, [
      NOLOGIN_AUTHORITIES,
    ]);
    expect(rows).toHaveLength(NOLOGIN_AUTHORITIES.length);
    for (const row of rows) {
      expect(row.rolcanlogin, `${row.rolname} can log in`).toBe(false);
      // BYPASSRLS on a definer owner would silently defeat every RLS policy the
      // schema relies on.
      expect(row.rolbypassrls, `${row.rolname} has BYPASSRLS`).toBe(false);
    }

    // No LOGIN-capable role is a standing member of either authority. This is the
    // escalation that migration 0155 and my own test suites each reintroduced
    // once, so it is asserted rather than assumed.
    const { rows: members } = await pool.query<{ member: string; authority: string }>(
      `select m.rolname as member, a.rolname as authority
         from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where a.rolname = any($1::text[]) and m.rolcanlogin`,
      [NOLOGIN_AUTHORITIES],
    );
    expect(members, `login roles hold a NOLOGIN authority: ${JSON.stringify(members)}`).toEqual([]);
  });

  it("a runtime role cannot SET ROLE to a NOLOGIN authority", async () => {
    for (const runtime of RUNTIME_ROLES) {
      for (const authority of NOLOGIN_AUTHORITIES) {
        const code = await refusedAsRole(runtime, `set role ${authority}`);
        // Postgres reports `42501 insufficient_privilege` for a SET ROLE the
        // session is not a member of. Anything else — especially NOT_REFUSED —
        // would mean the governed owner is reachable from a connectable identity.
        expect(code, `${runtime} became ${authority}`).toBe("42501");
      }
    }
  });
});
