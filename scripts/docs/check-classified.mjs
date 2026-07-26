#!/usr/bin/env node
/**
 * docs:classify — every inbox source has a manifest entry; every classified
 * copy exists, links back to its original, and matches its hash; no generated
 * summary is classified as an original source.
 */
import { existsSync } from "node:fs";
import { readJson, listInboxFiles, sha256 } from "./lib.mjs";

const manifest = readJson("docs/source/manifests/kitluy-source-document-manifest-v1.0.0.json");
const byName = new Map(manifest.sources.map((s) => [s.physical_filename, s]));
let errors = 0;

for (const f of listInboxFiles()) {
  if (!byName.has(f.name)) {
    console.error(`CLASSIFY: physical inbox source ${f.name} has no manifest entry.`);
    errors += 1;
  }
}
for (const s of manifest.sources) {
  if (!s.original_path) {
    console.error(`CLASSIFY: ${s.source_id} has no original-source link.`);
    errors += 1;
    continue;
  }
  // Inbox originals are deleted after hash-verified ingestion (owner
  // instruction KLOI-2026-07-26-001): the manifest link + recorded sha256 +
  // git history remain the provenance; the classified copy is the surviving
  // original and must still match the recorded hash (checked below).
  if (!s.classified_path || !existsSync(s.classified_path)) {
    console.error(`CLASSIFY: ${s.source_id} classified copy missing (${s.classified_path}).`);
    errors += 1;
    continue;
  }
  if (sha256(s.classified_path) !== s.sha256) {
    console.error(
      `CLASSIFY: ${s.source_id} classified copy differs from original (${s.classified_path}).`,
    );
    errors += 1;
  }
  if (s.classified_path.includes("docs/source/processed/")) {
    console.error(
      `CLASSIFY: ${s.source_id} classifies a generated/processed artifact as an original source.`,
    );
    errors += 1;
  }
  if (s.authority_class === "UNCLASSIFIED") {
    console.error(
      `CLASSIFY: ${s.source_id} (${s.physical_filename}) is UNCLASSIFIED — assign a class.`,
    );
    errors += 1;
  }
}
if (errors) process.exit(1);
console.log(`docs:classify OK (${manifest.sources.length} classified sources verified).`);
