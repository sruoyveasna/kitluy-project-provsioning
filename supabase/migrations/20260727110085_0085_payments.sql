-- kitluy:group:0085
-- Migration group 0085: payments (WS-08-T002/T003, Cycle-6 KLD-2026-07-26-003 §6/§7).
--   kitluy_payments: tenders, payment_attempts, khqr_transactions,
--   payment_provider_events, payment_status_history, refunds, voids,
--   settlement_refs, payment_reconciliations, payment_reconciliation_lines
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
--   (section kitluy_payments). payment_status_history is a Cycle-6 addition
--   not enumerated in DD v1.0.0 — recorded as reconciliation C12 (DD amendment
--   REQUIRED). shift_id/pos_session_id stay PLAIN uuid columns (kitluy_pos is
--   not yet authored — FK attaches with its group; audit_logs.device_id
--   precedent).
-- Business rules: docs/source/business-rules/kitluy-payment-refund-and-void-rules-v1.0.0.md
--   KBR-PAY-001..009; engine @kitluy/payments (BookingPaymentLedger, 26
--   canonical vectors + 14 invariant tests) remains the canonical decision
--   path — triggers below are corruption guards only (Cycle-6 §6).
-- Vocabularies: enum registry payment_method, payment_status, refund_status
--   (approved); KhqrAttemptState + ReconciliationState are the tested engine
--   vocabularies (PAY-VEC-007..012, 021..024).
-- KLD-PAY-001: no offline card capture — CARD stays vocabulary-only, no card
--   capture path is implemented. No provider credentials anywhere; KHQR is
--   exercised through the approved local simulator/test adapter only
--   (PAY-OD-001 / BLK-006 open).
-- Currency controls (Cycle-6 §13): bigint minor units, char(3) currency, no
--   floats, no implicit conversion; cross-currency tender against a Booking is
--   rejected (PAY-VEC-004; PRC-OD-005 open — no FX policy invented).
-- Open owner values referenced and NOT guessed: PAY-OD-001 (KHQR provider),
--   PAY-OD-002 (refund/void approval thresholds — approval is ALWAYS required
--   in dev, strictest reading), PAY-OD-003 (over/underpayment + change
--   policy), PAY-OD-004, PRC-OD-004/005, FIN-OD-005 (deposit accounting).
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED). RLS/grants/append-only triggers land in
-- 20260727110095_0095_ws07_ws08_rls.sql (same release train).

begin;

create schema if not exists kitluy_payments;

comment on schema kitluy_payments is
  'Owner: Payments. Tender ledger, provider attempts/callbacks, KHQR references, refunds/voids (compensating, four-eyes), settlement references and payment reconciliation. Append-only financial evidence; no secret or card data beyond approved tokenized references. Ref: kitluy-suite-supabase-data-dictionary-v1.0.0.md';

-- Set-once guard: TG_ARGV columns may move from NULL to a value exactly once
-- and are frozen afterwards (capture/approval evidence fields).
create or replace function kitluy_auth.enforce_set_once()
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
    if (v_old -> v_col) is not null and jsonb_typeof(v_old -> v_col) <> 'null'
      and v_old -> v_col is distinct from v_new -> v_col then
      raise exception
        'KLUY-GUARD-SET-ONCE: column % of %.% is write-once evidence and cannot be rewritten',
        v_col, tg_table_schema, tg_table_name
        using errcode = 'P0001',
          hint = 'Append a compensating record instead of rewriting evidence.';
    end if;
  end loop;
  return new;
end;
$$;

comment on function kitluy_auth.enforce_set_once() is
  'Generic guard: TG_ARGV columns are write-once (NULL -> value) evidence fields; rewriting recorded evidence is rejected (KLD-FIN-001 append-only discipline).';

