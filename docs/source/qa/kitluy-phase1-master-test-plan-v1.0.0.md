# KitLuy Phase 1 Master Test Plan

| Field | Value |
|---|---|
| Filename | `kitluy-phase1-master-test-plan-v1.0.0.md` |
| Version | `v1.0.0` |
| Date | `2026-07-26` |
| Owner | HET / KitLuy Suite Project Owner |
| Phase | Phase 1 - Laundry |
| Status | Canonical testing and evidence specification; not execution evidence |
| Timezone | `Asia/Phnom_Penh` |
| Languages | Khmer and English |
| Currencies | KHR and USD |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.


## 1. Purpose

This plan makes the G0-G5 model the universal build, verification, pilot, and phase-exit process for KitLuy Phase 1. It governs Shared Core, Supabase, DigitalOcean infrastructure, Store Hub, T1-T4, APIs, portals, mobile clients, Storefront, files, notifications, integrations, reporting, releases, and operational evidence.

The plan has four non-negotiable outcomes:

1. A planning statement can never be mistaken for implementation evidence.
2. A passing UI demonstration cannot substitute for schema, authorization, offline, finance, recovery, and audit proof.
3. A defect fix is not accepted until the original failure and the regression test are both evidenced.
4. G5 is not reached until pilot evidence and the Rebuild Test are approved.

## 2. Authority and precedence

1. Current owner decisions and active KitLuy Project Instructions.
2. Applied migrations, verified repository code/tests, deployed infrastructure, and production or controlled-pilot evidence.
3. Approved canonical schema, API, event, state-machine, permission, offline, migration, and business-rule documents.
4. Current product specifications and Rebuild/Business Bibles.
5. Approved handoffs and evidence-based competitor analyses.
6. Competitor clone documents and superseded planning as design references only.

A test must fail closed when authority is unresolved. A test result must never silently reconcile a source conflict.

## 3. Universal gate model

| Gate | Meaning | Mandatory exit evidence | Approval |
|---|---|---|---|
| G0 - Authority | Authority, ownership, scope, exclusions, decisions, and rejected patterns are resolved. | Approved scope; source-of-truth links; conflict/decision register; required values; risk classification; test impact. | Owner/product/architecture as applicable |
| G1 - Contract | Schema, APIs, events, state machines, permissions, offline behavior, migrations, audit, and documentation are approved. | Versioned contracts; examples; error catalog; migration/rollback; test design; traceability; fixtures. | Architecture, security, data, product, QA |
| G2 - Build | Code, migrations, seeds, UI, jobs, and automated tests are complete in development. | Build SHA; migration checksums; unit/component/contract results; static analysis; coverage; artifact signatures. | Engineering and QA |
| G3 - Integrated verification | Cross-product, security, offline, finance, recovery, and performance verification passes. | E2E results; RLS negatives; offline/reconnect; payment/reconciliation vectors; load/security/recovery evidence. | QA, security, finance, infrastructure, product |
| G4 - Pilot readiness | Monitoring, rollback, training, support, hardware, and operating readiness are proven. | Alert tests; dashboards; restore/rollback rehearsal; certified hardware; runbooks; training; go-live checklist. | Operations, support, security, product owner |
| G5 - Pilot evidence and Rebuild Test | Controlled pilot and independent reconstruction are approved. | Pilot package; business-day evidence; support and incident evidence; Rebuild Test result; updated Bibles. | Owner and designated approvers |

A feature may not skip a gate. A later gate may expose an earlier-gate defect; the feature returns to the failed gate and repeats downstream verification.

## 4. Scope

### 4.1 Included systems

- Shared Suite Governance and neutral KitLuy Core.
- Supabase PostgreSQL, Auth, RLS, Realtime, functions, metadata, and audit.
- DigitalOcean hosting, workers, Spaces, releases, AI/MCP/RAG, monitoring, backups, and scaling path.
- `kitluy-b2b-website`, Admin, Chain, Partner Portal, Partner App, POS Desktop, POS Mobile, Storefront.
- Store Hub and managed T1-T4 device profiles.
- Management, Commerce Store, Edge Operations, and Connector APIs.
- File, Notification, Integration, Reporting, Release, AI Gateway, MCP, RAG, jobs, events, and webhooks.
- Laundry Bookings, services, garments, pricing, deposits, KHQR, receipts/tags, production, custody, issues, pickup/delivery, consumables, and reporting.

### 4.2 Explicit non-scope

- Later-vertical capability depth unless required for neutral Core regression protection.
- Unapproved live provider credentials, commercial pricing, tax policy, or rounding policy.
- Claims that a documented scenario has executed when no evidence package exists.

## 5. Registry baseline

This pack contains **524 normalized test cases**, including **483 cases extracted from current Phase 1 product specifications** and shared cross-product cases added by this testing system.

### Cases by product or owner

