-- kitluy:migration:0199
--
-- A DEDICATED DEVELOPMENT CERTIFICATE ISSUER, SEPARATE FROM ACTIVATION
-- =============================================================================
-- Authority: KLD-2026-07-28-002 (BLK-005) — "development certificate
-- implementation AUTHORIZED", pilot and production BLOCKED; KLD-2026-07-21-003
-- (activation is certificate-backed); the 0172/0192/0193/0198 composition
-- pattern this copies.
--
-- WHY THIS EXISTS
-- ---------------
-- `activate_device_v1` refuses with `KLUY-DEVICE-NO-CERTIFICATE` until an ACTIVE
-- row exists in `device_certificates` for the device and environment. Group 0198
-- opened the trusted-time gate; this is the gate immediately behind it, and it
-- was unreachable because nothing in the product ever called
-- `issue_device_certificate_v1`.
--
-- SEPARATION OF DUTY IS THE POINT
-- -------------------------------
-- The identity that ACTIVATES must never mint the credential it then accepts.
-- Group 0198 already asserts `kitluy_activation_service` cannot issue
-- certificates; this group asserts the converse — the issuer cannot activate —
-- so neither half can manufacture trust end to end. The pairing service holds
-- neither.
--
-- WHAT THE CALLER MAY AND MAY NOT DECIDE
-- --------------------------------------
-- `issue_device_certificate_v1` (group 0123) takes a serial AND a public-key
-- fingerprint from its caller. A caller that could choose the fingerprint could
-- bind a certificate to a key the device does not hold, which is certificate
-- substitution with extra steps.
--
-- So this bridge takes NEITHER. The fingerprint is read from the device's own
-- SEALED manufacturing enrollment, and the serial is generated here. The caller
-- names a device and an environment; everything that matters is server-derived.
--
-- The validity window and the issuing CA were already outside caller control —
-- 0123 reads both from `pki_trust_configuration`, whose development row records
-- the CA as `kitluy-dev://…/NON-PRODUCTION`. That string is deliberate: this is
-- development trust under the BLK-005 exception, and it is not, and must not be
-- described as, the production hardware root of trust. Pilot and production are
-- refused below AND independently inside
-- `assert_pki_configuration_approved`.

begin;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The issuer identity.
-- -----------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_device_certificate_issuer') then
    create role kitluy_device_certificate_issuer nologin;
  end if;
end
$role$;

comment on role kitluy_device_certificate_issuer is
  'Group 0199. The DEVELOPMENT device-certificate issuing identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the device-registry service connecting as service_role. Holds EXECUTE on exactly ONE capability — issue_development_device_certificate_v1 — and cannot activate a device, redeem a claim, open a pairing session or reach any table. It exists so that the authority which MINTS an operational credential is never the authority which CONSUMES it. Development only: the door refuses any environment but development, and assert_pki_configuration_approved refuses pilot and production independently under BLK-005.';

grant kitluy_device_certificate_issuer to service_role;
grant usage on schema kitluy_devices to kitluy_device_certificate_issuer;

-- -----------------------------------------------------------------------------
-- 2. The issuing door.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.issue_development_device_certificate_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $issue$
declare
  v_device kitluy_devices.devices;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_serial text;
  v_certificate_id uuid;
  v_existing uuid;
