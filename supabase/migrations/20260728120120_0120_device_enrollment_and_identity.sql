-- kitluy:group:0120
-- Migration group 0120: device_enrollment_and_identity (WS-11-T001, Cycle 10).
--   kitluy_devices: hardware_profiles, devices, hardware_manifests,
--     hardware_manifest_signals, manufacturing_enrollments,
--     device_hardware_observations, device_trust_incidents,
--     device_certificates, pki_trust_configuration, device_replacements,
--     device_lifecycle_events
--   + enrollment / quarantine / retirement / replacement state machine
--   + the BLK-005 fail-closed activation and certificate-issuance gate.
--
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
--   schema ownership registry row `kitluy_devices` ("Managed device identity,
--   certificate, assignment, provisioning, capability, action and RMA") and its
--   relation dictionary (DD lines 318-326). The schema name is ALREADY in
--   DD v1.0.0, so no dictionary amendment is required to create it.
-- Security contract: docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md
--   §3 device identity layers, §4 manufacturing enrollment, §8 clone and
--   duplicate defense, §11 repair/NVMe/replacement, §13 data model.
-- Owner instruction (2026-07-28, Cycle 10 T001 authorization) fixes the
--   identity model as:
--       immutable KitLuy device_record_id
--     + manufacturing enrollment record
--     + device public-key fingerprint
--     + hardware evidence
--     + storage-module evidence
--     + assignment generation
--     + certificate status
--
-- ===========================================================================
-- IDENTITY RULE (owner-stated, and the single most important rule in this file)
-- ===========================================================================
-- The primary device identity is `kitluy_devices.devices.id` — an opaque,
-- immutable, server-generated uuid. It is NOT derived from hardware values.
--
-- MAC address, storage serial and board/SoC identifiers are BINDING SIGNALS and
-- TAMPER SIGNALS. They are never hashed together into an identity, because a
-- derived identity means a repaired device silently becomes a different device
-- and a cloned device silently becomes the same one. Both are wrong.
--
-- A changed signal therefore QUARANTINES the existing device record and
-- requires governed re-enrollment (trust policy §3: "Hardware values are
-- signals, not a single secret ... Changing repairable parts follows approved
-- RMA/re-enrollment; it does not silently clone or permanently brick the
-- business record").
--
-- `hardware_manifests.manifest_sha256` exists and IS a digest over the signal
-- set, but it is a CHANGE-DETECTION digest, not an identifier. Nothing in this
-- schema resolves a device by it. It is computed server-side from the stored
-- signals so a caller cannot assert a manifest it did not actually present.
--
-- ===========================================================================
-- BLK-005 GATE (fail-closed)
-- ===========================================================================
-- BLK-005 (PKI root/CA design, HSM/secure-element model, certificate windows)
-- is OPEN. This migration therefore implements NO production CA, NO certificate
-- issuance, NO key custody, NO revocation distribution and NO activation.
--
-- `kitluy_devices.pki_trust_configuration` is created EMPTY and is NOT seeded.
-- `assert_pki_configuration_approved()` raises an explicit required-value error
-- while it is empty, and `activate_device_v1` / `issue_device_certificate_v1`
-- call it FIRST. Activation without approved PKI configuration cannot succeed.
--
-- This is the same discipline that kept WS-10 from inventing a production batch
-- signer. The gate is removed by owner decision on BLK-005 plus an implemented,
-- tested and independently reviewed cryptographic design — not by an agent.
--
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED). RLS ENABLE+FORCE with SELECT-only client
-- policies is applied in the same file below.

begin;

create schema if not exists kitluy_devices;

comment on schema kitluy_devices is
  'Owner: Fleet. Managed device identity, manufacturing enrollment, hardware evidence, certificate status, trust incidents and replacement (DD v1.0.0 schema ownership registry). Primary identity is an opaque immutable uuid; hardware values are binding/tamper SIGNALS and are never composed into an identifier. Certificate issuance and device activation are gated on BLK-005 and fail closed.';

-- ---------------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------------

-- Trust policy §3 "Operational identity" / §5 (terminals are provisioned
-- through the Active Hub). `peripheral` is present because peripheral_tests is
-- in the DD; no peripheral workflow is implemented here.
create type kitluy_devices.device_class as enum (
  'store_hub',
  'terminal',
  'manufacturing_station',
  'peripheral'
);

-- The enrollment / quarantine / retirement / replacement state machine.
-- `active` is reachable ONLY through activate_device_v1, which is gated on
-- BLK-005 and currently always fails closed.
create type kitluy_devices.device_lifecycle_state as enum (
  'manufactured',
  'enrolled',
  'quarantined',
  'active',
  'suspended',
  'retired',
  'replaced'
);

create type kitluy_devices.enrollment_state as enum (
  'sealed',
  'superseded',
  'revoked'
);

-- Trust policy §3 hardware registry row. `storage_module` signals are broken
-- out because NVMe replacement is an APPROVED change to exactly those signals
-- and an UNAPPROVED change to any other signal (§11).
create type kitluy_devices.hardware_signal_type as enum (
  'mac_address',
  'board_serial',
  'soc_serial',
  'tpm_ek_public',
  'secure_element_id',
  'storage_serial',
  'storage_model',
  'boot_measurement',
  'os_image_digest'
);

-- Certificate STATUS is modelled; certificate ISSUANCE is not implemented.
create type kitluy_devices.certificate_status as enum (
  'requested',
  'active',
  'expired',
  'revoked',
  'superseded'
);

-- Trust policy §8 clone and duplicate defense.
create type kitluy_devices.trust_incident_type as enum (
  'hardware_signal_mismatch',
  'unregistered_hardware_signal',
  'duplicate_hardware_signal',
  'key_fingerprint_mismatch',
  'storage_module_changed',
  'manual_quarantine',
  'activation_blocked'
);

create type kitluy_devices.replacement_kind as enum (
  'storage_module',
  'mainboard',
  'complete_device'
);

-- ---------------------------------------------------------------------------
-- kitluy_devices.hardware_profiles — certified hardware definition (DD).
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.hardware_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  display_name text not null,
  device_class kitluy_devices.device_class not null,
  manufacturer text not null,
  model_identifier text not null,
  hardware_revision text,
  -- Which signal types an enrollment of this profile MUST carry. A profile
  -- that requires a TPM EK cannot be enrolled without one.
  required_signal_types kitluy_devices.hardware_signal_type[] not null default '{}',
  -- Secure-element / TPM expectations stay [REQUIRED] until BLK-005 rules the
  -- reference-hardware decision (trust policy Appendix A).
  secure_element_expectation text not null default '[REQUIRED: TPM/secure-element reference hardware decision (BLK-005)]',
  certification_status text not null default 'DRAFT',
  profile_version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint hardware_profiles_certification_status_chk
    check (certification_status in ('DRAFT', 'CERTIFIED', 'WITHDRAWN')),
  constraint hardware_profiles_version_chk check (profile_version >= 1)
);

comment on table kitluy_devices.hardware_profiles is
  'Owner: Fleet. Certified hardware definition (DD kitluy_devices.hardware_profiles). required_signal_types is the evidence contract an enrollment of this profile must satisfy. MC: MUT (catalogue).';
comment on column kitluy_devices.hardware_profiles.secure_element_expectation is
  'Stays [REQUIRED: ...] until BLK-005 rules the TPM/secure-element reference hardware decision. Never guessed.';

-- ---------------------------------------------------------------------------
-- kitluy_devices.devices — the immutable KitLuy device record.
-- ---------------------------------------------------------------------------
-- `id` IS the device_record_id. It is generated, opaque and immutable. It is
-- deliberately NOT derived from any hardware value (see IDENTITY RULE above).
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.devices (
  id uuid primary key default gen_random_uuid(),
  -- Human-facing asset tag for warehouse/RMA paperwork. Unique, mutable,
  -- and NOT an identity: nothing resolves trust through it.
  asset_tag text not null unique,
  hardware_profile_id uuid not null references kitluy_devices.hardware_profiles (id),
  device_class kitluy_devices.device_class not null,
  lifecycle_state kitluy_devices.device_lifecycle_state not null default 'manufactured',
  -- Points at the CURRENT sealed enrollment. Re-enrollment writes a new
  -- enrollment row and repoints this; the old row is superseded, never edited.
  -- FK is added after manufacturing_enrollments exists (plan rule R4).
  current_enrollment_id uuid,
  -- Assignment generation is part of the owner's identity model. Issuance and
  -- revocation land in WS-11-T002; generation 0 means NEVER ASSIGNED.
  assignment_generation integer not null default 0,
  -- Denormalised for fleet queries. Maintained only by the governed functions
  -- in this file; the lifecycle trigger rejects hand edits that skip them.
  quarantined_at timestamptz,
  quarantine_reason text,
  retired_at timestamptz,
  replaced_by_device_id uuid references kitluy_devices.devices (id),
  manufactured_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint devices_assignment_generation_chk check (assignment_generation >= 0),
  constraint devices_quarantine_consistency_chk
    check ((lifecycle_state = 'quarantined') = (quarantined_at is not null)),
  constraint devices_retired_consistency_chk
    check ((lifecycle_state = 'retired') = (retired_at is not null)),
  constraint devices_replaced_consistency_chk
    check ((lifecycle_state = 'replaced') = (replaced_by_device_id is not null)),
  constraint devices_no_self_replacement_chk
    check (replaced_by_device_id is null or replaced_by_device_id <> id)
);

