-- kitluy:group:0095
-- Migration group 0095: ws07_ws08_rls (WS-07-T004 / WS-08-T005, Cycle-6
-- KLD-2026-07-26-003 §6/§7). Same release train as groups 0075-0090: every
-- relation created there is RLS ENABLE+FORCE, fail-closed, SELECT-only for
-- clients, append-only where finalized, BEFORE any non-fixture data.
-- Authorization contract: docs/data/kitluy-suite-supabase-rls-and-authorization-v1.0.0.md
--   (policy classes PC-TENANT/PC-STORE/PC-LOCATION/PC-AO); canonical helpers
--   kitluy_auth.current_*_ids()/has_permission() from group 0035 — no parallel
--   identity logic (Cycle-6 §18).
-- Permission keys: docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv
--   laundry.bookings.read (A0_READ), payments.read (A0_READ). The registry has
--   NO neutral transaction-read key and NO finance-read key — kitluy_orders
--   uses store-scope-only SELECT and kitluy_finance uses tenant-scope-only
--   SELECT as the interim strictest reading (C4 precedent; registry amendment
--   proposed, recorded in the Cycle-6 reconciliation).
-- Write model: ZERO anon policies; ZERO client write policies (INSERT/UPDATE/
--   DELETE/ALL). Mutations run through service-role command services behind
--   the canonical engines; kitluy_finance journals accept INSERT only via the
--   security-definer RPC (AMD-I2) — direct journal writes are revoked even
--   for service_role. Frontend visibility is not authorization (RC-012).
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED).

begin;

-- ---------------------------------------------------------------------------
-- 1. Append-only triggers (kitluy_auth.enforce_append_only) — finalized
--    financial/custody/audit history is physically immutable (KLD-FIN-001;
--    RB v4 §5.6; AMD-I2).
-- ---------------------------------------------------------------------------
create trigger trg_append_only_order_lines
  before update or delete on kitluy_orders.order_lines
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_order_adjustments
  before update or delete on kitluy_orders.order_adjustments
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_order_events
  before update or delete on kitluy_orders.order_events
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_order_notes
  before update or delete on kitluy_orders.order_notes
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_booking_status_history
  before update or delete on kitluy_laundry.booking_status_history
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_garment_scan_events
  before update or delete on kitluy_laundry.garment_scan_events
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_payment_provider_events
  before update or delete on kitluy_payments.payment_provider_events
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_payment_status_history
  before update or delete on kitluy_payments.payment_status_history
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_voids
  before update or delete on kitluy_payments.voids
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_settlement_refs
  before update or delete on kitluy_payments.settlement_refs
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_journal_entries
  before update or delete on kitluy_finance.journal_entries
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_journal_postings
  before update or delete on kitluy_finance.journal_postings
  for each row execute function kitluy_auth.enforce_append_only();

-- Delete protection for guarded-mutation tables (updates are trigger-guarded
-- in their own groups; physical deletes are always rejected).
create or replace function kitluy_auth.enforce_no_delete()
returns trigger
language plpgsql
set search_path = kitluy_auth, pg_catalog
as $$
begin
  raise exception
    'KLUY-AUTH-NO-DELETE: DELETE rejected on %.% — records are corrected by compensating records, never removed',
    tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

comment on function kitluy_auth.enforce_no_delete() is
  'Generic guard: physical DELETE is rejected on aggregate/evidence tables whose updates are separately guarded (KLD-FIN-001 compensating-record discipline).';

create trigger trg_no_delete_orders
  before delete on kitluy_orders.orders
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_booking_production_state
  before delete on kitluy_laundry.booking_production_state
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_garments
  before delete on kitluy_laundry.garments
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_laundry_tags
  before delete on kitluy_laundry.laundry_tags
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_garment_exceptions
  before delete on kitluy_laundry.garment_exceptions
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_ready_storage_assignments
  before delete on kitluy_laundry.ready_storage_assignments
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_pickup_handoffs
  before delete on kitluy_laundry.pickup_handoffs
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_tenders
  before delete on kitluy_payments.tenders
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_payment_attempts
  before delete on kitluy_payments.payment_attempts
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_khqr_transactions
  before delete on kitluy_payments.khqr_transactions
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_refunds
  before delete on kitluy_payments.refunds
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_payment_reconciliations
  before delete on kitluy_payments.payment_reconciliations
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_payment_reconciliation_lines
  before delete on kitluy_payments.payment_reconciliation_lines
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_source_postings
  before delete on kitluy_finance.source_postings
  for each row execute function kitluy_auth.enforce_no_delete();

