-- ============================================================================
-- 0220  A terminal recovering its own seat may present a pairing code
-- ============================================================================
-- Authority: group 0213 owns this door; this restates its body with one
--   lifecycle test widened. Completes 0218 and 0219. Found on hardware
--   2026-09-09 after 0219 alone changed nothing.
--
-- THE FULL PATH, AND WHY THREE MIGRATIONS WERE NEEDED
-- ----------------------------------------------------------------------------
-- A re-flashed terminal asking for its seat back passes through three gates:
--
--   1. evaluate_terminal_pairing_session_v1   <- THIS. Refused `awaiting_trust`
--                                                outright, before anything else.
--   2. evaluate_provisioning_eligibility_v1   <- 0219 taught it that an approval
--                                                follows the board and that a
--                                                recovering board is not stale
--                                                factory inventory.
--   3. consume_terminal_pairing_session_v1    <- 0218 taught it to tell a
--                                                re-pair from a seat being
--                                                stolen.
--
-- They were fixed in the order they were discovered, which is the reverse of the
-- order they run. 0218 and 0219 were both correct and both unreachable: gate 1
-- refused first, the board spent its five attempts, and the session locked
-- against a code the server had already confirmed was RIGHT.
--
-- WHAT THIS CHANGES
-- ----------------------------------------------------------------------------
-- `enrolled` OR `awaiting_trust` may present a code. Both are Admin-approved --
-- a terminal reaches `awaiting_trust` only by having been approved and then
-- paired. Every other lifecycle is refused exactly as before, so a quarantined,
-- suspended, retired or never-approved board still cannot present anything.
--
-- Ownership of the seat is NOT decided here and never was: gate 3 compares the
-- presenting device against the seat's bound assignment and refuses a different
-- board. This gate answers "is this an approved terminal?", not "is it yours?".
-- ============================================================================