-- ---------------------------------------------------------------------------
-- kitluy_payments.tenders — Tender ledger (payment intent -> confirmation)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.tenders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid references kitluy_core.store_locations (id),
  order_id uuid not null references kitluy_orders.orders (id),
  shift_id uuid,
  method_code text not null,
  amount_minor bigint not null,
  applied_minor bigint,
  change_due_minor bigint,
  currency_code char(3) not null,
  status text not null default 'PENDING',
  provider_key text,
  idempotency_key text not null,
  captured_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenders_tenant_idempotency_key unique (tenant_id, idempotency_key),
  constraint tenders_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint tenders_store_order_fk
    foreign key (digital_store_id, order_id)
    references kitluy_orders.orders (digital_store_id, id),
  constraint tenders_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint tenders_store_location_fk
    foreign key (digital_store_id, store_location_id)
    references kitluy_core.store_locations (digital_store_id, id),
  constraint tenders_method_check check (
    method_code in ('CASH', 'KHQR', 'CARD', 'CUSTOMER_TAB', 'STORE_CREDIT', 'OTHER_APPROVED')
  ),
  constraint tenders_amount_check check (amount_minor > 0),
  constraint tenders_applied_check check (
    applied_minor is null or (applied_minor >= 0 and applied_minor <= amount_minor)
  ),
  constraint tenders_change_check check (
    change_due_minor is null or change_due_minor >= 0
  ),
  constraint tenders_currency_check check (currency_code in ('KHR', 'USD')),
  constraint tenders_status_check check (
    status in (
      'PENDING', 'AUTHORIZED', 'PENDING_VERIFICATION', 'CAPTURED', 'FAILED',
      'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED'
    )
  ),
  constraint tenders_captured_at_check check (
    status not in ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    or captured_at is not null
  )
);

create unique index if not exists tenders_tenant_id_id_key
  on kitluy_payments.tenders (tenant_id, id);

create index if not exists tenders_order_id_idx on kitluy_payments.tenders (order_id);

create index if not exists tenders_digital_store_id_idx
  on kitluy_payments.tenders (digital_store_id);

comment on table kitluy_payments.tenders is
  'Owner: Payments. Tender ledger (DD kitluy_payments.tenders): one row per payment intent through confirmation. Vocabularies: enum registry payment_method/payment_status. Money contract: bigint integer minor units + char(3) currency; tender currency must equal the Booking currency (trigger — no implicit conversion, PRC-OD-005 open, PAY-VEC-004). applied_minor <= amount_minor (cash change is returned, engine CashTenderResult); change/capture evidence is write-once. Tenant-scoped idempotency key: a replayed capture command returns the prior business result (engine runIdempotent; PAY-VEC-014/015). shift_id is a plain uuid until kitluy_pos lands. Status transitions are trigger-whitelisted per the KBR-PAY §4 lifecycle; identity/money columns frozen. Sensitivity: internal-financial. MC: MUT status projection over append-only evidence (payment_status_history).';

comment on column kitluy_payments.tenders.amount_minor is
  'Tendered amount in integer minor units (bigint; KHR exponent 0, USD exponent 2). Never a float (money contract §4).';

-- Tender guards: currency equality with the Booking at insert.
create or replace function kitluy_payments.enforce_tender_currency()
returns trigger
language plpgsql
set search_path = kitluy_payments, kitluy_orders, pg_catalog
as $$
declare
  v_order_currency char(3);
begin
  select currency_code into v_order_currency
  from kitluy_orders.orders where id = new.order_id;
  if v_order_currency is distinct from new.currency_code then
    raise exception
      'KLUY-PAY-CURRENCY-MISMATCH: tender currency % must equal Booking currency % — cross-currency allocation without an approved FX policy is rejected (PAY-VEC-004; PRC-OD-005 open)',
      new.currency_code, v_order_currency
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_payments.enforce_tender_currency() is
  'Money contract guard: tender currency must equal the Booking currency; no silent currency conversion (KBR-PAY-004 error rule; PAY-VEC-004).';

create trigger trg_tenders_currency
  before insert on kitluy_payments.tenders
  for each row execute function kitluy_payments.enforce_tender_currency();

