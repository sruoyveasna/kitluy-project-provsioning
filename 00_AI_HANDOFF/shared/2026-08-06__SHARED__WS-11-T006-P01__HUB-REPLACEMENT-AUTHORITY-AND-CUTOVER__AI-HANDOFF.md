# WS-11-T006-P01 — Hub Replacement Authority and Cutover Orchestration

| Field  | Value                                                      |
| ------ | ---------------------------------------------------------- |
| Date   | 2026-08-06 · Asia/Phnom_Penh                               |
| Base   | `4296dfe` (T006 owner decision)                            |
| Status | **P01 COMPLETE — IMPLEMENTED-IN-DEV** (database authority) |
| Push   | NOT PUSHED (disabled posture re-established at intake)     |

## What P01 delivers

**Cloud `0179_hub_replacement_authority`** — `hub_replacement_operations`
(relational lifecycle `requested → approved → replacement_provisioned →
restore_ready → cutover_ready → cutover_committed → old_hub_retired →
completed | cancelled | failed`; every §6 fact a column) + append-only
`hub_replacement_events`, owned by the 0177 fleet governor, FORCE-RLS,
doors-only (fleet service + test harness). Ten doors; the cutover COMPOSES
the existing authority instead of duplicating it: `revoke_device_assignment_v1`
(assignment + terminal assignments revoked, projection dropped, claim events
recorded), `record_device_replacement_v1` for same-Pi NVMe (certificates
revoked, `private_key_carried_over` pinned false, quarantine pending
governed re-enrollment), `quarantine_device_v1` for compromised loss, and a
direct `replaced` transition with `replaced_by_device_id` for full-Pi. The
fleet governor's composition reach (assignments/claims/projections/
certificates/replacements/enrollments + the three doors + `record_claim_event`)
is granted minimally, named, and policy-scoped.

**Hub `0037_hub_replacement_local_state`** — the singleton local mode
(`normal | prepared_inactive | restored_quarantine | retired_rejected`) with
a NOLOGIN `kitluy_replacement_governor`, one governed door
(`set_hub_replacement_mode_v1`), append-only history, and BEFORE-INSERT
gates on `pairing_session`/`terminal_session` (`KLUY-EDGE-HUB-NOT-OPERATIONAL`)
— a prepared or restored Hub refuses operational rows locally with no cloud
round-trip, and a `retired_rejected` Hub can never re-enter service through
the local door (dual-active prevention). Trigger names chosen so the cutover
gate fires before pairing governance; the pairing governor got the gate's
SELECT (the 0035/RC-028 lesson, guard-asserted).

## Invariants proven (cloud section 56, RLS WS11-N22, hub section 34)

Reauthentication + four-eyes with self-approval refused; identity never
cloned (same UUID mandatory for NVMe, NEW UUID mandatory for a replacement
Pi, transfer refused); cross-Tenant/Store registration refused; stale
generation and conflicting idempotency refused; identical retry returns the
original; cutover retry after commit returns `CUTOVER_ALREADY_COMMITTED`
(concurrent callers serialize on the row lock onto the same branch);
approval/eligibility unskippable; exactly ONE live Store Hub left in the
Location (dual-active refused at the door — a structural per-Location unique
would rewrite the multi-hub dev fixtures, recorded honestly for T007);
compromised-loss anchors on an already-revoked assignment (the §2 emergency
shape); unreachable old Hub recorded, not claimed cleaned; cancel-after-
commit and failed-state advancement refused; audit append-only at both the
grant and trigger layers; NVMe operation carries ≥6 transition events.

## Results

Cloud: reset 0000→**0179** from zero, `db:test` **exit 0, 238 PASS**
(section 56 + WS11-N22a/b added). Hub: reset 0000→**0037**, `hub:db:test`
**41 PASS** (section 34 added; tally 66→68 exact). hub-agent registration
suites 42/42 (`HUB_MIGRATION_ORDER` + PASS-count contract 41).

## Recorded

- One-active-Hub-per-Location is DOOR-enforced, not schema-enforced
  (fixtures constraint) — T007 sweep item.
- The Hub-side consumer that maps a received cloud cutover decision onto
  `set_hub_replacement_mode_v1` rides the WS-10 inbox/BLK-006 posture, like
  every cloud→Hub decision before it.
- Rollback: revert the P01 commit; both databases replay from zero.
