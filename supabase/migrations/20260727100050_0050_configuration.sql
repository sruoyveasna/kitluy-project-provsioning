-- kitluy:group:0050
-- Migration group 0050: configuration (WS-05-T002, Cycle-5 KLD-2026-07-26-003).
--   kitluy_config: configuration_versions, configuration_publications,
--   configuration_targets, configuration_acknowledgements.
-- Contracts: DD kitluy_config; schema spec 2.9; KBR-CFG-001..009
-- (docs/source/business-rules/kitluy-configuration-publication-and-rollback-v1.0.0.md).
-- Canonical publication states are EXACTLY the KBR-CFG section 4 machine — no
-- invented states (reconciliation record section 1.3). Distinct lifecycle facts:
--   authored/snapshot  -> configuration_versions (immutable, append-only)
--   approved           -> approval_request_id -> kitluy_auth.approval_requests
--   publication        -> configuration_publications (idempotent, exactly-once)
--   delivered/acknowledged -> configuration_acknowledgements (append-only)
--   activated/failed/rollback -> configuration_targets + ROLLBACK-kind publications
-- Scope hierarchy platform -> tenant -> digital_store -> store_location ->
-- terminal_profile -> device -> channel -> vertical with child-cannot-escape-
-- parent composite FKs and a deterministic precedence column.
-- Open owner values referenced, never guessed: CFG-OD-001..005.
-- Plan-group note: the migration plan places kitluy_config in group 0090; the
-- cycle pulls it forward as group 0050 (reconciliation C1). device_id stays a
-- plain uuid (plan rule R4 — kitluy_devices lands in group 0080).
-- Purely additive; local-only this cycle; never automatic in production
-- (KL-INF-P1-037). RLS/grants/append-only triggers land in group 0070.

begin;

create schema if not exists kitluy_config;

comment on schema kitluy_config is
  'Owner: Configuration Service. Immutable configuration versions, publications, targets and acknowledgements. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md; KBR-CFG-001..009.';

-- Composite-key anchor: a (digital_store_id, store_location_id) pair
-- referencing this index cannot name a Location of another Digital Store.
create unique index if not exists store_locations_store_id_id_key
  on kitluy_core.store_locations (digital_store_id, id);

