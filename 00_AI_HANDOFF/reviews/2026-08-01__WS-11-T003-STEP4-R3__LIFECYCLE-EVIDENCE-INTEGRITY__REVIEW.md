# KitLuy Independent Review Record

## 0. Review identity

| Field           | Value                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Task ID         | `WS-11-T003 Step 4`                                                                                            |
| Task title      | `Step-4 closing: 30-stage production lifecycle, residue census, reviewer-condition repairs`                     |
| Reviewer        | `R3 — lifecycle and evidence integrity (independent; did not write any work under review)`                      |
| Review role     | `independent review agent`                                                                                     |
| Reviewed commit | `6ba2d52c89de3add21701dd297921cb1ae8c777b` (HEAD at review time; `git status --porcelain` shows only the two untracked R1/R2 records) |
| Base commit     | `2a54e1c` (twelve commits reviewed: `2a54e1c..6ba2d52`)                                                         |
| Branch/worktree | `main` @ `C:\Users\Hello-Evo-PC\Desktop\HET-KITLUY-PROJECT`                                                    |
| Review date     | `2026-08-01`                                                                                                   |
| Decision        | `APPROVED`                                                                                                     |

## 1. Independence check

- Reviewer was not the primary writer: `PASS` (the twelve commits are a single-author chain by Soenghak Choeurn; this reviewer wrote none of them).
- Reviewer did not modify the task branch: `PASS` (no commits, no push, no tracked-file edits, no database resets; only this review record was created; all psql below was read-only catalog/fact queries).
- Reviewed commit matches evidence commit: `PASS` (every command below ran against the checkout at `6ba2d52`; live cloud DB carries migrations through `20260731220000`/0160, hub DB journal through `0030` — 31 rows, top `0030_governed_snapshot_staging.sql`).

## 2. Materials reviewed

