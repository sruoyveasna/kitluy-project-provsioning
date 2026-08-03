-- kitluy:group:0162
-- Migration group 0162: terminal_provisioning_codes.
--
-- Authority: WS-11-T004-P02A (package contract);
-- kitluy-device-discovery-and-pairing-protocol-v1.0.0 §6.1 (the provisioning
-- code contract); WS-11 task dependency order step 6 (Terminal T1-T4
-- assignment, 000_ACTIVE_PHASE §10).
--
-- ===========================================================================
-- WHAT THIS GROUP IS — AND IS NOT
-- ===========================================================================
-- This group is the SCHEMA foundation for terminal provisioning codes and
-- their append-only lifecycle events: neutral relational storage, scope
-- integrity, one-way state machine, hash-only code storage, TTL, attempts and
-- lockout storage, single-use invariants, indexes, ownership, RLS posture and
-- default-deny grants.
--
-- It is NOT the code lifecycle. Issuing, redeeming, revoking, the lockout
-- transition, the security event producer, the active-Hub gate evaluation and
-- proof-of-possession checks are governed behaviors owned by P02B. No
-- issue/redeem/revoke function exists after this group, and no runtime role
-- can touch these tables until those doors arrive — which is the point: a
-- capability that does not exist cannot be exercised badly.
--
-- Naming: the data dictionary calls this `provisioning_sessions`; the
-- repository name is `device_provisioning_codes`, and it is deliberately NOT
-- `device_claims` — the Hub claim keeps its own semantics (assignment
-- bootstrap), while a provisioning code binds a TERMINAL assignment and an
-- intended profile. Neutral Core throughout: no Laundry workflow terms; the
-- profile-key shape `<vertical>.t<n>.<role>` is validated exactly the way
-- `device_terminal_assignments` already validates it.
--
-- ===========================================================================
-- kitluy:destructive-approved:WS-11-T004-P02A -- no DROP/TRUNCATE/DELETE in
-- this group; the marker is present so the destructive-guard never reads a
-- future edit of this file as unmarked history.
-- ===========================================================================

-- Ownership borrow, same as groups 0125-0161: the applying role is not a
-- member of the NOLOGIN definer owner, so `alter table ... owner to` would
-- fail `42501 must be member of role`. It is handed back at the end of this
-- file; the applying role keeps no privilege the owner did not already have.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. STATE
-- ---------------------------------------------------------------------------
-- The minimum set the governed lifecycle needs. Terminal states are
-- REDEEMED, LOCKED, EXPIRED and REVOKED; ISSUED is the only live one.
create type kitluy_devices.provisioning_code_state as enum (
  'issued',
  'redeemed',
  'locked',
  'expired',
  'revoked'
);

-- ---------------------------------------------------------------------------
-- 2. THE TABLE
-- ---------------------------------------------------------------------------
create table kitluy_devices.device_provisioning_codes (
  id uuid primary key default gen_random_uuid(),

  -- Relational scope. Never JSON; never optional. A code that names no exact
  -- scope does not exist.
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  -- The assigned Store Hub the terminal will pair with. P02B enforces the
  -- ordering rule (no terminal before its Hub is active) AGAINST this row;
  -- the schema stores the reference, it does not duplicate Hub state.
  store_hub_device_id uuid not null references kitluy_devices.devices (id),
  -- The terminal this code was issued for.
  terminal_device_id uuid not null references kitluy_devices.devices (id),
  -- The authoritative assignment and the intended profile. The installer can
  -- never choose either: they come from the assignment, not the presenter.
  terminal_assignment_id uuid not null
    references kitluy_devices.device_terminal_assignments (id),
  terminal_profile_key text not null,
  environment text not null,

  -- Hash-only code storage. A 64-hex sha-256 digest of the code; the raw
  -- code never touches this database, and no column can hold it. The
  -- algorithm is named so a future keyed digest is a data change, not a
  -- schema change; no key version exists today because no keyed hashing is
  -- planned (WS-11-T004-P01 §10).
  code_digest char(64) not null,
  digest_algorithm text not null default 'sha256',
  -- Binds the digest to the exact device, assignment, profile set and expiry
  -- it was issued for, so a captured digest cannot be replayed against a
  -- scope it was not minted with (claim pattern, group 0121).
  payload_sha256 char(64) not null,

  state kitluy_devices.provisioning_code_state not null default 'issued',

  -- Attempts and lockout STORAGE (transitions belong to P02B).
  failed_attempt_count integer not null default 0,
  locked_at timestamptz,
  locked_reason text,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,

  issued_by_operator_ref text not null,
  correlation_id uuid not null,

  constraint device_provisioning_codes_digest_format_chk
    check (code_digest ~ '^[0-9a-f]{64}$'),
  constraint device_provisioning_codes_algorithm_chk
    check (digest_algorithm = 'sha256'),
  constraint device_provisioning_codes_payload_format_chk
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint device_provisioning_codes_profile_shape_chk
    check (terminal_profile_key ~ '^[a-z0-9_]+\.t[1-9][0-9]*\.[a-z0-9_]+$'),
  -- §6.1: codes live at most 15 minutes, and the expiry is fixed at issue.
  constraint device_provisioning_codes_ttl_chk
    check (expires_at > created_at
           and expires_at <= created_at + interval '15 minutes'),
  constraint device_provisioning_codes_attempts_chk
    check (failed_attempt_count between 0 and 5),
  -- Terminal-state consistency: evidence is required exactly when the state
  -- says it happened.
  constraint device_provisioning_codes_locked_chk
    check ((state = 'locked') = (locked_at is not null)
           and (state <> 'locked' or locked_reason is not null)),
  constraint device_provisioning_codes_redeemed_chk
    check ((state = 'redeemed') = (redeemed_at is not null)),
  constraint device_provisioning_codes_revoked_chk
    check ((state = 'revoked') = (revoked_at is not null)
           and (state <> 'revoked' or revocation_reason is not null)),
  -- The digest namespace is GLOBAL: one digest identifies exactly one row,
  -- which is what redemption lookup means. The payload binding (above) is
  -- what stops a captured digest being useful anywhere but its own scope.
  constraint device_provisioning_codes_digest_unique unique (code_digest)
);

