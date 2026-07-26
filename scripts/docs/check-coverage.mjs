#!/usr/bin/env node
/**
 * docs:coverage-check — the coverage matrix must not claim a document is
 * physically present when it is not, and must not mark a physically present
 * document MISSING. Matrix rows: | artifact | family | status | path |
 */
import { existsSync, readFileSync } from "node:fs";

const path =
  "docs/source/processed/reconciliation/kitluy-required-document-coverage-matrix-v1.0.0.md";
const text = readFileSync(path, "utf8");
const rows = text
  .split("\n")
  .filter((l) => l.startsWith("|") && !l.startsWith("| ---") && !/^\|\s*Artifact/i.test(l))
  .map((l) =>
    l
      .split("|")
      .map((c) => c.trim())
      .filter((_, i, a) => i > 0 && i < a.length),
  );
let errors = 0;
let checked = 0;
for (const cells of rows) {
  if (cells.length < 4) continue;
  const [artifact, , status, loc] = cells;
  const cleanLoc = loc.replace(/`/g, "");
  if (/^PRESENT/.test(status)) {
    if (cleanLoc === "—" || cleanLoc === "") {
      console.error(`COVERAGE: ${artifact} marked ${status} but no path given.`);
      errors += 1;
    } else if (!existsSync(cleanLoc)) {
      console.error(`COVERAGE: ${artifact} marked ${status} but path does not exist: ${cleanLoc}`);
      errors += 1;
    }
    checked += 1;
  }
  if (status === "MISSING" && cleanLoc !== "—" && cleanLoc !== "" && existsSync(cleanLoc)) {
    console.error(`COVERAGE: ${artifact} marked MISSING but ${cleanLoc} exists.`);
    errors += 1;
  }
}
if (errors) process.exit(1);
console.log(`docs:coverage-check OK (${checked} PRESENT rows verified against the filesystem).`);
