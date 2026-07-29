-- kitluy:group:0142
-- Migration group 0142: scope_bound_revocation (WS-11-T003 Step 4 boundary).
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 1** —
--   "approval consumption must be single-use and ATOMIC WITH REVOCATION".
-- Depends on: group 0141 (the binding, the verifier and the consumption row).
--
-- Additive. Groups 0125-0141 are NOT edited. Group 0139's
-- `revoke_device_credential_v1` is COMMITTED and is called, not rewritten.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHY THIS GROUP EXISTS AT ALL
-- ===========================================================================
-- Group 0141 built the binding: a canonical scope digest, bound into the
-- approval `payload_hash`, verifiable fail-closed, and a consumption row whose
-- UNIQUE constraints make it single use.
--
-- Nothing called any of it.
--
-- A verifier nobody invokes is not a control, it is a function. Ruling 1 does
-- not ask for the ABILITY to verify a scope binding; it asks that a scope be
-- verified before the credentials it names are revoked, and spent in the same
-- transaction as the revocation. Both of those are properties of a CALL SITE,
-- and this group is that call site.
--
-- ===========================================================================
-- THE THIRD CHECK, WHICH IS THE ONE THAT IS EASY TO FORGET
-- ===========================================================================
-- Verifying that an approval commits to a scope proves the SCOPE is genuine.
-- It does not prove that the credential now being revoked is INSIDE it.
--
-- Without a membership check, a perfectly valid, correctly bound, unconsumed
-- scope naming devices A and B would authorize revoking device C: the binding
-- verifies, the approval is real, the four-eyes gate passes on its own terms,
-- and a device nobody reviewed loses its credential. So membership is checked
-- explicitly here, against the identifiers the scope actually records, and an
-- unresolvable membership FAILS CLOSED.
--
-- ===========================================================================
-- WHAT ATOMICITY MEANS HERE, CONCRETELY
-- ===========================================================================
-- `consume_revocation_scope_v1` traps `unique_violation` and returns a refusal
-- rather than raising, which lets the CALLER decide. This function decides the
-- only safe thing: it RAISES, so the revocation performed moments earlier in
-- the same transaction is rolled back with it.
--
-- That is the difference between "the scope was consumed and also a revocation
-- happened" and "a revocation happened and consumption was attempted". Under
-- concurrency the second one revokes twice on one approval. Two sessions racing
-- here produce exactly one committed revocation and one rolled-back
-- transaction, and the loser is told which.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create or replace function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
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
  p_incident_scope_id uuid,
  p_approval_request_id uuid,
  p_approved_by text default null,
  p_incident_reference text default null
) returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $scoped_revoke$
declare
  v_verdict kitluy_devices.approval_verdict;
  v_scope kitluy_devices.revocation_recorded_scopes;
  v_credential kitluy_devices.device_credentials;
  v_result jsonb;
  v_revocation_id uuid;
  v_consumption jsonb;
  v_member boolean;
