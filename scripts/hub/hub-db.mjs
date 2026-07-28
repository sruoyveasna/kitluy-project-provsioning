#!/usr/bin/env node
/**
 * Store Hub local database runner (WS-09, recorded gap G6).
 *
 * WHY A SEPARATE RUNNER. Repo-wide there was exactly one migration directory
 * (`supabase/migrations`); both cloud validators hardcode it and cross-check
 * every `kitluy_*` schema against the cloud data dictionary, so an `edge_*`
 * migration placed there would FAIL. The Store Hub database is a physically
 * separate PostgreSQL database on a different device with its own canonical
 * `NNNN_name.sql` convention (schema contract §4). This runner owns it; the
 * cloud toolchain is left untouched.
 *
 * Subcommands:
 *   reset    drop + recreate the Hub database, then apply every migration
 *   apply    apply pending migrations only
 *   status   applied migrations + checksums + pending files
 *   seed     run hub/seed/dev-fixtures.sql
 *   test     run hub/tests/assertions.sql
 *   backup   development-grade pg_dump with a recorded SHA-256 + fingerprint
 *   restore  pg_restore a recorded backup and verify the fingerprint
 *
 * CHECKSUM REGISTRY (§4 "Migrations are additive and checksum-registered. An
 * applied file is never edited."): every applied file's sha256 is journalled
 * in edge_ops.migration_journal. If a previously applied file's bytes change,
 * every command REFUSES.
 *
 * LOCAL-ONLY GUARD: mirrors packages/payments-persistence/src/db.ts. Refuses
 * any non-local connection string and any production-like KITLUY_ENV.
 * Production Hub migrations are human-operated and never automatic
 * (KL-INF-P1-037, OWNER-LOCKED).
 *
 * DEVELOPMENT HOSTING: the Hub database is a SEPARATE database inside the
 * local Postgres instance already running for the cloud stack (container
 * `supabase_db_kitluy-local`, port 54322). Recorded gap G7: that server is
 * PostgreSQL 15.8 while the Hub targets 16 — no PG16-only feature is used.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const HUB_TOOLING_VERSION = "0.1.0";
const MIGRATIONS_DIR = "hub/migrations";
const SEED_FILE = "hub/seed/dev-fixtures.sql";
const ASSERTIONS_FILE = "hub/tests/assertions.sql";
const BACKUP_DIR = "hub/.backups";
const DEFAULT_HUB_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local";
const DEFAULT_CONTAINER = "supabase_db_kitluy-local";
const HUB_DB_URL_ENV = "KITLUY_HUB_DB_URL";

const command = process.argv[2];
const commandArg = process.argv[3];

// ---------------------------------------------------------------------------
// Target resolution and the local-only guard.
// ---------------------------------------------------------------------------
function hubDatabaseUrl() {
  const url = process.env[HUB_DB_URL_ENV] ?? DEFAULT_HUB_DB_URL;
  if (!/localhost|127\.0\.0\.1/.test(url)) {
    console.error(
      `REFUSED: ${HUB_DB_URL_ENV} must point at a local development database (KL-INF-P1-037, OWNER-LOCKED).`,
    );
    process.exit(1);
  }
  const env = process.env.KITLUY_ENV ?? "local";
  if (env !== "local" && env !== "development") {
    console.error(
      `REFUSED: KITLUY_ENV='${env}' — the Hub database runner only operates on local/development targets (KL-INF-P1-037).`,
    );
    process.exit(1);
  }
  return url;
}

function parseTarget(url) {
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) {
    console.error(`REFUSED: '${database}' is not a safe database identifier.`);
    process.exit(1);
  }
  return {
    database,
    user: decodeURIComponent(parsed.username || "postgres"),
    host: parsed.hostname,
    port: parsed.port || "5432",
  };
}

const target = parseTarget(hubDatabaseUrl());
const container = process.env.KITLUY_HUB_DB_CONTAINER ?? DEFAULT_CONTAINER;

// ---------------------------------------------------------------------------
// SQL execution. Host psql is optional: fall back to psql inside the local
// Postgres container (the same approach as scripts/database/db-exec.mjs).
// ---------------------------------------------------------------------------
function hasHostTool(tool) {
  return spawnSync(tool, ["--version"], { stdio: "ignore", shell: true }).status === 0;
}

const HOST_PSQL = hasHostTool("psql");
const HOST_PGDUMP = hasHostTool("pg_dump") && hasHostTool("pg_restore");

function runSql(sql, { database = target.database, capture = false, quiet = false } = {}) {
  const flags = capture ? ["-tAX"] : ["-X"];
  if (HOST_PSQL) {
    const url = `postgresql://${target.user}@${target.host}:${target.port}/${database}`;
    const res = spawnSync("psql", [url, ...flags, "-v", "ON_ERROR_STOP=1", "-f", "-"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", capture ? "pipe" : quiet ? "pipe" : "inherit", "pipe"],
    });
    return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }
  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      target.user,
      "-d",
      database,
      ...flags,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ],
    {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", capture ? "pipe" : quiet ? "pipe" : "inherit", "pipe"],
    },
  );
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function runInContainer(args) {
  const res = spawnSync("docker", ["exec", container, ...args], { stdio: "inherit" });
  return res.status ?? 1;
}

function requireTooling() {
  if (HOST_PSQL) return;
  if (spawnSync("docker", ["--version"], { stdio: "ignore" }).status !== 0) {
    console.error(
      "BLOCKED-NOT-EXECUTED: neither a host psql nor docker is available; the Hub database cannot be reached.",
    );
    process.exit(3);
  }
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function fail(message) {
  console.error(`hub-db: ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Migration set on disk.
// ---------------------------------------------------------------------------
const NAME_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

function migrationFiles() {
  if (!existsSync(MIGRATIONS_DIR)) fail(`${MIGRATIONS_DIR} does not exist.`);
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    if (!NAME_PATTERN.test(f)) fail(`migration '${f}' does not match NNNN_name.sql (§4).`);
  }
  return files.map((f) => {
    const content = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    return {
      filename: f,
      sequence: Number(NAME_PATTERN.exec(f)[1]),
      content,
      checksum: createHash("sha256").update(content, "utf8").digest("hex"),
    };
  });
}

const ENSURE_JOURNAL_SQL = `
create schema if not exists edge_ops;
create table if not exists edge_ops.migration_journal (
  filename            text primary key,
  sequence_number     integer     not null,
  checksum_sha256     char(64)    not null,
  applied_at          timestamptz not null default now(),
  execution_ms        integer     not null,
  applied_by          text        not null default current_user,
  hub_tooling_version text        not null
);
`;

function databaseExists() {
  const res = runSql(`select 1 from pg_database where datname = ${sqlLiteral(target.database)};`, {
    database: "postgres",
    capture: true,
  });
  if (res.status !== 0) fail(`could not query pg_database: ${res.stderr.trim()}`);
  return res.stdout.trim() === "1";
}

function readJournal() {
  const res = runSql(
    "select filename, sequence_number, checksum_sha256, applied_at, execution_ms, hub_tooling_version from edge_ops.migration_journal order by filename;",
    { capture: true },
  );
  if (res.status !== 0) fail(`could not read the migration journal: ${res.stderr.trim()}`);
  return res.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((line) => {
      const [filename, sequence, checksum, appliedAt, executionMs, toolingVersion] =
        line.split("|");
      return {
        filename,
        sequence: Number(sequence),
        checksum,
        appliedAt,
        executionMs,
        toolingVersion,
      };
    });
}

/**
 * §4: "An applied file is never edited." Refuse when a journalled file is
 * missing from disk, when its bytes changed, or when a NEW file would be
 * inserted before an already-applied one (forward-only ordering).
 */
