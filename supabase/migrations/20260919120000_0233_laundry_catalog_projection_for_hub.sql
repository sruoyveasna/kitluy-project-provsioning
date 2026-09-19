-- kitluy:group:0233
-- ============================================================================
-- 0233  The Laundry catalog and the Store's money contract reach the Store Hub:
--       presentation vocabulary tables, and the projection door grows
--       `catalog` and `money`
-- ============================================================================
-- Additive. Groups 0120-0232 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner plan approval 2026-09-19 (KLD-2026-09-19-T1-REAL-OPERATIONS-001,
--   slice 1: "the real catalog and the money contract reach the terminal");
--   WS-05 catalog/pricing persistence (groups 0040/0045/0050) — pricing truth
--   stays with these tables and the signed configuration snapshot the Hub
--   publishes from them (WS-12 task register §2); KBR-PRC-002 (Location price
--   book over Store base book); KLD-2026-08-07-BOOKING-SEMANTICS-001 §2.1
--   (a catalog SERVICE is what a Booking line snapshots).
--
-- ===========================================================================
-- WHAT THIS ADDS, AND WHAT IT DOES NOT
-- ===========================================================================
-- Three small Laundry vocabulary tables the designed T1 face needs to render
-- the catalog the way the owner approved it (KLD-2026-09-18-T1-FACE-PORT-001):
--
--   kitluy_laundry.service_families   — the presentation grouping of services
--                                       by production profile (Wash & Fold,
--                                       Dry Clean, Wash & Press) with a lane
--                                       (per weight / per piece) and Khmer name
--   kitluy_laundry.catalog_categories — the item grid's category chips
--   kitluy_laundry.garment_types      — the Wash & Fold bag checklist: declared
--                                       contents, never priced (T003 vocabulary)
--
-- None of them carries a price. Prices stay in kitluy_laundry.service_prices;
-- a service's family is its `production_profile`; its grid presentation
-- (display name, garment code, category, order) is `catalog_items.metadata`.
--
-- The projection door `read_hub_terminal_projections_v1` (group 0232) grows two
-- objects in the SAME answer, under the SAME Hub-identity predicate and scope:
--
--   catalog — active services with the EFFECTIVE KHR price for the Hub's
--             Location (Location book first, then Store base book; KBR-PRC-002),
--             families, categories, garment types, and a content hash so the
--             Hub republishes its signed configuration only when it changed;
--   money   — the Store Location's PUBLISHED `laundry.money.v1` configuration
--             (currency, exponent, billable-weight rule, money rounding, FX,
--             location code, optional express surcharge). Null when none is
--             published: the Hub then refuses to price, which is the rule.
--
-- No default is invented here: no rounding rule, no FX rate, no surcharge.
-- Those are owner values written into the configuration version by the
-- development loader (scripts/development/load-laundry-catalog.mjs) or,
-- later, by the Partner Portal.
--
-- MC: three MUT vocabulary tables (RLS enable+force, SELECT to authenticated
-- by Store, all to service_role); SELECT grants + read policies for the door
-- owner kitluy_fleet_governor on the catalog, price and configuration tables;
-- one SECURITY DEFINER door replaced additively (same signature).
-- ============================================================================

begin;

create temporary table if not exists kitluy_0233_borrow (granted boolean) on commit drop;

do $borrow$
declare
  v_can_set boolean;
begin
  begin
    execute 'set local role kitluy_fleet_governor';
    execute 'reset role';
    v_can_set := true;
  exception when insufficient_privilege then
    v_can_set := false;
  end;
  if not v_can_set then
    execute format('grant kitluy_fleet_governor to %I', current_user);
  end if;
  insert into kitluy_0233_borrow values (not v_can_set);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. Vocabulary tables.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.service_families (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  code text not null,
  lane text not null,
  name text not null,
  name_km text,
  sort_order integer not null default 0,
  status text not null default 'ACTIVE',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_families_store_code_key unique (digital_store_id, code),
  constraint service_families_tenant_store_fk
    foreign key (tenant_id, digital_store_id) references kitluy_core.digital_stores (tenant_id, id),
  constraint service_families_code_check check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint service_families_lane_check check (lane in ('per_weight', 'per_piece')),
  constraint service_families_status_check check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  constraint service_families_version_check check (version >= 1)
);
comment on table kitluy_laundry.service_families is
  'Group 0233. Presentation grouping of Laundry services by production profile (a service''s kitluy_laundry.services.production_profile names its family). lane = how the T1 face ENTERS the service: per_weight (a weighed load) or per_piece (counted pieces). Carries no price. Sensitivity: internal. MC: MUT.';

