-- kitluy:group:0229
-- ============================================================================
-- 0229  A Pi Terminal reports its runtime: the Hub link, the POS release, and
--       whether the POS is operational — signed by its own identity key
-- ============================================================================
-- Additive. Groups 0120-0228 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner mission T1-STORE-OPERATIONS-001 (2026-09-17) §15-§17 —
--   "terminal-edge -> authoritative local Hub-connection state -> health/runtime
--    reporter -> cloud device status -> Management API -> Partner Portal";
--   "The Partner Portal should consume reported facts, not infer them from later
--    states."
--
-- ===========================================================================
-- WHY THIS IS NOT GROUP 0177, AND WHAT IT DOES NOT REPLACE
-- ===========================================================================
-- Group 0177's `device_health_reports` is the CANONICAL fleet health contract:
-- a Hub-originated observation (`reporting_hub_device_id`, a kh1 effect key, a
-- Hub report sequence) of a terminal it serves. That is the right long-term
-- authority for "this terminal is connected to its Store Hub". Its Hub->cloud
-- transport is BLK-006 and is not built, so nothing reaches that table from a
-- real Store today.
--
-- This group is the DEVICE-ATTESTED runtime status: what the Terminal itself
-- observes about its own link, its installed POS release and the POS runtime.
-- It is a different fact with a different source, labelled as such all the way
-- to the Partner Portal ("device-reported"). It does not write 0177's tables and
-- does not pretend to be a Hub observation. When BLK-006 lands, the Hub's
-- observation becomes the authority for connection and this stays the witness
-- for the application runtime (register entry
-- KLREC-2026-09-17-DEVICE-RUNTIME-STATUS-INTERIM-001).
--
-- ===========================================================================
-- WHO MAY WRITE A DEVICE'S STATUS
-- ===========================================================================
-- Only the holder of the device identity key of the device's CURRENT SEALED
-- enrollment — the predicate group 0224 uses for re-flash recovery. The route
-- verifies the Ed25519 signature over the report bytes; this door refuses unless
-- that key's SPKI fingerprint is the one the cloud enrolled. A board re-flashed
-- with a new key reports only after its new enrollment is sealed.
--
-- REPLAY. `report_sequence` is device-issued and must ADVANCE while the key is
-- unchanged. The device derives it from max(last + 1, epoch milliseconds), so a
-- wiped per-slot /var does not stall it; a NEW key (a new enrollment) may start
-- again. An older or equal sequence under the same key changes nothing.
--
-- FRESHNESS is the CLOUD's receipt time, never the device's claim:
-- `device_runtime_status_read.report_age_seconds` is computed at read time.
--
-- MC: MUT (one row per device, through the door only; kitluy_fleet_governor).
-- ============================================================================

begin;

-- Borrow `kitluy_fleet_governor` only if this session cannot already SET ROLE to it, and
-- remember whether it did. "Member" is not "may SET ROLE": on PostgreSQL 16+ the
-- platform's own grant carries SET = false (seen on kitluy-repo17, 2026-09-17),
-- while on 15 a plain membership is enough and development tools rely on it
-- staying in place. So the ability is PROBED, and only a grant made here is
-- handed back.
create temporary table if not exists kitluy_0229_borrow (granted boolean) on commit drop;

do $borrow$
declare
  v_can_set boolean;
begin
  begin
    execute 'set local role kitluy_fleet_governor';
    execute 'reset role';
    v_can_set := true;
  exception when insufficient_privilege then
    v_can_set := false;
  end;
  if not v_can_set then
    execute format('grant kitluy_fleet_governor to %I', current_user);
  end if;
  insert into kitluy_0229_borrow values (not v_can_set);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. The narrow identity the registry route runs as.
-- ---------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_device_runtime_service') then
    create role kitluy_device_runtime_service nologin;
  end if;
end
$role$;

comment on role kitluy_device_runtime_service is
  'Group 0229. The identity of POST /v1/device-runtime/report: EXACTLY record_device_runtime_report_v1, and no table privilege. The route is authenticated by a device identity signature, not a session, so it must never run as service_role (BYPASSRLS).';

do $grant_role$
begin
  execute 'grant kitluy_device_runtime_service to service_role';
end
$grant_role$;

grant usage on schema kitluy_devices to kitluy_device_runtime_service;

