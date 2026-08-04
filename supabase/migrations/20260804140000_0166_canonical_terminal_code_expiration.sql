-- kitluy:group:0166
-- Migration group 0166: canonical_terminal_code_expiration.
--
-- Authority: WS-11-T004-P02B2B2A (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migrations
-- 0162-0165 (schema, issuance, presentation, revocation).
--
-- ===========================================================================
-- ONE IMPLEMENTATION AUTHORITY FOR EXPIRATION
-- ===========================================================================
-- This group creates the canonical internal transition
-- `expire_terminal_provisioning_code_v1` — the ONLY place in the repository
-- where an ISSUED terminal provisioning code becomes EXPIRED — and refactors
-- the 0164 presentation evaluator to DELEGATE to it. After this group the
-- evaluator owns no due-time calculation, no EXPIRED mutation and no EXPIRED
-- event insertion of its own.
--
-- The helper is INTERNAL: governor-owned, executable by the sanctioned test
-- harness alone during this package. The 0164 evaluator composes it now;
-- P02B2B2B composes it into issuance (expired-code replacement); P02C owns
-- any production grant. No sweep, no worker, no job is added here.
--
-- Ownership borrow, same as groups 0125-0165: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE CANONICAL EXPIRATION HELPER
-- ---------------------------------------------------------------------------
-- Everything authoritative is derived from the stored rows and the sanctioned
-- clock. The caller supplies a code id, a correlation id, a safe trigger
-- source and a trusted actor classification — never a scope, a Hub, a
-- profile, an environment, a state or a clock.
create or replace function kitluy_devices.expire_terminal_provisioning_code_v1(
  p_provisioning_code_id uuid,
  p_correlation_id uuid,
  p_trigger_source text,
  p_actor_type text default 'SYSTEM',
  p_actor_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions
as $expire$
declare
  v_code kitluy_devices.device_provisioning_codes;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_now timestamptz;
  v_final_state text;
begin
  -- CONTRACT violations are jsonb refusals, never raised errors.
  if p_provisioning_code_id is null then
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-CODE',
      'detail', 'an expiration names exactly one provisioning code');
  end if;
  if p_correlation_id is null then
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-CORRELATION',
      'detail', 'an expiration carries a correlation id');
  end if;
  if p_trigger_source is null
     or p_trigger_source !~ '^[A-Z0-9_]{1,64}$' then
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-BAD-TRIGGER-SOURCE',
      'detail', 'trigger source must be 1-64 upper-case identifier characters');
  end if;
  if p_actor_type not in ('OPERATOR', 'TERMINAL', 'SYSTEM', 'WORKER') then
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-BAD-ACTOR-TYPE',
      'detail', 'actor type must be one of OPERATOR, TERMINAL, SYSTEM, WORKER');
  end if;

  -- 1. READ ONCE to derive the assignment; the established lock order is
  -- ASSIGNMENT first, CODE second (the evaluator and the revocation door use
  -- the same order, so expiration serializes with both instead of
  -- deadlocking). Everything is re-read under the locks below.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = p_provisioning_code_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NOT-FOUND',
      'detail', 'no provisioning code with that id');
  end if;

  -- 2. THE ASSIGNMENT, LOCKED FIRST (shared ordering).
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = v_code.terminal_assignment_id
   for update;
  if not found then
    -- The foreign key makes this unreachable; fail closed anyway.
    return jsonb_build_object(
      'outcome', 'EXPIRATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-SCOPE-INCONSISTENT',
      'detail', 'the code names an assignment that does not exist');
  end if;

  -- 3. THE CODE ROW, LOCKED, re-read under the lock.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = p_provisioning_code_id
   for update;

  -- 4. TERMINAL STATES ARE NEVER OVERWRITTEN: stable classifications, no
  -- mutation, no event, no timestamp change.
  if v_code.state = 'expired' then
    return jsonb_build_object(
      'outcome', 'ALREADY_EXPIRED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'expired',
      'detail', 'the code is already expired; nothing was mutated and no event was appended');
  end if;
  if v_code.state = 'revoked' then
    return jsonb_build_object(
      'outcome', 'ALREADY_REVOKED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'revoked',
      'revoked_at', v_code.revoked_at,
      'detail', 'the code is already revoked; expiration never overwrites a terminal state');
  end if;
  if v_code.state = 'locked' then
    return jsonb_build_object(
      'outcome', 'ALREADY_LOCKED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'locked',
      'locked_at', v_code.locked_at,
      'detail', 'the code is already locked; expiration never overwrites a terminal state');
  end if;
  if v_code.state = 'redeemed' then
    return jsonb_build_object(
      'outcome', 'ALREADY_REDEEMED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'redeemed',
      'detail', 'the code is already redeemed; expiration never overwrites a terminal state');
  end if;

  -- 5. THE DUE-TIME RULE, on the sanctioned authoritative clock ONLY. A code
  -- is valid only while authoritative_now < expires_at; the exact equality
  -- boundary expires. There is no timestamp parameter anywhere on this
  -- helper.
  v_now := kitluy_ops.authoritative_now_v1();
  if v_now < v_code.expires_at then
    return jsonb_build_object(
      'outcome', 'NOT_DUE',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'issued',
      'expires_at', v_code.expires_at,
      'detail', 'the code is issued and not yet due; nothing was mutated and no event was appended');
  end if;

  -- 6. THE TRANSITION. Attempt count, assignment, Hub, scope, profile,
  -- locked_at and revoked_at are all preserved by simply not touching them;
  -- the state guard makes a losing racer answer the winner's terminal
  -- classification instead of raising an uncontrolled error.
  update kitluy_devices.device_provisioning_codes
     set state = 'expired'
   where id = v_code.id and state = 'issued';
  if not found then
    select c.state::text into v_final_state
      from kitluy_devices.device_provisioning_codes c where c.id = v_code.id;
    return jsonb_build_object(
      'outcome', 'ALREADY_' || upper(v_final_state),
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', v_final_state,
      'detail', 'a competing transition committed first; the terminal state stands');
  end if;

  -- 7. EXACTLY ONE EVENT, atomic with the transition. It carries the derived
  -- scope facts, the trusted actor classification, the safe trigger source
  -- and the authoritative time — never a raw code, a candidate, a digest or
  -- any secret.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, reason_code, correlation_id, detail)
  values
    (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
     v_code.environment, 'EXPIRED', p_actor_type, p_actor_ref, 'TTL_ELAPSED',
     p_correlation_id, jsonb_build_object('trigger_source', p_trigger_source));

  return jsonb_build_object(
    'outcome', 'EXPIRED',
    'provisioning_code_id', v_code.id,
    'terminal_assignment_id', v_code.terminal_assignment_id,
    'state', 'expired',
    'expired_at', v_now,
    'expires_at', v_code.expires_at,
    'correlation_id', p_correlation_id,
    'detail', 'the code reached its immutable expires_at on the authoritative clock and is terminally expired');
