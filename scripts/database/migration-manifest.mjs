#!/usr/bin/env node
/**
 * Canonical Supabase migration manifest generator.
 *
 * Produces a machine-readable record of the canonical migration chain:
 * version, filename, SHA-256 checksum, group, and the KitLuy schema domains
 * each migration touches.
 *
 * WHY A CHECKSUM MANIFEST EXISTS
 * ------------------------------
 * A migration version alone does not identify a migration. Two databases can
 * both report version 20260807040000 applied while holding different SQL, and
 * nothing in Supabase's migration ledger would show it. The checksum is what
 * makes "the remote carries the canonical chain" a claim that can be checked
 * rather than assumed, which is exactly the question KLDRV-CONF-004 turned on.
 *
 * This generator is READ-ONLY. It never connects to a database, never mutates
 * a migration, and never renumbers anything.
 *
 *   node scripts/database/migration-manifest.mjs            # write the manifest
 *   node scripts/database/migration-manifest.mjs --check    # verify, exit 1 on drift
 *   node scripts/database/migration-manifest.mjs --print    # stdout only
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";
const OUTPUT = "00_AI_HANDOFF/edge-platform/canonical-migration-manifest.json";

/** `<14-digit timestamp>_<NNNN>_<name>.sql` is the canonical filename shape. */
const MIGRATION_PATTERN = /^(\d{14})_(\d{4})_(.+)\.sql$/;

function listMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/**
 * Schema domains a migration touches.
 *
 * Deliberately conservative: it reports the `kitluy_*` schemas actually named
 * in the SQL rather than guessing from the migration's title, because a
 * migration's name describes its intent and its SQL describes its effect.
 */
function schemaDomains(sql) {
  const found = new Set();
  for (const match of sql.matchAll(/\b(kitluy_[a-z_]+)\b/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

function buildManifest() {
  const files = listMigrations();
  const migrations = [];
  const problems = [];

  for (const file of files) {
    const parsed = MIGRATION_PATTERN.exec(file);
    if (parsed === null) {
      problems.push(`filename does not match the canonical pattern: ${file}`);
      continue;
    }
    const [, version, group, name] = parsed;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    migrations.push({
      version,
      group,
      name,
      filename: file,
      sha256: createHash("sha256").update(sql).digest("hex"),
      schemaDomains: schemaDomains(sql),
    });
  }

  // Ordering and uniqueness are properties worth asserting, not assuming: a
  // duplicate version silently shadows a migration in some tooling.
  const versions = migrations.map((m) => m.version);
  const duplicates = versions.filter((v, i) => versions.indexOf(v) !== i);
  for (const dup of new Set(duplicates)) {
    problems.push(`duplicate migration version: ${dup}`);
  }
  const sorted = [...versions].sort();
  if (sorted.join(",") !== versions.join(",")) {
    problems.push("migration versions are not in ascending order");
  }

  const chainDigest = createHash("sha256")
    .update(migrations.map((m) => `${m.version}:${m.sha256}`).join("\n"))
    .digest("hex");

  return {
    manifest: {
      schemaVersion: 1,
      generatedBy: basename(process.argv[1] ?? "migration-manifest.mjs"),
      migrationsDirectory: MIGRATIONS_DIR,
      migrationCount: migrations.length,
      firstVersion: versions[0] ?? null,
      lastVersion: versions[versions.length - 1] ?? null,
      // One value that identifies the entire chain, order included.
      chainDigest,
      migrations,
    },
    problems,
  };
}

const { manifest, problems } = buildManifest();
const serialised = `${JSON.stringify(manifest, null, 2)}\n`;
const mode = process.argv[2] ?? "--write";

for (const problem of problems) {
  console.error(`PROBLEM: ${problem}`);
}

if (mode === "--print") {
  process.stdout.write(serialised);
} else if (mode === "--check") {
  let existing = null;
  try {
    existing = readFileSync(OUTPUT, "utf8");
  } catch {
    console.error(`MISSING: ${OUTPUT} — run without --check to generate it.`);
    process.exit(1);
  }
  if (existing !== serialised) {
    console.error(`DRIFT: ${OUTPUT} does not match the migrations on disk.`);
    process.exit(1);
  }
  console.log(
    `Manifest current: ${manifest.migrationCount} migrations, chain ${manifest.chainDigest.slice(0, 16)}…`,
  );
} else {
  writeFileSync(OUTPUT, serialised);
  console.log(
    `Wrote ${OUTPUT}: ${manifest.migrationCount} migrations, ` +
      `${manifest.firstVersion}–${manifest.lastVersion}, chain ${manifest.chainDigest.slice(0, 16)}…`,
  );
}

process.exit(problems.length > 0 ? 1 : 0);