function assertJournalIntegrity(files, journal) {
  const byName = new Map(files.map((f) => [f.filename, f]));
  const problems = [];
  for (const entry of journal) {
    const file = byName.get(entry.filename);
    if (!file) {
      problems.push(`applied migration '${entry.filename}' is missing from ${MIGRATIONS_DIR}`);
      continue;
    }
    if (file.checksum !== entry.checksum) {
      problems.push(
        `checksum drift on applied migration '${entry.filename}':\n` +
          `      journalled ${entry.checksum}\n` +
          `      on disk    ${file.checksum}\n` +
          "      An applied file is never edited (schema contract §4). Add a NEW migration instead.",
      );
    }
  }
  const appliedNames = new Set(journal.map((e) => e.filename));
  const lastApplied = journal
    .map((e) => e.filename)
    .sort()
    .at(-1);
  for (const file of files) {
    if (!appliedNames.has(file.filename) && lastApplied && file.filename < lastApplied) {
      problems.push(
        `pending migration '${file.filename}' sorts before the applied '${lastApplied}'; the set is forward-only`,
      );
    }
  }
  if (problems.length > 0) {
    console.error("hub-db: REFUSED — migration journal integrity failure:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
}

function applyMigration(file) {
  // Each file runs inside ONE transaction together with its journal row, so a
  // failed migration can never leave a partially applied schema and can never
  // leave a journal entry claiming success (WS-09-T005 invariant).
  const sql = [
    "begin;",
    "select set_config('kitluy.hub_migration_started', clock_timestamp()::text, true);",
    file.content,
    "insert into edge_ops.migration_journal",
    "  (filename, sequence_number, checksum_sha256, execution_ms, hub_tooling_version)",
    "values (" +
      [
        sqlLiteral(file.filename),
        String(file.sequence),
        sqlLiteral(file.checksum),
        "(extract(epoch from (clock_timestamp() - current_setting('kitluy.hub_migration_started')::timestamptz)) * 1000)::integer",
        sqlLiteral(HUB_TOOLING_VERSION),
      ].join(", ") +
      ");",
    "commit;",
  ].join("\n");
  const res = runSql(sql, { quiet: true });
  if (res.status !== 0) {
    console.error(res.stdout);
    console.error(res.stderr);
    fail(
      `migration '${file.filename}' FAILED; the transaction was rolled back and nothing was journalled.`,
    );
  }
  return res;
}

function ensureJournal() {
  const res = runSql(ENSURE_JOURNAL_SQL, { quiet: true });
  if (res.status !== 0)
    fail(`could not bootstrap edge_ops.migration_journal: ${res.stderr.trim()}`);
}

function applyPending() {
  ensureJournal();
  const files = migrationFiles();
  const journal = readJournal();
  assertJournalIntegrity(files, journal);
  const applied = new Set(journal.map((e) => e.filename));
  const pending = files.filter((f) => !applied.has(f.filename));
  if (pending.length === 0) {
    console.log(`hub-db: up to date — ${files.length} migration(s) already applied.`);
    return 0;
  }
  for (const file of pending) {
    process.stdout.write(`  applying ${file.filename} ... `);
    applyMigration(file);
    console.log(`ok  sha256=${file.checksum}`);
  }
  console.log(`hub-db: applied ${pending.length} migration(s) to '${target.database}'.`);
  return 0;
}

function createDatabase() {
  const res = runSql(`create database "${target.database}";`, {
    database: "postgres",
    quiet: true,
  });
  if (res.status !== 0)
    fail(`could not create database '${target.database}': ${res.stderr.trim()}`);
}

function dropDatabase() {
  // kitluy:destructive-approved:LOCAL-DEV-ONLY — the Hub database is
  // disposable in development (WS-09-T002..T005 "Rollback / reset"). The
  // local-only guard above has already refused any non-local target.
  const sql = [
    `select pg_terminate_backend(pid) from pg_stat_activity where datname = ${sqlLiteral(target.database)} and pid <> pg_backend_pid();`,
    `drop database if exists "${target.database}";`,
  ].join("\n");
  const res = runSql(sql, { database: "postgres", quiet: true });
  if (res.status !== 0) fail(`could not drop database '${target.database}': ${res.stderr.trim()}`);
}

// ---------------------------------------------------------------------------
// Data fingerprint — used to prove a backup/restore round trip preserved data.
// ---------------------------------------------------------------------------
const FINGERPRINT_SQL = `
select string_agg(line, E'\\n' order by line) from (
  select format('%s.%s=%s', n.nspname, c.relname,
                (xpath('/row/c/text()',
                       query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname),
                                    false, true, '')))[1]::text) as line
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname like 'edge\\_%'
) t;
`;

function fingerprint() {
  const res = runSql(FINGERPRINT_SQL, { capture: true });
  if (res.status !== 0) fail(`could not compute the data fingerprint: ${res.stderr.trim()}`);
  const body = res.stdout.trim();
  return { body, sha256: createHash("sha256").update(body, "utf8").digest("hex") };
}

function latestBackup() {
  if (!existsSync(BACKUP_DIR)) return undefined;
  return readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".dump"))
    .sort()
    .at(-1);
}

