-- kitluy:group:0157
-- Migration group 0157: sanctioned_test_clock.
--
-- Authority: KLD-2026-07-31-SECURITY-TEST-CLOCK-001 (owner-locked);
-- WS-11-T003 Step 4 §2.
--
-- ===========================================================================
-- WHY A TEST CLOCK EXISTS AT ALL
-- ===========================================================================
-- The 300-second re-authentication window is enforced against DATABASE time
-- inside the governed emergency RPC, and deliberately so: a business RPC that
-- accepted an instant would let a caller decide when "now" is, which is the whole
-- control. That makes the expiry race untestable by ordinary means — a test would
-- have to sleep for five real minutes while holding a lock.
--
-- The previous session refused to invent a mechanism for this and recorded it as
-- an owner decision. This implements the ruling.
--
-- ===========================================================================
-- HOW IT CANNOT REACH PRODUCTION
-- ===========================================================================
-- `kitluy_ops.test_clock_policy` is created EMPTY and is NEVER seeded by any
-- migration. That is the same fail-closed shape as
-- `kitluy_devices.pki_trust_configuration` (group 0120), which is created empty so
-- an agent cannot open the gate: enabling the clock requires a deliberate,
-- separately-executed INSERT that no migration performs.
--
-- With no row, `kitluy_ops.authoritative_now_v1()` returns `clock_timestamp()` and
-- the override is inert. Production and development therefore ignore it because
-- nobody enabled it there, not because a flag says so.
--
-- The row also names the business environment it covers, and the reader honours
-- an override ONLY for `test`. Two independent conditions, both stored, neither a
-- caller parameter.
--
-- ===========================================================================
-- WHAT THIS DOES NOT CLAIM
-- ===========================================================================
-- Inside a database where the policy row EXISTS, a session that can already
-- execute arbitrary SQL can set the GUC directly and move time. That is stated
-- rather than papered over: the boundary this mechanism enforces is BETWEEN
-- DATABASES, not within one. The governed helper exists so the ordinary path is
-- auditable and role-restricted; the reason production is safe is that production
-- has no policy row, and `authoritative_now_v1()` does not consult the GUC at all
-- without one.
--
-- Business RPC signatures are UNCHANGED. Nothing in groups 0136-0156 gains a
-- clock parameter, and group 0158+ must not add one either.
--
-- Additive. Groups 0136-0156 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- ---------------------------------------------------------------------------
-- 1. THE NOLOGIN CLOCK AUTHORITY AND THE TEST HARNESS ROLE
-- ---------------------------------------------------------------------------
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_test_clock_authority') then
    create role kitluy_test_clock_authority nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_test_harness') then
    create role kitluy_test_harness nologin;
  end if;
end
$roles$;

-- Ownership borrow, same as groups 0125-0156: the applying role is not a member
-- of the NOLOGIN authority, so `alter function ... owner to` would fail 42501.
-- Returned in section 7 before this migration ends, so no login-capable role is
-- left holding it.
do $borrow$
begin
  execute format('grant kitluy_test_clock_authority to %I', current_user);
end
$borrow$;

comment on role kitluy_test_clock_authority is
  'NOLOGIN owner of the sanctioned test-clock helper (KLD-2026-07-31-SECURITY-TEST-CLOCK-001). Owns nothing else and is a member of nothing.';
comment on role kitluy_test_harness is
  'NOLOGIN identity the security test harness assumes to install a transaction-local clock override. Holds EXECUTE on the helper and nothing else.';

