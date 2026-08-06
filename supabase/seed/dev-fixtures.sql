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

-- ===========================================================================
-- Cycle-5 fixtures (WS-05/WS-06, groups 0040-0070) — SYNTHETIC DATA ONLY.
-- UUID range ..0301-..0352. All rows use bare ON CONFLICT DO NOTHING so the
-- second run is INSERT 0 0 against every unique AND exclusion constraint.
-- Covers: laundry per-piece + per-weight services (neutral catalog +
-- kitluy_laundry extension), KHR + USD price book rows, store base price +
-- location override, draft + published config snapshots + publication target
-- + acknowledgement + platform-scope config, customers incl. a
-- Cambodian-phone-only customer, dup-candidate pair with open merge request,
-- completed merge with distinct reviewer + tombstone + status history,
-- marketing consent granted AND withdrawn (grant preserved) beside an intact
-- transactional grant, privacy export request + decision, and cross-tenant
-- attacker rows (Tenant B catalog/price/config/customer).
-- Open owner values PRC-OD-001..005 / CFG-OD-001..005 / CUS-OD-001..004 are
-- NOT represented by any value below (no tax, rounding, FX, OTP or retention
-- fixture exists by design).
-- ===========================================================================

-- Neutral catalog items (Tenant A laundry store ds01) + translations.
insert into kitluy_core.catalog_items
  (id, tenant_id, digital_store_id, item_type, code, name, status)
