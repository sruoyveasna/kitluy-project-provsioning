-- ===========================================================================
-- 0235 — registration releases a re-flashed board itself (DEVELOPMENT only)
-- ===========================================================================
-- 0234 built the door; nothing called it, so an operator still ran
-- `dev:device:unassign` after every development reflash. This is the caller —
-- and it resolves the environment from the DEVICE'S OWN governed records rather
-- than being told, so no environment variable, deployment setting or caller
-- argument can turn this on where it must never run.
--
-- WHY THE ENVIRONMENT IS NOT A PARAMETER HERE
-- -------------------------------------------
-- The one caller is `supabase/functions/device-registration`, an unauthenticated
-- edge function that a board reaches before it holds any credential. Giving that
-- function an environment flag would make a production release of a KitLuy fleet
-- one mis-set variable away from automatically releasing Store assignments. The
-- database already knows, per device, which environment it belongs to:
--
--   1. its live assignment projection  (`device_assignment_projections`), the
--      record the release is about to withdraw, and
--   2. failing that, its credential head (`device_credential_heads`).
--
-- Unknown fails CLOSED: a device with neither is not released, and registration
-- is unaffected either way.
--
-- WHAT THIS DOES NOT DO
-- ---------------------
-- It does not re-assign, and it does not decide trust. 0234's gates all still
-- apply — reflash evidence, containment, open trust incidents, idempotence —
-- and the Partner pairing code remains the transition that says this board may
-- serve this Store.
-- ===========================================================================

set local role kitluy_fleet_governor;

create or replace function kitluy_devices.release_reflashed_device_for_repair_auto_v1(
  p_device_id uuid,
  p_actor text
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, public
as $$
declare
  v_environment text;
begin
  -- The environment this DEVICE belongs to, from the records the fleet governs.
  select p.environment into v_environment
    from kitluy_devices.device_assignment_projections p
   where p.device_id = p_device_id
   limit 1;

  if v_environment is null then
    select h.environment into v_environment
      from kitluy_devices.device_credential_heads h
     where h.device_record_id = p_device_id
     order by h.updated_at desc
     limit 1;
  end if;

  -- FAIL CLOSED. A board whose environment cannot be proven is never released:
  -- registration still succeeds, and an operator releases it the way they
  -- always have.
  if v_environment is null then
    return jsonb_build_object(
      'released', false,
      'reason', 'KLUY-REFLASH-RELEASE-ENVIRONMENT-UNKNOWN',
      'detail', 'this device carries no assignment projection and no credential head to prove its environment');
  end if;

  return kitluy_devices.release_reflashed_device_for_repair_v1(
    p_device_id, v_environment, coalesce(p_actor, 'device/self-registration'));
end;
$$;

comment on function kitluy_devices.release_reflashed_device_for_repair_auto_v1 is
  'DEVELOPMENT ONLY, and it proves that itself: resolves the device''s environment from its own assignment projection or credential head — never from a caller argument or a deployment variable — and delegates to release_reflashed_device_for_repair_v1 (0234). Unknown environment fails closed. Called by the device-registration edge function after a same-board reflash so a development bench needs no dev:device:unassign. It never re-assigns; the Partner pairing code remains the trust transition. KLD-2026-09-23-DEVICE-CONTINUITY-RULE-001.';

revoke all on function kitluy_devices.release_reflashed_device_for_repair_auto_v1(uuid, text) from public;
grant execute on function kitluy_devices.release_reflashed_device_for_repair_auto_v1(uuid, text)
  to kitluy_device_registration_service;

reset role;
