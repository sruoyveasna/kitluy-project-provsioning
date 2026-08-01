# KitLuy Independent Review Record

## 0. Review identity

| Field           | Value                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| Task ID         | `WS-11-T003 Step 4`                                                                                  |
| Task title      | `Step-4 completion: live hub gate, deployed lapse worker, builder removal, governed snapshot staging` |
| Reviewer        | `R1 — Hub runtime and snapshot security (independent; did not write any work under review)`          |
| Review role     | `independent review agent`                                                                           |
| Reviewed commit | `1dcc38f85605ca0810e658da59ddce604f7c9e4d`                                                           |
| Base commit     | `2a54e1c` (eleven commits reviewed: `2a54e1c..1dcc38f`)                                              |
| Branch/worktree | `main` @ `C:\Users\Hello-Evo-PC\Desktop\HET-KITLUY-PROJECT`                                          |
| Review date     | `2026-08-01`                                                                                         |
| Decision        | `APPROVED`                                                                                           |

## 1. Independence check

- Reviewer was not the primary writer: `PASS`.
- Reviewer did not modify the task branch: `PASS` (read-only review; no commits, no tracked-file edits; only this record was created).
- Reviewed commit matches evidence commit: `PASS` (`git log` at review time: HEAD `1dcc38f`, working tree clean).

## 2. Materials reviewed

- task file: no `00_AI_HANDOFF/tasks/WS-11-T003*.md` exists; the operative specification is the Section-15 R1 inspection list plus the Step-4 handoff chain.
- handoff: `00_AI_HANDOFF/shared/2026-07-31__SHARED__WS-11-T003-STEP4__LIFECYCLE-CENSUS-AND-INDEPENDENT-REVIEW__AI-HANDOFF.md` (the six blocking findings these eleven commits close: A1, B2, B3, B4, C4, C8).
- evidence: the eleven commits `9a9ca04, 24cb688, 5fd9522, 9ed400a, bbbbf39, c51cf19, 667f6d4, e86b8bd, b548e50, 7d89394, 1dcc38f`; live databases (`postgres` @54322 migrations through `20260731220000`/0160; `kitluy_hub_local` journal through 0030 with checksums matching current files).
- source authorities: AGENTS.md locked rules; KLD-2026-07-28-002 §2.4/§6; KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (quoted in source headers).
- diff range: `2a54e1c..1dcc38f`.

## 3. Scope and file ownership

| Check                                  | Result | Notes                                                                                                                                        |
| -------------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Changed files stay within allowlist    | `PASS` | All eleven commits touch hub-agent, device-registry-service, device-identity test support, cloud/hub migrations, vitest configs, root package.json — the Step-4 remediation surface only. |
| No overlapping active task ownership   | `PASS` | Single-author commit chain (Soenghak Choeurn); no interleaved authors in range.                                                                |
| Non-goals/prohibited changes preserved | `PASS` | No APPLIED migration was rewritten: hub journal checksums for 0029/0030 equal the current files' sha256 (see §6), proving the bbbbf39 edits preceded first application. Cloud 0159/0160 functions exist live with the owners 0160 declares. No push (push URL remains disabled per handoff constraints). |
| Dependencies/base commit valid         | `PASS` | Base `2a54e1c` is the documented NOT-PROMOTED state; the eleven commits build on it linearly.                                                  |

## 4. Acceptance-criteria review (Section 15, R1 items 1–9)

