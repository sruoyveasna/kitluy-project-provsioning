-- kitluy:group:0181
-- ============================================================================
-- WS-11-T007 — concurrency defect corrections (KLD-2026-08-06-WS11-T007-001).
--
-- Two defects FOUND BY the T007 race matrix (t007-cloud-races suite), fixed
-- forward per the locked rule "a defect fix uses a forward migration when
-- schema behavior must change; previous migrations remain immutable":
--
-- 1. DEADLOCK between the 0177 containment doors (race family 11).
--    apply_device_containment_v1 locks devices THEN device_containment_states;
--    clear_device_containment_v1 locked device_containment_states THEN
--    devices — the classic AB/BA inversion, observed as `deadlock detected`
--    escaping a door ungoverned. clear_device_containment_v1 is re-created
--    below acquiring the SAME lock order as apply (devices first). Behavior
--    is otherwise byte-equivalent: same refusals, same outcomes, same events.
--
-- 2. UNGOVERNED uniqueness escape in the 0180 assignment door (race family
--    15). assign_release_v1 checked the idempotency key with SELECT and then
--    INSERTed; two genuinely concurrent callers both passed the check and
--    the loser surfaced a raw `duplicate key value violates unique
--    constraint "rollout_campaigns_idempotency_key_key"`. The door now
--    handles unique_violation by re-reading the winner's row: an identical
--    assignment converges on EXISTING (one business effect), a different
--    one refuses with the SAME governed sentinel the sequential path uses.
--
-- Authority: security test system §19; 0177 (containment doors); 0180
-- (release authority). No table, grant, RLS or event shape changes.
-- ============================================================================

-- Ownership borrow, same as groups 0125-0180: the applying role is not a
-- member of the NOLOGIN definer owners. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_fleet_governor to %I', current_user);
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

-- ----------------------------------------------------------------------------
-- 1. clear_device_containment_v1 — devices-first lock order (matches apply).
-- ----------------------------------------------------------------------------
set local role kitluy_fleet_governor;

