-- kitluy:migration:0193
--
-- GOVERNED STORE HUB PAIRING-CODE ISSUANCE
-- =============================================================================
-- Authority: KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001 (group 0191) and
-- KLD-2026-08-13-HUB-PAIRING-ROUTE-001 (group 0192); the owner decision
-- "Partner can create Store Hub pairing session"; pairing protocol §6.1.
--
-- This is the OTHER half of pairing. Group 0191 gave the code its rules, 0192
-- gave the device a way to present one — and nothing could ISSUE one, because
-- `create_device_claim_v1` is granted to `postgres`, `service_role` and
-- `kitluy_activation_governor` only. A Partner Portal is a browser: it holds an
-- `authenticated` session and cannot reach any of those.
--
-- WHY A PERMISSION AND NOT JUST A GRANT
-- -------------------------------------
-- Issuing a pairing code creates the authority to attach a Store Hub to a
-- Digital Store. That is a CRITICAL fleet action, exactly like its terminal
-- counterpart `fleet.device_provisioning_code.issue` (group 0163), and it must be
-- authorized per actor and per resource rather than by possession of a session.
-- So this group adds the permission key, grants it to the partner-side role
-- template that already exists, and leaves the decision to
-- `kitluy_auth.has_permission(...)`.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does not widen `create_device_claim_v1`'s own grants, and it does not touch
-- the TTL argument of that shared door. The fifteen-minute ceiling is a ROW
-- constraint from 0191 (`device_claims_ttl_chk`) and stays the only enforcement
-- point, so an issuer that asks for longer is refused by the table rather than by
-- a caller's good manners.
--
-- It also grants nothing to `anon`. A pairing code is the authority to claim a
-- Hub; an unauthenticated caller must never mint one.

begin;

-- Ownership borrow, same as groups 0125-0192.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The permission.
-- -----------------------------------------------------------------------------
-- CRITICAL, matching the terminal issuance permission: both create the authority
-- to attach a device to a Store, and neither is reversible by simply deleting a
-- row (a redeemed claim has already produced an assignment).
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
select 'fleet.hub_pairing_code.issue', 1, 'CRITICAL',
       array['device', 'device_claim'], array['all'], 'ACTIVE'
 where not exists (
   select 1 from kitluy_auth.permissions
    where permission_key = 'fleet.hub_pairing_code.issue');

-- Granted to the PARTNER-side role template, which already exists: the RBAC model
-- has contemplated Digital Store staff since the role templates were seeded, and
-- `assignment_scopes` already carries `digital_store` scoping. Nothing new is
-- invented here — the permission simply joins a role that was always meant to
-- hold Store-level authority.
insert into kitluy_auth.role_permission_grants (role_template_id, permission_id, effect)
select rt.id, p.id, 'ALLOW'
  from kitluy_auth.role_templates rt
  join kitluy_auth.permissions p on p.permission_key = 'fleet.hub_pairing_code.issue'
 where rt.role_key = 'DIGITAL_STORE_STAFF'
   and not exists (
     select 1 from kitluy_auth.role_permission_grants g
      where g.role_template_id = rt.id and g.permission_id = p.id);

-- -----------------------------------------------------------------------------
-- 2. The issuance composition identity.
-- -----------------------------------------------------------------------------
-- Same reasoning as `kitluy_hub_pairing_service` (0192), for the opposite
-- direction of the flow. The route that issues a code is staff-authenticated, so
-- it is less exposed than the device-facing one — but it still must not run as
-- `service_role`, which holds BYPASSRLS and could read or write every table in
-- the database if any check above it were bypassed.
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_hub_issuance_service') then
    create role kitluy_hub_issuance_service nologin;
  end if;
end
$role$;

comment on role kitluy_hub_issuance_service is
  'Group 0193. The Store Hub pairing-code issuance identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the management API connecting as service_role, exactly like kitluy_hub_pairing_service (0192) and kitluy_provisioning_service (0172). Holds EXECUTE on exactly one capability — issue_hub_claim_v1 — and NOTHING else: no table access, no redemption, no revocation, no presentation evaluator. Authorization is decided BEFORE this role is entered, by kitluy_auth.has_permission(fleet.hub_pairing_code.issue, ...) against the caller''s own auth.uid(); this identity exists only so the governed door can be reached without granting the API BYPASSRLS.';

grant kitluy_hub_issuance_service to service_role;
grant usage on schema kitluy_devices to kitluy_hub_issuance_service;

