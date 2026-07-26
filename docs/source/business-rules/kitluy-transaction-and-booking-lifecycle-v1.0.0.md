# KitLuy Transaction and Booking Lifecycle

**Filename:** `kitluy-transaction-and-booking-lifecycle-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines draft, snapshot, confirmation/finalization, numbering, cancellation, void, partial fulfilment, completion and channel-ingress rules.

**Scope boundary:** Neutral transaction lifecycle with Laundry Booking terminology adapters. It covers physical, Storefront and connector-originated sales without merging their authority boundaries.

## 1. Governing principles

1. Current owner decisions and the active KitLuy Project Instructions override older planning.
2. Applied migrations, verified code/tests, deployment records and production evidence override target-state prose for implementation truth.
3. A Partner Account owns one or more Digital Stores; each Digital Store has exactly one primary vertical. Physical Store Locations are optional offline-capable edge environments.
4. Finalized transaction, payment, inventory, finance and audit records are append-only. Corrections use linked compensating records; destructive edits are prohibited.
5. Authoritative business data uses relational tables. JSON is limited to optional metadata and transport envelopes.
6. Every write is tenant-, Digital-Store-, Location-, actor- and device-scoped; versioned, idempotent, retry-safe and auditable.
7. The Store Hub is the local operational authority after provisioning. WAN failure must not stop approved local operations.
8. External channels and connectors never own KitLuy customer, inventory, payment, finance or audit truth.
9. Sensitive financial, permission, compliance or safety actions require authorized human confirmation and, where policy requires, four-eyes approval.
10. Khmer and English, KHR and USD, Asia/Phnom_Penh, KHQR and intermittent connectivity are first-class requirements.
11. Missing, stale, partial, estimated or unreconciled data must be labeled; it must never be presented as authoritative current truth.
12. No capability is `IMPLEMENTED` without repository, applied migration, test, deployment and required pilot/production evidence.

## 2. Canonical data conventions

| Concern        | Canonical rule                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| IDs            | UUID; offline-created aggregates use client-generated UUIDv7 when available.                                         |
| Idempotency    | Caller supplies a stable idempotency key. Replays return the original business result without duplicating effects.   |
| Money          | `amount_minor bigint` plus ISO-4217 currency code. KHR exponent is 0; USD exponent is 2. No floating-point money.    |
| Quantities     | `numeric(18,4)` plus unit-of-measure; weight and piece quantities are never silently interchanged.                   |
| Time           | Store UTC `timestamptz`; render in `Asia/Phnom_Penh`. Operational grouping uses explicit Location business date.     |
| Scope          | Every authoritative record resolves Tenant, Digital Store and, when physical, Store Location.                        |
| Truth envelope | Reads expose source, as-of time, completeness, sync freshness and reconciliation status.                             |
| Corrections    | Reverse or adjust with linked compensating entries; preserve the original.                                           |
| Audit          | Actor, role, device, source, reason, correlation ID, before/after references and approval evidence where applicable. |
| Offline        | Store Hub accepts only locally authorized operations and queues immutable outbox events for cloud synchronization.   |

## 3. Rule catalogue

### KBR-TXN-001 — Draft transaction creation

| Required field            | Canonical specification                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-001                                                                                                                                              |
| Purpose                   | Create a mutable commercial workspace before authoritative finalization.                                                                                 |
| Inputs                    | Channel; customer reference; lines; quantities; requested fulfilment; actor/device; idempotency key.                                                     |
| Preconditions             | Scope resolved; channel allowed; catalog offers available; no prohibited direct ledger mutation.                                                         |
| Calculation or transition | Create transaction in DRAFT with version 1. Lines remain recalculable and no finance/subledger posting occurs.                                           |
| Output                    | Draft transaction ID, version and provisional totals labeled non-final.                                                                                  |
| Permissions               | Authorized POS/storefront/staff command for the scoped Store.                                                                                            |
| Audit event               | transaction.draft_created.                                                                                                                               |
| Offline behavior          | Hub creates local drafts for physical operations; cloud channels create cloud drafts. Drafts do not cross authorities without accepted ingress contract. |
| Error behavior            | Validation errors return field-level details; no partial authoritative effects.                                                                          |
| Compensating action       | Expire or abandon draft; no financial compensation because nothing finalized.                                                                            |
| Canonical test vectors    | TV1: valid T1 intake draft → DRAFT v1. TV2: retry same key → same draft. TV3: invalid service → no draft.                                                |
| Owning service            | Transaction Service                                                                                                                                      |
| Consuming products        | POS, Storefront, Commerce Store API, Partner Portal read views                                                                                           |

### KBR-TXN-002 — Snapshot catalog, price and policy at confirmation

| Required field            | Canonical specification                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-002                                                                                                                        |
| Purpose                   | Ensure future configuration changes do not rewrite accepted transactions or Bookings.                                              |
| Inputs                    | Resolved lines; service/product descriptions; unit/quantity; price components; tax/discount policy; currency; fulfilment promise.  |
| Preconditions             | Draft valid; current compatible configuration resolved; customer/staff confirmation obtained where required.                       |
| Calculation or transition | Copy all commercially material display and calculation fields into immutable line/header snapshots with policy/version references. |
| Output                    | Confirmed transaction snapshot and deterministic total inputs.                                                                     |
| Permissions               | Authorized confirming actor; customer confirmation on T2/storefront when required.                                                 |
| Audit event               | transaction.snapshot_captured.                                                                                                     |
| Offline behavior          | Hub uses last active acknowledged compatible configuration. Stale version is shown; incompatible version blocks confirmation.      |
| Error behavior            | Missing/ambiguous configuration blocks confirmation; no fallback to guessed price.                                                 |
| Compensating action       | Return to draft, refresh configuration, or manager-approved explicit price override with reason.                                   |
| Canonical test vectors    | TV1: service later renamed → receipt retains old name. TV2: config version incompatible → confirmation blocked.                    |
| Owning service            | Transaction and Pricing Services                                                                                                   |
| Consuming products        | T1/T2, Storefront, APIs, receipts, reports, Finance                                                                                |

### KBR-TXN-003 — Confirm and finalize transaction

| Required field            | Canonical specification                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-003                                                                                                                                                 |
| Purpose                   | Turn a valid draft into an authoritative transaction exactly once.                                                                                          |
| Inputs                    | Draft ID/version; customer confirmation; payment/deposit plan; snapshot; idempotency key.                                                                   |
| Preconditions             | Draft current and complete; required approvals satisfied; totals deterministic; no blocking reservation/capacity error.                                     |
| Calculation or transition | Atomically set CONFIRMED/FINALIZED boundary, allocate number, freeze protected facts, create ledger obligations and emit outbox event.                      |
| Output                    | Finalized transaction/Booking, immutable number/snapshot, receivable/payment expectation and event.                                                         |
| Permissions               | Authorized channel command; sensitive overrides require approval.                                                                                           |
| Audit event               | transaction.confirmed/finalized.                                                                                                                            |
| Offline behavior          | Physical Store finalizes on Hub. Cloud receives immutable event later. Online transaction finalization follows cloud authority and may then project to Hub. |
| Error behavior            | Atomic failure leaves draft unchanged. Ambiguous timeout is resolved by idempotency/status lookup.                                                          |
| Compensating action       | Cancel/void/refund through governed compensating lifecycle; never reopen protected facts for editing.                                                       |
| Canonical test vectors    | TV1: confirmation commits header, lines, receivable and event atomically. TV2: duplicate request → one transaction.                                         |
| Owning service            | Transaction Service plus Finance Subledger                                                                                                                  |
| Consuming products        | POS, Storefront, Partner Portal/App, reports, Notification                                                                                                  |

### KBR-TXN-004 — Transaction numbering and offline convergence

| Required field            | Canonical specification                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-004                                                                                                                                                                                        |
| Purpose                   | Provide human-readable numbers without collisions across offline Locations.                                                                                                                        |
| Inputs                    | Location prefix/range; business date; device/Hub sequence; transaction UUID.                                                                                                                       |
| Preconditions             | Hub provisioned with active numbering policy; sequence storage durable.                                                                                                                            |
| Calculation or transition | Assign local display number from Location-scoped sequence and retain globally unique UUID. Cloud never renumbers a finalized local transaction; collision detection uses UUID and policy metadata. |
| Output                    | Stable display number and global ID.                                                                                                                                                               |
| Permissions               | System command under Hub certificate; numbering policy administration privileged.                                                                                                                  |
| Audit event               | transaction.number_assigned; numbering.collision_detected.                                                                                                                                         |
| Offline behavior          | Hub allocates numbers without WAN. Sequence increment and transaction commit are atomic.                                                                                                           |
| Error behavior            | Sequence unavailable blocks finalization rather than reuse a number. Collision on sync quarantines for operator review but does not overwrite.                                                     |
| Compensating action       | Issue governed alias/correction document if legally needed; preserve original identifier.                                                                                                          |
| Canonical test vectors    | TV1: two offline terminals through one Hub get distinct sequence numbers. TV2: restart continues next sequence.                                                                                    |
| Owning service            | Transaction Numbering Service on Hub                                                                                                                                                               |
| Consuming products        | T1/T4, receipts/tags, Partner Portal, Finance, reports                                                                                                                                             |

### KBR-TXN-005 — Cancellation before fulfilment/production

| Required field            | Canonical specification                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-005                                                                                                                                                     |
| Purpose                   | Stop an accepted transaction where policy permits while preserving evidence.                                                                                    |
| Inputs                    | Transaction/Booking; current state; reason; payment/reservation state; actor; approval.                                                                         |
| Preconditions             | Cancellation window open; no prohibited completed custody/fulfilment; permission and reason valid.                                                              |
| Calculation or transition | Create cancellation record, release reservations/capacity, calculate payment consequences, and transition to CANCELLED. Original transaction remains immutable. |
| Output                    | Cancelled state, released commitments and refund/credit task if applicable.                                                                                     |
| Permissions               | Cashier/manager according to stage and threshold; customer-facing cancellation via allowed channel.                                                             |
| Audit event               | transaction.cancelled; reservation.released.                                                                                                                    |
| Offline behavior          | Hub can cancel locally when state and tender policy permit. Remote cancellation of Hub-authoritative work waits for Hub acceptance.                             |
| Error behavior            | If production/fulfilment advanced, reject and direct to issue/refund/partial adjustment workflow.                                                               |
| Compensating action       | Reverse reservations and liabilities; refund payment through payment rules.                                                                                     |
| Canonical test vectors    | TV1: paid Booking cancelled before washing → cancellation plus refund task. TV2: READY Booking cancellation request → blocked/manager issue process.            |
| Owning service            | Transaction Lifecycle Service                                                                                                                                   |
| Consuming products        | T1, Partner Portal/App, Storefront, Payments, Inventory/Capacity                                                                                                |

### KBR-TXN-006 — Void erroneous transaction

| Required field            | Canonical specification                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-006                                                                                                                            |
| Purpose                   | Neutralize a finalized transaction created in error without deleting it.                                                               |
| Inputs                    | Original transaction; void reason/evidence; actor; approval; payment and inventory effects.                                            |
| Preconditions             | Void policy permits; actor authorized; required approvals complete; transaction not already voided.                                    |
| Calculation or transition | Post full compensating transaction/ledger effects linked to original. Mark lifecycle VOIDED while preserving original lines and audit. |
| Output                    | Void document, zeroed net effect by compensation and reconciliation tasks.                                                             |
| Permissions               | Manager/finance permission; threshold/four-eyes policy as configured.                                                                  |
| Audit event               | transaction.void_requested/approved/posted.                                                                                            |
| Offline behavior          | Local void allowed only under approved policy and supported tender state. Provider-dependent reversal may remain pending until online. |
| Error behavior            | Partial failure produces PENDING_RECONCILIATION, never false completion.                                                               |
| Compensating action       | Retry provider reversal idempotently; post additional correction only after reconciliation proves need.                                |
| Canonical test vectors    | TV1: duplicate cashier transaction voided → original + equal opposite. TV2: void replay → no second reversal.                          |
| Owning service            | Transaction and Finance Services                                                                                                       |
| Consuming products        | POS, Partner Portal, Payments, reports, audit                                                                                          |

### KBR-TXN-007 — Partial fulfilment and completion derivation

| Required field            | Canonical specification                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-007                                                                                                                                                                            |
| Purpose                   | Keep completion accurate when only part of a transaction/Booking is fulfilled.                                                                                                         |
| Inputs                    | Line/unit fulfilment records; custody events; quantities; cancellation/return records.                                                                                                 |
| Preconditions             | Transaction supports partial fulfilment; units identified and quantities valid.                                                                                                        |
| Calculation or transition | Derive OPEN/PARTIALLY_FULFILLED/FULFILLED from append-only fulfilment units. Completion occurs only when all required units are fulfilled, cancelled or otherwise closed under policy. |
| Output                    | Derived lifecycle state and remaining obligation.                                                                                                                                      |
| Permissions               | Operational staff by fulfilment profile; override requires manager approval.                                                                                                           |
| Audit event               | fulfilment.unit_completed; transaction.fulfilment_state_changed.                                                                                                                       |
| Offline behavior          | Hub derives physical custody completion locally; cloud projections show sync freshness.                                                                                                |
| Error behavior            | Over-fulfilment and negative remaining quantity rejected.                                                                                                                              |
| Compensating action       | Post correction/return custody event; recompute derived state.                                                                                                                         |
| Canonical test vectors    | TV1: 3 of 5 garments released under approved partial policy → PARTIAL. TV2: sixth scan → reject.                                                                                       |
| Owning service            | Fulfilment/Custody Service                                                                                                                                                             |
| Consuming products        | T3/T4, POS Mobile, Partner Portal/App, Storefront status, reports                                                                                                                      |

### KBR-TXN-008 — Channel ingress acceptance

| Required field            | Canonical specification                                                                                                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-TXN-008                                                                                                                                                                                           |
| Purpose                   | Separate an external order request from KitLuy authoritative transaction acceptance.                                                                                                                  |
| Inputs                    | Connector/channel event; external transaction ID; mapping version; requested lines; customer data; signature.                                                                                         |
| Preconditions             | Connector verified and authorized; event not previously processed; Store/channel enabled.                                                                                                             |
| Calculation or transition | Persist ingress evidence, validate mapping/availability/pricing, then accept into a KitLuy draft/transaction or reject/quarantine. External status is never treated as KitLuy finalization by itself. |
| Output                    | Accepted KitLuy ID and acknowledgement, or rejection/quarantine with reasons.                                                                                                                         |
| Permissions               | Connector scope and Store authorization; no direct database access.                                                                                                                                   |
| Audit event               | transaction_ingress.received/accepted/rejected/quarantined.                                                                                                                                           |
| Offline behavior          | Accepted physical fulfilment is projected to Hub with version and acknowledgement. Hub can continue existing accepted work offline.                                                                   |
| Error behavior            | Schema, price or stock conflict produces explicit rejection/needs-review, not silent substitution.                                                                                                    |
| Compensating action       | Cancel/reject upstream through connector contract; compensate accepted transaction through normal lifecycle if already finalized.                                                                     |
| Canonical test vectors    | TV1: duplicate marketplace event → same KitLuy ID. TV2: unknown mapping → quarantine.                                                                                                                 |
| Owning service            | Integration Hub and Transaction Ingress Service                                                                                                                                                       |
| Consuming products        | Connector API, Storefront, Partner Portal, Hub, reports                                                                                                                                               |

## 4. Canonical lifecycle

```text
DRAFT -> CONFIRMED/FINALIZED -> IN_PROGRESS -> PARTIALLY_FULFILLED -> FULFILLED/COMPLETED
   |             |                    |
   +-> EXPIRED   +-> CANCELLED        +-> ISSUE_HOLD
                 +-> VOIDED           +-> RETURN/REFUND (compensating)
