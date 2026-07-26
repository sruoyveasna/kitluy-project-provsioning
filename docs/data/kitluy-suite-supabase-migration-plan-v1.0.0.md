# KitLuy Suite Supabase Migration Plan

**Filename:** `kitluy-suite-supabase-migration-plan-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-26
**Owner:** HET / KitLuy Suite Project Owner
**Status:** Canonical RLS/authorization-aligned migration plan; PROPOSED→CONTRACT-APPROVED pending independent review
**Primary phase:** Phase 1 — Laundry, designed as a shared cross-vertical foundation

> **Implementation truth:** This plan is not evidence that any migration has been authored,
> applied, or verified. Applied SQL migrations are the only deployed schema truth. This cycle
> delivers **SCAFFOLDED** status only: group 0000 exists as a real minimal migration; all other
> groups are planned, not authored. Migration execution is **BLOCKED (BLK-002: Docker and the
> Supabase CLI are absent from this environment)** — the static harness in `scripts/database/`
> validates what can be validated without a database and reports the rest as
> BLOCKED-NOT-EXECUTED.

## Authority

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions
   (**KL-INF-P1-037, OWNER-LOCKED: production migrations are never applied automatically** —
   not from app startup, not from ordinary CI; only authorized human operators with four-eyes
   approval apply them).
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence.
3. `kitluy-suite-supabase-schema-v1.0.0.md`,
   `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`, and this plan.
4. The Supabase implementation pack in `docs/source/data-contracts/` (data dictionary, enum and
   reference-data registry, functions/RPC/triggers contract, realtime publication plan, seed
   and test-fixture plan, generated types policy, validation and database QA).
5. The security pack in `docs/source/security/`.

## 1. Naming convention: group → repository filename

The repository convention (validated by `pnpm migrations:validate` and
`supabase/migrations/README.md`) is `<YYYYMMDDHHMMSS>_<snake_case_name>.sql`. Migration groups
map onto it as follows:

- **Group token first.** The snake_case name always starts with the 4-digit group id:
  `<YYYYMMDDHHMMSS>_<NNNN>_<description>.sql` (e.g.
  `20260726180000_0000_extensions_and_migration_controls.sql`).
- **Timestamp encodes group order.** For this authoring cycle (dated 2026-07-26) group `NNNN`
  uses base time `18:MM:00` where `MM = NNNN / 10` (0000→`180000`, 0010→`180100`, 0020→`180200`
  … 0160→`181600`). Multiple files inside one group increment the seconds field
  (`…MM01`, `…MM02`, …).
- **Later cycles** use their real authoring date but must keep the group token as the first
  name segment and must never produce a timestamp that sorts a lower group after a higher one
  within the same unapplied set. Lexicographic filename order must always equal safe apply
  order — the harness (`pnpm db:validate`) enforces group-vs-timestamp monotonicity.
- Placeholder migrations start with `-- kitluy:PLACEHOLDER` and are never applied to
  production. Destructive statements require `-- kitluy:destructive-approved:<decision-id>`.
- Every migration carries a machine-readable marker `-- kitluy:group:NNNN`.

## 2. Group sequence and schema mapping

Dependency-safe order. Schema and table names come exactly from
`kitluy-suite-supabase-data-dictionary-v1.0.0.md`.

| Group | Name                              | Contents (schemas / objects)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0000  | extensions_and_migration_controls | `pgcrypto`; `kitluy_ops` control-plane schema with `kitluy_ops.migration_journal` (append-only application evidence). **Authored this cycle (SCAFFOLDED).**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 0010  | identity_and_tenant               | `kitluy_core`: `tenants`, `partner_accounts`, `memberships`, `plans`, `feature_flags`, `reference_values`, `reference_value_translations`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 0020  | store_and_location                | `kitluy_core`: `digital_stores`, `store_locations`, `digital_store_location_links`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 0030  | authz_and_audit                   | `kitluy_admin` (incidents first — `kitluy_auth.break_glass_sessions` FKs `kitluy_admin.platform_incidents`), then `kitluy_auth` (all), then `kitluy_audit` (all).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 0040  | catalog_and_pricing               | `kitluy_core`: `catalog_items`, `catalog_item_translations`; `kitluy_chain` (all); `kitluy_laundry`: `services`, `service_prices`, `service_addons`, `consumable_usage_rules`, `capacity_profiles`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 0050  | customers                         | `kitluy_core`: `customers`, `customer_contacts`; `kitluy_storefront`: `customer_channel_identities`, `customer_phone_challenges`, `customer_sessions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0060  | transactions_and_laundry          | `kitluy_orders` (all); `kitluy_laundry` operational tables (`garments`, `laundry_tags`, `garment_scan_events`, `booking_status_history`, `garment_exceptions`, `production_steps`, `ready_storage_positions`, `ready_storage_assignments`, `pickup_handoffs`); `kitluy_storefront` remaining 19 tables (explicit, per review WS-01-T002 RV: `channel_attributions`, `customer_confirmations`, `idempotency_records`, `intake_verification_lines`, `intake_verifications`, `pre_intake_booking_conversions`, `pre_intake_drafts`, `pre_intake_evidence_files`, `pre_intake_lines`, `pre_intake_versions`, `queue_counters`, `queue_events`, `queue_policies`, `queue_tickets`, `storefront_entry_points`, `storefront_location_publications`, `storefront_publications`, `storefront_qr_codes`, `storefront_status_snapshots` — the 3 identity tables stay in 0050); `kitluy_pos` (all); `kitluy_inventory` (all). |
| 0070  | payments_and_finance              | `kitluy_payments` (all); `kitluy_billing` (all); `kitluy_partner` (all, incl. `expenses`, `reconciliations`, `reconciliation_lines`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 0080  | devices                           | `kitluy_devices` (all); `kitluy_releases` (all — `object_file_id`/evidence file columns created as plain `uuid`, FK added in 0100).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 0090  | config_and_sync                   | `kitluy_config` (all); `kitluy_sync` (all); `kitluy_jobs` (all); `kitluy_events` (all).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 0100  | files_and_notifications           | `kitluy_files` (all); `kitluy_notifications` (all); deferred cross-domain FKs to `kitluy_files.file_objects` added `NOT VALID` then `VALIDATE` (see §3 rule R4).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 0110  | integrations_and_reporting        | `kitluy_integrations` (all); `kitluy_ai` (all); `kitluy_reporting` views/materialized views.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 0120  | rls_enablement                    | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` + `FORCE` on **every** `kitluy_*` table → fail-closed deny-all baseline (no policies yet).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 0130  | functions_triggers_rpcs           | `kitluy_auth` helper functions, trigger functions (`enforce_append_only`, `enforce_scope_consistency`, …), command/query RPCs, **and the RLS policies** (policies reference helpers, so they land here, after 0120's deny-all baseline).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 0140  | realtime                          | Realtime publications per `kitluy-suite-supabase-realtime-publication-plan-v1.0.0.md`; publication membership only after RLS policies exist (RLS-023).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0150  | seeds                             | Reference/enum seed data per `kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md` and `kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md` (idempotent upserts; production seeds are governed data changes).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 0160  | validation_assertions             | `DO` blocks asserting: every `kitluy_*` table has RLS enabled+forced; append-only tables have `enforce_append_only`; required `COMMENT ON` metadata present; every `SECURITY DEFINER` function has locked `search_path`. Assertion failure aborts the transaction (RLS-027/028 gate).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

Cross-cutting rules:

- **R1 — additive by default.** No DROP/TRUNCATE/DELETE without
  `-- kitluy:destructive-approved:<decision-id>` (harness-enforced).
- **R2 — one transaction per migration file** unless the file documents why not (e.g.
  `CREATE INDEX CONCURRENTLY`, `VALIDATE CONSTRAINT` phases), in which case each phase is
  individually safe to re-run.
- **R3 — no data backfill inside DDL migrations.** Backfills are separate, batched, idempotent
  migrations or governed jobs with row-count evidence.
- **R4 — forward references.** When an earlier group references a later group's table (e.g.
  `evidence_file_id` → `kitluy_files.file_objects`), the column is created untyped-FK (`uuid`)
  in its owning group and the FK constraint is added in the later group as
  `ADD CONSTRAINT … NOT VALID` followed by `VALIDATE CONSTRAINT` (short lock, then
  share-lock-only validation).
- **R5 — never automatic production execution (KL-INF-P1-037).** `supabase db push`/apply
  against production is prohibited from CI and from any agent. Production application is a
  human-operated, four-eyes-approved (A3; rollback A4) procedure that records evidence in
  `kitluy_ops.migration_journal` and `docs/data/migration-status-registry.md`.

## 3. Per-group execution contract

Field meanings: **Owner** = accountable schema owner from the dictionary ownership registry.
**Txn** = transaction boundary. **Lock** = expected lock risk at apply time. **Rollout** =
additive-rollout stance. **Backfill** = data movement needs. **Compat** = compatibility window
for consumers. **Rollback** = rollback-or-forward-repair decision. **Types** = generated
TypeScript types impact (`kitluy-suite-supabase-generated-types-policy-v1.0.0.md`). **Seeds** =
seed dependencies. **RLS/RT** = RLS/realtime activation order note. **Hub** = Store Hub
projection impact. **Evidence** = verification evidence required before the group is marked
applied in the status registry.

### Group 0000 — extensions_and_migration_controls (Owner: Shared Platform)

| Field    | Contract                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | Single transaction.                                                                                                                     |
| Lock     | None beyond catalog locks; new objects only.                                                                                            |
| Rollout  | Purely additive; safe on empty and non-empty databases (`IF NOT EXISTS`).                                                               |
| Backfill | None.                                                                                                                                   |
| Compat   | No consumer-visible surface; `kitluy_ops` is operator/CI-facing only.                                                                   |
| Rollback | Forward-repair only — the journal is evidence and is never dropped.                                                                     |
| Types    | Excluded from generated app types (control plane).                                                                                      |
| Seeds    | None.                                                                                                                                   |
| RLS/RT   | `kitluy_ops` is not tenant data; RLS enablement still applied at 0120 with operator-only policy. No realtime.                           |
| Hub      | None.                                                                                                                                   |
| Evidence | `pnpm db:validate` + `pnpm migrations:validate` pass; on real apply (blocked, BLK-002): journal row + `supabase migration list` output. |

### Group 0010 — identity_and_tenant (Owner: Shared Platform)

| Field    | Contract                                                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | Single transaction.                                                                                                                                                    |
| Lock     | New tables only; FK to `auth.users` takes brief `ACCESS SHARE` on the auth table.                                                                                      |
| Rollout  | Additive. `tenants` before `partner_accounts`/`memberships` (FK direction).                                                                                            |
| Backfill | None (greenfield).                                                                                                                                                     |
| Compat   | None yet; first consumer is group 0130 RPCs.                                                                                                                           |
| Rollback | Pre-pilot: compensating drop migration allowed with destructive approval. Post-pilot: forward-repair only (tenants are never hard-deleted once dependent data exists). |
| Types    | First generated-types baseline for `kitluy_core` identity tables.                                                                                                      |
| Seeds    | `reference_values` registry keys land in 0150, not here.                                                                                                               |
| RLS/RT   | Tables are created RLS-off and **must not receive data** before 0120+0130 land in the same release train (validated by 0160).                                          |
| Hub      | None directly; membership feeds Hub staff snapshots later.                                                                                                             |
| Evidence | Observed-dictionary diff (`artifacts/db/schema-diff.md`) empty for these tables.                                                                                       |

### Group 0020 — store_and_location (Owner: Shared Platform)

| Field    | Contract                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | Single transaction.                                                                                                               |
| Lock     | New tables only.                                                                                                                  |
| Rollout  | Additive; `digital_stores` before `store_locations` before `digital_store_location_links`.                                        |
| Backfill | None.                                                                                                                             |
| Compat   | `UNIQUE(tenant_id,store_code)` and `UNIQUE(digital_store_id,location_code)` are contract keys consumed by onboarding RPCs (0130). |
| Rollback | Forward-repair after activation (vertical changes are governed migrations, not direct updates).                                   |
| Types    | Extends `kitluy_core` types.                                                                                                      |
| Seeds    | None.                                                                                                                             |
| RLS/RT   | Same release train as 0120/0130.                                                                                                  |
| Hub      | Location identity is the Hub anchor; Hub provisioning cannot precede this group in any environment.                               |
| Evidence | Schema-diff empty; scope-consistency trigger tests (0130) reference these FKs.                                                    |

### Group 0030 — authz_and_audit (Owner: Security; Admin Portal; Audit/Compliance)

| Field    | Contract                                                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | Up to three transactions (admin, auth, audit) — each self-consistent; ordering: `kitluy_admin.platform_incidents` before `kitluy_auth.break_glass_sessions`; `kitluy_auth.approval_requests` before `kitluy_admin.safety_switches` FK (added `NOT VALID` if split). |
| Lock     | New tables; partitioning for `kitluy_auth.authorization_decisions` (by `decided_at`) declared here to avoid later rewrites.                                                                                                                                         |
| Rollout  | Additive.                                                                                                                                                                                                                                                           |
| Backfill | 107 RBAC registry keys and role templates are **seed data (0150)**, not DDL.                                                                                                                                                                                        |
| Compat   | Permission-key immutability starts at first seed; registry changes follow the deprecation contract.                                                                                                                                                                 |
| Rollback | Forward-repair only — audit/approval evidence is never dropped (A4 for any emergency restore).                                                                                                                                                                      |
| Types    | `kitluy_auth` types are server-only; excluded from client bundles.                                                                                                                                                                                                  |
| Seeds    | Depends on 0150 for `permissions`, `role_templates`, `approval_policies`, `separation_of_duties_rules`.                                                                                                                                                             |
| RLS/RT   | Highest-sensitivity policies (RLS doc §5.2/§5.21); append-only triggers attach in 0130. No realtime.                                                                                                                                                                |
| Hub      | None.                                                                                                                                                                                                                                                               |
| Evidence | Append-only rejection test plan (RLS test pack §5); schema-diff empty.                                                                                                                                                                                              |

### Group 0040 — catalog_and_pricing (Owner: Shared Platform; Chain Portal; Laundry Vertical)

| Field    | Contract                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | Single transaction per schema file (core-catalog, chain, laundry-catalog).                                                        |
| Lock     | New tables only.                                                                                                                  |
| Rollout  | Additive; `catalog_items` before `kitluy_laundry.services` (FK `catalog_item_id`); chain publication tables independent.          |
| Backfill | None; catalog content is operator data, not migration data.                                                                       |
| Compat   | Price versioning contract (`service_prices.version`, effective ranges) is consumed by Booking RPCs — must land before 0060 usage. |
| Rollback | Versioned rows: forward-repair by publishing corrected versions.                                                                  |
| Types    | Catalog types shared with POS/Storefront clients.                                                                                 |
| Seeds    | Laundry service vocabulary from the enum/reference registry (0150).                                                               |
| RLS/RT   | Chain snapshot tables are append-only (policies in 0130).                                                                         |
| Hub      | Catalog/price versions are projected to Hub caches; Hub consumes only published versions.                                         |
| Evidence | Schema-diff empty; effective-range overlap trigger tests planned in 0130.                                                         |

### Group 0050 — customers (Owner: Shared Platform; Storefront)

Txn: single. Lock: new tables. Rollout: additive; `customers` before `customer_contacts` before
storefront identity tables. Backfill: none. Compat: `UNIQUE(tenant_id,type,normalized_value)
WHERE active` is the dedupe contract for `link_customer_contact_v1`. Rollback: forward-repair
(customer identity is tenant-owned truth). Types: shared with Storefront/POS. Seeds: none.
RLS/RT: phone challenges and sessions are PC-PUBTOK (RPC-only); no realtime on PII tables. Hub:
customer snapshots project to Hub read models only. Evidence: schema-diff empty; contact-dedupe
negative tests planned.

### Group 0060 — transactions_and_laundry (Owner: Shared Transactions; Laundry; Storefront; POS; Inventory)

| Field    | Contract                                                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Txn      | One file per schema (`orders`, `laundry_ops`, `storefront_intake`, `pos`, `inventory`), each single-transaction; strict file order within the group. |
| Lock     | New tables; largest group — apply in a quiet window even in staging to keep catalog churn observable.                                                |
| Rollout  | Additive. `kitluy_orders.orders` precedes every table FK-ing it (laundry ops, storefront conversions, POS, payments in 0070).                        |
| Backfill | None greenfield; future vertical onboarding uses governed migration RPCs (`onboarding.migration.*`), never raw DML.                                  |
| Compat   | Order/line/adjustment append-only correction model is the API contract; consumers must never expect in-place total updates.                          |
| Rollback | Forward-repair only once any transactional row exists (finance/custody truth).                                                                       |
| Types    | Largest client-type surface (POS, Partner, Storefront).                                                                                              |
| Seeds    | Status/reason vocabularies via 0150 `reference_values`.                                                                                              |
| RLS/RT   | Custody tables (`ready_storage_assignments`, `pickup_handoffs`) get T3/T4 terminal-role RPC gating in 0130 (RLS-016).                                |
| Hub      | Core Hub offline domain: orders/garments/queue project into Hub local store; schema must match sync contract before Hub pilot.                       |
| Evidence | Schema-diff empty; `stock_movements` append-only test plan; document-number uniqueness tests.                                                        |

### Group 0070 — payments_and_finance (Owner: Payments; Billing; Partner Surfaces)

Txn: one file per schema, single-transaction each. Lock: new tables. Rollout: additive;
`kitluy_payments.tenders` FKs `kitluy_orders.orders` (0060). Backfill: none. Compat: provider
refs and scoped idempotency keys are the replay-safety contract for KHQR/provider callbacks.
Rollback: **prohibited** once any tender exists — forward-repair with compensating records only
(A4 for emergency restore per sensitive-action policy §3). Types: server + POS payment types.
Seeds: payment method/reason codes (0150). RLS/RT: all payment tables append-only
(**UPDATE/DELETE prohibited**, RLS doc §5.10); no realtime on raw finance rows — projections
only. Hub: offline cash tenders queue through sync outbox; idempotent ingestion required.
Evidence: schema-diff empty; append-only rejection and idempotency-unique test plans.

### Group 0080 — devices (Owner: Fleet/Store Hub; Release Service)

Txn: two files (devices, releases), single-transaction each. Lock: new tables. Rollout:
additive; `hardware_profiles` → `devices` → certificates/assignments/actions;
`release_artifacts.object_file_id` created as plain `uuid` (R4; FK in 0100). Backfill: none —
device registration is a manufacturing-station workflow. Compat: certificate serial and
fingerprint uniqueness are the trust anchors for edge auth. Rollback: forward-repair; device
identity history is never dropped. Types: fleet/admin types. Seeds: certified hardware profile
registry (0150). RLS/RT: platform-governed policies (RLS doc §5.13); realtime only for fleet
health projections (0140). Hub: this group is the Hub's own identity model; Hub provisioning
depends on it plus 0090 sync. Evidence: schema-diff empty; certificate uniqueness tests.

### Group 0090 — config_and_sync (Owner: Configuration Service; Sync; Jobs; Events)

Txn: one file per schema. Lock: new tables; declare partitioning for `kitluy_events.domain_events`
and `kitluy_sync` inbox/outbox by time up front. Rollout: additive. Backfill: none. Compat:
outbox/event envelope versions are the integration contract; consumers tolerate additive fields
only. Rollback: forward-repair; event/journal truth is append-only. Types: server-only. Seeds:
schedule definitions (0150). RLS/RT: PC-SVC-only access (RLS doc §5.14/§5.20); realtime never
attaches to raw outbox tables. Hub: sync tables are the Hub↔cloud channel; cursor/sequence
uniqueness must exist before any Hub connects. Evidence: schema-diff empty; idempotent-ingest
test plan (RLS-029).

### Group 0100 — files_and_notifications (Owner: File Service; Notification Service)

Txn: two files plus a third FK-validation file. Lock: `ADD CONSTRAINT … NOT VALID` takes brief
`ACCESS EXCLUSIVE` on referencing tables — batch the deferred FKs (R4: releases evidence files,
approval evidence, expense receipts, compliance answers, pre-intake evidence) and run
`VALIDATE CONSTRAINT` separately (share lock only). Rollout: additive. Backfill: none. Compat:
`UNIQUE(bucket_key,object_key)` is the Spaces-metadata contract; bytes never live in Postgres.
Rollback: forward-repair; access events append-only. Types: file metadata types shared with
clients. Seeds: retention policy registry (0150). RLS/RT: classification-gated policies
(RLS-018/024) in 0130; notification delivery truth append-only. Hub: print/file references sync
by metadata id. Evidence: schema-diff empty; FK VALIDATE evidence; signed-access denial tests.

### Group 0110 — integrations_and_reporting (Owner: Integration Hub; AI; Reporting)

Txn: one file per schema; reporting views last. Lock: views/matviews create with no long locks;
matview initial build deferred to post-apply refresh job. Rollout: additive; connectors have no
DB access — tables serve the Connector API only. Backfill: none. Compat: projection versions and
webhook dedupe keys are the connector contract. Rollback: views are drop-and-recreate safe
(destructive marker allowed for view replacement only, cited decision required); base tables
forward-repair. Types: reporting read-model types for Partner/Chain clients. Seeds: connector
definitions registry (0150). RLS/RT: security-barrier views inherit strictest source scope
(RLS-025/030); realtime only via 0140 plan. Hub: reporting reads Hub-synced truth; freshness
labels mandatory. Evidence: schema-diff empty; view scope-manifest tests.

### Group 0120 — rls_enablement (Owner: Security)

Txn: single transaction. Lock: `ALTER TABLE … ENABLE/FORCE ROW LEVEL SECURITY` takes brief
`ACCESS EXCLUSIVE` per table — ordered list, tiny statements, safe on empty tables; in a
non-empty environment run during a maintenance window. Rollout: this is the fail-closed switch:
after 0120, **everything is deny-all** until 0130 policies land — 0120 and 0130 ship in the
same release train, and 0160 asserts both. Backfill: none. Compat: any consumer reading before
0130 gets zero rows (fail closed), never an error leak. Rollback: disabling RLS is prohibited
(A4 + incident only). Types: none. Seeds: none. RLS/RT: precedes 0140 by definition (RLS-023,
RLS-028). Hub: none. Evidence: 0160 assertion output; catalog query listing
`relrowsecurity`/`relforcerowsecurity` for every `kitluy_*` table.

### Group 0130 — functions_triggers_rpcs (Owner: Security + each domain owner)

Txn: multiple files (helpers → triggers → policies → RPCs), each single-transaction. Lock:
`CREATE POLICY`/`CREATE FUNCTION` are catalog-only. Rollout: additive; policies reference
helpers, so helpers apply first; every `SECURITY DEFINER` function sets owner, locked
`search_path`, `REVOKE PUBLIC` (RLS-027). Backfill: none. Compat: RPC signatures are versioned
(`*_v1`); breaking changes add `_v2`, never mutate `_v1`. Rollback: forward-repair via
`CREATE OR REPLACE` migrations; dropping policies requires destructive approval. Types: RPC
types drive the generated client API surface. Seeds: policy evaluation depends on 0150 RBAC
seeds in non-empty environments. RLS/RT: completes the RLS doc §5 matrix; realtime still off.
Hub: local command receipts/RPC parity documented in the Hub sync contract. Evidence: 0160
assertions; RLS-001..030 execution results **(BLOCKED, BLK-002 — recorded, not claimed)**.

### Group 0140 — realtime (Owner: each domain owner + Security review)

Txn: single. Lock: publication DDL only. Rollout: additive per the realtime publication plan;
only projection-safe tables join publications — never raw finance/custody/audit rows. Backfill:
none. Compat: subscription topics are tenant/store scoped; authorization enforced before
delivery (RLS-023 — no buffered cross-tenant event). Rollback: removing a table from a
publication is non-destructive and allowed. Types: realtime payload types generated from
projections. Seeds: none. RLS/RT: strictly after 0120+0130. Hub: Hub subscribes only to its
Location's topics. Evidence: publication catalog listing + RLS-023 test result (blocked).

### Group 0150 — seeds (Owner: each domain owner; Security for RBAC seeds)

Txn: single per seed file; all seeds idempotent upserts keyed on natural keys. Lock: row locks
only. Rollout: additive; seed order: `reference_values` → RBAC registry (107 permission keys,
role templates, approval policies, SoD rules) → hardware profiles → retention policies →
connector definitions → schedules. Backfill: n/a (seeds are the backfill). Compat: seeds in
production are **governed data changes** (A2/A3 per registry), not silent migration side
effects. Rollback: corrections are new seed versions; never DELETE seed history that evidence
references. Types: enum/reference codes flow into generated types per the generated-types
policy. Seeds: depends on every prior structural group. RLS/RT: seeds run under the migration
role before policies apply to it; 0160 verifies row presence. Hub: reference data projects to
Hub caches. Evidence: seed row-count manifest per environment in the status registry.

### Group 0160 — validation_assertions (Owner: Security + Shared Platform)

Txn: single; assertion failure raises and aborts. Lock: read-only catalog queries. Rollout:
re-runnable at any time; also executed by CI against shadow databases when BLK-002 clears.
Backfill: none. Compat: none. Rollback: n/a (no state). Types: none. Seeds: asserts 0150
presence where the environment declares seeds applied. RLS/RT: asserts RLS enabled+forced
everywhere, append-only guards attached, definer functions hardened, publications match the
plan. Hub: none. Evidence: assertion output captured into the evidence package for the
migration train; this is the RLS-028 CI gate.

## 4. Execution and environment policy

| Environment       | Apply mechanism                                                                                                                                                                                                                      | Status this cycle                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| local/development | `supabase db reset` / `migration up` by developers or CI shadow database.                                                                                                                                                            | **BLOCKED (BLK-002)** — CLI/Docker absent. |
| staging           | CI-applied after review, with journal + schema-diff evidence.                                                                                                                                                                        | Not provisioned (BLK-002/BLK-006).         |
| pilot/production  | **Human-operated only** — A3 four-eyes (author ≠ approver ≠ sole executor), execution token, maintenance window, journal row, status-registry update, evidence package. Rollback/restore is A4. **Never automatic (KL-INF-P1-037).** | No applies exist or are claimed.           |

Verification evidence per applied group (when execution becomes possible): migration journal
row (id, content hash, actor, environment, time), `supabase migration list` output,
observed-dictionary diff (`artifacts/db/schema-diff.md`) empty or reconciled, 0160 assertion
output, and status-registry row in `docs/data/migration-status-registry.md`.

## 5. Static validation harness (runs today)

| Command                    | What it actually does                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm migrations:validate` | Existing repo gate: filename pattern + destructive-statement marker guard.                                                                                                                                                                                                                                                                                               |
| `pnpm db:validate`         | `scripts/database/db-validate.mjs`: naming, group markers, group↔timestamp monotonicity, parse sanity (balanced quotes, terminating `;`), destructive guard, schema-name cross-check against the data dictionary (control-plane allowlist: `kitluy_ops`). Prints per-check PASS/FAIL; prints BLOCKED-NOT-EXECUTED for apply/RLS execution portions without failing them. |
| `pnpm db:migrations:check` | Alias of the repo migration gate (`scripts/database/validate-migrations.mjs`).                                                                                                                                                                                                                                                                                           |
| `pnpm db:schema:check`     | `scripts/database/db-schema-check.mjs`: canonical schema spec exists; every `kitluy_*` schema in the data dictionary appears in the schema spec; duplicate canonical entity-name check. Live-database drift comparison is BLOCKED-NOT-EXECUTED (requires Supabase CLI).                                                                                                  |
| `pnpm test:rls`            | Honest BLOCKED reporter (exit non-zero) — RLS execution requires the Supabase CLI and PostgreSQL (BLK-002).                                                                                                                                                                                                                                                              |

A static command exits non-zero **only** when a static check fails; blocked execution portions
are reported in output text and never converted into fake passes.

## 6. Acceptance criteria for CONTRACT-APPROVED

1. Independent review confirms group contents cover every dictionary relation exactly once and
   FK direction never crosses groups backwards except via rule R4.
2. The RLS document §5 matrix and groups 0120/0130/0160 are mutually consistent.
3. Harness commands pass statically; BLK-002 remains recorded until Docker/Supabase CLI exist,
   at which point shadow-database application and RLS-001..030 execution become gate evidence.
4. No claim of applied migrations exists anywhere without a journal row and status-registry
   entry.

## Amendment integration (Cycle 3 §16, 2026-07-26)

Group **0070 payments_and_finance** now additionally owns the `kitluy_finance`
relations of DD Amendment-001 (subledger_accounts, subledger_account_translations,
journal_entries, journal_postings, source_postings, idempotency_records).
Balancing trigger + RPC land with group 0130. Not authored in Cycle 3;
unresolved finance owner values unaffected.
