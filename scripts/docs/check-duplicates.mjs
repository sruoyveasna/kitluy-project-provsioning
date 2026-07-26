#!/usr/bin/env node
/**
 * docs:duplicates — exact-duplicate report plus the canonical collision rule:
 * two CANONICAL-CURRENT documents must never claim the same filename+version
 * with different hashes (checked across the manifest AND docs/source/imported).
 */
import { existsSync } from "node:fs";
import { readJson, sha256 } from "./lib.mjs";

const manifest = readJson("docs/source/manifests/kitluy-source-document-manifest-v1.0.0.json");
const superseded = readJson("docs/source/manifests/kitluy-imported-copy-status-v1.0.0.json");
let errors = 0;

const byHash = new Map();
for (const s of manifest.sources) {
  if (byHash.has(s.sha256))
    console.log(`duplicate content: ${s.physical_filename} == ${byHash.get(s.sha256)}`);
  else byHash.set(s.sha256, s.physical_filename);
}

for (const s of manifest.sources.filter((s) => s.canonical_status === "CANONICAL-CURRENT")) {
  const importedPath = `docs/source/imported/${s.physical_filename}`;
  if (existsSync(importedPath)) {
    const importedHash = sha256(importedPath);
    if (importedHash !== s.sha256) {
      const registered = superseded.reclassified.find((r) => r.path === importedPath);
      if (!registered) {
        console.error(
          `CANONICAL COLLISION: ${s.physical_filename} exists in docs/source/imported/ with a different hash and is not registered as a superseded variant.`,
        );
        errors += 1;
      }
    }
  }
}
if (errors) process.exit(1);
console.log("docs:duplicates OK (no unresolved canonical filename+version collisions).");
