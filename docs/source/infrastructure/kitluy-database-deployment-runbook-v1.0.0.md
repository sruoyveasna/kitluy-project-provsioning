# KitLuy Database Deployment Runbook

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-database-deployment-runbook-v1.0.0.md`                              |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Provide a controlled, testable and auditable procedure for applying and verifying Supabase PostgreSQL migrations.

## Source authority and evidence discipline

This document is derived from the current KitLuy Project Instructions and the following approved target sources:

- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`
- `kitluy-storehub-phase1-spec-v1.0.0.md`
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`
- current Phase 1 product specifications and owner-locked Digital Store, Store Hub, T1–T4, provisioning, release and security decisions

Authority order:

1. Current owner decisions and active Project Instructions.
2. Applied migrations, verified code/tests, infrastructure state, deployment records and production evidence.
3. This operating document after approval.
4. Current KitLuy infrastructure, Store Hub, security, API, database and product specifications.
5. Approved handoffs and registries.
6. Competitor analyses or clone documents as design references only.

Nothing in this document is evidence that infrastructure is implemented. `IMPLEMENTED`, `DEPLOYED`, `RESTORED`, `PILOT-APPROVED` or `GO-LIVE-APPROVED` may be used only when the corresponding evidence exists. Unknown provider, account, domain, owner, threshold, retention, RPO, RTO or credential values remain `[REQUIRED: ...]` and must not be guessed.

## Mandatory guardrails

- Supabase owns authoritative cloud PostgreSQL, Auth, RLS, approved Realtime, metadata and audit/event records.
- DigitalOcean owns application and worker compute, Container Registry, Spaces, release storage, AI/MCP/RAG compute and the initial App Platform deployment.
- Store Hub owns local Store operations after provisioning; T1–T4 use it over LAN and do not depend on live cloud access for normal operation.
- Cloud application compute is stateless and replaceable. Containers, pods, caches and queues do not own authoritative business truth.
- Finalized finance, payment, inventory, custody, security and audit records are append-only or corrected through compensating records.
- Production changes require authenticated, authorized and audited human action. Defined high-risk changes require four-eyes approval.
- Production migrations are never run automatically during application startup.
- Production secrets are never committed, embedded in images, copied into client bundles or recorded in this document.
- Monitoring and alert delivery remain available when the Admin Portal is unavailable.
- No multi-region, recovery, readiness or availability claim is made without tested evidence.

## 1. Scope

This runbook applies to Supabase PostgreSQL schema, functions, RLS policies, indexes, reference data and controlled data migrations. It does not authorize an AI agent, application startup process or general CI runner to apply production migrations.

## 2. Roles

| Role                          | Responsibility                                                               |
| ----------------------------- | ---------------------------------------------------------------------------- |
| Migration author              | Writes migration, tests and validation; cannot self-approve production apply |
| Database reviewer             | Reviews SQL, locks, data impact, RLS, rollback/forward-fix                   |
| Security/RLS reviewer         | Reviews tenant isolation and privileged functions                            |
| Release coordinator           | Confirms application compatibility and change window                         |
| Production migration operator | Applies approved migration using scoped identity                             |
| Independent approver          | Approves high-risk/production migration                                      |
| Observer/auditor              | Records evidence and timeline                                                |

## 3. Migration package requirements

Every migration includes:

- immutable filename/order and unique migration ID;
- purpose and affected schemas/tables/functions/policies;
- classification: additive, data backfill, index, policy, destructive/contract;
- expected lock and runtime profile;
- compatibility sequence;
- idempotency/retry characteristics;
- validation SQL;
- RLS/permission tests;
- backup/recovery dependency;
- rollback or forward-fix plan;
- application release dependencies;
- owner and approvers.

## 4. Preferred expand/contract sequence

```text
1. expand schema additively
2. deploy code that reads/writes both shapes where required
3. backfill through bounded, observable jobs
4. verify completeness and reconciliation
5. switch reads/writes through feature flag or compatible release
6. observe
7. remove old path in a later approved migration
```

Destructive same-release changes are rejected unless an explicitly approved emergency or data-protection requirement exists.

## 5. Pre-deployment checks

- [ ] Repository migration history matches applied environment history.
- [ ] Migration was applied from clean baseline to target in disposable test DB.
- [ ] Staging uses production-like data volume/distribution or an approved simulation.
- [ ] Validation, RLS and negative isolation tests pass.
- [ ] Query plans, index build and lock impact are reviewed.
- [ ] Long-running work is split into bounded jobs where possible.
- [ ] Application versions are compatible before and after migration.
- [ ] Backup/PITR status is healthy.
- [ ] Restore/forward-fix plan is current.
- [ ] Monitoring and on-call coverage are active.
- [ ] Change, operator and approver are recorded.

## 6. Change risk classes

| Class            | Examples                                                                 | Minimum control                                               |
| ---------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `DB-R1` Low      | Add nullable column, safe reference data                                 | Review + staging evidence                                     |
| `DB-R2` Moderate | Concurrent index, function/RPC change, bounded backfill                  | Database + app review; production approval                    |
| `DB-R3` High     | RLS policy, large backfill, constraint validation, payment/finance table | Four-eyes, rehearsal, rollback/forward-fix, active monitoring |
| `DB-R4` Critical | Destructive change, identity boundary, restore over active data          | Owner/security/database approval and dedicated change window  |

## 7. Deployment procedure

1. Declare change window and freeze conflicting deploys.
2. Confirm exact target environment/project and migration head.
3. Record pre-change metrics: connections, locks, latency, storage, backup/PITR, queue age.
4. Confirm approved migration digest and operator identity.
5. Enable enhanced monitoring and communication channel.
6. Apply migrations in repository order using the scoped migration identity.
7. Record each migration start/end/result.
8. Stop immediately on unexpected error, lock pressure, data anomaly or environment mismatch.
9. Run validation SQL and schema-history reconciliation.
10. Run RLS/tenant/device isolation negative tests.
11. Run application smoke and write/read compatibility tests.
12. Observe for the approved period.
13. Release deployment lock and close only after evidence is archived.

## 8. Required validation

- expected tables, columns, constraints, functions and policies exist;
- migration history contains exact IDs/checksums;
- record counts and reconciliation totals are within expected bounds;
- RLS denies cross-Tenant, cross-Digital-Store, cross-Location and unauthorized device/user access;
- service identities have only intended privileges;
- critical queries and indexes perform within approved limits;
- no unexpected locks, deadlocks or long transactions remain;
- application and workers report compatible schema version;
- audit/event behavior remains append-only and correct.

## 9. Backfill rules

- Backfills are resumable, idempotent and observable.
- Large backfills use bounded batches and rate limits.
- Progress, failures and reconciliation are stored durably.
- Financial/payment/inventory/custody corrections use domain-approved compensating behavior, not silent overwrites.
- Backfill completion is proven before contract/removal phase.

## 10. Failure handling

| Failure point                                 | Action                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Before any migration committed                | Stop and investigate; no rollback needed                                      |
| Transactional migration failure               | Confirm transaction rollback; validate state                                  |
| Partially applied non-transactional operation | Pause; use documented repair/forward-fix                                      |
| Severe lock/latency impact                    | Cancel safely if possible; restore service; reassess method                   |
| RLS regression                                | Block application rollout, restore/forward-fix policy immediately             |
| Data corruption/loss risk                     | Declare incident; stop writes if required; PITR/restore decision              |
| App incompatibility                           | Roll back app if schema permits, otherwise forward-fix per compatibility plan |

## 11. Rollback and restore rule

SQL down-migrations are not assumed safe. The approved response may be:

- transaction rollback;
- application rollback while expanded schema remains;
- corrective forward migration;
- feature-flag disablement;
- isolated PITR/restore followed by approved recovery action.

Restore over active production data is a four-eyes critical action.

## 12. Post-deployment evidence

- change/migration IDs and digests;
- operator, reviewers and approver;
- pre/post schema history;
- apply logs with secrets redacted;
- validation query results;
- RLS isolation test results;
- performance/lock observations;
- record-count/reconciliation results;
- backup/PITR status;
- application smoke results;
- incident/rollback reference if any.

## 13. Emergency migration

Emergency migrations require an incident, a minimal scoped change, named operator and approver, validation/rollback or forward-fix plan, continuous monitoring, and retrospective review. Emergency status does not authorize destructive guessing or bypass RLS testing.

## 14. Required values

- `[REQUIRED: production migration identity and storage]`
- `[REQUIRED: migration tool/version]`
- `[REQUIRED: change windows and freeze policy]`
- `[REQUIRED: lock/runtime thresholds]`
- `[REQUIRED: backup/PITR plan and restore authority]`
- `[REQUIRED: database approvers and on-call]`
- `[REQUIRED: evidence retention location]`

## 15. Production exit checklist

- [ ] Authorized operator applied exact approved migration digest.
- [ ] Applied history matches repository history.
- [ ] RLS and isolation tests pass.
- [ ] Backup/PITR is healthy and restore plan is available.
- [ ] App and worker compatibility is confirmed.
- [ ] No unresolved lock, query or reconciliation anomaly exists.
- [ ] Evidence package is archived.
- [ ] Implementation status register is updated with evidence, not assumption.