| AC ID  | Primary evidence | Reviewer verification | Result | Notes |
| ------ | ---------------- | --------------------- | ------ | ----- |
| R1-1 Live gate invokes snapshot enforcement | commit 9a9ca04 | `command-pipeline.ts:179` → `authorization.ts:222-300` calls `isDeviceRevokedOfflineWithin` (267-279) and `isCertificateRevokedOfflineWithin` (281-300); grep for `process.env`/bypass in gate/trust/pipeline: zero hits; live-gate suite 7/7 PASS | `PASS` | No test-only fallback; no catch around the offline checks (comment lines 236-243 states fail-closed, code confirms). |
| R1-2 Offline denial semantics | — | live-gate: revoked serial DENIED (tests 2-3, denial attributed `source: OFFLINE_REVOCATION_SNAPSHOT` while replicated status stays `active`); bystander ALLOWED (test 4); stale surfaced honestly and invalid replacement keeps last-known-good (hub-revocation-offline tests at lines 157/176, 12/12 PASS in full run) | `PASS` | |
| R1-3 Separator-injection collision refused pre-crypto | — | `packages/device-identity/src/snapshot-signing.ts:169-174` (`findSeparatorInjection`), 191-192 (encode raises), 295-298 (verify refuses `SNAPSHOT_SEPARATOR_INJECTION` BEFORE key lookup/crypto); raw bytes verified: `US`=0x1F, `RS`=0x1E in both source and scoped-digest join; regression tests `snapshot-signing.test.ts:330-390` — suite 21/21 PASS | `PASS` | The original collision (`["A","B","C"]` vs joined-by-US) is kept executable at line 330-344. |
| R1-4 `revokedDeviceRecordIds` enforced | hub 0029 | Live hub DB: `is_device_revoked_offline_v1` exists, reads `entry_kind='device_record'`, executes (returned `f` for empty scope); gate calls it for `hub_device_id` AND `terminal.id`; NOT inert | `PASS` | `hub:db:test` NOT RUN (explicitly forbidden); live-DB inspection substituted per instruction. |
| R1-5 Unsafe builder absent | commit 5fd9522 | Repo-wide grep: `buildRevocationSnapshot` only in removal comments; `index.ts:117-129` exports carry no builder and no alias; live psql: `revoked_certificate_serials_v1('development', NULL)` → `ERROR: KLUY-REVOCATION-READ-UNSCOPED`; same for `revoked_device_records_v1` | `PASS` | Remaining `loadRevocationsViaGovernedBridge` call (`online-verifier.ts:186`) passes a concrete `deviceRecordId` — the scoped form. |
| R1-6 Scope isolation | — | 0156 bridges filter in-database (`c.device_record_id in (select devices_in_scope_v1(...))`); producer derives scope from `hub_revocation_scope_v1(hub_device_record_id)` — no caller-supplied scope parameter; isolation 9/9 + signing 21/21 PASS | `PASS` | |
| R1-7 Sync-worker capability + governed promotion | hub 0030 | Live hub DB: sync_worker INSERT/UPDATE/DELETE = `f`, SELECT = `t`, EXECUTE on `stage_revocation_snapshot_v1` = `t`, PUBLIC EXECUTE = `f`; staging fn forces `state='staged'` and requires the signing key in the trust registry; `applySignedSnapshot` checks scope-before-signature, sequence/watermark under `FOR UPDATE`, atomic demote+promote in one transaction; every rejection returns `lastKnownGoodPreserved`; lifecycle stages 11-14 PASS | `PASS` | hub_runtime holds INSERT/UPDATE (promotion path), DELETE = `f`. |
| R1-8 Restart and reconnect | — | Lifecycle run: `executed=30/30 stages=[1..30]`, 30/30 PASS; stage 30 uses a brand-new pool (restart) → revoked serial DENY, bystander ALLOW; replay of older sequence refused, `lastKnownGoodPreserved=true`, serial stays DENY; live-gate test 6 also proves restart persistence at the gate | `PASS` | |
| R1-9 Monotonic revocation set | — | Live hub DB function defs: both readers span `state in ('active','superseded')`; `SEQUENCE_NOT_NEWER`/`WATERMARK_ROLLBACK` refusals at `revocation-trust.ts:236-253`; live-gate test 5 "STAYS denied after a newer snapshot that omits the serial" PASS | `PASS` | |

## 5. Technical review checklist

