-- kitluy:group:0127
-- Migration group 0127: governed_issuance_functions (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0126 are COMMITTED and are not edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- CRYPTOGRAPHIC VERIFICATION BOUNDARY — OPTION B (owner ruling, 2026-07-28)
-- ===========================================================================
-- The owner required this be DETERMINED, not assumed. It was probed:
--
--   installed extensions : btree_gist, pg_graphql, pg_net, pg_stat_statements,
--                          pgcrypto 1.3, pgjwt, plpgsql, supabase_vault, uuid-ossp
--   pgcrypto asymmetric  : pgp_pub_encrypt/decrypt ONLY — PGP encryption.
--                          There is NO signature-verification function of any
--                          kind in pgcrypto, let alone Ed25519.
--   name probe           : no function anywhere in the cluster matches
--                          ed25519 | eddsa | sign_detached | verify_detached |
--                          crypto_sign.
--   pgsodium             : AVAILABLE in the image, NOT INSTALLED, and never
--                          reviewed or approved by this project.
--
-- Therefore OPTION B APPLIES. PostgreSQL does NOT verify the Ed25519 signature.
-- Installing pgsodium or hand-rolling curve arithmetic in plpgsql purely to be
-- able to say "the database verifies it" is exactly what the owner prohibited,
-- and would trade a recorded, honest boundary for an unreviewed one.
--
-- CONSEQUENCE, RECORDED RATHER THAN GLOSSED (KLRISK-DEVICE-003):
--   THE ISSUANCE SERVICE IS PART OF THE TRUSTED COMPUTING BASE.
--   A compromised issuance service can present a signature this database will
--   accept, because this database cannot check it. That is a real limitation
--   of the development stack and is not closed by anything in this migration.
--
-- WHAT POSTGRESQL DOES ENFORCE INDEPENDENTLY — all of it without trusting the
-- caller's word, because none of it needs asymmetric cryptography:
--   * request binding      — the canonical TBS is BUILT HERE from reserved
--                            fields; the caller never supplies it, only echoes
--                            it back, and a mismatch refuses.
--   * hash integrity       — extensions.digest() recomputes the SHA-256 of the
--                            canonical TBS and of the signature. Present and
--                            self-tested.
--   * state machine        — prepared -> signing -> signed_unpersisted ->
--                            issued, each transition locked and revalidated.
--   * generation authority — head compare-and-swap; the loser is refused.
--   * executing identity   — current_user, not a settable marker (RV-001).
--   * atomic persistence   — audit, credential, chain links and head advance
--                            commit together or not at all.
--
-- The signature is the ONLY thing taken on trust. Everything that BINDS that
-- signature to a device, a key, a generation and a window is enforced here.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- The named issuance service role. Only this role may execute the governed
-- functions; `public`, `anon` and `authenticated` never can.
-- ---------------------------------------------------------------------------
do $create_service_role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_issuance_service') then
    create role kitluy_issuance_service nologin;
  end if;
end
$create_service_role$;

comment on role kitluy_issuance_service is
  'The named executor of the governed issuance path. NOLOGIN: it is assumed by the trusted issuance service, never authenticated as. Under OPTION B this role is inside the trusted computing base for SIGNATURE VALIDITY only — it still cannot write kitluy_devices.device_credentials directly, because that trigger checks for kitluy_credential_issuer.';

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- The signing attempt — the durable artifact that survives a crash
-- ===========================================================================
-- DISTINCT from group 0125's `device_credential_issuance_attempts`, which is
-- the append-only AUDIT of state transitions. This table is the reservation:
-- it holds the identifiers decided BEFORE signing and, once signing returns,
-- the signature itself — so a process that dies between signing and
-- finalization can be recovered using the ORIGINAL signature rather than by
-- minting a second one.
-- ===========================================================================
create type kitluy_devices.signing_attempt_state as enum (
  'reserved',
  'signed',
  'finalized',
  'abandoned'
);

create table if not exists kitluy_devices.device_credential_signing_attempts (
  id uuid primary key default gen_random_uuid(),
  request_id text not null unique
    references kitluy_devices.device_credential_requests (request_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,

  -- Reserved BEFORE signing. None of these may be replaced at finalization.
  credential_id uuid not null,
  serial_number text not null,
  certificate_generation integer not null,
  assignment_generation integer not null,
  public_key_fingerprint text not null,
  issuer_key_id text not null,
  not_before timestamptz not null,
  not_after timestamptz not null,
  head_version_seen bigint not null,

  -- The exact bytes the CA is asked to sign, built here.
  canonical_tbs text not null,
  canonical_tbs_hash text not null,

  state kitluy_devices.signing_attempt_state not null default 'reserved',
  detached_signature bytea,
  signature_sha256 text,
  -- OPTION B, named explicitly rather than hidden in a boolean called `valid`:
  -- this column records that THE SERVICE says it verified the signature. It is
  -- an attestation from inside the trusted computing base, not a database
  -- verification, and the column name says so.
  service_attested_signature_verified boolean,
  signed_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),

  constraint device_signing_attempt_tbs_hash_chk
    check (canonical_tbs_hash ~ '^[0-9a-f]{64}$'),
  constraint device_signing_attempt_sig_hash_chk
    check (signature_sha256 is null or signature_sha256 ~ '^[0-9a-f]{64}$'),
  constraint device_signing_attempt_env_chk check (environment = 'development'),
  constraint device_signing_attempt_purpose_chk check (purpose = 'device_identity'),
  constraint device_signing_attempt_generation_chk check (certificate_generation >= 1),
  constraint device_signing_attempt_window_chk check (not_after > not_before),
  -- A signature and its hash and its attestation travel together, or none do.
  constraint device_signing_attempt_signed_chk
    check ((detached_signature is null) = (signature_sha256 is null)
           and (detached_signature is null) = (service_attested_signature_verified is null)),
  -- `signed` and `finalized` are unreachable without a recorded signature.
  constraint device_signing_attempt_state_chk
    check (state in ('reserved', 'abandoned') or detached_signature is not null)
);

comment on table kitluy_devices.device_credential_signing_attempts is
  'Owner: Fleet. The DURABLE RESERVATION for one issuance: the identifiers and canonical TBS decided before signing, and the signature once it exists. This is what makes crash recovery use the ORIGINAL signature instead of allocating a second serial. NOT the audit table — group 0125 device_credential_issuance_attempts is that. MC: MUT (state machine only).';

create index device_credential_signing_attempts_device_idx
  on kitluy_devices.device_credential_signing_attempts
  (device_record_id, environment, purpose, certificate_generation desc);

-- The reservation is immutable except along its state machine. A finalized
-- attempt is frozen: without this, a caller could rewrite the signature of an
-- already-issued credential's reservation.
create or replace function kitluy_devices.enforce_signing_attempt_transitions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-CRED-ATTEMPT-IMMUTABLE: a signing attempt is abandoned, never deleted'
      using errcode = 'P0001';
  end if;

  if current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-CRED-UNAUTHORIZED-ATTEMPT: only the governed issuance path may write a signing attempt (current_user %)', current_user
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    if old.state = 'finalized' then
      raise exception
        'KLUY-CRED-ATTEMPT-FINALIZED: attempt for request % is finalized and cannot be rewritten', old.request_id
        using errcode = 'P0001';
    end if;
    -- Every reserved identifier is frozen at reservation. This is the
    -- owner's "the finalizer must not accept caller-supplied replacements",
    -- enforced at the row level so it holds even if a function is wrong.
    if new.credential_id <> old.credential_id
       or new.serial_number <> old.serial_number
       or new.certificate_generation <> old.certificate_generation
       or new.assignment_generation <> old.assignment_generation
       or new.public_key_fingerprint <> old.public_key_fingerprint
       or new.issuer_key_id <> old.issuer_key_id
       or new.not_before <> old.not_before
       or new.not_after <> old.not_after
       or new.canonical_tbs <> old.canonical_tbs
       or new.canonical_tbs_hash <> old.canonical_tbs_hash
       or new.head_version_seen <> old.head_version_seen
       or new.device_record_id <> old.device_record_id then
      raise exception
        'KLUY-CRED-RESERVATION-MUTATED: a reserved issuance identifier cannot change after preparation'
        using errcode = 'P0001';
    end if;
    -- A recorded signature is never replaced by a different one.
    if old.detached_signature is not null
       and new.detached_signature is distinct from old.detached_signature then
      raise exception
        'KLUY-CRED-SIGNATURE-REPLACED: the recorded signature for request % cannot be replaced', old.request_id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_device_signing_attempt_transitions
  before insert or update or delete on kitluy_devices.device_credential_signing_attempts
  for each row execute function kitluy_devices.enforce_signing_attempt_transitions();

-- ===========================================================================
-- Canonical TBS construction — the single source of the bytes to be signed
-- ===========================================================================
-- Field order and separators mirror `tbsBytes()` in
-- packages/device-identity/src/dev-crypto.ts EXACTLY. The TypeScript adapter
-- rebuilds the same string from the same reserved values and refuses to sign
-- unless it matches this one byte for byte, so a divergence between the two
-- layers becomes a loud refusal instead of a signature over the wrong bytes.
-- That cross-layer equality check is the RV-TT-001 lesson applied here.
-- ===========================================================================
create or replace function kitluy_devices.build_canonical_device_tbs_v1(
  p_certificate_id uuid,
  p_serial_number text,
  p_environment text,
  p_subject_fingerprint text,
  p_subject_public_key text,
  p_issuer_key_id text,
  p_device_record_id uuid,
  p_certificate_generation integer,
  p_hardware_trust_level kitluy_devices.hardware_trust_level,
  p_not_before timestamptz,
  p_not_after timestamptz
)
returns text
language sql
immutable
set search_path = kitluy_devices, pg_catalog
as $$
  select concat_ws(
    e'\n',
    'kitluy.cert.v1',
    p_certificate_id::text,
    p_serial_number,
    'device',
    'device_identity',
    p_environment,
    p_subject_fingerprint,
    btrim(p_subject_public_key, e' \t\n\r'),
    p_issuer_key_id,
    p_device_record_id::text,
    p_certificate_generation::text,
    p_hardware_trust_level::text,
    'false',
    to_char(p_not_before at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    to_char(p_not_after at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  );
$$;

comment on function kitluy_devices.build_canonical_device_tbs_v1 is
  'The bytes a development device credential is signed over. Mirrors tbsBytes() in the device-identity package field for field; productionEligible is the literal false because §4 admits no other value from a development CA.';

-- ===========================================================================
-- PREPARE
-- ===========================================================================
create or replace function kitluy_devices.prepare_device_credential_issuance_v1(
  p_request_id text,
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_assignment_generation integer,
  p_public_key text,
  p_public_key_fingerprint text,
  p_idempotency_key text,
  p_canonical_payload_hash text,
  p_pop_algorithm text,
  p_pop_signed_preimage_hash text,
  p_pop_signature bytea,
  p_pop_service_verified boolean,
  p_issuer_key_id text,
  p_trusted_time timestamptz,
  p_trusted_time_status text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_device kitluy_devices.devices;
  v_request kitluy_devices.device_credential_requests;
  v_attempt kitluy_devices.device_credential_signing_attempts;
  v_head kitluy_devices.device_credential_heads;
  v_head_version bigint;
  v_generation integer;
  v_credential_id uuid;
  v_serial text;
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

  if v_fingerprint is distinct from p_public_key_fingerprint then
    raise exception
      'KLUY-CRED-FINGERPRINT-MISMATCH: the request attests to a key the device record does not hold'
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
  v_not_before := date_trunc('milliseconds', p_trusted_time);
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
          'verified', p_public_key_fingerprint, p_trusted_time)
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
$$;

comment on function kitluy_devices.prepare_device_credential_issuance_v1 is
  'Stage 1 of governed issuance. Atomically validates eligibility, reserves the deterministic credential id, serial, generation and validity window, BUILDS the canonical TBS, and moves the request to `signing`. Returns only immutable signing material. Idempotent: the same request returns the same attempt and the same TBS; a changed payload under a used request id is refused.';

-- ===========================================================================
-- RECORD SIGNATURE — the recovery artifact, durable before success is claimed
-- ===========================================================================
create or replace function kitluy_devices.record_device_credential_signature_v1(
  p_request_id text,
  p_canonical_tbs_hash text,
  p_detached_signature bytea,
  p_service_verified boolean,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_attempt kitluy_devices.device_credential_signing_attempts;
begin
  select * into v_attempt
  from kitluy_devices.device_credential_signing_attempts
  where request_id = p_request_id for update;

  if not found then
    raise exception 'KLUY-CRED-NO-RESERVATION: no signing attempt for request %', p_request_id
      using errcode = 'P0001';
  end if;

  if v_attempt.state = 'finalized' then
    return jsonb_build_object('outcome', 'ALREADY_FINALIZED', 'request_id', p_request_id);
  end if;
  if v_attempt.state = 'abandoned' then
    raise exception 'KLUY-CRED-ATTEMPT-ABANDONED: attempt for request % was abandoned', p_request_id
      using errcode = 'P0001';
  end if;

  -- The caller echoes the hash back; a mismatch means it signed something
  -- other than what was reserved, and that never becomes a credential.
  if v_attempt.canonical_tbs_hash <> p_canonical_tbs_hash then
    raise exception
      'KLUY-CRED-TBS-MISMATCH: the caller signed a different canonical TBS than was reserved'
      using errcode = 'P0001';
  end if;
  if p_detached_signature is null or octet_length(p_detached_signature) = 0 then
    raise exception 'KLUY-CRED-EMPTY-SIGNATURE: an empty signature is not a signature'
      using errcode = 'P0001';
  end if;
  -- OPTION B: the database cannot check the curve maths. It CAN refuse a
  -- signature the service itself did not attest to.
  if p_service_verified is not true then
    raise exception
      'KLUY-CRED-SIGNATURE-UNATTESTED: the issuance service did not attest that the signature verifies'
      using errcode = 'P0001';
  end if;

  -- Idempotent: re-recording the identical signature is a no-op, a DIFFERENT
  -- one is refused by trg_device_signing_attempt_transitions.
  if v_attempt.state = 'signed' then
    if v_attempt.detached_signature = p_detached_signature then
      return jsonb_build_object('outcome', 'ALREADY_RECORDED', 'request_id', p_request_id,
                                'signature_sha256', v_attempt.signature_sha256);
    end if;
    raise exception
      'KLUY-CRED-SIGNATURE-REPLACED: a different signature is already recorded for request %', p_request_id
      using errcode = 'P0001';
  end if;

  update kitluy_devices.device_credential_signing_attempts
  set state = 'signed',
      detached_signature = p_detached_signature,
      signature_sha256 = encode(extensions.digest(p_detached_signature, 'sha256'), 'hex'),
      service_attested_signature_verified = true,
      signed_at = now()
  where request_id = p_request_id
  returning * into v_attempt;

  update kitluy_devices.device_credential_requests
  set state = 'signed_unpersisted' where request_id = p_request_id;

  insert into kitluy_devices.device_credential_issuance_attempts (
    request_id, device_record_id, from_state, to_state, actor_ref, detail)
  values (p_request_id, v_attempt.device_record_id, 'signing', 'signed_unpersisted',
          p_actor_ref,
          jsonb_build_object('signature_sha256', v_attempt.signature_sha256,
                             'verification_boundary', 'OPTION_B_SERVICE_ATTESTED'));

  return jsonb_build_object('outcome', 'RECORDED', 'request_id', p_request_id,
                            'signature_sha256', v_attempt.signature_sha256);
end;
$$;

comment on function kitluy_devices.record_device_credential_signature_v1 is
  'Stage 2. Makes the signature DURABLE before any success is reported, so a crash between signing and finalization is recovered with the ORIGINAL signature instead of a second one. The request moves to `signed_unpersisted` — the honest name for "a signature exists that no credential accounts for".';

-- ===========================================================================
-- FINALIZE
-- ===========================================================================
create or replace function kitluy_devices.finalize_device_credential_issuance_v1(
  p_request_id text,
  p_chain_links jsonb,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_attempt kitluy_devices.device_credential_signing_attempts;
  v_request kitluy_devices.device_credential_requests;
  v_device kitluy_devices.devices;
  v_head kitluy_devices.device_credential_heads;
  v_recomputed_tbs text;
  v_credential kitluy_devices.device_credentials;
  v_link jsonb;
  v_link_count integer;
  v_pop kitluy_devices.pop_verification_status;
  v_fingerprint text;
begin
  -- -----------------------------------------------------------------------
  -- LOCK, in a fixed order: attempt, request, device, head.
  -- -----------------------------------------------------------------------
  select * into v_attempt
  from kitluy_devices.device_credential_signing_attempts
  where request_id = p_request_id for update;
  if not found then
    raise exception 'KLUY-CRED-NO-RESERVATION: no signing attempt for request %', p_request_id
      using errcode = 'P0001';
  end if;

  -- Finalization RETRY returns the already-issued result. It does not re-issue.
  if v_attempt.state = 'finalized' then
    select * into v_credential from kitluy_devices.device_credentials
    where created_from_request_id = p_request_id;
    return jsonb_build_object(
      'outcome', 'ALREADY_ISSUED',
      'credential_id', v_credential.credential_id,
      'serial_number', v_credential.serial_number,
      'certificate_generation', v_credential.certificate_generation);
  end if;
  if v_attempt.state <> 'signed' then
    raise exception
      'KLUY-CRED-NOT-SIGNED: attempt for request % is % — finalization requires a recorded signature',
      p_request_id, v_attempt.state using errcode = 'P0001';
  end if;

  select * into v_request from kitluy_devices.device_credential_requests
  where request_id = p_request_id for update;
  if v_request.state not in ('signing', 'signed_unpersisted') then
    raise exception
      'KLUY-CRED-REQUEST-STATE: request % is %, which cannot be finalized', p_request_id, v_request.state
      using errcode = 'P0001';
  end if;

  select verification_status into v_pop
  from kitluy_devices.device_proof_of_possession_results where request_id = p_request_id;
  if v_pop is distinct from 'verified' then
    raise exception
      'KLUY-CRED-NO-PROOF-OF-POSSESSION: request % has no VERIFIED proof of possession', p_request_id
      using errcode = 'P0001';
  end if;

  -- Read-only for the same reason as in prepare; the 0125 trigger re-checks.
  select * into v_device from kitluy_devices.devices
  where id = v_attempt.device_record_id;

  -- REVALIDATION. Preparation is not a licence: everything is checked again
  -- under the lock, because time passed while the CA was signing.
  if v_device.assignment_generation is distinct from v_attempt.assignment_generation then
    raise exception
      'KLUY-CRED-STALE-ASSIGNMENT: assignment generation moved from % to % during signing',
      v_attempt.assignment_generation, v_device.assignment_generation using errcode = 'P0001';
  end if;

  select e.device_public_key_fingerprint into v_fingerprint
  from kitluy_devices.manufacturing_enrollments e
  where e.id = v_device.current_enrollment_id;

  if v_fingerprint is distinct from v_attempt.public_key_fingerprint then
    raise exception
      'KLUY-CRED-FINGERPRINT-MISMATCH: the device key changed during signing'
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception
      'KLUY-CRED-DEVICE-STATE: device moved to % during signing', v_device.lifecycle_state
      using errcode = 'P0001';
  end if;
  if exists (select 1 from kitluy_devices.device_trust_incidents
             where device_id = v_attempt.device_record_id and cleared_at is null) then
    raise exception
      'KLUY-CRED-OPEN-TRUST-INCIDENT: a blocking trust incident opened during signing'
      using errcode = 'P0001';
  end if;

  -- THE BINDING CHECK. The canonical TBS is REBUILT from the reserved fields
  -- and compared to the stored one. Under OPTION B this is what replaces
  -- signature verification: the database cannot check the curve maths, but it
  -- can prove the signed bytes are exactly the bytes it reserved, and that no
  -- field was swapped between preparation and finalization.
  v_recomputed_tbs := kitluy_devices.build_canonical_device_tbs_v1(
    v_attempt.credential_id, v_attempt.serial_number, v_attempt.environment,
    v_attempt.public_key_fingerprint, v_request.public_key, v_attempt.issuer_key_id,
    v_attempt.device_record_id, v_attempt.certificate_generation,
    v_device.hardware_trust_level, v_attempt.not_before, v_attempt.not_after);

  if v_recomputed_tbs <> v_attempt.canonical_tbs then
    raise exception
      'KLUY-CRED-TBS-MISMATCH: the reserved TBS no longer matches the reserved fields'
      using errcode = 'P0001';
  end if;
  if encode(extensions.digest(v_attempt.canonical_tbs, 'sha256'), 'hex')
     <> v_attempt.canonical_tbs_hash then
    raise exception 'KLUY-CRED-TBS-HASH-MISMATCH: the stored TBS hash does not match the stored TBS'
      using errcode = 'P0001';
  end if;
  if encode(extensions.digest(v_attempt.detached_signature, 'sha256'), 'hex')
     <> v_attempt.signature_sha256 then
    raise exception
      'KLUY-CRED-SIGNATURE-HASH-MISMATCH: the recorded signature does not match its recorded hash'
      using errcode = 'P0001';
  end if;

  -- HEAD COMPARE-AND-SWAP. The loser of two concurrent renewals is refused
  -- here, by exactly this check.
  select * into v_head from kitluy_devices.device_credential_heads
  where device_record_id = v_attempt.device_record_id
    and environment = v_attempt.environment
    and purpose = v_attempt.purpose
  for update;

  if found then
    if v_head.version <> v_attempt.head_version_seen then
      insert into kitluy_devices.device_credential_renewal_attempts (
        device_record_id, environment, from_generation, to_generation, outcome,
        refusal_code, head_version_seen, actor_ref)
      values (v_attempt.device_record_id, v_attempt.environment,
              v_head.current_generation, v_attempt.certificate_generation, 'REFUSED',
              'RENEWAL_GENERATION_CONFLICT', v_attempt.head_version_seen, p_actor_ref);
      raise exception
        'KLUY-CRED-RENEWAL-GENERATION-CONFLICT: head moved from version % to % during signing',
        v_attempt.head_version_seen, v_head.version using errcode = 'P0001';
    end if;
  elsif v_attempt.head_version_seen <> 0 then
    raise exception
      'KLUY-CRED-HEAD-MISSING: reservation expected head version % but no head exists',
      v_attempt.head_version_seen using errcode = 'P0001';
  end if;

  -- -----------------------------------------------------------------------
  -- PERSIST. Audit FIRST: group 0125's integrity trigger refuses a credential
  -- whose audit row is not already present in this transaction.
  -- -----------------------------------------------------------------------
  -- credential_id is deliberately NULL here; the reserved value travels in the
  -- detail payload instead. Group 0125 pins two requirements that point opposite ways:
  -- its integrity trigger refuses a credential whose audit row is not ALREADY
  -- present, while the audit table's foreign key refuses a credential_id that
  -- does not YET exist. Audit-before-credential is the one that must win, since
  -- it is what makes  unreachable without an audit trail. The typed
  -- column is therefore unusable on this path; the credential is still joinable
  -- through device_credentials.created_from_request_id.
  insert into kitluy_devices.device_credential_issuance_attempts (
    request_id, device_record_id, from_state, to_state, credential_id,
    actor_ref, detail)
  values (p_request_id, v_attempt.device_record_id, 'signed_unpersisted', 'issued',
          null, p_actor_ref,
          jsonb_build_object('credential_id', v_attempt.credential_id,
                             'serial_number', v_attempt.serial_number,
                             'certificate_generation', v_attempt.certificate_generation,
                             'signature_sha256', v_attempt.signature_sha256,
                             'verification_boundary', 'OPTION_B_SERVICE_ATTESTED'));

  insert into kitluy_devices.device_credentials (
    credential_id, serial_number, device_record_id, environment, purpose,
    public_key, public_key_fingerprint, issuer_key_id, certificate_generation,
    assignment_generation, not_before, not_after, hardware_trust_level,
    canonical_tbs, detached_signature, created_from_request_id, state)
  values (
    v_attempt.credential_id, v_attempt.serial_number, v_attempt.device_record_id,
    v_attempt.environment, v_attempt.purpose, v_request.public_key,
    v_attempt.public_key_fingerprint, v_attempt.issuer_key_id,
    v_attempt.certificate_generation, v_attempt.assignment_generation,
    v_attempt.not_before, v_attempt.not_after, v_device.hardware_trust_level,
    v_attempt.canonical_tbs, v_attempt.detached_signature, p_request_id, 'issued')
  returning * into v_credential;

  -- Chain links. The caller supplies the CA links ONLY — root at position 0
  -- and intermediate at position 1. The DEVICE link is built here from the
  -- attempt's own reserved TBS and recorded signature, so a caller cannot
  -- substitute a different device link for the one it had signed. That is the
  -- owner's "no caller-supplied replacement for a reserved field", applied to
  -- the chain as well as to the credential.
  v_link_count := 0;
  for v_link in select * from jsonb_array_elements(coalesce(p_chain_links, '[]'::jsonb))
  loop
    if (v_link ->> 'role') = 'device' then
      raise exception
        'KLUY-CRED-DEVICE-LINK-SUPPLIED: the device chain link is built from the reservation, never accepted from the caller'
        using errcode = 'P0001';
    end if;
    insert into kitluy_devices.device_credential_chain_links (
      credential_id, link_position, role, subject_fingerprint, issuer_key_id,
      environment, purpose, canonical_tbs, detached_signature)
    values (
      v_attempt.credential_id,
      (v_link ->> 'link_position')::integer,
      v_link ->> 'role',
      v_link ->> 'subject_fingerprint',
      v_link ->> 'issuer_key_id',
      v_attempt.environment,
      v_attempt.purpose,
      v_link ->> 'canonical_tbs',
      decode(v_link ->> 'detached_signature_b64', 'base64'));
    v_link_count := v_link_count + 1;
  end loop;

  if v_link_count <> 2 then
    raise exception
      'KLUY-CRED-INCOMPLETE-CHAIN: % CA chain link(s) supplied; root and intermediate are both required', v_link_count
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_credential_chain_links (
    credential_id, link_position, role, subject_fingerprint, issuer_key_id,
    environment, purpose, canonical_tbs, detached_signature)
  values (
    v_attempt.credential_id, 2, 'device', v_attempt.public_key_fingerprint,
    v_attempt.issuer_key_id, v_attempt.environment, v_attempt.purpose,
    v_attempt.canonical_tbs, v_attempt.detached_signature);

  -- Advance the head. INSERT when this is the first generation, compare-and-
  -- swap UPDATE otherwise. The overlap pointer is set only on renewal.
  if v_head.device_record_id is null then
    insert into kitluy_devices.device_credential_heads (
      device_record_id, environment, purpose, current_generation, version)
    values (v_attempt.device_record_id, v_attempt.environment, v_attempt.purpose,
            v_attempt.certificate_generation, 1);
  else
    update kitluy_devices.device_credential_heads
    set current_generation = v_attempt.certificate_generation,
        previous_generation = v_head.current_generation,
        overlap_ends_at = least(
          v_attempt.not_before + interval '3 days',
          (select not_after from kitluy_devices.device_credentials
           where device_record_id = v_attempt.device_record_id
             and environment = v_attempt.environment
             and purpose = v_attempt.purpose
             and certificate_generation = v_head.current_generation)),
        version = v_head.version + 1,
        updated_at = now()
    where device_record_id = v_attempt.device_record_id
      and environment = v_attempt.environment
      and purpose = v_attempt.purpose
      and version = v_attempt.head_version_seen;

    if not found then
      raise exception
        'KLUY-CRED-RENEWAL-GENERATION-CONFLICT: the head moved between check and swap'
        using errcode = 'P0001';
    end if;

    insert into kitluy_devices.device_credential_renewal_attempts (
      device_record_id, environment, from_generation, to_generation, outcome,
      head_version_seen, actor_ref)
    values (v_attempt.device_record_id, v_attempt.environment,
            v_head.current_generation, v_attempt.certificate_generation, 'RENEWED',
            v_attempt.head_version_seen, p_actor_ref);
  end if;

  update kitluy_devices.device_credential_signing_attempts
  set state = 'finalized', finalized_at = now() where request_id = p_request_id;

  update kitluy_devices.device_credential_requests
  set state = 'issued' where request_id = p_request_id;

  return jsonb_build_object(
    'outcome', 'ISSUED',
    'credential_id', v_credential.credential_id,
    'serial_number', v_credential.serial_number,
    'certificate_generation', v_credential.certificate_generation,
    'not_before', to_char(v_credential.not_before at time zone 'UTC',
                          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'not_after', to_char(v_credential.not_after at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'verification_boundary', 'OPTION_B_SERVICE_ATTESTED');
end;
$$;

comment on function kitluy_devices.finalize_device_credential_issuance_v1 is
  'Stage 3. Locks and revalidates the attempt, request, device, assignment generation and head version; REBUILDS the canonical TBS from the reserved fields and refuses any drift; then writes audit, credential, chain links and the head advance in ONE transaction. Accepts no caller-supplied replacement for any reserved field. OPTION B: signature validity is attested by the issuance service, which is therefore inside the trusted computing base (KLRISK-DEVICE-003).';

-- ===========================================================================
-- Grants, policies and ownership
-- ===========================================================================
-- The definer owner needs its own explicit privileges: RLS ENABLE+FORCE binds
-- the owner too, so a grant without a policy yields zero rows (the group-0126
-- lesson, applied here before it can bite).
-- extensions.digest() is the SHA-256 the finalizer recomputes with. Under
-- OPTION B it is the only cryptographic primitive the database uses, so the
-- definer owner needs USAGE on the schema that holds it.
grant usage on schema extensions to kitluy_credential_issuer;

grant select on kitluy_devices.devices, kitluy_devices.device_trust_incidents,
  kitluy_devices.pki_trust_configuration,
  kitluy_devices.manufacturing_enrollments to kitluy_credential_issuer;
grant select, insert, update on
  kitluy_devices.device_credential_requests,
  kitluy_devices.device_proof_of_possession_results,
  kitluy_devices.device_credential_chain_links,
  kitluy_devices.device_credential_issuance_attempts,
  kitluy_devices.device_credential_orphan_incidents,
  kitluy_devices.device_credential_renewal_attempts,
  kitluy_devices.device_credential_signing_attempts
  to kitluy_credential_issuer;

alter table kitluy_devices.device_credential_signing_attempts enable row level security;
alter table kitluy_devices.device_credential_signing_attempts force row level security;

do $issuer_policies$
declare
  r text;
begin
  foreach r in array array[
    'devices', 'device_trust_incidents', 'pki_trust_configuration',
    'manufacturing_enrollments']
  loop
    execute format(
      'create policy %I on kitluy_devices.%I for select to kitluy_credential_issuer using (true)',
      r || '_issuer_read', r);
  end loop;

  foreach r in array array[
    'device_credential_requests', 'device_proof_of_possession_results',
    'device_credential_chain_links', 'device_credential_issuance_attempts',
    'device_credential_orphan_incidents', 'device_credential_renewal_attempts',
    'device_credential_signing_attempts']
  loop
    execute format(
      'create policy %I on kitluy_devices.%I for all to kitluy_credential_issuer using (true) with check (true)',
      r || '_issuer_write', r);
  end loop;
end
$issuer_policies$;

-- Read-only visibility of the reservation for the service path. It may SEE
-- what was reserved; it may not write it.
grant select on kitluy_devices.device_credential_signing_attempts to service_role;
create policy device_credential_signing_attempts_service_read
  on kitluy_devices.device_credential_signing_attempts
  for select to service_role using (true);

alter function kitluy_devices.build_canonical_device_tbs_v1(
  uuid, text, text, text, text, text, uuid, integer,
  kitluy_devices.hardware_trust_level, timestamptz, timestamptz)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.prepare_device_credential_issuance_v1(
  text, uuid, text, text, integer, text, text, text, text, text, text, bytea,
  boolean, text, timestamptz, text, text) owner to kitluy_credential_issuer;
alter function kitluy_devices.record_device_credential_signature_v1(
  text, text, bytea, boolean, text) owner to kitluy_credential_issuer;
alter function kitluy_devices.finalize_device_credential_issuance_v1(
  text, jsonb, text) owner to kitluy_credential_issuer;

-- ONLY the named issuance service may execute the three stages. `public` never
-- holds EXECUTE on them; the default grant PostgreSQL adds at creation is
-- revoked explicitly rather than assumed absent (the group-0020 lesson).
do $issuance_grants$
declare
  r text;
begin
  foreach r in array array[
    'prepare_device_credential_issuance_v1(text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'record_device_credential_signature_v1(text, text, bytea, boolean, text)',
    'finalize_device_credential_issuance_v1(text, jsonb, text)',
    'build_canonical_device_tbs_v1(uuid, text, text, text, text, text, uuid, integer, kitluy_devices.hardware_trust_level, timestamptz, timestamptz)']
  loop
    execute format('revoke all on function kitluy_devices.%s from public', r);
    execute format('revoke all on function kitluy_devices.%s from service_role', r);
    execute format('grant execute on function kitluy_devices.%s to kitluy_issuance_service', r);
  end loop;
end
$issuance_grants$;

-- `service_role` IS the trusted issuance service in this stack, so it may
-- ASSUME the named role — and under OPTION B that is consistent with the
-- recorded trust model rather than a hole in it. What it still cannot do is
-- write kitluy_devices.device_credentials directly: that trigger demands
-- kitluy_credential_issuer, and service_role is not a member of it.
grant kitluy_issuance_service to service_role;

-- Every function this migration ADDS starts life EXECUTE-able by PUBLIC —
-- PostgreSQL grants that at creation and no later GRANT revokes it. Group
-- 0125's loop ran before these existed, so the sweep is repeated here.
-- Caught by assertion 32b, which failed on
-- `enforce_signing_attempt_transitions() is EXECUTE-able by PUBLIC` the first
-- time this migration ran: the hardening added last cycle found the gap in the
-- migration written this cycle.
do $revoke_public$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
  end loop;
end
$revoke_public$;

-- Re-assert the issuance grants: the sweep above revoked from PUBLIC, and the
-- named service role must still reach the three stages.
do $regrant_service$
declare
  r text;
begin
  foreach r in array array[
    'prepare_device_credential_issuance_v1(text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'record_device_credential_signature_v1(text, text, bytea, boolean, text)',
    'finalize_device_credential_issuance_v1(text, jsonb, text)']
  loop
    execute format('grant execute on function kitluy_devices.%s to kitluy_issuance_service', r);
  end loop;
end
$regrant_service$;

-- ---------------------------------------------------------------------------
-- Hand the membership back. Group 0125's lesson: NOLOGIN is not the guarantee,
-- non-membership is, and `postgres` here is login-capable with BYPASSRLS.
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
