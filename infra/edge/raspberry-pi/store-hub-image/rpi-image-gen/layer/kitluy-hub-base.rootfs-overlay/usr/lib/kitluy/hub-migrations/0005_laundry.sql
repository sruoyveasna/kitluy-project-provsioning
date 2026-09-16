-- kitluy:hub:migration:0005
-- ===========================================================================
-- KitLuy Store Hub local database — edge_laundry (§6.4, 12 relations).
--
-- Mapping to cloud (reconciliation §2):
--   kitluy_orders.orders            -> edge_laundry.booking          (R3)
--   kitluy_orders.order_lines       -> edge_laundry.booking_line
--   kitluy_orders.order_events      -> edge_laundry.status_event
--   kitluy_laundry.garments         -> edge_laundry.garment + .bag   (R2, by unit_kind)
--   kitluy_laundry.laundry_tags     -> edge_laundry.tag
--   kitluy_laundry.garment_scan_events      -> edge_laundry.custody_event
--   kitluy_laundry.garment_exceptions       -> edge_laundry.exception
--   kitluy_laundry.ready_storage_positions  -> edge_laundry.storage_position
--   kitluy_laundry.ready_storage_assignments-> edge_laundry.storage_assignment
--   kitluy_laundry.pickup_handoffs          -> edge_laundry.pickup_session
--   (Hub-only)                              -> edge_laundry.ready_scan_session
--   kitluy_laundry.booking_production_state -> projection on booking.status
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_laundry.booking
--
-- ADDITIVE COLUMN refunded_minor (reconciliation R4): the canonical §6.4
-- balance CHECK references refunded_minor while the column list omits it.
-- The column IS required for the CHECK to be expressible; recorded as a
-- defect of the canonical document with an amendment owed.
-- ---------------------------------------------------------------------------
create table edge_laundry.booking (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  booking_number     text        not null,
  customer_id        uuid        null references edge_core.customer (id),
  status             text        not null,
  business_date      date        not null,
  currency_code      char(3)     not null,
  currency_exponent  smallint    not null,
  subtotal_minor     bigint      not null,
  discount_minor     bigint      not null default 0,
  tax_minor          bigint      not null default 0,
  total_minor        bigint      not null,
  paid_minor         bigint      not null default 0,
  refunded_minor     bigint      not null default 0,
  balance_minor      bigint      not null,
  due_at             timestamptz null,
  pickup_method      text        not null,
  config_snapshot_id uuid        not null references edge_config.configuration_snapshot (id),
  aggregate_version  bigint      not null default 1,
  created_at         timestamptz not null,
  updated_at         timestamptz not null,
  constraint booking_number_uq unique (location_id, booking_number),
  constraint booking_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint booking_exponent_ck check (currency_exponent between 0 and 4),
  constraint booking_aggregate_version_ck check (aggregate_version >= 1),
  constraint booking_amounts_ck
    check (subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0
           and total_minor >= 0 and paid_minor >= 0 and refunded_minor >= 0),
  -- §6.4 verbatim: balance_minor = total_minor - paid_minor + refunded_minor.
  constraint booking_balance_ck
    check (balance_minor = total_minor - paid_minor + refunded_minor)
);

comment on table edge_laundry.booking is
  'Laundry Booking aggregate (§6.4). Vertical placement is the accepted asymmetry R3: the Hub is a single-vertical appliance, so its Booking lives in the vertical schema while cloud keeps the neutral kitluy_orders.orders.';
comment on column edge_laundry.booking.refunded_minor is
  'ADDITIVE EXTENSION (reconciliation R4 / gap G3 family): required by the canonical §6.4 balance CHECK but absent from its column list. Amendment to the canonical document is owed.';
comment on column edge_laundry.booking.aggregate_version is
  'Optimistic concurrency (offline contract §6): starts at 1, +1 per accepted domain event. Stale expected_version is rejected BEFORE any business effect.';
comment on column edge_laundry.booking.status is
  'Projection from status_event (reconciliation §2: cloud kitluy_laundry.booking_production_state is a projection on this column here).';

