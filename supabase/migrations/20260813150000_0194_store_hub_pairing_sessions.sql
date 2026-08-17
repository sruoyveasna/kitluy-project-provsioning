-- kitluy:migration:0194
--
-- STORE HUB PAIRING SESSIONS — one code for a Store, any Hub may use it
-- =============================================================================
-- Authority: owner decision 2026-08-13 — "we boot up store hub, input the code
-- generated from partner". The owner decision's Milestone 3 says "Partner opens
-- Store Hub pairing SESSION / Generate code / Hub CLI enters code", and that word
-- is load-bearing: the Partner opens a session for their SHOP, not for a serial
-- number they would have to read off a box.
--
-- WHY device_claims COULD NOT SIMPLY BE RELAXED
-- --------------------------------------------
-- `device_claims.device_id` is NOT NULL, and that is not incidental — three
-- things are built on the claim knowing its device from the moment it exists:
--
--   * the canonical payload (`kitluy.hub-claim-payload.v1`) binds device+scope,
--     which is what makes a captured token unusable elsewhere;
--   * the five-attempt lockout in group 0191 counts against THE CLAIM, found via
--     its device;
--   * redemption refuses a mismatch with `KLUY-DEVICE-CLAIM-WRONG-DEVICE`.
--
-- Dropping the NOT NULL would have unpicked all three and rewritten most of
-- groups 0121, 0191 and 0192. Worse, the attempt budget becomes unimplementable
-- as specified: a wrong code that matches no claim has nothing to count against.
--
-- WHAT THIS DOES INSTEAD
-- ----------------------
-- A pairing SESSION is a separate, store-scoped object with its own code, TTL,
-- attempt budget and single-use rule. It is not a claim and never becomes one.
-- When a Hub presents a session code, the service creates a normal device-bound
-- claim for THAT Hub and redeems it immediately — so the claim model, the
-- canonical payload and every refusal in 0121 stay exactly as they are, and the
-- device binding is established at the only moment it can honestly be known:
-- when a specific Hub actually asks.
--
-- The five-attempt budget lives here, per SESSION, which is where the protocol
-- (§6.1) always meant it: "five failed attempts lock the session".

begin;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The session.
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.hub_pairing_sessions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  digital_store_id      uuid not null,
  store_location_id     uuid not null,
  -- Only the DIGEST. The plaintext is shown once by the Portal and exists
  -- nowhere server-side, exactly as a claim token does.
  code_sha256           text not null unique
                          check (code_sha256 ~ '^[0-9a-f]{64}$'),
  state                 text not null default 'open'
                          check (state in ('open', 'consumed', 'expired', 'revoked', 'locked')),
  -- Set when a Hub successfully pairs. Single-use is enforced by `state`, and
  -- this records WHICH Hub took it.
  paired_device_id      uuid references kitluy_devices.devices (id),
  paired_at             timestamptz,
  failed_attempt_count  integer not null default 0
                          check (failed_attempt_count between 0 and 5),
  locked_at             timestamptz,
  locked_reason         text,
  created_by_operator_ref text not null,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  -- The protocol's fifteen minutes, enforced on the row rather than trusted to a
  -- caller — the same decision group 0191 made for claims, for the same reason.
  constraint hub_pairing_sessions_ttl_chk
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint hub_pairing_sessions_lock_coherent_chk
    check ((locked_at is null) = (locked_reason is null)),
  -- A paired session names its Hub, and an unpaired one must not.
  constraint hub_pairing_sessions_paired_coherent_chk
    check ((paired_device_id is null) = (paired_at is null))
);

comment on table kitluy_devices.hub_pairing_sessions is
  'Group 0194. A Partner-opened Store Hub pairing session: ONE code for a Store, usable by whichever enrolled Store Hub types it. Not a claim and never becomes one — on a successful presentation the service creates and redeems a normal device-bound device_claims row for the presenting Hub, so the canonical payload binding and every 0121 refusal stay intact. Holds the five-attempt budget the pairing protocol section 6.1 places on the SESSION. Only the code digest is stored; the plaintext is shown once by the Portal and exists nowhere server-side.';

