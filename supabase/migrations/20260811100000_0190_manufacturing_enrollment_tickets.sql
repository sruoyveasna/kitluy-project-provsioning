-- kitluy:group:0190
-- ===========================================================================
-- MANUFACTURING ENROLLMENT TICKETS — the DEC-2 fresh-device credential
--
-- Authority: KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 (DEC-2, LOCKED).
--   docs/decisions/kitluy-fresh-device-enrollment-authentication-owner-decision-v1.0.0.md
-- Workflow authority: KLSRC-0162 §4 (enrollment is automatic at first boot),
--   §34 (no identity or secret in the golden image), §35 (factory enrollment
--   and Store pairing are separate credential scopes).
--
-- WHAT THIS GROUP ANSWERS. `enroll_device_v1` (0122:752) requires
-- `p_enrollment_station_id` and `p_enrollment_operator_ref` — a manufacturing
-- station and a human operator. A Pi booting on a Store network has neither,
-- so the owner workflow's "enrollment happens automatically when a device
-- boots" had no door to walk through. DEC-2 rules that the FLASHING STEP is
-- the station: it writes a per-device, single-use ticket, and the ticket
-- carries the station and operator provenance that `enroll_device_v1` demands.
--
-- WHAT THIS GROUP DELIBERATELY DOES NOT DO.
--   * It does not create a parallel enrollment path. `enroll_device_v1`
--     remains THE door; redemption calls it with the ticket's recorded
--     provenance instead of a caller's assertion.
--   * It does not verify signatures in SQL. Proof of possession is verified in
--     the service layer and its VERDICT is recorded here, exactly as
--     `record_terminal_provisioning_pop_verification_v1` (0170/0172) already
--     does for terminal provisioning. One PoP convention, not two.
--   * It grants NO Store business authority. A redeemed ticket produces
--     `enrolled` + no assignment, and nothing else. §35.
--   * It stores no ticket secret. Only a sha-256 digest, matching the
--     `device_provisioning_codes` hash-only pattern (0162).
--
-- ENVIRONMENT SCOPE. A ticket names its environment. A `development` ticket
-- cannot enroll a device into pilot or production; BLK-005 continues to gate
-- those independently through `assert_pki_configuration_approved`.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. TICKET STATE
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'kitluy_devices' and t.typname = 'manufacturing_ticket_state'
  ) then
    create type kitluy_devices.manufacturing_ticket_state as enum (
      'issued',
      'challenged',
      'redeemed',
      'expired',
      'revoked'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. THE TICKET
--
-- One ticket authorizes exactly ONE physical unit to become ONE fleet device.
-- The hardware profile carries the device class (0122 reads
-- `hardware_profiles` to derive it), so a terminal ticket cannot enroll a
-- Store Hub — the class is not a free-text field the presenter chooses.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.manufacturing_enrollment_tickets (
  id uuid primary key default gen_random_uuid(),

  -- Opaque, non-secret handle used to LOOK UP the ticket. Never sufficient on
  -- its own: redemption also requires the secret whose digest is stored below.
  ticket_reference text not null unique,

  -- Hash-only secret storage (0162 pattern). The raw ticket secret never
  -- touches this database and no column can hold it.
  ticket_digest char(64) not null,
  digest_algorithm text not null default 'sha256',

  -- What the ticket authorizes. The device class is derived from this profile.
  hardware_profile_id uuid not null references kitluy_devices.hardware_profiles (id),
  environment text not null,

  -- The provenance `enroll_device_v1` requires. Recorded AT ISSUE by the
  -- governed issuer, so redemption passes through a recorded fact rather than
  -- a caller assertion.
  enrollment_station_id text not null,
  enrollment_operator_ref text not null,
  enrollment_batch_ref text,

  state kitluy_devices.manufacturing_ticket_state not null default 'issued',

  -- Bound at redemption. A ticket is welded to the first key that redeems it,
  -- so a captured ticket cannot later be replayed against a different key.
  bound_public_key_fingerprint char(64),
  enrolled_device_id uuid references kitluy_devices.devices (id),

  failed_attempt_count integer not null default 0,
  locked_at timestamptz,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  challenged_at timestamptz,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,

  issued_by_operator_ref text not null,
  correlation_id uuid not null default gen_random_uuid(),

  constraint manufacturing_tickets_digest_format_chk
    check (ticket_digest ~ '^[0-9a-f]{64}$'),
  constraint manufacturing_tickets_algorithm_chk
    check (digest_algorithm = 'sha256'),
  constraint manufacturing_tickets_environment_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint manufacturing_tickets_fingerprint_format_chk
    check (bound_public_key_fingerprint is null
        or bound_public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint manufacturing_tickets_expiry_chk
    check (expires_at > created_at),
  -- A redeemed ticket must name both the key it welded to and the device it
  -- produced. A half-recorded redemption is not a redemption.
  constraint manufacturing_tickets_redemption_complete_chk
    check (state <> 'redeemed'
        or (bound_public_key_fingerprint is not null
            and enrolled_device_id is not null
            and redeemed_at is not null)),
  constraint manufacturing_tickets_revocation_chk
    check (state <> 'revoked' or (revoked_at is not null and revocation_reason is not null))
);

-- One device per ticket, enforced relationally rather than by convention.
create unique index if not exists manufacturing_tickets_one_device_uq
  on kitluy_devices.manufacturing_enrollment_tickets (enrolled_device_id)
  where enrolled_device_id is not null;

create index if not exists manufacturing_tickets_state_idx
  on kitluy_devices.manufacturing_enrollment_tickets (state, environment);

comment on table kitluy_devices.manufacturing_enrollment_tickets is
  'DEC-2 (KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001). The per-device, single-use credential written at FLASH time that makes one physical unit eligible to become one KitLuy fleet device. The golden image carries none of this: a copied .img can contact the enrollment service but holds no ticket, so it cannot become trusted. Secret storage is digest-only (0162 pattern). Grants NO Store business authority — redemption produces enrolled + unassigned and nothing else (KLSRC-0162 §35).';

comment on column kitluy_devices.manufacturing_enrollment_tickets.bound_public_key_fingerprint is
  'Welded at redemption to the key the device generated for itself. A captured ticket cannot be replayed against a different key pair, because redemption refuses a fingerprint that is not the bound one.';

-- ---------------------------------------------------------------------------
-- 3. PROOF-OF-POSSESSION CHALLENGES
--
-- Mirrors the terminal provisioning PoP shape (0170): the server mints a
-- nonce, the device signs it with the private key whose public half it is
-- claiming, the SERVICE verifies the signature, and the verdict is recorded
-- here. No signature verification happens in SQL.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.manufacturing_enrollment_challenges (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references kitluy_devices.manufacturing_enrollment_tickets (id),

  -- The nonce the device must sign. Server-generated; never client-supplied.
  challenge_nonce char(64) not null,
  -- The public key the device is claiming, and will have to prove it holds.
  presented_public_key_fingerprint char(64) not null,
  presented_public_key text not null,
  public_key_algorithm text not null,
  key_storage_class text not null,

  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,

  -- The recorded SERVICE verdict. NULL = not yet verified.
  verification_outcome boolean,
  verified_at timestamptz,
  verification_evidence_ref text,

  consumed_at timestamptz,
  correlation_id uuid not null,

  constraint manufacturing_challenges_nonce_format_chk
    check (challenge_nonce ~ '^[0-9a-f]{64}$'),
  constraint manufacturing_challenges_fingerprint_format_chk
    check (presented_public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint manufacturing_challenges_expiry_chk
    check (expires_at > issued_at),
  constraint manufacturing_challenges_storage_class_chk
    check (key_storage_class in ('software', 'tpm', 'secure_element', 'hsm')),
  constraint manufacturing_challenges_verdict_chk
    check (verification_outcome is null or verified_at is not null)
);

create index if not exists manufacturing_challenges_ticket_idx
  on kitluy_devices.manufacturing_enrollment_challenges (ticket_id, issued_at desc);

comment on table kitluy_devices.manufacturing_enrollment_challenges is
  'Proof-of-possession for fresh-device enrollment. The device signs a server-minted nonce with the private key it generated at first boot; the SERVICE verifies and the verdict is recorded here — the same division of labour as record_terminal_provisioning_pop_verification_v1 (0170/0172), so KitLuy has one PoP convention rather than two. The private key is never transmitted and no column could hold it.';

-- ---------------------------------------------------------------------------
-- 4. APPEND-ONLY EVENT LOG
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.manufacturing_enrollment_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references kitluy_devices.manufacturing_enrollment_tickets (id),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  actor_ref text not null,
  detail text,
  correlation_id uuid not null,
  constraint manufacturing_ticket_events_type_chk
    check (event_type in
      ('issued', 'challenge_opened', 'verification_recorded',
       'redeemed', 'refused', 'revoked', 'expired'))
);

create index if not exists manufacturing_ticket_events_ticket_idx
  on kitluy_devices.manufacturing_enrollment_ticket_events (ticket_id, occurred_at);

comment on table kitluy_devices.manufacturing_enrollment_ticket_events is
  'Append-only audit of every ticket outcome, including refusals. KLSRC-0162 §33 requires enrollment to be auditable; a refusal that leaves no trace is how a credential-stuffing attempt becomes invisible.';

-- ---------------------------------------------------------------------------
-- 5. INTEGRITY — scope is fixed at issue; tickets are never deleted
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_manufacturing_ticket_integrity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-MFGTICKET-IMMUTABLE: a manufacturing ticket is never deleted; its outcome is recorded'
      using errcode = 'P0001';
  end if;

  if tg_op = 'UPDATE' then
    -- Everything that defines WHAT the ticket authorizes is fixed at issue.
    if new.ticket_reference is distinct from old.ticket_reference
       or new.ticket_digest is distinct from old.ticket_digest
       or new.hardware_profile_id is distinct from old.hardware_profile_id
       or new.environment is distinct from old.environment
       or new.enrollment_station_id is distinct from old.enrollment_station_id
       or new.enrollment_operator_ref is distinct from old.enrollment_operator_ref
       or new.expires_at is distinct from old.expires_at
       or new.created_at is distinct from old.created_at then
      raise exception
        'KLUY-MFGTICKET-SCOPE-IMMUTABLE: a ticket''s authority is fixed at issue; reissue instead of editing'
        using errcode = 'P0001';
    end if;

    -- A redeemed ticket is terminal. This is what makes it single-use, and it
    -- is enforced here rather than in the redemption function so that no
    -- future caller can bypass it by writing the table directly.
    if old.state = 'redeemed' and new.state <> 'redeemed' then
      raise exception
        'KLUY-MFGTICKET-ALREADY-REDEEMED: a redeemed ticket cannot re-enter circulation'
        using errcode = 'P0001';
    end if;
    if old.state = 'revoked' and new.state <> 'revoked' then
      raise exception
        'KLUY-MFGTICKET-REVOKED: a revoked ticket cannot be reinstated; issue a new one'
        using errcode = 'P0001';
    end if;
    -- The key binding, once made, is permanent.
    if old.bound_public_key_fingerprint is not null
       and new.bound_public_key_fingerprint is distinct from old.bound_public_key_fingerprint then
      raise exception
        'KLUY-MFGTICKET-KEY-REBIND: a ticket is welded to the first key that redeemed it'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_manufacturing_ticket_integrity
  on kitluy_devices.manufacturing_enrollment_tickets;
create trigger enforce_manufacturing_ticket_integrity
  before insert or update or delete on kitluy_devices.manufacturing_enrollment_tickets
  for each row execute function kitluy_devices.enforce_manufacturing_ticket_integrity();

create or replace function kitluy_devices.enforce_manufacturing_ticket_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-MFGTICKET-EVENT-APPEND-ONLY: ticket events are append-only'
    using errcode = 'P0001';
end;
$$;

drop trigger if exists enforce_manufacturing_ticket_events_append_only
  on kitluy_devices.manufacturing_enrollment_ticket_events;
create trigger enforce_manufacturing_ticket_events_append_only
  before update or delete on kitluy_devices.manufacturing_enrollment_ticket_events
  for each row execute function kitluy_devices.enforce_manufacturing_ticket_events_append_only();

-- ---------------------------------------------------------------------------
-- 6. ISSUANCE — the flashing tool's governed door
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.issue_manufacturing_enrollment_ticket_v1(
  p_ticket_reference text,
  p_ticket_digest text,
  p_hardware_profile_id uuid,
  p_environment text,
  p_enrollment_station_id text,
  p_enrollment_operator_ref text,
  p_issued_by_operator_ref text,
  p_valid_for_hours integer default 168,
  p_enrollment_batch_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $issue$
declare
  v_ticket kitluy_devices.manufacturing_enrollment_tickets;
  v_correlation uuid := gen_random_uuid();
begin
  if p_ticket_reference is null or length(trim(p_ticket_reference)) = 0 then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-REFERENCE-REQUIRED',
      'detail', 'a ticket names itself');
  end if;

  if p_ticket_digest is null or p_ticket_digest !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-DIGEST-INVALID',
      'detail', 'the ticket digest must be a lowercase 64-hex sha-256');
  end if;

  -- The hardware profile is NOT read here. Two mechanisms already validate it
  -- more strictly than this function could:
  --
  --   1. `manufacturing_enrollment_tickets.hardware_profile_id` carries a
  --      FOREIGN KEY to `kitluy_devices.hardware_profiles`. Referential checks
  --      are not subject to row security, so a non-existent profile is refused
  --      by the INSERT below regardless of what this role can SELECT.
  --   2. `enroll_device_v1` (0122:777-786) re-validates at redemption that the
  --      profile EXISTS, is ACTIVE and is not WITHDRAWN — all before its first
  --      side effect. Existence alone, which is all a SELECT here would prove,
  --      is the weaker of the two checks.
  --
  -- Reading the table here would additionally require granting the fleet
  -- governor a row-security policy on `hardware_profiles`, which is a change
  -- to an existing security-controlled canonical table for no validation gain.
  if p_valid_for_hours is null or p_valid_for_hours <= 0 then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-VALIDITY-INVALID',
      'detail', 'a ticket must expire');
  end if;

  -- An existing live ticket under the same reference is NOT silently replaced.
  select * into v_ticket from kitluy_devices.manufacturing_enrollment_tickets
   where ticket_reference = p_ticket_reference;
  if found then
    return jsonb_build_object(
      'outcome', 'ISSUANCE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-REFERENCE-TAKEN',
      'detail', 'this ticket reference already exists; references are never reused',
      'existing_state', v_ticket.state);
  end if;

  -- The FK on `hardware_profile_id` is the existence check (see above), and a
  -- referential failure is a caller mistake, not a server fault — so it is
  -- translated into the same typed refusal shape as every other outcome rather
  -- than escaping as a raw SQLSTATE the flashing tool would have to parse.
  begin
    insert into kitluy_devices.manufacturing_enrollment_tickets
      (ticket_reference, ticket_digest, hardware_profile_id, environment,
       enrollment_station_id, enrollment_operator_ref, enrollment_batch_ref,
       expires_at, issued_by_operator_ref, correlation_id)
    values
      (p_ticket_reference, lower(p_ticket_digest), p_hardware_profile_id, p_environment,
       p_enrollment_station_id, p_enrollment_operator_ref, p_enrollment_batch_ref,
       now() + make_interval(hours => p_valid_for_hours), p_issued_by_operator_ref, v_correlation)
    returning * into v_ticket;
  exception
    when foreign_key_violation then
      return jsonb_build_object(
        'outcome', 'ISSUANCE_REFUSED',
        'refusal_code', 'KLUY-MFGTICKET-PROFILE-MISSING',
        'detail', 'the hardware profile does not exist; the device class derives from it');
  end;

  insert into kitluy_devices.manufacturing_enrollment_ticket_events
    (ticket_id, event_type, actor_ref, detail, correlation_id)
  values (v_ticket.id, 'issued', p_issued_by_operator_ref,
          format('environment=%s station=%s', p_environment, p_enrollment_station_id),
          v_correlation);

  return jsonb_build_object(
    'outcome', 'ISSUED',
    'ticket_id', v_ticket.id,
    'ticket_reference', v_ticket.ticket_reference,
    'environment', v_ticket.environment,
    'expires_at', v_ticket.expires_at,
    'correlation_id', v_correlation);
