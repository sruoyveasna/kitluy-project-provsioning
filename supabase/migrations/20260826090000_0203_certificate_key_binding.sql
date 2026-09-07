-- =============================================================================
-- Group 0203 — C-1: the certificate must PROVE it carries the governed key
-- =============================================================================
--
-- Authority: independent Store Hub credential-path review, 2026-08-26, verdict
-- REJECTED, critical finding C-1; owner remediation instruction 2026-08-26
-- Phase 1; KLD-2026-07-21-003 (activation is certificate-backed);
-- KLD-2026-07-28-002 / BLK-005 (development certificates AUTHORIZED, pilot and
-- production BLOCKED).
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- Group 0202's artifact door COPIED the fingerprint:
--
--     device_credentials.public_key_fingerprint
--             |  copied verbatim on insert
--             v
--     device_certificates.public_key_fingerprint
--
-- and group 0201's activation predicate then compared the two. The comparison
-- could not fail. It was a column comparing itself to its own source, dressed as
-- a security check.
--
-- The reviewer demonstrated the consequence: a self-signed `CN=ATTACKER`
-- certificate over an entirely unrelated key was recorded against a legitimate
-- credential, and the device activated on it. Nothing in the database had ever
-- looked at the certificate's contents.
--
-- =============================================================================
-- WHAT THIS GROUP DOES INSTEAD
-- =============================================================================
--     supplied leaf PEM
--         -> decode armour to DER
--         -> walk the X.509 structure to subjectPublicKeyInfo
--         -> SHA-256 the SPKI
--         -> COMPARE against the governed credential's fingerprint
--         -> verify the leaf's RSA signature under the PINNED issuing CA
--         -> verify that CA's signature under the PINNED development root
--         -> require the supplied chain to be the pinned anchors, byte for byte
--         -> only then persist, storing the COMPUTED fingerprint
--
-- Every one of those steps happens INSIDE the database, on the actual bytes.
-- Nothing is taken from the caller but the bytes themselves.
--
-- =============================================================================
-- WHY THERE IS AN ASN.1 PARSER AND AN RSA VERIFIER IN PL/pgSQL
-- =============================================================================
-- This is the part that deserves a hostile reading, so here is the reasoning in
-- full.
--
-- PostgreSQL cannot parse X.509 and pgcrypto cannot verify RSA. The repository
-- already has a precedent for that gap — KLRISK-DEVICE-003, "OPTION B": because
-- there is no Ed25519 primitive in the database, canonical-credential signature
-- verification happens in TypeScript inside the trusted computing base.
--
-- Applying OPTION B here would have left C-1 only half closed. The door's
-- caller is `kitluy_issuance_service`, and the finding is precisely that the
-- door trusts what that caller hands it. Moving the check into the caller
-- verifies the certificate in the same place that is already assumed honest —
-- it would satisfy the letter of the finding and none of its substance. A
-- second identity holding that role, or any future call site, would walk
-- straight back through the same hole.
--
-- So the primitives are built here rather than borrowed:
--
--   * DER is a length-prefixed tag/length/value encoding. Walking it needs a
--     reader and a child iterator, not a library. `asn1_read_tlv_v1` and
--     `asn1_children_v1` are that, in about sixty lines, and they REFUSE
--     anything that is not canonical DER (indefinite lengths, non-minimal
--     multi-byte lengths, TLVs that overrun their parent) rather than guessing.
--
--   * RSASSA-PKCS1-v1_5 verification is one modular exponentiation followed by a
--     byte comparison. `numeric` is arbitrary precision, so square-and-multiply
--     over a 2048-bit modulus is seventeen multiplications of ~617-digit
--     numbers — microseconds, and exact, because `numeric` is exact.
--
--     The padding is compared for EQUALITY against a rebuilt expected block:
--     0x00 0x01, then 0xFF filler, then 0x00, then the SHA-256 DigestInfo, then
--     the digest. It is NOT scanned for a hash somewhere inside it. That
--     distinction is the entire history of Bleichenbacher'06 signature forgery,
--     and it is why this verifier reconstructs the block rather than parsing it.
--
-- The TypeScript side verifies the same chain again with `node:crypto` before
-- calling. That is defence in depth and a faster, clearer failure — it is NOT
-- the authority. The authority is here, and it does not trust its caller.
--
-- =============================================================================
-- WHY THE ANCHORS ARE INSTALLED AND NOT COMMITTED
-- =============================================================================
-- `scripts/verification/assert-no-dev-pki.mjs` refuses to let development CA
-- material — subjects or fingerprints — appear anywhere in the repository or in
-- a device image. A pin hardcoded in this file would break that guard for a
-- good reason.
--
-- So the anchors are REGISTERED at deployment time from `$KITLUY_DEV_PKI_DIR`
-- through `register_development_trust_anchor_v1`, which is granted to NO service
-- identity: it is reachable only by a superuser running the bootstrap script
-- out of band. An anchor is also append-only — re-pinning a different
-- certificate for a role is refused outright, because silently re-pointing a
-- trust root is the single most valuable write in this schema.
-- =============================================================================

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. DER reading
-- -----------------------------------------------------------------------------

