#!/usr/bin/env node
/**
 * Static validation for the Store Hub migration set (no database required).
 *
 * The cloud harness (scripts/database/db-validate.mjs) hardcodes
 * `supabase/migrations`, requires the `<YYYYMMDDHHMMSS>_<NNNN>_<name>.sql`
 * cloud convention and cross-checks every schema against the CLOUD data
 * dictionary — an `edge_*` migration there would fail on all three counts
 * (recorded gap G6). This harness is the Hub-side equivalent and the cloud
 * one is left untouched.
 *
 * Checks, against docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md:
 *   1. filename pattern NNNN_snake_case.sql (§4)
 *   2. machine-readable `-- kitluy:hub:migration:NNNN` marker matching the name
 *   3. strictly increasing, unique sequence numbers starting at 0000 (§4)
 *   4. parse sanity: balanced string/dollar quotes and a terminated final statement
 *   5. destructive-statement guard (approved marker required)
 *   6. every edge_* schema referenced is one of the TEN canonical schemas of §2
 *      (edge_ops is the allowlisted migration control plane, gap G6)
 *   7. money/quantity type guard: no float, real, double precision or money
 *      column may exist anywhere (§1; repository rule 12)
 *
 * This command never connects to a database and never applies anything
 * (KL-INF-P1-037, OWNER-LOCKED).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "hub/migrations";
const NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;
const MARKER = /^--\s*kitluy:hub:migration:(\d{4})\s*$/m;
const DESTRUCTIVE =
  /\b(DROP\s+TABLE|DROP\s+SCHEMA|DROP\s+DATABASE|TRUNCATE|DELETE\s+FROM|DROP\s+COLUMN)\b/i;
const FLOAT_TYPES = /\b(float4|float8|real|double\s+precision|money)\b/i;

// §2, verbatim. Exactly ten; edge_ops is tooling, not a business schema.
const CANONICAL_SCHEMAS = new Set([
  "edge_identity",
  "edge_config",
  "edge_core",
  "edge_laundry",
  "edge_payments",
  "edge_documents",
  "edge_files",
  "edge_sync",
  "edge_hardware",
  "edge_audit",
]);
const CONTROL_PLANE_SCHEMAS = new Set(["edge_ops"]);

let failures = 0;
const pass = (name, detail) => console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
const fail = (name, detail) => {
  failures += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};

/**
 * Strip comments and quoted text with a real scanner rather than a regex, so
 * that `--` inside a string, `'` inside a dollar-quoted plpgsql body and
 * nested block comments cannot produce a false verdict. Returns the code with
 * every literal replaced by a placeholder, plus a balance report.
 */
function scan(sql) {
  let out = "";
  let i = 0;
  let unterminatedString = false;
  let unterminatedDollar = null;
  let unterminatedBlockComment = false;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === "--") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (two === "/*") {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql.slice(i, i + 2) === "/*") {
          depth += 1;
          i += 2;
        } else if (sql.slice(i, i + 2) === "*/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) unterminatedBlockComment = true;
      continue;
    }
    if (sql[i] === "'") {
      i += 1;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          closed = true;
          break;
        }
        i += 1;
      }
      if (!closed) unterminatedString = true;
      out += "''";
      continue;
    }
    if (sql[i] === "$") {
      const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const token = tag[0];
        const end = sql.indexOf(token, i + token.length);
        if (end === -1) {
          unterminatedDollar = token;
          i = sql.length;
        } else {
          i = end + token.length;
        }
        out += " $BODY$ ";
        continue;
      }
    }
    out += sql[i];
    i += 1;
  }
  return { code: out, unterminatedString, unterminatedDollar, unterminatedBlockComment };
}

if (!existsSync(MIGRATIONS_DIR)) {
  console.error(`FAIL  migrations:present — ${MIGRATIONS_DIR} does not exist`);
  process.exit(1);
}

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  fail("migrations:present", `no .sql files in ${MIGRATIONS_DIR}`);
} else {
  pass("migrations:present", `${files.length} Hub migration file(s) found`);
}

let previousSequence = -1;
const seenSequences = new Set();

