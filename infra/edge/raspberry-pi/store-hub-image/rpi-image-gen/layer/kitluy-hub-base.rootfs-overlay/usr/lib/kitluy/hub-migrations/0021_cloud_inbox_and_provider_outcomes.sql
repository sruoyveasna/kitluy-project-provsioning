-- kitluy:hub:migration:0021
-- ===========================================================================
-- KitLuy Store Hub local database — signed cloud-to-Hub delivery and provider
-- payment outcomes.
--
-- Authority: owner decision KLD-2026-07-28-001 Group 7 (KLREQ-027, APPROVED
-- WITH DEFINITION), verbatim in substance: "Direct provider-to-Hub callbacks
-- are NOT authorized; the canonical path is provider -> cloud connector/payment
-- service -> signed WS-10 delivery -> local projection. Dedupe on
-- `provider_code + provider_account_reference + provider_event_id`, with
-- documented provider-specific fallbacks only (no generic silent fallback).
-- Conflicting outcomes move to `reconciliation_required` and are never silently
-- overwritten; provider secrets stay cloud-controlled."
-- Also: offline contract §8 (the Hub persists a message BEFORE application,
-- applies in contiguous order, returns the original result for a duplicate
-- id/sequence, and records an expired command as REJECTED rather than silently
-- skipping it).
--
-- ADDITIVE EXTENSION (recorded gap G10): `edge_sync.provider_outcome_delivery`.
-- The canonical Hub catalogue has no provider-event relation, deliberately —
-- provider truth is CLOUD-ONLY (reconciliation §2). But the ruling REQUIRES a
-- dedupe on the provider triple, and a dedupe with nowhere to remember what it
-- saw is not a dedupe. This relation stores the DELIVERY, not provider truth:
-- it records which signed cloud message carried which provider outcome, so a
-- redelivery is recognised and a CONTRADICTORY redelivery is caught. An
-- amendment to the canonical document is OWED.
--
-- NO PROVIDER SECRET IS STORED OR VERIFIED HERE. The Hub verifies the CLOUD's
-- signature on the delivery; provider signature verification happened in the
-- cloud, where the provider secret lives (repository rule 4).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Inbox application discipline (offline contract §8).
-- ---------------------------------------------------------------------------
alter table edge_sync.inbox
  add column applied_result jsonb null,
  add column verified_at timestamptz null;

comment on column edge_sync.inbox.applied_result is
  'The result produced when this message was applied. A DUPLICATE delivery returns THIS value rather than applying again (offline §8), so a redelivery is answered with the original outcome instead of a second effect.';
comment on column edge_sync.inbox.verified_at is
  'When the CLOUD signature verified. A message is persisted before application and can only be applied after this is set — the Hub never applies what it did not verify.';

alter table edge_sync.inbox
  add constraint inbox_verified_before_applied_ck
    check (state <> 'applied' or verified_at is not null),
  add constraint inbox_rejected_reason_ck
    check (state <> 'rejected' or error_code is not null);

comment on constraint inbox_verified_before_applied_ck on edge_sync.inbox is
  'Offline contract §8: verification precedes application. An unverified message can reach `rejected` or `dead_letter`, never `applied`.';