comment on table kitluy_devices.device_provisioning_codes is
  'Owner: Fleet. Terminal provisioning codes (pairing protocol §6.1; DD provisioning_sessions). Hash-only storage: the raw code never touches this database. Scope, assignment, Hub reference and intended profile are relational and fixed at issue; state is a one-way machine (issued -> redeemed|locked|expired|revoked); TTL is capped at 15 minutes; failed attempts are capped at five. Governed issue/redeem/lockout doors arrive with P02B — until then no runtime role can touch this table at all. MC: MUT (state machine only).';

alter table kitluy_devices.device_provisioning_codes
  owner to kitluy_activation_governor;

-- One OUTSTANDING code per terminal assignment. Re-issuing is legitimate —
-- but only after the previous code has closed (redeemed, expired, revoked or
-- locked), which is exactly what makes concurrent issuance a constraint
-- violation rather than a race (the device_claims pattern).
create unique index device_provisioning_codes_one_outstanding_idx
  on kitluy_devices.device_provisioning_codes (terminal_assignment_id)
  where state = 'issued';

-- Redemption lookup: digest is unique already (the constraint); scope and
-- expiry scans get their own shapes.
create index device_provisioning_codes_assignment_idx
  on kitluy_devices.device_provisioning_codes (terminal_assignment_id, state, expires_at);
-- The expiry sweeper P02B introduces scans live codes by their deadline.
create index device_provisioning_codes_expiry_idx
  on kitluy_devices.device_provisioning_codes (expires_at)
  where state = 'issued';
-- Hub-scoped lookup: every code a Hub should expect, in one shape.
create index device_provisioning_codes_hub_idx
  on kitluy_devices.device_provisioning_codes (store_hub_device_id, state);
-- Scope-isolation lookups.
create index device_provisioning_codes_scope_idx
  on kitluy_devices.device_provisioning_codes
  (tenant_id, digital_store_id, store_location_id, environment, state);

-- ---------------------------------------------------------------------------
-- 3. SCOPE CONSISTENCY AND THE ONE-WAY STATE MACHINE
-- ---------------------------------------------------------------------------
create or replace function kitluy_devices.enforce_provisioning_code_integrity()
returns trigger
language plpgsql
as $$
declare
  v_assignment kitluy_devices.device_terminal_assignments;
  v_hub_assignment kitluy_devices.device_assignments;
