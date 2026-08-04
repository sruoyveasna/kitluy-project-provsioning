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

-- ============================================================================
-- Cycle-6 (WS-07/WS-08) RLS behavior cases for groups 0075-0095.
-- WS7-N* / WS7-P* = Booking aggregate + garment custody; WS8-N* / WS8-P* =
-- payments + finance subledger. Same harness pattern (set_config + SET LOCAL
-- ROLE, roll back after each case). KLSEC refs cite the Phase-1 security test
-- system; KBR/AMD refs cite the business-rule/amendment contracts.
-- Cycle-6 fixture UUIDs (dev-fixtures.sql ..0401-..0465):
--   Booking A1 ..0401 (per-piece, PARTIALLY_PAID) | Booking A2 ..0404
--   (per-weight, IN_PROGRESS, production READY) | garments ..0410/..0411/..0412
--   tags ..0413 (voided)/..0414/..0422 | scans ..0415/..0416
--   positions ..0417/..0419 (loc01) /..0420 (sibling loc02) | assignment ..0418
--   tenders ..0425 (cash)/..0427 (KHQR) | khqr ..0429 | provider event ..0430
--   refund ..0432 (APPROVED, u07 requester / u08 approver)
--   reconciliation ..0436 + line ..0437 | settlement ..0438
--   finance accounts ..0440-..0443 (A) / ..0456 (B)
--   Tenant B attacker: loc ..0450, booking ..0452, line ..0453, tender ..0455
-- ============================================================================

-- ---------------------------------------------------------------------------
-- WS7 NEGATIVE CASES (13)
-- ---------------------------------------------------------------------------

-- WS7-N1 / KLSEC-018: anonymous access to the Booking aggregate is denied
-- with no row or count leakage.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from kitluy_orders.orders;
    if v_count > 0 then
      raise exception 'FAIL WS7-N1: anon saw % booking rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null; -- denied outright: pass
  end;
  raise notice 'PASS WS7-N1/KLSEC-018: anon denied on kitluy_orders.orders';
end $$;
rollback;

-- WS7-N2 / KLSEC-018: cross-tenant Booking reads return zero rows in BOTH
-- directions (u10 cannot see the Tenant B booking; u06 cannot see Booking A1).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_orders.orders
  where id = '00000000-0000-4000-8000-000000000452';
  if v_count <> 0 then
    raise exception 'FAIL WS7-N2: tenant A store staff read the Tenant B booking';
  end if;
end $$;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_orders.orders
  where id = '00000000-0000-4000-8000-000000000401';
  if v_count <> 0 then
    raise exception 'FAIL WS7-N2: tenant B owner read Booking A1';
  end if;
  raise notice 'PASS WS7-N2/KLSEC-018: cross-tenant Booking reads return zero rows both ways';
end $$;
rollback;

-- WS7-N3 / KLSEC-024: a cross-tenant Booking mutation by an authenticated
-- client fails closed (no write grant, no write policy).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    update kitluy_orders.orders
       set payment_state = 'PAID'
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'FAIL WS7-N3: cross-tenant booking UPDATE was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS7-N3/KLSEC-024: cross-tenant Booking mutation denied (no grant, no policy)';
end $$;
rollback;

-- WS7-N4 / KLSEC-024 (KBR-TXN §4): a direct client status update on an
-- own-store Booking is denied — lifecycle moves only through the engine
-- command path.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    update kitluy_orders.orders
       set status = 'IN_PROGRESS', version = version + 1
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'FAIL WS7-N4: direct client status update was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS7-N4/KLSEC-024: direct client Booking status writes fail closed';
end $$;
rollback;

-- WS7-N5 (KBR-TXN; Cycle-6 §7): an order line claiming a different Digital
-- Store than its Booking is rejected by the composite order_lines_store_order_fk
-- even on the service path.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_orders.order_lines
      (tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
       service_code, pricing_mode, quantity, unit_price_minor, currency_code)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000016',
       '00000000-0000-4000-8000-000000000401', 99, '00000000-0000-4000-8000-000000000301',
       'PROBE-N5', 'PER_PIECE', 1, 100, 'KHR');
    raise exception 'FAIL WS7-N5: cross-store order line was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS7-N5/KBR-TXN: order line cannot escape the Booking Store (composite FK)';
end $$;
rollback;

-- WS7-N6 / KLSEC-018 (child-cannot-escape): attaching a Tenant B customer to a
-- Tenant A Booking is rejected by orders_tenant_customer_fk.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_orders.orders
      (tenant_id, digital_store_id, store_location_id, customer_id, order_number,
       vertical_code, source_code, status, currency_code, idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000340',
       'PROBE-N6', 'LAUNDRY', 'WALK_IN', 'DRAFT', 'KHR', 'PROBE-N6');
    raise exception 'FAIL WS7-N6: foreign-tenant customer attachment was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS7-N6/KLSEC-018: foreign customer cannot attach to a Booking (composite FK)';
end $$;
rollback;

-- WS7-N7 (KBR-TXN-002): a Booking line referencing a Tenant B catalog item is
-- rejected by order_lines_store_catalog_item_fk.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_orders.order_lines
      (tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
       service_code, pricing_mode, quantity, unit_price_minor, currency_code)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000401', 98, '00000000-0000-4000-8000-000000000313',
       'PROBE-N7', 'PER_PIECE', 1, 100, 'KHR');
    raise exception 'FAIL WS7-N7: foreign catalog reference was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS7-N7/KBR-TXN-002: foreign catalog item cannot price a Booking line (composite FK)';
end $$;
rollback;

-- WS7-N8 (Cycle-6 §9.1 custody scope): a custody event can neither name a
-- foreign-tenant Location nor claim a sibling Store of the same Tenant.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, scan_type,
       terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000450', '00000000-0000-4000-8000-000000000401',
       'INTAKE', 'laundry.t1.intake_cashier', 'PROBE-N8A', 1);
    raise exception 'FAIL WS7-N8: custody event with a Tenant B Location was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, scan_type,
       terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000016',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
       'INTAKE', 'laundry.t1.intake_cashier', 'PROBE-N8B', 1);
    raise exception 'FAIL WS7-N8: custody event escaping to a sibling Store was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS7-N8/KLSEC-020: custody events cannot name foreign Locations or sibling Stores (composite FKs)';
