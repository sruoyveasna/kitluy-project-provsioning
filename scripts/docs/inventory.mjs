#!/usr/bin/env node
/**
 * Phase A — immutable inventory of docs/source/inbox (KL-DOCS-001).
 * Read-only over the inbox; writes only the inventory manifests.
 */
import { readFileSync, writeFileSync } from "node:fs";
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

const files = listInboxFiles();
const byHash = new Map();
const rows = files.map((f) => {
  const hash = sha256(f.path);
  const declared = f.name.endsWith(".md")
    ? extractDeclared(f.path, f.name)
    : extractDeclared(f.path, f.name);
  const row = {
    relative_path: `${INBOX}/${f.name}`,
    physical_filename: f.name,
    sha256: hash,
    file_size: f.bytes,
    file_type: fileType(f.name),
    declared_title: declared.title ?? "",
    declared_filename: declared.declaredFilename ?? "",
    declared_version: declared.version ?? "",
    declared_date: declared.date ?? "",
    declared_owner: declared.owner ?? "",
    declared_status: declared.status ?? "",
    duplicate_of: "",
    filename_mismatch: "",
  };
  if (byHash.has(hash)) row.duplicate_of = byHash.get(hash);
  else byHash.set(hash, f.name);
  if (row.declared_filename && row.declared_filename !== f.name) {
    row.filename_mismatch = row.declared_filename;
  }
  return row;
});

// Declared-vs-physical checks against pack manifests shipped inside the inbox.
const packChecks = [];
function checkPack(source, entries) {
  for (const e of entries) {
    const match = rows.find((r) => r.physical_filename === e.file);
    if (!match) {
      packChecks.push({
        pack: source,
        file: e.file,
        issue: "listed in pack manifest but not physically present",
      });
      continue;
    }
    if (e.bytes !== undefined && e.bytes !== match.file_size) {
      packChecks.push({
        pack: source,
        file: e.file,
        issue: `declared ${e.bytes} bytes, physical ${match.file_size} bytes`,
      });
    }
    if (e.sha256 && e.sha256 !== match.sha256) {
      packChecks.push({
        pack: source,
        file: e.file,
        issue: "declared sha256 differs from physical file",
      });
    }
  }
}
try {
  const sec = JSON.parse(readFileSync(join(INBOX, "manifest.json"), "utf8"));
  checkPack(
    "security pack (manifest.json)",
    sec.map((e) => ({ file: e.filename, bytes: e.bytes })),
  );
} catch {
  /* absent */
}
try {
  const ui = JSON.parse(readFileSync(join(INBOX, "manifest copy.json"), "utf8"));
  checkPack("ui-ux pack (manifest copy.json)", ui.files);
} catch {
  /* absent */
}
try {
  const supa = readFileSync(
    join(INBOX, "kitluy-suite-supabase-implementation-pack-v1.0.0.sha256"),
    "utf8",
  );
  const entries = supa
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, file] = l.trim().split(/\s+/);
      return { file, sha256: hash };
    });
  checkPack("supabase pack (.sha256)", entries);
} catch {
  /* absent */
}

const inventory = {
  inventory_version: "1.0.0",
  generated_for_task: "KL-DOCS-001",
  inbox_path: INBOX,
  file_count: rows.length,
  excluded_system_files: [".DS_Store", ".gitkeep"],
  files: rows,
  pack_manifest_discrepancies: packChecks,
};

writeFileSync(
  join(MANIFESTS, "kitluy-inbox-inventory-v1.0.0.json"),
  JSON.stringify(inventory, null, 2) + "\n",
);

const header = Object.keys(rows[0]);
const csv =
  [header.join(","), ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(","))].join("\n") +
  "\n";
writeFileSync(join(MANIFESTS, "kitluy-inbox-inventory-v1.0.0.csv"), csv);

const dupes = rows.filter((r) => r.duplicate_of);
const md = `# KitLuy Inbox Inventory — v1.0.0

Immutable Phase A inventory (task KL-DOCS-001). ${rows.length} physical source
files in \`${INBOX}/\` (system artifacts .DS_Store/.gitkeep recorded as excluded).
Original inbox files are never modified.

## Exact duplicate hashes

${dupes.length === 0 ? "None detected." : dupes.map((d) => `- ${d.physical_filename} duplicates ${d.duplicate_of}`).join("\n")}

## Declared-filename vs physical-filename differences

${
  rows
    .filter((r) => r.filename_mismatch)
    .map((r) => `- ${r.physical_filename}: declares \`${r.filename_mismatch}\``)
    .join("\n") || "None detected."
}

## Pack-manifest discrepancies (declared vs physical)

${packChecks.length === 0 ? "None." : packChecks.map((p) => `- **${p.file}** (${p.pack}): ${p.issue}`).join("\n")}

## Files

| # | Physical filename | Bytes | SHA-256 (first 16) | Title | Version | Date | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((r, i) => `| ${i + 1} | ${r.physical_filename} | ${r.file_size} | \`${r.sha256.slice(0, 16)}\` | ${r.declared_title.slice(0, 60)} | ${r.declared_version} | ${r.declared_date} | ${r.declared_status.slice(0, 40)} |`).join("\n")}
`;
writeFileSync(join(MANIFESTS, "kitluy-inbox-inventory-v1.0.0.md"), md);
console.log(
  `Inventory written: ${rows.length} files, ${dupes.length} exact duplicates, ${packChecks.length} pack discrepancies.`,
);
