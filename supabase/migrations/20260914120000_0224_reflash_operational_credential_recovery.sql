-- kitluy:group:0224
-- Migration group 0224: reflash_operational_credential_recovery.
--
-- Additive. Groups 0120-0223 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner instruction 2026-09-14 ("implement and verify governed
-- operational-credential recovery for an already-known physical device after
-- re-flash, using the existing credential-renewal/key-rotation mechanism,
-- without deleting or replacing the permanent device identity and without
-- destructive database resets"), recorded as
-- KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001; KLD-2026-08-17-DEVICE-
-- REGISTRATION-APPROVAL-001 ("a reflash creates a new installation generation;
-- credential changes create new credential generations; the device keeps its
-- identity"); U1 hardware report 2026-09-12 §9b.
--
-- ===========================================================================
-- THE FAILURE
-- ===========================================================================
-- A board that already holds an operational certificate is re-flashed. The SD
-- card carried the private half, so the board generates a new key and asks for
-- a certificate again. First issuance registers that key at generation 1, and
-- `register_generation_key_v1` binds one key per generation for ever:
--
--     KLUY-KEY-GENERATION-TAKEN: generation 1 already holds a different key
--
-- `abandon_generation_key_v1` correctly refuses (a certificate exists), and the
-- head is advanced, never removed. The only way out used so far was a
-- table-wide reset of the local device database — which also gave a Store Hub a
-- NEW cloud identity, and that is what produced HUB_NOT_OPERATIONAL.
--
-- ===========================================================================
-- WHAT A RE-FLASHED BOARD IS
-- ===========================================================================
-- Neither of the two cases the credential doors know:
--
--   * not FIRST issuance — the device already has a credential head;
--   * not RENEWAL — renewal proves continuity with a key the device still
--     holds, and `reserve_device_credential_renewal_v1` refuses anything with
--     more than ten days of validity left (KLUY-RENEWAL-TOO-EARLY), or revoked
--     or expired ("recovery, not renewal").
--
-- It is RECOVERY, and the rotation machinery already does everything recovery
-- needs AFTER the reservation: `register_generation_key_v2` binds the new key
-- to the attempt, the shared prepare/sign/finalize pipeline issues generation
-- N+1, `promote_generation_key` holds the key at
-- credential_issued_pending_activation, and `confirm_provider_key_activation_v1`
-- activates it and supersedes the lost key. This group adds exactly ONE new
-- door — the recovery reservation — and nothing downstream of it is forked.
--
-- ===========================================================================
-- WHY THE RESERVATION IS SAFE TO GRANT
-- ===========================================================================
-- The certificate route authenticates nothing but possession of the NEW key.
-- Generation 1 being spendable exactly once is what stops a stranger who knows
-- a device id from minting that device a certificate. A recovery door must not
-- reopen that, so EVERY one of these must hold, and each is checked here:
--
--   1. POLICY. `renewal_policy.allow_reflash_credential_recovery` is true, and a
--      CHECK makes that impossible without naming an owner decision.
--   2. IDENTITY. The request is signed by the device's CURRENT enrolled Ed25519
--      identity key. The service verifies the signature (OPTION B, as for every
--      proof in this schema); this door binds the verified key's fingerprint to
--      `manufacturing_enrollments.device_public_key_fingerprint` of the device's
--      current, sealed enrollment. A stranger has no such key.
--   3. RE-FLASH EVIDENCE, STRUCTURAL AND CLOCK-FREE. The incumbent certificate
--      artifact records the enrollment it was issued under. That enrollment
--      must be a STRICT ANCESTOR of the current one through
--      `supersedes_enrollment_id`. A board whose current installation received
--      the incumbent certificate lost nothing, and is refused.
--   4. RE-PAIRED. The device is `awaiting_trust` with a live assignment at its
--      current assignment generation — the state governed re-pairing (group
--      0218) leaves a recovered board in. No open trust incident.
--   5. NOT REVOKED. A revoked credential is a decision, and recovery does not
--      route around it. An EXPIRED one is fine: the key is lost either way.
--
-- The permanent `device_record_id`, the asset tag and every append-only record
-- are untouched. Nothing is removed. The lost key becomes `superseded`, and the
-- incumbent credential stays bounded by the existing three-day overlap cap —
-- where before this group it stayed active indefinitely.
--
-- ===========================================================================
-- THE ARTIFACT DOOR NEVER SAW GENERATION 2
-- ===========================================================================
-- `record_operational_certificate_v1` inserts every artifact `active`, and group
-- 0201's partial unique index allows ONE active artifact per device and
-- environment. Nothing ever moved a previous artifact out of `active`, because
-- no operational certificate had ever been issued above generation 1. The first
-- generation-2 artifact would have failed with a unique violation. A narrow
-- BEFORE INSERT trigger marks the prior generation's artifact `superseded` —
-- the status the enum has always carried — only when the incoming artifact is
-- the device's current head generation.

begin;

do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- 1. Policy: recovery is permitted only by a named owner decision
-- ===========================================================================
alter table kitluy_devices.renewal_policy
  add column if not exists allow_reflash_credential_recovery boolean not null default false,
  add column if not exists reflash_recovery_approved_by_decision_ref text;

do $policy_check$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'renewal_policy_reflash_recovery_needs_decision_chk'
       and conrelid = 'kitluy_devices.renewal_policy'::regclass
  ) then
    alter table kitluy_devices.renewal_policy
      add constraint renewal_policy_reflash_recovery_needs_decision_chk
      check (allow_reflash_credential_recovery = false
             or reflash_recovery_approved_by_decision_ref is not null);
  end if;
end
$policy_check$;

comment on column kitluy_devices.renewal_policy.allow_reflash_credential_recovery is
  'Group 0224. Whether a re-flashed, already-known device may recover its operational credential through the rotation pipeline. Separate from allow_key_rotation on purpose: proactive rotation stays disabled pending its own owner decision, and enabling recovery does not enable it.';

comment on column kitluy_devices.renewal_policy.reflash_recovery_approved_by_decision_ref is
  'The owner decision that permits re-flash credential recovery. A CHECK refuses allow_reflash_credential_recovery = true without it.';

update kitluy_devices.renewal_policy
   set allow_reflash_credential_recovery = true,
       reflash_recovery_approved_by_decision_ref = 'KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001',
       updated_at = now()
 where environment = 'development';

-- ===========================================================================
-- 2. The recovery evidence: why this reservation was allowed to exist
-- ===========================================================================
create table if not exists kitluy_devices.device_credential_recovery_evidence (
  renewal_attempt_id uuid primary key
    references kitluy_devices.device_renewal_reservations (renewal_attempt_id),
  device_record_id uuid not null references kitluy_devices.devices (id),
  environment text not null,
  purpose text not null,
  incumbent_credential_id uuid not null
    references kitluy_devices.device_credentials (credential_id),
  incumbent_credential_generation integer not null,
  incumbent_certificate_id uuid not null
    references kitluy_devices.device_certificates (id),
  incumbent_enrollment_id uuid not null
    references kitluy_devices.manufacturing_enrollments (id),
  current_enrollment_id uuid not null
    references kitluy_devices.manufacturing_enrollments (id),
  identity_public_key_fingerprint text not null,
  identity_proof_service_verified boolean not null,
  assignment_id uuid not null references kitluy_devices.device_assignments (id),
  actor_ref text not null,
  recorded_at timestamptz not null default now(),
  constraint device_credential_recovery_evidence_env_chk check (environment = 'development'),
  constraint device_credential_recovery_evidence_purpose_chk check (purpose = 'device_identity'),
  constraint device_credential_recovery_evidence_verified_chk
    check (identity_proof_service_verified),
  constraint device_credential_recovery_evidence_fingerprint_chk
    check (identity_public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint device_credential_recovery_evidence_enrollment_moved_chk
    check (incumbent_enrollment_id <> current_enrollment_id)
);

comment on table kitluy_devices.device_credential_recovery_evidence is
  'Owner: Fleet/Security. Group 0224. One row per re-flash credential recovery reservation, written in the same transaction as the reservation, recording exactly which facts admitted it: the incumbent credential and the artifact that names the enrollment it was issued under, the current enrollment that supersedes it, the verified identity key, and the live assignment. Append-only.';

create index if not exists device_credential_recovery_evidence_device_idx
  on kitluy_devices.device_credential_recovery_evidence (device_record_id);
create index if not exists device_credential_recovery_evidence_incumbent_cred_idx
  on kitluy_devices.device_credential_recovery_evidence (incumbent_credential_id);
create index if not exists device_credential_recovery_evidence_incumbent_cert_idx
  on kitluy_devices.device_credential_recovery_evidence (incumbent_certificate_id);
create index if not exists device_credential_recovery_evidence_incumbent_enr_idx
  on kitluy_devices.device_credential_recovery_evidence (incumbent_enrollment_id);
create index if not exists device_credential_recovery_evidence_current_enr_idx
  on kitluy_devices.device_credential_recovery_evidence (current_enrollment_id);
create index if not exists device_credential_recovery_evidence_assignment_idx
  on kitluy_devices.device_credential_recovery_evidence (assignment_id);

create or replace function kitluy_devices.enforce_recovery_evidence_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, kitluy_devices
as $evidence$
begin
  if tg_op <> 'INSERT' then
    raise exception
      'KLUY-RECOVERY-EVIDENCE-IMMUTABLE: recovery evidence is append-only (% refused)', tg_op
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_credential_issuer' then
    raise exception
      'KLUY-RECOVERY-UNAUTHORIZED: only the governed recovery door may record evidence (current_user %)', current_user
      using errcode = 'P0001';
  end if;
  return new;
end;
$evidence$;

create or replace trigger trg_device_credential_recovery_evidence_append_only
  before insert or update or delete on kitluy_devices.device_credential_recovery_evidence
  for each row execute function kitluy_devices.enforce_recovery_evidence_append_only();

alter table kitluy_devices.device_credential_recovery_evidence enable row level security;
alter table kitluy_devices.device_credential_recovery_evidence force row level security;

grant select, insert on kitluy_devices.device_credential_recovery_evidence
  to kitluy_credential_issuer;
grant select on kitluy_devices.device_credential_recovery_evidence to service_role;

do $evidence_policies$
begin
  if not exists (select 1 from pg_policy
                  where polname = 'device_credential_recovery_evidence_issuer_write'
                    and polrelid = 'kitluy_devices.device_credential_recovery_evidence'::regclass) then
    create policy device_credential_recovery_evidence_issuer_write
      on kitluy_devices.device_credential_recovery_evidence
      for all to kitluy_credential_issuer using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policy
                  where polname = 'device_credential_recovery_evidence_service_read'
                    and polrelid = 'kitluy_devices.device_credential_recovery_evidence'::regclass) then
    create policy device_credential_recovery_evidence_service_read
      on kitluy_devices.device_credential_recovery_evidence
      for select to service_role using (true);
  end if;
end
$evidence_policies$;

-- ===========================================================================
-- 3. THE RECOVERY RESERVATION — the one new door
-- ===========================================================================
create or replace function kitluy_devices.reserve_device_credential_recovery_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_idempotency_key text,
  p_identity_public_key_fingerprint text,
  p_identity_proof_service_verified boolean,
  p_trusted_time timestamptz,
  p_trusted_time_status text,
  p_actor_ref text
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $recover$
declare
  v_existing kitluy_devices.device_renewal_reservations;
  v_policy kitluy_devices.renewal_policy;
  v_device kitluy_devices.devices;
  v_head kitluy_devices.device_credential_heads;
  v_current kitluy_devices.device_credentials;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_artifact kitluy_devices.device_certificates;
  v_assignment_id uuid;
  v_is_ancestor boolean;
  v_next integer;
  v_next_key_generation integer;
  v_key_generation integer;
  v_row kitluy_devices.device_renewal_reservations;
begin
  if p_trusted_time_status is distinct from 'trusted' or p_trusted_time is null then
    raise exception
      'KLUY-RECOVERY-NO-TRUSTED-TIME: recovery requires established trusted time (status %)',
      coalesce(p_trusted_time_status, 'null') using errcode = 'P0001';
  end if;
  if p_purpose is distinct from 'device_identity' then
    raise exception 'KLUY-RECOVERY-PURPOSE: only device_identity credentials are recoverable, not %', p_purpose
      using errcode = 'P0001';
  end if;
  if p_idempotency_key is null or p_idempotency_key = '' then
    raise exception 'KLUY-RECOVERY-NO-IDEMPOTENCY-KEY: a recovery reservation must name its idempotency key'
      using errcode = 'P0001';
  end if;

  -- RETRY FIRST, exactly as `reserve_device_credential_renewal_v1` does. After a
  -- successful recovery the eligibility below no longer holds — the incumbent
  -- IS the recovered credential — so a retry that lost its response must be
  -- answered before eligibility is judged again, or it would be refused for
  -- having succeeded.
  select * into v_existing from kitluy_devices.device_renewal_reservations
   where environment = p_environment and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.device_record_id <> p_device_record_id then
      raise exception
        'KLUY-RECOVERY-IDEMPOTENCY-REUSED: this idempotency key belongs to another device'
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from kitluy_devices.device_credential_recovery_evidence
                    where renewal_attempt_id = v_existing.renewal_attempt_id) then
      raise exception
        'KLUY-RECOVERY-IDEMPOTENCY-REUSED: this idempotency key belongs to a renewal, not a recovery'
        using errcode = 'P0001';
    end if;
    if not exists (select 1 from kitluy_devices.device_credential_recovery_evidence
                    where renewal_attempt_id = v_existing.renewal_attempt_id
                      and identity_public_key_fingerprint = p_identity_public_key_fingerprint) then
      raise exception
        'KLUY-RECOVERY-IDENTITY-MISMATCH: the replayed recovery was reserved for a different identity key'
        using errcode = 'P0001';
    end if;
    select key_generation into v_key_generation from kitluy_devices.device_generation_keys
     where renewal_attempt_id = v_existing.renewal_attempt_id;
    if v_key_generation is null then
      -- Reserved, but the response was lost before the key was registered.
      -- The same derivation as a fresh reservation, so the retry registers the
      -- key the original would have.
      select coalesce(max(coalesce(k.key_generation, k.generation)), 0) + 1
        into v_key_generation
        from kitluy_devices.device_generation_keys k
       where k.device_record_id = v_existing.device_record_id
         and k.environment = v_existing.environment and k.purpose = v_existing.purpose;
    end if;
    return jsonb_build_object(
      'outcome', 'REPLAYED_RESERVATION',
      'renewal_attempt_id', v_existing.renewal_attempt_id,
      'renewal_mode', v_existing.renewal_mode::text,
      'next_credential_generation', v_existing.next_credential_generation,
      'current_credential_generation', v_existing.current_credential_generation,
      'current_credential_id', v_existing.current_credential_id,
      'current_public_key_fingerprint',
        (select public_key_fingerprint from kitluy_devices.device_credentials
          where credential_id = v_existing.current_credential_id),
      'assignment_generation', v_existing.assignment_generation,
      'credential_head_version', v_existing.credential_head_version,
      'next_key_generation', v_key_generation,
      'status', v_existing.status::text);
  end if;

  -- 1. POLICY.
  select * into v_policy from kitluy_devices.renewal_policy where environment = p_environment;
  if not found then
    raise exception
      'KLUY-RECOVERY-NO-POLICY: no renewal policy is configured for %; no code default may authorize recovery', p_environment
      using errcode = 'P0001';
  end if;
  if not v_policy.allow_reflash_credential_recovery then
    raise exception
      'KLUY-RECOVERY-NOT-PERMITTED: re-flash credential recovery is disabled for %', p_environment
      using errcode = 'P0001';
  end if;

  -- 2. IDENTITY — the service's verdict, bound below to the current enrollment.
  if p_identity_proof_service_verified is not true then
    raise exception
      'KLUY-RECOVERY-NO-IDENTITY-PROOF: recovery requires a verified signature by the device identity key'
      using errcode = 'P0001';
  end if;
  if p_identity_public_key_fingerprint is null
     or p_identity_public_key_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception
      'KLUY-RECOVERY-IDENTITY-MALFORMED: the identity key fingerprint must be a lowercase sha-256 hex digest'
      using errcode = 'P0001';
  end if;

  -- 4. RE-PAIRED (checked before any lock is taken, like the issuance door).
  select * into v_device from kitluy_devices.devices where id = p_device_record_id;
  if not found then
    raise exception 'KLUY-RECOVERY-DEVICE-MISSING: device % does not exist', p_device_record_id
      using errcode = 'P0001';
  end if;
  if v_device.lifecycle_state <> 'awaiting_trust' then
    raise exception
      'KLUY-RECOVERY-DEVICE-STATE: device is %; a re-flashed board recovers its credential after governed re-pairing leaves it awaiting_trust',
      v_device.lifecycle_state using errcode = 'P0001';
  end if;
  if exists (select 1 from kitluy_devices.device_trust_incidents
              where device_id = p_device_record_id and cleared_at is null) then
    raise exception
      'KLUY-RECOVERY-OPEN-TRUST-INCIDENT: unresolved trust incidents block recovery'
      using errcode = 'P0001';
  end if;

  -- The head lock, FIRST among the credential rows and in the same order the
  -- renewal reservation and the issuance door take it.
  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = p_device_record_id
     and environment = p_environment and purpose = p_purpose
  for update;
  if not found then
    raise exception
      'KLUY-RECOVERY-NOTHING-TO-RECOVER: the device holds no credential; this is first issuance'
      using errcode = 'P0001';
  end if;

  select * into v_current from kitluy_devices.device_credentials
   where device_record_id = p_device_record_id and environment = p_environment
     and purpose = p_purpose and certificate_generation = v_head.current_generation;
  if not found then
    raise exception 'KLUY-RECOVERY-NO-CURRENT-CREDENTIAL: the head points at no credential'
      using errcode = 'P0001';
  end if;

  -- 5. NOT REVOKED.
  if v_current.state = 'revoked' or v_current.revoked_at is not null then
    raise exception
      'KLUY-RECOVERY-REVOKED-CREDENTIAL: generation % is revoked; revocation is a decision that recovery does not route around',
      v_current.certificate_generation using errcode = 'P0001';
  end if;

  -- 2 (continued). The CURRENT, SEALED enrollment holds the identity key.
  select * into v_enrollment from kitluy_devices.manufacturing_enrollments
   where id = v_device.current_enrollment_id;
  if not found or v_enrollment.state <> 'sealed' or v_enrollment.revoked_at is not null then
    raise exception
      'KLUY-RECOVERY-ENROLLMENT-NOT-CURRENT: the device has no current sealed enrollment'
      using errcode = 'P0001';
  end if;
  if v_enrollment.device_public_key_fingerprint <> p_identity_public_key_fingerprint then
    raise exception
      'KLUY-RECOVERY-IDENTITY-MISMATCH: the request is not signed by the key of the device''s current enrollment'
      using errcode = 'P0001';
  end if;

  -- 3. RE-FLASH EVIDENCE.
  select * into v_artifact from kitluy_devices.device_certificates
   where credential_id = v_current.credential_id;
  if not found or v_artifact.enrollment_id is null then
    raise exception
      'KLUY-RECOVERY-NO-INCUMBENT-ARTIFACT: the incumbent credential has no operational artifact naming its enrollment; a first issuance that never completed recovers through abandon_generation_key_v1'
      using errcode = 'P0001';
  end if;
  if v_artifact.enrollment_id = v_enrollment.id then
    raise exception
      'KLUY-RECOVERY-NO-REFLASH-EVIDENCE: the incumbent certificate was issued to the current installation; its key was not lost to a re-flash'
      using errcode = 'P0001';
  end if;

  with recursive lineage (enrollment_id, supersedes_enrollment_id, depth) as (
    select e.id, e.supersedes_enrollment_id, 0
      from kitluy_devices.manufacturing_enrollments e
     where e.id = v_enrollment.id
    union all
    select e.id, e.supersedes_enrollment_id, l.depth + 1
      from kitluy_devices.manufacturing_enrollments e
      join lineage l on e.id = l.supersedes_enrollment_id
     where l.depth < 256
       and e.device_id = p_device_record_id
  )
  select exists (select 1 from lineage
                  where enrollment_id = v_artifact.enrollment_id and depth > 0)
    into v_is_ancestor;
  if not v_is_ancestor then
    raise exception
      'KLUY-RECOVERY-NO-REFLASH-EVIDENCE: the incumbent certificate''s enrollment is not superseded by the current enrollment of this device'
      using errcode = 'P0001';
  end if;

  -- 4 (continued). A live assignment at the device's current generation.
  select a.id into v_assignment_id
    from kitluy_devices.device_assignments a
   where a.device_id = p_device_record_id
     and a.state in ('pending_trust', 'active')
     and a.assignment_generation = v_device.assignment_generation
   order by a.created_at desc
   limit 1;
  if v_assignment_id is null then
    raise exception
      'KLUY-RECOVERY-NO-LIVE-ASSIGNMENT: the device has no live assignment at generation %; re-pair it first',
      v_device.assignment_generation using errcode = 'P0001';
  end if;

  v_next := v_head.current_generation + 1;

  if exists (
    select 1 from kitluy_devices.device_renewal_reservations
     where device_record_id = p_device_record_id and environment = p_environment
       and purpose = p_purpose and next_credential_generation = v_next
       and status not in ('refused', 'abandoned', 'completed')
  ) then
    raise exception
      'KLUY-RECOVERY-ALREADY-RESERVED: generation % already has an open reservation', v_next
      using errcode = 'P0001';
  end if;

  -- The KEY generation is not the credential generation (group 0130). A
  -- first-issuance key records none, so its generation stands in for it.
  select coalesce(max(coalesce(k.key_generation, k.generation)), 0) + 1
    into v_next_key_generation
    from kitluy_devices.device_generation_keys k
   where k.device_record_id = p_device_record_id
     and k.environment = p_environment and k.purpose = p_purpose;

  insert into kitluy_devices.device_renewal_reservations (
    idempotency_key, device_record_id, environment, purpose,
    current_credential_id, current_credential_generation, next_credential_generation,
    assignment_generation, renewal_mode, credential_head_version, status)
  values (
    p_idempotency_key, p_device_record_id, p_environment, p_purpose,
    v_current.credential_id, v_head.current_generation, v_next,
    v_device.assignment_generation, 'rotate_key', v_head.version,
    'key_generation_pending')
  returning * into v_row;

  insert into kitluy_devices.device_credential_recovery_evidence (
    renewal_attempt_id, device_record_id, environment, purpose,
    incumbent_credential_id, incumbent_credential_generation, incumbent_certificate_id,
    incumbent_enrollment_id, current_enrollment_id,
    identity_public_key_fingerprint, identity_proof_service_verified,
    assignment_id, actor_ref)
  values (
    v_row.renewal_attempt_id, p_device_record_id, p_environment, p_purpose,
    v_current.credential_id, v_current.certificate_generation, v_artifact.id,
    v_artifact.enrollment_id, v_enrollment.id,
    p_identity_public_key_fingerprint, true,
    v_assignment_id, p_actor_ref);

  insert into kitluy_devices.device_credential_renewal_attempts (
    device_record_id, environment, from_generation, to_generation, outcome,
    refusal_code, head_version_seen, actor_ref)
  values (p_device_record_id, p_environment, v_head.current_generation, v_next,
          'REFUSED', 'RECOVERY_RESERVED_PENDING_ISSUANCE', v_head.version, p_actor_ref);

  return jsonb_build_object(
    'outcome', 'RESERVED',
    'renewal_attempt_id', v_row.renewal_attempt_id,
    'renewal_mode', v_row.renewal_mode::text,
    'next_credential_generation', v_row.next_credential_generation,
    'current_credential_generation', v_row.current_credential_generation,
    'current_credential_id', v_row.current_credential_id,
    'current_public_key_fingerprint', v_current.public_key_fingerprint,
    'assignment_generation', v_row.assignment_generation,
    'credential_head_version', v_row.credential_head_version,
    'next_key_generation', v_next_key_generation,
    'status', v_row.status::text);
