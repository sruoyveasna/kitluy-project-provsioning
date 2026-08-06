# WS-11-T008 — Independent Review, Evidence Reconciliation and Closeout

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                         |
| Authority  | T008 master package; security test system §19        |
| Status     | **WS-11-T008 COMPLETE — INDEPENDENTLY APPROVED**     |
| Workstream | **WS-11 COMPLETE — IMPLEMENTED AND VERIFIED IN DEV** |
| Push       | NOT PUSHED                                           |

## 1. Independence

Three independent reviewers across five passes, each a fresh agent in its **own detached git
worktree** containing committed state only, each read-only with respect to
product code, none approving a correction it authored:

| Reviewer | Worktree      | HEAD reviewed | Role                                                            |
| -------- | ------------- | ------------- | --------------------------------------------------------------- |
| A        | `C:/kl-rev-a` | `5612b50`     | Initial WS-11 evidence matrix, migration integrity, T007 checks |
| B        | `C:/kl-rev-b` | `27a7edd`     | Re-review of remediation group 1 + 46 hostile probes            |
| C        | `C:/kl-rev-c` | `99af1b5`     | Re-review of remediation group 2 (the pairing-receipt door)     |
| B (2nd)  | `C:/kl-rev-b` | `09f93e9`     | Re-review of remediation group 3 (NULL and class guards)        |

The remediation agent authored all corrections and approved none of them.
Reviewer A's initial verdict was committed (`1dad4c8`) **before** any product
change, as the protocol requires.

**Independence limitation, stated plainly:** all four review passes are
agents of the same model family operating in the same session. They had
genuinely isolated worktrees, no access to the implementation's reasoning,
and each reproduced defects executably rather than trusting prose — but they
are not a different vendor, a different toolchain, or a human. Human or
third-party review is not claimed.

## 2. Per-task verdicts (Reviewer A, evidence-backed)

| Task | Verdict                         | Remaining debt                                      |
| ---- | ------------------------------- | --------------------------------------------------- |
| T001 | APPROVED                        | —                                                   |
| T002 | APPROVED                        | —                                                   |
| T003 | APPROVED WITH NON-BLOCKING DEBT | No RTC/TPM exists to test trusted time against      |
| T004 | APPROVED                        | Fixture weakness found and fixed under T008 (below) |
| T005 | APPROVED WITH NON-BLOCKING DEBT | Containment directive producer rides BLK-006        |
| T006 | APPROVED WITH NON-BLOCKING DEBT | Slot adapters are development harnesses (BLK-005)   |
| T007 | APPROVED WITH NON-BLOCKING DEBT | Verify gate carries the repo-wide format condition  |

No `CHANGES REQUIRED`, `BLOCKED` or `INSUFFICIENT EVIDENCE` verdict survived
remediation. A handoff alone produced no APPROVED verdict: Reviewer A read
five high-value claims' test bodies to confirm they would fail if the
behaviour broke, censused `HUB_MIGRATION_ORDER` 40/40, and found zero
unconditional skips repository-wide.

## 3. Migration integrity (independently verified)

- Every migration file's history was censused for post-introduction edits.
  Hub 0038 is the only one, and it is the T006 breach already reconciled:
  blob `9e80c81f…` at its introducing commit `9310168`, the same blob at
  `b031cb8`, the same blob on disk today, sha256 (LF-normalised)
  `3d571e17…2ab78`. **Byte-identical to its introducing commit.**
- Reviewer A proved all three pins strict by mutation: a changed legacy
  migration fails `hub:db:validate`; a changed 0038 fails `secret:scan`; a
  NEW file using the legacy marker form fails. All reverted, worktree clean.
- Cloud journal 82/82 (now 84/84 with 0183/0184), Hub journal 40/40.

## 4. Defects found by the review and fixed forward

Five remediation groups, each committed separately and re-reviewed by an
agent that did not author it. Note the chain: 0183 fixed a missing
authority, 0184 fixed a gap in 0183's fix, 0185 fixed a gap in 0184's fix.
Each was found by the NEXT reviewer, not by the author — which is the
protocol working rather than failing.

