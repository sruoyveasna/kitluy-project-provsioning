-- kitluy:group:0110
-- Migration group 0110: sync_ingestion (WS-10-T003, Cycle 9).
--   kitluy_sync: sync_batches, sync_inbox, sync_cursors, sync_conflicts
--   + ingest_hub_batch_v1 / record_hub_event_v1 RPCs (idempotent ingestion).
-- Column contract: docs/source/data-contracts/kitluy-suite-supabase-data-dictionary-v1.0.0.md
--   schema ownership registry row `kitluy_sync` ("Hub/cloud inbox/outbox,
--   batches, conflicts, cursors, heartbeats and health snapshots") and its
--   relation dictionary. The schema name is ALREADY in DD v1.0.0, so no
--   dictionary amendment is required to create it.
-- Owner decisions: KLD-2026-07-28-001 Group 6 (KLREQ-026) — the ingestion
--   dedupe key is the Hub-issued business-effect key
--   `kh1.{command_result_uuid}.{event_ordinal}`; Group 1 (KLREQ-020) — the
--   terminal key is `kl1.{terminal_device_uuid}.{client_sequence}`; amendment
--   KLD-2026-07-28-001-A01 §2 — a rejection recorded here is DURABLE, and a
--   transport failure is never one.
--
-- DEVIATIONS FROM THE DD RELATION DICTIONARY, recorded rather than silent:
--   D1 `sync_inbox` gains `effect_key` and its uniqueness constraint. The DD
--      lists `event_id` + `payload_hash`; neither is a dedupe key the HUB can
--      guarantee stable across replay, and the owner ruled the effect key is
--      (KLREQ-026). `event_id` is retained alongside it.
--   D2 `sync_batches` gains the signature/manifest columns. A batch that
--      cannot say what it verified is not evidence of a verified batch.
--   D3 `device_heartbeats` and `component_health_snapshots` are NOT created
--      here. They belong to device/observability work, and creating empty
--      relations would imply a capability that does not exist (rule 5).
--
-- kitluy_devices does not exist yet, so `hub_device_id` and `origin_device_id`
-- are plain uuid columns (migration-plan rule R4, the same precedent as
-- kitluy_audit.audit_logs.device_id).
--
-- Purely additive; LOCAL execution only; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED). RLS ENABLE+FORCE with SELECT-only client
-- policies is applied in the same file below — the relations are never
-- reachable without it.

begin;

create schema if not exists kitluy_sync;

comment on schema kitluy_sync is
  'Owner: Sync. Hub/cloud batch ingestion, event dedupe, cursors and conflicts (DD v1.0.0 schema ownership registry). Ingestion is IDEMPOTENT on the Hub-issued business-effect key (KLREQ-026); financial/inventory conflicts require governed reconciliation and are never silently resolved.';

-- ---------------------------------------------------------------------------
-- kitluy_sync.sync_batches — one received, signature-verified Hub push.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_sync.sync_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  -- The Hub's own batch id, echoed back so the Hub can match the response.
  hub_batch_id uuid not null,
  hub_device_id uuid not null,
  assignment_generation integer not null,
  direction text not null default 'INBOUND',
  envelope_version integer not null,
  item_count integer not null,
  first_hub_sequence bigint not null,
  last_hub_sequence bigint not null,
  declared_gap_count integer not null default 0,
  manifest_sha256 text not null,
  signature_algorithm text not null,
  signing_key_id text not null,
  signature_verified boolean not null,
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'RECEIVED',
  applied_count integer,
  duplicate_count integer,
  rejected_count integer,
  constraint sync_batches_hub_batch_key unique (store_location_id, hub_batch_id),
  constraint sync_batches_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint sync_batches_direction_check check (direction in ('INBOUND', 'OUTBOUND')),
  constraint sync_batches_status_check
    check (status in ('RECEIVED', 'APPLIED', 'REJECTED')),
  constraint sync_batches_range_check
    check (last_hub_sequence >= first_hub_sequence and first_hub_sequence >= 1),
  constraint sync_batches_counts_check
    check (item_count >= 1 and declared_gap_count >= 0 and assignment_generation >= 1),
  constraint sync_batches_manifest_check check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  -- An UNVERIFIED signature can never reach APPLIED. The cloud applies nothing
  -- it did not verify, and the row that records the refusal keeps saying so.
  constraint sync_batches_verified_check
    check (status <> 'APPLIED' or signature_verified),
  constraint sync_batches_completion_check
    check (status = 'RECEIVED'
           or (completed_at is not null and applied_count is not null
               and duplicate_count is not null and rejected_count is not null
               and applied_count + duplicate_count + rejected_count = item_count))
);

comment on table kitluy_sync.sync_batches is
  'Owner: Sync. One received Hub push, with what was signed and whether the signature verified. Deviation D2 vs the DD relation dictionary: the signature/manifest columns are additive. An unverified batch can never reach APPLIED (sync_batches_verified_check). MC: A/O.';
comment on column kitluy_sync.sync_batches.hub_device_id is
  'Plain uuid until kitluy_devices lands (migration-plan rule R4).';

