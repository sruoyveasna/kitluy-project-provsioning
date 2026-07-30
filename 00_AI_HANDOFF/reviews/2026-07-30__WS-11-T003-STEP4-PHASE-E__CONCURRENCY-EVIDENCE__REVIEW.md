# Independent Review #3 — WS-11-T003 Step 4 Phase E, Concurrency / Evidence / Test Integrity

**Date:** 2026-07-30 · Asia/Phnom_Penh  
**Reviewed commit (HEAD):** `6eda48fb4e732795ff366eb98d04ff02a9864f13`  
**Base:** `acfce30` through `6eda48f`  
**Branch / worktree:** `main`  
**Lens:** concurrency honesty, race-harness integrity, containment evidence, handoff overclaim, AGENTS.md §9.  
**Review role:** independent review agent #3 (READ-ONLY on application/migration/test code; one review file only).

> **Verdict is at the end.** Green tests were attacked for whether they can lie. Every concurrency and containment claim below that carries an EXECUTED mark was re-run or probed in this session. Documentation claims were checked against those runs, not trusted.

---

## 0. Independence check

| Check | Result |
| ----- | ------ |
| Reviewer is not the primary writer | PASS — primary author of Phase D artefacts is the swarm writer; this reviewer authored no application, migration, or test change. |
| Reviewer did not modify the task branch sources | PASS — the only durable write is this file under `00_AI_HANDOFF/reviews/`. A temporary rename of `pg-revocation-lookup.ts` was restored before finishing (see §4.3). |
| Reviewed commit matches the named SHA | PASS — `git rev-parse HEAD` = `6eda48fb4e732795ff366eb98d04ff02a9864f13`. |
| Status not promoted | PASS — no evidence-register or status promotion. |

---

## 1. Method

1. Grep for theatrical patterns (`sleep`-only races, shared client, mocked `pg`, `expect(true)`, `it.skip` / `vi.mock`).
2. Read `race-harness.ts`, all 13 scenarios + membership census, `revocation-containment.integration.test.ts`, SECTION 47b in `assertions.sql`, Phase D handoff.
3. **Re-run** both Vitest suites against the live local DB.
4. **Rename probe** on `pg-revocation-lookup.ts` (must restore).
5. Catalog spot-check of door functions / legacy EXECUTE / worker USAGE via `pg` from Node (host `psql` absent).

Environment (same residual the handoff records):

- Node **v24.14.1** (`.nvmrc` pin is `22.23.0` / `>=22.12.0 <23`)
- `npm_config_engine_strict=false`
- PATH includes `.kitluy-bin` and Program Files nodejs

---

## 2. Materials reviewed

- `packages/device-identity/test/support/race-harness.ts`
- `packages/device-identity/test/governed-emergency-concurrency.integration.test.ts`
- `packages/device-identity/test/revocation-containment.integration.test.ts`
- `packages/device-identity/src/pg-revocation-lookup.ts` (import surface only; rename probe)
- `supabase/tests/assertions.sql` SECTION 47b (`PASS ws11-phase-d-containment`)
- Phase D handoff: `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__CONCURRENCY-AND-CONTAINMENT__AI-HANDOFF.md`
- Authority: AGENTS.md §9; style from Step2 trusted-time review
- Diff range: `acfce30..6eda48f` (concurrency / containment artefacts present)

---

## 3. Fake-pattern census (grep)

| Pattern | Hit in concurrency / containment / harness? | Assessment |
| ------- | -------------------------------------------- | ---------- |
| `vi.mock` / `jest.mock` / mocked `pg` | none | PASS |
| Shared `pg.Pool` as “two racers” | none — `openBackend` uses **new `pg.Client`** per label | PASS |
| `expect(true)` / vacuous pass | none | PASS |
| `it.skip` / `describe.skip` (unconditional) | none — only `describe.skipIf(!reachable)` | PASS when DB up |
| Client-side `sleep` as the race | harness `sleep(20)` is **observer poll only**; fails closed if no Lock wait | PASS |
| Server `pg_sleep` | **scenario 11 only** — lease expiry wait (1.2s), not a lock barrier | NOTE — see RV-CE-002 |
| `isCertificateRevoked: () => false` inside containment suite | none (only named in comments) | PASS for this suite; stubs remain elsewhere (recorded limitation, not this file’s lie) |

