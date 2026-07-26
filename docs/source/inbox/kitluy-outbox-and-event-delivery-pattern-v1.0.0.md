# KitLuy Outbox and Event Delivery Pattern

**Filename:** `kitluy-outbox-and-event-delivery-pattern-v1.0.0.md`  
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

## 1. Decision

KitLuy uses a **transactional outbox plus consumer inbox** to achieve atomic authoritative writes and an **exactly-once business effect** over at-least-once transport.

> KitLuy does not claim exactly-once network delivery. It guarantees that a committed business fact is not silently lost and that duplicate delivery does not create duplicate authoritative effects.

## 2. Required relational tables

### 2.1 Cloud

| Table                                        | Purpose                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------- |
| `kitluy_events.outbox_events`                | Unpublished facts written in the same transaction as authoritative domain changes. |
| `kitluy_events.domain_events`                | Immutable published-event ledger and query/audit source.                           |
| `kitluy_events.consumer_inbox`               | Per-consumer dedupe and processing state.                                          |
| `kitluy_events.consumer_failures`            | Retry/non-retryable/manual-reconciliation evidence.                                |
| `kitluy_events.replay_runs` / `replay_items` | Approved replay scope, lineage and results.                                        |
| `kitluy_jobs.jobs`                           | Durable asynchronous work derived from events or commands.                         |

### 2.2 Store Hub

| Table                   | Purpose                                                      |
| ----------------------- | ------------------------------------------------------------ |
| `sync_outbox`           | Immutable local mutations ordered by local sequence.         |
| `sync_outbox_attempts`  | Push attempts and errors.                                    |
| `sync_acknowledgements` | Per-event cloud outcomes and cursor evidence.                |
| `sync_inbox`            | Signed cloud-to-Hub messages and dedupe state.               |
| `sync_cursors`          | Last accepted local/cloud sequence per stream.               |
| Domain ledgers          | Booking, payment, custody, inventory, print and audit truth. |

## 3. Producer transaction

```text
BEGIN
  authorize command and validate invariants
  apply authoritative domain write / append ledger record
  increment aggregate version
  insert outbox row with event ID, schema version, payload and hash
  insert immutable audit evidence
COMMIT
```

If the transaction rolls back, no event may be published. An event publisher never reconstructs facts by scraping changed rows after commit.

## 4. Cloud publisher algorithm

```text
loop:
  claim available outbox rows with lease using SELECT ... FOR UPDATE SKIP LOCKED
  validate schema and payload hash
  append immutable domain_events record if absent
  publish to registered transport/topic
  mark outbox published with transport reference
  on failure: release/expire lease and schedule retry
```

A publisher crash after broker publish but before marking the outbox may cause redelivery; consumer inbox dedupe is therefore mandatory.

## 5. Store Hub synchronization algorithm

```text
local command transaction
  → append domain ledger + audit + sync_outbox item
collect oldest contiguous unacknowledged sequence range
  → build signed batch envelope and checksum
push batch to Edge Operations API
  → cloud verifies device certificate, assignment, sequence and schemas
cloud deduplicates each event and applies authorized effects
  → returns per-event accepted / duplicate / rejected / reconciliation-required
Hub persists acknowledgements transactionally
Hub advances cursor only across contiguous accepted-or-duplicate items
Hub pulls signed inbox messages
  → verifies signature, generation and compatibility
  → applies transactionally and records result
```

A rejected event does not allow the Hub to silently skip a gap. It becomes blocked or reconciliation-required according to data class.

## 6. Exactly-once business-effect strategy

| Risk                             | Control                                                                                                           |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Duplicate event/job              | Unique `(consumer_name, event_id)` inbox key and domain idempotency key.                                          |
| Concurrent consumers             | Transactional inbox claim and aggregate/ledger constraints.                                                       |
| Publisher crash                  | Lease recovery; immutable event ID.                                                                               |
| Consumer crash after side effect | Side effect and inbox completion in one transaction, or external provider idempotency + durable request evidence. |
| Out-of-order aggregate events    | Aggregate version/sequence gate; hold gaps.                                                                       |
| Payment/refund duplicate         | Unique provider event/reference constraints plus append-only payment/refund IDs.                                  |
| Inventory duplicate              | Unique movement ID/source-document key; balances derived from ledger.                                             |
| Custody duplicate/out-of-order   | Unique garment + custody sequence and allowed-transition validation.                                              |
| Configuration duplicate          | Immutable version/publication ID and target activation generation.                                                |
| Webhook duplicate                | Stable delivery ID and receiver dedupe; replay creates a new delivery generation linked to same source event.     |

