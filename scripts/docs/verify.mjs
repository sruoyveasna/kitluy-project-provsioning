#!/usr/bin/env node
/** docs:verify — full documentation-governance validation suite. */
import { execSync } from "node:child_process";

const steps = [
  ["Inbox state (no un-ingested sources)", "pnpm docs:inbox-state"],
  ["Hashes", "pnpm docs:hash"],
  ["Duplicates & canonical collisions", "pnpm docs:duplicates"],
  ["Classification & original links", "pnpm docs:classify:check"],
  ["Authority index completeness", "pnpm docs:authority-check"],
  ["Coverage matrix vs filesystem", "pnpm docs:coverage-check"],
  ["Status register evidence", "pnpm docs:registry-check"],
  ["Internal links", "pnpm docs:links"],
];
let failed = false;
const results = [];
for (const [name, cmd] of steps) {
  process.stdout.write(`\n=== ${name} ===\n`);
  try {
    execSync(cmd, { stdio: "inherit" });
    results.push([name, "PASS"]);
  } catch {
    results.push([name, "FAIL"]);
    failed = true;
  }
}
process.stdout.write("\n===== DOCS VERIFY SUMMARY =====\n");
for (const [name, status] of results) process.stdout.write(`${status.padEnd(5)} ${name}\n`);
process.exit(failed ? 1 : 0);
