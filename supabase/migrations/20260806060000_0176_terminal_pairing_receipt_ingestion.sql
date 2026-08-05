-- kitluy:group:0176
-- Migration group 0176: terminal_pairing_receipt_ingestion.
--
-- Authority: WS-11-T004-P04C3 (package contract §21-§23); Store Hub spec
-- §11.4/§11.5 (per-event results, per-data-class conflict policy); owner
-- decision KLD-2026-07-28-001 Group 6 / KLREQ-026 (the Hub-issued `kh1.*`
-- effect key is the deduplication identity, deterministic across replay);
-- amendment KLD-2026-07-28-001-A01 §2 (a durable rejection is a cloud verdict,
-- never a transport failure); Hub group 0031 (the Hub-signed pairing receipt).
--
-- ===========================================================================
-- WHO OWNS PAIRING, AND WHAT THIS TABLE IS
-- ===========================================================================
-- The STORE HUB is the pairing authority (ownership classification A, since
-- P03B). This group stores FLEET EVIDENCE and a read projection. It therefore
-- refuses, structurally, to do any of the four things that would make the
-- cloud a second pairing authority:
--
--   * it never CHANGES a received `paired_at` — the column is written once,
--     from the Hub's own instant, and the integrity trigger rejects any
--     update that moves it;
--   * it never alters the receipt, its transcript hash or its signature;
--   * it has no door that CREATES a pairing — the only entry point ingests a
--     receipt the Hub already issued;
--   * nothing here can cause a second LOCAL receipt, because nothing here
--     talks back to a Hub.
--
-- FRESHNESS IS A SEPARATE FACT FROM HISTORY. `paired_at` is when the terminal
-- paired; `first_received_at` and `last_received_at` are when the cloud heard
-- about it. Conflating them is how a fleet dashboard starts reporting a
-- delayed delivery as a re-pairing, so they are separate columns and the
-- ingestion door moves only the second pair.
--
-- ===========================================================================
-- IDEMPOTENCE, REPLAY AND OUT-OF-ORDER DELIVERY
-- ===========================================================================
-- Business deduplication identity: the PAIRING RECEIPT ID (owner package §22),
-- which is the primary key. Repeated, delayed or reordered delivery produces
-- exactly ONE business effect: the first delivery inserts, every later one
-- bumps `last_received_at` and `delivery_count` and returns the ORIGINAL row.
--
-- A redelivery whose FACTS differ from the stored ones is a CONFLICT, not an
-- update: the original stands and the door raises. The cloud never silently
-- rewrites Hub history, and "the Hub told us something different" is a fact an
-- operator is entitled to rather than one to be smoothed over.
--
-- The effect key is recorded alongside so an operator can tie a projection row
-- back to the exact outbox effect that produced it.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P04C3 -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. IDENTITIES
-- ---------------------------------------------------------------------------
-- The governor owns the table and the door; the service identity is what the
-- Edge synchronization ingestion ENTERS (SET LOCAL ROLE) for one transaction.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_pairing_receipt_governor') then
    create role kitluy_pairing_receipt_governor nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_edge_sync_service') then
    create role kitluy_edge_sync_service nologin;
  end if;
  -- The 0173 hinge pattern: a NOINHERIT NOLOGIN gateway so `service_role` does
  -- not silently CARRY the ingestion capability, while membership stays
  -- transitive so SET LOCAL ROLE still reaches it for exactly one transaction.
  if not exists (select 1 from pg_roles where rolname = 'kitluy_edge_sync_gateway') then
    create role kitluy_edge_sync_gateway nologin noinherit;
  end if;
end
$roles$;

comment on role kitluy_pairing_receipt_governor is
  'Group 0176 (WS-11-T004-P04C3). Owns the pairing-receipt fleet projection and its ingestion door. NOLOGIN; current_user can equal it only inside the door.';
comment on role kitluy_edge_sync_service is
  'Group 0176. The identity Hub-authenticated Edge synchronization ingestion ENTERS for one transaction. Holds EXECUTE on the ingestion door and no table reach of its own.';
comment on role kitluy_edge_sync_gateway is
  'Group 0176, the 0173 hinge pattern. NOLOGIN and NOINHERIT, holding no privilege: PostgreSQL stops the automatic-privilege walk here, so service_role does not INHERIT the ingestion capability while SET LOCAL ROLE can still reach it.';

