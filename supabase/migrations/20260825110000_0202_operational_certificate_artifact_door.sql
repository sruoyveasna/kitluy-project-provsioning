-- kitluy:migration:0202
--
-- SOMEWHERE FOR THE ISSUED CERTIFICATE TO LAND, AND ONE AUTHORITY THAT MAY PUT IT THERE
-- =============================================================================
-- Authority: owner Step 8 (2026-08-25) — "persist the actual operational X.509
-- artifact into the fields introduced by 0201 … certificate_sha256 must be
-- derived from the real certificate artifact, not caller input"; group 0201
-- (the columns); KLD-2026-07-28-002 (BLK-005).
--
-- WHY A DOOR IS NEEDED AT ALL
-- ---------------------------
-- Group 0201 added the artifact columns and, in the same breath, revoked
-- `service_role`'s insert/update on `device_certificates` — because a validity
-- window an application role can edit is not a validity window. That was right,
-- and it left the issuing composition with nowhere to write.
--
-- So the artifact arrives through one governed door, owned by the role that
-- already owns the credential lifecycle it belongs to.
--
-- WHAT THE CALLER MAY AND MAY NOT DECIDE
-- --------------------------------------
-- The caller supplies the certificate bytes and the chain. It supplies NOTHING
-- else. Device, environment, generation, serial, public-key fingerprint and the
-- validity window are all READ FROM the governed credential — the same rule
-- group 0199 states for issuance and group 0200 for trusted time: a caller may
-- present material, and may never assert what that material is about.
--
-- The fingerprint is COMPUTED HERE from the DER, not accepted. A caller-supplied
-- digest is a claim about bytes; a computed one is a fact about them.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- The credential issuer owns `device_credentials` and therefore can read the
-- authority it is recording an artifact for. It needs write on the artifact
-- table, and nothing else changes hands.
grant select, insert, update on kitluy_devices.device_certificates to kitluy_credential_issuer;

-- READ ONLY, and only the two tables the composition must read back.
--
-- After `finalize`, the issuing composition needs the credential's authoritative
-- serial and validity window to mint the X.509 leaf over — and on a REPLAY the
-- governed door returns neither, by design. Reading them from the credential row
-- is the difference between a leaf that describes the governed credential and
-- one that describes whatever the caller last sent.
--
-- SELECT only. Minting, revoking and superseding stay with
-- `kitluy_credential_issuer`; this role consumes the lifecycle, it does not move
-- it — the same split group 0201 drew for activation.
grant select on kitluy_devices.device_credentials to kitluy_issuance_service;
grant select on kitluy_devices.device_certificates to kitluy_issuance_service;

-- AND THE READ POLICIES TO GO WITH THEM.
--
-- Both tables FORCE row security, and a SELECT under RLS without a matching
-- policy does not error — it returns ZERO ROWS. The grant alone therefore
-- produced a composition that read its own freshly finalized credential back as
-- "not found", which is a far more confusing failure than a permission error
-- would have been. Stated explicitly, per role, read-only.
do $read_policies$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_credentials'::regclass
       and polname = 'device_credentials_issuance_read') then
    create policy device_credentials_issuance_read
      on kitluy_devices.device_credentials
      for select to kitluy_issuance_service using (true);
  end if;
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_certificates'::regclass
       and polname = 'device_certificates_issuance_read') then
    create policy device_certificates_issuance_read
      on kitluy_devices.device_certificates
      for select to kitluy_issuance_service using (true);
  end if;
end
$read_policies$;

-- A GRANT IS NOT ENOUGH, AND THAT IS THE POINT OF FORCE RLS.
--
-- `device_certificates` carries `FORCE ROW LEVEL SECURITY`, and
-- `kitluy_credential_issuer` is deliberately NOT `BYPASSRLS` — the same shape
-- group 0189 met on the factory-QA tables and answered the same way: when the
-- writer cannot bypass row security, the write path has to be STATED.
--
-- Without this the door fails with "new row violates row-level security policy",
-- which is what it did on its first real run. One policy, scoped to this role
-- alone. No `anon`, `authenticated` or `service_role` policy is created: the
-- client surface stays fail-closed and the artifact still arrives only through
-- the governed door above.
--
-- Read and write only. No DELETE policy, because an issued certificate is
-- history: it is revoked, never removed.
do $policy$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_certificates'::regclass
       and polname = 'device_certificates_credential_issuer') then
    create policy device_certificates_credential_issuer
      on kitluy_devices.device_certificates
      for all
      to kitluy_credential_issuer
      using (true)
      with check (true);
  end if;
