-- kitluy:migration:0213
--
-- PHYSICAL TERMINALS AND TERMINAL PAIRING SESSIONS: one code for one named seat
-- =============================================================================
-- Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 section 6 (the Partner
-- selects the logical terminal profiles this physical Pi will operate,
-- optionally names it, opens a pairing session and receives a one-time code)
-- and section 7 (the pairing session is authoritative for the assignment: the
-- Pi learns Store, Location, Hub, roles and vertical from the code alone);
-- KLD-2026-09-03-FACTORY-ENROLLMENT-001 section 8 (only an Admin-approved
-- device may pair; the Partner controls the Store assignment);
-- KLD-2026-09-04-TERMINAL-PROVISIONING-CLARIFICATIONS-001 (optional name, no
-- QR, one code carrying a role set).
--
-- WHY THE 0162-0171 PROVISIONING-CODE CHAIN IS NOT THE PI PATH
-- ------------------------------------------------------------
-- issue_terminal_provisioning_code_v1 (0163) issues one code per terminal
-- ASSIGNMENT that already exists, for an HET actor holding
-- fleet.device_provisioning_code.issue, and its evaluator (0164) needs the
-- assignment id first. The owner rule is the opposite order: the Partner names
-- a seat and its roles, opens a session, and the Pi types the code knowing
-- nothing else. That is the Store Hub session model of group 0194 applied to a
-- named seat instead of a whole Store. The 0162 chain stays for HET-issued
-- codes and is not touched here.
--
-- WHAT A PHYSICAL TERMINAL IS
-- ---------------------------
-- A named seat in a Store (Front Counter 01) with an ordered set of terminal
-- profile keys (laundry.t1.intake_cashier, laundry.t2.customer_display). It
-- exists before any board does and binds to exactly one device when a session
-- is consumed. The label is a LABEL: it grants nothing and identifies nothing.
--
-- WHAT A SESSION DOES ON CONSUMPTION
-- ----------------------------------
-- Everything group 0121 already governs, through its own doors: a device-bound
-- claim is created and redeemed (enrolled -> awaiting_trust), one terminal
-- assignment is created per role, and only then is the session marked consumed
-- and the seat bound. No table of group 0121 is written directly, so every
-- 0121 refusal, the generation model and the lifecycle trigger stay intact.
--
-- WHO MAY DO WHAT
-- ---------------
-- Defining a seat, setting its roles, opening and cancelling a session are the
-- PARTNER route, behind the new permission fleet.terminal_pairing_code.issue,
-- entered as kitluy_terminal_issuance_service. Evaluating and consuming a
-- session are the DEVICE route, entered as kitluy_terminal_pairing_service.
-- Neither identity holds the other capability and neither holds table access.
-- No browser role can reach any of it (OD-ADMIN-FLEET-001).

begin;

do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The seat.
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.physical_terminals (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references kitluy_core.tenants (id),
  digital_store_id        uuid not null references kitluy_core.digital_stores (id),
  store_location_id       uuid not null references kitluy_core.store_locations (id),
  label                   text not null,
  bound_device_id         uuid references kitluy_devices.devices (id),
  bound_assignment_id     uuid references kitluy_devices.device_assignments (id),
  bound_at                timestamptz,
  created_by_operator_ref text not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint physical_terminals_label_chk
    check (length(btrim(label)) between 1 and 64 and label !~ '[[:cntrl:]]'),
  constraint physical_terminals_binding_coherent_chk
    check ((bound_device_id is null) = (bound_assignment_id is null)
       and (bound_device_id is null) = (bound_at is null))
);

comment on table kitluy_devices.physical_terminals is
  'Group 0213. A named seat in a Store for one Pi Terminal: the Partner defines it with a label and a role set before any board exists, and it binds to exactly one device when a terminal pairing session is consumed. The label is a display label only. Owner: Fleet. MC: A/O.';

create unique index if not exists physical_terminals_label_per_store_uidx
  on kitluy_devices.physical_terminals (digital_store_id, lower(btrim(label)));
create unique index if not exists physical_terminals_one_per_device_uidx
  on kitluy_devices.physical_terminals (bound_device_id) where bound_device_id is not null;
create index if not exists physical_terminals_store_idx
  on kitluy_devices.physical_terminals (digital_store_id, created_at desc);

alter table kitluy_devices.physical_terminals enable row level security;
alter table kitluy_devices.physical_terminals force row level security;

-- -----------------------------------------------------------------------------
-- 2. The roles a seat carries. Soft-removed, never deleted: what the operator
--    saw on the screen keeps meaning what they saw.
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.physical_terminal_roles (
  id                      uuid primary key default gen_random_uuid(),
  physical_terminal_id    uuid not null references kitluy_devices.physical_terminals (id),
  terminal_profile_key    text not null,
  ordinal                 integer not null check (ordinal >= 0),
  added_by_operator_ref   text not null,
  added_at                timestamptz not null default now(),
  removed_at              timestamptz,
  removed_by_operator_ref text,
  -- The same structural shape 0121 enforces on device_terminal_assignments:
  -- <vertical>.t<n>.<role>. Neutral Fleet carries no vertical vocabulary.
  constraint physical_terminal_roles_shape_chk
    check (terminal_profile_key ~ '^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$'),
  constraint physical_terminal_roles_removed_coherent_chk
    check ((removed_at is null) = (removed_by_operator_ref is null))
);

comment on table kitluy_devices.physical_terminal_roles is
  'Group 0213. The ordered terminal profile keys a physical terminal will operate. Rows are soft-removed, never deleted. Owner: Fleet. MC: A/O.';

create unique index if not exists physical_terminal_roles_live_uidx
  on kitluy_devices.physical_terminal_roles (physical_terminal_id, terminal_profile_key)
  where removed_at is null;

alter table kitluy_devices.physical_terminal_roles enable row level security;
alter table kitluy_devices.physical_terminal_roles force row level security;

