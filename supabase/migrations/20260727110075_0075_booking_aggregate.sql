-- kitluy:group:0075
-- Migration group 0075: booking_aggregate (WS-07-T002, Cycle-6 KLD-2026-07-26-003 §6/§7).
-- Neutral transaction/Booking aggregate persistence:
--   kitluy_orders: orders, order_lines, order_adjustments, order_events, order_notes
--   kitluy_auth: generic corruption-guard trigger functions (frozen columns,
--   status-transition whitelist, version increment) shared by groups 0075-0095
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
--   (section kitluy_orders — "Neutral transaction/Booking header").
-- Lifecycle contract: docs/source/business-rules/kitluy-transaction-and-booking-lifecycle-v1.0.0.md
--   §4 (KBR-TXN-001..008) — the canonical vocabulary implemented and tested by
--   verticals/phase1-laundry/src/booking-lifecycle.ts (65/65 engine vectors).
--   The engine remains the canonical transition implementation; the trigger
--   whitelist below encodes the SAME §4 adjacency as a corruption guard, never
--   an alternative semantics (Cycle-6 instruction §6).
-- Vocabularies: enum-registry laundry_booking_status DIVERGES from the §4
--   canonical states — recorded as reconciliation conflict C11 (Cycle-6), NOT
--   silently resolved; the owner-canonical §4/engine vocabulary is persisted.
-- Reconciliation: docs/source/processed/reconciliation/kitluy-ws05-ws06-entity-reconciliation-v1.0.0.md
--   C1 (cycle group numbering wins), plus Cycle-6 C11/C12 additions.
-- Open owner values referenced and NOT guessed: TXN-OD-001 (cancellation
--   windows/thresholds), TXN-OD-002 (numbering format — free text, scoped
--   unique only), TXN-OD-003/LND-OD-003 (partial pickup), PRC-OD-001 (tax),
--   PRC-OD-004 (cash rounding), PRC-OD-005 (FX), PAY-OD-003 (overpayment),
--   FIN-OD-005 (deposit accounting). KBR-PAY-004 takes "deposit policy" as an
--   input: required_deposit_minor is an explicit per-Booking policy input with
--   no default.
-- Money contract (schema spec §4 / KBR-PRC-001): bigint integer minor units,
--   char(3) currency, KHR exponent 0, USD exponent 2, no floats anywhere.
-- Weight quantities: integer grams (engine contract, pricing.ts weightGrams —
--   exact integer representation; DD convention numeric(18,4) difference
--   recorded in reconciliation C12, not silently resolved).
-- Purely additive: no destructive statements. LOCAL execution only this cycle;
-- production application is human-operated with four-eyes approval, never
-- automatic (KL-INF-P1-037, OWNER-LOCKED).
-- RLS enable+force, grants, policies and append-only triggers for this group
-- land in 20260727110095_0095_ws07_ws08_rls.sql (same release train; tables
-- must not receive non-fixture data before that file lands).

begin;

create schema if not exists kitluy_orders;

comment on schema kitluy_orders is
  'Owner: Shared Transactions. Neutral transaction/Booking aggregate: headers, immutable priced lines, compensating adjustments, append-only lifecycle events and notes. Vertical detail lives in vertical schemas (KLD-CORE-001 — no Laundry columns here). Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- ---------------------------------------------------------------------------
-- Generic corruption-guard trigger functions (kitluy_auth, shared 0075-0095).
-- These guards protect persisted aggregates against direct-write corruption;
-- canonical transition DECISIONS remain in the domain engines (Cycle-6 §6).
-- ---------------------------------------------------------------------------

-- Frozen columns: TG_ARGV lists column names that may never change after
-- insert. Corrections use compensating records (KLD-FIN-001 pattern).
create or replace function kitluy_auth.enforce_frozen_columns()
returns trigger
language plpgsql
set search_path = kitluy_auth, pg_catalog
as $$
declare
  v_col text;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  for i in 0 .. tg_nargs - 1 loop
    v_col := tg_argv[i];
    if v_old -> v_col is distinct from v_new -> v_col then
      raise exception
        'KLUY-GUARD-FROZEN-COLUMN: column % of %.% is immutable after insert; corrections use compensating records',
        v_col, tg_table_schema, tg_table_name
        using errcode = 'P0001',
          hint = 'Append a compensating record instead of rewriting history.';
    end if;
  end loop;
  return new;
