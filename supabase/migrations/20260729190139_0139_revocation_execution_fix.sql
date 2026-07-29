-- kitluy:group:0139
-- Migration group 0139: revocation_execution_fix (WS-11-T003 Step 4 defect fix).
--
-- Additive. Groups 0125-0138 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE DEFECT — `revoke_device_credential_v1` CANNOT COMPLETE A REVOCATION
-- ===========================================================================
-- Group 0138 recorded the first half of this as an out-of-scope finding
-- (0138 header, "RECORDED FINDING — OUT OF SCOPE, NOT FIXED HERE"). Both halves
-- are fixed here, together, because either one alone still leaves the governed
-- approve-before-execute revocation path non-functional.
--
-- CAUSE 1 — the credential write violates its own CHECK.
--
--   Group 0136 ends with
--       update kitluy_devices.device_credentials set state = 'revoked' ...
--   and never writes `revoked_at`. Group 0125 constrains that table with
--       device_credentials_revoked_chk
--         CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))
--   so every call raises a check-constraint violation. `revocation_reason` was
--   likewise never written, leaving the credential row with no account of
--   itself. Group 0138's emergency path already writes both columns; this group
--   brings the approve-before-execute path to the same standard rather than
--   inventing a second convention.
--
-- CAUSE 2 — the approval gate runs under an identity that cannot read approvals.
--
--   `evaluate_credential_revocation_approval_v1` shipped `language plpgsql
--   stable` with NO `security definer`. Reached from inside
--   `revoke_device_credential_v1` — which IS a definer owned by
--   `kitluy_credential_issuer` — it executes as the credential governor, which
--   holds neither USAGE on `kitluy_auth` nor SELECT on its tables. Every
--   four-eyes revocation therefore died with
--       permission denied for schema kitluy_auth
--   BEFORE the CHECK in cause 1 was ever reached.
--
-- Both were verified by CALLING the function against the migrated local
-- database, which is the step group 0136 skipped: its hostile assertions
-- inspected grants, constraints and triggers and never executed a revocation.
-- The assertion block at the foot of this migration performs a COMPLETE
-- end-to-end revocation for exactly that reason.
--
-- ===========================================================================
-- HOW GROUP 0124 READS THE SAME APPROVAL AGGREGATE, AND WHY THIS MIRRORS IT
-- ===========================================================================
-- `kitluy_auth.approval_requests`, `approval_policies` and `approval_decisions`
-- are RLS ENABLED and FORCED and owned by `postgres`. Measured against the live
-- database:
--
--   * the only SELECT policies on them are `TO authenticated`; there is no
--     policy for `service_role` and none for `postgres`;
--   * a role holding USAGE on `kitluy_auth` and SELECT on `approval_requests`
--     but no BYPASSRLS reads ZERO rows (measured: 0 of 7);
--   * `service_role` and `postgres` read all 7, and the only thing that
--     distinguishes them is the `rolbypassrls` ROLE ATTRIBUTE.
--
-- Group 0124's `emergency_time_correction_v1` and
-- `evaluate_time_correction_approval_v1` are SECURITY INVOKER (`prosecdef` is
-- false for both). They therefore run as the CALLER, and the only role granted
-- EXECUTE on them is `service_role` — a NOLOGIN role carrying BYPASSRLS. That,
-- and nothing else, is what makes group 0124's approval read work. It is not a
-- policy, and it is not a grant to any device role.
--
-- So the faithful mirror for revocation is: THE APPROVAL READ RUNS AS
-- `service_role`, exactly as it does for a time correction. Since
-- `revoke_device_credential_v1` must stay a governor-owned definer (only
-- `kitluy_credential_issuer` may write `device_credentials`), the identity is
-- pinned by making the GATE a SECURITY DEFINER owned by `service_role`, with a
-- fixed search_path, EXECUTE-able only by the credential governor.
--
-- What this deliberately does NOT do:
--
--   * it grants the credential governor NOTHING on `kitluy_auth` — the
--     permanent assertion in section 41a (and group 0138's own assertion) still
--     finds `has_table_privilege('kitluy_credential_issuer',
--     'kitluy_auth.approval_requests', ...)` false in all four modes;
--   * it adds NO RLS policy anywhere, so the section 7 SELECT-policy census is
--     untouched at 58 — widening the kitluy_auth RLS surface is the boundary
--     change group 0138 said would need its own owner decision, and this fix
--     does not need it;
--   * it weakens no four-eyes rule. Every refusal group 0136 wrote is still
--     evaluated, and this migration proves each of them by calling it.
--
-- The definer owner is `service_role` rather than a dedicated NOLOGIN reader
-- because a dedicated reader cannot be made to work without one of the two
-- things above: BYPASSRLS (which `postgres` cannot grant — it is not a
-- superuser in this stack) or a new SELECT policy on `kitluy_auth`. `postgres`
-- itself is refused as an owner by the section 32b definer-hygiene assertion,
-- correctly: group 0126 moved definers OFF `postgres` because it is
-- LOGIN-CAPABLE. `service_role` is NOLOGIN, and it is the identity that already
-- performs this exact read for group 0124. Recorded for the owner in the
-- handoff, with the alternative, in case a dedicated reader is preferred later.

begin;

-- The migration role borrows the credential governor so it can CREATE OR
-- REPLACE functions the governor owns. Handed back before commit (groups
-- 0134/0136/0137/0138 do the same); section 32's containment assertion refuses
-- a migration that keeps it.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- FIX 2 (first, because fix 1 is unreachable until the gate can answer).
--
-- The body is group 0136's, unchanged in every judgement it makes. What changes
-- is the identity it makes them under.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.evaluate_credential_revocation_approval_v1(
  p_approval_request_id uuid,
  p_device_id uuid,
  p_environment text,
  p_requester_ref text
) returns kitluy_devices.approval_verdict
language plpgsql
stable
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $evaluate$
declare
  v_request kitluy_auth.approval_requests;
  v_policy kitluy_auth.approval_policies;
  v_approvers integer;
  v_self integer;
  v_deny constant text := 'KLUY-CRED-REVOCATION-';
begin
  if p_approval_request_id is null then
    return row(false, v_deny || 'UNAPPROVED',
      'this revocation requires an approval and none was presented')::kitluy_devices.approval_verdict;
  end if;

  select * into v_request from kitluy_auth.approval_requests where id = p_approval_request_id;
  if not found then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request %s does not exist', p_approval_request_id))::kitluy_devices.approval_verdict;
  end if;

  select * into v_policy from kitluy_auth.approval_policies where id = v_request.policy_id;

  -- An UNDECLARED risk class is insufficient, not permissive. Group 0124's
  -- ruling, applied to the same aggregate.
  if coalesce(v_policy.risk_class, 'A0') not in ('A3', 'A4') then
    return row(false, v_deny || 'RISK-CLASS',
      format('approval policy risk class %s is below the A3/A4 a credential revocation requires',
             coalesce(v_policy.risk_class, 'undeclared')))::kitluy_devices.approval_verdict;
  end if;

  if v_request.action <> 'device_credential_revocation' then
    return row(false, v_deny || 'WRONG-ACTION',
      format('approval authorizes %s, not device_credential_revocation', v_request.action))::kitluy_devices.approval_verdict;
  end if;
  if v_request.environment <> p_environment then
    return row(false, v_deny || 'WRONG-SCOPE',
      format('approval is scoped to environment %s, not %s', v_request.environment, p_environment))::kitluy_devices.approval_verdict;
  end if;
  if v_request.resource_id is distinct from p_device_id then
    return row(false, v_deny || 'WRONG-SCOPE',
      'approval does not name this device')::kitluy_devices.approval_verdict;
  end if;
  if v_request.status <> 'APPROVED' then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval request is %s', v_request.status))::kitluy_devices.approval_verdict;
  end if;
  if v_request.expires_at is not null and v_request.expires_at <= now() then
    return row(false, v_deny || 'UNAPPROVED',
      format('approval expired at %s', v_request.expires_at))::kitluy_devices.approval_verdict;
  end if;

  -- Four eyes derived from the immutable decision rows, never a mutable flag.
  select count(*) filter (where d.decision = 'APPROVE'),
         count(*) filter (where d.decision = 'APPROVE' and d.approver_id = v_request.requester_id)
  into v_approvers, v_self
  from kitluy_auth.approval_decisions d
  where d.approval_request_id = p_approval_request_id;

  if v_self > 0 then
    return row(false, v_deny || 'SELF-APPROVED',
      'the requester approved their own credential revocation')::kitluy_devices.approval_verdict;
  end if;
  if v_approvers < coalesce(v_policy.quorum, 1) then
    return row(false, v_deny || 'UNAPPROVED',
      format('%s approver(s) recorded, policy requires %s',
             v_approvers, coalesce(v_policy.quorum, 1)))::kitluy_devices.approval_verdict;
  end if;

  -- Single use. An approval is authority for ONE revocation.
  if exists (select 1 from kitluy_devices.device_credential_revocations
              where approval_request_id = p_approval_request_id) then
    return row(false, v_deny || 'APPROVAL-CONSUMED',
      'this approval has already authorized a revocation')::kitluy_devices.approval_verdict;
  end if;

  return row(true, null, null)::kitluy_devices.approval_verdict;
end
$evaluate$;

-- `alter function ... owner to` requires the INCOMING owner to hold CREATE on
-- the containing schema (the constraint group 0126 hit and documented). It is
-- granted for the statement and revoked immediately: service_role must not keep
-- the ability to create objects in kitluy_devices, and it held none before.
grant create on schema kitluy_devices to service_role;
alter function kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  owner to service_role;
revoke create on schema kitluy_devices from service_role;

-- PostgreSQL grants EXECUTE to PUBLIC on creation and a later GRANT does not
-- revoke it; the definer-hygiene assertion checks exactly this.
revoke all on function
  kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  from public;
-- The ONLY caller is revoke_device_credential_v1, whose definer identity is the
-- credential governor. Nothing else is granted, so the widened read is reachable
-- only from inside the governed revocation path.
grant execute on function
  kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)
  to kitluy_credential_issuer;

