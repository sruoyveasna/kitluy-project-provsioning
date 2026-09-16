-- kitluy:group:0227
-- Migration group 0227: device_boot_evidence.
--
-- Additive. Groups 0120-0226 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner task BOOT-RECOVERY-CLASSIFICATION-001 (2026-09-16) slice C;
-- the classification contract `packages/device-boot-classification`; the
-- decisions it rests on and does not re-decide — KLD-2026-09-14-REFLASH-
-- CREDENTIAL-RECOVERY-001, KLD-2026-08-06-WS11-T006-001, KLV4-DEC-007 and the
-- register's "storage evidence never resolves identity".
--
-- ===========================================================================
-- WHAT THIS IS
-- ===========================================================================
-- A booting board needs ONE sentence: what happened, and what to do. Deciding
-- that sentence needs no I/O and lives in the contract package. Assembling the
-- evidence needs the cloud, because only the cloud can say which device a board
-- serial is, what state that device is in, and which seat it holds.
--
-- `describe_device_boot_evidence_v1` is that assembly: one read, over the same
-- governed facts the doors already use, returning exactly the fields the
-- contract's `CloudDeviceFacts` names. It WRITES NOTHING and DECIDES NOTHING:
-- no quarantine, no sighting, no incident, no lifecycle change. Every governed
-- door (`register_device_v1`, `redeem_device_claim_v1`, `activate_device_v1`,
-- `reserve_device_credential_recovery_v2`) keeps its own refusals.
--
-- ===========================================================================
-- THE SAME PREDICATES THE DOORS USE — NOT NEW ONES
-- ===========================================================================
--   * Board resolution: `resolve_device_by_board_evidence_v1` (group 0197),
--     called, not copied. board_serial anchors, soc_serial corroborates, MAC
--     alone is review, storage signals are never consulted.
--   * Evidence collision: `colliding_evidence_device_ids` (group 0121), the
--     predicate `quarantine_evidence_collisions_v1` quarantines both twins on.
--   * Open incident: `cleared_at is null and incident_type <> 'activation_blocked'`,
--     the single predicate groups 0188, 0197, 0201, 0214, 0216, 0217, 0219 and
--     0225 all use.
--   * Live assignment: state in ('pending_trust', 'active').
--   * Identity freshness: the current enrollment's
--     `device_public_key_fingerprint`. A card records the fingerprint of the
--     identity key it registered with, never its enrollment id, so this is the
--     fact that recognises a card whose identity a later re-flash replaced.
--   * Seat: `physical_terminals.bound_device_id`, and the seat a board was last
--     paired into from `terminal_pairing_sessions.paired_device_id` — the
--     binding group 0213's KLUY-TERMSESSION-TERMINAL-BOUND refuses on.
--
-- ===========================================================================
-- ONE ADDITION TO RESOLUTION: A RETIRED OR REPLACED BOARD COMING BACK
-- ===========================================================================
-- The resolver deliberately skips retired and replaced devices, so a failed Pi
-- that was replaced and later powered up again resolves to NOTHING — and would
-- be told it is a brand-new device to pair. The owner task forbids exactly that
-- (§13: a replacement must never be impersonated, and a retired board must not
-- be silently reactivated). So when the resolver finds no live device, this read
-- looks for a retired or replaced device anchored to the same board_serial and
-- reports it. The contract answers SECURITY_LOCK / KLUY-BOOT-LOCKED-RETIRED.
-- It changes nothing about registration: `register_device_v1` is not touched.
--
-- ===========================================================================
-- THE CREDENTIAL OVERLAP WINDOW
-- ===========================================================================
-- On kitluy-fresh (2026-09-16) two heads sit at generation 2 while still
-- honouring generation 1 until 2026-09-18. A card at the previous generation
-- inside that window authenticates; calling it outdated would stop a working
-- shop for two days. The head read therefore reports the previous generation
-- only while `overlap_ends_at` is in the future.
--
-- ===========================================================================
-- THE SHAPE: ONE ASSEMBLY, TWO DOORS
-- ===========================================================================
-- `device_boot_facts_v1` assembles one device's facts, once. Two doors use it:
--   * `describe_device_boot_evidence_v1(signals)` — the BOARD's: resolves the
--     hardware first, so a card never names the device;
--   * `describe_device_recovery_facts_v1(device_id)` — the ADMIN's, called by the
--     Management API after it has authorized a human with fleet.read.
-- Neither can disagree with the other about a device, because neither assembles.
--
-- No single owner can read everything. `postgres` (BYPASSRLS, not superuser)
-- alone may execute the resolver and read `physical_terminals` and
-- `terminal_pairing_sessions`, but holds no SELECT on `device_credential_heads`,
-- which belongs to `kitluy_credential_issuer`. So the head is read by a
-- narrow definer owned by that governor, returning two integers, executable by
-- `postgres` only; the rest is owned by `postgres`. No table ACL changes.
--
-- ===========================================================================
-- WHY A NEW IDENTITY
-- ===========================================================================
-- `/v1/device-boot` is a PRE-CREDENTIAL surface: a board that has just been
-- re-flashed has no operational certificate. Such a surface must never run as
-- `service_role` (BYPASSRLS), and giving an existing composition identity this
-- read would widen a role whose capability count is asserted. So, as with
-- groups 0172, 0190 and 0192, a NOLOGIN identity with EXACTLY TWO capabilities:
-- the two read-only doors above.
--
-- What the read reveals is bounded by what `/functions/v1/device-registration`
-- already returns to an unauthenticated caller for the same signals (the device
-- id and its registration status). The route that calls it returns only the
-- shop-safe decision — never device ids, Store scope or the admin detail.

