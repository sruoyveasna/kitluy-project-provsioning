-- kitluy:group:0090
-- Migration group 0090: finance_subledger (WS-08-T004, Cycle-6 KLD-2026-07-26-003 §6/§7).
--   kitluy_finance: subledger_accounts, subledger_account_translations,
--   journal_entries, journal_postings, source_postings, idempotency_records
--   + AMD-I1 balancing constraint triggers + post_journal_entry_v1 RPC.
-- Column contract: docs/data/kitluy-suite-supabase-data-dictionary-amendment-001-finance-subledger-v1.0.0.md
--   (FIN-DD-001, CONTRACT-APPROVED; authorized by KLD-2026-07-26-003 §4).
--   This file authors the approved amendment relations verbatim — ONE
--   operational subledger, never a second ledger (KLD-FIN-002: operational
--   subledger, not statutory ERP; KLMF-FIN-005 = B).
-- Business rules: docs/source/business-rules/kitluy-finance-subledger-and-reconciliation-v1.0.0.md
--   KBR-FIN-001..009. Engine mapping per Amendment-001 §8 (@kitluy/payments
--   Posting/LedgerRecord streams; engine account codes are seed candidates
--   only — the canonical chart of accounts is open owner value FIN-OD-001).
-- Invariants (Amendment-001 §9): AMD-I1 balanced entries (deferred constraint
--   triggers + RPC), AMD-I2 append-only (RLS + enforce_append_only in group
--   0095 + INSERT only via RPC), AMD-I3 idempotency uniqueness, AMD-I4
--   provider-event uniqueness (kitluy_payments.payment_provider_events —
--   referenced, not duplicated), AMD-I5 bigint minor units, AMD-I6 no silent
--   FX, AMD-I7 business-date binding (shift/pos FKs attach when kitluy_pos
--   lands — plain uuid columns, audit_logs.device_id precedent).
-- Open owner values referenced and NOT guessed: FIN-OD-001..005 (chart of
--   accounts, posting-rule catalog, period-lock policy, export formats,
--   deposit accounting), PRC-OD-004/005, SHIFT-OD-002. Dev fixtures use
--   clearly fictional DEV-* account codes solely to prove the mechanism.
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED). RLS/grants/append-only triggers land in
-- 20260727110095_0095_ws07_ws08_rls.sql (same release train).

begin;

create schema if not exists kitluy_finance;

comment on schema kitluy_finance is
  'Owner: Finance Subledger. Operational finance subledger (Amendment-001/FIN-DD-001): accounts, balanced append-only journals, typed source postings and idempotency records. Operational subledger only — no statutory GL claim (KLD-FIN-002). Ref: kitluy-suite-supabase-data-dictionary-amendment-001-finance-subledger-v1.0.0.md';

-- ---------------------------------------------------------------------------
-- kitluy_finance.subledger_accounts — Account registry (MC: CFG-V)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.subledger_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  account_code text not null,
  account_class text not null,
  normal_side text not null,
  status text not null default 'ACTIVE',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subledger_accounts_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint subledger_accounts_code_check check (length(trim(account_code)) > 0),
  constraint subledger_accounts_class_check check (length(trim(account_class)) > 0),
  constraint subledger_accounts_normal_side_check check (
    normal_side in ('DEBIT', 'CREDIT')
  ),
  constraint subledger_accounts_status_check check (
    status in ('ACTIVE', 'INACTIVE', 'ARCHIVED')
  ),
  constraint subledger_accounts_effective_check check (
    effective_to is null or effective_to > effective_from
  ),
  constraint subledger_accounts_version_check check (version >= 1)
);

create unique index if not exists subledger_accounts_tenant_id_id_key
  on kitluy_finance.subledger_accounts (tenant_id, id);

create unique index if not exists subledger_accounts_active_code_key
  on kitluy_finance.subledger_accounts (
    tenant_id,
    coalesce(digital_store_id, '00000000-0000-0000-0000-000000000000'::uuid),
    account_code
  )
  where status = 'ACTIVE';

