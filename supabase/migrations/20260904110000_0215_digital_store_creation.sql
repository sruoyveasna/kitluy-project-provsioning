-- kitluy:migration:0215
--
-- DIGITAL STORE CREATION: the Admin creates the Store, the Partner never does
-- =============================================================================
-- Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 section 2 (the Admin
-- Platform creates the Digital Store, assigns the Partner/Tenant, sets the
-- Store business vertical, creates the applicable Location; the Partner does
-- not create a new Digital Store) and section 16 (Admin responsibilities);
-- program decision 6 default (single Admin with permission and audit in
-- development; four-eyes in pilot and production); KLD-2026-07-20-001 (Store
-- before Location); Admin Portal spec rules KL-AP3-CORE-003/004 and
-- KL-AP3-ONB-004.
--
-- WHAT EXISTED
-- ------------
-- kitluy_core.digital_stores and store_locations (group 0020) had no create
-- door: SELECT-only RLS for authenticated, no INSERT policy, and the only
-- writer was a development seed script. An Admin with platform scope holds no
-- digital_store scope, so even a direct read returned nothing.
--
-- WHAT THIS DOES
-- --------------
-- One SECURITY DEFINER door, granted to service_role only and reached by the
-- management API after kitluy_auth.has_permission decided the actor holds
-- store.digital_store.create. It creates the Store in DRAFT under the named
-- Tenant with one primary vertical from the reference registry, optionally the
-- first Location (Store before Location, in one transaction), optionally makes
-- the Store visible to the Tenant's EXISTING Partner staff by adding a
-- digital_store scope to their live DIGITAL_STORE_STAFF assignments, and
-- writes one audit row. Every refusal RAISES with a KLUY-STORE- prefix so the
-- whole insert rolls back.

begin;

-- -----------------------------------------------------------------------------
-- 1. The permission.
-- -----------------------------------------------------------------------------
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
select 'store.digital_store.create', 1, 'HIGH',
       array['tenant', 'digital_store'], array['all'], 'ACTIVE'
 where not exists (
   select 1 from kitluy_auth.permissions
    where permission_key = 'store.digital_store.create');

insert into kitluy_auth.role_permission_grants (role_template_id, permission_id, effect)
select rt.id, p.id, 'ALLOW'
  from kitluy_auth.role_templates rt
  join kitluy_auth.permissions p on p.permission_key = 'store.digital_store.create'
 where rt.role_key = 'HET_PLATFORM_ADMIN'
   and not exists (
     select 1 from kitluy_auth.role_permission_grants g
      where g.role_template_id = rt.id and g.permission_id = p.id);

