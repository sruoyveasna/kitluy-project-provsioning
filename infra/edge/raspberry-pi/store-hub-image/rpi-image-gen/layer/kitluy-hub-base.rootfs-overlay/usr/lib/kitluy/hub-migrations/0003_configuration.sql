-- kitluy:hub:migration:0003
-- ===========================================================================
-- KitLuy Store Hub local database — edge_config (§6.2, 6 relations).
--
-- §1: "Configuration: immutable signed snapshots; one active snapshot per
-- Location". Immutability is enforced by the append-only trigger on
-- configuration_snapshot content in 0012; the activation lifecycle lives in
-- configuration_activation, which is the audit trail of switches.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_config.configuration_snapshot — scoped.
-- ---------------------------------------------------------------------------
create table edge_config.configuration_snapshot (
  id                  uuid                          primary key,
  tenant_id           uuid                          not null,
  digital_store_id    uuid                          not null,
  location_id         uuid                          not null,
  snapshot_version    bigint                        not null,
  schema_version      integer                       not null,
  created_at          timestamptz                   not null,
  not_before          timestamptz                   not null,
  expires_at          timestamptz                   null,
  minimum_hub_version text                          not null,
  maximum_hub_version text                          null,
  manifest_sha256     char(64)                      not null,
  signature_algorithm text                          not null,
  signature           bytea                         not null,
  signing_key_id      text                          not null,
  state               edge_config.activation_state  not null,
  downloaded_at       timestamptz                   not null,
  activated_at        timestamptz                   null,
  constraint configuration_snapshot_version_uq unique (location_id, snapshot_version),
  constraint configuration_snapshot_version_ck check (snapshot_version >= 1),
  constraint configuration_snapshot_manifest_ck check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint configuration_snapshot_expiry_ck check (expires_at is null or expires_at > not_before),
  constraint configuration_snapshot_active_ck
    check (state <> 'active' or activated_at is not null)
);

comment on table edge_config.configuration_snapshot is
  'Immutable signed configuration projection from cloud (§6.2). One ACTIVE snapshot per Location — partial unique index in 0012. The signature and manifest hash are verified before activation; no unsigned snapshot may reach state=active.';

-- ---------------------------------------------------------------------------
-- edge_config.configuration_section — snapshot-scoped (no separate scope
-- columns in the canonical column list; scope is inherited from the parent
-- snapshot, which is the immutable unit).
-- ---------------------------------------------------------------------------
create table edge_config.configuration_section (
  id               uuid    primary key,
  snapshot_id      uuid    not null references edge_config.configuration_snapshot (id),
  section_code     text    not null,
  section_version  bigint  not null,
  content_sha256   char(64) not null,
  content_json     jsonb   not null,
  required         boolean not null,
  validation_state text    not null,
  validation_error text    null,
  constraint configuration_section_code_uq unique (snapshot_id, section_code),
  constraint configuration_section_hash_ck check (content_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table edge_config.configuration_section is
  'One signed section of a snapshot (§6.2). Scope is inherited from snapshot_id; the canonical column list defines no separate scope columns, and duplicating them would allow a section to disagree with its snapshot.';

-- ---------------------------------------------------------------------------
-- edge_config.configuration_activation — scoped, append-only audit of
-- configuration switches.
-- ---------------------------------------------------------------------------
create table edge_config.configuration_activation (
  id                   uuid        primary key,
  tenant_id            uuid        not null,
  digital_store_id     uuid        not null,
  location_id          uuid        not null,
  snapshot_id          uuid        not null references edge_config.configuration_snapshot (id),
  previous_snapshot_id uuid        null references edge_config.configuration_snapshot (id),
  started_at           timestamptz not null,
  completed_at         timestamptz null,
  result               text        not null,
  health_check_json    jsonb       not null default '{}'::jsonb,
  rollback_reason      text        null,
  actor_type           text        not null,
  actor_id             uuid        null,
  constraint configuration_activation_window_ck check (completed_at is null or completed_at >= started_at)
);

comment on table edge_config.configuration_activation is
  'All-or-nothing activation record (§6.2, §12 acceptance test 7). Retains the previous snapshot id so a rollback never guesses what was active.';

-- ---------------------------------------------------------------------------
-- edge_config.terminal_profile_assignment — scoped.
-- ---------------------------------------------------------------------------
create table edge_config.terminal_profile_assignment (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  profile_code       text        not null,
  assignment_version bigint      not null,
  enabled            boolean     not null,
  effective_from     timestamptz not null,
  effective_until    timestamptz null,
  source_snapshot_id uuid        not null references edge_config.configuration_snapshot (id),
  constraint terminal_profile_assignment_window_ck
    check (effective_until is null or effective_until > effective_from)
);

comment on table edge_config.terminal_profile_assignment is
  'Cloud-assigned logical profile grants (§6.2; terminal profile contract §2 "Installer cannot self-select profiles"). Unique ACTIVE assignment per (terminal_device_id, profile_code) — partial unique index in 0012. Values are the canonical dotted profiles laundry.t1.intake_cashier, laundry.t2.customer_display, laundry.t3.ready_scan_in, laundry.t4.pickup_scan_out.';

-- ---------------------------------------------------------------------------
-- edge_config.hardware_profile — device-global reference data.
-- ---------------------------------------------------------------------------
create table edge_config.hardware_profile (
  id                       uuid        primary key,
  profile_code             text        not null unique,
  device_class             text        not null,
  manufacturer             text        not null,
  model                    text        not null,
  hardware_revision        text        not null,
  interface_type           text        not null,
  driver_id                text        not null,
  driver_version           text        not null,
  capabilities_json        jsonb       not null default '{}'::jsonb,
  certification_status     text        not null,
  certification_evidence_id text       null,
  minimum_hub_version      text        not null,
  created_at               timestamptz not null,
  retired_at               timestamptz null
);

comment on table edge_config.hardware_profile is
  'Certified peripheral catalogue (§6.2). Device-global reference data: the same profile applies across Tenants, so it carries no scope columns.';

-- ---------------------------------------------------------------------------
-- edge_config.peripheral_binding — scoped.
-- ---------------------------------------------------------------------------
create table edge_config.peripheral_binding (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  hardware_profile_id uuid        not null references edge_config.hardware_profile (id),
  logical_role        text        not null,
  connection_uri      text        not null,
  terminal_device_id  uuid        null references edge_identity.terminal_device (id),
  fallback_priority   smallint    not null,
  enabled             boolean     not null,
  source_snapshot_id  uuid        not null references edge_config.configuration_snapshot (id),
  last_validated_at   timestamptz not null,
  constraint peripheral_binding_role_uq unique (location_id, logical_role, fallback_priority),
  constraint peripheral_binding_priority_ck check (fallback_priority >= 0)
);

comment on table edge_config.peripheral_binding is
  'Location peripheral wiring (§6.2). connection_uri is a LAN/USB device address; it must never carry credentials (repository rule 4).';