end
$expire$;

comment on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text) is
  'Group 0166 (WS-11-T004-P02B2B2A). THE canonical ISSUED->EXPIRED transition for terminal provisioning codes — the only implementation of expiration in the repository. Locks assignment then code (the shared order), derives all scope from stored rows, evaluates due time on the sanctioned authoritative clock (now >= expires_at expires; the equality boundary expires), preserves attempts and every binding, and appends exactly one EXPIRED event. Terminal states are never overwritten; NOT_DUE mutates nothing. INTERNAL: harness-only during this package; the 0164 evaluator composes it, P02B2B2B composes it into issuance, P02C owns production grants.';

alter function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)
  owner to kitluy_activation_governor;

-- INTERNAL ONLY. The 0164 evaluator runs as the same definer owner, so it
-- composes the helper without any grant; the sanctioned test harness borrows
-- execution for proof. P02B2B2B (issuance composition) and P02C (production
-- grants) own the later boundaries.
revoke all on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text) from public;
revoke all on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text) from anon;
revoke all on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text) from authenticated;
revoke all on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text) from service_role;
grant execute on function kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)
  to kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 2. THE EVALUATOR DELEGATES: one expiry authority, no duplicate logic
-- ---------------------------------------------------------------------------
-- The body is IDENTICAL to group 0164 except step 3: the evaluator no longer
-- computes due time, mutates EXPIRED state or inserts the EXPIRED event. It
-- delegates to the canonical helper — under the SAME locks it already holds
-- (the helper's lock order is the evaluator's own order, so the nested call
-- is a re-entrant no-op, never a deadlock) — and maps the helper's canonical
-- outcome onto the refusal vocabulary its callers and tests already rely on.
-- Signature, owner and grants are unchanged (CREATE OR REPLACE preserves
-- them; the guard below proves it).
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
  v_expiry jsonb;
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

  -- 3. AUTHORITATIVE EXPIRY, DELEGATED (group 0166): the canonical helper
  -- owns the due-time rule, the transition and the one EXPIRED event. An
  -- expired code is a bookkeeping fact, not a failed attempt, and it never
  -- counts one. The evaluator's trusted actor context flows through, so the
  -- event names the presenter rather than a faceless system.
  v_expiry := kitluy_devices.expire_terminal_provisioning_code_v1(
    v_code.id, p_correlation_id, 'PRESENTATION_EVALUATOR', p_actor_type, p_actor_ref);
  if v_expiry ->> 'outcome' in ('EXPIRED', 'ALREADY_EXPIRED') then
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-EXPIRED',
      'provisioning_code_id', v_code.id,
      'state', 'expired',
      'expired_at', v_expiry ->> 'expired_at',
      'detail', 'the code expired on the authoritative clock; this is not a failed attempt');
  end if;
  if v_expiry ->> 'outcome' <> 'NOT_DUE' then
    -- Unreachable under the locks held above; fail closed with the terminal
    -- classification of whatever the code actually is.
    select * into v_terminal
      from kitluy_devices.device_provisioning_codes where id = v_code.id;
    return jsonb_build_object(
      'outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(v_terminal.state::text),
      'provisioning_code_id', v_terminal.id,
      'state', v_terminal.state,
      'detail', 'the code is no longer outstanding');
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
    -- The lockout timestamp is the ONLY time this function still stamps
    -- itself; expiry time now lives exclusively in the canonical helper.
    v_now := kitluy_ops.authoritative_now_v1();
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

