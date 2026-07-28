-- kitluy:group:0128
-- Migration group 0128: renewal_key_lifecycle (WS-11-T003 Step 4, unit 5).
--
-- Additive. Groups 0120-0127 are COMMITTED and are NOT edited — every change
-- here is a new table, a new column, a new trigger or a new function.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- 1. THE AUDIT/FK DIVERGENCE, RESOLVED ALONG OPTION A
-- ===========================================================================
-- Group 0127 wrote the issuance audit with `credential_id = NULL` and put the
-- reserved identifier in free-form `detail`, because 0125 requires the audit
-- row BEFORE the credential while its own foreign key requires the credential
-- BEFORE the audit.
--
-- The owner ruled that free-form JSON is acceptable only as a versioned
-- temporary contract and must not become the permanent relationship. This
-- migration takes Option A: the audit gains a TYPED reference to the signing
-- attempt, which exists at preparation time and therefore has no ordering
-- problem at all. `credential_id` stays a typed audit field to be populated by
-- a later immutable linkage event; `detail.credential_id` remains, and an
-- assertion now proves the two agree with the reservation.
--
-- ===========================================================================
-- 2. THE REPLACEMENT-KEY STATE MACHINE
-- ===========================================================================
-- A renewal that loses the head compare-and-swap has already generated a key.
-- Without a state machine that key is indistinguishable from the winner's, and
-- a later request could present it. So keys are rows with states, and only
-- `generated` may enter proof of possession while only the finalized winning
-- generation may become `active`.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- Typed audit linkage (Option A)
-- ===========================================================================
alter table kitluy_devices.device_credential_issuance_attempts
  add column if not exists issuance_attempt_id uuid
    references kitluy_devices.device_credential_signing_attempts (id);

comment on column kitluy_devices.device_credential_issuance_attempts.issuance_attempt_id is
  'TYPED reference to the signing attempt (reservation). Populated automatically by trg_device_issuance_attempt_linkage. Exists at preparation time, so unlike credential_id it has no audit-before-credential ordering conflict — this is the Option A resolution of the group-0127 divergence.';

-- Populated by trigger rather than by editing group 0127's functions, which
-- are committed. The trigger runs BEFORE INSERT, so the linkage is not
-- something a caller can omit or forge.
create or replace function kitluy_devices.link_issuance_attempt()
returns trigger
language plpgsql
as $$
begin
  if new.issuance_attempt_id is null then
    select a.id into new.issuance_attempt_id
    from kitluy_devices.device_credential_signing_attempts a
    where a.request_id = new.request_id;
  end if;
  return new;
end;
$$;

create trigger trg_device_issuance_attempt_linkage
  before insert on kitluy_devices.device_credential_issuance_attempts
  for each row execute function kitluy_devices.link_issuance_attempt();

-- ===========================================================================
-- Replacement keys
-- ===========================================================================
create type kitluy_devices.device_key_state as enum (
  'generated',
  'active',
  'superseded',
  'abandoned',
  'destroyed'
);

comment on type kitluy_devices.device_key_state is
  'Only `generated` may enter proof of possession; only the finalized winning generation may become `active`. A renewal that loses the head compare-and-swap marks its key `abandoned`, which is terminal for issuance — that is what stops a loser key being presented by a later request.';

create table if not exists kitluy_devices.device_generation_keys (
  id uuid primary key default gen_random_uuid(),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  generation integer not null,
  key_handle text not null,
  public_key text not null,
  public_key_fingerprint text not null,
  state kitluy_devices.device_key_state not null default 'generated',
  abandon_reason text,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  superseded_at timestamptz,
  abandoned_at timestamptz,
  destroyed_at timestamptz,

  constraint device_generation_keys_gen_key
    unique (device_record_id, environment, purpose, generation),
  -- A fingerprint is claimed ONCE per environment. Two generations presenting
  -- the same key would defeat the point of generating a replacement.
  constraint device_generation_keys_fingerprint_key
    unique (environment, public_key_fingerprint),
  constraint device_generation_keys_env_chk check (environment = 'development'),
  constraint device_generation_keys_purpose_chk check (purpose = 'device_identity'),
  constraint device_generation_keys_generation_chk check (generation >= 1),
  constraint device_generation_keys_fingerprint_chk
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint device_generation_keys_abandon_chk
    check ((state = 'abandoned') = (abandon_reason is not null))
);

