-- kitluy:group:0208
-- =============================================================================
-- Group 0208 — H-1 generation hardening, H-2 artifact idempotency, M-1 serials
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review 2026-08-26, findings
-- H-1, H-2 and M-1; owner remediation Phases 6, 7 and 8.
--
-- Three findings in one group because they are three properties of the same
-- write: which device may reserve a generation, how many artifacts one
-- credential may carry, and whether the serial in the certificate is the serial
-- the rest of the system will look for.
--
-- =============================================================================
-- H-1 — `register_generation_key_v1` accepted almost anything
-- =============================================================================
-- It checked the environment and the generation slot. It did not check that the
-- device EXISTS, that it is in a state where issuance means anything, that it
-- is not quarantined or under investigation, or that it has a Store assignment
-- at all. A caller holding `kitluy_issuance_service` could reserve generation 1
-- for a retired device, a quarantined device, or a device that had never been
-- paired to anywhere.
--
-- The generation is also no longer taken on trust. It must equal what the
-- governed head says comes next — 1 when there is no head, `current_generation`
-- when re-registering the live one. A caller cannot reach forward and park a key
-- on generation 7.
--
-- =============================================================================
-- H-2 — one credential, one artifact, enforced by the schema
-- =============================================================================
-- The door refused a second, different certificate for a credential. Two
-- CONCURRENT calls could still both pass that check before either inserted, and
-- the loser surfaced a raw SQLSTATE 23505 from an index that did not exist
-- anyway — `device_certificates_credential_idx` is NOT unique.
--
-- So: a real UNIQUE index on `credential_id`, and the insert becomes
-- ON CONFLICT DO NOTHING with a re-read. The loser of a race now gets
-- ALREADY_RECORDED and the canonical existing artifact, which is what a retrying
-- Hub needs, instead of a constraint-violation string it cannot interpret.
--
-- =============================================================================
-- M-1 — the serial in the certificate was truncated
-- =============================================================================
-- The leaf's serial was built as `'00' || hex(credential_serial)` and then
-- `.slice(0, 40)`. A credential serial is `DEV-` plus 16 hex characters — 20
-- ASCII bytes, 40 hex characters — so the prefix pushed it to 42 and the slice
-- silently dropped the last byte. Every issued certificate carried a serial that
-- was NOT the credential's.
--
-- That is harmless today only because nothing compares them yet. It stops being
-- harmless the moment Hub mTLS authorization, the revocation projection or the
-- offline revocation set try to match a presented certificate to a credential —
-- which is the next milestone.
--
-- One canonical normalization, `x509_serial_for_credential_v1`, now defines the
-- mapping, and the artifact door RECOMPUTES the serial from the certificate's
-- own DER and refuses anything that does not match. The stored
-- `certificate_x509_serial` is therefore read out of the leaf, not asserted
-- beside it — the same discipline C-1 applied to the public key.
-- =============================================================================

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- M-1: the canonical serial mapping
-- -----------------------------------------------------------------------------
--
-- A credential serial is `DEV-` + 16 hex characters, which is 8 bytes of real
-- entropy wearing 20 bytes of clothing. RFC 5280 caps a certificate serial at 20
-- octets, so the ASCII form cannot be used directly once a positive-sign prefix
-- is added.
--
-- The mapping is therefore: take the 8 significant bytes, prefix 0x00 to keep
-- the ASN.1 INTEGER positive. Nine octets, deterministic, and reversible — the
-- credential serial can be recovered from the certificate, which is what a
-- revocation projection needs.
--
-- Any other serial shape falls back to SHA-256 truncated to 19 bytes plus the
-- same 0x00 prefix: still deterministic, still inside the limit, and it never
-- silently truncates the way the old string slice did.
-- Strip leading zero BYTES from a hex string, keeping at least one byte. The
-- shortest-form rule DER applies to INTEGER content.
create or replace function kitluy_devices.minimal_hex_v1(p_hex text)
returns text
language sql
immutable
set search_path = pg_catalog
as $fn$
  select coalesce(nullif(regexp_replace(p_hex, '^(00)+', ''), ''), '00')
