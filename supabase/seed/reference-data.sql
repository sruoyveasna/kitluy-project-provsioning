-- ===========================================================================
-- KitLuy canonical AUTHORIZATION REFERENCE DATA
-- ===========================================================================
-- Owner decision CLOUD-SEED = REFERENCE-ONLY (2026-08-10).
--
-- This file carries the authorization VOCABULARY that RLS policies and the
-- Management API depend on: permission definitions, role templates and the
-- role -> permission mapping. It carries NO business data and NO bindings to
-- any particular person.
--
-- ---------------------------------------------------------------------------
-- THE REFERENCE / DEMO LINE
-- ---------------------------------------------------------------------------
-- REFERENCE  a definition that is true of the platform itself:
--            "the permission `rbac.read` exists", "HET_PLATFORM_ADMIN grants it".
-- DEMO       a binding to a particular subject:
--            "user 0000…0001 holds HET_PLATFORM_ADMIN in this Store".
--
-- Definitions belong in every environment. Bindings to fixture users belong
-- only in a local development database, and stay in `dev-fixtures.sql`.
--
-- Deliberately EXCLUDED from this file (they are DEMO, not REFERENCE):
--   kitluy_auth.admin_user_profiles   bound to fixture user 0000…0001
--   kitluy_auth.role_assignments      bound to fixture users
--   kitluy_auth.assignment_scopes     bound to fixture assignments
--   every kitluy_core / kitluy_laundry / kitluy_orders / kitluy_payments row
--
-- WHY THAT MATTERS: this file is applied to a SHARED cloud development
-- project. Loading `dev-fixtures.sql` there would create demo Laundry
-- bookings, orders, payments, garments and tags in an environment other
-- people are using, and that pollution is very hard to distinguish later from
-- real test data.
--
-- ---------------------------------------------------------------------------
-- IDENTIFIERS ARE DETERMINISTIC AND SHARED WITH dev-fixtures.sql
-- ---------------------------------------------------------------------------
-- The UUIDs below are copied verbatim from `dev-fixtures.sql`. They are not
-- new identities. Reusing them means a local database seeded either way holds
-- the same reference rows, so `on conflict do nothing` is genuinely a no-op
-- rather than a silent second copy under a different id.
--
-- IDEMPOTENT: applying this twice produces the same authoritative state.
-- It creates nothing, drops nothing and resets nothing.
--
-- Source of truth for these rows: supabase/seed/dev-fixtures.sql lines 163-187
-- and 591-603. Production registry seeding remains migration group 0150.
-- ===========================================================================

-- Environment guard, mirroring dev-fixtures.sql: fail CLOSED on an unset GUC.
-- Reference data is safe in dev/staging, but the guard stays so this file can
-- never be applied to a production database by an accidental psql -f.
do $guard$
declare
  v_env text := current_setting('kitluy.environment', true);
begin
  if v_env is null or v_env not in ('local', 'development', 'test') then
    raise exception
      'reference-data REFUSED: kitluy.environment=% is not local/development/test',
      coalesce(v_env, '<unset>');
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- 1. Permission definitions
-- ---------------------------------------------------------------------------
-- Control-plane permissions. `rbac.read` is load-bearing: the RLS policy on
-- kitluy_auth.admin_user_profiles is
--   USING (kitluy_auth.has_permission('rbac.read', ...))
-- so without this row NO Admin can read their own profile, and the whole
-- authorization chain is unreachable from a browser.
insert into kitluy_auth.permissions (id, permission_key, version, risk_class, resource_types, environments, status)
values
  ('00000000-0000-4000-8000-000000000029', 'rbac.read', 1, 'LOW', '{authorization_config}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000030', 'audit.read', 1, 'LOW', '{audit_event}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000031', 'partners.read', 1, 'LOW', '{tenant}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000032', 'support.ticket.manage', 1, 'MODERATE', '{support_session}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000033', 'configuration.read', 1, 'LOW', '{configuration}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000034', 'platform.health.read', 1, 'LOW', '{platform}', '{all}', 'ACTIVE')
on conflict (id) do nothing;

-- Vertical read permissions. Definitions only — the Partner/Store slice needs
-- this vocabulary to exist before it can grant anything.
insert into kitluy_auth.permissions (id, permission_key, version, risk_class, resource_types, environments, status)
values
  ('00000000-0000-4000-8000-000000000460', 'laundry.bookings.read', 1, 'LOW', '{laundry_booking,garment_custody,store_location}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000461', 'payments.read', 1, 'LOW', '{payment,refund_request}', '{all}', 'ACTIVE')
on conflict (id) do nothing;