-- ---------------------------------------------------------------------------
-- 2. edge_sync.provider_outcome_delivery — the KLREQ-027 dedupe.
--
-- The UNIQUE key IS the ruling's triple. `provider_account_reference` is NOT
-- NULL: a provider that does not supply one needs a DOCUMENTED provider-specific
-- fallback, which is a per-provider decision. A generic silent fallback (say,
-- an empty string) would quietly merge two accounts' events into one dedupe
-- space, which the ruling forbids.
-- ---------------------------------------------------------------------------
create table edge_sync.provider_outcome_delivery (
  id                         uuid        primary key,
  tenant_id                  uuid        not null,
  digital_store_id           uuid        not null,
  location_id                uuid        not null,
  inbox_message_id           uuid        not null references edge_sync.inbox (message_id),
  provider_code              text        not null,
  provider_account_reference text        not null,
  provider_event_id          text        not null,
  payment_id                 uuid        null references edge_payments.payment (id),
  provider_transaction_id    text        null,
  outcome_status             text        not null,
  amount_minor               bigint      not null,
  currency_code              char(3)     not null,
  currency_exponent          smallint    not null,
  outcome_sha256             char(64)    not null,
  received_at                timestamptz not null,
  applied_at                 timestamptz null,
  state                      text        not null default 'received',
  conflict_id                uuid        null references edge_sync.sync_conflict (id),
  constraint provider_outcome_delivery_dedupe_uq
    unique (provider_code, provider_account_reference, provider_event_id),
  constraint provider_outcome_delivery_status_ck
    check (outcome_status in ('SUCCEEDED', 'FAILED', 'EXPIRED')),
  constraint provider_outcome_delivery_state_ck
    check (state in ('received', 'applied', 'quarantined', 'conflicted')),
  constraint provider_outcome_delivery_hash_ck check (outcome_sha256 ~ '^[0-9a-f]{64}$'),
  constraint provider_outcome_delivery_amount_ck check (amount_minor >= 0),
  constraint provider_outcome_delivery_currency_ck check (currency_code ~ '^[A-Z]{3}$'),
  constraint provider_outcome_delivery_exponent_ck
    check (currency_exponent between 0 and 4),
  constraint provider_outcome_delivery_applied_ck
    check (state <> 'applied' or applied_at is not null),
  -- A CONFLICTED delivery names the conflict record. Contradiction without a
  -- record is the silent overwrite the ruling forbids.
  constraint provider_outcome_delivery_conflict_ck
    check (state <> 'conflicted' or conflict_id is not null),
  constraint provider_outcome_delivery_reference_ck
    check (btrim(provider_account_reference) <> '' and btrim(provider_event_id) <> '')
);

comment on table edge_sync.provider_outcome_delivery is
  'ADDITIVE EXTENSION (gap G10) — the KLREQ-027 dedupe surface. Records which SIGNED CLOUD DELIVERY carried which provider outcome, keyed on provider_code + provider_account_reference + provider_event_id. Stores no provider secret and performs no provider signature verification: that happened in the cloud, where the secret lives. Amendment to the canonical document is owed.';
comment on column edge_sync.provider_outcome_delivery.outcome_sha256 is
  'Digest of the CANONICAL outcome facts (status, amount, currency, provider transaction). A redelivery with the same triple but a DIFFERENT digest is a contradiction, not a duplicate.';
comment on column edge_sync.provider_outcome_delivery.provider_account_reference is
  'NOT NULL by design (KLREQ-027: "documented provider-specific fallbacks only, no generic silent fallback"). A provider that supplies none needs its own recorded fallback rule; an empty placeholder would merge two accounts into one dedupe space.';

create index edge_sync_provider_outcome_delivery_scope_idx
  on edge_sync.provider_outcome_delivery (tenant_id, digital_store_id, location_id);
create index provider_outcome_delivery_payment_idx
  on edge_sync.provider_outcome_delivery (payment_id);

create trigger provider_outcome_delivery_no_delete
  before delete on edge_sync.provider_outcome_delivery
  for each row execute function edge_audit.enforce_no_hard_delete();

-- ---------------------------------------------------------------------------
-- 3. edge_sync.accept_provider_outcome — the dedupe/conflict decision.
--
-- Returns one of:
--   'accepted'   first sight of this provider event; the caller applies it
--   'duplicate'  same triple, same facts; the caller applies NOTHING
--   'conflict'   same triple, DIFFERENT facts; the caller applies NOTHING and
--                the delivery is marked conflicted
--
-- The stored row is never overwritten. A contradiction produces a NEW conflict
-- record and leaves the original outcome exactly as it was recorded.
-- ---------------------------------------------------------------------------
create function edge_sync.accept_provider_outcome(
  p_id                         uuid,
  p_tenant_id                  uuid,
  p_digital_store_id           uuid,
  p_location_id                uuid,
  p_inbox_message_id           uuid,
  p_provider_code              text,
  p_provider_account_reference text,
  p_provider_event_id          text,
  p_payment_id                 uuid,
  p_provider_transaction_id    text,
  p_outcome_status             text,
  p_amount_minor               bigint,
  p_currency_code              char(3),
  p_currency_exponent          smallint,
  p_outcome_sha256             char(64)
) returns text
language plpgsql
as $$
declare
  v_existing edge_sync.provider_outcome_delivery%rowtype;
  v_conflict uuid;