create trigger trg_no_delete_idempotency_records
  before delete on kitluy_finance.idempotency_records
  for each row execute function kitluy_auth.enforce_no_delete();

-- ---------------------------------------------------------------------------
-- 2. RLS ENABLE + FORCE on every group 0075-0090 relation (fail closed).
-- ---------------------------------------------------------------------------
alter table kitluy_orders.orders enable row level security;
alter table kitluy_orders.orders force row level security;
alter table kitluy_orders.order_lines enable row level security;
alter table kitluy_orders.order_lines force row level security;
alter table kitluy_orders.order_adjustments enable row level security;
alter table kitluy_orders.order_adjustments force row level security;
alter table kitluy_orders.order_events enable row level security;
alter table kitluy_orders.order_events force row level security;
alter table kitluy_orders.order_notes enable row level security;
alter table kitluy_orders.order_notes force row level security;

alter table kitluy_laundry.booking_production_state enable row level security;
alter table kitluy_laundry.booking_production_state force row level security;
alter table kitluy_laundry.booking_status_history enable row level security;
alter table kitluy_laundry.booking_status_history force row level security;
alter table kitluy_laundry.garments enable row level security;
alter table kitluy_laundry.garments force row level security;
alter table kitluy_laundry.laundry_tags enable row level security;
alter table kitluy_laundry.laundry_tags force row level security;
alter table kitluy_laundry.garment_scan_events enable row level security;
alter table kitluy_laundry.garment_scan_events force row level security;
alter table kitluy_laundry.garment_exceptions enable row level security;
alter table kitluy_laundry.garment_exceptions force row level security;
alter table kitluy_laundry.ready_storage_positions enable row level security;
alter table kitluy_laundry.ready_storage_positions force row level security;
alter table kitluy_laundry.ready_storage_assignments enable row level security;
alter table kitluy_laundry.ready_storage_assignments force row level security;
alter table kitluy_laundry.pickup_handoffs enable row level security;
alter table kitluy_laundry.pickup_handoffs force row level security;

alter table kitluy_payments.tenders enable row level security;
alter table kitluy_payments.tenders force row level security;
alter table kitluy_payments.payment_attempts enable row level security;
alter table kitluy_payments.payment_attempts force row level security;
alter table kitluy_payments.khqr_transactions enable row level security;
alter table kitluy_payments.khqr_transactions force row level security;
alter table kitluy_payments.payment_provider_events enable row level security;
alter table kitluy_payments.payment_provider_events force row level security;
alter table kitluy_payments.payment_status_history enable row level security;
alter table kitluy_payments.payment_status_history force row level security;
alter table kitluy_payments.refunds enable row level security;
alter table kitluy_payments.refunds force row level security;
alter table kitluy_payments.voids enable row level security;
alter table kitluy_payments.voids force row level security;
alter table kitluy_payments.settlement_refs enable row level security;
alter table kitluy_payments.settlement_refs force row level security;
alter table kitluy_payments.payment_reconciliations enable row level security;
alter table kitluy_payments.payment_reconciliations force row level security;
alter table kitluy_payments.payment_reconciliation_lines enable row level security;
alter table kitluy_payments.payment_reconciliation_lines force row level security;

alter table kitluy_finance.subledger_accounts enable row level security;
alter table kitluy_finance.subledger_accounts force row level security;
alter table kitluy_finance.subledger_account_translations enable row level security;
alter table kitluy_finance.subledger_account_translations force row level security;
alter table kitluy_finance.journal_entries enable row level security;
alter table kitluy_finance.journal_entries force row level security;
alter table kitluy_finance.journal_postings enable row level security;
alter table kitluy_finance.journal_postings force row level security;
alter table kitluy_finance.source_postings enable row level security;
alter table kitluy_finance.source_postings force row level security;
alter table kitluy_finance.idempotency_records enable row level security;
alter table kitluy_finance.idempotency_records force row level security;

-- ---------------------------------------------------------------------------
-- 3. Schema privileges. service_role never receives DELETE; kitluy_finance
--    journals/source_postings are SELECT-only even for service_role (writes
--    exclusively through post_journal_entry_v1 — AMD-I2).
-- ---------------------------------------------------------------------------
revoke all on schema kitluy_orders, kitluy_payments, kitluy_finance from public;

grant usage on schema kitluy_orders, kitluy_payments, kitluy_finance
  to authenticated, service_role;

