-- kitluy:group:0206
-- =============================================================================
-- Group 0206 — C-4 / D-07: separation of duty made real
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, verdict
-- REJECTED, critical finding C-4; owner remediation Phase 4; D-07 (open since
-- 2026-08-24); the group 0173 hinge pattern (WS-11-T004-P02C1), which this group
-- applies to the three memberships 0173 explicitly recorded and left alone.
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `service_role` — the identity every application connection actually uses —
-- is a direct member of `kitluy_issuance_service`, `kitluy_activation_service`
-- and `kitluy_device_certificate_issuer`, and `service_role` has
-- `rolinherit = true`. So it held all three AUTOMATICALLY, with no SET ROLE and
-- no ceremony:
--
--   record_operational_certificate_v1        reachable as service_role
--   attempt_activate_device_v1               reachable as service_role
--   issue_development_device_certificate_v1  reachable as service_role
--   register_generation_key_v1               reachable as service_role
--   prepare_device_credential_issuance_v1    reachable as service_role
--
-- Measured, not inferred. One identity could mint a credential and then consume
-- it, so "the issuer cannot activate and the activation identity cannot issue" —
-- asserted on apply by group 0199 and repeated in every handoff since — was true
-- of the governor roles and false of the identity that connects.
--
-- The application's `withServiceRole()` discipline was real but advisory:
-- SET LOCAL ROLE narrowed what the code DID, never what the connection COULD do.
--
-- =============================================================================
-- WHY THE OLD ASSERTIONS MISSED IT FOR SO LONG
-- =============================================================================
-- They asked `information_schema.role_table_grants`, which lists DIRECT grants.
-- Inherited authority does not appear there, so the guards answered "was a grant
-- written here?" and never "can this identity execute?" — and passed, every
-- time, while the boundary did not exist. Group 0173 wrote that lesson down in
-- 2026-08-06 and this group is where it finally reaches the credential path.
--
-- Every assertion below therefore uses `has_function_privilege`, which resolves
-- inheritance.
--
-- =============================================================================
-- THE CORRECTION
-- =============================================================================
--   service_role --member--> kitluy_<x>_gateway (NOLOGIN, NOINHERIT)
--                            --member--> kitluy_<x>_service
--
-- PostgreSQL stops the automatic-privilege walk at a role that does not inherit,
-- so `service_role` no longer carries the capability. Membership stays
-- transitive for SET ROLE, so `set local role kitluy_issuance_service` still
-- works and still dies with its transaction.
--
-- Three separate hinges rather than one, so a later decision can withdraw one
-- capability without touching the others.
--
-- `ALTER ROLE service_role NOINHERIT` would have been shorter and is deliberately
-- NOT used: it is a Supabase-owned role and the attribute reaches every unrelated
-- membership it holds, including ones this repository did not create and has not
-- audited. That is 0173's reasoning and it has not changed.
--
-- =============================================================================
-- kitluy:destructive-approved:KLD-2026-08-26-CREDENTIAL-PATH-SEPARATION-001 --
-- the three REVOKEs below withdraw over-broad memberships and replace each with
-- a strictly narrower path to the same capability. No data is dropped,
-- truncated or deleted, and no capability is lost — only its automatic grant.
-- =============================================================================

begin;

do $hinges$
declare
  v_pair record;
begin
  for v_pair in
    select * from (values
      ('kitluy_issuance_gateway',   'kitluy_issuance_service'),
      ('kitluy_activation_gateway', 'kitluy_activation_service'),
      ('kitluy_certificate_gateway','kitluy_device_certificate_issuer')
    ) as t(gateway, service)
  loop
    if not exists (select 1 from pg_roles where rolname = v_pair.gateway) then
      execute format('create role %I nologin noinherit', v_pair.gateway);
    end if;
    execute format('grant %I to %I', v_pair.service, v_pair.gateway);
    -- The over-broad membership, replaced by the narrower path.
    execute format('revoke %I from service_role', v_pair.service);
    execute format('grant %I to service_role', v_pair.gateway);
  end loop;
end
$hinges$;

-- -----------------------------------------------------------------------------
-- The DIRECT grants, which a hinge cannot touch
-- -----------------------------------------------------------------------------
--
-- Removing the inherited path is only half of it. `attempt_activate_device_v1`
-- also carries an EXECUTE grant written straight to `service_role` in its own
-- ACL, and a NOINHERIT hinge does nothing about that — a direct grant is not
-- inheritance.
--
-- Found by the effective-privilege guard below on the first apply of this group,
-- which is exactly the point of asking `has_function_privilege` instead of
-- reading the membership graph and assuming the answer.
--
-- The capability is not lost: `kitluy_activation_service` keeps its grant and
-- the application already enters that role for every activation.
--
-- Only an object's OWNER may revoke a grant on it, and these five doors are
-- owned by three different governor roles. Each owner is borrowed for this
-- transaction and handed back below — the pattern thirty migrations already use,
-- applied here to a set discovered from the catalog rather than hardcoded, so a
-- future change of owner does not silently skip a revoke.
do $borrow_owners$
declare
  v_owner text;