grant kitluy_edge_sync_service to kitluy_edge_sync_gateway;
grant kitluy_edge_sync_gateway to service_role;

-- Owning a relation and a function in the schema requires CREATE as well as
-- USAGE; the runtime search_path also reaches `extensions`.
grant usage, create on schema kitluy_devices to kitluy_pairing_receipt_governor;
grant usage on schema extensions to kitluy_pairing_receipt_governor;
grant usage on schema kitluy_devices to kitluy_edge_sync_service;

do $borrow$
begin
  execute format('grant kitluy_pairing_receipt_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 2. THE FLEET PROJECTION
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.terminal_pairing_receipts (
  receipt_id                     uuid        primary key,
  receipt_version                text        not null,
  pairing_session_id             uuid        not null unique,
  hub_device_id                  uuid        not null,
  terminal_device_id             uuid        not null,
  terminal_assignment_generation integer     not null,
  terminal_profile_code          text        not null,
  tenant_id                      uuid        not null,
  digital_store_id               uuid        not null,
  location_id                    uuid        not null,
  environment                    text        not null,
  hub_certificate_fingerprint    char(64)    not null,
  terminal_certificate_fingerprint char(64)  not null,
  hub_certificate_serial         text        not null,
  transcript_hash                char(64)    not null,
  hub_receipt_signature          text        not null,
  -- HUB TIME. Written once, never moved (see the integrity trigger).
  paired_at                      timestamptz not null,
  -- CLOUD TIME. Deliberately separate from paired_at.
  first_received_at              timestamptz not null,
  last_received_at               timestamptz not null,
  delivery_count                 integer     not null,
  effect_key                     text        not null,
  correlation_id                 uuid        not null,
  constraint tpr_environment_ck check (environment in ('development', 'pilot', 'production')),
  constraint tpr_generation_ck check (terminal_assignment_generation >= 1),
  constraint tpr_delivery_count_ck check (delivery_count >= 1),
  constraint tpr_received_order_ck check (last_received_at >= first_received_at),
  constraint tpr_fingerprints_ck
    check (hub_certificate_fingerprint ~ '^[0-9a-f]{64}$'
       and terminal_certificate_fingerprint ~ '^[0-9a-f]{64}$'
       and transcript_hash ~ '^[0-9a-f]{64}$'),
  constraint tpr_effect_key_ck check (effect_key ~ '^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$')
);

comment on table kitluy_devices.terminal_pairing_receipts is
  'Group 0176 (WS-11-T004-P04C3). FLEET EVIDENCE of Hub-issued terminal pairing receipts, replicated through the Hub outbox. The STORE HUB is the pairing authority; this is a read projection. paired_at is HUB time and is written once; first/last_received_at are CLOUD time and are the only freshness facts. Deduplicated on the receipt id (the business identity), so repeated, delayed or reordered delivery yields exactly one business effect.';
comment on column kitluy_devices.terminal_pairing_receipts.paired_at is
  'HUB-authoritative instant, from the Hub-signed receipt. Never moved by any redelivery — the integrity trigger rejects it. Distinct from last_received_at, which is when the cloud heard about it.';
comment on column kitluy_devices.terminal_pairing_receipts.delivery_count is
  'How many times this receipt has been delivered. A count above one is a delivery fact, never a second pairing.';

create index if not exists tpr_terminal_idx
  on kitluy_devices.terminal_pairing_receipts (terminal_device_id, paired_at desc);
create index if not exists tpr_scope_idx
  on kitluy_devices.terminal_pairing_receipts (tenant_id, digital_store_id, location_id);
create unique index if not exists tpr_effect_key_uq
  on kitluy_devices.terminal_pairing_receipts (effect_key);

-- ---------------------------------------------------------------------------
-- 3. INTEGRITY: THE HUB'S FACTS ARE NOT THE CLOUD'S TO EDIT
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_pairing_receipt_integrity()
returns trigger
language plpgsql
as $integrity$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-PAIRING-RECEIPT-IMMUTABLE: fleet pairing evidence is never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_pairing_receipt_governor' then
    raise exception 'KLUY-PAIRING-RECEIPT-GOVERNED: rows change only through the ingestion door (group 0176)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' then
    -- ONLY the freshness pair and the delivery count may move. Everything the
    -- Hub asserted is frozen, so no redelivery can rewrite history.
    if new.receipt_id <> old.receipt_id
       or new.receipt_version <> old.receipt_version
       or new.pairing_session_id <> old.pairing_session_id
       or new.hub_device_id <> old.hub_device_id
       or new.terminal_device_id <> old.terminal_device_id
       or new.terminal_assignment_generation <> old.terminal_assignment_generation
       or new.terminal_profile_code <> old.terminal_profile_code
       or new.tenant_id <> old.tenant_id
       or new.digital_store_id <> old.digital_store_id
       or new.location_id <> old.location_id
       or new.environment <> old.environment
       or new.hub_certificate_fingerprint <> old.hub_certificate_fingerprint
       or new.terminal_certificate_fingerprint <> old.terminal_certificate_fingerprint
       or new.hub_certificate_serial <> old.hub_certificate_serial
       or new.transcript_hash <> old.transcript_hash
       or new.hub_receipt_signature <> old.hub_receipt_signature
       or new.paired_at <> old.paired_at
       or new.first_received_at <> old.first_received_at
       or new.effect_key <> old.effect_key then
      raise exception 'KLUY-PAIRING-RECEIPT-IMMUTABLE: the cloud cannot change a fact the Store Hub asserted'
        using errcode = 'P0001';
    end if;
    if new.delivery_count <= old.delivery_count or new.last_received_at < old.last_received_at then
      raise exception 'KLUY-PAIRING-RECEIPT-IMMUTABLE: freshness moves forward only'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end
$integrity$;

drop trigger if exists tpr_integrity on kitluy_devices.terminal_pairing_receipts;
create trigger tpr_integrity
  before insert or update or delete on kitluy_devices.terminal_pairing_receipts
  for each row execute function kitluy_devices.enforce_pairing_receipt_integrity();

revoke all on function kitluy_devices.enforce_pairing_receipt_integrity() from public;

-- Deny-by-absence with the 0126/0163/0174 governor-policy pattern (FORCE RLS
-- with zero policies would block the NOLOGIN definer owner itself).
alter table kitluy_devices.terminal_pairing_receipts enable row level security;
alter table kitluy_devices.terminal_pairing_receipts force row level security;
revoke all on table kitluy_devices.terminal_pairing_receipts from public;
drop policy if exists tpr_governor on kitluy_devices.terminal_pairing_receipts;
create policy tpr_governor on kitluy_devices.terminal_pairing_receipts
  for all to kitluy_pairing_receipt_governor using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 4. THE INGESTION DOOR
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.ingest_terminal_pairing_receipt_v1(
  p_effect_key text,
  p_receipt_id uuid,
  p_receipt_version text,
  p_pairing_session_id uuid,
  p_hub_device_id uuid,
  p_terminal_device_id uuid,
  p_terminal_assignment_generation integer,
  p_terminal_profile_code text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_location_id uuid,
  p_environment text,
  p_hub_certificate_fingerprint text,
  p_terminal_certificate_fingerprint text,
  p_hub_certificate_serial text,
  p_transcript_hash text,
  p_hub_receipt_signature text,
  p_paired_at timestamptz,
  p_correlation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $ingest$
declare
  v_existing kitluy_devices.terminal_pairing_receipts;
begin
  if p_effect_key !~ '^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$' then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)'
      using errcode = 'P0001';
  end if;
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: environment % is not a trust environment',
      coalesce(p_environment, '<null>') using errcode = 'P0001';
  end if;

  -- The receipt ID is the BUSINESS identity. A redelivery answers from the
  -- stored row without recomputing anything.
  select * into v_existing from kitluy_devices.terminal_pairing_receipts
   where receipt_id = p_receipt_id
   for update;

  if found then
    -- A redelivery must assert the SAME facts. Anything else is a conflict the
    -- original survives, never a silent overwrite (Hub spec §11.4: no generic
    -- last-write-wins).
    if v_existing.pairing_session_id <> p_pairing_session_id
       or v_existing.hub_device_id <> p_hub_device_id
       or v_existing.terminal_device_id <> p_terminal_device_id
       or v_existing.tenant_id <> p_tenant_id
       or v_existing.digital_store_id <> p_digital_store_id
       or v_existing.location_id <> p_location_id
       or v_existing.environment <> p_environment
       or v_existing.transcript_hash <> lower(p_transcript_hash)
       or v_existing.hub_receipt_signature <> p_hub_receipt_signature
       or v_existing.paired_at <> p_paired_at
       or v_existing.effect_key <> p_effect_key then
      raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: receipt % was already ingested with different facts; the original stands',
        p_receipt_id using errcode = 'P0001';
    end if;
    -- ONE business effect. Only freshness moves.
    update kitluy_devices.terminal_pairing_receipts
       set last_received_at = now(),
           delivery_count   = delivery_count + 1
     where receipt_id = p_receipt_id;
    return jsonb_build_object(
      'outcome', 'DUPLICATE_IGNORED',
      'receipt_id', p_receipt_id,
      'paired_at', v_existing.paired_at,
      'delivery_count', v_existing.delivery_count + 1);
  end if;

  -- A pairing session identifies ONE handshake; two receipt ids claiming the
  -- same session would be two cloud truths for one Hub fact.
  if exists (select 1 from kitluy_devices.terminal_pairing_receipts
              where pairing_session_id = p_pairing_session_id) then
    raise exception 'KLUY-PAIRING-RECEIPT-CONFLICT: pairing session % already carries a different receipt',
      p_pairing_session_id using errcode = 'P0001';
  end if;

  insert into kitluy_devices.terminal_pairing_receipts
    (receipt_id, receipt_version, pairing_session_id, hub_device_id, terminal_device_id,
     terminal_assignment_generation, terminal_profile_code, tenant_id, digital_store_id,
     location_id, environment, hub_certificate_fingerprint, terminal_certificate_fingerprint,
     hub_certificate_serial, transcript_hash, hub_receipt_signature, paired_at,
     first_received_at, last_received_at, delivery_count, effect_key, correlation_id)
  values
    (p_receipt_id, p_receipt_version, p_pairing_session_id, p_hub_device_id, p_terminal_device_id,
     p_terminal_assignment_generation, p_terminal_profile_code, p_tenant_id, p_digital_store_id,
     p_location_id, p_environment, lower(p_hub_certificate_fingerprint),
     lower(p_terminal_certificate_fingerprint), p_hub_certificate_serial, lower(p_transcript_hash),
     p_hub_receipt_signature, p_paired_at, now(), now(), 1, p_effect_key, p_correlation_id);

  return jsonb_build_object(
    'outcome', 'INGESTED',
    'receipt_id', p_receipt_id,
    'paired_at', p_paired_at,
    'delivery_count', 1);
end
$ingest$;

comment on function kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid) is
  'Group 0176 (WS-11-T004-P04C3). Idempotent cloud ingestion of ONE Hub-issued pairing receipt, keyed on the receipt id. Repeated, delayed or reordered delivery produces exactly one business effect and moves only the cloud-side freshness columns; a redelivery asserting DIFFERENT facts is a conflict the original survives. The cloud never authors pairing, never moves paired_at and never becomes the LAN pairing authority.';

