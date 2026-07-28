# KitLuy Implementation Status and Evidence Register

**Filename:** `kitluy-implementation-status-and-evidence-register-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL IMPLEMENTATION-EVIDENCE CONTROL

## 1. Governing rule

The Master Feature Registry is a planning and normalization baseline, not implementation evidence. A bible, specification, backlog, mockup, source classification, generated code sample or agent statement is not sufficient to claim implementation.

Every status **above `SPECIFIED`** must link to verifiable evidence.

## 2. Status model

| Status               | Meaning                                                            | Minimum evidence                                                                | Evidence link required? |
| -------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ----------------------- |
| PROPOSED             | Idea or recommendation; not approved.                              | Proposal source and owner review target.                                        | No                      |
| OWNER-LOCKED         | Owner-approved direction; not yet a complete build contract.       | Versioned owner decision.                                                       | No implementation claim |
| SPECIFIED            | Buildable target documented with scope and acceptance obligations. | Current approved specification and traceability.                                | Baseline                |
| CONTRACT-APPROVED    | Schema/API/event/state/permission/offline contracts approved.      | Approved contract artifacts, reviewers and version IDs.                         | Yes                     |
| SCAFFOLDED           | Repository structure or nonfunctional skeleton exists.             | Repository path, commit, build result and scope statement.                      | Yes                     |
| IMPLEMENTED-IN-DEV   | Capability works in development.                                   | Commit, applied dev migrations, automated tests and dev deployment evidence.    | Yes                     |
| INTEGRATION-VERIFIED | Cross-product and failure-path verification passed.                | Integration/security/offline/payment/reconciliation/performance evidence.       | Yes                     |
| PILOT-READY          | Operational prerequisites and go-live package are complete.        | Monitoring, DR, support, training, rollback and sign-off evidence.              | Yes                     |
| PILOT-PROVEN         | Approved pilot demonstrates target outcomes and stability.         | Pilot cohort, dates, metrics, incidents, acceptance and owner sign-off.         | Yes                     |
| PRODUCTION           | Running for approved production scope.                             | Production release, migrations, health, monitoring, support and owner approval. | Yes                     |
| DEPRECATED           | No longer approved for new use; removal/migration is controlled.   | Deprecation decision, consumers, migration and removal date.                    | Yes                     |

## 3. Evidence classes

| Evidence code | Evidence type                    | Required metadata                                                                |
| ------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| E-REPO        | Repository implementation        | Repository, path, commit SHA, branch/tag, reviewer                               |
| E-MIG         | Migration                        | File/version, checksum, environment, applied timestamp, validation result        |
| E-CONTRACT    | Schema/API/event contract        | Artifact/version, approvers, compatibility and test references                   |
| E-TEST        | Automated or manual test         | Test ID, build/commit, environment, date, result, retained output                |
| E-DEPLOY      | Deployment/release               | Environment, release ID, artifact digest/signature, deployment date, rollback ID |
| E-OBS         | Monitoring/telemetry             | Dashboard/query, time window, thresholds and interpretation                      |
| E-SEC         | Security evidence                | Threat review, RLS/auth tests, scan/assessment, findings and closure             |
| E-DR          | Backup/restore/recovery evidence | Backup ID, restore target, drill date, achieved RPO/RTO                          |
| E-HW          | Hardware/device evidence         | Model/BOM, serial/certificate, image/release, certification test                 |
| E-PILOT       | Pilot evidence                   | Cohort, dates, scope, metrics, incidents, acceptance and owner sign-off          |
| E-PROD        | Production evidence              | Tenant/Store scope, release, health, support, monitoring and approval            |

## 4. Current baseline from the supplied source package

No complete repository checkout, applied migration history, executable end-to-end test package, deployment record, signed release inventory, pilot evidence or production telemetry was supplied with this control-pack task. Therefore this register asserts **no product capability above `SPECIFIED`**.

| Register ID | Capability/artifact                  | Product/domain            | Current status | Evidence/source                                       | Gap/constraint                                                                | Accountable owner    |
| ----------- | ------------------------------------ | ------------------------- | -------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------- |
| IMP-001     | Suite-wide product direction         | Suite                     | OWNER-LOCKED   | Current Project Instructions and owner decisions      | Direction only; no implementation claim                                       | Owner                |
| IMP-002     | Source-of-truth control pack         | Documentation             | SPECIFIED      | This v1.0.0 control pack files                        | Created in this package; requires owner adoption into repository              | Project Owner        |
| IMP-003     | Master technical authority v4        | Documentation             | PROPOSED       | Expected file not present                             | Must be created and approved                                                  | Project Owner        |
| IMP-004     | Master business authority v2         | Documentation             | PROPOSED       | Expected file not present                             | Must be created and approved                                                  | Project Owner        |
| IMP-010     | Admin PWA Portal Phase 1             | kitluy-admin-pwa-portal   | SPECIFIED      | kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md         | No complete repository/migration/test/deployment evidence supplied            | Product Owner        |
| IMP-011     | Chain Portal Phase 1                 | kitluy-chain-pwa-portal   | SPECIFIED      | kitluy-chain-portal-phase1-spec-v3.0.0.md             | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-012     | Partner PWA Portal Phase 1           | kitluy-partner-pwa-portal | SPECIFIED      | kitluy-partner-portal-phase1-spec-v2.0.0.md           | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-013     | Partner App Phase 1                  | kitluy-partner-app        | SPECIFIED      | kitluy-partner-app-phase1-spec-v2.0.0.md              | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-014     | POS Desktop App Phase 1              | kitluy-pos-desktop-app    | SPECIFIED      | kitluy-pos-desktop-app-phase1-spec-v4.0.0.md          | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-015     | POS Mobile App Phase 1               | kitluy-pos-mobile-app     | SPECIFIED      | kitluy-pos-mobile-app-phase1-spec-v2.2.0.md           | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-016     | Storefront Phase 1                   | kitluy-storefront         | SPECIFIED      | kitluy-storefront-phase1-spec-v1.1.0.md               | Owner-approved target; no complete implementation evidence supplied           | Product Owner        |
| IMP-017     | Store Hub Phase 1                    | kitluy-hub-agent          | SPECIFIED      | kitluy-storehub-phase1-spec-v1.0.0.md                 | Owner-approved target; no image/cert/hardware/pilot evidence supplied         | Edge Product Owner   |
| IMP-018     | B2B Website Phase 1                  | kitluy-b2b-website        | SPECIFIED      | kitluy-b2b-website-phase1-spec-v1.0.0.md              | No complete implementation evidence supplied                                  | Product Owner        |
| IMP-019     | Ecosystem Infrastructure Phase 1     | Infrastructure            | SPECIFIED      | kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md | No applied IaC/deployment/monitoring/restore evidence supplied                | Platform Owner       |
| IMP-020     | Master Feature Registry v0.2         | Planning registry         | PROPOSED       | kitluy-master-feature-registry-v0.2.*                 | Planning/normalization baseline; individual owner locks remain direction only | Product Owner        |
| IMP-021     | Twelve registry capability decisions | Cross-domain              | OWNER-LOCKED   | kitluy-owner-decision-lock-12-capabilities-v1.0.md    | No decision is implementation evidence                                        | Project Owner        |
| IMP-030     | Applied Supabase migration baseline  | Database                  | PROPOSED       | No authoritative applied-migration inventory supplied | Do not claim schema readiness                                                 | Backend Owner        |
| IMP-031     | Signed edge release pipeline         | Release                   | OWNER-LOCKED   | Project Instruction Writing.txt and current specs     | Direction specified; no release artifacts or verification supplied            | Platform/Fleet Owner |
| IMP-032     | Phase 1 pilot                        | Operations                | PROPOSED       | No approved pilot evidence package supplied           | Pilot-ready/proven/production claims prohibited                               | Project Owner        |

## 5. Status-transition gates

### SPECIFIED -> CONTRACT-APPROVED

- authoritative entity and state model;
- schema/API/event contracts;
- permissions and RLS design;
- offline and reconciliation behavior;
- migration and compatibility plan;
- acceptance criteria and documentation review;
- named approvers.

### CONTRACT-APPROVED -> SCAFFOLDED

- repository path exists;
- build/lint/typecheck passes for skeleton scope;
- package ownership and CI are registered;
- no false end-user capability claim.

### SCAFFOLDED -> IMPLEMENTED-IN-DEV

- code and required migrations are applied in development;
- unit/component/contract tests pass;
- feature flag and audit controls work;
- dev deployment is reproducible.

### IMPLEMENTED-IN-DEV -> INTEGRATION-VERIFIED

- cross-product contracts pass;
- Store Hub/offline/reconnect behavior passes where applicable;
- tenant/RLS/permission isolation passes;
- payment, finance and inventory reconciliation passes;
- failure, retry, idempotency, performance and recovery paths pass.

### INTEGRATION-VERIFIED -> PILOT-READY

- monitoring and alerts active;
- backup/restore and rollback tested;
- support, training, hardware and runbooks complete;
- open blockers and `[REQUIRED]` production values closed;
- go-live approval recorded.

### PILOT-READY -> PILOT-PROVEN

- approved cohort operated for the agreed period;
- success metrics and failure thresholds assessed;
- incidents and corrections documented;
- owner accepts pilot result.

### PILOT-PROVEN -> PRODUCTION

- production release and migrations approved;
- production monitoring, support and recovery active;
- commercial/legal requirements complete;
- production scope and rollback documented.

## 6. Evidence record template

```markdown
### EVID-<product>-<number>

