# KitLuy Database Coding Standard

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.

## 1. Scope and database baseline

This standard applies to Supabase PostgreSQL and Store Hub local PostgreSQL. The compatibility target is PostgreSQL `17.10`. Supabase-managed patch versions are recorded per environment; the repository owns schema, migrations, RLS, functions, tests and evidence—not the provider's patch schedule.

SQL migrations are final deployed schema truth. Documentation and generated types validate migrations; they do not replace them.

## 2. Schema ownership

Use domain schemas such as `core`, `identity`, `catalog`, `pricing`, `transactions`, `payments`, `inventory`, `finance`, `laundry`, `devices`, `sync`, `files`, `notifications`, `integrations`, `audit` and `reporting`. Exact canonical schema names must match the Supabase schema pack.

Every table, view, function and type has one owner. Cross-domain writes occur through approved functions/use cases, not arbitrary grants.

## 3. Naming

- Schemas, tables, columns, constraints, indexes and functions: lowercase `snake_case`.
- Tables: plural nouns.
- Primary key: `id uuid` unless a registry approves another key.
- Foreign keys: `<entity>_id`.
- Timestamps: `created_at`, `updated_at`, `occurred_at`, `effective_at`, `deleted_at` with `timestamptz`.
- Boolean names read positively: `is_active`, `requires_approval`.
- Constraints: `<table>_<columns>_<kind>`.
- Indexes: `<table>_<columns>_idx`, with purpose suffix when needed.

## 4. Required columns and scope

Tenant-owned rows carry the authoritative scope columns required by the resource model: normally `tenant_id`, `digital_store_id` and optionally `location_id`. Do not copy a scope column merely for convenience unless its consistency is constrained.

Mutable configuration rows normally include:

```sql
id uuid primary key,
tenant_id uuid not null,
created_at timestamptz not null default now(),
created_by uuid,
updated_at timestamptz not null default now(),
updated_by uuid,
version bigint not null default 1
```

Append-only ledgers/events use `occurred_at`, actor/device identity, idempotency key, source and correlation fields. They are not updated except narrowly controlled technical annotations.

## 5. Data types

- Authoritative money: integer minor units (`bigint`) plus `currency_code char(3)`. KHR exponent is 0; USD exponent is 2. Exchange rates and cost intermediates use approved high-precision `numeric`, never floating point.
- Quantities/weights: `numeric` with domain-approved precision and checks.
- Timestamps: `timestamptz` stored as instants; business date is a separate local-date field where required.
- Text with finite values uses reference tables or constrained text types according to the enum registry.
- `jsonb` is only for optional metadata, provider payload archives or forward-compatible extension data. Fields used for authorization, finance, inventory, state transitions, reporting joins or uniqueness are relational columns.
- Arrays are not a replacement for join tables when individual elements have identity, lifecycle or permissions.

## 6. Keys, constraints and integrity

- Foreign keys are explicit and indexed where query/delete behavior requires.
- `not null`, `check`, unique and exclusion constraints enforce invariants that the database can guarantee.
- Delete behavior is explicit. Cascades on financial, audit, payment, inventory, custody or transaction truth are prohibited.
- Soft delete is for reversible configuration/reference data, not immutable ledgers.
- Offline-created entities use contract-approved client IDs and idempotency keys; database-generated IDs must not prevent offline operation.

## 7. RLS and authorization

- RLS is enabled on every exposed tenant-scoped table.
- Policies are deny-by-default and use reviewed helper functions.
- The client cannot choose its own tenant/store/location scope through an unchecked request value.
- Service-role bypass is server-only, minimal and audited.
- Views do not accidentally bypass RLS or expose security-definer behavior.
- Every migration adding a table includes RLS enablement, policies or an explicit non-exposure assertion in the same change.

## 8. Migrations

Filename pattern:

```text
YYYYMMDDHHMMSS_<domain>_<short_description>.sql
```

Rules:

1. Applied migration files are immutable.
2. Prefer additive, backward-compatible expand/migrate/contract changes.
3. Large backfills are resumable jobs, not long blocking migration transactions.
4. New non-null columns use safe defaults/backfill/constraint validation sequencing.
5. Indexes on large production tables use the approved online/concurrent procedure.
6. Destructive changes require an ADR, backup/restore proof, compatibility window and human approval.
7. Production migrations are never applied automatically at app startup and never auto-applied by an AI agent.
8. Rollback usually means application rollback plus forward corrective migration; do not promise unsafe down migrations.

## 9. Functions, triggers and side effects

Database functions may enforce atomic business operations, RLS helpers and calculations whose authoritative transaction belongs in PostgreSQL. They are versioned, schema-qualified, search-path safe and tested.

Triggers are limited to integrity, timestamps, append-only outbox/audit mechanics and narrowly approved derived data. Hidden cross-domain workflow side effects are prohibited.

## 10. Events and outbox

Business state and its outbox record are written in the same transaction. Consumers deduplicate by event ID/idempotency key. Deleting an outbox row before durable acknowledgement is prohibited. Replay and repair require the canonical runbook.

## 11. Query and index standards

- Select only required columns.
- Pagination uses stable indexed ordering; offset pagination is limited to small admin/reference sets.
- Query plans for critical paths are captured in tests/evidence.
- Every added index identifies the query or invariant it supports.
- Avoid unbounded scans and N+1 access.
- Reporting read models/materialized views declare source, refresh time and freshness.

## 12. Seeds and fixtures

Reference seeds are idempotent and stable. Demo and QA fixtures are separated from production reference data. Production seeds never create demo transactions or customers. IDs required by tests are deterministic and namespaced.

## 13. Store Hub rules

- The Hub uses a compatible local schema optimized for offline authority; it is not assumed to be a byte-for-byte cloud replica.
- Sync columns, sequencing and local acknowledgements are explicit.
- Cloud reconciliation cannot silently overwrite local finalized payment, inventory or custody events.
- Local backups, replacement checkpoints and schema migrations are tested on ARM64.

## 14. Required validation

```bash
pnpm supabase db lint
pnpm supabase test db
pnpm db:types
pnpm test:integration
```

CI fails if generated database types differ, exposed tables lack RLS, migrations are out of order, prohibited destructive SQL appears without approval, or tenant-isolation tests fail.
