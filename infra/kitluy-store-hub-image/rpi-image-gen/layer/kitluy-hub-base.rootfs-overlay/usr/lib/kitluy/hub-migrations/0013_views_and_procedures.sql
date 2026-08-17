-- kitluy:hub:migration:0013
-- ===========================================================================
-- KitLuy Store Hub local database — views and stored procedures.
--
-- Authority: schema contract §7 (required stored procedures), §1
-- ("Transactions: SERIALIZABLE for sequence allocation, storage assignment
-- and final custody release"), §6.2 ("Only one active snapshot is exposed
-- through the active-configuration view"), §3 (kitluy_support_ro sees
-- redacted views only), offline contract §4 (Hub acceptance algorithm), §5
-- (Hub sequence), §14 (display numbers).
--
-- SCOPE OF THIS FILE (truthful): WS-09's DDL/tooling half implements the
-- SEQUENCING AND IDEMPOTENCY primitives — the parts that are pure database
-- concerns and must be correct before any business command exists:
--   edge_core.allocate_business_number   (§7, serializable allocator)
--   edge_sync.allocate_hub_sequence      (offline §5)
--   edge_sync.record_sequence_gap        (offline §5, gap ledger)
--   edge_sync.accept_terminal_command    (§7, offline §4 acceptance algorithm)
--   edge_sync.complete_command           (offline §4 "store immutable result")
-- The seven BUSINESS procedures of §7 (confirm_intake, assign_ready_storage,
-- complete_pickup, record_cash_payment, enqueue_print_job, activate_snapshot,
-- apply_inbox_message) are NOT implemented here: they are the command-layer
-- half of WS-09-T002/T003 and driven by the canonical @kitluy-verticals and
-- @kitluy/payments engines. Claiming them here would be claiming scaffolded
-- functionality implemented (repository rule 5).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Procedure result shape (§7: "Every procedure returns request_id,
-- aggregate_id, aggregate_version, event_ids, hub_sequence_range and
-- sync_state").
-- ---------------------------------------------------------------------------
create type edge_sync.command_outcome as (
  request_id         uuid,
  aggregate_id       uuid,
  aggregate_version  bigint,
  event_ids          uuid[],
  hub_sequence_first bigint,
  hub_sequence_last  bigint,
  sync_state         text,
  outcome            text,
  error_code         text
);

comment on type edge_sync.command_outcome is
  'Uniform Hub procedure result (§7). `outcome` is accepted | duplicate | in_progress; `error_code` carries the offline contract §19 code on refusal.';

-- ---------------------------------------------------------------------------
-- edge_core.allocate_business_number (§7, Serializable).
--
-- The isolation level is a TRANSACTION property and cannot be set inside a
-- function, so the caller opens SERIALIZABLE (§1). The row lock taken by the
-- UPDATE below makes the allocator collision-safe under READ COMMITTED too,
-- which is what §12 acceptance test 8 requires.
-- ---------------------------------------------------------------------------
create function edge_core.allocate_business_number(
  p_location_id           uuid,
  p_sequence_code         text,
  p_business_date         date,
  p_allocation_generation integer default 1
) returns bigint
language plpgsql
as $$
declare
  v_value bigint;
begin
  loop
    update edge_core.business_sequence
       set next_value = next_value + 1,
           updated_at = now()
     where location_id = p_location_id
       and sequence_code = p_sequence_code
       and business_date = p_business_date
    returning next_value - 1 into v_value;

    if found then
      return v_value;
    end if;

    begin
      insert into edge_core.business_sequence
        (location_id, sequence_code, business_date, next_value, allocation_generation, updated_at)
      values (p_location_id, p_sequence_code, p_business_date, 2, p_allocation_generation, now());
      return 1;
    exception when unique_violation then
      -- A concurrent allocator created the row first; loop and take the lock.
      null;
    end;
  end loop;
end;
$$;

comment on function edge_core.allocate_business_number(uuid, text, date, integer) is
  'Collision-safe display-number allocator (§7). Never blocks on WAN: display numbers are allocated locally (offline contract §14). Clock correction never changes an already issued number (§15).';

-- Appendix B / offline contract §14.1 display profiles. Operational
-- identifiers only — NOT a Cambodia statutory fiscal-number declaration.
create function edge_core.format_display_number(
  p_prefix        text,
  p_location_code text,
  p_business_date date,
  p_sequence      bigint
) returns text
language sql
immutable
strict
as $$
  select p_prefix || '-' || upper(p_location_code) || '-'
      || to_char(p_business_date, 'YYMMDD') || '-'
      || lpad(p_sequence::text, 6, '0');
$$;

comment on function edge_core.format_display_number(text, text, date, bigint) is
  'Appendix B profiles KLB-/KLR-{LOCATION_CODE}-{YYMMDD}-{SEQ6}. LOCATION_CODE is a cloud-assigned immutable 3-8 character code. A later owner-approved legal/fiscal numbering policy may replace the receipt format without changing UUID identity or event idempotency.';

-- ---------------------------------------------------------------------------
-- edge_sync.allocate_hub_sequence (offline contract §5).
-- ---------------------------------------------------------------------------
create function edge_sync.allocate_hub_sequence()
returns bigint
language sql
volatile
as $$
  select nextval('edge_sync.hub_sequence_seq');
$$;

comment on function edge_sync.allocate_hub_sequence() is
  'Allocates the next hub_sequence (offline contract §5). Values are never reused; a value burnt by a rolled-back transaction is journalled through edge_sync.record_sequence_gap and is NOT a missing event.';

create function edge_sync.record_sequence_gap(
  p_id                    uuid,
  p_tenant_id             uuid,
  p_digital_store_id      uuid,
  p_location_id           uuid,
  p_assignment_generation integer,
  p_hub_sequence          bigint,
  p_gap_reason            text,
  p_recorded_by           text,
  p_note                  text default null
) returns void
language sql
as $$
  insert into edge_sync.sequence_gap
    (id, tenant_id, digital_store_id, location_id, assignment_generation,
     hub_sequence, gap_reason, detected_at, recorded_by, note)
  values
    (p_id, p_tenant_id, p_digital_store_id, p_location_id, p_assignment_generation,
     p_hub_sequence, p_gap_reason, now(), p_recorded_by, p_note)
  on conflict (location_id, assignment_generation, hub_sequence) do nothing;
$$;

comment on function edge_sync.record_sequence_gap(uuid, uuid, uuid, uuid, integer, bigint, text, text, text) is
  'Journals a known hub_sequence gap (offline contract §5). Idempotent so recovery can replay it safely.';

-- ---------------------------------------------------------------------------
-- edge_sync.accept_terminal_command (§7; offline contract §4 acceptance
-- algorithm, §19 error table).
--
--   begin serializable transaction
--     lock terminal sequence record
--     verify origin_sequence (recorded | next | lower unknown | gap)
--     reserve idempotency key
--     ... caller executes the business mutation ...
--   commit
--
-- This function performs the LOCK / VERIFY / RESERVE steps and returns either
-- the stored result (duplicate) or an accepted reservation. The business
-- mutation, its events and its outbox rows are the caller's responsibility in
-- the SAME transaction (§9); the deferred outbox invariant makes an event
-- without an outbox row impossible to commit.
-- ---------------------------------------------------------------------------
create function edge_sync.accept_terminal_command(
  p_command_result_id     uuid,
  p_tenant_id             uuid,
  p_digital_store_id      uuid,
  p_location_id           uuid,
  p_terminal_device_id    uuid,
  p_idempotency_key       text,
  p_request_hash          char(64),
  p_command_type          text,
  p_aggregate_type        text,
  p_actor_id              uuid default null,
  p_origin_sequence       bigint default null,
  p_assignment_generation integer default 1,
  p_request_id            uuid default null
) returns edge_sync.command_outcome
language plpgsql
as $$
declare
  v_terminal  record;
  v_existing  edge_sync.command_result%rowtype;
  v_result    edge_sync.command_outcome;
  v_expected  bigint;
begin
  -- Lock the terminal sequence record (offline §4 step 1). The lock also
  -- proves the device exists and is registered to THIS scope.
  select * into v_terminal
  from edge_identity.terminal_device
  where id = p_terminal_device_id
  for update;

  if not found then
    raise exception 'EDGE_TERMINAL_UNKNOWN: terminal device % is not registered on this Hub',
      p_terminal_device_id using errcode = 'P0001';
  end if;

  -- §12 acceptance test 9: cross-Tenant, cross-Digital-Store and
  -- cross-Location rows are rejected by procedures.
  if v_terminal.tenant_id <> p_tenant_id
     or v_terminal.digital_store_id <> p_digital_store_id
     or v_terminal.location_id <> p_location_id then
    raise exception
      'EDGE_SCOPE_MISMATCH: terminal % belongs to a different Tenant/Digital Store/Location',
      p_terminal_device_id using errcode = 'P0001';
  end if;

  if not edge_sync.is_canonical_idempotency_key(p_idempotency_key) then
    raise exception
      'EDGE_IDEMPOTENCY_KEY_MALFORMED: % is not kl1.{terminal_device_uuid}.{client_sequence} (offline contract §2)',
      p_idempotency_key using errcode = 'P0001';
  end if;

  -- Already recorded? Return the stored result (offline §19 rows 1 and 2).
  select * into v_existing
  from edge_sync.command_result
  where idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_existing.request_hash <> p_request_hash then
      -- §3: "If a reused key has a different hash, the Hub returns
      -- EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH and emits an audit/security event."
      insert into edge_audit.security_event
        (id, tenant_id, digital_store_id, location_id, event_code, severity,
         device_id, detected_at, details_json)
      values
        (gen_random_uuid(), p_tenant_id, p_digital_store_id, p_location_id,
         'EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH', 'high', p_terminal_device_id, now(),
         jsonb_build_object('idempotency_key', p_idempotency_key,
                            'command_type', p_command_type));
      raise exception
        'EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH: key % was reserved with a different request hash',
        p_idempotency_key using errcode = 'P0001';
    end if;

    v_result := row(
      v_existing.request_id, v_existing.aggregate_id, v_existing.aggregate_version,
      v_existing.event_ids, v_existing.hub_sequence_first, v_existing.hub_sequence_last,
      v_existing.sync_state,
      case when v_existing.commit_status = 'in_progress' then 'in_progress' else 'duplicate' end,
      v_existing.error_code
    )::edge_sync.command_outcome;
    return v_result;
  end if;

  -- Terminal sequence verification (offline §4 step 2, §19 rows 4 and 5).
  if p_origin_sequence is not null then
    v_expected := v_terminal.last_client_sequence + 1;
    if p_origin_sequence < v_expected then
      raise exception
        'EDGE_SEQUENCE_REPLAY_REJECTED: origin_sequence % is lower than the expected % for terminal %',
        p_origin_sequence, v_expected, p_terminal_device_id using errcode = 'P0001';
    elsif p_origin_sequence > v_expected then
      raise exception
        'EDGE_SEQUENCE_GAP: origin_sequence % skips the expected % for terminal %; terminal recovery required',
        p_origin_sequence, v_expected, p_terminal_device_id using errcode = 'P0001';
    end if;
  end if;

  -- Reserve the idempotency key. The unique index is the reservation: a
  -- concurrent duplicate blocks here until this transaction commits or rolls
  -- back, so no uncommitted reservation ever survives a rollback (§4).
  insert into edge_sync.command_result
    (id, tenant_id, digital_store_id, location_id, idempotency_key, request_hash,
     command_type, actor_id, terminal_device_id, origin_sequence, assignment_generation,
     aggregate_type, request_id, sync_state, commit_status, created_at)
  values
    (p_command_result_id, p_tenant_id, p_digital_store_id, p_location_id,
     p_idempotency_key, p_request_hash, p_command_type, p_actor_id, p_terminal_device_id,
     coalesce(p_origin_sequence, 0), p_assignment_generation, p_aggregate_type,
     p_request_id, null, 'in_progress', now());

  if p_origin_sequence is not null then
    update edge_identity.terminal_device
       set last_client_sequence = p_origin_sequence
     where id = p_terminal_device_id;
  end if;

  v_result := row(p_request_id, null, null, '{}'::uuid[], null, null, null, 'accepted', null)
              ::edge_sync.command_outcome;
  return v_result;
end;
$$;

comment on function edge_sync.accept_terminal_command(uuid, uuid, uuid, uuid, uuid, text, char, text, text, uuid, bigint, integer, uuid) is
  'Deduplicated command acceptance and terminal-sequence verification (§7; offline contract §4). Caller MUST open a SERIALIZABLE transaction and MUST complete the reservation with edge_sync.complete_command in the same transaction.';

-- ---------------------------------------------------------------------------
-- edge_sync.complete_command — offline contract §4 "store immutable command
-- result". Exactly one transition is permitted (enforced by the immutability
-- trigger in 0012).
-- ---------------------------------------------------------------------------
create function edge_sync.complete_command(
  p_idempotency_key    text,
  p_commit_status      text,
  p_sync_state         text,
  p_aggregate_id       uuid default null,
  p_aggregate_version  bigint default null,
  p_event_ids          uuid[] default '{}',
  p_hub_sequence_first bigint default null,
  p_hub_sequence_last  bigint default null,
  p_error_code         text default null,
  p_result_json        jsonb default '{}'::jsonb
) returns edge_sync.command_outcome
language plpgsql
as $$
declare
  v_row    edge_sync.command_result%rowtype;
  v_result edge_sync.command_outcome;
