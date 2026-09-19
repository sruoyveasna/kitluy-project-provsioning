-- kitluy:group:0232
-- ============================================================================
-- 0232  A Store Hub reads the projection of ITS OWN terminals — authenticated
--       by its device identity key, scoped to its own Store Location
-- ============================================================================
-- Additive. Groups 0120-0231 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner decision 2026-09-19 (HUB-TERMINAL-SYNC-001): "Do we have any
--   way that we can make this run automatically — I am not able to ask you to
--   do it every time"; KLD-2026-09-03-TERMINAL-PROVISIONING-001 (the Hub holds
--   a cloud-delivered PROJECTION of each terminal, never authors one);
--   WS-11-T004-P04C1 §15-§16 (the cloud is the credential authority; the Hub
--   consumer of a projection delivery is built, the cloud PRODUCER is BLK-006).
--
-- ===========================================================================
-- WHAT THIS IS, PRECISELY
-- ===========================================================================
-- The READ half of the BLK-006 producer, as a governed door. Until today the
-- facts a Store Hub needs about a paired terminal — its device id, the X.509
-- serial it will present over mutual TLS, the fingerprint of the identity key
-- it signs its pairing proof with, the Store scope, and the profiles the
-- Partner granted its seat — were copied out of this database BY HAND
-- (scripts/development/hub-terminal-projection.mjs) and carried to the Hub on
-- a workstation, once per terminal. Every field of that hand-copy is a row the
-- cloud wrote when it issued the credential; nothing in it was ever an
-- operator's decision. This door returns the same rows to the Hub itself.
--
-- It is a READ. It writes nothing, mints nothing, signs nothing: the signed
-- delivery envelope and its transport are the development hub-sync service
-- (scripts/development/hub-sync-service.mjs) today and the BLK-006 producer
-- later. The door is the part that survives that hand-over.
--
-- ===========================================================================
-- WHO MAY READ, AND WHAT
-- ===========================================================================
-- Only a live `store_hub` whose CURRENT SEALED enrollment holds the presented
-- identity key — the group 0224 predicate, exactly as group 0229 applies it to
-- a terminal's runtime report. The caller has verified an Ed25519 signature by
-- that key over the request; this door refuses unless the key is the enrolled
-- one, so a caller with a key of its own signs validly and reads nothing.
--
-- And only ITS OWN terminals: those with an ACTIVE assignment in the same
-- Tenant, Digital Store and Store Location as the Hub's own active assignment.
-- A Hub cannot name another Store; the scope comes from its assignment row.
--
-- NOTHING SECRET LEAVES. A device id, an asset tag, a certificate serial, a
-- public-key fingerprint, a validity window and a profile list are public facts
-- about a credential the cloud issued. No private key exists in this schema,
-- and no provisioning code, pairing code or pooler credential is selected.
--
-- MC: READ (no table changes; three SELECT grants and three read-only RLS
-- policies for the door's owner; one SECURITY DEFINER read door owned by
-- kitluy_fleet_governor, executable by kitluy_edge_sync_service only).
-- ============================================================================

begin;

-- Borrow `kitluy_fleet_governor` only if this session cannot already SET ROLE
-- to it (the 0229 probe: membership is not "may SET ROLE" on PostgreSQL 16+).
create temporary table if not exists kitluy_0232_borrow (granted boolean) on commit drop;

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
  insert into kitluy_0232_borrow values (not v_can_set);
end
$borrow$;

-- ---------------------------------------------------------------------------
-- 1. The read reach the door's OWNER needs.
--
-- kitluy_fleet_governor already reads devices, device_assignments,
-- device_certificates and manufacturing_enrollments (groups 0188-0229). The
-- projection also needs the credential row (group 0120, owned by the issuer)
-- and the Partner's seat and its roles (group 0213). SELECT only, and only to
-- the governor that owns the door — no service identity gains table reach.
-- ---------------------------------------------------------------------------
-- device_credentials is OWNED by kitluy_credential_issuer (group 0120), and a
-- GRANT by anyone else is silently a no-op ("no privileges were granted" —
-- seen on kitluy-fresh, 2026-09-19). So the grant is made AS the owner, with
-- the same borrow-and-hand-back the governor gets above.
create temporary table if not exists kitluy_0232_issuer_borrow (granted boolean) on commit drop;
do $borrow_issuer$
declare
  v_can_set boolean;
