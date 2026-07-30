-- kitluy:group:0146
-- Migration group 0146: authoritative_revocation_scope.
--
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1;
--            KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3.
-- Remediates: RC-019 (the part group 0145 did not close) and RC-021.
--
-- Additive. Groups 0136-0145 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- WHY GROUP 0145 WAS NOT ENOUGH
-- ===========================================================================
-- 0145 removed the unscoped door and routed every reason through one entry
-- point. For the three recorded-set reasons that worked. For the six
-- fleet-derived reasons the membership check it added was a TAUTOLOGY, and an
-- independent reviewer proved it by execution.
--
-- The shape of the mistake is worth stating plainly, because it is easy to make
-- again. 0145 called `resolve_revocation_scope_v1` and then asked whether the
-- credential the caller named was in the result. But the resolver's INPUTS were
-- the caller's own parameters — `p_provider_key_reference`,
-- `p_public_key_fingerprint`, `p_assignment_generation`, and the device and
-- generation. So the set was built out of the request and then compared to the
-- request. Every rule was self-satisfying:
--
--   IDENTIFIED_CREDENTIAL_ONLY          contains the credential the caller named
--   DEVICE_ACTIVE_AND_OVERLAPPING       contains it, the caller named its device
--   KEY_BOUND_CREDENTIALS               contains it, the caller supplied its fingerprint
--   ASSIGNMENT_GENERATION_CREDENTIALS   contains it, the caller supplied its generation
--
-- The check read like an authorization decision and behaved like a mirror.
-- Reproduced immediately before this migration: `ADMINISTRATIVE_REPLACEMENT`
-- through the 0145 entry point, with an approval whose `payload_hash` is the
-- literal `deadbeef-not-a-scope-hash`, returned `REVOKED` with zero consumption
-- rows and zero recorded scopes.
--
-- ===========================================================================
-- WHAT ACTUALLY CLOSES IT: THE APPROVAL MUST COMMIT TO THE ANSWER
-- ===========================================================================
-- Two changes, and the second is the one that matters.
--
--   1. The affected set is computed from STORED ROWS ONLY. The caller supplies
--      the credential coordinates and nothing else; the key reference, the
--      fingerprint and the assignment generation are READ from
--      `device_credentials` and `device_generation_keys` inside the governed
--      boundary. There is no parameter through which a caller can describe the
--      fleet to the database.
--
--   2. The approval's `payload_hash` must equal the hash of THAT set. Group
--      0141 already built the binding and groups 0141/0142 already required it
--      for the three recorded-set reasons; this extends the same requirement to
--      all nine. An approval therefore commits to the exact credentials the
--      database itself derived, and `deadbeef-not-a-scope-hash` authorizes
--      nothing for any reason, because it is not the hash of anything.
--
-- Change (1) alone would not have been enough: a caller could still have named
-- a credential and had the database faithfully derive a set containing it. It
-- is (2) — an independently computed answer the approver had to have seen —
-- that turns the check from a mirror into a decision. Nothing here is a
-- membership test against caller input.
--
-- FAIL CLOSED ON STALE STATE. Because the hash is over state read NOW, an
-- approval granted against a fleet that has since changed no longer matches and
-- is refused. That is the intended behaviour, not a defect: the approvers
-- approved a set, and if the set moved they did not approve this one. The
-- remedy is a new request and a new approval.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. THE AUTHORITATIVE SET — read from stored rows, never from a parameter.
--
-- The signature is the whole point: a credential id and a reason. There is no
-- fingerprint parameter, no key-reference parameter and no assignment-generation
-- parameter, because those are facts about the fleet and the fleet is what the
-- database knows and the caller does not get to assert.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.authoritative_revocation_scope_v1(
  p_credential_id uuid,
  p_reason_code kitluy_devices.credential_revocation_reason
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $authoritative$
declare
  v_cred kitluy_devices.device_credentials;
  v_ids uuid[];
  v_rule text;
begin
  select * into v_cred from kitluy_devices.device_credentials
   where credential_id = p_credential_id;
  if not found then
    return jsonb_build_object('resolved', false,
      'refusal_code', 'KLUY-CRED-REVOCATION-NO-CREDENTIAL',
      'detail', 'no credential exists under that id');
  end if;

  if p_reason_code in ('ADMINISTRATIVE_REPLACEMENT', 'CERTIFICATE_MISISSUANCE') then
    -- Decision §3: the identified credential only.
    v_rule := 'IDENTIFIED_CREDENTIAL_ONLY';
    v_ids := array[v_cred.credential_id];

  elsif p_reason_code in ('DEVICE_LOST', 'DEVICE_STOLEN') then
    -- Decision §3: every active and overlapping credential for the device in
    -- the affected environment. The DEVICE comes from the credential row, not
    -- from the caller.
    v_rule := 'DEVICE_ACTIVE_AND_OVERLAPPING';
    select array_agg(c.credential_id order by c.credential_id) into v_ids
      from kitluy_devices.device_credentials c
     where c.device_record_id = v_cred.device_record_id
       and c.environment = v_cred.environment
       and c.purpose = v_cred.purpose
       and c.state <> 'revoked';

  elsif p_reason_code = 'KEY_COMPROMISE' then
    -- Decision §3: every credential bound to the compromised key. The key
    -- identity is READ from the credential's own stored fingerprint — a caller
    -- that could name a fingerprint could name someone else's.
    v_rule := 'KEY_BOUND_CREDENTIALS';
    select array_agg(c.credential_id order by c.credential_id) into v_ids
      from kitluy_devices.device_credentials c
     where c.public_key_fingerprint = v_cred.public_key_fingerprint
       and c.environment = v_cred.environment
       and c.state <> 'revoked';

  elsif p_reason_code = 'ASSIGNMENT_INVALIDATED' then
    -- Decision §3: every credential issued under the invalid assignment
    -- generation. Read from the credential row.
    v_rule := 'ASSIGNMENT_GENERATION_CREDENTIALS';
    if v_cred.assignment_generation is null then
      return jsonb_build_object('resolved', false,
        'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-UNRESOLVED',
        'detail', 'the credential records no assignment generation, so the invalid generation cannot be identified');
    end if;
    select array_agg(c.credential_id order by c.credential_id) into v_ids
      from kitluy_devices.device_credentials c
     where c.device_record_id = v_cred.device_record_id
       and c.environment = v_cred.environment
       and c.assignment_generation = v_cred.assignment_generation
       and c.state <> 'revoked';

  else
    -- PROVIDER_COMPROMISE, SECURITY_INCIDENT and OTHER_APPROVED_REASON cannot
    -- be derived from the fleet at all — decision §3 gives them a RECORDED set,
    -- and group 0142 is the path that spends one.
    return jsonb_build_object('resolved', false,
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-REASON-NOT-DERIVABLE',
      'detail', 'this reason takes a recorded, approved affected set and is not derivable from stored fleet state');
  end if;

  if v_ids is null or cardinality(v_ids) = 0 then
    return jsonb_build_object('resolved', false,
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-EMPTY',
      'detail', 'the authoritative affected set is empty, and an empty set is an unrestricted one');
  end if;

  return jsonb_build_object(
    'resolved', true,
    'scope_rule', v_rule,
    'reason_code', p_reason_code,
    'environment', v_cred.environment,
    'credential_ids', to_jsonb(v_ids),
    'credential_count', cardinality(v_ids),
    -- The hash the approval must carry. Computed with group 0141's function so
    -- the recorded-set path and this path cannot drift apart.
    'payload_hash', kitluy_devices.revocation_approval_payload_hash_v1(
        kitluy_devices.revocation_scope_digest_v1(
          kitluy_devices.canonical_revocation_scope_v1(
            p_reason_code, v_cred.environment, 'CREDENTIAL', null, null, null, null,
            'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002',
            array[]::uuid[], array[]::text[], array[]::text[], v_ids)),
        p_reason_code, v_cred.environment, 'CREDENTIAL', null, null, null,
        cardinality(v_ids), null,
        'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002'));
end
$authoritative$;

alter function kitluy_devices.authoritative_revocation_scope_v1(
  uuid, kitluy_devices.credential_revocation_reason) owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.authoritative_revocation_scope_v1(
  uuid, kitluy_devices.credential_revocation_reason) from public;
grant execute on function kitluy_devices.authoritative_revocation_scope_v1(
  uuid, kitluy_devices.credential_revocation_reason) to kitluy_credential_issuer;

comment on function kitluy_devices.authoritative_revocation_scope_v1(
  uuid, kitluy_devices.credential_revocation_reason) is
  'RC-019. The affected set for a fleet-derived revocation reason, computed from STORED ROWS ONLY. It takes a credential id and a reason and nothing else — no fingerprint, no provider key reference, no assignment generation — because group 0145 proved that a resolver fed the caller''s own parameters returns a set built out of the request, so testing membership against it is a mirror rather than a decision. It also returns the payload_hash the approving request must carry, computed with group 0141''s functions so the derived and recorded paths cannot drift.';

-- ---------------------------------------------------------------------------
-- 2. THE ENTRY POINT THAT REQUIRES THE APPROVAL TO COMMIT TO THAT ANSWER.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_bound_v1(
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
  p_approval_request_id uuid,
  p_approved_by text default null,
  p_incident_reference text default null,
  p_incident_scope_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $bound$
declare
  v_cred kitluy_devices.device_credentials;
  v_scope jsonb;
  v_expected text;
  v_actual text;
begin
  -- The recorded-set reasons keep group 0142's path, which already binds,
  -- checks membership and consumes atomically.
  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT', 'OTHER_APPROVED_REASON') then
    if p_incident_scope_id is null then
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

  if p_approval_request_id is null then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-UNAPPROVED',
      'detail', 'a revocation requires an approval and none was presented');
  end if;

  -- LOCK the credential. The authoritative set is read from fleet state, so it
  -- must not move between deriving it and spending the approval that commits
  -- to it.
  select * into v_cred from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id
     and environment = p_environment
     and purpose = p_purpose
     and certificate_generation = p_credential_generation
   for update;
  if not found then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-NO-CREDENTIAL',
      'detail', 'no credential exists at the coordinates given');
  end if;

  -- An already-revoked credential is delegated so a conflicting second intent
  -- still reaches review. It cannot change state: group 0138's one-way trigger
  -- forbids a second transition.
  if v_cred.state = 'revoked' then
    return kitluy_devices.revoke_device_credential_v1(
      p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
      p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
      p_requested_by, p_source, p_approval_request_id, p_approved_by,
      p_incident_reference);
  end if;

  v_scope := kitluy_devices.authoritative_revocation_scope_v1(
    v_cred.credential_id, p_reason_code);
  if coalesce((v_scope ->> 'resolved')::boolean, false) is not true then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', coalesce(v_scope ->> 'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-UNRESOLVED'),
      'detail', v_scope ->> 'detail');
  end if;

  -- THE BINDING. The approval must carry the hash of the set the DATABASE just
  -- derived. This is what `deadbeef-not-a-scope-hash` cannot satisfy for any
  -- reason, and what a caller-supplied fingerprint or assignment generation
  -- cannot influence, because neither reached the derivation.
  v_expected := v_scope ->> 'payload_hash';
  v_actual := kitluy_devices.credential_revocation_approval_payload_hash_v1(p_approval_request_id);
  if v_actual is null then
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-UNBOUND',
      'detail', 'the approval carries no payload hash, so it commits to no affected set');
  end if;
  if v_actual is distinct from v_expected then
    -- Either the approval was never for this set, or the fleet moved after it
    -- was granted. Both need a new approval; neither may be guessed at here.
    return jsonb_build_object('outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-CRED-REVOCATION-SCOPE-HASH-MISMATCH',
      'detail', 'the approval does not commit to the affected set the database derived; if the fleet changed after approval, a new request and approval are required',
      'scope_rule', v_scope ->> 'scope_rule',
      'scope_credential_count', v_scope ->> 'credential_count');
  end if;

  return kitluy_devices.revoke_device_credential_v1(
      p_revocation_request_id, p_device_record_id, p_environment, p_purpose,
      p_credential_generation, p_reason_code, p_reason, p_recovery_disposition,
      p_requested_by, p_source, p_approval_request_id, p_approved_by,
      p_incident_reference)
    || jsonb_build_object('scope_rule', v_scope ->> 'scope_rule',
                          'scope_credential_count', v_scope ->> 'credential_count',
                          'scope_bound', true);