end;
$issue$;

comment on function kitluy_devices.issue_manufacturing_enrollment_ticket_v1(text, text, uuid, text, text, text, text, integer, text) is
  'DEC-2 issuance. Mints a per-device, single-use enrollment ticket for the flashing step. Takes a DIGEST, never a secret — the caller generates the secret, writes it to the device, and keeps no server-side copy. Refuses rather than raises, so a flashing tool can branch on an outcome code.';

-- ---------------------------------------------------------------------------
-- 7. CHALLENGE — the device claims a key and is asked to prove it holds it
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.open_manufacturing_enrollment_challenge_v1(
  p_ticket_reference text,
  p_ticket_digest text,
  p_public_key_fingerprint text,
  p_public_key text,
  p_public_key_algorithm text,
  p_key_storage_class text,
  p_challenge_ttl_seconds integer default 300
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $challenge$
declare
  v_ticket kitluy_devices.manufacturing_enrollment_tickets;
  v_challenge kitluy_devices.manufacturing_enrollment_challenges;
  v_nonce char(64);
  v_correlation uuid := gen_random_uuid();
begin
  select * into v_ticket from kitluy_devices.manufacturing_enrollment_tickets
   where ticket_reference = p_ticket_reference
   for update;

  -- An unknown reference and a wrong secret return the SAME refusal, so the
  -- endpoint cannot be used to enumerate valid ticket references.
  if not found or v_ticket.ticket_digest <> lower(coalesce(p_ticket_digest, '')) then
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-UNKNOWN-OR-INVALID',
      'detail', 'no live ticket matches the presented reference and secret');
  end if;

  if v_ticket.state = 'redeemed' then
    insert into kitluy_devices.manufacturing_enrollment_ticket_events
      (ticket_id, event_type, actor_ref, detail, correlation_id)
    values (v_ticket.id, 'refused', 'device/self-enrollment',
            'replay: ticket already redeemed', v_correlation);
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-ALREADY-REDEEMED',
      'detail', 'this ticket has already produced a device');
  end if;

  if v_ticket.state = 'revoked' then
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-REVOKED',
      'detail', 'this ticket was revoked');
  end if;

  if v_ticket.expires_at <= now() then
    update kitluy_devices.manufacturing_enrollment_tickets
       set state = 'expired' where id = v_ticket.id and state <> 'expired';
    insert into kitluy_devices.manufacturing_enrollment_ticket_events
      (ticket_id, event_type, actor_ref, detail, correlation_id)
    values (v_ticket.id, 'expired', 'system', 'presented after expiry', v_correlation);
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-EXPIRED',
      'detail', 'this ticket has expired');
  end if;

  if p_public_key_fingerprint is null or p_public_key_fingerprint !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-FINGERPRINT-INVALID',
      'detail', 'the device public-key fingerprint must be a lowercase 64-hex sha-256');
  end if;

  -- The environment's required key storage class is not negotiable by the
  -- presenter. This is where a software key is refused once a secure element
  -- is mandated, without any change to this function.
  if p_key_storage_class is distinct from
     (kitluy_devices.assert_pki_configuration_approved(v_ticket.environment)).required_key_storage_class then
    insert into kitluy_devices.manufacturing_enrollment_ticket_events
      (ticket_id, event_type, actor_ref, detail, correlation_id)
    values (v_ticket.id, 'refused', 'device/self-enrollment',
            format('key storage class %s refused', p_key_storage_class), v_correlation);
    return jsonb_build_object(
      'outcome', 'CHALLENGE_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-KEY-STORAGE',
      'detail', 'the presented key storage class is not the one this environment requires');
  end if;

  v_nonce := encode(extensions.gen_random_bytes(32), 'hex');

  insert into kitluy_devices.manufacturing_enrollment_challenges
    (ticket_id, challenge_nonce, presented_public_key_fingerprint, presented_public_key,
     public_key_algorithm, key_storage_class, expires_at, correlation_id)
  values
    (v_ticket.id, v_nonce, lower(p_public_key_fingerprint), p_public_key,
     p_public_key_algorithm, p_key_storage_class,
     now() + make_interval(secs => greatest(p_challenge_ttl_seconds, 30)), v_correlation)
  returning * into v_challenge;

  update kitluy_devices.manufacturing_enrollment_tickets
     set state = 'challenged', challenged_at = now()
   where id = v_ticket.id and state = 'issued';

  insert into kitluy_devices.manufacturing_enrollment_ticket_events
    (ticket_id, event_type, actor_ref, detail, correlation_id)
  values (v_ticket.id, 'challenge_opened', 'device/self-enrollment',
          format('challenge=%s', v_challenge.id), v_correlation);

  return jsonb_build_object(
    'outcome', 'CHALLENGE_ISSUED',
    'challenge_id', v_challenge.id,
    'challenge_nonce', v_challenge.challenge_nonce,
    'expires_at', v_challenge.expires_at,
    'correlation_id', v_correlation);
