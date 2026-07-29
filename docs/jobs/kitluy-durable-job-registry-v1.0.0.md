# KitLuy durable-job registry v1.0.0

Status: **IMPLEMENTED-IN-DEV (development only)**. Relational contract is
migration group `0135`; the typed client is `@kitluy/job-contracts`.

This registry names every durable job kind, states how its identity is derived,
and records how outcomes are classified. A job kind that is not here does not
exist: the runtime claims only kinds it has a registered handler for.

## The contract in one paragraph

Work is discovered by a pure read, given a deterministic identity, and enqueued.
A worker claims it under a lease, executes the ALREADY-GOVERNED operation that
owns the business effect, and records append-only evidence. Execution is
**at-least-once**; exactly-once BUSINESS EFFECT comes from deduplication, lease
ownership, idempotent operations and governed compare-and-swap — never from
pretending a second call did not happen.

## Job kinds

| Kind                                     | Version | Subject       | Calls                                           | Destroys anything  |
| ---------------------------------------- | ------- | ------------- | ----------------------------------------------- | ------------------ |
| `kitluy.devices.renewal-reconcile.v1`    | 1       | device record | `reconcileDeviceCredentialRenewal` (group 0133) | no                 |
| `kitluy.devices.credential-lifecycle.v1` | 1       | device record | `advanceDeviceCredentialLifecycle` (group 0134) | no                 |
| `kitluy.devices.key-cleanup-evaluate.v1` | 1       | device record | `evaluateKeyDestruction` — EVALUATION ONLY      | **no, and cannot** |

The version is in the NAME. A `v2` with different payload semantics deduplicates
separately from `v1` rather than silently colliding with it.

## Deduplication identity

Every key is built from AUTHORITATIVE lifecycle facts and nothing else. No
clock, no random value, no discovery timestamp — a timestamp here makes every
sweep create a duplicate.

| Kind                 | Bound to                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| renewal-reconcile    | kind, renewal attempt id, device, environment, purpose, schema version                                                     |
| credential-lifecycle | kind, device, environment, purpose, **credential-head version**, previous credential id, `overlap_ends_at`, schema version |
| key-cleanup-evaluate | kind, device, environment, provider key reference, key generation, `overlap_ends_at`, **policy reference**, schema version |

Two consequences worth stating explicitly:

- **The head version is what re-opens lifecycle work.** When a head advances,
  the previous credential and the overlap boundary are different facts, so it is
  genuinely new work. Without the version a device that renewed twice would
  reuse the first job — and that job already completed.
- **The policy reference is what re-opens cleanup work.** While KLREQ-031 is
  unresolved every evaluation reaches the same answer, so one job per key is
  correct. When an owner decision lands, the reference changes, the key changes,
  and a new job asks the question again — a policy decision re-opens work
  without anything having to poll for it.

## Worker decision table

### Renewal reconciliation

| Classification                                                                                                                                                                                                                                                                              | Job disposition                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `NO_ACTION_COMPLETED`, `RESPONSE_REPLAY`                                                                                                                                                                                                                                                    | completed                                                                          |
| `KEY_GENERATION_REQUIRED`, `KEY_METADATA_REGISTRATION_REQUIRED`, `POP_REQUIRED`, `ISSUANCE_PREPARATION_REQUIRED`, `SIGNATURE_REQUIRED`, `SIGNATURE_RECORDING_REQUIRED`, `FINALIZATION_REQUIRED`, `PROVIDER_ACTIVATION_REQUIRED`, `ACTIVATION_CONFIRMATION_REQUIRED`, `ABANDONMENT_REQUIRED` | executed through the reconciler; completed when nothing remains, otherwise retried |
| `RESERVATION_PENDING`                                                                                                                                                                                                                                                                       | retry                                                                              |
| `MANUAL_REVIEW_REQUIRED`, `INCONSISTENT_STATE`                                                                                                                                                                                                                                              | manual review                                                                      |

Recovery is single-step by design (group 0133): one action and one audit row per
call. When something remains, the job takes another bounded attempt rather than
looping inside the handler, so every step is separately visible and separately
interruptible.

### Credential lifecycle