| Product/owner | Cases |
|---|---:|
| `kitluy-admin-pwa-portal` | 84 |
| `kitluy-b2b-website` | 73 |
| `kitluy-partner-app` | 61 |
| `kitluy-pos-mobile-app` | 58 |
| `kitluy-ecosystem-infrastructure` | 50 |
| `kitluy-pos-desktop-app` | 40 |
| `kitluy-storehub` | 35 |
| `kitluy-chain-pwa-portal` | 30 |
| `kitluy-partner-pwa-portal` | 30 |
| `kitluy-storefront` | 22 |
| `Payment Service; Finance Subledger` | 3 |
| `All Phase 1 Products` | 2 |
| `Domain Event Runtime` | 2 |
| `Shared API Gateway` | 2 |
| `Shared Authorization` | 2 |
| `Shared Suite Governance` | 2 |
| `Store Hub` | 2 |
| `Store Hub; POS Desktop` | 2 |
| `Supabase PostgreSQL/RLS` | 2 |
| `AI Gateway; Infrastructure` | 1 |
| `Admin Portal; Authorization Service` | 1 |
| `Admin Portal; Support Access` | 1 |
| `All Products and Services` | 1 |
| `Connector Runtime` | 1 |
| `Device Trust Service; Store Hub` | 1 |
| `Durable Job Runtime` | 1 |
| `Machine Identity` | 1 |
| `Management API; Commerce Store API; Edge Operations API; Connector API` | 1 |
| `POS Desktop; Store Hub` | 1 |
| `Payment Adapter; POS` | 1 |
| `Payment Adapter; Webhook Runtime` | 1 |
| `Payment Service; Booking Service` | 1 |
| `Reconciliation Service` | 1 |
| `Release Service; Store Hub` | 1 |
| `Reporting Service; Core APIs` | 1 |
| `Store Hub; Cloud Sync` | 1 |
| `Store Hub; Configuration Service` | 1 |
| `Store Hub; POS Desktop T1` | 1 |
| `Store Hub; POS Desktop T3` | 1 |
| `Store Hub; POS Desktop T4` | 1 |
| `Webhook Runtime` | 1 |

### Cases by domain

| Domain | Cases |
|---|---:|
| Product Functional | 84 |
| Hardware and Devices | 78 |
| Offline and Sync | 77 |
| Security | 64 |
| Authorization and Isolation | 58 |
| Payments and Finance | 24 |
| Release and Recovery | 21 |
| Laundry Operations | 17 |
| Customer and Identity | 16 |
| Performance and Capacity | 15 |
| Files and Notifications | 14 |
| Reporting and Truth | 14 |
| Accessibility and Localization | 14 |
| Catalog and Configuration | 9 |
| Infrastructure | 5 |
| Events Jobs and Webhooks | 4 |
| API and Contracts | 3 |
| AI and Integrations | 3 |
| Governance and Evidence | 2 |
| Pilot and Go-live | 1 |
| Rebuild Test | 1 |


## 6. Test levels

| Level | Primary purpose | Typical gate | Required evidence |
|---|---|---|---|
| Static and policy | Lint, type, dependency, schema, migration, IaC, secret and policy checks | G1-G2 | Machine report and configuration version |
| Unit | Pure rules, state transitions, calculations, authorization helpers | G2 | Deterministic result and coverage |
| Component | UI, service module, database function, worker, adapter | G2 | Isolated fixture and result |
| Contract | API, event, job, webhook, file, config and sync schemas | G1-G3 | Consumer/provider compatibility result |
| Integration | Database/RLS, service boundaries, provider sandbox, Hub peripherals | G3 | Request IDs, logs, traces, validator queries |
| System/E2E | Cross-product business flows | G3 | Full evidence bundle and invariant checks |
| Performance/resilience | Load, soak, chaos, recovery, backlog, capacity | G3-G4 | Workload definition, telemetry, thresholds, result |
| Security | Threat-driven negative and abuse testing | G2-G4 | Finding report, exploit evidence, retest |
| Hardware certification | Pi, NVMe, printer, scanner, scale, display, network and power | G3-G4 | Hardware identifiers, firmware, lab record, result |
| Pilot/UAT | Real operational workflow under controlled conditions | G4-G5 | Signed pilot evidence package |
| Rebuild Test | Independent reconstruction and operation | G5 | Checklist, timings, blockers, deviations, approval |

## 7. Environments and test data

| Environment | Allowed data | Purpose | Production-like requirements |
|---|---|---|---|
| Local/unit | Synthetic only | Fast deterministic tests | Contract versions pinned |
| Development | Synthetic and approved fixtures | G2 and early G3 | Full migrations/RLS; fake providers |
| Staging | Synthetic, masked approved data only | Contract, E2E, load, security and rollback | Production topology and secrets model; no live customer data |
| Hardware lab | Synthetic | Device, LAN, power, peripherals, release and recovery | Certified candidate hardware and signed builds |
| Pilot | Consent-governed real operations | G4-G5 | Production controls, monitoring, support, rollback and evidence retention |
| Production | Minimal smoke and monitoring checks | Post-deploy verification | No destructive test; approved test identities only |

Canonical fixtures must include at least Tenant A and Tenant B; one Laundry Digital Store per Tenant; multiple Locations; cross-scope users; active/revoked devices; T1-T4 profiles; KHR and USD Bookings; paid, deposit, balance, refund and exception states; outbox backlog; files; notifications; and stale/partial read models.

