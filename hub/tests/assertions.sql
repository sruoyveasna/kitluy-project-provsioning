-- ===========================================================================
-- KitLuy Store Hub local database — structural and behavioural assertions.
--
-- Executes against the LOCAL Hub database via `pnpm hub:db:test`
-- (scripts/hub/hub-db.mjs) after `pnpm hub:db:reset` + `pnpm hub:db:seed`.
--
-- Pattern follows supabase/tests/assertions.sql: DO blocks; a failed assertion
-- raises and aborts the run. Negative probes run inside a plpgsql sub-block so
-- the attempted mutation is rolled back and the database is left unchanged.
--
-- Authority: docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md
--   §1 conventions, §2 schemas, §5 shared types, §6 catalogue, §8 indexes,
--   §9 transaction invariant, §12 acceptance tests;
--   kitluy-offline-idempotency-and-sequencing-v1.0.0.md §2/§4/§19;
--   docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md G1-G8, R4.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The ten canonical schemas (§2) exist — plus the edge_ops control plane.
-- ---------------------------------------------------------------------------
do $$
declare
  s text;
  v_count int;
begin
  foreach s in array array['edge_identity', 'edge_config', 'edge_core', 'edge_laundry',
                           'edge_payments', 'edge_documents', 'edge_files', 'edge_sync',
                           'edge_hardware', 'edge_audit'] loop
    if not exists (select 1 from pg_namespace where nspname = s) then
      raise exception 'ASSERT FAIL: schema % is missing', s;
    end if;
  end loop;
  if not exists (select 1 from pg_namespace where nspname = 'edge_ops') then
    raise exception 'ASSERT FAIL: the edge_ops migration control plane is missing';
  end if;
  -- No eleventh business schema may appear: the Cycle-8 instruction's
  -- edge_commands/edge_events/edge_print/edge_finance are NOT canonical
  -- (reconciliation G5 and G8; §2 governs).
  select count(*) into v_count
  from pg_namespace where nspname like 'edge\_%' and nspname <> 'edge_ops';
  if v_count <> 10 then
    raise exception 'ASSERT FAIL: expected exactly 10 canonical edge schemas, found %', v_count;
  end if;
  if exists (select 1 from pg_namespace where nspname in ('edge_finance', 'edge_commands', 'edge_events', 'edge_print')) then
    raise exception 'ASSERT FAIL: a non-canonical schema exists (reconciliation G5/G8)';
  end if;
  raise notice 'PASS schemas: the ten canonical §2 schemas exist, edge_ops is present, no edge_finance/edge_commands/edge_events/edge_print';
end $$;

-- ---------------------------------------------------------------------------
-- 2. Every §6 relation exists and has a primary key.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_canonical text[] := array[
    -- §6.1 edge_identity (7)
    'edge_identity.hub_device', 'edge_identity.hub_installation',
    'edge_identity.hub_assignment', 'edge_identity.device_credential',
    'edge_identity.terminal_device', 'edge_identity.terminal_session',
    'edge_identity.staff_cache',
    -- §6.2 edge_config (6)
    'edge_config.configuration_snapshot', 'edge_config.configuration_section',
    'edge_config.configuration_activation', 'edge_config.terminal_profile_assignment',
    'edge_config.hardware_profile', 'edge_config.peripheral_binding',
    -- §6.3 edge_core (5)
    'edge_core.customer', 'edge_core.customer_identifier', 'edge_core.business_sequence',
    'edge_core.shift', 'edge_core.cash_movement',
    -- §6.4 edge_laundry (12)
    'edge_laundry.booking', 'edge_laundry.booking_line', 'edge_laundry.garment',
    'edge_laundry.bag', 'edge_laundry.tag', 'edge_laundry.status_event',
    'edge_laundry.exception', 'edge_laundry.storage_position',
    'edge_laundry.storage_assignment', 'edge_laundry.custody_event',
    'edge_laundry.ready_scan_session', 'edge_laundry.pickup_session',
    -- §6.5 edge_payments (4)
    'edge_payments.payment', 'edge_payments.payment_attempt',
    'edge_payments.tender_leg', 'edge_payments.refund_adjustment',
    -- §6.6 edge_documents (3)
    'edge_documents.receipt', 'edge_documents.print_job', 'edge_documents.print_attempt',
    -- §6.7 edge_files (3)
    'edge_files.asset', 'edge_files.asset_chunk', 'edge_files.file_transfer_job',
    -- §6.8 edge_sync (6 canonical)
    'edge_sync.local_event', 'edge_sync.outbox', 'edge_sync.inbox',
    'edge_sync.sync_cursor', 'edge_sync.sync_conflict', 'edge_sync.dead_letter_item',
    -- §6.9 edge_hardware (2)
    'edge_hardware.peripheral_observation', 'edge_hardware.device_heartbeat',
    -- §6.10 edge_audit (3)
    'edge_audit.audit_event', 'edge_audit.security_event', 'edge_audit.support_session'
  ];
begin
  foreach t in array v_canonical loop
    if to_regclass(t) is null then
      raise exception 'ASSERT FAIL: canonical §6 relation % is missing', t;
    end if;
    if not exists (
      select 1 from pg_constraint c where c.conrelid = to_regclass(t) and c.contype = 'p'
    ) then
      raise exception 'ASSERT FAIL: relation % has no primary key', t;
    end if;
  end loop;
  raise notice 'PASS relations: all % canonical §6 relations exist with primary keys', array_length(v_canonical, 1);
end $$;

-- ---------------------------------------------------------------------------
-- 3. Additive extensions recorded in WS-09-T001 (gaps G3/G4 and R4).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['edge_sync.sequence_gap', 'edge_sync.command_result'] loop
    if to_regclass(t) is null then
      raise exception 'ASSERT FAIL: additive extension % is missing (gap G3)', t;
    end if;
    if not exists (select 1 from pg_constraint c where c.conrelid = to_regclass(t) and c.contype = 'p') then
      raise exception 'ASSERT FAIL: additive extension % has no primary key', t;
    end if;
  end loop;

  -- R4: booking.refunded_minor is required by the canonical §6.4 balance CHECK.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'edge_laundry' and table_name = 'booking'
      and column_name = 'refunded_minor' and data_type = 'bigint'
  ) then
    raise exception 'ASSERT FAIL: edge_laundry.booking.refunded_minor is missing (reconciliation R4)';
  end if;

  -- G4: assignment_generation on local_event AND outbox.
  foreach t in array array['local_event', 'outbox'] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'edge_sync' and table_name = t and column_name = 'assignment_generation'
    ) then
      raise exception 'ASSERT FAIL: edge_sync.%.assignment_generation is missing (gap G4)', t;
    end if;
  end loop;

  -- The ordering namespace (location_id, assignment_generation, hub_sequence).
  if not exists (
    select 1 from pg_constraint
    where conname = 'local_event_ordering_uq' and conrelid = 'edge_sync.local_event'::regclass
  ) then
    raise exception 'ASSERT FAIL: the (location_id, assignment_generation, hub_sequence) unique key is missing (offline §5.1)';
  end if;

  raise notice 'PASS additive-extensions: sequence_gap, command_result, booking.refunded_minor, assignment_generation on local_event+outbox, ordering namespace unique';
end $$;

-- ---------------------------------------------------------------------------
-- 4. §5 shared types exist with EXACT value lists.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_actual text[];
  v_expected text[];
  v_checked int := 0;
begin
  for r in
    select * from (values
      -- ALIGNED by 0015 per owner amendment KLD-2026-07-28-001-A01 §2:
      -- sending -> in_flight, blocked -> rejected. RENAME VALUE preserves the
      -- member OIDs and therefore the enumsortorder, so the positions below are
      -- the 0001 positions with the two amended labels.
      ('edge_sync', 'delivery_state',
       array['pending','in_flight','acknowledged','retry_wait','rejected','dead_letter']),
      ('edge_sync', 'inbox_state',
       array['received','verified','applied','rejected','dead_letter']),
      ('edge_sync', 'conflict_state',
       array['open','auto_resolved','operator_required','resolved','waived']),
      -- ADDED by 0015 (amendment §3): the orthogonal conflict dimension. It is
      -- a SEPARATE type precisely so reconciliation_required can never become a
      -- delivery_state member.
      ('edge_sync', 'reconciliation_state', array['none','required','cleared']),
      ('edge_documents', 'print_state',
       array['queued','dispatching','printed','failed','retry_wait','dead_letter','cancelled']),
      ('edge_config', 'activation_state',
       array['downloaded','verified','staged','active','rejected','rolled_back']),
      ('edge_files', 'transfer_state',
       array['local_only','queued','uploading','uploaded','verifying','available','failed','quarantined','evicted']),
      ('edge_hardware', 'health_state',
       array['unknown','ready','busy','degraded','disconnected','misconfigured','unsupported','maintenance_required'])
    ) as x(schema_name, type_name, labels)
  loop
    v_expected := r.labels;
    select array_agg(e.enumlabel::text order by e.enumsortorder) into v_actual
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    join pg_enum e on e.enumtypid = t.oid
    where n.nspname = r.schema_name and t.typname = r.type_name;

    if v_actual is null then
      raise exception 'ASSERT FAIL: enum type %.% is missing (§5)', r.schema_name, r.type_name;
    end if;
    if v_actual <> v_expected then
      raise exception 'ASSERT FAIL: enum %.% has values % but §5 declares %',
        r.schema_name, r.type_name, v_actual, v_expected;
    end if;
    v_checked := v_checked + 1;
  end loop;
  if v_checked <> 8 then
    raise exception 'ASSERT FAIL: expected 8 enum types (7 §5 shared + 1 amendment-added), checked %',
      v_checked;
  end if;
  raise notice 'PASS enum-types: all 7 §5 shared types plus edge_sync.reconciliation_state exist with the exact declared value lists';
end $$;

-- ---------------------------------------------------------------------------
-- 5. Appendix A scope columns on every business relation.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  c text;
  v_scoped text[] := array[
    'edge_identity.hub_assignment', 'edge_identity.terminal_device',
    'edge_identity.terminal_session', 'edge_identity.staff_cache',
    'edge_config.configuration_snapshot', 'edge_config.configuration_activation',
    'edge_config.terminal_profile_assignment', 'edge_config.peripheral_binding',
    'edge_core.customer', 'edge_core.customer_identifier', 'edge_core.shift',
    'edge_core.cash_movement',
    'edge_laundry.booking', 'edge_laundry.booking_line', 'edge_laundry.garment',
    'edge_laundry.bag', 'edge_laundry.tag', 'edge_laundry.status_event',
    'edge_laundry.exception', 'edge_laundry.storage_position',
    'edge_laundry.storage_assignment', 'edge_laundry.custody_event',
    'edge_laundry.ready_scan_session', 'edge_laundry.pickup_session',
    'edge_payments.payment', 'edge_payments.payment_attempt',
    'edge_payments.tender_leg', 'edge_payments.refund_adjustment',
    'edge_documents.receipt', 'edge_documents.print_job',
    'edge_files.asset', 'edge_files.file_transfer_job',
    'edge_sync.local_event', 'edge_sync.outbox', 'edge_sync.inbox',
    'edge_sync.sync_conflict', 'edge_sync.dead_letter_item',
    'edge_sync.sequence_gap', 'edge_sync.command_result',
    -- WS-10 additive extension G9. transmission_batch_item is deliberately
    -- ABSENT: it inherits scope from its parent batch, exactly as
    -- configuration_section inherits from its snapshot. Duplicating the scope
    -- columns there would let a child disagree with its parent.
    'edge_sync.transmission_batch',
    -- WS-10 additive extension G10 (KLREQ-027 provider-outcome dedupe).
    'edge_sync.provider_outcome_delivery',
    -- WS-10 additive extension G11 (KLREQ-025 signed grant projection).
    'edge_config.permission_grant_projection',
    -- WS-11-T004-P03B additive extension G0031 (hub-terminal pairing).
    'edge_identity.pairing_session', 'edge_identity.pairing_receipt',
    -- WS-11-T005 hub group 0035: local terminal health and containment.
    'edge_hardware.terminal_health_status', 'edge_identity.containment_directive',
    -- WS-11-T005-P02 hub group 0036: append-only fleet report evidence.
    'edge_hardware.terminal_health_report',
    -- WS-11-T006-P03 hub group 0038: verified release artifact cache.
    'edge_config.release_cache',
    -- WS-11-T006-P04 hub group 0039: durable A/B installation state.
    'edge_config.release_installation',
    'edge_hardware.peripheral_observation', 'edge_hardware.device_heartbeat',
    'edge_audit.audit_event', 'edge_audit.support_session'
  ];
begin
  foreach t in array v_scoped loop
    foreach c in array array['tenant_id', 'digital_store_id', 'location_id'] loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = split_part(t, '.', 1) and table_name = split_part(t, '.', 2)
          and column_name = c and data_type = 'uuid' and is_nullable = 'NO'
      ) then
        raise exception 'ASSERT FAIL: %.% is missing or nullable (Appendix A scope columns)', t, c;
      end if;
    end loop;
  end loop;

  -- §6.10 verbatim exemption: security_event scope columns are NULLABLE so a
  -- pre-assignment device can still emit evidence.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'edge_audit' and table_name = 'security_event'
      and column_name in ('tenant_id', 'digital_store_id', 'location_id')
      and is_nullable = 'NO'
  ) then
    raise exception 'ASSERT FAIL: edge_audit.security_event scope columns must stay nullable (§6.10)';
  end if;

  raise notice 'PASS scope-columns: all % business relations carry NOT NULL tenant_id/digital_store_id/location_id; security_event stays nullable by contract', array_length(v_scoped, 1);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Money representation (§1; repository rule 12) — integer minor units,
--    explicit currency and exponent, and NO floating point anywhere.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_minor int;
  v_currency int;
  v_exponent int;
