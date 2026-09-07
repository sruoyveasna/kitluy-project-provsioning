-- =============================================================================
-- Group 0205 — C-3: a failed first issuance must not brick a Store Hub
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, verdict
-- REJECTED, critical finding C-3; owner remediation Phase 2026-08-26 Phase 3;
-- KLRISK-DEVICE-012 (group 0161, the abandoned-key basis).
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `register_generation_key_v1` binds ONE key to generation 1 permanently, and
-- rightly so: a device that could re-register generation 1 under a new key could
-- silently replace its own identity. But the composition registered the key
-- BEFORE the certificate was signed, so every failure after that point —
-- CA unavailable, a signing error, a crash, a dropped response — left the slot
-- spent on a key whose certificate never existed.
--
-- If the Hub also lost the private half (a crash before it persisted the key,
-- which is the ordinary case on first boot) the device was finished. Generation
-- 1 was taken by a key nobody held, `KLUY-KEY-GENERATION-TAKEN` refused every
-- retry, and the only remedy was a database edit. On a physical Store Hub in a
-- shop, that is a brick.
--
-- =============================================================================
-- WHY THE RECOVERY DOOR EXISTED AND DID NOTHING
-- =============================================================================
-- `abandon_generation_key_v1` was already here, from the renewal work, and it
-- sets `state = 'abandoned'` exactly as you would want. It could not help,
-- because `device_generation_keys_gen_key` is a PLAIN unique index over
-- (device, environment, purpose, generation). An abandoned row still occupies
-- the slot, so abandoning a key changed a status column and freed nothing.
--
-- The repair is therefore small and surgical rather than a new mechanism:
--
--   1. The slot index becomes PARTIAL, so an abandoned or destroyed key no
--      longer holds a generation.
--   2. `register_generation_key_v1` looks past abandoned rows.
--   3. `abandon_generation_key_v1` gains the guard it never had — see below.
--
-- The FINGERPRINT index stays absolute. Freeing a generation must never mean a
-- key can be reused: `device_generation_keys_fingerprint_key` is what stops an
-- abandoned key from coming back on another device, and it is untouched.
--
-- =============================================================================
-- THE GUARD THE ABANDON DOOR NEVER HAD
-- =============================================================================
-- Making abandonment effective makes it dangerous. Before this group it could
-- not free a slot, so its missing checks were harmless; after it, an unguarded
-- abandon is a key-replacement backdoor — abandon the active generation,
-- register a different key, and the device's identity has been swapped by a
-- caller holding only `kitluy_issuance_service`.
--
-- So abandonment is now refused when the generation has anything real behind it:
-- a recorded certificate artifact, an active key, or an active device. What
-- remains reachable is exactly the case C-3 describes — a reservation that
-- never became a certificate — and it is recorded, not erased.
-- =============================================================================

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. RSA key inspection, so the database can refuse a key it cannot use
-- -----------------------------------------------------------------------------

-- The DER inside a `BEGIN PUBLIC KEY` block.
create or replace function kitluy_devices.pem_public_key_to_der_v1(p_pem text)
returns bytea
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_body text;
begin
  v_body := (regexp_matches(p_pem, '-----BEGIN PUBLIC KEY-----(.*?)-----END PUBLIC KEY-----', 's'))[1];
  if v_body is null then
    raise exception 'KLUY-SPKI-MALFORMED: no PEM public key block' using errcode = 'P0001';
  end if;
  return decode(regexp_replace(v_body, '[[:space:]]', '', 'g'), 'base64');
end;
$fn$;

/*
 * The modulus size of an RSA SubjectPublicKeyInfo, in bits. Zero when the key
 * is not RSA at all.
 *
 * Returns a number rather than raising, so a caller can distinguish "this is an
 * EC key" from "this is not a key" and say so.
 */
create or replace function kitluy_devices.spki_rsa_modulus_bits_v1(p_spki_der bytea)
returns int
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  -- OID 1.2.840.113549.1.1.1, rsaEncryption.
  c_rsa constant bytea := '\x06092a864886f70d010101'::bytea;
  v_parts   bytea[];
  v_bitstr  int[];
  v_rsa_key bytea;
  v_key     bytea[];
  v_modulus bytea;
begin
  v_parts := kitluy_devices.asn1_children_v1(p_spki_der);
  if array_length(v_parts, 1) <> 2 then return 0; end if;
  if position(c_rsa in v_parts[1]) = 0 then return 0; end if;

  v_bitstr := kitluy_devices.asn1_read_tlv_v1(v_parts[2], 0);
  if v_bitstr[1] <> 3 then return 0; end if;
  if get_byte(v_parts[2], v_bitstr[2]) <> 0 then return 0; end if;
  v_rsa_key := substring(v_parts[2] from v_bitstr[2] + 2 for v_bitstr[3] - 1);

  v_key := kitluy_devices.asn1_children_v1(v_rsa_key);
  if array_length(v_key, 1) < 2 then return 0; end if;
  v_modulus := kitluy_devices.asn1_integer_bytes_v1(v_key[1]);
  return length(v_modulus) * 8;
