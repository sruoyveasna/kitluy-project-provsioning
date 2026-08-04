-- kitluy:group:0163
-- Migration group 0163: governed_terminal_provisioning_code_issuance.
--
-- Authority: WS-11-T004-P02B1 (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1; migration 0162
-- (schema foundation); 000_ACTIVE_PHASE §10 step 6.
--
-- ===========================================================================
-- THE ONE DOOR THIS GROUP ADDS
-- ===========================================================================
-- `issue_terminal_provisioning_code_v1`: the governed issuance of ONE
-- short-lived, assignment-bound terminal provisioning code, for an eligible
-- terminal assignment whose assigned Store Hub is ACTIVE. Everything the code
-- binds — actor, scope, Hub, profile, environment, expiry — is DERIVED by the
-- database; the caller supplies an assignment id, an idempotency key and an
-- optional reason, and cannot select a profile, a Hub, a scope, an actor or a
-- clock.
--
-- Out of scope (later packages): presentation, attempt counting, lockout,
-- revocation, redemption, PoP, certificates, HTTP routes, production grants.
-- P02C owns the final production grant boundary; this group grants EXECUTE to
-- `authenticated` only, exactly the identity a human installer reaches the
-- door as.
--
-- The raw code is returned ONCE, from the initial committed issuance only.
-- It is never stored, never logged, never in an event, never replayable.
--
-- Ownership borrow, same as groups 0125-0162: the applying role is not a
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
-- `kitluy_auth.current_actor_context` and `kitluy_auth.has_permission` are
-- executable by postgres, authenticated, service_role and the approval
-- reader — NOT by the activation governor this door is defined as. The 0150
-- pattern solves the same problem with narrowly owned definer bridges: each
-- bridge is owned by the approval reader and executable by EXACTLY the
-- governor, so the door's reach into kitluy_auth is one named function wide.
create or replace function kitluy_devices.provisioning_code_actor_v1()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $actor_bridge$
  select nullif(kitluy_auth.current_actor_context() ->> 'user_id', '')::uuid;
$actor_bridge$;

create or replace function kitluy_devices.provisioning_code_issue_permitted_v1(
  p_terminal_device_id uuid,
  p_environment text
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $permit_bridge$
  select coalesce(kitluy_auth.has_permission(
    'fleet.device_provisioning_code.issue', 'device', p_terminal_device_id, p_environment), false);
$permit_bridge$;

-- The approval reader needs CREATE on the schema to own functions in it
-- (group 0150 established the same grant for its bridges). It is revoked
-- again below, immediately after the ownership moves: the reader keeps no
-- CREATE on kitluy_devices (the sections-41/42 invariant asserts exactly that).
grant create on schema kitluy_devices to kitluy_credential_approval_reader;

-- The door's definer needs pgcrypto (extensions schema) for code generation.
-- Group 0127 granted the same narrow usage to kitluy_credential_issuer.
grant usage on schema extensions to kitluy_activation_governor;
-- ...and USAGE on kitluy_ops for the authoritative clock (EXECUTE on
-- authoritative_now_v1 was granted by group 0157; the schema needs its own).
grant usage on schema kitluy_ops to kitluy_activation_governor;

alter function kitluy_devices.provisioning_code_actor_v1()
  owner to kitluy_credential_approval_reader;
alter function kitluy_devices.provisioning_code_issue_permitted_v1(uuid, text)
  owner to kitluy_credential_approval_reader;

revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.provisioning_code_actor_v1() from public, anon, authenticated;
revoke all on function kitluy_devices.provisioning_code_issue_permitted_v1(uuid, text) from public, anon, authenticated;
grant execute on function kitluy_devices.provisioning_code_actor_v1()
  to kitluy_activation_governor;
grant execute on function kitluy_devices.provisioning_code_issue_permitted_v1(uuid, text)
  to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 1. THE PERMISSION
-- ---------------------------------------------------------------------------
-- Neutral naming per the fleet.* registry convention (emergency_revoke,
-- emergency_post_approve). Registered ACTIVE so role-based grants can name
-- it; the temporary-grant harness needs no row.
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
select 'fleet.device_provisioning_code.issue', 1, 'CRITICAL',
       array['device', 'device_provisioning_code'], array['all'], 'ACTIVE'
 where not exists (
   select 1 from kitluy_auth.permissions
    where permission_key = 'fleet.device_provisioning_code.issue');

-- ---------------------------------------------------------------------------
-- 2. IDEMPOTENCY STORAGE
-- ---------------------------------------------------------------------------
-- The key lives on the row it issued, globally unique when present: one
-- committed issuance per key, for ever. A replay finds the row; a conflict
-- refuses; nothing needs a second table.
alter table kitluy_devices.device_provisioning_codes
  add column idempotency_key text;

comment on column kitluy_devices.device_provisioning_codes.idempotency_key is
  'Group 0163. The idempotency key the code was issued under. Globally unique when present; never the raw code and never derived from it.';

create unique index device_provisioning_codes_idempotency_key_uidx
  on kitluy_devices.device_provisioning_codes (idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- 3. THE DOOR
-- ---------------------------------------------------------------------------
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

  -- 4. THE ACTIVE HUB — the ordering gate (ADMIN-QA-014). The projection is
  -- written ONLY by a successful activation, so its presence IS the active
  -- condition; the BLK-005 posture is inherited: no activation, no projection,
  -- no code. When more than one Hub is active at the scope the code binds the
  -- EARLIEST-ACTIVATED one — deterministic and recorded, because this data
  -- model links a terminal to its Hub by Location, not by an explicit
  -- terminal-to-hub assignment (a dedicated binding is later work, recorded in
  -- the P02B1 handoff). Zero active hubs is the only fail.
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
  -- derived environment.
  if not kitluy_devices.provisioning_code_issue_permitted_v1(v_assignment.device_id, v_environment) then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-PROVCODE-PERMISSION-DENIED',
      'detail', 'the actor does not hold fleet.device_provisioning_code.issue for this device and environment');
  end if;

  -- 6. ONE OUTSTANDING PER ASSIGNMENT. This is a governed result, not a
  -- constraint error: the second caller was told, not crashed.
  if exists (
    select 1 from kitluy_devices.device_provisioning_codes
     where terminal_assignment_id = p_terminal_assignment_id
       and state = 'issued') then
    return jsonb_build_object(
      'outcome', 'OUTSTANDING',
      'refusal_code', 'KLUY-PROVCODE-OUTSTANDING',
      'detail', 'an unexpired code is already outstanding for this assignment');
  end if;

  -- 7. THE CODE. Eight Crockford Base32 characters (no I, L, O, U), one
  -- secure-random byte per character. 256 = 8 * 32 exactly, so byte % 32 is
  -- perfectly uniform — no modulo bias, no timestamp, no sequence, no scope
  -- embedded in plaintext. The raw value exists only in this frame.
  v_bytes := extensions.gen_random_bytes(8);
  v_code := '';
  for v_i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (pg_catalog.get_byte(v_bytes, v_i) % 32) + 1, 1);
  end loop;

  -- 8. TIME, from the repository's authoritative helper only. There is no
  -- timestamp parameter anywhere on this door.
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
     created_at, expires_at, issued_by_operator_ref, correlation_id, idempotency_key)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_hub, v_assignment.device_id, v_assignment.id, v_assignment.terminal_profile_key,
     v_environment, v_digest, v_payload,
     v_now, v_expires, v_actor::text, v_correlation, p_idempotency_key);

  -- 10. THE ONE EVENT, atomic with the row. It carries no raw code and no
  -- reconstructable material.
  insert into kitluy_devices.device_provisioning_code_events
    (provisioning_code_id, tenant_id, digital_store_id, store_location_id, environment,
     event_type, actor_type, actor_ref, correlation_id)
  values
    (v_code_id, v_scope.tenant_id, v_scope.digital_store_id, v_scope.store_location_id,
     v_environment, 'CREATED', 'OPERATOR', v_actor::text, v_correlation);

  return jsonb_build_object(
    'outcome', 'ISSUED',
    'provisioning_code_id', v_code_id,
    'code', v_code,
    'expires_at', v_expires,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'store_hub_device_id', v_hub,
    'correlation_id', v_correlation,
    'detail', 'the raw code is returned in this response only; it is not stored anywhere');
