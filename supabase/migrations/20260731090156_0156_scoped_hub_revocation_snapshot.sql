-- kitluy:group:0156
-- Migration group 0156: scoped_hub_revocation_snapshot.
--
-- Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001 (owner-locked snapshot
-- isolation: exactly one Tenant, Digital Store, Location and environment per
-- snapshot; no cross-Tenant or cross-Store data); KLD-2026-07-28-002 §6;
-- WS-11-T003 Step 4 final offline completion §3.
--
-- ===========================================================================
-- WHY THE ISOLATION IS ENFORCED HERE AND NOT IN TYPESCRIPT
-- ===========================================================================
-- Group 0155's `revoked_certificate_serials_v1` is ENVIRONMENT-WIDE. A snapshot
-- built from it and then labelled for one Store carries every tenant's revoked
-- serials to that Store's Hub — which an independent reviewer identified as a
-- cross-tenant disclosure, and which the owner has now ruled against outright.
--
-- Filtering in the producer would have worked and would have been the wrong
-- place: the producer is the component whose bug would cause the leak, so it
-- cannot also be the component that prevents it. These bridges take the scope as
-- ARGUMENTS and filter inside the database, so a producer that asked for the
-- wrong thing gets the wrong thing and nothing more — never everything.
--
-- ===========================================================================
-- WHAT "RELEVANT TO THAT HUB" MEANS
-- ===========================================================================
-- A credential is in scope when the device holding it has an assignment to the
-- SAME Tenant, Digital Store and Location, and the credential is in the same
-- environment. Assignment is the authoritative provisioning record; a caller's
-- claim about ownership is never consulted.
--
-- Additive. Groups 0136-0155 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- TWO owners are borrowed, because the isolation join spans two custody domains
-- and neither role may be widened to cover the other.
--
--   `device_assignments` (the provisioning record) is readable by
--   `kitluy_activation_governor` - it holds the SELECT grant AND the two RLS
--   policies, and group 0152's `emergency_device_tenancy_v1` is owned by it for
--   exactly this reason.
--
--   `device_credentials` is readable by `kitluy_credential_issuer`.
--
-- Granting either role the other's table would flatten a boundary the schema
-- deliberately keeps. So the scope side is owned by the activation governor, the
-- credential side by the credential issuer, and the credential side CALLS the
-- scope side. Least privilege on both, composed.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. AUTHORITATIVE SCOPE FOR ONE STORE HUB
-- ---------------------------------------------------------------------------
-- WHICH ASSIGNMENT DEFINES A SCOPE
--
-- `pending_trust` OR `active`, and NOT `active` alone. Activation is gated on
-- BLK-005, so no device in this repository is `active` yet: scoping to `active`
-- only would mean no Hub could ever receive a revocation snapshot until the PKI
-- ballot is implemented, which would make offline containment wait on an
-- unrelated decision.
--
-- `pending_trust` is a CURRENT binding — the device has been claimed and redeemed
-- to this Tenant/Store/Location and is simply not activated. `superseded` and
-- `revoked` are provisioning HISTORY, and building a snapshot from either would
-- send a Hub the scope it used to have.