comment on table kitluy_devices.devices is
  'Owner: Fleet. The immutable KitLuy device record (DD kitluy_devices.devices). `id` is the device_record_id: opaque, server-generated, immutable, and NEVER derived from MAC/serial/board identifiers. Hardware values live in hardware_manifest_signals as binding and tamper signals. lifecycle_state moves only through the governed functions in group 0120; `active` additionally requires approved PKI configuration (BLK-005) and is currently unreachable. MC: MUT (state machine only).';
comment on column kitluy_devices.devices.id is
  'device_record_id. Opaque and immutable. Deriving this from hardware values is forbidden: it would make a repaired device a new device and a cloned device the same device.';
comment on column kitluy_devices.devices.asset_tag is
  'Warehouse/RMA paperwork label. Unique and mutable. Explicitly NOT an identity or a trust input.';
comment on column kitluy_devices.devices.assignment_generation is
  'Owner identity-model component. 0 = never assigned. Issuance/revocation is WS-11-T002; this column is not incremented anywhere in group 0120.';

create index devices_lifecycle_state_idx
  on kitluy_devices.devices (lifecycle_state);
create index devices_hardware_profile_idx
  on kitluy_devices.devices (hardware_profile_id);

-- ---------------------------------------------------------------------------
-- kitluy_devices.hardware_manifests — the hardware-evidence inventory.
-- ---------------------------------------------------------------------------
-- One manifest = one captured evidence set for one device at one enrollment.
-- Append-only. Re-enrollment captures a NEW manifest; the old one is history.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.hardware_manifests (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  -- Server-computed over the sorted signal set by seal_hardware_manifest().
  -- A CHANGE-DETECTION digest, never an identifier.
  manifest_sha256 text,
  signal_count integer not null default 0,
  captured_at timestamptz not null,
  captured_by_station text not null,
  sealed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint hardware_manifests_sha256_format_chk
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint hardware_manifests_sealed_consistency_chk
    check ((sealed_at is null) = (manifest_sha256 is null)),
  constraint hardware_manifests_signal_count_chk check (signal_count >= 0)
);

comment on table kitluy_devices.hardware_manifests is
  'Owner: Fleet. Captured hardware-evidence inventory for one device at one enrollment (trust policy §13 hardware_manifests). Append-only once sealed. manifest_sha256 is a change-detection digest computed server-side from the stored signals; it is NOT a device identifier and nothing resolves a device by it. MC: A/O.';

