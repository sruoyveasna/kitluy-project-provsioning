# WS-11-T004-P02B2B2B2B — RECOVERY RACE AND REPLAY HARDENING — AI HANDOFF

| Field          | Value                                                                                                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                                                                                                                       |
| Package        | WS-11-T004-P02B2B2B2B (recovery race and replay hardening)                                                                                                                                                       |
| Status         | **IMPLEMENTED-IN-DEV — NO MIGRATION REQUIRED**                                                                                                                                                                   |
| Start SHA      | `e81da09b6bda023a6cf036e108cf6036b3bc67be` (feat(ws-11): add atomic lost-code recovery)                                                                                                                          |
| End SHA        | recorded by `git log -1` after the package commit (one atomic commit on `main`)                                                                                                                                  |
| Branch / ahead | `main`, ~101 ahead at intake; push URL `disabled://push-requires-owner-approval` — **nothing pushed**                                                                                                            |
| Toolchain      | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9 (corepack), engine-strict=true                                                            |
| Migration 0170 | **NOT created — deliberately.** Every race, replay and failure-injection scenario passed against the ACTIVE 0169 implementation; no executable evidence of any defect was found. Migrations 0000–0169 untouched. |

## 1. Repository intake

Clean tree at `e81da09`; no unexplained work; migration slot 0170 free (a
`grep 0170` hit is the timestamp substring of `202607301701*53*_0153`, not an
occupied group). Cloud migrations through 0169, Hub through 0030.

## 2. Historical package-ID collision (recorded, NOT renumbered)

The repository carries TWO historical handoffs whose package ID is
`WS-11-T004-P02B2B2B2A`, both preserved verbatim:

1. `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B2A__REPLACEMENT-CROSS-OPERATION-RACE-HARDENING__AI-HANDOFF.md`
   — replacement cross-operation race hardening, **no migration**, committed
   at `938de41` (test(ws-11): harden terminal replacement races).
2. `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B2A__ATOMIC-CONTROLLED-LOST-CODE-RECOVERY__AI-HANDOFF.md`
   — atomic controlled lost-code recovery, **migration 0169**, committed at
   `e81da09` (feat(ws-11): add atomic lost-code recovery).

Neither file was renamed, edited or deleted. This package uses the unique ID
`WS-11-T004-P02B2B2B2B`; successors should cite handoff slugs, not bare IDs,
for the two P02B2B2B2A records. No owner-level renumbering was attempted.

## 3. Authority sources

Package contract WS-11-T004-P02B2B2B2B; pairing protocol §6.1; migrations
0162–0169; the P02B2B2B2A replacement-race-hardening handoff (lock-order
audit and staggered-barrier method, reused verbatim); the 0169 recovery
handoff (door order, idempotency and lineage design); 0121
`revoke_device_assignment_v1` as the ONLY governed projection withdrawal;
0157 sanctioned test clock (KLD-2026-07-31-SECURITY-TEST-CLOCK-001).

## 4. Files changed (complete list)

1. `services/kitluy-device-registry-service/test/provisioning-code-recovery-races.integration.test.ts` — new, 14 tests, zero skips.
2. `00_AI_HANDOFF/shared/2026-08-05__SHARED__WS-11-T004-P02B2B2B2B__RECOVERY-RACE-AND-REPLAY-HARDENING__AI-HANDOFF.md` — this file.
3. `00_AI_HANDOFF/000_INDEX.md` — one row.

No migration, no RLS-suite change (the WS11-N16 boundary case from 0169
already covers the grant surface; nothing here changed any grant), no runtime
change, no Hub change, no dependency change.

## 5. Lock-order audit (§7; pre-edit, verified against 0163/0165/0166/0164/0169)

| Door                  | Effective order                                                                                                                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recovery (0169)       | recovery-key row FOR UPDATE (replay path RETURNS while holding it) → ASSIGNMENT for update → key recheck → liveness → derived scope → Hub projection read (unlocked, statement snapshot) → exact scoped permissions → original CODE for update → state recheck under the lock → guarded mutation → events |
| revocation (0165)     | idempotency row → unlocked read → ASSIGNMENT for update → CODE for update → idempotency recheck → guarded update                                                                                                                                                                                          |
| expiration (0166)     | unlocked read → ASSIGNMENT for update → CODE for update → boundary check → guarded update                                                                                                                                                                                                                 |
| evaluator (0164/0166) | ASSIGNMENT for update → outstanding CODE for update → delegated expiry → digest → attempt/lock mutation                                                                                                                                                                                                   |
| Hub door (0121)       | DEVICE for update → assignment updates → projection DELETE                                                                                                                                                                                                                                                |

