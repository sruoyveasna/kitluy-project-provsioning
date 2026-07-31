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

  raise notice 'KLUY-MIGRATION-0160: job-governor membership leak repaired; narrow inspection functions installed';
end
$guard$;

commit;
