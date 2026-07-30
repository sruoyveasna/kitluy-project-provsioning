-- kitluy:group:0145
-- Migration group 0145: single_governed_revocation_entry.
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1;
--            KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3.
-- Closes:    RC-019 (BLOCKING), raised by independent hostile review 2026-07-30
--            and reproduced again immediately before this migration was written.
--
-- Additive. Groups 0136-0144 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE BYPASS, AS REPRODUCED
-- ===========================================================================
-- Group 0142 added a scope-bound revocation call site and its comment claimed
-- it was "The ONLY path". It never was: group 0136's
-- `revoke_device_credential_v1` was still EXECUTE-granted to
-- `kitluy_issuance_service`, takes NO scope argument, and its approval gate
-- `evaluate_credential_revocation_approval_v1` deliberately cannot read
-- `payload_hash` — so nothing on that path ever looks at a scope binding.
--
-- Reproduced on the development database immediately before this fix, rolled
-- back afterwards:
--
--   role                kitluy_issuance_service
--   function            kitluy_devices.revoke_device_credential_v1
--   approval            A4, quorum 2, two distinct approvers, status APPROVED
--   payload_hash        'deadbeef-not-a-scope-hash'   (commits to nothing)
--   recorded scopes     0 rows created
--   consumptions        0 rows created
--   result              {"outcome": "REVOKED", ...}
--   credential state    issued -> revoked
--
-- 0142 added a door and removed nothing, so every property Ruling 1 requires
-- was OPTIONAL for the only role that could invoke either path. A control that
-- can be walked around is not a control, and a comment asserting otherwise is
-- worse than no comment.
--
-- ===========================================================================
-- WHAT CLOSES IT: ONE DOOR, NOT A BETTER SIGN ON THE OLD ONE
-- ===========================================================================
-- The fix is a PRIVILEGE boundary, not a convention. After this migration no
-- runtime identity holds EXECUTE on an unscoped revocation mutation, so calling
-- SQL directly does not help: the bypass is unreachable rather than
-- discouraged.
--
--   * `revoke_device_credential_v1` keeps EXECUTE for exactly ONE grantee,
--     `kitluy_credential_issuer` — which is NOLOGIN, which nothing may SET ROLE
--     to, and which exists only as the definer identity of the governed
--     wrappers. It survives as an INTERNAL HELPER and holds no independent
--     external mutation authority.
--
--   * `kitluy_issuance_service` — the runtime identity, and the one
--     `service_role` reaches through group 0127's membership — gets a single
--     new entry point that binds scope for EVERY reason.
--
-- The legacy function is deliberately NOT dropped. Group 0142's wrapper calls
-- it, group 0140's in-migration assertion calls it, and dropping a function
-- three committed migrations depend on to fix a grant would be a far larger
-- change than the hole warrants.
--
-- ===========================================================================
-- EVERY REASON IS RE-HOMED, AND SCOPE IS NEVER THE CALLER'S CHOICE
-- ===========================================================================
-- `kitluy_devices.credential_revocation_reason` has NINE values. They split
-- into two groups, and the new entry point handles both:
--
--   RECORDED SET (decision §3, cannot be derived from the fleet)
--     PROVIDER_COMPROMISE, SECURITY_INCIDENT, OTHER_APPROVED_REASON
--     -> delegated to group 0142's `revoke_device_credential_with_recorded_scope_v1`,
--        which verifies the Ruling 1 binding, checks membership and consumes
--        the scope atomically. An absent `p_incident_scope_id` FAILS CLOSED.
--
--   FLEET-DERIVED (decision §3 derives these from the fleet itself)
--     KEY_COMPROMISE, DEVICE_LOST, DEVICE_STOLEN, ASSIGNMENT_INVALIDATED,
--     CERTIFICATE_MISISSUANCE, ADMINISTRATIVE_REPLACEMENT
--     -> scope is RESOLVED by `resolve_revocation_scope_v1` from the REASON,
--        never accepted from the caller, and the credential being revoked must
--        be a MEMBER of the resolved set.
--
-- That membership check is the point. Group 0136's function resolves ONE
-- credential from (device, environment, purpose, generation) and revokes it.
-- The resolver independently computes which credentials the REASON reaches —
-- the identified credential only for ADMINISTRATIVE_REPLACEMENT and
-- CERTIFICATE_MISISSUANCE, the affected key's credentials for KEY_COMPROMISE,
-- every active and overlapping credential for DEVICE_LOST and DEVICE_STOLEN,
-- the invalid assignment generation for ASSIGNMENT_INVALIDATED. If the
-- credential the caller named is not in that set, the caller has asked for
-- something the reason does not authorize, and it is refused.
--
-- An UNRESOLVED scope is refused, not defaulted. `resolve_revocation_scope_v1`
-- returns `resolved:false` for a reason it cannot derive (including the three
-- recorded-set reasons arriving without their recorded set), and this function
-- treats that as a refusal rather than as "no restriction".

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE SINGLE GOVERNED ENTRY POINT.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_governed_v1(
  p_revocation_request_id text,
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_credential_generation integer,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_reason text,
  p_recovery_disposition kitluy_devices.credential_recovery_disposition,
  p_requested_by text,
  p_source text,
  p_approval_request_id uuid default null,
  p_approved_by text default null,
  p_incident_reference text default null,
  p_incident_scope_id uuid default null,
  p_provider_key_reference text default null,
  p_public_key_fingerprint text default null,
  p_assignment_generation integer default null
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $governed$
declare
  v_scope jsonb;
  v_credential kitluy_devices.device_credentials;
  v_ids uuid[];
begin
  -- --- the three reasons that carry a RECORDED set -------------------------
  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT', 'OTHER_APPROVED_REASON') then
    if p_incident_scope_id is null then
      -- FAIL CLOSED. These reasons cannot be derived from the fleet, so a
      -- missing recorded set is not "revoke the obvious one" — it is a caller
      -- asking to revoke without saying what the incident reached.
      return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
        'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-MISSING',
        'detail', 'this reason requires a recorded, approved affected set and none was presented');
    end if;
    return kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
      p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
      p_requested_by, p_source, p_incident_scope_id, p_approval_request_id,
      p_approved_by, p_incident_reference);
  end if;

  -- --- the six reasons whose scope the FLEET decides -----------------------
  --
  -- The credential is resolved FIRST, from the same coordinates group 0136
  -- resolves it from, because two questions have to be answered in this order.
  select * into v_credential from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id
     and environment = p_environment
     and purpose = p_purpose
     and certificate_generation = p_credential_generation;
  if not found then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-NO-CREDENTIAL',
      'detail', 'no credential exists at the coordinates given');
  end if;

  -- AN ALREADY-REVOKED CREDENTIAL GOES STRAIGHT THROUGH, and that is not a
  -- hole. Scope binding governs which credentials may be MOVED INTO `revoked`;
  -- it has nothing to say about one that is already there. Group 0138's one-way
  -- trigger means no second transition is possible, so the delegated call can
  -- only answer ALREADY_REVOKED or MANUAL_REVIEW_REQUIRED — it cannot change
  -- state.
  --
  -- Checking scope first actively BROKE this: the fleet resolver returns an
  -- EMPTY set for a device whose credentials are all revoked, so a conflicting
  -- second intent — a different reason arriving for the same credential, which
  -- decision §5.4 requires a human to look at — was refused as
  -- SCOPE-EMPTY and never reached review. A refusal that swallows a conflict is
  -- worse than the conflict. The repository's own revocation-execution
  -- assertion caught this.
  if v_credential.state = 'revoked' then
    return kitluy_devices.revoke_device_credential_v1(
      p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
      p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
      p_requested_by, p_source, p_approval_request_id, p_approved_by,
      p_incident_reference);
  end if;

  v_scope := kitluy_devices.resolve_revocation_scope_v1(
    p_reason_code, p_environment, p_device_record_id, p_purpose,
    p_credential_generation, p_provider_key_reference, p_public_key_fingerprint,
    p_assignment_generation, p_incident_reference, null, p_approval_request_id);

  if coalesce((v_scope ->> 'resolved')::boolean, false) is not true then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-UNRESOLVED',
      'detail', coalesce(v_scope ->> 'detail',
                         'the scope for this reason could not be resolved, and an unresolved scope is not an unrestricted one'));
  end if;

  select array_agg(value::uuid) into v_ids
    from jsonb_array_elements_text(coalesce(v_scope -> 'credential_ids', '[]'::jsonb));
  if v_ids is null or cardinality(v_ids) = 0 then
    -- An empty derived set is a wildcard spelled differently — decision §3.1.
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-EMPTY',
      'detail', 'the resolved affected set is empty, and an empty set is an unrestricted one');
  end if;

  if not (v_credential.credential_id = any (v_ids)) then
    -- The reason is genuine and the approval may be genuine, but this
    -- credential is not one the reason reaches.
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-NOT-IN-SET',
      'detail', format('the scope resolved for %s does not reach this credential', p_reason_code));
  end if;

  -- The governed revocation itself, unchanged. Its four-eyes gate, append-only
  -- evidence, recovery case and one-way trigger all still apply.
  return kitluy_devices.revoke_device_credential_v1(
      p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
      p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
      p_requested_by, p_source, p_approval_request_id, p_approved_by,
      p_incident_reference)
    || jsonb_build_object('scope_rule', v_scope ->> 'scope_rule',
                          'scope_credential_count', cardinality(v_ids));