begin
  if tg_op = 'INSERT' then
    -- The terminal assignment must name the SAME device, location and
    -- profile the code row carries, and the Hub reference must be the device
    -- the assignment binds. Anything else is a fabricated scope.
    select * into v_assignment
      from kitluy_devices.device_terminal_assignments
     where id = new.terminal_assignment_id;
    if not found then
      raise exception 'KLUY-PROVCODE-ASSIGNMENT-MISSING: terminal assignment % does not exist',
        new.terminal_assignment_id using errcode = 'P0001';
    end if;
    if v_assignment.device_id is distinct from new.terminal_device_id
       or v_assignment.store_location_id is distinct from new.store_location_id
       or v_assignment.terminal_profile_key is distinct from new.terminal_profile_key then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the code names a device, location or profile its assignment does not'
        using errcode = 'P0001';
    end if;
    -- The Hub reference must be a device assigned to the SAME Tenant, Store
    -- and Location. (The terminal assignment references the TERMINAL'S own
    -- assignment; the Hub relationship in this data model is the Hub device's
    -- assignment to the same scope. The ordering rule — Hub must be ACTIVE —
    -- is P02B's check against that assignment's state, not the schema's.)
    select * into v_hub_assignment
      from kitluy_devices.device_assignments
     where device_id = new.store_hub_device_id
       and tenant_id = new.tenant_id
       and digital_store_id = new.digital_store_id
       and store_location_id = new.store_location_id
       and state in ('pending_trust', 'active')
     limit 1;
    if not found then
      raise exception
        'KLUY-PROVCODE-SCOPE-INCONSISTENT: the named Hub has no assignment to the code''s Tenant/Store/Location'
        using errcode = 'P0001';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception 'KLUY-PROVCODE-IMMUTABLE: a provisioning code is never deleted; its outcome is recorded'
      using errcode = 'P0001';
  end if;

  -- Scope, digest, payload and expiry are fixed at issue (claim pattern).
  if new.tenant_id is distinct from old.tenant_id
     or new.digital_store_id is distinct from old.digital_store_id
     or new.store_location_id is distinct from old.store_location_id
     or new.store_hub_device_id is distinct from old.store_hub_device_id
     or new.terminal_device_id is distinct from old.terminal_device_id
     or new.terminal_assignment_id is distinct from old.terminal_assignment_id
     or new.terminal_profile_key is distinct from old.terminal_profile_key
     or new.environment is distinct from old.environment
     or new.code_digest is distinct from old.code_digest
     or new.digest_algorithm is distinct from old.digest_algorithm
     or new.payload_sha256 is distinct from old.payload_sha256
     or new.expires_at is distinct from old.expires_at then
    raise exception
      'KLUY-PROVCODE-IMMUTABLE: scope, digest, payload and expiry are fixed at issue; only the state may close'
      using errcode = 'P0001';
  end if;

  -- One-way machine: ISSUED is the only live state; nothing closed reopens.
  if old.state <> 'issued' and new.state is distinct from old.state then
    raise exception 'KLUY-PROVCODE-CLOSED: provisioning code % is already %',
      old.id, old.state using errcode = 'P0001';
  end if;

  -- Attempt evidence is monotonic: it may increase, never decrease.
  if new.failed_attempt_count < old.failed_attempt_count then
    raise exception
      'KLUY-PROVCODE-ATTEMPTS-NOT-MONOTONIC: failed_attempt_count may not decrease (% -> %)',
      old.failed_attempt_count, new.failed_attempt_count
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create trigger trg_device_provisioning_codes_integrity
  before insert or update or delete on kitluy_devices.device_provisioning_codes
  for each row execute function kitluy_devices.enforce_provisioning_code_integrity();

revoke all on function kitluy_devices.enforce_provisioning_code_integrity() from public;

-- ---------------------------------------------------------------------------
-- 4. APPEND-ONLY LIFECYCLE EVENTS
-- ---------------------------------------------------------------------------
create table kitluy_devices.device_provisioning_code_events (
  id uuid primary key default gen_random_uuid(),
  provisioning_code_id uuid not null
    references kitluy_devices.device_provisioning_codes (id),
  tenant_id uuid not null references kitluy_core.tenants (id),
  digital_store_id uuid not null references kitluy_core.digital_stores (id),
  store_location_id uuid not null references kitluy_core.store_locations (id),
  environment text not null,
  event_type text not null,
  actor_type text not null,
  actor_ref text,
  reason_code text,
  correlation_id uuid,
  -- Non-authoritative context only. NEVER a raw code, never authoritative
  -- state — the code row is the state.
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),

  constraint device_provisioning_code_events_type_chk
    check (event_type in (
      'CREATED', 'PRESENTED', 'FAILED_ATTEMPT', 'LOCKED',
      'REDEEMED', 'EXPIRED', 'REVOKED', 'RECONCILIATION_REQUIRED')),
  constraint device_provisioning_code_events_actor_chk
    check (actor_type in ('OPERATOR', 'TERMINAL', 'SYSTEM', 'WORKER'))
);

comment on table kitluy_devices.device_provisioning_code_events is
  'Owner: Fleet. Append-only lifecycle events for terminal provisioning codes. Scope columns are authoritative for isolation; detail is non-authoritative context and may never contain a raw code. MC: A/O.';

alter table kitluy_devices.device_provisioning_code_events
  owner to kitluy_activation_governor;

create index device_provisioning_code_events_code_idx
  on kitluy_devices.device_provisioning_code_events (provisioning_code_id, occurred_at desc);
create index device_provisioning_code_events_scope_idx
  on kitluy_devices.device_provisioning_code_events
  (tenant_id, digital_store_id, store_location_id, environment, occurred_at desc);

create or replace function kitluy_devices.enforce_provisioning_code_events_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'KLUY-PROVCODE-EVENT-IMMUTABLE: provisioning-code events are append-only'
    using errcode = 'P0001';