Findings: **no reversed lock order** (assignment always precedes code); **no
unlocked terminal-state decision reaches a mutation** (recovery rechecks
state under the code lock AND the guarded UPDATE re-tests `state='issued'`);
**no stale-Hub mutation** (the gate read and the mutation share one
transaction; a committed withdrawal before the gate read always refuses —
proven E2); **no replay disclosure before permission checks** (0168/0169
pattern, re-proven hostile); **no lock cycle** between the idempotency stage
and the assignment stage — a key-row holder always returns immediately and
never requests the assignment lock. No theory-only change was made.

## 6. Race results (staggered barriers; separate backends, PIDs recorded; canonical fresh-DB run PIDs 404/405 throughout)

| Race                                   | Serialization                                                                                                                                                             | Results                                                                                                                                                                                                                                                                                                     | Final state / events                                                                                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 recovery vs revocation              | recovery first                                                                                                                                                            | recovery `RECOVERED`; late revocation `ALREADY_REVOKED` (the 0165 stable classification: "the original revocation stands unchanged" — zero mutation)                                                                                                                                                        | old REVOKED with the RECOVERY reason and key intact (no overwrite); one successor ISSUED; exactly one REVOKED + one CREATED event                                                     |
| A2 revocation vs recovery              | revocation first                                                                                                                                                          | revocation `REVOKED`; recovery `RECOVERY_REFUSED` / `KLUY-PROVCODE-ALREADY-REVOKED`, no raw code                                                                                                                                                                                                            | old REVOKED; **no successor**, one REVOKED event, only the original CREATED — no recovery idempotency residue                                                                         |
| B recovery vs canonical expiry         | both clocked at the EXACT stored boundary (microsecond-precise `expires_at::text` — a JS Date round-trip truncates to ms and silently becomes the control case; recorded) | recovery `RECOVERY_REFUSED` / `ALREADY-EXPIRED` with no raw code; helper `EXPIRED`                                                                                                                                                                                                                          | old EXPIRED, one EXPIRED event, zero REVOKED, no successor, no revocation residue. **Control** (boundary − 1s): recovery `RECOVERED` — one REVOKED predecessor + one ISSUED successor |
| C1 recovery vs 5th failure             | 5th failure first                                                                                                                                                         | presentation `PRESENTATION_REFUSED` / `KLUY-PROVCODE-LOCKED` at exactly 5; recovery `ALREADY-LOCKED`                                                                                                                                                                                                        | old LOCKED (never also REVOKED); attempts exactly 5; one LOCKED + five FAILED_ATTEMPT events; no successor                                                                            |
| C2 recovery vs 5th failure             | recovery first (count primed to 4)                                                                                                                                        | recovery `RECOVERED`; late wrong value `FAILED_PRESENTATION` **against the LIVE successor** (attempt 1 of 5 on the successor) — DOCUMENTED GOVERNED OUTCOME: 0166 evaluator step 2 evaluates the CURRENT outstanding code (cross-race B2 precedent); never a fifth attempt on the predecessor, never LOCKED | old REVOKED with count frozen at 4; successor ISSUED at 1 attempt; one REVOKED + one CREATED; four FAILED_ATTEMPT on the old                                                          |
| D1 recovery vs correct presentation    | presentation first                                                                                                                                                        | `MATCH_READY` + PRESENTED event, then recovery `RECOVERED` — **MATCH_READY is no lock, no reservation, no redemption**                                                                                                                                                                                      | old REVOKED with its PRESENTED history intact; zero REDEEMED events; successor ISSUED                                                                                                 |
| D2 recovery vs correct presentation    | recovery first                                                                                                                                                            | recovery `RECOVERED`; the superseded correct value is an ordinary `FAILED_PRESENTATION` mismatch against the successor — never MATCH_READY, no PRESENTED after the revocation (same documented authority as C2)                                                                                             | old REVOKED, zero PRESENTED; successor ISSUED with 1 bounded attempt                                                                                                                  |
| E1 recovery vs governed Hub withdrawal | recovery first                                                                                                                                                            | recovery `RECOVERED`; withdrawal `ASSIGNMENT_REVOKED`; successor binds hubE1 — the Hub eligible at commit; verified ZERO projections after withdrawal; follow-on recovery at the scope `KLUY-PROVCODE-HUB-INACTIVE` (revalidation fires BEFORE the original-key lookup)                                     | history never rewritten; one REVOKED + one CREATED stand                                                                                                                              |
| E2 governed Hub withdrawal vs recovery | withdrawal first                                                                                                                                                          | recovery `RECOVERY_REFUSED` / `KLUY-PROVCODE-HUB-INACTIVE`, no raw code                                                                                                                                                                                                                                     | old stays ISSUED; no revoked_at, no idempotency residue, no REVOKED event, no successor — zero residue                                                                                |