$fn$;

create or replace function kitluy_devices.x509_serial_for_credential_v1(p_serial text)
returns text
language plpgsql
immutable
set search_path = pg_catalog, extensions
as $fn$
begin
  if p_serial is null then
    raise exception 'KLUY-SERIAL-NULL' using errcode = 'P0001';
  end if;
  -- MINIMAL DER encoding, with leading zero bytes removed.
  --
  -- Not a stylistic choice: DER requires the shortest form, and node-forge
  -- normalises accordingly — hand it '000123456789abcdef' and the certificate
  -- carries the eight bytes 0123456789abcdef. A mapping that kept the padding
  -- would disagree with every certificate ever issued, which is precisely how
  -- the first version of this check refused its own valid output.
  if p_serial ~ '^DEV-[0-9A-Fa-f]{16}$' then
    return kitluy_devices.minimal_hex_v1(lower(substr(p_serial, 5)));
  end if;
  return kitluy_devices.minimal_hex_v1(
           encode(substring(extensions.digest(p_serial, 'sha256') from 1 for 19), 'hex'));
end;
$fn$;

comment on function kitluy_devices.x509_serial_for_credential_v1(text) is
  'Group 0208 (M-1). THE canonical credential-serial -> X.509-serial mapping. Nine octets for the DEV- form and reversible, so a revocation projection can recover the credential serial from a presented certificate. Replaces a string concatenation that was truncated by .slice(0,40) and produced a serial that was not the credential''s.';

alter table kitluy_devices.device_certificates
  add column if not exists certificate_x509_serial text;

comment on column kitluy_devices.device_certificates.certificate_x509_serial is
  'Group 0208 (M-1). The serial READ OUT of the leaf certificate''s DER, lowercase hex. Recomputed and compared against x509_serial_for_credential_v1(credential serial) by the artifact door; a mismatch is refused, so this column and the certificate can never disagree.';

-- -----------------------------------------------------------------------------
-- H-2: one credential, one artifact
-- -----------------------------------------------------------------------------
create unique index if not exists device_certificates_credential_uq
  on kitluy_devices.device_certificates (credential_id)
  where credential_id is not null;

comment on index kitluy_devices.device_certificates_credential_uq is
  'Group 0208 (H-2). One governed credential carries exactly one operational artifact. device_certificates_credential_idx looked like this and was NOT unique, so two concurrent recordings could both pass the door''s existence check.';

-- H-1's assignment check needs to READ assignments — grant AND policy.
--
-- The fifth time in this stream. `device_assignments` FORCEs row security, so a
-- grant on its own returns ZERO ROWS rather than raising, and the new check
-- would then refuse every device with "no live Store assignment" — fail-closed,
-- and completely misleading. Stated together, asserted below.
grant select on kitluy_devices.device_assignments to kitluy_credential_issuer;

do $assignment_policy$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_assignments'::regclass
       and polname = 'device_assignments_credential_issuer_read') then
    create policy device_assignments_credential_issuer_read
      on kitluy_devices.device_assignments
      for select to kitluy_credential_issuer using (true);
  end if;
end
$assignment_policy$;

-- -----------------------------------------------------------------------------
-- H-1: who may reserve a generation
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
  v_device    kitluy_devices.devices;
  v_head      kitluy_devices.device_credential_heads;
  v_expected  integer;
  v_algorithm text;
