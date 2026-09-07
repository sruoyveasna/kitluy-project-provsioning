-- kitluy:group:0211
-- =============================================================================
-- Group 0211 — R2-3: exact AlgorithmIdentifier validation
-- =============================================================================
--
-- Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
-- verdict APPROVED WITH REQUIRED FIXES, finding R2-3; owner remediation
-- instruction 2026-08-27; group 0203 (the verifier this corrects).
--
-- =============================================================================
-- WHAT IS AND IS NOT BEING CHANGED
-- =============================================================================
-- The RSA mathematics and the PKCS#1 v1.5 exact-block comparison in
-- `x509_signature_is_valid_v1` PASSED independent adversarial review. They are
-- NOT touched here, and the instruction is explicit about not rewriting them.
--
-- What is wrong is one layer up, in how the certificate's declared algorithm is
-- checked:
--
--   1. `position(c_sha256_rsa in v_alg) > 0` is a SUBSTRING SEARCH. It asks
--      whether the sha256WithRSAEncryption OID bytes appear ANYWHERE inside the
--      AlgorithmIdentifier — including inside its parameters, or after it as
--      trailing junk. An AlgorithmIdentifier that merely CONTAINS those bytes is
--      not an AlgorithmIdentifier that DECLARES that algorithm.
--
--   2. The TBS `signature` AlgorithmIdentifier was never compared to the outer
--      `signatureAlgorithm` at all. X.509 carries the algorithm twice precisely
--      so a verifier can catch a mismatch — the inner copy is covered by the
--      signature, the outer is not — and a verifier that reads only one of them
--      throws that protection away.
--
-- =============================================================================
-- THE RULE NOW
-- =============================================================================
--     outer signatureAlgorithm DER  ==  300d06092a864886f70d01010b0500
--                                   AND
--     TBS.signature DER             ==  outer signatureAlgorithm DER
--
-- Byte-for-byte equality against a canonical constant, not a search. That single
-- comparison disposes of every case the finding lists at once: a wrong OID
-- differs, absent parameters differ (the constant includes `0500`, the DER NULL),
-- trailing junk lengthens the SEQUENCE and differs, a malformed
-- AlgorithmIdentifier differs, and SHA-1-with-the-SHA-256-OID-hidden-elsewhere
-- differs because the OID is not where an OID goes.
--
-- The issuer's SubjectPublicKeyInfo algorithm is pinned the same way, to
-- rsaEncryption exactly, replacing a two-branch substring search that would have
-- accepted an SPKI declaring sha256WithRSAEncryption as a KEY algorithm.
--
-- Supported algorithms are NOT broadened. Development remains
-- sha256WithRSAEncryption and nothing else; adding one is a separate decision.
-- =============================================================================

begin;

-- The TBS `signature` field, which nothing previously read.
--
--   TBSCertificate ::= SEQUENCE {
--     version [0] EXPLICIT DEFAULT v1,
--     serialNumber,
--     signature AlgorithmIdentifier,   <-- this one, covered by the signature
--     issuer, validity, subject, subjectPublicKeyInfo, ... }
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
    when 'serial'                  then return v_tbs[v_i];
    -- R2-3: the INNER algorithm, which the signature covers and which the outer
    -- copy must match.
    when 'tbs_signature_algorithm' then return v_tbs[v_i + 1];
    when 'issuer'                  then return v_tbs[v_i + 2];
    when 'validity'                then return v_tbs[v_i + 3];
    when 'subject'                 then return v_tbs[v_i + 4];
    when 'spki'                    then return v_tbs[v_i + 5];
    else raise exception 'KLUY-X509-UNKNOWN-FIELD: %', p_field using errcode = 'P0001';
  end case;
end;
$fn$;

