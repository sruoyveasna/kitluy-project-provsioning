# KitLuy Observability and Alert Registry

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-observability-and-alert-registry-v1.0.0.md`                         |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Define measurable signals, SLO records, alerts, severity, ownership, routing and truth/freshness rules.

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

## 1. Independent observability rule

Monitoring, alert delivery and provider access must remain usable when `kitluy-admin-pwa-portal` is unavailable. The Admin Portal is a control and visualization client, not the sole monitoring engine.

## 2. Telemetry standards

Every signal includes, where applicable:

- environment, service/resource and region;
- Tenant/Digital Store/Location/device scope without unsafe PII;
- observed timestamp and collection timestamp;
- release/configuration/schema version;
- correlation/request/job/event ID;
- current, delayed, partial, unavailable or last-known status;
- owner team and runbook reference.

Logs are structured, redact secrets and avoid full sensitive payloads.

## 3. SLO registry schema

| Field           | Requirement                                                |
| --------------- | ---------------------------------------------------------- |
| SLO ID          | Stable identifier                                          |
| Service/journey | Exact measured boundary                                    |
| Indicator       | Availability, latency, error, freshness or recovery metric |
| Target          | `[REQUIRED: approved numeric target]`                      |
| Window          | Measurement period                                         |
| Data source     | Authoritative telemetry source                             |
| Exclusions      | Approved maintenance/exclusion policy                      |
| Error budget    | Derived and reviewed                                       |
| Owner           | Accountable team                                           |
| Runbook         | Linked remediation                                         |

## 4. Required signal domains

| Domain                 | Signals                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| Traffic                | Request rate, active connections, P50/P95/P99, status/error rate, rate-limit events                        |
| Compute                | Instance count, CPU, memory, restarts, crash loops, saturation, scaling events                             |
| Database               | Connections, query latency, slow queries, locks/deadlocks, storage/WAL, backup/PITR, replica lag           |
| Jobs/queues            | Pending, oldest age, processing rate, retries, dead letters, worker health                                 |
| Store edge             | Hub/terminal heartbeat, sync depth/age, disk, temperature, certificate, peripheral, release/config version |
| Files                  | Upload backlog, failures, checksum, malware/quarantine, storage growth, signed-access errors               |
| Notifications/webhooks | Delivery rate, retries, provider latency, suppression, dead letters                                        |
| Security               | Failed privileged action, cross-scope denial/anomaly, secret/certificate/release integrity events          |
| AI/RAG                 | Request rate, latency, provider errors, cost/tokens, indexing backlog, policy denials                      |
| Business continuity    | Backup success, restore test age, rollback readiness, spare Hub readiness                                  |

## 5. Alert registry

Thresholds are placeholders until approved.

| Alert ID         | Condition                                           | Default severity | Route               | Runbook                |
| ---------------- | --------------------------------------------------- | ---------------- | ------------------- | ---------------------- |
| `ALT-API-001`    | Critical API availability below SLO                 | SEV-1/2          | Platform Ops        | API outage             |
| `ALT-API-002`    | P95/P99 latency above threshold                     | SEV-2/3          | Service owner       | Latency saturation     |
| `ALT-AUTH-001`   | Auth/token failure spike                            | SEV-2            | Platform + Security | Auth degradation       |
| `ALT-DB-001`     | Connection utilization above threshold              | SEV-2/3          | Database Ops        | Connection pressure    |
| `ALT-DB-002`     | Lock wait/deadlock spike                            | SEV-2            | Database Ops        | Lock incident          |
| `ALT-DB-003`     | Backup/PITR unhealthy                               | SEV-2            | Database + Security | Backup failure         |
| `ALT-DB-004`     | Replica/read-model lag above freshness policy       | SEV-3            | Data/Platform       | Stale read model       |
| `ALT-JOB-001`    | Critical queue oldest age above threshold           | SEV-2            | Platform Ops        | Queue backlog          |
| `ALT-JOB-002`    | Dead-letter growth                                  | SEV-2/3          | Owning service      | DLQ handling           |
| `ALT-SYNC-001`   | Store sync backlog/age exceeds threshold            | SEV-2            | Fleet + Platform    | Store sync degradation |
| `ALT-HUB-001`    | Hub heartbeat missing                               | SEV-2/3          | Fleet Ops           | Hub offline            |
| `ALT-HUB-002`    | Hub disk/temperature unsafe                         | SEV-2            | Fleet Ops           | Hardware health        |
| `ALT-CERT-001`   | Certificate expires within threshold                | SEV-2/3          | Security            | Certificate rotation   |
| `ALT-CERT-002`   | Revoked/mismatched device attempt                   | SEV-1/2          | Security + Fleet    | Device trust incident  |
| `ALT-REL-001`    | Pilot/Stable rollout failure rate exceeds threshold | SEV-2            | Release Ops         | Rollout rollback       |
| `ALT-REL-002`    | Tampered/revoked artifact attempt                   | SEV-1            | Security + Release  | Supply-chain incident  |
| `ALT-FILE-001`   | Upload/quarantine failure backlog                   | SEV-3            | File Service        | File pipeline          |
| `ALT-NOTIFY-001` | Provider/delivery failure spike                     | SEV-3            | Notification        | Provider degradation   |
| `ALT-SEC-001`    | Break-glass access used                             | SEV-2            | Security + Audit    | Break-glass review     |
| `ALT-SEC-002`    | Secret scan finding in main/release                 | SEV-1/2          | Security + Release  | Secret exposure        |
| `ALT-COST-001`   | Spend/anomaly exceeds budget guardrail              | SEV-3            | Infra + Finance     | Cost anomaly           |
| `ALT-OBS-001`    | Telemetry pipeline/probe unavailable                | SEV-2            | Observability       | Monitoring blind spot  |

## 6. Store Hub metrics

```text
hub_uptime_seconds
hub_cpu_temperature_celsius
hub_disk_free_bytes
hub_postgres_connections
hub_api_request_latency_ms
hub_sync_outbox_depth
hub_sync_oldest_pending_seconds
hub_sync_dead_letter_count
hub_file_upload_pending_count
hub_print_queue_depth
hub_terminal_connected_count
hub_peripheral_failure_count
hub_certificate_days_remaining
hub_release_version
hub_config_version
hub_last_checkpoint_age_seconds
```

## 7. Alert quality policy

Every alert must state:

- what failed and where;
- current value and threshold;
- severity and business impact;
- first observed time;
- dashboard and logs;
- runbook;
- owner/on-call route;
- correlation or incident ID.

Alerts are deduplicated, grouped and inhibited during known parent failures. Non-actionable alerts are corrected or removed.

## 8. Severity model

| Severity | Impact                                                         | Operating mode                                                 |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------- |
| `SEV-1`  | Broad outage, security compromise, payment/data-integrity risk | Immediate incident command and executive/security notification |
| `SEV-2`  | Major degradation, large Store cohort impact                   | Urgent on-call response and active mitigation                  |
| `SEV-3`  | Limited impact/workaround available                            | On-call or business-hours response per policy                  |
| `SEV-4`  | Warning, trend or non-urgent defect                            | Planned remediation                                            |

Exact response/notification times remain `[REQUIRED]`.

## 9. Dashboards

- Platform command center.
- API/service health.
- Database and RLS/security events.
- Jobs, queues and dead letters.
- Store fleet and synchronization.
- Release rollout and version distribution.
- Files/storage/notifications.
- Backup/restore readiness.
- Capacity and cost.
- Incident timeline and customer/Store impact.

All dashboards expose source and freshness. Stale data is never labeled current.

## 10. Synthetic and failure tests

- public website/API probes;
- authenticated critical journey probes;
- webhook signature test;
- Hub heartbeat/sync simulation;
- backup/PITR status probe;
- certificate-expiry test;
- alert-routing test;
- Admin Portal outage while independent monitoring remains active;
- telemetry pipeline failure alert.

## 11. Data retention and privacy

- Retention differs by metrics, application logs, security logs, audit records and incident evidence.
- Logs avoid secrets, payment credentials and unnecessary PII.
- Support exports are scoped and audited.
- Exact retention is `[REQUIRED: approved log/telemetry retention and privacy policy]`.

## 12. Go-live evidence

- [ ] Critical SLOs and thresholds are approved.
- [ ] Every critical alert routes to a tested on-call path.
- [ ] Alerts include runbooks and ownership.
- [ ] Stale/partial telemetry is labeled.
- [ ] Admin Portal outage does not remove observability.
- [ ] Store Hub metrics and certificate alerts are active.
- [ ] Backup, release and security alerts are tested.
- [ ] Alert storm/deduplication test passes.