end
$issue$;

comment on function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text) is
  'Group 0163 (WS-11-T004-P02B1). The governed issuance door for terminal provisioning codes (pairing protocol §6.1). Actor, scope, Hub, profile, environment and expiry are DERIVED by the database; the caller supplies an assignment id and an idempotency key. The active-Hub gate reads the activation projection (no activation, no code — ADMIN-QA-014). The 8-character Crockford code is returned once, at initial issuance only, and never stored. Races serialize on the assignment row; idempotent replay returns ALREADY_ISSUED without a code; conflicting replay refuses.';

alter function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)
  owner to kitluy_activation_governor;

-- The ONLY public surface: a human installer, as `authenticated`. P02C owns
-- any production service-role grant; there is deliberately none yet.
revoke all on function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text) from public;
revoke all on function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text) from anon;
grant execute on function kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. RLS POLICIES — the definer sees its own tables, nobody else does
-- ---------------------------------------------------------------------------
-- FORCE RLS with zero policies would block the NOLOGIN governor itself. The
-- 0126 pattern gives the DEFINER authority (and only it) row visibility; every
-- runtime identity still sees nothing, which is what sections N8/N9/N10 prove.
create policy device_provisioning_codes_activation_read
  on kitluy_devices.device_provisioning_codes
  for select to kitluy_activation_governor using (true);
create policy device_provisioning_codes_activation_governor
  on kitluy_devices.device_provisioning_codes
  for all to kitluy_activation_governor using (true) with check (true);
create policy device_provisioning_code_events_activation_read
  on kitluy_devices.device_provisioning_code_events
  for select to kitluy_activation_governor using (true);
create policy device_provisioning_code_events_activation_governor
  on kitluy_devices.device_provisioning_code_events
  for all to kitluy_activation_governor using (true) with check (true);

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
-- 5. PROVE THE DOOR'S BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from kitluy_auth.permissions
     where permission_key = 'fleet.device_provisioning_code.issue' and status = 'ACTIVE') then
    raise exception 'KLUY-MIGRATION-0163: the issuance permission is not registered ACTIVE'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'issue_terminal_provisioning_code_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_activation_governor'
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0163: the door is missing, not definer, not governor-owned or unpinned'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('public', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_activation_governor', 'kitluy_devices.provisioning_code_actor_v1()', 'execute')
     or not has_function_privilege('kitluy_activation_governor', 'kitluy_devices.provisioning_code_issue_permitted_v1(uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.provisioning_code_actor_v1()', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.provisioning_code_issue_permitted_v1(uuid, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0163: the door''s grant boundary is wrong'
      using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from pg_index
     where indrelid = 'kitluy_devices.device_provisioning_codes'::regclass
       and indexrelid = 'kitluy_devices.device_provisioning_codes_idempotency_key_uidx'::regclass) then
    raise exception 'KLUY-MIGRATION-0163: the idempotency unique index is missing'
      using errcode = 'P0001';
  end if;
  raise notice
    'KLUY-MIGRATION-0163: governed terminal provisioning-code issuance applied (authenticated-only door; P02C owns production grants)';
end
$guard$;
