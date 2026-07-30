-- kitluy:group:0144
-- Migration group 0144: destruction_confirmation_null_safety.
--
-- Authority: KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (KLREQ-031) §9/§12 —
--   "the database may not record a confirmed destruction without provider
--   evidence". This is the invariant the whole decision turns on, and it was
--   defeatable by a NULL.
-- Corrects: group 0137's `confirm_key_destruction_v1` and its backstop CHECK.
-- Found by: independent hostile review, 2026-07-30 (finding C-2, BLOCKING),
--   demonstrated by execution and reproduced independently before this fix.
--
-- Additive. Group 0137 is COMMITTED and is NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE HOLE, IN ONE LINE OF SQL
-- ===========================================================================
--     elsif p_provider_result not in ('DESTROYED', 'ALREADY_DESTROYED') then
--
-- In three-valued logic `NULL not in (...)` is NULL, not TRUE. So the branch
-- that rejects an unacceptable provider result NEVER FIRES for a NULL, control
-- falls through to the success path, and the function answers
--
--     {"outcome": "DESTROYED", "provider_result": null}
--
-- leaving `device_generation_keys.state = 'destroyed'`, the request `executed`,
-- and an attempt row recorded `CONFIRMED` with no failure code.
--
-- The backstop CHECK failed open the SAME way and for the same reason:
--
--     check (database_confirmed_at is null
--            or (provider_result in ('DESTROYED','ALREADY_DESTROYED') and ...))
--
-- With a NULL `provider_result` the right-hand side is NULL, `false or NULL` is
-- NULL, and a CHECK constraint is satisfied by anything that is not FALSE. Two
-- independent guards, one shared blind spot.
--
-- WHY THIS ONE IS DIFFERENT FROM GROUPS 0143 AND RC-017. Those were also
-- PostgreSQL-semantics traps, but both FAILED CLOSED — the statement aborted
-- and nothing was destroyed. This one FAILS OPEN. A provider adapter that
-- returns no result at all — a timeout, a dropped connection, a deserialisation
-- miss, a field renamed upstream — is recorded as a confirmed erasure of a
-- private key. That is precisely the outcome `key-destruction.ts` was written
-- to make impossible ("the provider returned NOT FOUND / a timeout occurred /
-- the connection failed" are the first three lines of its header), and the
-- TypeScript is correct: it never sends a NULL. The database simply never
-- refused one, so the guarantee held only as long as every future adapter is
-- as careful as the current one. An invariant that depends on its callers is
-- not an invariant.
--
-- ===========================================================================
-- WHAT CHANGED
-- ===========================================================================
--   * `coalesce(p_provider_result, '')` in the guard, so NULL takes the
--     rejecting branch and lands in MANUAL_REVIEW_REQUIRED with the rest of the
--     unacceptable results;
--   * a NEW always-on CHECK that is NULL-safe independently of
--     `database_confirmed_at`, so the table refuses the row even if a future
--     function forgets.
--
-- The function body is otherwise the LIVE group 0137 definition, extracted with
-- `pg_get_functiondef` so nothing could drift.

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

CREATE OR REPLACE FUNCTION kitluy_devices.confirm_key_destruction_v1(p_destruction_request_id uuid, p_provider_result text, p_provider_receipt_digest text, p_provider_response_ref text, p_observed_fingerprint text, p_observed_key_reference text, p_executed_by text, p_started_at timestamp with time zone, p_finished_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'kitluy_devices', 'extensions', 'pg_catalog'
AS $function$
declare
  v_req kitluy_devices.device_key_destruction_requests;
  v_review text;
begin
  select * into v_req from kitluy_devices.device_key_destruction_requests
   where destruction_request_id = p_destruction_request_id for update;
  if not found then
    raise exception 'KLUY-KEYDESTROY-NO-REQUEST: no destruction request %', p_destruction_request_id
      using errcode = 'P0001';
  end if;
  if v_req.status = 'executed' then
    return jsonb_build_object('outcome', 'ALREADY_CONFIRMED',
      'destruction_request_id', v_req.destruction_request_id);
  end if;

  -- §9: the provider must be talking about the key we asked about. A changed
  -- reference or fingerprint is a DIVERGENCE, never a success.
  if p_observed_fingerprint is distinct from v_req.public_key_fingerprint then
    v_review := 'the provider reported a different key fingerprint';
  elsif p_observed_key_reference is distinct from v_req.provider_key_reference then
    v_review := 'the provider reported a different key reference';
  elsif coalesce(p_provider_result, '') not in ('DESTROYED', 'ALREADY_DESTROYED') then
    -- §9: timeout, ambiguity or a missing key produce manual review, never
    -- assumed success.
    v_review := format('provider outcome %s is not an accepted destruction result',
                       coalesce(p_provider_result, 'NONE'));
  elsif p_provider_receipt_digest is null and p_provider_response_ref is null then
    -- §12: a local status is not proof.
    v_review := 'no provider receipt, attestation or correlatable response was retained';
  end if;

  insert into kitluy_devices.device_key_destruction_attempts (
    destruction_request_id, attempt_number, outcome, failure_code,
    provider_result, provider_receipt_digest, executed_by, started_at, finished_at)
  values (
    p_destruction_request_id, greatest(v_req.attempt_count, 1),
    case when v_review is null then 'CONFIRMED' else 'REVIEW' end,
    v_review, p_provider_result, p_provider_receipt_digest,
    p_executed_by, p_started_at, p_finished_at);

  if v_review is not null then
    update kitluy_devices.device_key_destruction_requests
       set status = 'manual_review', manual_review_reason = v_review,
           last_failure_code = 'PROVIDER_EVIDENCE_INSUFFICIENT',
           last_failure_at = clock_timestamp(), updated_at = clock_timestamp()
     where destruction_request_id = p_destruction_request_id;
    return jsonb_build_object('outcome', 'MANUAL_REVIEW_REQUIRED', 'detail', v_review);
  end if;

  update kitluy_devices.device_key_destruction_requests
     set status = 'executed',
         provider_result = p_provider_result,
         provider_receipt_digest = p_provider_receipt_digest,
         provider_response_ref = p_provider_response_ref,
         provider_confirmed_at = clock_timestamp(),
         database_confirmed_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where destruction_request_id = p_destruction_request_id;

  -- ONLY NOW. §12: the database follows verified provider evidence; it never
  -- leads it.
  update kitluy_devices.device_generation_keys
     set state = 'destroyed', destroyed_at = clock_timestamp()
   where device_record_id = v_req.device_record_id
     and environment = v_req.environment
     and key_handle = v_req.provider_key_reference;

  return jsonb_build_object('outcome', 'DESTROYED',
    'destruction_request_id', v_req.destruction_request_id,
    'provider_result', p_provider_result);
end
$function$;

alter function kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  owner to kitluy_credential_issuer;
revoke all on function
  kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz) from public;
grant execute on function
  kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz)
  to kitluy_issuance_service;

