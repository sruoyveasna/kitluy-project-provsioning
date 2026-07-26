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

-- ============================================================================
-- Cycle-5 (WS-05/WS-06) RLS behavior cases for groups 0040-0070.
-- WS5-N* / WS5-P* = catalog/pricing/configuration; WS6-N* / WS6-P* =
-- customer/consent/privacy. Same harness pattern (set_config + SET LOCAL ROLE,
-- roll back after each case). KLSEC refs cite the Phase-1 security test system
-- where it maps; KBR refs cite the business-rule contract otherwise.
-- Cycle-5 fixture UUIDs (dev-fixtures.sql ..0301-..0352):
--   catalog A ..0301/..0304 | services ..0306/..0307 | prices ..0309-..0312
--   tenant B catalog ..0313 / service ..0314 / price ..0315
--   config ACTIVE ..0317 / DRAFT ..0316 / loc override ..0318 / platform ..0319
--   publication ..0320 / target ..0321 / ack ..0322 / tenant B config ..0323
--   customers C1 ..0324, C2 ..0326, dupA ..0329, dupB ..0331, tombstone ..0334,
--   tenant B customer ..0340 | merges ..0333 (open) ..0335 (completed)
--   consent grants ..0346/..0348, withdrawal ..0347 | privacy ..0351/..0352
-- ============================================================================

-- ---------------------------------------------------------------------------
-- WS5 NEGATIVE CASES (7)
-- ---------------------------------------------------------------------------

-- WS5-N1 / KLSEC-018: anonymous access to the neutral catalog is denied with
-- no row or count leakage.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from kitluy_core.catalog_items;
    if v_count > 0 then
      raise exception 'FAIL WS5-N1: anon saw % catalog rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null; -- denied outright: pass
  end;
  raise notice 'PASS WS5-N1/KLSEC-018: anon denied on kitluy_core.catalog_items';
end $$;
rollback;

-- WS5-N2 / KLSEC-018: Tenant B owner (u06) reads zero Tenant A catalog items
-- and zero Tenant A laundry services.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_items int;
  v_services int;
begin
  select count(*) into v_items from kitluy_core.catalog_items
  where digital_store_id = '00000000-0000-4000-8000-000000000015';
  select count(*) into v_services from kitluy_laundry.services
  where digital_store_id = '00000000-0000-4000-8000-000000000015';
  if v_items <> 0 or v_services <> 0 then
    raise exception 'FAIL WS5-N2: tenant B owner saw % items / % services of Tenant A', v_items, v_services;
  end if;
  raise notice 'PASS WS5-N2/KLSEC-018: cross-tenant catalog reads return zero rows';
end $$;
rollback;

-- WS5-N3 / KLSEC-019: Tenant B owner reads zero Tenant A price rows and zero
-- Tenant A configuration versions.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_prices int;
  v_config int;
begin
  select count(*) into v_prices from kitluy_laundry.service_prices
  where digital_store_id = '00000000-0000-4000-8000-000000000015';
  select count(*) into v_config from kitluy_config.configuration_versions
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  if v_prices <> 0 or v_config <> 0 then
    raise exception 'FAIL WS5-N3: tenant B owner saw % prices / % config rows of Tenant A', v_prices, v_config;
  end if;
  raise notice 'PASS WS5-N3/KLSEC-019: cross-tenant price and configuration reads return zero rows';
end $$;
rollback;

-- WS5-N4 / KLSEC-024: an authenticated client INSERT into the price book is
-- denied (writes are RPC-only; no INSERT policy or grant exists).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    insert into kitluy_laundry.service_prices
      (tenant_id, service_id, digital_store_id, currency_code, pricing_mode,
       unit_price_minor, effective_from, version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000306',
       '00000000-0000-4000-8000-000000000015', 'KHR', 'FIXED', 1, now(), 99);
    raise exception 'FAIL WS5-N4: client INSERT into service_prices was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS5-N4/KLSEC-024: client writes to the price book fail closed';
