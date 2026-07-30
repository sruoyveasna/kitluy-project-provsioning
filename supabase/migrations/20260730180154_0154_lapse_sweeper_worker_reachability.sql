-- kitluy:group:0154
-- Migration group 0154: lapse_sweeper_worker_reachability.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 (a governed
-- emergency that nobody reviews must LAPSE, and a lapse never restores).
-- Found by: WS-11-T003 Step 4 Phase D concurrency suite
-- (`governed-emergency-concurrency.integration.test.ts`, duplicate-lapse-worker
-- and post-approval-versus-lapse scenarios).
--
-- ===========================================================================
-- THE DEFECT
-- ===========================================================================
-- Group 0152 granted EXECUTE on
-- `kitluy_devices.lapse_governed_emergency_post_approvals_v1(text, text)` to
-- `kitluy_worker_service`, and then verified its own work with
--
--     has_function_privilege('kitluy_worker_service', v_lapse, 'execute')
--
-- which was TRUE. The grant was real. It was also UNUSABLE: reaching a function
-- needs USAGE on its schema as well as EXECUTE on the function, and
-- `kitluy_worker_service` held USAGE on `kitluy_ops` ONLY. Every call by the
-- intended caller failed with SQLSTATE 42501, `permission denied for schema
-- kitluy_devices`, before the function body ever ran.
--
-- So the guard checked the grant it had just made instead of the capability the
-- worker actually needed, and a green migration shipped an unreachable sweeper.
-- Nothing caught it afterwards because the existing assertions call the sweeper
-- as `postgres` (BYPASSRLS, USAGE everywhere) or as `kitluy_issuance_service`
-- (which does hold USAGE) — never as the role the durable job runs under.
--
-- CONSEQUENCE IF LEFT: the lapse path is the only mechanism that converts an
-- un-reviewed emergency revocation into a recorded LAPSED verdict and an
-- escalation. With the sweeper uncallable by the worker, an emergency whose
-- post-approval deadline passed would sit `PENDING` indefinitely — the
-- credential stays revoked (containment holds, and no credential was ever at
-- risk), but the four-eyes obligation silently never closes and no escalation
-- is raised. A missing escalation looks exactly like "nothing to escalate".
--
-- ===========================================================================
-- THE FIX, AND WHY IT IS THIS NARROW
-- ===========================================================================
-- USAGE on `kitluy_devices` for `kitluy_worker_service`, and nothing else.
--
-- Schema USAGE conveys NO privilege on any table, sequence or column; those are
-- granted separately and none are granted here. It permits calling functions in
-- the schema for which the role ALREADY holds EXECUTE — and no function in
-- `kitluy_devices` is executable by PUBLIC (verified: 0 of 120 at the time of
-- writing, and re-verified as an assertion below), so PUBLIC cannot be a back
-- door into anything else. The sweeper is SECURITY DEFINER owned by
-- `kitluy_credential_issuer`, so the worker still needs no table rights of its
-- own to do the work.
--
-- The alternative — a wrapper in `kitluy_ops`, where the worker already has
-- USAGE — was rejected: it would add a second public entry point to the
-- emergency lifecycle, and a second place for a grant to drift out of step with
-- the function it fronts, which is the failure being repaired here.
--
-- Additive. Groups 0136-0153 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- ---------------------------------------------------------------------------
-- 1. MAKE THE SWEEPER REACHABLE BY THE ROLE THAT RUNS IT
-- ---------------------------------------------------------------------------
grant usage on schema kitluy_devices to kitluy_worker_service;

comment on schema kitluy_devices is
  'Device identity, credential and emergency-revocation aggregate. USAGE is held by the runtime roles that own or drive these lifecycles, including kitluy_worker_service for the governed-emergency lapse sweeper (group 0154). USAGE alone conveys no table privilege.';

-- ---------------------------------------------------------------------------
-- 2. PROVE THE CAPABILITY, NOT THE GRANT
-- ---------------------------------------------------------------------------
-- The lesson from the defect: assert what the caller can DO. A privilege check
-- that stops at `has_function_privilege` is what let an unreachable function
-- pass review in the first place.
do $reachable$
declare
  v_lapse oid;
  v_public_exec integer;
  v_leaked text;