create table if not exists kitluy_laundry.catalog_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  code text not null,
  name text not null,
  name_km text,
  sort_order integer not null default 0,
  family_codes text[] not null default '{}',
  status text not null default 'ACTIVE',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_categories_store_code_key unique (digital_store_id, code),
  constraint catalog_categories_tenant_store_fk
    foreign key (tenant_id, digital_store_id) references kitluy_core.digital_stores (tenant_id, id),
  constraint catalog_categories_code_check check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint catalog_categories_status_check check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  constraint catalog_categories_version_check check (version >= 1)
);
comment on table kitluy_laundry.catalog_categories is
  'Group 0233. The T1 item grid''s category chips, per Digital Store, declared per family (family_codes) so a category renders only on the families it belongs to. Carries no price. Sensitivity: internal. MC: MUT.';

create table if not exists kitluy_laundry.garment_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  code text not null,
  name text not null,
  name_km text,
  category_code text,
  sort_order integer not null default 0,
  family_codes text[] not null default '{}',
  status text not null default 'ACTIVE',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garment_types_store_code_key unique (digital_store_id, code),
  constraint garment_types_tenant_store_fk
    foreign key (tenant_id, digital_store_id) references kitluy_core.digital_stores (tenant_id, id),
  constraint garment_types_code_check check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  constraint garment_types_status_check check (status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')),
  constraint garment_types_version_check check (version >= 1)
);
comment on table kitluy_laundry.garment_types is
  'Group 0233 (WS-12-T003 garment intake vocabulary). The garments a per-weight load may DECLARE (the Wash & Fold bag checklist): identification for custody and tags, never a priced line. Sensitivity: internal. MC: MUT.';

alter table kitluy_laundry.service_families enable row level security;
alter table kitluy_laundry.service_families force row level security;
alter table kitluy_laundry.catalog_categories enable row level security;
alter table kitluy_laundry.catalog_categories force row level security;
alter table kitluy_laundry.garment_types enable row level security;
alter table kitluy_laundry.garment_types force row level security;

grant select on kitluy_laundry.service_families, kitluy_laundry.catalog_categories, kitluy_laundry.garment_types
  to authenticated;
grant all on kitluy_laundry.service_families, kitluy_laundry.catalog_categories, kitluy_laundry.garment_types
  to service_role;

do $policies_vocab$
declare
  v_table text;
begin
  foreach v_table in array array['service_families', 'catalog_categories', 'garment_types'] loop
    if not exists (select 1 from pg_policy where polname = v_table || '_select_store'
                      and polrelid = ('kitluy_laundry.' || v_table)::regclass) then
      execute format(
        'create policy %I on kitluy_laundry.%I for select to authenticated
           using (digital_store_id = any (kitluy_auth.current_digital_store_ids()))',
        v_table || '_select_store', v_table);
    end if;
    if not exists (select 1 from pg_policy where polname = v_table || '_fleet_governor_read'
                      and polrelid = ('kitluy_laundry.' || v_table)::regclass) then
      execute format(
        'create policy %I on kitluy_laundry.%I for select to kitluy_fleet_governor using (true)',
        v_table || '_fleet_governor_read', v_table);
    end if;
  end loop;
end
$policies_vocab$;

-- ---------------------------------------------------------------------------
-- 2. The read reach the door owner needs on the WS-05 tables and the
--    configuration versions (FORCE RLS: a grant alone reads zero rows).
-- ---------------------------------------------------------------------------
grant select on kitluy_core.catalog_items, kitluy_core.catalog_item_translations to kitluy_fleet_governor;
grant select on kitluy_laundry.services, kitluy_laundry.service_prices to kitluy_fleet_governor;
grant select on kitluy_laundry.service_families, kitluy_laundry.catalog_categories, kitluy_laundry.garment_types
  to kitluy_fleet_governor;
-- Schema USAGE too: the governor has lived in kitluy_devices only.
grant usage on schema kitluy_core to kitluy_fleet_governor;
grant usage on schema kitluy_laundry to kitluy_fleet_governor;
grant usage on schema kitluy_config to kitluy_fleet_governor;
grant select on kitluy_config.configuration_versions to kitluy_fleet_governor;

do $policies_read$
declare
  v_rel text;