begin
  -- (a) no floating-point column exists in ANY edge_* schema.
  for r in
    select table_schema, table_name, column_name, data_type
    from information_schema.columns
    where table_schema like 'edge\_%' and data_type in ('real', 'double precision')
  loop
    raise exception 'ASSERT FAIL: floating-point column %.%.% (%) — money and quantities are never floating point (§1)',
      r.table_schema, r.table_name, r.column_name, r.data_type;
  end loop;

  -- (b) every *_minor column is bigint.
  for r in
    select table_schema, table_name, column_name, data_type
    from information_schema.columns
    where table_schema like 'edge\_%' and column_name like '%\_minor'
  loop
    if r.data_type <> 'bigint' then
      raise exception 'ASSERT FAIL: %.%.% is % but minor units must be bigint (§1)',
        r.table_schema, r.table_name, r.column_name, r.data_type;
    end if;
  end loop;
  select count(*) into v_minor from information_schema.columns
  where table_schema like 'edge\_%' and column_name like '%\_minor';

  -- (c) every currency_code is char(3); every currency_exponent is smallint.
  for r in
    select table_schema, table_name, column_name, data_type, character_maximum_length
    from information_schema.columns
    where table_schema like 'edge\_%' and column_name = 'currency_code'
  loop
    if r.data_type <> 'character' or r.character_maximum_length <> 3 then
      raise exception 'ASSERT FAIL: %.%.currency_code is %(%) but §1 requires char(3)',
        r.table_schema, r.table_name, r.data_type, r.character_maximum_length;
    end if;
  end loop;
  select count(*) into v_currency from information_schema.columns
  where table_schema like 'edge\_%' and column_name = 'currency_code';

  for r in
    select table_schema, table_name, data_type
    from information_schema.columns
    where table_schema like 'edge\_%' and column_name = 'currency_exponent'
  loop
    if r.data_type <> 'smallint' then
      raise exception 'ASSERT FAIL: %.%.currency_exponent is % but §1 requires smallint',
        r.table_schema, r.table_name, r.data_type;
    end if;
  end loop;
  select count(*) into v_exponent from information_schema.columns
  where table_schema like 'edge\_%' and column_name = 'currency_exponent';

  -- (d) every money group is COMPLETE: a currency_code never appears without
  --     its exponent (§1 three-column money representation).
  if v_currency <> v_exponent then
    raise exception 'ASSERT FAIL: % currency_code column(s) but % currency_exponent column(s) — §1 money is amount_minor + currency_code + currency_exponent',
      v_currency, v_exponent;
  end if;

  -- (e) no numeric/decimal column is used for money.
  for r in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema like 'edge\_%' and data_type = 'numeric'
      and (column_name like '%amount%' or column_name like '%price%'
           or column_name like '%total%' or column_name like '%minor%'
           or column_name like '%cash%')
  loop
    raise exception 'ASSERT FAIL: numeric money column %.%.% — money is integer minor units (§1)',
      r.table_schema, r.table_name, r.column_name;
  end loop;

  raise notice 'PASS money: % *_minor bigint column(s), % currency_code char(3) + % currency_exponent smallint, zero float/real/double, zero numeric money',
    v_minor, v_currency, v_exponent;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Quantities are numeric(18,4) (§1).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  select data_type, numeric_precision, numeric_scale into r
  from information_schema.columns
  where table_schema = 'edge_laundry' and table_name = 'booking_line' and column_name = 'quantity';
  if r.data_type <> 'numeric' or r.numeric_precision <> 18 or r.numeric_scale <> 4 then
    raise exception 'ASSERT FAIL: edge_laundry.booking_line.quantity is %(%,%) but §1 requires numeric(18,4)',
      r.data_type, r.numeric_precision, r.numeric_scale;
  end if;
  raise notice 'PASS quantities: booking_line.quantity is numeric(18,4) (§1 "never floating point")';
end $$;

-- ---------------------------------------------------------------------------
-- 8. Append-only triggers on finance / payment / custody / audit (§1).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_append_only text[] := array[
    'edge_core.cash_movement', 'edge_laundry.status_event', 'edge_laundry.custody_event',
    'edge_payments.refund_adjustment', 'edge_sync.local_event', 'edge_audit.audit_event'
  ];
begin
  foreach t in array v_append_only loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = to_regclass(t) and not tg.tgisinternal
        and tg.tgfoid = 'edge_audit.enforce_append_only()'::regprocedure
        -- tgtype bit 4 = UPDATE, bit 8 = DELETE
        and (tg.tgtype & 16) > 0 and (tg.tgtype & 8) > 0
    ) then
      raise exception 'ASSERT FAIL: % has no append-only trigger covering UPDATE and DELETE (§1)', t;
    end if;
  end loop;
  raise notice 'PASS append-only-triggers: all % finance/payment/custody/audit ledgers reject UPDATE and DELETE', array_length(v_append_only, 1);
end $$;

-- ---------------------------------------------------------------------------
-- 9. Append-only is BEHAVIOURALLY enforced, not just declared.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
  v_rows int;
  t text;
begin
  -- Precondition: a BEFORE ... FOR EACH ROW trigger never fires when no row
  -- matches, so a missing fixture would silently "pass" this probe.
  foreach t in array array['edge_laundry.custody_event|e0000000-0000-4000-8000-000000000083',
                           'edge_core.cash_movement|e0000000-0000-4000-8000-000000000095',
                           'edge_audit.audit_event|e0000000-0000-4000-8000-0000000000f8',
                           'edge_payments.refund_adjustment|e0000000-0000-4000-8000-000000000094'] loop
    execute format('select count(*) from %s where id = %L', split_part(t, '|', 1), split_part(t, '|', 2))
      into v_rows;
    if v_rows <> 1 then
      raise exception 'ASSERT FAIL: fixture row % is missing from % — run pnpm hub:db:seed first',
        split_part(t, '|', 2), split_part(t, '|', 1);
    end if;
  end loop;

  begin
    update edge_laundry.custody_event set to_custody_state = 'tampered'
    where id = 'e0000000-0000-4000-8000-000000000083';
    raise exception 'ASSERT FAIL: UPDATE on edge_laundry.custody_event was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    delete from edge_core.cash_movement where id = 'e0000000-0000-4000-8000-000000000095';
    raise exception 'ASSERT FAIL: DELETE on edge_core.cash_movement was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    update edge_audit.audit_event set event_code = 'tampered'
    where id = 'e0000000-0000-4000-8000-0000000000f8';
    raise exception 'ASSERT FAIL: UPDATE on edge_audit.audit_event was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    delete from edge_payments.refund_adjustment where id = 'e0000000-0000-4000-8000-000000000094';
    raise exception 'ASSERT FAIL: DELETE on edge_payments.refund_adjustment was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 blocked append-only mutations, got %', v_blocked;
  end if;
  raise notice 'PASS append-only-behaviour: custody UPDATE, cash DELETE, audit UPDATE and refund DELETE are all rejected';
end $$;

-- ---------------------------------------------------------------------------
-- 10. No hard delete for finalized business records (§1 "Deletion").
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_no_delete text[] := array[
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
  foreach t in array v_no_delete loop
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = to_regclass(t) and not tg.tgisinternal
        and tg.tgfoid = 'edge_audit.enforce_no_hard_delete()'::regprocedure
    ) then
      raise exception 'ASSERT FAIL: % has no no-hard-delete trigger (§1)', t;
    end if;
  end loop;

  begin
    delete from edge_laundry.booking where id = 'e0000000-0000-4000-8000-000000000070';
    raise exception 'ASSERT FAIL: DELETE on a finalized Booking was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  begin
    delete from edge_payments.payment where id = 'e0000000-0000-4000-8000-000000000090';
    raise exception 'ASSERT FAIL: DELETE on a confirmed payment was accepted (§12 acceptance test 6)';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  raise notice 'PASS no-hard-delete: % finalized relations carry the guard; Booking and confirmed-payment DELETE both rejected', array_length(v_no_delete, 1);
end $$;

-- ---------------------------------------------------------------------------
-- 11. No role holds DELETE on any edge_* relation (§3 privileges).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select table_schema, table_name, grantee
    from information_schema.role_table_grants
    where table_schema like 'edge\_%' and privilege_type = 'DELETE'
      and grantee in ('kitluy_hub_runtime', 'kitluy_sync_worker', 'kitluy_backup',
                      'kitluy_support_ro', 'PUBLIC')
  loop
    raise exception 'ASSERT FAIL: % holds DELETE on %.% — no Hub role may hard-delete (§1/§3)',
      r.grantee, r.table_schema, r.table_name;
  end loop;
  raise notice 'PASS role-privileges: no Hub role (runtime, sync worker, backup, support, PUBLIC) holds DELETE on any edge_* relation';
end $$;

-- ---------------------------------------------------------------------------
-- 12. Canonical idempotency key (offline §2; reconciliation G1).
-- ---------------------------------------------------------------------------
do $$
declare
  v_canonical text := 'kl1.0198d4f0-6f4a-7e6e-bd3d-9f3c9153e1c1.8821';
  v_legacy    text := 'location:e0000000-0000-4000-8000-000000000003:hub:e0000000-0000-4000-8000-000000000010:seq:7';
begin
  if not edge_sync.is_canonical_idempotency_key(v_canonical) then
    raise exception 'ASSERT FAIL: the canonical kl1 example from offline contract §2 was rejected';
  end if;
  if edge_sync.is_canonical_idempotency_key(v_legacy) then
    raise exception 'ASSERT FAIL: the non-canonical location:...:hub:...:seq:N format was accepted (gap G1)';
  end if;
  if edge_sync.is_canonical_idempotency_key('kl1.not-a-uuid.1') then
    raise exception 'ASSERT FAIL: a malformed kl1 key was accepted';
  end if;

  -- The CHECK constraint must reject it at INSERT time, not merely the helper.
  begin
    insert into edge_sync.command_result
      (id, tenant_id, digital_store_id, location_id, idempotency_key, request_hash,
       command_type, terminal_device_id, origin_sequence, assignment_generation,
       aggregate_type, sync_state, commit_status, created_at)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       v_legacy, encode(sha256('probe'), 'hex'), 'probe.command',
       'e0000000-0000-4000-8000-000000000020', 9999, 1, 'probe', null,
       'in_progress', now());
    raise exception 'ASSERT FAIL: command_result accepted the non-canonical idempotency key format';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  raise notice 'PASS idempotency-key: kl1.{terminal_device_uuid}.{client_sequence} accepted; the non-canonical location:...:hub:...:seq:N shape rejected by helper AND CHECK (gap G1)';
end $$;

-- ---------------------------------------------------------------------------
-- 13. Every relation that stores an idempotency key CHECKs the canonical shape.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select c.table_schema, c.table_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema like 'edge\_%' and c.column_name = 'idempotency_key'
      and t.table_type = 'BASE TABLE'
  loop
    -- edge_sync.local_event accepts EITHER namespace after 0018
    -- (KLD-2026-07-28-001 Group 6): an EVENT carries the Hub-issued kh1.* effect
    -- key, while the shipped fixtures and pre-ruling rows carry kl1.*. Every
    -- OTHER relation keeps the STRICT terminal check — in particular
    -- command_result, because a command result always belongs to a terminal
    -- command (terminal_device_id is NOT NULL).
    if not exists (
      select 1 from pg_constraint k
      where k.conrelid = format('%I.%I', r.table_schema, r.table_name)::regclass
        and k.contype = 'c'
        and (pg_get_constraintdef(k.oid) like '%is_canonical_idempotency_key%'
             or pg_get_constraintdef(k.oid) like '%is_canonical_event_key%')
    ) then
      raise exception 'ASSERT FAIL: %.% stores idempotency_key without a canonical CHECK (offline §2)',
        r.table_schema, r.table_name;
    end if;
    if r.table_schema || '.' || r.table_name <> 'edge_sync.local_event' then
      if exists (
        select 1 from pg_constraint k
        where k.conrelid = format('%I.%I', r.table_schema, r.table_name)::regclass
          and k.contype = 'c'
          and pg_get_constraintdef(k.oid) like '%is_canonical_event_key%'
      ) then
        raise exception
          'ASSERT FAIL: %.% accepts the Hub-issued kh1 namespace; only edge_sync.local_event may (KLREQ-026)',
          r.table_schema, r.table_name;
      end if;
    end if;
    v_count := v_count + 1;
  end loop;
  if v_count < 5 then
    raise exception 'ASSERT FAIL: expected at least 5 idempotency-key relations, found %', v_count;
  end if;

  -- The two namespaces must stay DISJOINT: a Hub-generated effect can never be
  -- read as a terminal command (KLREQ-026).
  if edge_sync.is_canonical_idempotency_key('kh1.e0000000-0000-4000-8000-000000000020.0')
     or edge_sync.is_canonical_effect_key('kl1.e0000000-0000-4000-8000-000000000020.1') then
    raise exception 'ASSERT FAIL: the kl1 and kh1 key namespaces overlap (KLREQ-026)';
  end if;
  if not edge_sync.is_canonical_event_key('kh1.e0000000-0000-4000-8000-000000000020.0')
     or not edge_sync.is_canonical_event_key('kl1.e0000000-0000-4000-8000-000000000020.1')
     or edge_sync.is_canonical_event_key('kx1.e0000000-0000-4000-8000-000000000020.1') then
    raise exception 'ASSERT FAIL: the event-key check does not accept exactly the two canonical namespaces';
  end if;

  raise notice 'PASS idempotency-key-coverage: % relation(s) store an idempotency key; edge_sync.local_event accepts the kl1 and kh1 namespaces and every other relation stays strict-terminal; the namespaces are disjoint', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 14. §9 event/outbox transaction invariant is structurally enforced.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'local_event_outbox_invariant'
      and tgrelid = 'edge_sync.local_event'::regclass
      and tgdeferrable and tginitdeferred
  ) then
    raise exception 'ASSERT FAIL: the deferred §9 outbox-invariant constraint trigger is missing';
  end if;

  begin
    insert into edge_sync.local_event
      (id, tenant_id, digital_store_id, location_id, hub_device_id, origin_device_id,
       aggregate_type, aggregate_id, aggregate_version, event_type, schema_version,
       business_date, occurred_at, hub_sequence, origin_sequence, assignment_generation,
       idempotency_key, payload_sha256, payload, created_at)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000020',
       'booking', 'e0000000-0000-4000-8000-000000000070', 99, 'probe_event', 1,
       '2026-07-27', now(), nextval('edge_sync.hub_sequence_seq'), 9998, 1,
       'kl1.e0000000-0000-4000-8000-000000000020.9998',
       encode(sha256('probe'), 'hex'), '{}'::jsonb, now());
    -- Force the DEFERRED check to run now, inside this sub-transaction.
    execute 'set constraints all immediate';
    raise exception 'ASSERT FAIL: a local_event committed without its outbox row (§9 invariant broken)';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;
  execute 'set constraints all deferred';

  -- Every seeded event DOES have its outbox row.
  if exists (
    select 1 from edge_sync.local_event e
    left join edge_sync.outbox o on o.event_id = e.id
    where o.event_id is null
  ) then
    raise exception 'ASSERT FAIL: a persisted local_event has no outbox row';
  end if;

  raise notice 'PASS outbox-invariant: a local_event without an outbox row cannot commit (§9); every persisted event has its outbox row';