begin
  if p_environment <> 'development' then
    raise exception 'KLUY-KEY-ENVIRONMENT-BLOCKED: % key registration is BLOCKED', p_environment
      using errcode = 'P0001';
  end if;

  -- H-1: THE DEVICE, BEFORE ANYTHING ELSE.
  select * into v_device from kitluy_devices.devices where id = p_device_record_id;
  if not found then
    raise exception 'KLUY-KEY-NO-DEVICE: device % does not exist', p_device_record_id
      using errcode = 'P0001';
  end if;

  -- A retired, replaced, suspended or quarantined device has no business
  -- acquiring a new operational key. `restricted_investigation` is included
  -- deliberately: a device under investigation must not be able to re-key
  -- itself out of whatever is being investigated.
  if v_device.lifecycle_state not in ('enrolled', 'awaiting_trust', 'active') then
    raise exception 'KLUY-KEY-DEVICE-STATE: device % is %; only enrolled, awaiting_trust or active devices may register a key',
      p_device_record_id, v_device.lifecycle_state using errcode = 'P0001';
  end if;
  if v_device.quarantined_at is not null then
    raise exception 'KLUY-KEY-DEVICE-QUARANTINED: device % is quarantined', p_device_record_id
      using errcode = 'P0001';
  end if;

  -- A device with no live Store assignment has no Store to serve, so a key for
  -- it protects nothing. This is also what stops a caller reserving generation 1
  -- for an arbitrary device id it happens to know: an unpaired board is refused.
  if not exists (
    select 1 from kitluy_devices.device_assignments
     where device_id = p_device_record_id
       and state in ('pending_trust', 'active')
       and store_location_id is not null) then
    raise exception 'KLUY-KEY-NO-ASSIGNMENT: device % has no live Store assignment; pair it before requesting a key',
      p_device_record_id using errcode = 'P0001';
  end if;

  -- C-3: the key is inspected before the slot is spent. Both supported
  -- algorithms, because this door serves both credentials: Ed25519 for the
  -- canonical KitLuy credential, RSA-2048 for the operational X.509.
  v_algorithm := kitluy_devices.spki_algorithm_v1(
                   kitluy_devices.pem_public_key_to_der_v1(p_public_key));
  if v_algorithm not in ('ed25519', 'rsa-2048') then
    raise exception 'KLUY-KEY-UNSUPPORTED-ALGORITHM: % cannot be signed with in this environment; supported: ed25519, rsa-2048', v_algorithm
      using errcode = 'P0001';
  end if;

  -- H-1: THE GENERATION IS DERIVED, NOT ACCEPTED.
  -- With no head this is a first issuance and the only legal answer is 1. With a
  -- head, a caller may re-register the CURRENT generation (an idempotent retry)
  -- or claim the next one — never reach further forward and park a key on a
  -- generation the lifecycle has not reached.
  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = p_device_record_id and environment = p_environment
     and purpose = p_purpose;
  v_expected := coalesce(v_head.current_generation, 0);
  if p_generation not in (v_expected, v_expected + 1) or p_generation < 1 then
    raise exception 'KLUY-KEY-GENERATION-OUT-OF-SEQUENCE: generation % is not reachable from the governed head (%); expected % or %',
      p_generation, v_expected, greatest(v_expected, 1), v_expected + 1
      using errcode = 'P0001';
  end if;

  -- Idempotent: re-registering the SAME key for the same generation replays.
  -- Abandoned and destroyed rows are skipped — they no longer hold the slot
  -- (group 0205, C-3).
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
  'Group 0208 (H-1, with C-3 from 0205). Registers a device-generated key for one generation. The device must exist, be in an issuable lifecycle state, be un-quarantined and hold a live Store assignment; the generation must be reachable from the governed head; the key must be an algorithm this environment can sign with. Abandoned and destroyed keys no longer hold their slot.';