// ---------------------------------------------------------------------------
// Commands.
// ---------------------------------------------------------------------------
function cmdReset() {
  requireTooling();
  console.log(
    `hub-db: resetting LOCAL Hub database '${target.database}' (destructive to local dev data only).`,
  );
  dropDatabase();
  createDatabase();
  return applyPending();
}

function cmdApply() {
  requireTooling();
  if (!databaseExists()) createDatabase();
  return applyPending();
}

function cmdStatus() {
  requireTooling();
  if (!databaseExists()) {
    console.log(`hub-db: database '${target.database}' does not exist — run 'pnpm hub:db:reset'.`);
    return 0;
  }
  ensureJournal();
  const files = migrationFiles();
  const journal = readJournal();
  const byName = new Map(journal.map((e) => [e.filename, e]));
  console.log(`hub-db status — database '${target.database}' @ ${target.host}:${target.port}`);
  console.log("");
  console.log("  STATE     FILE                                 SHA-256");
  let drift = 0;
  let pending = 0;
  for (const file of files) {
    const entry = byName.get(file.filename);
    let state = "PENDING";
    if (entry) {
      state = entry.checksum === file.checksum ? "APPLIED" : "DRIFT";
      if (state === "DRIFT") drift += 1;
    } else {
      pending += 1;
    }
    console.log(`  ${state.padEnd(9)} ${file.filename.padEnd(36)} ${file.checksum}`);
  }
  const orphans = journal.filter((e) => !files.some((f) => f.filename === e.filename));
  for (const o of orphans) {
    console.log(
      `  MISSING   ${o.filename.padEnd(36)} ${o.checksum}  (journalled but absent on disk)`,
    );
  }
  console.log("");
  console.log(
    `  ${files.length} file(s); ${journal.length} applied, ${pending} pending, ${drift} checksum drift, ${orphans.length} missing.`,
  );
  if (drift > 0 || orphans.length > 0) {
    console.error("hub-db: REFUSED — an applied file is never edited (schema contract §4).");
    return 1;
  }
  return 0;
}