begin
  -- DEVELOPMENT ONLY, checked here as well as inside the PKI assertion. Two
  -- independent refusals because this door's whole purpose is to mint trust:
  -- a single check is a single line to get wrong.
  if p_environment is distinct from 'development' then
    return jsonb_build_object(
      'outcome', 'REFUSED',
      'refusal_code', 'KLUY-DEVCERT-ENVIRONMENT',
      'detail', 'this issuer serves development only; pilot and production remain blocked under BLK-005');
  end if;

  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'refusal_code', 'KLUY-DEVCERT-NO-DEVICE',
      'detail', 'no such device');
  end if;

  -- Containment outranks issuance. A quarantined or terminal device must not be
  -- able to obtain a fresh credential and re-enter the fleet through the front
  -- door — that is precisely the clone-recovery path the containment states
  -- exist to close.
  if v_device.lifecycle_state in ('quarantined', 'retired', 'restricted_investigation') then
    return jsonb_build_object('outcome', 'REFUSED', 'refusal_code', 'KLUY-DEVCERT-CONTAINED',
      'state', v_device.lifecycle_state,
      'detail', 'a contained device cannot be issued a certificate');
  end if;

  -- HET approval is evidenced structurally: approval is the `manufactured ->
  -- enrolled` transition (group 0197), and only a device that has been approved
  -- can have been claimed into `awaiting_trust`. Requiring that state therefore
  -- requires approval without inventing a second, weaker approval check.
  if v_device.lifecycle_state <> 'awaiting_trust' then
    return jsonb_build_object('outcome', 'REFUSED', 'refusal_code', 'KLUY-DEVCERT-STATE',
      'state', v_device.lifecycle_state,
      'detail', 'only an approved, Store-bound device awaiting trust may be issued a certificate');
  end if;

  -- Store binding. A certificate is operational authority for a device IN a
  -- Store, so an unassigned device has nothing to be operational for.
  if not exists (
    select 1 from kitluy_devices.device_assignments a
     where a.device_id = p_device_id and a.state = 'pending_trust'
       and a.assignment_generation = v_device.assignment_generation) then
    return jsonb_build_object('outcome', 'REFUSED', 'refusal_code', 'KLUY-DEVCERT-NO-ASSIGNMENT',
      'detail', 'the device holds no current pending-trust assignment');
  end if;

  -- Idempotence. A device that already holds an active certificate for this
  -- environment is not issued a second one: two live credentials for one device
  -- is an ambiguity every downstream verification would have to resolve, and a
  -- retry after a dropped connection must not create one.
  select id into v_existing from kitluy_devices.device_certificates
   where device_id = p_device_id and environment = p_environment and status = 'active'
   limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'ALREADY_ISSUED', 'certificate_id', v_existing,
      'detail', 'the device already holds an active certificate for this environment');
  end if;

  -- THE KEY IS READ, NEVER ACCEPTED.
  --
  -- `issue_device_certificate_v1` takes a fingerprint from its caller. Passing a
  -- caller-supplied value through here would let whoever reaches this door bind a
  -- certificate to a key the device does not hold. It is read from the device's
  -- own sealed enrollment instead — the same row 0123 then re-reads and binds the
  -- certificate to, so the two cannot disagree.
  select * into v_enrollment from kitluy_devices.manufacturing_enrollments
   where id = v_device.current_enrollment_id and state = 'sealed';
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'refusal_code', 'KLUY-DEVCERT-NOT-ENROLLED',
      'detail', 'the device has no sealed enrollment to issue against');
  end if;

  -- Server-generated, unique per environment by
  -- `device_certificates_environment_certificate_serial_key`. Prefixed so a
  -- development credential is identifiable at a glance in any audit trail.
  v_serial := 'KLDEV-' || upper(replace(gen_random_uuid()::text, '-', ''));

  -- The remaining validations — PKI configuration approved, trusted time
  -- established, enrollment sealed, key storage class permitted for the
  -- environment — belong to 0123 and are NOT repeated here. The issuing CA
  -- reference and the certificate lifetime come from `pki_trust_configuration`,
  -- so neither this door nor its caller chooses them.
  v_certificate_id := kitluy_devices.issue_device_certificate_v1(
    p_device_id, p_environment, v_serial,
    v_enrollment.device_public_key_fingerprint, p_actor_ref);

  return jsonb_build_object(
    'outcome', 'ISSUED',
    'certificate_id', v_certificate_id,
    'certificate_serial', v_serial,
    'public_key_fingerprint', v_enrollment.device_public_key_fingerprint,
    'detail', 'development certificate issued against the sealed enrollment key');
end;
$issue$;

comment on function kitluy_devices.issue_development_device_certificate_v1 is
  'Group 0199. The DEVELOPMENT device-certificate issuing door. Refuses any environment but development, refuses contained devices, requires an approved Store-bound device awaiting trust with a current pending-trust assignment, and is idempotent against an already-active certificate. The public-key fingerprint is READ from the device''s sealed manufacturing enrollment and the serial is generated here — a caller chooses neither, so a certificate cannot be bound to a key the device does not hold. Validity window and issuing CA come from pki_trust_configuration. Granted to kitluy_device_certificate_issuer ONLY, which cannot activate a device. This is development trust under the BLK-005 exception and is NOT the production hardware root of trust.';

alter function kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)
  owner to postgres;
revoke all on function kitluy_devices.issue_development_device_certificate_v1(uuid, text, text) from public;
revoke all on function kitluy_devices.issue_development_device_certificate_v1(uuid, text, text) from anon;
revoke all on function kitluy_devices.issue_development_device_certificate_v1(uuid, text, text) from authenticated;
grant execute on function kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)
  to kitluy_device_certificate_issuer;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 3. Prove the separation on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
begin
  if not exists (select 1 from pg_roles
     where rolname = 'kitluy_device_certificate_issuer' and not rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0199: the issuer role is missing or can log in'
      using errcode = 'P0001';
  end if;
  if exists (select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_device_certificate_issuer')) then
    raise exception 'KLUY-MIGRATION-0199: the issuer role must be a member of NOTHING'
      using errcode = 'P0001';
  end if;

  -- EXACTLY one capability.
  select count(*) into v_extra
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_device_certificate_issuer', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname <> 'issue_development_device_certificate_v1';
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0199: the issuer can execute % function(s) beyond its one capability', v_extra
      using errcode = 'P0001';
  end if;

  -- SEPARATION OF DUTY, asserted in BOTH directions. This is the property the
  -- group exists to create, so it is proven rather than described.
  if has_function_privilege('kitluy_device_certificate_issuer',
       'kitluy_devices.attempt_activate_device_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0199: the certificate issuer can also ACTIVATE a device'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('kitluy_activation_service',
       'kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0199: the activation identity can also ISSUE a certificate'
      using errcode = 'P0001';
  end if;
  -- The pairing identity holds neither.
  if has_function_privilege('kitluy_hub_pairing_service',
       'kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0199: the pairing identity can issue a certificate'
      using errcode = 'P0001';
  end if;

  if has_table_privilege('kitluy_device_certificate_issuer',
       'kitluy_devices.device_certificates', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0199: the issuer holds direct table access to certificates'
      using errcode = 'P0001';
  end if;

  -- A browser must never reach a CA door.
  if has_function_privilege('anon',
       'kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated',
       'kitluy_devices.issue_development_device_certificate_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0199: a browser-reachable role holds certificate-issuing authority'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0199: development certificate issuer applied (one capability, cannot activate, no table reach)';
end
$guard$;

commit;