-- ---------------------------------------------------------------------------
-- 2. The projection: one row per device, door-only, forward-only.
-- ---------------------------------------------------------------------------
create table if not exists kitluy_devices.device_runtime_status (
  device_id uuid primary key references kitluy_devices.devices (id),
  report_sequence bigint not null,
  identity_key_fingerprint text not null,
  device_observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  report jsonb not null,
  updated_at timestamptz not null default now(),
  constraint drs_sequence_chk check (report_sequence >= 1),
  constraint drs_fingerprint_chk check (identity_key_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint drs_report_object_chk check (jsonb_typeof(report) = 'object'),
  constraint drs_report_schema_chk
    check (report ->> 'schema' = 'kitluy.device-runtime-report.v1'),
  constraint drs_report_bounded_chk check (pg_column_size(report) <= 8192)
);

comment on table kitluy_devices.device_runtime_status is
  'Group 0229 (T1-STORE-OPERATIONS-001). The DEVICE-ATTESTED runtime status of each Pi Terminal: its Store Hub link phase, its installed and running POS release, and the POS runtime state. Written only by record_device_runtime_report_v1 after the route verified a signature by the device identity key of the current sealed enrollment. Not a Hub observation (that is group 0177, blocked on BLK-006). Freshness is received_at, read through device_runtime_status_read. MC: MUT (door only).';

alter table kitluy_devices.device_runtime_status owner to kitluy_fleet_governor;
alter table kitluy_devices.device_runtime_status enable row level security;
revoke all on kitluy_devices.device_runtime_status from public;

create or replace function kitluy_devices.enforce_device_runtime_status_governed()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'KLUY-RUNTIME-STATUS-IMMUTABLE: a runtime status is superseded, never deleted'
      using errcode = 'P0001';
  end if;
  if current_user <> 'kitluy_fleet_governor' then
    raise exception 'KLUY-RUNTIME-STATUS-GOVERNED: runtime status changes only through record_device_runtime_report_v1 (group 0229)'
      using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE'
     and new.identity_key_fingerprint = old.identity_key_fingerprint
     and new.report_sequence <= old.report_sequence then
    raise exception 'KLUY-RUNTIME-STATUS-BACKWARDS: sequence % does not advance % under the same key',
      new.report_sequence, old.report_sequence
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function kitluy_devices.enforce_device_runtime_status_governed() from public;
alter function kitluy_devices.enforce_device_runtime_status_governed() owner to kitluy_fleet_governor;

-- Created once, guarded by existence rather than removed and recreated: the
-- migration validator treats any removal after a table alteration as
-- destructive, and there is nothing here to remove.
do $trigger$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'trg_device_runtime_status_governed'
       and tgrelid = 'kitluy_devices.device_runtime_status'::regclass
  ) then
    create trigger trg_device_runtime_status_governed
      before insert or update or delete on kitluy_devices.device_runtime_status
      for each row execute function kitluy_devices.enforce_device_runtime_status_governed();
  end if;
end
$trigger$;

-- ---------------------------------------------------------------------------
-- 3. The door.
-- ---------------------------------------------------------------------------
set local role kitluy_fleet_governor;

create or replace function kitluy_devices.record_device_runtime_report_v1(
  p_device_id uuid,
  p_identity_key_fingerprint text,
  p_report_sequence bigint,
  p_device_observed_at timestamptz,
  p_report jsonb
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $door$
declare
  v_device record;
  v_fingerprint text;
  v_existing record;
begin
  if p_device_id is null or p_identity_key_fingerprint is null or p_report_sequence is null
     or p_device_observed_at is null or p_report is null then
    raise exception 'KLUY-RUNTIME-REPORT-INVALID: every argument is required'
      using errcode = 'P0001';
  end if;

  select d.id, d.device_class::text as device_class, d.lifecycle_state::text as lifecycle,
         e.state as enrollment_state, e.revoked_at as enrollment_revoked_at,
         e.device_public_key_fingerprint
    into v_device
    from kitluy_devices.devices d
    left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = p_device_id;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_UNKNOWN');
  end if;
  if v_device.lifecycle in ('retired', 'replaced') then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_RETIRED');
  end if;
  if v_device.device_class <> 'terminal' then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'NOT_A_TERMINAL');
  end if;

  -- The group 0224 predicate: the CURRENT, SEALED enrollment holds the key.
  v_fingerprint := lower(p_identity_key_fingerprint);
  if v_device.enrollment_state is distinct from 'sealed'
     or v_device.enrollment_revoked_at is not null
     or v_device.device_public_key_fingerprint is distinct from v_fingerprint then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'IDENTITY_MISMATCH');
  end if;

  if jsonb_typeof(p_report) <> 'object'
     or p_report ->> 'schema' is distinct from 'kitluy.device-runtime-report.v1'
     or pg_column_size(p_report) > 8192 then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'REPORT_INVALID');
  end if;

  select report_sequence, identity_key_fingerprint into v_existing
    from kitluy_devices.device_runtime_status
   where device_id = p_device_id
   for update;
  if found
     and v_existing.identity_key_fingerprint = v_fingerprint
     and p_report_sequence <= v_existing.report_sequence then
    -- A replay, or a duplicate: nothing changes and nothing errors.
    return jsonb_build_object('outcome', 'STALE', 'storedSequence', v_existing.report_sequence);
  end if;

  insert into kitluy_devices.device_runtime_status as s
    (device_id, report_sequence, identity_key_fingerprint, device_observed_at, received_at,
     report, updated_at)
  values
    (p_device_id, p_report_sequence, v_fingerprint, p_device_observed_at, now(), p_report, now())
  on conflict (device_id) do update
     set report_sequence = excluded.report_sequence,
         identity_key_fingerprint = excluded.identity_key_fingerprint,
         device_observed_at = excluded.device_observed_at,
         received_at = excluded.received_at,
         report = excluded.report,
         updated_at = excluded.updated_at;

  return jsonb_build_object('outcome', 'ACCEPTED', 'sequence', p_report_sequence);
