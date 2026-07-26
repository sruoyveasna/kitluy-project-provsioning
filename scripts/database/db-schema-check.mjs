#!/usr/bin/env node
/**
 * Static schema drift check (no database required).
 *
 * Cross-checks the canonical documents only:
 *   1. the canonical schema spec (docs/data/kitluy-suite-supabase-schema-v1.0.0.md) exists
 *   2. every kitluy_* schema named in the data dictionary appears in the schema spec
 *   3. no duplicate fully-qualified canonical entity names inside either document
 *
 * Live drift comparison against a deployed database (pg_catalog observed
 * dictionary, artifacts/db/schema-diff.*) is BLOCKED-NOT-EXECUTED: it requires
 * the Supabase CLI / PostgreSQL, which are absent (BLK-002). Blocked portions
 * are reported and never fail this command; only static check failures exit
 * non-zero.
 */
import { readFileSync, existsSync } from "node:fs";

const SCHEMA_SPEC = "docs/data/kitluy-suite-supabase-schema-v1.0.0.md";
const DICTIONARY = "docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md";

let failures = 0;
const pass = (name, detail) => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. Canonical schema spec exists.
let spec = null;
if (existsSync(SCHEMA_SPEC)) {
  spec = readFileSync(SCHEMA_SPEC, "utf8");
  pass("schema-spec:present", SCHEMA_SPEC);
} else {
  fail(
    "schema-spec:present",
    `${SCHEMA_SPEC} is missing (authored by WS-02; run again after it lands)`,
  );
}

// Load dictionary.
let dict = null;
if (existsSync(DICTIONARY)) {
  dict = readFileSync(DICTIONARY, "utf8");
  pass("data-dictionary:present", DICTIONARY);
} else {
  fail("data-dictionary:present", `${DICTIONARY} is missing`);
}

// 2. Every dictionary schema appears in the schema spec.
if (dict) {
  const schemas = new Set();
  for (const line of dict.split("\n")) {
    const m = line.match(/^\|\s*`(kitluy_[a-z0-9_]+)`\s*\|/);
    if (m) schemas.add(m[1]);
  }
  for (const m of dict.matchAll(/\b(kitluy_[a-z0-9_]+)\./g)) schemas.add(m[1]);
  if (schemas.size === 0) {
    fail("data-dictionary:schemas", "no kitluy_* schemas parsed from the dictionary");
  } else {
    pass("data-dictionary:schemas", `${schemas.size} kitluy_* schema(s) in dictionary`);
  }
  if (spec) {
    const missing = [...schemas].filter((s) => !spec.includes(s)).sort();
    if (missing.length === 0) {
      pass("schema-spec:covers-dictionary", `all ${schemas.size} schemas present in spec`);
    } else {
      fail(
        "schema-spec:covers-dictionary",
        `schema(s) missing from schema spec: ${missing.join(", ")}`,
      );
    }
  } else {
    console.log(
      "SKIP  schema-spec:covers-dictionary — schema spec absent (already reported above)",
    );
  }
}

// 3. Duplicate fully-qualified canonical entity names.
function duplicateEntities(markdown, label) {
  const seen = new Map();
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\|\s*`(kitluy_[a-z0-9_]+\.[a-z0-9_]+)`\s*\|/);
    if (m) seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([name, n]) => `${name}(x${n})`);
  const total = seen.size;
  if (total === 0) {
    console.log(`SKIP  duplicate-entities:${label} — no fully-qualified entity rows found`);
    return;
  }
  if (dupes.length === 0) {
    pass(`duplicate-entities:${label}`, `${total} unique canonical entity name(s)`);
  } else {
    fail(`duplicate-entities:${label}`, `duplicates: ${dupes.join(", ")}`);
  }
}
if (dict) duplicateEntities(dict, "data-dictionary");
if (spec) duplicateEntities(spec, "schema-spec");

console.log("");
console.log(
  "BLOCKED-NOT-EXECUTED  live drift check (observed pg_catalog dictionary vs canonical spec, artifacts/db/schema-diff.*) requires Docker + Supabase CLI + a database (BLK-002). Reported only; does not fail this static command.",
);
console.log("");
if (failures > 0) {
  console.error(`db-schema-check: ${failures} static check(s) FAILED.`);
  process.exit(1);
}
console.log("db-schema-check: all static checks passed.");