-- -----------------------------------------------------------------------------
-- 2. The door.
-- -----------------------------------------------------------------------------
create or replace function kitluy_core.create_digital_store_v1(
  p_tenant_id uuid,
  p_store_code text,
  p_name text,
  p_primary_vertical_code text,
  p_first_location jsonb,
  p_actor_user_id uuid,
  p_reason text,
  p_environment text,
  p_grant_existing_partner_staff boolean default false,
  p_second_approver_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_core, kitluy_auth, kitluy_audit, extensions
as $create$
declare
  v_tenant kitluy_core.tenants;
  v_code text;
  v_name text;
  v_vertical text;
  v_store_id uuid;
  v_location_id uuid;
  v_location_code text;
  v_location_name text;
  v_granted integer := 0;
  v_audit_id uuid;
  v_after jsonb;
  v_key text;
begin
  if p_actor_user_id is null then
    raise exception 'KLUY-STORE-NO-ACTOR: a Digital Store is created by a named Admin'
      using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-STORE-NO-REASON: a reason is required to create a Digital Store'
      using errcode = 'P0001';
  end if;
  if p_environment is null or p_environment not in ('local', 'development', 'pilot', 'production') then
    raise exception 'KLUY-STORE-ENVIRONMENT: the environment must be named'
      using errcode = 'P0001';
  end if;

  -- Four-eyes outside development, exactly as device approval (0197).
  if p_environment in ('pilot', 'production') then
    if p_second_approver_ref is null or btrim(p_second_approver_ref) = '' then
      raise exception 'KLUY-STORE-FOUR-EYES-REQUIRED: this environment requires a second, different approver'
        using errcode = 'P0001';
    end if;
    if btrim(p_second_approver_ref) in (p_actor_user_id::text, 'admin/' || p_actor_user_id::text) then
      raise exception 'KLUY-STORE-FOUR-EYES-SAME-ACTOR: the second approver must be a different person'
        using errcode = 'P0001';
    end if;
  end if;

  -- The Tenant, locked: concurrent creates for one Tenant serialise here.
  select * into v_tenant from kitluy_core.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'KLUY-STORE-NO-TENANT: no such Tenant'
      using errcode = 'P0001';
  end if;
  if v_tenant.status in ('SUSPENDED', 'CLOSED', 'TERMINATED') then
    raise exception 'KLUY-STORE-TENANT-NOT-OPEN: the Tenant is %; a Store cannot be created under it', v_tenant.status
      using errcode = 'P0001';
  end if;

  v_code := upper(btrim(coalesce(p_store_code, '')));
  if v_code !~ '^[A-Z0-9][A-Z0-9-]{2,39}$' then
    raise exception 'KLUY-STORE-CODE-SHAPE: a store code is 3 to 40 characters of A-Z, 0-9 and hyphens'
      using errcode = 'P0001';
  end if;
  v_name := btrim(coalesce(p_name, ''));
  if length(v_name) not between 1 and 120 then
    raise exception 'KLUY-STORE-NAME-EMPTY: a Store name is 1 to 120 characters'
      using errcode = 'P0001';
  end if;

  -- The vertical comes from the reference registry, never from an enum here.
  v_vertical := upper(btrim(coalesce(p_primary_vertical_code, '')));
  if not exists (
    select 1 from kitluy_core.reference_values rv
     where rv.registry_key = 'vertical_code' and rv.value_code = v_vertical) then
    raise exception 'KLUY-STORE-VERTICAL-UNKNOWN: % is not a registered business vertical', v_vertical
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from kitluy_core.reference_values rv
     where rv.registry_key = 'vertical_code' and rv.value_code = v_vertical
       and rv.status = 'ACTIVE'
       and rv.effective_from <= now()
       and (rv.effective_to is null or rv.effective_to > now())) then
    raise exception 'KLUY-STORE-VERTICAL-NOT-ACTIVE: the business vertical % is not available in this phase', v_vertical
      using errcode = 'P0001';
  end if;

  -- The optional first Location: exactly the keys this door understands.
  if p_first_location is not null then
    if jsonb_typeof(p_first_location) <> 'object' then
      raise exception 'KLUY-STORE-LOCATION-SHAPE: the first Location must be an object'
        using errcode = 'P0001';
    end if;
    for v_key in select jsonb_object_keys(p_first_location) loop
      if v_key not in ('location_code', 'name', 'address_line1', 'city') then
        raise exception 'KLUY-STORE-LOCATION-SHAPE: unknown Location field %', v_key
          using errcode = 'P0001';
      end if;
    end loop;
    v_location_code := upper(btrim(coalesce(p_first_location ->> 'location_code', '')));
    v_location_name := btrim(coalesce(p_first_location ->> 'name', ''));
    if v_location_code !~ '^[A-Z0-9][A-Z0-9-]{1,39}$' then
      raise exception 'KLUY-STORE-LOCATION-SHAPE: a location code is 2 to 40 characters of A-Z, 0-9 and hyphens'
        using errcode = 'P0001';
    end if;
    if length(v_location_name) not between 1 and 120 then
      raise exception 'KLUY-STORE-LOCATION-SHAPE: a Location name is 1 to 120 characters'
        using errcode = 'P0001';
    end if;
  end if;

  -- The Store, in DRAFT, with the 0020 defaults for locale, currency and
  -- timezone. A duplicate code under this Tenant is refused by the unique key.
  begin
    insert into kitluy_core.digital_stores (tenant_id, store_code, name, primary_vertical_code)
    values (p_tenant_id, v_code, v_name, v_vertical)
    returning id into v_store_id;
  exception when unique_violation then
    raise exception 'KLUY-STORE-CODE-TAKEN: this Tenant already has a Store with code %', v_code
      using errcode = 'P0001';
  end;

  -- Store before Location, in one transaction (KLD-2026-07-20-001).
  if p_first_location is not null then
    insert into kitluy_core.store_locations
      (tenant_id, digital_store_id, location_code, name, address_line1, city, country_code, timezone)
    select p_tenant_id, v_store_id, v_location_code, v_location_name,
           nullif(btrim(coalesce(p_first_location ->> 'address_line1', '')), ''),
           nullif(btrim(coalesce(p_first_location ->> 'city', '')), ''),
           'KH', ds.timezone
      from kitluy_core.digital_stores ds where ds.id = v_store_id
    returning id into v_location_id;
    insert into kitluy_core.digital_store_location_links
      (tenant_id, digital_store_id, store_location_id, valid_from, reason_code)
    values (p_tenant_id, v_store_id, v_location_id, now(), 'INITIAL_CREATION');
  end if;

  -- Partner visibility, opt-in: every live DIGITAL_STORE_STAFF assignment that
  -- already holds a digital_store scope on a Store of THIS Tenant gains a scope
  -- on the new Store. Nobody gains a role; nobody outside the Tenant gains a
  -- Store. current_digital_store_ids() then includes it for them.
  if coalesce(p_grant_existing_partner_staff, false) then
    with staff as (
      select distinct ra.id as role_assignment_id
        from kitluy_auth.role_assignments ra
        join kitluy_auth.role_templates rt on rt.id = ra.role_template_id and rt.role_key = 'DIGITAL_STORE_STAFF'
        join kitluy_auth.assignment_scopes s on s.role_assignment_id = ra.id and s.scope_type = 'digital_store'
        join kitluy_core.digital_stores existing on existing.id = s.scope_id and existing.tenant_id = p_tenant_id
       where ra.status = 'ACTIVE'
         and ra.valid_from <= now()
         and (ra.valid_to is null or ra.valid_to > now())
    ), inserted as (
      insert into kitluy_auth.assignment_scopes
        (role_assignment_id, scope_type, scope_id, environment, include_descendants)
      select st.role_assignment_id, 'digital_store', v_store_id, 'all', false
        from staff st
       where not exists (
         select 1 from kitluy_auth.assignment_scopes x
          where x.role_assignment_id = st.role_assignment_id
            and x.scope_type = 'digital_store' and x.scope_id = v_store_id)
      returning 1
    )
    select count(*) into v_granted from inserted;
  end if;

  v_after := jsonb_build_object(
    'digital_store_id', v_store_id,
    'tenant_id', p_tenant_id,
    'store_code', v_code,
    'name', v_name,
    'primary_vertical_code', v_vertical,
    'status', 'DRAFT',
    'store_location_id', v_location_id,
    'location_code', v_location_code,
    'partner_staff_granted', v_granted,
    'second_approver_ref', nullif(btrim(coalesce(p_second_approver_ref, '')), ''));

  insert into kitluy_audit.audit_logs
    (tenant_id, digital_store_id, store_location_id, actor_type, actor_id, permission_key,
     action, resource_type, resource_id, environment, reason, after_hash)
  values
    (p_tenant_id, v_store_id, v_location_id, 'user', p_actor_user_id, 'store.digital_store.create',
     'digital_store.created', 'digital_store', v_store_id, p_environment, btrim(p_reason),
     encode(sha256(convert_to(v_after::text, 'UTF8')), 'hex'))
  returning id into v_audit_id;

  return jsonb_build_object(
    'outcome', 'CREATED',
    'digital_store_id', v_store_id,
    'tenant_id', p_tenant_id,
    'store_code', v_code,
    'name', v_name,
    'primary_vertical_code', v_vertical,
    'status', 'DRAFT',
    'store_location_id', v_location_id,
    'location_code', v_location_code,
    'partner_staff_granted', v_granted,
    'audit_event_id', v_audit_id);
