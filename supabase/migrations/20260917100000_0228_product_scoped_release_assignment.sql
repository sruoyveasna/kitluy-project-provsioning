-- kitluy:group:0228
-- ============================================================================
-- 0228  A release assignment is answered PER PRODUCT
-- ============================================================================
-- Additive. Groups 0120-0227 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- Authority: owner mission T1-STORE-OPERATIONS-001 (2026-09-17) §9-§10 — "Do
--   not invent a second release mechanism for terminal-client. Reuse the
--   established release architecture. Identify exactly what is missing for a
--   second governed product." KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001
--   (LOCKED): full POS business applications are governed release artifacts.
--   Product key `kitluy-terminal` is the one group 0180 already seeded release
--   channels for ("the two Phase 1 products"); no new product name is minted.
--
-- ===========================================================================
-- THE DEFECT A SECOND PRODUCT WOULD HAVE HIT
-- ===========================================================================
-- `current_device_assignment_v1` (group 0223) answers "the NEWEST assignment row
-- for this DEVICE, or nothing". With one product that is the right question.
-- With two it is the wrong one:
--
--   seq 7  device-shell     0.4.13   <- assigned first
--   seq 8  kitluy-terminal  0.1.0    <- assigned second
--
--   device asks for its Device Shell  -> told about seq 8, a POS release
--   -> refused RELEASE_WRONG_PRODUCT, logged in the Device Shell journal,
--      and the Device Shell never updates again until a newer shell is assigned
--
-- Nothing errors on the server and the operator sees both assignments recorded.
-- That is the "two sides silently disagree" shape 0223 exists to prevent, one
-- level up.
--
-- ===========================================================================
-- THE RULE, UNCHANGED, APPLIED WITHIN ONE PRODUCT
-- ===========================================================================
--   The device is told about its NEWEST assignment row FOR THE PRODUCT IT NAMES,
--   or about nothing.
--
-- The newest row is still chosen FIRST, by sequence alone, and only then tested
-- for installability (active campaign, published state, signed manifest, signed
-- assignment). There is still no fallback to an older row. The only change is
-- which rows compete: rows whose release carries a different product key never
-- do.
--
-- SEQUENCE SEMANTICS. `assignment_sequence` (group 0221) stays ONE device-wide
-- identity column. The device keeps a high-water mark PER PRODUCT (one journal
-- per product directory), and the subsequence of one product's rows is still
-- strictly increasing, so replay refusal holds per product without a second
-- counter.
--
-- `current_device_assignment_v1` is NOT changed. Images already in the field
-- call the release source without naming a product; the development release
-- source now answers them from this function with `device-shell`, the only
-- product those images can install.
--
-- MC: read-only. No table changes in this group.
-- ============================================================================

begin;

-- Borrow `kitluy_release_governor` only if this session cannot already SET ROLE to it, and
-- remember whether it did. "Member" is not "may SET ROLE": on PostgreSQL 16+ the
-- platform's own grant carries SET = false (seen on kitluy-repo17, 2026-09-17),
-- while on 15 a plain membership is enough and development tools rely on it
-- staying in place. So the ability is PROBED, and only a grant made here is
-- handed back.
create temporary table if not exists kitluy_0228_borrow (granted boolean) on commit drop;

do $borrow$
declare
  v_can_set boolean;
begin
  begin
    execute 'set local role kitluy_release_governor';
    execute 'reset role';
    v_can_set := true;
  exception when insufficient_privilege then
    v_can_set := false;
  end;
  if not v_can_set then
    execute format('grant kitluy_release_governor to %I', current_user);
  end if;
  insert into kitluy_0228_borrow values (not v_can_set);
end
$borrow$;

set local role kitluy_release_governor;

