-- kitluy:hub:migration:0000
-- ===========================================================================
-- KitLuy Store Hub local database — extensions, schemas, roles.
--
-- Authority:
--   docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md
--     §2 (the ten local schemas), §3 (database roles), §4 (migration order).
--   docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md
--     R1  Hub-local relation names are SINGULAR and binding.
--     G6  No Hub migration tooling existed; scripts/hub/ is built for this set.
--     G7  Production target is PostgreSQL 16; development runs 15.8. No
--         PG16-only feature is used in any file of this migration set.
--
-- This database is PHYSICALLY SEPARATE from the KitLuy Cloud database. It is
-- never reachable from POS terminals (§1 "Access"); only kitluy-hub-agent
-- roles connect. Production application of these files is human-operated and
-- never automatic (KL-INF-P1-037, OWNER-LOCKED).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
-- NONE required. `gen_random_uuid()` is core from PostgreSQL 13 and
-- `sha256(bytea)` is core from PostgreSQL 11, so this set needs no contrib
-- module. Keeping the extension surface empty makes the file byte-identical
-- on the PG16 Hub image and the PG15.8 development server (gap G7) and keeps
-- the Hub OS image minimal.
--
-- Primary keys are application-generated UUIDv7 (§1) supplied by the Hub
-- agent; columns are therefore declared `uuid` with NO server default. The
-- only exceptions are explicitly marked below and in later files.

-- ---------------------------------------------------------------------------
-- Schemas (§2) — exactly ten. No vertical-specific table may live in
-- edge_core; later verticals add their own schema.
-- ---------------------------------------------------------------------------
create schema if not exists edge_identity;
create schema if not exists edge_config;
create schema if not exists edge_core;
create schema if not exists edge_laundry;
create schema if not exists edge_payments;
create schema if not exists edge_documents;
create schema if not exists edge_files;
create schema if not exists edge_sync;
create schema if not exists edge_hardware;
create schema if not exists edge_audit;

comment on schema edge_identity is 'Hub, installation, credential, terminal and actor cache (schema contract §2).';
comment on schema edge_config is 'Signed configuration snapshots, sections and activations (§2).';
comment on schema edge_core is 'Customers, shifts, cash movements and local business sequences (§2). Neutral: NO vertical-specific table.';
comment on schema edge_laundry is 'Phase 1 Laundry: bookings, garments, tags, storage and custody (§2).';
comment on schema edge_payments is 'Payments, tender legs, attempts and compensating adjustments (§2).';
comment on schema edge_documents is 'Receipts, print jobs and print attempts (§2).';
comment on schema edge_files is 'Local asset metadata and resumable transfer state (§2).';
comment on schema edge_sync is 'Events, outbox, inbox, cursors, conflicts and dead letters (§2).';
comment on schema edge_hardware is 'Peripheral bindings, observations and heartbeats (§2).';
comment on schema edge_audit is 'Immutable audit, security and support-session evidence (§2).';

-- ---------------------------------------------------------------------------
-- Migration control plane (gap G6).
--
-- edge_ops is NOT one of the ten business schemas of §2; it holds only the
-- Hub migration journal, exactly as the cloud side keeps `kitluy_ops` out of
-- the domain data dictionary. scripts/hub/hub-validate.mjs allowlists it and
-- rejects every other non-canonical edge_* schema.
--
-- The runner (scripts/hub/hub-db.mjs) bootstraps this table with an identical
-- definition before applying anything, so a database can be journalled from
-- the very first file. Repeating it here keeps the schema reconstructable
-- from the migration set alone (§12 acceptance test 10).
-- ---------------------------------------------------------------------------
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

comment on schema edge_ops is 'Hub migration control plane (gap G6). Not a §2 business schema; holds the checksum-registered migration journal only.';
comment on table edge_ops.migration_journal is 'Checksum registry for hub/migrations (§4 "Migrations are additive and checksum-registered. An applied file is never edited."). scripts/hub/hub-db.mjs REFUSES to run when an applied file''s sha256 changed.';

-- ---------------------------------------------------------------------------
-- Roles (§3). Cluster-global objects: created only when absent so that
-- `hub:db:reset` (which drops the DATABASE) stays repeatable.
--
-- NOLOGIN by design here: the Hub image provisions authentication material
-- outside version control. No password, key or credential is ever written by
-- a migration (repository rule 4).
-- ---------------------------------------------------------------------------
do $$
declare
  r text;
begin
  foreach r in array array[
    'kitluy_migrator', 'kitluy_hub_runtime', 'kitluy_sync_worker',
    'kitluy_backup', 'kitluy_support_ro'
  ] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;

comment on role kitluy_migrator is 'Signed migration runner (§3): DDL during controlled maintenance only.';
comment on role kitluy_hub_runtime is 'Main Hub services (§3): required DML plus stored procedures.';
comment on role kitluy_sync_worker is 'Outbox/inbox and reconciliation (§3): restricted sync tables plus approved projection procedures.';
comment on role kitluy_backup is 'Encrypted backup (§3): read-only plus backup functions.';
comment on role kitluy_support_ro is 'Consent-bound diagnostic session (§3): redacted views only; no business writes.';

-- Schema-level access. Table-level grants are applied in 0012 once every
-- relation exists, so this file grants only traversal.
grant usage on schema
  edge_identity, edge_config, edge_core, edge_laundry, edge_payments,
  edge_documents, edge_files, edge_sync, edge_hardware, edge_audit
  to kitluy_hub_runtime, kitluy_sync_worker, kitluy_backup, kitluy_support_ro;

grant usage, create on schema
  edge_identity, edge_config, edge_core, edge_laundry, edge_payments,
  edge_documents, edge_files, edge_sync, edge_hardware, edge_audit, edge_ops
  to kitluy_migrator;

grant usage on schema edge_ops to kitluy_hub_runtime, kitluy_backup;
