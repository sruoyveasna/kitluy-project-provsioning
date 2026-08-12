-- kitluy:group:0189
-- ===========================================================================
-- FACTORY QA DEFINER OWNERSHIP REPAIR — ADDITIVE
--
-- WHY THIS GROUP EXISTS. Group 0188 declared ENABLE + FORCE ROW LEVEL SECURITY
-- on `factory_qa_executions` and `factory_qa_check_results` and then created
-- NO policies, while leaving its SECURITY DEFINER door
-- `record_factory_qa_v1` owned by `postgres` — a LOGIN-CAPABLE role that holds
-- BYPASSRLS.
--
-- The consequence is that the declared row security was decorative. The door
-- worked only because its owner ignores RLS, and 0188's
-- `grant select, insert ... to service_role` could never take effect, because
-- FORCE RLS with zero policies denies every non-bypassing role. A reviewer
-- reading 0188 would reasonably conclude the table was protected AND reachable;
-- neither was true in the way the file implies.
--
-- Verified on the canonical cloud project `kitluy-project-pos` on 2026-08-11:
--
--     record_factory_qa_v1              owner=postgres  secdef=true
--     factory_qa_executions     rls=t force=t  policies=0
--     factory_qa_check_results  rls=t force=t  policies=0
--
-- WHY THIS IS ADDITIVE AND 0188 IS NOT EDITED. Version 20260810120000 is
-- already recorded as applied in `supabase_migrations.schema_migrations` on the
-- canonical cloud. Rewriting an applied migration would leave the deployed
-- lineage and the repository silently disagreeing about what ran. The
-- correction is therefore a new version, and 0188 keeps the text that was
-- actually executed.
--
-- WHY THE FLEET GOVERNOR. `kitluy_fleet_governor` is NOLOGIN and holds no
-- BYPASSRLS. It already owns `ingest_device_health_report_v1`, the other
-- device-evidence ingestion door (group 0177), so this repair moves the QA
-- door onto the established pattern rather than inventing an owner. Because
-- that role cannot bypass RLS, the write path has to be STATED as a policy —
-- which is the point of the repair, not a side effect of it.
--
-- LEAST PRIVILEGE. The governor receives SELECT and INSERT only. No UPDATE, no
-- DELETE: both tables are append-only by group 0188's
-- `kitluy_auth.enforce_append_only` triggers, and granting a privilege the
-- design forbids would make the grant the weaker statement of the two.
--
-- ROLLBACK. Every statement here is reversible without data loss:
--   alter function kitluy_devices.record_factory_qa_v1(...) owner to postgres;
--   drop policy fqe_governor on kitluy_devices.factory_qa_executions;
--   drop policy fqcr_governor on kitluy_devices.factory_qa_check_results;
--   revoke select, insert on <both tables> from kitluy_fleet_governor;
-- No table, column, row or index is created, altered or dropped by this group.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. OWNERSHIP — move the definer door off the login-capable deployment role.
-- ---------------------------------------------------------------------------
do $own_fn$
declare
  v_sig text;
  v_owner text;
begin
  select p.oid::regprocedure::text, pg_get_userbyid(p.proowner)
    into v_sig, v_owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'record_factory_qa_v1';

  if v_sig is null then
    raise exception
      'KLUY-0189-MISSING-DOOR: kitluy_devices.record_factory_qa_v1 not found; group 0188 must be applied first';
  end if;

  -- Idempotent: a re-run on an already-repaired database is a no-op rather
  -- than a failure, so the group is safe to re-apply during recovery.
  if v_owner = 'kitluy_fleet_governor' then
    raise notice '0189: ownership already correct (%), nothing to reassign', v_owner;
  else
    -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): reassigning ownership
    -- requires recorded membership of the target role, and this chain hands
    -- governor membership back after each use. Borrow it for the reassignment
    -- and return it immediately, exactly as group 0140 borrows the approval
    -- reader.
    execute 'grant kitluy_fleet_governor to current_user';
    execute format('alter function %s owner to kitluy_fleet_governor', v_sig);
    execute 'revoke kitluy_fleet_governor from current_user';
  end if;

  -- The caller surface is restated rather than assumed: PUBLIC/anon/
  -- authenticated must not reach a definer door, and the QA station reaches it
  -- through the service identity exactly as group 0188 intended.
  execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  execute format('grant execute on function %s to service_role, kitluy_test_harness', v_sig);
