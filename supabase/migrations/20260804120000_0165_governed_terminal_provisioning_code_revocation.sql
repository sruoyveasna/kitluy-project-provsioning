-- kitluy:group:0165
-- Migration group 0165: governed_terminal_provisioning_code_revocation.
--
-- Authority: WS-11-T004-P02B2B1 (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1, §13; migrations
-- 0162-0164 (schema, issuance, presentation); 000_ACTIVE_PHASE §10 step 5
-- (assignment-generation issuance AND revocation).
--
-- ===========================================================================
-- THE ONE DOOR THIS GROUP ADDS
-- ===========================================================================
-- `revoke_terminal_provisioning_code_v1`: the governed, explicit, human
-- revocation of ONE outstanding terminal provisioning code. Every
-- authoritative fact — actor, Tenant, Digital Store, Location, Hub, profile,
-- environment, assignment state, code state, time — is DERIVED by the
-- database from the authenticated session and the stored rows. The caller
-- supplies a code id, an idempotency key and a mandatory reason, and cannot
-- supply an actor, a scope, a Hub, a profile, an environment, a state or a
-- clock.
--
-- The primary governed transition is ISSUED -> REVOKED. Terminal states
-- (REVOKED, LOCKED, EXPIRED, REDEEMED) are never overwritten: each returns a
-- stable classification with no mutation and no event. Exactly one REVOKED
-- event is appended for the initial committed revocation, atomically with the
-- state change; replays and refusals append nothing.
--
-- Sensitive-action policy (recorded decision): the P01 capability audit
-- declared this door "revoke (operator)" — the pairing protocol and the
-- device-credential revocation decisions (KLD-2026-07-29/30, re-authentication
-- and four-eyes) govern CREDENTIAL revocation, not a 15-minute provisioning
-- code. No canonical authority requires re-authentication, confirmation or
-- approval here, so none is invented. The reason IS required.
--
-- Out of scope (later packages): expiration sweeps/workers, replacement
-- issuance, redemption, PoP, certificates, HTTP routes, production grants
-- (P02C), Store Hub behavior.
--
-- Ownership borrow, same as groups 0125-0164: the applying role is not a
-- member of the NOLOGIN definer owner. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 0. BRIDGES: the only kitluy_auth reach this door is allowed
-- ---------------------------------------------------------------------------
-- Same pattern as group 0163: narrowly owned definer bridges, each owned by
-- the approval reader and executable by EXACTLY the governor. The actor
-- bridge (`provisioning_code_actor_v1`) already exists from 0163 and is
-- reused unchanged. Two revocation-permission bridges are added: the coarse
-- gate (does the actor hold the permission AT ALL — checked BEFORE any row is
-- read, so an unauthorized caller learns nothing about code existence) and
-- the scoped gate (the exact permission against the DERIVED device and
-- environment, under the lock).
create or replace function kitluy_devices.provisioning_code_revoke_held_v1()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $held_bridge$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_provisioning_code.revoke', null, null, null), false);
$held_bridge$;

create or replace function kitluy_devices.provisioning_code_revoke_permitted_v1(
  p_terminal_device_id uuid,
  p_environment text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $permit_bridge$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_provisioning_code.revoke', 'device', p_terminal_device_id, p_environment), false);
$permit_bridge$;

-- The approval reader needs CREATE on the schema to own functions in it
-- (groups 0150/0163 established the same grant for their bridges). Revoked
-- again below, immediately after the ownership moves.
grant create on schema kitluy_devices to kitluy_credential_approval_reader;

alter function kitluy_devices.provisioning_code_revoke_held_v1()
  owner to kitluy_credential_approval_reader;
alter function kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text)
  owner to kitluy_credential_approval_reader;

revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.provisioning_code_revoke_held_v1() from public, anon, authenticated;
revoke all on function kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text) from public, anon, authenticated;
grant execute on function kitluy_devices.provisioning_code_revoke_held_v1()
  to kitluy_activation_governor;