comment on column kitluy_devices.hub_pairing_sessions.paired_device_id is
  'The Hub that took this session. Written at pairing, which is the first moment the device is honestly known — a session is opened for a Store, before anyone knows which Hub will be plugged in.';

create index if not exists hub_pairing_sessions_store_open_idx
  on kitluy_devices.hub_pairing_sessions (digital_store_id, state)
  where state = 'open';

alter table kitluy_devices.hub_pairing_sessions enable row level security;
alter table kitluy_devices.hub_pairing_sessions force row level security;

-- -----------------------------------------------------------------------------
-- 2. Append-only discipline.
-- -----------------------------------------------------------------------------
-- Scope, code and expiry are fixed at open. Only the closing fields may move,
-- and `paired_device_id` may be set exactly once — mirroring the immutability
-- rule 0121 puts on claims.
create or replace function kitluy_devices.enforce_hub_pairing_session_integrity()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.code_sha256 is distinct from old.code_sha256
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception
      'KLUY-HUBSESSION-IMMUTABLE: a pairing session''s scope, code and expiry are fixed when it is opened'
      using errcode = 'P0001';
  end if;
  if old.paired_device_id is not null and new.paired_device_id is distinct from old.paired_device_id then
    raise exception 'KLUY-HUBSESSION-ALREADY-PAIRED: this session already paired a Hub'
      using errcode = 'P0001';
  end if;
  if old.state <> 'open' and new.state <> old.state then
    raise exception 'KLUY-HUBSESSION-CLOSED: a closed pairing session cannot change state'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- The one destructive statement in this group: a `drop trigger if exists` on a
-- trigger THIS FILE creates two lines below, so the group stays re-runnable. No
-- data is reachable by it — the table is created in this same transaction.
--
-- kitluy:destructive-approved:KLD-2026-08-13-HUB-PAIRING-SESSION-001
drop trigger if exists enforce_hub_pairing_session_integrity on kitluy_devices.hub_pairing_sessions;
create trigger enforce_hub_pairing_session_integrity
  before update on kitluy_devices.hub_pairing_sessions
  for each row execute function kitluy_devices.enforce_hub_pairing_session_integrity();

-- -----------------------------------------------------------------------------
-- 3. Opening a session.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.open_hub_pairing_session_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_code_sha256 text,
  p_ttl_seconds integer,
  p_operator_ref text
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, kitluy_ops, extensions
as $$
declare
  v_id uuid;
begin
  -- Scope coherence, checked here rather than trusted: a Location that belongs to
  -- another Store would otherwise produce a session that can never pair.
  if not exists (
    select 1 from kitluy_core.digital_stores ds
     where ds.id = p_digital_store_id and ds.tenant_id = p_tenant_id) then
    raise exception 'KLUY-HUBSESSION-SCOPE-UNKNOWN: that Digital Store does not belong to that Tenant'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from kitluy_core.store_locations sl
     where sl.id = p_store_location_id and sl.digital_store_id = p_digital_store_id) then
    raise exception 'KLUY-HUBSESSION-SCOPE-UNKNOWN: that Location does not belong to that Digital Store'
      using errcode = 'P0001';
  end if;

  -- One OPEN session per Store. A second would make "the code" ambiguous to the
  -- person standing at the Hub, and two live codes for one shop is exactly how a
  -- Hub ends up attached by a code someone thought was already dead.
  update kitluy_devices.hub_pairing_sessions
     set state = 'revoked'
   where digital_store_id = p_digital_store_id and state = 'open';

  insert into kitluy_devices.hub_pairing_sessions
    (tenant_id, digital_store_id, store_location_id, code_sha256,
     created_by_operator_ref, expires_at)
  values
    (p_tenant_id, p_digital_store_id, p_store_location_id, lower(p_code_sha256),
     p_operator_ref, now() + make_interval(secs => p_ttl_seconds))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function kitluy_devices.open_hub_pairing_session_v1 is
  'Group 0194. Opens a Store Hub pairing session for one Digital Store and Location, revoking any session already open for that Store so exactly one code is live per shop. Validates scope coherence rather than trusting the caller. The fifteen-minute ceiling is enforced by hub_pairing_sessions_ttl_chk on the row.';

