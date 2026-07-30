-- kitluy:group:0143
-- Migration group 0143: destruction_eligibility_blocker_fix.
--
-- Authority: KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031).
-- Corrects:  group 0137's `evaluate_key_destruction_eligibility_v1`.
--
-- Additive. Group 0137 is COMMITTED and is NOT edited; the function is replaced
-- in place by `create or replace`, exactly as groups 0139 and 0140 replaced
-- earlier definitions rather than rewriting the migration that shipped them.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHAT WAS WRONG
-- ===========================================================================
-- Seven of the eight blocker appends were written as
--
--     v_blockers := v_blockers || 'HOLD_ACTIVE';
--
-- In PostgreSQL an UNTYPED literal on the right of `||` does not resolve to
-- `array_append(anyarray, anyelement)`. It resolves to
-- `array_cat(anyarray, anyarray)`, the literal is parsed as an array, and the
-- statement raises
--
--     22P02  malformed array literal: "HOLD_ACTIVE"
--
-- So EVERY one of these blockers aborted the evaluator instead of being
-- reported by it: REFERENCED_BY_ISSUED_CREDENTIAL, UNFINISHED_RENEWAL,
-- OVERLAP_END_UNKNOWN, ABANDONED_AT_UNKNOWN, NO_VERIFIED_TERMINAL_RECOVERY,
-- HOLD_ACTIVE and RETENTION_NOT_ELAPSED. The eighth,
-- `format('KEY_STATE_%s', ...)`, was always fine because `format()` returns a
-- typed `text`.
--
-- WHY THIS IS A DEFECT AND NOT AN INCIDENT. It FAILS CLOSED: the statement
-- aborts, no destruction request is written, no key is destroyed and nothing is
-- authorized. Nobody could destroy a key they should not have. What was lost is
-- the ANSWER — an operator asking "why can this key not be destroyed" received
-- an array-syntax error instead of "HOLD_ACTIVE", which invites the next reader
-- to diagnose a harness fault rather than the legal hold that actually fired.
-- An eligibility evaluator whose refusals are unreadable is one nobody trusts,
-- and the reflex fix for an unreadable error is to route around it.
--
-- Same PostgreSQL trap as RC-017, which records it for 150 lines of
-- `assertions.sql`. RC-017 is a REPORTING defect in a test harness; this one was
-- in a GOVERNED FUNCTION, which is why it is fixed here and RC-017 is not.
--
-- ===========================================================================
-- WHAT CHANGED
-- ===========================================================================
-- Exactly seven `::text` casts. The body below is the LIVE group 0137
-- definition, extracted with `pg_get_functiondef` so that no judgement,
-- reformatting or while-I-am-here edit could drift it: same signature, same
-- owner, same pinned search_path, same SECURITY DEFINER, same blocker
-- vocabulary in the same order, same return shape.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

