-- kitluy:group:0122
-- Migration group 0122: device_trust_decision_alignment (WS-11-T003 step 1).
--
-- Aligns the shipped T001/T002 behavior with owner decision KLD-2026-07-28-002
-- (BLK-005 ruling). Groups 0120 and 0121 are COMMITTED and are NOT edited; every
-- change here is an additive forward migration.
--
-- The five divergences the decision created, each corrected below:
--
--   §10  the incumbent goes to `restricted_investigation`, NOT full quarantine.
--        0121 quarantined BOTH identities unconditionally. That was MORE
--        restrictive than the ruling — it failed safe — but it is not the
--        approved policy.
--   §11  NVMe replacement retains `device_record_id` only when the board AND
--        the TPM / secure-element identity both match. 0120 retained the
--        identity for any storage-module-only change.
--   §11  a board or TPM / secure-element replacement creates a NEW
--        `device_record_id`. Not previously implemented.
--   §1§7 SIX signing purposes, adding `manufacturing_enrollment` and
--        `emergency_recovery`. 0120 constrained four.
--   §5   certificate windows are now known values, so the DEVELOPMENT PKI
--        configuration can be populated. Pilot and production stay empty.
--
-- Plus §4's hardware gate: `hardware_trust_level` and `production_eligible`,
-- with `certified_hardware_skus` created EMPTY so no device can become
-- production-eligible until the owner certifies a TPM 2.0 / secure-element SKU
-- in the production BOM. Same fail-closed shape as the BLK-005 gate itself.
--
-- BOUNDARIES THIS FILE DOES NOT CROSS:
--   development trust implementation — authorized
--   pilot activation                 — BLOCKED (no pilot PKI row is created)
--   production activation            — BLOCKED (no production PKI row is created)
--   production signer                — BLOCKED
--   TPM/secure-element SKU           — owner/procurement gated (table stays empty)
--
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).

-- ---------------------------------------------------------------------------
-- New enum members, added OUTSIDE the transaction (PostgreSQL forbids USING an
-- enum value in the same transaction that adds it).
-- ---------------------------------------------------------------------------
alter type kitluy_devices.device_lifecycle_state
  add value if not exists 'restricted_investigation' after 'quarantined';

alter type kitluy_devices.trust_incident_type
  add value if not exists 'enrollment_station_abuse';

alter type kitluy_devices.replacement_kind
  add value if not exists 'secure_element';

begin;

comment on type kitluy_devices.device_lifecycle_state is
  'Device lifecycle. `awaiting_trust` is where a claimed, scope-bound, assigned device waits for certificate-backed activation. `restricted_investigation` (KLD-2026-07-28-002 §10) is the LESSER containment applied to an INCUMBENT when a duplicate enrollment appears: trust-changing operations stop, existing Store operations continue. Full quarantine of an incumbent requires one of the four §10 escalation conditions.';

-- ===========================================================================
-- §4 — hardware trust level and the production-eligibility gate
-- ===========================================================================

create type kitluy_devices.hardware_trust_level as enum (
  'development_software',
  'tpm_2_0',
  'secure_element'
);

comment on type kitluy_devices.hardware_trust_level is
  'Where a device key actually lives (KLD-2026-07-28-002 §4). `development_software` is permitted ONLY for local development, automated tests and non-production simulation, and such a device is never production-eligible.';

-- ---------------------------------------------------------------------------
-- kitluy_devices.certified_hardware_skus — the §4 SKU sub-gate.
-- ---------------------------------------------------------------------------
-- DELIBERATELY EMPTY. The decision blocks pilot and production HARDWARE
-- certification until the owner selects and certifies a specific TPM 2.0 or
-- secure-element SKU in the production Bill of Materials. No migration, seed or
-- agent may populate this — it is a procurement decision.
--
-- The ruling is explicit that this sub-gate does NOT block the provider
-- interface, lifecycle or test doubles, which is why everything else in
-- WS-11-T003 proceeds around it.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.certified_hardware_skus (
  id uuid primary key default gen_random_uuid(),
  sku_reference text not null unique,
  hardware_trust_level kitluy_devices.hardware_trust_level not null,
  manufacturer text not null,
  part_number text not null,
  certified_for_pilot boolean not null default false,
  certified_for_production boolean not null default false,
  approved_by_decision_ref text not null,
  approved_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- A development-software "SKU" is a contradiction; the gate exists to certify
  -- real hardware.
  constraint certified_hardware_skus_not_software_chk
    check (hardware_trust_level <> 'development_software'),
  constraint certified_hardware_skus_decision_ref_chk
    check (btrim(approved_by_decision_ref) <> ''
       and approved_by_decision_ref !~* '\[REQUIRED'
       and approved_by_decision_ref !~* '^(tbd|todo|placeholder|test|unknown|n/?a)$')
);

comment on table kitluy_devices.certified_hardware_skus is
  'Owner: Security/Procurement. Certified TPM 2.0 / secure-element SKUs (KLD-2026-07-28-002 §4). DELIBERATELY EMPTY and never seeded: pilot and production hardware certification are BLOCKED until the owner certifies a SKU in the production BOM. While empty, no device can become production-eligible. MC: MUT (owner-governed).';

alter table kitluy_devices.hardware_profiles
  add column if not exists certified_sku_reference text
    references kitluy_devices.certified_hardware_skus (sku_reference);

comment on column kitluy_devices.hardware_profiles.certified_sku_reference is
  'The certified TPM/secure-element SKU this profile carries. NULL until the owner certifies one — which is why every profile is currently non-production-eligible.';

alter table kitluy_devices.devices
  add column if not exists hardware_trust_level
    kitluy_devices.hardware_trust_level not null default 'development_software',
  add column if not exists production_eligible boolean not null default false,
  -- Set when a device enters restricted_investigation, so a false-positive
  -- disposition can restore what it was doing rather than guessing.
  add column if not exists restricted_from_state kitluy_devices.device_lifecycle_state,
  add column if not exists restriction_reason text,
  add column if not exists restricted_at timestamptz;

comment on column kitluy_devices.devices.production_eligible is
  'KLD-2026-07-28-002 §4. FALSE for every device until its hardware profile carries a certified SKU AND its key is hardware-backed. The trigger below refuses to set it true otherwise, and certified_hardware_skus is empty, so there is currently no path to true. This is the same fail-closed shape as the BLK-005 gate.';