| Finding | Severity               | Defect                                                                                                                                                                                                                                 | Fix                                                                             |
| ------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F-1     | Blocking a fresh clone | The Hub immutability guard hashed RAW bytes while its two siblings normalise line endings, so a Windows checkout reported drift on unmodified migrations and every Hub command REFUSED (Reviewer A saw 7; Reviewer B reproduced 40/40) | `hub-db.mjs` now LF-normalises; proven line-ending independent and still strict |
| F-2     | Control gap            | The Hub migration set sat outside `pnpm verify` — the structural reason the 0038 edit reached a commit                                                                                                                                 | `hub:db:validate` added to the verify gate                                      |
| F-4     | Test quality           | Race family 11 had no liveness assertion; it would pass if both containment doors always refused                                                                                                                                       | Liveness assertion added; Reviewer B proved it non-vacuous with a mutant        |
| F-5     | Correctness            | `assign_release_v1` compared only the artifact, so the same idempotency key with a DIFFERENT device returned EXISTING and silently dropped the second installation                                                                     | **cloud 0182** — the key identifies artifact, scope, environment AND device     |
| NEW-1   | Medium (security)      | The pairing-receipt door bound NO Hub identity, tenancy scope or assignment generation in SQL; all four hostile deliveries were INGESTED                                                                                               | **cloud 0183** — parity with the sibling health door                            |
| NEW-2   | Medium                 | A replayed effect key escaped as raw SQLSTATE 23505 — the same ungoverned-escape class 0181 fixed elsewhere                                                                                                                            | **cloud 0183** — governed conflict sentinel                                     |
| NEW-3   | Low                    | A malformed fingerprint escaped as raw 23514                                                                                                                                                                                           | **cloud 0183** — governed schema sentinel                                       |
| NEW-4   | Low                    | The checks 0183 added were NULL-permeable: `NULL <> x` is NULL, so an absent scope field walked past the authority into a raw 23502                                                                                                    | **cloud 0184** — presence gate                                                  |
| NEW-5   | Low                    | Only the ISSUING device's class was checked; a Hub supplied as the terminal was ingested                                                                                                                                               | **cloud 0184** — paired-side class check                                        |
| NEW-6   | Low                    | The presence gate 0184 added was ITSELF incomplete — it omitted the effect key, environment and correlation id, whose bare predicates were NULL-permeable for the same reason, so all three escaped as raw 23502                       | **cloud 0185** — the gate names every field the door depends on                 |

**A test-quality finding worth stating on its own:** the T004 receipt suite
had invented random UUIDs for both devices, so it never exercised a real
Hub or terminal — which is precisely why the door's missing identity checks
survived four prior tasks. The fixture now enrols and assigns real devices
through the governed doors, and each event provisions its own terminal.

Reviewer C's final pass drove **97 probes** at the corrected door and found
**no input that produces a raw SQLSTATE**: all nineteen parameters are
covered, sixteen by the gate and three by their own NULL-safe predicates.
It also verified the "byte-equivalent apart from the gate" claim by
extracting and diffing both function bodies rather than trusting it, and
proved the new tests non-vacuous by reverting the door and watching the
suite fail on the exact absent field.

## 5. Recorded, NOT fixed (successor scope)

- **Refusal-oracle observation (INFO)**: the Hub refusal family forms a
  three-state existence/class oracle where the sibling health door
  collapses to one sentinel. Belongs to the receipt-ingestion surface.
- **KLREC-2026-08-06-WS11-T008-001 (OPEN, owner decision)**: the pairing
  verifier refuses `now < issuedAt` with ZERO tolerance, so a terminal whose
  clock lags the Hub by one millisecond refuses a valid session. The
  closeout run reproduced this as an intermittent LAN-pairing failure
  (two of four runs at the T008 starting SHA — pre-existing, not introduced
  here) and diagnosed it rather than retrying. NOT silently changed:
  clock tolerance elsewhere in this system is SIGNED POLICY, so an ad-hoc
  constant inside a cryptographic verifier is an owner decision. The test
  now verifies against a Hub-anchored instant (what a real terminal's
  trusted-time floor is); expiry remains Hub-authoritative and enforced.
  Six consecutive clean runs after the change.
- **NEW-7 (INFO, pre-existing in 0176)**: the redelivery-conflict comparison
  omits generation, profile, fingerprints, serial and version, so such a
  redelivery returns `DUPLICATE_IGNORED` rather than `CONFLICT`. The stored
  row is not corrupted.
- **Receipt-ingestion observations O-1…O-4 (Reviewer C, all pre-existing
  since group 0176, none in the remediated class)**: O-1 the door does not
  bind the effect key's namespace to the receipt id (only the consumer
  does); **O-2 (LOW, carried as debt)** there is no clock sanity on
  `paired_at` — a year-3000 or `-infinity` value ingests, and because the
  terminal projection orders by `paired_at desc`, a far-future value would
  become that terminal's reported pairing state permanently, where the
  sibling health door has an explicit clock-anomaly rule; O-3 profile code,
  serial and version are unvalidated and unbounded; O-4 the absent-field
  regression test covers six of the sixteen gated fields (the other ten were
  verified governed at SQL level, so this is a narrower net, not a defect).
- Repository-wide Prettier/CRLF condition (865 files measured at closeout) — pre-existing,
  deliberately not mass-formatted, T008 intersection empty.
- `docs:verify` classification drift on two `docs/source/` files
  (KLSRC-0009, KLSRC-0138) — pre-existing, unrelated to WS-11, and outside
  the `pnpm verify` gate.

