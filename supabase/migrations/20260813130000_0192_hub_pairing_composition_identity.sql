-- kitluy:migration:0192
--
-- THE STORE HUB PAIRING COMPOSITION IDENTITY
-- =============================================================================
-- Authority: KLD-2026-08-13-HUB-CLAIM-PRESENTATION-001 (group 0191, the
-- presentation door); pairing protocol §6.1; and the 0127/0172 composition
-- pattern this copies verbatim.
--
-- WHY A ROLE, WHEN THE DOORS ALREADY WORK
-- ---------------------------------------
-- Both doors the Hub pairing route needs are reachable today — but only by
-- `service_role`:
--
--     evaluate_hub_claim_code_v1   service_role  (granted by 0191)
--     redeem_device_claim_v1       service_role  (granted by 0121; NOT a definer,
--                                  so section 2a bridges it rather than granting it)
--
-- `service_role` holds **BYPASSRLS** and can read and write every table in the
-- database. `/v1/hub-pairing` is a PRE-CREDENTIAL, internet-facing surface: its
-- caller is a factory-fresh Store Hub whose only authority is an eight-character
-- code an operator read off a screen. Running that surface as `service_role`
-- would make the least-authenticated route in the system also the most
-- privileged database client in it.
--
-- So the composition gets its own NOLOGIN identity holding EXECUTE on exactly
-- two functions and nothing else — no table access, no other door, no role or
-- policy administration. Identical in shape to `kitluy_provisioning_service`
-- (0172) and `kitluy_fleet_service` (0177/0190).
--
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------
-- It does **not** revoke `redeem_device_claim_v1` from `service_role`. That
-- grant belongs to group 0121, the door is shared with the terminal path, and
-- roughly two dozen integration fixtures reach it. Narrowing another group's
-- grant surface as a side effect of adding a role is precisely the kind of edit
-- `0189` argues against; if that grant should be narrowed, it is its own
-- decision with its own evidence. What this group guarantees is that the Hub
-- pairing SERVICE needs no such privilege.
--
-- `evaluate_hub_claim_code_v1` is different: 0191 created that grant, this
-- chain owns it, and nothing else calls it. It is narrowed to the composition
-- identity here.

begin;

-- Ownership borrow, same as groups 0125-0191: the applying role is not a member
-- of the NOLOGIN definer owners. Handed back at the end of this file.
do $borrow$
begin
  execute format('grant kitluy_activation_governor to %I', current_user);
end
$borrow$;

-- -----------------------------------------------------------------------------
-- 1. The composition identity (the 0127/0172 pattern).
-- -----------------------------------------------------------------------------
do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'kitluy_hub_pairing_service') then
    create role kitluy_hub_pairing_service nologin;
  end if;
end
$role$;

comment on role kitluy_hub_pairing_service is
  'Group 0192. The Store Hub pairing composition identity. NOLOGIN: assumed per transaction (SET LOCAL ROLE) by the device-registry service connecting as service_role, exactly like kitluy_provisioning_service (0172) and kitluy_fleet_service (0190). Holds EXECUTE on exactly two capabilities — the pairing-code presentation evaluator (0191) and redeem_hub_claim_v1, this group''s SECURITY DEFINER bridge to the 0121 redemption door — and NOTHING else: no table access, no internal helper, no human door, no role or policy administration. It exists because /v1/hub-pairing is a pre-credential surface whose caller is authorized by an eight-character code alone, and such a surface must never run as service_role, which holds BYPASSRLS. A grant here is never activation approval: redemption stops at awaiting_trust and activation stays fail-closed under BLK-005.';

grant kitluy_hub_pairing_service to service_role;
-- Schema USAGE only — never table privileges: name resolution for the two
-- granted functions, the same grant every runtime capability role carries.
grant usage on schema kitluy_devices to kitluy_hub_pairing_service;

-- -----------------------------------------------------------------------------
-- 2. Exactly two capabilities.
-- -----------------------------------------------------------------------------
-- 0191's grant is narrowed to the composer: this chain created it, and the
-- presentation evaluator has no other caller.
revoke all on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) from public;
revoke all on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) from anon;
revoke all on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) from authenticated;
revoke all on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text) from service_role;
grant execute on function kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text)
  to kitluy_hub_pairing_service;