begin
  begin
    execute 'set local role kitluy_credential_issuer';
    execute 'reset role';
    v_can_set := true;
  exception when insufficient_privilege then
    v_can_set := false;
  end;
  if not v_can_set then
    execute format('grant kitluy_credential_issuer to %I', current_user);
  end if;
  insert into kitluy_0232_issuer_borrow values (not v_can_set);
end
$borrow_issuer$;

-- A GRANT alone reads ZERO rows under FORCE ROW LEVEL SECURITY (the 0190
-- `hardware_profiles` lesson): every table here forces RLS, so each needs a
-- READ policy for the governor as well. Policies, like grants, are the
-- owner's to create.
set local role kitluy_credential_issuer;
grant select on kitluy_devices.device_credentials to kitluy_fleet_governor;
do $policy_credentials$
begin
  if not exists (select 1 from pg_policy where polname = 'device_credentials_fleet_governor_read'
                    and polrelid = 'kitluy_devices.device_credentials'::regclass) then
    execute 'create policy device_credentials_fleet_governor_read on kitluy_devices.device_credentials
               for select to kitluy_fleet_governor using (true)';
  end if;
end
$policy_credentials$;
reset role;

grant select on kitluy_devices.physical_terminals to kitluy_fleet_governor;
grant select on kitluy_devices.physical_terminal_roles to kitluy_fleet_governor;
do $policy_seats$
begin
  if not exists (select 1 from pg_policy where polname = 'physical_terminals_fleet_governor_read'
                    and polrelid = 'kitluy_devices.physical_terminals'::regclass) then
    execute 'create policy physical_terminals_fleet_governor_read on kitluy_devices.physical_terminals
               for select to kitluy_fleet_governor using (true)';
  end if;
  if not exists (select 1 from pg_policy where polname = 'physical_terminal_roles_fleet_governor_read'
                    and polrelid = 'kitluy_devices.physical_terminal_roles'::regclass) then
    execute 'create policy physical_terminal_roles_fleet_governor_read on kitluy_devices.physical_terminal_roles
               for select to kitluy_fleet_governor using (true)';
  end if;
end
$policy_seats$;

-- ---------------------------------------------------------------------------
-- 2. The door.
-- ---------------------------------------------------------------------------
set local role kitluy_fleet_governor;

