-- kitluy:hub:migration:0006
-- ===========================================================================
-- KitLuy Store Hub local database — edge_payments (§6.5, 4 relations) and the
-- cash side of edge_core (§6.3 edge_core.cash_movement).
--
-- cash_movement is created HERE, not in 0004, for two reasons: §4 names this
-- migration "payments_and_cash", and cash_movement.related_payment_id
-- references edge_payments.payment, which cannot exist earlier.
--
-- RECORDED GAP G8 — there is deliberately NO edge_finance schema. Finance
-- posting stays CLOUD-authoritative this cycle; a Hub-side journal would
-- create a second ledger, which KLD-FIN-002 forbids. The Hub records the
-- payment and cash events finance derives from, and the outbox carries them.
-- Owner ruling tracked as KLREQ-022.
--
-- Mapping (reconciliation §2):
--   kitluy_payments.tenders           -> edge_payments.payment
--   kitluy_payments.payment_attempts  -> edge_payments.payment_attempt
--   kitluy_payments.refunds + .voids  -> edge_payments.refund_adjustment
--   khqr_transactions, payment_provider_events, settlement_refs and
--   payment_reconciliation* stay CLOUD-ONLY: provider and settlement truth is
--   not Hub-authoritative.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_payments.payment
-- ---------------------------------------------------------------------------
create table edge_payments.payment (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  booking_id         uuid        not null references edge_laundry.booking (id),
  payment_number     text        not null,
  payment_type       text        not null,
  amount_minor       bigint      not null,
  currency_code      char(3)     not null,
  currency_exponent  smallint    not null,
  state              text        not null,
  provider_code      text        null,
  provider_reference text        null,
  requested_at       timestamptz not null,
  confirmed_at       timestamptz null,
  reversed_at        timestamptz null,
  actor_id           uuid        not null,
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  event_id           uuid        not null unique,
  idempotency_key    text        not null unique,
  constraint payment_number_uq unique (location_id, payment_number),
  constraint payment_amount_ck check (amount_minor > 0),
  constraint payment_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint payment_exponent_ck check (currency_exponent between 0 and 4),
  constraint payment_state_ck
    check (state in ('requested', 'pending', 'confirmed', 'failed', 'cancelled', 'reversed')),
  -- KLD-2026-07-26-002 Group 5: PAYMENT_PENDING is non-terminal (HTTP 202) and
  -- never becomes paid without an authoritative confirmation timestamp.
  constraint payment_confirmed_ck check (state <> 'confirmed' or confirmed_at is not null),
  constraint payment_reversed_ck check (state <> 'reversed' or reversed_at is not null),
  constraint payment_reversal_order_ck check (reversed_at is null or confirmed_at is not null),
  -- Offline contract §2 / gap G1.
  constraint payment_idempotency_key_ck
    check (edge_sync.is_canonical_idempotency_key(idempotency_key))
);

comment on table edge_payments.payment is
  'Local payment record (§6.5; maps to cloud kitluy_payments.tenders). "Append-only state transitions through payment events; no state may jump from requested to confirmed without an authorized confirmation path." The row is a PROJECTION of append-only payment events: DELETE is rejected and the immutable-column guard in 0012 rejects any UPDATE of money, booking, type, event or idempotency identity (§12 acceptance test 6).';
comment on column edge_payments.payment.provider_reference is
  'Provider correlation only. Provider and settlement TRUTH is cloud-authoritative; the Hub never treats a displayed QR or a customer claim as confirmation (terminal profile contract §5.3).';

-- ---------------------------------------------------------------------------
-- edge_payments.payment_attempt
-- ---------------------------------------------------------------------------
create table edge_payments.payment_attempt (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  payment_id         uuid        not null references edge_payments.payment (id),
  attempt_number     integer     not null,
  request_sha256     char(64)    not null,
  provider_state     text        not null,
  provider_reference text        null,
  requested_at       timestamptz not null,
  responded_at       timestamptz null,
  error_code         text        null,
  response_metadata  jsonb       not null default '{}'::jsonb,
  constraint payment_attempt_number_uq unique (payment_id, attempt_number),
  constraint payment_attempt_number_ck check (attempt_number >= 1),
  constraint payment_attempt_hash_ck check (request_sha256 ~ '^[0-9a-f]{64}$'),
  constraint payment_attempt_window_ck check (responded_at is null or responded_at >= requested_at)
);