end;
$recover$;

comment on function kitluy_devices.reserve_device_credential_recovery_v1 is
  'Group 0224. Reserves a rotate_key attempt for a RE-FLASHED, already-known device whose operational private key was lost with its SD card. Admits the reservation only when policy permits recovery by named owner decision, the request is signed by the identity key of the device''s current sealed enrollment (service-verified, bound here), the incumbent certificate artifact''s enrollment is a strict ancestor of that enrollment, the device is awaiting_trust with a live assignment and no open incident, and the incumbent is not revoked. Records why in device_credential_recovery_evidence. Replays on the idempotency key before eligibility is judged. Everything after the reservation is the existing rotation pipeline.';

-- ===========================================================================
-- 4. Routing, read-only: which door does this certificate request belong to?
-- ===========================================================================
create or replace function kitluy_devices.classify_operational_certificate_request_v1(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_public_key_fingerprint text
)
returns text
language plpgsql
stable
security definer
set search_path = kitluy_devices, pg_catalog
as $classify$
declare
  v_key kitluy_devices.device_generation_keys;
begin
  select * into v_key from kitluy_devices.device_generation_keys
   where device_record_id = p_device_record_id
     and environment = p_environment and purpose = p_purpose
     and public_key_fingerprint = p_public_key_fingerprint
   order by generation desc
   limit 1;
  if found then
    if v_key.renewal_attempt_id is null then
      -- The first-issuance key presenting itself again: a retry of generation 1.
      return 'FIRST_ISSUANCE';
    end if;
    if exists (select 1 from kitluy_devices.device_credential_recovery_evidence
                where renewal_attempt_id = v_key.renewal_attempt_id) then
      return 'RECOVERY';
    end if;
    -- A key a proactive rotation registered. No certificate route performs one.
    return 'UNSUPPORTED';
  end if;

  if exists (select 1 from kitluy_devices.device_credential_heads
              where device_record_id = p_device_record_id
                and environment = p_environment and purpose = p_purpose) then
    return 'RECOVERY';
  end if;
  return 'FIRST_ISSUANCE';
