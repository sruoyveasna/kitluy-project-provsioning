# WS-11-T004-P02B3C — REDEMPTION RACE, REPLAY AND COMPOSITION HARDENING — AI HANDOFF

| Field          | Value                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                                                                                                                                |
| Package        | WS-11-T004-P02B3C (redemption race, replay and provisioning-composition hardening)                                                                                                                                        |
| Status         | **IMPLEMENTED-IN-DEV — NO MIGRATION REQUIRED**                                                                                                                                                                            |
| Start SHA      | `d3d97d89a7f69f70a5c7398b4328ea85ccb8401b` (feat(ws-11): add atomic pop-bound redemption)                                                                                                                                 |
| End SHA        | recorded by `git log -1` after the package commit                                                                                                                                                                         |
| Branch / ahead | `main`, ~104 ahead at intake; push `disabled://push-requires-owner-approval` — **nothing pushed**                                                                                                                         |
| Toolchain      | **Node v22.23.0** (kitluy-toolchain), pnpm 9.15.9 (corepack), engine-strict=true                                                                                                                                          |
| Migration 0172 | **NOT created — deliberately.** Every race, replay, hostile and failure-injection scenario passed against the ACTIVE 0171 implementation; no executable evidence of any defect was found. Migrations 0000–0171 untouched. |

## 1. Files changed (complete list)

1. `services/kitluy-device-registry-service/test/provisioning-code-redemption-races.integration.test.ts` — new, 11 tests, zero skips.
2. This handoff + one `00_AI_HANDOFF/000_INDEX.md` row.

## 2. Lock-order audit (§6; pre-edit; verified against 0165/0166/0169/0170/0171/0121)

| Door                       | Effective order                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| redeem (0171)              | DEVICE → ASSIGNMENT → CODE → CHALLENGE; enrollment read and certificate select/insert UNDER the held device lock (the device lock IS the enrollment-currency lock) |
| revoke (0165)              | idempotency row → unlocked read → ASSIGNMENT → CODE                                                                                                                |
| expire (0166)              | unlocked read → ASSIGNMENT → CODE                                                                                                                                  |
| recover (0169)             | recovery-key row → ASSIGNMENT → … → CODE                                                                                                                           |
| attest (0170)              | challenge read → ASSIGNMENT → CODE → CHALLENGE                                                                                                                     |
| Hub/assignment door (0121) | DEVICE → assignment rows                                                                                                                                           |
| enrollment transition      | state-closing UPDATE on the append-only row (reenroll path; owner authority)                                                                                       |
| certificate transition     | status-closing UPDATE (no governed status-table revocation door exists — recorded below)                                                                           |

Findings: the global partial order **DEVICE < ASSIGNMENT < CODE < CHALLENGE**
holds across every door; no reversed ordering, no cycle. Every state decision
re-runs under the final locks; no stale Hub/enrollment/credential decision
reaches a mutation (proven E2/C2/D); no expected race exposed an uncontrolled
SQLSTATE. No theory-only change was made and none was needed.

## 3. Race results (staggered barriers; separate recorded backends — canonical run PIDs 406/407 throughout)

| Race                                | Serialization                                                    | Outcome                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 redeem vs revoke                 | redemption first                                                 | REDEEMED stands (proof CONSUMED, one credential, one REDEEMED event); revocation gets the 0165 stable `ALREADY-REDEEMED` classification; no REVOKED event, no reason overwrite — never both REVOKED and REDEEMED                                                                                           |
| A2 revoke vs redeem                 | revocation first                                                 | REVOKED stands with its one REVOKED event; redemption refuses `CODE-ALREADY-REVOKED`; **proof remains VERIFIED and unconsumed**; no credential, no REDEEMED/consumption                                                                                                                                    |
| B redeem vs canonical expiry        | exact µs boundary (`expires_at::text`, never a JS-ms round-trip) | EXPIRED is the one terminal state with exactly one EXPIRED event; redemption refuses the stable expired classification; proof unconsumed; no credential. **Control** (boundary−1s): full redemption commits                                                                                                |
| C1 redeem vs Hub withdrawal         | redemption first                                                 | redemption commits on commit-time Hub authority; the later governed withdrawal never rewrites history (code REDEEMED, proof CONSUMED, credential active)                                                                                                                                                   |
| C2 Hub withdrawal vs redeem         | withdrawal first                                                 | `HUB-INACTIVE` fail-closed; code ISSUED, proof VERIFIED, no credential, no event — stale Hub authority cannot redeem                                                                                                                                                                                       |
| D enrollment superseded first       | (sanctioned fixture — see §5)                                    | `ENROLLMENT-INELIGIBLE`; code ISSUED, proof VERIFIED unconsumed, no credential — a stale E1 binding never redeems, no proof substitution, no fingerprint rewrite                                                                                                                                           |
| E credential revoked between cycles | serial                                                           | the revoked credential is **never re-bound**; a fresh eligible development credential is issued (the authority explicitly allows issuance when no ACTIVE credential exists); exactly one active + one revoked-history row; replay of the FIRST redemption names the ORIGINAL credential and issues nothing |
| F1 redeem vs recovery               | redemption first                                                 | recovery refuses `KLUY-PROVCODE-ALREADY-REDEEMED`; **no recovery successor**, no recovery REVOKED event                                                                                                                                                                                                    |
| F2 recovery vs redeem               | recovery first                                                   | old code REVOKED + one fresh successor ISSUED; the predecessor proof refuses `CODE-ALREADY-REVOKED` and **cannot touch the successor** (the door derives the code FROM the proof — structural); successor stays ISSUED un-redeemed; predecessor proof unconsumed; no credential                            |

