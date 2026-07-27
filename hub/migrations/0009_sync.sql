-- kitluy:hub:migration:0009
-- ===========================================================================
-- KitLuy Store Hub local database — edge_sync (§6.8, 6 canonical relations
-- plus 2 ADDITIVE EXTENSIONS required by the sequencing contract).
--
-- Reconciliation G5: the master build plan's `local_events` / `local_outbox` /
-- `sync_cursors` / `idempotency_records` naming is planning shorthand. The
-- canonical contract governs. There is NO edge_commands and NO edge_events
-- schema — command, event and sync concerns all live in edge_sync (§2).
--
-- ADDITIVE EXTENSIONS recorded in the WS-09-T001 reconciliation:
--   G3  edge_sync.sequence_gap     — the "local sequence-gap ledger" the
--       sequencing contract §5 requires but the catalogue omits.
--   G3  edge_sync.command_result   — the immutable command result the
--       acceptance algorithm §4 requires ("store immutable command result").
--   G4  assignment_generation on local_event and outbox — §5.1 declares the
--       ordering namespace (location_id, assignment_generation, hub_sequence)
--       but the catalogue omits the column. Without it, replacement-Hub
--       sequence isolation is impossible.
-- An amendment to the canonical document is owed for all three.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Hub sequence (offline contract §5): a single PostgreSQL sequence, signed
-- 64-bit, starting at 1, never reused. Gaps from rolled-back allocation are
-- recorded in edge_sync.sequence_gap and are NOT sent as missing events.
-- ---------------------------------------------------------------------------
create sequence edge_sync.hub_sequence_seq as bigint start with 1 minvalue 1 no cycle;

comment on sequence edge_sync.hub_sequence_seq is
  'Offline contract §5: the single allocator for hub_sequence. Allocation is non-transactional by design, so a rolled-back transaction burns a value; the burnt value is journalled in edge_sync.sequence_gap.';

-- ---------------------------------------------------------------------------
-- edge_sync.local_event — IMMUTABLE (§6.8).
-- ---------------------------------------------------------------------------
create table edge_sync.local_event (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  hub_device_id         uuid        not null references edge_identity.hub_device (id),
  origin_device_id      uuid        not null,
  actor_id              uuid        null,
  aggregate_type        text        not null,
  aggregate_id          uuid        not null,
  aggregate_version     bigint      not null,
  event_type            text        not null,
  schema_version        integer     not null,
  business_date         date        not null,
  occurred_at           timestamptz not null,
  hub_sequence          bigint      not null unique,
  origin_sequence       bigint      not null,
  assignment_generation integer     not null,
  idempotency_key       text        not null unique,
  payload_sha256        char(64)    not null,
  payload               jsonb       not null,
  created_at            timestamptz not null,
  constraint local_event_ordering_uq
    unique (location_id, assignment_generation, hub_sequence),
  constraint local_event_hub_sequence_ck check (hub_sequence >= 1),
  constraint local_event_origin_sequence_ck check (origin_sequence >= 0),
  constraint local_event_assignment_generation_ck check (assignment_generation >= 1),
  constraint local_event_aggregate_version_ck check (aggregate_version >= 1),
  constraint local_event_schema_version_ck check (schema_version >= 1),
  constraint local_event_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint local_event_idempotency_key_ck
    check (edge_sync.is_canonical_idempotency_key(idempotency_key))
);

comment on table edge_sync.local_event is
  'Immutable local domain-event journal (§6.8). event_type uses the canonical @kitluy/event-contracts envelope: snake_case, stable name, integer schema_version. UPDATE/DELETE rejected by the trigger in 0012.';
comment on column edge_sync.local_event.assignment_generation is
  'ADDITIVE EXTENSION (gap G4). Offline contract §5.1: the complete ordering namespace is (location_id, assignment_generation, hub_sequence). A replacement Hub receives a NEW generation, preventing sequence collision with the failed Hub.';
comment on column edge_sync.local_event.hub_sequence is
  'Allocated from edge_sync.hub_sequence_seq. Never reused, even after rollback (§5).';