end;
$$;

comment on function kitluy_auth.enforce_frozen_columns() is
  'Generic guard: TG_ARGV columns are immutable after insert (append-only corrections, KLD-FIN-001). Raises KLUY-GUARD-FROZEN-COLUMN.';

-- Status-transition whitelist: TG_ARGV[0] = status column name; TG_ARGV[1] =
-- adjacency spec "FROM:TO1|TO2;FROM2:TO3". A FROM state absent from the spec
-- is terminal. The spec must transcribe an owner-canonical state diagram
-- verbatim (source cited on each trigger), never invent one.
create or replace function kitluy_auth.enforce_status_transition()
returns trigger
language plpgsql
set search_path = kitluy_auth, pg_catalog
as $$
declare
  v_col text := tg_argv[0];
  v_spec text := tg_argv[1];
  v_from text;
  v_to text;
  v_entry text;
  v_allowed text[];
begin
  v_from := to_jsonb(old) ->> v_col;
  v_to := to_jsonb(new) ->> v_col;
  if v_from is not distinct from v_to then
    return new;
  end if;
  foreach v_entry in array string_to_array(v_spec, ';') loop
    if split_part(v_entry, ':', 1) = v_from then
      v_allowed := string_to_array(split_part(v_entry, ':', 2), '|');
      if v_to = any (v_allowed) then
        return new;
      end if;
    end if;
  end loop;
  raise exception
    'KLUY-GUARD-INVALID-TRANSITION: %.% % -> % is not an approved transition',
    tg_table_schema, tg_table_name, v_from, v_to
    using errcode = 'P0001',
      hint = 'Only the canonical state-machine adjacency is accepted.';
end;
$$;

comment on function kitluy_auth.enforce_status_transition() is
  'Generic guard: status transitions restricted to the owner-canonical adjacency transcribed in TG_ARGV (corruption guard only; the domain engine remains the canonical decision path — Cycle-6 §6). Raises KLUY-GUARD-INVALID-TRANSITION.';

-- Optimistic-concurrency guard: every UPDATE must increment "version" by
-- exactly 1 (stale compare-and-set writes are rejected by the command layer;
-- this guard rejects raw-version corruption).
create or replace function kitluy_auth.enforce_version_increment()
returns trigger
language plpgsql
set search_path = kitluy_auth, pg_catalog
as $$
declare
  v_old bigint := (to_jsonb(old) ->> 'version')::bigint;
  v_new bigint := (to_jsonb(new) ->> 'version')::bigint;
begin
  if v_new is distinct from v_old + 1 then
    raise exception
      'KLUY-GUARD-VERSION-INCREMENT: %.% version must advance by exactly 1 (old %, new %)',
      tg_table_schema, tg_table_name, v_old, v_new
      using errcode = 'P0001',
        hint = 'Reload the aggregate and retry with the current version.';
  end if;
  return new;
end;
$$;

comment on function kitluy_auth.enforce_version_increment() is
  'Generic guard: aggregate version advances by exactly 1 per accepted mutation (optimistic concurrency, KBR-TXN/KBR-LND stale-version rejection at the persistence layer). Raises KLUY-GUARD-VERSION-INCREMENT.';

-- ---------------------------------------------------------------------------
-- Composite-key anchors for child-cannot-escape-parent foreign keys.
-- ---------------------------------------------------------------------------
create unique index if not exists catalog_items_store_id_id_key
  on kitluy_core.catalog_items (digital_store_id, id);

