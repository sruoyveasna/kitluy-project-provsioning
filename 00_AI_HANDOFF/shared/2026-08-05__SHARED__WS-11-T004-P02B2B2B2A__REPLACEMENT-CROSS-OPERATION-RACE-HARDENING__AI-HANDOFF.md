# WS-11-T004-P02B2B2B2A — cross-operation replacement race hardening

| Field     | Value                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package   | WS-11-T004-P02B2B2B2A — prove and, only where necessary, harden expired-code replacement issuance against concurrent revocation, presentation/lockout, Hub-state change and successive replacement |
| Date      | 2026-08-05 · Asia/Phnom_Penh                                                                                                                      |
| Start SHA | `ed9265c` (`feat(ws-11): add expired terminal code replacement`)                                                                                   |
| Toolchain | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9, engine enforcement ACTIVE |
| Migration | **NONE — NO MIGRATION REQUIRED.** No race or hostile test proved a defect in the active 0167 implementation; migration 0168 remains free           |
| Status    | **IMPLEMENTED-IN-DEV — NO MIGRATION REQUIRED**                                                                                                     |
| Push      | not pushed; URL `disabled://push-requires-owner-approval`                                                                                          |

## 1. Repository intake

Branch `main`, start HEAD `ed9265c`, tree clean, 98 commits ahead of upstream,
push URL `disabled://push-requires-owner-approval`, `git diff --check` clean.
Cloud migrations through 0167 replayed as recorded (66 files); next free
migration 0168 verified absent before and after the package. Hub migrations
through 0030. No unexplained changes, no competing agent on the tests, the
issuance function or the migration boundary. The package brief is preserved at
`00_AI_HANDOFF/WS-11-T004-P02B2B2B2A__PACKAGE.txt` (intake copy).

## 2. Toolchain

The session default was Node v24.15.0 — the package forbids it. The recorded
standalone Node 22 toolchain was put on PATH for every command:
`node --version` = **v22.23.0**, `pnpm --version` = **9.15.9**,
`pnpm config get engine-strict` = **true**; no engine override anywhere.
Docker and the Supabase CLI (v2.101.0) were on PATH for DB commands, as
recorded by P02B2B2A. No canonical evidence was produced under Node 24.

## 3. Authority sources

Package contract WS-11-T004-P02B2B2B2A (attached brief); AGENTS.md / CLAUDE.md
/ KIMI.md / PROJECT_HOME.md / CONTRIBUTING.md / SECURITY.md;
`00_AI_HANDOFF/000_INDEX.md`, `000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`,
`000_BLOCKERS.md`; all WS-11-T004 handoffs through P02B2B2B1; migrations
0162 (schema/events), 0163 (issuance door), 0164 (presentation/lockout),
0165 (revocation), 0166 (canonical expiration + evaluator refactor),
0167 (replacement issuance and lineage); 0121 (`revoke_device_assignment_v1` —
the only canonical projection withdrawal); the live database roles and RLS
posture.

## 4. Exact files changed

- `services/kitluy-device-registry-service/test/provisioning-code-replacement-cross-race.integration.test.ts` (new — races A–E, hostile runtime/constraint probes, census)
- `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B2A__REPLACEMENT-CROSS-OPERATION-RACE-HARDENING__AI-HANDOFF.md` (this record)
- `00_AI_HANDOFF/000_INDEX.md` (index line)
- `00_AI_HANDOFF/WS-11-T004-P02B2B2B2A__PACKAGE.txt` (intake copy of the package brief)

No migration (0000–0167 untouched, 0168 not created), no Hub migration, no
provisioning-service runtime, no Store Hub runtime, no UI, no certificate or
pairing code, no package dependency, no production grant, no recovery worker,
no redemption, no PoP. P02B2B2B2B, P02B2B2C, P02B3 and P02C were not started.

## 5. Pre-edit lock-order audit

Verified against the live function bodies before any test was written:

| Door | Lock order |
| --- | --- |
| issuance (0163/0167) | idempotency row (if found) → **terminal assignment FOR UPDATE** → idempotency recheck under the lock → **outstanding code FOR UPDATE** (`state='issued'`) → 0166 helper (re-entrant, same rows) → successor INSERT |
| expiration helper (0166) | unlocked read to derive the assignment → **assignment FOR UPDATE** → **code FOR UPDATE** → terminal-state recheck → guarded `UPDATE ... WHERE state='issued'` |
| revocation (0165) | revocation-key row (if found) → unlocked read → scoped permission → **assignment FOR UPDATE** → **code FOR UPDATE** → key recheck → terminal-state recheck → guarded UPDATE |
| evaluator (0164/0166) | **assignment FOR UPDATE** → **outstanding code FOR UPDATE** → expiry delegation (re-entrant) → digest compare → attempt mutation guarded by `state='issued'` |

Every door locks **assignment first, code second**. No function reverses this
order; no deadlock cycle exists among the four doors.

**Hub-state validation point:** the issuance door reads the CURRENT activation
projection at step 4 (before locating/locking the outstanding code and before
the successor INSERT) **without taking a lock on the projection row**. This is
sufficient: projection withdrawal (`revoke_device_assignment_v1`, 0121) is an
ordinary committed DELETE, so a gate read that observed the projection is
serial-equivalent to "issuance ordered before the Hub transition"; a gate read
after the committed withdrawal fails closed. Race D proved both branches. No
conflict requiring correction was discovered.

## 6. Race matrix

| Race | Operation A | Operation B | Shared locked resources | Expected winner rules | Required final state | Required events |
| --- | --- | --- | --- | --- | --- | --- |
| A | replacement (new key) | revoke predecessor | assignment row → code row (same order) | lock-order winner takes the terminal transition; loser gets a stable classification | exactly one terminal state (EXPIRED xor REVOKED); ≤1 successor; no lineage from REVOKED | exactly one terminal event; CREATED only for an actually created row; no duplicates |
| B | replacement | wrong presentation, count=4 | assignment → code | expiry is evaluated before digest/attempt mutation | predecessor EXPIRED; count frozen at 4; never LOCKED; ≤1 outstanding | one EXPIRED; ≤1 CREATED; FAILED_ATTEMPT only the 4 priming events (+1 on the live successor in B2, documented) |
| C | replacement | correct predecessor code | assignment → code | expiry precedes the digest; MATCH_READY impossible for an overdue code | predecessor EXPIRED; no redemption; successor ISSUED | one EXPIRED; one CREATED; no PRESENTED after the expiry transition |
| D | replacement | governed Hub assignment revocation (0121) | none shared (unlocked projection read) | committed order decides: gate read vs withdrawal | D1: successor stands, follow-on refuses; D2: refusal, predecessor untouched | D1: EXPIRED+CREATED stand; D2: zero transition events |
| E | replace B (key 1) | replace B (key 2) | assignment → code | one winner; loser OUTSTANDING | A EXPIRED ← B EXPIRED ← C ISSUED; single chain | 1 CREATED per code; 1 EXPIRED each for A and B |

## 7. Race execution — backends and barrier

All races ran on genuinely separate pooled backends against
`127.0.0.1:54322/postgres`, each race with its own terminal, assignment and
predecessor; due time via the sanctioned test clock (one committed policy row
+ transaction-local `kitluy.test_clock_instant`, both removed in afterAll).
A–C use a start barrier with a 250 ms staggered release to make each
serialization deterministic while both racers are in flight on separate
backends; E uses a true simultaneous barrier (released after both racers
armed). Recorded PIDs (fresh post-reset run):

