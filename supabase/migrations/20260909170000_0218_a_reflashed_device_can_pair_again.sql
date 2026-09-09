-- ============================================================================
-- 0218  A re-flashed device can pair again
-- ============================================================================
-- Authority: KLD-2026-08-17-DEVICE-REGISTRATION-APPROVAL-001 (claim redemption);
--   groups 0121/0213 own these doors and this restates their bodies with ONE
--   branch added to each. Defect found on hardware across 2026-09-08/09.
--
-- THE DEFECT, WHICH BIT FOUR TIMES IN TWO DAYS
-- ----------------------------------------------------------------------------
-- A device keeps its pairing on the SD card: a Store Hub in
-- /var/lib/kitluy/pairing-state.json, a Pi Terminal in
-- /var/lib/kitluy/terminal/assignment.json. Both are on the persistent
-- partition, so RE-FLASHING THE CARD destroys them. The cloud is untouched and
-- still holds the assignment.
--
-- The board then says "I am unpaired" and asks for a code. The cloud says "you
-- are assigned" and refuses every code -- KLUY-DEVICE-ALREADY-CLAIMED for a Hub,
-- KLUY-TERMSESSION-TERMINAL-BOUND for a Terminal. Neither side is wrong and
-- neither can move. The only escape was editing the database by hand.
--
-- In development that costs an evening. IN A SHOP IT IS THE SD-CARD-FAILURE
-- PATH: replace the card, and the Store cannot be recovered without a database
-- edit. SD failure is the commonest way a Raspberry Pi dies.
--
-- WHAT CHANGES
-- ----------------------------------------------------------------------------
-- Redemption now distinguishes RECOVERY from THEFT, which the old guards could
-- not:
--
--   same device, same Store  -> supersede the old assignment, issue a new one,
--                               and record `repaired: true` in the event log
--   different device or Store -> refused exactly as before
--
-- The authorisation is unchanged and is not weakened: a Partner still has to
-- issue a code, for that Store, for that seat. A board presenting a code it was
-- given, for a seat it already owns, is recovering rather than stealing -- and
-- the case the guards were written for, a SECOND physical device taking a seat
-- from the first, still refuses.
--
-- Nothing is deleted. The superseded assignment and the revoked terminal rows
-- remain the record of what was true before, which is what makes this a
-- compensating record rather than a rewrite.
--
-- NOT ADDRESSED HERE: moving a device to a DIFFERENT Store still refuses. That
-- is a scope change and belongs to `replace_device_assignment_v1`, a governed
-- operator action, not to whoever is holding a pairing code.
-- ============================================================================