-- -----------------------------------------------------------------------------
-- 3. The session: one code for one seat.
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.terminal_pairing_sessions (
  id                      uuid primary key default gen_random_uuid(),
  physical_terminal_id    uuid not null references kitluy_devices.physical_terminals (id),
  tenant_id               uuid not null references kitluy_core.tenants (id),
  digital_store_id        uuid not null references kitluy_core.digital_stores (id),
  store_location_id       uuid not null references kitluy_core.store_locations (id),
  -- The ACTIVE Store Hub at this scope, resolved when the session opens. A
  -- terminal never provisions before its Hub is active (owner decision v2.0.0
  -- section 3), so a session cannot exist without one.
  store_hub_device_id     uuid not null references kitluy_devices.devices (id),
  -- Snapshot of the live roles at open: what the code will assign.
  terminal_profile_keys   text[] not null,
  environment             text not null
                            check (environment in ('development', 'pilot', 'production')),
  -- Only the DIGEST. The plaintext is shown once by the Portal and exists
  -- nowhere server-side, exactly as in group 0194.
  code_sha256             text not null unique check (code_sha256 ~ '^[0-9a-f]{64}$'),
  state                   text not null default 'open'
                            check (state in ('open', 'consumed', 'expired', 'revoked', 'locked')),
  paired_device_id        uuid references kitluy_devices.devices (id),
  paired_assignment_id    uuid references kitluy_devices.device_assignments (id),
  paired_at               timestamptz,
  failed_attempt_count    integer not null default 0
                            check (failed_attempt_count between 0 and 5),
  locked_at               timestamptz,
  locked_reason           text,
  revoked_reason          text,
  created_by_operator_ref text not null,
  created_at              timestamptz not null default now(),
  expires_at              timestamptz not null,
  constraint terminal_pairing_sessions_ttl_chk
    check (expires_at > created_at and expires_at <= created_at + interval '15 minutes'),
  constraint terminal_pairing_sessions_lock_coherent_chk
    check ((locked_at is null) = (locked_reason is null)),
  constraint terminal_pairing_sessions_paired_coherent_chk
    check ((paired_device_id is null) = (paired_at is null)
       and (paired_device_id is null) = (paired_assignment_id is null)),
  constraint terminal_pairing_sessions_roles_chk
    check (cardinality(terminal_profile_keys) between 1 and 8)
);

comment on table kitluy_devices.terminal_pairing_sessions is
  'Group 0213. A Partner-opened pairing session for ONE physical terminal: one code, fifteen minutes, five attempts, single use. Carries the Store scope, the active Store Hub and the role snapshot the code will assign, so a Pi that types the code learns everything from server rows. Only the code digest is stored. Owner: Fleet. MC: A/O.';

create unique index if not exists terminal_pairing_sessions_one_open_idx
  on kitluy_devices.terminal_pairing_sessions (physical_terminal_id) where state = 'open';
create index if not exists terminal_pairing_sessions_store_open_idx
  on kitluy_devices.terminal_pairing_sessions (digital_store_id, state) where state = 'open';

alter table kitluy_devices.terminal_pairing_sessions enable row level security;
alter table kitluy_devices.terminal_pairing_sessions force row level security;

-- -----------------------------------------------------------------------------
-- 4. Append-only history of what happened to a seat.
-- -----------------------------------------------------------------------------
create table if not exists kitluy_devices.physical_terminal_events (
  id                   uuid primary key default gen_random_uuid(),
  physical_terminal_id uuid not null references kitluy_devices.physical_terminals (id),
  pairing_session_id   uuid references kitluy_devices.terminal_pairing_sessions (id),
  tenant_id            uuid not null,
  digital_store_id     uuid not null,
  store_location_id    uuid not null,
  event_type           text not null,
  actor_ref            text not null,
  detail               jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz not null default now(),
  constraint physical_terminal_events_type_chk check (event_type in (
    'DEFINED', 'ROLES_SET',
    'SESSION_OPENED', 'SESSION_SUPERSEDED', 'SESSION_CANCELLED', 'SESSION_FAILED_ATTEMPT',
    'SESSION_LOCKED', 'SESSION_EXPIRED', 'SESSION_CONSUMED', 'DEVICE_BOUND'))
);

comment on table kitluy_devices.physical_terminal_events is
  'Group 0213. Append-only audit of everything that happened to a physical terminal and its pairing sessions. Corrections are new events (repository rule 11). Owner: Fleet. MC: A/O.';

create index if not exists physical_terminal_events_terminal_idx
  on kitluy_devices.physical_terminal_events (physical_terminal_id, occurred_at desc);

alter table kitluy_devices.physical_terminal_events enable row level security;
alter table kitluy_devices.physical_terminal_events force row level security;

-- -----------------------------------------------------------------------------
-- 5. Immutability, enforced on the rows.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.refuse_physical_terminal_event_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-PHYSTERM-EVENT-APPEND-ONLY: physical terminal events are append-only'
    using errcode = 'P0001';
end;
$$;

create or replace trigger refuse_physical_terminal_event_change
  before update or delete on kitluy_devices.physical_terminal_events
  for each row execute function kitluy_devices.refuse_physical_terminal_event_change();

create or replace function kitluy_devices.enforce_physical_terminal_integrity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-PHYSTERM-IMMUTABLE: a physical terminal is never deleted'
      using errcode = 'P0001';
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.created_at is distinct from old.created_at
     or new.created_by_operator_ref is distinct from old.created_by_operator_ref then
    raise exception 'KLUY-PHYSTERM-IMMUTABLE: a physical terminal keeps its Store and Location for life'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger enforce_physical_terminal_integrity
  before update or delete on kitluy_devices.physical_terminals
  for each row execute function kitluy_devices.enforce_physical_terminal_integrity();

create or replace function kitluy_devices.enforce_physical_terminal_role_integrity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-PHYSTERM-ROLE-IMMUTABLE: a role row is soft-removed, never deleted'
      using errcode = 'P0001';
  end if;
  if new.physical_terminal_id is distinct from old.physical_terminal_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.ordinal is distinct from old.ordinal
     or new.added_at is distinct from old.added_at
     or new.added_by_operator_ref is distinct from old.added_by_operator_ref then
    raise exception 'KLUY-PHYSTERM-ROLE-IMMUTABLE: only the removal fields of a role row may change'
      using errcode = 'P0001';
  end if;
  if old.removed_at is not null and new.removed_at is distinct from old.removed_at then
    raise exception 'KLUY-PHYSTERM-ROLE-IMMUTABLE: a removed role stays removed'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger enforce_physical_terminal_role_integrity
  before update or delete on kitluy_devices.physical_terminal_roles
  for each row execute function kitluy_devices.enforce_physical_terminal_role_integrity();

-- Scope, seat, Hub, roles, code and expiry are fixed at open. Only the closing
-- fields may move, and the paired device may be set exactly once (0194 rule).
create or replace function kitluy_devices.enforce_terminal_pairing_session_integrity()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-TERMSESSION-IMMUTABLE: a pairing session is never deleted'
      using errcode = 'P0001';
  end if;
  if new.physical_terminal_id is distinct from old.physical_terminal_id
     or new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_profile_keys is distinct from old.terminal_profile_keys
     or new.environment is distinct from old.environment
     or new.code_sha256 is distinct from old.code_sha256
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at then
    raise exception
      'KLUY-TERMSESSION-IMMUTABLE: a pairing session keeps its seat, scope, Hub, roles, code and expiry from the moment it opens'
      using errcode = 'P0001';
  end if;
  if old.paired_device_id is not null and new.paired_device_id is distinct from old.paired_device_id then
    raise exception 'KLUY-TERMSESSION-ALREADY-PAIRED: this session already paired a device'
      using errcode = 'P0001';
  end if;
  if old.state <> 'open' and new.state <> old.state then
    raise exception 'KLUY-TERMSESSION-CLOSED: a closed pairing session cannot change state'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace trigger enforce_terminal_pairing_session_integrity
  before update or delete on kitluy_devices.terminal_pairing_sessions
  for each row execute function kitluy_devices.enforce_terminal_pairing_session_integrity();