-- Returns NULL for a device that is not provisioned. A caller cannot tell the
-- difference between "no such device" and "not assigned", and should not: both
-- mean "this Hub has no scope, so no snapshot may be produced for it".
create or replace function kitluy_devices.hub_revocation_scope_v1(
  p_hub_device_id uuid
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $hub_scope$
  select case when a.device_id is null then null else jsonb_build_object(
           'hub_device_record_id', a.device_id,
           'tenant_id', a.tenant_id,
           'digital_store_id', a.digital_store_id,
           'store_location_id', a.store_location_id,
           'assignment_generation', a.assignment_generation,
           'assignment_state', a.state)
         end
    from kitluy_devices.device_assignments a
   where a.device_id = p_hub_device_id
     and a.state in ('pending_trust', 'active')
   order by a.assignment_generation desc
   limit 1;
$hub_scope$;

-- ACTIVATION GOVERNOR: it owns assignment reads (group 0152 precedent).
--
-- Group 0152's `emergency_device_tenancy_v1` reads the same table under the same
-- owner, so this is the proven arrangement rather than a new one.
alter function kitluy_devices.hub_revocation_scope_v1(uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.hub_revocation_scope_v1(uuid) from public;
grant execute on function kitluy_devices.hub_revocation_scope_v1(uuid)
  to kitluy_issuance_service;

comment on function kitluy_devices.hub_revocation_scope_v1(uuid) is
  'Group 0156. Authoritative Tenant/Digital Store/Location for ONE Store Hub, from its ACTIVE assignment. NULL when the device is absent or unprovisioned, so no snapshot can be produced for it. Never consults caller-supplied ownership.';

-- ---------------------------------------------------------------------------
-- 1b. THE DEVICE SETS FOR ONE SCOPE (assignment custody)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.devices_in_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid
) returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $in_scope$
  select a.device_id
    from kitluy_devices.device_assignments a
   where p_tenant_id is not null
     and p_digital_store_id is not null
     and p_store_location_id is not null
     and a.state in ('pending_trust', 'active')
     and a.tenant_id = p_tenant_id
     and a.digital_store_id = p_digital_store_id
     and a.store_location_id = p_store_location_id;
$in_scope$;

alter function kitluy_devices.devices_in_scope_v1(uuid, uuid, uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.devices_in_scope_v1(uuid, uuid, uuid) from public;
grant execute on function kitluy_devices.devices_in_scope_v1(uuid, uuid, uuid)
  to kitluy_credential_issuer;
grant execute on function kitluy_devices.devices_in_scope_v1(uuid, uuid, uuid)
  to kitluy_issuance_service;

comment on function kitluy_devices.devices_in_scope_v1(uuid, uuid, uuid) is
  'Group 0156. Device ids ACTIVELY assigned to exactly one Tenant/Store/Location. Owned by kitluy_activation_governor, which holds assignment custody; called by the credential-side bridges so neither role needs the other table.';

create or replace function kitluy_devices.retired_devices_in_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid
) returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $retired_in_scope$
  -- `retired` ONLY, matching DEVICE_REVOKING_LIFECYCLE_STATES. Widening stays an
  -- owner decision.
  select d.id
    from kitluy_devices.devices d
   where d.lifecycle_state::text = any (array['retired'])
     and d.id in (select kitluy_devices.devices_in_scope_v1(
                    p_tenant_id, p_digital_store_id, p_store_location_id));
$retired_in_scope$;

alter function kitluy_devices.retired_devices_in_scope_v1(uuid, uuid, uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.retired_devices_in_scope_v1(uuid, uuid, uuid) from public;
grant execute on function kitluy_devices.retired_devices_in_scope_v1(uuid, uuid, uuid)
  to kitluy_issuance_service;
-- ...and to the CREDENTIAL issuer, because `revoked_devices_for_scope_v1` is owned
-- by it and delegates here. Inside a definer the caller is the OWNER, not the
-- session role, so granting only the session role left the delegation refused.
grant execute on function kitluy_devices.retired_devices_in_scope_v1(uuid, uuid, uuid)
  to kitluy_credential_issuer;

comment on function kitluy_devices.retired_devices_in_scope_v1(uuid, uuid, uuid) is
  'Group 0156. Retired device ids within exactly one scope. Owned by kitluy_activation_governor.';

-- ---------------------------------------------------------------------------
-- 2. REVOKED SERIALS FOR EXACTLY ONE SCOPE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoked_serials_for_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text
) returns setof text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $scoped_serials$
  -- Every predicate is REQUIRED. A null argument matches nothing rather than
  -- everything: the SQL-standard behaviour of `= null` is already false, and the
  -- explicit `is not null` guards below make that a decision rather than an
  -- accident, so a producer that forgot to pass a Tenant gets an empty set and
  -- not the whole fleet.
  select c.serial_number
    from kitluy_devices.device_credentials c
   where coalesce(btrim(p_environment), '') <> ''
     and c.environment = p_environment
     and (c.state = 'revoked' or c.revoked_at is not null)
     and c.device_record_id in (select kitluy_devices.devices_in_scope_v1(
           p_tenant_id, p_digital_store_id, p_store_location_id));
$scoped_serials$;

alter function kitluy_devices.revoked_serials_for_scope_v1(uuid, uuid, uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoked_serials_for_scope_v1(uuid, uuid, uuid, text)
  from public;
grant execute on function kitluy_devices.revoked_serials_for_scope_v1(uuid, uuid, uuid, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.revoked_serials_for_scope_v1(uuid, uuid, uuid, text) is
  'Group 0156. Revoked certificate serials for EXACTLY one Tenant/Store/Location/environment, joined through the ACTIVE device assignment. A null or blank argument yields the EMPTY set, never the whole fleet. Owner-locked snapshot isolation (KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001).';

-- ---------------------------------------------------------------------------
-- 3. REVOKED DEVICES FOR EXACTLY ONE SCOPE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoked_devices_for_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text
) returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $scoped_devices$
  -- `retired` ONLY, matching DEVICE_REVOKING_LIFECYCLE_STATES in the library.
  -- Widening the set stays an owner decision.
  -- Delegates to the assignment-custody bridge. `p_environment` is required for
  -- signature symmetry with the serial bridge and is validated, but device
  -- lifecycle is not environment-scoped in this schema.
  select kitluy_devices.retired_devices_in_scope_v1(
           p_tenant_id, p_digital_store_id, p_store_location_id)
   where coalesce(btrim(p_environment), '') <> '';
$scoped_devices$;

alter function kitluy_devices.revoked_devices_for_scope_v1(uuid, uuid, uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoked_devices_for_scope_v1(uuid, uuid, uuid, text)
  from public;
grant execute on function kitluy_devices.revoked_devices_for_scope_v1(uuid, uuid, uuid, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.revoked_devices_for_scope_v1(uuid, uuid, uuid, text) is
  'Group 0156. Retired device ids for EXACTLY one Tenant/Store/Location/environment. Same isolation rule and same empty-set-on-null behaviour as the serial bridge.';

-- ---------------------------------------------------------------------------
-- 4. REVOCATION WATERMARK FOR ONE SCOPE
-- ---------------------------------------------------------------------------
-- Lets a Hub say WHAT it has rather than only WHEN it was built: the highest
-- revocation instant inside its own scope. Deliberately not a global sequence —
-- a global counter would tell every Hub how much revocation activity exists
-- elsewhere in the fleet.
create or replace function kitluy_devices.revocation_watermark_for_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text
) returns text
language sql
stable
security definer
set search_path = pg_catalog, kitluy_devices
as $watermark$
  select coalesce(
           to_char(max(c.revoked_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           '1970-01-01T00:00:00.000Z')
    from kitluy_devices.device_credentials c
   where coalesce(btrim(p_environment), '') <> ''
     and c.environment = p_environment
     and c.revoked_at is not null
     and c.device_record_id in (select kitluy_devices.devices_in_scope_v1(
           p_tenant_id, p_digital_store_id, p_store_location_id));
$watermark$;

alter function kitluy_devices.revocation_watermark_for_scope_v1(uuid, uuid, uuid, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revocation_watermark_for_scope_v1(uuid, uuid, uuid, text)
  from public;
grant execute on function kitluy_devices.revocation_watermark_for_scope_v1(uuid, uuid, uuid, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.revocation_watermark_for_scope_v1(uuid, uuid, uuid, text) is
  'Group 0156. Highest revocation instant WITHIN one scope, or the epoch when the scope has none. Scoped rather than global so a snapshot cannot leak fleet-wide activity levels to one Store.';

-- ---------------------------------------------------------------------------
-- 5. CAPABILITY CENSUS
-- ---------------------------------------------------------------------------
do $census$
declare
  v_name text;
  v_oid oid;
  v_leaked text;
  c_created constant text[] := array[
    'hub_revocation_scope_v1',
    'devices_in_scope_v1',
    'retired_devices_in_scope_v1',
    'revoked_serials_for_scope_v1',
    'revoked_devices_for_scope_v1',
    'revocation_watermark_for_scope_v1'];
begin
  foreach v_name in array c_created loop
    select p.oid into v_oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = v_name;
    if v_oid is null then
      raise exception 'KLUY-MIGRATION-0156: group 0156 did not create %', v_name
        using errcode = 'P0001';
    end if;

    if not has_function_privilege('kitluy_issuance_service', v_oid, 'execute') then
      raise exception 'KLUY-MIGRATION-0156: issuance cannot execute %', v_name
        using errcode = 'P0001';
    end if;

    -- The producer runs as issuance; the WORKER has no business reading
    -- revocation sets (decision §2.5), and neither `anon` nor `authenticated`
    -- may enumerate a Store's revoked serials.
    if has_function_privilege('kitluy_worker_service', v_oid, 'execute')
       or has_function_privilege('anon', v_oid, 'execute')
       or has_function_privilege('authenticated', v_oid, 'execute') then
      raise exception
        'KLUY-MIGRATION-0156: % is reachable by worker/anon/authenticated; these bridges are issuance-only',
        v_name
        using errcode = 'P0001';
    end if;

    if (select count(*) from pg_proc p
         where p.oid = v_oid
           and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/')) > 0 then
      raise exception 'KLUY-MIGRATION-0156: % is executable by PUBLIC', v_name
        using errcode = 'P0001';
    end if;
  end loop;

  -- No table privilege was conferred along the way.
  select string_agg(format('%s:%s', c.relname, x.privilege_type), ', ' order by c.relname)
    into v_leaked
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(c.relacl) as x
   where n.nspname = 'kitluy_devices'
     and c.relkind in ('r', 'p', 'v', 'm')
     and c.relacl is not null
     and x.grantee = 'kitluy_worker_service'::regrole::oid;
  if v_leaked is not null then
    raise exception 'KLUY-MIGRATION-0156: worker gained table privileges (%)', v_leaked
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0156: four scoped snapshot bridges created, issuance-only, no PUBLIC/worker/anon/authenticated reach, no table privilege conferred';
end
$census$;

-- ---------------------------------------------------------------------------
-- 6. ISOLATION PROVED, NOT ASSERTED
-- ---------------------------------------------------------------------------
-- The census proves who can CALL. This proves what the call RETURNS: a scope
-- that exists in no assignment must yield nothing, and a null argument must
-- yield nothing rather than everything. Both run as the real caller.
do $isolation$
declare
  v_absent bigint;
  v_null_scope bigint;
  v_total_revoked bigint;
begin
  select count(*) into v_total_revoked
    from kitluy_devices.device_credentials
   where state = 'revoked' or revoked_at is not null;

  set role kitluy_issuance_service;
  select count(*) into v_absent
    from kitluy_devices.revoked_serials_for_scope_v1(
      '00000000-0000-4000-8000-0000000f0001'::uuid,
      '00000000-0000-4000-8000-0000000f0002'::uuid,
      '00000000-0000-4000-8000-0000000f0003'::uuid,
      'development');
  select count(*) into v_null_scope
    from kitluy_devices.revoked_serials_for_scope_v1(null, null, null, 'development');
  reset role;

  if v_absent <> 0 then
    raise exception
      'KLUY-MIGRATION-0156: a scope present in no assignment returned % serial(s)', v_absent
      using errcode = 'P0001';
  end if;

  -- THE IMPORTANT ONE. If a null scope returned the fleet, every producer bug
  -- would become a cross-tenant disclosure.
  if v_null_scope <> 0 then
    raise exception
      'KLUY-MIGRATION-0156: a NULL scope returned % serial(s); it must return none, not everything',
      v_null_scope
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0156: isolation proved as kitluy_issuance_service — absent scope 0, null scope 0, against % revoked credential(s) in the database',
    v_total_revoked;
end
$isolation$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;