## 8. Evidence contract

Every execution record must contain:

- immutable test-run ID and test-case ID;
- gate, environment, date/time, timezone, tester or CI identity;
- repository commit/build SHA, package versions, migration checksums and configuration snapshot;
- fixture IDs, Tenant/Digital Store/Location and device identifiers using safe non-secret references;
- exact steps, actual result, expected result and pass/fail/blocked status;
- API request IDs, event/job IDs, logs, traces, screenshots/video where appropriate;
- database, ledger, RLS, audit and no-duplicate-effect validator results;
- linked defect, severity, owner, fix SHA and regression result;
- evidence file checksums, retention class and approvers.

Screenshots alone are insufficient for finance, authorization, offline, sync, audit, migration, and recovery claims.

## 9. Test-case lifecycle

`DRAFT -> REVIEWED -> APPROVED -> AUTOMATED_OR_SCRIPTED -> EXECUTED -> PASSED/FAILED/BLOCKED -> RETESTED -> RETIRED`

- IDs are never reused.
- A changed contract requires impact analysis and test version update.
- A retired case remains traceable to its replacement.
- Flaky tests are defects. They cannot be hidden by unlimited retries.
- Quarantined tests require an owner, expiry date, and release-risk decision.

## 10. Defect severity and release rules

| Severity | Definition | Gate effect |
|---|---|---|
| Critical | Tenant escape, data loss, unauthorized financial/custody effect, remote compromise, unrecoverable Store outage | Blocks G2-G5 and release |
| High | Material workflow, reconciliation, security, offline, recovery or audit failure | Blocks G3-G5 unless owner-approved containment is documented |
| Medium | Important degraded behavior with safe workaround and no truth violation | Blocks applicable acceptance until risk disposition |
| Low | Cosmetic or minor usability issue without control failure | May be scheduled with evidence-based disposition |

No known Critical remains open at any gate. No High security, finance, isolation, offline, recovery, or hardware issue remains open at G4/G5.

## 11. Automation and CI policy

- Pull request: lint, type, unit, component, migration static checks, schema compatibility, secret scan, dependency scan, focused contract tests.
- Main branch: full contract suite, RLS negatives, service integrations, deterministic database validators.
- Nightly: cross-product E2E, offline simulator, callback replay, dead-letter/replay, backup verification.
- Release candidate: security, load, soak, hardware, A/B rollback, restore, full Phase 1 regression.
- Pilot: scripted opening, business cycle, failure injection, support workflow, close/reconciliation, evidence export.

CI must publish machine-readable JUnit or equivalent results and attach evidence metadata. A green pipeline with skipped required tests is not a pass.

## 12. Gate review package

Each gate review includes scope, changed feature IDs, test cases, results, unresolved defects, risk acceptances, evidence links, approvals, and rollback/re-entry conditions. The reviewer must verify that every claim is supported by evidence from the correct environment.

## 13. Exit rules by gate

### G0
- Authority and scope are versioned.
- Required owner decisions are resolved or explicitly disabled.
- Rejected patterns have testable guardrails.
- Test impact and evidence owners are assigned.

### G1
- Contract matrix has no unowned surface.
- State machines and business rules have positive, negative, boundary and concurrency tests.
- RLS, offline, migration, audit, idempotency and rollback tests are designed before build.
- Provider unknowns remain sandboxed or disabled.

### G2
- All required code and migrations exist in development.
- Automated tests pass with no hidden skip.
- Seeds are idempotent.
- Build artifacts are signed or checksummed as applicable.
- Observability hooks emit expected identifiers and states.

### G3
- Cross-product E2E, RLS, offline/reconnect, payment/reconciliation, file, notification, performance, security and recovery packs pass.
- Finalized records remain append-only.
- Replays and retries produce no duplicate business effect.
- Stale, partial and unavailable truth are never shown as live or zero.

### G4
- Dashboards and alerts are tested.
- Backup restore and release/config rollback are rehearsed.
- Hardware certification is current.
- Support, training, spare/replacement and incident runbooks are approved.
- Pilot entry and abort criteria are signed.

### G5
- Pilot evidence covers normal operations and representative failures.
- Rebuild Test passes using current docs, migrations, contracts and deployment instructions.
- Rebuild and Business Bibles are updated.
- Implementation status register links exact evidence.

## 14. Required reports

- Gate readiness report.
- Daily/weekly execution summary during active test cycles.
- Defect aging and severity report.
- Coverage by feature, contract, product, role, scope, state, failure mode and gate.
- Flaky/quarantined test report.
- Security finding and retest report.
- Performance baseline and capacity report.
- Hardware certification register.
- Pilot evidence index.
- Rebuild Test report.

## 15. Source baseline

This pack is grounded in the current Project Instructions, current Phase 1 product specifications, Store Hub and infrastructure specifications, master feature registry, and the G0-G5 implementation backlogs. Later approved documents supersede this pack only through versioned reconciliation.
