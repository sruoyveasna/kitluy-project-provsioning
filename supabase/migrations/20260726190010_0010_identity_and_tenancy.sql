-- kitluy:group:0010
-- Migration group 0010: identity_and_tenant (WS-02-T002).
-- Contents per docs/data/kitluy-suite-supabase-migration-plan-v1.0.0.md section 2:
--   kitluy_core: tenants, partner_accounts, memberships, plans, feature_flags,
--   reference_values, reference_value_translations.
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
-- Status vocabularies: docs/source/data-contracts/kitluy-suite-supabase-enum-and-reference-data-registry-v1.0.0.md
-- Status: SCAFFOLDED. Execution BLOCKED (BLK-002: Docker and Supabase CLI absent).
-- This file is statically validated only (pnpm db:validate / pnpm db:migrations:check);
-- it has NOT been applied to any database and no application is claimed.
-- Production application is human-operated with four-eyes approval, never automatic
-- (KL-INF-P1-037, OWNER-LOCKED). Purely additive: no destructive statements.
-- RLS is enabled+forced and policies attach in 20260726190035_0035 (same release train);
-- these tables must not receive data before that file lands (plan group 0010 RLS/RT note).

begin;

create schema if not exists kitluy_core;

comment on schema kitluy_core is
  'Owner: Shared Platform. Tenant, Partner, Digital Store, Store Location, membership, customer, catalog and plan-neutral identity. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- ---------------------------------------------------------------------------
-- kitluy_core.tenants — Backend Partner account boundary (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.tenants (
  id uuid primary key default gen_random_uuid(),
  tenant_code text not null,
  legal_name text not null,
  display_name text,
  status text not null default 'ONBOARDING',
  default_locale text not null default 'km-KH',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_tenant_code_key unique (tenant_code),
  constraint tenants_status_check check (
    status in ('ONBOARDING', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELLED')
  )
);

comment on table kitluy_core.tenants is
  'Owner: Shared Platform. Backend Partner account boundary. Invariant: cannot be hard-deleted after dependent transactional data exists (lifecycle via status only). Status vocabulary: enum registry tenant_status. MC: MUT.';

comment on column kitluy_core.tenants.tenant_code is
  'Stable unique business code for the Tenant (e.g. DEMO-KH-001). Language-neutral.';

-- ---------------------------------------------------------------------------
-- kitluy_core.partner_accounts — Business-facing Partner profile (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.partner_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  partner_type text not null,
  verification_status text not null default 'NOT_STARTED',
  contact_name text,
  contact_phone text,
  contact_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_accounts_tenant_id_key unique (tenant_id),
  constraint partner_accounts_verification_status_check check (
    verification_status in (
      'NOT_STARTED', 'PENDING', 'NEEDS_INFORMATION', 'APPROVED', 'REJECTED', 'SUSPENDED'
    )
  )
);

comment on table kitluy_core.partner_accounts is
  'Owner: Shared Platform. Business-facing Partner profile. Invariant: one active Partner account per Tenant in Phase 1 (UNIQUE tenant_id). Verification vocabulary: enum registry partner_verification_status. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.memberships — User membership in Tenant (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  user_id uuid not null references auth.users (id),
  status text not null default 'INVITED',
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  created_at timestamptz not null default now(),
  constraint memberships_status_check check (
    status in ('INVITED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED')
  ),
  constraint memberships_validity_check check (valid_to is null or valid_to > valid_from)
);

-- UNIQUE active (tenant_id, user_id): exactly one ACTIVE membership per user per tenant.
create unique index if not exists memberships_active_tenant_user_key
  on kitluy_core.memberships (tenant_id, user_id)
  where status = 'ACTIVE';

create index if not exists memberships_user_id_idx on kitluy_core.memberships (user_id);

comment on table kitluy_core.memberships is
  'Owner: Shared Platform. User membership in Tenant; user_id references auth.users(id) (Supabase Auth is the authentication root; no duplication of auth truth). Invariant: membership alone grants no action permission. UNIQUE active (tenant_id, user_id) via partial index. Status vocabulary: enum registry membership_status. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.plans — Commercial plan registry (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.plans (
  id uuid primary key default gen_random_uuid(),
  plan_code text not null,
  status text not null,
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint plans_code_effective_key unique (plan_code, effective_from),
  constraint plans_effective_check check (effective_to is null or effective_to > effective_from)
);

comment on table kitluy_core.plans is
  'Owner: Shared Platform. Commercial plan registry. Invariant: reporting access cannot be commercially paywalled (KLD-REPORT-001); commercial values are owner-required, never guessed. Status vocabulary registry-governed (seeded in group 0150). MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.feature_flags — Release/tenant/store feature flags (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.feature_flags (
  id uuid primary key default gen_random_uuid(),
  flag_key text not null,
  scope_type text not null,
  scope_id uuid,
  environment text not null,
  state text not null,
  value jsonb,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_validity_check check (valid_to is null or valid_to > valid_from),
  constraint feature_flags_version_check check (version >= 1)
);

-- UNIQUE active (flag_key, scope_type, scope_id, environment).
-- "Active" = open validity window (valid_to IS NULL). scope_id is NULL for
-- platform-wide scope; it is coalesced to the zero UUID so NULL scope rows
-- also collide (SQL NULLs never being equal would defeat the contract key).
create unique index if not exists feature_flags_active_scope_key
  on kitluy_core.feature_flags (
    flag_key,
    scope_type,
    coalesce(scope_id, '00000000-0000-0000-0000-000000000000'::uuid),
    environment
  )
  where valid_to is null;

comment on table kitluy_core.feature_flags is
  'Owner: Shared Platform. Release/tenant/store feature flags. Invariant: flags do not replace permissions or entitlements (KBR-CORE-010). scope_id is validated logically by scope_type (enforce_scope_consistency trigger lands in group 0130). MC: CFG-V (version optimistic concurrency).';

-- ---------------------------------------------------------------------------
-- kitluy_core.reference_values — Changeable reference codes and labels (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.reference_values (
  id uuid primary key default gen_random_uuid(),
  registry_key text not null,
  value_code text not null,
  status text not null default 'ACTIVE',
  sort_order integer not null default 0,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_values_key_code_effective_key unique (registry_key, value_code, effective_from),
  constraint reference_values_effective_check check (
    effective_to is null or effective_to > effective_from
  )
);

create index if not exists reference_values_registry_key_idx
  on kitluy_core.reference_values (registry_key);

comment on table kitluy_core.reference_values is
  'Owner: Shared Platform. Changeable reference codes and labels (enum registry storage strategy: business statuses, reason codes and vertical codes live here, not in PostgreSQL enums). Includes the vertical registry (registry_key vertical_code; LAUNDRY is the Phase 1 active vertical). Deactivated codes remain queryable for history. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.reference_value_translations — Localized reference labels (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.reference_value_translations (
  id uuid primary key default gen_random_uuid(),
  reference_value_id uuid not null references kitluy_core.reference_values (id),
  locale text not null,
  label text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reference_value_translations_value_locale_key unique (reference_value_id, locale)
);

comment on table kitluy_core.reference_value_translations is
  'Owner: Shared Platform. Localized reference labels (Khmer and English). Labels may change; value_code remains stable. MC: MUT.';

commit;