-- ---------------------------------------------------------------------------
-- edge_sync.outbox — inserted in the SAME transaction as the business
-- mutation (§9 transaction invariant, enforced by the deferred constraint
-- trigger attached in 0012).
-- ---------------------------------------------------------------------------
create table edge_sync.outbox (
  event_id              uuid                        primary key
                        references edge_sync.local_event (id),
  tenant_id             uuid                        not null,
  digital_store_id      uuid                        not null,
  location_id           uuid                        not null,
  hub_sequence          bigint                      not null unique,
  assignment_generation integer                     not null,
  delivery_state        edge_sync.delivery_state    not null default 'pending',
  attempt_count         integer                     not null default 0,
  next_attempt_at       timestamptz                 not null,
  last_attempt_at       timestamptz                 null,
  last_error_code       text                        null,
  cloud_ack_id          text                        null,
  acknowledged_at       timestamptz                 null,
  dead_letter_reason    text                        null,
  constraint outbox_attempts_ck check (attempt_count >= 0),
  constraint outbox_assignment_generation_ck check (assignment_generation >= 1),
  -- WS-09 owns DURABLE LOCAL RECORDING ONLY. Cloud transmission and
  -- acknowledgement belong to WS-10: an acknowledged row must carry a real
  -- cloud acknowledgement identity, so no fabricated ack can be persisted.
  constraint outbox_ack_ck
    check ((delivery_state = 'acknowledged')
           = (acknowledged_at is not null and cloud_ack_id is not null)),
  constraint outbox_dead_letter_ck
    check (delivery_state <> 'dead_letter' or dead_letter_reason is not null)
);

comment on table edge_sync.outbox is
  'Transactional outbox (§6.8, §9). Hub spec §11.2: every local mutation produces its outbox item in the SAME local transaction; power loss between the mutation and the outbox insertion is impossible (§12 acceptance test 3).';
comment on constraint outbox_ack_ck on edge_sync.outbox is
  'No fabricated acknowledgement: delivery_state=acknowledged requires both a cloud ack id and an acknowledgement timestamp, and neither may be present otherwise (WS-09-T004 truthful sync state).';

-- ---------------------------------------------------------------------------
-- edge_sync.inbox
-- ---------------------------------------------------------------------------
create table edge_sync.inbox (
  message_id       uuid                     primary key,
  tenant_id        uuid                     not null,
  digital_store_id uuid                     not null,
  location_id      uuid                     not null,
  message_type     text                     not null,
  schema_version   integer                  not null,
  cloud_sequence   bigint                   not null,
  issued_at        timestamptz              not null,
  expires_at       timestamptz              null,
  payload_sha256   char(64)                 not null,
  payload          jsonb                    not null,
  signature        bytea                    not null,
  signing_key_id   text                     not null,
  state            edge_sync.inbox_state    not null,
  received_at      timestamptz              not null,
  applied_at       timestamptz              null,
  error_code       text                     null,
  constraint inbox_cloud_sequence_uq unique (location_id, cloud_sequence),
  constraint inbox_cloud_sequence_ck check (cloud_sequence >= 1),
  constraint inbox_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint inbox_applied_ck check (state <> 'applied' or applied_at is not null)
);

comment on table edge_sync.inbox is
  'Signed cloud control messages (§6.8). Offline contract §8: the Hub persists a message BEFORE application, applies in contiguous order, returns the original result for a duplicate id/sequence, and records an expired command as REJECTED rather than silently skipping it.';

-- ---------------------------------------------------------------------------
-- edge_sync.sync_cursor — Location-scoped by primary key (canonical column
-- list defines location_id only).
-- ---------------------------------------------------------------------------
create table edge_sync.sync_cursor (
  location_id                 uuid        not null,
  stream_code                 text        not null,
  last_pushed_hub_sequence    bigint      not null default 0,
  last_acked_hub_sequence     bigint      not null default 0,
  last_pulled_cloud_sequence  bigint      not null default 0,
  last_applied_cloud_sequence bigint      not null default 0,
  updated_at                  timestamptz not null,
  primary key (location_id, stream_code),
  constraint sync_cursor_push_order_ck check (last_acked_hub_sequence <= last_pushed_hub_sequence),
  constraint sync_cursor_pull_order_ck
    check (last_applied_cloud_sequence <= last_pulled_cloud_sequence)
);