## 6. BLK-007

**REMAINS OPEN, narrowed and named.** The executable half is discharged:
`docs/security/kitluy-security-test-plan-phase1-v1.0.0.md` gives a qualified
engineer the toolchain, migration and seed order, development key
generation, every command, expected outcomes, failure diagnosis, rollback,
and binds each executed security family to a file, a command and a result.
What remains is not WS-11 work: 41 non-WS-11 registry rows still cite
`kitluy-testing-and-evidence-system-v1.0.0`, which does not exist. Supplying
it or re-sourcing them is an owner evidence-policy decision spanning all
workstreams. No WS-11 capability depends on it.

## 7. WS-11 Rebuild Test

Performed. A qualified engineer, from committed authority alone, can
reconstruct and operate the development implementation of provisioning codes
and PoP, credential issuance, activation, LAN mTLS, signed discovery,
pairing, terminal receipt persistence, fleet health, support access,
containment, Hub replacement, encrypted backup, quarantine restore, signed
configuration, signed releases, and Hub/terminal A/B rollback — using §1 of
the security test plan for toolchain, migration order, seed order, key
generation, commands and expected totals, and each migration's in-file
contract for the rules it enforces. Two rebuild-blocking gaps were FOUND by
this review and fixed (F-1 made a fresh Windows clone unable to run any Hub
command; F-2 left the Hub set ungated), which is the strongest evidence the
Rebuild Test was performed rather than assumed.

## 8. Blockers

**BLK-005** (PKI, HSM/secure element, hardware certification) and **BLK-006**
(production transports and producers) remain OPEN and fail-closed; both were
re-proven from a database rebuilt from zero. Pilot and Stable promotion, and
any production claim, remain blocked. Physical Pi boot-slot and Electron
updater adapters are development harnesses, not certified hardware support.

## 9. Rollback

Revert in order (newest first, the complete T008 set): `a6112a8` (closeout),
`828e850`, `373cfc5`, `6e7bf39`, `09f93e9`, `99af1b5`, `b276166`, `27a7edd`,
`1dad4c8`. Both databases replay from zero (cloud 0000→0181, Hub 0000→0039
after revert).

> Corrected by the 2026-08-06 errata (§10): the list as first written named
> only six of the nine commits, omitting `6e7bf39`, `373cfc5` and `828e850`;
> a revert following it would have left three T008 commits in place.

## 10. Errata (2026-08-06, closeout reconciliation)

**Commit count.** The closing report stated TEN commits while listing nine.
Git history is authoritative: WS-11-T008 comprises exactly **NINE commits**,
`git log 5612b50..a6112a8` (parent of the first T008 commit is the T007
closeout `5612b50`, no commit is missing):

| #   | SHA       | Subject                                                          |
| --- | --------- | ---------------------------------------------------------------- |
| 1   | `1dad4c8` | docs(ws-11): record initial independent review                   |
| 2   | `27a7edd` | fix(ws-11): correct review findings F-1, F-2, F-4 and F-5        |
| 3   | `b276166` | docs(ws-11): record remediation re-review and adversarial probes |
| 4   | `99af1b5` | fix(ws-11): bind pairing receipt identity in the door            |
| 5   | `09f93e9` | fix(ws-11): close receipt null and device-class gaps             |
| 6   | `6e7bf39` | docs(ws-11): complete security test plan and reconcile records   |
| 7   | `373cfc5` | test(ws-11): anchor lan pairing verification to hub time         |
| 8   | `828e850` | fix(ws-11): complete the receipt presence gate                   |
| 9   | `a6112a8` | docs(ws-11): independently close device management workstream    |

The count of ten was wrong; the nine-commit list was complete. No commit is
"missing" and none was invented to make the count fit.

**Owner decision recorded.** `KLD-2026-08-06-WS11-CLOCK-001` (decision
register) rules on the clock questions this task left open: challenge
validity uses authoritative Hub/database time; client and Node host clocks
are diagnostic only; NO lower-bound grace for pairing or activation
challenges — `NOT_YET_VALID` is retryable and consumes nothing (this
RESOLVES KLREC-2026-08-06-WS11-T008-001 in the zero-tolerance direction);
`paired_at` is generated by the Hub transaction and is immutable; cloud
receipt ingestion accepts a signed `paired_at` up to 300 seconds ahead,
recording the offset, and quarantines beyond 300 seconds without advancing
the cloud projection (this RESOLVES the KLREC-2026-08-06-WS11-T008-002
clock-sanity gap as policy); the ingestion allowance does not change
challenge-expiry rules.

**BLK-007.** Remains OPEN for the 41 non-WS-11 security-plan registry rows;
non-blocking to the completed WS-11 scope; the rows must be assigned to the
relevant future workstreams rather than carried as a WS-11 debt.
