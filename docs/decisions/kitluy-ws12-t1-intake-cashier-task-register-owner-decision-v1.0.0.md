# KitLuy WS-12 T1 Intake/Cashier Task Register — Owner Decision v1.0.0

**Filename:** `kitluy-ws12-t1-intake-cashier-task-register-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-06-WS12-TASKS-001
**Date:** 2026-08-06
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — recorded verbatim from the WS-12-T001 owner
package instruction of 2026-08-06.
**Resolves:** the WS-12 title-resolution condition recorded at the WS-11
closeout ("its task titles are not defined in the register and are not
invented here", `000_ACTIVE_PHASE.md` §10 WS-11 CLOSE note).
**Does NOT resolve:** BLK-005 (PKI/hardware evidence — pilot and production
stay BLOCKED), BLK-006 (production provider values and producers), BLK-007
(the 41 non-WS-11 security-plan rows), or any status promotion. This
decision names tasks; it completes none of them.

---

## 1. The ruled task register (LOCKED)

The WS-12 task identifiers carry these titles, in this order. The count of
8 tasks and the task order are locked.

| Task ID    | Authoritative title                                               | Status (maintained)                               |
| ---------- | ----------------------------------------------------------------- | ------------------------------------------------- |
| WS-12-T001 | T1 Runtime, Device Session and Store Hub Bootstrap                | PARTIAL — SUCCESSOR PACKAGE REQUIRED (2026-08-06) |
| WS-12-T002 | Customer Identity, Consent and Booking Draft                      | NOT STARTED                                       |
| WS-12-T003 | Service, Garment, Evidence and Custody Intake                     | NOT STARTED                                       |
| WS-12-T004 | Pricing, Capacity, Due-Time and Booking Confirmation              | NOT STARTED                                       |
| WS-12-T005 | Deposit, Payment, KHQR, Receipt and Tag Issuance                  | NOT STARTED                                       |
| WS-12-T006 | Offline Queue, Synchronization, Printing and Peripheral Recovery  | NOT STARTED                                       |
| WS-12-T007 | T1 Workflow Integration, Localization and End-to-End Verification | NOT STARTED                                       |
| WS-12-T008 | Independent Review, Rebuild Evidence and Closeout                 | NOT STARTED                                       |

## 2. The composition rule (LOCKED)

All WS-12 tasks must REUSE existing shared authorities. **T1 is an
operational client and composition surface, not a new source of Booking,
payment, pricing, customer or audit truth.** Concretely:

- Booking truth stays with the WS-07 Booking aggregate and its Hub/cloud
  persistence; T1 composes it through the governed Store Hub command
  surface, never through direct database access.
- Payment, deposit and reconciliation truth stays with the WS-08
  authorities and `@kitluy/money`; T1 never computes money in floating
  point and never finalizes financial records locally.
- Pricing truth stays with the WS-05 catalog/pricing authorities and their
  signed configuration snapshots.
- Customer identity and consent truth stays with the WS-06 authorities.
- Audit truth stays append-only under the WS-04 registries; T1 emits
  events, it does not own an audit store.
- Device identity, pairing, credential and revocation truth stays with the
  WS-11 authorities (`kitluy_devices`, Hub 0031–0039,
  `@kitluy/device-identity`, `@kitluy/terminal-local-store`).
- The Store Hub is never bypassed for normal Store operations
  (CLAUDE.md hard rule 6); T1 terminals do not write to Supabase.

## 3. Boundaries restated

- The owner-locked T1–T4 Laundry terminal model is preserved
  (`000_ACTIVE_PHASE.md` §2): T1 is POS Cashier / Intake — intake,
  authoritative Booking creation, price, deposit/payment, receipt/tag.
  No three-terminal mapping is acceptable.
- The installer and user can never select or override Tenant, Digital
  Store, Location, Hub, environment, terminal profile or assignment
  generation — those bind through provisioning and pairing (WS-11).
- Pilot and production claims remain BLOCKED by BLK-005/BLK-006 throughout
  WS-12; nothing in this register relaxes a fail-closed gate.
- No task other than WS-12-T008 closes WS-12.

## 4. WS-12-T001 scope fence

> **2026-08-06 T001 close note:** PARTIAL — SUCCESSOR PACKAGE REQUIRED. The
> §5 bootstrap machine, verified discovery resolution, receipt/eligibility
> composition, signed-configuration verification with the NEW terminal-local
> cache, staff evaluation and the fail-closed Electron composition are
> IMPLEMENTED-IN-DEV with 16 acceptance tests (zero skips). PARTIAL because
> no approved `/edge/v1` route serves terminal eligibility, Hub time,
> configuration delivery or staff sessions (owner route-registration and
> permission-key decisions needed), so the runtime cannot reach `ready`
> against a real Hub. Record:
> `00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-12-T001__T1-RUNTIME-DEVICE-SESSION-AND-STORE-HUB-BOOTSTRAP__AI-HANDOFF.md`.

T001 delivers the minimum production-shaped T1 application foundation:
Electron + React + TypeScript on Linux ARM64 / Raspberry Pi OS; the
owner-locked T1 POS Cashier / Intake profile; authenticated Store Hub LAN
operation; offline startup after successful provisioning; staff session
and permission bootstrap; signed configuration loading; authoritative
freshness and failure states. T001 does **NOT** implement customer intake,
Booking creation, pricing, payment, receipts or printing — those belong to
T002–T006.