comment on table kitluy_finance.subledger_accounts is
  'Owner: Finance Subledger. Subledger account registry (Amendment-001 §5.1; "Amendment-001 additive; supersedes nothing"). digital_store_id NULL = tenant-wide account. account_class/entry vocabularies are registry keys (finance_account_class — Amendment-001 §10); the CANONICAL chart of accounts remains open owner value FIN-OD-001 — dev fixtures seed clearly fictional DEV-* codes only (engine account names are seed candidates, Amendment-001 §8). Sensitivity: internal-financial. MC: CFG-V.';

create trigger trg_subledger_accounts_version
  before update on kitluy_finance.subledger_accounts
  for each row execute function kitluy_auth.enforce_version_increment();

create trigger trg_subledger_accounts_frozen
  before update on kitluy_finance.subledger_accounts
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'account_code', 'normal_side',
    'created_at'
  );

-- ---------------------------------------------------------------------------
-- kitluy_finance.subledger_account_translations — Localized labels (MC: MUT)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.subledger_account_translations (
  id uuid primary key default gen_random_uuid(),
  subledger_account_id uuid not null references kitluy_finance.subledger_accounts (id),
  locale text not null,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subledger_account_translations_account_locale_key
    unique (subledger_account_id, locale),
  constraint subledger_account_translations_locale_check check (
    length(trim(locale)) > 0
  ),
  constraint subledger_account_translations_name_check check (
    length(trim(name)) > 0
  )
);

comment on table kitluy_finance.subledger_account_translations is
  'Owner: Finance Subledger. Localized account labels (Khmer/English — Amendment-001 §5.2). Codes stay language-neutral. Sensitivity: internal. MC: MUT.';

-- ---------------------------------------------------------------------------
-- kitluy_finance.journal_entries — Balanced journal headers (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  business_date date not null,
  business_date_policy_version text,
  original_business_date date,
  period_classification text not null default 'NORMAL',
  shift_id uuid,
  pos_session_id uuid,
  entry_type text not null,
  posting_rule_key text not null,
  posting_rule_version text,
  source_type text not null,
  source_id uuid not null,
  reverses_journal_entry_id uuid references kitluy_finance.journal_entries (id),
  currency_code char(3) not null,
  reason_code text,
  description text,
  actor_user_id uuid references auth.users (id),
  actor_service_key text,
  device_id uuid,
  origin text not null default 'CLOUD',
  origin_device_id uuid,
  origin_sequence bigint,
  correlation_id text,
  posted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint journal_entries_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint journal_entries_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint journal_entries_period_check check (
    period_classification in ('NORMAL', 'LATE_EVENT', 'PRIOR_PERIOD_ADJUSTMENT')
  ),
  constraint journal_entries_entry_type_check check (length(trim(entry_type)) > 0),
  constraint journal_entries_rule_key_check check (
    length(trim(posting_rule_key)) > 0
  ),
  constraint journal_entries_source_type_check check (
    source_type in (
      'ORDER', 'ORDER_ADJUSTMENT', 'TENDER', 'REFUND', 'VOID', 'SETTLEMENT_REF',
      'PAYMENT_RECONCILIATION', 'PAYMENT_RECONCILIATION_LINE',
      'PARTNER_RECONCILIATION', 'PARTNER_RECONCILIATION_LINE', 'EXPENSE',
      'CASH_DRAWER_EVENT', 'SHIFT_CLOSE'
    )
  ),
  constraint journal_entries_currency_check check (currency_code in ('KHR', 'USD')),
  constraint journal_entries_origin_check check (origin in ('CLOUD', 'HUB')),
  constraint journal_entries_hub_sequence_check check (
    origin <> 'HUB' or (origin_device_id is not null and origin_sequence is not null)
  )
);

create unique index if not exists journal_entries_tenant_id_id_key
  on kitluy_finance.journal_entries (tenant_id, id);

create unique index if not exists journal_entries_hub_origin_key
  on kitluy_finance.journal_entries (origin_device_id, origin_sequence)
  where origin = 'HUB';

create index if not exists journal_entries_scope_date_idx
  on kitluy_finance.journal_entries (tenant_id, digital_store_id, business_date);

create index if not exists journal_entries_source_idx
  on kitluy_finance.journal_entries (source_type, source_id);

