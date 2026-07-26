-- kitluy:group:0060
-- Migration group 0060: customer_identity (WS-06-T001, Cycle-5 KLD-2026-07-26-003).
--   kitluy_core: customers, customer_contacts, customer_store_relationships,
--     customer_merge_requests, customer_merge_results, customer_status_history
--   kitluy_storefront: customer_channel_identities, customer_phone_challenges,
--     customer_sessions
-- Contracts: DD kitluy_core/kitluy_storefront; schema spec 2.5; KBR-CUS-001..003
-- (docs/source/business-rules/kitluy-customer-identity-consent-and-privacy-v1.0.0.md).
-- Reconciliation record C2: the store-relationship, merge and status-history
-- relations are cycle-mandated and not yet enumerated in DD v1.0.0 — a data
-- dictionary amendment is REQUIRED (recorded, not silently resolved).
-- Phone-first identity (KBR-CUS-001): normalized E.164 value + separate
-- entered/display form + separate masked display column (KBR-CUS-005 data
-- minimization); email is OPTIONAL everywhere. A phone number is a contact
-- point and evidence signal, never sufficient proof to auto-merge.
-- Merge (KBR-CUS-003): same-Tenant only (composite FKs), requester and
-- reviewer must be distinct people, losing record is preserved as a tombstone
-- (status MERGED + merged_into_customer_id) — no destructive delete.
-- Open owner values referenced, never guessed: CUS-OD-002 (OTP values),
-- CUS-OD-003 (merge approval threshold/unmerge scope).
-- Purely additive; local-only this cycle; never automatic in production
-- (KL-INF-P1-037). RLS/grants/append-only triggers land in group 0070.

begin;

create schema if not exists kitluy_storefront;

comment on schema kitluy_storefront is
  'Owner: Storefront. Public publication, entry points, customer sessions, pre-intake, queues and intake verification. This cycle: the three customer identity tables only. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- ---------------------------------------------------------------------------