-- Returns {tag, header_length, content_length} for the TLV starting at
-- `p_offset` (0-based). Raises rather than returning a sentinel: a malformed
-- certificate is never a value to carry forward.
create or replace function kitluy_devices.asn1_read_tlv_v1(p_der bytea, p_offset int)
returns int[]
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_len_byte int;
  v_count    int;
  v_len      int := 0;
  v_header   int;
  v_i        int;
begin
  if p_offset < 0 or p_offset + 2 > length(p_der) then
    raise exception 'KLUY-ASN1-TRUNCATED: no TLV at offset %', p_offset using errcode = 'P0001';
  end if;

  v_len_byte := get_byte(p_der, p_offset + 1);

  if v_len_byte < 128 then
    -- Short form: the byte IS the length.
    v_len := v_len_byte;
    v_header := 2;
  else
    v_count := v_len_byte - 128;
    -- 0x80 is the indefinite form, which BER allows and DER forbids. A
    -- certificate is DER, so this is a malformed input, not a long certificate.
    if v_count = 0 then
      raise exception 'KLUY-ASN1-INDEFINITE-LENGTH: DER forbids the indefinite form'
        using errcode = 'P0001';
    end if;
    -- Four length bytes is 4GB. Anything claiming more is hostile or broken.
    if v_count > 4 then
      raise exception 'KLUY-ASN1-UNSUPPORTED-LENGTH: % length bytes', v_count
        using errcode = 'P0001';
    end if;
    if p_offset + 2 + v_count > length(p_der) then
      raise exception 'KLUY-ASN1-TRUNCATED: length field runs past the buffer'
        using errcode = 'P0001';
    end if;
    for v_i in 0 .. v_count - 1 loop
      v_len := v_len * 256 + get_byte(p_der, p_offset + 2 + v_i);
    end loop;
    -- DER requires the SHORTEST encoding. A length of 5 written in the long form
    -- is a different byte string for the same value, and accepting both is how
    -- signatures get to disagree with parsers about what was signed.
    if v_len < 128 then
      raise exception 'KLUY-ASN1-NON-MINIMAL-LENGTH: % encoded in long form', v_len
        using errcode = 'P0001';
    end if;
    if v_count > 1 and get_byte(p_der, p_offset + 2) = 0 then
      raise exception 'KLUY-ASN1-NON-MINIMAL-LENGTH: leading zero length byte'
        using errcode = 'P0001';
    end if;
    v_header := 2 + v_count;
  end if;

  if p_offset + v_header + v_len > length(p_der) then
    raise exception 'KLUY-ASN1-TRUNCATED: TLV at % overruns its buffer', p_offset
      using errcode = 'P0001';
  end if;

  return array[get_byte(p_der, p_offset), v_header, v_len];
end;
$fn$;

-- The children of a constructed TLV, each returned as a COMPLETE TLV (header
-- included) so it can be hashed or re-parsed on its own.
create or replace function kitluy_devices.asn1_children_v1(p_tlv bytea)
returns bytea[]
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_head  int[];
  v_child int[];
  v_pos   int;
  v_end   int;
  v_out   bytea[] := '{}';
begin
  v_head := kitluy_devices.asn1_read_tlv_v1(p_tlv, 0);
  -- Bit 0x20 is the constructed bit. A primitive TLV has no children.
  if (v_head[1] & 32) = 0 then
    raise exception 'KLUY-ASN1-NOT-CONSTRUCTED: tag 0x% holds no children',
      to_hex(v_head[1]) using errcode = 'P0001';
  end if;

  v_pos := v_head[2];
  v_end := v_head[2] + v_head[3];

  while v_pos < v_end loop
    v_child := kitluy_devices.asn1_read_tlv_v1(p_tlv, v_pos);
    -- substring() is 1-based where get_byte() is 0-based.
    v_out := v_out || substring(p_tlv from v_pos + 1 for v_child[2] + v_child[3]);
    v_pos := v_pos + v_child[2] + v_child[3];
  end loop;

  -- A child that ends past its parent means the lengths disagree with each
  -- other. Refuse; do not return the part that happened to parse.
  if v_pos <> v_end then
    raise exception 'KLUY-ASN1-MISALIGNED: children overrun their parent'
      using errcode = 'P0001';
  end if;

  return v_out;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 2. X.509 field extraction