-- ---------------------------------------------------------------------------
-- kitluy_config.configuration_versions — Immutable config snapshot (MC: IMM-V,
-- PC-AO per RLS spec 5.17: UPDATE/DELETE PROHIBITED — enforce_append_only
-- attaches in group 0070; corrections/supersession publish a higher version
-- via publish_configuration_v1 in group 0130 — reconciliation C6)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_config.configuration_versions (
  id uuid primary key default gen_random_uuid(),
  config_key text not null,
  scope_type text not null,
  precedence smallint not null,
  tenant_id uuid references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  terminal_profile_code text,
  device_id uuid,
  channel_code text,
  vertical_code text,
  version bigint not null,
  schema_version text not null,
  payload jsonb not null,
  payload_hash text not null,
  status text not null default 'DRAFT',
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint configuration_versions_config_key_check check (length(trim(config_key)) > 0),
  constraint configuration_versions_scope_type_check check (
    scope_type in (
      'platform', 'tenant', 'digital_store', 'store_location',
      'terminal_profile', 'device', 'channel', 'vertical'
    )
  ),
  -- Deterministic precedence: one number per scope level, most specific wins.
  constraint configuration_versions_precedence_check check (
    (scope_type = 'platform' and precedence = 0)
    or (scope_type = 'tenant' and precedence = 1)
    or (scope_type = 'digital_store' and precedence = 2)
    or (scope_type = 'store_location' and precedence = 3)
    or (scope_type = 'terminal_profile' and precedence = 4)
    or (scope_type = 'device' and precedence = 5)
    or (scope_type = 'channel' and precedence = 6)
    or (scope_type = 'vertical' and precedence = 7)
  ),
  -- Scope ancestry: each level requires its parents and forbids the columns of
  -- deeper levels (child cannot escape parent; no hidden global blast radius —
  -- KBR-CFG-004 explicit targets).
  constraint configuration_versions_scope_shape_check check (
    (scope_type = 'platform' and tenant_id is null and digital_store_id is null
      and store_location_id is null and terminal_profile_code is null
      and device_id is null and channel_code is null and vertical_code is null)
    or (scope_type = 'tenant' and tenant_id is not null and digital_store_id is null
      and store_location_id is null and terminal_profile_code is null
      and device_id is null and channel_code is null and vertical_code is null)
    or (scope_type = 'digital_store' and tenant_id is not null and digital_store_id is not null
      and store_location_id is null and terminal_profile_code is null
      and device_id is null and channel_code is null and vertical_code is null)
    or (scope_type = 'store_location' and tenant_id is not null and digital_store_id is not null
      and store_location_id is not null and terminal_profile_code is null
      and device_id is null and channel_code is null and vertical_code is null)
    or (scope_type = 'terminal_profile' and tenant_id is not null and digital_store_id is not null
      and store_location_id is not null and terminal_profile_code is not null
      and device_id is null and channel_code is null and vertical_code is null)
    or (scope_type = 'device' and tenant_id is not null and digital_store_id is not null
      and store_location_id is not null and device_id is not null
      and terminal_profile_code is null and channel_code is null and vertical_code is null)
    or (scope_type = 'channel' and tenant_id is not null and digital_store_id is not null
      and channel_code is not null and store_location_id is null
      and terminal_profile_code is null and device_id is null and vertical_code is null)
    or (scope_type = 'vertical' and vertical_code is not null and tenant_id is null
      and digital_store_id is null and store_location_id is null
      and terminal_profile_code is null and device_id is null and channel_code is null)
  ),
  -- Child-cannot-escape-parent: the named Digital Store must belong to the
  -- named Tenant, and the named Location must belong to the named Store.
  constraint configuration_versions_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint configuration_versions_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint configuration_versions_version_check check (version >= 1),
  constraint configuration_versions_payload_hash_check check (length(trim(payload_hash)) > 0),
  -- Canonical KBR-CFG section 4 publication state machine — EXACT states only.
  constraint configuration_versions_status_check check (
    status in (
      'DRAFT', 'VALIDATION_FAILED', 'VALIDATED', 'APPROVAL_REQUIRED',
      'APPROVED', 'REJECTED', 'EXPIRED', 'PUBLISHING', 'PUBLISHED',
      'ACKNOWLEDGED', 'ACTIVE', 'PARTIAL_FAILURE', 'FAILED',
      'SUPERSEDED', 'ROLLED_BACK'
    )
  )
);