begin
  select * into v_existing
  from edge_sync.provider_outcome_delivery
  where provider_code = p_provider_code
    and provider_account_reference = p_provider_account_reference
    and provider_event_id = p_provider_event_id
  for update;

  if found then
    if v_existing.outcome_sha256 = p_outcome_sha256 then
      return 'duplicate';
    end if;

    -- CONTRADICTION. The first recording stands; the second is recorded as a
    -- conflict for governed reconciliation and applies nothing.
    v_conflict := gen_random_uuid();
    insert into edge_sync.sync_conflict
      (id, tenant_id, digital_store_id, location_id, conflict_type, data_class,
       cloud_reference, detected_at, state, severity, local_summary, cloud_summary)
    values
      (v_conflict, p_tenant_id, p_digital_store_id, p_location_id,
       'provider_outcome_contradiction', 'finance_payment',
       p_provider_code || ':' || p_provider_event_id, now(), 'operator_required', 'high',
       jsonb_build_object('recorded_outcome_sha256', v_existing.outcome_sha256,
                          'recorded_status', v_existing.outcome_status,
                          'recorded_amount_minor', v_existing.amount_minor::text),
       jsonb_build_object('redelivered_outcome_sha256', p_outcome_sha256,
                          'redelivered_status', p_outcome_status,
                          'redelivered_amount_minor', p_amount_minor::text));

    update edge_sync.provider_outcome_delivery
       set state = 'conflicted', conflict_id = v_conflict
     where id = v_existing.id;
    return 'conflict';
  end if;

  insert into edge_sync.provider_outcome_delivery
    (id, tenant_id, digital_store_id, location_id, inbox_message_id, provider_code,
     provider_account_reference, provider_event_id, payment_id, provider_transaction_id,
     outcome_status, amount_minor, currency_code, currency_exponent, outcome_sha256,
     received_at, state)
  values
    (p_id, p_tenant_id, p_digital_store_id, p_location_id, p_inbox_message_id, p_provider_code,
     p_provider_account_reference, p_provider_event_id, p_payment_id, p_provider_transaction_id,
     p_outcome_status, p_amount_minor, p_currency_code, p_currency_exponent, p_outcome_sha256,
     now(), 'received');
  return 'accepted';
end;
$$;

comment on function edge_sync.accept_provider_outcome(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, bigint, char, smallint, char) is
  'KLREQ-027 dedupe on provider_code + provider_account_reference + provider_event_id. A redelivery with the same facts is a duplicate; a redelivery with DIFFERENT facts records a sync_conflict and marks the delivery conflicted, so a contradictory outcome is never silently overwritten.';

create function edge_sync.mark_provider_outcome_applied(p_id uuid)
returns void
language sql
as $$
  update edge_sync.provider_outcome_delivery
     set state = 'applied', applied_at = now()
   where id = p_id and state = 'received';
$$;

comment on function edge_sync.mark_provider_outcome_applied(uuid) is
  'Marks a first-sight delivery as applied. A conflicted or already-applied row is untouched, so applying twice cannot rewrite the record of what happened.';

revoke execute on function
  edge_sync.accept_provider_outcome(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, bigint, char, smallint, char),
  edge_sync.mark_provider_outcome_applied(uuid)
  from public;

grant execute on function
  edge_sync.accept_provider_outcome(uuid, uuid, uuid, uuid, uuid, text, text, text, uuid, text, text, bigint, char, smallint, char),
  edge_sync.mark_provider_outcome_applied(uuid)
  to kitluy_hub_runtime;

grant select, insert, update on edge_sync.provider_outcome_delivery
  to kitluy_hub_runtime, kitluy_sync_worker;
grant select on edge_sync.provider_outcome_delivery to kitluy_backup;