end
$governed$;

alter function kitluy_devices.revoke_device_credential_governed_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid,
  text, text, integer)
  owner to kitluy_credential_issuer;

revoke all on function kitluy_devices.revoke_device_credential_governed_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid,
  text, text, integer) from public;

grant execute on function kitluy_devices.revoke_device_credential_governed_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid,
  text, text, integer) to kitluy_issuance_service;

comment on function kitluy_devices.revoke_device_credential_governed_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid,
  text, text, integer) is
  'RC-019. The ONE revocation entry point any runtime identity may execute, and this time the claim is enforced by a GRANT rather than asserted in a comment: group 0145 revokes EXECUTE on the unscoped revoke_device_credential_v1 from kitluy_issuance_service, leaving it reachable only by the NOLOGIN kitluy_credential_issuer as an internal helper. Scope is bound for EVERY one of the nine reasons and is never the caller''s choice — the three recorded-set reasons (PROVIDER_COMPROMISE, SECURITY_INCIDENT, OTHER_APPROVED_REASON) are delegated to group 0142''s scope-bound call site and FAIL CLOSED without a recorded set, and the six fleet-derived reasons have their affected set RESOLVED from the reason by resolve_revocation_scope_v1, with the named credential required to be a MEMBER of it. An unresolved scope and an empty resolved set are each refused rather than treated as unrestricted.';