values
  ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', 'SERVICE', 'SRV-SHIRT-WASH', 'Shirt wash (per piece)', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', 'SERVICE', 'SRV-WASH-KG', 'Wash and dry (per kg)', 'ACTIVE'),
  -- Tenant B attacker-side catalog item (isolation probes).
  ('00000000-0000-4000-8000-000000000313', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', 'SERVICE', 'SRV-ATK-WASH', 'Tenant B wash (isolation fixture)', 'ACTIVE')
on conflict do nothing;

insert into kitluy_core.catalog_item_translations (id, catalog_item_id, locale, name)
values
  ('00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000301', 'km-KH', 'បោកអាវ (តាមចំនួន)'),
  ('00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000301', 'en-US', 'Shirt wash (per piece)'),
  ('00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000304', 'km-KH', 'បោកសម្ងួត (តាមគីឡូ)')
on conflict do nothing;

-- Laundry service extensions (per-piece and per-weight) + add-on.
insert into kitluy_laundry.services
  (id, tenant_id, digital_store_id, catalog_item_id, service_code, pricing_modes, status)
values
  ('00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000301',
   'SHIRT-WASH', array['PER_PIECE'], 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000307', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000304',
   'WASH-KG', array['PER_WEIGHT'], 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000314', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000313',
   'ATK-WASH', array['PER_PIECE'], 'ACTIVE')
on conflict do nothing;

insert into kitluy_laundry.service_addons
  (id, tenant_id, digital_store_id, service_id, addon_code, name, pricing_mode, status)
values
  ('00000000-0000-4000-8000-000000000308', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000306',
   'EXPRESS', 'Express turnaround', 'FIXED', 'ACTIVE')
on conflict do nothing;

-- Price book rows (integer minor units; KHR exponent 0, USD exponent 2).
-- Store base KHR per-piece 2,000 riel (KBR-PRC-003 TV1), store base KHR
-- per-weight 3,000 riel/kg (TV2), store base USD per-piece 50 cents, and a
-- Location price-book override 2,500 riel at loc01 (KBR-PRC-002 TV1).
insert into kitluy_laundry.service_prices
  (id, tenant_id, service_id, digital_store_id, store_location_id, currency_code,
   pricing_mode, unit_price_minor, min_charge_minor, effective_from, version, created_by)
values
  ('00000000-0000-4000-8000-000000000309', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000015',
   null, 'KHR', 'PER_PIECE', 2000, null, '2026-07-27T00:00:00Z', 1,
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000310', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000307', '00000000-0000-4000-8000-000000000015',
   null, 'KHR', 'PER_WEIGHT', 3000, null, '2026-07-27T00:00:00Z', 1,
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000311', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000015',
   null, 'USD', 'PER_PIECE', 50, null, '2026-07-27T00:00:00Z', 1,
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000312', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000015',
   '00000000-0000-4000-8000-000000000018', 'KHR', 'PER_PIECE', 2500, null,
   '2026-07-27T00:00:00Z', 1, '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000315', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000314', '00000000-0000-4000-8000-000000000017',
   null, 'KHR', 'PER_PIECE', 1800, null, '2026-07-27T00:00:00Z', 1,
   '00000000-0000-4000-8000-000000000006')
on conflict do nothing;

-- Configuration snapshots: ACTIVE v1 + DRAFT v2 (digital_store scope),
-- ACTIVE location-scope override, ACTIVE platform-scope row, Tenant B row.
insert into kitluy_config.configuration_versions
  (id, config_key, scope_type, precedence, tenant_id, digital_store_id,
   store_location_id, version, schema_version, payload, payload_hash, status, created_by)
values
  ('00000000-0000-4000-8000-000000000317', 'store.receipt_layout', 'digital_store', 2,
   '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
   null, 1, '1.0', '{"layout": "demo-a"}',
   'demo0000000000000000000000000000000000000000000000000000000317', 'ACTIVE',
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000316', 'store.receipt_layout', 'digital_store', 2,
   '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
   null, 2, '1.0', '{"layout": "demo-b-draft"}',
   'demo0000000000000000000000000000000000000000000000000000000316', 'DRAFT',
   '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8000-000000000318', 'store.receipt_layout', 'store_location', 3,
   '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
   '00000000-0000-4000-8000-000000000018', 1, '1.0', '{"layout": "demo-loc-override"}',
   'demo0000000000000000000000000000000000000000000000000000000318', 'ACTIVE',
   '00000000-0000-4000-8000-000000000003'),
  ('00000000-0000-4000-8000-000000000319', 'platform.locale_defaults', 'platform', 0,
   null, null, null, 1, '1.0', '{"locales": ["km-KH", "en-US"]}',
   'demo0000000000000000000000000000000000000000000000000000000319', 'ACTIVE',
   '00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000323', 'store.receipt_layout', 'digital_store', 2,
   '00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000017',
   null, 1, '1.0', '{"layout": "atk"}',
   'demo0000000000000000000000000000000000000000000000000000000323', 'ACTIVE',
   '00000000-0000-4000-8000-000000000006')
on conflict do nothing;

insert into kitluy_config.configuration_publications
  (id, configuration_version_id, publication_kind, idempotency_key, status, requested_by)
values
  ('00000000-0000-4000-8000-000000000320', '00000000-0000-4000-8000-000000000317',
   'PUBLISH', 'PUB-DEMO-0001', 'ACTIVE', '00000000-0000-4000-8000-000000000002')
on conflict do nothing;

insert into kitluy_config.configuration_targets
  (id, publication_id, target_type, target_id, status, applied_at)
values
  ('00000000-0000-4000-8000-000000000321', '00000000-0000-4000-8000-000000000320',
   'store_location', '00000000-0000-4000-8000-000000000018', 'ACTIVE', '2026-07-27T01:00:00Z')
on conflict do nothing;

insert into kitluy_config.configuration_acknowledgements
  (id, target_id, consumer_id, applied_version, result, acknowledged_at)
values
  ('00000000-0000-4000-8000-000000000322', '00000000-0000-4000-8000-000000000321',
   '00000000-0000-4000-8000-000000000399', 1, 'ACTIVE', '2026-07-27T01:05:00Z')
on conflict do nothing;

-- Customers. C1 is Cambodian-phone-only (NO email anywhere); C2 has phone +
-- optional email; C-dup-A/C-dup-B share a phone (duplicate candidates);
-- C3 is a completed-merge tombstone into C1. Tenant B customer for isolation.
insert into kitluy_core.customers
  (id, tenant_id, display_name, status, preferred_locale, merged_into_customer_id)
values
  ('00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000011',
   'Sokha Chan (fictional)', 'ACTIVE', 'km-KH', null),
  ('00000000-0000-4000-8000-000000000326', '00000000-0000-4000-8000-000000000011',
   'Dara Kim (fictional)', 'ACTIVE', 'en-US', null),
  ('00000000-0000-4000-8000-000000000329', '00000000-0000-4000-8000-000000000011',
   'Vanna Sok (fictional)', 'ACTIVE', 'km-KH', null),
  ('00000000-0000-4000-8000-000000000331', '00000000-0000-4000-8000-000000000011',
   'Vanna S. (fictional duplicate candidate)', 'ACTIVE', 'km-KH', null),
  ('00000000-0000-4000-8000-000000000334', '00000000-0000-4000-8000-000000000011',
   'Sokha C. (fictional, merged tombstone)', 'MERGED', 'km-KH',
   '00000000-0000-4000-8000-000000000324'),
  ('00000000-0000-4000-8000-000000000340', '00000000-0000-4000-8000-000000000012',
   'Tenant B Customer (isolation fixture)', 'ACTIVE', 'km-KH', null)
on conflict do nothing;

insert into kitluy_core.customer_contacts
  (id, tenant_id, customer_id, type, normalized_value, display_value, masked_value,
   verified_at, is_primary, consent_status, status)
values
  ('00000000-0000-4000-8000-000000000325', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', 'PHONE', '+85512345678', '012 345 678',
   '***678', '2026-07-27T00:00:00Z', true, 'GRANTED', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000327', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000326', 'PHONE', '+85598765432', '098 765 432',
   '***432', '2026-07-27T00:00:00Z', true, 'GRANTED', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000328', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000326', 'EMAIL', 'dara.kim@customer.example',
   'dara.kim@customer.example', 'd***@customer.example', null, true, 'UNKNOWN', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000330', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000329', 'PHONE', '+85511223344', '011 223 344',
   '***344', '2026-07-27T00:00:00Z', true, 'UNKNOWN', 'ACTIVE'),
  -- Same phone as ..0330 but UNVERIFIED: allowed beside the ACTIVE identifier
  -- (partial unique applies to status ACTIVE only) — duplicate-review fixture,
  -- never auto-merged (KBR-CUS-001 TV2).
  ('00000000-0000-4000-8000-000000000332', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000331', 'PHONE', '+85511223344', '011 22 33 44',
   '***344', null, false, 'UNKNOWN', 'UNVERIFIED'),
  ('00000000-0000-4000-8000-000000000341', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000340', 'PHONE', '+85577889900', '077 889 900',
   '***900', null, true, 'UNKNOWN', 'ACTIVE')
on conflict do nothing;

insert into kitluy_core.customer_store_relationships
  (id, tenant_id, customer_id, digital_store_id, status, source_code, first_seen_at)
values
  ('00000000-0000-4000-8000-000000000339', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000015',
   'ACTIVE', 'WALK_IN', '2026-07-27T00:00:00Z')
on conflict do nothing;

-- Merge fixtures: one OPEN duplicate-review request (no reviewer yet) and one
-- COMPLETED merge with a DISTINCT reviewer (u07 requests, u08 reviews),
-- append-only result and tombstone preserved.
insert into kitluy_core.customer_merge_requests
  (id, tenant_id, surviving_customer_id, merging_customer_id, match_evidence,
   reason, status, requested_by, reviewed_by, requested_at, decided_at)
values
  ('00000000-0000-4000-8000-000000000333', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000329', '00000000-0000-4000-8000-000000000331',
   '{"signal": "same normalized phone", "verified": false}',
   'Duplicate candidate from shared phone +85511223344 (fixture)', 'REQUESTED',
   '00000000-0000-4000-8000-000000000007', null, '2026-07-27T02:00:00Z', null),
  ('00000000-0000-4000-8000-000000000335', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000334',
   '{"signal": "same verified phone and profile", "verified": true}',
   'Completed demo merge (fixture)', 'COMPLETED',
   '00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000008',
   '2026-07-27T02:10:00Z', '2026-07-27T02:20:00Z')
on conflict do nothing;

insert into kitluy_core.customer_merge_results
  (id, tenant_id, merge_request_id, surviving_customer_id, merged_customer_id,
   moved_links, completed_by, completed_at)
values
  ('00000000-0000-4000-8000-000000000336', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000335', '00000000-0000-4000-8000-000000000324',
   '00000000-0000-4000-8000-000000000334',
   '{"contacts_moved": 0, "relationships_moved": 0, "note": "demo merge"}',
   '00000000-0000-4000-8000-000000000008', '2026-07-27T02:20:00Z')
on conflict do nothing;

insert into kitluy_core.customer_status_history
  (id, tenant_id, customer_id, from_status, to_status, reason_code, actor_id, occurred_at)
values
  ('00000000-0000-4000-8000-000000000337', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000334', 'ACTIVE', 'MERGED', 'CUSTOMER_MERGE',
   '00000000-0000-4000-8000-000000000008', '2026-07-27T02:20:00Z'),
  ('00000000-0000-4000-8000-000000000338', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', null, 'ACTIVE', 'CUSTOMER_CREATED',
   '00000000-0000-4000-8000-000000000002', '2026-07-27T00:00:00Z')
on conflict do nothing;

-- Consent: marketing purpose granted THEN withdrawn (grant row preserved);
-- transactional purpose granted and untouched — the five communication
-- classes stay separate.
insert into kitluy_core.consent_purposes
  (id, purpose_key, communication_class, description, status)
values
  ('00000000-0000-4000-8000-000000000342', 'MARKETING_PROMOTIONS', 'MARKETING',
   'Optional marketing promotions (demo purpose)', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000343', 'SERVICE_PICKUP_NOTICE', 'TRANSACTIONAL',
   'Laundry pickup-ready notification (demo purpose)', 'ACTIVE')
on conflict do nothing;

insert into kitluy_core.consent_purpose_versions
  (id, consent_purpose_id, version, policy_ref, notice_text, effective_from)
values
  ('00000000-0000-4000-8000-000000000344', '00000000-0000-4000-8000-000000000342',
   1, 'DEMO-NOTICE-MKT-1', 'Demo marketing notice v1 (fixture)', '2026-07-27T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000345', '00000000-0000-4000-8000-000000000343',
   1, 'DEMO-NOTICE-TXN-1', 'Demo pickup notice v1 (fixture)', '2026-07-27T00:00:00Z')
on conflict do nothing;

insert into kitluy_core.consent_grants
  (id, tenant_id, customer_id, consent_purpose_version_id, channel, source,
   evidence_ref, recorded_by, granted_at)
values
  ('00000000-0000-4000-8000-000000000346', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000344',
   'SMS', 'CUSTOMER_SELF', 'DEMO-EVIDENCE-346', '00000000-0000-4000-8000-000000000002',
   '2026-07-27T00:10:00Z'),
  ('00000000-0000-4000-8000-000000000348', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', '00000000-0000-4000-8000-000000000345',
   'SMS', 'CUSTOMER_SELF', 'DEMO-EVIDENCE-348', '00000000-0000-4000-8000-000000000002',
   '2026-07-27T00:10:00Z')
on conflict do nothing;

insert into kitluy_core.consent_withdrawals
  (id, tenant_id, consent_grant_id, reason_code, source, recorded_by, withdrawn_at)
values
  ('00000000-0000-4000-8000-000000000347', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000346', 'CUSTOMER_REQUEST', 'CUSTOMER_SELF',
   '00000000-0000-4000-8000-000000000002', '2026-07-27T03:00:00Z')
on conflict do nothing;

insert into kitluy_notifications.preferences
  (id, tenant_id, customer_id, user_id, event_family, channel, state, source, source_ref)
values
  ('00000000-0000-4000-8000-000000000349', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', null, 'MARKETING', 'SMS', 'WITHDRAWN',
   'consent_withdrawal', '00000000-0000-4000-8000-000000000347'),
  ('00000000-0000-4000-8000-000000000350', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', null, 'TRANSACTIONAL', 'SMS', 'GRANTED',
   'consent_grant', '00000000-0000-4000-8000-000000000348')
on conflict do nothing;

-- Privacy export request + verified decision (append-only pair).
insert into kitluy_core.privacy_requests
  (id, tenant_id, customer_id, request_type, scope, verification_ref, requested_by, requested_at)
values
  ('00000000-0000-4000-8000-000000000351', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000324', 'EXPORT',
   '{"data_classes": ["profile", "contacts", "consent"]}', 'DEMO-VERIFY-351',
   '00000000-0000-4000-8000-000000000002', '2026-07-27T04:00:00Z')
on conflict do nothing;

insert into kitluy_core.privacy_request_decisions
  (id, privacy_request_id, decision, reason, evidence_ref, decided_by, decided_at)
values
  ('00000000-0000-4000-8000-000000000352', '00000000-0000-4000-8000-000000000351',
   'VERIFIED', 'Identity verified for demo export case (fixture)', 'DEMO-EVIDENCE-352',
   '00000000-0000-4000-8000-000000000002', '2026-07-27T04:10:00Z')
on conflict do nothing;

-- ===========================================================================
-- Cycle-6 fixtures (WS-07/WS-08, groups 0075-0095) — SYNTHETIC ONLY.
-- Personas/cases (Cycle-6 instruction §20): per-piece Booking, per-weight
-- Booking, verified intake, garment group/item/custody container, tag +
-- replacement, custody scans, Ready storage assignment, deposit-required
-- Booking, cash deposit, simulated KHQR payment, partially/fully paid
-- Bookings, refund requester + DISTINCT reviewer, reconciliation discrepancy,
-- balanced development finance posting (fictional DEV-* accounts only —
-- FIN-OD-001 open), cross-Tenant attacker fixtures. No real names, phones,
-- payment credentials or customer data. Idempotent: fixed UUIDs (..04NN) +
-- "on conflict do nothing"; the one guarded lifecycle UPDATE is version-
-- fenced so a second run matches zero rows. The finance posting runs through
-- kitluy_finance.post_journal_entry_v1 and REPLAYS on the second run
-- (source-dedupe AMD-I3) — the notice labels which path executed.
-- ===========================================================================

-- Dev permission fixtures for the WS-07/08 read policies (registry keys
-- laundry.bookings.read / payments.read; production registry seeds remain
-- migration group 0150 — these are DEV fixtures only, Cycle-5 precedent).
insert into kitluy_auth.permissions (id, permission_key, version, risk_class, resource_types, environments, status)
values
  ('00000000-0000-4000-8000-000000000460', 'laundry.bookings.read', 1, 'LOW', '{laundry_booking,garment_custody,store_location}', '{all}', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000461', 'payments.read', 1, 'LOW', '{payment,refund_request}', '{all}', 'ACTIVE')
on conflict do nothing;

insert into kitluy_auth.role_permission_grants (id, role_template_id, permission_id, effect)
values
  ('00000000-0000-4000-8000-000000000462', '00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000460', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000463', '00000000-0000-4000-8000-000000000037', '00000000-0000-4000-8000-000000000461', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000464', '00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000460', 'ALLOW'),
  ('00000000-0000-4000-8000-000000000465', '00000000-0000-4000-8000-000000000036', '00000000-0000-4000-8000-000000000461', 'ALLOW')
on conflict do nothing;

-- Booking A1: per-piece, deposit-required, PARTIALLY_PAID (cash deposit).
-- Verified intake at T1 by the cashier persona (KLD-2026-07-25-001 boundary).
insert into kitluy_orders.orders
  (id, tenant_id, digital_store_id, store_location_id, customer_id, order_number,
   vertical_code, source_code, status, currency_code, subtotal_minor,
   discount_minor, tax_minor, total_minor, required_deposit_minor, payment_state,
   due_at, intake_verified_at, intake_verified_by, idempotency_key, created_by)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000324', 'DEV-BKG-0001', 'LAUNDRY', 'WALK_IN',
   'CONFIRMED/FINALIZED', 'KHR', 6000, 0, 0, 6000, 2000, 'PARTIALLY_PAID',
   '2026-07-29T10:00:00Z', '2026-07-27T08:00:00Z',
   '00000000-0000-4000-8000-000000000004', 'DEV-BKG-0001', '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into kitluy_orders.order_lines
  (id, tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
   service_code, pricing_mode, quantity, unit_price_minor, price_version,
   currency_code, subtotal_minor, total_minor)
values
  ('00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000401', 1,
   '00000000-0000-4000-8000-000000000301', 'SHIRT-WASH', 'PER_PIECE', 3, 2000, 1,
   'KHR', 6000, 6000)
on conflict do nothing;

insert into kitluy_orders.order_events
  (id, tenant_id, order_id, event_type, from_status, to_status, from_version,
   to_version, actor_user_id, idempotency_key, occurred_at)
values
  ('00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000401', 'booking_confirmed_at_verified_intake',
   null, 'CONFIRMED/FINALIZED', null, 1,
   '00000000-0000-4000-8000-000000000004', 'DEV-EVT-0001', '2026-07-27T08:00:00Z')
on conflict do nothing;

-- Booking A2: per-weight, fully paid via simulated KHQR, production READY.
insert into kitluy_orders.orders
  (id, tenant_id, digital_store_id, store_location_id, customer_id, order_number,
   vertical_code, source_code, status, currency_code, subtotal_minor,
   discount_minor, tax_minor, total_minor, payment_state, due_at,
   intake_verified_at, intake_verified_by, idempotency_key, created_by)
values
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000326', 'DEV-BKG-0002', 'LAUNDRY', 'WALK_IN',
   'CONFIRMED/FINALIZED', 'KHR', 7500, 0, 0, 7500, 'PAID',
   '2026-07-28T17:00:00Z', '2026-07-27T08:30:00Z',
   '00000000-0000-4000-8000-000000000004', 'DEV-BKG-0002', '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into kitluy_orders.order_lines
  (id, tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
   service_code, pricing_mode, weight_grams, weight_rounding_rule,
   unit_price_minor, price_version, currency_code, subtotal_minor, total_minor)
values
  ('00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000404', 1,
   '00000000-0000-4000-8000-000000000304', 'WASH-KG', 'PER_WEIGHT', 2500,
   'round_half_up_minor_unit', 3000, 1, 'KHR', 7500, 7500)
on conflict do nothing;

insert into kitluy_orders.order_events
  (id, tenant_id, order_id, event_type, from_status, to_status, from_version,
   to_version, actor_user_id, idempotency_key, occurred_at)
values
  ('00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', 'booking_confirmed_at_verified_intake',
   null, 'CONFIRMED/FINALIZED', null, 1,
   '00000000-0000-4000-8000-000000000004', 'DEV-EVT-0002', '2026-07-27T08:30:00Z')
on conflict do nothing;

-- Guarded lifecycle transition exercised inside the seed: CONFIRMED/FINALIZED
-- -> IN_PROGRESS on Booking A2 (version-fenced; second run matches 0 rows).
update kitluy_orders.orders
  set status = 'IN_PROGRESS', version = 2
  where id = '00000000-0000-4000-8000-000000000404'
    and status = 'CONFIRMED/FINALIZED' and version = 1;

-- Production projections + history (Booking-level summary; custody events
-- remain the detailed evidence — KBR-LND §4 note).
insert into kitluy_laundry.booking_production_state
  (order_id, tenant_id, digital_store_id, store_location_id, production_status)
values
  ('00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018', 'RECEIVED'),
  ('00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018', 'READY')
on conflict do nothing;

insert into kitluy_laundry.booking_status_history
  (id, tenant_id, order_id, from_status, to_status, actor_user_id,
   idempotency_key, aggregate_version, occurred_at)
values
  ('00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000401', null, 'RECEIVED',
   '00000000-0000-4000-8000-000000000004', 'DEV-PROD-0001', 1, '2026-07-27T08:05:00Z'),
  ('00000000-0000-4000-8000-000000000408', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', null, 'RECEIVED',
   '00000000-0000-4000-8000-000000000004', 'DEV-PROD-0002', 1, '2026-07-27T08:35:00Z'),
  ('00000000-0000-4000-8000-000000000409', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', 'QA_PACKAGING', 'READY',
   '00000000-0000-4000-8000-000000000003', 'DEV-PROD-0003', 1, '2026-07-27T11:00:00Z')
on conflict do nothing;

-- Garment group (per-piece Booking), custody container then garment item
-- inside it (per-weight Booking). Active tag on the item after replacement.
insert into kitluy_laundry.garments
  (id, tenant_id, order_id, unit_kind, container_id, tag_code, garment_type,
   piece_count, status, intake_notes)
values
  ('00000000-0000-4000-8000-000000000410', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000401', 'GARMENT_GROUP', null, 'DEV-TAG-0002',
   'SHIRT_BATCH', 3, 'TAGGED', 'Demo intake batch, no defects noted (fixture)'),
  ('00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', 'CUSTODY_CONTAINER', null, null,
   'WASH_BAG', null, 'READY', null)
on conflict do nothing;

insert into kitluy_laundry.garments
  (id, tenant_id, order_id, unit_kind, container_id, tag_code, garment_type,
   status, intake_notes)
values
  ('00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', 'GARMENT_ITEM',
   '00000000-0000-4000-8000-000000000412', 'DEV-TAG-0001R', 'BULK_WASH_LOAD',
   'READY', 'Demo per-weight load (fixture)')
on conflict do nothing;

insert into kitluy_laundry.laundry_tags
  (id, tenant_id, order_id, garment_id, tag_code, template_version, issued_by,
   issued_at, voided_at, voided_by)
values
  ('00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000411',
   'DEV-TAG-0001', 'v1', '00000000-0000-4000-8000-000000000004',
   '2026-07-27T08:31:00Z', '2026-07-27T08:40:00Z', '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into kitluy_laundry.laundry_tags
  (id, tenant_id, order_id, garment_id, tag_code, template_version,
   replaces_tag_id, replacement_reason_code, issued_by, issued_at)
values
  ('00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000411',
   'DEV-TAG-0001R', 'v1', '00000000-0000-4000-8000-000000000413',
   'UNREADABLE_TAG', '00000000-0000-4000-8000-000000000004', '2026-07-27T08:40:00Z')
on conflict do nothing;

insert into kitluy_laundry.laundry_tags
  (id, tenant_id, order_id, garment_id, tag_code, template_version, issued_by, issued_at)
values
  ('00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000410',
   'DEV-TAG-0002', 'v1', '00000000-0000-4000-8000-000000000004', '2026-07-27T08:02:00Z')
on conflict do nothing;

-- Ready storage positions: occupied (A2), free spare, sibling-Location spare.
insert into kitluy_laundry.ready_storage_positions
  (id, tenant_id, digital_store_id, store_location_id, position_code,
   position_type, status)
values
  ('00000000-0000-4000-8000-000000000417', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   'DEV-POS-A1', 'SHELF', 'OCCUPIED'),
  ('00000000-0000-4000-8000-000000000419', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   'DEV-POS-A2', 'SHELF', 'AVAILABLE'),
  ('00000000-0000-4000-8000-000000000420', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000019',
   'DEV-POS-B1', 'SHELF', 'AVAILABLE')
on conflict do nothing;

-- Custody chain evidence: T1 intake scan (A1) and T3 Ready scan-in (A2, with
-- storage position) — append-only, Tenant-scoped idempotency keys.
insert into kitluy_laundry.garment_scan_events
  (id, tenant_id, digital_store_id, store_location_id, order_id, garment_id,
   scan_type, terminal_role, from_state, to_state, storage_position_id,
   actor_user_id, idempotency_key, aggregate_version, occurred_at)
values
  ('00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000410',
   'INTAKE', 'laundry.t1.intake_cashier', null, 'RECEIVED', null,
   '00000000-0000-4000-8000-000000000004', 'DEV-SCAN-0001', 1, '2026-07-27T08:01:00Z'),
  ('00000000-0000-4000-8000-000000000416', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000411',
   'READY_SCAN_IN', 'laundry.t3.ready_scan_in', 'PACKED', 'READY',
   '00000000-0000-4000-8000-000000000417',
   '00000000-0000-4000-8000-000000000003', 'DEV-SCAN-0002', 2, '2026-07-27T11:00:00Z')
on conflict do nothing;

insert into kitluy_laundry.ready_storage_assignments
  (id, tenant_id, order_id, position_id, garment_id, assigned_by, assigned_at)
values
  ('00000000-0000-4000-8000-000000000418', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000417',
   '00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000003',
   '2026-07-27T11:01:00Z')
on conflict do nothing;

-- Rewash record (open, non-blocking) on the per-weight load.
insert into kitluy_laundry.garment_exceptions
  (id, tenant_id, order_id, garment_id, exception_type, severity, description,
   blocking, opened_by, opened_at)
values
  ('00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000411',
   'REWASH', 'LOW', 'Demo rewash record: one item re-queued after QA (fixture)',
   false, '00000000-0000-4000-8000-000000000003', '2026-07-27T10:00:00Z')
on conflict do nothing;

-- Cash deposit tender on Booking A1 (CAPTURED; deposit semantics derive from
-- the engine — KBR-PAY-004 keeps "deposit policy" an input, nothing guessed).
insert into kitluy_payments.tenders
  (id, tenant_id, digital_store_id, store_location_id, order_id, method_code,
   amount_minor, applied_minor, change_due_minor, currency_code, status,
   idempotency_key, captured_at, created_by)
values
  ('00000000-0000-4000-8000-000000000425', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000401', 'CASH', 2000, 2000, 0, 'KHR',
   'CAPTURED', 'DEV-PAY-0001', '2026-07-27T08:02:00Z',
   '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into kitluy_payments.payment_status_history
  (id, tenant_id, tender_id, from_status, to_status, actor_user_id, occurred_at)
values
  ('00000000-0000-4000-8000-000000000426', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000425', 'PENDING', 'CAPTURED',
   '00000000-0000-4000-8000-000000000004', '2026-07-27T08:02:00Z')
on conflict do nothing;

-- Simulated KHQR payment on Booking A2 (verified simulator callback — the
-- provider is [REQUIRED] PAY-OD-001/BLK-006; DEV_KHQR_SIM is clearly fictional).
insert into kitluy_payments.tenders
  (id, tenant_id, digital_store_id, store_location_id, order_id, method_code,
   amount_minor, applied_minor, currency_code, status, provider_key,
   idempotency_key, captured_at, created_by)
values
  ('00000000-0000-4000-8000-000000000427', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
   '00000000-0000-4000-8000-000000000404', 'KHQR', 7500, 7500, 'KHR',
   'CAPTURED', 'DEV_KHQR_SIM', 'DEV-PAY-0002', '2026-07-27T08:45:00Z',
   '00000000-0000-4000-8000-000000000004')
on conflict do nothing;

insert into kitluy_payments.payment_attempts
  (id, tenant_id, tender_id, provider_key, provider_attempt_ref, status, attempted_at)
values
  ('00000000-0000-4000-8000-000000000428', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000427', 'DEV_KHQR_SIM', 'DEV-KHQR-ATT-0001',
   'SUCCEEDED', '2026-07-27T08:44:00Z')
on conflict do nothing;

insert into kitluy_payments.khqr_transactions
  (id, tenant_id, tender_id, merchant_ref, qr_payload_hash, amount_minor,
   currency_code, status, provider_transaction_id, expires_at, confirmed_at)
values
  ('00000000-0000-4000-8000-000000000429', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000427', 'DEV-KHQR-0001',
   'f1c7000000000000000000000000000000000000000000000000000000000dee',
   7500, 'KHR', 'SUCCEEDED', 'DEV-PTX-0001', '2026-07-27T09:00:00Z',
   '2026-07-27T08:45:00Z')
on conflict do nothing;

insert into kitluy_payments.payment_provider_events
  (id, tenant_id, tender_id, provider_key, provider_event_id,
   provider_transaction_id, signature_valid, payload_hash,
   reported_amount_minor, reported_currency_code, status, received_at, processed_at)
values
  ('00000000-0000-4000-8000-000000000430', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000427', 'DEV_KHQR_SIM', 'DEV-EVT-KHQR-0001',
   'DEV-PTX-0001', true,
   'e0e7000000000000000000000000000000000000000000000000000000000dee',
   7500, 'KHR', 'APPLIED', '2026-07-27T08:45:00Z', '2026-07-27T08:45:01Z')
on conflict do nothing;

insert into kitluy_payments.payment_status_history
  (id, tenant_id, tender_id, from_status, to_status, actor_user_id, occurred_at)
values
  ('00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000427', 'PENDING', 'CAPTURED',
   '00000000-0000-4000-8000-000000000004', '2026-07-27T08:45:00Z')
on conflict do nothing;

-- Refund with a DISTINCT reviewer (four-eyes: requester u07, approver u08 —
-- thresholds PAY-OD-002 open, approval ALWAYS required in dev fixtures).
insert into kitluy_auth.approval_requests
  (id, policy_id, requester_id, resource_type, resource_id, environment, action,
   payload_hash, reason, status, expires_at)
values
  ('00000000-0000-4000-8000-000000000433', '00000000-0000-4000-8000-000000000050',
   '00000000-0000-4000-8000-000000000007', 'refund_request',
   '00000000-0000-4000-8000-000000000427', 'development', 'payments.refund.approve',
   'b4f1000000000000000000000000000000000000000000000000000000000dee',
   'Demo refund approval request (fixture)', 'PENDING', '2026-12-31T00:00:00Z')
on conflict do nothing;

insert into kitluy_auth.approval_decisions
  (id, approval_request_id, approver_id, decision, reason, decided_at)
values
  ('00000000-0000-4000-8000-000000000434', '00000000-0000-4000-8000-000000000433',
   '00000000-0000-4000-8000-000000000008', 'APPROVED',
   'Demo four-eyes refund approval by a distinct reviewer (fixture)',
   '2026-07-27T09:00:00Z')
on conflict do nothing;

insert into kitluy_payments.refunds
  (id, tenant_id, digital_store_id, order_id, tender_id, amount_minor,
   currency_code, reason_code, status, requested_by, requested_at,
   approval_request_id, approved_by, approved_at, idempotency_key)
values
  ('00000000-0000-4000-8000-000000000432', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000404',
   '00000000-0000-4000-8000-000000000427', 1000, 'KHR', 'DEV_REFUND_TEST',
   'APPROVED', '00000000-0000-4000-8000-000000000007', '2026-07-27T08:55:00Z',
   '00000000-0000-4000-8000-000000000433', '00000000-0000-4000-8000-000000000008',
   '2026-07-27T09:00:00Z', 'DEV-REF-0001')
on conflict do nothing;

-- Reconciliation discrepancy under review + settlement reference with fee
-- composition (gross = fee + net). Internal simulator evidence only —
-- provider confirmation is never settlement or reconciliation (KBR-PAY-009).
insert into kitluy_payments.payment_reconciliations
  (id, tenant_id, digital_store_id, scope, period_start, period_end,
   provider_key, currency_code, status, source_as_of)
values
  ('00000000-0000-4000-8000-000000000436', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000015', 'PROVIDER_DAILY', '2026-07-26',
   '2026-07-26', 'DEV_KHQR_SIM', 'KHR', 'EXCEPTIONS_FOUND',
   '2026-07-27T00:00:00Z')
on conflict do nothing;

insert into kitluy_payments.payment_reconciliation_lines
  (id, tenant_id, reconciliation_id, tender_id, provider_transaction_ref,
   expected_minor, actual_minor, difference_minor, currency_code, status,
   difference_reason_code, review_status)
values
  ('00000000-0000-4000-8000-000000000437', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000436', '00000000-0000-4000-8000-000000000427',
   'DEV-PTX-0001', 7500, 7400, -100, 'KHR', 'SETTLEMENT_AMOUNT_MISMATCH',
   'DEV_PROVIDER_FEE_UNDER_REVIEW', 'PENDING_REVIEW')
on conflict do nothing;

insert into kitluy_payments.settlement_refs
  (id, tenant_id, tender_id, provider_key, settlement_id, settled_amount_minor,
   fee_minor, net_minor, currency_code, settled_at, reconciliation_status)
values
  ('00000000-0000-4000-8000-000000000438', '00000000-0000-4000-8000-000000000011',
   '00000000-0000-4000-8000-000000000427', 'DEV_KHQR_SIM', 'DEV-SETL-0001',
   7500, 100, 7400, 'KHR', '2026-07-27T02:00:00Z', 'MATCHED_WITH_FEE')
on conflict do nothing;

-- Fictional development subledger accounts (mechanism proof only; the
-- canonical chart of accounts is open owner value FIN-OD-001).
insert into kitluy_finance.subledger_accounts
  (id, tenant_id, digital_store_id, account_code, account_class, normal_side, status)
values
  ('00000000-0000-4000-8000-000000000440', '00000000-0000-4000-8000-000000000011',
   null, 'DEV-CASH-DRAWER', 'DEV_FIXTURE', 'DEBIT', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000441', '00000000-0000-4000-8000-000000000011',
   null, 'DEV-ACCOUNTS-RECEIVABLE', 'DEV_FIXTURE', 'DEBIT', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000442', '00000000-0000-4000-8000-000000000011',
   null, 'DEV-PROVIDER-CLEARING', 'DEV_FIXTURE', 'DEBIT', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000443', '00000000-0000-4000-8000-000000000011',
   null, 'DEV-TENDER-ASSET', 'DEV_FIXTURE', 'DEBIT', 'ACTIVE'),
  ('00000000-0000-4000-8000-000000000456', '00000000-0000-4000-8000-000000000012',
   null, 'DEV-ATK-CASH', 'DEV_FIXTURE', 'DEBIT', 'ACTIVE')
on conflict do nothing;

-- Balanced development finance posting through the ONLY journal write path
-- (post_journal_entry_v1). First run posts; the second run REPLAYS via the
-- AMD-I3 source dedupe — the notice records which path executed.
do $$
declare
  v_result jsonb;
begin
  v_result := kitluy_finance.post_journal_entry_v1(
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000018',
    date '2026-07-27',
    'DEV_PAYMENT_POSTING',
    'DEV-RULE-CASH-TENDER',
    '1',
    'TENDER',
    '00000000-0000-4000-8000-000000000425',
    'DEV-SRC-HASH-0001',
    'KHR',
    null,
    'Dev fixture: balanced cash-tender posting (fictional accounts)',
    '00000000-0000-4000-8000-000000000004',
    null,
    'DEV-FINPOST-0001',
    jsonb_build_array(
      jsonb_build_object(
        'line_no', 1,
        'subledger_account_id', '00000000-0000-4000-8000-000000000440',
        'direction', 'DEBIT',
        'amount_minor', 2000,
        'memo', 'Dev cash drawer'
      ),
      jsonb_build_object(
        'line_no', 2,
        'subledger_account_id', '00000000-0000-4000-8000-000000000441',
        'direction', 'CREDIT',
        'amount_minor', 2000,
        'memo', 'Dev receivable settle'
      )
    )
  );
  raise notice 'PASS fixture finance posting: replayed=%', v_result ->> 'replayed';
end $$;

-- Cross-Tenant attacker fixtures (Tenant B): Location, finalized Booking,
-- production state and captured cash tender for isolation probes.
insert into kitluy_core.store_locations
  (id, tenant_id, digital_store_id, location_code, name, operating_status)
values
  ('00000000-0000-4000-8000-000000000450', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', 'ATK-PP-01',
   'Tenant B Location (isolation fixture)', 'ACTIVE')
on conflict do nothing;

insert into kitluy_orders.orders
  (id, tenant_id, digital_store_id, store_location_id, customer_id, order_number,
   vertical_code, source_code, status, currency_code, subtotal_minor,
   discount_minor, tax_minor, total_minor, payment_state, intake_verified_at,
   intake_verified_by, idempotency_key, created_by)
values
  ('00000000-0000-4000-8000-000000000452', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000450',
   '00000000-0000-4000-8000-000000000340', 'ATK-BKG-0001', 'LAUNDRY', 'WALK_IN',
   'CONFIRMED/FINALIZED', 'KHR', 1800, 0, 0, 1800, 'PAID',
   '2026-07-27T08:00:00Z', '00000000-0000-4000-8000-000000000006',
   'ATK-BKG-0001', '00000000-0000-4000-8000-000000000006')
on conflict do nothing;

insert into kitluy_orders.order_lines
  (id, tenant_id, digital_store_id, order_id, line_no, catalog_item_id,
   service_code, pricing_mode, quantity, unit_price_minor, price_version,
   currency_code, subtotal_minor, total_minor)
values
  ('00000000-0000-4000-8000-000000000453', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000452', 1,
   '00000000-0000-4000-8000-000000000313', 'ATK-WASH', 'PER_PIECE', 1, 1800, 1,
   'KHR', 1800, 1800)
on conflict do nothing;

insert into kitluy_laundry.booking_production_state
  (order_id, tenant_id, digital_store_id, store_location_id, production_status)
values
  ('00000000-0000-4000-8000-000000000452', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000450',
   'RECEIVED')
on conflict do nothing;

insert into kitluy_payments.tenders
  (id, tenant_id, digital_store_id, store_location_id, order_id, method_code,
   amount_minor, applied_minor, change_due_minor, currency_code, status,
   idempotency_key, captured_at, created_by)
values
  ('00000000-0000-4000-8000-000000000455', '00000000-0000-4000-8000-000000000012',
   '00000000-0000-4000-8000-000000000017', '00000000-0000-4000-8000-000000000450',
   '00000000-0000-4000-8000-000000000452', 'CASH', 1800, 1800, 0, 'KHR',
   'CAPTURED', 'ATK-PAY-0001', '2026-07-27T08:05:00Z',
   '00000000-0000-4000-8000-000000000006')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Case 17 (WS-12-T002): DEV v1 policy versions for the five 0186 consent
-- purposes. Notice text is SYNTHETIC fixture material — the production
-- versions are owner legal values and are never seeded (0186 §4 guard
-- refuses versions arriving from a migration).
-- ---------------------------------------------------------------------------
insert into kitluy_core.consent_purpose_versions
  (consent_purpose_id, version, policy_ref, notice_text, effective_from)
select p.id, 1, 'DEMO-' || upper(p.purpose_key),
       'Demo notice v1 (fixture) for ' || p.purpose_key,
       '2026-08-06T00:00:00Z'
  from kitluy_core.consent_purposes p
 where p.purpose_key in ('privacy_notice_acknowledgement', 'operational_communication',
                         'sms_marketing', 'telegram_marketing', 'email_marketing')
   and not exists (select 1 from kitluy_core.consent_purpose_versions v
                    where v.consent_purpose_id = p.id and v.version = 1);