create or replace function kitluy_devices.read_hub_terminal_projections_v1(
  p_hub_device_id uuid,
  p_identity_key_fingerprint text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, kitluy_devices, extensions
as $door$
declare
  v_hub record;
  v_assignment record;
  v_fingerprint text;
  v_terminals jsonb;
begin
  if p_hub_device_id is null or p_identity_key_fingerprint is null then
    raise exception 'KLUY-HUB-PROJECTION-READ-INVALID: every argument is required'
      using errcode = 'P0001';
  end if;

  select d.id, d.asset_tag, d.device_class::text as device_class,
         d.lifecycle_state::text as lifecycle,
         e.state as enrollment_state, e.revoked_at as enrollment_revoked_at,
         e.device_public_key_fingerprint
    into v_hub
    from kitluy_devices.devices d
    left join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
   where d.id = p_hub_device_id;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_UNKNOWN');
  end if;
  if v_hub.lifecycle in ('retired', 'replaced') then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'DEVICE_RETIRED');
  end if;
  if v_hub.device_class <> 'store_hub' then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'NOT_A_STORE_HUB');
  end if;

  -- The group 0224 predicate: the CURRENT, SEALED enrollment holds the key.
  v_fingerprint := lower(p_identity_key_fingerprint);
  if v_hub.enrollment_state is distinct from 'sealed'
     or v_hub.enrollment_revoked_at is not null
     or v_hub.device_public_key_fingerprint is distinct from v_fingerprint then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'IDENTITY_MISMATCH');
  end if;

  -- The Hub's OWN scope, from its own active assignment. Never from the caller.
  select a.id, a.tenant_id, a.digital_store_id, a.store_location_id, a.assignment_generation
    into v_assignment
    from kitluy_devices.device_assignments a
   where a.device_id = p_hub_device_id and a.state = 'active'
   order by a.assignment_generation desc
   limit 1;
  if not found then
    return jsonb_build_object('outcome', 'REFUSED', 'code', 'HUB_NOT_ASSIGNED');
  end if;

  -- Every live terminal with an ACTIVE assignment in that scope and an
  -- unrevoked, unexpired credential: its newest credential generation, the
  -- certificate the cloud issued for it, the identity key of its current
  -- sealed enrollment, and the profiles of the seat it is bound to.
  select coalesce(jsonb_agg(t order by t.asset_tag), '[]'::jsonb)
    into v_terminals
    from (
      select d.id                          as device_id,
             d.asset_tag,
             d.lifecycle_state::text       as lifecycle_state,
             a.id                          as assignment_id,
             a.assignment_generation,
             c.credential_id,
             c.serial_number               as credential_serial_label,
             c.public_key_fingerprint,
             c.certificate_generation,
             c.environment,
             c.not_before,
             c.not_after,
             cert.certificate_x509_serial,
             cert.certificate_pem,
             cert.issuer_reference,
             (select e.device_public_key_fingerprint
                from kitluy_devices.manufacturing_enrollments e
               where e.id = d.current_enrollment_id
                 and e.state = 'sealed'
                 and e.revoked_at is null)   as identity_key_fingerprint,
             seat.label                    as seat_label,
             coalesce(seat.profile_keys, '{}'::text[]) as profile_keys
        from kitluy_devices.devices d
        join kitluy_devices.device_assignments a
          on a.device_id = d.id and a.state = 'active'
        join lateral (
          select c.credential_id, c.serial_number, c.public_key_fingerprint,
                 c.certificate_generation, c.environment, c.not_before, c.not_after
            from kitluy_devices.device_credentials c
           where c.device_record_id = d.id
             and c.revoked_at is null
             and c.not_after > now()
           order by c.certificate_generation desc, c.created_at desc
           limit 1
        ) c on true
        left join kitluy_devices.device_certificates cert
          on cert.credential_id = c.credential_id
        left join lateral (
          select pt.label,
                 (select array_agg(r.terminal_profile_key order by r.ordinal)
                    from kitluy_devices.physical_terminal_roles r
                   where r.physical_terminal_id = pt.id and r.removed_at is null) as profile_keys
            from kitluy_devices.physical_terminals pt
           where pt.bound_device_id = d.id
           order by pt.bound_at desc nulls last
           limit 1
        ) seat on true
       where d.device_class = 'terminal'
         and d.lifecycle_state = 'active'
         and a.tenant_id = v_assignment.tenant_id
         and a.digital_store_id = v_assignment.digital_store_id
         and a.store_location_id = v_assignment.store_location_id
    ) t;

  return jsonb_build_object(
    'outcome', 'OK',
    'hub', jsonb_build_object(
      'deviceId', v_hub.id,
      'assetTag', v_hub.asset_tag,
      'assignmentId', v_assignment.id,
      'assignmentGeneration', v_assignment.assignment_generation,
      'tenantId', v_assignment.tenant_id,
      'digitalStoreId', v_assignment.digital_store_id,
      'storeLocationId', v_assignment.store_location_id
    ),
    'terminals', v_terminals
  );
end
$door$;

comment on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) is
  'Group 0232 (HUB-TERMINAL-SYNC-001). The READ half of the BLK-006 producer: the public projection facts (device id, asset tag, active assignment, newest unrevoked credential and its X.509 certificate, the identity-key fingerprint of the current sealed enrollment, the bound seat and its profile keys) of every live terminal with an ACTIVE assignment in the calling Store Hub''s OWN Tenant / Digital Store / Store Location. The caller has verified an Ed25519 signature by the presented Hub identity key; this door refuses unless that key is the Hub''s current sealed enrollment''s (group 0224 predicate), the device is a live store_hub, and it holds an active assignment. Reads only; nothing secret is selected. Executable by kitluy_edge_sync_service only.';