-- ---------------------------------------------------------------------------
-- 5. READ PROJECTION
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.read_terminal_pairing_state_v1(
  p_terminal_device_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $read$
declare
  v_row kitluy_devices.terminal_pairing_receipts;
begin
  select * into v_row from kitluy_devices.terminal_pairing_receipts
   where terminal_device_id = p_terminal_device_id
   order by paired_at desc
   limit 1;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'receipt_id', v_row.receipt_id,
    'pairing_session_id', v_row.pairing_session_id,
    'hub_device_id', v_row.hub_device_id,
    'terminal_profile_code', v_row.terminal_profile_code,
    'terminal_assignment_generation', v_row.terminal_assignment_generation,
    'environment', v_row.environment,
    -- HUB time and CLOUD time, never merged into one "last seen".
    'paired_at', v_row.paired_at,
    'first_received_at', v_row.first_received_at,
    'last_received_at', v_row.last_received_at,
    'delivery_count', v_row.delivery_count);
end
$read$;

comment on function kitluy_devices.read_terminal_pairing_state_v1(uuid) is
  'Group 0176. Read projection of the fleet pairing evidence. Returns HUB time (paired_at) and CLOUD time (first/last_received_at) as separate facts, so a delayed delivery is never reported as a re-pairing.';

-- ---------------------------------------------------------------------------
-- 6. OWNERSHIP AND LEAST PRIVILEGE
-- ---------------------------------------------------------------------------
alter table kitluy_devices.terminal_pairing_receipts owner to kitluy_pairing_receipt_governor;

