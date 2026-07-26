#!/usr/bin/env node
/**
 * docs:registry-check — in the implementation-status register, every status
 * above SPECIFIED requires a linked evidence reference (repository path,
 * commit, test, migration, deployment or pilot record).
 */
import { readFileSync } from "node:fs";

const path = "docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md";
const text = readFileSync(path, "utf8");
const ABOVE_SPECIFIED = [
  "CONTRACT-APPROVED",
  "SCAFFOLDED",
  "IMPLEMENTED-IN-DEV",
  "INTEGRATION-VERIFIED",
  "PILOT-READY",
  "PILOT-PROVEN",
  "PRODUCTION",
];
const evidencePattern =
  /(`[^`]+`|\([^)]*(commit|\.ts|\.md|\.sql|\.yaml|\.json|pnpm )[^)]*\)|commit [0-9a-f]{7,}|test)/i;
const startMarker = "<!-- registry-check:start -->";
const endMarker = "<!-- registry-check:end -->";
const startIdx = text.indexOf(startMarker);
const endIdx = text.indexOf(endMarker);
if (startIdx === -1 || endIdx === -1) {
  console.error(
    "REGISTRY: machine-checkable evidence table markers missing (registry-check:start/end).",
  );
  process.exit(1);
}
const scanned = text.slice(startIdx, endIdx);
let errors = 0;
let checked = 0;
for (const line of scanned.split("\n")) {
  if (!line.startsWith("|")) continue;
  const status = ABOVE_SPECIFIED.find((s) => new RegExp(`\\b${s}\\b`).test(line));
  if (!status) continue;
  // Skip the legend/definition rows.
  if (/legend|requires|definition/i.test(line)) continue;
  checked += 1;
  if (!evidencePattern.test(line)) {
    console.error(`REGISTRY: row claims ${status} without linked evidence: ${line.slice(0, 110)}`);
    errors += 1;
  }
}
if (errors) process.exit(1);
console.log(`docs:registry-check OK (${checked} above-SPECIFIED rows carry evidence links).`);