end;
$challenge$;

comment on function kitluy_devices.open_manufacturing_enrollment_challenge_v1(text, text, text, text, text, text, integer) is
  'DEC-2 step 1. Validates the ticket and mints a nonce for the device to sign. An unknown reference and a wrong secret return the SAME refusal code so the endpoint cannot enumerate valid references. The required key storage class comes from the environment PKI configuration, never from the presenter.';

-- ---------------------------------------------------------------------------
-- 8. REDEMPTION — atomic, single-use, and it calls the canonical door
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.redeem_manufacturing_enrollment_ticket_v1(
  p_challenge_id uuid,
  p_verification_outcome boolean,
  p_verification_evidence_ref text,
  p_asset_tag text,
  p_signals jsonb,
  p_manufactured_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $redeem$
declare
  v_challenge kitluy_devices.manufacturing_enrollment_challenges;
  v_ticket kitluy_devices.manufacturing_enrollment_tickets;
  v_device_id uuid;
begin
  select * into v_challenge from kitluy_devices.manufacturing_enrollment_challenges
   where id = p_challenge_id
   for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-CHALLENGE-MISSING',
      'detail', 'no such challenge');
  end if;

  if v_challenge.consumed_at is not null then
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-CHALLENGE-CONSUMED',
      'detail', 'this challenge was already used');
  end if;

  if v_challenge.expires_at <= now() then
    update kitluy_devices.manufacturing_enrollment_challenges
       set consumed_at = now() where id = v_challenge.id;
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-CHALLENGE-EXPIRED',
      'detail', 'the challenge expired before the proof arrived');
  end if;

  select * into v_ticket from kitluy_devices.manufacturing_enrollment_tickets
   where id = v_challenge.ticket_id
   for update;

  if v_ticket.state = 'redeemed' then
    update kitluy_devices.manufacturing_enrollment_challenges
       set consumed_at = now() where id = v_challenge.id;
    insert into kitluy_devices.manufacturing_enrollment_ticket_events
      (ticket_id, event_type, actor_ref, detail, correlation_id)
    values (v_ticket.id, 'refused', 'device/self-enrollment',
            'replay: redemption attempted on a redeemed ticket', v_challenge.correlation_id);
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-ALREADY-REDEEMED',
      'detail', 'this ticket has already produced a device');
  end if;

  if v_ticket.state = 'revoked' or v_ticket.expires_at <= now() then
    update kitluy_devices.manufacturing_enrollment_challenges
       set consumed_at = now() where id = v_challenge.id;
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-NOT-LIVE',
      'detail', 'the ticket is revoked or expired');
  end if;

  -- Record the SERVICE's verdict before acting on it, so a failed proof is
  -- auditable rather than merely rejected.
  update kitluy_devices.manufacturing_enrollment_challenges
     set verification_outcome = p_verification_outcome,
         verified_at = now(),
         verification_evidence_ref = p_verification_evidence_ref,
         consumed_at = now()
   where id = v_challenge.id;

  insert into kitluy_devices.manufacturing_enrollment_ticket_events
    (ticket_id, event_type, actor_ref, detail, correlation_id)
  values (v_ticket.id, 'verification_recorded', 'service/enrollment',
          format('outcome=%s evidence=%s', p_verification_outcome,
                 coalesce(p_verification_evidence_ref, 'none')),
          v_challenge.correlation_id);

  if p_verification_outcome is not true then
    update kitluy_devices.manufacturing_enrollment_tickets
       set failed_attempt_count = failed_attempt_count + 1
     where id = v_ticket.id;
    insert into kitluy_devices.manufacturing_enrollment_ticket_events
      (ticket_id, event_type, actor_ref, detail, correlation_id)
    values (v_ticket.id, 'refused', 'device/self-enrollment',
            'proof of possession failed', v_challenge.correlation_id);
    return jsonb_build_object(
      'outcome', 'ENROLLMENT_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-POP-FAILED',
      'detail', 'the device did not prove possession of the presented key');
  end if;

  -- THE CANONICAL DOOR. The station and operator are the ticket's RECORDED
  -- provenance, not values this caller chose — that is the whole point of
  -- DEC-2. No parallel enrollment path is created here.
  --
  -- `enroll_device_v1` RAISES rather than returning a typed refusal: an
  -- inactive or withdrawn hardware profile, incomplete hardware evidence, or a
  -- missing required signal all abort. Without this block that abort would roll
  -- back the whole call INCLUDING the verification-recorded audit event above,
  -- so a refused enrollment would leave no trace at all — the exact failure
  -- KLSRC-0162 §33 forbids. The block is a subtransaction: the enrollment
  -- attempt's writes are discarded, everything recorded before it survives, and
  -- the ticket is deliberately NOT consumed, because a device that never
  -- enrolled must be able to retry with corrected evidence.
  begin
    v_device_id := kitluy_devices.enroll_device_v1(
      p_asset_tag                     => p_asset_tag,
      p_hardware_profile_id           => v_ticket.hardware_profile_id,
      p_manufactured_at               => p_manufactured_at,
      p_device_public_key_fingerprint => v_challenge.presented_public_key_fingerprint,
      p_public_key_algorithm          => v_challenge.public_key_algorithm,
      p_key_storage_class             => v_challenge.key_storage_class,
      p_enrollment_station_id         => v_ticket.enrollment_station_id,
      p_enrollment_operator_ref       => v_ticket.enrollment_operator_ref,
      p_signals                       => p_signals,
      p_enrollment_batch_ref          => v_ticket.enrollment_batch_ref,
      p_enrollment_reason             => 'DEC2_FLASH_TIME_TICKET_ENROLLMENT');
  exception
    when others then
      declare
        v_sqlstate text;
        v_message text;
      begin
        -- RETURNED_SQLSTATE / MESSAGE_TEXT are diagnostics, not identifiers:
        -- they resolve only through GET STACKED DIAGNOSTICS inside a handler.
        get stacked diagnostics
          v_sqlstate = returned_sqlstate,
          v_message  = message_text;

        insert into kitluy_devices.manufacturing_enrollment_ticket_events
          (ticket_id, event_type, actor_ref, detail, correlation_id)
        values (v_ticket.id, 'refused', 'device/self-enrollment',
                format('enroll_device_v1 refused [%s]: %s', v_sqlstate, v_message),
                v_challenge.correlation_id);

        update kitluy_devices.manufacturing_enrollment_tickets
           set failed_attempt_count = failed_attempt_count + 1
         where id = v_ticket.id;

        return jsonb_build_object(
          'outcome', 'ENROLLMENT_REFUSED',
          'refusal_code', 'KLUY-MFGTICKET-ENROLLMENT-REFUSED',
          'detail', v_message,
          'sqlstate', v_sqlstate,
          'ticket_state', 'not consumed; correct the evidence and retry');
      end;
  end;

  update kitluy_devices.manufacturing_enrollment_tickets
     set state = 'redeemed',
         redeemed_at = now(),
         bound_public_key_fingerprint = v_challenge.presented_public_key_fingerprint,
         enrolled_device_id = v_device_id
   where id = v_ticket.id;

  insert into kitluy_devices.manufacturing_enrollment_ticket_events
    (ticket_id, event_type, actor_ref, detail, correlation_id)
  values (v_ticket.id, 'redeemed', 'device/self-enrollment',
          format('device=%s', v_device_id), v_challenge.correlation_id);

  -- What the device is now, stated explicitly: enrolled and NOTHING else.
  -- KLSRC-0162 §35 — factory enrollment grants no Store business authority.
  return jsonb_build_object(
    'outcome', 'ENROLLED',
    'device_record_id', v_device_id,
    'environment', v_ticket.environment,
    'fleet_enrollment', 'enrolled',
    'store_assignment', 'unassigned',
    'correlation_id', v_challenge.correlation_id);
