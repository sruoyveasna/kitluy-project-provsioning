# WS-11-T003 Step 4 — Phase D: concurrency, lifecycle and containment verification

| Field           | Value                                                                   |
| --------------- | ----------------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Phase D (verification; migration 0154 as a repair)  |
| Date / timezone | 2026-07-30 · Asia/Phnom_Penh                                            |
| Repository root | C:/Users/Hello-Evo-PC/Desktop/HET-KITLUY-PROJECT                        |
| Start SHA       | e2cd3f7 (Phase C handoff)                                               |
| Status          | Phase D GREEN — **NOT** Step-4 complete, **NOT** independently reviewed |

## What this phase was for

Phases A–C built the governed emergency door and closed RC-021/022/023. None of
that work had been asked the two questions that decide whether a revocation is
real:

1. **Does it hold when two sessions arrive at once?** Every prior test ran on one
   connection, so every "exactly once" claim rested on reading the SQL rather
   than on observing a loser.
2. **Is a revoked credential actually dead?** The write side refused to
   un-revoke, and the verifier refused a revoked serial — and nothing connected
   them.

Phase D answers both by execution. It found two defects doing so, one of which
(§"The containment gap") meant that until this phase, **a fully governed,
four-eyes, append-only revocation did not stop the credential authenticating.**

## 1. True-concurrency suite — 13 scenarios, 2 real connections each

`packages/device-identity/test/governed-emergency-concurrency.integration.test.ts`
(14 tests: 13 scenarios + a closing membership census).

Thirteen scenarios. **Not all are Lock-barrier races** (Phase E RV-CE-002).
Nine (1–7, 9) park one session inside a contended lock on genuinely separate
`pg` connections (`kitluy-race-alpha` / `kitluy-race-beta`, plus
`kitluy-race-keeper`) and record backend PID, the barrier that proved the
overlap, the winner, the loser's SQLSTATE and the final state. Two (8, 10) are
true concurrent `SKIP LOCKED` races whose null barrier is by design. Two (11, 12) are sequential / single-backend proofs (stale lease; audit-failure
atomicity) — real properties, not Lock races. Shared machinery lives in
`test/support/race-harness.ts`.

| #   | Kind                         | What is raced / proven                                               | Result                                                               |
| --- | ---------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Lock race                    | Double-spend of one re-auth evidence row                             | Exactly one emergency; loser refused, evidence consumed once         |
| 2   | Lock race                    | Evidence **REVOKED** while lock-parked (not clock expiry; RV-CE-001) | Refused after the lock is granted — freshness is not pre-checked     |
| 3   | Lock race                    | Permission revoked during execution                                  | Queued emergency stops; authority is evaluated **after** the lock    |
| 4   | Lock race                    | Duplicate idempotency key                                            | One authorization; the second collides on the unique constraint      |
| 5   | Lock race                    | Two overlapping recorded scopes                                      | Credential revoked exactly once; the second scope spends nothing     |
| 6   | Lock race                    | Normal vs emergency revocation                                       | Exactly one revocation account, not two                              |
| 7   | Lock race                    | Device ownership changes mid-flight                                  | Still revokes; governed assignment-revocation **serializes** (57014) |
| 8   | Concurrent SKIP LOCKED       | Post-approval vs lapse sweeper                                       | Exactly one verdict                                                  |
| 9   | Lock race                    | Two competing post-approvers                                         | Exactly one verdict                                                  |
| 10  | Concurrent SKIP LOCKED       | Two concurrent lapse workers                                         | Lapsed exactly once (`FOR UPDATE SKIP LOCKED`)                       |
| 11  | Sequential (not a Lock race) | Stale worker after its lease was replaced                            | Completion refused                                                   |
| 12  | Single-backend atomicity     | Audit-write failure                                                  | Every write unmade, including the audit trail                        |
| 13  | Permission, not Lock         | Legacy entry point racing the governed one                           | Cannot race: **no runtime role may call it** (42501)                 |

Scenario 13 derives the legacy function's 18-argument signature from
`pg_get_function_identity_arguments` at runtime. A hand-written signature had
produced `42883 function does not exist`, which would have passed as "denied"
while proving nothing; the catalog-derived call fails with `42501 permission
denied`, which is the fact under test.

Scenario 7 is the one that changed shape under execution. The first design had
the keeper call `revoke_device_assignment_v1` while alpha's emergency held the
device row, and the suite **hung**: `pg_stat_activity` showed alpha
`idle in transaction`, keeper blocked on `Lock/transactionid`. That is the
correct behaviour, not a bug — so the scenario now asserts it directly (the
governed call times out at 57014) and performs the ownership change by a direct
`UPDATE` as `postgres`, which is the only way to change ownership _without_
serialising and therefore the only way to test the mid-flight case at all.