revoke all on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text) from public;
grant execute on function kitluy_devices.read_hub_terminal_projections_v1(uuid, text)
  to kitluy_edge_sync_service;

reset role;

-- ---------------------------------------------------------------------------
-- 3. Assertions.
-- ---------------------------------------------------------------------------
do $assert_0232$
declare
  v_findings text[] := '{}';
  v_door oid := 'kitluy_devices.read_hub_terminal_projections_v1(uuid, text)'::regprocedure;
  v_grantees text[];
  v_answer jsonb;
  -- Read as the migration's own identity: the sync service has no table reach.
  v_a_terminal uuid := (select id from kitluy_devices.devices where device_class = 'terminal' limit 1);
begin
  if not (select prosecdef from pg_proc where oid = v_door) then
    v_findings := v_findings || 'the projection read door must be SECURITY DEFINER';
  end if;
  if pg_get_userbyid((select proowner from pg_proc where oid = v_door)) <> 'kitluy_fleet_governor' then
    v_findings := v_findings || 'the projection read door must be owned by kitluy_fleet_governor';
  end if;
  if (select pg_get_functiondef(v_door)) ~* '\m(insert into|update kitluy_devices|delete from)\M' then
    v_findings := v_findings || 'the projection read door must write nothing';
  end if;

  select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end), '{}')
    into v_grantees
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = v_door and a.privilege_type = 'EXECUTE'
     and a.grantee <> p.proowner;
  if v_grantees <> array['kitluy_edge_sync_service'] then
    v_findings := v_findings || format('the projection read door is executable by %s, not the edge sync service alone', v_grantees);
  end if;

  if not has_table_privilege('kitluy_fleet_governor', 'kitluy_devices.device_credentials', 'SELECT') then
    v_findings := v_findings || 'the door owner cannot read device_credentials (the issuer-owned grant did not land)';
  end if;
  if (select count(*) from pg_policy
       where 'kitluy_fleet_governor'::regrole = any(polroles) and polcmd in ('r', '*')
         and polrelid in ('kitluy_devices.device_credentials'::regclass,
                          'kitluy_devices.physical_terminals'::regclass,
                          'kitluy_devices.physical_terminal_roles'::regclass)) < 3 then
    v_findings := v_findings || 'the door owner needs a READ policy on device_credentials, physical_terminals and physical_terminal_roles (FORCE RLS reads zero rows without one)';
  end if;

  -- An unknown Hub is refused quietly; a terminal is not a Hub.
  set local role kitluy_edge_sync_service;
  v_answer := kitluy_devices.read_hub_terminal_projections_v1(gen_random_uuid(), repeat('a', 64));
  if v_answer ->> 'code' <> 'DEVICE_UNKNOWN' then
    v_findings := v_findings || 'an unknown Hub must be refused DEVICE_UNKNOWN';
  end if;
  if v_a_terminal is not null then
    v_answer := kitluy_devices.read_hub_terminal_projections_v1(v_a_terminal, repeat('a', 64));
    if v_answer ->> 'code' <> 'NOT_A_STORE_HUB' then
      v_findings := v_findings || 'a terminal must be refused NOT_A_STORE_HUB before its key is even considered';
    end if;
  end if;
  reset role;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0232: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0232: a Store Hub reads its own terminals'' projection through one door, by its own identity key, in its own scope';
end
$assert_0232$;

do $hand_back$
begin
  if (select granted from kitluy_0232_borrow) then
    execute format('revoke kitluy_fleet_governor from %I', current_user);
  end if;
  if (select granted from kitluy_0232_issuer_borrow) then
    execute format('revoke kitluy_credential_issuer from %I', current_user);
  end if;
end
$hand_back$;

commit;
