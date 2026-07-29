-- kitluy:group:0132
-- Migration group 0132: renewal_finalization_corrections (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0131 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Two defects, BOTH found by executing a real same-key renewal end to end as
-- `kitluy_issuance_service`. Neither is a missing fixture or a missing seed:
-- the identical fixture succeeds once defect A is avoided, and defect B is
-- structural in the state machine.
--
-- ===========================================================================
-- DEFECT A — THE OVERLAP WINDOW COMPARED TWO DIFFERENT CLOCKS
-- ===========================================================================
-- Group 0127's finalization computes the overlap from DEVICE TRUSTED TIME:
--
--     overlap_ends_at := least(attempt.not_before + interval '3 days',
--                              previous_credential.not_after)
--
-- `not_before` is the trusted time the device presented at preparation.
--
-- Group 0125's trigger bounds the same value by SERVER TIME:
--
--     if new.overlap_ends_at > new.updated_at + interval '3 days' then refuse
--
-- `updated_at` is `now()`, the database transaction clock.
--
-- Those are DIFFERENT CLOCKS, and KLD-2026-07-28-002 §12 separates them ON
-- PURPOSE: device trusted time governs certificate validity, server time
-- governs approval creation and expiry. They are never guaranteed to agree.
--
-- The consequence: whenever the device's trusted time is AHEAD of the server
-- clock by any amount at all, `not_before + 3 days` exceeds `now() + 3 days`
-- and finalization is refused with KLUY-CRED-OVERLAP-EXCEEDED. Measured on the
-- local stack, a skew of 69 MILLISECONDS was enough. Renewal was therefore not
-- merely fragile — it was impossible for any device whose trusted time did not
-- happen to lag the database.
--
-- It was never caught because no renewal had ever been finalized: group 0127's
-- tests issue GENERATION 1, where the head is INSERTed with a null overlap and
-- the comparison never runs.
--
-- THE FIX: anchor the bound on the same clock the value is derived from — the
-- NEW credential's own `not_before`. Both sides are then device trusted time,
-- and the rule states what §5 actually says: a credential may overlap its
-- predecessor by at most three days OF ITS OWN VALIDITY. The independent cap
-- against the previous credential's expiry is kept unchanged, so the overlap
-- still cannot outlive the credential it overlaps.
--
-- This is NOT a relaxation. Under the old rule an overlap could legitimately
-- run to `now() + 3 days` with a `not_before` in the past — i.e. more than
-- three days of the new credential's life. The new rule is tighter there and
-- correct where the old one was merely unreachable.
--
-- ===========================================================================
-- DEFECT B — A reuse_current_key RENEWAL COULD NEVER COMPLETE
-- ===========================================================================
-- Group 0130 defines `completed` in `renewal_reservation_status` and writes it
-- in exactly one place: `confirm_provider_key_activation_v1`. That function
-- requires a `device_generation_keys` row bound to the renewal attempt, and the
-- only writer of that binding, `register_generation_key_v2`, REFUSES any
-- reservation that is not `rotate_key`.
--
-- So a `reuse_current_key` reservation reaches `issuance_pending`, its
-- credential is issued, the head advances — and the reservation stays
-- `issuance_pending` for ever. Observed directly: after a fully successful
-- renewal, `status = issuance_pending`. The renewal that HAD completed could
-- not say so, and the open-reservation partial unique index therefore kept
-- blocking the NEXT renewal of that generation.
--
-- THE FIX: complete it where it actually completes — atomically with the
-- credential insert, in the same transaction as the audit, chain links and head
-- advance. A rotation reservation is untouched and still waits for provider
-- activation, because for rotation a credential row genuinely does not prove
-- the private half is usable (group 0130 TASK D).
--
-- The trigger BINDS before it completes. It matches the reservation by
-- (device, environment, purpose, next_credential_generation) — unique among
-- OPEN reservations by group 0130's partial index — and then refuses unless the
-- credential really is the renewal it claims: previous generation, assignment
-- generation, and the incumbent's fingerprint. That last check is what makes
-- `reuse_current_key` MEAN reuse at the database level: a renewal that
-- finalized against a different key is refused outright rather than silently
-- completed.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- DEFECT A — one clock, not two
-- ===========================================================================
create or replace function kitluy_devices.enforce_overlap_window()
returns trigger
language plpgsql
as $overlap$
declare
  v_prev_not_after timestamptz;
  v_new_not_before timestamptz;
begin
  if new.previous_generation is null then
    return new;
  end if;

  select not_after into v_prev_not_after
  from kitluy_devices.device_credentials
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and certificate_generation = new.previous_generation;

  -- Unchanged from group 0125: an overlap may never outlive the credential it
  -- overlaps. This one compares two DEVICE-trusted-time values already.
  if v_prev_not_after is not null and new.overlap_ends_at > v_prev_not_after then
    raise exception
      'KLUY-CRED-OVERLAP-BEYOND-EXPIRY: overlap ends % but the previous credential expires %',
      new.overlap_ends_at, v_prev_not_after using errcode = 'P0001';
  end if;

  -- §5: three days maximum, measured against the NEW credential's own validity
  -- start. Group 0125 measured it against `updated_at`, the SERVER clock, while
  -- group 0127 derives the value from `not_before`, the DEVICE trusted clock —
  -- so any positive skew refused a legitimate renewal. Finalization inserts the
  -- credential before it advances the head, so this row is always present here.
  select not_before into v_new_not_before
  from kitluy_devices.device_credentials
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and certificate_generation = new.current_generation;

  if v_new_not_before is null then
    -- No credential for the incoming head generation. Fail CLOSED on the
    -- original server-clock rule rather than skipping the check: an unknown
    -- credential is not a licence to overlap.
    if new.overlap_ends_at > new.updated_at + interval '3 days' then
      raise exception
        'KLUY-CRED-OVERLAP-EXCEEDED: an overlap ending % exceeds the 3-day development maximum from %',
        new.overlap_ends_at, new.updated_at using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.overlap_ends_at > v_new_not_before + interval '3 days' then
    raise exception
      'KLUY-CRED-OVERLAP-EXCEEDED: an overlap ending % exceeds the 3-day development maximum from the new credential validity start %',
      new.overlap_ends_at, v_new_not_before using errcode = 'P0001';
  end if;

  return new;
end;
$overlap$;

comment on function kitluy_devices.enforce_overlap_window() is
  'Group 0132 DEFECT A. The three-day overlap is measured against the NEW credential''s own not_before — device trusted time, the same clock group 0127 derives overlap_ends_at from. Group 0125 measured it against updated_at (server now()), so any positive device-vs-server skew, measured as low as 69ms, refused a legitimate renewal with KLUY-CRED-OVERLAP-EXCEEDED. The independent cap against the previous credential''s expiry is unchanged, and a missing credential row for the incoming head generation still fails closed on the original rule.';

-- ===========================================================================
-- DEFECT B — completion, bound and atomic
-- ===========================================================================
create or replace function kitluy_devices.complete_same_key_renewal()
returns trigger
language plpgsql
as $complete$
declare
  v_res kitluy_devices.device_renewal_reservations;
  v_incumbent kitluy_devices.device_credentials;
begin
  -- The reservation for THIS generation, if one is open. Unique among open
  -- reservations by group 0130's partial index, so this cannot be ambiguous.
  select * into v_res
  from kitluy_devices.device_renewal_reservations
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and next_credential_generation = new.certificate_generation
    and status not in ('refused', 'abandoned', 'completed')
  for update;

  if not found then
    -- Initial issuance, or a reservation already terminal. Neither is an error.
    return new;
  end if;

  -- ROTATION IS NOT COMPLETED HERE. Group 0130 TASK D: for a rotated key a
  -- credential row proves nothing about whether the private half is loaded in
  -- the external provider, so it waits for confirm_provider_key_activation_v1.
  if v_res.renewal_mode <> 'reuse_current_key' then
    return new;
  end if;

  if v_res.current_credential_generation <> new.certificate_generation - 1 then
    raise exception
      'KLUY-RENEWAL-GENERATION-BINDING: reservation % renews generation % but the credential is generation %',
      v_res.renewal_attempt_id, v_res.current_credential_generation, new.certificate_generation
      using errcode = 'P0001';
  end if;
  if v_res.assignment_generation <> new.assignment_generation then
    raise exception
      'KLUY-RENEWAL-ASSIGNMENT-BINDING: reservation % froze assignment generation %, the credential carries %',
      v_res.renewal_attempt_id, v_res.assignment_generation, new.assignment_generation
      using errcode = 'P0001';
  end if;

  -- THE CHECK THAT MAKES `reuse_current_key` MEAN IT. A renewal that finalized
  -- against a different key is not a same-key renewal, and is refused rather
  -- than quietly completed.
  select * into v_incumbent from kitluy_devices.device_credentials
  where credential_id = v_res.current_credential_id;
  if not found then
    raise exception
      'KLUY-RENEWAL-NO-INCUMBENT: reservation % names credential % which does not exist',
      v_res.renewal_attempt_id, v_res.current_credential_id using errcode = 'P0001';
  end if;
  if v_incumbent.public_key_fingerprint <> new.public_key_fingerprint then
    raise exception
      'KLUY-RENEWAL-KEY-CHANGED: reuse_current_key reservation % finalized against a different key than the incumbent',
      v_res.renewal_attempt_id using errcode = 'P0001';
  end if;

  update kitluy_devices.device_renewal_reservations
  set status = 'completed'
  where renewal_attempt_id = v_res.renewal_attempt_id;

  return new;
end;
$complete$;

comment on function kitluy_devices.complete_same_key_renewal() is
  'Group 0132 DEFECT B. Completes a reuse_current_key renewal ATOMICALLY with the credential insert, because group 0130 left `completed` reachable only through confirm_provider_key_activation_v1 — which requires a provider key bound to the attempt, which only rotation ever creates. A same-key reservation was therefore stuck at issuance_pending for ever, and the open-reservation index kept blocking the next renewal. Rotation is deliberately untouched and still waits for provider activation. The trigger binds generation, assignment generation and the INCUMBENT FINGERPRINT before completing, so a renewal that finalized against a different key is refused rather than completed.';

create trigger trg_device_credentials_complete_same_key_renewal
  after insert on kitluy_devices.device_credentials
  for each row execute function kitluy_devices.complete_same_key_renewal();

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0132$
declare
  v_findings text[] := array[]::text[];
begin
  -- The overlap trigger must still be armed, and on the head table.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_credential_heads'
      and t.tgname = 'trg_device_heads_overlap' and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the overlap trigger is no longer armed on device_credential_heads';
  end if;

  -- The completion trigger must be armed on the credential table.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_credentials'
      and t.tgname = 'trg_device_credentials_complete_same_key_renewal' and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the same-key completion trigger is not armed';
  end if;

  -- Group 0130's containment must be intact: rotation still disabled, and the
  -- open-reservation index still present.
  if (select allow_key_rotation from kitluy_devices.renewal_policy
       where environment = 'development') then
    v_findings := v_findings || 'key rotation became enabled in the shipped development policy';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'kitluy_devices'
      and indexname = 'device_renewal_reservations_open_uq'
  ) then
    v_findings := v_findings || 'the open-reservation unique index is gone';
  end if;

  -- Nothing here may have widened the executor boundary (group 0131).
  if has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'create')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_credentials', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_credential_heads', 'update')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_renewal_reservations', 'update') then
    v_findings := v_findings || 'the issuance executor gained authority it must not have';
  end if;

  -- RLS is untouched.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('device_credentials', 'device_credential_heads',
                        'device_renewal_reservations')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    v_findings := v_findings || 'a governed table lost RLS ENABLE+FORCE';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'MIGRATION 0132 REFUSED: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0132$;

do $revoke_public$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
  end loop;
end
$revoke_public$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