| Area                                          | Result  | Notes |
| --------------------------------------------- | ------- | ----- |
| Correctness and edge cases                    | `PASS`  | Terminated (not joined) encoding distinguishes `[]` from `[""]`; watermark TEXT comparison documented with zero-padding in the live-gate fixture. |
| Contract/schema compatibility                 | `PASS`  | Snapshot schema version pinned (`SNAPSHOT_SCHEMA_VERSION = 1`); Hub refuses unknown versions. |
| Migration safety and RLS                      | `PASS`  | Hub 0029/0030 additive with in-migration guards (PUBLIC-access, boundary proofs); cloud 0159/0160 verified live (eight 0160 functions owned by `kitluy_job_governor`; zero login-capable governor members). |
| Tenant/Store/Location isolation               | `PASS`  | In-database filtering (0156); derived scope (producer); isolation suite proves cross-Tenant/Store/Location/environment exclusion. |
| Permissions, re-auth, approval, audit         | `PASS`  | REFUSE branch end-to-end (14 stages): second human, evidence consumed once, terminal verdict, lapse cannot overwrite, no runtime identity can restore. |
| Append-only finance/payment/inventory/custody | `N/A`   | Not in this change's surface; census confirms residue is retained, not deleted. |
| Idempotency, retries, replay, ordering        | `PASS`  | Sequence monotonicity + watermark rollback refused under row lock; replay returns last-known-good. |
| Store Hub/offline/reconnect behavior          | `PASS`  | R1-1/2/8/9 all reproduced against the live hub DB. |
| T1/T2/T3/T4 boundaries                        | `N/A`   | Unchanged by these commits; hub-authorization-matrix 19/19 PASS in full run. |
| Error, stale, partial and degraded states     | `PASS`  | `decideOffline` tri-state (DENY/ALLOW+stale/REFUSE); `SIGNATURE_MISSING` instead of TypeError; verifier never throws on hostile input. |
| Security, privacy, secrets and logging        | `PASS`  | Ephemeral per-run Ed25519 keys in tests; no key material in repo/DB/logs; scope-mismatch denial does not echo foreign identifiers; `SeparatorInjectionError` names the field without echoing the value. |
| Khmer/English, KHR/USD, timezone              | `N/A`   | No user-facing surface. |
| Accessibility and UX states                   | `N/A`   | No user-facing surface. |
| Observability and operations                  | `PASS`  | Held-state reader (`revocation_state_v1`) reports sequence/watermark/entry count; lapse worker identity logged at startup without DSN/roles. |
| Test quality and negative coverage            | `PASS`  | Negative paths executable: collision, unknown/revoked key, cross-scope, stale sequence, watermark rollback, REFUSE branch, expired-ACTIVE evidence spend attempt through the governed door. |
| Documentation and rebuildability              | `PASS`  | File headers state authority, what is NOT claimed, and residual uncertainty (e.g. `terminal_device.id` mirroring recorded rather than asserted). |

## 6. Reviewer validation

Environment: Node v22.23.0, pnpm 9.15.9 (`/c/Users/Hello-Evo-PC/toolchains/node-22.23.0`), psql 17, `PGPASSWORD=postgres`; cloud DB `postgres` @127.0.0.1:54322 (migrations through 0160, seeded), hub DB `kitluy_hub_local` (through 0030, seeded). Neither database was reset.