create trigger trg_tenders_frozen
  before update on kitluy_payments.tenders
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'store_location_id', 'order_id',
    'method_code', 'amount_minor', 'currency_code', 'idempotency_key',
    'created_by', 'created_at'
  );

create trigger trg_tenders_set_once
  before update on kitluy_payments.tenders
  for each row execute function kitluy_auth.enforce_set_once(
    'applied_minor', 'change_due_minor', 'captured_at', 'provider_key'
  );

-- KBR-PAY §4 lifecycle (payment_status registry): forward-only; FAILED,
-- VOIDED and REFUNDED are terminal; refund states only from CAPTURED.
create trigger trg_tenders_status
  before update on kitluy_payments.tenders
  for each row execute function kitluy_auth.enforce_status_transition(
    'status',
    'PENDING:AUTHORIZED|PENDING_VERIFICATION|CAPTURED|FAILED|VOIDED;AUTHORIZED:PENDING_VERIFICATION|CAPTURED|FAILED|VOIDED;PENDING_VERIFICATION:CAPTURED|FAILED|VOIDED;CAPTURED:PARTIALLY_REFUNDED|REFUNDED;PARTIALLY_REFUNDED:REFUNDED'
  );

-- ---------------------------------------------------------------------------
-- kitluy_payments.payment_attempts — Provider/capture attempts
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  tender_id uuid not null references kitluy_payments.tenders (id),
  provider_key text not null,
  provider_attempt_ref text,
  request_hash text,
  status text not null default 'PENDING',
  error_code text,
  client_result text,
  attempted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_attempts_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint payment_attempts_provider_key_check check (
    length(trim(provider_key)) > 0
  ),
  constraint payment_attempts_status_check check (
    status in ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'VOIDED')
  )
);

create unique index if not exists payment_attempts_provider_ref_key
  on kitluy_payments.payment_attempts (provider_key, provider_attempt_ref)
  where provider_attempt_ref is not null;

create index if not exists payment_attempts_tender_id_idx
  on kitluy_payments.payment_attempts (tender_id);

comment on table kitluy_payments.payment_attempts is
  'Owner: Payments. Provider/capture attempts (DD kitluy_payments.payment_attempts). Status vocabulary is the tested engine KhqrAttemptState (PENDING/SUCCEEDED/FAILED/EXPIRED/VOIDED — PAY-VEC-007/012/019). Provider refs unique in provider scope. client_result (e.g. TIMEOUT) is non-authoritative display evidence — a client confirmation NEVER creates a payment (KBR-PAY-003; PAY-VEC-011). Sensitivity: internal-financial. MC: MUT until terminal, then frozen (trigger).';

create trigger trg_payment_attempts_frozen
  before update on kitluy_payments.payment_attempts
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'tender_id', 'provider_key', 'request_hash', 'attempted_at'
  );

create trigger trg_payment_attempts_status
  before update on kitluy_payments.payment_attempts
  for each row execute function kitluy_auth.enforce_status_transition(
    'status', 'PENDING:SUCCEEDED|FAILED|EXPIRED|VOIDED'
  );

-- ---------------------------------------------------------------------------
-- kitluy_payments.khqr_transactions — KHQR intent/confirmation reference
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.khqr_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  tender_id uuid not null references kitluy_payments.tenders (id),
  merchant_ref text not null,
  qr_payload_hash text not null,
  amount_minor bigint not null,
  currency_code char(3) not null,
  status text not null default 'PENDING',
  provider_transaction_id text,
  expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint khqr_transactions_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint khqr_transactions_merchant_ref_check check (
    length(trim(merchant_ref)) > 0
  ),
  constraint khqr_transactions_payload_hash_check check (
    length(trim(qr_payload_hash)) > 0
  ),
  constraint khqr_transactions_amount_check check (amount_minor > 0),
  constraint khqr_transactions_currency_check check (currency_code in ('KHR', 'USD')),
  constraint khqr_transactions_status_check check (
    status in ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'VOIDED')
  ),
  constraint khqr_transactions_confirmed_check check (
    status <> 'SUCCEEDED' or confirmed_at is not null
  )
);