end $$;

-- ---------------------------------------------------------------------------
-- 15. Confirmed payments cannot be silently rewritten (§12 acceptance test 6).
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
begin
  begin
    update edge_payments.payment set amount_minor = 1
    where id = 'e0000000-0000-4000-8000-000000000090';
    raise exception 'ASSERT FAIL: the amount of a confirmed payment was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    update edge_payments.payment set state = 'failed'
    where id = 'e0000000-0000-4000-8000-000000000090';
    raise exception 'ASSERT FAIL: a confirmed payment was moved back to failed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    update edge_payments.payment set idempotency_key = 'kl1.e0000000-0000-4000-8000-000000000020.7777'
    where id = 'e0000000-0000-4000-8000-000000000090';
    raise exception 'ASSERT FAIL: the idempotency key of a confirmed payment was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 blocked payment rewrites, got %', v_blocked;
  end if;
  raise notice 'PASS payment-immutability: amount, state regression and idempotency-key rewrite of a confirmed payment are all rejected';
end $$;

-- ---------------------------------------------------------------------------
-- 16. Command-result immutability (offline §4 "store immutable command result").
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
begin
  begin
    update edge_sync.command_result set result_json = '{"tampered": true}'::jsonb
    where idempotency_key = 'kl1.e0000000-0000-4000-8000-000000000020.1001';
    raise exception 'ASSERT FAIL: a terminal command result was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    delete from edge_sync.command_result
    where idempotency_key = 'kl1.e0000000-0000-4000-8000-000000000020.1001';
    raise exception 'ASSERT FAIL: a command result was deleted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- A reused key is impossible: the unique index IS the reservation (§4).
  begin
    insert into edge_sync.command_result
      (id, tenant_id, digital_store_id, location_id, idempotency_key, request_hash,
       command_type, terminal_device_id, origin_sequence, assignment_generation,
       aggregate_type, sync_state, commit_status, created_at)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'kl1.e0000000-0000-4000-8000-000000000020.1001', encode(sha256('different'), 'hex'),
       'payments.record_cash_payment', 'e0000000-0000-4000-8000-000000000020', 1001, 1,
       'payment', null, 'in_progress', now());
    raise exception 'ASSERT FAIL: an idempotency key was reserved twice';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 blocked command-result mutations, got %', v_blocked;
  end if;
  raise notice 'PASS command-result: terminal results cannot be rewritten or deleted, and one idempotency key can be reserved only once (offline §4/§19)';
end $$;

-- ---------------------------------------------------------------------------
-- 17. No fabricated cloud acknowledgement (WS-09-T004 truthful sync state).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into edge_sync.outbox
      (event_id, tenant_id, digital_store_id, location_id, hub_sequence,
       assignment_generation, delivery_state, attempt_count, next_attempt_at)
    values
      ('e0000000-0000-4000-8000-0000000000d2', 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       9999, 1, 'acknowledged', 1, now());
    raise exception 'ASSERT FAIL: an acknowledged outbox row was accepted without a cloud ack id';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  if exists (
    select 1 from edge_sync.outbox
    where delivery_state = 'acknowledged' and (cloud_ack_id is null or acknowledged_at is null)
  ) then
    raise exception 'ASSERT FAIL: an acknowledged outbox row lacks its cloud acknowledgement identity';
  end if;

  raise notice 'PASS truthful-sync-state: delivery_state=acknowledged requires a real cloud ack id and timestamp; WS-09 fabricates none';
end $$;

-- ---------------------------------------------------------------------------
-- 18. Storage: single active assignment per unit and no over-capacity
--     (§6.4, §12 acceptance test 4).
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
begin
  begin
    insert into edge_laundry.storage_assignment
      (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
       storage_position_id, assigned_at, assigned_by, terminal_device_id, assignment_event_id)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'e0000000-0000-4000-8000-000000000070', 'e0000000-0000-4000-8000-000000000074', null,
       'e0000000-0000-4000-8000-000000000079', now(),
       'e0000000-0000-4000-8000-000000000041', 'e0000000-0000-4000-8000-000000000022',
       gen_random_uuid());
    raise exception 'ASSERT FAIL: a second unit was assigned to a capacity-1 storage position';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    insert into edge_laundry.storage_assignment
      (id, tenant_id, digital_store_id, location_id, booking_id, garment_id, bag_id,
       storage_position_id, assigned_at, assigned_by, terminal_device_id, assignment_event_id)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'e0000000-0000-4000-8000-000000000070', 'e0000000-0000-4000-8000-000000000073', null,
       'e0000000-0000-4000-8000-00000000007a', now(),
       'e0000000-0000-4000-8000-000000000041', 'e0000000-0000-4000-8000-000000000022',
       gen_random_uuid());
    raise exception 'ASSERT FAIL: a garment was actively stored in two positions at once';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 blocked storage assignments, got %', v_blocked;
  end if;
  raise notice 'PASS storage: over-capacity assignment and double active assignment of one unit are both rejected (§12 acceptance test 4)';
end $$;

-- ---------------------------------------------------------------------------
-- 19. Booking balance projection CHECK, including the R4 additive column.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint where conname = 'booking_balance_ck'
    and conrelid = 'edge_laundry.booking'::regclass;
  if v_def is null then
    raise exception 'ASSERT FAIL: edge_laundry.booking has no balance CHECK (§6.4)';
  end if;
  if v_def not like '%refunded_minor%' then
    raise exception 'ASSERT FAIL: the balance CHECK does not reference refunded_minor (reconciliation R4)';
  end if;

  begin
    update edge_laundry.booking set balance_minor = 0
    where id = 'e0000000-0000-4000-8000-000000000070';
    raise exception 'ASSERT FAIL: an inconsistent Booking balance was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  raise notice 'PASS booking-balance: balance_minor = total_minor - paid_minor + refunded_minor is enforced (§6.4 with R4)';
end $$;

-- ---------------------------------------------------------------------------
-- 20. §8 required indexes.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  i text;
  v_missing text[] := array[]::text[];
  v_named text[] := array[
    'outbox_open_idx',                          -- open outbox partial
    'inbox_state_idx',                          -- (state, cloud_sequence)
    'booking_number_uq',                        -- (location_id, booking_number)
    'booking_customer_idx',                     -- (location_id, customer_id, updated_at desc)
    'tag_code_uq',                              -- (location_id, tag_code)
    'storage_assignment_active_idx',            -- active storage partial
    'payment_provider_reference_idx',           -- provider ref partial
    'file_transfer_job_queue_idx',              -- (state, next_attempt_at)
    'audit_event_location_time_idx',            -- (location_id, occurred_at desc)
    'security_event_severity_idx',              -- (severity, detected_at desc)
    'hub_assignment_active_uq',
    'terminal_session_active_uq',
    'configuration_snapshot_active_uq',
    'terminal_profile_assignment_active_uq',
    'storage_assignment_active_garment_uq',
    'storage_assignment_active_bag_uq'
  ];
  v_scope int := 0;
begin
  foreach i in array v_named loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where c.relkind = 'i' and c.relname = i and n.nspname like 'edge\_%') then
      v_missing := v_missing || i;
    end if;
  end loop;
  if array_length(v_missing, 1) is not null then
    raise exception 'ASSERT FAIL: §8 index(es) missing: %', array_to_string(v_missing, ', ');
  end if;

  -- §8: "All scoped tables: (tenant_id, digital_store_id, location_id)".
  for r in
    select c.table_schema as s, c.table_name as t
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema like 'edge\_%' and tb.table_type = 'BASE TABLE'
      and c.column_name in ('tenant_id', 'digital_store_id', 'location_id')
      and c.is_nullable = 'NO'
    group by c.table_schema, c.table_name
    having count(distinct c.column_name) = 3
  loop
    if not exists (
      select 1 from pg_indexes
      where schemaname = r.s and tablename = r.t and indexname = r.s || '_' || r.t || '_scope_idx'
    ) then
      raise exception 'ASSERT FAIL: scoped relation %.% has no (tenant_id, digital_store_id, location_id) index (§8)', r.s, r.t;
    end if;
    v_scope := v_scope + 1;
  end loop;

  raise notice 'PASS indexes: all 16 named §8 indexes exist and all % scoped relations carry the scope index', v_scope;
end $$;

-- ---------------------------------------------------------------------------
-- 21. §7 procedures and the §6.2/§3 views exist.
-- ---------------------------------------------------------------------------
do $$
declare
  p text;
begin
  foreach p in array array[
    'edge_core.allocate_business_number', 'edge_core.format_display_number',
    'edge_sync.allocate_hub_sequence', 'edge_sync.record_sequence_gap',
    'edge_sync.accept_terminal_command', 'edge_sync.complete_command',
    'edge_sync.is_canonical_idempotency_key', 'edge_documents.is_canonical_suppression_key',
    'edge_audit.enforce_append_only', 'edge_audit.enforce_no_hard_delete',
    'edge_sync.assert_event_has_outbox', 'edge_laundry.enforce_storage_capacity',
    'edge_payments.enforce_payment_immutability',
    'edge_sync.enforce_command_result_immutability'
  ] loop
    if not exists (
      select 1 from pg_proc pr join pg_namespace n on n.oid = pr.pronamespace
      where n.nspname = split_part(p, '.', 1) and pr.proname = split_part(p, '.', 2)
    ) then
      raise exception 'ASSERT FAIL: routine % is missing', p;
    end if;
  end loop;

  foreach p in array array['edge_config.active_configuration', 'edge_sync.outbox_pending',
                           'edge_audit.support_booking_summary', 'edge_audit.support_sync_health'] loop
    if not exists (
      select 1 from pg_views where schemaname = split_part(p, '.', 1) and viewname = split_part(p, '.', 2)
    ) then
      raise exception 'ASSERT FAIL: view % is missing', p;
    end if;
  end loop;

  -- §3: kitluy_support_ro sees REDACTED views only and holds no table grant.
  if exists (
    select 1 from information_schema.role_table_grants g
    join information_schema.tables t
      on t.table_schema = g.table_schema and t.table_name = g.table_name
    where g.grantee = 'kitluy_support_ro' and g.table_schema like 'edge\_%'
      and t.table_type = 'BASE TABLE'
  ) then
    raise exception 'ASSERT FAIL: kitluy_support_ro holds a BASE TABLE grant; §3 allows redacted views only';
  end if;

  -- The support views must not expose customer identity.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'edge_audit' and table_name = 'support_booking_summary'
      and column_name in ('customer_id', 'display_name', 'phone_e164', 'email_normalized')
  ) then
    raise exception 'ASSERT FAIL: the support diagnostic view exposes customer identity';
  end if;

  raise notice 'PASS procedures-views: 14 routines and 4 views exist; kitluy_support_ro has redacted views only and no customer identity';
end $$;

-- ---------------------------------------------------------------------------
-- 22. Business-number allocator is collision-safe (§12 acceptance test 8).
-- ---------------------------------------------------------------------------
do $$
declare
  v_a bigint;
  v_b bigint;
begin
  begin
    v_a := edge_core.allocate_business_number(
             'e0000000-0000-4000-8000-000000000003', 'assert_probe', '2026-07-27');
    v_b := edge_core.allocate_business_number(
             'e0000000-0000-4000-8000-000000000003', 'assert_probe', '2026-07-27');
    if v_a <> 1 or v_b <> 2 then
      raise exception 'ASSERT FAIL: allocator returned %/% instead of 1/2', v_a, v_b;
    end if;
    if edge_core.format_display_number('KLB', 'pp001', '2026-07-27', v_b)
       <> 'KLB-PP001-260727-000002' then
      raise exception 'ASSERT FAIL: display-number format does not match Appendix B';
    end if;
    -- Roll the probe back: assertions leave the database unchanged.
    raise exception 'ROLLBACK_PROBE';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
  end;
  raise notice 'PASS display-numbers: allocate_business_number returns 1 then 2 and Appendix B formatting is KLB-PP001-260727-000002';
end $$;

-- ---------------------------------------------------------------------------
-- 23. accept_terminal_command implements the offline §4 acceptance algorithm.
-- ---------------------------------------------------------------------------
do $$
declare
  v_out edge_sync.command_outcome;
  v_hits int := 0;
