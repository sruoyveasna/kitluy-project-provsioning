-- KitLuy dev fixtures (DEMO / QA_FIXTURE classes) — SYNTHETIC DATA ONLY.
-- Plan: docs/source/data-contracts/kitluy-suite-supabase-seed-and-test-fixture-plan-v1.0.0.md
-- Covers the 13 RLS/QA personas and cases of the cycle instruction:
--   1 HET admin context, 2 demo tenant, 3 partner owner, 4 store manager,
--   5 cashier, 6 laundry Digital Store, 7 physical Location, 8 online-only store,
--   9 disabled membership, 10 cross-tenant attacker tenant, 11 approval requester,
--   12 distinct approver, 13 support-access (consent) case.
--   Plus: sibling Location + location-scoped and store-scoped staff for
--   RLS-007/RLS-008, and the vertical reference registry (LAUNDRY via reference
--   table, never hardcoded).
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING; three consecutive runs are
-- semantically identical. All names/phones/emails are fictional (Khmer/English);
-- no real data, no credentials, no secrets.
-- Execution: BLOCKED (BLK-002 — Docker/Supabase CLI absent). File authored for
-- future local execution via pnpm db:seed / supabase db reset. NEVER production
-- (guard below fails closed).
-- NOTE (recorded deviation): the fixture plan prefers demo Auth users created by
-- a controlled script/API. Until that script exists, this file inserts minimal
-- synthetic rows into auth.users for FK integrity in LOCAL databases only.

-- Environment guard: refuse anything that is not an explicitly local/dev database.
do $$
declare
  v_env text := current_setting('kitluy.environment', true);
begin
  -- Review RV-301 (WS-01-T003): fail CLOSED — an unset GUC refuses seeding
  -- instead of assuming local. Set it explicitly:
  --   select set_config('kitluy.environment', 'local', false);
  if v_env is null or v_env not in ('local', 'development', 'test') then
    raise exception 'dev-fixtures REFUSED: kitluy.environment=% is not local/development/test (seed classes DEMO/QA_FIXTURE are prohibited outside dev)', v_env;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Synthetic auth users (u01..u10) — local FK anchors only, no credentials.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
values
  ('00000000-0000-4000-8000-000000000001', 'demo.het.admin@kitluy.example'),
  ('00000000-0000-4000-8000-000000000002', 'demo.partner.owner@kitluy.example'),
  ('00000000-0000-4000-8000-000000000003', 'demo.store.manager@kitluy.example'),
  ('00000000-0000-4000-8000-000000000004', 'demo.cashier@kitluy.example'),
  ('00000000-0000-4000-8000-000000000005', 'demo.disabled.member@kitluy.example'),
  ('00000000-0000-4000-8000-000000000006', 'demo.attacker.owner@kitluy.example'),
  ('00000000-0000-4000-8000-000000000007', 'demo.approval.requester@kitluy.example'),
  ('00000000-0000-4000-8000-000000000008', 'demo.approval.approver@kitluy.example'),
  ('00000000-0000-4000-8000-000000000009', 'demo.location.staff@kitluy.example'),
  ('00000000-0000-4000-8000-000000000010', 'demo.store.staff@kitluy.example')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Vertical reference registry (reference table, never a hardcoded enum).
-- Enum registry: LAUNDRY is Phase 1 OWNER-LOCKED ACTIVE BUILD; 2-8 locked roadmap.
-- ---------------------------------------------------------------------------
insert into kitluy_core.reference_values
  (id, registry_key, value_code, status, sort_order, effective_from, metadata)
values
  ('00000000-0000-4000-8000-000000000101', 'vertical_code', 'LAUNDRY', 'ACTIVE', 1, '2026-07-26T00:00:00Z', '{"phase": 1}'),
  ('00000000-0000-4000-8000-000000000102', 'vertical_code', 'CAFE_RESTAURANT', 'ROADMAP', 2, '2026-07-26T00:00:00Z', '{"phase": 2}'),
  ('00000000-0000-4000-8000-000000000103', 'vertical_code', 'ECOMMERCE', 'ROADMAP', 3, '2026-07-26T00:00:00Z', '{"phase": 3}'),
  ('00000000-0000-4000-8000-000000000104', 'vertical_code', 'CONVENIENCE', 'ROADMAP', 4, '2026-07-26T00:00:00Z', '{"phase": 4}'),
  ('00000000-0000-4000-8000-000000000105', 'vertical_code', 'PHARMACY', 'ROADMAP', 5, '2026-07-26T00:00:00Z', '{"phase": 5}'),
  ('00000000-0000-4000-8000-000000000106', 'vertical_code', 'DEPARTMENT_STORE', 'ROADMAP', 6, '2026-07-26T00:00:00Z', '{"phase": 6}'),
  ('00000000-0000-4000-8000-000000000107', 'vertical_code', 'GROCERY', 'ROADMAP', 7, '2026-07-26T00:00:00Z', '{"phase": 7}'),
  ('00000000-0000-4000-8000-000000000108', 'vertical_code', 'SUPERMARKET', 'ROADMAP', 8, '2026-07-26T00:00:00Z', '{"phase": 8}')