-- ---------------------------------------------------------------------------
-- kitluy_orders.orders — Neutral transaction/Booking header (MC: MUT until
-- finalization; finalization is the immutability boundary — KBR-TXN §4)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_orders.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  customer_id uuid references kitluy_core.customers (id),
  order_number text not null,
  vertical_code text not null,
  source_code text not null,
  status text not null default 'DRAFT',
  currency_code char(3) not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  required_deposit_minor bigint,
  payment_state text not null default 'UNPAID',
  due_at timestamptz,
  intake_verified_at timestamptz,
  intake_verified_by uuid references auth.users (id),
  pre_intake_reference text,
  idempotency_key text not null,
  version bigint not null default 1,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_store_order_number_key unique (digital_store_id, order_number),
  constraint orders_tenant_idempotency_key unique (tenant_id, idempotency_key),
  constraint orders_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint orders_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint orders_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint orders_order_number_check check (length(trim(order_number)) > 0),
  constraint orders_vertical_code_check check (length(trim(vertical_code)) > 0),
  constraint orders_source_code_check check (length(trim(source_code)) > 0),
  constraint orders_status_check check (
    status in (
      'DRAFT', 'CONFIRMED/FINALIZED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED',
      'FULFILLED/COMPLETED', 'EXPIRED', 'CANCELLED', 'VOIDED', 'ISSUE_HOLD',
      'RETURN/REFUND'
    )
  ),
  constraint orders_currency_check check (currency_code in ('KHR', 'USD')),
  constraint orders_money_nonnegative_check check (
    subtotal_minor >= 0 and discount_minor >= 0 and tax_minor >= 0 and total_minor >= 0
  ),
  constraint orders_required_deposit_check check (
    required_deposit_minor is null or required_deposit_minor >= 0
  ),
  constraint orders_payment_state_check check (
    payment_state in (
      'UNPAID', 'PAYMENT_PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERPAID',
      'RECONCILIATION_EXCEPTION'
    )
  ),
  -- KLD-2026-07-25-001 / KBR-LND-002: the authoritative Booking exists only
  -- after approved staff verification of identity, items and price — a
  -- finalized Booking therefore names a customer and a physical Location.
  constraint orders_finalized_customer_check check (
    status in ('DRAFT', 'EXPIRED') or customer_id is not null
  ),
  constraint orders_finalized_location_check check (
    status in ('DRAFT', 'EXPIRED') or store_location_id is not null
  ),
  constraint orders_finalized_verification_check check (
    status in ('DRAFT', 'EXPIRED') or intake_verified_at is not null
  ),
  constraint orders_version_check check (version >= 1)
);

create unique index if not exists orders_tenant_id_id_key
  on kitluy_orders.orders (tenant_id, id);

create unique index if not exists orders_store_id_id_key
  on kitluy_orders.orders (digital_store_id, id);

create index if not exists orders_tenant_id_idx on kitluy_orders.orders (tenant_id);

create index if not exists orders_digital_store_id_idx
  on kitluy_orders.orders (digital_store_id);

create index if not exists orders_customer_id_idx on kitluy_orders.orders (customer_id);

comment on table kitluy_orders.orders is
  'Owner: Shared Transactions. Neutral transaction/Booking header (DD kitluy_orders.orders; "Booking" is the Laundry-facing term — KBR-TXN §4). Status vocabulary is the owner-canonical §4 lifecycle implemented by verticals/phase1-laundry booking-lifecycle.ts; enum-registry laundry_booking_status drift is recorded as conflict C11, not encoded. order_number format is open owner value TXN-OD-002 (free text, scoped unique). required_deposit_minor is an explicit policy input (KBR-PAY-004) — never defaulted, no percentage encoded (FIN-OD-005 open). payment_state is the engine-computed projection (@kitluy/payments PaymentState), maintained by the command service under version compare-and-set. Finalization (leaving DRAFT/EXPIRED) freezes money columns (trigger). Child-cannot-escape-parent composite FKs to digital_stores, store_locations and customers. Sensitivity: internal-financial. MC: MUT until finalization; money columns IMM after finalization; corrections via order_adjustments.';

comment on column kitluy_orders.orders.vertical_code is
  'Verified snapshot of the owning Digital Store primary_vertical_code at creation (trigger-enforced equality; the Store remains the vertical truth — Cycle-6 §7.1).';

comment on column kitluy_orders.orders.total_minor is
  'Integer minor units (bigint; KHR exponent 0, USD exponent 2 — money contract §4). Snapshotted at verification; never recomputed from later prices (KBR-TXN-002). Document-total composition order and rounding remain governed (KBR-PRC-006/007; PRC-OD-004 open) — no cross-column formula is encoded.';

comment on column kitluy_orders.orders.pre_intake_reference is
  'Optional reference to a Storefront pre-intake draft (KLD-2026-07-25-001: drafts never own transaction truth). No FK — Storefront pre-intake persistence is out of Cycle-6 scope.';

-- Booking-header guards: vertical snapshot equality at insert; identity
-- freeze; §4 lifecycle whitelist; version increment; finalization boundary.
create or replace function kitluy_orders.enforce_order_guards()
returns trigger
language plpgsql
set search_path = kitluy_orders, kitluy_core, pg_catalog
as $$
declare
  v_store_vertical text;