comment on table kitluy_finance.journal_entries is
  'Owner: Finance Subledger. Balanced journal entry headers (Amendment-001 §5.3; "Amendment-001 additive; supersedes nothing"). Single currency per entry (AMD-I1/I6); source reference typed per the §6 registry; reversal/compensating entries link reverses_journal_entry_id — finalized journals are NEVER updated or deleted (AMD-I2, KBR-FIN-001; corrections are reversing entries). INSERT only via kitluy_finance.post_journal_entry_v1 (direct writes revoked in group 0095, including service_role). shift_id/pos_session_id/device_id are plain uuid until kitluy_pos/kitluy_devices land (AMD-I7 FKs attach with those groups). Hub-originated entries carry (origin_device_id, origin_sequence) uniqueness. Sensitivity: internal-financial. MC: A/O.';

comment on column kitluy_finance.journal_entries.source_type is
  'Typed source registry (Amendment-001 §6). SHIFT_CLOSE/CASH_DRAWER_EVENT/EXPENSE/PARTNER_* target relations are not yet authored — the vocabulary is reserved; only ORDER/ORDER_ADJUSTMENT/TENDER/REFUND/VOID/SETTLEMENT_REF/PAYMENT_RECONCILIATION[_LINE] can resolve this cycle.';

-- ---------------------------------------------------------------------------
-- kitluy_finance.journal_postings — Debit/credit legs (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.journal_postings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  journal_entry_id uuid not null references kitluy_finance.journal_entries (id),
  line_no integer not null,
  subledger_account_id uuid not null references kitluy_finance.subledger_accounts (id),
  direction text not null,
  amount_minor bigint not null,
  currency_code char(3) not null,
  memo text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint journal_postings_entry_line_key unique (journal_entry_id, line_no),
  constraint journal_postings_tenant_entry_fk
    foreign key (tenant_id, journal_entry_id)
    references kitluy_finance.journal_entries (tenant_id, id),
  constraint journal_postings_tenant_account_fk
    foreign key (tenant_id, subledger_account_id)
    references kitluy_finance.subledger_accounts (tenant_id, id),
  constraint journal_postings_direction_check check (direction in ('DEBIT', 'CREDIT')),
  constraint journal_postings_amount_check check (amount_minor > 0),
  constraint journal_postings_currency_check check (currency_code in ('KHR', 'USD'))
);

create index if not exists journal_postings_account_currency_idx
  on kitluy_finance.journal_postings (subledger_account_id, currency_code);

comment on table kitluy_finance.journal_postings is
  'Owner: Finance Subledger. Debit/credit journal legs (Amendment-001 §5.4; "Amendment-001 additive; supersedes nothing"). amount_minor > 0 — zero legs prohibited; bigint integer minor units (AMD-I5); currency must equal the parent entry (deferred AMD-I1 trigger); cross-Tenant account references impossible (composite same-tenant FKs). metadata is non-authoritative. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- AMD-I1 — balanced-journal enforcement at commit (deferred constraint
-- triggers; the posting RPC validates the same rules up front).
-- ---------------------------------------------------------------------------
create or replace function kitluy_finance.enforce_journal_balance()
returns trigger
language plpgsql
set search_path = kitluy_finance, pg_catalog
as $$
declare
  v_entry_id uuid;
  v_entry_currency char(3);
  v_leg_count integer;
  v_debit_total bigint;
  v_credit_total bigint;
  v_currency_count integer;
begin
  if tg_table_name = 'journal_entries' then
    v_entry_id := new.id;
  else
    v_entry_id := new.journal_entry_id;
  end if;

  select currency_code into v_entry_currency
  from kitluy_finance.journal_entries where id = v_entry_id;

  select
    count(*),
    coalesce(sum(amount_minor) filter (where direction = 'DEBIT'), 0),
    coalesce(sum(amount_minor) filter (where direction = 'CREDIT'), 0),
    count(distinct currency_code)
  into v_leg_count, v_debit_total, v_credit_total, v_currency_count
  from kitluy_finance.journal_postings
  where journal_entry_id = v_entry_id;

  if v_leg_count < 2 then
    raise exception
      'KLUY-FIN-UNBALANCED: journal entry % must carry at least two legs (found %) — AMD-I1/KBR-FIN-002',
      v_entry_id, v_leg_count
      using errcode = 'P0001';
  end if;
  if v_currency_count <> 1 then
    raise exception
      'KLUY-FIN-MIXED-CURRENCY: journal entry % mixes currencies — one currency per entry (AMD-I1/AMD-I6)',
      v_entry_id
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from kitluy_finance.journal_postings
    where journal_entry_id = v_entry_id and currency_code is distinct from v_entry_currency
  ) then
    raise exception
      'KLUY-FIN-CURRENCY-MISMATCH: journal entry % legs must match the entry currency %',
      v_entry_id, v_entry_currency
      using errcode = 'P0001';
  end if;
  if v_debit_total <> v_credit_total then
    raise exception
      'KLUY-FIN-UNBALANCED: journal entry % debits % <> credits % — AMD-I1/KBR-FIN-002',
      v_entry_id, v_debit_total, v_credit_total
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

