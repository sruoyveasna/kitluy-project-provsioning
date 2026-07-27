-- kitluy:group:0080
-- Migration group 0080: garment_custody (WS-07-T003, Cycle-6 KLD-2026-07-26-003 §6/§7).
--   kitluy_laundry: booking_production_state, booking_status_history, garments,
--   laundry_tags, garment_scan_events, garment_exceptions,
--   ready_storage_positions, ready_storage_assignments, pickup_handoffs
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
--   (section kitluy_laundry). booking_production_state is a Cycle-6 projection
--   relation not enumerated in DD v1.0.0 — recorded as reconciliation C12
--   (DD amendment REQUIRED; Amendment-001/002 precedent).
-- State contracts: docs/source/business-rules/kitluy-laundry-state-machines-v1.0.0.md
--   §4 + KBR-LND-001..008 — implemented by verticals/phase1-laundry
--   production-state-machine.ts / custody-events.ts (canonical engine; the
--   trigger whitelist below transcribes the SAME forward-only chain).
-- Vocabularies: docs/source/data-contracts/kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md
--   garment_status, garment_scan_type, garment_exception_type,
--   ready_position_status, pickup_handoff_status (approved registries).
--   terminal_role drift: registry T1_POS_CASHIER_INTAKE style vs code-canonical
--   t1_intake_cashier style (KLV4-DEC-005 implementation) — KLREC-2026-07-26-009
--   remains OPEN; the code-canonical identifiers are stored and the rename is
--   a single governed commit after the KL-DEC-001 ballot. No new vocabulary is
--   invented here.
-- Custody model (Cycle-6 §9.1): append-only history; no physical deletes; no
--   last-write-wins (sync CONFLICT_POLICIES custody_pickup =
--   append_only_with_operator_review). T3/T4 SCHEMA support only — NO
--   authoritative Edge/Hub T3/T4 mutation routes this cycle (KL-DEC-001 +
--   BLK-003 fence; internal services/test adapters only).
-- Open owner values referenced and NOT guessed: LND-OD-001..003 (booking
--   policy, promise thresholds, partial pickup / third-party collector),
--   TXN-OD-003. Pickup exception approval THRESHOLDS stay open; the approved
--   exception PATH (supervisor approval) is modeled per KBR-LND-005.
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED). RLS/grants/append-only triggers land in
-- 20260727110095_0095_ws07_ws08_rls.sql (same release train).

begin;

-- ---------------------------------------------------------------------------
-- kitluy_laundry.booking_production_state — Laundry production projection
-- (MC: MUT projection under version compare-and-set; C12 DD amendment pending)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.booking_production_state (
  order_id uuid primary key references kitluy_orders.orders (id),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  production_status text not null default 'RECEIVED',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint booking_production_state_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint booking_production_state_store_order_fk
    foreign key (digital_store_id, order_id)
    references kitluy_orders.orders (digital_store_id, id),
  constraint booking_production_state_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint booking_production_state_status_check check (
    production_status in (
      'RECEIVED', 'WASHING', 'DRYING', 'PRESSING', 'QA_PACKAGING', 'READY',
      'PICKED_UP'
    )
  ),
  constraint booking_production_state_version_check check (version >= 1)
);

create index if not exists booking_production_state_store_idx
  on kitluy_laundry.booking_production_state (digital_store_id);

comment on table kitluy_laundry.booking_production_state is
  'Owner: Laundry Vertical. Booking-level production projection over the owner-canonical KBR-LND §4 forward-only chain (RECEIVED..PICKED_UP), maintained exclusively through the canonical engine command path (markReady/completePickup guards — production-state-machine.ts). Booking-level state is a derived operational summary; garment/custody events remain the detailed evidence (§4 note). Not enumerated in DD v1.0.0 — reconciliation C12, DD amendment REQUIRED. Sensitivity: internal. MC: MUT projection; version optimistic concurrency; forward-only trigger whitelist.';

