# WS-11-T003 Step 4 — runtime enforcement, blocker closure, three independent reviews, and the promotion decision

| Field      | Value |
| ---------- | ----- |
| Task ID    | WS-11-T003 Step 4 — Device Credential Revocation, Emergency Governance, Offline Enforcement and Lifecycle Containment (final run) |
| Date       | 2026-08-01 · Asia/Phnom_Penh |
| Start SHA  | `2a54e1c` (the reported checkpoint; actual intake HEAD was `9ed400a`) |
| End SHA    | `ff15a80` |
| Branch     | `main` |
| Push URL   | `disabled://push-requires-owner-approval` — confirmed at intake and at close; nothing pushed |
| Toolchain  | Node **v22.23.0** (standalone, `C:\Users\Hello-Evo-PC\toolchains\node-22.23.0`; provisioned because the shell default was v24), pnpm **9.15.9** |
| Migrations | cloud **none added** (0159/0160 corrected before first application anywhere); hub **none added** (0029 corrected likewise) |
| Decision   | **IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION** |

---

## FINAL STATUS

```text
WS-11-T003 Step 4 — IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION
KLRISK-DEVICE-003 — remains OPEN (unchanged; separate evidence required)
KLRISK-DEVICE-007 — closed by this step's evidence (see §Risks)
KLRISK-DEVICE-011 — CLOSED by migration 0160 + assertions/fixtures rewiring (census asserts zero)
```

