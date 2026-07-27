-- kitluy:hub:migration:0001
-- ===========================================================================
-- KitLuy Store Hub local database — shared types and integrity helpers.
--
-- Authority: kitluy-storehub-local-database-schema-v1.0.0.md §5 (shared types,
-- reproduced VERBATIM below), §1 (append-only + no hard delete conventions),
-- kitluy-offline-idempotency-and-sequencing-v1.0.0.md §2 (terminal
-- idempotency key format) and §11.1 (print suppression key format).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- §5 shared types — value lists are verbatim from the canonical contract.
-- ---------------------------------------------------------------------------
create type edge_sync.delivery_state as enum
  ('pending','sending','acknowledged','retry_wait','blocked','dead_letter');
create type edge_sync.inbox_state as enum
  ('received','verified','applied','rejected','dead_letter');
create type edge_sync.conflict_state as enum
  ('open','auto_resolved','operator_required','resolved','waived');
create type edge_documents.print_state as enum
  ('queued','dispatching','printed','failed','retry_wait','dead_letter','cancelled');
create type edge_config.activation_state as enum
  ('downloaded','verified','staged','active','rejected','rolled_back');
create type edge_files.transfer_state as enum
  ('local_only','queued','uploading','uploaded','verifying','available','failed','quarantined','evicted');
create type edge_hardware.health_state as enum
  ('unknown','ready','busy','degraded','disconnected','misconfigured','unsupported','maintenance_required');

comment on type edge_sync.delivery_state is
  'Canonical PERSISTED per-event delivery state (§5). Recorded gap G2: this is the only persisted sync vocabulary; the LAN API wire value stays `pending_cloud_sync` and the Hub-level `sync_state` describes the HUB, not a row.';

-- ---------------------------------------------------------------------------
-- Terminal idempotency key (offline contract §2).
--
--   kl1.{terminal_device_uuid}.{client_sequence}
--
-- Recorded gap G1: the CANONICAL format governs. The shipped
-- `@kitluy/sync-protocol` helper emits the non-canonical
-- `location:{id}:hub:{id}:seq:{n}` shape and is tracked for correction as
-- KLREQ-020. Every Hub relation that stores an idempotency key CHECKs this
-- function, so the non-canonical shape cannot be persisted.
-- ---------------------------------------------------------------------------
create function edge_sync.is_canonical_idempotency_key(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select p_key ~ '^kl1\.[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.[0-9]{1,20}$';
$$;

comment on function edge_sync.is_canonical_idempotency_key(text) is
  'Offline contract §2: kl1.{terminal_device_uuid}.{client_sequence}. client_sequence is an unsigned 64-bit integer, so up to 20 digits are accepted. Gap G1: the location:...:hub:...:seq:N shape is rejected.';

-- Print duplicate-suppression key (offline contract §11.1):
--   print1.{document_id}.{document_version}.{printer_binding_id}.{copy_index}
create function edge_documents.is_canonical_suppression_key(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select p_key ~ ('^print1\.'
    || '[0-9a-fA-F-]{36}\.'
    || '[0-9]{1,20}\.'
    || '[0-9a-fA-F-]{36}\.'
    || '[0-9]{1,10}$');
$$;

comment on function edge_documents.is_canonical_suppression_key(text) is
  'Offline contract §11.1 print retry key. A retry reuses the key; an intentional reprint gets a NEW job id and a NEW key (§11.2).';

-- ---------------------------------------------------------------------------
-- Append-only enforcement (§1 "Finance/payment/custody/audit: append-only;
-- corrections are compensating records").
--
-- Same pattern as the cloud `kitluy_auth.enforce_append_only()` after review
-- RV-201: rejection is UNCONDITIONAL. Append-only means nobody mutates
-- through ordinary SQL; an approved operator repair disables the trigger
-- explicitly inside its own audited transaction.
-- ---------------------------------------------------------------------------
create function edge_audit.enforce_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'KLUY-EDGE-APPEND-ONLY: % rejected on %.% (append-only ledger; corrections are compensating records)',
    tg_op, tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

comment on function edge_audit.enforce_append_only() is
  'Unconditionally rejects UPDATE and DELETE on append-only finance/payment/custody/audit ledgers (§1).';

-- No hard delete for finalized business records (§1 "Deletion"). UPDATE stays
-- legal for lifecycle projections; only physical removal is refused.
create function edge_audit.enforce_no_hard_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'KLUY-EDGE-NO-HARD-DELETE: DELETE rejected on %.% (finalized business record; use a lifecycle state or a tombstone event)',
    tg_table_schema, tg_table_name
    using errcode = 'P0001';
end;
$$;

comment on function edge_audit.enforce_no_hard_delete() is
  'Rejects DELETE on finalized business records (§1 "No hard delete for finalized business records; use lifecycle state or tombstone events").';

-- Projection freshness helper. Local commit time is authoritative (§1
-- "Operational truth"), so updated_at is maintained by the database rather
-- than trusted from a client payload.
create function edge_audit.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function edge_audit.touch_updated_at() is
  'Maintains updated_at on projection relations. Immutable ledgers never carry this trigger.';