-- Verbatim §4 forward-only chain (KBR-LND-003); READY/PICKED_UP commits are
-- additionally guarded by the engine (KBR-LND-004/005) in the command path.
create trigger trg_booking_production_state_transitions
  before update on kitluy_laundry.booking_production_state
  for each row execute function kitluy_auth.enforce_status_transition(
    'production_status',
    'RECEIVED:WASHING;WASHING:DRYING;DRYING:PRESSING;PRESSING:QA_PACKAGING;QA_PACKAGING:READY;READY:PICKED_UP'
  );

create trigger trg_booking_production_state_version
  before update on kitluy_laundry.booking_production_state
  for each row execute function kitluy_auth.enforce_version_increment();

create trigger trg_booking_production_state_frozen
  before update on kitluy_laundry.booking_production_state
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'order_id', 'tenant_id', 'digital_store_id', 'created_at'
  );

-- ---------------------------------------------------------------------------
-- kitluy_laundry.booking_status_history — production transition history (A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.booking_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  from_status text,
  to_status text not null,
  reason_code text,
  actor_user_id uuid references auth.users (id),
  actor_service_key text,
  device_id uuid,
  idempotency_key text,
  aggregate_version bigint not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  constraint booking_status_history_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint booking_status_history_from_check check (
    from_status is null or from_status in (
      'RECEIVED', 'WASHING', 'DRYING', 'PRESSING', 'QA_PACKAGING', 'READY',
      'PICKED_UP'
    )
  ),
  constraint booking_status_history_to_check check (
    to_status in (
      'RECEIVED', 'WASHING', 'DRYING', 'PRESSING', 'QA_PACKAGING', 'READY',
      'PICKED_UP'
    )
  ),
  constraint booking_status_history_version_check check (aggregate_version >= 1)
);

create unique index if not exists booking_status_history_idempotency_key
  on kitluy_laundry.booking_status_history (order_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists booking_status_history_order_id_idx
  on kitluy_laundry.booking_status_history (order_id);

comment on table kitluy_laundry.booking_status_history is
  'Owner: Laundry Vertical. Append-only Booking production transition history (DD kitluy_laundry.booking_status_history). Records the engine-decided §4 transitions with actor/device context, Booking aggregate_version at capture and a per-Booking idempotency key (duplicate replay creates no second row — KBR-LND-004 TV3 service mapping, WS-07-T001 review RV-003). Sensitivity: internal. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_laundry.garments — Garment/bag/custody-container identity (MC: MUT
-- identity-frozen; status per garment_status registry)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.garments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  unit_kind text not null,
  container_id uuid,
  tag_code text,
  garment_type text,
  fabric text,
  color text,
  intake_notes text,
  piece_count bigint,
  status text not null default 'RECEIVED',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint garments_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint garments_unit_kind_check check (
    unit_kind in ('GARMENT_GROUP', 'GARMENT_ITEM', 'CUSTODY_CONTAINER')
  ),
  constraint garments_piece_count_check check (
    piece_count is null or piece_count > 0
  ),
  constraint garments_status_check check (
    status in (
      'RECEIVED', 'TAGGED', 'WASHING', 'DRYING', 'PRESSING', 'QA', 'PACKED',
      'READY', 'RELEASED', 'EXCEPTION'
    )
  ),
  constraint garments_version_check check (version >= 1)
);

create unique index if not exists garments_order_id_id_key
  on kitluy_laundry.garments (order_id, id);

-- Custody containers must belong to the same Booking (child cannot escape).
alter table kitluy_laundry.garments
  add constraint garments_same_order_container_fk
  foreign key (order_id, container_id)
  references kitluy_laundry.garments (order_id, id);

create unique index if not exists garments_active_tag_code_key
  on kitluy_laundry.garments (tenant_id, tag_code)
  where tag_code is not null and status <> 'RELEASED';

create index if not exists garments_order_id_idx
  on kitluy_laundry.garments (order_id);