begin
  foreach v_rel in array array[
    'kitluy_core.catalog_items', 'kitluy_core.catalog_item_translations',
    'kitluy_laundry.services', 'kitluy_laundry.service_prices',
    'kitluy_config.configuration_versions'
  ] loop
    if not exists (select 1 from pg_policy
                    where polname = replace(v_rel, '.', '_') || '_fleet_governor_read'
                      and polrelid = v_rel::regclass) then
      execute format('create policy %I on %s for select to kitluy_fleet_governor using (true)',
                     replace(v_rel, '.', '_') || '_fleet_governor_read', v_rel);
    end if;
  end loop;
end
$policies_read$;

-- ---------------------------------------------------------------------------
-- 3. The door, grown additively (same signature; groups 0232's checks kept).
-- ---------------------------------------------------------------------------
set local role kitluy_fleet_governor;

create or replace function kitluy_devices.read_hub_terminal_projections_v1(
  p_hub_device_id uuid,
  p_identity_key_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $door$
declare
  v_hub record;
  v_assignment record;
  v_fingerprint text;
  v_terminals jsonb;
  v_services jsonb;
  v_families jsonb;
  v_categories jsonb;
  v_garment_types jsonb;
  v_catalog jsonb;
  v_money jsonb;
begin
  if p_hub_device_id is null or p_identity_key_fingerprint is null then
    raise exception 'KLUY-HUB-PROJECTION-READ-INVALID: every argument is required'
      using errcode = 'P0001';
  end if;

  select d.id, d.asset_tag, d.device_class::text as device_class,
         d.lifecycle_state::text as lifecycle,
         e.state as enrollment_state, e.revoked_at as enrollment_revoked_at,
         e.device_public_key_fingerprint
    into v_hub
    from kitluy_devices.devices d
    left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = p_hub_device_id;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_UNKNOWN');
  end if;
  if v_hub.lifecycle in ('retired', 'replaced') then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_RETIRED');
  end if;
  if v_hub.device_class <> 'store_hub' then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'NOT_A_STORE_HUB');
  end if;

  v_fingerprint := lower(p_identity_key_fingerprint);
  if v_hub.enrollment_state is distinct from 'sealed'
     or v_hub.enrollment_revoked_at is not null
     or v_hub.device_public_key_fingerprint is distinct from v_fingerprint then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'IDENTITY_MISMATCH');
  end if;

  select a.id, a.tenant_id, a.digital_store_id, a.store_location_id, a.assignment_generation
    into v_assignment
    from kitluy_devices.device_assignments a
   where a.device_id = p_hub_device_id and a.state = 'active'
   order by a.assignment_generation desc
   limit 1;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'HUB_NOT_ASSIGNED');
  end if;

  -- Terminals (unchanged from group 0232).
  select coalesce(jsonb_agg(t order by t.asset_tag), '[]'::jsonb)
    into v_terminals
    from (
      select d.id                          as device_id,
             d.asset_tag,
             d.lifecycle_state::text       as lifecycle_state,
             a.id                          as assignment_id,
             a.assignment_generation,
             c.credential_id,
             c.serial_number               as credential_serial_label,
             c.public_key_fingerprint,
             c.certificate_generation,
             c.environment,
             c.not_before,
             c.not_after,
             cert.certificate_x509_serial,
             cert.certificate_pem,
             cert.issuer_reference,
             (select e.device_public_key_fingerprint
                from kitluy_devices.manufacturing_enrollments e
               where e.id = d.current_enrollment_id
                 and e.state = 'sealed'
                 and e.revoked_at is null)   as identity_key_fingerprint,
             seat.label                    as seat_label,
             coalesce(seat.profile_keys, '{}'::text[]) as profile_keys
        from kitluy_devices.devices d
        join kitluy_devices.device_assignments a
          on a.device_id = d.id and a.state = 'active'
        join lateral (
          select c.credential_id, c.serial_number, c.public_key_fingerprint,
                 c.certificate_generation, c.environment, c.not_before, c.not_after
            from kitluy_devices.device_credentials c
           where c.device_record_id = d.id
             and c.revoked_at is null
             and c.not_after > now()
           order by c.certificate_generation desc, c.created_at desc
           limit 1
        ) c on true
        left join kitluy_devices.device_certificates cert
          on cert.credential_id = c.credential_id
        left join lateral (
          select pt.label,
                 (select array_agg(r.terminal_profile_key order by r.ordinal)
                    from kitluy_devices.physical_terminal_roles r
                   where r.physical_terminal_id = pt.id and r.removed_at is null) as profile_keys
            from kitluy_devices.physical_terminals pt
           where pt.bound_device_id = d.id
           order by pt.bound_at desc nulls last
           limit 1
        ) seat on true
       where d.device_class = 'terminal'
         and d.lifecycle_state = 'active'
         and a.tenant_id = v_assignment.tenant_id
         and a.digital_store_id = v_assignment.digital_store_id
         and a.store_location_id = v_assignment.store_location_id
    ) t;

  -- Catalog: ACTIVE services with an effective KHR price for this Location.
  -- Location book beats Store base book (KBR-PRC-002); newest effective wins.
  select coalesce(jsonb_agg(s order by s.family_sort, s.sort_order, s.service_code), '[]'::jsonb)
    into v_services
    from (
      select sv.id                                   as service_id,
             sv.service_code,
             sv.production_profile                   as family_code,
             coalesce(f.sort_order, 0)               as family_sort,
             ci.code                                 as catalog_item_code,
             ci.name,
             (select t.name from kitluy_core.catalog_item_translations t
               where t.catalog_item_id = ci.id and t.locale = 'km-KH' limit 1) as name_km,
             coalesce(ci.metadata ->> 'display_name', ci.name) as display_name,
             ci.metadata ->> 'garment_code'          as garment_code,
             ci.metadata ->> 'category_code'         as category_code,
             ci.metadata ->> 'icon_key'              as icon_key,
             coalesce((ci.metadata ->> 'sort_order')::integer, 0) as sort_order,
             pr.pricing_mode,
             pr.currency_code,
             pr.unit_price_minor,
             pr.min_charge_minor,
             pr.effective_from,
             (pr.store_location_id is not null)      as location_price,
             sv.version                              as service_version
        from kitluy_laundry.services sv
        join kitluy_core.catalog_items ci on ci.id = sv.catalog_item_id
        left join kitluy_laundry.service_families f
          on f.digital_store_id = sv.digital_store_id and f.code = sv.production_profile
        join lateral (
          select p.pricing_mode, p.currency_code, p.unit_price_minor, p.min_charge_minor,
                 p.effective_from, p.store_location_id
            from kitluy_laundry.service_prices p
           where p.service_id = sv.id
             and p.digital_store_id = sv.digital_store_id
             and (p.store_location_id is null or p.store_location_id = v_assignment.store_location_id)
             and p.currency_code = 'KHR'
             and p.pricing_mode = any (sv.pricing_modes)
             and p.effective_from <= now()
             and (p.effective_to is null or p.effective_to > now())
           order by (p.store_location_id is not null) desc, p.effective_from desc, p.version desc
           limit 1
        ) pr on true
       where sv.digital_store_id = v_assignment.digital_store_id
         and sv.status = 'ACTIVE'
         and ci.status = 'ACTIVE'
    ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', f.code, 'lane', f.lane, 'name', f.name, 'name_km', f.name_km,
           'sort_order', f.sort_order) order by f.sort_order, f.code), '[]'::jsonb)
    into v_families
    from kitluy_laundry.service_families f
   where f.digital_store_id = v_assignment.digital_store_id and f.status = 'ACTIVE';

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', c.code, 'name', c.name, 'name_km', c.name_km, 'sort_order', c.sort_order,
           'family_codes', to_jsonb(c.family_codes)) order by c.sort_order, c.code), '[]'::jsonb)
    into v_categories
    from kitluy_laundry.catalog_categories c
   where c.digital_store_id = v_assignment.digital_store_id and c.status = 'ACTIVE';

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', g.code, 'name', g.name, 'name_km', g.name_km, 'category_code', g.category_code,
           'sort_order', g.sort_order, 'family_codes', to_jsonb(g.family_codes))
           order by g.sort_order, g.code), '[]'::jsonb)
    into v_garment_types
    from kitluy_laundry.garment_types g
   where g.digital_store_id = v_assignment.digital_store_id and g.status = 'ACTIVE';

  v_catalog := jsonb_build_object(
    'schema', 'kitluy.config.catalog.v1',
    'currency_code', 'KHR',
    'families', v_families,
    'categories', v_categories,
    'services', v_services,
    'garment_types', v_garment_types
  );
  -- jsonb text is key-sorted and whitespace-free: a stable change detector.
  v_catalog := v_catalog || jsonb_build_object(
    'content_hash', encode(extensions.digest(v_catalog::text, 'sha256'), 'hex'));

  -- Money: the newest PUBLISHED laundry.money.v1 for the Location, else the Store.
  select cv.payload
    into v_money
    from kitluy_config.configuration_versions cv
   where cv.config_key = 'laundry.money.v1'
     and cv.status = 'PUBLISHED'
     and cv.digital_store_id = v_assignment.digital_store_id
     and (cv.store_location_id = v_assignment.store_location_id or cv.store_location_id is null)
   order by (cv.store_location_id is not null) desc, cv.version desc, cv.created_at desc
   limit 1;

  return jsonb_build_object(
    'outcome', 'OK',
    'hub', jsonb_build_object(
      'deviceId', v_hub.id,
      'assetTag', v_hub.asset_tag,
      'assignmentId', v_assignment.id,
      'assignmentGeneration', v_assignment.assignment_generation,
      'tenantId', v_assignment.tenant_id,
      'digitalStoreId', v_assignment.digital_store_id,
      'storeLocationId', v_assignment.store_location_id
    ),
    'terminals', v_terminals,
    'catalog', v_catalog,
    'money', v_money
  );