-- -----------------------------------------------------------------------------
--
--   Certificate  ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
--   TBSCertificate ::= SEQUENCE {
--     version [0] EXPLICIT DEFAULT v1,   -- optional, tag 0xA0
--     serialNumber, signature, issuer, validity, subject,
--     subjectPublicKeyInfo, ... }
--
create or replace function kitluy_devices.x509_field_v1(p_cert_der bytea, p_field text)
returns bytea
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_top bytea[];
  v_tbs bytea[];
  v_i   int := 1;
begin
  v_top := kitluy_devices.asn1_children_v1(p_cert_der);
  if array_length(v_top, 1) <> 3 then
    raise exception 'KLUY-X509-MALFORMED: a Certificate has three fields, found %',
      coalesce(array_length(v_top, 1), 0) using errcode = 'P0001';
  end if;

  if p_field = 'tbs' then return v_top[1]; end if;
  if p_field = 'signature_algorithm' then return v_top[2]; end if;
  if p_field = 'signature_value' then return v_top[3]; end if;

  v_tbs := kitluy_devices.asn1_children_v1(v_top[1]);
  -- 0xA0 = context-specific, constructed, number 0 — the EXPLICIT version.
  -- Absent in a v1 certificate, so the offset is computed, never assumed.
  if get_byte(v_tbs[1], 0) = 160 then v_i := 2; end if;

  if array_length(v_tbs, 1) < v_i + 5 then
    raise exception 'KLUY-X509-MALFORMED: TBSCertificate is too short' using errcode = 'P0001';
  end if;

  case p_field
    when 'serial'   then return v_tbs[v_i];
    when 'issuer'   then return v_tbs[v_i + 2];
    when 'validity' then return v_tbs[v_i + 3];
    when 'subject'  then return v_tbs[v_i + 4];
    when 'spki'     then return v_tbs[v_i + 5];
    else raise exception 'KLUY-X509-UNKNOWN-FIELD: %', p_field using errcode = 'P0001';
  end case;
end;
$fn$;

-- THE fingerprint spelling for this repository: SHA-256 over the DER SPKI,
-- lowercase hex. Identical by construction to `operationalKeyFingerprint()` in
-- `first-operational-issuance.ts`, which hashes the same DER export.
create or replace function kitluy_devices.x509_public_key_fingerprint_v1(p_cert_der bytea)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $fn$
  select encode(extensions.digest(kitluy_devices.x509_field_v1(p_cert_der, 'spki'), 'sha256'), 'hex')
$fn$;

-- -----------------------------------------------------------------------------
-- 3. PEM
-- -----------------------------------------------------------------------------

-- Every certificate in a PEM bundle, in order, as DER.
create or replace function kitluy_devices.pem_certificates_to_der_v1(p_pem text)
returns bytea[]
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_block text;
  v_out   bytea[] := '{}';
begin
  if p_pem is null then return v_out; end if;
  for v_block in
    select (regexp_matches(
              p_pem,
              '-----BEGIN CERTIFICATE-----(.*?)-----END CERTIFICATE-----',
              'gs'))[1]
  loop
    begin
      v_out := v_out || decode(regexp_replace(v_block, '[[:space:]]', '', 'g'), 'base64');
    exception when others then
      raise exception 'KLUY-PEM-UNDECODABLE: a certificate block is not valid base64'
        using errcode = 'P0001';
    end;
  end loop;
  return v_out;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 4. RSASSA-PKCS1-v1_5 verification
-- -----------------------------------------------------------------------------

create or replace function kitluy_devices.bytea_to_numeric_v1(p_bytes bytea)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_acc numeric := 0;
  v_i   int;
begin
  for v_i in 0 .. length(p_bytes) - 1 loop
    v_acc := v_acc * 256 + get_byte(p_bytes, v_i);
  end loop;
  return v_acc;
end;
$fn$;

