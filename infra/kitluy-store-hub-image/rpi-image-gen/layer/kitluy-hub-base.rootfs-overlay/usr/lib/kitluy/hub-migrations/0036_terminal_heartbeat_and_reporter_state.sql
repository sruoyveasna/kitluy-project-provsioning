-- kitluy:hub:migration:0036
-- ===========================================================================
-- KitLuy Store Hub local database — terminal heartbeat sequencing and the
-- fleet health reporter's relational state.
--
-- WS-11-T005-P02 (owner package 2026-08-06). Authority: §2 owner-locked
-- timing (heartbeat 15 s; healthy <=45 s; degraded <=90 s; report cadence
-- 30 s; kh1.{health_report_id}.1 effect key); Store Hub spec §12.5/§16;
-- cloud groups 0177/0178 (the ingestion door and its per-device
-- report_sequence contract); hub group 0035 (the current-status table this
-- group extends ADDITIVELY — the applied 0035 file is never edited).
--
-- WHY A NEW GROUP: the reporter must derive state from RELATIONAL authority,
-- not process memory (restart recovery), and the cloud door refuses a
-- report_sequence that does not advance — so the per-terminal heartbeat
-- cursor, the per-terminal report counter, the cadence marker and the
-- append-only report evidence all need durable homes. The heartbeat
-- sequence check here is deliberately MONOTONIC-GREATER, not the strict +1
-- succession of edge_sync.accept_terminal_command: a lost telemetry
-- heartbeat must not brick the stream, while a replayed or conflicting one
-- must not overwrite the current observation. Recorded as a deliberate
-- divergence, the pairing-replication discipline.
--
-- TIME: liveness authority is the Hub database's now() captured in the
-- accepting transaction; the terminal-observed timestamp is diagnostic only
-- and never orders anything.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Reporter state columns on the current-status authority (additive).
-- ---------------------------------------------------------------------------
alter table edge_hardware.terminal_health_status
  add column if not exists last_heartbeat_sequence bigint not null default 0,
  add column if not exists report_sequence bigint not null default 0,
  add column if not exists last_reported_state text null,
  add column if not exists last_projection_sent_at timestamptz null;

comment on column edge_hardware.terminal_health_status.last_heartbeat_sequence is
  'WS-11-T005-P02. Highest ACCEPTED terminal heartbeat sequence. Monotonic-greater by trigger: equal = duplicate (one business effect), lower = replay (refused), a gap is tolerated telemetry loss — deliberately NOT the strict +1 of accept_terminal_command.';
comment on column edge_hardware.terminal_health_status.report_sequence is
  'WS-11-T005-P02. Per-terminal cloud report counter — the value the 0177 door stores as projection_version. Only ever advances.';
comment on column edge_hardware.terminal_health_status.last_reported_state is
  'WS-11-T005-P02. The derived_state carried by the LAST emitted report, so a restart cannot re-emit the same material transition.';
comment on column edge_hardware.terminal_health_status.last_projection_sent_at is
  'WS-11-T005-P02. When the last projection report was enqueued (owner cadence: at least every 30 s while locally known).';

alter table edge_hardware.terminal_health_status
  add constraint terminal_health_status_sequences_ck
    check (last_heartbeat_sequence >= 0 and report_sequence >= 0);

-- Schema backstop for the monotonic contract: even a defective writer cannot
-- move either sequence backwards.
create or replace function edge_hardware.terminal_health_sequences_forward_only()
returns trigger
language plpgsql
as $$
begin
  if new.last_heartbeat_sequence < old.last_heartbeat_sequence then
    raise exception 'KLUY-EDGE-HEARTBEAT-SEQUENCE-BACKWARDS: % does not advance %',
      new.last_heartbeat_sequence, old.last_heartbeat_sequence
      using errcode = 'P0001';
  end if;
  if new.report_sequence < old.report_sequence then
    raise exception 'KLUY-EDGE-REPORT-SEQUENCE-BACKWARDS: % does not advance %',
      new.report_sequence, old.report_sequence
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger terminal_health_status_sequences_forward
  before update on edge_hardware.terminal_health_status
  for each row execute function edge_hardware.terminal_health_sequences_forward_only();

