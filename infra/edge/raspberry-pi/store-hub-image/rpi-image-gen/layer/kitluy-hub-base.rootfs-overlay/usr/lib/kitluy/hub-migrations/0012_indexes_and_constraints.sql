-- kitluy:hub:migration:0012
-- ===========================================================================
-- KitLuy Store Hub local database — indexes, integrity triggers, deferred
-- cross-schema foreign keys and role grants.
--
-- Authority: schema contract §8 (required indexes), §1 (append-only, no hard
-- delete), §9 (event/outbox transaction invariant), §12 (acceptance tests),
-- §3 (role privileges).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Cross-schema foreign keys deferred by §4's migration ORDER.
--    These columns were declared as plain uuid in earlier files because their
--    target schema is created later; the reference is completed here.
-- ---------------------------------------------------------------------------
alter table edge_identity.terminal_device
  add constraint terminal_device_hardware_profile_fk
  foreign key (hardware_profile_id) references edge_config.hardware_profile (id);

alter table edge_laundry.exception
  add constraint exception_evidence_asset_fk
  foreign key (evidence_asset_id) references edge_files.asset (id);

alter table edge_documents.receipt
  add constraint receipt_render_asset_fk
  foreign key (render_asset_id) references edge_files.asset (id);

alter table edge_documents.print_attempt
  add constraint print_attempt_observation_fk
  foreign key (printer_observation_id) references edge_hardware.peripheral_observation (id);

-- ---------------------------------------------------------------------------
-- 2. Append-only enforcement (§1 "Finance/payment/custody/audit: append-only").
--    Immutable ledgers: UPDATE and DELETE are BOTH rejected.
-- ---------------------------------------------------------------------------
create trigger cash_movement_append_only
  before update or delete on edge_core.cash_movement
  for each row execute function edge_audit.enforce_append_only();

create trigger status_event_append_only
  before update or delete on edge_laundry.status_event
  for each row execute function edge_audit.enforce_append_only();

create trigger custody_event_append_only
  before update or delete on edge_laundry.custody_event
  for each row execute function edge_audit.enforce_append_only();

create trigger refund_adjustment_append_only
  before update or delete on edge_payments.refund_adjustment
  for each row execute function edge_audit.enforce_append_only();

create trigger local_event_append_only
  before update or delete on edge_sync.local_event
  for each row execute function edge_audit.enforce_append_only();

create trigger audit_event_append_only
  before update or delete on edge_audit.audit_event
  for each row execute function edge_audit.enforce_append_only();

-- ---------------------------------------------------------------------------
-- 3. No hard delete for finalized business records (§1 "Deletion").
--    UPDATE stays legal — these are lifecycle projections, not ledgers.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_relations text[] := array[
    'edge_core.customer', 'edge_core.shift',
    'edge_laundry.booking', 'edge_laundry.booking_line', 'edge_laundry.garment',
    'edge_laundry.bag', 'edge_laundry.tag', 'edge_laundry.exception',
    'edge_laundry.storage_assignment', 'edge_laundry.ready_scan_session',
    'edge_laundry.pickup_session',
    'edge_payments.payment', 'edge_payments.payment_attempt', 'edge_payments.tender_leg',
    'edge_documents.receipt', 'edge_documents.print_job', 'edge_documents.print_attempt',
    'edge_config.configuration_snapshot', 'edge_config.configuration_section',
    'edge_config.configuration_activation',
    'edge_sync.outbox', 'edge_sync.inbox', 'edge_sync.sequence_gap',
    'edge_audit.security_event', 'edge_audit.support_session'
  ];