## 4. Replay and rollback evidence

- **Replay A (lost response):** `ALREADY_REDEEMED` with identical code /
  challenge / credential ids, identical `redeemed_at`, no raw code, no new
  event, no re-issued certificate. No cryptographic side effect is repeated.
- **Replay serial policy (RECORDED):** the certificate serial is
  FIRST-ISSUANCE INPUT, not replay identity — a replay with a different
  serial returns the committed result with the ORIGINAL serial and issues
  nothing (replay identity = idempotency key + assignment + challenge +
  presented-value digest).
- **Replay B (credential changes):** after the bound credential is revoked,
  the replay still names the ORIGINAL credential and never issues another —
  redemption replay is not credential recovery (reprovisioning runs the full
  fresh code+proof cycle, race E).
- **Replay C (Hub/enrollment changes):** after governed Hub withdrawal (C1
  scope) and enrollment supersession + credential revocation, the replay
  remains a pure history lookup: `ALREADY_REDEEMED`, no state change, no new
  credential — historical success and CURRENT operational eligibility are
  distinct and history is never rewritten.
- **Replay D (hostile):** same key + different assignment or challenge →
  `CONFLICTING-REPLAY` fail-closed; blank key → contract refusal; zero
  residue. Cross-scope inspection has no runtime path (harness-only doors;
  42501 probes re-proven for anon/authenticated/service_role).
- **Fault A (code transition faulted after in-flight proof consumption):**
  transaction-local governor trigger on the ISSUED→REDEEMED update → whole
  transaction aborts — proof back to VERIFIED with null `consumed_at`, code
  ISSUED, no credential, no event, no idempotency residue, no surviving
  fault mechanism; a clean retry redeems.
- **Fault B (REDEEMED-event faulted on the BIND path):** the pre-existing
  active credential binding is untouched (still exactly one active row),
  code ISSUED, proof VERIFIED, no event; the clean retry redeems with
  `credential_action = BOUND`.

## 5. Sanctioned fixtures (recorded limitations)

