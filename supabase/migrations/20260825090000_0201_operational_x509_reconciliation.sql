-- kitluy:migration:0201
--
-- THE TWO CERTIFICATE RECORDS WERE NEVER CONNECTED TO EACH OTHER
-- =============================================================================
-- Authority: owner Decision 3A and Step 9 (2026-08-24) — `device_credentials` is
-- the governed credential lifecycle authority, `device_certificates` is the
-- concrete operational X.509 artifact, "the two must be explicitly linked", and
-- "activate_device_v1 must not accept unrelated certificate metadata merely
-- because an active-looking row exists"; KLD-2026-07-28-002 (BLK-005).
--
-- WHAT THE SCHEMA ACTUALLY SAID BEFORE THIS GROUP
-- -----------------------------------------------
-- Read from the live catalogue rather than inferred from the table names:
--
--   device_credentials    owner kitluy_credential_issuer, 25 rows.
--                         serial, generation, assignment_generation, window,
--                         canonical_tbs, detached_signature, and a UNIQUE
--                         created_from_request_id that already makes issuance
--                         structurally idempotent. The real lifecycle.
--
--   device_certificates   owner postgres, 33 rows.
--                         serial, key fingerprint, issuer_reference, status,
--                         issued_at/expires_at. Its own comment says it holds
--                         "fingerprints and serials — never certificates, never
--                         keys". Its only foreign key is to
--                         manufacturing_enrollments — the FACTORY record.
--
-- There is no column joining them, in either direction. Two records about the
-- same thing, sharing no key, and `activate_device_v1` gated on the one that
-- carries no material:
--
--   if not exists (select 1 from device_certificates
--                   where device_id = p_device_id
--                     and environment = p_environment
--                     and status = 'active')
--
-- Device, environment, status. That is the whole predicate. It does not look at
-- the validity window, the credential, the generation, or the public key — so a
-- row inserted with an unrelated serial and any fingerprint satisfies it, and a
-- long-expired certificate satisfies it too. Six rows are `active` today and not
-- one of them corresponds to a signed credential.
--
-- WHAT THIS GROUP DOES
-- --------------------
-- It links the two and gives the artifact somewhere to live, additively, and
-- then makes activation actually read what it linked.

begin;

-- `device_credentials` and `device_credential_heads` are owned by
-- `kitluy_credential_issuer`, not by `postgres`. Creating a foreign key into a
-- table requires REFERENCES on it, so this group borrows that role for the
-- duration and hands it straight back — the same pattern groups 0198 and 0200
-- use for `kitluy_activation_governor`, and for the same reason: a migration
-- should hold an authority for as long as it needs it and not one statement
-- longer.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The link, and the artifact.
-- -----------------------------------------------------------------------------
-- Nullable, because 33 rows already exist and rewriting history is not on the
-- table. The ACTIVATION predicate in §3 requires them, which is where the
-- tightening belongs: old rows keep existing and stop being sufficient.
alter table kitluy_devices.device_certificates
  add column if not exists credential_id uuid
    references kitluy_devices.device_credentials (credential_id),
  add column if not exists certificate_generation integer,
  add column if not exists public_key_algorithm text,
  add column if not exists certificate_pem text,
  add column if not exists certificate_sha256 text,
  add column if not exists chain_pem text;

comment on column kitluy_devices.device_certificates.credential_id is
  'Group 0201. The governed credential lifecycle record (device_credentials) this X.509 artifact belongs to. NULL only for the 33 metadata-only rows that predate this group; activation refuses a NULL.';
comment on column kitluy_devices.device_certificates.certificate_pem is
  'Group 0201. The EXACT leaf certificate as issued, verbatim PEM. Persisted BEFORE issuance is reported successful, so a lost response is answered by returning this same artifact rather than minting a second one. Public material: a certificate is not a secret.';
comment on column kitluy_devices.device_certificates.certificate_sha256 is
  'Group 0201. SHA-256 over the certificate DER, so the fingerprint is independent of PEM line endings or armour. Distinct from public_key_fingerprint, which fingerprints the KEY.';
comment on column kitluy_devices.device_certificates.chain_pem is
  'Group 0201. The issuer chain a device needs to verify the leaf, concatenated PEM, leaf-adjacent first. Never contains a private key.';
comment on column kitluy_devices.device_certificates.public_key_algorithm is
  'Group 0201. Recorded explicitly rather than assumed, because the production device-certificate algorithm is an OPEN owner value ([REQUIRED: device_certificate_signature_algorithm]). A development row saying rsa-2048 must not be read later as a production decision.';

-- Format, and the pairing of artifact with status.
--
-- NOT VALID on purpose: the 33 pre-existing rows carry no artifact and never
-- will. `NOT VALID` constrains every future insert and update while leaving
-- history intact, which is exactly the additive posture this reconciliation
-- needs. Validating it later is a separate, deliberate act.
do $c1$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_certificates_sha256_format_chk') then
    alter table kitluy_devices.device_certificates
      add constraint device_certificates_sha256_format_chk
        check (certificate_sha256 is null or certificate_sha256 ~ '^[0-9a-f]{64}$') not valid;
  end if;