comment on column kitluy_devices.devices.restricted_from_state is
  'The state the device was in before restricted_investigation. A false-positive disposition restores it rather than inventing a state.';

create index devices_production_eligible_idx
  on kitluy_devices.devices (production_eligible)
  where production_eligible;

-- ---------------------------------------------------------------------------
-- The production-eligibility gate.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_production_eligibility()
returns trigger
language plpgsql
as $$
declare
  v_sku text;
  v_certified boolean;
begin
  if not new.production_eligible then
    return new;
  end if;

  if new.hardware_trust_level = 'development_software' then
    raise exception
      'KLUY-DEVICE-NOT-PRODUCTION-ELIGIBLE: device % uses a software-backed key; KLD-2026-07-28-002 §4 permits software keys only for development, tests and simulation', new.id
      using errcode = 'P0001';
  end if;

  select hp.certified_sku_reference into v_sku
  from kitluy_devices.hardware_profiles hp
  where hp.id = new.hardware_profile_id;

  if v_sku is null then
    raise exception
      'KLUY-DEVICE-SKU-UNCERTIFIED: [REQUIRED: certified TPM 2.0 / secure-element SKU in the production BOM] — KLD-2026-07-28-002 §4 blocks pilot and production hardware certification until the owner certifies a SKU. Device % cannot be production-eligible', new.id
      using errcode = 'P0001',
            hint = 'Populating kitluy_devices.certified_hardware_skus is a procurement decision. No migration, seed or agent may do it.';
  end if;

  select certified_for_production into v_certified
  from kitluy_devices.certified_hardware_skus
  where sku_reference = v_sku;

  if not coalesce(v_certified, false) then
    raise exception
      'KLUY-DEVICE-SKU-UNCERTIFIED: SKU % is not certified for production', v_sku
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.enforce_production_eligibility() is
  'The §4 hardware sub-gate. A device becomes production-eligible only with a hardware-backed key AND a production-certified SKU on its profile. certified_hardware_skus is empty, so there is no path to true today — by design, not by omission.';

create trigger trg_devices_production_eligibility
  before insert or update on kitluy_devices.devices
  for each row execute function kitluy_devices.enforce_production_eligibility();

-- ===========================================================================
-- §1 / §7 — six signing purposes
-- ===========================================================================

alter table kitluy_devices.pki_trust_configuration
  add column if not exists manufacturing_enrollment_key_reference text,
  add column if not exists emergency_recovery_key_reference text;

comment on column kitluy_devices.pki_trust_configuration.manufacturing_enrollment_key_reference is
  'KLD-2026-07-28-002 §1/§7 added manufacturing enrollment as a FIFTH separate signing purpose. Group 0120 constrained four.';
comment on column kitluy_devices.pki_trust_configuration.emergency_recovery_key_reference is
  'KLD-2026-07-28-002 §1/§7 added emergency recovery as a SIXTH separate signing purpose.';

-- The 0120 constraint covered four references as six pairwise clauses. Six
-- purposes would need fifteen. A CHECK cannot contain a subquery, so the
-- distinctness test lives in an IMMUTABLE function and the rule is stated once
-- — adding a seventh purpose becomes a one-line change.
create or replace function kitluy_devices.all_values_distinct(
  variadic p_values text[]
) returns boolean
language sql
immutable
as $$
  select p_values is not null
     and array_position(p_values, null) is null
     and cardinality(p_values) = cardinality(array(select distinct unnest(p_values)));
$$;

comment on function kitluy_devices.all_values_distinct(variadic text[]) is
  'True when every value is present and no two are equal. Used to state the KLD-2026-07-28-002 §7 key-separation rule once rather than as fifteen pairwise CHECK clauses. A NULL anywhere is FALSE, so a missing key reference is a separation failure rather than a silent pass.';

alter table kitluy_devices.pki_trust_configuration
  drop constraint if exists pki_trust_configuration_key_separation_chk;

alter table kitluy_devices.pki_trust_configuration
  add constraint pki_trust_configuration_six_purpose_separation_chk
  check (kitluy_devices.all_values_distinct(
    device_issuing_ca_reference,
    configuration_signing_key_reference,
    release_signing_key_reference,
    transport_signing_key_reference,
    manufacturing_enrollment_key_reference,
    emergency_recovery_key_reference));

comment on constraint pki_trust_configuration_six_purpose_separation_chk
  on kitluy_devices.pki_trust_configuration is
  'KLD-2026-07-28-002 §7: all SIX signing purposes use distinct keys. "A key used for one purpose must not be reused for another." Expressed as a distinct-count test so the rule is stated once rather than as fifteen pairwise clauses.';

