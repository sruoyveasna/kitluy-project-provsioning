-- ===========================================================================
-- 0234 — a SAME-BOARD reflash releases its own assignment, in DEVELOPMENT only
-- ===========================================================================
-- Owner decision KLD-2026-09-23-DEVICE-CONTINUITY-RULE-001: a KitLuy device is
-- the PHYSICAL Raspberry Pi, not its SD card. A reflash of the same board is a
-- RECOVERY of the same device, and development reflashing should approach
-- "flash, insert, power on, wait, ready".
--
-- WHAT STOOD IN THE WAY
-- ---------------------
-- Identity continuity is already solved and does not change here: 0197's
-- `resolve_device_by_board_evidence_v1` recognises the board by `board_serial`
-- and `register_device_v1` keeps the same `devices.id`, opening a new
-- installation and a superseding enrollment. What a re-flashed board could NOT
-- do is go back to work: it comes back `active` (or `awaiting_trust`) holding a
-- live assignment, and
--
--   * `evaluate_hub_pairing_session_v1` (0194) admits `enrolled` ONLY — and
--     spends one of five attempts on every refusal, so a Hub typing its code
--     before an operator released it burns the code;
--   * `reserve_reflash_credential_recovery_v1` (0224) requires `awaiting_trust`
--     and a live assignment at the device's CURRENT generation.
--
-- The release that unblocks both is `revoke_device_assignment_v1`, which an
-- operator runs by hand (`pnpm dev:device:unassign`). On a development bench
-- that hand is the whole cost of a reflash.
--
-- WHAT THIS DOES, AND WHAT IT REFUSES TO DO
-- -----------------------------------------
-- It automates exactly that one operator step, for exactly the case the owner
-- ruled on: THIS board, returning with a NEW installation, in DEVELOPMENT.
-- It does NOT re-assign anything. The pairing code is still required, and the
-- Partner still issues it — that is the trust transition which decides that
-- this board may serve this Store, and it is deliberately kept. Nothing here
-- runs in any other environment.
--
-- THE HONEST SECURITY NOTE
-- ------------------------
-- Recognition is by `board_serial`, which the device SELF-REPORTS. A device on
-- the same network that claims another board's serial can therefore make this
-- door release that board's assignment — a denial of service, not a takeover:
-- it still cannot pair without a code, cannot recover a credential (0224 binds
-- the identity key of the device's current enrollment), and cannot activate
-- (0225 binds the certificate to the current enrollment). That residual is why
-- the door is refused outside development, and why the assignment is released
-- rather than transferred.
-- ===========================================================================

set local role kitluy_fleet_governor;

create or replace function kitluy_devices.release_reflashed_device_for_repair_v1(
  p_device_id uuid,
  p_environment text,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, public
as $$
declare
  v_device kitluy_devices.devices;
  v_current kitluy_devices.manufacturing_enrollments;
  v_assignment_id uuid;
  v_released integer := 0;
begin
  -- 1. DEVELOPMENT ONLY. First, before anything is read or written, so no other
  --    condition can be mistaken for the one that protects a real Store.
  if p_environment is distinct from 'development' then
    return jsonb_build_object(
      'released', false,
      'reason', 'KLUY-REFLASH-RELEASE-NOT-DEVELOPMENT',
      'detail', format('environment is %L; a device is released for re-pairing by an operator outside development', p_environment));
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    return jsonb_build_object('released', false, 'reason', 'KLUY-REFLASH-RELEASE-DEVICE-MISSING');
  end if;

  -- 2. Only a device that is actually holding a live assignment has anything to
  --    release. Anything else is already re-pairable and must not be touched.
  select id into v_assignment_id
    from kitluy_devices.device_assignments
   where device_id = p_device_id and state in ('pending_trust', 'active');
  if v_assignment_id is null then
    return jsonb_build_object('released', false, 'reason', 'KLUY-REFLASH-RELEASE-NOTHING-TO-RELEASE');
  end if;

  -- 3. THE REFLASH EVIDENCE. The same clock-free proof 0224 uses: this board's
  --    CURRENT enrollment must supersede an earlier one. A board that never had
  --    its card replaced has no ancestor and is not released — this door is for
  --    recovery, never for taking a working device out of service.
  select * into v_current
    from kitluy_devices.manufacturing_enrollments
   where id = v_device.current_enrollment_id;
  if not found or v_current.supersedes_enrollment_id is null then
    return jsonb_build_object('released', false, 'reason', 'KLUY-REFLASH-RELEASE-NO-REFLASH-EVIDENCE');
  end if;

  -- 4. Never route around containment. A device under review or investigation is
  --    exactly the device an automatic release must not help.
  if v_device.lifecycle_state in ('retired', 'replaced', 'quarantined', 'restricted_investigation') then
    return jsonb_build_object(
      'released', false,
      'reason', 'KLUY-REFLASH-RELEASE-DEVICE-CONTAINED',
      'detail', v_device.lifecycle_state::text);
  end if;
  if exists (
    select 1 from kitluy_devices.device_trust_incidents
     where device_id = p_device_id and cleared_at is null
  ) then
    return jsonb_build_object('released', false, 'reason', 'KLUY-REFLASH-RELEASE-OPEN-TRUST-INCIDENT');
  end if;

  -- 5. The release itself is the EXISTING governed one, called rather than
  --    re-implemented, so the projection withdrawal, the claim death, the
  --    generation-0 rule and the lifecycle event all stay in one place (0121).
  v_released := kitluy_devices.revoke_device_assignment_v1(
    p_device_id, 'SD_CARD_REFLASH', coalesce(p_actor, 'kitluy.same-board-reflash'));

  return jsonb_build_object(
    'released', v_released > 0,
    'reason', 'KLUY-REFLASH-RELEASE-DONE',
    'assignment_id', v_assignment_id,
    'device_record_id', p_device_id,
    'detail', 'the board keeps its device_record_id; a Partner pairing code still decides that it may serve this Store');
end;
$$;

comment on function kitluy_devices.release_reflashed_device_for_repair_v1 is
  'DEVELOPMENT ONLY. Releases the live assignment of a device whose CURRENT enrollment supersedes an earlier one — the same board, returning on a fresh card — so it can present a pairing code again without an operator running dev:device:unassign. Refuses outside development, without reflash evidence, for a contained device, for an open trust incident, and when there is nothing live to release. It never re-assigns: the pairing code remains the trust transition. KLD-2026-09-23-DEVICE-CONTINUITY-RULE-001.';

revoke all on function kitluy_devices.release_reflashed_device_for_repair_v1(uuid, text, text) from public;
grant execute on function kitluy_devices.release_reflashed_device_for_repair_v1(uuid, text, text)
  to kitluy_device_registration_service;

reset role;