create unique index if not exists khqr_transactions_provider_txn_key
  on kitluy_payments.khqr_transactions (provider_transaction_id)
  where provider_transaction_id is not null;

create index if not exists khqr_transactions_tender_id_idx
  on kitluy_payments.khqr_transactions (tender_id);

comment on table kitluy_payments.khqr_transactions is
  'Owner: Payments. KHQR intent/confirmation references (DD kitluy_payments.khqr_transactions). Hash of the QR payload only — never raw provider payloads or credentials (PAY-OD-001/BLK-006 open; local simulator/test adapter only this cycle). Provider-reported amount and currency are preserved exactly (Cycle-6 §13). provider_transaction_id unique — a repeated provider callback cannot double-confirm (engine dedupe; PAY-VEC-009). Sensitivity: internal-financial. MC: MUT until terminal, then frozen.';

create trigger trg_khqr_transactions_frozen
  before update on kitluy_payments.khqr_transactions
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'tender_id', 'merchant_ref', 'qr_payload_hash',
    'amount_minor', 'currency_code', 'created_at'
  );

create trigger trg_khqr_transactions_set_once
  before update on kitluy_payments.khqr_transactions
  for each row execute function kitluy_auth.enforce_set_once(
    'provider_transaction_id', 'confirmed_at'
  );

create trigger trg_khqr_transactions_status
  before update on kitluy_payments.khqr_transactions
  for each row execute function kitluy_auth.enforce_status_transition(
    'status', 'PENDING:SUCCEEDED|FAILED|EXPIRED|VOIDED'
  );

-- ---------------------------------------------------------------------------
-- kitluy_payments.payment_provider_events — Signed callback inbox (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references kitluy_core.tenants (id),
  tender_id uuid references kitluy_payments.tenders (id),
  provider_key text not null,
  provider_event_id text not null,
  provider_transaction_id text,
  signature_valid boolean not null,
  payload_hash text not null,
  reported_amount_minor bigint,
  reported_currency_code char(3),
  status text not null,
  variance_minor bigint,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint payment_provider_events_provider_event_key
    unique (provider_key, provider_event_id),
  constraint payment_provider_events_provider_key_check check (
    length(trim(provider_key)) > 0
  ),
  constraint payment_provider_events_event_id_check check (
    length(trim(provider_event_id)) > 0
  ),
  constraint payment_provider_events_payload_hash_check check (
    length(trim(payload_hash)) > 0
  ),
  constraint payment_provider_events_amount_check check (
    reported_amount_minor is null or reported_amount_minor >= 0
  ),
  constraint payment_provider_events_currency_check check (
    reported_currency_code is null or reported_currency_code in ('KHR', 'USD')
  ),
  constraint payment_provider_events_status_check check (
    status in (
      'APPLIED', 'DUPLICATE_IGNORED', 'QUARANTINED', 'RECONCILIATION_EXCEPTION',
      'ATTEMPT_CLOSED', 'CLIENT_CONFIRM_OBSERVED'
    )
  ),
  -- KBR-PAY-003: an unverified provider event is quarantined with zero
  -- business effect.
  constraint payment_provider_events_quarantine_check check (
    signature_valid or status in ('QUARANTINED', 'CLIENT_CONFIRM_OBSERVED')
  )
);

create index if not exists payment_provider_events_tender_id_idx
  on kitluy_payments.payment_provider_events (tender_id);