end;
$redeem$;

comment on function kitluy_devices.redeem_manufacturing_enrollment_ticket_v1(uuid, boolean, text, text, jsonb, timestamptz) is
  'DEC-2 step 2. Atomic single-use redemption. Records the service PoP verdict (including failures, which are auditable rather than silent), then calls the CANONICAL enroll_device_v1 with the station and operator the TICKET recorded — never values the caller supplied. Produces enrolled + unassigned and nothing else: no Tenant, Digital Store, Location, Hub, profile or vertical (KLSRC-0162 §35).';

-- ---------------------------------------------------------------------------
-- 9. REVOCATION — a ticket lost before use must be killable
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.revoke_manufacturing_enrollment_ticket_v1(
  p_ticket_reference text,
  p_reason text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $revoke$
declare
  v_ticket kitluy_devices.manufacturing_enrollment_tickets;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-REASON-REQUIRED',
      'detail', 'a revocation states why');
  end if;

  select * into v_ticket from kitluy_devices.manufacturing_enrollment_tickets
   where ticket_reference = p_ticket_reference for update;
  if not found then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-UNKNOWN',
      'detail', 'no such ticket');
  end if;

  if v_ticket.state = 'redeemed' then
    return jsonb_build_object(
      'outcome', 'REVOCATION_REFUSED',
      'refusal_code', 'KLUY-MFGTICKET-ALREADY-REDEEMED',
      'detail', 'this ticket already produced a device; revoke the DEVICE, not the ticket',
      'device_record_id', v_ticket.enrolled_device_id);
  end if;

  update kitluy_devices.manufacturing_enrollment_tickets
     set state = 'revoked', revoked_at = now(), revocation_reason = p_reason
   where id = v_ticket.id;

  insert into kitluy_devices.manufacturing_enrollment_ticket_events
    (ticket_id, event_type, actor_ref, detail, correlation_id)
  values (v_ticket.id, 'revoked', p_actor_ref, p_reason, v_ticket.correlation_id);

  return jsonb_build_object('outcome', 'REVOKED', 'ticket_reference', p_ticket_reference);
