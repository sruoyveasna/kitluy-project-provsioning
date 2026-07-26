-- kitluy:group:0000
-- Migration group 0000: extensions and migration controls.
-- Plan: docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md (v1.0.0, 2026-07-26)
-- Status: SCAFFOLDED. No domain DDL is authored this cycle (see plan section 2).
-- Execution: BLOCKED (BLK-002 - Docker and Supabase CLI absent). This file has been
-- statically validated only (pnpm db:validate / pnpm migrations:validate); it has
-- NOT been applied to any database and no application is claimed.
-- Production application is human-operated with four-eyes approval and is never
-- automatic (KL-INF-P1-037, OWNER-LOCKED).

begin;

-- Extensions required by the foundation (gen_random_uuid, digest).
create extension if not exists pgcrypto;

-- Control-plane schema for migration/operations evidence. Not tenant data.
-- Allowlisted in scripts/database/db-validate.mjs as a control-plane schema
-- (it intentionally does not appear in the domain data dictionary).
create schema if not exists kitluy_ops;

comment on schema kitluy_ops is
  'Owner: Shared Platform. Migration and operations control plane; no tenant data. Sensitivity: internal. Ref: kitluy-suite-supabase-migration-plan-v1.0.0.md';

-- Append-only journal of migration applications. One row per (migration, environment)
-- application event, written by the human operator or CI shadow-apply tooling.
create table if not exists kitluy_ops.migration_journal (
  id uuid primary key default gen_random_uuid(),
  migration_id text not null,
  migration_group text not null,
  content_sha256 text not null,
  applied_by text not null,
  applied_environment text not null,
  applied_at timestamptz not null default now(),
  notes text,
  constraint migration_journal_group_format check (migration_group ~ '^[0-9]{4}$'),
  constraint migration_journal_sha_format check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint migration_journal_unique_application unique (migration_id, applied_environment)
);

comment on table kitluy_ops.migration_journal is
  'Owner: Shared Platform. Append-only migration application evidence (id, group, content hash, actor, environment, time). Corrections append new rows; UPDATE and DELETE are prohibited for application roles. Ref: kitluy-suite-supabase-migration-plan-v1.0.0.md section 4.';

comment on column kitluy_ops.migration_journal.migration_id is
  'Migration filename without extension, e.g. 20260726180000_0000_extensions_and_migration_controls.';

comment on column kitluy_ops.migration_journal.content_sha256 is
  'Lowercase hex SHA-256 of the applied migration file content.';

comment on column kitluy_ops.migration_journal.applied_by is
  'Human operator identity (pilot/production) or CI shadow-apply identity (non-production).';

-- Fail-closed posture: application roles get no direct rights on the journal.
-- Append path is the governed apply procedure; broader RLS enablement follows in
-- migration group 0120 per the plan.
revoke all on schema kitluy_ops from public;

revoke all on kitluy_ops.migration_journal from public;

commit;
