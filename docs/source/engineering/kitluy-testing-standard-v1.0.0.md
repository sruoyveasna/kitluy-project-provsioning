# KitLuy Testing Standard

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Testing principle

A feature is not complete because its happy-path UI works. Tests prove contracts, tenant isolation, offline continuity, append-only truth, retries, recovery and documentation claims.

## 2. Test layers

| Layer | Purpose | Typical tools |
|---|---|---|
| Static | Types, lint, boundaries, generated drift | TypeScript, ESLint, custom validators |
| Unit | Pure rules, calculations, transitions | Vitest |
| Component | UI behavior/accessibility | React Testing Library / RN Testing Library |
| Database | DDL, RLS, functions, constraints | Supabase local, pgTAP/SQL assertions |
| Contract | API/event/job/webhook/schema compatibility | JSON Schema/OpenAPI validators |
| Integration | Real adapters and service boundaries | Testcontainers, Supabase local, Docker |
| E2E | User and system workflows | Playwright, mobile/Electron harnesses |
| Offline/edge | WAN loss, reconnect, duplicates, Hub failover | Hub simulator and certified hardware |
| Security | Authz, tenancy, secrets, abuse | automated probes and manual review |
| Load/resilience | capacity, saturation, retry and failure | k6 and fault injection |
| Recovery | backup restore, Hub replacement, rollback | scripted runbooks |

## 3. Required coverage

Coverage is a signal, not proof. Minimum changed-code target is 80% statements/lines and 75% branches. Core money, authorization, state-machine, sync, payment, finance, inventory, custody and audit modules target 95% branch coverage plus canonical test vectors. An exception requires owner, rationale and compensating tests.

## 4. Determinism

- Tests control time, randomness, IDs and network responses.
- No test depends on execution order or shared mutable fixtures.
- Use fixed `Asia/Phnom_Penh` business-date cases plus UTC boundaries.
- Currency tests cover KHR exponent 0 and USD exponent 2.
- Race/concurrency tests explicitly coordinate rather than sleep.
- Flaky tests are quarantined only with a blocking issue, owner and expiry; they are not silently retried until green.

## 5. Test data

Use synthetic fixtures. Production data is prohibited unless an approved masked-data process exists. Factories create valid defaults and explicit overrides. Golden snapshots are small, reviewed and never hide business logic.

## 6. Required scenarios for every mutation

1. Authorized success.
2. Validation failure.
3. Unauthorized role/scope/environment.
4. Idempotent replay.
5. Concurrent/conflicting change.
6. Audit/event/outbox record.
7. Dependency failure and retry classification.
8. Stale/offline behavior where relevant.
9. Tenant/Digital Store/Location isolation.
10. Compensating action or recovery path.

## 7. Database and RLS tests

Every tenant table receives positive and negative RLS tests across tenants, stores, locations, roles, service accounts and revoked memberships. Migrations are tested from a clean database and from the latest supported prior schema. Generated types must produce a clean diff.

## 8. API/event/job tests

- Validate request and response schemas.
- Verify version, error codes, scopes, idempotency, pagination and rate-limit headers.
- Run producer/consumer compatibility tests for events.
- Verify webhook signatures, replay rejection and retry status.
- Verify job deduplication, timeout, backoff and dead-letter behavior.

## 9. UI tests

Routes/screens test loading, empty, error, stale, partial and offline states. Accessibility tests cover names, roles, keyboard/touch, focus and font scaling. Localization tests cover Khmer and English without clipping critical values.

## 10. Store Hub and T1-T4 tests

Required Phase 1 edge tests include:

- Normal LAN operation with WAN unavailable.
- T1 Booking, deposit/payment, receipt and tag creation.
- T2 customer-display pairing without mutation authority.
- T3 Ready Scan-In custody and storage assignment.
- T4 Pickup Scan-Out, balance control and completion authority.
- Duplicate scan, missing garment, wrong role, stale configuration and device revocation.
- Hub restart during transaction, outbox persistence, reconnect and duplicate cloud delivery.
- Printer/scanner/scale unavailable and recovery.
- Signed release install, failed health check and A/B rollback.

## 11. Pull-request test matrix

CI selects tests by changed path but never skips shared-contract consumers. A contract/package change runs all direct and transitive consumers. Database/API/security changes always run integration and isolation suites.

## 12. Release gates

- Development: static, unit, component and database tests.
- Staging: contract, integration, E2E, security and migration tests.
- Pilot: certified hardware, offline, recovery, observability and support runbooks.
- Production: immutable artifact verification, smoke tests, monitoring and rollback readiness.

## 13. Evidence

Test evidence records commit SHA, artifact digest, environment, test versions, time, result and retained report location. A screenshot alone is not sufficient evidence for automated or database behavior.