begin
  for v_owner in
    select distinct pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('record_operational_certificate_v1', 'attempt_activate_device_v1',
                         'issue_development_device_certificate_v1', 'register_generation_key_v1',
                         'abandon_generation_key_v1', 'prepare_device_credential_issuance_v1')
  loop
    if v_owner <> current_user then
      execute format('grant %I to %I', v_owner, current_user);
    end if;
  end loop;
end
$borrow_owners$;

do $direct$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)',
    'kitluy_devices.attempt_activate_device_v1(uuid,text,text)',
    'kitluy_devices.issue_development_device_certificate_v1(uuid,text,text)',
    'kitluy_devices.register_generation_key_v1(uuid,text,text,integer,text,text,text)',
    'kitluy_devices.abandon_generation_key_v1(uuid,text,text,integer,text)',
    'kitluy_devices.prepare_device_credential_issuance_v1(text,uuid,text,text,integer,text,text,text,text,text,text,bytea,boolean,text,timestamptz,text,text)']
  loop
    execute format('revoke execute on function %s from service_role', v_fn);
    execute format('revoke execute on function %s from anon', v_fn);
    execute format('revoke execute on function %s from authenticated', v_fn);
  end loop;
end
$direct$;

comment on role kitluy_issuance_gateway is
  'Group 0206 (C-4/D-07). NOINHERIT NOLOGIN hinge. Makes kitluy_issuance_service a capability the connection identity must ENTER rather than one it silently carries. Holds no privilege of its own.';
comment on role kitluy_activation_gateway is
  'Group 0206 (C-4/D-07). NOINHERIT NOLOGIN hinge for kitluy_activation_service. Separate from the issuance hinge so mint and consume authority can be withdrawn independently.';
comment on role kitluy_certificate_gateway is
  'Group 0206 (C-4/D-07). NOINHERIT NOLOGIN hinge for kitluy_device_certificate_issuer.';

do $hand_back_owners$
declare
  v_owner text;
begin
  for v_owner in
    select distinct pg_get_userbyid(p.proowner)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('record_operational_certificate_v1', 'attempt_activate_device_v1',
                         'issue_development_device_certificate_v1', 'register_generation_key_v1',
                         'abandon_generation_key_v1', 'prepare_device_credential_issuance_v1')
  loop
    if v_owner <> current_user then
      execute format('revoke %I from %I', v_owner, current_user);
    end if;
  end loop;
end
$hand_back_owners$;

-- -----------------------------------------------------------------------------
-- Prove the EFFECTIVE boundary on apply
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_fn      text;
  v_gateway text;
  v_doors   text[] := array[
    'kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)',
    'kitluy_devices.attempt_activate_device_v1(uuid,text,text)',
    'kitluy_devices.issue_development_device_certificate_v1(uuid,text,text)',
    'kitluy_devices.register_generation_key_v1(uuid,text,text,integer,text,text,text)',
    'kitluy_devices.abandon_generation_key_v1(uuid,text,text,integer,text)',
    'kitluy_devices.prepare_device_credential_issuance_v1(text,uuid,text,text,integer,text,text,text,text,text,text,bytea,boolean,text,timestamptz,text,text)'];
begin
  -- 1. Each hinge exists with the posture the whole correction depends on.
  --    NOINHERIT is the mechanism; asserting it is not a tautology.
  foreach v_gateway in array array['kitluy_issuance_gateway','kitluy_activation_gateway','kitluy_certificate_gateway'] loop
    if not exists (
      select 1 from pg_roles
       where rolname = v_gateway
         and not rolcanlogin and not rolinherit and not rolsuper
         and not rolcreaterole and not rolcreatedb and not rolbypassrls) then
      raise exception 'KLUY-MIGRATION-0206: % is missing or lacks the NOLOGIN/NOINHERIT posture the boundary depends on', v_gateway
        using errcode = 'P0001';
    end if;
  end loop;

  -- 2. EFFECTIVE privilege. This is the assertion every previous group should
  --    have made: `service_role` must not reach ANY of these doors without
  --    entering a role first.
  foreach v_fn in array v_doors loop
    if has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0206: service_role still reaches % — separation of duty is not real', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- 3. ...and the capability is not LOST, only gated. A boundary that broke the
  --    product would be reverted within the day and prove nothing.
  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0206: the issuance service lost its own door'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('kitluy_activation_service',
       'kitluy_devices.attempt_activate_device_v1(uuid,text,text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0206: the activation service lost its own door'
      using errcode = 'P0001';
  end if;

  -- 4. And `service_role` can still ENTER them, or the application stops.
  --    Membership is transitive through a NOINHERIT hinge for SET ROLE even
  --    though privileges do not flow.
  if not pg_has_role('service_role', 'kitluy_issuance_service', 'member')
     or not pg_has_role('service_role', 'kitluy_activation_service', 'member') then
    raise exception 'KLUY-MIGRATION-0206: service_role can no longer enter the governed roles at all'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0206: C-4/D-07 CLOSED — the connection identity must enter a role to mint or to activate, and cannot silently do both';
end
$guard$;

commit;
