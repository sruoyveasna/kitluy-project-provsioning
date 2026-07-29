# Governed revocation and approved key destruction — AI Handoff (Phase 1 checkpoint)

| Field           | Value                                                                                                   |
| --------------- | ------------------------------------------------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Master assignment, Phase 1 (Prompt 3D)                                              |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                                                            |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                                                             |
| Starting SHA    | `351fe93`                                                                                               |
| Checkpoint SHA  | `29d7f00`                                                                                               |
| Status          | **PARTIAL — database layer implemented and proven; service layer, live tests, Phases 2 and 3 NOT done** |

## The finding that shaped this phase

The master assignment assumed KLREQ-031 was owner-approved. It was not. The
decision document was present in the working tree but **untracked**, its own
header read `Status: OWNER-APPROVAL REQUIRED`, its §17 said the status becomes
OWNER-APPROVED only after the owner approves, and the open-decisions register
still carried KLREQ-031 as OPEN with no approval record anywhere.

The owner was asked and **approved it as written**, without amendment. That
approval was recorded in the repository (`8da15f2`) BEFORE any code was built on
it, so the authority exists as a committed fact rather than as an assertion made
afterwards.

This matters for anyone auditing later: the implementation below is downstream
of a recorded approval, not of a conversational assumption.

## What is implemented

**Group 0136 — governed credential revocation and recovery disposition.**

`credential_state` has carried `revoked` since group 0125 and the verifier has
refused a revoked credential since Step 2. Nothing could put a credential into
that state — KLRISK-DEVICE-007, open since Prompt 2B-2.

- `device_credential_revocations` — append-only authoritative evidence: which
  credential, generation and fingerprint, why, who asked, who approved, under
  what incident, from when, and what recovery is owed.
  `device_credentials.state` carries the derived fact the verifier reads.
- The credential is resolved from the DEVICE and GENERATION, never from the
  caller, so a revocation cannot repudiate another device's credential.
- Idempotent per revocation intent. A DIFFERENT intent against an
  already-revoked credential returns `MANUAL_REVIEW_REQUIRED` rather than
  overwriting the first account of why it happened.
- Four-eyes runs against the SAME `kitluy_auth` approval aggregate group 0124
  uses — A3/A4 risk class with undeclared insufficient, action and scope match,
  unexpired window, non-self-approval, quorum from immutable decision rows,
  single-use consumption.
- `recovery_disposition` is NOT NULL, and every disposition except
  `NO_RECOVERY` opens a durable `device_recovery_cases` row. Executing recovery
  belongs to later WS-11 tasks, so `replacement_credential_id` is never written
  here.
- No owner decision names which revocation reasons may skip four-eyes, so the
  policy ships requiring it for EVERY reason; exempting one requires naming a
  decision (CHECK). Recorded as `[REQUIRED: device_credential_revocation_approval_policy]`.

**Group 0137 — the approved destruction workflow.**

Implements KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 verbatim: 30/7/14-day
retentions, 24-hour approval validity, 5 attempts, four-eyes required,
`automatic_provider_destruction = false`.

- **The invariant the decision turns on is a CHECK:** the database cannot record
  a confirmed destruction without a verified provider result AND a receipt
  digest or correlatable response (§12). `confirm_key_destruction_v1` marks the
  key destroyed only after evidence lands.
- The eligibility function always returns `authorized = false`. Eligibility is a
  fact about the fleet; authorization is two people.
- Unknown states fail closed — absent overlap end, absent abandonment time and
  absent verified terminal recovery are blockers, not zeros.
- Approval is re-evaluated at approval time rather than trusted from the
  request: a hold placed after the request, or a changed fingerprint, stops it.
- Placing a hold suspends approvals that already exist; releasing one resumes
  nothing.

**The defect the owner's approval exposed.** `evaluateKeyDestruction` computed
`authorized` from the POLICY FLAG alone. That expression could only ever be
false while the policy was disabled, so for as long as nobody could see it, it
looked correct. The moment the approval enabled the policy it began reporting
`authorized: true` for a key with **no destruction request and no approval** —
exactly the bypass §6 and §7 exist to prevent.

Nothing could act on it (the cleanup handler has no destroy call and never had
one), but the lifecycle service, the classifier and the job handler all read
that field. Authorization now requires an approval that exists, is approved,
names a human other than the requester, and has not expired against trusted
time; absent evidence is not authorization, and a missing clock fails closed.
Nine unit tests are the regression suite, including the expiry boundary proven
on both sides.

