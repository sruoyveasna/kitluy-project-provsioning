-- kitluy:hub:migration:0033
-- ===========================================================================
-- KitLuy Store Hub local database — terminal credential PROJECTION.
--
-- WS-11-T004-P04C1. Authority: the P04C owner package §15-§16 (credential
-- delivery, Hub projection and installation acknowledgment); capability
-- census row 28 ("Credential delivery to Store Hub"), which P04B's LAN
-- lifecycle matrix already READS and which nothing had yet WRITTEN;
-- offline contract §8 (the Hub applies only what it verified); ownership
-- classification: the CLOUD is the credential authority, the Hub holds a
-- projection.
--
-- ===========================================================================
-- WHAT THE HUB MAY AND MAY NOT DO WITH A CREDENTIAL
-- ===========================================================================
-- The Hub cannot author or change credential identity, the terminal, the
-- assignment, the T1-T4 profile, the Store scope, the environment or the
-- certificate status. It receives those facts through the EXISTING signed
-- cloud-to-Hub delivery path (`edge_sync.inbox`, group 0021 / WS-10-T006:
-- verify first, persist the message, then apply) and records what it was
-- told. This door is the apply half.
--
-- Concretely, the door refuses rather than "reconciles":
--   * a terminal it does not hold, or one in another Tenant/Store/Location;
--   * a credential already bound to a DIFFERENT device — a credential does
--     not move between terminals, and a delivery claiming it does is a
--     delivery about something else;
--   * a serial or public-key fingerprint that contradicts what is already
--     projected for the same credential id;
--   * a status DOWNGRADE — once the cloud has told this Hub a credential is
--     revoked or superseded, a later (or replayed, or reordered) delivery
--     cannot make it active again. This is the property that makes
--     "revoked or superseded projection cannot authorize activation or
--     pairing" hold under out-of-order delivery, not just in order;
--   * an assignment-generation regression.
--
-- ===========================================================================
-- IDEMPOTENCE IS KEYED ON THE DELIVERY, NOT ON THE ATTEMPT
-- ===========================================================================
-- `(credential_id, delivery_message_id)` is unique. A redelivered message
-- returns its ORIGINAL projection row and changes NOTHING — no second
-- credential, no rewritten history, no touched timestamps. A genuinely NEW
-- message carrying the same facts is a new projection row (the fleet is
-- entitled to know it was told twice) but still converges on one credential.
--
-- `edge_identity.credential_projection` is APPEND-ONLY history. The mutable
-- projections it drives (`device_credential`, `terminal_device`) stay
-- exactly where they already are; this group adds the governed WRITER, not
-- a second copy of the facts.
--
-- RECORDED, NOT CHANGED (inherited from group 0032's finding): the Hub
-- runtime identity still holds INSERT/UPDATE on `device_credential` and
-- `terminal_device` directly, because it is the sync projection writer.
-- This door is the AUTHORIZED credential-delivery path and the only one that
-- records evidence; narrowing the runtime's raw projection-write surface is
-- the repository-wide machine-identity question 0032 recorded and belongs to
-- its own package.
--
-- GOVERNANCE: the 0024 RV-001 executing-identity pattern. The door is
-- SECURITY DEFINER owned by the NOLOGIN, granted-to-nobody
-- kitluy_credential_projection_governor; the projection log's trigger
-- recognises that identity and nothing else. Terminals hold no database
-- identity at all.
--
-- TIME: Hub-local commit time is authoritative (0001 §1). The credential's
-- own issued/expires instants are CLOUD facts and are stored verbatim.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. GOVERNOR ROLE (0024 pattern)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_credential_projection_governor') then
    create role kitluy_credential_projection_governor nologin;
  end if;
end $$;

comment on role kitluy_credential_projection_governor is
  'Terminal credential projection authority (group 0033). NOLOGIN and granted to nobody, so current_user can only equal this role INSIDE the projection door it owns. The credential_projection trigger recognises this identity and nothing else (0024 RV-001 pattern).';

-- ---------------------------------------------------------------------------
-- 2. edge_identity.credential_projection — APPEND-ONLY delivery evidence.
-- ---------------------------------------------------------------------------
create table edge_identity.credential_projection (
  id                             uuid        primary key,
  delivery_message_id            uuid        not null,
  credential_id                  uuid        not null,
  terminal_device_id             uuid        not null references edge_identity.terminal_device (id),
  certificate_serial             text        not null,
  public_key_fingerprint         char(64)    not null,
  credential_type                text        not null,
  issuer                         text        not null,
  credential_status              text        not null,
  rotation_generation            integer     not null,
  credential_issued_at           timestamptz not null,
  credential_expires_at          timestamptz not null,
  environment                    text        not null,
  tenant_id                      uuid        not null,
  digital_store_id               uuid        not null,
  location_id                    uuid        not null,
  hub_device_id                  uuid        not null references edge_identity.hub_device (id),
  terminal_profile_code          text        not null,
  terminal_assignment_generation integer     not null,
  outcome                        text        not null,
  correlation_id                 uuid        not null,
  projected_at                   timestamptz not null,
  constraint credential_projection_delivery_uq
    unique (credential_id, delivery_message_id),
  constraint credential_projection_environment_ck
    check (environment in ('development', 'pilot', 'production')),
  constraint credential_projection_status_ck
    check (credential_status in ('active', 'revoked', 'expired', 'superseded', 'retired')),
  constraint credential_projection_outcome_ck
    check (outcome in ('projected', 'duplicate_ignored')),
  constraint credential_projection_window_ck
    check (credential_expires_at > credential_issued_at),
  constraint credential_projection_generation_ck
    check (rotation_generation >= 1 and terminal_assignment_generation >= 1),
  constraint credential_projection_fingerprint_ck
    check (public_key_fingerprint ~ '^[0-9a-f]{64}$')
);

comment on table edge_identity.credential_projection is
  'Append-only evidence of every terminal-credential delivery this Hub applied (group 0033, WS-11-T004-P04C1). One row per (credential, delivery message). The Hub AUTHORS none of these facts — they arrive through the signed cloud delivery path (offline §8) and this table records what was applied, including a redelivery that changed nothing.';
comment on column edge_identity.credential_projection.delivery_message_id is
  'The edge_sync.inbox message that carried the facts. Idempotence is keyed on the DELIVERY, so a redelivered message returns its original row instead of projecting again.';
comment on column edge_identity.credential_projection.outcome is
  'projected = this delivery moved the projection; duplicate_ignored = the same delivery was already applied and nothing changed. A NEW message carrying identical facts is still projected, because "we were told twice" is itself a fact.';

create index credential_projection_credential_idx
  on edge_identity.credential_projection (credential_id, projected_at desc);
create index credential_projection_terminal_idx
  on edge_identity.credential_projection (terminal_device_id, projected_at desc);

-- ---------------------------------------------------------------------------
-- 3. GOVERNANCE TRIGGER (0024 RV-001 executing-identity pattern)
-- ---------------------------------------------------------------------------
create function edge_identity.enforce_credential_projection_governance()
returns trigger
language plpgsql
as $gov$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'KLUY-EDGE-APPEND-ONLY: % rejected on edge_identity.credential_projection', tg_op
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_credential_projection_governor' then
    raise exception
      'KLUY-EDGE-CREDENTIAL-PROJECTION-GOVERNED: projection rows are written only by the governed delivery door (group 0033)'
      using errcode = 'P0001';
  end if;
  return new;
end
$gov$;

create trigger credential_projection_governance
  before insert or update or delete on edge_identity.credential_projection
  for each row execute function edge_identity.enforce_credential_projection_governance();

-- ---------------------------------------------------------------------------
-- 4. THE DOOR
-- ---------------------------------------------------------------------------
create function edge_identity.project_terminal_credential_v1(
  p_projection_id uuid,
  p_delivery_message_id uuid,
  p_credential_id uuid,
  p_terminal_device_id uuid,
  p_certificate_serial text,
  p_public_key_fingerprint text,
  p_credential_type text,
  p_issuer text,
  p_credential_status text,
  p_rotation_generation integer,
  p_issued_at timestamptz,
  p_expires_at timestamptz,
  p_environment text,
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_location_id uuid,
  p_hub_device_id uuid,
  p_terminal_profile_code text,
  p_terminal_assignment_generation integer,
  p_correlation_id uuid
) returns edge_identity.credential_projection
language plpgsql
security definer
set search_path = edge_identity, edge_config, edge_sync, pg_catalog
as $project$
declare
  v_existing   edge_identity.credential_projection;
  v_terminal   edge_identity.terminal_device;
  v_credential edge_identity.device_credential;
  v_assignment edge_identity.hub_assignment;
  v_row        edge_identity.credential_projection;
begin
  -- ---- 0. THE REPLAY ANSWERS FIRST -------------------------------------
  -- Before any validation: a delivery already applied returns exactly what
  -- it produced. Re-validating it could refuse today what was accepted
  -- yesterday (a credential legitimately revoked since) and would rewrite
  -- history as a side effect of a retransmission.
  select * into v_existing from edge_identity.credential_projection
   where credential_id = p_credential_id
     and delivery_message_id = p_delivery_message_id;
  if found then
    return v_existing;
  end if;

  -- ---- 1. SHAPE --------------------------------------------------------
  if p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-REQUEST: environment % is not a trust environment',
      coalesce(p_environment, '<null>') using errcode = 'P0001';
  end if;
  if p_credential_status not in ('active', 'revoked', 'expired', 'superseded', 'retired') then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-REQUEST: credential status % is not recognised',
      coalesce(p_credential_status, '<null>') using errcode = 'P0001';
  end if;
  if p_public_key_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-REQUEST: the public key fingerprint is not lowercase hex SHA-256'
      using errcode = 'P0001';
  end if;
  if p_expires_at <= p_issued_at then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-REQUEST: the credential validity window is not a window'
      using errcode = 'P0001';
  end if;

  -- ---- 2. THE TERMINAL MUST BE ONE THIS HUB HOLDS, IN THIS SCOPE -------
  select * into v_terminal from edge_identity.terminal_device
   where id = p_terminal_device_id;
  if not found then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-SCOPE: terminal % is not registered on this Hub',
      p_terminal_device_id using errcode = 'P0001';
  end if;
  if v_terminal.tenant_id <> p_tenant_id
     or v_terminal.digital_store_id <> p_digital_store_id
     or v_terminal.location_id <> p_location_id then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-SCOPE: the delivery names a different Tenant, Digital Store or Location than the registered terminal'
      using errcode = 'P0001';
  end if;

  select * into v_assignment from edge_identity.hub_assignment
   where hub_device_id = p_hub_device_id and status = 'active';
  if not found then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-SCOPE: Hub % holds no active assignment',
      p_hub_device_id using errcode = 'P0001';
  end if;
  if v_assignment.tenant_id <> p_tenant_id
     or v_assignment.digital_store_id <> p_digital_store_id
     or v_assignment.location_id <> p_location_id then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-SCOPE: the delivery scope is not this Hub''s assigned scope'
      using errcode = 'P0001';
  end if;

  -- ---- 3. THE CREDENTIAL'S IDENTITY IS IMMUTABLE ------------------------
  select * into v_credential from edge_identity.device_credential
   where id = p_credential_id;
  if found then
    if v_credential.device_id <> p_terminal_device_id then
      raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-IDENTITY: credential % is already bound to another device',
        p_credential_id using errcode = 'P0001';
    end if;
    if v_credential.certificate_serial <> p_certificate_serial
       or v_credential.public_key_fingerprint <> p_public_key_fingerprint then
      raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-IDENTITY: the delivery contradicts the projected serial or public key of credential %',
        p_credential_id using errcode = 'P0001';
    end if;
    -- STATUS IS FORWARD-ONLY. A revoked/superseded/expired/retired
    -- credential never returns to active, so a replayed or reordered
    -- delivery cannot re-authorize activation or pairing.
    if v_credential.status <> 'active' and p_credential_status = 'active' then
      raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-STATUS: credential % is %; a delivery cannot restore it to active',
        p_credential_id, v_credential.status using errcode = 'P0001';
    end if;
    if p_rotation_generation < v_credential.rotation_generation then
      raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-STATUS: rotation generation % is older than the projected %',
        p_rotation_generation, v_credential.rotation_generation using errcode = 'P0001';
    end if;
  else
    -- A serial is globally unique in this projection; a delivery reusing one
    -- under a new credential id is refused rather than allowed to collide.
    if exists (select 1 from edge_identity.device_credential
                where certificate_serial = p_certificate_serial) then
      raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-IDENTITY: certificate serial is already projected under a different credential'
        using errcode = 'P0001';
    end if;
  end if;

  if p_terminal_assignment_generation < v_terminal.assignment_generation then
    raise exception 'KLUY-EDGE-CREDENTIAL-PROJECTION-ASSIGNMENT: assignment generation % is older than the registered %',
      p_terminal_assignment_generation, v_terminal.assignment_generation using errcode = 'P0001';
  end if;

  -- ---- 4. APPLY --------------------------------------------------------
  insert into edge_identity.device_credential
    (id, device_id, credential_type, public_key_fingerprint, certificate_serial, issuer,
     issued_at, expires_at, status, revoked_at, revocation_reason, rotation_generation)
  values
    (p_credential_id, p_terminal_device_id, p_credential_type, p_public_key_fingerprint,
     p_certificate_serial, p_issuer, p_issued_at, p_expires_at, p_credential_status,
     case when p_credential_status = 'revoked' then now() else null end,
     case when p_credential_status = 'revoked' then 'cloud_projection' else null end,
     p_rotation_generation)
  on conflict (id) do update
    set status              = excluded.status,
        expires_at          = excluded.expires_at,
        rotation_generation = excluded.rotation_generation,
        revoked_at          = case when excluded.status = 'revoked'
                                   then coalesce(edge_identity.device_credential.revoked_at, now())
                                   else edge_identity.device_credential.revoked_at end,
        revocation_reason   = case when excluded.status = 'revoked'
                                   then coalesce(edge_identity.device_credential.revocation_reason,
                                                 'cloud_projection')
                                   else edge_identity.device_credential.revocation_reason end;

  -- The registration points at the credential the cloud says is CURRENT.
  -- Only an active credential moves the pointer: a revocation delivery
  -- records the revocation and leaves the terminal pointing at what it was
  -- pointing at, so nothing silently re-authorizes.
  if p_credential_status = 'active' then
    update edge_identity.terminal_device
       set certificate_serial    = p_certificate_serial,
           assignment_generation = p_terminal_assignment_generation,
           updated_at            = now()
     where id = p_terminal_device_id;
  end if;

  insert into edge_identity.credential_projection
    (id, delivery_message_id, credential_id, terminal_device_id, certificate_serial,
     public_key_fingerprint, credential_type, issuer, credential_status, rotation_generation,
     credential_issued_at, credential_expires_at, environment, tenant_id, digital_store_id,
     location_id, hub_device_id, terminal_profile_code, terminal_assignment_generation,
     outcome, correlation_id, projected_at)
  values
    (p_projection_id, p_delivery_message_id, p_credential_id, p_terminal_device_id,
     p_certificate_serial, p_public_key_fingerprint, p_credential_type, p_issuer,
     p_credential_status, p_rotation_generation, p_issued_at, p_expires_at, p_environment,
     p_tenant_id, p_digital_store_id, p_location_id, p_hub_device_id, p_terminal_profile_code,
     p_terminal_assignment_generation, 'projected', p_correlation_id, now())
  returning * into v_row;

  return v_row;
end
$project$;

comment on function edge_identity.project_terminal_credential_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, text, integer, uuid) is
  'Group 0033 (WS-11-T004-P04C1). Applies ONE signed cloud credential delivery to this Hub''s projections. Idempotent on (credential_id, delivery_message_id): a redelivery returns its ORIGINAL row and changes nothing. Refuses a terminal in another scope, a credential bound to another device, a contradicted serial or fingerprint, a status downgrade back to active, a serial collision and an assignment-generation regression. The Hub authors no credential fact. Runtime EXECUTE only.';