begin
  update edge_sync.command_result
     set commit_status      = p_commit_status,
         sync_state         = p_sync_state,
         aggregate_id       = p_aggregate_id,
         aggregate_version  = p_aggregate_version,
         event_ids          = p_event_ids,
         hub_sequence_first = p_hub_sequence_first,
         hub_sequence_last  = p_hub_sequence_last,
         error_code         = p_error_code,
         result_json        = p_result_json,
         completed_at       = now()
   where idempotency_key = p_idempotency_key
  returning * into v_row;

  if not found then
    raise exception 'EDGE_COMMAND_NOT_RESERVED: no in-progress command result for key %',
      p_idempotency_key using errcode = 'P0001';
  end if;

  v_result := row(
    v_row.request_id, v_row.aggregate_id, v_row.aggregate_version, v_row.event_ids,
    v_row.hub_sequence_first, v_row.hub_sequence_last, v_row.sync_state,
    case when v_row.commit_status = 'committed' then 'accepted' else 'rejected' end,
    v_row.error_code
  )::edge_sync.command_outcome;
  return v_result;
end;
$$;

comment on function edge_sync.complete_command(text, text, text, uuid, bigint, uuid[], bigint, bigint, text, jsonb) is
  'Freezes the command result (offline contract §4). WS-09 may record committed_locally only; cloud_acknowledged/cloud_rejected are written by WS-10 after a REAL cloud response — no acknowledgement is ever fabricated.';

