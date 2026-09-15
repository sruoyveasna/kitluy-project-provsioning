-- kitluy:group:0225
-- Migration group 0225: activation_requires_current_enrollment_certificate.
--
-- Additive. Groups 0120-0224 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001 (a re-flashed,
-- already-known device recovers its operational credential through governed
-- re-pairing); KLD-2026-07-21-003 (activation is certificate-backed); owner
-- instruction 2026-09-15 choosing to fix activation rather than loosen
-- recovery; recorded as KLREC-2026-09-15-ACTIVATION-ON-SUPERSEDED-ENROLLMENT-001.
--
-- ===========================================================================
-- THE FAILURE, ON HARDWARE
-- ===========================================================================
-- 2026-09-15, Store Hub KL-CFADA8C75001 re-flashed onto a new SD card:
--
--   1. The board registered a new identity key: enrollment 2 superseded
--      enrollment 1.
--   2. The operator revoked its assignment and it re-paired. The Hub pairing
--      route then calls `advanceDeviceTrust` -> `attempt_activate_device_v1`.
--   3. Activation found an `active`, in-window generation-1 certificate bound to
--      the device's current credential head — the certificate recorded under
--      enrollment 1, whose private key is on the OLD card — and ACTIVATED.
--   4. Every certificate request from the board was then refused:
--        KLUY-RECOVERY-DEVICE-STATE: device is active; a re-flashed board
--        recovers its credential after governed re-pairing leaves it
--        awaiting_trust
--
-- The cloud said `active`; the board held no certificate; the Hub agent could
-- not serve. Group 0224's suite never saw it because its re-pair helper paired
-- through the composition and not the route, so the trust advance never ran.
--
-- ===========================================================================
-- THE FIX: ONE CONJUNCT
-- ===========================================================================
-- `activate_device_v1` already proves the certificate is the device's current
-- CREDENTIAL generation (group 0201). It now also proves it was recorded under
-- the device's current ENROLLMENT: `c.enrollment_id = current_enrollment_id`.
-- The artifact door records exactly that value when it writes the row
-- (`record_operational_certificate_v1`: `select current_enrollment_id into
-- v_enrollment_id`), so:
--
--   * first issuance is unchanged — the certificate and the device share the
--     enrollment the board registered with;
--   * a re-flashed, re-paired board now rests at `awaiting_trust`, which is the
--     state 0224's recovery door requires; recovery records generation 2 under
--     the CURRENT enrollment, and the route's trust re-check then activates it;
--   * a board can no longer be activated on a certificate that only a previous
--     SD card holds.
--
-- Everything else in the function is group 0201's, character for character.
-- `create or replace` keeps the owner (`postgres`), SECURITY INVOKER, the ACL
-- and the search_path; the assertion below proves each on apply. Devices that
-- are already `active` are not re-evaluated — activation is a transition.

begin;