-- ===========================================================================
-- §10 — duplicate-evidence containment: quarantine the NEW identity,
--       RESTRICT the incumbent
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- kitluy_devices.enrollment_stations — station identity and containment.
-- ---------------------------------------------------------------------------
-- §10.3 requires repeated duplicate submissions from one station to quarantine
-- that station, and §10 escalation condition 3 asks whether the station is
-- already revoked or compromised. Both need the station to be a ROW, not a
-- free-text label.
--
-- The station CERTIFICATE seam exists here but is not verified: certificate
-- issuance is the later part of this same task, and verifying a certificate
-- that no CA has issued would be theatre.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.enrollment_stations (
  id uuid primary key default gen_random_uuid(),
  station_key text not null unique,
  display_name text not null,
  environment text not null,
  operator_org_ref text not null,
  -- Populated when the manufacturing-enrollment CA issues the station its
  -- certificate. NULL means "not yet certificate-backed", and that is recorded
  -- rather than assumed away.
  station_certificate_serial text,
  station_public_key_fingerprint text,
  status text not null default 'active',
  duplicate_submission_count integer not null default 0,
  quarantined_at timestamptz,
  quarantine_reason text,
  created_at timestamptz not null default now(),
  constraint enrollment_stations_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint enrollment_stations_status_chk
    check (status in ('active', 'quarantined', 'revoked')),
  constraint enrollment_stations_quarantine_consistency_chk
    check ((status = 'active') = (quarantined_at is null)),
  constraint enrollment_stations_fingerprint_format_chk
    check (station_public_key_fingerprint is null
        or station_public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint enrollment_stations_duplicate_count_chk
    check (duplicate_submission_count >= 0)
);

comment on table kitluy_devices.enrollment_stations is
  'Owner: Fleet. Approved manufacturing/repair enrollment station (KLD-2026-07-28-002 §9, §10.3). station_certificate_serial is the seam for the station certificate the manufacturing-enrollment CA will issue; it is NULL today and nothing verifies it, because no CA has issued anything. MC: MUT (state machine only).';

-- How many duplicate submissions from one station before it is contained.
-- Two is deliberate: one duplicate is a plausible data-entry error or a
-- refurbished unit; a second from the SAME station is a pattern.
create or replace function kitluy_devices.station_duplicate_quarantine_threshold()
returns integer language sql immutable as $$ select 2 $$;

comment on function kitluy_devices.station_duplicate_quarantine_threshold() is
  'KLD-2026-07-28-002 §10.3 threshold. Two, because one duplicate is a plausible data-entry error or refurbished unit and a second from the SAME station is a pattern. [REQUIRED: owner confirmation of this threshold] — it is a policy number the decision did not fix, and it is recorded rather than presented as ruled.';

-- ---------------------------------------------------------------------------
-- restrict_incumbent_for_investigation_v1 — the §10 lesser containment.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.restrict_incumbent_for_investigation_v1(
  p_device_id uuid,
  p_reason text,
  p_detected_by text,
  p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_incident_id uuid;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is %', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  -- Already quarantined is STRICTER than restricted. Never step down.
  if v_device.lifecycle_state = 'quarantined' then
    return null;
  end if;

  -- The incident is created atomically with the restriction (§10.1).
  insert into kitluy_devices.device_trust_incidents
    (device_id, incident_type, severity, detected_by, detail)
  values
    (p_device_id, 'duplicate_hardware_signal', 'CRITICAL', p_detected_by,
     coalesce(p_detail, '{}'::jsonb)
       || jsonb_build_object('reason', p_reason, 'containment', 'restricted_investigation'))
  returning id into v_incident_id;

  if v_device.lifecycle_state <> 'restricted_investigation' then
    update kitluy_devices.devices
    set restricted_from_state = v_device.lifecycle_state,
        lifecycle_state = 'restricted_investigation',
        restriction_reason = p_reason,
        restricted_at = now(),
        updated_at = now()
    where id = p_device_id;

    perform kitluy_devices.record_lifecycle_event(
      p_device_id, v_device.lifecycle_state, 'restricted_investigation',
      'DUPLICATE_EVIDENCE_INVESTIGATION', p_detected_by,
      jsonb_build_object('incident_id', v_incident_id,
                         'restricted_from', v_device.lifecycle_state,
                         'reason', p_reason));
  end if;

  return v_incident_id;
end;
$$;

comment on function kitluy_devices.restrict_incumbent_for_investigation_v1 is
  'KLD-2026-07-28-002 §10 lesser containment for an INCUMBENT. Trust-changing operations stop; existing Store operations continue. Records the state the device came from so a false-positive disposition restores it rather than guessing. Never steps DOWN from an existing quarantine.';

-- ---------------------------------------------------------------------------
-- escalate_incumbent_containment_v1 — the four §10 escalation conditions.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.escalate_incumbent_containment_v1(
  p_device_id uuid,
  p_condition text,
  p_evidence_ref text,
  p_actor_ref text,
  p_approval_ref text default null
) returns uuid
language plpgsql
as $$
begin
  -- Exactly the four conditions the decision lists. Anything else is refused,
  -- so "escalate because it seemed prudent" is not a path.
  if p_condition not in (
      'private_key_compromise_evidence',
      'active_device_presents_duplicate_identity',
      'enrollment_station_revoked_or_compromised',
      'a3_a4_approved_containment') then
    raise exception
      'KLUY-DEVICE-ESCALATION-UNAUTHORIZED: % is not one of the four KLD-2026-07-28-002 §10 escalation conditions', p_condition
      using errcode = 'P0001';
  end if;

  -- The A3/A4 route is the only one that rests on a human decision, so it is
  -- the only one that must NAME that decision.
  if p_condition = 'a3_a4_approved_containment'
     and coalesce(btrim(p_approval_ref), '') = '' then
    raise exception
      'KLUY-DEVICE-ESCALATION-UNAPPROVED: A3/A4 containment must name the approval that authorized it'
      using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_evidence_ref), '') = '' then
    raise exception
      'KLUY-DEVICE-ESCALATION-UNEVIDENCED: escalating an incumbent to full quarantine requires an evidence reference'
      using errcode = 'P0001';
  end if;

  return kitluy_devices.quarantine_device_v1(
    p_device_id, 'duplicate_hardware_signal', 'CRITICAL', p_actor_ref,
    format('escalated from restricted_investigation: %s', p_condition),
    jsonb_build_object('escalation_condition', p_condition,
                       'evidence_ref', p_evidence_ref,
                       'approval_ref', p_approval_ref));
end;
$$;

comment on function kitluy_devices.escalate_incumbent_containment_v1 is
  'Moves an INCUMBENT from restricted_investigation to full quarantine, and only under one of the four KLD-2026-07-28-002 §10 conditions. Every escalation needs an evidence reference; the A3/A4 route additionally needs the approval it rests on. "It seemed prudent" is not a condition.';

-- ---------------------------------------------------------------------------
-- quarantine_evidence_collisions_v1 — REPLACED per §10.
-- ---------------------------------------------------------------------------
-- Group 0121 quarantined every colliding incumbent. The decision rules that the
-- incumbent gets the LESSER containment unless an escalation condition holds.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.quarantine_evidence_collisions_v1(
  p_device_id uuid,
  p_detected_by text
) returns integer
language plpgsql
as $$
declare
  v_other uuid;
  v_count integer := 0;
  v_station kitluy_devices.enrollment_stations;
