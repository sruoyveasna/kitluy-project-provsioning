# Renewal and credential-lifecycle worker runtime — AI Handoff

| Field           | Value                                                            |
| --------------- | ---------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Prompt 3C (scheduled execution and controls) |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                     |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                      |
| Starting SHA    | `54dbcd3`                                                        |

## Scope

**In:** a scheduler-neutral worker runtime — discovery, deterministic durable
jobs, leased claims, execution of the ALREADY-GOVERNED operations, outcome
classification, bounded retry, append-only attempt evidence, operational status
and governed operator controls.

**Out, and absent rather than stubbed:** production cron, Kubernetes CronJobs,
DigitalOcean scheduled jobs, Supabase cron, external queue infrastructure,
automatic key destruction, credential revocation, production provider
persistence.

## Shared infrastructure: reused, not duplicated

The cloud database was probed before anything was designed. Nothing matching
`(job|queue|lease|dead_letter|worker|schedul)` existed except
`net.http_request_queue`, which belongs to the `pg_net` EXTENSION, and no
lease/attempt/backoff column existed in any `kitluy_*` schema.

The Hub DOES have a lease model (`hub/migrations/0016_sync_outbox_leasing`). It
was examined and deliberately not extended, on two facts rather than preferences:

1. It lives in `kitluy_hub_local`, a SEPARATE database. Device credentials live
   in the cloud one, and a job table cannot lease work it cannot see.
2. Its semantics are an ORDERED stream — the scan STOPS rather than skips,
   because skipping past an undelivered event silently reorders history. Device
   jobs are INDEPENDENT per device, so one stuck device must never block another
   device's renewal. Reusing it would have imported a head-of-line block as a
   feature.

So group `0135` builds the contract, and builds it NEUTRAL: nothing in it names a
device, a credential or a key. Work arrives as a job KIND and an opaque
`subject_id`. `@kitluy/job-contracts` — SCAFFOLDED since bootstrap — is the
matching package boundary and now implements this contract; `@kitluy/device-identity`
consumes it through an adapter that holds no reconciliation or lifecycle logic of
its own.

Placement was decided by the validator, not by taste:
`scripts/database/db-validate.mjs` allowlists exactly one control-plane schema,
`kitluy_ops`. A new `kitluy_jobs` schema would have failed `db:validate`.

## What was built

`kitluy_ops.durable_jobs` and the append-only `durable_job_attempts`, with
governed functions for enqueue, claim, start, complete, defer, fail, evidence,
scoped status, and the operator controls (release, cancel, escalate).

- **`FOR UPDATE SKIP LOCKED`**, the opposite choice from the Hub, for the reason
  above.
- **`leased` and `running` are distinct states.** A worker that died between
  claiming and starting left no business effect; one that died after starting may
  have left a complete effect whose acknowledgement was lost. Collapsing them
  would erase the distinction recovery needs.
- **At-least-once, and it says so.** Exactly-once BUSINESS EFFECT comes from
  deduplication, lease ownership, idempotent operations and governed
  compare-and-swap. Nothing claims exactly-once execution.
- **Two counters.** `attempt_count` is monotonic evidence of claims;
  `deferral_count` records how many ended in "not due yet"; the retry budget is
  the difference. See below — the first design got this wrong.

## Clock separation, enforced and tested

Scheduler time sets `next_attempt_at`, leases and backoff. Credential validity,
overlap expiry and destruction eligibility remain TRUSTED-time decisions taken by
the services of groups 0125-0134.

Discovery may FIND a candidate using the persisted, indexed `overlap_ends_at` —
finding is not deciding. When the overlap is still running the job is DEFERRED to
that persisted boundary, to the millisecond, never to a freshly invented
duration; and the live test proves that reaching the due time in server time
grants no business verdict, because the lifecycle service still decides against
trusted time when the job runs.

## Verification (Node v24.15.0, canonical order)

| Gate                                  | Exit | Result                                         |
| ------------------------------------- | ---- | ---------------------------------------------- |
| `pnpm db:reset` → `db:seed`           | 0    | clean rebuild, 0000→**0135**                   |
| `pnpm db:test`                        | 0    | **184 PASS** (new sections 40a, 40b)           |
| `pnpm test:rls`                       | 0    | **104 PASS**                                   |
| `@kitluy/device-identity` vitest      | 0    | **589 passed / 0 skipped** (25 files)          |
| — live job suite                      | 0    | **12 EXECUTED**, 0 skipped (3 dual-connection) |
| — job unit suite                      | 0    | **34 passed**                                  |
| `pnpm typecheck` / `lint` / `build`   | 0    | 89/89 · 0 errors, 2 pre-existing warnings      |
| `pnpm clock:check --require-complete` | 0    | COMPLETE 4/4                                   |
| `pnpm secret:scan`                    | 0    | clean                                          |
| `db:migrations:check`                 | 0    | 34 migration files                             |
| `docs:verify` (8 steps)               | 0    | **8/8 PASS**                                   |
| `verify` (12 steps)                   | —    | **11/12**; `format:check` pre-existing         |