comment on table kitluy_payments.payment_provider_events is
  'Owner: Payments. Signed provider callback inbox (DD kitluy_payments.payment_provider_events; AMD-I4 provider-event uniqueness anchor UNIQUE (provider_key, provider_event_id)). Rows are inserted with their final classification in the same command transaction (engine applyKhqrCallback result states + CLIENT_CONFIRM_OBSERVED for non-authoritative client confirmations). Payload hash only — raw payloads/signatures never stored. Provider-reported amount/currency preserved exactly. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_payments.payment_status_history — Append-only status evidence (A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.payment_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  tender_id uuid not null references kitluy_payments.tenders (id),
  from_status text,
  to_status text not null,
  reason_code text,
  actor_user_id uuid references auth.users (id),
  actor_service_key text,
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  constraint payment_status_history_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint payment_status_history_from_check check (
    from_status is null or from_status in (
      'PENDING', 'AUTHORIZED', 'PENDING_VERIFICATION', 'CAPTURED', 'FAILED',
      'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED'
    )
  ),
  constraint payment_status_history_to_check check (
    to_status in (
      'PENDING', 'AUTHORIZED', 'PENDING_VERIFICATION', 'CAPTURED', 'FAILED',
      'VOIDED', 'PARTIALLY_REFUNDED', 'REFUNDED'
    )
  )
);

create index if not exists payment_status_history_tender_id_idx
  on kitluy_payments.payment_status_history (tender_id);

comment on table kitluy_payments.payment_status_history is
  'Owner: Payments. Append-only tender status history (Cycle-6 §11 "payment status history is append-only"; not enumerated in DD v1.0.0 — reconciliation C12, DD amendment REQUIRED). Every accepted tender status change appends one row through the command path. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_payments.refunds — Compensating refund ledger
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  order_id uuid not null references kitluy_orders.orders (id),
  tender_id uuid not null references kitluy_payments.tenders (id),
  amount_minor bigint not null,
  currency_code char(3) not null,
  reason_code text not null,
  status text not null default 'REQUESTED',
  requested_by uuid not null references auth.users (id),
  requested_at timestamptz not null default now(),
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  completed_at timestamptz,
  idempotency_key text not null,
  updated_at timestamptz not null default now(),
  constraint refunds_tenant_idempotency_key unique (tenant_id, idempotency_key),
  constraint refunds_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint refunds_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint refunds_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint refunds_amount_check check (amount_minor > 0),
  constraint refunds_currency_check check (currency_code in ('KHR', 'USD')),
  constraint refunds_reason_check check (length(trim(reason_code)) > 0),
  constraint refunds_status_check check (
    status in (
      'REQUESTED', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING', 'COMPLETED',
      'FAILED', 'REJECTED'
    )
  ),
  -- Four-eyes (RB v4 §8.8 / KLSEC-026): the requester can never approve.
  constraint refunds_four_eyes_check check (
    approved_by is null or approved_by <> requested_by
  ),
  constraint refunds_approval_pair_check check (
    (approved_at is null) = (approved_by is null)
  ),
  constraint refunds_approved_evidence_check check (
    status not in ('APPROVED', 'PROCESSING', 'COMPLETED') or approved_by is not null
  ),
  constraint refunds_completed_evidence_check check (
    status <> 'COMPLETED' or completed_at is not null
  )
);

create index if not exists refunds_order_id_idx on kitluy_payments.refunds (order_id);

create index if not exists refunds_tender_id_idx on kitluy_payments.refunds (tender_id);

comment on table kitluy_payments.refunds is
  'Owner: Payments. Compensating refund ledger (DD kitluy_payments.refunds; KBR-PAY-005). A refund NEVER updates or deletes the original confirmed payment — the tender row is preserved and the refund is its own record (engine applyRefund compensating postings; PAY-VEC-016..018). Vocabulary: enum registry refund_status. Four-eyes: approved_by <> requested_by (CHECK) + approval_request_id linkage into kitluy_auth (trg_approval_decisions_four_eyes); thresholds are open owner value PAY-OD-002 — approval is ALWAYS required in dev (strictest reading). Refundable ceiling (refund cannot exceed refundable confirmed payment) is enforced by the canonical engine inside the idempotent command body (WS-08-T001 review RV-001 fix) and probed by integration tests; Tenant-scoped idempotency key makes duplicate refund commands replay without a second financial effect. Sensitivity: internal-financial. MC: MUT status projection; identity/money frozen; approval/completion evidence write-once.';