-- ---------------------------------------------------------------------------
-- 5. LEAST PRIVILEGE
-- ---------------------------------------------------------------------------
-- CREATE as well as USAGE: owning a function in the schema requires it
-- (the 0031 governor holds the same pair).
grant usage, create on schema edge_identity to kitluy_credential_projection_governor;
grant select, insert on edge_identity.credential_projection
  to kitluy_credential_projection_governor;
grant select, insert, update on edge_identity.device_credential
  to kitluy_credential_projection_governor;
grant select, update on edge_identity.terminal_device
  to kitluy_credential_projection_governor;
grant select on edge_identity.hub_assignment to kitluy_credential_projection_governor;

revoke all on function edge_identity.project_terminal_credential_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, text, integer, uuid) from public;

-- EXECUTE is granted BEFORE the ownership transfer: once the door belongs to
-- the unreachable governor the migrator can no longer grant on it, and an
-- existing grant survives the ownership change.
grant execute on function edge_identity.project_terminal_credential_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, text, integer, uuid)
  to kitluy_hub_runtime;
grant select on edge_identity.credential_projection to kitluy_hub_runtime;

-- Ownership transfer needs membership; explicit literal grantee, never
-- `current_user` (KLRISK-HUB-001: GRANT ... TO current_user segfaults the
-- PG 15.8 dev server).
do $$
declare
  v_migrator text := current_user;
