# KitLuy Phase 1 Pilot Runbook

| Field | Value |
|---|---|
| **Filename** | `kitluy-phase1-pilot-runbook-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Audience** | Pilot owner, Store operators, infrastructure, fleet, release, database, security, support and QA teams |
| **Status** | Canonical operating target; not implementation evidence |
| **Timezone** | `Asia/Phnom_Penh` |

> **Purpose:** Run one controlled real Laundry Store pilot from admission and installation through observation, recovery testing and exit approval.

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



## 1. Pilot objective

Prove one commercially realistic Laundry Store can be provisioned, operate online and offline, synchronize, recover, receive signed releases, and be supported using approved documentation. Pilot is production data and real operating responsibility, but limited to an explicit cohort.

## 2. Entry gates

Pilot may start only when:

- G0 authority and scope are approved;
- G1 contracts, permissions, state machines, APIs/events/jobs and runbooks are approved;
- G2 development build and automated tests complete;
- G3 integrated verification passes for critical workflows;
- production-like staging uses the candidate digests;
- migration, RLS, backup/restore, monitoring and rollback evidence exists;
- pilot Store, support model and acceptance criteria are approved.

## 3. Pilot roles

| Role | Responsibility |
|---|---|
| Pilot owner | Business decision and exit acceptance |
| Pilot manager | Plan, schedule, evidence and stakeholder coordination |
| Store operator lead | Store readiness, staff and workflow sign-off |
| Infrastructure lead | Cloud, observability, capacity and incident readiness |
| Fleet lead | Hub/terminal/peripheral provisioning and recovery |
| Release lead | Candidate, cohort, promotion and rollback |
| Database lead | Migrations, RLS, backup and reconciliation |
| Support lead | Support channels, consent and escalation |
| Security reviewer | Identity, certificates, access and incident controls |
| QA lead | Test execution and evidence |

## 4. Pilot Store admission

- legal/business and Partner verification complete;
- Digital Store and one primary Laundry vertical confirmed;
- Store Location and network/power/site requirements assessed;
- staff/roles and support contacts identified;
- hardware and spares inventory assigned;
- data/privacy/consent expectations accepted;
- pilot dates, hours, success criteria and exit rights signed off.

## 5. Pre-install readiness

### Cloud

- Supabase/DigitalOcean production resources approved.
- Domains/TLS, APIs, Spaces and release repository validated.
- Production migrations applied by authorized operator.
- RLS/tenant/Store/Location/device isolation tests pass.
- Monitoring, alerts, on-call and status communication active.
- Backup/PITR and restore rehearsal pass.

### Store edge

- Hub is HET-enrolled with hardware manifest and certificates.
- Replacement Hub/spare plan exists.
- T1+T2 and T3+T4 devices are assigned.
- Printers, scanner, scale, cash drawer and network are certified/available.
- Signed Pilot artifacts and rollback targets are ready.

### Business configuration

- Laundry services, pricing, staff, receipt/tag templates and payment/KHQR settings are reviewed.
- Configuration projection is signed and versioned.
- Test customers/Bookings are separated from real data according to policy.

## 6. Installation day procedure

1. Confirm change window, roles and rollback criteria.
2. Verify physical hardware serials/registry records.
3. Activate Hub using one-time provisioning and hardware-backed trust.
4. Complete initial sync and configuration activation.
5. Provision assigned terminal profiles; installer does not choose unauthorized roles.
6. Pair and test peripherals.
7. Verify Hub mTLS, certificate expiry and fleet telemetry.
8. Run online and offline smoke workflows.
9. Confirm support contact, consent and incident channel.
10. Record HET and Store sign-off.

## 7. Mandatory pilot scenarios

| ID | Scenario | Required result |
|---|---|---|
| `PILOT-001` | Partner/Digital Store/Location setup | Correct isolated scope and configuration |
| `PILOT-002` | T1 intake and Booking | Authoritative local Booking and audit |
| `PILOT-003` | T2 display/privacy | Correct totals/payment state; no unsafe PII |
| `PILOT-004` | Deposit/payment/KHQR path | Approved provider behavior and reconciliation |
| `PILOT-005` | Receipt and garment tags | Durable print and reprint controls |
| `PILOT-006` | T3 Ready Scan-In | Count/QA/storage/custody event correct |
| `PILOT-007` | T4 Pickup Scan-Out | Identity/balance/custody completion correct |
| `PILOT-008` | WAN outage | Store continues locally |
| `PILOT-009` | Reconnect | Oldest-first idempotent sync; no duplicate effects |
| `PILOT-010` | File/print backlog | Queues persist and recover |
| `PILOT-011` | Hub restart | Local state and workflows recover |
| `PILOT-012` | Pilot release install | Signature/compatibility/health pass |
| `PILOT-013` | A/B rollback | Last-known-good restored |
| `PILOT-014` | Backup/restore | Isolated restore evidence and Hub checkpoint validation |
| `PILOT-015` | Replacement Hub | Replacement-first recovery rehearsed |
| `PILOT-016` | Support session | Consent, scope, expiry and audit pass |
| `PILOT-017` | RLS/isolation negative tests | Cross-scope access denied |
| `PILOT-018` | Incident drill | Detection, routing, communication and closure pass |

## 8. Observation period

For `[REQUIRED: pilot observation period]`, review daily:

- Store uptime and staff blockers;
- Hub/terminal/peripheral health;
- sync depth/age and dead letters;
- API/auth/payment error and latency;
- print/file/notification backlog;
- database connections/locks/storage;
- release/configuration versions;
- support tickets and time to resolution;
- reconciliation exceptions;
- cost/capacity anomalies.

Metrics must show source and freshness.

## 9. Incident and rollback criteria

Pause or rollback pilot when:

- payment/data-integrity risk exists;
- RLS/cross-scope isolation fails;
- Store cannot continue locally during expected WAN failure;
- release cannot be safely reverted;
- backup/restore or Hub replacement objective is unachievable;
- unresolved SEV-1/2 exceeds approved threshold;
- monitoring is blind for a critical path.

The pilot owner may stop the pilot at any time for safety, security or business continuity.

## 10. Support operating model

- named Store and HET contacts;
- support hours and severity route;
- explicit consent for elevated diagnostics;
- no persistent unrestricted shell;
- support actions and outputs audited;
- spare Hub and replacement process available;
- Khmer/English operating materials provided.

## 11. Pilot exit decision

| Decision | Meaning |
|---|---|
| `APPROVE-STABLE` | Required criteria and evidence pass; Stable promotion may proceed through policy |
| `EXTEND` | Evidence incomplete but risk acceptable; new end date and actions required |
| `ROLLBACK` | Return Store/cohort to last-known-good release/configuration |
| `STOP` | Pilot discontinued; data/hardware/access closure plan required |

## 12. Exit evidence

- signed pilot scope and Store consent;
- installation and hardware record;
- applied migration and RLS evidence;
- workflow/offline/reconnect results;
- payment and reconciliation evidence;
- monitoring/incident records;
- backup/restore and replacement-Hub results;
- release/rollback evidence;
- support/training sign-off;
- known issues and remediations;
- formal pilot decision and approvers.

## 13. Required values

- `[REQUIRED: pilot Store and Location]`
- `[REQUIRED: pilot start/end and observation period]`
- `[REQUIRED: success and blocking thresholds]`
- `[REQUIRED: support hours and contacts]`
- `[REQUIRED: hardware/spare inventory]`
- `[REQUIRED: payment/KHQR provider pilot rules]`
- `[REQUIRED: pilot approvers]`

## 14. Pilot closeout checklist

- [ ] All mandatory scenarios pass or have approved exceptions.
- [ ] No unresolved data-integrity, isolation or security risk exists.
- [ ] Monitoring period and incident review complete.
- [ ] Store staff and HET operators sign off.
- [ ] Backup/restore, rollback and Hub replacement evidence is approved.
- [ ] Documentation reflects actual operating procedure.
- [ ] Stable promotion decision is recorded separately.
