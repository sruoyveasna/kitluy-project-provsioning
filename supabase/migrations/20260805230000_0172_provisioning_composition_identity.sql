-- kitluy:group:0172
-- Migration group 0172: provisioning_composition_identity.
--
-- Authority: WS-11-T004-P02C (package contract); the 0127 machine-identity
-- framework (NOLOGIN capability role, granted to service_role, assumed per
-- transaction with SET LOCAL ROLE — exactly how kitluy_issuance_service and
-- kitluy_worker_service work today, database.ts `withServiceRole`); the
-- P02B3C composition-readiness audit (trusted caller identity MISSING); the
-- proven doors of 0164/0166 (evaluator), 0170 (PoP challenge + attestation)
-- and 0171 (atomic redemption).
--
-- IDENTITY CLASSIFICATION (recorded): Boundary A = A2 — the existing
-- machine-identity framework with one NEW narrow role. Boundary B = B3 —
-- pre-credential terminal TRANSPORT authority is undefined in this
-- repository (the same recorded posture as the revocation routes' refusing
-- authenticator under BLK-006), so no public route ships; the trusted
-- internal composition service and its typed contract do.
--
-- ===========================================================================
-- WHAT THIS GROUP ADDS
-- ===========================================================================
-- 1. `kitluy_provisioning_service` — the NOLOGIN terminal-provisioning
--    composition identity. Granted to service_role for SET LOCAL ROLE
--    assumption (the 0127 membership pattern); holds EXECUTE on EXACTLY the
--    five composition capabilities and NOTHING else — no table access, no
--    helper access, no other door.
-- 2. `read_terminal_provisioning_pop_challenge_context_v1` — the ONE narrow
--    governed read the Node crypto authority needs to reconstruct the
--    canonical `kitluy.provisioning-pop.v1` bytes from AUTHORITATIVE rows
--    (never a caller-supplied payload), plus the enrollment state and the
--    authoritative clock for trusted-time evaluation. Added so the service
--    never receives direct table SELECT.
--
-- The composition grant surface (asserted below):
--   evaluate_terminal_provisioning_code_v1          (presentation, 0164/0166)
--   issue_terminal_provisioning_pop_challenge_v1    (challenge, 0170)
--   read_terminal_provisioning_pop_challenge_context_v1 (this group)
--   record_terminal_provisioning_pop_verification_v1(attestation, 0170)
--   redeem_terminal_provisioning_code_v1            (redemption, 0171)
--
-- The harness keeps its test grants (censused, revoked-after-suite). The
-- human doors (issue/revoke/recover) stay authenticated-scoped, untouched.
-- Environment behavior is untouched: development composes; pilot and
-- production keep failing closed INSIDE the authoritative functions
-- (BLK-005 via assert_pki_configuration_approved) — a grant is never
-- signing approval.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02C -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE COMPOSITION IDENTITY (the 0127 pattern, verbatim)
-- ---------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_provisioning_service') then
    create role kitluy_provisioning_service nologin;
  end if;
end
$role$;

comment on role kitluy_provisioning_service is
  'Group 0172 (WS-11-T004-P02C). The terminal-provisioning composition identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the device-registry service connecting as service_role, exactly like kitluy_issuance_service (0127) and kitluy_worker_service (0135). Holds EXECUTE on exactly the five provisioning composition capabilities (evaluator, challenge issuer, challenge-context reader, attestation recorder, redemption door) and NOTHING else — no table access, no internal helper, no human door, no role or policy administration. A grant here is never signing approval: pilot and production stay fail-closed inside the authoritative functions under BLK-005.';

grant kitluy_provisioning_service to service_role;
-- Schema USAGE only — never table privileges: name resolution for the five
-- granted functions (the same grant every runtime capability role carries).
grant usage on schema kitluy_devices to kitluy_provisioning_service;

