-- kitluy:hub:migration:0026
-- ===========================================================================
-- KitLuy Store Hub local database — align WS-10 with amendment
-- KLD-2026-07-28-001-A01 §2, §3 and §6.
--
-- IMPLEMENTER DIVERGENCE, found by re-reading the amendment against the running
-- database and corrected here. Three separate departures from the owner ruling
-- were shipped in 0015/0019, all of them my invention rather than the
-- amendment's text:
--
--   D1  THE EXTERNAL PROJECTION WAS WRONG ON THREE OF SIX ROWS. §3 publishes an
--       explicit six-value table. I collapsed `in_flight` and `retry_wait` into
--       `pending_cloud_sync` and mapped `dead_letter` to
--       `reconciliation_required`, reasoning that the approved five-value
--       COMMAND sync-state registry forbade a sixth value. That reasoning
--       confused two different subjects: the command-level `sync_state` on
--       `edge_sync.command_result` describes a COMMAND outcome, while §3
--       describes the operator/API-facing status of an OUTBOX ROW. The
--       amendment names six values for the latter and they are adopted verbatim
--       here. `edge_sync.command_result.sync_state` is UNCHANGED.
--
--   D2  `dead_letter` ALWAYS REPORTED A CONFLICT. Because of D1 the projection
--       could never return `delivery_failed`, and 0019's
--       `dead_letter_outbox_event` additionally REQUIRED a conflict id, so it
--       forced the conflict dimension up on every dead letter. §2 gives
--       `delivery_state = dead_letter, conflict_state = none` as an EXPLICIT
--       valid combination — "delivery failed repeatedly, but no authoritative
--       business conflict has yet been established". My rule made that state
--       unreachable. The conflict is now OPTIONAL: raised when a business
--       conflict genuinely exists, omitted when delivery simply failed. Operator
--       attention is carried by `dead_letter` itself, which is what §1 says it
--       means, and by the `dead_letter_item` record, which is still always
--       written.
--
--   D3  INVALID TRANSITIONS WERE NOT REFUSED. §6 requires a specific set to fail
--       closed. Nothing stopped `pending -> acknowledged`, so an acknowledgement
--       could be recorded for a row that had never been transmitted — the exact
--       "no fabricated acknowledgement" failure the rest of the cycle guards
--       elsewhere. A transition guard is added below.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- D1 — the projection, verbatim from §3.
--
-- Conflict override FIRST, then the six-value delivery mapping.
-- ---------------------------------------------------------------------------
create or replace function edge_sync.external_sync_status(
  p_delivery_state       edge_sync.delivery_state,
  p_reconciliation_state edge_sync.reconciliation_state
) returns text
language sql
immutable
strict
parallel safe
as $$
  select case
           -- §3 "First: conflict override" — reported regardless of whether the
           -- delivery state is acknowledged, rejected or dead_letter.
           when p_reconciliation_state = 'required' then 'reconciliation_required'
           -- §3 "Otherwise: delivery-state mapping", verbatim.
           when p_delivery_state = 'pending'      then 'pending_cloud_sync'
           when p_delivery_state = 'in_flight'    then 'sync_in_progress'
           when p_delivery_state = 'retry_wait'   then 'retry_scheduled'
           when p_delivery_state = 'acknowledged' then 'cloud_acknowledged'
           when p_delivery_state = 'rejected'     then 'cloud_rejected'
           when p_delivery_state = 'dead_letter'  then 'delivery_failed'
         end;
$$;

comment on function edge_sync.external_sync_status(edge_sync.delivery_state, edge_sync.reconciliation_state) is
  'THE shared external-status projection, verbatim from amendment KLD-2026-07-28-001-A01 §3: conflict override first, then the six-value delivery mapping (pending_cloud_sync, sync_in_progress, retry_scheduled, cloud_acknowledged, cloud_rejected, delivery_failed). CORRECTION: the 0015 version collapsed in_flight and retry_wait into pending_cloud_sync and mapped dead_letter to reconciliation_required, on the mistaken ground that the five-value COMMAND sync-state registry applied here. It does not — that registry describes a COMMAND outcome (edge_sync.command_result.sync_state, unchanged), while this describes an OUTBOX ROW.';

