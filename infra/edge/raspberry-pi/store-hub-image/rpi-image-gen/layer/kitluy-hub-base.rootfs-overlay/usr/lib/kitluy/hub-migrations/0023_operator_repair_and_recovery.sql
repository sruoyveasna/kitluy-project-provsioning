-- kitluy:hub:migration:0023
-- ===========================================================================
-- KitLuy Store Hub local database — audited operator repair and cursor
-- recovery.
--
-- Authority: schema contract §6.8 ("an undeliverable sync item requiring
-- operator action; a dead letter is never silently discarded"), offline
-- contract §5 (the sequence-gap ledger; a journalled burnt value is a KNOWN gap
-- and is NOT a missing event), Store Hub spec §11.5, and owner amendment
-- KLD-2026-07-28-001-A01 §5 (an authorized actor, a reason, prior and resulting
-- states, immutable audit, and correlation to the repair).
--
-- WHAT A REPAIR MAY AND MAY NOT DO. A repair puts an item back in the queue. It
-- does NOT decide the item was fine, and it does NOT clear the conflict
-- dimension — that stays governed separately (0015). So a repaired dead letter
-- returns to `retry_wait` with its reconciliation still raised, and the operator
-- who repaired the transport has not thereby declared the divergence resolved.
-- ===========================================================================

alter table edge_sync.dead_letter_item
  add column resolved_by       uuid null,
  add column resolution_action text null,
  add column resolution_reason text null;

comment on column edge_sync.dead_letter_item.resolved_by is
  'The AUTHORIZED ACTOR who resolved it. A resolution with no actor is not a resolution (amendment §5).';
comment on column edge_sync.dead_letter_item.resolution_action is
  'requeued — put back in the delivery queue. Abandonment is deliberately NOT a value here: accepting permanent loss of a recorded business effect needs an owner-approved permission key that does not exist (KLREQ-030).';

alter table edge_sync.dead_letter_item
  add constraint dead_letter_item_resolution_evidence_ck
    check (resolved_at is null
           or (resolved_by is not null and resolution_action is not null
               and resolution_reason is not null)),
  add constraint dead_letter_item_resolution_action_ck
    check (resolution_action is null or resolution_action in ('requeued'));

comment on constraint dead_letter_item_resolution_evidence_ck on edge_sync.dead_letter_item is
  'Amendment §5: a resolved dead letter names WHO resolved it, WHAT they did and WHY. The storage layer makes the evidence non-optional rather than trusting the caller to supply it.';

-- ---------------------------------------------------------------------------
-- edge_sync.requeue_dead_letter — the ONE repair action.
--
-- Returns the item to `retry_wait` with a fresh attempt window. It does NOT
-- reset attempt_count: the attempts happened, and hiding them would let the
-- same item cycle through dead-lettering forever while looking new each time.
-- ---------------------------------------------------------------------------
create function edge_sync.requeue_dead_letter(
  p_dead_letter_id uuid,
  p_actor_id       uuid,
  p_reason         text,
  p_delay_seconds  integer default 0
) returns uuid
language plpgsql
as $$
declare
  v_item  edge_sync.dead_letter_item%rowtype;
  v_row   edge_sync.outbox%rowtype;
begin
  if p_actor_id is null then
    raise exception
      'KLUY-EDGE-REPAIR-ACTOR-REQUIRED: an operator repair names the authorized actor (KLD-2026-07-28-001-A01 §5)'
      using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-REPAIR-REASON-REQUIRED: an operator repair always states why'
      using errcode = 'P0001';
  end if;

  select * into v_item from edge_sync.dead_letter_item where id = p_dead_letter_id for update;
  if not found then
    raise exception 'KLUY-EDGE-DEAD-LETTER-UNKNOWN: no dead-letter item %', p_dead_letter_id
      using errcode = 'P0001';
  end if;
  if v_item.resolved_at is not null then
    raise exception 'KLUY-EDGE-DEAD-LETTER-ALREADY-RESOLVED: item % was resolved at %',
      p_dead_letter_id, v_item.resolved_at using errcode = 'P0001';
  end if;
  if v_item.source_kind <> 'outbox' then
    raise exception 'KLUY-EDGE-REPAIR-UNSUPPORTED-SOURCE: % items are not requeued by this path',
      v_item.source_kind using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = v_item.source_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', v_item.source_id
      using errcode = 'P0001';
  end if;
  if v_row.delivery_state <> 'dead_letter' then
    raise exception
      'KLUY-EDGE-REPAIR-NOT-DEAD-LETTERED: event % is %, not dead_letter; there is nothing to requeue',
      v_item.source_id, v_row.delivery_state using errcode = 'P0001';
  end if;

  -- The DELIVERY dimension only. The conflict dimension stays exactly where it
  -- is: repairing transport is not declaring a divergence resolved.
  update edge_sync.outbox
     set delivery_state     = 'retry_wait',
         next_attempt_at    = now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0)),
         last_error_code    = 'EDGE_OPERATOR_REQUEUED',
         dead_letter_reason = null
   where event_id = v_item.source_id;

  update edge_sync.dead_letter_item
     set resolved_at              = now(),
         resolved_by              = p_actor_id,
         resolution_action        = 'requeued',
         resolution_reason        = p_reason,
         resolution_note          = p_reason,
         operator_action_required = false
   where id = p_dead_letter_id;

  return v_item.source_id;
