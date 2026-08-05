-- kitluy:group:0173
-- Migration group 0173: provisioning_composer_noinherit_gateway.
--
-- Authority: WS-11-T004-P02C1 (package contract); the P02C review finding
-- that direct-ACL absence is NOT evidence of least privilege; migration 0172
-- (the composer and its five capabilities); the 0127 machine-identity
-- pattern.
--
-- ===========================================================================
-- THE PROVEN DEFECT THIS GROUP CORRECTS
-- ===========================================================================
-- Migration 0172 granted `kitluy_provisioning_service` directly to
-- `service_role` and its handoff claimed the capability was entered per
-- transaction with SET LOCAL ROLE. That claim was NOT enforced by the
-- database. Measured on this repository's PostgreSQL 15.8:
--
--   * `service_role` has rolinherit = true;
--   * PostgreSQL 15 has NO per-membership INHERIT option (that arrived in
--     PG16), so inheritance follows the MEMBER role's attribute alone;
--   * therefore `service_role` AUTOMATICALLY held EXECUTE on all five
--     provisioning capabilities, and — proven by real calls, not by catalog
--     reading — executed every one of them into business logic while
--     operating as `service_role` with no SET ROLE at all.
--
-- Direct-ACL assertions passed the whole time, which is exactly why they are
-- insufficient on their own: they answer "was a grant written here?", never
-- "can this identity execute?".
--
-- ===========================================================================
-- THE CORRECTION
-- ===========================================================================
-- A NOINHERIT NOLOGIN hinge between the service identity and the capability:
--
--   service_role  --member-->  kitluy_provisioning_gateway (NOINHERIT)
--                              --member-->  kitluy_provisioning_service
--
-- PostgreSQL stops the automatic-privilege walk at a role that does not
-- inherit, so `service_role` no longer holds the five capabilities
-- implicitly. Membership is still transitive for SET ROLE, so the intended
-- boundary now behaves exactly as documented:
--
--   * as `service_role`, with no role entry -> EXECUTE denied (42501);
--   * after `SET LOCAL ROLE kitluy_provisioning_service` -> the five
--     capabilities work, current_user is the composer;
--   * at COMMIT/ROLLBACK the transaction-local role dies with the
--     transaction and the next statement is denied again.
--
-- Chosen because it is the narrowest fix that needs NO change to a
-- Supabase-owned role attribute (`ALTER ROLE service_role NOINHERIT` would
-- reach every unrelated membership `service_role` holds) and NO new login
-- credential (an owner value that must never enter this repository).
--
-- RECORDED, OUT OF SCOPE: `kitluy_issuance_service` (0127) and
-- `kitluy_worker_service` (0135) are granted to `service_role` the same way
-- and therefore share this inherited-privilege property. This group does not
-- touch them — their consumers were not audited here, and changing them is a
-- separate decision. The finding is recorded in the P02C1 handoff.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02C1 -- the one REVOKE below
-- withdraws an over-broad membership this group replaces with a strictly
-- narrower path; no data is dropped, truncated or deleted.
-- ===========================================================================

do $gateway$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_provisioning_gateway') then
    create role kitluy_provisioning_gateway nologin noinherit;
  end if;
end
$gateway$;

comment on role kitluy_provisioning_gateway is
  'Group 0173 (WS-11-T004-P02C1). The NOINHERIT hinge that makes the provisioning composer a capability an identity must ENTER rather than one it silently carries. NOLOGIN and NOINHERIT, holding no privilege of its own: PostgreSQL stops the automatic-privilege walk here, so service_role does not inherit kitluy_provisioning_service, while membership remains transitive so SET LOCAL ROLE still reaches the composer for exactly one transaction. Exists because PostgreSQL 15 has no per-membership INHERIT option and altering the Supabase-owned service_role attribute would reach every unrelated membership it holds.';

grant kitluy_provisioning_service to kitluy_provisioning_gateway;

-- The over-broad membership 0172 created, replaced by the narrower path.
revoke kitluy_provisioning_service from service_role;
grant kitluy_provisioning_gateway to service_role;

-- ---------------------------------------------------------------------------
-- PROVE THE EFFECTIVE BOUNDARY ON APPLY — direct ACL AND effective privilege
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
  v_fns text[] := array[
    'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)',
    'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)',
    'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)',
    'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)',
    'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)'];
  v_extra integer;