create or replace function kitluy_devices.activate_device_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns void
language plpgsql
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $activate$
declare
  v_device kitluy_devices.devices;
  v_open_incidents integer;
  v_collisions integer;
  v_assignment kitluy_devices.device_assignments;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  -- THE BLK-005 GATE, still first.
  perform kitluy_devices.assert_pki_configuration_approved(p_environment);

  -- §12.5 / §12.10: a device that has never established trusted time cannot
  -- activate, and a device in restricted trust mode cannot either. This runs
  -- BEFORE the state check so "the clock is not trustworthy" is the answer
  -- rather than an incidental state complaint.
  perform kitluy_devices.assert_trusted_time_v1(p_device_id, 'device activation');

  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception 'KLUY-DEVICE-ACTIVATION-STATE: device % is %; only a claimed, scope-bound device awaiting trust activates', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select count(*) into v_collisions
  from kitluy_devices.colliding_evidence_device_ids(p_device_id);
  if v_collisions > 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-COLLISION: device % shares hardware evidence with % other non-retired device(s); neither may activate until the duplicate is resolved', p_device_id, v_collisions
      using errcode = 'P0001';
  end if;

  select count(*) into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_id and cleared_at is null
    and incident_type <> 'activation_blocked';
  if v_open_incidents > 0 then
    raise exception 'KLUY-DEVICE-OPEN-INCIDENT: device % has % open trust incident(s); activation requires governed clearance', p_device_id, v_open_incidents
      using errcode = 'P0001';
  end if;

  select * into v_assignment
  from kitluy_devices.device_assignments
  where device_id = p_device_id and state = 'pending_trust' for update;
  if not found then
    raise exception 'KLUY-DEVICE-NO-ASSIGNMENT: device % has no assignment pending trust; the claim must be redeemed first', p_device_id
      using errcode = 'P0001';
  end if;

  if v_assignment.assignment_generation <> v_device.assignment_generation then
    raise exception 'KLUY-DEVICE-GENERATION-STALE: device % carries generation %, the pending assignment is %',
      p_device_id, v_device.assignment_generation, v_assignment.assignment_generation
      using errcode = 'P0001';
  end if;

  -- ===========================================================================
  -- GROUP 0201'S CERTIFICATE PREDICATE, PLUS ONE CONJUNCT FROM GROUP 0225.
  -- ===========================================================================
  -- Everything above and below is group 0121's, character for character. The old
  -- predicate was `device + environment + status = 'active'` and nothing else, so
  -- a metadata-only row with an unrelated serial and any fingerprint satisfied
  -- it, and so did a long-expired one.
  --
  -- It now proves the artifact it selects actually belongs to this device's
  -- current governed credential:
  --
  --   * an artifact exists AS BYTES, not merely a row about one;
  --   * it is linked to an `issued`, non-revoked credential for the SAME device
  --     and environment;
  --   * its generation and public-key fingerprint match that credential;
  --   * that credential is the device's CURRENT generation, so a superseded one
  --     cannot activate;
  --   * it is inside its validity window, judged by `pg_catalog.now()` read
  --     INSIDE this function. A caller may ask for activation and may never say
  --     what time it is — the same rule group 0200 established for trusted time.
  --
  -- The trusted-time assertion earlier in this function is untouched.
  if not exists (
    select 1
      from kitluy_devices.device_certificates c
      join kitluy_devices.device_credentials cr on cr.credential_id = c.credential_id
      join kitluy_devices.device_credential_heads h
        on h.device_record_id = cr.device_record_id
       and h.environment = cr.environment
       and h.purpose = cr.purpose
     where c.device_id = p_device_id
       and c.environment = p_environment
       and c.status = 'active'
       and c.certificate_pem is not null
       and c.certificate_sha256 is not null
       and cr.device_record_id = p_device_id
       and cr.environment = p_environment
       and cr.state = 'issued'
       and cr.revoked_at is null
       and c.certificate_generation = cr.certificate_generation
       and c.public_key_fingerprint = cr.public_key_fingerprint
       and cr.certificate_generation = h.current_generation
       and c.issued_at is not null
       and c.issued_at <= pg_catalog.now()
       and c.expires_at is not null
       and c.expires_at > pg_catalog.now()
       -- GROUP 0225: the certificate must belong to the device's CURRENT
       -- enrollment. A re-flashed board registers a new identity key, which
       -- supersedes its enrollment; the certificate recorded under the old one
       -- lives on the old SD card, not on this board. Without this conjunct the
       -- pairing route activated a re-flashed Store Hub on that certificate
       -- (hardware, 2026-09-15), and 0224's recovery door then refused it for
       -- being active. A null current enrollment matches nothing.
       and c.enrollment_id = v_device.current_enrollment_id
  ) then
    raise exception 'KLUY-DEVICE-NO-CERTIFICATE: device % has no currently valid % operational certificate bound to its current governed credential and its current enrollment; activation is certificate-backed (KLD-2026-07-21-003)', p_device_id, p_environment
      using errcode = 'P0001';
  end if;

  update kitluy_devices.devices
  set lifecycle_state = 'active', updated_at = now() where id = p_device_id;

  update kitluy_devices.device_assignments
  set state = 'active', activated_at = now() where id = v_assignment.id;

  update kitluy_devices.device_terminal_assignments
  set state = 'active' where assignment_id = v_assignment.id and state = 'pending_trust';

  insert into kitluy_devices.device_assignment_projections
    (device_id, assignment_id, assignment_generation, tenant_id,
     digital_store_id, store_location_id, terminal_profile_keys, environment)
  values
    (p_device_id, v_assignment.id, v_assignment.assignment_generation,
     v_assignment.tenant_id, v_assignment.digital_store_id, v_assignment.store_location_id,
     coalesce((select array_agg(t.terminal_profile_key order by t.terminal_profile_key)
               from kitluy_devices.device_terminal_assignments t
               where t.assignment_id = v_assignment.id and t.state = 'active'), '{}'),
     p_environment)
  on conflict (device_id) do update
    set assignment_id = excluded.assignment_id,
        assignment_generation = excluded.assignment_generation,
        tenant_id = excluded.tenant_id,
        digital_store_id = excluded.digital_store_id,
        store_location_id = excluded.store_location_id,
        terminal_profile_keys = excluded.terminal_profile_keys,
        projected_at = now(),
        environment = excluded.environment;

  update kitluy_devices.device_trust_incidents
  set cleared_at = now(), cleared_by_operator_ref = p_actor_ref,
      clearance_reason = 'ACTIVATION_SUCCEEDED'
  where device_id = p_device_id and incident_type = 'activation_blocked' and cleared_at is null;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, 'awaiting_trust', 'active', 'ACTIVATED', p_actor_ref,
    jsonb_build_object('environment', p_environment,
                       'assignment_id', v_assignment.id,
                       'assignment_generation', v_assignment.assignment_generation));