comment on table edge_sync.sync_cursor is
  'Push/pull progress per stream (§6.8). An acknowledged position can never exceed a pushed position — a cursor cannot claim more progress than actually happened.';

-- ---------------------------------------------------------------------------
-- edge_sync.sync_conflict
-- ---------------------------------------------------------------------------
create table edge_sync.sync_conflict (
  id                  uuid                       primary key,
  tenant_id           uuid                       not null,
  digital_store_id    uuid                       not null,
  location_id         uuid                       not null,
  conflict_type       text                       not null,
  data_class          text                       not null,
  local_event_id      uuid                       null references edge_sync.local_event (id),
  cloud_reference     text                       null,
  detected_at         timestamptz                not null,
  state               edge_sync.conflict_state   not null,
  severity            text                       not null,
  local_summary       jsonb                      not null default '{}'::jsonb,
  cloud_summary       jsonb                      not null default '{}'::jsonb,
  resolution_code     text                       null,
  resolved_by         uuid                       null,
  resolved_at         timestamptz                null,
  resolution_event_id uuid                       null references edge_sync.local_event (id),
  constraint sync_conflict_resolution_ck
    check (state not in ('auto_resolved', 'resolved')
           or (resolved_at is not null and resolution_code is not null))
);

comment on table edge_sync.sync_conflict is
  'Detected divergence between local and cloud truth (§6.8). Resolution is a NEW compensating event referenced by resolution_event_id — never a silent rewrite (repository rule 8).';

-- ---------------------------------------------------------------------------
-- edge_sync.dead_letter_item
-- ---------------------------------------------------------------------------
create table edge_sync.dead_letter_item (
  id                       uuid        primary key,
  tenant_id                uuid        not null,
  digital_store_id         uuid        not null,
  location_id              uuid        not null,
  source_kind              text        not null,
  source_id                uuid        not null,
  error_code               text        not null,
  error_message            text        not null,
  payload_sha256           char(64)    not null,
  first_failed_at          timestamptz not null,
  last_failed_at           timestamptz not null,
  attempt_count            integer     not null,
  operator_action_required boolean     not null default true,
  resolved_at              timestamptz null,
  resolution_note          text        null,
  constraint dead_letter_item_attempts_ck check (attempt_count >= 1),
  constraint dead_letter_item_window_ck check (last_failed_at >= first_failed_at),
  constraint dead_letter_item_payload_hash_ck check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dead_letter_item_resolution_ck
    check ((resolved_at is null) = (resolution_note is null))
);

comment on table edge_sync.dead_letter_item is
  'Undeliverable sync item requiring operator action (§6.8). A dead letter is never silently discarded.';

-- ---------------------------------------------------------------------------
-- ADDITIVE EXTENSION (gap G3): edge_sync.sequence_gap.
-- Offline contract §5: "gaps caused by rolled-back sequence allocation are
-- recorded in a local sequence-gap ledger and not sent as missing events."
-- ---------------------------------------------------------------------------
create table edge_sync.sequence_gap (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  assignment_generation integer     not null,
  hub_sequence          bigint      not null,
  gap_reason            text        not null,
  detected_at           timestamptz not null,
  recorded_by           text        not null,
  note                  text        null,
  constraint sequence_gap_uq unique (location_id, assignment_generation, hub_sequence),
  constraint sequence_gap_sequence_ck check (hub_sequence >= 1),
  constraint sequence_gap_generation_ck check (assignment_generation >= 1),
  constraint sequence_gap_reason_ck
    check (gap_reason in ('transaction_rollback', 'allocation_abandoned',
                          'restore_reconciliation', 'assignment_transition'))
);

comment on table edge_sync.sequence_gap is
  'ADDITIVE EXTENSION (gap G3) — the local sequence-gap ledger required by offline contract §5 but absent from the canonical catalogue. A journalled hub_sequence is a KNOWN gap: sync batches declare their first and last ACTUAL sequence and never treat these values as missing events. Amendment to the canonical document is owed.';