No race exposed an uncontrolled SQLSTATE (every racer asserts
`error === null` and `sqlstate === null`; the only intended exception is the
failure-injection SQLSTATE below).

## 7. Replay and rollback evidence

- **Replay A (lost response):** `ALREADY_RECOVERED`; names predecessor and
  successor; reports successor state; `raw_code_available=false`; no `code`
  key; no new row; no duplicate event; successor `expires_at` and
  `correlation_id` bit-identical; predecessor reason untouched.
- **Replay B (successor transitions, all through governed paths):** successor
  revoked via the 0165 door / expired via the clocked 0166 helper / locked by
  five genuine evaluator failures — the original recovery request replays to
  `ALREADY_RECOVERED` reporting the successor's CURRENT terminal state
  (`revoked` / `expired` / `locked`), never a raw code, never a second
  recovery, never a third row. Redeemed-state replay remains structurally
  guarded but **not integration-provable until P02B3 builds redemption**
  (recorded, same position as 0169/0165).
- **Replay C (hostile/conflicting):** same recovery key with another
  assignment / another original key / another reason → fail-closed
  `KLUY-PROVCODE-CONFLICTING-REPLAY`, zero residue. The original issuance key
  still answers ONLY the old REVOKED row through the issuance door; the
  recovery key only the successor. Wrong-environment and permissionless
  callers receive `KLUY-PROVCODE-PERMISSION-DENIED` with **no row identity
  disclosed** (not even the conflict). The 0168 issuance-door replay-privacy
  gate re-proven: a wrong-environment replay of a real original key returns
  no `ALREADY_ISSUED` and no `provisioning_code_id`.
- **Failure injection (§17):** inside ONE doomed transaction, the NOLOGIN
  table owner (`kitluy_activation_governor`, membership borrowed
  transactionally) installed a BEFORE INSERT trigger firing only for the
  poisoned recovery key; the door revoked the old code IN-FLIGHT and the
  successor INSERT then raised the controlled SQLSTATE `KL919`, aborting the
  whole transaction. After rollback: old code ISSUED, `revoked_at` null, no
  reason, no key residue, no REVOKED event, no successor, no CREATED event —
  and the fault trigger, fault function and borrowed membership all verified
  ABSENT (they lived only inside the aborted transaction, so no production
  state can retain them). A clean recovery afterwards succeeded, proving the
  rollback left a fully recoverable state.

## 8. Security / privilege evidence

anon → door EXECUTE 42501; service_role → door EXECUTE 42501 and direct
UPDATE 42501; authenticated → both coarse bridges 42501, direct
key/lineage/reason UPDATE 42501, event INSERT and DELETE 42501 (every probe
in its own transaction — proven 42501, never 25P02). Raw-code census: no raw
value this suite ever received (issuance or recovery) appears in any event
detail or reason field. Membership/grant/clock census after the run: 0 suite
grants, 0 test-clock policy rows, 0 borrowed postgres memberships, 0
login-capable governor members, 0 fault triggers. No production grant touched
(P02C posture unchanged).

## 9. Verification (all Node v22.23.0; cloud and Hub serialized; canonical run on a fresh reset)

