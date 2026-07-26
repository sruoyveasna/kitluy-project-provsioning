# KitLuy Business Date, Shift and Close Rules

**Filename:** `kitluy-business-date-shift-and-close-rules-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines Location business date, day/shift open, cash movements, handover, shift close, business-day close and late-event handling.

**Scope boundary:** Shared physical-Location operating-day, register, shift and cash-close foundation. Phase 1 Laundry uses T1/T4 cash contexts; later verticals reuse the neutral model.

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

### KBR-SHIFT-001 — Location business date derivation

| Required field            | Canonical specification                                                                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-001                                                                                                                                                                                                 |
| Purpose                   | Assign operational activity to an explicit Location business date independent of UTC midnight.                                                                                                                |
| Inputs                    | Location timezone; configured day-boundary time; event time; active business-day record.                                                                                                                      |
| Preconditions             | Location configuration active and acknowledged by Hub.                                                                                                                                                        |
| Calculation or transition | Convert event timestamp to Asia/Phnom_Penh/Location time and apply configured business-day boundary. Persist business_date on operational document; never recompute historical documents after policy change. |
| Output                    | Business date and policy-version snapshot.                                                                                                                                                                    |
| Permissions               | System derivation; boundary policy administration privileged.                                                                                                                                                 |
| Audit event               | business_date.assigned.                                                                                                                                                                                       |
| Offline behavior          | Hub derives locally from signed configuration and monotonic/validated clock policy.                                                                                                                           |
| Error behavior            | Unknown boundary or unreliable clock blocks opening/closing and flags new documents according to emergency-clock policy.                                                                                      |
| Compensating action       | Correct through governed business-date correction/period-reopen process; preserve original assignment.                                                                                                        |
| Canonical test vectors    | TV1: boundary 04:00, event 02:00 July 27 → business date July 26. TV2: event 05:00 → July 27.                                                                                                                 |
| Owning service            | Business Time Service                                                                                                                                                                                         |
| Consuming products        | POS/Hub, Finance, reports, Partner/Chain portals                                                                                                                                                              |

### KBR-SHIFT-002 — Open business day

| Required field            | Canonical specification                                                                                                 |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-002                                                                                                           |
| Purpose                   | Create one active operational day per Location under the approved policy.                                               |
| Inputs                    | Location; target business date; opening actor; opening checks; prior day status.                                        |
| Preconditions             | Location live; Hub active; no conflicting open day; prior day closed or approved carryover.                             |
| Calculation or transition | Create OPEN business-day record with configuration/version and opening evidence. Reject duplicate/open-ahead conflicts. |
| Output                    | Active business day and event.                                                                                          |
| Permissions               | Manager/supervisor or approved automatic policy.                                                                        |
| Audit event               | business_day.opened.                                                                                                    |
| Offline behavior          | Hub-local and offline-capable.                                                                                          |
| Error behavior            | Conflicting day, clock uncertainty or unresolved prior close blocks or requires governed exception.                     |
| Compensating action       | Close/reopen correctly; do not delete business-day record.                                                              |
| Canonical test vectors    | TV1: no open day → open July 26. TV2: second open for same Location → idempotent/conflict-safe.                         |
| Owning service            | Business Day Service on Hub                                                                                             |
| Consuming products        | POS, Partner Portal, Finance, reports                                                                                   |

### KBR-SHIFT-003 — Open register/shift

| Required field            | Canonical specification                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-003                                                                                             |
| Purpose                   | Establish cashier accountability, float and terminal context before cash operations.                      |
| Inputs                    | Business day; register/device; employee; opening float by currency; blind/verified mode; idempotency key. |
| Preconditions             | Business day OPEN; employee authenticated and assigned; register not already open.                        |
| Calculation or transition | Create OPEN shift/register session, post opening-float cash movement and bind device/employee.            |
| Output                    | Shift ID, opening balances and active register context.                                                   |
| Permissions               | Cashier may open own shift; manager override governed.                                                    |
| Audit event               | shift.opened; cash_float.posted.                                                                          |
| Offline behavior          | Hub-local; survives restart and WAN outage.                                                               |
| Error behavior            | Duplicate open returns existing session; conflicting employee/register is rejected.                       |
| Compensating action       | Transfer/close under policy; correct float by linked cash movement with reason.                           |
| Canonical test vectors    | TV1: open with 100,000 KHR → session and float. TV2: same register second cashier → blocked.              |
| Owning service            | Shift and Cash Service on Hub                                                                             |
| Consuming products        | T1/T4, Partner Portal, Finance, reports                                                                   |

### KBR-SHIFT-004 — Cash movement during shift

| Required field            | Canonical specification                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-004                                                                                                                                       |
| Purpose                   | Record every non-sale drawer change explicitly.                                                                                                     |
| Inputs                    | Shift; movement type; amount/currency; reason; actor; evidence; idempotency key.                                                                    |
| Preconditions             | Shift OPEN; tender/currency allowed; permission and reason valid.                                                                                   |
| Calculation or transition | Post PAID_IN, PAID_OUT, SAFE_DROP, FLOAT_ADJUSTMENT or CASH_REFUND movement. Update expected cash projection from ledger, not mutable drawer total. |
| Output                    | Cash movement and updated expected balance.                                                                                                         |
| Permissions               | Cashier for permitted small movements; manager/finance for drops/large adjustments.                                                                 |
| Audit event               | cash_movement.posted.                                                                                                                               |
| Offline behavior          | Hub-local offline.                                                                                                                                  |
| Error behavior            | Closed shift, invalid sign/type, missing reason or duplicate rejected.                                                                              |
| Compensating action       | Post opposite correction movement; never edit original.                                                                                             |
| Canonical test vectors    | TV1: safe drop 200,000 KHR reduces expected drawer. TV2: duplicate key → one drop.                                                                  |
| Owning service            | Cash Service                                                                                                                                        |
| Consuming products        | POS, Partner Portal, Finance, close reports                                                                                                         |

### KBR-SHIFT-005 — Shift handover or assignment change

| Required field            | Canonical specification                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-005                                                                                                                                                  |
| Purpose                   | Transfer operational responsibility without sharing credentials or rewriting prior actions.                                                                    |
| Inputs                    | Open shift; outgoing/incoming employee; count/handover evidence; reason; approval.                                                                             |
| Preconditions             | Handover policy permits; both actors authenticated; register state known.                                                                                      |
| Calculation or transition | Close outgoing accountability segment and open incoming segment, or perform governed register transfer. Preserve device and actor attribution for every event. |
| Output                    | Handover record and active assignment.                                                                                                                         |
| Permissions               | Manager/supervisor approval according to policy.                                                                                                               |
| Audit event               | shift.handover_completed.                                                                                                                                      |
| Offline behavior          | Hub-local; no shared PIN or identity substitution.                                                                                                             |
| Error behavior            | Missing counterparty/count or unresolved variance blocks handover.                                                                                             |
| Compensating action       | Return assignment or close/reopen with correction evidence.                                                                                                    |
| Canonical test vectors    | TV1: cashier A hands to B with verified drawer → two accountability segments.                                                                                  |
| Owning service            | Shift Service                                                                                                                                                  |
| Consuming products        | POS, Partner Portal, audit, Finance                                                                                                                            |

### KBR-SHIFT-006 — Close shift/register

| Required field            | Canonical specification                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-006                                                                                                                                                                 |
| Purpose                   | Reconcile operational activity and close cashier/register session.                                                                                                            |
| Inputs                    | Shift; expected cash; physical count; non-cash tender totals; pending transactions; approvals.                                                                                |
| Preconditions             | Shift OPEN; required transactions finalized/suspended; count captured; blocking exceptions resolved or explicitly approved.                                                   |
| Calculation or transition | Freeze close cutoff, calculate tender summaries, reconcile cash, record variance, obtain approval where needed, and transition CLOSED. Late events are classified separately. |
| Output                    | Close package, variance, tender summary and immutable close state.                                                                                                            |
| Permissions               | Cashier prepares; manager approves exceptions/variance by policy.                                                                                                             |
| Audit event               | shift.close_started/completed/blocked.                                                                                                                                        |
| Offline behavior          | Hub-local and offline-capable. Cloud close projection waits for sync/reconciliation.                                                                                          |
| Error behavior            | Pending ambiguous payments, missing count or unapproved variance blocks completion.                                                                                           |
| Compensating action       | Reopen with reason/approval or post late/correction entries; preserve original close.                                                                                         |
| Canonical test vectors    | TV1: all tenders reconcile → CLOSED. TV2: unresolved KHQR pending → close blocked or explicit policy exception.                                                               |
| Owning service            | Shift and Finance Reconciliation Service                                                                                                                                      |
| Consuming products        | POS, Partner Portal, Finance, reports                                                                                                                                         |

### KBR-SHIFT-007 — Close business day

| Required field            | Canonical specification                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-007                                                                                                                                                                     |
| Purpose                   | Seal the Location operational day after required register and reconciliation checks.                                                                                              |
| Inputs                    | Business day; all shifts/registers; pending transactions/jobs; sync state; close reviewer.                                                                                        |
| Preconditions             | All required shifts closed; local reconciliation complete; exception policy satisfied.                                                                                            |
| Calculation or transition | Create day-close snapshot and transition CLOSING→CLOSED. Cloud settlement or delayed sync may remain separately pending; local close must not falsely claim cloud reconciliation. |
| Output                    | Business-day close package, status and next-day readiness.                                                                                                                        |
| Permissions               | Manager/finance reviewer; reopen restricted.                                                                                                                                      |
| Audit event               | business_day.close_started/completed.                                                                                                                                             |
| Offline behavior          | Hub closes locally. Cloud shows local close with sync/reconciliation status.                                                                                                      |
| Error behavior            | Open shifts, unclassified cash, clock conflict or blocking workflow prevents close.                                                                                               |
| Compensating action       | Reopen day with approval or post prior-period adjustment according to finance rules.                                                                                              |
| Canonical test vectors    | TV1: all shifts closed and local totals balanced → CLOSED. TV2: one open register → blocked.                                                                                      |
| Owning service            | Business Day Service                                                                                                                                                              |
| Consuming products        | Partner Portal, Finance, Admin oversight, reports                                                                                                                                 |

### KBR-SHIFT-008 — Late events and reopen control

| Required field            | Canonical specification                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-SHIFT-008                                                                                                                                                                                                         |
| Purpose                   | Handle events arriving after shift/day close without silently changing approved totals.                                                                                                                               |
| Inputs                    | Late event; original business date; close state; source time; sync evidence; actor.                                                                                                                                   |
| Preconditions             | Target period closed; event valid and not duplicate.                                                                                                                                                                  |
| Calculation or transition | Classify as LATE_EVENT, post with original source/business-date reference and current receipt time, create reconciliation exception. Reopen only under governed permission/approval; otherwise use adjustment period. |
| Output                    | Late-event record, posting and reconciliation/reopen task.                                                                                                                                                            |
| Permissions               | System ingest; finance reviewer controls reopen.                                                                                                                                                                      |
| Audit event               | business_day.late_event_received/reopened.                                                                                                                                                                            |
| Offline behavior          | Common after Hub/cloud reconnect. Local Hub source time and sequence are preserved.                                                                                                                                   |
| Error behavior            | Untrusted clock/order or conflict is quarantined. No automatic closed-total rewrite.                                                                                                                                  |
| Compensating action       | Reconcile, reopen with reason or post current-period prior-period adjustment.                                                                                                                                         |
| Canonical test vectors    | TV1: offline cash sale syncs after cloud day close → late event linked to local closed day.                                                                                                                           |
| Owning service            | Business Time and Finance Services                                                                                                                                                                                    |
| Consuming products        | Hub sync, Finance, Partner/Admin portals, reports                                                                                                                                                                     |

## 4. State models

```text
Business Day: PLANNED -> OPEN -> CLOSING -> CLOSED -> REOPENED -> CLOSED
Shift/Register: CREATED -> OPEN -> COUNTING -> REVIEW_REQUIRED -> CLOSED -> REOPENED
```

Local operational close and cloud/provider reconciliation are distinct statuses. A locally closed day must not be shown as fully reconciled until required synchronized and external sources are complete.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID             | Required value                                                                |
| -------------- | ----------------------------------------------------------------------------- |
| `SHIFT-OD-001` | Final business-day boundary and automatic/manual opening policy per Location. |
| `SHIFT-OD-002` | Blind-count, variance threshold and provisional-close policy.                 |
| `SHIFT-OD-003` | Register/shift relationship and whether T4 may share T1 cash drawer/session.  |
| `SHIFT-OD-004` | Clock drift tolerance and emergency clock-recovery policy.                    |
| `SHIFT-OD-005` | Required local versus cloud/provider sources for each close status.           |

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
