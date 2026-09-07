-- kitluy:group:0212
-- =============================================================================
-- Group 0212 — N-1: the serial inverse must fail closed
-- =============================================================================
--
-- Authority: FINAL independent Store Hub credential-path confirmation,
-- 2026-08-28, verdict APPROVED WITH REQUIRED FIXES, finding N-1; owner
-- instruction 2026-08-28 Step 1; group 0210 (M-1/R2-1), which this corrects.
--
-- =============================================================================
-- WHAT WAS WRONG
-- =============================================================================
-- `x509_serial_for_credential_v1` has TWO branches:
--
--   `DEV-<16 hex>`  -> the 8 significant bytes, minimally encoded. INVERTIBLE.
--   anything else   -> SHA-256 truncated to 19 bytes. NOT invertible, by
--                      construction — a hash has no inverse.
--
-- The inverse ignored that distinction. Handed a hashed 19-byte serial it
-- stripped leading zeros, took whatever was left, and padded it into a
-- `DEV-`-shaped string. Measured before this change:
--
--   'not-a-dev-serial'    -> 3cb969e3dd8d3187876956f5491a4a571c8ab6
--                         -> inverse returned  DEV-3CB969E3DD8D3187
--
-- That is not a wrong answer, it is a FABRICATED one: a well-formed credential
-- serial that no credential has. A revocation projection looking a presented
-- certificate up by that value finds nothing and concludes the certificate is
-- not revoked. The SQL and TypeScript halves fabricated DIFFERENT values, which
-- is how the reviewer found it.
--
-- Not a firstboot blocker — first issuance only ever mints `DEV-` serials — but
-- it MUST be closed before the LAN mTLS revocation projection exists, because
-- that is the first consumer that would believe the answer.
--
-- =============================================================================
-- THE RULE
-- =============================================================================
-- The inverse exists ONLY for the canonical invertible `DEV-` 8-byte shape.
-- Everything else raises. No truncation, no padding, no fabricated output.
--
-- And it is SELF-CHECKING rather than merely width-checked: the candidate is
-- run back through the forward mapping and must reproduce the input byte for
-- byte. A width check alone would accept a 7-byte value that the forward
-- mapping would never have produced.
--
-- =============================================================================
-- ONE RESIDUAL, STATED RATHER THAN HIDDEN
-- =============================================================================
-- The two branches are not disjoint in principle. A hashed serial whose first
-- ELEVEN bytes were all zero would minimally encode to <= 8 bytes and would be
-- indistinguishable from a `DEV-` serial. That is p ~= 2^-88 per serial, and it
-- cannot be removed without changing the forward mapping's shape.
--
-- It is recorded here rather than papered over. The moment a non-`DEV-` serial
-- shape is genuinely used in this system, the forward mapping needs a
-- distinguishing tag — not a wider check on the inverse.
-- =============================================================================

begin;

