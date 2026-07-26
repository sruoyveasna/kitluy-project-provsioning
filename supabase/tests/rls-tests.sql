-- ============================================================================
-- KitLuy RLS behavior tests for migration groups 0010-0035.
-- REQUIRES A LOCAL SUPABASE STACK — execution is BLOCKED (BLK-002: Docker and
-- the Supabase CLI are absent). Authored for future execution via `pnpm db:test`
-- after `pnpm db:reset` + `pnpm db:seed` (supabase/seed/dev-fixtures.sql).
-- No execution result is claimed until this file actually runs.
--
-- Harness pattern: RLS test pack section 6 (transaction-scoped simulated JWT
-- claims via set_config + SET LOCAL ROLE; roll back after each case; never run
-- destructive probes against production).
-- Case ids: RLS-0NN from kitluy-rls-and-tenant-isolation-test-pack-v1.0.0.md;
-- KLSEC-0NN from kitluy-phase1-security-test-system-v1.0.0.md.
-- Fixture UUIDs come from supabase/seed/dev-fixtures.sql:
--   u01 HET admin ..0001 | u02 partner owner ..0002 | u03 store manager ..0003
--   u04 cashier ..0004 | u05 suspended member ..0005 | u06 tenant B owner ..0006
--   u07 approval requester ..0007 | u08 approver ..0008
--   u09 location-scoped staff ..0009 | u10 store-scoped staff ..0010
--   tenant A ..0011 | tenant B ..0012 | store ds01 ..0015 | ds02 ..0016
--   loc01 ..0018 | loc02 ..0019 | approval request ..0051
-- ============================================================================

-- ---------------------------------------------------------------------------
-- NEGATIVE CASES (cycle instruction 10.1)
-- ---------------------------------------------------------------------------

-- Case RLS-001 / KLSEC-018: anonymous access to a tenant table is denied
-- with no row or count leakage.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from kitluy_core.tenants;
    if v_count > 0 then
      raise exception 'FAIL RLS-001: anon saw % tenant rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null; -- denied outright: pass
  end;
  raise notice 'PASS RLS-001/KLSEC-018: anon denied on kitluy_core.tenants (zero rows, zero leak)';
end $$;
rollback;

-- Case RLS-002 / KLSEC-018: authenticated user with no membership resolves an
-- empty tenant set and reads zero rows.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000099", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  if coalesce(array_length(kitluy_auth.current_tenant_ids(), 1), 0) <> 0 then
    raise exception 'FAIL RLS-002: stranger resolved a non-empty tenant set';
  end if;
  select count(*) into v_count from kitluy_core.tenants;
  if v_count <> 0 then
    raise exception 'FAIL RLS-002: stranger saw % tenant rows', v_count;
  end if;
  raise notice 'PASS RLS-002/KLSEC-018: no-membership user denied everywhere';
end $$;
rollback;

-- Case RLS-003 / KLSEC-018: Tenant A user reading a Tenant B primary key gets
-- zero rows (generic not-found; no metadata leak).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_core.tenants
  where id = '00000000-0000-4000-8000-000000000012';
  if v_count <> 0 then
    raise exception 'FAIL RLS-003: Tenant A user read the Tenant B row';
  end if;
  select count(*) into v_count from kitluy_core.partner_accounts
  where tenant_id = '00000000-0000-4000-8000-000000000012';
  if v_count <> 0 then
    raise exception 'FAIL RLS-003: Tenant A user read Tenant B partner account';
  end if;
  raise notice 'PASS RLS-003/KLSEC-018: cross-tenant primary-key read returns zero rows';
end $$;
rollback;

-- Case RLS-004 / KLSEC-024: Tenant A INSERT carrying Tenant B tenant_id fails;
-- no business row is created (writes are RPC-only; no INSERT policy/grant).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    insert into kitluy_core.memberships (tenant_id, user_id, status)
    values ('00000000-0000-4000-8000-000000000012',
            '00000000-0000-4000-8000-000000000002', 'ACTIVE');
    raise exception 'FAIL RLS-004: cross-tenant INSERT was accepted';
  exception
    when insufficient_privilege then
      null; -- pass: denied before any row
  end;
  raise notice 'PASS RLS-004/KLSEC-024: client-supplied foreign tenant_id cannot widen authority';
end $$;
rollback;

