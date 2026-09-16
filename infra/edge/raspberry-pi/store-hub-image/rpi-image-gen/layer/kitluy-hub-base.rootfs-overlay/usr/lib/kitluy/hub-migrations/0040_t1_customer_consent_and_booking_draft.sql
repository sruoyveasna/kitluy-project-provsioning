-- kitluy:hub:migration:0040
-- ===========================================================================
-- WS-12-T002 — T1 customer registration, consent decisions and the Laundry
-- Booking Draft (KLD-2026-08-06-WS12-T002-001, OWNER-APPROVED — LOCKED).
--
-- Authority: owner decision §2 (customer identity), §3 (consent), §4
-- (Booking Draft), §5 (offline truth labels); LAN API contract (customer
-- search/create, consent record); WS-09 schema contract §6.3/§6.4 additive
-- rule ("Implementations may add ... but may not remove or repurpose").
--
-- WHAT THIS GROUP RECORDS AND WHAT IT DOES NOT. The Hub becomes the
-- Store-local authority for the WORKING Booking Draft and the local ledger
-- of consent-decision FACTS awaiting cloud ingestion; customer identity
-- truth stays CLOUD (0004 header, unchanged). A draft is NOT a Laundry
-- Booking: `edge_laundry.booking` (WS-07/WS-09 authority) is untouched,
-- and no conversion path exists in this group — conversion is a later
-- atomic governed composition (owner decision §4.2). No price, capacity,
-- payment, inventory or custody effect exists here.
--
-- CONSENT MODEL. `edge_core.customer.consent_sms/consent_email` (0004) are
-- bare mutable booleans predating the cloud consent ledger; they are NOT
-- the consent truth and this group does not read or write them (RECORDED
-- DEVIATION — an amendment to the 0004 comment is owed). Consent truth is
-- the append-only `edge_core.consent_decision` ledger below, reconciled to
-- the cloud kitluy_core consent authority through the outbox.
--
-- TIME: Hub-local commit time is authoritative (0001 §1); created_at /
-- updated_at / recorded_at come from now() in the accepting transaction,
-- never from a caller payload (owner decision §4 "created-at and
-- updated-at using Hub-authoritative time").
--
-- IDEMPOTENCY. Every mutating door takes the TERMINAL's Idempotency-Key
-- (`p_request_key`) plus a SHA-256 request hash. A replay with the SAME
-- key and hash returns the ORIGINAL business effect; the same key with a
-- DIFFERENT hash is refused (owner decision §2.6/§3.6/§4). Keys are unique
-- per effect at the schema level, so the reservation is the unique index.
--
-- GOVERNANCE PATTERN. Pattern A (0012 baseline: `terminal_session`,
-- `booking`): plain `kitluy_hub_runtime` grants with the invariants held
-- by triggers — append-only ledgers, frozen bindings, monotonic versions,
-- forward-only lifecycle — plus SQL doors so the idempotency and refusal
-- discipline has exactly one implementation. No new cluster role.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Additive customer-projection columns (0004 §6.3 additive rule).
--    Origin + sync truth labels + creation idempotency + cloud ack.
-- ---------------------------------------------------------------------------
alter table edge_core.customer
  add column origin               text        not null default 'cloud_projection',
  add column sync_state           text        not null default 'stale_projection',
  add column created_request_key  text        null,
  add column created_request_hash char(64)    null,
  add column cloud_ack_id         uuid        null,
  add column cloud_acknowledged_at timestamptz null,
  add constraint customer_origin_ck
    check (origin in ('cloud_projection', 'local_created')),
  add constraint customer_sync_state_ck
    check (sync_state in ('local_authoritative', 'cloud_acknowledged', 'pending_sync',
                          'stale_projection', 'conflict', 'unavailable')),
  add constraint customer_local_created_key_ck
    check ((origin = 'local_created') = (created_request_key is not null)),
  add constraint customer_created_hash_ck
    check (created_request_hash is null or created_request_hash ~ '^[0-9a-f]{64}$'),
  add constraint customer_ack_ck
    check ((cloud_ack_id is null) = (cloud_acknowledged_at is null));

create unique index customer_created_request_key_uq
  on edge_core.customer (created_request_key)
  where created_request_key is not null;

comment on column edge_core.customer.origin is
  'cloud_projection (row replayed from cloud truth) | local_created (T1 minimal creation awaiting cloud ingestion). Owner decision §2.6.';
comment on column edge_core.customer.sync_state is
  'Explicit truth label (owner decision §5). A locally created customer is NEVER labelled cloud_acknowledged before the cloud acknowledgment arrives; a normalized-phone collision at ingestion becomes conflict, never an automatic merge.';

-- Normalized-phone lookup support: the hash index the 0004 unique
-- constraint already provides is per-customer; scoped exact-match search
-- needs the (store, hash) probe shape.
create index customer_identifier_lookup_idx
  on edge_core.customer_identifier (digital_store_id, identifier_type, normalized_value_hash);

-- ---------------------------------------------------------------------------
-- 2. edge_core.consent_decision — APPEND-ONLY consent-decision facts.
-- ---------------------------------------------------------------------------
create table edge_core.consent_decision (
  id                 uuid        primary key,
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  customer_id        uuid        not null references edge_core.customer (id),
  purpose_key        text        not null,
  policy_ref         text        not null,
  policy_version     bigint      not null,
  decision           text        not null,
  channel            text        not null,
  source             text        not null,
  staff_assisted     boolean     not null,
  actor_id           uuid        not null,
  terminal_device_id uuid        not null references edge_identity.terminal_device (id),
  session_id         uuid        not null references edge_identity.terminal_session (id),
  request_key        text        not null,
  request_hash       char(64)    not null,
  correlation_id     uuid        not null,
  recorded_at        timestamptz not null default now(),
  constraint consent_decision_request_key_uq unique (request_key),
  constraint consent_decision_purpose_ck
    check (purpose_key in ('privacy_notice_acknowledgement', 'operational_communication',
                           'sms_marketing', 'telegram_marketing', 'email_marketing')),
  constraint consent_decision_decision_ck
    check (decision in ('granted', 'declined', 'withdrawn', 'acknowledged')),
  -- Privacy-notice acknowledgement is its own decision kind and the ONLY
  -- purpose that takes it (owner decision §3.2 — acknowledgement is not
  -- consent; one purpose cannot authorize another).
  constraint consent_decision_privacy_pairing_ck
    check ((purpose_key = 'privacy_notice_acknowledgement') = (decision = 'acknowledged')),
  constraint consent_decision_policy_version_ck check (policy_version >= 1),
  constraint consent_decision_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint consent_decision_channel_ck check (length(channel) between 1 and 64),
  constraint consent_decision_source_ck check (length(source) between 1 and 64)
);

create index consent_decision_customer_idx
  on edge_core.consent_decision (customer_id, purpose_key, recorded_at desc);
create index edge_core_consent_decision_scope_idx
  on edge_core.consent_decision (tenant_id, digital_store_id, location_id);

comment on table edge_core.consent_decision is
  'Append-only T1 consent-decision facts (owner decision §3). Withdrawal is a NEW fact — nothing here is ever updated or erased. Evidence binds policy/version, channel, decision, actor, terminal, Store scope, source, Hub-authoritative timestamp and correlation id. The cloud consent ledger (kitluy_core.consent_grants/_withdrawals) remains the durable authority; each row here is reconciled through the outbox (customer.consent_decision_recorded v1, key kh1.{id}.1).';

-- ---------------------------------------------------------------------------
-- 3. edge_laundry.booking_draft — the Hub-authoritative WORKING draft.
-- ---------------------------------------------------------------------------
create table edge_laundry.booking_draft (
  id                  uuid        primary key,
  tenant_id           uuid        not null,
  digital_store_id    uuid        not null,
  location_id         uuid        not null,
  environment         text        not null,
  terminal_device_id  uuid        not null references edge_identity.terminal_device (id),
  session_id          uuid        not null references edge_identity.terminal_session (id),
  staff_actor_id      uuid        not null,
  customer_id         uuid        null references edge_core.customer (id),
  walk_in             boolean     not null,
  customer_snapshot   jsonb       not null,
  preferred_language  text        not null,
  intake_source       text        not null,
  customer_notes      text        not null default '',
  staff_notes         text        not null default '',
  lifecycle           text        not null default 'open',
  cancel_reason_code  text        null,
  version             bigint      not null default 1,
  created_request_key text        not null,
  created_request_hash char(64)   not null,
  correlation_id      uuid        not null,
  sync_state          text        not null default 'local_authoritative',
  cloud_ack_id        uuid        null,
  cloud_acknowledged_at timestamptz null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint booking_draft_created_key_uq unique (created_request_key),
  constraint booking_draft_environment_ck
    check (environment in ('development', 'pilot', 'production')),
  constraint booking_draft_walk_in_ck check ((customer_id is null) = walk_in),
  constraint booking_draft_lifecycle_ck
    check (lifecycle in ('open', 'cancelled', 'expired', 'converted', 'superseded')),
  constraint booking_draft_cancel_reason_ck
    check ((lifecycle = 'cancelled') = (cancel_reason_code is not null)),
  constraint booking_draft_version_ck check (version >= 1),
  constraint booking_draft_hash_ck check (created_request_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_draft_language_ck check (preferred_language in ('km-KH', 'en-US')),
  constraint booking_draft_intake_source_ck check (length(intake_source) between 1 and 64),
  constraint booking_draft_notes_ck
    check (length(customer_notes) <= 2000 and length(staff_notes) <= 2000),
  constraint booking_draft_sync_state_ck
    check (sync_state in ('local_authoritative', 'cloud_acknowledged', 'pending_sync',
                          'stale_projection', 'conflict', 'unavailable')),
  constraint booking_draft_ack_ck
    check ((cloud_ack_id is null) = (cloud_acknowledged_at is null))
);

create index booking_draft_terminal_open_idx
  on edge_laundry.booking_draft (terminal_device_id, lifecycle)
  where lifecycle = 'open';
create index edge_laundry_booking_draft_scope_idx
  on edge_laundry.booking_draft (tenant_id, digital_store_id, location_id);

comment on table edge_laundry.booking_draft is
  'The mutable Laundry Booking DRAFT (owner decision §4). NOT a confirmed Laundry Booking, NOT a price/capacity commitment, NOT a payment obligation, NOT an inventory or custody event. The Hub is the Store-local authority for the working draft (sync_state stays local_authoritative in T002 — there is nothing to reconcile; conversion to `edge_laundry.booking` is a LATER atomic governed composition and is structurally absent here). customer_snapshot is the IMMUTABLE customer/contact snapshot taken at selection; later customer-master edits never rewrite it (§4.3).';
comment on column edge_laundry.booking_draft.staff_notes is
  'Internal staff notes — kept structurally separate from customer_notes (owner decision §4); never rendered on a customer-facing surface.';

-- ---------------------------------------------------------------------------
-- 4. edge_laundry.booking_draft_event — APPEND-ONLY mutation receipts.
-- ---------------------------------------------------------------------------
create table edge_laundry.booking_draft_event (
  id             uuid        primary key,
  draft_id       uuid        not null references edge_laundry.booking_draft (id),
  event_type     text        not null,
  request_key    text        not null,
  request_hash   char(64)    not null,
  changes        jsonb       not null,
  version_after  bigint      not null,
  actor_id       uuid        not null,
  terminal_device_id uuid    not null,
  session_id     uuid        not null,
  correlation_id uuid        not null,
  created_at     timestamptz not null default now(),
  constraint booking_draft_event_request_key_uq unique (request_key),
  constraint booking_draft_event_type_ck
    check (event_type in ('created', 'updated', 'cancelled')),
  constraint booking_draft_event_hash_ck check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint booking_draft_event_version_ck check (version_after >= 1)
);

create index booking_draft_event_draft_idx
  on edge_laundry.booking_draft_event (draft_id, version_after);

comment on table edge_laundry.booking_draft_event is
  'Append-only draft mutation receipts (owner decision §4 "append-only draft history"). request_key is the terminal Idempotency-Key: the unique index IS the duplicate-update guard, and a replay returns the original receipt.';

-- ---------------------------------------------------------------------------
-- 5. Invariant triggers.
-- ---------------------------------------------------------------------------
-- Append-only ledgers (0001 helpers).
create trigger consent_decision_append_only
  before update or delete on edge_core.consent_decision
  for each row execute function edge_audit.enforce_append_only();
create trigger booking_draft_event_append_only
  before update or delete on edge_laundry.booking_draft_event
  for each row execute function edge_audit.enforce_append_only();

-- Draft guard: frozen bindings, forward-only lifecycle, monotonic version.
create function edge_laundry.enforce_booking_draft_guard()
returns trigger language plpgsql as $guard$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-EDGE-DRAFT-IMMUTABLE: booking drafts are never hard-deleted'
      using errcode = 'P0001';
  end if;
  -- Identity, scope, session and the customer snapshot are FROZEN at
  -- creation (owner decision §4.3: the snapshot must not silently change).
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
  -- Terminal lifecycle states are terminal: nothing on a non-open draft
  -- may change, including its lifecycle (owner decision §4.1: only an open
  -- draft is editable; converted/cancelled/expired/superseded are ends).
  if old.lifecycle <> 'open' then
    raise exception 'KLUY-EDGE-DRAFT-NOT-OPEN: draft % is % and cannot change',
      old.id, old.lifecycle using errcode = 'P0001';
  end if;
  -- Every accepted mutation advances the version by EXACTLY one.
  if new.version <> old.version + 1 then
    raise exception 'KLUY-EDGE-DRAFT-VERSION: version must advance monotonically (% -> %)',
      old.version, new.version using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$guard$;

create trigger booking_draft_guard
  before update or delete on edge_laundry.booking_draft
  for each row execute function edge_laundry.enforce_booking_draft_guard();

-- ---------------------------------------------------------------------------
-- 6. Doors — ONE implementation of the idempotency + refusal discipline.
--    SECURITY INVOKER: they run as the calling runtime role and exercise
--    the same grants and triggers as any other runtime SQL (Pattern A).
-- ---------------------------------------------------------------------------
create function edge_core.register_local_customer_v1(
  p_customer_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_location_id uuid,
  p_display_name text,
  p_phone_e164 text,
  p_phone_hash text,
  p_phone_mask text,
  p_language_code text,
  p_source text,
  p_request_key text,
  p_request_hash text,
  p_correlation_id uuid
) returns edge_core.customer
language plpgsql
as $door$
declare
  v_existing edge_core.customer;
  v_row      edge_core.customer;
begin
  -- Replay answers first: same key + same hash = the ORIGINAL effect.
  select * into v_existing from edge_core.customer
   where created_request_key = p_request_key;
  if found then
    if v_existing.created_request_hash <> p_request_hash then
      raise exception 'KLUY-EDGE-CUSTOMER-IDEMPOTENCY-CONFLICT: request key % was used with a different request',
        p_request_key using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  if p_display_name is null or length(trim(p_display_name)) not between 1 and 200 then
    raise exception 'KLUY-EDGE-CUSTOMER-REQUEST: a display name of 1..200 characters is required'
      using errcode = 'P0001';
  end if;
  if (p_phone_e164 is null) <> (p_phone_hash is null)
     or (p_phone_e164 is null) <> (p_phone_mask is null) then
    raise exception 'KLUY-EDGE-CUSTOMER-REQUEST: phone value, hash and mask travel together'
      using errcode = 'P0001';
  end if;

  insert into edge_core.customer
    (id, tenant_id, digital_store_id, location_id, cloud_customer_id,
     display_name, phone_e164, email_normalized, language_code,
     source, origin, sync_state, created_request_key, created_request_hash,
     created_at, updated_at)
  values
    (p_customer_id, p_tenant_id, p_digital_store_id, p_location_id, null,
     trim(p_display_name), p_phone_e164, null, p_language_code,
     p_source, 'local_created', 'pending_sync', p_request_key, p_request_hash,
     now(), now())
  returning * into v_row;

  if p_phone_e164 is not null then
    insert into edge_core.customer_identifier
      (id, tenant_id, digital_store_id, location_id, customer_id,
       identifier_type, normalized_value_hash, masked_value, verified_at, created_at)
    values
      (gen_random_uuid(), p_tenant_id, p_digital_store_id, p_location_id, p_customer_id,
       'PHONE', p_phone_hash, p_phone_mask, null, now());
    -- verified_at stays NULL: phone PRESENCE is not phone VERIFICATION
    -- (owner decision §2.7) and no T1 path may fabricate verification.
  end if;

  return v_row;
end;
$door$;

create function edge_core.record_consent_decision_v1(
  p_decision_id uuid,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_location_id uuid,
  p_customer_id uuid,
  p_purpose_key text,
  p_policy_ref text,
  p_policy_version bigint,
  p_decision text,
  p_channel text,
  p_source text,
  p_staff_assisted boolean,
  p_actor_id uuid,
  p_terminal_device_id uuid,
  p_session_id uuid,
  p_request_key text,
  p_request_hash text,
  p_correlation_id uuid
) returns edge_core.consent_decision
language plpgsql
as $door$
declare
  v_existing edge_core.consent_decision;
  v_customer edge_core.customer;
  v_row      edge_core.consent_decision;
begin
  select * into v_existing from edge_core.consent_decision
   where request_key = p_request_key;
  if found then
    if v_existing.request_hash <> p_request_hash then
      raise exception 'KLUY-EDGE-CONSENT-IDEMPOTENCY-CONFLICT: request key % was used with a different request',
        p_request_key using errcode = 'P0001';
    end if;
    return v_existing;
  end if;

  select * into v_customer from edge_core.customer where id = p_customer_id;
  if not found
     or v_customer.tenant_id <> p_tenant_id
     or v_customer.digital_store_id <> p_digital_store_id then
    -- One merged refusal: existence in another scope is never disclosed
    -- (owner decision §2.4).
    raise exception 'KLUY-EDGE-CONSENT-CUSTOMER-UNKNOWN: no such customer in this Store scope'
      using errcode = 'P0001';
  end if;

  insert into edge_core.consent_decision
    (id, tenant_id, digital_store_id, location_id, customer_id,
     purpose_key, policy_ref, policy_version, decision, channel, source,
     staff_assisted, actor_id, terminal_device_id, session_id,
     request_key, request_hash, correlation_id)
  values
    (p_decision_id, p_tenant_id, p_digital_store_id, p_location_id, p_customer_id,
     p_purpose_key, p_policy_ref, p_policy_version, p_decision, p_channel, p_source,
     p_staff_assisted, p_actor_id, p_terminal_device_id, p_session_id,
     p_request_key, p_request_hash, p_correlation_id)
  returning * into v_row;
  return v_row;
end;
$door$;

comment on function edge_core.record_consent_decision_v1 is
  'The ONE consent-decision write path (owner decision §3). Append-only; a withdrawal is a NEW row; replay returns the original decision; a reused key with a different hash refuses. No preselection exists at this layer — the decision arrives explicit.';

-- ---------------------------------------------------------------------------
-- 7. Grants (0012 loop ran before these tables existed; grants are explicit).
--    No role receives DELETE — repository rule; asserted in §11.
-- ---------------------------------------------------------------------------
grant select, insert, update on edge_laundry.booking_draft to kitluy_hub_runtime;
grant select, insert on edge_laundry.booking_draft_event to kitluy_hub_runtime;
grant select, insert on edge_core.consent_decision to kitluy_hub_runtime;
grant select on edge_laundry.booking_draft,
                edge_laundry.booking_draft_event,
                edge_core.consent_decision to kitluy_backup;
grant execute on function
  edge_core.register_local_customer_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, uuid),
  edge_core.record_consent_decision_v1(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, boolean, uuid, uuid, uuid, text, text, uuid)
  to kitluy_hub_runtime;
revoke execute on function
  edge_core.register_local_customer_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, text, uuid),
  edge_core.record_consent_decision_v1(uuid, uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, boolean, uuid, uuid, uuid, text, text, uuid),
  edge_laundry.enforce_booking_draft_guard()
  from public;

-- ---------------------------------------------------------------------------
-- 8. Self-verification.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_count int;
begin
  select count(*) into v_count from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal
     and c.relname in ('consent_decision', 'booking_draft', 'booking_draft_event');
  if v_count < 3 then
    raise exception 'KLUY-HUB-MIGRATION-0040: expected the three invariant triggers, found %', v_count;
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_name in ('consent_decision', 'booking_draft_event')
       and privilege_type in ('UPDATE', 'DELETE')
       and grantee not in ('postgres', 'kitluy_migrator')
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0040: an append-only ledger is writable beyond insert';
  end if;
  if has_function_privilege('public',
      'edge_core.register_local_customer_v1(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,text,uuid)'::regprocedure,
      'execute') then
    raise exception 'KLUY-HUB-MIGRATION-0040: PUBLIC can execute the customer door';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0040: T1 customer/consent/draft authority installed (3 tables, 2 doors, invariant triggers, runtime grants only)';
end $guard$;
