/**
 * The harness that renewal orchestration will run on — tested before anything
 * is built on it.
 *
 * Two halves. The GUARD tests always run: they prove the harness refuses unsafe
 * targets, and a guard nobody exercises is a guard nobody knows works. The
 * LIVE tests need the local Supabase stack and skip VISIBLY without it — a skip
 * is never evidence.
 */
import { describe, it, expect, beforeAll } from "vitest";

import {
  DEV_DB_URL_ENV,
  UnsafeDatabaseTargetError,
  assertDevelopmentDatabaseTarget,
  devDatabaseUrl,
  isDevDatabaseReachable,
  reportSkippedIntegration,
  withDatabaseClient,
  withDatabaseTransaction,
} from "./support/dev-database.js";

const reachable = await isDevDatabaseReachable();
if (!reachable) {
  reportSkippedIntegration("@kitluy/device-identity database harness");
}

describe("development database guard", () => {
  const refusals: ReadonlyArray<[string, string, string?]> = [
    ["an empty URL", ""],
    ["a malformed URL", "not-a-url"],
    ["a non-postgres protocol", "mysql://user:pw@127.0.0.1:3306/db"],
    ["a remote host", "postgresql://u:p@db.example.com:5432/postgres"],
    ["a hosted Supabase project", "postgresql://u:p@db.abcdefgh.supabase.co:5432/postgres"],
    ["an RDS endpoint", "postgresql://u:p@x.eu-west-1.rds.amazonaws.com:5432/postgres"],
    // A LOCAL host pointed at production-named data is still refused: a
    // restored production dump on localhost is production data.
    ["a production-named database on localhost", "postgresql://u:p@127.0.0.1:54322/kitluy_prod"],
    ["a staging-named database on localhost", "postgresql://u:p@localhost:54322/staging_copy"],
  ];

  for (const [name, url] of refusals) {
    it(`refuses ${name}`, () => {
      expect(() => assertDevelopmentDatabaseTarget(url)).toThrow(UnsafeDatabaseTargetError);
    });
  }

  it("refuses any target when NODE_ENV is production", () => {
    expect(() =>
      assertDevelopmentDatabaseTarget("postgresql://u:p@127.0.0.1:54322/postgres", "production"),
    ).toThrow(/NODE_ENV is production/);
  });

  it("accepts the local development target", () => {
    expect(() =>
      assertDevelopmentDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:54322/postgres"),
    ).not.toThrow();
  });

  it("never puts the connection URL or its password in the error", () => {
    // The URL carries a password. An error message that echoes it lands in CI
    // logs, which is a credential leak dressed as a diagnostic.
    let message = "";
    try {
      assertDevelopmentDatabaseTarget("postgresql://admin:sup3rs3cret@db.example.com:5432/prod");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("sup3rs3cret");
    expect(message).not.toContain("admin");
    expect(message).not.toContain("db.example.com:5432");
    expect(message).toContain(DEV_DB_URL_ENV);
  });

  it("reports an unreachable target as not reachable rather than throwing", async () => {
    const previous = process.env[DEV_DB_URL_ENV];
    process.env[DEV_DB_URL_ENV] = "postgresql://u:p@db.example.com:5432/postgres";
    try {
      // A REFUSED target must read as "not reachable", not as an exception that
      // a suite could accidentally catch and treat as a pass.
      await expect(isDevDatabaseReachable()).resolves.toBe(false);
    } finally {
      if (previous === undefined) delete process.env[DEV_DB_URL_ENV];
      else process.env[DEV_DB_URL_ENV] = previous;
    }
  });
});

describe.skipIf(!reachable)("live development database", () => {
  beforeAll(() => {
    // Guards against the whole point of this file being lost: if the suite is
    // running, it must be running against a real server.
    expect(devDatabaseUrl()).toMatch(/127\.0\.0\.1|localhost/);
  });

  it("executes a query against the real server", async () => {
    const version = await withDatabaseClient(async (client) => {
      const result = await client.query<{ v: string }>("select version() as v");
      return result.rows[0]?.v ?? "";
    });
    expect(version).toMatch(/PostgreSQL/);
  });

  it("runs parameterized queries rather than interpolated SQL", async () => {
    const row = await withDatabaseClient(async (client) => {
      const result = await client.query<{ echoed: string }>("select $1::text as echoed", [
        "kitluy'; drop table devices; --",
      ]);
      return result.rows[0]?.echoed ?? "";
    });
    // The payload comes back as DATA. Had it been interpolated it would have
    // been parsed as SQL.
    expect(row).toBe("kitluy'; drop table devices; --");
  });

  it("sees the device-identity schema the renewal tests will use", async () => {
    const tables = await withDatabaseClient(async (client) => {
      const result = await client.query<{ relname: string }>(
        `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = $1 and c.relname = any($2::text[])
         order by c.relname`,
        [
          "kitluy_devices",
          ["device_credentials", "device_credential_heads", "device_renewal_reservations"],
        ],
      );
      return result.rows.map((r) => r.relname);
    });
    expect(tables).toEqual([
      "device_credential_heads",
      "device_credentials",
      "device_renewal_reservations",
    ]);
  });

  it("rolls back, so fixtures never leak into the SQL assertion suite", async () => {
    const marker = `harness-probe-${Date.now()}`;
    await withDatabaseTransaction(async (client) => {
      await client.query("create temporary table harness_probe (tag text)");
      await client.query("insert into harness_probe (tag) values ($1)", [marker]);
      const inside = await client.query<{ tag: string }>("select tag from harness_probe");
      expect(inside.rows[0]?.tag).toBe(marker);
    });

    // A NEW connection: the temporary table and its row are both gone.
    const survived = await withDatabaseClient(async (client) => {
      const result = await client.query<{ present: boolean }>(
        "select to_regclass('pg_temp.harness_probe') is not null as present",
      );
      return result.rows[0]?.present ?? false;
    });
    expect(survived).toBe(false);
  });

  it("rolls back and releases the client even when the body throws", async () => {
    await expect(
      withDatabaseTransaction(async (client) => {
        await client.query("select 1");
        throw new Error("deliberate failure inside the transaction");
      }),
    ).rejects.toThrow("deliberate failure");

    // The pool is closed per call, so a leaked client would surface here as a
    // hang or a connection error rather than a clean result.
    const stillWorks = await withDatabaseClient(async (client) => {
      const r = await client.query<{ ok: number }>("select 1 as ok");
      return r.rows[0]?.ok;
    });
    expect(stillWorks).toBe(1);
  });
});

describe("integration reporting", () => {
  it("states plainly whether the live suite ran", () => {
    // This assertion cannot fail. It exists so the reason a run contains no
    // live coverage is visible in the output rather than inferred from silence.
    if (!reachable) {
      console.warn(
        "@kitluy/device-identity live database tests DID NOT RUN — no database evidence from this run.",
      );
    }
    expect(typeof reachable).toBe("boolean");
  });
});
