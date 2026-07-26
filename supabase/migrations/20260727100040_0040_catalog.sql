-- kitluy:group:0040
-- Migration group 0040: catalog (WS-05-T001, Cycle-5 KLD-2026-07-26-003).
-- Neutral Core catalog + Laundry service extension tables:
--   kitluy_core: catalog_items, catalog_item_translations
--   kitluy_laundry: services, service_addons
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
-- Schema contract: docs/data/kitluy-suite-supabase-schema-v1.0.0.md section 2.4
-- Vocabularies: docs/source/data-contracts/kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md
-- Reconciliation: docs/source/processed/reconciliation/kitluy-ws05-ws06-entity-reconciliation-v1.0.0.md
--   (C1 group numbering; C7 chain/consumable/capacity tables deferred to their
--   dependency groups — this file is the cycle section 6 scope only).
-- Invariant KLD-CORE-001: NO Laundry-specific names or columns in shared Core
-- schemas; Laundry service specifics live in kitluy_laundry extension tables.
-- Purely additive: no destructive statements. LOCAL execution only this cycle;
-- production application is human-operated with four-eyes approval, never
-- automatic (KL-INF-P1-037, OWNER-LOCKED).
-- RLS enable+force, grants and policies for this group land in
-- 20260727100070_0070_ws05_ws06_rls.sql (same release train; the tables must
-- not receive non-fixture data before that file lands).

begin;

create schema if not exists kitluy_laundry;

comment on schema kitluy_laundry is
  'Owner: Laundry Vertical. Laundry services, prices, garments, tags, production/custody, exceptions, Ready storage and pickup. This cycle: services, service_addons, service_prices only. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- Composite-key anchor for child-cannot-escape-parent foreign keys:
-- (tenant_id, digital_store_id) pairs referencing this index cannot name a
-- Digital Store of another Tenant.
create unique index if not exists digital_stores_tenant_id_id_key
  on kitluy_core.digital_stores (tenant_id, id);

-- ---------------------------------------------------------------------------
-- kitluy_core.catalog_items — Neutral catalog item/service root (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.catalog_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  item_type text not null,
  code text not null,
  name text not null,
  status text not null default 'DRAFT',
  version bigint not null default 1,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_items_store_code_key unique (digital_store_id, code),
  constraint catalog_items_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint catalog_items_item_type_check check (length(trim(item_type)) > 0),
  constraint catalog_items_status_check check (
    status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')
  ),
  constraint catalog_items_version_check check (version >= 1)
);

create index if not exists catalog_items_tenant_id_idx
  on kitluy_core.catalog_items (tenant_id);

create index if not exists catalog_items_digital_store_id_idx
  on kitluy_core.catalog_items (digital_store_id);

comment on table kitluy_core.catalog_items is
  'Owner: Shared Platform. Neutral catalog item/service root. Invariant KLD-CORE-001: vertical detail belongs in vertical extension tables — no Laundry-only columns here. Child-cannot-escape-parent: composite FK (tenant_id, digital_store_id) -> digital_stores (tenant_id, id). item_type vocabulary is registry-governed (reference registry seed, group 0150). Status vocabulary: enum registry catalog_record_status. Sensitivity: internal. MC: CFG-V (version optimistic concurrency).';

comment on column kitluy_core.catalog_items.code is
  'Stable language-neutral business code, unique per Digital Store (UNIQUE digital_store_id, code).';

-- ---------------------------------------------------------------------------
-- kitluy_core.catalog_item_translations — Localized catalog labels (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.catalog_item_translations (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references kitluy_core.catalog_items (id),
  locale text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_item_translations_item_locale_key unique (catalog_item_id, locale)
);

comment on table kitluy_core.catalog_item_translations is
  'Owner: Shared Platform. Localized catalog labels (Khmer and English). Codes remain language-neutral; labels may change. Sensitivity: internal. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_laundry.services — Laundry service delta (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.services (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  catalog_item_id uuid not null references kitluy_core.catalog_items (id),
  service_code text not null,
  pricing_modes text[] not null,
  production_profile text,
  status text not null default 'DRAFT',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint services_catalog_item_key unique (catalog_item_id),
  constraint services_store_service_code_key unique (digital_store_id, service_code),
  constraint services_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint services_pricing_modes_check check (
    array_length(pricing_modes, 1) >= 1
    and pricing_modes <@ array['PER_PIECE', 'PER_WEIGHT', 'FIXED', 'MIXED_COMPONENT']::text[]
  ),
  constraint services_status_check check (
    status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')
  ),
  constraint services_version_check check (version >= 1)
);

create index if not exists services_digital_store_id_idx
  on kitluy_laundry.services (digital_store_id);

comment on table kitluy_laundry.services is
  'Owner: Laundry Vertical. Laundry service delta over exactly one neutral catalog item (UNIQUE catalog_item_id). pricing_modes constrained to the enum registry pricing_mode set (PER_PIECE, PER_WEIGHT, FIXED, MIXED_COMPONENT — KBR-PRC-003). Scoped unique service codes per Digital Store. Status vocabulary: enum registry catalog_record_status. Sensitivity: internal. MC: CFG-V.';

comment on column kitluy_laundry.services.pricing_modes is
  'Modes this service supports (enum registry pricing_mode). The billable-weight increment/minimum rule per service is an open owner value (PRC-OD-002) — intentionally NOT modeled as a column with a guessed default.';

-- ---------------------------------------------------------------------------
-- kitluy_laundry.service_addons — Laundry add-ons (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_laundry.service_addons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  service_id uuid not null references kitluy_laundry.services (id),
  addon_code text not null,
  name text not null,
  pricing_mode text not null,
  status text not null default 'DRAFT',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_addons_service_addon_code_key unique (service_id, addon_code),
  constraint service_addons_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint service_addons_pricing_mode_check check (
    pricing_mode in ('PER_PIECE', 'PER_WEIGHT', 'FIXED', 'MIXED_COMPONENT')
  ),
  constraint service_addons_status_check check (
    status in ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED')
  ),
  constraint service_addons_version_check check (version >= 1)
);

create index if not exists service_addons_service_id_idx
  on kitluy_laundry.service_addons (service_id);

comment on table kitluy_laundry.service_addons is
  'Owner: Laundry Vertical. Laundry add-ons (KBR-PRC-003: add-ons calculate separately and remain visible). Monetary amounts resolve through versioned price rows, never through columns here (reconciliation C-note: the DD "pricing rule" field is the pricing_mode, not a money column). Sensitivity: internal. MC: CFG-V.';

commit;
