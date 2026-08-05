-- kitluy:group:0175
-- Migration group 0175: pop_challenge_issuance_reconciliation.
--
-- Authority: WS-11-T004-P04A1 (package contract §5 — identical challenge
-- retry must return the SAME challenge, byte-identical signing payload, the
-- same expiry and NO new challenge); the WS-11-T004-P04A owner package §5.2
-- step 5 ("issue or RECONCILE the existing PoP challenge") and the P02C
-- handoff §3, both of which DESCRIBE reconciliation the 0170 door never
-- implemented; group 0170 (the challenge contract this group corrects
-- forward — file 0170 is NOT modified).
--
-- THE DEFECT (executable evidence, recorded in the P04A1 handoff): calling
-- `issue_terminal_provisioning_pop_challenge_v1` twice for one outstanding
-- ISSUED provisioning code inserted TWO challenge rows with DISTINCT nonces
-- (`uq_device_provisioning_pop_one_proof_per_code` only constrains
-- verified/consumed, so nothing stops duplicate ISSUED rows). A terminal that
-- lost the challenge response and retried therefore received a DIFFERENT
-- signing payload, and the abandoned challenge stayed behind as dead state.
-- With P04A1 returning the canonical signing payload to real terminals, a
-- retry MUST be byte-stable — this group makes the door reconcile.
--
-- WHAT CHANGES: `create or replace` of the issuance door adds ONE branch —
-- after every existing validation (live assignment, derived scope, active
-- Hub, outstanding unexpired unlocked code, scope consistency, one-proof
-- rule, current sealed enrollment), an outstanding ISSUED challenge for the
-- same code AND the same current enrollment is returned AS-IS (its own id,
-- nonce, created_at, expires_at, correlation_id — nothing regenerated,
-- nothing extended) instead of inserting a duplicate. The code-row FOR
-- UPDATE lock (held before the branch) serializes concurrent issuance, so
-- two racing calls cannot both insert. An outstanding challenge bound to a
-- SUPERSEDED enrollment is deliberately NOT reused — the door falls through
-- and issues a fresh challenge bound to the CURRENT sealed enrollment,
-- preserving the 0170 current-enrollment discipline.
--
-- WHAT DOES NOT CHANGE: the return shape (same keys, same outcome
-- vocabulary), every refusal path, the insert path for a first challenge,
-- table DDL, indexes, triggers, ownership (`kitluy_activation_governor` and
-- the function ACL are PRESERVED by create-or-replace and re-asserted by the
-- guard), and the 0173 NOINHERIT boundary (service_role must still hold no
-- effective privilege).

-- Ownership borrow, same as groups 0125-0166: the applying role is not a
-- member of the NOLOGIN definer owner, and replacing a governor-owned
-- function requires ownership. Handed back before the guard runs.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