-- The lockout branch stamps locked_at from the authoritative clock itself
-- (assigned in that branch); expiry time lives exclusively in the helper.

comment on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text) is
  'Group 0164 (WS-11-T004-P02B2A), refactored by group 0166 (WS-11-T004-P02B2B2A). INTERNAL presentation evaluator. Resolves assignment and outstanding code under one locked transaction, DELEGATES expiry to the canonical expire_terminal_provisioning_code_v1 (no due-time calculation, no EXPIRED mutation and no EXPIRED event of its own remains), compares normalized input against the stored digest in constant time, counts every genuine failure atomically, and locks terminally on the fifth. The presented value and its digest are never persisted. MATCH_READY is a recheck input for P02B3, never an authorization.';

-- CREATE OR REPLACE preserves owner and grants; re-asserted in the guard.

-- ---------------------------------------------------------------------------
-- 3. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
begin
  -- The helper exists with the intended signature, definer, NOLOGIN owner,
  -- pinned search_path (arguments compared without their DEFAULT spelling).
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'expire_terminal_provisioning_code_v1'
       and regexp_replace(pg_get_function_arguments(p.oid), ' DEFAULT [^,]+', '', 'g')
           = 'p_provisioning_code_id uuid, p_correlation_id uuid, p_trigger_source text, p_actor_type text, p_actor_ref text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0166: the helper is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The helper's internal boundary: nobody but the governor and the harness.
  if has_function_privilege('public', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_issuance_service', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0166: the helper''s internal boundary is wrong'
      using errcode = 'P0001';
  end if;

  -- No direct table mutation grant was introduced.
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0166: a direct table mutation grant exists'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on both tables; the append-only trigger stands.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0166: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.device_provisioning_code_events'::regclass
       and tgname = 'trg_device_provisioning_code_events_append_only') then
    raise exception 'KLUY-MIGRATION-0166: the append-only event trigger is missing'
      using errcode = 'P0001';
  end if;

  -- No raw-code or candidate-digest column exists on either table (the
  -- identifiers and reason reference are named exclusions, as in 0165).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (column_name ~ '(^|_)(code|raw|plain|secret)(_|$)'
            and column_name not in ('code_digest', 'provisioning_code_id', 'reason_code'))) then
    raise exception 'KLUY-MIGRATION-0166: a column that could hold a raw code exists'
      using errcode = 'P0001';
  end if;

  -- The evaluator's signature, owner and grants are unchanged by the
  -- refactor; so are the issuance and revocation doors'.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'evaluate_terminal_provisioning_code_v1'
       and regexp_replace(pg_get_function_arguments(p.oid), ' DEFAULT [^,]+', '', 'g')
           = 'p_terminal_assignment_id uuid, p_presented_code text, p_correlation_id uuid, p_actor_type text, p_actor_ref text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor') then
    raise exception 'KLUY-MIGRATION-0166: the evaluator''s signature or ownership drifted'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0166: the evaluator, issuance or revocation grant boundary drifted'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0166: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0166: canonical terminal-code expiration applied (one helper, evaluator delegates; no sweep, no worker; P02B2B2B composes issuance, P02C grants)';
end
$guard$;
