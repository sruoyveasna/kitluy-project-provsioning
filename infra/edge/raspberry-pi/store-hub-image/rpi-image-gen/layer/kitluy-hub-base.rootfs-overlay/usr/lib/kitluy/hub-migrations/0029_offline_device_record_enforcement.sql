-- kitluy:hub:group:0029
-- Hub migration 0029: offline_device_record_enforcement.
--
-- Authority: KLD-2026-07-31-HUB-SNAPSHOT-SIGNING-001; WS-11-T003 Step 4 §5.
--
-- ===========================================================================
-- A SIGNED FIELD THAT NOTHING READ
-- ===========================================================================
-- `revokedDeviceRecordIds` travels inside the signed canonical bytes, group 0027
-- stores it as `entry_kind = 'device_record'`, and independent review found that
-- NOTHING ever read it back: `is_certificate_revoked_offline_v1` filters
-- `entry_kind = 'certificate_serial'`, and `revocation_state_v1` counts only that
-- kind. A device could be retired in the cloud, listed in the snapshot, signed,
-- delivered and persisted -- and the Hub would enforce nothing against it.
--
-- That is worse than not carrying the field. A signed field creates the
-- impression that its contents are enforced, so the gap is invisible precisely
-- where an operator would look for assurance.
--
-- This migration takes OPTION A from the task: enforce it. The field stays in
-- the signed payload and gains a reader, so the signature now covers something
-- that changes an access decision.
--
-- ===========================================================================
-- WHAT THIS DOES NOT CLAIM
-- ===========================================================================
-- The reader answers "is THIS device record id revoked in the snapshot this Hub
-- holds". Which local rows carry an id drawn from the CLOUD's device-record
-- namespace is a replication convention, not something this schema asserts:
--
--   * `edge_identity.hub_assignment.hub_device_id` IS a cloud device record id --
--     it is the same value a snapshot carries as `hubDeviceRecordId`, and the
--     scope check already compares them. Enforcement against it is therefore
--     sound: a Hub whose own device record was retired stops operating.
--   * `edge_identity.terminal_device.id` is a uuid primary key with no column
--     stating that it mirrors the cloud device record. It probably does, but
--     "probably" is not evidence, so the caller checks it and the RESIDUAL
--     UNCERTAINTY IS RECORDED rather than asserted away.
--
-- ADDITIVE. Groups 0000-0028 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

create or replace function edge_config.is_device_revoked_offline_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text,
  p_device_record_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, edge_config
as $device$
  -- `active` AND `superseded`, exactly like the certificate reader.
  --
  -- Offline knowledge only ever GROWS. If this read only spanned the active
  -- snapshot, a newer delivery that simply omits a device would un-revoke it,
  -- and revocation would become reversible by anyone able to withhold a name.
  select exists (
    select 1
      from edge_config.revocation_snapshot s
      join edge_config.revocation_snapshot_entry e on e.snapshot_id = s.id
     where s.tenant_id = p_tenant_id
       and s.digital_store_id = p_digital_store_id
       and s.store_location_id = p_store_location_id
       and s.environment = p_environment
       and s.state in ('active', 'superseded')
       and e.entry_kind = 'device_record'
       and e.identifier = p_device_record_id::text
  );
$device$;

revoke all on function edge_config.is_device_revoked_offline_v1(uuid, uuid, uuid, text, uuid)
  from public;
grant execute on function edge_config.is_device_revoked_offline_v1(uuid, uuid, uuid, text, uuid)
  to kitluy_hub_runtime;

comment on function edge_config.is_device_revoked_offline_v1(uuid, uuid, uuid, text, uuid) is
  'Group 0029. Is this DEVICE RECORD revoked by the snapshot this Hub holds? Spans active+superseded so offline knowledge only grows. Exists because revokedDeviceRecordIds was signed, delivered and stored with no reader at all (WS-11-T003 Step 4 §5).';

-- ---------------------------------------------------------------------------
-- PROVE THE SIGNED FIELD IS NOW READ, AND STAYS PUBLIC-INACCESSIBLE
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_public text;
  v_reads_device_kind boolean;
begin
  select string_agg(p.proname, ', ')
    into v_public
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_config'
     and p.proname = 'is_device_revoked_offline_v1'
     and has_function_privilege('public', p.oid, 'execute');
  if v_public is not null then
    raise exception 'KLUY-HUB-MIGRATION-0029: still EXECUTE-able by PUBLIC: %', v_public
      using errcode = 'P0001';
  end if;

  -- The whole point: SOMETHING now selects the device_record entry kind.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'edge_config'
       and p.proname = 'is_device_revoked_offline_v1'
       and pg_get_functiondef(p.oid) like '%device_record%')
    into v_reads_device_kind;
  if not v_reads_device_kind then
    raise exception
      'KLUY-HUB-MIGRATION-0029: the device-record entry kind is still unread'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-HUB-MIGRATION-0029: revokedDeviceRecordIds is now enforced, not merely signed';
end
$guard$;