- Capability / feature ID:
- Claimed status:
- Product and vertical:
- Environment:
- Repository / path:
- Commit / release / artifact digest:
- Applied migrations:
- Tests and retained outputs:
- Deployment record:
- Monitoring / security / DR evidence:
- Pilot or production scope:
- Verified by:
- Verification date:
- Limitations:
- Related decision/reconciliation IDs:
```

## 7. Downgrade and deprecation rule

When evidence expires, is invalidated, or no longer matches the active release, downgrade the status. Do not preserve a higher status for convenience. `DEPRECATED` requires a migration/removal plan and must not hide active production dependencies.

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable):
`docs/source/canonical/kitluy-implementation-status-and-evidence-register-v1.0.0.md`.
The owner 11-status model (PROPOSED → OWNER-LOCKED → SPECIFIED →
CONTRACT-APPROVED → SCAFFOLDED → IMPLEMENTED-IN-DEV → INTEGRATION-VERIFIED →
PILOT-READY → PILOT-PROVEN → PRODUCTION → DEPRECATED) is adopted as canonical.

**Baseline correction:** the owner register's §4 baseline ("no complete
repository checkout was supplied") predates this repository. The evidence rows
below re-register the actual repository evidence under the owner model.

**Status mapping (KLREC-2026-07-26-008):** bootstrap statuses BUILT/TESTED map
to **SCAFFOLDED** with linked evidence — they exceed bare scaffolding (real
unit-tested behavior) but do not meet the IMPLEMENTED-IN-DEV gates (no applied
dev migrations, no reproducible dev deployment). No status was advanced beyond
its evidence. Evidence classes: E-REPO (repository path at commit),
E-TEST (executed test run 2026-07-26, `pnpm verify` all 11 gates passing).

### Machine-checkable evidence table

Rows above SPECIFIED carry linked evidence (validated by `pnpm docs:registry-check`).

<!-- registry-check:start -->

| Item | Status | Evidence |
| --- | --- | --- |
| Shared package @kitluy/money (integer minor-unit money, KHR/USD, allocation) | SCAFFOLDED | E-REPO+E-TEST `packages/money/test/money.test.ts` (8 tests, pass 2026-07-26) |
| Shared package @kitluy/localization (km/en, +855 phones, business date) | SCAFFOLDED | E-REPO+E-TEST `packages/localization/test/localization.test.ts` |
| Shared package @kitluy/api-errors (envelope + POS §14.3 codes) | SCAFFOLDED | E-REPO+E-TEST `packages/api-errors/test/api-errors.test.ts` |
| Shared package @kitluy/rbac (explicit grants, deny-by-default) | SCAFFOLDED | E-REPO+E-TEST `packages/rbac/test/rbac.test.ts` |
| Shared package @kitluy/approvals (A0-A4, four-eyes self-approval rejection) | SCAFFOLDED | E-REPO+E-TEST `packages/approvals/test/approvals.test.ts` |
| Shared package @kitluy/audit (append-only log) | SCAFFOLDED | E-REPO+E-TEST `packages/audit/test/audit.test.ts` |
| Shared package @kitluy/sync-protocol (outbox envelope, conflict policies, idempotency keys) | SCAFFOLDED | E-REPO+E-TEST `packages/sync-protocol/test/sync-protocol.test.ts` |
| Shared package @kitluy/feature-flags (Phase 1 active; 2-8 + future clients OFF) | SCAFFOLDED | E-REPO+E-TEST `packages/feature-flags/test/phase-gates.test.ts` |
| Shared package @kitluy/shared-config (fail-closed env parsing, local-target guard) | SCAFFOLDED | E-REPO+E-TEST `packages/shared-config/test/shared-config.test.ts` |
| Shared package @kitluy/observability (JSON logger, secret redaction) | SCAFFOLDED | E-REPO+E-TEST `packages/observability/test/observability.test.ts` |
| Shared packages shared-types, resource-scope, event-contracts, web-ui | SCAFFOLDED | E-REPO `packages/*/src` (exercised via dependent tests and app smoke tests) |
| Remaining 26 shared packages (boundary placeholders) | SCAFFOLDED | E-REPO `packages/*/README.md` (boundary only, no behavior) |
| Laundry vertical: T1-T4 profile capability matrix | SCAFFOLDED | E-REPO+E-TEST `verticals/phase1-laundry/test/laundry.test.ts` |
| Laundry vertical: T2 display state machine (matches terminal-profile contract §6.4) | SCAFFOLDED | E-REPO+E-TEST `verticals/phase1-laundry/test/laundry.test.ts` |
| Laundry vertical: custody event registry + per-piece/per-weight pricing lines | SCAFFOLDED | E-REPO+E-TEST `verticals/phase1-laundry/test/laundry.test.ts` |
| Store Hub agent: transactional outbox + offline/reconnect harness | SCAFFOLDED | E-REPO+E-TEST `services/kitluy-hub-agent/test/offline-reconnect.test.ts` (pnpm test:offline) |
| Store Hub agent: LAN API kernel (agreed routes; mutations blocked per KLREC-2026-07-26-001) | SCAFFOLDED | E-REPO+E-TEST `services/kitluy-hub-agent/test/lan-api.test.ts` |
| 18 service kernels (health/ready/version, config validation, graceful shutdown) | SCAFFOLDED | E-REPO+E-TEST `services/*/test/http.test.ts` |
| 4 governed API OpenAPI governance skeletons + contract tests | SCAFFOLDED | E-REPO+E-TEST `services/kitluy-*-api/test/contract.test.ts` (pnpm test:contract) |
| 8 Phase 1 application shells (fail-closed, km/en, error boundaries) | SCAFFOLDED | E-REPO+E-TEST `apps/*/test/` smoke tests + pnpm build (68 tasks, 2026-07-26) |
| **WS-05 catalog, pricing and configuration persistence (0040/0045/0050)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST reset-from-zero 11 migrations + 73-case suite + live probes (overlap guard, snapshot immutability, scope escape); evidence `docs/evidence/phase1/ws-05/WS-05-T001/EXECUTION-EVIDENCE.md`; review 2026-07-27__WS-05-06-EXECUTION APPROVED |
| **WS-06 customer identity and consent persistence (0060/0065)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST same chain (E.164/merge/consent probes; composite tenant FK fix probe-verified); same evidence + review |
| **WS-07 Laundry Booking aggregate and garment custody persistence (0075/0080/0095)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-MIG reset-from-zero 16 migrations (30 new relations); E-TEST 121 assertion/RLS PASS (26 assertions + 95 RLS incl. 38 Cycle-6 cases), engine regression 65/65 unchanged, DB-backed integration 11/11 (`verticals/phase1-laundry-persistence`); E-SEC 30 relations RLS forced, 30 SELECT-only policies, 0 anon/0 write, append-only + no-delete triggers probed live; evidence `docs/evidence/phase1/ws-07/WS-07-T002,T003,T004/EXECUTION-EVIDENCE.md`; review `00_AI_HANDOFF/reviews/2026-07-27__WS-07-08-EXECUTION__REVIEW.md` **APPROVED-WITH-CONDITIONS** (47/47 adversarial probes held; carried non-blocking RV-002/RV-003; owner acceptance of the financial/custody surface remains OPEN). NOT INTEGRATION-VERIFIED — no Edge/Hub routes (BLK-003), no deployment |
| **WS-08 payments, deposits, refunds, reconciliation and finance posting persistence (0085/0090/0095)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-MIG same chain; E-TEST engine regression 40/40 (26 canonical vectors + 14 invariants) unchanged, DB-backed integration 12/12 (`packages/payments-persistence`), balanced-journal/idempotency/four-eyes probes live; E-SEC journals RPC-write-only (direct INSERT/UPDATE/DELETE revoked incl. service_role), AMD-I1..I7 enforced; evidence `docs/evidence/phase1/ws-08/WS-08-T002,T003,T004,T005/EXECUTION-EVIDENCE.md`; same review **APPROVED-WITH-CONDITIONS**. KHQR is the `DEV_KHQR_SIM` simulator only — live provider blocked (PAY-OD-001/BLK-006); chart of accounts fictional `DEV-*` (FIN-OD-001 open). NOT INTEGRATION-VERIFIED |
| **KL-DEC-001 contract alignment (Edge routes/scopes, terminal profiles, RBAC, resource scopes, event contracts, API errors)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | Owner decision KLD-2026-07-26-002 OWNER-APPROVED (all five groups) + completed ballot; E-REPO commits 463b50a/a97a380/83c86aa/0508cbb/191edc6/350aace; E-MIG 0100 terminal_profile_identifiers sha256 3068d287…2fff1f (reset-from-zero 17 migrations, double seed idempotent); E-TEST verify 11/11, typecheck 87/87, test 58/58, test:contract 20/20, db:test 121, test:rls 95, targeted suites 18/59/15/6/45/76/11/9; E-SEC Hub fail-closed across 297 verb×path probes, all retired identifiers rejected, forged grants denied, scopeBreadth hardened from fail-open; evidence `docs/evidence/phase1/kl-dec-001/KL-DEC-001-ALIGNMENT-EVIDENCE.md`; review `00_AI_HANDOFF/reviews/2026-07-27__KL-DEC-001-ALIGNMENT__REVIEW.md` **APPROVED-WITH-CONDITIONS** (no blocking findings). Edge mutation business workflows remain NOT INTEGRATION-VERIFIED; carried conditions RV-001..RV-005 and owner items KLREQ-015..019 |
| **WS-09 Store Hub local runtime and persistence (edge_* schema, command layer, journals, safety modes)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-MIG 15 Hub migrations applied from zero into the SEPARATE `kitluy_hub_local` database, checksum-registered (editing an applied file is refused — proven); 54 `edge_*` base tables. E-TEST hub-agent 147 passed / 2 skipped (destructive backup-restore opt-in, run separately 2/2); Hub assertions **29** (counted as `NOTICE:  PASS`); double seed idempotent; engine suites reused unmodified (65/40/9/4); cloud regressions unchanged db:test 121, test:rls 95, verify 11/11. E-SEC 19-case authorization matrix + independent 18-case re-derivation each asserting zero write delta; 32-attack append-only probe incl. superuser; fabricated-acknowledgement rejection proven four ways; real crash-before/after-commit via pg_terminate_backend; Hub read-only blocks mutations while reads serve. Evidence `docs/evidence/phase1/ws-09/WS-09-EXECUTION-EVIDENCE.md`; review `00_AI_HANDOFF/reviews/2026-07-27__WS-09-STOREHUB__REVIEW.md` **APPROVED-WITH-CONDITIONS** (44 independent probes, all held, no blocking trigger). MATERIAL LIMITATION: plant production stages have no approved route/RBAC key (KLREQ-028), so no end-to-end T1→T4 lifecycle exists through the Hub command surface alone. Engine authority is a COMMAND-LAYER guarantee, not a DB constraint (KLRISK-HUB-003). NOT INTEGRATION-VERIFIED |
| **WS-01 local Supabase development foundation** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST reset-from-zero + healthy stack (-x logflare,vector) + deterministic types; evidence `docs/evidence/phase1/ws-01/WS-01-T004/EXECUTION-EVIDENCE.md`; review 2026-07-27__WS-01-04-EXECUTION APPROVED |
| **WS-02 identity/tenancy persistence (0010)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST migrations applied + seeds idempotent + assertions + RLS cases executed (same evidence + review) |
| **WS-03 Digital Store/Location persistence (0020)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST same evidence chain (primary-vertical invariant asserted live) |
| **WS-04 authorization/audit/approvals + RLS (0030/0035)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST 9/9 assertions + 23/23 RLS (14 neg/9 pos) + live four-eyes/append-only probes denied + actual-DB policy inventory (44 SELECT/0 write/0 anon) |
| Migrations 0010/0020/0030/0035 (45 tables, helpers, policies) + seeds + RLS/assertion test files + local-exec tooling | superseded row — see IMPLEMENTED-IN-DEV entries above (2026-07-27) | E-REPO `supabase/migrations/20260726190010..190035_*.sql`, `supabase/seed/`, `supabase/tests/`; static gates PASS 2026-07-26; 3 reviews (blocking RV-201/202/301/302 fixed) |
| Finance-subledger DD amendment 001 (6 kitluy_finance relations) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-data-dictionary-amendment-001-finance-subledger-v1.0.0.md` + review 2026-07-26__FIN-DD-001 (APPROVED) |
| Governing Phase 1 security test system (114 KLSEC; 190/190 aliases) | CONTRACT-APPROVED | E-REPO `docs/security/kitluy-phase1-security-test-system-v1.0.0.md` + review 2026-07-26__SEC-CONS-001 (APPROVED, counts reproduced) |
| Canonical Supabase schema specification (235/235 dictionary parity, 18-invariant matrix) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-schema-v1.0.0.md` + review 2026-07-26__WS-02-T001 (APPROVED-WITH-CONDITIONS, applied) |
| Canonical RLS/authorization specification (24 schemas, RLS-001..030 plans) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-rls-and-authorization-v1.0.0.md` + review 2026-07-26__WS-04-T001 |
| Canonical migration plan (0000-0160) + 0000 controls migration + db harness | Plan CONTRACT-APPROVED; migration SQL SCAFFOLDED | E-REPO `docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md`, `supabase/migrations/20260726180000_*.sql`; static harness PASS 2026-07-26; DB execution BLOCKED (BLK-002) |
| Contract vocabulary + Edge API decision package (5-group ballot) | CONTRACT-APPROVED document; ALL GROUPS OWNER-APPROVAL-REQUIRED | E-REPO `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md` + review 2026-07-26__KL-DEC-001 |
| Laundry Booking lifecycle + production state machines (KBR-LND/TXN encoded) | superseded row — engine now DB-bound, see **WS-07** IMPLEMENTED-IN-DEV above (2026-07-27) | E-REPO+E-TEST `verticals/phase1-laundry/test/` (65/65, unchanged and re-run 2026-07-27; independent review PASS-WITH-CONDITIONS, RV-001 applied) |
| Payments engine passing all 26 canonical vectors | superseded row — engine now DB-bound, see **WS-08** IMPLEMENTED-IN-DEV above (2026-07-27) | E-REPO+E-TEST `packages/payments/test/vectors.test.ts` (40/40, unchanged and re-run 2026-07-27; four-eyes review, blocking RV-001 fixed + regression) |
| Data dictionary Amendment-002 (10 kitluy_core customer-identity/consent relations, KLREQ-012) | PROPOSED — technically authored, independently reviewed; **owner approval NOT granted** | E-REPO `docs/data/kitluy-suite-supabase-data-dictionary-amendment-002-customer-identity-and-consent-v1.0.0.md`; mirrors the implemented+tested 0060/0065 schema; open owner values (CUS-OD-001..004, retention) remain `[REQUIRED]` |
| Documentation corpus governance tooling (inventory/hash/classify/coverage checks) | SCAFFOLDED | E-REPO+E-TEST `scripts/docs/` (pnpm docs:verify, pass 2026-07-26) |

