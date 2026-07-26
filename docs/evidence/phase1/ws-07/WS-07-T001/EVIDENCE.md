# WS-07-T001 evidence package

| Field       | Value                                                                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task        | WS-07-T001 — Booking lifecycle + production state machines                                                                                                |
| Date        | 2026-07-26 · env: local dev (macOS, Node 22.23.0, pnpm 9.15.9)                                                                                            |
| Authority   | kitluy-transaction-and-booking-lifecycle-v1.0.0.md §4/KBR-TXN-*; kitluy-laundry-state-machines-v1.0.0.md §4/KBR-LND-001..006 (owner-canonical, SPECIFIED) |
| Feature IDs | KLMF-LND-002..005, 008..010; KLMF-TXN-002/005                                                                                                             |

## Changed paths

verticals/phase1-laundry/src/booking-lifecycle.ts (new),
src/production-state-machine.ts (new), src/index.ts (exports +
REQUIRED_LAUNDRY_DECISIONS reduced by the two satisfied entries),
test/booking-lifecycle.test.ts (21 tests), test/production-state-machine.test.ts
(29 tests + RV-001 denial test).

## Test evidence (executed locally 2026-07-26)

`pnpm --filter @kitluy-verticals/phase1-laundry test` → **3 files, 65/65 pass**
(14 pre-existing + 51 new). `typecheck` clean; `build` clean; repo-wide
`pnpm lint` clean; repo-wide typecheck 80/80 tasks.

## Independent review (four-eyes: custody-affecting)

00_AI_HANDOFF/reviews/2026-07-26__WS-07-T001__REVIEW.md — verdict
**PASS-WITH-CONDITIONS**, 7 findings, none blocking. Condition RV-001
(missing KBR-LND-005 release-completeness precondition on the T4 guard)
**applied post-review**: `releaseCompletenessVerified` added to
`T4ReleaseInput`, enforced in `releaseCustody`, denial test added
(65th test). RV-002 (deep-freeze) and RV-003 (service-layer vector mapping)
remain open recommendations; RV-007 (T1_VERIFICATION→RECEIVED as aggregate
creation) flagged for G1 confirmation.

## Contract ambiguities recorded (not resolved in code)

Six items (ISSUE_HOLD resume path, OPEN vocabulary vs diagram, exception-band
re-entry, pre-intake expiry state, lowercase branch labels, prefixed function
naming) — listed in the WS-07-T001 review and implementer report; candidates
for G1 contract clarification.

## Status claim

Code: **SCAFFOLDED → remains SCAFFOLDED under the owner model** (real tested
domain behavior; IMPLEMENTED-IN-DEV requires applied dev migrations +
reproducible dev deployment — blocked by BLK-002). No higher status claimed.
