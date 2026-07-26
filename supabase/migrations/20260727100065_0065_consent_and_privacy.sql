-- kitluy:group:0065
-- Migration group 0065: consent_and_privacy (WS-06-T002, Cycle-5 KLD-2026-07-26-003).
--   kitluy_core: consent_purposes, consent_purpose_versions, consent_grants,
--     consent_withdrawals, privacy_requests, privacy_request_decisions
--   kitluy_notifications: preferences (DD table; partial schema — the rest of
--     kitluy_notifications stays in plan group 0100; reconciliation C8)
-- Contracts: KBR-CUS-004..007; DD kitluy_notifications.preferences; enum
-- registry consent_state; reconciliation record section 1.5 and C2 (the
-- consent/privacy relations are cycle-mandated, DD amendment REQUIRED).
-- Core consent invariants implemented here:
--   * Consent is NEVER a mutable boolean: grants and withdrawals are separate
--     append-only records; state derives from the latest valid grant minus
--     withdrawal per purpose/channel (KBR-CUS-004).
--   * A withdrawal REFERENCES its grant and never erases it — withdrawal
--     preserves the grant evidence.
--   * Communication-preference classes OPERATIONAL / TRANSACTIONAL /
--     MARKETING / SERVICE_STATUS / LEGAL are SEPARATE: withdrawing marketing
--     never suppresses transactional/operational/legal messages.
--   * Privacy requests and their decisions are append-only; deletion requests
--     never destroy required finalized finance/audit truth (KBR-CUS-006).
-- Open owner values referenced, never guessed: CUS-OD-001 (privacy depth,
-- legal basis, retention), CUS-OD-004 (purpose registry content).
-- Purely additive; local-only this cycle; never automatic in production
-- (KL-INF-P1-037). RLS/grants/append-only triggers land in group 0070.

begin;

create schema if not exists kitluy_notifications;

comment on schema kitluy_notifications is
  'Owner: Notification Service. Templates, consent/preferences, tokens, jobs, attempts and delivery truth. This cycle: preferences only (reconciliation C8 — partial schema, remainder in plan group 0100). Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- ---------------------------------------------------------------------------
-- kitluy_core.consent_purposes — Consent purpose registry (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.consent_purposes (
  id uuid primary key default gen_random_uuid(),
  purpose_key text not null,
  communication_class text not null,
  description text,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint consent_purposes_purpose_key_key unique (purpose_key),
  constraint consent_purposes_purpose_key_check check (length(trim(purpose_key)) > 0),
  -- The five SEPARATE communication-preference classes (cycle section 10).
  constraint consent_purposes_communication_class_check check (
    communication_class in (
      'OPERATIONAL', 'TRANSACTIONAL', 'MARKETING', 'SERVICE_STATUS', 'LEGAL'
    )
  ),
  constraint consent_purposes_status_check check (status in ('ACTIVE', 'RETIRED'))
);

comment on table kitluy_core.consent_purposes is
  'Owner: Shared Platform (Consent and Privacy Service). Registered consent purposes, each bound to exactly one of the five separate communication classes (OPERATIONAL/TRANSACTIONAL/MARKETING/SERVICE_STATUS/LEGAL). No blanket implied marketing consent exists (KBR-CUS-004). The transactional-vs-marketing purpose registry content is open owner value CUS-OD-004. Cycle-mandated relation (reconciliation C2). Sensitivity: internal. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_core.consent_purpose_versions — Immutable notice/policy versions
-- (MC: IMM-V — append-only, trigger in group 0070)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.consent_purpose_versions (
  id uuid primary key default gen_random_uuid(),
  consent_purpose_id uuid not null references kitluy_core.consent_purposes (id),
  version bigint not null,
  policy_ref text,
  notice_text text,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  constraint consent_purpose_versions_purpose_version_key
    unique (consent_purpose_id, version),
  constraint consent_purpose_versions_version_check check (version >= 1),
  constraint consent_purpose_versions_effective_check check (
    effective_to is null or effective_to > effective_from
  )
);

comment on table kitluy_core.consent_purpose_versions is
  'Owner: Shared Platform. Versioned consent notice/policy text per purpose (KBR-CUS-004: every grant cites the policy version shown to the customer). Append-only — corrections publish a higher version (enforce_append_only in group 0070). Cycle-mandated relation (reconciliation C2). Sensitivity: internal. MC: IMM-V (append-only).';

-- ---------------------------------------------------------------------------
-- kitluy_core.consent_grants — Append-only consent grant events (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.consent_grants (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  consent_purpose_version_id uuid not null references kitluy_core.consent_purpose_versions (id),
  channel text not null,
  source text not null,
  evidence_ref text,
  recorded_by uuid references auth.users (id),
  granted_at timestamptz not null default now(),
  constraint consent_grants_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint consent_grants_channel_check check (length(trim(channel)) > 0),
  constraint consent_grants_source_check check (length(trim(source)) > 0)
);

create index if not exists consent_grants_customer_idx
  on kitluy_core.consent_grants (customer_id);

create index if not exists consent_grants_purpose_version_idx
  on kitluy_core.consent_grants (consent_purpose_version_id);

comment on table kitluy_core.consent_grants is
  'Owner: Shared Platform. Append-only consent GRANT events per purpose-version and channel, with source and evidence (KBR-CUS-004: consent state derives from the latest valid grant/withdrawal — never a mutable boolean anywhere). enforce_append_only in group 0070. Cycle-mandated relation (reconciliation C2). Sensitivity: PII. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_core.consent_withdrawals — Append-only withdrawals (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.consent_withdrawals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  consent_grant_id uuid not null references kitluy_core.consent_grants (id),
  reason_code text,
  source text not null,
  recorded_by uuid references auth.users (id),
  withdrawn_at timestamptz not null default now(),
  constraint consent_withdrawals_grant_key unique (consent_grant_id),
  constraint consent_withdrawals_source_check check (length(trim(source)) > 0)
);

comment on table kitluy_core.consent_withdrawals is
  'Owner: Shared Platform. Append-only consent WITHDRAWAL events. A withdrawal references its grant (FK consent_grant_id) and NEVER erases it: the grant row remains intact as evidence; only future sends are suppressed (KBR-CUS-004 compensating action). enforce_append_only in group 0070. Cycle-mandated relation (reconciliation C2). Sensitivity: PII. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_notifications.preferences — Communication-preference state (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_notifications.preferences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references kitluy_core.tenants (id),
  customer_id uuid references kitluy_core.customers (id),
  user_id uuid references auth.users (id),
  event_family text not null,
  channel text not null,
  state text not null default 'UNKNOWN',
  source text not null,
  source_ref uuid,
  updated_at timestamptz not null default now(),
  constraint preferences_subject_check check (
    customer_id is not null or user_id is not null
  ),
  -- The five communication classes are SEPARATE preference rows; marketing
  -- state never bleeds into transactional/operational/service-status/legal.
  constraint preferences_event_family_check check (
    event_family in ('OPERATIONAL', 'TRANSACTIONAL', 'MARKETING', 'SERVICE_STATUS', 'LEGAL')
  ),
  constraint preferences_channel_check check (length(trim(channel)) > 0),
  constraint preferences_state_check check (
    state in ('UNKNOWN', 'GRANTED', 'DENIED', 'WITHDRAWN', 'NOT_REQUIRED')
  ),
  constraint preferences_source_check check (length(trim(source)) > 0)
);