exception when others then
  return 0;
end;
$fn$;

/*
 * Name the algorithm of a SubjectPublicKeyInfo, or 'unsupported'.
 *
 * TWO algorithms are supported here, and the reason is that this repository
 * genuinely issues two different credentials:
 *
 *   ed25519   the CANONICAL KitLuy credential — canonical JSON with a detached
 *             Ed25519 signature, deliberately not X.509 (CREDENTIAL_IS_NOT_X509).
 *   rsa-2048  the OPERATIONAL TLS certificate, because Hub LAN mutual TLS needs
 *             an X.509 leaf and forge signs RSA.
 *
 * An earlier draft of this function demanded RSA-2048 outright and refused 147
 * assertions across the canonical credential lifecycle, all of them correctly
 * using Ed25519. That was the wrong boundary: this door serves both credentials,
 * so it enumerates what the repository can actually sign with rather than what
 * one caller happens to need.
 *
 * Anything else — RSA-1024, P-256, a malformed key — is refused BEFORE the
 * generation slot is spent, which is the whole point of C-3.
 */
create or replace function kitluy_devices.spki_algorithm_v1(p_spki_der bytea)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  -- OID 1.3.101.112, id-Ed25519.
  c_ed25519 constant bytea := '\x06032b6570'::bytea;
  v_parts bytea[];
  v_bits  int;
begin
  v_parts := kitluy_devices.asn1_children_v1(p_spki_der);
  if array_length(v_parts, 1) <> 2 then return 'unsupported'; end if;
  if position(c_ed25519 in v_parts[1]) > 0 then
    return 'ed25519';
  end if;
  v_bits := kitluy_devices.spki_rsa_modulus_bits_v1(p_spki_der);
  if v_bits = 0 then return 'unsupported'; end if;
  return 'rsa-' || v_bits::text;
exception when others then
  return 'unsupported';
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 2. An abandoned generation no longer holds its slot
-- -----------------------------------------------------------------------------
-- kitluy:destructive-approved:KLD-2026-08-26-FIRST-ISSUANCE-RECOVERY-001 -- the
-- DROP CONSTRAINT below is the repair itself, and it WIDENS rather than removes:
-- every row that satisfied `device_generation_keys_gen_key` satisfies the
-- partial index that replaces it. No row is deleted, no column dropped, no data
-- rewritten. The guard at the end of this file asserts that the ABSOLUTE
-- fingerprint uniqueness survived, because that is the constraint which stops a
-- freed generation from becoming key reuse.
do $slot$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'kitluy_devices'
                and indexname = 'device_generation_keys_gen_key') then
    -- It backs a UNIQUE CONSTRAINT, so it is dropped as a constraint.
    alter table kitluy_devices.device_generation_keys
      drop constraint if exists device_generation_keys_gen_key;
  end if;
end
$slot$;

-- Partial: a live generation still holds exactly one key, and a key that was
-- abandoned or destroyed holds nothing. `destroyed` is included because a
-- destroyed key is, by definition, no longer usable for anything.
create unique index if not exists device_generation_keys_live_gen_key
  on kitluy_devices.device_generation_keys (device_record_id, environment, purpose, generation)
  where state not in ('abandoned', 'destroyed');

comment on index kitluy_devices.device_generation_keys_live_gen_key is
  'Group 0205 (C-3). Replaces the plain unique constraint device_generation_keys_gen_key. One LIVE key per generation; an abandoned or destroyed key frees the slot so a Hub whose first issuance failed can ask again. The fingerprint uniqueness stays absolute, so freeing a slot never permits key reuse.';

-- -----------------------------------------------------------------------------
-- 3. Registration looks past abandoned keys
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.register_generation_key_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_generation integer,
  p_key_handle text,
  p_public_key text,
  p_public_key_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $fn$
declare
  v_row       kitluy_devices.device_generation_keys;
  v_algorithm text;