create or replace function kitluy_devices.credential_serial_from_x509_v1(p_hex text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $fn$
declare
  v_input     text;
  v_bytes     text;
  v_candidate text;
begin
  if p_hex is null then
    raise exception 'KLUY-SERIAL-NOT-INVERTIBLE: no serial supplied'
      using errcode = 'P0001';
  end if;
  v_input := lower(p_hex);
  if v_input !~ '^([0-9a-f]{2})+$' then
    raise exception 'KLUY-SERIAL-NOT-INVERTIBLE: "%" is not whole hex bytes', p_hex
      using errcode = 'P0001';
  end if;

  -- It must be a certificate serial as this system writes them. A non-minimal
  -- encoding never came out of the forward mapping, so there is nothing to
  -- invert.
  if v_input <> kitluy_devices.minimal_positive_der_integer_v1(v_input) then
    raise exception 'KLUY-SERIAL-NOT-INVERTIBLE: "%" is not a minimal positive DER INTEGER', p_hex
      using errcode = 'P0001';
  end if;

  v_bytes := v_input;
  while length(v_bytes) > 2 and substr(v_bytes, 1, 2) = '00' loop
    v_bytes := substr(v_bytes, 3);
  end loop;

  -- The DEV- form carries exactly 8 significant bytes. More than that is the
  -- HASHED branch, which has no inverse.
  if length(v_bytes) > 16 then
    raise exception 'KLUY-SERIAL-NOT-INVERTIBLE: % significant bytes; only the canonical 8-byte DEV- shape is invertible, and the hashed shape has no inverse by construction',
      length(v_bytes) / 2
      using errcode = 'P0001',
            hint = 'Look the certificate up by its stored certificate_x509_serial instead of reversing it.';
  end if;

  v_candidate := 'DEV-' || upper(lpad(v_bytes, 16, '0'));

  -- SELF-CHECK. The forward mapping must reproduce the input exactly, or this
  -- is not a serial this system issued and the answer would be invented.
  if kitluy_devices.x509_serial_for_credential_v1(v_candidate) <> v_input then
    raise exception 'KLUY-SERIAL-NOT-INVERTIBLE: "%" does not round-trip through the forward mapping', p_hex
      using errcode = 'P0001';
  end if;

  return v_candidate;
end;
$fn$;

comment on function kitluy_devices.credential_serial_from_x509_v1(text) is
  'Group 0212 (N-1). The inverse of x509_serial_for_credential_v1, for the canonical invertible DEV- 8-byte shape ONLY. Every other shape RAISES: the non-DEV branch of the forward mapping is a SHA-256 truncation and has no inverse, and group 0210 fabricated a DEV-shaped answer for it. Self-checking — the candidate is round-tripped through the forward mapping before it is returned.';

do $guard$
declare
  v_case text;
  v_got  text;
begin
  -- POSITIVE: every invertible shape still round-trips.
  foreach v_case in array array[
    'DEV-0123456789ABCDEF',   -- ordinary
    'DEV-004C34C1A664C9E5',   -- leading zero byte
    'DEV-0000000000000001',   -- many leading zeros
    'DEV-FF34C1A664C9E512',   -- sign byte required
    'DEV-8000000000000000',   -- sign byte, minimal remainder
    'DEV-7FFFFFFFFFFFFFFF']   -- no sign byte, maximal
  loop
    v_got := kitluy_devices.credential_serial_from_x509_v1(
               kitluy_devices.x509_serial_for_credential_v1(v_case));
    if v_got <> v_case then
      raise exception 'KLUY-MIGRATION-0212: % inverted to %, expected itself', v_case, v_got
        using errcode = 'P0001';
    end if;
  end loop;

  -- NEGATIVE: the hashed branch must REFUSE, not fabricate.
  --
  -- This is the assertion N-1 is actually about, and it is the one group 0210
  -- did not have. Before the fix this returned DEV-3CB969E3DD8D3187.
  begin
    v_got := kitluy_devices.credential_serial_from_x509_v1(
               kitluy_devices.x509_serial_for_credential_v1('not-a-dev-serial'));
    raise exception 'KLUY-MIGRATION-0212: a hashed serial inverted to % instead of refusing', v_got
      using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if position('KLUY-SERIAL-NOT-INVERTIBLE' in sqlerrm) = 0 then raise; end if;
  end;

  -- NEGATIVE: a non-minimal encoding never came out of the forward mapping.
  begin
    perform kitluy_devices.credential_serial_from_x509_v1('000123456789abcdef');
    raise exception 'KLUY-MIGRATION-0212: a non-minimal encoding was accepted'
      using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if position('KLUY-SERIAL-NOT-INVERTIBLE' in sqlerrm) = 0 then raise; end if;
  end;

  -- NEGATIVE: not hex at all.
  begin
    perform kitluy_devices.credential_serial_from_x509_v1('zz');
    raise exception 'KLUY-MIGRATION-0212: a non-hex serial was accepted'
      using errcode = 'P0001';
  exception when sqlstate 'P0001' then
    if position('KLUY-SERIAL-NOT-INVERTIBLE' in sqlerrm) = 0 then raise; end if;
  end;

  raise notice 'KLUY-MIGRATION-0212: N-1 CLOSED — the serial inverse refuses every shape it cannot actually invert';
end
$guard$;

commit;