end
$door$;

comment on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) is
  'Groups 0232 + 0233 (HUB-TERMINAL-SYNC-001, T1-REAL-OPERATIONS-001). For a live store_hub whose current sealed enrollment holds the presented identity key: the projection of every active terminal in its own scope (0232), the Laundry CATALOG with effective KHR prices for its Location (Location book over Store base book, KBR-PRC-002; families, categories, garment types; content_hash), and the Location''s PUBLISHED laundry.money.v1 configuration (null when none). Reads only; nothing secret. Executable by kitluy_edge_sync_service only.';

revoke all on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) from public;
grant execute on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text)
  to kitluy_edge_sync_service;

reset role;

-- ---------------------------------------------------------------------------
-- 4. Assertions.
-- ---------------------------------------------------------------------------
do $assert_0233$
declare
  v_findings text[] := '{}';
  v_door oid := 'kitluy_devices.read_hub_terminal_projections_v1(uuid, text)'::regprocedure;
  v_grantees text[];
  v_answer jsonb;
  v_rel text;
begin
  if not (select prosecdef from pg_proc where oid = v_door) then
    v_findings := v_findings || 'the projection door must be SECURITY DEFINER';
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_door)) <> 'kitluy_fleet_governor' then
    v_findings := v_findings || 'the projection door must be owned by kitluy_fleet_governor';
  end if;
  select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end), '{}')
    into v_grantees
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = v_door and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner;
  if v_grantees <> array['kitluy_edge_sync_service'] then
    v_findings := v_findings || format('the projection door is executable by %s, not the edge sync service alone', v_grantees);
  end if;
  foreach v_rel in array array[
    'kitluy_core.catalog_items', 'kitluy_core.catalog_item_translations',
    'kitluy_laundry.services', 'kitluy_laundry.service_prices',
    'kitluy_laundry.service_families', 'kitluy_laundry.catalog_categories', 'kitluy_laundry.garment_types',
    'kitluy_config.configuration_versions'
  ] loop
    if not has_schema_privilege('kitluy_fleet_governor', split_part(v_rel, '.', 1), 'USAGE')
       or not has_table_privilege('kitluy_fleet_governor', v_rel, 'SELECT')
       or not exists (select 1 from pg_policy where polrelid = v_rel::regclass
                        and 'kitluy_fleet_governor'::regrole = any(polroles) and polcmd in ('r', '*')) then
      v_findings := v_findings || format('the door owner cannot read %s (grant or read policy missing)', v_rel);
    end if;
  end loop;
  foreach v_rel in array array['service_families', 'catalog_categories', 'garment_types'] loop
    if not (select relrowsecurity and relforcerowsecurity from pg_class
             where oid = ('kitluy_laundry.' || v_rel)::regclass) then
      v_findings := v_findings || format('kitluy_laundry.%s must enable and force RLS', v_rel);
    end if;
  end loop;

  set local role kitluy_edge_sync_service;
  v_answer := kitluy_devices.read_hub_terminal_projections_v1(gen_random_uuid(), repeat('a', 64));
  if v_answer ->> 'code' <> 'DEVICE_UNKNOWN' then
    v_findings := v_findings || 'an unknown Hub must still be refused DEVICE_UNKNOWN';
  end if;
  reset role;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0233: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0233: the Store Hub reads its Laundry catalog, effective Location prices and the Store''s money contract through the same door, by its own identity';
end
$assert_0233$;

do $hand_back$
begin
  if (select granted from kitluy_0233_borrow) then
    execute format('revoke kitluy_fleet_governor from %I', current_user);
  end if;
end
$hand_back$;

commit;
