# KitLuy Performance and Capacity Test Plan

| Field | Value |
|---|---|
| Filename | `kitluy-performance-and-capacity-test-plan-v1.0.0.md` |
| Version | `v1.0.0` |
| Date | `2026-07-26` |
| Owner | HET / KitLuy Suite Project Owner |
| Phase | Phase 1 - Laundry |
| Status | Canonical testing and evidence specification; not execution evidence |
| Timezone | `Asia/Phnom_Penh` |
| Languages | Khmer and English |
| Currencies | KHR and USD |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.


## 1. Objective

Prove that Phase 1 meets approved operational objectives at the Store edge and in the cloud, degrades truthfully under stress, protects transactional workloads from reports/AI/background work, and has an evidence-based path from DigitalOcean App Platform to DOKS without application rewrite.

Exact production SLOs and commercial capacity commitments remain `[REQUIRED: owner-approved values]`. Until approved, the plan establishes baselines and forbids unsupported claims.

## 2. Workload domains

| Domain | Primary measures | Failure prohibition |
|---|---|---|
| T1-T4 LAN operations | p50/p95/p99 response, accepted operations/s, print/scan latency | No lost or duplicate Booking, tender or custody effect |
| Store Hub | CPU, memory, disk latency, DB locks, queue depth, outbox drain, restart time | No unsafe success, corruption or foreground starvation |
| Cloud APIs | request rate, latency, error rate, saturation, dependency time | No cross-tenant leak or uncontrolled retry storm |
| Sync | backlog age, items/s, batch latency, conflicts, quarantine | No duplicate effect; foreground Store operation protected |
| Portals/apps | route load, query latency, bundle size, stale/partial behavior | No false zero/live state |
| Reporting/exports | job queue, completion time, memory/storage, cancellation | Cannot starve operational APIs or sync |
| Files/notifications | upload/download throughput, retry, provider latency | Business truth independent of provider delivery |
| AI/MCP/RAG | queue, token/latency/cost, source retrieval | AI is throttled before transactions/sync degrade |
| Releases/config | distribution, activation, rollback time | Current healthy slot/config remains available |

## 3. Capacity models

Test at four profiles: single pilot Location; expected first commercial cohort; 3x expected peak; controlled failure/saturation. Store tests include one Hub with active T1/T2 and T3/T4 profiles, POS Mobile clients, peripherals, and WAN degradation. Cloud tests include realistic Tenant distribution, hot and cold Stores, read/write mix, report/export bursts, file traffic, webhooks and sync backlog.

## 4. Test types

- Baseline and microbenchmark.
- Load and peak.
- Stress to controlled saturation.
- Soak for memory/connection/queue leaks.
- Spike and flash traffic.
- Backlog drain after outage.
- Dependency latency/failure and retry storm.
- Failover/restart/scale-in and graceful drain.
- Storage pressure, disk latency and database lock contention.
- Network latency, loss and bandwidth restriction.

## 5. Required scenarios

| ID | Scenario | Required proof |
|---|---|---|
| PERF-001 | T1 Booking burst on one Hub | Stable latency and no lost/duplicate effects |
| PERF-002 | Concurrent T1 Booking, T3 Ready and T4 pickup | Priority and locking preserve valid state transitions |
| PERF-003 | Print queue burst | Queue drains; UI remains responsive; duplicate suppression works |
| PERF-004 | Seven-day sync backlog while Store operates | Foreground LAN latency remains within approved budget |
| PERF-005 | Cloud API 3x expected peak | Autoscaling/limits work; errors are bounded and observable |
| PERF-006 | Report/export burst | Asynchronous jobs protect operational APIs |
| PERF-007 | File upload burst | Checksums and metadata remain correct; no memory exhaustion |
| PERF-008 | Webhook retry storm | Backoff and queue isolation prevent cascading failure |
| PERF-009 | Provider latency | Threads/connections remain bounded; pending truth is explicit |
| PERF-010 | AI saturation | AI throttles first; transactions and sync protected |
| PERF-011 | Database replica lag | Reads truth-label lag; critical decisions use primary |
| PERF-012 | Valkey/cache outage | Safe fallback; no authorization or finance truth from stale cache |
| PERF-013 | App Platform instance loss | Health routing and restart meet approved recovery target |
| PERF-014 | Graceful scale-in | Accepted requests/jobs complete or safely retry |
| PERF-015 | DOKS staging migration of same images | Contracts and performance remain within approved variance |
| PERF-016 | 24/72-hour soak | No unbounded memory, connection, disk, queue or log growth |
| PERF-017 | Hub disk near capacity | Alerts, retention and backpressure prevent corruption |
| PERF-018 | Hub power cycle under load | Recovery completes and accepted effects remain correct |

## 6. Measurement and reproducibility

Record dataset size, workload script SHA, topology, instance/hardware model, software/build versions, configuration, warm-up, duration, concurrency, arrival model, network profile, metrics, logs, traces, database plans, bottlenecks, and raw result files. Results without a reproducible workload definition are not capacity evidence.

## 7. Pass/fail policy

A test fails for any truth violation, lost/duplicate business effect, tenant escape, unbounded resource growth, missing telemetry, unexplained error spike, or breach of an approved SLO. Capacity claims must state tested topology, dataset, duration and confidence; they cannot be generalized beyond evidence.

## 8. Gate mapping

G1 approves workload/SLO definitions. G2 establishes component baselines. G3 runs load, stress, backlog and failure tests. G4 validates alerts, scaling, rollback and capacity runbooks. G5 attaches pilot traffic and headroom evidence.