-- ---------------------------------------------------------------------------
-- Views.
-- ---------------------------------------------------------------------------

-- §6.2: "Only one active snapshot is exposed through the active-configuration
-- view." The partial unique index in 0012 guarantees at most one row here.
create view edge_config.active_configuration as
select s.id            as snapshot_id,
       s.tenant_id,
       s.digital_store_id,
       s.location_id,
       s.snapshot_version,
       s.schema_version,
       s.manifest_sha256,
       s.signing_key_id,
       s.not_before,
       s.expires_at,
       s.activated_at
from edge_config.configuration_snapshot s
where s.state = 'active';

comment on view edge_config.active_configuration is
  'The single active configuration snapshot per Location (§6.2).';

-- Open outbox work queue (§8 partial index backs this view).
create view edge_sync.outbox_pending as
select o.event_id,
       o.tenant_id,
       o.digital_store_id,
       o.location_id,
       o.assignment_generation,
       o.hub_sequence,
       o.delivery_state,
       o.attempt_count,
       o.next_attempt_at,
       e.event_type,
       e.aggregate_type,
       e.aggregate_id,
       e.occurred_at
from edge_sync.outbox o
join edge_sync.local_event e on e.id = o.event_id
where o.delivery_state <> 'acknowledged'
order by o.assignment_generation, o.hub_sequence;