begin
  foreach t in array v_relations loop
    execute format(
      'create trigger %I before delete on %s for each row execute function edge_audit.enforce_no_hard_delete()',
      split_part(t, '.', 2) || '_no_hard_delete', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Payment immutability guard (§6.5, §12 acceptance test 6: "A confirmed
--    payment cannot be deleted or silently rewritten").
--    The payment row is a projection of append-only payment events, so money,
--    identity and provenance columns are frozen for its whole life and a
--    confirmed payment may only move to `reversed`.
-- ---------------------------------------------------------------------------
create function edge_payments.enforce_payment_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.tenant_id <> old.tenant_id
     or new.digital_store_id <> old.digital_store_id
     or new.location_id <> old.location_id
     or new.booking_id <> old.booking_id
     or new.payment_number <> old.payment_number
     or new.payment_type <> old.payment_type
     or new.amount_minor <> old.amount_minor
     or new.currency_code <> old.currency_code
     or new.currency_exponent <> old.currency_exponent
     or new.requested_at <> old.requested_at
     or new.event_id <> old.event_id
     or new.idempotency_key <> old.idempotency_key then
    raise exception
      'KLUY-EDGE-PAYMENT-IMMUTABLE: money, identity and provenance columns of edge_payments.payment % are frozen; corrections are compensating refund_adjustment rows',
      old.id using errcode = 'P0001';
  end if;
  if old.state = 'confirmed' and new.state not in ('confirmed', 'reversed') then
    raise exception
      'KLUY-EDGE-PAYMENT-CONFIRMED: confirmed payment % cannot transition to % (only a reversal is permitted)',
      old.id, new.state using errcode = 'P0001';
  end if;
  if old.confirmed_at is not null and new.confirmed_at is distinct from old.confirmed_at then
    raise exception
      'KLUY-EDGE-PAYMENT-CONFIRMED: confirmation time of payment % cannot be rewritten', old.id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_payments.enforce_payment_immutability() is
  'Freezes money/identity/provenance columns and the confirmed state of edge_payments.payment (§6.5, §12 acceptance test 6).';

create trigger payment_immutability
  before update on edge_payments.payment
  for each row execute function edge_payments.enforce_payment_immutability();

-- ---------------------------------------------------------------------------
-- 5. Command-result immutability (offline contract §4 "store immutable
--    command result"; §19 error behavior).
--
--    RECORDED DEVIATION: a strictly INSERT-only ledger cannot express §19's
--    "same key, same hash, in progress -> 202 accepted" case, because an
--    in-progress command would be invisible outside its own transaction.
--    The ledger therefore permits exactly one transition — `in_progress` to a
--    terminal status — and freezes every identity, hash and provenance column
--    for the row's whole life. Once terminal, the result is immutable and can
--    be returned repeatedly after a lost response (§17.1).
-- ---------------------------------------------------------------------------
create function edge_sync.enforce_command_result_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-EDGE-COMMAND-RESULT-IMMUTABLE: DELETE rejected on edge_sync.command_result (idempotency evidence; retention is offline contract §18)'
      using errcode = 'P0001';
  end if;
  if old.commit_status <> 'in_progress' then
    raise exception
      'KLUY-EDGE-COMMAND-RESULT-IMMUTABLE: command result % is already terminal (%); a stored result is returned, never rewritten',
      old.idempotency_key, old.commit_status using errcode = 'P0001';
  end if;
  if new.id <> old.id
     or new.idempotency_key <> old.idempotency_key
     or new.request_hash <> old.request_hash
     or new.command_type <> old.command_type
     or new.terminal_device_id <> old.terminal_device_id
     or new.actor_id is distinct from old.actor_id
     or new.origin_sequence <> old.origin_sequence
     or new.assignment_generation <> old.assignment_generation
     or new.tenant_id <> old.tenant_id
     or new.digital_store_id <> old.digital_store_id
     or new.location_id <> old.location_id
     or new.created_at <> old.created_at then
    raise exception
      'KLUY-EDGE-COMMAND-RESULT-IMMUTABLE: identity and request-hash columns of command result % are frozen',
      old.idempotency_key using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_sync.enforce_command_result_immutability() is
  'Permits only the in_progress -> terminal completion of edge_sync.command_result and blocks DELETE (offline contract §4/§19).';

create trigger command_result_immutability
  before update or delete on edge_sync.command_result
  for each row execute function edge_sync.enforce_command_result_immutability();

-- ---------------------------------------------------------------------------
-- 6. Event/outbox transaction invariant (§9).
--
--    "A business mutation without its corresponding event and outbox row is
--    invalid and must fail the transaction."
--
--    The mutation -> event half belongs to the command layer. The event ->
--    outbox half is enforced STRUCTURALLY here by a DEFERRED constraint
--    trigger: a transaction that inserts a local_event without inserting its
--    outbox row cannot commit. This is what makes §12 acceptance test 3
--    ("power loss between business mutation and outbox insertion is
--    impossible") true rather than aspirational.
-- ---------------------------------------------------------------------------
create function edge_sync.assert_event_has_outbox()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from edge_sync.outbox o where o.event_id = new.id) then
    raise exception
      'KLUY-EDGE-OUTBOX-INVARIANT: local_event % has no outbox row; the business mutation, its event and its outbox row share ONE transaction (schema contract §9)',
      new.id using errcode = 'P0001';
  end if;
  return null;
end;
$$;

comment on function edge_sync.assert_event_has_outbox() is
  'Deferred constraint check for the §9 transaction invariant: no local_event may commit without its outbox row.';

create constraint trigger local_event_outbox_invariant
  after insert on edge_sync.local_event
  deferrable initially deferred
  for each row execute function edge_sync.assert_event_has_outbox();

-- ---------------------------------------------------------------------------
-- 7. Storage capacity (§12 acceptance test 4: "Concurrent T3 assignments
--    cannot exceed storage capacity"). The partial unique indexes below stop
--    double assignment of one unit; this trigger stops over-capacity.
--    Command-layer callers additionally run SERIALIZABLE (§1 "Transactions"),
--    for which this trigger is the database backstop.
-- ---------------------------------------------------------------------------
create function edge_laundry.enforce_storage_capacity()
returns trigger
language plpgsql
as $$
declare
  v_capacity integer;
  v_active   integer;
begin
  select capacity into v_capacity
  from edge_laundry.storage_position
  where id = new.storage_position_id;

  select count(*) into v_active
  from edge_laundry.storage_assignment a
  where a.storage_position_id = new.storage_position_id
    and a.cleared_at is null
    and a.id <> new.id;

  if v_active >= v_capacity then
    raise exception
      'KLUY-EDGE-STORAGE-CAPACITY: storage position % already holds %/% active assignments',
      new.storage_position_id, v_active, v_capacity using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_laundry.enforce_storage_capacity() is
  'Rejects an assignment that would exceed edge_laundry.storage_position.capacity (§12 acceptance test 4).';

create trigger storage_assignment_capacity
  before insert or update on edge_laundry.storage_assignment
  for each row when (new.cleared_at is null)
  execute function edge_laundry.enforce_storage_capacity();

-- ---------------------------------------------------------------------------
-- 8. Projection freshness.
-- ---------------------------------------------------------------------------
create trigger booking_touch_updated_at
  before update on edge_laundry.booking
  for each row execute function edge_audit.touch_updated_at();

create trigger customer_touch_updated_at
  before update on edge_core.customer
  for each row execute function edge_audit.touch_updated_at();

create trigger terminal_device_touch_updated_at
  before update on edge_identity.terminal_device
  for each row execute function edge_audit.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 9. §8 required index: "All scoped tables: (tenant_id, digital_store_id,
--    location_id)". Generated from the catalogue so no scoped relation can be
--    missed; every index is named <schema>_<table>_scope_idx.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.table_schema as s, c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema like 'edge\_%'
      and tb.table_type = 'BASE TABLE'
      and c.column_name in ('tenant_id', 'digital_store_id', 'location_id')
    group by c.table_schema, c.table_name
    having count(distinct c.column_name) = 3
    order by 1, 2
  loop
    execute format(
      'create index %I on %I.%I (tenant_id, digital_store_id, location_id)',
      r.s || '_' || r.t || '_scope_idx', r.s, r.t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. §8 named indexes and the partial uniques the catalogue requires in
--     prose ("exactly one active ...", "a partial unique index prevents ...").
-- ---------------------------------------------------------------------------

-- Exactly one active assignment per Hub (§6.1).
create unique index hub_assignment_active_uq
  on edge_identity.hub_assignment (hub_device_id)
  where ended_at is null;

-- One active staff session per terminal profile (§6.1).
create unique index terminal_session_active_uq
  on edge_identity.terminal_session (terminal_device_id, profile_code)
  where closed_at is null;

-- One active configuration snapshot per Location (§1, §6.2).
create unique index configuration_snapshot_active_uq
  on edge_config.configuration_snapshot (location_id)
  where state = 'active';

-- One active profile assignment per (terminal, profile) (§6.2).
create unique index terminal_profile_assignment_active_uq
  on edge_config.terminal_profile_assignment (terminal_device_id, profile_code)
  where enabled and effective_until is null;

-- Booking lookup (§8).
create index booking_customer_idx
  on edge_laundry.booking (location_id, customer_id, updated_at desc);
create index booking_status_idx
  on edge_laundry.booking (location_id, status, business_date);

-- Active storage (§8) and single-active-assignment-per-unit (§6.4).
create index storage_assignment_active_idx
  on edge_laundry.storage_assignment (location_id, storage_position_id)
  where cleared_at is null;
create unique index storage_assignment_active_garment_uq
  on edge_laundry.storage_assignment (location_id, garment_id)
  where cleared_at is null and garment_id is not null;
create unique index storage_assignment_active_bag_uq
  on edge_laundry.storage_assignment (location_id, bag_id)
  where cleared_at is null and bag_id is not null;

-- Custody chain lookup.
create index custody_event_booking_idx
  on edge_laundry.custody_event (location_id, booking_id, occurred_at desc);
create index status_event_booking_idx
  on edge_laundry.status_event (location_id, booking_id, occurred_at desc);

-- Payment provider reference, partial "when present" (§8).
create index payment_provider_reference_idx
  on edge_payments.payment (provider_code, provider_reference)
  where provider_code is not null and provider_reference is not null;
create index payment_booking_idx
  on edge_payments.payment (location_id, booking_id, requested_at desc);

-- Open outbox, partial "where not acknowledged" (§8).
create index outbox_open_idx
  on edge_sync.outbox (delivery_state, next_attempt_at, hub_sequence)
  where delivery_state <> 'acknowledged';

-- Inbox (§8).
create index inbox_state_idx on edge_sync.inbox (state, cloud_sequence);

-- Local event replay ordering.
create index local_event_ordering_idx
  on edge_sync.local_event (location_id, assignment_generation, hub_sequence);
create index local_event_aggregate_idx
  on edge_sync.local_event (aggregate_type, aggregate_id, aggregate_version);

-- Command result lookup by terminal sequence (offline contract §4 replay
-- detection: "lower unknown -> reject replay", "higher with gap -> reject").
create index command_result_terminal_sequence_idx
  on edge_sync.command_result (terminal_device_id, origin_sequence desc);

-- File upload queue (§8).
create index file_transfer_job_queue_idx
  on edge_files.file_transfer_job (state, next_attempt_at);
create index asset_upload_queue_idx on edge_files.asset (state, created_at);

-- Print queue.
create index print_job_queue_idx
  on edge_documents.print_job (state, next_attempt_at, priority desc);

-- Audit and security (§8).
create index audit_event_location_time_idx
  on edge_audit.audit_event (location_id, occurred_at desc);
create index security_event_severity_idx
  on edge_audit.security_event (severity, detected_at desc);

-- Hardware retention/summarization scans (§10).
create index device_heartbeat_observed_idx
  on edge_hardware.device_heartbeat (location_id, observed_at desc);
create index peripheral_observation_binding_idx
  on edge_hardware.peripheral_observation (peripheral_binding_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- 11. Role privileges (§3).
--
--     NO role is granted DELETE on ANY relation. "No hard delete for
--     finalized business records" (§1) is therefore structural as well as
--     trigger-enforced, and terminals hold no database credentials at all
--     (§1 "Access"; repository rule 6 — POS terminals never write directly).
-- ---------------------------------------------------------------------------
do $$
declare
  s text;
begin
  foreach s in array array['edge_identity', 'edge_config', 'edge_core', 'edge_laundry',
                           'edge_payments', 'edge_documents', 'edge_files', 'edge_sync',
                           'edge_hardware', 'edge_audit'] loop
    execute format('grant select, insert, update on all tables in schema %I to kitluy_hub_runtime', s);
    execute format('grant select on all tables in schema %I to kitluy_backup', s);
  end loop;
end $$;

grant select, insert, update on all tables in schema edge_sync to kitluy_sync_worker;
grant select on all tables in schema edge_audit to kitluy_sync_worker;
grant usage, select on sequence edge_sync.hub_sequence_seq to kitluy_hub_runtime;
grant select on edge_ops.migration_journal to kitluy_hub_runtime, kitluy_backup;

-- kitluy_support_ro deliberately receives NO table grant here: §3 restricts it
-- to redacted VIEWS, which are created in 0013.