grant execute on function kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text)
  to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 1. THE PERMISSION
-- ---------------------------------------------------------------------------
-- Neutral naming per the fleet.* registry convention, sibling of
-- fleet.device_provisioning_code.issue (0163). Registered ACTIVE so
-- role-based grants can name it; deliberately NOT granted to any default
-- role — tests use the sanctioned temporary-grant pattern, and P02C owns any
-- production grant.
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
select 'fleet.device_provisioning_code.revoke', 1, 'CRITICAL',
       array['device', 'device_provisioning_code'], array['all'], 'ACTIVE'
 where not exists (
   select 1 from kitluy_auth.permissions
    where permission_key = 'fleet.device_provisioning_code.revoke');

-- ---------------------------------------------------------------------------
-- 2. IDEMPOTENCY STORAGE
-- ---------------------------------------------------------------------------
-- The 0163 pattern, applied to revocation: the key lives on the row it
-- revoked, globally unique when present. A replay finds the row and is
-- answered with the ORIGINAL revocation identity and timestamp; a conflict
-- (same key, different code, reason or actor) refuses closed. The key is
-- never the raw code and never derived from it.
alter table kitluy_devices.device_provisioning_codes
  add column revocation_idempotency_key text;

comment on column kitluy_devices.device_provisioning_codes.revocation_idempotency_key is
  'Group 0165. The idempotency key the code was revoked under. Globally unique when present; never the raw code and never derived from it. Null on codes revoked by no one (never revoked).';