end;
$create$;

comment on function kitluy_core.create_digital_store_v1 is
  'Group 0215. The Admin creates a Digital Store under a Tenant: one primary vertical from the reference registry (ACTIVE only), status DRAFT with the 0020 defaults, optionally the first Location in the same transaction (Store before Location), optionally a digital_store scope for the Tenant''s existing live DIGITAL_STORE_STAFF assignments, and one audit row. Requires a reason and, in pilot and production, a second distinct approver. Every refusal raises with a KLUY-STORE- prefix. Granted to service_role only; authorization (store.digital_store.create) is decided at the route before this door is reached.';

alter function kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)
  owner to postgres;
revoke all on function kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)
  to service_role;

-- -----------------------------------------------------------------------------
-- 3. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
begin
  if has_function_privilege('anon', 'kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0215: a browser-reachable role can create a Digital Store'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('service_role', 'kitluy_core.create_digital_store_v1(uuid, text, text, text, jsonb, uuid, text, text, boolean, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0215: service_role cannot reach the creation door'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_core' and p.proname = 'create_digital_store_v1'
       and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'KLUY-MIGRATION-0215: the creation door is not a definer owned by postgres'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from kitluy_auth.role_permission_grants g
      join kitluy_auth.role_templates rt on rt.id = g.role_template_id
      join kitluy_auth.permissions p on p.id = g.permission_id
     where rt.role_key = 'HET_PLATFORM_ADMIN'
       and p.permission_key = 'store.digital_store.create' and g.effect = 'ALLOW') then
    raise exception 'KLUY-MIGRATION-0215: HET_PLATFORM_ADMIN does not hold store.digital_store.create'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from kitluy_auth.role_permission_grants g
      join kitluy_auth.role_templates rt on rt.id = g.role_template_id
      join kitluy_auth.permissions p on p.id = g.permission_id
     where rt.role_key = 'DIGITAL_STORE_STAFF'
       and p.permission_key = 'store.digital_store.create') then
    raise exception 'KLUY-MIGRATION-0215: a Partner role holds Store creation'
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0215: Digital Store creation door applied (Admin only, DRAFT, vertical from the registry, audit row, four-eyes outside development)';
end
$guard$;

commit;