end;
$classify$;

comment on function kitluy_devices.classify_operational_certificate_request_v1 is
  'Group 0224. Read-only routing for the operational certificate route: FIRST_ISSUANCE for a device with no credential head or for the generation-1 key retrying; RECOVERY for a new key on a device that already holds a credential, or for a key a recovery reservation registered; UNSUPPORTED for a key registered by a proactive rotation. Decides nothing about eligibility — the doors behind each route do.';

-- ===========================================================================
-- 5. A newer generation's artifact supersedes the prior one
-- ===========================================================================
create or replace function kitluy_devices.supersede_prior_operational_artifact()
returns trigger
language plpgsql
set search_path = pg_catalog, kitluy_devices
as $supersede$
begin
  if new.credential_id is null or new.status <> 'active' or new.certificate_generation is null then
    return new;
  end if;

  -- Only the device's CURRENT head generation may displace an older artifact.
  -- The artifact door already refuses any other credential; this keeps the
  -- trigger from widening that for any other inserter.
  if not exists (
    select 1
      from kitluy_devices.device_credentials cr
      join kitluy_devices.device_credential_heads h
        on h.device_record_id = cr.device_record_id
       and h.environment = cr.environment
       and h.purpose = cr.purpose
     where cr.credential_id = new.credential_id
       and h.current_generation = cr.certificate_generation
  ) then
    return new;
  end if;

  update kitluy_devices.device_certificates
     set status = 'superseded'
   where device_id = new.device_id
     and environment = new.environment
     and status = 'active'
     and credential_id is not null
     and certificate_generation < new.certificate_generation;

  return new;