create unique index if not exists preferences_subject_family_channel_key
  on kitluy_notifications.preferences (
    coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    event_family,
    channel
  );

create index if not exists preferences_customer_idx
  on kitluy_notifications.preferences (customer_id);

comment on table kitluy_notifications.preferences is
  'Owner: Notification Service. Consent/channel preference state per subject, event_family (the five SEPARATE communication classes) and channel — enum registry consent_state. This is a PROJECTION of the append-only consent truth (consent_grants/consent_withdrawals via source/source_ref traceability); it is never authoritative over those records and never a bare mutable boolean without lineage (KBR-CUS-004). Missing/stale optional-marketing state means DO NOT SEND. Sensitivity: PII. MC: MUT (RPC-maintained).';

-- ---------------------------------------------------------------------------
-- kitluy_core.privacy_requests — Append-only privacy request facts (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.privacy_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  customer_id uuid not null references kitluy_core.customers (id),
  request_type text not null,
  scope jsonb,
  verification_ref text,
  requested_by uuid references auth.users (id),
  requested_at timestamptz not null default now(),
  constraint privacy_requests_tenant_customer_fk
    foreign key (tenant_id, customer_id)
    references kitluy_core.customers (tenant_id, id),
  constraint privacy_requests_request_type_check check (
    request_type in ('ACCESS', 'EXPORT', 'CORRECTION', 'DELETION', 'RESTRICTION', 'CONSENT')
  )
);

create index if not exists privacy_requests_customer_idx
  on kitluy_core.privacy_requests (customer_id);

comment on table kitluy_core.privacy_requests is
  'Owner: Shared Platform (Privacy Operations). Append-only privacy request facts (access/export/correction/deletion/restriction/consent — KBR-CUS-006). Case outcomes live in privacy_request_decisions; the request row itself is immutable evidence (enforce_append_only in group 0070). Deletion can never destroy required finalized finance/payment/inventory/audit truth — governed exceptions are recorded as decisions. Workflow depth/legal basis/retention remain open owner value CUS-OD-001. Cycle-mandated relation (reconciliation C2). Sensitivity: PII. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_core.privacy_request_decisions — Append-only decisions (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_core.privacy_request_decisions (
  id uuid primary key default gen_random_uuid(),
  privacy_request_id uuid not null references kitluy_core.privacy_requests (id),
  decision text not null,
  reason text,
  evidence_ref text,
  decided_by uuid references auth.users (id),
  decided_at timestamptz not null default now(),
  constraint privacy_request_decisions_decision_check check (
    decision in ('VERIFIED', 'COMPLETED', 'DENIED', 'EXCEPTION')
  )
);

create index if not exists privacy_request_decisions_request_idx
  on kitluy_core.privacy_request_decisions (privacy_request_id);

comment on table kitluy_core.privacy_request_decisions is
  'Owner: Shared Platform (Privacy Operations). Append-only decisions/outcomes for privacy requests (verified/completed/denied/exception with reason and evidence — KBR-CUS-006 audit events). Partial execution is never marked complete. enforce_append_only in group 0070. Cycle-mandated relation (reconciliation C2). Sensitivity: PII. MC: A/O.';

commit;

-- Review fix (2026-07-27__WS-05-06-EXECUTION MEDIUM finding): the
-- trusted-writer path could pair a customer with a foreign tenant in
-- kitluy_notifications.preferences. Composite FK pins the pair.
alter table kitluy_core.customers
  add constraint customers_id_tenant_uk unique (id, tenant_id);
alter table kitluy_notifications.preferences
  add constraint preferences_customer_tenant_fk
  foreign key (customer_id, tenant_id)
  references kitluy_core.customers (id, tenant_id);