-- ---------------------------------------------------------------------------
-- D2 — a dead letter may stand WITHOUT a business conflict (§2).
--
-- The conflict id becomes optional. The dead_letter_item is still always
-- written, so the operator obligation §1 describes is never lost.
-- ---------------------------------------------------------------------------
create or replace function edge_sync.dead_letter_outbox_event(
  p_event_id    uuid,
  p_lease_id    uuid,
  p_reason      text,
  p_error_code  text,
  p_conflict_id uuid default null
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

  -- ALWAYS written: a dead letter is never silently discarded (§6.8). This is
  -- what carries the operator obligation, not the conflict dimension.
  insert into edge_sync.dead_letter_item
    (id, tenant_id, digital_store_id, location_id, source_kind, source_id, error_code,
     error_message, payload_sha256, first_failed_at, last_failed_at, attempt_count,
     operator_action_required)
  values
    (gen_random_uuid(), v_row.tenant_id, v_row.digital_store_id, v_row.location_id,
     'outbox', p_event_id, coalesce(p_error_code, v_row.last_error_code, 'EDGE_DELIVERY_EXHAUSTED'),
     p_reason, v_event.payload_sha256,
     coalesce(v_row.last_attempt_at, now()), now(), greatest(v_row.attempt_count, 1), true);

  -- OPTIONAL (amendment §2): raised only when a business conflict genuinely
  -- exists. `dead_letter + none` is a valid state — "delivery failed
  -- repeatedly, but no authoritative business conflict has yet been
  -- established" — and forcing a conflict here made it unreachable.
  if p_conflict_id is not null then
    perform edge_sync.raise_reconciliation(p_event_id, p_conflict_id, p_reason);
  end if;
  return true;
end;
$$;

comment on function edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid) is
  'Exhausts an item into dead_letter and ALWAYS writes the operator-facing dead_letter_item (§6.8). The conflict dimension is raised only when a business conflict exists: amendment §2 gives `dead_letter + none` as a valid state, so requiring a conflict (as 0019 did) made a state the owner named unreachable.';

-- ---------------------------------------------------------------------------
-- D3 — §6 invalid transitions fail closed.
--
-- LEGAL delivery transitions:
--   pending      -> in_flight
--   in_flight    -> acknowledged | rejected | retry_wait | dead_letter
--   retry_wait   -> in_flight | dead_letter
--   dead_letter  -> retry_wait          (authorized repair; requeue_dead_letter)
--   acknowledged -> (terminal)
--   rejected     -> (terminal)
--
-- Everything else is refused, which covers every case §6 names:
--   pending      -> acknowledged   no transmission attempt ever happened
--   retry_wait   -> acknowledged   no NEW attempt; it must pass through in_flight
--   acknowledged -> in_flight      a recorded cloud decision is not reopened
--   rejected     -> acknowledged   likewise; no audited repair path exists yet
--   dead_letter  -> pending        repair returns it to retry_wait, not the head
-- ---------------------------------------------------------------------------
create function edge_sync.enforce_delivery_transition()
returns trigger
language plpgsql
as $$
declare
  v_legal boolean;
begin
  if new.delivery_state = old.delivery_state then
    return new;
  end if;

  v_legal := case old.delivery_state
    when 'pending'      then new.delivery_state = 'in_flight'
    when 'in_flight'    then new.delivery_state in ('acknowledged', 'rejected', 'retry_wait', 'dead_letter')
    when 'retry_wait'   then new.delivery_state in ('in_flight', 'dead_letter')
    when 'dead_letter'  then new.delivery_state = 'retry_wait'
    -- acknowledged and rejected are TERMINAL: the cloud has answered, and the
    -- Hub does not rewrite a recorded cloud decision.
    else false
  end;

  if not v_legal then
    raise exception
      'KLUY-EDGE-INVALID-DELIVERY-TRANSITION: % -> % is not a legal delivery transition (KLD-2026-07-28-001-A01 §6). An acknowledgement requires a transmission attempt, and acknowledged/rejected are terminal.',
      old.delivery_state, new.delivery_state using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function edge_sync.enforce_delivery_transition() is
  'Amendment KLD-2026-07-28-001-A01 §6: invalid delivery transitions fail closed. Most importantly pending -> acknowledged and retry_wait -> acknowledged, which would record a cloud acknowledgement for a row that was never transmitted on this attempt — the same fabrication the ack constraints guard from the other direction.';

create trigger outbox_delivery_transition
  before update on edge_sync.outbox
  for each row execute function edge_sync.enforce_delivery_transition();

revoke execute on function
  edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid)
  from public;
grant execute on function edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;