CREATE OR REPLACE FUNCTION kitluy_devices.consume_terminal_pairing_session_v1(p_session_id uuid, p_device_id uuid, p_actor_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'kitluy_devices', 'kitluy_core', 'kitluy_ops', 'extensions'
AS $function$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
  v_pt kitluy_devices.physical_terminals;
  v_bound kitluy_devices.device_assignments;
  v_hub record;
  v_token text;
  v_payload text;
  v_assignment_id uuid;
  v_generation integer;
  v_key text;
  v_terminal_assignments jsonb := '[]'::jsonb;
  v_tid uuid;
  v_updated integer;
  v_now timestamptz;
begin
  select * into v_session from kitluy_devices.terminal_pairing_sessions
   where id = p_session_id for update;
  if not found then
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-UNKNOWN', 'detail', 'no such session');
  end if;
  if v_session.state <> 'open' then
    -- The loser of a race serialises on the row lock and finds it closed.
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-RACE-LOST',
      'detail', 'another device used that pairing code first');
  end if;
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.terminal_pairing_sessions set state = 'expired' where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id, 'SESSION_EXPIRED', p_actor_ref, '{}'::jsonb);
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-EXPIRED', 'detail', 'the pairing code expired');
  end if;

  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id);
  if v_hub.device_id is null or v_hub.device_id <> v_session.store_hub_device_id then
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'the Store Hub this session was opened against is no longer active');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals
   where id = v_session.physical_terminal_id for update;
  -- RE-PAIR, not a refusal, when the SAME board comes back to its OWN seat.
  --
  -- This refusal exists to stop a SECOND physical device stealing a seat that
  -- another board already holds, and that protection is unchanged below. What
  -- it also did was strand the original board: a Pi Terminal keeps its seat in
  -- /var/lib/kitluy/terminal/assignment.json, which lives on the SD card's
  -- persistent partition, so RE-FLASHING THE CARD destroys it while the seat's
  -- `bound_assignment_id` still points at the live assignment in the cloud. The
  -- board then asks for a code and every code is refused, for ever, with no
  -- path back that does not involve editing the database by hand.
  --
  -- The Partner issuing a code FOR THIS SEAT is the authorisation. A board
  -- presenting it that already owns the seat is recovering, not stealing.
  if v_pt.bound_assignment_id is not null then
    select * into v_bound from kitluy_devices.device_assignments
     where id = v_pt.bound_assignment_id and state in ('pending_trust', 'active');
    if found then
      if v_bound.device_id is distinct from p_device_id then
        -- A DIFFERENT board. This is the case the guard was written for.
        return jsonb_build_object('outcome', 'CONSUME_REFUSED',
          'refusal_code', 'KLUY-TERMSESSION-TERMINAL-BOUND',
          'detail', 'a device already holds this terminal''s assignment');
      end if;
      -- The same board. Supersede its previous seat so the 0121 doors below can
      -- issue a fresh one; the terminal rows go with it. Nothing is deleted, and
      -- the superseded row remains the record of what was true before.
      update kitluy_devices.device_terminal_assignments
         set state = 'revoked', revoked_at = now()
       where assignment_id = v_bound.id and state in ('pending_trust', 'active');
      update kitluy_devices.device_assignments
         set state = 'superseded', superseded_at = now()
       where id = v_bound.id;
      -- Through the same recorder the rest of this function uses, so a re-pair
      -- appears in the seat's history exactly where an operator looks for it.
      perform kitluy_devices.record_physical_terminal_event_v1(
        v_session.physical_terminal_id, p_session_id, 'SESSION_CONSUMED', p_actor_ref,
        jsonb_build_object('repaired', true, 'superseded_assignment_id', v_bound.id));
    end if;
  end if;

  -- THE ASSIGNMENT, through the 0121 doors exactly as the Hub path does. The
  -- session digest is the claim token digest; the payload binds device + scope
  -- and is composed here from server rows. Every 0121 refusal RAISES and aborts
  -- this whole transaction: nothing here is left half done.
  v_token := v_session.code_sha256;
  v_payload := encode(extensions.digest(
    'kitluy.terminal-pairing-claim.v1' || E'\n' || p_device_id::text || E'\n'
      || v_session.tenant_id::text || E'\n' || v_session.digital_store_id::text || E'\n'
      || v_session.store_location_id::text, 'sha256'), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    p_device_id, v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id,
    v_token, v_payload, 900, p_actor_ref);
  v_assignment_id := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, p_device_id, p_actor_ref);
  select assignment_generation into v_generation from kitluy_devices.devices where id = p_device_id;

  foreach v_key in array v_session.terminal_profile_keys loop
    v_tid := kitluy_devices.assign_terminal_profile_v1(
      p_device_id, v_generation, v_key, v_session.store_location_id, p_actor_ref);
    v_terminal_assignments := v_terminal_assignments
      || jsonb_build_object('terminal_assignment_id', v_tid, 'terminal_profile_key', v_key);
  end loop;

  update kitluy_devices.terminal_pairing_sessions
     set state = 'consumed', paired_device_id = p_device_id,
         paired_assignment_id = v_assignment_id, paired_at = now()
   where id = p_session_id and state = 'open';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'KLUY-TERMSESSION-RACE-LOST: another device used that pairing code first'
      using errcode = 'P0001';
  end if;

  update kitluy_devices.physical_terminals
     set bound_device_id = p_device_id, bound_assignment_id = v_assignment_id,
         bound_at = now(), updated_at = now()
   where id = v_session.physical_terminal_id;

  perform kitluy_devices.record_physical_terminal_event_v1(
    v_session.physical_terminal_id, p_session_id, 'SESSION_CONSUMED', p_actor_ref,
    jsonb_build_object('device_id', p_device_id, 'assignment_id', v_assignment_id));
  perform kitluy_devices.record_physical_terminal_event_v1(
    v_session.physical_terminal_id, p_session_id, 'DEVICE_BOUND', p_actor_ref,
    jsonb_build_object('device_id', p_device_id, 'assignment_id', v_assignment_id,
                       'previous_device_id', v_pt.bound_device_id));

  return jsonb_build_object(
    'outcome', 'CONSUMED',
    'session_id', p_session_id,
    'physical_terminal_id', v_session.physical_terminal_id,
    'assignment_id', v_assignment_id,
    'assignment_generation', v_generation,
    'lifecycle_state', 'awaiting_trust',
    'terminal_assignments', v_terminal_assignments,
    'environment', v_session.environment);