end;
$supersede$;

comment on function kitluy_devices.supersede_prior_operational_artifact() is
  'Group 0224. Before an operational artifact for the device''s CURRENT head generation is inserted, marks the device''s older active artifacts superseded. Group 0201 allows one active artifact per device and environment, and nothing had ever moved the previous one out of active because no operational certificate had been issued above generation 1.';

create or replace trigger trg_device_certificates_supersede_prior_artifact
  before insert on kitluy_devices.device_certificates
  for each row execute function kitluy_devices.supersede_prior_operational_artifact();

-- ===========================================================================
-- 6. Ownership and grants
-- ===========================================================================
alter function kitluy_devices.reserve_device_credential_recovery_v1(
  uuid, text, text, text, text, boolean, timestamptz, text, text)
  owner to kitluy_credential_issuer;
alter function kitluy_devices.classify_operational_certificate_request_v1(uuid, text, text, text)
  owner to kitluy_credential_issuer;

revoke all on function kitluy_devices.reserve_device_credential_recovery_v1(
  uuid, text, text, text, text, boolean, timestamptz, text, text) from public;
revoke all on function kitluy_devices.classify_operational_certificate_request_v1(
  uuid, text, text, text) from public;
revoke all on function kitluy_devices.enforce_recovery_evidence_append_only() from public;
revoke all on function kitluy_devices.supersede_prior_operational_artifact() from public;