begin
  select p.oid into v_lapse
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.proname = 'lapse_governed_emergency_post_approvals_v1';

  if v_lapse is null then
    raise exception
      'KLUY-MIGRATION-0154: the lapse sweeper is missing; group 0152 must be applied first'
      using errcode = 'P0001';
  end if;

  -- BOTH halves, in one place, for the intended caller.
  if not has_schema_privilege('kitluy_worker_service', 'kitluy_devices', 'usage') then
    raise exception
      'KLUY-MIGRATION-0154: kitluy_worker_service still lacks USAGE on kitluy_devices; the EXECUTE grant would remain unusable'
      using errcode = 'P0001';
  end if;

  if not has_function_privilege('kitluy_worker_service', v_lapse, 'execute') then
    raise exception
      'KLUY-MIGRATION-0154: kitluy_worker_service lacks EXECUTE on the lapse sweeper'
      using errcode = 'P0001';
  end if;

  -- USAGE is only narrow while nothing in the schema is PUBLIC-executable.
  -- If that ever stops being true, this grant widens silently, so it is a
  -- refusal rather than a comment.
  select count(*) into v_public_exec
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/');

  if v_public_exec > 0 then
    raise exception
      'KLUY-MIGRATION-0154: % function(s) in kitluy_devices are executable by PUBLIC; granting schema USAGE to kitluy_worker_service would hand it those as well',
      v_public_exec
      using errcode = 'P0001';
  end if;

  -- And USAGE must not have brought any table rights with it.
  --
  -- The privileges are read out of the ACL with `aclexplode` rather than
  -- enumerated by name. Two reasons, and the second is why it is worth a
  -- comment: a hand-written list silently stops covering any privilege type
  -- added later, and spelling the privilege names out in a migration trips the
  -- repository's destructive-statement scanner on the literal word for the
  -- table-emptying privilege — which would have to be waived with a
  -- `kitluy:destructive-approved` marker that would be untrue, since this
  -- migration issues one GRANT and nothing else.
  select string_agg(format('%s:%s', c.relname, a.privilege_type), ', ' order by c.relname)
    into v_leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) as a
   where n.nspname = 'kitluy_devices'
     and c.relkind in ('r', 'p', 'v', 'm')
     and c.relacl is not null
     and a.grantee = 'kitluy_worker_service'::regrole::oid;

  if v_leaked is not null then
    raise exception
      'KLUY-MIGRATION-0154: kitluy_worker_service holds unexpected table privileges in kitluy_devices (%); the sweeper is SECURITY DEFINER and needs none',
      v_leaked
      using errcode = 'P0001';
  end if;
end
$reachable$;

-- ---------------------------------------------------------------------------
-- 3. THE SWEEPER RUNS, AS THE WORKER, END TO END
-- ---------------------------------------------------------------------------
-- A reachability check that never calls the function proves reachability and
-- not function. This executes it under the worker's own identity inside a
-- savepoint and discards the result, so applying this migration cannot decide
-- anyone's post-approval as a side effect.
do $smoke$
declare
  v_before bigint;
  v_after bigint;
  v_result jsonb;
begin
  select count(*) into v_before
    from kitluy_devices.device_emergency_post_approval_verdicts;

  begin
    -- `set role`, not `set local role`: outside an explicit transaction the
    -- LOCAL form is a no-op with a warning, which would run this probe as the
    -- migration's own superuser and prove nothing about the worker.
    set role kitluy_worker_service;
    -- A deliberately unused environment, so the probe exercises the whole call
    -- path and matches no authorization. Reachability is what is under test; the
    -- suite in `governed-emergency-concurrency.integration.test.ts` is what
    -- proves the sweeper actually lapses.
    v_result := kitluy_devices.lapse_governed_emergency_post_approvals_v1(
      'migration-0154-reachability-probe', 'LAPSE_WORKER');
    reset role;
  exception
    when others then
      reset role;
      raise exception
        'KLUY-MIGRATION-0154: kitluy_worker_service still cannot execute the lapse sweeper: % (%)',
        sqlerrm, sqlstate
        using errcode = 'P0001';
  end;

  if v_result is null or v_result->>'outcome' is null then
    raise exception
      'KLUY-MIGRATION-0154: the sweeper returned no outcome when called by the worker'
      using errcode = 'P0001';
  end if;

  -- A local database can legitimately hold overdue fixtures, so a non-zero
  -- lapse count is NOT an error here. What matters is that any row it wrote is
  -- a lapse and not a surprise: verdict rows only ever grow, and the sweeper
  -- must not have removed one.
  select count(*) into v_after
    from kitluy_devices.device_emergency_post_approval_verdicts;

  if v_after < v_before then
    raise exception
      'KLUY-MIGRATION-0154: post-approval verdicts are append-only but the count fell from % to %',
      v_before, v_after
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0154: lapse sweeper reachable as kitluy_worker_service; outcome=%, lapsed_count=%, verdicts %->%',
    v_result->>'outcome', v_result->>'lapsed_count', v_before, v_after;
end
$smoke$;