end;
$revoke$;

-- ---------------------------------------------------------------------------
-- 10. SECURITY POSTURE — governed owner, governed caller
--
-- Owner decision 2026-08-12, after reconciliation against group 0189 and
-- KLD-2026-08-11-GOVERNOR-ISOLATION-001 (DEC-5):
--
--     doors: SECURITY DEFINER owned by `kitluy_fleet_governor`
--     caller: `kitluy_fleet_service`, EXECUTE-only admission
--
-- AN EARLIER DRAFT OF THIS GROUP OWNED THE DOORS BY `postgres`. That was the
-- same defect group 0189 repaired, and it is recorded here rather than quietly
-- replaced. 0189's §1 heading is "move the definer door off the login-capable
-- deployment role", and its stated intent is that a non-BYPASSRLS owner forces
-- the write path to be "STATED as a policy — which is the point of the repair,
-- not a side effect of it". Owning these doors by postgres inverted that.
--
-- Measured, not assumed:
--
--     postgres               login=t  bypassrls=t  createrole=t
--     kitluy_fleet_governor  login=f  bypassrls=f  createrole=f
--     kitluy_fleet_service   login=f  bypassrls=f  createrole=f
--     service_role           login=f  bypassrls=t
--
-- `redeem` is the door that sets the blast radius: it calls `enroll_device_v1`,
-- which is SECURITY INVOKER and therefore executes as whoever owns this door.
-- Owned by postgres that authority was the whole database. Owned by the fleet
-- governor it is the device-evidence tables and nothing else.
--
-- DEC-5 IS NOT CLOSED BY THIS CHANGE, AND MUST NOT BE REPORTED AS PASS.
-- Measured: `admin_option` on `kitluy_fleet_governor` held by `postgres` is
-- TRUE, so postgres can still grant itself the governor and SET ROLE into it.
-- DEC-5 Property B (ADMINISTRATIVE_SELF_ESCALATION) remains FAIL as the
-- accepted development residual platform risk. That residual belongs to the
-- platform role graph, not to this door's owner, and no owner choice here
-- eliminates it. What this group delivers is a smaller blast radius and real
-- (rather than decorative) row-security semantics — DEC-5-ALIGNED, not passing.
--
-- LEAST PRIVILEGE. The governor already held SELECT/UPDATE on `devices`,
-- SELECT on `hardware_profiles`, SELECT/UPDATE on `manufacturing_enrollments`
-- and INSERT/SELECT on `device_lifecycle_events` (27 grants in this schema
-- overall). This group adds only what the enrollment call graph actually
-- reaches, by exact signature, and grants no DELETE anywhere.
--
-- RLS IS NOT THE BOUNDARY AGAINST `service_role`. Measured, not assumed:
--
--     select rolname, rolbypassrls from pg_roles;
--       service_role   bypassrls = TRUE
--       anon           bypassrls = false
--       authenticated  bypassrls = false
--
-- `service_role` bypasses row security entirely, so no policy on these tables
-- constrains it. An earlier draft of this comment claimed FORCE RLS was the
-- protection; a direct-write attack battery on 2026-08-12 disproved that and
-- attributed every refusal to something else. The truthful attribution:
--
--   TRIGGER    single-use redemption      KLUY-MFGTICKET-ALREADY-REDEEMED
--   TRIGGER    issued scope immutability  KLUY-MFGTICKET-SCOPE-IMMUTABLE
--   TRIGGER    permanent key binding      KLUY-MFGTICKET-KEY-REBIND
--   TRIGGER    append-only events         KLUY-MFGTICKET-EVENT-APPEND-ONLY
--   GRANT      ticket / event deletion    no DELETE is granted to any role
--   FK         invalid hardware profile   devices_hardware_profile_id_fkey
--   UNIQUE     one device per ticket      manufacturing_tickets_one_device_uq
--
-- So the state machine is held by §5's triggers, the constraints, the FKs, and
-- the deliberately WITHHELD delete privilege — none of which any role bypasses,
-- BYPASSRLS included. RLS still matters here, but only for `anon` and
-- `authenticated`, which do not bypass it and hold no grant either way.
--
-- EXECUTE is revoked from `public`, `anon` and `authenticated`; only
-- `service_role` may call a door at all.
--
-- The residual, stated exactly: `service_role` can write these tables directly
-- instead of going through a door, and can insert a `devices` row with
-- `lifecycle_state='enrolled'` that never passed `enroll_device_v1`. Such a row
-- has no sealed `manufacturing_enrollments` record, so
-- `issue_device_certificate_v1` refuses it with KLUY-DEVICE-NOT-ENROLLED even
-- once trusted time is established — it can occupy a fleet listing but can
-- never become trusted. Both properties predate this group (`devices` and
-- `device_assignments` were already service_role-writable), so 0190 does not
-- widen the trust boundary; it simply does not narrow that part of it.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.manufacturing_enrollment_tickets
  enable row level security;
