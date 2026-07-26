# KitLuy Durable Job Registry

**Filename:** `kitluy-durable-job-registry-v1.0.0.md`  
**Version:** v1.0.0

**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Canonical target contract; not implementation evidence  
**Scope:** Shared KitLuy Core, Integration Hub, Store Hub, all current and future verticals  
**Primary phase:** Phase 1 Laundry foundation with additive cross-vertical reuse  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies target behavior. Nothing is `IMPLEMENTED` until matching repository code, applied migrations, executable tests, deployed workers/services, monitoring evidence and approved pilot or production evidence exist.

## 0. Authority and source baseline

### 0.1 Authority order

1. Current owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. This contract family and the approved canonical Supabase/API contracts.
4. Current KitLuy Rebuild, Business and product specifications.
5. Approved handoffs and feature registries.
6. Evidence-based competitor analyses.
7. Competitor clone documents and superseded planning.

### 0.2 Governing sources

- `Current KitLuy Project Instructions` — highest owner authority for the eight-phase roadmap, Digital Store model, Store Hub authority, append-only truth, API/event rules and evidence discipline.
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — minimum Phase 1 event families, durable-job families, configuration/provisioning state machines, API replay route and four-eyes authorization controls.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — local transactional outbox/inbox, ordered sync, per-event acknowledgement, append-only custody/payment truth and conflict rules.
- `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` — Laundry Booking, Ready, payment, custody and pickup operational event vocabulary.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — at-least-once queues, idempotent consumers, bounded exponential backoff, dead-letter handling, webhook verification and relational job truth.
- `kitluy-master-feature-registry-v0.2.md` and approved comparison/backlog packages — Phase 1 requirement for versioned domain events, durable jobs, webhooks, outbox/inbox and replay controls.

### 0.3 Non-negotiable rules

- Events, jobs and webhook records are relational, versioned, tenant-scoped, auditable and retry-safe.
- Transport is assumed **at least once**. Business effects must be idempotent.
- Finalized payment, refund, inventory, finance, custody and audit truth is append-only or corrected through explicit compensating records.
- Store Hub local operations continue after provisioning when WAN is unavailable.
- External connectors never receive direct production-database access and never become the authority for customer, inventory, payment or finance truth.
- Sensitive replay, repair, financial, permission, configuration, provisioning and production actions require authorized human confirmation; high-risk actions require four-eyes approval.
- Missing, stale, partial or unreconciled data must never be presented as authoritative truth.

## 1. Purpose

This registry defines asynchronous work that must survive process restarts, deployments and temporary provider/cloud outages. Page traffic, browser sessions, ephemeral memory and cache-only queues are not durable job truth.

## 2. Canonical relational job envelope

| Field                         | Rule                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `job_id`                      | UUIDv7 preferred; immutable.                                                                                                           |
| `job_type` / `schema_version` | Stable registered type and integer schema version.                                                                                     |
| `queue_name` / `priority`     | Registered queue and bounded priority.                                                                                                 |
| Scope                         | `tenant_id`, optional `digital_store_id`, optional `location_id`.                                                                      |
| `payload` / `payload_sha256`  | JSON validated against registered schema; secrets prohibited.                                                                          |
| `idempotency_key`             | Required and unique within job type + scope + active generation.                                                                       |
| State                         | `queued`, `leased`, `running`, `retry_scheduled`, `succeeded`, `failed_non_retryable`, `dead_letter`, `cancel_requested`, `cancelled`. |
| Attempts                      | `attempt_count`, `max_attempts`, `next_attempt_at`.                                                                                    |
| Lease                         | `lease_owner`, `lease_token`, `lease_expires_at`; expired leases are recoverable.                                                      |
| Timing                        | `created_at`, `available_at`, `started_at`, `completed_at`, timeout policy.                                                            |
| Context                       | `correlation_id`, `causation_event_id`, actor/service identity, environment.                                                           |
| Failure                       | stable `error_code`, class, redacted details, last error time.                                                                         |
| Result                        | result reference/checksum; large output goes through File Service.                                                                     |
| Audit                         | requester, approval request where required, cancellation/replay history.                                                               |

## 3. Queue isolation and priority

| Queue class      | Examples                                                          | Rule                                                             |
| ---------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| Critical edge    | `q.edge.sync.critical`, `q.edge.commands.critical`                | Reserved worker capacity; not starved by reports, AI or exports. |
| Critical finance | `q.payments.critical`, `q.reconciliation.critical`                | Strict idempotency, approval and reconciliation alerts.          |
| Operational      | provisioning, configuration, inventory, notifications, connectors | Bounded concurrency by Tenant/Location/provider.                 |
| Bulk             | reports, exports, migrations, imports                             | Lower priority and explicit cost/concurrency limits.             |
| AI/RAG           | indexing, embeddings, evaluations                                 | Separate budget, workers and circuit breaker.                    |

## 4. Registry