end
$door$;

comment on function kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb) is
  'Group 0229. Record a Pi Terminal''s DEVICE-ATTESTED runtime report. The caller (POST /v1/device-runtime/report) has verified an Ed25519 signature over the report bytes by the presented identity key; this door refuses unless that key''s SPKI fingerprint is the current sealed enrollment''s (group 0224 predicate), the device is a live terminal, and the report is the v1 shape. Forward-only per key: an older or equal sequence is STALE and writes nothing. Executable by kitluy_device_runtime_service only.';

revoke all on function kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb) from public;
grant execute on function kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb)
  to kitluy_device_runtime_service;

reset role;

-- ---------------------------------------------------------------------------
-- 4. The read: the report and its age by the CLOUD's clock.
-- ---------------------------------------------------------------------------
create or replace view kitluy_devices.device_runtime_status_read as
  select s.device_id,
         s.report_sequence,
         s.received_at,
         greatest(0, extract(epoch from (now() - s.received_at)))::bigint as report_age_seconds,
         s.device_observed_at,
         s.report
    from kitluy_devices.device_runtime_status s;

comment on view kitluy_devices.device_runtime_status_read is
  'Group 0229. Device-attested runtime status with report_age_seconds computed at READ time from the cloud''s receipt instant. The identity key fingerprint is not exposed. Read by the Management API after it has authorized the caller for the Store.';

alter view kitluy_devices.device_runtime_status_read owner to kitluy_fleet_governor;
revoke all on kitluy_devices.device_runtime_status_read from public;
grant select on kitluy_devices.device_runtime_status_read to service_role;

-- ---------------------------------------------------------------------------
-- 5. Assertions.
-- ---------------------------------------------------------------------------
do $assert_0229$
declare
  v_findings text[] := '{}';
  v_door oid := 'kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb)'::regprocedure;
  v_role oid := (select oid from pg_roles where rolname = 'kitluy_device_runtime_service');
  v_grantees text[];
begin
  if not (select prosecdef from pg_proc where oid = v_door) then
    v_findings := v_findings || 'the runtime door must be SECURITY DEFINER';
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_door)) <> 'kitluy_fleet_governor' then
    v_findings := v_findings || 'the runtime door must be owned by kitluy_fleet_governor';
  end if;

  select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end), '{}')
    into v_grantees
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = v_door and a.privilege_type = 'EXECUTE'
     and a.grantee <> p.proowner;
  if v_grantees <> array['kitluy_device_runtime_service'] then
    v_findings := v_findings || format('the runtime door is executable by %s, not the runtime service alone', v_grantees);
  end if;

  if (select count(*) from pg_proc p, aclexplode(p.proacl) acl
       where acl.grantee = v_role and acl.privilege_type = 'EXECUTE') <> 1 then
    v_findings := v_findings || 'the runtime service must hold EXACTLY one EXECUTE grant';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where grantee = 'kitluy_device_runtime_service') then
    v_findings := v_findings || 'the runtime service must hold no table privilege';
  end if;

  -- An unknown device is refused quietly, and writes nothing.
  set local role kitluy_device_runtime_service;
  if kitluy_devices.record_device_runtime_report_v1(
       gen_random_uuid(), repeat('a', 64), 1, now(),
       '{"schema":"kitluy.device-runtime-report.v1"}'::jsonb) ->> 'code' <> 'DEVICE_UNKNOWN' then
    v_findings := v_findings || 'an unknown device must be refused DEVICE_UNKNOWN';
  end if;
  reset role;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0229: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0229: device runtime status is written by its own identity key through one door, and read with a cloud-clock age';
end
$assert_0229$;

do $hand_back$
begin
  if (select granted from kitluy_0229_borrow) then
    execute format('revoke kitluy_fleet_governor from %I', current_user);
  end if;
end
$hand_back$;

commit;
