# KitLuy Suite Supabase Validation and Database QA

**Filename:** `kitluy-suite-supabase-validation-and-database-qa-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target validation plan; not implementation evidence

> **Mission:** Provide executable migration, schema, RLS, invariant, idempotency, concurrency, recovery and performance validation so database readiness is proven with evidence.

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

## Test layers

| Layer                    | Tooling/output                                                                |
| ------------------------ | ----------------------------------------------------------------------------- |
| Static migration lint    | SQL lint, forbidden-pattern scan, dependency/order check.                     |
| Ephemeral migration test | Blank database apply from zero.                                               |
| Upgrade test             | Restore prior release fixture, apply additive migrations, validate.           |
| Schema assertions        | `pg_catalog` queries, generated dictionary diff, constraint/index/RLS checks. |
| pgTAP/SQL tests          | Functions, triggers, transitions, append-only, money and scope invariants.    |
| RLS matrix               | Authenticated JWT/service/device contexts with expected allow/deny.           |
| Contract tests           | Edge Function → RPC → data/event/audit results.                               |
| Concurrency tests        | Duplicate idempotency, version conflicts, row locks, double pickup/payment.   |
| Performance tests        | Query plans and p95/p99 under Phase 1 target load.                            |
| Restore tests            | PITR/logical restore plus full validator suite.                               |

## Required migration validators

1. Migration filenames/order are unique and immutable after application.
2. All migrations run transactionally unless an approved non-transactional step is documented.
3. No destructive drop/rename/type narrowing without compatibility/backfill plan and owner approval.
4. New NOT NULL columns on populated tables use safe add/backfill/validate sequence.
5. Foreign keys use `NOT VALID`/validation sequencing where needed for safe rollout.
6. RLS is enabled and forced where required before client access.
7. `SECURITY DEFINER` functions pass search-path/grant checks.
8. Every new table has comments, owner, PK/key, scope, mutation class and indexes.
9. No public execute/grant or service-role leakage.
10. Generated types/dictionary are updated and diff reviewed.

## SQL assertion families

| ID family      | Assertions                                                                         |
| -------------- | ---------------------------------------------------------------------------------- |
| `DB-SCHEMA-*`  | Schemas/tables/columns/types/defaults/comments match migration-generated manifest. |
| `DB-FK-*`      | FK existence, same-scope validation and supporting indexes.                        |
| `DB-RLS-*`     | RLS enabled, policy coverage, cross-Tenant/Store/Location deny.                    |
| `DB-AUTH-*`    | Effective permission, expiry, exclusion, SoD, approval and break-glass.            |
| `DB-APPEND-*`  | UPDATE/DELETE blocked on ledgers/audit/events/custody.                             |
| `DB-IDEMP-*`   | same key/same hash replay; same key/different hash conflict.                       |
| `DB-STATE-*`   | allowed/denied lifecycle transitions.                                              |
| `DB-MONEY-*`   | currency/exponent, totals and no float columns.                                    |
| `DB-INV-*`     | movement/balance reconciliation and no unauthorized LWW.                           |
| `DB-LND-*`     | T1–T4 role boundaries, Ready blocking, custody and pickup.                         |
| `DB-SYNC-*`    | sequence/dedupe/out-of-order/replay/dead-letter.                                   |
| `DB-FILE-*`    | metadata/checksum/grant/retention and Spaces reconciliation.                       |
| `DB-RESTORE-*` | post-restore schema, ledgers, RLS and replay.                                      |

## Tenant-isolation test matrix

At minimum, execute each operation as:

- unauthenticated user;
- customer session;
- Partner owner in Tenant A;
- Store manager in Location A1;
- Cashier/T1 in Location A1;
- T3 operator;
- T4 operator;
- Chain operator with A1/A2 but not A3;
- same-role user in Tenant B;
- HET support without consent;
- HET support with valid scoped consent;
- expired temporary grant;
- revoked device;
- narrow service identity;
- platform owner with and without required approval.

Test SELECT, INSERT, UPDATE, DELETE and RPC execution separately. A hidden UI control is not a security test.

## Critical Phase 1 scenarios

1. Create Tenant → Digital Store → optional Location in order; reject Location without Store.
2. Reject second primary vertical for same Digital Store.
3. T1 creates per-piece and per-weight Booking with immutable price/scale snapshot.
4. T2 can display but cannot mutate production/custody/payment.
5. T3 can assign Ready storage but cannot complete pickup.
6. T4 completes pickup once; concurrent second completion fails idempotently.
7. Blocking garment exception prevents Ready absent approved override.
8. KHQR callback replay processes once; invalid signature quarantined.
9. Captured payment cannot be overwritten/deleted; refund is compensating record.
10. Stock balance equals movement ledger; direct balance mutation denied.
11. Offline event batch replay produces one cloud event/result.
12. Cross-Location device assignment is denied.
13. Storefront conversion is exactly once and records submitted vs verified difference.
14. Support access expires/revokes and blocks further reads/actions.
15. Release rollback preserves device assignment/config compatibility.
16. File checksum mismatch quarantines object and blocks link/download.
17. Restore database passes all RLS and ledger reconciliation tests.

## Performance/query-plan gates

Define and approve Phase 1 target loads in the infrastructure spec. Until exact targets are approved, use `[REQUIRED: target]` and do not claim capacity. Tests include:

- Booking creation and T1 reads;
- T3 Ready scan bursts;
- T4 pickup lookup;
- sync batch ingest/replay;
- Partner/Chain dashboard reads;
- queue fan-out;
- authorization helper cost;
- event/job claim queries;
- audit partition/index behavior.

Capture `EXPLAIN (ANALYZE, BUFFERS)` on representative data and fail on sequential scans or plan regressions for critical indexed paths unless explicitly approved.

## Evidence package

CI/staging outputs:

- migration apply logs;
- generated schema/data-dictionary/type diffs;
- pgTAP/JUnit results;
- RLS matrix report;
- query-plan/performance report;
- restore drill report where applicable;
- Git SHA, migration head, Supabase project ref and test seed checksum.

## Release gate

Database release is blocked unless all P0 assertions pass, no unexplained schema drift exists, RLS isolation passes, migrations are forward-safe, rollback/roll-forward procedure is approved, and the evidence package is attached to the change record.
