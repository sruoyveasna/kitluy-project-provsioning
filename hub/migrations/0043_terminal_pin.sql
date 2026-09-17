-- kitluy:hub:migration:0043
-- ===========================================================================
-- KitLuy Store Hub local database -- the Terminal PIN.
--
-- Authority:
--   KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§15 (LOCKED): a 4-digit
--     Terminal PIN created twice after the application installs; the raw PIN
--     is never stored; the Store Hub is its authoritative offline verifier and
--     keeps only a strong salted verifier (Argon2id); failures are counted on
--     the Hub and survive a reboot; a governed reset invalidates the verifier.
--   KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 (owner ruling): ONE
--     shared Terminal PIN per device, PIN alone, no staff login; the device
--     credential plus the PIN unlock is the T1 operating credential; 5 failures
--     within 15 minutes lock the PIN for 15 minutes.
--
-- WHAT THIS ADDS
--   edge_identity.terminal_pin     one row per terminal that has ever set a
--                                  PIN. No row = setup required. The verifier
--                                  is an Argon2id PHC string (salt and cost
--                                  parameters travel with it). Attempt state
--                                  lives HERE, not in the terminal, so a
--                                  reboot or a GUI restart resets nothing.
--   terminal_session.credential_kind
--                                  'staff' (every existing row) or
--                                  'terminal_pin': a session opened by the
--                                  Terminal PIN, whose actor IS the terminal
--                                  device -- asserted by a CHECK, so a PIN
--                                  session can never name a person it did not
--                                  authenticate.
--
-- WHAT IT DOES NOT ADD
--   No PIN value, hash input or hint in any column; no role may remove a PIN
--   record (a reset clears the verifier and keeps the row and its history).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The Terminal PIN record.
-- ---------------------------------------------------------------------------
create table edge_identity.terminal_pin (
  terminal_device_id uuid        primary key references edge_identity.terminal_device (id),
  tenant_id          uuid        not null,
  digital_store_id   uuid        not null,
  location_id        uuid        not null,
  state              text        not null,
  verifier           text        null,
  pin_version        integer     not null default 0,
  set_at             timestamptz null,
  failed_attempts    integer     not null default 0,
  first_failed_at    timestamptz null,
  locked_until       timestamptz null,
  last_unlocked_at   timestamptz null,
  updated_at         timestamptz not null,
  constraint terminal_pin_state_ck check (state in ('set', 'reset_required')),
  -- A set PIN carries an Argon2id PHC verifier; a reset one carries none.
  constraint terminal_pin_verifier_ck check (
    (state = 'set'
       and set_at is not null
       and verifier ~ '^[$]argon2id[$]v=19[$]m=[0-9]+,t=[0-9]+,p=[0-9]+[$][A-Za-z0-9+/]+[$][A-Za-z0-9+/]+$')
    or (state = 'reset_required' and verifier is null)
  ),
  constraint terminal_pin_version_ck check (pin_version >= 0),
  constraint terminal_pin_attempts_ck check (failed_attempts >= 0),
  constraint terminal_pin_window_ck check ((failed_attempts = 0) = (first_failed_at is null))
);

comment on table edge_identity.terminal_pin is
  'The Terminal PIN (KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10-§14; KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001). One shared 4-digit PIN per terminal device. verifier is an Argon2id PHC string, never a PIN. Attempt state is Hub-side and durable: failed_attempts within the window starting first_failed_at; locked_until set when the limit is reached. No row = PIN setup required.';

create function edge_identity.refuse_terminal_pin_removal()
returns trigger
language plpgsql
as $refuse$
begin
  raise exception 'KLUY-EDGE-TERMINAL-PIN-KEPT: a Terminal PIN record is never removed; a governed reset clears its verifier'
    using errcode = 'P0001';
end;
$refuse$;

create trigger terminal_pin_never_removed
  before delete on edge_identity.terminal_pin
  for each row execute function edge_identity.refuse_terminal_pin_removal();

-- ---------------------------------------------------------------------------
-- 2. Which credential opened a terminal session.
-- ---------------------------------------------------------------------------
alter table edge_identity.terminal_session
  add column credential_kind text not null default 'staff';

alter table edge_identity.terminal_session
  add constraint terminal_session_credential_kind_ck
    check (credential_kind in ('staff', 'terminal_pin'));

alter table edge_identity.terminal_session
  add constraint terminal_session_pin_actor_ck
    check (credential_kind <> 'terminal_pin' or actor_id = terminal_device_id);

comment on column edge_identity.terminal_session.credential_kind is
  'staff: opened by a staff credential (actor = the staff member). terminal_pin: opened by the Terminal PIN on a trusted terminal (actor = the terminal device itself; KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001).';

-- ---------------------------------------------------------------------------
-- 3. Grants. Runtime reads, creates and updates; nobody removes.
-- ---------------------------------------------------------------------------
grant select, insert, update on edge_identity.terminal_pin to kitluy_hub_runtime;
grant select on edge_identity.terminal_pin to kitluy_backup;
revoke execute on function edge_identity.refuse_terminal_pin_removal() from public;

-- ---------------------------------------------------------------------------
-- 4. Self-verification.
-- ---------------------------------------------------------------------------
do $guard$
begin
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where not t.tgisinternal and c.relname = 'terminal_pin'
       and t.tgname = 'terminal_pin_never_removed'
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0043: the Terminal PIN removal guard is missing';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'edge_identity' and table_name = 'terminal_pin'
       and privilege_type in ('DELETE', 'TRUNCATE')
       and grantee not in ('postgres', 'kitluy_migrator')
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0043: a role can remove Terminal PIN records';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'edge_identity' and table_name = 'terminal_pin'
       and column_name ~ '(^pin$|plain|raw|hint)'
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0043: a column could hold a PIN value';
  end if;
  if exists (
    select 1 from edge_identity.terminal_session where credential_kind <> 'staff'
  ) then
    raise exception 'KLUY-HUB-MIGRATION-0043: existing sessions were not classified as staff';
  end if;
  raise notice 'KLUY-HUB-MIGRATION-0043: Terminal PIN installed (verifier + durable attempt state, PIN sessions bound to their terminal)';
end $guard$;