-- -----------------------------------------------------------------------------
-- 6. The permission and the two composition identities.
-- -----------------------------------------------------------------------------
-- One key for the whole Partner workflow of section 17: define, set roles, open,
-- cancel, observe. A seat is inert until a session opens, so it is governed by
-- the session authority. fleet.device_provisioning_code.issue (0163) is NOT
-- reused: its door is executable by any authenticated actor with no Store-scope
-- conjunct, so handing that key to Partners would let one issue codes for any
-- terminal assignment id in the system.
insert into kitluy_auth.permissions
  (permission_key, version, risk_class, resource_types, environments, status)
select 'fleet.terminal_pairing_code.issue', 1, 'CRITICAL',
       array['device', 'physical_terminal'], array['all'], 'ACTIVE'
 where not exists (
   select 1 from kitluy_auth.permissions
    where permission_key = 'fleet.terminal_pairing_code.issue');

insert into kitluy_auth.role_permission_grants (role_template_id, permission_id, effect)
select rt.id, p.id, 'ALLOW'
  from kitluy_auth.role_templates rt
  join kitluy_auth.permissions p on p.permission_key = 'fleet.terminal_pairing_code.issue'
 where rt.role_key = 'DIGITAL_STORE_STAFF'
   and not exists (
     select 1 from kitluy_auth.role_permission_grants g
      where g.role_template_id = rt.id and g.permission_id = p.id);

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_terminal_issuance_service') then
    create role kitluy_terminal_issuance_service nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'kitluy_terminal_pairing_service') then
    create role kitluy_terminal_pairing_service nologin;
  end if;
end
$roles$;

comment on role kitluy_terminal_issuance_service is
  'Group 0213. The Partner-side terminal pairing identity, assumed per transaction (SET LOCAL ROLE) by the management API. Holds EXECUTE on the seat and session doors a Partner drives (define, set roles, open, cancel) plus the code alphabet, and NOTHING else: no table access, no evaluation, no consumption. Authorization is decided BEFORE this role is entered, by kitluy_auth.has_permission(fleet.terminal_pairing_code.issue) and a separate Store-scope check against the caller''s own assignments.';

comment on role kitluy_terminal_pairing_service is
  'Group 0213. The device-side terminal pairing identity, assumed per transaction by the device registry service when a Pi Terminal presents a code. Holds EXECUTE on exactly two capabilities, evaluate and consume, and no table access. It cannot open or cancel a session and cannot define a seat.';

grant kitluy_terminal_issuance_service to service_role;
grant kitluy_terminal_pairing_service to service_role;
grant usage on schema kitluy_devices to kitluy_terminal_issuance_service;
grant usage on schema kitluy_devices to kitluy_terminal_pairing_service;

-- -----------------------------------------------------------------------------
-- 7. Helpers. Internal: executable by the definer doors only.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.physical_terminal_live_roles_v1(p_physical_terminal_id uuid)
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(r.terminal_profile_key order by r.ordinal, r.added_at), '{}'::text[])
    from kitluy_devices.physical_terminal_roles r
   where r.physical_terminal_id = p_physical_terminal_id
     and r.removed_at is null;
$$;

-- Validates a role set against the shape rule and the Store vertical. Returns
-- null when acceptable, otherwise a refusal object. The vertical check is
-- structural: the first segment of every key must equal the Store vertical
-- code, lower-cased. Fleet learns no vertical vocabulary here.
create or replace function kitluy_devices.validate_physical_terminal_roles_v1(
  p_keys text[],
  p_vertical_code text
) returns jsonb
language plpgsql
stable
as $$
declare
  v_key text;
begin
  if p_keys is null or cardinality(p_keys) < 1 or cardinality(p_keys) > 8 then
    return jsonb_build_object('refusal_code', 'KLUY-PHYSTERM-ROLES-COUNT',
      'detail', 'a physical terminal carries between one and eight terminal profiles');
  end if;
  if (select count(distinct k) from unnest(p_keys) as k) <> cardinality(p_keys) then
    return jsonb_build_object('refusal_code', 'KLUY-PHYSTERM-ROLES-DUPLICATE',
      'detail', 'each terminal profile may be named once');
  end if;
  foreach v_key in array p_keys loop
    if v_key !~ '^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$' then
      return jsonb_build_object('refusal_code', 'KLUY-PHYSTERM-ROLE-SHAPE',
        'detail', 'a terminal profile key has the shape <vertical>.t<n>.<role>');
    end if;
    if split_part(v_key, '.', 1) <> lower(coalesce(p_vertical_code, '')) then
      return jsonb_build_object('refusal_code', 'KLUY-PHYSTERM-ROLE-VERTICAL',
        'detail', 'a terminal profile must belong to the Store''s own business vertical');
    end if;
  end loop;
  return null;
end;
$$;

-- The ACTIVE Store Hub at a scope: a projected assignment for a device of class
-- store_hub. Written only by successful activation (0121), so its presence IS
-- the Hub being active. Earliest projection wins when a Store has more than one.
create or replace function kitluy_devices.active_store_hub_at_scope_v1(
  p_tenant_id uuid,
  p_digital_store_id uuid,
  p_store_location_id uuid
) returns table (device_id uuid, asset_tag text, environment text)
language sql
stable
as $$
  select p.device_id, d.asset_tag, p.environment
    from kitluy_devices.device_assignment_projections p
    join kitluy_devices.devices d on d.id = p.device_id and d.device_class = 'store_hub'
   where p.tenant_id = p_tenant_id
     and p.digital_store_id = p_digital_store_id
     and p.store_location_id = p_store_location_id
   order by p.projected_at, p.device_id
   limit 1;
$$;

create or replace function kitluy_devices.record_physical_terminal_event_v1(
  p_physical_terminal_id uuid,
  p_pairing_session_id uuid,
  p_event_type text,
  p_actor_ref text,
  p_detail jsonb
) returns uuid
language plpgsql
as $$
declare
  v_pt kitluy_devices.physical_terminals;
  v_id uuid;