CREATE OR REPLACE FUNCTION kitluy_devices.evaluate_key_destruction_eligibility_v1(p_device_record_id uuid, p_environment text, p_provider_key_reference text, p_trusted_now timestamp with time zone, p_trusted_time_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'kitluy_devices', 'extensions', 'pg_catalog'
AS $function$
declare
  v_key kitluy_devices.device_generation_keys;
  v_policy kitluy_devices.key_destruction_policy;
  v_head kitluy_devices.device_credential_heads;
  v_blockers text[] := array[]::text[];
  v_eligible_from timestamptz;
  v_basis text;
  v_recovery timestamptz;
  v_overlap timestamptz;
begin
  -- §5: trusted time unavailable or untrusted is a BLOCKER, not a warning.
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_now is null then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['TRUSTED_TIME_UNAVAILABLE']),
      'reason', 'destruction eligibility is decided against trusted time');
  end if;

  select * into v_policy from kitluy_devices.key_destruction_policy
   where environment = p_environment;
  if not found or not v_policy.destruction_enabled then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['DESTRUCTION_NOT_ENABLED']),
      'reason', 'no enabled destruction policy for this environment');
  end if;

  select * into v_key from kitluy_devices.device_generation_keys
   where device_record_id = p_device_record_id
     and environment = p_environment
     and key_handle = p_provider_key_reference;
  if not found then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['PROVIDER_KEY_NOT_FOUND']),
      'reason', 'no such provider key for this device');
  end if;

  -- §5: only a finished key is a candidate at all. `active` and
  -- `credential_issued_pending_activation` are refused outright (§10).
  if v_key.state not in ('superseded', 'abandoned') then
    v_blockers := v_blockers || format('KEY_STATE_%s', upper(v_key.state::text));
  end if;
  if v_key.destroyed_at is not null then
    return jsonb_build_object('eligible', false, 'authorized', false,
      'blockers', to_jsonb(array['ALREADY_DESTROYED']), 'reason', 'the key is already destroyed');
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = p_device_record_id and environment = p_environment;

  -- §5: referenced by the CURRENT credential, or by any credential still
  -- issued. Under same-key renewal the superseded key still backs the current
  -- credential, which is the case that would otherwise destroy a working key.
  if exists (
    select 1 from kitluy_devices.device_credentials c
     where c.device_record_id = p_device_record_id
       and c.environment = p_environment
       and c.public_key_fingerprint = v_key.public_key_fingerprint
       and c.state = 'issued')
  then
    v_blockers := v_blockers || 'REFERENCED_BY_ISSUED_CREDENTIAL'::text;
  end if;

  -- §5: attached to an unfinished renewal, issuance or reconciliation.
  if exists (
    select 1 from kitluy_devices.device_renewal_reservations r
     where r.device_record_id = p_device_record_id
       and r.status not in ('completed', 'refused', 'abandoned'))
  then
    v_blockers := v_blockers || 'UNFINISHED_RENEWAL'::text;
  end if;

  -- The retention floors. §4: the eligibility time is the LATEST applicable.
  select max(occurred_at) into v_recovery
    from kitluy_devices.device_renewal_reconciliations
   where device_record_id = p_device_record_id;

  if v_key.state = 'superseded' then
    v_overlap := v_head.overlap_ends_at;
    if v_overlap is null then
      -- §2: absent overlap_ends_at means the retention clock never started.
      v_blockers := v_blockers || 'OVERLAP_END_UNKNOWN'::text;
      v_eligible_from := null;
    else
      v_eligible_from := v_overlap + make_interval(days => v_policy.superseded_minimum_retention_days);
    end if;
    v_basis := 'superseded';
  else
    if v_key.abandoned_at is null then
      v_blockers := v_blockers || 'ABANDONED_AT_UNKNOWN'::text;
      v_eligible_from := null;
    else
      v_eligible_from := v_key.abandoned_at + make_interval(days => v_policy.abandoned_minimum_retention_days);
    end if;
    v_basis := 'abandoned';
  end if;

  -- §4: recovery retention applies to BOTH bases. When no verified terminal
  -- recovery timestamp exists the key is NOT eligible — absence is a blocker,
  -- not a zero.
  if v_recovery is null then
    v_blockers := v_blockers || 'NO_VERIFIED_TERMINAL_RECOVERY'::text;
  elsif v_eligible_from is not null then
    v_eligible_from := greatest(
      v_eligible_from, v_recovery + make_interval(days => v_policy.recovery_retention_days));
  end if;

  -- §5, §8: any ACTIVE hold blocks.
  if exists (
    select 1 from kitluy_devices.device_key_holds h
     where h.device_record_id = p_device_record_id
       and h.provider_key_reference = p_provider_key_reference
       and h.released_at is null)
  then
    v_blockers := v_blockers || 'HOLD_ACTIVE'::text;
  end if;

  if v_eligible_from is not null and p_trusted_now < v_eligible_from then
    v_blockers := v_blockers || 'RETENTION_NOT_ELAPSED'::text;
  end if;

  return jsonb_build_object(
    'eligible', cardinality(v_blockers) = 0,
    -- ELIGIBLE IS NOT AUTHORIZED. Four-eyes decides the second (§6), and it
    -- has not happened at evaluation time.
    'authorized', false,
    'blockers', to_jsonb(v_blockers),
    'retention_basis', v_basis,
    'eligible_from', v_eligible_from,
    'overlap_ends_at', v_overlap,
    'abandoned_at', v_key.abandoned_at,
    'latest_terminal_recovery_at', v_recovery,
    'public_key_fingerprint', v_key.public_key_fingerprint,
    'key_generation', v_key.key_generation,
    'key_state', v_key.state::text,
    'policy_decision_ref', v_policy.approved_by_decision_ref,
    'policy_version', v_policy.policy_version);
end
$function$;

-- Re-stated after the replace. `create or replace` preserves owner and ACL, but
-- stating them keeps this migration readable on its own and section 32's
-- hygiene assertion refuses a PUBLIC EXECUTE.
alter function kitluy_devices.evaluate_key_destruction_eligibility_v1(uuid, text, text, timestamptz, text)
  owner to kitluy_credential_issuer;
revoke all on function
  kitluy_devices.evaluate_key_destruction_eligibility_v1(uuid, text, text, timestamptz, text) from public;
grant execute on function
  kitluy_devices.evaluate_key_destruction_eligibility_v1(uuid, text, text, timestamptz, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.evaluate_key_destruction_eligibility_v1(uuid, text, text, timestamptz, text) is
  'KLREQ-031 destruction eligibility. Group 0143 corrects group 0137: seven blocker appends used an untyped literal, which PostgreSQL resolves to array_cat rather than array_append, so REFERENCED_BY_ISSUED_CREDENTIAL, UNFINISHED_RENEWAL, OVERLAP_END_UNKNOWN, ABANDONED_AT_UNKNOWN, NO_VERIFIED_TERMINAL_RECOVERY, HOLD_ACTIVE and RETENTION_NOT_ELAPSED each raised 22P02 malformed array literal instead of being reported. It failed CLOSED — nothing was ever destroyed by it — but an unreadable refusal is one nobody can act on. Only the seven casts changed; the body is group 0137''s, extracted from the live catalogue so it could not drift.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;