-- The second guard, stated so it cannot be skipped by a future function.
-- Deliberately NOT conditioned on `database_confirmed_at`: a stored
-- `provider_result` that is neither accepted value is wrong whether or not the
-- row has been confirmed yet, and conditioning it is what let the original
-- CHECK evaluate to NULL.
do $add_check$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'device_key_destruction_provider_result_chk') then
    alter table kitluy_devices.device_key_destruction_requests
      add constraint device_key_destruction_provider_result_chk
      check (provider_result is null
             or provider_result in ('DESTROYED', 'ALREADY_DESTROYED'));
  end if;
  -- ...and a confirmed row must carry one of them, NULL-safely.
  if not exists (select 1 from pg_constraint
                  where conname = 'device_key_destruction_confirmed_needs_result_chk') then
    alter table kitluy_devices.device_key_destruction_requests
      add constraint device_key_destruction_confirmed_needs_result_chk
      check (database_confirmed_at is null
             or coalesce(provider_result, '') in ('DESTROYED', 'ALREADY_DESTROYED'));
  end if;
end
$add_check$;

comment on function kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz) is
  'KLREQ-031 §9/§12 destruction confirmation. Group 0144 corrects group 0137: the guard read `p_provider_result not in (...)`, which is NULL rather than TRUE for a NULL input, so a provider adapter returning no result at all was recorded as a confirmed erasure — outcome DESTROYED, key state destroyed, attempt CONFIRMED. The backstop CHECK failed open identically, because a CHECK is satisfied by anything that is not FALSE. Found by independent hostile review. The guard is now coalesce-wrapped and two NULL-safe table constraints stand behind it.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- A CLAIM WITHDRAWN — independent review finding C-1 (BLOCKING, OPEN).
--
-- Group 0142's comment says its function is "The ONLY path by which a
-- recorded-scope reason (PROVIDER_COMPROMISE, SECURITY_INCIDENT,
-- OTHER_APPROVED_REASON) may revoke". That is FALSE and the review proved it by
-- execution: group 0139's `revoke_device_credential_v1` is still EXECUTE-granted
-- to `kitluy_issuance_service`, accepts all three of those reasons, and takes no
-- scope argument at all. A revocation was driven through it with zero recorded
-- scopes, zero consumption rows, and an approval whose payload_hash was the
-- literal string 'deadbeef-not-a-scope-hash' — because
-- `evaluate_credential_revocation_approval_v1` never reads payload_hash.
--
-- 0142 added a door without removing the old one. Everything groups 0141 and
-- 0142 built is therefore OPTIONAL for the only role that can call either.
--
-- The comment is corrected HERE rather than left standing, because a false
-- comment on a security control is worse than no comment: it tells the next
-- reader the hole cannot exist. The HOLE ITSELF IS NOT CLOSED by this
-- migration — closing it means revoking EXECUTE on the unscoped function from
-- `kitluy_issuance_service` and giving the six fleet-derived reasons their own
-- entry point, which changes the call surface every existing assertion and live
-- test uses. That is recorded as RC-019 and is a BLOCKER on promotion.
-- ---------------------------------------------------------------------------
comment on function kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
  text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text) is
  'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1, the call site. Three checks in order, each failing closed: the approval cryptographically commits to the exact recorded scope; the credential being revoked is a MEMBER of that scope; and the scope is CONSUMED in the same transaction, raising rather than returning if consumption loses a race, so the revocation rolls back with it. Group 0139''s revoke_device_credential_v1 is CALLED, not reimplemented. CORRECTION (group 0144, independent review finding C-1): this is NOT the only path by which a recorded-scope reason may revoke, as this comment previously claimed. kitluy_issuance_service still holds EXECUTE on the unscoped revoke_device_credential_v1, which accepts PROVIDER_COMPROMISE, SECURITY_INCIDENT and OTHER_APPROVED_REASON with no scope argument and no binding check — proved by execution. Until that EXECUTE is revoked and the fleet-derived reasons are given their own entry point (RC-019), the guarantees below are available but not mandatory.';
