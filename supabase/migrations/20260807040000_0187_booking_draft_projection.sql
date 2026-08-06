-- kitluy:group:0187
-- ===========================================================================
-- WS-12-T002-P02 — cloud Booking-Draft PROJECTION and its ingestion door
-- (KLD-2026-08-06-WS12-T002-001 §4/§5; T002-P02 owner package §9).
--
-- WHY THIS GROUP EXISTS. The Store Hub is and REMAINS the authority for the
-- working Laundry Booking Draft (Hub group 0040). What the cloud lacked was
-- ANY continuity/evidence copy: a Hub loss before conversion would erase
-- every open draft with no recovery aid, and Partner-facing surfaces would
-- have no read model. This group adds the MINIMUM: a read-only projection
-- + append-only ingestion history, fed exclusively by the Hub's
-- `laundry.booking_draft_recorded` v1 outbox facts through one governed
-- door.
--
-- WHAT THE PROJECTION IS NOT (§9, verbatim discipline): it never creates
-- or updates `kitluy_laundry` Bookings or any WS-07 aggregate; it produces
-- no transaction or payment; it never rewrites the Hub's original
-- timestamps; a lower version never replaces the current row; a
-- CONFLICTING SAME-VERSION delivery quarantines the projection rather than
-- choosing a side; it never merges customers and never infers consent.
--
-- Effect-key idempotency: `kh1.{booking_draft_event_id}.1` — the Hub
-- mutation RECEIPT id, so every create/update/cancel is its own
-- exactly-once fact and the append-only history reconstructs the full
-- mutation sequence even when deliveries arrive out of order.
-- ===========================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_draft_projection_governor') then
    create role kitluy_draft_projection_governor nologin;
  end if;
end $$;

comment on role kitluy_draft_projection_governor is
  'Booking-Draft projection authority (group 0187). NOLOGIN and granted to nobody; owns the ingestion door, the projection and its history. Explicit per-command policies under FORCE RLS (0177/0186 pattern), never BYPASSRLS.';

do $borrow$
begin
  execute format('grant kitluy_draft_projection_governor to %I', current_user);
end $borrow$;

grant usage, create on schema kitluy_laundry to kitluy_draft_projection_governor;
grant usage on schema kitluy_devices to kitluy_draft_projection_governor;
grant usage on schema kitluy_core to kitluy_draft_projection_governor;
grant select on kitluy_devices.devices, kitluy_devices.device_assignments
  to kitluy_draft_projection_governor;
-- FORCE RLS applies to the door's owner too: the assignment check needs
-- explicit SELECT policies (0177 fleet-governor pattern; kitluy_devices is
-- outside the kitluy_core policy censuses).
create policy devices_draft_projection_read on kitluy_devices.devices
  for select to kitluy_draft_projection_governor using (true);
create policy device_assignments_draft_projection_read on kitluy_devices.device_assignments
  for select to kitluy_draft_projection_governor using (true);