- task file: no `00_AI_HANDOFF/tasks/WS-11-T003*.md` exists; the operative specification is the Section-15 R3 inspection list (ten items) plus the Step-4 handoff chain.
- handoff: `00_AI_HANDOFF/shared/2026-07-31__SHARED__WS-11-T003-STEP4__LIFECYCLE-CENSUS-AND-INDEPENDENT-REVIEW__AI-HANDOFF.md` (the six blocking findings the twelve commits close: A1, B2, B3, B4, C4, C8).
- prior reviews (read; scope not re-litigated except where it intersects R3's): `00_AI_HANDOFF/reviews/2026-08-01__WS-11-T003-STEP4-R1__HUB-RUNTIME-SNAPSHOT-SECURITY__REVIEW.md` (APPROVED), `00_AI_HANDOFF/reviews/2026-08-01__WS-11-T003-STEP4-R2__JOBS-PERMISSIONS-POST-APPROVAL__REVIEW.md` (APPROVED-WITH-CONDITIONS).
- evidence: commits `9a9ca04, 24cb688, 5fd9522, 9ed400a, bbbbf39, c51cf19, 667f6d4, e86b8bd, b548e50, 7d89394, 1dcc38f, 6ba2d52`; `services/kitluy-device-registry-service/test/production-lifecycle.integration.test.ts` (1793 lines, read in full); `test/residue-spendability-census.integration.test.ts` (425 lines, read in full); `src/composition.ts` (153 lines, read in full); `supabase/migrations/20260730110146_0146_authoritative_revocation_scope.sql:199-327`; `services/kitluy-hub-agent/src/hub/revocation-trust.ts:74-251`; `src/revocation-routes.ts:272-286`; live databases.
- source authorities: AGENTS.md locked rules; the lifecycle file header's own §12 mapping declaration (lines 1-48).
- diff range: `2a54e1c..6ba2d52`.

## 3. Scope and file ownership

| Check                                  | Result  | Notes |
| -------------------------------------- | ------- | ----- |
| Changed files stay within allowlist    | `PASS`  | The twelve commits touch hub-agent, device-registry-service src/test, device-identity test support, cloud migrations 0159/0160, hub migrations 0029/0030, vitest configs, root package.json — the Step-4 remediation surface only (R1/R2 concur). |
| No overlapping active task ownership   | `PASS`  | Single-author linear chain on `main`; R1/R2 cover disjoint inspection lists with no file conflicts. |
| Non-goals/prohibited changes preserved | `PASS`  | No APPLIED migration rewritten — independently spot-confirmed: file sha256 `677e8bc74ed4…` (0029) and `9c7146ba0229…` (0030) equal the live hub journal checksums. No push. No database reset (journal and migration state intact before and after my runs). |
| Dependencies/base commit valid         | `PASS`  | Base `2a54e1c` is the documented NOT-PROMOTED state; the twelve commits build on it linearly. |

## 4. Acceptance-criteria review (Section 15, R3 items 1–10)

| AC ID | Primary evidence | Reviewer verification | Result | Notes |
| ----- | ---------------- | --------------------- | ------ | ----- |
| R3-1 All 30 stages reproduce | commit b548e50 | Ran `pnpm vitest run test/production-lifecycle.integration.test.ts` (07:20:25): **30 passed / 0 failed / 0 skipped**, 1 file; stderr `[lifecycle f5a11597] correlation=6a03b762-831c-4b36-aac4-70b906b61710 executed=30/30 stages=[1,2,…,30]` — one correlation id. Reproduced a second time inside the full run (07:21, `executed=30/30`, correlation `9230f9d2`). All 30 `it(stage(n, …))` bodies read in full and mapped to the §12-named life (table below). | `PASS` | Honest-mappings paragraph assessed: stages 4/6 and the pre/post-revocation snapshot ordering are DECLARED in the header (lines 26-43) and the code matches the declarations — see R3-1 mapping notes and RV-301/302. Not hidden dilution. |
| R3-2 Stage markers after assertions | file inspection | All 30 `passed(n)` calls sit at the END of their stage bodies (lines 661, 672, 683, 698, 720, 753, 768, 776, 789, 809, 824, 842, 865, 896, 906, 955, 1024, 1037, 1054, 1186, 1225, 1245, 1303, 1345, 1387, 1455, 1491, 1577, 1705, 1770) — each preceded only by assertions. Stage 30 asserts `[...executed]` equals exactly `1..29` (lines 1762-1765) BEFORE `passed(30)` (line 1770). The two narrowing guards (`if (!outcome.known) return;` line 784; `if (denied.known)` line 1169) are each preceded by a hard `expect(...known).toBe(true)`, so a false `known` throws before the guard — no early-return can skip a marker silently. | `PASS` | |
| R3-3 No vacuous assertions | full-file scan | Repo grep over the lifecycle file: ZERO hits for `toBeTruthy`, `toBeGreaterThanOrEqual(0)`, `>= 0` count patterns, `.resolves`, `not.toThrow`. Every `toBeGreaterThanOrEqual` present is non-vacuous: status `≥ 400` on refusals (lines 302, 1260, each paired with a body-code assertion), counts `≥ 1` (lines 697, 738, 1698). Enumerated bound: stage 26 live-evidence `≤ 3` with the deliberately unspent rows named in comment. No assertion passes with the database down (the suite hard-skips via `describe.skipIf(!live)` only when unreachable; both DBs were live) or with the governed door deleted (every strong claim queries post-state in the database). Spot-checked strongest claims: stage 16 exact `"superseded:1,issued:2"`; stage 17 exact `"superseded:1,superseded:3,active:4"`; stage 20 `CERT_REVOKED` + zero UPDATE writers; stage 21 scope `toEqual([threadB.credentialId])`; stage 26 jobs `toEqual([{status:"completed",n:"3"}])`. | `PASS` | Three NOTE-level softened spots recorded as RV-301/302/303; none proves less than its stage's primary claim. |
| R3-4 Runtime composition selection | `src/composition.ts` | Every emergency state change goes through `runtime.revocationRouter.handle` (`call()`, lines 238-244; used by stages 21/23/24/25's emergencies and post-approvals). The lapse has NO HTTP route by design (route table `revocation-routes.ts:272-286` = normal / emergency / post-approval / status only); stages 23/25 invoke `runtime.service.lapseEmergencyPostApproval` — the same method the shipped worker calls (R2-verified wiring), so the shipped surface is used for lapse too. The privileged `keeper` only provisions fixtures (beforeAll actors, stage-20 approval rows, stage-28/29 governed-door drivers under `withRole(issuanceService)`) and asserts. The one raw write (stage 25 deadline-earlier move, lines 1353-1358) has its reverse direction proved refused inline (`+ interval '10 years'` → `rejects.toThrow()`, lines 1359-1366). `resolveDeviceRevocationService` refuses implementation overrides: `FORBIDDEN_IMPLEMENTATION_OVERRIDES` (`composition.ts:53-58`) with the throw-loop at `:101-111`, no gateway/client/factory seam, authenticator defaulting to `refuseAllRequests`; the refusal is asserted by `production-composition.test.ts:77-78` (25/25 green in my full run). | `PASS` | |
| R3-5 Normal and emergency revocation | stages 20, 21 | Stage 20: `runtime.service.revokeNormal` → outcome `REVOKED`; credential gen 4 `state=revoked`; approval bound to a DATABASE-derived digest — `authoritative_revocation_scope_v1` derives the set (its `payload_hash` planted on the approval fixture), and the door RE-DERIVES and compares at `0146:280-299` (`KLUY-CRED-REVOCATION-SCOPE-HASH-MISMATCH` on divergence), EXECUTE granted to `kitluy_issuance_service` only, PUBLIC revoked (`0146:316-322`). Stage 21: emergency through the shipped route → 201 `REVOKED_IMMEDIATELY`, `revokedCredentialCount=1`; scope row set is exactly `[threadB.credentialId]`; bystander/C/D `revoked_at` null; evidence CONSUMED exactly once bound to the authorization. | `PASS` | |
| R3-6 Online and offline denial | stages 20, 30 | Online: `verifyGenerationOnline(4, …)` post-revocation → `known=true` (asserted first), `validity.valid=false`, `rejectionCode="CERT_REVOKED"` (lines 1164-1174). Offline: stage 30 on a FRESH `pg.Pool` → `decideOffline` = `DENY` for the revoked spine serial, `ALLOW` for the bystander (lines 1732-1746); after an older-sequence replay (refused, `lastKnownGoodPreserved=true`) the serial stays `DENY` (lines 1750-1758). Both reproduced live twice. | `PASS` | |
| R3-7 Recovery, replacement, destruction, reconciliation | stages 27-29 | Stage 27: disposition `REPROVISION_REQUIRED` recorded; the file's pg_proc sweep for `%reinstate%`/`%restore%`/`%unrevoke%` in `kitluy_devices` returns `[]` — INDEPENDENTLY REPRODUCED with my own query (empty in `kitluy_devices`, and empty across `kitluy_devices`/`kitluy_auth`/`kitluy_ops`); credential still `revoked`. Stage 28: replacement ISSUED at generation 5 (`toBeGreaterThan(4)`), new id ≠ revoked id, revoked generation stays `revoked`. Stage 29: eligibility `eligible=true` after a real reconciliation record through the governed function; four-eyes (requester `operator:lifecycle-requester` ≠ approver `operator:lifecycle-approver`); `executeProviderKeyDestruction` → `DESTROYED` against the real `rotationProvider` from stage 17; key row `destroyed` with `destroyed_at` non-null; reconciliation count `≥ 1`; credential still `revoked`. | `PASS` | |
| R3-8 Restart and reconnection | stage 30 | Restart uses `const restarted = new pg.Pool({ connectionString: HUB_DSN, max: 1 })` (line 1732) — a NEW pool, not a cache; ended in `finally`. Replay: `produceSnapshot(1)` after `produceSnapshot(2)` was applied → `applied=false`, `lastKnownGoodPreserved=true`; the code path returns `reason:"SEQUENCE_NOT_NEWER", lastKnownGoodPreserved:true` at `revocation-trust.ts:236-241` (reason string asserted in the hub-agent suites per R1; the lifecycle asserts the behavior, not the string — RV-301). | `PASS` | |
| R3-9 Final spendability census | commit 6ba2d52 | Ran `pnpm vitest run test/residue-spendability-census.integration.test.ts` (07:20:44): **14 passed / 0 failed / 0 skipped**. `[census spendable]` at HEAD: `spendable_evidence "0"`, `effective_temporary_grants "0"`, `leaked_memberships "0"`, `job_governor_recorded_exception "0"`, `test_clock_policy_rows "0"`, `overdue_unresolved_authorizations "0"`, `legacy_reachable "0"`, `unsafe_builder_runtime_access "0"`, `unsigned_active_hub_snapshots "0"`, `cross_scope_active_hub_snapshots "0"`, `sync_worker_active_snapshot_mutation "0"`, `abandoned_durable_jobs "0"` — reconciles with Section 13's zero-list, with the two documented bound checks (temporary grants `≤ 8`, live evidence `≤ 8`) both reading 0; the R1-RV-001/R2-RV-001 row (run d7df9017) self-expired 2026-08-01 00:16:52Z and is recorded in the file (lines 160-168). Green again inside the full run (07:21). | `PASS` | R1-RV-001, R2-RV-001 and R2-RV-005 are committed at HEAD (6ba2d52: retitle + header rewrite + grant record — verified lines 7-24, 153-170). R2's RV-002/RV-003 conditions remain OPEN at HEAD — see RV-304. |
| R3-10 Evidence-integrity cross-check | `git log 2a54e1c..HEAD` | Twelve commits. `git log b548e50..HEAD -- production-lifecycle.integration.test.ts` is EMPTY — the lifecycle file is unchanged since its authoring commit, so R1's and R2's lifecycle runs and mine all exercised the identical file. The census was edited in `7d89394` and again in `6ba2d52` — the latter (07:14) AFTER R2's last full-suite green at `1dcc38f` (07:03); that edit was therefore unverified by any full-suite run until THIS review's full run at HEAD (07:21: **219/219**, census green in-run). No test edit in the range remains unverified. | `PASS` | |

### R3-1 stage mapping (all 30 bodies → the §12-named device-credential life)

| # | File stage name | Life stage it proves | Mapping note |
| - | --------------- | -------------------- | ------------ |
| 1-3 | Tenant / Digital Store / Location creation | org spine exists, ownership chain exact | direct |
| 4 | Store Hub provisioning | governed claim+redeem ran for the spine | HONEST MAPPING declared (header lines 28-34): no separate hub-device row exists in this schema; the stage asserts the redeemed claim the governed path created — code matches declaration |
| 5 | Hub trusted public-key provisioning | trust registry holds THIS run's public key, no private half | direct |
| 6 | Hub assignment | assignment binds Tenant/Store/Location; snapshot base sequence derived | HONEST MAPPING declared (same paragraph) — code matches |
| 7-9 | Device enrollment / initial issuance / online authentication | identity born and authenticating through the production verifier | direct |
| 10-15 | Snapshot production / transfer / signature verify / scope verify / atomic persistence / offline authentication | signed scope-isolated snapshot chain, pre-revocation content | PRE-REVOCATION BY DESIGN, declared (header lines 35-38): stage 10 asserts the run's serials ABSENT; the post-revocation content proof is stage 30 — code matches |
| 16-19 | Same-key renewal / key rotation / overlap verify / retirement | credential life on the spine, exact state strings | direct |
| 20 | Governed normal revocation | `revokeNormal` → bound v1, digest-bound approval, CERT_REVOKED online | direct |
| 21 | Governed emergency revocation | shipped route, scope of exactly one credential | direct |
| 22 | Durable lapse-job scheduling | obligation enqueued, PENDING with future deadline, status route | direct |
| 23-25 | APPROVE / REFUSE / lapse branches | four eyes, terminal verdicts, escalation, never-restores | four-credentials rationale declared (header lines 14-24): one authorization takes exactly ONE terminal verdict, so three threads are required — sound, not dilution |
| 26 | MANUAL_SECURITY_REVIEW escalation | both losing branches reviewed, jobs drained terminal | direct |
| 27-29 | Recovery disposition / replacement / destruction+reconciliation | terminal endings | direct |
| 30 | Hub restart and cloud reconnection | post-revocation snapshot content, restart DENY/ALLOW, replay refused | doubles as the post-revocation proof for stages 10-15 — declared |

## 5. Technical review checklist

| Area                                          | Result  | Notes |
| --------------------------------------------- | ------- | ----- |
| Correctness and edge cases                    | `PASS`  | Deadline direction proved in both directions inline (stage 25); already-decided on both conflicting verdict and late lapse (stage 23); lapse attributes NOBODY (stage 25). |
| Contract/schema compatibility                 | `PASS`  | Snapshot schema pinned; route table unchanged; 0146 door contract honored by the exact fixture shape. |
| Migration safety and RLS                      | `PASS`  | No applied migration rewritten (journal checksums independently re-verified); no production application. |
| Tenant/Store/Location isolation               | `PASS`  | Stage 13 refuses a foreign-tenant snapshot `SCOPE_TENANT_MISMATCH` before signature; scope derived from the hub's own assignment, never caller-supplied. |
| Permissions, re-auth, approval, audit         | `PASS`  | Four-eyes enforced by rule while the responder holds BOTH grants (stage 23); distinct humans named on every verdict; digest-bound approval verified at the door (0146:280-299). |
| Append-only finance/payment/inventory/custody | `N/A`   | Not this change's surface; census confirms residue is retained, not deleted. |
| Idempotency, retries, replay, ordering        | `PASS`  | `ALREADY_AUTHORIZED`/`ALREADY_DECIDED` terminal replays; snapshot sequence monotonicity refused with last-known-good preserved. |
| Store Hub/offline/reconnect behavior          | `PASS`  | R3-6/R3-8 reproduced against the live hub DB on a fresh pool. |
| T1/T2/T3/T4 boundaries                        | `N/A`   | Unchanged by these commits. |
| Error, stale, partial and degraded states     | `PASS`  | Missing-envelope signature fails closed without an exception (stage 12); stale sequence refused (stages 14, 30). |
| Security, privacy, secrets and logging        | `PASS`  | Ephemeral per-run Ed25519 keys; trust registry holds no private half (stage 5 asserts `not.toContain("PRIVATE")`); no secrets in output. |
| Khmer/English, KHR/USD, timezone              | `N/A`   | No user-facing surface. |
| Accessibility and UX states                   | `N/A`   | No user-facing surface. |
| Observability and operations                  | `PASS`  | One correlation id per run printed with the executed set; census prints both buckets. |
| Test quality and negative coverage            | `PASS`  | Negative paths executable: unknown evidence refused, self-approval with both grants, foreign scope, stale/replayed sequence, +10-year deadline move, expired-ACTIVE spend (census). |
| Documentation and rebuildability              | `PASS`  | Headers state authority, honest mappings, and what is NOT claimed; the R2-RV-005 staleness is repaired at HEAD. |

## 6. Reviewer validation

Environment: Node v22.23.0, pnpm 9.15.9 (`/c/Users/Hello-Evo-PC/toolchains/node-22.23.0`), psql 17, `PGPASSWORD=postgres`; cloud DB `postgres` @127.0.0.1:54322 (through 0160 = `20260731220000`, seeded), hub DB `kitluy_hub_local` (through 0030, 31 journal rows, seeded). Neither database was reset; all psql was read-only.

| Command/check | Environment | Result | Evidence | Notes |
| ------------- | ----------- | ------ | -------- | ----- |
| `services/kitluy-device-registry-service: pnpm vitest run test/production-lifecycle.integration.test.ts` | live cloud+hub DB | `PASS` | **30 passed / 0 failed / 0 skipped**, Test Files 1 passed (1), 4.89s; stderr `[lifecycle f5a11597] correlation=6a03b762-… executed=30/30 stages=[1,2,…,30]` | R3-1/2/3/5/6/7/8 |
| `services/kitluy-device-registry-service: pnpm vitest run test/residue-spendability-census.integration.test.ts` | live cloud+hub DB | `PASS` | **14 passed / 0 failed / 0 skipped**, 1 file; `[census spendable]` all twelve buckets `"0"` | R3-9 |
| `services/kitluy-device-registry-service: pnpm vitest run` (FULL) | live cloud+hub DB | `PASS` | **219 passed / 0 failed / 0 skipped, Test Files 16 passed (16)**, 17.06s; lifecycle in-run `executed=30/30` (correlation `9230f9d2-…`); census in-run green, all spendable `"0"` | R3-10; matches the claimed 219/219 at HEAD |
| psql cloud: pg_proc sweep `%reinstate%`/`%restore%`/`%unrevoke%` in `kitluy_devices`; wider sweep across `kitluy_devices`/`kitluy_auth`/`kitluy_ops` | live cloud DB | `PASS` | both empty | R3-7 independent confirmation (stage 27's own query concurs) |
| psql cloud: `select max(version) from supabase_migrations.schema_migrations` | live cloud DB | `PASS` | `20260731220000` (0160) | DB intact, not reset |
| psql hub: journal top + count | live hub DB | `PASS` | top `0030_governed_snapshot_staging.sql`; 31 rows | DB intact, not reset |
| `sha256sum hub/migrations/0029*.sql hub/migrations/0030*.sql` vs `edge_ops.migration_journal` | repo + live hub DB | `PASS` | `677e8bc74ed4…` and `9c7146ba0229…` identical file-vs-journal | R1's RV-004 reproduces; no applied migration rewritten |
| grep lifecycle file: `toBeTruthy`, `toBeGreaterThanOrEqual(0)`, `>= 0` counts, `.resolves`, `not.toThrow` | repo | `PASS` | zero hits | prohibited-pattern scan |
| grep lifecycle file: `it.skip`, `describe.skip` (other than `skipIf(!live)`), `it.todo`, `.only(` | repo | `PASS` | zero hits | no hidden skips |
| `git log b548e50..HEAD -- production-lifecycle.integration.test.ts` | repo | `PASS` | empty — file unchanged since authoring | R3-10 |
| `git show 6ba2d52 --stat` | repo | `PASS` | 1 file (census), 28+/22- | the only post-`1dcc38f` test edit; now covered by my full run |
| inspection: `composition.ts` (full), `revocation-routes.ts` route table, `revocation-trust.ts:74-251`, `0146:199-327`, census file (full), lifecycle file (full, 1793 lines) | repo | `PASS` | as cited per item | R3-3/4/5/8 |
| `pnpm db:test` / `pnpm test:rls` / `pnpm hub:db:test` | — | `NOT RUN` | — | Not in R3's assigned list; shared-evidence-DB mutation class (R2's RV-003 count question stands as recorded there) |
| `kitluy-hub-agent` and `device-identity` suites | — | `NOT RUN` | — | R1's assigned scope; R1 ran them green at `1dcc38f` and nothing in `1dcc38f..6ba2d52` touches those packages (6ba2d52 = census only) |
| `pnpm verify` | — | `NOT RUN` | — | Not in R3's assigned list; the pre-existing repository-wide CRLF format condition is unchanged by these commits |

**Totals across executed vitest commands:** standalone lifecycle **30/30/0**, standalone census **14/14/0**, full registry suite **219 passed / 0 failed / 0 skipped (16 files)**. Every suite ran green on first attempt in this session.

## 7. Findings

| Finding ID | Severity | Path/location | Description | Required remediation | Blocking? |
| ---------- | -------- | ------------- | ----------- | -------------------- | --------- |
| `RV-301` | `NOTE` | `services/kitluy-device-registry-service/test/production-lifecycle.integration.test.ts:1750-1753` | Stage 30's reconnection replay asserts `applied=false` and `lastKnownGoodPreserved=true` but not the refusal reason string. The behavior is fully proven (the serial stays `DENY` at line 1758) and the `SEQUENCE_NOT_NEWER` code path is real (`revocation-trust.ts:236-241`) and reason-asserted in the hub-agent suites (R1). A future regression that refused replays for a DIFFERENT reason would still pass this stage. | Optional: assert `replay.reason === "SEQUENCE_NOT_NEWER"` for symmetry with stage 13's `SCOPE_TENANT_MISMATCH` assertion. | no |
| `RV-302` | `NOTE` | `services/kitluy-device-registry-service/test/production-lifecycle.integration.test.ts:863-864` | Stage 13's trailing assertion is a disjunction — `own.applied \|\| (!own.applied && own.reason === "SEQUENCE_NOT_NEWER")` — so it passes whether the hub's own snapshot applied or was refused as stale (an earlier stage-11 apply at the same sequence makes the stale branch the live one). The stage's PRIMARY claim (foreign scope refused `SCOPE_TENANT_MISMATCH` before signature, lines 856-861) is asserted strongly; the disjunction only weakens the secondary "own applies" half. | Optional: pin which branch is expected (e.g. produce at a fresh sequence) so both halves are exact. | no |
| `RV-303` | `NOTE` | `services/kitluy-device-registry-service/test/production-lifecycle.integration.test.ts:1407-1422` | Stage 26's live-evidence bound is `≤ 3` while its comment enumerates two deliberately unspent rows (B's self-approval attempt, B's post-decision conflicting REFUSE evidence). The bound is enumerated and non-tautological (the A3/C5 repair class), and the global census's `spendable_evidence ≤ 8` backstops it — but the per-run enumeration explains 2 of the allowed 3. | Optional: name the third headroom row or tighten to the exact expected count with the `.catch(() => null)` uncertainty recorded. | no |
| `RV-304` | `NOTE` | `services/kitluy-device-registry-service/test/production-lifecycle.integration.test.ts:642`; status of R2 conditions | R2's APPROVED-WITH-CONDITIONS conditions are only partially committed at HEAD: `6ba2d52` closes R1-RV-001, R2-RV-001 and R2-RV-005 (verified: retitled bound test at census line 153, rewritten header lines 7-24, expired-grant record lines 160-168). Still OPEN at HEAD: R2-RV-002 (the swallowed `disposeEmergencyActor … .catch(() => undefined)` teardown persists, e.g. lifecycle line 642) and R2-RV-003 (`db:test` "197 PASS" vs static 196 notices; `db:test` remains NOT RUN by all three reviewers under the assignment prohibition). Neither weakens a control in R3's scope; both remain owner-facing merge conditions per R2 §9. Also observed: census line 129 `toBeGreaterThanOrEqual(0)` on `evidence_total` is a tautological recording assertion — harmless (the test's purpose is to RECORD surviving history in the `surviving` bucket) and outside the lifecycle file my prohibited-pattern scan covers. | Owner disposition of R2's RV-002/RV-003 per R2's merge conditions; optional cleanup of the two micro-patterns. | no |

No CRITICAL, HIGH, MEDIUM or LOW findings in R3's scope.

## 8. Decision rationale

All ten assigned controls were verified in code AND reproduced against the live databases; nothing was taken from documentation, prior reviewers, or primary-agent claims alone.

The 30-stage lifecycle reproduces exactly as claimed — twice in this session (standalone 07:20 and inside the full suite 07:21), each time `executed=30/30 stages=[1..30]` under one correlation id, 30 passed / 0 failed / 0 skipped. The stage markers measure execution, not parsing: every `passed(n)` sits after its stage's assertions, and the final stage proves the executed set is exactly 1..29 before recording 30. The prohibited-pattern scan is clean — no `>= 0` counts, no truthiness-on-queries, no exception-only assertions — and every stage's strongest claim was spot-checked against what the code actually queries. The honest-mappings paragraph is honest: stages 4/6's schema-driven substitution and the pre/post-revocation snapshot split are declared in the header and the code matches the declarations; the post-revocation content proof lands at stage 30 against persisted hub state. Composition integrity holds: every emergency state change uses the shipped surface (`runtime.revocationRouter`; the route-less lapse uses the same service method the shipped worker calls), the keeper only provisions and asserts, the single raw write is declared with its reverse refused inline, and `resolveDeviceRevocationService` structurally refuses implementation overrides. Normal revocation is genuinely digest-bound (the door re-derives the affected set and refuses `SCOPE-HASH-MISMATCH`, verified at `0146:280-299`), the emergency scope is exactly one credential, online denial is `CERT_REVOKED`, offline denial survives a fresh-pool restart and an older-sequence replay, no reinstate/restore/unrevoke function exists (independently re-queried), replacement is a new generation with the revoked generation still revoked, and destruction runs four-eyes to `DESTROYED` with reconciliation and non-restoration proven. The census reproduces 14/14 with all twelve spendable buckets at zero at HEAD, reconciling Section 13's zero-list with its two documented bounds. Evidence integrity holds across the range: the lifecycle file is untouched since `b548e50`, the only post-review test edit (`6ba2d52`, census) is now covered by this review's full-suite run of 219/219 at HEAD, and hub journal checksums still match the files.

Four NOTE-level findings are thoroughness observations, none of which weakens a control; R2's two remaining conditions are owner-facing merge items recorded there, not defects in R3's scope. Verdict: **APPROVED**.

## 9. Merge conditions

- [x] reviewed commit is unchanged (`6ba2d52`; tree clean apart from the untracked R1/R2 review records);
- [x] all blocking findings resolved (none found by this review);
- [x] required validation/evidence complete (all assigned commands run; unassigned checks marked NOT RUN with reasons);
- [x] conflict records resolved (none opened by this review);
- [ ] R2's open conditions RV-002 (loud teardown) and RV-003 (db:test count) applied or explicitly accepted by the owner (carried from R2 §9; outside R3's scope, none re-opened here);
- [ ] branch updated to approved integration point (owner's merge decision);
- [ ] integration checks pass (full-repo `pnpm verify` not re-run by R3; claimed 12/13 with the pre-existing CRLF condition);
- [ ] authorized human approval obtained for sensitive implications (promotion of WS-11-T003 Step 4 remains the owner's decision; this review covers R3 scope only).

## 10. Reviewer truth statement

The reviewer did not treat documentation, a build, a prior review, or a primary-agent summary as proof of deployment, migration application, pilot operation, or production correctness. Every PASS above is backed by a command executed in this review session against the live databases or the checked-out tree at `6ba2d52`; every check not executed is marked NOT RUN with its reason. The lifecycle and census totals reported here are from this reviewer's own runs, not from the evidence register.