-- ---------------------------------------------------------------------------
-- edge_laundry.booking_line
-- ---------------------------------------------------------------------------
create table edge_laundry.booking_line (
  id                    uuid           primary key,
  tenant_id             uuid           not null,
  digital_store_id      uuid           not null,
  location_id           uuid           not null,
  booking_id            uuid           not null references edge_laundry.booking (id),
  service_id            uuid           not null,
  service_version       bigint         not null,
  display_name          text           not null,
  pricing_method        text           not null,
  unit_price_minor      bigint         not null,
  currency_code         char(3)        not null,
  currency_exponent     smallint       not null,
  quantity              numeric(18,4)  not null,
  unit_code             text           not null,
  line_subtotal_minor   bigint         not null,
  discount_minor        bigint         not null default 0,
  tax_minor             bigint         not null default 0,
  line_total_minor      bigint         not null,
  addon_snapshot_json   jsonb          not null default '{}'::jsonb,
  source_config_version bigint         not null,
  created_at            timestamptz    not null,
  constraint booking_line_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint booking_line_exponent_ck check (currency_exponent between 0 and 4),
  constraint booking_line_quantity_ck check (quantity > 0),
  constraint booking_line_amounts_ck
    check (unit_price_minor >= 0 and line_subtotal_minor >= 0
           and discount_minor >= 0 and tax_minor >= 0 and line_total_minor >= 0),
  constraint booking_line_total_ck
    check (line_total_minor = line_subtotal_minor - discount_minor + tax_minor)
);

comment on table edge_laundry.booking_line is
  'Priced Booking line (§6.4). "Confirmed lines are immutable" — the no-hard-delete trigger is attached in 0012 and confirmation immutability is enforced by the command layer (§9).';
comment on column edge_laundry.booking_line.quantity is
  'numeric(18,4) per §1 "Quantities and weights; never floating point" (weight-based Laundry pricing).';

-- ---------------------------------------------------------------------------
-- edge_laundry.garment  (cloud unit_kind GARMENT_ITEM / GARMENT_GROUP — R2)
-- ---------------------------------------------------------------------------
create table edge_laundry.garment (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  booking_id            uuid        not null references edge_laundry.booking (id),
  booking_line_id       uuid        null references edge_laundry.booking_line (id),
  garment_code          text        not null,
  garment_type          text        not null,
  color                 text        null,
  condition_code        text        null,
  special_handling      text        null,
  current_custody_state text        not null,
  created_at            timestamptz not null,
  constraint garment_code_uq unique (location_id, garment_code)
);

comment on table edge_laundry.garment is
  'Individually tracked garment (§6.4). Reconciliation R2: cloud kitluy_laundry.garments rows with unit_kind GARMENT_ITEM/GARMENT_GROUP map here.';

-- ---------------------------------------------------------------------------
-- edge_laundry.bag  (cloud unit_kind CUSTODY_CONTAINER — R2)
-- ---------------------------------------------------------------------------
create table edge_laundry.bag (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  booking_id            uuid        not null references edge_laundry.booking (id),
  bag_code              text        not null,
  expected_piece_count  integer     null,
  current_piece_count   integer     null,
  current_custody_state text        not null,
  created_at            timestamptz not null,
  constraint bag_code_uq unique (location_id, bag_code),
  constraint bag_counts_ck
    check ((expected_piece_count is null or expected_piece_count >= 0)
           and (current_piece_count is null or current_piece_count >= 0))
);

comment on table edge_laundry.bag is
  'Custody container (§6.4). Reconciliation R2: cloud kitluy_laundry.garments rows with unit_kind CUSTODY_CONTAINER map here.';

-- ---------------------------------------------------------------------------
-- edge_laundry.tag
-- ---------------------------------------------------------------------------
create table edge_laundry.tag (
  id          uuid        primary key,
  tenant_id   uuid        not null,
  digital_store_id uuid   not null,
  location_id uuid        not null,
  booking_id  uuid        not null references edge_laundry.booking (id),
  garment_id  uuid        null references edge_laundry.garment (id),
  bag_id      uuid        null references edge_laundry.bag (id),
  tag_code    text        not null,
  tag_type    text        not null,
  issued_at   timestamptz not null,
  voided_at   timestamptz null,
  void_reason text        null,
  constraint tag_code_uq unique (location_id, tag_code),
  constraint tag_subject_ck check (num_nonnulls(garment_id, bag_id) <= 1),
  constraint tag_void_ck check ((voided_at is null) = (void_reason is null))
);