begin
  select * into v_pt from kitluy_devices.physical_terminals where id = p_physical_terminal_id;
  insert into kitluy_devices.physical_terminal_events
    (physical_terminal_id, pairing_session_id, tenant_id, digital_store_id, store_location_id,
     event_type, actor_ref, detail)
  values
    (p_physical_terminal_id, p_pairing_session_id, v_pt.tenant_id, v_pt.digital_store_id,
     v_pt.store_location_id, p_event_type, coalesce(p_actor_ref, 'system'),
     coalesce(p_detail, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Partner doors: define a seat, set its roles.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.define_physical_terminal_v1(
  p_digital_store_id uuid,
  p_store_location_id uuid,
  p_label text,
  p_terminal_profile_keys text[],
  p_operator_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, extensions
as $define$
declare
  v_store kitluy_core.digital_stores;
  v_keys text[];
  v_key text;
  v_label text;
  v_n integer;
  v_id uuid;
  v_refusal jsonb;
  v_ordinal integer := 0;
begin
  if p_operator_ref is null or btrim(p_operator_ref) = '' then
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-NO-ACTOR', 'detail', 'a definition names who made it');
  end if;

  -- Tenant is DERIVED from the Store row, never accepted from the caller.
  select * into v_store from kitluy_core.digital_stores where id = p_digital_store_id;
  if not found then
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-SCOPE-UNKNOWN', 'detail', 'that Digital Store does not exist');
  end if;
  if v_store.status in ('SUSPENDED', 'CLOSED') then
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-STORE-INACTIVE',
      'detail', format('that Digital Store is %s', v_store.status));
  end if;
  if not exists (
    select 1 from kitluy_core.store_locations sl
     where sl.id = p_store_location_id and sl.digital_store_id = p_digital_store_id) then
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-SCOPE-UNKNOWN',
      'detail', 'that Location does not belong to that Digital Store');
  end if;

  -- The caller's order is kept; duplicates are refused rather than folded.
  select array_agg(k order by ord) into v_keys
    from unnest(coalesce(p_terminal_profile_keys, '{}'::text[])) with ordinality as u(k, ord);
  v_refusal := kitluy_devices.validate_physical_terminal_roles_v1(v_keys, v_store.primary_vertical_code);
  if v_refusal is not null then
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED') || v_refusal;
  end if;

  -- The name is OPTIONAL (owner decision v2.0.0 section 6, clarified
  -- 2026-09-04). A blank one becomes the first free "Terminal N" in this Store.
  v_label := nullif(btrim(coalesce(p_label, '')), '');
  if v_label is null then
    v_n := 1;
    loop
      v_label := 'Terminal ' || v_n;
      exit when not exists (
        select 1 from kitluy_devices.physical_terminals pt
         where pt.digital_store_id = p_digital_store_id
           and lower(btrim(pt.label)) = lower(v_label));
      v_n := v_n + 1;
      if v_n > 999 then
        return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
          'refusal_code', 'KLUY-PHYSTERM-LABEL-EXHAUSTED',
          'detail', 'no generated name is free; name the terminal explicitly');
      end if;
    end loop;
  else
    if length(v_label) > 64 or v_label ~ '[[:cntrl:]]' then
      return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
        'refusal_code', 'KLUY-PHYSTERM-LABEL-SHAPE',
        'detail', 'a terminal name is 1 to 64 printable characters');
    end if;
    if exists (
      select 1 from kitluy_devices.physical_terminals pt
       where pt.digital_store_id = p_digital_store_id
         and lower(btrim(pt.label)) = lower(v_label)) then
      return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
        'refusal_code', 'KLUY-PHYSTERM-LABEL-TAKEN',
        'detail', 'this Store already has a terminal with that name');
    end if;
  end if;

  begin
    insert into kitluy_devices.physical_terminals
      (tenant_id, digital_store_id, store_location_id, label, created_by_operator_ref)
    values
      (v_store.tenant_id, p_digital_store_id, p_store_location_id, v_label, p_operator_ref)
    returning id into v_id;
  exception when unique_violation then
    -- A concurrent definition took the same name between the check and the
    -- insert. The index is the truth; the answer is the same refusal.
    return jsonb_build_object('outcome', 'DEFINITION_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-LABEL-TAKEN',
      'detail', 'this Store already has a terminal with that name');
  end;

  foreach v_key in array v_keys loop
    insert into kitluy_devices.physical_terminal_roles
      (physical_terminal_id, terminal_profile_key, ordinal, added_by_operator_ref)
    values (v_id, v_key, v_ordinal, p_operator_ref);
    v_ordinal := v_ordinal + 1;
  end loop;

  perform kitluy_devices.record_physical_terminal_event_v1(
    v_id, null, 'DEFINED', p_operator_ref,
    jsonb_build_object('label', v_label, 'terminal_profile_keys', to_jsonb(v_keys)));

  return jsonb_build_object(
    'outcome', 'DEFINED',
    'physical_terminal_id', v_id,
    'tenant_id', v_store.tenant_id,
    'digital_store_id', p_digital_store_id,
    'store_location_id', p_store_location_id,
    'label', v_label,
    'terminal_profile_keys', to_jsonb(v_keys),
    'created_at', now());
end;
$define$;

comment on function kitluy_devices.define_physical_terminal_v1 is
  'Group 0213. A Partner defines a named seat with a role set in one of their Stores. Tenant derived from the Store; Location must belong to the Store; roles validated structurally against the Store vertical; name optional (generated "Terminal N" when blank) and unique per Store case-insensitively. Authorization happens BEFORE this door, at the route.';