comment on table kitluy_laundry.garments is
  'Owner: Laundry Vertical. Garment/bag identity (DD kitluy_laundry.garments): unit_kind distinguishes garment groups, individually tracked garment items and bags/custody containers (Cycle-6 §9 vocabulary over the single DD identity relation — recorded in C12). container_id keeps custody containment inside the same Booking (composite same-order FK); container unit_kind consistency is validated by the custody command service. Status vocabulary: enum registry garment_status. Active tag codes are unique per Tenant. Sensitivity: internal. MC: MUT with identity freeze + version optimistic concurrency (trigger).';

create trigger trg_garments_frozen
  before update on kitluy_laundry.garments
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'order_id', 'unit_kind', 'created_at'
  );

create trigger trg_garments_version
  before update on kitluy_laundry.garments
  for each row execute function kitluy_auth.enforce_version_increment();

-- ---------------------------------------------------------------------------
-- kitluy_laundry.laundry_tags — Printed tag versions/replacements (MC: IMM-V;
-- voiding is the only mutation, via replacement)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.laundry_tags (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  garment_id uuid,
  tag_code text not null,
  template_version text,
  print_job_id uuid,
  replaces_tag_id uuid references kitluy_laundry.laundry_tags (id),
  replacement_reason_code text,
  issued_by uuid references auth.users (id),
  issued_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  constraint laundry_tags_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint laundry_tags_same_order_garment_fk
    foreign key (order_id, garment_id)
    references kitluy_laundry.garments (order_id, id),
  constraint laundry_tags_tag_code_check check (length(trim(tag_code)) > 0),
  constraint laundry_tags_replacement_reason_check check (
    replaces_tag_id is null
    or (replacement_reason_code is not null and length(trim(replacement_reason_code)) > 0)
  ),
  constraint laundry_tags_void_pair_check check (
    (voided_at is null) = (voided_by is null)
  )
);

create unique index if not exists laundry_tags_active_code_key
  on kitluy_laundry.laundry_tags (tenant_id, tag_code)
  where voided_at is null;

create index if not exists laundry_tags_order_id_idx
  on kitluy_laundry.laundry_tags (order_id);

comment on table kitluy_laundry.laundry_tags is
  'Owner: Laundry Vertical. Printed tag issue/void/replacement records (DD kitluy_laundry.laundry_tags). A replacement issues a NEW tag row referencing the voided predecessor with a mandatory reason (reason-code family "garment issue…" — values seed in group 0150). Active tag codes unique per Tenant. Sensitivity: internal. MC: IMM-V — rows are frozen except the one-time voiding pair (trigger).';

-- Tags: identity frozen; the only permitted update is the one-time voiding.
create or replace function kitluy_laundry.enforce_tag_void_only()
returns trigger
language plpgsql
set search_path = kitluy_laundry, pg_catalog
as $$
begin
  if old.voided_at is not null then
    raise exception
      'KLUY-LND-TAG-FROZEN: a voided tag row is immutable'
      using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.order_id is distinct from old.order_id
    or new.garment_id is distinct from old.garment_id
    or new.tag_code is distinct from old.tag_code
    or new.template_version is distinct from old.template_version
    or new.print_job_id is distinct from old.print_job_id
    or new.replaces_tag_id is distinct from old.replaces_tag_id
    or new.replacement_reason_code is distinct from old.replacement_reason_code
    or new.issued_by is distinct from old.issued_by
    or new.issued_at is distinct from old.issued_at then
    raise exception
      'KLUY-LND-TAG-IMMUTABLE: tag identity columns are immutable; issue a replacement tag instead'
      using errcode = 'P0001';
  end if;
  if new.voided_at is null then
    raise exception
      'KLUY-LND-TAG-VOID-ONLY: the only permitted tag mutation is the one-time voiding pair'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_laundry.enforce_tag_void_only() is
  'Tag rows are immutable except the one-time (voided_at, voided_by) pair set during governed replacement (KBR-LND custody evidence).';

create trigger trg_laundry_tags_void_only
  before update on kitluy_laundry.laundry_tags
  for each row execute function kitluy_laundry.enforce_tag_void_only();