<!-- registry-check:end -->

### Documentation-status changes from KL-DOCS-001 (no evidence required at these levels)

| Item | Old | New | Source |
| --- | --- | --- | --- |
| **WS-05 catalog, pricing and configuration persistence (0040/0045/0050)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST reset-from-zero 11 migrations + 73-case suite + live probes (overlap guard, snapshot immutability, scope escape); evidence `docs/evidence/phase1/ws-05/WS-05-T001/EXECUTION-EVIDENCE.md`; review 2026-07-27__WS-05-06-EXECUTION APPROVED |
| **WS-06 customer identity and consent persistence (0060/0065)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST same chain (E.164/merge/consent probes; composite tenant FK fix probe-verified); same evidence + review |
| **WS-01 local Supabase development foundation** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST reset-from-zero + healthy stack (-x logflare,vector) + deterministic types; evidence `docs/evidence/phase1/ws-01/WS-01-T004/EXECUTION-EVIDENCE.md`; review 2026-07-27__WS-01-04-EXECUTION APPROVED |
| **WS-02 identity/tenancy persistence (0010)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST migrations applied + seeds idempotent + assertions + RLS cases executed (same evidence + review) |
| **WS-03 Digital Store/Location persistence (0020)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST same evidence chain (primary-vertical invariant asserted live) |
| **WS-04 authorization/audit/approvals + RLS (0030/0035)** | **IMPLEMENTED-IN-DEV** (2026-07-27) | E-TEST 9/9 assertions + 23/23 RLS (14 neg/9 pos) + live four-eyes/append-only probes denied + actual-DB policy inventory (44 SELECT/0 write/0 anon) |
| Migrations 0010/0020/0030/0035 (45 tables, helpers, policies) + seeds + RLS/assertion test files + local-exec tooling | superseded row — see IMPLEMENTED-IN-DEV entries above (2026-07-27) | E-REPO `supabase/migrations/20260726190010..190035_*.sql`, `supabase/seed/`, `supabase/tests/`; static gates PASS 2026-07-26; 3 reviews (blocking RV-201/202/301/302 fixed) |
| Finance-subledger DD amendment 001 (6 kitluy_finance relations) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-data-dictionary-amendment-001-finance-subledger-v1.0.0.md` + review 2026-07-26__FIN-DD-001 (APPROVED) |
| Governing Phase 1 security test system (114 KLSEC; 190/190 aliases) | CONTRACT-APPROVED | E-REPO `docs/security/kitluy-phase1-security-test-system-v1.0.0.md` + review 2026-07-26__SEC-CONS-001 (APPROVED, counts reproduced) |
| Canonical Supabase schema specification (235/235 dictionary parity, 18-invariant matrix) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-schema-v1.0.0.md` + review 2026-07-26__WS-02-T001 (APPROVED-WITH-CONDITIONS, applied) |
| Canonical RLS/authorization specification (24 schemas, RLS-001..030 plans) | CONTRACT-APPROVED | E-REPO `docs/data/kitluy-suite-supabase-rls-and-authorization-v1.0.0.md` + review 2026-07-26__WS-04-T001 |
| Canonical migration plan (0000-0160) + 0000 controls migration + db harness | Plan CONTRACT-APPROVED; migration SQL SCAFFOLDED | E-REPO `docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md`, `supabase/migrations/20260726180000_*.sql`; static harness PASS 2026-07-26; DB execution BLOCKED (BLK-002) |
| Contract vocabulary + Edge API decision package (5-group ballot) | CONTRACT-APPROVED document; ALL GROUPS OWNER-APPROVAL-REQUIRED | E-REPO `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md` + review 2026-07-26__KL-DEC-001 |
| Laundry Booking lifecycle + production state machines | REQUIRED VALUE | SPECIFIED | `docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md`, `kitluy-transaction-and-booking-lifecycle-v1.0.0.md` |
| Governed API specifications (4) + registries | PLANNED | SPECIFIED | `docs/source/api-contracts/` |
| Event/job/webhook registries + outbox pattern + compatibility policy | PLANNED | SPECIFIED | `docs/source/api-contracts/` |
| Canonical business rules (10 documents) | PLANNED | SPECIFIED | `docs/source/business-rules/` |
| Security pack (RBAC registry 107 keys, audit registry, threat model, policies) | PLANNED | SPECIFIED | `docs/source/security/` |
| Store Hub/offline pack (11 documents) | PLANNED | SPECIFIED (LAN API + terminal-profile contract NEED RECONCILIATION) | `docs/source/offline/` |
| Shared-service specifications (9) | PLANNED | SPECIFIED | `docs/source/shared-services/` |
| UI/UX build pack (21 documents incl. provisional design tokens) | PLANNED | SPECIFIED | `docs/source/ui-ux/` |
| Engineering standards pack (13 standards + pack manifest) | — | SPECIFIED (toolchain adoption pending KLREQ-009) | `docs/source/engineering/` |
| QA/testing pack: master test plan, matrices, 524-case registry, payment vectors | — | SPECIFIED (all cases SPECIFIED_NOT_EXECUTED; zero execution evidence) | `docs/source/qa/` |
| Infrastructure/operations pack (14 runbooks/plans) | — | SPECIFIED (SLOs/domains/providers remain [REQUIRED]) | `docs/source/infrastructure/` |
| AI Swarm Operating System pack | — | SPECIFIED (adoption pending KLREQ-010) | `docs/source/owner-instructions/kitluy-ai-swarm-operating-system-v1.0.0/` |
| Supabase implementation pack | REQUIRED VALUE | SPECIFIED-PARTIAL (10 of 13; schema/RLS/migration-plan missing) | `docs/source/data-contracts/` |