create index if not exists sync_batches_location_idx
  on kitluy_sync.sync_batches (store_location_id, received_at desc);
create index if not exists sync_batches_tenant_id_idx
  on kitluy_sync.sync_batches (tenant_id);

-- ---------------------------------------------------------------------------
-- kitluy_sync.sync_inbox — THE idempotency boundary.
--
-- One row per business EFFECT, keyed on the Hub-issued
-- `kh1.{command_result_uuid}.{event_ordinal}` (KLREQ-026). A replay of the same
-- effect finds this row and re-reports the ORIGINAL outcome; nothing is applied
-- twice, and the Hub receives the same acknowledgement identity it would have
-- received the first time.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_sync.sync_inbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  batch_id uuid not null references kitluy_sync.sync_batches (id),
  -- D1: the DEDUPE key. Deterministic across replay by owner ruling.
  effect_key text not null,
  -- The Hub's event id, retained for tracing. NOT the dedupe key: a replay may
  -- legitimately carry a different event row id for the same business effect.
  event_id uuid not null,
  source_device_id uuid not null,
  assignment_generation integer not null,
  hub_sequence bigint not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  schema_version integer not null,
  payload_sha256 text not null,
  payload jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'RECEIVED',
  -- The cloud's OWN acknowledgement identity. The Hub never mints one, and a
  -- replay returns THIS value rather than a fresh one.
  cloud_ack_id text,
  rejection_code text,
  rejection_reason text,
  constraint sync_inbox_effect_key unique (store_location_id, effect_key),
  constraint sync_inbox_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  -- The two Hub key namespaces, disjoint by prefix (KLREQ-020 / KLREQ-026).
  constraint sync_inbox_effect_key_check
    check (effect_key ~ '^kh1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,10}$'
           or effect_key ~ '^kl1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,20}$'),
  constraint sync_inbox_payload_hash_check check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint sync_inbox_sequence_check
    check (hub_sequence >= 1 and assignment_generation >= 1 and schema_version >= 1),
  constraint sync_inbox_status_check
    check (status in ('RECEIVED', 'APPLIED', 'REJECTED')),
  -- APPLIED carries the cloud acknowledgement identity; REJECTED carries a
  -- DURABLE reason code. Neither outcome can be recorded as a bare verdict, and
  -- a transport failure is not an outcome at all (amendment §2).
  constraint sync_inbox_applied_check
    check (status <> 'APPLIED' or (cloud_ack_id is not null and processed_at is not null)),
  constraint sync_inbox_rejected_check
    check (status <> 'REJECTED' or (rejection_code is not null and processed_at is not null))
);

comment on table kitluy_sync.sync_inbox is
  'Owner: Sync. THE ingestion idempotency boundary: one row per business effect, unique on (store_location_id, effect_key). Deviation D1 vs the DD relation dictionary: effect_key is additive and is the dedupe key the owner ruled (KLREQ-026); event_id is retained for tracing but is NOT the dedupe key. A replay re-reports the ORIGINAL cloud_ack_id. MC: A/O.';
comment on column kitluy_sync.sync_inbox.cloud_ack_id is
  'The CLOUD acknowledgement identity. Minted here and only here; the Hub refuses to record an acknowledgement without one, so none can be fabricated at the edge.';

create index if not exists sync_inbox_batch_idx on kitluy_sync.sync_inbox (batch_id);
create index if not exists sync_inbox_aggregate_idx
  on kitluy_sync.sync_inbox (aggregate_type, aggregate_id);
create index if not exists sync_inbox_tenant_id_idx on kitluy_sync.sync_inbox (tenant_id);
create index if not exists sync_inbox_stream_idx
  on kitluy_sync.sync_inbox (store_location_id, assignment_generation, hub_sequence);

-- ---------------------------------------------------------------------------
-- kitluy_sync.sync_cursors — per-stream progress. A cursor can never claim
-- more progress than actually happened.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_sync.sync_cursors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  stream_key text not null,
  assignment_generation integer not null,
  last_ingested_hub_sequence bigint not null default 0,
  last_acknowledged_hub_sequence bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint sync_cursors_stream_key unique (store_location_id, stream_key, assignment_generation),
  constraint sync_cursors_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint sync_cursors_order_check
    check (last_acknowledged_hub_sequence <= last_ingested_hub_sequence),
  constraint sync_cursors_generation_check check (assignment_generation >= 1)
);

comment on table kitluy_sync.sync_cursors is
  'Owner: Sync. Per-stream ingestion progress, scoped by the FULL ordering namespace (store_location_id, assignment_generation) so a replacement Hub never inherits the failed Hub position (offline contract §5.1). An acknowledged position can never exceed an ingested one. MC: CFG-V.';

create index if not exists sync_cursors_tenant_id_idx on kitluy_sync.sync_cursors (tenant_id);