Three consequences were fixed with it: trusted time is now passed at all three
call sites (without it every evaluation failed closed for ever, making the
approved workflow permanently unreachable); the refusal reason names WHICH
condition is absent instead of always claiming a missing owner decision, because
that sentence goes into durable evidence; and the retention values are
re-checked in TypeScript rather than left to the database CHECK alone.

**A real defect found by the state investigation and fixed here:** group 0128's
key-transition trigger permitted `generated -> destroyed` and
`active -> destroyed`, and group 0130 added `credential_issued_pending_activation`
without any transition edge. Decision §10 forbids both. Either was a single
UPDATE that skipped the whole four-eyes workflow. The function is replaced
additively; 0128 is not rewritten.

## Evidence at this checkpoint

| Gate                                 | Result                                                  |
| ------------------------------------ | ------------------------------------------------------- |
| `db:reset` → `db:seed` → `db:test`   | **184 PASS**, exit 0, from zero including 0136 and 0137 |
| `test:rls`                           | **104 PASS**                                            |
| `@kitluy/device-identity`            | **628 passed / 0 skipped** (26 files)                   |
| `typecheck` / `lint` / `secret:scan` | all pass                                                |
| Migration-local hostile assertions   | 0136 and 0137 both pass; a failure aborts the migration |
| Sections 39a / 40b                   | Rewritten — see below                                   |

**A flake worth recording rather than burying.** One full device-identity run
reported `Worker exited unexpectedly` with 621 of 628 tests executed; two
consecutive re-runs gave 628/628. That is a transient vitest worker crash under
the connection load of the live suites, not an assertion failure — but a run
that silently reports fewer tests than it has is exactly the kind of green
nobody should trust, so it is named here rather than left for someone to
rediscover.

Section 39a previously asserted that NO destruction policy existed. That is no
longer true, so it now asserts the policy is EXACTLY the approved one and cannot
be weakened: the §15 values by number, automatic destruction refused, four-eyes
undroppable while enabled, no confirmation without provider evidence, no
self-approval, no self-release of a hold, and `active`/`generated` keys no
longer directly destroyable. Section 40b's "the job runtime enabled key
destruction" check is corrected the same way — enabled is no longer the defect,
so it now proves the worker cannot touch policy, requests or holds.

A regression caught by the EXISTING suite during this phase: group 0136 first
kept the governor membership it borrows at the top, leaving the login-capable
migration role able to `SET ROLE` to the credential governor permanently.
Section 32 caught it; the membership is now handed back as 0133 and 0134 do.

## NOT done — the honest remainder

This is a checkpoint, not a completion. Per the master assignment's own rule,
none of the following may be called implemented:

**Phase 1 remainder**

- ~~TypeScript revocation service and its unit tests~~ — DONE (27 unit tests).
- TypeScript destruction service (request / approve / execute / confirm / hold).
- Provider destruction in the development key provider, with receipt evidence.
- Worker job kinds: revocation execute, recovery disposition, destruction
  execute, destruction reconcile.
- **§14 hostile live tests — none written yet.** The two migrations are proven
  by their own assertions and by `db:test`; there is no live end-to-end
  evidence that a revocation refuses a renewal, that overlap cannot bypass
  revocation, that an expired approval cannot execute, that provider failure
  leaves the database non-destroyed, or that two workers cannot execute one
  destruction.

**Phase 2** — KLRISK-DEVICE-003 containment suite, the full lifecycle matrix,
the cross-layer security regression and the true-concurrency suite: not started.

**Phase 3** — independent hostile review: not started.

## Status statements that remain TRUE

- `KLRISK-DEVICE-003` — **OPEN**. Untouched by this phase.
- `KLRISK-DEVICE-007` — the governed revocation it named now EXISTS in the
  database, but the risk is **NOT closed**: there is no service layer, no live
  test, and no independent review of it yet.
- `KLREQ-031` — **RESOLVED / OWNER-APPROVED**.
- Provider-key destruction — **SPECIFIED AND IMPLEMENTED IN THE DATABASE,
  NOT YET TESTED OR REVIEWED.** Not promotable.
- WS-11-T003 Step 4 — **NOT COMPLETE.** WS-11 stays SCAFFOLDED / IN PROGRESS.
- Push remains disabled.

## Recommended next step

Phase 1 remainder, starting with the service layer and the §14 hostile live
tests, then Phase 2, then a fresh independent reviewer for Phase 3.
