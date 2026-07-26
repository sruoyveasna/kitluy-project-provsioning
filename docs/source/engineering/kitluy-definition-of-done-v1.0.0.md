# KitLuy Definition of Done

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.

## 1. Principle

“Done” means reconstructable, secure, tested, deployable and evidenced—not merely coded. The applicable checklist expands with risk and phase.

## 2. Work-item Done

A story/bug is Done when:

- [ ] Authority, feature ID, acceptance criteria and owner are clear.
- [ ] Code follows package and coding standards.
- [ ] Permissions, audit, offline, freshness and localization impacts are handled.
- [ ] Applicable tests pass and evidence is attached.
- [ ] Documentation, registries and handoff are updated.
- [ ] No unapproved required value is guessed.
- [ ] Observability and error handling are present.
- [ ] Reviewer comments are resolved and CODEOWNER approves.
- [ ] Change is merged to protected `main` behind safe compatibility/flag controls when needed.

## 3. Contract Done

A schema/API/event/job/webhook/sync contract is Done when it has versioned machine-readable source, examples, error/security/idempotency/freshness rules, compatibility policy, producer/consumer tests, ownership and migration/deprecation plan.

## 4. Database Done

- Migration is reviewed and immutable after apply.
- Constraints, indexes, RLS and tenant isolation pass.
- Generated types and data dictionary are current.
- Upgrade from supported prior schema passes.
- Backfill/rollback/recovery is tested.
- Production apply authority and evidence are defined.

## 5. UI route/screen Done

- Route inventory maps feature IDs, permissions, data contracts, mutations, states, localization, analytics and QA.
- Loading, empty, error, stale, partial and offline states exist.
- Khmer/English, KHR/USD, timezone, responsive layout and accessibility pass.
- Backend authorization is independently enforced.

## 6. Store edge Done

- Certified hardware/profile is defined.
- LAN and WAN-loss operation pass.
- Idempotency, sequencing, conflict/reconnect and restart pass.
- T1-T4 roles and custody/payment authority pass.
- Signed install/update, health check and rollback pass.
- Recovery/replacement runbook is rehearsed.

## 7. Service Done

- Runtime boundary, schema ownership, APIs/jobs/events and permissions are approved.
- Health/readiness, structured logs, metrics, traces and alerts exist.
- Timeouts, retries, DLQ/reconciliation and graceful shutdown pass.
- Horizontal safety, resource limits and cost controls pass.
- Container/SBOM/signature/security scans pass.

## 8. Release-candidate Done

- Immutable artifacts are built once and identified by digest.
- Full applicable CI and staging E2E matrix passes.
- Migrations, flags, rollout, support and rollback are approved.
- Security/privacy review is complete.
- Monitoring dashboards and alerts are operational.
- Known limitations and required operator actions are documented.

## 9. Phase Done

A vertical phase is complete only with approved scope, schema, workflows, APIs, permissions, interfaces, offline behavior, hardware, finance rules, reports, integrations, migrations, seeds, QA, security, monitoring, recovery, pilot, go-live checklist and updated Rebuild/Business Bibles.

Additionally:

- [ ] No regression destabilizes earlier verticals.
- [ ] One qualified engineer passes the Rebuild Test.
- [ ] One approved pilot passes operational and commercial exit criteria.
- [ ] Support, SLA, training and recovery are ready.
- [ ] Evidence status is at least `PILOT-PROVEN` for phase-completion claims.

## 10. Implementation status evidence

| Status                              | Minimum evidence                                           |
| ----------------------------------- | ---------------------------------------------------------- |
| PROPOSED / OWNER-LOCKED / SPECIFIED | Approved document/decision                                 |
| CONTRACT-APPROVED                   | Reviewed machine-readable contract and tests planned       |
| SCAFFOLDED                          | Repository paths/build stubs; no capability claim          |
| IMPLEMENTED-IN-DEV                  | Code + migrations + automated tests in development         |
| INTEGRATION-VERIFIED                | Cross-product/environment evidence                         |
| PILOT-READY                         | Runbooks, monitoring, support, recovery and go-live gate   |
| PILOT-PROVEN                        | Approved real pilot evidence                               |
| PRODUCTION                          | Production deployment, monitoring and operational evidence |

No status above SPECIFIED is valid without linked evidence.

## 11. Not Done

A change is not Done when tests are skipped without approval, documentation contradicts code, only the UI exists, production values are guessed, stale/demo data is presented as truth, a connector bypasses APIs, client authorization substitutes for backend enforcement, or an AI agent reports success without verifiable artifacts.