/*
 * Verify that `p_cert_der` was signed by the key inside `p_issuer_der`.
 *
 * The RSA mathematics and the PKCS#1 v1.5 exact-block comparison below are
 * group 0203's, UNCHANGED — they passed independent adversarial review. What
 * changes is the AlgorithmIdentifier validation above them (R2-3).
 *
 * Returns FALSE for every way a signature can fail to verify, and raises only
 * when the input is not a certificate at all. A caller must therefore treat
 * false as "refused", never as "could not tell".
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
  -- THE canonical AlgorithmIdentifier for sha256WithRSAEncryption:
  --   SEQUENCE { OID 1.2.840.113549.1.1.11, NULL }
  -- Compared whole. `0500` is the DER NULL, so "parameters absent" is a
  -- different byte string and is refused by the same comparison.
  c_sha256_rsa_algid constant bytea := '\x300d06092a864886f70d01010b0500'::bytea;
  -- ...and for rsaEncryption, the KEY algorithm an RSA SPKI must declare.
  c_rsa_key_algid    constant bytea := '\x300d06092a864886f70d0101010500'::bytea;
  -- DigestInfo for SHA-256: SEQUENCE { SEQUENCE { OID, NULL }, OCTET STRING }.
  c_digest_prefix    constant bytea := '\x3031300d060960864801650304020105000420'::bytea;
  v_outer_alg bytea;
  v_inner_alg bytea;
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
  -- 1. R2-3: THE ALGORITHM, BY EXACT DER EQUALITY.
  --
  --    Not a substring search. An AlgorithmIdentifier that merely CONTAINS the
  --    sha256WithRSAEncryption OID — in its parameters, or as trailing junk —
  --    does not declare that algorithm, and a certificate is not entitled to be
  --    verified as something it does not say it is.
  v_outer_alg := kitluy_devices.x509_field_v1(p_cert_der, 'signature_algorithm');
  if v_outer_alg <> c_sha256_rsa_algid then
    return false;
  end if;

  -- 2. ...and the INNER copy must agree with it.
  --
  --    X.509 carries the algorithm twice on purpose: the TBS copy is covered by
  --    the signature, the outer one is not. Reading only the outer copy discards
  --    that protection and lets a certificate be verified under an algorithm its
  --    own signed content never named.
  v_inner_alg := kitluy_devices.x509_field_v1(p_cert_der, 'tbs_signature_algorithm');
  if v_inner_alg <> v_outer_alg then
    return false;
  end if;

  -- 3. The issuer's RSA public key. The SPKI's own algorithm is pinned to
  --    rsaEncryption exactly — the previous two-branch substring search would
  --    have accepted an SPKI declaring a SIGNATURE algorithm as its KEY
  --    algorithm.
  --    SubjectPublicKeyInfo ::= SEQUENCE { algorithm, subjectPublicKey BIT STRING }
  --    and the BIT STRING wraps RSAPublicKey ::= SEQUENCE { modulus, exponent }.
  v_spki := kitluy_devices.asn1_children_v1(
              kitluy_devices.x509_field_v1(p_issuer_der, 'spki'));
  if array_length(v_spki, 1) <> 2 then return false; end if;
  if v_spki[1] <> c_rsa_key_algid then return false; end if;

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

  -- 4. The signature value, out of its BIT STRING.
  v_sig_tlv := kitluy_devices.x509_field_v1(p_cert_der, 'signature_value');
  v_sig_head := kitluy_devices.asn1_read_tlv_v1(v_sig_tlv, 0);
  if v_sig_head[1] <> 3 then return false; end if;
  if get_byte(v_sig_tlv, v_sig_head[2]) <> 0 then return false; end if;
  v_sig := substring(v_sig_tlv from v_sig_head[2] + 2 for v_sig_head[3] - 1);

  -- A signature must be exactly the modulus length. Shorter or longer is not a
  -- signature for this key.
  if length(v_sig) <> v_k then return false; end if;

  -- 5. s^e mod n.
  v_em := kitluy_devices.numeric_to_bytea_v1(
            kitluy_devices.modexp_v1(kitluy_devices.bytea_to_numeric_v1(v_sig), v_e, v_n),
            v_k);

  -- 6. REBUILD the expected block and compare for equality.
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

comment on function kitluy_devices.x509_signature_is_valid_v1(bytea, bytea) is
  'Group 0211 (R2-3, over 0203). RSASSA-PKCS1-v1_5 verification. The AlgorithmIdentifier is now checked by EXACT DER equality against the canonical sha256WithRSAEncryption encoding, and the TBS signature AlgorithmIdentifier must equal the outer signatureAlgorithm; the issuer SPKI must declare rsaEncryption exactly. The RSA mathematics and the PKCS#1 exact-block comparison are unchanged from 0203, which passed independent adversarial review.';

do $guard$
declare
  v_src text;
begin
  -- The substring rule must be gone. Asserted against the SOURCE, because this
  -- is a shape that reads as harmless and would come back.
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'x509_signature_is_valid_v1';

  if position('position(c_sha256_rsa in' in v_src) > 0
     or position('position(''\x06092a864886f70d010101''' in v_src) > 0 then
    raise exception 'KLUY-MIGRATION-0211: the AlgorithmIdentifier is still checked by substring search'
      using errcode = 'P0001';
  end if;
  if position('v_inner_alg <> v_outer_alg' in v_src) = 0 then
    raise exception 'KLUY-MIGRATION-0211: the TBS signature algorithm is not compared to the outer one'
      using errcode = 'P0001';
  end if;

  -- The canonical constant is the real one: SEQUENCE(13) { OID(9) 1.2.840.113549.1.1.11, NULL }.
  if '\x300d06092a864886f70d01010b0500'::bytea <>
     ('\x300d'::bytea || '\x06092a864886f70d01010b'::bytea || '\x0500'::bytea) then
    raise exception 'KLUY-MIGRATION-0211: the canonical AlgorithmIdentifier constant is malformed'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0211: R2-3 CLOSED — AlgorithmIdentifier checked by exact DER equality, inner and outer';
end
$guard$;

commit;