**TOOLCHAIN DEVIATION.** Node 22.23.0 is still not installed. Aggregate
verification is NOT baseline-authoritative; every step ran individually with the
documented override and no config file was changed.

## Tests: passed / failed / not run

All added tests pass. Nothing was skipped — the live suite EXECUTED against
PostgreSQL, and three of its scenarios use TWO REAL CONNECTIONS, because two
workers sharing one `pg` client is not concurrency.

**Not separately proved live:** the renewal-reconcile job WRAPPER. Its handler
and decision table are unit-tested, and the reconciliation state machine it calls
already has the 21-case live crash matrix from Prompt 3A. Stated rather than left
to be inferred from the aggregate count.

### Four defects found by executing this group

All are in code first written this session and were corrected before it shipped,
so none opens a KLRISK entry. The shapes recur, which is why they are recorded:

1. **`running -> leased` was missing from the transition table**, so a worker that
   died AFTER starting could never be reclaimed — the crash this model exists for
   was the one crash it could not recover from.
2. **`record_job_attempt_v1` reached `extensions.digest()`**, which its
   SECURITY DEFINER owner has no USAGE for. Every attempt record failed. The
   migration's own assertions had missed it because they inspected grants without
   CALLING the function; an assertion that executes it was added.
3. **Ownership transfer needed CREATE on `kitluy_ops`**, which group 0000 revokes
   from public. Same family as KLRISK-DEVICE-004.
4. **The worker role was not assumable at all** — nothing granted membership, as
   group 0127 does for the issuance service.

### A test-isolation defect

The live suite was intermittently green. The concurrency scenarios must COMMIT,
so a mid-test failure leaked claimable rows and the next run's claim assertions
picked up a stranger's job; section 40b compounded it by committing a `queued`
job under the REAL device job kind. Fixed three ways — per-scenario unique job
kinds, a test-only kind in the assertions, and a purge of leftover
`kitluy.test.%` jobs before the suite starts. Four consecutive full runs at
589/589 afterwards. A flaky boundary test is worse than no boundary test.

## Security findings

The worker holds NO direct table authority — not on the job tables, not on
credentials, heads, keys or reservations. It cannot release, cancel or revive its
own jobs (a worker that could clear its own escalation would never escalate), and
it cannot retire a credential without separately assuming
`kitluy_issuance_service`. Job authority and credential authority are distinct
grants and neither role is a member of the other; the process holds both
memberships and switches between them.

A stale lease token can neither complete nor fail a job. Attempt history is
monotonic and job identity and payload are immutable against a direct write by
the table owner. A dead letter cannot requeue itself. Jobs cannot be deleted. The
audit stores a lease-token FINGERPRINT, never the token — the token is the
authority to complete a job, and writing it into a table every operator can read
would hand that authority to every reader of the audit.

`KEY_DESTRUCTION_NOT_AUTHORIZED` is classified `terminal_success` and COMPLETES
the job. Retrying an absent owner decision can only reach the same answer, and
would eventually dead-letter a job whose result was correct every time. The
cleanup handler contains no destroy call of any kind. Live evidence:
`eligible: true, authorized: false`, provider destroy calls **0**, database
destroyed transitions **0**, `destruction_enabled` still false.

## Known limitations

**No scheduler was deployed, and none was written** — no cron, pg_cron,
Kubernetes CronJob, Supabase scheduled function or timer anywhere. The runtime is
callable only; cadence is a later infrastructure decision, and a migration that
scheduled itself would be that decision taken silently.

Provider durability across a real process restart is **not** proven — the
development provider is in memory. Recovery decisions do come from OBSERVED
database state, re-read on every path, and an unresolvable provider key reference
goes to `manual_review` with a typed result and durable evidence rather than a
silently regenerated key. `durable_jobs` pins `environment = 'development'`.
Still **no governed credential revocation** (KLRISK-DEVICE-007) — a scheduled
executor is not revocation. No independent review.

## Current implementation status (evidence register delta)

**Renewal and credential-lifecycle worker runtime — IMPLEMENTED-IN-DEV
component.**

**Production scheduling/deployment — NOT IMPLEMENTED.**
**Provider-key destruction — BLOCKED ON KLREQ-031.**
**Cross-process provider durability — NOT PROVEN.**

`@kitluy/job-contracts` advances SCAFFOLDED → IMPLEMENTED-IN-DEV (neutral runtime
only). Nothing else advances. WS-11-T003 Step 4 is NOT complete; WS-11 stays
SCAFFOLDED / IN PROGRESS.

## Recommended next task

Prompt 3D — governed credential revocation and recovery disposition. Not begun.
