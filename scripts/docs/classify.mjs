#!/usr/bin/env node
/**
 * Phase B + C — create immutable classified copies and the complete source
 * manifest (KL-DOCS-001). Originals in the inbox are never modified or moved.
 * Source IDs are stable: once assigned in the manifest they are never
 * reassigned (the generator preserves existing assignments on re-run).
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  csvEscape,
  extractDeclared,
  fileType,
  INBOX,
  listInboxFiles,
  MANIFESTS,
  sha256,
} from "./lib.mjs";
import { classify } from "./classification-map.mjs";

const INGESTED_AT = "2026-07-26T16:00:00+07:00";
const MANIFEST_BASE = join(MANIFESTS, "kitluy-source-document-manifest-v1.0.0");

// Preserve previously assigned source IDs.
const existingIds = new Map();
if (existsSync(`${MANIFEST_BASE}.json`)) {
  const prev = JSON.parse(readFileSync(`${MANIFEST_BASE}.json`, "utf8"));
  for (const e of prev.sources) existingIds.set(e.physical_filename, e.source_id);
}

const files = listInboxFiles();
if (files.length === 0) {
  console.log(
    "Inbox is empty — nothing to classify. The existing source manifest is preserved (ingested originals were deleted per KLOI-2026-07-26-001; classified copies are the surviving originals).",
  );
  process.exit(0);
}
let nextId = 1;
const usedIds = new Set(existingIds.values());
function allocId(name) {
  if (existingIds.has(name)) return existingIds.get(name);
  let id;
  do {
    id = `KLSRC-${String(nextId).padStart(4, "0")}`;
    nextId += 1;
  } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

const entries = files.map((f) => {
  const c = classify(f.name);
  const declared = extractDeclared(f.path, f.name);
  const classifiedDir = join("docs/source", c.dir);
  mkdirSync(classifiedDir, { recursive: true });
  const classifiedPath = join(classifiedDir, f.name);
  copyFileSync(f.path, classifiedPath);
  return {
    source_id: allocId(f.name),
    original_path: `${INBOX}/${f.name}`,
    classified_path: classifiedPath,
    physical_filename: f.name,
    declared_filename: declared.declaredFilename ?? "",
    document_title: declared.title ?? "",
    version: declared.version ?? "",
    document_date: declared.date ?? "",
    declared_owner: declared.owner ?? "",
    declared_status: declared.status ?? "",
    sha256: sha256(f.path),
    file_size: f.bytes,
    file_type: fileType(f.name),
    authority_class: c.authority_class,
    canonical_status: c.canonical_status ?? "CANONICAL-CURRENT",
    document_role: c.document_role,
    product_or_domain: c.product_or_domain ?? "",
    vertical: c.vertical ?? "",
    supersedes: c.supersedes ?? "",
    superseded_by: "",
    duplicate_of: "",
    conflicts_with: c.conflicts_with ?? "",
    implementation_evidence: "NONE",
    ingested_at: INGESTED_AT,
    notes: c.notes ?? "",
  };
});

const manifest = {
  manifest_version: "1.0.0",
  task: "KL-DOCS-001",
  ingested_at: INGESTED_AT,
  source_count: entries.length,
  note: "Source IDs are stable and never reassigned. Originals live in docs/source/inbox/ and are never modified; classified copies are immutable.",
  missing_expected_inputs: [
    {
      expected:
        "Pasted text.txt (owner documentation-program instruction; to be classified as kitluy-ai-build-readiness-document-program-v1.0.0.md)",
      status:
        "NOT PHYSICALLY PRESENT in docs/source/inbox/ at ingestion time — the special authority instruction for it could not be executed. Recorded in the coverage matrix and reconciliation register.",
    },
  ],
  sources: entries,
};
writeFileSync(`${MANIFEST_BASE}.json`, JSON.stringify(manifest, null, 2) + "\n");

const header = Object.keys(entries[0]);
writeFileSync(
  `${MANIFEST_BASE}.csv`,
  [header.join(","), ...entries.map((e) => header.map((h) => csvEscape(e[h])).join(","))].join(
    "\n",
  ) + "\n",
);

const byDir = {};
for (const e of entries) {
  const dir = e.classified_path.split("/")[2];
  (byDir[dir] ??= []).push(e);
}
const md = `# KitLuy Source Document Manifest — v1.0.0

Complete manifest of the owner-supplied corpus (task KL-DOCS-001, ingested
${INGESTED_AT}). ${entries.length} sources. Source IDs are stable and never
reassigned. Originals: \`docs/source/inbox/\` (immutable). CSV/JSON forms of
this manifest are authoritative for tooling; this file is the human view.

**Missing expected input:** \`Pasted text.txt\` (the owner
documentation-program instruction) was NOT physically present at ingestion —
its special classification instruction could not be executed and is recorded
as an open item (see coverage matrix and reconciliation register).

${Object.entries(byDir)
  .sort()
  .map(
    ([dir, list]) => `## ${dir}/ (${list.length})

| ID | File | Version | Authority class | Role | Status |
| --- | --- | --- | --- | --- | --- |
${list.map((e) => `| ${e.source_id} | ${e.physical_filename} | ${e.version} | ${e.authority_class} | ${e.document_role.slice(0, 48)} | ${e.canonical_status} |`).join("\n")}`,
  )
  .join("\n\n")}
`;
writeFileSync(`${MANIFEST_BASE}.md`, md);
console.log(`Classified ${entries.length} sources into ${Object.keys(byDir).length} directories.`);
const unclassified = entries.filter((e) => e.authority_class === "UNCLASSIFIED");
if (unclassified.length) {
  console.log("UNCLASSIFIED:", unclassified.map((e) => e.physical_filename).join(", "));
}
