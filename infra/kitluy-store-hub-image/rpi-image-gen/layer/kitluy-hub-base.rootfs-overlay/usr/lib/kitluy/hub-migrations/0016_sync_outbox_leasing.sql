-- kitluy:hub:migration:0016
-- ===========================================================================
-- KitLuy Store Hub local database — WS-10 outbox leasing (pending -> in_flight).
--
-- Authority: Store Hub spec §11.5 (oldest-unacknowledged-first push ordering),
-- kitluy-offline-idempotency-and-sequencing-v1.0.0.md §5.1 (the ordering
-- namespace is (location_id, assignment_generation, hub_sequence)), owner
-- amendment KLD-2026-07-28-001-A01 §2 (in_flight = an attempt is in progress)
-- and §3 (the two state dimensions transition independently).
--
-- WHY A LEASE. `in_flight` is only safe if exactly one worker owns the attempt.
-- Without an owner and an expiry, a worker that dies mid-attempt leaves rows
-- stranded in `in_flight` forever, and a second worker cannot tell "someone is
-- sending this" from "someone died sending this". The lease makes both
-- answerable, and expiry makes recovery automatic without inventing a cloud
-- verdict.
-- ===========================================================================

alter table edge_sync.outbox
  add column lease_id         uuid        null,
  add column lease_owner      text        null,
  add column leased_at        timestamptz null,
  add column lease_expires_at timestamptz null;

comment on column edge_sync.outbox.lease_id is
  'Identity of the delivery attempt that owns this row. Carried on the wire so a cloud acknowledgement can be matched to the attempt that produced it.';
comment on column edge_sync.outbox.lease_owner is
  'Which worker holds the lease. Operational identity only — never a credential (repository rule 4).';
comment on column edge_sync.outbox.lease_expires_at is
  'When the lease may be reclaimed. Expiry NEVER implies a cloud outcome: a reclaimed row returns to the queue with its attempt history intact, it is not marked rejected.';

alter table edge_sync.outbox
  -- in_flight means "an owned attempt is in progress"; the four lease columns
  -- are present exactly then and absent otherwise. A row cannot be in_flight
  -- with nobody responsible for it, and a released row keeps no stale owner.
  add constraint outbox_lease_ck
    check ((delivery_state = 'in_flight')
           = (lease_id is not null and lease_owner is not null
              and leased_at is not null and lease_expires_at is not null)),
  add constraint outbox_lease_window_ck
    check (lease_expires_at is null or leased_at is null or lease_expires_at > leased_at);

comment on constraint outbox_lease_ck on edge_sync.outbox is
  'Amendment §2: in_flight is a TRANSPORT state with an owner. No unowned in_flight row can exist, so a stalled attempt is always attributable.';

-- Leasing scans the ordered queue head; this index makes the head cheap.
create index outbox_lease_queue_idx
  on edge_sync.outbox (location_id, assignment_generation, hub_sequence)
  where delivery_state <> 'acknowledged';

-- ---------------------------------------------------------------------------
-- Complete the dimension-independence check with the lease columns.
--
-- 0015 is APPLIED and its bytes are frozen (§4), so the function is replaced
-- forward here. The lease columns belong to the DELIVERY dimension: adding
-- them closes the theoretical path where one statement moved a lease and the
-- conflict dimension together.
-- ---------------------------------------------------------------------------
create or replace function edge_sync.enforce_state_dimension_independence()
returns trigger
language plpgsql
as $$
declare
  v_conflict_changed boolean;
  v_delivery_changed boolean;
