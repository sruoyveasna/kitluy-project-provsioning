# KitLuy Replay and Reconciliation Runbook

**Filename:** `kitluy-replay-and-reconciliation-runbook-v1.0.0.md`  
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

Provide a safe, auditable method to replay events/jobs/webhooks, rebuild projections and repair delivery gaps without duplicating payments, refunds, inventory movements, custody releases, configuration activation or connector effects.

## 2. Risk classes and approval

| Class             | Examples                                                                                                                   | Minimum authority                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `RR-L1` Low       | Rebuild a read-only dashboard projection; resend non-sensitive notification                                                | Authorized operator + reason.                                                                             |
| `RR-L2` Medium    | Replay connector delivery, regenerate export, rebuild Store status                                                         | Operator + service owner approval.                                                                        |
| `RR-L3` High      | Payment/refund reconciliation, inventory or custody repair, configuration/provisioning replay, production migration repair | Requester and independent approver; re-authentication; payload-bound execution token; four-eyes approval. |
| `RR-L4` Emergency | Broad production repair during incident                                                                                    | Incident-bound break-glass plus immediate alert and retrospective review; audit/RLS remain enabled.       |

The requester may not approve their own L3/L4 replay.

## 3. Preconditions

Before replay:

- Incident/problem/ticket ID exists.
- Exact source records and authoritative system are identified.
- Event/job/webhook IDs, Tenant/Store/Location scope, time range and consumer are bounded.
- Current production compatibility matrix confirms the target consumer can process the schema.
- A dry-run or shadow evaluation has been completed.
- Expected idempotency keys and already-processed inbox/delivery records are listed.
- Financial, inventory and custody reconciliation checkpoints are captured where applicable.
- Backup/restore and rollback path are confirmed for broad repairs.
- Required permission, reason, re-authentication and approval token are valid.

## 4. Replay modes

| Mode                      | Use                                                                   | Rule                                                                                                    |
| ------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `projection_rebuild`      | Recreate derived read model from immutable events                     | May truncate only the derived projection under approved migration; never source ledgers.                |
| `consumer_replay`         | Re-run one consumer over selected event IDs                           | Uses original event IDs; inbox may be reset only through approved replay lineage, not deleted silently. |
| `job_retry`               | Retry dead-lettered durable work                                      | Reuses business idempotency key and records a new attempt/replay generation.                            |
| `webhook_replay`          | Redeliver an outbound webhook                                         | New delivery ID linked to original source event and prior delivery; source event unchanged.             |
| `provider_reconciliation` | Re-query external provider and repair local reconciliation evidence   | Provider evidence is persisted; original payment/refund remains immutable.                              |
| `hub_sync_repair`         | Repair missing acknowledgement/cursor or re-ingest retained Hub event | Preserve local sequence and original event ID; never renumber custody/payment history.                  |
| `compensating_repair`     | Correct an authoritative ledger effect                                | Create explicit compensating document/event; never rewrite history.                                     |

## 5. Standard procedure

### Step 1 — Declare and scope

Create `replay_run` with:

- run ID, risk class and environment;
- requester, service owner and approver;
- reason, ticket/incident and expected outcome;
- Tenant/Digital Store/Location/consumer scope;
- event/job/delivery IDs or immutable query snapshot;
- schema versions and compatibility evidence;
- dry-run checksum and item count.

### Step 2 — Freeze the item set

Materialize `replay_items` with original IDs and payload hashes. Dynamic queries such as “all failed events” are prohibited at execution time unless the resolved item list was frozen and approved.

### Step 3 — Dry run

For every item classify:

- already completed / safe no-op;
- retryable;
- blocked by schema/scope/order gap;
- requires provider query;
- requires compensating record;
- unsafe and excluded.

Generate predicted writes and reconciliation deltas. No external side effects occur.

### Step 4 — Approve

Approval binds:

- run ID and frozen item-list checksum;
- exact mode and consumer;
- environment/scope;
- maximum item count and time window;
- expiry;
- rollback/stop conditions.

Any payload, scope or count change invalidates approval.

### Step 5 — Execute in bounded batches