-- ---------------------------------------------------------------------------
-- kitluy_sync.sync_conflicts — an explicit, never-silent divergence record.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_sync.sync_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  inbox_id uuid references kitluy_sync.sync_inbox (id),
  effect_key text not null,
  data_class text not null,
  conflict_type text not null,
  local_summary jsonb not null default '{}'::jsonb,
  cloud_summary jsonb not null default '{}'::jsonb,
  status text not null default 'OPEN',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution_code text,
  resolution_note text,
  constraint sync_conflicts_tenant_store_fk
    foreign key (tenant_id, digital_store_id)
    references kitluy_core.digital_stores (tenant_id, id),
  constraint sync_conflicts_status_check
    check (status in ('OPEN', 'OPERATOR_REQUIRED', 'RESOLVED', 'WAIVED')),
  -- KLD-2026-07-28-001 Group 7 and the standing "no silent conflict
  -- resolution" constraint: a closed conflict names WHO closed it, WHY, and
  -- WHEN. There is no path that closes one without evidence.
  constraint sync_conflicts_resolution_check
    check (status not in ('RESOLVED', 'WAIVED')
           or (resolved_at is not null and resolution_code is not null
               and resolved_by is not null))
);

comment on table kitluy_sync.sync_conflicts is
  'Owner: Sync. Explicit divergence between Hub-reported and cloud truth. Per-data-class policy (Hub §11.4) forbids generic last-write-wins for payment, custody, inventory, finance and audit truth; closing a conflict requires an actor, a reason and a moment (no silent conflict resolution). MC: A/O.';

create index if not exists sync_conflicts_open_idx
  on kitluy_sync.sync_conflicts (store_location_id, status, detected_at desc)
  where status in ('OPEN', 'OPERATOR_REQUIRED');
create index if not exists sync_conflicts_tenant_id_idx on kitluy_sync.sync_conflicts (tenant_id);

-- ---------------------------------------------------------------------------
-- Append-only discipline: an ingestion record is written once and completed
-- once. Rewriting what was ingested would destroy the evidence a replay is
-- checked against.
-- ---------------------------------------------------------------------------
create or replace function kitluy_sync.enforce_inbox_single_completion()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-SYNC-INBOX-IMMUTABLE: an ingested effect is never deleted; it is what a replay is checked against'
      using errcode = 'P0001';
  end if;
  if old.status <> 'RECEIVED' then
    raise exception
      'KLUY-SYNC-INBOX-IMMUTABLE: effect % already completed as %; an ingestion outcome is recorded once',
      old.effect_key, old.status using errcode = 'P0001';
  end if;
  if (new.effect_key, new.store_location_id, new.payload_sha256, new.hub_sequence,
      new.assignment_generation, new.aggregate_id, new.event_type)
     is distinct from
     (old.effect_key, old.store_location_id, old.payload_sha256, old.hub_sequence,
      old.assignment_generation, old.aggregate_id, old.event_type) then
    raise exception
      'KLUY-SYNC-INBOX-IMMUTABLE: what was ingested cannot be rewritten after the fact'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function kitluy_sync.enforce_inbox_single_completion() is
  'Exactly one RECEIVED -> APPLIED|REJECTED completion per ingested effect; the ingested facts are frozen and no row is ever deleted.';

create trigger trg_sync_inbox_single_completion
  before update or delete on kitluy_sync.sync_inbox
  for each row execute function kitluy_sync.enforce_inbox_single_completion();

create trigger trg_append_only_sync_batches
  before delete on kitluy_sync.sync_batches
  for each row execute function kitluy_auth.enforce_append_only();

-- ---------------------------------------------------------------------------
-- RLS: ENABLE + FORCE, fail-closed, SELECT-only for clients.
-- ZERO anon policies; ZERO client write policies. Ingestion runs through the
-- service-role sync service (RC-012: frontend visibility is not authorization).
-- ---------------------------------------------------------------------------
alter table kitluy_sync.sync_batches enable row level security;
alter table kitluy_sync.sync_batches force row level security;
alter table kitluy_sync.sync_inbox enable row level security;
alter table kitluy_sync.sync_inbox force row level security;
alter table kitluy_sync.sync_cursors enable row level security;
alter table kitluy_sync.sync_cursors force row level security;
alter table kitluy_sync.sync_conflicts enable row level security;
alter table kitluy_sync.sync_conflicts force row level security;

create policy sync_batches_select_location on kitluy_sync.sync_batches
  for select to authenticated
  using (store_location_id = any (kitluy_auth.current_location_ids()));

create policy sync_inbox_select_location on kitluy_sync.sync_inbox
  for select to authenticated
  using (store_location_id = any (kitluy_auth.current_location_ids()));

create policy sync_cursors_select_location on kitluy_sync.sync_cursors
  for select to authenticated
  using (store_location_id = any (kitluy_auth.current_location_ids()));

create policy sync_conflicts_select_location on kitluy_sync.sync_conflicts
  for select to authenticated
  using (store_location_id = any (kitluy_auth.current_location_ids()));

grant usage on schema kitluy_sync to authenticated, service_role;
grant select on all tables in schema kitluy_sync to authenticated;
grant select, insert, update on
  kitluy_sync.sync_batches, kitluy_sync.sync_inbox,
  kitluy_sync.sync_cursors, kitluy_sync.sync_conflicts
  to service_role;

commit;