begin
  if tg_op = 'INSERT' then
    select primary_vertical_code into v_store_vertical
    from kitluy_core.digital_stores where id = new.digital_store_id;
    if v_store_vertical is distinct from new.vertical_code then
      raise exception
        'KLUY-ORD-VERTICAL-MISMATCH: order vertical_code % must equal the Digital Store primary vertical %',
        new.vertical_code, v_store_vertical
        using errcode = 'P0001';
    end if;
    if new.status not in ('DRAFT', 'CONFIRMED/FINALIZED') then
      raise exception
        'KLUY-ORD-INVALID-INITIAL-STATE: an order may only be created in DRAFT or CONFIRMED/FINALIZED (verified intake), not %',
        new.status
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- Identity columns are immutable for the aggregate lifetime.
  if new.tenant_id is distinct from old.tenant_id
    or new.digital_store_id is distinct from old.digital_store_id
    or new.id is distinct from old.id
    or new.order_number is distinct from old.order_number
    or new.vertical_code is distinct from old.vertical_code
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception
      'KLUY-ORD-IDENTITY-FROZEN: order identity columns are immutable'
      using errcode = 'P0001';
  end if;

  -- Version must advance by exactly 1 on every accepted mutation.
  if new.version is distinct from old.version + 1 then
    raise exception
      'KLUY-ORD-STALE-VERSION: order version must advance by exactly 1 (old %, new %)',
      old.version, new.version
      using errcode = 'P0001',
        hint = 'Reload the Booking and retry with the current version.';
  end if;

  -- Lifecycle whitelist — verbatim §4 adjacency (KBR-TXN-001/003/005/006/007;
  -- states absent below are terminal: FULFILLED/COMPLETED, EXPIRED,
  -- CANCELLED, VOIDED, ISSUE_HOLD, RETURN/REFUND have no drawn outgoing edge).
  if new.status is distinct from old.status then
    if not (
      (old.status = 'DRAFT' and new.status in ('CONFIRMED/FINALIZED', 'EXPIRED'))
      or (old.status = 'CONFIRMED/FINALIZED'
          and new.status in ('IN_PROGRESS', 'CANCELLED', 'VOIDED'))
      or (old.status = 'IN_PROGRESS'
          and new.status in ('PARTIALLY_FULFILLED', 'ISSUE_HOLD', 'RETURN/REFUND'))
      or (old.status = 'PARTIALLY_FULFILLED' and new.status = 'FULFILLED/COMPLETED')
    ) then
      raise exception
        'KLUY-ORD-INVALID-TRANSITION: booking lifecycle % -> % is not in the canonical §4 adjacency',
        old.status, new.status
        using errcode = 'P0001';
    end if;
  end if;

  -- Finalization is the immutability boundary (KBR-TXN §4): once the order
  -- has left DRAFT/EXPIRED, snapshotted money and scope columns are frozen.
  if old.status not in ('DRAFT', 'EXPIRED') then
    if new.subtotal_minor is distinct from old.subtotal_minor
      or new.discount_minor is distinct from old.discount_minor
      or new.tax_minor is distinct from old.tax_minor
      or new.total_minor is distinct from old.total_minor
      or new.currency_code is distinct from old.currency_code
      or new.required_deposit_minor is distinct from old.required_deposit_minor
      or new.customer_id is distinct from old.customer_id
      or new.store_location_id is distinct from old.store_location_id
      or new.intake_verified_at is distinct from old.intake_verified_at
      or new.intake_verified_by is distinct from old.intake_verified_by then
      raise exception
        'KLUY-ORD-FINALIZED-IMMUTABLE: finalized Booking money/scope columns are immutable; corrections use compensating order_adjustments (KLD-FIN-001)'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function kitluy_orders.enforce_order_guards() is
  'Booking-header corruption guards: vertical snapshot equality at insert, identity freeze, verbatim KBR-TXN §4 lifecycle whitelist, version +1 optimistic-concurrency, finalization immutability boundary. The domain engine remains the canonical transition decision path (Cycle-6 §6).';

create trigger trg_orders_guards
  before insert or update on kitluy_orders.orders
  for each row execute function kitluy_orders.enforce_order_guards();