create or replace function kitluy_devices.clear_device_containment_v1(
  p_device_id uuid,
  p_disposition text,
  p_reason text,
  p_actor_ref text,
  p_approved_by_ref text,
  p_evidence_ref text default null,
  p_command_ref text default null,
  p_correlation_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $recover$
declare
  v_device kitluy_devices.devices;
  v_current kitluy_devices.device_containment_states;
  v_restore kitluy_devices.device_lifecycle_state;
  v_replayed kitluy_devices.device_containment_events;
begin
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-FLEET-RECOVERY-UNATTRIBUTED: recovery requires a reason and a named actor'
      using errcode = 'P0001';
  end if;
  -- Recovery is ALWAYS four-eyes: it restores operational trust.
  if coalesce(btrim(p_approved_by_ref), '') = '' then
    raise exception 'KLUY-FLEET-RECOVERY-UNAPPROVED: clearing containment requires an independent approver'
      using errcode = 'P0001';
  end if;
  if btrim(p_approved_by_ref) = btrim(p_actor_ref) then
    raise exception 'KLUY-FLEET-RECOVERY-SELF-APPROVAL: the requester can never approve their own recovery'
      using errcode = 'P0001';
  end if;
  if p_disposition not in
      ('device_cloning', 'refurbished_hardware', 'approved_board_replacement',
       'approved_nvme_replacement', 'data_entry_or_enrollment_error',
       'malicious_enrollment', 'enrollment_station_compromise', 'operator_recovery') then
    raise exception 'KLUY-FLEET-RECOVERY-DISPOSITION: % is not a KLD-2026-07-28-002 §10 runbook classification', p_disposition
      using errcode = 'P0001';
  end if;

  if p_command_ref is not null then
    select * into v_replayed from kitluy_devices.device_containment_events
     where command_ref = p_command_ref;
    if found then
      if v_replayed.device_id = p_device_id
         and v_replayed.event_type = 'CONTAINMENT_CLEARED' then
        return jsonb_build_object('outcome', 'DUPLICATE_IGNORED');
      end if;
      raise exception 'KLUY-FLEET-CONTAINMENT-REPLAY-CONFLICT: command % was already used for a different containment', p_command_ref
        using errcode = 'P0001';
    end if;
  end if;

  -- T007 family-11 correction: take the DEVICE lock first — the same order
  -- apply_device_containment_v1 uses — so apply/clear can serialize instead
  -- of deadlocking (AB/BA inversion found by the race suite).
  select * into v_device from kitluy_devices.devices
   where id = p_device_id for update;

  select * into v_current from kitluy_devices.device_containment_states
   where device_id = p_device_id for update;
  if not found or v_current.containment_state = 'none' then
    return jsonb_build_object('outcome', 'NOT_CONTAINED');
  end if;

  -- Restore the lifecycle through the LEGAL transition matrix only. A cleared
  -- quarantine lands in `enrolled` — full re-trust runs the normal claim and
  -- activation flow again; clearance never silently returns a device to
  -- service (0120 incident discipline).
  if v_device.lifecycle_state = 'restricted_investigation' then
    v_restore := coalesce(v_device.restricted_from_state, 'enrolled');
    if v_restore not in ('active', 'awaiting_trust', 'enrolled') then
      v_restore := 'enrolled';
    end if;
    update kitluy_devices.devices
    set lifecycle_state = v_restore,
        restricted_from_state = null,
        restriction_reason = null,
        restricted_at = null,
        updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'restricted_investigation', v_restore,
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  elsif v_device.lifecycle_state = 'quarantined' then
    v_restore := 'enrolled';
    update kitluy_devices.devices
    set lifecycle_state = 'enrolled',
        quarantined_at = null,
        quarantine_reason = null,
        updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'quarantined', 'enrolled',
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  elsif v_device.lifecycle_state = 'suspended' then
    v_restore := case when v_current.prior_lifecycle_state in ('awaiting_trust', 'enrolled')
                      then v_current.prior_lifecycle_state
                      else 'enrolled' end;
    update kitluy_devices.devices
    set lifecycle_state = v_restore, updated_at = now()
    where id = p_device_id;
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, 'suspended', v_restore,
      'CONTAINMENT_CLEARED', p_actor_ref,
      jsonb_build_object('disposition', p_disposition, 'reason', p_reason));
  else
    v_restore := v_device.lifecycle_state;
  end if;

  -- Clear exactly the incident this containment opened — never someone
  -- else's investigation.
  if v_current.incident_id is not null then
    update kitluy_devices.device_trust_incidents
    set cleared_at = now(),
        cleared_by_operator_ref = p_actor_ref,
        clearance_reason = format('%s: %s', p_disposition, p_reason)
    where id = v_current.incident_id and cleared_at is null;
  end if;

  update kitluy_devices.device_containment_states
  set containment_state = 'none',
      cleared_at = now(),
      cleared_by_ref = p_actor_ref,
      clearance_approved_by_ref = p_approved_by_ref,
      disposition = p_disposition,
      clearance_reason = p_reason,
      updated_at = now()
  where device_id = p_device_id;

  insert into kitluy_devices.device_containment_events
    (device_id, event_type, containment_state, reason, actor_ref,
     approved_by_ref, evidence_ref, command_ref, correlation_id, detail)
  values
    (p_device_id, 'CONTAINMENT_CLEARED', 'none', p_reason, p_actor_ref,
     p_approved_by_ref, p_evidence_ref, p_command_ref, p_correlation_id,
     jsonb_build_object('disposition', p_disposition,
                        'restored_lifecycle_state', v_restore::text));

  return jsonb_build_object('outcome', 'CLEARED',
                            'disposition', p_disposition,
                            'restored_lifecycle_state', v_restore::text);
end;
$recover$;

comment on function kitluy_devices.clear_device_containment_v1(uuid, text, text, text, text, text, text, uuid) is
  'Group 0181 re-creation of the 0177 door: identical contract, DEVICES-FIRST lock order (T007 race family 11 found the apply/clear AB/BA deadlock). Four-eyes recovery with §10 runbook classifications; lifecycle restored only through the legal matrix.';

reset role;

-- ----------------------------------------------------------------------------
-- 2. assign_release_v1 — the idempotency race converges instead of escaping.
-- ----------------------------------------------------------------------------
set local role kitluy_release_governor;