## 7. Event-to-job and event-to-webhook fanout

Fanout consumers create durable jobs or webhook deliveries under their own idempotency keys. They never mark the source domain event consumed until the durable child record is committed.

```text
domain event
  ├─ consumer inbox + create job (atomic)
  ├─ consumer inbox + create webhook delivery (atomic)
  ├─ consumer inbox + update projection (atomic)
  └─ consumer inbox + record no-op/suppression reason (atomic)
```

## 8. Ordering

- Global ordering is not required and must not be assumed.
- Ordering is per registered aggregate or ledger sequence.
- Financial/custody/inventory gaps block dependent projections and raise reconciliation status.
- Independent aggregates may process concurrently.
- Hub batches preserve local sequence, but cloud acceptance is per event with contiguous cursor advancement.

## 9. Failure handling

| Failure                             | Required behavior                                                   |
| ----------------------------------- | ------------------------------------------------------------------- |
| DB unavailable before commit        | Return failure; no event exists.                                    |
| Broker unavailable after commit     | Outbox retains unpublished row; alert on age.                       |
| Invalid event schema                | Quarantine as non-retryable; producer defect alert; do not publish. |
| Consumer dependency unavailable     | Retry under consumer/job policy.                                    |
| Consumer invariant failure          | Mark manual reconciliation; do not retry indefinitely.              |
| Hub WAN outage                      | Continue local approved operations; preserve ordered outbox.        |
| Cloud rejects Hub scope/certificate | Block sync, preserve data, alert; do not rewrite identity.          |
| Poison event                        | Dead-letter/quarantine with payload hash and runbook.               |

## 10. Security

- Publishers and consumers use service identities with explicit topic/event permissions.
- Tenant and resource scope are verified from authoritative records, not trusted solely from payload claims.
- Payloads exclude secrets and minimize personal data.
- Event transport encryption, database RLS and audit are required.
- Replay flags do not bypass normal authorization, compatibility or idempotency controls.

## 11. Database constraints

Minimum constraints:

- unique `event_id`;
- unique producer `idempotency_key` within declared scope;
- unique `(consumer_name, event_id)`;
- unique job idempotency scope;
- unique payment provider event ID under provider account;
- unique inventory movement business key;
- unique garment custody sequence;
- immutable event name/schema/payload hash after insert;
- no hard delete through normal application roles.

## 12. Observability

- oldest unpublished outbox age;
- outbox rows by producer/status;
- publish throughput and retries;
- consumer lag and ordering gaps;
- inbox duplicate rate;
- Hub outbox depth and oldest local age;
- sync acceptance/rejection/reconciliation counts;
- event-to-job and event-to-webhook fanout lag;
- dead letters and operator repair age.

## 13. Verification scenarios

1. Commit domain write while broker is unavailable; publish after recovery.
2. Crash publisher after broker publish; consumer creates one effect.
3. Crash consumer before and after domain commit.
4. Duplicate payment/refund/inventory/custody events.
5. Out-of-order custody and inventory sequences.
6. Hub offline for approved duration, reconnect with batched events and duplicate resend.
7. Cloud returns mixed accepted/duplicate/rejected results.
8. Configuration publication/activation with partial fleet failure and rollback.
9. Replay a bounded event set with high-risk approval and reconciliation.
10. Restore database backup and prove no duplicate provider or Store effects.

## 14. Open production values

- `[REQUIRED: selected event transport/broker]`
- `[REQUIRED: publisher lease and batch sizes]`
- `[REQUIRED: Hub batch size, payload limit and offline retention watermark]`
- `[REQUIRED: event archive and legal retention policy]`
- `[REQUIRED: lag SLOs and circuit-breaker thresholds]`