-- -----------------------------------------------------------------------------
-- The artifact door: serial verified from the DER, recording race-safe
-- -----------------------------------------------------------------------------
--
-- Two changes on top of group 0203's body, both narrow:
--
--   M-1  the leaf's serial is READ from its own DER and compared against the
--        canonical mapping of the credential's serial. Recomputed, not asserted
--        beside it — the discipline C-1 established for the public key, applied
--        to the other identifier that has to match.
--
--   H-2  the insert becomes ON CONFLICT DO NOTHING followed by a re-read, so the
--        loser of a concurrent recording gets ALREADY_RECORDED and the canonical
--        artifact rather than a raw 23505 it cannot interpret.
create or replace function kitluy_devices.record_operational_certificate_v1(
  p_credential_id uuid,
  p_certificate_pem text,
  p_chain_pem text,
  p_public_key_algorithm text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $fn$
declare
  v_credential    kitluy_devices.device_credentials;
  v_head          kitluy_devices.device_credential_heads;
  v_enrollment_id uuid;
  v_leaf_ders     bytea[];
  v_leaf          bytea;
  v_chain_ders    bytea[];
  v_root          kitluy_devices.pki_pinned_trust_anchors;
  v_issuing       kitluy_devices.pki_pinned_trust_anchors;
  v_root_der      bytea;
  v_issuing_der   bytea;
  v_leaf_fp       text;
  v_sha           text;
  v_serial_tlv    bytea;
  v_serial_hex    text;
  v_expected_ser  text;
  v_existing      kitluy_devices.device_certificates;
  v_id            uuid;
  v_seen_root     boolean := false;
  v_seen_issuing  boolean := false;
  v_der           bytea;
begin
  select * into v_credential from kitluy_devices.device_credentials
   where credential_id = p_credential_id;
  if not found then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-CREDENTIAL',
      'detail','no governed credential with that id');
  end if;

  if v_credential.environment <> 'development' then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-ENVIRONMENT',
      'detail','operational certificates are issued for development only');
  end if;

  if v_credential.state <> 'issued' or v_credential.revoked_at is not null then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CREDENTIAL-STATE',
      'state', v_credential.state,
      'detail','only an issued, non-revoked credential may carry an artifact');
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_credential.device_record_id
     and environment = v_credential.environment
     and purpose = v_credential.purpose;
  if not found or v_head.current_generation <> v_credential.certificate_generation then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-STALE-GENERATION',
      'detail','the credential is not the current generation for this device');
  end if;

  v_leaf_ders := kitluy_devices.pem_certificates_to_der_v1(p_certificate_pem);
  if array_length(v_leaf_ders, 1) is distinct from 1 then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-MALFORMED',
      'detail','supply exactly one leaf certificate');
  end if;
  v_leaf := v_leaf_ders[1];

  -- C-1: the key binding, computed from the certificate's own SPKI.
  begin
    v_leaf_fp := kitluy_devices.x509_public_key_fingerprint_v1(v_leaf);
  exception when others then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-MALFORMED',
      'detail','the leaf certificate could not be parsed');
  end;

  if v_leaf_fp is distinct from v_credential.public_key_fingerprint then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-KEY-BINDING',
      'detail','the certificate does not contain the public key of the governed credential',
      'computed_leaf_public_key_fingerprint', v_leaf_fp);
  end if;

  -- M-1: THE SERIAL, READ OUT OF THE CERTIFICATE.
  -- The leaf used to carry a serial built by string concatenation and then
  -- truncated with .slice(0,40), which silently dropped its last byte — so every
  -- issued certificate named a serial that was not the credential's. Here the
  -- INTEGER's content bytes are taken from the DER and compared to the canonical
  -- mapping; a mismatch is refused rather than stored beside the disagreement.
  select * into v_root from kitluy_devices.pki_pinned_trust_anchors
   where environment = 'development' and anchor_role = 'development_root';
  if not found then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-TRUST-ANCHOR',
      'detail','no development root is pinned; run the PKI bootstrap');
  end if;
  select * into v_issuing from kitluy_devices.pki_pinned_trust_anchors
   where environment = 'development' and anchor_role = 'development_device_issuing';
  if not found then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-TRUST-ANCHOR',
      'detail','no development issuing CA is pinned; run the PKI bootstrap');
  end if;
  v_root_der := (kitluy_devices.pem_certificates_to_der_v1(v_root.certificate_pem))[1];
  v_issuing_der := (kitluy_devices.pem_certificates_to_der_v1(v_issuing.certificate_pem))[1];

  if encode(extensions.digest(v_leaf, 'sha256'), 'hex') in
       (v_root.certificate_sha256, v_issuing.certificate_sha256) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NOT-A-LEAF',
      'detail','a trust anchor cannot be recorded as a device certificate');
  end if;
  if kitluy_devices.x509_field_v1(v_leaf, 'issuer')
       = kitluy_devices.x509_field_v1(v_leaf, 'subject') then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-SELF-SIGNED',
      'detail','a self-issued certificate carries no authority');
  end if;

  if not kitluy_devices.x509_signature_is_valid_v1(v_leaf, v_issuing_der) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CHAIN-UNVERIFIED',
      'detail','the leaf is not signed by the pinned development issuing CA');
  end if;
  if not kitluy_devices.x509_signature_is_valid_v1(v_issuing_der, v_root_der) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CHAIN-UNVERIFIED',
      'detail','the pinned issuing CA does not chain to the pinned development root');
  end if;

  v_chain_ders := kitluy_devices.pem_certificates_to_der_v1(p_chain_pem);
  if array_length(v_chain_ders, 1) is null then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-CHAIN',
      'detail','a device cannot verify a leaf without its issuer chain');
  end if;
  foreach v_der in array v_chain_ders loop
    if v_der = v_root_der then v_seen_root := true; end if;
    if v_der = v_issuing_der then v_seen_issuing := true; end if;
  end loop;
  if not (v_seen_root and v_seen_issuing) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CHAIN-MISMATCH',
      'detail','the supplied chain is not the pinned development chain');
  end if;

  -- M-1: THE SERIAL, READ OUT OF THE CERTIFICATE.
  --
  -- Ordered AFTER the chain checks deliberately. A certificate from a rogue CA
  -- also has a wrong serial, and reporting that as a serial problem would send
  -- an operator to the least important thing wrong with it.
  --
  -- `asn1_integer_bytes_v1` strips the leading zero DER adds for sign, so both
  -- sides of this comparison are the minimal form.
  v_serial_tlv := kitluy_devices.x509_field_v1(v_leaf, 'serial');
  v_serial_hex := encode(kitluy_devices.asn1_integer_bytes_v1(v_serial_tlv), 'hex');
  v_expected_ser := kitluy_devices.x509_serial_for_credential_v1(v_credential.serial_number);
  if v_serial_hex is distinct from v_expected_ser then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-SERIAL-MISMATCH',
      'detail','the certificate serial is not the canonical encoding of the credential serial',
      'certificate_x509_serial', v_serial_hex, 'expected_x509_serial', v_expected_ser);
  end if;

  v_sha := encode(extensions.digest(v_leaf, 'sha256'), 'hex');

  select * into v_existing from kitluy_devices.device_certificates
   where credential_id = p_credential_id;
  if found then
    if v_existing.certificate_sha256 is distinct from v_sha then
      return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-ARTIFACT-CONFLICT',
        'detail','this credential already carries a DIFFERENT certificate');
    end if;
    return jsonb_build_object('outcome','ALREADY_RECORDED','certificate_id', v_existing.id,
      'certificate_sha256', v_existing.certificate_sha256,
      'certificate_serial', v_existing.certificate_serial,
      'certificate_x509_serial', v_existing.certificate_x509_serial,
      'certificate_generation', v_existing.certificate_generation);
  end if;

  select current_enrollment_id into v_enrollment_id
    from kitluy_devices.devices where id = v_credential.device_record_id;

  -- H-2: the race. The check above and this insert are not atomic together, so
  -- two concurrent recordings could both reach here. ON CONFLICT makes the loser
  -- a no-op instead of a raw 23505, and it re-reads below.
  insert into kitluy_devices.device_certificates (
    device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
    issuer_reference, status, issued_at, expires_at,
    credential_id, certificate_generation, public_key_algorithm,
    certificate_pem, certificate_sha256, chain_pem, certificate_x509_serial)
  values (
    v_credential.device_record_id, v_enrollment_id, v_credential.environment,
    v_credential.serial_number,
    v_leaf_fp,
    v_issuing.certificate_sha256, 'active', v_credential.not_before, v_credential.not_after,
    p_credential_id, v_credential.certificate_generation, p_public_key_algorithm,
    p_certificate_pem, v_sha, p_chain_pem,
    v_serial_hex)
  on conflict (credential_id) where credential_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    -- Someone else recorded it between the check and the insert. Report what is
    -- actually stored rather than what this call was carrying.
    select * into v_existing from kitluy_devices.device_certificates
     where credential_id = p_credential_id;
    if not found then
      return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-ARTIFACT-NOT-PERSISTED',
        'detail','the artifact was neither written nor found after a conflict');
    end if;
    if v_existing.certificate_sha256 is distinct from v_sha then
      return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-ARTIFACT-CONFLICT',
        'detail','this credential already carries a DIFFERENT certificate');
    end if;
    return jsonb_build_object('outcome','ALREADY_RECORDED','certificate_id', v_existing.id,
      'certificate_sha256', v_existing.certificate_sha256,
      'certificate_serial', v_existing.certificate_serial,
      'certificate_x509_serial', v_existing.certificate_x509_serial,
      'certificate_generation', v_existing.certificate_generation);
  end if;

  return jsonb_build_object('outcome','RECORDED','certificate_id', v_id,
    'certificate_sha256', v_sha,
    'certificate_serial', v_credential.serial_number,
    'certificate_x509_serial', v_serial_hex,
    'certificate_generation', v_credential.certificate_generation,
    'computed_leaf_public_key_fingerprint', v_leaf_fp,
    'not_before', v_credential.not_before, 'not_after', v_credential.not_after);
