-- kitluy:group:0045
-- Migration group 0045: pricing (WS-05-T001, Cycle-5 KLD-2026-07-26-003).
--   kitluy_laundry: service_prices (versioned price entries; the "price book"
--   concept of KBR-PRC-002 is the scope layer of this table — Digital-Store
--   base row = store price book, store_location_id row = location price book;
--   reconciliation record C3: alias only, no parallel price-book entity).
-- Money contract (schema spec section 4 / KBR-PRC-001): integer minor units in
-- bigint, KHR exponent 0 and USD exponent 2, currency_code char(3), no floats.
-- Open owner values referenced and NOT guessed (reconciliation section 3):
--   PRC-OD-001 tax/VAT, PRC-OD-002 billable-weight increment/minimum,
--   PRC-OD-003 override thresholds, PRC-OD-004 cash rounding increment,
--   PRC-OD-005 USD/KHR mixed-tender and exchange-rate policy.
-- No tax, rounding or FX column in this file carries a value: those remain
-- governed configuration (KBR-PRC-005 error rule: unknown configuration is not
-- zero tax).
-- Purely additive; local-only this cycle; never automatic in production
-- (KL-INF-P1-037). RLS/grants/append-only triggers land in group 0070.

begin;

-- Equality operators on uuid/bpchar/text inside the exclusion constraint below.
create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- kitluy_laundry.service_prices — Versioned Laundry price entries (MC: IMM-V,
-- enforced append-only in group 0070 per reconciliation C5: version rows are
-- immutable; corrections publish a higher version — KBR-PRC-008; rollback is
-- forward-publication of a prior compatible price, never row rewrite)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.service_prices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  service_id uuid not null references kitluy_laundry.services (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  currency_code char(3) not null,
  pricing_mode text not null,
  unit_price_minor bigint not null,
  min_charge_minor bigint,
  effective_from timestamptz not null,
  effective_to timestamptz,
  version bigint not null default 1,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint service_prices_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint service_prices_currency_check check (currency_code in ('KHR', 'USD')),
  constraint service_prices_pricing_mode_check check (
    pricing_mode in ('PER_PIECE', 'PER_WEIGHT', 'FIXED', 'MIXED_COMPONENT')
  ),
  constraint service_prices_unit_price_check check (unit_price_minor >= 0),
  constraint service_prices_min_charge_check check (
    min_charge_minor is null or min_charge_minor >= 0
  ),
  constraint service_prices_effective_range_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint service_prices_version_check check (version >= 1),
  -- KBR-PRC-002: reject ambiguous equal-priority matches — no two price rows
  -- for the same service, same scope layer, same currency and same pricing
  -- mode may have overlapping effective ranges. NULL store_location_id (the
  -- Digital-Store base price book) is coalesced so base rows collide with
  -- base rows; a Location override is a different, higher-precedence layer.
  constraint service_prices_no_ambiguous_overlap exclude using gist (
    service_id with =,
    digital_store_id with =,
    (coalesce(store_location_id, '00000000-0000-0000-0000-000000000000'::uuid)) with =,
    currency_code with =,
    pricing_mode with =,
    tstzrange(effective_from, effective_to, '[)') with &&
  )
);

-- Version uniqueness inside one price-book layer (DD: version rules).
create unique index if not exists service_prices_scope_version_key
  on kitluy_laundry.service_prices (
    service_id,
    digital_store_id,
    coalesce(store_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    currency_code,
    pricing_mode,
    version
  );

create index if not exists service_prices_service_id_idx
  on kitluy_laundry.service_prices (service_id);

create index if not exists service_prices_digital_store_id_idx
  on kitluy_laundry.service_prices (digital_store_id);

create index if not exists service_prices_store_location_id_idx
  on kitluy_laundry.service_prices (store_location_id);

comment on table kitluy_laundry.service_prices is
  'Owner: Laundry Vertical. Versioned Laundry price entries ("price book" alias — reconciliation C3). Money contract: unit_price_minor/min_charge_minor are bigint integer minor units (KHR exponent 0, USD exponent 2 — KBR-PRC-001; HALF_EVEN only at the governed boundary; no floats anywhere) with currency_code char(3). Price resolution precedence per KBR-PRC-002: Location layer overrides Digital-Store base layer; ambiguous same-layer overlaps are rejected by the exclusion constraint. Confirmed transactions snapshot price_version (KBR-TXN-002). Version rows are immutable — corrections publish a higher version (KBR-PRC-008); enforce_append_only attaches in group 0070. Open owner values PRC-OD-001..005 are intentionally NOT encoded here. Sensitivity: internal-financial. MC: IMM-V (append-only).';

comment on column kitluy_laundry.service_prices.unit_price_minor is
  'Integer minor units (bigint). KHR: whole riel (exponent 0). USD: cents (exponent 2). Never a float (money contract section 4).';

comment on column kitluy_laundry.service_prices.min_charge_minor is
  'Optional minimum charge in integer minor units. Billable-weight increment/minimum rules per service remain open owner value PRC-OD-002 — no increment value is guessed here.';

comment on column kitluy_laundry.service_prices.store_location_id is
  'NULL = Digital-Store base price book row; NOT NULL = Location price book override (higher precedence per KBR-PRC-002).';

commit;
