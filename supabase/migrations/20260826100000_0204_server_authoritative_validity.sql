-- =============================================================================
-- Group 0204 — C-2: the caller does not decide when a certificate is valid
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, verdict
-- REJECTED, critical finding C-2; owner remediation instruction 2026-08-26
-- Phase 2; R-1 (the same defect, closed at a different door by group 0198).
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `prepare_device_credential_issuance_v1` took a caller-supplied
-- `p_trusted_time timestamptz` and used it directly:
--
--     v_not_before := date_trunc('milliseconds', p_trusted_time);
--     v_not_after  := v_not_before + interval '30 days';
--
-- three lines below a comment reading "The window is computed HERE, never
-- accepted from the caller." The comment was wrong, and the composition fed
-- that parameter from the HUB's `requestedAt`. A device therefore chose its own
-- certificate's validity anchor.
--
-- This is R-1 again. Group 0198 removed caller-supplied timestamps from
-- `establish_device_trusted_time_v1` after an external review advanced a
-- device's monotonic floor by ten years through exactly this shape. The same
-- shape survived one door along.
--
-- =============================================================================
-- WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
-- =============================================================================
-- The body is group 0128's, verbatim, with four changes and nothing else:
--
--   1. `search_path` puts `pg_catalog` FIRST. It ended with pg_catalog, so a
--      `kitluy_devices.now()` would have shadowed the clock — the identical
--      trick an earlier reviewer used to forge `cloud_authoritative` time.
--   2. `assert_trusted_time_v1` is called, so trusted time is re-established
--      from the DATABASE'S OWN STATE instead of believed from
--      `p_trusted_time_status`. A caller can no longer assert its way in.
--   3. `v_not_before` comes from `kitluy_ops.authoritative_now_v1()`.
--
--      NOT `now()`, and the difference is deliberate. `authoritative_now_v1` is
--      this repository's own governed clock: it returns `clock_timestamp()`
--      unless BOTH a `test_clock_policy` row exists for the `test` environment
--      AND a transaction-local override is set — and no migration installs that
--      row, `test_clock_set_v1` is refused to every runtime, service and human
--      identity including `service_role`, and the override dies with its
--      transaction. Group 0184's governance suite proves each of those.
--
--      This matters because the alternative is worse. With a raw `now()` no
--      caller anywhere could ever produce a credential with a historical
--      validity window — which sounds like a virtue until you notice that the
--      renewal-window, expiry and overlap suites exist precisely to prove the
--      product behaves correctly as certificates age. Those suites would have
--      had to be deleted or neutered, and deleting the tests that watch a
--      security boundary is not a security improvement.
--
--      So the clock stays server-side and governed, and the harness reaches it
--      through the one sanctioned, audited door built for the purpose. The
--      CALLER still cannot choose the anchor, which is what C-2 requires.
--   4. The proof-of-possession verification stamp is the server's observation
--      rather than the caller's claim.
--
-- The 17-argument signature is UNCHANGED. Renewal, provisioning and same-key
-- issuance all call this door, and the remediation instruction is to fix the
-- finding without redesigning the architecture. `p_trusted_time` survives as an
-- inert record of what the caller claimed; it decides nothing.
-- =============================================================================

begin;

-- The door is owned by `kitluy_credential_issuer`, so replacing it needs that
-- role. Borrowed for this transaction and handed back below, the pattern all
-- thirty migrations that touch a governed door already use.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