create index hardware_manifests_device_idx
  on kitluy_devices.hardware_manifests (device_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- kitluy_devices.hardware_manifest_signals — individual binding signals.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.hardware_manifest_signals (
  id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references kitluy_devices.hardware_manifests (id),
  signal_type kitluy_devices.hardware_signal_type not null,
  -- Normalised (trimmed, lower-cased) so that presentation differences are not
  -- read as tamper. Raw hardware inventory data; not a credential.
  signal_value text not null,
  -- Storage-module signals are the ONLY ones an approved NVMe replacement may
  -- change (trust policy §11). Derived, not caller-asserted.
  is_storage_module boolean not null,
  created_at timestamptz not null default now(),
  constraint hardware_manifest_signals_value_chk
    check (length(signal_value) between 1 and 512),
  constraint hardware_manifest_signals_normalised_chk
    check (signal_value = lower(btrim(signal_value))),
  unique (manifest_id, signal_type, signal_value)
);

comment on table kitluy_devices.hardware_manifest_signals is
  'Owner: Fleet. One binding/tamper signal within a hardware manifest (trust policy §3 hardware registry). These values are SIGNALS, never identity. A device is not resolved by them; a change in them quarantines the existing device record and requires governed re-enrollment. MC: A/O.';
comment on column kitluy_devices.hardware_manifest_signals.is_storage_module is
  'True for storage-module evidence (NVMe serial/model). An approved storage-module replacement may change exactly these signals (trust policy §11); a change to any other signal is an unapproved hardware change.';

create index hardware_manifest_signals_manifest_idx
  on kitluy_devices.hardware_manifest_signals (manifest_id);
-- Duplicate-signal detection (trust policy §8). Deliberately an INDEX, not a
-- UNIQUE constraint: a clone must be DETECTED and quarantined with an incident
-- record, not silently rejected by a constraint that leaves no evidence.
create index hardware_manifest_signals_lookup_idx
  on kitluy_devices.hardware_manifest_signals (signal_type, signal_value);

-- ---------------------------------------------------------------------------
-- kitluy_devices.manufacturing_enrollments — internal enrollment record.
-- ---------------------------------------------------------------------------
-- Trust policy §4: only an approved HET manufacturing/repair station may
-- enroll. Append-only; re-enrollment supersedes rather than edits.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.manufacturing_enrollments (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  hardware_manifest_id uuid not null references kitluy_devices.hardware_manifests (id),
  -- Monotonic per device. 1 = original manufacturing enrollment; >1 = governed
  -- re-enrollment after repair, replacement or quarantine clearance.
  enrollment_sequence integer not null,
  state kitluy_devices.enrollment_state not null default 'sealed',
  -- The device public-key FINGERPRINT — never the key, never a private key.
  -- Trust policy §4: "Raw device private keys are never copied into the Admin
  -- Portal or backed up as files." The device generates its own key pair; only
  -- the fingerprint of the PUBLIC key is recorded here.
  device_public_key_fingerprint text not null,
  public_key_algorithm text not null,
  -- Where the key lives. Stays [REQUIRED] until BLK-005 rules hardware-backed
  -- custody; a value of 'software' is an explicit, recorded weakness.
  key_storage_class text not null,
  enrollment_station_id text not null,
  enrollment_operator_ref text not null,
  enrollment_batch_ref text,
  -- Why this enrollment exists. Re-enrollment must say what it is repairing.
  enrollment_reason text not null,
  supersedes_enrollment_id uuid references kitluy_devices.manufacturing_enrollments (id),
  sealed_at timestamptz not null default now(),
  superseded_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  unique (device_id, enrollment_sequence),
  -- One SEALED enrollment per device at a time. This is the constraint that
  -- makes "current" meaningful.
  constraint manufacturing_enrollments_sequence_chk check (enrollment_sequence >= 1),
  constraint manufacturing_enrollments_fingerprint_format_chk
    check (device_public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint manufacturing_enrollments_key_storage_chk
    check (key_storage_class in ('software', 'tpm', 'secure_element', 'hsm')),
  constraint manufacturing_enrollments_superseded_consistency_chk
    check ((state = 'superseded') = (superseded_at is not null)),
  constraint manufacturing_enrollments_revoked_consistency_chk
    check ((state = 'revoked') = (revoked_at is not null)),
  constraint manufacturing_enrollments_first_has_no_predecessor_chk
    check ((enrollment_sequence = 1) = (supersedes_enrollment_id is null))
);

comment on table kitluy_devices.manufacturing_enrollments is
  'Owner: Fleet. Internal HET manufacturing/repair-station enrollment record (trust policy §4, §13 manufacturing_enrollments). Append-only: a repair or re-enrollment writes a NEW row that supersedes the previous one. Holds the device PUBLIC-key fingerprint only — private keys are never recorded, exported or copied, including from a damaged storage module. MC: A/O.';
comment on column kitluy_devices.manufacturing_enrollments.device_public_key_fingerprint is
  'SHA-256 fingerprint of the device PUBLIC key. The private key is generated on the device and never leaves it (trust policy §4). Nothing in KitLuy stores, backs up or transfers a device private key.';
comment on column kitluy_devices.manufacturing_enrollments.key_storage_class is
  'Where the device private key lives. `software` is an explicitly recorded weakness, permitted only for development enrollment. The production requirement is [REQUIRED: hardware-backed private-key custody (BLK-005)].';

-- Exactly one sealed enrollment per device.
create unique index manufacturing_enrollments_one_sealed_idx
  on kitluy_devices.manufacturing_enrollments (device_id)
  where state = 'sealed';

create index manufacturing_enrollments_fingerprint_idx
  on kitluy_devices.manufacturing_enrollments (device_public_key_fingerprint);

alter table kitluy_devices.devices
  add constraint devices_current_enrollment_fk
  foreign key (current_enrollment_id)
  references kitluy_devices.manufacturing_enrollments (id);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_hardware_observations — runtime evidence reports.
-- ---------------------------------------------------------------------------
-- What a device CLAIMS about itself later, checked against its sealed manifest.
-- Append-only, including the mismatch verdict. An observation never mutates a
-- device's identity; at most it quarantines the device.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_hardware_observations (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  compared_manifest_id uuid not null references kitluy_devices.hardware_manifests (id),
  observed_at timestamptz not null,
  observation_source text not null,
  -- Verdict, computed by record_hardware_observation_v1 and frozen.
  matched boolean not null,
  mismatched_signal_types kitluy_devices.hardware_signal_type[] not null default '{}',
  missing_signal_types kitluy_devices.hardware_signal_type[] not null default '{}',
  unexpected_signal_types kitluy_devices.hardware_signal_type[] not null default '{}',
  storage_module_only_change boolean not null default false,
  raised_incident_id uuid,
  created_at timestamptz not null default now(),
  constraint device_hardware_observations_source_chk
    check (observation_source in ('enrollment_station', 'hub_agent', 'support_tool', 'test_harness'))
);

comment on table kitluy_devices.device_hardware_observations is
  'Owner: Fleet. A later hardware-evidence report checked against the device''s sealed manifest. Append-only. A mismatch NEVER creates a different device identity and never edits the sealed manifest — it raises a trust incident and quarantines the existing device record (trust policy §3, §8). MC: A/O.';
comment on column kitluy_devices.device_hardware_observations.storage_module_only_change is
  'True when every mismatch is confined to storage-module signals. This is the signature of an NVMe replacement and routes to the approved replacement path (trust policy §11) rather than to clone suspicion — but it still quarantines until an authorized operator records the replacement.';

create index device_hardware_observations_device_idx
  on kitluy_devices.device_hardware_observations (device_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_trust_incidents — quarantine and clone defense.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_trust_incidents (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  incident_type kitluy_devices.trust_incident_type not null,
  severity text not null,
  detected_at timestamptz not null default now(),
  detected_by text not null,
  detail jsonb not null default '{}'::jsonb,
  -- Set only by a governed clearance; the incident row itself is never edited
  -- away, and clearing an incident does not by itself reactivate a device.
  cleared_at timestamptz,
  cleared_by_operator_ref text,
  clearance_reason text,
  clearing_enrollment_id uuid references kitluy_devices.manufacturing_enrollments (id),
  created_at timestamptz not null default now(),
  constraint device_trust_incidents_severity_chk
    check (severity in ('INFO', 'WARNING', 'CRITICAL')),
  constraint device_trust_incidents_clearance_consistency_chk
    check ((cleared_at is null) = (cleared_by_operator_ref is null))
);

comment on table kitluy_devices.device_trust_incidents is
  'Owner: Fleet. Quarantine and clone-defense record (trust policy §8, §13 device_trust_incidents). Append-only apart from the governed clearance columns. Clearing an incident records WHO cleared it and under WHICH re-enrollment; it never silently returns a device to service. MC: A/O + governed clearance.';

create index device_trust_incidents_device_idx
  on kitluy_devices.device_trust_incidents (device_id, detected_at desc);
create index device_trust_incidents_open_idx
  on kitluy_devices.device_trust_incidents (device_id)
  where cleared_at is null;

alter table kitluy_devices.device_hardware_observations
  add constraint device_hardware_observations_incident_fk
  foreign key (raised_incident_id)
  references kitluy_devices.device_trust_incidents (id);

-- ---------------------------------------------------------------------------
-- kitluy_devices.pki_trust_configuration — the BLK-005 gate.
-- ---------------------------------------------------------------------------
-- DELIBERATELY EMPTY. Not seeded by this migration, and not seedable by any
-- development fixture that ships in this repository.
--
-- Every column below is an owner/security decision listed in the BLK-005
-- ballot. Until BLK-005 is ruled AND the approved design is implemented and
-- independently reviewed, no row exists, and therefore no device can activate
-- and no certificate can be issued.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.pki_trust_configuration (
  id uuid primary key default gen_random_uuid(),
  environment text not null,
  -- BLK-005 ballot items 1-3: hierarchy, offline-root custody, intermediates.
  root_ca_reference text not null,
  device_issuing_ca_reference text not null,
  manufacturing_ca_reference text not null,
  -- BLK-005 ballot item 4: key generation and hardware-backed storage.
  required_key_storage_class text not null,
  -- BLK-005 ballot item 5: lifetimes, renewal, overlap.
  certificate_lifetime_days integer not null,
  renewal_window_days integer not null,
  overlap_window_days integer not null,
  -- BLK-005 ballot items 6 and 11: revocation and offline behaviour.
  revocation_mechanism text not null,
  offline_grace_hours integer not null,
  -- BLK-005 ballot item 7: purpose separation.
  configuration_signing_key_reference text not null,
  release_signing_key_reference text not null,
  transport_signing_key_reference text not null,
  -- Provenance. A configuration without an owner decision reference is not an
  -- approved configuration.
  approved_by_decision_ref text not null,
  approved_at timestamptz not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  constraint pki_trust_configuration_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint pki_trust_configuration_key_storage_chk
    check (required_key_storage_class in ('software', 'tpm', 'secure_element', 'hsm')),
  constraint pki_trust_configuration_lifetime_chk
    check (certificate_lifetime_days > 0 and renewal_window_days > 0
           and overlap_window_days >= 0
           and renewal_window_days < certificate_lifetime_days
           and overlap_window_days < certificate_lifetime_days),
  constraint pki_trust_configuration_offline_grace_chk
    check (offline_grace_hours >= 0),
  -- Purpose separation is structural, not advisory (trust policy §2, and the
  -- owner's "Do not reuse one certificate or signing key across these
  -- purposes"). Four references, all distinct.
  constraint pki_trust_configuration_key_separation_chk
    check (configuration_signing_key_reference <> release_signing_key_reference
       and configuration_signing_key_reference <> transport_signing_key_reference
       and release_signing_key_reference <> transport_signing_key_reference
       and device_issuing_ca_reference <> configuration_signing_key_reference
       and device_issuing_ca_reference <> release_signing_key_reference
       and device_issuing_ca_reference <> transport_signing_key_reference),
  -- Environment separation is structural too: one CA may not serve two
  -- environments (BLK-005 ballot item 1).
  constraint pki_trust_configuration_ca_separation_chk
    check (device_issuing_ca_reference <> manufacturing_ca_reference
       and device_issuing_ca_reference <> root_ca_reference
       and manufacturing_ca_reference <> root_ca_reference)
);

comment on table kitluy_devices.pki_trust_configuration is
  'Owner: Security. Approved PKI trust configuration per environment. DELIBERATELY EMPTY while BLK-005 is OPEN, and never seeded by a migration or development fixture. assert_pki_configuration_approved() fails closed against this table, so device activation and certificate issuance are unreachable until the owner rules BLK-005 and the approved design is implemented and independently reviewed. Holds REFERENCES to keys, never key material. MC: MUT (security-governed).';
comment on column kitluy_devices.pki_trust_configuration.root_ca_reference is
  'A REFERENCE (custody locator) to the offline root CA. No key material, no private key, no secret ever enters this table or this repository.';

create unique index pki_trust_configuration_one_active_per_env_idx
  on kitluy_devices.pki_trust_configuration (environment)
  where is_active;

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_certificates — certificate STATUS (DD).
-- ---------------------------------------------------------------------------
-- Status tracking only. Issuance is gated on BLK-005 and not implemented.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_certificates (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  enrollment_id uuid not null references kitluy_devices.manufacturing_enrollments (id),
  environment text not null,
  certificate_serial text not null,
  public_key_fingerprint text not null,
  issuer_reference text not null,
  status kitluy_devices.certificate_status not null default 'requested',
  issued_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  unique (environment, certificate_serial),
  constraint device_certificates_env_chk
    check (environment in ('development', 'pilot', 'production')),
  constraint device_certificates_fingerprint_format_chk
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint device_certificates_issued_consistency_chk
    check ((status = 'requested') = (issued_at is null)),
  constraint device_certificates_validity_chk
    check (issued_at is null or expires_at is null or expires_at > issued_at),
  constraint device_certificates_revoked_consistency_chk
    check ((status = 'revoked') = (revoked_at is not null))
);

comment on table kitluy_devices.device_certificates is
  'Owner: Fleet. Certificate lifecycle STATUS (DD kitluy_devices.device_certificates). Rows are created only by issue_device_certificate_v1, which is gated on BLK-005 and currently always fails closed. This table holds fingerprints and serials — never certificates, never keys. MC: MUT (state machine only).';

create index device_certificates_device_idx
  on kitluy_devices.device_certificates (device_id, created_at desc);
create unique index device_certificates_one_active_per_env_idx
  on kitluy_devices.device_certificates (device_id, environment)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_replacements — repair / NVMe / device replacement.
-- ---------------------------------------------------------------------------
-- Trust policy §11 and the owner's required replacement order:
--   old certificate revoked
--   old assignment generation invalidated
--   replacement recorded by authorized internal operator
--   new key pair generated
--   new certificate issued
--   new evidence captured
--   device reactivated through the normal approval flow
-- Private keys must not be copied from the damaged storage device.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_replacements (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  replacement_kind kitluy_devices.replacement_kind not null,
  -- For complete_device replacement the business record moves to a new device
  -- record; for storage_module/mainboard it stays on the same one.
  replacement_device_id uuid references kitluy_devices.devices (id),
  rma_case_ref text,
  reason_code text not null,
  -- The authorized internal operator. Trust policy §11: normal field operation
  -- does not permit unregistered replacement and silent reactivation.
  authorized_by_operator_ref text not null,
  authorized_at timestamptz not null default now(),
  -- The ordered preconditions, recorded as facts rather than assumed.
  prior_enrollment_id uuid not null references kitluy_devices.manufacturing_enrollments (id),
  prior_certificate_revoked boolean not null,
  prior_assignment_generation integer not null,
  prior_assignment_invalidated boolean not null,
  -- Explicit, recorded attestation that no private key was carried across.
  private_key_carried_over boolean not null default false,
  new_enrollment_id uuid references kitluy_devices.manufacturing_enrollments (id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  -- A replacement is never recorded as complete unless the old identity was
  -- actually torn down first.
  constraint device_replacements_preconditions_chk
    check (completed_at is null
           or (prior_certificate_revoked and prior_assignment_invalidated
               and new_enrollment_id is not null)),
  -- Structural refusal of the one thing that must never happen.
  constraint device_replacements_no_key_carryover_chk
    check (private_key_carried_over = false),
  constraint device_replacements_complete_device_target_chk
    check ((replacement_kind = 'complete_device') = (replacement_device_id is not null)),
  constraint device_replacements_no_self_target_chk
    check (replacement_device_id is null or replacement_device_id <> device_id)
);

comment on table kitluy_devices.device_replacements is
  'Owner: Fleet. Authorized repair/replacement record (trust policy §11, §13 rma_cases lineage). Records the owner-required order as FACTS: old certificate revoked, old assignment generation invalidated, replacement recorded by an authorized internal operator, new key pair generated, new evidence captured. A row cannot be completed unless those preconditions actually hold. MC: A/O + completion.';
comment on column kitluy_devices.device_replacements.private_key_carried_over is
  'Structurally pinned to false by device_replacements_no_key_carryover_chk. The owner requirement "Private keys must not be copied from the damaged storage device" is a database constraint here, not a convention: the replacement device generates a NEW key pair and a NEW enrollment.';

create index device_replacements_device_idx
  on kitluy_devices.device_replacements (device_id, authorized_at desc);

-- ---------------------------------------------------------------------------
-- kitluy_devices.device_lifecycle_events — append-only state-machine audit.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references kitluy_devices.devices (id),
  from_state kitluy_devices.device_lifecycle_state,
  to_state kitluy_devices.device_lifecycle_state not null,
  reason_code text not null,
  actor_ref text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table kitluy_devices.device_lifecycle_events is
  'Owner: Fleet. Append-only audit of every device lifecycle transition, including the transitions that were REFUSED at the BLK-005 gate. Corrections are new events (repository rule 11). MC: A/O.';

create index device_lifecycle_events_device_idx
  on kitluy_devices.device_lifecycle_events (device_id, occurred_at desc);

-- ===========================================================================
-- Functions
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- assert_pki_configuration_approved — THE BLK-005 GATE.
-- ---------------------------------------------------------------------------
-- Called FIRST by every path that would establish cryptographic trust. While
-- pki_trust_configuration holds no active row for the environment, this raises
-- an explicit required-value error naming BLK-005.
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
  where environment = p_environment
    and is_active;

  if not found then
    raise exception
      'KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: approved PKI trust configuration for environment %] — BLK-005 (PKI root/CA design, HSM/secure-element model, certificate windows) is OPEN. Device activation, certificate issuance, key custody and production signing are refused until the owner rules BLK-005 and the approved design is implemented, tested and independently reviewed.',
      p_environment
      using errcode = 'P0001',
            hint = 'Resolve BLK-005 via the owner/security ballot at docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md. No migration, fixture or agent may insert into kitluy_devices.pki_trust_configuration in its place.';
  end if;

  return v_config;
end;
$$;

comment on function kitluy_devices.assert_pki_configuration_approved(text) is
  'The BLK-005 fail-closed gate. Raises an explicit [REQUIRED: ...] error while no approved PKI trust configuration exists for the environment. Every path that would establish cryptographic trust calls this FIRST.';

-- ---------------------------------------------------------------------------
-- normalize_hardware_signal — presentation differences are not tamper.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.normalize_hardware_signal(
  p_value text
) returns text
language sql
immutable
as $$
  select lower(btrim(p_value));
$$;

comment on function kitluy_devices.normalize_hardware_signal(text) is
  'Trims and lower-cases a hardware signal so that formatting differences (upper-case MAC, padded serial) are not misread as a tamper signal.';

-- ---------------------------------------------------------------------------
-- is_storage_module_signal — which signals an NVMe swap may legitimately move.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.is_storage_module_signal(
  p_signal_type kitluy_devices.hardware_signal_type
) returns boolean
language sql
immutable
as $$
  select p_signal_type in ('storage_serial', 'storage_model');
$$;

comment on function kitluy_devices.is_storage_module_signal(kitluy_devices.hardware_signal_type) is
  'Storage-module evidence per trust policy §11: exactly the signals an approved NVMe replacement is expected to change.';

-- ---------------------------------------------------------------------------
-- record_lifecycle_event — internal.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_lifecycle_event(
  p_device_id uuid,
  p_from kitluy_devices.device_lifecycle_state,
  p_to kitluy_devices.device_lifecycle_state,
  p_reason_code text,
  p_actor_ref text,
  p_detail jsonb default '{}'::jsonb
) returns uuid
language sql
as $$
  insert into kitluy_devices.device_lifecycle_events
    (device_id, from_state, to_state, reason_code, actor_ref, detail)
  values (p_device_id, p_from, p_to, p_reason_code, p_actor_ref, coalesce(p_detail, '{}'::jsonb))
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- seal_hardware_manifest — compute the change-detection digest server-side.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.seal_hardware_manifest(
  p_manifest_id uuid
) returns text
language plpgsql
as $$
declare
  v_digest text;
  v_count integer;
  v_sealed timestamptz;
begin
  select sealed_at into v_sealed
  from kitluy_devices.hardware_manifests
  where id = p_manifest_id
  for update;

  if not found then
    raise exception 'KLUY-DEVICE-MANIFEST-MISSING: manifest % does not exist', p_manifest_id
      using errcode = 'P0001';
  end if;

  if v_sealed is not null then
    raise exception 'KLUY-DEVICE-MANIFEST-SEALED: manifest % is already sealed; capture a new manifest instead', p_manifest_id
      using errcode = 'P0001';
  end if;

  -- Deterministic over the SORTED signal set. Computed here, from the stored
  -- rows, so a caller cannot assert a manifest it did not present.
  select
    encode(sha256(convert_to(coalesce(string_agg(line, E'\n' order by line), ''), 'UTF8')), 'hex'),
    count(*)
  into v_digest, v_count
  from (
    select s.signal_type::text || '=' || s.signal_value as line
    from kitluy_devices.hardware_manifest_signals s
    where s.manifest_id = p_manifest_id
  ) ordered;

  if v_count = 0 then
    raise exception 'KLUY-DEVICE-MANIFEST-EMPTY: manifest % carries no hardware evidence; an empty manifest is not evidence', p_manifest_id
      using errcode = 'P0001';
  end if;

  update kitluy_devices.hardware_manifests
  set manifest_sha256 = v_digest,
      signal_count = v_count,
      sealed_at = now()
  where id = p_manifest_id;

  return v_digest;
end;
$$;

comment on function kitluy_devices.seal_hardware_manifest(uuid) is
  'Freezes a hardware manifest and computes its change-detection digest over the sorted signal set. The digest is computed from STORED rows, never accepted from a caller. It is not an identifier.';

-- ---------------------------------------------------------------------------
-- enroll_device_v1 — manufacturing enrollment (trust policy §4).
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
  v_duplicate_count integer;
begin
  select * into v_profile
  from kitluy_devices.hardware_profiles
  where id = p_hardware_profile_id;

  if not found then
    raise exception 'KLUY-DEVICE-PROFILE-MISSING: hardware profile % does not exist', p_hardware_profile_id
      using errcode = 'P0001';
  end if;

  if not v_profile.is_active or v_profile.certification_status = 'WITHDRAWN' then
    raise exception 'KLUY-DEVICE-PROFILE-INACTIVE: hardware profile % is % and cannot be enrolled against',
      v_profile.profile_key, v_profile.certification_status
      using errcode = 'P0001';
  end if;

  if jsonb_typeof(p_signals) is distinct from 'array' or jsonb_array_length(p_signals) = 0 then
    raise exception 'KLUY-DEVICE-EVIDENCE-MISSING: enrollment requires a non-empty hardware evidence array; unregistered hardware cannot enroll (trust policy §14)'
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.devices
    (asset_tag, hardware_profile_id, device_class, lifecycle_state, manufactured_at)
  values
    (p_asset_tag, p_hardware_profile_id, v_profile.device_class, 'manufactured', p_manufactured_at)
  returning id into v_device_id;

  insert into kitluy_devices.hardware_manifests
    (device_id, captured_at, captured_by_station)
  values
    (v_device_id, now(), p_enrollment_station_id)
  returning id into v_manifest_id;

  insert into kitluy_devices.hardware_manifest_signals
    (manifest_id, signal_type, signal_value, is_storage_module)
  select
    v_manifest_id,
    (element ->> 'signal_type')::kitluy_devices.hardware_signal_type,
    kitluy_devices.normalize_hardware_signal(element ->> 'signal_value'),
    kitluy_devices.is_storage_module_signal((element ->> 'signal_type')::kitluy_devices.hardware_signal_type)
  from jsonb_array_elements(p_signals) as element;

  -- The profile's evidence contract is enforced, not assumed.
  select array_agg(distinct s.signal_type) into v_present
  from kitluy_devices.hardware_manifest_signals s
  where s.manifest_id = v_manifest_id;

  foreach v_required in array v_profile.required_signal_types loop
    if not (v_required = any (coalesce(v_present, '{}'::kitluy_devices.hardware_signal_type[]))) then
      raise exception 'KLUY-DEVICE-EVIDENCE-INCOMPLETE: hardware profile % requires signal % which the enrollment did not present',
        v_profile.profile_key, v_required
        using errcode = 'P0001';
    end if;
  end loop;

  perform kitluy_devices.seal_hardware_manifest(v_manifest_id);

  insert into kitluy_devices.manufacturing_enrollments
    (device_id, hardware_manifest_id, enrollment_sequence, state,
     device_public_key_fingerprint, public_key_algorithm, key_storage_class,
     enrollment_station_id, enrollment_operator_ref, enrollment_batch_ref,
     enrollment_reason)
  values
    (v_device_id, v_manifest_id, 1, 'sealed',
     lower(p_device_public_key_fingerprint), p_public_key_algorithm, p_key_storage_class,
     p_enrollment_station_id, p_enrollment_operator_ref, p_enrollment_batch_ref,
     p_enrollment_reason)
  returning id into v_enrollment_id;

  update kitluy_devices.devices
  set current_enrollment_id = v_enrollment_id,
      lifecycle_state = 'enrolled',
      updated_at = now()
  where id = v_device_id;

  perform kitluy_devices.record_lifecycle_event(
    v_device_id, 'manufactured', 'enrolled', p_enrollment_reason, p_enrollment_operator_ref,
    jsonb_build_object('enrollment_id', v_enrollment_id, 'manifest_id', v_manifest_id));

  -- Duplicate-signal detection (trust policy §8). Detected and RECORDED, never
  -- silently rejected — a clone that leaves no evidence is the failure mode.
  select count(*) into v_duplicate_count
  from kitluy_devices.hardware_manifest_signals mine
  join kitluy_devices.hardware_manifest_signals other
    on other.signal_type = mine.signal_type
   and other.signal_value = mine.signal_value
   and other.manifest_id <> mine.manifest_id
  join kitluy_devices.hardware_manifests om on om.id = other.manifest_id
  where mine.manifest_id = v_manifest_id
    and om.device_id <> v_device_id
    and not kitluy_devices.is_storage_module_signal(mine.signal_type);

  if v_duplicate_count > 0 then
    perform kitluy_devices.quarantine_device_v1(
      v_device_id,
      'duplicate_hardware_signal',
      'CRITICAL',
      p_enrollment_station_id,
      format('%s non-storage hardware signal(s) already belong to another enrolled device', v_duplicate_count),
      jsonb_build_object('duplicate_signal_count', v_duplicate_count));
  end if;

  return v_device_id;
end;
$$;

comment on function kitluy_devices.enroll_device_v1 is
  'Manufacturing/repair-station enrollment (trust policy §4). Creates the immutable device record, captures and seals the hardware-evidence manifest, records the PUBLIC-key fingerprint, and moves manufactured -> enrolled. Enrolled is NOT active: activation additionally requires approved PKI configuration (BLK-005) and is currently unreachable. A device presenting non-storage hardware signals that already belong to another device is enrolled AND immediately quarantined, so the clone leaves evidence.';

-- ---------------------------------------------------------------------------
-- quarantine_device_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.quarantine_device_v1(
  p_device_id uuid,
  p_incident_type kitluy_devices.trust_incident_type,
  p_severity text,
  p_detected_by text,
  p_reason text,
  p_detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql
as $$
declare
  v_state kitluy_devices.device_lifecycle_state;
  v_incident_id uuid;
begin
  select lifecycle_state into v_state
  from kitluy_devices.devices
  where id = p_device_id
  for update;

  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is % and cannot be quarantined', p_device_id, v_state
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_trust_incidents
    (device_id, incident_type, severity, detected_by, detail)
  values
    (p_device_id, p_incident_type, p_severity, p_detected_by,
     coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('reason', p_reason))
  returning id into v_incident_id;

  if v_state <> 'quarantined' then
    update kitluy_devices.devices
    set lifecycle_state = 'quarantined',
        quarantined_at = now(),
        quarantine_reason = p_reason,
        updated_at = now()
    where id = p_device_id;

    perform kitluy_devices.record_lifecycle_event(
      p_device_id, v_state, 'quarantined', p_incident_type::text, p_detected_by,
      jsonb_build_object('incident_id', v_incident_id, 'reason', p_reason));
  end if;

  return v_incident_id;
end;
$$;

comment on function kitluy_devices.quarantine_device_v1 is
  'Quarantines a device and records the trust incident (trust policy §8). Quarantine never creates a new device identity — that is the whole point: the existing record is held for governed investigation rather than being silently replaced by an unrelated one.';

-- ---------------------------------------------------------------------------
-- record_hardware_observation_v1 — evidence check, never identity mutation.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_hardware_observation_v1(
  p_device_id uuid,
  p_signals jsonb,
  p_observation_source text,
  p_observed_at timestamptz default now()
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_manifest_id uuid;
  v_mismatched kitluy_devices.hardware_signal_type[];
  v_missing kitluy_devices.hardware_signal_type[];
  v_unexpected kitluy_devices.hardware_signal_type[];
  v_storage_only boolean;
  v_matched boolean;
  v_observation_id uuid;
  v_incident_id uuid;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_device.current_enrollment_id is null then
    raise exception 'KLUY-DEVICE-NOT-ENROLLED: device % has no sealed enrollment to compare evidence against', p_device_id
      using errcode = 'P0001';
  end if;

  select hardware_manifest_id into v_manifest_id
  from kitluy_devices.manufacturing_enrollments
  where id = v_device.current_enrollment_id;

  with observed as (
    select
      (element ->> 'signal_type')::kitluy_devices.hardware_signal_type as signal_type,
      kitluy_devices.normalize_hardware_signal(element ->> 'signal_value') as signal_value
    from jsonb_array_elements(p_signals) as element
  ),
  enrolled as (
    select signal_type, signal_value
    from kitluy_devices.hardware_manifest_signals
    where manifest_id = v_manifest_id
  )
  select
    -- present on both sides but with a different value
    coalesce(array_agg(distinct t.signal_type)
      filter (where t.kind = 'mismatch'), '{}'::kitluy_devices.hardware_signal_type[]),
    coalesce(array_agg(distinct t.signal_type)
      filter (where t.kind = 'missing'), '{}'::kitluy_devices.hardware_signal_type[]),
    coalesce(array_agg(distinct t.signal_type)
      filter (where t.kind = 'unexpected'), '{}'::kitluy_devices.hardware_signal_type[])
  into v_mismatched, v_missing, v_unexpected
  from (
    select e.signal_type, 'mismatch' as kind
    from enrolled e
    where exists (select 1 from observed o where o.signal_type = e.signal_type)
      and not exists (select 1 from observed o
                      where o.signal_type = e.signal_type and o.signal_value = e.signal_value)
    union all
    select e.signal_type, 'missing'
    from enrolled e
    where not exists (select 1 from observed o where o.signal_type = e.signal_type)
    union all
    select o.signal_type, 'unexpected'
    from observed o
    where not exists (select 1 from enrolled e where e.signal_type = o.signal_type)
  ) t;

  v_matched := (cardinality(v_mismatched) = 0
                and cardinality(v_missing) = 0
                and cardinality(v_unexpected) = 0);

  -- Storage-module-only change is the NVMe-replacement signature. It still
  -- quarantines; it only routes the investigation (trust policy §11).
  v_storage_only := (not v_matched)
    and cardinality(v_missing) = 0
    and cardinality(v_unexpected) = 0
    and not exists (
      select 1 from unnest(v_mismatched) as st
      where not kitluy_devices.is_storage_module_signal(st));

  insert into kitluy_devices.device_hardware_observations
    (device_id, compared_manifest_id, observed_at, observation_source, matched,
     mismatched_signal_types, missing_signal_types, unexpected_signal_types,
     storage_module_only_change)
  values
    (p_device_id, v_manifest_id, p_observed_at, p_observation_source, v_matched,
     v_mismatched, v_missing, v_unexpected, v_storage_only)
  returning id into v_observation_id;

  if not v_matched then
    -- A changed signal quarantines the device and requires governed
    -- re-enrollment. It NEVER creates an unrelated device identity, and it
    -- never edits the sealed manifest to make the mismatch disappear.
    v_incident_id := kitluy_devices.quarantine_device_v1(
      p_device_id,
      (case when v_storage_only then 'storage_module_changed'
            else 'hardware_signal_mismatch' end)::kitluy_devices.trust_incident_type,
      case when v_storage_only then 'WARNING' else 'CRITICAL' end,
      p_observation_source,
      case when v_storage_only
           then 'storage-module evidence changed; requires an authorized replacement record and governed re-enrollment'
           else 'hardware evidence no longer matches the sealed enrollment manifest' end,
      jsonb_build_object(
        'observation_id', v_observation_id,
        'mismatched', to_jsonb(v_mismatched),
        'missing', to_jsonb(v_missing),
        'unexpected', to_jsonb(v_unexpected)));

    update kitluy_devices.device_hardware_observations
    set raised_incident_id = v_incident_id
    where id = v_observation_id;
  end if;

  return v_observation_id;
end;
$$;

comment on function kitluy_devices.record_hardware_observation_v1 is
  'Checks a later hardware-evidence report against the device''s sealed enrollment manifest. A mismatch quarantines the EXISTING device record and requires governed re-enrollment (owner instruction; trust policy §3). It never mints a new identity, never edits the sealed manifest, and never silently accepts the change. A mismatch confined to storage-module signals is flagged as the NVMe-replacement signature and routed to the approved replacement path — it is still quarantined.';

-- ---------------------------------------------------------------------------
-- reenroll_device_v1 — governed re-enrollment out of quarantine.
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
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_device.lifecycle_state not in ('quarantined', 'enrolled', 'suspended') then
    raise exception 'KLUY-DEVICE-REENROLL-STATE: device % is %; re-enrollment applies to quarantined, enrolled or suspended devices',
      p_device_id, v_device.lifecycle_state
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

  -- A re-enrollment that reuses the prior key is not a re-enrollment. Trust
  -- policy §11: recovery generates a NEW key; nothing is copied across.
  if lower(p_device_public_key_fingerprint) = v_prior.device_public_key_fingerprint then
    raise exception 'KLUY-DEVICE-KEY-REUSE: re-enrollment must present a NEW device key pair; the prior public-key fingerprint was presented again'
      using errcode = 'P0001',
            hint = 'Private keys are never copied from a damaged storage device. Generate a new key pair on the device.';
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

  -- Open incidents are CLEARED explicitly, with an operator and a reason, and
  -- linked to the enrollment that cleared them. They are never deleted.
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
      updated_at = now()
  where id = p_device_id;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, 'enrolled', p_enrollment_reason, p_enrollment_operator_ref,
    jsonb_build_object('enrollment_id', v_enrollment_id,
                       'supersedes', v_prior.id,
                       'replacement_id', p_replacement_id));

  if p_replacement_id is not null then
    update kitluy_devices.device_replacements
    set new_enrollment_id = v_enrollment_id,
        completed_at = now()
    where id = p_replacement_id;
  end if;

  return v_enrollment_id;
end;
$$;

comment on function kitluy_devices.reenroll_device_v1 is
  'Governed re-enrollment. Captures new evidence, supersedes the prior enrollment, clears open incidents WITH an operator and reason, and returns the device to `enrolled` — never straight to `active`. Refuses a re-enrollment that presents the prior public-key fingerprint again, because that is the signature of a copied key rather than a new key pair.';

-- ---------------------------------------------------------------------------
-- retire_device_v1
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.retire_device_v1(
  p_device_id uuid,
  p_reason_code text,
  p_actor_ref text
) returns void
language plpgsql
as $$
declare
  v_state kitluy_devices.device_lifecycle_state;
begin
  select lifecycle_state into v_state
  from kitluy_devices.devices where id = p_device_id for update;

  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is already %', p_device_id, v_state
      using errcode = 'P0001';
  end if;

  update kitluy_devices.manufacturing_enrollments
  set state = 'revoked', revoked_at = now(), revocation_reason = p_reason_code
  where device_id = p_device_id and state = 'sealed';

  update kitluy_devices.devices
  set lifecycle_state = 'retired',
      retired_at = now(),
      quarantined_at = null,
      quarantine_reason = null,
      updated_at = now()
  where id = p_device_id;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_state, 'retired', p_reason_code, p_actor_ref, '{}'::jsonb);
end;
$$;

comment on function kitluy_devices.retire_device_v1 is
  'Retires a device and revokes its sealed enrollment. Terminal: the historical audit, enrollment, manifest and incident records all remain (trust policy §10 "Historical audit and asset records remain").';

-- ---------------------------------------------------------------------------
-- record_device_replacement_v1 — the authorized replacement record.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_device_replacement_v1(
  p_device_id uuid,
  p_replacement_kind kitluy_devices.replacement_kind,
  p_reason_code text,
  p_authorized_by_operator_ref text,
  p_rma_case_ref text default null,
  p_replacement_device_id uuid default null
) returns uuid
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_enrollment_id uuid;
  v_replacement_id uuid;
  v_revoked integer := 0;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  if v_device.lifecycle_state in ('retired', 'replaced') then
    raise exception 'KLUY-DEVICE-TERMINAL: device % is % and cannot be replaced', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  v_enrollment_id := v_device.current_enrollment_id;
  if v_enrollment_id is null then
    raise exception 'KLUY-DEVICE-NOT-ENROLLED: device % has no enrollment to replace', p_device_id
      using errcode = 'P0001';
  end if;

  -- Owner-required order, step 1: old certificate revoked.
  update kitluy_devices.device_certificates
  set status = 'revoked', revoked_at = now(), revocation_reason = p_reason_code
  where device_id = p_device_id and status = 'active';
  get diagnostics v_revoked = row_count;

  insert into kitluy_devices.device_replacements
    (device_id, replacement_kind, replacement_device_id, rma_case_ref, reason_code,
     authorized_by_operator_ref, prior_enrollment_id, prior_certificate_revoked,
     prior_assignment_generation, prior_assignment_invalidated,
     private_key_carried_over)
  values
    (p_device_id, p_replacement_kind, p_replacement_device_id, p_rma_case_ref, p_reason_code,
     p_authorized_by_operator_ref, v_enrollment_id, true,
     v_device.assignment_generation, true,
     -- Owner requirement, enforced structurally by
     -- device_replacements_no_key_carryover_chk as well as here.
     false)
  returning id into v_replacement_id;

  -- Owner-required order, step 2: old assignment generation invalidated.
  -- Generation 0 means "no valid assignment"; T002 issues the next one.
  update kitluy_devices.devices
  set assignment_generation = 0,
      updated_at = now()
  where id = p_device_id;

  -- The device is held, not silently reactivated (trust policy §11).
  if v_device.lifecycle_state <> 'quarantined' then
    perform kitluy_devices.quarantine_device_v1(
      p_device_id, 'manual_quarantine', 'WARNING', p_authorized_by_operator_ref,
      format('awaiting governed re-enrollment after %s replacement', p_replacement_kind),
      jsonb_build_object('replacement_id', v_replacement_id));
  end if;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, 'quarantined', 'REPLACEMENT_RECORDED',
    p_authorized_by_operator_ref,
    jsonb_build_object('replacement_id', v_replacement_id,
                       'certificates_revoked', v_revoked,
                       'prior_assignment_generation', v_device.assignment_generation));

  return v_replacement_id;
end;
$$;

comment on function kitluy_devices.record_device_replacement_v1 is
  'Records an authorized internal replacement in the owner-required order: revoke the old certificate, invalidate the old assignment generation, record the replacement against a named operator, and HOLD the device in quarantine. Reactivation happens only through reenroll_device_v1 (new key pair, new evidence) followed by the normal approval flow. No private key is ever carried across — that is pinned false by a check constraint, not by convention.';

-- ---------------------------------------------------------------------------
-- issue_device_certificate_v1 — BLK-005 GATED.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.issue_device_certificate_v1(
  p_device_id uuid,
  p_environment text,
  p_certificate_serial text,
  p_public_key_fingerprint text,
  p_actor_ref text
) returns uuid
language plpgsql
as $$
declare
  v_config kitluy_devices.pki_trust_configuration;
  v_device kitluy_devices.devices;
  v_enrollment kitluy_devices.manufacturing_enrollments;
  v_certificate_id uuid;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  -- THE GATE. First statement that matters. There is no path around it.
  v_config := kitluy_devices.assert_pki_configuration_approved(p_environment);

  select * into v_enrollment
  from kitluy_devices.manufacturing_enrollments
  where id = v_device.current_enrollment_id and state = 'sealed';

  if not found then
    raise exception 'KLUY-DEVICE-NOT-ENROLLED: device % has no sealed enrollment; certificates are issued against enrollment evidence', p_device_id
      using errcode = 'P0001';
  end if;

  if v_enrollment.key_storage_class <> v_config.required_key_storage_class then
    raise exception 'KLUY-DEVICE-KEY-STORAGE: environment % requires key storage class %, enrollment presented %',
      p_environment, v_config.required_key_storage_class, v_enrollment.key_storage_class
      using errcode = 'P0001';
  end if;

  insert into kitluy_devices.device_certificates
    (device_id, enrollment_id, environment, certificate_serial, public_key_fingerprint,
     issuer_reference, status, issued_at, expires_at)
  values
    (p_device_id, v_enrollment.id, p_environment, p_certificate_serial,
     lower(p_public_key_fingerprint), v_config.device_issuing_ca_reference,
     'active', now(), now() + make_interval(days => v_config.certificate_lifetime_days))
  returning id into v_certificate_id;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, v_device.lifecycle_state, v_device.lifecycle_state,
    'CERTIFICATE_ISSUED', p_actor_ref,
    jsonb_build_object('certificate_id', v_certificate_id, 'environment', p_environment));

  return v_certificate_id;
end;
$$;

comment on function kitluy_devices.issue_device_certificate_v1 is
  'BLK-005 GATED. Records an issued certificate''s status. It does NOT implement a CA, does not generate keys and does not sign anything — the actual issuance mechanism is blocked on BLK-005. While pki_trust_configuration is empty this function always fails closed with an explicit required-value error.';

-- ---------------------------------------------------------------------------
-- activate_device_v1 — BLK-005 GATED.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.activate_device_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text
) returns void
language plpgsql
as $$
declare
  v_device kitluy_devices.devices;
  v_open_incidents integer;
begin
  select * into v_device from kitluy_devices.devices where id = p_device_id for update;
  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  -- NOTE ON REFUSAL EVIDENCE. A refusal record cannot be written here. Raising
  -- rolls back everything this function did, including any audit row, so an
  -- in-function "record then raise" would produce evidence that never survives
  -- the case it exists to document. (WS-10 hit the same shape in
  -- verifySnapshot: a throw that erased the rejection it was reporting.)
  -- Durable refusal evidence is therefore the CALLER's responsibility, through
  -- record_activation_refusal_v1 in a separate transaction.

  -- THE GATE, before any state check, so that "activation is blocked" is the
  -- answer regardless of how healthy the device looks.
  perform kitluy_devices.assert_pki_configuration_approved(p_environment);

  if v_device.lifecycle_state <> 'enrolled' then
    raise exception 'KLUY-DEVICE-ACTIVATION-STATE: device % is %; only an enrolled device activates', p_device_id, v_device.lifecycle_state
      using errcode = 'P0001';
  end if;

  -- `activation_blocked` is excluded: it records that the PLATFORM was blocked
  -- (BLK-005), not that the DEVICE is suspect. Counting it would mean that
  -- resolving BLK-005 left every device permanently un-activatable by the
  -- evidence of having been blocked.
  select count(*) into v_open_incidents
  from kitluy_devices.device_trust_incidents
  where device_id = p_device_id
    and cleared_at is null
    and incident_type <> 'activation_blocked';

  if v_open_incidents > 0 then
    raise exception 'KLUY-DEVICE-OPEN-INCIDENT: device % has % open trust incident(s); activation requires governed clearance', p_device_id, v_open_incidents
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from kitluy_devices.device_certificates
    where device_id = p_device_id and environment = p_environment and status = 'active'
  ) then
    raise exception 'KLUY-DEVICE-NO-CERTIFICATE: device % has no active % certificate; activation is certificate-backed (KLD-2026-07-21-003)', p_device_id, p_environment
      using errcode = 'P0001';
  end if;

  update kitluy_devices.devices
  set lifecycle_state = 'active', updated_at = now()
  where id = p_device_id;

  -- The blocker record is closed by the event that disproves it.
  update kitluy_devices.device_trust_incidents
  set cleared_at = now(),
      cleared_by_operator_ref = p_actor_ref,
      clearance_reason = 'ACTIVATION_SUCCEEDED'
  where device_id = p_device_id
    and incident_type = 'activation_blocked'
    and cleared_at is null;

  perform kitluy_devices.record_lifecycle_event(
    p_device_id, 'enrolled', 'active', 'ACTIVATED', p_actor_ref,
    jsonb_build_object('environment', p_environment));
