#!/usr/bin/env node
/**
 * Clock-usage gate — KLD-2026-07-28-002 §12.6.
 *
 * Certificate validity, certificate renewal eligibility, revocation-snapshot
 * validity and configuration-snapshot validity must be decided against TRUSTED
 * TIME, never against an uncontrolled host clock.
 *
 * WHY THIS GATE HAS A MANIFEST.
 * An earlier version only forbade host-clock calls. It therefore reported a
 * clean PASS on a repository where none of the four security-sensitive
 * consumers existed — a gate that is satisfied by absence tells you nothing.
 * The manifest below names the four consumers the owner requires, and the gate
 * reports how many are actually implemented. Absence is now visible.
 *
 * Exit codes:
 *   0  no prohibited clock access. The manifest count is reported separately
 *      and is NON-BLOCKING while WS-11-T003 is in progress.
 *   1  a guarded file reached for the host clock, or (with --require-complete)
 *      the manifest is not 4/4.
 *
 * Step 2 closure MUST run this with `--require-complete`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REQUIRE_COMPLETE = process.argv.includes("--require-complete");

/**
 * The governed consumer manifest. Every entry is a security decision that must
 * be made against trusted time. `implementationFile` and `integrationTest` are
 * paths that must EXIST; `trustedTimeSymbol` must appear in the implementation.
 *
 * `status` is the honest state of each consumer, not an aspiration.
 */
const CONSUMERS = [
  {
    id: "certificate.validity",
    owner: "Fleet/Security",
    status: "NOT_IMPLEMENTED",
    note: "WS-11-T003 step 4",
    implementationFile: "packages/device-identity/src/certificate-validity.ts",
    integrationTest: "packages/device-identity/test/certificate-validity.test.ts",
    trustedTimeSymbol: "TrustedTime",
  },
  {
    id: "certificate.renewal_eligibility",
    owner: "Fleet/Security",
    status: "NOT_IMPLEMENTED",
    note: "WS-11-T003 step 4",
    implementationFile: "packages/device-identity/src/certificate-renewal.ts",
    integrationTest: "packages/device-identity/test/certificate-renewal.test.ts",
    trustedTimeSymbol: "TrustedTime",
  },
  {
    id: "revocation_snapshot.validity",
    owner: "Fleet/Security",
    status: "NOT_IMPLEMENTED",
    note: "WS-11-T003 step 5",
    implementationFile: "packages/device-identity/src/revocation-snapshot.ts",
    integrationTest: "packages/device-identity/test/revocation-snapshot.test.ts",
    trustedTimeSymbol: "TrustedTime",
  },
  {
    id: "configuration_snapshot.validity",
    owner: "Configuration/Security",
    status: "NOT_IMPLEMENTED",
    note: "WS-11-T003 step 5",
    implementationFile: "packages/device-identity/src/configuration-validity.ts",
    integrationTest: "packages/device-identity/test/configuration-validity.test.ts",
    trustedTimeSymbol: "TrustedTime",
  },
];

/** Paths always scanned for host-clock calls, implemented or not. */
const ALWAYS_GUARDED = ["packages/device-identity/src/trusted-time.ts"];

const FORBIDDEN = [
  { pattern: /\bDate\.now\s*\(/, what: "Date.now()" },
  { pattern: /\bnew Date\s*\(\s*\)/, what: "new Date() with no argument" },
  { pattern: /\bperformance\.now\s*\(/, what: "performance.now()" },
];

const exists = (path) => {
  try {
    statSync(join(ROOT, path));
    return true;
  } catch {
    return false;
  }
};

const scanForClock = (relPath) => {
  const findings = [];
  const source = readFileSync(join(ROOT, relPath), "utf8");
  source.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("//")) return;
    for (const { pattern, what } of FORBIDDEN) {
      if (pattern.test(line)) {
        findings.push(`${relPath}:${index + 1} uses ${what} in a trust decision`);
      }
    }
  });
  return findings;
};

const clockFindings = [];
for (const path of ALWAYS_GUARDED) {
  if (exists(path)) clockFindings.push(...scanForClock(path));
}

// ---------------------------------------------------------------------------
// Manifest evaluation
// ---------------------------------------------------------------------------
const rows = [];
let complete = 0;

for (const consumer of CONSUMERS) {
  const problems = [];
  const hasImpl = exists(consumer.implementationFile);
  const hasTest = exists(consumer.integrationTest);

  if (!hasImpl) problems.push("no implementation file");
  if (!hasTest) problems.push("no integration test");

  if (hasImpl) {
    clockFindings.push(...scanForClock(consumer.implementationFile));
    const source = readFileSync(join(ROOT, consumer.implementationFile), "utf8");
    if (!source.includes(consumer.trustedTimeSymbol)) {
      problems.push(`no ${consumer.trustedTimeSymbol} dependency`);
    }
  }

  const ok = problems.length === 0;
  if (ok) complete += 1;
  rows.push({ consumer, ok, problems });
}

// SQL-side validity functions must reference trusted time once they exist.
const migrationsDir = join(ROOT, "supabase", "migrations");
const SQL_GUARDED_FUNCTIONS = [
  "validate_certificate_window",
  "assert_revocation_snapshot_fresh",
  "assert_configuration_snapshot_valid",
];
let migrationSource = "";
try {
  for (const file of readdirSync(migrationsDir)) {
    if (file.endsWith(".sql")) {
      migrationSource += readFileSync(join(migrationsDir, file), "utf8");
    }
  }
} catch {
  /* nothing to check */
}
for (const fn of SQL_GUARDED_FUNCTIONS) {
  const marker = `function kitluy_devices.${fn}`;
  if (!migrationSource.includes(marker)) continue;
  const body = migrationSource.slice(migrationSource.indexOf(marker));
  const end = body.indexOf("$$;");
  const fnBody = end === -1 ? body : body.slice(0, end);
  if (!/trusted_time|assert_trusted_time_v1/.test(fnBody)) {
    clockFindings.push(
      `supabase/migrations: kitluy_devices.${fn} decides validity without trusted time`,
    );
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
if (clockFindings.length > 0) {
  console.error("CLOCK USAGE CHECK FAILED — trust decisions must use trusted time:\n");
  for (const finding of clockFindings) console.error(`  ${finding}`);
  console.error(
    "\nKLD-2026-07-28-002 §12.6: certificate validity, revocation-snapshot validity\n" +
      "and configuration-snapshot validity are decided against trusted time.",
  );
  process.exit(1);
}

console.log("PASS — no prohibited clock access");
console.log(
  `${complete === CONSUMERS.length ? "COMPLETE" : "INCOMPLETE"} — ${complete}/${CONSUMERS.length} required consumers implemented`,
);
for (const { consumer, ok, problems } of rows) {
  const mark = ok ? "ok     " : "missing";
  const detail = ok ? consumer.owner : `${problems.join(", ")} (${consumer.note})`;
  console.log(`  ${mark}  ${consumer.id.padEnd(34)} ${detail}`);
}

if (complete !== CONSUMERS.length) {
  const message =
    `\nThe governed consumer manifest is not complete. This gate does NOT report a\n` +
    `clean bill of health on a repository where the security-sensitive consumers\n` +
    `do not exist — absence is not compliance.`;
  if (REQUIRE_COMPLETE) {
    console.error(`${message}\n\n--require-complete was set: failing.`);
    process.exit(1);
  }
  console.log(`${message}\nNon-blocking while WS-11-T003 is in progress.`);
}
