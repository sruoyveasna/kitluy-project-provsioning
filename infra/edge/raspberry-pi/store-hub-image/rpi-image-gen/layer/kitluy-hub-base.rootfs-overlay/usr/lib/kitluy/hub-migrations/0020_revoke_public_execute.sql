-- kitluy:hub:migration:0020
-- ===========================================================================
-- KitLuy Store Hub local database — remove PUBLIC EXECUTE from every privileged
-- Hub procedure.
--
-- DEFECT FOUND BY A TEST, recorded rather than quietly patched.
-- `test/sync-reconciliation.test.ts` asserted that the SYNC WORKER cannot call
-- `edge_sync.clear_reconciliation`. It could. The cause is a PostgreSQL default,
-- not a missing grant: **every function is granted EXECUTE to PUBLIC on
-- creation**, and `GRANT EXECUTE ... TO <role>` does not revoke that. Every
-- `grant execute` in 0013, 0015, 0016 and 0019 was therefore decorative — the
-- functions were already callable by every role in the cluster.
--
-- WHY THIS MATTERS MOST FOR clear_reconciliation. That procedure sets the
-- governed marker the 0015 trigger checks, so it is the ONE sanctioned way past
-- the conflict-dimension guard. With PUBLIC EXECUTE, amendment
-- KLD-2026-07-28-001-A01 §5 ("a delivery worker must NOT independently clear
-- reconciliation_required") was enforced only by the worker not choosing to
-- call it.
--
-- SCOPE OF THIS FILE. It revokes PUBLIC EXECUTE from the WS-10 procedures
-- (in scope for Cycle 9) AND from the WS-09 procedures created in 0013, which
-- have the same hole: `accept_terminal_command` reserves idempotency keys and
-- `complete_command` freezes command results. Leaving a known privilege hole
-- open next to the one being closed would be worse than the recorded
-- scope-widening, so it is closed and stated rather than deferred.
--
-- Grants are then re-issued explicitly, so each procedure names exactly the
-- roles that may run it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. WS-09 procedures (0013).
-- ---------------------------------------------------------------------------
revoke execute on function
  edge_core.allocate_business_number(uuid, text, date, integer),
  edge_core.format_display_number(text, text, date, bigint),
  edge_sync.allocate_hub_sequence(),
  edge_sync.record_sequence_gap(uuid, uuid, uuid, uuid, integer, bigint, text, text, text),
  edge_sync.accept_terminal_command(uuid, uuid, uuid, uuid, uuid, text, char, text, text, uuid, bigint, integer, uuid),
  edge_sync.complete_command(text, text, text, uuid, bigint, uuid[], bigint, bigint, text, jsonb)
  from public;

grant execute on function
  edge_core.allocate_business_number(uuid, text, date, integer),
  edge_core.format_display_number(text, text, date, bigint),
  edge_sync.allocate_hub_sequence(),
  edge_sync.record_sequence_gap(uuid, uuid, uuid, uuid, integer, bigint, text, text, text),
  edge_sync.accept_terminal_command(uuid, uuid, uuid, uuid, uuid, text, char, text, text, uuid, bigint, integer, uuid),
  edge_sync.complete_command(text, text, text, uuid, bigint, uuid[], bigint, bigint, text, jsonb)
  to kitluy_hub_runtime;

-- The sync worker allocates sequences for its own audit rows but never accepts
-- or completes a TERMINAL command — that is the command layer's job alone.
grant execute on function edge_sync.allocate_hub_sequence() to kitluy_sync_worker;

-- ---------------------------------------------------------------------------
-- 2. Conflict dimension (0015). The asymmetry here IS the amendment §5 rule:
--    the delivery worker may RAISE a conflict it observes, and may not CLEAR
--    one.
-- ---------------------------------------------------------------------------
revoke execute on function
  edge_sync.raise_reconciliation(uuid, uuid, text),
  edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid),
  edge_sync.external_sync_status(edge_sync.delivery_state, edge_sync.reconciliation_state)
  from public;

grant execute on function edge_sync.raise_reconciliation(uuid, uuid, text)
  to kitluy_hub_runtime, kitluy_sync_worker;
grant execute on function edge_sync.clear_reconciliation(uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;
grant execute on function
  edge_sync.external_sync_status(edge_sync.delivery_state, edge_sync.reconciliation_state)
  to kitluy_hub_runtime, kitluy_sync_worker, kitluy_support_ro;

-- ---------------------------------------------------------------------------
-- 3. Leasing (0016), key predicates (0018) and delivery outcomes (0019).
-- ---------------------------------------------------------------------------
revoke execute on function
  edge_sync.lease_outbox_batch(uuid, integer, text, uuid, integer, integer),
  edge_sync.release_outbox_lease(uuid, uuid, text, integer),
  edge_sync.reap_expired_outbox_leases(uuid),
  edge_sync.is_canonical_effect_key(text),
  edge_sync.is_canonical_event_key(text),
  edge_sync.is_durable_rejection_code(text),
  edge_sync.acknowledge_outbox_event(uuid, uuid, text),
  edge_sync.reject_outbox_event(uuid, uuid, text, text),
  edge_sync.defer_outbox_event(uuid, uuid, text, integer, integer),
  edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid),
  edge_sync.advance_sync_cursor(uuid, text, bigint, bigint)
  from public;

grant execute on function
  edge_sync.lease_outbox_batch(uuid, integer, text, uuid, integer, integer),
  edge_sync.release_outbox_lease(uuid, uuid, text, integer),
  edge_sync.reap_expired_outbox_leases(uuid),
  edge_sync.is_canonical_effect_key(text),
  edge_sync.is_canonical_event_key(text),
  edge_sync.is_durable_rejection_code(text),
  edge_sync.acknowledge_outbox_event(uuid, uuid, text),
  edge_sync.reject_outbox_event(uuid, uuid, text, text),
  edge_sync.defer_outbox_event(uuid, uuid, text, integer, integer),
  edge_sync.advance_sync_cursor(uuid, text, bigint, bigint)
  to kitluy_hub_runtime, kitluy_sync_worker;

-- Dead-lettering RAISES the conflict dimension, so it sits with the runtime
-- that carries the authorization pipeline rather than with the worker.
grant execute on function
  edge_sync.dead_letter_outbox_event(uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;

-- ---------------------------------------------------------------------------
-- 4. The integrity helpers used inside CHECK constraints stay callable by the
--    roles that write the rows, and by nobody else.
-- ---------------------------------------------------------------------------
revoke execute on function
  edge_sync.is_canonical_idempotency_key(text),
  edge_documents.is_canonical_suppression_key(text)
  from public;

grant execute on function
  edge_sync.is_canonical_idempotency_key(text),
  edge_documents.is_canonical_suppression_key(text)
  to kitluy_hub_runtime, kitluy_sync_worker;