-- ---------------------------------------------------------------------------
-- 2. THE DOOR THAT IS BEING CLOSED.
--
-- After this, `kitluy_issuance_service` — and therefore `service_role`, which
-- reaches it through group 0127's membership — can no longer execute an
-- unscoped revocation. `kitluy_credential_issuer` keeps EXECUTE because the
-- group 0142 wrapper and this group's entry point are SECURITY DEFINERs owned
-- by it; that role is NOLOGIN and section 32's containment assertion refuses
-- any migration that leaves a login identity able to SET ROLE to it.
-- ---------------------------------------------------------------------------
revoke all on function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)
  from public;
revoke all on function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)
  from kitluy_issuance_service;
grant execute on function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)
  to kitluy_credential_issuer;

comment on function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text) is
  'Group 0136''s governed revocation: four-eyes gate, append-only evidence, derived revoked state, recovery case. INTERNAL HELPER ONLY as of group 0145 (RC-019). It takes no scope argument and its approval gate cannot read payload_hash, so nothing on this path inspects a Ruling 1 binding — which is exactly how it became a bypass while kitluy_issuance_service held EXECUTE on it. EXECUTE is now held ONLY by the NOLOGIN kitluy_credential_issuer, the definer identity of revoke_device_credential_governed_v1 and revoke_device_credential_with_recorded_scope_v1. No runtime, worker, service or login identity can reach it, so it exposes no independent external mutation authority. Runtime callers use revoke_device_credential_governed_v1.';

