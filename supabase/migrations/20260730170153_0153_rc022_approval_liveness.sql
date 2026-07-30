-- kitluy:group:0153
-- Migration group 0153: rc022_approval_liveness_and_census_support.
--
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001; RC-022.
-- Phase C: a recorded set whose cited approval is no longer APPROVED cannot
-- authorize an emergency (or any other) spend. Closes the gap where REJECTING
-- leftover test approvals would still leave emergency able to consume the set.
--
-- Additive. Groups 0136-0152 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. APPROVAL LIVENESS BRIDGE (reader-owned; no table grant to issuer)
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.emergency_approval_still_approved_v1(
  p_approval_request_id uuid
) returns boolean
language sql
stable
security definer
set search_path = pg_catalog, kitluy_auth
as $live$
  select exists (
    select 1
      from kitluy_auth.approval_requests r
     where r.id = p_approval_request_id
       and r.status = 'APPROVED'
       and (r.expires_at is null or r.expires_at > clock_timestamp())
  );
$live$;

grant create on schema kitluy_devices to kitluy_credential_approval_reader;
alter function kitluy_devices.emergency_approval_still_approved_v1(uuid)
  owner to kitluy_credential_approval_reader;
revoke create on schema kitluy_devices from kitluy_credential_approval_reader;

revoke all on function kitluy_devices.emergency_approval_still_approved_v1(uuid) from public;
grant execute on function kitluy_devices.emergency_approval_still_approved_v1(uuid)
  to kitluy_credential_issuer;

comment on function kitluy_devices.emergency_approval_still_approved_v1(uuid) is
  'RC-022 / Phase C. Narrow bridge: is the cited approval still APPROVED and unexpired? Owned by kitluy_credential_approval_reader so the credential governor never gains SELECT on kitluy_auth.approval_requests.';

-- ---------------------------------------------------------------------------
-- 2. GOVERNED EMERGENCY: refuse a recorded set whose approval is dead
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  p_credential_id uuid,
  p_reason_code kitluy_devices.credential_revocation_reason,
  p_explanation text,
  p_incident_reference text,
  p_reauth_evidence_id uuid,
  p_idempotency_key text,
  p_incident_scope_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $governed_emergency$
declare
  c_permission constant text := 'fleet.device_credential.emergency_revoke';
  c_decision constant text := 'KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001';
  c_source constant text := 'GOVERNED_EMERGENCY_RPC';
  c_disposition constant kitluy_devices.credential_recovery_disposition
    := 'MANUAL_SECURITY_REVIEW';

  v_actor uuid;
  v_cred kitluy_devices.device_credentials;
  v_env text;
  v_scope jsonb;
  v_ids uuid[];
  v_digest text;
  v_prior kitluy_devices.device_emergency_revocation_authorizations;
  v_authorization uuid;
  v_window integer;
  v_now timestamptz;
  v_due timestamptz;
  v_tenant uuid;
  v_store uuid;
  v_location uuid;
  v_tenancy jsonb;
  v_target kitluy_devices.device_credentials;
  v_row kitluy_devices.device_credential_revocations;
  v_revoked integer := 0;
  v_id uuid;
  v_recorded kitluy_devices.revocation_recorded_scopes;
  v_recomputed text;
  v_consumption jsonb;
  v_first_revocation uuid;
