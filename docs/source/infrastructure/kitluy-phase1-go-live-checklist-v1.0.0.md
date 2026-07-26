# KitLuy Phase 1 Go-Live Checklist

| Field        | Value                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| **Filename** | `kitluy-phase1-go-live-checklist-v1.0.0.md`                                                                                   |
| **Version**  | `v1.0.0`                                                                                                                      |
| **Date**     | `2026-07-26`                                                                                                                  |
| **Phase**    | Phase 1 — Laundry                                                                                                             |
| **Owner**    | HET / KitLuy Suite Project Owner                                                                                              |
| **Audience** | Project owner, go-live board, infrastructure, database, security, release, fleet, support, QA and pilot Store representatives |
| **Status**   | Canonical operating target; not implementation evidence                                                                       |
| **Timezone** | `Asia/Phnom_Penh`                                                                                                             |

> **Purpose:** Provide the final evidence-gated production decision covering migrations, RLS isolation, Hub/terminal operation, monitoring, restore, rollback and pilot approval.

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

## 1. Use of this checklist

A box may be checked only when the named evidence exists and is linked in the go-live evidence index. A verbal assurance, design document or passing UI demo is not sufficient. Any exception requires owner, risk, expiry, compensating control and approval.

## 2. Go-live decision record

| Field                  | Value        |
| ---------------------- | ------------ |
| Release/candidate      | `[REQUIRED]` |
| Production environment | `[REQUIRED]` |
| Pilot Store/cohort     | `[REQUIRED]` |
| Planned go-live        | `[REQUIRED]` |
| Change/approval ID     | `[REQUIRED]` |
| Go-live owner          | `[REQUIRED]` |
| Technical commander    | `[REQUIRED]` |
| Rollback target        | `[REQUIRED]` |
| Evidence index         | `[REQUIRED]` |

## 3. Authority and source of truth

- [ ] Current Project Instructions and owner decisions are versioned and linked.
- [ ] Eight-phase roadmap and Phase 1 Laundry boundary are preserved.
- [ ] Digital Store-first and one Store/one primary vertical rules are implemented in contracts.
- [ ] T1 POS/Intake, T2 CDS, T3 Ready Scan-In and T4 Pickup Scan-Out definitions are current.
- [ ] Deferred/rejected patterns are disabled and tested.
- [ ] No capability is labeled `IMPLEMENTED` without repository, migration, test and deployment evidence.

## 4. Environment and provider readiness

- [ ] Environment matrix is approved for local, development, staging, pilot, production and DR.
- [ ] Production Supabase project/plan/region and owner are approved.
- [ ] DigitalOcean project, App Platform applications, workers, registry and Spaces inventory are approved.
- [ ] Production/non-production secrets and identities are isolated.
- [ ] Production data is absent from lower environments except approved masked/anonymized fixtures.
- [ ] Cost budgets, autoscaling bounds and anomaly alerts are active.
- [ ] DOKS is not presented as active unless separately approved; services remain Kubernetes-ready.

## 5. Infrastructure-as-code

- [ ] Production resources are represented in reviewed IaC or approved exceptions.
- [ ] Production plan is reviewed and applied by authorized identity.
- [ ] State storage, locking, backup and recovery are tested.
- [ ] Public database, unencrypted storage, mutable tags and unrestricted identities fail policy checks.
- [ ] Manual drift is detected and reconciled.
- [ ] Destroy permissions are separately protected.

## 6. Domains, DNS and TLS

- [ ] Production domain and DNS ownership are approved.
- [ ] Critical DNS records are in the registry/IaC with rollback references.
- [ ] TLS chain, hostname, renewal and expiry alerts pass.
- [ ] Safe redirects, CORS and origin protection pass.
- [ ] Hub mTLS issue, connect, rotate and revoke tests pass.
- [ ] No dangling provider DNS target exists.

## 7. Identity, RBAC, approvals and secrets

- [ ] MFA policy is active for production operators.
- [ ] Team, role template, permission, resource scope and environment scope catalogs are approved.
- [ ] API authorization and Supabase RLS enforce permissions; frontend hiding is not the boundary.
- [ ] Cross-Tenant, Digital Store, Location, user and device negative tests pass.
- [ ] Four-eyes policy blocks requester self-approval for defined actions.
- [ ] Temporary/break-glass access expires, alerts and audits.
- [ ] Secrets inventory contains references only and covers every production credential.
- [ ] No browser, mobile, Electron bundle, image, repository or log contains privileged secrets.
- [ ] Signing/CA/recovery keys use approved protected custody.

