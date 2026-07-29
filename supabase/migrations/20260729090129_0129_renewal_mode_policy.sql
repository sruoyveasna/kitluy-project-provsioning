-- kitluy:group:0129
-- Migration group 0129: renewal_mode_policy (WS-11-T003 Step 4, correction).
--
-- Additive. Groups 0120-0128 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- CORRECTION — FORCED KEY ROTATION WAS NEVER OWNER-APPROVED
-- ===========================================================================
-- Group 0128 encoded "renewal always generates a new key pair" as policy. It
-- raised KLUY-RENEWAL-KEY-REUSED citing §5.1, and refused to prepare a renewal
-- unless a replacement key was already registered. Between them those two rules
-- made `reuse_current_key` UNREACHABLE — not merely discouraged, impossible.
--
-- The owner has since corrected the record: §5.1 was a RECOMMENDATION, not a
-- ruling, and no versioned owner decision requires rotation. Encoding a
-- recommendation as a database refusal is exactly the failure this project
-- exists to avoid, so it is undone here rather than left with a comment.
--
-- The safe default is `reuse_current_key`. `rotate_key` stays
-- DEVELOPMENT-CAPABLE but DISABLED BY POLICY until a decision is recorded —
-- the mechanism is kept and tested, the mandate is withdrawn.
--
-- A NEW CREDENTIAL GENERATION AND A NEW KEY GENERATION ARE DIFFERENT THINGS.
-- Group 0128 conflated them by keying `device_generation_keys` on the
-- credential generation. That conflation is recorded below and is NOT resolved
-- here; the two need separate fields.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create type kitluy_devices.renewal_mode as enum (
  'reuse_current_key',
  'rotate_key'
);

comment on type kitluy_devices.renewal_mode is
  'How a renewal treats the device key. `reuse_current_key` issues the next CREDENTIAL generation against the key the device already holds. `rotate_key` additionally rotates the key pair. Neither is inherently correct — the choice is product policy and awaits a versioned owner decision.';

-- ---------------------------------------------------------------------------
-- The policy table. Created with rotation DISABLED, and the missing owner
-- decision named rather than guessed.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.renewal_policy (
  environment text primary key,
  default_renewal_mode kitluy_devices.renewal_mode not null default 'reuse_current_key',
  allow_key_rotation boolean not null default false,
  -- Null until an owner decision exists. `allow_key_rotation` cannot be true
  -- without one, so no operator can enable rotation by flipping a boolean.
  rotation_approved_by_decision_ref text,
  required_owner_decision text,
  updated_at timestamptz not null default now(),
  constraint renewal_policy_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint renewal_policy_rotation_needs_decision_chk
    check (allow_key_rotation = false or rotation_approved_by_decision_ref is not null),
  -- The DEFAULT mode may only be rotation if rotation is permitted at all.
  constraint renewal_policy_default_consistent_chk
    check (default_renewal_mode <> 'rotate_key' or allow_key_rotation = true)
);

comment on table kitluy_devices.renewal_policy is
  'Owner: Fleet/Security. Which renewal modes an environment permits. `allow_key_rotation` cannot be set true without naming an owner decision — a CHECK, not a convention, because the whole point of this migration is that a recommendation was previously mistaken for a ruling.';

insert into kitluy_devices.renewal_policy
  (environment, default_renewal_mode, allow_key_rotation, required_owner_decision)
values
  ('development', 'reuse_current_key', false,
   '[REQUIRED: renewal_key_rotation_owner_decision]')
on conflict (environment) do nothing;

-- ===========================================================================
-- Renewal preparation, corrected
-- ===========================================================================
-- Changes from group 0128, and nothing else:
--   * takes an explicit mode; NULL resolves to the environment's policy default
--   * refuses `rotate_key` when policy does not permit it
--   * requires a registered replacement key ONLY in `rotate_key` mode
--   * DROPS the KLUY-RENEWAL-KEY-REUSED refusal entirely — reuse is now a
--     supported mode, not a violation
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
as $renewal$
begin
  -- Backwards-compatible entry point: no mode named, so policy decides.
  return kitluy_devices.prepare_device_credential_renewal_v2(
    p_device_record_id, p_environment, p_purpose, p_request_id, p_idempotency_key,
    p_canonical_payload_hash, p_public_key, p_public_key_fingerprint,
    p_pop_algorithm, p_pop_signed_preimage_hash, p_pop_signature,
    p_pop_service_verified, p_issuer_key_id, p_trusted_time, p_trusted_time_status,
    p_actor_ref, null);
