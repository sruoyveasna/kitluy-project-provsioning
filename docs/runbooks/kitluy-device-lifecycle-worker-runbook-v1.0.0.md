# Device lifecycle worker — operational runbook v1.0.0

Status: **development only**. There is no deployed scheduler; the worker runs
when something calls it. Cadence is a later infrastructure decision and is NOT
made by this document.

Scope: the durable job runtime of migration group `0135` and the three device
job kinds in `docs/jobs/kitluy-durable-job-registry-v1.0.0.md`.

## Identities

| Role                                | May                                                                        | May not                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `kitluy_worker_service` (NOLOGIN)   | enqueue, claim, start, complete, defer, fail, record attempts, read status | write any table directly; release, cancel or revive its own jobs; touch credentials, heads, keys or reservations |
| `kitluy_issuance_service` (NOLOGIN) | execute the governed credential operations                                 | claim or complete jobs                                                                                           |
| `kitluy_job_governor` (NOLOGIN)     | owns the job tables and functions                                          | log in                                                                                                           |

Job authority and credential authority are **separate grants held by the same
process**, and neither role is a member of the other. A worker cannot `SET ROLE`
to the issuance service: the process holds both memberships and switches between
them via the session role. A worker that could clear its own escalation would
never escalate.

## Reading the status board

```sql
select kitluy_ops.durable_job_status_summary_v1('development');
```

Always scoped by environment; optionally by kind and subject. There is no
unscoped variant — an operations view that can see everything is a cross-tenant
view waiting for tenants to exist.

Returns queued, leased/running, retry-scheduled, manual-review, dead-letter,
completed and cancelled counts, stale-lease count, oldest queued and oldest
overdue retry ages, and breakdowns by kind and by failure code.

## What each state means, and what to do

**`queued` / `retry_scheduled`** — waiting. Nothing to do. A retry-scheduled job
whose `next_attempt_at` is far in the future is usually a DEFERRAL: the overlap
is still running and the job is due at the authoritative boundary. That is
healthy, not stuck.

**`leased` / `running` with an expired lease** — a worker died. The next claim
reclaims it automatically, keeping the attempt history. Expiry is not an outcome
and never becomes one. If `stale_leases` stays above zero across sweeps, no
worker is running.

**`manual_review`** — a human is required, and the job escalated on its FIRST
attempt because the failure was one a retry cannot fix. Read the attempt
evidence:

```sql
select attempt_number, called_operation, observed_business_state,
       operation_result, failure_code, outcome_classification, started_at
  from kitluy_ops.durable_job_attempts
 where job_id = :job_id
 order by sequence_no;
```

Then decide:

```sql
-- put it back to work
select kitluy_ops.release_manual_review_job_v1(:job_id, 'retry', :reason, :actor);
-- or record that it is resolved and needs no further attempt
select kitluy_ops.release_manual_review_job_v1(:job_id, 'resolved', :reason, :actor);
```

Both require a reason and an actor. Neither resets `attempt_count`: how hard
something was already tried is evidence, and releasing it does not undo that.

**`dead_letter`** — the attempt budget was exhausted. It does NOT return to the
queue by itself; an automatic path back turns "we gave up and recorded why" into
a loop. Two deliberate governed acts are required:

```sql
select kitluy_ops.escalate_dead_letter_job_v1(:job_id, :reason, :actor);  -- -> manual_review
select kitluy_ops.release_manual_review_job_v1(:job_id, 'retry', :reason, :actor);
```

**`completed` / `cancelled`** — terminal. A completed job cannot be reopened,
retried or cancelled. Re-running discovery returns the existing completed job
rather than manufacturing a second one to do the same work again.

## Specific situations

### "A device shows KEY_DESTRUCTION_NOT_AUTHORIZED"

Working as designed. The key is eligible on the facts and nobody is authorized
to destroy it, because no owner decision exists — **KLREQ-031**. The job is
COMPLETED, not retried: asking an absent decision a sixth time produces the
fifth answer, and retrying would eventually dead-letter a job whose result was
correct every time.

Nothing to do operationally. When the owner decision lands, the policy reference
changes and a NEW deduplicated evaluation job asks the question again.

### "Database and provider disagree"

The job is in `manual_review` with a failure code naming the divergence. **Do not
regenerate a key to make the error go away.** The reconciler refused precisely
because it could not tell which side is right, and a regenerated key would make
the device's real key unreachable while looking repaired. Investigate both
systems, then release the job with a reason recording what was found.

### "A job payload looks wrong"

It cannot be edited. Job kind, version, dedupe key, subject, environment and
payload are immutable after creation, enforced by trigger — retrying a job as a
different kind or against a different subject is not a retry. Cancel it with a
reason and let discovery create the correct job.

### "Jobs are piling up in queued"

No worker is claiming. There is no deployed scheduler yet; this is expected in
development and is the gap Prompt 3C deliberately did not close.

## What must never be done

- Do not delete job rows. They are cancelled or dead-lettered; the no-delete
  trigger refuses deletion, and the attempt history is append-only.
- Do not grant the worker table authority to "unblock" something.
- Do not enable `kitluy_devices.key_destruction_policy`. It cannot be enabled by
  flipping a boolean, and it must not be enabled by naming a decision that does
  not exist.
- Do not treat a worker retry as a substitute for provider durability.

## Known limitations

- **No scheduler, no cron, no queue infrastructure.** The runtime is callable
  only.
- **Provider durability across a real process restart is NOT proven.** The
  development key provider is in memory, so a reconstructed worker is handed the
  same instance. PostgreSQL state IS durable and is re-read on every path. When
  a reconstructed worker cannot resolve a provider key reference the job goes to
  `manual_review` with a typed provider-key-missing result and durable evidence;
  it never silently generates a replacement.
- **No credential revocation** anywhere in the system (KLRISK-DEVICE-007).
- Pilot and production are not authorized: `durable_jobs` carries a CHECK
  pinning `environment = 'development'`.