grant select on all tables in schema kitluy_orders to authenticated;
grant select on all tables in schema kitluy_laundry to authenticated;
grant select on all tables in schema kitluy_payments to authenticated;
grant select on all tables in schema kitluy_finance to authenticated;

grant select, insert, update on all tables in schema kitluy_orders to service_role;
grant select, insert, update on all tables in schema kitluy_laundry to service_role;
grant select, insert, update on all tables in schema kitluy_payments to service_role;

grant select on all tables in schema kitluy_finance to service_role;
grant insert, update on kitluy_finance.subledger_accounts to service_role;
grant insert, update on kitluy_finance.subledger_account_translations to service_role;
grant insert, update on kitluy_finance.idempotency_records to service_role;
-- journal_entries, journal_postings, source_postings: NO direct INSERT/UPDATE
-- for any client-reachable role — the security-definer RPC is the sole path.

revoke execute on function kitluy_auth.enforce_frozen_columns() from public, anon;
revoke execute on function kitluy_auth.enforce_status_transition() from public, anon;
revoke execute on function kitluy_auth.enforce_version_increment() from public, anon;
revoke execute on function kitluy_auth.enforce_set_once() from public, anon;
revoke execute on function kitluy_auth.enforce_no_delete() from public, anon;
revoke execute on function kitluy_orders.enforce_order_guards() from public, anon;
revoke execute on function kitluy_orders.enforce_line_currency() from public, anon;
revoke execute on function kitluy_laundry.enforce_tag_void_only() from public, anon;
revoke execute on function kitluy_laundry.enforce_exception_resolution() from public, anon;
revoke execute on function kitluy_laundry.enforce_assignment_clear_only() from public, anon;
revoke execute on function kitluy_laundry.enforce_handoff_completion() from public, anon;
revoke execute on function kitluy_payments.enforce_tender_currency() from public, anon;
revoke execute on function kitluy_finance.enforce_journal_balance() from public, anon;

revoke all on function kitluy_finance.post_journal_entry_v1(
  uuid, uuid, uuid, date, text, text, text, text, uuid, text, char, text, text,
  uuid, text, text, jsonb, uuid, text
) from public, anon, authenticated;

grant execute on function kitluy_finance.post_journal_entry_v1(
  uuid, uuid, uuid, date, text, text, text, text, uuid, text, char, text, text,
  uuid, text, text, jsonb, uuid, text
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. SELECT policies (client read model). Zero anon; zero write policies.
-- ---------------------------------------------------------------------------

-- kitluy_orders — store-scope (no neutral transaction-read permission key in
-- the 107-key registry; interim strictest scope, gap recorded — C4 precedent).
create policy orders_select_store on kitluy_orders.orders
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

create policy order_lines_select_store on kitluy_orders.order_lines
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

create policy order_adjustments_select_store on kitluy_orders.order_adjustments
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
  );

create policy order_events_select_store on kitluy_orders.order_events
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
  );

create policy order_notes_select_store on kitluy_orders.order_notes
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
  );

-- kitluy_laundry — store/location scope AND laundry.bookings.read (RBAC
-- registry A0_READ; dev fixtures grant it to store staff personas).
create policy booking_production_state_select_scoped
  on kitluy_laundry.booking_production_state
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy booking_status_history_select_scoped
  on kitluy_laundry.booking_status_history
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy garments_select_scoped on kitluy_laundry.garments
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy laundry_tags_select_scoped on kitluy_laundry.laundry_tags
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy garment_scan_events_select_scoped
  on kitluy_laundry.garment_scan_events
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy garment_exceptions_select_scoped
  on kitluy_laundry.garment_exceptions
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy ready_storage_positions_select_location
  on kitluy_laundry.ready_storage_positions
  for select to authenticated
  using (
    store_location_id = any (kitluy_auth.current_location_ids())
    and kitluy_auth.has_permission('laundry.bookings.read', 'store_location', store_location_id, null)
  );

create policy ready_storage_assignments_select_scoped
  on kitluy_laundry.ready_storage_assignments
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_orders.orders o
      where o.id = order_id
        and o.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

create policy pickup_handoffs_select_scoped on kitluy_laundry.pickup_handoffs
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    and kitluy_auth.has_permission('laundry.bookings.read', 'laundry_booking', order_id, null)
  );

-- kitluy_payments — store/tenant scope AND payments.read (RBAC A0_READ).
create policy tenders_select_scoped on kitluy_payments.tenders
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', id, null)
  );

