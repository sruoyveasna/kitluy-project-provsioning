-- kitluy:hub:migration:0002
-- ===========================================================================
-- KitLuy Store Hub local database — edge_identity (§6.1, 7 relations).
--
-- Naming: SINGULAR, binding for every Hub-local relation (reconciliation R1).
-- Scope: Appendix A scope columns (tenant_id, digital_store_id, location_id)
-- on every business relation. hub_device, hub_installation and
-- device_credential are DEVICE-GLOBAL — they exist before assignment and
-- survive re-assignment, so §1's scoping rule exempts them.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_identity.hub_device — device-global.
-- ---------------------------------------------------------------------------
create table edge_identity.hub_device (
  id                        uuid        primary key,
  asset_number              text        not null unique,
  device_kind               text        not null,
  lifecycle_status          text        not null,
  trust_status              text        not null,
  board_serial_hash         char(64)    not null,
  factory_duid_hash         char(64)    not null,
  root_key_fingerprint      char(64)    not null,
  manufacturing_cert_serial text        not null,
  created_at                timestamptz not null,
  updated_at                timestamptz not null,
  constraint hub_device_kind_ck check (device_kind = 'store_hub'),
  constraint hub_device_trust_ck check (trust_status in ('trusted', 'quarantined', 'revoked')),
  constraint hub_device_board_hash_ck check (board_serial_hash ~ '^[0-9a-f]{64}$'),
  constraint hub_device_duid_hash_ck check (factory_duid_hash ~ '^[0-9a-f]{64}$'),
  constraint hub_device_root_key_ck check (root_key_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table edge_identity.hub_device is
  'Store Hub appliance identity (§6.1). Device-global: no scope columns, because a Hub exists before and across Location assignment. Hashes are lowercase hex SHA-256 (§1).';

-- ---------------------------------------------------------------------------
-- edge_identity.hub_installation — device-global.
-- ---------------------------------------------------------------------------
create table edge_identity.hub_installation (
  id                      uuid        primary key,
  hub_device_id           uuid        not null references edge_identity.hub_device (id),
  installation_generation integer     not null,
  nvme_serial_hash        char(64)    not null,
  nvme_model              text        not null,
  nvme_capacity_bytes     bigint      not null,
  os_release_id           text        not null,
  os_image_sha256         char(64)    not null,
  secure_boot_generation  integer     not null,
  storage_key_generation  integer     not null,
  installed_at            timestamptz not null,
  status                  text        not null,
  constraint hub_installation_generation_uq unique (hub_device_id, installation_generation),
  constraint hub_installation_generation_ck check (installation_generation >= 1)
);

comment on table edge_identity.hub_installation is
  'One NVMe/OS installation generation of a Hub (§6.1). A reimage creates a new generation; backups are keyed per installation generation (§11).';

-- ---------------------------------------------------------------------------
-- edge_identity.hub_assignment — carries the scope tuple it establishes.
-- ---------------------------------------------------------------------------
create table edge_identity.hub_assignment (
  id                      uuid        primary key,
  hub_device_id           uuid        not null references edge_identity.hub_device (id),
  tenant_id               uuid        not null,
  digital_store_id        uuid        not null,
  location_id             uuid        not null,
  assignment_generation   integer     not null,
  assigned_at             timestamptz not null,
  ended_at                timestamptz null,
  status                  text        not null,
  operational_cert_serial text        not null,
  constraint hub_assignment_generation_uq unique (hub_device_id, assignment_generation),
  constraint hub_assignment_generation_ck check (assignment_generation >= 1),
  constraint hub_assignment_window_ck check (ended_at is null or ended_at >= assigned_at)
);

comment on table edge_identity.hub_assignment is
  'Location assignment of a Hub (§6.1). "Exactly one active assignment per Hub" is enforced by the partial unique index in 0012. assignment_generation is the first element of the ordering namespace (location_id, assignment_generation, hub_sequence) — offline contract §5.1.';

-- ---------------------------------------------------------------------------
-- edge_identity.device_credential — device-global.
-- ---------------------------------------------------------------------------
create table edge_identity.device_credential (
  id                     uuid        primary key,
  device_id              uuid        not null,
  credential_type        text        not null,
  public_key_fingerprint char(64)    not null,
  certificate_serial     text        not null unique,
  issuer                 text        not null,
  issued_at              timestamptz not null,
  expires_at             timestamptz not null,
  status                 text        not null,
  revoked_at             timestamptz null,
  revocation_reason      text        null,
  rotation_generation    integer     not null,
  constraint device_credential_window_ck check (expires_at > issued_at),
  constraint device_credential_revocation_ck
    check ((status <> 'revoked') or (revoked_at is not null and revocation_reason is not null))
);

comment on table edge_identity.device_credential is
  'Certificate/key material METADATA for Hub and terminal devices (§6.1). No private key, password or secret is ever stored here (repository rule 4). device_id is a plain uuid because it may reference a Hub or a terminal.';

-- ---------------------------------------------------------------------------
-- edge_identity.terminal_device — scoped.
-- ---------------------------------------------------------------------------
create table edge_identity.terminal_device (
  id                   uuid        primary key,
  tenant_id            uuid        not null,
  digital_store_id     uuid        not null,
  location_id          uuid        not null,
  terminal_name        text        not null,
  hardware_profile_id  uuid        not null,
  installation_id      uuid        not null,
  certificate_serial   text        not null,
  assignment_generation integer    not null,
  lifecycle_status     text        not null,
  last_client_sequence bigint      not null default 0,
  last_seen_at         timestamptz not null,
  created_at           timestamptz not null,
  updated_at           timestamptz not null,
  constraint terminal_device_name_uq unique (location_id, terminal_name),
  constraint terminal_device_sequence_ck check (last_client_sequence >= 0)
);

comment on table edge_identity.terminal_device is
  'T1-T4 terminal registration (§6.1). last_client_sequence is the terminal sequence record locked by the acceptance algorithm (offline contract §4) and is the {client_sequence} half of the kl1 idempotency key (§2).';
comment on column edge_identity.terminal_device.last_client_sequence is
  'Highest accepted client_sequence for this terminal. A reimage produces a NEW terminal_device row (new installation identity), never a reset of this counter (offline contract §2 rule 4).';

-- ---------------------------------------------------------------------------
-- edge_identity.terminal_session — scoped.
-- ---------------------------------------------------------------------------
create table edge_identity.terminal_session (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  actor_id            uuid        not null,
  profile_code        text        not null,
  opened_at           timestamptz not null,
  expires_at          timestamptz not null,
  closed_at           timestamptz null,
  session_generation  integer     not null,
  last_event_sequence bigint      not null default 0,
  status              text        not null,
  constraint terminal_session_window_ck check (expires_at > opened_at),
  constraint terminal_session_sequence_ck check (last_event_sequence >= 0)
);

comment on table edge_identity.terminal_session is
  'Staff session on a terminal profile (§6.1). "A terminal can have one active staff session per profile" is enforced by the partial unique index in 0012. profile_code uses the canonical dotted logical profiles laundry.t1.intake_cashier / t2.customer_display / t3.ready_scan_in / t4.pickup_scan_out (KLD-2026-07-26-002 Group 2).';

-- ---------------------------------------------------------------------------
-- edge_identity.staff_cache — scoped, PK is the cloud actor id.
-- ---------------------------------------------------------------------------
create table edge_identity.staff_cache (
  actor_id                    uuid        primary key,
  tenant_id                   uuid        not null,
  digital_store_id            uuid        not null,
  location_id                 uuid        not null,
  display_name                text        not null,
  credential_verifier         bytea       not null,
  permission_snapshot_version bigint      not null,
  profile_codes               text[]      not null default '{}',
  offline_valid_until         timestamptz not null,
  disabled                    boolean     not null default false,
  last_synced_at              timestamptz not null
);

comment on table edge_identity.staff_cache is
  'Offline-capable actor projection (§6.1). Identity truth is CLOUD; this is a cache. Business relations therefore keep actor_id as a plain uuid with no FK: audit/custody retention (§10, entire Location retention) must not depend on cache retention.';
comment on column edge_identity.staff_cache.credential_verifier is
  'One-way verifier, encrypted at rest (§6.1). Never a password, never a reversible secret.';