-- ---------------------------------------------------------------------------
-- 1. The projection — one row per Hub draft, newest accepted version.
-- ---------------------------------------------------------------------------
create table kitluy_laundry.booking_draft_projections (
  id                 uuid        primary key default gen_random_uuid(),
  hub_draft_id       uuid        not null,
  tenant_id          uuid        not null references kitluy_core.tenants (id),
  digital_store_id   uuid        not null references kitluy_core.digital_stores (id),
  store_location_id  uuid        not null,
  hub_device_id      uuid        not null,
  terminal_device_id uuid        not null,
  walk_in            boolean     not null,
  local_customer_id  uuid        null,
  cloud_customer_id  uuid        null references kitluy_core.customers (id),
  customer_snapshot  jsonb       not null,
  lifecycle          text        not null,
  version            bigint      not null,
  preferred_language text        not null,
  intake_source      text        not null,
  cancel_reason_code text        null,
  hub_created_at     timestamptz not null,
  hub_updated_at     timestamptz not null,
  received_at        timestamptz not null default now(),
  freshness          text        not null default 'current',
  conflict_state     text        not null default 'none',
  source_effect_key  text        not null,
  updated_at         timestamptz not null default now(),
  constraint booking_draft_projections_hub_draft_uq unique (hub_draft_id),
  constraint booking_draft_projections_lifecycle_ck
    check (lifecycle in ('open', 'cancelled', 'expired', 'converted', 'superseded')),
  constraint booking_draft_projections_version_ck check (version >= 1),
  constraint booking_draft_projections_walkin_ck
    check ((local_customer_id is null) = walk_in),
  constraint booking_draft_projections_freshness_ck
    check (freshness in ('current', 'stale_projection')),
  constraint booking_draft_projections_conflict_ck
    check (conflict_state in ('none', 'version_conflict')),
  constraint booking_draft_projections_effect_ck
    check (source_effect_key ~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$')
);

create index booking_draft_projections_scope_idx
  on kitluy_laundry.booking_draft_projections (tenant_id, digital_store_id, store_location_id);

comment on table kitluy_laundry.booking_draft_projections is
  'READ-ONLY cloud projection of the Hub-authoritative working Booking Draft (group 0187; Hub 0040 is the authority). Continuity/evidence data ONLY: never a Laundry Booking, price, capacity, payment, garment or custody fact; hub_created_at/hub_updated_at are the Hub''s instants stored verbatim; a lower version never replaces this row; a conflicting same-version delivery sets conflict_state = version_conflict (quarantine) instead of choosing a side.';

-- ---------------------------------------------------------------------------
-- 2. Append-only ingestion history — every delivered fact, in any order.
-- ---------------------------------------------------------------------------
create table kitluy_laundry.booking_draft_projection_events (
  effect_key     text        primary key,
  hub_draft_id   uuid        not null,
  event_type     text        not null,
  version        bigint      not null,
  outcome        text        not null,
  payload_hash   char(64)    not null,
  payload        jsonb       not null,
  correlation_id uuid        null,
  received_at    timestamptz not null default now(),
  constraint booking_draft_projection_events_key_ck
    check (effect_key ~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$'),
  constraint booking_draft_projection_events_type_ck
    check (event_type in ('created', 'updated', 'cancelled')),
  constraint booking_draft_projection_events_outcome_ck
    check (outcome in ('PROJECTED', 'STALE_RECORDED', 'CONFLICT_QUARANTINED')),
  constraint booking_draft_projection_events_hash_ck
    check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index booking_draft_projection_events_draft_idx
  on kitluy_laundry.booking_draft_projection_events (hub_draft_id, version);

create trigger trg_append_only_booking_draft_projection_events
  before update or delete on kitluy_laundry.booking_draft_projection_events
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- 3. RLS and the governor's exact write surface.
-- ---------------------------------------------------------------------------
alter table kitluy_laundry.booking_draft_projections enable row level security;
alter table kitluy_laundry.booking_draft_projections force row level security;
alter table kitluy_laundry.booking_draft_projection_events enable row level security;
alter table kitluy_laundry.booking_draft_projection_events force row level security;

create policy booking_draft_projections_governor_read on kitluy_laundry.booking_draft_projections
  for select to kitluy_draft_projection_governor using (true);
create policy booking_draft_projections_governor_write on kitluy_laundry.booking_draft_projections
  for insert to kitluy_draft_projection_governor with check (true);
create policy booking_draft_projections_governor_advance on kitluy_laundry.booking_draft_projections
  for update to kitluy_draft_projection_governor using (true) with check (true);
create policy booking_draft_projection_events_governor_read
  on kitluy_laundry.booking_draft_projection_events
  for select to kitluy_draft_projection_governor using (true);
create policy booking_draft_projection_events_governor_write
  on kitluy_laundry.booking_draft_projection_events
  for insert to kitluy_draft_projection_governor with check (true);

grant select, insert, update on kitluy_laundry.booking_draft_projections
  to kitluy_draft_projection_governor;
grant select, insert on kitluy_laundry.booking_draft_projection_events
  to kitluy_draft_projection_governor;
grant select on kitluy_core.tenants, kitluy_core.digital_stores
  to kitluy_draft_projection_governor;
-- Cross-governor CONTINUITY read: the draft door resolves an already-
-- ingested local customer to its cloud id from the 0186 effects journal
-- (read-only; never a merge).
do $xgov$
begin
  -- Policy DDL requires the table OWNER (the 0186 customer governor);
  -- borrowed for exactly this statement and returned immediately.
  execute format('grant kitluy_customer_ingestion_governor to %I', current_user);
  create policy customer_ingestion_effects_draft_read on kitluy_core.customer_ingestion_effects
    for select to kitluy_draft_projection_governor using (true);
  grant select on kitluy_core.customer_ingestion_effects to kitluy_draft_projection_governor;
  execute format('revoke kitluy_customer_ingestion_governor from %I', current_user);
end $xgov$;
create policy tenants_draft_projection_read on kitluy_core.tenants
  for select to kitluy_draft_projection_governor using (true);
create policy digital_stores_draft_projection_read on kitluy_core.digital_stores
  for select to kitluy_draft_projection_governor using (true);

-- ---------------------------------------------------------------------------
-- 4. The ingestion door.
-- ---------------------------------------------------------------------------
create function kitluy_laundry.ingest_booking_draft_event_v1(
  p_effect_key text,
  p_payload_hash text,
  p_hub_device_id uuid,
  p_terminal_device_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_hub_draft_id uuid,
  p_event_type text,
  p_version bigint,
  p_lifecycle text,
  p_walk_in boolean,
  p_local_customer_id uuid,
  p_customer_snapshot jsonb,
  p_preferred_language text,
  p_intake_source text,
  p_cancel_reason_code text,
  p_hub_created_at timestamptz,
  p_hub_updated_at timestamptz,
  p_payload jsonb,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_laundry, kitluy_devices, kitluy_core, extensions
as $ingest$
declare
  v_existing kitluy_laundry.booking_draft_projection_events;
  v_current  kitluy_laundry.booking_draft_projections;
  v_hub_assignment kitluy_devices.device_assignments;
  v_outcome text;
  v_cloud_customer uuid;
begin
  if p_effect_key !~ '^kh1\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[0-9]+$' then
    raise exception 'KLUY-DRAFT-INGEST-SCHEMA: the effect key is not the canonical kh1 shape'
      using errcode = 'P0001';
  end if;
  if p_payload_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-DRAFT-INGEST-SCHEMA: the payload hash is not lowercase hex SHA-256'
      using errcode = 'P0001';
  end if;
  if p_event_type not in ('created', 'updated', 'cancelled')
     or p_lifecycle not in ('open', 'cancelled', 'expired', 'converted', 'superseded')
     or p_version is null or p_version < 1 then
    raise exception 'KLUY-DRAFT-INGEST-SCHEMA: event type, lifecycle or version is not recognised'
      using errcode = 'P0001';
  end if;

  -- Idempotency FIRST: a redelivered fact returns its original verdict.
  select * into v_existing from kitluy_laundry.booking_draft_projection_events
   where effect_key = p_effect_key;
  if found then
    if v_existing.payload_hash <> p_payload_hash then
      raise exception 'KLUY-DRAFT-INGEST-IDEMPOTENCY: effect key % was applied with a different payload',
        p_effect_key using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'DUPLICATE_IGNORED',
                              'originalOutcome', v_existing.outcome);
  end if;

  -- The delivering Hub must hold a LIVE assignment in exactly this scope
  -- (0177 discipline: another Hub cannot claim the Store's drafts).
  select a.* into v_hub_assignment
    from kitluy_devices.device_assignments a
    join kitluy_devices.devices d on d.id = a.device_id
   where a.device_id = p_hub_device_id
     and a.state in ('pending_trust', 'active')
     and d.device_class = 'store_hub';
  if not found then
    raise exception 'KLUY-DRAFT-INGEST-HUB-UNASSIGNED: the reporting Hub has no live assignment'
      using errcode = 'P0001';
  end if;
  if v_hub_assignment.tenant_id <> p_tenant_id
     or v_hub_assignment.digital_store_id <> p_digital_store_id
     or v_hub_assignment.store_location_id <> p_store_location_id then
    raise exception 'KLUY-DRAFT-INGEST-WRONG-SCOPE: the delivery scope is not the Hub''s assigned scope'
      using errcode = 'P0001';
  end if;

  -- Resolve the cloud customer id when the local customer already ingested
  -- (continuity only — NEVER a merge; absent stays NULL).
  if p_local_customer_id is not null then
    select e.cloud_customer_id into v_cloud_customer
      from kitluy_core.customer_ingestion_effects e
     where e.effect_kind = 'local_customer' and e.outcome = 'APPLIED'
       and e.effect_key = 'kh1.' || lower(p_local_customer_id::text) || '.1';
  end if;

  select * into v_current from kitluy_laundry.booking_draft_projections
   where hub_draft_id = p_hub_draft_id;
  if not found then
    insert into kitluy_laundry.booking_draft_projections
      (hub_draft_id, tenant_id, digital_store_id, store_location_id,
       hub_device_id, terminal_device_id, walk_in, local_customer_id,
       cloud_customer_id, customer_snapshot, lifecycle, version,
       preferred_language, intake_source, cancel_reason_code,
       hub_created_at, hub_updated_at, source_effect_key)
    values
      (p_hub_draft_id, p_tenant_id, p_digital_store_id, p_store_location_id,
       p_hub_device_id, p_terminal_device_id, p_walk_in, p_local_customer_id,
       v_cloud_customer, p_customer_snapshot, p_lifecycle, p_version,
       p_preferred_language, p_intake_source, p_cancel_reason_code,
       p_hub_created_at, p_hub_updated_at, p_effect_key);
    v_outcome := 'PROJECTED';
  elsif p_version > v_current.version then
    -- Newer version wins; the Hub's instants are stored verbatim and the
    -- IMMUTABLE snapshot never changes once projected.
    update kitluy_laundry.booking_draft_projections
       set lifecycle = p_lifecycle,
           version = p_version,
           preferred_language = p_preferred_language,
           intake_source = p_intake_source,
           cancel_reason_code = p_cancel_reason_code,
           hub_updated_at = p_hub_updated_at,
           received_at = now(),
           source_effect_key = p_effect_key,
           updated_at = now()
     where hub_draft_id = p_hub_draft_id;
    v_outcome := 'PROJECTED';
  elsif p_version = v_current.version
        and v_current.source_effect_key <> p_effect_key then
    -- A DIFFERENT fact claiming the SAME version: quarantine, choose no side.
    update kitluy_laundry.booking_draft_projections
       set conflict_state = 'version_conflict', updated_at = now()
     where hub_draft_id = p_hub_draft_id;
    v_outcome := 'CONFLICT_QUARANTINED';
  else
    -- Delayed/reordered delivery: preserved as history, projection untouched.
    v_outcome := 'STALE_RECORDED';
  end if;

  insert into kitluy_laundry.booking_draft_projection_events
    (effect_key, hub_draft_id, event_type, version, outcome, payload_hash,
     payload, correlation_id)
  values
    (p_effect_key, p_hub_draft_id, p_event_type, p_version, v_outcome,
     p_payload_hash, p_payload, p_correlation_id);

  return jsonb_build_object('outcome', v_outcome,
                            'hubDraftId', p_hub_draft_id,
                            'projectionVersion',
                            greatest(p_version, coalesce(v_current.version, p_version)));
end;
$ingest$;

comment on function kitluy_laundry.ingest_booking_draft_event_v1 is
  'The ONE cloud entry for Hub Booking-Draft facts (group 0187). Effect-key exactly-once; Hub live-assignment + scope verified; newest version wins; a lower version is history only; a conflicting same-version delivery QUARANTINES; the projection never becomes a Booking, price, payment or custody fact.';

-- ---------------------------------------------------------------------------
-- 5. Ownership, execution grants, hardening.
-- ---------------------------------------------------------------------------
alter table kitluy_laundry.booking_draft_projections owner to kitluy_draft_projection_governor;
alter table kitluy_laundry.booking_draft_projection_events owner to kitluy_draft_projection_governor;
alter function kitluy_laundry.ingest_booking_draft_event_v1(text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, text, boolean, uuid, jsonb, text, text, text, timestamptz, timestamptz, jsonb, uuid)
  owner to kitluy_draft_projection_governor;

revoke execute on function
  kitluy_laundry.ingest_booking_draft_event_v1(text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, text, boolean, uuid, jsonb, text, text, text, timestamptz, timestamptz, jsonb, uuid)
  from public;
grant execute on function
  kitluy_laundry.ingest_booking_draft_event_v1(text, text, uuid, uuid, uuid, uuid, uuid, uuid, text, bigint, text, boolean, uuid, jsonb, text, text, text, timestamptz, timestamptz, jsonb, uuid)
  to kitluy_edge_sync_service, kitluy_test_harness;
grant usage on schema kitluy_laundry to kitluy_edge_sync_service, kitluy_test_harness;

do $return$
begin
  execute format('revoke kitluy_draft_projection_governor from %I', current_user);
end $return$;

-- ---------------------------------------------------------------------------
-- 6. Self-verification.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if has_function_privilege('public',
      'kitluy_laundry.ingest_booking_draft_event_v1(text,text,uuid,uuid,uuid,uuid,uuid,uuid,text,bigint,text,boolean,uuid,jsonb,text,text,text,timestamptz,timestamptz,jsonb,uuid)'::regprocedure,
      'execute') then
    raise exception 'KLUY-MIGRATION-0187: PUBLIC can execute the draft ingestion door';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_laundry' and c.relname = 'booking_draft_projections'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'KLUY-MIGRATION-0187: the projection is not FORCE-RLS';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'kitluy_laundry'
       and tablename in ('booking_draft_projections', 'booking_draft_projection_events')
       and roles::text[] <> array['kitluy_draft_projection_governor']
  ) then
    raise exception 'KLUY-MIGRATION-0187: a projection policy names a role other than the governor';
  end if;
  raise notice 'KLUY-MIGRATION-0187: Booking-Draft projection installed (governor-owned, effect-key exactly-once, newest-version-wins, same-version conflicts quarantined, append-only history, no Booking/price/payment/custody effect)';
end $guard$;