begin
  v_conflict_changed := (
      new.reconciliation_state, new.reconciliation_conflict_id, new.reconciliation_raised_at,
      new.reconciliation_raised_reason, new.reconciliation_cleared_at,
      new.reconciliation_cleared_by, new.reconciliation_cleared_authority,
      new.reconciliation_clearing_reason, new.reconciliation_clearing_event_id
    ) is distinct from (
      old.reconciliation_state, old.reconciliation_conflict_id, old.reconciliation_raised_at,
      old.reconciliation_raised_reason, old.reconciliation_cleared_at,
      old.reconciliation_cleared_by, old.reconciliation_cleared_authority,
      old.reconciliation_clearing_reason, old.reconciliation_clearing_event_id
    );

  v_delivery_changed := (
      new.delivery_state, new.attempt_count, new.next_attempt_at, new.last_attempt_at,
      new.last_error_code, new.cloud_ack_id, new.acknowledged_at, new.rejected_at,
      new.dead_letter_reason, new.lease_id, new.lease_owner, new.leased_at,
      new.lease_expires_at
    ) is distinct from (
      old.delivery_state, old.attempt_count, old.next_attempt_at, old.last_attempt_at,
      old.last_error_code, old.cloud_ack_id, old.acknowledged_at, old.rejected_at,
      old.dead_letter_reason, old.lease_id, old.lease_owner, old.leased_at,
      old.lease_expires_at
    );

  if not v_conflict_changed then
    return new;
  end if;

  if coalesce(current_setting('kitluy.reconciliation_governed', true), '') <> 'on' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-GOVERNED: the conflict dimension moves only through edge_sync.raise_reconciliation / edge_sync.clear_reconciliation (KLD-2026-07-28-001-A01 §5); a delivery worker may not clear reconciliation_required'
      using errcode = 'P0001';
  end if;

  if v_delivery_changed then
    raise exception
      'KLUY-EDGE-STATE-DIMENSIONS-INDEPENDENT: delivery state and conflict state transition independently (KLD-2026-07-28-001-A01 §3); move them in separate statements'
      using errcode = 'P0001';
  end if;

  if old.reconciliation_state = 'required' and new.reconciliation_state = 'none' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-NOT-DISCARDABLE: a raised reconciliation is closed by clearing it with evidence, never by resetting it to none'
      using errcode = 'P0001';
  end if;

  if old.reconciliation_state = 'cleared' and new.reconciliation_state = 'required'
     and new.reconciliation_conflict_id is not distinct from old.reconciliation_conflict_id then
    raise exception
      'KLUY-EDGE-RECONCILIATION-STALE-CONFLICT: re-raising after clearance requires a NEW sync_conflict record, not the already-resolved one'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The leased batch item — the outbox row joined to its immutable event, which
-- is everything a transmission needs and nothing more.
-- ---------------------------------------------------------------------------
create type edge_sync.outbox_lease_item as (
  event_id              uuid,
  hub_sequence          bigint,
  assignment_generation integer,
  attempt_count         integer,
  tenant_id             uuid,
  digital_store_id      uuid,
  location_id           uuid,
  origin_device_id      uuid,
  aggregate_type        text,
  aggregate_id          uuid,
  aggregate_version     bigint,
  event_type            text,
  schema_version        integer,
  business_date         date,
  occurred_at           timestamptz,
  idempotency_key       text,
  payload_sha256        char(64),
  payload               jsonb
);

-- ---------------------------------------------------------------------------
-- edge_sync.lease_outbox_batch — claim a bounded, ORDERED batch.
--
-- ORDERING (Hub spec §11.5, offline §5.1). The scan walks
-- (assignment_generation, hub_sequence) ascending and STOPS rather than
-- skipping, because skipping past an undelivered item silently reorders the
-- stream. The only rows it steps over are ones that can never be acknowledged:
--
--   acknowledged            done, nothing to send
--   rejected                a DURABLE cloud verdict already exists (§2); the
--                           cloud has answered and will not answer again
--   dead_letter             terminal; the conflict dimension carries the
--                           operator obligation, so it is not lost
--
-- and it STOPS on:
--
--   retry_wait, backoff not elapsed   the SAME item is still being delivered
--   in_flight with a live lease       another worker owns the attempt
--   reconciliation_state = 'required' an unresolved divergence sits at the
--                                     head of the stream. Sending past it
--                                     would compound the divergence, and
--                                     clearing it silently to keep the queue
--                                     moving is exactly what "no silent
--                                     conflict resolution" forbids. The exit
--                                     is the governed clearance, not the
--                                     delivery worker.
--
-- A row whose lease has EXPIRED is reclaimed, keeping its attempt history.
-- Expiry is not a cloud verdict and never becomes one.
-- ---------------------------------------------------------------------------
create function edge_sync.lease_outbox_batch(
  p_location_id           uuid,
  p_assignment_generation integer,
  p_lease_owner           text,
  p_lease_id              uuid,
  p_lease_seconds         integer,
  p_max_items             integer
) returns setof edge_sync.outbox_lease_item
language plpgsql
as $$
declare
  r        record;
  v_taken  integer := 0;
  v_now    timestamptz := now();