create or replace function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(
  p_terminal_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $issue_pop$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_scope kitluy_devices.device_assignments;
  v_code kitluy_devices.device_provisioning_codes;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_existing kitluy_devices.device_provisioning_pop_challenges;
  v_hub uuid;
  v_environment text;
  v_now timestamptz;
  v_challenge_id uuid;
  v_nonce text;
  v_correlation uuid;
  v_proved integer;
begin
  if p_terminal_assignment_id is null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-NO-ASSIGNMENT',
      'detail', 'a challenge names exactly one terminal assignment');
  end if;

  -- 1. THE ASSIGNMENT, LOCKED FIRST — the established assignment→code order
  -- shared with every 0163-0169 door; no code-first path is introduced.
  select * into v_assignment
    from kitluy_devices.device_terminal_assignments
   where id = p_terminal_assignment_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-MISSING',
      'detail', 'no terminal assignment with that id');
  end if;
  if v_assignment.state not in ('pending_trust', 'active') then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-INACTIVE',
      'detail', format('the terminal assignment is %s, not live', v_assignment.state));
  end if;

  -- 2. THE SCOPE, DERIVED — never caller-supplied.
  select * into v_scope
    from kitluy_devices.device_assignments
   where id = v_assignment.assignment_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ASSIGNMENT-MISSING',
      'detail', 'the assignment the terminal assignment references does not exist');
  end if;

  -- 3. THE ACTIVE HUB, RE-VALIDATED NOW (ADMIN-QA-014; the 0163/0167/0169
  -- rule): the projection is written ONLY by a successful activation.
  select p.device_id, p.environment into v_hub, v_environment
    from kitluy_devices.device_assignment_projections p
   where p.tenant_id = v_scope.tenant_id
     and p.digital_store_id = v_scope.digital_store_id
     and p.store_location_id = v_scope.store_location_id
   order by p.projected_at, p.device_id
   limit 1;
  if v_hub is null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-HUB-INACTIVE',
      'detail', 'no activated Store Hub at this scope');
  end if;

  -- 4. THE OUTSTANDING CODE, LOCKED — derived relationally, never caller-
  -- chosen. Only a currently ISSUED, unexpired, unlocked code can anchor a
  -- redemption proof. THIS LOCK is also what serializes concurrent issuance
  -- for the reconciliation branch below.
  select * into v_code
    from kitluy_devices.device_provisioning_codes
   where terminal_assignment_id = p_terminal_assignment_id
     and state = 'issued'
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-NO-OUTSTANDING-CODE',
      'detail', 'no outstanding issued provisioning code exists for this assignment');
  end if;
  v_now := kitluy_ops.authoritative_now_v1();
  if v_now >= v_code.expires_at then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-EXPIRED',
      'detail', 'the outstanding code is past its authoritative expiry');
  end if;
  if v_code.failed_attempt_count >= 5 then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ATTEMPTS-EXHAUSTED',
      'detail', 'the outstanding code has exhausted its presentation attempts');
  end if;
  if v_assignment.device_id is distinct from v_code.terminal_device_id
     or v_assignment.terminal_profile_key is distinct from v_code.terminal_profile_key then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-SCOPE-INCONSISTENT',
      'detail', 'the code names a device or profile its assignment does not');
  end if;

  -- 5. ONE PROOF PER CODE, EVER: a code that already carries a verified (or
  -- consumed) proof takes no further challenges.
  select count(*) into v_proved
    from kitluy_devices.device_provisioning_pop_challenges c
   where c.provisioning_code_id = v_code.id
     and c.state in ('verified', 'consumed');
  if v_proved > 0 then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-CODE-ALREADY-PROVEN',
      'detail', 'this provisioning code already carries its one verified proof');
  end if;

  -- 6. THE CURRENT SEALED ENROLLMENT — the key identity the proof must use
  -- (0120: fingerprint only; the private key never exists server-side).
  select e.* into v_enrollment
    from kitluy_devices.devices d
    join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = v_assignment.device_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ENROLLMENT-MISSING',
      'detail', 'the terminal has no current manufacturing enrollment');
  end if;
  if v_enrollment.state <> 'sealed' or v_enrollment.revoked_at is not null then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-PROVPOP-ENROLLMENT-INELIGIBLE',
      'detail', format('the current enrollment is %s; only a sealed enrollment may prove possession', v_enrollment.state));
  end if;

  -- 7. RECONCILE THE OUTSTANDING CHALLENGE (WS-11-T004-P04A1). An identical
  -- retry returns the EXISTING issued challenge exactly as first issued —
  -- same id, same nonce, same created_at, same expires_at, same correlation:
  -- nothing regenerated, nothing extended, no duplicate row. Reuse is
  -- restricted to a challenge bound to the CURRENT sealed enrollment; a row
  -- from a superseded enrollment is left alone and a fresh challenge is
  -- issued below, preserving the 0170 current-enrollment discipline. The
  -- ordering is deterministic; after this group at most one ISSUED challenge
  -- per code can arise anyway because the code-row lock serializes issuance.
  select c.* into v_existing
    from kitluy_devices.device_provisioning_pop_challenges c
   where c.provisioning_code_id = v_code.id
     and c.state = 'issued'
     and c.terminal_enrollment_id = v_enrollment.id
   order by c.created_at desc, c.id desc
   limit 1
   for update;
  if found then
    return jsonb_build_object(
      'outcome', 'POP_CHALLENGE_ISSUED',
      'challenge_id', v_existing.id,
      'challenge_version', v_existing.challenge_version,
      'purpose', v_existing.purpose,
      'tenant_id', v_existing.tenant_id,
      'digital_store_id', v_existing.digital_store_id,
      'store_location_id', v_existing.store_location_id,
      'environment', v_existing.environment,
      'store_hub_device_id', v_existing.store_hub_device_id,
      'terminal_device_id', v_existing.terminal_device_id,
      'terminal_assignment_id', v_existing.terminal_assignment_id,
      'terminal_profile_key', v_existing.terminal_profile_key,
      'provisioning_code_id', v_existing.provisioning_code_id,
      'terminal_enrollment_id', v_existing.terminal_enrollment_id,
      'terminal_key_fingerprint', v_existing.terminal_key_fingerprint,
      'nonce', v_existing.nonce,
      'created_at', v_existing.created_at,
      'expires_at', v_existing.expires_at,
      'correlation_id', v_existing.correlation_id);
  end if;

  -- 8. THE CHALLENGE. 32 secure-random bytes; expiry inherits the code's own
  -- expires_at (recorded decision — no invented TTL, the challenge never
  -- outlives the code it redeems).
  v_challenge_id := gen_random_uuid();
  v_correlation := gen_random_uuid();
  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');

  insert into kitluy_devices.device_provisioning_pop_challenges
    (id, tenant_id, digital_store_id, store_location_id, environment,
     store_hub_device_id, terminal_device_id, terminal_assignment_id,
     terminal_profile_key, provisioning_code_id, terminal_enrollment_id,
     terminal_key_fingerprint, nonce, created_at, expires_at, correlation_id)
  values
    (v_challenge_id, v_scope.tenant_id, v_scope.digital_store_id,
     v_scope.store_location_id, v_environment, v_hub, v_assignment.device_id,
     v_assignment.id, v_assignment.terminal_profile_key, v_code.id,
     v_enrollment.id, v_enrollment.device_public_key_fingerprint, v_nonce,
     v_now, v_code.expires_at, v_correlation);

  -- Everything the SERVICE needs to build the canonical signed bytes, and
  -- nothing more: no raw code, no digest, no permission data.
  return jsonb_build_object(
    'outcome', 'POP_CHALLENGE_ISSUED',
    'challenge_id', v_challenge_id,
    'challenge_version', 'kitluy.provisioning-pop.v1',
    'purpose', 'terminal_provisioning_redemption',
    'tenant_id', v_scope.tenant_id,
    'digital_store_id', v_scope.digital_store_id,
    'store_location_id', v_scope.store_location_id,
    'environment', v_environment,
    'store_hub_device_id', v_hub,
    'terminal_device_id', v_assignment.device_id,
    'terminal_assignment_id', v_assignment.id,
    'terminal_profile_key', v_assignment.terminal_profile_key,
    'provisioning_code_id', v_code.id,
    'terminal_enrollment_id', v_enrollment.id,
    'terminal_key_fingerprint', v_enrollment.device_public_key_fingerprint,
    'nonce', v_nonce,
    'created_at', v_now,
    'expires_at', v_code.expires_at,
    'correlation_id', v_correlation);