end;
$activate$;

comment on function kitluy_devices.activate_device_v1(uuid, text, text) is
  'Group 0121, certificate predicate replaced by group 0201 and extended by group 0225. Every pre-existing check — lifecycle state, evidence collision, open incident, pending assignment, generation and the trusted-time assertion — runs unchanged. The certificate gate requires an artifact that exists as bytes, is linked to an `issued` credential for the same device and environment, carries that credential''s generation and public-key fingerprint, is the device''s CURRENT credential generation, is inside its validity window judged by pg_catalog.now() inside the trust boundary, and (0225) was recorded under the device''s CURRENT enrollment, so a re-flashed board is never activated on a certificate held by its previous SD card.';

-- -----------------------------------------------------------------------------
-- Prove the change on apply.
-- -----------------------------------------------------------------------------
do $assert_0225$
declare
  v_findings text[] := '{}';
  v_fn regprocedure := 'kitluy_devices.activate_device_v1(uuid, text, text)'::regprocedure;
  v_src text;
begin
  select prosrc into v_src from pg_proc where oid = v_fn;

  if position('c.enrollment_id = v_device.current_enrollment_id' in v_src) = 0 then
    v_findings := v_findings || 'activation does not require the current enrollment';
  end if;
  -- Group 0201's predicate must survive intact.
  if position('cr.certificate_generation = h.current_generation' in v_src) = 0
     or position('c.public_key_fingerprint = cr.public_key_fingerprint' in v_src) = 0
     or position('c.expires_at > pg_catalog.now()' in v_src) = 0
     or position('assert_trusted_time_v1(p_device_id, ''device activation'')' in v_src) = 0 then
    v_findings := v_findings || 'a group 0201 activation check is missing';
  end if;
  if (select prosecdef from pg_proc where oid = v_fn) then
    v_findings := v_findings || 'activate_device_v1 became SECURITY DEFINER';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = v_fn) <> 'postgres' then
    v_findings := v_findings || 'activate_device_v1 changed owner';
  end if;
  if not has_function_privilege('kitluy_activation_governor', v_fn, 'execute') then
    v_findings := v_findings || 'the activation governor lost EXECUTE';
  end if;
  if has_function_privilege('public', v_fn, 'execute') then
    v_findings := v_findings || 'PUBLIC can execute activate_device_v1';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'kitluy_devices' and table_name = 'device_certificates'
                    and column_name = 'enrollment_id') then
    v_findings := v_findings || 'device_certificates has no enrollment_id';
  end if;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0225: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0225: activation requires a certificate recorded under the device''s current enrollment';
end
$assert_0225$;

commit;