do $own$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid)',
    'kitluy_devices.read_terminal_pairing_state_v1(uuid)'] loop
    execute format('alter function %s owner to kitluy_pairing_receipt_governor', v_fn);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
    execute format('grant execute on function %s to kitluy_edge_sync_service, kitluy_test_harness', v_fn);
  end loop;
end
$own$;

do $hand_back$
begin
  execute format('revoke kitluy_pairing_receipt_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 7. PROVE THE BOUNDARY ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_fn text;
  v_fns text[] := array[
    'kitluy_devices.ingest_terminal_pairing_receipt_v1(text, uuid, text, uuid, uuid, uuid, integer, text, uuid, uuid, uuid, text, text, text, text, text, text, timestamptz, uuid)',
    'kitluy_devices.read_terminal_pairing_state_v1(uuid)'];
begin
  foreach v_fn in array v_fns loop
    if not exists (
      select 1 from pg_proc p where p.oid = v_fn::regprocedure
        and p.prosecdef and pg_get_userbyid(p.proowner) = 'kitluy_pairing_receipt_governor'
        and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')) then
      raise exception 'KLUY-MIGRATION-0176: % is not definer, governor-owned or pinned', v_fn
        using errcode = 'P0001';
    end if;
    if has_function_privilege('public', v_fn, 'execute')
       or has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('authenticated', v_fn, 'execute')
       or has_function_privilege('kitluy_worker_service', v_fn, 'execute')
       or has_function_privilege('kitluy_provisioning_service', v_fn, 'execute')
       or not has_function_privilege('kitluy_edge_sync_service', v_fn, 'execute')
       or not has_function_privilege('kitluy_test_harness', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0176: the grant boundary for % is wrong', v_fn
        using errcode = 'P0001';
    end if;
    -- EFFECTIVE privilege: the 0173 correction's property must hold for this
    -- capability too — service_role must ENTER the identity, never carry it.
    if has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'KLUY-MIGRATION-0176: service_role EFFECTIVELY holds % without entering the ingestion identity', v_fn
        using errcode = 'P0001';
    end if;
  end loop;

  -- The hinge exists with the posture the boundary depends on.
  if not exists (select 1 from pg_roles
                  where rolname = 'kitluy_edge_sync_gateway'
                    and not rolcanlogin and not rolinherit) then
    raise exception 'KLUY-MIGRATION-0176: the edge-sync gateway is missing its NOLOGIN/NOINHERIT posture'
      using errcode = 'P0001';
  end if;
  -- The ingestion identity holds EXECUTE and NO table reach of its own.
  if has_table_privilege('kitluy_edge_sync_service', 'kitluy_devices.terminal_pairing_receipts', 'SELECT')
     or has_table_privilege('kitluy_edge_sync_service', 'kitluy_devices.terminal_pairing_receipts', 'INSERT')
     or has_table_privilege('kitluy_edge_sync_service', 'kitluy_devices.terminal_pairing_receipts', 'UPDATE')
     or has_table_privilege('kitluy_edge_sync_service', 'kitluy_devices.terminal_pairing_receipts', 'DELETE') then
    raise exception 'KLUY-MIGRATION-0176: the ingestion identity has direct table reach'
      using errcode = 'P0001';
  end if;
  -- RLS is on and forced, with exactly the governor policy.
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'kitluy_devices' and c.relname = 'terminal_pairing_receipts'
                    and c.relrowsecurity and c.relforcerowsecurity) then
    raise exception 'KLUY-MIGRATION-0176: row level security is not enabled and forced'
      using errcode = 'P0001';
  end if;
  -- The cloud cannot move a Hub fact: the integrity trigger must be present.
  if not exists (select 1 from pg_trigger t
                   join pg_class c on c.oid = t.tgrelid
                   join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'kitluy_devices'
                    and c.relname = 'terminal_pairing_receipts'
                    and t.tgname = 'tpr_integrity' and not t.tgisinternal) then
    raise exception 'KLUY-MIGRATION-0176: the pairing-receipt integrity trigger is missing'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0176: pairing-receipt fleet ingestion installed (receipt-id idempotence, one business effect per receipt, Hub facts frozen, freshness separate from paired_at, ingestion identity must be ENTERED)';
end
$guard$;