end $$;
rollback;

-- WS5-N5 / KLSEC-036 analog (KBR-PRC-008): price version rows are immutable —
-- the service path cannot rewrite a published price; corrections publish a
-- higher version.
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_laundry.service_prices
       set unit_price_minor = 9999
     where id = '00000000-0000-4000-8000-000000000309';
    raise exception 'FAIL WS5-N5: service path rewrote a published price version';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS5-N5/KLSEC-036: service_prices version rows are append-only';
end $$;
rollback;

-- WS5-N6 / KLSEC-036 (KBR-CFG-001/008): a published configuration snapshot is
-- immutable — payload tampering on the ACTIVE version is rejected; corrections
-- publish a higher version.
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_config.configuration_versions
       set payload = '{"layout": "tampered"}'
     where id = '00000000-0000-4000-8000-000000000317';
    raise exception 'FAIL WS5-N6: ACTIVE configuration snapshot was mutated';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS5-N6/KLSEC-036: published configuration snapshots are immutable';
end $$;
rollback;

-- WS5-N7 (KBR-PRC-002 TV2): two same-priority price rows with overlapping
-- effective ranges are ambiguous and rejected by the exclusion constraint.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_laundry.service_prices
      (tenant_id, service_id, digital_store_id, store_location_id, currency_code,
       pricing_mode, unit_price_minor, effective_from, version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000306',
       '00000000-0000-4000-8000-000000000015', null, 'KHR', 'PER_PIECE', 2100,
       '2026-08-01T00:00:00Z', 2);
    raise exception 'FAIL WS5-N7: ambiguous overlapping price row was accepted';
  exception
    when exclusion_violation then
      null;
  end;
  raise notice 'PASS WS5-N7/KBR-PRC-002: ambiguous same-layer price overlap rejected';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS5 POSITIVE CASES (7)
-- ---------------------------------------------------------------------------

-- WS5-P1 (control for WS5-N2): partner owner reads own neutral catalog and
-- translations; the Tenant B item stays invisible.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_items int;
  v_foreign int;
  v_translations int;
begin
  select count(*) into v_items from kitluy_core.catalog_items;
  select count(*) into v_foreign from kitluy_core.catalog_items
  where id = '00000000-0000-4000-8000-000000000313';
  select count(*) into v_translations from kitluy_core.catalog_item_translations;
  if v_items <> 2 or v_foreign <> 0 or v_translations < 3 then
    raise exception 'FAIL WS5-P1: owner catalog read wrong (items=%, foreign=%, translations=%)',
      v_items, v_foreign, v_translations;
  end if;
  raise notice 'PASS WS5-P1: owner reads own neutral catalog; foreign item invisible';
end $$;
rollback;

-- WS5-P2: store manager reads the Laundry extension — per-piece and per-weight
-- services and the add-on, all via the neutral catalog root.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000003", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_piece int;
  v_weight int;
  v_addons int;
begin
  select count(*) into v_piece from kitluy_laundry.services
  where 'PER_PIECE' = any (pricing_modes);
  select count(*) into v_weight from kitluy_laundry.services
  where 'PER_WEIGHT' = any (pricing_modes);
  select count(*) into v_addons from kitluy_laundry.service_addons;
  if v_piece < 1 or v_weight < 1 or v_addons < 1 then
    raise exception 'FAIL WS5-P2: laundry extension read wrong (piece=%, weight=%, addons=%)',
      v_piece, v_weight, v_addons;
  end if;
  raise notice 'PASS WS5-P2: per-piece and per-weight Laundry services readable via neutral catalog';
end $$;
rollback;

-- WS5-P3 (money contract): owner reads KHR and USD price-book rows stored as
-- exact integer minor units (KHR 2000 riel, USD 50 cents — never floats).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_khr bigint;
  v_usd bigint;
