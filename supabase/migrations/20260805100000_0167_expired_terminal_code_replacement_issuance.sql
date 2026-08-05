-- kitluy:group:0167
-- Migration group 0167: expired_terminal_code_replacement_issuance.
--
-- Authority: WS-11-T004-P02B2B2B1 (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migrations
-- 0162-0166 (schema, issuance, presentation, revocation, canonical
-- expiration).
--
-- ===========================================================================
-- WHAT THIS GROUP IS — AND IS NOT
-- ===========================================================================
-- This group extends the ONE governed issuance door
-- `issue_terminal_provisioning_code_v1` so that an OVERDUE outstanding code
-- is expired through the canonical 0166 helper and replaced by exactly one
-- new provisioning-code row under a new idempotency key. The predecessor
-- remains immutable historical evidence; the replacement is a separate row
-- with a fresh code, digest, payload binding, correlation and 15-minute
-- expiry, relationally linked to its immediate predecessor.
--
-- It is NOT an expiration worker, sweep or job; NOT a competing replacement
-- RPC; NOT a change to presentation, lockout, revocation or redemption; NOT
-- an HTTP route; NOT a production grant composition (P02C owns that).
--
-- The decision tree inside the door, under one transaction and one
-- assignment lock:
--   no outstanding code        -> the 0163 initial-issuance path, unchanged
--   outstanding, NOT due       -> the 0163 stable OUTSTANDING result, exactly
--   outstanding, due           -> canonical expiration, then one replacement
--   helper answers anything    -> fail closed with the row's terminal
--   else (unreachable under      classification; no replacement, no overwrite
--   the held row lock)
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02B2B2B1 -- no DROP/TRUNCATE/DELETE
-- in this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

-- Ownership borrow, same as groups 0125-0166: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. RELATIONAL REPLACEMENT LINEAGE
-- ---------------------------------------------------------------------------
-- Migration 0162 has no replacement link, so this group adds the minimum
-- nullable self-reference: a replacement row names its IMMEDIATE predecessor;
-- the predecessor never points forward. Authoritative lineage lives HERE, in
-- a relational column under the same integrity trigger as every other
-- binding — never only in JSON metadata.
alter table kitluy_devices.device_provisioning_codes
  add column replaces_provisioning_code_id uuid
    references kitluy_devices.device_provisioning_codes (id);

comment on column kitluy_devices.device_provisioning_codes.replaces_provisioning_code_id is
  'Group 0167 (WS-11-T004-P02B2B2B1). The immediate predecessor this row replaces, set only by the governed issuance door after the predecessor expired through the canonical helper. NULL for initial issuance. Immutable after insertion; never a self-reference; one direct successor per predecessor.';

-- A row can never name itself as its predecessor.
alter table kitluy_devices.device_provisioning_codes
  add constraint device_provisioning_codes_no_self_replacement_chk
    check (replaces_provisioning_code_id is null
           or replaces_provisioning_code_id <> id);

-- ONE direct successor per predecessor: two replacements of the same code
-- are a constraint violation, not a race outcome. (The assignment lock and
-- the one-outstanding index make this unreachable in the governed flow; the
-- index is the database-level backstop.)
create unique index device_provisioning_codes_one_successor_uidx
  on kitluy_devices.device_provisioning_codes (replaces_provisioning_code_id)
  where replaces_provisioning_code_id is not null;

-- ---------------------------------------------------------------------------
-- 2. THE INTEGRITY TRIGGER LEARNS THE LINEAGE RULES
-- ---------------------------------------------------------------------------
-- The body is the 0162 trigger with exactly two additions:
--   INSERT: when lineage is present, the predecessor must be an EXPIRED row
--           of the SAME Tenant, Store, Location, Hub, terminal, assignment,
--           profile and environment — anything else is a fabricated lineage;
--   UPDATE: the lineage column joins the immutable set (scope, digest,
--           payload and expiry were already there), so lineage is fixed at
--           insertion for every identity, including the definer owner.
-- Owner and trigger binding are preserved by CREATE OR REPLACE (asserted in
-- the guard below).
create or replace function kitluy_devices.enforce_provisioning_code_integrity()
returns trigger
language plpgsql
as $$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_hub_assignment kitluy_devices.device_assignments;
  v_predecessor kitluy_devices.device_provisioning_codes;
begin
  if tg_op = 'INSERT' then
    -- The terminal assignment must name the SAME device, location and
    -- profile the code row carries, and the Hub reference must be the device
    -- the assignment binds. Anything else is a fabricated scope.
    select * into v_assignment
      from kitluy_devices.device_terminal_assignments
     where id = new.terminal_assignment_id;
    if not found then
      raise exception 'KLUY-PROVCODE-ASSIGNMENT-MISSING: terminal assignment % does not exist',
        new.terminal_assignment_id using errcode = 'P0001';
    end if;
    if v_assignment.device_id is distinct from new.terminal_device_id
       or v_assignment.store_location_id is distinct from new.store_location_id
       or v_assignment.terminal_profile_key is distinct from new.terminal_profile_key then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the code names a device, location or profile its assignment does not'
        using errcode = 'P0001';
    end if;
    -- The Hub reference must be a device assigned to the SAME Tenant, Store
    -- and Location.
    select * into v_hub_assignment
      from kitluy_devices.device_assignments
     where device_id = new.store_hub_device_id
       and tenant_id = new.tenant_id
       and digital_store_id = new.digital_store_id
       and store_location_id = new.store_location_id
       and state in ('pending_trust', 'active')
     limit 1;
    if not found then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the named Hub has no assignment to the code''s Tenant/Store/Location'
        using errcode = 'P0001';
    end if;
    -- Group 0167: replacement lineage, when present, names the IMMEDIATE
    -- predecessor — an EXPIRED row of exactly the same scope, Hub, terminal,
    -- assignment, profile and environment. A live predecessor cannot be
    -- replaced; a cross-scope predecessor is a fabrication.
    if new.replaces_provisioning_code_id is not null then
      select * into v_predecessor
        from kitluy_devices.device_provisioning_codes
       where id = new.replaces_provisioning_code_id;
      if not found then
        raise exception
          'KLUY-PROVCODE-LINEAGE-MISSING: the named predecessor % does not exist',
          new.replaces_provisioning_code_id using errcode = 'P0001';
      end if;
      if v_predecessor.state <> 'expired' then
        raise exception
          'KLUY-PROVCODE-LINEAGE-NOT-EXPIRED: only an expired code may be replaced; predecessor % is %',
          v_predecessor.id, v_predecessor.state using errcode = 'P0001';
      end if;
      if v_predecessor.tenant_id is distinct from new.tenant_id
         or v_predecessor.digital_store_id is distinct from new.digital_store_id
         or v_predecessor.store_location_id is distinct from new.store_location_id
         or v_predecessor.store_hub_device_id is distinct from new.store_hub_device_id
         or v_predecessor.terminal_device_id is distinct from new.terminal_device_id
         or v_predecessor.terminal_assignment_id is distinct from new.terminal_assignment_id
         or v_predecessor.terminal_profile_key is distinct from new.terminal_profile_key
         or v_predecessor.environment is distinct from new.environment then
        raise exception
          'KLUY-PROVCODE-LINEAGE-INCONSISTENT: a replacement must share the exact scope, Hub, terminal, assignment, profile and environment of its predecessor'
          using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'KLUY-PROVCODE-IMMUTABLE: a provisioning code is never deleted; its outcome is recorded'
      using errcode = 'P0001';
  end if;

  -- Scope, digest, payload, expiry and replacement lineage are fixed at
  -- issue (claim pattern; lineage joined the immutable set in group 0167).
  if new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_device_id is distinct from old.terminal_device_id
     or new.terminal_assignment_id is distinct from old.terminal_assignment_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.environment is distinct from old.environment
     or new.code_digest is distinct from old.code_digest
     or new.digest_algorithm is distinct from old.digest_algorithm
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.expires_at is distinct from old.expires_at
     or new.replaces_provisioning_code_id is distinct from old.replaces_provisioning_code_id then
    raise exception
      'KLUY-PROVCODE-IMMUTABLE: scope, digest, payload, expiry and lineage are fixed at issue; only the state may close'
      using errcode = 'P0001';
  end if;

  -- One-way machine: ISSUED is the only live state; nothing closed reopens.
  if old.state <> 'issued' and new.state is distinct from old.state then
    raise exception 'KLUY-PROVCODE-CLOSED: provisioning code % is already %',
      old.id, old.state using errcode = 'P0001';
  end if;

  -- Attempt evidence is monotonic: it may increase, never decrease.
  if new.failed_attempt_count < old.failed_attempt_count then
    raise exception
      'KLUY-PROVCODE-ATTEMPTS-NOT-MONOTONIC: failed_attempt_count may not decrease (% -> %)',
      old.failed_attempt_count, new.failed_attempt_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. THE ISSUANCE DOOR LEARNS REPLACEMENT (CREATE OR REPLACE, SAME BOUNDARY)
-- ---------------------------------------------------------------------------
-- Signature, owner, permission, authenticated-only execution boundary, fixed
-- search_path, actor resolution, scope derivation, active-Hub gate, T1-T4
-- profile derivation, Crockford generation, digest binding, raw-code return
-- rules, initial issuance behavior and grant posture are IDENTICAL to group
-- 0163. The single behavioral addition is step 6: an outstanding ISSUED code
-- is now located and locked; when the canonical helper says it is DUE the
-- door lets the helper expire it (one EXPIRED event, produced only by the
-- helper) and then issues exactly one replacement row linked to the
-- predecessor. NOT_DUE returns the unchanged stable OUTSTANDING result.
-- There is no caller-selected predecessor, Hub, profile, scope or clock
-- anywhere on this door.
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
      return jsonb_build_object(
        'outcome', 'ALREADY_ISSUED',
        'provisioning_code_id', v_prior.id,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
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
      return jsonb_build_object(
        'outcome', 'ALREADY_ISSUED',
        'provisioning_code_id', v_prior.id,
        'expires_at', v_prior.expires_at,
        'terminal_profile_key', v_prior.terminal_profile_key,
        'store_hub_device_id', v_prior.store_hub_device_id,
        'correlation_id', v_prior.correlation_id,
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
  'Group 0163 (WS-11-T004-P02B1), extended by group 0167 (WS-11-T004-P02B2B2B1). The governed issuance door for terminal provisioning codes (pairing protocol §6.1). Actor, scope, Hub, profile, environment and expiry are DERIVED by the database; the caller supplies an assignment id and an idempotency key. The active-Hub gate reads the CURRENT activation projection at every call — replacement included (no activation, no code — ADMIN-QA-014). An overdue outstanding code is expired ONLY through the canonical expire_terminal_provisioning_code_v1 helper and replaced by exactly one new row under a new idempotency key, relationally linked to its immutable EXPIRED predecessor; an unexpired outstanding code returns the stable OUTSTANDING result. The 8-character Crockford code is returned once, at the creating call only, and never stored. Races serialize on the assignment row; idempotent replay returns ALREADY_ISSUED without a code; conflicting replay refuses.';

-- CREATE OR REPLACE preserves owner and grants; re-asserted in the guard.

-- ---------------------------------------------------------------------------
-- 4. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 5. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_door_def text;
  v_trigger_def text;
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
    raise exception 'KLUY-MIGRATION-0167: the issuance door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The door's grant boundary is the 0163 boundary: authenticated only.
  if has_function_privilege('public', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0167: the issuance door''s grant boundary drifted'
      using errcode = 'P0001';
  end if;

  -- The door's body proves the two structural requirements: the active-Hub
  -- gate (the activation projection) is still on the issuance path, and
  -- overdue expiration is DELEGATED to the canonical helper — while no
  -- competing expiration mutation exists in the door itself.
  select pg_get_functiondef(p.oid) into v_door_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_code_v1';
  if v_door_def not like '%device_assignment_projections%' then
    raise exception 'KLUY-MIGRATION-0167: the active-Hub gate is no longer reachable in the issuance door'
      using errcode = 'P0001';
  end if;
  if v_door_def not like '%expire_terminal_provisioning_code_v1%' then
    raise exception 'KLUY-MIGRATION-0167: the issuance door does not delegate to the canonical expiration helper'
      using errcode = 'P0001';
  end if;
  if v_door_def ~* 'update\s+kitluy_devices\.device_provisioning_codes' then
    raise exception 'KLUY-MIGRATION-0167: a competing expiration mutation exists inside the issuance door'
      using errcode = 'P0001';
  end if;

  -- The canonical helper is untouched: signature, definer owner and the
  -- harness-only grant boundary are exactly the 0166 ones.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'expire_terminal_provisioning_code_v1'
       and regexp_replace(pg_get_function_arguments(p.oid), ' DEFAULT [^,]+', '', 'g')
           = 'p_provisioning_code_id uuid, p_correlation_id uuid, p_trigger_source text, p_actor_type text, p_actor_ref text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor') then
    raise exception 'KLUY-MIGRATION-0167: the canonical expiration helper drifted'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('public', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.expire_terminal_provisioning_code_v1(uuid, uuid, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0167: the expiration helper''s internal boundary drifted'
      using errcode = 'P0001';
  end if;

  -- The presentation and revocation boundaries are untouched.
  if has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0167: the presentation or revocation boundary drifted'
      using errcode = 'P0001';
  end if;

  -- The lineage column exists, nullable, uuid, with its self-FK, the
  -- no-self-reference check and the one-direct-successor unique index.
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_codes'
       and column_name = 'replaces_provisioning_code_id'
       and data_type = 'uuid' and is_nullable = 'YES') then
    raise exception 'KLUY-MIGRATION-0167: the replacement lineage column is missing or mis-typed'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and contype = 'f'
       and confrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and array_position(conkey, (
         select attnum from pg_attribute
          where attrelid = 'kitluy_devices.device_provisioning_codes'::regclass
            and attname = 'replaces_provisioning_code_id')) is not null) then
    raise exception 'KLUY-MIGRATION-0167: the lineage self-FK is missing'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and conname = 'device_provisioning_codes_no_self_replacement_chk') then
    raise exception 'KLUY-MIGRATION-0167: the no-self-reference check is missing'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_index
     where indrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and indexrelid = 'kitluy_devices.device_provisioning_codes_one_successor_uidx'::regclass
       and indisunique) then
    raise exception 'KLUY-MIGRATION-0167: the one-direct-successor unique index is missing'
      using errcode = 'P0001';
  end if;

  -- Lineage immutability is enforced by the integrity trigger itself: its
  -- body must name the column in the immutable-set comparison, and the
  -- trigger must still be owned by the NOLOGIN governor.
  select pg_get_functiondef(p.oid) into v_trigger_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'enforce_provisioning_code_integrity';
  if v_trigger_def not like '%replaces_provisioning_code_id is distinct from old.replaces_provisioning_code_id%'
     or v_trigger_def not like '%KLUY-PROVCODE-LINEAGE-INCONSISTENT%' then
    raise exception 'KLUY-MIGRATION-0167: the integrity trigger does not enforce lineage rules'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'enforce_provisioning_code_integrity'
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor') then
    raise exception 'KLUY-MIGRATION-0167: the integrity trigger''s ownership drifted'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on both tables; no direct runtime mutation grant.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0167: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0167: a direct table mutation grant exists'
      using errcode = 'P0001';
  end if;

  -- No raw-code or candidate-digest column exists on either table (the
  -- identifier and reason-reference exclusions, as in 0165/0166 — the
  -- lineage identifier joins them).
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices'
       and table_name in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (column_name ~ '(^|_)(code|raw|plain|secret)(_|$)'
            and column_name not in ('code_digest', 'provisioning_code_id', 'reason_code',
                                    'replaces_provisioning_code_id'))) then
    raise exception 'KLUY-MIGRATION-0167: a column that could hold a raw code exists'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0167: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0167: expired-code replacement issuance applied (one door, canonical-helper delegation, relational lineage; no worker, no sweep, no new grant; P02B2B2B2 owns broader race hardening, P02C owns production grants)';
end
$guard$;