-- ---------------------------------------------------------------------------
-- 2. Append-only report evidence — the outbox event's relational identity.
-- ---------------------------------------------------------------------------
create table edge_hardware.terminal_health_report (
  id                  uuid        primary key,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  report_sequence     bigint      not null,
  derived_state       text        not null,
  from_state          text        null,
  material            boolean     not null,
  health_reasons      text[]      not null default '{}',
  last_heartbeat_at   timestamptz null,
  observed_at         timestamptz not null,
  software_version    text        null,
  release_version     text        null,
  configuration_version text      null,
  containment_state   text        not null,
  credential_eligible boolean     not null,
  correlation_id      uuid        not null,
  created_at          timestamptz not null,
  constraint terminal_health_report_state_ck
    check (derived_state in ('healthy', 'degraded', 'offline_local', 'unknown')),
  constraint terminal_health_report_from_ck
    check (from_state is null
           or from_state in ('healthy', 'degraded', 'offline_local', 'unknown')),
  constraint terminal_health_report_sequence_ck
    check (report_sequence >= 1),
  constraint terminal_health_report_reasons_ck
    check (cardinality(health_reasons) <= 32),
  constraint terminal_health_report_dedupe_uq
    unique (terminal_device_id, report_sequence)
);

comment on table edge_hardware.terminal_health_report is
  'WS-11-T005-P02. Append-only evidence of every fleet projection report this Hub minted. The row id IS the outbox business identity (effect key kh1.{id}.1, event device_fleet.health_projection_reported v1); report_sequence is what the cloud stores as projection_version, so restart recovery re-reads THIS table, never process memory. MC: A/O.';

create index edge_hardware_terminal_health_report_scope_idx
  on edge_hardware.terminal_health_report (tenant_id, digital_store_id, location_id);

comment on index edge_hardware.edge_hardware_terminal_health_report_scope_idx is
  'Schema-contract §8 scope index.';

create or replace function edge_hardware.terminal_health_report_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_hardware.terminal_health_report', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger terminal_health_report_append_only
  before update or delete on edge_hardware.terminal_health_report
  for each row execute function edge_hardware.terminal_health_report_append_only();

grant select, insert on edge_hardware.terminal_health_report to kitluy_hub_runtime;
grant select on edge_hardware.terminal_health_report to kitluy_sync_worker;

-- DEFECT FIX (found by the pairing-replication suite): the 0035 containment
-- gate trigger runs as the INSERTING identity, and the pairing door executes
-- as its NOLOGIN governor — which held no SELECT on the directive log, so
-- every governed pairing failed 42501 the moment 0035 landed. The gate reads
-- are granted to the pairing governor here; the write boundary is unchanged.
grant select on edge_identity.containment_directive to kitluy_pairing_governor;
grant select on edge_identity.effective_containment to kitluy_pairing_governor;

-- ---------------------------------------------------------------------------
-- 3. Guard.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'edge_hardware'
                    and table_name = 'terminal_health_status'
                    and column_name = 'report_sequence') then
    raise exception 'KLUY-HUB-MIGRATION-0036: the reporter state columns are missing';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_hardware'
                    and indexname = 'edge_hardware_terminal_health_report_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0036: the report scope index is missing';
  end if;
  if (select count(*) from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal
        and t.tgname in ('terminal_health_status_sequences_forward',
                         'terminal_health_report_append_only')) <> 2 then
    raise exception 'KLUY-HUB-MIGRATION-0036: the sequence/append-only triggers are missing';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0036: terminal heartbeat sequencing and reporter state installed';
end
$guard$;
