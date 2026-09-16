-- kitluy:hub:migration:0010
-- ===========================================================================
-- KitLuy Store Hub local database — edge_hardware (§6.9, 2 relations).
-- Companion contract: kitluy-hardware-compatibility-matrix-phase1-v1.0.0.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- edge_hardware.peripheral_observation
-- ---------------------------------------------------------------------------
create table edge_hardware.peripheral_observation (
  id                    uuid                         primary key,
  tenant_id             uuid                         not null,
  digital_store_id      uuid                         not null,
  location_id           uuid                         not null,
  peripheral_binding_id uuid                         not null
                        references edge_config.peripheral_binding (id),
  observed_at           timestamptz                  not null,
  health_state          edge_hardware.health_state   not null,
  firmware_version      text                         null,
  driver_version        text                         not null,
  connection_state      text                         not null,
  capabilities_hash     char(64)                     not null,
  details_json          jsonb                        not null default '{}'::jsonb,
  terminal_device_id    uuid                         null
                        references edge_identity.terminal_device (id),
  constraint peripheral_observation_hash_ck check (capabilities_hash ~ '^[0-9a-f]{64}$')
);

comment on table edge_hardware.peripheral_observation is
  'Observed peripheral health (§6.9). The shared profile gate (terminal profile contract §3.7) requires healthy peripherals or an approved waiver before a profile opens.';

-- ---------------------------------------------------------------------------
-- edge_hardware.device_heartbeat
-- ---------------------------------------------------------------------------
create table edge_hardware.device_heartbeat (
  id                      uuid           primary key,
  tenant_id               uuid           not null,
  digital_store_id        uuid           not null,
  location_id             uuid           not null,
  device_id               uuid           not null,
  device_kind             text           not null,
  observed_at             timestamptz    not null,
  application_version     text           not null,
  config_snapshot_version bigint         not null,
  uptime_seconds          bigint         not null,
  cpu_temperature_c       numeric(5,2)   null,
  disk_free_bytes         bigint         null,
  lan_state               text           not null,
  wan_state               text           not null,
  last_hub_sequence       bigint         null,
  health_state            text           not null,
  details_json            jsonb          not null default '{}'::jsonb,
  constraint device_heartbeat_uptime_ck check (uptime_seconds >= 0),
  constraint device_heartbeat_disk_ck check (disk_free_bytes is null or disk_free_bytes >= 0),
  constraint device_heartbeat_sequence_ck check (last_hub_sequence is null or last_hub_sequence >= 0)
);

comment on table edge_hardware.device_heartbeat is
  'Device liveness and capacity telemetry (§6.9). device_id is a plain uuid because a heartbeat may come from the Hub itself or from any terminal. cpu_temperature_c is numeric(5,2) — a MEASUREMENT, never money; §1 forbids floating point for money and quantities alike, so no float/real/double column exists anywhere in this database. Retention: 30 days raw, then summarized (§10).';
