#!/usr/bin/env node
/**
 * Static migration validation harness (no database required).
 *
 * Validates supabase/migrations/*.sql against the conventions in
 * docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md:
 *   1. filename pattern <YYYYMMDDHHMMSS>_<NNNN>_<snake_case>.sql
 *   2. machine-readable group marker matching the filename group token
 *   3. group order consistent with timestamp (lexicographic) order
 *   4. parse sanity: balanced single quotes, final statement terminated with ";"
 *   5. destructive-statement guard (approved marker required)
 *   6. every kitluy_* schema referenced by a migration appears in the canonical
 *      data dictionary (control-plane schemas are explicitly allowlisted)
 *
 * Execution-dependent verification (shadow apply, RLS behavior, seeds) is
 * reported as BLOCKED-NOT-EXECUTED and does NOT fail this command (BLK-002:
 * Docker/Supabase CLI absent). This command exits non-zero ONLY when a static
 * check fails. It never applies anything (KL-INF-P1-037, OWNER-LOCKED).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const DICTIONARY = "docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md";
// Control-plane schemas deliberately absent from the domain data dictionary
// (see migration plan group 0000).
const CONTROL_PLANE_SCHEMAS = new Set(["kitluy_ops"]);

const NAME_PATTERN = /^\d{14}_\d{4}_[a-z0-9_]+\.sql$/;
const GROUP_MARKER = /^--\s*kitluy:group:(\d{4})\s*$/m;
const DESTRUCTIVE = /\b(DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/i;

let failures = 0;
const pass = (name, detail) => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};

function stripLineComments(sql) {
  return sql
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("--");
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join("\n");
}

let files = [];
if (existsSync(MIGRATIONS_DIR)) {
  files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}
if (files.length === 0) {
  pass("migrations:present", "no .sql files yet; nothing further to validate");
} else {
  pass("migrations:present", `${files.length} migration file(s) found`);
}

// Dictionary schema set (for check 6).
let dictionarySchemas = new Set();
if (existsSync(DICTIONARY)) {
  const dict = readFileSync(DICTIONARY, "utf8");
  for (const m of dict.matchAll(/`(kitluy_[a-z0-9_]+)`/g)) dictionarySchemas.add(m[1]);
  for (const m of dict.matchAll(/\b(kitluy_[a-z0-9_]+)\./g)) dictionarySchemas.add(m[1]);
  pass("dictionary:present", `${dictionarySchemas.size} kitluy_* schema names loaded`);
} else {
  fail("dictionary:present", `${DICTIONARY} is missing; schema cross-check impossible`);
}

let previousGroup = -1;
for (const f of files) {
  const path = join(MIGRATIONS_DIR, f);
  const content = readFileSync(path, "utf8");
  const isPlaceholder = content.startsWith("-- kitluy:PLACEHOLDER");

  // 1. Naming.
  if (NAME_PATTERN.test(f)) {
    pass(`naming:${f}`);
  } else {
    fail(`naming:${f}`, "expected <YYYYMMDDHHMMSS>_<NNNN>_<snake_case>.sql");
    continue;
  }
  const fileGroup = f.slice(15, 19);

  // 2. Group marker.
  const marker = content.match(GROUP_MARKER);
  if (marker && marker[1] === fileGroup) {
    pass(`group-marker:${f}`, `kitluy:group:${fileGroup}`);
  } else if (marker) {
    fail(`group-marker:${f}`, `marker ${marker[1]} does not match filename group ${fileGroup}`);
  } else {
    fail(`group-marker:${f}`, "missing '-- kitluy:group:NNNN' marker");
  }

  // 3. Group/timestamp monotonicity (files iterated in lexicographic order).
  const groupNumber = Number(fileGroup);
  if (groupNumber >= previousGroup) {
    pass(`group-order:${f}`);
    previousGroup = groupNumber;
  } else {
    fail(
      `group-order:${f}`,
      `group ${fileGroup} sorts after group ${String(previousGroup).padStart(4, "0")}; timestamp order must equal group order`,
    );
  }

  // 4. Parse sanity.
  const code = stripLineComments(content);
  const quoteCount = (code.match(/'/g) ?? []).length;
  if (quoteCount % 2 === 0) {
    pass(`quotes-balanced:${f}`);
  } else {
    fail(`quotes-balanced:${f}`, "odd number of single quotes outside comments");
  }
  const lastStatementLine = code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .at(-1);
  if (isPlaceholder || (lastStatementLine && lastStatementLine.endsWith(";"))) {
    pass(`terminated:${f}`);
  } else {
    fail(`terminated:${f}`, "final statement does not end with ';'");
  }

  // 5. Destructive guard.
  if (DESTRUCTIVE.test(content) && !content.includes("-- kitluy:destructive-approved:")) {
    fail(
      `destructive-guard:${f}`,
      "destructive statement without '-- kitluy:destructive-approved:<decision-id>'",
    );
  } else {
    pass(`destructive-guard:${f}`);
  }

  // 6. Schema cross-check.
  if (dictionarySchemas.size > 0) {
    const referenced = new Set();
    for (const m of code.matchAll(
      /create\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    ))
      referenced.add(m[1].toLowerCase());
    for (const m of code.matchAll(/\b(kitluy_[a-z0-9_]+)\s*\./g)) referenced.add(m[1]);
    const unknown = [...referenced].filter(
      (s) => s.startsWith("kitluy_") && !dictionarySchemas.has(s) && !CONTROL_PLANE_SCHEMAS.has(s),
    );
    if (unknown.length === 0) {
      const allowlisted = [...referenced].filter((s) => CONTROL_PLANE_SCHEMAS.has(s));
      pass(
        `schemas-in-dictionary:${f}`,
        allowlisted.length > 0
          ? `control-plane allowlist used: ${allowlisted.join(", ")}`
          : undefined,
      );
    } else {
      fail(
        `schemas-in-dictionary:${f}`,
        `schema(s) not in data dictionary or control-plane allowlist: ${unknown.join(", ")}`,
      );
    }
  }
}

console.log("");
console.log(
  "BLOCKED-NOT-EXECUTED  shadow-database apply, RLS policy behavior (RLS-001..030), and seed verification require Docker + Supabase CLI (BLK-002). These portions were reported, not executed, and do not fail this static command.",
);
console.log(
  "NOTE  production migrations are never applied automatically (KL-INF-P1-037); this harness validates files only.",
);
console.log("");
if (failures > 0) {
  console.error(`db-validate: ${failures} static check(s) FAILED.`);
  process.exit(1);
}
console.log(`db-validate: all static checks passed (${files.length} migration file(s)).`);