begin
  select * into v_station
  from kitluy_devices.enrollment_stations
  where station_key = p_detected_by;

  for v_other in select * from kitluy_devices.colliding_evidence_device_ids(p_device_id) loop
    -- §10 escalation condition 3: a station that is already revoked or
    -- compromised does not get the benefit of the doubt for its submissions.
    if v_station.id is not null and v_station.status in ('quarantined', 'revoked') then
      perform kitluy_devices.escalate_incumbent_containment_v1(
        v_other, 'enrollment_station_revoked_or_compromised',
        format('station %s status %s', v_station.station_key, v_station.status),
        p_detected_by);
    else
      perform kitluy_devices.restrict_incumbent_for_investigation_v1(
        v_other,
        format('a duplicate enrollment presenting this device''s non-storage hardware evidence was submitted (new identity %s)', p_device_id),
        p_detected_by,
        jsonb_build_object('colliding_device', p_device_id,
                           'enrollment_station', p_detected_by));
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function kitluy_devices.quarantine_evidence_collisions_v1 is
  'KLD-2026-07-28-002 §10, REPLACING the group-0121 behavior. The INCUMBENT is placed in restricted_investigation — trust-changing operations stop, Store operations continue — rather than being fully quarantined because somebody else submitted a duplicate. Full quarantine of the incumbent happens only under a §10 escalation condition, and one of those (a revoked or compromised station) is applied automatically here. The NEW identity is still quarantined outright by enroll_device_v1.';

-- ---------------------------------------------------------------------------
-- Station attribution and the §10.3 repeated-submission containment.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_station_duplicate_submission_v1(
  p_station_key text,
  p_device_id uuid
) returns boolean
language plpgsql
as $$
declare
  v_station kitluy_devices.enrollment_stations;
  v_threshold integer := kitluy_devices.station_duplicate_quarantine_threshold();
begin
  select * into v_station
  from kitluy_devices.enrollment_stations
  where station_key = p_station_key
  for update;

  if not found then
    -- An unregistered station is a finding, not a no-op. It is recorded against
    -- the device because there is no station row to record it against.
    perform kitluy_devices.record_lifecycle_event(
      p_device_id, null, 'quarantined', 'UNREGISTERED_ENROLLMENT_STATION', p_station_key,
      jsonb_build_object('station_key', p_station_key));
    return false;
  end if;

  update kitluy_devices.enrollment_stations
  set duplicate_submission_count = duplicate_submission_count + 1
  where id = v_station.id;

  if v_station.duplicate_submission_count + 1 >= v_threshold
     and v_station.status = 'active' then
    update kitluy_devices.enrollment_stations
    set status = 'quarantined',
        quarantined_at = now(),
        quarantine_reason = format(
          '%s duplicate-evidence submissions reached the containment threshold of %s',
          v_station.duplicate_submission_count + 1, v_threshold)
    where id = v_station.id;

    insert into kitluy_devices.device_trust_incidents
      (device_id, incident_type, severity, detected_by, detail)
    values
      (p_device_id, 'enrollment_station_abuse', 'CRITICAL', p_station_key,
       jsonb_build_object('station_key', p_station_key,
                          'submission_count', v_station.duplicate_submission_count + 1,
                          'threshold', v_threshold));
    return true;
  end if;

  return false;
end;
$$;

comment on function kitluy_devices.record_station_duplicate_submission_v1 is
  'KLD-2026-07-28-002 §10.3. Counts duplicate-evidence submissions per station and quarantines the station at the threshold. An UNREGISTERED station is recorded as a finding rather than silently ignored — enrolling from a station nobody approved is itself the signal.';

-- ===========================================================================
-- §11 — replacement continuity
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- device_identity_continuity_v1 — may this replacement keep the identity?
-- ---------------------------------------------------------------------------
-- §11: the same device_record_id survives an NVMe replacement ONLY when the Pi
-- board identity AND the TPM / secure-element identity both match. A board or
-- TPM replacement creates a NEW device_record_id.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.device_identity_continuity_v1(
  p_device_id uuid,
  p_presented_signals jsonb
) returns table (
  continuous boolean,
  board_matches boolean,
  secure_element_matches boolean,
  secure_element_present boolean,
  reason text
)
language plpgsql
stable
as $$
declare
  v_manifest_id uuid;
  v_board_ok boolean;
  v_se_ok boolean;
  v_se_present boolean;
begin
  select e.hardware_manifest_id into v_manifest_id
  from kitluy_devices.devices d
  join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
  where d.id = p_device_id;

  if v_manifest_id is null then
    return query select false, false, false, false,
      'device has no sealed enrollment to compare continuity against'::text;
    return;
  end if;

  -- Board continuity: every enrolled board/SoC signal must be presented
  -- unchanged. A board serial that moved is a board that moved.
  select not exists (
    select 1
    from kitluy_devices.hardware_manifest_signals s
    where s.manifest_id = v_manifest_id
      and s.signal_type in ('board_serial', 'soc_serial')
      and not exists (
        select 1 from jsonb_array_elements(p_presented_signals) as el
        where (el ->> 'signal_type')::kitluy_devices.hardware_signal_type = s.signal_type
          and kitluy_devices.normalize_hardware_signal(el ->> 'signal_value') = s.signal_value))
    and exists (
      select 1 from kitluy_devices.hardware_manifest_signals s
      where s.manifest_id = v_manifest_id
        and s.signal_type in ('board_serial', 'soc_serial'))
  into v_board_ok;

  select exists (
    select 1 from kitluy_devices.hardware_manifest_signals s
    where s.manifest_id = v_manifest_id
      and s.signal_type in ('tpm_ek_public', 'secure_element_id'))
  into v_se_present;

  select not exists (
    select 1
    from kitluy_devices.hardware_manifest_signals s
    where s.manifest_id = v_manifest_id
      and s.signal_type in ('tpm_ek_public', 'secure_element_id')
      and not exists (
        select 1 from jsonb_array_elements(p_presented_signals) as el
        where (el ->> 'signal_type')::kitluy_devices.hardware_signal_type = s.signal_type
          and kitluy_devices.normalize_hardware_signal(el ->> 'signal_value') = s.signal_value))
  into v_se_ok;

  return query select
    (v_board_ok and v_se_ok and v_se_present),
    v_board_ok,
    v_se_ok,
    v_se_present,
    case
      when not v_board_ok then 'board or SoC identity changed — §11 requires a NEW device_record_id'
      when not v_se_present then 'no TPM or secure-element identity was enrolled, so hardware continuity cannot be proven'
      when not v_se_ok then 'TPM or secure-element identity changed — §11 requires a NEW device_record_id'
      else 'board and secure-element identity both continuous'
    end::text;