## 8. Database and data integrity

- [ ] Migration repository history is reconciled with production applied history.
- [ ] Authorized operator applied exact approved migration digests.
- [ ] Validation SQL and constraints pass.
- [ ] RLS isolation and service-identity tests pass.
- [ ] Connection pooling and per-service budgets are validated.
- [ ] Slow query, lock, deadlock and storage monitoring is active.
- [ ] Backfills are complete, resumable and reconciled.
- [ ] Finalized finance/payment/inventory/custody/audit records remain append-only or compensating.
- [ ] Application, worker and Store Hub compatibility ranges are satisfied.

## 9. Services, APIs, events and jobs

- [ ] Management, Commerce Store, Edge Operations and Connector APIs remain separate governed surfaces.
- [ ] APIs are versioned, scoped, idempotent, rate-limited, auditable and retry-aware.
- [ ] Critical services have liveness/readiness, graceful shutdown and resource bounds.
- [ ] Durable job/event truth is relational.
- [ ] Duplicate delivery produces one logical effect.
- [ ] Poison messages move to dead letter after bounded retries.
- [ ] Dead-letter inspection/retry is permissioned and audited.
- [ ] Transactional and Store-sync workloads are isolated from reports/AI/bulk work.
- [ ] Connectors have no direct production database access.

## 10. Files, notifications and integrations

- [ ] Spaces bucket classes, credentials, lifecycle and public/private policies pass.
- [ ] File metadata/permissions/audit remain authoritative in KitLuy/Supabase.
- [ ] Signed access expires and private objects remain private.
- [ ] Malware/quarantine and checksum controls pass where required.
- [ ] Hub file upload queues survive WAN loss and deduplicate on reconnect.
- [ ] Notification/webhook signing, retries, suppression and delivery truth pass.
- [ ] Provider outages do not block core Store operation.

## 11. Store Hub and T1–T4 edge readiness

- [ ] Pilot/production Hub exists in HET Device Registry.
- [ ] Hardware manifest, manufacturing certificate and operational certificate match.
- [ ] Unknown/copy-imaged Pi provisioning is denied and alerted.
- [ ] Approved OS, secure-boot/integrity and Hub release are installed.
- [ ] Hub is assigned to correct Tenant, Digital Store and Location.
- [ ] Configuration projection is signed, complete and atomically active.
- [ ] T1+T2 and T3+T4 assignments are correct and permission-separated.
- [ ] Receipt printer, tag printer, scanner, scale and cash drawer tests pass as applicable.
- [ ] Local PostgreSQL, file repository and print queues are healthy.

## 12. Laundry workflow verification

- [ ] Online intake/Booking passes.
- [ ] Offline intake/Booking passes.
- [ ] Customer/service/garment verification passes.
- [ ] Deposit/payment/KHQR path passes approved provider rules.
- [ ] Receipt and garment-tag printing/reprint controls pass.
- [ ] T2 privacy and payment display pass.
- [ ] T3 Ready Scan-In, QA/count/storage and custody pass.
- [ ] T4 customer verification, balance, scan-out and Booking completion pass.
- [ ] Exceptions, overrides, rewash/damage and reasons are permissioned/audited where in scope.
- [ ] Business date/timezone and KHR/USD formatting pass.

## 13. Offline, synchronization and reconciliation

- [ ] WAN outage does not stop approved local operation.
- [ ] Outbox/inbox survive restart and preserve ordering/idempotency.
- [ ] Reconnect uses bounded oldest-first replay.
- [ ] Duplicate Hub events produce no duplicate cloud side effects.
- [ ] Financial/payment/inventory/custody conflicts do not use generic last-write-wins.
- [ ] Dead-letter and reconciliation states are visible and operable.
- [ ] Cloud views show source, `data_as_of`, sync state and freshness.
- [ ] Large-backlog recovery test passes.

## 14. CI/CD, artifacts and release

- [ ] Cloud and edge artifacts are immutable, signed and have checksum/SBOM/provenance references.
- [ ] Same digest passed development, staging and Pilot.
- [ ] Database migrations are a separate authorized workflow.
- [ ] Compatibility manifest covers schema, APIs, Edge protocol, terminals and configuration.
- [ ] Internal -> Pilot -> Stable promotion history is auditable.
- [ ] Stable promotion has independent approver.
- [ ] Tampered/revoked artifact is rejected.
- [ ] Cloud rollback and Hub A/B rollback rehearsals pass.
- [ ] Emergency change and break-glass drills pass.

## 15. Observability and incident readiness