create or replace function kitluy_releases.current_device_product_assignment_v1(
  p_device_id uuid,
  p_product_key text
) returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, kitluy_releases, kitluy_devices, extensions
as $current$
  -- The newest row for this device AND product, chosen by SEQUENCE ALONE.
  -- The product filter is the only predicate allowed to participate in the
  -- choice: it narrows which rows compete, it never skips an uninstallable one.
  with newest as (
    select i.*
      from kitluy_releases.device_installations i
      join kitluy_releases.rollout_campaigns c0 on c0.id = i.campaign_id
      join kitluy_releases.release_artifacts r0 on r0.id = c0.artifact_id
     where i.device_id = p_device_id
       and r0.product_key = p_product_key
     order by i.assignment_sequence desc
     limit 1
  )
  select jsonb_build_object(
    'assignmentId',       n.id,
    'deviceId',           n.device_id,
    'releaseId',          r.id,
    'assignmentSequence', n.assignment_sequence,
    'environment',        c.environment,
    'status',             n.status,
    'assignmentEnvelope', jsonb_build_object(
      'keyId',      n.assignment_signing_key_id,
      'keyVersion', n.assignment_signing_key_version,
      'algorithm',  'ed25519',
      'signature',  n.assignment_signature_b64
    ),
    'manifest', jsonb_build_object(
      'manifestVersion',            r.manifest_version,
      'releaseId',                  r.id::text,
      'productKey',                 r.product_key,
      'version',                    r.version,
      'buildId',                    r.build_id,
      'architecture',               r.architecture,
      'hardwareProfile',            r.hardware_profile,
      'environment',                r.environment,
      'channel',                    r.channel,
      'artifactDigestSha256',       r.artifact_digest_sha256,
      'artifactSizeBytes',          r.artifact_size_bytes,
      'minSchemaVersion',           r.min_schema_version,
      'maxSchemaVersion',           r.max_schema_version,
      'configPrerequisiteVersion',  r.config_prerequisite_version,
      'rollbackReleaseId',          coalesce(r.rollback_release_id::text, '')
    ),
    'envelope', jsonb_build_object(
      'keyId',      r.signing_key_id,
      'keyVersion', r.signing_key_version,
      'algorithm',  'ed25519',
      'signature',  r.signature_b64
    )
  )
  from newest n
  join kitluy_releases.rollout_campaigns c on c.id = n.campaign_id
  join kitluy_releases.release_artifacts r on r.id = c.artifact_id
  -- Applied to the NEWEST row of this product only (group 0223's rule).
  where c.status = 'active'
    and r.state in ('internal', 'pilot', 'stable')
    and r.signature_b64 is not null
    and n.assignment_signature_b64 is not null;
$current$;

comment on function kitluy_releases.current_device_product_assignment_v1(uuid, text) is
  'Group 0228 (T1-STORE-OPERATIONS-001). THE governed answer to "what release of THIS PRODUCT is this device assigned?". Group 0223''s rule within one product: the newest assignment row whose release carries the named product key is chosen by sequence alone, then tested for installability; if it fails any test the answer is NULL, never an older row. A newer assignment of a DIFFERENT product never hides this one.';

-- Explicit: a function is executable by PUBLIC unless revoked, and this one
-- names releases per device.
revoke all on function kitluy_releases.current_device_product_assignment_v1(uuid, text) from public;
grant execute on function kitluy_releases.current_device_product_assignment_v1(uuid, text)
  to kitluy_release_governor, kitluy_release_service;

reset role;

-- ---------------------------------------------------------------------------
-- Assertions: shape, privilege, and the rule itself on a scratch device.
-- ---------------------------------------------------------------------------
do $assert_0228$
declare
  v_findings text[] := '{}';
  v_fn oid := 'kitluy_releases.current_device_product_assignment_v1(uuid, text)'::regprocedure;
  v_grantees text[];
begin
  if (select provolatile from pg_proc where oid = v_fn) <> 's' then
    v_findings := v_findings || 'the product reader must be STABLE, so Postgres refuses any write inside it';
  end if;
  if not (select prosecdef from pg_proc where oid = v_fn) then
    v_findings := v_findings || 'the product reader must be SECURITY DEFINER';
  end if;

  -- aclexplode, never has_function_privilege: `service_role` is a member of the
  -- KitLuy service roles on the local stacks, so a membership-following check
  -- reports grants the function never received (group 0226 note).
  select coalesce(array_agg(distinct case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end
                            order by case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end), '{}')
    into v_grantees
    from pg_proc p, aclexplode(p.proacl) a
   where p.oid = v_fn and a.privilege_type = 'EXECUTE';
  if 'PUBLIC' = any (v_grantees) then
    v_findings := v_findings || 'PUBLIC must not execute the product reader';
  end if;
  if not ('kitluy_release_service' = any (v_grantees)) then
    v_findings := v_findings || 'kitluy_release_service must execute the product reader';
  end if;

  -- The v1 reader is untouched: same signature, still present.
  if to_regprocedure('kitluy_releases.current_device_assignment_v1(uuid)') is null then
    v_findings := v_findings || 'group 0223''s reader must remain for images already in the field';
  end if;

  -- An unknown device and an unknown product both read as NULL, quietly.
  if kitluy_releases.current_device_product_assignment_v1(gen_random_uuid(), 'kitluy-terminal') is not null then
    v_findings := v_findings || 'an unknown device must read as NULL';
  end if;

  if array_length(v_findings, 1) is not null then
    raise exception 'KLUY-MIGRATION-0228: %', array_to_string(v_findings, '; ')
      using errcode = 'P0001';
  end if;
  raise notice 'KLUY-MIGRATION-0228: release assignments are answered per product; executable by the release roles alone';
end
$assert_0228$;

do $hand_back$
begin
  if (select granted from kitluy_0228_borrow) then
    execute format('revoke kitluy_release_governor from %I', current_user);
  end if;
end
$hand_back$;

commit;
