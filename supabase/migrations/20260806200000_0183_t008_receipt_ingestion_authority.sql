-- kitluy:group:0183
-- ============================================================================
-- WS-11-T008 — pairing-receipt ingestion authority (independent review
-- findings NEW-1, NEW-2, NEW-3 from Reviewer B's adversarial probe set).
--
-- DEFECT (pre-existing in group 0176, FOUND BY Reviewer B probes B1-B4/B6/B10):
-- ingest_terminal_pairing_receipt_v1 performed NO Hub-identity, tenancy-scope
-- or assignment-generation validation in SQL. Every such binding lived only in
-- the TypeScript consumer against the authenticated delivery envelope, so any
-- holder of the door (kitluy_pairing_receipt_governor, the edge-sync service,
-- or the test harness) could ingest:
--   B1 a receipt whose Hub and terminal are the SAME device;
--   B2 a receipt signed by a Hub belonging to a DIFFERENT Tenant/Store;
--   B3 a receipt claiming a Tenant/Store/Location the devices do not occupy;
--   B4 a receipt carrying a stale assignment generation.
-- Its sibling ingest_device_health_report_v1 (group 0177) enforces exactly
-- these four in SQL. Frontend/consumer validation is not authorization
-- (repository rule 7); the door is the authority.
--
-- Also corrected, the SAME ungoverned-escape class group 0181 fixed for
-- assign_release_v1:
--   NEW-2 a replayed effect_key escaped as raw SQLSTATE 23505 from the
--         tpr_effect_key_uq index instead of a governed sentinel;
--   NEW-3 a malformed certificate fingerprint escaped as raw 23514 instead
--         of the KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA the door already
--         raises for the effect key and the environment.
--
-- WHAT IS DELIBERATELY UNCHANGED: the cloud still never authors pairing,
-- never moves paired_at and never becomes the LAN pairing authority. A
-- redelivery of the SAME facts is still exactly one business effect. These
-- additions only REFUSE deliveries the cloud should never have accepted.
--
-- Authority: security test system §19 (T008 remediation protocol); group
-- 0176 (the door); group 0177 (the sibling door whose SQL-side checks this
-- brings to parity); group 0121 (assignment generation is authority).
-- ============================================================================

do $borrow$
begin
  execute format('grant kitluy_pairing_receipt_governor to %I', current_user);
end
$borrow$;

-- The door is SECURITY DEFINER as this governor, so the identity and scope
-- checks below read as the governor. READ-ONLY reach only, and RLS policies
-- to match — the same shape group 0177 gives kitluy_fleet_governor for its
-- sibling door. The governor gains no write path to either table.
grant select on kitluy_devices.devices to kitluy_pairing_receipt_governor;
grant select on kitluy_devices.device_assignments to kitluy_pairing_receipt_governor;

drop policy if exists devices_pairing_receipt_governor on kitluy_devices.devices;
create policy devices_pairing_receipt_governor on kitluy_devices.devices
  for select to kitluy_pairing_receipt_governor using (true);
drop policy if exists da_pairing_receipt_governor on kitluy_devices.device_assignments;
create policy da_pairing_receipt_governor on kitluy_devices.device_assignments
  for select to kitluy_pairing_receipt_governor using (true);

set local role kitluy_pairing_receipt_governor;

create or replace function kitluy_devices.ingest_terminal_pairing_receipt_v1(
  p_effect_key text,
  p_receipt_id uuid,
  p_receipt_version text,
  p_pairing_session_id uuid,
  p_hub_device_id uuid,
  p_terminal_device_id uuid,
  p_terminal_assignment_generation integer,
  p_terminal_profile_code text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_location_id uuid,
  p_environment text,
  p_hub_certificate_fingerprint text,
  p_terminal_certificate_fingerprint text,
  p_hub_certificate_serial text,
  p_transcript_hash text,
  p_hub_receipt_signature text,
  p_paired_at timestamptz,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $ingest$
declare
  v_existing kitluy_devices.terminal_pairing_receipts;
  v_hub_assignment kitluy_devices.device_assignments;
  v_terminal_assignment kitluy_devices.device_assignments;
  v_hub_class text;
begin
  if p_effect_key !~ '^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: environment % is not a trust environment',
      coalesce(p_environment, '<null>') using errcode = 'P0001';
  end if;

  -- T008 NEW-3: shape refusals are governed, not raw check violations. The
  -- stored form is lower-case hex (the table's CHECK); refuse anything else
  -- here so the caller sees the door's own sentinel family.
  if lower(coalesce(p_hub_certificate_fingerprint, '')) !~ '^[0-9a-f]{64}$'
     or lower(coalesce(p_terminal_certificate_fingerprint, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a certificate fingerprint is not a 64-character hex digest'
      using errcode = 'P0001';
  end if;
  if lower(coalesce(p_transcript_hash, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: the transcript hash is not a 64-character hex digest'
      using errcode = 'P0001';
  end if;

  -- The receipt ID is the BUSINESS identity. A redelivery answers from the
  -- stored row without recomputing anything.
  select * into v_existing from kitluy_devices.terminal_pairing_receipts
   where receipt_id = p_receipt_id
   for update;

  if found then
    -- A redelivery must assert the SAME facts. Anything else is a conflict the
    -- original survives, never a silent overwrite (Hub spec §11.4: no generic
    -- last-write-wins).
    if v_existing.pairing_session_id <> p_pairing_session_id
       or v_existing.hub_device_id <> p_hub_device_id
       or v_existing.terminal_device_id <> p_terminal_device_id
       or v_existing.tenant_id <> p_tenant_id
       or v_existing.digital_store_id <> p_digital_store_id
       or v_existing.location_id <> p_location_id
       or v_existing.environment <> p_environment
       or v_existing.transcript_hash <> lower(p_transcript_hash)
       or v_existing.hub_receipt_signature <> p_hub_receipt_signature
       or v_existing.paired_at <> p_paired_at
       or v_existing.effect_key <> p_effect_key then
      raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: receipt % was already ingested with different facts; the original stands',
        p_receipt_id using errcode = 'P0001';
    end if;
    -- ONE business effect. Only freshness moves.
    update kitluy_devices.terminal_pairing_receipts
       set last_received_at = now(),
           delivery_count   = delivery_count + 1
     where receipt_id = p_receipt_id;
    return jsonb_build_object(
      'outcome', 'DUPLICATE_IGNORED',
      'receipt_id', p_receipt_id,
      'paired_at', v_existing.paired_at,
      'delivery_count', v_existing.delivery_count + 1);
  end if;

  -- A pairing session identifies ONE handshake; two receipt ids claiming the
  -- same session would be two cloud truths for one Hub fact.
  if exists (select 1 from kitluy_devices.terminal_pairing_receipts
              where pairing_session_id = p_pairing_session_id) then
    raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: pairing session % already carries a different receipt',
      p_pairing_session_id using errcode = 'P0001';
  end if;

  -- T008 NEW-2: a DIFFERENT receipt id replaying an already-used effect key
  -- is a governed conflict, not a raw unique violation from tpr_effect_key_uq.
  if exists (select 1 from kitluy_devices.terminal_pairing_receipts
              where effect_key = p_effect_key) then
    raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: effect key % was already delivered by a different receipt',
      p_effect_key using errcode = 'P0001';
  end if;

  -- =========================================================================
  -- T008 NEW-1: the SQL door binds identity, scope and generation itself.
  -- Parity with ingest_device_health_report_v1 (group 0177) — the consumer's
  -- envelope check is defence in depth, never the authority (rule 7).
  -- =========================================================================
  if p_hub_device_id = p_terminal_device_id then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-HUB: a device cannot pair with itself'
      using errcode = 'P0001';
  end if;

  select device_class into v_hub_class from kitluy_devices.devices
   where id = p_hub_device_id;
  if v_hub_class is null then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub % does not exist', p_hub_device_id
      using errcode = 'P0001';
  end if;
  if v_hub_class <> 'store_hub' then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-HUB: device % is a %, not a Store Hub', p_hub_device_id, v_hub_class
      using errcode = 'P0001';
  end if;

  select * into v_hub_assignment from kitluy_devices.device_assignments
   where device_id = p_hub_device_id and state in ('pending_trust', 'active');
  if not found then
    raise exception 'KLUY-PAIRING-RECEIPT-HUB-UNASSIGNED: the issuing Hub has no live assignment'
      using errcode = 'P0001';
  end if;

  select * into v_terminal_assignment from kitluy_devices.device_assignments
   where device_id = p_terminal_device_id and state in ('pending_trust', 'active');
  if not found then
    raise exception 'KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED: the paired terminal has no live assignment'
      using errcode = 'P0001';
  end if;

  -- Another Hub cannot claim the terminal, and neither may claim a scope it
  -- does not occupy: Hub, terminal AND the asserted receipt scope must agree.
  if v_terminal_assignment.tenant_id <> v_hub_assignment.tenant_id
     or v_terminal_assignment.digital_store_id <> v_hub_assignment.digital_store_id
     or v_terminal_assignment.store_location_id <> v_hub_assignment.store_location_id then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub % is not the assigned Hub for terminal %',
      p_hub_device_id, p_terminal_device_id using errcode = 'P0001';
  end if;
  if p_tenant_id <> v_hub_assignment.tenant_id
     or p_digital_store_id <> v_hub_assignment.digital_store_id
     or p_location_id <> v_hub_assignment.store_location_id then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-SCOPE: the receipt claims a Tenant, Store or Location the paired devices do not occupy'
      using errcode = 'P0001';
  end if;

  -- A stale assignment generation is refused, not tolerated (0121 rule).
  if p_terminal_assignment_generation <> v_terminal_assignment.assignment_generation then
    raise exception 'KLUY-PAIRING-RECEIPT-STALE-GENERATION: receipt generation % is not the live generation %',
      p_terminal_assignment_generation, v_terminal_assignment.assignment_generation
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.terminal_pairing_receipts
    (receipt_id, receipt_version, pairing_session_id, hub_device_id, terminal_device_id,
     terminal_assignment_generation, terminal_profile_code, tenant_id, digital_store_id,
     location_id, environment, hub_certificate_fingerprint, terminal_certificate_fingerprint,
     hub_certificate_serial, transcript_hash, hub_receipt_signature, paired_at,
     first_received_at, last_received_at, delivery_count, effect_key, correlation_id)
  values
    (p_receipt_id, p_receipt_version, p_pairing_session_id, p_hub_device_id, p_terminal_device_id,
     p_terminal_assignment_generation, p_terminal_profile_code, p_tenant_id, p_digital_store_id,
     p_location_id, p_environment, lower(p_hub_certificate_fingerprint),
     lower(p_terminal_certificate_fingerprint), p_hub_certificate_serial, lower(p_transcript_hash),
     p_hub_receipt_signature, p_paired_at, now(), now(), 1, p_effect_key, p_correlation_id);

  return jsonb_build_object(
    'outcome', 'INGESTED',
    'receipt_id', p_receipt_id,
    'paired_at', p_paired_at,
    'delivery_count', 1);
end
$ingest$;

comment on function kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid) is
  'Group 0183 (WS-11-T008 NEW-1/2/3) re-creation of the 0176 door. Unchanged: the cloud never authors pairing, never moves paired_at, and a redelivery of the same facts is ONE business effect. Added in SQL, at parity with ingest_device_health_report_v1: the issuing Hub must exist, be a store_hub with a live assignment, and share Tenant/Store/Location with the paired terminal; the asserted receipt scope must match that assignment; the terminal assignment generation must be live; a self-pairing is refused; a replayed effect key and a malformed digest are governed sentinels rather than raw SQLSTATEs.';

reset role;

do $handback$
begin
  execute format('revoke kitluy_pairing_receipt_governor from %I', current_user);
end
$handback$;

do $guard$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'ingest_terminal_pairing_receipt_v1';
  if pg_get_userbyid((select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_devices' and p.proname = 'ingest_terminal_pairing_receipt_v1'))
     <> 'kitluy_pairing_receipt_governor' then
    raise exception 'KLUY-MIGRATION-0183: the ingestion door lost its governor owner';
  end if;
  foreach v_def in array array[v_def] loop
    if v_def not like '%KLUY-PAIRING-RECEIPT-WRONG-HUB%'
       or v_def not like '%KLUY-PAIRING-RECEIPT-WRONG-SCOPE%'
       or v_def not like '%KLUY-PAIRING-RECEIPT-STALE-GENERATION%'
       or v_def not like '%KLUY-PAIRING-RECEIPT-HUB-UNASSIGNED%'
       or v_def not like '%KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED%' then
      raise exception 'KLUY-MIGRATION-0183: an identity or scope refusal is missing from the door';
    end if;
  end loop;
  -- The governor's new reach is READ-ONLY on both tables.
  if has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.devices', 'insert')
     or has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.devices', 'update')
     or has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.devices', 'delete')
     or has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.device_assignments', 'insert')
     or has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.device_assignments', 'update')
     or has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.device_assignments', 'delete') then
    raise exception 'KLUY-MIGRATION-0183: the receipt governor gained a WRITE path to device identity';
  end if;
  if not has_table_privilege('kitluy_pairing_receipt_governor', 'kitluy_devices.device_assignments', 'select') then
    raise exception 'KLUY-MIGRATION-0183: the receipt governor cannot read the assignments its checks depend on';
  end if;
  raise notice 'KLUY-MIGRATION-0183: pairing-receipt ingestion authority installed (Hub identity, scope and generation bound in SQL; effect-key replay and malformed digests governed)';
end
$guard$;