-- ---------------------------------------------------------------------------
-- 2. THE NARROW VERIFICATION-CONTEXT READER
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(
  p_challenge_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops
as $read_ctx$
declare
  v_challenge kitluy_devices.device_provisioning_pop_challenges;
  v_enrollment kitluy_devices.manufacturing_enrollments;
begin
  if p_challenge_id is null then
    return jsonb_build_object(
      'outcome', 'CONTEXT_REFUSED',
      'refusal_code', 'KLUY-POPCTX-NO-CHALLENGE',
      'detail', 'a context read names exactly one challenge');
  end if;
  select * into v_challenge
    from kitluy_devices.device_provisioning_pop_challenges
   where id = p_challenge_id;
  if not found then
    return jsonb_build_object(
      'outcome', 'CONTEXT_REFUSED',
      'refusal_code', 'KLUY-POPCTX-NOT-FOUND',
      'detail', 'no challenge with that id');
  end if;
  select e.* into v_enrollment
    from kitluy_devices.manufacturing_enrollments e
   where e.id = v_challenge.terminal_enrollment_id;

  -- EXACTLY the fields the canonical-bytes reconstruction and expectation
  -- need (packages/device-identity provisioning-pop.ts), the challenge and
  -- enrollment states, and the authoritative clock for trusted-time
  -- evaluation. No digest, no raw code, no grants, no unrelated data.
  return jsonb_build_object(
    'outcome', 'CONTEXT',
    'challenge_id', v_challenge.id,
    'challenge_version', v_challenge.challenge_version,
    'purpose', v_challenge.purpose,
    'tenant_id', v_challenge.tenant_id,
    'digital_store_id', v_challenge.digital_store_id,
    'store_location_id', v_challenge.store_location_id,
    'environment', v_challenge.environment,
    'store_hub_device_id', v_challenge.store_hub_device_id,
    'terminal_device_id', v_challenge.terminal_device_id,
    'terminal_assignment_id', v_challenge.terminal_assignment_id,
    'terminal_profile_key', v_challenge.terminal_profile_key,
    'provisioning_code_id', v_challenge.provisioning_code_id,
    'terminal_enrollment_id', v_challenge.terminal_enrollment_id,
    'terminal_key_fingerprint', v_challenge.terminal_key_fingerprint,
    'nonce', v_challenge.nonce,
    'created_at', v_challenge.created_at,
    'expires_at', v_challenge.expires_at,
    'state', v_challenge.state,
    'enrollment_state', coalesce(v_enrollment.state::text, 'missing'),
    'authoritative_now', kitluy_ops.authoritative_now_v1());
end
$read_ctx$;

comment on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid) is
  'Group 0172 (WS-11-T004-P02C). The ONE narrow read the composition service needs to reconstruct the canonical kitluy.provisioning-pop.v1 bytes from AUTHORITATIVE rows and evaluate trusted time — added so the service never holds table SELECT. Returns exactly the challenge bindings, nonce, states and the authoritative clock; never a code digest, raw code or grant detail. Composition-identity and harness EXECUTE only.';

alter function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)
  owner to kitluy_activation_governor;
revoke all on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid) from public;
revoke all on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid) from anon;
revoke all on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid) from authenticated;
revoke all on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid) from service_role;
grant execute on function kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)
  to kitluy_provisioning_service, kitluy_test_harness;

-- ---------------------------------------------------------------------------
-- 3. THE LEAST-PRIVILEGE COMPOSITION GRANTS
-- ---------------------------------------------------------------------------
grant execute on function kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  to kitluy_provisioning_service;
grant execute on function kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)
  to kitluy_provisioning_service;
grant execute on function kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)
  to kitluy_provisioning_service;
