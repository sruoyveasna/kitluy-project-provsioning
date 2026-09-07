#!/usr/bin/env node
/**
 * Governed hosted-DEVELOPMENT deployment.
 *
 *   KITLUY_HOSTED_DEV_DB_URL='postgresql://…' pnpm db:deploy:hosted-dev [--dry-run]
 *
 * ===========================================================================
 * WHAT THIS IS, AND WHAT IT REFUSES TO BECOME
 * ===========================================================================
 * A forward-only migration deployment to ONE allowlisted Supabase project
 * (see hosted-dev-target.mjs). It is deliberately not a general remote
 * deployment tool:
 *
 *   forward migrations .... yes
 *   reset / drop / wipe ... never, not even on the allowed project
 *   any other project ..... refused before a single statement runs
 *   pilot / production .... refused; they have separate promotion paths
 *
 * `db:apply`, `db:reset` and `db:seed` are untouched and remain local-only.
 *
 * ===========================================================================
 * WHY IT VERIFIES THE LIVE DATABASE BEFORE MUTATING
 * ===========================================================================
 * The allowlist checks the connection string. That proves which project is
 * being DIALLED, not what is inside it. A deployment that assumed an empty
 * project and met a populated one could interleave with someone else's schema,
 * so the target is inspected first and a non-empty project stops the run with
 * a report rather than a merge.
 *
 * Authority: owner decision 2026-08-10; KL-INF-P1-037.
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

import {
  ALLOWED_HOSTED_DEV,
  HostedTargetRefusal,
  assertHostedDevTarget,
  assertNonDestructiveHostedCommand,
} from "./hosted-dev-target.mjs";

const MIGRATIONS_DIR = "supabase/migrations";
const DB_URL_ENV = "KITLUY_HOSTED_DEV_DB_URL";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

function fail(message) {
  console.error(message);
  process.exit(1);
}

// --- 1. Guard the target BEFORE anything else --------------------------------
const dbUrl = process.env[DB_URL_ENV] ?? "";
const environment = process.env.KITLUY_ENV ?? "development";

let target;
try {
  assertNonDestructiveHostedCommand("migrate");
  target = assertHostedDevTarget({
    dbUrl,
    environment,
    declaredProjectRef: process.env.KITLUY_HOSTED_DEV_PROJECT_REF,
  });
} catch (error) {
  if (error instanceof HostedTargetRefusal) {
    fail(`${error.message}\n  code: ${error.code}`);
  }
  throw error;
}

// =============================================================================
// D-20: THE SUBPROCESS GETS THE CANONICAL DSN, NEVER THE ORIGINAL.
// =============================================================================
// The Supabase CLI takes a connection string, so a sanitized options object is
// not available here — the string is rebuilt instead, from the components the
// guard verified plus the allowlisted TLS parameters and nothing else.
//
// This matters more for the subprocess than for `pg`: the CLI links libpq, which
// honours routing keywords `pg` ignores (`hostaddr`, `service`, `passfile`).
// Validating the string and then handing the ORIGINAL to a child process would
// mean the guard and the thing that actually connects disagree about the target,
// which is exactly the defect.
const canonicalDbUrl = target.canonicalConnectionString;

console.log(
  `[hosted-dev] target ${target.name} (${target.projectRef}) · env=${target.environment}`,
);

// --- 2. What the repository expects to deploy --------------------------------
const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();
console.log(`[hosted-dev] migration files on disk: ${files.length}`);

// --- 3. Inspect the LIVE target ----------------------------------------------
// Via the Supabase CLI rather than psql: this machine has no psql and no
// root-resolvable pg client, and adding either as a hard dependency would make
// the governed deploy path fail for reasons unrelated to deployment. The CLI is
// already required for the push itself, so it is the one tool guaranteed present.
function migrationList() {
  try {
    return execFileSync("supabase", ["migration", "list", "--db-url", canonicalDbUrl], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    fail(
      `REFUSED: could not read the hosted migration ledger.\n${String(error.stderr ?? error.message).trim()}`,
    );
    return "";
  }
}

/**
 * Count remote-applied versions in `supabase migration list` output.
 *
 * The table prints LOCAL | REMOTE | TIME; a version present remotely appears in
 * the second column. Parsed rather than trusted as a total, because "how many
 * are applied THERE" is the number that decides whether this is a fresh deploy.
 */
function countRemoteApplied(listing) {
  let applied = 0;
  for (const line of listing.split("\n")) {
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    if (!/^\d{14}$/.test(cells[0]) && !/^\d{14}$/.test(cells[1])) continue;
    if (/^\d{14}$/.test(cells[1])) applied += 1;
  }
  return applied;
}

const listingBefore = migrationList();
const ledgerCount = countRemoteApplied(listingBefore);
console.log(`[hosted-dev] live state: remote-applied migrations=${ledgerCount}`);

if (ledgerCount > files.length) {
  fail(
    `REFUSED: the hosted project reports ${ledgerCount} applied migrations but this repository has ${files.length}. The target is AHEAD of the repository; deploying would be a downgrade.`,
  );
}
if (ledgerCount === files.length) {
  console.log("[hosted-dev] already at repository authority — nothing to deploy.");
  process.exit(0);
}

// --- 4. Deploy, forward only --------------------------------------------------
if (dryRun) {
  console.log(`[hosted-dev] --dry-run: would apply ${files.length - ledgerCount} migration(s).`);
  process.exit(0);
}

console.log(
  `[hosted-dev] applying ${files.length - ledgerCount} migration(s) with supabase db push`,
);
try {
  execFileSync("supabase", ["db", "push", "--db-url", canonicalDbUrl, "--include-all", "--yes"], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
} catch {
  fail(
    "REFUSED-INCOMPLETE: `supabase db push` did not complete. The chain may be PARTIALLY applied — re-run this command (it is forward-only and resumes from the ledger) and capture the failing migration before diagnosing.",
  );
}

// --- 5. Verify the ledger -----------------------------------------------------
const finalLedger = countRemoteApplied(migrationList());
console.log(`[hosted-dev] ledger after deploy: ${finalLedger}/${files.length}`);

if (finalLedger !== files.length) {
  fail(
    `REFUSED-INCOMPLETE: ledger is ${finalLedger}, expected ${files.length}. Do not treat this project as deployed.`,
  );
}
console.log(
  `[hosted-dev] OK — ${ALLOWED_HOSTED_DEV.name} is at repository authority (${files.length} migrations).`,
);
