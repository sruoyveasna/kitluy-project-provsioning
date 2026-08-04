-- kitluy:group:0164
-- Migration group 0164: terminal_code_presentation_attempts_lockout.
--
-- Authority: WS-11-T004-P02B2A (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migrations
-- 0162-0163 (schema and issuance).
--
-- ===========================================================================
-- WHAT THIS GROUP ADDS — AND WHAT IT DELIBERATELY DOES NOT
-- ===========================================================================
-- ONE internal governed evaluator:
-- `evaluate_terminal_provisioning_code_v1(assignment, presented, correlation,
-- actor type, actor ref)`. It resolves the assignment and the one outstanding
-- code authoritatively, evaluates expiry on the authoritative clock, compares
-- the normalized presented value against the stored digest in constant time,
-- counts every genuine failed presentation atomically, and locks the code on
-- the fifth. It is INTERNAL: owned by the NOLOGIN governor, executable only by
-- the sanctioned test harness during this package. P02B3 owns the public
-- redemption door that will call it; P02C owns production grants.
--
-- It does NOT redeem, consume, unlock, extend, issue or revoke. A MATCH_READY
-- answer is a recheck input for P02B3, never an authorization.
--
-- Ownership borrow, same as groups 0125-0163: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. CONSTANT-TIME COMPARISON HELPER
-- ---------------------------------------------------------------------------
-- Lengths are fixed (64-hex digests), so the length check is not a secret
-- channel; the byte loop never exits early. Used for digests only.
create or replace function kitluy_devices.constant_time_text_eq_v1(
  p_left text,
  p_right text
) returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $cteq$
declare
  v_a bytea;
  v_b bytea;
  v_i integer;
  v_diff integer := 0;
begin
  if p_left is null or p_right is null then
    return false;
  end if;
  v_a := convert_to(p_left, 'UTF8');
  v_b := convert_to(p_right, 'UTF8');
  if length(v_a) <> length(v_b) then
    return false;
  end if;
  for v_i in 0..length(v_a) - 1 loop
    v_diff := v_diff | (pg_catalog.get_byte(v_a, v_i) # pg_catalog.get_byte(v_b, v_i));
  end loop;
  return v_diff = 0;
end
$cteq$;

alter function kitluy_devices.constant_time_text_eq_v1(text, text)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.constant_time_text_eq_v1(text, text) from public;

-- ---------------------------------------------------------------------------
-- 2. THE EVALUATOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_presented_code text,
  p_correlation_id uuid,
  p_actor_type text default 'TERMINAL',
  p_actor_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions
as $eval$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_terminal kitluy_devices.device_provisioning_codes;
  v_normalized text;
  v_now timestamptz;
  v_presented_digest text;
  v_new_count integer;
  v_reason text;
  v_scope kitluy_devices.device_assignments;
begin
  if p_terminal_assignment_id is null then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-ASSIGNMENT',
      'detail', 'a presentation names exactly one terminal assignment');
  end if;
  if p_correlation_id is null then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-CORRELATION',
      'detail', 'a presentation carries a correlation id');
  end if;
  if p_actor_type not in ('OPERATOR', 'TERMINAL', 'SYSTEM', 'WORKER') then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-BAD-ACTOR-TYPE',
      'detail', 'actor type must be one of OPERATOR, TERMINAL, SYSTEM, WORKER');
  end if;

  -- 1. THE ASSIGNMENT, LOCKED. Resolution and evaluation are one transaction.
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-MISSING',
      'detail', 'no terminal assignment with that id');
  end if;
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;

  -- 2. THE OUTSTANDING CODE, LOCKED. If none is issued, the answer is a
  -- terminal classification of the most recent code — with NO new event and
  -- NO attempt, because a presentation against nothing outstanding is not a
  -- brute-force opportunity.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where terminal_assignment_id = p_terminal_assignment_id
     and state = 'issued'
   for update;

  if not found then
    select * into v_terminal
      from kitluy_devices.device_provisioning_codes
     where terminal_assignment_id = p_terminal_assignment_id
     order by created_at desc
     limit 1;
    if not found then
      return jsonb_build_object(
        'outcome', 'NO_OUTSTANDING',
        'refusal_code', 'KLUY-PROVCODE-NO-OUTSTANDING',
        'detail', 'no provisioning code was ever issued for this assignment');
    end if;
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(v_terminal.state::text),
      'provisioning_code_id', v_terminal.id,
      'state', v_terminal.state,
      'detail', format('the code for this assignment is already %s; terminal states take no presentations', v_terminal.state));
  end if;

  -- 3. AUTHORITATIVE EXPIRY, before any syntax or digest work: an expired code
  -- is a bookkeeping fact, not a failed attempt, and it never counts one.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_code.expires_at <= v_now then
    update kitluy_devices.device_provisioning_codes
       set state = 'expired'
     where id = v_code.id and state = 'issued';
    if found then
      insert into kitluy_devices.device_provisioning_code_events
        (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
         event_type, actor_type, actor_ref, reason_code, correlation_id)
      values
        (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
         v_code.environment, 'EXPIRED', 'SYSTEM', null, 'TTL_ELAPSED', p_correlation_id);
      return jsonb_build_object(
        'outcome', 'PRESENTATION_REFUSED',
        'refusal_code', 'KLUY-PROVCODE-EXPIRED',
        'provisioning_code_id', v_code.id,
        'state', 'expired',
        'expired_at', v_now,
        'detail', 'the code expired on the authoritative clock; this is not a failed attempt');
    end if;
    -- A racer performed the transition first; answer terminally, no second event.
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-EXPIRED',
      'provisioning_code_id', v_code.id,
      'state', 'expired',
      'detail', 'the code expired on the authoritative clock; this is not a failed attempt');
  end if;

  -- 4. NORMALIZATION (derived rule, recorded in the handoff, not owner-locked):
  -- valid lowercase Crockford letters normalize to uppercase; NOTHING is
  -- trimmed, nothing ambiguous is aliased — anything else is MALFORMED.
  v_normalized := upper(coalesce(p_presented_code, ''));

  if length(v_normalized) <> 8
     or v_normalized !~ '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$' then
    v_reason := 'MALFORMED';
  else
    v_reason := null;
  end if;

  if v_reason is null then
    -- 5. THE DIGEST, computed from the normalized value against the STORED
    -- digest, in constant time. The presented value and its digest are never
    -- persisted: the eight-character space is searchable, and recording either
    -- would hand an attacker a dictionary.
    v_presented_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');
    if kitluy_devices.constant_time_text_eq_v1(v_presented_digest, v_code.code_digest) then
      -- MATCH: recheck input for P02B3. No consumption, no state change, no
      -- attempt increment, no raw code anywhere.
      insert into kitluy_devices.device_provisioning_code_events
        (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
         event_type, actor_type, actor_ref, correlation_id)
      values
        (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
         v_code.environment, 'PRESENTED', p_actor_type, p_actor_ref, p_correlation_id);
      return jsonb_build_object(
        'outcome', 'MATCH_READY',
        'provisioning_code_id', v_code.id,
        'terminal_assignment_id', v_assignment.id,
        'terminal_profile_key', v_assignment.terminal_profile_key,
        'store_hub_device_id', v_code.store_hub_device_id,
        'environment', v_code.environment,
        'state', v_code.state,
        'failed_attempt_count', v_code.failed_attempt_count,
        'expires_at', v_code.expires_at,
        'detail', 'the presentation matches an issued, unexpired, unlocked code; P02B3 must re-lock and recheck everything before any redemption');
    end if;
    v_reason := 'MISMATCH';
  end if;

  -- 6. THE FAILED ATTEMPT, ATOMICALLY: count +1 (monotonic, capped at five by
  -- the schema), a FAILED_ATTEMPT event, and on the fifth the terminal lock
  -- with its canonical reason and its one security event.
  update kitluy_devices.device_provisioning_codes
     set failed_attempt_count = failed_attempt_count + 1
   where id = v_code.id and state = 'issued'
  returning failed_attempt_count into v_new_count;

  if v_new_count is null then
    -- A racer locked it first; answer with the terminal state, no residue.
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-LOCKED',
      'provisioning_code_id', v_code.id,
      'state', 'locked',
      'detail', 'the code is locked');
  end if;

  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, reason_code, correlation_id, detail)
  values
    (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
     v_code.environment, 'FAILED_ATTEMPT', p_actor_type, p_actor_ref, v_reason,
     p_correlation_id, jsonb_build_object('failed_attempt_count', v_new_count));

  if v_new_count >= 5 then
    update kitluy_devices.device_provisioning_codes
       set state = 'locked',
           locked_at = v_now,
           locked_reason = 'MAX_ATTEMPTS_EXCEEDED'
     where id = v_code.id and state = 'issued';
    insert into kitluy_devices.device_provisioning_code_events
      (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
       event_type, actor_type, actor_ref, reason_code, correlation_id)
    values
      (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
       v_code.environment, 'LOCKED', p_actor_type, p_actor_ref, 'MAX_ATTEMPTS_EXCEEDED',
       p_correlation_id);
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-LOCKED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_assignment.id,
      'state', 'locked',
      'failed_attempt_count', v_new_count,
      'locked_at', v_now,
      'reason_category', v_reason,
      'detail', 'the fifth failed presentation locked the code terminally');
  end if;

  return jsonb_build_object(
    'outcome', 'FAILED_PRESENTATION',
    'provisioning_code_id', v_code.id,
    'terminal_assignment_id', v_assignment.id,
    'state', 'issued',
    'failed_attempt_count', v_new_count,
    'reason_category', v_reason,
    'expires_at', v_code.expires_at,
    'detail', format('failed presentation %s of 5', v_new_count));