create or replace function kitluy_releases.assign_release_v1(
  p_release uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_environment text,
  p_device_id uuid,
  p_idempotency_key text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $assign$
declare
  v_rel kitluy_releases.release_artifacts;
  v_campaign uuid;
  v_existing kitluy_releases.rollout_campaigns;
begin
  select * into v_rel from kitluy_releases.release_artifacts where id = p_release;
  if not found then
    raise exception 'KLUY-RELEASE-UNKNOWN: release % does not exist', p_release using errcode = 'P0001';
  end if;
  if v_rel.state not in ('internal', 'pilot', 'stable') then
    raise exception 'KLUY-RELEASE-NOT-ELIGIBLE: a % release is not assignable', v_rel.state
      using errcode = 'P0001';
  end if;
  if v_rel.environment <> p_environment then
    raise exception 'KLUY-RELEASE-WRONG-ENVIRONMENT: release targets %, not %', v_rel.environment, p_environment
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    raise exception 'KLUY-RELEASE-IDENTITY-REQUIRED: assignment carries an idempotency key'
      using errcode = 'P0001';
  end if;
  select * into v_existing from kitluy_releases.rollout_campaigns
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.artifact_id = p_release then
      return jsonb_build_object('outcome', 'EXISTING', 'campaign_id', v_existing.id);
    end if;
    raise exception 'KLUY-RELEASE-IDEMPOTENCY-CONFLICT: key % was used for a different assignment', p_idempotency_key
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from kitluy_devices.device_assignments a
                  where a.device_id = p_device_id
                    and a.state in ('pending_trust', 'active')
                    and a.tenant_id = p_tenant_id
                    and a.digital_store_id = p_digital_store_id) then
    raise exception 'KLUY-RELEASE-WRONG-STORE: device % is not assigned to the named Tenant and Store', p_device_id
      using errcode = 'P0001';
  end if;
  -- T007 family-15 correction: the SELECT above cannot see a concurrent
  -- uncommitted winner, so the INSERT must own the race. A unique_violation
  -- here IS the idempotent replay arriving early — converge on the winner's
  -- row exactly as the sequential path would have.
  begin
    insert into kitluy_releases.rollout_campaigns
      (artifact_id, channel, tenant_id, digital_store_id, store_location_id,
       environment, idempotency_key)
    values
      (p_release, v_rel.channel, p_tenant_id, p_digital_store_id,
       p_store_location_id, p_environment, p_idempotency_key)
    returning id into v_campaign;
  exception when unique_violation then
    select * into v_existing from kitluy_releases.rollout_campaigns
     where idempotency_key = p_idempotency_key;
    if found and v_existing.artifact_id = p_release then
      return jsonb_build_object('outcome', 'EXISTING', 'campaign_id', v_existing.id);
    end if;
    raise exception 'KLUY-RELEASE-IDEMPOTENCY-CONFLICT: key % was used for a different assignment', p_idempotency_key
      using errcode = 'P0001';
  end;
  insert into kitluy_releases.device_installations
    (campaign_id, device_id, desired_version)
  values (v_campaign, p_device_id, v_rel.version);
  perform kitluy_releases.record_release_event(
    p_release, 'RELEASE_ASSIGNED', v_rel.state, v_rel.state, btrim(p_actor_ref), null,
    jsonb_build_object('campaign_id', v_campaign, 'device_id', p_device_id),
    v_rel.correlation_id);
  return jsonb_build_object('outcome', 'ASSIGNED', 'campaign_id', v_campaign);
end;
$assign$;

comment on function kitluy_releases.assign_release_v1(uuid, uuid, uuid, uuid, text, uuid, text, text) is
  'Group 0181 re-creation of the 0180 door: identical contract; the idempotency-key race now converges on the winner (EXISTING) or the governed conflict sentinel instead of escaping as a raw unique violation (T007 race family 15).';

reset role;

-- Hand back both borrows.
do $handback$
begin
  execute format('revoke kitluy_fleet_governor from %I', current_user);
  execute format('revoke kitluy_release_governor from %I', current_user);
end
$handback$;

-- ----------------------------------------------------------------------------
-- On-apply guard.
-- ----------------------------------------------------------------------------
do $guard$
begin
  if pg_get_userbyid((select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_devices' and p.proname = 'clear_device_containment_v1'))
     <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-MIGRATION-0181: the containment door lost its governor owner';
  end if;
  if pg_get_userbyid((select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_releases' and p.proname = 'assign_release_v1'))
     <> 'kitluy_release_governor' then
    raise exception 'KLUY-MIGRATION-0181: the assignment door lost its governor owner';
  end if;
  if not (pg_get_functiondef((select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_releases' and p.proname = 'assign_release_v1'))
       like '%unique_violation%') then
    raise exception 'KLUY-MIGRATION-0181: the assignment door is missing the race convergence';
  end if;
  raise notice 'KLUY-MIGRATION-0181: T007 concurrency corrections installed (containment lock order unified; assignment idempotency race converges)';
end
$guard$;