create or replace function kitluy_devices.set_physical_terminal_roles_v1(
  p_physical_terminal_id uuid,
  p_terminal_profile_keys text[],
  p_operator_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, extensions
as $roles$
declare
  v_pt kitluy_devices.physical_terminals;
  v_store kitluy_core.digital_stores;
  v_keys text[];
  v_before text[];
  v_key text;
  v_refusal jsonb;
  v_ordinal integer;
begin
  if p_operator_ref is null or btrim(p_operator_ref) = '' then
    return jsonb_build_object('outcome', 'ROLES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-NO-ACTOR', 'detail', 'a change names who made it');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals
   where id = p_physical_terminal_id for update;
  if not found then
    return jsonb_build_object('outcome', 'ROLES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-NOT-FOUND', 'detail', 'no such physical terminal');
  end if;

  -- Roles are fixed while a code for them is live, and while a board holds the
  -- assignment those roles produced. Changing them under either would make the
  -- code, or the running terminal, mean something the operator did not see.
  if exists (
    select 1 from kitluy_devices.terminal_pairing_sessions s
     where s.physical_terminal_id = p_physical_terminal_id and s.state = 'open') then
    return jsonb_build_object('outcome', 'ROLES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-SESSION-OPEN',
      'detail', 'a pairing session is open for this terminal; cancel it before changing its roles');
  end if;
  if v_pt.bound_assignment_id is not null and exists (
    select 1 from kitluy_devices.device_assignments a
     where a.id = v_pt.bound_assignment_id and a.state in ('pending_trust', 'active')) then
    return jsonb_build_object('outcome', 'ROLES_REFUSED',
      'refusal_code', 'KLUY-PHYSTERM-BOUND',
      'detail', 'a device holds this terminal''s assignment; revoke it before changing roles');
  end if;

  select * into v_store from kitluy_core.digital_stores where id = v_pt.digital_store_id;
  select array_agg(k order by ord) into v_keys
    from unnest(coalesce(p_terminal_profile_keys, '{}'::text[])) with ordinality as u(k, ord);
  v_refusal := kitluy_devices.validate_physical_terminal_roles_v1(v_keys, v_store.primary_vertical_code);
  if v_refusal is not null then
    return jsonb_build_object('outcome', 'ROLES_REFUSED') || v_refusal;
  end if;

  v_before := kitluy_devices.physical_terminal_live_roles_v1(p_physical_terminal_id);

  update kitluy_devices.physical_terminal_roles
     set removed_at = now(), removed_by_operator_ref = p_operator_ref
   where physical_terminal_id = p_physical_terminal_id
     and removed_at is null
     and not (terminal_profile_key = any (v_keys));

  select coalesce(max(ordinal), -1) + 1 into v_ordinal
    from kitluy_devices.physical_terminal_roles
   where physical_terminal_id = p_physical_terminal_id;
  foreach v_key in array v_keys loop
    if not exists (
      select 1 from kitluy_devices.physical_terminal_roles r
       where r.physical_terminal_id = p_physical_terminal_id
         and r.terminal_profile_key = v_key and r.removed_at is null) then
      insert into kitluy_devices.physical_terminal_roles
        (physical_terminal_id, terminal_profile_key, ordinal, added_by_operator_ref)
      values (p_physical_terminal_id, v_key, v_ordinal, p_operator_ref);
      v_ordinal := v_ordinal + 1;
    end if;
  end loop;

  update kitluy_devices.physical_terminals set updated_at = now()
   where id = p_physical_terminal_id;

  perform kitluy_devices.record_physical_terminal_event_v1(
    p_physical_terminal_id, null, 'ROLES_SET', p_operator_ref,
    jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_keys)));

  return jsonb_build_object(
    'outcome', 'ROLES_SET',
    'physical_terminal_id', p_physical_terminal_id,
    'terminal_profile_keys', to_jsonb(kitluy_devices.physical_terminal_live_roles_v1(p_physical_terminal_id)));
end;
$roles$;

comment on function kitluy_devices.set_physical_terminal_roles_v1 is
  'Group 0213. Replaces the live role set of a physical terminal. Refused while a pairing session is open for it or while a device holds the assignment it produced. Removed roles are soft-removed; the change is recorded as an event with before and after.';