| Classification                                                                              | Job disposition                                      |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `NO_ACTION_CURRENT`, `PREVIOUS_CREDENTIAL_RETIRED`, `KEY_STILL_REFERENCED`, `KEY_DESTROYED` | completed                                            |
| `KEY_DESTRUCTION_NOT_AUTHORIZED`                                                            | **completed** — a policy-blocked result, not a fault |
| `OVERLAP_ACTIVE`                                                                            | **deferred to the persisted `overlap_ends_at`**      |
| `OVERLAP_EXPIRED`                                                                           | retry                                                |
| `KEY_DESTRUCTION_PENDING`                                                                   | retry (unreachable while KLREQ-031 is open)          |
| `MANUAL_REVIEW_REQUIRED`, `INCONSISTENT_STATE`                                              | manual review                                        |

## Retry classification

| Class              | Meaning                                                          | Examples                                                                                                                                           |
| ------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retryable`        | Repeating the SAME call could succeed with nothing else changing | `PROVIDER_UNAVAILABLE`, `DATABASE_SERIALIZATION_FAILURE`, `TRUSTED_TIME_UNAVAILABLE`, `LEASE_SAFE_TIMEOUT`                                         |
| `manual_review`    | A retry cannot fix it                                            | `DATABASE_PROVIDER_FINGERPRINT_DIVERGENCE`, `PROVIDER_KEY_MISSING`, `CONFLICTING_SIGNATURE`, `AUTHORIZATION_FAILED`, `SCHEMA_VERSION_INCOMPATIBLE` |
| `terminal_success` | A correct, final answer                                          | `RECONCILIATION_ALREADY_COMPLETED`, `JOB_RESULT_REPLAYED`, `KEY_DESTRUCTION_NOT_AUTHORIZED`                                                        |

**An unclassified code fails CLOSED, toward a human.** A code nobody classified
is a code nobody understood, and retrying it until the budget runs out only
delays the person who has to look at it.

**A divergence escalates on the FIRST attempt.** Two systems disagreeing does not
improve by being asked again; burning four more attempts on it before escalating
just adds forty minutes.

## Retry schedule

`0s → 30s → 2m → 10m → 30m (capped)`, plus bounded jitter of at most 60s from an
injected source.

The schedule is owned by the DATABASE (`kitluy_ops.durable_job_backoff_seconds_v1`)
because `next_attempt_at` is the database's column and a caller-supplied delay
would let a buggy worker hammer a provider ten times a second and call it policy.
`@kitluy/job-contracts` mirrors it, and a live conformance test asserts the two
agree attempt by attempt — the same cross-layer discipline the credential-overlap
boundary uses.

## Two counters, deliberately

`attempt_count` is **monotonic** evidence of how often a job was picked up and is
never decremented. `deferral_count` records how many of those claims ended in
"not due yet"; the retry BUDGET is `attempt_count - deferral_count`.

Conflating them breaks one of them: refunding a deferral by decrementing would
falsify the history, and charging deferrals to the budget would dead-letter a
perfectly healthy device whose overlap simply ran for three days.

## Clock separation

| Scheduler / server time                                           | Business trusted time                                                                                     |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| job creation, `next_attempt_at`, lease expiry, backoff, heartbeat | credential validity, renewal eligibility, overlap expiry, retirement, destruction eligibility, revocation |

Discovery may FIND a candidate using the persisted, indexed `overlap_ends_at` —
finding is not deciding — but no business verdict is ever taken against server
time. A deferred job stays out of the queue until server time reaches its
boundary, and reaching it grants no verdict: the lifecycle service still decides
against trusted time when the job finally runs.

## What this registry does NOT provide

- **No scheduler.** Nothing here has a timer, and there is no cron, pg_cron,
  Kubernetes CronJob or Supabase scheduled function. Deployment cadence is a
  later infrastructure decision.
- **No key destruction.** `key-cleanup-evaluate` reads an eligibility answer and
  has no reference to a destroy operation — not a disabled one, not a guarded
  one, none. Blocked on **KLREQ-031**.
- **No credential revocation.** No such governed operation exists anywhere
  (KLRISK-DEVICE-007). Overlap retirement is not revocation and key destruction
  is not revocation.
- **No proven provider durability** across a real process restart.
