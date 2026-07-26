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
| Documentation corpus governance tooling (inventory/hash/classify/coverage checks) | SCAFFOLDED | E-REPO+E-TEST `scripts/docs/` (pnpm docs:verify, pass 2026-07-26) |

<!-- registry-check:end -->

### Documentation-status changes from KL-DOCS-001 (no evidence required at these levels)

| Item | Old | New | Source |
| --- | --- | --- | --- |
| Laundry Booking lifecycle + production state machines | REQUIRED VALUE | SPECIFIED | `docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md`, `kitluy-transaction-and-booking-lifecycle-v1.0.0.md` |
| Governed API specifications (4) + registries | PLANNED | SPECIFIED | `docs/source/api-contracts/` |
| Event/job/webhook registries + outbox pattern + compatibility policy | PLANNED | SPECIFIED | `docs/source/api-contracts/` |
| Canonical business rules (10 documents) | PLANNED | SPECIFIED | `docs/source/business-rules/` |
| Security pack (RBAC registry 107 keys, audit registry, threat model, policies) | PLANNED | SPECIFIED | `docs/source/security/` |
| Store Hub/offline pack (11 documents) | PLANNED | SPECIFIED (LAN API + terminal-profile contract NEED RECONCILIATION) | `docs/source/offline/` |
| Shared-service specifications (9) | PLANNED | SPECIFIED | `docs/source/shared-services/` |
| UI/UX build pack (21 documents incl. provisional design tokens) | PLANNED | SPECIFIED | `docs/source/ui-ux/` |
| Supabase implementation pack | REQUIRED VALUE | SPECIFIED-PARTIAL (10 of 13; schema/RLS/migration-plan missing) | `docs/source/data-contracts/` |
