-- kitluy:group:0130
-- Migration group 0130: renewal_reservation_and_activation (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0129 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- TASK A — RESERVE BEFORE GENERATE
-- ===========================================================================
-- Group 0128 refused to prepare a renewal until a replacement key was already
-- registered. That ordering cannot be made retry-safe: key generation has to be
-- idempotent on a STABLE identifier, and the only stable identifier is the
-- renewal attempt — which did not exist yet. A retry that lost its response had
-- nothing to key on and could generate a second key.
--
-- The reservation now comes FIRST and requires no key at all. Rotation adds key
-- generation as a later stage of an attempt that already exists.
--
-- ===========================================================================
-- TASK D — WHAT THE DATABASE CAN AND CANNOT KNOW
-- ===========================================================================
-- Group 0128 marked a key `active` the instant a credential row was inserted.
-- That asserts something about the EXTERNAL PROVIDER that PostgreSQL has no way
-- to observe. A credential row proves a credential was issued; it proves
-- nothing about whether the private half is loaded and usable on the device.
--
-- So a rotated key now lands in `credential_issued_pending_activation` and only
-- a governed confirmation — carrying nine bindings — moves it to `active`.
--
-- INITIAL ISSUANCE IS NOT A ROTATION. The enrollment key is already operational
-- when the first credential is issued, so it still goes straight to `active`.
-- The trigger distinguishes the two by looking for a rotate_key reservation.

-- ---------------------------------------------------------------------------
-- OUTSIDE the transaction: PostgreSQL forbids USING an enum value added in the
-- same transaction that added it. Same reason group 0121 added `awaiting_trust`
-- outside its transaction.
-- ---------------------------------------------------------------------------
alter type kitluy_devices.device_key_state
  add value if not exists 'credential_issued_pending_activation' before 'active';

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- The renewal reservation
-- ===========================================================================
create type kitluy_devices.renewal_reservation_status as enum (
  'reserved',
  'key_generation_pending',
  'pop_pending',
  'issuance_pending',
  'credential_issued',
  'activation_pending',
  'completed',
  'refused',
  'abandoned'
);

create table if not exists kitluy_devices.device_renewal_reservations (
  renewal_attempt_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null,
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,

  -- FROZEN at reservation. Nothing downstream may replace any of these.
  current_credential_id uuid not null
    references kitluy_devices.device_credentials (credential_id),
  current_credential_generation integer not null,
  next_credential_generation integer not null,
  assignment_generation integer not null,
  renewal_mode kitluy_devices.renewal_mode not null,
  credential_head_version bigint not null,

  status kitluy_devices.renewal_reservation_status not null default 'reserved',
  refusal_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint device_renewal_reservations_idem_key
    unique (environment, idempotency_key),
  -- AT MOST ONE OPEN reservation per next generation. A terminal reservation
  -- releases the slot, so a refused or abandoned attempt does not wedge the
  -- device forever. This is what produces KLUY-RENEWAL-ALREADY-RESERVED rather
  -- than letting two attempts race all the way to the head swap.
  constraint device_renewal_reservations_env_chk check (environment = 'development'),
  constraint device_renewal_reservations_purpose_chk check (purpose = 'device_identity'),
  constraint device_renewal_reservations_generation_chk
    check (next_credential_generation = current_credential_generation + 1),
  constraint device_renewal_reservations_refusal_chk
    check ((status = 'refused') = (refusal_code is not null))
);

create unique index device_renewal_reservations_open_uq
  on kitluy_devices.device_renewal_reservations
  (device_record_id, environment, purpose, next_credential_generation)
  where status not in ('refused', 'abandoned', 'completed');

comment on table kitluy_devices.device_renewal_reservations is
  'Owner: Fleet. The renewal attempt, created BEFORE any key is generated. Every identifier here is frozen at reservation so a retry — which reuses the idempotency key — receives the SAME attempt rather than allocating a second one. The partial unique index permits exactly one OPEN reservation per next generation while letting terminal attempts release the slot.';

comment on column kitluy_devices.device_renewal_reservations.renewal_attempt_id is
  'The stable identifier provider key generation is idempotent on. It cannot exist before the reservation, which is precisely why group 0128''s key-first ordering could not be made retry-safe.';

create or replace function kitluy_devices.enforce_renewal_reservation_integrity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-RENEWAL-RESERVATION-IMMUTABLE: a reservation is refused or abandoned, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-RENEWAL-UNAUTHORIZED: only the governed path may write a renewal reservation (current_user %)', current_user
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    -- Everything frozen at reservation stays frozen. Enforced at row level so
    -- it holds even if a function is wrong.
    if new.renewal_attempt_id <> old.renewal_attempt_id
       or new.device_record_id <> old.device_record_id
       or new.environment <> old.environment
       or new.purpose <> old.purpose
       or new.current_credential_id <> old.current_credential_id
       or new.current_credential_generation <> old.current_credential_generation
       or new.next_credential_generation <> old.next_credential_generation
       or new.assignment_generation <> old.assignment_generation
       or new.renewal_mode <> old.renewal_mode
       or new.credential_head_version <> old.credential_head_version
       or new.idempotency_key <> old.idempotency_key then
      raise exception
        'KLUY-RENEWAL-RESERVATION-MUTATED: a reserved renewal identifier cannot change'
        using errcode = 'P0001';
    end if;
    if old.status in ('completed', 'refused', 'abandoned')
       and new.status <> old.status then
      raise exception
        'KLUY-RENEWAL-RESERVATION-TERMINAL: reservation % is % and cannot be reopened',
        old.renewal_attempt_id, old.status using errcode = 'P0001';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_device_renewal_reservation_integrity
  before insert or update or delete on kitluy_devices.device_renewal_reservations
  for each row execute function kitluy_devices.enforce_renewal_reservation_integrity();

-- ===========================================================================
-- Provider key bindings the activation confirmation needs
-- ===========================================================================
alter table kitluy_devices.device_generation_keys
  add column if not exists renewal_attempt_id uuid
    references kitluy_devices.device_renewal_reservations (renewal_attempt_id),
  add column if not exists key_generation integer,
  add column if not exists activation_confirmed_at timestamptz,
  add column if not exists activation_confirmed_by text;

comment on column kitluy_devices.device_generation_keys.key_generation is
  'The KEY generation, which is NOT the credential generation. Under reuse_current_key the credential generation advances while the key generation does not — group 0128 conflated the two in one field and this separates them.';

comment on column kitluy_devices.device_generation_keys.renewal_attempt_id is
  'The renewal attempt this key was generated for. Provider generation is idempotent on it, and a DIFFERENT attempt may neither receive nor reuse the key.';

-- ===========================================================================
-- RESERVE — no key required, and none consulted
-- ===========================================================================
create or replace function kitluy_devices.reserve_device_credential_renewal_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_idempotency_key text,
  p_trusted_time timestamptz,
  p_trusted_time_status text,
  p_renewal_mode kitluy_devices.renewal_mode,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $reserve$
declare
  v_head kitluy_devices.device_credential_heads;
  v_current kitluy_devices.device_credentials;
  v_device kitluy_devices.devices;
  v_policy kitluy_devices.renewal_policy;
  v_existing kitluy_devices.device_renewal_reservations;
  v_mode kitluy_devices.renewal_mode;
  v_days numeric;
  v_next integer;
  v_row kitluy_devices.device_renewal_reservations;
begin
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-RENEWAL-NO-TRUSTED-TIME: renewal requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;

  -- RETRY FIRST. The same idempotency key returns the SAME attempt before any
  -- eligibility is re-judged, so a retry cannot be refused by a clock that has
  -- moved on since the original reservation.
  select * into v_existing from kitluy_devices.device_renewal_reservations
  where environment = p_environment and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.device_record_id <> p_device_record_id then
      raise exception
        'KLUY-RENEWAL-IDEMPOTENCY-REUSED: this idempotency key belongs to another device'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'outcome', 'REPLAYED_RESERVATION',
      'renewal_attempt_id', v_existing.renewal_attempt_id,
      'renewal_mode', v_existing.renewal_mode::text,
      'next_credential_generation', v_existing.next_credential_generation,
      'current_credential_generation', v_existing.current_credential_generation,
      'current_credential_id', v_existing.current_credential_id,
      'assignment_generation', v_existing.assignment_generation,
      'credential_head_version', v_existing.credential_head_version,
      'status', v_existing.status::text);
  end if;

  select * into v_policy from kitluy_devices.renewal_policy where environment = p_environment;
  if not found then
    raise exception
      'KLUY-RENEWAL-NO-POLICY: no renewal policy is configured for %; no code default may authorize one', p_environment
      using errcode = 'P0001';
  end if;
  v_mode := coalesce(p_renewal_mode, v_policy.default_renewal_mode);
  if v_mode = 'rotate_key' and not v_policy.allow_key_rotation then
    raise exception
      'KLUY-RENEWAL-ROTATION-NOT-PERMITTED: key rotation is disabled for % pending %',
      p_environment, coalesce(v_policy.required_owner_decision, 'an owner decision')
      using errcode = 'P0001';
  end if;

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

  -- §5: 10 days, INCLUSIVE. Exactly ten days remaining is eligible.
  v_days := extract(epoch from (v_current.not_after - p_trusted_time)) / 86400.0;
  if v_days > 10 then
    raise exception
      'KLUY-RENEWAL-TOO-EARLY: % day(s) remain; the development renewal window is 10 days',
      round(v_days, 3) using errcode = 'P0001';
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_record_id;
  if v_device.assignment_generation is distinct from v_current.assignment_generation then
    raise exception
      'KLUY-RENEWAL-STALE-ASSIGNMENT: the device was reassigned (% -> %) since the current credential',
      v_current.assignment_generation, v_device.assignment_generation using errcode = 'P0001';
  end if;

  v_next := v_head.current_generation + 1;

  -- The approved fast-fail. Distinct from RENEWAL_GENERATION_CONFLICT, which is
  -- the LATE compare-and-swap failure at finalization.
  if exists (
    select 1 from kitluy_devices.device_renewal_reservations
    where device_record_id = p_device_record_id and environment = p_environment
      and purpose = p_purpose and next_credential_generation = v_next
      and status not in ('refused', 'abandoned', 'completed')
  ) then
    raise exception
      'KLUY-RENEWAL-ALREADY-RESERVED: generation % already has an open renewal reservation', v_next
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_renewal_reservations (
    idempotency_key, device_record_id, environment, purpose,
    current_credential_id, current_credential_generation, next_credential_generation,
    assignment_generation, renewal_mode, credential_head_version, status)
  values (
    p_idempotency_key, p_device_record_id, p_environment, p_purpose,
    v_current.credential_id, v_head.current_generation, v_next,
    v_device.assignment_generation, v_mode, v_head.version,
    -- rotate_key still needs a key; reuse_current_key is ready to issue.
    case when v_mode = 'rotate_key' then 'key_generation_pending'::kitluy_devices.renewal_reservation_status
         else 'issuance_pending'::kitluy_devices.renewal_reservation_status end)
  returning * into v_row;

  insert into kitluy_devices.device_credential_renewal_attempts (
    device_record_id, environment, from_generation, to_generation, outcome,
    refusal_code, head_version_seen, actor_ref)
  values (p_device_record_id, p_environment, v_head.current_generation, v_next,
          'REFUSED', 'RESERVED_PENDING_ISSUANCE', v_head.version, p_actor_ref);

  return jsonb_build_object(
    'outcome', 'RESERVED',
    'renewal_attempt_id', v_row.renewal_attempt_id,
    'renewal_mode', v_row.renewal_mode::text,
    'next_credential_generation', v_row.next_credential_generation,
    'current_credential_generation', v_row.current_credential_generation,
    'current_credential_id', v_row.current_credential_id,
    'assignment_generation', v_row.assignment_generation,
    'credential_head_version', v_row.credential_head_version,
    'status', v_row.status::text);