-- Fixed-width, big-endian, left-zero-padded. The width matters: PKCS#1 compares
-- a block of exactly the modulus length, and a short encoding would shift every
-- byte of the comparison.
create or replace function kitluy_devices.numeric_to_bytea_v1(p_value numeric, p_length int)
returns bytea
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_out bytea;
  v_v   numeric := p_value;
  v_i   int;
begin
  v_out := decode(repeat('00', p_length), 'hex');
  for v_i in reverse p_length - 1 .. 0 loop
    v_out := set_byte(v_out, v_i, (mod(v_v, 256))::int);
    v_v := div(v_v, 256);
  end loop;
  if v_v <> 0 then
    raise exception 'KLUY-RSA-OVERFLOW: value does not fit in % bytes', p_length
      using errcode = 'P0001';
  end if;
  return v_out;
end;
$fn$;

-- Square-and-multiply. `numeric` is exact arbitrary precision, so this is exact.
create or replace function kitluy_devices.modexp_v1(p_base numeric, p_exp numeric, p_mod numeric)
returns numeric
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_result numeric := 1;
  v_base   numeric;
  v_exp    numeric := p_exp;
begin
  if p_mod <= 1 then
    raise exception 'KLUY-RSA-BAD-MODULUS' using errcode = 'P0001';
  end if;
  v_base := mod(p_base, p_mod);
  while v_exp > 0 loop
    if mod(v_exp, 2) = 1 then
      v_result := mod(v_result * v_base, p_mod);
    end if;
    v_exp := div(v_exp, 2);
    if v_exp > 0 then
      v_base := mod(v_base * v_base, p_mod);
    end if;
  end loop;
  return v_result;
end;
$fn$;

-- An ASN.1 INTEGER's content, with the leading zero DER adds to keep a
-- high-bit-set value positive removed.
create or replace function kitluy_devices.asn1_integer_bytes_v1(p_tlv bytea)
returns bytea
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_head int[];
  v_body bytea;
begin
  v_head := kitluy_devices.asn1_read_tlv_v1(p_tlv, 0);
  if v_head[1] <> 2 then
    raise exception 'KLUY-ASN1-NOT-INTEGER: tag 0x%', to_hex(v_head[1]) using errcode = 'P0001';
  end if;
  v_body := substring(p_tlv from v_head[2] + 1 for v_head[3]);
  while length(v_body) > 1 and get_byte(v_body, 0) = 0 loop
    v_body := substring(v_body from 2);
  end loop;
  return v_body;
end;
$fn$;

/*
 * Verify that `p_cert_der` was signed by the key inside `p_issuer_der`.
 *
 * Returns FALSE for every way a signature can fail to verify, and raises only
 * when the input is not a certificate at all. A caller must therefore treat
 * false as "refused", never as "could not tell".
 *
 * ONLY sha256WithRSAEncryption is accepted. A verifier that honours whatever
 * algorithm the certificate names lets the certificate choose its own security
 * level, and "none" is an algorithm.
 */
