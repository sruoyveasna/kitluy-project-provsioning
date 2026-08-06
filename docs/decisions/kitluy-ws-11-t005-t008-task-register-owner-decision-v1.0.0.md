# KitLuy WS-11 Remaining Task Register — Owner Decision v1.0.0

**Filename:** `kitluy-ws-11-t005-t008-task-register-owner-decision-v1.0.0.md`
**Decision ID:** KLD-2026-08-06-WS11-REMAINING-TASKS-001
**Date:** 2026-08-06
**Owner:** HET / KitLuy Suite Project Owner
**Status:** OWNER-APPROVED — recorded verbatim from the WS-11-T005 owner
package instruction of 2026-08-06.
**Resolves:** the WS-11-T005..T008 title-resolution blocker recorded by the
WS-11-T004 formal closeout (§10) and by the discovery record
`00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-11-T005-T008__AUTHORITATIVE-TASK-DISCOVERY__AI-HANDOFF.md`
(the "no register names a title" condition).
**Does NOT resolve:** BLK-005 (PKI/hardware evidence — pilot and production
stay BLOCKED), BLK-006 (production provider values), BLK-007 (canonical
security test plans), the disabled rotation mode (0129), or any status
promotion. This decision names tasks; it completes none of them.

---

## 1. The ruled task register (LOCKED)

The four remaining WS-11 task identifiers carry these titles, in this order.
The count of 8 tasks and the task order are unchanged.

| Task ID    | Authoritative title                                                     |
| ---------- | ----------------------------------------------------------------------- |
| WS-11-T005 | Device Fleet Health, Support Access and Incident Containment            |
| WS-11-T006 | Store Hub Replacement, Recovery and Signed Release Lifecycle            |
| WS-11-T007 | Device Security, Offline, Recovery and Concurrency Verification         |
| WS-11-T008 | Independent WS-11 Review, Evidence Reconciliation and Closeout          |

## 2. Mapping to the owner dependency order (`000_ACTIVE_PHASE.md` §10)

| Task | Dependency-order steps covered                                             |
| ---- | -------------------------------------------------------------------------- |
| T005 | step 10 (device health, fleet status and support access) + the containment portion of step 13's subject matter as IMPLEMENTATION (KLRISK-DEVICE-002) |
| T006 | step 9 (signed configuration and release trust), step 11 (Hub replacement, NVMe replacement and recovery), step 12 (release-channel eligibility and rollback authorization) |
| T007 | step 13 (security, offline, recovery and adversarial tests) — including the recorded debts: the T002 claim-redemption race and the Step-2 trusted-time race |
| T008 | step 14 (independent review and evidence) — including the T001/T002 independent-review backfill |

Step 8 (production signing-key custody for WS-10) remains fully
BLK-005-blocked and is assigned to NO agent task; it stays `[REQUIRED: ...]`
and fail-closed.

## 3. Placement of previously unassigned work (per the discovery record §5)

- **KLRISK-DEVICE-002** (restricted-investigation state, station containment,
  runbook) is assigned to **T005** for implementation and focused testing.
  Its independent-verification half is discharged by T007 (adversarial
  verification) and T008 (independent review); the risk may be recorded
  RESOLVED-IN-DEV at T005 close but is not fully CLOSED until T008.
- **Rotation mode (0129, DISABLED pending owner decision)** stays a separate
  owner decision; it is NOT silently folded into any of these tasks.

## 4. Boundaries restated

- The maximum WS-11 promotion at the end of Cycle 10 remains
  **IMPLEMENTED-IN-DEV** (owner fence, unchanged).
- No task in this register may claim pilot or production readiness while
  BLK-005 evidence is absent.
- T005 does not implement Hub replacement or signed-release deployment
  (T006's scope). T006 does not run the adversarial matrix (T007's scope).
  No task other than T008 closes WS-11.