| Command                                         | Exit | Result                                                                                              | State  |
| ----------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | ------ |
| `pnpm db:reset` (0000→0169)                     | 0    | 68 applied                                                                                          | fresh  |
| `pnpm db:seed` ×2                               | 0/0  | idempotent                                                                                          | fresh  |
| `pnpm db:test`                                  | 0    | **218 PASS, 0 FAIL** (baseline 218)                                                                 | fresh  |
| `pnpm test:rls`                                 | 0    | **120 PASS, 0 FAIL** (baseline 120)                                                                 | fresh  |
| recovery race suite (one file)                  | 0    | **14/14, zero skips**; PIDs 404/405 on every race                                                   | fresh  |
| `pnpm hub:db:reset` + seed + test               | 0    | 31 migrations, **35 PASS**                                                                          | fresh  |
| registry full suite (serial files)              | 0    | **283/283, 25 files, zero skips** (baseline 269 + 14; lifecycle 30/30, residue census 14/14)        | fresh  |
| `pnpm migrations:validate` / `db:validate`      | 0/0  | 68 files                                                                                            | static |
| `pnpm secret:scan`                              | 0    | 1288 tracked files clean                                                                            | static |
| `pnpm clock:check`                              | 0    | PASS, 4/4 consumers                                                                                 | static |
| targeted `prettier --check` on the changed file | 0    | clean                                                                                               | static |
| `pnpm verify`                                   | 1    | 11 of 12 PASS — `format:check` fails on the recorded pre-existing ~830-file artifact only (see §10) | fresh  |

Baseline comparison — **no regression**: db:test 218→218, test:rls 120→120,
registry 269/269→283/283 (24→25 files), Hub 35→35, lifecycle 30→30, residue
census 14→14. Required new tests: zero skips.

## 10. Repository-wide format condition (reported separately from package status)

`pnpm format:check` fails repository-wide on ~830 pre-existing files (the
recorded CRLF/imported-docs artifact; decision register per the 2026-07-30
Phase D findings). The 0169 package proved the identical failure at clean
HEAD `895cdfe` by stash-and-rerun; nothing in this package touches those
files and the package's own file passes the targeted formatter. Not
attributed to this package; not mass-formatted; `pnpm verify` is therefore
11 of 12 with every functional and security gate green.

## 11. Risks and unresolved values

1. **Redeemed-state paths remain integration-unprovable** until P02B3 builds
   redemption (evaluator, revocation, recovery and replay all share the
   structurally-guarded terminal-state branch; recorded since 0165).
2. **Cross-assignment same-recovery-key insert race** (two recoveries on
   DIFFERENT assignments reusing one recovery key, neither finding the other
   in the pre-insert rechecks): the loser would surface a unique-violation
   SQLSTATE — atomically rolled back with zero residue (the §17 fault test
   proves the rollback shape for an insert-stage failure), but the SQLSTATE
   itself is uncontrolled. Same-assignment keys serialize on the assignment
   lock (proven). A stable-conversion correction would be a narrow 0170+
   change IF an owner ever requires cross-assignment key reuse to answer
   politely; no repository authority requires it today.
3. The multi-Hub-scope modeling assumption inherited from P02B1 stands (the
   Hub gate counts projections; derivation picks the oldest) — unchanged
   here.

## 12. Rollback

`git revert <package commit>` — test + docs only; no schema, no runtime, no
grant was changed. No database rollback is needed.

## 13. Next package

- No expiration worker, no redemption/PoP, no HTTP route, no Hub runtime
  change, no production grant was added. P02B2B2C, P02B3 and P02C not
  started. WS-11-T004 **not complete**.
- Recommended next, per repository authority: **WS-11-T004-P02B3 —
  redemption and proof-of-possession foundation.** MATCH_READY is proven
  non-authoritative (D1/D2) and the evaluator's own comment records
  "MATCH_READY is a recheck input for P02B3, never an authorization" — the
  redemption recheck is the next missing capability, and it also unlocks the
  redeemed-state evidence recorded above. No repository authority currently
  proves an expiration WORKER is required (expiry is enforced at every door
  and the canonical helper exists); P02B2B2C should begin with authority
  discovery only if the owner prioritizes background sweeping.