-- ---------------------------------------------------------------------------
-- kitluy_laundry.garment_scan_events — Append-only chain of custody (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.garment_scan_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  order_id uuid not null references kitluy_orders.orders (id),
  garment_id uuid,
  scan_type text not null,
  terminal_role text not null,
  from_state text,
  to_state text,
  storage_position_id uuid,
  actor_user_id uuid references auth.users (id),
  actor_service_key text,
  device_id uuid,
  reason_code text,
  idempotency_key text not null,
  aggregate_version bigint not null,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  metadata jsonb,
  constraint garment_scan_events_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint garment_scan_events_store_order_fk
    foreign key (digital_store_id, order_id)
    references kitluy_orders.orders (digital_store_id, id),
  constraint garment_scan_events_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint garment_scan_events_same_order_garment_fk
    foreign key (order_id, garment_id)
    references kitluy_laundry.garments (order_id, id),
  constraint garment_scan_events_tenant_idempotency_key
    unique (tenant_id, idempotency_key),
  constraint garment_scan_events_scan_type_check check (
    scan_type in (
      'INTAKE', 'WASH_START', 'WASH_COMPLETE', 'DRY_START', 'DRY_COMPLETE',
      'PRESS_START', 'PRESS_COMPLETE', 'QA_PASS', 'QA_FAIL', 'READY_SCAN_IN',
      'PICKUP_SCAN_OUT', 'REWASH', 'ISSUE'
    )
  ),
  -- T2 is customer-facing only and never owns a custody event (RB v4 §5.3;
  -- terminal identifiers are the code-canonical KLV4-DEC-005 set; KLREC-009
  -- rename stays fenced behind the KL-DEC-001 ballot).
  constraint garment_scan_events_terminal_role_check check (
    terminal_role in ('t1_intake_cashier', 't3_ready_scan_in', 't4_pickup_scan_out')
  ),
  -- KBR-LND-004/005: Ready scan-in is T3-only; pickup scan-out is T4-only.
  constraint garment_scan_events_t3_only_check check (
    scan_type <> 'READY_SCAN_IN' or terminal_role = 't3_ready_scan_in'
  ),
  constraint garment_scan_events_t4_only_check check (
    scan_type <> 'PICKUP_SCAN_OUT' or terminal_role = 't4_pickup_scan_out'
  ),
  constraint garment_scan_events_from_state_check check (
    from_state is null or from_state in (
      'RECEIVED', 'TAGGED', 'WASHING', 'DRYING', 'PRESSING', 'QA', 'PACKED',
      'READY', 'RELEASED', 'EXCEPTION'
    )
  ),
  constraint garment_scan_events_to_state_check check (
    to_state is null or to_state in (
      'RECEIVED', 'TAGGED', 'WASHING', 'DRYING', 'PRESSING', 'QA', 'PACKED',
      'READY', 'RELEASED', 'EXCEPTION'
    )
  ),
  constraint garment_scan_events_version_check check (aggregate_version >= 1)
);

create index if not exists garment_scan_events_order_id_idx
  on kitluy_laundry.garment_scan_events (order_id);

create index if not exists garment_scan_events_garment_id_idx
  on kitluy_laundry.garment_scan_events (garment_id);

comment on table kitluy_laundry.garment_scan_events is
  'Owner: Laundry Vertical. Append-only chain-of-custody scan events (DD kitluy_laundry.garment_scan_events; Hub spec §10.3-10.4; RB v4 §5.6 append-only custody). Every event carries Tenant/Store/Location scope (composite FKs — a custody event cannot escape its Booking Store or name a foreign Location), previous/new custody state (garment_status registry), actor + device context, business (occurred_at) vs record (recorded_at) timestamps, mandatory Tenant-scoped idempotency key (duplicate scan replays create no second event) and the Booking aggregate_version at capture. Internal record only — public custody event contracts stay fenced (KL-DEC-001/KLREC-011; outbox publication disabled). No physical delete; no last-write-wins (sync policy custody_pickup = append_only_with_operator_review). Sensitivity: internal. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_laundry.garment_exceptions — Issue/rewash/damage/discrepancy (MC:
-- MUT until resolved, then frozen)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.garment_exceptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  garment_id uuid,
  exception_type text not null,
  severity text,
  description text not null,
  blocking boolean not null default true,
  opened_by uuid references auth.users (id),
  opened_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  resolution_reason_code text,
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  constraint garment_exceptions_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint garment_exceptions_same_order_garment_fk
    foreign key (order_id, garment_id)
    references kitluy_laundry.garments (order_id, id),
  constraint garment_exceptions_type_check check (
    exception_type in (
      'MISSING', 'EXTRA', 'DAMAGED', 'REWASH', 'MISMATCH', 'UNREADABLE_TAG',
      'QUALITY_HOLD', 'CUSTOMER_DISPUTE'
    )
  ),
  constraint garment_exceptions_description_check check (
    length(trim(description)) > 0
  ),
  constraint garment_exceptions_resolution_pair_check check (
    (resolved_at is null) = (resolved_by is null)
  ),
  constraint garment_exceptions_resolution_reason_check check (
    resolved_at is null
    or (resolution_reason_code is not null and length(trim(resolution_reason_code)) > 0)
  )
);

create index if not exists garment_exceptions_order_id_idx
  on kitluy_laundry.garment_exceptions (order_id);

comment on table kitluy_laundry.garment_exceptions is
  'Owner: Laundry Vertical. Issue/rewash/damage/count-discrepancy lifecycle (DD kitluy_laundry.garment_exceptions; vocabulary: enum registry garment_exception_type — MISSING/EXTRA/MISMATCH cover custody and count discrepancies, Cycle-6 §9). Blocking exceptions prevent Ready unless approved override (DD invariant; KBR-LND-004). Resolution requires actor + reason; resolved rows freeze (trigger). Sensitivity: internal. MC: MUT until resolved, then IMM.';

create or replace function kitluy_laundry.enforce_exception_resolution()
returns trigger
language plpgsql
set search_path = kitluy_laundry, pg_catalog
as $$
begin
  if old.resolved_at is not null then
    raise exception
      'KLUY-LND-EXCEPTION-FROZEN: a resolved garment exception is immutable; open a new exception or a custody incident'
      using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.order_id is distinct from old.order_id
    or new.garment_id is distinct from old.garment_id
    or new.exception_type is distinct from old.exception_type
    or new.opened_by is distinct from old.opened_by
    or new.opened_at is distinct from old.opened_at then
    raise exception
      'KLUY-LND-EXCEPTION-IMMUTABLE: garment exception identity columns are immutable'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_laundry.enforce_exception_resolution() is
  'Garment exceptions: identity frozen; resolved exceptions immutable (compensating records for later corrections).';

create trigger trg_garment_exceptions_resolution
  before update on kitluy_laundry.garment_exceptions
  for each row execute function kitluy_laundry.enforce_exception_resolution();

-- ---------------------------------------------------------------------------
-- kitluy_laundry.ready_storage_positions — Ready storage locations (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.ready_storage_positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  position_code text not null,
  position_type text,
  status text not null default 'AVAILABLE',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ready_storage_positions_location_code_key
    unique (store_location_id, position_code),
  constraint ready_storage_positions_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint ready_storage_positions_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint ready_storage_positions_code_check check (
    length(trim(position_code)) > 0
  ),
  constraint ready_storage_positions_status_check check (
    status in ('AVAILABLE', 'OCCUPIED', 'BLOCKED', 'MAINTENANCE')
  ),
  constraint ready_storage_positions_version_check check (version >= 1)
);

create index if not exists ready_storage_positions_location_idx
  on kitluy_laundry.ready_storage_positions (store_location_id);

comment on table kitluy_laundry.ready_storage_positions is
  'Owner: Laundry Vertical. Ready storage positions per Store Location (DD kitluy_laundry.ready_storage_positions; vocabulary: enum registry ready_position_status). Location-scoped codes; composite FKs keep positions inside their Store. Sensitivity: internal. MC: CFG-V (version optimistic concurrency).';