-- The AUTHORITY needs to reach its own objects: a SECURITY DEFINER runs as the
-- owner, and an owner without schema USAGE cannot resolve the table its body
-- reads. This is the RC-028 trap — a real grant that is unusable — so both
-- halves are granted and section 6 proves the capability by calling.
grant usage on schema kitluy_ops to kitluy_test_clock_authority, kitluy_test_harness;
-- CREATE as well, for the AUTHORITY only: PostgreSQL requires the NEW OWNER of a
-- function to hold CREATE on the function's schema, so `alter function ... owner
-- to` fails `42501 permission denied for schema` without it. This mirrors
-- kitluy_job_governor on kitluy_ops and kitluy_credential_issuer on
-- kitluy_devices — every definer owner in this database holds CREATE where it
-- owns objects. The HARNESS gets USAGE only; it owns nothing.
grant create on schema kitluy_ops to kitluy_test_clock_authority;

-- ---------------------------------------------------------------------------
-- 2. THE POLICY TABLE — CREATED EMPTY, NEVER SEEDED
-- ---------------------------------------------------------------------------
create table if not exists kitluy_ops.test_clock_policy (
  environment   text        primary key,
  enabled_at    timestamptz not null default now(),
  enabled_by    text        not null,
  decision_ref  text        not null,
  constraint test_clock_policy_environment_ck check (environment = 'test'),
  constraint test_clock_policy_decision_ck
    check (decision_ref = 'KLD-2026-07-31-SECURITY-TEST-CLOCK-001'),
  constraint test_clock_policy_enabled_by_ck check (btrim(enabled_by) <> '')
);

comment on table kitluy_ops.test_clock_policy is
  'Created EMPTY and never seeded by any migration, exactly like kitluy_devices.pki_trust_configuration. A row here is the ONLY thing that makes a clock override readable, and only for environment = test. Its absence is why production ignores the mechanism.';

revoke all on kitluy_ops.test_clock_policy from public;
grant select on kitluy_ops.test_clock_policy
  to kitluy_test_clock_authority, kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 3. THE AUTHORITATIVE CLOCK
-- ---------------------------------------------------------------------------
-- Everything that needs "now" for a security decision should read this. It
-- returns real database time unless BOTH stored conditions hold and a
-- transaction-local override is present.
create or replace function kitluy_ops.authoritative_now_v1()
returns timestamptz
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_ops
as $now$
declare
  v_override text;
begin
  -- CONDITION 1: somebody deliberately enabled the clock in THIS database for
  -- the `test` environment. No migration does this.
  if not exists (select 1 from kitluy_ops.test_clock_policy where environment = 'test') then
    return clock_timestamp();
  end if;

  -- CONDITION 2: a transaction-local override is present. `true` as the second
  -- argument makes a missing setting return NULL instead of raising.
  v_override := nullif(current_setting('kitluy.test_clock_instant', true), '');
  if v_override is null then
    return clock_timestamp();
  end if;

  begin
    return v_override::timestamptz;
  exception
    when others then
      -- A malformed override is IGNORED rather than fatal. A security check that
      -- crashed on bad input would be a denial-of-service switch.
      return clock_timestamp();
  end;
end
$now$;

alter function kitluy_ops.authoritative_now_v1() owner to kitluy_test_clock_authority;
revoke all on function kitluy_ops.authoritative_now_v1() from public;
-- Readable by every governed identity that makes a time-based decision. Reading
-- the clock is not a privilege; SETTING it is.
grant execute on function kitluy_ops.authoritative_now_v1()
  to kitluy_credential_issuer, kitluy_issuance_service, kitluy_worker_service,
     kitluy_activation_governor, kitluy_test_harness;

comment on function kitluy_ops.authoritative_now_v1() is
  'Authoritative now. Returns clock_timestamp() unless a test_clock_policy row exists for environment test AND a transaction-local override is set. Reading is unprivileged; installing an override is not.';

-- ---------------------------------------------------------------------------
-- 4. THE GOVERNED INSTALLER
-- ---------------------------------------------------------------------------
create or replace function kitluy_ops.test_clock_set_v1(p_instant timestamptz)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = pg_catalog, kitluy_ops
as $set_clock$
declare
  v_applied text;
begin
  if not exists (select 1 from kitluy_ops.test_clock_policy where environment = 'test') then
    raise exception
      'KLUY-TEST-CLOCK-NOT-ENABLED: no test_clock_policy row for environment test; the sanctioned clock is inert in this database'
      using errcode = 'P0001';
  end if;
  if p_instant is null then
    raise exception 'KLUY-TEST-CLOCK-NULL-INSTANT: an override needs an instant'
      using errcode = 'P0001';
  end if;

  -- TRANSACTION-LOCAL. `true` is `is_local`, so the value dies at COMMIT or
  -- ROLLBACK and cannot outlive the test onto a pooled connection.
  v_applied := set_config(
    'kitluy.test_clock_instant',
    to_char(p_instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.USOF'),
    true);
  return v_applied::timestamptz;
end
$set_clock$;

alter function kitluy_ops.test_clock_set_v1(timestamptz) owner to kitluy_test_clock_authority;
revoke all on function kitluy_ops.test_clock_set_v1(timestamptz) from public;
-- THE HARNESS AND NOBODY ELSE. Not authenticated, not service_role, not
-- issuance, not the worker, not anon.
grant execute on function kitluy_ops.test_clock_set_v1(timestamptz) to kitluy_test_harness;

comment on function kitluy_ops.test_clock_set_v1(timestamptz) is
  'Installs a TRANSACTION-LOCAL clock override. Refuses unless a test_clock_policy row exists. EXECUTE granted to kitluy_test_harness only (KLD-2026-07-31-SECURITY-TEST-CLOCK-001).';

-- ---------------------------------------------------------------------------
-- 5. CAPABILITY CENSUS
-- ---------------------------------------------------------------------------
do $census$
declare
  v_set oid;
  v_now oid;
  v_role text;
begin
  select p.oid into v_set from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_ops' and p.proname = 'test_clock_set_v1';
  select p.oid into v_now from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_ops' and p.proname = 'authoritative_now_v1';
  if v_set is null or v_now is null then
    raise exception 'KLUY-MIGRATION-0157: group 0157 did not create both functions'
      using errcode = 'P0001';
  end if;

  -- THE POLICY TABLE IS EMPTY. If a migration ever seeds it, the clock becomes
  -- reachable wherever that migration runs — including production.
  if exists (select 1 from kitluy_ops.test_clock_policy) then
    raise exception
      'KLUY-MIGRATION-0157: test_clock_policy is not empty; no migration may enable the test clock'
      using errcode = 'P0001';
  end if;

  -- NOBODY BUT THE HARNESS MAY INSTALL AN OVERRIDE.
  foreach v_role in array array[
    'anon', 'authenticated', 'service_role',
    'kitluy_issuance_service', 'kitluy_worker_service',
    'kitluy_credential_issuer', 'kitluy_activation_governor'
  ] loop
    if has_function_privilege(v_role, v_set, 'execute') then
      raise exception
        'KLUY-MIGRATION-0157: % can install a clock override; only kitluy_test_harness may',
        v_role using errcode = 'P0001';
    end if;
  end loop;

  if not has_function_privilege('kitluy_test_harness', v_set, 'execute') then
    raise exception 'KLUY-MIGRATION-0157: the test harness cannot install an override'
      using errcode = 'P0001';
  end if;

  -- NEITHER NOLOGIN ROLE MAY BE LOGINABLE, AND NO LOGIN ROLE MAY HOLD THEM.
  foreach v_role in array array['kitluy_test_clock_authority', 'kitluy_test_harness'] loop
    if (select rolcanlogin from pg_roles where rolname = v_role) then
      raise exception 'KLUY-MIGRATION-0157: % is LOGIN-capable', v_role using errcode = 'P0001';
    end if;
    if (select rolbypassrls from pg_roles where rolname = v_role) then
      raise exception 'KLUY-MIGRATION-0157: % holds BYPASSRLS', v_role using errcode = 'P0001';
    end if;
  end loop;

  raise notice
    'KLUY-MIGRATION-0157: sanctioned test clock installed INERT — policy table empty, override refused, install granted to kitluy_test_harness only, both authorities NOLOGIN without BYPASSRLS';
end
$census$;

-- ---------------------------------------------------------------------------
-- 6. THE CLOCK IS INERT RIGHT NOW, PROVED BY CALLING IT
-- ---------------------------------------------------------------------------
do $inert$
declare
  v_now timestamptz;
  v_real timestamptz;
  v_refused boolean := false;
begin
  v_real := clock_timestamp();
  v_now := kitluy_ops.authoritative_now_v1();
  if abs(extract(epoch from (v_now - v_real))) > 5 then
    raise exception
      'KLUY-MIGRATION-0157: authoritative_now_v1 is already diverging from real time by %s',
      extract(epoch from (v_now - v_real)) using errcode = 'P0001';
  end if;

  -- Even a forged GUC does nothing while the policy table is empty.
  perform set_config('kitluy.test_clock_instant', '1999-01-01T00:00:00.000000+00', true);
  v_now := kitluy_ops.authoritative_now_v1();
  if v_now < v_real - interval '1 day' then
    raise exception
      'KLUY-MIGRATION-0157: a caller-set GUC moved authoritative time with no policy row; the mechanism is not inert'
      using errcode = 'P0001';
  end if;
  perform set_config('kitluy.test_clock_instant', '', true);

  -- And the installer refuses outright.
  begin
    perform kitluy_ops.test_clock_set_v1(now());
  exception
    when others then v_refused := true;
  end;
  if not v_refused then
    raise exception
      'KLUY-MIGRATION-0157: test_clock_set_v1 succeeded with no policy row' using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0157: proved inert — authoritative_now_v1 tracks real time, a forged GUC is ignored, and the installer refuses';
end
$inert$;

-- ---------------------------------------------------------------------------
-- 7. HAND THE BORROW BACK
-- ---------------------------------------------------------------------------
-- A login-capable role left holding the clock authority could SET ROLE to it and
-- install an override wherever the policy row exists. Returned unconditionally,
-- and `assertions.sql` is the standing guard that it happened.
do $hand_back$
begin
  execute format('revoke kitluy_test_clock_authority from %I', current_user);
end
$hand_back$;
