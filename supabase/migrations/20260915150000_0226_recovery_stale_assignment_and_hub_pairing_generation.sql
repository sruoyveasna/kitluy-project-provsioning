-- kitluy:group:0226
-- Migration group 0226: recovery_stale_assignment_and_hub_pairing_generation.
--
-- Additive. Groups 0120-0225 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner task REFLASH-HARDENING-001 (2026-09-15); open
-- reconciliations KLREC-2026-09-15-RECOVERY-RESERVES-BEFORE-GENERATION-CHECK-001
-- (defect C) and KLREC-2026-09-15-HUB-REQUEST-ASSIGNMENT-GENERATION-001
-- (defect B), both proven on hardware; KLD-2026-09-14-REFLASH-CREDENTIAL-
-- RECOVERY-001 (the recovery decision these harden, unchanged).
--
-- ===========================================================================
-- DEFECT C — A STALE REQUEST LEFT STATE THAT BLOCKED THE CORRECTED ONE
-- ===========================================================================
-- On hardware, a re-paired Store Hub (assignment generation 3) asked for its
-- certificate at generation 1. `reserve_device_credential_recovery_v1` never
-- saw the request's generation, so it opened a `rotate_key` reservation and
-- the service registered the key; only issuance then refused
-- `KLUY-CRED-STALE-ASSIGNMENT` (group 0204). The reservation stayed
-- `pop_pending`, a corrected request was refused
-- `KLUY-RECOVERY-ALREADY-RESERVED`, and the key's fingerprint was spent for
-- ever. It took `abandon_generation_key_v1` and a new key to recover.
--
-- `reserve_device_credential_recovery_v2` takes the request's assignment
-- generation and refuses a mismatch BEFORE anything is written — before the
-- idempotent replay, before eligibility, before the reservation:
--
--     KLUY-RECOVERY-STALE-ASSIGNMENT
--
-- Then it calls v1 unchanged, so every existing check still runs in the same
-- order and nothing about recovery is loosened. The comparison is against
-- `devices.assignment_generation`, the value group 0204's issuance check uses.
-- It is a plain read, deliberately not FOR UPDATE: the owner holds SELECT only
-- on `devices` (row security forced, read policy), and v1 takes the credential
-- head lock FIRST in the order the renewal and issuance doors share, which an
-- earlier device lock would invert. A re-pair racing this check by milliseconds
-- is still refused by issuance's own KLUY-CRED-STALE-ASSIGNMENT.
--
-- A legitimate lost-response replay is unaffected: recovery does not change the
-- assignment generation, so the replayed request still matches. A request made
-- before a re-pair no longer matches, and is refused rather than replayed.
--
-- v1 keeps its owner, ACL and search path exactly as group 0224 left them. The
-- registry service calls v2.
--
-- ===========================================================================
-- DEFECT B, CLOUD HALF — THE HUB WAS NEVER TOLD ITS GENERATION
-- ===========================================================================
-- The Hub pairing route answered with the assignment id and scope but no
-- generation, because `redeem_hub_claim_v1` returns a bare uuid and
-- `kitluy_hub_pairing_service` cannot read `device_assignments`. The board
-- therefore requested at generation 1 after every re-pair.
--
-- `hub_pairing_assignment_generation_v1` is the narrowest read that fixes it:
-- one integer, for one Store Hub assignment that is still `pending_trust` —
-- the state `redeem_hub_claim_v1` has just created in the same transaction —
-- executable by `kitluy_hub_pairing_service` alone. It returns nothing a caller
-- holding that assignment id does not already hold the right to act on.

begin;

-- `alter function ... owner to kitluy_credential_issuer` needs membership, as in
-- group 0224; borrowed through `execute` (a top-level GRANT over an existing
-- platform-granted membership crashes the local supabase/postgres image) and
-- handed back at the end.
do $borrow$
begin
  execute format('grant kitluy_credential_issuer to %I', current_user);
end
$borrow$;