end
$c1$;

do $c2$
begin
  if not exists (select 1 from pg_constraint where conname = 'device_certificates_artifact_pairing_chk') then
    alter table kitluy_devices.device_certificates
      add constraint device_certificates_artifact_pairing_chk
        check (
          (certificate_pem is null) = (certificate_sha256 is null)
          and (certificate_pem is null or chain_pem is not null)
          and (certificate_pem is null or credential_id is not null)
          and (certificate_pem is null or certificate_generation is not null)
        ) not valid;
  end if;
end
$c2$;

-- One artifact, once. A second row carrying the same bytes would mean two
-- lifecycle records claiming one certificate.
create unique index if not exists device_certificates_env_sha256_uq
  on kitluy_devices.device_certificates (environment, certificate_sha256)
  where certificate_sha256 is not null;

-- The join activation makes, and the lookup the delivery route makes.
create index if not exists device_certificates_credential_idx
  on kitluy_devices.device_certificates (credential_id)
  where credential_id is not null;

-- -----------------------------------------------------------------------------
-- 2. A device may hold ONE current operational artifact per environment.
-- -----------------------------------------------------------------------------
-- `device_credentials` already enforces one credential per
-- (device, environment, purpose, generation). Nothing enforced the same for the
-- ARTIFACT, so two `active` rows for one device were legal — and with the old
-- activation predicate either would have satisfied it, non-deterministically.
create unique index if not exists device_certificates_one_active_uq
  on kitluy_devices.device_certificates (device_id, environment)
  where status = 'active';

-- -----------------------------------------------------------------------------
-- 3. Activation stops accepting unrelated metadata.
-- -----------------------------------------------------------------------------
-- `create or replace` over group 0121's function: 0121 is released and is not
-- rewritten, and this is the additive repair posture group 0200 used for 0123.
--
-- The trusted-time gate is UNCHANGED and still runs first — `activate_device_v1`
-- already calls `assert_trusted_time_v1(p_device_id, 'device activation')`, and
-- nothing here weakens or re-implements it.
--
-- What changes is the certificate predicate, which now proves the artifact it
-- selects actually belongs to this device's current governed credential:
--
--   * an artifact exists at all (certificate_pem is not null) — a metadata-only
--     row is no longer sufficient, which is precisely the defect;
--   * it is linked to a credential, and that credential is `issued` (not
--     revoked, superseded or expired), for the SAME device and environment;
--   * the certificate generation matches the credential's generation AND the
--     device's current credential head, so a superseded generation cannot
--     activate;
--   * the artifact's key fingerprint matches the credential's key fingerprint —
--     the operational public key binding;
--   * the validity window contains the authority's own clock. `pg_catalog.now()`
--     is read INSIDE this function, inside the trust boundary, for the same
--     reason group 0200 gives: a caller may ask, and may never say what time it
--     is. An expired certificate no longer activates a device, which it did.
-- SECURITY INVOKER, exactly as group 0121 shipped it. Turning this into a
-- definer would change the security posture of a released function as a side
-- effect of adding a predicate, and `attempt_activate_device_v1` — the only
-- reachable caller — is already a definer owned by `kitluy_activation_governor`,
-- so this body runs inside that authority and needs no authority of its own.
--
-- What it DOES need is permission to read the two tables the new predicate
-- joins, granted below.
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
  -- THE ONLY LINE GROUP 0201 CHANGES.
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
  ) then
    raise exception 'KLUY-DEVICE-NO-CERTIFICATE: device % has no currently valid % operational certificate bound to its current governed credential; activation is certificate-backed (KLD-2026-07-21-003)', p_device_id, p_environment
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

-- READ ONLY, and only what the predicate joins. Activation CONSUMES the
-- credential lifecycle; it must never be able to write it — that authority
-- belongs to `kitluy_credential_issuer` and stays there.
grant select on kitluy_devices.device_credentials to kitluy_activation_governor;
grant select on kitluy_devices.device_credential_heads to kitluy_activation_governor;

-- AND THE POLICIES, BECAUSE A GRANT ALONE IS NOT READ ACCESS HERE.
--
-- Both tables FORCE row security. A SELECT under RLS with no matching policy
-- does not raise — it returns ZERO ROWS — so the grant above, on its own,
-- produced an activation predicate that silently matched nothing and refused
-- every device with KLUY-DEVICE-NO-CERTIFICATE even when a perfectly valid
-- governed certificate was sitting in front of it. That is exactly how it
-- failed on the first real end-to-end run, and it is the same trap group 0189
-- documented for the factory-QA tables.
--
-- Read only, scoped to the activation authority alone. Activation CONSUMES the
-- credential lifecycle; nothing here lets it move one.
do $activation_read$
begin
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_credentials'::regclass
       and polname = 'device_credentials_activation_read') then
    create policy device_credentials_activation_read
      on kitluy_devices.device_credentials
      for select to kitluy_activation_governor using (true);
  end if;
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_credential_heads'::regclass
       and polname = 'device_credential_heads_activation_read') then
    create policy device_credential_heads_activation_read
      on kitluy_devices.device_credential_heads
      for select to kitluy_activation_governor using (true);
  end if;
