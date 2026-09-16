-- kitluy:hub:migration:0017
-- ===========================================================================
-- KitLuy Store Hub local database — WS-10 transmission batch ledger.
--
-- Authority: Store Hub spec §11.5 (push/acknowledge cycle), schema contract §1
-- ("Finance/payment/custody/audit: append-only"), owner amendment
-- KLD-2026-07-28-001-A01 §2 (no fabricated acknowledgement; `rejected` is a
-- DURABLE cloud verdict).
--
-- ADDITIVE EXTENSION (recorded gap G9). The canonical Hub catalogue §6.8 has no
-- Hub-local batch header; the cloud data dictionary has `kitluy_sync.sync_batches`
-- on the CLOUD side only. Without a local header there is nowhere to record
-- WHAT was signed and WHICH cloud response answered it, so an acknowledgement
-- could not be tied back to the attempt that earned it and a replayed or
-- misdirected response could not be detected. An amendment to the canonical
-- document is OWED, exactly as for the G3 extensions.
--
-- APPEND-ONLY-WITH-ONE-COMPLETION. The batch header is written when the batch
-- is signed and completed exactly once when the cloud answers. Nothing else may
-- change, so a transmission record can never be rewritten to claim a different
-- outcome than the one that happened.
-- ===========================================================================

create table edge_sync.transmission_batch (
  id                    uuid        primary key,
  tenant_id             uuid        not null,
  digital_store_id      uuid        not null,
  location_id           uuid        not null,
  assignment_generation integer     not null,
  lease_id              uuid        not null,
  lease_owner           text        not null,
  envelope_version      integer     not null,
  item_count            integer     not null,
  first_hub_sequence    bigint      not null,
  last_hub_sequence     bigint      not null,
  known_gap_count       integer     not null default 0,
  manifest_sha256       char(64)    not null,
  signature_algorithm   text        not null,
  signing_key_id        text        not null,
  signature             bytea       not null,
  sent_at               timestamptz not null,
  completed_at          timestamptz null,
  -- The CLOUD's own identity for the ingestion. NULL until the cloud answers;
  -- the Hub never mints one.
  cloud_batch_id        text        null,
  outcome               text        not null default 'in_flight',
  applied_count         integer     null,
  duplicate_count       integer     null,
  rejected_count        integer     null,
  failure_code          text        null,
  constraint transmission_batch_range_ck
    check (last_hub_sequence >= first_hub_sequence and first_hub_sequence >= 1),
  constraint transmission_batch_counts_ck
    check (item_count >= 1 and known_gap_count >= 0 and assignment_generation >= 1),
  constraint transmission_batch_manifest_ck check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint transmission_batch_outcome_ck
    check (outcome in ('in_flight', 'answered', 'failed')),
  -- An ANSWERED batch carries the cloud identity, the completion moment and a
  -- full per-outcome tally that adds up to what was sent. A batch that merely
  -- FAILED locally carries a failure code and NO cloud identity, so a transport
  -- failure can never be read as a cloud response.
  constraint transmission_batch_answered_ck
    check (outcome <> 'answered'
           or (cloud_batch_id is not null and completed_at is not null
               and applied_count is not null and duplicate_count is not null
               and rejected_count is not null
               and applied_count + duplicate_count + rejected_count = item_count)),
  constraint transmission_batch_failed_ck
    check (outcome <> 'failed'
           or (failure_code is not null and completed_at is not null
               and cloud_batch_id is null)),
  constraint transmission_batch_in_flight_ck
    check (outcome <> 'in_flight'
           or (completed_at is null and cloud_batch_id is null and failure_code is null))
);

comment on table edge_sync.transmission_batch is
  'ADDITIVE EXTENSION (gap G9) — the Hub-local header for one signed push. Records WHAT was signed (manifest hash, signing key, declared sequence range and gap count) and WHICH cloud response answered it. Amendment to the canonical document is owed.';
comment on column edge_sync.transmission_batch.cloud_batch_id is
  'The CLOUD ingestion identity. NULL until a real response arrives; the Hub never mints one (amendment §2: no fabricated acknowledgement).';
comment on column edge_sync.transmission_batch.signature is
  'Signature over the RFC 8785-canonical manifest bytes. The signing KEY never appears here or anywhere else in the database (repository rule 4).';