end
$issue_pop$;

comment on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid) is
  'Group 0170, RECONCILED FORWARD by group 0175 (WS-11-T004-P04A1). INTERNAL issuance of the one cloud-side proof-of-possession challenge for terminal provisioning redemption (pairing protocol §7). Locks assignment then outstanding code (the established order), revalidates the active Hub and the current sealed manufacturing enrollment, then RECONCILES: an outstanding ISSUED challenge bound to the current enrollment is returned exactly as first issued (same id/nonce/created_at/expires_at — nothing regenerated, nothing extended, no duplicate row; the code-row lock serializes concurrent issuance), and only when none exists is one immutable challenge recorded whose nonce is 32 secure-random bytes and whose expiry inherits the bound code''s own expires_at (recorded decision: no invented TTL). Returns exactly the authoritative material the service needs to reconstruct the canonical kitluy.provisioning-pop.v1 bytes — never a raw code, digest or key. A code that already carries its one verified proof takes no further challenges.';

-- ---------------------------------------------------------------------------
-- HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- GUARD — the replacement kept every boundary it inherited
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_owner text;
  v_def text;
begin
  -- Ownership preserved: SECURITY DEFINER still executes as the governor.
  select pg_get_userbyid(p.proowner) into v_owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.proname = 'issue_terminal_provisioning_pop_challenge_v1';
  if v_owner is distinct from 'kitluy_activation_governor' then
    raise exception 'KLUY-MIGRATION-0175: the issuance door owner changed to % — create-or-replace must preserve the governor', v_owner;
  end if;

  -- The reconciliation branch is present and the insert path survived.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.proname = 'issue_terminal_provisioning_pop_challenge_v1';
  if v_def not like '%RECONCILE THE OUTSTANDING CHALLENGE%'
     or v_def not like '%terminal_enrollment_id = v_enrollment.id%'
     or v_def not like '%insert into kitluy_devices.device_provisioning_pop_challenges%'
     or v_def not like '%KLUY-PROVPOP-CODE-ALREADY-PROVEN%' then
    raise exception 'KLUY-MIGRATION-0175: the issuance door lost the reconcile branch or an inherited rule';
  end if;

  -- The 0173 effective-privilege boundary still holds: service_role must NOT
  -- effectively execute the door; the composer and harness must.
  if has_function_privilege('service_role',
       'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'EXECUTE') then
    raise exception 'KLUY-MIGRATION-0175: service_role regained effective privilege on the issuance door';
  end if;
  if not has_function_privilege('kitluy_provisioning_service',
       'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'EXECUTE') then
    raise exception 'KLUY-MIGRATION-0175: the provisioning composer lost the issuance capability';
  end if;
  if not has_function_privilege('kitluy_test_harness',
       'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'EXECUTE') then
    raise exception 'KLUY-MIGRATION-0175: the test harness lost the issuance capability';
  end if;

  raise notice
    'KLUY-MIGRATION-0175: PoP challenge issuance reconciles the outstanding challenge (WS-11-T004-P04A1); ownership, grants and every inherited refusal preserved';
end
$guard$;
