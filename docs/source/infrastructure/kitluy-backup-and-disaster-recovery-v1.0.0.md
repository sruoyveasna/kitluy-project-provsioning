# KitLuy Backup and Disaster Recovery

| Field | Value |
|---|---|
| **Filename** | `kitluy-backup-and-disaster-recovery-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status** | Canonical operating target; not implementation evidence |
| **Timezone** | `Asia/Phnom_Penh` |

> **Purpose:** Define data protection, RPO/RTO governance, restore drills, Hub replacement recovery and disaster invocation.

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



## 1. Recovery principles

- Backups are useful only when restoration is tested.
- Recovery objectives are defined per data/service class and measured.
- Store operation continuity through Hub is distinct from cloud recovery.
- Multi-region or active-active claims are prohibited until end-to-end tests cover authoritative data, files, queues, identity, certificates and routing.
- Production Hub recovery is replacement-first; Store staff do not replace NVMe or reimage the Hub.

## 2. Data protection matrix

| Data/service class | Primary | Protection | Restore target | Owner |
|---|---|---|---|---|
| Supabase PostgreSQL | Authoritative cloud DB | Provider backup/PITR + approved logical backup policy | Isolated Supabase/PostgreSQL restore environment | Database Ops |
| Auth/RLS/config metadata | Supabase | Included DB protection + configuration code | Isolated project/environment | Platform/Security |
| Spaces objects | DigitalOcean Spaces | Versioning/lifecycle/replication or backup policy by class | Isolated bucket/prefix | File/Infra |
| Infrastructure code/state | Git + protected state backend | Repository redundancy + encrypted state backup | Clean IaC environment | Infra |
| Container/release artifacts | Registry/Spaces | Immutable retention + signatures | Recreated runtime | Release Ops |
| Secrets/PKI | Approved secret/key systems | Restricted escrow/recovery, dual control | Replacement secret/key systems | Security |
| Audit/security records | Supabase/protected archive | Append-only retention/export | Isolated analysis/recovery store | Audit/Security |
| Store Hub PostgreSQL | Local Hub | Encrypted checkpoint + synchronized event recovery | Pre-enrolled replacement Hub | Fleet Ops |
| Store Hub files | Local repository + upload acknowledgement | Local queue/checkpoint + cloud object protection | Replacement Hub/local cache | Fleet/File |

## 3. RPO/RTO registry

Exact targets are owner-approved values.

| Class | RPO | RTO | Maximum test age | Authority |
|---|---|---|---|---|
| Payment/finance/audit cloud records | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Owner + Finance + Security |
| Core operational cloud data | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Platform/Data |
| Store Hub local operations | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Fleet/Operations |
| Files/evidence | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | File/Data owner |
| Public web/API compute | near-zero data RPO | `[REQUIRED]` | `[REQUIRED]` | Platform |
| Secrets/PKI | `[REQUIRED]` | `[REQUIRED]` | `[REQUIRED]` | Security |

## 4. Required recovery scenarios

1. Application deployment failure.
2. Failed database migration.
3. Accidental row/table/data corruption.
4. Deleted/corrupted object.
5. Supabase database/project incident.
6. DigitalOcean App Platform/worker incident.
7. Registry/release artifact loss.
8. Credential or certificate compromise.
9. Admin Portal outage.
10. Store WAN outage.
11. Hub NVMe failure.
12. Complete Hub failure.
13. Region-level unavailability tabletop and later technical drill.

## 5. Backup controls

- encryption in transit and at rest;
- environment/class separation;
- restricted backup and restore identities;
- integrity checks and checksums;
- retention and legal/privacy policy;
- immutable or protected copies where approved;
- monitoring for missed backups and capacity;
- documented deletion lifecycle;
- no unapproved production-data copy to lower environments.

## 6. Database restore drill

1. Open approved restore rehearsal.
2. Select restore point and record expected data-loss boundary.
3. Create isolated restore target.
4. Restore without changing active production.
5. Validate migration history and extensions.
6. Validate table/row counts, constraints, checksums and critical queries.
7. Validate Auth/RLS/service identities and negative isolation tests.
8. Validate application compatibility and read/write smoke tests.
9. Record duration, achieved RPO/RTO and gaps.
10. Destroy or retain isolated target according to approved data policy.
11. Track remediation to closure.

## 7. Object restore drill

- identify object and metadata relationship;
- restore correct version to isolated or approved target;
- verify checksum/classification/permissions;
- verify signed access and audit;
- ensure restore does not create unauthorized public exposure;
- record achieved recovery time.

## 8. Store Hub replacement-first recovery

```text
Hub failure
-> suspend/revoke failed Hub credential
-> select pre-enrolled replacement Hub
-> assign to same Location
-> verify hardware and operational certificate
-> restore signed configuration and synchronized state
-> restore approved encrypted checkpoint where available
-> reconnect T1–T4 and peripherals
-> review pending payments/custody/print/file queues
-> reconcile and resume Store
-> quarantine and return failed unit to HET
```

Store operation resumes only after identity, configuration, local data, terminals, peripherals, sync and freshness validation pass.

## 9. Credential/PKI recovery

- revoke compromised credential/certificate;
- isolate affected consumers/devices;
- issue replacement through approved ceremony;
- update bindings and deploy;
- verify old credential rejection;
- inspect audit/security logs;
- assess business-data exposure;
- complete post-incident review.

Root/intermediate CA recovery uses dual control and an approved protected procedure.

## 10. Region-level recovery gate

Phase 1 may maintain a documented region-outage plan without claiming active multi-region failover. A production secondary-region design requires:

- authoritative database recovery/failover;
- object/file continuity;
- queue/job and webhook continuity;
- identity, secret and certificate recovery;
- DNS/global-routing procedure;
- consistency/data-loss policy;
- operator/on-call readiness;
- full technical rehearsal and cost approval.

## 11. DR invocation

| Step | Action |
|---|---|
| Declare | Incident commander classifies disaster and obtains required authority |
| Contain | Stop unsafe writes/deployments and secure credentials |
| Assess | Determine affected data, services, Stores and restore point |
| Decide | Select repair, failover, restore or edge-continuity path |
| Recover | Execute runbook with timeline and dual control where required |
| Validate | Data, RLS, applications, Hub sync, files and business checks |
| Communicate | Operators, Partners/Stores and stakeholders according to policy |
| Exit | Return to normal control, preserve evidence, post-incident review |

## 12. Required values

- `[REQUIRED: RPO/RTO by class]`
- `[REQUIRED: backup/PITR plans and retention]`
- `[REQUIRED: logical backup cadence and encryption]`
- `[REQUIRED: Spaces protection/lifecycle by class]`
- `[REQUIRED: backup/restore identities and approvers]`
- `[REQUIRED: spare Hub inventory and dispatch objective]`
- `[REQUIRED: restore drill cadence]`
- `[REQUIRED: secondary-region re-entry gate]`

## 13. Evidence checklist

- [ ] Backup inventory maps every authoritative data class.
- [ ] Missed-backup and PITR alerts are tested.
- [ ] Isolated database restore passes row/count/checksum/RLS tests.
- [ ] Object restore preserves metadata and permissions.
- [ ] Replacement Hub recovery is rehearsed.
- [ ] Restore does not duplicate payments, receipts, notifications or custody events.
- [ ] Achieved RPO/RTO is measured and recorded.
- [ ] Region tabletop records gaps without false resilience claims.