- [ ] Independent monitoring remains available without Admin Portal.
- [ ] Critical SLOs, thresholds and error budgets are approved.
- [ ] API, database, jobs, Store sync, Hub, files, notifications, release, security and cost dashboards are active.
- [ ] Alerts include owner, severity, threshold, runbook and route.
- [ ] Alert routing and escalation are tested.
- [ ] Stale/partial/last-known telemetry is labeled truthfully.
- [ ] Incident commander, on-call roster, status communication and PIR process are ready.
- [ ] SEV-1/SEV-2 tabletop passes.

## 16. Backup, restore and business continuity

- [ ] Backup inventory covers PostgreSQL, Spaces, IaC/state, artifacts, secrets/PKI, audit and Hub data.
- [ ] Backup/PITR status alerts are active.
- [ ] Isolated database restore passes migration, count, checksum, critical query and RLS tests.
- [ ] Object restore preserves checksum, classification, permissions and metadata relationship.
- [ ] Achieved RPO/RTO is measured against approved targets.
- [ ] Replacement-first Hub recovery is rehearsed with a pre-enrolled spare.
- [ ] Restore/replay causes no duplicate payment, receipt, notification or custody event.
- [ ] Region-outage tabletop is complete and does not make unsupported multi-region claims.

## 17. Pilot and support approval

- [ ] Pilot Store scope, dates, consent, success criteria and exit rights are approved.
- [ ] Pilot installation and all mandatory scenarios pass or have approved exceptions.
- [ ] Pilot monitoring period is complete.
- [ ] Pilot incidents and remediation are reviewed.
- [ ] Store staff and HET operators are trained in Khmer/English as required.
- [ ] Support hours, contacts, consent, escalation and spare Hub process are active.
- [ ] Formal `APPROVE-STABLE` pilot decision is recorded.

## 18. Security and quality evidence

- [ ] Dependency, secret, static and container scans meet approved gates.
- [ ] Security test plan results are archived.
- [ ] Load, failure, chaos/recovery and connection-budget tests are archived.
- [ ] Audit is append-only and privileged-action export verification passes.
- [ ] No unresolved critical/high finding lacks approved risk treatment.
- [ ] Privacy, retention and support-access controls are approved.

## 19. Documentation and Rebuild Test

- [ ] Current source-of-truth index links every active specification/runbook.
- [ ] Superseded documents and known conflicts are registered.
- [ ] Open `[REQUIRED: ...]` values that block production are resolved.
- [ ] Environment, service, domain, secret-reference, alert and backup registries are current.
- [ ] Operator handoff and on-call runbooks are approved.
- [ ] One qualified engineer reconstructs and operates the Phase 1 environment from approved artifacts.
- [ ] Rebuild Test sign-off is recorded.

## 20. Final decision

| Decision         | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GO`             | All mandatory gates pass; residual risks are approved and time-bound                                               |
| `CONDITIONAL GO` | Only explicitly approved non-safety exceptions; owner and expiry recorded                                          |
| `NO-GO`          | Any isolation, payment/data-integrity, Store continuity, restore, rollback, security or monitoring blocker remains |
| `ROLLBACK`       | Revert to last-known-good environment/release/configuration                                                        |

### Sign-off

| Role                       | Name/reference | Decision | Timestamp |
| -------------------------- | -------------- | -------- | --------- |
| Project owner              | `[REQUIRED]`   |          |           |
| Go-live owner              | `[REQUIRED]`   |          |           |
| Infrastructure lead        | `[REQUIRED]`   |          |           |
| Database lead              | `[REQUIRED]`   |          |           |
| Security approver          | `[REQUIRED]`   |          |           |
| Release approver           | `[REQUIRED]`   |          |           |
| Fleet/Store Hub lead       | `[REQUIRED]`   |          |           |
| Pilot Store representative | `[REQUIRED]`   |          |           |
| QA lead                    | `[REQUIRED]`   |          |           |

## 21. Evidence index template

```text
EVID-AUTH-*   authority/owner decisions
EVID-IAC-*    plans/applies/drift
EVID-DNS-*    DNS/TLS/mTLS
EVID-DB-*     migrations/RLS/restore
EVID-SVC-*    APIs/jobs/events
EVID-EDGE-*   Hub/T1-T4/offline/sync
EVID-REL-*    artifacts/promotion/rollback
EVID-OBS-*    dashboards/alerts/incidents
EVID-DR-*     backup/restore/replacement Hub
EVID-PILOT-*  pilot operation and approval
EVID-SEC-*    security scans/tests/access
EVID-RBT-*    Rebuild Test
```