on conflict (id) do nothing;

insert into kitluy_core.reference_value_translations (id, reference_value_id, locale, label)
values
  ('00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000101', 'km-KH', 'បោកអ៊ុត'),
  ('00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000101', 'en-US', 'Laundry')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Case 2: demo tenant (Tenant A). Case 10: cross-tenant attacker tenant (Tenant B).
-- ---------------------------------------------------------------------------
insert into kitluy_core.tenants (id, tenant_code, legal_name, display_name, status, default_locale)
values
  ('00000000-0000-4000-8000-000000000011', 'DEMO-KH-001',
   'ក្រុមហ៊ុន បោកគក់គំរូ ខេអិល', 'KitLuy Demo Laundry Partner', 'ACTIVE', 'km-KH'),
  ('00000000-0000-4000-8000-000000000012', 'DEMO-KH-ATK',
   'ហាងគំរូ បេ', 'Demo Tenant B (cross-tenant isolation fixture)', 'ACTIVE', 'km-KH')
on conflict (id) do nothing;

insert into kitluy_core.partner_accounts
  (id, tenant_id, partner_type, verification_status, contact_name, contact_phone, contact_email)
values
  ('00000000-0000-4000-8000-000000000013', '00000000-0000-4000-8000-000000000011',
   'LAUNDRY_OPERATOR', 'APPROVED', 'Sok Dara (fictional)', '+855-00-000-0001', 'demo.partner.owner@kitluy.example'),
  ('00000000-0000-4000-8000-000000000014', '00000000-0000-4000-8000-000000000012',
   'LAUNDRY_OPERATOR', 'APPROVED', 'Chan Vanna (fictional)', '+855-00-000-0002', 'demo.attacker.owner@kitluy.example')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Case 6: laundry Digital Store. Case 8: online-only store. Attacker store (B).
-- Primary vertical comes from the vertical_code reference registry above.
-- ---------------------------------------------------------------------------
insert into kitluy_core.digital_stores
  (id, tenant_id, store_code, name, primary_vertical_code, status, default_locale, default_currency_code, timezone)
values
  ('00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000011',
   'DEMO-LAUNDRY-001', 'KitLuy Demo Laundry', 'LAUNDRY', 'ACTIVE_HYBRID', 'km-KH', 'KHR', 'Asia/Phnom_Penh'),
  ('00000000-0000-4000-8000-000000000016', '00000000-0000-4000-8000-000000000011',
   'DEMO-ONLINE-001', 'KitLuy Demo Online-Only Laundry', 'LAUNDRY', 'ACTIVE_ONLINE', 'km-KH', 'KHR', 'Asia/Phnom_Penh'),
  ('00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000012',
   'ATK-LAUNDRY-001', 'Tenant B Store (isolation fixture)', 'LAUNDRY', 'ACTIVE_ONLINE', 'km-KH', 'KHR', 'Asia/Phnom_Penh')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Case 7: physical Location (+ sibling Location for RLS-007). Online-only store
-- deliberately has NO Location.
-- ---------------------------------------------------------------------------
insert into kitluy_core.store_locations
  (id, tenant_id, digital_store_id, location_code, name, address_line1, city, country_code, operating_status, hub_required)
values
  ('00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', 'DEMO-PP-01', 'Demo Phnom Penh Branch 1',
   'No. 1, Fictional Street 100', 'Phnom Penh', 'KH', 'ACTIVE', true),
  ('00000000-0000-4000-8000-000000000019', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', 'DEMO-PP-02', 'Demo Phnom Penh Branch 2 (sibling)',
   'No. 2, Fictional Street 200', 'Phnom Penh', 'KH', 'ACTIVE', true)
on conflict (id) do nothing;

insert into kitluy_core.digital_store_location_links
  (id, tenant_id, digital_store_id, store_location_id, valid_from, reason_code)
values
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '2026-07-26T00:00:00Z', 'INITIAL_ACTIVATION'),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000019',
   '2026-07-26T00:00:00Z', 'INITIAL_ACTIVATION')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cases 3, 4, 5, 9, 10 + scoped staff: memberships.
-- ---------------------------------------------------------------------------
insert into kitluy_core.memberships (id, tenant_id, user_id, status, valid_from)
values
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000002', 'ACTIVE', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000023', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000003', 'ACTIVE', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000024', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000004', 'ACTIVE', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000025', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000005', 'SUSPENDED', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000026', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000006', 'ACTIVE', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000027', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000009', 'ACTIVE', '2026-07-26T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000028', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000010', 'ACTIVE', '2026-07-26T00:00:00Z')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Case 1: HET admin context (profile + platform role with read permissions).
-- ---------------------------------------------------------------------------
insert into kitluy_auth.admin_user_profiles (user_id, status, assurance_level, last_reauth_at)
values ('00000000-0000-4000-8000-000000000001', 'ACTIVE', 'aal2', '2026-07-26T12:00:00Z')
on conflict (user_id) do nothing;

