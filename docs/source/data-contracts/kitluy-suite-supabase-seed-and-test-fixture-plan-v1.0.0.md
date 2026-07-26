# KitLuy Suite Supabase Seed and Test Fixture Plan

**Filename:** `kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target seed/fixture contract; not implementation evidence

> **Mission:** Provide deterministic, idempotent and environment-safe reference seeds plus a complete Phase 1 Laundry demonstration and QA fixture set without inserting real credentials, production personal data or fake implementation evidence.

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

## Seed classes

| Class                 | Environments       | Mutability                    | Examples                                                                           |
| --------------------- | ------------------ | ----------------------------- | ---------------------------------------------------------------------------------- |
| `REFERENCE`           | dev/staging/prod   | Versioned, additive           | vertical codes, currencies, locales, reason codes, device/release statuses.        |
| `SECURITY_BASELINE`   | dev/staging/prod   | Versioned, tightly controlled | permissions, system role templates, approval policies, SoD rules.                  |
| `COMMERCIAL_BASELINE` | as approved        | Owner-value dependent         | plan codes/entitlements; no guessed prices.                                        |
| `DEMO`                | dev/staging only   | Resettable                    | demo Tenant, Partner, Laundry Digital Store, Location, users, catalog and devices. |
| `QA_FIXTURE`          | test/dev/staging   | Disposable                    | boundary, failure, stale, conflict, RLS and migration scenarios.                   |
| `PERFORMANCE_FIXTURE` | isolated test only | Disposable                    | high-volume synthetic records with no real PII.                                    |

Production seed scripts must reject `DEMO`, `QA_FIXTURE` and `PERFORMANCE_FIXTURE` classes unless an explicit non-production environment guard passes.

## Idempotency rules

1. Every seed file has a stable `seed_key` and semantic version.
2. `kitluy_audit.evidence_packages` or a dedicated `seed_history` relation records seed key, version, checksum, Git SHA, migration head, environment and applied timestamp.
3. Re-running the same seed version produces zero semantic changes.
4. Changed reference values require a higher version; never silently mutate released codes.
5. Seed IDs use fixed UUIDs from a project-owned namespace so foreign-key fixtures remain deterministic.
6. Passwords, service-role keys, private keys, OTP secrets and provider credentials are never committed.
7. Demo Auth users are created by a controlled script/API, not raw inserts into unsupported `auth.*` internals.

## Recommended file order

```text
supabase/seed/
  000_seed_guard.sql
  010_reference_verticals_locales_currencies.sql
  020_reference_statuses_reasons.sql
  030_permissions_and_system_roles.sql
  040_approval_and_sod_policies.sql
  050_device_release_reference.sql
  060_notification_and_file_reference.sql
  070_plan_policy_placeholders.sql
  100_demo_tenant_and_partner.sql
  110_demo_laundry_store_and_location.sql
  120_demo_users_memberships_and_roles.sql
  130_demo_catalog_prices_and_customers.sql
  140_demo_hub_terminals_and_peripherals.sql
  150_demo_bookings_payments_and_inventory.sql
  160_demo_storefront_preintake_and_queue.sql
  170_demo_chain_and_reporting.sql
  200_qa_security_and_rls.sql
  210_qa_offline_sync_and_idempotency.sql
  220_qa_finance_inventory_and_custody.sql
  230_qa_files_notifications_integrations.sql
  240_qa_backup_restore_markers.sql