end
$activation_read$;

comment on function kitluy_devices.activate_device_v1(uuid, text, text) is
  'Group 0121, certificate predicate replaced by group 0201. Group 0121''s body is reproduced verbatim with exactly one predicate replaced, so every pre-existing check — lifecycle state, evidence collision, open incident, pending assignment, generation and the trusted-time assertion — runs unchanged. The certificate gate no longer accepts a metadata-only row: the selected artifact must exist as bytes, be linked to an `issued` credential for the same device and environment, carry that credential''s generation and public-key fingerprint, be the device''s CURRENT credential generation, and be inside its validity window judged by pg_catalog.now() inside the trust boundary.';

-- -----------------------------------------------------------------------------
-- 3b. THE ARTIFACT TABLE STOPS BEING AUTHORABLE BY THE APPLICATION ROLE.
-- -----------------------------------------------------------------------------
-- §3 made activation prove that the certificate it selects is inside its
-- validity window. That is worth nothing if the caller can edit the window.
-- `service_role` held insert/update on `device_certificates`, so it could have
-- moved `expires_at` on a legitimate row and kept a dead certificate alive.
--
-- It also held EXECUTE on group 0123's RAW `issue_device_certificate_v1`, which
-- takes a caller-chosen SERIAL and a caller-chosen PUBLIC-KEY FINGERPRINT — the
-- "certificate substitution with extra steps" that group 0199's own header says
-- it exists to prevent. An earlier independent review recorded that as a MAJOR
-- and it is closed here.
--
-- Inventoried first, as Decision 1 requires: NO non-test application code writes
-- `device_certificates`, calls the raw issuing function, or calls
-- `record_device_replacement_v1`. The governed door,
-- `issue_development_device_certificate_v1`, is a SECURITY DEFINER owned by
-- `postgres` — the table's owner — so it writes as owner and is unaffected.
-- SELECT is retained.
revoke insert, update, delete on kitluy_devices.device_certificates from service_role;
revoke execute on function kitluy_devices.issue_device_certificate_v1(uuid, text, text, text, text) from service_role;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 4. Prove the reconciliation on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_missing text;
begin
  -- The link and the artifact must both exist, or activation's new predicate
  -- silently selects nothing and every device fails to activate.
  select string_agg(c, ', ') into v_missing
    from unnest(array['credential_id','certificate_generation','certificate_pem',
                      'certificate_sha256','chain_pem','public_key_algorithm']) c
   where not exists (
     select 1 from information_schema.columns
      where table_schema='kitluy_devices' and table_name='device_certificates'
        and column_name = c);
  if v_missing is not null then
    raise exception 'KLUY-MIGRATION-0201: device_certificates is missing %', v_missing
      using errcode = 'P0001';
  end if;

  -- Activation must be able to READ the credential lifecycle and must never be
  -- able to write it.
  if not has_table_privilege('kitluy_activation_governor', 'kitluy_devices.device_credentials', 'SELECT') then
    raise exception 'KLUY-MIGRATION-0201: activation cannot read the credential lifecycle it must verify against'
      using errcode = 'P0001';
  end if;
  if has_table_privilege('kitluy_activation_governor', 'kitluy_devices.device_credentials', 'INSERT')
     or has_table_privilege('kitluy_activation_governor', 'kitluy_devices.device_credentials', 'UPDATE') then
    raise exception 'KLUY-MIGRATION-0201: activation can WRITE the credential lifecycle; it must only consume it'
      using errcode = 'P0001';
  end if;

  -- The artifact table must not be authorable by the application role, or the
  -- validity check §3 added can simply be edited around.
  if has_table_privilege('service_role', 'kitluy_devices.device_certificates', 'INSERT')
     or has_table_privilege('service_role', 'kitluy_devices.device_certificates', 'UPDATE')
     or has_table_privilege('service_role', 'kitluy_devices.device_certificates', 'DELETE') then
    raise exception 'KLUY-MIGRATION-0201: service_role can still author device_certificates rows'
      using errcode = 'P0001';
  end if;
  if not has_table_privilege('service_role', 'kitluy_devices.device_certificates', 'SELECT') then
    raise exception 'KLUY-MIGRATION-0201: service_role lost SELECT on device_certificates, which was not intended'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('service_role', 'kitluy_devices.issue_device_certificate_v1(uuid, text, text, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0201: service_role can still call the raw issuing door with a caller-chosen fingerprint'
      using errcode = 'P0001';
  end if;

  -- A grant without a policy is not read access on a FORCE-RLS table.
  if not exists (
    select 1 from pg_policy
     where polrelid = 'kitluy_devices.device_credentials'::regclass
       and polname = 'device_credentials_activation_read') then
    raise exception 'KLUY-MIGRATION-0201: activation has a grant but no row-security policy on device_credentials; the predicate would silently match nothing'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0201: device_certificates now carries the artifact and its credential linkage; activation verifies both';
end
$guard$;

commit;