-- -----------------------------------------------------------------------------
-- 9. Partner doors: open and cancel a session.
-- -----------------------------------------------------------------------------
create or replace function kitluy_devices.open_terminal_pairing_session_v1(
  p_physical_terminal_id uuid,
  p_code_sha256 text,
  p_ttl_seconds integer,
  p_operator_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, kitluy_ops, extensions
as $open$
declare
  v_pt kitluy_devices.physical_terminals;
  v_store kitluy_core.digital_stores;
  v_keys text[];
  v_hub record;
  v_superseded uuid;
  v_id uuid;
  v_expires timestamptz;
begin
  if p_operator_ref is null or btrim(p_operator_ref) = '' then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-NO-ACTOR', 'detail', 'a session names who opened it');
  end if;
  if p_code_sha256 is null or lower(p_code_sha256) !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-CODE-DIGEST', 'detail', 'the code digest is not a sha256 hex string');
  end if;
  if p_ttl_seconds is null or p_ttl_seconds <= 0 or p_ttl_seconds > 900 then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-TTL', 'detail', 'a session lives between one second and fifteen minutes');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals
   where id = p_physical_terminal_id for update;
  if not found then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-TERMINAL-UNKNOWN', 'detail', 'no such physical terminal');
  end if;
  select * into v_store from kitluy_core.digital_stores where id = v_pt.digital_store_id;
  if v_store.status in ('SUSPENDED', 'CLOSED') then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-STORE-INACTIVE',
      'detail', format('that Digital Store is %s', v_store.status));
  end if;

  v_keys := kitluy_devices.physical_terminal_live_roles_v1(p_physical_terminal_id);
  if cardinality(v_keys) < 1 then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-NO-ROLES',
      'detail', 'this terminal has no roles; set at least one before pairing');
  end if;

  if v_pt.bound_assignment_id is not null and exists (
    select 1 from kitluy_devices.device_assignments a
     where a.id = v_pt.bound_assignment_id and a.state in ('pending_trust', 'active')) then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-TERMINAL-BOUND',
      'detail', 'a device already holds this terminal''s assignment; revoke it before pairing another');
  end if;

  -- The Hub precondition (owner decision v2.0.0 section 3 step 6 before step 8).
  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_pt.tenant_id, v_pt.digital_store_id, v_pt.store_location_id);
  if v_hub.device_id is null then
    return jsonb_build_object('outcome', 'OPEN_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'no active Store Hub at this Location; a terminal cannot pair before its Hub is active');
  end if;

  -- One OPEN session per seat. Opening another replaces it, and the person at
  -- the Pi must never be holding two live codes for one seat.
  for v_superseded in
    update kitluy_devices.terminal_pairing_sessions
       set state = 'revoked', revoked_reason = 'superseded'
     where physical_terminal_id = p_physical_terminal_id and state = 'open'
    returning id
  loop
    perform kitluy_devices.record_physical_terminal_event_v1(
      p_physical_terminal_id, v_superseded, 'SESSION_SUPERSEDED', p_operator_ref, '{}'::jsonb);
  end loop;

  insert into kitluy_devices.terminal_pairing_sessions
    (physical_terminal_id, tenant_id, digital_store_id, store_location_id,
     store_hub_device_id, terminal_profile_keys, environment, code_sha256,
     created_by_operator_ref, expires_at)
  values
    (p_physical_terminal_id, v_pt.tenant_id, v_pt.digital_store_id, v_pt.store_location_id,
     v_hub.device_id, v_keys, v_hub.environment, lower(p_code_sha256),
     p_operator_ref, now() + make_interval(secs => p_ttl_seconds))
  returning id, expires_at into v_id, v_expires;

  perform kitluy_devices.record_physical_terminal_event_v1(
    p_physical_terminal_id, v_id, 'SESSION_OPENED', p_operator_ref,
    jsonb_build_object('expires_at', v_expires, 'store_hub_device_id', v_hub.device_id,
                       'terminal_profile_keys', to_jsonb(v_keys)));

  return jsonb_build_object(
    'outcome', 'OPENED',
    'session_id', v_id,
    'expires_at', v_expires,
    'physical_terminal_id', p_physical_terminal_id,
    'label', v_pt.label,
    'terminal_profile_keys', to_jsonb(v_keys),
    'store_hub_device_id', v_hub.device_id,
    'store_hub_reference', v_hub.asset_tag,
    'environment', v_hub.environment);
end;
$open$;

comment on function kitluy_devices.open_terminal_pairing_session_v1 is
  'Group 0213. Opens a pairing session for ONE physical terminal, snapshotting its live roles and the active Store Hub at its Location. Refused without an active Hub, without roles, or while a device holds the seat. Supersedes any open session for the same seat so exactly one code is live. The fifteen-minute ceiling is also a row constraint. Returns the authoritative expiry so no caller computes its own.';

create or replace function kitluy_devices.cancel_terminal_pairing_session_v1(
  p_session_id uuid,
  p_operator_ref text,
  p_reason text default 'operator_cancelled'
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $cancel$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
begin
  select * into v_session from kitluy_devices.terminal_pairing_sessions
   where id = p_session_id for update;
  if not found then
    return jsonb_build_object('outcome', 'UNKNOWN', 'session_id', p_session_id);
  end if;
  if v_session.state <> 'open' then
    return jsonb_build_object('outcome', 'ALREADY_CLOSED',
      'session_id', p_session_id, 'state', v_session.state);
  end if;
  update kitluy_devices.terminal_pairing_sessions
     set state = 'revoked', revoked_reason = coalesce(nullif(btrim(p_reason), ''), 'operator_cancelled')
   where id = p_session_id;
  perform kitluy_devices.record_physical_terminal_event_v1(
    v_session.physical_terminal_id, p_session_id, 'SESSION_CANCELLED', p_operator_ref,
    jsonb_build_object('reason', p_reason));
  return jsonb_build_object('outcome', 'CANCELLED', 'session_id', p_session_id, 'state', 'revoked');
end;
$cancel$;

comment on function kitluy_devices.cancel_terminal_pairing_session_v1 is
  'Group 0213. A Partner closes an open session early. A closed session is reported as already closed, never re-closed.';

-- -----------------------------------------------------------------------------
-- 10. Device doors: present a code, then consume the match.
-- -----------------------------------------------------------------------------
-- Resolution is by CODE, because that is all the Pi knows (owner rule: the
-- installer enters only the code). Same attempt discipline as 0194: a miss is
-- answered without a counter and bounded by the transport limiter; a HIT that
-- fails on the device spends the session budget.
create or replace function kitluy_devices.evaluate_terminal_pairing_session_v1(
  p_presented_code text,
  p_device_id uuid,
  p_actor_ref text default null
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, kitluy_ops, extensions
as $eval$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
  v_pt kitluy_devices.physical_terminals;
  v_now timestamptz;
  v_normalized text;
  v_digest text;
  v_device kitluy_devices.devices;
  v_eligible boolean;
  v_reasons text[];
  v_ok boolean;
  v_hub record;
  v_tenant kitluy_core.tenants;
  v_store kitluy_core.digital_stores;
  v_location kitluy_core.store_locations;
  v_locked boolean;
begin
  if p_device_id is null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-NO-DEVICE',
      'detail', 'a presentation names the terminal that is presenting');
  end if;

  v_normalized := kitluy_devices.normalize_hub_claim_code_v1(p_presented_code);
  if length(v_normalized) <> 8
     or v_normalized !~ ('^[' || kitluy_devices.hub_claim_code_alphabet_v1() || ']{8}$') then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  v_digest := encode(extensions.digest(v_normalized, 'sha256'), 'hex');

  select * into v_session
    from kitluy_devices.terminal_pairing_sessions
   where code_sha256 = v_digest
   for update;
  if not found then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-INVALID',
      'detail', 'that pairing code is not valid');
  end if;

  if v_session.locked_at is not null then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-LOCKED',
      'detail', 'too many failed attempts; ask for a new pairing code');
  end if;
  if v_session.state <> 'open' then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-' || upper(v_session.state),
      'detail', format('that pairing code is already %s', v_session.state));
  end if;

  -- Expiry BEFORE any attempt is counted, and it costs nothing (0191 ordering).
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.terminal_pairing_sessions set state = 'expired' where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id, 'SESSION_EXPIRED', p_actor_ref, '{}'::jsonb);
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-EXPIRED',
      'detail', 'the pairing code expired; this is not a failed attempt');
  end if;

  -- The code is RIGHT. Everything from here is about the device presenting it.
  -- Factory Enrollment section 8: only an Admin-approved (enrolled) terminal
  -- that the single eligibility predicate admits may take a seat.
  select * into v_device from kitluy_devices.devices where id = p_device_id;
  v_ok := found and v_device.device_class = 'terminal' and v_device.lifecycle_state = 'enrolled';
  v_reasons := '{}';
  if v_ok then
    select el.eligible, el.reasons into v_eligible, v_reasons
      from kitluy_devices.evaluate_provisioning_eligibility_v1(p_device_id) el;
    v_ok := coalesce(v_eligible, false);
  end if;
  if not v_ok then
    v_locked := v_session.failed_attempt_count + 1 >= 5;
    update kitluy_devices.terminal_pairing_sessions
       set failed_attempt_count = least(failed_attempt_count + 1, 5),
           locked_at = case when v_locked then v_now else locked_at end,
           locked_reason = case when v_locked then 'five failed presentations' else locked_reason end,
           state = case when v_locked then 'locked' else state end
     where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id,
      case when v_locked then 'SESSION_LOCKED' else 'SESSION_FAILED_ATTEMPT' end,
      p_actor_ref,
      jsonb_build_object('device_id', p_device_id, 'reasons', to_jsonb(coalesce(v_reasons, '{}'::text[]))));
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-DEVICE-INELIGIBLE',
      'detail', 'this device cannot pair: it must be an approved, provisioning-eligible Pi Terminal');
  end if;

  -- The Hub must still be active. Not an attempt: nothing about the device.
  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id);
  if v_hub.device_id is null or v_hub.device_id <> v_session.store_hub_device_id then
    return jsonb_build_object('outcome', 'PRESENTATION_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'the Store Hub this session was opened against is no longer active');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals where id = v_session.physical_terminal_id;
  select * into v_tenant from kitluy_core.tenants where id = v_session.tenant_id;
  select * into v_store from kitluy_core.digital_stores where id = v_session.digital_store_id;
  select * into v_location from kitluy_core.store_locations where id = v_session.store_location_id;

  -- The section 7 context, every value a server row.
  return jsonb_build_object(
    'outcome', 'MATCH_READY',
    'context_version', 'kitluy.terminal-pairing-context.v1',
    'session_id', v_session.id,
    'physical_terminal_id', v_session.physical_terminal_id,
    'label', v_pt.label,
    'terminal_profile_keys', to_jsonb(v_session.terminal_profile_keys),
    'tenant_id', v_session.tenant_id,
    'tenant_reference', v_tenant.tenant_code || ' — ' || coalesce(v_tenant.display_name, v_tenant.legal_name),
    'digital_store_id', v_session.digital_store_id,
    'digital_store_reference', v_store.store_code || ' — ' || v_store.name,
    'store_location_id', v_session.store_location_id,
    'store_location_reference', v_location.location_code || ' — ' || v_location.name,
    'store_hub_device_id', v_session.store_hub_device_id,
    'store_hub_reference', v_hub.asset_tag,
    'vertical', v_store.primary_vertical_code,
    'required_app_family', null,
    'release_channel', null,
    'environment', v_session.environment,
    'detail', 'the code matches an open, unexpired session; the caller must now consume it');
end;
$eval$;

comment on function kitluy_devices.evaluate_terminal_pairing_session_v1 is
  'Group 0213. Resolves a terminal pairing session by CODE alone and returns the full assignment context (tenant, Store, Location, Hub, seat, roles, vertical) so the Pi learns everything from server rows. Consumes nothing. Expiry costs no attempt; a wrong or ineligible device spends one of five. The device must be class terminal, lifecycle enrolled, and admitted by evaluate_provisioning_eligibility_v1.';

create or replace function kitluy_devices.consume_terminal_pairing_session_v1(
  p_session_id uuid,
  p_device_id uuid,
  p_actor_ref text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_core, kitluy_ops, extensions
as $consume$
declare
  v_session kitluy_devices.terminal_pairing_sessions;
  v_pt kitluy_devices.physical_terminals;
  v_hub record;
  v_token text;
  v_payload text;
  v_assignment_id uuid;
  v_generation integer;
  v_key text;
  v_terminal_assignments jsonb := '[]'::jsonb;
  v_tid uuid;
  v_updated integer;
  v_now timestamptz;
begin
  select * into v_session from kitluy_devices.terminal_pairing_sessions
   where id = p_session_id for update;
  if not found then
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-UNKNOWN', 'detail', 'no such session');
  end if;
  if v_session.state <> 'open' then
    -- The loser of a race serialises on the row lock and finds it closed.
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-RACE-LOST',
      'detail', 'another device used that pairing code first');
  end if;
  v_now := kitluy_ops.authoritative_now_v1();
  if v_session.expires_at <= v_now then
    update kitluy_devices.terminal_pairing_sessions set state = 'expired' where id = v_session.id;
    perform kitluy_devices.record_physical_terminal_event_v1(
      v_session.physical_terminal_id, v_session.id, 'SESSION_EXPIRED', p_actor_ref, '{}'::jsonb);
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-EXPIRED', 'detail', 'the pairing code expired');
  end if;

  select * into v_hub from kitluy_devices.active_store_hub_at_scope_v1(
    v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id);
  if v_hub.device_id is null or v_hub.device_id <> v_session.store_hub_device_id then
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-HUB-INACTIVE',
      'detail', 'the Store Hub this session was opened against is no longer active');
  end if;

  select * into v_pt from kitluy_devices.physical_terminals
   where id = v_session.physical_terminal_id for update;
  if v_pt.bound_assignment_id is not null and exists (
    select 1 from kitluy_devices.device_assignments a
     where a.id = v_pt.bound_assignment_id and a.state in ('pending_trust', 'active')) then
    return jsonb_build_object('outcome', 'CONSUME_REFUSED',
      'refusal_code', 'KLUY-TERMSESSION-TERMINAL-BOUND',
      'detail', 'a device already holds this terminal''s assignment');
  end if;

  -- THE ASSIGNMENT, through the 0121 doors exactly as the Hub path does. The
  -- session digest is the claim token digest; the payload binds device + scope
  -- and is composed here from server rows. Every 0121 refusal RAISES and aborts
  -- this whole transaction: nothing here is left half done.
  v_token := v_session.code_sha256;
  v_payload := encode(extensions.digest(
    'kitluy.terminal-pairing-claim.v1' || E'\n' || p_device_id::text || E'\n'
      || v_session.tenant_id::text || E'\n' || v_session.digital_store_id::text || E'\n'
      || v_session.store_location_id::text, 'sha256'), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    p_device_id, v_session.tenant_id, v_session.digital_store_id, v_session.store_location_id,
    v_token, v_payload, 900, p_actor_ref);
  v_assignment_id := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, p_device_id, p_actor_ref);
  select assignment_generation into v_generation from kitluy_devices.devices where id = p_device_id;

  foreach v_key in array v_session.terminal_profile_keys loop
    v_tid := kitluy_devices.assign_terminal_profile_v1(
      p_device_id, v_generation, v_key, v_session.store_location_id, p_actor_ref);
    v_terminal_assignments := v_terminal_assignments
      || jsonb_build_object('terminal_assignment_id', v_tid, 'terminal_profile_key', v_key);
  end loop;

  update kitluy_devices.terminal_pairing_sessions
     set state = 'consumed', paired_device_id = p_device_id,
         paired_assignment_id = v_assignment_id, paired_at = now()
   where id = p_session_id and state = 'open';
  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'KLUY-TERMSESSION-RACE-LOST: another device used that pairing code first'
      using errcode = 'P0001';
  end if;

  update kitluy_devices.physical_terminals
     set bound_device_id = p_device_id, bound_assignment_id = v_assignment_id,
         bound_at = now(), updated_at = now()
   where id = v_session.physical_terminal_id;

  perform kitluy_devices.record_physical_terminal_event_v1(
    v_session.physical_terminal_id, p_session_id, 'SESSION_CONSUMED', p_actor_ref,
    jsonb_build_object('device_id', p_device_id, 'assignment_id', v_assignment_id));
  perform kitluy_devices.record_physical_terminal_event_v1(
    v_session.physical_terminal_id, p_session_id, 'DEVICE_BOUND', p_actor_ref,
    jsonb_build_object('device_id', p_device_id, 'assignment_id', v_assignment_id,
                       'previous_device_id', v_pt.bound_device_id));

  return jsonb_build_object(
    'outcome', 'CONSUMED',
    'session_id', p_session_id,
    'physical_terminal_id', v_session.physical_terminal_id,
    'assignment_id', v_assignment_id,
    'assignment_generation', v_generation,
    'lifecycle_state', 'awaiting_trust',
    'terminal_assignments', v_terminal_assignments,
    'environment', v_session.environment);