begin
  select unit_price_minor into v_khr from kitluy_laundry.service_prices
  where id = '00000000-0000-4000-8000-000000000309' and currency_code = 'KHR';
  select unit_price_minor into v_usd from kitluy_laundry.service_prices
  where id = '00000000-0000-4000-8000-000000000311' and currency_code = 'USD';
  if v_khr is distinct from 2000 or v_usd is distinct from 50 then
    raise exception 'FAIL WS5-P3: minor-unit values wrong (KHR=%, USD=%)', v_khr, v_usd;
  end if;
  raise notice 'PASS WS5-P3: KHR and USD price books hold exact integer minor units';
end $$;
rollback;

-- WS5-P4 (KBR-PRC-002 TV1 data): location staff reads both the Digital-Store
-- base price row and the higher-precedence Location override row.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_base bigint;
  v_override bigint;
begin
  select unit_price_minor into v_base from kitluy_laundry.service_prices
  where id = '00000000-0000-4000-8000-000000000309';
  select unit_price_minor into v_override from kitluy_laundry.service_prices
  where id = '00000000-0000-4000-8000-000000000312'
    and store_location_id = '00000000-0000-4000-8000-000000000018';
  if v_base is distinct from 2000 or v_override is distinct from 2500 then
    raise exception 'FAIL WS5-P4: price layers wrong (base=%, override=%)', v_base, v_override;
  end if;
  raise notice 'PASS WS5-P4: store base and Location override price layers both readable';
end $$;
rollback;

-- WS5-P5 (KBR-CFG canonical states): owner reads the DRAFT candidate, the
-- ACTIVE published snapshot and the ACTIVE Location-scope override with
-- deterministic precedence values.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_draft int;
  v_active int;
  v_loc int;
begin
  select count(*) into v_draft from kitluy_config.configuration_versions
  where id = '00000000-0000-4000-8000-000000000316' and status = 'DRAFT' and precedence = 2;
  select count(*) into v_active from kitluy_config.configuration_versions
  where id = '00000000-0000-4000-8000-000000000317' and status = 'ACTIVE' and precedence = 2;
  select count(*) into v_loc from kitluy_config.configuration_versions
  where id = '00000000-0000-4000-8000-000000000318' and status = 'ACTIVE' and precedence = 3;
  if v_draft <> 1 or v_active <> 1 or v_loc <> 1 then
    raise exception 'FAIL WS5-P5: config lineage wrong (draft=%, active=%, loc=%)', v_draft, v_active, v_loc;
  end if;
  raise notice 'PASS WS5-P5: draft + published snapshots with canonical states and precedence readable';
end $$;
rollback;

-- WS5-P6 (KBR-CFG-004/006): owner reads the exactly-once publication, its
-- per-target state and the acknowledgement evidence through the scope chain.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_pub int;
  v_target int;
  v_ack int;
begin
  select count(*) into v_pub from kitluy_config.configuration_publications
  where id = '00000000-0000-4000-8000-000000000320'
    and idempotency_key = 'PUB-DEMO-0001' and publication_kind = 'PUBLISH';
  select count(*) into v_target from kitluy_config.configuration_targets
  where id = '00000000-0000-4000-8000-000000000321' and status = 'ACTIVE';
  select count(*) into v_ack from kitluy_config.configuration_acknowledgements
  where id = '00000000-0000-4000-8000-000000000322' and result = 'ACTIVE';
  if v_pub <> 1 or v_target <> 1 or v_ack <> 1 then
    raise exception 'FAIL WS5-P6: publication chain wrong (pub=%, target=%, ack=%)', v_pub, v_target, v_ack;
  end if;
  raise notice 'PASS WS5-P6: publication, target state and acknowledgement truth readable in scope';
end $$;
rollback;

-- WS5-P7 (control for platform-scope config): the HET admin context holding
-- configuration.read sees the platform-scope snapshot; a Partner without the
-- permission does not.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_config.configuration_versions
  where id = '00000000-0000-4000-8000-000000000319';
  if v_count <> 0 then
    raise exception 'FAIL WS5-P7: partner without configuration.read saw the platform config row';
  end if;
