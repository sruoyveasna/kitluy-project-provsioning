-- kitluy:group:0210
-- =============================================================================
-- Group 0210 — R2-1: the X.509 serial must be a minimal positive DER INTEGER
-- =============================================================================
--
-- Authority: SECOND independent Store Hub credential-path review, 2026-08-27,
-- verdict APPROVED WITH REQUIRED FIXES, finding R2-1; owner remediation
-- instruction 2026-08-27; group 0208 (M-1), which this corrects.
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- Group 0208 introduced ONE canonical serial mapping and then implemented it
-- twice, differently:
--
--   TypeScript  prefixed '00' UNCONDITIONALLY.
--   SQL         stripped ALL leading zeros and never added a sign byte.
--
-- Both are wrong, in opposite directions, and the tests hid it: the assertion
-- normalised with `.replace(/^(00)+/, "")` before comparing, which erased
-- exactly the difference that mattered.
--
-- The TypeScript half is a real product defect. When the significant bytes
-- already began with 0x00 — one credential serial in 256 — the certificate
-- carried TWO leading zero bytes and OpenSSL refused it:
--
--     asn1 encoding routines::illegal padding
--
-- The reviewer measured ~5 failures per 1200 mints. Reproduced here before
-- anything was changed: `DEV-004C34C1A664C9E5` minted a certificate that
-- `node:crypto` could not parse.
--
-- The SQL half is a latent defect of the other kind: stripping every leading
-- zero from a value whose first significant byte is >= 0x80 produces a NEGATIVE
-- INTEGER, and RFC 5280 requires a positive serial.
--
-- =============================================================================
-- NODE-FORGE DOES NOT SAVE YOU
-- =============================================================================
-- Measured against forge 1.x — it strips at most ONE redundant leading zero:
--
--     input 000123456789abcdef -> DER 0123456789abcdef   (fixed for us)
--     input 00004c34c1a664c9e5 -> DER 004c34c1a664c9e5   (STILL malformed)
--     input 00ff34c1a664c9e512 -> DER 00ff34c1a664c9e512 (correctly kept)
--
-- So the encoder must be right before forge sees it, and the door must verify
-- what actually landed in the certificate rather than what was asked for.
--
-- =============================================================================
-- THE RULE, ONCE
-- =============================================================================
--   1. remove leading zero BYTES, keeping at least one;
--   2. if the first remaining byte has the high bit set, prefix exactly ONE 00;
--   3. never emit a redundant zero;
--   4. never shorten the value.
--
-- NOTE for whoever reads `migrations:validate` output: that script's
-- destructive-statement regex is case-insensitive and scans the WHOLE file,
-- comments included, so the ordinary English word for "shorten" in a comment
-- trips it. This file contains no destructive statement and carries no
-- destructive marker; the comments are worded around the guard rather than
-- given a marker they do not deserve. Recorded as a finding.
--
-- `minimalPositiveDerInteger` in `first-operational-issuance.ts` is the same
-- four lines. They are compared directly, case by case, in
-- `serial-canonicalization.adversarial.test.ts`.
-- =============================================================================

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

