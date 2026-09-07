/**
 * Gated development-database harness for @kitluy/device-identity tests.
 *
 * TEST-ONLY. Deliberately NOT exported from `src/` — nothing in the shipped
 * package should be able to open a database connection, and a generic
 * "database utility" escaping into the runtime is exactly how a local-only
 * tool becomes a production one.
 *
 * The environment contract is the repository's existing one
 * (`KITLUY_DEV_DB_URL`, local default), reused rather than reinvented so there
 * is one place that decides what "development database" means.
 *
 * FAIL CLOSED. Every refusal below is a refusal to CONNECT, not a warning:
 * KL-INF-P1-037 is owner-locked and production migrations are never applied
 * from a test path.
 */
import pg from "pg";

export const DEV_DB_URL_ENV = "KITLUY_DEV_DB_URL";

/** Matches the local Supabase stack this repository runs against. */
const DEFAULT_LOCAL_URL = "postgresql://postgres:postgres@127.0.0.1:54392/postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Substrings that mark a target as NOT development. Checked against host AND
 * database name, because a local-looking host pointed at a restored production
 * dump is still production data.
 */
const FORBIDDEN_MARKERS = [
  "prod",
  "production",
  "staging",
  "stage",
  "live",
  "supabase.co",
  "supabase.in",
  "rds.amazonaws",
  "azure",
  "neon.tech",
];

export class UnsafeDatabaseTargetError extends Error {
  constructor(reason: string) {
    // The URL is NEVER interpolated into this message — it carries a password.
    super(`Refusing to connect: ${reason}. Set ${DEV_DB_URL_ENV} to a local development database.`);
    this.name = "UnsafeDatabaseTargetError";
  }
}

/**
 * Decides whether a URL may be connected to at all.
 *
 * Exported so the refusal itself is testable: a guard nobody can exercise is a
 * guard nobody knows is working.
 */
export function assertDevelopmentDatabaseTarget(rawUrl: string, nodeEnv?: string): void {
  if (rawUrl.trim() === "") {
    throw new UnsafeDatabaseTargetError(`${DEV_DB_URL_ENV} is empty`);
  }
  if ((nodeEnv ?? process.env.NODE_ENV) === "production") {
    throw new UnsafeDatabaseTargetError("NODE_ENV is production");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeDatabaseTargetError("the connection URL is malformed");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new UnsafeDatabaseTargetError(`unsupported protocol ${parsed.protocol}`);
  }

  const host = parsed.hostname.toLowerCase();
  const database = parsed.pathname.replace(/^\//, "").toLowerCase();

  if (!LOCAL_HOSTS.has(host)) {
    throw new UnsafeDatabaseTargetError(`host ${host} is not a local development host`);
  }
  for (const marker of FORBIDDEN_MARKERS) {
    if (host.includes(marker)) {
      throw new UnsafeDatabaseTargetError(`host contains the forbidden marker "${marker}"`);
    }
    if (database.includes(marker)) {
      // A local host pointed at a production-named database is still refused.
      throw new UnsafeDatabaseTargetError(
        `database name contains the forbidden marker "${marker}"`,
      );
    }
  }
}

export function devDatabaseUrl(): string {
  const url = process.env[DEV_DB_URL_ENV] ?? DEFAULT_LOCAL_URL;
  assertDevelopmentDatabaseTarget(url);
  return url;
}

/** True only when a real query succeeded. A refused target is NOT reachable. */
export async function isDevDatabaseReachable(): Promise<boolean> {
  let url: string;
  try {
    url = devDatabaseUrl();
  } catch {
    return false;
  }
  const pool = new pg.Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2_000 });
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
 * Runs `fn` with a connected client and ALWAYS releases it — including when
 * `fn` throws. A leaked client exhausts the pool and turns one failing test
 * into a cascade of unrelated timeouts.
 */
export async function withDatabaseClient<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: devDatabaseUrl(), max: 2 });
  let client: pg.PoolClient | undefined;
  try {
    client = await pool.connect();
    return await fn(client);
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

/**
 * Runs `fn` inside a transaction that is ALWAYS rolled back.
 *
 * Rollback is unconditional rather than "on failure": these tests write device
 * and credential rows, and the assertion suite in `supabase/tests` is already
 * order-sensitive. Leaking fixture rows into it would produce failures far from
 * their cause.
 */
export async function withDatabaseTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withDatabaseClient(async (client) => {
    await client.query("begin");
    try {
      return await fn(client);
    } finally {
      await client.query("rollback").catch(() => undefined);
    }
  });
}

/**
 * For suites that must not silently pass when the stack is down. Throws with a
 * legible reason instead of letting a "0 tests failed" run read as evidence.
 */
export async function requireDevDatabase(): Promise<void> {
  if (!(await isDevDatabaseReachable())) {
    throw new Error(
      `Development database unreachable. Start the local Supabase stack, or set ${DEV_DB_URL_ENV}.`,
    );
  }
}

/** Emitted when a suite skips, so a skip is never mistaken for a pass. */
export function reportSkippedIntegration(suite: string): void {
  console.warn(
    `SKIPPED ${suite}: development database unreachable — this suite did NOT run and is not evidence.`,
  );
}