end $$;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000001", "role": "authenticated"}', true);
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_config.configuration_versions
  where id = '00000000-0000-4000-8000-000000000319' and scope_type = 'platform';
  if v_count <> 1 then
    raise exception 'FAIL WS5-P7: configuration.read context cannot read the platform config row';
  end if;
  raise notice 'PASS WS5-P7: platform-scope configuration gated by configuration.read';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS6 NEGATIVE CASES (10)
-- ---------------------------------------------------------------------------

-- WS6-N1 / KLSEC-018: anonymous access to customer identity is denied.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from kitluy_core.customers;
    if v_count > 0 then
      raise exception 'FAIL WS6-N1: anon saw % customer rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS6-N1/KLSEC-018: anon denied on kitluy_core.customers';
end $$;
rollback;

-- WS6-N2 / KLSEC-018: Tenant B owner reads zero Tenant A customers and zero
-- Tenant A contact identifiers (no PII leak, no metadata leak).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_customers int;
  v_contacts int;
begin
  select count(*) into v_customers from kitluy_core.customers
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  select count(*) into v_contacts from kitluy_core.customer_contacts
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  if v_customers <> 0 or v_contacts <> 0 then
    raise exception 'FAIL WS6-N2: tenant B owner saw % customers / % contacts of Tenant A', v_customers, v_contacts;
  end if;
  raise notice 'PASS WS6-N2/KLSEC-018: cross-tenant customer identity reads return zero rows';
end $$;
rollback;

-- WS6-N3 / KLSEC-003: a suspended membership (u05) resolves an empty tenant
-- set and reads zero customers even with a live session.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000005", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_core.customers;
  if v_count <> 0 then
    raise exception 'FAIL WS6-N3: suspended membership saw % customer rows', v_count;
  end if;
  raise notice 'PASS WS6-N3/KLSEC-003: suspended membership reads zero customer rows';
end $$;
rollback;

-- WS6-N4 (KBR-CUS-001 identifier uniqueness): a second ACTIVE identifier with
-- the same tenant/type/normalized value is rejected even on the service path.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_core.customer_contacts
      (tenant_id, customer_id, type, normalized_value, status)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000326',
       'PHONE', '+85512345678', 'ACTIVE');
    raise exception 'FAIL WS6-N4: duplicate ACTIVE identifier was accepted';
  exception
    when unique_violation then
      null;
  end;
  raise notice 'PASS WS6-N4/KBR-CUS-001: duplicate ACTIVE identifier rejected (partial unique)';
end $$;
rollback;

-- WS6-N5 / KLSEC-024: an authenticated client INSERT into customers is denied
-- (identity writes are RPC-only; client-supplied tenant ids widen nothing).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    insert into kitluy_core.customers (tenant_id, display_name)
    values ('00000000-0000-4000-8000-000000000011', 'client-side insert probe');
    raise exception 'FAIL WS6-N5: client INSERT into customers was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS6-N5/KLSEC-024: client writes to customer identity fail closed';
end $$;
rollback;

-- WS6-N6 (KBR-CUS-003 same-tenant precondition): a merge request pairing a
-- Tenant A survivor with a Tenant B customer is rejected by the composite FK.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_core.customer_merge_requests
      (tenant_id, surviving_customer_id, merging_customer_id, status, requested_by)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000324',
       '00000000-0000-4000-8000-000000000340', 'REQUESTED',
       '00000000-0000-4000-8000-000000000007');
    raise exception 'FAIL WS6-N6: cross-tenant merge request was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS6-N6/KBR-CUS-003: cross-tenant merge blocked by child-cannot-escape FK';
end $$;
rollback;

