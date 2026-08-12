-- kitluy:group:0168
-- Migration group 0168: ambiguous_issuance_replay_reconciliation.
--
-- Authority: WS-11-T004-P02B2B2B1 (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migrations
-- 0162-0167 (schema, issuance, presentation, revocation, canonical
-- expiration, replacement issuance and lineage).
--
-- ===========================================================================
-- WHAT THIS GROUP IS — AND IS NOT
-- ===========================================================================
-- The P02B2B2B1 audit classified the existing issuance replay as PARTIAL:
-- the identical-key replay locates the canonical committed row and never
-- returns a raw code, but it (a) omits the safe reconciliation fields an
-- authorized caller needs to reconcile a possibly committed request (the
-- row's authoritative state, created_at, terminal assignment, replacement
-- lineage and explicit raw-code/recovery flags) and (b) discloses those row
-- details with NO permission check, so any authenticated actor who learns an
-- idempotency key and assignment id can confirm a committed request outside
-- their scope — the 0165 revocation door refuses exactly this with its
-- scoped-permission gate.
--
-- This group therefore narrows exactly ONE correction: CREATE OR REPLACE of
-- the ONE governed issuance door `issue_terminal_provisioning_code_v1`,
-- preserving its signature, owner, permission, grants, active-Hub gate, code
-- generation, digest binding, initial raw-code response, replacement
-- behavior and lock ordering, and changing ONLY the two identical-replay
-- branches:
--   1. before any row detail is disclosed, the actor must hold the SAME
--      issuance permission for the row's own derived device and environment
--      (the 0165 scoped-permission pattern); otherwise the answer is the
--      repository-standard safe refusal, so a cross-scope caller cannot
--      distinguish "committed" from "nonexistent";
--   2. the ALREADY_ISSUED result gains only SAFE reconciliation fields:
--      terminal_assignment_id, state, created_at,
--      replaces_provisioning_code_id, raw_code_available=false and
--      recovery_required (true exactly while the committed code is still
--      ISSUED). No raw code, no digest, no payload, no key material, no
--      permission internals. The outcome name ALREADY_ISSUED is unchanged.
--
-- It is NOT a new status door; NOT a recovery mutation; NOT a revoke or
-- reissue; NOT an expiration worker; NOT a new permission; NOT a change to
-- the initial-issuance response, the replacement response, the conflicting-
-- replay refusal or any grant. P02B2B2B2 owns explicit lost-code recovery;
-- P02C owns production grant composition.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02B2B2B1 -- no DROP/TRUNCATE/DELETE
-- in this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

-- Ownership borrow, same as groups 0125-0167: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE DOOR, HARDENED AT THE REPLAY BRANCHES ONLY (CREATE OR REPLACE)
-- ---------------------------------------------------------------------------
-- The body is the 0167 body verbatim except the two identical-replay
-- branches (steps 2 and 3b). Everything else — contract refusals, actor
-- resolution, assignment lock, Hub gate, permission gate, outstanding-code
-- lock, canonical-helper delegation, Crockford generation, digest contract,
-- row insert, CREATED event, ISSUED responses and the conflicting-replay
-- refusal — is byte-identical behavior to group 0167.
create or replace function kitluy_devices.issue_terminal_provisioning_code_v1(
  p_terminal_assignment_id uuid,
  p_idempotency_key text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions
as $issue$
declare
  v_actor uuid;
  v_prior kitluy_devices.device_provisioning_codes;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_hub_count integer;
  v_hub uuid;
  v_environment text;
  v_outstanding kitluy_devices.device_provisioning_codes;
  v_expiry jsonb;
  v_expire_correlation uuid;
  v_predecessor uuid;
  v_code text;
  v_digest text;
  v_payload text;
  v_now timestamptz;
  v_expires timestamptz;
  v_code_id uuid;
  v_correlation uuid;
  v_alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  v_bytes bytea;
  v_i integer;
begin
  -- CONTRACT violations are jsonb refusals, never raised errors: a caller
  -- mistake and an attacker must be told apart by the result, not by a crash.
  if p_terminal_assignment_id is null then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-ASSIGNMENT',
      'detail', 'an issuance names exactly one terminal assignment');
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-IDEMPOTENCY-KEY',
      'detail', 'an issuance needs an idempotency key');
  end if;

  -- 1. THE ACTOR. Resolved by the database from the session; never accepted
  -- from any argument, body field or claim the caller could edit.
  v_actor := kitluy_devices.provisioning_code_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-UNAUTHENTICATED',
      'detail', 'no authenticated actor context');
  end if;

  -- 2. IDEMPOTENCY FIRST. A replay names the same key; the row is the record.
  -- A replacement is issued ONLY under a new key: replaying the predecessor's
  -- original key answers the canonical historical result for the predecessor
  -- row and can never create or identify a replacement.
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_prior.terminal_assignment_id = p_terminal_assignment_id then
      -- Group 0168: the replay is the reconciliation boundary. BEFORE any row
      -- detail is disclosed, the actor must hold the SAME issuance permission
      -- for the row's own derived device and environment (the 0165
      -- scoped-permission pattern) — otherwise the repository-standard safe
      -- refusal, so a cross-scope caller cannot tell "committed" from
      -- "nonexistent".
      if not kitluy_devices.provisioning_code_issue_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment) then
        return jsonb_build_object(
          'outcome', 'ISSUANCE_REFUSED',
          'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
          'detail', 'the actor does not hold fleet.device_provisioning_code.issue for this device and environment');
      end if;
      -- Group 0168: SAFE reconciliation fields only. The outcome name is
      -- unchanged; the raw code remains unrecoverable by design; an explicit
      -- flag records that fact, and recovery_required marks the one case
      -- (still ISSUED, raw response lost) where explicit authorized recovery
      -- (P02B2B2B2) is the only way forward. No digest, payload, key
      -- material or permission internals ever appear here.
      return jsonb_build_object(
        'outcome', 'ALREADY_ISSUED',
        'provisioning_code_id', v_prior.id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', v_prior.state,
        'created_at', v_prior.created_at,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
        'replaces_provisioning_code_id', v_prior.replaces_provisioning_code_id,
        'raw_code_available', false,
        'recovery_required', (v_prior.state = 'issued'),
        'detail', 'this idempotency key already issued this code; the raw code was returned once, at initial issuance, and is never stored');
    end if;
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different assignment');
  end if;

  -- 3. THE ASSIGNMENT, LOCKED. Concurrent issuances for one assignment
  -- serialize here, BEFORE any decision is read, so two winners cannot exist.
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-MISSING',
      'detail', 'no terminal assignment with that id');
  end if;

  -- The idempotency check AGAIN, under the lock: a same-key race waits here
  -- for the winner's commit, and the replay must be answered ALREADY_ISSUED
  -- (the first check ran before the winner committed and saw nothing).
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where idempotency_key = p_idempotency_key
   for update;
  if found then
    if v_prior.terminal_assignment_id = p_terminal_assignment_id then
      -- Group 0168: the same scoped-permission gate and the same safe
      -- reconciliation fields as the pre-lock replay branch above.
      if not kitluy_devices.provisioning_code_issue_permitted_v1(
             v_prior.terminal_device_id, v_prior.environment) then
        return jsonb_build_object(
          'outcome', 'ISSUANCE_REFUSED',
          'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
          'detail', 'the actor does not hold fleet.device_provisioning_code.issue for this device and environment');
      end if;
      return jsonb_build_object(
        'outcome', 'ALREADY_ISSUED',
        'provisioning_code_id', v_prior.id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', v_prior.state,
        'created_at', v_prior.created_at,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
        'replaces_provisioning_code_id', v_prior.replaces_provisioning_code_id,
        'raw_code_available', false,
        'recovery_required', (v_prior.state = 'issued'),
        'detail', 'this idempotency key already issued this code; the raw code was returned once, at initial issuance, and is never stored');
    end if;
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different assignment');
  end if;

  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-MISSING',
      'detail', 'the assignment the terminal assignment references does not exist');
  end if;

  -- 4. THE ACTIVE HUB — the ordering gate (ADMIN-QA-014), RE-EVALUATED at
  -- replacement time. The projection is written ONLY by a successful
  -- activation, so its presence IS the active condition; the BLK-005 posture
  -- is inherited: no activation, no projection, no code. A predecessor's
  -- historical Hub binding is never consulted here — the Hub, scope and
  -- environment are derived fresh from the CURRENT projection, so a revoked,
  -- replaced or inactive Hub refuses replacement exactly as it refuses
  -- initial issuance.
  select count(*) into v_hub_count
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id;
  if v_hub_count = 0 then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-HUB-INACTIVE',
      'detail', 'no activated Store Hub at this scope; a terminal cannot provision before its Hub is active');
  end if;
  select p.device_id, p.environment into v_hub, v_environment
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id
   order by p.projected_at, p.device_id
   limit 1;

  -- 5. THE PERMISSION, checked inside the governed transaction, gated on the
  -- derived environment — BEFORE any expiration work, so a caller without
  -- the issuance permission can never expire someone else's code.
  if not kitluy_devices.provisioning_code_issue_permitted_v1(v_assignment.device_id, v_environment) then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'the actor does not hold fleet.device_provisioning_code.issue for this device and environment');
  end if;

  -- 6. THE OUTSTANDING CODE, LOCATED AND LOCKED (group 0167). At most one
  -- ISSUED row exists per assignment (the partial unique index). When none
  -- exists this is the unchanged 0163 initial issuance. When one exists the
  -- canonical 0166 helper decides: NOT_DUE is the unchanged stable
  -- OUTSTANDING result; due means the helper expires the predecessor (the
  -- one EXPIRED event is produced ONLY by the helper) and exactly one
  -- replacement row is issued below, under THIS call's new idempotency key.
  select * into v_outstanding
    from kitluy_devices.device_provisioning_codes
   where terminal_assignment_id = p_terminal_assignment_id
     and state = 'issued'
   for update;
  if found then
    v_expire_correlation := gen_random_uuid();
    v_expiry := kitluy_devices.expire_terminal_provisioning_code_v1(
      v_outstanding.id, v_expire_correlation, 'ISSUANCE_REPLACEMENT', 'OPERATOR', v_actor::text);
    if v_expiry ->> 'outcome' = 'NOT_DUE' then
      return jsonb_build_object(
        'outcome', 'OUTSTANDING',
        'refusal_code', 'KLUY-PROVCODE-OUTSTANDING',
        'detail', 'an unexpired code is already outstanding for this assignment');
    end if;
    if v_expiry ->> 'outcome' not in ('EXPIRED', 'ALREADY_EXPIRED') then
      -- Unreachable under the assignment and row locks held here (no
      -- concurrent transition can commit); fail closed with the row's
      -- terminal classification. A revoked, locked or redeemed code is never
      -- described as an expired predecessor and never overwritten.
      return jsonb_build_object(
        'outcome', 'ISSUANCE_REFUSED',
        'refusal_code', 'KLUY-PROVCODE-ALREADY-'
          || upper(coalesce(v_expiry ->> 'state', 'UNAVAILABLE')),
        'provisioning_code_id', v_outstanding.id,
        'detail', 'the outstanding code reached a terminal state; terminal states are never overwritten and no replacement was issued');
    end if;
    -- ALREADY_EXPIRED is admitted only for the row THIS call located and
    -- locked as the outstanding code of THIS assignment — the expected
    -- predecessor — with every eligibility check above already re-validated.
    v_predecessor := v_outstanding.id;
  end if;

  -- 7. THE CODE. Eight Crockford Base32 characters (no I, L, O, U), one
  -- secure-random byte per character. 256 = 8 * 32 exactly, so byte % 32 is
  -- perfectly uniform — no modulo bias, no timestamp, no sequence, no scope
  -- embedded in plaintext. The raw value exists only in this frame. A
  -- replacement is a COMPLETELY new code: nothing is copied from the
  -- predecessor.
  v_bytes := extensions.gen_random_bytes(8);
  v_code := '';
  for v_i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (pg_catalog.get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;

  -- 8. TIME, from the repository's authoritative helper only. There is no
  -- timestamp parameter anywhere on this door. A replacement gets its own
  -- fresh created_at and expires exactly 15 minutes later.
  v_now := kitluy_ops.authoritative_now_v1();
  v_expires := v_now + interval '15 minutes';

  -- 9. THE DIGEST CONTRACT (0162, unchanged): sha-256 of the raw code for the
  -- digest; sha-256 of the canonical scope binding for the payload, so a
  -- captured digest names nothing outside its own scope.
  v_digest := encode(extensions.digest(v_code, 'sha256'), 'hex');
  v_payload := encode(extensions.digest(
    'ws11-t004.code.v1' || E'\n' ||
    v_scope.tenant_id::text || E'\n' ||
    v_scope.digital_store_id::text || E'\n' ||
    v_scope.store_location_id::text || E'\n' ||
    v_hub::text || E'\n' ||
    v_assignment.device_id::text || E'\n' ||
    v_assignment.id::text || E'\n' ||
    v_assignment.terminal_profile_key || E'\n' ||
    v_environment || E'\n' ||
    v_expires::text,
    'sha256'), 'hex');

  v_code_id := gen_random_uuid();
  v_correlation := gen_random_uuid();

  insert into kitluy_devices.device_provisioning_codes
    (id, tenant_id, digital_store_id, store_location_id, store_hub_device_id,
     terminal_device_id, terminal_assignment_id, terminal_profile_key, environment,
     code_digest, payload_sha256,
     created_at, expires_at, issued_by_operator_ref, correlation_id, idempotency_key,
     replaces_provisioning_code_id)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_hub, v_assignment.device_id, v_assignment.id, v_assignment.terminal_profile_key,
     v_environment, v_digest, v_payload,
     v_now, v_expires, v_actor::text, v_correlation, p_idempotency_key,
     v_predecessor);

  -- 10. THE ONE EVENT, atomic with the row. The existing CREATED contract is
  -- unchanged; a replacement additionally records its predecessor id as
  -- non-secret supplemental detail (the AUTHORITATIVE lineage is the
  -- relational column, not this JSON). No raw code, digest, candidate, key
  -- material or token ever appears here.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, correlation_id, detail)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_environment, 'CREATED', 'OPERATOR', v_actor::text, v_correlation,
     case when v_predecessor is null then '{}'::jsonb
          else jsonb_build_object('replaces_provisioning_code_id', v_predecessor) end);

  if v_predecessor is null then
    return jsonb_build_object(
      'outcome', 'ISSUED',
      'provisioning_code_id', v_code_id,
      'code', v_code,
      'expires_at', v_expires,
      'terminal_profile_key', v_assignment.terminal_profile_key,
      'store_hub_device_id', v_hub,
      'correlation_id', v_correlation,
      'detail', 'the raw code is returned in this response only; it is not stored anywhere');
  end if;

  -- The replacement response carries the raw replacement code exactly once,
  -- from this creating call only, plus the relational provenance.
  return jsonb_build_object(
    'outcome', 'ISSUED',
    'provisioning_code_id', v_code_id,
    'code', v_code,
    'expires_at', v_expires,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'store_hub_device_id', v_hub,
    'correlation_id', v_correlation,
    'replaces_provisioning_code_id', v_predecessor,
    'detail', 'the raw replacement code is returned in this response only; it is not stored anywhere');