-- -----------------------------------------------------------------------------
-- 2a. A definer wrapper for redemption, and why it is unavoidable.
-- -----------------------------------------------------------------------------
-- `redeem_device_claim_v1` is **NOT** a SECURITY DEFINER. It runs as its caller
-- and writes `device_claims`, `device_assignments` and `device_claim_events`
-- directly, so it only works for a caller that already holds those table
-- privileges — `service_role` (BYPASSRLS) or `postgres`. Granting EXECUTE to a
-- least-privilege role achieves nothing: the grant succeeds and the body then
-- fails on the first write.
--
-- The terminal path never met this because ITS doors are definers owned by
-- `kitluy_fleet_governor` (group 0172's header records exactly that reasoning);
-- group 0121 predates the pattern.
--
-- Three ways out, and why this is the one:
--
--   * give the pairing role table privileges — destroys the property this group
--     exists to create, and the guard below would rightly fail;
--   * make 0121's door a definer — changes a shared door with roughly two dozen
--     integration callers and the whole terminal path, as a side effect of adding
--     a role. That is a decision with its own evidence, not a footnote here;
--   * wrap it. A definer owned by `postgres` (which owns these tables and holds
--     BYPASSRLS) whose body is one call. Additive, touches nothing existing, and
--     the wrapper can be granted to exactly one role.
--
-- The wrapper adds NO authority of its own: every refusal 0121 raises propagates
-- unchanged, single-use is still enforced there, and the stop at `awaiting_trust`
-- is untouched. It is a privilege bridge, not a policy.
create or replace function kitluy_devices.redeem_hub_claim_v1(
  p_claim_token_sha256 text,
  p_presented_payload_sha256 text,
  p_device_id uuid,
  p_actor_ref text
) returns uuid
language sql
security definer
set search_path = pg_catalog, kitluy_devices, kitluy_ops, extensions
as $$
  select kitluy_devices.redeem_device_claim_v1(
           p_claim_token_sha256, p_presented_payload_sha256, p_device_id, p_actor_ref)
$$;

comment on function kitluy_devices.redeem_hub_claim_v1 is
  'Group 0192. A SECURITY DEFINER privilege bridge to redeem_device_claim_v1 (0121), which is not a definer and therefore requires its caller to hold direct table privileges. Exists so the Store Hub pairing composition can redeem a claim while holding NO table access of its own. Adds no authority: every 0121 refusal propagates unchanged, single-use is still enforced there, and redemption still stops at awaiting_trust under BLK-005. Granted to kitluy_hub_pairing_service ONLY.';

alter function kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text) owner to postgres;
revoke all on function kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text) from public;
revoke all on function kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text) from anon;
revoke all on function kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text) from authenticated;
grant execute on function kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text)
  to kitluy_hub_pairing_service;

-- 0121's own door is deliberately NOT granted to the pairing role: the grant
-- would be useless (see above) and would misrepresent the role's reach.
--
-- Revoked explicitly rather than merely omitted, because an earlier revision of
-- this group DID grant it, and a migration that only stops granting leaves the
-- old grant in place on every database that already ran it. The guard below
-- counts capabilities, so a stale grant is a hard failure rather than a quiet
-- widening — which is how this line came to exist.
revoke execute on function kitluy_devices.redeem_device_claim_v1(text, text, uuid, text)
  from kitluy_hub_pairing_service;

-- -----------------------------------------------------------------------------
-- 2b. Close a gap group 0191 left open.
-- -----------------------------------------------------------------------------
-- 0191 created `hub_claim_code_alphabet_v1` and `normalize_hub_claim_code_v1`
-- and never revoked the default, which for a function is EXECUTE to **PUBLIC** —
-- so `anon` could call them. Nothing secret escapes (one returns a constant
-- string, the other upper-cases its argument), which is exactly why it went
-- unnoticed: the guard below is what found it, not a reviewer.
--
-- They are not granted to the pairing composer, which never calls them: they are
-- invoked from INSIDE `evaluate_hub_claim_code_v1`, a SECURITY DEFINER owned by
-- `postgres`, so the definer's own privileges apply there.
--
-- `authenticated` keeps them on purpose. A Partner Portal generating a pairing
-- code should draw from the SAME 32 characters the presenter validates against,
-- and asking the database beats re-typing the alphabet into TypeScript where it
-- can drift (group 0191 exposed it as a function for precisely this reason).
revoke all on function kitluy_devices.hub_claim_code_alphabet_v1() from public;
revoke all on function kitluy_devices.hub_claim_code_alphabet_v1() from anon;
revoke all on function kitluy_devices.normalize_hub_claim_code_v1(text) from public;
revoke all on function kitluy_devices.normalize_hub_claim_code_v1(text) from anon;
grant execute on function kitluy_devices.hub_claim_code_alphabet_v1() to authenticated;
grant execute on function kitluy_devices.normalize_hub_claim_code_v1(text) to authenticated;

do $hand_back$
begin
  execute format('revoke kitluy_activation_governor from %I', current_user);
end
$hand_back$;

-- -----------------------------------------------------------------------------
-- 3. Prove the boundary on apply (non-vacuous assertions).
-- -----------------------------------------------------------------------------
do $guard$
declare
  v_extra integer;