begin
  -- (a) duplicate key + SAME request hash returns the stored result.
  v_out := edge_sync.accept_terminal_command(
    gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
    'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
    'e0000000-0000-4000-8000-000000000020',
    'kl1.e0000000-0000-4000-8000-000000000020.1001',
    encode(sha256('fixture:request-hash:cash-payment-3000'), 'hex'),
    'payments.record_cash_payment', 'payment');
  if v_out.outcome <> 'duplicate' then
    raise exception 'ASSERT FAIL: a replayed command returned outcome % instead of duplicate', v_out.outcome;
  end if;
  if v_out.aggregate_id <> 'e0000000-0000-4000-8000-000000000090' then
    raise exception 'ASSERT FAIL: the replay did not return the ORIGINAL stored result';
  end if;
  v_hits := v_hits + 1;

  -- (b) duplicate key + DIFFERENT request hash is EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH.
  begin
    v_out := edge_sync.accept_terminal_command(
      gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
      'e0000000-0000-4000-8000-000000000020',
      'kl1.e0000000-0000-4000-8000-000000000020.1001',
      encode(sha256('a different body'), 'hex'), 'payments.record_cash_payment', 'payment');
    raise exception 'ASSERT FAIL: a key reused with a different request hash was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH%' then
      raise exception 'ASSERT FAIL: expected EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH, got %', sqlerrm;
    end if;
    v_hits := v_hits + 1;
  end;

  -- (c) cross-Location command is refused (§12 acceptance test 9).
  begin
    v_out := edge_sync.accept_terminal_command(
      gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-0000000000a4',
      'e0000000-0000-4000-8000-000000000020',
      'kl1.e0000000-0000-4000-8000-000000000020.5555',
      encode(sha256('probe'), 'hex'), 'probe.command', 'booking');
    raise exception 'ASSERT FAIL: a cross-Location command was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%EDGE_SCOPE_MISMATCH%' then
      raise exception 'ASSERT FAIL: expected EDGE_SCOPE_MISMATCH, got %', sqlerrm;
    end if;
    v_hits := v_hits + 1;
  end;

  -- (d) a lower unknown terminal sequence is a replay rejection (offline §19).
  begin
    v_out := edge_sync.accept_terminal_command(
      gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
      'e0000000-0000-4000-8000-000000000020',
      'kl1.e0000000-0000-4000-8000-000000000020.500',
      encode(sha256('probe'), 'hex'), 'probe.command', 'booking', null, 500);
    raise exception 'ASSERT FAIL: a stale terminal sequence was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%EDGE_SEQUENCE_REPLAY_REJECTED%' then
      raise exception 'ASSERT FAIL: expected EDGE_SEQUENCE_REPLAY_REJECTED, got %', sqlerrm;
    end if;
    v_hits := v_hits + 1;
  end;

  -- (e) a higher sequence with a gap is refused, not silently accepted.
  begin
    v_out := edge_sync.accept_terminal_command(
      gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
      'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
      'e0000000-0000-4000-8000-000000000020',
      'kl1.e0000000-0000-4000-8000-000000000020.9000',
      encode(sha256('probe'), 'hex'), 'probe.command', 'booking', null, 9000);
    raise exception 'ASSERT FAIL: a terminal sequence gap was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%EDGE_SEQUENCE_GAP%' then
      raise exception 'ASSERT FAIL: expected EDGE_SEQUENCE_GAP, got %', sqlerrm;
    end if;
    v_hits := v_hits + 1;
  end;

  if v_hits <> 5 then
    raise exception 'ASSERT FAIL: expected 5 acceptance-algorithm outcomes, got %', v_hits;
  end if;
  raise notice 'PASS acceptance-algorithm: duplicate returns the stored result; payload mismatch, scope mismatch, replay and sequence gap are all refused (offline §4/§19)';
end $$;

-- ---------------------------------------------------------------------------
-- 24. Fixture personas required by WS-09 (§12 acceptance test 9 and the
--     canonical dotted logical profiles, KLD-2026-07-26-002 Group 2).
-- ---------------------------------------------------------------------------
do $$
declare
  p text;
  v_count int;
begin
  foreach p in array array['laundry.t1.intake_cashier', 'laundry.t2.customer_display',
                           'laundry.t3.ready_scan_in', 'laundry.t4.pickup_scan_out'] loop
    if not exists (select 1 from edge_config.terminal_profile_assignment where profile_code = p and enabled) then
      raise exception 'ASSERT FAIL: no enabled terminal profile assignment for the canonical profile %', p;
    end if;
    if not exists (select 1 from edge_identity.terminal_session where profile_code = p) then
      raise exception 'ASSERT FAIL: no terminal session for the canonical profile %', p;
    end if;
  end loop;
  -- No legacy three-terminal or underscore form may appear (repository rule 10).
  if exists (
    select 1 from edge_config.terminal_profile_assignment
    where profile_code !~ '^laundry\.t[1-4]\.[a-z_]+$'
  ) then
    raise exception 'ASSERT FAIL: a non-canonical logical profile code is assigned';
  end if;

  if not exists (select 1 from edge_identity.staff_cache
                 where disabled and cardinality(profile_codes) = 0) then
    raise exception 'ASSERT FAIL: the unauthorized-actor persona is missing';
  end if;
  if not exists (select 1 from edge_identity.terminal_device where lifecycle_status = 'revoked') then
    raise exception 'ASSERT FAIL: the revoked-device persona is missing';
  end if;
  if not exists (select 1 from edge_identity.device_credential
                 where status = 'revoked' and revoked_at is not null and revocation_reason is not null) then
    raise exception 'ASSERT FAIL: the revoked-credential persona is missing';
  end if;

  -- Cross-Tenant and cross-Location attacker rows.
  if not exists (select 1 from edge_laundry.booking
                 where tenant_id <> 'e0000000-0000-4000-8000-000000000001') then
    raise exception 'ASSERT FAIL: the cross-Tenant attacker row is missing';
  end if;
  if not exists (select 1 from edge_laundry.booking
                 where tenant_id = 'e0000000-0000-4000-8000-000000000001'
                   and location_id <> 'e0000000-0000-4000-8000-000000000003') then
    raise exception 'ASSERT FAIL: the cross-Location attacker row is missing';
  end if;

  -- Duplicate-command and stale-command fixtures.
  if not exists (select 1 from edge_sync.command_result
                 where commit_status = 'committed' and cardinality(event_ids) > 0) then
    raise exception 'ASSERT FAIL: the duplicate-command fixture is missing';
  end if;
  select count(*) into v_count from edge_sync.command_result
  where commit_status = 'rejected'
    and error_code in ('EDGE_SEQUENCE_REPLAY_REJECTED', 'EDGE_AGGREGATE_VERSION_CONFLICT');
  if v_count < 2 then
    raise exception 'ASSERT FAIL: the stale-command fixtures are missing (found %)', v_count;
  end if;

  -- Payment personas.
  if not exists (select 1 from edge_payments.payment where state = 'pending' and confirmed_at is null) then
    raise exception 'ASSERT FAIL: the pending-payment persona is missing';
  end if;
  if not exists (select 1 from edge_payments.payment where state = 'confirmed' and confirmed_at is not null) then
    raise exception 'ASSERT FAIL: the confirmed-payment persona is missing';
  end if;
  if not exists (select 1 from edge_payments.refund_adjustment where adjustment_type = 'refund') then
    raise exception 'ASSERT FAIL: the refund-adjustment persona is missing';
  end if;

  raise notice 'PASS fixtures: canonical T1-T4 dotted profiles, unauthorized actor, revoked device+credential, cross-Tenant and cross-Location attacker rows, duplicate/stale commands, pending+confirmed payment and refund all present';
end $$;

-- ---------------------------------------------------------------------------
-- 25. Hashes are lowercase-hex SHA-256 char(64) (§1).
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select table_schema, table_name, column_name, data_type, character_maximum_length
    from information_schema.columns
    where table_schema like 'edge\_%'
      and (column_name like '%sha256%' or column_name like '%\_hash'
           or column_name in ('root_key_fingerprint', 'public_key_fingerprint'))
  loop
    if r.data_type <> 'character' or r.character_maximum_length <> 64 then
      raise exception 'ASSERT FAIL: hash column %.%.% is %(%) but §1 requires char(64)',
        r.table_schema, r.table_name, r.column_name, r.data_type, r.character_maximum_length;
    end if;
    v_count := v_count + 1;
  end loop;
  raise notice 'PASS hashes: all % hash/fingerprint column(s) are char(64) lowercase-hex SHA-256 (§1)', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 26. Migration journal is checksum-registered (§4; gap G6).
-- ---------------------------------------------------------------------------
do $$
declare
  v_count int;
  v_bad int;
begin
  if to_regclass('edge_ops.migration_journal') is null then
    raise exception 'ASSERT FAIL: edge_ops.migration_journal is missing (§4 checksum registry)';
  end if;
  select count(*) into v_count from edge_ops.migration_journal;
  if v_count < 15 then
    raise exception 'ASSERT FAIL: only % migration(s) journalled; the canonical §4 set has 15 files', v_count;
  end if;
  select count(*) into v_bad from edge_ops.migration_journal
  where checksum_sha256 !~ '^[0-9a-f]{64}$';
  if v_bad > 0 then
    raise exception 'ASSERT FAIL: % journal row(s) have a malformed checksum', v_bad;
  end if;
  raise notice 'PASS migration-journal: % migration(s) journalled with lowercase-hex sha256 checksums (§4 "an applied file is never edited")', v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 27. Print duplicate-suppression key format (offline §11.1).
-- ---------------------------------------------------------------------------
do $$
begin
  if not edge_documents.is_canonical_suppression_key(
       'print1.e0000000-0000-4000-8000-0000000000a0.3.e0000000-0000-4000-8000-000000000059.1') then
    raise exception 'ASSERT FAIL: the canonical print1 suppression key was rejected';
  end if;
  if edge_documents.is_canonical_suppression_key('receipt-1-copy-1') then
    raise exception 'ASSERT FAIL: a non-canonical suppression key was accepted';
  end if;
  begin
    insert into edge_documents.print_job
      (id, tenant_id, digital_store_id, location_id, document_type, document_id,
       printer_binding_id, template_version, payload_sha256, copies,
       duplicate_suppression_key, state, priority, created_at, next_attempt_at,
       attempt_count, created_by, terminal_device_id)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'payment_receipt', 'e0000000-0000-4000-8000-0000000000a0',
       'e0000000-0000-4000-8000-000000000059', 3, encode(sha256('probe'), 'hex'), 1,
       'receipt-probe-copy-1', 'queued', 0, now(), now(), 0,
       'e0000000-0000-4000-8000-000000000040', 'e0000000-0000-4000-8000-000000000020');
    raise exception 'ASSERT FAIL: print_job accepted a non-canonical suppression key';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;
  raise notice 'PASS print-suppression: print1.{document_id}.{document_version}.{printer_binding_id}.{copy_index} enforced (offline §11.1)';
end $$;

-- ---------------------------------------------------------------------------
-- 28. Single-active invariants stated in prose by §6.1/§6.2.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
begin
  begin
    insert into edge_identity.hub_assignment
      (id, hub_device_id, tenant_id, digital_store_id, location_id, assignment_generation,
       assigned_at, status, operational_cert_serial)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000010',
       'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-0000000000a4', 2, now(), 'active', 'PROBE-CERT');
    raise exception 'ASSERT FAIL: a Hub received a second ACTIVE assignment';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    update edge_config.configuration_snapshot set state = 'active'
    where id = 'e0000000-0000-4000-8000-000000000051';
    raise exception 'ASSERT FAIL: a Location received a second ACTIVE configuration snapshot';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if (select count(*) from edge_config.active_configuration
      where location_id = 'e0000000-0000-4000-8000-000000000003') <> 1 then
    raise exception 'ASSERT FAIL: the active-configuration view does not expose exactly one snapshot (§6.2)';
  end if;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 blocked single-active violations, got %', v_blocked;
  end if;
  raise notice 'PASS single-active: one active assignment per Hub, one active snapshot per Location, and the active-configuration view exposes exactly one';
end $$;

-- ---------------------------------------------------------------------------
-- 29a. WS-10 delivery/conflict dimension governance (migration 0015; owner
--      amendment KLD-2026-07-28-001-A01 §2-§5).
--
--      Runs inside an explicit transaction that is ROLLED BACK: unlike the
--      negative probes above, these assertions must COMMIT real state changes
--      to observe the governed transitions, and the assertion suite never
--      leaves residue behind.
-- ---------------------------------------------------------------------------
begin;

-- The governed conflict procedures are granted to kitluy_hub_runtime, which is
-- the role that calls them in production. The harness assumes it here so this
-- section exercises the real grant surface rather than the connecting user's.
set local role kitluy_hub_runtime;

do $$
declare
  v_conflict  uuid := 'e0000000-0000-4000-8000-00000000c001';
  v_conflict2 uuid := 'e0000000-0000-4000-8000-00000000c002';
  v_event     uuid := 'e0000000-0000-4000-8000-0000000000d2';  -- seeded, pending
  v_resolve   uuid := 'e0000000-0000-4000-8000-0000000000d1';  -- seeded local_event
  v_tenant    uuid := 'e0000000-0000-4000-8000-000000000001';
  v_store     uuid := 'e0000000-0000-4000-8000-000000000002';
  v_location  uuid := 'e0000000-0000-4000-8000-000000000003';
  v_blocked   int  := 0;
  v_row       edge_sync.outbox%rowtype;
  v_status    text;
