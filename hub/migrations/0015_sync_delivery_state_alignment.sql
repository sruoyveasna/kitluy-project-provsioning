-- kitluy:hub:migration:0015
-- ===========================================================================
-- KitLuy Store Hub local database — WS-10 delivery/conflict state alignment.
--
-- Authority: owner amendment KLD-2026-07-28-001-A01 (2026-07-28), which
-- resolves reconciliation C26 and closes KLREQ-021 as amended. Recorded in
-- docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md.
--
-- WHY A NEW FILE. 0001 declared the enum and has been APPLIED. Schema contract
-- §4: "Migrations are additive and checksum-registered. An applied file is
-- never edited." The amendment therefore mandates an ADDITIVE FORWARD
-- migration; 0001 keeps its bytes and its journalled sha256.
--
-- WHAT THE AMENDMENT RULES.
--   §2  Canonical delivery states are pending, in_flight, retry_wait,
--       acknowledged, rejected, dead_letter. Align by renaming
--       sending -> in_flight and blocked -> rejected. No runtime alias is
--       required: no production or pilot deployment exists.
--   §3  `reconciliation_required` is an ORTHOGONAL conflict/reconciliation
--       state and must NOT be added to edge_sync.delivery_state. Delivery
--       state records the TRANSPORT AND CLOUD-PROCESSING lifecycle; conflict
--       state records whether an acknowledged or rejected business effect
--       REQUIRES RECONCILIATION. The two dimensions stay separately
--       queryable and auditable.
--   §4  External status is derived by ONE shared mapping, with CONFLICT
--       OVERRIDE FIRST.
--   §5  A delivery worker must NOT independently clear
--       `reconciliation_required`.
--
-- PRE-RENAME AUDIT (amendment §1, executed 2026-07-28 before this file was
-- authored): every executable use of `blocked` as a delivery state was
-- enumerated — the 0001 enum declaration, the enum assertion in
-- hub/tests/assertions.sql and the TypeScript union mirror in
-- services/kitluy-hub-agent/src/hub-database.ts — with ZERO live rows in
-- edge_sync.outbox. `edge_payments` reason code `blocked_balance_due` and the
-- `v_blocked` counters in the assertions are unrelated concepts and are NOT
-- touched. No code branched on the value, so no ambiguous use required
-- explicit correction and the rename is purely mechanical.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum alignment (amendment §2).
--
-- RENAME VALUE preserves the enum member's OID, so every CHECK constraint,
-- index and view compiled against this type in 0009/0012/0013 keeps working
-- unchanged; only the label text moves. Nothing is dropped and no data is
-- rewritten.
-- ---------------------------------------------------------------------------
alter type edge_sync.delivery_state rename value 'sending' to 'in_flight';
alter type edge_sync.delivery_state rename value 'blocked' to 'rejected';

comment on type edge_sync.delivery_state is
  'Canonical PERSISTED per-event delivery state, aligned to owner amendment KLD-2026-07-28-001-A01 §2: pending, in_flight, retry_wait, acknowledged, rejected, dead_letter. TRANSPORT AND CLOUD-PROCESSING LIFECYCLE ONLY. `rejected` means a DURABLE cloud rejection and must never be used for a temporary network error, rate limiting, a scheduled retry, an in-progress attempt, a local operator pause or an unverified timeout — those are in_flight or retry_wait. `reconciliation_required` is NOT a member of this type: it belongs to the orthogonal conflict dimension (§3).';

-- ---------------------------------------------------------------------------
-- 2. The orthogonal conflict/reconciliation dimension (amendment §3).
--
-- A separate type, deliberately NOT merged into delivery_state. `cleared` is
-- distinct from `none` because "was reconciled by an authorized actor" and
-- "never needed reconciliation" are different facts and only the first has an
-- audit trail to point at.
-- ---------------------------------------------------------------------------
create type edge_sync.reconciliation_state as enum ('none', 'required', 'cleared');

comment on type edge_sync.reconciliation_state is
  'ORTHOGONAL conflict/reconciliation dimension (amendment KLD-2026-07-28-001-A01 §3). Independent of edge_sync.delivery_state: an acknowledged, rejected or dead-lettered business effect may or may not require reconciliation, and the two facts are recorded separately.';