-- kitluy_core.customers — Unified Tenant-owned customer identity (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  display_name text,
  status text not null default 'ACTIVE',
  preferred_locale text,
  merged_into_customer_id uuid references kitluy_core.customers (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_status_check check (
    status in ('ACTIVE', 'INACTIVE', 'MERGED', 'ANONYMIZED')
  ),
  -- Tombstone/alias contract: exactly the MERGED rows point at a survivor.
  constraint customers_merge_tombstone_check check (
    (status = 'MERGED') = (merged_into_customer_id is not null)
  ),
  constraint customers_no_self_merge_check check (
    merged_into_customer_id is null or merged_into_customer_id <> id
  )
);

-- Composite-key anchor for same-tenant child FKs (child cannot escape parent).
create unique index if not exists customers_tenant_id_id_key
  on kitluy_core.customers (tenant_id, id);

create index if not exists customers_tenant_id_idx
  on kitluy_core.customers (tenant_id);

comment on table kitluy_core.customers is
  'Owner: Shared Platform. Unified Tenant-owned customer identity (KBR-CUS-001; channels never own customer truth). Losing merge parties are preserved as tombstones: status MERGED + merged_into_customer_id (KBR-CUS-003 — no destructive delete of the losing record). Status vocabulary registry-governed (0150 seed; reconciliation record 1.4). Sensitivity: PII. MC: MUT (writes RPC-only).';

-- ---------------------------------------------------------------------------
-- kitluy_core.customer_contacts — Phone/email contact identifiers (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  type text not null,
  normalized_value text not null,
  display_value text,
  masked_value text,
  verified_at timestamptz,
  is_primary boolean not null default false,
  consent_status text not null default 'UNKNOWN',
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contacts_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint customer_contacts_type_check check (
    type in ('PHONE', 'EMAIL', 'TELEGRAM', 'OTHER')
  ),
  -- Phone identifiers store the governed E.164-compatible normalized form
  -- (KBR-CUS-001: normalize, preserve entered form separately).
  constraint customer_contacts_phone_e164_check check (
    type <> 'PHONE' or normalized_value ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint customer_contacts_consent_status_check check (
    consent_status in ('UNKNOWN', 'GRANTED', 'DENIED', 'WITHDRAWN', 'NOT_REQUIRED')
  ),
  constraint customer_contacts_status_check check (
    status in ('ACTIVE', 'UNVERIFIED', 'SUPERSEDED', 'REMOVED')
  ),
  -- Masking is a separate display column, never the storage form (KBR-CUS-005);
  -- a masked value must not simply repeat the full normalized identifier.
  constraint customer_contacts_masked_distinct_check check (
    masked_value is null or masked_value <> normalized_value
  )
);

-- DD contract key: UNIQUE (tenant_id, type, normalized_value) where active
-- (reconciliation C10: active = status ACTIVE; a duplicate candidate carries
-- status UNVERIFIED until the governed duplicate workflow resolves it).
create unique index if not exists customer_contacts_active_identifier_key
  on kitluy_core.customer_contacts (tenant_id, type, normalized_value)
  where status = 'ACTIVE';

-- At most one primary contact per customer and type.
create unique index if not exists customer_contacts_primary_per_type_key
  on kitluy_core.customer_contacts (customer_id, type)
  where is_primary;

create index if not exists customer_contacts_customer_id_idx
  on kitluy_core.customer_contacts (customer_id);

comment on table kitluy_core.customer_contacts is
  'Owner: Shared Platform. Phone/email/contact identifiers (alias "customer identifiers" — Hub edge_core.customer_identifier; reconciliation 1.4). Phone-first Phase 1: normalized_value is the governed E.164 form (CHECK), display_value preserves the entered form, masked_value is the separate role-safe display (KBR-CUS-005). Email/other types are optional; no email is ever required. Verification is explicit (verified_at). UNIQUE active identifier per tenant/type via partial index. Sensitivity: PII. MC: MUT (writes RPC-only: link_customer_contact_v1 in group 0130).';

comment on column kitluy_core.customer_contacts.masked_value is
  'Role-safe masked display form (e.g. suffix-only), stored separately from the normalized identifier; never used for matching (KBR-CUS-005).';

-- ---------------------------------------------------------------------------
-- kitluy_core.customer_store_relationships — Customer/Digital-Store relation
-- (MC: MUT; cycle section 9 entity — reconciliation C2, DD amendment required)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customer_store_relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  status text not null default 'ACTIVE',
  source_code text,
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_store_relationships_customer_store_key
    unique (customer_id, digital_store_id),
  constraint customer_store_relationships_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint customer_store_relationships_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint customer_store_relationships_status_check check (
    status in ('ACTIVE', 'INACTIVE')
  )
);

create index if not exists customer_store_relationships_store_idx
  on kitluy_core.customer_store_relationships (digital_store_id);

comment on table kitluy_core.customer_store_relationships is
  'Owner: Shared Platform. Customer-to-Digital-Store relationship (first_seen/source attribution). Same-tenant-only by composite FKs (child cannot escape parent). source_code vocabulary: enum registry booking_source. Cycle-mandated relation not yet in DD v1.0.0 (reconciliation C2 — amendment required). Sensitivity: PII-adjacent. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.customer_merge_requests — Governed duplicate resolution (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customer_merge_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  surviving_customer_id uuid not null references kitluy_core.customers (id),
  merging_customer_id uuid not null references kitluy_core.customers (id),
  match_evidence jsonb,
  reason text,
  status text not null default 'REQUESTED',
  requested_by uuid not null references auth.users (id),
  reviewed_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint customer_merge_requests_distinct_parties_check check (
    surviving_customer_id <> merging_customer_id
  ),
  -- KBR-CUS-003 precondition "same Tenant governance scope" enforced by the
  -- database: both parties must resolve inside the request tenant.
  constraint customer_merge_requests_tenant_survivor_fk
    foreign key (tenant_id, surviving_customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint customer_merge_requests_tenant_merging_fk
    foreign key (tenant_id, merging_customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint customer_merge_requests_status_check check (
    status in ('REQUESTED', 'PREVIEWED', 'APPROVED', 'REJECTED', 'BLOCKED', 'COMPLETED')
  ),
  -- Restricted merge review: the requester can never be the reviewer
  -- (KBR-CUS-003 permissions; four-eyes analog KLSEC-026).
  constraint customer_merge_requests_distinct_reviewer_check check (
    reviewed_by is null or reviewed_by <> requested_by
  )
);

-- One open merge request per ordered pair.
create unique index if not exists customer_merge_requests_open_pair_key
  on kitluy_core.customer_merge_requests (surviving_customer_id, merging_customer_id)
  where status in ('REQUESTED', 'PREVIEWED', 'APPROVED');

create index if not exists customer_merge_requests_tenant_idx
  on kitluy_core.customer_merge_requests (tenant_id);

comment on table kitluy_core.customer_merge_requests is
  'Owner: Shared Platform. Governed customer duplicate-merge request (KBR-CUS-003: preview, confirmation/approval, same-tenant only — composite FKs; a phone match alone never auto-merges). requested_by and reviewed_by must be distinct (CHECK). Approval threshold values remain open owner value CUS-OD-003. Cycle-mandated relation not yet in DD v1.0.0 (reconciliation C2). Sensitivity: PII. MC: MUT (RPC-only writes).';

-- ---------------------------------------------------------------------------
-- kitluy_core.customer_merge_results — Append-only merge outcome (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customer_merge_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  merge_request_id uuid not null references kitluy_core.customer_merge_requests (id),
  surviving_customer_id uuid not null references kitluy_core.customers (id),
  merged_customer_id uuid not null references kitluy_core.customers (id),
  moved_links jsonb,
  completed_by uuid references auth.users (id),
  completed_at timestamptz not null default now(),
  constraint customer_merge_results_request_key unique (merge_request_id),
  constraint customer_merge_results_distinct_parties_check check (
    surviving_customer_id <> merged_customer_id
  )
);

comment on table kitluy_core.customer_merge_results is
  'Owner: Shared Platform. Append-only merge outcome evidence: surviving identity, merged (losing) identity and the moved-link summary. The losing customer row is retained as a tombstone (customers.status = MERGED + merged_into_customer_id) — merges never destructively delete history (KBR-CUS-003). enforce_append_only attaches in group 0070. Cycle-mandated relation (reconciliation C2). Sensitivity: PII. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_core.customer_status_history — Append-only status lifecycle (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.customer_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  from_status text,
  to_status text not null,
  reason_code text,
  actor_id uuid references auth.users (id),
  occurred_at timestamptz not null default now(),
  constraint customer_status_history_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id)
);