begin
  if p_lease_owner is null or btrim(p_lease_owner) = '' then
    raise exception 'KLUY-EDGE-LEASE-OWNER-REQUIRED: an in_flight row always names its owner'
      using errcode = 'P0001';
  end if;
  if p_lease_id is null then
    raise exception 'KLUY-EDGE-LEASE-ID-REQUIRED: an attempt is identified so its acknowledgement can be matched'
      using errcode = 'P0001';
  end if;
  if p_lease_seconds is null or p_lease_seconds <= 0 then
    raise exception 'KLUY-EDGE-LEASE-WINDOW-INVALID: lease seconds must be positive'
      using errcode = 'P0001';
  end if;
  if p_max_items is null or p_max_items <= 0 then
    raise exception 'KLUY-EDGE-LEASE-BATCH-INVALID: batch size must be positive'
      using errcode = 'P0001';
  end if;

  for r in
    select *
      from edge_sync.outbox o
     where o.location_id = p_location_id
       and o.assignment_generation = p_assignment_generation
       and o.delivery_state <> 'acknowledged'
     order by o.assignment_generation, o.hub_sequence
     for update
  loop
    exit when v_taken >= p_max_items;

    -- STOP: an unresolved divergence blocks its own stream.
    exit when r.reconciliation_state = 'required';

    -- STEP OVER: terminal states that can never be acknowledged.
    if r.delivery_state in ('rejected', 'dead_letter') then
      continue;
    end if;

    -- STOP: the same item is still mid-delivery elsewhere or mid-backoff.
    if r.delivery_state = 'in_flight' and r.lease_expires_at > v_now then
      exit;
    end if;
    if r.delivery_state = 'retry_wait' and r.next_attempt_at > v_now then
      exit;
    end if;

    update edge_sync.outbox
       set delivery_state   = 'in_flight',
           lease_id         = p_lease_id,
           lease_owner      = p_lease_owner,
           leased_at        = v_now,
           lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
           last_attempt_at  = v_now,
           attempt_count    = attempt_count + 1
     where event_id = r.event_id;

    v_taken := v_taken + 1;

    return query
      select o.event_id, o.hub_sequence, o.assignment_generation, o.attempt_count,
             o.tenant_id, o.digital_store_id, o.location_id,
             e.origin_device_id, e.aggregate_type, e.aggregate_id, e.aggregate_version,
             e.event_type, e.schema_version, e.business_date, e.occurred_at,
             e.idempotency_key, e.payload_sha256, e.payload
        from edge_sync.outbox o
        join edge_sync.local_event e on e.id = o.event_id
       where o.event_id = r.event_id;
  end loop;

  return;
end;
$$;

comment on function edge_sync.lease_outbox_batch(uuid, integer, text, uuid, integer, integer) is
  'Claims a bounded ORDERED batch and moves it pending/retry_wait -> in_flight (Hub spec §11.5; offline §5.1). Stops rather than skipping ahead of an undelivered, backing-off, leased or unreconciled item; steps over only terminal rows that can never be acknowledged. Increments attempt_count so an attempt is always counted even if the worker dies before recording an outcome.';

-- ---------------------------------------------------------------------------
-- edge_sync.release_outbox_lease — hand a row back WITHOUT inventing a verdict.
--
-- Used when an attempt could not be completed and no cloud answer was
-- observed: a worker shutting down, a lease reaper, or an unverified timeout.
-- The row returns to retry_wait with backoff; it is NEVER marked rejected,
-- because "we did not hear back" is not a durable cloud rejection (§2).
-- ---------------------------------------------------------------------------
create function edge_sync.release_outbox_lease(
  p_event_id       uuid,
  p_lease_id       uuid,
  p_reason_code    text,
  p_backoff_seconds integer default 0
) returns boolean
language plpgsql
as $$
declare
  v_updated integer;
begin
  update edge_sync.outbox
     set delivery_state   = 'retry_wait',
         next_attempt_at  = now() + make_interval(secs => greatest(coalesce(p_backoff_seconds, 0), 0)),
         last_error_code  = p_reason_code,
         lease_id         = null,
         lease_owner      = null,
         leased_at        = null,
         lease_expires_at = null
   where event_id = p_event_id
     and delivery_state = 'in_flight'
     and (p_lease_id is null or lease_id = p_lease_id);
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

comment on function edge_sync.release_outbox_lease(uuid, uuid, text, integer) is
  'Returns an in_flight row to retry_wait without claiming a cloud outcome. An unverified timeout, a worker shutdown or a reaped lease is NOT a durable cloud rejection (amendment §2), so `rejected` is never written here.';

-- Reap every lease that has expired for a Location. Returns the count so the
-- caller can report it truthfully rather than assume zero.
create function edge_sync.reap_expired_outbox_leases(p_location_id uuid)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  update edge_sync.outbox
     set delivery_state   = 'retry_wait',
         next_attempt_at  = now(),
         last_error_code  = 'EDGE_LEASE_EXPIRED',
         lease_id         = null,
         lease_owner      = null,
         leased_at        = null,
         lease_expires_at = null
   where location_id = p_location_id
     and delivery_state = 'in_flight'
     and lease_expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function edge_sync.reap_expired_outbox_leases(uuid) is
  'Reclaims abandoned attempts (§11.5 recovery). attempt_count is PRESERVED — a crashed attempt still happened — and no cloud outcome is fabricated.';

grant execute on function
  edge_sync.lease_outbox_batch(uuid, integer, text, uuid, integer, integer),
  edge_sync.release_outbox_lease(uuid, uuid, text, integer),
  edge_sync.reap_expired_outbox_leases(uuid)
  to kitluy_hub_runtime, kitluy_sync_worker;
