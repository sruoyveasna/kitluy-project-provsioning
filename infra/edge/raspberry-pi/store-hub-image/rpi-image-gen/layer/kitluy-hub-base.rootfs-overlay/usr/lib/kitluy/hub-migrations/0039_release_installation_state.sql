-- kitluy:hub:migration:0039
-- ===========================================================================
-- KitLuy Store Hub local database — durable A/B release installation state.
--
-- WS-11-T006-P04 (KLD-2026-08-06-WS11-T006-001 §6 — LOCKED health gate:
-- 5-minute window, 20-second probes, 3 consecutive successes, ONE automatic
-- rollback, failed_rolled_back terminal for automatic retry). Authority:
-- release policy §9; hub group 0038 (the verified cache these installations
-- consume).
--
-- WHY A NEW GROUP: §12 — "persist state before every externally visible
-- transition; restart must resume from relational or durable local state,
-- not process memory". Assignment, download, staging, installation, health
-- checking and promotion stay DISTINCT states, and every transition is
-- auto-journalled append-only so a crash between any two steps leaves an
-- explainable trail.
-- ===========================================================================

create table edge_config.release_installation (
  id                   uuid        primary key,
  release_cache_id     uuid        not null references edge_config.release_cache (id),
  device_kind          text        not null,
  terminal_device_id   uuid        null references edge_identity.terminal_device (id),
  tenant_id            uuid        not null,
  digital_store_id     uuid        not null,
  location_id          uuid        not null,
  state                text        not null default 'assigned',
  active_slot          text        null,
  candidate_slot       text        null,
  current_version      text        null,
  candidate_version    text        not null,
  rollback_version     text        null,
  probe_successes      integer     not null default 0,
  probes_started_at    timestamptz null,
  backup_ref           uuid        null,
  rollback_attempted   boolean     not null default false,
  failure_reason       text        null,
  cancelled_by         text        null,
  cancel_reason        text        null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint release_installation_kind_ck check (device_kind in ('store_hub', 'terminal')),
  constraint release_installation_terminal_ck
    check ((device_kind = 'terminal') = (terminal_device_id is not null)),
  constraint release_installation_state_ck
    check (state in ('assigned', 'downloading', 'verified', 'staged',
                     'installing_inactive_slot', 'pending_restart',
                     'health_checking', 'current', 'failed', 'rolling_back',
                     'failed_rolled_back', 'cancelled')),
  constraint release_installation_slot_ck
    check (active_slot in ('a', 'b') and candidate_slot in ('a', 'b')
           or active_slot is null or candidate_slot is null),
  constraint release_installation_probes_ck check (probe_successes >= 0),
  constraint release_installation_cancel_ck
    check ((state = 'cancelled') = (cancelled_by is not null))
);

comment on table edge_config.release_installation is
  'WS-11-T006-P04. Durable A/B installation state for the Store Hub and its T1-T4 terminals — the release agent persists BEFORE every externally visible transition and resumes from these rows after restart. current/candidate/rollback versions tracked separately (§16); failed_rolled_back is terminal for AUTOMATIC retry (owner gate §6). MC: MUT (runtime, matrix-enforced).';

create index edge_config_release_installation_scope_idx
  on edge_config.release_installation (tenant_id, digital_store_id, location_id);

comment on index edge_config.edge_config_release_installation_scope_idx is
  'Schema-contract §8 scope index.';