end;
$fn$;

alter function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text)
  owner to kitluy_credential_issuer;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

do $guard$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'kitluy_devices'
                    and indexname = 'device_certificates_credential_uq') then
    raise exception 'KLUY-MIGRATION-0208: one credential could still carry two artifacts'
      using errcode = 'P0001';
  end if;

  -- The canonical mapping round-trips: nine octets, and the credential serial is
  -- recoverable from it. A mapping that lost information would defeat the
  -- revocation projection this exists for.
  if kitluy_devices.x509_serial_for_credential_v1('DEV-0123456789ABCDEF') <> '0123456789abcdef' then
    raise exception 'KLUY-MIGRATION-0208: the canonical serial mapping is wrong'
      using errcode = 'P0001';
  end if;
  -- The fallback stays inside RFC 5280's twenty octets after minimisation.
  if length(kitluy_devices.x509_serial_for_credential_v1('something-else')) > 40 then
    raise exception 'KLUY-MIGRATION-0208: the serial fallback exceeds 20 octets'
      using errcode = 'P0001';
  end if;
  -- And a serial whose significant bytes START with zero still round-trips: the
  -- real corpus contains DEV-00... serials, and forge drops that byte.
  if kitluy_devices.x509_serial_for_credential_v1('DEV-004C34C1A664C9E5') <> '4c34c1a664c9e5' then
    raise exception 'KLUY-MIGRATION-0208: leading-zero serials do not minimise correctly'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_assignments'::regclass
       and polname = 'device_assignments_credential_issuer_read') then
    raise exception 'KLUY-MIGRATION-0208: the issuer can read no assignment; the H-1 check would refuse every device'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0208: generations are governed, one credential carries one artifact, and serials are canonical';
end
$guard$;

commit;