end
$issue$;

comment on function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text) is
  'Group 0163 (WS-11-T004-P02B1), extended by group 0167 (WS-11-T004-P02B2B2B1), replay-hardened by group 0168 (WS-11-T004-P02B2B2B1). The governed issuance door for terminal provisioning codes (pairing protocol §6.1). Actor, scope, Hub, profile, environment and expiry are DERIVED by the database; the caller supplies an assignment id and an idempotency key. The active-Hub gate reads the CURRENT activation projection at every call — replacement included (no activation, no code — ADMIN-QA-014). An overdue outstanding code is expired ONLY through the canonical expire_terminal_provisioning_code_v1 helper and replaced by exactly one new row under a new idempotency key, relationally linked to its immutable EXPIRED predecessor; an unexpired outstanding code returns the stable OUTSTANDING result. The 8-character Crockford code is returned once, at the creating call only, and never stored. Races serialize on the assignment row; idempotent replay is the reconciliation boundary: it requires the same issuance permission for the row''s own device and environment (cross-scope callers get the safe refusal) and returns ALREADY_ISSUED with safe reconciliation fields only — state, created_at, expires_at, assignment, profile, Hub, correlation, replacement lineage, raw_code_available=false and recovery_required — never a raw code or digest; conflicting replay refuses.';