end;
$consume$;

comment on function kitluy_devices.consume_terminal_pairing_session_v1 is
  'Group 0213. Closes a matched session against the device that presented it and performs the assignment through the 0121 doors: claim, redeem (enrolled -> awaiting_trust), one terminal assignment per role; then marks the session consumed and binds the seat. Conditional on state = open, so two devices racing one code serialise and exactly one wins. Any 0121 refusal raises and aborts the whole transaction.';

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 11. Grants. Nothing reaches a browser role; each identity holds its own doors.
-- -----------------------------------------------------------------------------
revoke all on function kitluy_devices.refuse_physical_terminal_event_change() from public;
revoke all on function kitluy_devices.enforce_physical_terminal_integrity() from public;
revoke all on function kitluy_devices.enforce_physical_terminal_role_integrity() from public;
revoke all on function kitluy_devices.enforce_terminal_pairing_session_integrity() from public;
revoke all on function kitluy_devices.physical_terminal_live_roles_v1(uuid) from public;
revoke all on function kitluy_devices.validate_physical_terminal_roles_v1(text[], text) from public;
revoke all on function kitluy_devices.active_store_hub_at_scope_v1(uuid, uuid, uuid) from public;
revoke all on function kitluy_devices.record_physical_terminal_event_v1(uuid, uuid, text, text, jsonb) from public;