begin;

-- `alter function ... owner to kitluy_credential_issuer` needs membership.
-- Borrowed through `execute`: a top-level GRANT over an existing
-- platform-granted membership crashes the local supabase/postgres image.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- 1. The composition identity
-- ===========================================================================
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_device_boot_service') then
    create role kitluy_device_boot_service nologin;
  end if;
end
$role$;

comment on role kitluy_device_boot_service is
  'Group 0227. The device boot classification composition identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the device-registry service connecting as service_role, exactly like kitluy_hub_pairing_service (0192). Holds EXECUTE on exactly two capabilities — describe_device_boot_evidence_v1 (a board, by its hardware) and describe_device_recovery_facts_v1 (the Management API, by device id, after authorizing a human) — both reads that write nothing, and NOTHING else: no table access, no door, no role or policy administration. It exists because /v1/device-boot is a pre-credential surface and must never run as service_role, which holds BYPASSRLS.';

grant kitluy_device_boot_service to service_role;
-- Schema USAGE only — never table privileges.
grant usage on schema kitluy_devices to kitluy_device_boot_service;

-- ===========================================================================
-- 2. The credential head, for the outer read alone
-- ===========================================================================
create or replace function kitluy_devices.device_boot_credential_head_v1(
  p_device_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $boot_head$
declare
  v_head record;
begin
  select h.current_generation, h.previous_generation, h.overlap_ends_at
    into v_head
    from kitluy_devices.device_credential_heads h
   where h.device_record_id = p_device_id
     and h.environment = p_environment
     and h.purpose = 'device_identity';
  if not found then
    return jsonb_build_object('current_generation', null, 'honoured_previous_generation', null);
  end if;
  return jsonb_build_object(
    'current_generation', v_head.current_generation,
    'honoured_previous_generation',
      case when v_head.previous_generation is not null
                and v_head.overlap_ends_at is not null
                and v_head.overlap_ends_at > now()
           then v_head.previous_generation end);
end;
$boot_head$;

alter function kitluy_devices.device_boot_credential_head_v1(uuid, text)
  owner to kitluy_credential_issuer;

comment on function kitluy_devices.device_boot_credential_head_v1(uuid, text) is
  'Group 0227. The device_identity credential head of one device: its current generation, and its previous generation ONLY while the overlap window is open. Owned by kitluy_credential_issuer (which owns the head table); executable by postgres alone, as the owner of device_boot_facts_v1. Writes nothing.';

revoke all on function kitluy_devices.device_boot_credential_head_v1(uuid, text) from public;
grant execute on function kitluy_devices.device_boot_credential_head_v1(uuid, text) to postgres;

-- ===========================================================================
-- 3. The facts about ONE device — assembled in exactly one place
-- ===========================================================================
-- Both doors below report a device the same way, so the assembly lives here
-- once. Internal: executable by `postgres` (the owner of both doors) alone.
create or replace function kitluy_devices.device_boot_facts_v1(
  p_device_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $boot_facts$
declare
  v_device record;
  v_assignment record;
  v_certificate record;
  v_head jsonb;
  v_incidents integer;
  v_seat_id uuid;
  v_seat_bound_device uuid;
  v_seat_occupied boolean;
  v_seat jsonb;
begin
  select d.id, d.device_class, d.lifecycle_state, d.current_enrollment_id, d.assignment_generation,
         e.device_public_key_fingerprint
    into v_device
    from kitluy_devices.devices d
    left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = p_device_id;
  if not found then
    return null;
  end if;

  select a.state, a.digital_store_id, a.store_location_id
    into v_assignment
    from kitluy_devices.device_assignments a
   where a.device_id = p_device_id
     and a.state in ('pending_trust', 'active')
   order by a.assignment_generation desc
   limit 1;

  select c.certificate_generation, c.enrollment_id
    into v_certificate
    from kitluy_devices.device_certificates c
   where c.device_id = p_device_id
     and c.environment = p_environment
     and c.status = 'active'
   order by c.certificate_generation desc nulls last, c.issued_at desc
   limit 1;

  select count(*) into v_incidents
    from kitluy_devices.device_trust_incidents
   where device_id = p_device_id
     and cleared_at is null
     and incident_type <> 'activation_blocked';

  v_head := kitluy_devices.device_boot_credential_head_v1(p_device_id, p_environment);

  -- The seat: the terminal this board is bound to, or else the one it was last
  -- paired into. Occupied means that seat is now held by ANOTHER device's live
  -- assignment — a replacement took it. Never derived from a card.
  if v_device.device_class = 'terminal' then
    select pt.id, pt.bound_device_id into v_seat_id, v_seat_bound_device
      from kitluy_devices.physical_terminals pt
     where pt.bound_device_id = p_device_id
     limit 1;
    if v_seat_id is null then
      select pt.id, pt.bound_device_id into v_seat_id, v_seat_bound_device
        from kitluy_devices.terminal_pairing_sessions s
        join kitluy_devices.physical_terminals pt on pt.id = s.physical_terminal_id
       where s.paired_device_id = p_device_id
       order by s.paired_at desc nulls last
       limit 1;
    end if;
    if v_seat_id is not null then
      v_seat_occupied := v_seat_bound_device is not null
        and v_seat_bound_device <> p_device_id
        and exists (
          select 1
            from kitluy_devices.physical_terminals pt
            join kitluy_devices.device_assignments a on a.id = pt.bound_assignment_id
           where pt.id = v_seat_id
             and a.state in ('pending_trust', 'active'));
      v_seat := jsonb_build_object(
        'physical_terminal_id', v_seat_id,
        'occupied_by_other_device', v_seat_occupied);
    end if;
  end if;

  return jsonb_build_object(
    'device_record_id', v_device.id,
    'device_class', v_device.device_class,
    'lifecycle', v_device.lifecycle_state,
    'open_trust_incident_count', v_incidents,
    'current_enrollment_id', v_device.current_enrollment_id,
    'current_identity_key_fingerprint', v_device.device_public_key_fingerprint,
    'assignment_generation', v_device.assignment_generation,
    'assignment', case when v_assignment.state is null then null else jsonb_build_object(
      'state', v_assignment.state,
      'digital_store_id', v_assignment.digital_store_id,
      'store_location_id', v_assignment.store_location_id) end,
    'credential_head_generation', v_head->'current_generation',
    'honoured_previous_generation', v_head->'honoured_previous_generation',
    'active_certificate', case when v_certificate.certificate_generation is null then null else jsonb_build_object(
      'generation', v_certificate.certificate_generation,
      'enrollment_id', v_certificate.enrollment_id) end,
    'seat', v_seat);
end;
$boot_facts$;

comment on function kitluy_devices.device_boot_facts_v1(uuid, text) is
  'Group 0227. The single assembly of one device''s boot classification facts: lifecycle, open trust incidents, current enrollment and its identity key fingerprint, live assignment, active certificate, credential head (honouring an open overlap window) and seat. Null when the device does not exist. INTERNAL: executable by postgres alone, as the owner of describe_device_boot_evidence_v1 and describe_device_recovery_facts_v1. Writes nothing.';

revoke all on function kitluy_devices.device_boot_facts_v1(uuid, text) from public;

-- ===========================================================================
-- 4. The board's door: resolve the HARDWARE, then report its device
-- ===========================================================================
create or replace function kitluy_devices.describe_device_boot_evidence_v1(
  p_signals jsonb,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $boot_evidence$
declare
  v_resolution jsonb;
  v_resolution_kind text;
  v_detail text;
  v_device_id uuid;
  v_board text;
begin
  if p_environment is null or p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-BOOT-EVIDENCE-INVALID: environment must be development, pilot or production'
      using errcode = 'P0001';
  end if;
  if p_signals is null or jsonb_typeof(p_signals) <> 'array' then
    raise exception 'KLUY-BOOT-EVIDENCE-INVALID: signals must be a JSON array'
      using errcode = 'P0001';
  end if;

  -- The governed resolver, called rather than copied.
  v_resolution := kitluy_devices.resolve_device_by_board_evidence_v1(p_signals);
  v_detail := v_resolution->>'conflict_reason';
  v_resolution_kind := case v_resolution->>'confidence'
                         when 'strong' then 'resolved'
                         when 'board_serial' then 'resolved'
                         when 'conflict' then 'conflict'
                         when 'mac_only' then 'review_mac_only'
                         else 'unknown' end;
  if v_resolution_kind = 'resolved' then
    v_device_id := (v_resolution->>'device_id')::uuid;
  end if;

  -- A retired or replaced board coming back (see header).
  if v_resolution_kind = 'unknown' then
    select kitluy_devices.normalize_hardware_signal(max(s->>'signal_value'))
      into v_board
      from jsonb_array_elements(p_signals) s
     where s->>'signal_type' = 'board_serial';
    if v_board is not null and v_board <> '' then
      select d.id into v_device_id
        from kitluy_devices.devices d
        join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
        join kitluy_devices.hardware_manifest_signals sig on sig.manifest_id = e.hardware_manifest_id
       where sig.signal_type = 'board_serial'
         and sig.signal_value = v_board
         and d.lifecycle_state in ('retired', 'replaced')
       order by d.updated_at desc
       limit 1;
      if v_device_id is not null then
        v_resolution_kind := 'resolved';
        v_detail := 'KLUY-BOARD-EVIDENCE-RETIRED-DEVICE';
      end if;
    end if;
  end if;

  if v_device_id is null then
    return jsonb_build_object(
      'board_resolution', v_resolution_kind,
      'resolution_detail', v_detail,
      'device', null);
  end if;

  -- Two live devices sharing non-storage evidence: the predicate that
  -- quarantines both twins. Reported, never acted on here.
  if v_resolution_kind = 'resolved'
     and exists (select 1 from kitluy_devices.colliding_evidence_device_ids(v_device_id)) then
    v_resolution_kind := 'conflict';
    v_detail := 'KLUY-BOARD-EVIDENCE-COLLISION';
  end if;

  return jsonb_build_object(
    'board_resolution', v_resolution_kind,
    'resolution_detail', v_detail,
    'device', kitluy_devices.device_boot_facts_v1(v_device_id, p_environment));
end;
$boot_evidence$;

comment on function kitluy_devices.describe_device_boot_evidence_v1(jsonb, text) is
  'Group 0227. The cloud half of a board''s boot classification evidence, from its hardware signals: board resolution (resolve_device_by_board_evidence_v1, plus a retired/replaced board anchored to the same board_serial), evidence collision, and device_boot_facts_v1 for the device the hardware resolves to. WRITES NOTHING and decides nothing — the decision is packages/device-boot-classification. Executable by kitluy_device_boot_service only.';

revoke all on function kitluy_devices.describe_device_boot_evidence_v1(jsonb, text) from public;

-- ===========================================================================
-- 5. The Admin's door: the same facts, for a device named by id
-- ===========================================================================
-- The Management API authorizes a HUMAN first (fleet.read), then reads as
-- `kitluy_device_boot_service` — the pattern Hub pairing issuance uses. It
-- shows what this device needs to recover, decided by the same contract a
-- board uses. Same facts function, so the Admin and the board cannot disagree
-- about the device.
create or replace function kitluy_devices.describe_device_recovery_facts_v1(
  p_device_id uuid,
  p_environment text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $recovery_facts$
declare
  v_facts jsonb;
begin
  if p_environment is null or p_environment not in ('development', 'pilot', 'production') then
    raise exception 'KLUY-BOOT-EVIDENCE-INVALID: environment must be development, pilot or production'
      using errcode = 'P0001';
  end if;
  v_facts := kitluy_devices.device_boot_facts_v1(p_device_id, p_environment);
  if v_facts is null then
    return null;
  end if;
  return jsonb_build_object(
    'board_resolution',
      case when exists (select 1 from kitluy_devices.colliding_evidence_device_ids(p_device_id))
           then 'conflict' else 'resolved' end,
    'resolution_detail',
      case when exists (select 1 from kitluy_devices.colliding_evidence_device_ids(p_device_id))
           then 'KLUY-BOARD-EVIDENCE-COLLISION' end,
    'device', v_facts);
end;
$recovery_facts$;

comment on function kitluy_devices.describe_device_recovery_facts_v1(uuid, text) is
  'Group 0227. device_boot_facts_v1 for a device named by id, with its evidence-collision state, for the Management API after it has authorized a human with fleet.read. Null when the device does not exist. Writes nothing. Executable by kitluy_device_boot_service only.';

revoke all on function kitluy_devices.describe_device_recovery_facts_v1(uuid, text) from public;

do $revoke_platform_roles$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      foreach f in array array[
        'kitluy_devices.describe_device_boot_evidence_v1(jsonb, text)',
        'kitluy_devices.describe_device_recovery_facts_v1(uuid, text)',
        'kitluy_devices.device_boot_facts_v1(uuid, text)',
        'kitluy_devices.device_boot_credential_head_v1(uuid, text)'] loop
        execute format('revoke all on function %s from %I', f, r);
      end loop;
    end if;
  end loop;
end
$revoke_platform_roles$;

grant execute on function kitluy_devices.describe_device_boot_evidence_v1(jsonb, text)
  to kitluy_device_boot_service;
grant execute on function kitluy_devices.describe_device_recovery_facts_v1(uuid, text)
  to kitluy_device_boot_service;

-- ===========================================================================
-- 6. Prove the boundary on apply
-- ===========================================================================
do $assert_0227$
declare
  v_findings text[] := array[]::text[];
  v_evidence oid := 'kitluy_devices.describe_device_boot_evidence_v1(jsonb, text)'::regprocedure;
  v_recovery oid := 'kitluy_devices.describe_device_recovery_facts_v1(uuid, text)'::regprocedure;
  v_facts oid := 'kitluy_devices.device_boot_facts_v1(uuid, text)'::regprocedure;
  v_head oid := 'kitluy_devices.device_boot_credential_head_v1(uuid, text)'::regprocedure;
  v_role oid := (select oid from pg_roles where rolname = 'kitluy_device_boot_service');
begin
  if v_role is null or exists (select 1 from pg_roles where oid = v_role and rolcanlogin) then
    v_findings := v_findings || 'the boot service role is missing or can log in';
  end if;

  -- A member of nothing: it cannot inherit its way to another capability.
  if exists (select 1 from pg_auth_members m where m.member = v_role) then
    v_findings := v_findings || 'the boot service role must be a member of NOTHING';
  end if;

  -- Held only by service_role. PG16+ grants the creator an automatic membership
  -- (KLREC-2026-08-07-PG16-CREATEROLE-001); any other holder is a finding.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = v_role
       and r.rolname <> 'service_role'
       and not (r.rolname = current_user and m.grantor <> m.member)) then
    v_findings := v_findings || 'an unexpected role holds the boot service identity';
  end if;

  -- Every 0227 function: definer, stable (so Postgres itself refuses a write
  -- inside it), pinned search path.
  if exists (select 1 from pg_proc where oid in (v_evidence, v_recovery, v_facts, v_head)
              and not (prosecdef and provolatile = 's')) then
    v_findings := v_findings || 'a 0227 function is not a stable security definer';
  end if;
  if exists (select 1 from pg_proc where oid in (v_evidence, v_recovery, v_facts, v_head)
              and not exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) then
    v_findings := v_findings || 'a 0227 function has no pinned search_path';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = v_head) <> 'kitluy_credential_issuer' then
    v_findings := v_findings || 'device_boot_credential_head_v1 is not owned by kitluy_credential_issuer';
  end if;

  -- No direct grant to a platform role. `service_role` inherits through role
  -- membership on the local stacks; that is the role graph, not a grant.
  if exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) acl
      join pg_roles r on r.oid = acl.grantee
     where p.oid in (v_evidence, v_recovery, v_facts, v_head)
       and r.rolname in ('service_role', 'anon', 'authenticated')) then
    v_findings := v_findings || 'a 0227 function carries a direct grant to a platform role';
  end if;
  -- The two doors: their owner and the boot identity, nobody else.
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
              where p.oid in (v_evidence, v_recovery) and acl.privilege_type = 'EXECUTE'
                and acl.grantee not in (p.proowner, v_role)) then
    v_findings := v_findings || 'a 0227 door is granted to a role other than its owner and kitluy_device_boot_service';
  end if;
  -- The internals: postgres only, never the boot identity directly.
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
              where p.oid in (v_facts, v_head) and acl.privilege_type = 'EXECUTE'
                and acl.grantee not in (p.proowner, 'postgres'::regrole)) then
    v_findings := v_findings || 'a 0227 internal read is granted to a role other than its owner and postgres';
  end if;

  -- EXACTLY two capabilities — the board's door and the Admin's door — and no
  -- table privilege at all.
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
             aclexplode(p.proacl) acl
       where n.nspname like 'kitluy%'
         and acl.grantee = v_role and acl.privilege_type = 'EXECUTE') <> 2 then
    v_findings := v_findings || 'the boot service role must hold EXACTLY two EXECUTE grants';
  end if;
  if exists (select 1 from information_schema.role_table_grants
              where grantee = 'kitluy_device_boot_service') then
    v_findings := v_findings || 'the boot service role must hold no table privilege';
  end if;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0227: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0227: boot evidence and recovery facts are readable by kitluy_device_boot_service alone, and neither read writes anything';
end
$assert_0227$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