create or replace function kitluy_devices.x509_signature_is_valid_v1(
  p_cert_der bytea,
  p_issuer_der bytea
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, extensions
as $fn$
declare
  -- OID 1.2.840.113549.1.1.11, as it appears inside AlgorithmIdentifier.
  c_sha256_rsa    constant bytea := '\x06092a864886f70d01010b'::bytea;
  -- DigestInfo for SHA-256: SEQUENCE { SEQUENCE { OID, NULL }, OCTET STRING }.
  c_digest_prefix constant bytea := '\x3031300d060960864801650304020105000420'::bytea;
  v_alg      bytea;
  v_spki     bytea[];
  v_bitstr   int[];
  v_rsa_key  bytea;
  v_key_parts bytea[];
  v_n        numeric;
  v_e        numeric;
  v_k        int;
  v_sig_tlv  bytea;
  v_sig_head int[];
  v_sig      bytea;
  v_em       bytea;
  v_expected bytea;
  v_pad_len  int;
begin
  -- 1. The signature algorithm, from the certificate itself.
  v_alg := kitluy_devices.x509_field_v1(p_cert_der, 'signature_algorithm');
  if position(c_sha256_rsa in v_alg) = 0 then
    return false;
  end if;

  -- 2. The issuer's RSA public key.
  --    SubjectPublicKeyInfo ::= SEQUENCE { algorithm, subjectPublicKey BIT STRING }
  --    and the BIT STRING wraps RSAPublicKey ::= SEQUENCE { modulus, exponent }.
  v_spki := kitluy_devices.asn1_children_v1(
              kitluy_devices.x509_field_v1(p_issuer_der, 'spki'));
  if array_length(v_spki, 1) <> 2 then return false; end if;
  if position(c_sha256_rsa in v_spki[1]) = 0
     and position('\x06092a864886f70d010101'::bytea in v_spki[1]) = 0 then
    -- Neither rsaEncryption nor sha256WithRSA: not an RSA key we will use.
    return false;
  end if;

  v_bitstr := kitluy_devices.asn1_read_tlv_v1(v_spki[2], 0);
  if v_bitstr[1] <> 3 then return false; end if;
  -- First content byte of a BIT STRING counts unused trailing bits; a key is
  -- whole bytes, so it must be zero.
  if get_byte(v_spki[2], v_bitstr[2]) <> 0 then return false; end if;
  v_rsa_key := substring(v_spki[2] from v_bitstr[2] + 2 for v_bitstr[3] - 1);

  v_key_parts := kitluy_devices.asn1_children_v1(v_rsa_key);
  if array_length(v_key_parts, 1) < 2 then return false; end if;
  v_n := kitluy_devices.bytea_to_numeric_v1(kitluy_devices.asn1_integer_bytes_v1(v_key_parts[1]));
  v_e := kitluy_devices.bytea_to_numeric_v1(kitluy_devices.asn1_integer_bytes_v1(v_key_parts[2]));
  v_k := length(kitluy_devices.asn1_integer_bytes_v1(v_key_parts[1]));

  -- 3. The signature value, out of its BIT STRING.
  v_sig_tlv := kitluy_devices.x509_field_v1(p_cert_der, 'signature_value');
  v_sig_head := kitluy_devices.asn1_read_tlv_v1(v_sig_tlv, 0);
  if v_sig_head[1] <> 3 then return false; end if;
  if get_byte(v_sig_tlv, v_sig_head[2]) <> 0 then return false; end if;
  v_sig := substring(v_sig_tlv from v_sig_head[2] + 2 for v_sig_head[3] - 1);

  -- A signature must be exactly the modulus length. Shorter or longer is not a
  -- signature for this key.
  if length(v_sig) <> v_k then return false; end if;

  -- 4. s^e mod n.
  v_em := kitluy_devices.numeric_to_bytea_v1(
            kitluy_devices.modexp_v1(kitluy_devices.bytea_to_numeric_v1(v_sig), v_e, v_n),
            v_k);

  -- 5. REBUILD the expected block and compare for equality.
  --
  --    Not "find the DigestInfo somewhere inside the padding" — that is the
  --    Bleichenbacher'06 forgery, which works precisely because a lenient parser
  --    ignores trailing bytes. Reconstructed and compared whole:
  --      0x00 0x01 || 0xFF... || 0x00 || DigestInfo || SHA-256(tbsCertificate)
  v_pad_len := v_k - 3 - length(c_digest_prefix) - 32;
  if v_pad_len < 8 then return false; end if;

  v_expected := '\x0001'::bytea
                || decode(repeat('ff', v_pad_len), 'hex')
                || '\x00'::bytea
                || c_digest_prefix
                || extensions.digest(kitluy_devices.x509_field_v1(p_cert_der, 'tbs'), 'sha256');

  return v_em = v_expected;
exception
  -- A malformed certificate is a failed verification, not an error to escape
  -- into the caller's transaction.
  when others then
    return false;
end;
$fn$;

-- -----------------------------------------------------------------------------
-- 5. Pinned development trust anchors
-- -----------------------------------------------------------------------------

create table if not exists kitluy_devices.pki_pinned_trust_anchors (
  id                 uuid primary key default gen_random_uuid(),
  environment        text not null,
  anchor_role        text not null,
  certificate_sha256 text not null,
  certificate_pem    text not null,
  subject_hint       text,
  registered_at      timestamptz not null default now(),
  registered_by      text not null,
  decision_ref       text not null,
  constraint pki_pinned_trust_anchors_role_ck
    check (anchor_role in ('development_root', 'development_device_issuing')),
  constraint pki_pinned_trust_anchors_env_ck
    check (environment = 'development'),
  constraint pki_pinned_trust_anchors_sha_ck
    check (certificate_sha256 ~ '^[0-9a-f]{64}$'),
  constraint pki_pinned_trust_anchors_unique unique (environment, anchor_role)
);

comment on table kitluy_devices.pki_pinned_trust_anchors is
  'Group 0203. The development trust anchors the artifact door verifies against, held as bytes so the database does not depend on its caller for chain identity. Development only (BLK-005). Installed out of band from $KITLUY_DEV_PKI_DIR, never committed: scripts/verification/assert-no-dev-pki.mjs refuses dev CA material in the repository. Append-only per role — re-pinning is refused.';

alter table kitluy_devices.pki_pinned_trust_anchors enable row level security;
alter table kitluy_devices.pki_pinned_trust_anchors force row level security;

revoke all on kitluy_devices.pki_pinned_trust_anchors from public;
revoke all on kitluy_devices.pki_pinned_trust_anchors from anon;
revoke all on kitluy_devices.pki_pinned_trust_anchors from authenticated;
revoke all on kitluy_devices.pki_pinned_trust_anchors from service_role;

/*
 * Pin one development trust anchor.
 *
 * Granted to NO service identity. Reachable only by a superuser running the
 * bootstrap out of band, because installing a trust root is an administrative
 * act, not a runtime one.
 *
 * The digest is COMPUTED here from the supplied bytes; there is no parameter
 * for it. Re-pinning a DIFFERENT certificate for a role is refused rather than
 * updated — silently re-pointing a trust anchor is the most valuable write in
 * this schema, and it must not be reachable by accident.
 */
create or replace function kitluy_devices.register_development_trust_anchor_v1(
  p_environment text,
  p_anchor_role text,
  p_certificate_pem text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $fn$
declare
  v_ders bytea[];
  v_sha  text;
  v_row  kitluy_devices.pki_pinned_trust_anchors;
begin
  if p_environment <> 'development' then
    raise exception 'KLUY-TRUST-ANCHOR-ENVIRONMENT: pilot and production remain blocked under BLK-005'
      using errcode = 'P0001';
  end if;

  v_ders := kitluy_devices.pem_certificates_to_der_v1(p_certificate_pem);
  if array_length(v_ders, 1) is distinct from 1 then
    raise exception 'KLUY-TRUST-ANCHOR-MALFORMED: supply exactly one PEM certificate'
      using errcode = 'P0001';
  end if;

  -- Parse it before pinning it. An anchor that cannot be walked is an anchor
  -- that can never verify anything.
  perform kitluy_devices.x509_field_v1(v_ders[1], 'spki');
  v_sha := encode(extensions.digest(v_ders[1], 'sha256'), 'hex');

  select * into v_row from kitluy_devices.pki_pinned_trust_anchors
   where environment = p_environment and anchor_role = p_anchor_role;

  if found then
    if v_row.certificate_sha256 = v_sha then
      return jsonb_build_object('outcome', 'ALREADY_PINNED', 'certificate_sha256', v_sha);
    end if;
    raise exception 'KLUY-TRUST-ANCHOR-CONFLICT: % is already pinned to a DIFFERENT certificate', p_anchor_role
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.pki_pinned_trust_anchors (
    environment, anchor_role, certificate_sha256, certificate_pem, registered_by, decision_ref)
  values (p_environment, p_anchor_role, v_sha, p_certificate_pem,
          coalesce(p_actor_ref, 'unknown'), 'KLD-2026-07-28-002');

  return jsonb_build_object('outcome', 'PINNED', 'certificate_sha256', v_sha);
end;
$fn$;

comment on function kitluy_devices.register_development_trust_anchor_v1(text, text, text, text) is
  'Group 0203. Pins one development trust anchor from its actual bytes; the SHA-256 is computed here and cannot be supplied. Append-only per role. Granted to no service identity — superuser/bootstrap only.';

revoke all on function kitluy_devices.register_development_trust_anchor_v1(text, text, text, text) from public;
revoke all on function kitluy_devices.register_development_trust_anchor_v1(text, text, text, text) from anon;
revoke all on function kitluy_devices.register_development_trust_anchor_v1(text, text, text, text) from authenticated;
revoke all on function kitluy_devices.register_development_trust_anchor_v1(text, text, text, text) from service_role;

-- The artifact door must read the anchors it verifies against. Read only, and
-- with a POLICY, not merely a grant: the table FORCEs row security and a
-- policy-less SELECT under FORCE RLS returns ZERO ROWS instead of raising —
-- which in this door would silently degrade to "no anchor configured" and
-- refuse every legitimate certificate. That failure has now been found three
-- times in this stream (0189, 0201, 0202); it is stated here up front.
grant select on kitluy_devices.pki_pinned_trust_anchors to kitluy_credential_issuer;

do $anchor_policy$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.pki_pinned_trust_anchors'::regclass
       and polname = 'pki_pinned_trust_anchors_issuer_read') then
    create policy pki_pinned_trust_anchors_issuer_read
      on kitluy_devices.pki_pinned_trust_anchors
      for select to kitluy_credential_issuer using (true);
  end if;
end
$anchor_policy$;

-- -----------------------------------------------------------------------------
-- 6. The artifact door, now binding the certificate to the governed key
-- -----------------------------------------------------------------------------
--
-- Replaces group 0202's body. Same signature, same grants, same idempotency
-- contract; what changes is that it now READS THE CERTIFICATE.
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
  v_credential   kitluy_devices.device_credentials;
  v_head         kitluy_devices.device_credential_heads;
  v_enrollment_id uuid;
  v_leaf_ders    bytea[];
  v_leaf         bytea;
  v_chain_ders   bytea[];
  v_root         kitluy_devices.pki_pinned_trust_anchors;
  v_issuing      kitluy_devices.pki_pinned_trust_anchors;
  v_root_der     bytea;
  v_issuing_der  bytea;
  v_leaf_fp      text;
  v_sha          text;
  v_existing     kitluy_devices.device_certificates;
  v_id           uuid;
  v_seen_root    boolean := false;
  v_seen_issuing boolean := false;
  v_der          bytea;
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
      'detail','the credential is not the device''s current generation');
  end if;

  -- ---------------------------------------------------------------------------
  -- C-1: THE CERTIFICATE IS READ, NOT DESCRIBED.
  -- ---------------------------------------------------------------------------
  v_leaf_ders := kitluy_devices.pem_certificates_to_der_v1(p_certificate_pem);
  if array_length(v_leaf_ders, 1) is distinct from 1 then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-MALFORMED',
      'detail','supply exactly one leaf certificate');
  end if;
  v_leaf := v_leaf_ders[1];

  -- 1. THE KEY BINDING. The fingerprint is computed from the certificate's own
  --    subjectPublicKeyInfo and compared against the governed credential. This
  --    is the check whose absence was C-1: the value used to be COPIED from the
  --    credential, so activation compared the credential to itself.
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

  -- 2. THE TRUST ANCHORS, from the database's own copy.
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

  -- 3. A leaf that is its own issuer is refused before any signature maths.
  --    The reviewer's proof of C-1 was a self-signed CN=ATTACKER certificate,
  --    and it is worth refusing by name rather than only as a side effect.
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

  -- 4. THE SIGNATURES. Leaf under the pinned issuing CA, issuing CA under the
  --    pinned root. Verified against the anchors' OWN bytes, so a substituted
  --    chain cannot supply the key that checks it.
  if not kitluy_devices.x509_signature_is_valid_v1(v_leaf, v_issuing_der) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CHAIN-UNVERIFIED',
      'detail','the leaf is not signed by the pinned development issuing CA');
  end if;
  if not kitluy_devices.x509_signature_is_valid_v1(v_issuing_der, v_root_der) then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CHAIN-UNVERIFIED',
      'detail','the pinned issuing CA does not chain to the pinned development root');
  end if;

  -- 5. And the chain the DEVICE will be handed must be those same anchors, byte
  --    for byte. The device verifies against what it is given, so a chain that
  --    diverges from what was verified here is a chain nobody checked.
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

  v_sha := encode(extensions.digest(v_leaf, 'sha256'), 'hex');

  -- IDEMPOTENCY. A retry after a lost response returns the SAME artifact.
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
      'certificate_generation', v_existing.certificate_generation);
  end if;

  select current_enrollment_id into v_enrollment_id
    from kitluy_devices.devices where id = v_credential.device_record_id;

  insert into kitluy_devices.device_certificates (
    device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
    issuer_reference, status, issued_at, expires_at,
    credential_id, certificate_generation, public_key_algorithm,
    certificate_pem, certificate_sha256, chain_pem)
  values (
    v_credential.device_record_id, v_enrollment_id, v_credential.environment,
    v_credential.serial_number,
    -- THE COMPUTED VALUE. Not `v_credential.public_key_fingerprint`, which is
    -- what made the activation predicate tautological. It is provably equal to
    -- it at this point — that equality was checked above and is the whole point
    -- — but it is written from the CERTIFICATE, so the two columns are now two
    -- independent observations rather than one value copied twice.
    v_leaf_fp,
    v_issuing.certificate_sha256, 'active', v_credential.not_before, v_credential.not_after,
    p_credential_id, v_credential.certificate_generation, p_public_key_algorithm,
    p_certificate_pem, v_sha, p_chain_pem)
  returning id into v_id;

  return jsonb_build_object('outcome','RECORDED','certificate_id', v_id,
    'certificate_sha256', v_sha,
    'certificate_serial', v_credential.serial_number,
    'certificate_generation', v_credential.certificate_generation,
    'computed_leaf_public_key_fingerprint', v_leaf_fp,
    'not_before', v_credential.not_before, 'not_after', v_credential.not_after);
