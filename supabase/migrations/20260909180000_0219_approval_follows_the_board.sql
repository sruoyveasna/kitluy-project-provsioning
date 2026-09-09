-- ============================================================================
-- 0219  An approval follows the physical board, and a recovering board may pair
-- ============================================================================
-- Authority: group 0214 owns this predicate; this restates its body with two
--   changes. Companion to 0218. Defect found on hardware 2026-09-09.
--
-- WHY 0218 WAS NOT ENOUGH
-- ----------------------------------------------------------------------------
-- 0218 taught the pairing doors to tell RECOVERY from THEFT. But this predicate
-- runs BEFORE them, and refused first -- so a re-flashed board was told "not an
-- approved, eligible terminal" and the door that would have recovered it never
-- ran. Two separate reasons, both wrong for the same board coming back:
--
--   1. "no HET approval evidence for the CURRENT enrollment"
--   2. "device already holds an active assignment; it is not factory inventory"
--
-- (1) THE APPROVAL FOLLOWS THE BOARD
-- ----------------------------------------------------------------------------
-- Re-flashing rotates the registration credential, and `register_device_v1`
-- records a new enrolment that SUPERSEDES the old one, with the reason
-- "registration credential rotated while still pending approval". The board is
-- unchanged: `resolve_device_by_board_evidence_v1` matched it on board_serial,
-- which is why it is the same device record at all.
--
-- HET approved that HARDWARE. Rotating a software key does not make it
-- different hardware, so the approval now counts against the FIRST enrolment in
-- the supersession chain rather than the newest link in it.
--
-- What still requires a fresh decision: a genuinely new enrolment, which starts
-- a new chain (`supersedes_enrollment_id` null) and therefore does not inherit.
-- That is the case the original rule was written for -- "a re-enrolled board is
-- new inventory" -- and it is unchanged.
--
-- (2) A RECOVERING BOARD IS NOT "ALREADY ASSIGNED"
-- ----------------------------------------------------------------------------
-- The check exists to keep FACTORY INVENTORY from being provisioned twice. A
-- board at `awaiting_trust` has already been paired and is coming back for the
-- seat it holds; the 0218 doors then verify it is the same device and refuse
-- otherwise. A board at `enrolled` with a live assignment is still refused.
--
-- NOT CHANGED: production and disaster_recovery still require a passed factory
-- QA execution; open trust incidents still refuse; hardware evidence collisions
-- still refuse; the lifecycle gate is untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION kitluy_devices.evaluate_provisioning_eligibility_v1(p_device_id uuid)
 RETURNS TABLE(eligible boolean, reasons text[])
 LANGUAGE plpgsql
 STABLE
AS $function$
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
  -- A device RECOVERING its own assignment is not "already assigned" in the
  -- sense this check was written for. `consume_terminal_pairing_session_v1` and
  -- `redeem_device_claim_v1` (group 0218) now distinguish a re-pair by the same
  -- board from a second board taking a seat, and THEY are the real gate. This
  -- predicate runs FIRST and, refusing here, meant 0218 could never be reached:
  -- a re-flashed board was told "not an approved, eligible terminal" before the
  -- door that would have recovered it ever ran.
  --
  -- Still refused when the assignment belongs to a DIFFERENT device, which
  -- cannot happen through this column but is asserted by the doors regardless.
  if v_active_assignments > 0 and v_device.lifecycle_state <> 'awaiting_trust' then
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
  -- The FIRST enrolment in this board's supersession chain, not the current one.
  --
  -- A device record IS one physical board: `resolve_device_by_board_evidence_v1`
  -- matches on board_serial, so every enrolment chained by
  -- `supersedes_enrollment_id` belongs to the same hardware. HET approved that
  -- hardware; rotating a software key does not make it different hardware.
  with recursive chain as (
    select e.id, e.created_at, e.supersedes_enrollment_id
      from kitluy_devices.manufacturing_enrollments e
     where e.id = v_device.current_enrollment_id
    union all
    select prev.id, prev.created_at, prev.supersedes_enrollment_id
      from kitluy_devices.manufacturing_enrollments prev
      join chain c on c.supersedes_enrollment_id = prev.id
  )
  select min(created_at) into v_enrollment_created_at from chain;
  select * into v_qa from kitluy_devices.current_factory_qa_v1(p_device_id);
  select exists (
    select 1
      from kitluy_devices.device_lifecycle_events le
     where le.device_id = p_device_id
       and le.to_state = 'enrolled'
       and le.reason_code = 'HET_HARDWARE_VERIFIED_AND_APPROVED'
       and coalesce(le.detail ->> 'environment', '') in ('local', 'development', 'pilot')
       and v_enrollment_created_at is not null
       -- Against the enrolment at the ROOT of the supersession chain, not the
       -- current one. See the header: a credential rotation is the same board.
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
$function$;