Recorded environment conditions (pre-existing, not hidden, not in this task's scope to repair):

- `format:check` fails on **808 files** — the repository-wide CRLF/`core.autocrlf` condition (805 at the prior checkpoint, +3 drift). No task file is among the flagged set; the four files authored this run are Prettier-clean as written. Reformatting 800+ unrelated files to turn a gate green remains exactly the misleading result this task forbids.
- `docs:verify` fails its "Classification & original links" section — the pre-existing classified-document condition recorded at the prior checkpoint, unchanged.
- The hub backup/restore destructive opt-in suite cannot restore NOLOGIN-governor ownership as the `postgres` role (`must be member of role`), failing identically on WS-09-era functions — a pre-existing tooling gap predating 0029/0030, NOT a WS-11-T003 regression. The suite remains opt-in (`KITLUY_HUB_DESTRUCTIVE_TESTS=1`).
- The sanctioned test clock (0157) remains intentionally inert in production; PostgreSQL still does not verify Ed25519 (KLRISK-DEVICE-003).

## Intake discrepancies (the reported checkpoint vs reality)

| Reported | Verified at intake |
| -------- | ------------------ |
| HEAD `2a54e1c`, clean tree | HEAD `9ed400a` — 4 further commits already landed (blockers 1-5 partially); tree dirty (1 modified lifecycle test relabeled /28→/30 without stages, 1 untracked REFUSE suite) |
| ~57 ahead of upstream | 69 ahead |
| cloud through 0158 | through 0160 (0159, 0160 committed but **never replayed from zero** — both were defective on the canonical path) |
| Hub through 0028 | through 0030 (0029, 0030 likewise unreplayed; 0029 referenced a nonexistent column and could never have been created) |
| Node 22.23.0 | shell default v24.15.0; 22.23.0 provisioned standalone per `.nvmrc`/`engines` |
| Docker/Supabase up | Docker Desktop engine unresponsive (restarted); `supabase_db_kitluy-local` container missing (recreated); Supabase CLI 2.101.0 (state file said 2.90.0) |

## Swarm execution

| Agent | Scope | Commits | Verification | Findings |
| ----- | ----- | ------- | ------------ | -------- |
| Coordinator (Kimi) | intake, repairs, integration, canonical verification, evidence | all below | this record | intake discrepancies above |
| Prior session (Claude Opus 5) | blockers 1, 2, 3+4, 5 + job-governor (4 commits) | `9a9ca04` `24cb688` `5fd9522` `9ed400a` | reproduced by this run | its 0159/0160/0029 had never replayed from zero and were each defective |
| Migration repair | 0159 borrow + drop/recreate + segfault workaround; 0160 ownership + test scaffold; hub 0029 column | `bbbbf39` | full from-zero reset 0000→0160 and 0000→0030 green | static GRANT inside a DO block segfaults this PG build (signal 11) under an active membership — worked around with the 0147-0155 dynamic pattern, recorded in the migration |
| §11 rewiring | assertions.sql 40b + 3 probe loops; job-fixtures.ts | `c51cf19` | `db:test` 196 PASS, `test:rls` 104 | assertions relied on the leaked membership for reads AND writes; escalate/release were governor-only; `now()` vs `clock_timestamp()` claim-window bug found and avoided |
| Blocker 6 | REFUSE suite | `667f6d4` | 14/14 | 0152 binds post-approval evidence to the VERDICT, not the authorization — test asserts the actual binding |
| Blocker 2 proof | lapse-worker-runtime due-now via scaffold | `e86b8bd` | 14/14 | direct job-table write had only ever worked through the leak |
| Agent F | 30-stage lifecycle | `b548e50` (+ `ff15a80`) | 30/30, `executed=30/30` | first drafting agent timed out; rewritten by coordinator |
| Section 13 | census extension + KLRISK-011 closure | `7d89394` (+ `6ba2d52`) | 14/14 | `service_role`'s bridge access is sanctioned (0127/0135 memberships), not a leak |
| Serialization | vitest configs + turbo concurrency | `1dcc38f` | verify 12/13 | parallel suites measured scheduling, not the system |
| Reviewer R1 (Hub/snapshot) | review | record only | APPROVED (4 low notes) | — |
| Reviewer R2 (jobs/permissions/post-approval) | review | record only | APPROVED-WITH-CONDITIONS (3 low) | conditions fixed in `6ba2d52`/`ff15a80` |
| Reviewer R3 (lifecycle/evidence) | review | record only | APPROVED (4 notes) | — |

## Blocker closure

1. **Live Hub gate** — CLOSED (`9a9ca04`, reproduced): `authorizeHubCommand` consults the held snapshot via `isCertificateRevokedOfflineWithin`/`isDeviceRevokedOfflineWithin` before authorizing; no fallback, no bypass; live-gate suite 7/7 through the shipped `createBookingDraft → executeHubCommand` path.
2. **Production lapse worker** — CLOSED (`24cb688` + `e86b8bd`): `main.ts` constructs and starts the loop after listen; claim/lease/SKIP LOCKED/stale-worker/duplicate/escalation proven end-to-end (lapse-worker-runtime 14/14, lapse-worker 6/6).
3. **Unsafe cross-Tenant builder** — CLOSED (`5fd9522` + `bbbbf39`): export/source removed; environment-wide read raises KLUY-REVOCATION-READ-UNSCOPED on a null device (reproduced via psql); census proves no runtime identity beyond the issuance path reaches the narrowed bridges.
4. **Signed-field enforcement** — CLOSED (`5fd9522`, hub 0029): `revokedDeviceRecordIds` is enforced by `is_device_revoked_offline_v1` (active+superseded), consulted by the live gate. Option A (enforce), recorded in the migration.
5. **Governed Hub promotion** — CLOSED (`9ed400a`, hub 0030): sync worker stages only through `stage_revocation_snapshot_v1`; INSERT/UPDATE/DELETE all refused (live catalog reproduced); promotion atomic with last-known-good preserved.
6. **REFUSE branch** — CLOSED (`667f6d4` + R2): 14 stages through the shipped route; distinct human, verdict named, evidence consumed once (bound to the verdict), deadline fixed, MANUAL_SECURITY_REVIEW with escalation, replay ALREADY_DECIDED, conflicting APPROVE refused, no synthetic approver, credential never restored.
7. **Job-governor leak (KLRISK-DEVICE-011)** — CLOSED (`9ed400a` + `bbbbf39` + `c51cf19`): membership revoked; four governor-owned inspection readers (narrow, fixed search_path, no dynamic SQL); four harness-only scaffold functions; assertions.sql borrows `kitluy_test_harness` for exactly one block; census asserts **zero** login-capable members and zero leaked memberships.

## Lifecycle (30 stages, one run, one correlation id)

`production-lifecycle.integration.test.ts` — 30 passed / 0 failed / 0 skipped; `executed=30/30 stages=[1..30]`; markers recorded only after each stage's assertions (R3-verified, zero prohibited assertion patterns).

| # | Stage | Caller | Result |
| - | ----- | ------ | ------ |
| 1-3 | Tenant / Digital Store / Location creation | fixture constants + catalog asserts | PASS |
| 4-6 | Hub provisioning / trusted public key / Hub assignment | claim+redeem doors; `provisionTrustKey`; assignment query | PASS |
| 7-9 | Device enrollment / initial issuance / online authentication | `enroll_device_v1`; governed issuance; production online verifier | PASS |
| 10-14 | Scoped snapshot production / transfer / signature verify / scope verify / atomic persistence | `createSnapshotProducer`; `applySignedSnapshot` on the live hub DB | PASS |
| 15 | Offline credential authentication | `decideOffline` → ALLOW | PASS |
| 16-19 | Same-key renewal / key rotation ×2 / overlap / retirement | governed drivers, trusted time as value | PASS |
| 20 | Governed normal revocation | `revokeNormal` → bound door as issuance service; CERT_REVOKED online; no runtime writer | PASS |
| 21 | Governed emergency revocation (B) | shipped route; scope exactly one; evidence consumed once | PASS |
| 22 | Durable lapse-job scheduling | durable_jobs row + status route | PASS |
| 23 | Distinct-human APPROVE (B) | self refused SELF; second human; terminal; ALREADY_DECIDED | PASS |
| 24 | Distinct-human REFUSE (C) | MANUAL_SECURITY_REVIEW; deadline fixed; stays revoked | PASS |
| 25 | Missing post-approval lapse (D) | deadline earlier (reverse refused inline); LAPSED actor NULL | PASS |
| 26 | MANUAL_SECURITY_REVIEW escalation | C+D verdicts; residue census; own lapse jobs drained to terminal | PASS |
| 27 | Recovery disposition | REPROVISION_REQUIRED recorded; no reinstate/restore function exists | PASS |
| 28 | Replacement credential issuance | governed issuance; NEW generation 5; revoked stays revoked | PASS |
| 29 | Provider-key destruction and reconciliation | four-eyes destruction DESTROYED; reconciliation row; key row destroyed | PASS |
| 30 | Hub restart and cloud reconnection | fresh pool DENY; older sequence refused; last-known-good preserved | PASS |

The revoked-credential CANNOT list is exercised across stages 20-30: online (20), renewal/rotation windows passed (16-19), APPROVE (23), REFUSE (24), lapse (25), recovery (27), replacement (28), destruction/reconciliation (29), offline/restart/reconnection (30).

## Census (final, reproduced at HEAD)

```text
[census spendable] spendable_evidence 0 · effective_temporary_grants 0..8 (documented bound; one
  expired leftover row recorded per R2-RV-001) · leaked_memberships 0 · job_governor_recorded_exception 0
  · test_clock_policy_rows 0 · overdue_unresolved_authorizations 0 · legacy_reachable 0
  · unsafe_builder_runtime_access 0 · unsigned_active_hub_snapshots 0 · cross_scope_active_hub_snapshots 0
  · sync_worker_active_snapshot_mutation 0 · abandoned_durable_jobs 0
Surviving history rows remain (consumed/revoked evidence, executed authorizations) — append-only, permanently unspendable, and reported separately by the census itself.
```

## Verification (all fresh this run; Node v22.23.0, pnpm 9.15.9, serial where databases conflict)

| Step | Exit | Result |
| ---- | ---- | ------ |
| `db:reset` (0000→0160 from zero) | 0 | full chain incl. repaired 0159/0160 |
| `db:seed` ×2 | 0 | idempotent (INSERT 0 1 then 0 0) |
| `db:test` | 0 | **196 PASS** (92 assertions + 104 rls) |
| `test:rls` | 0 | 104 PASS |
| `hub:db:reset` + seed (0000→0030) | 0 | 31 migrations |
| `hub:db:test` | 0 | 36 PASS |
| device-identity package | 0 | 778 passed / 2 skipped (pre-existing baseline) |
| hub-agent | 0 | 293 passed / 2 skipped (pre-existing baseline: destructive opt-in) |
| registry service | 0 | **219 passed / 0 failed / 0 skipped**, 16 files |
| 30-stage lifecycle | 0 | 30/30, executed=30/30 |
| emergency concurrency (3 scenarios) | 0 | 3/3 |
| census | 0 | 14/14 |
| typecheck / lint / secret:scan / clock:check / migrations:validate / db:validate | 0 | — |
| `pnpm verify` (aggregate) | 1 | **12 of 13** — only `Format check` (recorded CRLF condition) |
| `docs:verify` | 1 | recorded classified-document condition |

Required WS-11-T003 tests: **zero skips** (the only skips anywhere are the two pre-existing baseline sets: device-identity 2, hub-agent destructive opt-in 2).

## Reviews

| Reviewer | Scope | Verdict | Findings | Disposition |
| -------- | ----- | ------- | -------- | ----------- |
| R1 | Hub runtime & snapshot security | APPROVED | 4 low/note | recorded |
| R2 | jobs, permissions & post-approval | APPROVED-WITH-CONDITIONS | 3 low + 3 note | conditions fixed: `6ba2d52` (census title/header), `ff15a80` (loud teardown); db:test count corrected to 196 |
| R3 | lifecycle & evidence integrity | APPROVED | 4 notes | recorded |

Records: `00_AI_HANDOFF/reviews/2026-08-01__WS-11-T003-STEP4-R1__HUB-RUNTIME-SNAPSHOT-SECURITY__REVIEW.md`, `...-R2__JOBS-PERMISSIONS-POST-APPROVAL__REVIEW.md`, `...-R3__LIFECYCLE-EVIDENCE-INTEGRITY__REVIEW.md`.

## Risks

- **KLRISK-DEVICE-003** — OPEN, unchanged. The issuance service remains in the TCB; PostgreSQL still does not verify Ed25519. Nothing in this run claims to close it.
- **KLRISK-DEVICE-007** — "there is no governed credential-revocation operation": the operation now exists end-to-end (normal bound path, governed emergency path, lapse, post-approval, offline enforcement, production worker, 30-stage lifecycle). Marked for closure in the decision register by this record's evidence.
- **KLRISK-DEVICE-011** — CLOSED by migration 0160 + rewiring; census asserts zero with executable evidence.
- **New, recorded**: the abandoned-key destruction basis in 0137's eligibility conflicts with `device_generation_keys_abandon_chk` at confirm (an abandoned key can never reach `destroyed`; the abandoned retention floor is currently dead code). Only the superseded basis completes. Found while building stage 29; recorded here for a future additive fix — out of WS-11-T003 scope.

## Constraints honoured

Push disabled throughout; nothing pushed. No production migration applied. Committed migrations 0159/0160/0029 were corrected **before ever being applied to any surviving or shared environment** (their only prior application was a destroyed disposable volume; the from-zero defect made any later additive rescue impossible) — recorded per the conflict rule rather than silently. No login-capable role left a member of a NOLOGIN authority (census-proven). No private key in Git, database, logs or Hub. No claim that PostgreSQL verifies Ed25519. No prior finding erased — reverted/incorrect ones marked superseded. WS-11-T004…T008 not started. WS-11 overall, Cycle 10, pilot and production readiness NOT promoted.

## Rollback

All changes are test files, two vitest configs, one package.json concurrency flag, and three migration-file corrections to never-applied migrations. Rollback is `git revert` of the eleven commits (`2a54e1c..ff15a80`); the database has no destructive residue (a full `db:reset`/`hub:db:reset` restores any earlier chain state).

---

## Follow-up closure (2026-08-01, commits `b3989bf`)

Every remaining reviewer note is closed:

- **R3 RV-301/302** — lifecycle stages 30 and 13 now assert the refusal REASON
  (`SEQUENCE_NOT_NEWER`) instead of a non-specific non-apply / disjunction.
- **R3 RV-303** — stage 26's live-evidence residue is exactly the two
  enumerated unspent rows, matching its enumeration.
- **R3 RV-304** — the census's surviving-history check reconciles the
  lifecycle-state partition (consumed + revoked + other = total) instead of a
  `count >= 0` tautology.
- **Orphan residue** — one abandoned lapse job of the superseded kind
  `device.credential-emergency-lapse.v1` (lease expired hours earlier, 7
  attempts, authorization nonexistent) was claimed through the governed queue
  as `kitluy_worker_service`, evaluated by the governed lapse
  (`KLUY-EMERGENCY-NOT-FOUND`, permanent) and moved to `manual_review` with
  its full attempt evidence. No raw writes; every step went through the
  governed doors.

Re-verified after the changes: registry suite **219/219**, lifecycle
**30/30 (executed=30/30)**, census **14/14** (including
`abandoned_durable_jobs 0`), aggregate `pnpm verify` **12/13** (the
pre-existing CRLF format condition only).

---

# FORMAL CLOSURE — WS-11-T003 (2026-08-01)

This section is the formal record reconciliation and closure package for
WS-11-T003. Historical SHAs above are preserved unchanged; this section carries
the current authoritative closure SHA.

## Closure SHAs

```text
Implementation evidence end SHA:  ff15a80
Reviewer-note closure SHA:        b3989bf
Formal WS-11-T003 closure SHA:    <this document's commit — see git log>
```

## Reviewer finding dispositions (every item, accounted)

### R1 — Hub runtime & snapshot security: APPROVED

| Finding | Disposition |
| ------- | ----------- |
| RV-001 (LOW) census "all zeros" wording vs bounded temporary-grants check | FIXED in `6ba2d52` — title retitled to the bounded predicate, leftover row recorded with its expiry |
| RV-002 (NOTE) no automated cloud→hub delivery transport | RECORDED non-blocking — enforcement of held snapshots is live; transport is sync-domain future work (WS-10), not Step 4 |
| RV-003 (NOTE) hub:db:test runs tests, not a reset | RECORDED non-blocking — accurate observation; reset evidence came from explicit `hub:db:reset` runs |
| RV-004 (NOTE) pre-application migration corrections | RECORDED non-blocking — checksums prove corrections preceded first application; no applied history rewritten |

### R2 — jobs, permissions & post-approval: APPROVED-WITH-CONDITIONS, every condition fixed and re-verified

| Finding | Disposition |
| ------- | ----------- |
| RV-001 (LOW) temporary-grants count 1 vs "ZERO" wording | FIXED in `6ba2d52`; the specific leftover row (run d7df9017, expired 2026-08-01 00:16:52Z) is recorded in the test comment; census re-run 14/14 |
| RV-002 (LOW) swallowed teardown (`disposeEmergencyActor` catch) | FIXED in `ff15a80` — teardown failures now log the actor label loudly; lifecycle re-run 30/30 |
| RV-003 (LOW) db:test count 197 vs static 196 | CORRECTED in all records — canonical count is **196** (92 assertions + 104 RLS); the 197 was a grep artifact |
| RV-004 (NOTE) `authenticated` holds EXECUTE on readers without schema USAGE | RECORDED non-blocking — unreachable in practice; a dedicated assertion role is a future hygiene candidate |
| RV-005 (NOTE) census header stale about parallelism | FIXED in `6ba2d52` — header records the landed `fileParallelism: false` serialization |
| RV-006 (NOTE) lapse-vs-verdict races live in the package suite | RECORDED — R2 reproduced them there (14/14); mapping noted |

### R3 — lifecycle & evidence integrity: APPROVED

| Finding | Disposition |
| ------- | ----------- |
| RV-301 (NOTE) stage 30 reason string | FIXED in `b3989bf` — asserts `SEQUENCE_NOT_NEWER` explicitly |
| RV-302 (NOTE) stage 13 disjunctive assertion | FIXED in `b3989bf` — deterministic `SEQUENCE_NOT_NEWER` + last-known-good |
| RV-303 (NOTE) stage 26 enumeration vs bound | FIXED in `b3989bf` — residue is exactly the two enumerated rows |
| RV-304 (NOTE) tautological history assertion | FIXED in `b3989bf` — partition reconciliation (consumed + revoked + other = total) |

No review blocker remains. All three verdicts stand: R1 APPROVED, R2
APPROVED-WITH-CONDITIONS with every condition fixed and re-verified, R3
APPROVED with every note closed and re-verified (registry suite 219/219 after
the fixes).

## KLRISK-DEVICE-012 — registered here and in the canonical register

The migration-0137 abandoned-key destruction defect found while building
lifecycle stage 29 is registered as **KLRISK-DEVICE-012** in
`docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md` (full
record there). It is outside WS-11-T003 Step 4, does not reopen
KLRISK-DEVICE-007, and requires a future additive migration.

## Formal status

```text
WS-11-T003 Step 4:   IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION
WS-11-T003 overall:  COMPLETED-IN-DEV
WS-11:               IN PROGRESS
Cycle 10:            IN PROGRESS
WS-11-T004..T008:    NOT STARTED
Pilot readiness:     NOT PROMOTED
Production readiness: NOT PROMOTED
```

Environment conditions (explicit; none is missing Step-4 implementation):

- repository-wide CRLF format condition (808 files, `format:check` fails);
- classified-document verification condition (`docs:verify` classification section);
- Hub destructive restore tooling condition (pg_restore as `postgres` cannot
  restore NOLOGIN-governor ownership; opt-in suite gated);
- sanctioned test clock (0157) inert in production by design;
- KLRISK-DEVICE-003 remains OPEN.

Baseline skips unrelated to required WS-11-T003 behavior (explicit): the
device-identity package's 2 skipped tests and the Hub destructive backup/restore
opt-in's 2 skipped tests are pre-existing baseline conditions, not database-,
worker-, offline- or lifecycle-unavailable skips. Required WS-11-T003 tests ran
with zero skips.

## Next permitted task

```text
Next permitted task identifier: WS-11-T004
Exact title: NOT RESOLVED FROM CURRENT REGISTER — the repository's task
registers (00_AI_HANDOFF/tasks/, docs/evidence/phase1/ws-11/) carry titles for
T001/T002 only; T003's title lived in the swarm execution prompt. A separate
discovery package is required before T004 is titled or started.
T004 implementation was NOT started in this package.
```
