-- kitluy:hub:migration:0041
-- ===========================================================================
-- WS-12-T002-P02 — Booking-Draft sync-acknowledgment carve-out
-- (KLD-2026-08-06-WS12-T002-001 §5; T002-P02 owner package §8/§10).
--
-- WHY A NEW GROUP. Group 0040's booking_draft guard is deliberately strict:
-- every UPDATE must advance `version` by exactly one and a non-open draft
-- can never change. That is the right rule for BUSINESS mutations — but it
-- also blocks the DELIVERY layer from recording a cloud acknowledgment
-- (`sync_state` → cloud_acknowledged / conflict + the ack pair), because an
-- ack is not a business mutation and must NOT advance the version or be
-- limited to open drafts (a cancelled draft's cancellation fact still gets
-- acknowledged). 0040 is applied and is never edited; this group replaces
-- the guard FUNCTION forward with a SYNC-METADATA-ONLY carve-out:
--
--   An update that changes NOTHING except `sync_state`, `cloud_ack_id`
--   and `cloud_acknowledged_at` is allowed on ANY lifecycle and must NOT
--   advance the version. Every other update keeps the 0040 rules exactly.
--
-- The carve-out cannot rewrite business state: identity, scope, session,
-- snapshot, notes, lifecycle, cancel reason, version, idempotency and
-- created_at are all still frozen inside it, and the ack pair remains
-- CHECK-bound ((cloud_ack_id IS NULL) = (cloud_acknowledged_at IS NULL),
-- 0040). Acknowledgments never rewrite local timestamps: updated_at is not
-- touched by the carve-out path.
-- ===========================================================================

create or replace function edge_laundry.enforce_booking_draft_guard()
returns trigger language plpgsql as $guard$
declare
  v_sync_only boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-EDGE-DRAFT-IMMUTABLE: booking drafts are never hard-deleted'
      using errcode = 'P0001';
  end if;
  -- Identity, scope, session and the customer snapshot are FROZEN at
  -- creation (owner decision §4.3) — in BOTH update classes.
  if new.id <> old.id
     or new.tenant_id <> old.tenant_id
     or new.digital_store_id <> old.digital_store_id
     or new.location_id <> old.location_id
     or new.environment <> old.environment
     or new.terminal_device_id <> old.terminal_device_id
     or new.session_id <> old.session_id
     or new.staff_actor_id <> old.staff_actor_id
     or new.customer_id is distinct from old.customer_id
     or new.walk_in <> old.walk_in
     or new.customer_snapshot <> old.customer_snapshot
     or new.created_request_key <> old.created_request_key
     or new.created_request_hash <> old.created_request_hash
     or new.correlation_id <> old.correlation_id
     or new.created_at <> old.created_at then
    raise exception 'KLUY-EDGE-DRAFT-IMMUTABLE: a frozen draft binding cannot change'
      using errcode = 'P0001';
  end if;

  -- The DELIVERY carve-out (group 0041): sync metadata only, any
  -- lifecycle, version untouched, business columns untouched.
  v_sync_only :=
        new.lifecycle = old.lifecycle
    and new.cancel_reason_code is not distinct from old.cancel_reason_code
    and new.version = old.version
    and new.preferred_language = old.preferred_language
    and new.intake_source = old.intake_source
    and new.customer_notes = old.customer_notes
    and new.staff_notes = old.staff_notes
    and (new.sync_state <> old.sync_state
         or new.cloud_ack_id is distinct from old.cloud_ack_id
         or new.cloud_acknowledged_at is distinct from old.cloud_acknowledged_at);
  if v_sync_only then
    new.updated_at := old.updated_at; -- an ack is not a local mutation
    return new;
  end if;

  -- BUSINESS mutations keep the 0040 rules exactly.
  if old.lifecycle <> 'open' then
    raise exception 'KLUY-EDGE-DRAFT-NOT-OPEN: draft % is % and cannot change',
      old.id, old.lifecycle using errcode = 'P0001';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'KLUY-EDGE-DRAFT-VERSION: version must advance monotonically (% -> %)',
      old.version, new.version using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$guard$;

do $guard0041$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('edge_laundry.enforce_booking_draft_guard()'::regprocedure);
  if v_def not like '%KLUY-EDGE-DRAFT-IMMUTABLE%'
     or v_def not like '%KLUY-EDGE-DRAFT-NOT-OPEN%'
     or v_def not like '%KLUY-EDGE-DRAFT-VERSION%' then
    raise exception 'KLUY-HUB-MIGRATION-0041: a 0040 refusal family was lost in the carve-out';
  end if;
  if v_def not like '%v_sync_only%' then
    raise exception 'KLUY-HUB-MIGRATION-0041: the sync-metadata carve-out is absent';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0041: booking-draft guard replaced forward — sync-metadata-only acknowledgments allowed on any lifecycle without a version advance; every 0040 business rule retained';
end $guard0041$;