begin
  v_actor := kitluy_devices.emergency_revocation_actor_v1();
  if v_actor is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR',
      'detail', 'an emergency revocation is executed by a named authenticated human');
  end if;

  if p_reason_code not in ('KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN',
                           'PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE',
      'detail', format('decision §2.1 requires a completed prior approval for %s', p_reason_code));
  end if;

  if coalesce(btrim(p_explanation), '') = ''
     or coalesce(btrim(p_incident_reference), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-INCOMPLETE',
      'detail', 'decision §2.3 requires a mandatory reason and an incident reference');
  end if;
  if coalesce(btrim(p_idempotency_key), '') = '' then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-IDEMPOTENCY-KEY',
      'detail', 'an emergency declaration is identified so a retry cannot open a second emergency');
  end if;
  if p_reauth_evidence_id is null then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-REAUTHENTICATION',
      'detail', 'decision §2.3 requires re-authentication evidence');
  end if;

  select * into v_cred from kitluy_devices.device_credentials
   where credential_id = p_credential_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-CREDENTIAL',
      'detail', 'no credential exists under that id');
  end if;
  v_env := v_cred.environment;

  if not kitluy_devices.emergency_revocation_permitted_v1(p_credential_id, v_env) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-UNAUTHORIZED',
      'detail', format('the authenticated human does not hold %s for this credential in %s',
                       c_permission, v_env));
  end if;

  v_tenancy := kitluy_devices.emergency_device_tenancy_v1(v_cred.device_record_id);
  v_tenant := nullif(v_tenancy ->> 'tenant_id', '')::uuid;
  v_store := nullif(v_tenancy ->> 'digital_store_id', '')::uuid;
  v_location := nullif(v_tenancy ->> 'store_location_id', '')::uuid;

  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    if p_incident_scope_id is null then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISSING',
        'detail', 'decision §3 requires a recorded incident-defined affected set');
    end if;
    select * into v_recorded
      from kitluy_devices.revocation_recorded_scopes
     where incident_scope_id = p_incident_scope_id;
    if not found then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISSING',
        'detail', format('recorded scope %s does not exist', p_incident_scope_id));
    end if;
    if v_recorded.environment is distinct from v_env
       or v_recorded.reason_code is distinct from p_reason_code then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISMATCH',
        'detail', 'the recorded scope does not match this emergency reason/environment');
    end if;
    if v_recorded.incident_reference is distinct from p_incident_reference then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-MISMATCH',
        'detail', 'the recorded scope is bound to a different incident reference');
    end if;
    if coalesce(v_recorded.identifier_count, 0) = 0 or v_recorded.unrestricted_wildcard then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
        'detail', 'an empty or unrestricted recorded set is refused');
    end if;
    if v_recorded.approval_request_id is null then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-NO-APPROVAL',
        'detail', 'Ruling 1 consumption requires the recorded set to cite the approval that bound it');
    end if;
    -- RC-022: a REJECTED / expired / otherwise non-APPROVED citation is dead.
    if not kitluy_devices.emergency_approval_still_approved_v1(v_recorded.approval_request_id) then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-APPROVAL-DEAD',
        'detail', 'the approval cited by this recorded set is no longer APPROVED');
    end if;
    v_recomputed := kitluy_devices.revocation_scope_digest_v1(
      kitluy_devices.canonical_revocation_scope_v1(
        v_recorded.reason_code, v_recorded.environment, v_recorded.subject_type,
        v_recorded.tenant_id, v_recorded.digital_store_id, v_recorded.store_location_id,
        v_recorded.requester_ref, v_recorded.decision_version,
        v_recorded.affected_device_ids, v_recorded.affected_key_references,
        v_recorded.affected_fingerprints, v_recorded.affected_credential_ids));
    if v_recomputed is distinct from v_recorded.scope_digest then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-DIGEST-MISMATCH',
        'detail', 'the recorded scope does not hash to its own stored digest');
    end if;
    if not (p_credential_id = any (coalesce(v_recorded.affected_credential_ids, array[]::uuid[]))) then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-IN-SET',
        'detail', 'the recorded affected set does not contain the credential this emergency names');
    end if;
    select array_agg(x order by x) into v_ids
      from unnest(v_recorded.affected_credential_ids) as x
      join kitluy_devices.device_credentials c on c.credential_id = x
     where c.state <> 'revoked';
    v_ids := coalesce(v_ids, array[]::uuid[]);
    if cardinality(v_ids) = 0 then
      return jsonb_build_object(
        'outcome', 'EMERGENCY_REFUSED',
        'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
        'detail', 'every member of the recorded set is already revoked');
    end if;
    v_digest := v_recorded.scope_digest;
    v_tenant := coalesce(v_recorded.tenant_id, v_tenant);
    v_store := coalesce(v_recorded.digital_store_id, v_store);
    v_location := coalesce(v_recorded.store_location_id, v_location);
    v_scope := jsonb_build_object(
      'resolved', true,
      'scope_rule', 'RECORDED_INCIDENT_DEVICE_KEY_CREDENTIAL_SET',
      'credential_ids', to_jsonb(v_ids),
      'credential_count', cardinality(v_ids));
  else
    v_scope := kitluy_devices.authoritative_revocation_scope_v1(p_credential_id, p_reason_code);
  end if;

  select * into v_prior
    from kitluy_devices.device_emergency_revocation_authorizations
   where idempotency_key = p_idempotency_key;

  if coalesce((v_scope ->> 'resolved')::boolean, false) is not true then
    if v_prior.authorization_id is not null
       and v_prior.actor_user_id = v_actor
       and v_prior.reason_code = p_reason_code
       and v_prior.environment = v_env
       and exists (select 1 from kitluy_devices.device_emergency_revocation_scope s
                    where s.authorization_id = v_prior.authorization_id
                      and s.credential_id = p_credential_id) then
      return jsonb_build_object(
        'outcome', 'ALREADY_AUTHORIZED',
        'authorization_id', v_prior.authorization_id,
        'revoked_credential_count', v_prior.identifier_count,
        'post_approval_due_at', to_char(v_prior.post_approval_due_at at time zone 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', 'this idempotency key already authorized this emergency');
    end if;
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', coalesce(v_scope ->> 'refusal_code', 'KLUY-EMERGENCY-SCOPE-UNRESOLVED'),
      'detail', v_scope ->> 'detail');
  end if;

  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    select array_agg(value::uuid order by value::uuid) into v_ids
      from jsonb_array_elements_text(v_scope -> 'credential_ids');
    v_ids := coalesce(v_ids, array[]::uuid[]);
  end if;

  if cardinality(v_ids) = 0 then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-EMPTY',
      'detail', 'the authoritative affected set is empty');
  end if;
  if not (p_credential_id = any (v_ids)) then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-SCOPE-NOT-IN-SET',
      'detail', 'the authoritative affected set does not contain the named credential');
  end if;

  if p_reason_code not in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    v_digest := kitluy_devices.revocation_scope_digest_v1(
      kitluy_devices.canonical_revocation_scope_v1(
        p_reason_code, v_env, 'CREDENTIAL', v_tenant, v_store, v_location,
        v_actor::text, c_decision,
        array[]::uuid[], array[]::text[], array[]::text[], v_ids));
  end if;

  if v_prior.authorization_id is not null then
    if v_prior.scope_digest = v_digest then
      return jsonb_build_object(
        'outcome', 'ALREADY_AUTHORIZED',
        'authorization_id', v_prior.authorization_id,
        'revoked_credential_count', v_prior.identifier_count,
        'post_approval_due_at', to_char(v_prior.post_approval_due_at at time zone 'UTC',
                                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'note', 'this idempotency key already authorized this emergency');
    end if;
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-CONFLICTING-REPLAY',
      'detail', 'this idempotency key already authorized a DIFFERENT affected set');
  end if;

  select post_approval_window_hours into v_window
    from kitluy_devices.credential_revocation_policy
   where environment = v_env;
  if v_window is null or v_window <= 0 then
    return jsonb_build_object(
      'outcome', 'EMERGENCY_REFUSED',
      'refusal_code', 'KLUY-EMERGENCY-NO-POLICY',
      'detail', format('no post-approval window is configured for %s', v_env));
  end if;

  v_now := clock_timestamp();
  v_due := v_now + make_interval(hours => v_window);

  insert into kitluy_devices.device_emergency_revocation_authorizations (
    actor_user_id, permission_key, reauth_evidence_id, reason_code, explanation,
    incident_reference, environment, tenant_id, digital_store_id, store_location_id,
    subject_type, identifier_count, scope_digest, decision_version,
    idempotency_key, executed_at, post_approval_due_at)
  values (
    v_actor, c_permission, p_reauth_evidence_id, p_reason_code, p_explanation,
    p_incident_reference, v_env, v_tenant, v_store, v_location,
    'CREDENTIAL', cardinality(v_ids), v_digest, c_decision,
    p_idempotency_key, v_now, v_due)
  returning authorization_id into v_authorization;

  insert into kitluy_devices.device_emergency_revocation_scope (authorization_id, credential_id)
  select v_authorization, m.id from unnest(v_ids) as m(id);

  foreach v_id in array v_ids loop
    select * into v_target from kitluy_devices.device_credentials
     where credential_id = v_id
     for update;
    if v_target.state = 'revoked' then
      continue;
    end if;

    insert into kitluy_devices.device_credential_revocations (
      revocation_request_id, credential_id, device_record_id, environment, purpose,
      credential_generation, public_key_fingerprint, reason_code, reason,
      requested_by, source, incident_reference, recovery_disposition, scope_rule,
      emergency_authorization_id)
    values (
      format('EMG-%s#%s', v_authorization, v_id), v_id, v_target.device_record_id,
      v_target.environment, v_target.purpose, v_target.certificate_generation,
      v_target.public_key_fingerprint, p_reason_code, p_explanation,
      v_actor::text, c_source, p_incident_reference, c_disposition,
      v_scope ->> 'scope_rule', v_authorization)
    returning * into v_row;

    if v_first_revocation is null then
      v_first_revocation := v_row.revocation_id;
    end if;

    update kitluy_devices.device_credentials
       set state = 'revoked',
           revoked_at = clock_timestamp(),
           revocation_reason = format('%s: %s', p_reason_code, p_explanation)
     where credential_id = v_id;

    insert into kitluy_devices.device_recovery_cases (
      revocation_id, device_record_id, environment, purpose, disposition)
    values (v_row.revocation_id, v_target.device_record_id, v_target.environment,
            v_target.purpose, c_disposition);

    v_revoked := v_revoked + 1;
  end loop;

  if p_reason_code in ('PROVIDER_COMPROMISE', 'SECURITY_INCIDENT') then
    if v_revoked = 0 or v_first_revocation is null then
      raise exception
        'KLUY-EMERGENCY-SCOPE-CONSUME-FAILED: nothing was revoked, so the recorded scope is not consumed'
        using errcode = 'P0001';
    end if;
    v_consumption := kitluy_devices.consume_revocation_scope_v1(
      p_incident_scope_id,
      v_recorded.approval_request_id,
      v_first_revocation,
      v_env,
      format('emergency_governed:%s', v_actor));
    if coalesce(v_consumption ->> 'outcome', '') <> 'CONSUMED' then
      raise exception
        'KLUY-CRED-REVOCATION-SCOPE-CONSUMED: this recorded scope or approval has already authorized a revocation (%)',
        coalesce(v_consumption ->> 'detail', 'no detail')
        using errcode = 'unique_violation';
    end if;
  end if;

  if not kitluy_devices.emergency_revocation_reauth_spend_v1(
           p_reauth_evidence_id, v_env, v_authorization) then
    raise exception
      'KLUY-EMERGENCY-REAUTHENTICATION-REFUSED: the re-authentication evidence presented is not spendable for %',
      c_permission
      using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'outcome', 'REVOKED_IMMEDIATELY',
    'authorization_id', v_authorization,
    'revoked_credential_count', v_revoked,
    'post_approval_due_at', to_char(v_due at time zone 'UTC',
                                    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'post_approval_decision', 'PENDING',
    'note', 'decision §2.4: a late, missing or refused post-approval does NOT restore these credentials');
end
$governed_emergency$;

alter function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid) from public;
grant execute on function kitluy_devices.revoke_device_credential_emergency_governed_v1(
  uuid, kitluy_devices.credential_revocation_reason, text, text, uuid, text, uuid)
  to authenticated;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);
end
$hand_back$;