```

## Demo Tenant fixture

| Field                   | Value                                                |
| ----------------------- | ---------------------------------------------------- |
| Tenant code             | `DEMO-KH-001`                                        |
| Partner name            | `KitLuy Demo Laundry Partner`                        |
| Locale                  | Khmer + English                                      |
| Timezone                | `Asia/Phnom_Penh`                                    |
| Currencies              | KHR primary; USD enabled for approved test scenarios |
| Data classification     | Synthetic/demo only                                  |
| Production availability | Prohibited                                           |

## Demo Laundry Digital Store

| Fixture        | Required values                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Digital Store  | `DEMO-LAUNDRY-001`, primary vertical `LAUNDRY`, status `ACTIVE_HYBRID`.                                                        |
| Store Location | `DEMO-PP-01`, Phnom Penh synthetic address, active Hub required.                                                               |
| Services       | Wash & Fold per kg, Shirt per piece, Dry Clean Suit per piece, Pressing add-on, Express add-on.                                |
| Price versions | At least two historical versions; one current; KHR authoritative; USD scenario only where configured.                          |
| Customers      | Walk-in, verified phone customer, bilingual customer, privacy-restricted customer.                                             |
| Staff          | Partner owner, Store manager, Cashier/T1, Laundry staff, T3 operator, T4 operator, readonly auditor.                           |
| Hardware       | One Store Hub, T1/T2 front-counter terminal profile, T3/T4 ready/pickup terminal profile, receipt/tag printer, scanner, scale. |
| Storefront     | Published Web/QR/Telegram entry definitions, one active queue counter and policy.                                              |

## Minimum Booking fixtures

| Fixture ID | Scenario                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `BKG-001`  | Per-piece Booking, cash deposit, normal production, T3 Ready, T4 pickup.                       |
| `BKG-002`  | Per-weight Booking with stable scale reading and price-version snapshot.                       |
| `BKG-003`  | Mixed services and add-ons, KHQR pending then confirmed by signed provider event.              |
| `BKG-004`  | Partial deposit and remaining balance at T4.                                                   |
| `BKG-005`  | Rewash exception and approved resolution.                                                      |
| `BKG-006`  | Damage issue with evidence file metadata and customer-visible status.                          |
| `BKG-007`  | Missing garment exception blocks Ready.                                                        |
| `BKG-008`  | Storefront Pre-Intake → queue → T1 verification differences → exactly-once Booking conversion. |
| `BKG-009`  | Offline Hub-created Booking synced with duplicate replay; cloud accepts once.                  |
| `BKG-010`  | Cancelled Booking with compensating payment/refund records.                                    |

## Security and RLS fixtures

Create users and assignments covering:

- same Tenant/different Digital Store;
- same Digital Store/different Location;
- Chain operator with partial Location scope;
- Partner owner and Store manager;
- Cashier/T1 without Partner Portal access;
- T3-only and T4-only permissions;
- HET support operator without consent;
- consent-scoped support session;
- production-sensitive approver and requester as different users;
- expired temporary grant;
- revoked device certificate;
- service identity with one narrow permission.

Every fixture has expected allow/deny assertions in the database QA document.

## Failure and edge fixtures

- stale and partial read-model snapshots;
- duplicate idempotency key with same request hash;
- duplicate key with different request hash;
- out-of-order sync events;
- invalid Booking status transition;
- inventory movement that would create an unauthorized negative balance;
- payment provider replay and invalid signature;
- expired upload/download grant;
- file checksum mismatch;
- notification suppressed by withdrawn consent;
- release health-check failure and A/B rollback;
- break-glass session expiry;
- migration backfill resume marker.

## Fixture reset and cleanup

Use a dedicated fixture manifest and dependency-aware deletion function for non-production environments. Cleanup must refuse to run when the project/environment identifier is production. Audit/event/finance fixture cleanup is allowed only in disposable databases; shared staging keeps evidence by test-run namespace or database reset.

## Acceptance criteria

1. Reference seeds pass three consecutive runs with identical semantic checksums.
2. Demo seed creates one complete Digital Store-first Laundry environment and passes the first-Booking path.
3. QA fixtures cover all RLS scopes, T1–T4 roles, offline replay, finance/inventory append-only rules and file-metadata boundaries.
4. No secret or real customer data is present.
5. Production guard fails closed for demo/test seeds.
6. Fixture IDs and expected outcomes are documented and consumed by automated tests.
