# WS-11-T008 — Independent Review, Evidence Reconciliation and Closeout

| Field      | Value                                                |
| ---------- | ---------------------------------------------------- |
| Date       | 2026-08-06 · Asia/Phnom_Penh                         |
| Authority  | T008 master package; security test system §19        |
| Status     | **WS-11-T008 COMPLETE — INDEPENDENTLY APPROVED**     |
| Workstream | **WS-11 COMPLETE — IMPLEMENTED AND VERIFIED IN DEV** |
| Push       | NOT PUSHED                                           |

## 1. Independence

Three independent reviewers, each a fresh agent in its **own detached git
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

Four remediation groups, each committed separately and re-reviewed by an
agent that did not author it:

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

**A test-quality finding worth stating on its own:** the T004 receipt suite
had invented random UUIDs for both devices, so it never exercised a real
Hub or terminal — which is precisely why the door's missing identity checks
survived four prior tasks. The fixture now enrols and assigns real devices
through the governed doors, and each event provisions its own terminal.

## 5. Recorded, NOT fixed (successor scope)

- **NEW-6 (INFO)**: the Hub refusal family forms a three-state
  existence/class oracle where the sibling health door collapses to one
  sentinel. Belongs to the receipt-ingestion surface.
- **NEW-7 (INFO, pre-existing in 0176)**: the redelivery-conflict comparison
  omits generation, profile, fingerprints, serial and version, so such a
  redelivery returns `DUPLICATE_IGNORED` rather than `CONFLICT`. The stored
  row is not corrupted.
- Repository-wide Prettier/CRLF condition (876 files) — pre-existing,
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

Revert in order: the closeout commit, `09f93e9`, `99af1b5`, `b276166`,
`27a7edd`, `1dad4c8`. Both databases replay from zero (cloud 0000→0181,
Hub 0000→0039 after revert).