create policy payment_attempts_select_scoped on kitluy_payments.payment_attempts
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_payments.tenders t
      where t.id = tender_id
        and t.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy khqr_transactions_select_scoped on kitluy_payments.khqr_transactions
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_payments.tenders t
      where t.id = tender_id
        and t.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy payment_provider_events_select_scoped
  on kitluy_payments.payment_provider_events
  for select to authenticated
  using (
    tenant_id is not null
    and tenant_id = any (kitluy_auth.current_tenant_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy payment_status_history_select_scoped
  on kitluy_payments.payment_status_history
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_payments.tenders t
      where t.id = tender_id
        and t.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy refunds_select_scoped on kitluy_payments.refunds
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy voids_select_scoped on kitluy_payments.voids
  for select to authenticated
  using (
    tenant_id = any (kitluy_auth.current_tenant_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy settlement_refs_select_scoped on kitluy_payments.settlement_refs
  for select to authenticated
  using (
    tenant_id = any (kitluy_auth.current_tenant_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

create policy payment_reconciliations_select_scoped
  on kitluy_payments.payment_reconciliations
  for select to authenticated
  using (
    tenant_id = any (kitluy_auth.current_tenant_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', id, null)
  );

create policy payment_reconciliation_lines_select_scoped
  on kitluy_payments.payment_reconciliation_lines
  for select to authenticated
  using (
    tenant_id = any (kitluy_auth.current_tenant_ids())
    and kitluy_auth.has_permission('payments.read', 'payment', tender_id, null)
  );

-- kitluy_finance — tenant-scope interim (NO finance-read key exists in the
-- 107-key RBAC registry; strictest available scope, gap recorded for the
-- registry amendment — C4 precedent).
create policy subledger_accounts_select_tenant on kitluy_finance.subledger_accounts
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy subledger_account_translations_select_tenant
  on kitluy_finance.subledger_account_translations
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_finance.subledger_accounts a
      where a.id = subledger_account_id
        and a.tenant_id = any (kitluy_auth.current_tenant_ids())
    )
  );

create policy journal_entries_select_tenant on kitluy_finance.journal_entries
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy journal_postings_select_tenant on kitluy_finance.journal_postings
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy source_postings_select_tenant on kitluy_finance.source_postings
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy idempotency_records_select_tenant
  on kitluy_finance.idempotency_records
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

commit;

-- Defense in depth: service_role loses UPDATE/DELETE on every append-only
-- table of this train, and ALL write privileges on the RPC-only journal
-- relations (mirrors the group 0035 tail block).
do $$
declare
  t text;
  v_append_only text[] := array[
    'kitluy_orders.order_lines', 'kitluy_orders.order_adjustments',
    'kitluy_orders.order_events', 'kitluy_orders.order_notes',
    'kitluy_laundry.booking_status_history', 'kitluy_laundry.garment_scan_events',
    'kitluy_payments.payment_provider_events', 'kitluy_payments.payment_status_history',
    'kitluy_payments.voids', 'kitluy_payments.settlement_refs',
    'kitluy_finance.journal_entries', 'kitluy_finance.journal_postings'
  ];
begin
  foreach t in array v_append_only loop
    execute format('revoke update, delete on %s from service_role', t);
  end loop;
  execute 'revoke insert, update, delete on kitluy_finance.journal_entries from service_role';
  execute 'revoke insert, update, delete on kitluy_finance.journal_postings from service_role';
  execute 'revoke insert, update, delete on kitluy_finance.source_postings from service_role';
end $$;

-- Manifest (asserted by supabase/tests/assertions.sql):
--   RLS ENABLE+FORCE: 30 relations (kitluy_orders 5, kitluy_laundry 9 new,
--     kitluy_payments 10, kitluy_finance 6).
--   SELECT policies: 30 (kitluy_orders 5, kitluy_laundry 9, kitluy_payments 10,
--     kitluy_finance 6). Zero anon policies; zero write policies.
--   Append-only triggers: 12 new enforce_append_only attachments.
--   No-delete triggers: 15 enforce_no_delete attachments.
--   Guard functions: kitluy_auth enforce_frozen_columns/enforce_status_transition/
--     enforce_version_increment/enforce_set_once/enforce_no_delete;
--     kitluy_orders enforce_order_guards/enforce_line_currency;
--     kitluy_laundry enforce_tag_void_only/enforce_exception_resolution/
--     enforce_assignment_clear_only/enforce_handoff_completion;
--     kitluy_payments enforce_tender_currency;
--     kitluy_finance enforce_journal_balance + post_journal_entry_v1 (RPC,
--     service_role execute only).