insert into kitluy_auth.permissions (id, permission_key, version, risk_class, resource_types, environments, status)
values
  ('00000000-0000-4000-8000-000000000029', 'rbac.read', 1, 'LOW', '{authorization_config}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000030', 'audit.read', 1, 'LOW', '{audit_event}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000031', 'partners.read', 1, 'LOW', '{tenant}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000032', 'support.ticket.manage', 1, 'MODERATE', '{support_session}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000033', 'configuration.read', 1, 'LOW', '{configuration}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000034', 'platform.health.read', 1, 'LOW', '{platform}', '{all}', 'ACTIVE')
on conflict (id) do nothing;

insert into kitluy_auth.role_templates (id, role_key, version, name, system_role, status)
values
  ('00000000-0000-4000-8000-000000000035', 'HET_PLATFORM_ADMIN', 1, 'HET Platform Admin (demo)', true, 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000036', 'STORE_LOCATION_STAFF', 1, 'Store Location Staff (demo)', true, 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000037', 'DIGITAL_STORE_STAFF', 1, 'Digital Store Staff (demo)', true, 'ACTIVE')
on conflict (id) do nothing;

insert into kitluy_auth.role_permission_grants (id, role_template_id, permission_id, effect)
values
  ('00000000-0000-4000-8000-000000000038', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000029', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000039', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000030', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000040', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000031', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000041', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000032', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000042', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000033', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000043', '00000000-0000-4000-8000-000000000035', '00000000-0000-4000-8000-000000000034', 'ALLOW')
on conflict (id) do nothing;

insert into kitluy_auth.role_assignments (id, subject_type, subject_id, role_template_id, status, valid_from, granted_by)
values
  ('00000000-0000-4000-8000-000000000044', 'user', '00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000035', 'ACTIVE', '2026-07-26T00:00:00Z', null),
  ('00000000-0000-4000-8000-000000000045', 'user', '00000000-0000-4000-8000-000000000009',
   '00000000-0000-4000-8000-000000000036', 'ACTIVE', '2026-07-26T00:00:00Z', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000046', 'user', '00000000-0000-4000-8000-000000000010',
   '00000000-0000-4000-8000-000000000037', 'ACTIVE', '2026-07-26T00:00:00Z', '00000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

insert into kitluy_auth.assignment_scopes (id, role_assignment_id, scope_type, scope_id, environment, include_descendants)
values
  ('00000000-0000-4000-8000-000000000047', '00000000-0000-4000-8000-000000000044', 'platform', null, 'all', true),
  ('00000000-0000-4000-8000-000000000048', '00000000-0000-4000-8000-000000000045', 'store_location',
   '00000000-0000-4000-8000-000000000018', 'all', false),
  ('00000000-0000-4000-8000-000000000049', '00000000-0000-4000-8000-000000000046', 'digital_store',
   '00000000-0000-4000-8000-000000000015', 'all', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Cases 11 + 12: approval requester (u07) and DISTINCT approver (u08).
-- The four-eyes trigger (trg_approval_decisions_four_eyes) admits this decision
-- only because approver <> requester.
-- ---------------------------------------------------------------------------
insert into kitluy_auth.approval_policies
  (id, policy_key, version, permission_key, environment, quorum, reauth_required, reason_required, evidence_required, status)
values
  ('00000000-0000-4000-8000-000000000050', 'demo.digital_store.activate', 1,
   'digital_stores.activate', 'production', 1, true, true, false, 'ACTIVE')
on conflict (id) do nothing;

insert into kitluy_auth.approval_requests
  (id, policy_id, requester_id, resource_type, resource_id, environment, action, payload_hash, reason, status, expires_at)
values
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-000000000050',
   '00000000-0000-4000-8000-000000000007', 'digital_store',
   '00000000-0000-4000-8000-000000000015', 'production', 'digital_stores.activate',
   'a3f1c0000000000000000000000000000000000000000000000000000000d3m0',
   'Demo activation request (fixture)', 'PENDING', '2026-12-31T00:00:00Z')
on conflict (id) do nothing;

insert into kitluy_auth.approval_decisions (id, approval_request_id, approver_id, decision, reason, decided_at)
values
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-000000000051',
   '00000000-0000-4000-8000-000000000008', 'APPROVED', 'Demo four-eyes approval by a distinct approver (fixture)',
   '2026-07-26T12:30:00Z')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Case 13: support-access (consent) case — ticket for Tenant A plus an active,
-- time-bound, revocable consent session.
-- ---------------------------------------------------------------------------
insert into kitluy_admin.support_tickets
  (id, tenant_id, digital_store_id, store_location_id, priority, status, assignee_id)
values
  ('00000000-0000-4000-8000-000000000053', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   'NORMAL', 'OPEN', '00000000-0000-4000-8000-000000000001')
on conflict (id) do nothing;

insert into kitluy_admin.support_access_sessions
  (id, ticket_id, consent_ref, scope, purpose, starts_at, expires_at)
values
  ('00000000-0000-4000-8000-000000000054', '00000000-0000-4000-8000-000000000053',
   'CONSENT-DEMO-001', '{"resources": ["support_tickets", "digital_stores"]}',
   'Demo consent-scoped support access (fixture)', '2026-07-26T12:00:00Z', '2026-12-31T00:00:00Z')
on conflict (id) do nothing;