end
$policy$;

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
  v_credential kitluy_devices.device_credentials;
  v_head kitluy_devices.device_credential_heads;
  v_enrollment_id uuid;
  v_der bytea;
  v_sha text;
  v_existing kitluy_devices.device_certificates;
  v_id uuid;
begin
  select * into v_credential from kitluy_devices.device_credentials
   where credential_id = p_credential_id;
  if not found then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-CREDENTIAL',
      'detail','no governed credential with that id');
  end if;

  -- BLK-005: development only, refused here rather than deferred to config.
  if v_credential.environment <> 'development' then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-ENVIRONMENT',
      'detail','operational certificates are issued for development only');
  end if;

  -- A revoked, superseded or expired credential must not acquire a fresh
  -- operational artifact: that is the clone-recovery path containment exists to
  -- close, wearing a different hat.
  if v_credential.state <> 'issued' or v_credential.revoked_at is not null then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-CREDENTIAL-STATE',
      'state', v_credential.state, 'detail','only an issued, non-revoked credential may carry an artifact');
  end if;

  -- And it must be the device's CURRENT generation. An artifact for a
  -- superseded generation would satisfy nothing and confuse everything.
  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_credential.device_record_id
     and environment = v_credential.environment
     and purpose = v_credential.purpose;
  if not found or v_head.current_generation <> v_credential.certificate_generation then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-STALE-GENERATION',
      'detail','the credential is not the device''s current generation');
  end if;

  if p_certificate_pem is null or p_certificate_pem !~ 'BEGIN CERTIFICATE' then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-MALFORMED',
      'detail','no PEM certificate was supplied');
  end if;
  if p_chain_pem is null or p_chain_pem !~ 'BEGIN CERTIFICATE' then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-NO-CHAIN',
      'detail','a device cannot verify a leaf without its issuer chain');
  end if;

  -- THE FINGERPRINT IS COMPUTED, NOT ACCEPTED.
  -- Strip the armour and whitespace, decode the base64 body to DER, and digest
  -- that. Over the DER rather than the PEM, so the value is independent of line
  -- endings and of how the armour was wrapped: the same certificate always
  -- yields the same fingerprint.
  begin
    v_der := decode(
      regexp_replace(
        regexp_replace(p_certificate_pem, '-----(BEGIN|END) CERTIFICATE-----', '', 'g'),
        '[[:space:]]', '', 'g'),
      'base64');
  exception when others then
    return jsonb_build_object('outcome','REFUSED','refusal_code','KLUY-OPCERT-MALFORMED',
      'detail','the certificate body is not decodable base64');
  end;
  v_sha := encode(extensions.digest(v_der, 'sha256'), 'hex');

  -- IDEMPOTENCY. A retry after a lost response must return the SAME artifact,
  -- not mint a second one. Keyed on the credential, because one governed
  -- credential carries exactly one operational certificate.
  select * into v_existing from kitluy_devices.device_certificates
   where credential_id = p_credential_id;
  if found then
    if v_existing.certificate_sha256 is distinct from v_sha then
      -- Two different certificates for one credential is a substitution attempt
      -- or a serious bug. Either way it is refused, never overwritten.
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

  -- Every identifying value below comes from the CREDENTIAL, never the caller.
  insert into kitluy_devices.device_certificates (
    device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
    issuer_reference, status, issued_at, expires_at,
    credential_id, certificate_generation, public_key_algorithm,
    certificate_pem, certificate_sha256, chain_pem)
  values (
    v_credential.device_record_id, v_enrollment_id, v_credential.environment,
    v_credential.serial_number, v_credential.public_key_fingerprint,
    v_credential.issuer_key_id, 'active', v_credential.not_before, v_credential.not_after,
    p_credential_id, v_credential.certificate_generation, p_public_key_algorithm,
    p_certificate_pem, v_sha, p_chain_pem)
  returning id into v_id;

  return jsonb_build_object('outcome','RECORDED','certificate_id', v_id,
    'certificate_sha256', v_sha,
    'certificate_serial', v_credential.serial_number,
    'certificate_generation', v_credential.certificate_generation,
    'not_before', v_credential.not_before, 'not_after', v_credential.not_after);