end;
$reserve$;

comment on function kitluy_devices.reserve_device_credential_renewal_v1 is
  'TASK A. Creates the renewal attempt BEFORE any key exists and without consulting one. Retry on the same idempotency key returns the SAME attempt, checked before eligibility is re-judged so a moved clock cannot refuse a legitimate retry. A competing attempt for an already-open next generation gets KLUY-RENEWAL-ALREADY-RESERVED — the early fast-fail, distinct from the late RENEWAL_GENERATION_CONFLICT at the head compare-and-swap.';

-- ===========================================================================
-- Rotation key generation is now BOUND to a reservation
-- ===========================================================================
create or replace function kitluy_devices.register_generation_key_v2(
  p_renewal_attempt_id uuid,
  p_key_handle text,
  p_public_key text,
  p_public_key_fingerprint text,
  p_key_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $regkey$
declare
  v_res kitluy_devices.device_renewal_reservations;
  v_row kitluy_devices.device_generation_keys;
begin
  select * into v_res from kitluy_devices.device_renewal_reservations
  where renewal_attempt_id = p_renewal_attempt_id for update;
  if not found then
    raise exception
      'KLUY-RENEWAL-NO-RESERVATION: a replacement key cannot exist before its renewal reservation'
      using errcode = 'P0001';
  end if;
  if v_res.renewal_mode <> 'rotate_key' then
    raise exception
      'KLUY-RENEWAL-NOT-ROTATION: reservation % is %; only rotate_key generates a replacement key',
      p_renewal_attempt_id, v_res.renewal_mode using errcode = 'P0001';
  end if;
  if v_res.status in ('refused', 'abandoned', 'completed') then
    raise exception
      'KLUY-RENEWAL-RESERVATION-TERMINAL: reservation % is %', p_renewal_attempt_id, v_res.status
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENT ON THE ATTEMPT. The same attempt returns the same key reference;
  -- this is exactly what group 0128's key-first ordering could not provide.
  select * into v_row from kitluy_devices.device_generation_keys
  where renewal_attempt_id = p_renewal_attempt_id;
  if found then
    if v_row.public_key_fingerprint <> p_public_key_fingerprint then
      raise exception
        'KLUY-KEY-ATTEMPT-TAKEN: renewal attempt % already holds a different key', p_renewal_attempt_id
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'ALREADY_REGISTERED', 'key_id', v_row.id,
                              'state', v_row.state::text,
                              'provider_key_reference', v_row.key_handle);
  end if;

  insert into kitluy_devices.device_generation_keys (
    device_record_id, environment, purpose, generation, key_handle,
    public_key, public_key_fingerprint, renewal_attempt_id, key_generation)
  values (v_res.device_record_id, v_res.environment, v_res.purpose,
          v_res.next_credential_generation, p_key_handle, p_public_key,
          p_public_key_fingerprint, p_renewal_attempt_id, p_key_generation)
  returning * into v_row;

  update kitluy_devices.device_renewal_reservations
  set status = 'pop_pending' where renewal_attempt_id = p_renewal_attempt_id;

  return jsonb_build_object('outcome', 'REGISTERED', 'key_id', v_row.id,
                            'state', v_row.state::text,
                            'provider_key_reference', v_row.key_handle);