-- ===========================================================================
-- 1. The recovery reservation, generation-checked before mutation
-- ===========================================================================
create or replace function kitluy_devices.reserve_device_credential_recovery_v2(
  p_device_record_id uuid,
  p_environment text,
  p_purpose text,
  p_idempotency_key text,
  p_identity_public_key_fingerprint text,
  p_identity_proof_service_verified boolean,
  p_trusted_time timestamptz,
  p_trusted_time_status text,
  p_actor_ref text,
  p_request_assignment_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = kitluy_devices, extensions, pg_catalog
as $recover_v2$
declare
  v_device_generation integer;
begin
  select d.assignment_generation into v_device_generation
    from kitluy_devices.devices d
   where d.id = p_device_record_id;

  -- A missing device is left to v1, which refuses it with its own code. Every
  -- other request must state the generation the device is actually at.
  if found and (p_request_assignment_generation is null
                or p_request_assignment_generation <> v_device_generation) then
    raise exception
      'KLUY-RECOVERY-STALE-ASSIGNMENT: request carries assignment generation %, device is at %; nothing was reserved',
      coalesce(p_request_assignment_generation::text, 'null'), v_device_generation
      using errcode = 'P0001';
  end if;

  return kitluy_devices.reserve_device_credential_recovery_v1(
    p_device_record_id,
    p_environment,
    p_purpose,
    p_idempotency_key,
    p_identity_public_key_fingerprint,
    p_identity_proof_service_verified,
    p_trusted_time,
    p_trusted_time_status,
    p_actor_ref);
end;
$recover_v2$;

comment on function kitluy_devices.reserve_device_credential_recovery_v2(
  uuid, text, text, text, text, boolean, timestamptz, text, text, integer) is
  'Group 0226. The recovery reservation the registry service calls: refuses KLUY-RECOVERY-STALE-ASSIGNMENT when the request''s assignment generation differs from devices.assignment_generation, BEFORE the idempotent replay, eligibility or any write, then delegates to reserve_device_credential_recovery_v1 unchanged. Without it a stale request left a pop_pending reservation and a spent key fingerprint that blocked every corrected request (hardware, 2026-09-15).';

alter function kitluy_devices.reserve_device_credential_recovery_v2(
  uuid, text, text, text, text, boolean, timestamptz, text, text, integer)
  owner to kitluy_credential_issuer;

revoke all on function kitluy_devices.reserve_device_credential_recovery_v2(
  uuid, text, text, text, text, boolean, timestamptz, text, text, integer) from public;

-- ===========================================================================
-- 2. The Hub pairing assignment generation, for the pairing service alone
-- ===========================================================================
create or replace function kitluy_devices.hub_pairing_assignment_generation_v1(
  p_assignment_id uuid
)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $hub_generation$
declare
  v_generation integer;
begin
  select a.assignment_generation into v_generation
    from kitluy_devices.device_assignments a
    join kitluy_devices.devices d on d.id = a.device_id
   where a.id = p_assignment_id
     and a.state = 'pending_trust'
     and d.device_class = 'store_hub';
  if not found then
    raise exception
      'KLUY-HUBSESSION-ASSIGNMENT-UNKNOWN: no Store Hub assignment pending trust has that id'
      using errcode = 'P0001';
  end if;
  return v_generation;
end;
$hub_generation$;

comment on function kitluy_devices.hub_pairing_assignment_generation_v1(uuid) is
  'Group 0226. The assignment generation of ONE Store Hub assignment that is still pending_trust — the row redeem_hub_claim_v1 has just created — so the Hub pairing route can tell the board the generation it must request its certificate at. Executable by kitluy_hub_pairing_service only. Before it, a re-paired Hub requested at generation 1 and was refused KLUY-CRED-STALE-ASSIGNMENT (hardware, 2026-09-15).';

revoke all on function kitluy_devices.hub_pairing_assignment_generation_v1(uuid) from public;

-- ===========================================================================
-- 3. Grants
-- ===========================================================================
do $revoke_platform_roles$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format(
        'revoke all on function kitluy_devices.reserve_device_credential_recovery_v2(uuid, text, text, text, text, boolean, timestamptz, text, text, integer) from %I', r);
      execute format(
        'revoke all on function kitluy_devices.hub_pairing_assignment_generation_v1(uuid) from %I', r);
    end if;
  end loop;
end
$revoke_platform_roles$;

grant execute on function kitluy_devices.reserve_device_credential_recovery_v2(
  uuid, text, text, text, text, boolean, timestamptz, text, text, integer) to kitluy_issuance_service;
grant execute on function kitluy_devices.hub_pairing_assignment_generation_v1(uuid)
  to kitluy_hub_pairing_service;

-- ===========================================================================
-- 4. HOSTILE ASSERTIONS — the migration fails rather than shipping a weakening
-- ===========================================================================
do $assert_0226$
declare
  v_findings text[] := array[]::text[];
  v_v1 regprocedure := 'kitluy_devices.reserve_device_credential_recovery_v1(uuid, text, text, text, text, boolean, timestamptz, text, text)'::regprocedure;
  v_v2 regprocedure := 'kitluy_devices.reserve_device_credential_recovery_v2(uuid, text, text, text, text, boolean, timestamptz, text, text, integer)'::regprocedure;
  v_gen regprocedure := 'kitluy_devices.hub_pairing_assignment_generation_v1(uuid)'::regprocedure;
  v_role text;
begin
  -- v2: definer, owned like v1, same search path, checks before delegating.
  if not (select prosecdef from pg_proc where oid = v_v2) then
    v_findings := v_findings || 'reserve_device_credential_recovery_v2 is not security definer';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = v_v2) <> 'kitluy_credential_issuer' then
    v_findings := v_findings || 'reserve_device_credential_recovery_v2 is not owned by kitluy_credential_issuer';
  end if;
  if (select proconfig from pg_proc where oid = v_v2)
     is distinct from (select proconfig from pg_proc where oid = v_v1) then
    v_findings := v_findings || 'v2 does not carry v1''s search path';
  end if;
  if position('KLUY-RECOVERY-STALE-ASSIGNMENT' in (select prosrc from pg_proc where oid = v_v2)) = 0
     or position('reserve_device_credential_recovery_v1(' in (select prosrc from pg_proc where oid = v_v2)) = 0
     or position('KLUY-RECOVERY-STALE-ASSIGNMENT' in (select prosrc from pg_proc where oid = v_v2))
        > position('reserve_device_credential_recovery_v1(' in (select prosrc from pg_proc where oid = v_v2)) then
    v_findings := v_findings || 'v2 does not refuse a stale generation before delegating to v1';
  end if;
  if not has_function_privilege('kitluy_issuance_service', v_v2, 'execute') then
    v_findings := v_findings || 'kitluy_issuance_service cannot execute v2';
  end if;

  -- v1 exactly as group 0224 left it.
  if (select pg_get_userbyid(proowner) from pg_proc where oid = v_v1) <> 'kitluy_credential_issuer'
     or not (select prosecdef from pg_proc where oid = v_v1)
     or not has_function_privilege('kitluy_issuance_service', v_v1, 'execute') then
    v_findings := v_findings || 'reserve_device_credential_recovery_v1 changed owner, security or grant';
  end if;

  -- The generation read: definer, owned like redeem_hub_claim_v1, one caller.
  if not (select prosecdef from pg_proc where oid = v_gen) then
    v_findings := v_findings || 'hub_pairing_assignment_generation_v1 is not security definer';
  end if;
  if (select pg_get_userbyid(proowner) from pg_proc where oid = v_gen)
     <> (select pg_get_userbyid(proowner) from pg_proc
          where oid = 'kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text)'::regprocedure) then
    v_findings := v_findings || 'hub_pairing_assignment_generation_v1 is not owned like redeem_hub_claim_v1';
  end if;
  if not has_function_privilege('kitluy_hub_pairing_service', v_gen, 'execute') then
    v_findings := v_findings || 'kitluy_hub_pairing_service cannot execute the generation read';
  end if;
  if has_function_privilege('kitluy_issuance_service', v_gen, 'execute') then
    v_findings := v_findings || 'kitluy_issuance_service can execute the generation read';
  end if;

  -- Nobody else, for either function.
  if has_function_privilege('public', v_v2, 'execute')
     or has_function_privilege('public', v_gen, 'execute') then
    v_findings := v_findings || 'a 0226 function is executable by PUBLIC';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and (has_function_privilege(v_role, v_v2, 'execute')
            or has_function_privilege(v_role, v_gen, 'execute')) then
      v_findings := v_findings || format('a 0226 function is executable by %s', v_role);
    end if;
  end loop;
  -- `service_role` is a MEMBER of the service roles on the local stacks, so it
  -- inherits their EXECUTE exactly as it does for group 0224's functions; that
  -- is the role graph, not a grant. What must not exist is a DIRECT grant.
  if exists (
    select 1
      from pg_proc p, aclexplode(p.proacl) acl
      join pg_roles r on r.oid = acl.grantee
     where p.oid in (v_v2, v_gen)
       and r.rolname in ('service_role', 'anon', 'authenticated')
  ) then
    v_findings := v_findings || 'a 0226 function carries a direct grant to a platform role';
  end if;
  if (select count(*) from pg_proc p, aclexplode(p.proacl) acl
       where p.oid = v_v2 and acl.privilege_type = 'EXECUTE'
         and acl.grantee not in ('kitluy_credential_issuer'::regrole, 'kitluy_issuance_service'::regrole)) > 0 then
    v_findings := v_findings || 'v2 is granted to a role other than its owner and kitluy_issuance_service';
  end if;
  if (select count(*) from pg_proc p, aclexplode(p.proacl) acl
       where p.oid = v_gen and acl.privilege_type = 'EXECUTE'
         and acl.grantee not in (p.proowner, 'kitluy_hub_pairing_service'::regrole)) > 0 then
    v_findings := v_findings || 'the generation read is granted to a role other than its owner and kitluy_hub_pairing_service';
  end if;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0226: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0226: recovery refuses a stale assignment generation before reserving; the Hub pairing service can read the generation it just created';
end
$assert_0226$;

do $hand_back$
begin
  execute format('revoke kitluy_credential_issuer from %I', current_user);
end
$hand_back$;

commit;