comment on function kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text) is
  'Database-side four-eyes gate for credential revocation, against the SAME kitluy_auth approval aggregate group 0124 uses. Every judgement is group 0136''s, unchanged: A3/A4 risk class (undeclared is insufficient), action, device and environment scope, APPROVED status, unexpired window, non-self-approval, quorum from immutable decision rows, single-use consumption. Group 0139 changed only the IDENTITY: SECURITY DEFINER owned by the NOLOGIN service_role with a fixed search_path, because the approval tables are RLS FORCED and only a BYPASSRLS role reads them — which is precisely how group 0124''s SECURITY INVOKER gate reads them when service_role calls it. Owning the gate this way grants the credential governor NOTHING on kitluy_auth and adds no RLS policy; it returns a verdict, never approval rows.';

-- ---------------------------------------------------------------------------
-- FIX 1 — the derived state the verifier reads is written with the timestamp
-- its CHECK requires, and with the account of itself.
--
-- Identical to group 0136 in every other respect: same signature, same
-- ordering, same refusals, same return shape. `create or replace` keeps the
-- owner (kitluy_credential_issuer) and the existing grants.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_device_credential_v1(
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
  p_incident_reference text default null
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $revoke$
declare
  v_cred kitluy_devices.device_credentials;
  v_policy kitluy_devices.credential_revocation_policy;
  v_existing kitluy_devices.device_credential_revocations;
  v_verdict kitluy_devices.approval_verdict;
  v_row kitluy_devices.device_credential_revocations;
  v_case uuid;
  v_needs_approval boolean;
begin
  if coalesce(btrim(p_revocation_request_id), '') = '' then
    raise exception 'KLUY-REVOKE-NO-REQUEST-ID: a revocation intent is identified so a retry is idempotent'
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_requested_by), '') = '' or coalesce(btrim(p_source), '') = '' then
    raise exception 'KLUY-REVOKE-INCOMPLETE: a revocation names its requester and its source'
      using errcode = 'P0001';
  end if;

  select * into v_policy from kitluy_devices.credential_revocation_policy
   where environment = p_environment;
  if not found then
    raise exception 'KLUY-REVOKE-NO-POLICY: no revocation policy for environment %', p_environment
      using errcode = 'P0001';
  end if;
  if v_policy.reason_required and coalesce(btrim(p_reason), '') = '' then
    raise exception 'KLUY-REVOKE-NO-REASON: this environment requires a reason for revocation'
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENCE FIRST, before any authorization work: replaying the same
  -- intent must be cheap and must not consume a second approval.
  select * into v_existing from kitluy_devices.device_credential_revocations
   where revocation_request_id = p_revocation_request_id;
  if found then
    return jsonb_build_object(
      'outcome', 'ALREADY_REVOKED',
      'revocation_id', v_existing.revocation_id,
      'credential_id', v_existing.credential_id,
      'reason_code', v_existing.reason_code,
      'recovery_disposition', v_existing.recovery_disposition);
  end if;

  -- The credential is resolved from the DEVICE and GENERATION, never accepted
  -- from the caller. A revocation that could name its own credential id could
  -- repudiate another device's credential.
  select * into v_cred from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id
     and environment = p_environment
     and purpose = p_purpose
     and certificate_generation = p_credential_generation;
  if not found then
    raise exception
      'KLUY-REVOKE-NO-CREDENTIAL: device % has no generation % credential for %/%',
      p_device_record_id, p_credential_generation, p_environment, p_purpose
      using errcode = 'P0001';
  end if;

  -- A DIFFERENT intent against an already-revoked credential is a conflict.
  -- The first account of why a credential was repudiated is not overwritten by
  -- the second person to notice.
  if v_cred.state = 'revoked' then
    select * into v_existing from kitluy_devices.device_credential_revocations
     where credential_id = v_cred.credential_id order by sequence_no limit 1;
    return jsonb_build_object(
      'outcome', 'MANUAL_REVIEW_REQUIRED',
      'refusal_code', 'KLUY-REVOKE-CONFLICTING-REASON',
      'detail', format('credential %s is already revoked as %s; a second revocation with a different intent needs review',
                       v_cred.credential_id, v_existing.reason_code),
      'revocation_id', v_existing.revocation_id,
      'credential_id', v_cred.credential_id);
  end if;

  v_needs_approval := v_policy.four_eyes_required
    and not (p_reason_code = any (v_policy.four_eyes_exempt_reasons));

  if v_needs_approval then
    v_verdict := kitluy_devices.evaluate_credential_revocation_approval_v1(
      p_approval_request_id, p_device_record_id, p_environment, p_requested_by);
    if not v_verdict.authorized then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', v_verdict.refusal_code,
        'detail', v_verdict.refusal_message,
        'credential_id', v_cred.credential_id);
    end if;
    if coalesce(btrim(p_approved_by), '') = '' then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', 'KLUY-CRED-REVOCATION-NO-APPROVER',
        'detail', 'the approving identity must be recorded on the evidence',
        'credential_id', v_cred.credential_id);
    end if;
    if btrim(p_approved_by) = btrim(p_requested_by) then
      return jsonb_build_object(
        'outcome', 'REVOCATION_REFUSED',
        'refusal_code', 'KLUY-CRED-REVOCATION-SELF-APPROVED',
        'detail', 'the requester and approver must be different people',
        'credential_id', v_cred.credential_id);
    end if;
  end if;

  insert into kitluy_devices.device_credential_revocations (
    revocation_request_id, credential_id, device_record_id, environment, purpose,
    credential_generation, public_key_fingerprint, reason_code, reason,
    requested_by, approved_by, approval_request_id, approved_at,
    source, incident_reference, recovery_disposition)
  values (
    p_revocation_request_id, v_cred.credential_id, p_device_record_id, p_environment, p_purpose,
    v_cred.certificate_generation, v_cred.public_key_fingerprint, p_reason_code, p_reason,
    p_requested_by, p_approved_by, p_approval_request_id,
    case when p_approved_by is null then null else clock_timestamp() end,
    p_source, p_incident_reference, p_recovery_disposition)
  returning * into v_row;

  -- The DERIVED current fact the verifier reads on the hot path. The evidence
  -- above is what explains it.
  --
  -- GROUP 0139: `revoked_at` and `revocation_reason` are written HERE, with the
  -- state, in one statement. Group 0125 pairs `state = 'revoked'` with
  -- `revoked_at IS NOT NULL` by CHECK, so a state written without its timestamp
  -- is not a partial revocation — it is a failed one, and every call made
  -- before this fix raised device_credentials_revoked_chk. Server time
  -- (clock_timestamp), matching `effective_at` on the evidence row and group
  -- 0138's emergency path: this is an operator decision, not a device trust
  -- decision, and routing it through a device clock would let a device with a
  -- manipulated clock argue about when it was repudiated.
  update kitluy_devices.device_credentials
     set state = 'revoked',
         revoked_at = clock_timestamp(),
         revocation_reason = format('%s: %s', p_reason_code, p_reason)
   where credential_id = v_cred.credential_id;

  -- The durable obligation. NO_RECOVERY still opens no case: nothing is owed.
  if p_recovery_disposition <> 'NO_RECOVERY' then
    insert into kitluy_devices.device_recovery_cases (
      revocation_id, device_record_id, environment, purpose, disposition)
    values (v_row.revocation_id, p_device_record_id, p_environment, p_purpose,
            p_recovery_disposition)
    returning recovery_case_id into v_case;
  end if;

  return jsonb_build_object(
    'outcome', 'REVOKED',
    'revocation_id', v_row.revocation_id,
    'credential_id', v_cred.credential_id,
    'credential_generation', v_cred.certificate_generation,
    'public_key_fingerprint', v_cred.public_key_fingerprint,
    'reason_code', p_reason_code,
    'recovery_disposition', p_recovery_disposition,
    'recovery_case_id', v_case,
    'effective_at', to_char(v_row.effective_at at time zone 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end
$revoke$;

comment on function kitluy_devices.revoke_device_credential_v1(
  text, uuid, text, text, integer,
  kitluy_devices.credential_revocation_reason, text,
  kitluy_devices.credential_recovery_disposition, text, text, uuid, text, text) is
  'The governed credential revocation KLRISK-DEVICE-007 named as absent. Resolves the credential from the DEVICE and GENERATION rather than from the caller, enforces the environment four-eyes policy against the kitluy_auth aggregate, writes append-only evidence, sets the derived `revoked` state the verifier reads TOGETHER WITH `revoked_at` and `revocation_reason` (group 0139: without the timestamp the group-0125 CHECK refused the write and no revocation could complete), and opens a durable recovery case. Idempotent per revocation intent; a DIFFERENT intent against an already-revoked credential returns MANUAL_REVIEW_REQUIRED rather than overwriting the first account.';

-- ===========================================================================
-- HOSTILE ASSERTIONS — a COMPLETE, END-TO-END REVOCATION
-- ===========================================================================
-- Group 0136 shipped broken because its assertions inspected grants,
-- constraints and triggers and NEVER CALLED THE FUNCTION. Inspection cannot
-- detect either of the two defects above: the grants were right, the
-- constraints were right, the triggers were right, and the operation was
-- impossible.
--
-- So this block performs a real revocation — real device, real issued
-- credential, real kitluy_auth approval rows, real four-eyes — and checks the
-- state, the evidence, the recovery case, the idempotent replay, the conflict
-- and the refusals.
--
-- IT LEAVES NOTHING BEHIND. Everything is built inside a plpgsql subtransaction
-- that is deliberately unwound by raising a sentinel: a migration that revoked
-- a credential in every freshly reset database would be writing incident
-- evidence for an incident that never happened, and group 0138 asserts (one
-- migration earlier) that shipping revokes nothing. Findings survive the
-- unwind because PL/pgSQL local variables keep their values when an exception
-- is caught; only the database changes are rolled back.
-- ===========================================================================
do $assert_0139$
declare
  v_findings text[] := array[]::text[];
  v_probe_error text := '';
  v_requester constant uuid := '00000000-0000-4000-8000-000000000139';
  v_approver constant uuid := '00000000-0000-4000-8000-000000000140';
  v_tenant uuid;
  v_store uuid;
  v_location uuid;
  v_profile uuid;
  v_device uuid;
  v_other_device uuid;
  v_fp text := encode(sha256(convert_to('kl0139-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_token text := encode(sha256(convert_to('kl0139-t-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('kl0139-p-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('kl0139-i-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_req_id text := 'rq-0139-' || gen_random_uuid()::text;
  v_prep jsonb;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position', 0, 'role', 'root', 'subject_fingerprint', repeat('r', 64),
                       'issuer_key_id', 'rk', 'canonical_tbs', 'R', 'detached_signature_b64', 'qg=='),
    jsonb_build_object('link_position', 1, 'role', 'intermediate', 'subject_fingerprint', repeat('i', 64),
                       'issuer_key_id', 'rk', 'canonical_tbs', 'I', 'detached_signature_b64', 'uw=='));
  v_credential uuid;
  v_policy_a4 uuid;
  v_policy_a2 uuid;
  v_ap_ok uuid;
  v_ap_scope uuid;
  v_ap_self uuid;
  v_ap_second uuid;
  v_intent text := 's0139-' || gen_random_uuid()::text;
  v_res jsonb;
  v_state text;
  v_revoked_at timestamptz;
  v_reason text;
  v_revocation_id uuid;
  v_n integer;
begin
  begin
    -- -------------------------------------------------------------------
    -- Fixtures. The migration runs BEFORE any seed, so every anchor the
    -- issuance chain needs is built here.
    -- -------------------------------------------------------------------
    insert into auth.users (id, email)
    values (v_requester, 'kl0139.requester@kitluy.invalid'),
           (v_approver, 'kl0139.approver@kitluy.invalid')
    on conflict (id) do nothing;

    insert into kitluy_core.reference_values
      (registry_key, value_code, status, sort_order, effective_from)
    select 'vertical_code', 'LAUNDRY', 'ACTIVE', 1, timestamptz '2026-07-26 00:00:00+00'
     where not exists (select 1 from kitluy_core.reference_values
                        where registry_key = 'vertical_code' and value_code = 'LAUNDRY');

    insert into kitluy_core.tenants (tenant_code, legal_name, display_name, status, default_locale)
    values ('KL0139-PROBE', 'Group 0139 revocation probe tenant',
            'Group 0139 revocation probe tenant', 'ACTIVE', 'km-KH')
    returning id into v_tenant;

    insert into kitluy_core.digital_stores
      (tenant_id, store_code, name, primary_vertical_code, status,
       default_locale, default_currency_code, timezone)
    values (v_tenant, 'KL0139-STORE', 'Group 0139 probe store', 'LAUNDRY',
            'ACTIVE_HYBRID', 'km-KH', 'KHR', 'Asia/Phnom_Penh')
    returning id into v_store;

    insert into kitluy_core.store_locations
      (tenant_id, digital_store_id, location_code, name, country_code,
       operating_status, hub_required)
    values (v_tenant, v_store, 'KL0139-LOC', 'Group 0139 probe location', 'KH',
            'ACTIVE', true)
    returning id into v_location;

    insert into kitluy_devices.hardware_profiles
      (profile_key, display_name, device_class, manufacturer, model_identifier,
       required_signal_types, certification_status)
    values ('KL0139-REVOCATION-PROBE', 'Group 0139 revocation probe profile', 'store_hub',
            'MIGRATION-FIXTURE', 'PROBE-0139',
            array['mac_address', 'board_serial', 'storage_serial']::kitluy_devices.hardware_signal_type[],
            'CERTIFIED')
    on conflict (profile_key) do nothing;
    select id into v_profile from kitluy_devices.hardware_profiles
     where profile_key = 'KL0139-REVOCATION-PROBE';

    -- A real device carrying a real, governed, generation-1 credential.
    v_device := kitluy_devices.enroll_device_v1(
      'KL0139-' || gen_random_uuid()::text, v_profile, now(), v_fp,
      'ed25519', 'software', 'STATION-0139', 'OP-0139',
      jsonb_build_array(
        jsonb_build_object('signal_type', 'mac_address', 'signal_value',
          '01:39:' || substr(md5(random()::text), 1, 8)),
        jsonb_build_object('signal_type', 'board_serial', 'signal_value',
          'board-0139-' || gen_random_uuid()::text),
        jsonb_build_object('signal_type', 'storage_serial', 'signal_value',
          'nvme-0139-' || gen_random_uuid()::text)));
    perform kitluy_devices.create_device_claim_v1(
      v_device, v_tenant, v_store, v_location, v_token, v_payload, 900, 'OP-0139');
    perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-0139');

    v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
      v_req_id, v_device, 'development', 'device_identity', 1, 'PEM-0139', v_fp,
      v_idem, repeat('9', 64), 'ed25519', repeat('8', 64), decode('a1', 'hex'),
      true, 'ica-0139', now(), 'trusted', 'SVC-0139');
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req_id, v_prep ->> 'canonical_tbs_hash', decode('1111', 'hex'), true, 'SVC-0139');
    perform kitluy_devices.finalize_device_credential_issuance_v1(v_req_id, v_links, 'SVC-0139');

    select credential_id into v_credential from kitluy_devices.device_credentials
     where device_record_id = v_device and certificate_generation = 1;
    if v_credential is null then
      v_findings := v_findings || 'the probe could not issue a credential to revoke';
      raise exception using errcode = 'P0001', message = 'KLUY-0139-PROBE-COMPLETE',
        detail = 'fixture';
    end if;

    -- A second device, so "wrong scope" is an approval for a REAL other device
    -- rather than for a uuid that happens not to exist.
    v_other_device := kitluy_devices.enroll_device_v1(
      'KL0139-OTHER-' || gen_random_uuid()::text, v_profile, now(),
      encode(sha256(convert_to('kl0139-other-' || gen_random_uuid()::text, 'UTF8')), 'hex'),
      'ed25519', 'software', 'STATION-0139', 'OP-0139',
      jsonb_build_array(
        jsonb_build_object('signal_type', 'mac_address', 'signal_value',
          '01:3a:' || substr(md5(random()::text), 1, 8)),
        jsonb_build_object('signal_type', 'board_serial', 'signal_value',
          'board-0139b-' || gen_random_uuid()::text),
        jsonb_build_object('signal_type', 'storage_serial', 'signal_value',
          'nvme-0139b-' || gen_random_uuid()::text)));

    -- -------------------------------------------------------------------
    -- The approval rows, in the SAME kitluy_auth aggregate group 0124 uses.
    -- -------------------------------------------------------------------
    insert into kitluy_auth.approval_policies
      (policy_key, version, permission_key, environment, quorum, status, risk_class)
    values ('device.credential.revocation.a4.0139', 1, 'device.credential.revoke',
            'development', 1, 'ACTIVE', 'A4')
    returning id into v_policy_a4;

    insert into kitluy_auth.approval_policies
      (policy_key, version, permission_key, environment, quorum, status, risk_class)
    values ('device.credential.revocation.a2.0139', 1, 'device.credential.revoke',
            'development', 1, 'ACTIVE', 'A2')
    returning id into v_policy_a2;

    -- The good one: A4, this device, this environment, APPROVED, approved by
    -- somebody who is not the requester.
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_device, 'development',
            'device_credential_revocation', repeat('a', 64),
            'terminal is being permanently replaced', 'APPROVED')
    returning id into v_ap_ok;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_ok, v_approver, 'APPROVE');

    -- An approval naming the OTHER device.
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_other_device, 'development',
            'device_credential_revocation', repeat('b', 64),
            'a different terminal entirely', 'APPROVED')
    returning id into v_ap_scope;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_scope, v_approver, 'APPROVE');

    -- A fully valid approval used for the self-approval probe, so the refusal
    -- is about WHO acted and not about the approval being defective.
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_device, 'development',
            'device_credential_revocation', repeat('c', 64),
            'self-approval probe', 'APPROVED')
    returning id into v_ap_self;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_self, v_approver, 'APPROVE');

    -- -------------------------------------------------------------------
    -- PROBE 0 — the gate ANSWERS. Before this migration it raised
    -- `permission denied for schema kitluy_auth` and no revocation, valid or
    -- invalid, could get past it.
    -- -------------------------------------------------------------------
    begin
      v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
        v_ap_ok, v_device, 'development', 'requester@0139'));
      if (v_res ->> 'authorized')::boolean is not true then
        v_findings := v_findings ||
          format('the approval gate refused a valid A4 approval: %s', v_res ->> 'refusal_code');
      end if;
    exception when others then
      v_findings := v_findings ||
        format('the approval gate could not read kitluy_auth: %s', sqlerrm);
    end;

    -- -------------------------------------------------------------------
    -- PROBE 1 — an approval for a DIFFERENT device is refused as wrong scope,
    -- and revokes nothing.
    -- -------------------------------------------------------------------
    v_res := kitluy_devices.revoke_device_credential_v1(
      's0139-scope-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
      'ADMINISTRATIVE_REPLACEMENT', 'wrong-scope probe', 'REPROVISION_REQUIRED',
      'requester@0139', 'MIGRATION-0139', v_ap_scope, 'approver@0139', null);
    if (v_res ->> 'outcome') <> 'REVOCATION_REFUSED'
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
      v_findings := v_findings ||
        format('an approval for ANOTHER device was not refused as wrong scope: %s', v_res);
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 2 — the requester cannot be the approver.
    -- -------------------------------------------------------------------
    v_res := kitluy_devices.revoke_device_credential_v1(
      's0139-self-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
      'ADMINISTRATIVE_REPLACEMENT', 'self-approval probe', 'REPROVISION_REQUIRED',
      'requester@0139', 'MIGRATION-0139', v_ap_self, 'requester@0139', null);
    if (v_res ->> 'outcome') <> 'REVOCATION_REFUSED'
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-SELF-APPROVED' then
      v_findings := v_findings ||
        format('a self-approved revocation was not refused: %s', v_res);
    end if;

    -- Neither refusal may have touched the credential.
    select state::text into v_state from kitluy_devices.device_credentials
     where credential_id = v_credential;
    if v_state <> 'issued' then
      v_findings := v_findings || format('a REFUSED revocation changed the credential to %s', v_state);
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 3 — THE COMPLETE REVOCATION.
    -- -------------------------------------------------------------------
    v_res := kitluy_devices.revoke_device_credential_v1(
      v_intent, v_device, 'development', 'device_identity', 1,
      'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change KL0139',
      'REPROVISION_REQUIRED', 'requester@0139', 'MIGRATION-0139',
      v_ap_ok, 'approver@0139', 'CHG-0139');
    if (v_res ->> 'outcome') <> 'REVOKED' then
      v_findings := v_findings ||
        format('a fully approved four-eyes revocation did not complete: %s', v_res);
      -- Nothing below can be meaningful if the revocation itself failed.
      raise exception using errcode = 'P0001', message = 'KLUY-0139-PROBE-COMPLETE',
        detail = 'revocation';
    end if;
    v_revocation_id := (v_res ->> 'revocation_id')::uuid;

    -- The EXACT pair group 0125's CHECK requires. Before this migration the
    -- UPDATE raised device_credentials_revoked_chk and the call never returned.
    select state::text, revoked_at, revocation_reason
      into v_state, v_revoked_at, v_reason
      from kitluy_devices.device_credentials where credential_id = v_credential;
    if v_state <> 'revoked' then
      v_findings := v_findings || format('the revoked credential is %s', v_state);
    end if;
    if v_revoked_at is null then
      v_findings := v_findings || 'a revoked credential carries no revocation time';
    end if;
    if v_reason is null or v_reason not like 'ADMINISTRATIVE_REPLACEMENT:%' then
      v_findings := v_findings ||
        format('the credential row records no account of its revocation (%s)', coalesce(v_reason, 'null'));
    end if;

    -- Append-only evidence naming the reason, the requester and the approver.
    if not exists (
      select 1 from kitluy_devices.device_credential_revocations
       where revocation_id = v_revocation_id
         and credential_id = v_credential
         and revocation_request_id = v_intent
         and reason_code = 'ADMINISTRATIVE_REPLACEMENT'
         and reason = 'terminal permanently replaced under change KL0139'
         and requested_by = 'requester@0139'
         and approved_by = 'approver@0139'
         and approved_at is not null
         and approval_request_id = v_ap_ok
         and incident_reference = 'CHG-0139') then
      v_findings := v_findings || 'the revocation wrote no complete append-only evidence row';
    end if;

    -- The durable obligation, for a disposition that is not NO_RECOVERY.
    if not exists (
      select 1 from kitluy_devices.device_recovery_cases
       where revocation_id = v_revocation_id
         and device_record_id = v_device
         and disposition = 'REPROVISION_REQUIRED'
         and state = 'open') then
      v_findings := v_findings || 'a non-NO_RECOVERY revocation opened no recovery case';
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 4 — replaying the SAME intent is idempotent.
    -- -------------------------------------------------------------------
    select count(*) into v_n from kitluy_devices.device_credential_revocations
     where credential_id = v_credential;
    v_res := kitluy_devices.revoke_device_credential_v1(
      v_intent, v_device, 'development', 'device_identity', 1,
      'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change KL0139',
      'REPROVISION_REQUIRED', 'requester@0139', 'MIGRATION-0139',
      v_ap_ok, 'approver@0139', 'CHG-0139');
    if (v_res ->> 'outcome') <> 'ALREADY_REVOKED'
       or (v_res ->> 'revocation_id')::uuid <> v_revocation_id then
      v_findings := v_findings || format('replaying the same intent was not idempotent: %s', v_res);
    end if;
    if (select count(*) from kitluy_devices.device_credential_revocations
         where credential_id = v_credential) <> v_n then
      v_findings := v_findings || 'a replayed intent wrote a second revocation row';
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 5 — a DIFFERENT intent against the revoked credential goes to
    -- review and does NOT overwrite the first account.
    -- -------------------------------------------------------------------
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a4, v_requester, 'device', v_device, 'development',
            'device_credential_revocation', repeat('d', 64),
            'someone else noticed the same terminal', 'APPROVED')
    returning id into v_ap_second;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_second, v_approver, 'APPROVE');

    v_res := kitluy_devices.revoke_device_credential_v1(
      's0139-conflict-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
      'DEVICE_STOLEN', 'a second person calls it theft', 'REPROVISION_REQUIRED',
      'requester2@0139', 'MIGRATION-0139', v_ap_second, 'approver2@0139', 'INC-0139');
    if (v_res ->> 'outcome') <> 'MANUAL_REVIEW_REQUIRED'
       or (v_res ->> 'refusal_code') <> 'KLUY-REVOKE-CONFLICTING-REASON' then
      v_findings := v_findings ||
        format('a conflicting second intent did not go to review: %s', v_res);
    end if;
    if not exists (
      select 1 from kitluy_devices.device_credential_revocations
       where revocation_id = v_revocation_id
         and reason_code = 'ADMINISTRATIVE_REPLACEMENT'
         and requested_by = 'requester@0139') then
      v_findings := v_findings || 'the FIRST account of the revocation was overwritten';
    end if;
    if (select count(*) from kitluy_devices.device_credential_revocations
         where credential_id = v_credential) <> v_n then
      v_findings := v_findings || 'a conflicting intent wrote a second revocation row';
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 6 — the approval is single-use. The one that authorized the
    -- completed revocation cannot authorize another, on another device.
    -- -------------------------------------------------------------------
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_ok, v_device, 'development', 'requester@0139'));
    if (v_res ->> 'authorized')::boolean is not false
       or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-APPROVAL-CONSUMED' then
      v_findings := v_findings ||
        format('a consumed approval was still authority for a revocation: %s', v_res);
    end if;

    -- -------------------------------------------------------------------
    -- PROBE 7 — an A2 policy is still below the bar, through the real call.
    -- -------------------------------------------------------------------
    insert into kitluy_auth.approval_requests
      (policy_id, requester_id, resource_type, resource_id, environment, action,
       payload_hash, reason, status)
    values (v_policy_a2, v_requester, 'device', v_other_device, 'development',
            'device_credential_revocation', repeat('e', 64),
            'risk class probe', 'APPROVED')
    returning id into v_ap_second;
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_ap_second, v_approver, 'APPROVE');
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_second, v_other_device, 'development', 'requester@0139'));
    if (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-RISK-CLASS' then
      v_findings := v_findings ||
        format('an A2 approval was not refused on risk class: %s', v_res);
    end if;

    -- Unwind everything this probe created. The sentinel is the ONLY way out
    -- of this block that is not a real failure.
    raise exception using errcode = 'P0001', message = 'KLUY-0139-PROBE-COMPLETE',
      detail = 'ok';
  exception when others then
    get stacked diagnostics v_probe_error = message_text;
    if v_probe_error <> 'KLUY-0139-PROBE-COMPLETE' then
      raise exception 'ASSERT FAIL 0139: the end-to-end revocation probe did not complete: %',
        v_probe_error;
    end if;
  end;

  -- The probe's own findings survive the unwind (PL/pgSQL keeps local variable
  -- values when an exception is caught; only database changes roll back).
  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0139: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  -- -------------------------------------------------------------------------
  -- Structure, checked AFTER behaviour rather than instead of it.
  -- -------------------------------------------------------------------------
  if exists (select 1 from kitluy_devices.device_credentials where state = 'revoked') then
    raise exception 'ASSERT FAIL 0139: the migration left a credential revoked';
  end if;
  if exists (select 1 from kitluy_devices.device_credential_revocations) then
    raise exception 'ASSERT FAIL 0139: the migration left revocation evidence behind';
  end if;

  -- The credential governor gained NOTHING on the approvals aggregate. The
  -- whole point of pinning the read to service_role is that this stays false.
  if has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'insert')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'update')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'delete')
     or has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage') then
    raise exception 'ASSERT FAIL 0139: the credential governor now reaches kitluy_auth directly';
  end if;

  -- No RLS policy was added, so the section 7 census is untouched.
  if (select count(*) from pg_policies
       where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit')
         and cmd = 'SELECT') <> 58 then
    raise exception 'ASSERT FAIL 0139: the SELECT-policy census moved off 58';
  end if;

  -- The gate's identity is what this migration changed; nothing else drifted.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'service_role'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception
      'ASSERT FAIL 0139: the approval gate is not a service_role-owned SECURITY DEFINER with a fixed search_path';
  end if;
  if has_function_privilege('public',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
    raise exception 'ASSERT FAIL 0139: PUBLIC can execute the approval gate';
  end if;
  if not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
    raise exception 'ASSERT FAIL 0139: the governed revocation path cannot reach its own approval gate';
  end if;
  if has_schema_privilege('service_role', 'kitluy_devices', 'create') then
    raise exception 'ASSERT FAIL 0139: service_role kept CREATE on kitluy_devices';
  end if;

  -- Group 0138's §2.4 one-way trigger is untouched by this group.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'device_credentials'
                    and t.tgname = 'trg_device_credentials_revocation_one_way'
                    and not t.tgisinternal) then
    raise exception 'ASSERT FAIL 0139: the one-way revocation trigger is gone';
  end if;
end
$assert_0139$;

-- The membership borrowed at the top is HANDED BACK, exactly as groups
-- 0134/0136/0137/0138 do. A migration that kept it would leave the
-- login-capable migration role able to SET ROLE to the credential governor for
-- ever, which is what the permanent assertion in section 32 refuses.
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