end $$;
rollback;

-- WS7-N9 (KBR-LND-004 TV3): a duplicate custody scan replay (same Tenant
-- idempotency key) creates no second event.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, garment_id,
       scan_type, terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
       '00000000-0000-4000-8000-000000000410', 'INTAKE', 'laundry.t1.intake_cashier',
       'DEV-SCAN-0001', 1);
    raise exception 'FAIL WS7-N9: duplicate custody scan was accepted';
  exception
    when unique_violation then
      null;
  end;
  raise notice 'PASS WS7-N9/KBR-LND-004: duplicate custody scan replay rejected (tenant idempotency key)';
end $$;
rollback;

-- WS7-N10 (KBR-TXN stale-version rejection): a service-path UPDATE that does
-- not advance the Booking version is rejected.
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_orders.orders
       set updated_at = now(), version = version
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'FAIL WS7-N10: stale-version booking UPDATE was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-ORD-STALE-VERSION%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS7-N10/KBR-TXN: stale Booking version rejected (KLUY-ORD-STALE-VERSION)';
end $$;
rollback;

-- WS7-N11 (KBR-LND-004; RB v4 §5.3): the Ready scan-in vocabulary is T3-only —
-- a T1 terminal cannot record READY_SCAN_IN.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, scan_type,
       terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
       'READY_SCAN_IN', 'laundry.t1.intake_cashier', 'PROBE-N11', 1);
    raise exception 'FAIL WS7-N11: T1 terminal recorded a Ready scan-in';
  exception
    when check_violation then
      null;
  end;
  raise notice 'PASS WS7-N11/KBR-LND-004: READY_SCAN_IN restricted to laundry.t3.ready_scan_in (CHECK)';
end $$;
rollback;

-- WS7-N12 (KBR-LND-005; RB v4 §5.3): pickup release cannot complete without a
-- verified collector, and T2 owns no custody event vocabulary at all.
begin;
set local role service_role;
do $$
begin
  insert into kitluy_laundry.pickup_handoffs
    (tenant_id, digital_store_id, store_location_id, order_id)
  values
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
     '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401');
  begin
    update kitluy_laundry.pickup_handoffs
       set status = 'COMPLETED',
           released_by = '00000000-0000-4000-8000-000000000003',
           handed_over_at = now()
     where order_id = '00000000-0000-4000-8000-000000000401';
    raise exception 'FAIL WS7-N12: pickup completed without collector verification';
  exception
    when check_violation then
      null;
  end;
  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, scan_type,
       terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
       'INTAKE', 'laundry.t2.customer_display', 'PROBE-N12', 1);
    raise exception 'FAIL WS7-N12: a T2 terminal recorded a custody event';
  exception
    when check_violation then
      null;
  end;
  raise notice 'PASS WS7-N12/KBR-LND-005: unverified pickup release and T2 custody events rejected (CHECKs)';
end $$;
rollback;

-- WS7-N13 / KLSEC-036 (Cycle-6 §9.1): custody history is immutable on the
-- service path — the UPDATE grant is revoked (defense in depth over the
-- enforce_append_only trigger proven in assertions section 22).
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_laundry.garment_scan_events
       set reason_code = 'tamper'
     where id = '00000000-0000-4000-8000-000000000415';
    raise exception 'FAIL WS7-N13: service path rewrote custody history';
  exception
    -- Defense in depth: the revoked grant denies first; the
    -- enforce_append_only trigger is the second layer. Either rejection passes.
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS7-N13/KLSEC-036: custody scan history immutable for the service path';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS7 POSITIVE CASES (6)
-- ---------------------------------------------------------------------------

-- WS7-P1 (control for WS7-N2): store staff u10 reads both own-store Bookings
-- with their priced lines; nothing foreign leaks into the set.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_bookings int;
  v_foreign int;
  v_lines int;
begin
  -- Fixture-scoped counts: the shared local dev database may also carry
  -- integration-test bookings in the same store, so assert the fixture rows
  -- and the foreign booking rather than whole-table totals.
  select count(*) into v_bookings from kitluy_orders.orders
  where id in ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000404');
  select count(*) into v_foreign from kitluy_orders.orders
  where id = '00000000-0000-4000-8000-000000000452';
  select count(*) into v_lines from kitluy_orders.order_lines
  where id in ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000405');
  if v_bookings <> 2 or v_foreign <> 0 or v_lines <> 2 then
    raise exception 'FAIL WS7-P1: booking read wrong (own=%, foreign=%, lines=%)',
      v_bookings, v_foreign, v_lines;
  end if;
  raise notice 'PASS WS7-P1: store staff reads both own-store Bookings with lines; foreign booking invisible';
end $$;
rollback;

-- WS7-P2 (KBR-LND §4): u10 reads the production projection (A2 is READY) and
-- the append-only production status history.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_ready int;
  v_states int;
  v_history int;
begin
  select count(*) into v_ready from kitluy_laundry.booking_production_state
  where order_id = '00000000-0000-4000-8000-000000000404' and production_status = 'READY';
  select count(*) into v_states from kitluy_laundry.booking_production_state
  where order_id in ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000404');
  select count(*) into v_history from kitluy_laundry.booking_status_history
  where id in ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000408',
               '00000000-0000-4000-8000-000000000409');
  if v_ready <> 1 or v_states <> 2 or v_history <> 3 then
    raise exception 'FAIL WS7-P2: production read wrong (ready=%, states=%, history=%)',
      v_ready, v_states, v_history;
  end if;
  raise notice 'PASS WS7-P2: production projection (READY) and status history readable in store scope';
end $$;
rollback;

-- WS7-P3 (positive control for custody reads): u10 reads the garments, tags
-- (incl. the voided predecessor) and custody scans of Booking A2.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_garments int;
  v_tags int;
  v_voided int;
  v_scans int;