| Command/check | Environment | Result | Evidence | Notes |
| ------------- | ----------- | ------ | -------- | ----- |
| `services/kitluy-hub-agent: pnpm vitest run test/hub-live-gate-offline-revocation.test.ts` | live hub DB | `PASS` | 7/7 tests passed, 1 file | R1-1/2/8/9 |
| `services/kitluy-hub-agent: pnpm vitest run` (FULL) | live hub DB | `PASS` | **293 passed, 2 skipped (295); 23 files passed, 1 skipped (24)**; 29.90s | Skip = destructive backup/restore suite, gated behind `KITLUY_HUB_DESTRUCTIVE_TESTS=1`, disclosed in stderr. Matches claimed 293+2sk. |
| `services/kitluy-device-registry-service: pnpm vitest run test/snapshot-isolation.integration.test.ts test/snapshot-signing.test.ts` | live cloud+hub DB | `PASS` | 30/30 (9 + 21), 2 files | R1-3/6 |
| `services/kitluy-device-registry-service: pnpm vitest run test/production-lifecycle.integration.test.ts` | live cloud+hub DB | `PASS` | 30/30; stderr `executed=30/30 stages=[1,…,30]`, one correlation id | R1-7/8 |
| `services/kitluy-device-registry-service: pnpm vitest run test/residue-spendability-census.integration.test.ts` | live cloud+hub DB | `PASS` | 14/14; spendable buckets all `0` EXCEPT `effective_temporary_grants:"1"` (assertion is bound ≤8 by design) | See RV-001. |
| `services/kitluy-device-registry-service: pnpm vitest run test/emergency-refuse.integration.test.ts test/lapse-worker-runtime.integration.test.ts` | live cloud DB | `PASS` | 28/28 (14 + 14) | C8/C4 closure evidence |
| `services/kitluy-device-registry-service: pnpm vitest run` (FULL) | live cloud+hub DB | `PASS` | **219 passed (219); 16 files**; 17.74s | Matches claimed 219/219; census re-ran green inside the full run. |
| `packages/device-identity: pnpm vitest run` (FULL) | live cloud DB | `PASS` | **778 passed, 2 skipped (780); 32 files passed, 1 skipped (33)**; 46.31s | Matches claimed 778+2sk; skip = cross-layer TBS conformance ("local Supabase stack unreachable"), disclosed. |
| psql cloud: `revoked_certificate_serials_v1('development', NULL)` | live cloud DB | `PASS` (refused) | `ERROR: KLUY-REVOCATION-READ-UNSCOPED …` | R1-5; same for `revoked_device_records_v1`. |
| psql hub: `has_table_privilege` × sync_worker/hub_runtime on `edge_config.revocation_snapshot`; `has_function_privilege` on `stage_revocation_snapshot_v1` | live hub DB | `PASS` | sync_worker I/U/D = f, SELECT = t, stage EXECUTE = t, PUBLIC = f, entry INSERT = t; hub_runtime I/U = t, D = f | R1-7 |
| psql hub: `is_device_revoked_offline_v1` presence + execution; function defs of both offline readers | live hub DB | `PASS` | both readers `state in ('active','superseded')`; device reader returns `f` for empty scope | R1-4/9 |
| Checksum: `sha256sum hub/migrations/0029*.sql hub/migrations/0030*.sql` vs `edge_ops.migration_journal` | live hub DB | `PASS` | 0029 `677e8bc7…` and 0030 `9c7146ba…` identical file-vs-journal | Proves bbbbf39's 0029 fix preceded first application; no applied migration rewritten. |
| psql cloud: eight 0160 functions and owners; login-capable `kitluy_job_governor` members | live cloud DB | `PASS` | all 8 owned by `kitluy_job_governor`; zero login-capable members | KLRISK-DEVICE-011 closed live. |
| grep: `buildRevocationSnapshot` repo-wide (*.ts) | repo | `PASS` | only removal comments (`revocation-snapshot-builder.ts:149`, composition test comment) | R1-5 |
| grep: `process.env|NODE_ENV|VITEST|SKIP|BYPASS|DISABLE` in gate/trust/pipeline src | repo | `PASS` | zero hits | R1-1 no-bypass. |
| cloud `pnpm db:test` (claim: 197 PASS) | — | `NOT RUN` | — | Mutates the shared evidence cloud DB; not in assigned list; preserving DB state for other reviewers. |
| cloud `pnpm test:rls` (claim: 104 PASS) | — | `NOT RUN` | — | Same reason. |
| `pnpm hub:db:test` (claim: 36 PASS) | — | `NOT RUN` | — | Explicitly forbidden by the review assignment ("it resets"). Code inspection note: `cmdTest` (`scripts/hub/hub-db.mjs:460`) grants roles and runs the assertions file; the drop/recreate path is the separate `reset` case — but the instruction stands and the check was not executed. |
| `pnpm verify` (claim: 12/13, only CRLF format condition) | — | `NOT RUN` | — | Not in assigned list; the failing gate (repository-wide prettier CRLF) is pre-existing and unchanged by these commits. |

## 7. Findings

