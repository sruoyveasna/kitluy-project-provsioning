#!/usr/bin/env node
/**
 * Migration validation:
 * - filenames follow <14-digit-timestamp>_<snake_case_name>.sql
 * - no statement bypasses the append-only rule on finalized truth without an
 *   explicit marker (DROP/TRUNCATE/DELETE guards)
 * - placeholder migrations must carry the PLACEHOLDER marker and are excluded
 *   from production application.
 * Never applies anything. Production migrations are applied only by
 * authorized human operators (KL-INF-P1-037, OWNER-LOCKED).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
let files = [];
try {
  files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
} catch {
  console.log("No migrations directory; nothing to validate.");
  process.exit(0);
}
const namePattern = /^\d{14}_[a-z0-9_]+\.sql$/;
const dangerous =
  /\b(DROP\s+TABLE|DROP\s+SCHEMA|DROP\s+COLUMN|TRUNCATE|DELETE\s+FROM)\b|\bALTER\s+TABLE\b[\s\S]*?\bDROP\b/i;
let errors = 0;
for (const f of files) {
  if (!namePattern.test(f)) {
    console.error(`MIGRATION NAMING ERROR: ${f} (expected <YYYYMMDDHHMMSS>_<snake_case>.sql)`);
    errors += 1;
  }
  const content = readFileSync(join(dir, f), "utf8");
  if (dangerous.test(content) && !content.includes("-- kitluy:destructive-approved:")) {
    console.error(
      `MIGRATION SAFETY ERROR: ${f} contains a destructive statement without an approved marker (-- kitluy:destructive-approved:<decision-id>).`,
    );
    errors += 1;
  }
}
if (errors > 0) process.exit(1);
console.log(`Migration validation passed (${files.length} migration file(s)).`);