begin
  if not exists (
    select 1 from pg_roles where rolname = 'kitluy_hub_pairing_service' and not rolcanlogin) then
    raise exception 'KLUY-MIGRATION-0192: the composition role is missing or can log in'
      using errcode = 'P0001';
  end if;

  -- Held only by service_role. PG16+ grants the creator an automatic,
  -- un-removable membership (KLREC-2026-08-07-PG16-CREATEROLE-001); any other
  -- holder is still a finding.
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
     where m.roleid = (select oid from pg_roles where rolname = 'kitluy_hub_pairing_service')
       and r.rolname <> 'service_role'
       and not (r.rolname = current_user and m.grantor <> m.member)) then
    raise exception 'KLUY-MIGRATION-0192: an unexpected role holds the pairing identity'
      using errcode = 'P0001';
  end if;

  -- A member of nothing: it cannot inherit its way to another capability.
  if exists (
    select 1 from pg_auth_members m
     where m.member = (select oid from pg_roles where rolname = 'kitluy_hub_pairing_service')) then
    raise exception 'KLUY-MIGRATION-0192: the pairing role must be a member of NOTHING'
      using errcode = 'P0001';
  end if;

  -- EXACTLY two capabilities, and no more.
  --
  -- TRIGGER functions are excluded because they are not capabilities: a
  -- `returns trigger` function raises when called outside a trigger context, so
  -- reaching one grants nothing. Group 0190's two ticket-integrity triggers carry
  -- the PUBLIC default and would otherwise be counted here — narrowing another
  -- group's grants as a side effect of adding a role is not this group's business
  -- (see the header), and counting them would make this assertion fail for a
  -- reason that is not about privilege.
  select count(*) into v_extra
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'kitluy_devices'
     and has_function_privilege('kitluy_hub_pairing_service', p.oid, 'execute')
     and p.prorettype <> 'pg_catalog.trigger'::regtype
     and p.proname not in ('evaluate_hub_claim_code_v1', 'redeem_hub_claim_v1');
  if v_extra > 0 then
    raise exception 'KLUY-MIGRATION-0192: the pairing role can execute % function(s) beyond its two capabilities', v_extra
      using errcode = 'P0001';
  end if;
  if not has_function_privilege('kitluy_hub_pairing_service', 'kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('kitluy_hub_pairing_service', 'kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0192: a required pairing grant is missing'
      using errcode = 'P0001';
  end if;

  -- The bridge must be a DEFINER owned by a role that can actually write, or it
  -- bridges nothing and redemption fails on its first statement — which is the
  -- bug this section exists to fix.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'redeem_hub_claim_v1'
       and p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres') then
    raise exception 'KLUY-MIGRATION-0192: the redemption bridge is not a definer owned by postgres'
      using errcode = 'P0001';
  end if;
  -- And it must not be reachable by a browser role.
  if has_function_privilege('anon', 'kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.redeem_hub_claim_v1(text, text, uuid, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0192: a browser-reachable role can execute the redemption bridge'
      using errcode = 'P0001';
  end if;

  -- No table reach whatsoever. This is the assertion that makes the role
  -- meaningful: without it, "least privilege" is a comment rather than a fact.
  if has_table_privilege('kitluy_hub_pairing_service', 'kitluy_devices.device_claims', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_pairing_service', 'kitluy_devices.device_claim_events', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_pairing_service', 'kitluy_devices.device_assignments', 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_hub_pairing_service', 'kitluy_devices.devices', 'SELECT,INSERT,UPDATE,DELETE') then
    raise exception 'KLUY-MIGRATION-0192: the pairing role holds direct table access'
      using errcode = 'P0001';
  end if;

  -- The presentation evaluator must no longer be reachable by the broad roles.
  -- service_role is INHERIT, so membership-aware helpers would report the
  -- composer's capability as its own (the 0127-recorded posture); the ACL itself
  -- is what must be clean, so this reads `proacl` directly.
  if exists (
    select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_hub_claim_code_v1'
       and p.proacl::text like '%service_role=X%') then
    raise exception 'KLUY-MIGRATION-0192: service_role still holds a DIRECT grant on the presentation evaluator'
      using errcode = 'P0001';
  end if;
  if has_function_privilege('anon', 'kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'kitluy_devices.evaluate_hub_claim_code_v1(uuid, text, text)', 'execute') then
    raise exception 'KLUY-MIGRATION-0192: a browser-reachable role can execute the presentation evaluator'
      using errcode = 'P0001';
  end if;

  raise notice 'KLUY-MIGRATION-0192: hub pairing composition identity applied (two capabilities, no table reach)';
end
$guard$;

commit;