comment on function kitluy_finance.enforce_journal_balance() is
  'AMD-I1 (KBR-FIN-002): at commit, every journal entry has >= 2 legs, one currency equal to the entry currency, and debit total = credit total. Deferred constraint trigger — a plain CHECK cannot express this.';

create constraint trigger trg_journal_entries_balance
  after insert on kitluy_finance.journal_entries
  deferrable initially deferred
  for each row execute function kitluy_finance.enforce_journal_balance();

create constraint trigger trg_journal_postings_balance
  after insert on kitluy_finance.journal_postings
  deferrable initially deferred
  for each row execute function kitluy_finance.enforce_journal_balance();

-- ---------------------------------------------------------------------------
-- kitluy_finance.source_postings — Source dedupe registry (MC: IMM except
-- last_observed_at)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.source_postings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  source_type text not null,
  source_id uuid not null,
  source_hash text,
  posting_rule_key text not null,
  posting_rule_version text,
  idempotency_key text not null,
  journal_entry_id uuid references kitluy_finance.journal_entries (id),
  status text not null default 'POSTED',
  error_code text,
  first_posted_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint source_postings_source_key
    unique (tenant_id, source_type, source_id, posting_rule_key),
  constraint source_postings_idempotency_key unique (tenant_id, idempotency_key),
  constraint source_postings_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint source_postings_tenant_entry_fk
    foreign key (tenant_id, journal_entry_id)
    references kitluy_finance.journal_entries (tenant_id, id),
  constraint source_postings_source_type_check check (
    source_type in (
      'ORDER', 'ORDER_ADJUSTMENT', 'TENDER', 'REFUND', 'VOID', 'SETTLEMENT_REF',
      'PAYMENT_RECONCILIATION', 'PAYMENT_RECONCILIATION_LINE',
      'PARTNER_RECONCILIATION', 'PARTNER_RECONCILIATION_LINE', 'EXPENSE',
      'CASH_DRAWER_EVENT', 'SHIFT_CLOSE'
    )
  ),
  constraint source_postings_rule_key_check check (
    length(trim(posting_rule_key)) > 0
  ),
  constraint source_postings_status_check check (
    status in ('POSTED', 'QUARANTINED', 'CONFLICT')
  )
);

create index if not exists source_postings_journal_entry_idx
  on kitluy_finance.source_postings (journal_entry_id);

comment on table kitluy_finance.source_postings is
  'Owner: Finance Subledger. Typed source-posting dedupe registry (Amendment-001 §5.5; "Amendment-001 additive; supersedes nothing"). AMD-I3: UNIQUE (tenant, source_type, source_id, posting_rule_key) + UNIQUE (tenant, idempotency_key) — a duplicate payment confirmation cannot double-post and a duplicate refund cannot double-reverse. Replays touch last_observed_at only (all other columns frozen — trigger). Sensitivity: internal-financial. MC: IMM except last_observed_at.';

create trigger trg_source_postings_frozen
  before update on kitluy_finance.source_postings
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'source_type', 'source_id',
    'source_hash', 'posting_rule_key', 'posting_rule_version',
    'idempotency_key', 'journal_entry_id', 'status', 'error_code',
    'first_posted_at', 'created_at'
  );