-- WS6-N7 / KLSEC-026 analog: a merge request whose reviewer equals its
-- requester is rejected by the database CHECK regardless of caller.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_core.customer_merge_requests
      (tenant_id, surviving_customer_id, merging_customer_id, status,
       requested_by, reviewed_by)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000326',
       '00000000-0000-4000-8000-000000000331', 'APPROVED',
       '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007');
    raise exception 'FAIL WS6-N7: self-reviewed merge request was accepted';
  exception
    when check_violation then
      null;
  end;
  raise notice 'PASS WS6-N7/KLSEC-026: merge requester cannot review own request';
end $$;
rollback;

-- WS6-N8 / KLSEC-036 (KBR-CUS-004): consent grant evidence cannot be mutated —
-- the service path UPDATE is rejected by the append-only guard.
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_core.consent_grants
       set evidence_ref = 'tampered'
     where id = '00000000-0000-4000-8000-000000000346';
    raise exception 'FAIL WS6-N8: consent grant evidence was mutated';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS6-N8/KLSEC-036: consent grants are append-only evidence';
end $$;
rollback;

-- WS6-N9 / KLSEC-036 (KBR-CUS-004): a withdrawal can never be destructively
-- removed; grant AND withdrawal both remain after the attempt.
begin;
set local role service_role;
do $$
declare
  v_grant int;
  v_withdrawal int;
begin
  begin
    delete from kitluy_core.consent_withdrawals
     where id = '00000000-0000-4000-8000-000000000347';
    raise exception 'FAIL WS6-N9: consent withdrawal was destructively removed';
  exception
    -- Defense in depth: the service path holds no DELETE grant (privilege
    -- denial fires first); the enforce_append_only trigger is the second
    -- layer. Either rejection is a pass.
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  select count(*) into v_grant from kitluy_core.consent_grants
  where id = '00000000-0000-4000-8000-000000000346';
  select count(*) into v_withdrawal from kitluy_core.consent_withdrawals
  where id = '00000000-0000-4000-8000-000000000347';
  if v_grant <> 1 or v_withdrawal <> 1 then
    raise exception 'FAIL WS6-N9: consent history incomplete (grant=%, withdrawal=%)', v_grant, v_withdrawal;
  end if;
  raise notice 'PASS WS6-N9/KLSEC-036: withdrawal preserved; grant preserved (append-only pair)';
end $$;
rollback;

-- WS6-N10 / KLSEC-018: Tenant B owner sees zero Tenant A consent grants,
-- privacy requests and privacy decisions.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_grants int;
  v_requests int;
  v_decisions int;
begin
  select count(*) into v_grants from kitluy_core.consent_grants
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  select count(*) into v_requests from kitluy_core.privacy_requests
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  select count(*) into v_decisions from kitluy_core.privacy_request_decisions;
  if v_grants <> 0 or v_requests <> 0 or v_decisions <> 0 then
    raise exception 'FAIL WS6-N10: tenant B owner saw consent/privacy rows (%/%/%)',
      v_grants, v_requests, v_decisions;
  end if;
  raise notice 'PASS WS6-N10/KLSEC-018: cross-tenant consent and privacy records invisible';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS6 POSITIVE CASES (9)
-- ---------------------------------------------------------------------------

-- WS6-P1 (control for WS6-N2): partner owner reads own customers, including
-- the Cambodian-phone-only customer (E.164 phone, NO email identifier).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_customers int;
  v_phone int;
  v_email int;
begin
  select count(*) into v_customers from kitluy_core.customers;
  select count(*) into v_phone from kitluy_core.customer_contacts
  where customer_id = '00000000-0000-4000-8000-000000000324'
    and type = 'PHONE' and normalized_value like '+855%';
  select count(*) into v_email from kitluy_core.customer_contacts
  where customer_id = '00000000-0000-4000-8000-000000000324' and type = 'EMAIL';
  if v_customers <> 5 or v_phone <> 1 or v_email <> 0 then
    raise exception 'FAIL WS6-P1: phone-first identity wrong (customers=%, phone=%, email=%)',
      v_customers, v_phone, v_email;
  end if;
  raise notice 'PASS WS6-P1: phone-only Cambodian customer readable; email optional everywhere';
