# WS-11-T005..T008 — authoritative task discovery record

| Field     | Value                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date      | 2026-08-06 · Asia/Phnom_Penh                                                                                                                                                 |
| Base SHA  | `7ef384c` (main, clean, push `disabled://push-requires-owner-approval`)                                                                                                      |
| Package   | WS-11-T005-DISCOVERY — discovery only; **no implementation, no migrations, no runtime changes, nothing pushed**                                                              |
| Precedent | `2026-08-01__SHARED__WS-11-T004__TASK-DISCOVERY__AI-HANDOFF.md` and `2026-08-03__SHARED__WS-11-T004__AUTHORITATIVE-TASK-DISCOVERY__AI-HANDOFF.md` (the T004 discovery cycle) |

## 1. Repository state (verified)

HEAD `7ef384c` (WS-11-T004 formal closeout), branch `main`, tree clean, push
disabled. WS-11-T004: IMPLEMENTED-IN-DEV (evidence register row, 2026-08-05).
WS-11-T005..T008: NOT STARTED (T004 closeout §10; `000_INDEX.md` row for the
closeout; `000_CURRENT_STATE.md`). Cloud migrations 0120–0176; Hub 0000–0034.

## 2. Verdict summary

| Task       | Exact authoritative title        | Status      | Role anchor in repository records                                   |
| ---------- | -------------------------------- | ----------- | ------------------------------------------------------------------- |
| WS-11-T005 | **UNRESOLVED — no title exists** | NOT STARTED | none — see §5                                                       |
| WS-11-T006 | **UNRESOLVED — no title exists** | NOT STARTED | none — see §5                                                       |
| WS-11-T007 | **UNRESOLVED — no title exists** | NOT STARTED | AUTHORITATIVE role anchor: concurrency/adversarial test debts (§6)  |
| WS-11-T008 | **UNRESOLVED — no title exists** | NOT STARTED | AUTHORITATIVE role anchor: independent review + evidence debts (§7) |

No task title is invented here. The T004 precedent (2026-08-03 record §2) found
the same condition for T004 — "no register contains a literal title" — and it
holds for all four remaining identifiers.

## 3. Every location searched (all at `7ef384c`)

1. `00_AI_HANDOFF/000_INDEX.md` — full grep sweep for `WS-11-T00[5-8]`;
   the only hit is the T004 closeout row recording "NEXT: WS-11-T005..T008 are
   NOT STARTED and their titles are NOT RESOLVED from the current register".
2. `00_AI_HANDOFF/000_CURRENT_STATE.md` — WS-11 matrix row + 2026-08-05
   refresh block. No T005..T008 titles.
3. `00_AI_HANDOFF/000_ACTIVE_PHASE.md` — §10 Cycle-10 fence, the owner-locked
   provisioning chain (KLD-2026-07-21-003) and the 14-step dependency order.
   Steps, not task titles.
4. `00_AI_HANDOFF/000_BLOCKERS.md` — BLK-001..008. No task titles.
5. `00_AI_HANDOFF/tasks/` — **the formal task-file register contains NO WS-10
   or WS-11 task files at all** (series ends at WS-09-T007). WS-11 tasks were
   issued as owner instructions, never as repo task files.
6. `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004__FINAL-CLOSEOUT__AI-HANDOFF.md`
   §10 — records the unresolved-title condition and requires this discovery.
7. `00_AI_HANDOFF/shared/2026-08-03__SHARED__WS-11-T004__AUTHORITATIVE-TASK-DISCOVERY__AI-HANDOFF.md`
   — the T004 title was DERIVED (dependency-order step 6), not read from any
   register.
8. `00_AI_HANDOFF/shared/2026-08-01__SHARED__WS-11-T004__TASK-DISCOVERY__AI-HANDOFF.md`
   — enumerates the master-plan pillars "not yet covered by any task record".
9. `00_AI_HANDOFF/data/2026-07-28__DATA__WS-11-T001-CYCLE10__DEVICE-ENROLLMENT-AND-IDENTITY__AI-HANDOFF.md`
   and `...WS-11-T002-CYCLE10__CLAIM-SCOPE-AND-ASSIGNMENT__AI-HANDOFF.md` —
   origin of the "T00n of 8" count (the Cycle-10 owner instruction of
   2026-07-28, which is cited as authority but is NOT itself a repository
   file); carry the T007/T008 debt anchors.