comment on view edge_sync.outbox_pending is
  'Oldest-unacknowledged-first outbox queue (Hub spec §11.5). Ordered by the full namespace (assignment_generation, hub_sequence) so a replacement Hub never interleaves with the failed Hub stream (offline contract §5.1).';

-- §3: kitluy_support_ro sees REDACTED views only and holds no table grant.
create view edge_audit.support_booking_summary as
select b.id as booking_id,
       b.location_id,
       b.booking_number,
       b.status,
       b.business_date,
       b.currency_code,
       b.currency_exponent,
       b.total_minor,
       b.paid_minor,
       b.balance_minor,
       b.created_at,
       b.updated_at,
       (b.customer_id is not null) as has_customer
from edge_laundry.booking b;

comment on view edge_audit.support_booking_summary is
  'Consent-bound diagnostic projection (§3). Exposes NO customer identity, NO contact value and NO actor identity — only Booking state and money totals.';

create view edge_audit.support_sync_health as
select o.location_id,
       o.delivery_state,
       count(*)             as item_count,
       min(o.hub_sequence)  as first_hub_sequence,
       max(o.hub_sequence)  as last_hub_sequence,
       min(o.next_attempt_at) as next_attempt_at
from edge_sync.outbox o
group by o.location_id, o.delivery_state;

comment on view edge_audit.support_sync_health is
  'Consent-bound sync health projection (§3). Counts and sequence ranges only; no payload, no actor, no customer data.';

grant select on edge_config.active_configuration to kitluy_hub_runtime, kitluy_sync_worker;
grant select on edge_sync.outbox_pending to kitluy_hub_runtime, kitluy_sync_worker;
grant select on edge_audit.support_booking_summary to kitluy_support_ro;
grant select on edge_audit.support_sync_health to kitluy_support_ro;

grant execute on function
  edge_core.allocate_business_number(uuid, text, date, integer),
  edge_core.format_display_number(text, text, date, bigint),
  edge_sync.allocate_hub_sequence(),
  edge_sync.record_sequence_gap(uuid, uuid, uuid, uuid, integer, bigint, text, text, text),
  edge_sync.accept_terminal_command(uuid, uuid, uuid, uuid, uuid, text, char, text, text, uuid, bigint, integer, uuid),
  edge_sync.complete_command(text, text, text, uuid, bigint, uuid[], bigint, bigint, text, jsonb)
  to kitluy_hub_runtime;