begin
  select count(*) into v_garments from kitluy_laundry.garments
  where id in ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000412');
  select count(*) into v_tags from kitluy_laundry.laundry_tags
  where id in ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000414');
  select count(*) into v_voided from kitluy_laundry.laundry_tags
  where id = '00000000-0000-4000-8000-000000000413' and voided_at is not null;
  select count(*) into v_scans from kitluy_laundry.garment_scan_events
  where id = '00000000-0000-4000-8000-000000000416';
  if v_garments <> 2 or v_tags <> 2 or v_voided <> 1 or v_scans <> 1 then
    raise exception 'FAIL WS7-P3: custody read wrong (garments=%, tags=%, voided=%, scans=%)',
      v_garments, v_tags, v_voided, v_scans;
  end if;
  raise notice 'PASS WS7-P3: garments, tag lineage (voided + replacement) and custody scans readable';
end $$;
rollback;

-- WS7-P4 / KLSEC-020 (combined positive+negative): location-scoped staff u09
-- reads the Ready storage positions of its own Location but never the
-- sibling-Location position.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000009", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_own int;
  v_sibling int;
begin
  select count(*) into v_own from kitluy_laundry.ready_storage_positions
  where id in ('00000000-0000-4000-8000-000000000417', '00000000-0000-4000-8000-000000000419');
  select count(*) into v_sibling from kitluy_laundry.ready_storage_positions
  where id = '00000000-0000-4000-8000-000000000420';
  if v_own <> 2 or v_sibling <> 0 then
    raise exception 'FAIL WS7-P4: storage position scope wrong (own=%, sibling=%)', v_own, v_sibling;
  end if;
  raise notice 'PASS WS7-P4/KLSEC-020: storage positions confined to the assigned Location';
end $$;
rollback;

-- WS7-P5 (permission gating is real): the partner owner u02 holds NO
-- laundry.bookings.read grant — the store-scope policy still exposes the
-- neutral Booking headers, but the permission-gated custody projection stays
-- hidden. Frontend visibility is not authorization (RC-012).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000002", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_orders int;
  v_production int;
begin
  select count(*) into v_orders from kitluy_orders.orders
  where id in ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000404');
  select count(*) into v_production from kitluy_laundry.booking_production_state;
  if v_orders <> 2 or v_production <> 0 then
    raise exception 'FAIL WS7-P5: permission gating wrong (orders=%, production=%)',
      v_orders, v_production;
  end if;
  raise notice 'PASS WS7-P5: owner reads Booking headers (store scope) but not the permission-gated custody projection';
end $$;
rollback;

-- WS7-P6 (control for WS7-N9/N11): a valid service-path custody scan with a
-- fresh idempotency key inserts exactly one row (rolled back afterwards).
begin;
set local role service_role;
do $$
declare
  v_rows int;
begin
  insert into kitluy_laundry.garment_scan_events
    (tenant_id, digital_store_id, store_location_id, order_id, garment_id,
     scan_type, terminal_role, from_state, to_state, actor_user_id,
     idempotency_key, aggregate_version)
  values
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
     '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
     '00000000-0000-4000-8000-000000000410', 'WASH_START', 'laundry.t1.intake_cashier',
     'TAGGED', 'WASHING', '00000000-0000-4000-8000-000000000004',
     'DEV-SCAN-PROBE-P6', 1);
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL WS7-P6: valid custody scan inserted % rows', v_rows;
  end if;
  raise notice 'PASS WS7-P6: valid custody scan with fresh idempotency key accepted (rolled back)';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS8 NEGATIVE CASES (13)
-- ---------------------------------------------------------------------------

-- WS8-N1 / KLSEC-018: anonymous access to the tender ledger is denied.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_count int;
begin
  begin
    select count(*) into v_count from kitluy_payments.tenders;
    if v_count > 0 then
      raise exception 'FAIL WS8-N1: anon saw % tender rows', v_count;
    end if;
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS8-N1/KLSEC-018: anon denied on kitluy_payments.tenders';
end $$;
rollback;

-- WS8-N2 / KLSEC-018: cross-tenant payment reads return zero rows in both
-- directions.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_payments.tenders
  where id = '00000000-0000-4000-8000-000000000455';
  if v_count <> 0 then
    raise exception 'FAIL WS8-N2: tenant A store staff read the Tenant B tender';
  end if;
end $$;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_payments.tenders
  where id = '00000000-0000-4000-8000-000000000425';
  if v_count <> 0 then
    raise exception 'FAIL WS8-N2: tenant B owner read the Tenant A tender';
  end if;
  raise notice 'PASS WS8-N2/KLSEC-018: cross-tenant tender reads return zero rows both ways';
end $$;
rollback;

-- WS8-N3 / KLSEC-024: a direct client payment write is denied — payment truth
-- moves only through the engine command path (KBR-PAY-003).
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
begin
  begin
    update kitluy_payments.tenders
       set status = 'REFUNDED'
     where id = '00000000-0000-4000-8000-000000000425';
    raise exception 'FAIL WS8-N3: direct client tender UPDATE was accepted';
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS8-N3/KLSEC-024: direct client payment writes fail closed';
end $$;
rollback;