end
$own_fn$;

-- ---------------------------------------------------------------------------
-- 2. THE WRITE PATH IS NOW STATED, NOT INHERITED.
--
-- The governor holds no BYPASSRLS, so without these it could not write at all.
-- No anon/authenticated/service_role policy is created: the client surface
-- stays fail-closed, and every write continues to arrive through the governed
-- door rather than through a direct table grant.
-- ---------------------------------------------------------------------------
grant select, insert on kitluy_devices.factory_qa_executions to kitluy_fleet_governor;
grant select, insert on kitluy_devices.factory_qa_check_results to kitluy_fleet_governor;

drop policy if exists fqe_governor on kitluy_devices.factory_qa_executions;
create policy fqe_governor on kitluy_devices.factory_qa_executions
  for all to kitluy_fleet_governor using (true) with check (true);

drop policy if exists fqcr_governor on kitluy_devices.factory_qa_check_results;
create policy fqcr_governor on kitluy_devices.factory_qa_check_results
  for all to kitluy_fleet_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Assertions — the migration proves its own intent.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_findings text[] := array[]::text[];
  v_owner text;
  v_secdef boolean;
  v_cfg text[];
begin
  select pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig
    into v_owner, v_secdef, v_cfg
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'record_factory_qa_v1';

  if v_owner <> 'kitluy_fleet_governor' then
    v_findings := v_findings || format('door owner is %s, not kitluy_fleet_governor', v_owner)::text;
  end if;

  -- The whole point of the repair: the owner must not be able to log in, and
  -- must not hold BYPASSRLS, or the FORCE RLS below is decorative again.
  if exists (select 1 from pg_roles where rolname = v_owner and (rolcanlogin or rolbypassrls)) then
    v_findings := v_findings
      || format('door owner %s is login-capable or holds BYPASSRLS', v_owner)::text;
  end if;

  if not v_secdef then
    v_findings := v_findings || 'door is no longer SECURITY DEFINER'::text;
  end if;

  -- Hardening carried over from 0188 must survive the ownership change.
  if v_cfg is null or not exists (select 1 from unnest(v_cfg) c where c like 'search\_path=%') then
    v_findings := v_findings || 'door lost its pinned search_path'::text;
  end if;

  if has_function_privilege('public', 'kitluy_devices.record_factory_qa_v1(uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, text, text, text, text)', 'execute') then
    v_findings := v_findings || 'door is EXECUTE-able by PUBLIC'::text;
  end if;
  foreach v_owner in array array['anon', 'authenticated'] loop
    if has_function_privilege(v_owner, 'kitluy_devices.record_factory_qa_v1(uuid, text, text, text, text, text, jsonb, timestamptz, timestamptz, text, text, text, text)', 'execute') then
      v_findings := v_findings || format('door is EXECUTE-able by %s', v_owner)::text;
    end if;
  end loop;

  -- FORCE RLS must still be on, and must now be BACKED by a policy.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('factory_qa_executions', 'factory_qa_check_results')
       and not (c.relrowsecurity and c.relforcerowsecurity)) then
    v_findings := v_findings || 'FORCE ROW LEVEL SECURITY was weakened'::text;
  end if;
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('factory_qa_executions', 'factory_qa_check_results')
       and (select count(*) from pg_policy p where p.polrelid = c.oid) = 0) then
    v_findings := v_findings || 'FORCE RLS is still declared with no policy behind it'::text;
  end if;

  -- The client surface must NOT have gained a policy.
  if exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('factory_qa_executions', 'factory_qa_check_results')
      and exists (
        select 1 from unnest(p.polroles) pr
        join pg_roles r on r.oid = pr
        where r.rolname in ('anon', 'authenticated', 'service_role', 'public'))) then
    v_findings := v_findings || 'a client-facing policy was created on the QA evidence tables'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0189: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS 0189: the factory-QA door is SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS kitluy_fleet_governor with its search_path still pinned and no EXECUTE for PUBLIC, anon or authenticated; FORCE ROW LEVEL SECURITY on both evidence tables is now BACKED by an explicit governor policy instead of resting on the previous owner''s BYPASSRLS, and no client-facing policy was introduced — the write path is stated rather than inherited';
end
$guard$;