- Use dedicated replay queue and rate limits.
- Mark envelope `replay.is_replay=true` and include `replay_run_id`.
- Preserve original event ID for consumer replay; webhook replay uses a new delivery ID.
- Stop on threshold breach, invariant failure, unexpected financial/inventory delta, ordering gap or authorization change.
- Record per-item outcome and prior/new references.

### Step 6 — Reconcile

Compare authoritative ledgers and projections:

- payments/refunds vs provider evidence and transaction balances;
- inventory movements vs derived stock balances;
- garment custody sequence vs Ready/pickup state;
- Hub local sequence vs cloud event/acknowledgement/cursor;
- configuration publication vs target activations and health;
- webhook source events vs deliveries and endpoint acknowledgements.

### Step 7 — Close

A replay closes only when:

- all items have terminal outcomes;
- unresolved items have owners and incidents;
- reconciliations pass or approved discrepancies are documented;
- monitoring is normal for the observation window;
- incident/problem record, runbook and tests are updated;
- approver signs closure for L3/L4.

## 6. Stop conditions

Immediately pause when:

- duplicate authoritative financial/custody/inventory effect appears;
- event payload hash differs from frozen item;
- unsupported schema or client version is found;
- cross-Tenant/Store/Location scope is detected;
- provider reports conflicting settlement/refund truth;
- Hub sequence gap expands;
- error rate or queue lag exceeds approved threshold;
- approval expires or access is revoked.

## 7. Domain-specific safeguards

### 7.1 Payments and refunds

- Never replay a “charge/refund” command merely from an event.
- Query provider state first when external status is uncertain.
- Reuse provider idempotency key where supported.
- Repair with reconciliation evidence or compensating document, not edited totals.

### 7.2 Inventory

- Replay movement projection freely only when the movement ledger is unchanged.
- Missing/incorrect authoritative movement requires a new adjustment movement with reason and approval.
- Generic last-write-wins quantity repair is prohibited.

### 7.3 Garment custody

- Preserve garment custody sequence.
- A missing scan may require operator evidence and an explicit correction/exception event.
- Never generate a pickup release merely to make a Booking projection look complete.

### 7.4 Configuration and provisioning

- Replay only immutable signed versions compatible with the target.
- Target identity, assignment generation and certificate status must be revalidated.
- Never reactivate revoked devices or bypass Hub-first provisioning.

### 7.5 Webhooks/connectors

- Source event remains immutable.
- Replay creates a new delivery generation and signature/timestamp.
- Verify endpoint is active and secret generation is valid.
- Reconcile channel state after replay; endpoint `2xx` is not proof of downstream business completion.

## 8. Required records

- `replay_runs`
- `replay_items`
- `replay_approvals`
- `replay_executions`
- `replay_reconciliations`
- linked authorization decision, audit, incident and evidence files

No normal operator role may hard-delete or directly rewrite these records.

## 9. Validation checklist

- [ ] Scope is frozen and checksumed.
- [ ] Risk class and approval are correct.
- [ ] Consumer/schema compatibility is proven.
- [ ] Dry-run counts and predicted effects are reviewed.
- [ ] Idempotency keys and existing outcomes are known.
- [ ] Batch size, rate and stop conditions are configured.
- [ ] Execution token is valid and unused.
- [ ] Per-item outcomes are retained.
- [ ] Finance/inventory/custody/sync/config/webhook reconciliation is complete as applicable.
- [ ] Monitoring observation window passed.
- [ ] Closure approved and documents updated.

## 10. Test exercises

- Duplicate event replay results in no duplicate effect.
- Replay mixed already-processed and failed items.
- Expired/changed approval is denied.
- Payment provider conflict stops run.
- Inventory projection rebuild matches movement ledger exactly.
- Custody sequence gap is quarantined.
- Hub reconnect replay preserves local sequence and cursor.
- Webhook replay uses new delivery ID but same source event.
- Kill replay worker mid-batch and resume safely.
- Restore from backup and run reconciliation without duplicate external effects.

## 11. Open production values

- `[REQUIRED: approval policy IDs and approver pools]`
- `[REQUIRED: maximum batch sizes/rates by risk class]`
- `[REQUIRED: monitoring observation windows]`
- `[REQUIRED: reconciliation tolerances; financial tolerance should normally be exact]`
- `[REQUIRED: replay record retention]`