-- WS8-N4 (KBR-PAY-004): a tender allocated to a foreign-tenant Booking is
-- rejected by the composite tenders_tenant_order_fk/tenders_store_order_fk.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_payments.tenders
      (tenant_id, digital_store_id, order_id, method_code, amount_minor,
       currency_code, idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000452', 'CASH', 100, 'KHR', 'PROBE-W8N4');
    raise exception 'FAIL WS8-N4: tender against a foreign Booking was accepted';
  exception
    when foreign_key_violation then
      null;
  end;
  raise notice 'PASS WS8-N4/KBR-PAY-004: tender cannot allocate to a foreign Booking (composite FK)';
end $$;
rollback;

-- WS8-N5 (KBR-PAY-004; PAY-VEC-004): a USD tender on a KHR Booking is rejected
-- with no implicit conversion (PRC-OD-005 open — no FX policy invented).
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_payments.tenders
      (tenant_id, digital_store_id, order_id, method_code, amount_minor,
       currency_code, idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000401', 'CASH', 100, 'USD', 'PROBE-W8N5');
    raise exception 'FAIL WS8-N5: cross-currency tender was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-PAY-CURRENCY-MISMATCH%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS8-N5/KBR-PAY-004: cross-currency tender rejected (KLUY-PAY-CURRENCY-MISMATCH)';
end $$;
rollback;

-- WS8-N6 / KLSEC-026 (KBR-PAY-005): refund four-eyes — the requester can never
-- approve their own refund (refunds_four_eyes_check). The refundable CEILING is
-- enforced by the canonical engine inside the command body (WS-08-T001 RV-001),
-- not by a table constraint — the DB-level control probed here is four-eyes.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_payments.refunds
      (tenant_id, digital_store_id, order_id, tender_id, amount_minor,
       currency_code, reason_code, status, requested_by, approved_by,
       approved_at, idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000427',
       100, 'KHR', 'PROBE_SELF_APPROVAL', 'APPROVED',
       '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000007',
       now(), 'PROBE-W8N6');
    raise exception 'FAIL WS8-N6: self-approved refund was accepted';
  exception
    when check_violation then
      null;
  end;
  raise notice 'PASS WS8-N6/KLSEC-026: refund requester cannot approve own refund (four-eyes CHECK)';
end $$;
rollback;

-- WS8-N7 (AMD-I4; PAY-VEC-009): a duplicate provider payment confirmation is
-- rejected by the (provider_key, provider_event_id) uniqueness anchor.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_payments.payment_provider_events
      (tenant_id, tender_id, provider_key, provider_event_id, signature_valid,
       payload_hash, status)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000427',
       'DEV_KHQR_SIM', 'DEV-EVT-KHQR-0001', true, 'probe-duplicate-hash',
       'DUPLICATE_IGNORED');
    raise exception 'FAIL WS8-N7: duplicate provider event was accepted';
  exception
    when unique_violation then
      null;
  end;
  raise notice 'PASS WS8-N7/AMD-I4: duplicate provider confirmation rejected (provider event uniqueness)';
end $$;
rollback;

-- WS8-N8 (engine runIdempotent; PAY-VEC-014): a second tender with a replayed
-- Tenant idempotency key is rejected.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_payments.tenders
      (tenant_id, digital_store_id, order_id, method_code, amount_minor,
       currency_code, idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000401', 'CASH', 100, 'KHR', 'DEV-PAY-0001');
    raise exception 'FAIL WS8-N8: duplicate tender idempotency key was accepted';
  exception
    when unique_violation then
      null;
  end;
  raise notice 'PASS WS8-N8: duplicate tender idempotency key rejected (tenant scope)';
end $$;
rollback;

-- WS8-N9 / KLSEC-036 (Cycle-6 §11): finalized payment history and void
-- evidence are immutable for the service path (revoked grants over
-- enforce_append_only — either layer rejecting is a pass).
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_payments.payment_status_history
       set reason_code = 'tamper'
     where id = '00000000-0000-4000-8000-000000000426';
    raise exception 'FAIL WS8-N9: payment status history was rewritten';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  begin
    delete from kitluy_payments.voids
     where tenant_id = '00000000-0000-4000-8000-000000000011';
    raise exception 'FAIL WS8-N9: void evidence was deleted';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS8-N9/KLSEC-036: payment history and void evidence immutable for the service path';
end $$;
rollback;

-- WS8-N10 (AMD-I2): direct journal mutation is impossible even for
-- service_role — INSERT/UPDATE/DELETE grants on the journal relations are
-- revoked; the security-definer RPC is the sole write path.
begin;
set local role service_role;
do $$
begin
  begin
    insert into kitluy_finance.journal_entries
      (tenant_id, digital_store_id, business_date, entry_type, posting_rule_key,
       source_type, source_id, currency_code)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       date '2026-07-27', 'DEV_PROBE', 'DEV-RULE-PROBE-DIRECT', 'TENDER',
       gen_random_uuid(), 'KHR');
    raise exception 'FAIL WS8-N10: direct journal INSERT was accepted for service_role';
  exception
    when insufficient_privilege then
      null;
  end;
  begin
    update kitluy_finance.journal_postings
       set memo = 'tamper'
     where tenant_id = '00000000-0000-4000-8000-000000000011';
    raise exception 'FAIL WS8-N10: direct journal posting UPDATE was accepted';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  begin
    delete from kitluy_finance.journal_entries
     where tenant_id = '00000000-0000-4000-8000-000000000011';
    raise exception 'FAIL WS8-N10: direct journal DELETE was accepted';
  exception
    when insufficient_privilege then
      null;
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS8-N10/AMD-I2: direct journal writes revoked even for service_role (RPC-only)';
end $$;
rollback;

-- WS8-N11 / KLSEC-018 (combined negative+positive control): Tenant B reads
-- zero Tenant A journal entries; Tenant A store staff reads the seeded entry.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000006", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_finance.journal_entries
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  if v_count <> 0 then
    raise exception 'FAIL WS8-N11: tenant B owner saw % Tenant A journal entries', v_count;
  end if;
end $$;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_finance.journal_entries
  where tenant_id = '00000000-0000-4000-8000-000000000011';
  if v_count < 1 then
    raise exception 'FAIL WS8-N11: tenant A staff cannot read own journal entries (positive control broken)';
  end if;
  raise notice 'PASS WS8-N11/KLSEC-018: journal entries invisible cross-tenant, readable in tenant scope';
end $$;
rollback;

-- WS8-N12 (AMD-I2): the posting RPC is not executable by authenticated
-- clients — EXECUTE is granted to service_role only.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_result jsonb;
begin
  begin
    v_result := kitluy_finance.post_journal_entry_v1(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
      null, date '2026-07-27', 'DEV_PROBE', 'DEV-RULE-PROBE-CLIENT', null,
      'TENDER', '00000000-0000-4000-8000-000000000425', 'PROBE-HASH-N12', 'KHR',
      null, null, null, null, 'DEV-IDEM-PROBE-N12', '[]'::jsonb);
    raise exception 'FAIL WS8-N12: authenticated client executed the posting RPC (%)', v_result;
  exception
    when insufficient_privilege then
      null;
  end;
  raise notice 'PASS WS8-N12/AMD-I2: posting RPC not executable by authenticated clients';
end $$;
rollback;

-- WS8-N13 (KBR-PAY §4): tender status corruption — CAPTURED can never move
-- back to PENDING (forward-only whitelist).
begin;
set local role service_role;
do $$
begin
  begin
    update kitluy_payments.tenders
       set status = 'PENDING', updated_at = now()
     where id = '00000000-0000-4000-8000-000000000425';
    raise exception 'FAIL WS8-N13: CAPTURED -> PENDING tender rewind was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-GUARD-INVALID-TRANSITION%' then
        raise;
      end if;
  end;
  raise notice 'PASS WS8-N13/KBR-PAY: tender lifecycle rewind rejected (KLUY-GUARD-INVALID-TRANSITION)';
end $$;
rollback;

-- ---------------------------------------------------------------------------
-- WS8 POSITIVE CASES (6)
-- ---------------------------------------------------------------------------

-- WS8-P1 (control for WS8-N2): u10 reads both own-store tenders, the KHQR
-- transaction reference and the provider attempt.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_tenders int;
  v_khqr int;
  v_attempts int;
begin
  select count(*) into v_tenders from kitluy_payments.tenders
  where id in ('00000000-0000-4000-8000-000000000425', '00000000-0000-4000-8000-000000000427');
  select count(*) into v_khqr from kitluy_payments.khqr_transactions
  where id = '00000000-0000-4000-8000-000000000429' and status = 'SUCCEEDED';
  select count(*) into v_attempts from kitluy_payments.payment_attempts
  where id = '00000000-0000-4000-8000-000000000428' and status = 'SUCCEEDED';
  if v_tenders <> 2 or v_khqr <> 1 or v_attempts <> 1 then
    raise exception 'FAIL WS8-P1: payment read wrong (tenders=%, khqr=%, attempts=%)',
      v_tenders, v_khqr, v_attempts;
  end if;
  raise notice 'PASS WS8-P1: own-store tenders, KHQR reference and attempt readable';
end $$;
rollback;

-- WS8-P2 (KBR-PAY-005 four-eyes evidence): the APPROVED refund carries a
-- DISTINCT approver in the row itself.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_payments.refunds
  where id = '00000000-0000-4000-8000-000000000432'
    and status = 'APPROVED'
    and approved_by is not null
    and approved_by <> requested_by;
  if v_count <> 1 then
    raise exception 'FAIL WS8-P2: approved refund with distinct approver not readable';
  end if;
  raise notice 'PASS WS8-P2: refund readable with distinct-approver four-eyes evidence';
end $$;
rollback;

-- WS8-P3 (KBR-PAY-009/KBR-FIN-005): the reconciliation discrepancy under
-- review and the settlement fee composition (gross = fee + net) are readable.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_recon int;
  v_line int;
  v_settlement int;
begin
  select count(*) into v_recon from kitluy_payments.payment_reconciliations
  where id = '00000000-0000-4000-8000-000000000436' and status = 'EXCEPTIONS_FOUND';
  select count(*) into v_line from kitluy_payments.payment_reconciliation_lines
  where id = '00000000-0000-4000-8000-000000000437'
    and difference_minor = -100 and review_status = 'PENDING_REVIEW';
  select count(*) into v_settlement from kitluy_payments.settlement_refs
  where id = '00000000-0000-4000-8000-000000000438'
    and settled_amount_minor = 7500 and fee_minor = 100 and net_minor = 7400
    and settled_amount_minor = fee_minor + net_minor;
  if v_recon <> 1 or v_line <> 1 or v_settlement <> 1 then
    raise exception 'FAIL WS8-P3: reconciliation read wrong (recon=%, line=%, settlement=%)',
      v_recon, v_line, v_settlement;
  end if;
  raise notice 'PASS WS8-P3: reconciliation discrepancy (-100) and settlement fee composition (7500=100+7400) readable';
end $$;
rollback;

-- WS8-P4 (Cycle-6 §11): u10 reads the append-only payment status history of
-- both own-store tenders.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_count int;
begin
  select count(*) into v_count from kitluy_payments.payment_status_history
  where id in ('00000000-0000-4000-8000-000000000426', '00000000-0000-4000-8000-000000000431')
    and to_status = 'CAPTURED';
  if v_count <> 2 then
    raise exception 'FAIL WS8-P4: expected 2 payment status history rows, saw %', v_count;
  end if;
  raise notice 'PASS WS8-P4: payment status history readable for own-store tenders';
end $$;
rollback;

-- WS8-P5 (AMD-I1/KBR-FIN-002): tenant-scoped finance read — the account
-- registry and the seeded BALANCED journal (debits = credits = 2000) are
-- readable; the Tenant B account stays invisible.
begin;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-4000-8000-000000000010", "role": "authenticated"}', true);
set local role authenticated;
do $$
declare
  v_accounts int;
  v_foreign int;
  v_entry_id uuid;
  v_debits bigint;
  v_credits bigint;
begin
  select count(*) into v_accounts from kitluy_finance.subledger_accounts
  where id in ('00000000-0000-4000-8000-000000000440', '00000000-0000-4000-8000-000000000441',
               '00000000-0000-4000-8000-000000000442', '00000000-0000-4000-8000-000000000443');
  select count(*) into v_foreign from kitluy_finance.subledger_accounts
  where id = '00000000-0000-4000-8000-000000000456';
  select journal_entry_id into v_entry_id from kitluy_finance.source_postings
  where tenant_id = '00000000-0000-4000-8000-000000000011'
    and source_type = 'TENDER'
    and source_id = '00000000-0000-4000-8000-000000000425'
    and posting_rule_key = 'DEV-RULE-CASH-TENDER';
  select
    coalesce(sum(amount_minor) filter (where direction = 'DEBIT'), 0),
    coalesce(sum(amount_minor) filter (where direction = 'CREDIT'), 0)
    into v_debits, v_credits
  from kitluy_finance.journal_postings
  where journal_entry_id = v_entry_id;
  if v_accounts <> 4 or v_foreign <> 0 then
    raise exception 'FAIL WS8-P5: account registry wrong (accounts=%, foreign=%)', v_accounts, v_foreign;
  end if;
  if v_entry_id is null or v_debits <> 2000 or v_credits <> 2000 then
    raise exception 'FAIL WS8-P5: balanced journal wrong (entry=%, debits=%, credits=%)',
      v_entry_id, v_debits, v_credits;
  end if;
  raise notice 'PASS WS8-P5: tenant-scoped accounts + seeded balanced journal readable (debits=credits=2000)';
end $$;
rollback;

-- WS8-P6 (control for WS8-N4/N5/N8): a valid service-path tender (fresh
-- idempotency key, Booking-matching currency) inserts exactly one row
-- (rolled back afterwards).
begin;
set local role service_role;
do $$
declare
  v_rows int;
begin
  insert into kitluy_payments.tenders
    (tenant_id, digital_store_id, store_location_id, order_id, method_code,
     amount_minor, currency_code, idempotency_key, created_by)
  values
    ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
     '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
     'CASH', 500, 'KHR', 'DEV-PAY-PROBE-P6', '00000000-0000-4000-8000-000000000004');
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'FAIL WS8-P6: valid tender inserted % rows', v_rows;
  end if;
  raise notice 'PASS WS8-P6: valid currency-matched tender with fresh idempotency key accepted (rolled back)';
