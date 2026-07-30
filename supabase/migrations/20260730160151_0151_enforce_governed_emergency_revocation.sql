-- kitluy:group:0151
-- Migration group 0151: enforce_governed_emergency_revocation.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4;
--            KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1;
--            KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001.
-- Closes:    the GRANT half of RC-021 — making group 0150's governed emergency
--            entry point the ONLY emergency revocation a runtime identity can
--            execute.
--
-- Additive. Groups 0136-0150 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHY THIS MIGRATION EXISTS SEPARATELY FROM 0150
-- ===========================================================================
-- Group 0150 built the right control and proved it in both directions: an
-- authenticated human holding `fleet.device_credential.emergency_revoke`, with
-- action-bound re-authentication evidence, can revoke immediately, and a
-- service identity asserting CISO + reauth cannot reach that door. It
-- deliberately did NOT revoke EXECUTE on group 0138's
-- `revoke_device_credential_emergency_v1`, because seven assertion sites still
-- drove that function with caller-asserted authority. Revoking the grant while
-- those stood would have turned the structural gate red and closed nothing.
--
-- Those call sites are re-homed now. This migration is the enforcement half:
-- it removes the alternative, so the control stops being available and starts
-- being mandatory. An available control is not an enforced one — the sentence
-- RC-019 was reopened over, and the sentence RC-021 was opened on.
--
-- ===========================================================================
-- WHAT IS REVOKED, AND WHAT DELIBERATELY IS NOT
-- ===========================================================================
-- REVOKED from every runtime identity:
--
--   revoke_device_credential_emergency_v1  group 0138. Takes declaring
--                                          authority as an enum and
--                                          re-authentication as a boolean,
--                                          both from the caller. The RC-021
--                                          exploit: kitluy_issuance_service
--                                          (and therefore service_role)
--                                          asserted CISO + reauth and revoked
--                                          a device's active set with zero
--                                          approvals and zero spendable
--                                          evidence.
--
-- NOT BUILT HERE (Phase B; recorded rather than quietly skipped):
--
--   * Governed post-approval and lapse against
--     `device_emergency_revocation_authorizations`. Group 0138's post-approval
--     and lapse functions answer only their OWN declarations.
--   * Governed spend of a recorded incident-defined set for
--     PROVIDER_COMPROMISE / SECURITY_INCIDENT. Group 0150 refuses both with
--     KLUY-EMERGENCY-SCOPE-NOT-FLEET-DERIVABLE until that path exists.
--   * Tenant / Digital Store / Location binding bridges that populate the
--     currently-NULL tenancy columns on the governed authorization.
--
-- The legacy function keeps EXECUTE for the NOLOGIN `kitluy_credential_issuer`
-- alone — the definer identity of the governed wrappers — and no runtime,
-- worker, service or application identity is a member of it.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

do $enforce$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'revoke_device_credential_emergency_v1'
  loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from anon', v_sig);
    execute format('revoke all on function %s from authenticated', v_sig);
    execute format('revoke all on function %s from service_role', v_sig);
    execute format('revoke all on function %s from kitluy_issuance_service', v_sig);
    execute format('revoke all on function %s from kitluy_worker_service', v_sig);
    execute format('revoke all on function %s from kitluy_job_governor', v_sig);
    execute format('revoke all on function %s from kitluy_activation_governor', v_sig);
    execute format('revoke all on function %s from kitluy_credential_approval_reader', v_sig);
    -- postgres is the migration role; strip inherited EXECUTE so a later SET
    -- ROLE / membership cannot re-open the door through the superuser's own
    -- grant option on PUBLIC defaults. Re-grant to the governor alone below.
    execute format('revoke all on function %s from postgres', v_sig);
    execute format('grant execute on function %s to kitluy_credential_issuer', v_sig);
  end loop;
end
$enforce$;

-- Stated BEFORE the hand-back: `comment on function` requires ownership.
comment on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text) is
  'RC-021, ENFORCED as of group 0151. The ONLY emergency revocation a runtime identity can execute: group 0138''s ungoverned emergency function is revoked from every runtime identity and survives for the NOLOGIN kitluy_credential_issuer alone. Its SIGNATURE is the remedy (KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.2/§2.3/§2.4, KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001): no actor, no declaring authority, no re-authenticated boolean, no fingerprint, no provider key reference, no assignment generation and no affected-set array. The actor is resolved from auth.uid(), the authority from kitluy_auth.has_permission evaluated in the CREDENTIAL''S environment, the freshness from re-authentication evidence spent once and bound to this authorization, and the blast radius from authoritative_revocation_scope_v1, which reads STORED ROWS. EXECUTE is granted to `authenticated` — the human''s own session — and revoked from PUBLIC. Phase B still owns governed post-approval/lapse and the recorded-set spend path for PROVIDER_COMPROMISE / SECURITY_INCIDENT.';

