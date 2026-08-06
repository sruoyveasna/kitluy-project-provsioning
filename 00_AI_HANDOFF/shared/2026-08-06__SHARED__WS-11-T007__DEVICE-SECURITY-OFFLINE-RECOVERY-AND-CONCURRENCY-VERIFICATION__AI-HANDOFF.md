# WS-11-T007 — Device Security, Offline, Recovery and Concurrency Verification

| Field     | Value                                                   |
| --------- | ------------------------------------------------------- |
| Date      | 2026-08-06 · Asia/Phnom_Penh                            |
| Authority | KLD-2026-08-06-WS11-T007-001 (security test system §19) |
| Status    | **WS-11-T007 COMPLETE — VERIFIED-IN-DEV**               |
| Push      | NOT PUSHED                                              |

## Stage 0 — migration-history reconciliation (`b031cb8`)

Hub 0038 restored byte-for-byte from `9310168` (blob `9e80c81f`, sha256
`3d571e17…2ab78`; re-applied from zero under the same journalled checksum).
The scanner false positive is a checksum-pinned rejection-fixture exception
proven to re-enable on any mutation and weaken nothing else. T006 remains
COMPLETE — IMPLEMENTED-IN-DEV with the breach recorded, not erased.

## Debt census dispositions (D1–D7)

- **D1 pairing race-A — FIXED** (`c4145ff`): the true-simultaneous loser now
  recovers by re-reading the authoritative row and returns ALREADY_PAIRED
  with the ORIGINAL receipt; 20-iteration determinism run green (every
  iteration exactly [ALREADY_PAIRED, PAIRED], one receipt).
- **D2 T002 claim/redemption concurrency — DISCHARGED**: the exact races the
  T002 record owed are executed by the (post-record) race suites —
  redemption-races (redeem vs revoke both orders, exact-µs expiry boundary,
  Hub withdrawal, enrollment supersession, credential re-bind, redemption
  vs recovery both orders, replays, two fault injections), recovery-races,
  issuance/revocation races, replacement-cross-race, emergency-concurrency
  — all with genuinely separate connections, all re-executed green in this
  closeout. Those suites ARE the durable regression tests.
- **D3 T003 trusted-time concurrency — DISCHARGED** (new test): 20 iterations
  of two-session concurrent evaluation; the floor never regressed and landed
  on the maximum accepted source every time; every outcome governed.
- **D4 WS-10 sync-inbox flake — FIXED** (`d4431db`, separate test-infra
  commit): reproduced in isolation (the sliced uuidv7 is timestamp-only —
  200/200 collisions); fixture identity now per-run-random + counter; suite
  5× consecutively green; production sync behavior untouched.
- **D5 Hub 0028–0030 markers — FIXED** (`85418bd`): checksum-pinned legacy
  registry (exact three paths, exact committed bytes, historical marker
  matching sequence). Proven: clean run fully green (first time ever);
  mutated legacy file FAILS; a new legacy-form file FAILS; the current
  standard unchanged.
- **D6 one-active-Hub door enforcement — VERIFIED**: race family 12 runs
  twenty CHAINED double-cutover generations; the Location held EXACTLY ONE
  live store_hub after every race and every cutover journalled once.
  Schema-level uniqueness remains a recorded design decision — the door
  serialization is now concurrency-proven, not just sequential.
- **D7 KLRISK-DEVICE-002 verification — EXECUTED at T007 depth**: the
  containment surface was raced adversarially (family 11) and its
  apply/clear deadlock FOUND AND FIXED; the 0177 sequential adversarial
  suite re-ran green from zero. Independent human-shaped review remains
  T008; the signed disposition remains BLK-005.

## Product defects found by T007 and fixed forward (cloud 0181, `b4f5ac3`)

1. **Containment apply/clear deadlock** (family 11): AB/BA lock inversion
   between the 0177 doors — `deadlock detected` escaped ungoverned.
   `clear_device_containment_v1` re-created devices-first; contract
   unchanged; race now converges governed in 20/20 iterations.
2. **Assignment idempotency race** (family 15): `assign_release_v1`
   SELECT-then-INSERT let a concurrent duplicate escape as a raw unique
   violation. The INSERT now owns the race; both callers converge on ONE
   business effect (EXISTING) or the governed conflict sentinel.

Both fixes follow the locked rule: forward migration, previous migrations
immutable, on-apply guard proving owners and the convergence handler.

## Race matrix (all 16 families, separate sessions, governed outcomes)

