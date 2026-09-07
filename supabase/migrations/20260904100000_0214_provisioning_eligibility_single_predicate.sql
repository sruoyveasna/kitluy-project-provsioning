-- kitluy:migration:0214
--
-- ONE DEFINITION OF "PROVISIONING ELIGIBLE": Admin approval counts in development
-- =============================================================================
-- Authority: KLD-2026-09-03-FACTORY-ENROLLMENT-001 (Factory Enrollment makes a
-- board eligible for provisioning only; Admin approval is the decision);
-- program decision 8 default recorded in KLD-2026-09-04-TERMINAL-PROVISIONING-
-- CLARIFICATIONS-001 (Admin approval evidence counts as factory QA in
-- development and pilot); reconciliation deviation (2) under
-- KLD-2026-09-03-FACTORY-ENROLLMENT-001 (three definitions disagreed).
--
-- WHAT CHANGES
-- ------------
-- evaluate_provisioning_eligibility_v1 keeps its signature and every other
-- limb. Its factory-QA limb becomes: a passed QA execution for the current
-- enrollment, OR a HET_HARDWARE_VERIFIED_AND_APPROVED lifecycle event for the
-- current enrollment whose environment is development or pilot. Production
-- still requires a QA record. The first real Pi Terminal (2026-09-03) was
-- approved by an Admin with reason and evidence and still read "no factory QA
-- execution is recorded", which is the disagreement this group removes: the
-- terminal pairing door (0213) and the management API both read this function
-- now, so there is one answer.

begin;

create or replace function kitluy_devices.evaluate_provisioning_eligibility_v1(
  p_device_id uuid
) returns table (eligible boolean, reasons text[])
language plpgsql
stable
as $$
declare
  v_reasons text[] := '{}';
  v_device kitluy_devices.devices;
  v_qa kitluy_devices.factory_qa_executions;
  v_manifest_sealed boolean;
  v_active_assignments integer;
  v_open_incidents integer;
  v_collisions integer;
  v_containment text;
  v_enrollment_created_at timestamptz;
  v_admin_approved boolean;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id;
  if not found then
    return query select false, array['device record does not exist'];
    return;
  end if;

  -- Claimable lifecycles are taken from create_device_claim_v1, which admits
  -- enrolled AND awaiting_trust. They must agree (see group 0188).
  if v_device.lifecycle_state not in ('enrolled', 'awaiting_trust') then
    v_reasons := v_reasons || format(
      'lifecycle is ''%s''; only an ''enrolled'' or ''awaiting_trust'' device may enter provisioning',
      v_device.lifecycle_state);
  end if;

  select count(*)::integer into v_active_assignments
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state in ('pending_trust', 'active');
  if v_active_assignments > 0 then
    v_reasons := v_reasons || 'device already holds an active assignment; it is not factory inventory'::text;
  end if;

  select exists (
    select 1
    from kitluy_devices.manufacturing_enrollments e
    join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
    where e.id = v_device.current_enrollment_id and e.state = 'sealed'
  ) into v_manifest_sealed;
  if not coalesce(v_manifest_sealed, false) then
    v_reasons := v_reasons || 'hardware manifest is not sealed'::text;
  end if;

  -- Factory QA, or Admin approval evidence in development and pilot. The
  -- approval event is bound to the CURRENT enrollment: a re-enrolled board is
  -- new inventory and needs a new decision.
  select e.created_at into v_enrollment_created_at
    from kitluy_devices.manufacturing_enrollments e
   where e.id = v_device.current_enrollment_id;
  select * into v_qa from kitluy_devices.current_factory_qa_v1(p_device_id);
  select exists (
    select 1
      from kitluy_devices.device_lifecycle_events le
     where le.device_id = p_device_id
       and le.to_state = 'enrolled'
       and le.reason_code = 'HET_HARDWARE_VERIFIED_AND_APPROVED'
       and coalesce(le.detail ->> 'environment', '') in ('development', 'pilot')
       and v_enrollment_created_at is not null
       and le.occurred_at >= v_enrollment_created_at
  ) into v_admin_approved;
  if v_qa.id is not null and v_qa.result = 'passed' then
    null;
  elsif coalesce(v_admin_approved, false) then
    null;
  elsif v_qa.id is not null then
    v_reasons := v_reasons || format('factory QA failed (%s)', coalesce(v_qa.failure_reason_code, 'unspecified'));
  else
    v_reasons := v_reasons || 'no passed factory QA execution and no HET approval evidence for the current enrollment (production requires factory QA)'::text;
  end if;

  select count(*)::integer into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_id
    and cleared_at is null
    and incident_type <> 'activation_blocked';
  if v_open_incidents > 0 then
    v_reasons := v_reasons || format('%s open trust incident(s)', v_open_incidents);
  end if;

  select count(*)::integer into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    v_reasons := v_reasons || 'hardware evidence collides with another device record'::text;
  end if;

  select containment_state::text into v_containment
  from kitluy_devices.device_containment_states
  where device_id = p_device_id and cleared_at is null
  limit 1;
  if v_containment is not null then
    v_reasons := v_reasons || format('device is under containment (%s)', v_containment);
  end if;

  return query select (array_length(v_reasons, 1) is null), v_reasons;
end;
$$;

comment on function kitluy_devices.evaluate_provisioning_eligibility_v1(uuid) is
  'Group 0214 (supersedes 0188). The single fail-closed predicate for entering Store provisioning: claimable lifecycle, no live assignment, sealed manifest, no open incident, no evidence collision, no containment, and factory QA passed OR (development and pilot only) an HET approval event for the current enrollment. Returns every reason so an operator sees why. Read by the terminal pairing door (0213) and by the management API; nothing else defines eligibility.';

do $guard$
begin
  if position('HET_HARDWARE_VERIFIED_AND_APPROVED' in pg_get_functiondef('kitluy_devices.evaluate_provisioning_eligibility_v1(uuid)'::regprocedure)) = 0 then
    raise exception 'KLUY-MIGRATION-0214: the predicate does not read approval evidence'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'devices'
       and column_name in ('provisioning_eligible', 'eligibility')) then
    raise exception 'KLUY-MIGRATION-0214: eligibility must stay derived, never stored'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('service_role', 'kitluy_devices.evaluate_provisioning_eligibility_v1(uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0214: service_role lost execute on the predicate'
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0214: one provisioning-eligibility predicate (approval evidence counts in development and pilot)';
end
$guard$;

commit;