- **Enrollment supersession:** the governed `reenroll_device_v1` continuity
  path requires TPM/secure-element evidence that software-trust fixtures
  cannot prove (KLD-2026-07-28-002 §11 — a software device "CANNOT prove
  continuity and is refused"), so the enrollment was closed through its own
  state machine (`sealed→superseded` with `superseded_at`, permitted by the
  0120 append-only trigger) by the owning migration authority — the same
  authority the reenroll flow itself uses. Not silently skipped; limitation
  recorded.
- **Certificate revocation:** no governed status-table revocation door
  exists for `device_certificates` (artifact revocation lives in the
  0125–0128 signed-credential machinery); the status was closed by the
  governor fixture (`active→revoked` with reason), satisfying the table's
  own consistency constraints. A governed status-revocation door is a P02C-
  era composition question, recorded below.

## 6. Provisioning-composition readiness audit (what P02C must compose)

| Boundary                              | Classification                            | Notes                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trusted caller identity               | **MISSING**                               | no provisioning composition service role exists; every provisioning/PoP/redemption door is harness-only; P02C must mint the NOLOGIN composition role (the `kitluy_credential_issuer` pattern) and grant EXECUTE on exactly: issue/revoke/recover code doors (authenticated-human path), challenge, attestation and redemption doors (service path) |
| Input validation boundary             | **PARTIAL**                               | every door validates its own contract (proven); the HTTP/service-side request shaping does not exist                                                                                                                                                                                                                                               |
| Challenge issuance call               | **READY** (internal)                      | `issue_terminal_provisioning_pop_challenge_v1` proven; needs only the composition grant                                                                                                                                                                                                                                                            |
| Proof verification call               | **READY** (internal)                      | `verifyProvisioningPop` (service) + `record_terminal_provisioning_pop_verification_v1` proven under OPTION B                                                                                                                                                                                                                                       |
| Redemption call                       | **READY** (internal)                      | 0171 door proven, incl. this package's races/replays/faults                                                                                                                                                                                                                                                                                        |
| Safe result mapping                   | **PARTIAL**                               | door vocabularies are stable and documented; HTTP mapping absent                                                                                                                                                                                                                                                                                   |
| Retry / idempotency contract          | **READY** (internal)                      | idempotency keys + stable replays proven end-to-end at every door                                                                                                                                                                                                                                                                                  |
| Timeout / ambiguous-response behavior | **READY** (internal)                      | lost-response replays proven for issuance (0168), recovery (0169), attestation (0170) and redemption (this package)                                                                                                                                                                                                                                |
| Credential public-material response   | **READY** (internal)                      | 0171 returns safe public material only; HTTP shaping absent                                                                                                                                                                                                                                                                                        |
| Store Hub delivery boundary           | **OUT OF T004**                           | Hub credential delivery/persistence is later WS-11 work                                                                                                                                                                                                                                                                                            |
| Terminal acknowledgment boundary      | **MISSING**                               | no acknowledgment surface exists                                                                                                                                                                                                                                                                                                                   |
| Activation boundary                   | **OUT OF T004 (this package)**            | `attempt_activate_device_v1` exists for Hubs; terminal activation composition deliberately unclaimed                                                                                                                                                                                                                                               |
| Pairing-session boundary              | **OUT OF T004**                           | protocol §8 handshake absent (P01 rows E2/E7)                                                                                                                                                                                                                                                                                                      |
| Production grants                     | **MISSING (by design)**                   | P02C owns them; none exist                                                                                                                                                                                                                                                                                                                         |
| BLK-005 restrictions                  | **BLOCKED BY BLK-005** (pilot/production) | development approved; pilot/production fail closed inside `assert_pki_configuration_approved` — unchanged and re-exercised                                                                                                                                                                                                                         |
| Audit / observability                 | **PARTIAL**                               | append-only events + immutable challenge/redemption rows proven; service-level observability absent                                                                                                                                                                                                                                                |

No grant or endpoint was created for this audit.

## 7. Security / privilege evidence

Door 42501 for anon/authenticated/service_role; challenge mutation and
redemption-event insertion denied to runtime identities; raw-code census
across events and certificate serials: zero; no login-capable governor
member; zero suite grants / clock rows / borrowed memberships / fault
triggers after the run; 0168 replay privacy untouched (no grant surface
changed anywhere — this package is test + evidence only). BLK-005
fail-closed posture unchanged.

## 8. Verification (Node v22.23.0; fresh reset; cloud and Hub serialized)

| Command                                    | Exit | Result                                                                                                                                        |
| ------------------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:reset` (0000→0171) + seed ×2      | 0    | 70 applied; idempotent                                                                                                                        |
| `pnpm db:test`                             | 0    | **224 PASS, 0 FAIL** (baseline 224)                                                                                                           |
| `pnpm test:rls`                            | 0    | **126 PASS, 0 FAIL** (baseline 126)                                                                                                           |
| redemption race suite (one file)           | 0    | **11/11, zero skips**; PIDs 406/407 on every race                                                                                             |
| `pnpm hub:db:reset` + seed + test          | 0    | **35 PASS**                                                                                                                                   |
| registry full suite (serial)               | 0    | **313/313, 28 files, zero skips** (baseline 302 + 11; redemption 9/9, PoP 10/10, recovery races 14/14, lifecycle 30/30, residue census 14/14) |
| device-identity                            | 0    | **803/803**                                                                                                                                   |
| `pnpm migrations:validate` / `db:validate` | 0/0  | 70 files                                                                                                                                      |
| `pnpm secret:scan` / `clock:check`         | 0/0  | 1298 files clean / PASS                                                                                                                       |
| targeted `prettier` on the changed file    | 0    | clean                                                                                                                                         |
| `pnpm verify`                              | 1    | **11 of 12** — only the recorded pre-existing ~830-file `format:check` artifact (identical at clean HEAD; no package file flagged)            |

No baseline regressed: db:test 224→224, rls 126→126, registry 302→313
(27→28 files), device-identity 803→803, PoP 10→10, redemption 9→9, Hub
35→35, lifecycle 30→30, census 14→14. Zero skips.

## 9. Risks and unresolved values

1. Enrollment-supersession and certificate-revocation lifecycle races used
   the sanctioned owner-authority fixtures (§5) — the governed reenroll
   continuity and signed-artifact revocation flows have their own suites and
   were not re-driven here.
2. A governed status-table certificate-revocation door does not exist;
   whether P02C composition needs one (vs the 0125–0128 machinery) is an
   open design question, recorded for P02C.
3. The §6 audit's MISSING/PARTIAL rows are the exact P02C backlog; nothing
   here claims composition, delivery, activation, pairing, pilot or
   production readiness.

## 10. Rollback

`git revert <package commit>` — test + evidence only; no schema, grant or
runtime change. No database rollback needed.

## 11. P02C prerequisites (exact)

1. Mint the NOLOGIN provisioning-composition role and grant EXECUTE on the
   five internal doors (challenge, attestation, redemption) plus the service
   wiring for `verifyProvisioningPop`; keep the human doors
   (issue/revoke/recover) authenticated-scoped as today.
2. Compose the end-to-end flow (evaluate → challenge → sign → verify →
   attest → redeem) in the registry service with safe HTTP mapping, retries
   on the proven idempotency contracts, and observability.
3. Replace every `kitluy_test_harness` grant on provisioning doors with the
   composition role; run the final capability census.
4. Resolve the §6 MISSING rows or record them into successor tasks; BLK-005
   remains the pilot/production gate.

Do not mark WS-11-T004 complete.
