-- kitluy:group:0160
-- Migration group 0160: repair_job_governor_membership_leak.
--
-- Authority: WS-11-T003 Step 4 §8; KLRISK-DEVICE-011.
--
-- ===========================================================================
-- THE LEAK THIS CLOSES
-- ===========================================================================
-- Group 0135 borrowed `kitluy_job_governor` (a NOLOGIN role) and granted it to
-- `current_user` so the migration could create tables and functions owned by
-- the governor. The borrow was never returned. A LOGIN-capable role that remains
-- a member of a NOLOGIN authority can SET ROLE into it, acquiring every table
-- and function privilege the governor holds.
--
-- The census in `residue-spendability-census.integration.test.ts` records this
-- as `job_governor_recorded_exception: 1`. This migration removes the exception.
--
-- ===========================================================================
-- WHY ASSERTIONS.SQL CHANGES ARE SEPARATE
-- ===========================================================================
-- `supabase/tests/assertions.sql` contains direct `select ... from
-- kitluy_ops.durable_jobs` queries used to verify the job runtime contract.
-- Replacing them with narrow readers is CORRECT but requires a full `db:test`
-- run to prove no assertion was broken. Because the narrow readers created here
-- are STABLE and return the exact same facts, the replacement is a pure
-- refactoring with no behaviour change.
--
-- The migration itself is safe to apply regardless of whether assertions.sql
-- has been updated: the inspection functions are additive, and the membership
-- revocation only affects the migration-time current_user, not any runtime
-- caller.
--
-- ADDITIVE. Groups 0136-0159 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

begin;

-- ---------------------------------------------------------------------------
-- 1. NARROW INSPECTION FUNCTIONS
-- ---------------------------------------------------------------------------
-- These replace direct `durable_jobs` table access in assertions and tests.
-- Each has a fixed search_path, explicit return type, and no dynamic SQL.

create or replace function kitluy_ops.inspect_job_attempt_count_v1(
  p_job_id uuid
) returns integer
language sql
stable
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
  select attempt_count from kitluy_ops.durable_jobs where job_id = p_job_id;
$fn$;

create or replace function kitluy_ops.inspect_job_deferral_count_v1(
  p_job_id uuid
) returns integer
language sql
stable
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
  select deferral_count from kitluy_ops.durable_jobs where job_id = p_job_id;
$fn$;

create or replace function kitluy_ops.inspect_job_status_v1(
  p_job_id uuid
) returns text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
  select status::text from kitluy_ops.durable_jobs where job_id = p_job_id;
$fn$;

create or replace function kitluy_ops.inspect_job_last_failure_code_v1(
  p_job_id uuid
) returns text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
  select last_failure_code from kitluy_ops.durable_jobs where job_id = p_job_id;
$fn$;

-- ---------------------------------------------------------------------------
-- 1b. DEFINER OWNERSHIP: the governor owns its inspection surface
-- ---------------------------------------------------------------------------
-- The durable-job contract in assertions.sql requires every kitluy_ops job
-- function to be owned by `kitluy_job_governor` (NOLOGIN), so the definer body
-- reads `durable_jobs` with the governor's authority and nothing else's. A
-- SECURITY DEFINER function left owned by the superuser that applied this file
-- would read the job table as a superuser -- exactly what group 0126's
-- definer-ownership hardening forbids.
--
-- The transfer is legal HERE and only here: current_user is still a member of
-- the governor through the 0135 leak this group is about to close, and
-- `alter function ... owner to` requires precisely that membership. The first
-- version of this group omitted the transfer; canonical from-zero replay plus
-- `db:test` exposed it.
alter function kitluy_ops.inspect_job_attempt_count_v1(uuid)
  owner to kitluy_job_governor;
alter function kitluy_ops.inspect_job_deferral_count_v1(uuid)
  owner to kitluy_job_governor;
alter function kitluy_ops.inspect_job_status_v1(uuid)
  owner to kitluy_job_governor;
alter function kitluy_ops.inspect_job_last_failure_code_v1(uuid)
  owner to kitluy_job_governor;