grant execute on function kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)
  to kitluy_provisioning_service;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 4. PROVE THE BOUNDARY ON APPLY (non-vacuous assertions)
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
begin
  -- The composition role exists, NOLOGIN, member of nothing, held only by
  -- service_role.
  if not exists (
    select 1 from pg_roles where rolname = 'kitluy_provisioning_service' and not rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0172: the composition role is missing or can log in'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_provisioning_service')
       and r.rolname <> 'service_role'
       -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): exclude the automatic,
       -- un-removable creator membership. Any other holder is still a finding.
       and not (r.rolname = current_user and m.grantor <> m.member)) then
    raise exception 'KLUY-MIGRATION-0172: an unexpected role holds the composition identity'
      using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_provisioning_service')) then
    raise exception 'KLUY-MIGRATION-0172: the composition role must be a member of NOTHING'
      using errcode = 'P0001';
  end if;

  -- EXACTLY the five capabilities; nothing else in kitluy_devices is
  -- executable by the composer.
  select count(*) into v_extra
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_provisioning_service', p.oid, 'execute')
     and p.proname not in (
       'evaluate_terminal_provisioning_code_v1',
       'issue_terminal_provisioning_pop_challenge_v1',
       'read_terminal_provisioning_pop_challenge_context_v1',
       'record_terminal_provisioning_pop_verification_v1',
       'redeem_terminal_provisioning_code_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0172: the composition role can execute % function(s) beyond its five capabilities', v_extra
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('kitluy_provisioning_service', 'kitluy_devices.evaluate_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_provisioning_service', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or not has_function_privilege('kitluy_provisioning_service', 'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)', 'execute')
     or not has_function_privilege('kitluy_provisioning_service', 'kitluy_devices.record_terminal_provisioning_pop_verification_v1(uuid, boolean, text, text)', 'execute')
     or not has_function_privilege('kitluy_provisioning_service', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0172: a required composition grant is missing'
      using errcode = 'P0001';
  end if;

  -- No table reach at all for the composer; the context reader stays denied
  -- to every runtime identity except the composer and the harness.
  if has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_codes', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_pop_challenges', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_provisioning_code_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.device_certificates', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_provisioning_service', 'kitluy_devices.manufacturing_enrollments', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0172: the composition role holds direct table access'
      using errcode = 'P0001';
  end if;
  -- service_role is INHERIT (the platform's attribute), so membership-aware
  -- privilege functions would report composer capabilities as its own — the
  -- 0127-recorded posture. What must NOT exist is a DIRECT grant, so
  -- service_role checks below read the ACL itself.
  if has_function_privilege('public', 'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)', 'execute')
     or has_function_privilege('anon', 'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)', 'execute')
     or has_function_privilege('kitluy_worker_service', 'kitluy_devices.read_terminal_provisioning_pop_challenge_context_v1(uuid)', 'execute')
     or exists (
       select 1 from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        cross join lateral aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
       where n.nspname = 'kitluy_devices'
         and p.proname = 'read_terminal_provisioning_pop_challenge_context_v1'
         and a.grantee = 'service_role'::regrole::oid) then
    raise exception 'KLUY-MIGRATION-0172: the context reader leaked beyond the composer and harness'
      using errcode = 'P0001';
  end if;
  -- The reader's body carries no digest field and never the raw code.
  if (select pg_get_functiondef(p.oid)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_devices'
         and p.proname = 'read_terminal_provisioning_pop_challenge_context_v1')
      like '%code_digest%' then
    raise exception 'KLUY-MIGRATION-0172: the context reader exposes the code digest'
      using errcode = 'P0001';
  end if;

  -- service_role holds NO DIRECT grant on any provisioning door — its only
  -- path is the narrow composer role (the 0127 membership pattern; direct
  -- ACL semantics, since the INHERIT attribute makes membership-aware checks
  -- report the composer's capabilities).
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     cross join lateral aclexplode(coalesce(p.proacl, '{}'::aclitem[])) a
    where n.nspname = 'kitluy_devices'
      and p.proname in (
        'evaluate_terminal_provisioning_code_v1',
        'issue_terminal_provisioning_pop_challenge_v1',
        'record_terminal_provisioning_pop_verification_v1',
        'redeem_terminal_provisioning_code_v1')
      and a.grantee = 'service_role'::regrole::oid) then
    raise exception 'KLUY-MIGRATION-0172: service_role holds a direct provisioning shortcut'
      using errcode = 'P0001';
  end if;

  -- Earlier boundaries stand exactly as 0169/0170/0171 asserted them.
  if not has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated', 'kitluy_devices.recover_terminal_provisioning_code_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.issue_terminal_provisioning_pop_challenge_v1(uuid)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_test_harness', 'kitluy_devices.redeem_terminal_provisioning_code_v1(uuid, text, uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0172: an earlier provisioning boundary drifted'
      using errcode = 'P0001';
  end if;

  -- No login-capable role holds the governor; no privilege-escalation path
  -- from the composer to any owner role.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_activation_governor')
       and r.rolcanlogin
       -- PG16+ (KLREC-2026-08-07-PG16-CREATEROLE-001): exclude the automatic,
       -- un-removable membership PostgreSQL 16 grants the creating role. Any
       -- other login-capable member is still a finding.
       and not (r.rolname = current_user and m.grantor <> m.member))
     or exists (
    select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_provisioning_service')
       and m.roleid in (select oid from pg_roles where rolname in
         ('kitluy_activation_governor', 'kitluy_credential_issuer', 'kitluy_credential_approval_reader'))) then
    raise exception 'KLUY-MIGRATION-0172: an escalation path to a NOLOGIN owner exists'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0172: provisioning composition identity applied (kitluy_provisioning_service NOLOGIN, service_role-assumable, EXACTLY five capabilities, zero table reach; narrow challenge-context reader added; pilot/production stay fail-closed inside the authoritative functions — a grant is never signing approval; activation and pairing remain separate work)';
end
$guard$;