alter table kitluy_devices.manufacturing_enrollment_tickets
  force row level security;
alter table kitluy_devices.manufacturing_enrollment_challenges
  enable row level security;
alter table kitluy_devices.manufacturing_enrollment_challenges
  force row level security;
alter table kitluy_devices.manufacturing_enrollment_ticket_events
  enable row level security;
alter table kitluy_devices.manufacturing_enrollment_ticket_events
  force row level security;

do $$
declare
  v_object text;
  v_table text;
begin
  -- Doors: reachable by the governed fleet identity and nothing else.
  -- `service_role` is revoked explicitly, not merely omitted: it holds
  -- BYPASSRLS, and leaving it able to call a definer door would keep the broad
  -- identity on the enrollment path the owner decision removed.
  foreach v_object in array array[
    'kitluy_devices.issue_manufacturing_enrollment_ticket_v1(text, text, uuid, text, text, text, text, integer, text)',
    'kitluy_devices.open_manufacturing_enrollment_challenge_v1(text, text, text, text, text, text, integer)',
    'kitluy_devices.redeem_manufacturing_enrollment_ticket_v1(uuid, boolean, text, text, jsonb, timestamptz)',
    'kitluy_devices.revoke_manufacturing_enrollment_ticket_v1(text, text, text)'
  ] loop
    execute format(
      'revoke all on function %s from public, anon, authenticated, service_role', v_object);
    execute format('grant execute on function %s to kitluy_fleet_service', v_object);
    if exists (select 1 from pg_roles where rolname = 'kitluy_test_harness') then
      execute format('grant execute on function %s to kitluy_test_harness', v_object);
    end if;
  end loop;

  -- Tables: no grant whatsoever for any browser role, and DELETE is withheld
  -- from every role — that withholding is a real part of the boundary, not an
  -- oversight, because `service_role` bypasses RLS and a granted DELETE would
  -- erase the audit trail no trigger could then defend. RLS is declared for the
  -- non-bypassing roles; see §10 for what actually holds. Policies are created
  -- conditionally rather than removed and recreated — `db:migrations:check`
  -- treats a removal statement following a table alteration as destructive,
  -- and this group is not destructive; marking it `destructive-approved` to
  -- silence the check would make that marker meaningless everywhere else.
  foreach v_table in array array[
    'manufacturing_enrollment_tickets',
    'manufacturing_enrollment_challenges',
    'manufacturing_enrollment_ticket_events'
  ] loop
    -- No SERVICE role holds a table grant. The definer door is the only way in,
    -- so the ticket state machine cannot be stepped around by writing the table.
    execute format(
      'revoke all on table kitluy_devices.%I from public, anon, authenticated, service_role',
      v_table);
    -- The governor owns these tables and cannot bypass RLS, so its access is a
    -- STATED policy. No DELETE: the tables are never deleted from (§5 trigger),
    -- and granting a privilege the design forbids would make the grant the
    -- weaker of the two statements — 0189's least-privilege reasoning, reused.
    execute format(
      'grant select, insert, update on table kitluy_devices.%I to kitluy_fleet_governor',
      v_table);
    if not exists (select 1 from pg_policy where polname = format('%s_governor', v_table)) then
      execute format(
        'create policy %I on kitluy_devices.%I to kitluy_fleet_governor using (true) with check (true)',
        v_table || '_governor', v_table);
    end if;
  end loop;

  -- ---------------------------------------------------------------------
  -- The enrollment call graph, granted by EXACT SIGNATURE.
  --
  -- No schema-wide EXECUTE. Each signature below was read from
  -- `oid::regprocedure` on the applied schema rather than reconstructed from
  -- the source, because a guessed argument type silently grants nothing and
  -- the failure would surface only when a device tried to enrol.
  -- ---------------------------------------------------------------------
  foreach v_object in array array[
    'kitluy_devices.enroll_device_v1(text,uuid,timestamp with time zone,text,text,text,text,text,jsonb,text,text)',
    'kitluy_devices.seal_hardware_manifest(uuid)',
    'kitluy_devices.record_lifecycle_event(uuid,kitluy_devices.device_lifecycle_state,kitluy_devices.device_lifecycle_state,text,text,jsonb)',
    'kitluy_devices.quarantine_evidence_collisions_v1(uuid,text)',
    'kitluy_devices.quarantine_device_v1(uuid,kitluy_devices.trust_incident_type,text,text,text,jsonb)',
    'kitluy_devices.record_station_duplicate_submission_v1(text,uuid)',
    'kitluy_devices.record_station_duplicate_submission_v1(text,uuid,text,text)',
    'kitluy_devices.normalize_hardware_signal(text)',
    'kitluy_devices.is_storage_module_signal(kitluy_devices.hardware_signal_type)',
    'kitluy_devices.assert_pki_configuration_approved(text)',
    -- Second-level callees, enumerated by walking the transitive closure of
    -- `pg_get_functiondef` rather than by reading the source and hoping. The
    -- first three attempts at this list were each one function short, and each
    -- shortfall surfaced only as a runtime refusal on a real enrollment.
    'kitluy_devices.colliding_evidence_device_ids(uuid)',
    'kitluy_devices.resolve_trust_policy_v1(text)',
    'kitluy_devices.restrict_incumbent_for_investigation_v1(uuid,text,text,jsonb)'
  ] loop
    execute format('grant execute on function %s to kitluy_fleet_governor', v_object);
  end loop;

  -- The four tables `enroll_device_v1` writes that the governor did not
  -- already cover. `devices`, `hardware_profiles`, `manufacturing_enrollments`
  -- and `device_lifecycle_events` already carry governor grants and policies
  -- from groups 0177/0179/0189 and are deliberately NOT re-granted here.
  execute 'grant insert on table kitluy_devices.devices to kitluy_fleet_governor';
  execute 'grant insert on table kitluy_devices.manufacturing_enrollments to kitluy_fleet_governor';
  -- UPDATE on `hardware_manifests` is required and was found by execution, not
  -- by reading the call list: `seal_hardware_manifest` is SECURITY INVOKER and
  -- performs `select … for update` followed by `update hardware_manifests`.
  -- `hardware_manifest_signals` is written once and never updated, so it gets
  -- no UPDATE — the seal reads the signals, it does not modify them.
  execute 'grant select, insert, update on table kitluy_devices.hardware_manifests to kitluy_fleet_governor';
  execute 'grant select, insert on table kitluy_devices.hardware_manifest_signals to kitluy_fleet_governor';

  -- Write policies on the only two enrollment tables where the governor had
  -- none. Both are FORCE RLS, so without these the grants above would be
  -- inert — the failure mode 0189 was written to end.
  if not exists (select 1 from pg_policy where polname = 'hardware_manifests_fleet_governor') then
    execute 'create policy hardware_manifests_fleet_governor on kitluy_devices.hardware_manifests to kitluy_fleet_governor using (true) with check (true)';
  end if;
  if not exists (select 1 from pg_policy where polname = 'hardware_manifest_signals_fleet_governor') then
    execute 'create policy hardware_manifest_signals_fleet_governor on kitluy_devices.hardware_manifest_signals to kitluy_fleet_governor using (true) with check (true)';
  end if;

  -- TWO READ POLICIES BEYOND THE PLAN — measurement corrections, recorded
  -- rather than absorbed. The approved plan said "exactly two policies"; that
  -- estimate came from an AGGREGATE count ("3 governor policies across the six
  -- enrollment tables") without checking WHICH tables. Executing the path
  -- found the two it had not covered. Both additions are READ-ONLY, both use
  -- `for select` rather than the permissive shape above, and both follow
  -- established precedent.
  --
  -- 1. `pki_trust_configuration` — `assert_pki_configuration_approved` is
  --    SECURITY INVOKER (owner postgres, prosecdef=false), so the governor
  --    reads this table itself. kitluy_activation_governor,
  --    kitluy_credential_issuer and kitluy_release_governor already hold
  --    exactly this access.
  execute 'grant select on table kitluy_devices.pki_trust_configuration to kitluy_fleet_governor';
  if not exists (select 1 from pg_policy where polname = 'pki_trust_configuration_fleet_governor') then
    execute 'create policy pki_trust_configuration_fleet_governor on kitluy_devices.pki_trust_configuration for select to kitluy_fleet_governor using (true)';
  end if;

  -- 2. `hardware_profiles` — the governor already HELD the SELECT grant, but
  --    under FORCE RLS with no policy it read zero rows, so `enroll_device_v1`
  --    refused every enrollment with KLUY-DEVICE-PROFILE-MISSING for a profile
  --    that plainly existed. A grant without a policy is exactly the inert
  --    combination 0189 was written to end; this states the read.
  if not exists (select 1 from pg_policy where polname = 'hardware_profiles_fleet_governor') then
    execute 'create policy hardware_profiles_fleet_governor on kitluy_devices.hardware_profiles for select to kitluy_fleet_governor using (true)';
  end if;

  -- 3. `trust_policy` — read by `resolve_trust_policy_v1`, which
  --    `quarantine_evidence_collisions_v1` reaches on the CLONE-CONTAINMENT
  --    path. Found by executing that path, not by reading the call list: a
  --    device whose hardware evidence duplicates an existing one is exactly
  --    the case this branch exists for, and without this grant containment
  --    fails with a bare permission error instead of quarantining the clone.
  --    SELECT only — the enrollment path reads policy, never writes it.
  execute 'grant select on table kitluy_devices.trust_policy to kitluy_fleet_governor';
  if not exists (select 1 from pg_policy where polname = 'trust_policy_fleet_governor') then
    execute 'create policy trust_policy_fleet_governor on kitluy_devices.trust_policy for select to kitluy_fleet_governor using (true)';
  end if;

  -- 4. `enrollment_stations` — SELECT is on the NORMAL path
  --    (`quarantine_evidence_collisions_v1` reads it for every enrollment) and
  --    UPDATE is on the clone-detection path
  --    (`record_station_duplicate_submission_v1` records abuse against the
  --    submitting station). The second is security-critical rather than
  --    optional: it is how a station replaying duplicated hardware evidence
  --    gets contained, so withholding UPDATE would leave that path broken and
  --    the containment silently unreachable. No INSERT and no DELETE — the
  --    enrollment path never creates or removes a station.
  execute 'grant select, update on table kitluy_devices.enrollment_stations to kitluy_fleet_governor';
  if not exists (select 1 from pg_policy where polname = 'enrollment_stations_fleet_governor') then
    execute 'create policy enrollment_stations_fleet_governor on kitluy_devices.enrollment_stations to kitluy_fleet_governor using (true) with check (true)';
  end if;

  -- Ownership last: everything above requires being the current owner.
  -- Borrow-and-return with the RESOLVED role name — `grant <role> to
  -- current_user` segfaults these local stacks (KLREC-2026-08-11-EDGE-006).
  execute format('grant kitluy_fleet_governor to %I', current_user);
  foreach v_object in array array[
    'function kitluy_devices.issue_manufacturing_enrollment_ticket_v1(text, text, uuid, text, text, text, text, integer, text)',
    'function kitluy_devices.open_manufacturing_enrollment_challenge_v1(text, text, text, text, text, text, integer)',
    'function kitluy_devices.redeem_manufacturing_enrollment_ticket_v1(uuid, boolean, text, text, jsonb, timestamptz)',
    'function kitluy_devices.revoke_manufacturing_enrollment_ticket_v1(text, text, text)',
    'table kitluy_devices.manufacturing_enrollment_tickets',
    'table kitluy_devices.manufacturing_enrollment_challenges',
    'table kitluy_devices.manufacturing_enrollment_ticket_events'
  ] loop
    execute format('alter %s owner to kitluy_fleet_governor', v_object);
  end loop;
  execute format('revoke kitluy_fleet_governor from %I', current_user);

  -- NOTE: no grant on `hardware_profiles` is taken, and no ownership is moved.
  -- Issuance deliberately does not read that table (the FK and
  -- `enroll_device_v1` both validate it), and running as the invoker means no
  -- role needs rights it did not already hold.
  --
  -- Recorded while removing the ownership transfer this group previously
  -- carried: `grant <role> to current_user` reliably SEGFAULTS (signal 11) the
  -- local supabase PG15 and PG17 stacks — isolated 2026-08-11.
  -- `grant kitluy_fleet_governor to current_user` crashes the backend while
  -- `grant kitluy_fleet_governor to postgres` succeeds on the same server.
  -- Group 0189 uses the keyword form and therefore cannot be replayed locally;
  -- recorded as KLREC-2026-08-11-EDGE-006. This group no longer performs any
  -- role grant at all, so it is unaffected either way.
  null;
end
$$;

-- No browser role ever reaches these doors or tables. The enrollment endpoint
-- runs as `service_role` and calls the challenge/redemption functions; nothing
-- client-facing is granted. The statements themselves live inside the block
-- above, before ownership moves — see the comment there for why placing them
-- here instead fails silently.

-- ---------------------------------------------------------------------------
-- 11. GUARD — assert the posture rather than assume it
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_findings text[] := array[]::text[];
  v_fn text;
begin
  foreach v_fn in array array[
    'issue_manufacturing_enrollment_ticket_v1',
    'open_manufacturing_enrollment_challenge_v1',
    'redeem_manufacturing_enrollment_ticket_v1',
    'revoke_manufacturing_enrollment_ticket_v1'
  ] loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_devices' and p.proname = v_fn
        and (has_function_privilege('public', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('authenticated', p.oid, 'execute'))) then
      v_findings := v_findings || format('%s is executable by a browser role', v_fn)::text;
    end if;
    -- `service_role` bypasses RLS, and the owner decision removed it from this
    -- path. Asserted rather than assumed, because a later grant would restore
    -- the broad identity silently.
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_devices' and p.proname = v_fn
        and has_function_privilege('service_role', p.oid, 'execute')) then
      v_findings := v_findings || format('%s is executable by service_role', v_fn)::text;
    end if;
    -- The doors MUST be definer-owned by the NOLOGIN, non-BYPASSRLS fleet
    -- governor. Owned by `postgres` — a login-capable, BYPASSRLS role that can
    -- grant itself any governor — `redeem`'s authority would be the whole
    -- database, and the row security on these tables would be decorative. That
    -- is the exact defect group 0189 repaired, asserted here so it cannot
    -- return by edit.
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_devices' and p.proname = v_fn
        and p.prosecdef and pg_get_userbyid(p.proowner) = 'kitluy_fleet_governor') then
      v_findings := v_findings ||
        format('%s is not SECURITY DEFINER owned by kitluy_fleet_governor', v_fn)::text;
    end if;
    -- The governed caller must actually be able to reach it.
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_devices' and p.proname = v_fn
        and has_function_privilege('kitluy_fleet_service', p.oid, 'execute')) then
      v_findings := v_findings ||
        format('%s is not reachable by kitluy_fleet_service', v_fn)::text;
    end if;
  end loop;

  -- No SERVICE or browser role may hold a table grant: the door is the only way
  -- in. The governor is excluded from this test because it OWNS the tables and
  -- its access is the stated policy the door runs under.
  if exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'kitluy_devices'
      and table_name in ('manufacturing_enrollment_tickets',
                         'manufacturing_enrollment_challenges',
                         'manufacturing_enrollment_ticket_events')
      and grantee in ('service_role', 'anon', 'authenticated', 'PUBLIC', 'kitluy_fleet_service')) then
    v_findings := v_findings ||
      'a service or browser role holds a direct table grant, so the ticket state machine can be stepped around'::text;
  end if;

  -- The two new policies must EXIST, or the grants above are inert under FORCE
  -- RLS and enrollment fails at the first device rather than here.
  if not exists (select 1 from pg_policy where polname = 'hardware_manifests_fleet_governor')
     or not exists (select 1 from pg_policy where polname = 'hardware_manifest_signals_fleet_governor') then
    v_findings := v_findings ||
      'the fleet-governor policies on hardware_manifests / hardware_manifest_signals are missing'::text;
  end if;

  -- The governor must actually be able to reach the canonical enrollment door.
  if not has_function_privilege(
       'kitluy_fleet_governor',
       'kitluy_devices.enroll_device_v1(text,uuid,timestamp with time zone,text,text,text,text,text,jsonb,text,text)',
       'execute') then
    v_findings := v_findings || 'kitluy_fleet_governor cannot execute enroll_device_v1'::text;
  end if;

  -- FORCE RLS must be backed by a policy, not by an owner that bypasses RLS
  -- (the 0189 lesson). A browser role must reach no table in this group.
  if exists (
    select 1 from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('manufacturing_enrollment_tickets',
                        'manufacturing_enrollment_challenges',
                        'manufacturing_enrollment_ticket_events')
      and (not c.relrowsecurity
        or not c.relforcerowsecurity
        or not exists (select 1 from pg_policy p where p.polrelid = c.oid))) then
    v_findings := v_findings ||
      'a table in this group lacks ENABLE+FORCE row security or has no policy behind it'::text;
  end if;

  foreach v_fn in array array[
    'manufacturing_enrollment_tickets',
    'manufacturing_enrollment_challenges',
    'manufacturing_enrollment_ticket_events'
  ] loop
    if has_table_privilege('anon', format('kitluy_devices.%I', v_fn), 'select')
       or has_table_privilege('authenticated', format('kitluy_devices.%I', v_fn), 'select') then
      v_findings := v_findings || format('%s is readable by a browser role', v_fn)::text;
    end if;
  end loop;

  -- No column anywhere in this group may hold a private key or a raw secret.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'kitluy_devices'
      and table_name in ('manufacturing_enrollment_tickets',
                         'manufacturing_enrollment_challenges')
      and (column_name like '%private%' or column_name like '%ticket_secret%')) then
    v_findings := v_findings || 'a column could hold private or raw secret material'::text;
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL 0190: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS 0190: the DEC-2 fresh-device enrollment doors are SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS kitluy_fleet_governor (group 0189''s established device-evidence owner) and admitted ONLY to kitluy_fleet_service by EXECUTE; service_role, PUBLIC, anon and authenticated hold no execute and no table grant, so the ticket state machine cannot be stepped around; the governor reaches the enrollment call graph by EXACT SIGNATURE with no schema-wide grant and no DELETE, and exactly two new policies were added (hardware_manifests, hardware_manifest_signals) because those were the only enrollment tables it lacked. DEC-5 IS NOT CLOSED: postgres retains ADMIN OPTION on kitluy_fleet_governor, so Property B remains FAIL as the accepted development residual — this group is DEC-5-ALIGNED, not DEC-5-passing.';
end
$guard$;