-- Late FK: garment_scan_events.storage_position_id references positions
-- (declared after the positions table exists in this same group).
alter table kitluy_laundry.garment_scan_events
  add constraint garment_scan_events_storage_position_fk
  foreign key (storage_position_id)
  references kitluy_laundry.ready_storage_positions (id);

create trigger trg_ready_storage_positions_version
  before update on kitluy_laundry.ready_storage_positions
  for each row execute function kitluy_auth.enforce_version_increment();

create trigger trg_ready_storage_positions_frozen
  before update on kitluy_laundry.ready_storage_positions
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'store_location_id', 'position_code',
    'created_at'
  );

-- ---------------------------------------------------------------------------
-- kitluy_laundry.ready_storage_assignments — Ready custody assignments (MC:
-- assignment frozen; one-time clearing pair)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.ready_storage_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  position_id uuid not null references kitluy_laundry.ready_storage_positions (id),
  garment_id uuid,
  assigned_by uuid references auth.users (id),
  assigned_device_id uuid,
  assigned_at timestamptz not null default now(),
  cleared_by uuid references auth.users (id),
  cleared_device_id uuid,
  cleared_at timestamptz,
  clear_reason_code text,
  constraint ready_storage_assignments_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint ready_storage_assignments_same_order_garment_fk
    foreign key (order_id, garment_id)
    references kitluy_laundry.garments (order_id, id),
  constraint ready_storage_assignments_clear_pair_check check (
    (cleared_at is null) = (cleared_by is null)
  ),
  constraint ready_storage_assignments_clear_reason_check check (
    cleared_at is null
    or (clear_reason_code is not null and length(trim(clear_reason_code)) > 0)
  )
);

create unique index if not exists ready_storage_assignments_active_position_key
  on kitluy_laundry.ready_storage_assignments (position_id)
  where cleared_at is null;

create index if not exists ready_storage_assignments_order_id_idx
  on kitluy_laundry.ready_storage_assignments (order_id);

comment on table kitluy_laundry.ready_storage_assignments is
  'Owner: Laundry Vertical. Ready custody storage assignments (DD kitluy_laundry.ready_storage_assignments; KBR-LND-004: storage assignment is part of the T3 Ready commit). One active assignment per position (partial unique). Assignment identity is frozen; the only mutation is the one-time clearing pair with mandatory reason (T4 storage_position_cleared or governed movement). Storage movement = clear + new assignment row, never rewrite. Sensitivity: internal. MC: IMM-V.';

create or replace function kitluy_laundry.enforce_assignment_clear_only()
returns trigger
language plpgsql
set search_path = kitluy_laundry, pg_catalog
as $$
begin
  if old.cleared_at is not null then
    raise exception
      'KLUY-LND-ASSIGNMENT-FROZEN: a cleared storage assignment is immutable'
      using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.order_id is distinct from old.order_id
    or new.position_id is distinct from old.position_id
    or new.garment_id is distinct from old.garment_id
    or new.assigned_by is distinct from old.assigned_by
    or new.assigned_device_id is distinct from old.assigned_device_id
    or new.assigned_at is distinct from old.assigned_at then
    raise exception
      'KLUY-LND-ASSIGNMENT-IMMUTABLE: storage assignment identity columns are immutable'
      using errcode = 'P0001';
  end if;
  if new.cleared_at is null then
    raise exception
      'KLUY-LND-ASSIGNMENT-CLEAR-ONLY: the only permitted mutation is the one-time clearing pair'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_laundry.enforce_assignment_clear_only() is
  'Storage assignments: identity frozen; one-time clearing pair only (custody movement appends a new assignment).';

create trigger trg_ready_storage_assignments_clear_only
  before update on kitluy_laundry.ready_storage_assignments
  for each row execute function kitluy_laundry.enforce_assignment_clear_only();

