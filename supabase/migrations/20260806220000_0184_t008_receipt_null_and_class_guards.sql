-- kitluy:group:0184
-- ============================================================================
-- WS-11-T008 — receipt-ingestion NULL and device-class guards (independent
-- re-review findings NEW-4 and NEW-5).
--
-- Reviewer C, verifying group 0183, attacked the checks 0183 itself added and
-- found two gaps. Both fail CLOSED (nothing hostile is accepted), so both are
-- LOW — but one of them is the exact ungoverned-escape class that NEW-2 and
-- NEW-3 were raised for, so it is closed here rather than carried:
--
-- NEW-4: three-valued logic. `NULL <> x` is NULL, not true, so a delivery
--        with a NULL Tenant, Store, Location or assignment generation walked
--        silently PAST the new scope and generation authority and was stopped
--        only by the table's NOT NULL constraints — escaping as a raw 23502
--        that the consumer maps to INTERNAL_ERROR (which reads as retryable)
--        instead of a durable governed rejection.
-- NEW-5: the door checked the ISSUING device's class but never the PAIRED
--        one, so a store_hub supplied as the terminal was ingested. The
--        sibling health door has the same shape of check on both sides.
--
-- Everything else in the 0183 door is carried forward unchanged.
--
-- Authority: security test system §19 (T008 remediation protocol); groups
-- 0176/0183 (the door); group 0177 (the sibling door this stays at parity
-- with).
-- ============================================================================

do $borrow$
begin
  execute format('grant kitluy_pairing_receipt_governor to %I', current_user);
end
$borrow$;

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
  v_terminal_class text;
begin
  -- T008 NEW-4: every field the authority below compares must be PRESENT
  -- first. Three-valued logic means a NULL comparison is NULL, never true,
  -- so an absent field would otherwise walk past the checks and escape as a
  -- raw not-null violation instead of a governed refusal.
  if p_receipt_id is null or p_pairing_session_id is null
     or p_hub_device_id is null or p_terminal_device_id is null
     or p_tenant_id is null or p_digital_store_id is null or p_location_id is null
     or p_terminal_assignment_generation is null
     or p_paired_at is null
     or coalesce(btrim(p_receipt_version), '') = ''
     or coalesce(btrim(p_terminal_profile_code), '') = ''
     or coalesce(btrim(p_hub_certificate_serial), '') = ''
     or coalesce(btrim(p_hub_receipt_signature), '') = '' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a receipt carries its identity, scope, generation, instant and signature; one or more were absent'
      using errcode = 'P0001';
  end if;

  if p_effect_key !~ '^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: environment % is not a trust environment',
      coalesce(p_environment, '<null>') using errcode = 'P0001';
  end if;

  -- Group 0183 (NEW-3): shape refusals are governed, not raw check violations.
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

  if exists (select 1 from kitluy_devices.terminal_pairing_receipts
              where pairing_session_id = p_pairing_session_id) then
    raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: pairing session % already carries a different receipt',
      p_pairing_session_id using errcode = 'P0001';
  end if;

  -- Group 0183 (NEW-2): an effect-key replay is a governed conflict.
  if exists (select 1 from kitluy_devices.terminal_pairing_receipts
              where effect_key = p_effect_key) then
    raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: effect key % was already delivered by a different receipt',
      p_effect_key using errcode = 'P0001';
  end if;

  -- =========================================================================
  -- Identity, scope and generation authority (group 0183, NEW-1), with the
  -- paired side's class now checked too (NEW-5).
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

  -- T008 NEW-5: the PAIRED side is a terminal, never a Hub or a station.
  select device_class into v_terminal_class from kitluy_devices.devices
   where id = p_terminal_device_id;
  if v_terminal_class is null then
    raise exception 'KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED: terminal % does not exist', p_terminal_device_id
      using errcode = 'P0001';
  end if;
  if v_terminal_class <> 'terminal' then
    raise exception 'KLUY-PAIRING-RECEIPT-WRONG-HUB: device % is a %, not a terminal', p_terminal_device_id, v_terminal_class
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
  'Group 0184 (WS-11-T008 NEW-4/NEW-5) re-creation. Carries group 0183 unchanged — Hub identity, scope and generation bound in SQL, governed effect-key and digest refusals — and adds: a presence gate so no absent field can walk past a three-valued comparison into a raw not-null violation, and a class check on the PAIRED side so only a terminal can be paired. The cloud still never authors pairing and never moves paired_at.';

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
  if v_def not like '%p_tenant_id is null%' then
    raise exception 'KLUY-MIGRATION-0184: the presence gate is missing';
  end if;
  if v_def not like '%v_terminal_class%' then
    raise exception 'KLUY-MIGRATION-0184: the paired-side class check is missing';
  end if;
  if v_def not like '%KLUY-PAIRING-RECEIPT-WRONG-SCOPE%'
     or v_def not like '%KLUY-PAIRING-RECEIPT-STALE-GENERATION%' then
    raise exception 'KLUY-MIGRATION-0184: a group 0183 refusal was lost';
  end if;
  raise notice 'KLUY-MIGRATION-0184: receipt presence gate and paired-side class check installed';
end
$guard$;