end;
$fn$;

comment on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) is
  'Group 0203 (replacing 0202). The ONE door that may write an operational X.509 artifact. It parses the leaf, computes the SPKI fingerprint from the actual bytes and requires it to equal the governed credential''s, verifies the leaf''s RSA signature under the PINNED development issuing CA and that CA under the PINNED root, and requires the supplied chain to be those anchors byte for byte. device, environment, generation, serial and validity all come from the credential. Idempotent per credential. Granted to kitluy_issuance_service ONLY.';

alter function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text)
  owner to kitluy_credential_issuer;
revoke all on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) from public;
revoke all on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) from anon;
revoke all on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) from authenticated;
revoke all on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) from service_role;
grant execute on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text)
  to kitluy_issuance_service;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 7. Apply-time proof
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_ok boolean;
begin
  -- The parser works on a certificate this migration builds nothing to fake:
  -- a round trip through the length reader must reject the indefinite form.
  begin
    perform kitluy_devices.asn1_read_tlv_v1('\x3080'::bytea, 0);
    raise exception 'KLUY-MIGRATION-0203: the DER reader accepted an indefinite length'
      using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if position('KLUY-ASN1-INDEFINITE-LENGTH' in sqlerrm) = 0 then raise; end if;
  end;

  -- The modular exponentiation is exact: 4^13 mod 497 = 445 is the worked
  -- example from every textbook, and a numeric implementation that is off by
  -- one anywhere fails it.
  select kitluy_devices.modexp_v1(4, 13, 497) = 445 into v_ok;
  if not v_ok then
    raise exception 'KLUY-MIGRATION-0203: modular exponentiation is wrong'
      using errcode = 'P0001';
  end if;

  -- Fixed-width big-endian encoding, including the left zero padding PKCS#1
  -- depends on.
  if kitluy_devices.numeric_to_bytea_v1(258, 4) <> '\x00000102'::bytea then
    raise exception 'KLUY-MIGRATION-0203: big-endian encoding is wrong'
      using errcode = 'P0001';
  end if;

  -- The door carries no DIRECT grant to the application connection identity.
  -- That is what THIS group controls, and it is asserted as a hard failure.
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
      and p.proname = 'record_operational_certificate_v1'
      and aclcontains(p.proacl, makeaclitem('service_role'::regrole, current_user::regrole, 'EXECUTE', false))
  ) then
    raise exception 'KLUY-MIGRATION-0203: service_role holds a direct EXECUTE grant on the artifact door'
      using errcode = 'P0001';
  end if;

  -- ...AND IT IS STILL REACHABLE, WHICH THIS GROUP DOES NOT FIX.
  --
  -- `has_function_privilege` answers the question that matters — EFFECTIVE
  -- authority — and it says yes, because `service_role` is a member of
  -- `kitluy_issuance_service` and inherits it. Every migration before this one
  -- asserted separation of duty through `information_schema.role_table_grants`,
  -- which lists DIRECT grants only and was therefore blind to this the entire
  -- time.
  --
  -- This is finding C-4/D-07 and it belongs to Phase 4. It is NOT silently
  -- tolerated here: the notice fires on every apply until the hinge lands, and
  -- group 0207 turns it into a hard assertion.
  if has_function_privilege('service_role',
       'kitluy_devices.record_operational_certificate_v1(uuid,text,text,text,text)', 'execute') then
    raise notice 'KLUY-MIGRATION-0203: C-4 OPEN — service_role reaches the artifact door by INHERITANCE, not by grant. Separation of duty is not yet real. Phase 4 (group 0207) closes this.';
  end if;

  -- A grant without a policy on a FORCE-RLS table reads as zero rows. Asserted
  -- wherever this migration grants.
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.pki_pinned_trust_anchors'::regclass
       and polname = 'pki_pinned_trust_anchors_issuer_read') then
    raise exception 'KLUY-MIGRATION-0203: the issuer can read no trust anchor'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0203: certificates are now bound to the governed key and to a pinned chain';
end
$guard$;

commit;