end;
$regkey$;

comment on function kitluy_devices.register_generation_key_v2 is
  'Registers PUBLIC key metadata against an EXISTING rotation reservation. Idempotent on renewal_attempt_id, so a retry that lost its response receives the same provider key reference rather than generating a second key. A reservation in reuse_current_key mode is refused outright.';

-- ===========================================================================
-- TASK D — credential insertion no longer claims provider activation
-- ===========================================================================
create or replace function kitluy_devices.promote_generation_key()
returns trigger
language plpgsql
as $promote$
declare
  v_key kitluy_devices.device_generation_keys;
  v_is_rotation boolean;
begin
  select * into v_key from kitluy_devices.device_generation_keys
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and generation = new.certificate_generation;

  if not found then
    -- reuse_current_key, or an initial issuance with no registered key. There
    -- is no replacement key to promote.
    return new;
  end if;

  if v_key.state <> 'generated' then
    raise exception
      'KLUY-KEY-NOT-GENERATED: generation % holds a % key; only a `generated` key may be issued against',
      new.certificate_generation, v_key.state using errcode = 'P0001';
  end if;

  -- A key generated for a ROTATION reservation cannot be called active here:
  -- the provider has not been asked yet, and PostgreSQL cannot observe it.
  -- An initial-issuance key is different — the enrollment key is already
  -- operational, which is why it still goes straight to `active`.
  v_is_rotation := v_key.renewal_attempt_id is not null;

  update kitluy_devices.device_generation_keys
  set state = case when v_is_rotation
                   then 'credential_issued_pending_activation'::kitluy_devices.device_key_state
                   else 'active'::kitluy_devices.device_key_state end,
      activated_at = case when v_is_rotation then null else now() end
  where id = v_key.id;

  if v_is_rotation then
    update kitluy_devices.device_renewal_reservations
    set status = 'activation_pending'
    where renewal_attempt_id = v_key.renewal_attempt_id;
  end if;

  return new;