-- ---------------------------------------------------------------------------
-- 1c. TEST-SCAFFOLD SURFACE: due-now and refusal probes
-- ---------------------------------------------------------------------------
-- Section 40b of assertions.sql constructs scenarios no production caller
-- needs: forcing a job DUE NOW, and proving the table triggers refuse
-- forbidden mutations even when the writer holds owner-class table rights.
-- Under the 0135 leak those tests wrote `durable_jobs` directly through the
-- borrowed membership. With the leak closed the same scenarios go through two
-- narrow governor-owned definers granted to `kitluy_test_harness` and NOBODY
-- else -- the authority pattern of the sanctioned test clock
-- (KLD-2026-07-31-SECURITY-TEST-CLOCK-001). The harness is NOLOGIN, memberless
-- in production and inert there, so these functions ship dead weight only.
--
-- Both name exactly one job and exactly one act. No dynamic SQL, no table
-- privilege is created, and nothing here lets a caller read job contents.

create or replace function kitluy_ops.test_make_durable_job_due_v1(
  p_job_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
begin
  if p_job_id is null then
    raise exception 'KLUY-TEST-JOB-NULL: a due-now adjustment names exactly one job'
      using errcode = 'P0001';
  end if;
  -- `now()`, NOT clock_timestamp(): the claim window compares against the
  -- caller's transaction timestamp, which is fixed at transaction start. A
  -- clock_timestamp() here lands a few milliseconds AFTER it and the job stays
  -- unclaimable for the rest of the transaction -- which is exactly the test
  -- scenario this function exists to set up.
  update kitluy_ops.durable_jobs
     set next_attempt_at = now()
   where job_id = p_job_id;
  if not found then
    raise exception 'KLUY-TEST-JOB-NOT-FOUND: no durable job with id %', p_job_id
      using errcode = 'P0001';
  end if;
end
$fn$;

create or replace function kitluy_ops.test_probe_durable_job_mutation_refusal_v1(
  p_job_id uuid,
  p_mutation text
) returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
begin
  if p_job_id is null then
    raise exception 'KLUY-TEST-PROBE-NULL-JOB: a probe names exactly one job'
      using errcode = 'P0001';
  end if;
  -- Each branch attempts, as the table owner, exactly the forbidden direct
  -- write a trigger exists to refuse. The RETURNED message is the refusal;
  -- 'MUTATION-ACCEPTED' means the trigger did not fire and the invariant is
  -- broken. The four mutations are enumerated; there is no dynamic SQL.
  if p_mutation = 'RESET_ATTEMPTS' then
    begin
      update kitluy_ops.durable_jobs set attempt_count = 0 where job_id = p_job_id;
      return 'MUTATION-ACCEPTED';
    exception when others then
      return sqlerrm;
    end;
  elsif p_mutation = 'REAIM_SUBJECT' then
    begin
      update kitluy_ops.durable_jobs set subject_id = gen_random_uuid() where job_id = p_job_id;
      return 'MUTATION-ACCEPTED';
    exception when others then
      return sqlerrm;
    end;
  elsif p_mutation = 'REWRITE_PAYLOAD' then
    begin
      update kitluy_ops.durable_jobs set payload = '{"injected":true}'::jsonb where job_id = p_job_id;
      return 'MUTATION-ACCEPTED';
    exception when others then
      return sqlerrm;
    end;
  elsif p_mutation = 'REQUEUE' then
    begin
      update kitluy_ops.durable_jobs set status = 'queued' where job_id = p_job_id;
      return 'MUTATION-ACCEPTED';
    exception when others then
      return sqlerrm;
    end;
  end if;
  raise exception 'KLUY-TEST-PROBE-UNKNOWN-MUTATION: % is not a probed mutation', p_mutation
    using errcode = 'P0001';
end
$fn$;

alter function kitluy_ops.test_make_durable_job_due_v1(uuid)
  owner to kitluy_job_governor;
alter function kitluy_ops.test_probe_durable_job_mutation_refusal_v1(uuid, text)
  owner to kitluy_job_governor;

-- The test-only escape the purge helper needs: delete jobs in the
-- `kitluy.test.%` namespace and NOTHING else. A leaked mid-test row is a claim
-- the next run cannot reproduce against, and jobs are never deleted through
-- any production path, so the escape is a narrow named function rather than a
-- borrowed role. The trigger is disabled by the definer (the table owner) for
-- exactly these rows and re-enabled in the same statement.
--
-- kitluy:destructive-approved:KLRISK-DEVICE-011 -- the DELETE FROM statements
-- below are the repair's documented test-namespace escape: the function itself
-- refuses any job whose kind is not `kitluy.test.%`, so no production or
-- historical row is reachable through it.
create or replace function kitluy_ops.test_purge_durable_jobs_v1(
  p_job_ids uuid[]
) returns integer
language plpgsql
volatile
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
declare
  v_not_test integer;
  v_deleted integer;
begin
  if p_job_ids is null or cardinality(p_job_ids) = 0 then
    return 0;
  end if;
  select count(*) into v_not_test
    from kitluy_ops.durable_jobs
   where job_id = any(p_job_ids)
     and job_kind not like 'kitluy.test.%';
  if v_not_test > 0 then
    raise exception
      'KLUY-TEST-PURGE-NON-TEST-KIND: % of the named jobs are not in the kitluy.test.%% namespace',
      v_not_test
      using errcode = 'P0001';
  end if;
  alter table kitluy_ops.durable_jobs disable trigger trg_durable_jobs_no_delete;
  begin
    delete from kitluy_ops.durable_job_attempts where job_id = any(p_job_ids);
    delete from kitluy_ops.durable_jobs where job_id = any(p_job_ids);
    get diagnostics v_deleted = row_count;
    alter table kitluy_ops.durable_jobs enable trigger trg_durable_jobs_no_delete;
  exception when others then
    -- The trigger guard is never left off, even when the delete itself fails.
    alter table kitluy_ops.durable_jobs enable trigger trg_durable_jobs_no_delete;
    raise;
  end;
  return v_deleted;
end
$fn$;

alter function kitluy_ops.test_purge_durable_jobs_v1(uuid[])
  owner to kitluy_job_governor;

-- The lease-expiry simulation: forces one job's lease to LOOK dead so reclaim
-- can be exercised without waiting an hour. Two fixed columns, one named job,
-- no business state touched — the governed doors still decide everything.
create or replace function kitluy_ops.test_expire_durable_job_lease_v1(
  p_job_id uuid
) returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, kitluy_ops
as $fn$
begin
  if p_job_id is null then
    raise exception 'KLUY-TEST-JOB-NULL: a lease-expiry names exactly one job'
      using errcode = 'P0001';
  end if;
  update kitluy_ops.durable_jobs
     set leased_at = now() - interval '2 hours',
         lease_expires_at = now() - interval '1 hour'
   where job_id = p_job_id;
  if not found then
    raise exception 'KLUY-TEST-JOB-NOT-FOUND: no durable job with id %', p_job_id
      using errcode = 'P0001';
  end if;
end
$fn$;

alter function kitluy_ops.test_expire_durable_job_lease_v1(uuid)
  owner to kitluy_job_governor;

-- ---------------------------------------------------------------------------
-- 2. GRANTS: only the test/assertion role may inspect
-- ---------------------------------------------------------------------------
-- The worker service must NEVER read the job table directly; it claims through
-- the governed door. The assertion runner needs read-only facts.
revoke all on function kitluy_ops.inspect_job_attempt_count_v1(uuid) from public;
revoke all on function kitluy_ops.inspect_job_deferral_count_v1(uuid) from public;
revoke all on function kitluy_ops.inspect_job_status_v1(uuid) from public;
revoke all on function kitluy_ops.inspect_job_last_failure_code_v1(uuid) from public;

-- Grant to the roles that run assertions. `postgres` is the default Supabase
-- superuser that applies migrations and runs db:test; `authenticated` is the
-- role the Supabase client connects as for tests.
grant execute on function kitluy_ops.inspect_job_attempt_count_v1(uuid)
  to postgres, authenticated;
grant execute on function kitluy_ops.inspect_job_deferral_count_v1(uuid)
  to postgres, authenticated;
grant execute on function kitluy_ops.inspect_job_status_v1(uuid)
  to postgres, authenticated;
grant execute on function kitluy_ops.inspect_job_last_failure_code_v1(uuid)
  to postgres, authenticated;

-- The test-scaffold functions and the two governed operator acts section 40b
-- exercises go to the sanctioned test authority and NOBODY else -- not
-- postgres directly, not authenticated, not the worker (mirrors the test-clock
-- grant boundary). Tests borrow the harness for exactly one block and return
-- it; the membership census proves nothing is left behind.
revoke all on function kitluy_ops.test_make_durable_job_due_v1(uuid) from public;
revoke all on function kitluy_ops.test_probe_durable_job_mutation_refusal_v1(uuid, text) from public;
revoke all on function kitluy_ops.test_purge_durable_jobs_v1(uuid[]) from public;
revoke all on function kitluy_ops.test_expire_durable_job_lease_v1(uuid) from public;
grant execute on function kitluy_ops.test_make_durable_job_due_v1(uuid)
  to kitluy_test_harness;
grant execute on function kitluy_ops.test_probe_durable_job_mutation_refusal_v1(uuid, text)
  to kitluy_test_harness;
grant execute on function kitluy_ops.test_purge_durable_jobs_v1(uuid[])
  to kitluy_test_harness;
grant execute on function kitluy_ops.test_expire_durable_job_lease_v1(uuid)
  to kitluy_test_harness;
grant execute on function kitluy_ops.escalate_dead_letter_job_v1(uuid, text, text)
  to kitluy_test_harness;
grant execute on function kitluy_ops.release_manual_review_job_v1(uuid, text, text, text)
  to kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 3. REVOKE THE LEAKED MEMBERSHIP
-- ---------------------------------------------------------------------------
-- If current_user is still a member of kitluy_job_governor, remove it.
-- This is idempotent: revoking a membership that does not exist is a no-op.
do $revoke_leak$
begin
  if pg_has_role(current_user, 'kitluy_job_governor', 'MEMBER') then
    execute format('revoke kitluy_job_governor from %I', current_user);
  end if;
exception when others then
  raise notice 'KLUY-MIGRATION-0160: could not revoke kitluy_job_governor from % (%); may need manual cleanup',
    current_user, sqlerrm;
end
$revoke_leak$;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY HOLDS
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_still_member boolean;
  v_inspect_works boolean;
  v_worker_cannot_inspect boolean;
begin
  -- 1. The current user is no longer a member of kitluy_job_governor.
  select pg_has_role(current_user, 'kitluy_job_governor', 'MEMBER')
    into v_still_member;
  if v_still_member then
    raise exception 'KLUY-MIGRATION-0160: current_user is still a member of kitluy_job_governor'
      using errcode = 'P0001';
  end if;

  -- 2. The inspection functions are callable by postgres.
  begin
    perform kitluy_ops.inspect_job_attempt_count_v1(null::uuid);
    v_inspect_works := true;
  exception when others then
    v_inspect_works := false;
  end;
  if not v_inspect_works then
    raise exception 'KLUY-MIGRATION-0160: inspect functions are not callable'
      using errcode = 'P0001';
  end if;

  -- 3. kitluy_worker_service cannot execute the inspection functions
  --    (it should not need them; it uses the governed door).
  select not has_function_privilege('kitluy_worker_service',
    'kitluy_ops.inspect_job_attempt_count_v1(uuid)', 'EXECUTE')
    into v_worker_cannot_inspect;
  if not v_worker_cannot_inspect then
    raise exception 'KLUY-MIGRATION-0160: kitluy_worker_service can inspect job state directly'
      using errcode = 'P0001';
  end if;

  -- 4. The scaffold surface exists, is governor-owned, and is harness-only.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_ops'
       and p.proname in ('test_make_durable_job_due_v1',
                         'test_probe_durable_job_mutation_refusal_v1',
                         'test_purge_durable_jobs_v1',
                         'test_expire_durable_job_lease_v1')
       and pg_get_userbyid(p.proowner) = 'kitluy_job_governor'
    having count(*) = 4) then
    raise exception 'KLUY-MIGRATION-0160: the test scaffold is missing or not governor-owned'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('kitluy_worker_service',
       'kitluy_ops.test_make_durable_job_due_v1(uuid)', 'EXECUTE')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.test_probe_durable_job_mutation_refusal_v1(uuid, text)', 'EXECUTE')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.test_purge_durable_jobs_v1(uuid[])', 'EXECUTE')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.test_expire_durable_job_lease_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated',
       'kitluy_ops.test_make_durable_job_due_v1(uuid)', 'EXECUTE')
     or has_function_privilege('anon',
       'kitluy_ops.test_make_durable_job_due_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.test_make_durable_job_due_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.test_probe_durable_job_mutation_refusal_v1(uuid, text)', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.test_purge_durable_jobs_v1(uuid[])', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.test_expire_durable_job_lease_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.escalate_dead_letter_job_v1(uuid, text, text)', 'EXECUTE')
     or not has_function_privilege('kitluy_test_harness',
       'kitluy_ops.release_manual_review_job_v1(uuid, text, text, text)', 'EXECUTE') then
    raise exception 'KLUY-MIGRATION-0160: the scaffold grant boundary is wrong'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0160: job-governor membership leak repaired; narrow inspection functions installed';
end
$guard$;

commit;