do $revoke_platform_roles$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function kitluy_devices.reserve_device_credential_recovery_v1(uuid, text, text, text, text, boolean, timestamptz, text, text) from %I', r);
      execute format(
        'revoke all on function kitluy_devices.classify_operational_certificate_request_v1(uuid, text, text, text) from %I', r);
    end if;
  end loop;
end
$revoke_platform_roles$;

grant execute on function kitluy_devices.reserve_device_credential_recovery_v1(
  uuid, text, text, text, text, boolean, timestamptz, text, text) to kitluy_issuance_service;
grant execute on function kitluy_devices.classify_operational_certificate_request_v1(
  uuid, text, text, text) to kitluy_issuance_service;

-- ===========================================================================
-- 7. HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0224$
declare
  v_findings text[] := array[]::text[];
  v_fn record;
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'renewal_policy_reflash_recovery_needs_decision_chk') then
    v_findings := v_findings || 'the recovery policy CHECK is missing';
  end if;

  if exists (select 1 from kitluy_devices.renewal_policy where allow_key_rotation) then
    v_findings := v_findings || 'proactive key rotation became enabled; this group must not enable it';
  end if;

  for v_fn in
    select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('reserve_device_credential_recovery_v1',
                         'classify_operational_certificate_request_v1')
  loop
    if not v_fn.prosecdef then
      v_findings := v_findings || format('%s is not security definer', v_fn.proname);
    end if;
    if v_fn.owner <> 'kitluy_credential_issuer' then
      v_findings := v_findings || format('%s is owned by %s', v_fn.proname, v_fn.owner);
    end if;
    if has_function_privilege('public', v_fn.oid, 'execute') then
      v_findings := v_findings || format('%s is executable by PUBLIC', v_fn.proname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'anon')
       and has_function_privilege('anon', v_fn.oid, 'execute') then
      v_findings := v_findings || format('%s is executable by anon', v_fn.proname);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated')
       and has_function_privilege('authenticated', v_fn.oid, 'execute') then
      v_findings := v_findings || format('%s is executable by authenticated', v_fn.proname);
    end if;
    if not has_function_privilege('kitluy_issuance_service', v_fn.oid, 'execute') then
      v_findings := v_findings || format('%s is not executable by kitluy_issuance_service', v_fn.proname);
    end if;
  end loop;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'kitluy_devices'
         and p.proname in ('reserve_device_credential_recovery_v1',
                           'classify_operational_certificate_request_v1')) <> 2 then
    v_findings := v_findings || 'a recovery function is missing or overloaded';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_device_certificates_supersede_prior_artifact'
                    and tgrelid = 'kitluy_devices.device_certificates'::regclass
                    and tgenabled = 'O') then
    v_findings := v_findings || 'the artifact supersession trigger is not armed';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_device_credential_recovery_evidence_append_only'
                    and tgenabled = 'O') then
    v_findings := v_findings || 'the recovery evidence append-only trigger is not armed';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
           where oid = 'kitluy_devices.device_credential_recovery_evidence'::regclass) then
    v_findings := v_findings || 'row level security is not forced on recovery evidence';
  end if;

  -- The rotation pipeline this door feeds must still be the governed one.
  if not exists (select 1 from pg_trigger
                  where tgname = 'trg_device_credentials_promote_key' and tgenabled = 'O') then
    v_findings := v_findings || 'promote_generation_key is not armed; a recovered key could skip pending activation';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'kitluy_devices'
                    and indexname = 'device_renewal_reservations_open_uq') then
    v_findings := v_findings || 'the one-open-reservation index is missing';
  end if;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0224: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
end
$assert_0224$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