comment on function kitluy_devices.revoke_device_credential_emergency_v1(
  text, text, text, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text,
  kitluy_devices.emergency_declaring_authority, boolean, text, text, text,
  uuid, integer, text, text, integer, uuid[]) is
  'SUPERSEDED as a runtime entry point by group 0151. Retained as a governor-owned SECURITY DEFINER for ownership/shape assertions and for any in-governor delegation that may still need its body; EXECUTE is revoked from every runtime, service, worker, login and PUBLIC identity. Callers must use revoke_device_credential_emergency_governed_v1.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- THE CENSUS, after the hand-back so it describes the state this migration
-- LEAVES rather than the privilege it borrows.
-- ---------------------------------------------------------------------------
do $assert_0151$
declare
  v_role text;
  v_legacy text;
  v_findings text[] := array[]::text[];
  v_governed constant text :=
    'kitluy_devices.revoke_device_credential_emergency_governed_v1(uuid, '
    || 'kitluy_devices.credential_revocation_reason, text, text, uuid, text)';
  v_dev uuid;
  v_cred uuid;
  v_err text := 'not attempted';
  v_state text;
begin
  select p.oid::regprocedure::text into v_legacy
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.proname = 'revoke_device_credential_emergency_v1';

  if v_legacy is null then
    v_findings := v_findings || 'the legacy emergency function is missing'::text;
  else
    foreach v_role in array array[
      'public', 'anon', 'authenticated', 'service_role', 'kitluy_issuance_service',
      'kitluy_worker_service', 'kitluy_job_governor', 'kitluy_activation_governor',
      'kitluy_credential_approval_reader', 'postgres'
    ] loop
      if has_function_privilege(v_role, v_legacy, 'execute') then
        v_findings := v_findings || format('%s can still execute the legacy emergency path', v_role)::text;
      end if;
    end loop;
    if not has_function_privilege('kitluy_credential_issuer', v_legacy, 'execute') then
      v_findings := v_findings ||
        'the credential governor lost EXECUTE on the legacy emergency function'::text;
    end if;
  end if;

  -- The governed door remains reachable by the human's session...
  if not has_function_privilege('authenticated', v_governed, 'execute') then
    v_findings := v_findings ||
      'the authenticated human cannot execute the governed emergency entry point'::text;
  end if;
  -- ...and by nobody wider.
  foreach v_role in array array[
    'public', 'anon', 'service_role', 'kitluy_issuance_service',
    'kitluy_worker_service', 'kitluy_job_governor'
  ] loop
    if has_function_privilege(v_role, v_governed, 'execute') then
      v_findings := v_findings ||
        format('%s can execute the governed emergency entry point', v_role)::text;
    end if;
  end loop;

  -- No leftover borrowed membership.
  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where g.rolname = 'kitluy_credential_issuer'
               and not r.rolsuper) then
    v_findings := v_findings ||
      'a non-superuser still holds membership of the credential governor'::text;
  end if;

  -- -----------------------------------------------------------------------
  -- BEHAVIOURAL PROOF: the original RC-021 exploit fails BEFORE mutation.
  -- Made AS kitluy_issuance_service with asserted CISO + reauth against a real
  -- issued credential. The grant must refuse with permission denied; the
  -- credential must stay issued. Wrapped so a successful (wrong) call cannot
  -- commit a revocation even if the grant check were somehow wrong.
  --
  -- Empty fleet is not a pass for this probe: a from-zero apply before seed
  -- records the gap. Reset-from-zero + seed + db:test always has targets.
  -- -----------------------------------------------------------------------
  select credential_id, device_record_id into v_cred, v_dev
    from kitluy_devices.device_credentials
   where state = 'issued' and environment = 'development'
   limit 1;
  if v_cred is null then
    raise notice
      '0151: no issued development credential yet — grant census recorded; exploit proof deferred to assertions after seed';
  else
    begin
      execute 'set role kitluy_issuance_service';
      perform kitluy_devices.revoke_device_credential_emergency_v1(
        'rc021-0151-' || gen_random_uuid()::text,
        'development', 'device_identity',
        'DEVICE_STOLEN', 'RC-021 exploit must fail after 0151', 'REPROVISION_REQUIRED',
        'attacker@service', 'CISO', true, 'asserted',
        'INC-RC021-0151', 'MIGRATION0151',
        v_dev, 1);
      execute 'reset role';
      v_err := 'no error';
    exception when others then
      v_err := sqlerrm;
      begin
        execute 'reset role';
      exception when others then
        null;
      end;
    end;
    if v_err !~* 'permission denied' then
      v_findings := v_findings ||
        format('the RC-021 exploit was not refused by the grant (%s)', v_err)::text;
    end if;
    select state::text into v_state
      from kitluy_devices.device_credentials where credential_id = v_cred;
    if v_state is distinct from 'issued' then
      v_findings := v_findings ||
        format('the RC-021 exploit mutated a credential to %s', v_state)::text;
    end if;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0151: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0151$;