comment on constraint transmission_batch_failed_ck on edge_sync.transmission_batch is
  'A locally failed transmission carries no cloud identity, so "we could not send" can never be read as "the cloud answered".';

create index transmission_batch_open_idx
  on edge_sync.transmission_batch (location_id, assignment_generation, sent_at)
  where outcome = 'in_flight';
-- §8 requires every scoped relation to carry the scope index under the
-- canonical `{schema}_{table}_scope_idx` name, which the assertions check by
-- name rather than by column list.
create index edge_sync_transmission_batch_scope_idx
  on edge_sync.transmission_batch (tenant_id, digital_store_id, location_id);

-- Which batch carried which event. One event may be carried by SEVERAL batches
-- across retries; the pair is unique, so a replay is visible rather than
-- overwriting the earlier attempt's record.
create table edge_sync.transmission_batch_item (
  batch_id     uuid   not null references edge_sync.transmission_batch (id),
  event_id     uuid   not null references edge_sync.local_event (id),
  hub_sequence bigint not null,
  outcome      text   null,
  cloud_ack_id text   null,
  rejection_code text null,
  primary key (batch_id, event_id),
  constraint transmission_batch_item_outcome_ck
    check (outcome is null
           or outcome in ('applied', 'duplicate_ignored', 'rejected')),
  -- An applied or duplicate outcome REQUIRES the cloud's acknowledgement
  -- identity; a rejection REQUIRES a durable reason code. Neither can be
  -- recorded as a bare verdict.
  constraint transmission_batch_item_ack_ck
    check (outcome is null or outcome = 'rejected' or cloud_ack_id is not null),
  constraint transmission_batch_item_rejection_ck
    check (outcome is distinct from 'rejected' or rejection_code is not null)
);

comment on table edge_sync.transmission_batch_item is
  'Per-event membership and outcome for one signed batch. The same event appearing in several batches is a RETRY and stays visible as one.';

create index transmission_batch_item_event_idx
  on edge_sync.transmission_batch_item (event_id);

-- ---------------------------------------------------------------------------
-- Immutability: a transmission record is written once and completed once.
-- ---------------------------------------------------------------------------
create function edge_sync.enforce_transmission_batch_immutability()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception
      'KLUY-EDGE-TRANSMISSION-IMMUTABLE: a transmission record is never deleted; it is the evidence that a push happened'
      using errcode = 'P0001';
  end if;

  if old.outcome <> 'in_flight' then
    raise exception
      'KLUY-EDGE-TRANSMISSION-IMMUTABLE: batch % already completed as %; a transmission outcome is recorded once',
      old.id, old.outcome using errcode = 'P0001';
  end if;

  if (new.id, new.tenant_id, new.digital_store_id, new.location_id,
      new.assignment_generation, new.lease_id, new.lease_owner, new.envelope_version,
      new.item_count, new.first_hub_sequence, new.last_hub_sequence,
      new.known_gap_count, new.manifest_sha256, new.signature_algorithm,
      new.signing_key_id, new.signature, new.sent_at)
     is distinct from
     (old.id, old.tenant_id, old.digital_store_id, old.location_id,
      old.assignment_generation, old.lease_id, old.lease_owner, old.envelope_version,
      old.item_count, old.first_hub_sequence, old.last_hub_sequence,
      old.known_gap_count, old.manifest_sha256, old.signature_algorithm,
      old.signing_key_id, old.signature, old.sent_at) then
    raise exception
      'KLUY-EDGE-TRANSMISSION-IMMUTABLE: what was signed cannot be rewritten after the fact'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function edge_sync.enforce_transmission_batch_immutability() is
  'Schema contract §1 append-only discipline for the transmission ledger: exactly one in_flight -> answered|failed completion, and the signed facts are frozen.';

create trigger transmission_batch_immutability
  before update or delete on edge_sync.transmission_batch
  for each row execute function edge_sync.enforce_transmission_batch_immutability();

create trigger transmission_batch_item_no_delete
  before delete on edge_sync.transmission_batch_item
  for each row execute function edge_audit.enforce_no_hard_delete();

grant select, insert, update on
  edge_sync.transmission_batch, edge_sync.transmission_batch_item
  to kitluy_hub_runtime, kitluy_sync_worker;
grant select on edge_sync.transmission_batch, edge_sync.transmission_batch_item to kitluy_backup;