function cmdSeed() {
  requireTooling();
  if (!existsSync(SEED_FILE)) fail(`${SEED_FILE} is missing.`);
  // The RUNNER declares the approved-local context; the seed itself fails
  // closed when the GUC is absent (same contract as the cloud seed, RV-301).
  const sql =
    `select set_config('kitluy.environment', 'local', false);\n` + readFileSync(SEED_FILE, "utf8");
  const res = runSql(sql, { quiet: true });
  process.stdout.write((res.stdout ?? "") + (res.stderr ?? ""));
  return res.status;
}

function cmdTest() {
  requireTooling();
  if (!existsSync(ASSERTIONS_FILE)) fail(`${ASSERTIONS_FILE} is missing.`);
  // The assertions exercise the GOVERNED conflict procedures, which are granted
  // to kitluy_hub_runtime and not to the connecting user. Membership is taken
  // here so the harness runs that path as the role that runs it in production,
  // instead of depending on a membership some other tool happened to leave
  // behind — a cluster rebuild wipes those, and the suite then fails with
  // "permission denied for function raise_reconciliation".
  //
  // HAZARD KLRISK-HUB-001: the grantee is resolved and quoted EXPLICITLY.
  // `GRANT ... TO current_user` SEGFAULTS the PostgreSQL 15.8 development
  // server and restarts the whole cluster into crash recovery.
  const who = runSql("select current_user;", { capture: true });
  const grantee = (who.stdout || "postgres").trim().replace(/"/g, '""');
  runSql(`grant kitluy_hub_runtime, kitluy_sync_worker to "${grantee}";`, { quiet: true });
  const res = runSql(readFileSync(ASSERTIONS_FILE, "utf8"), { quiet: true });
  const output = (res.stdout ?? "") + (res.stderr ?? "");
  process.stdout.write(output);
  const passes = (output.match(/NOTICE:\s+PASS /g) ?? []).length;
  if (res.status !== 0) {
    console.error(`hub-db: assertions FAILED (${passes} PASS notice(s) before the failure).`);
    return res.status;
  }
  console.log("");
  console.log(`hub-db: assertions passed — ${passes} PASS notice(s).`);
  return 0;
}

function cmdBackup() {
  requireTooling();
  if (!databaseExists()) fail(`database '${target.database}' does not exist.`);
  mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = `${target.database}-${stamp}.dump`;
  const localPath = join(BACKUP_DIR, name);
  const before = fingerprint();

  if (HOST_PGDUMP) {
    const status = spawnSync(
      "pg_dump",
      [
        `postgresql://${target.user}@${target.host}:${target.port}/${target.database}`,
        "-Fc",
        "-f",
        localPath,
      ],
      { stdio: "inherit", shell: true },
    ).status;
    if (status !== 0) fail("pg_dump failed.");
  } else {
    const remote = `/tmp/${name}`;
    if (
      runInContainer(["pg_dump", "-U", target.user, "-d", target.database, "-Fc", "-f", remote]) !==
      0
    ) {
      fail("pg_dump failed inside the database container.");
    }
    const copy = spawnSync("docker", ["cp", `${container}:${remote}`, localPath], {
      stdio: "inherit",
    });
    if ((copy.status ?? 1) !== 0) fail("docker cp of the dump failed.");
    spawnSync("docker", ["exec", container, "rm", "-f", remote], { stdio: "ignore" });
  }

  const bytes = readFileSync(localPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  writeFileSync(
    `${localPath}.sha256`,
    [
      `${sha256}  ${name}`,
      `database=${target.database}`,
      `bytes=${bytes.length}`,
      `fingerprint_sha256=${before.sha256}`,
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`hub-db: backup written ${localPath}`);
  console.log(`  bytes              ${bytes.length}`);
  console.log(`  sha256             ${sha256}`);
  console.log(`  fingerprint_sha256 ${before.sha256}  (row counts across every edge_* relation)`);
  return 0;
}

function cmdRestore() {
  requireTooling();
  const name = commandArg ? basename(commandArg) : latestBackup();
  if (!name) fail(`no backup found in ${BACKUP_DIR}; run 'pnpm hub:db:backup' first.`);
  const localPath = join(BACKUP_DIR, name);
  if (!existsSync(localPath)) fail(`${localPath} does not exist.`);
  const manifestPath = `${localPath}.sha256`;
  if (!existsSync(manifestPath))
    fail(`${manifestPath} is missing; the backup checksum is unverifiable.`);
  const manifest = readFileSync(manifestPath, "utf8");
  const recordedSha = manifest.split(/\s+/)[0];
  const expectedFingerprint = /fingerprint_sha256=([0-9a-f]{64})/.exec(manifest)?.[1];
  const actualSha = createHash("sha256").update(readFileSync(localPath)).digest("hex");
  if (recordedSha !== actualSha) {
    fail(
      `backup checksum mismatch: recorded ${recordedSha}, actual ${actualSha}. Refusing to restore.`,
    );
  }
  console.log(`hub-db: restoring ${localPath}`);
  console.log(`  sha256 verified    ${actualSha}`);

  dropDatabase();
  createDatabase();

  if (HOST_PGDUMP) {
    const status = spawnSync(
      "pg_restore",
      [
        "-d",
        `postgresql://${target.user}@${target.host}:${target.port}/${target.database}`,
        "--exit-on-error",
        localPath,
      ],
      { stdio: "inherit", shell: true },
    ).status;
    if (status !== 0) fail("pg_restore failed.");
  } else {
    const remote = `/tmp/${name}`;
    const copy = spawnSync("docker", ["cp", localPath, `${container}:${remote}`], {
      stdio: "inherit",
    });
    if ((copy.status ?? 1) !== 0) fail("docker cp of the dump failed.");
    if (
      runInContainer([
        "pg_restore",
        "-U",
        target.user,
        "-d",
        target.database,
        "--exit-on-error",
        remote,
      ]) !== 0
    ) {
      fail("pg_restore failed inside the database container.");
    }
    spawnSync("docker", ["exec", container, "rm", "-f", remote], { stdio: "ignore" });
  }

  const after = fingerprint();
  console.log(`  fingerprint_sha256 ${after.sha256}`);
  if (expectedFingerprint && expectedFingerprint !== after.sha256) {
    console.error(
      "hub-db: RESTORE VERIFICATION FAILED — the restored row counts differ from the backup.",
    );
    console.error(after.body);
    return 1;
  }
  console.log(
    "hub-db: restore verified — every edge_* relation has the row count recorded at backup time.",
  );
  return 0;
}

switch (command) {
  case "reset":
    process.exit(cmdReset());
    break;
  case "apply":
    process.exit(cmdApply());
    break;
  case "status":
    process.exit(cmdStatus());
    break;
  case "seed":
    process.exit(cmdSeed());
    break;
  case "test":
    process.exit(cmdTest());
    break;
  case "backup":
    process.exit(cmdBackup());
    break;
  case "restore":
    process.exit(cmdRestore());
    break;
  default:
    console.error("Usage: hub-db.mjs reset|apply|status|seed|test|backup|restore [backup-name]");
    process.exit(2);
}
