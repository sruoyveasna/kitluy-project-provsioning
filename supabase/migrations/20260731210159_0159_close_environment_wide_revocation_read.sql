-- kitluy:group:0159
-- Migration group 0159: close_environment_wide_revocation_read.
--
-- Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (one Tenant / Digital Store
-- / Location / environment per snapshot); WS-11-T003 Step 4 §4.
--
-- ===========================================================================
-- THE LEAK THIS CLOSES
-- ===========================================================================
-- Group 0155 gave `revoked_certificate_serials_v1` and `revoked_device_records_v1`
-- an OPTIONAL device argument, defaulting to null, so calling them with no device
-- returned the WHOLE ENVIRONMENT. That is what the online verifier needs made
-- narrow (it always passes a device) and what a snapshot builder must never have.
--
-- Independent review found the consequence still shipped: a builder took a
-- Tenant/Store/Location scope as an ARGUMENT, read the environment-wide set, and
-- stamped the caller's scope onto the digest. Delivered to that Store's Hub, the
-- scope matched and the digest recomputed, so every integrity check passed --
-- while the payload carried OTHER tenants' revoked certificate serials. Group
-- 0156 added correctly scoped bridges but was purely additive: it never took the
-- environment-wide mode away.
--
-- Deleting the TypeScript builder is not sufficient. As long as the capability
-- exists, the next caller re-creates the leak, and the database is where a
-- capability is actually withdrawn.
--
-- ===========================================================================
-- WHAT CHANGES
-- ===========================================================================
-- The device argument becomes REQUIRED IN BEHAVIOUR: a null is refused with a
-- named error instead of being read as "all of them". The SIGNATURE is unchanged
-- so no caller breaks at bind time, and the default is dropped so a caller cannot
-- omit the argument by accident and only discover it at runtime.
--
-- Snapshot production keeps working: it goes through group 0156's
-- `revoked_serials_for_scope_v1` / `revoked_devices_for_scope_v1`, which filter
-- by Tenant, Store, Location and environment INSIDE the database and return the
-- EMPTY set for an unresolved scope (0156 proves both on apply).
--
-- Additive. Groups 0136-0158 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- Ownership borrow, same as groups 0125-0155: the applying role is not a member
-- of the NOLOGIN definer owner (`kitluy_credential_issuer`, set by group 0155),
-- so `create or replace function` would fail `42501 must be owner of function`
-- on a from-zero replay. Membership is taken here and handed back at the end of
-- this file; the applying role keeps no privilege the owner did not already
-- have. (The first version of this group omitted the borrow; it had only ever
-- been applied incrementally to a disposable local volume, where the defect was
-- invisible. Canonical from-zero replay exposed it.)
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- The 0155 originals carry `default null` on the device argument, and
-- `create or replace` cannot REMOVE a parameter default (`42P13 cannot remove
-- parameter defaults from existing function`). Removing the default is the
-- point of this group, so the functions are dropped and recreated instead.
-- Nothing in the database depends on them (the only callers are application
-- code), and the grants and comments are restated below, so nothing a caller
-- can observe is lost. Ownership returns to `kitluy_credential_issuer` via the
-- borrow above: the applying role is a member while it recreates them.
drop function kitluy_devices.revoked_certificate_serials_v1(text, uuid);
drop function kitluy_devices.revoked_device_records_v1(text, uuid);

create or replace function kitluy_devices.revoked_certificate_serials_v1(
  p_environment text,
  p_device_record_id uuid
) returns setof text
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $serials$
begin
  -- REFUSED, not silently widened. "Every revoked serial in the environment" is
  -- a cross-tenant answer, and no caller of this bridge is entitled to one.
  if p_device_record_id is null then
    raise exception
      'KLUY-REVOCATION-READ-UNSCOPED: revoked_certificate_serials_v1 requires a device; use kitluy_devices.revoked_serials_for_scope_v1 for a Hub scope'
      using errcode = '42501';
  end if;
  if p_environment is null or btrim(p_environment) = '' then
    raise exception 'KLUY-REVOCATION-READ-NO-ENVIRONMENT: an environment is required'
      using errcode = '42501';
  end if;

  return query
    select c.serial_number
      from kitluy_devices.device_credentials c
     where c.environment = p_environment
       and c.revoked_at is not null
       and c.device_record_id = p_device_record_id;
end
$serials$;

create or replace function kitluy_devices.revoked_device_records_v1(
  p_environment text,
  p_device_record_id uuid
) returns setof uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $devices$
begin
  if p_device_record_id is null then
    raise exception
      'KLUY-REVOCATION-READ-UNSCOPED: revoked_device_records_v1 requires a device; use kitluy_devices.revoked_devices_for_scope_v1 for a Hub scope'
      using errcode = '42501';
  end if;

  -- `retired` ONLY, unchanged from group 0155: `suspended`, `quarantined` and
  -- `restricted_investigation` are reversible operational gates, and certificate
  -- validity has no way to express "temporarily".
  return query
    select d.id
      from kitluy_devices.devices d
     where d.lifecycle_state::text = any (array['retired'])
       and d.id = p_device_record_id;