end;
$fn$;

comment on function kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text) is
  'Group 0202. The ONE door that may write an operational X.509 artifact into device_certificates. The caller supplies the certificate bytes and the chain and nothing else: device, environment, generation, serial, public-key fingerprint and the validity window are all read from the governed credential, and certificate_sha256 is computed here from the DER rather than accepted. Idempotent per credential; a second, DIFFERENT certificate for the same credential is refused rather than overwritten. Granted to kitluy_issuance_service ONLY.';

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

do $guard$
declare
  v_privs text;
begin
  -- The application connection role gained nothing. Group 0201 closed this and
  -- a new door must not quietly reopen it.
  select coalesce(string_agg(privilege_type, ',' order by privilege_type), '(none)')
    into v_privs
    from information_schema.role_table_grants
   where grantee = 'service_role' and table_schema = 'kitluy_devices'
     and table_name = 'device_certificates';
  if v_privs <> 'SELECT' then
    raise exception 'KLUY-MIGRATION-0202: service_role holds "%" on device_certificates — expected SELECT only', v_privs
      using errcode = 'P0001';
  end if;

  -- Browser-reachable roles must not hold it at all.
  if has_function_privilege('anon', 'kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.record_operational_certificate_v1(uuid, text, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0202: the artifact door is reachable by a browser-facing role'
      using errcode = 'P0001';
  end if;

  -- The DIRECT grant list must name only the composition identity. This is
  -- deliberately an ACL check and not `has_function_privilege('service_role',…)`:
  -- `service_role` is an INHERITING member of `kitluy_issuance_service`, so the
  -- privilege check answers true for every composition door in this schema and
  -- would fail here for a reason that has nothing to do with this group.
  --
  -- That inheritance is the recorded finding D-07 — `service_role` reaches both
  -- the activation and the certificate-issuer authorities without `SET ROLE`,
  -- which makes group 0199's separation-of-duty claim false as deployed. This
  -- group does not widen it and does not resolve it; it is named here so the
  -- next reader does not mistake the ACL check below for a stronger property
  -- than it is.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
         lateral aclexplode(p.proacl) a
     where n.nspname = 'kitluy_devices'
       and p.proname = 'record_operational_certificate_v1'
       and a.grantee <> 0
       and pg_get_userbyid(a.grantee) not in ('kitluy_credential_issuer', 'kitluy_issuance_service')) then
    raise exception 'KLUY-MIGRATION-0202: the artifact door carries a direct grant beyond the composition identity'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'record_operational_certificate_v1'
       and p.prosecdef
       and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
    raise exception 'KLUY-MIGRATION-0202: the artifact door is not a definer with a pinned search_path'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_certificates'::regclass
       and polname = 'device_certificates_credential_issuer') then
    raise exception 'KLUY-MIGRATION-0202: the issuer has a grant but no row-security policy; the door would fail closed on every write'
      using errcode = 'P0001';
  end if;

  -- The composition may READ the lifecycle and must never write it.
  if not has_table_privilege('kitluy_issuance_service', 'kitluy_devices.device_credentials', 'SELECT') then
    raise exception 'KLUY-MIGRATION-0202: the issuing composition cannot read the credential it must mint a leaf for'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('kitluy_issuance_service', 'kitluy_devices.device_credentials', 'INSERT')
     or has_table_privilege('kitluy_issuance_service', 'kitluy_devices.device_credentials', 'UPDATE') then
    raise exception 'KLUY-MIGRATION-0202: the issuing composition can WRITE the credential lifecycle; it must only consume it'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0202: the operational certificate artifact door is installed';
end
$guard$;

commit;