create unique index device_provisioning_codes_revocation_idempotency_key_uidx
  on kitluy_devices.device_provisioning_codes (revocation_idempotency_key)
  where revocation_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 3. THE DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_terminal_provisioning_code_v1(
  p_provisioning_code_id uuid,
  p_idempotency_key text,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_auth, kitluy_ops, extensions
as $revoke$
declare
  v_actor uuid;
  v_prior kitluy_devices.device_provisioning_codes;
  v_code kitluy_devices.device_provisioning_codes;
  v_assignment kitluy_devices.device_terminal_assignments;
  v_now timestamptz;
  v_correlation uuid;
  v_reason text;
  v_prior_actor text;
  v_prior_correlation uuid;
  v_final_state text;
begin
  -- CONTRACT violations are jsonb refusals, never raised errors: a caller
  -- mistake and an attacker must be told apart by the result, not by a crash.
  if p_provisioning_code_id is null then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-CODE',
      'detail', 'a revocation names exactly one provisioning code');
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-IDEMPOTENCY-KEY',
      'detail', 'a revocation needs an idempotency key');
  end if;

  -- THE REASON CONTRACT: mandatory, non-empty after canonical trimming,
  -- bounded at 500 characters (derived bound, recorded in the P02B2B1
  -- handoff), free of control characters, free of key material, and free of
  -- anything shaped like the raw code itself (a standalone 8-character
  -- Crockford token is the only safely detectable form — the raw code is
  -- never stored, so a digest comparison is impossible by design).
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NO-REASON',
      'detail', 'a revocation requires a reason');
  end if;
  v_reason := btrim(p_reason);
  if length(v_reason) > 500 then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-TOO-LONG',
      'detail', 'the reason exceeds the 500-character bound');
  end if;
  if v_reason ~ '[[:cntrl:]]' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason contains control characters');
  end if;
  if v_reason ~* 'private[[:space:]]+key' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason appears to contain key material');
  end if;
  if v_reason ~ '(^|[^0-9A-Za-z])[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{8}([^0-9A-Za-z]|$)' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-REASON-INVALID',
      'detail', 'the reason contains a token shaped like a provisioning code');
  end if;

  -- 1. THE ACTOR. Resolved by the database from the session; never accepted
  -- from any argument, body field or claim the caller could edit.
  v_actor := kitluy_devices.provisioning_code_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-UNAUTHENTICATED',
      'detail', 'no authenticated actor context');
  end if;

  -- 2. THE COARSE GATE, BEFORE ANY ROW IS READ: an actor who holds the
  -- revocation permission nowhere is refused here, so an unauthorized caller
  -- cannot distinguish "no such code" from "code outside my scope".
  if not kitluy_devices.provisioning_code_revoke_held_v1() then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'the actor does not hold fleet.device_provisioning_code.revoke');
  end if;

  -- 3. IDEMPOTENCY FIRST. A replay names the same key; the revoked row is the
  -- record. The immutable replay identity is (code, trimmed reason, actor):
  -- any difference is a conflict, never an overwrite.
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where revocation_idempotency_key = p_idempotency_key
   for update;
  if found then
    select e.actor_ref, e.correlation_id into v_prior_actor, v_prior_correlation
      from kitluy_devices.device_provisioning_code_events e
     where e.provisioning_code_id = v_prior.id and e.event_type = 'REVOKED'
     limit 1;
    if v_prior.id = p_provisioning_code_id
       and v_prior.revocation_reason = v_reason
       and v_prior_actor = v_actor::text then
      return jsonb_build_object(
        'outcome', 'ALREADY_REVOKED',
        'provisioning_code_id', v_prior.id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', 'revoked',
        'revoked_at', v_prior.revoked_at,
        'correlation_id', v_prior_correlation,
        'replay', true,
        'detail', 'this idempotency key already revoked this code; the original revocation identity and timestamp are returned and nothing was mutated');
    end if;
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different revocation');
  end if;

  -- 4. THE CODE, READ ONCE to derive the assignment (the lock order shared
  -- with the 0164 evaluator is ASSIGNMENT first, CODE second — revocation
  -- honors the same order, so revoke-versus-presentation serializes instead
  -- of deadlocking). Everything is re-read under the locks below.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = p_provisioning_code_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-NOT-FOUND',
      'detail', 'no provisioning code with that id');
  end if;

  -- 5. THE SCOPED PERMISSION, against the DERIVED device and environment —
  -- never a caller-supplied scope.
  if not kitluy_devices.provisioning_code_revoke_permitted_v1(
       v_code.terminal_device_id, v_code.environment) then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'the actor does not hold fleet.device_provisioning_code.revoke for this device and environment');
  end if;

  -- 6. THE ASSIGNMENT, LOCKED FIRST (shared ordering with the evaluator).
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = v_code.terminal_assignment_id
   for update;
  if not found then
    -- The foreign key makes this unreachable; fail closed anyway.
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-SCOPE-INCONSISTENT',
      'detail', 'the code names an assignment that does not exist');
  end if;

  -- 7. THE CODE ROW, LOCKED, re-read under the lock.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where id = p_provisioning_code_id
   for update;

  -- Scope consistency, re-verified under the lock: the code must still name
  -- exactly the device, location and profile its assignment binds.
  if v_assignment.device_id is distinct from v_code.terminal_device_id
     or v_assignment.store_location_id is distinct from v_code.store_location_id
     or v_assignment.terminal_profile_key is distinct from v_code.terminal_profile_key then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-SCOPE-INCONSISTENT',
      'detail', 'the code names a device, location or profile its assignment does not');
  end if;

  -- The idempotency check AGAIN, under the locks: a same-key race waits here
  -- for the winner's commit, and the replay must be answered ALREADY_REVOKED
  -- (the first check ran before the winner committed and saw nothing).
  select * into v_prior
    from kitluy_devices.device_provisioning_codes
   where revocation_idempotency_key = p_idempotency_key
   for update;
  if found then
    select e.actor_ref, e.correlation_id into v_prior_actor, v_prior_correlation
      from kitluy_devices.device_provisioning_code_events e
     where e.provisioning_code_id = v_prior.id and e.event_type = 'REVOKED'
     limit 1;
    if v_prior.id = p_provisioning_code_id
       and v_prior.revocation_reason = v_reason
       and v_prior_actor = v_actor::text then
      return jsonb_build_object(
        'outcome', 'ALREADY_REVOKED',
        'provisioning_code_id', v_prior.id,
        'terminal_assignment_id', v_prior.terminal_assignment_id,
        'state', 'revoked',
        'revoked_at', v_prior.revoked_at,
        'correlation_id', v_prior_correlation,
        'replay', true,
        'detail', 'this idempotency key already revoked this code; the original revocation identity and timestamp are returned and nothing was mutated');
    end if;
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-CONFLICTING-REPLAY',
      'detail', 'this idempotency key was used for a different revocation');
  end if;

  -- 8. THE ASSIGNMENT MUST BE LIVE. A code whose assignment has closed is not
  -- revocable through this door; its terminal classification is stable.
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  -- 9. TERMINAL STATES ARE NEVER OVERWRITTEN. Each answers its stable
  -- classification with no mutation, no event, no timestamp change, no reason
  -- overwrite — the revoked row is immutable historical evidence, and a
  -- locked, expired or redeemed row is equally terminal.
  if v_code.state = 'revoked' then
    select e.correlation_id into v_prior_correlation
      from kitluy_devices.device_provisioning_code_events e
     where e.provisioning_code_id = v_code.id and e.event_type = 'REVOKED'
     limit 1;
    return jsonb_build_object(
      'outcome', 'ALREADY_REVOKED',
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', 'revoked',
      'revoked_at', v_code.revoked_at,
      'correlation_id', v_prior_correlation,
      'detail', 'the code is already revoked; the original revocation stands unchanged');
  end if;
  if v_code.state in ('locked', 'expired', 'redeemed') then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(v_code.state::text),
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', v_code.state,
      'detail', format('the code is already %s; terminal states are never overwritten by revocation', v_code.state));
  end if;

  -- 10. THE TRANSITION, on the authoritative clock only. There is no
  -- timestamp parameter anywhere on this door. The state guard makes a losing
  -- racer answer the winner's terminal classification instead of raising an
  -- uncontrolled error.
  v_now := kitluy_ops.authoritative_now_v1();
  v_correlation := gen_random_uuid();

  update kitluy_devices.device_provisioning_codes
     set state = 'revoked',
         revoked_at = v_now,
         revocation_reason = v_reason,
         revocation_idempotency_key = p_idempotency_key
   where id = v_code.id and state = 'issued';
  if not found then
    select c.state::text into v_final_state
      from kitluy_devices.device_provisioning_codes c where c.id = v_code.id;
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-ALREADY-' || upper(v_final_state),
      'provisioning_code_id', v_code.id,
      'terminal_assignment_id', v_code.terminal_assignment_id,
      'state', v_final_state,
      'detail', 'a competing transition committed first; the terminal state stands');
  end if;

  -- 11. EXACTLY ONE EVENT, atomic with the transition. It carries the derived
  -- scope, the actor, the authoritative time, the correlation id and a safe
  -- reason reference — never a raw code, a candidate code, a digest or any
  -- secret.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, reason_code, correlation_id, detail)
  values
    (v_code.id, v_code.tenant_id, v_code.digital_store_id, v_code.store_location_id,
     v_code.environment, 'REVOKED', 'OPERATOR', v_actor::text, 'OPERATOR_REVOCATION',
     v_correlation, jsonb_build_object('revocation_reason', v_reason));

  return jsonb_build_object(
    'outcome', 'REVOKED',
    'provisioning_code_id', v_code.id,
    'terminal_assignment_id', v_code.terminal_assignment_id,
    'state', 'revoked',
    'revoked_at', v_now,
    'correlation_id', v_correlation,
    'detail', 'the code is terminally revoked; the row remains as immutable historical evidence');
