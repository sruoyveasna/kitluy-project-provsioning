# KitLuy Laundry State Machines

**Filename:** `kitluy-laundry-state-machines-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines the authoritative Phase 1 Laundry aggregate transitions, including pre-intake, T1 verified intake, production, T3 Ready custody, T4 pickup, issues, service pauses and capacity-based promises.

**Scope boundary:** Phase 1 Laundry delta only. It reuses neutral Core transaction, payment, inventory, customer, finance, configuration and audit contracts.

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

### KBR-LND-001 — Booking creation from verified intake

| Required field            | Canonical specification                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-LND-001                                                                                                                                                                          |
| Purpose                   | Create the authoritative Laundry Booking only after T1 verifies customer and physical garments.                                                                                      |
| Inputs                    | Verified customer; service selections; garment/piece/weight observations; notes/evidence; price snapshot; promised date; idempotency key.                                            |
| Preconditions             | T1 active and assigned; Hub available locally; Digital Store/Location live; services available; customer confirmation captured.                                                      |
| Calculation or transition | Convert verified intake into Booking header, lines, garment/custody records and immutable pricing snapshot in one local transaction. State becomes RECEIVED after successful commit. |
| Output                    | Booking ID/number; tags/receipt payload; totals; status history; outbox events.                                                                                                      |
| Permissions               | T1 Intake permission; supervisor override for defined exceptions.                                                                                                                    |
| Audit event               | laundry_booking.created and garment.custody_received.                                                                                                                                |
| Offline behavior          | Authoritative creation occurs on Store Hub. It remains valid offline and syncs asynchronously.                                                                                       |
| Error behavior            | Validation failure leaves intake draft editable. Print failure does not roll back Booking; it creates a retryable print job.                                                         |
| Compensating action       | Cancel before production through governed cancellation; after production starts use adjustment/issue workflows, never delete.                                                        |
| Canonical test vectors    | TV1: 3 shirts + 2kg wash with valid price snapshot → one RECEIVED Booking. TV2: duplicate submit → same Booking. TV3: unavailable service → reject before commit.                    |
| Owning service            | Laundry Booking Service on Store Hub                                                                                                                                                 |
| Consuming products        | T1, T2, Partner Portal/App, Storefront pre-intake, Notification, reports                                                                                                             |

### KBR-LND-002 — Pre-intake and queue are non-authoritative

| Required field            | Canonical specification                                                                                                                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-002                                                                                                                                                                |
| Purpose                   | Ensure customer-submitted estimates never become authoritative garments, weight, totals or finance without T1 verification.                                                |
| Inputs                    | Pre-intake draft; queue ticket; customer phone/session; requested services; estimates.                                                                                     |
| Preconditions             | Storefront channel authorized; Location accepting queue; draft not expired.                                                                                                |
| Calculation or transition | Store preliminary data and queue position separately. T1 may copy values into verification UI, but authoritative Booking fields are created only from T1-confirmed values. |
| Output                    | Pre-intake/queue records and later link to Booking, or expiry/cancellation.                                                                                                |
| Permissions               | Customer may create/view own tokenized draft; staff can verify within assigned Location.                                                                                   |
| Audit event               | pre_intake.created, queue_ticket.issued, pre_intake.verified/expired.                                                                                                      |
| Offline behavior          | Queue may be cloud-originated and projected to Hub; during WAN outage T1 can continue walk-in intake. Cloud queue freshness is shown explicitly.                           |
| Error behavior            | Expired, duplicate or unverifiable ticket cannot create a Booking automatically.                                                                                           |
| Compensating action       | Expire/reissue ticket; merge duplicate queue entries without merging customer identity automatically.                                                                      |
| Canonical test vectors    | TV1: customer estimates 5kg, T1 measures 6.2kg → Booking uses 6.2kg. TV2: ticket replay → same draft, no duplicate Booking.                                                |
| Owning service            | Laundry Storefront Intake Service                                                                                                                                          |
| Consuming products        | Storefront, Telegram channel, T1, Partner Portal and Notification                                                                                                          |

### KBR-LND-003 — Production state progression

| Required field            | Canonical specification                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-003                                                                                                                                                                                 |
| Purpose                   | Control movement through Received, Washing, Drying, Pressing, QA/Packaging and Ready.                                                                                                       |
| Inputs                    | Booking/garment IDs; current state/version; target state; actor/device; station; timestamp; exception flags.                                                                                |
| Preconditions             | Booking active; custody count valid; transition allowed; actor station permission; no unresolved blocking issue.                                                                            |
| Calculation or transition | Apply only allowed forward transition or explicit governed exception transition. Record status history and per-garment custody/production events. READY requires QA and count verification. |
| Output                    | New Booking/garment state, status event and work-queue projection.                                                                                                                          |
| Permissions               | Laundry staff/supervisor by station; READY confirmation restricted to T3 profile or authorized equivalent.                                                                                  |
| Audit event               | laundry_booking.status_changed; garment.production_stage_changed.                                                                                                                           |
| Offline behavior          | Hub is authoritative. LAN terminals continue; queued cloud notifications wait for sync.                                                                                                     |
| Error behavior            | Illegal transition or stale version rejected. Partial garment completion is represented explicitly, not hidden by Booking-level state.                                                      |
| Compensating action       | Use rework/rewash transition, issue hold, or supervisor-approved correction event; never rewrite history.                                                                                   |
| Canonical test vectors    | TV1: RECEIVED→WASHING allowed. TV2: WASHING→READY direct denied. TV3: all garments pass QA at T3 → READY.                                                                                   |
| Owning service            | Laundry Workflow Service on Store Hub                                                                                                                                                       |
| Consuming products        | T1, T3, POS Mobile, Partner Portal/App, production views, notifications                                                                                                                     |

### KBR-LND-004 — T3 ready scan-in and storage custody

| Required field            | Canonical specification                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-004                                                                                                                                                       |
| Purpose                   | Make T3 the only canonical Clean & Ready scan-in role and preserve storage custody.                                                                               |
| Inputs                    | Booking/garment tags; QA result; package count; storage location; actor/device.                                                                                   |
| Preconditions             | Device assigned T3; production complete; tags valid; no unresolved damage/count block.                                                                            |
| Calculation or transition | Scan each required custody unit, verify count/QA, assign storage location, post custody_scanned_in. When completeness policy passes, transition Booking to READY. |
| Output                    | Ready custody records, storage assignment and READY event.                                                                                                        |
| Permissions               | T3 ready-scan permission; supervisor exception requires reason and audit.                                                                                         |
| Audit event               | garment.custody_scanned_in; laundry_booking.ready.                                                                                                                |
| Offline behavior          | Operates entirely through Hub/LAN. Customer notification is queued until cloud/provider availability.                                                             |
| Error behavior            | Duplicate scans are idempotent; unknown tag, count mismatch or occupied/invalid storage blocks completion.                                                        |
| Compensating action       | Correct storage via linked relocation event; failed QA sends item to rework; count mismatch opens issue case.                                                     |
| Canonical test vectors    | TV1: all 5 tags scanned, QA pass → READY. TV2: one tag missing → remain partially ready/blocked. TV3: repeat same scan → no duplicate custody.                    |
| Owning service            | Laundry Custody Service on Store Hub                                                                                                                              |
| Consuming products        | T3, Partner Portal/App, Notification, reports                                                                                                                     |

### KBR-LND-005 — T4 pickup scan-out and completion

| Required field            | Canonical specification                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-005                                                                                                                                                                                 |
| Purpose                   | Make T4 the only terminal profile authorized to release garments and complete customer pickup.                                                                                              |
| Inputs                    | Booking lookup; collector verification; garment/package scans; outstanding balance status; release evidence; actor/device.                                                                  |
| Preconditions             | Device assigned T4; Booking READY or approved partial-release state; collector verified; required payment settled or approved exception.                                                    |
| Calculation or transition | Verify collector and balance, scan all release units, post custody_scanned_out and pickup completion atomically. Booking becomes PICKED_UP/COMPLETED only when release completeness passes. |
| Output                    | Release record, completed Booking state, receipt/acknowledgement and outbox events.                                                                                                         |
| Permissions               | T4 pickup permission; supervisor approval for partial release, identity exception or payment exception.                                                                                     |
| Audit event               | garment.custody_scanned_out; laundry_booking.picked_up.                                                                                                                                     |
| Offline behavior          | Hub remains authoritative offline. Remote portals cannot complete pickup. Offline payment methods must follow approved tender policy.                                                       |
| Error behavior            | Missing tag, identity failure, unresolved balance or stale/foreign Booking blocks release.                                                                                                  |
| Compensating action       | If incorrect release is discovered, create custody incident and recovery case; never delete release event.                                                                                  |
| Canonical test vectors    | TV1: verified customer, all tags, paid → complete. TV2: Portal attempts pickup → denied. TV3: one package unscanned → no full completion.                                                   |
| Owning service            | Laundry Custody and Booking Service on Store Hub                                                                                                                                            |
| Consuming products        | T4, T2 optional status, Partner Portal/App, Finance, notifications, reports                                                                                                                 |

### KBR-LND-006 — Issue, rewash and damage handling

| Required field            | Canonical specification                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-LND-006                                                                                                                                                  |
| Purpose                   | Represent operational defects without corrupting original Booking or custody history.                                                                        |
| Inputs                    | Booking/garment; issue type; evidence; severity; customer impact; proposed remedy; actor.                                                                    |
| Preconditions             | Actor can raise issue; garment belongs to scoped Booking; reason/evidence rules satisfied.                                                                   |
| Calculation or transition | Create issue case and place affected units on hold. Rewash creates linked rework cycle; damage/loss remedy follows approval and financial adjustment policy. |
| Output                    | Issue record, hold/rework state, customer communication task and optional compensation request.                                                              |
| Permissions               | Staff may report; supervisor resolves; financial compensation follows refund/adjustment approval.                                                            |
| Audit event               | laundry_issue.opened, rewash.started/completed, damage.resolution_approved.                                                                                  |
| Offline behavior          | Issues and rewash operate locally. Media uploads queue with checksum; lack of WAN does not block safe hold.                                                  |
| Error behavior            | Missing evidence for required severity or invalid resolution blocks closure.                                                                                 |
| Compensating action       | Reopen issue with reason; reverse incorrect financial remedy through payment/finance compensation.                                                           |
| Canonical test vectors    | TV1: stain persists at QA → rewash, Booking not READY. TV2: damage claim needs manager approval before refund.                                               |
| Owning service            | Laundry Issue Service                                                                                                                                        |
| Consuming products        | T1/T3/T4, POS Mobile, Partner Portal/App, Files, Payments, Notification                                                                                      |

### KBR-LND-007 — Service availability and emergency pause

| Required field            | Canonical specification                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-007                                                                                                                                                                      |
| Purpose                   | Allow a Location to stop accepting a Laundry service without changing historical Bookings or chain catalog truth.                                                                |
| Inputs                    | Service/offer ID; Location; pause reason; effective time; expiry; actor; current publication version.                                                                            |
| Preconditions             | Service exists and is assigned to Location; actor has availability permission.                                                                                                   |
| Calculation or transition | Create versioned Location availability override. New intake is blocked while existing Bookings continue under their snapshots. Chain/Digital Store definitions remain unchanged. |
| Output                    | Published override, Hub acknowledgement state and visible availability result.                                                                                                   |
| Permissions               | Store manager or authorized supervisor; chain rules may constrain but not erase emergency local safety authority.                                                                |
| Audit event               | service_availability.paused/resumed; configuration.acknowledged.                                                                                                                 |
| Offline behavior          | If Hub receives signed override it enforces locally. If cloud unavailable, approved emergency local pause may be created on Hub and synchronized with conflict review.           |
| Error behavior            | Partial publication is explicit; no assumption that unacknowledged Hub applied the change.                                                                                       |
| Compensating action       | Resume or supersede override. Existing accepted Booking is cancelled only through Booking rules.                                                                                 |
| Canonical test vectors    | TV1: machine failure pauses dry-clean service; new intake blocked, existing work visible. TV2: Hub unacknowledged → portal shows partial.                                        |
| Owning service            | Configuration Publication Service plus Laundry Availability Adapter                                                                                                              |
| Consuming products        | Partner/Chain/Admin portals, T1, Storefront, Hub, reports                                                                                                                        |

### KBR-LND-008 — Promised-ready estimate and capacity truth

| Required field            | Canonical specification                                                                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-LND-008                                                                                                                                                                         |
| Purpose                   | Produce an explainable estimate without presenting it as a guarantee when capacity data is incomplete.                                                                              |
| Inputs                    | Service durations; workload; capacity calendar; cutoff/business date; priority; manual promise; freshness.                                                                          |
| Preconditions             | Required service/capacity configuration available; actor can override when allowed.                                                                                                 |
| Calculation or transition | Calculate earliest feasible ready time from accepted workload and capacity. Mark estimate source/confidence. Manual override requires reason and never rewrites production history. |
| Output                    | Promised-ready snapshot on Booking and later variance metrics.                                                                                                                      |
| Permissions               | T1 may accept suggested promise; manager may override under policy.                                                                                                                 |
| Audit event               | laundry_booking.promise_set/overridden.                                                                                                                                             |
| Offline behavior          | Hub uses locally cached/current workload and capacity. If incomplete, label estimate and use conservative fallback policy.                                                          |
| Error behavior            | Do not fabricate precision. Missing capacity produces explicit manual-confirmation state.                                                                                           |
| Compensating action       | Update customer via governed promise-change event; preserve original promise snapshot for reporting.                                                                                |
| Canonical test vectors    | TV1: capacity supports next-day 17:00 → snapshot. TV2: stale capacity → warning/manual confirmation.                                                                                |
| Owning service            | Laundry Capacity and Booking Service                                                                                                                                                |
| Consuming products        | T1/T2, Partner Portal/App, Storefront, Notification, reports                                                                                                                        |

## 4. Canonical Laundry state model

```text
PRE_INTAKE_DRAFT -> QUEUED -> T1_VERIFICATION
                               |
                               v
RECEIVED -> WASHING -> DRYING -> PRESSING -> QA_PACKAGING -> READY -> PICKED_UP
    |           |          |          |              |
    +---------- issue hold / rewash / approved cancellation ----------+
```

- T2 is the Customer Display Screen and never owns a production transition.
- T3 owns Clean & Ready scan-in.
- T4 owns customer Pickup scan-out and completion.
- Booking-level state is a derived operational summary; garment/custody events remain the detailed evidence.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                                            |
| ------------ | ----------------------------------------------------------------------------------------- |
| `LND-OD-001` | Final named/open Booking policy beyond verified intake and current Storefront pre-intake. |
| `LND-OD-002` | Exact promise/capacity fallback thresholds and customer compensation policy.              |
| `LND-OD-003` | Partial pickup and third-party collector approval policy.                                 |

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