create trigger trg_refunds_frozen
  before update on kitluy_payments.refunds
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'order_id', 'tender_id',
    'amount_minor', 'currency_code', 'reason_code', 'requested_by',
    'requested_at', 'idempotency_key'
  );

create trigger trg_refunds_set_once
  before update on kitluy_payments.refunds
  for each row execute function kitluy_auth.enforce_set_once(
    'approval_request_id', 'approved_by', 'approved_at', 'completed_at'
  );

create trigger trg_refunds_status
  before update on kitluy_payments.refunds
  for each row execute function kitluy_auth.enforce_status_transition(
    'status',
    'REQUESTED:PENDING_APPROVAL|APPROVED|REJECTED;PENDING_APPROVAL:APPROVED|REJECTED;APPROVED:PROCESSING|COMPLETED|FAILED;PROCESSING:COMPLETED|FAILED'
  );

-- ---------------------------------------------------------------------------
-- kitluy_payments.voids — Void decisions/evidence (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.voids (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  order_id uuid references kitluy_orders.orders (id),
  tender_id uuid references kitluy_payments.tenders (id),
  void_type text not null,
  decision text not null,
  required_action text,
  amount_minor bigint,
  currency_code char(3),
  reason_code text not null,
  requested_by uuid not null references auth.users (id),
  approval_request_id uuid references kitluy_auth.approval_requests (id),
  occurred_at timestamptz not null default now(),
  constraint voids_tenant_order_fk
    foreign key (tenant_id, order_id)
    references kitluy_orders.orders (tenant_id, id),
  constraint voids_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint voids_target_check check (order_id is not null or tender_id is not null),
  constraint voids_type_check check (
    void_type in ('ATTEMPT_VOID', 'FINALIZED_VOID_REQUEST')
  ),
  constraint voids_decision_check check (
    decision in ('EXECUTED', 'REFUSED_COMPENSATING_REQUIRED')
  ),
  -- KBR-PAY-006 / PAY-VEC-020: a finalized payment is never destructively
  -- voided — the recorded decision is always the compensating requirement.
  constraint voids_finalized_refusal_check check (
    void_type <> 'FINALIZED_VOID_REQUEST'
    or decision = 'REFUSED_COMPENSATING_REQUIRED'
  ),
  constraint voids_amount_check check (amount_minor is null or amount_minor > 0),
  constraint voids_currency_check check (
    currency_code is null or currency_code in ('KHR', 'USD')
  ),
  constraint voids_reason_check check (length(trim(reason_code)) > 0)
);

create index if not exists voids_tender_id_idx on kitluy_payments.voids (tender_id);

comment on table kitluy_payments.voids is
  'Owner: Payments. Void request/decision evidence (DD kitluy_payments.voids; KBR-PAY-006). ATTEMPT_VOID may execute against a PENDING attempt (engine voidAttempt; PAY-VEC-019); FINALIZED_VOID_REQUEST is ALWAYS refused with the compensating-refund requirement (engine requestVoidOfFinalizedPayment allowed:false literal; PAY-VEC-020 — CHECK-enforced). Mandatory reason; approval linkage for governed voids. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_payments.settlement_refs — Provider settlement linkage (MC: A/O)
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.settlement_refs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  tender_id uuid not null references kitluy_payments.tenders (id),
  provider_key text not null,
  settlement_id text not null,
  settled_amount_minor bigint not null,
  fee_minor bigint,
  net_minor bigint,
  currency_code char(3) not null,
  settled_at timestamptz,
  reconciliation_status text not null,
  created_at timestamptz not null default now(),
  constraint settlement_refs_provider_settlement_key
    unique (provider_key, settlement_id, tender_id),
  constraint settlement_refs_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint settlement_refs_provider_key_check check (
    length(trim(provider_key)) > 0
  ),
  constraint settlement_refs_settlement_id_check check (
    length(trim(settlement_id)) > 0
  ),
  constraint settlement_refs_amount_check check (settled_amount_minor >= 0),
  constraint settlement_refs_fee_check check (fee_minor is null or fee_minor >= 0),
  constraint settlement_refs_net_check check (net_minor is null or net_minor >= 0),
  -- KBR-PAY-009 / engine SETTLEMENT_LINE_INCONSISTENT: gross = fee + net.
  constraint settlement_refs_composition_check check (
    fee_minor is null or net_minor is null
    or settled_amount_minor = fee_minor + net_minor
  ),
  constraint settlement_refs_currency_check check (currency_code in ('KHR', 'USD')),
  constraint settlement_refs_status_check check (
    reconciliation_status in (
      'MATCHED', 'MATCHED_WITH_FEE', 'SETTLEMENT_AMOUNT_MISMATCH',
      'UNMATCHED_PROVIDER_ITEM', 'MISSING_SETTLEMENT'
    )
  )
);