end;
$$;

comment on function kitluy_devices.activate_device_v1 is
  'BLK-005 GATED, and the gate runs BEFORE every other check so the refusal reason is always the missing cryptographic configuration rather than an incidental state problem. Activation is certificate-backed per the OWNER-LOCKED provisioning chain (Digital Store -> registered Store Hub hardware -> certificate-backed activation -> Location assignment -> terminal assignment -> signed configuration -> offline local authority). Currently unreachable, by design. Refusal evidence is recorded by the caller through record_activation_refusal_v1, because a raise inside this function would roll back its own audit row.';

-- ---------------------------------------------------------------------------
-- record_activation_refusal_v1 — durable evidence of a blocked activation.
-- ---------------------------------------------------------------------------
-- Called by the operations layer from its EXCEPTION handler, in a NEW
-- transaction, so the refusal outlives the transaction that was rolled back.
-- A blocked programme that leaves no trace of being blocked looks like a
-- programme nobody tried to run.
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.record_activation_refusal_v1(
  p_device_id uuid,
  p_environment text,
  p_actor_ref text,
  p_refusal_code text,
  p_refusal_message text
) returns uuid
language plpgsql
as $$
declare
  v_state kitluy_devices.device_lifecycle_state;
  v_event_id uuid;
begin
  select lifecycle_state into v_state
  from kitluy_devices.devices where id = p_device_id;

  if not found then
    raise exception 'KLUY-DEVICE-MISSING: device % does not exist', p_device_id
      using errcode = 'P0001';
  end if;

  v_event_id := kitluy_devices.record_lifecycle_event(
    p_device_id, v_state, v_state, 'ACTIVATION_REFUSED', p_actor_ref,
    jsonb_build_object(
      'environment', p_environment,
      'refusal_code', p_refusal_code,
      'refusal_message', p_refusal_message));

  -- A PKI refusal is also a fleet-visible blocker, not just a log line.
  if p_refusal_code = 'KLUY-DEVICE-PKI-UNCONFIGURED'
     and v_state not in ('retired', 'replaced')
     and not exists (
       select 1 from kitluy_devices.device_trust_incidents
       where device_id = p_device_id
         and incident_type = 'activation_blocked'
         and cleared_at is null) then
    insert into kitluy_devices.device_trust_incidents
      (device_id, incident_type, severity, detected_by, detail)
    values
      (p_device_id, 'activation_blocked', 'INFO', p_actor_ref,
       jsonb_build_object('environment', p_environment,
                          'refusal_code', p_refusal_code,
                          'blocker', 'BLK-005'));
  end if;

  return v_event_id;