- A1: replacement **540**, revocation **541**
- A2: revocation **541**, replacement **540**
- B1: presentation **540**, replacement **541**
- B2: replacement **541**, presentation **540**
- C1: presentation **540**, replacement **541**
- C2: replacement **541**, presentation **540**
- E: serial B pid **540**; barrier racers **540**/**541**
- D1: replacement **549**, Hub transition **550**
- D2: Hub transition **550**, replacement **549**

Effective roles: replacement and revocation racers `authenticated` (operator
JWT, temporary grants for `fleet.device_provisioning_code.issue` / `.revoke`,
removed in afterAll); presentation racers and the Hub transition
`postgres` holding the sanctioned `kitluy_test_harness` borrow (revoked in
afterAll). No racer surfaced any SQLSTATE — every conflict returned the
repository's stable result vocabulary.

## 8. Final row and event residue (per race)

- **A1 (replacement first):** predecessor EXPIRED (`replaces` NULL); one
  successor ISSUED → predecessor; revocation answered `REVOCATION_REFUSED /
  KLUY-PROVCODE-ALREADY-EXPIRED` with zero mutation. Events: 1 EXPIRED,
  1 predecessor CREATED, 1 successor CREATED, 0 REVOKED.
- **A2 (revocation first):** predecessor REVOKED; 1 REVOKED event; 0 EXPIRED
  events; zero rows with `replaces = predecessor`. The raced replacement call
  returned `ISSUED` with **NULL lineage** — see documented outcome §10.
- **B1 (presentation first):** predecessor EXPIRED via the evaluator's own
  delegation (`trigger_source=PRESENTATION_EVALUATOR`, actor TERMINAL);
  count frozen at 4; 0 LOCKED events; exactly the 4 priming FAILED_ATTEMPT
  events, never a fifth; the 5th presentation answered
  `PRESENTATION_REFUSED / KLUY-PROVCODE-EXPIRED`. The raced replacement then
  issued a fresh NULL-lineage row (§10); at most one outstanding code held.
- **B2 (replacement first):** predecessor EXPIRED (`ISSUANCE_REPLACEMENT`,
  OPERATOR); successor ISSUED with lineage; the late wrong presentation met
  the LIVE successor: `FAILED_PRESENTATION`, successor count 1 of 5; the
  predecessor kept exactly its 4 priming events; no LOCKED anywhere.
- **C1 (presentation first):** the correct code of the overdue predecessor
  received `KLUY-PROVCODE-EXPIRED` — expiry precedes the digest, so
  MATCH_READY is impossible; 0 PRESENTED events; 0 attempts; no redemption.
- **C2 (replacement first):** successor ISSUED with lineage; the superseded
  correct code is an ordinary MISMATCH against the live successor
  (`FAILED_PRESENTATION`); never MATCH_READY; no PRESENTED event; 0 attempts
  on the predecessor.
- **D1 (replacement first):** successor ISSUED bound to the Hub state valid
  at its commit; the later governed Hub assignment revocation
  (`ASSIGNMENT_REVOKED`, projection withdrawn) rewrote nothing — predecessor
  EXPIRED, successor ISSUED, 1 EXPIRED + 1 CREATED event stand. The follow-on
  issuance then failed closed `ISSUANCE_REFUSED / KLUY-PROVCODE-HUB-INACTIVE`
  with no raw code, no new row and no partial expiration.
- **D2 (Hub transition first):** `ISSUANCE_REFUSED /
  KLUY-PROVCODE-HUB-INACTIVE`; no successor; predecessor remains overdue
  ISSUED (no partial expiration); 0 EXPIRED events; only the predecessor's
  own CREATED event; no raw code returned.
- **E:** A EXPIRED (chain head) ← B EXPIRED (`replaces`=A) ← C ISSUED
  (`replaces`=B); exactly one successor per predecessor; no self-reference,
  no cycle, no duplicate lineage edge; 1 EXPIRED for A, 1 for B; 1 CREATED
  each for A, B, C; the loser received the stable OUTSTANDING result with no
  code. Event detail of every chain event was scanned against all three raw
  codes and all three digests: zero matches.

## 9. Hostile lineage and privilege results

Runtime-role probes (real `authenticated` role, operator JWT — H1): direct
INSERT with caller-supplied lineage → **42501**; direct UPDATE of the lineage
column → **42501**; direct UPDATE forcing EXPIRED → **42501**; direct INSERT
of a fabricated event → **42501**; direct EXECUTE of the canonical expiration
helper → **42501**. The issuance door's signature carries no lineage
parameter (asserted from `pg_proc`), so callers cannot supply
`replaces_provisioning_code_id` through the governed path at all.

Constraint-layer probes (harness borrowing the NOLOGIN governor membership
exactly as migrations do on apply, handed back in `finally`; never claimed as
runtime proof — H2): self-reference → governed denial
(`KLUY-PROVCODE-LINEAGE-MISSING`); a direct second successor of an
already-succeeded predecessor → **23505** on
`device_provisioning_codes_one_successor_uidx` (the database backstop);
cross-assignment, cross-tenant, cross-store, cross-location, cross-hub,
cross-profile and cross-environment predecessor links → all denied by
governed `KLUY-PROVCODE-*` refusals (scope-consistency or
lineage-inconsistency), never silently accepted. Census inside H2: zero
login-capable members of the NOLOGIN definer authorities.

## 10. Proven defect

**None.** Every race ended with exactly one authoritative terminal state, at
most one direct successor per predecessor, at most one outstanding ISSUED
code per assignment, no duplicate terminal or CREATED event, no raw-code
persistence, no uncontrolled SQLSTATE and no privilege residue. **Migration
0168 was NOT created; it remains free. NO MIGRATION REQUIRED.**

Two governed behaviors are recorded verbatim per the package's own rule
("if repository execution proves a different serializable order is permitted,
document the exact authority before accepting it"):

1. **Initial issuance after a concurrent terminal transition (A2, B1, C1).**
   When the revocation (A2) or the evaluator-side expiration (B1/C1) commits
   first, the raced replacement call finds no outstanding code and takes the
   **unchanged 0163 initial-issuance path** (0167 door step 6: "no outstanding
   code → the 0163 initial-issuance path, unchanged"; P02B2B2B1 handoff §5).
   The new row carries NULL lineage — it is never a successor of a REVOKED or
   otherwise-closed predecessor (the 0167 trigger makes lineage to a
   non-EXPIRED row impossible). Every package invariant holds; the outcome is
   serial-equivalent to the same authorized operator issuing after the
   transition. Refusing it would break legitimate re-provisioning after
   revocation — a designed 0163 behavior — so it is **not** a defect and was
   **not** "fixed".
2. **A late presentation meets the live successor (B2, C2).** The evaluator
   evaluates the CURRENT outstanding code (0166 evaluator step 2). After the
   replacement commits, a wrong value — or the superseded predecessor's
   correct value — is an ordinary bounded MISMATCH against the successor (1
   of 5), never an increment on the terminal predecessor, never MATCH_READY,
   never a PRESENTED event after the expiry transition. The predecessor's raw
   value is stored nowhere, so no constant-time compare against it is
   possible by design (0162/0164 authority).

## 11. Migration 0168 correction

Not applicable — no proven defect. Migrations 0000–0167 are byte-untouched;
`migrations:validate` and `db:validate` confirm 66 files.

## 12. Privilege evidence

Runtime identities hold no INSERT/UPDATE/DELETE on the code or event tables
(live probes, §9); the expiration helper stays harness-only; FORCE RLS holds;
no login-capable role is a member of any NOLOGIN authority; no raw-code-
capable column exists; no broad owner membership exists; the harness borrow
(governor for H2, harness for the evaluator) was revoked in-suite; fixture
temporary grants and the test-clock policy row were deleted in afterAll. No
production grant was added — P02C still owns production composition.

## 13. Exact commands and results

All under Node v22.23.0, engine-strict ACTIVE, role `postgres` against the
local stack (cloud `postgres` DB / `kitluy_hub_local`), every run FRESH after
`db:reset`:

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm db:reset` (0000→0167) | 0 | 66 files; 0167 guard NOTICE present; 0168 absent |
| `pnpm db:seed` ×2 | 0 | idempotent |
| `pnpm db:test` (single fresh run) | 0 | **215 PASS** (98 assertions + 117 RLS), 0 FAIL |
| `pnpm test:rls` | 0 | **117 PASS**, 0 FAIL |
| cross-race suite (vitest, one file) | 0 | **11/11 PASS, zero skips** (PIDs §7) |
| registry service full suite (`npx vitest run`) | 0 | **246/246 PASS, zero skips** (22 files; lifecycle 30/30, census 14/14) |
| `pnpm migrations:validate` | 0 | 66 files |
| `pnpm db:validate` | 0 | 66 files |
| `pnpm secret:scan` | 0 | 1279 tracked files |
| `pnpm clock:check` | 0 | PASS |
| membership + privilege census (one-off probe) | 0 | zero residue (§12; `temporary_grants` holds the 3 pre-existing section-50/51 fixture rows recorded at baseline) |
| `pnpm hub:db:reset` + `hub:db:seed` + `hub:db:test` | 0 | 31 migrations, **35 PASS** (required: the cloud reset had removed `kitluy_hub_local`) |

Honest operational notes: (a) `db:test` is single-run-per-reset — a second
run on the same database fails on accumulated ACTIVE fixture devices
(pre-existing property, not this package's residue); (b) the first full
registry run skipped the lifecycle/census files because the cloud reset had
removed the Hub database; rebuilding the Hub DB (above) restored them and the
serial rerun passed 246/246 with zero skips.

## 14. Baseline comparison

db:test **215** (= baseline 215); test:rls **117** (= 117); registry
**246/246** (baseline 235/235 + 11 new cross-race tests); lifecycle **30/30**;
census **14/14**; Hub db:test **35/35**. No baseline regressed. Required
package tests have **zero skips** and no silent skip (the suite ran — 11/11
executed with recorded PIDs).

## 15. Blocked race

None. Race D found a real governed Hub transition (`revoke_device_assignment_v1`,
0121 — the canonical projection withdrawal) and executed both branches; no
`BLOCKED BY MISSING GOVERNED TEST DOOR` classification was needed.

## 16. Risks and unresolved values

- The two documented governed outcomes (§10) diverge from the package brief's
  most literal branch wording ("replacement returns a stable terminal result"
  in the revocation-wins branch) while satisfying every hard invariant and
  every NEVER-ALLOW item; they are recorded here with exact authority for
  owner visibility rather than silently "fixed".
- A superseded correct code presented after replacement commits draws one
  ordinary failed attempt on the live successor (C2). Bounded (1 of 5),
  non-security, inherent to never storing the old raw code; P02B3's mandatory
  state recheck remains the correct place to classify it at redemption time.
- `docs:verify` classification gate fails identically on clean HEAD on this
  Windows checkout (pre-existing; unchanged by this package).

## 17. Rollback instructions

`git revert` this package's commit. The change set is tests and handoff
records only — no migration exists to roll back; a `db:reset` rebuilds the
database identically with or without the commit.

## 18. Final package status

**IMPLEMENTED-IN-DEV — NO MIGRATION REQUIRED.**

Not marked: ambiguous-outcome recovery complete, expiration worker complete,
P02B3 complete, P02C complete, WS-11-T004 complete, pilot ready, production
ready.

## 19. Prerequisites for P02B2B2B2B

Satisfied: cross-operation races A–E proven on separate backends with
recorded PIDs; lock order verified consistent across all four doors; Hub
revalidation proven at the correct transaction boundary (both branches);
hostile lineage and privilege posture proven with real roles; zero
regressions; migration 0168 still free. Ambiguous-outcome recovery was not
started; no expiration worker was added; P02B3 and P02C were not started.
Recommended next package: **WS-11-T004-P02B2B2B2B — ambiguous-outcome and
replacement recovery hardening**.