comment on table edge_laundry.tag is
  'Physical tag issued for a garment, bag or Booking (§6.4). Display profile KLT-{LOCATION_CODE}-{BASE32_UUID10} (Appendix B). Voiding is a lifecycle state, never a delete.';

-- ---------------------------------------------------------------------------
-- edge_laundry.status_event — APPEND-ONLY (§6.4).
-- ---------------------------------------------------------------------------
create table edge_laundry.status_event (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  booking_id         uuid        not null references edge_laundry.booking (id),
  from_status        text        null,
  to_status          text        not null,
  reason_code        text        null,
  actor_id           uuid        not null,
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  occurred_at        timestamptz not null,
  local_sequence     bigint      not null,
  event_id           uuid        not null unique,
  constraint status_event_sequence_ck check (local_sequence >= 1)
);

comment on table edge_laundry.status_event is
  'Append-only Booking lifecycle history (§6.4; maps to cloud kitluy_orders.order_events). UPDATE/DELETE are rejected by the trigger attached in 0012; corrections are compensating events.';

-- ---------------------------------------------------------------------------
-- edge_laundry.exception
-- ---------------------------------------------------------------------------
create table edge_laundry.exception (
  id                uuid        primary key,
  tenant_id         uuid        not null,
  digital_store_id  uuid        not null,
  location_id       uuid        not null,
  booking_id        uuid        not null references edge_laundry.booking (id),
  garment_id        uuid        null references edge_laundry.garment (id),
  bag_id            uuid        null references edge_laundry.bag (id),
  exception_type    text        not null,
  severity          text        not null,
  blocking          boolean     not null,
  status            text        not null,
  note              text        null,
  evidence_asset_id uuid        null,
  created_by        uuid        not null,
  created_at        timestamptz not null,
  resolved_by       uuid        null,
  resolved_at       timestamptz null,
  resolution_code   text        null,
  constraint exception_subject_ck check (num_nonnulls(garment_id, bag_id) <= 1),
  constraint exception_resolution_ck
    check ((resolved_at is null) = (resolved_by is null)
           and (resolved_at is null or resolution_code is not null))
);

comment on table edge_laundry.exception is
  'Garment/bag exception (§6.4; maps to cloud kitluy_laundry.garment_exceptions). A BLOCKING unresolved exception must fail the T4 completion gate (§12 acceptance test 5). evidence_asset_id references edge_files.asset; the FK is added in 0012 because edge_files is created later (§4 order).';

-- ---------------------------------------------------------------------------
-- edge_laundry.storage_position
-- ---------------------------------------------------------------------------
create table edge_laundry.storage_position (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  position_code      text        not null,
  position_type      text        not null,
  zone_code          text        null,
  capacity           integer     not null default 1,
  status             text        not null,
  record_version     bigint      not null default 1,
  source_snapshot_id uuid        not null references edge_config.configuration_snapshot (id),
  updated_at         timestamptz not null,
  constraint storage_position_code_uq unique (location_id, position_code),
  constraint storage_position_capacity_ck check (capacity >= 1),
  constraint storage_position_record_version_ck check (record_version >= 1)
);

comment on table edge_laundry.storage_position is
  'Ready storage position (§6.4; maps to cloud kitluy_laundry.ready_storage_positions). capacity is enforced by the trigger in 0012 (§12 acceptance test 4).';

-- ---------------------------------------------------------------------------
-- edge_laundry.storage_assignment
-- ---------------------------------------------------------------------------
create table edge_laundry.storage_assignment (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  booking_id          uuid        not null references edge_laundry.booking (id),
  garment_id          uuid        null references edge_laundry.garment (id),
  bag_id              uuid        null references edge_laundry.bag (id),
  storage_position_id uuid        not null references edge_laundry.storage_position (id),
  assigned_at         timestamptz not null,
  assigned_by         uuid        not null,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  cleared_at          timestamptz null,
  cleared_by          uuid        null,
  clear_reason        text        null,
  assignment_event_id uuid        not null unique,
  constraint storage_assignment_subject_ck check (num_nonnulls(garment_id, bag_id) = 1),
  constraint storage_assignment_clear_ck
    check ((cleared_at is null) = (cleared_by is null)
           and (cleared_at is null or clear_reason is not null)
           and (cleared_at is null or cleared_at >= assigned_at))
);

