-- kitluy:hub:migration:0018
-- ===========================================================================
-- KitLuy Store Hub local database — Hub-issued business-effect keys.
--
-- Authority: owner decision KLD-2026-07-28-001 Group 6 (KLREQ-026, APPROVED
-- WITH DEFINITION): "Hub-issued event-effect key
-- kh1.{command_result_uuid}.{event_ordinal}, ordinals defined by the command
-- contract rather than insertion order, deterministic across replay, separate
-- from the outbox event ID; a Hub-generated event must never claim to be a
-- terminal command; an unregistered ambiguous ordinal must fail rather than
-- emit."
--
-- WHAT CHANGES. `edge_sync.local_event.idempotency_key` was CHECKed against the
-- TERMINAL shape only, so WS-09 had to derive Hub-issued event keys that looked
-- like terminal keys (`kl1.{hub_device_uuid}.{hub_sequence}`). That is exactly
-- the impersonation the ruling forbids. The column now accepts EITHER
-- namespace, and the command layer emits `kh1.*` for every event.
--
-- WHAT DOES NOT CHANGE. `edge_sync.command_result.idempotency_key` keeps the
-- STRICT terminal check: a command result always belongs to a terminal command
-- (`terminal_device_id` is NOT NULL), so widening it would allow a service
-- pipeline to occupy the terminal command ledger. Every business relation that
-- stores a terminal key keeps the strict check too.
--
-- The constraint is REPLACED, not dropped: the new one is strictly more
-- permissive, so no existing row can be invalidated, and the seed's `kl1.*`
-- local events stay valid exactly as written.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The Hub-issued effect key shape.
-- ---------------------------------------------------------------------------
create function edge_sync.is_canonical_effect_key(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select p_key ~ '^kh1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,10}$';
$$;

comment on function edge_sync.is_canonical_effect_key(text) is
  'KLREQ-026: kh1.{command_result_uuid}.{event_ordinal}. DISJOINT BY PREFIX from the terminal kl1.* namespace, so a Hub-generated effect can never be read as a terminal command.';

-- ---------------------------------------------------------------------------
-- 2. Either namespace is valid for an EVENT.
-- ---------------------------------------------------------------------------
create function edge_sync.is_canonical_event_key(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select edge_sync.is_canonical_idempotency_key(p_key)
      or edge_sync.is_canonical_effect_key(p_key);
$$;

comment on function edge_sync.is_canonical_event_key(text) is
  'A local event key is either the TERMINAL kl1.* form (historical rows and the shipped fixtures) or the Hub-issued kh1.* effect form (KLREQ-026). Nothing else is accepted, so an unshaped key still cannot be persisted.';

alter table edge_sync.local_event
  drop constraint local_event_idempotency_key_ck;

alter table edge_sync.local_event
  add constraint local_event_idempotency_key_ck
    check (edge_sync.is_canonical_event_key(idempotency_key));

comment on constraint local_event_idempotency_key_ck on edge_sync.local_event is
  'KLREQ-026 (KLD-2026-07-28-001 Group 6): an event carries a Hub-issued kh1.* effect key. The kl1.* form stays accepted for rows written before the ruling and for the shipped fixtures; edge_sync.command_result keeps the STRICT terminal check because a command result always belongs to a terminal command.';

grant execute on function
  edge_sync.is_canonical_effect_key(text),
  edge_sync.is_canonical_event_key(text)
  to kitluy_hub_runtime, kitluy_sync_worker;