comment on table edge_payments.payment_attempt is
  'One provider request attempt (§6.5). request_sha256 is the canonical request hash (offline contract §3); a provider retry reuses the SAME provider idempotency reference (§12).';

-- ---------------------------------------------------------------------------
-- edge_payments.tender_leg
-- ---------------------------------------------------------------------------
create table edge_payments.tender_leg (
  id                 uuid     primary key,
  tenant_id          uuid     not null,
  digital_store_id   uuid     not null,
  location_id        uuid     not null,
  payment_id         uuid     not null references edge_payments.payment (id),
  tender_type        text     not null,
  amount_minor       bigint   not null,
  currency_code      char(3)  not null,
  currency_exponent  smallint not null,
  state              text     not null,
  provider_reference text     null,
  event_id           uuid     not null unique,
  constraint tender_leg_amount_ck check (amount_minor > 0),
  constraint tender_leg_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint tender_leg_exponent_ck check (currency_exponent between 0 and 4)
);

comment on table edge_payments.tender_leg is
  'Mixed-tender leg (§6.5). "Required when mixed tender becomes enabled" — the relation exists now so enabling mixed tender is a configuration change, not a migration.';

-- ---------------------------------------------------------------------------
-- edge_payments.refund_adjustment — APPEND-ONLY (§6.5).
-- ---------------------------------------------------------------------------
create table edge_payments.refund_adjustment (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  booking_id          uuid        not null references edge_laundry.booking (id),
  original_payment_id uuid        null references edge_payments.payment (id),
  adjustment_type     text        not null,
  amount_minor        bigint      not null,
  currency_code       char(3)     not null,
  currency_exponent   smallint    not null,
  reason_code         text        not null,
  approval_id         uuid        null,
  state               text        not null,
  created_at          timestamptz not null,
  event_id            uuid        not null unique,
  constraint refund_adjustment_type_ck check (adjustment_type in ('refund', 'void')),
  constraint refund_adjustment_amount_ck check (amount_minor > 0),
  constraint refund_adjustment_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint refund_adjustment_exponent_ck check (currency_exponent between 0 and 4),
  constraint refund_adjustment_original_ck
    check (adjustment_type <> 'refund' or original_payment_id is not null)
);

comment on table edge_payments.refund_adjustment is
  'Compensating adjustment (§6.5). Reconciliation §2: cloud kitluy_payments.refunds AND .voids merge here, distinguished by adjustment_type. Append-only — a later state change is a NEW compensating row, never an UPDATE. approval_id carries the four-eyes approval where the approved policy requires it; the threshold values remain owner-open and are NOT invented here.';

-- ---------------------------------------------------------------------------
-- edge_core.cash_movement — APPEND-ONLY (§6.3).
-- ---------------------------------------------------------------------------
create table edge_core.cash_movement (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  shift_id           uuid        not null references edge_core.shift (id),
  movement_type      text        not null,
  amount_minor       bigint      not null,
  currency_code      char(3)     not null,
  currency_exponent  smallint    not null,
  reason_code        text        null,
  related_payment_id uuid        null references edge_payments.payment (id),
  actor_id           uuid        not null,
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  occurred_at        timestamptz not null,
  event_id           uuid        not null unique,
  constraint cash_movement_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint cash_movement_exponent_ck check (currency_exponent between 0 and 4)
);

comment on table edge_core.cash_movement is
  'Append-only cash ledger (§6.3). Signed amount_minor: a payout/refund is negative, an acceptance positive — the movement LEDGER is the record, never a quantity overwrite (§1 "Inventory/consumables: movement ledger"). This is the cash truth cloud finance posts from (gap G8).';
