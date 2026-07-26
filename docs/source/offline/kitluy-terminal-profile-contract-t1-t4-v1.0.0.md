# KitLuy Terminal Profile Contract — T1 to T4

**Filename:** `kitluy-terminal-profile-contract-t1-t4-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Vertical:** Phase 1 — Laundry  
**Status:** Canonical target contract; not implementation evidence

> **Locked model:** T1 POS Cashier / Intake, T2 Customer Display Screen, T3 Clean & Ready Scan-In, T4 Customer Pickup Scan-Out.

## 1. Profile model

T1–T4 are logical, assigned and permissioned profiles of `kitluy-pos-desktop-app`. They are not four independent Suite products. T3 and T4 may share a physical terminal, but their sessions, permissions, workflows and audit events remain separate.

All finalized financial, payment, custody and audit effects are append-only. Corrections use authorized compensating events; a profile must never destructively rewrite historical truth.

## 2. Physical deployment profiles

| Device profile code     | Allowed logical profiles | Typical hardware                                                                         |
| ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| `laundry_front_counter` | T1 + paired T2           | Pi 5 4GB, T1 touchscreen, optional/required T2 display, printers, scanner, scale, drawer |
| `laundry_ready_pickup`  | T3 + T4                  | Pi 5 4GB, touchscreen/display, scanner                                                   |
| `laundry_t1_dedicated`  | T1                       | Dedicated cashier terminal                                                               |
| `laundry_t2_dedicated`  | T2                       | Dedicated customer display client                                                        |
| `laundry_t3_dedicated`  | T3                       | Dedicated Ready station                                                                  |
| `laundry_t4_dedicated`  | T4                       | Dedicated pickup station                                                                 |

Installer cannot self-select profiles. Cloud assignment is delivered in a signed configuration snapshot and enforced by the Store Hub.

## 3. Shared profile gate

Before opening any profile, the Store Hub verifies:

1. terminal certificate and assignment;
2. Tenant, Digital Store and Location;
3. active configuration compatibility;
4. actor identity and offline credential validity;
5. actor permission grants;
6. device profile grants;
7. required peripheral health or approved waiver;
8. current shift/payment policy where applicable;
9. no security quarantine or read-only safety state.

## 4. Permission matrix

| Capability                         |           T1           |        T2         |                T3                 |             T4              |
| ---------------------------------- | :--------------------: | :---------------: | :-------------------------------: | :-------------------------: |
| Search/create customer             |          Yes           |        No         |         Read masked only          |      Read masked only       |
| Create/edit Booking draft          |          Yes           |        No         |                No                 |             No              |
| Confirm intake                     |          Yes           |        No         |                No                 |             No              |
| Capture garment condition/evidence |          Yes           |        No         |        Exception evidence         |  Pickup exception evidence  |
| Select services/pricing            |          Yes           |   Display only    |                No                 |             No              |
| Apply ordinary allowed discount    |          Yes           |   Display only    |                No                 |             No              |
| Request manager approval           |          Yes           |        No         |                Yes                |             Yes             |
| Accept cash payment                |          Yes           |        No         |                No                 |         Conditional         |
| Request KHQR                       |          Yes           | Display QR/status |                No                 |         Conditional         |
| Confirm payment                    | Provider/Hub path only |        No         |                No                 |   Provider/Hub path only    |
| Print receipt/tag                  |          Yes           |        No         | Ready/storage label if configured | Final receipt if configured |
| Mark production Ready              |           No           |        No         |                Yes                |             No              |
| Assign Ready storage               |           No           |        No         |                Yes                |             No              |
| Verify collector                   |           No           |        No         |                No                 |             Yes             |
| Release garments                   |           No           |        No         |                No                 |             Yes             |
| Complete Booking pickup            |           No           |        No         |                No                 |             Yes             |
| View internal notes                |       Need-based       |       Never       |            Need-based             |         Need-based          |
| View other customer data           |       Need-based       |       Never       |              Minimal              |           Minimal           |
| Open cash drawer                   |      Permissioned      |        No         |                No                 |         Conditional         |

## 5. T1 contract

### 5.1 Purpose

T1 creates the authoritative Laundry Booking, captures physical intake, applies approved pricing, records deposit/payment, and requests receipt/tag printing.

### 5.2 Required capabilities

- Staff login and active shift.
- Customer search/create with phone-first normalization.
- Per-piece, per-weight and mixed lines.
- Scale reading with tare/stability evidence.
- Garment/bag/tag capture.
- Stain, damage, note and photo evidence.
- Due date and pickup/delivery selection.
- Price/discount review and approval.
- Cash, deposit, full payment and approved KHQR request.
- T2 customer-safe display session.
- Receipt/tag durable print jobs.
- Controlled void/refund/reprint requests.

### 5.3 Prohibited

- Marking a Booking Ready.
- Releasing garments or completing pickup.
- Confirming KHQR from a displayed QR or customer claim.
- Editing finalized financial/custody history.
- Bypassing Hub to write cloud/local database.

### 5.4 T1 state machine

```text
IDLE
→ ACTOR_AUTHENTICATED
→ SHIFT_READY
→ DRAFT
→ CUSTOMER_SELECTED
→ ITEMS_CAPTURED
→ REVIEW
→ INTAKE_CONFIRMED
→ PAYMENT_OPTIONAL_OR_REQUIRED
→ DOCUMENTS_QUEUED
→ COMPLETE
```

Error/degraded states remain recoverable without creating duplicate Bookings.

### 5.5 Required peripherals

| Peripheral             | Required                                                             |
| ---------------------- | -------------------------------------------------------------------- |
| Operator display/touch | Yes                                                                  |
| Scanner                | Yes for production pilot unless waiver                               |
| Scale                  | Required for per-weight services                                     |
| Receipt printer        | Required unless approved digital-only contingency                    |
| Tag printer            | Required for tag workflow                                            |
| Cash drawer            | Required when cash handling policy enables it                        |
| T2 display             | Required for the standard front-counter profile; dedicated or paired |

## 6. T2 contract

### 6.1 Purpose

T2 is a customer-facing, privacy-safe mirror of the current T1 session. It has no independent operational, financial or custody authority.

### 6.2 Allowed data

- Store identity.
- Current Booking lines, weight and quantities.
- Discounts, tax and totals.
- Deposit, paid amount and balance.
- Current KHQR and payment status.
- Due/pickup date and reference.
- Receipt choice and permitted consent input.

### 6.3 Forbidden data/actions

- Other customers or Booking history.
- Staff PIN, role, internal notes or fraud/security flags.
- Raw provider secrets or full payment payloads.
- Price/discount changes.
- Payment confirmation.
- Production, storage or pickup actions.

### 6.4 T2 state machine

```text
IDLE
→ SESSION_BOUND
→ INTAKE_MIRROR
→ REVIEW
→ PAYMENT_REQUESTED
   → KHQR_PENDING | CASH_PROCESSING
   → PAYMENT_CONFIRMED | PAYMENT_FAILED_OR_EXPIRED