-- ---------------------------------------------------------------------------
-- kitluy_finance.idempotency_records — Command replay registry
-- ---------------------------------------------------------------------------
create table if not exists kitluy_finance.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  scope_key text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_ref text,
  status text not null default 'COMPLETED',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint idempotency_records_scope_key
    unique (tenant_id, scope_key, idempotency_key),
  constraint idempotency_records_scope_check check (length(trim(scope_key)) > 0),
  constraint idempotency_records_key_check check (
    length(trim(idempotency_key)) > 0
  ),
  constraint idempotency_records_hash_check check (length(trim(request_hash)) > 0),
  constraint idempotency_records_status_check check (
    status in ('IN_PROGRESS', 'COMPLETED', 'FAILED')
  )
);

comment on table kitluy_finance.idempotency_records is
  'Owner: Finance Subledger. Scoped command idempotency registry (Amendment-001 §5.6; mirrors the engine runIdempotent contract). Matching request_hash returns the stored response_ref; a differing hash under the same key is a stable conflict (engine IDEMPOTENCY_KEY_PAYLOAD_CONFLICT; naming vs IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST remains open — KLREC-2026-07-26-010, KL-DEC-001 group 5). Sensitivity: internal. MC: IMM identity; response/status write-once by the command layer.';

create trigger trg_idempotency_records_frozen
  before update on kitluy_finance.idempotency_records
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'scope_key', 'idempotency_key', 'request_hash',
    'created_at'
  );

-- ---------------------------------------------------------------------------
-- Posting RPC — the ONLY write path into journals (AMD-I2). Security definer;
-- validates scope, accounts, idempotency and balance before inserting.
-- ---------------------------------------------------------------------------
create or replace function kitluy_finance.post_journal_entry_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_business_date date,
  p_entry_type text,
  p_posting_rule_key text,
  p_posting_rule_version text,
  p_source_type text,
  p_source_id uuid,
  p_source_hash text,
  p_currency_code char(3),
  p_reason_code text,
  p_description text,
  p_actor_user_id uuid,
  p_actor_service_key text,
  p_idempotency_key text,
  p_postings jsonb,
  p_reverses_journal_entry_id uuid default null,
  p_correlation_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_finance, kitluy_core, pg_catalog
as $$
declare
  v_existing record;
  v_entry_id uuid;
  v_leg jsonb;
  v_leg_count integer := 0;
  v_debit_total bigint := 0;
  v_credit_total bigint := 0;
  v_account record;
  v_amount bigint;