alter table edge_sync.outbox
  add column reconciliation_state edge_sync.reconciliation_state not null default 'none',
  add column reconciliation_conflict_id uuid null references edge_sync.sync_conflict (id),
  add column reconciliation_raised_at timestamptz null,
  add column reconciliation_raised_reason text null,
  add column reconciliation_cleared_at timestamptz null,
  add column reconciliation_cleared_by uuid null,
  add column reconciliation_cleared_authority text null,
  add column reconciliation_clearing_reason text null,
  add column reconciliation_clearing_event_id uuid null references edge_sync.local_event (id),
  add column rejected_at timestamptz null;

comment on column edge_sync.outbox.reconciliation_state is
  'Conflict dimension (amendment §3). NEVER folded into delivery_state. Raised and cleared only through edge_sync.raise_reconciliation / edge_sync.clear_reconciliation; the trigger below refuses a bare UPDATE, so a delivery worker cannot move it.';
comment on column edge_sync.outbox.reconciliation_conflict_id is
  'The edge_sync.sync_conflict record that NAMES the divergence. A row can never be flagged as requiring reconciliation without a conflict record explaining why.';
comment on column edge_sync.outbox.reconciliation_cleared_by is
  'The authorized actor who cleared reconciliation. NULL only when clearance came from governed automated reconciliation, in which case reconciliation_cleared_authority names the governing policy (amendment §5).';
comment on column edge_sync.outbox.reconciliation_clearing_event_id is
  'Correlation to the repair or compensating action (amendment §5). Clearing is never a bare state edit.';
comment on column edge_sync.outbox.rejected_at is
  'When the DURABLE cloud rejection was recorded. Paired with last_error_code by outbox_rejected_ck so `rejected` can never mean "we gave up locally".';

-- Truthfulness constraints for both dimensions.
alter table edge_sync.outbox
  -- `rejected` is a durable CLOUD verdict: it carries the cloud error code and
  -- the moment the verdict was recorded (amendment §2).
  add constraint outbox_rejected_ck
    check (delivery_state <> 'rejected'
           or (last_error_code is not null and rejected_at is not null)),
  -- A row never claims to need reconciliation without a conflict record and a
  -- reason, and never claims to have been reconciled without an authority, a
  -- reason and a correlation to the repair.
  add constraint outbox_reconciliation_none_ck
    check (reconciliation_state <> 'none'
           or (reconciliation_conflict_id is null
               and reconciliation_raised_at is null
               and reconciliation_raised_reason is null
               and reconciliation_cleared_at is null
               and reconciliation_cleared_by is null
               and reconciliation_cleared_authority is null
               and reconciliation_clearing_reason is null
               and reconciliation_clearing_event_id is null)),
  add constraint outbox_reconciliation_required_ck
    check (reconciliation_state <> 'required'
           or (reconciliation_conflict_id is not null
               and reconciliation_raised_at is not null
               and reconciliation_raised_reason is not null
               and reconciliation_cleared_at is null
               and reconciliation_cleared_by is null
               and reconciliation_cleared_authority is null
               and reconciliation_clearing_reason is null
               and reconciliation_clearing_event_id is null)),
  add constraint outbox_reconciliation_cleared_ck
    check (reconciliation_state <> 'cleared'
           or (reconciliation_conflict_id is not null
               and reconciliation_raised_at is not null
               and reconciliation_raised_reason is not null
               and reconciliation_cleared_at is not null
               and reconciliation_cleared_authority is not null
               and reconciliation_clearing_reason is not null
               and reconciliation_clearing_event_id is not null
               and reconciliation_cleared_at >= reconciliation_raised_at));

comment on constraint outbox_reconciliation_cleared_ck on edge_sync.outbox is
  'Amendment §5: clearing requires an authorized actor or governed automated reconciliation, a reason, an immutable audit trail and correlation to the repair or compensating action. The clearing procedure writes the audit row; these columns make the evidence non-optional at the storage layer.';

-- Separately queryable (amendment §3): the conflict dimension gets its own
-- index rather than being reachable only through a delivery-state scan.
create index outbox_reconciliation_idx
  on edge_sync.outbox (location_id, reconciliation_state, hub_sequence)
  where reconciliation_state <> 'none';