begin
  -- Only the three reasons decision §3 says take a RECORDED set may come this
  -- way. Every other reason derives its scope from the fleet through
  -- `resolve_revocation_scope_v1`, and letting one arrive here with a recorded
  -- scope would be a caller choosing scope by the back door — the exact thing
  -- §3 forbids.
  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT', 'OTHER_APPROVED_REASON') then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-REASON-NOT-RECORDABLE',
      'detail', 'decision §3 derives this reason''s scope from the fleet; it does not take a recorded set');
  end if;

  -- 1. THE BINDING. Fails closed on missing, empty, wildcard, malformed,
  --    unbound, mismatched, digest-mismatched and already-consumed scope.
  v_verdict := kitluy_devices.verify_revocation_scope_binding_v1(
    p_incident_scope_id, p_approval_request_id, p_environment);
  if not v_verdict.authorized then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', v_verdict.refusal_code,
      'detail', v_verdict.refusal_message);
  end if;

  select * into v_scope from kitluy_devices.revocation_recorded_scopes
   where incident_scope_id = p_incident_scope_id;
  if not found then
    -- Unreachable while the verifier holds, and kept anyway: a check removed
    -- because the current arrangement makes it redundant is a check the next
    -- arrangement does not have.
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-MISSING',
      'detail', 'the recorded scope disappeared between verification and use');
  end if;

  -- 2. MEMBERSHIP. Is the credential about to be revoked actually inside the
  --    set the approvers approved? Resolved from the SAME coordinates group
  --    0136 resolves the credential from, so the row checked is the row
  --    revoked.
  select * into v_credential from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id
     and environment = p_environment
     and purpose = p_purpose
     and certificate_generation = p_credential_generation;

  v_member := p_device_record_id = any (v_scope.affected_device_ids);
  if not v_member and found then
    v_member :=
         v_credential.credential_id = any (v_scope.affected_credential_ids)
      or v_credential.public_key_fingerprint = any (v_scope.affected_fingerprints);
  end if;
  if not v_member then
    -- FAIL CLOSED. A genuine, unconsumed, correctly bound scope is still not
    -- authority over a credential it does not name.
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-NOT-IN-SET',
      'detail', 'the recorded scope does not name this device, credential or key');
  end if;

  -- 3. THE REVOCATION ITSELF, unchanged, through the committed governed
  --    function. Its four-eyes gate, evidence, recovery case and one-way
  --    trigger are not re-implemented and not bypassed.
  v_result := kitluy_devices.revoke_device_credential_v1(
    p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
    p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
    p_requested_by, p_source, p_approval_request_id, p_approved_by,
    coalesce(p_incident_reference, v_scope.incident_reference));

  if v_result ->> 'outcome' <> 'REVOKED' then
    -- Nothing was revoked, so nothing is consumed. The scope stays spendable,
    -- which is correct: a refused revocation must not burn the authority for
    -- the one that will succeed.
    return v_result;
  end if;

  v_revocation_id := (v_result ->> 'revocation_id')::uuid;

  -- 4. CONSUMPTION, in this transaction, and fatal if it loses.
  v_consumption := kitluy_devices.consume_revocation_scope_v1(
    p_incident_scope_id, p_approval_request_id, v_revocation_id,
    p_environment, p_requested_by);

  if v_consumption ->> 'outcome' <> 'CONSUMED' then
    -- RAISE, not return. A return would commit the revocation that the failed
    -- consumption says was not authorized — which is the double-spend Ruling 1
    -- exists to prevent. The revocation written moments ago dies with this.
    raise exception
      'KLUY-CRED-REVOCATION-SCOPE-CONSUMED: this recorded scope or approval has already authorized a revocation (%)',
      coalesce(v_consumption ->> 'detail', 'no detail')
      using errcode = 'unique_violation';
  end if;

  return v_result
    || jsonb_build_object(
         'incident_scope_id', p_incident_scope_id,
         'scope_digest', v_consumption ->> 'scope_digest',
         'scope_consumed', true);
end
$scoped_revoke$;

alter function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text)
  owner to kitluy_credential_issuer;

revoke all on function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text) from public;

grant execute on function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text)
  to kitluy_issuance_service;

comment on function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1, the call site. The ONLY path by which a recorded-scope reason (PROVIDER_COMPROMISE, SECURITY_INCIDENT, OTHER_APPROVED_REASON) may revoke. Three checks in order, each failing closed: the approval cryptographically commits to the exact recorded scope (group 0141 verifier); the credential being revoked is a MEMBER of that scope, because a genuine scope naming other devices is not authority over this one; and the scope is CONSUMED in the same transaction as the revocation, raising rather than returning if consumption loses a race, so the revocation rolls back with it and one approval can never authorize two revocations. Group 0139''s revoke_device_credential_v1 is CALLED, not reimplemented: its four-eyes gate, append-only evidence, recovery case and one-way trigger all still apply.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;