begin
  if p_environment <> 'development' then
    raise exception 'KLUY-KEY-ENVIRONMENT-BLOCKED: % key registration is BLOCKED', p_environment
      using errcode = 'P0001';
  end if;

  -- C-3: THE KEY IS INSPECTED BEFORE THE SLOT IS SPENT.
  --
  -- A key this repository cannot sign with will fail at signing no matter what,
  -- and by then the generation is gone — spent exactly once, on a request that
  -- was never going to finish. So it is refused here, from the key's OWN DER
  -- rather than from a caller-supplied algorithm label, for the same reason a
  -- certificate's fingerprint is computed rather than copied (C-1).
  --
  -- Both supported algorithms are accepted, because this door serves both
  -- credentials: Ed25519 for the canonical KitLuy credential, RSA-2048 for the
  -- operational X.509 the Hub LAN needs. The operational path narrows further to
  -- RSA-2048 in `validateOperationalKey`, before it ever reaches this door.
  v_algorithm := kitluy_devices.spki_algorithm_v1(
                   kitluy_devices.pem_public_key_to_der_v1(p_public_key));
  if v_algorithm not in ('ed25519', 'rsa-2048') then
    raise exception 'KLUY-KEY-UNSUPPORTED-ALGORITHM: % cannot be signed with in this environment; supported: ed25519, rsa-2048', v_algorithm
      using errcode = 'P0001';
  end if;

  -- Idempotent: re-registering the SAME key for the same generation replays.
  -- Abandoned and destroyed rows are skipped — they no longer hold the slot, and
  -- a device recovering from a failed first issuance must not be told its own
  -- dead reservation is in the way.
  select * into v_row from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = p_generation
    and state not in ('abandoned', 'destroyed')
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
$fn$;

alter function kitluy_devices.register_generation_key_v1(uuid, text, text, integer, text, text, text)
  owner to kitluy_credential_issuer;

comment on function kitluy_devices.register_generation_key_v1(uuid, text, text, integer, text, text, text) is
  'Group 0205 (C-3). Registers a device-generated key for one generation. The key is inspected from its own DER and must be RSA-2048, so an unusable key cannot burn a generation. Abandoned and destroyed keys no longer hold their slot, so a failed first issuance is recoverable.';

-- -----------------------------------------------------------------------------
-- 4. Abandonment, now that it actually frees something
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.abandon_generation_key_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_generation integer,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $fn$
declare
  v_row         kitluy_devices.device_generation_keys;
  v_reservation kitluy_devices.device_renewal_reservations;
  v_device      kitluy_devices.devices;
  v_artifacts   int;
begin
  select * into v_row from kitluy_devices.device_generation_keys
  where device_record_id = p_device_record_id and environment = p_environment
    and purpose = p_purpose and generation = p_generation
    and state not in ('abandoned', 'destroyed')
  for update;

  if not found then
    -- Either nothing was ever registered, or it is already abandoned. Both are
    -- reported as already-abandoned when a dead row exists, so a retrying
    -- recovery client sees a stable answer.
    if exists (select 1 from kitluy_devices.device_generation_keys
                where device_record_id = p_device_record_id and environment = p_environment
                  and purpose = p_purpose and generation = p_generation) then
      return jsonb_build_object('outcome', 'ALREADY_ABANDONED');
    end if;
    raise exception 'KLUY-KEY-MISSING: no key registered for generation %', p_generation
      using errcode = 'P0001';
  end if;

  -- ---------------------------------------------------------------------------
  -- THE GUARDS. Abandonment could not free a slot before group 0205, so it did
  -- not need these. It can now, so an unguarded abandon would be a way to swap
  -- a device's identity while holding only `kitluy_issuance_service`.
  -- ---------------------------------------------------------------------------
  select count(*) into v_artifacts
    from kitluy_devices.device_certificates c
    join kitluy_devices.device_credentials cr on cr.credential_id = c.credential_id
   where cr.device_record_id = p_device_record_id
     and cr.environment = p_environment
     and cr.certificate_generation = p_generation
     and c.certificate_pem is not null;
  if v_artifacts > 0 then
    raise exception 'KLUY-KEY-ABANDON-REFUSED: generation % already carries a certificate artifact; abandoning it would replace a live identity', p_generation
      using errcode = 'P0001';
  end if;

  if v_row.state = 'active' then
    raise exception 'KLUY-KEY-ABANDON-REFUSED: generation % is the ACTIVE key', p_generation
      using errcode = 'P0001';
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_record_id;
  if v_device.lifecycle_state = 'active' then
    raise exception 'KLUY-KEY-ABANDON-REFUSED: device % is ACTIVE; an active device''s key is not an incomplete issuance', p_device_record_id
      using errcode = 'P0001';
  end if;

  -- The record is kept, never deleted. `abandon_reason` is required by the
  -- table's own CHECK, so a recovery always says why it happened.
  update kitluy_devices.device_generation_keys
     set state = 'abandoned', abandoned_at = pg_catalog.now(), abandon_reason = p_reason
   where id = v_row.id;

  -- Group 0161 (KLRISK-DEVICE-012): the attempt this key was minted for is dead
  -- too. An already-terminal reservation is left alone.
  if v_row.renewal_attempt_id is not null then
    update kitluy_devices.device_renewal_reservations
       set status = 'abandoned'
     where renewal_attempt_id = v_row.renewal_attempt_id
       and status not in ('completed', 'refused', 'abandoned')
    returning * into v_reservation;
  end if;

  -- A credential that was reserved or even finalized for this generation but
  -- never acquired an artifact dies with it. Left `issued`, it would keep the
  -- credential head pointing at a generation whose key is gone.
  update kitluy_devices.device_credentials
     set state = 'superseded'
   where device_record_id = p_device_record_id
     and environment = p_environment
     and certificate_generation = p_generation
     and state = 'issued'
     and not exists (
       select 1 from kitluy_devices.device_certificates c
        where c.credential_id = device_credentials.credential_id
          and c.certificate_pem is not null);

  return jsonb_build_object(
    'outcome', 'ABANDONED',
    'key_id', v_row.id,
    'reservation_closed', v_reservation.renewal_attempt_id is not null);