```

- `Booking` is the Laundry-facing term; the neutral authoritative aggregate remains compatible with `transaction` contracts.
- Finalization is the immutability boundary. Status labels after finalization are derived from append-only events and obligations.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                             |
| ------------ | -------------------------------------------------------------------------- |
| `TXN-OD-001` | Exact cancellation windows and approval thresholds by vertical and tender. |
| `TXN-OD-002` | Final human-readable numbering format and retention/legal requirements.    |
| `TXN-OD-003` | Approved partial pickup/fulfilment policies for Laundry Phase 1.           |

## Verification and completion gate

- Every rule has schema, API/event, permission, audit, offline, error and compensating-action coverage.
- Canonical test vectors are represented in automated unit, contract, integration and Store-Hub reconnect tests.
- Cross-Tenant, cross-Digital-Store and cross-Location isolation tests pass.
- Duplicate delivery, stale configuration, partial sync and replay tests produce no duplicate business effect.
- Reconciliation proves subledgers and operational totals from authoritative entries.
- Documentation, migrations, seeds, monitoring, rollback, support and pilot evidence pass the applicable phase gate.
- No planning-only capability is labeled implemented.

## Version history

| Version | Date       | Change                                                      |
| ------- | ---------- | ----------------------------------------------------------- |
| v1.0.0  | 2026-07-26 | Initial canonical business-rule and state-machine contract. |
