#!/usr/bin/env node
/**
 * docs:authority-check —
 * (1) every MASTER-AUTHORITY / BUSINESS-AUTHORITY source is referenced by the
 *     repository source-of-truth index;
 * (2) no source registered in the superseded register is CANONICAL-CURRENT in
 *     the manifest;
 * (3) the owner decision IDs (KLV4-DEC-001..012, KLD-2026-07-24-001) appear in
 *     the authority documentation.
 */
import { readFileSync } from "node:fs";
import { readJson } from "./lib.mjs";

const manifest = readJson("docs/source/manifests/kitluy-source-document-manifest-v1.0.0.json");
const sotIndex = readFileSync("docs/authority/kitluy-source-of-truth-index-v1.0.0.md", "utf8");
const supersededReg = readFileSync(
  "docs/authority/kitluy-superseded-document-register-v1.0.0.md",
  "utf8",
);
const reconRegister = readFileSync(
  "docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md",
  "utf8",
);
let errors = 0;

for (const s of manifest.sources) {
  if (["MASTER-AUTHORITY", "BUSINESS-AUTHORITY"].includes(s.authority_class)) {
    if (!sotIndex.includes(s.physical_filename)) {
      console.error(
        `AUTHORITY: ${s.physical_filename} (${s.authority_class}) is not referenced by the source-of-truth index.`,
      );
      errors += 1;
    }
  }
  if (
    s.canonical_status === "CANONICAL-CURRENT" &&
    supersededReg.includes(`| ${s.physical_filename} `) &&
    !supersededReg.includes(`${s.physical_filename} (inbox`)
  ) {
    console.error(
      `AUTHORITY: ${s.physical_filename} is registered superseded but marked CANONICAL-CURRENT.`,
    );
    errors += 1;
  }
}

const decisionIds = [
  ...Array.from({ length: 12 }, (_, i) => `KLV4-DEC-${String(i + 1).padStart(3, "0")}`),
  "KLD-2026-07-24-001",
];
const authorityText = sotIndex + reconRegister;
for (const id of decisionIds) {
  if (!authorityText.includes(id)) {
    console.error(`AUTHORITY: owner decision ${id} is omitted from the authority index/register.`);
    errors += 1;
  }
}
if (errors) process.exit(1);
console.log("docs:authority-check OK.");
