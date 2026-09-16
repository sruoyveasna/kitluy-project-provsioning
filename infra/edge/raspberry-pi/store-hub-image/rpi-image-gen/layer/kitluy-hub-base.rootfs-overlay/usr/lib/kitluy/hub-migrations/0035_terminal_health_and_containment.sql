-- kitluy:hub:migration:0035
-- ===========================================================================
-- KitLuy Store Hub local database — local terminal health and received
-- containment enforcement.
--
-- WS-11-T005 (KLD-2026-08-06-WS11-REMAINING-TASKS-001). Authority: Store Hub
-- spec §12.5 ("The Hub retains the local authoritative observation") and
-- §16.1-§16.2 (health domains/metrics; exact thresholds remain
-- [REQUIRED: approved monitoring thresholds]); support-access policy §7
-- (Hub-pulled, consent-scoped remote support); KLD-2026-07-28-002 §10
-- (containment); cloud group 0177 (the projection this Hub feeds and the
-- containment directives it enforces).
--
-- WHY A NEW GROUP: groups 0000-0034 carry no terminal-health derivation and
-- no containment enforcement — `edge_hardware.device_heartbeat` records raw
-- telemetry (group 0010) and nothing derives a local status from it, and no
-- table can hold a cloud containment decision, so a quarantined terminal
-- would keep pairing the moment the WAN dropped. This group adds BOTH halves:
-- the Hub-authoritative CURRENT local health status per terminal, and the
-- append-only containment directive log whose latest directive is enforced
-- by triggers on pairing_session and terminal_session — locally, with no
-- cloud round-trip, which is exactly the WAN-loss property T005 requires.
--
-- WHAT THIS GROUP DOES NOT DO: it does not build the cloud->Hub transport
-- for directives (the signed-configuration PRODUCER is BLK-006-gated; the
-- rows here arrive through the existing verified inbox/config authority when
-- that producer exists, and through governed local operator action before
-- then). It does not delete or rewrite any queued business fact: containment
-- blocks FUTURE sessions and pairing; the outbox, bookings, payments and
-- audit rows are untouched — no statement in this file reaches them.
--
-- TIME: observed_at/derived_at are recorded observations, never ordering
-- authority; directive ordering is the cloud-issued directive_sequence.
-- CRYPTOGRAPHY: none added; signature verification stays with the group
-- 0022/0027/0031 authorities. GOVERNANCE: runtime writes health; only the
-- sync/config path (or governed operator repair) writes directives.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Local terminal health status — the Hub's CURRENT authoritative view.
-- ---------------------------------------------------------------------------
create table edge_hardware.terminal_health_status (
  terminal_device_id  uuid        primary key references edge_identity.terminal_device (id),
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  derived_state       text        not null,
  health_reasons      text[]      not null default '{}',
  last_heartbeat_at   timestamptz null,
  heartbeat_count     bigint      not null default 0,
  software_version    text        null,
  derived_at          timestamptz not null,
  updated_at          timestamptz not null,
  constraint terminal_health_status_state_ck
    check (derived_state in ('healthy', 'degraded', 'offline_local', 'unknown')),
  constraint terminal_health_status_reasons_ck
    check (cardinality(health_reasons) <= 32),
  constraint terminal_health_status_count_ck
    check (heartbeat_count >= 0)
);

comment on table edge_hardware.terminal_health_status is
  'WS-11-T005 (cloud group 0177 counterpart). The Hub''s CURRENT LAN-derived health status per paired terminal — the local authority the cloud projection is a copy of (Hub spec §12.5). Derived from edge_hardware.device_heartbeat by the Hub agent; unknown stays distinct from offline_local: no valid observation is not the same fact as a missed heartbeat. MC: MUT (runtime).';

create index edge_hardware_terminal_health_status_scope_idx
  on edge_hardware.terminal_health_status (tenant_id, digital_store_id, location_id);

comment on index edge_hardware.edge_hardware_terminal_health_status_scope_idx is
  'Schema-contract §8 scope index: every scoped edge_* base table carries (tenant_id, digital_store_id, location_id).';

-- No hard delete: local health is superseded, never erased.
create or replace function edge_hardware.terminal_health_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-HEALTH-NO-DELETE: terminal health rows are superseded, never deleted'
    using errcode = 'P0001';
end;
$$;

create trigger terminal_health_status_no_delete
  before delete on edge_hardware.terminal_health_status
  for each row execute function edge_hardware.terminal_health_no_delete();

-- ---------------------------------------------------------------------------
-- 2. Containment directives — received cloud decisions, enforced locally.
-- ---------------------------------------------------------------------------
create table edge_identity.containment_directive (
  id                  uuid        primary key,
  device_uuid         uuid        not null,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  directive           text        not null,
  directive_sequence  bigint      not null,
  reason              text        not null,
  source_ref          text        not null,
  received_via        text        not null,
  received_at         timestamptz not null,
  constraint containment_directive_kind_ck
    check (directive in ('investigation_flagged', 'operations_restricted',
                         'suspended', 'quarantined', 'cleared')),
  constraint containment_directive_sequence_ck
    check (directive_sequence >= 1),
  constraint containment_directive_via_ck
    check (received_via in ('signed_configuration', 'cloud_inbox', 'operator_repair')),
  constraint containment_directive_dedupe_uq
    unique (device_uuid, directive_sequence)
);

