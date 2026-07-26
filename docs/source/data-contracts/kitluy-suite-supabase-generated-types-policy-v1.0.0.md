# KitLuy Suite Supabase Generated Types Policy

**Filename:** `kitluy-suite-supabase-generated-types-policy-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target type-generation and compatibility policy; not implementation evidence

> **Mission:** Make database-generated types reproducible, reviewable and safely consumable by KitLuy applications without allowing clients to couple directly to unstable physical schema internals.

## Authority and implementation-truth rule

This artifact is a **canonical target implementation contract**. It is not evidence that a database object, policy, function, seed, deployment, backup, or test exists.

Authority order:

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions.
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence, and production evidence.
3. `kitluy-suite-supabase-schema-v1.0.0.md`, `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`, and `kitluy-suite-supabase-migration-plan-v1.0.0.md`.
4. This artifact and the other documents in the Supabase implementation pack.
5. Current Suite, Business, product, Store Hub, infrastructure, and API specifications.
6. Approved handoffs and evidence-based comparison/classification documents.
7. Competitor clone documents and superseded planning.

**Applied SQL migrations are the final deployed schema truth.** Documentation may generate, review, explain, or validate migrations, but it must never become a parallel database definition. A documentation-to-migration mismatch must fail CI or be recorded in the reconciliation register before release.

No capability may be labeled `IMPLEMENTED` without repository, applied-migration, executable-test, deployment, and applicable pilot/production evidence.

## Source and ownership

The only source for generated database types is an approved migrated database or migration-built ephemeral database at an exact Git SHA/migration head. Handwritten copies of generated types are prohibited.

Recommended package:

```text
packages/kitluy-supabase-types/
  src/database.generated.ts
  src/public-read-models.ts
  src/rpc.generated.ts
  src/enums.generated.ts
  src/index.ts
  manifest.json
  CHANGELOG.md
```

Owner: backend/platform data team. Application teams consume a versioned package; they do not run ad-hoc production generation.

## Generation workflow

1. Apply all migrations to an ephemeral database.
2. Apply canonical reference seeds required for type discovery only.
3. Run Supabase CLI type generation for all exposed schemas.
4. Generate additional RPC/error/reference-code types from `pg_catalog` and registry exports.
5. Normalize output deterministically.
6. Write manifest: Git SHA, migration head, Supabase CLI version, Postgres version, schemas, timestamp and checksum.
7. Diff against committed package.
8. Run TypeScript compile, API contract and backward-compatibility checks.
9. Publish package only after migration review/merge.

## Exposure policy

Do not expose every physical table to every client. Use schema exposure and generated exports by surface:

| Consumer                        | Allowed type surface                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------- |
| Admin/Chain/Partner PWA backend | approved Management API/RPC/read models; limited direct RLS reads.                     |
| POS/Store Hub                   | Edge Operations contracts and local schema adapters; never generic cloud table writes. |
| Storefront                      | Commerce/public contracts only.                                                        |
| Connector                       | Connector API/event schemas only.                                                      |
| Mobile apps                     | Role-safe read models and approved commands.                                           |

The generated database type file may contain internal schemas for server builds, but public client packages export only approved aliases/contracts.

## Row/Insert/Update usage

- `Row` types describe observed database output.
- `Insert`/`Update` types are not automatically approved client payloads.
- Side-effecting commands use explicit DTO/JSON Schema types matching versioned RPC/Edge contracts.
- Never let generated optionality replace business validation.
- Never let clients set server-owned scope, audit, total, status, version or provider fields unless the contract explicitly permits it.

## Compatibility rules

| Change                       | Policy                                                                                       |
| ---------------------------- | -------------------------------------------------------------------------------------------- |
| Add nullable column          | Backward-compatible; regenerate/package minor version.                                       |
| Add table/view/RPC           | Backward-compatible if not changing existing contract.                                       |
| Add reference/enum value     | Consumers must handle unknown value safely before activation.                                |
| Add NOT NULL column          | Requires safe default/backfill and generated-type rollout sequencing.                        |
| Rename/drop column/table/RPC | Breaking; use additive replacement, dual-read/write compatibility and major package version. |
| Change type/narrow range     | Breaking unless proven source-compatible; requires migration and client rollout plan.        |
| Change RPC return shape      | New versioned RPC/function name.                                                             |

## Enum/reference handling

Native PostgreSQL enums are generated as unions, but clients must include an `UNKNOWN` display fallback. Changeable reference codes are generated from registry seed exports into typed constants plus runtime validation; historical/deactivated codes remain parseable.

## Package versioning

Use SemVer independent from application versions:

- patch: comments/manifest/non-semantic generator change;
- minor: additive schema/type/API surface;
- major: breaking public contract after approved compatibility plan.

Package version and migration head are recorded in every application build manifest and Store Hub compatibility matrix.

## CI gates

Fail CI when:

- migrations changed but generated types/manifest did not;
- generated output differs from committed output;
- a breaking type diff lacks approved migration/compatibility record;
- a client imports internal schema types outside allowed package exports;
- any `any`/unchecked JSON is introduced on authoritative finance, inventory, permission or custody contracts;
- Supabase CLI/Postgres version differs from locked toolchain without review.

## Runtime validation

Generated TypeScript types are compile-time only. Edge/API boundaries also validate with versioned JSON Schema/Zod (or approved equivalent). Database constraints/RLS remain final enforcement.

## Acceptance criteria

1. One command deterministically regenerates the package from migrations.
2. Manifest proves exact migration/toolchain source.
3. All applications compile against the published package and do not import raw generated internals improperly.
4. Unknown additive codes fail safely or display a neutral fallback.
5. Breaking changes use additive migration and versioned contract rollout before old fields are removed.
