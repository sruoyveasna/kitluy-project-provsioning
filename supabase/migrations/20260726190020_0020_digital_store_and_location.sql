-- kitluy:group:0020
-- Migration group 0020: store_and_location (WS-03-T001).
-- Contents per docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md section 2:
--   kitluy_core: digital_stores, store_locations, digital_store_location_links.
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
-- Status vocabularies: docs/source/data-contracts/kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md
-- Status: SCAFFOLDED. Execution BLOCKED (BLK-002: Docker and Supabase CLI absent).
-- Statically validated only; NOT applied anywhere; no application is claimed.
-- Production application is human-operated with four-eyes approval, never automatic
-- (KL-INF-P1-037, OWNER-LOCKED). Purely additive: no destructive statements.
-- Invariants carried by this group:
--   I2  one Digital Store, one primary vertical (single NOT NULL primary_vertical_code
--       column: exactly one primary vertical by construction; the vertical vocabulary is
--       the reference registry kitluy_core.reference_values registry_key vertical_code,
--       NOT a hardcoded enum — LAUNDRY is the Phase 1 active value; the trigger rejecting
--       direct vertical update on activated stores is a governed-migration guard that
--       lands in group 0130 per the migration plan).
--   Location inherits the Digital Store primary vertical (no vertical column on
--   store_locations; inheritance resolves through digital_store_id; the
--   enforce_scope_consistency trigger lands in group 0130).
--   One active Digital-Store-to-Location link per Location; link history append-only.

begin;

-- ---------------------------------------------------------------------------
-- kitluy_core.digital_stores — Digital Store control plane (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.digital_stores (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  store_code text not null,
  name text not null,
  primary_vertical_code text not null,
  status text not null default 'DRAFT',
  default_locale text not null default 'km-KH',
  default_currency_code char(3) not null default 'KHR',
  timezone text not null default 'Asia/Phnom_Penh',
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint digital_stores_tenant_store_code_key unique (tenant_id, store_code),
  constraint digital_stores_primary_vertical_check check (
    length(trim(primary_vertical_code)) > 0
  ),
  constraint digital_stores_status_check check (
    status in (
      'DRAFT', 'CONFIGURING', 'READY_FOR_PROVISIONING', 'ACTIVE_ONLINE',
      'ACTIVE_HYBRID', 'PAUSED', 'SUSPENDED', 'CLOSED'
    )
  ),
  constraint digital_stores_version_check check (version >= 1)
);

create index if not exists digital_stores_tenant_id_idx
  on kitluy_core.digital_stores (tenant_id);

comment on table kitluy_core.digital_stores is
  'Owner: Shared Platform. Digital Store control plane. Invariant I2: exactly one primary vertical per Digital Store (single NOT NULL primary_vertical_code); vertical vocabulary is the reference registry (kitluy_core.reference_values registry_key vertical_code; Phase 1 active value LAUNDRY), never a hardcoded enum; changing vertical after activation requires a governed migration, not a direct update (guard trigger lands in group 0130). Status vocabulary: enum registry digital_store_status. MC: CFG-V.';

comment on column kitluy_core.digital_stores.primary_vertical_code is
  'Exactly-one primary vertical (NOT NULL). Values governed by reference registry vertical_code (LAUNDRY in Phase 1). Never mutated directly after activation (KLD-VERTICAL-001; KBR-CORE-002).';

-- ---------------------------------------------------------------------------
-- kitluy_core.store_locations — Optional physical edge location (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.store_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  location_code text not null,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country_code char(2) not null default 'KH',
  timezone text not null default 'Asia/Phnom_Penh',
  operating_status text not null default 'PLANNED',
  hub_required boolean not null default true,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_locations_store_location_code_key unique (digital_store_id, location_code),
  constraint store_locations_operating_status_check check (
    operating_status in (
      'PLANNED', 'PROVISIONING', 'VALIDATING', 'ACTIVE', 'DEGRADED', 'SUSPENDED', 'CLOSED'
    )
  ),
  constraint store_locations_version_check check (version >= 1)
);

create index if not exists store_locations_tenant_id_idx
  on kitluy_core.store_locations (tenant_id);

create index if not exists store_locations_digital_store_id_idx
  on kitluy_core.store_locations (digital_store_id);

comment on table kitluy_core.store_locations is
  'Owner: Shared Platform. Optional physical edge location under exactly one Digital Store (FK digital_store_id). Invariant: a Location inherits the Digital Store primary vertical — inheritance is resolved through digital_store_id (no local vertical column can diverge); tenant/store ancestry consistency trigger (enforce_scope_consistency) lands in group 0130. Physical operation requires an active approved Hub where policy says so (hub_required). Status vocabulary: enum registry store_location_status. MC: CFG-V.';

comment on column kitluy_core.store_locations.hub_required is
  'True when physical operation at this Location requires an active approved Store Hub (KBR-SHIFT-001).';

-- ---------------------------------------------------------------------------
-- kitluy_core.digital_store_location_links — Store-to-Location linkage history
-- (MC: A/O history)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.digital_store_location_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  reason_code text,
  created_at timestamptz not null default now(),
  constraint digital_store_location_links_validity_check check (
    valid_to is null or valid_to > valid_from
  )
);

-- One active link per Location (activation history is append-only; closing a link
-- sets valid_to via the governed RPC path, never rewrites history rows).
create unique index if not exists digital_store_location_links_active_location_key
  on kitluy_core.digital_store_location_links (store_location_id)
  where valid_to is null;

create index if not exists digital_store_location_links_store_idx
  on kitluy_core.digital_store_location_links (digital_store_id);

comment on table kitluy_core.digital_store_location_links is
  'Owner: Shared Platform. Historical/explicit Digital-Store-to-Location linkage (activation history). Invariants: one active link per Location (partial unique index); the active link must match store_locations.digital_store_id (consistency trigger lands in group 0130); history is append-only — UPDATE/DELETE rejected for application roles (enforce_append_only trigger attaches in 20260726190035_0035). MC: A/O (history).';

commit;
