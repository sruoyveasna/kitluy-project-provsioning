# AI Handoff — WS-11-T002 · Hub claim, scope resolution and assignment (Cycle 10)

| Field           | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Task ID         | WS-11-T002                                                  |
| Date / timezone | 2026-07-28 · Asia/Phnom_Penh                                |
| Repository root | C:/dev/HET-KITLUY-PROJECT                                   |
| Status claimed  | **WS-11 — SCAFFOLDED / IN PROGRESS** (T002 of 8)            |
| Blocker         | **BLK-005 OPEN.** Production activation and signer BLOCKED. |

## Authority applied

- Cycle 10 T002 owner instruction (2026-07-28): the two residual controls, the
  eleven permitted capabilities, the activation boundary and the seventeen
  required adversarial tests.
- `docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md`
  §5 provisioning sequence, §8 clone defense, §10 revocation triggers.
- KLD-2026-07-21-003 (OWNER-LOCKED provisioning chain), preserved unchanged.
- Repository rule 2 (neutral Core carries no vertical vocabulary), rule 4
  (no secrets — the claim token is never stored), rule 11 (append-only).

## Files created / changed

| File                                                                      | Change                                       |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `supabase/migrations/20260728130121_0121_device_claim_and_assignment.sql` | NEW — 5 relations + `awaiting_trust`         |
| `supabase/tests/assertions.sql`                                           | +section 29 (29a-29e); 28j and 28k updated   |
| `supabase/tests/rls-tests.sql`                                            | +WS11-N5..N7, WS11-P2                        |
| `packages/device-identity/src/index.ts`                                   | lifecycle matrix, claim/assignment types     |
| `packages/device-identity/test/device-identity.test.ts`                   | 29 tests (5 new)                             |
| `docs/evidence/phase1/ws-11/WS-11-T002-EXECUTION-EVIDENCE.md`             | NEW                                          |
| authority registers, `000_ACTIVE_PHASE.md`, `000_CURRENT_STATE.md`        | T002 rows, KLRISK-DEVICE-001, C38-C40, D7-D9 |

## Commands executed (with actual results)

| Command                                      | Result                                         |
| -------------------------------------------- | ---------------------------------------------- |
| `pnpm db:reset` (from zero)                  | PASS — 0121 applied last                       |
| `pnpm db:test`                               | PASS — **149** `NOTICE:  PASS` (140 + 9)       |
| `pnpm test:rls`                              | PASS — **104** (100 + 4)                       |
| `pnpm hub:db:reset` + `hub:db:test`          | PASS — 27 migrations / **35** (run SEPARATELY) |
| `pnpm --filter @kitluy/device-identity test` | PASS — **29 passed**                           |
| `pnpm verify`                                | **PASS — 11/11**                               |
| `pnpm docs:verify`                           | **PASS — 8/8**                                 |

## Decisions made

None binding the owner. Engineering choices, all recorded in the evidence:
reuse and recovery are distinguished by the redeeming device identity; the
terminal profile key is validated structurally rather than enumerated, so
neutral Fleet carries no Laundry vocabulary; `store_location_id` is denormalised
onto terminal assignments so the wrong-Location case is a constraint.

## Conflicts discovered

- **C38** — claim expiry evaluated against transaction-start `now()`.
- **C39** — assignment generation reusable after revocation.
- **C40** — a re-created view silently lost its service grant.
- **D7-D9** — `kitluy_devices` T002 relation deviations from the DD.
- **Cross-Location is not a distinct hop** in this data model; recorded plainly
  rather than manufacturing a third error code. A TEST defect was found here,
  not a code defect.

## Required values discovered

None new. G12 (trusted time) remains the hard dependency, carried as BLK-005
ballot item 11.

## Security findings

- **KLRISK-DEVICE-001 closed structurally.** `attempt_activate_device_v1` is the
  only granted activation path and records the refusal before returning it; the
  raising form is revoked from `public` and `service_role`.
- **Duplicate evidence now blocks activation, claim creation and redemption**,
  and both identities are held. Residual: an enrollment-station actor can
  quarantine a live device this way. Runbook mitigation OWED.
- All seventeen adversarial cases refuse with their own codes.

## Known limitations

See evidence §7. In short: no activation is possible; the offline projection is
necessarily empty; no production caller exists; concurrency is proven by
constraint rather than by racing sessions (owed to T007); claim tokens are
generated outside the database by a generator that does not exist yet.

## Current implementation status (evidence register delta)

`WS-11` — **SCAFFOLDED / IN PROGRESS** (T002 of 8). Does not advance to
`IMPLEMENTED-IN-DEV` and cannot while BLK-005 is open.

## Recommended next task

**Rule BLK-005.** Per the owner's instruction, T003 (certificate issuance,
signer custody, production activation) does not begin until the twelve-item
ballot is approved. The eight most urgent items are listed in
`000_ACTIVE_PHASE.md` §10.

The push url remains disabled. This work is committed locally and held.