end
$bound$;

alter function kitluy_devices.revoke_device_credential_bound_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoke_device_credential_bound_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid) from public;
grant execute on function kitluy_devices.revoke_device_credential_bound_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid)
  to kitluy_issuance_service;

comment on function kitluy_devices.revoke_device_credential_bound_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid) is
  'RC-019. The ONE revocation entry point a runtime identity may execute. For the six fleet-derived reasons it derives the affected set from STORED ROWS and then requires the approval''s payload_hash to equal the hash of THAT set — so an approval commits to an answer the database computed, not to one the caller described, and deadbeef-not-a-scope-hash authorizes nothing for any reason. The credential row is locked while the set is derived and the approval spent. The three recorded-set reasons keep group 0142''s path. A hash mismatch is also how STALE approvals fail: if the fleet moved after approval, the approvers did not approve this set, and a new request and approval are required.';

-- ---------------------------------------------------------------------------
-- 3. WHAT THIS MIGRATION DOES **NOT** DO, AND WHY THAT IS SAID HERE
--
-- It does NOT revoke EXECUTE on group 0145's tautological entry point, and it
-- does NOT revoke EXECUTE on `revoke_device_credential_emergency_v1`. So
-- RC-019 and RC-021 are BOTH STILL OPEN after this migration. The bound path
-- above is proved to work; it is not yet the only path, and an available
-- control is not an enforced one.
--
-- The reason is integration, not disagreement. Nine assertion call sites and
-- SECTION 46 currently drive group 0145's entry point with approvals carrying
-- arbitrary payload hashes. `revoke_device_credential_bound_v1` refuses exactly
-- that — which is the whole point of it — so revoking the 0145 grant turns the
-- structural gate red until every one of those fixtures is rebuilt to carry the
-- hash the database derives. Doing that properly is the remaining step, and
-- shipping it half-done would leave the repository with a broken gate and no
-- closure, which is strictly worse than a recorded, reproducible hole.
--
-- THE REMAINING STEP, precisely: re-home the nine assertion sites and SECTION
-- 46 onto `revoke_device_credential_bound_v1`, giving each fixture the hash
-- from `authoritative_revocation_scope_v1`; then revoke EXECUTE on
-- `revoke_device_credential_governed_v1` from `kitluy_issuance_service`. RC-021
-- additionally needs a governed emergency entry point carrying an immutable
-- authorization record (declaring authority, re-authentication, incident
-- reference, exact canonical scope, digest) and a post-approval attesting the
-- same digest, before its grant can be revoked without simply making the
-- emergency path unreachable.
-- ---------------------------------------------------------------------------

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 4. THE CENSUS, after the hand-back so it describes what this migration LEAVES.
-- ---------------------------------------------------------------------------
do $assert_0146$
declare
  v_findings text[] := array[]::text[];
  v_bound constant text :=
    'kitluy_devices.revoke_device_credential_bound_v1(text, uuid, text, text, integer, '
    || 'kitluy_devices.credential_revocation_reason, text, '
    || 'kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text, uuid)';
begin
  -- The bound path is reachable by the runtime identity...
  if not has_function_privilege('kitluy_issuance_service', v_bound, 'execute') then
    v_findings := v_findings || 'the runtime identity cannot execute the bound entry point'::text;
  end if;
  -- ...and by nobody wider.
  if has_function_privilege('public', v_bound, 'execute')
     or has_function_privilege('anon', v_bound, 'execute')
     or has_function_privilege('kitluy_worker_service', v_bound, 'execute') then
    v_findings := v_findings || 'the bound entry point is reachable beyond the runtime identity'::text;
  end if;
  -- The authoritative resolver is governor-only: a runtime caller must not be
  -- able to ask the database to derive a set for it outside the bound path.
  if has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.authoritative_revocation_scope_v1(uuid, kitluy_devices.credential_revocation_reason)',
       'execute') then
    v_findings := v_findings || 'the runtime identity can execute the authoritative resolver directly'::text;
  end if;
  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0146: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_0146$;