-- -----------------------------------------------------------------------------
-- 4. Presenting a code.
-- -----------------------------------------------------------------------------
-- Resolution is by CODE, because that is all the Hub knows. The attempt budget
-- therefore has to live somewhere a wrong guess can be counted, and a wrong guess
-- matches no session at all — so a miss is answered without a counter and bounded
-- by the transport rate limiter, while a HIT that then fails for another reason
-- spends the session's budget. This is the honest reading of "five failed
-- attempts lock the session": you cannot lock a session you did not find.
create or replace function kitluy_devices.evaluate_hub_pairing_session_v1(
  p_presented_code text,
  p_device_id uuid,
  p_actor_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $eval$
declare
  v_session kitluy_devices.hub_pairing_sessions;
  v_now timestamptz;
  v_normalized text;
  v_digest text;
  v_device kitluy_devices.devices;
begin
  if p_device_id is null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-NO-DEVICE',
      'detail', 'a presentation names the Hub that is presenting');
  end if;

  v_normalized := kitluy_devices.normalize_hub_claim_code_v1(p_presented_code);
  if length(v_normalized) <> 8
     or v_normalized !~ ('^[' || kitluy_devices.hub_claim_code_alphabet_v1() || ']{8}$') then
    -- Malformed. Indistinguishable from "no such session" to the caller, so a
    -- guesser learns nothing about the alphabet from the answer.
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  v_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');

  select * into v_session
    from kitluy_devices.hub_pairing_sessions
   where code_sha256 = v_digest
   for update;

  if not found then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  if v_session.locked_at is not null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-LOCKED',
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;
  if v_session.state <> 'open' then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-' || upper(v_session.state),
      'detail', format('that pairing code is already %s', v_session.state));
  end if;

  -- Expiry BEFORE any attempt is counted, and it costs nothing. Same ordering
  -- group 0191 records, for the same reason: otherwise an attacker exhausts a
  -- shop's budget by waiting.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.hub_pairing_sessions set state = 'expired' where id = v_session.id;
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-EXPIRED',
      'detail', 'the pairing code expired; this is not a failed attempt');
  end if;

  -- The code is RIGHT. Everything from here is about the Hub presenting it, and
  -- each failure spends the session's budget — a wrong device is a failed
  -- attempt against a code that is otherwise live.
  select * into v_device from kitluy_devices.devices where id = p_device_id;
  if not found or v_device.device_class <> 'store_hub' or v_device.lifecycle_state <> 'enrolled' then
    update kitluy_devices.hub_pairing_sessions
       set failed_attempt_count = least(failed_attempt_count + 1, 5),
           locked_at = case when failed_attempt_count + 1 >= 5 then v_now else locked_at end,
           locked_reason = case when failed_attempt_count + 1 >= 5
                                then 'five failed presentations' else locked_reason end,
           state = case when failed_attempt_count + 1 >= 5 then 'locked' else state end
     where id = v_session.id;
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-HUBSESSION-DEVICE-INELIGIBLE',
      'detail', 'this device cannot pair: it must be an enrolled Store Hub');
  end if;

  return jsonb_build_object(
    'outcome', 'MATCH_READY',
    'session_id', v_session.id,
    'tenant_id', v_session.tenant_id,
    'digital_store_id', v_session.digital_store_id,
    'store_location_id', v_session.store_location_id,
    'detail', 'the code matches an open, unexpired session; the caller must now create and redeem a device-bound claim');
end;
$eval$;