| #   | Family                           | Evidence                                                                             |
| --- | -------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | code issue vs revoke             | issuance + revocation race suites                                                    |
| 2   | issue vs expiry                  | redemption-races B (exact-µs boundary), expiration suite                             |
| 3   | recovery vs presentation         | recovery-races C1/C2/D1, redemption-races F                                          |
| 4   | proof vs supersession            | redemption-races D                                                                   |
| 5   | redemption vs revocation         | redemption-races A1/A2/E                                                             |
| 6   | activation vs cert revocation    | terminal-activation races A–D                                                        |
| 7   | pairing vs withdrawal            | pairing race D + stale-authority case                                                |
| 8   | two pairing completions          | race A + NEW 20-iteration determinism (D1)                                           |
| 9   | heartbeat dup/out-of-order       | terminal-health (parallel duplicate, lower-sequence refusal, delayed-report history) |
| 10  | support approve vs revoke        | NEW t007-cloud-races (20 iters)                                                      |
| 11  | containment apply vs clear       | NEW t007-cloud-races (20 iters; found the deadlock)                                  |
| 12  | two Hub cutovers                 | NEW t007-cloud-races (20 chained generations; D6)                                    |
| 13  | restore activation vs retirement | NEW t007-hub-races (20 iters; retirement always stands)                              |
| 14  | promotion vs revocation          | NEW t007-cloud-races (20 iters; revocation always total)                             |
| 15  | two release assignments          | NEW t007-cloud-races (20 iters; found the race)                                      |
| 16  | promotion vs rollback            | NEW t007-hub-races (20 iters; matrix refuses the loser, one-rollback pin held)       |

## Security, isolation, cryptography (§11–§13)

Executed by the from-zero closeout run: cloud `db:test` **242 PASS lines,
zero failures** — every boundary's direct-ACL AND effective-execution
census (provisioning, activation, pairing receipts, edge sync ingestion,
fleet health, containment/support, replacement, release authority, backup
governors; NOINHERIT gateways; service_role/anon/authenticated refusals;
FORCE RLS everywhere), the full rls-tests scope matrix in-run, and the
adversarial crypto families (forged PoP, challenge/acknowledgment
transplant, pairing reflection/transplant, wrong/revoked/expired
certificates, signed-discovery alteration, receipt tampering, manifest
tampering, digest/size/architecture mismatch, downgrade and revoked-replay)
across the pairing, activation, release-manifest, release-cache and
snapshot suites. Log/event residue: the terminal-health outbox residue
probe, pairing zero-residue refusals, the T004 residue-spendability census,
and `secret:scan` (now 1397 files) all green.

## Offline, restart, recovery (§14–§16)

Executed: hub-offline-operation, offline-reconnect (ordered retry, one
business effect, no duplicate history), hub-live-gate-offline-revocation,
hub-revocation-offline, pairing offline/stale-authority cases (LAN pairing
consumes ONLY Hub-local authority), terminal-health Hub-time authority,
sync-configuration keep-last-good; restart: hub-restart-recovery,
hub-crash-recovery, the pairing restart quartet, release-agent durable
resume (§13 prechecks re-proven), release-cache resumable download with a
REAL interruption, terminal-health restart-shaped re-runs; recovery:
destructive encrypted backup round trip **2/2** (corrupt backup never
selectable, wrong-scope quarantined, outbox identity byte-stable), restore
quarantine + F13 retirement races, rollback-never-touches-the-database
(release-agent), re-pairing after identity change (0037 gates).

## Fault injection (§18)

Executed: redemption faults A/B (post-consumption and BIND-path),
activation mid-flight fault, pairing fault-between-proof-and-receipt and
fault-then-restart-completes-once, outbox atomicity suite, release-cache
interrupted download, backup corrupt/wrong-scope injections. All faults
are injected through transaction-boundary hooks that roll back with the
transaction — the residue census left zero fault controls behind.

## Final verification run (§20, executed once)

Cloud validate 80 files → reset 0000→**0181** → seed twice (second
idempotent: `INSERT 0 0`) → `db:test` exit 0, **242 PASS, zero failures**
(rls in-run) → hub validate **fully green** (checksum-pinned legacy) →
hub reset 0000→0039 → seed → **43 PASS** → destructive backup **2/2** →
hub rebuilt to canonical → **pnpm verify 11/12** — Unit tests PASS (the
full monorepo green with race-A and sync-inbox fixed); the ONLY failing
gate is the pre-existing Format condition. One earlier verify attempt
showed an uncaptured intermittent unit failure; the immediately following
standalone full `pnpm test` (exit 0) and the complete captured verify run
were both green — the intermittent is recorded, not hidden → secret scan **1397 clean** → formatting targeted to
changed files only. The repository-wide CRLF format condition (876 files,
measured 2026-08-06) is PRE-EXISTING, reported separately, intersection
with T007 files EMPTY.

## Rebuild Test

The two race suites carry their family map, iteration standard and
governed-outcome contract in-file with the decision citation; 0181 carries
the defect narrative, the found-by evidence and its guard; the scanner and
validator pins carry their checksums and their reasons; the debt census
links every disposition to its source record. A rebuild from the
repository alone reproduces both the capability and the verification.

## Blockers (unchanged, fail-closed)

BLK-005 (pilot/production PKI + hardware certification; Pilot/Stable
promotion refusal re-proven from zero), BLK-006 (production transport and
producers), BLK-007 (KLREQ-008 testing-and-evidence-system document still
missing — the canonical security test system now carries its FIRST
executed subset). Physical Pi/Electron slot adapters remain the recorded
T006 hardware seam.

## Rollback

Revert `0829f66`, `ec4dd18`, `b4f5ac3`, `85418bd`, `d4431db`, `c4145ff`,
`debe553`, `b031cb8` in that order; both databases replay from zero.
