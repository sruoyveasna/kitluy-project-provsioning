-- kitluy:migration:0196
--
-- THE ISSUER COULD OPEN A SESSION BUT NOT READ ITS DEADLINE
-- =============================================================================
-- Authority: KLD-2026-08-13-HUB-PAIRING-ROUTE-001 (group 0192, the
-- `kitluy_hub_issuance_service` identity and its "no table reach" property);
-- KLD-2026-08-13-HUB-PAIRING-SESSION-001 (group 0194).
--
-- The second failure found by running the Partner Portal for the first time.
-- With 0195's alphabet grant in place, `open_hub_pairing_session_v1` succeeded
-- and the very next statement did not:
--
--     permission denied for table hub_pairing_sessions
--
-- The Portal reads `expires_at` back after opening a session, deliberately: the
-- row's deadline comes from the DATABASE clock, and a Portal that displayed a
-- locally computed one would count down to the wrong moment on any machine with
-- a skewed clock.
--
-- WHY THIS IS NOT A TABLE GRANT
-- -----------------------------
-- Group 0192's whole point is that the issuance identity holds capabilities and
-- NO table access — "one capability, no table reach". Granting SELECT on
-- `hub_pairing_sessions` to make one column readable would hand it every column
-- of every session for every Store, permanently, to save a function. That trades
-- the property the identity exists for against a convenience.
--
-- So the expiry gets its own definer door, exactly as `issue_hub_claim_v1` is a
-- definer bridge for the same reason. It returns ONE timestamp for ONE session
-- id and nothing else: no code digest, no scope, no state, no attempt counter.
--
-- Enumeration is not a concern the other way either — the only caller has just
-- created the id it passes, and a caller guessing a uuid learns a timestamp and
-- nothing that identifies a shop.

begin;

create or replace function kitluy_devices.hub_pairing_session_expiry_v1(p_session_id uuid)
returns timestamptz
language sql
security definer
stable
set search_path = pg_catalog, kitluy_devices
as $$
  select expires_at from kitluy_devices.hub_pairing_sessions where id = p_session_id
$$;

comment on function kitluy_devices.hub_pairing_session_expiry_v1 is
  'Group 0196. Returns ONLY the authoritative expiry of one pairing session, so the issuance service can report a deadline from the database clock without holding SELECT on hub_pairing_sessions. Group 0192 keeps that identity free of table access; this preserves it.';

revoke all on function kitluy_devices.hub_pairing_session_expiry_v1(uuid) from public;
revoke all on function kitluy_devices.hub_pairing_session_expiry_v1(uuid) from anon;
revoke all on function kitluy_devices.hub_pairing_session_expiry_v1(uuid) from authenticated;
grant execute on function kitluy_devices.hub_pairing_session_expiry_v1(uuid)
  to kitluy_hub_issuance_service;

do $$
begin
  if not has_function_privilege(
       'kitluy_hub_issuance_service',
       'kitluy_devices.hub_pairing_session_expiry_v1(uuid)',
       'execute') then
    raise exception 'KLUY-MIGRATION-0196: the issuance service cannot read a session expiry';
  end if;

  -- The property this group exists to preserve. If a later change grants the
  -- table, this assertion is where it is noticed.
  if has_table_privilege(
       'kitluy_hub_issuance_service',
       'kitluy_devices.hub_pairing_sessions',
       'select') then
    raise exception
      'KLUY-MIGRATION-0196: the issuance identity gained SELECT on hub_pairing_sessions; it is meant to hold capabilities and no table reach (group 0192)';
  end if;

  raise notice
    'KLUY-MIGRATION-0196: session expiry readable by capability, table still unreachable';
end$$;

commit;