end;
$renewal$;

create or replace function kitluy_devices.prepare_device_credential_renewal_v2(
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
  p_actor_ref text,
  p_renewal_mode kitluy_devices.renewal_mode
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $renewal2$
declare
  v_head kitluy_devices.device_credential_heads;
  v_current kitluy_devices.device_credentials;
  v_device kitluy_devices.devices;
  v_key kitluy_devices.device_generation_keys;
  v_policy kitluy_devices.renewal_policy;
  v_mode kitluy_devices.renewal_mode;
  v_next integer;
  v_days numeric;
  v_result jsonb;
begin
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-RENEWAL-NO-TRUSTED-TIME: renewal requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;

  select * into v_policy from kitluy_devices.renewal_policy
  where environment = p_environment;
  if not found then
    raise exception
      'KLUY-RENEWAL-NO-POLICY: no renewal policy is configured for %; no code default may authorize one', p_environment
      using errcode = 'P0001';
  end if;

  v_mode := coalesce(p_renewal_mode, v_policy.default_renewal_mode);
  if v_mode = 'rotate_key' and not v_policy.allow_key_rotation then
    raise exception
      'KLUY-RENEWAL-ROTATION-NOT-PERMITTED: key rotation is disabled for % pending %; the mechanism exists but the mandate does not',
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

  -- The approved fast-fail. Distinct from RENEWAL_GENERATION_CONFLICT, which
  -- belongs to a genuine late race at the head compare-and-swap.
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

  if v_mode = 'reuse_current_key' then
    -- The device keeps the key it already holds. No generation, no
    -- registration, no proof of a NEW private half — there is no new private
    -- half. The presented key must simply BE the incumbent, so a renewal
    -- cannot silently swap keys while claiming to reuse one.
    if p_public_key_fingerprint <> v_current.public_key_fingerprint then
      raise exception
        'KLUY-RENEWAL-NOT-CURRENT-KEY: reuse_current_key must present the incumbent key, not a different one'
        using errcode = 'P0001';
    end if;
  else
    -- rotate_key: the replacement must have been generated by the PROVIDER and
    -- registered. A caller-supplied public key is not evidence that a private
    -- half exists on the device.
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
    if v_key.public_key_fingerprint = v_current.public_key_fingerprint then
      raise exception
        'KLUY-RENEWAL-ROTATION-REUSED-KEY: rotate_key was requested but the replacement is the incumbent key'
        using errcode = 'P0001';
    end if;
  end if;

  v_result := kitluy_devices.prepare_device_credential_issuance_v1(
    p_request_id, p_device_record_id, p_environment, p_purpose,
    v_device.assignment_generation, p_public_key, p_public_key_fingerprint,
    p_idempotency_key, p_canonical_payload_hash, p_pop_algorithm,
    p_pop_signed_preimage_hash, p_pop_signature, p_pop_service_verified,
    p_issuer_key_id, p_trusted_time, p_trusted_time_status, p_actor_ref);

  return v_result || jsonb_build_object('renewal_mode', v_mode::text);
end;
$renewal2$;

comment on function kitluy_devices.prepare_device_credential_renewal_v2 is
  'Renewal preparation with an EXPLICIT mode. NULL resolves to the environment policy default, which is `reuse_current_key`. `rotate_key` is refused unless kitluy_devices.renewal_policy permits it, and it cannot be permitted without naming an owner decision. Group 0128''s KLUY-RENEWAL-KEY-REUSED refusal is GONE: reuse is a supported mode, not a violation. Renewal still reuses the prepare/sign/finalize pipeline rather than forking it.';

-- ===========================================================================
-- Grants, ownership, hygiene
-- ===========================================================================
alter table kitluy_devices.renewal_policy enable row level security;
alter table kitluy_devices.renewal_policy force row level security;

grant select on kitluy_devices.renewal_policy to kitluy_credential_issuer, service_role;
create policy renewal_policy_issuer_read on kitluy_devices.renewal_policy
  for select to kitluy_credential_issuer using (true);
create policy renewal_policy_service_read on kitluy_devices.renewal_policy
  for select to service_role using (true);

alter function kitluy_devices.prepare_device_credential_renewal_v2(
  uuid, text, text, text, text, text, text, text, text, text, bytea, boolean,
  text, timestamptz, text, text, kitluy_devices.renewal_mode)
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