create index if not exists customer_status_history_customer_idx
  on kitluy_core.customer_status_history (customer_id);

comment on table kitluy_core.customer_status_history is
  'Owner: Shared Platform. Append-only customer status lifecycle evidence (create/deactivate/merge/anonymize transitions with actor and reason). enforce_append_only attaches in group 0070. Cycle-mandated relation (reconciliation C2). Sensitivity: PII-adjacent. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_storefront.customer_channel_identities — Channel identity linkage
-- (MC: MUT; PC-PUBTOK — RPC-only access, no client policy in group 0070)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_storefront.customer_channel_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  channel_type text not null,
  external_subject_hash text not null,
  verified_at timestamptz,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  constraint customer_channel_identities_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint customer_channel_identities_channel_type_check check (
    length(trim(channel_type)) > 0
  ),
  constraint customer_channel_identities_hash_check check (
    length(trim(external_subject_hash)) > 0
  ),
  constraint customer_channel_identities_status_check check (
    status in ('ACTIVE', 'REVOKED')
  ),
  constraint customer_channel_identities_identity_key
    unique (customer_id, channel_type, external_subject_hash)
);

comment on table kitluy_storefront.customer_channel_identities is
  'Owner: Storefront. Channel identity linkage (Telegram/web/...). Stores subject HASHES only — never raw external subjects. channel_type vocabulary registry-governed. PC-PUBTOK: no direct client policy; storefront RPCs only (group 0130). Sensitivity: PII. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_storefront.customer_phone_challenges — Phone verification lifecycle
-- (MC: challenge history; PC-PUBTOK — RPC-only)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_storefront.customer_phone_challenges (
  id uuid primary key default gen_random_uuid(),
  normalized_phone text not null,
  challenge_hash text not null,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz,
  rate_limit_key text,
  created_at timestamptz not null default now(),
  constraint customer_phone_challenges_phone_e164_check check (
    normalized_phone ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint customer_phone_challenges_attempts_check check (attempts >= 0),
  constraint customer_phone_challenges_hash_check check (
    length(trim(challenge_hash)) > 0
  )
);

create index if not exists customer_phone_challenges_phone_idx
  on kitluy_storefront.customer_phone_challenges (normalized_phone);

comment on table kitluy_storefront.customer_phone_challenges is
  'Owner: Storefront. Phone (OTP) verification lifecycle: challenge HASH only, attempt counter, mandatory expiry, rate-limit key (KBR-CUS-002: possession-free lookup grants nothing; anti-enumeration). OTP provider/expiry/rate-limit values remain open owner value CUS-OD-002 — no default encodes them. PC-PUBTOK: RPC-only; the attempts counter mutates exclusively through the challenge RPC (group 0130), so no generic append-only trigger is attached (recorded in group 0070). Sensitivity: PII/security. MC: challenge history.';

-- ---------------------------------------------------------------------------
-- kitluy_storefront.customer_sessions — Short-lived public sessions
-- (MC: MUT; PC-PUBTOK — RPC-only)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_storefront.customer_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references kitluy_core.customers (id),
  session_token_hash text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint customer_sessions_token_hash_key unique (session_token_hash),
  constraint customer_sessions_token_hash_check check (
    length(trim(session_token_hash)) > 0
  )
);

comment on table kitluy_storefront.customer_sessions is
  'Owner: Storefront. Short-lived public customer sessions: token HASH only (raw tokens never stored), mandatory expiry, explicit revocation (KBR-CUS-002). PC-PUBTOK: RPC-only; no client policy. Sensitivity: security. MC: MUT.';

commit;