-- ---------------------------------------------------------------------------
-- 3. Dimension independence and governed clearance (amendment §3, §5).
--
-- `kitluy_sync_worker` holds UPDATE on every edge_sync relation (0012), so the
-- rule "a delivery worker must NOT independently clear reconciliation" cannot
-- rest on grants. This trigger makes it structural:
--
--   a) ANY change to a reconciliation_* column requires the governed marker
--      set by edge_sync.raise_reconciliation / edge_sync.clear_reconciliation.
--      A plain UPDATE from the delivery worker is refused.
--   b) A single statement may not move BOTH dimensions. Independence is only
--      real if it is impossible to smuggle a conflict change inside a
--      delivery-state update.
--   c) `required` never collapses back to `none` — the only exit is `cleared`,
--      which carries the evidence. Re-raising after clearance requires a NEW
--      conflict record.
-- ---------------------------------------------------------------------------
create function edge_sync.enforce_state_dimension_independence()
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
      new.dead_letter_reason
    ) is distinct from (
      old.delivery_state, old.attempt_count, old.next_attempt_at, old.last_attempt_at,
      old.last_error_code, old.cloud_ack_id, old.acknowledged_at, old.rejected_at,
      old.dead_letter_reason
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

comment on function edge_sync.enforce_state_dimension_independence() is
  'Structural enforcement of amendment KLD-2026-07-28-001-A01 §3 and §5: the conflict dimension is governed-only, cannot move in the same statement as the delivery dimension, and a raised reconciliation can never be silently discarded.';

create trigger outbox_state_dimension_independence
  before update on edge_sync.outbox
  for each row execute function edge_sync.enforce_state_dimension_independence();

-- ---------------------------------------------------------------------------
-- 4. THE single external status projection (amendment §4).
--
-- "External status is derived by ONE shared mapping function or view, with
--  conflict override first ... Services must not maintain divergent mappings."
--
-- The output vocabulary is the already-approved five-value command sync-state
-- registry (0009 command_result_sync_state_ck). No sixth value is invented.
--
-- dead_letter maps to reconciliation_required rather than to a transport
-- state: an undeliverable item will NOT progress without governed operator
-- repair, so reporting `pending_cloud_sync` would claim progress that is not
-- coming, and reporting `cloud_rejected` would fabricate a cloud verdict that
-- never arrived. WS-10 additionally raises the conflict dimension whenever a
-- row enters dead_letter, so both paths agree.
-- ---------------------------------------------------------------------------
create function edge_sync.external_sync_status(
  p_delivery_state       edge_sync.delivery_state,
  p_reconciliation_state edge_sync.reconciliation_state
) returns text
language sql
immutable
strict
parallel safe
as $$
  select case
           -- CONFLICT OVERRIDE FIRST (amendment §4): when reconciliation is
           -- required, report it regardless of the delivery state — including
           -- acknowledged, rejected and dead_letter.
           when p_reconciliation_state = 'required' then 'reconciliation_required'
           when p_delivery_state = 'dead_letter'    then 'reconciliation_required'
           when p_delivery_state = 'acknowledged'   then 'cloud_acknowledged'
           when p_delivery_state = 'rejected'       then 'cloud_rejected'
           else 'pending_cloud_sync'
         end;
$$;

comment on function edge_sync.external_sync_status(edge_sync.delivery_state, edge_sync.reconciliation_state) is
  'THE shared external-status projection (amendment KLD-2026-07-28-001-A01 §4). Conflict override is evaluated FIRST. Output is the approved five-value registry vocabulary; no sixth value is invented. Every service and view derives external status from THIS function — divergent mappings are forbidden.';

-- A view so the projection is reachable without a function call and stays the
-- same mapping for reporting consumers.
create view edge_sync.outbox_status as
select o.event_id,
       o.tenant_id,
       o.digital_store_id,
       o.location_id,
       o.assignment_generation,
       o.hub_sequence,
       o.delivery_state,
       o.reconciliation_state,
       edge_sync.external_sync_status(o.delivery_state, o.reconciliation_state) as external_status,
       o.attempt_count,
       o.next_attempt_at,
       o.last_error_code,
       o.cloud_ack_id,
       o.acknowledged_at,
       o.rejected_at,
       o.dead_letter_reason,
       o.reconciliation_conflict_id
from edge_sync.outbox o;

comment on view edge_sync.outbox_status is
  'Both dimensions plus THE shared external projection, side by side (amendment §3 "separately queryable", §4 "one shared mapping").';

-- ---------------------------------------------------------------------------
-- 5. Governed conflict-dimension transitions (amendment §5).
--
-- Both procedures set the governed marker LOCAL to the current transaction, so
-- the permission to move the conflict dimension cannot leak to a later
-- statement on the same connection.
-- ---------------------------------------------------------------------------
create function edge_sync.raise_reconciliation(
  p_event_id     uuid,
  p_conflict_id  uuid,
  p_reason       text
) returns void
language plpgsql
as $$
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-RECONCILIATION-REASON-REQUIRED: a raised reconciliation always states why'
      using errcode = 'P0001';
  end if;
  if not exists (select 1 from edge_sync.sync_conflict c where c.id = p_conflict_id) then
    raise exception
      'KLUY-EDGE-RECONCILIATION-CONFLICT-UNKNOWN: sync_conflict % does not exist; a flag without a named divergence is not evidence',
      p_conflict_id using errcode = 'P0001';
  end if;

  perform set_config('kitluy.reconciliation_governed', 'on', true);
  update edge_sync.outbox
     set reconciliation_state         = 'required',
         reconciliation_conflict_id   = p_conflict_id,
         reconciliation_raised_at     = now(),
         reconciliation_raised_reason = p_reason,
         reconciliation_cleared_at    = null,
         reconciliation_cleared_by    = null,
         reconciliation_cleared_authority = null,
         reconciliation_clearing_reason   = null,
         reconciliation_clearing_event_id = null
   where event_id = p_event_id;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  perform set_config('kitluy.reconciliation_governed', 'off', true);
end;
$$;

comment on function edge_sync.raise_reconciliation(uuid, uuid, text) is
  'Raises the ORTHOGONAL conflict dimension (amendment §3). Requires an existing sync_conflict record and a reason. Leaves delivery_state untouched — the two dimensions transition independently.';

create function edge_sync.clear_reconciliation(
  p_event_id           uuid,
  p_cleared_by         uuid,
  p_authority          text,
  p_reason             text,
  p_resolution_event_id uuid
) returns void
language plpgsql
as $$
declare
  v_row edge_sync.outbox%rowtype;
begin
  -- Amendment §5: "clearing requires an authorized actor or governed automated
  -- reconciliation". An automated clearance names its governing policy instead
  -- of an actor; neither may be absent.
  if p_authority is null or btrim(p_authority) = '' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-AUTHORITY-REQUIRED: name the authorized actor or the governed automated-reconciliation policy'
      using errcode = 'P0001';
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'KLUY-EDGE-RECONCILIATION-REASON-REQUIRED: a cleared reconciliation always states why'
      using errcode = 'P0001';
  end if;
  if p_resolution_event_id is null then
    raise exception
      'KLUY-EDGE-RECONCILIATION-CORRELATION-REQUIRED: clearing correlates to the repair or compensating action (amendment §5)'
      using errcode = 'P0001';
  end if;

  select * into v_row from edge_sync.outbox where event_id = p_event_id for update;
  if not found then
    raise exception 'KLUY-EDGE-OUTBOX-UNKNOWN: no outbox row for event %', p_event_id
      using errcode = 'P0001';
  end if;
  if v_row.reconciliation_state <> 'required' then
    raise exception
      'KLUY-EDGE-RECONCILIATION-NOT-RAISED: outbox row % is in reconciliation_state %, so there is nothing to clear',
      p_event_id, v_row.reconciliation_state using errcode = 'P0001';
  end if;

  perform set_config('kitluy.reconciliation_governed', 'on', true);
  update edge_sync.outbox
     set reconciliation_state             = 'cleared',
         reconciliation_cleared_at        = now(),
         reconciliation_cleared_by        = p_cleared_by,
         reconciliation_cleared_authority = p_authority,
         reconciliation_clearing_reason   = p_reason,
         reconciliation_clearing_event_id = p_resolution_event_id
   where event_id = p_event_id;
  perform set_config('kitluy.reconciliation_governed', 'off', true);
end;
$$;

comment on function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid) is
  'Clears the conflict dimension (amendment §5). Requires an authority (authorized actor or governed automated-reconciliation policy), a reason and correlation to the repair or compensating action. The caller writes the immutable edge_audit.audit_event row in the SAME transaction; delivery_state is never touched here.';

grant select on edge_sync.outbox_status to kitluy_hub_runtime, kitluy_sync_worker;
grant execute on function
  edge_sync.external_sync_status(edge_sync.delivery_state, edge_sync.reconciliation_state)
  to kitluy_hub_runtime, kitluy_sync_worker, kitluy_support_ro;

-- The delivery worker may RAISE a conflict it observes but may NOT clear one
-- (amendment §5). Clearance is granted to the Hub runtime, which carries the
-- authorization pipeline and writes the audit record.
grant execute on function edge_sync.raise_reconciliation(uuid, uuid, text)
  to kitluy_hub_runtime, kitluy_sync_worker;
grant execute on function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;