create index if not exists settlement_refs_tender_id_idx
  on kitluy_payments.settlement_refs (tender_id);

comment on table kitluy_payments.settlement_refs is
  'Owner: Payments. Provider settlement references (DD kitluy_payments.settlement_refs). Payment confirmed, allocated, posted, settled and reconciled remain SEPARATE facts (Cycle-6 §16; KBR-PAY-009: never infer settlement from customer payment success). Status vocabulary is the tested engine ReconciliationState (PAY-VEC-021..024). gross = fee + net composition CHECK. Settlement SLA default (24h) carries a [REQUIRED] owner marker — no auto-close is encoded. Sensitivity: internal-financial. MC: A/O.';

-- ---------------------------------------------------------------------------
-- kitluy_payments.payment_reconciliations — Reconciliation run header
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid references kitluy_core.digital_stores (id),
  scope text not null,
  period_start date not null,
  period_end date not null,
  provider_key text not null,
  currency_code char(3) not null,
  status text not null default 'NOT_STARTED',
  reopen_reason_code text,
  source_as_of timestamptz,
  completed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_reconciliations_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint payment_reconciliations_scope_check check (length(trim(scope)) > 0),
  constraint payment_reconciliations_period_check check (period_end >= period_start),
  constraint payment_reconciliations_provider_check check (
    length(trim(provider_key)) > 0
  ),
  constraint payment_reconciliations_currency_check check (
    currency_code in ('KHR', 'USD')
  ),
  constraint payment_reconciliations_status_check check (
    status in (
      'NOT_STARTED', 'PREPARING', 'EXCEPTIONS_FOUND', 'READY_FOR_REVIEW',
      'COMPLETED', 'REOPENED'
    )
  ),
  -- KBR-FIN-005: reopen only with an explicit reason.
  constraint payment_reconciliations_reopen_reason_check check (
    status <> 'REOPENED'
    or (reopen_reason_code is not null and length(trim(reopen_reason_code)) > 0)
  ),
  constraint payment_reconciliations_completed_check check (
    status <> 'COMPLETED' or completed_at is not null
  )
);

create unique index if not exists payment_reconciliations_tenant_id_id_key
  on kitluy_payments.payment_reconciliations (tenant_id, id);

create index if not exists payment_reconciliations_tenant_idx
  on kitluy_payments.payment_reconciliations (tenant_id);

comment on table kitluy_payments.payment_reconciliations is
  'Owner: Payments. Payment reconciliation run header (DD kitluy_payments.payment_reconciliations). Lifecycle per KBR-FIN-005: NOT_STARTED -> PREPARING -> EXCEPTIONS_FOUND or READY_FOR_REVIEW -> COMPLETED; reopen only with reason (trigger whitelist). Reconciliation truth is never inferred from provider confirmation (KBR-PAY-009); dev evidence is truth-labeled as internal-simulator execution only. Sensitivity: internal-financial. MC: MUT with whitelisted lifecycle.';

