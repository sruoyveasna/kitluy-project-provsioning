#!/usr/bin/env node
/**
 * Local Supabase execution router (WS-01-T003).
 *
 * Routes the package.json database scripts to the real local commands when the
 * required tooling exists, and reports honestly when it does not:
 *
 *   supabase:status -> supabase status
 *   db:reset        -> supabase db reset            (LOCAL ONLY, guarded)
 *   db:apply        -> supabase migration up        (LOCAL ONLY, guarded)
 *   db:seed         -> psql -f supabase/seed/dev-fixtures.sql (LOCAL ONLY)
 *   db:types        -> supabase gen types typescript (governed output, see below)
 *   db:test         -> psql -f supabase/tests/assertions.sql + rls-tests.sql
 *
 * BLOCKED-HONEST CONTRACT (BLK-002): when the Supabase CLI / Docker / psql are
 * absent this script prints exactly one BLOCKED-NOT-EXECUTED line and exits 3.
 * A blocked run is never converted into a fake pass and never claims execution.
 *
 * LOCAL-ONLY GUARD (assertLocalTarget, mirrors scripts/database/supabase-local.sh):
 * refuses to run when KITLUY_ENV is production-like or SUPABASE_DB_URL points at
 * a non-local database. Production application is human-operated with four-eyes
 * approval and never automatic (KL-INF-P1-037, OWNER-LOCKED).
 *
 * GENERATED TYPES OWNERSHIP (db:types): per
 * docs/source/data-contracts/kitluy-suite-supabase-generated-types-policy-v1.0.0.md
 * the governed owner package is `packages/kitluy-supabase-types/` (owner:
 * backend/platform data team). db:types writes
 * packages/kitluy-supabase-types/src/database.generated.ts from the local
 * migrated database only; handwritten copies of generated types are prohibited,
 * the file is never manually edited, and application teams consume the versioned
 * package rather than running ad-hoc production generation. Other CLI artifacts
 * land in supabase/generated/ (see its README).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

const BLOCKER_DOC = "00_AI_HANDOFF/OPERATOR-INSTRUCTION-BLK-002.md";
const LOCAL_DB_URL_DEFAULT = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const TYPES_OUTPUT = "packages/kitluy-supabase-types/src/database.generated.ts";
const KITLUY_SCHEMAS = ["public", "kitluy_core", "kitluy_auth", "kitluy_admin", "kitluy_audit"];

const command = process.argv[2];

function toolExists(tool) {
  const probe = spawnSync("sh", ["-c", `command -v ${tool}`], { stdio: "ignore" });
  return probe.status === 0;
}

function requireTools(tools) {
  const missing = tools.filter((t) => !toolExists(t));
  if (missing.length > 0) {
    console.error(`BLOCKED-NOT-EXECUTED (BLK-002): ${missing.join(", ")}; see ${BLOCKER_DOC}`);
    process.exit(3);
  }
}

function assertLocalTarget() {
  const env = process.env.KITLUY_ENV ?? "local";
  if (env !== "local" && env !== "development") {
    console.error(
      `REFUSED: KITLUY_ENV='${env}' — database execution scripts only operate on local/development targets (KL-INF-P1-037).`,
    );
    process.exit(1);
  }
  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  if (dbUrl && !/localhost|127\.0\.0\.1/.test(dbUrl)) {
    console.error("REFUSED: SUPABASE_DB_URL points at a non-local database.");
    process.exit(1);
  }
}

function localDbUrl() {
  const dbUrl = process.env.SUPABASE_DB_URL ?? "";
  return dbUrl && /localhost|127\.0\.0\.1/.test(dbUrl) ? dbUrl : LOCAL_DB_URL_DEFAULT;
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { stdio: "inherit", ...options });
  if (result.error) {
    console.error(`ERROR: failed to launch ${cmd}: ${result.error.message}`);
    process.exit(1);
  }
  return result.status ?? 1;
}

switch (command) {
  case "status": {
    requireTools(["supabase", "docker"]);
    process.exit(run("supabase", ["status"]));
    break;
  }
  case "reset": {
    requireTools(["supabase", "docker"]);
    assertLocalTarget();
    console.log("Resetting LOCAL Supabase database (destructive to local dev data only).");
    process.exit(run("supabase", ["db", "reset"]));
    break;
  }
  case "apply": {
    requireTools(["supabase", "docker"]);
    assertLocalTarget();
    process.exit(run("supabase", ["migration", "up"]));
    break;
  }
  case "seed": {
    requireTools(["supabase", "docker", "psql"]);
    assertLocalTarget();
    process.exit(
      run("psql", [localDbUrl(), "-v", "ON_ERROR_STOP=1", "-f", "supabase/seed/dev-fixtures.sql"]),
    );
    break;
  }
  case "types": {
    requireTools(["supabase", "docker"]);
    assertLocalTarget();
    mkdirSync(dirname(TYPES_OUTPUT), { recursive: true });
    const out = openSync(TYPES_OUTPUT, "w");
    const args = ["gen", "types", "typescript", "--local"];
    for (const schema of KITLUY_SCHEMAS) {
      args.push("--schema", schema);
    }
    const status = run("supabase", args, { stdio: ["inherit", out, "inherit"] });
    if (status === 0) {
      console.log(
        `Generated ${TYPES_OUTPUT} (governed package per kitluy-suite-supabase-generated-types-policy-v1.0.0.md; never hand-edit).`,
      );
    }
    process.exit(status);
    break;
  }
  case "test": {
    requireTools(["supabase", "docker", "psql"]);
    assertLocalTarget();
    const url = localDbUrl();
    const assertions = run("psql", [
      url,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "supabase/tests/assertions.sql",
    ]);
    if (assertions !== 0) process.exit(assertions);
    process.exit(run("psql", [url, "-v", "ON_ERROR_STOP=1", "-f", "supabase/tests/rls-tests.sql"]));
    break;
  }
  default: {
    console.error("Usage: db-exec.mjs status|reset|apply|seed|types|test");
    process.exit(2);
  }
}