for (const f of files) {
  const content = readFileSync(join(MIGRATIONS_DIR, f), "utf8");

  // 1. Naming (§4).
  const nameMatch = NAME_PATTERN.exec(f);
  if (!nameMatch) {
    fail(`naming:${f}`, "expected NNNN_snake_case.sql (schema contract §4)");
    continue;
  }
  pass(`naming:${f}`);
  const sequence = Number(nameMatch[1]);

  // 2. Marker.
  const marker = MARKER.exec(content);
  if (marker && Number(marker[1]) === sequence) {
    pass(`marker:${f}`, `kitluy:hub:migration:${nameMatch[1]}`);
  } else if (marker) {
    fail(`marker:${f}`, `marker ${marker[1]} does not match filename sequence ${nameMatch[1]}`);
  } else {
    fail(`marker:${f}`, "missing '-- kitluy:hub:migration:NNNN' marker");
  }

  // 3. Ordering (§4: the set is ordered and forward-only).
  if (seenSequences.has(sequence)) {
    fail(`order:${f}`, `duplicate sequence number ${nameMatch[1]}`);
  } else if (sequence <= previousSequence) {
    fail(`order:${f}`, `sequence ${nameMatch[1]} does not increase past ${previousSequence}`);
  } else {
    if (previousSequence === -1 && sequence !== 0) {
      fail(`order:${f}`, "the set must start at 0000 (schema contract §4)");
    } else {
      pass(`order:${f}`);
    }
    previousSequence = sequence;
  }
  seenSequences.add(sequence);

  // 4. Parse sanity.
  const scanned = scan(content);
  if (scanned.unterminatedString) {
    fail(`quotes-balanced:${f}`, "unterminated single-quoted string");
  } else if (scanned.unterminatedDollar) {
    fail(`quotes-balanced:${f}`, `unterminated dollar-quoted body ${scanned.unterminatedDollar}`);
  } else if (scanned.unterminatedBlockComment) {
    fail(`quotes-balanced:${f}`, "unterminated /* block comment");
  } else {
    pass(`quotes-balanced:${f}`);
  }

  const lastStatementLine = scanned.code
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .at(-1);
  if (lastStatementLine && lastStatementLine.endsWith(";")) {
    pass(`terminated:${f}`);
  } else {
    fail(`terminated:${f}`, "final statement does not end with ';'");
  }

  // 5. Destructive guard — evaluated on code, so prose in comments cannot
  //    trip it and cannot hide a real destructive statement either.
  if (DESTRUCTIVE.test(scanned.code) && !content.includes("-- kitluy:destructive-approved:")) {
    fail(
      `destructive-guard:${f}`,
      "destructive statement without '-- kitluy:destructive-approved:<decision-id>'",
    );
  } else {
    pass(`destructive-guard:${f}`);
  }

  // 6. Canonical schema cross-check (§2).
  const referenced = new Set();
  for (const m of scanned.code.matchAll(
    /create\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
  )) {
    referenced.add(m[1].toLowerCase());
  }
  for (const m of scanned.code.matchAll(/\b(edge_[a-z0-9_]+)\s*\./g)) {
    referenced.add(m[1].toLowerCase());
  }
  const unknown = [...referenced].filter(
    (s) => s.startsWith("edge_") && !CANONICAL_SCHEMAS.has(s) && !CONTROL_PLANE_SCHEMAS.has(s),
  );
  const nonEdge = [...referenced].filter((s) => !s.startsWith("edge_"));
  if (unknown.length > 0) {
    fail(
      `schemas-canonical:${f}`,
      `schema(s) outside the ten canonical §2 schemas (and the edge_ops control plane): ${unknown.join(", ")}`,
    );
  } else if (nonEdge.length > 0) {
    fail(
      `schemas-canonical:${f}`,
      `non-edge schema created in the Hub database: ${nonEdge.join(", ")}`,
    );
  } else {
    const allowlisted = [...referenced].filter((s) => CONTROL_PLANE_SCHEMAS.has(s));
    pass(
      `schemas-canonical:${f}`,
      allowlisted.length > 0
        ? `control-plane allowlist used: ${allowlisted.join(", ")}`
        : undefined,
    );
  }

  // 7. Money/quantity type guard (§1; repository rule 12).
  if (FLOAT_TYPES.test(scanned.code)) {
    fail(
      `no-floating-point:${f}`,
      "floating-point or `money` column type found; §1 requires integer minor units and numeric(18,4)",
    );
  } else {
    pass(`no-floating-point:${f}`);
  }
}

// Cross-file: the ten canonical schemas must all be created by the set.
const created = new Set();
for (const f of files) {
  const { code } = scan(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
  for (const m of code.matchAll(
    /create\s+schema\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
  )) {
    created.add(m[1].toLowerCase());
  }
}
const missing = [...CANONICAL_SCHEMAS].filter((s) => !created.has(s));
if (missing.length === 0) {
  pass("schemas-complete", "all ten §2 schemas are created by the migration set");
} else {
  fail("schemas-complete", `missing schema creation for: ${missing.join(", ")}`);
}

console.log("");
console.log(
  "NOTE  production Hub migrations are never applied automatically (KL-INF-P1-037); this harness validates files only.",
);
console.log(
  "NOTE  execution-dependent verification runs separately: pnpm hub:db:reset, hub:db:seed, hub:db:test.",
);
console.log("");
if (failures > 0) {
  console.error(`hub-validate: ${failures} static check(s) FAILED.`);
  process.exit(1);
}
console.log(`hub-validate: all static checks passed (${files.length} Hub migration file(s)).`);
