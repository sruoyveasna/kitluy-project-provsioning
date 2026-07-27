/**
 * Local development database access for the WS-08 persistence adapters.
 *
 * LOCAL ONLY: the connection refuses non-local URLs — production migrations
 * and production data access are never touched from this layer
 * (KL-INF-P1-037, OWNER-LOCKED). Commands run inside a transaction with
 * `SET LOCAL ROLE service_role` so the database grant/trigger surface that
 * governs real service traffic (no DELETE anywhere, no direct journal writes,
 * append-only triggers) is exercised, not bypassed. service_role carries
 * BYPASSRLS; row policies are verified separately by supabase/tests.
 */
import pg from "pg";

export const DEV_DB_URL_ENV = "KITLUY_DEV_DB_URL";
const DEFAULT_LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// int8 -> bigint so integer minor units never pass through binary floating
// point (money contract §4).
pg.types.setTypeParser(20, (value: string) => BigInt(value));

export function devDatabaseUrl(): string {
  const url = process.env[DEV_DB_URL_ENV] ?? DEFAULT_LOCAL_URL;
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error(
      `${DEV_DB_URL_ENV} must point at a local development database (KL-INF-P1-037).`,
    );
  }
  return url;
}

export function createDevPool(): pg.Pool {
  return new pg.Pool({ connectionString: devDatabaseUrl(), max: 4 });
}

export async function isDevDatabaseReachable(): Promise<boolean> {
  const pool = new pg.Pool({
    connectionString: devDatabaseUrl(),
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/**
 * Run `fn` in one transaction as service_role. Any thrown error rolls the
 * whole command back — a failed command leaves no partial aggregate.
 */
export async function withServiceTransaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
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

export interface CommandActor {
  readonly userId?: string;
  readonly serviceKey?: string;
}

export async function appendAuditLog(
  client: pg.PoolClient,
  entry: {
    tenantId: string;
    digitalStoreId?: string;
    storeLocationId?: string;
    actor: CommandActor;
    action: string;
    resourceType: string;
    resourceId: string;
    reason?: string;
  },
): Promise<void> {
  await client.query(
    `insert into kitluy_audit.audit_logs
       (tenant_id, digital_store_id, store_location_id, actor_type, actor_id,
        action, resource_type, resource_id, environment, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'development', $9)`,
    [
      entry.tenantId,
      entry.digitalStoreId ?? null,
      entry.storeLocationId ?? null,
      entry.actor.userId ? "user" : "service",
      entry.actor.userId ?? null,
      entry.action,
      entry.resourceType,
      entry.resourceId,
      entry.reason ?? null,
    ],
  );
}