| ID             | Job type                                 | Queue                       | Payload contract                                          | Timeout | Retry                                               | Deduplication                                | Dead-letter           | Business purpose                                                                             |
| -------------- | ---------------------------------------- | --------------------------- | --------------------------------------------------------- | ------- | --------------------------------------------------- | -------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `JOB-ONB-001`  | `digital_store.initial_projection`       | `q.onboarding`              | digital_store_id, tenant_id, target_models[]              | 10m     | 5 attempts / exp+jitter                             | `digital_store_id + projection_generation`   | `dlq.onboarding`      | Rebuild initial Partner/Chain/config read models after `digital_store.created`.              |
| `JOB-PRV-001`  | `location.provisioning.prepare`          | `q.provisioning.critical`   | location_id, provisioning_session_id, hardware_profile_id | 5m      | 8 attempts / exp+jitter                             | `provisioning_session_id`                    | `dlq.provisioning`    | Prepare signed Hub bootstrap and readiness checks.                                           |
| `JOB-PRV-002`  | `hub.bootstrap.sync`                     | `q.edge.sync.critical`      | hub_device_id, location_id, bootstrap_manifest_id         | 30m     | unbounded until session expiry; bounded per attempt | `hub_device_id + assignment_generation`      | `dlq.edge.sync`       | Transfer initial approved Store configuration and verify cursors.                            |
| `JOB-DEV-001`  | `terminal.assignment.distribute`         | `q.edge.commands.critical`  | terminal_device_id, hub_device_id, assignment_generation  | 5m      | 8 attempts / exp+jitter                             | `terminal_device_id + assignment_generation` | `dlq.edge.commands`   | Deliver signed terminal profile assignment to active Hub.                                    |
| `JOB-CFG-001`  | `configuration.publication.fanout`       | `q.configuration`           | publication_id, target_scope_ids[]                        | 20m     | 10 attempts / exp+jitter                            | `publication_id`                             | `dlq.configuration`   | Resolve targets and create signed inbox messages.                                            |
| `JOB-CFG-002`  | `configuration.activation.timeout_check` | `q.configuration`           | publication_id, target_id, deadline                       | 2m      | 3 attempts                                          | `publication_id + target_id + deadline`      | `dlq.configuration`   | Escalate missing acknowledgements without falsely marking activation.                        |
| `JOB-SYNC-001` | `sync.batch.ingest`                      | `q.edge.sync.critical`      | sync_batch_id, hub_device_id, object_ref, checksum        | 10m     | 12 attempts / exp+jitter                            | `sync_batch_id`                              | `dlq.edge.sync`       | Validate, dedupe and apply a Store Hub batch.                                                |
| `JOB-SYNC-002` | `sync.reconciliation`                    | `q.reconciliation.critical` | hub_device_id, cursor_range, reconciliation_scope         | 30m     | 8 attempts / exp+jitter                             | `hub_device_id + cursor_range + scope`       | `dlq.reconciliation`  | Compare cloud acknowledgements, Hub cursors and domain ledgers.                              |
| `JOB-PAY-001`  | `payment.provider.reconcile`             | `q.payments.critical`       | payment_id, provider, provider_reference                  | 15m     | 12 attempts over configured reconciliation window   | `payment_id + provider`                      | `dlq.payments`        | Confirm remote provider truth and update reconciliation status through append-only evidence. |
| `JOB-PAY-002`  | `refund.provider.reconcile`              | `q.payments.critical`       | refund_id, payment_id, provider_reference                 | 15m     | 12 attempts over configured reconciliation window   | `refund_id + provider`                       | `dlq.payments`        | Reconcile refund provider state without editing original payment.                            |
| `JOB-INV-001`  | `inventory.balance.project`              | `q.inventory`               | movement_id, stock_item_id, location_id                   | 5m      | 8 attempts / exp+jitter                             | `movement_id + projection_version`           | `dlq.inventory`       | Update deterministic inventory projections from posted movement.                             |
| `JOB-LND-001`  | `laundry.ready.notify`                   | `q.notifications`           | booking_id, customer_id, template_version_id              | 5m      | provider-specific bounded retry                     | `booking_id + template_version_id + channel` | `dlq.notifications`   | Send Ready notification after authoritative `laundry_booking.ready`.                         |
| `JOB-WHK-001`  | `webhook.delivery.dispatch`              | `q.webhooks`                | delivery_id, endpoint_id, source_event_id                 | 30s     | WH-RP-001                                           | `delivery_id + attempt_generation`           | `dlq.webhooks`        | Deliver signed outbound webhook.                                                             |
| `JOB-WHK-002`  | `webhook.delivery.replay`                | `q.webhooks.replay`         | delivery_id, replay_request_id, approval_request_id       | 30s     | 3 attempts                                          | `replay_request_id`                          | `dlq.webhooks.replay` | Perform an approved idempotent replay without changing the source event.                     |
| `JOB-CON-001`  | `connector.reconciliation.poll`          | `q.connectors`              | connector_id, cursor, scope                               | 10m     | 8 attempts / exp+jitter                             | `connector_id + cursor + scope`              | `dlq.connectors`      | Reconcile channel/provider state and detect missed deliveries.                               |
| `JOB-REL-001`  | `release.rollout.health_evaluate`        | `q.releases`                | rollout_id, cohort_id, policy_version                     | 5m      | 5 attempts                                          | `rollout_id + cohort_id + evaluation_window` | `dlq.releases`        | Evaluate signed rollout health and pause/rollback under approved policy.                     |
| `JOB-FIL-001`  | `file.transform_and_scan`                | `q.files`                   | file_object_id, requested_variants[]                      | 20m     | 5 attempts                                          | `file_object_id + transform_policy_version`  | `dlq.files`           | Malware scan and create approved variants; bytes remain in Spaces.                           |
| `JOB-EXP-001`  | `evidence.export.generate`               | `q.exports`                 | export_request_id, scope, filters, schema_version         | 60m     | 3 attempts                                          | `export_request_id`                          | `dlq.exports`         | Generate checksumed evidence package with source/as-of metadata.                             |
| `JOB-AI-001`   | `rag.index.source`                       | `q.ai.rag`                  | source_id, version_id, checksum                           | 60m     | 5 attempts                                          | `source_id + version_id + checksum`          | `dlq.ai.rag`          | Index approved sources; never block transaction or Store sync workers.                       |