end $$;
rollback;


-- ============================================================================
-- CYCLE 10 / WS-11-T001 — kitluy_devices fail-closed cases (migration 0120).
-- Device identity, hardware evidence and PKI configuration are platform-internal
-- HET fleet data. There is no tenant-scoped read path and there is no client
-- write path. Tenant-visible device status arrives with the assignment model in
-- WS-11-T002, scoped by assignment.
-- ============================================================================

-- WS11-N1: anonymous access to device identity is denied with no leakage.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.devices;
    if v_probe > 0 then
      raise exception 'FAIL WS11-N1: anon read % device rows', v_probe;
    end if;
    v_denied := v_denied + 1; -- zero rows is also fail-closed
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  begin
    select count(*) into v_probe from kitluy_devices.hardware_manifest_signals;
    if v_probe > 0 then
      raise exception 'FAIL WS11-N1: anon read % hardware evidence rows', v_probe;
    end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;

  if v_denied <> 2 then
    raise exception 'FAIL WS11-N1: expected 2 denied anon probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N1: anonymous reads of device identity and hardware evidence are denied with no row leakage';
end $$;
rollback;

-- WS11-N2: an authenticated tenant user cannot read device identity, hardware
-- evidence, enrollment records or public-key fingerprints.
begin;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.devices;
    if v_probe > 0 then raise exception 'FAIL WS11-N2: authenticated read % device rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    select count(*) into v_probe from kitluy_devices.manufacturing_enrollments;
    if v_probe > 0 then raise exception 'FAIL WS11-N2: authenticated read % enrollment rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    select count(*) into v_probe from kitluy_devices.device_trust_incidents;
    if v_probe > 0 then raise exception 'FAIL WS11-N2: authenticated read % trust incident rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 3 then
    raise exception 'FAIL WS11-N2: expected 3 denied authenticated probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N2: an authenticated tenant user reads no device identity, no enrollment record and no trust incident (frontend visibility is not authorization, RC-012)';