begin
  -- The hinge exists with the attributes the correction depends on. NOINHERIT
  -- is the whole mechanism; asserting it is not a tautology.
  if not exists (
    select 1 from pg_roles
     where rolname = 'kitluy_provisioning_gateway'
       and not rolcanlogin and not rolinherit and not rolsuper
       and not rolcreaterole and not rolcreatedb and not rolbypassrls) then
    raise exception 'KLUY-MIGRATION-0173: the gateway is missing or does not have the NOLOGIN/NOINHERIT posture the boundary depends on'
      using errcode = 'P0001';
  end if;

  -- EFFECTIVE privilege — the check P02C should have made. `service_role`
  -- must NOT be able to execute any capability without entering the composer.
  foreach v_fn in array v_fns loop
    if has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0173: service_role still EFFECTIVELY holds EXECUTE on % without entering the composer', v_fn
        using errcode = 'P0001';
    end if;
    -- The composer itself must still hold every capability, or the
    -- composition service breaks.
    if not has_function_privilege('kitluy_provisioning_service', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0173: the composer lost EXECUTE on %', v_fn
        using errcode = 'P0001';
    end if;
    -- And no direct ACL was quietly reintroduced for service_role.
    if exists (
      select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       cross join lateral aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
      where p.oid = v_fn::regprocedure and a.grantee = 'service_role'::regrole::oid) then
      raise exception 'KLUY-MIGRATION-0173: a direct service_role grant exists on %', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- Membership is retained so explicit entry still works: service_role must
  -- remain a MEMBER of the composer (SET ROLE eligibility) while NOT
  -- inheriting it (USAGE).
  if not pg_has_role('service_role', 'kitluy_provisioning_service', 'MEMBER') then
    raise exception 'KLUY-MIGRATION-0173: service_role can no longer SET ROLE to the composer'
      using errcode = 'P0001';
  end if;
  if pg_has_role('service_role', 'kitluy_provisioning_service', 'USAGE') then
    raise exception 'KLUY-MIGRATION-0173: service_role still inherits the composer'
      using errcode = 'P0001';
  end if;

  -- The composer keeps exactly its five capabilities, its NOLOGIN posture and
  -- zero table reach; the gateway confers nothing of its own.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_provisioning_service', p.oid, 'execute')
     and p.proname not in (
       'evaluate_terminal_provisioning_code_v1',
       'issue_terminal_provisioning_pop_challenge_v1',
       'read_terminal_provisioning_pop_challenge_context_v1',
       'record_terminal_provisioning_pop_verification_v1',
       'redeem_terminal_provisioning_code_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0173: the composer can execute % function(s) beyond its five capabilities', v_extra
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_roles where rolname = 'kitluy_provisioning_service'
       and not rolcanlogin and not rolsuper and not rolcreaterole
       and not rolcreatedb and not rolbypassrls) then
    raise exception 'KLUY-MIGRATION-0173: the composer posture drifted'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_codes', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_code_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_certificates', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_gateway', 'kitluy_devices.device_provisioning_codes', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0173: a composition role holds direct table access'
      using errcode = 'P0001';
  end if;

  -- The gateway is a hinge, not an authority: it holds no function grant of
  -- its own beyond what membership of the composer implies, and nobody but
  -- service_role holds it.
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
    where n.nspname = 'kitluy_devices'
      and a.grantee = 'kitluy_provisioning_gateway'::regrole::oid) then
    raise exception 'KLUY-MIGRATION-0173: the gateway holds a direct function grant'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_provisioning_gateway')
       and r.rolname <> 'service_role') then
    raise exception 'KLUY-MIGRATION-0173: an unexpected role holds the gateway'
      using errcode = 'P0001';
  end if;
  -- No member may re-delegate either role.
  if exists (
    select 1 from pg_auth_members m
     where m.roleid in (select oid from pg_roles
                         where rolname in ('kitluy_provisioning_gateway', 'kitluy_provisioning_service'))
       and m.admin_option) then
    raise exception 'KLUY-MIGRATION-0173: a member can re-delegate a composition role'
      using errcode = 'P0001';
  end if;

  -- Runtime identities remain denied, effectively, not merely by ACL.
  foreach v_fn in array v_fns loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('kitluy_worker_service', v_fn, 'execute')
       or has_function_privilege('kitluy_issuance_service', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0173: a runtime identity effectively holds EXECUTE on %', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- No login-capable role belongs to the NOLOGIN authorities.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid in (select oid from pg_roles
                         where rolname in ('kitluy_activation_governor',
                                           'kitluy_provisioning_service',
                                           'kitluy_provisioning_gateway'))
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0173: a login-capable role belongs to a NOLOGIN authority'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0173: provisioning composer boundary CORRECTED (PostgreSQL 15 has no per-membership INHERIT option, so a NOINHERIT NOLOGIN gateway now sits between service_role and the composer: effective EXECUTE without role entry is gone, SET LOCAL ROLE still works, the composer keeps exactly five capabilities and zero table reach; kitluy_issuance_service and kitluy_worker_service share the same inherited-privilege property and are recorded, untouched, for a separate owner decision)';
end
$guard$;
