-- kitluy:group:0147
-- Migration group 0147: enforce_bound_revocation.
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1.
-- Closes:    RC-019, by making group 0146's control the ONLY normal revocation
--            a runtime identity can execute.
--
-- Additive. Groups 0136-0146 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHY THIS MIGRATION EXISTS SEPARATELY FROM 0146
-- ===========================================================================
-- Group 0146 built the right control and proved it in both directions: the
-- `deadbeef-not-a-scope-hash` exploit is refused SCOPE-HASH-MISMATCH, and an
-- approval carrying the database-derived hash revokes. It deliberately did NOT
-- revoke the old grants, and said so in its own section 3, because nineteen
-- assertion call sites still drove group 0145's entry point with approvals
-- carrying arbitrary payload hashes. Revoking the grant while those stood would
-- have turned the structural gate red and closed nothing.
--
-- Those call sites are re-homed now. This migration is the enforcement half:
-- it removes the alternative, so the control stops being available and starts
-- being mandatory. An available control is not an enforced one, which is the
-- sentence RC-019 was reopened over.
--
-- ===========================================================================
-- WHAT IS REVOKED, AND WHAT DELIBERATELY IS NOT
-- ===========================================================================
-- REVOKED from every runtime identity:
--
--   revoke_device_credential_governed_v1  group 0145. Its membership test was a
--                                         TAUTOLOGY — the resolver was fed the
--                                         caller's own fingerprint, key
--                                         reference and assignment generation,
--                                         so the set was built out of the
--                                         request and compared to the request.
--
-- ALREADY REVOKED by group 0145, re-asserted here so the census is complete:
--
--   revoke_device_credential_v1           the unscoped mutation helper.
--
-- NOT REVOKED, and this is recorded rather than quietly skipped:
--
--   revoke_device_credential_emergency_v1  RC-021. It still consults no
--                                          approval, revokes the whole resolved
--                                          set rather than one credential, and
--                                          never verifies a Ruling 1 binding.
--                                          Revoking its grant WITHOUT first
--                                          building a governed emergency entry
--                                          point would make the emergency path
--                                          unreachable rather than bound, and
--                                          an unreachable emergency path is its
--                                          own incident. RC-021 stays OPEN.
--
-- Both survivors keep EXECUTE for the NOLOGIN `kitluy_credential_issuer`, which
-- is the definer identity of the governed wrappers and which no runtime, worker,
-- service or application identity is a member of.

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
       and p.proname in ('revoke_device_credential_governed_v1',
                         'revoke_device_credential_v1')
  loop
    execute format('revoke all on function %s from public', v_sig);
    execute format('revoke all on function %s from kitluy_issuance_service', v_sig);
    execute format('grant execute on function %s to kitluy_credential_issuer', v_sig);
  end loop;
end
$enforce$;

-- Stated BEFORE the hand-back: `comment on function` requires ownership, and
-- the borrowed governor membership is what supplies it. Group 0144 made this
-- exact mistake and could not apply from a clean database at all.
comment on function kitluy_devices.revoke_device_credential_bound_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid) is
  'RC-019, ENFORCED as of group 0147. The ONLY normal revocation a runtime identity can execute: group 0145''s tautological entry point and group 0136''s unscoped helper are both revoked from every runtime identity and survive for the NOLOGIN kitluy_credential_issuer alone. For the six fleet-derived reasons the affected set is derived from STORED ROWS by authoritative_revocation_scope_v1 — which takes no fingerprint, key-reference or assignment-generation parameter — and the approval''s payload_hash must equal the hash of THAT set, so an approval commits to an answer the database computed rather than one the caller described. The three recorded-set reasons keep group 0142''s path. A hash mismatch is also how a STALE approval fails: if the fleet moved after approval, the approvers did not approve this set and a new one is required. RC-021 (the emergency path) is NOT closed by this migration and remains OPEN.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- THE CENSUS, after the hand-back so it describes the state this migration
-- LEAVES rather than the privilege it borrows. Group 0145's first run failed on
-- exactly that ordering mistake.
-- ---------------------------------------------------------------------------
do $assert_0147$
declare
  v_role text;
  v_closed text;
  v_findings text[] := array[]::text[];
  v_bound constant text :=
    'kitluy_devices.revoke_device_credential_bound_v1(text, uuid, text, text, integer, '
    || 'kitluy_devices.credential_revocation_reason, text, '
    || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid)';
begin
  for v_closed in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('revoke_device_credential_governed_v1',
                         'revoke_device_credential_v1')
  loop
    foreach v_role in array array[
      'public', 'anon', 'authenticated', 'service_role', 'kitluy_issuance_service',
      'kitluy_worker_service', 'kitluy_job_governor', 'kitluy_activation_governor',
      'kitluy_credential_approval_reader', 'postgres'
    ] loop
      if has_function_privilege(v_role, v_closed, 'execute') then
        v_findings := v_findings || format('%s can still execute %s', v_role, v_closed)::text;
      end if;
    end loop;
    -- ...and the governor must keep it, or the governed wrappers cannot revoke.
    if not has_function_privilege('kitluy_credential_issuer', v_closed, 'execute') then
      v_findings := v_findings || format('the credential governor lost EXECUTE on %s', v_closed)::text;
    end if;
  end loop;

  -- The one path that remains is reachable by the runtime identity...
  if not has_function_privilege('kitluy_issuance_service', v_bound, 'execute') then
    v_findings := v_findings || 'the runtime identity cannot execute the bound entry point'::text;
  end if;
  -- ...and by nobody wider.
  foreach v_role in array array['public', 'anon', 'authenticated', 'kitluy_worker_service'] loop
    if has_function_privilege(v_role, v_bound, 'execute') then
      v_findings := v_findings || format('%s can execute the bound entry point', v_role)::text;
    end if;
  end loop;
  -- The authoritative resolver stays governor-only: a runtime caller must not be
  -- able to ask the database to derive a set outside the bound path.
  if has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.authoritative_revocation_scope_v1(uuid, kitluy_devices.credential_revocation_reason)',
       'execute') then
    v_findings := v_findings || 'the runtime identity can execute the authoritative resolver directly'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0147: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0147$;