end;
$$;

comment on function kitluy_devices.record_activation_refusal_v1 is
  'Records durable evidence that an activation was refused. Deliberately separate from activate_device_v1 and called from the caller''s exception handler in a NEW transaction: an in-function audit row would be rolled back by the same raise it is documenting. An activation blocked on BLK-005 also opens an INFO activation_blocked incident, so the blocker is visible in the fleet view rather than only in an error the operator saw once.';

-- ===========================================================================
-- Triggers — immutability and the lifecycle state machine
-- ===========================================================================

create or replace function kitluy_devices.enforce_device_identity_immutable()
returns trigger
language plpgsql
as $$
begin
  -- The device_record_id and its manufacturing facts are the identity. They do
  -- not change, ever, for any reason, including repair and replacement.
  if new.id is distinct from old.id
     or new.device_class is distinct from old.device_class
     or new.hardware_profile_id is distinct from old.hardware_profile_id
     or new.manufactured_at is distinct from old.manufactured_at
     or new.created_at is distinct from old.created_at then
    raise exception
      'KLUY-DEVICE-IDENTITY-IMMUTABLE: the device record id, class, hardware profile and manufacturing facts are immutable; repair and replacement create new ENROLLMENT records, not new identities'
      using errcode = 'P0001';
  end if;

  if old.lifecycle_state in ('retired', 'replaced')
     and new.lifecycle_state is not distinct from old.lifecycle_state
     and new is distinct from old then
    raise exception
      'KLUY-DEVICE-TERMINAL: device % is % and its record is frozen', old.id, old.lifecycle_state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

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
    when 'manufactured' then new.lifecycle_state in ('enrolled', 'quarantined', 'retired')
    when 'enrolled'     then new.lifecycle_state in ('active', 'quarantined', 'suspended', 'retired', 'replaced')
    when 'active'       then new.lifecycle_state in ('suspended', 'quarantined', 'retired', 'replaced')
    when 'suspended'    then new.lifecycle_state in ('active', 'enrolled', 'quarantined', 'retired', 'replaced')
    when 'quarantined'  then new.lifecycle_state in ('enrolled', 'retired', 'replaced')
    -- Terminal.
    when 'retired'      then false
    when 'replaced'     then false
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
  'The enrollment / quarantine / retirement / replacement state machine, enforced in the database rather than trusted to callers. `retired` and `replaced` are terminal. Note that legality here is necessary but not sufficient for activation: enrolled -> active is legal in this matrix and still refused by the BLK-005 gate in activate_device_v1.';