comment on table edge_laundry.storage_assignment is
  'Ready storage occupancy (§6.4; maps to cloud kitluy_laundry.ready_storage_assignments). Partial unique indexes in 0012 prevent more than one ACTIVE assignment per stored unit; the capacity trigger prevents over-capacity assignment.';

-- ---------------------------------------------------------------------------
-- edge_laundry.custody_event — APPEND-ONLY (§6.4).
-- ---------------------------------------------------------------------------
create table edge_laundry.custody_event (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  booking_id          uuid        not null references edge_laundry.booking (id),
  garment_id          uuid        null references edge_laundry.garment (id),
  bag_id              uuid        null references edge_laundry.bag (id),
  event_type          text        not null,
  from_custody_state  text        null,
  to_custody_state    text        not null,
  storage_position_id uuid        null references edge_laundry.storage_position (id),
  actor_id            uuid        not null,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  session_id          uuid        not null,
  occurred_at         timestamptz not null,
  local_sequence      bigint      not null,
  reason_code         text        null,
  payload_sha256      char(64)    not null,
  event_id            uuid        not null unique,
  constraint custody_event_subject_ck check (num_nonnulls(garment_id, bag_id) <= 1),
  constraint custody_event_sequence_ck check (local_sequence >= 1),
  constraint custody_event_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table edge_laundry.custody_event is
  'Append-only custody chain (§6.4; maps to cloud kitluy_laundry.garment_scan_events). Every custody change records the unit, from->to state, actor, device, session, Booking, event time, local sequence, reason and payload hash. UPDATE/DELETE rejected by the trigger in 0012.';

-- ---------------------------------------------------------------------------
-- edge_laundry.ready_scan_session — Hub-only working session (no cloud
-- counterpart; its OUTCOME syncs as custody events — reconciliation §2).
-- ---------------------------------------------------------------------------
create table edge_laundry.ready_scan_session (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  booking_id         uuid        not null references edge_laundry.booking (id),
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  actor_id           uuid        not null,
  started_at         timestamptz not null,
  completed_at       timestamptz null,
  expected_count     integer     not null,
  scanned_count      integer     not null default 0,
  qa_state           text        not null,
  storage_state      text        not null,
  status             text        not null,
  idempotency_key    text        not null unique,
  constraint ready_scan_session_counts_ck check (expected_count >= 0 and scanned_count >= 0),
  constraint ready_scan_session_window_ck check (completed_at is null or completed_at >= started_at),
  -- Offline contract §2 / gap G1: kl1.{terminal_device_uuid}.{client_sequence}
  constraint ready_scan_session_idempotency_key_ck
    check (edge_sync.is_canonical_idempotency_key(idempotency_key))
);

comment on table edge_laundry.ready_scan_session is
  'T3 Clean & Ready scan-in session (§6.4). Terminal profile contract §4: T3 records Ready intake and may NOT release garments.';

-- ---------------------------------------------------------------------------
-- edge_laundry.pickup_session
-- ---------------------------------------------------------------------------
create table edge_laundry.pickup_session (
  id                           uuid        primary key,
  tenant_id                    uuid        not null,
  digital_store_id             uuid        not null,
  location_id                  uuid        not null,
  booking_id                   uuid        not null references edge_laundry.booking (id),
  terminal_device_id           uuid        not null references edge_identity.terminal_device (id),
  actor_id                     uuid        not null,
  started_at                   timestamptz not null,
  collector_verification_method text       null,
  collector_verified_at        timestamptz null,
  expected_count               integer     not null,
  scanned_count                integer     not null default 0,
  payment_gate_state           text        not null,
  completed_at                 timestamptz null,
  status                       text        not null,
  idempotency_key              text        not null unique,
  constraint pickup_session_counts_ck check (expected_count >= 0 and scanned_count >= 0),
  constraint pickup_session_window_ck check (completed_at is null or completed_at >= started_at),
  constraint pickup_session_collector_ck
    check ((collector_verified_at is null) = (collector_verification_method is null)),
  constraint pickup_session_idempotency_key_ck
    check (edge_sync.is_canonical_idempotency_key(idempotency_key))
);

comment on table edge_laundry.pickup_session is
  'T4 pickup scan-out session (§6.4; cloud models the completed handoff as kitluy_laundry.pickup_handoffs). Terminal profile contract §4: only T4 verifies the collector, releases garments and completes pickup, and only after the payment and custody gates pass (§12 acceptance test 5).';
