# KitLuy Incident Response Runbook

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-incident-response-runbook-v1.0.0.md`                                |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Provide a consistent severity, command, containment, communication, recovery and post-incident process across cloud and Store edge incidents.

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

## 1. Incident principles

- Protect people, Store continuity, payment/data integrity and security first.
- Use one incident commander and one authoritative timeline.
- Preserve evidence without delaying containment.
- High-impact actions remain authorized, scoped and audited.
- Health, freshness and customer/Store impact are communicated truthfully.
- Incident response does not permit silent data edits or unaudited production access.

## 2. Severity model

| Severity | Definition                                                                                              | Examples                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `SEV-1`  | Broad outage, confirmed security compromise, payment/data-integrity risk, many Stores unable to operate | Cross-tenant exposure, widespread payment duplication, production DB unavailable with material cloud impact |
| `SEV-2`  | Major degradation or large Store cohort impact                                                          | Sync outage, release regression, auth failure, critical queue backlog                                       |
| `SEV-3`  | Limited service/Store impact with workaround                                                            | One provider degraded, small fleet cohort, non-critical feature unavailable                                 |
| `SEV-4`  | Warning, capacity trend or low-impact defect                                                            | Certificate approaching expiry, cost anomaly, isolated transient errors                                     |

Exact acknowledgement, update and escalation times are `[REQUIRED: approved incident response times]`.

## 3. Incident roles

| Role                  | Responsibility                                                    |
| --------------------- | ----------------------------------------------------------------- |
| Incident commander    | Owns severity, priorities, decisions and closure                  |
| Technical lead        | Coordinates diagnosis and recovery work                           |
| Operations liaison    | Tracks Store/Partner operational impact and workarounds           |
| Security lead         | Leads containment/evidence for security incidents                 |
| Communications lead   | Publishes internal/external updates                               |
| Scribe                | Maintains timestamped timeline, actions and evidence              |
| Executive liaison     | Receives/authorizes material business decisions                   |
| Subject-matter owners | Database, Fleet, Release, File, Payments, Notifications, AI, etc. |

One person may fill multiple roles for lower severity, but incident command remains explicit.

## 4. Lifecycle

```text
detect
-> acknowledge
-> classify
-> assign commander and channel
-> contain
-> diagnose
-> communicate
-> recover
-> verify
-> monitor
-> close
-> post-incident review
-> remediation tracking
```

## 5. Declaration checklist

- [ ] Incident ID created.
- [ ] Severity and affected environments selected.
- [ ] Incident commander assigned.
- [ ] Affected services, Stores and data classes recorded.
- [ ] Security/payment/data-integrity risk assessed.
- [ ] Change freeze or deployment pause considered.
- [ ] Communication cadence started.
- [ ] Runbook and dashboards linked.

## 6. Containment priorities

1. Stop unauthorized access, unsafe writes or harmful rollout.
2. Preserve local Store operation where possible.
3. Prevent duplicate payment, inventory, custody or notification effects.
4. Revoke compromised credentials/certificates/artifacts.
5. Isolate affected service, cohort, device or connector.
6. Preserve logs, audit and evidence.

## 7. Communication template fields

```text
incident_id
severity
start_time
current_status
customer/store impact
affected environments/services
workaround
actions underway
next update time
data/security statement (confirmed facts only)
```

Do not claim live/current/recovered when data is delayed, partial, last-known or unverified.

## 8. Standard scenario playbooks

### 8.1 Cloud API outage

- verify edge, App Platform, dependencies and recent changes;
- protect auth/transaction/Store sync capacity;
- pause rollout if correlated;
- restart/scale/rollback through approved controls;
- confirm Store Hubs continue local operation;
- validate API and sync reconciliation before closure.

### 8.2 Database incident

- stop conflicting deploys/migrations;
- assess connections, locks, storage, backups and data integrity;
- reduce non-critical load;
- invoke database deployment or DR runbook;
- run RLS and reconciliation checks after recovery.

### 8.3 Store fleet sync incident

- identify affected cohort and oldest backlog;
- verify Hub identity/certificates and cloud ingest;
- protect transaction/sync workers from lower-priority workloads;
- avoid destructive queue clearing;
- recover oldest-first with idempotency;
- reconcile duplicates/dead letters and expose freshness.

### 8.4 Release regression

- pause rollout;
- compare candidate vs baseline health;
- rollback compatible cloud/edge targets or forward-fix;
- ensure Stable cohort remains protected when Pilot fails;
- record affected versions/devices.

### 8.5 Secret/certificate compromise

- revoke/rotate immediately;
- isolate consumers/devices;
- inspect use and scope;
- redeploy replacement references;
- verify old credential rejection;
- assess data/security notification obligations.

### 8.6 Hub failure

- keep terminals from trusting an unknown replacement;
- invoke replacement-first Hub runbook;
- revoke/quarantine failed identity;
- restore configuration/state and validate T1–T4/peripherals;
- reconcile pending payments/custody/sync.

### 8.7 Payment integrity risk

- stop unsafe payment path, not unrelated Store operations;
- preserve provider events and KitLuy ledger records;
- prevent retry duplication;
- require finance/payment owner for reconciliation;
- use compensating records, never silent destructive edits.

## 9. Privileged action during incident

Emergency or break-glass access requires:

- exact scope;
- reason and incident ID;
- named actor;
- approver when required;
- start/expiry;
- complete audit;
- immediate alert;
- retrospective review.

Shared emergency accounts are prohibited.

## 10. Recovery verification

- service health and critical journeys pass;
- data/RLS/security checks pass;
- queues and backlogs are progressing;
- Store Hub freshness is accurate;
- payments, finance, inventory and custody reconcile;
- notifications/webhooks do not duplicate effects;
- monitoring and alerts are normal;
- rollback/temporary controls are documented;
- affected stakeholders receive recovery update.

## 11. Closure criteria

- impact is ended or accepted through an approved known-risk decision;
- no active data-integrity/security uncertainty remains unowned;
- monitoring period completes;
- temporary access and changes are revoked/reconciled;
- evidence and timeline are complete;
- post-incident review owner/date is assigned.

## 12. Post-incident review

Within `[REQUIRED: PIR deadline]`, record:

- factual timeline;
- impact and detection gap;
- root and contributing causes;
- what worked/failed;
- security/data assessment;
- remediation with owners and due dates;
- runbook/test/monitoring/document changes;
- recurrence-prevention evidence.

Blameless analysis does not remove accountability for control failures.

## 13. Required values

- `[REQUIRED: on-call roster and escalation paths]`
- `[REQUIRED: response/update times by severity]`
- `[REQUIRED: incident communication channels/status page]`
- `[REQUIRED: executive/security/legal notification matrix]`
- `[REQUIRED: evidence retention and PIR deadline]`
- `[REQUIRED: Store/Partner communication owners]`

## 14. Drill checklist

- [ ] SEV-1 tabletop completes with commander and timeline.
- [ ] Admin Portal outage leaves independent monitoring available.
- [ ] Release rollback drill passes.
- [ ] Database restore decision drill passes.
- [ ] Secret/certificate compromise drill passes.
- [ ] Hub replacement incident drill passes.
- [ ] Temporary access expires and audits correctly.
- [ ] PIR actions are tracked to evidence-backed closure.