-- Version uniqueness inside one (config_key, scope) lineage.
create unique index if not exists configuration_versions_scope_version_key
  on kitluy_config.configuration_versions (
    config_key,
    scope_type,
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(digital_store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(store_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(terminal_profile_code, ''),
    coalesce(device_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(channel_code, ''),
    coalesce(vertical_code, ''),
    version
  );

create index if not exists configuration_versions_tenant_id_idx
  on kitluy_config.configuration_versions (tenant_id);

create index if not exists configuration_versions_payload_hash_idx
  on kitluy_config.configuration_versions (payload_hash);

comment on table kitluy_config.configuration_versions is
  'Owner: Configuration Service. Immutable configuration snapshot (KBR-CFG-001: versioned artifact, never mutable live rows). Scope hierarchy platform->tenant->digital_store->store_location->terminal_profile->device->channel->vertical with deterministic precedence column and child-cannot-escape-parent composite FKs. Status uses EXACTLY the canonical KBR-CFG section 4 states. PC-AO (RLS 5.17): UPDATE/DELETE prohibited — enforce_append_only in group 0070; supersession/rollback are forward publications of another version (KBR-CFG-007/008). approval_request_id links the APPROVED fact to kitluy_auth.approval_requests (KBR-CFG-003). device_id is a plain uuid until kitluy_devices lands (plan rule R4, group 0080). Open owner values CFG-OD-001..005 not encoded. Sensitivity: internal. MC: IMM-V (append-only).';

comment on column kitluy_config.configuration_versions.precedence is
  'Deterministic resolution precedence derived from scope_type (0=platform .. 7=vertical); higher/more specific wins. CHECK-bound so the number can never contradict the scope level.';

-- ---------------------------------------------------------------------------
-- kitluy_config.configuration_publications — Publication header (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_config.configuration_publications (
  id uuid primary key default gen_random_uuid(),
  configuration_version_id uuid not null references kitluy_config.configuration_versions (id),
  publication_kind text not null default 'PUBLISH',
  rollback_of_publication_id uuid references kitluy_config.configuration_publications (id),
  rollback_reason text,
  idempotency_key text not null,
  status text not null default 'PUBLISHING',
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  constraint configuration_publications_idempotency_key_key unique (idempotency_key),
  constraint configuration_publications_kind_check check (
    publication_kind in ('PUBLISH', 'ROLLBACK')
  ),
  -- A rollback publication names what it rolls back and why (KBR-CFG-007);
  -- a plain publication carries neither.
  constraint configuration_publications_rollback_shape_check check (
    (publication_kind = 'ROLLBACK' and rollback_of_publication_id is not null
      and rollback_reason is not null)
    or (publication_kind = 'PUBLISH' and rollback_of_publication_id is null
      and rollback_reason is null)
  ),
  constraint configuration_publications_status_check check (
    status in (
      'PUBLISHING', 'PUBLISHED', 'ACKNOWLEDGED', 'ACTIVE',
      'PARTIAL_FAILURE', 'FAILED', 'SUPERSEDED', 'ROLLED_BACK'
    )
  )
);

create index if not exists configuration_publications_version_idx
  on kitluy_config.configuration_publications (configuration_version_id);

comment on table kitluy_config.configuration_publications is
  'Owner: Configuration Service. Publication header (KBR-CFG-004: distribute an approved version to explicit targets; state becomes PUBLISHING; partial target failure stays visible — KBR-CFG-006 truth labels). UNIQUE idempotency_key = publication exactly-once (KBR-CORE-004). ROLLBACK-kind rows are the KBR-CFG-007 rollback publications: they activate a prior compatible version for future operations and never rewrite history. Sensitivity: internal. MC: MUT (status transitions via governed RPC only).';

-- ---------------------------------------------------------------------------
-- kitluy_config.configuration_targets — Per-target desired state (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_config.configuration_targets (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null references kitluy_config.configuration_publications (id),
  target_type text not null,
  target_id uuid,
  target_code text,
  status text not null default 'PUBLISHING',
  error_code text,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  constraint configuration_targets_target_type_check check (
    target_type in ('digital_store', 'store_location', 'terminal_profile', 'device', 'channel')
  ),
  constraint configuration_targets_target_ref_check check (
    target_id is not null or target_code is not null
  ),
  -- Per-target result vocabulary: KBR-CFG-004/005 staged/activated/failed plus
  -- KBR-CFG-007 rollback; PUBLISHING is the initial publication-intent state.
  constraint configuration_targets_status_check check (
    status in ('PUBLISHING', 'STAGED', 'ACTIVE', 'FAILED', 'ROLLED_BACK')
  )
);

create unique index if not exists configuration_targets_publication_target_key
  on kitluy_config.configuration_targets (
    publication_id,
    target_type,
    coalesce(target_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(target_code, '')
  );

comment on table kitluy_config.configuration_targets is
  'Owner: Configuration Service. Per-target desired state; each target independently reports STAGED/ACTIVE/FAILED (KBR-CFG-005) or ROLLED_BACK (KBR-CFG-007); failures stay explicit and are never marked complete without evidence (KBR-CFG-006). Sensitivity: internal. MC: MUT (status via governed RPC only).';

-- ---------------------------------------------------------------------------
-- kitluy_config.configuration_acknowledgements — Delivery/acknowledgement truth
-- (MC: A/O — append-only evidence, trigger in group 0070)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_config.configuration_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references kitluy_config.configuration_targets (id),
  consumer_id uuid not null,
  applied_version bigint not null,
  result text not null,
  acknowledged_at timestamptz not null default now(),
  constraint configuration_acknowledgements_applied_version_check check (applied_version >= 1),
  constraint configuration_acknowledgements_result_check check (
    result in ('STAGED', 'ACTIVE', 'FAILED', 'ROLLED_BACK')
  )
);

create index if not exists configuration_acknowledgements_target_idx
  on kitluy_config.configuration_acknowledgements (target_id);

comment on table kitluy_config.configuration_acknowledgements is
  'Owner: Configuration Service. Device/consumer acknowledgement evidence (KBR-CFG-006: publication intent is separate from application truth; missing acknowledgement is pending/stale, never success; the cloud never assumes an offline target updated). Append-only — enforce_append_only attaches in group 0070. consumer_id is the acknowledging Hub/device/consumer identity (plain uuid until kitluy_devices lands — plan rule R4). Sensitivity: internal. MC: A/O.';

commit;
