#!/usr/bin/env node
/**
 * Clock-usage gate — KLD-2026-07-28-002 §12.6.
 *
 * Certificate validity, certificate renewal eligibility, revocation-snapshot
 * validity and configuration-snapshot validity must be decided against TRUSTED
 * TIME, never against an uncontrolled host clock. A single `Date.now()` inside
 * one of those decisions makes certificate expiry advisory, which is the
 * failure trusted time exists to prevent.
 *
 * This gate is deliberately blunt: it forbids host-clock calls in the guarded
 * files outright rather than trying to judge intent. A file that genuinely
 * needs the host clock for something unrelated to a trust decision does not
 * belong in the guarded set.
 *
 * Exit 0 = clean. Exit 1 = a guarded file reached for the host clock.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

/**
 * Files whose decisions are time-security decisions. Adding a module that
 * validates certificates, renewals, revocation snapshots or configuration
 * snapshots means adding it here.
 */
const GUARDED = [
  "packages/device-identity/src/trusted-time.ts",
  "packages/configuration-snapshots/src",
  "packages/release-manifests/src",
];

/** Host-clock constructs that must not decide trust. */
const FORBIDDEN = [
  { pattern: /\bDate\.now\s*\(/, what: "Date.now()" },
  { pattern: /\bnew Date\s*\(\s*\)/, what: "new Date() with no argument" },
  { pattern: /\bperformance\.now\s*\(/, what: "performance.now()" },
];

/**
 * SQL functions that decide validity must not use now()/current_timestamp
 * either. `now()` is transaction-start host time; it is not trusted time.
 * Listed by the function name the migration defines.
 */
const SQL_GUARDED_FUNCTIONS = [
  "validate_certificate_window",
  "assert_revocation_snapshot_fresh",
  "assert_configuration_snapshot_valid",
];

const walk = (path) => {
  const out = [];
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return out; // a guarded path that does not exist yet is not a failure
  }
  if (stat.isFile()) return path.endsWith(".ts") ? [path] : [];
  for (const entry of readdirSync(path)) out.push(...walk(join(path, entry)));
  return out;
};

const findings = [];

for (const guarded of GUARDED) {
  for (const file of walk(join(ROOT, guarded))) {
    if (file.endsWith(".test.ts")) continue;
    const source = readFileSync(file, "utf8");
    source.split("\n").forEach((line, index) => {
      // Skip comment lines: prose describing the rule is not a violation of it.
      const trimmed = line.trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
      for (const { pattern, what } of FORBIDDEN) {
        if (pattern.test(line)) {
          findings.push(
            `${relative(ROOT, file)}:${index + 1} uses ${what} in a trust decision; use trusted time`,
          );
        }
      }
    });
  }
}

// The SQL side: a guarded validity function must reference trusted time.
const migrationsDir = join(ROOT, "supabase", "migrations");
let migrationSource = "";
try {
  for (const file of readdirSync(migrationsDir)) {
    if (file.endsWith(".sql")) {
      migrationSource += readFileSync(join(migrationsDir, file), "utf8");
    }
  }
} catch {
  /* no migrations directory: nothing to check */
}

for (const fn of SQL_GUARDED_FUNCTIONS) {
  const defined = migrationSource.includes(`function kitluy_devices.${fn}`);
  if (!defined) continue; // not built yet — the gate does not demand it exists
  const body = migrationSource.slice(migrationSource.indexOf(`function kitluy_devices.${fn}`));
  const end = body.indexOf("$$;");
  const fnBody = end === -1 ? body : body.slice(0, end);
  if (!/trusted_time|trusted_time_floor|assert_trusted_time_v1/.test(fnBody)) {
    findings.push(
      `supabase/migrations: kitluy_devices.${fn} decides validity without referencing trusted time`,
    );
  }
}

if (findings.length > 0) {
  console.error("CLOCK USAGE CHECK FAILED — trust decisions must use trusted time:\n");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error(
    "\nKLD-2026-07-28-002 §12.6: certificate validity, revocation-snapshot validity\n" +
      "and configuration-snapshot validity are decided against trusted time.",
  );
  process.exit(1);
}

console.log(
  `Clock usage check passed (${GUARDED.length} guarded path(s), ${SQL_GUARDED_FUNCTIONS.length} guarded SQL function(s)).`,
);
