#!/usr/bin/env node
/**
 * pnpm verify — the safe local validation suite. Read-only with respect to
 * external systems: never touches cloud resources or databases.
 */
import { execSync } from "node:child_process";

const steps = [
  ["Format check", "pnpm format:check"],
  ["Lint", "pnpm lint"],
  ["Typecheck", "pnpm typecheck"],
  ["Unit tests", "pnpm test"],
  ["Contract tests", "pnpm test:contract"],
  ["Offline harness", "pnpm test:offline"],
  ["Build", "pnpm build"],
  ["OpenAPI validation", "pnpm contracts:validate"],
  ["Migration validation", "pnpm migrations:validate"],
  // WS-11-T008 F-2: the Hub migration set was outside every routine gate,
  // which is why an edit to an applied Hub migration reached a commit. This
  // check is static (no database), same as the cloud one beside it.
  ["Hub migration validation", "pnpm hub:db:validate"],
  ["Secret scan", "pnpm secret:scan"],
  ["Clock usage", "pnpm clock:check"],
  ["Docs link check", "pnpm docs:check"],
];

const results = [];
let failed = false;
for (const [name, cmd] of steps) {
  process.stdout.write(`\n=== ${name}: ${cmd} ===\n`);
  try {
    execSync(cmd, { stdio: "inherit" });
    results.push([name, "PASS"]);
  } catch {
    results.push([name, "FAIL"]);
    failed = true;
  }
}
process.stdout.write("\n===== VERIFY SUMMARY =====\n");
for (const [name, status] of results) {
  process.stdout.write(`${status.padEnd(5)} ${name}\n`);
}
process.exit(failed ? 1 : 0);