end;
$$;

comment on function kitluy_devices.device_identity_continuity_v1 is
  'KLD-2026-07-28-002 §11. The same device_record_id survives a storage-module replacement ONLY when the board/SoC identity AND the TPM / secure-element identity are both continuous. A device enrolled WITHOUT a TPM or secure-element signal cannot prove continuity and therefore cannot retain its identity — that is the honest consequence of §4''s hardware requirement, and it is why every software-backed development device is discontinuous by construction.';

-- ---------------------------------------------------------------------------
-- reenroll_device_v1 — REPLACED to enforce §11 continuity.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.reenroll_device_v1(
  p_device_id uuid,
  p_device_public_key_fingerprint text,
  p_public_key_algorithm text,
  p_key_storage_class text,
  p_enrollment_station_id text,
  p_enrollment_operator_ref text,
  p_signals jsonb,
  p_enrollment_reason text,
  p_replacement_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_prior kitluy_devices.manufacturing_enrollments;
  v_manifest_id uuid;
  v_enrollment_id uuid;
  v_continuity record;
  v_kind kitluy_devices.replacement_kind;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_device.lifecycle_state not in
     ('quarantined', 'restricted_investigation', 'enrolled', 'awaiting_trust', 'suspended') then
    raise exception 'KLUY-DEVICE-REENROLL-STATE: device % is %', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  select * into v_prior
  from kitluy_devices.manufacturing_enrollments
  where id = v_device.current_enrollment_id
  for update;

  if not found then
    raise exception 'KLUY-DEVICE-NOT-ENROLLED: device % has no current enrollment to supersede', p_device_id
      using errcode = 'P0001';
  end if;

  if lower(p_device_public_key_fingerprint) = v_prior.device_public_key_fingerprint then
    raise exception 'KLUY-DEVICE-KEY-REUSE: re-enrollment must present a NEW device key pair; the prior public-key fingerprint was presented again'
      using errcode = 'P0001',
            hint = 'Private keys are never copied from a damaged storage device. Generate a new key pair on the device.';
  end if;

  -- §11 CONTINUITY GATE. A re-enrollment tied to a replacement may retain this
  -- device_record_id only when the board AND secure element are both
  -- continuous. Otherwise the business record must move to a NEW identity.
  if p_replacement_id is not null then
    select replacement_kind into v_kind
    from kitluy_devices.device_replacements where id = p_replacement_id;

    if v_kind in ('mainboard', 'secure_element', 'complete_device') then
      raise exception
        'KLUY-DEVICE-IDENTITY-DISCONTINUOUS: a % replacement creates a NEW device_record_id (KLD-2026-07-28-002 §11); the old device is retired and revoked, and the business assignment moves through the governed claim flow', v_kind
        using errcode = 'P0001',
              hint = 'Enroll the replacement unit with enroll_device_v1, retire this one, and re-claim.';
    end if;

    select * into v_continuity
    from kitluy_devices.device_identity_continuity_v1(p_device_id, p_signals);

    if not v_continuity.continuous then
      raise exception
        'KLUY-DEVICE-IDENTITY-DISCONTINUOUS: this device_record_id cannot be retained — %', v_continuity.reason
        using errcode = 'P0001',
              hint = 'KLD-2026-07-28-002 §11 retains the identity across an NVMe replacement only when board AND TPM/secure-element identity both match.';
    end if;
  end if;

  insert into kitluy_devices.hardware_manifests (device_id, captured_at, captured_by_station)
  values (p_device_id, now(), p_enrollment_station_id)
  returning id into v_manifest_id;

  insert into kitluy_devices.hardware_manifest_signals
    (manifest_id, signal_type, signal_value, is_storage_module)
  select
    v_manifest_id,
    (element ->> 'signal_type')::kitluy_devices.hardware_signal_type,
    kitluy_devices.normalize_hardware_signal(element ->> 'signal_value'),
    kitluy_devices.is_storage_module_signal((element ->> 'signal_type')::kitluy_devices.hardware_signal_type)
  from jsonb_array_elements(p_signals) as element;

  perform kitluy_devices.seal_hardware_manifest(v_manifest_id);

  update kitluy_devices.manufacturing_enrollments
  set state = 'superseded', superseded_at = now()
  where id = v_prior.id;

  insert into kitluy_devices.manufacturing_enrollments
    (device_id, hardware_manifest_id, enrollment_sequence, state,
     device_public_key_fingerprint, public_key_algorithm, key_storage_class,
     enrollment_station_id, enrollment_operator_ref, enrollment_reason,
     supersedes_enrollment_id)
  values
    (p_device_id, v_manifest_id, v_prior.enrollment_sequence + 1, 'sealed',
     lower(p_device_public_key_fingerprint), p_public_key_algorithm, p_key_storage_class,
     p_enrollment_station_id, p_enrollment_operator_ref, p_enrollment_reason,
     v_prior.id)
  returning id into v_enrollment_id;

  update kitluy_devices.device_trust_incidents
  set cleared_at = now(),
      cleared_by_operator_ref = p_enrollment_operator_ref,
      clearance_reason = p_enrollment_reason,
      clearing_enrollment_id = v_enrollment_id
  where device_id = p_device_id
    and cleared_at is null;

  update kitluy_devices.devices
  set current_enrollment_id = v_enrollment_id,
      lifecycle_state = 'enrolled',
      quarantined_at = null,
      quarantine_reason = null,
      restricted_from_state = null,
      restriction_reason = null,
      restricted_at = null,
      updated_at = now()
  where id = p_device_id;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, 'enrolled', p_enrollment_reason, p_enrollment_operator_ref,
    jsonb_build_object('enrollment_id', v_enrollment_id,
                       'supersedes', v_prior.id,
                       'replacement_id', p_replacement_id));

  if p_replacement_id is not null then
    update kitluy_devices.device_replacements
    set new_enrollment_id = v_enrollment_id, completed_at = now()
    where id = p_replacement_id;
  end if;

  return v_enrollment_id;
