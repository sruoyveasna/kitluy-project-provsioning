-- kitluy:group:0237
-- ============================================================================
-- 0237  The Hub projection carries the Digital Store's PRIMARY VERTICAL
-- ============================================================================
-- Additive. Groups 0120-0236 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001 (owner task) requirement
--   1; hub migration 0044's own header -- "The cloud->Hub assignment writer,
--   when built, must populate it from digital_stores.primary_vertical_code";
--   TERMINAL-APPLICATION-ASSIGNMENT-001 requirement 3, resolving
--   KLREQ-VERTICAL-ENVELOPE-001; RB v4 §3.2 and group 0020 invariant I2 (one
--   Digital Store, exactly one primary vertical).
--
-- ===========================================================================
-- THE GAP THIS CLOSES
-- ===========================================================================
-- Hub migration 0044 added `edge_identity.hub_assignment.primary_vertical_code`
-- and made the Hub FAIL CLOSED when it is NULL: `deriveEligibility` refuses
-- every terminal with VERTICAL_UNAVAILABLE, so a Store Hub running that schema
-- can never bring a terminal to SERVING. The column was nullable because no
-- feeder existed to fill it -- and none did. Measured on the development Hub
-- (handoff 55 §6): of 33 `hub_assignment` rows, the ONE carrying a vertical was
-- set by hand; all 32 written by the sync were NULL.
--
-- The vertical was missing at the very first step: this door, the authoritative
-- cloud projection a Store Hub reads about itself, built its `hub` object from
-- the device and the assignment alone and never looked at the Digital Store.
-- This group adds that single read, and refuses the projection when the Store
-- cannot supply one.
--
-- ===========================================================================
-- WHY THE VALUE IS PROJECTED VERBATIM
-- ===========================================================================
-- The cloud's governed vocabulary for this field is the reference registry
-- `kitluy_core.reference_values` (`registry_key = 'vertical_code'`), whose
-- Phase 1 active value is `LAUNDRY`. The edge runtime registry keys the same
-- vertical `laundry`, and hub migration 0044 constrains its column to that
-- shape (`^[a-z][a-z0-9_]*$`). A door that lower-cased the value on the way
-- out would be a free-form string conversion in the one place with no registry
-- to validate the result against, and would silently mint a vertical key for
-- any future cloud code. So the door projects the cloud value AS IT STANDS,
-- and the single sanctioned conversion -- `verticalKeyFromCloudCode` in
-- `@kitluy/shared-types`, an explicit eight-row table -- is applied once by
-- the Store Hub, after it has verified the envelope's signature, and refuses
-- anything the registry does not name.
--
-- FAIL CLOSED, EVERYWHERE. An absent Store row (STORE_UNKNOWN), a Store whose
-- Tenant contradicts the assignment (STORE_TENANT_MISMATCH) and a blank
-- vertical (STORE_VERTICAL_UNAVAILABLE) each refuse the WHOLE projection --
-- terminals, catalog and money included. Nothing defaults to Laundry.
--
-- NOTHING SECRET LEAVES. A Digital Store's business vertical is a public fact
-- about the Store the Hub is already assigned to and already names.
--
-- MC: READ (no table changes; one SELECT grant and one read-only RLS policy
-- for the door's owner; one SECURITY DEFINER read door replaced additively
-- with the same signature).
-- ============================================================================

begin;

create temporary table if not exists kitluy_0237_borrow (granted boolean) on commit drop;

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
  insert into kitluy_0237_borrow values (not v_can_set);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. The read reach the door owner needs on the Digital Store.
--    `kitluy_core.digital_stores` FORCES RLS, so a grant alone reads zero
--    rows -- the owner needs a read policy too (the group 0233 pattern).
-- ---------------------------------------------------------------------------
grant usage on schema kitluy_core to kitluy_fleet_governor;
grant select on kitluy_core.digital_stores to kitluy_fleet_governor;

do $policy_read$
begin
  if not exists (select 1 from pg_policy
                  where polname = 'digital_stores_fleet_governor_read'
                    and polrelid = 'kitluy_core.digital_stores'::regclass) then
    create policy digital_stores_fleet_governor_read
      on kitluy_core.digital_stores
      for select to kitluy_fleet_governor
      using (true);
  end if;
end
$policy_read$;

