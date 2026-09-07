-- kitluy:group:0207
-- =============================================================================
-- Group 0207 — C-5: activation is enforced, not advisory
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, verdict
-- REJECTED, critical finding C-5; owner remediation Phase 5;
-- KLD-2026-07-21-003 (activation is certificate-backed).
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `service_role` held INSERT and UPDATE on `kitluy_devices.devices`, so this
-- worked:
--
--     set role service_role;
--     update kitluy_devices.devices set lifecycle_state = 'active' where id = ...;
--
-- Measured on this database before the change: a device went from
-- `awaiting_trust` to `active` in one statement, with no trusted time, no
-- credential, no certificate and no activation record.
--
-- Everything groups 0201 and 0203 built — the certificate-backed predicate, the
-- key binding, the pinned chain — sat behind a door that was never the only way
-- in. It made certificate-backed activation ADVISORY: true of devices that went
-- through the front, and irrelevant to anything else.
--
-- =============================================================================
-- TWO LAYERS, BECAUSE ONE IS NOT ENOUGH
-- =============================================================================
-- 1. PRIVILEGE. `service_role` loses INSERT and UPDATE on `devices` and keeps
--    SELECT. Table privileges are checked for every identity, and — unlike row
--    security — they are NOT bypassed by `rolbypassrls`, which `service_role`
--    has. So this is the layer that actually binds the connection identity.
--
-- 2. A TRANSITION GUARD. A trigger refuses any move INTO `active` that is not
--    made by the activation authority, whoever the writer is. This covers the
--    roles that legitimately hold UPDATE for other reasons —
--    `kitluy_fleet_governor` moves devices for containment and retirement, and
--    must not be able to activate one as a side effect — and it covers whatever
--    is granted UPDATE next year by someone who never read this file.
--
-- Layer 1 alone would leave every other UPDATE-holder able to activate. Layer 2
-- alone would leave `service_role` free to write every OTHER column on the
-- table. Neither is redundant.
--
-- =============================================================================
-- WHO IS ALLOWED, AND HOW THAT WAS DETERMINED
-- =============================================================================
-- `activate_device_v1` is the only function in the schema that sets
-- `lifecycle_state = 'active'` on a device. It is SECURITY INVOKER and is
-- reached only through `attempt_activate_device_v1`, which is SECURITY DEFINER
-- owned by `kitluy_activation_governor` — so inside it, `current_user` is that
-- governor. The guard allows exactly that identity and nothing else.
--
-- Determined by reading `pg_proc` for every function whose body assigns that
-- state, not by assuming the list. The only other match was
-- `abandon_generation_key_v1`, which READS the device's state to refuse an
-- abandonment and never writes it.
--
-- =============================================================================
-- kitluy:destructive-approved:KLD-2026-08-26-ACTIVATION-ENFORCEMENT-001 -- the
-- REVOKE below withdraws write privileges that let the application connection
-- identity bypass the activation authority entirely. No data is dropped,
-- truncated or deleted, and SELECT is retained.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Privilege
-- -----------------------------------------------------------------------------
revoke insert, update, delete on kitluy_devices.devices from service_role;
revoke insert, update, delete on kitluy_devices.devices from anon;
revoke insert, update, delete on kitluy_devices.devices from authenticated;

-- -----------------------------------------------------------------------------
-- 2. The transition guard
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.guard_device_activation_authority()
returns trigger
language plpgsql
set search_path = pg_catalog, kitluy_devices
as $fn$
begin
  -- Only a transition INTO `active` is governed here. Every other lifecycle
  -- move has its own authority, and a guard that policed all of them would
  -- break containment and retirement for no security gain.
  if new.lifecycle_state = 'active'
     and old.lifecycle_state is distinct from new.lifecycle_state then
    -- `pg_has_role(..., 'usage')` rather than a name comparison, so the check
    -- still holds if the governor is reached through a future membership.
    if not pg_has_role(current_user, 'kitluy_activation_governor', 'usage') then
      raise exception
        'KLUY-DEVICE-ACTIVATION-AUTHORITY: % may not move device % to active; activation is certificate-backed and goes through attempt_activate_device_v1 (KLD-2026-07-21-003)',
        current_user, old.id
        using errcode = 'P0001',
              hint = 'Enter kitluy_activation_service and call kitluy_devices.attempt_activate_device_v1.';
    end if;
  end if;
  return new;
end;
$fn$;

drop trigger if exists devices_activation_authority_guard on kitluy_devices.devices;
create trigger devices_activation_authority_guard
  before update on kitluy_devices.devices
  for each row
  execute function kitluy_devices.guard_device_activation_authority();

comment on function kitluy_devices.guard_device_activation_authority() is
  'Group 0207 (C-5). Refuses any transition INTO lifecycle_state = active that is not made by the activation authority. Before this, service_role could activate a device with a bare UPDATE, which made the entire certificate-backed activation predicate advisory.';

-- -----------------------------------------------------------------------------
-- 3. Apply-time proof
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_privs text;
begin
  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)')
    into v_privs
    from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'kitluy_devices' and table_name = 'devices';
  if v_privs <> 'SELECT' then
    raise exception 'KLUY-MIGRATION-0207: service_role holds "%" on devices — expected SELECT only', v_privs
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.devices'::regclass
       and tgname = 'devices_activation_authority_guard'
       and not tgisinternal) then
    raise exception 'KLUY-MIGRATION-0207: the activation transition guard is missing'
      using errcode = 'P0001';
  end if;

  -- The activation authority itself must still pass the guard, or activation
  -- stops working entirely and the fix is worse than the finding.
  if not pg_has_role('kitluy_activation_governor', 'kitluy_activation_governor', 'usage') then
    raise exception 'KLUY-MIGRATION-0207: the activation governor would fail its own guard'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0207: C-5 CLOSED — awaiting_trust -> active goes through the activation authority or not at all';
end
$guard$;

commit;