begin
  insert into edge_sync.sync_conflict
    (id, tenant_id, digital_store_id, location_id, conflict_type, data_class,
     local_event_id, detected_at, state, severity)
  values
    (v_conflict, v_tenant, v_store, v_location, 'cloud_effect_divergence',
     'finance_payment', v_event, now(), 'operator_required', 'high'),
    (v_conflict2, v_tenant, v_store, v_location, 'cloud_effect_divergence',
     'finance_payment', v_event, now(), 'operator_required', 'high');

  -- (a) The conflict dimension is GOVERNED-ONLY: a bare UPDATE — exactly what
  --     a delivery worker holds the grant to issue — is refused (§5).
  begin
    update edge_sync.outbox set reconciliation_state = 'required' where event_id = v_event;
    raise exception 'ASSERT FAIL: a bare UPDATE moved the conflict dimension';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RECONCILIATION-GOVERNED%' then
      raise exception 'ASSERT FAIL: expected KLUY-EDGE-RECONCILIATION-GOVERNED, got %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- (b) A flag without a named divergence is not evidence.
  begin
    perform edge_sync.raise_reconciliation(v_event, gen_random_uuid(), 'unknown conflict');
    raise exception 'ASSERT FAIL: reconciliation was raised against a non-existent conflict';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform edge_sync.raise_reconciliation(v_event, v_conflict, '   ');
    raise exception 'ASSERT FAIL: reconciliation was raised without a reason';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- (c) The governed raise succeeds and leaves delivery_state UNTOUCHED (§3).
  perform edge_sync.raise_reconciliation(v_event, v_conflict,
    'cloud reported a different applied amount for this payment effect');
  select * into v_row from edge_sync.outbox where event_id = v_event;
  if v_row.reconciliation_state <> 'required' then
    raise exception 'ASSERT FAIL: governed raise did not set reconciliation_state';
  end if;
  if v_row.delivery_state <> 'pending' then
    raise exception 'ASSERT FAIL: raising a conflict changed delivery_state to %', v_row.delivery_state;
  end if;

  -- (d) CONFLICT OVERRIDE FIRST (§4): the external projection reports
  --     reconciliation_required even though delivery_state is still pending.
  select external_status into v_status from edge_sync.outbox_status where event_id = v_event;
  if v_status <> 'reconciliation_required' then
    raise exception 'ASSERT FAIL: conflict override did not win; external status is %', v_status;
  end if;

  -- (e) and (f) CHANGED BY RV-001 (migration 0024), and the change is the
  --     point. These probes used to SET THE GOVERNED MARKER THEMSELVES and then
  --     check that the deeper rules fired. That they COULD set it was the
  --     vulnerability: the 0015 gate was a custom GUC and any role could set it
  --     with set_config(). 0024 makes the gate the EXECUTING IDENTITY, so a bare
  --     UPDATE is now refused at the door — before the dimension-independence
  --     and not-discardable checks are reached. The probes assert that stronger
  --     outcome. Those deeper branches stay in the trigger as defence-in-depth
  --     against a future governed procedure that misbehaves, and are no longer
  --     reachable from outside one — which is why nothing here exercises them.
  -- The row is first moved onto a LEGAL delivery path (0026 §6 guard), so the
  -- probe below fails on the GOVERNED check rather than on transition legality.
  update edge_sync.outbox
     set delivery_state = 'in_flight', lease_id = gen_random_uuid(), lease_owner = 'assert',
         leased_at = now(), lease_expires_at = now() + interval '5 minutes'
   where event_id = v_event;

  begin
    perform set_config('kitluy.reconciliation_governed', 'on', true);
    update edge_sync.outbox
       set delivery_state = 'retry_wait', lease_id = null, lease_owner = null,
           leased_at = null, lease_expires_at = null,
           reconciliation_raised_reason = 'smuggled'
     where event_id = v_event;
    raise exception 'ASSERT FAIL: a self-set marker still moved both state dimensions';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RECONCILIATION-GOVERNED%' then
      raise exception 'ASSERT FAIL: expected KLUY-EDGE-RECONCILIATION-GOVERNED, got %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform set_config('kitluy.reconciliation_governed', 'on', true);
    update edge_sync.outbox
       set reconciliation_state = 'none', reconciliation_conflict_id = null,
           reconciliation_raised_at = null, reconciliation_raised_reason = null
     where event_id = v_event;
    raise exception 'ASSERT FAIL: a self-set marker still discarded a raised reconciliation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RECONCILIATION-GOVERNED%' then
      raise exception 'ASSERT FAIL: expected KLUY-EDGE-RECONCILIATION-GOVERNED, got %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  perform set_config('kitluy.reconciliation_governed', 'off', true);

  -- (g) Clearing demands an authority, a reason AND correlation to the repair
  --     or compensating action (§5). Each omission is refused separately.
  begin
    perform edge_sync.clear_reconciliation(v_event, null, null, 'reason', v_resolve);
    raise exception 'ASSERT FAIL: reconciliation was cleared without an authority';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform edge_sync.clear_reconciliation(v_event, null, 'operator:supervisor', '  ', v_resolve);
    raise exception 'ASSERT FAIL: reconciliation was cleared without a reason';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform edge_sync.clear_reconciliation(v_event, null, 'operator:supervisor', 'reason', null);
    raise exception 'ASSERT FAIL: reconciliation was cleared without a correlated repair';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- (h) A governed clearance succeeds, records its evidence, and returns the
  --     external projection to the delivery dimension.
  perform edge_sync.clear_reconciliation(
    v_event, v_tenant, 'operator:shift_supervisor',
    'compensating payment adjustment recorded and matched to the cloud effect', v_resolve);
  select * into v_row from edge_sync.outbox where event_id = v_event;
  if v_row.reconciliation_state <> 'cleared'
     or v_row.reconciliation_cleared_at is null
     or v_row.reconciliation_cleared_authority is null
     or v_row.reconciliation_clearing_reason is null
     or v_row.reconciliation_clearing_event_id is null then
    raise exception 'ASSERT FAIL: a cleared reconciliation is missing its evidence';
  end if;
  -- After clearance the projection follows the DELIVERY dimension again. The row
  -- is in_flight at this point, so §3 maps it to sync_in_progress — the value is
  -- read from the shared projection rather than hard-coded, so this assertion
  -- checks the HANDOVER between dimensions rather than restating the §3 table
  -- (29e owns that).
  select external_status into v_status from edge_sync.outbox_status where event_id = v_event;
  if v_status <> edge_sync.external_sync_status(
       (select delivery_state from edge_sync.outbox where event_id = v_event), 'none') then
    raise exception 'ASSERT FAIL: after clearance the projection should follow delivery state, got %', v_status;
  end if;
  if v_status = 'reconciliation_required' then
    raise exception 'ASSERT FAIL: a cleared reconciliation still reports reconciliation_required';
  end if;

  -- (i) Re-raising after clearance needs a NEW conflict record, not the
  --     already-resolved one.
  begin
    perform edge_sync.raise_reconciliation(v_event, v_conflict, 'same conflict again');
    raise exception 'ASSERT FAIL: a resolved conflict was reused to re-raise';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RECONCILIATION-STALE-CONFLICT%' then
      raise exception 'ASSERT FAIL: expected KLUY-EDGE-RECONCILIATION-STALE-CONFLICT, got %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  perform edge_sync.raise_reconciliation(v_event, v_conflict2, 'a genuinely new divergence');

  -- (j) `rejected` is a DURABLE CLOUD VERDICT (§2): it can never be recorded
  --     without the cloud error code and the moment it was recorded.
  begin
    update edge_sync.outbox set delivery_state = 'rejected' where event_id = v_event;
    raise exception 'ASSERT FAIL: delivery_state=rejected was accepted with no cloud error code';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- (k) A pure delivery-state move still works and leaves the conflict
  --     dimension exactly where it was. `retry_wait` is used rather than
  --     `in_flight` because 0016 makes in_flight inseparable from a lease —
  --     that pairing has its own coverage in the leasing suite.
  update edge_sync.outbox
     set delivery_state = 'retry_wait', attempt_count = attempt_count + 1,
         last_attempt_at = now(), next_attempt_at = now() + interval '1 minute',
         lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null
   where event_id = v_event;
  select * into v_row from edge_sync.outbox where event_id = v_event;
  if v_row.reconciliation_state <> 'required' then
    raise exception 'ASSERT FAIL: a delivery-state move disturbed the conflict dimension';
  end if;

  if v_blocked <> 10 then
    raise exception 'ASSERT FAIL: expected 10 blocked dimension violations, got %', v_blocked;
  end if;
  raise notice 'PASS state-dimensions: delivery and conflict states transition independently; a delivery worker cannot clear reconciliation_required; clearing demands authority, reason and correlation; conflict override wins the external projection';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 29c. No PUBLIC EXECUTE on a privileged Hub procedure (migration 0020).
--
--      PostgreSQL grants EXECUTE to PUBLIC on every function at creation, and
--      a later GRANT to a named role does NOT revoke it. Without this
--      assertion, adding a procedure silently makes it callable by every role
--      in the cluster — which is how amendment §5's "a delivery worker must NOT
--      independently clear reconciliation_required" was, for one migration,
--      enforced only by the worker not choosing to call the procedure.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_leaked text[] := '{}';
  v_checked int := 0;
begin
  for r in
    select n.nspname as schema_name, p.proname as proc_name, p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname like 'edge\_%'
      -- Trigger functions are reachable only through their triggers.
      and p.prorettype <> 'trigger'::regtype
  loop
    v_checked := v_checked + 1;
    if has_function_privilege('public', r.oid, 'execute') then
      v_leaked := v_leaked || format('%s.%s', r.schema_name, r.proc_name);
    end if;
  end loop;

  if array_length(v_leaked, 1) is not null then
    raise exception
      'ASSERT FAIL: % Hub procedure(s) are EXECUTE-able by PUBLIC: %',
      array_length(v_leaked, 1), array_to_string(v_leaked, ', ');
  end if;

  -- The §5 asymmetry, asserted directly: the delivery worker may RAISE a
  -- conflict and may NOT clear one.
  if not has_function_privilege('kitluy_sync_worker',
        'edge_sync.raise_reconciliation(uuid,uuid,text)', 'execute') then
    raise exception 'ASSERT FAIL: the sync worker cannot raise a conflict it observes';
  end if;
  if has_function_privilege('kitluy_sync_worker',
        'edge_sync.clear_reconciliation(uuid,uuid,text,text,uuid)', 'execute') then
    raise exception
      'ASSERT FAIL: the sync worker can clear a reconciliation (KLD-2026-07-28-001-A01 §5)';
  end if;
  if not has_function_privilege('kitluy_hub_runtime',
        'edge_sync.clear_reconciliation(uuid,uuid,text,text,uuid)', 'execute') then
    raise exception 'ASSERT FAIL: the Hub runtime cannot clear a reconciliation';
  end if;

  -- RV-001 (independent review 2026-07-28). The 0015 gate was a custom GUC that
  -- ANY role could set with set_config(), so the §5 rule was not enforced at
  -- all. 0024 moved the gate to the EXECUTING IDENTITY. Assert the mechanism
  -- itself, because a grant table alone cannot express it.
  if not exists (select 1 from pg_roles where rolname = 'kitluy_reconciliation_governor') then
    raise exception 'ASSERT FAIL: the governor role that makes the §5 gate unforgeable is missing (RV-001)';
  end if;
  if exists (select 1 from pg_roles where rolname = 'kitluy_reconciliation_governor' and rolcanlogin) then
    raise exception 'ASSERT FAIL: kitluy_reconciliation_governor can log in; it must be NOLOGIN (RV-001)';
  end if;
  if exists (
    select 1 from pg_auth_members m join pg_roles gr on gr.oid = m.roleid
    where gr.rolname = 'kitluy_reconciliation_governor'
  ) then
    raise exception
      'ASSERT FAIL: kitluy_reconciliation_governor has members; anyone who can SET ROLE to it can forge the §5 gate (RV-001)';
  end if;
  for r in
    select p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'edge_sync'
      and p.proname in ('raise_reconciliation', 'clear_reconciliation')
  loop
    if not r.prosecdef then
      raise exception 'ASSERT FAIL: edge_sync.% is not SECURITY DEFINER, so it cannot produce the governed identity (RV-001)', r.proname;
    end if;
    if r.owner <> 'kitluy_reconciliation_governor' then
      raise exception 'ASSERT FAIL: edge_sync.% is owned by %, not the governor role (RV-001)', r.proname, r.owner;
    end if;
  end loop;

  raise notice 'PASS procedure-privileges: none of the % edge_* procedures is EXECUTE-able by PUBLIC; the sync worker may raise a conflict but not clear one; the §5 gate is the executing identity of a NOLOGIN, memberless governor role and both governed procedures are SECURITY DEFINER owned by it', v_checked;
end $$;

-- ---------------------------------------------------------------------------
-- 29d. Grant resolution: DENY wins across the whole scope chain (RV-002).
--
--      The 0022 resolver compared only the exact (scope_type, scope_id) tuple,
--      so a deny at Digital Store scope was invisible when resolving at
--      Location scope and a narrow allow won. 0024 walks the chain.
-- ---------------------------------------------------------------------------
begin;

do $$
declare
  v_snapshot uuid := 'e0000000-0000-4000-8000-0000000000f1';
  v_actor    uuid := 'e0000000-0000-4000-8000-0000000000f2';
  v_tenant   uuid := 'e0000000-0000-4000-8000-000000000001';
  v_store    uuid := 'e0000000-0000-4000-8000-000000000002';
  v_location uuid := 'e0000000-0000-4000-8000-000000000003';
  v_decision text;