## 2. Lifecycle and containment matrix — SQL section 47b

`supabase/tests/assertions.sql`, `PASS ws11-phase-d-containment`.

Three credentials are killed by **three different governed doors** — the normal
bound path, a governed emergency a second human APPROVED, and a governed
emergency the worker swept to LAPSED — and then the same matrix is applied to
all three: renewal refused at reservation and at prepare; restoration refused
**to the credential governor itself**, both as a state change and as a cleared
`revoked_at`; revocation evidence refuses UPDATE and DELETE; a settled verdict
cannot be rewritten in either direction; the overlap window does not resurrect a
generation revoked inside it.

**"Cannot become current" is asserted in its only honest form.**
`device_credential_heads.current_generation` is a monotonic counter, not a
validity oracle — it _does_ point at the revoked generation and the
`enforce_head_authority` trigger requires that it keep doing so. Containment
therefore rests on consumers, so the assertion is a catalog census: **no view may
read the heads table**, and every function that reads it must constrain
credential state. Seven functions read it; all seven filter. That census is the
invariant, and it is now permanent.

The section leaves no standing authority, no ACTIVE re-auth evidence and no
borrowed role membership, and asserts all three.

## 3. The containment gap — a revoked credential could still authenticate

`evaluateCertificateValidity` takes a `RevocationLookup` and rejects with
`CERT_REVOKED` before it even considers expiry. `revocationLookupFrom` builds
one from a signed snapshot whose `revokedCertificateSerials` are **caller
supplied**. Nothing in the repository populated that list from the revocation
tables. Every test that reached the verifier passed
`isCertificateRevoked: () => false` — which was not a stub standing in for an
implementation; **it was the only implementation.**

So both halves looked finished and there was no join. A credential revoked
through the full four-eyes path kept verifying, because the component that would
have objected was never told.

**New production module** `packages/device-identity/src/pg-revocation-lookup.ts`:

- `loadRevocations(client, scope)` — reads authoritative state once, keyed on
  `serial_number` (what the verifier reads out of the TBS; `credential_id` never
  appears in a certificate). `state = 'revoked' OR revoked_at is not null` is an
  OR, not an AND: a CHECK keeps the pair in step, and the OR decides which way to
  fail if it ever did not.
- `createLiveRevocationLookup` — asks the database per question. Correct and slow
  by construction, and explicitly **not usable offline**: with no connection every
  call throws, and a verifier treating a thrown lookup as "not revoked" would
  fail open.
- `DEVICE_REVOKING_LIFECYCLE_STATES = ['retired']`, guarded by
  `assertLifecycleStatesExist`. The first draft also named `decommissioned`,
  which **is not a member of the `device_lifecycle_state` enum** — device-level
  revocation would have matched nothing, silently. The guard now refuses to run
  against a database whose states it does not recognise, and a test proves the
  refusal.

`test/revocation-containment.integration.test.ts` (5 tests) is shaped
`verify BEFORE → revoke through a REAL governed door → verify AFTER`. The BEFORE
leg is the point: an AFTER-only test passes just as happily against a lookup that
reports everything revoked.

Deliberately narrow, and recorded rather than decided:
`suspended`, `quarantined` and `restricted_investigation` are reversible
operational gates and `evaluateCertificateValidity` cannot express
"temporarily", so they are excluded —
**[REQUIRED: owner decision on whether quarantine or suspension must also deny
certificate validation at the edge, or remain gate-level controls]**.

## 4. Defect found and repaired — migration 0154

Group 0152 granted EXECUTE on the lapse sweeper to `kitluy_worker_service` and
verified itself with `has_function_privilege`, which was TRUE. The grant was
real and **unusable**: reaching a function needs USAGE on its schema too, and
the worker held USAGE on `kitluy_ops` only. Every call by the intended caller
died with `42501 permission denied for schema kitluy_devices` before the body
ran. Nothing caught it because the existing assertions call the sweeper as
`postgres` or `kitluy_issuance_service` — never as the role the durable job
actually runs under.

Consequence had it shipped: containment still held (the credential stays
revoked), but the only mechanism that converts an unreviewed emergency into a
recorded LAPSED verdict plus an escalation could never fire. **A missing
escalation looks exactly like nothing to escalate.**

`20260730180154_0154_lapse_sweeper_worker_reachability.sql` grants USAGE on
`kitluy_devices` and nothing else, then asserts the _capability_ rather than the
grant: both privilege halves for the intended caller; zero PUBLIC-executable
functions in the schema (so USAGE cannot widen silently, checked as a refusal);
zero table privileges leaked; and finally it **calls the sweeper under
`set role kitluy_worker_service`** inside a savepoint with a deliberately unused
environment. `set role`, not `set local role` — outside an explicit transaction
the LOCAL form is a no-op with a warning and would have run the probe as the
migration's own superuser, proving nothing.