end
$eval$;

comment on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) is
  'Group 0164 (WS-11-T004-P02B2A). INTERNAL presentation evaluator for terminal provisioning codes. Resolves assignment and outstanding code under one locked transaction, expires on the authoritative clock (one EXPIRED event, no attempt), compares normalized input against the stored digest in constant time, counts every genuine failure atomically, and locks terminally on the fifth with its canonical reason and security event. The presented value and its digest are never persisted. MATCH_READY is a recheck input for P02B3, never an authorization.';

alter function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  owner to kitluy_activation_governor;

-- INTERNAL ONLY. Nobody else executes this during P02B2A; P02B3 composes it,
-- and P02C owns any production grant. The test harness borrows it like the
-- sanctioned clock and the job scaffolds.
revoke all on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from public;
revoke all on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from anon;
revoke all on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from authenticated;
revoke all on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) from service_role;
grant execute on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  to kitluy_test_harness;
grant execute on function kitluy_devices.constant_time_text_eq_v1(text, text)
  to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 3. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'evaluate_terminal_provisioning_code_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0164: the evaluator is missing, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('public', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0164: the evaluator''s internal boundary is wrong'
      using errcode = 'P0001';
  end if;
  -- The 0163 issuance door's ownership and grants are unchanged.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0164: the issuance door''s boundary drifted'
      using errcode = 'P0001';
  end if;
  -- FORCE RLS still holds on both tables.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0164: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;
  raise notice
    'KLUY-MIGRATION-0164: internal terminal-code presentation evaluator applied (harness-only during P02B2A; P02B3 composes, P02C grants)';
end
$guard$;