10. `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
    — WS-11 rows (T001, T002, T003 steps/overall, T004 overall). No
    T005..T008 rows exist.
11. `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` —
    no decision names a T005..T008 title.
12. `docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md` —
    KLREQ-029..034 + T004-P04A values; none is a task-title ruling.
13. `docs/source/owner-instructions/kitluy-phase1-laundry-master-build-plan-v1.0.0.md`
    §WS-11 — a workstream CONTRACT (objective, scope, schema objects, tests,
    exit gate G4); it contains no task decomposition and no T-numbered titles.
14. `docs/decisions/kitluy-terminal-transport-and-pairing-completion-owner-decision-v1.0.0.md`
    — no successor-task statement.
15. `docs/evidence/phase1/ws-11/WS-11-T001-EXECUTION-EVIDENCE.md` and
    `WS-11-T002-EXECUTION-EVIDENCE.md` — carry the T007/T008 debt anchors.
16. Repository-wide grep for `WS-11-T00[5-8]` — exactly two files match:
    `000_INDEX.md` and the T004 closeout handoff, both saying NOT STARTED /
    titles unresolved.

## 4. What IS authoritative about the remaining arc

Three facts survive every source check:

1. **The count of 8 is authoritative but external.** "T001 of 8" / "T002 of 8"
   entered the evidence register from the Cycle-10 T001 owner instruction
   (2026-07-28). That instruction is not checked into the repository, so the
   decomposition of the remaining four slots exists only in owner custody.
2. **The owner dependency order is authoritative for SEQUENCE.**
   `000_ACTIVE_PHASE.md` §10 (owner-directed 2026-07-28) fixes 14 steps. The
   T004 discovery mapped steps 1–5 → T001/T002/T003 and step 6 → T004
   (classification AUTHORITATIVE in its §2). The remaining steps are:
   - step 7 — certificate rotation, expiry and revocation: **substantially
     delivered by T003** (expiry, renewal, revocation, destruction; ROTATION
     itself is DISABLED pending an owner decision — 0129 renewal-mode policy);
   - step 8 — production signing-key custody for WS-10: **BLOCKED by BLK-005**
     (owner values + hardware evidence; not agent-executable beyond the
     existing fail-closed posture);
   - step 9 — signed configuration and release trust;
   - step 10 — device health, fleet status and support access;
   - step 11 — Hub replacement, NVMe replacement and recovery;
   - step 12 — release-channel eligibility and rollback authorization;
   - step 13 — security, offline, recovery and adversarial tests;
   - step 14 — independent review and evidence.
3. **The master plan §WS-11 pillars not yet covered by any task record**
   (2026-08-01 discovery note, cross-checked against T004 delivery): fleet
   health and diagnostics; replacement workflows; signed release targeting.
   LAN discovery, listed there as pillar 2, WAS delivered inside T004
   (P04B signed `_kitluy-edge._tcp.local` discovery + verified endpoint
   resolution), so it is no longer open scope.

## 5. WS-11-T005 and WS-11-T006 — UNRESOLVED

```text
Task ID:      WS-11-T005            Task ID:      WS-11-T006
Title:        UNRESOLVED            Title:        UNRESOLVED
Status:       NOT STARTED           Status:       NOT STARTED
```

- **Why unresolved:** the un-tasked implementation scope spans THREE pillar
  groups — (a) device health / fleet status / support access (step 10), (b)
  Hub / NVMe replacement and recovery (step 11), (c) signed configuration and
  release trust + release-channel eligibility and rollback authorization
  (steps 9 + 12) — but only TWO implementation slots remain before the
  test/review tail (§6, §7). No repository record partitions three pillar
  groups into two slots, and any partition chosen here would be an invented
  task boundary, which the discovery rules and CLAUDE.md rule 9 forbid.
- **Owner decision required:** a task-register ruling (or owner task prompts)
  naming the T005 and T006 titles and assigning the three pillar groups to
  the two slots — or expanding the count beyond 8. The ruling should also
  place **KLRISK-DEVICE-002** (restricted-investigation state, station
  containment, runbook — an owner-flagged sub-gate no agent may close) and
  the disabled ROTATION mode (0129, owner decision pending), both of which
  are unassigned WS-11 work.
- **Prerequisites (either slot):** T001–T004 all closed — satisfied at
  `7ef384c`.
- **Dependency on T004:** direct. Health/diagnostics and replacement flows
  operate on devices that T004 made provisionable end-to-end; release
  targeting rides the pairing/credential surfaces T004 shipped; replacement
  drills (owner-fixed NVMe order, `000_ACTIVE_PHASE.md` §10) revoke and
  re-issue the credentials T003/T004 govern.
- **Blockers:** BLK-005 (pilot/production posture stays fail-closed;
  development work may proceed exactly as T003/T004 did); BLK-006 for any
  Hub→cloud delivery leg (the authenticated service identity, the cloud
  producer, the signed batch transport); step 8 itself is fully
  BLK-005-blocked and cannot be assigned to an agent task.

## 6. WS-11-T007 — UNRESOLVED title, AUTHORITATIVE role anchor

```text
Task ID:      WS-11-T007
Title:        UNRESOLVED (no literal title in any register)
Status:       NOT STARTED
```

- **Role anchor (AUTHORITATIVE, three independent records):**
  - T002 handoff, Known limitations: "concurrency is proven by constraint
    rather than by racing sessions (owed to T007)";
  - `WS-11-T002-EXECUTION-EVIDENCE.md`: "A true concurrent-session test is
    owed to T007";
  - T003 Step 2 independent review
    (`reviews/2026-07-28__WS-11-T003-STEP2-TRUSTED-TIME__REVIEW.md`): "not
    raced. Owed to T007."
    These fix T007's ROLE as dependency-order step 13 — security, offline,
    recovery and adversarial tests — without fixing a title string.
- **Partial-discharge note (recorded honestly):** T003 Step 4 later delivered
  thirteen true-concurrency scenarios on genuinely separate backends for the
  CREDENTIAL lifecycle. The debts explicitly parked at T007 — the T002
  claim-redemption race and the Step-2 trusted-time race — were never
  discharged and remain owed.
- **Prerequisites:** all implementation tasks it must attack (T004, T005,
  T006) closed; T005/T006 titles must therefore be ruled first.
- **Dependency on T004:** adversarial surface includes everything T004
  shipped (code lockout/replay, PoP redemption races, pairing replay,
  mTLS transport, receipt replication).
- **Blockers:** BLK-005/BLK-006 limit scope to development surfaces; BLK-007
  (the two canonical security test plans + missing testing-and-evidence
  system) is a DIRECT input to step-13 work and remains open.

## 7. WS-11-T008 — UNRESOLVED title, AUTHORITATIVE role anchor

```text
Task ID:      WS-11-T008
Title:        UNRESOLVED (no literal title in any register)
Status:       NOT STARTED
```

- **Role anchor (AUTHORITATIVE, two records):**
  - `WS-11-T001-EXECUTION-EVIDENCE.md`: "No independent review of this task
    yet. T008.";
  - `WS-11-T002-EXECUTION-EVIDENCE.md`: "No independent review yet. T008."
    These fix T008's ROLE as dependency-order step 14 — independent review and
    evidence — for the WORKSTREAM.
- **Open debt:** T003 and T004 ran their own three-reviewer gates, but
  **T001 and T002 have never received independent review**; that debt is
  explicitly parked at T008. T008 is also where the WS-11 promotion decision
  (maximum: IMPLEMENTED-IN-DEV, per the Cycle-10 fence) would be evidenced.
- **Prerequisites:** T005–T007 closed.
- **Dependency on T004:** reviews T004's surface among the rest; consumes the
  T004 capability census and closeout evidence.
- **Blockers:** none beyond sequencing; the promotion ceiling
  (IMPLEMENTED-IN-DEV, never pilot/production while BLK-005 evidence is
  absent) is owner-locked in `000_ACTIVE_PHASE.md` §10.

## 8. Recommended execution order

1. **Owner ruling first** (the only next EXECUTABLE step): name T005/T006
   titles and the pillar partition (§5), place KLRISK-DEVICE-002 and the
   rotation-mode decision, confirm T007 = step-13 testing and T008 = step-14
   review as the recorded debts already imply.
2. Then T005 → T006 in owner dependency order (steps 9–12 sequence), each
   through the established package pattern (audit → migration → runtime →
   focused tests → review → verification).
3. Then T007 (adversarial/concurrency/offline/recovery matrix, discharging
   the recorded T002 and Step-2 race debts by name).
4. Then T008 (independent review including the T001/T002 backfill, evidence
   register, WS-11 promotion decision).

## 9. Distinguishing authority from planning (required by the package)

- AUTHORITATIVE: the NOT STARTED statuses; the unresolved-title condition;
  the 14-step dependency order; the master-plan §WS-11 contract; the T007 and
  T008 debt anchors; the BLK-005/BLK-006 gates; the 8-task count as a count.
- PLANNING SUGGESTIONS (no authority): the 2026-08-01 note's pillar list as a
  partition; the execution order in §8 beyond what the dependency order
  fixes; every scope sentence in §5 that assigns work to a specific slot.

## 10. Confirmation

No implementation, no migration, no runtime change, no production action, no
push. Files touched: this record and `000_INDEX.md` (one row). Verification
was deliberately limited to the package's allowance: intake check
(`git rev-parse`, `git status`) and changed-file formatting only.
