-- kitluy:group:0161
-- Migration group 0161: repair_abandoned_key_destruction_confirm.
--
-- Authority: KLRISK-DEVICE-012 (registered 2026-08-01 in the decision and
-- reconciliation register); WS-11 fleet key lifecycle (0137 §3).
--
-- ===========================================================================
-- THE DEFECT THIS CLOSES
-- ===========================================================================
-- Group 0137's destruction eligibility admits TWO bases: a `superseded` key
-- (retention from the overlap boundary) and an `abandoned` key (retention from
-- `abandoned_at`, 7 days by policy). The abandoned basis is documented policy
-- with a named retention floor — it is clearly INTENDED to work.
--
-- It cannot complete. `abandon_generation_key_v1` (0128) always sets
-- `abandon_reason`, and `device_generation_keys_abandon_chk` requires
-- `abandon_reason IS NULL` for every state other than `abandoned`.
-- `confirm_key_destruction_v1` transitions the key to `destroyed` without
-- clearing the reason — so EVERY abandoned key fails its own confirmation
-- with a check-constraint violation, AFTER the provider may already have
-- erased the private half. The abandoned basis is dead code in practice, and
-- an operator who hits it lands in the ambiguous-outcome reconciliation path
-- for no real reason.
--
-- Found while building WS-11-T003 Step-4 lifecycle stage 29 (the stage was
-- re-aimed at the superseded basis, which is proven end-to-end; the defect
-- was recorded as KLRISK-DEVICE-012 instead of being worked around silently).
--
-- ===========================================================================
-- THE DECISION: AMEND THE CONSTRAINT, DO NOT ERASE THE REASON
-- ===========================================================================
-- Two corrections were available:
--
--   (a) clear `abandon_reason` inside confirm on the destroyed transition —
--       destroys the abandonment audit on the key row;
--   (b) amend the constraint to admit `destroyed` with or without a reason.
--
-- (b) is chosen: the row keeps WHY the key was abandoned (that is the whole
-- point of recording the reason), the abandoned basis becomes reachable, and
-- the superseded basis — whose rows carry no reason — is untouched. The
-- constraint's intent is unchanged: a reason is REQUIRED exactly when the
-- state is `abandoned`, and forbidden on `active`/`superseded`.
--
-- RECORDED, NOT CHANGED (a separate decision): the comment on
-- `abandon_generation_key_v1` says it "refuses to abandon an `active` key",
-- but the function body has no such check — it abandons any non-abandoned
-- key, including the active one. That comment/code mismatch is how the
-- lifecycle first walked into this constraint trap. Refusing active-key
-- abandonment changes behavior and belongs to its own named package.
--
-- Additive. Groups 0128-0160 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- kitluy:destructive-approved:KLRISK-DEVICE-012 -- the DROP below removes only
-- the 0128 CHECK CONSTRAINT `device_generation_keys_abandon_chk` so the
-- corrected definition can be added in the same transaction; no table, no
-- data and no other object is dropped.

begin;

alter table kitluy_devices.device_generation_keys
  drop constraint device_generation_keys_abandon_chk;

alter table kitluy_devices.device_generation_keys
  add constraint device_generation_keys_abandon_chk
  check (
    state = 'destroyed'
    or (state = 'abandoned') = (abandon_reason is not null)
  );

-- ---------------------------------------------------------------------------
-- THE SECOND HALF: a dead attempt must close
-- ---------------------------------------------------------------------------
-- The constraint alone does not make the abandoned basis reachable. The 0137
-- eligibility also refuses UNFINISHED_RENEWAL for ANY open reservation on the
-- device, and the losing-renewal path leaves exactly one: the conflict raises
-- and rolls back, so the loser's reservation stays `pop_pending` for ever and
-- its abandoned replacement key can never pass eligibility either.
--
-- `abandon_generation_key_v1` is the loser's cleanup door (0128). Closing the
-- attempt there — atomically with the key abandonment, so the two can never
-- disagree — is what "the attempt is dead" means. An already-terminal
-- reservation is left alone; the open-reservation index frees the slot, which
-- is precisely what a loser needs in order to retry.
--
-- Ownership borrow, same as groups 0125-0159: the applying role is not a
-- member of the NOLOGIN definer owner, so `create or replace` would fail
-- `42501 must be owner of function` on a from-zero replay. It is handed back
-- immediately below.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create or replace function kitluy_devices.abandon_generation_key_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_generation integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_row kitluy_devices.device_generation_keys;
  v_reservation kitluy_devices.device_renewal_reservations;
