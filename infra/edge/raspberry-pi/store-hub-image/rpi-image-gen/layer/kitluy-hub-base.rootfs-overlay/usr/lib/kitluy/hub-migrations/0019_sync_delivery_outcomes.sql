-- kitluy:hub:migration:0019
-- ===========================================================================
-- KitLuy Store Hub local database — WS-10 delivery OUTCOMES.
--
-- Authority: Store Hub spec §11.5 (acknowledgement, retry and dead-letter),
-- schema contract §6.8 (`dead_letter_item` — "an undeliverable sync item
-- requiring operator action; a dead letter is never silently discarded"), owner
-- amendment KLD-2026-07-28-001-A01 §2 (`rejected` is a DURABLE cloud rejection;
-- no fabricated acknowledgement) and §3 (the two dimensions move separately).
--
-- THE FOUR OUTCOMES, and what each one is allowed to mean:
--
--   acknowledged  the cloud ANSWERED and accepted. Requires the cloud's own
--                 acknowledgement identity — the Hub mints none, so an
--                 acknowledgement in this ledger always traces to a real cloud
--                 decision (0009 outbox_ack_ck, unchanged).
--   rejected      the cloud ANSWERED and refused, durably. Requires a code
--                 from the durable set; a transport failure cannot reach here
--                 because `defer` is the only path a transport failure has.
--   retry_wait    NO answer was observed. Backoff, attempt history preserved.
--   dead_letter   retries are exhausted. Requires a reason, a dead-letter
--                 record for the operator, AND the conflict dimension raised —
--                 a dead letter that nobody has to act on is a silent discard.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Durable rejection codes. Kept in the database rather than only in TypeScript
-- so a direct SQL path cannot record a transport failure as a cloud verdict.
-- ---------------------------------------------------------------------------
create function edge_sync.is_durable_rejection_code(p_code text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select p_code in (
    'EDGE_CLOUD_REJECTED_SCHEMA',
    'EDGE_CLOUD_REJECTED_SCOPE',
    'EDGE_CLOUD_REJECTED_SIGNATURE',
    'EDGE_CLOUD_REJECTED_BUSINESS_RULE',
    'EDGE_CLOUD_REJECTED_UNKNOWN_AGGREGATE',
    'EDGE_CLOUD_REJECTED_PERMANENT'
  );
$$;

comment on function edge_sync.is_durable_rejection_code(text) is
  'Amendment KLD-2026-07-28-001-A01 §2: only a DURABLE cloud verdict may drive delivery_state=rejected. A temporary network error, rate limiting, a scheduled retry, an in-progress attempt, a local operator pause and an unverified timeout are all absent from this list by design.';

-- ---------------------------------------------------------------------------
-- edge_sync.acknowledge_outbox_event — the ONLY path to `acknowledged`.
-- ---------------------------------------------------------------------------
create function edge_sync.acknowledge_outbox_event(
  p_event_id     uuid,
  p_lease_id     uuid,
  p_cloud_ack_id text
) returns boolean
language plpgsql
as $$
declare
  v_row     edge_sync.outbox%rowtype;
  v_updated integer;
begin
  if p_cloud_ack_id is null or btrim(p_cloud_ack_id) = '' then
    raise exception
      'KLUY-EDGE-ACK-IDENTITY-REQUIRED: an acknowledgement carries the CLOUD acknowledgement identity; the Hub mints none (amendment §2)'
      using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  if v_row.delivery_state = 'acknowledged' then
    -- A redelivered acknowledgement for an already-acknowledged row is a
    -- no-op, not an error: the cloud re-reporting its own earlier decision is
    -- exactly what an idempotent protocol looks like.
    return false;
  end if;

  update edge_sync.outbox
     set delivery_state   = 'acknowledged',
         cloud_ack_id     = p_cloud_ack_id,
         acknowledged_at  = now(),
         last_error_code  = null,
         lease_id         = null,
         lease_owner      = null,
         leased_at        = null,
         lease_expires_at = null
   where event_id = p_event_id
     and (p_lease_id is null or lease_id = p_lease_id);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception
      'KLUY-EDGE-ACK-UNMATCHED-LEASE: the acknowledgement does not match the attempt that owns event %',
      p_event_id using errcode = 'P0001';
  end if;
  return true;
end;
$$;

comment on function edge_sync.acknowledge_outbox_event(uuid, uuid, text) is
  'Records a REAL cloud acknowledgement. Requires the cloud acknowledgement identity and the lease of the attempt that earned it, so an acknowledgement can neither be fabricated nor attributed to the wrong attempt.';

-- ---------------------------------------------------------------------------
-- edge_sync.reject_outbox_event — the ONLY path to `rejected`.
-- ---------------------------------------------------------------------------
create function edge_sync.reject_outbox_event(
  p_event_id  uuid,
  p_lease_id  uuid,
  p_code      text,
  p_reason    text default null
) returns boolean
language plpgsql
as $$
declare
  v_row     edge_sync.outbox%rowtype;
  v_updated integer;
begin
  if not edge_sync.is_durable_rejection_code(p_code) then
    raise exception
      'KLUY-EDGE-REJECTION-NOT-DURABLE: ''%'' is not a durable cloud rejection; a transport failure, a timeout or an operator pause belongs in retry_wait (amendment §2)',
      p_code using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  if v_row.delivery_state = 'rejected' then
    return false;
  end if;
  if v_row.delivery_state = 'acknowledged' then
    raise exception
      'KLUY-EDGE-ACK-ALREADY-RECORDED: event % was acknowledged; a later rejection would rewrite a cloud decision the Hub already recorded',
      p_event_id using errcode = 'P0001';
  end if;

  update edge_sync.outbox
     set delivery_state   = 'rejected',
         rejected_at      = now(),
         last_error_code  = p_code,
         lease_id         = null,
         lease_owner      = null,
         leased_at        = null,
         lease_expires_at = null
   where event_id = p_event_id
     and (p_lease_id is null or lease_id = p_lease_id);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception
      'KLUY-EDGE-ACK-UNMATCHED-LEASE: the rejection does not match the attempt that owns event %',
      p_event_id using errcode = 'P0001';
  end if;
  return true;
end;
$$;

comment on function edge_sync.reject_outbox_event(uuid, uuid, text, text) is
  'Records a DURABLE cloud rejection. The code must be in the durable set, and an already-acknowledged row can never be rejected afterwards — a recorded cloud decision is not rewritten.';

-- ---------------------------------------------------------------------------
-- edge_sync.defer_outbox_event — NO answer observed. Backoff, no verdict.
--
-- The backoff is computed here rather than by the caller so every deferral in
-- the Hub grows the same way and a caller cannot accidentally retry a failing
-- endpoint at full speed.
-- ---------------------------------------------------------------------------
create function edge_sync.defer_outbox_event(
  p_event_id       uuid,
  p_lease_id       uuid,
  p_code           text,
  p_base_seconds   integer default 5,
  p_max_seconds    integer default 900
) returns timestamptz
language plpgsql
as $$
declare
  v_row     edge_sync.outbox%rowtype;
  v_delay   integer;
  v_next    timestamptz;
  v_updated integer;
begin
  if edge_sync.is_durable_rejection_code(p_code) then
    raise exception
      'KLUY-EDGE-DEFERRAL-NOT-TRANSIENT: ''%'' is a durable cloud rejection and must be recorded as one, not deferred',
      p_code using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;

  -- Exponential with a ceiling. INTEGER arithmetic throughout: a bit shift
  -- rather than `2 ^ n`, which would evaluate in double precision. The shift is
  -- clamped to 20 so `base << shift` cannot overflow int4.
  v_delay := least(p_max_seconds,
                   p_base_seconds * (1 << least(greatest(v_row.attempt_count - 1, 0), 20)));
  v_next := now() + make_interval(secs => v_delay);

  update edge_sync.outbox
     set delivery_state   = 'retry_wait',
         next_attempt_at  = v_next,
         last_error_code  = p_code,
         lease_id         = null,
         lease_owner      = null,
         leased_at        = null,
         lease_expires_at = null
   where event_id = p_event_id
     and delivery_state <> 'acknowledged'
     and (p_lease_id is null or lease_id = p_lease_id);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception
      'KLUY-EDGE-ACK-UNMATCHED-LEASE: the deferral does not match the attempt that owns event %, or the row is already acknowledged',
      p_event_id using errcode = 'P0001';
  end if;
  return v_next;
end;
$$;

comment on function edge_sync.defer_outbox_event(uuid, uuid, text, integer, integer) is
  'Schedules the next attempt after an UNANSWERED one. Exponential backoff with a ceiling, attempt history preserved, and NO cloud outcome claimed — a durable rejection code is refused here on purpose.';

-- ---------------------------------------------------------------------------
-- edge_sync.dead_letter_outbox_event — retries exhausted.
--
-- Writes the operator-facing dead-letter record AND raises the conflict
-- dimension in the SAME transaction. The two are separate statements because
-- the dimensions transition independently (amendment §3); they are inseparable
-- in EFFECT because a dead letter nobody has to act on is a silent discard.
-- ---------------------------------------------------------------------------
create function edge_sync.dead_letter_outbox_event(
  p_event_id     uuid,
  p_lease_id     uuid,
  p_reason       text,
  p_error_code   text,
  p_conflict_id  uuid
) returns boolean
language plpgsql
as $$
declare
  v_row     edge_sync.outbox%rowtype;
  v_event   edge_sync.local_event%rowtype;
  v_updated integer;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-DEAD-LETTER-REASON-REQUIRED: a dead letter always states why'
      using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  if v_row.delivery_state = 'acknowledged' then
    raise exception
      'KLUY-EDGE-ACK-ALREADY-RECORDED: event % was acknowledged and cannot be dead-lettered',
      p_event_id using errcode = 'P0001';
  end if;
  select * into v_event from edge_sync.local_event where id = p_event_id;

  update edge_sync.outbox
     set delivery_state     = 'dead_letter',
         dead_letter_reason = p_reason,
         last_error_code    = coalesce(p_error_code, v_row.last_error_code),
         lease_id           = null,
         lease_owner        = null,
         leased_at          = null,
         lease_expires_at   = null
   where event_id = p_event_id
     and (p_lease_id is null or lease_id = p_lease_id);
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception
      'KLUY-EDGE-ACK-UNMATCHED-LEASE: the dead-letter does not match the attempt that owns event %',
      p_event_id using errcode = 'P0001';
  end if;

  insert into edge_sync.dead_letter_item
    (id, tenant_id, digital_store_id, location_id, source_kind, source_id, error_code,
     error_message, payload_sha256, first_failed_at, last_failed_at, attempt_count,
     operator_action_required)
  values
    (gen_random_uuid(), v_row.tenant_id, v_row.digital_store_id, v_row.location_id,
     'outbox', p_event_id, coalesce(p_error_code, v_row.last_error_code, 'EDGE_DELIVERY_EXHAUSTED'),
     p_reason, v_event.payload_sha256,
     coalesce(v_row.last_attempt_at, now()), now(), greatest(v_row.attempt_count, 1), true);

  -- SEPARATE statement, governed path: the conflict dimension is raised so the
  -- item appears as reconciliation_required to every consumer of the shared
  -- external projection.
  perform edge_sync.raise_reconciliation(p_event_id, p_conflict_id, p_reason);
  return true;
end;
$$;

comment on function edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid) is
  'Exhausts an item into dead_letter, writes the operator-facing dead_letter_item and RAISES the conflict dimension in the same transaction (§6.8 "a dead letter is never silently discarded"). Delivery and conflict move in separate statements, as amendment §3 requires.';

-- ---------------------------------------------------------------------------
-- Cursors advance ONLY on real progress.
-- ---------------------------------------------------------------------------
create function edge_sync.advance_sync_cursor(
  p_location_id  uuid,
  p_stream_code  text,
  p_pushed       bigint default null,
  p_acked        bigint default null
) returns void
language plpgsql
as $$
begin
  insert into edge_sync.sync_cursor
    (location_id, stream_code, last_pushed_hub_sequence, last_acked_hub_sequence, updated_at)
  values (p_location_id, p_stream_code, coalesce(p_pushed, 0), coalesce(p_acked, 0), now())
  on conflict (location_id, stream_code) do update
    -- MONOTONIC: a cursor never moves backwards, so a late or reordered report
    -- cannot un-record progress that already happened.
    set last_pushed_hub_sequence =
          greatest(edge_sync.sync_cursor.last_pushed_hub_sequence, coalesce(p_pushed, 0)),
        last_acked_hub_sequence =
          greatest(edge_sync.sync_cursor.last_acked_hub_sequence, coalesce(p_acked, 0)),
        updated_at = now();
end;
$$;

comment on function edge_sync.advance_sync_cursor(uuid, text, bigint, bigint) is
  'Monotonic cursor advance. The 0009 sync_cursor_push_order_ck still refuses an acknowledged position beyond a pushed one, so a cursor can never claim more progress than actually happened.';

grant execute on function
  edge_sync.is_durable_rejection_code(text),
  edge_sync.acknowledge_outbox_event(uuid, uuid, text),
  edge_sync.reject_outbox_event(uuid, uuid, text, text),
  edge_sync.defer_outbox_event(uuid, uuid, text, integer, integer),
  edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid),
  edge_sync.advance_sync_cursor(uuid, text, bigint, bigint)
  to kitluy_hub_runtime, kitluy_sync_worker;
