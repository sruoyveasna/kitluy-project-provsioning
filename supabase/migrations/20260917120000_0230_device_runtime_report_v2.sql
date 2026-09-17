-- kitluy:group:0230
-- ============================================================================
-- 0230  The device runtime report v2: the Store Hub's Terminal PIN answer
-- ============================================================================
-- Additive. Groups 0120-0229 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: KLD-2026-09-03-TERMINAL-PROVISIONING-001 §10 (LOCKED) — "The
--   Terminal must not become fully operational until this required PIN setup
--   succeeds"; KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 (owner ruling)
--   and the owner mission TERMINAL-PIN-AND-REAL-POS-AUTH-001 §11 — "PIN set"
--   must be a REAL reported fact with its own evidence, never derived from the
--   application running.
--
-- WHAT CHANGES
--   `kitluy.device-runtime-report.v2` adds `hubLink.terminalPin` — the Terminal
--   PIN state the Store Hub answered terminal-edge (set, setup required, reset
--   required, locked until; never a PIN, never a verifier) — and renames
--   `pos.staffSignedIn` to `pos.terminalUnlocked`. Field-level validation lives
--   in `@kitluy/device-identity` `parseDeviceRuntimeReport`, which the route runs
--   before this door; the database checks only the declared kind, as 0229 did.
--
--   The table's kind CHECK and the door's kind test are widened to v1 OR v2:
--   terminals already in the field keep reporting v1 and keep being accepted.
--   Nothing about WHO may write changes — the same identity-key predicate, the
--   same forward-only sequence, the same one door.
--
-- The CHECK is replaced, not edited in place, which the validator's DROP guard
-- flags; it is a strict superset replaced in the same transaction (the group
-- 0191 pattern). No row is touched.
-- kitluy:destructive-approved:KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001 -- constraint widening only; no DROP TABLE/COLUMN, TRUNCATE or DELETE
--
-- MC: MUT (door only; kitluy_fleet_governor).
-- ============================================================================

begin;

-- The 0229 borrow: probe the SET ROLE ability, grant only if needed, hand back
-- only what was granted here.
create temporary table if not exists kitluy_0230_borrow (granted boolean) on commit drop;

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
  insert into kitluy_0230_borrow values (not v_can_set);
end
$borrow$;

set local role kitluy_fleet_governor;

-- ---------------------------------------------------------------------------
-- 1. The table accepts either kind.
-- ---------------------------------------------------------------------------
alter table kitluy_devices.device_runtime_status
  drop constraint if exists drs_report_schema_chk;
alter table kitluy_devices.device_runtime_status
  add constraint drs_report_schema_chk
    check (report ->> 'schema' in ('kitluy.device-runtime-report.v1',
                                    'kitluy.device-runtime-report.v2'));

-- ---------------------------------------------------------------------------
-- 2. The door: identical to 0229 but for the kind test.
-- ---------------------------------------------------------------------------
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
     or coalesce(p_report ->> 'schema', '') not in ('kitluy.device-runtime-report.v1',
                                                    'kitluy.device-runtime-report.v2')
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
  'Groups 0229/0230. Record a Pi Terminal''s DEVICE-ATTESTED runtime report (kind v1 or v2; v2 carries the Store Hub''s Terminal PIN answer). The caller (POST /v1/device-runtime/report) has verified an Ed25519 signature over the report bytes by the presented identity key and parsed the closed shape; this door refuses unless that key''s SPKI fingerprint is the current sealed enrollment''s (group 0224 predicate), the device is a live terminal, and the report declares a known kind. Forward-only per key: an older or equal sequence is STALE and writes nothing. Executable by kitluy_device_runtime_service only.';

revoke all on function kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb) from public;
grant execute on function kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb)
  to kitluy_device_runtime_service;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Assertions.
-- ---------------------------------------------------------------------------
do $assert_0230$
declare
  v_findings text[] := '{}';
  v_door oid := 'kitluy_devices.record_device_runtime_report_v1(uuid, text, bigint, timestamptz, jsonb)'::regprocedure;
  v_check text;
  v_grantees text[];
begin
  select pg_get_constraintdef(c.oid) into v_check
    from pg_constraint c
   where c.conrelid = 'kitluy_devices.device_runtime_status'::regclass
     and c.conname = 'drs_report_schema_chk';
  if v_check is null
     or position('kitluy.device-runtime-report.v1' in v_check) = 0
     or position('kitluy.device-runtime-report.v2' in v_check) = 0 then
    v_findings := v_findings || 'the kind CHECK must accept exactly v1 and v2';
  end if;

  if not (select prosecdef from pg_proc where oid = v_door) then
    v_findings := v_findings || 'the runtime door must stay SECURITY DEFINER';
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_door)) <> 'kitluy_fleet_governor' then
    v_findings := v_findings || 'the runtime door must stay owned by kitluy_fleet_governor';
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

  -- A v2 report from an unknown device is refused quietly, and writes nothing.
  set local role kitluy_device_runtime_service;
  if kitluy_devices.record_device_runtime_report_v1(
       gen_random_uuid(), repeat('a', 64), 1, now(),
       '{"schema":"kitluy.device-runtime-report.v2"}'::jsonb) ->> 'code' <> 'DEVICE_UNKNOWN' then
    v_findings := v_findings || 'an unknown device must still be refused DEVICE_UNKNOWN';
  end if;
  reset role;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0230: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0230: runtime reports v1 and v2 accepted through the same door; the Store Hub''s Terminal PIN answer can now reach the Partner Portal';
end
$assert_0230$;

do $hand_back$
begin
  if (select granted from kitluy_0230_borrow) then
    execute format('revoke kitluy_fleet_governor from %I', current_user);
  end if;
end
$hand_back$;

commit;
