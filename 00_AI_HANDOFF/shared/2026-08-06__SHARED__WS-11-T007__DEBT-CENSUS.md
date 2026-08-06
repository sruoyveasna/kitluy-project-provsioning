# WS-11-T007 — Test and Debt Census (pre-change inventory)

| Field     | Value                                                   |
| --------- | ------------------------------------------------------- |
| Date      | 2026-08-06 · Asia/Phnom_Penh                            |
| Authority | KLD-2026-08-06-WS11-T007-001 (security test system §19) |
| Rule      | Created BEFORE any T007 product-behavior change         |

Every debt explicitly assigned to T007 by T001–T006 records, with its exact
source. Dispositions are filled during T007 and finalized at closeout.

## D1 — Pairing race-A loser result-code mapping

- **Source**: T005-P02 handoff §6 ("recorded here and in the decision
  register for the pairing owner/T007, not patched incidentally"); T004/T006
  closeouts carry it as the known unit-suite failure.
- **Recorded shape**: under a TRUE simultaneous completion the door's
  `KLUY-EDGE-PAIRING-CONSUMED` family maps to `PAIR_SESSION_CONSUMED`, not
  `ALREADY_PAIRED`; the TS `ALREADY_PAIRED` branch only catches a LATE
  loser, so the race loser surfaces `INTERNAL_ERROR`. Database state stays
  correct (one receipt, one paired timestamp, atomic outbox).
- **T007 obligation**: reproduce, fix the narrow mapping, prove a governed
  deterministic loser outcome over ≥20 controlled iterations.
- **Disposition**: **FIXED** (`c4145ff`): governed ALREADY_PAIRED recovery with the original receipt; 20-iteration determinism green.

## D2 — T002 claim/redemption concurrency

- **Source**: implementation-status register, WS-11-T002 row ("concurrency
  is proven by a partial unique index exercised sequentially, so a true
  concurrent-session test is owed to T007").
- **T007 obligation**: true concurrent-session claim/redemption races
  (issue vs revoke, issue vs expiry, redemption vs revocation, recovery vs
  presentation), governed outcomes, no duplicate authoritative row.
- **Disposition**: **DISCHARGED**: the exact owed races execute in the post-record race suites (redemption/recovery/issuance/revocation/replacement/emergency), separate sessions, re-run green in the T007 closeout; those suites are the durable regression tests.

## D3 — T003 Step-2 trusted-time concurrency

- **Source**: implementation-status register, WS-11-T003 Step 2 row
  ("no concurrent-session SQL race test (T007)").
- **T007 obligation**: concurrent floor-advancement / correction races
  proving the floor is monotonic under genuine concurrency and no caller
  clock establishes expiry.
- **Disposition**: **DISCHARGED** (new t007-cloud-races D3 test): 20 two-session iterations; the floor never regressed and landed on the maximum accepted source.

## D4 — WS-10 sync-inbox fixture flake (cross-workstream)

- **Source**: T004 final closeout ("deduplicates a redelivery of the SAME
  facts" flakes 3-of-5; fixture derives providerEventId from a truncated
  uuidv7, ~44 bits of ms timestamp, so two tests within ~16 ms mint the
  same dedupe triple; belongs to WS-10-T006, `e2390b2`).
- **T007 obligation**: reproduce separately; when proven fixture-only,
  replace with deterministic collision-free test identity in a SEPARATE
  test-infrastructure commit; product sync behavior untouched.
- **Disposition**: **FIXED** (`d4431db`, separate test-infra commit): timestamp-only fixture identity reproduced (200/200 collisions) and replaced; 5x consecutive green; product behavior untouched.

## D5 — Hub 0028–0030 legacy marker validation

- **Source**: recorded at T004 closeout and every closeout since; the three
  files predate the `-- kitluy:hub:migration:NNNN` marker rule and fail
  `hub:db:validate` (3 static checks) while being IMMUTABLE.
- **T007 obligation**: checksum-pinned legacy compatibility registry —
  exact three paths, exact committed checksums, exact historical marker
  contract; mutation or new-file use of the legacy form must fail.
- **Disposition**: **FIXED** (`85418bd`): checksum-pinned legacy registry; hub validate fully green for the first time; mutation and new-legacy-form probes FAIL.

## D6 — One-active-Hub-per-Location is door-enforced, not schema-enforced

- **Source**: T006-P01 handoff, "Recorded" ("a structural per-Location
  unique would rewrite the multi-hub dev fixtures, recorded honestly for
  T007 … T007 sweep item").
- **T007 obligation**: adversarial concurrent double-cutover race proving
  the door serialization holds under genuine concurrency (race family 12);
  schema enforcement remains a recorded design decision, not silently
  added.
- **Disposition**: **VERIFIED UNDER CONCURRENCY** (t007-cloud-races F12): twenty chained double-cutover generations, one live Hub after every race; schema-level uniqueness stays a recorded design decision.

## D7 — KLRISK-DEVICE-002 independent verification

- **Source**: 000_BLOCKERS 2026-08-06 note ("KLRISK-DEVICE-002
  RESOLVED-IN-DEV … independent verification T007/T008; signed disposition
  still BLK-005").
- **T007 obligation**: adversarial verification of restricted state,
  station containment and condition-4 recovery under T007's isolation and
  race matrices (T008 carries the independent review).
- **Disposition**: **EXECUTED AT T007 DEPTH**: containment raced adversarially (family 11 — found and fixed the 0177 deadlock via 0181); sequential adversarial suite green from zero. T008 carries the independent review; signed disposition stays BLK-005.

## Known conditions NOT owned by T007 (report-only)

- Repository-wide Prettier/CRLF format condition (876 files measured
  2026-08-06; deliberately not mass-formatted).
- BLK-005 (pilot/production PKI + hardware certification) and BLK-006
  (production transport/producers) remain fail-closed by design.
- Physical Pi boot-slot / Electron updater runtimes (T006 SlotAdapter gap)
  are hardware-certification work behind BLK-005's pilot gates.
