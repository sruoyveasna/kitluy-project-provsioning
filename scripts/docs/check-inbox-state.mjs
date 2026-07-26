#!/usr/bin/env node
/**
 * docs:inbox-state — the inbox is a transient drop zone (owner instruction
 * KLOI-2026-07-26-001). After ingestion the originals are deleted, so a file
 * present in the inbox is either (a) a NEW un-ingested source, or (b) an
 * ingested original that should have been removed. Both fail this gate until
 * the next ingestion batch is processed (inventory -> classify -> manifests).
 */
import { readJson, listInboxFiles } from "./lib.mjs";

const manifest = readJson("docs/source/manifests/kitluy-source-document-manifest-v1.0.0.json");
const known = new Map(manifest.sources.map((s) => [s.physical_filename, s.sha256]));
const files = listInboxFiles();
if (files.length === 0) {
  console.log("docs:inbox-state OK (inbox is empty — no un-ingested sources).");
  process.exit(0);
}
console.error(`INBOX: ${files.length} file(s) awaiting ingestion:`);
for (const f of files) {
  const note = known.has(f.name)
    ? "name was used by an ingested source — must be ingested as a NEW batch entry (never overwrites the old record)"
    : "new source";
  console.error(` - ${f.name} (${note})`);
}
console.error(
  "Run the ingestion workflow for a new batch (see docs/source/000_INDEX.md), then clear the inbox.",
);
process.exit(1);