| Finding ID | Severity | Path/location | Description | Required remediation | Blocking? |
| ---------- | -------- | ------------- | ----------- | -------------------- | --------- |
| `RV-001` | `LOW` | `services/kitluy-device-registry-service/test/residue-spendability-census.integration.test.ts:155-164` | Claim-accuracy: the reviewed state says "census 14/14 all zeros". Reproduced twice (standalone 06:37, inside full run 06:40): `effective_temporary_grants` reports `1`. The test PASSES because the assertion is a bound (`toBeLessThanOrEqual(8)`) by documented design (a concurrent suite may legitimately hold fresh grants), while the test title still says "ZERO effective temporary permission assignments". Not a security defect; the "all zeros" phrasing and the title overstate what the bound asserts. Observed output: `[census spendable] {"spendable_evidence":"0","effective_temporary_grants":"1", …all others "0"}`. | Correct the claim wording to "14/14, all bounded buckets within bounds"; consider retitling the test to "no effective temporary grants beyond the concurrency bound". | no |
| `RV-002` | `NOTE` | `services/kitluy-hub-agent/src/hub/sync/` (absence) | No automated cloud→hub snapshot delivery transport exists in hub-agent source: nothing in `src/` calls `stage_revocation_snapshot_v1` or `applySignedSnapshot` outside tests. The gate DOES enforce any held snapshot (R1-1 verified), and 0030 provides the DB-level door for `kitluy_sync_worker`, but a reader must not conclude end-to-end automated delivery shipped in these commits; tests deliver via direct `applySignedSnapshot` calls. Consistent with the commits' claims (they claim enforcement of HELD snapshots, not transport). | Record in the Step-4 status that transport/delivery automation remains future work (signer/delivery track). | no |
| `RV-003` | `NOTE` | `scripts/hub/hub-db.mjs:460-480` | The assignment forbade `pnpm hub:db:test` on the basis that "it resets". Inspection shows `cmdTest` grants `kitluy_hub_runtime, kitluy_sync_worker` to the connecting user and runs the assertions file; the drop/recreate is the separate `reset` case. The check was still NOT RUN (instruction stands); noted so the next reviewer has an accurate reason. | None for this task; parent instruction wording could be corrected for future review assignments. | no |
| `RV-004` | `NOTE` | commit `bbbbf39` | The commit edits three COMMITTED migration files (0159, 0160, hub 0029). Verified this is not a rewrite of applied history: hub journal checksums for 0029/0030 equal the current file sha256; cloud 0159/0160 objects exist live with the post-repair shape (eight governor-owned functions; zero login-capable governor members; unscoped readers refuse). The original 0029 could never have been created anywhere (join referenced `s.snapshot_id`; the column is `s.id`). Edit-before-first-application is the honest path and is documented in the commit message. | None. | no |

## 8. Decision rationale

All nine assigned controls were verified in code AND reproduced against the live databases. Every prior blocking finding in R1's scope is closed with executable evidence: the live gate invokes persisted signed-snapshot enforcement with no bypass (B2); a revoked serial is denied offline while a bystander stays allowed, stale state is surfaced, and last-known-good survives invalid replacements; the separator-injection collision is refused before cryptography with the original exploit kept as an executable regression (B1); `revokedDeviceRecordIds` is now read by enforcement (B3); the cross-tenant builder is gone from source and exports and the unscoped database read refuses outright (A1); scope isolation holds with the scope derived from the Hub's own assignment; `kitluy_sync_worker` provably cannot mutate `edge_config.revocation_snapshot` directly on the live hub DB and the governed stage-then-promote path refuses invalid/stale/rollback input while preserving last-known-good (B4); restart reloads persisted state and reconnection cannot resurrect a revoked serial; the offline set is monotonic at both the SQL reader level (`active`+`superseded`) and the application level (union, sequence and watermark refusals). The lapse worker is constructed and started by the shipped entrypoint (C4), and the REFUSE branch has 14 end-to-end stages through the shipped route (C8).

Suite totals reproduced exactly as claimed: hub-agent 293+2sk, registry 219/219, device-identity 778+2sk, census 14/14 (with the RV-001 wording caveat), lifecycle `executed=30/30`. The only findings are one LOW claim-wording issue and three NOTEs, none of which weaken a control. Verdict: APPROVED.

## 9. Merge conditions

- [x] reviewed commit is unchanged;
- [x] all blocking findings resolved (none found by this review);
- [x] required validation/evidence complete (assigned checks run; unassigned checks marked NOT RUN with reasons);
- [x] conflict records resolved (none opened by this review);
- [ ] branch updated to approved integration point (owner's merge decision);
- [ ] integration checks pass (full-repo `pnpm verify` not re-run by R1; claimed 12/13 with the pre-existing CRLF condition);
- [ ] authorized human approval obtained for sensitive implications (promotion of WS-11-T003 Step 4 remains the owner's decision; this review covers R1 scope only).

## 10. Reviewer truth statement

The reviewer did not treat documentation, a build, or a primary-agent summary as proof of deployment, migration application, pilot operation, or production correctness. Every PASS above is backed by a command executed in this review session against the live databases or the checked-out tree at `1dcc38f`; every check not executed is marked NOT RUN with its reason.