-- Case RLS-005 / KLSEC-018: Tenant A UPDATE of a Tenant B row is denied.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    update kitluy_core.partner_accounts
       set contact_name = 'intruder'
     where tenant_id = '00000000-0000-4000-8000-000000000012';
    raise exception 'FAIL RLS-005: cross-tenant UPDATE was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS RLS-005/KLSEC-018: cross-tenant UPDATE denied; original row untouched';
end $$;
rollback;

-- Case RLS-006 / KLSEC-018: Tenant A DELETE of a Tenant B row is denied
-- (DELETE is prohibited for client roles on every group table).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    delete from kitluy_core.partner_accounts
     where tenant_id = '00000000-0000-4000-8000-000000000012';
    raise exception 'FAIL RLS-006: cross-tenant DELETE was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS RLS-006/KLSEC-018: DELETE denied (prohibited for client roles)';
end $$;
rollback;

-- Case RLS-007 / KLSEC-020: Location-scoped staff (u09, scoped to loc01) cannot
-- read the sibling Location loc02.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_own int;
  v_sibling int;
begin
  select count(*) into v_own from kitluy_core.store_locations
  where id = '00000000-0000-4000-8000-000000000018';
  select count(*) into v_sibling from kitluy_core.store_locations
  where id = '00000000-0000-4000-8000-000000000019';
  if v_own <> 1 then
    raise exception 'FAIL RLS-007: location-scoped staff cannot read own Location (positive control broken)';
  end if;
  if v_sibling <> 0 then
    raise exception 'FAIL RLS-007: location-scoped staff read the sibling Location';
  end if;
  raise notice 'PASS RLS-007/KLSEC-020: Location scope excludes sibling Locations';
end $$;
rollback;

-- Case RLS-008 / KLSEC-019: Digital-Store-scoped staff (u10, scoped to ds01)
-- cannot read the sibling Store ds02 of the same Tenant.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_own int;
  v_sibling int;
begin
  select count(*) into v_own from kitluy_core.digital_stores
  where id = '00000000-0000-4000-8000-000000000015';
  select count(*) into v_sibling from kitluy_core.digital_stores
  where id = '00000000-0000-4000-8000-000000000016';
  if v_own <> 1 then
    raise exception 'FAIL RLS-008: store-scoped staff cannot read own Store (positive control broken)';
  end if;
  if v_sibling <> 0 then
    raise exception 'FAIL RLS-008: store-scoped staff read a sibling Store of the same Tenant';
  end if;
  raise notice 'PASS RLS-008/KLSEC-019: Store scope excludes sibling Stores';
end $$;
rollback;

-- Case RLS-011 / KLSEC-003 and RLS-012: suspended membership (u05) is denied on
-- tenant and store surfaces even with a live session.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_tenants int;
  v_stores int;
begin
  select count(*) into v_tenants from kitluy_core.tenants;
  select count(*) into v_stores from kitluy_core.digital_stores;
  if v_tenants <> 0 or v_stores <> 0 then
    raise exception 'FAIL RLS-011/RLS-012: suspended membership saw % tenants, % stores', v_tenants, v_stores;
  end if;
  raise notice 'PASS RLS-011+RLS-012/KLSEC-003: suspended membership resolves empty scope';
end $$;
rollback;

-- Case RLS-021 / KLSEC-026: four-eyes self-approval is rejected by the database
-- (trigger comparison of approver vs approval_requests.requester), regardless of
-- caller privileges.
begin;
do $$
begin
  begin
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision, reason)
    values ('00000000-0000-4000-8000-000000000051',
            '00000000-0000-4000-8000-000000000007', 'APPROVED', 'self-approval attempt');
    raise exception 'FAIL RLS-021: requester approved their own request';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-SELF-APPROVAL-DENIED%' then
        raise;
      end if;
  end;
  raise notice 'PASS RLS-021/KLSEC-026: DB-enforced four-eyes rejects self-approval';
end $$;
rollback;

-- Case KLSEC-036 (audit append-only; RLS spec 5.21): UPDATE on audit evidence is
-- rejected for the service path by the enforce_append_only trigger, and for
-- authenticated by the missing grant/policy.
begin;
set local role service_role;
do $$
declare
  v_id uuid;
begin
  insert into kitluy_audit.audit_logs (actor_type, action, environment)
  values ('system', 'demo.append_only_probe', 'local')
  returning id into v_id;
  begin
    update kitluy_audit.audit_logs set reason = 'tamper' where id = v_id;
    raise exception 'FAIL KLSEC-036: audit_logs UPDATE succeeded for service path';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS KLSEC-036: audit_logs is append-only (trigger rejects UPDATE)';
end $$;
rollback;

begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    update kitluy_audit.audit_logs set reason = 'tamper';
    raise exception 'FAIL KLSEC-036: authenticated UPDATE on audit_logs was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS KLSEC-036: authenticated cannot UPDATE audit_logs (no grant, no policy)';
end $$;
rollback;

-- Case RLS-022 / KLSEC-022: an environment-scoped temporary grant never bleeds
-- into another environment (staging grant does not authorize production).
begin;
insert into kitluy_auth.temporary_grants
  (id, subject_id, permission_key, environment, starts_at, expires_at, reason)
values
  ('00000000-0000-4000-8000-000000000201', '00000000-0000-4000-8000-000000000009',
   'rbac.read', 'staging', now() - interval '1 hour', now() + interval '1 hour',
   'RLS-022 fixture: staging-only grant');
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  if not kitluy_auth.has_permission('rbac.read', null, null, 'staging') then
    raise exception 'FAIL RLS-022: staging grant did not authorize staging (positive control broken)';
  end if;
  if kitluy_auth.has_permission('rbac.read', null, null, 'production') then
    raise exception 'FAIL RLS-022: staging grant authorized production';
  end if;
  raise notice 'PASS RLS-022/KLSEC-022: environments never bleed (fail-closed)';
end $$;
rollback;

-- Case RLS-019: actor without an active consent/support scope sees no support
-- access session of a foreign tenant (Tenant B owner probes the Tenant A case).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_admin.support_access_sessions;
  if v_count <> 0 then
    raise exception 'FAIL RLS-019: foreign actor saw % consent session rows', v_count;
  end if;
  raise notice 'PASS RLS-019: consent-scoped support sessions hidden without scope';
end $$;
rollback;

-- Case RLS-017 (read surface): user without rbac.read cannot enumerate the
-- permission registry or role templates.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_auth.permissions;
  if v_count <> 0 then
    raise exception 'FAIL RLS-017: cashier enumerated % permission rows', v_count;
  end if;
  select count(*) into v_count from kitluy_auth.role_templates;
  if v_count <> 0 then
    raise exception 'FAIL RLS-017: cashier enumerated % role templates', v_count;
  end if;
  raise notice 'PASS RLS-017: RBAC registry hidden without rbac.read';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- POSITIVE CASES (cycle instruction 10.2) — allowed control users must succeed
-- so the negative results above cannot be false positives (test pack section 5).
-- ---------------------------------------------------------------------------

-- Positive P1 (control for RLS-003): Partner owner reads own tenant and partner
-- account.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_tenants int;
  v_accounts int;
begin
  select count(*) into v_tenants from kitluy_core.tenants
  where id = '00000000-0000-4000-8000-000000000011';
  select count(*) into v_accounts from kitluy_core.partner_accounts
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  if v_tenants <> 1 or v_accounts <> 1 then
    raise exception 'FAIL P1: partner owner could not read own tenant/account (%/%)', v_tenants, v_accounts;
  end if;
  raise notice 'PASS P1: partner owner reads own tenant and partner account';
end $$;
rollback;

-- Positive P2 (control for RLS-008): tenant-level store manager sees both Tenant A
-- stores and never the Tenant B store.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
  v_foreign int;
begin
  select count(*) into v_count from kitluy_core.digital_stores;
  select count(*) into v_foreign from kitluy_core.digital_stores
  where id = '00000000-0000-4000-8000-000000000017';
  if v_count <> 2 or v_foreign <> 0 then
    raise exception 'FAIL P2: store manager saw % stores (foreign: %)', v_count, v_foreign;
  end if;
  raise notice 'PASS P2: tenant-scoped manager sees exactly the two Tenant A stores';
end $$;
rollback;

-- Positive P3 (control for RLS-007): location staff reads its own Location and
-- the Store-to-Location activation history of its Store.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_loc int;
  v_links int;
begin
  select count(*) into v_loc from kitluy_core.store_locations
  where id = '00000000-0000-4000-8000-000000000018';
  select count(*) into v_links from kitluy_core.digital_store_location_links;
  if v_loc <> 1 then
    raise exception 'FAIL P3: location staff cannot read own Location';
  end if;
  if v_links < 1 then
    raise exception 'FAIL P3: activation history not visible to authorized staff';
  end if;
  raise notice 'PASS P3: location staff reads own Location and link history';
end $$;
rollback;

-- Positive P4: HET admin context (rbac.read / audit.read / partners.read /
-- support.ticket.manage) reads governed registries, decisions and both tenants.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_templates int;
  v_decisions int;
  v_tenants int;
  v_sessions int;