begin
  insert into edge_config.configuration_snapshot
    (id, tenant_id, digital_store_id, location_id, snapshot_version, schema_version, created_at,
     not_before, minimum_hub_version, manifest_sha256, signature_algorithm, signature,
     signing_key_id, state, downloaded_at)
  values (v_snapshot, v_tenant, v_store, v_location, 999999, 1, now(), now() - interval '1 hour',
          '0.1.0', repeat('a', 64), 'assert', decode('beef', 'hex'), 'assert-key', 'verified', now());

  insert into edge_config.permission_grant_projection
    (id, tenant_id, digital_store_id, location_id, source_snapshot_id, projection_version, actor_id,
     permission_key, effect, resource_type, scope_type, scope_id, environment,
     requires_reauthentication, requires_approval, requires_reason, granted_at, not_before,
     signature, signature_algorithm, signing_key_id, received_at)
  values
    (gen_random_uuid(), v_tenant, v_store, v_location, v_snapshot, 1, v_actor,
     'payments.refund.request', 'deny', 'payment', 'digital_store', v_store, 'all',
     false, true, true, now(), now() - interval '1 hour', decode('be', 'hex'), 'a', 'k', now()),
    (gen_random_uuid(), v_tenant, v_store, v_location, v_snapshot, 2, v_actor,
     'payments.refund.request', 'allow', 'payment', 'store_location', v_location, 'all',
     false, true, true, now(), now() - interval '1 hour', decode('be', 'hex'), 'a', 'k', now());

  v_decision := edge_config.resolve_permission_grant(
    v_tenant, v_store, v_location, v_actor, 'payments.refund.request',
    'store_location', v_location, true, now());
  if v_decision <> 'deny' then
    raise exception
      'ASSERT FAIL: a narrow allow defeated a broad deny (got %); deny must win across the scope chain (RV-002)',
      v_decision;
  end if;

  -- …and an unknown actor still fails closed.
  v_decision := edge_config.resolve_permission_grant(
    v_tenant, v_store, v_location, gen_random_uuid(), 'payments.refund.request',
    'store_location', v_location, true, now());
  if v_decision <> 'unknown' then
    raise exception 'ASSERT FAIL: an ungranted actor resolved to % instead of unknown', v_decision;
  end if;

  -- RV-013: a grant belonging to ANOTHER TENANT must not permit this one. The
  -- platform branch used to match unconditionally, so a platform-scoped allow
  -- carrying the attacker tenant's scope columns resolved to `allow` here.
  insert into edge_config.configuration_snapshot
    (id, tenant_id, digital_store_id, location_id, snapshot_version, schema_version, created_at,
     not_before, minimum_hub_version, manifest_sha256, signature_algorithm, signature,
     signing_key_id, state, downloaded_at)
  values ('e0000000-0000-4000-8000-0000000000f5', 'e0000000-0000-4000-8000-0000000000a1',
          'e0000000-0000-4000-8000-0000000000a2', v_location, 999998, 1, now(),
          now() - interval '1 hour', '0.1.0', repeat('a', 64), 'assert', decode('beef', 'hex'),
          'assert-key', 'verified', now());
  insert into edge_config.permission_grant_projection
    (id, tenant_id, digital_store_id, location_id, source_snapshot_id, projection_version, actor_id,
     permission_key, effect, resource_type, scope_type, scope_id, environment,
     requires_reauthentication, requires_approval, requires_reason, granted_at, not_before,
     signature, signature_algorithm, signing_key_id, received_at)
  values (gen_random_uuid(), 'e0000000-0000-4000-8000-0000000000a1',
          'e0000000-0000-4000-8000-0000000000a2', v_location,
          'e0000000-0000-4000-8000-0000000000f5', 1, 'e0000000-0000-4000-8000-0000000000f9',
          'payments.refund.request', 'allow', 'payment', 'platform', null, 'all',
          false, true, true, now(), now() - interval '1 hour', decode('be', 'hex'), 'a', 'k', now());

  v_decision := edge_config.resolve_permission_grant(
    v_tenant, v_store, v_location, 'e0000000-0000-4000-8000-0000000000f9',
    'payments.refund.request', 'store_location', v_location, true, now());
  if v_decision <> 'unknown' then
    raise exception
      'ASSERT FAIL: a grant belonging to ANOTHER TENANT resolved to % here (RV-013)', v_decision;
  end if;

  -- RV-014: a non-platform grant with no scope_id was silently unmatchable, so
  -- a DENY carrying one failed OPEN. It must now be unstorable.
  begin
    insert into edge_config.permission_grant_projection
      (id, tenant_id, digital_store_id, location_id, source_snapshot_id, projection_version,
       actor_id, permission_key, effect, resource_type, scope_type, scope_id, environment,
       requires_reauthentication, requires_approval, requires_reason, granted_at, not_before,
       signature, signature_algorithm, signing_key_id, received_at)
    values (gen_random_uuid(), v_tenant, v_store, v_location, v_snapshot, 9, v_actor,
            'payments.refund.request', 'deny', 'payment', 'tenant', null, 'all',
            false, true, true, now(), now() - interval '1 hour', decode('be', 'hex'), 'a', 'k', now());
    raise exception 'ASSERT FAIL: a non-platform grant with a NULL scope_id was accepted (RV-014)';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  raise notice 'PASS grant-scope-chain: a DENY at a broader scope beats a narrow ALLOW; a grant from another tenant permits nothing; a non-platform grant with no scope_id is unstorable; an ungranted actor still fails closed';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 29b. reconciliation_required is NOT a delivery state (amendment §3).
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'edge_sync' and t.typname = 'delivery_state'
      and e.enumlabel = 'reconciliation_required'
  ) then
    raise exception
      'ASSERT FAIL: reconciliation_required leaked into edge_sync.delivery_state; amendment §3 keeps it orthogonal';
  end if;

  -- The shared projection exists and is the ONLY mapping (§4).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'edge_sync' and p.proname = 'external_sync_status'
  ) then
    raise exception 'ASSERT FAIL: the shared external-status projection is missing (§4)';
  end if;

  -- Conflict override, exhaustively, over the whole cross product.
  if exists (
    select 1
    from unnest(enum_range(null::edge_sync.delivery_state)) d,
         unnest(enum_range(null::edge_sync.reconciliation_state)) r
    where r = 'required'
      and edge_sync.external_sync_status(d, r) <> 'reconciliation_required'
  ) then
    raise exception 'ASSERT FAIL: conflict override does not win for every delivery state (§4)';
  end if;

  -- The projection emits ONLY the amendment §3 vocabulary. An earlier version of
  -- this assertion listed the five-value COMMAND sync-state registry instead,
  -- which is a DIFFERENT subject (edge_sync.command_result.sync_state describes a
  -- COMMAND outcome). Enforcing the wrong list here is what let the §3 mapping
  -- ship collapsed.
  if exists (
    select 1
    from unnest(enum_range(null::edge_sync.delivery_state)) d,
         unnest(enum_range(null::edge_sync.reconciliation_state)) r
    where edge_sync.external_sync_status(d, r) not in
          ('pending_cloud_sync', 'sync_in_progress', 'retry_scheduled',
           'cloud_acknowledged', 'cloud_rejected', 'delivery_failed',
           'reconciliation_required')
  ) then
    raise exception 'ASSERT FAIL: the projection emitted a value outside the amendment §3 vocabulary';
  end if;

  raise notice 'PASS external-projection: reconciliation_required stays out of delivery_state, ONE shared mapping exists, conflict override wins for every delivery state, and every output is inside the amendment §3 vocabulary';
end $$;

-- ---------------------------------------------------------------------------
-- 29e. Amendment §3 projection and §6 transition legality.
--
--      The §3 table is reproduced VERBATIM here. An earlier implementation
--      collapsed in_flight/retry_wait into pending_cloud_sync and mapped
--      dead_letter to reconciliation_required; this assertion exists so that
--      divergence cannot recur silently.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_checked int := 0;
begin
  for r in
    select * from (values
      ('pending', 'pending_cloud_sync'),
      ('in_flight', 'sync_in_progress'),
      ('retry_wait', 'retry_scheduled'),
      ('acknowledged', 'cloud_acknowledged'),
      ('rejected', 'cloud_rejected'),
      ('dead_letter', 'delivery_failed')
    ) as x(delivery, expected)
  loop
    if edge_sync.external_sync_status(r.delivery::edge_sync.delivery_state, 'none') <> r.expected then
      raise exception 'ASSERT FAIL: §3 maps % to %, but the projection returned %',
        r.delivery, r.expected,
        edge_sync.external_sync_status(r.delivery::edge_sync.delivery_state, 'none');
    end if;
    -- §3 "First: conflict override" — for EVERY delivery state.
    if edge_sync.external_sync_status(r.delivery::edge_sync.delivery_state, 'required')
       <> 'reconciliation_required' then
      raise exception 'ASSERT FAIL: conflict override did not win for delivery state %', r.delivery;
    end if;
    v_checked := v_checked + 1;
  end loop;
  if v_checked <> 6 then
    raise exception 'ASSERT FAIL: expected the 6 §3 rows, checked %', v_checked;
  end if;

  -- §2 names `dead_letter + none` as a VALID combination. It must be reachable
  -- and must report delivery_failed, not reconciliation_required.
  if edge_sync.external_sync_status('dead_letter', 'none') <> 'delivery_failed' then
    raise exception 'ASSERT FAIL: dead_letter + none must report delivery_failed (§2, §3)';
  end if;

  raise notice 'PASS external-projection-table: the §3 six-value mapping is exact, conflict override wins for every delivery state, and dead_letter + none reports delivery_failed';
end $$;

begin;

do $$
declare
  v_event uuid := 'e0000000-0000-4000-8000-0000000000d2';
  v_blocked int := 0;
  r record;
begin
  -- §6 INVALID transitions must fail closed. Each is attempted for real.
  for r in
    select * from (values
      ('pending', 'acknowledged'),   -- no transmission attempt ever happened
      ('pending', 'rejected'),
      ('retry_wait', 'acknowledged') -- no NEW attempt; must pass through in_flight
    ) as x(from_state, to_state)
  loop
    begin
      update edge_sync.outbox set delivery_state = r.from_state::edge_sync.delivery_state,
             lease_id = null, lease_owner = null, leased_at = null, lease_expires_at = null
       where event_id = v_event;
      update edge_sync.outbox set delivery_state = r.to_state::edge_sync.delivery_state
       where event_id = v_event;
      raise exception 'ASSERT FAIL: % -> % was accepted', r.from_state, r.to_state;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      v_blocked := v_blocked + 1;
    end;
  end loop;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 refused §6 transitions, got %', v_blocked;
  end if;
  raise notice 'PASS delivery-transitions: pending/retry_wait cannot reach acknowledged or rejected without a transmission attempt, and acknowledged/rejected are terminal (§6)';
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- 30. Hub-terminal pairing authority (group 0031, WS-11-T004-P03B).
-- ---------------------------------------------------------------------------
-- Pairing is HUB-LOCAL authority: sessions, nonce consumption and the one
-- immutable Hub-signed receipt live here, governed by the NOLOGIN
-- kitluy_pairing_governor exactly as 0024 governs reconciliation. Nothing in
-- this section claims delivery to the terminal, persistence across restart,
-- or reachability — those are P03C.
do $$
declare
  v_count int;
begin
  -- The governor is NOLOGIN and granted to NOBODY: current_user can equal it
  -- only inside the doors it owns.
  if not exists (select 1 from pg_roles where rolname = 'kitluy_pairing_governor' and not rolcanlogin) then
    raise exception 'ASSERT FAIL: kitluy_pairing_governor is missing or can log in';
  end if;
  if exists (select 1 from pg_auth_members
              where roleid = (select oid from pg_roles where rolname = 'kitluy_pairing_governor')) then
    raise exception 'ASSERT FAIL: somebody is a member of kitluy_pairing_governor';
  end if;

  -- The three doors are governor-owned; the prerequisite helper stays
  -- governor-only; PUBLIC holds none of them (the §29c gate re-proves this
  -- globally); the runtime can call exactly the doors.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity'
     and p.proname in ('begin_terminal_pairing_v1', 'record_terminal_pairing_proof_v1',
                       'complete_terminal_pairing_v1', 'assert_pairing_prerequisites_v1')
     and p.proowner = (select oid from pg_roles where rolname = 'kitluy_pairing_governor');
  if v_count <> 4 then
    raise exception 'ASSERT FAIL: expected 4 governor-owned pairing functions, found %', v_count;
  end if;
  if not has_function_privilege('kitluy_hub_runtime',
       'edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)', 'execute')
     or not has_function_privilege('kitluy_hub_runtime',
       'edge_identity.record_terminal_pairing_proof_v1(uuid, boolean, uuid)', 'execute')
     or not has_function_privilege('kitluy_hub_runtime',
       'edge_identity.complete_terminal_pairing_v1(uuid, text, uuid, text, text, timestamptz, uuid)', 'execute') then
    raise exception 'ASSERT FAIL: kitluy_hub_runtime cannot execute a pairing door';
  end if;
  if has_function_privilege('kitluy_hub_runtime',
       'edge_identity.assert_pairing_prerequisites_v1(edge_identity.pairing_session)', 'execute')
     or has_function_privilege('kitluy_sync_worker',
       'edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)', 'execute')
     or has_function_privilege('kitluy_support_ro',
       'edge_identity.begin_terminal_pairing_v1(uuid, uuid, text, text, text, text, text, timestamptz, uuid)', 'execute') then
    raise exception 'ASSERT FAIL: a pairing capability leaked beyond the runtime boundary';
  end if;

  -- Direct and EFFECTIVE table posture: the runtime reads, nobody but the
  -- governor writes, the sync worker and support see nothing.
  if has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_session', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_receipt', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_sync_worker', 'edge_identity.pairing_session', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_sync_worker', 'edge_identity.pairing_receipt', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_support_ro', 'edge_identity.pairing_session', 'SELECT')
     or has_table_privilege('kitluy_support_ro', 'edge_identity.pairing_receipt', 'SELECT')
     or not has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_session', 'SELECT')
     or not has_table_privilege('kitluy_hub_runtime', 'edge_identity.pairing_receipt', 'SELECT') then
    raise exception 'ASSERT FAIL: the pairing table privilege posture is wrong';
  end if;

  -- The invariants the protocol demands are STRUCTURAL: single-use nonces
  -- across ALL sessions, one live handshake per terminal, one receipt per
  -- session, and the governance triggers on both relations.
  if not exists (select 1 from pg_indexes where indexname = 'pairing_session_terminal_nonce_uq')
     or not exists (select 1 from pg_indexes where indexname = 'pairing_session_hub_nonce_uq')
     or not exists (select 1 from pg_indexes where indexname = 'pairing_session_active_uq')
     or not exists (select 1 from pg_constraint where conname = 'pairing_receipt_session_uq') then
    raise exception 'ASSERT FAIL: a pairing uniqueness invariant is missing';
  end if;
  select count(*) into v_count from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'edge_identity' and not t.tgisinternal
     and t.tgname in ('pairing_session_governance', 'pairing_receipt_governance');
  if v_count <> 2 then
    raise exception 'ASSERT FAIL: expected both pairing governance triggers, found %', v_count;
  end if;

  -- No secret-shaped column: no private key, password, secret or raw
  -- provisioning code anywhere on the pairing relations.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'edge_identity'
       and table_name in ('pairing_session', 'pairing_receipt')
       and (column_name like '%private%' or column_name like '%password%'
            or column_name like '%secret%' or column_name like '%provisioning_code%')) then
    raise exception 'ASSERT FAIL: a secret-shaped column exists on a pairing relation';
  end if;

  raise notice 'PASS pairing-authority: the governor is NOLOGIN with zero members and owns all four pairing functions; the runtime holds exactly the three doors plus SELECT; sync worker and support hold nothing; nonces, live-handshake and receipt uniqueness are structural; both governance triggers exist; no secret-shaped column';
end $$;

-- Runtime probes: the boundary refuses what the catalog says it refuses.
begin;
set local role kitluy_hub_runtime;
do $$
declare
  v_blocked int := 0;
begin
  -- Direct INSERT into pairing_session is refused for the runtime.
  begin
    insert into edge_identity.pairing_session
      (id, protocol_version, purpose, tenant_id, digital_store_id, location_id,
       environment, hub_device_id, hub_assignment_id, hub_assignment_generation,
       hub_credential_id, hub_certificate_serial, hub_certificate_fingerprint,
       terminal_device_id, terminal_assignment_generation, terminal_profile_code,
       terminal_credential_id, terminal_certificate_serial,
       terminal_certificate_fingerprint, terminal_nonce, hub_nonce, state,
       correlation_id, expires_at)
    values
      (gen_random_uuid(), '1.0', 'hub_terminal_pairing',
       'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003', 'development',
       'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000012', 1,
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('a', 64),
       'e0000000-0000-4000-8000-000000000020', 1, 'laundry.t1.intake_cashier',
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('b', 64),
       repeat('c', 64), repeat('d', 64), 'challenge_issued', gen_random_uuid(),
       now() + interval '10 minutes');
    raise exception 'ASSERT FAIL: the runtime inserted a pairing session directly';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- A wrong protocol version is refused by its exact sentinel.
  begin
    perform edge_identity.begin_terminal_pairing_v1(
      gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
      'laundry.t1.intake_cashier', repeat('a', 64), repeat('b', 64),
      '9.9', 'development', now() + interval '10 minutes', gen_random_uuid());
    raise exception 'ASSERT FAIL: an incompatible protocol version began a pairing session';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-PAIRING-VERSION-INCOMPATIBLE%' then
      raise exception 'ASSERT FAIL: wrong-version refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- An unknown session cannot record a proof.
  begin
    perform edge_identity.record_terminal_pairing_proof_v1(gen_random_uuid(), true, gen_random_uuid());
    raise exception 'ASSERT FAIL: a proof was recorded for a session that does not exist';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-PAIRING-SESSION-UNKNOWN%' then
      raise exception 'ASSERT FAIL: unknown-session refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 refused pairing probes, got %', v_blocked;
  end if;
  raise notice 'PASS pairing-runtime-boundary: the runtime cannot write pairing state directly, and the doors refuse a wrong version and an unknown session with their exact sentinels';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 31. WS-11-T005 — local terminal health authority (hub group 0035).