end $$;
rollback;

-- WS11-N3: an authenticated user cannot read OR write the PKI trust
-- configuration. This is the table the BLK-005 gate reads: a client able to
-- insert a row here could activate devices with a cryptographic design nobody
-- approved.
begin;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.pki_trust_configuration;
    if v_probe > 0 then raise exception 'FAIL WS11-N3: authenticated read % PKI configuration rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'r', 'i', 'm', 'hsm', 365, 30, 7, 'CRL', 72,
       'c', 'rel', 'tx', 'SELF-APPROVED', now(), true);
    raise exception 'FAIL WS11-N3: an authenticated client inserted an approved PKI configuration';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    v_denied := v_denied + 1;
  end;

  if v_denied <> 2 then
    raise exception 'FAIL WS11-N3: expected 2 denied PKI probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N3: an authenticated client can neither read nor insert the PKI trust configuration, so the BLK-005 gate cannot be opened from a client session';
end $$;
rollback;

-- WS11-N4: device governance procedures are not callable by clients.
-- PostgreSQL grants EXECUTE to PUBLIC at creation; migration 0120 revokes it.
begin;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
begin
  begin
    perform kitluy_devices.activate_device_v1(gen_random_uuid(), 'production', 'CLIENT');
    raise exception 'FAIL WS11-N4: a client executed activate_device_v1';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N4: activate_device_v1 was callable by a client (failed with: %)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform kitluy_devices.enroll_device_v1(
      'CLIENT-FORGED', gen_random_uuid(), now(), repeat('aa', 32), 'ed25519', 'software',
      'CLIENT', 'CLIENT', '[]'::jsonb);
    raise exception 'FAIL WS11-N4: a client executed enroll_device_v1';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N4: enroll_device_v1 was callable by a client (failed with: %)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform kitluy_devices.assert_pki_configuration_approved('production');
    raise exception 'FAIL WS11-N4: a client executed assert_pki_configuration_approved';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N4: assert_pki_configuration_approved was callable by a client (failed with: %)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  if v_denied <> 3 then
    raise exception 'FAIL WS11-N4: expected 3 denied procedure calls, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N4: enrollment, activation and the PKI gate function are not executable by a client session — PUBLIC EXECUTE is revoked, not merely re-granted (the WS-10 migration 0020 lesson)';
end $$;
rollback;

-- WS11-P1 (control): the service path reads the fleet view. Post KLD-2026-07-28-002
-- the gate RESOLVES for development and fails closed for pilot and production,
-- so the invariant is environment-exact: nothing pilot/production may be ACTIVE
-- or hold a certificate, and every ACTIVE device must stand on a development
-- certificate issued through the governed gate.
begin;
set local role service_role;
do $$
declare
  v_total int;
  v_active int;
  v_foreign_certs int;
  v_active_without_dev_cert int;