revoke all on function kitluy_devices.define_physical_terminal_v1(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function kitluy_devices.set_physical_terminal_roles_v1(uuid, text[], text) from public, anon, authenticated;
revoke all on function kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function kitluy_devices.cancel_terminal_pairing_session_v1(uuid, text, text) from public, anon, authenticated;
revoke all on function kitluy_devices.evaluate_terminal_pairing_session_v1(text, uuid, text) from public, anon, authenticated;
revoke all on function kitluy_devices.consume_terminal_pairing_session_v1(uuid, uuid, text) from public, anon, authenticated;

grant execute on function kitluy_devices.define_physical_terminal_v1(uuid, uuid, text, text[], text)
  to kitluy_terminal_issuance_service;
grant execute on function kitluy_devices.set_physical_terminal_roles_v1(uuid, text[], text)
  to kitluy_terminal_issuance_service;
grant execute on function kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text)
  to kitluy_terminal_issuance_service;
grant execute on function kitluy_devices.cancel_terminal_pairing_session_v1(uuid, text, text)
  to kitluy_terminal_issuance_service;
-- The canonical code alphabet, so the issuer generates a code the presenter
-- accepts (group 0195 precedent).
grant execute on function kitluy_devices.hub_claim_code_alphabet_v1()
  to kitluy_terminal_issuance_service;

grant execute on function kitluy_devices.evaluate_terminal_pairing_session_v1(text, uuid, text)
  to kitluy_terminal_pairing_service;
grant execute on function kitluy_devices.consume_terminal_pairing_session_v1(uuid, uuid, text)
  to kitluy_terminal_pairing_service;

-- -----------------------------------------------------------------------------
-- 12. Prove the boundary on apply.
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_count integer;
  v_table text;
  v_role text;
begin
  foreach v_role in array array['kitluy_terminal_issuance_service', 'kitluy_terminal_pairing_service'] loop
    if not exists (select 1 from pg_roles where rolname = v_role and not rolcanlogin) then
      raise exception 'KLUY-MIGRATION-0213: role % is missing or can log in', v_role
        using errcode = 'P0001';
    end if;
    if exists (
      select 1 from pg_auth_members m
       where m.member = (select oid from pg_roles where rolname = v_role)) then
      raise exception 'KLUY-MIGRATION-0213: role % must be a member of NOTHING', v_role
        using errcode = 'P0001';
    end if;
    foreach v_table in array array[
      'kitluy_devices.physical_terminals', 'kitluy_devices.physical_terminal_roles',
      'kitluy_devices.terminal_pairing_sessions', 'kitluy_devices.physical_terminal_events',
      'kitluy_devices.device_claims', 'kitluy_devices.device_assignments', 'kitluy_devices.devices'] loop
      if has_table_privilege(v_role, v_table, 'SELECT,INSERT,UPDATE,DELETE') then
        raise exception 'KLUY-MIGRATION-0213: role % holds direct table access to %', v_role, v_table
          using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- Exactly the capabilities each identity is GRANTED, nothing more. Functions
  -- that any role can execute because their ACL still admits PUBLIC are not
  -- capabilities of this identity and are excluded from the count; they are a
  -- pre-existing schema posture recorded as a follow-up, not created here.
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and has_function_privilege('kitluy_terminal_issuance_service', p.oid, 'execute')
     and not (p.proacl is null or exists (
       select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_count <> 5 then
    raise exception 'KLUY-MIGRATION-0213: the issuance identity holds % granted capability(ies); expected 5', v_count
      using errcode = 'P0001';
  end if;
  select count(*) into v_count
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and has_function_privilege('kitluy_terminal_pairing_service', p.oid, 'execute')
     and not (p.proacl is null or exists (
       select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'));
  if v_count <> 2 then
    raise exception 'KLUY-MIGRATION-0213: the pairing identity holds % granted capability(ies); expected 2', v_count
      using errcode = 'P0001';
  end if;
  -- And the five and the two are exactly the named doors.
  if not (has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.define_physical_terminal_v1(uuid, uuid, text, text[], text)', 'execute')
     and has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.set_physical_terminal_roles_v1(uuid, text[], text)', 'execute')
     and has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text)', 'execute')
     and has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.cancel_terminal_pairing_session_v1(uuid, text, text)', 'execute')
     and has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.hub_claim_code_alphabet_v1()', 'execute')
     and has_function_privilege('kitluy_terminal_pairing_service', 'kitluy_devices.evaluate_terminal_pairing_session_v1(text, uuid, text)', 'execute')
     and has_function_privilege('kitluy_terminal_pairing_service', 'kitluy_devices.consume_terminal_pairing_session_v1(uuid, uuid, text)', 'execute')) then
    raise exception 'KLUY-MIGRATION-0213: an identity is missing one of its named doors'
      using errcode = 'P0001';
  end if;

  if has_function_privilege('kitluy_terminal_issuance_service', 'kitluy_devices.consume_terminal_pairing_session_v1(uuid, uuid, text)', 'execute')
     or has_function_privilege('kitluy_terminal_pairing_service', 'kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0213: an identity holds the other side''s capability'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'kitluy_devices.evaluate_terminal_pairing_session_v1(text, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.open_terminal_pairing_session_v1(uuid, text, integer, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.define_physical_terminal_v1(uuid, uuid, text, text[], text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0213: a browser-reachable role can reach a terminal pairing door'
      using errcode = 'P0001';
  end if;

  foreach v_table in array array['physical_terminals', 'physical_terminal_roles',
                                 'terminal_pairing_sessions', 'physical_terminal_events'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'kitluy_devices' and c.relname = v_table
         and c.relrowsecurity and c.relforcerowsecurity) then
      raise exception 'KLUY-MIGRATION-0213: % is not under forced row security', v_table
        using errcode = 'P0001';
    end if;
  end loop;

  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'consume_terminal_pairing_session_v1'
       and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'KLUY-MIGRATION-0213: the consume door is not a definer owned by postgres'
      using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from kitluy_auth.role_permission_grants g
      join kitluy_auth.role_templates rt on rt.id = g.role_template_id
      join kitluy_auth.permissions p on p.id = g.permission_id
     where rt.role_key = 'DIGITAL_STORE_STAFF'
       and p.permission_key = 'fleet.terminal_pairing_code.issue'
       and g.effect = 'ALLOW') then
    raise exception 'KLUY-MIGRATION-0213: DIGITAL_STORE_STAFF does not hold the terminal pairing permission'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0213: physical terminals and terminal pairing sessions applied (one code per seat, assignment through 0121, no table reach)';
end
$guard$;

commit;