comment on table kitluy_devices.device_generation_keys is
  'Owner: Fleet. One row per device key generation, with a state machine. PUBLIC METADATA ONLY — the private half never leaves the provider and is never stored here. MC: MUT (state machine only).';

create or replace function kitluy_devices.enforce_device_key_transitions()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-KEY-IMMUTABLE: a device key row is abandoned or destroyed, never deleted'
      using errcode = 'P0001';
  end if;

  if current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-KEY-UNAUTHORIZED: only the governed path may write a device key row (current_user %)', current_user
      using errcode = 'P0001';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'generated' then
      raise exception 'KLUY-KEY-BAD-INITIAL-STATE: a key row is created `generated`, not %', new.state
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- The reserved facts never change; only the state does.
  if new.device_record_id <> old.device_record_id
     or new.generation <> old.generation
     or new.public_key_fingerprint <> old.public_key_fingerprint
     or new.key_handle <> old.key_handle
     or new.public_key <> old.public_key then
    raise exception 'KLUY-KEY-MUTATED: a generated key''s identity cannot change'
      using errcode = 'P0001';
  end if;

  if new.state = old.state then
    return new;
  end if;

  -- The whole containment in one table: `abandoned` and `destroyed` are
  -- terminal for issuance, so a loser key can never be promoted afterwards.
  if not (
       (old.state = 'generated'  and new.state in ('active', 'abandoned', 'destroyed'))
    or (old.state = 'active'     and new.state in ('superseded', 'destroyed'))
    or (old.state = 'superseded' and new.state = 'destroyed')
    or (old.state = 'abandoned'  and new.state = 'destroyed')
  ) then
    raise exception 'KLUY-KEY-BAD-TRANSITION: % -> % is not a permitted device key transition',
      old.state, new.state using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_device_generation_keys_transitions
  before insert or update or delete on kitluy_devices.device_generation_keys
  for each row execute function kitluy_devices.enforce_device_key_transitions();

-- ---------------------------------------------------------------------------
-- Promotion is a CONSEQUENCE of issuance, not a separate call a caller could
-- make on its own. Attached to the credential insert so only a finalized
-- credential can activate a key, and so the previous generation is superseded
-- in the SAME transaction.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.promote_generation_key()
returns trigger
language plpgsql
as $$
declare
  v_state kitluy_devices.device_key_state;
begin
  select state into v_state from kitluy_devices.device_generation_keys
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and generation = new.certificate_generation;

  if not found then
    -- Initial issuance predates the key registry in some development flows.
    -- Absence is permitted; a WRONG state is not.
    return new;
  end if;

  if v_state <> 'generated' then
    raise exception
      'KLUY-KEY-NOT-GENERATED: generation % holds a % key; only a `generated` key may be issued against',
      new.certificate_generation, v_state using errcode = 'P0001';
  end if;

  update kitluy_devices.device_generation_keys
  set state = 'active', activated_at = now()
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and generation = new.certificate_generation;

  update kitluy_devices.device_generation_keys
  set state = 'superseded', superseded_at = now()
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and generation < new.certificate_generation
    and state = 'active';

  return new;
end;
$$;

create trigger trg_device_credentials_promote_key
  after insert on kitluy_devices.device_credentials
  for each row execute function kitluy_devices.promote_generation_key();

-- ===========================================================================
-- Governed key operations
-- ===========================================================================
create or replace function kitluy_devices.register_generation_key_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_generation integer,
  p_key_handle text,
  p_public_key text,
  p_public_key_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_row kitluy_devices.device_generation_keys;