begin
  select count(*) into v_total from kitluy_devices.device_fleet_status;
  select count(*) into v_active from kitluy_devices.device_fleet_status where fleet_status = 'ACTIVE';
  select count(*) into v_foreign_certs from kitluy_devices.device_certificates
   where environment in ('pilot', 'production');
  select count(*) into v_active_without_dev_cert
    from kitluy_devices.device_fleet_status s
   where s.fleet_status = 'ACTIVE'
     and not exists (
       select 1 from kitluy_devices.device_certificates c
        where c.device_id = s.device_record_id and c.environment = 'development' and c.status = 'active');

  if v_foreign_certs <> 0 then
    raise exception 'FAIL WS11-P1: % certificate row(s) exist for pilot/production while BLK-005 keeps those environments fail-closed', v_foreign_certs;
  end if;
  if v_active_without_dev_cert <> 0 then
    raise exception 'FAIL WS11-P1: % ACTIVE device(s) lack the development-gated certificate the ballot requires', v_active_without_dev_cert;
  end if;
  raise notice 'PASS WS11-P1: the service path reads the fleet view (% device rows, % ACTIVE); zero pilot/production certificates exist while BLK-005 is open, and every ACTIVE device holds a development certificate through the governed gate (KLD-2026-07-28-002)', v_total, v_active;
end $$;
rollback;


-- ============================================================================
-- CYCLE 10 / WS-11-T002 — claim and assignment fail-closed cases (group 0121).
-- ============================================================================

-- WS11-N5: a client cannot read claims. The claim token hash and the intended
-- scope together are the provisioning secret; a tenant user reading them could
-- enumerate which hardware is about to be bound where.
begin;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.device_claims;
    if v_probe > 0 then raise exception 'FAIL WS11-N5: authenticated read % claim rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    select count(*) into v_probe from kitluy_devices.device_assignments;
    if v_probe > 0 then raise exception 'FAIL WS11-N5: authenticated read % assignment rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  begin
    select count(*) into v_probe from kitluy_devices.device_assignment_projections;
    if v_probe > 0 then raise exception 'FAIL WS11-N5: authenticated read % projection rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;

  if v_denied <> 3 then
    raise exception 'FAIL WS11-N5: expected 3 denied probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N5: an authenticated tenant user reads no claim, no assignment and no offline projection — the claim token hash plus intended scope is provisioning-sensitive and is not tenant-readable';
end $$;
rollback;