comment on table edge_identity.containment_directive is
  'WS-11-T005. Append-only log of received containment decisions (cloud group 0177). Effectiveness is the HIGHEST directive_sequence per device — a delayed or replayed directive can never override a newer one, and a duplicate violates the unique dedupe pair instead of applying twice. Once a row exists the enforcement triggers below hold with the WAN down: containment does not evaporate offline. Directives arrive through the verified configuration/inbox authority (producer BLK-006-gated) or governed operator repair; never from a terminal.';

create index edge_identity_containment_directive_scope_idx
  on edge_identity.containment_directive (tenant_id, digital_store_id, location_id);

comment on index edge_identity.edge_identity_containment_directive_scope_idx is
  'Schema-contract §8 scope index.';

create index containment_directive_device_idx
  on edge_identity.containment_directive (device_uuid, directive_sequence desc);

create or replace function edge_identity.containment_directive_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_identity.containment_directive', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger containment_directive_append_only
  before update or delete on edge_identity.containment_directive
  for each row execute function edge_identity.containment_directive_append_only();

-- The effective containment: latest directive per device, when not 'cleared'.
create view edge_identity.effective_containment as
select distinct on (device_uuid)
  device_uuid, directive, directive_sequence, reason, received_at
from edge_identity.containment_directive
order by device_uuid, directive_sequence desc;

comment on view edge_identity.effective_containment is
  'WS-11-T005. The latest directive per device. A device is CONTAINED when its latest directive is not ''cleared'' — clearing is an explicit received decision, never the disappearance of a record.';

-- ---------------------------------------------------------------------------
-- 3. Enforcement: contained terminals cannot pair and cannot open sessions.
-- ---------------------------------------------------------------------------
create or replace function edge_identity.refuse_contained_terminal()
returns trigger
language plpgsql
as $$
declare
  v_directive text;
begin
  select directive into v_directive
  from edge_identity.effective_containment
  where device_uuid = new.terminal_device_id;
  if found and v_directive in ('operations_restricted', 'suspended', 'quarantined') then
    raise exception 'KLUY-EDGE-TERMINAL-CONTAINED: terminal % is contained (%) and cannot start % rows',
      new.terminal_device_id, v_directive, tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_identity.refuse_contained_terminal() is
  'WS-11-T005 enforcement: a terminal whose latest containment directive is operations_restricted, suspended or quarantined can neither open a pairing session nor an authorization session — locally, with no cloud reachability required. investigation_flagged deliberately does NOT block: flagging must not interrupt Store operations by itself (cloud group 0177 rule).';

create trigger pairing_session_containment_gate
  before insert on edge_identity.pairing_session
  for each row execute function edge_identity.refuse_contained_terminal();

create trigger terminal_session_containment_gate
  before insert on edge_identity.terminal_session
  for each row execute function edge_identity.refuse_contained_terminal();

-- ---------------------------------------------------------------------------
-- 4. Grants — runtime derives health; sync applies directives.
-- ---------------------------------------------------------------------------
-- kitluy_support_ro receives NO base-table grant (schema contract §3:
-- redacted views only); its fleet visibility is the effective_containment
-- VIEW below and a future redacted health view when support surfaces need it.
grant select, insert, update on edge_hardware.terminal_health_status to kitluy_hub_runtime;
grant select on edge_hardware.terminal_health_status to kitluy_sync_worker;
grant select, insert on edge_identity.containment_directive to kitluy_sync_worker;
grant select on edge_identity.containment_directive to kitluy_hub_runtime;
grant select on edge_identity.effective_containment to kitluy_hub_runtime, kitluy_sync_worker, kitluy_support_ro;

-- ---------------------------------------------------------------------------
-- 5. Guard: prove the boundary on apply.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_count integer;
begin
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_hardware'
                    and indexname = 'edge_hardware_terminal_health_status_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0035: the terminal health scope index is missing';
  end if;
  if not exists (select 1 from pg_indexes
                  where schemaname = 'edge_identity'
                    and indexname = 'edge_identity_containment_directive_scope_idx') then
    raise exception 'KLUY-HUB-MIGRATION-0035: the containment directive scope index is missing';
  end if;
  select count(*) into v_count from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and ((n.nspname = 'edge_identity' and c.relname = 'pairing_session'
          and t.tgname = 'pairing_session_containment_gate')
      or (n.nspname = 'edge_identity' and c.relname = 'terminal_session'
          and t.tgname = 'terminal_session_containment_gate')
      or (n.nspname = 'edge_identity' and c.relname = 'containment_directive'
          and t.tgname = 'containment_directive_append_only')
      or (n.nspname = 'edge_hardware' and c.relname = 'terminal_health_status'
          and t.tgname = 'terminal_health_status_no_delete'));
  if v_count <> 4 then
    raise exception 'KLUY-HUB-MIGRATION-0035: only % of 4 enforcement triggers are installed', v_count;
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0035: local terminal health authority and offline containment enforcement installed';
end
$guard$;