---

## 4. Executed validation

### 4.1 Vitest re-run (REQUIRED)

```text
cd packages/device-identity
npx vitest run test/governed-emergency-concurrency.integration.test.ts \
  test/revocation-containment.integration.test.ts
```

| Suite | Result | Evidence |
| ----- | ------ | -------- |
| `governed-emergency-concurrency.integration.test.ts` | **14 PASS** (13 scenarios + membership census), 0 skipped | Distinct PIDs **3106 / 3107** throughout; race summary printed |
| `revocation-containment.integration.test.ts` | **5 PASS**, 0 skipped | BEFORE→AFTER paths exercised |
| Aggregate | **19/19 PASS**, ~8.3s | Exit green |

`db:test` / full SECTION 47b execution: **NOT RUN this session** (Reviewer #1 already hit a pre-existing section-33 fixture collision on this local DB). SECTION 47b honesty is judged from source + catalog spot-check (§5).

### 4.2 Race harness — can the barrier pass without true overlap?

`observeBlocked`:

- Polls `pg_stat_activity` for the **blocked backend’s PID**.
- Returns only when `wait_event_type === 'Lock'`.
- Then reads `pg_locks` where `not granted` for that PID, and the holder’s state.
- Throws if no Lock wait within timeout: *“Without a real block there is no race to report.”*

**Verdict:** the Lock barrier **cannot** green on sequential single-connection work or on “await A then await B” without an overlapping holder. Sleep alone cannot satisfy it.

`openBackend` records `pg_backend_pid()` and refuses pid 0. Re-run evidence: alpha/beta always `3106/3107` (two backends).

### 4.3 Rename probe — would containment stay green without `pg-revocation-lookup.ts`?

| Step | Result |
| ---- | ------ |
| `mv src/pg-revocation-lookup.ts` → `…reviewer3-temp-away` | done |
| Re-run containment suite | **FAIL** at collect: `Failed to load url ../src/pg-revocation-lookup.js` — **0 tests ran** |
| Restore + re-run | **5 PASS** |

**Verdict:** containment cannot stay green if the production join module is removed. The suite is not a comment-only or stub-only pass. (Pipeline `$?` after `| tail` is not evidence; the Vitest FAIL body is.)

Containment shape confirmed by reading + run:

1. `verifyWithDatabaseRevocations` → `loadRevocations` from DB  
2. `revokeThroughGovernedDoor` → real `revoke_device_credential_bound_v1`  
3. verify again → `CERT_REVOKED`  
BEFORE leg asserted `valid: true` before revoke.

---

## 5. SECTION 47b — three doors or comment-only?

Source inspection of `assertions.sql` §47b shows **executable** doors, not comments:

| Door | Mechanism | Asserted outcome |
| ---- | --------- | ---------------- |
| A | `revoke_device_credential_bound_v1` as `kitluy_issuance_service` | `REVOKED` |
| B | `revoke_device_credential_emergency_governed_v1` + `record_governed_emergency_post_approval_v1` | `REVOKED_IMMEDIATELY` then `APPROVED` |
| C | governed emergency + deadline advance + `lapse_governed_emergency_post_approvals_v1` **as `kitluy_worker_service`** | `LAPSED` including that authorization |

Then a **single matrix loop** over `(A normal, B approved, C lapsed)` for C1–C4/C7, plus C5 catalog census and C6 overlap. Ends with `PASS ws11-phase-d-containment`.

Catalog spot-check (Node `pg`, this session):

- `kitluy_worker_service` has EXECUTE on lapse sweeper **and** USAGE on `kitluy_devices` (0154 surface still present).
- Legacy `revoke_device_credential_emergency_v1` EXECUTE = false for `kitluy_issuance_service`, `service_role`, `authenticated`.

**Verdict:** SECTION 47b is real SQL. Full notice-level re-execution **NOT RUN** here — condition C3.

---

## 6. Scenario-by-scenario: concurrent vs theatrical

Re-run race summary + source. Classification:

| # | Claim | Barrier kind | Verdict |
| - | ----- | ------------ | ------- |
| 1 | Double-spend one re-auth evidence | `observeBlocked` Lock (`transactionid:ShareLock`) | **REAL** |
| 2 | Evidence invalidated mid-park | Lock + mid-flight REVOKED evidence | **REAL** (invalidation ≠ clock expiry — see RV-CE-001) |
| 3 | Permission revoked mid-park | Lock | **REAL** |
| 4 | Duplicate idempotency key | Lock → loser `23505` | **REAL** |
| 5 | Overlapping recorded scopes | Lock on credential | **REAL** |
| 6 | Bound vs emergency | Lock | **REAL** |
| 7 | Ownership change mid-flight | Lock; `revoke_device_assignment_v1` → **57014**; direct assignment UPDATE as fixture; emergency still completes; tenancy retained | **REAL — claim still holds** |
| 8 | Post-approval vs lapse | Overlapping txns; `SKIP LOCKED`; timeout asserts non-block | **REAL (non-blocking concurrency)** |
| 9 | Two post-approvers | Lock | **REAL** |
| 10 | Two lapse workers | Overlapping uncommitted + `SKIP LOCKED`; second `lapsed_count 0` | **REAL (non-blocking concurrency)** |
| 11 | Stale lease completion | Sequential claim → **`pg_sleep(1.2)`** → re-claim → stale complete refused | **NOT a lock race** — honest lease test, theatrical if counted as “race #11” |
| 12 | Audit/txn failure rolls back | **Alpha alone**; catalog escape census + forced raise + rollback | **NOT concurrency** — atomicity proof |
| 13 | Legacy vs governed | Catalog-derived 18-arg call; loser **`42501`** for three roles; **`42883` absent**; **`57014` absent** | **REAL permission proof** (not a lock race) |

Executed scenario 13 `loserOutcome` (this run):

```text
kitluy_issuance_service: 42501 permission denied for function revoke_device_credential_emergency_v1
service_role:            42501 …
authenticated:           42501 …
```

**Scenario 13 proves 42501, not 42883. Scenario 7 still proves its claim.**

Suite file header says `betaBlocked` is null for **three** scenarios; records show **five** nulls (8, 10, 11, 12, 13). Drift only — tests themselves label why.

---

## 7. Handoff overclaim check

| Handoff claim | Reviewer check | Result |
| ------------- | -------------- | ------ |
| “13 scenarios, **2 real connections each**” | 12 uses alpha alone; 11 is sequential with sleep | **OVERCLAIM** (RV-CE-002) |
| Scenario 2 table: “Evidence **expires** while lock-parked” | Test explicitly REVOKEs evidence; comments say not clock expiry | **OVERCLAIM in summary table** (RV-CE-001); body of test is honest |
| `format:check` FAIL, pre-existing / CRLF vs content split | Claim is **recorded as residual**, not hidden; this session did not re-measure 813/105 | Residual recording **style is correct**; counts **NOT RE-VERIFIED** |
| Node v24 vs `.nvmrc` | This session also Node v24.14.1 | **Correctly recorded** |
| Vitest 780/33/0 skipped | Not re-run full package this session | **NOT VERIFIED** here |
| Containment gap + live lookup | Rename probe + BEFORE→AFTER | **Holds** |
| Snapshot `revokedCertificateSerials` still unwired | Stated as known limitation | Honest residual |

---

## 8. Findings

| Finding ID | Severity | Location | Description | Required remediation | Blocking? |
| ---------- | -------- | -------- | ----------- | -------------------- | --------- |
| `RV-CE-001` | MEDIUM | Phase D handoff table row #2 vs scenario 2 test | Summary says evidence **expires**; suite proves mid-park **REVOKED** evidence (same consume refusal branch, different lever). A reader of the handoff alone over-reads clock-expiry coverage. | Correct the handoff table to “invalidated / REVOKED mid-park (not clock expiry)”. | no — condition |
| `RV-CE-002` | MEDIUM | Phase D handoff §1; suite header “three” nulls | Packaging “13 races × 2 connections” overstates: #11 is lease-sequential (`pg_sleep`), #12 is single-backend atomicity. Five scenarios record `betaBlocked: null`, not three. | Qualify handoff (and optionally suite header) so non-lock scenarios are not sold as Lock-barrier races. | no — condition |
| `RV-CE-003` | NOTE | SECTION 47b | Structure is executable three-door + matrix; this review did not re-print `PASS ws11-phase-d-containment` on a clean `db:test`. | Re-run `db:test` (or section extract) once local section-33 collision is cleared; attach notice. | no — condition |
| `RV-CE-004` | NOTE | Other device-identity tests (`consumer-fixtures`, `credential-lifecycle`) | Stubs `isCertificateRevoked: () => false` remain outside the containment suite. Handoff already names the snapshot-wiring gap. | Out of Phase D scope; do not treat package-wide green as “every verifier path joins DB revocation”. | no |

No CRITICAL/HIGH finding that a Lock-barrier green test invents concurrency it did not observe.

---

## 9. Acceptance mapping (this lens)

| Question | Result |
| -------- | ------ |
| 13 races REAL (separate connections, barriers, PIDs)? | **8 Lock-serialised REAL** (1–7, 9); **2 SKIP-LOCKED concurrent REAL** (8, 10); **1 permission REAL** (13); **2 non-race proofs** (11 lease, 12 atomicity). PIDs separate wherever two backends used. |
| Can harness barrier pass without overlap? | **No** for `observeBlocked`. |
| SECTION 47b three doors? | **Exercised in SQL source** (A/B/C + worker lapse); full `db:test` notice **NOT RUN** here. |
| Containment BEFORE→revoke→AFTER real? | **Yes** (executed + rename fails closed). |
| Handoff format:check / Node v24 residual? | **Correctly disclosed**; Node residual **reconfirmed**; format counts not re-audited. |
| Scenario 13 = 42501 not 42883? | **Yes** (executed). |
| Scenario 7 still proves claim? | **Yes** (Lock + 57014 + complete + tenancy). |

---

## 10. Decision

### **APPROVED-WITH-CONDITIONS**

The concurrency suite’s Lock-barrier and SKIP-LOCKED scenarios are **not theatrical**: separate `pg.Client` backends, observer-proven Lock waits (or positive non-block under timeout), and loser SQLSTATE/outcome recorded. Scenario 13 is a real **42501** grant proof with catalog-derived arity. Containment is a real BEFORE→AFTER join through `pg-revocation-lookup.ts`.

Conditions before treating the Phase D handoff as citation-grade evidence packaging:

1. **C1** — Fix handoff scenario-2 wording (invalidation ≠ expiry).  
2. **C2** — Stop counting scenarios 11–12 as Lock races / “two connections each” without qualification.  
3. **C3** — Attach a clean `PASS ws11-phase-d-containment` from `db:test` when the local section-33 fixture issue is cleared (or an isolated section run).

None of C1–C3 require rewriting the race harness or the Lock scenarios themselves.

### Merge / promotion

- [ ] reviewed commit unchanged for concurrency/containment sources  
- [x] no blocking test-integrity defect on Lock races  
- [ ] C1–C3 addressed or explicitly accepted by owner  
- [ ] **Do not promote** Step 4 status from this review alone  

---

## 11. Reviewer truth statement

This reviewer did not treat the Phase D handoff, a build, or a prior agent summary as proof of concurrency. Lock waits, SQLSTATEs, PIDs, the containment rename failure, and scenario 13’s `42501` outcomes were observed from executed runs against the local database. Full `db:test` SECTION 47b notice was not re-printed in this session and is not claimed as re-verified.