-- -----------------------------------------------------------------------------
-- 3. The issuance bridge.
-- -----------------------------------------------------------------------------
-- `create_device_claim_v1` is not a SECURITY DEFINER — it runs as its caller and
-- writes `device_claims` directly — so a least-privilege role cannot use it. The
-- same problem group 0192 solved for redemption, solved the same way and for the
-- same reason: wrapping is additive, while converting the 0121 door would change
-- a shared function with roughly two dozen integration callers and the whole
-- terminal path.
--
-- The bridge adds NO authority. It does not choose the TTL, the scope or the
-- digests — every one of those is an argument, decided by the caller and then
-- validated by 0121 and by 0191's row constraint. It exists to cross a privilege
-- boundary, not to make a decision.
create or replace function kitluy_devices.issue_hub_claim_v1(
  p_device_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_claim_token_sha256 text,
  p_payload_sha256 text,
  p_ttl_seconds integer,
  p_operator_ref text
) returns uuid
language sql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
  select kitluy_devices.create_device_claim_v1(
           p_device_id, p_tenant_id, p_digital_store_id, p_store_location_id,
           p_claim_token_sha256, p_payload_sha256, p_ttl_seconds, p_operator_ref)
$$;

comment on function kitluy_devices.issue_hub_claim_v1 is
  'Group 0193. A SECURITY DEFINER privilege bridge to create_device_claim_v1 (0121), which is not a definer and therefore requires its caller to hold direct table privileges. Exists so the governed issuance route can mint a Store Hub pairing code while holding NO table access of its own. Adds no authority and makes no decision: TTL, scope and digests are all arguments, validated by 0121 and by 0191''s fifteen-minute row constraint (device_claims_ttl_chk). Granted to kitluy_hub_issuance_service ONLY. Authorization happens BEFORE this is reached, against the caller''s own auth.uid().';

alter function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text)
  owner to postgres;
revoke all on function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text) from public;
revoke all on function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text) from anon;
revoke all on function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text) from authenticated;
grant execute on function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text)
  to kitluy_hub_issuance_service;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 4. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
begin
  if not exists (
    select 1 from pg_roles where rolname = 'kitluy_hub_issuance_service' and not rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0193: the issuance role is missing or can log in'
      using errcode = 'P0001';
  end if;

  -- A member of nothing: it cannot inherit its way to another capability.
  if exists (
    select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_hub_issuance_service')) then
    raise exception 'KLUY-MIGRATION-0193: the issuance role must be a member of NOTHING'
      using errcode = 'P0001';
  end if;

  -- EXACTLY one capability. Trigger functions are excluded because they are not
  -- capabilities: a `returns trigger` function raises when called outside a
  -- trigger, so reaching one grants nothing (same exclusion as group 0192).
  select count(*) into v_extra
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_hub_issuance_service', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname <> 'issue_hub_claim_v1';
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0193: the issuance role can execute % function(s) beyond its one capability', v_extra
      using errcode = 'P0001';
  end if;

  -- It must NOT be able to redeem, present or revoke. Issuing a code and
  -- consuming one are different authorities, and one identity holding both would
  -- be able to pair a Hub to a Store with no human in the loop at all.
  if has_function_privilege('kitluy_hub_issuance_service', 'kitluy_devices.redeem_device_claim_v1(text, text, uuid, text)', 'execute')
     or has_function_privilege('kitluy_hub_issuance_service', 'kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0193: the issuance role can also consume a claim'
      using errcode = 'P0001';
  end if;

  -- No table reach whatsoever.
  if has_table_privilege('kitluy_hub_issuance_service', 'kitluy_devices.device_claims', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_issuance_service', 'kitluy_devices.devices', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0193: the issuance role holds direct table access'
      using errcode = 'P0001';
  end if;

  -- The bridge must be a definer owned by a role that can write, or it bridges
  -- nothing and issuance fails on its first statement.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'issue_hub_claim_v1'
       and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'KLUY-MIGRATION-0193: the issuance bridge is not a definer owned by postgres'
      using errcode = 'P0001';
  end if;

  -- A browser must not reach the bridge directly. The route decides authority
  -- first; the bridge is not the authorization point.
  if has_function_privilege('anon', 'kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0193: a browser-reachable role can execute the issuance bridge'
      using errcode = 'P0001';
  end if;

  -- The permission exists and the partner role holds it.
  if not exists (
    select 1 from kitluy_auth.role_permission_grants g
      join kitluy_auth.role_templates rt on rt.id = g.role_template_id
      join kitluy_auth.permissions p on p.id = g.permission_id
     where rt.role_key = 'DIGITAL_STORE_STAFF'
       and p.permission_key = 'fleet.hub_pairing_code.issue'
       and g.effect = 'ALLOW') then
    raise exception 'KLUY-MIGRATION-0193: DIGITAL_STORE_STAFF does not hold the issuance permission'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0193: hub pairing-code issuance applied (one capability, no table reach, no consumption)';
end
$guard$;

commit;