comment on function kitluy_devices.evaluate_hub_pairing_session_v1 is
  'Group 0194. Resolves a Store Hub pairing session by CODE — which is all a Hub knows — and returns the Store scope so the caller can create and redeem a device-bound claim for the presenting Hub. Consumes nothing. Expiry is evaluated before any attempt is counted. A code matching no session is refused identically to a malformed one, so a guesser learns nothing; only a HIT can spend the five-attempt budget, because a session that was never found cannot be locked.';

-- -----------------------------------------------------------------------------
-- 5. Closing a session, once its Hub is paired.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.consume_hub_pairing_session_v1(
  p_session_id uuid,
  p_device_id uuid
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
declare
  v_updated integer;
begin
  -- Conditional on `state = 'open'`, so two Hubs racing the same code cannot both
  -- win: the second update matches no row.
  update kitluy_devices.hub_pairing_sessions
     set state = 'consumed', paired_device_id = p_device_id, paired_at = now()
   where id = p_session_id and state = 'open';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function kitluy_devices.consume_hub_pairing_session_v1 is
  'Group 0194. Closes a session against the Hub that paired. Conditional on state = open, so two Hubs racing one code serialise and exactly one wins.';

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 6. Grants.
-- -----------------------------------------------------------------------------
-- Issuance is the Partner's route; presentation and consumption are the device's.
-- Neither identity gets the other's capability, and neither gets table access.
revoke all on function kitluy_devices.open_hub_pairing_session_v1(uuid, uuid, uuid, text, integer, text) from public;
revoke all on function kitluy_devices.open_hub_pairing_session_v1(uuid, uuid, uuid, text, integer, text) from anon;
revoke all on function kitluy_devices.open_hub_pairing_session_v1(uuid, uuid, uuid, text, integer, text) from authenticated;
grant execute on function kitluy_devices.open_hub_pairing_session_v1(uuid, uuid, uuid, text, integer, text)
  to kitluy_hub_issuance_service;

revoke all on function kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text) from public;
revoke all on function kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text) from anon;
revoke all on function kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text) from authenticated;
grant execute on function kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text)
  to kitluy_hub_pairing_service;

revoke all on function kitluy_devices.consume_hub_pairing_session_v1(uuid, uuid) from public;
revoke all on function kitluy_devices.consume_hub_pairing_session_v1(uuid, uuid) from anon;
revoke all on function kitluy_devices.consume_hub_pairing_session_v1(uuid, uuid) from authenticated;
grant execute on function kitluy_devices.consume_hub_pairing_session_v1(uuid, uuid)
  to kitluy_hub_pairing_service;

-- The pairing service must also be able to CREATE the device-bound claim now,
-- not only redeem one: with a store-scoped session there is no claim until a Hub
-- presents the code. Reached through the 0193 definer bridge, so it still holds
-- no table access.
grant execute on function kitluy_devices.issue_hub_claim_v1(uuid, uuid, uuid, uuid, text, text, integer, text)
  to kitluy_hub_pairing_service;

-- -----------------------------------------------------------------------------
-- 7. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
begin
  if has_table_privilege('kitluy_hub_pairing_service', 'kitluy_devices.hub_pairing_sessions', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_issuance_service', 'kitluy_devices.hub_pairing_sessions', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0194: a runtime identity holds direct table access to pairing sessions'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.open_hub_pairing_session_v1(uuid, uuid, uuid, text, integer, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0194: a browser-reachable role can reach a session door'
      using errcode = 'P0001';
  end if;
  -- The issuer must NOT be able to present or consume: opening a code and using
  -- one are different authorities.
  if has_function_privilege('kitluy_hub_issuance_service', 'kitluy_devices.evaluate_hub_pairing_session_v1(text, uuid, text)', 'execute')
     or has_function_privilege('kitluy_hub_issuance_service', 'kitluy_devices.consume_hub_pairing_session_v1(uuid, uuid)', 'execute') then
    raise exception 'KLUY-MIGRATION-0194: the issuance identity can also consume a session'
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0194: store hub pairing sessions applied (store-scoped code, device bound at pairing)';
end
$guard$;

commit;