begin
  if p_environment <> 'development' then
    raise exception 'KLUY-KEY-ENVIRONMENT-BLOCKED: % key registration is BLOCKED', p_environment
      using errcode = 'P0001';
  end if;

  -- Idempotent: re-registering the SAME key for the same generation replays.
  select * into v_row from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = p_generation
  for update;

  if found then
    if v_row.public_key_fingerprint <> p_public_key_fingerprint then
      raise exception
        'KLUY-KEY-GENERATION-TAKEN: generation % already holds a different key for this device', p_generation
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'ALREADY_REGISTERED', 'key_id', v_row.id,
                              'state', v_row.state);
  end if;

  insert into kitluy_devices.device_generation_keys (
    device_record_id, environment, purpose, generation, key_handle,
    public_key, public_key_fingerprint)
  values (p_device_record_id, p_environment, p_purpose, p_generation,
          p_key_handle, p_public_key, p_public_key_fingerprint)
  returning * into v_row;

  return jsonb_build_object('outcome', 'REGISTERED', 'key_id', v_row.id, 'state', v_row.state);
end;
$$;

comment on function kitluy_devices.register_generation_key_v1 is
  'Records the PUBLIC metadata of a key the provider generated. The private half never appears here. Idempotent per generation; a different key for a taken generation is refused rather than overwriting.';

create or replace function kitluy_devices.abandon_generation_key_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_generation integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $$
declare
  v_row kitluy_devices.device_generation_keys;
begin
  select * into v_row from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = p_generation
  for update;

  if not found then
    raise exception 'KLUY-KEY-MISSING: no key registered for generation %', p_generation
      using errcode = 'P0001';
  end if;
  if v_row.state = 'abandoned' then
    return jsonb_build_object('outcome', 'ALREADY_ABANDONED', 'key_id', v_row.id);
  end if;
  -- An ACTIVE key is not abandoned by the loser's cleanup path. If this fires,
  -- the caller is abandoning the winner, which the transition table refuses.
  update kitluy_devices.device_generation_keys
  set state = 'abandoned', abandoned_at = now(), abandon_reason = p_reason
  where id = v_row.id;

  return jsonb_build_object('outcome', 'ABANDONED', 'key_id', v_row.id);
end;
$$;

comment on function kitluy_devices.abandon_generation_key_v1 is
  'Marks a losing renewal''s replacement key abandoned. Called in a NEW transaction after KLUY-CRED-RENEWAL-GENERATION-CONFLICT, because the conflict itself raises and rolls back. Refuses to abandon an `active` key — that would be abandoning the winner.';

-- ===========================================================================
-- RENEWAL PREPARATION — the same pipeline, with renewal gates on top
-- ===========================================================================
create or replace function kitluy_devices.prepare_device_credential_renewal_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_request_id text,
  p_idempotency_key text,
  p_canonical_payload_hash text,
  p_public_key text,
  p_public_key_fingerprint text,
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
  v_head kitluy_devices.device_credential_heads;
  v_current kitluy_devices.device_credentials;
  v_device kitluy_devices.devices;
  v_key kitluy_devices.device_generation_keys;
  v_next integer;
  v_days numeric;
  v_overlap_days numeric;