create or replace function kitluy_devices.enforce_manifest_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-MANIFEST-IMMUTABLE: hardware evidence is never deleted'
      using errcode = 'P0001';
  end if;

  if old.sealed_at is not null then
    raise exception
      'KLUY-DEVICE-MANIFEST-IMMUTABLE: manifest % is sealed; capture a NEW manifest through governed re-enrollment instead of editing captured evidence', old.id
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_signal_immutable()
returns trigger
language plpgsql
as $$
declare
  v_sealed timestamptz;
begin
  select sealed_at into v_sealed
  from kitluy_devices.hardware_manifests
  where id = coalesce(new.manifest_id, old.manifest_id);

  if v_sealed is not null then
    raise exception
      'KLUY-DEVICE-SIGNAL-IMMUTABLE: the evidence in a sealed manifest cannot be added to, edited or removed'
      using errcode = 'P0001';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function kitluy_devices.enforce_enrollment_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-ENROLLMENT-IMMUTABLE: enrollment history is never deleted'
      using errcode = 'P0001';
  end if;

  -- Only the state-closing columns move. What was enrolled cannot be rewritten.
  if new.device_id is distinct from old.device_id
     or new.hardware_manifest_id is distinct from old.hardware_manifest_id
     or new.enrollment_sequence is distinct from old.enrollment_sequence
     or new.device_public_key_fingerprint is distinct from old.device_public_key_fingerprint
     or new.public_key_algorithm is distinct from old.public_key_algorithm
     or new.key_storage_class is distinct from old.key_storage_class
     or new.enrollment_station_id is distinct from old.enrollment_station_id
     or new.enrollment_operator_ref is distinct from old.enrollment_operator_ref
     or new.supersedes_enrollment_id is distinct from old.supersedes_enrollment_id
     or new.sealed_at is distinct from old.sealed_at then
    raise exception
      'KLUY-DEVICE-ENROLLMENT-IMMUTABLE: a sealed enrollment records what a station actually observed; only its state may close'
      using errcode = 'P0001';
  end if;

  if old.state <> 'sealed' and new.state <> old.state then
    raise exception
      'KLUY-DEVICE-ENROLLMENT-CLOSED: enrollment % is already %', old.id, old.state
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_observation_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-OBSERVATION-IMMUTABLE: an evidence report is never deleted'
      using errcode = 'P0001';
  end if;

  -- The verdict is frozen. Only the incident back-reference is filled in.
  if new.device_id is distinct from old.device_id
     or new.compared_manifest_id is distinct from old.compared_manifest_id
     or new.observed_at is distinct from old.observed_at
     or new.matched is distinct from old.matched
     or new.mismatched_signal_types is distinct from old.mismatched_signal_types
     or new.missing_signal_types is distinct from old.missing_signal_types
     or new.unexpected_signal_types is distinct from old.unexpected_signal_types
     or new.storage_module_only_change is distinct from old.storage_module_only_change then
    raise exception
      'KLUY-DEVICE-OBSERVATION-IMMUTABLE: the comparison verdict is frozen; a later report is a NEW observation row'
      using errcode = 'P0001';
  end if;

  if old.raised_incident_id is not null
     and new.raised_incident_id is distinct from old.raised_incident_id then
    raise exception
      'KLUY-DEVICE-OBSERVATION-IMMUTABLE: the raised incident reference is written once'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_incident_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-DEVICE-INCIDENT-IMMUTABLE: a trust incident is never deleted; clearance is recorded, not erased'
      using errcode = 'P0001';
  end if;

  if new.device_id is distinct from old.device_id
     or new.incident_type is distinct from old.incident_type
     or new.detected_at is distinct from old.detected_at
     or new.detected_by is distinct from old.detected_by
     or new.detail is distinct from old.detail then
    raise exception
      'KLUY-DEVICE-INCIDENT-IMMUTABLE: what was detected cannot be rewritten; only the governed clearance may be added'
      using errcode = 'P0001';
  end if;

  if old.cleared_at is not null and new.cleared_at is distinct from old.cleared_at then
    raise exception
      'KLUY-DEVICE-INCIDENT-CLEARED: incident % was already cleared at %', old.id, old.cleared_at
      using errcode = 'P0001';
  end if;

  -- Clearance must name an operator. An anonymous clearance is not a clearance.
  if new.cleared_at is not null and coalesce(btrim(new.cleared_by_operator_ref), '') = '' then
    raise exception
      'KLUY-DEVICE-INCIDENT-CLEARANCE-ANONYMOUS: clearing a trust incident requires a named operator'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function kitluy_devices.enforce_pki_configuration_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-DEVICE-PKI-IMMUTABLE: an approved PKI trust configuration is retired by deactivation, not deletion'
      using errcode = 'P0001';
  end if;

  -- Every field here is an owner/security decision. Approving one by editing a
  -- row in place would lose which decision approved which configuration.
  if tg_op = 'UPDATE' and (
       new.environment is distinct from old.environment
    or new.root_ca_reference is distinct from old.root_ca_reference
    or new.device_issuing_ca_reference is distinct from old.device_issuing_ca_reference
    or new.manufacturing_ca_reference is distinct from old.manufacturing_ca_reference
    or new.required_key_storage_class is distinct from old.required_key_storage_class
    or new.certificate_lifetime_days is distinct from old.certificate_lifetime_days
    or new.renewal_window_days is distinct from old.renewal_window_days
    or new.overlap_window_days is distinct from old.overlap_window_days
    or new.revocation_mechanism is distinct from old.revocation_mechanism
    or new.offline_grace_hours is distinct from old.offline_grace_hours
    or new.configuration_signing_key_reference is distinct from old.configuration_signing_key_reference
    or new.release_signing_key_reference is distinct from old.release_signing_key_reference
    or new.transport_signing_key_reference is distinct from old.transport_signing_key_reference
    or new.approved_by_decision_ref is distinct from old.approved_by_decision_ref
    or new.approved_at is distinct from old.approved_at) then
    raise exception
      'KLUY-DEVICE-PKI-IMMUTABLE: an approved PKI configuration is superseded by a NEW approved row, never edited in place'
      using errcode = 'P0001';
  end if;

  -- A configuration that cannot name the decision that approved it is not an
  -- approved configuration. This is what stops a fixture from faking the gate
  -- open with placeholder text.
  if coalesce(btrim(new.approved_by_decision_ref), '') = ''
     or new.approved_by_decision_ref ~* '\[REQUIRED'
     or new.approved_by_decision_ref ~* '^(tbd|todo|placeholder|test|unknown|n/?a)$' then
    raise exception
      'KLUY-DEVICE-PKI-UNAPPROVED: approved_by_decision_ref must name the owner/security decision that approved this configuration; BLK-005 is the open ballot'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function kitluy_devices.enforce_pki_configuration_governed() is
  'Keeps the BLK-005 gate honest. An approved PKI configuration must name the decision that approved it, is superseded rather than edited, and is retired by deactivation rather than deletion. Placeholder decision references are refused so a development fixture cannot fake the gate open.';