end;
$$;

comment on function kitluy_devices.reenroll_device_v1 is
  'Governed re-enrollment, with the KLD-2026-07-28-002 §11 continuity gate. A mainboard, secure-element or complete-device replacement is REFUSED here — it creates a new device_record_id. A storage-module replacement retains the identity only when board AND secure-element identity are both continuous. Also refuses a re-enrollment that presents the prior public-key fingerprint, because that is a copied key rather than a new key pair.';

-- ---------------------------------------------------------------------------
-- enroll_device_v1 — REPLACED for §10 containment split and station attribution.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enroll_device_v1(
  p_asset_tag text,
  p_hardware_profile_id uuid,
  p_manufactured_at timestamptz,
  p_device_public_key_fingerprint text,
  p_public_key_algorithm text,
  p_key_storage_class text,
  p_enrollment_station_id text,
  p_enrollment_operator_ref text,
  p_signals jsonb,
  p_enrollment_batch_ref text default null,
  p_enrollment_reason text default 'INITIAL_MANUFACTURING_ENROLLMENT'
) returns uuid
language plpgsql
as $$
declare
  v_profile kitluy_devices.hardware_profiles;
  v_device_id uuid;
  v_manifest_id uuid;
  v_enrollment_id uuid;
  v_required kitluy_devices.hardware_signal_type;
  v_present kitluy_devices.hardware_signal_type[];
  v_duplicates integer;
  v_trust kitluy_devices.hardware_trust_level;
begin
  select * into v_profile
  from kitluy_devices.hardware_profiles where id = p_hardware_profile_id;

  if not found then
    raise exception 'KLUY-DEVICE-PROFILE-MISSING: hardware profile % does not exist', p_hardware_profile_id
      using errcode = 'P0001';
  end if;
  if not v_profile.is_active or v_profile.certification_status = 'WITHDRAWN' then
    raise exception 'KLUY-DEVICE-PROFILE-INACTIVE: hardware profile % is %',
      v_profile.profile_key, v_profile.certification_status using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_signals) is distinct from 'array' or jsonb_array_length(p_signals) = 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-MISSING: enrollment requires a non-empty hardware evidence array; unregistered hardware cannot enroll (trust policy §14)'
      using errcode = 'P0001';
  end if;

  -- §4: the key storage class the station reports IS the hardware trust level.
  v_trust := case p_key_storage_class
    when 'tpm' then 'tpm_2_0'
    when 'secure_element' then 'secure_element'
    when 'hsm' then 'secure_element'
    else 'development_software'
  end::kitluy_devices.hardware_trust_level;

  insert into kitluy_devices.devices
    (asset_tag, hardware_profile_id, device_class, lifecycle_state,
     manufactured_at, hardware_trust_level, production_eligible)
  values
    (p_asset_tag, p_hardware_profile_id, v_profile.device_class, 'manufactured',
     p_manufactured_at, v_trust, false)
  returning id into v_device_id;

  insert into kitluy_devices.hardware_manifests (device_id, captured_at, captured_by_station)
  values (v_device_id, now(), p_enrollment_station_id)
  returning id into v_manifest_id;

  insert into kitluy_devices.hardware_manifest_signals
    (manifest_id, signal_type, signal_value, is_storage_module)
  select
    v_manifest_id,
    (element ->> 'signal_type')::kitluy_devices.hardware_signal_type,
    kitluy_devices.normalize_hardware_signal(element ->> 'signal_value'),
    kitluy_devices.is_storage_module_signal((element ->> 'signal_type')::kitluy_devices.hardware_signal_type)
  from jsonb_array_elements(p_signals) as element;

  select array_agg(distinct s.signal_type) into v_present
  from kitluy_devices.hardware_manifest_signals s where s.manifest_id = v_manifest_id;

  foreach v_required in array v_profile.required_signal_types loop
    if not (v_required = any (coalesce(v_present, '{}'::kitluy_devices.hardware_signal_type[]))) then
      raise exception 'KLUY-DEVICE-EVIDENCE-INCOMPLETE: hardware profile % requires signal % which the enrollment did not present',
        v_profile.profile_key, v_required using errcode = 'P0001';
    end if;
  end loop;

  perform kitluy_devices.seal_hardware_manifest(v_manifest_id);

  insert into kitluy_devices.manufacturing_enrollments
    (device_id, hardware_manifest_id, enrollment_sequence, state,
     device_public_key_fingerprint, public_key_algorithm, key_storage_class,
     enrollment_station_id, enrollment_operator_ref, enrollment_batch_ref, enrollment_reason)
  values
    (v_device_id, v_manifest_id, 1, 'sealed',
     lower(p_device_public_key_fingerprint), p_public_key_algorithm, p_key_storage_class,
     p_enrollment_station_id, p_enrollment_operator_ref, p_enrollment_batch_ref, p_enrollment_reason)
  returning id into v_enrollment_id;

  update kitluy_devices.devices
  set current_enrollment_id = v_enrollment_id, lifecycle_state = 'enrolled', updated_at = now()
  where id = v_device_id;

  perform kitluy_devices.record_lifecycle_event(
    v_device_id, 'manufactured', 'enrolled', p_enrollment_reason, p_enrollment_operator_ref,
    jsonb_build_object('enrollment_id', v_enrollment_id, 'manifest_id', v_manifest_id,
                       'hardware_trust_level', v_trust));

  -- §10: the INCUMBENT is restricted, the NEW identity is quarantined.
  v_duplicates := kitluy_devices.quarantine_evidence_collisions_v1(
    v_device_id, p_enrollment_station_id);

  if v_duplicates > 0 then
    perform kitluy_devices.record_station_duplicate_submission_v1(
      p_enrollment_station_id, v_device_id);

    perform kitluy_devices.quarantine_device_v1(
      v_device_id, 'duplicate_hardware_signal', 'CRITICAL', p_enrollment_station_id,
      format('newly enrolled identity duplicates non-storage hardware evidence from %s non-retired device(s)', v_duplicates),
      jsonb_build_object('colliding_device_count', v_duplicates,
                         'enrollment_station', p_enrollment_station_id));
  end if;

  return v_device_id;