create trigger trg_payment_reconciliations_frozen
  before update on kitluy_payments.payment_reconciliations
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'digital_store_id', 'scope', 'period_start', 'period_end',
    'provider_key', 'currency_code', 'created_at'
  );

create trigger trg_payment_reconciliations_status
  before update on kitluy_payments.payment_reconciliations
  for each row execute function kitluy_auth.enforce_status_transition(
    'status',
    'NOT_STARTED:PREPARING;PREPARING:EXCEPTIONS_FOUND|READY_FOR_REVIEW;EXCEPTIONS_FOUND:READY_FOR_REVIEW;READY_FOR_REVIEW:COMPLETED;COMPLETED:REOPENED;REOPENED:PREPARING'
  );

-- ---------------------------------------------------------------------------
-- kitluy_payments.payment_reconciliation_lines — Differences under review
-- ---------------------------------------------------------------------------
create table if not exists kitluy_payments.payment_reconciliation_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  reconciliation_id uuid not null references kitluy_payments.payment_reconciliations (id),
  tender_id uuid references kitluy_payments.tenders (id),
  provider_transaction_ref text,
  expected_minor bigint not null,
  actual_minor bigint,
  difference_minor bigint,
  currency_code char(3) not null,
  status text not null,
  difference_reason_code text,
  review_status text,
  review_actor uuid references auth.users (id),
  resolved_at timestamptz,
  resolution_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_reconciliation_lines_tenant_recon_fk
    foreign key (tenant_id, reconciliation_id)
    references kitluy_payments.payment_reconciliations (tenant_id, id),
  constraint payment_reconciliation_lines_tenant_tender_fk
    foreign key (tenant_id, tender_id)
    references kitluy_payments.tenders (tenant_id, id),
  constraint payment_reconciliation_lines_expected_check check (expected_minor >= 0),
  constraint payment_reconciliation_lines_actual_check check (
    actual_minor is null or actual_minor >= 0
  ),
  constraint payment_reconciliation_lines_currency_check check (
    currency_code in ('KHR', 'USD')
  ),
  constraint payment_reconciliation_lines_status_check check (
    status in (
      'MATCHED', 'MATCHED_WITH_FEE', 'SETTLEMENT_AMOUNT_MISMATCH',
      'UNMATCHED_PROVIDER_ITEM', 'MISSING_SETTLEMENT'
    )
  ),
  constraint payment_reconciliation_lines_review_status_check check (
    review_status is null or review_status in ('PENDING_REVIEW', 'RESOLVED', 'ESCALATED')
  ),
  constraint payment_reconciliation_lines_resolution_check check (
    review_status is distinct from 'RESOLVED'
    or (review_actor is not null and resolved_at is not null)
  )
);

create index if not exists payment_reconciliation_lines_recon_idx
  on kitluy_payments.payment_reconciliation_lines (reconciliation_id);

comment on table kitluy_payments.payment_reconciliation_lines is
  'Owner: Payments. Reconciliation difference lines (DD kitluy_payments.payment_reconciliation_lines; Cycle-6 §16: expected/actual/difference amounts, difference reason, review actor, resolution reference). Amount identity is frozen; only the review fields mutate (trigger). Status vocabulary: tested engine ReconciliationState. Sensitivity: internal-financial. MC: MUT review fields over frozen amounts.';

create trigger trg_payment_reconciliation_lines_frozen
  before update on kitluy_payments.payment_reconciliation_lines
  for each row execute function kitluy_auth.enforce_frozen_columns(
    'id', 'tenant_id', 'reconciliation_id', 'tender_id',
    'provider_transaction_ref', 'expected_minor', 'actual_minor',
    'difference_minor', 'currency_code', 'status', 'created_at'
  );

commit;