create trigger trg_devices_identity_immutable
  before update on kitluy_devices.devices
  for each row execute function kitluy_devices.enforce_device_identity_immutable();

create trigger trg_devices_lifecycle_transition
  before update on kitluy_devices.devices
  for each row execute function kitluy_devices.enforce_device_lifecycle_transition();

create trigger trg_devices_append_only_delete
  before delete on kitluy_devices.devices
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_hardware_manifests_immutable
  before update or delete on kitluy_devices.hardware_manifests
  for each row execute function kitluy_devices.enforce_manifest_immutable();

create trigger trg_hardware_manifest_signals_immutable
  before insert or update or delete on kitluy_devices.hardware_manifest_signals
  for each row execute function kitluy_devices.enforce_signal_immutable();

create trigger trg_manufacturing_enrollments_append_only
  before update or delete on kitluy_devices.manufacturing_enrollments
  for each row execute function kitluy_devices.enforce_enrollment_append_only();

create trigger trg_device_hardware_observations_append_only
  before update or delete on kitluy_devices.device_hardware_observations
  for each row execute function kitluy_devices.enforce_observation_append_only();

create trigger trg_device_trust_incidents_append_only
  before update or delete on kitluy_devices.device_trust_incidents
  for each row execute function kitluy_devices.enforce_incident_append_only();