begin
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-RENEWAL-NO-TRUSTED-TIME: renewal requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;

  -- Lock the head FIRST. Everything below is decided under it.
  select * into v_head from kitluy_devices.device_credential_heads
  where device_record_id = p_device_record_id
    and environment = p_environment and purpose = p_purpose
  for update;
  if not found then
    raise exception 'KLUY-RENEWAL-NO-CURRENT-CREDENTIAL: nothing to renew for this device'
      using errcode = 'P0001';
  end if;

  select * into v_current from kitluy_devices.device_credentials
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and certificate_generation = v_head.current_generation;
  if not found then
    raise exception 'KLUY-RENEWAL-NO-CURRENT-CREDENTIAL: the head points at no credential'
      using errcode = 'P0001';
  end if;

  -- Revoked or expired credentials route to RECOVERY, never renewal. The codes
  -- are distinct so the caller cannot treat them as a retryable renewal.
  if v_current.state = 'revoked' then
    raise exception
      'KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY: generation % is revoked; recovery, not renewal',
      v_current.certificate_generation using errcode = 'P0001';
  end if;
  if v_current.not_after <= p_trusted_time then
    raise exception
      'KLUY-RENEWAL-EXPIRED-REQUIRES-RECOVERY: generation % expired at %; recovery, not renewal',
      v_current.certificate_generation, v_current.not_after using errcode = 'P0001';
  end if;

  -- §5 development renewal window: 10 days, INCLUSIVE. A device that wakes
  -- once a day would otherwise skip its window entirely.
  v_days := extract(epoch from (v_current.not_after - p_trusted_time)) / 86400.0;
  if v_days > 10 then
    raise exception
      'KLUY-RENEWAL-TOO-EARLY: % day(s) remain; the development renewal window is 10 days',
      round(v_days, 3) using errcode = 'P0001';
  end if;

  -- §5 maximum overlap: 3 days, measured from the new credential's activation.
  v_overlap_days := least(v_days, 3);
  if v_overlap_days > 3 then
    raise exception 'KLUY-RENEWAL-OVERLAP-EXCEEDED: an overlap of % days exceeds the 3-day maximum',
      round(v_overlap_days, 3) using errcode = 'P0001';
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_record_id;
  if v_device.assignment_generation is distinct from v_current.assignment_generation then
    raise exception
      'KLUY-RENEWAL-STALE-ASSIGNMENT: the device was reassigned (% -> %) since the current credential',
      v_current.assignment_generation, v_device.assignment_generation using errcode = 'P0001';
  end if;

  v_next := v_head.current_generation + 1;

  -- A renewal already reserved for the next generation is not duplicated. The
  -- head compare-and-swap would catch the second one later, but refusing here
  -- avoids generating a key that is guaranteed to be abandoned.
  if exists (
    select 1 from kitluy_devices.device_credential_signing_attempts
    where device_record_id = p_device_record_id and environment = p_environment
      and purpose = p_purpose and certificate_generation = v_next
      and state in ('reserved', 'signed')
      and request_id <> p_request_id
  ) then
    raise exception
      'KLUY-RENEWAL-ALREADY-RESERVED: generation % already has an unfinished reservation', v_next
      using errcode = 'P0001';
  end if;

  -- THE REPLACEMENT KEY. §5.1 requires a NEW key pair, and it must have been
  -- generated by the provider and registered before proof of possession — a
  -- caller-supplied public key is not sufficient evidence that a private half
  -- exists on the device.
  select * into v_key from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = v_next;
  if not found then
    raise exception
      'KLUY-RENEWAL-NO-REPLACEMENT-KEY: no key registered for generation %; the provider must generate one first', v_next
      using errcode = 'P0001';
  end if;
  if v_key.state <> 'generated' then
    raise exception
      'KLUY-KEY-NOT-GENERATED: the replacement key for generation % is %; only a `generated` key may enter proof of possession',
      v_next, v_key.state using errcode = 'P0001';
  end if;
  if v_key.public_key_fingerprint <> p_public_key_fingerprint then
    raise exception
      'KLUY-RENEWAL-KEY-FINGERPRINT-MISMATCH: the request presents a key the provider did not generate for generation %', v_next
      using errcode = 'P0001';
  end if;
  if v_key.public_key_fingerprint = (
       select public_key_fingerprint from kitluy_devices.device_credentials
       where device_record_id = p_device_record_id and environment = p_environment
         and purpose = p_purpose and certificate_generation = v_head.current_generation) then
    raise exception
      'KLUY-RENEWAL-KEY-REUSED: §5.1 requires a NEW key pair and no hardware rotation policy is approved'
      using errcode = 'P0001';
  end if;

  -- Every renewal gate has passed. Reuse the SAME reservation pipeline: the
  -- renewal path adds gates, it does not fork the issuance logic.
  return kitluy_devices.prepare_device_credential_issuance_v1(
    p_request_id, p_device_record_id, p_environment, p_purpose,
    v_device.assignment_generation, p_public_key, p_public_key_fingerprint,
    p_idempotency_key, p_canonical_payload_hash, p_pop_algorithm,
    p_pop_signed_preimage_hash, p_pop_signature, p_pop_service_verified,
    p_issuer_key_id, p_trusted_time, p_trusted_time_status, p_actor_ref);