end;
$promote$;

comment on function kitluy_devices.promote_generation_key() is
  'TASK D. A credential row proves a credential was issued. It proves NOTHING about whether the private half is loaded and usable in the external provider, so a ROTATED key lands in credential_issued_pending_activation and waits for confirm_provider_key_activation_v1. An initial-issuance key still activates directly: the enrollment key is already operational.';

-- ===========================================================================
-- Governed activation confirmation
-- ===========================================================================
create or replace function kitluy_devices.confirm_provider_key_activation_v1(
  p_renewal_attempt_id uuid,
  p_credential_id uuid,
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_credential_generation integer,
  p_key_generation integer,
  p_provider_key_reference text,
  p_public_key_fingerprint text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $confirm$
declare
  v_res kitluy_devices.device_renewal_reservations;
  v_key kitluy_devices.device_generation_keys;
  v_cred kitluy_devices.device_credentials;
begin
  select * into v_res from kitluy_devices.device_renewal_reservations
  where renewal_attempt_id = p_renewal_attempt_id for update;
  if not found then
    raise exception 'KLUY-ACTIVATION-NO-RESERVATION: no renewal attempt %', p_renewal_attempt_id
      using errcode = 'P0001';
  end if;
  if v_res.status in ('refused', 'abandoned') then
    raise exception
      'KLUY-ACTIVATION-RESERVATION-TERMINAL: reservation % is % and cannot be activated',
      p_renewal_attempt_id, v_res.status using errcode = 'P0001';
  end if;

  select * into v_key from kitluy_devices.device_generation_keys
  where renewal_attempt_id = p_renewal_attempt_id for update;
  if not found then
    raise exception 'KLUY-ACTIVATION-NO-KEY: renewal attempt % registered no key', p_renewal_attempt_id
      using errcode = 'P0001';
  end if;

  -- IDEMPOTENT: the same successful confirmation replays rather than erroring.
  if v_key.state = 'active' then
    if v_key.key_handle <> p_provider_key_reference
       or v_key.public_key_fingerprint <> p_public_key_fingerprint then
      raise exception
        'KLUY-ACTIVATION-MISMATCH: an active key exists for this attempt but with different bindings'
        using errcode = 'P0001';
    end if;
    return jsonb_build_object('outcome', 'ALREADY_ACTIVE', 'key_id', v_key.id);
  end if;

  -- Activation cannot precede issuance. `generated` means the credential has
  -- not been finalized yet, so there is nothing to activate for.
  if v_key.state <> 'credential_issued_pending_activation' then
    raise exception
      'KLUY-ACTIVATION-NOT-PENDING: the key is %; activation follows credential issuance', v_key.state
      using errcode = 'P0001';
  end if;

  -- NINE BINDINGS. Every one is compared against what the database reserved,
  -- never against what the caller asserts about itself.
  if v_res.device_record_id <> p_device_record_id
     or v_key.device_record_id <> p_device_record_id then
    raise exception 'KLUY-ACTIVATION-WRONG-DEVICE: this attempt belongs to another device'
      using errcode = 'P0001';
  end if;
  if v_res.environment <> p_environment or v_res.purpose <> p_purpose then
    raise exception 'KLUY-ACTIVATION-WRONG-SCOPE: environment or purpose does not match the reservation'
      using errcode = 'P0001';
  end if;
  if v_res.next_credential_generation <> p_credential_generation then
    raise exception
      'KLUY-ACTIVATION-WRONG-GENERATION: the reservation targets generation %, not %',
      v_res.next_credential_generation, p_credential_generation using errcode = 'P0001';
  end if;
  if v_key.key_generation is distinct from p_key_generation then
    raise exception
      'KLUY-ACTIVATION-WRONG-KEY-GENERATION: the registered key is key generation %, not %',
      v_key.key_generation, p_key_generation using errcode = 'P0001';
  end if;
  if v_key.key_handle <> p_provider_key_reference then
    raise exception 'KLUY-ACTIVATION-WRONG-PROVIDER-KEY: the provider key reference does not match'
      using errcode = 'P0001';
  end if;
  if v_key.public_key_fingerprint <> p_public_key_fingerprint then
    raise exception 'KLUY-ACTIVATION-WRONG-FINGERPRINT: the fingerprint does not match the registered key'
      using errcode = 'P0001';
  end if;

  select * into v_cred from kitluy_devices.device_credentials
  where credential_id = p_credential_id;
  if not found then
    raise exception 'KLUY-ACTIVATION-NO-CREDENTIAL: credential % does not exist', p_credential_id
      using errcode = 'P0001';
  end if;
  if v_cred.device_record_id <> p_device_record_id
     or v_cred.certificate_generation <> p_credential_generation
     or v_cred.public_key_fingerprint <> p_public_key_fingerprint
     or v_cred.environment <> p_environment
     or v_cred.purpose <> p_purpose then
    raise exception
      'KLUY-ACTIVATION-WRONG-CREDENTIAL: credential % is not the one this attempt issued', p_credential_id
      using errcode = 'P0001';
  end if;

  update kitluy_devices.device_generation_keys
  set state = 'active', activated_at = now(),
      activation_confirmed_at = now(), activation_confirmed_by = p_actor_ref
  where id = v_key.id;

  update kitluy_devices.device_generation_keys
  set state = 'superseded', superseded_at = now()
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation < p_credential_generation
    and state = 'active';

  update kitluy_devices.device_renewal_reservations
  set status = 'completed' where renewal_attempt_id = p_renewal_attempt_id;

  return jsonb_build_object('outcome', 'ACTIVATED', 'key_id', v_key.id,
                            'renewal_attempt_id', p_renewal_attempt_id);
end;
$confirm$;

comment on function kitluy_devices.confirm_provider_key_activation_v1 is
  'TASK D. Moves a rotated key from credential_issued_pending_activation to active, and only then completes the renewal. Nine bindings are compared against what the DATABASE reserved rather than what the caller asserts. Idempotent for an identical successful confirmation; refuses activation before issuance, and refuses a terminal reservation.';

-- ---------------------------------------------------------------------------
-- The transition table has to learn the new state. Group 0128 knew nothing of
-- credential_issued_pending_activation, so its trigger refused the very
-- transition Task D introduces.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_device_key_transitions()
returns trigger
language plpgsql
as $keytrans$
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
      raise exception 'KLUY-KEY-BAD-INITIAL-STATE: a key row is created generated, not %', new.state
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if new.device_record_id <> old.device_record_id
     or new.generation <> old.generation
     or new.public_key_fingerprint <> old.public_key_fingerprint
     or new.key_handle <> old.key_handle
     or new.public_key <> old.public_key then
    raise exception 'KLUY-KEY-MUTATED: a generated key identity cannot change'
      using errcode = 'P0001';
  end if;

  if new.state = old.state then
    return new;
  end if;

  -- generated -> credential_issued_pending_activation is the ROTATION path:
  -- the credential exists but the provider has not been asked yet.
  -- generated -> active remains legal for INITIAL issuance, where the
  -- enrollment key is already operational.
  -- abandoned and destroyed stay terminal for issuance, so a loser key can
  -- never be promoted — including through the new pending state.
  if not (
       (old.state = 'generated'
          and new.state in ('credential_issued_pending_activation', 'active', 'abandoned', 'destroyed'))
    or (old.state = 'credential_issued_pending_activation'
          and new.state in ('active', 'abandoned', 'destroyed'))
    or (old.state = 'active'     and new.state in ('superseded', 'destroyed'))
    or (old.state = 'superseded' and new.state = 'destroyed')
    or (old.state = 'abandoned'  and new.state = 'destroyed')
  ) then
    raise exception 'KLUY-KEY-BAD-TRANSITION: % -> % is not a permitted device key transition',
      old.state, new.state using errcode = 'P0001';
  end if;

  return new;
end;
$keytrans$;

comment on function kitluy_devices.enforce_device_key_transitions() is
  'Device key state machine, extended by group 0130 with credential_issued_pending_activation. A ROTATED key reaches it on credential finalization and leaves it only through confirm_provider_key_activation_v1; an INITIAL-issuance key still goes straight to active because the enrollment key is already operational. abandoned and destroyed remain terminal for issuance.';

-- ===========================================================================
-- Grants, ownership, hygiene
-- ===========================================================================
alter table kitluy_devices.device_renewal_reservations enable row level security;
alter table kitluy_devices.device_renewal_reservations force row level security;

grant select, insert, update on kitluy_devices.device_renewal_reservations
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_renewal_reservations to service_role;

create policy device_renewal_reservations_issuer_write
  on kitluy_devices.device_renewal_reservations
  for all to kitluy_credential_issuer using (true) with check (true);
create policy device_renewal_reservations_service_read
  on kitluy_devices.device_renewal_reservations
  for select to service_role using (true);

alter function kitluy_devices.reserve_device_credential_renewal_v1(
  uuid, text, text, text, timestamptz, text, kitluy_devices.renewal_mode, text)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.register_generation_key_v2(uuid, text, text, text, integer)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.confirm_provider_key_activation_v1(
  uuid, uuid, uuid, text, text, integer, integer, text, text, text)
  owner to kitluy_credential_issuer;

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
    'prepare_device_credential_renewal_v2(uuid, text, text, text, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text, kitluy_devices.renewal_mode)',
    'register_generation_key_v1(uuid, text, text, integer, text, text, text)',
    'register_generation_key_v2(uuid, text, text, text, integer)',
    'abandon_generation_key_v1(uuid, text, text, integer, text)',
    'reserve_device_credential_renewal_v1(uuid, text, text, text, timestamptz, text, kitluy_devices.renewal_mode, text)',
    'confirm_provider_key_activation_v1(uuid, uuid, uuid, text, text, integer, integer, text, text, text)']
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