CREATE OR REPLACE FUNCTION kitluy_devices.evaluate_terminal_pairing_session_v1(p_presented_code text, p_device_id uuid, p_actor_ref text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'kitluy_devices', 'kitluy_core', 'kitluy_ops', 'extensions'
AS $function$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
  v_pt kitluy_devices.physical_terminals;
  v_now timestamptz;
  v_normalized text;
  v_digest text;
  v_device kitluy_devices.devices;
  v_eligible boolean;
  v_reasons text[];
  v_ok boolean;
  v_hub record;
  v_tenant kitluy_core.tenants;
  v_store kitluy_core.digital_stores;
  v_location kitluy_core.store_locations;
  v_locked boolean;
begin
  if p_device_id is null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-NO-DEVICE',
      'detail', 'a presentation names the terminal that is presenting');
  end if;

  v_normalized := kitluy_devices.normalize_hub_claim_code_v1(p_presented_code);
  if length(v_normalized) <> 8
     or v_normalized !~ ('^[' || kitluy_devices.hub_claim_code_alphabet_v1() || ']{8}$') then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  v_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');

  select * into v_session
    from kitluy_devices.terminal_pairing_sessions
   where code_sha256 = v_digest
   for update;
  if not found then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  if v_session.locked_at is not null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-LOCKED',
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;
  if v_session.state <> 'open' then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-' || upper(v_session.state),
      'detail', format('that pairing code is already %s', v_session.state));
  end if;

  -- Expiry BEFORE any attempt is counted, and it costs nothing (0191 ordering).
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.terminal_pairing_sessions set state = 'expired' where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id, 'SESSION_EXPIRED', p_actor_ref, '{}'::jsonb);
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-EXPIRED',
      'detail', 'the pairing code expired; this is not a failed attempt');
  end if;

  -- The code is RIGHT. Everything from here is about the device presenting it.
  -- Factory Enrollment section 8: only an Admin-approved (enrolled) terminal
  -- that the single eligibility predicate admits may take a seat.
  select * into v_device from kitluy_devices.devices where id = p_device_id;
  -- `enrolled` OR `awaiting_trust`. Both are Admin-approved: a terminal reaches
  -- `awaiting_trust` only by having been approved and then paired, so refusing
  -- it here refuses a board that is RECOVERING its own seat -- which is exactly
  -- what a re-flash produces, since the seat file lives on the wiped SD card.
  --
  -- This door refused before `evaluate_provisioning_eligibility_v1` was even
  -- consulted, so relaxing that predicate in 0219 changed nothing on its own.
  -- The board burned its five attempts and the session locked, against a code
  -- the server had already confirmed was correct.
  --
  -- WHO OWNS THE SEAT IS STILL DECIDED, just not here:
  -- `consume_terminal_pairing_session_v1` (0218) compares the presenting device
  -- against the seat's bound assignment and refuses a DIFFERENT board with
  -- KLUY-TERMSESSION-TERMINAL-BOUND. This door decides whether the device is an
  -- approved terminal at all; that one decides whose seat it is.
  v_ok := found and v_device.device_class = 'terminal'
          and v_device.lifecycle_state in ('enrolled', 'awaiting_trust');
  v_reasons := '{}';
  if v_ok then
    select el.eligible, el.reasons into v_eligible, v_reasons
      from kitluy_devices.evaluate_provisioning_eligibility_v1(p_device_id) el;
    v_ok := coalesce(v_eligible, false);
  end if;
  if not v_ok then
    v_locked := v_session.failed_attempt_count + 1 >= 5;
    update kitluy_devices.terminal_pairing_sessions
       set failed_attempt_count = least(failed_attempt_count + 1, 5),
           locked_at = case when v_locked then v_now else locked_at end,
           locked_reason = case when v_locked then 'five failed presentations' else locked_reason end,
           state = case when v_locked then 'locked' else state end
     where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id,
      case when v_locked then 'SESSION_LOCKED' else 'SESSION_FAILED_ATTEMPT' end,
      p_actor_ref,
      jsonb_build_object('device_id', p_device_id, 'reasons', to_jsonb(coalesce(v_reasons, '{}'::text[]))));
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-DEVICE-INELIGIBLE',
      'detail', 'this device cannot pair: it must be an approved, provisioning-eligible Pi Terminal');
  end if;

  -- The Hub must still be active. Not an attempt: nothing about the device.
  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id);
  if v_hub.device_id is null or v_hub.device_id <> v_session.store_hub_device_id then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'the Store Hub this session was opened against is no longer active');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals where id = v_session.physical_terminal_id;
  select * into v_tenant from kitluy_core.tenants where id = v_session.tenant_id;
  select * into v_store from kitluy_core.digital_stores where id = v_session.digital_store_id;
  select * into v_location from kitluy_core.store_locations where id = v_session.store_location_id;

  -- The section 7 context, every value a server row.
  return jsonb_build_object(
    'outcome', 'MATCH_READY',
    'context_version', 'kitluy.terminal-pairing-context.v1',
    'session_id', v_session.id,
    'physical_terminal_id', v_session.physical_terminal_id,
    'label', v_pt.label,
    'terminal_profile_keys', to_jsonb(v_session.terminal_profile_keys),
    'tenant_id', v_session.tenant_id,
    'tenant_reference', v_tenant.tenant_code || ' — ' || coalesce(v_tenant.display_name, v_tenant.legal_name),
    'digital_store_id', v_session.digital_store_id,
    'digital_store_reference', v_store.store_code || ' — ' || v_store.name,
    'store_location_id', v_session.store_location_id,
    'store_location_reference', v_location.location_code || ' — ' || v_location.name,
    'store_hub_device_id', v_session.store_hub_device_id,
    'store_hub_reference', v_hub.asset_tag,
    'vertical', v_store.primary_vertical_code,
    'required_app_family', null,
    'release_channel', null,
    'environment', v_session.environment,
    'detail', 'the code matches an open, unexpired session; the caller must now consume it');
end;
$function$;