-- ---------------------------------------------------------------------------
begin;
set local role kitluy_hub_runtime;
do $$
declare
  v_blocked int := 0;
begin
  -- The runtime derives and maintains the CURRENT local status.
  insert into edge_hardware.terminal_health_status
    (terminal_device_id, tenant_id, digital_store_id, location_id,
     derived_state, health_reasons, last_heartbeat_at, heartbeat_count,
     software_version, derived_at, updated_at)
  values
    ('e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'healthy', array['heartbeat_fresh'], now(), 42, '1.0.0', now(), now());

  update edge_hardware.terminal_health_status
  set derived_state = 'unknown', health_reasons = array['no_valid_observation'],
      updated_at = now()
  where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';

  -- unknown stays DISTINCT from offline_local: both are legal, neither implies
  -- the other, and an illegal collapsed value is refused by the CHECK.
  begin
    update edge_hardware.terminal_health_status
    set derived_state = 'stale'
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: a non-canonical derived_state was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- Local health is superseded, never erased. TWO layers refuse: the runtime
  -- holds no DELETE grant at all, and the trigger refuses even a superuser.
  begin
    delete from edge_hardware.terminal_health_status
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: a terminal health row was deleted by the runtime';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'ASSERT FAIL: the runtime holds an unexpected DELETE path: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  reset role;
  begin
    delete from edge_hardware.terminal_health_status
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: a terminal health row was deleted past the trigger';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-HEALTH-NO-DELETE%' then
      raise exception 'ASSERT FAIL: health delete refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 refused health probes, got %', v_blocked;
  end if;
  raise notice 'PASS terminal-health-authority: the runtime maintains the current local status, unknown stays distinct from offline_local, non-canonical states are refused, and health rows cannot be deleted';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 32. WS-11-T005 — containment directives enforced locally (hub group 0035).
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_blocked int := 0;
  v_session uuid := gen_random_uuid();
begin
  -- The sync path records a received quarantine decision (sequence 1).
  set local role kitluy_sync_worker;
  insert into edge_identity.containment_directive
    (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
     directive_sequence, reason, source_ref, received_via, received_at)
  values
    (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'quarantined', 1, 'containment probe', 'cloud-correlation-1',
     'cloud_inbox', now());

  -- A REPLAYED directive (same device, same sequence) collides instead of
  -- applying twice.
  begin
    insert into edge_identity.containment_directive
      (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
       directive_sequence, reason, source_ref, received_via, received_at)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
       'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003',
       'quarantined', 1, 'replayed probe', 'cloud-correlation-1-replayed',
       'cloud_inbox', now());
    raise exception 'ASSERT FAIL: a replayed containment directive was applied twice';
  exception
    when unique_violation then
      v_blocked := v_blocked + 1;
    when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      raise exception 'ASSERT FAIL: replay refusal used % instead of the dedupe pair', sqlerrm;
  end;

  -- Received directives are append-only evidence. TWO layers refuse: the sync
  -- worker holds no UPDATE grant, and the trigger refuses even a superuser.
  begin
    update edge_identity.containment_directive
    set reason = 'rewritten'
    where device_uuid = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: a containment directive was rewritten by the sync worker';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'ASSERT FAIL: the sync worker holds an unexpected UPDATE path: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  reset role;
  begin
    update edge_identity.containment_directive
    set reason = 'rewritten'
    where device_uuid = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: a containment directive was rewritten past the trigger';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-APPEND-ONLY%' then
      raise exception 'ASSERT FAIL: directive rewrite refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Enforcement is LOCAL: with the directive on disk (and no cloud in this
  -- transaction at all), the contained terminal can neither open an
  -- authorization session nor a pairing session.
  set local role kitluy_hub_runtime;
  begin
    insert into edge_identity.terminal_session
      (id, tenant_id, digital_store_id, location_id, terminal_device_id,
       actor_id, profile_code, opened_at, expires_at, session_generation,
       last_event_sequence, status)
    values
      (v_session, 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003',
       'e0000000-0000-4000-8000-000000000020', gen_random_uuid(),
       'laundry.t4.pickup_scan_out', now(), now() + interval '8 hours', 99, 0,
       'active');
    raise exception 'ASSERT FAIL: a quarantined terminal opened a session';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-TERMINAL-CONTAINED%' then
      raise exception 'ASSERT FAIL: contained-session refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  -- The pairing gate: the runtime cannot insert pairing rows AT ALL (0031
  -- grant boundary), so the containment gate is probed as the harness
  -- superuser — trigger order puts the containment gate BEFORE governance,
  -- so the containment sentinel is the one that must fire.
  reset role;
  begin
    insert into edge_identity.pairing_session
      (id, protocol_version, purpose, tenant_id, digital_store_id, location_id,
       environment, hub_device_id, hub_assignment_id, hub_assignment_generation,
       hub_credential_id, hub_certificate_serial, hub_certificate_fingerprint,
       terminal_device_id, terminal_assignment_generation, terminal_profile_code,
       terminal_credential_id, terminal_certificate_serial,
       terminal_certificate_fingerprint, terminal_nonce, hub_nonce, state,
       correlation_id, expires_at)
    values
      (gen_random_uuid(), '1.0', 'hub_terminal_pairing',
       'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003', 'development',
       'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000012', 1,
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('a', 64),
       'e0000000-0000-4000-8000-000000000020', 1, 'laundry.t1.intake_cashier',
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('b', 64),
       repeat('c', 64), repeat('d', 64), 'challenge_issued', gen_random_uuid(),
       now() + interval '10 minutes');
    raise exception 'ASSERT FAIL: a quarantined terminal began pairing';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-TERMINAL-CONTAINED%' then
      raise exception 'ASSERT FAIL: contained-pairing refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Recovery is an EXPLICIT received decision: a 'cleared' directive with a
  -- HIGHER sequence lifts the containment, and the session opens.
  set local role kitluy_sync_worker;
  insert into edge_identity.containment_directive
    (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
     directive_sequence, reason, source_ref, received_via, received_at)
  values
    (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'cleared', 3, 'authorized recovery probe', 'cloud-correlation-3',
     'cloud_inbox', now());
  set local role kitluy_hub_runtime;
  insert into edge_identity.terminal_session
    (id, tenant_id, digital_store_id, location_id, terminal_device_id,
     actor_id, profile_code, opened_at, expires_at, session_generation,
     last_event_sequence, status)
  values
    (v_session, 'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'e0000000-0000-4000-8000-000000000020', gen_random_uuid(),
     'laundry.t4.pickup_scan_out', now(), now() + interval '8 hours', 99, 0,
     'active');

  -- A DELAYED stale directive (sequence 2 arriving after 3) is recorded as
  -- history but never overrides the newer clearance.
  set local role kitluy_sync_worker;
  insert into edge_identity.containment_directive
    (id, device_uuid, tenant_id, digital_store_id, location_id, directive,
     directive_sequence, reason, source_ref, received_via, received_at)
  values
    (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'quarantined', 2, 'delayed stale probe', 'cloud-correlation-2',
     'cloud_inbox', now());
  if (select directive from edge_identity.effective_containment
       where device_uuid = 'e0000000-0000-4000-8000-000000000020') <> 'cleared' then
    raise exception 'ASSERT FAIL: a delayed stale directive overrode a newer clearance';
  end if;

  if v_blocked <> 5 then
    raise exception 'ASSERT FAIL: expected 5 refused containment probes, got %', v_blocked;
  end if;
  raise notice 'PASS containment-enforcement: a received quarantine blocks sessions and pairing locally with their exact sentinel, replay collides, history is append-only, an explicit higher-sequence clearance restores service, and a delayed stale directive never overrides it';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 33. WS-11-T005-P02 — heartbeat sequencing and report evidence (group 0036).
-- ---------------------------------------------------------------------------
begin;
set local role kitluy_hub_runtime;
do $$
declare
  v_blocked int := 0;
begin
  insert into edge_hardware.terminal_health_status
    (terminal_device_id, tenant_id, digital_store_id, location_id,
     derived_state, last_heartbeat_at, heartbeat_count, derived_at, updated_at,
     last_heartbeat_sequence, report_sequence)
  values
    ('e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'healthy', now(), 1, now(), now(), 5, 2);

  -- Neither sequence can move backwards, even for a privileged writer.
  begin
    update edge_hardware.terminal_health_status
    set last_heartbeat_sequence = 4
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: the heartbeat sequence moved backwards';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-HEARTBEAT-SEQUENCE-BACKWARDS%' then
      raise exception 'ASSERT FAIL: heartbeat-sequence refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  begin
    update edge_hardware.terminal_health_status
    set report_sequence = 1
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: the report sequence moved backwards';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-REPORT-SEQUENCE-BACKWARDS%' then
      raise exception 'ASSERT FAIL: report-sequence refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Report evidence is append-only, and its per-terminal sequence collides
  -- instead of duplicating.
  insert into edge_hardware.terminal_health_report
    (id, terminal_device_id, tenant_id, digital_store_id, location_id,
     report_sequence, derived_state, from_state, material, observed_at,
     containment_state, credential_eligible, correlation_id, created_at)
  values
    (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
     'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     7, 'healthy', 'unknown', true, now(), 'none', true, gen_random_uuid(), now());
  begin
    insert into edge_hardware.terminal_health_report
      (id, terminal_device_id, tenant_id, digital_store_id, location_id,
       report_sequence, derived_state, material, observed_at,
       containment_state, credential_eligible, correlation_id, created_at)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000020',
       'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003',
       7, 'degraded', false, now(), 'none', true, gen_random_uuid(), now());
    raise exception 'ASSERT FAIL: a duplicate report sequence was accepted';
  exception
    when unique_violation then
      v_blocked := v_blocked + 1;
    when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      raise exception 'ASSERT FAIL: duplicate-report refusal was %', sqlerrm;
  end;
  begin
    update edge_hardware.terminal_health_report set material = false
    where terminal_device_id = 'e0000000-0000-4000-8000-000000000020';
    raise exception 'ASSERT FAIL: report evidence was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-APPEND-ONLY%' and sqlerrm not like '%permission denied%' then
      raise exception 'ASSERT FAIL: report rewrite refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 refused sequencing probes, got %', v_blocked;
  end if;
  raise notice 'PASS heartbeat-sequencing: heartbeat and report sequences only advance, report evidence is append-only, and a duplicated per-terminal report sequence collides instead of applying twice';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 34. WS-11-T006-P01 — local replacement/cutover gates (group 0037).
-- ---------------------------------------------------------------------------
begin;
do $$
declare
  v_r jsonb;
  v_blocked int := 0;
begin
  -- The shipped default is operational.
  if (select mode from edge_identity.hub_replacement_state where singleton) <> 'normal' then
    raise exception 'ASSERT FAIL: the shipped replacement mode is not normal';
  end if;

  -- Direct writes are governed.
  begin
    update edge_identity.hub_replacement_state set mode = 'retired_rejected' where singleton;
    raise exception 'ASSERT FAIL: the replacement mode was written directly';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-REPLACEMENT-GOVERNED%'
       and sqlerrm not like '%permission denied%' then
      raise exception 'ASSERT FAIL: direct-write refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- A restored/prepared Hub refuses operational rows — locally, no cloud.
  set local role kitluy_hub_runtime;
  v_r := edge_identity.set_hub_replacement_mode_v1(
    'restored_quarantine', null, 'restore probe', 'OP-T006', gen_random_uuid());
  if v_r->>'outcome' <> 'CHANGED' then
    raise exception 'ASSERT FAIL: quarantine mode was refused: %', v_r;
  end if;
  begin
    insert into edge_identity.terminal_session
      (id, tenant_id, digital_store_id, location_id, terminal_device_id,
       actor_id, profile_code, opened_at, expires_at, session_generation,
       last_event_sequence, status)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003',
       'e0000000-0000-4000-8000-000000000020', gen_random_uuid(),
       'laundry.t4.pickup_scan_out', now(), now() + interval '1 hour', 77, 0, 'active');
    raise exception 'ASSERT FAIL: a quarantined Hub opened a terminal session';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-HUB-NOT-OPERATIONAL%' then
      raise exception 'ASSERT FAIL: quarantine session refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  reset role;
  begin
    insert into edge_identity.pairing_session
      (id, protocol_version, purpose, tenant_id, digital_store_id, location_id,
       environment, hub_device_id, hub_assignment_id, hub_assignment_generation,
       hub_credential_id, hub_certificate_serial, hub_certificate_fingerprint,
       terminal_device_id, terminal_assignment_generation, terminal_profile_code,
       terminal_credential_id, terminal_certificate_serial,
       terminal_certificate_fingerprint, terminal_nonce, hub_nonce, state,
       correlation_id, expires_at)
    values
      (gen_random_uuid(), '1.0', 'hub_terminal_pairing',
       'e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000002',
       'e0000000-0000-4000-8000-000000000003', 'development',
       'e0000000-0000-4000-8000-000000000010', 'e0000000-0000-4000-8000-000000000012', 1,
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('a', 64),
       'e0000000-0000-4000-8000-000000000020', 1, 'laundry.t1.intake_cashier',
       'e0000000-0000-4000-8000-000000000013', 'DEMO-OPS-CERT-0001', repeat('b', 64),
       repeat('c', 64), repeat('d', 64), 'challenge_issued', gen_random_uuid(),
       now() + interval '10 minutes');
    raise exception 'ASSERT FAIL: a quarantined Hub began pairing';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-HUB-NOT-OPERATIONAL%' then
      raise exception 'ASSERT FAIL: quarantine pairing refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Explicit activation restores service.
  set local role kitluy_hub_runtime;
  v_r := edge_identity.set_hub_replacement_mode_v1(
    'normal', null, 'validated after restore', 'OP-T006', gen_random_uuid());
  insert into edge_identity.terminal_session
    (id, tenant_id, digital_store_id, location_id, terminal_device_id,
     actor_id, profile_code, opened_at, expires_at, session_generation,
     last_event_sequence, status)
  values
    (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002',
     'e0000000-0000-4000-8000-000000000003',
     'e0000000-0000-4000-8000-000000000020', gen_random_uuid(),
     'laundry.t4.pickup_scan_out', now(), now() + interval '1 hour', 78, 0, 'active');

  -- A retired Hub is terminal LOCALLY: it cannot re-enter service.
  perform edge_identity.set_hub_replacement_mode_v1(
    'retired_rejected', gen_random_uuid(), 'cutover received', 'OP-T006', gen_random_uuid());
  begin
    perform edge_identity.set_hub_replacement_mode_v1(
      'normal', null, 'sneak back', 'OP-T006', gen_random_uuid());
    raise exception 'ASSERT FAIL: a retired Hub returned to service locally';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-REPLACEMENT-RETIRED%' then
      raise exception 'ASSERT FAIL: retired-return refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  reset role;

  -- History is append-only.
  begin
    update edge_identity.hub_replacement_events set reason = 'rewritten';
    raise exception 'ASSERT FAIL: replacement history was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-APPEND-ONLY%' then
      raise exception 'ASSERT FAIL: history rewrite refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 5 then
    raise exception 'ASSERT FAIL: expected 5 refused replacement probes, got %', v_blocked;
  end if;
  raise notice 'PASS hub-replacement-gates: a prepared or restored Hub refuses sessions and pairing locally, explicit activation restores service, a retired Hub cannot re-enter service, direct mode writes are governed, and the history is append-only';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 35. WS-11-T006-P03 — release trust and cache (group 0038).