-- ---------------------------------------------------------------------------
-- 2. The door, grown additively (same signature; groups 0232 + 0233 kept).
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
  v_store record;
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

  -- ---------------------------------------------------------------------
  -- Group 0237. The Digital Store's PRIMARY VERTICAL -- the authoritative
  -- business vertical of the Store this Hub is assigned to (invariant I2:
  -- exactly one per Digital Store, group 0020). It is read from the STORE
  -- the Hub's own active assignment names, never from a terminal profile
  -- prefix, an application id, an asset tag or anything the caller sends.
  --
  -- FAIL CLOSED. A Store row that is absent, or a vertical that is blank,
  -- refuses the whole projection. There is no default: a Hub that cannot be
  -- told which vertical it serves must be told nothing at all, rather than
  -- be handed Laundry because Laundry is what Phase 1 happens to run.
  -- ---------------------------------------------------------------------
  select ds.id, ds.tenant_id, btrim(coalesce(ds.primary_vertical_code, '')) as primary_vertical_code
    into v_store
    from kitluy_core.digital_stores ds
   where ds.id = v_assignment.digital_store_id;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'STORE_UNKNOWN');
  end if;
  -- The Store must belong to the Tenant the assignment names: a cross-Tenant
  -- row can never lend its vertical to this Hub.
  if v_store.tenant_id is distinct from v_assignment.tenant_id then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'STORE_TENANT_MISMATCH');
  end if;
  if v_store.primary_vertical_code = '' then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'STORE_VERTICAL_UNAVAILABLE');
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
      'storeLocationId', v_assignment.store_location_id,
      -- Group 0237: the cloud reference-registry value, VERBATIM. The cloud
      -- speaks its own governed vocabulary here (`LAUNDRY`); the single
      -- sanctioned conversion to the edge registry key (`laundry`) is
      -- `verticalKeyFromCloudCode` in @kitluy/shared-types, applied once by
      -- the Hub after it has VERIFIED this envelope's signature. Converting
      -- here would put a vocabulary transform inside a door that has no
      -- registry to check it against.
      'primaryVerticalCode', v_store.primary_vertical_code
    ),
    'terminals', v_terminals,
    'catalog', v_catalog,
    'money', v_money
  );
end
$door$;
comment on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) is
  'Groups 0232 + 0233 + 0237 (HUB-TERMINAL-SYNC-001, T1-REAL-OPERATIONS-001, PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001). For a live store_hub whose current sealed enrollment holds the presented identity key: the projection of every active terminal in its own scope (0232), the Laundry CATALOG with effective KHR prices for its Location and the Location''s PUBLISHED laundry.money.v1 configuration (0233), and the assigned Digital Store''s PRIMARY VERTICAL as the cloud reference registry holds it (0237, e.g. LAUNDRY) -- the value the Store Hub converts once, through @kitluy/shared-types verticalKeyFromCloudCode, into the registry key its hub_assignment stores. Fails closed: an absent Store, a Tenant mismatch or a blank vertical refuses the whole projection. Reads only; nothing secret. Executable by kitluy_edge_sync_service only.';

revoke all on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) from public;
grant execute on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text)
  to kitluy_edge_sync_service;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Assertions.
-- ---------------------------------------------------------------------------
do $assert_0237$
declare
  v_findings text[] := '{}';
  v_door oid := 'kitluy_devices.read_hub_terminal_projections_v1(uuid, text)'::regprocedure;
  v_grantees text[];
  v_answer jsonb;
  v_source text;
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

  -- The door owner can actually read the Store (grant AND policy: FORCE RLS).
  if not has_schema_privilege('kitluy_fleet_governor', 'kitluy_core', 'USAGE')
     or not has_table_privilege('kitluy_fleet_governor', 'kitluy_core.digital_stores', 'SELECT')
     or not exists (select 1 from pg_policy
                     where polrelid = 'kitluy_core.digital_stores'::regclass
                       and 'kitluy_fleet_governor'::regrole = any(polroles)
                       and polcmd in ('r', '*')) then
    v_findings := v_findings || 'the door owner cannot read kitluy_core.digital_stores (grant or read policy missing)';
  end if;

  -- The vertical is READ FROM THE STORE, and from nothing else. A door that
  -- derived it from a profile key, an asset tag or a caller argument would
  -- pass every test above; this one reads the source text.
  v_source := pg_get_functiondef(v_door);
  if v_source not like '%kitluy_core.digital_stores%'
     or v_source not like '%primary_vertical_code%' then
    v_findings := v_findings || 'the door must read primary_vertical_code from kitluy_core.digital_stores';
  end if;
  if v_source not like '%STORE_VERTICAL_UNAVAILABLE%' then
    v_findings := v_findings || 'the door must refuse STORE_VERTICAL_UNAVAILABLE on a blank vertical';
  end if;
  if v_source like '%lower(v_store.primary_vertical_code)%'
     or v_source like '%lower(ds.primary_vertical_code)%' then
    v_findings := v_findings ||
      'the door must project the cloud vertical VERBATIM; the registry conversion belongs to @kitluy/shared-types at the Hub';
  end if;

  set local role kitluy_edge_sync_service;
  v_answer := kitluy_devices.read_hub_terminal_projections_v1(gen_random_uuid(), repeat('a', 64));
  if v_answer ->> 'code' <> 'DEVICE_UNKNOWN' then
    v_findings := v_findings || 'an unknown Hub must still be refused DEVICE_UNKNOWN';
  end if;
  reset role;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0237: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0237: the Store Hub''s own projection now carries the assigned Digital Store''s primary vertical, and refuses rather than guessing one';
end
$assert_0237$;

do $hand_back$
begin
  if (select granted from kitluy_0237_borrow) then
    execute format('revoke kitluy_fleet_governor from %I', current_user);
  end if;
end
$hand_back$;

commit;
