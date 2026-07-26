# KitLuy Rollback and Emergency Change Runbook

| Field | Value |
|---|---|
| **Filename** | `kitluy-rollback-and-emergency-change-runbook-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status** | Canonical operating target; not implementation evidence |
| **Timezone** | `Asia/Phnom_Penh` |

> **Purpose:** Define safe rollback, forward-fix, safety-switch and break-glass procedures across applications, database, infrastructure, DNS and Store edge.

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



## 1. Purpose

Restore safe service quickly while preserving authoritative data, audit and the ability to understand what occurred. Rollback is not always a reverse SQL change; it may be application rollback, configuration rollback, feature disablement, cohort pause, edge A/B reversion or corrective forward-fix.

## 2. Change classes

| Class | Example | Approval |
|---|---|---|
| Standard rollback | Revert compatible application release | Release operator; independent approval if broad production |
| High-risk rollback | Database-connected release, wide fleet, DNS, certificate | Four-eyes |
| Emergency change | Active incident containment/recovery | Emergency requester + approver per severity policy |
| Forward-fix | Schema/data prevents safe rollback | Database/service owner + approval |
| Safety switch | Disable connector/payment/feature path | Permission, reason, scope, audit; four-eyes if platform-wide |

## 3. Rollback decision test

Before action, answer:

- What is the exact bad change and affected cohort?
- Is prior artifact/configuration still compatible with current schema/data/protocol?
- Will rollback duplicate or lose accepted work?
- Can a feature flag/safety switch contain impact faster?
- Is a forward-fix safer than reversion?
- What data, queues, devices or certificates require reconciliation?
- What is the last-known-good evidence?

## 4. General rollback workflow

```text
detect regression
-> pause rollout/change
-> declare incident/change record
-> assess compatibility and data risk
-> approve action
-> execute scoped rollback/forward-fix
-> validate health and business integrity
-> monitor
-> reconcile temporary/manual changes
-> close and review
```

## 5. Cloud application rollback

1. Pause rollout and record affected digest/cohort.
2. Confirm last-known-good digest and schema/API compatibility.
3. Drain/replace candidate instances safely.
4. Re-deploy prior immutable digest.
5. Validate readiness, latency, errors, auth, critical writes and worker leases.
6. Verify queues/events accepted during incident are not lost or duplicated.
7. Keep candidate revoked/paused until review.

## 6. Worker rollback

- stop new leases safely;
- allow in-flight work to finish or expire according to lease policy;
- deploy compatible prior worker;
- verify idempotent replay;
- inspect dead letters and partial side effects;
- never delete durable job truth to make dashboards green.

## 7. Configuration rollback

- configurations are versioned and signed;
- partial package never becomes active;
- activate last-known-good version atomically;
- Hub continues last valid configuration during WAN failure;
- verify active/staged/rejected versions and dependent applications.

## 8. Store Hub/terminal A/B rollback

1. Hub detects failed health or operator issues rollback.
2. Verify rollback target signature and compatibility.
3. Switch to inactive last-known-good slot.
4. Restart and run local health checks.
5. Validate local PostgreSQL, Edge API, T1–T4 sessions, printers/scanner/scale, sync and config.
6. Report rollback and block bad artifact.

## 9. Database rollback/forward-fix

- Do not assume down-migration is safe.
- Prefer expanded-schema application rollback when compatible.
- Use corrective forward migration for partially applied/non-reversible changes.
- Use PITR/restore only through the DR runbook and critical approval.
- Re-run RLS, constraints, reconciliation and application compatibility tests.

## 10. DNS/TLS rollback

- restore previous DNS record/reference;
- account for TTL/cache propagation;
- restore certificate binding or known-good endpoint;
- verify resolution, chain, hostname, redirects and API/webhook behavior;
- restore temporary TTL after stabilization.

## 11. Infrastructure rollback

- use prior IaC commit/plan only after verifying provider state and destructive impact;
- do not blindly reverse resources holding state;
- preserve logs/state backups;
- import/reconcile emergency console changes afterward;
- validate monitoring, networking, secrets and cost bounds.

## 12. Emergency change minimum record

```text
incident/change_id
requester
approver
reason
start/expiry
exact scope/environment/cohort
commands/plan/artifact/config references
risk and data-integrity assessment
rollback or forward-fix
validation steps
operator timeline
post-change review owner
```

## 13. Break-glass controls

- individual identity only;
- MFA and re-authentication;
- exact scope and automatic expiry;
- immediate Security/Audit alert;
- commands/actions logged;
- no persistent shared account;
- access removed after incident;
- retrospective review mandatory.

## 14. Validation matrix

| Area | Required validation |
|---|---|
| API/web | Health, critical journeys, latency/errors |
| Database | Schema history, RLS, locks, counts/reconciliation |
| Jobs | Queue age, leases, retries, dead letters, idempotency |
| Store edge | Hub/T1–T4, peripherals, offline, sync backlog |
| Payments/finance | No duplicate/lost effects; reconciliation |
| Files/notifications | Pending work retained; no false success/duplicates |
| Security | Credential/certificate/release integrity |
| Monitoring | Candidate issue cleared; no blind spot |

## 15. After-action reconciliation

- import or revert manual provider changes;
- remove temporary scaling/allowlists/access;
- update release/channel status;
- rotate emergency credentials if used;
- attach evidence to incident/change;
- create defects and documentation changes;
- update last-known-good reference only after approval.

## 16. Required values

- `[REQUIRED: emergency approver matrix]`
- `[REQUIRED: rollback observation windows]`
- `[REQUIRED: last-known-good retention policy]`
- `[REQUIRED: break-glass system and expiry]`
- `[REQUIRED: safety-switch ownership]`
- `[REQUIRED: emergency change retrospective deadline]`

## 17. Drill evidence

- [ ] Cloud application rollback passes.
- [ ] Worker rollback preserves idempotent work.
- [ ] Hub A/B rollback passes on certified hardware.
- [ ] Configuration rollback is atomic.
- [ ] Database failure uses approved forward-fix/restore decision.
- [ ] DNS rollback passes with TTL restoration.
- [ ] Break-glass use alerts and expires.
- [ ] Emergency manual changes are reconciled into IaC.