end $$;
rollback;

-- WS6-P2 (KBR-CUS-001/005): the normalized E.164 value, the preserved entered
-- form and the masked display column are three separate facts.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  r record;
begin
  select normalized_value, display_value, masked_value, verified_at into r
  from kitluy_core.customer_contacts
  where id = '00000000-0000-4000-8000-000000000325';
  if r.normalized_value is distinct from '+85512345678'
     or r.display_value is distinct from '012 345 678'
     or r.masked_value is null
     or r.masked_value = r.normalized_value
     or r.verified_at is null then
    raise exception 'FAIL WS6-P2: identifier columns wrong (%/%/%)',
      r.normalized_value, r.display_value, r.masked_value;
  end if;
  raise notice 'PASS WS6-P2: normalized, entered and masked identifier columns are separate';
end $$;
rollback;

-- WS6-P3 (KBR-CUS-001 TV2): the duplicate-candidate pair coexists (one ACTIVE
-- verified, one UNVERIFIED) with an OPEN merge request — never auto-merged.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_pair int;
  v_open int;
begin
  select count(*) into v_pair from kitluy_core.customer_contacts
  where normalized_value = '+85511223344';
  select count(*) into v_open from kitluy_core.customer_merge_requests
  where id = '00000000-0000-4000-8000-000000000333'
    and status = 'REQUESTED' and reviewed_by is null;
  if v_pair <> 2 or v_open <> 1 then
    raise exception 'FAIL WS6-P3: dup-candidate state wrong (pair=%, open=%)', v_pair, v_open;
  end if;
  raise notice 'PASS WS6-P3: duplicate candidates coexist under review; no auto-merge';
end $$;
rollback;

-- WS6-P4 (KBR-CUS-003): completed merge preserved the losing record as a
-- tombstone with full append-only history — no destructive delete.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_tombstone int;
  v_result int;
  v_history int;
begin
  select count(*) into v_tombstone from kitluy_core.customers
  where id = '00000000-0000-4000-8000-000000000334'
    and status = 'MERGED'
    and merged_into_customer_id = '00000000-0000-4000-8000-000000000324';
  select count(*) into v_result from kitluy_core.customer_merge_results
  where merge_request_id = '00000000-0000-4000-8000-000000000335';
  select count(*) into v_history from kitluy_core.customer_status_history
  where customer_id = '00000000-0000-4000-8000-000000000334'
    and from_status = 'ACTIVE' and to_status = 'MERGED';
  if v_tombstone <> 1 or v_result <> 1 or v_history <> 1 then
    raise exception 'FAIL WS6-P4: merge history wrong (tombstone=%, result=%, history=%)',
      v_tombstone, v_result, v_history;
  end if;
  raise notice 'PASS WS6-P4: losing record survives as tombstone with merge result and status history';
end $$;
rollback;

-- WS6-P5 (control for WS6-N7): a DISTINCT reviewer satisfies the merge CHECK —
-- the seeded completed merge has reviewer <> requester, and a fresh
-- distinct-reviewer request is accepted (rolled back).
begin;
set local role service_role;
do $$
declare
  v_seeded int;
begin
  select count(*) into v_seeded from kitluy_core.customer_merge_requests
  where id = '00000000-0000-4000-8000-000000000335'
    and requested_by = '00000000-0000-4000-8000-000000000007'
    and reviewed_by = '00000000-0000-4000-8000-000000000008';
  if v_seeded <> 1 then
    raise exception 'FAIL WS6-P5: seeded distinct-reviewer merge request missing';
  end if;
  insert into kitluy_core.customer_merge_requests
    (tenant_id, surviving_customer_id, merging_customer_id, status,
     requested_by, reviewed_by)
  values
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000326',
     '00000000-0000-4000-8000-000000000329', 'APPROVED',
     '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000008');
  raise notice 'PASS WS6-P5: distinct requester/reviewer merge requests pass the CHECK';