end;
$function$;

CREATE OR REPLACE FUNCTION kitluy_devices.redeem_device_claim_v1(p_claim_token_sha256 text, p_presented_payload_sha256 text, p_device_id uuid, p_actor_ref text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
declare
  v_claim kitluy_devices.device_claims;
  v_live kitluy_devices.device_assignments;
  v_device kitluy_devices.devices;
  v_assignment_id uuid;
  v_generation integer;
  v_collisions integer;
begin
  select * into v_claim
  from kitluy_devices.device_claims
  where claim_token_sha256 = lower(p_claim_token_sha256)
  for update;

  if not found then
    -- No claim, so no device to attach the event to beyond the presenter's.
    perform kitluy_devices.record_claim_event(
      p_device_id, null, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'unknown_token'));
    raise exception 'KLUY-DEVICE-CLAIM-UNKNOWN: no claim matches the presented token'
      using errcode = 'P0001';
  end if;

  -- RECOVERY PATH, checked before the single-use refusal. A response lost in
  -- transit must not cost the operator the claim.
  if v_claim.state = 'redeemed' then
    if v_claim.device_id = p_device_id
       and v_claim.payload_sha256 = lower(p_presented_payload_sha256) then
      perform kitluy_devices.record_claim_event(
        p_device_id, v_claim.id, v_claim.redeemed_assignment_id,
        'CLAIM_REDEMPTION_REPLAYED', p_actor_ref,
        jsonb_build_object('reason', 'idempotent_retry_after_response_loss'));
      return v_claim.redeemed_assignment_id;
    end if;
    perform kitluy_devices.record_claim_event(
      coalesce(p_device_id, v_claim.device_id), v_claim.id, null,
      'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'token_reuse_by_another_device',
                         'claimed_device', v_claim.device_id,
                         'presenting_device', p_device_id));
    raise exception 'KLUY-DEVICE-CLAIM-REUSED: this claim token was already redeemed by device %; a token is single-use', v_claim.device_id
      using errcode = 'P0001';
  end if;

  if v_claim.state = 'revoked' then
    raise exception 'KLUY-DEVICE-CLAIM-REVOKED: this claim was revoked at %', v_claim.revoked_at
      using errcode = 'P0001';
  end if;

  -- clock_timestamp(), NOT now(). `now()` is TRANSACTION START time, so a
  -- transaction that opened before the claim expired would redeem it after
  -- expiry and never notice. Expiry is a wall-clock question.
  if v_claim.expires_at <= clock_timestamp() then
    update kitluy_devices.device_claims set state = 'expired' where id = v_claim.id;
    perform kitluy_devices.record_claim_event(
      v_claim.device_id, v_claim.id, null, 'CLAIM_EXPIRED', p_actor_ref,
      jsonb_build_object('expired_at', v_claim.expires_at));
    raise exception 'KLUY-DEVICE-CLAIM-EXPIRED: this claim expired at %', v_claim.expires_at
      using errcode = 'P0001';
  end if;

  -- The payload binds the token to the device and scope it was issued for.
  if v_claim.payload_sha256 <> lower(p_presented_payload_sha256) then
    perform kitluy_devices.record_claim_event(
      v_claim.device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'payload_mismatch'));
    raise exception 'KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED: the presented claim payload does not match the payload this token was issued for'
      using errcode = 'P0001';
  end if;

  if v_claim.device_id <> p_device_id then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'wrong_device',
                         'issued_for', v_claim.device_id));
    raise exception 'KLUY-DEVICE-CLAIM-WRONG-DEVICE: this claim was issued for device %, not %', v_claim.device_id, p_device_id
      using errcode = 'P0001';
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_id for update;

  if v_device.lifecycle_state = 'quarantined' then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'device_quarantined'));
    raise exception 'KLUY-DEVICE-QUARANTINED: device % is quarantined; a claim cannot be redeemed until the incident is cleared', p_device_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is %', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    perform kitluy_devices.record_claim_event(
      p_device_id, v_claim.id, null, 'CLAIM_REFUSED', p_actor_ref,
      jsonb_build_object('reason', 'duplicate_hardware_evidence'));
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s)', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  -- RE-PAIR when the device is returning to the SAME Store; refuse otherwise.
  --
  -- Same defect as the terminal seat above, one rung up: a Store Hub keeps its
  -- pairing state on the SD card, so re-flashing wipes it while the cloud still
  -- holds the assignment. The Hub then asks for a code and every code is
  -- refused. In a shop that is the SD-card-failure path, and it bricks the Hub.
  --
  -- MOVING a device between Stores still refuses: that is a scope change and it
  -- belongs to the governed reassignment door, not to whoever holds a code.
  if exists (
    select 1 from kitluy_devices.device_assignments a
    where a.device_id = p_device_id and a.state in ('pending_trust', 'active')
  ) then
    select * into v_live from kitluy_devices.device_assignments
     where device_id = p_device_id and state in ('pending_trust', 'active')
     limit 1;
    if v_live.digital_store_id is distinct from v_claim.digital_store_id then
      raise exception 'KLUY-DEVICE-ALREADY-CLAIMED: device % already holds a live assignment to another Store', p_device_id
        using errcode = 'P0001';
    end if;
    update kitluy_devices.device_terminal_assignments
       set state = 'revoked', revoked_at = now()
     where assignment_id = v_live.id and state in ('pending_trust', 'active');
    update kitluy_devices.device_assignments
       set state = 'superseded', superseded_at = now()
     where id = v_live.id;
    insert into kitluy_devices.device_claim_events
      (device_id, claim_id, assignment_id, event_type, actor_ref, detail)
    values (p_device_id, v_claim.id, v_live.id, 'CLAIM_REDEEMED', p_actor_ref,
            jsonb_build_object('repaired', true));
  end if;

  -- The next generation follows the HIGHEST EVER ISSUED, not the device's
  -- current value. A revoked device carries generation 0, so `current + 1`
  -- would re-issue a number that already exists and a stale Hub presenting the
  -- old generation would be silently accepted as current.
  select coalesce(max(assignment_generation), 0) + 1 into v_generation
  from kitluy_devices.device_assignments where device_id = p_device_id;

  insert into kitluy_devices.device_assignments
    (device_id, tenant_id, digital_store_id, store_location_id,
     assignment_generation, state, claim_id, created_by_operator_ref)
  values
    (p_device_id, v_claim.tenant_id, v_claim.digital_store_id, v_claim.store_location_id,
     v_generation, 'pending_trust', v_claim.id, p_actor_ref)
  returning id into v_assignment_id;

  update kitluy_devices.device_claims
  set state = 'redeemed', redeemed_at = now(), redeemed_assignment_id = v_assignment_id
  where id = v_claim.id;

  -- The device is now claimed, scope-bound and assigned. It STOPS HERE.
  -- `active` requires certificate-backed activation, gated on BLK-005.
  update kitluy_devices.devices
  set assignment_generation = v_generation,
      lifecycle_state = 'awaiting_trust',
      updated_at = now()
  where id = p_device_id;

  perform kitluy_devices.record_claim_event(
    p_device_id, v_claim.id, v_assignment_id, 'CLAIM_REDEEMED', p_actor_ref,
    jsonb_build_object('assignment_generation', v_generation));
  perform kitluy_devices.record_claim_event(
    p_device_id, v_claim.id, v_assignment_id, 'ASSIGNMENT_CREATED', p_actor_ref,
    jsonb_build_object('assignment_generation', v_generation));
  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, 'awaiting_trust', 'CLAIM_REDEEMED', p_actor_ref,
    jsonb_build_object('assignment_id', v_assignment_id,
                       'assignment_generation', v_generation));

  return v_assignment_id;
end;
$function$;