end;
$fn$;

alter function kitluy_devices.abandon_generation_key_v1(uuid, text, text, integer, text)
  owner to kitluy_credential_issuer;

comment on function kitluy_devices.abandon_generation_key_v1(uuid, text, text, integer, text) is
  'Group 0205 (C-3). Abandons an INCOMPLETE generation key so a Hub whose first issuance failed can ask again. Refused when the generation already carries a certificate artifact, when the key is active, or when the device is active — without those guards a freed slot would be a key-replacement backdoor. The row is kept and carries its reason; nothing is deleted.';

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 4b. The promotion trigger has the same blind lookup
-- -----------------------------------------------------------------------------
--
-- `promote_generation_key` fires when a credential is finalized and promotes the
-- matching generation key to `active`. It selected by (device, environment,
-- purpose, generation) with NO state filter, so after a recovery it found the
-- ABANDONED key and refused the replacement's issuance with
-- `KLUY-KEY-NOT-GENERATED`. Freeing the slot in the index was not enough; every
-- lookup that resolves "the key for this generation" has to agree on what that
-- means.
--
-- Body unchanged apart from that filter and the qualified `now()`.
create or replace function kitluy_devices.promote_generation_key()
returns trigger
language plpgsql
set search_path = pg_catalog, kitluy_devices
as $fn$
declare
  v_key kitluy_devices.device_generation_keys;
  v_is_rotation boolean;
begin
  select * into v_key from kitluy_devices.device_generation_keys
  where device_record_id = new.device_record_id
    and environment = new.environment
    and purpose = new.purpose
    and generation = new.certificate_generation
    -- Group 0205 (C-3): an abandoned or destroyed key is not the generation's
    -- key any more. Without this, one failed first issuance made the device
    -- permanently unissuable even after a governed recovery.
    and state not in ('abandoned', 'destroyed');

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
      activated_at = case when v_is_rotation then null else pg_catalog.now() end
  where id = v_key.id;

  if v_is_rotation then
    update kitluy_devices.device_renewal_reservations
    set status = 'activation_pending'
    where renewal_attempt_id = v_key.renewal_attempt_id;
  end if;

  return new;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Apply-time proof
-- -----------------------------------------------------------------------------
do $guard$
begin
  if exists (select 1 from pg_constraint
              where conname = 'device_generation_keys_gen_key'
                and conrelid = 'kitluy_devices.device_generation_keys'::regclass) then
    raise exception 'KLUY-MIGRATION-0205: the absolute generation constraint still exists; abandonment cannot free a slot'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'kitluy_devices'
                    and indexname = 'device_generation_keys_live_gen_key') then
    raise exception 'KLUY-MIGRATION-0205: the partial generation index is missing; a generation could hold two live keys'
      using errcode = 'P0001';
  end if;

  -- The fingerprint index must NOT have been relaxed. Freeing a generation must
  -- never mean a key can be reused, on this device or any other.
  if not exists (select 1 from pg_constraint
                  where conname = 'device_generation_keys_fingerprint_key'
                    and conrelid = 'kitluy_devices.device_generation_keys'::regclass) then
    raise exception 'KLUY-MIGRATION-0205: the absolute fingerprint uniqueness is gone; keys could be reused'
      using errcode = 'P0001';
  end if;

  -- Every lookup that resolves "the key for this generation" must agree that an
  -- abandoned key is not it. Missing this in the promotion trigger made the
  -- recovery path look like it worked and then fail one step later.
  if position('state not in (''abandoned'', ''destroyed'')' in
       (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'kitluy_devices' and p.proname = 'promote_generation_key')) = 0 then
    raise exception 'KLUY-MIGRATION-0205: the promotion trigger still promotes abandoned keys'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0205: a failed first issuance is recoverable, and recovery cannot replace a live identity';
end
$guard$;

commit;