→ RECEIPT_CHOICE
→ PICKUP_REFERENCE
→ THANK_YOU
→ PRIVACY_RESET
→ IDLE
```

### 6.5 Privacy reset triggers

- T1 completes/cancels the session.
- Actor/profile switch.
- Hub or T2 reconnect without current session proof.
- Idle timeout.
- Application restart.
- Certificate/profile invalidation.

T2 must never restore the previous customer from a generic UI cache.

## 7. T3 contract

### 7.1 Purpose

T3 verifies cleaned garments/packages, QA, count and storage, then creates the custody transition to Ready.

### 7.2 Required flow

1. Authenticate T3 actor.
2. Scan Booking/bag/garment.
3. Resolve expected items and eligibility.
4. Verify count.
5. Complete QA and packaging checks.
6. Record missing, extra, damage, mismatch or rewash exceptions.
7. Scan/select storage position.
8. Commit storage and custody in one transaction.
9. Mark eligible Booking/group Ready.
10. Queue notification request without claiming delivery.

### 7.3 Ready blockers

- Missing expected item.
- Extra/unidentified item.
- Failed QA or required rewash.
- Unresolved blocking damage/mismatch.
- Duplicate/wrong Booking scan.
- Invalid/occupied storage position.
- Incompatible Booking state.

### 7.4 Prohibited

- Collecting final payment.
- Releasing garments.
- Completing pickup.
- Treating T3 as T2 customer display.

### 7.5 T3 state machine

```text
IDLE
→ SESSION_OPEN
→ BOOKING_RESOLVED
→ SCANNING
→ QA
→ STORAGE_ASSIGNMENT
→ READY_EVALUATION
→ READY_COMMITTED
→ COMPLETE
```

## 8. T4 contract

### 8.1 Purpose

T4 verifies the collector, retrieves and scans the correct items, enforces remaining-balance policy, records custody release and completes pickup.

### 8.2 Required flow

1. Authenticate T4 actor.
2. Scan/search pickup reference.
3. Verify Booking is Ready and display storage positions.
4. Verify collector according to policy.
5. Retrieve and scan every expected item.
6. Resolve wrong/duplicate/missing scans.
7. Enforce payment gate.
8. Obtain action-scoped approval for exceptional release when policy allows.
9. Confirm handover.
10. Atomically release custody, clear storage and complete Booking.
11. Print/send final receipt when configured.

### 8.3 Payment at T4

- Default target permits cash/KHQR only when terminal device, actor, shift, peripherals and policy explicitly grant it.
- Otherwise T4 enters `PAYMENT_HANDOFF_REQUIRED` and sends the customer to T1.
- Garments remain in custody until payment is confirmed or an authorized release override is committed.
- Offline card capture is prohibited.

### 8.4 Prohibited

- Marking garments Ready.
- Editing T3 QA/storage history.
- Releasing against pending KHQR.
- Completing pickup with missing scans without approved exception.

### 8.5 T4 state machine

```text
IDLE
→ SESSION_OPEN
→ PICKUP_REFERENCE_RESOLVED
→ COLLECTOR_VERIFICATION
→ RETRIEVAL_SCANNING
→ PAYMENT_GATE
→ HANDOVER_REVIEW
→ RELEASE_COMMITTED
→ COMPLETE
```

## 9. Shared-device mode switching

When T3 and T4 share hardware:

1. Actor explicitly exits current mode.
2. Hub closes/locks active workflow or records controlled handoff.
3. Temporary Booking, collector and approval data are cleared.
4. One-shot approvals are invalidated.
5. New actor/profile permission is evaluated.
6. UI clearly changes profile name, color/iconography and primary action language.
7. Profile switch audit event is emitted.

The application may not expose a hidden shortcut that bypasses this gate.

## 10. Actor switching and approvals

- One actor session is visibly active.
- Staff switch clears sensitive temporary data unless a controlled handoff is recorded.
- Manager elevation is action-scoped, target-bound, time-limited and single-use.
- Requester and approver are distinct where four-eyes policy requires it.
- Offline approval is allowed only when the projected policy, cached approver credential and action type permit it.
- Sensitive approval syncs to immutable cloud audit later.

## 11. LAN API scopes

| Profile | Primary scopes                                                                                                                                                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1      | `customer.read_local`, `customer.create_local`, `laundry.booking.create`, `laundry.booking.edit_draft`, `laundry.booking.confirm_intake`, `payment.cash.accept`, `payment.khqr.request`, `document.print`, `file.capture` |
| T2      | `display.session.read`, `display.customer_action.submit`                                                                                                                                                                  |
| T3      | `laundry.ready.start`, `laundry.ready.scan`, `laundry.ready.qa`, `laundry.storage.assign`, `laundry.ready.complete`, `laundry.exception.create`                                                                           |
| T4      | `laundry.pickup.start`, `laundry.pickup.verify_collector`, `laundry.pickup.scan`, `laundry.pickup.complete`, conditional `payment.accept_at_pickup`, `laundry.exception.create`                                           |

Backend authorization evaluates explicit permission grants, device profile, resource scope, environment, approval and active configuration. Frontend visibility is not authorization.

## 12. Offline behavior matrix

| Capability                | WAN down, Hub up                                      | Hub down                         |
| ------------------------- | ----------------------------------------------------- | -------------------------------- |
| T1 Booking intake         | Continue                                              | Block normal operation           |
| Cash/deposit              | Continue                                              | Block                            |
| KHQR request/confirmation | Follow provider policy; never fabricate confirmation  | Block                            |
| T1/T2 mirror              | Continue over LAN                                     | Clear/degraded                   |
| Receipt/tag print         | Continue through Hub queue                            | Block/new jobs unavailable       |
| T3 Ready                  | Continue                                              | Block                            |
| T4 pickup                 | Continue if payment/identity policy satisfied locally | Block                            |
| Files                     | Store locally and queue upload                        | Terminal cache not authoritative |
| Staff login               | Cached valid credential                               | No trusted authority             |

An optional bounded terminal cache for brief Hub loss is outside this v1 contract unless separately approved.

## 13. Data freshness labels

Terminals show distinct states:

- `Hub connected / cloud synced`.
- `Hub connected / cloud sync delayed`.
- `Hub connected / provider unavailable`.
- `Hub unreachable`.
- `configuration update delayed`.

“Offline” must not ambiguously combine WAN and Hub failure.

## 14. Required audit events

### T1

```text
terminal.profile_entered
laundry.booking_draft_created
laundry.booking_intake_confirmed
laundry.custody_intake_recorded
payment.cash_recorded
payment.khqr_requested
document.print_requested
document.reprint_requested
```

### T2

```text
display.session_bound
display.customer_confirmation_recorded
display.receipt_choice_recorded
display.privacy_reset
```

### T3

```text
laundry.ready_scan_started
laundry.item_ready_scanned
laundry.ready_count_verified
laundry.qa_recorded
laundry.storage_position_assigned
laundry.booking_marked_ready
```

### T4

```text
laundry.pickup_scan_started
laundry.collector_verified
laundry.item_pickup_scanned
laundry.pickup_payment_gate_passed
laundry.custody_released
laundry.booking_picked_up
laundry.storage_position_cleared
```

Each event includes actor, device, profile, Location, session, time, sequence and reason/approval where applicable.

## 15. Error and recovery UX

- Duplicate scan: show accepted item and do not add count again.
- Wrong Booking item: block and show safe identifying context.
- Version conflict: refresh aggregate, preserve unsent user input where safe.
- Printer failed: Booking remains committed; show queued/failed print recovery.
- Scale unstable: prevent silent capture; allow reasoned manual fallback if permitted.
- Provider pending: keep payment visibly pending.
- Hub reconnect: retry same idempotency key and return original outcome.
- Security/profile mismatch: exit profile and require support/admin resolution.

## 16. Profile-specific acceptance tests

### T1

- Per-weight and per-piece Booking works offline.
- Cash payment and outbox are one transaction.
- Duplicate confirmation creates one Booking.
- Receipt/tag retry does not duplicate without explicit reprint.
- T1 cannot mark Ready or release custody.

### T2

- Previous customer's data is cleared on every reset trigger.
- T2 cannot call mutation/payment/custody routes.
- Stale QR/payment result cannot reappear after reconnect.
- Khmer and English layouts fit critical totals and consent text.

### T3

- Missing/QA-blocked Booking cannot become Ready.
- Concurrent storage assignment does not double-book.
- Duplicate scan is harmless.
- T3 cannot collect payment or complete pickup.

### T4

- Wrong collector/item/payment state blocks release.
- Release, storage clear and Booking completion are atomic.
- Pending KHQR blocks release.
- T4 cannot change QA or Ready history.

### Shared device

- Profile switch clears temporary data and approvals.
- Actor/profile permission intersection is enforced.
- Audit identifies exact logical profile even when hardware is shared.