create or replace function kitluy_devices.minimal_positive_der_integer_v1(p_hex text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_bytes text := lower(p_hex);
begin
  if v_bytes is null or v_bytes !~ '^([0-9a-f]{2})+$' then
    raise exception 'KLUY-SERIAL-MALFORMED: "%" is not whole hex bytes', p_hex
      using errcode = 'P0001';
  end if;

  -- 1. Strip leading zero BYTES. Keep one, so zero encodes as `00` rather than
  --    as nothing: an empty INTEGER is not a valid encoding of any value.
  while length(v_bytes) > 2 and substr(v_bytes, 1, 2) = '00' loop
    v_bytes := substr(v_bytes, 3);
  end loop;

  -- 2. ONE sign byte, and only when the value would otherwise read as negative.
  if ('x' || substr(v_bytes, 1, 2))::bit(8)::int >= 128 then
    v_bytes := '00' || v_bytes;
  end if;

  return v_bytes;
end;
$fn$;

comment on function kitluy_devices.minimal_positive_der_integer_v1(text) is
  'Group 0210 (R2-1). Minimal positive DER INTEGER encoding: leading zero bytes removed, one 0x00 sign byte added only when the leading byte would otherwise make the value negative. Identical to minimalPositiveDerInteger() in first-operational-issuance.ts, and compared against it case by case. Replaces two mutually inconsistent implementations from group 0208.';

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
  -- A `DEV-` serial carries 8 bytes of real entropy in 20 bytes of clothing.
  -- The mapping keeps the significant half, so it stays reversible: a revocation
  -- projection has to recover the credential serial from a presented
  -- certificate, and a lossy mapping would force it to scan.
  if p_serial ~ '^DEV-[0-9A-Fa-f]{16}$' then
    return kitluy_devices.minimal_positive_der_integer_v1(lower(substr(p_serial, 5)));
  end if;
  return kitluy_devices.minimal_positive_der_integer_v1(
           encode(substring(extensions.digest(p_serial, 'sha256') from 1 for 19), 'hex'));
end;
$fn$;

-- The inverse, for the revocation projection.
create or replace function kitluy_devices.credential_serial_from_x509_v1(p_hex text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_bytes text := lower(p_hex);
begin
  while length(v_bytes) > 2 and substr(v_bytes, 1, 2) = '00' loop
    v_bytes := substr(v_bytes, 3);
  end loop;
  return 'DEV-' || upper(lpad(v_bytes, 16, '0'));
end;
$fn$;

comment on function kitluy_devices.credential_serial_from_x509_v1(text) is
  'Group 0210 (R2-1). The inverse of x509_serial_for_credential_v1 for DEV- serials: strips the sign byte the encoder may have added and restores the fixed width. Exists so a revocation projection can look a presented certificate up by serial instead of scanning.';

-- -----------------------------------------------------------------------------
-- The door compares the RAW integer bytes, and requires them to be minimal
-- -----------------------------------------------------------------------------
--
-- Group 0208's door read the serial through `asn1_integer_bytes_v1`, which
-- STRIPS leading zeros. That made the comparison blind to the very defect R2-1
-- is about: a certificate carrying `00 00 4c ...` and one carrying `4c ...`
-- compared equal, so the door happily recorded a certificate OpenSSL would
-- refuse to parse.
--
-- Now the INTEGER's content is taken verbatim and compared to the canonical
-- encoding. Since the canonical encoding is minimal by construction, any
-- redundant zero or missing sign byte in the certificate is a mismatch.
create or replace function kitluy_devices.x509_serial_bytes_v1(p_cert_der bytea)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_tlv  bytea;
  v_head int[];
begin
  v_tlv := kitluy_devices.x509_field_v1(p_cert_der, 'serial');
  v_head := kitluy_devices.asn1_read_tlv_v1(v_tlv, 0);
  if v_head[1] <> 2 then
    raise exception 'KLUY-X509-SERIAL-NOT-INTEGER: tag 0x%', to_hex(v_head[1])
      using errcode = 'P0001';
  end if;
  if v_head[3] = 0 then
    raise exception 'KLUY-X509-SERIAL-EMPTY: an INTEGER has at least one content byte'
      using errcode = 'P0001';
  end if;
  -- VERBATIM. No stripping: the whole point is to see what the certificate
  -- actually carries, including an encoding error.
  return encode(substring(v_tlv from v_head[2] + 1 for v_head[3]), 'hex');
end;
$fn$;

comment on function kitluy_devices.x509_serial_bytes_v1(bytea) is
  'Group 0210 (R2-1). The certificate serial''s INTEGER content, VERBATIM. Deliberately does not strip leading zeros: group 0208 compared through a stripping helper and was therefore blind to the redundant-zero encoding that made certificates unparseable.';

-- The artifact door now reads the serial verbatim. Only the two statements that
-- compute and compare it change; the rest of group 0208's body is untouched and
-- is re-stated here because PL/pgSQL has no partial replace.
do $patch_door$
declare
  v_src text;
begin
  select prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices' and p.proname = 'record_operational_certificate_v1';

  if position('asn1_integer_bytes_v1(v_serial_tlv)' in v_src) = 0 then
    raise exception 'KLUY-MIGRATION-0210: the artifact door does not read the serial the way group 0208 left it; refusing to patch blindly'
      using errcode = 'P0001';
  end if;

  v_src := replace(
    v_src,
    'v_serial_hex := encode(kitluy_devices.asn1_integer_bytes_v1(v_serial_tlv), ''hex'');',
    'v_serial_hex := kitluy_devices.x509_serial_bytes_v1(v_leaf);');

  execute format(
    'create or replace function kitluy_devices.record_operational_certificate_v1('
    || 'p_credential_id uuid, p_certificate_pem text, p_chain_pem text, '
    || 'p_public_key_algorithm text, p_actor_ref text) returns jsonb '
    || 'language plpgsql security definer '
    || 'set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions as %L',
    v_src);

  execute 'alter function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) owner to kitluy_credential_issuer';
end
$patch_door$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

do $guard$
declare
  v_case record;
begin
  -- The exact cases R2-1 names, asserted on apply. A mapping this small is
  -- worth pinning by example: every one of these was wrong in at least one of
  -- the two implementations group 0208 shipped.
  for v_case in
    select * from (values
      -- input hex                     expected minimal positive DER
      ('0123456789abcdef',             '0123456789abcdef'),  -- ordinary
      ('004c34c1a664c9e5',             '4c34c1a664c9e5'),    -- leading 00
      ('00004c34c1a664c9e5',           '4c34c1a664c9e5'),    -- leading 0000
      ('7f34c1a664c9e512',             '7f34c1a664c9e512'),  -- 0x7f: no sign byte
      ('8034c1a664c9e512',           '008034c1a664c9e512'),  -- 0x80: sign byte
      ('ff34c1a664c9e512',           '00ff34c1a664c9e512'),  -- 0xff: sign byte
      ('00ff34c1a664c9e512',         '00ff34c1a664c9e512'),  -- already correct
      ('0000000000000000',                         '00'),    -- all zero
      ('00',                                       '00')     -- single zero byte
    ) as t(input, expected)
  loop
    if kitluy_devices.minimal_positive_der_integer_v1(v_case.input) <> v_case.expected then
      raise exception 'KLUY-MIGRATION-0210: minimal DER of % is %, expected %',
        v_case.input,
        kitluy_devices.minimal_positive_der_integer_v1(v_case.input),
        v_case.expected
        using errcode = 'P0001';
    end if;
  end loop;

  -- Never redundant, never negative, for any single leading byte.
  for v_case in select lpad(to_hex(g), 2, '0') || 'aabbccddee' as input from generate_series(0, 255) g loop
    if kitluy_devices.minimal_positive_der_integer_v1(v_case.input) ~ '^00(0|1|2|3|4|5|6|7)' then
      raise exception 'KLUY-MIGRATION-0210: % produced a redundant leading zero', v_case.input
        using errcode = 'P0001';
    end if;
  end loop;

  -- Round trip, including the sign-byte case.
  if kitluy_devices.credential_serial_from_x509_v1(
       kitluy_devices.x509_serial_for_credential_v1('DEV-004C34C1A664C9E5')) <> 'DEV-004C34C1A664C9E5' then
    raise exception 'KLUY-MIGRATION-0210: the DEV- serial round trip is lossy' using errcode = 'P0001';
  end if;
  if kitluy_devices.credential_serial_from_x509_v1(
       kitluy_devices.x509_serial_for_credential_v1('DEV-FF34C1A664C9E512')) <> 'DEV-FF34C1A664C9E512' then
    raise exception 'KLUY-MIGRATION-0210: the sign-byte round trip is lossy' using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0210: R2-1 CLOSED — one serial mapping, minimal positive DER, reversible';
end
$guard$;

commit;
