-- kitluy:group:0131
-- Migration group 0131: issuance_service_schema_usage (WS-11-T003 Step 4).
--
-- Additive. Groups 0120-0130 are COMMITTED and are NOT edited.
-- LOCAL execution only; never automatic in production (KL-INF-P1-037).
--
-- ===========================================================================
-- THE DEFECT — the named executor could never execute anything
-- ===========================================================================
-- Group 0127 created `kitluy_issuance_service` as THE named executor of the
-- governed issuance path, and groups 0127-0130 granted it EXECUTE on every
-- governed function:
--
--   prepare_device_credential_issuance_v1   record_device_credential_signature_v1
--   finalize_device_credential_issuance_v1  prepare_device_credential_renewal_v1/v2
--   register_generation_key_v1/v2           abandon_generation_key_v1
--   reserve_device_credential_renewal_v1    confirm_provider_key_activation_v1
--
-- None of them granted it USAGE on the schema those functions live in. Group
-- 0125 granted `usage, create on schema kitluy_devices` to
-- kitluy_credential_issuer and to nobody else on this path, so the ACL read:
--
--   postgres=UC  service_role=U  authenticated=U
--   kitluy_credential_issuer=UC  kitluy_activation_governor=UC
--
-- EXECUTE on a function is not sufficient to CALL it: PostgreSQL resolves
-- `kitluy_devices.<fn>` through the schema first, so every governed call made
-- as the intended role failed with:
--
--   permission denied for schema kitluy_devices
--
-- ===========================================================================
-- WHY NOBODY NOTICED
-- ===========================================================================
-- Every existing test executes as `postgres`, which is a member of
-- `service_role`, which HAS schema USAGE. The privilege inherited through that
-- membership masked the gap completely: the functions ran, the assertions
-- passed, and the role the whole design names as the executor had never once
-- executed them. The gap surfaced the first time a test did
-- `set local role kitluy_issuance_service` before calling the governed
-- reservation — which is exactly why that is now required rather than optional.
--
-- ===========================================================================
-- WHAT THIS GRANT DOES AND DOES NOT DO
-- ===========================================================================
-- USAGE lets the role RESOLVE names in the schema. It confers no table access
-- and no object creation:
--
--   * CREATE is deliberately NOT granted — the role must not create objects.
--   * No table privilege is granted, so the role still cannot insert a
--     credential, advance a generation head, or move provider-key lifecycle
--     state. Those remain the governor's, behind SECURITY DEFINER.
--   * No role membership is granted. `kitluy_issuance_service` still cannot
--     `SET ROLE kitluy_credential_issuer`; NOLOGIN was never the guarantee,
--     non-membership is (group 0125's lesson).
--
-- This restores the privilege model that groups 0127-0130 describe. It does
-- not widen it, and the hostile assertions at the bottom fail the migration if
-- it ever does.

begin;

grant usage on schema kitluy_devices to kitluy_issuance_service;

comment on role kitluy_issuance_service is
  'The named executor of the governed issuance and renewal path. NOLOGIN: assumed by the trusted issuance service, never authenticated as. Holds schema USAGE (group 0131) and EXECUTE on the governed functions — and nothing else. It cannot create objects, cannot write kitluy_devices.device_credentials, device_credential_heads, device_generation_keys or device_renewal_reservations directly, and is not a member of kitluy_credential_issuer. Under OPTION B it is inside the trusted computing base for SIGNATURE VALIDITY only (KLRISK-DEVICE-003).';

-- ===========================================================================
-- HOSTILE ASSERTIONS — the migration fails rather than widening the boundary
-- ===========================================================================
do $assert_boundary$
declare
  v_findings text[] := array[]::text[];
  v_table text;
  v_privilege text;
  v_fn text;
begin
  -- 1. The defect is actually fixed.
  if not has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'usage') then
    v_findings := v_findings || 'kitluy_issuance_service still lacks USAGE on kitluy_devices';
  end if;

  -- 2. And nothing more than the defect is fixed.
  if has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'create') then
    v_findings := v_findings || 'kitluy_issuance_service was granted CREATE on kitluy_devices';
  end if;

  -- 3. The governed tables stay unwritable by the executor. It calls the
  --    functions; it does not touch the rows they protect.
  foreach v_table in array array[
    'device_credentials', 'device_credential_heads',
    'device_generation_keys', 'device_renewal_reservations']
  loop
    foreach v_privilege in array array['insert', 'update', 'delete'] loop
      if has_table_privilege('kitluy_issuance_service',
                             format('kitluy_devices.%I', v_table), v_privilege) then
        v_findings := v_findings ||
          format('kitluy_issuance_service holds %s on kitluy_devices.%s', v_privilege, v_table);
      end if;
    end loop;
  end loop;

  -- 4. No escalation path into the governor.
  if exists (
    select 1 from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles r on r.oid = m.member
    where g.rolname = 'kitluy_credential_issuer'
      and r.rolname = 'kitluy_issuance_service'
  ) then
    v_findings := v_findings ||
      'kitluy_issuance_service is a member of kitluy_credential_issuer';
  end if;

  -- 5. Both roles stay NOLOGIN.
  if exists (
    select 1 from pg_roles
    where rolname in ('kitluy_credential_issuer', 'kitluy_issuance_service') and rolcanlogin
  ) then
    v_findings := v_findings || 'a governor or executor role became login-capable';
  end if;

  -- 6. The executor CAN reach the governed functions it is supposed to reach.
  --    A grant that fixed the schema but left EXECUTE broken would be no fix.
  foreach v_fn in array array[
    'prepare_device_credential_issuance_v1(text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'record_device_credential_signature_v1(text, text, bytea, boolean, text)',
    'finalize_device_credential_issuance_v1(text, jsonb, text)',
    'reserve_device_credential_renewal_v1(uuid, text, text, text, timestamptz, text, kitluy_devices.renewal_mode, text)',
    'register_generation_key_v2(uuid, text, text, text, integer)',
    'confirm_provider_key_activation_v1(uuid, uuid, uuid, text, text, integer, integer, text, text, text)']
  loop
    if not has_function_privilege('kitluy_issuance_service',
                                  format('kitluy_devices.%s', v_fn), 'execute') then
      v_findings := v_findings || format('kitluy_issuance_service cannot execute %s', v_fn);
    end if;
    -- 7. And PUBLIC still cannot.
    if has_function_privilege('public', format('kitluy_devices.%s', v_fn), 'execute') then
      v_findings := v_findings || format('PUBLIC can execute %s', v_fn);
    end if;
  end loop;

  -- 8. RLS is untouched.
  if exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname in ('device_credentials', 'device_credential_heads',
                        'device_renewal_reservations')
      and not (c.relrowsecurity and c.relforcerowsecurity)
  ) then
    v_findings := v_findings || 'a governed table lost RLS ENABLE+FORCE';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'MIGRATION 0131 REFUSED: % boundary finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;
end
$assert_boundary$;

commit;
