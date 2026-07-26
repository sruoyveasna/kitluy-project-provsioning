#!/usr/bin/env node
/** docs:hash — recompute inbox hashes and compare against the source manifest. */
import { readJson, listInboxFiles, sha256 } from "./lib.mjs";

const manifest = readJson("docs/source/manifests/kitluy-source-document-manifest-v1.0.0.json");
const byName = new Map(manifest.sources.map((s) => [s.physical_filename, s]));
let errors = 0;
for (const f of listInboxFiles()) {
  const entry = byName.get(f.name);
  if (!entry) {
    console.error(`HASH CHECK: inbox file ${f.name} has NO manifest entry.`);
    errors += 1;
    continue;
  }
  const h = sha256(f.path);
  if (h !== entry.sha256) {
    console.error(
      `HASH CHECK: ${f.name} physical hash ${h.slice(0, 12)}… != manifest ${entry.sha256.slice(0, 12)}… (inbox originals must never be modified).`,
    );
    errors += 1;
  }
}
if (errors) process.exit(1);
console.log(`docs:hash OK (${manifest.sources.length} sources verified).`);