begin
  execute format('grant kitluy_credential_projection_governor to %I', v_migrator);
end $$;

alter function edge_identity.project_terminal_credential_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, text, integer, uuid)
  owner to kitluy_credential_projection_governor;

do $$
declare
  v_migrator text := current_user;
begin
  execute format('revoke kitluy_credential_projection_governor from %I', v_migrator);
end $$;

-- ---------------------------------------------------------------------------
-- 6. PROVE THE BOUNDARY HELD
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_owner text;
  v_def text;
begin
  select pg_get_userbyid(p.proowner) into v_owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity' and p.proname = 'project_terminal_credential_v1';
  if v_owner is distinct from 'kitluy_credential_projection_governor' then
    raise exception 'KLUY-HUB-MIGRATION-0033: the projection door owner is %', coalesce(v_owner, '<none>');
  end if;

  -- The governor must be unreachable: NOLOGIN and granted to nobody, so
  -- current_user can equal it only inside the door.
  if exists (select 1 from pg_roles where rolname = 'kitluy_credential_projection_governor'
              and rolcanlogin) then
    raise exception 'KLUY-HUB-MIGRATION-0033: the projection governor can log in';
  end if;
  if exists (select 1 from pg_auth_members m
               join pg_roles r on r.oid = m.roleid
              where r.rolname = 'kitluy_credential_projection_governor') then
    raise exception 'KLUY-HUB-MIGRATION-0033: the projection governor is granted to a role';
  end if;

  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'edge_identity' and p.proname = 'project_terminal_credential_v1';
  -- Every refusal this group exists to make, asserted structurally so a
  -- future edit that drops one fails HERE rather than in production.
  if v_def not like '%KLUY-EDGE-CREDENTIAL-PROJECTION-SCOPE%'
     or v_def not like '%KLUY-EDGE-CREDENTIAL-PROJECTION-IDENTITY%'
     or v_def not like '%KLUY-EDGE-CREDENTIAL-PROJECTION-STATUS%'
     or v_def not like '%KLUY-EDGE-CREDENTIAL-PROJECTION-ASSIGNMENT%' then
    raise exception 'KLUY-HUB-MIGRATION-0033: a projection refusal family was lost';
  end if;
  -- The replay must answer BEFORE validation, or a retransmission could be
  -- refused for a fact that changed after the original was applied.
  if v_def not like '%delivery_message_id = p_delivery_message_id%' then
    raise exception 'KLUY-HUB-MIGRATION-0033: the delivery replay lookup is missing';
  end if;

  if not has_function_privilege('kitluy_hub_runtime',
       'edge_identity.project_terminal_credential_v1(uuid, uuid, uuid, uuid, text, text, text, text, text, integer, timestamptz, timestamptz, text, uuid, uuid, uuid, uuid, text, integer, uuid)',
       'EXECUTE') then
    raise exception 'KLUY-HUB-MIGRATION-0033: the runtime cannot execute the projection door';
  end if;
  if has_table_privilege('kitluy_hub_runtime', 'edge_identity.credential_projection', 'INSERT')
     or has_table_privilege('kitluy_hub_runtime', 'edge_identity.credential_projection', 'UPDATE')
     or has_table_privilege('kitluy_hub_runtime', 'edge_identity.credential_projection', 'DELETE') then
    raise exception 'KLUY-HUB-MIGRATION-0033: the runtime can write projection evidence directly';
  end if;

  raise notice 'KLUY-HUB-MIGRATION-0033: credential projection door installed; governor unreachable; append-only evidence; delivery-keyed idempotence and every refusal family asserted';
end
$guard$;