end;
$$;

comment on function edge_sync.requeue_dead_letter(uuid, uuid, text, integer) is
  'Audited operator repair. Requires an authorized actor and a reason; returns the item to retry_wait WITHOUT resetting attempt_count and WITHOUT touching the conflict dimension. The caller writes the immutable edge_audit.audit_event row in the same transaction.';

-- ---------------------------------------------------------------------------
-- edge_sync.recover_sync_cursor — rebuild a cursor from what actually happened.
--
-- Used after a crash or restart, when the cursor may lag the outbox. Both
-- positions are derived from stored rows rather than remembered in process:
--
--   pushed        the highest hub_sequence that has ever left `pending` — an
--                 attempt was made, which is what "pushed" claims.
--   acknowledged  the highest position such that EVERY ROW OF THIS STREAM up to
--                 it is acknowledged. It stops at the first unacknowledged row.
--
-- CONTIGUITY IS OVER THE STREAM'S OWN ROWS, NOT OVER THE INTEGERS.
-- `edge_sync.hub_sequence_seq` is ONE allocator for the whole Hub (offline §5)
-- while ordering is per `(location_id, assignment_generation)` (§5.1), so a
-- stream's sequences are SPARSE by construction: the values missing between two
-- of its rows usually belong to another stream. An earlier draft required every
-- integer in between to be a journalled gap and therefore broke contiguity
-- whenever any other stream had taken a sequence — a test caught it under
-- parallel load. The sequence-gap ledger answers a different question (which
-- burnt values are KNOWN and must never be chased as missing events); it is not
-- needed to establish this stream's order, because the stream's own rows
-- already are that order.
--
-- The result can only move a cursor FORWARD (advance_sync_cursor is monotonic),
-- so recovery can never un-record progress.
-- ---------------------------------------------------------------------------
create function edge_sync.recover_sync_cursor(
  p_location_id           uuid,
  p_assignment_generation integer,
  p_stream_code           text
) returns table (recovered_pushed bigint, recovered_acked bigint)
language plpgsql
as $$
declare
  r        record;
  v_pushed bigint := 0;
  v_acked  bigint := 0;
begin
  select coalesce(max(hub_sequence), 0) into v_pushed
    from edge_sync.outbox
   where location_id = p_location_id
     and assignment_generation = p_assignment_generation
     and delivery_state <> 'pending';

  for r in
    select o.hub_sequence, o.delivery_state
      from edge_sync.outbox o
     where o.location_id = p_location_id
       and o.assignment_generation = p_assignment_generation
     order by o.hub_sequence
  loop
    exit when r.delivery_state <> 'acknowledged';
    v_acked := r.hub_sequence;
  end loop;

  perform edge_sync.advance_sync_cursor(p_location_id, p_stream_code, v_pushed, v_acked);
  recovered_pushed := v_pushed;
  recovered_acked := v_acked;
  return next;
end;
$$;

comment on function edge_sync.recover_sync_cursor(uuid, integer, text) is
  'Rebuilds a stream cursor from stored rows after a crash or restart. Contiguity is over THIS STREAM''S OWN ROWS, not over the integers: the Hub sequence is one allocator for the whole Hub while ordering is per stream, so absent values usually belong elsewhere. Advances monotonically, so recovery can never un-record progress.';

-- ---------------------------------------------------------------------------
-- Observability. Counts BOTH dimensions and reports what is actually true —
-- including that a stream is BLOCKED, which a queue depth alone cannot say.
-- ---------------------------------------------------------------------------
create view edge_sync.stream_health as
select o.location_id,
       o.assignment_generation,
       count(*)                                                   as total_items,
       count(*) filter (where o.delivery_state = 'pending')        as pending_items,
       count(*) filter (where o.delivery_state = 'in_flight')      as in_flight_items,
       count(*) filter (where o.delivery_state = 'retry_wait')     as retry_wait_items,
       count(*) filter (where o.delivery_state = 'acknowledged')   as acknowledged_items,
       count(*) filter (where o.delivery_state = 'rejected')       as rejected_items,
       count(*) filter (where o.delivery_state = 'dead_letter')    as dead_letter_items,
       count(*) filter (where o.reconciliation_state = 'required') as reconciliation_required_items,
       min(o.hub_sequence) filter (where o.delivery_state <> 'acknowledged')
         as oldest_unacknowledged_sequence,
       max(o.hub_sequence)                                         as last_sequence,
       min(o.next_attempt_at) filter (where o.delivery_state = 'retry_wait')
         as next_retry_at
from edge_sync.outbox o
group by o.location_id, o.assignment_generation;

comment on view edge_sync.stream_health is
  'Per-stream delivery and conflict counts. Reports BOTH dimensions so "the queue is short" can never be mistaken for "nothing needs attention": an acknowledged item with a raised reconciliation is counted in both.';

grant select on edge_sync.stream_health to kitluy_hub_runtime, kitluy_sync_worker, kitluy_support_ro;

revoke execute on function
  edge_sync.requeue_dead_letter(uuid, uuid, text, integer),
  edge_sync.recover_sync_cursor(uuid, integer, text)
  from public;

grant execute on function edge_sync.requeue_dead_letter(uuid, uuid, text, integer)
  to kitluy_hub_runtime;
grant execute on function edge_sync.recover_sync_cursor(uuid, integer, text)
  to kitluy_hub_runtime, kitluy_sync_worker;