-- ---------------------------------------------------------------------------
-- 3. PROOF, BY EXECUTION, INSIDE THE MIGRATION.
--
-- A grant census rather than a hopeful statement: no identity outside the
-- single NOLOGIN governor may execute the unscoped function, and PUBLIC holds
-- nothing.
-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- 4. A CLAIM WITHDRAWN — group 0142's comment.
--
-- 0142 said its function is "The ONLY path by which a recorded-scope reason may
-- revoke". That was false when written, and RC-019 is the proof. It is true NOW,
-- for a different and better reason: not because the comment says so, but
-- because section 2 above removed EXECUTE on the alternative from every runtime
-- identity.
--
-- This correction was first appended to group 0144, AFTER that migration had
-- already handed its borrowed membership back — so it could not run from a
-- clean database (`must be owner of function ...`, SQLSTATE 42501) and broke
-- the whole chain at 0144. It is issued here instead, inside this migration's
-- own borrow window, where the governor membership is still held.
-- ---------------------------------------------------------------------------
comment on function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1, the scope-bound call site for the three recorded-set reasons. Three checks in order, each failing closed: the approval cryptographically commits to the exact recorded scope; the credential being revoked is a MEMBER of that scope; and the scope is CONSUMED in the same transaction, raising rather than returning if consumption loses a race, so the revocation rolls back with it. Group 0136''s revoke_device_credential_v1 is CALLED, not reimplemented. HISTORY (RC-019): this comment once claimed to be the ONLY path by which a recorded-scope reason may revoke, and it was not — kitluy_issuance_service also held EXECUTE on the unscoped revoke_device_credential_v1, proved by execution with an approval whose payload_hash committed to nothing. Group 0145 closed that by revoking the grant and routing every reason through revoke_device_credential_governed_v1. The claim is now enforced by a privilege boundary rather than asserted in prose.';

-- The membership borrowed at the top is handed back BEFORE the census below,
-- because the census must describe the state this migration LEAVES. Asserting
-- while the borrow is still held measures the migration's own temporary
-- privilege and reports `postgres` as able to revoke — which it is, for as long
-- as it is a member of the governor, and which is exactly what the hand-back
-- exists to end. The first run of this assertion caught that ordering.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

do $assert_0145$
declare
  v_role text;
  v_findings text[] := array[]::text[];
  v_sig constant text :=
    'kitluy_devices.revoke_device_credential_v1(text, uuid, text, text, integer, '
    || 'kitluy_devices.credential_revocation_reason, text, '
    || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text)';
begin
  foreach v_role in array array[
    'public', 'anon', 'authenticated', 'service_role',
    'kitluy_issuance_service', 'kitluy_worker_service', 'kitluy_job_governor',
    'kitluy_activation_governor', 'kitluy_credential_approval_reader', 'postgres'
  ] loop
    if has_function_privilege(v_role, v_sig, 'execute') then
      v_findings := v_findings || format('%s can still execute the unscoped revocation', v_role)::text;
    end if;
  end loop;

  -- ...and the one identity that must keep it, does.
  if not has_function_privilege('kitluy_credential_issuer', v_sig, 'execute') then
    v_findings := v_findings
      || 'the credential governor lost EXECUTE, so the governed wrappers cannot revoke at all'::text;
  end if;

  -- The new entry point is reachable by the runtime identity and by nobody wider.
  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.revoke_device_credential_governed_v1(text, uuid, text, text, integer, '
       || 'kitluy_devices.credential_revocation_reason, text, '
       || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid, '
       || 'text, text, integer)', 'execute') then
    v_findings := v_findings || 'the runtime identity cannot execute the governed entry point'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0145: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0145$;
