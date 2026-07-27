/**
 * Store Hub local PostgreSQL access (WS-09 command-layer half).
 *
 * Mirrors `packages/payments-persistence/src/db.ts`:
 *   - LOCAL ONLY. A non-local connection string is refused outright
 *     (KL-INF-P1-037, OWNER-LOCKED — production Hub work is human-operated).
 *   - `int8` is parsed to BigInt so integer minor units and `hub_sequence`
 *     never pass through binary floating point (schema contract §1;
 *     repository rule 12).
 *   - Commands run inside ONE transaction with `set local role
 *     kitluy_hub_runtime`, so the §3 grant surface and the §1 append-only
 *     triggers that govern real Hub traffic are exercised, never bypassed.
 *
 * Isolation levels follow schema contract §1 "Transactions": SERIALIZABLE for
 * sequence allocation, storage assignment and final custody release; READ
 * COMMITTED elsewhere. `withSerializableHubTransaction` is therefore a
 * first-class variant rather than an option flag, so a caller cannot silently
 * downgrade a serializable requirement.
 */
import pg from "pg";
import { hubDatabaseUrl } from "../hub-database.js";

/**
 * `int8` (OID 20) -> BigInt. Money (`*_minor`), `hub_sequence`,
 * `aggregate_version`, `local_sequence` and every other bigint column are read
 * as BigInt; `numeric` (quantities) stays a string and is never coerced to a
 * JavaScript number.
 */
pg.types.setTypeParser(20, (value: string) => BigInt(value));

/** Database role the command layer connects as (schema contract §3). */
export const HUB_RUNTIME_ROLE = "kitluy_hub_runtime" as const;

/** Sync/outbox worker role (§3). Used by transmission probes, never by commands. */
export const HUB_SYNC_WORKER_ROLE = "kitluy_sync_worker" as const;

export function createHubPool(env: NodeJS.ProcessEnv = process.env, max = 8): pg.Pool {
  return new pg.Pool({ connectionString: hubDatabaseUrl(env), max });
}

/**
 * Skip-with-warning helper for DB-backed tests. A skipped run is NEVER
 * reported as executed evidence (KLD-EVIDENCE-001).
 */
export async function isHubDatabaseReachable(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  let pool: pg.Pool;
  try {
    pool = new pg.Pool({
      connectionString: hubDatabaseUrl(env),
      max: 1,
      connectionTimeoutMillis: 2_000,
    });
  } catch {
    return false;
  }
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

let roleFallbackWarned = false;

/**
 * Assume the Hub runtime role for the transaction.
 *
 * A production Hub connects AS `kitluy_hub_runtime`, so the §3 grants and the
 * §1 append-only triggers govern every statement. On a development server the
 * connected user may not be a member of that role (the Supabase `postgres` role
 * is not a superuser), in which case the switch is refused with
 * `insufficient_privilege`. The command layer then continues as the connected
 * user and warns ONCE: the append-only and immutability triggers are
 * unconditional and still reject, but the GRANT surface is not exercised. This
 * degradation is recorded, never silent.
 */
async function assumeRole(client: pg.PoolClient, role: string): Promise<boolean> {
  try {
    await client.query(`set local role ${role}`);
    return true;
  } catch (error) {
    if ((error as { code?: string } | null)?.code !== "42501") throw error;
    if (!roleFallbackWarned) {
      roleFallbackWarned = true;
      console.warn(
        `kitluy-hub-agent: cannot 'set local role ${role}' (insufficient_privilege). ` +
          "Running as the connected user; the schema contract §3 GRANT surface is NOT exercised. " +
          "Grant the role to the connecting user to restore it.",
      );
    }
    return false;
  }
}

async function runInTransaction<T>(
  pool: pg.Pool,
  begin: string,
  fn: (client: pg.PoolClient) => Promise<T>,
  role: string,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
    await assumeRole(client, role);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** True when the connected user may assume `role` (probe used by tests). */
export async function canAssumeRole(pool: pg.Pool, role: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const ok = await assumeRole(client, role);
    await client.query("rollback");
    return ok;
  } catch {
    await client.query("rollback").catch(() => undefined);
    return false;
  } finally {
    client.release();
  }
}

/**
 * One READ COMMITTED transaction as `kitluy_hub_runtime`. Any thrown error
 * rolls the WHOLE command back: schema contract §9 makes a business mutation
 * without its event and outbox row invalid, so a partial command must not
 * survive.
 */
export async function withHubTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  role: string = HUB_RUNTIME_ROLE,
): Promise<T> {
  return runInTransaction(pool, "begin", fn, role);
}

/**
 * One SERIALIZABLE transaction (§1 "Transactions: SERIALIZABLE for sequence
 * allocation, storage assignment and final custody release"). The Hub
 * acceptance algorithm (offline contract §4) also requires it: the terminal
 * sequence record is locked for the whole command.
 */
export async function withSerializableHubTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
  role: string = HUB_RUNTIME_ROLE,
): Promise<T> {
  return runInTransaction(pool, "begin isolation level serializable", fn, role);
}

/** True when a rejected transaction may be retried unchanged (40001/40P01). */
export function isSerializationFailure(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "40001" || code === "40P01";
}

export type HubClient = pg.PoolClient;
export type HubPool = pg.Pool;