create trigger trg_pki_trust_configuration_governed
  before insert or update or delete on kitluy_devices.pki_trust_configuration
  for each row execute function kitluy_devices.enforce_pki_configuration_governed();

create trigger trg_device_lifecycle_events_append_only
  before update or delete on kitluy_devices.device_lifecycle_events
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_device_replacements_append_only
  before delete on kitluy_devices.device_replacements
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- Fleet status projection (read model).
-- ---------------------------------------------------------------------------
create or replace view kitluy_devices.device_fleet_status as
select
  d.id as device_record_id,
  d.asset_tag,
  d.device_class,
  d.lifecycle_state,
  d.assignment_generation,
  hp.profile_key,
  e.enrollment_sequence,
  e.device_public_key_fingerprint,
  e.key_storage_class,
  m.manifest_sha256,
  m.signal_count,
  (select count(*) from kitluy_devices.device_trust_incidents ti
    where ti.device_id = d.id and ti.cleared_at is null) as open_incident_count,
  (select max(o.observed_at) from kitluy_devices.device_hardware_observations o
    where o.device_id = d.id) as last_observed_at,
  (select c.status from kitluy_devices.device_certificates c
    where c.device_id = d.id and c.status = 'active' limit 1) as certificate_status,
  -- Honest about WHY a device is not active, rather than implying it could be.
  case
    when d.lifecycle_state = 'active' then 'ACTIVE'
    when d.lifecycle_state in ('retired', 'replaced') then upper(d.lifecycle_state::text)
    when d.lifecycle_state = 'quarantined' then 'QUARANTINED'
    when not exists (select 1 from kitluy_devices.pki_trust_configuration p where p.is_active)
      then 'BLOCKED_PKI_UNCONFIGURED'
    else 'AWAITING_ACTIVATION'
  end as fleet_status
from kitluy_devices.devices d
join kitluy_devices.hardware_profiles hp on hp.id = d.hardware_profile_id
left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
left join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id;

comment on view kitluy_devices.device_fleet_status is
  'Fleet status read model. Reports BLOCKED_PKI_UNCONFIGURED rather than implying a device is merely awaiting activation while BLK-005 is open — a fleet view that hides the blocker is how a blocked programme looks finished.';

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE, fail-closed. ZERO anon policies, ZERO client writes.
-- ---------------------------------------------------------------------------
-- Device identity, hardware evidence and PKI configuration are platform-internal
-- (HET fleet operations). No tenant-scoped SELECT policy is granted here: these
-- rows are not tenant data and a Partner has no read interest in another
-- Partner's hardware evidence. Tenant-visible device status arrives with the
-- assignment model in WS-11-T002, scoped by assignment.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.hardware_profiles enable row level security;
alter table kitluy_devices.hardware_profiles force row level security;
alter table kitluy_devices.devices enable row level security;
alter table kitluy_devices.devices force row level security;
alter table kitluy_devices.hardware_manifests enable row level security;
alter table kitluy_devices.hardware_manifests force row level security;
alter table kitluy_devices.hardware_manifest_signals enable row level security;
alter table kitluy_devices.hardware_manifest_signals force row level security;
alter table kitluy_devices.manufacturing_enrollments enable row level security;
alter table kitluy_devices.manufacturing_enrollments force row level security;
alter table kitluy_devices.device_hardware_observations enable row level security;
alter table kitluy_devices.device_hardware_observations force row level security;
alter table kitluy_devices.device_trust_incidents enable row level security;
alter table kitluy_devices.device_trust_incidents force row level security;
alter table kitluy_devices.device_certificates enable row level security;
alter table kitluy_devices.device_certificates force row level security;
alter table kitluy_devices.pki_trust_configuration enable row level security;
alter table kitluy_devices.pki_trust_configuration force row level security;
alter table kitluy_devices.device_replacements enable row level security;
alter table kitluy_devices.device_replacements force row level security;
alter table kitluy_devices.device_lifecycle_events enable row level security;
alter table kitluy_devices.device_lifecycle_events force row level security;

grant usage on schema kitluy_devices to service_role;
grant select, insert, update on all tables in schema kitluy_devices to service_role;

-- The fleet/manufacturing surface is service-role only for now. `authenticated`
-- receives schema usage but no table grants and no policies, so every client
-- read fails closed until WS-11-T002 defines assignment-scoped visibility.
grant usage on schema kitluy_devices to authenticated;

-- ---------------------------------------------------------------------------
-- PUBLIC EXECUTE revocation.
-- ---------------------------------------------------------------------------
-- PostgreSQL grants EXECUTE to PUBLIC at function creation time, and a later
-- GRANT to a specific role does NOT undo it. WS-10 found every Hub procedure
-- callable by any role for exactly this reason (Hub migration 0020); the same
-- mistake is not repeated here. Trigger functions are unaffected — trigger
-- execution does not check EXECUTE privilege.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    execute format('revoke all on function %s from public', r.signature);
    execute format('grant execute on function %s to service_role', r.signature);
  end loop;
end $$;

commit;