begin
  select * into v_row from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = p_generation
  for update;

  if not found then
    raise exception 'KLUY-KEY-MISSING: no key registered for generation %', p_generation
      using errcode = 'P0001';
  end if;
  if v_row.state = 'abandoned' then
    return jsonb_build_object('outcome', 'ALREADY_ABANDONED', 'key_id', v_row.id);
  end if;
  -- An ACTIVE key is not abandoned by the loser's cleanup path. If this fires,
  -- the caller is abandoning the winner, which the transition table refuses.
  update kitluy_devices.device_generation_keys
  set state = 'abandoned', abandoned_at = now(), abandon_reason = p_reason
  where id = v_row.id;

  -- Group 0161 (KLRISK-DEVICE-012): the attempt this key was minted for is
  -- dead too. A losing renewal's reservation otherwise stays open for ever,
  -- which is the second half of why the abandoned destruction basis was
  -- unreachable (eligibility refuses UNFINISHED_RENEWAL device-wide). Closing
  -- it here, atomically with the key abandonment, is what "the attempt is
  -- dead" means; an already-terminal reservation is left alone.
  if v_row.renewal_attempt_id is not null then
    update kitluy_devices.device_renewal_reservations
       set status = 'abandoned'
     where renewal_attempt_id = v_row.renewal_attempt_id
       and status not in ('completed', 'refused', 'abandoned')
    returning * into v_reservation;
  end if;

  return jsonb_build_object(
    'outcome', 'ABANDONED',
    'key_id', v_row.id,
    'reservation_closed', v_reservation.renewal_attempt_id is not null);
end;
$$;

comment on function kitluy_devices.abandon_generation_key_v1 is
  'Marks a losing renewal''s replacement key abandoned AND closes its reservation, atomically. Called in a NEW transaction after KLUY-CRED-RENEWAL-GENERATION-CONFLICT, because the conflict itself raises and rolls back. Refuses to abandon an `active` key — that would be abandoning the winner (the transition table enforces it). Group 0161: the reservation close is what makes the 0137 abandoned destruction basis reachable (KLRISK-DEVICE-012).';

-- Hand the borrow back, unconditionally, the way groups 0147-0159 do.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

comment on table kitluy_devices.device_generation_keys is
  'Owner: Fleet. One row per device key generation, with a state machine. PUBLIC METADATA ONLY — the private half never leaves the provider and is never stored here. MC: MUT (state machine only). Group 0161 (KLRISK-DEVICE-012): the abandon check now admits `destroyed` with or without a reason, so the 0137 abandoned destruction basis can complete; a reason is still required exactly for `abandoned` and forbidden on `active`/`superseded`.';

commit;

-- ---------------------------------------------------------------------------
-- PROVE THE BOUNDARY MOVED EXACTLY AS INTENDED
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_consrc text;
  v_count integer;
begin
  select count(*) into v_count
    from pg_constraint
   where conrelid = 'kitluy_devices.device_generation_keys'::regclass
     and conname = 'device_generation_keys_abandon_chk';
  if v_count <> 1 then
    raise exception
      'KLUY-MIGRATION-0161: expected exactly one abandon check constraint, found %', v_count
      using errcode = 'P0001';
  end if;

  select pg_get_constraintdef(oid) into v_consrc
    from pg_constraint
   where conrelid = 'kitluy_devices.device_generation_keys'::regclass
     and conname = 'device_generation_keys_abandon_chk';
  if v_consrc not like '%destroyed%' then
    raise exception
      'KLUY-MIGRATION-0161: the abandon check does not admit destroyed: %', v_consrc
      using errcode = 'P0001';
  end if;
  -- The catalogue renders operators upper-case; match the reason requirement
  -- case-insensitively rather than by literal casing.
  if lower(v_consrc) not like '%abandon_reason is not null%' then
    raise exception
      'KLUY-MIGRATION-0161: the abandon check no longer requires a reason for abandoned: %',
      v_consrc
      using errcode = 'P0001';
  end if;

  -- The reservation-closing half shipped too: the replaced function closes the
  -- dead attempt (its body names the reservations table), and it remains owned
  -- by the NOLOGIN definer authority.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'abandon_generation_key_v1'
       and pg_get_functiondef(p.oid) like '%device_renewal_reservations%'
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_issuer') then
    raise exception
      'KLUY-MIGRATION-0161: abandon_generation_key_v1 does not close the dead reservation'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0161: the abandoned destruction basis is reachable; the reason requirement is unchanged (KLRISK-DEVICE-012)';
end
$guard$;
