-- kitluy:migration:0198
--
-- THE ACTIVATION COMPOSITION IDENTITY, AND A BRIDGE TO TRUSTED TIME
-- =============================================================================
-- Authority: KLD-2026-07-28-002 (BLK-005) — "development certificate
-- implementation AUTHORIZED"; KLREC-2026-08-11-EDGE-004 §2 and §3, which record
-- that development activation is NOT blocked by PKI and that the real gate is
-- trusted time; the 0127/0172/0192/0193 composition pattern this copies.
--
-- WHY THIS EXISTS
-- ---------------
-- A paired Store Hub rests at `awaiting_trust` and nothing in the product ever
-- moves it. `attempt_activate_device_v1` has no non-test caller anywhere, and
-- neither does the device-side `trusted-time-gateway`. So the last governed step
-- of the device lifecycle was modelled, implemented in the database, and then
-- never reachable.
--
-- The blocker was never certificates. Group 0122 §5 inserted an ACTIVE
-- development `pki_trust_configuration` row when the owner approved BLK-005, so
-- `assert_pki_configuration_approved('development')` already succeeds and
-- `issue_device_certificate_v1` already exists. What is missing is that a device
-- cannot prove what time it is, and every certificate window, revocation
-- snapshot age and offline grace check downstream reads that clock.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- It does not weaken the pilot or production gates. `attempt_activate_device_v1`
-- refuses those environments inside itself under BLK-005, and nothing here can
-- reach past that: this group hands out EXECUTE, not approval. It also adds no
-- time SOURCE — the sources a caller may offer are decided by
-- `evaluate_trusted_time_v1` (group 0123), unchanged.

begin;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The composition identity.
-- -----------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_activation_service') then
    create role kitluy_activation_service nologin;
  end if;
end
$role$;

comment on role kitluy_activation_service is
  'Group 0198. The device-activation composition identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the device-registry service connecting as service_role, exactly like kitluy_hub_pairing_service (0192) and kitluy_hub_issuance_service (0193). Holds EXECUTE on exactly two capabilities — establish_device_trusted_time_v1 and attempt_activate_device_v1 — and NOTHING else: no table access, no certificate issuance, no claim door. Holding these is never approval: attempt_activate_device_v1 refuses pilot and production inside itself under BLK-005, and this identity cannot reach past that.';

grant kitluy_activation_service to service_role;
grant usage on schema kitluy_devices to kitluy_activation_service;

-- -----------------------------------------------------------------------------
-- 2. The trusted-time bridge.
-- -----------------------------------------------------------------------------
-- `evaluate_trusted_time_v1` is NOT a SECURITY DEFINER — it runs as its caller
-- and writes the device's trusted-time state directly, so it only works for a
-- caller holding those table privileges. Identical to the problem groups 0192 and
-- 0193 met with redemption and issuance, and solved the same way: a definer owned
-- by `postgres`, whose body is one call.
--
-- The bridge decides NOTHING. Every source, the environment and the correlation
-- id are arguments; the floor, the tolerance and the status all stay in group
-- 0123 where they belong.
create or replace function kitluy_devices.establish_device_trusted_time_v1(
  p_device_id uuid,
  p_environment text,
  p_valid_rtc_time timestamptz,
  p_authenticated_network_time timestamptz,
  p_valid_signed_token_time timestamptz,
  p_correlation_id uuid
) returns kitluy_devices.trusted_time_outcome
language sql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
  select kitluy_devices.evaluate_trusted_time_v1(
           p_device_id, p_environment, p_valid_rtc_time,
           p_authenticated_network_time, p_valid_signed_token_time, p_correlation_id)
$$;

comment on function kitluy_devices.establish_device_trusted_time_v1 is
  'Group 0198. A SECURITY DEFINER privilege bridge to evaluate_trusted_time_v1 (0123), which is not a definer and therefore requires its caller to hold direct table privileges. Exists so the activation composition can establish a device''s trusted time while holding NO table access of its own. Adds no authority and no time source: the floor, the tolerance, the anomaly classification and the status all remain in group 0123. Granted to kitluy_activation_service ONLY.';

alter function kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)
  owner to postgres;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from public;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from anon;
revoke all on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid) from authenticated;
grant execute on function kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)
  to kitluy_activation_service;

-- -----------------------------------------------------------------------------
-- 3. Activation itself.
-- -----------------------------------------------------------------------------
-- Already a definer owned by `kitluy_activation_governor`, so a plain grant is
-- enough — no bridge needed, and none is invented.
grant execute on function kitluy_devices.attempt_activate_device_v1(uuid, text, text)
  to kitluy_activation_service;

-- -----------------------------------------------------------------------------
-- 3a. Close a gap group 0197 left open.
-- -----------------------------------------------------------------------------
-- `resolve_device_by_board_evidence_v1` is a SECURITY DEFINER owned by `postgres`
-- and group 0197 never revoked the function default, which for a function is
-- EXECUTE to **PUBLIC**. So `anon` could call a definer running with the table
-- owner's privileges and ask "have I seen this physical board?" — an
-- unauthenticated device-existence oracle over board serials.
--
-- Found by this group's capability assertion, not by review: the activation role
-- was reported as holding one capability too many, and the extra one was this.
-- That is the second time the "exactly N capabilities" guard has caught a PUBLIC
-- default left behind by an earlier group in this chain (see 0192 §2b).
--
-- It has no legitimate external caller. `register_device_v1` invokes it INSIDE
-- its own definer body at 0197:333, which runs as `postgres` and therefore keeps
-- working after this revoke — the registration intake is unaffected.
revoke all on function kitluy_devices.resolve_device_by_board_evidence_v1(jsonb) from public;
revoke all on function kitluy_devices.resolve_device_by_board_evidence_v1(jsonb) from anon;
revoke all on function kitluy_devices.resolve_device_by_board_evidence_v1(jsonb) from authenticated;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 4. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
begin
  if not exists (
    select 1 from pg_roles where rolname = 'kitluy_activation_service' and not rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0198: the activation role is missing or can log in'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_activation_service')) then
    raise exception 'KLUY-MIGRATION-0198: the activation role must be a member of NOTHING'
      using errcode = 'P0001';
  end if;

  -- EXACTLY two capabilities. Trigger functions excluded for the reason group
  -- 0192 records: a `returns trigger` function raises outside a trigger, so
  -- reaching one grants nothing.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_activation_service', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname not in ('establish_device_trusted_time_v1', 'attempt_activate_device_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0198: the activation role can execute % function(s) beyond its two capabilities', v_extra
      using errcode = 'P0001';
  end if;

  -- It must NOT be able to issue a certificate. Activation CONSUMES the trust
  -- decision; minting the credential is a separate authority under BLK-005 and
  -- one identity holding both would be able to manufacture trust end to end.
  if has_function_privilege('kitluy_activation_service', 'kitluy_devices.issue_device_certificate_v1(uuid, text, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0198: the activation role can also issue certificates'
      using errcode = 'P0001';
  end if;

  if has_table_privilege('kitluy_activation_service', 'kitluy_devices.devices', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_activation_service', 'kitluy_devices.device_assignments', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0198: the activation role holds direct table access'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'establish_device_trusted_time_v1'
       and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'KLUY-MIGRATION-0198: the trusted-time bridge is not a definer owned by postgres'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.establish_device_trusted_time_v1(uuid, text, timestamptz, timestamptz, timestamptz, uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0198: a browser-reachable role can establish trusted time'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0198: device activation composition identity applied (two capabilities, no table reach, no certificate issuance)';
end
$guard$;

commit;
