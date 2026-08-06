-- kitluy:group:0182
-- ============================================================================
-- WS-11-T008 — release-assignment identity correction (independent review
-- finding F-5).
--
-- DEFECT (pre-existing in group 0180, faithfully preserved by 0181, FOUND BY
-- Reviewer A): assign_release_v1 treated an idempotency key as matching when
-- only the ARTIFACT agreed. Reproduced: the same key with the same release
-- but a DIFFERENT device returns outcome EXISTING carrying the FIRST
-- device's campaign — the second device's installation is silently dropped,
-- with no refusal and no evidence. A fleet operator scripting a rollout with
-- one key per release (rather than per device) would believe every terminal
-- was targeted while only the first ever was.
--
-- CORRECTION: an idempotency key identifies ONE request. A replay converges
-- on EXISTING only when the artifact, the full Tenant/Store/Location scope,
-- the environment AND the device all match; any other reuse of the key is
-- the governed KLUY-RELEASE-IDEMPOTENCY-CONFLICT refusal that the door
-- already raises for a different artifact. The concurrent-insert convergence
-- added by 0181 (T007 race family 15) is preserved and applies the same
-- comparison, so the race path and the sequential path cannot disagree.
--
-- Authority: security test system §19 (T008 remediation protocol — smallest
-- correction, forward migration, previous migrations immutable); group 0180
-- (release authority); group 0181 (race convergence).
-- ============================================================================

do $borrow$
begin
  execute format('grant kitluy_release_governor to %I', current_user);
end
$borrow$;

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

  -- T008 F-5: the key identifies the WHOLE request, not just the artifact.
  select * into v_existing from kitluy_releases.rollout_campaigns
   where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.artifact_id = p_release
       and v_existing.tenant_id = p_tenant_id
       and v_existing.digital_store_id = p_digital_store_id
       and v_existing.store_location_id = p_store_location_id
       and v_existing.environment = p_environment
       and exists (select 1 from kitluy_releases.device_installations i
                    where i.campaign_id = v_existing.id and i.device_id = p_device_id) then
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

  -- Group 0181 (T007 family 15): the SELECT above cannot see a concurrent
  -- uncommitted winner, so the INSERT owns the race. The convergence uses
  -- the SAME full-identity comparison, so a concurrent replay and a
  -- sequential replay can never disagree.
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
    if found
       and v_existing.artifact_id = p_release
       and v_existing.tenant_id = p_tenant_id
       and v_existing.digital_store_id = p_digital_store_id
       and v_existing.store_location_id = p_store_location_id
       and v_existing.environment = p_environment
       and exists (select 1 from kitluy_releases.device_installations i
                    where i.campaign_id = v_existing.id and i.device_id = p_device_id) then
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
  'Group 0182 (WS-11-T008 F-5) re-creation: an idempotency key identifies the WHOLE request. EXISTING is returned only when artifact, scope, environment AND device all match; any other reuse is the governed conflict refusal. The 0181 concurrent-insert convergence is preserved and shares the same comparison.';

reset role;

do $handback$
begin
  execute format('revoke kitluy_release_governor from %I', current_user);
end
$handback$;

do $guard$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_releases' and p.proname = 'assign_release_v1';
  if pg_get_userbyid((select proowner from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_releases' and p.proname = 'assign_release_v1'))
     <> 'kitluy_release_governor' then
    raise exception 'KLUY-MIGRATION-0182: the assignment door lost its governor owner';
  end if;
  if v_def not like '%device_installations i%' then
    raise exception 'KLUY-MIGRATION-0182: the identity comparison does not include the device';
  end if;
  if v_def not like '%unique_violation%' then
    raise exception 'KLUY-MIGRATION-0182: the 0181 race convergence was lost';
  end if;
  raise notice 'KLUY-MIGRATION-0182: assignment identity corrected (an idempotency key identifies artifact, scope, environment AND device)';
end
$guard$;