-- ---------------------------------------------------------------------------
begin;
set local role kitluy_hub_runtime;
do $$
declare
  v_id uuid := gen_random_uuid();
  v_blocked int := 0;
begin
  insert into edge_config.release_trust_key
    (key_id, key_version, algorithm, public_key_pem, state, activated_at)
  values ('t006-probe-key', 1, 'ed25519',
          '-----BEGIN PUBLIC KEY-----probe-----END PUBLIC KEY-----', 'current', now());

  -- An UNKNOWN signing key cannot even stage (FK), and a private key cannot
  -- enter the registry (CHECK; also proven on apply by the 0038 guard).
  begin
    insert into edge_config.release_cache
      (id, tenant_id, digital_store_id, location_id, product_key, version,
       build_id, architecture, hardware_profile, environment, channel,
       artifact_digest_sha256, artifact_size_bytes, manifest_version,
       signing_key_id, signing_key_version, signature_b64,
       min_schema_version, max_schema_version)
    values
      (gen_random_uuid(), 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'kitluy-hub-agent', '1.0.0', 'b1', 'arm64', 'pi5-hub', 'development',
       'internal', repeat('a', 64), 100, 1, 'ghost-key', 9, repeat('QQQQ', 22),
       30, 40);
    raise exception 'ASSERT FAIL: an unknown signing key staged a release';
  exception
    when foreign_key_violation then
      v_blocked := v_blocked + 1;
    when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      raise exception 'ASSERT FAIL: unknown-key staging refusal was %', sqlerrm;
  end;

  insert into edge_config.release_cache
    (id, tenant_id, digital_store_id, location_id, product_key, version,
     build_id, architecture, hardware_profile, environment, channel,
     artifact_digest_sha256, artifact_size_bytes, manifest_version,
     signing_key_id, signing_key_version, signature_b64,
     min_schema_version, max_schema_version)
  values
    (v_id, 'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
     'kitluy-hub-agent', '1.0.0', 'b1', 'arm64', 'pi5-hub', 'development',
     'internal', repeat('a', 64), 100, 1, 't006-probe-key', 1, repeat('QQQQ', 22),
     30, 40);
  update edge_config.release_cache set state = 'verified', verified_at = now(), updated_at = now() where id = v_id;
  update edge_config.release_cache set state = 'downloading', bytes_downloaded = 60, updated_at = now() where id = v_id;
  update edge_config.release_cache set state = 'cached', bytes_downloaded = 100, cached_at = now(), updated_at = now() where id = v_id;

  -- Forward-only: state and resumable download offsets never move backwards.
  begin
    update edge_config.release_cache set state = 'assigned' where id = v_id;
    raise exception 'ASSERT FAIL: the cache state moved backwards';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RELEASE-STATE-BACKWARDS%' then
      raise exception 'ASSERT FAIL: backwards-state refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  begin
    update edge_config.release_cache set bytes_downloaded = 10 where id = v_id;
    raise exception 'ASSERT FAIL: the download offset moved backwards';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RELEASE-DOWNLOAD-BACKWARDS%' then
      raise exception 'ASSERT FAIL: backwards-download refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  begin
    delete from edge_config.release_cache where id = v_id;
    raise exception 'ASSERT FAIL: a cache row was deleted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-RELEASE-NO-DELETE%' and sqlerrm not like '%permission denied%' then
      raise exception 'ASSERT FAIL: cache delete refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Rejected is FINAL: a rejected release never recovers.
  declare v_rej uuid := gen_random_uuid();
  begin
    insert into edge_config.release_cache
      (id, tenant_id, digital_store_id, location_id, product_key, version,
       build_id, architecture, hardware_profile, environment, channel,
       artifact_digest_sha256, artifact_size_bytes, manifest_version,
       signing_key_id, signing_key_version, signature_b64,
       min_schema_version, max_schema_version, state, refusal_code)
    values
      (v_rej, 'e0000000-0000-4000-8000-000000000001',
       'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
       'kitluy-hub-agent', '1.0.1', 'b2', 'arm64', 'pi5-hub', 'development',
       'internal', repeat('b', 64), 100, 1, 't006-probe-key', 1, repeat('QQQQ', 22),
       30, 40, 'rejected', 'SIGNATURE_INVALID');
    begin
      update edge_config.release_cache
      set state = 'cached', refusal_code = null, cached_at = now() where id = v_rej;
      raise exception 'ASSERT FAIL: a rejected release recovered';
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      if sqlerrm not like '%KLUY-EDGE-RELEASE-REJECTED-FINAL%' then
        raise exception 'ASSERT FAIL: rejected-final refusal used the wrong sentinel: %', sqlerrm;
      end if;
      v_blocked := v_blocked + 1;
    end;
  end;

  if v_blocked <> 5 then
    raise exception 'ASSERT FAIL: expected 5 refused cache probes, got %', v_blocked;
  end if;
  raise notice 'PASS release-trust-and-cache: only registered PUBLIC keys stage releases, cache states and download offsets only advance, rejected is final, and cache rows cannot be deleted';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 36. WS-11-T006-P04 — installation matrix and one-rollback rule (group 0039).
-- ---------------------------------------------------------------------------
begin;
set local role kitluy_hub_runtime;
do $$
declare
  v_cache uuid := gen_random_uuid();
  v_inst uuid := gen_random_uuid();
  v_blocked int := 0;
begin
  insert into edge_config.release_trust_key
    (key_id, key_version, algorithm, public_key_pem, state, activated_at)
  values ('t006-p04-key', 1, 'ed25519',
          '-----BEGIN PUBLIC KEY-----probe-----END PUBLIC KEY-----', 'current', now())
  on conflict (key_id, key_version) do nothing;
  insert into edge_config.release_cache
    (id, tenant_id, digital_store_id, location_id, product_key, version,
     build_id, architecture, hardware_profile, environment, channel,
     artifact_digest_sha256, artifact_size_bytes, manifest_version,
     signing_key_id, signing_key_version, signature_b64,
     min_schema_version, max_schema_version, state, verified_at, cached_at)
  values
    (v_cache, 'e0000000-0000-4000-8000-000000000001',
     'e0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000003',
     'kitluy-hub-agent', '3.0.0', 'b3', 'arm64', 'pi5-hub', 'development',
     'internal', repeat('d', 64), 100, 1, 't006-p04-key', 1, repeat('QQQQ', 22),
     30, 45, 'cached', now(), now());

  -- Entry is assigned only; a skipped entry is refused.
  begin
    insert into edge_config.release_installation
      (id, release_cache_id, device_kind, tenant_id, digital_store_id,
       location_id, state, candidate_version)
    values (gen_random_uuid(), v_cache, 'store_hub',
            'e0000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000002',
            'e0000000-0000-4000-8000-000000000003', 'current', '3.0.0');
    raise exception 'ASSERT FAIL: an installation entered at current';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-INSTALL-ENTRY%' then
      raise exception 'ASSERT FAIL: entry refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  insert into edge_config.release_installation
    (id, release_cache_id, device_kind, tenant_id, digital_store_id,
     location_id, candidate_version)
  values (v_inst, v_cache, 'store_hub',
          'e0000000-0000-4000-8000-000000000001',
          'e0000000-0000-4000-8000-000000000002',
          'e0000000-0000-4000-8000-000000000003', '3.0.0');

  -- A second live installation on the same device collides structurally.
  begin
    insert into edge_config.release_installation
      (id, release_cache_id, device_kind, tenant_id, digital_store_id,
       location_id, candidate_version)
    values (gen_random_uuid(), v_cache, 'store_hub',
            'e0000000-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000002',
            'e0000000-0000-4000-8000-000000000003', '3.0.1');
    raise exception 'ASSERT FAIL: two live installations coexisted on one device';
  exception
    when unique_violation then
      v_blocked := v_blocked + 1;
    when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      raise exception 'ASSERT FAIL: one-live refusal was %', sqlerrm;
  end;

  -- Skipping the matrix is refused; walking it is journalled automatically.
  begin
    update edge_config.release_installation set state = 'current' where id = v_inst;
    raise exception 'ASSERT FAIL: assigned jumped straight to current';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-INSTALL-TRANSITION%' then
      raise exception 'ASSERT FAIL: transition refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;
  update edge_config.release_installation set state = 'downloading' where id = v_inst;
  update edge_config.release_installation set state = 'verified' where id = v_inst;
  update edge_config.release_installation set state = 'staged' where id = v_inst;
  update edge_config.release_installation set state = 'installing_inactive_slot' where id = v_inst;
  update edge_config.release_installation set state = 'pending_restart', candidate_slot = 'b' where id = v_inst;
  update edge_config.release_installation set state = 'health_checking', probes_started_at = now() where id = v_inst;
  update edge_config.release_installation set state = 'rolling_back', failure_reason = 'probe timeout' where id = v_inst;
  update edge_config.release_installation set state = 'failed_rolled_back' where id = v_inst;

  if (select count(*) from edge_config.release_installation_event
       where installation_id = v_inst) < 9 then
    raise exception 'ASSERT FAIL: the auto-journal is missing transitions';
  end if;
  if (select rollback_attempted from edge_config.release_installation where id = v_inst) is not true then
    raise exception 'ASSERT FAIL: the rollback attempt was not pinned';
  end if;

  -- failed_rolled_back is terminal for automatic retry.
  begin
    update edge_config.release_installation set state = 'health_checking' where id = v_inst;
    raise exception 'ASSERT FAIL: a rolled-back installation resumed automatically';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like '%KLUY-EDGE-INSTALL-TRANSITION%' then
      raise exception 'ASSERT FAIL: terminal-state refusal used the wrong sentinel: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 refused installation probes, got %', v_blocked;
  end if;
  raise notice 'PASS release-installation-matrix: entry only at assigned, one live installation per device, the full walk auto-journalled, illegal jumps refused, the automatic rollback pinned to exactly one attempt, failed_rolled_back terminal';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- 29. Final tally.
-- ---------------------------------------------------------------------------
do $$
declare
  v_tables int;
  v_indexes int;
  v_triggers int;
begin
  select count(*) into v_tables from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname like 'edge\_%' and n.nspname <> 'edge_ops';
  select count(*) into v_indexes from pg_indexes where schemaname like 'edge\_%';
  select count(*) into v_triggers from pg_trigger t
  join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname like 'edge\_%';
  -- 57 -> 60: hub group 0027 adds `revocation_trust_key`, `revocation_snapshot`
  -- and `revocation_snapshot_entry` (WS-11-T003 Step 4,
  -- KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001).
  -- 60 -> 62: hub group 0031 adds `pairing_session` and `pairing_receipt`
  -- (WS-11-T004-P03B).
  -- 62 -> 63: hub group 0033 adds `credential_projection`, the append-only
  -- evidence of every terminal-credential delivery this Hub applied
  -- (WS-11-T004-P04C1, capability-census row 28).
  -- 63 -> 65: hub group 0035 adds `terminal_health_status` (the Hub's CURRENT
  -- local health authority) and `containment_directive` (received containment
  -- decisions, enforced locally) — WS-11-T005. This tally is deliberately
  -- EXACT in both directions -- it is how an unreviewed table gets noticed --
  -- so it is raised by exactly the additions that were reviewed and by
  -- nothing else.
  if v_tables <> 72 then
    raise exception
      'ASSERT FAIL: expected 72 relations (51 canonical §6 + 2 additive G3 + 2 G9 + 1 G10 + 1 G11 + 3 G0027 revocation + 2 G0031 pairing + 1 G0033 credential projection + 2 G0035 health/containment + 1 G0036 report evidence + 2 G0037 replacement state + 2 G0038 release trust/cache + 2 G0039 installation state), found %',
      v_tables;
  end if;
  raise notice 'PASS tally: % relations (51 canonical §6 + 2 additive G3 + 2 G9 + 1 G10 + 1 G11 WS-10 + 3 G0027 revocation + 2 G0031 pairing + 1 G0033 credential projection + 2 G0035 health/containment + 1 G0036 report evidence + 2 G0037 replacement state + 2 G0038 release trust/cache + 2 G0039 installation state), % indexes, % triggers',
    v_tables, v_indexes, v_triggers;
end $$;