begin
  if p_postings is null or jsonb_typeof(p_postings) <> 'array' then
    raise exception 'KLUY-FIN-POSTINGS-INVALID: p_postings must be a jsonb array'
      using errcode = 'P0001';
  end if;

  -- AMD-I3: source-level dedupe. A replay with the same source hash returns
  -- the prior result; a differing hash is a stable conflict.
  select * into v_existing
  from kitluy_finance.source_postings
  where tenant_id = p_tenant_id
    and source_type = p_source_type
    and source_id = p_source_id
    and posting_rule_key = p_posting_rule_key;
  if found then
    if v_existing.source_hash is not distinct from p_source_hash then
      update kitluy_finance.source_postings
        set last_observed_at = now()
        where id = v_existing.id;
      return jsonb_build_object(
        'replayed', true,
        'journal_entry_id', v_existing.journal_entry_id,
        'source_posting_id', v_existing.id
      );
    end if;
    raise exception
      'KLUY-FIN-SOURCE-CONFLICT: source (%, %, %) already posted with a different source_hash',
      p_source_type, p_source_id, p_posting_rule_key
      using errcode = 'P0001';
  end if;

  -- Validate every leg against tenant-scoped ACTIVE accounts and compute the
  -- balance before touching the journal (AMD-I1 up-front; the deferred
  -- constraint triggers re-verify at commit).
  for v_leg in select * from jsonb_array_elements(p_postings) loop
    v_leg_count := v_leg_count + 1;
    select * into v_account
    from kitluy_finance.subledger_accounts
    where id = (v_leg ->> 'subledger_account_id')::uuid;
    if not found or v_account.tenant_id <> p_tenant_id then
      raise exception
        'KLUY-FIN-ACCOUNT-SCOPE: leg % names an account outside tenant %',
        v_leg_count, p_tenant_id
        using errcode = 'P0001';
    end if;
    if v_account.status <> 'ACTIVE' then
      raise exception
        'KLUY-FIN-ACCOUNT-INACTIVE: account % is not ACTIVE', v_account.account_code
        using errcode = 'P0001';
    end if;
    if v_account.digital_store_id is not null
      and v_account.digital_store_id <> p_digital_store_id then
      raise exception
        'KLUY-FIN-ACCOUNT-STORE-SCOPE: account % belongs to another Digital Store',
        v_account.account_code
        using errcode = 'P0001';
    end if;
    v_amount := (v_leg ->> 'amount_minor')::bigint;
    if v_amount is null or v_amount <= 0 then
      raise exception
        'KLUY-FIN-LEG-AMOUNT: leg % amount must be a positive integer minor-unit amount',
        v_leg_count
        using errcode = 'P0001';
    end if;
    if (v_leg ->> 'direction') = 'DEBIT' then
      v_debit_total := v_debit_total + v_amount;
    elsif (v_leg ->> 'direction') = 'CREDIT' then
      v_credit_total := v_credit_total + v_amount;
    else
      raise exception
        'KLUY-FIN-LEG-DIRECTION: leg % direction must be DEBIT or CREDIT', v_leg_count
        using errcode = 'P0001';
    end if;
  end loop;

  if v_leg_count < 2 then
    raise exception
      'KLUY-FIN-UNBALANCED: a journal entry requires at least two legs (found %)',
      v_leg_count
      using errcode = 'P0001';
  end if;
  if v_debit_total <> v_credit_total then
    raise exception
      'KLUY-FIN-UNBALANCED: debit total % <> credit total % (AMD-I1/KBR-FIN-002)',
      v_debit_total, v_credit_total
      using errcode = 'P0001';
  end if;

  insert into kitluy_finance.journal_entries (
    tenant_id, digital_store_id, store_location_id, business_date, entry_type,
    posting_rule_key, posting_rule_version, source_type, source_id,
    reverses_journal_entry_id, currency_code, reason_code, description,
    actor_user_id, actor_service_key, origin, correlation_id
  ) values (
    p_tenant_id, p_digital_store_id, p_store_location_id, p_business_date,
    p_entry_type, p_posting_rule_key, p_posting_rule_version, p_source_type,
    p_source_id, p_reverses_journal_entry_id, p_currency_code, p_reason_code,
    p_description, p_actor_user_id, p_actor_service_key, 'CLOUD', p_correlation_id
  ) returning id into v_entry_id;

  insert into kitluy_finance.journal_postings (
    tenant_id, journal_entry_id, line_no, subledger_account_id, direction,
    amount_minor, currency_code, memo
  )
  select
    p_tenant_id,
    v_entry_id,
    coalesce((leg ->> 'line_no')::integer, ord::integer),
    (leg ->> 'subledger_account_id')::uuid,
    leg ->> 'direction',
    (leg ->> 'amount_minor')::bigint,
    p_currency_code,
    leg ->> 'memo'
  from jsonb_array_elements(p_postings) with ordinality as t (leg, ord);

  insert into kitluy_finance.source_postings (
    tenant_id, digital_store_id, source_type, source_id, source_hash,
    posting_rule_key, posting_rule_version, idempotency_key, journal_entry_id,
    status
  ) values (
    p_tenant_id, p_digital_store_id, p_source_type, p_source_id, p_source_hash,
    p_posting_rule_key, p_posting_rule_version, p_idempotency_key, v_entry_id,
    'POSTED'
  );

  return jsonb_build_object(
    'replayed', false,
    'journal_entry_id', v_entry_id
  );
end;
$$;

comment on function kitluy_finance.post_journal_entry_v1(
  uuid, uuid, uuid, date, text, text, text, text, uuid, text, char, text, text,
  uuid, text, text, jsonb, uuid, text
) is
  'The ONLY write path into kitluy_finance journals (AMD-I2). Validates tenant/store account scope, positive integer legs, single-currency balance (AMD-I1) and source dedupe (AMD-I3: same source+rule replays return the prior entry; differing hash is a stable conflict). Security definer with locked search_path; execute granted to service_role only (group 0095). Posting-rule vocabulary remains governed (FIN-OD-002) — this function proves the mechanism, not a rule catalog.';

commit;