-- ---------------------------------------------------------------------------
-- kitluy_orders.order_lines — Immutable priced lines (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_orders.order_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  order_id uuid not null references kitluy_orders.orders (id),
  line_no integer not null,
  catalog_item_id uuid not null references kitluy_core.catalog_items (id),
  service_code text not null,
  pricing_mode text not null,
  quantity bigint,
  weight_grams bigint,
  weight_rounding_rule text,
  unit_price_minor bigint not null,
  price_version bigint,
  currency_code char(3) not null,
  subtotal_minor bigint not null default 0,
  discount_minor bigint not null default 0,
  tax_minor bigint not null default 0,
  total_minor bigint not null default 0,
  created_at timestamptz not null default now(),
  constraint order_lines_order_line_no_key unique (order_id, line_no),
  constraint order_lines_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint order_lines_store_order_fk
    foreign key (digital_store_id, order_id)
    references kitluy_orders.orders (digital_store_id, id),
  constraint order_lines_store_catalog_item_fk
    foreign key (digital_store_id, catalog_item_id)
    references kitluy_core.catalog_items (digital_store_id, id),
  constraint order_lines_service_code_check check (length(trim(service_code)) > 0),
  constraint order_lines_pricing_mode_check check (
    pricing_mode in ('PER_PIECE', 'PER_WEIGHT', 'FIXED', 'MIXED_COMPONENT')
  ),
  constraint order_lines_quantity_check check (quantity is null or quantity > 0),
  constraint order_lines_weight_check check (weight_grams is null or weight_grams > 0),
  constraint order_lines_per_piece_check check (
    pricing_mode <> 'PER_PIECE' or (quantity is not null and weight_grams is null)
  ),
  constraint order_lines_per_weight_check check (
    pricing_mode <> 'PER_WEIGHT'
    or (weight_grams is not null and quantity is null and weight_rounding_rule is not null)
  ),
  constraint order_lines_rounding_rule_check check (
    weight_rounding_rule is null
    or weight_rounding_rule in ('round_half_up_minor_unit', 'round_up_minor_unit')
  ),
  constraint order_lines_currency_check check (currency_code in ('KHR', 'USD')),
  constraint order_lines_money_nonnegative_check check (
    unit_price_minor >= 0 and subtotal_minor >= 0 and discount_minor >= 0
    and tax_minor >= 0 and total_minor >= 0
  ),
  constraint order_lines_price_version_check check (
    price_version is null or price_version >= 1
  )
);

create index if not exists order_lines_order_id_idx
  on kitluy_orders.order_lines (order_id);

comment on table kitluy_orders.order_lines is
  'Owner: Shared Transactions. Immutable priced Booking lines — authoritative price snapshot at verified intake (KBR-TXN-002: confirmed transactions snapshot price_version; POS spec §5.6: never recalculated from later catalog changes). Neutral catalog reference only (composite FK keeps the catalog item in the same Digital Store); the Laundry service is resolved through catalog_item_id (kitluy_laundry.services UNIQUE catalog_item_id) — no vertical FK from the neutral schema (KLD-CORE-001). quantity is integral pieces; weight_grams is integer grams (engine contract; DD numeric(18,4) convention difference recorded as C12). weight_rounding_rule mirrors the engine WeightRoundingRule and is REQUIRED for PER_WEIGHT — never defaulted (rounding-rule selection is governed configuration). tax_minor exists structurally; no tax value/rate is encoded (PRC-OD-001 open; KBR-PRC-005: unknown configuration is not zero tax — dev fixtures carry 0 with the open-value marker). Sensitivity: internal-financial. MC: A/O (append-only; corrections via order_adjustments).';

-- Line currency must equal the order currency (money contract: no silent
-- currency conversion; each record carries its currency explicitly).
create or replace function kitluy_orders.enforce_line_currency()
returns trigger
language plpgsql
set search_path = kitluy_orders, pg_catalog
as $$
declare
  v_order_currency char(3);
begin
  select currency_code into v_order_currency
  from kitluy_orders.orders where id = new.order_id;
  if v_order_currency is distinct from new.currency_code then
    raise exception
      'KLUY-ORD-CURRENCY-MISMATCH: line currency % must equal order currency % (no implicit conversion — PRC-OD-005 open)',
      new.currency_code, v_order_currency
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_orders.enforce_line_currency() is
  'Money contract guard: order_lines.currency_code must equal the parent order currency; cross-currency composition without an approved FX policy is rejected (PRC-OD-005 open).';