end;
$$;

comment on function kitluy_devices.prepare_device_credential_renewal_v1 is
  'Renewal preparation. Locks the head, then checks trusted time, non-revocation, non-expiry, the 10-day INCLUSIVE renewal window, the 3-day overlap ceiling, assignment currency, no duplicate reservation, and a provider-GENERATED replacement key whose fingerprint matches and differs from the incumbent. Then delegates to prepare_device_credential_issuance_v1 — renewal reuses the pipeline rather than forking it. Revoked or expired credentials raise distinct *-REQUIRES-RECOVERY codes.';


-- ===========================================================================
-- REPLACEMENT-KEY ACCEPTANCE — the reason renewal was unreachable
-- ===========================================================================
-- Group 0127 bound the presented fingerprint to the MANUFACTURING ENROLLMENT
-- key alone. That is right for initial issuance and fatal for renewal: §5.1
-- requires a NEW key pair, which by construction never matches the enrollment.
-- Renewal would have failed with KLUY-CRED-FINGERPRINT-MISMATCH every time.
--
-- Both functions are re-emitted here with the check widened to exactly two
-- legitimate sources — the enrollment key, or a provider-GENERATED replacement
-- registered for this device. Nothing else about them changes. Group 0127 is
-- NOT edited; this is a create-or-replace in a new migration, which preserves
-- the existing NOLOGIN ownership.
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

  -- Same two legitimate sources as at preparation. Revalidated rather than
  -- trusted: the enrollment could have been superseded, or the replacement key
  -- abandoned, while the CA was signing.
  if v_fingerprint is distinct from v_attempt.public_key_fingerprint
     and not exists (
       select 1 from kitluy_devices.device_generation_keys k
       where k.device_record_id = v_attempt.device_record_id
         and k.environment = v_attempt.environment
         and k.purpose = v_attempt.purpose
         and k.public_key_fingerprint = v_attempt.public_key_fingerprint
         and k.state = 'generated') then
    raise exception
      'KLUY-CRED-FINGERPRINT-MISMATCH: the device key is no longer one this device legitimately holds'
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


-- ===========================================================================
-- Grants, ownership, policies
-- ===========================================================================
alter table kitluy_devices.device_generation_keys enable row level security;
alter table kitluy_devices.device_generation_keys force row level security;

grant select, insert, update on kitluy_devices.device_generation_keys
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_generation_keys to service_role;

create policy device_generation_keys_issuer_write on kitluy_devices.device_generation_keys
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_generation_keys_service_read on kitluy_devices.device_generation_keys
  for select to service_role using (true);

alter function kitluy_devices.register_generation_key_v1(uuid, text, text, integer, text, text, text)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.abandon_generation_key_v1(uuid, text, text, integer, text)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.prepare_device_credential_renewal_v1(
  uuid, text, text, text, text, text, text, text, text, text, bytea, boolean,
  text, timestamptz, text, text) owner to kitluy_credential_issuer;

-- Every function ADDED here starts EXECUTE-able by PUBLIC. Group 0127 learned
-- this from assertion 32b; repeated rather than assumed.
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

do $issuance_grants$
declare
  r text;
begin
  foreach r in array array[
    'prepare_device_credential_issuance_v1(text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'record_device_credential_signature_v1(text, text, bytea, boolean, text)',
    'finalize_device_credential_issuance_v1(text, jsonb, text)',
    'prepare_device_credential_renewal_v1(uuid, text, text, text, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'register_generation_key_v1(uuid, text, text, integer, text, text, text)',
    'abandon_generation_key_v1(uuid, text, text, integer, text)']
  loop
    execute format('revoke all on function kitluy_devices.%s from service_role', r);
    execute format('grant execute on function kitluy_devices.%s to kitluy_issuance_service', r);
  end loop;
end
$issuance_grants$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