end;
$$;

comment on function kitluy_devices.enroll_device_v1 is
  'Manufacturing/repair-station enrollment (trust policy §4; KLD-2026-07-28-002 §4, §9, §10). Records the hardware trust level from the reported key storage class, and creates every device production-INELIGIBLE. On duplicate evidence the NEW identity is quarantined outright while each incumbent is placed in restricted_investigation, and the submission is attributed to the enrollment station so repeated abuse contains the station.';

-- ===========================================================================
-- §5 — DEVELOPMENT PKI configuration, and ONLY development
-- ===========================================================================
-- The decision fixes the windows, so the development row can be populated. The
-- pilot and production rows CANNOT: §14 keeps pilot activation blocked pending
-- hardware and signer evidence, and production activation blocked pending
-- implementation and security evidence. Creating either row here would open a
-- gate the owner explicitly left shut.
--
-- Every reference below is a DEVELOPMENT-ONLY locator, named so it cannot be
-- mistaken for production custody, and no key material is stored.
-- ===========================================================================
insert into kitluy_devices.pki_trust_configuration
  (environment,
   root_ca_reference,
   device_issuing_ca_reference,
   manufacturing_ca_reference,
   required_key_storage_class,
   certificate_lifetime_days,
   renewal_window_days,
   overlap_window_days,
   revocation_mechanism,
   offline_grace_hours,
   configuration_signing_key_reference,
   release_signing_key_reference,
   transport_signing_key_reference,
   manufacturing_enrollment_key_reference,
   emergency_recovery_key_reference,
   approved_by_decision_ref,
   approved_at,
   is_active)
values
  ('development',
   'kitluy-dev://root-ca/NON-PRODUCTION',
   'kitluy-dev://intermediate/device-identity/NON-PRODUCTION',
   'kitluy-dev://intermediate/manufacturing-enrollment/NON-PRODUCTION',
   'software',
   30,   -- §5 development certificate lifetime
   10,   -- §5 renewal begins 10 days before expiry
   3,    -- §5 maximum overlap
   'SIGNED_REVOCATION_SNAPSHOT',
   720,  -- §6 development maximum snapshot age: 30 days
   'kitluy-dev://signer/configuration/NON-PRODUCTION',
   'kitluy-dev://signer/release/NON-PRODUCTION',
   'kitluy-dev://signer/transport/NON-PRODUCTION',
   'kitluy-dev://signer/manufacturing-enrollment/NON-PRODUCTION',
   'kitluy-dev://signer/emergency-recovery/NON-PRODUCTION',
   'KLD-2026-07-28-002',
   '2026-07-28T00:00:00Z',
   true)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- The pilot/production lock.
-- ---------------------------------------------------------------------------
-- Nothing but an owner decision may create a pilot or production row. This
-- trigger refuses one that does not name a decision OTHER than KLD-2026-07-28-002
-- — because that decision explicitly left both environments blocked pending
-- hardware, signer, implementation and security evidence. A later decision has
-- to say so in its own name.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_pilot_production_pki_lock()
returns trigger
language plpgsql
as $$
begin
  if new.environment in ('pilot', 'production')
     and new.approved_by_decision_ref = 'KLD-2026-07-28-002' then
    raise exception
      'KLUY-DEVICE-PKI-ENVIRONMENT-BLOCKED: KLD-2026-07-28-002 §14 leaves % activation BLOCKED pending hardware, signer, implementation and security evidence. A % PKI configuration requires a LATER owner decision that names itself.',
      new.environment, new.environment
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_devices.enforce_pilot_production_pki_lock() is
  'KLD-2026-07-28-002 §14. The decision that authorized development trust explicitly did NOT authorize pilot or production. This refuses a pilot/production configuration that cites it, so opening those environments requires a later decision that names itself rather than being smuggled in under this one.';

create trigger trg_pki_trust_configuration_environment_lock
  before insert or update on kitluy_devices.pki_trust_configuration
  for each row execute function kitluy_devices.enforce_pilot_production_pki_lock();

-- ---------------------------------------------------------------------------
-- The gate message, corrected for the post-decision world.
-- ---------------------------------------------------------------------------
-- BLK-005's DECISION VALUES are resolved. Saying "BLK-005 is OPEN" would now be
-- wrong, and would send an operator to a ballot that has already been ruled.
-- What actually blocks pilot and production is §14 of the decision itself.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.assert_pki_configuration_approved(
  p_environment text
) returns kitluy_devices.pki_trust_configuration
language plpgsql
stable
as $$
declare
  v_config kitluy_devices.pki_trust_configuration;
begin
  select * into v_config
  from kitluy_devices.pki_trust_configuration
  where environment = p_environment and is_active;

  if not found then
    raise exception
      'KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: approved PKI trust configuration for environment %] — BLK-005 decision values are RESOLVED (KLD-2026-07-28-002) but §14 leaves % activation BLOCKED pending hardware, signer, implementation and security evidence. Development trust is authorized; % is not.',
      p_environment, p_environment, p_environment
      using errcode = 'P0001',
            hint = 'Opening pilot or production requires a LATER owner decision that names itself, plus the implementation and independent review §14 lists. No migration, fixture or agent may insert the row in its place.';
  end if;

  return v_config;
end;
$$;

comment on function kitluy_devices.assert_pki_configuration_approved(text) is
  'The fail-closed PKI gate, post-KLD-2026-07-28-002. Development now RESOLVES (the decision fixed the windows and authorized development trust); pilot and production still raise, because §14 leaves both blocked pending hardware, signer, implementation and security evidence. The message names the decision rather than the ballot, so an operator is not sent to a question that has already been answered.';

-- ---------------------------------------------------------------------------
-- Lifecycle transitions, extended for restricted_investigation.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_device_lifecycle_transition()
returns trigger
language plpgsql
as $$
declare
  v_legal boolean;