-- CREATE OR REPLACE preserves owner and grants; re-asserted in the guard.

-- ---------------------------------------------------------------------------
-- 2. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 3. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_door_def text;
begin
  -- The door exists with the 0163 signature (DEFAULT spellings stripped),
  -- definer, NOLOGIN governor owner, pinned search_path.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_code_v1'
       and regexp_replace(pg_get_function_arguments(p.oid), ' DEFAULT [^,]+', '', 'g')
           = 'p_terminal_assignment_id uuid, p_idempotency_key text, p_reason text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0168: the issuance door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The door's grant boundary is the 0163 boundary: authenticated only.
  if has_function_privilege('public', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0168: the issuance door''s grant boundary drifted'
      using errcode = 'P0001';
  end if;

  -- The door's body proves the group-0168 replay hardening: the safe
  -- reconciliation fields exist, the replay branches gate disclosure on the
  -- issuance permission, the active-Hub gate and the canonical-helper
  -- delegation survive, and no competing expiration mutation exists.
  select pg_get_functiondef(p.oid) into v_door_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_code_v1';
  if v_door_def not like '%''raw_code_available'', false%' then
    raise exception 'KLUY-MIGRATION-0168: the hardened replay reconciliation fields are missing'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%''recovery_required'', (v_prior.state = ''issued'')%'
     or v_door_def not like '%''terminal_assignment_id'', v_prior.terminal_assignment_id%'
     or v_door_def not like '%''replaces_provisioning_code_id'', v_prior.replaces_provisioning_code_id%' then
    raise exception 'KLUY-MIGRATION-0168: the hardened replay reconciliation fields are incomplete'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%provisioning_code_issue_permitted_v1(%' then
    raise exception 'KLUY-MIGRATION-0168: the issuance permission gate is no longer reachable in the door'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%device_assignment_projections%' then
    raise exception 'KLUY-MIGRATION-0168: the active-Hub gate is no longer reachable in the issuance door'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%expire_terminal_provisioning_code_v1%' then
    raise exception 'KLUY-MIGRATION-0168: the issuance door does not delegate to the canonical expiration helper'
      using errcode = 'P0001';
  end if;
  if v_door_def ~* 'update\s+kitluy_devices\.device_provisioning_codes' then
    raise exception 'KLUY-MIGRATION-0168: a competing expiration mutation exists inside the issuance door'
      using errcode = 'P0001';
  end if;

  -- The canonical expiration helper is untouched: harness-only boundary.
  if has_function_privilege('public', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0168: the expiration helper''s internal boundary drifted'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on both tables; no direct runtime mutation grant.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0168: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0168: a direct table mutation grant exists'
      using errcode = 'P0001';
  end if;

  -- No raw-code or candidate-digest column exists on either table.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (column_name ~ '(^|_)(code|raw|plain|secret)(_|$)'
            and column_name not in ('code_digest', 'provisioning_code_id', 'reason_code',
                                    'replaces_provisioning_code_id'))) then
    raise exception 'KLUY-MIGRATION-0168: a column that could hold a raw code exists'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin
       -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): exclude the automatic,
       -- un-removable membership PostgreSQL 16 grants the creating role. Any
       -- other login-capable member is still a finding.
       and not (r.rolname = current_user and m.grantor <> m.member)) then
    raise exception 'KLUY-MIGRATION-0168: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0168: ambiguous issuance replay reconciliation applied (scoped-permission replay gate + safe reconciliation fields; no new door, no recovery mutation, no new permission, no grant change; P02B2B2B2 owns explicit lost-code recovery, P02C owns production grants)';
end
$guard$;
