-- kitluy:hub:migration:0037
-- ===========================================================================
-- KitLuy Store Hub local database — local replacement/cutover state and its
-- operational enforcement.
--
-- WS-11-T006-P01 (KLD-2026-08-06-WS11-T006-001 §1-§2). A restored or
-- prepared-replacement Hub must not serve operational requests until the
-- cloud-approved cutover decision is received and explicitly activated, and
-- a retired old Hub must refuse operation after cutover. That gate has to
-- hold LOCALLY (WAN-independent once received) and survive restart, so it is
-- a relational mode with append-only history — never process memory.
--
-- MODES: 'normal' (the shipped default — every existing Hub keeps working);
-- 'prepared_inactive' (replacement staged before cutover, §1: "cannot become
-- active until the atomic cutover decision completes");
-- 'restored_quarantine' (P02 restore lands here; §12: quarantined until
-- verification passes and activation is explicit);
-- 'retired_rejected' (the OLD Hub after cutover: operational authority
-- refused, history intact).
-- Enforcement: while the mode is not 'normal', terminal sessions and pairing
-- cannot start. Containment (0035) stays a SEPARATE dimension; both gates
-- fire independently.
-- ===========================================================================

create table edge_identity.hub_replacement_state (
  -- Single-row authority, keyed by the constant true.
  singleton            boolean     primary key default true,
  mode                 text        not null default 'normal',
  replacement_operation_ref uuid   null,
  reason               text        null,
  received_at          timestamptz null,
  activated_at         timestamptz null,
  updated_at           timestamptz not null default now(),
  constraint hub_replacement_state_singleton_ck check (singleton),
  constraint hub_replacement_state_mode_ck
    check (mode in ('normal', 'prepared_inactive', 'restored_quarantine', 'retired_rejected')),
  constraint hub_replacement_state_ref_ck
    check (mode = 'normal' or replacement_operation_ref is not null or mode = 'restored_quarantine')
);

comment on table edge_identity.hub_replacement_state is
  'WS-11-T006-P01. The Hub''s own replacement/cutover mode (KLD-2026-08-06-WS11-T006-001 §1). Single row; not ''normal'' means operational authority is locally refused. Changed only through set_hub_replacement_mode_v1; history in hub_replacement_events. MC: MUT (governed).';

create table edge_identity.hub_replacement_events (
  id                   uuid        primary key,
  from_mode            text        not null,
  to_mode              text        not null,
  replacement_operation_ref uuid   null,
  reason               text        not null,
  actor_ref            text        not null,
  correlation_id       uuid        not null,
  occurred_at          timestamptz not null default now()
);

comment on table edge_identity.hub_replacement_events is
  'WS-11-T006-P01. Append-only local replacement-mode history. MC: A/O.';

create or replace function edge_identity.hub_replacement_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_identity.hub_replacement_events', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger hub_replacement_events_append_only
  before update or delete on edge_identity.hub_replacement_events
  for each row execute function edge_identity.hub_replacement_events_append_only();

-- The governed mode door: the ONLY writer (0024/0031 governor discipline).
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_replacement_governor') then
    create role kitluy_replacement_governor nologin;
  end if;
end
$roles$;

comment on role kitluy_replacement_governor is
  'WS-11-T006-P01. NOLOGIN owner of the local replacement-mode authority; current_user equals it only inside set_hub_replacement_mode_v1.';

grant usage, create on schema edge_identity to kitluy_replacement_governor;

create or replace function edge_identity.hub_replacement_state_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-EDGE-REPLACEMENT-IMMUTABLE: the replacement state row is never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_replacement_governor' then
    raise exception 'KLUY-EDGE-REPLACEMENT-GOVERNED: mode changes only through set_hub_replacement_mode_v1 (group 0037)'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger hub_replacement_state_governed
  before insert or update or delete on edge_identity.hub_replacement_state
  for each row execute function edge_identity.hub_replacement_state_governed();

create or replace function edge_identity.set_hub_replacement_mode_v1(
  p_mode text,
  p_replacement_operation_ref uuid,
  p_reason text,
  p_actor_ref text,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, edge_identity
as $door$
declare
  v_current edge_identity.hub_replacement_state;
begin
  if p_mode not in ('normal', 'prepared_inactive', 'restored_quarantine', 'retired_rejected') then
    raise exception 'KLUY-EDGE-REPLACEMENT-MODE: % is not a replacement mode', p_mode
      using errcode = 'P0001';
  end if;
  if coalesce(btrim(p_reason), '') = '' or coalesce(btrim(p_actor_ref), '') = '' then
    raise exception 'KLUY-EDGE-REPLACEMENT-UNATTRIBUTED: a mode change names its reason and actor'
      using errcode = 'P0001';
  end if;
  if p_correlation_id is null then
    raise exception 'KLUY-EDGE-REPLACEMENT-CORRELATION: a mode change carries a correlation id'
      using errcode = 'P0001';
  end if;

  select * into v_current from edge_identity.hub_replacement_state
   where singleton for update;
  if not found then
    insert into edge_identity.hub_replacement_state (singleton, mode)
    values (true, 'normal')
    returning * into v_current;
  end if;

  -- A RETIRED Hub never returns to service through this door: the identity
  -- decision belongs to the cloud authority, and a locally re-enabled retired
  -- Hub is exactly the dual-active outcome §1 forbids.
  if v_current.mode = 'retired_rejected' and p_mode <> 'retired_rejected' then
    raise exception 'KLUY-EDGE-REPLACEMENT-RETIRED: a retired Hub does not re-enter service locally'
      using errcode = 'P0001';
  end if;

  if v_current.mode = p_mode then
    return jsonb_build_object('outcome', 'UNCHANGED', 'mode', p_mode);
  end if;

  update edge_identity.hub_replacement_state
  set mode = p_mode,
      replacement_operation_ref = p_replacement_operation_ref,
      reason = p_reason,
      received_at = case when p_mode = 'normal' then received_at else now() end,
      activated_at = case when p_mode = 'normal' then now() else activated_at end,
      updated_at = now()
  where singleton;

  insert into edge_identity.hub_replacement_events
    (id, from_mode, to_mode, replacement_operation_ref, reason, actor_ref, correlation_id)
  values
    (gen_random_uuid(), v_current.mode, p_mode, p_replacement_operation_ref,
     p_reason, p_actor_ref, p_correlation_id);

  return jsonb_build_object('outcome', 'CHANGED',
                            'from_mode', v_current.mode, 'mode', p_mode);
end;
$door$;

comment on function edge_identity.set_hub_replacement_mode_v1(text, uuid, text, text, uuid) is
  'WS-11-T006-P01. The one door over the local replacement mode. retired_rejected is terminal locally (dual-active prevention); activation back to normal is the explicit post-cutover step. Executed by the sync/config consumer or governed operator repair.';

-- ---------------------------------------------------------------------------
-- Enforcement: a non-normal Hub cannot open sessions or pairing.
-- ---------------------------------------------------------------------------
create or replace function edge_identity.refuse_nonoperational_hub()
returns trigger
language plpgsql
as $$
declare
  v_mode text;
begin
  select mode into v_mode from edge_identity.hub_replacement_state where singleton;
  if v_mode is not null and v_mode <> 'normal' then
    raise exception 'KLUY-EDGE-HUB-NOT-OPERATIONAL: this Hub is % and refuses new % rows (replacement/cutover gate, group 0037)',
      v_mode, tg_table_name
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_identity.refuse_nonoperational_hub() is
  'WS-11-T006-P01. While the local mode is prepared_inactive, restored_quarantine or retired_rejected, terminal sessions and pairing cannot start. Fires alongside (independent of) the 0035 containment gate.';

-- Alphabetical trigger order note: cutover_gate sorts between the 0035
-- containment_gate and pairing_session_governance, so the cutover refusal
-- fires before governance for every writer.
create trigger pairing_session_cutover_gate
  before insert on edge_identity.pairing_session
  for each row execute function edge_identity.refuse_nonoperational_hub();

create trigger terminal_session_cutover_gate
  before insert on edge_identity.terminal_session
  for each row execute function edge_identity.refuse_nonoperational_hub();

-- ---------------------------------------------------------------------------
-- Grants. The RC-028/0036 lesson: a trigger's reads are part of every
-- writer's privilege surface — every role that inserts sessions or pairing
-- rows needs SELECT on the state row, including the pairing governor.
-- ---------------------------------------------------------------------------
-- Ownership borrow (KLRISK-HUB-001 discipline: resolve and quote the
-- grantee; never GRANT ... TO current_user directly).
do $borrow$
declare
  v_migrator text := current_user;
begin
  execute format('grant kitluy_replacement_governor to %I', v_migrator);
end
$borrow$;

alter table edge_identity.hub_replacement_state owner to kitluy_replacement_governor;
alter function edge_identity.set_hub_replacement_mode_v1(text, uuid, text, text, uuid)
  owner to kitluy_replacement_governor;
revoke all on function edge_identity.set_hub_replacement_mode_v1(text, uuid, text, text, uuid) from public;
grant execute on function edge_identity.set_hub_replacement_mode_v1(text, uuid, text, text, uuid)
  to kitluy_hub_runtime, kitluy_sync_worker;

-- kitluy_support_ro gets NO base-table grant (schema contract §3).
grant select on edge_identity.hub_replacement_state
  to kitluy_hub_runtime, kitluy_sync_worker, kitluy_pairing_governor;
grant select on edge_identity.hub_replacement_events
  to kitluy_hub_runtime, kitluy_sync_worker;
grant insert on edge_identity.hub_replacement_events to kitluy_replacement_governor;
grant select, insert, update on edge_identity.hub_replacement_state to kitluy_replacement_governor;

-- Seed the shipped default: an existing Hub keeps operating.
do $seed$
begin
  set local role kitluy_replacement_governor;
  insert into edge_identity.hub_replacement_state (singleton, mode)
  values (true, 'normal')
  on conflict (singleton) do nothing;
  reset role;
end
$seed$;

do $hand_back$
declare
  v_migrator text := current_user;
begin
  execute format('revoke kitluy_replacement_governor from %I', v_migrator);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- Guard.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if (select mode from edge_identity.hub_replacement_state where singleton) <> 'normal' then
    raise exception 'KLUY-HUB-MIGRATION-0037: the shipped default mode is not normal';
  end if;
  if (select count(*) from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal
        and t.tgname in ('pairing_session_cutover_gate',
                         'terminal_session_cutover_gate',
                         'hub_replacement_state_governed',
                         'hub_replacement_events_append_only')) <> 4 then
    raise exception 'KLUY-HUB-MIGRATION-0037: the replacement gates are missing';
  end if;
  if not has_table_privilege('kitluy_pairing_governor', 'edge_identity.hub_replacement_state', 'select') then
    raise exception 'KLUY-HUB-MIGRATION-0037: the pairing governor cannot read the gate (the 0035 lesson)';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0037: local replacement/cutover mode and operational gates installed (default normal)';
end
$guard$;