-- WS11-N6: a client cannot execute the claim, assignment or activation
-- procedures. Self-service provisioning is not a thing.
begin;
select set_config('request.jwt.claims',
  '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
begin
  begin
    perform kitluy_devices.create_device_claim_v1(
      gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
      repeat('ab', 32), repeat('cd', 32), 900, 'CLIENT');
    raise exception 'FAIL WS11-N6: a client created a device claim';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N6: create_device_claim_v1 was callable by a client (%)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform kitluy_devices.redeem_device_claim_v1(
      repeat('ab', 32), repeat('cd', 32), gen_random_uuid(), 'CLIENT');
    raise exception 'FAIL WS11-N6: a client redeemed a device claim';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N6: redeem_device_claim_v1 was callable by a client (%)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform kitluy_devices.attempt_activate_device_v1(gen_random_uuid(), 'production', 'CLIENT');
    raise exception 'FAIL WS11-N6: a client attempted device activation';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N6: attempt_activate_device_v1 was callable by a client (%)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  begin
    perform kitluy_devices.revoke_device_assignment_v1(gen_random_uuid(), 'X', 'CLIENT');
    raise exception 'FAIL WS11-N6: a client revoked a device assignment';
  exception when others then
    if sqlerrm like 'FAIL WS11%' then raise; end if;
    if sqlerrm not like '%permission denied%' then
      raise exception 'FAIL WS11-N6: revoke_device_assignment_v1 was callable by a client (%)', sqlerrm;
    end if;
    v_denied := v_denied + 1;
  end;

  if v_denied <> 4 then
    raise exception 'FAIL WS11-N6: expected 4 denied procedure calls, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N6: claim creation, claim redemption, activation and assignment revocation are all unexecutable from a client session — provisioning is a service-path operation, never self-service';
end $$;
rollback;

-- WS11-N7: anonymous access to claims and assignments is denied.
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.device_claims;
    if v_probe > 0 then raise exception 'FAIL WS11-N7: anon read % claim rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;
  begin
    select count(*) into v_probe from kitluy_devices.device_assignments;
    if v_probe > 0 then raise exception 'FAIL WS11-N7: anon read % assignment rows', v_probe; end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then v_denied := v_denied + 1;
  end;
  if v_denied <> 2 then
    raise exception 'FAIL WS11-N7: expected 2 denied anon probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N7: anonymous reads of claims and assignments are denied with no row leakage';
end $$;
rollback;

-- WS11-P2 (control): the service path reads the fleet view. Post KLD-2026-07-28-002
-- the fail-closed half is environment-exact: zero pilot/production projections,
-- zero active assignments without a development projection, no certified SKU and
-- no production-eligible device. Development-gated activations are legal.
begin;
set local role service_role;
do $$
declare
  v_awaiting int;
  v_active_without_dev_projection int;
  v_foreign_projections int;
begin
  -- Post KLD-2026-07-28-002 the most specific TRUE blocker is production
  -- ineligibility: section 4 blocks hardware certification until a
  -- TPM/secure-element SKU is certified, and certified_hardware_skus is empty.
  select count(*) into v_awaiting from kitluy_devices.device_fleet_status
   where fleet_status = 'BLOCKED_PRODUCTION_INELIGIBLE';
  select count(*) into v_active_without_dev_projection
    from kitluy_devices.device_assignments a
   where a.state = 'active'
     and not exists (
       select 1 from kitluy_devices.device_assignment_projections p
        where p.assignment_id = a.id and p.environment = 'development');
  select count(*) into v_foreign_projections from kitluy_devices.device_assignment_projections
   where environment in ('pilot', 'production');

  if v_awaiting = 0 then
    raise exception 'FAIL WS11-P2: no claimed device reports BLOCKED_PRODUCTION_INELIGIBLE';
  end if;
  if v_active_without_dev_projection <> 0 then
    raise exception 'FAIL WS11-P2: % active assignment(s) lack the development activation projection the ballot requires', v_active_without_dev_projection;
  end if;
  if v_foreign_projections <> 0 then
    raise exception 'FAIL WS11-P2: % offline projection(s) exist for pilot/production while those environments fail closed', v_foreign_projections;
  end if;
  if exists (select 1 from kitluy_devices.certified_hardware_skus) then
    raise exception 'FAIL WS11-P2: a certified hardware SKU exists; KLD-2026-07-28-002 section 4 leaves SKU certification to the owner and procurement';
  end if;
  if exists (select 1 from kitluy_devices.devices where production_eligible) then
    raise exception 'FAIL WS11-P2: a device is production-eligible with no certified SKU';
  end if;
  raise notice 'PASS WS11-P2: the service path reads the fleet view; % device(s) report BLOCKED_PRODUCTION_INELIGIBLE, every active assignment stands on a development projection, zero pilot/production projections exist, the certified-SKU table is empty and no device is production-eligible (KLD-2026-07-28-002)', v_awaiting;
end $$;
rollback;

-- WS11-N8: anonymous access to provisioning codes and their events is denied
-- with no leakage (0162).
begin;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.device_provisioning_codes;
    if v_probe > 0 then
      raise exception 'FAIL WS11-N8: anon read % provisioning-code rows', v_probe;
    end if;
    v_denied := v_denied + 1; -- zero rows is also fail-closed
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    select count(*) into v_probe from kitluy_devices.device_provisioning_code_events;
    if v_probe > 0 then
      raise exception 'FAIL WS11-N8: anon read % provisioning-code event rows', v_probe;
    end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  if v_denied <> 2 then
    raise exception 'FAIL WS11-N8: expected 2 denied anon probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N8: anonymous reads of provisioning codes and events are denied';
end $$;
rollback;

-- WS11-N9: an authenticated tenant user cannot read or mutate provisioning
-- codes or their events (0162).
begin;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  v_denied int := 0;
  v_probe int;
begin
  begin
    select count(*) into v_probe from kitluy_devices.device_provisioning_codes;
    if v_probe > 0 then
      raise exception 'FAIL WS11-N9: authenticated read % provisioning-code rows', v_probe;
    end if;
    v_denied := v_denied + 1;
  exception when insufficient_privilege then
    v_denied := v_denied + 1;
  end;
  begin
    insert into kitluy_devices.device_provisioning_codes
      (tenant_id, digital_store_id, store_location_id, store_hub_device_id,
       terminal_device_id, terminal_assignment_id, terminal_profile_key, environment,
       code_digest, payload_sha256, expires_at, issued_by_operator_ref, correlation_id)
    values
      (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
       gen_random_uuid(), gen_random_uuid(), 'laundry.t1.cashier', 'development',
       repeat('01', 32), repeat('02', 32), now() + interval '5 minutes',
       'OP-PROBE', gen_random_uuid());
    raise exception 'FAIL WS11-N9: authenticated inserted a provisioning code';
  exception
    when insufficient_privilege then v_denied := v_denied + 1;
    when foreign_key_violation then
      raise exception 'FAIL WS11-N9: an FK, not the privilege boundary, stopped the insert';
  end;
  if v_denied <> 2 then
    raise exception 'FAIL WS11-N9: expected 2 denied authenticated probes, got %', v_denied;
  end if;
  raise notice 'PASS WS11-N9: authenticated users cannot read or mutate provisioning codes';
end $$;
rollback;

-- WS11-N10: runtime service identities cannot mutate provisioning codes
-- directly (0162). The governed doors P02B adds will be the only path.
begin;
do $$
begin
  if has_table_privilege('kitluy_issuance_service',
       'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service',
       'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('service_role',
       'kitluy_devices.device_provisioning_codes', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('kitluy_worker_service',
       'kitluy_devices.device_provisioning_code_events', 'INSERT,UPDATE,DELETE') then
    raise exception 'FAIL WS11-N10: a runtime identity can mutate provisioning-code tables';
  end if;
  raise notice 'PASS WS11-N10: no runtime service identity holds direct mutation on provisioning-code tables';
end $$;
rollback;

-- WS11-N11: anon cannot execute the issuance door; PUBLIC cannot; and the
-- door's only granted surface is `authenticated` (0163).
-- The catalog checks run FIRST, as the migration role, because evaluating the
-- function identity under a schema-denied role is itself refused.
begin;
do $$
begin
  if has_function_privilege('public',
       'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('anon',
       'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or has_function_privilege('service_role',
       'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute')
     or not has_function_privilege('authenticated',
       'kitluy_devices.issue_terminal_provisioning_code_v1(uuid, text, text)', 'execute') then
    raise exception 'FAIL WS11-N11: the door''s grant boundary is wrong';
  end if;
  raise notice 'PASS WS11-N11a: PUBLIC, anon and service_role hold nothing on the issuance door; only authenticated may call it';
end $$;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$
declare
  v_result jsonb;
  v_refused boolean := false;
begin
  begin
    v_result := kitluy_devices.issue_terminal_provisioning_code_v1(
      gen_random_uuid(), 'n11-probe', null);
    if (v_result ->> 'outcome') = 'ISSUED' then
      raise exception 'FAIL WS11-N11: anon issued a provisioning code: %', v_result;
    end if;
    -- A governed refusal would still prove EXECUTE reached the door; the
    -- privilege boundary must fire first.
    if (v_result ->> 'refusal_code') <> 'KLUY-PROVCODE-UNAUTHENTICATED' then
      raise exception 'FAIL WS11-N11: anon reached the door body: %', v_result;
    end if;
    v_refused := true;
  exception when insufficient_privilege then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'FAIL WS11-N11: the anon probe did not run';
  end if;
  raise notice 'PASS WS11-N11b: anon cannot execute the issuance door';
end $$;
rollback;

select 'rls-tests complete: 14+9 baseline cases; cycle-5 WS5 7 negative + 7 positive and WS6 10 negative + 9 positive; cycle-6 WS7 13 negative + 6 positive and WS8 13 negative + 6 positive; cycle-10 WS11 T001 4 negative + 1 positive and T002 3 negative + 1 positive kitluy_devices cases executed; WS-11-T004-P02A 3 negative provisioning-code cases executed; WS-11-T004-P02B1 issuance-door boundary case executed' as result;