begin
  if new.lifecycle_state is not distinct from old.lifecycle_state then
    return new;
  end if;

  v_legal := case old.lifecycle_state
    when 'manufactured'   then new.lifecycle_state in ('enrolled', 'quarantined', 'retired')
    when 'enrolled'       then new.lifecycle_state in ('awaiting_trust', 'quarantined', 'restricted_investigation', 'suspended', 'retired', 'replaced')
    when 'awaiting_trust' then new.lifecycle_state in ('active', 'enrolled', 'quarantined', 'restricted_investigation', 'suspended', 'retired', 'replaced')
    when 'active'         then new.lifecycle_state in ('suspended', 'quarantined', 'restricted_investigation', 'enrolled', 'retired', 'replaced')
    when 'suspended'      then new.lifecycle_state in ('awaiting_trust', 'enrolled', 'quarantined', 'restricted_investigation', 'retired', 'replaced')
    -- restricted_investigation is a LESSER containment. It resolves upward to
    -- whatever the device was doing (false-positive disposition), or downward
    -- to full quarantine (§10 escalation).
    when 'restricted_investigation' then new.lifecycle_state in ('active', 'awaiting_trust', 'enrolled', 'quarantined', 'retired', 'replaced')
    when 'quarantined'    then new.lifecycle_state in ('enrolled', 'retired', 'replaced')
    when 'retired'        then false
    when 'replaced'       then false
    else false
  end;

  if not v_legal then
    raise exception
      'KLUY-DEVICE-TRANSITION-ILLEGAL: % -> % is not a legal device lifecycle transition',
      old.lifecycle_state, new.lifecycle_state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.enforce_device_lifecycle_transition() is
  'The device lifecycle state machine. `enrolled -> active` remains ABSENT: `active` is reachable only from `awaiting_trust`. `restricted_investigation` (KLD-2026-07-28-002 §10) resolves upward to the device''s prior state on a false-positive disposition, or downward to full quarantine on a §10 escalation. `quarantined -> restricted_investigation` is absent because containment never steps down.';

-- ---------------------------------------------------------------------------
-- Activation, extended: restricted_investigation blocks TRUST-CHANGING work.
-- ---------------------------------------------------------------------------
-- §10.4 — "Trust-changing operations on the incumbent are blocked during
-- investigation." Activation is the trust-changing operation par excellence.
-- The existing `lifecycle_state <> 'awaiting_trust'` check already refuses it;
-- this comment records that the refusal is INTENDED rather than incidental.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Fleet status, extended for the new blockers.
-- ---------------------------------------------------------------------------
-- kitluy:destructive-approved:KLD-2026-07-28-002
drop view if exists kitluy_devices.device_fleet_status;

create view kitluy_devices.device_fleet_status as
select
  d.id as device_record_id,
  d.asset_tag,
  d.device_class,
  d.lifecycle_state,
  d.hardware_trust_level,
  d.production_eligible,
  d.assignment_generation,
  hp.profile_key,
  e.enrollment_sequence,
  e.device_public_key_fingerprint,
  e.key_storage_class,
  m.manifest_sha256,
  m.signal_count,
  a.tenant_id,
  a.digital_store_id,
  a.store_location_id,
  a.state as assignment_state,
  (select count(*) from kitluy_devices.device_terminal_assignments t
    where t.assignment_id = a.id and t.state <> 'revoked') as terminal_assignment_count,
  (select count(*) from kitluy_devices.device_trust_incidents ti
    where ti.device_id = d.id and ti.cleared_at is null
      and ti.incident_type <> 'activation_blocked') as open_incident_count,
  (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) as evidence_collision_count,
  (select max(o.observed_at) from kitluy_devices.device_hardware_observations o
    where o.device_id = d.id) as last_observed_at,
  (select c.status from kitluy_devices.device_certificates c
    where c.device_id = d.id and c.status = 'active' limit 1) as certificate_status,
  -- The most specific TRUE reason wins. A fleet view that reports a generic
  -- "awaiting activation" while four different gates are shut is how a blocked
  -- programme comes to look merely pending.
  case
    when d.lifecycle_state = 'active' then 'ACTIVE'
    when d.lifecycle_state in ('retired', 'replaced') then upper(d.lifecycle_state::text)
    when d.lifecycle_state = 'quarantined' then 'QUARANTINED'
    -- Compared as TEXT deliberately. The migration runner wraps this file in a
    -- transaction, and PostgreSQL refuses to resolve an enum value added in the
    -- same transaction; a view body is parsed at creation, unlike a function
    -- body. Casting sidesteps that without splitting the migration.
    when d.lifecycle_state::text = 'restricted_investigation' then 'RESTRICTED_INVESTIGATION'
    when (select count(*) from kitluy_devices.colliding_evidence_device_ids(d.id)) > 0
      then 'BLOCKED_EVIDENCE_COLLISION'
    when a.id is null then 'AWAITING_CLAIM'
    when not d.production_eligible then 'BLOCKED_PRODUCTION_INELIGIBLE'
    when not exists (select 1 from kitluy_devices.pki_trust_configuration p where p.is_active)
      then 'BLOCKED_PKI_UNCONFIGURED'
    else 'AWAITING_ACTIVATION'
  end as fleet_status
from kitluy_devices.devices d
join kitluy_devices.hardware_profiles hp on hp.id = d.hardware_profile_id
left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
left join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
left join kitluy_devices.device_assignments a
  on a.device_id = d.id and a.state in ('pending_trust', 'active');

comment on view kitluy_devices.device_fleet_status is
  'Fleet status read model. Reports the most specific TRUE blocker. BLOCKED_PRODUCTION_INELIGIBLE is the honest answer for every device today: KLD-2026-07-28-002 §4 blocks pilot and production hardware certification until the owner certifies a TPM/secure-element SKU, and certified_hardware_skus is empty.';

-- ---------------------------------------------------------------------------
-- RLS and grants.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.certified_hardware_skus enable row level security;
alter table kitluy_devices.certified_hardware_skus force row level security;
alter table kitluy_devices.enrollment_stations enable row level security;
alter table kitluy_devices.enrollment_stations force row level security;

grant select, insert, update on
  kitluy_devices.certified_hardware_skus, kitluy_devices.enrollment_stations
  to service_role;
grant select on kitluy_devices.device_fleet_status to service_role;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

-- KLRISK-DEVICE-001 stays closed: the raising activation form is re-revoked
-- because the loop above re-granted it.
revoke all on function
  kitluy_devices.activate_device_v1(uuid, text, text) from public, service_role;

commit;
