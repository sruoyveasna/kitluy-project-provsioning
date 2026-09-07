#!/usr/bin/env node
/**
 * Refuse a KitLuy suite that hardcodes a non-canonical development database.
 *
 * Authority: independent credential-path review 2026-08-26, finding M-4; owner
 * remediation instruction ("remove hardcoded :54322 test target… Do not connect
 * KitLuy tests to the HSA database.").
 *
 * ===========================================================================
 * WHY A GUARD AND NOT JUST A FIX
 * ===========================================================================
 * The literal was repeated in thirty-eight files. Repointing them fixes today;
 * nothing stopped the thirty-ninth. And the failure mode is quiet — a suite that
 * reaches the wrong database mostly SKIPS, so the loss shows up as coverage that
 * silently is not there, which is how nineteen registry tests and eighty-five
 * device-identity tests sat mis-targeted long enough to be re-diagnosed twice.
 *
 * Ports refused: 54322 (a different project on this workstation) and 54402 (a
 * stale PostgreSQL 15 stopped at migration 0188). The canonical local target is
 * 54392, and `@kitluy/dev-database` is the helper that knows it.
 *
 * `kitluy_hub_local` is DELIBERATELY exempt: the Store Hub's own local database
 * genuinely lives on 54322 under that name, and it is a different database, not
 * a mis-targeted one.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const WRONG_PORTS = ["54322", "54402"];
const CANONICAL = "54392";

const files = execFileSync("git", ["ls-files", "*.ts", "*.mts", "*.mjs"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean);

const offences = [];
for (const file of files) {
  // The helper and its own negative tests are the two places these strings
  // legitimately appear.
  if (file.includes("packages/dev-database/")) continue;
  if (file.endsWith("database-harness.integration.test.ts")) continue;
  if (file.endsWith("assert-canonical-test-dsn.mjs")) continue;
  // A NEGATIVE fixture: it asserts that the hosted-deploy command REFUSES a
  // local target, so a local DSN is the point of the test rather than a mistake.
  if (file.endsWith("hosted-dev-target.test.mjs")) continue;

  const text = readFileSync(file, "utf8");
  for (const port of WRONG_PORTS) {
    const pattern = new RegExp(`postgres(?:ql)?://[^"'\`\\s]*:${port}/([A-Za-z0-9_]+)`, "g");
    for (const match of text.matchAll(pattern)) {
      // The Hub's own local database is a different database, not a mistake.
      if (match[1] === "kitluy_hub_local") continue;
      offences.push(`${file}: targets :${port}/${match[1]}`);
    }
  }
}

if (offences.length > 0) {
  console.error("CANONICAL TEST DSN VIOLATION — these files target a database that is not KitLuy's:");
  for (const offence of offences) console.error(`  ${offence}`);
  console.error(
    `\nThe canonical local development database is :${CANONICAL}.\n` +
      "Import devDatabaseUrl() from @kitluy/dev-database instead of writing a literal.",
  );
  process.exit(1);
}

console.log(
  `[canonical-dsn] PASS — ${files.length} tracked source file(s); no suite targets a non-KitLuy database`,
);