## 5. Retry policy

### 5.1 Default algorithm

- Retry only errors classified `retryable`.
- Delay: `min(base * 2^(attempt-1), max_delay) + full_jitter`.
- Each registry entry supplies or references `base`, `max_delay`, attempt limit and expiry window.
- Timeouts, connection resets, provider `429`, provider `5xx` and temporary dependency unavailability are normally retryable.
- Schema failure, scope denial, revoked credential, invalid signature, impossible state transition and failed invariant are non-retryable until repaired.
- A retry must reuse the same business idempotency key and must not create a second payment, refund, inventory movement, custody event, print or webhook delivery generation.

### 5.2 Proposed baseline policy IDs

| Policy            | Schedule                                                                            | Status                                                        |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `RP-CRITICAL-001` | 15s, 30s, 1m, 2m, 5m, 10m, 20m, 40m, then capped at 1h within the job expiry window | Proposed configurable baseline; production approval required. |
| `RP-STANDARD-001` | 1m, 5m, 15m, 1h, 4h, 12h, 24h                                                       | Proposed configurable baseline.                               |
| `WH-RP-001`       | immediate, 1m, 5m, 15m, 1h, 4h, 12h, 24h                                            | Proposed outbound webhook baseline.                           |

## 6. Deduplication and exactly-once business effect

- The queue may deliver the same job more than once.
- The handler first claims the job lease, then claims the domain-specific idempotency record or consumer inbox key.
- Authoritative writes and completion evidence occur transactionally.
- On duplicate execution, the handler returns the prior result reference.
- External side effects use provider idempotency keys where supported and persist request/response evidence before completion.
- A job is not `succeeded` merely because a message was sent; success is the registered durable outcome.

## 7. Timeout, cancellation and dead-letter rules

- Timeout is enforced by lease and worker cancellation; a killed worker does not imply job failure until the lease expires.
- Cancellation is cooperative. Financial, custody, inventory and migration jobs may become non-cancellable after their commit boundary.
- Dead-letter entry records final failure class, attempts, payload checksum, dependency state, approval requirements and recommended runbook.
- Operators may retry or repair only with explicit permission, reason and immutable audit. High-risk jobs require four-eyes approval.
- DLQ records are never silently deleted. Closure requires resolution, supersession or approved abandonment reason.

## 8. Job payload schemas

Each job type must have JSON Schema under:

```text
contracts/jobs/<job_type>/v<schema_version>.schema.json
```

Common required fields are represented by the envelope; payloads use domain identifiers and references, not copied authoritative documents. Unknown properties fail validation unless the compatibility policy explicitly allows an extension object.

## 9. Monitoring and SLO inputs

Metrics:

- queue depth and oldest available age;
- lease-expiry/recovery count;
- attempts and retry rate by job type;
- success/failure latency percentiles;
- dead-letter count and oldest unresolved age;
- dedupe hit rate;
- Tenant/Location/provider hot spots;
- critical edge and finance capacity saturation.

Exact SLOs and alert thresholds remain `[REQUIRED: approved values]`.

## 10. Contract tests

- Crash before commit, after commit and before job completion update.
- Duplicate delivery and concurrent workers.
- Lease expiry and recovery.
- Timeout and cooperative cancellation.
- Retryable/non-retryable classification.
- DLQ creation and approved replay.
- Cross-Tenant/scope denial.
- Provider idempotency and reconciliation.
- Queue isolation under AI/export saturation.
- Store sync continuity during cloud worker restart.

## 11. Open production values

- `[REQUIRED: queue implementation and deployment topology]`
- `[REQUIRED: approved worker concurrency by queue and environment]`
- `[REQUIRED: exact timeout/retry policy approval]`
- `[REQUIRED: dead-letter retention and escalation SLA]`
- `[REQUIRED: critical queue SLOs]`
