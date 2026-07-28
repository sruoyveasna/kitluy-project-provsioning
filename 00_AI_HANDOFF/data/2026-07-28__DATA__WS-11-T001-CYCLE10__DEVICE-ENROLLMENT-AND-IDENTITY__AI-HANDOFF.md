# AI Handoff — WS-11-T001 · device enrollment and identity records (Cycle 10)

| Field           | Value                                                       |
| --------------- | ----------------------------------------------------------- |
| Task ID         | WS-11-T001                                                  |
| Date / timezone | 2026-07-28 · Asia/Phnom_Penh                                |
| Repository root | C:/dev/HET-KITLUY-PROJECT                                   |
| Cycle           | 10 — WS-11 device provisioning and fleet management         |
| Status claimed  | **WS-11 — SCAFFOLDED / IN PROGRESS** (T001 of 8)            |
| Blocker         | **BLK-005 OPEN.** Production activation and signer BLOCKED. |

## Authority applied

- Cycle 10 T001 owner instruction (2026-07-28) — the allowed/blocked split, the
  identity model, the NVMe replacement order, and the status boundary.
- `docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md`
  §3 identity layers, §4 manufacturing enrollment, §8 clone defense,
  §11 repair/NVMe/replacement, §13 data model, §14 tests.
- `docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md`
  — `kitluy_devices` schema ownership registry row and relation dictionary.
- KLD-2026-07-21-003 (OWNER-LOCKED provisioning chain), preserved unchanged.
- Repository rules 4 (no secrets), 5 (no claiming scaffolded work implemented),
  9 (`[REQUIRED: ...]` never guessed), 11 (append-only), and KL-INF-P1-037.

## Files created / changed

| File                                                                          | Change                                         |
| ----------------------------------------------------------------------------- | ---------------------------------------------- |
| `supabase/migrations/20260728120120_0120_device_enrollment_and_identity.sql`  | NEW — `kitluy_devices`, 11 relations, additive |
| `supabase/tests/assertions.sql`                                               | +section 28 (28a-28k), 11 PASS notices         |
| `supabase/tests/rls-tests.sql`                                                | +WS11-N1..N4, WS11-P1                          |
| `packages/device-identity/src/index.ts`                                       | SCAFFOLDED stub → identity model + interfaces  |
| `packages/device-identity/test/device-identity.test.ts`                       | NEW — 24 tests                                 |
| `packages/device-identity/package.json`                                       | +vitest, +test script                          |
| `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`   | NEW — 12-item owner/security ballot            |
| `docs/evidence/phase1/ws-11/WS-11-T001-EXECUTION-EVIDENCE.md`                 | NEW                                            |
| `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md` | +WS-11 row; RV-005 metric correction           |
| `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`        | +C37, +G12, +D1-D6, +metric correction         |
| `00_AI_HANDOFF/000_BLOCKERS.md`                                               | BLK-005 gains the ballot and the verified gate |
| `00_AI_HANDOFF/000_ACTIVE_PHASE.md`                                           | §10 gains the BLK-005 hard gate and boundary   |

## Commands executed (with actual results)

| Command                                      | Result                                                |
| -------------------------------------------- | ----------------------------------------------------- |
| `pnpm db:reset` (from zero)                  | PASS — 13 groups, 0120 applied last                   |
| `pnpm db:seed`                               | PASS                                                  |
| `pnpm db:test`                               | PASS — **140** `NOTICE:  PASS` (124 + 16)             |
| `pnpm test:rls`                              | PASS — **100** notices / **99** distinct cases        |
| `pnpm hub:db:reset` + `hub:db:seed`          | PASS — 27 migrations (run SEPARATELY, KLRISK-HUB-006) |
| `pnpm hub:db:test`                           | PASS — **35** (unchanged)                             |
| `pnpm --filter @kitluy/device-identity test` | PASS — **24 passed**                                  |
| `pnpm test`                                  | PASS — 61/61 tasks                                    |
| `pnpm verify`                                | **PASS — 11/11**                                      |
| `pnpm docs:verify`                           | **PASS — 8/8**                                        |
| `pnpm secret:scan`                           | PASS — 1068 tracked files                             |

## Tests: passed / failed / not run

Passed as above. **Not run:** integration, e2e, security, load, recovery and
hardware suites — all still BLOCKED by design (`scripts/testing/blocked.mjs`).
No cloud↔Hub integration run exists, so nothing here is INTEGRATION-VERIFIED.

## Decisions made

None that bind the owner. Every cryptographic decision is deferred to the
BLK-005 ballot rather than taken. Engineering choices recorded in the evidence:
duplicate hardware signals are detected by INDEX rather than rejected by a
UNIQUE constraint (a clone rejected by a constraint leaves no evidence), and
refusal evidence is written by the caller in a new transaction (see C37).

## Conflicts discovered

- **C37** — refusal evidence written inside the refusing transaction is erased
  by the refusal. Same shape as WS-10's `verifySnapshot`. Found by a test
  written to fail if the evidence were absent; it failed. RESOLVED in 0120.
- **D1-D6** — `kitluy_devices` relation deviations from the DD relation
  dictionary and trust policy §13. The DD owes an amendment for D1-D5 before
  WS-11 closes.
- **Evidence-metric correction** — RV-005's claim that "the 95 is a miscount"
  was itself wrong, measured directly. 94 distinct cases, 95 PASS notices;
  `KLSEC-036` emits two.

## Required values discovered

All twelve BLK-005 ballot items, plus the new **G12 clock bootstrap** gap
(ballot item 11): certificate validity is a time window, and nothing in the
repository establishes trusted time on an RTC-less Pi that boots offline.

## Security findings

- PUBLIC EXECUTE revoked on every `kitluy_devices` function at creation, applying
  the WS-10 migration-0020 lesson pre-emptively rather than after a finding.
- The BLK-005 gate is proven to refuse in all three environments, and proven
  un-fakeable five ways including a placeholder or `[REQUIRED: ...]` approval
  reference. A client can neither read nor insert the gate table nor execute the
  governance procedures.
- `private_key_carried_over` is pinned false by CHECK, and re-enrollment refuses
  the prior public-key fingerprint — the "no copied keys" rule enforced from
  both sides.

## Known limitations

See evidence §8. In short: no CA, no issuance, no key generation, no revocation
distribution, no signer, no production activation, no production caller for any
0120 function, no assignment lifecycle, no independent review yet.

## Current implementation status (evidence register delta)

`WS-11 device provisioning and fleet management` — **SCAFFOLDED / IN PROGRESS**
(2026-07-28, T001 of 8). It does **not** advance to `IMPLEMENTED-IN-DEV`, and
cannot while BLK-005 is open.

## Recommended next task

Two options, and they are not equivalent:

1. **Rule BLK-005** (items 1, 2, 3, 7 alone would unblock the development-
   environment trust chain). Items 6 and 11 are the commercial-risk items —
   they decide what a Cambodian Store does during an internet outage. Item 8 is
   what the WS-10 production signer is waiting on.
2. **WS-11-T002** — Hub claim, activation and scope assignment (steps 3-5).
   The assignment model, assignment-generation issuance and revocation are all
   in the allowed-before-BLK-005 list, so T002 can proceed; its _activation_
   half will land against the same closed gate T001 built.

The push url remains disabled. This work is committed locally and held.