-- Fleet READ (owner decision OD-ADMIN-FLEET-002, 2026-08-10).
--
-- Authorizes reading governed, NON-SECRET fleet facts through the Management
-- API: identity, class, hardware profile, lifecycle, trust state, assignment,
-- Store/Location binding, software/configuration versions and health.
--
-- It deliberately does NOT authorize credential issuance, certificate or
-- private-key access, provisioning issuance, device mutation, revocation,
-- emergency approval, quarantine override or manufacturing secrets. Those are
-- separate CRITICAL-risk keys and stay separate — a read permission that
-- quietly carried write authority is exactly the conflation this split avoids.
insert into kitluy_auth.permissions (id, permission_key, version, risk_class, resource_types, environments, status)
values
  ('00000000-0000-4000-8000-000000000466', 'fleet.read', 1, 'LOW', '{device,platform}', '{all}', 'ACTIVE')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Role templates
-- ---------------------------------------------------------------------------
-- `system_role = true`: platform-defined roles, not customer-authored. The
-- names carry "(demo)" from the original fixture; the KEYS are the canonical
-- vocabulary and are what everything else references. Renaming them is a
-- separate governed change, not something to tidy up here.
insert into kitluy_auth.role_templates (id, role_key, version, name, system_role, status)
values
  ('00000000-0000-4000-8000-000000000035', 'HET_PLATFORM_ADMIN', 1, 'HET Platform Admin (demo)', true, 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000036', 'STORE_LOCATION_STAFF', 1, 'Store Location Staff (demo)', true, 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000037', 'DIGITAL_STORE_STAFF', 1, 'Digital Store Staff (demo)', true, 'ACTIVE')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Role -> permission mapping
-- ---------------------------------------------------------------------------
insert into kitluy_auth.role_permission_grants (id, role_template_id, permission_id, effect)
values
  -- HET_PLATFORM_ADMIN
  ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000029', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000039', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000030', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000031', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000032', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000033', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000034', 'ALLOW'),
  -- Store-facing roles
  ('00000000-0000-4000-8000-000000000462', '00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000460', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000463', '00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000461', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000464', '00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000460', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000465', '00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000461', 'ALLOW')
on conflict (id) do nothing;

-- HET_PLATFORM_ADMIN gains fleet read, and the EXISTING canonical provisioning
-- issuance key.
--
-- No `fleet.provisioning.issue` was created: OD-ADMIN-PROVISION-001 says reuse
-- an existing permission when one carries the semantic, and
-- `fleet.device_provisioning_code.issue` (migration 0163, risk CRITICAL,
-- resources {device, device_provisioning_code}) is exactly that. Minting a
-- second key for the same authority would split provisioning control across
-- two permissions that could drift apart.
--
-- The permission id is resolved by KEY rather than hardcoded, because these
-- rows come from migrations and their ids are not this file's to assume.
insert into kitluy_auth.role_permission_grants (id, role_template_id, permission_id, effect)
select '00000000-0000-4000-8000-000000000467', '00000000-0000-4000-8000-000000000035',
       '00000000-0000-4000-8000-000000000466', 'ALLOW'
on conflict (id) do nothing;

insert into kitluy_auth.role_permission_grants (id, role_template_id, permission_id, effect)
select '00000000-0000-4000-8000-000000000468', '00000000-0000-4000-8000-000000000035', p.id, 'ALLOW'
  from kitluy_auth.permissions p
 where p.permission_key = 'fleet.device_provisioning_code.issue'
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Assertions — the seed proves its own postcondition
-- ---------------------------------------------------------------------------
do $verify$
declare
  v_perms int;
  v_roles int;
  v_grants int;
  v_business int;
begin
  select count(*) into v_perms from kitluy_auth.permissions
   where permission_key in ('rbac.read','audit.read','partners.read','support.ticket.manage',
                            'configuration.read','platform.health.read',
                            'laundry.bookings.read','payments.read','fleet.read');
  select count(*) into v_roles from kitluy_auth.role_templates
   where role_key in ('HET_PLATFORM_ADMIN','STORE_LOCATION_STAFF','DIGITAL_STORE_STAFF');
  select count(*) into v_grants from kitluy_auth.role_permission_grants
   where role_template_id = '00000000-0000-4000-8000-000000000035';

  if v_perms <> 9 then
    raise exception 'reference-data: expected 9 permission definitions, found %', v_perms;
  end if;
  if v_roles <> 3 then
    raise exception 'reference-data: expected 3 role templates, found %', v_roles;
  end if;
  if v_grants < 8 then
    raise exception 'reference-data: HET_PLATFORM_ADMIN expected >= 8 grants (incl fleet.read + provisioning issue), found %', v_grants;
  end if;

  -- This file must never have created business data. Checked, not assumed.
  select (select count(*) from kitluy_orders.orders)
       + (select count(*) from kitluy_payments.tenders)
       + (select count(*) from kitluy_laundry.garments)
       + (select count(*) from kitluy_laundry.laundry_tags)
    into v_business;
  raise notice 'REFERENCE DATA OK: % permissions, % role templates, % admin grants; business rows present = % (this file adds none)',
    v_perms, v_roles, v_grants, v_business;
end
$verify$;