create trigger trg_order_lines_currency
  before insert on kitluy_orders.order_lines
  for each row execute function kitluy_orders.enforce_line_currency();

-- ---------------------------------------------------------------------------
-- kitluy_orders.order_adjustments — Compensating corrections (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_orders.order_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  line_id uuid references kitluy_orders.order_lines (id),
  adjustment_type text not null,
  amount_minor bigint not null,
  currency_code char(3) not null,
  reason_code text not null,
  source_ref text,
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint order_adjustments_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint order_adjustments_type_check check (length(trim(adjustment_type)) > 0),
  constraint order_adjustments_amount_check check (amount_minor <> 0),
  constraint order_adjustments_currency_check check (currency_code in ('KHR', 'USD')),
  constraint order_adjustments_reason_check check (length(trim(reason_code)) > 0)
);

create index if not exists order_adjustments_order_id_idx
  on kitluy_orders.order_adjustments (order_id);

comment on table kitluy_orders.order_adjustments is
  'Owner: Shared Transactions. Compensating discount/fee/correction records — finalized totals are never overwritten (KLD-FIN-001; DD invariant). reason_code is mandatory (reason-code registry family "cancellation, void, refund and price override" — values seed in group 0150, none guessed). Signed amount, never zero. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_orders.order_events — Append-only lifecycle history (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_orders.order_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  event_type text not null,
  from_status text,
  to_status text,
  from_version bigint,
  to_version bigint,
  reason_code text,
  actor_user_id uuid references auth.users (id),
  actor_service_key text,
  device_id uuid,
  idempotency_key text,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  metadata jsonb,
  constraint order_events_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint order_events_event_type_check check (length(trim(event_type)) > 0),
  constraint order_events_from_status_check check (
    from_status is null or from_status in (
      'DRAFT', 'CONFIRMED/FINALIZED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED',
      'FULFILLED/COMPLETED', 'EXPIRED', 'CANCELLED', 'VOIDED', 'ISSUE_HOLD',
      'RETURN/REFUND'
    )
  ),
  constraint order_events_to_status_check check (
    to_status is null or to_status in (
      'DRAFT', 'CONFIRMED/FINALIZED', 'IN_PROGRESS', 'PARTIALLY_FULFILLED',
      'FULFILLED/COMPLETED', 'EXPIRED', 'CANCELLED', 'VOIDED', 'ISSUE_HOLD',
      'RETURN/REFUND'
    )
  ),
  -- KBR-TXN-005/006: compensating branches require an explicit reason.
  constraint order_events_compensating_reason_check check (
    to_status is null
    or to_status not in ('CANCELLED', 'VOIDED', 'RETURN/REFUND')
    or (reason_code is not null and length(trim(reason_code)) > 0)
  )
);

create unique index if not exists order_events_order_idempotency_key
  on kitluy_orders.order_events (order_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists order_events_order_id_idx
  on kitluy_orders.order_events (order_id);

comment on table kitluy_orders.order_events is
  'Owner: Shared Transactions. Append-only Booking lifecycle transition/audit history (internal record — NOT a public event contract; external event names/versions stay fenced behind KL-DEC-001, outbox publication disabled). Idempotent transition replay is detected by the scoped idempotency key (unique per order). Actor, device, business timestamp (occurred_at) and record timestamp (recorded_at) are separate. Sensitivity: internal. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_orders.order_notes — Operational/customer notes (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_orders.order_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid not null references kitluy_orders.orders (id),
  note_type text not null,
  visibility text not null default 'INTERNAL',
  body text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint order_notes_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint order_notes_note_type_check check (length(trim(note_type)) > 0),
  constraint order_notes_visibility_check check (
    visibility in ('INTERNAL', 'CUSTOMER')
  ),
  constraint order_notes_body_check check (length(trim(body)) > 0)
);

create index if not exists order_notes_order_id_idx
  on kitluy_orders.order_notes (order_id);

comment on table kitluy_orders.order_notes is
  'Owner: Shared Transactions. Operational and customer-visible Booking notes (condition notes at intake, issue notes). Notes are records: corrections append a new note, never rewrite (MC: A/O). Sensitivity: internal.';

commit;