end;
$$;

create trigger trg_device_provisioning_code_events_append_only
  before update or delete on kitluy_devices.device_provisioning_code_events
  for each row execute function kitluy_devices.enforce_provisioning_code_events_append_only();

revoke all on function kitluy_devices.enforce_provisioning_code_events_append_only() from public;

-- Trigger functions are governed objects too: NOLOGIN owner, like the tables.
alter function kitluy_devices.enforce_provisioning_code_integrity()
  owner to kitluy_activation_governor;
alter function kitluy_devices.enforce_provisioning_code_events_append_only()
  owner to kitluy_activation_governor;

-- ---------------------------------------------------------------------------
-- 5. RLS POSTURE AND DEFAULT-DENY GRANTS
-- ---------------------------------------------------------------------------
-- Deny-by-absence: no policies, no grants. The governed doors P02B adds will
-- be the only path in, and they are SECURITY DEFINER — nobody needs a table
-- privilege for them.
alter table kitluy_devices.device_provisioning_codes enable row level security;
alter table kitluy_devices.device_provisioning_codes force row level security;
alter table kitluy_devices.device_provisioning_code_events enable row level security;
alter table kitluy_devices.device_provisioning_code_events force row level security;

revoke all on table kitluy_devices.device_provisioning_codes from public;
revoke all on table kitluy_devices.device_provisioning_code_events from public;

-- ---------------------------------------------------------------------------
-- 6. HAND THE MEMBERSHIP BACK
-- ---------------------------------------------------------------------------
do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- ---------------------------------------------------------------------------
-- 7. PROVE THE CONTRACT ON APPLY
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_bad text[];
  v_owner text;
begin
  -- Tables exist, owned by the NOLOGIN authority.
  select string_agg(t, ', ') into v_bad
    from (values ('device_provisioning_codes'), ('device_provisioning_code_events')) as x(t)
   where not exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kitluy_devices' and c.relname = x.t and c.relkind = 'r');
  if v_bad is not null then
    raise exception 'KLUY-MIGRATION-0162: missing tables: %', v_bad using errcode = 'P0001';
  end if;

  select pg_get_userbyid(c.relowner) into v_owner
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'kitluy_devices' and c.relname = 'device_provisioning_codes';
  if v_owner is distinct from 'kitluy_activation_governor'
     or (select rolcanlogin from pg_roles where rolname = v_owner) then
    raise exception
      'KLUY-MIGRATION-0162: device_provisioning_codes owner is % (LOGIN=%s), not the NOLOGIN governor',
      v_owner, (select rolcanlogin from pg_roles where rolname = v_owner)
      using errcode = 'P0001';
  end if;

  -- RLS ENABLE+FORCE on both.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'KLUY-MIGRATION-0162: RLS is not ENABLE+FORCE on both tables'
      using errcode = 'P0001';
  end if;

  -- No PUBLIC/anon/authenticated privileges on either table.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('device_provisioning_codes', 'device_provisioning_code_events')
       and (has_table_privilege('public', c.oid, 'SELECT')
         or has_table_privilege('anon', c.oid, 'SELECT')
         or has_table_privilege('authenticated', c.oid, 'SELECT')
         or has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE'))) then
    raise exception
      'KLUY-MIGRATION-0162: PUBLIC/anon/authenticated hold privileges on provisioning-code tables'
      using errcode = 'P0001';
  end if;

  -- The TTL cap, the attempt cap and the one-outstanding index exist.
  if not exists (select 1 from pg_constraint where conrelid = 'kitluy_devices.device_provisioning_codes'::regclass and conname = 'device_provisioning_codes_ttl_chk')
     or not exists (select 1 from pg_constraint where conrelid = 'kitluy_devices.device_provisioning_codes'::regclass and conname = 'device_provisioning_codes_attempts_chk')
     or not exists (select 1 from pg_index where indrelid = 'kitluy_devices.device_provisioning_codes'::regclass and indexrelid = 'kitluy_devices.device_provisioning_codes_one_outstanding_idx'::regclass) then
    raise exception 'KLUY-MIGRATION-0162: TTL cap, attempt cap or one-outstanding index missing'
      using errcode = 'P0001';
  end if;

  -- No raw-code column exists anywhere on the table.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'kitluy_devices' and table_name = 'device_provisioning_codes'
       and (column_name ~ '(^|_)(code|raw|plain|secret)(_|$)' and column_name not in ('code_digest'))) then
    raise exception
      'KLUY-MIGRATION-0162: a column that could hold a raw code exists'
      using errcode = 'P0001';
  end if;

  raise notice
    'KLUY-MIGRATION-0162: terminal provisioning-code schema foundation applied; doors arrive with P02B';
end
$guard$;