end
$revoke$;

comment on function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text) is
  'Group 0165 (WS-11-T004-P02B2B1). The governed explicit-revocation door for terminal provisioning codes (pairing protocol §6.1/§13). Actor and all scope are DERIVED from the authenticated session and the stored rows; the caller supplies only a code id, an idempotency key and a mandatory bounded reason. Locks assignment then code (the evaluator''s order), transitions only an ISSUED code to REVOKED on the authoritative clock, and appends exactly one REVOKED event. Terminal states are never overwritten; identical replay returns the original revocation identity and timestamp; conflicting replay fails closed.';

alter function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)
  owner to kitluy_activation_governor;

-- The ONLY public surface: a correctly scoped human, as `authenticated` — the
-- same boundary the 0163 issuance door established. P02C owns any production
-- service grant; there is deliberately none yet.
revoke all on function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text) from public;
revoke all on function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text) from anon;
revoke all on function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text) from service_role;
grant execute on function kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. HAND THE MEMBERSHIPS BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 5. PROVE THE DOOR'S BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
begin
  -- The permission is registered ACTIVE.
  if not exists (
    select 1 from kitluy_auth.permissions
     where permission_key = 'fleet.device_provisioning_code.revoke' and status = 'ACTIVE') then
    raise exception 'KLUY-MIGRATION-0165: the revocation permission is not registered ACTIVE'
      using errcode = 'P0001';
  end if;

  -- The door exists with the intended signature, definer, NOLOGIN owner,
  -- pinned search_path.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'revoke_terminal_provisioning_code_v1'
       and pg_get_function_arguments(p.oid) = 'p_provisioning_code_id uuid, p_idempotency_key text, p_reason text'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0165: the door is missing, mis-signed, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;

  -- The grant boundary: authenticated executes the door; public/anon/
  -- service_role do not; the bridges are governor-only.
  if has_function_privilege('public', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.revoke_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_activation_governor', 'kitluy_devices.provisioning_code_revoke_held_v1()', 'execute')
     or not has_function_privilege('kitluy_activation_governor', 'kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.provisioning_code_revoke_held_v1()', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text)', 'execute')
     or has_function_privilege('public', 'kitluy_devices.provisioning_code_revoke_held_v1()', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.provisioning_code_revoke_permitted_v1(uuid, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0165: the door''s grant boundary is wrong'
      using errcode = 'P0001';
  end if;

  -- No direct table mutation grant appeared for any application identity.
  if has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role', 'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0165: a direct table mutation grant exists'
      using errcode = 'P0001';
  end if;

  -- FORCE RLS still holds on both tables.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0165: FORCE RLS no longer holds on the provisioning-code tables'
      using errcode = 'P0001';
  end if;

  -- The revocation consistency contract is intact: state=revoked requires
  -- revoked_at and revocation_reason (0162's CHECK, re-asserted here), and
  -- the idempotency index exists.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and conname = 'device_provisioning_codes_revoked_chk')
     or not exists (
    select 1 from pg_index
     where indrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and indexrelid = 'kitluy_devices.device_provisioning_codes_revocation_idempotency_key_uidx'::regclass) then
    raise exception 'KLUY-MIGRATION-0165: the revocation consistency CHECK or the idempotency index is missing'
      using errcode = 'P0001';
  end if;

  -- No raw-code or digest field was added to the events table.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_code_events'
       and (column_name ~ '(^|_)(code|digest|raw|plain|secret|key)(_|$)'
            and column_name not in ('provisioning_code_id', 'reason_code'))) then
    raise exception 'KLUY-MIGRATION-0165: a raw-code or digest field exists on the events table'
      using errcode = 'P0001';
  end if;

  -- Events remain append-only (the trigger function still guards them).
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'kitluy_devices.device_provisioning_code_events'::regclass
       and tgname = 'trg_device_provisioning_code_events_append_only') then
    raise exception 'KLUY-MIGRATION-0165: the append-only event trigger is missing'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the NOLOGIN owner.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0165: a login-capable role is a member of the governor'
      using errcode = 'P0001';
  end if;

  -- The 0163 issuance door and the 0164 evaluator boundaries are unchanged.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0165: the issuance or presentation boundary drifted'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0165: governed terminal provisioning-code revocation applied (authenticated-only door; ISSUED->REVOKED only; P02C owns production grants)';
end
$guard$;