-- ---------------------------------------------------------------------------
-- kitluy_laundry.pickup_handoffs — T4 pickup custody release (MC: MUT until
-- COMPLETED, then frozen)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.pickup_handoffs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  order_id uuid not null references kitluy_orders.orders (id),
  status text not null default 'AWAITING_RETRIEVAL',
  collector_verified boolean not null default false,
  collector_verified_by uuid references auth.users (id),
  collector_reference text,
  balance_settled boolean not null default false,
  release_completeness_verified boolean not null default false,
  exception_reason_code text,
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  released_by uuid references auth.users (id),
  released_device_id uuid,
  handed_over_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pickup_handoffs_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint pickup_handoffs_store_order_fk
    foreign key (digital_store_id, order_id)
    references kitluy_orders.orders (digital_store_id, id),
  constraint pickup_handoffs_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint pickup_handoffs_status_check check (
    status in (
      'AWAITING_RETRIEVAL', 'AWAITING_VERIFICATION', 'PAYMENT_BLOCKED',
      'READY_TO_RELEASE', 'COMPLETED', 'EXCEPTION'
    )
  ),
  -- KBR-LND-005: completion requires verified collector, release completeness
  -- and settled balance OR an approved exception (supervisor approval —
  -- thresholds remain open owner value LND-OD-003; no exception is invented).
  constraint pickup_handoffs_completion_check check (
    status <> 'COMPLETED'
    or (
      collector_verified
      and release_completeness_verified
      and (balance_settled or approval_request_id is not null)
      and released_by is not null
      and handed_over_at is not null
    )
  ),
  constraint pickup_handoffs_exception_reason_check check (
    status not in ('EXCEPTION', 'PAYMENT_BLOCKED')
    or (exception_reason_code is not null and length(trim(exception_reason_code)) > 0)
  )
);

create unique index if not exists pickup_handoffs_open_order_key
  on kitluy_laundry.pickup_handoffs (order_id)
  where status not in ('COMPLETED', 'EXCEPTION');

create index if not exists pickup_handoffs_order_id_idx
  on kitluy_laundry.pickup_handoffs (order_id);

comment on table kitluy_laundry.pickup_handoffs is
  'Owner: Laundry Vertical. T4 customer pickup custody release records (DD kitluy_laundry.pickup_handoffs; vocabulary: enum registry pickup_handoff_status incl. PAYMENT_BLOCKED). Completion is CHECK-guarded per KBR-LND-005: collector verified + release completeness (WS-07-T001 RV-001) + balance settled OR approved payment exception (approval_request_id; thresholds open — LND-OD-003). Only T4 completes pickup (engine completePickup guard in the command path; Portal/remote completion impossible — no client write policies). COMPLETED rows freeze (trigger); incorrect release becomes a custody incident, never a delete. Sensitivity: internal. MC: MUT until COMPLETED, then IMM.';

create or replace function kitluy_laundry.enforce_handoff_completion()
returns trigger
language plpgsql
set search_path = kitluy_laundry, pg_catalog
as $$
begin
  if old.status in ('COMPLETED', 'EXCEPTION') and new.status is distinct from old.status then
    raise exception
      'KLUY-LND-HANDOFF-FROZEN: a % pickup handoff record is final; corrections use a custody incident (KBR-LND-005 compensating action)',
      old.status
      using errcode = 'P0001';
  end if;
  if old.status = 'COMPLETED' then
    raise exception
      'KLUY-LND-HANDOFF-IMMUTABLE: a completed pickup release record is immutable'
      using errcode = 'P0001';
  end if;
  if new.id is distinct from old.id
    or new.tenant_id is distinct from old.tenant_id
    or new.digital_store_id is distinct from old.digital_store_id
    or new.store_location_id is distinct from old.store_location_id
    or new.order_id is distinct from old.order_id
    or new.created_at is distinct from old.created_at then
    raise exception
      'KLUY-LND-HANDOFF-IDENTITY-FROZEN: pickup handoff identity columns are immutable'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_laundry.enforce_handoff_completion() is
  'Pickup handoffs: identity frozen; COMPLETED/EXCEPTION records are final (custody incidents compensate, never deletes — KBR-LND-005).';

create trigger trg_pickup_handoffs_completion
  before update on kitluy_laundry.pickup_handoffs
  for each row execute function kitluy_laundry.enforce_handoff_completion();

commit;