A wrapper in `kitluy_ops` was rejected: it would add a second public entry point
to the emergency lifecycle and a second place for a grant to drift out of step
with the function it fronts, which is the failure being repaired.

## Files created / changed

```text
A supabase/migrations/20260730180154_0154_lapse_sweeper_worker_reachability.sql
A packages/device-identity/src/pg-revocation-lookup.ts
A packages/device-identity/test/revocation-containment.integration.test.ts
A packages/device-identity/test/governed-emergency-concurrency.integration.test.ts
A packages/device-identity/test/support/race-harness.ts
M packages/device-identity/src/index.ts            (export the lookup)
M supabase/tests/assertions.sql                    (SECTION 47b)
M packages/device-identity/test/pg-revocation-gateway.integration.test.ts  (formatting only)
M 00_AI_HANDOFF/000_INDEX.md, .../ENFORCE-GOVERNED-EMERGENCY handoff       (formatting only)
```

Groups 0136–0153 are COMMITTED and were **not** edited. 0154 is additive. No
migration was applied anywhere but the local database (KL-INF-P1-037 honoured).

## Commands executed — actual results

```text
db:reset (through 0154)                       PASS   0154 notice: "lapse sweeper reachable
                                                     as kitluy_worker_service; outcome=LAPSED"
db:seed                                       PASS
db:test                                       PASS   incl. PASS ws11-phase-d-containment
test:rls                                      PASS   (rls-tests complete)
@kitluy/device-identity vitest run            PASS   780 tests / 33 files, 0 skipped
  · governed-emergency-concurrency            14 PASS
  · revocation-containment                     5 PASS
  · pg-revocation-gateway                      2 PASS
migrations:validate                           PASS   53 files
node scripts/verification/verify.mjs          11/12  (see below)
```

`pnpm verify` — PASS on lint, typecheck, unit, contract, offline harness, build,
OpenAPI, **migration validation**, secret scan, clock usage, docs links.
**FAIL on `format:check`, and that failure is pre-existing and not this task's.**

## Format check — measured, not assumed

`format:check` reports 813 files. That number is two different things and the
distinction was established by execution, not asserted:

- `core.autocrlf=true` with **no `.gitattributes`**, so every text file in a
  Windows working tree is CRLF while Prettier defaults to `endOfLine: "lf"`.
  ~708 of the 813 are this artifact only.
- Checking the **committed** blob of all 1031 tracked files through the Prettier
  API: 1 file has CRLF committed, and **105 are genuinely unformatted** — 102 of
  them imported authority documents, QA/infrastructure specs and `pnpm-lock.yaml`
  last touched on 2026-07-26 to 2026-07-29, long before this phase.

Three are fixed here: `pg-revocation-gateway.integration.test.ts`, which Phase C
committed unformatted and is genuinely this session's defect, plus
`000_INDEX.md` and the Phase A handoff. The remaining 102 are **recorded, not
fixed** — reformatting imported source-of-truth documents is an out-of-scope
change to authority material (CLAUDE.md hard rule 1). Four of those 102 received
an appended row from this phase and were still left alone
(`000_CURRENT_STATE.md` and the three registers), because Prettier's fix for
each is a whole-file table realignment that would bury the Phase D addition
inside it right before independent review. See the register entry.

## Toolchain deviation

Node **v24.14.1**, not the `.nvmrc` baseline (`>=22.12.0 <23`); `pnpm` was
reached through a local shim and `npm_config_engine_strict=false`. Every result
above was produced under that deviation and should be re-run on the baseline
before promotion.

## Intentionally NOT done

- **Phase E** — three independent reviewers and the Step 4 promotion gate.
- No evidence-register status was promoted. Phase D is verification; promotion
  needs Phase E.
- T004–T008. No push. No production migration.

## Known limitations

- Concurrency is proven on a local single-node Postgres; no multi-node or
  connection-pooler behaviour is covered.
- `createLiveRevocationLookup` has no caching or snapshot story for the offline
  edge — the Store Hub path still consumes signed snapshots, and **nothing yet
  populates a snapshot's `revokedCertificateSerials` from `loadRevocations`.**
  That wiring is the natural follow-on and is not in this phase.
- Device-level revocation deliberately covers `retired` only, pending the owner
  decision named above.
- No independent review of any of this work yet.

## Recommended next

Phase E — three independent reviewers, then the Step 4 promotion gate.