-- One LIVE installation per device: a second concurrent install of anything
-- on the same device is a coordination bug, refused structurally.
create unique index release_installation_one_live_idx
  on edge_config.release_installation
     (device_kind, coalesce(terminal_device_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state not in ('current', 'failed', 'failed_rolled_back', 'cancelled');

create table edge_config.release_installation_event (
  id               uuid        primary key default gen_random_uuid(),
  installation_id  uuid        not null references edge_config.release_installation (id),
  from_state       text        null,
  to_state         text        not null,
  detail           jsonb       not null default '{}'::jsonb,
  occurred_at      timestamptz not null default now()
);

comment on table edge_config.release_installation_event is
  'WS-11-T006-P04. Append-only auto-journal of every installation transition (trigger-written, so no code path can move state without leaving evidence). MC: A/O.';

create or replace function edge_config.release_installation_event_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_config.release_installation_event', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger release_installation_event_append_only
  before update or delete on edge_config.release_installation_event
  for each row execute function edge_config.release_installation_event_append_only();

-- The §12 transition matrix + the §6 one-rollback rule, schema-enforced.
create or replace function edge_config.release_installation_transitions()
returns trigger
language plpgsql
as $$
declare
  v_legal boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-EDGE-INSTALL-NO-DELETE: installation rows are terminal, never deleted'
      using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'assigned' then
      raise exception 'KLUY-EDGE-INSTALL-ENTRY: an installation begins at assigned, not %', new.state
        using errcode = 'P0001';
    end if;
    return new;
  end if;
  if new.state is not distinct from old.state then
    return new;
  end if;
  v_legal := case old.state
    when 'assigned'                 then new.state in ('downloading', 'cancelled')
    when 'downloading'              then new.state in ('verified', 'failed', 'cancelled')
    when 'verified'                 then new.state in ('staged', 'failed', 'cancelled')
    when 'staged'                   then new.state in ('installing_inactive_slot', 'failed', 'cancelled')
    when 'installing_inactive_slot' then new.state in ('pending_restart', 'failed')
    when 'pending_restart'          then new.state in ('health_checking', 'failed')
    when 'health_checking'          then new.state in ('current', 'rolling_back', 'failed')
    when 'rolling_back'             then new.state in ('failed_rolled_back', 'failed')
    else false
  end;
  if not v_legal then
    raise exception 'KLUY-EDGE-INSTALL-TRANSITION: % -> % is not a legal installation transition', old.state, new.state
      using errcode = 'P0001';
  end if;
  if new.state = 'rolling_back' then
    if old.rollback_attempted then
      raise exception 'KLUY-EDGE-INSTALL-ROLLBACK-ONCE: only ONE automatic rollback attempt exists (owner gate §6)'
        using errcode = 'P0001';
    end if;
    new.rollback_attempted := true;
  end if;
  return new;
end;
$$;

create trigger release_installation_transitions
  before insert or update or delete on edge_config.release_installation
  for each row execute function edge_config.release_installation_transitions();

-- Auto-journal: every state change leaves an event, written by trigger so no
-- code path can skip it.
create or replace function edge_config.release_installation_journal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state then
    insert into edge_config.release_installation_event
      (installation_id, from_state, to_state, detail)
    values
      (new.id,
       case when tg_op = 'INSERT' then null else old.state end,
       new.state,
       jsonb_build_object('candidate_version', new.candidate_version,
                          'candidate_slot', new.candidate_slot,
                          'probe_successes', new.probe_successes,
                          'failure_reason', new.failure_reason));
  end if;
  return new;
end;
$$;

create trigger release_installation_journal
  after insert or update on edge_config.release_installation
  for each row execute function edge_config.release_installation_journal();

grant select, insert, update on edge_config.release_installation to kitluy_hub_runtime;
grant select, insert on edge_config.release_installation_event to kitluy_hub_runtime;
grant select on edge_config.release_installation to kitluy_sync_worker;
grant select on edge_config.release_installation_event to kitluy_sync_worker;

do $guard$
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_config'
                    and indexname = 'edge_config_release_installation_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0039: the installation scope index is missing';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_config'
                    and indexname = 'release_installation_one_live_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0039: the one-live-installation index is missing';
  end if;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal
         and t.tgname in ('release_installation_transitions',
                          'release_installation_journal',
                          'release_installation_event_append_only')) <> 3 then
    raise exception 'KLUY-HUB-MIGRATION-0039: the installation triggers are missing';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0039: durable A/B installation state installed (matrix-enforced, auto-journalled, one automatic rollback)';
end
$guard$;
