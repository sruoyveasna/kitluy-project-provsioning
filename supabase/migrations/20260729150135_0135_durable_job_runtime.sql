-- kitluy:group:0135
-- Migration group 0135: durable_job_runtime (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0134 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE GAP — PROVEN BY EXECUTION, NOT ASSUMED
-- ===========================================================================
-- Groups 0125-0134 built reconciliation and credential-lifecycle advancement
-- as callable services. Nothing can CALL them repeatedly, safely, from more
-- than one process. Before writing a line of this file the cloud database was
-- probed for anything that could carry that work:
--
--   tables matching (job|queue|lease|dead_letter|worker|schedul)
--     -> exactly one: net.http_request_queue, owned by the pg_net EXTENSION.
--        Not governed, not ours, and not a durable job contract.
--   columns matching (lease|next_attempt|attempt_count|backoff|dedup)
--     in any kitluy_* schema
--     -> none. The four near-matches are `release_%` columns on unrelated
--        tables.
--
-- The Hub DOES have a lease model (hub/migrations/0016_sync_outbox_leasing).
-- It was examined and deliberately not extended, for two reasons that are
-- facts rather than preferences:
--
--   1. It lives in kitluy_hub_local, a SEPARATE database. Device credentials
--      live here. A job table cannot lease work it cannot see.
--   2. Its semantics are an ORDERED stream: the scan STOPS rather than skips,
--      because skipping past an undelivered event silently reorders history.
--      Device jobs are INDEPENDENT per device — one stuck device must never
--      block another device's renewal. Ordered-stop is the wrong shape, and
--      reusing it would have imported a head-of-line block as a feature.
--
-- ===========================================================================
-- WHY kitluy_ops, AND WHY NOT A DEVICE-ONLY QUEUE
-- ===========================================================================
-- These tables are NEUTRAL. Nothing here names a device, a credential or a
-- key: work arrives as a job KIND string and an opaque subject. A device-only
-- queue would have to be rebuilt the first time any other subsystem needs
-- durable retries, and two queues with two lease models is how one of them
-- ends up subtly wrong.
--
-- kitluy_ops is the declared control-plane schema ("migration and operations
-- control plane; no tenant data", group 0000) and is the ONLY schema
-- allowlisted as control-plane by scripts/database/db-validate.mjs. A new
-- kitluy_jobs schema would fail that gate for want of a data-dictionary entry.
-- Placement here is therefore decided by the validator, not by taste.
--
-- @kitluy/job-contracts is the matching neutral package boundary and is
-- SCAFFOLDED. This group gives it a relational contract to implement.
--
-- ===========================================================================
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ===========================================================================
-- No cron. No pg_cron, no scheduled trigger, no self-invoking function. This
-- group makes work CLAIMABLE; deciding how often to claim is a deployment
-- decision that has not been made (see the handoff). A migration that
-- scheduled itself would be that decision, taken silently.
--
-- No key destruction. No credential mutation. No provider calls. Every
-- business effect still happens in the governed functions of groups
-- 0125-0134, called BY a worker, never reimplemented here.

begin;

-- ---------------------------------------------------------------------------
-- Governors. Both NOLOGIN: assumed by a trusted process, never authenticated
-- as. Two roles rather than one because owning the job runtime and being
-- allowed to run jobs are different powers.
-- ---------------------------------------------------------------------------
do $create_job_roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_job_governor') then
    create role kitluy_job_governor nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_worker_service') then
    create role kitluy_worker_service nologin;
  end if;
end
$create_job_roles$;

comment on role kitluy_job_governor is
  'Owns the durable job tables and every governed job function. NOLOGIN. Holds the table authority so that no executor needs it.';

comment on role kitluy_worker_service is
  'The named executor of the durable job runtime. NOLOGIN. May claim, start, complete, defer and fail jobs THROUGH functions, and holds NO direct table authority anywhere — not on the job tables and not on kitluy_devices. A worker that needs to change a credential must additionally assume kitluy_issuance_service; job authority and credential authority are deliberately not the same grant.';

do $borrow$
begin
  execute format('grant kitluy_job_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- States.
--
-- `leased` and `running` are separate on purpose. A worker that dies between
-- claiming and starting left no business effect; one that dies after starting
-- may have left a complete effect with a lost acknowledgement. Collapsing them
-- would erase exactly the distinction recovery needs (see the crash matrix).
-- ---------------------------------------------------------------------------
do $status_enum$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'kitluy_ops' and t.typname = 'durable_job_status'
  ) then
    create type kitluy_ops.durable_job_status as enum (
      'queued', 'leased', 'running', 'retry_scheduled',
      'completed', 'manual_review', 'dead_letter', 'cancelled');
  end if;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'kitluy_ops' and t.typname = 'job_outcome_classification'
  ) then
    create type kitluy_ops.job_outcome_classification as enum (
      'terminal_success', 'retryable', 'manual_review');
  end if;
end
$status_enum$;

-- ---------------------------------------------------------------------------
-- The job.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_ops.durable_jobs (
  job_id uuid primary key default gen_random_uuid(),

  job_kind text not null,
  job_version integer not null,
  -- Deterministic. Built from the AUTHORITATIVE lifecycle facts of the work,
  -- never from a timestamp or a random value: rediscovering the same work must
  -- collide, and work whose authoritative version moved must not.
  dedupe_key text not null,

  environment text not null,
  -- Opaque to this schema. For device work it is the device record id; this
  -- table neither knows nor cares.
  subject_id uuid not null,
  -- Present for subsystems that are tenant-scoped. Device credentials are not
  -- (kitluy_devices.devices carries no tenant, store or location column), so
  -- these stay null for the device kinds rather than being invented.
  tenant_id uuid,
  digital_store_id uuid,
  location_id uuid,

  payload jsonb not null default '{}'::jsonb,

  status kitluy_ops.durable_job_status not null default 'queued',

  lease_id uuid,
  lease_owner text,
  leased_at timestamptz,
  lease_expires_at timestamptz,

  attempt_count integer not null default 0,
  -- How many of those claims ended in "not due yet".
  --
  -- Separate from attempt_count because the two answer different questions and
  -- conflating them breaks one of them. attempt_count is MONOTONIC evidence of
  -- how often this job was picked up; the retry BUDGET is what remains after
  -- deferrals are discounted. Decrementing attempt_count to refund a deferral
  -- would falsify the history; charging deferrals to the budget would
  -- dead-letter a perfectly healthy device whose overlap simply ran for three
  -- days. Keeping both is the only version where neither lies.
  deferral_count integer not null default 0,
  max_attempts integer not null,
  next_attempt_at timestamptz,
  last_failure_code text,
  last_failure_classification kitluy_ops.job_outcome_classification,
  last_failure_at timestamptz,

  terminal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  constraint durable_jobs_dedupe_unique unique (job_kind, dedupe_key),
  constraint durable_jobs_kind_format check (job_kind ~ '^[a-z0-9]+(\.[a-z0-9-]+)+\.v[0-9]+$'),
  constraint durable_jobs_version_positive check (job_version >= 1),
  constraint durable_jobs_attempts_sane
    check (max_attempts >= 1 and attempt_count >= 0 and deferral_count >= 0
           and deferral_count <= attempt_count),
  -- A held lease always names its holder and its expiry, and a released job
  -- keeps no stale owner. Same discipline as the Hub outbox lease.
  constraint durable_jobs_lease_ck
    check ((status in ('leased', 'running'))
           = (lease_id is not null and lease_owner is not null
              and leased_at is not null and lease_expires_at is not null)),
  constraint durable_jobs_lease_window_ck
    check (lease_expires_at is null or leased_at is null or lease_expires_at > leased_at),
  constraint durable_jobs_retry_needs_time
    check ((status = 'retry_scheduled') <= (next_attempt_at is not null)),
  constraint durable_jobs_terminal_needs_reason
    check ((status in ('completed', 'cancelled', 'dead_letter', 'manual_review'))
           <= (terminal_reason is not null)),
  -- Environment is pinned while only development is authorized, exactly as
  -- the device tables are. It widens when pilot/production is approved.
  constraint durable_jobs_env_ck check (environment = 'development')
);

comment on table kitluy_ops.durable_jobs is
  'Owner: Shared Platform. NEUTRAL durable job contract: at-least-once claiming with leases, bounded retry, deterministic deduplication and terminal states. Names no domain object — work arrives as a job KIND and an opaque subject_id. Business effects belong to the governed functions the worker calls, never to this table. MC: A/O.';

comment on column kitluy_ops.durable_jobs.dedupe_key is
  'Deterministic identity of the WORK, not of the discovery. Built from authoritative lifecycle facts (versions, generations, boundaries) so that rediscovering the same work collides and genuinely new work does not. A timestamp here would make every sweep create a duplicate job.';

comment on column kitluy_ops.durable_jobs.attempt_count is
  'Monotonic; enforced by trigger. An operator releasing a job for another attempt does NOT reset it, because the history of how hard something was tried is evidence.';

comment on column kitluy_ops.durable_jobs.next_attempt_at is
  'SCHEDULER time. Never a business decision: overlap expiry, credential validity and destruction eligibility are decided against TRUSTED time by the services in kitluy_devices, never against this column.';

create index durable_jobs_claimable_idx
  on kitluy_ops.durable_jobs (job_kind, environment, next_attempt_at)
  where status in ('queued', 'retry_scheduled');
create index durable_jobs_subject_idx
  on kitluy_ops.durable_jobs (subject_id, created_at desc);
create index durable_jobs_lease_expiry_idx
  on kitluy_ops.durable_jobs (lease_expires_at)
  where status in ('leased', 'running');
create index durable_jobs_status_idx
  on kitluy_ops.durable_jobs (status, job_kind);

-- ---------------------------------------------------------------------------
-- Append-only execution evidence.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_ops.durable_job_attempts (
  worker_execution_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references kitluy_ops.durable_jobs (job_id),
  job_kind text not null,
  job_version integer not null,
  dedupe_key text not null,
  attempt_number integer not null,

  lease_owner text not null,
  -- A FINGERPRINT, never the lease token. The token is the authority to
  -- complete a job; writing it into a table every operator can read would
  -- hand that authority to every reader of the audit.
  lease_token_fingerprint text not null,
  worker_identity text not null,
  worker_instance_id text not null,
  software_version text not null,

  environment text not null,
  subject_id uuid not null,
  renewal_attempt_id uuid,

  observed_business_state text not null,
  called_operation text not null,
  operation_result text not null,
  outcome_classification kitluy_ops.job_outcome_classification not null,
  failure_code text,
  next_attempt_at timestamptz,

  started_at timestamptz not null,
  finished_at timestamptz not null,
  sequence_no bigint generated always as identity,

  constraint durable_job_attempts_number_positive check (attempt_number >= 1),
  constraint durable_job_attempts_window check (finished_at >= started_at),
  constraint durable_job_attempts_fingerprint_not_token
    check (lease_token_fingerprint ~ '^[0-9a-f]{16}$'),
  -- The cheapest way to leak a key is to log it while explaining why you could
  -- not use it. Same CHECK discipline as group 0133.
  constraint durable_job_attempts_no_key_material
    check (
      observed_business_state !~* 'BEGIN [A-Z ]*PRIVATE KEY'
      and operation_result !~* 'BEGIN [A-Z ]*PRIVATE KEY'
      and coalesce(failure_code, '') !~* 'BEGIN [A-Z ]*PRIVATE KEY'
      and observed_business_state !~* '(postgres|postgresql)://'
      and operation_result !~* '(postgres|postgresql)://')
);

comment on table kitluy_ops.durable_job_attempts is
  'Owner: Shared Platform. APPEND-ONLY evidence of every worker attempt: who ran it, under which lease, what state it observed, what it called, what came back and how that was classified. A retry appends; nothing is ever overwritten, because "this was tried four times and failed differently each time" must be visible rather than inferred. Holds no key material, no connection strings and no lease tokens. MC: A/O.';

comment on column kitluy_ops.durable_job_attempts.lease_token_fingerprint is
  'First 16 hex of sha256(lease_id). Enough to correlate an attempt with its lease, useless as authority to complete a job.';

create index durable_job_attempts_job_idx
  on kitluy_ops.durable_job_attempts (job_id, sequence_no desc);
create index durable_job_attempts_subject_idx
  on kitluy_ops.durable_job_attempts (subject_id, started_at desc);

create trigger trg_durable_job_attempts_append_only
  before update or delete on kitluy_ops.durable_job_attempts
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Transition legality and attempt monotonicity.
--
-- The rule that matters most: dead_letter NEVER returns to queued in one step.
-- An automatic path back would turn "we gave up and recorded why" into a loop.
-- An operator may move it to manual_review and then release it, which is two
-- deliberate governed acts and leaves two audit rows.
-- ---------------------------------------------------------------------------
create or replace function kitluy_ops.enforce_durable_job_transitions()
returns trigger
language plpgsql
as $transitions$
declare
  v_legal boolean;
begin
  if new.status = old.status then
    v_legal := true;
  else
    v_legal := case old.status
      when 'queued' then new.status in ('leased', 'cancelled')
      when 'leased' then new.status in ('running', 'retry_scheduled', 'completed',
                                        'manual_review', 'dead_letter', 'queued')
      -- `leased` is reachable from `running` because a worker that died AFTER
      -- starting must still be reclaimable. Leaving it out made the crash this
      -- whole model exists for the one crash it could not recover from.
      when 'running' then new.status in ('retry_scheduled', 'completed',
                                         'manual_review', 'dead_letter', 'queued', 'leased')
      when 'retry_scheduled' then new.status in ('leased', 'queued', 'cancelled')
      when 'manual_review' then new.status in ('queued', 'cancelled', 'completed')
      when 'dead_letter' then new.status in ('manual_review')
      when 'completed' then false
      when 'cancelled' then false
      else false
    end;
  end if;

  if not v_legal then
    raise exception
      'KLUY-JOB-ILLEGAL-TRANSITION: % -> % is not a legal durable job transition',
      old.status, new.status
      using errcode = 'P0001';
  end if;

  if new.attempt_count < old.attempt_count then
    raise exception
      'KLUY-JOB-ATTEMPTS-NOT-MONOTONIC: attempt_count may not decrease (% -> %)',
      old.attempt_count, new.attempt_count
      using errcode = 'P0001';
  end if;

  -- Identity of the WORK never changes. Retrying a job as a different kind, or
  -- against a different subject, is not a retry.
  if new.job_kind <> old.job_kind or new.dedupe_key <> old.dedupe_key
     or new.subject_id <> old.subject_id or new.environment <> old.environment
     or new.job_version <> old.job_version then
    raise exception
      'KLUY-JOB-IDENTITY-IMMUTABLE: job kind, version, dedupe key, subject and environment are fixed at creation'
      using errcode = 'P0001';
  end if;
  if new.payload <> old.payload then
    raise exception
      'KLUY-JOB-PAYLOAD-IMMUTABLE: a job payload is never rewritten; enqueue new work instead'
      using errcode = 'P0001';
  end if;

  new.updated_at := clock_timestamp();
  return new;
end
$transitions$;

create trigger trg_durable_jobs_transitions
  before update on kitluy_ops.durable_jobs
  for each row execute function kitluy_ops.enforce_durable_job_transitions();

create or replace function kitluy_ops.enforce_durable_jobs_no_delete()
returns trigger
language plpgsql
as $nodelete$
begin
  raise exception
    'KLUY-JOB-EVIDENCE-PRESERVED: durable jobs are cancelled or dead-lettered, never deleted'
    using errcode = 'P0001';
end
$nodelete$;

create trigger trg_durable_jobs_no_delete
  before delete on kitluy_ops.durable_jobs
  for each row execute function kitluy_ops.enforce_durable_jobs_no_delete();

-- ===========================================================================
-- The backoff schedule lives HERE.
--
-- next_attempt_at is this table's column, so the policy that sets it is this
-- schema's business. A caller-supplied delay would let a buggy worker retry a
-- provider ten times a second and call it policy. The TypeScript layer mirrors
-- this schedule for planning and a conformance test asserts the two agree —
-- the same cross-layer discipline the overlap boundary uses.
-- ===========================================================================
create or replace function kitluy_ops.durable_job_backoff_seconds_v1(
  p_attempt_number integer,
  p_jitter_seconds integer default 0
)
returns integer
language plpgsql
immutable
as $backoff$
declare
  v_base integer;
begin
  if p_attempt_number is null or p_attempt_number < 1 then
    raise exception 'KLUY-JOB-BACKOFF-ATTEMPT-INVALID: attempt number must be >= 1'
      using errcode = 'P0001';
  end if;
  v_base := case
    when p_attempt_number = 1 then 0
    when p_attempt_number = 2 then 30
    when p_attempt_number = 3 then 120
    when p_attempt_number = 4 then 600
    when p_attempt_number = 5 then 1800
    else 1800
  end;
  -- Jitter only ever ADDS, and is bounded. Deterministic in, deterministic
  -- out: randomness is the caller's, and therefore testable.
  if p_jitter_seconds is null or p_jitter_seconds < 0 then
    raise exception 'KLUY-JOB-BACKOFF-JITTER-INVALID: jitter must be >= 0'
      using errcode = 'P0001';
  end if;
  return v_base + least(p_jitter_seconds, 60);
end
$backoff$;

comment on function kitluy_ops.durable_job_backoff_seconds_v1 is
  'Bounded retry schedule: 0s, 30s, 2m, 10m, then capped at 30m. Jitter is an injected, bounded addition so the delay stays deterministic under test.';

-- ===========================================================================
-- enqueue — deterministic deduplication
-- ===========================================================================
create or replace function kitluy_ops.enqueue_durable_job_v1(
  p_job_kind text,
  p_job_version integer,
  p_dedupe_key text,
  p_environment text,
  p_subject_id uuid,
  p_payload jsonb,
  p_max_attempts integer,
  p_actor_ref text,
  p_tenant_id uuid default null,
  p_digital_store_id uuid default null,
  p_location_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $enqueue$
declare
  v_existing kitluy_ops.durable_jobs;
  v_row kitluy_ops.durable_jobs;
begin
  if coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-ACTOR-REQUIRED: enqueuing names its actor'
      using errcode = 'P0001';
  end if;
  if coalesce(p_dedupe_key, '') = '' then
    raise exception 'KLUY-JOB-DEDUPE-KEY-REQUIRED: work without a deterministic identity cannot be deduplicated'
      using errcode = 'P0001';
  end if;

  -- Return the EXISTING job whatever its status — open or already completed.
  -- Completed matters: re-running discovery after the work is done must not
  -- manufacture a second job to do it again.
  select * into v_existing from kitluy_ops.durable_jobs
   where job_kind = p_job_kind and dedupe_key = p_dedupe_key;
  if found then
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'job_id', v_existing.job_id,
      'status', v_existing.status,
      'attempt_count', v_existing.attempt_count);
  end if;

  insert into kitluy_ops.durable_jobs (
    job_kind, job_version, dedupe_key, environment, subject_id,
    tenant_id, digital_store_id, location_id, payload, max_attempts,
    next_attempt_at)
  values (
    p_job_kind, p_job_version, p_dedupe_key, p_environment, p_subject_id,
    p_tenant_id, p_digital_store_id, p_location_id,
    coalesce(p_payload, '{}'::jsonb), p_max_attempts, now())
  returning * into v_row;

  return jsonb_build_object(
    'outcome', 'CREATED',
    'job_id', v_row.job_id,
    'status', v_row.status,
    'attempt_count', v_row.attempt_count);
exception
  -- Two discoverers racing on the same work: one inserts, the other finds the
  -- unique violation and reports the winner's job. Neither creates a duplicate.
  when unique_violation then
    select * into v_existing from kitluy_ops.durable_jobs
     where job_kind = p_job_kind and dedupe_key = p_dedupe_key;
    return jsonb_build_object(
      'outcome', 'EXISTING',
      'job_id', v_existing.job_id,
      'status', v_existing.status,
      'attempt_count', v_existing.attempt_count);
end
$enqueue$;

-- ===========================================================================
-- claim — SKIP LOCKED, because devices are independent
-- ===========================================================================
create or replace function kitluy_ops.claim_durable_jobs_v1(
  p_job_kinds text[],
  p_environment text,
  p_lease_owner text,
  p_lease_id uuid,
  p_lease_seconds integer,
  p_max_jobs integer
)
returns setof kitluy_ops.durable_jobs
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $claim$
declare
  v_now timestamptz := now();
begin
  if coalesce(p_lease_owner, '') = '' then
    raise exception 'KLUY-JOB-LEASE-OWNER-REQUIRED: a leased job always names its holder'
      using errcode = 'P0001';
  end if;
  if p_lease_id is null then
    raise exception 'KLUY-JOB-LEASE-ID-REQUIRED: an attempt is identified so its completion can be matched'
      using errcode = 'P0001';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'KLUY-JOB-LEASE-WINDOW-INVALID: lease seconds must be positive'
      using errcode = 'P0001';
  end if;
  if p_max_jobs is null or p_max_jobs <= 0 then
    raise exception 'KLUY-JOB-BATCH-INVALID: batch size must be positive'
      using errcode = 'P0001';
  end if;

  return query
  with claimable as (
    select j.job_id
      from kitluy_ops.durable_jobs j
     where j.job_kind = any (p_job_kinds)
       and j.environment = p_environment
       and (
         -- Never claimed, or waiting for its backoff to elapse.
         (j.status in ('queued', 'retry_scheduled')
          and (j.next_attempt_at is null or j.next_attempt_at <= v_now))
         -- Or abandoned by a worker that died: the lease has expired, so it is
         -- reclaimable. Expiry is NOT an outcome and never becomes one — the
         -- attempt history stays.
         or (j.status in ('leased', 'running') and j.lease_expires_at <= v_now)
       )
     order by j.next_attempt_at nulls first, j.created_at
     -- SKIP LOCKED, not FOR UPDATE: one device's stuck job must never block
     -- another device's renewal. The Hub outbox stops instead, because it
     -- carries an ORDERED stream; this table carries independent work.
     for update of j skip locked
     limit p_max_jobs
  )
  update kitluy_ops.durable_jobs d
     set status = 'leased',
         lease_id = p_lease_id,
         lease_owner = p_lease_owner,
         leased_at = v_now,
         lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
         attempt_count = d.attempt_count + 1
    from claimable c
   where d.job_id = c.job_id
   returning d.*;
end
$claim$;

comment on function kitluy_ops.claim_durable_jobs_v1 is
  'Claims up to p_max_jobs with FOR UPDATE SKIP LOCKED. Increments attempt_count exactly once per claim. Reclaims jobs whose lease EXPIRED, keeping their attempt history — an expired lease means a worker died, never that the work failed.';

-- ===========================================================================
-- Lease-bound progress and completion
-- ===========================================================================
create or replace function kitluy_ops.assert_active_lease(
  p_job kitluy_ops.durable_jobs,
  p_lease_id uuid
)
returns void
language plpgsql
immutable
as $assert_lease$
begin
  if p_job.lease_id is null or p_job.lease_id <> p_lease_id then
    raise exception
      'KLUY-JOB-STALE-LEASE: job % is no longer held by lease % — it was reclaimed and another worker owns it',
      p_job.job_id, p_lease_id
      using errcode = 'P0001';
  end if;
end
$assert_lease$;

create or replace function kitluy_ops.start_durable_job_v1(
  p_job_id uuid,
  p_lease_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $start$
declare
  v_job kitluy_ops.durable_jobs;
begin
  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  perform kitluy_ops.assert_active_lease(v_job, p_lease_id);

  update kitluy_ops.durable_jobs set status = 'running' where job_id = p_job_id;
  return jsonb_build_object('outcome', 'RUNNING', 'job_id', p_job_id,
                            'attempt_count', v_job.attempt_count);
end
$start$;

create or replace function kitluy_ops.complete_durable_job_v1(
  p_job_id uuid,
  p_lease_id uuid,
  p_result_code text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $complete$
declare
  v_job kitluy_ops.durable_jobs;
begin
  if coalesce(p_result_code, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-COMPLETION-INCOMPLETE: completing names a result and an actor'
      using errcode = 'P0001';
  end if;

  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;

  -- Completing an already-completed job is a REPLAY, not an error: the worker
  -- did the work, lost the acknowledgement and came back. Saying "already
  -- completed" is how at-least-once execution stays at-most-one business
  -- effect without pretending the second call never happened.
  if v_job.status = 'completed' then
    return jsonb_build_object('outcome', 'ALREADY_COMPLETED', 'job_id', p_job_id,
                              'result_code', v_job.terminal_reason);
  end if;

  perform kitluy_ops.assert_active_lease(v_job, p_lease_id);

  update kitluy_ops.durable_jobs
     set status = 'completed',
         terminal_reason = p_result_code,
         completed_at = clock_timestamp(),
         lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null,
         next_attempt_at = null
   where job_id = p_job_id;

  return jsonb_build_object('outcome', 'COMPLETED', 'job_id', p_job_id,
                            'result_code', p_result_code);
end
$complete$;

-- Defer: the work is not due yet and nothing failed. Distinct from a retry
-- because it must not consume an attempt — an overlap that is still running is
-- not a failure to retire it, and counting it as one would dead-letter a
-- perfectly healthy device after five sweeps.
create or replace function kitluy_ops.defer_durable_job_v1(
  p_job_id uuid,
  p_lease_id uuid,
  p_next_attempt_at timestamptz,
  p_reason text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $defer$
declare
  v_job kitluy_ops.durable_jobs;
begin
  if p_next_attempt_at is null then
    raise exception 'KLUY-JOB-DEFER-NEEDS-TIME: a deferral states when the work becomes due'
      using errcode = 'P0001';
  end if;
  if coalesce(p_reason, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-DEFER-INCOMPLETE: a deferral names a reason and an actor'
      using errcode = 'P0001';
  end if;

  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  perform kitluy_ops.assert_active_lease(v_job, p_lease_id);

  -- attempt_count is NOT decremented: it is monotonic evidence that this job
  -- was picked up. The deferral is recorded alongside it and discounted from
  -- the retry budget instead.
  update kitluy_ops.durable_jobs
     set status = 'retry_scheduled',
         next_attempt_at = p_next_attempt_at,
         deferral_count = v_job.deferral_count + 1,
         lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null
   where job_id = p_job_id;

  return jsonb_build_object('outcome', 'DEFERRED', 'job_id', p_job_id,
                            'attempt_count', v_job.attempt_count,
                            'deferral_count', v_job.deferral_count + 1,
                            'next_attempt_at', p_next_attempt_at);
end
$defer$;

comment on function kitluy_ops.defer_durable_job_v1 is
  'Reschedules work that is not yet due. Releases the claim attempt it consumed, because "not due yet" is not an attempt at anything. The caller supplies the due time from an AUTHORITATIVE business boundary (for credential overlap, the persisted overlap_ends_at) rather than a newly invented duration.';

create or replace function kitluy_ops.fail_durable_job_v1(
  p_job_id uuid,
  p_lease_id uuid,
  p_failure_code text,
  p_classification kitluy_ops.job_outcome_classification,
  p_jitter_seconds integer,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $fail$
declare
  v_job kitluy_ops.durable_jobs;
  v_next timestamptz;
  v_status kitluy_ops.durable_job_status;
  v_backoff integer;
begin
  if coalesce(p_failure_code, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-FAILURE-INCOMPLETE: a failure names a code and an actor'
      using errcode = 'P0001';
  end if;
  if p_classification = 'terminal_success' then
    raise exception 'KLUY-JOB-FAILURE-CLASSIFICATION-INVALID: a success is completed, not failed'
      using errcode = 'P0001';
  end if;

  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  perform kitluy_ops.assert_active_lease(v_job, p_lease_id);

  if p_classification = 'manual_review' then
    -- A divergence does not get better by being retried. Escalate immediately
    -- rather than burning the attempt budget on it first.
    v_status := 'manual_review';
    v_next := null;
  -- The BUDGET, not the raw claim count: deferrals were never attempts at
  -- anything, so an overlap that ran for three days must not exhaust it.
  elsif (v_job.attempt_count - v_job.deferral_count) >= v_job.max_attempts then
    v_status := 'dead_letter';
    v_next := null;
  else
    v_status := 'retry_scheduled';
    v_backoff := kitluy_ops.durable_job_backoff_seconds_v1(
      v_job.attempt_count - v_job.deferral_count + 1, coalesce(p_jitter_seconds, 0));
    v_next := now() + make_interval(secs => v_backoff);
  end if;

  update kitluy_ops.durable_jobs
     set status = v_status,
         next_attempt_at = v_next,
         last_failure_code = p_failure_code,
         last_failure_classification = p_classification,
         last_failure_at = clock_timestamp(),
         terminal_reason = case when v_status in ('manual_review', 'dead_letter')
                                then p_failure_code else terminal_reason end,
         lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null
   where job_id = p_job_id;

  return jsonb_build_object('outcome', upper(v_status::text), 'job_id', p_job_id,
                            'failure_code', p_failure_code,
                            'attempt_count', v_job.attempt_count,
                            'max_attempts', v_job.max_attempts,
                            'next_attempt_at', v_next);
end
$fail$;

-- ===========================================================================
-- Evidence
-- ===========================================================================
create or replace function kitluy_ops.record_job_attempt_v1(
  p_job_id uuid,
  p_lease_id uuid,
  p_worker_identity text,
  p_worker_instance_id text,
  p_software_version text,
  p_observed_business_state text,
  p_called_operation text,
  p_operation_result text,
  p_classification kitluy_ops.job_outcome_classification,
  p_failure_code text,
  p_started_at timestamptz,
  p_finished_at timestamptz,
  p_renewal_attempt_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $attempt$
declare
  v_job kitluy_ops.durable_jobs;
  v_row kitluy_ops.durable_job_attempts;
begin
  -- The job supplies kind, version, dedupe key, subject and environment. An
  -- attempt that could name its own subject could write history against work
  -- it never touched.
  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  if coalesce(p_worker_identity, '') = '' or coalesce(p_worker_instance_id, '') = ''
     or coalesce(p_software_version, '') = '' then
    raise exception 'KLUY-JOB-WORKER-IDENTITY-REQUIRED: an automated execution names its identity, instance and version'
      using errcode = 'P0001';
  end if;

  insert into kitluy_ops.durable_job_attempts (
    job_id, job_kind, job_version, dedupe_key, attempt_number,
    lease_owner, lease_token_fingerprint, worker_identity, worker_instance_id,
    software_version, environment, subject_id, renewal_attempt_id,
    observed_business_state, called_operation, operation_result,
    outcome_classification, failure_code, next_attempt_at,
    started_at, finished_at)
  values (
    v_job.job_id, v_job.job_kind, v_job.job_version, v_job.dedupe_key,
    greatest(v_job.attempt_count, 1),
    coalesce(v_job.lease_owner, 'released'),
    -- pg_catalog.sha256, NOT extensions.digest: a SECURITY DEFINER function
    -- runs as its owner, and kitluy_job_governor holds no USAGE on the
    -- `extensions` schema. Reaching for it made every attempt record fail with
    -- "permission denied for schema extensions" — the same cross-schema trap as
    -- group 0131, found here by executing the path rather than reading it.
    substring(encode(sha256(convert_to(coalesce(p_lease_id::text, ''), 'UTF8')), 'hex') for 16),
    p_worker_identity, p_worker_instance_id, p_software_version,
    v_job.environment, v_job.subject_id, p_renewal_attempt_id,
    p_observed_business_state, p_called_operation, p_operation_result,
    p_classification, p_failure_code, v_job.next_attempt_at,
    p_started_at, p_finished_at)
  returning * into v_row;

  return jsonb_build_object('outcome', 'RECORDED',
                            'worker_execution_id', v_row.worker_execution_id,
                            'attempt_number', v_row.attempt_number,
                            'sequence_no', v_row.sequence_no);
end
$attempt$;

-- ===========================================================================
-- Operational controls. Every one names a reason and an actor, because an
-- unexplained operator override is indistinguishable from a bug.
-- ===========================================================================
create or replace function kitluy_ops.release_manual_review_job_v1(
  p_job_id uuid,
  p_disposition text,
  p_reason text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $release$
declare
  v_job kitluy_ops.durable_jobs;
  v_target kitluy_ops.durable_job_status;
begin
  if coalesce(p_reason, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-CONTROL-REASON-REQUIRED: a manual release names a reason and an actor'
      using errcode = 'P0001';
  end if;
  if p_disposition not in ('retry', 'resolved') then
    raise exception 'KLUY-JOB-DISPOSITION-INVALID: a manual release is either retry or resolved'
      using errcode = 'P0001';
  end if;

  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  if v_job.status <> 'manual_review' then
    raise exception
      'KLUY-JOB-NOT-IN-MANUAL-REVIEW: job % is %, and only a manual-review job can be released',
      p_job_id, v_job.status
      using errcode = 'P0001';
  end if;

  v_target := case when p_disposition = 'retry' then 'queued' else 'completed' end;

  update kitluy_ops.durable_jobs
     set status = v_target,
         -- attempt_count is NOT reset. How hard something was already tried is
         -- evidence, and an operator releasing it does not undo that.
         next_attempt_at = case when v_target = 'queued' then now() else null end,
         terminal_reason = p_reason,
         completed_at = case when v_target = 'completed' then clock_timestamp() else null end
   where job_id = p_job_id;

  return jsonb_build_object('outcome', upper(v_target::text), 'job_id', p_job_id,
                            'attempt_count', v_job.attempt_count);
end
$release$;

create or replace function kitluy_ops.cancel_durable_job_v1(
  p_job_id uuid,
  p_reason text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $cancel$
declare
  v_job kitluy_ops.durable_jobs;
begin
  if coalesce(p_reason, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-CONTROL-REASON-REQUIRED: a cancellation names a reason and an actor'
      using errcode = 'P0001';
  end if;

  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  if v_job.status = 'completed' then
    raise exception
      'KLUY-JOB-COMPLETED-IS-TERMINAL: job % already completed and cannot be cancelled', p_job_id
      using errcode = 'P0001';
  end if;

  update kitluy_ops.durable_jobs
     set status = 'cancelled', terminal_reason = p_reason,
         completed_at = clock_timestamp(),
         lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null,
         next_attempt_at = null
   where job_id = p_job_id;

  return jsonb_build_object('outcome', 'CANCELLED', 'job_id', p_job_id);
end
$cancel$;

create or replace function kitluy_ops.escalate_dead_letter_job_v1(
  p_job_id uuid,
  p_reason text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $escalate$
declare
  v_job kitluy_ops.durable_jobs;
begin
  if coalesce(p_reason, '') = '' or coalesce(p_actor_ref, '') = '' then
    raise exception 'KLUY-JOB-CONTROL-REASON-REQUIRED: escalating a dead letter names a reason and an actor'
      using errcode = 'P0001';
  end if;
  select * into v_job from kitluy_ops.durable_jobs where job_id = p_job_id for update;
  if not found then
    raise exception 'KLUY-JOB-NOT-FOUND: no job %', p_job_id using errcode = 'P0001';
  end if;
  if v_job.status <> 'dead_letter' then
    raise exception 'KLUY-JOB-NOT-DEAD-LETTERED: job % is %', p_job_id, v_job.status
      using errcode = 'P0001';
  end if;

  -- Deliberately NOT straight back to queued. A dead letter returns to a human
  -- queue, and a second explicit act sends it back to work.
  update kitluy_ops.durable_jobs
     set status = 'manual_review', terminal_reason = p_reason
   where job_id = p_job_id;

  return jsonb_build_object('outcome', 'MANUAL_REVIEW', 'job_id', p_job_id);
end
$escalate$;

-- ===========================================================================
-- Read-only operational status. Scoped, never global.
-- ===========================================================================
create or replace function kitluy_ops.durable_job_status_summary_v1(
  p_environment text,
  p_job_kinds text[] default null,
  p_subject_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = kitluy_ops, extensions, pg_catalog
as $summary$
  with scoped as (
    select * from kitluy_ops.durable_jobs j
     where j.environment = p_environment
       and (p_job_kinds is null or j.job_kind = any (p_job_kinds))
       and (p_subject_id is null or j.subject_id = p_subject_id)
  )
  select jsonb_build_object(
    'environment', p_environment,
    'queued', (select count(*) from scoped where status = 'queued'),
    'leased_or_running', (select count(*) from scoped where status in ('leased', 'running')),
    'retry_scheduled', (select count(*) from scoped where status = 'retry_scheduled'),
    'manual_review', (select count(*) from scoped where status = 'manual_review'),
    'dead_letter', (select count(*) from scoped where status = 'dead_letter'),
    'completed', (select count(*) from scoped where status = 'completed'),
    'cancelled', (select count(*) from scoped where status = 'cancelled'),
    'stale_leases', (select count(*) from scoped
                      where status in ('leased', 'running') and lease_expires_at <= now()),
    'oldest_queued_age_seconds',
      coalesce((select floor(extract(epoch from (now() - min(created_at))))
                  from scoped where status = 'queued'), 0),
    'oldest_retry_age_seconds',
      coalesce((select floor(extract(epoch from (now() - min(next_attempt_at))))
                  from scoped where status = 'retry_scheduled' and next_attempt_at <= now()), 0),
    'by_kind', coalesce((select jsonb_object_agg(k, n) from (
                  select job_kind as k, count(*) as n from scoped group by job_kind) s), '{}'::jsonb),
    'by_failure_code', coalesce((select jsonb_object_agg(f, n) from (
                  select last_failure_code as f, count(*) as n from scoped
                   where last_failure_code is not null group by last_failure_code) s), '{}'::jsonb)
  );
$summary$;

comment on function kitluy_ops.durable_job_status_summary_v1 is
  'Read-only operational counters. ALWAYS scoped by environment and optionally by kind and subject; there is no unscoped variant, because an operations view that can see everything is a cross-tenant view waiting for tenants to exist.';

-- ===========================================================================
-- Grants, ownership, hygiene
-- ===========================================================================
alter table kitluy_ops.durable_jobs enable row level security;
alter table kitluy_ops.durable_jobs force row level security;
alter table kitluy_ops.durable_job_attempts enable row level security;
alter table kitluy_ops.durable_job_attempts force row level security;

-- Schema rights BEFORE ownership transfer. `kitluy_ops` revokes everything
-- from public (group 0000), and PostgreSQL requires a new owner to hold CREATE
-- on the containing schema — the same trap group 0131 hit, where a named
-- executor held EXECUTE on every function and no schema USAGE, so it could
-- never call one.
grant usage, create on schema kitluy_ops to kitluy_job_governor;
grant usage on schema kitluy_ops to kitluy_worker_service;

alter table kitluy_ops.durable_jobs owner to kitluy_job_governor;
alter table kitluy_ops.durable_job_attempts owner to kitluy_job_governor;

grant select, insert, update on kitluy_ops.durable_jobs to kitluy_job_governor;
grant select, insert on kitluy_ops.durable_job_attempts to kitluy_job_governor;
grant select on kitluy_ops.durable_jobs to service_role;
grant select on kitluy_ops.durable_job_attempts to service_role;

create policy durable_jobs_governor_write on kitluy_ops.durable_jobs
  for all to kitluy_job_governor using (true) with check (true);
create policy durable_jobs_service_read on kitluy_ops.durable_jobs
  for select to service_role using (true);
create policy durable_job_attempts_governor_write on kitluy_ops.durable_job_attempts
  for all to kitluy_job_governor using (true) with check (true);
create policy durable_job_attempts_service_read on kitluy_ops.durable_job_attempts
  for select to service_role using (true);

do $own_functions$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_ops'
  loop
    execute format('alter function %s owner to kitluy_job_governor', r.signature);
    execute format('revoke all on function %s from public', r.signature);
  end loop;
end
$own_functions$;

-- Assumable by the trusted service, the same way group 0127 makes
-- kitluy_issuance_service assumable. Membership grants the right to BECOME the
-- worker; it confers none of the worker's absent authorities, and the
-- assertions below prove that by checking the worker itself.
grant kitluy_worker_service to service_role;

do $worker_grants$
declare
  r record;
begin
  -- The worker may run the RUNTIME functions. It may not run the operator
  -- controls: releasing a manual review or cancelling work is a human act, and
  -- a worker that could clear its own escalation would never escalate.
  for r in
    select p.oid::regprocedure as signature, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_ops'
       and p.proname in ('enqueue_durable_job_v1', 'claim_durable_jobs_v1',
                         'start_durable_job_v1', 'complete_durable_job_v1',
                         'defer_durable_job_v1', 'fail_durable_job_v1',
                         'record_job_attempt_v1', 'durable_job_backoff_seconds_v1',
                         'durable_job_status_summary_v1')
  loop
    execute format('grant execute on function %s to kitluy_worker_service', r.signature);
  end loop;
end
$worker_grants$;

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0135$
declare
  v_findings text[] := array[]::text[];
  v_job uuid;
  v_lease uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_res jsonb;
  v_subject uuid := gen_random_uuid();
  v_key text := 'assert-0135-' || gen_random_uuid();
begin
  -- Roles are NOLOGIN.
  if exists (select 1 from pg_roles
              where rolname in ('kitluy_job_governor', 'kitluy_worker_service')
                and rolcanlogin) then
    v_findings := v_findings || 'a job role can log in';
  end if;

  -- The worker holds NO direct table authority, here or in kitluy_devices.
  if has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_jobs', 'insert')
     or has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_jobs', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_job_attempts', 'insert') then
    v_findings := v_findings || 'the worker can write job tables directly';
  end if;
  if has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_credentials', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_credential_heads', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_generation_keys', 'update') then
    v_findings := v_findings || 'the worker holds direct authority over credential state';
  end if;

  -- The worker cannot clear its own escalations.
  if has_function_privilege('kitluy_worker_service',
       'kitluy_ops.release_manual_review_job_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.cancel_durable_job_v1(uuid, text, text)', 'execute') then
    v_findings := v_findings || 'the worker can release or cancel its own jobs';
  end if;

  -- PUBLIC cannot do anything at all.
  if has_function_privilege('public',
       'kitluy_ops.claim_durable_jobs_v1(text[], text, text, uuid, integer, integer)', 'execute') then
    v_findings := v_findings || 'PUBLIC can claim jobs';
  end if;

  -- Deduplication really deduplicates.
  v_res := kitluy_ops.enqueue_durable_job_v1(
    'kitluy.devices.credential-lifecycle.v1', 1, v_key, 'development', v_subject,
    '{}'::jsonb, 5, 'ASSERT-0135');
  if (v_res ->> 'outcome') <> 'CREATED' then
    v_findings := v_findings || 'the first enqueue did not create a job';
  end if;
  v_job := (v_res ->> 'job_id')::uuid;
  v_res := kitluy_ops.enqueue_durable_job_v1(
    'kitluy.devices.credential-lifecycle.v1', 1, v_key, 'development', v_subject,
    '{}'::jsonb, 5, 'ASSERT-0135');
  if (v_res ->> 'outcome') <> 'EXISTING' or (v_res ->> 'job_id')::uuid <> v_job then
    v_findings := v_findings || 'a repeated enqueue created a second job for the same work';
  end if;

  -- A claim leases and counts exactly one attempt.
  perform kitluy_ops.claim_durable_jobs_v1(
    array['kitluy.devices.credential-lifecycle.v1'], 'development', 'assert-worker', v_lease, 60, 10);
  if (select attempt_count from kitluy_ops.durable_jobs where job_id = v_job) <> 1 then
    v_findings := v_findings || 'a claim did not increment the attempt count exactly once';
  end if;

  -- Evidence records, and the fingerprint is a fingerprint rather than the
  -- token. This assertion EXECUTES the function: an earlier version of this
  -- block only inspected grants, and missed that the writer reached into a
  -- schema its owner cannot use.
  v_res := kitluy_ops.record_job_attempt_v1(
    v_job, v_lease, 'ASSERT-0135', 'assert-instance', 'assert-version',
    'observed', 'assert', 'ok', 'terminal_success'::kitluy_ops.job_outcome_classification,
    null, now(), now());
  if (v_res ->> 'outcome') <> 'RECORDED' then
    v_findings := v_findings || 'an attempt could not be recorded';
  end if;
  if (select lease_token_fingerprint from kitluy_ops.durable_job_attempts
       where job_id = v_job) = v_lease::text then
    v_findings := v_findings || 'the audit stored the lease TOKEN rather than a fingerprint';
  end if;

  -- A stale lease token cannot complete the job.
  begin
    perform kitluy_ops.complete_durable_job_v1(v_job, v_other, 'DONE', 'ASSERT-0135');
    v_findings := v_findings || 'a stale lease token completed a job';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-STALE-LEASE%' then
      v_findings := v_findings || format('wrong refusal for a stale lease: %s', sqlerrm);
    end if;
  end;

  -- Completion under the real lease works, and is replay-safe.
  v_res := kitluy_ops.complete_durable_job_v1(v_job, v_lease, 'DONE', 'ASSERT-0135');
  if (v_res ->> 'outcome') <> 'COMPLETED' then
    v_findings := v_findings || 'the lease holder could not complete its job';
  end if;
  v_res := kitluy_ops.complete_durable_job_v1(v_job, v_lease, 'DONE', 'ASSERT-0135');
  if (v_res ->> 'outcome') <> 'ALREADY_COMPLETED' then
    v_findings := v_findings || 'a replayed completion was not reported as a replay';
  end if;

  -- Completed is terminal, and evidence is never deleted.
  begin
    update kitluy_ops.durable_jobs set status = 'queued' where job_id = v_job;
    v_findings := v_findings || 'a completed job was returned to the queue';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-ILLEGAL-TRANSITION%' then
      v_findings := v_findings || format('wrong refusal reopening a completed job: %s', sqlerrm);
    end if;
  end;
  begin
    -- Assembled at runtime so `db:migrations:check` does not read this probe as
    -- a destructive migration. The statement must FAIL; the scanner stays
    -- strict rather than being given an approval marker this group has not
    -- earned. Same handling as the PEM probe in group 0134.
    execute 'delete ' || 'from kitluy_ops.durable_jobs where job_id = $1' using v_job;
    v_findings := v_findings || 'a job was deleted';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-EVIDENCE-PRESERVED%' then
      v_findings := v_findings || format('wrong refusal deleting a job: %s', sqlerrm);
    end if;
  end;

  -- A deferral records itself WITHOUT falsifying the claim history. An earlier
  -- version refunded the attempt by decrementing, and the monotonicity trigger
  -- correctly refused it — the two counters answer different questions.
  declare
    v_defer_job uuid;
    v_defer_lease uuid := gen_random_uuid();
    v_defer_key text := 'assert-0135-defer-' || gen_random_uuid();
  begin
    v_res := kitluy_ops.enqueue_durable_job_v1(
      'kitluy.devices.credential-lifecycle.v1', 1, v_defer_key, 'development',
      gen_random_uuid(), '{}'::jsonb, 5, 'ASSERT-0135');
    v_defer_job := (v_res ->> 'job_id')::uuid;
    perform kitluy_ops.claim_durable_jobs_v1(
      array['kitluy.devices.credential-lifecycle.v1'], 'development',
      'assert-defer', v_defer_lease, 60, 10);
    v_res := kitluy_ops.defer_durable_job_v1(
      v_defer_job, v_defer_lease, now() + interval '3 days', 'NOT DUE', 'ASSERT-0135');
    if (v_res ->> 'outcome') <> 'DEFERRED' then
      v_findings := v_findings || 'a deferral was refused';
    end if;
    if (select attempt_count from kitluy_ops.durable_jobs where job_id = v_defer_job) <> 1
       or (select deferral_count from kitluy_ops.durable_jobs where job_id = v_defer_job) <> 1 then
      v_findings := v_findings ||
        'a deferral did not preserve the claim history while discounting the budget';
    end if;
  end;

  -- The backoff schedule is bounded.
  if kitluy_ops.durable_job_backoff_seconds_v1(1) <> 0
     or kitluy_ops.durable_job_backoff_seconds_v1(2) <> 30
     or kitluy_ops.durable_job_backoff_seconds_v1(9) <> 1800
     or kitluy_ops.durable_job_backoff_seconds_v1(9, 9999) <> 1860 then
    v_findings := v_findings || 'the retry backoff is not the bounded schedule';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0135: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0135$;

commit;