end $$;
rollback;

-- WS6-P6 (KBR-CUS-004): marketing consent was granted THEN withdrawn — both
-- append-only records readable; the withdrawal references and preserves the
-- grant; the derived state is withdrawn.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_grant int;
  v_withdrawal int;
begin
  select count(*) into v_grant from kitluy_core.consent_grants
  where id = '00000000-0000-4000-8000-000000000346';
  select count(*) into v_withdrawal from kitluy_core.consent_withdrawals
  where consent_grant_id = '00000000-0000-4000-8000-000000000346';
  if v_grant <> 1 or v_withdrawal <> 1 then
    raise exception 'FAIL WS6-P6: consent lineage wrong (grant=%, withdrawal=%)', v_grant, v_withdrawal;
  end if;
  raise notice 'PASS WS6-P6: withdrawal recorded beside the intact grant (state never a mutable boolean)';
end $$;
rollback;

-- WS6-P7 (cycle section 10): communication classes are SEPARATE — marketing is
-- withdrawn while the transactional pickup notice stays granted.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_txn_untouched int;
  v_mkt_pref text;
  v_txn_pref text;
begin
  select count(*) into v_txn_untouched from kitluy_core.consent_grants g
  where g.id = '00000000-0000-4000-8000-000000000348'
    and not exists (
      select 1 from kitluy_core.consent_withdrawals w where w.consent_grant_id = g.id
    );
  select state into v_mkt_pref from kitluy_notifications.preferences
  where id = '00000000-0000-4000-8000-000000000349' and event_family = 'MARKETING';
  select state into v_txn_pref from kitluy_notifications.preferences
  where id = '00000000-0000-4000-8000-000000000350' and event_family = 'TRANSACTIONAL';
  if v_txn_untouched <> 1
     or v_mkt_pref is distinct from 'WITHDRAWN'
     or v_txn_pref is distinct from 'GRANTED' then
    raise exception 'FAIL WS6-P7: classes bled (txn_grant=%, mkt=%, txn=%)',
      v_txn_untouched, v_mkt_pref, v_txn_pref;
  end if;
  raise notice 'PASS WS6-P7: marketing withdrawal never suppresses the transactional class';
end $$;
rollback;

-- WS6-P8 (KBR-CUS-006): the privacy export request and its verified decision
-- are readable append-only records in tenant scope.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_request int;
  v_decision int;
begin
  select count(*) into v_request from kitluy_core.privacy_requests
  where id = '00000000-0000-4000-8000-000000000351' and request_type = 'EXPORT';
  select count(*) into v_decision from kitluy_core.privacy_request_decisions
  where id = '00000000-0000-4000-8000-000000000352' and decision = 'VERIFIED';
  if v_request <> 1 or v_decision <> 1 then
    raise exception 'FAIL WS6-P8: privacy case wrong (request=%, decision=%)', v_request, v_decision;
  end if;
  raise notice 'PASS WS6-P8: privacy export request and decision readable as append-only records';
end $$;
rollback;

-- WS6-P9: the customer/Digital-Store relationship and the customer status
-- history are readable in tenant scope.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_rel int;
  v_history int;
begin
  select count(*) into v_rel from kitluy_core.customer_store_relationships
  where customer_id = '00000000-0000-4000-8000-000000000324'
    and digital_store_id = '00000000-0000-4000-8000-000000000015'
    and status = 'ACTIVE';
  select count(*) into v_history from kitluy_core.customer_status_history;
  if v_rel <> 1 or v_history < 2 then
    raise exception 'FAIL WS6-P9: relationship/history wrong (rel=%, history=%)', v_rel, v_history;
  end if;
  raise notice 'PASS WS6-P9: store relationship and status history readable in tenant scope';
end $$;
rollback;

select 'rls-tests complete: 14+9 baseline cases; cycle-5 WS5 7 negative + 7 positive and WS6 10 negative + 9 positive cases executed' as result;
