/**
 * HOSTILE tests for the sanctioned test clock.
 *
 * KLD-2026-07-31-SECURITY-TEST-CLOCK-001; migration group 0157;
 * WS-11-T003 Step 4 §2.
 *
 * A mechanism that can move authoritative time is the single most dangerous thing
 * added to this database, so this suite spends most of its effort trying to reach
 * it from identities that must not have it.
 *
 * EVERY test runs inside a transaction that ROLLS BACK. The policy row, the role
 * membership and the override are all catalog or table state and all
 * transactional, so nothing here can leave the clock enabled — which is checked
 * explicitly at the end.
 */
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOCAL_DSN = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DECISION = "KLD-2026-07-31-SECURITY-TEST-CLOCK-001";

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
if (!live) console.warn("SKIPPED: test-clock governance suite — local database unreachable");

describe.skipIf(!live)(
  "the sanctioned test clock cannot be reached by production identities",
  () => {
    let pool: pg.Pool;

    beforeAll(() => {
      pool = new pg.Pool({ connectionString: LOCAL_DSN, max: 4 });
    });
    afterAll(async () => {
      await pool?.end().catch(() => undefined);
    });

    /** Runs `fn` in a transaction that ALWAYS rolls back. */
    async function inRolledBack<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("begin");
        return await fn(client);
      } finally {
        await client.query("rollback").catch(() => undefined);
        client.release();
      }
    }

    /** Enables the clock for this transaction only, and becomes the harness. */
    async function asHarnessWithPolicy(client: pg.PoolClient): Promise<void> {
      await client.query(
        `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
       values ('test', 'test-clock-governance-suite', $1)`,
        [DECISION],
      );
      await client.query(
        `do $b$ begin execute format('grant kitluy_test_harness to %I', current_user); end $b$;`,
      );
      await client.query("set local role kitluy_test_harness");
    }

    it("returns REAL database time by default", async () => {
      const drift = await inRolledBack(async (client) => {
        const { rows } = await client.query<{ drift: string }>(
          `select abs(extract(epoch from (kitluy_ops.authoritative_now_v1() - clock_timestamp())))::text as drift`,
        );
        return Number(rows[0]?.drift ?? "999");
      });
      expect(drift).toBeLessThan(5);
    });

    it("lets the TEST HARNESS install a transaction-local override", async () => {
      const observed = await inRolledBack(async (client) => {
        await asHarnessWithPolicy(client);
        await client.query(`select kitluy_ops.test_clock_set_v1($1::timestamptz)`, [
          "2031-03-04T05:06:07.000Z",
        ]);
        const { rows } = await client.query<{ now: string }>(
          `select to_char(kitluy_ops.authoritative_now_v1() at time zone 'UTC','YYYY-MM-DD') as now`,
        );
        return rows[0]?.now;
      });
      expect(observed).toBe("2031-03-04");
    });

    it("the override DISAPPEARS when the transaction ends", async () => {
      await inRolledBack(async (client) => {
        await asHarnessWithPolicy(client);
        await client.query(`select kitluy_ops.test_clock_set_v1($1::timestamptz)`, [
          "2031-03-04T05:06:07.000Z",
        ]);
      });
      // A BRAND-NEW transaction on the same pool. `set_config(..., is_local => true)`
      // means the value cannot survive onto a pooled connection.
      const drift = await inRolledBack(async (client) => {
        const { rows } = await client.query<{ drift: string }>(
          `select abs(extract(epoch from (kitluy_ops.authoritative_now_v1() - clock_timestamp())))::text as drift`,
        );
        return Number(rows[0]?.drift ?? "999");
      });
      expect(drift).toBeLessThan(5);
    });

    it("REFUSES every runtime, service and human identity", async () => {
      for (const role of [
        "kitluy_issuance_service",
        "kitluy_worker_service",
        "authenticated",
        "anon",
        "service_role",
      ]) {
        const code = await inRolledBack(async (client) => {
          // The policy row EXISTS, so this is not "the clock is off" — it is the
          // grant refusing a role that must never install an override.
          await client.query(
            `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
           values ('test', 'hostile-probe', $1)`,
            [DECISION],
          );
          await client.query(`set local role ${role}`);
          try {
            await client.query(`select kitluy_ops.test_clock_set_v1(now())`);
            return "NOT_REFUSED";
          } catch (error) {
            return (error as { code?: string }).code ?? "UNKNOWN";
          }
        });
        expect(code, `${role} installed a clock override`).toBe("42501");
      }
    });

    it("REFUSES service_role even though it has broad database access", async () => {
      // service_role is globally BYPASSRLS. Row security is not what protects the
      // clock — a function EXECUTE grant is — so BYPASSRLS buys nothing here.
      const code = await inRolledBack(async (client) => {
        await client.query("set local role service_role");
        try {
          await client.query(`select kitluy_ops.test_clock_set_v1(now())`);
          return "NOT_REFUSED";
        } catch (error) {
          return (error as { code?: string }).code ?? "UNKNOWN";
        }
      });
      expect(code).toBe("42501");
    });

    it("is INERT with no policy row, even for the harness and even with a forged GUC", async () => {
      const result = await inRolledBack(async (client) => {
        await client.query(
          `do $b$ begin execute format('grant kitluy_test_harness to %I', current_user); end $b$;`,
        );
        await client.query("set local role kitluy_test_harness");

        // SAVEPOINT: the installer RAISES, which aborts the transaction and would
        // stop the forged-GUC probe below from running at all.
        let installerRefused = false;
        await client.query("savepoint probe_installer");
        try {
          await client.query(`select kitluy_ops.test_clock_set_v1(now())`);
          await client.query("release savepoint probe_installer");
        } catch {
          installerRefused = true;
          await client.query("rollback to savepoint probe_installer");
        }

        // The forged-GUC path: set the setting DIRECTLY, bypassing the helper.
        await client.query(`select set_config('kitluy.test_clock_instant', $1, true)`, [
          "1999-01-01T00:00:00.000000+00",
        ]);
        const { rows } = await client.query<{ year: string }>(
          `select to_char(kitluy_ops.authoritative_now_v1() at time zone 'UTC','YYYY') as year`,
        );
        return { installerRefused, year: rows[0]?.year };
      });
      expect(result.installerRefused).toBe(true);
      // A caller-set GUC cannot move time without the stored policy row.
      expect(result.year).not.toBe("1999");
    });

    it("honours the override ONLY for the test environment", async () => {
      // The CHECK constraint refuses any environment but `test`, so a policy row for
      // production or development cannot be written in the first place.
      for (const environment of ["production", "development", "pilot"]) {
        const code = await inRolledBack(async (client) => {
          try {
            await client.query(
              `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
             values ($1, 'hostile-probe', $2)`,
              [environment, DECISION],
            );
            return "NOT_REFUSED";
          } catch (error) {
            return (error as { code?: string }).code ?? "UNKNOWN";
          }
        });
        // 23514 check_violation.
        expect(code, `${environment} was accepted as a clock environment`).toBe("23514");
      }
    });

    it("refuses a policy row that does not cite the owner decision", async () => {
      const code = await inRolledBack(async (client) => {
        try {
          await client.query(
            `insert into kitluy_ops.test_clock_policy (environment, enabled_by, decision_ref)
           values ('test', 'hostile-probe', 'KLD-MADE-UP-001')`,
          );
          return "NOT_REFUSED";
        } catch (error) {
          return (error as { code?: string }).code ?? "UNKNOWN";
        }
      });
      expect(code).toBe("23514");
    });

    it("keeps both clock roles NOLOGIN, without BYPASSRLS and without login members", async () => {
      const { rows } = await pool.query<{
        rolname: string;
        rolcanlogin: boolean;
        rolbypassrls: boolean;
      }>(
        `select rolname, rolcanlogin, rolbypassrls from pg_roles
        where rolname in ('kitluy_test_clock_authority','kitluy_test_harness')`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.rolcanlogin, `${row.rolname} can log in`).toBe(false);
        expect(row.rolbypassrls, `${row.rolname} has BYPASSRLS`).toBe(false);
      }

      // And the migration handed its borrow back: no login-capable role holds the
      // authority, so nobody can SET ROLE to the owner of the installer.
      const { rows: members } = await pool.query<{ member: string; authority: string }>(
        `select m.rolname as member, a.rolname as authority
         from pg_auth_members am
         join pg_roles a on a.oid = am.roleid
         join pg_roles m on m.oid = am.member
        where a.rolname = 'kitluy_test_clock_authority' and m.rolcanlogin`,
      );
      expect(members, `login roles hold the clock authority: ${JSON.stringify(members)}`).toEqual(
        [],
      );
    });

    it("leaves the clock DISABLED and no override behind", async () => {
      // The load-bearing cleanup assertion: every test above rolled back, so the
      // policy table must still be empty and time must be real.
      const { rows } = await pool.query<{ n: string }>(
        `select count(*)::text as n from kitluy_ops.test_clock_policy`,
      );
      expect(rows[0]?.n).toBe("0");

      const { rows: drift } = await pool.query<{ drift: string }>(
        `select abs(extract(epoch from (kitluy_ops.authoritative_now_v1() - clock_timestamp())))::text as drift`,
      );
      expect(Number(drift[0]?.drift ?? "999")).toBeLessThan(5);
    });

    it("added NO clock parameter to any governed business RPC", async () => {
      // The rule the whole design rests on: a business RPC that accepted an instant
      // would let a caller decide when "now" is.
      const { rows } = await pool.query<{ sig: string }>(
        `select p.oid::regprocedure::text as sig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('kitluy_devices','kitluy_auth')
          and pg_get_function_arguments(p.oid) ~* '(p_now|p_clock|p_current_time|p_as_of|p_instant)'`,
      );
      expect(rows.map((r) => r.sig)).toEqual([]);
    });
  },
);