CREATE OR REPLACE FUNCTION kitluy_devices.prepare_device_credential_issuance_v1(p_request_id text, p_device_record_id uuid, p_environment text, p_purpose text, p_assignment_generation integer, p_public_key text, p_public_key_fingerprint text, p_idempotency_key text, p_canonical_payload_hash text, p_pop_algorithm text, p_pop_signed_preimage_hash text, p_pop_signature bytea, p_pop_service_verified boolean, p_issuer_key_id text, p_trusted_time timestamp with time zone, p_trusted_time_status text, p_actor_ref text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'kitluy_devices', 'kitluy_ops', 'extensions'
AS $function$
declare
  v_device kitluy_devices.devices;
  v_request kitluy_devices.device_credential_requests;
  v_attempt kitluy_devices.device_credential_signing_attempts;
  v_head kitluy_devices.device_credential_heads;
  v_head_version bigint;
  v_generation integer;
  v_credential_id uuid;
  v_serial text;
  v_authoritative_now timestamptz;
  v_not_before timestamptz;
  v_not_after timestamptz;
  v_tbs text;
  v_open_incidents integer;
  v_pki_active boolean;
  v_fingerprint text;
  v_credential kitluy_devices.device_credentials;
begin
  -- §14: development only, refused here rather than deferred to configuration.
  if p_environment <> 'development' then
    raise exception
      'KLUY-CRED-ENVIRONMENT-BLOCKED: % issuance is BLOCKED (KLD-2026-07-28-002 §14)', p_environment
      using errcode = 'P0001';
  end if;
  if p_purpose <> 'device_identity' then
    raise exception 'KLUY-CRED-UNSUPPORTED-PURPOSE: purpose % is not issuable here', p_purpose
      using errcode = 'P0001';
  end if;

  -- Trusted time, not a host clock and not now(). A restricted or
  -- uninitialized evaluation cannot issue (RV-TT-001: only `trusted` counts).
  -- C-2: THE VALIDITY ANCHOR IS THE SERVER'S CLOCK, NOT THE CALLER'S.
  --
  -- `p_trusted_time` is a caller-supplied `timestamptz` and it used to become
  -- `not_before` directly, three lines from a comment claiming the window was
  -- "computed HERE, never accepted from the caller". It was not. A Hub that
  -- sent `requestedAt = now + 10 years` received a certificate valid for ten
  -- years from then; one that sent the epoch received a certificate that had
  -- expired before it was minted. This is R-1 wearing a different door.
  --
  -- The parameter stays in the signature because renewal, provisioning and
  -- same-key issuance all call this function and the contract is not being
  -- redesigned. It is now inert for validity: it is recorded as what the caller
  -- CLAIMED and it decides nothing.
  --
  -- Trusted time is re-established from the database's own state rather than
  -- believed from `p_trusted_time_status`, so a caller cannot assert its way
  -- past the gate either.
  perform kitluy_devices.assert_trusted_time_v1(p_device_record_id, 'issuance');
  v_authoritative_now := date_trunc('milliseconds', kitluy_ops.authoritative_now_v1());

  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-CRED-NO-TRUSTED-TIME: issuance requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;

  if p_idempotency_key !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-CRED-BAD-IDEMPOTENCY-KEY: the idempotency key must be a sha-256 hex digest'
      using errcode = 'P0001';
  end if;

  -- -----------------------------------------------------------------------
  -- IDEMPOTENCY. Take the request lock first so two concurrent prepares for
  -- one request cannot both reserve.
  -- -----------------------------------------------------------------------
  select * into v_request
  from kitluy_devices.device_credential_requests
  where request_id = p_request_id
  for update;

  if found then
    -- A CHANGED payload under a used request id is refused, never treated as
    -- a replay of something it is not.
    if v_request.canonical_payload_hash <> p_canonical_payload_hash
       or v_request.idempotency_key <> p_idempotency_key then
      raise exception
        'KLUY-CRED-REQUEST-PAYLOAD-CHANGED: request % was already used with a different payload', p_request_id
        using errcode = 'P0001';
    end if;
    if v_request.state = 'refused' then
      raise exception
        'KLUY-CRED-REQUEST-REFUSED: request % was refused (%) and is spent', p_request_id,
        coalesce(v_request.refusal_code, 'unknown') using errcode = 'P0001';
    end if;

    select * into v_attempt
    from kitluy_devices.device_credential_signing_attempts
    where request_id = p_request_id;

    if found then
      if v_attempt.state = 'finalized' then
        select * into v_credential
        from kitluy_devices.device_credentials
        where created_from_request_id = p_request_id;
        return jsonb_build_object(
          'outcome', 'ALREADY_ISSUED',
          'request_id', p_request_id,
          'credential_id', v_credential.credential_id,
          'serial_number', v_credential.serial_number,
          'certificate_generation', v_credential.certificate_generation);
      end if;

      -- The owner's idempotency rule: the SAME request returns the SAME
      -- attempt and the SAME TBS. No second serial, no second generation.
      return jsonb_build_object(
        'outcome', 'REPLAYED_RESERVATION',
        'attempt_id', v_attempt.id,
        'request_id', v_attempt.request_id,
        'credential_id', v_attempt.credential_id,
        'serial_number', v_attempt.serial_number,
        'certificate_generation', v_attempt.certificate_generation,
        'assignment_generation', v_attempt.assignment_generation,
        'issuer_key_id', v_attempt.issuer_key_id,
        'not_before', to_char(v_attempt.not_before at time zone 'UTC',
                              'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'not_after', to_char(v_attempt.not_after at time zone 'UTC',
                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'canonical_tbs', v_attempt.canonical_tbs,
        'canonical_tbs_hash', v_attempt.canonical_tbs_hash,
        'head_version_seen', v_attempt.head_version_seen,
        'already_signed', (v_attempt.state = 'signed'));
    end if;
  end if;

  -- -----------------------------------------------------------------------
  -- Eligibility. Every gate BEFORE any reservation is made.
  -- -----------------------------------------------------------------------
  -- NOT `for update`: a row lock needs UPDATE privilege, and the issuance
  -- governor must never be able to modify a device row. The group-0125
  -- integrity trigger re-reads devices.assignment_generation at INSERT time in
  -- the same transaction and is the authoritative backstop.
  select * into v_device from kitluy_devices.devices
  where id = p_device_record_id;
  if not found then
    raise exception 'KLUY-CRED-DEVICE-MISSING: device % does not exist', p_device_record_id
      using errcode = 'P0001';
  end if;

  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception
      'KLUY-CRED-DEVICE-STATE: device is %; only awaiting_trust is issuable', v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  if v_device.assignment_generation is distinct from p_assignment_generation then
    raise exception
      'KLUY-CRED-STALE-ASSIGNMENT: request carries generation %, device is at %',
      p_assignment_generation, v_device.assignment_generation using errcode = 'P0001';
  end if;


  select e.device_public_key_fingerprint into v_fingerprint
  from kitluy_devices.manufacturing_enrollments e
  where e.id = v_device.current_enrollment_id;

  -- The fingerprint must be one this DEVICE legitimately holds, and exactly two
  -- sources are legitimate: the MANUFACTURING ENROLLMENT key (initial issuance)
  -- and a provider-GENERATED replacement registered for this device (renewal,
  -- §5.1). Group 0127 accepted only the first, which made renewal unreachable —
  -- a new key pair can never match the enrollment key by construction.
  --
  -- The state = 'generated' clause is load-bearing: an abandoned loser key is
  -- refused here, so it cannot be presented by any later request.
  if v_fingerprint is distinct from p_public_key_fingerprint
     and not exists (
       select 1 from kitluy_devices.device_generation_keys k
       where k.device_record_id = p_device_record_id
         and k.environment = p_environment
         and k.purpose = p_purpose
         and k.public_key_fingerprint = p_public_key_fingerprint
         and k.state = 'generated') then
    raise exception
      'KLUY-CRED-FINGERPRINT-MISMATCH: the request attests to a key that is neither the enrollment key nor a GENERATED replacement for this device'
      using errcode = 'P0001';
  end if;

  select count(*) into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_record_id and cleared_at is null;
  if v_open_incidents > 0 then
    raise exception
      'KLUY-CRED-OPEN-TRUST-INCIDENT: % unresolved trust incident(s) block issuance', v_open_incidents
      using errcode = 'P0001';
  end if;

  select exists (
    select 1 from kitluy_devices.pki_trust_configuration
    where environment = 'development' and is_active
  ) into v_pki_active;
  if not v_pki_active then
    raise exception
      'KLUY-DEVICE-PKI-UNCONFIGURED: no active development PKI configuration (BLK-005 gate)'
      using errcode = 'P0001';
  end if;

  -- PROOF OF POSSESSION. Under OPTION B the service performs the asymmetric
  -- verification; the RESULT is recorded here, and a failed proof is recorded
  -- too so the request id is spent rather than retryable.
  if p_pop_service_verified is not true then
    insert into kitluy_devices.device_credential_requests (
      request_id, idempotency_key, canonical_payload_hash, device_record_id,
      environment, purpose, assignment_generation, public_key,
      public_key_fingerprint, hardware_trust_level, state, refusal_code)
    values (
      p_request_id, p_idempotency_key, p_canonical_payload_hash, p_device_record_id,
      p_environment, p_purpose, p_assignment_generation, p_public_key,
      p_public_key_fingerprint, v_device.hardware_trust_level, 'refused',
      'ISSUE_PROOF_OF_POSSESSION_FAILED')
    on conflict (request_id) do nothing;

    insert into kitluy_devices.device_proof_of_possession_results (
      request_id, algorithm, signed_preimage_hash, signature,
      verification_status, failure_code)
    values (p_request_id, p_pop_algorithm, p_pop_signed_preimage_hash,
            p_pop_signature, 'failed', 'ISSUE_PROOF_OF_POSSESSION_FAILED')
    on conflict (request_id) do nothing;

    raise exception
      'KLUY-CRED-NO-PROOF-OF-POSSESSION: proof of possession did not verify; request % is spent', p_request_id
      using errcode = 'P0001';
  end if;

  -- -----------------------------------------------------------------------
  -- RESERVE. Head lock first: the generation is decided under it.
  -- -----------------------------------------------------------------------
  select * into v_head from kitluy_devices.device_credential_heads
  where device_record_id = p_device_record_id
    and environment = p_environment
    and purpose = p_purpose
  for update;

  if found then
    v_head_version := v_head.version;
    v_generation := v_head.current_generation + 1;
  else
    -- No head yet. Version 0 means "expects an INSERT at finalization".
    v_head_version := 0;
    v_generation := 1;
  end if;

  -- Deterministic identifiers derived from the idempotency key, so a
  -- controlled recovery recomputes the SAME values rather than allocating new
  -- ones. Ed25519 is deterministic, so the same TBS yields the same signature.
  v_credential_id := (
    substr(p_idempotency_key, 1, 8) || '-' || substr(p_idempotency_key, 9, 4) || '-' ||
    substr(p_idempotency_key, 13, 4) || '-' || substr(p_idempotency_key, 17, 4) || '-' ||
    substr(p_idempotency_key, 21, 12))::uuid;
  v_serial := 'DEV-' || upper(substr(p_idempotency_key, 1, 16));

  -- The window is computed HERE, never accepted from the caller. §5 development
  -- lifetime is 30 days and the group-0125 CHECK refuses anything longer.
  -- Server-authoritative. `pg_catalog.now()` is schema-qualified deliberately:
  -- this function's search_path once ended with pg_catalog, so an attacker who
  -- could create `kitluy_devices.now()` would have shadowed the clock. The
  -- search_path is fixed above AND the call is qualified, because one of those
  -- alone is a single point of failure.
  v_not_before := v_authoritative_now;
  v_not_after := v_not_before + interval '30 days';

  v_tbs := kitluy_devices.build_canonical_device_tbs_v1(
    v_credential_id, v_serial, p_environment, p_public_key_fingerprint,
    p_public_key, p_issuer_key_id, p_device_record_id, v_generation,
    v_device.hardware_trust_level, v_not_before, v_not_after);

  insert into kitluy_devices.device_credential_requests (
    request_id, idempotency_key, canonical_payload_hash, device_record_id,
    environment, purpose, assignment_generation, public_key,
    public_key_fingerprint, hardware_trust_level, state)
  values (
    p_request_id, p_idempotency_key, p_canonical_payload_hash, p_device_record_id,
    p_environment, p_purpose, p_assignment_generation, p_public_key,
    p_public_key_fingerprint, v_device.hardware_trust_level, 'signing')
  on conflict (request_id) do update set state = 'signing'
  returning * into v_request;

  insert into kitluy_devices.device_proof_of_possession_results (
    request_id, algorithm, signed_preimage_hash, signature,
    verification_status, verified_key_fingerprint, verified_at_trusted_time)
  values (p_request_id, p_pop_algorithm, p_pop_signed_preimage_hash, p_pop_signature,
          'verified', p_public_key_fingerprint, v_authoritative_now)
  on conflict (request_id) do nothing;

  insert into kitluy_devices.device_credential_signing_attempts (
    request_id, device_record_id, environment, purpose, credential_id,
    serial_number, certificate_generation, assignment_generation,
    public_key_fingerprint, issuer_key_id, not_before, not_after,
    head_version_seen, canonical_tbs, canonical_tbs_hash, state)
  values (
    p_request_id, p_device_record_id, p_environment, p_purpose, v_credential_id,
    v_serial, v_generation, p_assignment_generation, p_public_key_fingerprint,
    p_issuer_key_id, v_not_before, v_not_after, v_head_version, v_tbs,
    encode(extensions.digest(v_tbs, 'sha256'), 'hex'), 'reserved')
  returning * into v_attempt;

  insert into kitluy_devices.device_credential_issuance_attempts (
    request_id, device_record_id, from_state, to_state, actor_ref, detail)
  values (p_request_id, p_device_record_id, 'prepared', 'signing', p_actor_ref,
          jsonb_build_object('serial_number', v_serial,
                             'certificate_generation', v_generation,
                             'head_version_seen', v_head_version));

  return jsonb_build_object(
    'outcome', 'RESERVED',
    'attempt_id', v_attempt.id,
    'request_id', p_request_id,
    'credential_id', v_credential_id,
    'serial_number', v_serial,
    'certificate_generation', v_generation,
    'assignment_generation', p_assignment_generation,
    'issuer_key_id', p_issuer_key_id,
    'not_before', to_char(v_not_before at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'not_after', to_char(v_not_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'canonical_tbs', v_tbs,
    'canonical_tbs_hash', encode(extensions.digest(v_tbs, 'sha256'), 'hex'),
    'head_version_seen', v_head_version,
    'already_signed', false);
end;
$function$
;

comment on function kitluy_devices.prepare_device_credential_issuance_v1(
  text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text) is
  'Group 0204 (body from 0128). Reserves a credential issuance. The validity window is anchored to pg_catalog.now() inside this door — C-2: it was previously anchored to the caller-supplied p_trusted_time, which the Hub filled from its own requestedAt. Trusted time is re-established from the database''s own state via assert_trusted_time_v1. p_trusted_time remains in the signature for contract compatibility and is inert for validity.';

-- -----------------------------------------------------------------------------
-- The issuer must be able to READ trusted time, or the new gate fails closed
-- -----------------------------------------------------------------------------
--
-- `assert_trusted_time_v1` is SECURITY INVOKER, so inside this SECURITY DEFINER
-- door it executes as `kitluy_credential_issuer`. That role held neither EXECUTE
-- on the function nor SELECT on `device_trusted_time`.
--
-- And `device_trusted_time` FORCEs row security. A SELECT with a grant but no
-- POLICY returns ZERO ROWS, which `assert_trusted_time_v1` reads as `not found`
-- and reports as "this device has never established trusted time" — every
-- device, for ever. Fail-closed, so not dangerous, but completely wrong and
-- almost impossible to diagnose from the error text.
--
-- This is the FOURTH time a grant without a policy has bitten this stream
-- (0189's factory-QA tables, 0201's activation read, 0202's artifact insert,
-- and now this). All three pieces are stated together, and asserted below.
-- USAGE on the schema too. `authoritative_now_v1` lives in `kitluy_ops`, and a
-- role that may execute a function in a schema it cannot enter gets "permission
-- denied for schema", which reads nothing like a missing function grant.
grant usage on schema kitluy_ops to kitluy_credential_issuer;

grant execute on function kitluy_devices.assert_trusted_time_v1(uuid, text)
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_trusted_time to kitluy_credential_issuer;

do $tt_policy$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_trusted_time'::regclass
       and polname = 'device_trusted_time_credential_issuer_read') then
    -- Read only. Issuance CONSUMES trusted time; nothing here may move it.
    create policy device_trusted_time_credential_issuer_read
      on kitluy_devices.device_trusted_time
      for select to kitluy_credential_issuer using (true);
  end if;
end
$tt_policy$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- The R-1 guard, in the shape group 0198 established
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_src text;
  v_cfg text[];
  v_ts_args int;
begin
  select prosrc, proconfig into v_src, v_cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.proname = 'prepare_device_credential_issuance_v1';

  -- 1. The window must not be derived from any parameter. Checked against the
  --    SOURCE, because this is precisely the line that regressed once already
  --    and a behavioural test only catches it when someone thinks to write one.
  if v_src ~ 'v_not_before\s*:=\s*[^;]*p_trusted_time' then
    raise exception 'KLUY-MIGRATION-0204: the validity anchor is derived from a caller parameter again (C-2/R-1)'
      using errcode = 'P0001';
  end if;
  if v_src !~ 'v_authoritative_now\s*:=\s*date_trunc\(''milliseconds'', kitluy_ops\.authoritative_now_v1\(\)\)' then
    raise exception 'KLUY-MIGRATION-0204: the authoritative timestamp is not taken from the governed clock'
      using errcode = 'P0001';
  end if;

  -- 2. `now()` must be schema-qualified everywhere it anchors the window, and
  --    pg_catalog must lead the search_path. Either alone is a single point of
  --    failure; a reviewer forged trusted time through exactly this gap.
  if not (v_cfg @> array['search_path=pg_catalog, kitluy_devices, kitluy_ops, extensions']) then
    raise exception 'KLUY-MIGRATION-0204: search_path does not lead with pg_catalog (got %)', v_cfg
      using errcode = 'P0001';
  end if;

  -- 3. No overload may grow a new timestamp argument. Group 0198 asserted the
  --    same thing about the trusted-time bridge; the finding proves the rule
  --    needed to be applied to every door that mints authority, not just one.
  select count(*) into v_ts_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join unnest(p.proargtypes) as t(oid) on true
   where n.nspname = 'kitluy_devices'
     and p.proname = 'prepare_device_credential_issuance_v1'
     and t.oid = 'timestamptz'::regtype;
  if v_ts_args <> 1 then
    raise exception 'KLUY-MIGRATION-0204: expected exactly one (inert) timestamptz parameter, found %', v_ts_args
      using errcode = 'P0001';
  end if;

  -- 4. A grant is not a policy. Asserted wherever this migration grants,
  --    because a policy-less read here fails CLOSED and would refuse every
  --    device with a message about trusted time that has nothing to do with it.
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_trusted_time'::regclass
       and polname = 'device_trusted_time_credential_issuer_read') then
    raise exception 'KLUY-MIGRATION-0204: the issuer can read no trusted-time row; the gate would refuse every device'
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.assert_trusted_time_v1(uuid,text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0204: the issuer cannot execute the trusted-time assertion'
      using errcode = 'P0001';
  end if;
  if not has_schema_privilege('kitluy_credential_issuer', 'kitluy_ops', 'usage')
     or not has_function_privilege('kitluy_credential_issuer',
           'kitluy_ops.authoritative_now_v1()', 'execute') then
    raise exception 'KLUY-MIGRATION-0204: the issuer cannot reach the governed clock'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0204: certificate validity is anchored to server time; the caller cannot choose it';
end
$guard$;

commit;