-- ---------------------------------------------------------------------------
-- ADDITIVE EXTENSION (gap G3): edge_sync.command_result.
-- Offline contract §4 ("store immutable command result"), §7 error table and
-- §19 error behavior. WS-09-T004: the ledger stores key, request hash,
-- command type, actor, device, aggregate, result reference, commit status,
-- created_at and completed_at.
-- ---------------------------------------------------------------------------
create table edge_sync.command_result (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  idempotency_key       text        not null unique,
  request_hash          char(64)    not null,
  command_type          text        not null,
  actor_id              uuid        null,
  terminal_device_id    uuid        not null references edge_identity.terminal_device (id),
  origin_sequence       bigint      not null,
  assignment_generation integer     not null,
  aggregate_type        text        not null,
  aggregate_id          uuid        null,
  aggregate_version     bigint      null,
  request_id            uuid        null,
  event_ids             uuid[]      not null default '{}',
  hub_sequence_first    bigint      null,
  hub_sequence_last     bigint      null,
  sync_state            text        null,
  commit_status         text        not null,
  error_code            text        null,
  result_json           jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null,
  completed_at          timestamptz null,
  constraint command_result_idempotency_key_ck
    check (edge_sync.is_canonical_idempotency_key(idempotency_key)),
  constraint command_result_request_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint command_result_origin_sequence_ck check (origin_sequence >= 0),
  constraint command_result_generation_ck check (assignment_generation >= 1),
  constraint command_result_commit_status_ck
    check (commit_status in ('in_progress', 'committed', 'failed', 'rejected')),
  -- Truthful sync state (WS-09-T004): the AUTHORITATIVE registry vocabulary.
  -- Distinct subject from the persisted per-event edge_sync.delivery_state
  -- (recorded gap G2) — this describes the COMMAND outcome, not a row's
  -- delivery attempt.
  constraint command_result_sync_state_ck
    check (sync_state is null
           or sync_state in ('committed_locally', 'pending_cloud_sync', 'cloud_acknowledged',
                             'cloud_rejected', 'reconciliation_required')),
  -- No sync state is CLAIMED before the command has an outcome, and a
  -- committed command always carries one. Inventing a sixth vocabulary value
  -- for "in progress" is refused (recorded gap G2 keeps the vocabulary count
  -- from growing again).
  constraint command_result_sync_state_presence_ck
    check ((commit_status = 'in_progress') = (sync_state is null)),
  constraint command_result_terminal_ck
    check ((commit_status = 'in_progress') = (completed_at is null)),
  constraint command_result_sequence_range_ck
    check ((hub_sequence_first is null) = (hub_sequence_last is null)
           and (hub_sequence_first is null or hub_sequence_last >= hub_sequence_first)),
  constraint command_result_failure_ck
    check (commit_status not in ('failed', 'rejected') or error_code is not null),
  constraint command_result_committed_ck
    check (commit_status <> 'committed' or aggregate_id is not null)
);

comment on table edge_sync.command_result is
  'ADDITIVE EXTENSION (gap G3) — the immutable idempotency/command-result ledger required by offline contract §4 but absent from the canonical catalogue. Duplicate key + same request_hash returns THIS stored result with no new events (§12 acceptance test 2); duplicate key + different hash is EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH (§3, §19). The immutability trigger in 0012 freezes every identity/result column and blocks DELETE; only the in_progress -> terminal completion is permitted. Amendment to the canonical document is owed.';
comment on column edge_sync.command_result.request_hash is
  'Canonical request hash (offline contract §3): SHA-256 over method, normalized route template, RFC8785-canonical JSON body, terminal_device_id, session_id and profile_code. Volatile transport fields (request_id, retry count, local address) are excluded.';
comment on column edge_sync.command_result.sync_state is
  'WS-09 records LOCAL truth only. cloud_acknowledged/cloud_rejected are written by WS-10 after a real cloud response; WS-09 never fabricates an acknowledgement.';