end
$devices$;

-- The drop above discarded ownership along with the defaults; hand both
-- functions back to the NOLOGIN definer owner group 0155 established (the
-- borrow at the top of this file makes the applying role a member).
alter function kitluy_devices.revoked_certificate_serials_v1(text, uuid)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.revoked_device_records_v1(text, uuid)
  owner to kitluy_credential_issuer;

-- Grants were discarded by the drop, so they are restated so a reader can see
-- the intended surface without consulting the catalogue. UNCHANGED from 0155 --
-- this migration withdraws a MODE, not a caller.
revoke all on function kitluy_devices.revoked_certificate_serials_v1(text, uuid) from public;
revoke all on function kitluy_devices.revoked_device_records_v1(text, uuid) from public;
grant execute on function kitluy_devices.revoked_certificate_serials_v1(text, uuid)
  to kitluy_issuance_service;
grant execute on function kitluy_devices.revoked_device_records_v1(text, uuid)
  to kitluy_issuance_service;

comment on function kitluy_devices.revoked_certificate_serials_v1(text, uuid) is
  'Group 0159. Revoked certificate serials for ONE device in one environment. A null device is REFUSED (KLUY-REVOCATION-READ-UNSCOPED): the environment-wide mode group 0155 allowed was a cross-tenant read, and Hub snapshots must use revoked_serials_for_scope_v1 instead.';
comment on function kitluy_devices.revoked_device_records_v1(text, uuid) is
  'Group 0159. Retired device records for ONE device. A null device is REFUSED; use revoked_devices_for_scope_v1 for a Hub scope.';

-- ---------------------------------------------------------------------------
-- PROVE THE UNSCOPED MODE IS GONE AND THE SCOPED ONE STILL WORKS
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_refused boolean := false;
  v_scoped_ok boolean := false;
  v_default_gone boolean;
begin
  -- 1. The environment-wide read is refused, as the REAL caller.
  -- The grant goes through `execute format(...)` like the borrows in groups
  -- 0147-0155: the STATIC form `grant kitluy_issuance_service to current_user`
  -- segfaults this PostgreSQL build (signal 11) when the session already holds
  -- the `kitluy_credential_issuer` membership borrowed above. The dynamic form
  -- is byte-identical in effect and does not crash.
  begin
    execute format('grant kitluy_issuance_service to %I', current_user);
  exception when others then null;
  end;

  begin
    perform 1 from kitluy_devices.revoked_certificate_serials_v1('development', null) limit 1;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception
      'KLUY-MIGRATION-0159: the unscoped environment-wide revocation read is still reachable'
      using errcode = 'P0001';
  end if;

  -- 2. No default remains, so the argument cannot be omitted.
  select not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'revoked_certificate_serials_v1'
       and p.pronargdefaults > 0)
    into v_default_gone;
  if not v_default_gone then
    raise exception
      'KLUY-MIGRATION-0159: the device argument still has a default, so it can be omitted'
      using errcode = 'P0001';
  end if;

  -- 3. The SCOPED bridges group 0156 added still answer, so snapshot production
  --    is not broken by this change.
  begin
    perform 1 from kitluy_devices.revoked_serials_for_scope_v1(
      null::uuid, null::uuid, null::uuid, 'development') limit 1;
    v_scoped_ok := true;
  exception when others then
    v_scoped_ok := false;
  end;
  if not v_scoped_ok then
    raise exception
      'KLUY-MIGRATION-0159: the scoped replacement bridge is not callable'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0159: the environment-wide revocation read is refused; the scoped bridges remain callable';
end
$guard$;

-- ---------------------------------------------------------------------------
-- HAND BACK THE BORROW
-- ---------------------------------------------------------------------------
-- The census above borrowed `kitluy_issuance_service` to call as the real caller.
-- Leaving a LOGIN role a member of a NOLOGIN authority is exactly the leak
-- KLRISK-DEVICE-011 records, so it is returned here rather than left behind.
do $hand_back$
begin
  if pg_has_role(current_user, 'kitluy_issuance_service', 'MEMBER') then
    execute format('revoke kitluy_issuance_service from %I', current_user);
  end if;
exception when others then
  raise notice 'KLUY-MIGRATION-0159: could not hand back kitluy_issuance_service (%)', sqlerrm;
end
$hand_back$;

-- Hand back the ownership borrow taken at the top of this file, unconditionally,
-- the way groups 0147-0155 do: a login-capable role left holding
-- `kitluy_credential_issuer` could `set role` to the NOLOGIN owner of every
-- governed door and execute them directly (KLRISK-DEVICE-011 class).
do $hand_back_owner$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back_owner$;