begin
  select count(*) into v_templates from kitluy_auth.role_templates;
  select count(*) into v_decisions from kitluy_auth.approval_decisions;
  select count(*) into v_tenants from kitluy_core.tenants;
  select count(*) into v_sessions from kitluy_admin.support_access_sessions;
  if v_templates < 1 then
    raise exception 'FAIL P4: rbac.read did not expose role templates';
  end if;
  if v_decisions < 1 then
    raise exception 'FAIL P4: audit.read did not expose approval decisions';
  end if;
  if v_tenants < 2 then
    raise exception 'FAIL P4: partners.read did not expose the tenant registry (saw %)', v_tenants;
  end if;
  if v_sessions < 1 then
    raise exception 'FAIL P4: support permission did not expose the consent session';
  end if;
  raise notice 'PASS P4: HET admin platform reads succeed via permission evaluation';
end $$;
rollback;

-- Positive P5 (control for RLS-021 / KLSEC-026): a DISTINCT approver decision is
-- accepted by the four-eyes trigger (seeded decision exists; a second distinct
-- approver can also decide).
begin;
do $$
declare
  v_seeded int;
begin
  select count(*) into v_seeded from kitluy_auth.approval_decisions
  where id = '00000000-0000-4000-8000-000000000052'
    and approver_id = '00000000-0000-4000-8000-000000000008';
  if v_seeded <> 1 then
    raise exception 'FAIL P5: seeded distinct-approver decision missing';
  end if;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision, reason)
  values ('00000000-0000-4000-8000-000000000051',
          '00000000-0000-4000-8000-000000000001', 'APPROVED', 'second distinct approver (test, rolled back)');
  raise notice 'PASS P5: distinct approver decisions pass the four-eyes trigger';
end $$;
rollback;

-- Positive P6: reference data (vertical registry) is readable by any
-- authenticated user — LAUNDRY comes from the reference table, not a hardcoded
-- enum.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000004", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_verticals int;
  v_laundry int;
begin
  select count(*) into v_verticals from kitluy_core.reference_values
  where registry_key = 'vertical_code';
  select count(*) into v_laundry from kitluy_core.reference_values
  where registry_key = 'vertical_code' and value_code = 'LAUNDRY' and status = 'ACTIVE';
  if v_verticals <> 8 or v_laundry <> 1 then
    raise exception 'FAIL P6: vertical registry incomplete (% rows, LAUNDRY=%)', v_verticals, v_laundry;
  end if;
  raise notice 'PASS P6: vertical reference registry readable; LAUNDRY active for Phase 1';
end $$;
rollback;

-- Positive P7 (control for RLS-019): the Partner (Tenant A owner) sees the
-- own-tenant support ticket and its consent session.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_tickets int;
  v_sessions int;
begin
  select count(*) into v_tickets from kitluy_admin.support_tickets;
  select count(*) into v_sessions from kitluy_admin.support_access_sessions;
  if v_tickets <> 1 or v_sessions <> 1 then
    raise exception 'FAIL P7: partner cannot see own support case (tickets=%, sessions=%)', v_tickets, v_sessions;
  end if;
  raise notice 'PASS P7: partner sees own-tenant support ticket and consent session';
end $$;
rollback;

-- superseded by P8/P9 additions (review RV-302):

-- Positive P8 (cycle 3 §10.2: authorized grant administration read; positive
-- control for RLS-017 which proved the registry hidden WITHOUT rbac.read):
-- the HET admin context (rbac.read) reads role_permission_grants.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  if (select count(*) from kitluy_auth.role_permission_grants) < 1 then
    raise exception 'FAIL P8/RLS-017-positive: rbac.read context cannot read permission grants';
  end if;
  raise notice 'PASS P8: authorized grant administration read (rbac.read sees role_permission_grants)';
end $$;
rollback;

-- Positive P9 (cycle 3 §10.2: time-limited support access; positive control
-- for RLS-019): the consented context reads its support_access_sessions row
-- strictly inside the consent window (starts_at <= now() < expires_at, not revoked).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  if not exists (select 1 from kitluy_admin.support_access_sessions
                 where starts_at <= now() and expires_at > now() and revoked_at is null) then
    raise exception 'FAIL P9/RLS-019-positive: in-window support access session not readable';
  end if;
  raise notice 'PASS P9: time-limited support access readable within consent window';
end $$;
rollback;

select 'rls-tests complete: 14 negative + 9 positive cases executed' as result;
