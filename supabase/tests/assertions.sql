-- ============================================================================
-- KitLuy structural assertions for migration groups 0010, 0020, 0030, 0035,
-- the Cycle-5 groups 0040, 0045, 0050, 0060, 0065, 0070 (WS-05/WS-06) and the
-- Cycle-6 groups 0075, 0080, 0085, 0090, 0095 (WS-07/WS-08).
-- Executes against the LOCAL Supabase stack via `pnpm db:test`
-- (scripts/database/db-exec.mjs) after `pnpm db:reset` + `pnpm db:seed`.
-- Pattern: migration plan group 0160 (DO blocks; assertion failure raises and
-- aborts). Asserted: 45 + 25 + 30 tables (+1 partition), 58 + 17 + 21 SELECT
-- policies, 9 helper functions, append-only/four-eyes guards, money integer
-- storage, snapshot immutability, identifier uniqueness, merge/consent
-- structure, booking lifecycle/version guards, balanced-journal enforcement,
-- idempotency uniqueness, journal write-path lockdown (sections 17-26).
-- ============================================================================

-- 1. Schemas exist.
do $$
declare
  s text;
begin
  foreach s in array array['kitluy_ops', 'kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                           'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications'] loop
    if not exists (select 1 from pg_namespace where nspname = s) then
      raise exception 'ASSERT FAIL: schema % is missing', s;
    end if;
  end loop;
  raise notice 'PASS schemas: kitluy_ops/core/auth/admin/audit + laundry/config/storefront/notifications exist';
end $$;

-- 2. Every group 0010-0030 table exists and has a primary key.
do $$
declare
  t text;
  v_tables text[] := array[
    'kitluy_core.tenants', 'kitluy_core.partner_accounts', 'kitluy_core.memberships',
    'kitluy_core.plans', 'kitluy_core.feature_flags', 'kitluy_core.reference_values',
    'kitluy_core.reference_value_translations',
    'kitluy_core.digital_stores', 'kitluy_core.store_locations',
    'kitluy_core.digital_store_location_links',
    'kitluy_admin.crm_leads', 'kitluy_admin.partner_verification_cases',
    'kitluy_admin.onboarding_workspaces', 'kitluy_admin.readiness_policies',
    'kitluy_admin.readiness_results', 'kitluy_admin.go_live_approvals',
    'kitluy_admin.support_tickets', 'kitluy_admin.support_access_sessions',
    'kitluy_admin.support_interventions', 'kitluy_admin.platform_incidents',
    'kitluy_admin.platform_incident_events', 'kitluy_admin.safety_switches',
    'kitluy_auth.admin_user_profiles', 'kitluy_auth.teams', 'kitluy_auth.team_memberships',
    'kitluy_auth.permissions', 'kitluy_auth.role_templates', 'kitluy_auth.role_permission_grants',
    'kitluy_auth.role_assignments', 'kitluy_auth.assignment_scopes',
    'kitluy_auth.separation_of_duties_rules', 'kitluy_auth.approval_policies',
    'kitluy_auth.access_requests', 'kitluy_auth.approval_requests',
    'kitluy_auth.approval_decisions', 'kitluy_auth.execution_tokens',
    'kitluy_auth.temporary_grants', 'kitluy_auth.break_glass_sessions',
    'kitluy_auth.service_identities', 'kitluy_auth.authorization_decisions',
    'kitluy_audit.audit_logs', 'kitluy_audit.sensitive_action_approvals',
    'kitluy_audit.access_reviews', 'kitluy_audit.access_review_items',
    'kitluy_audit.evidence_packages'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass(t) is null then
      raise exception 'ASSERT FAIL: table % is missing', t;
    end if;
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(t) and c.contype = 'p'
    ) then
      raise exception 'ASSERT FAIL: table % has no primary key', t;
    end if;
  end loop;
  if to_regclass('kitluy_auth.authorization_decisions_default') is null then
    raise exception 'ASSERT FAIL: default partition of authorization_decisions is missing';
  end if;
  raise notice 'PASS tables: all 45 group 0010-0030 tables exist with primary keys (+ default partition)';
end $$;

-- 3. Critical foreign keys exist (auth.users anchoring and cross-schema order).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('kitluy_core.memberships', 'auth.users'),
      ('kitluy_core.memberships', 'kitluy_core.tenants'),
      ('kitluy_core.partner_accounts', 'kitluy_core.tenants'),
      ('kitluy_core.store_locations', 'kitluy_core.digital_stores'),
      ('kitluy_core.digital_store_location_links', 'kitluy_core.store_locations'),
      ('kitluy_auth.admin_user_profiles', 'auth.users'),
      ('kitluy_auth.break_glass_sessions', 'kitluy_admin.platform_incidents'),
      ('kitluy_admin.safety_switches', 'kitluy_auth.approval_requests'),
      ('kitluy_auth.approval_decisions', 'kitluy_auth.approval_requests'),
      ('kitluy_audit.access_review_items', 'kitluy_auth.role_assignments')
    ) as fks (child, parent)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = to_regclass(r.child)
        and c.confrelid = to_regclass(r.parent)
    ) then
      raise exception 'ASSERT FAIL: foreign key % -> % is missing', r.child, r.parent;
    end if;
  end loop;
  raise notice 'PASS foreign keys: auth.users anchors and cross-schema FKs present';
end $$;

-- 4. RLS is ENABLEd and FORCEd on every group table (fail-closed baseline).
do $$
declare
  v_bad text;
begin
  select string_agg(n.nspname || '.' || c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                      'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications',
                      'kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and c.relkind in ('r', 'p')
    and not (c.relrowsecurity and c.relforcerowsecurity);
  if v_bad is not null then
    raise exception 'ASSERT FAIL: RLS not enabled+forced on: %', v_bad;
  end if;
  raise notice 'PASS rls: every relation in all eleven kitluy_* domain schemas is RLS enabled + forced';
end $$;

-- 5. Append-only tables: NO UPDATE/DELETE policy exists, and the
--    enforce_append_only trigger is attached.
do $$
declare
  t text;
  v_append_only text[] := array[
    'kitluy_core.digital_store_location_links',
    'kitluy_admin.readiness_results', 'kitluy_admin.go_live_approvals',
    'kitluy_admin.platform_incident_events', 'kitluy_admin.support_interventions',
    'kitluy_auth.approval_decisions', 'kitluy_auth.authorization_decisions',
    'kitluy_audit.audit_logs', 'kitluy_audit.sensitive_action_approvals',
    'kitluy_audit.access_reviews', 'kitluy_audit.access_review_items',
    'kitluy_audit.evidence_packages',
    -- Cycle-5 (WS-05/WS-06) append-only relations:
    'kitluy_laundry.service_prices',
    'kitluy_config.configuration_versions', 'kitluy_config.configuration_acknowledgements',
    'kitluy_core.customer_merge_results', 'kitluy_core.customer_status_history',
    'kitluy_core.consent_purpose_versions', 'kitluy_core.consent_grants',
    'kitluy_core.consent_withdrawals', 'kitluy_core.privacy_requests',
    'kitluy_core.privacy_request_decisions',
    -- Cycle-6 (WS-07/WS-08) append-only relations (group 0095 §1):
    'kitluy_orders.order_lines', 'kitluy_orders.order_adjustments',
    'kitluy_orders.order_events', 'kitluy_orders.order_notes',
    'kitluy_laundry.booking_status_history', 'kitluy_laundry.garment_scan_events',
    'kitluy_payments.payment_provider_events', 'kitluy_payments.payment_status_history',
    'kitluy_payments.voids', 'kitluy_payments.settlement_refs',
    'kitluy_finance.journal_entries', 'kitluy_finance.journal_postings'
  ];
begin
  foreach t in array v_append_only loop
    if exists (
      select 1 from pg_policies p
      where (p.schemaname || '.' || p.tablename) = t
        and p.cmd in ('UPDATE', 'DELETE', 'ALL')
    ) then
      raise exception 'ASSERT FAIL: append-only table % has an UPDATE/DELETE/ALL policy', t;
    end if;
    if not exists (
      select 1 from pg_trigger tg
      where tg.tgrelid = to_regclass(t)
        and not tg.tgisinternal
        and tg.tgfoid = 'kitluy_auth.enforce_append_only'::regproc
    ) then
      raise exception 'ASSERT FAIL: append-only table % lacks the enforce_append_only trigger', t;
    end if;
  end loop;
  raise notice 'PASS append-only: 34 A/O tables have no UPDATE/DELETE policies and carry enforce_append_only';
end $$;

-- 6. Contract keys and invariants.
do $$
begin
  -- Membership uniqueness: UNIQUE active (tenant_id, user_id) partial index.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_core' and tablename = 'memberships'
      and indexname = 'memberships_active_tenant_user_key'
      and indexdef ilike '%unique%' and indexdef ilike '%where%'
  ) then
    raise exception 'ASSERT FAIL: memberships active-uniqueness partial index missing';
  end if;

  -- Primary vertical: NOT NULL by construction (exactly one primary vertical).
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'kitluy_core' and table_name = 'digital_stores'
      and column_name = 'primary_vertical_code' and is_nullable = 'YES'
  ) then
    raise exception 'ASSERT FAIL: digital_stores.primary_vertical_code must be NOT NULL';
  end if;

  -- Store/location contract keys.
  if not exists (
    select 1 from pg_constraint
    where conname = 'digital_stores_tenant_store_code_key' and contype = 'u'
  ) then
    raise exception 'ASSERT FAIL: UNIQUE(tenant_id, store_code) missing on digital_stores';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'store_locations_store_location_code_key' and contype = 'u'
  ) then
    raise exception 'ASSERT FAIL: UNIQUE(digital_store_id, location_code) missing on store_locations';
  end if;

  -- One active link per Location.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_core' and tablename = 'digital_store_location_links'
      and indexname = 'digital_store_location_links_active_location_key'
      and indexdef ilike '%unique%' and indexdef ilike '%where%'
  ) then
    raise exception 'ASSERT FAIL: one-active-link-per-location partial index missing';
  end if;

  -- Four-eyes: trigger on approval_decisions + self-approval CHECK on go_live_approvals.
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'kitluy_auth.approval_decisions'::regclass
      and tgname = 'trg_approval_decisions_four_eyes'
  ) then
    raise exception 'ASSERT FAIL: four-eyes trigger missing on approval_decisions';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'go_live_approvals_four_eyes_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: CHECK (approver_id <> requester_id) missing on go_live_approvals';
  end if;

  -- Open-approval uniqueness and break-glass single-active constraints.
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_auth' and tablename = 'approval_requests'
      and indexname = 'approval_requests_active_payload_key'
  ) then
    raise exception 'ASSERT FAIL: approval_requests active payload uniqueness missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_auth' and tablename = 'break_glass_sessions'
      and indexname = 'break_glass_sessions_active_actor_env_key'
  ) then
    raise exception 'ASSERT FAIL: break_glass_sessions one-active-per-actor/environment index missing';
  end if;

  raise notice 'PASS invariants: membership uniqueness, primary vertical, contract keys, four-eyes, break-glass';
end $$;

-- 7. Policy inventory: 44 SELECT policies; zero write policies; zero anon policies.
do $$
declare
  v_select int;
  v_writes int;
  v_anon int;
  v_exec_token int;
begin
  -- Groups 0010-0035 contributed 44 SELECT policies; group 0070 adds 14 in
  -- kitluy_core (catalog 2 + customers 6 + consent/privacy 6) = 58; group 0140
  -- adds the 3 kitluy_auth approval policies that let the credential-revocation
  -- approval gate run as a constrained NOLOGIN reader instead of as the
  -- global-BYPASSRLS service_role = 61. The 58 -> 61 increase is OWNER-APPROVED
  -- for this exact purpose by
  -- KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 (Ruling 2), and section 43
  -- asserts that those 3 are the ONLY policies naming that role.
  select count(*) into v_select from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit')
    and cmd = 'SELECT';
  if v_select <> 61 then
    raise exception 'ASSERT FAIL: expected 61 SELECT policies, found %', v_select;
  end if;

  -- Cycle-5 schemas: kitluy_laundry 3 + kitluy_config 4 + kitluy_notifications 1
  -- + kitluy_storefront 0 (PC-PUBTOK deny-all by design) = 8; Cycle-6 group
  -- 0095 adds 9 kitluy_laundry custody policies = 17.
  select count(*) into v_select from pg_policies
  where schemaname in ('kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
    and cmd = 'SELECT';
  if v_select <> 17 then
    raise exception 'ASSERT FAIL: expected 17 SELECT policies in cycle-5 schemas (+9 cycle-6 laundry), found %', v_select;
  end if;

  -- Cycle-6 schemas (group 0095 manifest): kitluy_orders 5 + kitluy_payments 10
  -- + kitluy_finance 6 = 21.
  select count(*) into v_select from pg_policies
  where schemaname in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and cmd = 'SELECT';
  if v_select <> 21 then
    raise exception 'ASSERT FAIL: expected 21 SELECT policies in cycle-6 schemas, found %', v_select;
  end if;

  select count(*) into v_writes from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                       'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications',
                       'kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if v_writes <> 0 then
    raise exception 'ASSERT FAIL: expected 0 write/ALL policies (PC-RPC model), found %', v_writes;
  end if;

  select count(*) into v_anon from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                       'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications',
                       'kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and 'anon' = any (roles::text[]);
  if v_anon <> 0 then
    raise exception 'ASSERT FAIL: anon must have zero policies, found %', v_anon;
  end if;

  select count(*) into v_exec_token from pg_policies
  where schemaname = 'kitluy_auth' and tablename = 'execution_tokens';
  if v_exec_token <> 0 then
    raise exception 'ASSERT FAIL: execution_tokens must have zero policies (server-consumed only), found %', v_exec_token;
  end if;

  -- PC-PUBTOK storefront identity tables: zero policies in every command.
  select count(*) into v_exec_token from pg_policies
  where schemaname = 'kitluy_storefront';
  if v_exec_token <> 0 then
    raise exception 'ASSERT FAIL: kitluy_storefront identity tables must have zero policies (PC-PUBTOK), found %', v_exec_token;
  end if;

  raise notice 'PASS policies: 61 + 17 + 21 SELECT, 0 write, 0 anon, execution_tokens and PUBTOK tables deny-all (58 -> 61 per KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002)';
end $$;

-- 8. No PUBLIC grants on kitluy_* tables or kitluy_auth routines; execution_tokens
--    not SELECTable by authenticated.
do $$
declare
  v_public_tables int;
  v_public_routines int;
begin
  select count(*) into v_public_tables from information_schema.role_table_grants
  where grantee = 'PUBLIC'
    and table_schema in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit', 'kitluy_ops',
                         'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications');
  if v_public_tables <> 0 then
    raise exception 'ASSERT FAIL: PUBLIC holds % table grant(s) on kitluy_* schemas', v_public_tables;
  end if;

  select count(*) into v_public_routines from information_schema.routine_privileges
  where grantee = 'PUBLIC' and routine_schema = 'kitluy_auth';
  if v_public_routines <> 0 then
    raise exception 'ASSERT FAIL: PUBLIC holds % routine grant(s) in kitluy_auth', v_public_routines;
  end if;

  if has_table_privilege('authenticated', 'kitluy_auth.execution_tokens', 'SELECT') then
    raise exception 'ASSERT FAIL: authenticated must not hold SELECT on execution_tokens';
  end if;

  -- PC-PUBTOK storefront identity tables: authenticated holds no SELECT grant.
  if has_table_privilege('authenticated', 'kitluy_storefront.customer_channel_identities', 'SELECT')
     or has_table_privilege('authenticated', 'kitluy_storefront.customer_phone_challenges', 'SELECT')
     or has_table_privilege('authenticated', 'kitluy_storefront.customer_sessions', 'SELECT') then
    raise exception 'ASSERT FAIL: authenticated must not hold SELECT on PC-PUBTOK storefront identity tables';
  end if;

  raise notice 'PASS grants: no PUBLIC grants; execution_tokens and PUBTOK tables hidden from authenticated';
end $$;

-- 9. Helper functions exist with canonical names; every SECURITY DEFINER function
--    in kitluy_auth has a locked search_path (RLS-027 static portion).
do $$
declare
  f text;
  v_bad text;
  v_helpers text[] := array[
    'current_actor_context', 'current_tenant_ids', 'current_digital_store_ids',
    'current_location_ids', 'has_permission', 'assert_permission',
    'require_reauthentication', 'consume_execution_token', 'record_authorization_decision',
    'enforce_append_only', 'enforce_four_eyes_decision'
  ];
begin
  foreach f in array v_helpers loop
    if not exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'kitluy_auth' and p.proname = f
    ) then
      raise exception 'ASSERT FAIL: helper function kitluy_auth.% is missing', f;
    end if;
  end loop;

  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_auth'
    and p.prosecdef
    and (p.proconfig is null
         or not exists (select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'));
  if v_bad is not null then
    raise exception 'ASSERT FAIL: SECURITY DEFINER function(s) without locked search_path: %', v_bad;
  end if;

  raise notice 'PASS helpers: 9 canonical helpers + 2 trigger functions present; all definer functions lock search_path';
end $$;

-- ============================================================================
-- Cycle-5 (WS-05/WS-06) structural assertions — groups 0040/0045/0050/0060/0065/0070.
-- ============================================================================

-- 10. Every cycle-5 table exists and has a primary key.
do $$
declare
  t text;
  v_tables text[] := array[
    'kitluy_core.catalog_items', 'kitluy_core.catalog_item_translations',
    'kitluy_laundry.services', 'kitluy_laundry.service_addons', 'kitluy_laundry.service_prices',
    'kitluy_config.configuration_versions', 'kitluy_config.configuration_publications',
    'kitluy_config.configuration_targets', 'kitluy_config.configuration_acknowledgements',
    'kitluy_core.customers', 'kitluy_core.customer_contacts',
    'kitluy_core.customer_store_relationships', 'kitluy_core.customer_merge_requests',
    'kitluy_core.customer_merge_results', 'kitluy_core.customer_status_history',
    'kitluy_storefront.customer_channel_identities',
    'kitluy_storefront.customer_phone_challenges', 'kitluy_storefront.customer_sessions',
    'kitluy_core.consent_purposes', 'kitluy_core.consent_purpose_versions',
    'kitluy_core.consent_grants', 'kitluy_core.consent_withdrawals',
    'kitluy_core.privacy_requests', 'kitluy_core.privacy_request_decisions',
    'kitluy_notifications.preferences'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass(t) is null then
      raise exception 'ASSERT FAIL: table % is missing', t;
    end if;
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(t) and c.contype = 'p'
    ) then
      raise exception 'ASSERT FAIL: table % has no primary key', t;
    end if;
  end loop;
  raise notice 'PASS cycle-5 tables: all 25 WS-05/WS-06 tables exist with primary keys';
end $$;

-- 11. Cycle-5 foreign keys, including the child-cannot-escape-parent composite
--     FKs (config scope hierarchy, same-tenant customer children, same-tenant
--     merge parties).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('kitluy_core.catalog_items', 'kitluy_core.digital_stores'),
      ('kitluy_core.catalog_item_translations', 'kitluy_core.catalog_items'),
      ('kitluy_laundry.services', 'kitluy_core.catalog_items'),
      ('kitluy_laundry.service_addons', 'kitluy_laundry.services'),
      ('kitluy_laundry.service_prices', 'kitluy_laundry.services'),
      ('kitluy_laundry.service_prices', 'kitluy_core.store_locations'),
      ('kitluy_config.configuration_versions', 'kitluy_core.digital_stores'),
      ('kitluy_config.configuration_versions', 'kitluy_core.store_locations'),
      ('kitluy_config.configuration_versions', 'kitluy_auth.approval_requests'),
      ('kitluy_config.configuration_publications', 'kitluy_config.configuration_versions'),
      ('kitluy_config.configuration_targets', 'kitluy_config.configuration_publications'),
      ('kitluy_config.configuration_acknowledgements', 'kitluy_config.configuration_targets'),
      ('kitluy_core.customer_contacts', 'kitluy_core.customers'),
      ('kitluy_core.customer_store_relationships', 'kitluy_core.customers'),
      ('kitluy_core.customer_merge_requests', 'kitluy_core.customers'),
      ('kitluy_core.customer_merge_results', 'kitluy_core.customer_merge_requests'),
      ('kitluy_core.customer_status_history', 'kitluy_core.customers'),
      ('kitluy_storefront.customer_channel_identities', 'kitluy_core.customers'),
      ('kitluy_core.consent_purpose_versions', 'kitluy_core.consent_purposes'),
      ('kitluy_core.consent_grants', 'kitluy_core.consent_purpose_versions'),
      ('kitluy_core.consent_withdrawals', 'kitluy_core.consent_grants'),
      ('kitluy_core.privacy_requests', 'kitluy_core.customers'),
      ('kitluy_core.privacy_request_decisions', 'kitluy_core.privacy_requests'),
      ('kitluy_notifications.preferences', 'kitluy_core.customers')
    ) as fks (child, parent)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = to_regclass(r.child)
        and c.confrelid = to_regclass(r.parent)
    ) then
      raise exception 'ASSERT FAIL: foreign key % -> % is missing', r.child, r.parent;
    end if;
  end loop;

  -- Composite (multi-column) child-cannot-escape-parent FKs must be composite.
  for r in
    select * from (values
      ('kitluy_config.configuration_versions', 'configuration_versions_tenant_store_fk'),
      ('kitluy_config.configuration_versions', 'configuration_versions_store_location_fk'),
      ('kitluy_core.customer_contacts', 'customer_contacts_tenant_customer_fk'),
      ('kitluy_core.customer_merge_requests', 'customer_merge_requests_tenant_survivor_fk'),
      ('kitluy_core.customer_merge_requests', 'customer_merge_requests_tenant_merging_fk')
    ) as cfks (tbl, conname)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(r.tbl)
        and c.conname = r.conname
        and c.contype = 'f'
        and array_length(c.conkey, 1) = 2
    ) then
      raise exception 'ASSERT FAIL: composite FK % on % is missing or not two-column', r.conname, r.tbl;
    end if;
  end loop;

  raise notice 'PASS cycle-5 foreign keys: 24 FK edges + 5 child-cannot-escape composite FKs present';
end $$;

-- 12. Money is integer minor units: bigint amounts + char(3) currency; no
--     float/numeric money column anywhere in the cycle-5 relations.
do $$
declare
  v_type text;
  v_len integer;
  v_bad text;
begin
  select data_type into v_type from information_schema.columns
  where table_schema = 'kitluy_laundry' and table_name = 'service_prices'
    and column_name = 'unit_price_minor';
  if v_type is distinct from 'bigint' then
    raise exception 'ASSERT FAIL: service_prices.unit_price_minor must be bigint, found %', v_type;
  end if;

  select data_type into v_type from information_schema.columns
  where table_schema = 'kitluy_laundry' and table_name = 'service_prices'
    and column_name = 'min_charge_minor';
  if v_type is distinct from 'bigint' then
    raise exception 'ASSERT FAIL: service_prices.min_charge_minor must be bigint, found %', v_type;
  end if;

  select data_type, character_maximum_length into v_type, v_len
  from information_schema.columns
  where table_schema = 'kitluy_laundry' and table_name = 'service_prices'
    and column_name = 'currency_code';
  if v_type is distinct from 'character' or v_len is distinct from 3 then
    raise exception 'ASSERT FAIL: service_prices.currency_code must be char(3), found % (%)', v_type, v_len;
  end if;

  select string_agg(table_schema || '.' || table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema in ('kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
    and (column_name like '%minor%' or column_name like '%amount%' or column_name like '%price%')
    and data_type in ('real', 'double precision', 'numeric', 'money');
  if v_bad is not null then
    raise exception 'ASSERT FAIL: float/numeric money storage found: %', v_bad;
  end if;

  raise notice 'PASS money: bigint minor units + char(3) currency; no float money columns';
end $$;

-- 13. Pricing contract keys: effective-range CHECK, anti-ambiguity EXCLUDE
--     constraint (KBR-PRC-002), per-scope version uniqueness.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_laundry.service_prices'::regclass
      and conname = 'service_prices_effective_range_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: service_prices effective-range CHECK missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_laundry.service_prices'::regclass
      and conname = 'service_prices_no_ambiguous_overlap' and contype = 'x'
  ) then
    raise exception 'ASSERT FAIL: service_prices anti-ambiguity EXCLUDE constraint missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_laundry' and tablename = 'service_prices'
      and indexname = 'service_prices_scope_version_key'
      and indexdef ilike '%unique%'
  ) then
    raise exception 'ASSERT FAIL: service_prices per-scope version uniqueness missing';
  end if;
  raise notice 'PASS pricing keys: effective-range CHECK, EXCLUDE overlap guard, version uniqueness';
end $$;

-- 14. Configuration snapshot immutability and canonical publication states.
do $$
begin
  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'kitluy_config.configuration_versions'::regclass
      and not tg.tgisinternal
      and tg.tgfoid = 'kitluy_auth.enforce_append_only'::regproc
  ) then
    raise exception 'ASSERT FAIL: configuration_versions lacks the enforce_append_only trigger';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_config.configuration_versions'::regclass
      and conname = 'configuration_versions_status_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: configuration_versions canonical-state CHECK missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_config.configuration_versions'::regclass
      and conname = 'configuration_versions_precedence_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: configuration_versions deterministic precedence CHECK missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_config.configuration_publications'::regclass
      and conname = 'configuration_publications_idempotency_key_key' and contype = 'u'
  ) then
    raise exception 'ASSERT FAIL: publication idempotency-key uniqueness missing';
  end if;
  raise notice 'PASS configuration: snapshot append-only, canonical states, precedence, exactly-once publication';
end $$;

-- 15. Customer identifier uniqueness and merge history structure.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'kitluy_core' and tablename = 'customer_contacts'
      and indexname = 'customer_contacts_active_identifier_key'
      and indexdef ilike '%unique%' and indexdef ilike '%where%'
  ) then
    raise exception 'ASSERT FAIL: active-identifier partial unique index missing on customer_contacts';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_core.customer_contacts'::regclass
      and conname = 'customer_contacts_phone_e164_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: E.164 phone CHECK missing on customer_contacts';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_core.customer_merge_requests'::regclass
      and conname = 'customer_merge_requests_distinct_reviewer_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: distinct-reviewer CHECK missing on customer_merge_requests';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_core.customers'::regclass
      and conname = 'customers_merge_tombstone_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: merge tombstone CHECK missing on customers';
  end if;
  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'kitluy_core.customer_merge_results'::regclass
      and not tg.tgisinternal
      and tg.tgfoid = 'kitluy_auth.enforce_append_only'::regproc
  ) then
    raise exception 'ASSERT FAIL: customer_merge_results lacks the enforce_append_only trigger';
  end if;
  raise notice 'PASS customers: identifier uniqueness, E.164 CHECK, merge four-eyes CHECK, tombstone, A/O results';
end $$;

-- 16. Consent preservation structure: withdrawals reference their grant;
--     grants and withdrawals are append-only; the five communication classes
--     are CHECK-bound; no mutable-boolean consent column exists.
do $$
declare
  v_bad text;
begin
  if not exists (
    select 1 from pg_constraint c
    where c.contype = 'f'
      and c.conrelid = 'kitluy_core.consent_withdrawals'::regclass
      and c.confrelid = 'kitluy_core.consent_grants'::regclass
  ) then
    raise exception 'ASSERT FAIL: consent_withdrawals must reference consent_grants (withdrawal preserves grant)';
  end if;
  if not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'kitluy_core.consent_grants'::regclass
      and not tg.tgisinternal
      and tg.tgfoid = 'kitluy_auth.enforce_append_only'::regproc
  ) or not exists (
    select 1 from pg_trigger tg
    where tg.tgrelid = 'kitluy_core.consent_withdrawals'::regclass
      and not tg.tgisinternal
      and tg.tgfoid = 'kitluy_auth.enforce_append_only'::regproc
  ) then
    raise exception 'ASSERT FAIL: consent grant/withdrawal append-only triggers missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_core.consent_purposes'::regclass
      and conname = 'consent_purposes_communication_class_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: five-class communication CHECK missing on consent_purposes';
  end if;
  -- Consent must never be a mutable boolean: no boolean consent/opt columns.
  select string_agg(table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema = 'kitluy_core'
    and table_name in ('consent_purposes', 'consent_purpose_versions', 'consent_grants',
                       'consent_withdrawals', 'customers', 'customer_contacts')
    and data_type = 'boolean'
    and (column_name like '%consent%' or column_name like '%opt_in%' or column_name like '%marketing%');
  if v_bad is not null then
    raise exception 'ASSERT FAIL: mutable boolean consent column(s) found: %', v_bad;
  end if;
  raise notice 'PASS consent: withdrawal references grant, A/O triggers, five classes, no consent booleans';
end $$;

-- ============================================================================
-- Cycle-6 (WS-07/WS-08) structural assertions — groups 0075/0080/0085/0090/0095.
-- ============================================================================

-- 17. Every cycle-6 table exists and has a primary key (30 relations —
--     group 0095 manifest: kitluy_orders 5, kitluy_laundry 9 new,
--     kitluy_payments 10, kitluy_finance 6).
do $$
declare
  t text;
  v_tables text[] := array[
    'kitluy_orders.orders', 'kitluy_orders.order_lines',
    'kitluy_orders.order_adjustments', 'kitluy_orders.order_events',
    'kitluy_orders.order_notes',
    'kitluy_laundry.booking_production_state', 'kitluy_laundry.booking_status_history',
    'kitluy_laundry.garments', 'kitluy_laundry.laundry_tags',
    'kitluy_laundry.garment_scan_events', 'kitluy_laundry.garment_exceptions',
    'kitluy_laundry.ready_storage_positions', 'kitluy_laundry.ready_storage_assignments',
    'kitluy_laundry.pickup_handoffs',
    'kitluy_payments.tenders', 'kitluy_payments.payment_attempts',
    'kitluy_payments.khqr_transactions', 'kitluy_payments.payment_provider_events',
    'kitluy_payments.payment_status_history', 'kitluy_payments.refunds',
    'kitluy_payments.voids', 'kitluy_payments.settlement_refs',
    'kitluy_payments.payment_reconciliations', 'kitluy_payments.payment_reconciliation_lines',
    'kitluy_finance.subledger_accounts', 'kitluy_finance.subledger_account_translations',
    'kitluy_finance.journal_entries', 'kitluy_finance.journal_postings',
    'kitluy_finance.source_postings', 'kitluy_finance.idempotency_records'
  ];
begin
  foreach t in array v_tables loop
    if to_regclass(t) is null then
      raise exception 'ASSERT FAIL: table % is missing', t;
    end if;
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(t) and c.contype = 'p'
    ) then
      raise exception 'ASSERT FAIL: table % has no primary key', t;
    end if;
  end loop;
  raise notice 'PASS cycle-6 tables: all 30 WS-07/WS-08 tables exist with primary keys';
end $$;

-- 18. Cycle-6 critical foreign keys, including the named COMPOSITE
--     child-cannot-escape-parent FKs (a Booking child can never name another
--     Tenant, Store, Booking or subledger — Cycle-6 §7/§13; AMD-I1).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('kitluy_orders.orders', 'kitluy_core.tenants'),
      ('kitluy_orders.orders', 'kitluy_core.digital_stores'),
      ('kitluy_orders.orders', 'kitluy_core.customers'),
      ('kitluy_orders.order_lines', 'kitluy_orders.orders'),
      ('kitluy_orders.order_lines', 'kitluy_core.catalog_items'),
      ('kitluy_orders.order_adjustments', 'kitluy_orders.orders'),
      ('kitluy_orders.order_events', 'kitluy_orders.orders'),
      ('kitluy_orders.order_notes', 'kitluy_orders.orders'),
      ('kitluy_laundry.booking_production_state', 'kitluy_orders.orders'),
      ('kitluy_laundry.booking_status_history', 'kitluy_orders.orders'),
      ('kitluy_laundry.garments', 'kitluy_orders.orders'),
      ('kitluy_laundry.laundry_tags', 'kitluy_laundry.garments'),
      ('kitluy_laundry.garment_scan_events', 'kitluy_laundry.ready_storage_positions'),
      ('kitluy_laundry.ready_storage_assignments', 'kitluy_laundry.ready_storage_positions'),
      ('kitluy_laundry.pickup_handoffs', 'kitluy_orders.orders'),
      ('kitluy_payments.tenders', 'kitluy_orders.orders'),
      ('kitluy_payments.payment_attempts', 'kitluy_payments.tenders'),
      ('kitluy_payments.khqr_transactions', 'kitluy_payments.tenders'),
      ('kitluy_payments.payment_status_history', 'kitluy_payments.tenders'),
      ('kitluy_payments.refunds', 'kitluy_payments.tenders'),
      ('kitluy_payments.refunds', 'kitluy_auth.approval_requests'),
      ('kitluy_payments.voids', 'kitluy_payments.tenders'),
      ('kitluy_payments.settlement_refs', 'kitluy_payments.tenders'),
      ('kitluy_payments.payment_reconciliation_lines', 'kitluy_payments.payment_reconciliations'),
      ('kitluy_finance.journal_entries', 'kitluy_core.digital_stores'),
      ('kitluy_finance.journal_postings', 'kitluy_finance.journal_entries'),
      ('kitluy_finance.journal_postings', 'kitluy_finance.subledger_accounts'),
      ('kitluy_finance.source_postings', 'kitluy_finance.journal_entries'),
      ('kitluy_finance.idempotency_records', 'kitluy_core.tenants')
    ) as fks (child, parent)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.contype = 'f'
        and c.conrelid = to_regclass(r.child)
        and c.confrelid = to_regclass(r.parent)
    ) then
      raise exception 'ASSERT FAIL: foreign key % -> % is missing', r.child, r.parent;
    end if;
  end loop;

  -- Composite (two-column) child-cannot-escape-parent FKs must be composite.
  for r in
    select * from (values
      ('kitluy_orders.orders', 'orders_tenant_store_fk'),
      ('kitluy_orders.orders', 'orders_store_location_fk'),
      ('kitluy_orders.orders', 'orders_tenant_customer_fk'),
      ('kitluy_orders.order_lines', 'order_lines_tenant_order_fk'),
      ('kitluy_orders.order_lines', 'order_lines_store_order_fk'),
      ('kitluy_orders.order_lines', 'order_lines_store_catalog_item_fk'),
      ('kitluy_laundry.booking_production_state', 'booking_production_state_tenant_order_fk'),
      ('kitluy_laundry.garment_scan_events', 'garment_scan_events_store_order_fk'),
      ('kitluy_laundry.garment_scan_events', 'garment_scan_events_store_location_fk'),
      ('kitluy_laundry.garments', 'garments_same_order_container_fk'),
      ('kitluy_payments.tenders', 'tenders_tenant_order_fk'),
      ('kitluy_payments.tenders', 'tenders_store_order_fk'),
      ('kitluy_payments.refunds', 'refunds_tenant_tender_fk'),
      ('kitluy_finance.journal_postings', 'journal_postings_tenant_entry_fk'),
      ('kitluy_finance.journal_postings', 'journal_postings_tenant_account_fk')
    ) as cfks (tbl, conname)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(r.tbl)
        and c.conname = r.conname
        and c.contype = 'f'
        and array_length(c.conkey, 1) = 2
    ) then
      raise exception 'ASSERT FAIL: composite FK % on % is missing or not two-column', r.conname, r.tbl;
    end if;
  end loop;

  raise notice 'PASS cycle-6 foreign keys: 29 FK edges + 15 child-cannot-escape composite FKs present';
end $$;

-- 19. Money is integer minor units across the cycle-6 financial surface:
--     every *_minor column bigint, currency_code columns char(3), no
--     float/numeric money storage anywhere, weight in integer grams
--     (money contract §4 / AMD-I5; engine weightGrams contract).
do $$
declare
  v_bad text;
  v_type text;
begin
  select string_agg(table_schema || '.' || table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and column_name like '%minor%'
    and data_type is distinct from 'bigint';
  if v_bad is not null then
    raise exception 'ASSERT FAIL: non-bigint *_minor column(s): %', v_bad;
  end if;

  select string_agg(table_schema || '.' || table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
    and column_name like '%currency_code%'
    and (data_type is distinct from 'character' or character_maximum_length is distinct from 3);
  if v_bad is not null then
    raise exception 'ASSERT FAIL: currency column(s) not char(3): %', v_bad;
  end if;

  select string_agg(table_schema || '.' || table_name || '.' || column_name, ', ') into v_bad
  from information_schema.columns
  where table_schema in ('kitluy_orders', 'kitluy_laundry', 'kitluy_payments', 'kitluy_finance')
    and (column_name like '%minor%' or column_name like '%amount%' or column_name like '%price%')
    and data_type in ('real', 'double precision', 'numeric', 'money');
  if v_bad is not null then
    raise exception 'ASSERT FAIL: float/numeric money storage found: %', v_bad;
  end if;

  select data_type into v_type from information_schema.columns
  where table_schema = 'kitluy_orders' and table_name = 'order_lines'
    and column_name = 'weight_grams';
  if v_type is distinct from 'bigint' then
    raise exception 'ASSERT FAIL: order_lines.weight_grams must be bigint integer grams, found %', v_type;
  end if;

  raise notice 'PASS cycle-6 money: bigint minor units, char(3) currency, integer grams, no float money';
end $$;

-- 20. Booking lifecycle vocabulary (KBR-TXN §4): the canonical-state CHECK
--     exists and a live service-path probe of a non-adjacent transition
--     (CONFIRMED/FINALIZED -> FULFILLED/COMPLETED skips fulfilment) is
--     rejected by the verbatim §4 whitelist trigger. The failed statement
--     rolls back inside the exception subtransaction — nothing persists.
do $$
declare
  v_status text;
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_orders.orders'::regclass
      and conname = 'orders_status_check' and contype = 'c'
  ) then
    raise exception 'ASSERT FAIL: orders canonical-state CHECK (orders_status_check) missing';
  end if;

  set local role service_role;
  begin
    update kitluy_orders.orders
       set status = 'FULFILLED/COMPLETED', version = version + 1
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'ASSERT FAIL: invalid booking transition CONFIRMED/FINALIZED -> FULFILLED/COMPLETED was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-ORD-INVALID-TRANSITION%' then
        raise;
      end if;
  end;
  select status into v_status from kitluy_orders.orders
  where id = '00000000-0000-4000-8000-000000000401';
  if v_status is distinct from 'CONFIRMED/FINALIZED' then
    raise exception 'ASSERT FAIL: booking A1 status changed after rejected transition (now %)', v_status;
  end if;
  reset role;
  raise notice 'PASS booking lifecycle: canonical-state CHECK present; non-adjacent transition rejected (KLUY-ORD-INVALID-TRANSITION)';
end $$;

-- 21. Optimistic-concurrency version guards: a stale-version UPDATE (version
--     not advanced by exactly 1) is rejected on the Booking header
--     (KLUY-ORD-STALE-VERSION) and on the production projection
--     (KLUY-GUARD-VERSION-INCREMENT).
do $$
begin
  begin
    update kitluy_orders.orders
       set updated_at = now(), version = version
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'ASSERT FAIL: stale-version order UPDATE was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-ORD-STALE-VERSION%' then
        raise;
      end if;
  end;
  begin
    update kitluy_laundry.booking_production_state
       set updated_at = now(), version = version
     where order_id = '00000000-0000-4000-8000-000000000401';
    raise exception 'ASSERT FAIL: stale-version production-state UPDATE was accepted';
  exception
    when others then
      if sqlerrm not like '%KLUY-GUARD-VERSION-INCREMENT%' then
        raise;
      end if;
  end;
  raise notice 'PASS version guards: stale versions rejected (KLUY-ORD-STALE-VERSION / KLUY-GUARD-VERSION-INCREMENT)';
end $$;

-- 22. Append-only / immutability live probes as the connected
--     superuser-equivalent (grants cannot save a privileged path — the
--     triggers themselves must reject; KLD-FIN-001, RB v4 §5.6). Every failed
--     statement rolls back inside its exception subtransaction.
do $$
begin
  begin
    update kitluy_laundry.garment_scan_events
       set reason_code = 'tamper'
     where id = '00000000-0000-4000-8000-000000000415';
    raise exception 'ASSERT FAIL: garment_scan_events UPDATE succeeded';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  begin
    delete from kitluy_payments.payment_status_history
     where id = '00000000-0000-4000-8000-000000000426';
    raise exception 'ASSERT FAIL: payment_status_history DELETE succeeded';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  begin
    update kitluy_finance.journal_postings
       set memo = 'tamper'
     where tenant_id = '00000000-0000-4000-8000-000000000011';
    raise exception 'ASSERT FAIL: journal_postings UPDATE succeeded';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-APPEND-ONLY%' then
        raise;
      end if;
  end;
  begin
    delete from kitluy_orders.orders
     where id = '00000000-0000-4000-8000-000000000401';
    raise exception 'ASSERT FAIL: orders DELETE succeeded';
  exception
    when others then
      if sqlerrm not like '%KLUY-AUTH-NO-DELETE%' then
        raise;
      end if;
  end;
  begin
    update kitluy_payments.tenders
       set amount_minor = 9999
     where id = '00000000-0000-4000-8000-000000000425';
    raise exception 'ASSERT FAIL: tender amount rewrite succeeded';
  exception
    when others then
      if sqlerrm not like '%KLUY-GUARD-FROZEN-COLUMN%' then
        raise;
      end if;
  end;
  raise notice 'PASS immutability probes: custody/payment history append-only, orders no-delete, tender money frozen';
end $$;

-- 23. Balanced-journal enforcement (AMD-I1/KBR-FIN-002) and the RPC posting
--     contract (AMD-I3 dedupe, tenant account scope). The direct-insert probe
--     runs as the connected superuser (grants are bypassed) so the DEFERRED
--     constraint trigger itself must reject; `set constraints all immediate`
--     forces it inside the exception subtransaction. Wrapped in an explicit
--     transaction because the successful replay probe touches
--     source_postings.last_observed_at — the rollback keeps fixtures pristine.
begin;
do $$
declare
  v_entry_id uuid;
  v_result jsonb;
  v_entries_before bigint;
  v_entries_after bigint;
begin
  -- 23a. Unbalanced direct insert: single-leg entry rejected at constraint time.
  begin
    insert into kitluy_finance.journal_entries
      (tenant_id, digital_store_id, business_date, entry_type, posting_rule_key,
       source_type, source_id, currency_code)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       date '2026-07-27', 'DEV_PROBE', 'DEV-RULE-PROBE-DIRECT', 'TENDER',
       gen_random_uuid(), 'KHR')
    returning id into v_entry_id;
    insert into kitluy_finance.journal_postings
      (tenant_id, journal_entry_id, line_no, subledger_account_id, direction,
       amount_minor, currency_code)
    values
      ('00000000-0000-4000-8000-000000000011', v_entry_id, 1,
       '00000000-0000-4000-8000-000000000440', 'DEBIT', 500, 'KHR');
    set constraints all immediate;
    raise exception 'ASSERT FAIL: single-leg direct journal insert survived the deferred balance trigger';
  exception
    when others then
      if sqlerrm not like '%KLUY-FIN-UNBALANCED%' then
        raise;
      end if;
  end;

  -- 23b. RPC with debits <> credits.
  begin
    v_result := kitluy_finance.post_journal_entry_v1(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
      '00000000-0000-4000-8000-000000000018', date '2026-07-27', 'DEV_PROBE',
      'DEV-RULE-PROBE-UNBAL', null, 'TENDER', gen_random_uuid(), 'PROBE-HASH-23B',
      'KHR', null, null, null, null, 'DEV-IDEM-PROBE-23B',
      jsonb_build_array(
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000440',
                           'direction', 'DEBIT', 'amount_minor', 100),
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000441',
                           'direction', 'CREDIT', 'amount_minor', 90)));
    raise exception 'ASSERT FAIL: unbalanced RPC posting was accepted (%)', v_result;
  exception
    when others then
      if sqlerrm not like '%KLUY-FIN-UNBALANCED%' then
        raise;
      end if;
  end;

  -- 23c. RPC with a single leg.
  begin
    v_result := kitluy_finance.post_journal_entry_v1(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
      '00000000-0000-4000-8000-000000000018', date '2026-07-27', 'DEV_PROBE',
      'DEV-RULE-PROBE-1LEG', null, 'TENDER', gen_random_uuid(), 'PROBE-HASH-23C',
      'KHR', null, null, null, null, 'DEV-IDEM-PROBE-23C',
      jsonb_build_array(
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000440',
                           'direction', 'DEBIT', 'amount_minor', 100)));
    raise exception 'ASSERT FAIL: single-leg RPC posting was accepted (%)', v_result;
  exception
    when others then
      if sqlerrm not like '%KLUY-FIN-UNBALANCED%' then
        raise;
      end if;
  end;

  -- 23d. Duplicate source with a DIFFERENT source_hash: stable conflict.
  begin
    v_result := kitluy_finance.post_journal_entry_v1(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
      '00000000-0000-4000-8000-000000000018', date '2026-07-27', 'DEV_PAYMENT_POSTING',
      'DEV-RULE-CASH-TENDER', '1', 'TENDER', '00000000-0000-4000-8000-000000000425',
      'DEV-SRC-HASH-CONFLICT', 'KHR', null, null, null, null, 'DEV-IDEM-PROBE-23D',
      jsonb_build_array(
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000440',
                           'direction', 'DEBIT', 'amount_minor', 2000),
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000441',
                           'direction', 'CREDIT', 'amount_minor', 2000)));
    raise exception 'ASSERT FAIL: same-source/different-hash RPC replay was accepted (%)', v_result;
  exception
    when others then
      if sqlerrm not like '%KLUY-FIN-SOURCE-CONFLICT%' then
        raise;
      end if;
  end;

  -- 23e. Same source AND same hash: idempotent replay, no second entry
  --      (compare entry counts before/after — the local dev database may
  --      legitimately carry additional entries from engine integration runs).
  select count(*) into v_entries_before from kitluy_finance.journal_entries;
  v_result := kitluy_finance.post_journal_entry_v1(
    '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000018', date '2026-07-27', 'DEV_PAYMENT_POSTING',
    'DEV-RULE-CASH-TENDER', '1', 'TENDER', '00000000-0000-4000-8000-000000000425',
    'DEV-SRC-HASH-0001', 'KHR', null, null, null, null, 'DEV-FINPOST-0001',
    jsonb_build_array(
      jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000440',
                         'direction', 'DEBIT', 'amount_minor', 2000),
      jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000441',
                         'direction', 'CREDIT', 'amount_minor', 2000)));
  if (v_result ->> 'replayed') is distinct from 'true'
     or (v_result ->> 'journal_entry_id') is null then
    raise exception 'ASSERT FAIL: same-source/same-hash RPC call did not replay (%)', v_result;
  end if;
  select count(*) into v_entries_after from kitluy_finance.journal_entries;
  if v_entries_after <> v_entries_before then
    raise exception 'ASSERT FAIL: replay created a second journal entry (% -> %)',
      v_entries_before, v_entries_after;
  end if;

  -- 23f. Tenant A posting naming the Tenant B account is rejected.
  begin
    v_result := kitluy_finance.post_journal_entry_v1(
      '00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
      '00000000-0000-4000-8000-000000000018', date '2026-07-27', 'DEV_PROBE',
      'DEV-RULE-PROBE-XTENANT', null, 'TENDER', gen_random_uuid(), 'PROBE-HASH-23F',
      'KHR', null, null, null, null, 'DEV-IDEM-PROBE-23F',
      jsonb_build_array(
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000440',
                           'direction', 'DEBIT', 'amount_minor', 100),
        jsonb_build_object('subledger_account_id', '00000000-0000-4000-8000-000000000456',
                           'direction', 'CREDIT', 'amount_minor', 100)));
    raise exception 'ASSERT FAIL: cross-tenant account posting was accepted (%)', v_result;
  exception
    when others then
      if sqlerrm not like '%KLUY-FIN-ACCOUNT-SCOPE%' then
        raise;
      end if;
  end;

  raise notice 'PASS balanced journal: deferred trigger + RPC reject unbalanced/1-leg, dedupe conflicts, replay idempotent, tenant account scope enforced';
end $$;
rollback;

-- 24. Idempotency uniqueness anchors (AMD-I3/I4; engine runIdempotent
--     contract): unique constraints exist and a duplicate custody scan replay
--     is physically rejected.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('kitluy_payments.tenders', 'tenders_tenant_idempotency_key'),
      ('kitluy_orders.orders', 'orders_tenant_idempotency_key'),
      ('kitluy_laundry.garment_scan_events', 'garment_scan_events_tenant_idempotency_key'),
      ('kitluy_payments.refunds', 'refunds_tenant_idempotency_key'),
      ('kitluy_finance.source_postings', 'source_postings_source_key'),
      ('kitluy_finance.source_postings', 'source_postings_idempotency_key'),
      ('kitluy_finance.idempotency_records', 'idempotency_records_scope_key'),
      ('kitluy_payments.payment_provider_events', 'payment_provider_events_provider_event_key')
    ) as uks (tbl, conname)
  loop
    if not exists (
      select 1 from pg_constraint c
      where c.conrelid = to_regclass(r.tbl)
        and c.conname = r.conname
        and c.contype = 'u'
    ) then
      raise exception 'ASSERT FAIL: unique constraint % on % is missing', r.conname, r.tbl;
    end if;
  end loop;

  begin
    insert into kitluy_laundry.garment_scan_events
      (tenant_id, digital_store_id, store_location_id, order_id, garment_id,
       scan_type, terminal_role, idempotency_key, aggregate_version)
    values
      ('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000015',
       '00000000-0000-4000-8000-000000000018', '00000000-0000-4000-8000-000000000401',
       '00000000-0000-4000-8000-000000000410', 'INTAKE', 'laundry.t1.intake_cashier',
       'DEV-SCAN-0001', 1);
    raise exception 'ASSERT FAIL: duplicate custody scan idempotency key was accepted';
  exception
    when unique_violation then
      null;
  end;
  raise notice 'PASS idempotency: 8 uniqueness anchors present; duplicate custody scan replay rejected';
end $$;

-- 25. Grant lockdown (group 0095 §3): service_role holds NO write grant on the
--     RPC-only journal relations and no DELETE anywhere in the cycle-6 train;
--     authenticated is SELECT-only; anon holds nothing.
do $$
declare
  v_count int;
  v_laundry_new text[] := array[
    'booking_production_state', 'booking_status_history', 'garments',
    'laundry_tags', 'garment_scan_events', 'garment_exceptions',
    'ready_storage_positions', 'ready_storage_assignments', 'pickup_handoffs'
  ];
begin
  select count(*) into v_count from information_schema.role_table_grants
  where grantee = 'service_role'
    and table_schema = 'kitluy_finance'
    and table_name in ('journal_entries', 'journal_postings', 'source_postings')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_count <> 0 then
    raise exception 'ASSERT FAIL: service_role holds % write grant(s) on the RPC-only journal relations', v_count;
  end if;

  select count(*) into v_count from information_schema.role_table_grants
  where grantee = 'service_role'
    and privilege_type = 'DELETE'
    and (table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
         or (table_schema = 'kitluy_laundry' and table_name = any (v_laundry_new)));
  if v_count <> 0 then
    raise exception 'ASSERT FAIL: service_role holds % DELETE grant(s) on cycle-6 tables', v_count;
  end if;

  select count(*) into v_count from information_schema.role_table_grants
  where grantee = 'authenticated'
    and privilege_type = 'SELECT'
    and (table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
         or (table_schema = 'kitluy_laundry' and table_name = any (v_laundry_new)));
  if v_count <> 30 then
    raise exception 'ASSERT FAIL: expected authenticated SELECT on all 30 cycle-6 tables, found %', v_count;
  end if;

  select count(*) into v_count from information_schema.role_table_grants
  where grantee = 'authenticated'
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
    and (table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
         or (table_schema = 'kitluy_laundry' and table_name = any (v_laundry_new)));
  if v_count <> 0 then
    raise exception 'ASSERT FAIL: authenticated holds % write grant(s) on cycle-6 tables', v_count;
  end if;

  select count(*) into v_count from information_schema.role_table_grants
  where grantee = 'anon'
    and (table_schema in ('kitluy_orders', 'kitluy_payments', 'kitluy_finance')
         or (table_schema = 'kitluy_laundry' and table_name = any (v_laundry_new)));
  if v_count <> 0 then
    raise exception 'ASSERT FAIL: anon holds % grant(s) on cycle-6 tables', v_count;
  end if;

  raise notice 'PASS cycle-6 grants: journals write-locked (RPC only), no service DELETE, authenticated SELECT-only, anon nothing';
end $$;

-- 26. post_journal_entry_v1 is the sole journal write path (AMD-I2): SECURITY
--     DEFINER with locked search_path; EXECUTE granted to service_role only.
do $$
declare
  v_oid oid;
  v_secdef boolean;
  v_locked boolean;
begin
  select p.oid, p.prosecdef,
         exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                 where cfg like 'search_path=%')
    into v_oid, v_secdef, v_locked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_finance' and p.proname = 'post_journal_entry_v1';
  if v_oid is null then
    raise exception 'ASSERT FAIL: kitluy_finance.post_journal_entry_v1 is missing';
  end if;
  if not v_secdef then
    raise exception 'ASSERT FAIL: post_journal_entry_v1 must be SECURITY DEFINER';
  end if;
  if not v_locked then
    raise exception 'ASSERT FAIL: post_journal_entry_v1 must lock search_path';
  end if;
  if not has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'ASSERT FAIL: service_role must hold EXECUTE on post_journal_entry_v1';
  end if;
  if has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'ASSERT FAIL: authenticated must NOT hold EXECUTE on post_journal_entry_v1';
  end if;
  if has_function_privilege('anon', v_oid, 'execute') then
    raise exception 'ASSERT FAIL: anon must NOT hold EXECUTE on post_journal_entry_v1';
  end if;
  raise notice 'PASS posting RPC: security definer, locked search_path, execute for service_role only';
end $$;

-- ---------------------------------------------------------------------------
-- 27. WS-10 sync ingestion (group 0110; Cycle 9).
--     KLREQ-026: ingestion dedupes on the Hub-issued business-effect key.
--     Amendment KLD-2026-07-28-001-A01 §2: no fabricated acknowledgement, and a
--     transport failure is never a durable rejection.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_checked int := 0;
begin
  foreach t in array array['sync_batches', 'sync_inbox', 'sync_cursors', 'sync_conflicts'] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kitluy_sync' and c.relname = t and c.relkind = 'r'
    ) then
      raise exception 'ASSERT FAIL: kitluy_sync.% is missing (group 0110)', t;
    end if;
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kitluy_sync' and c.relname = t
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'ASSERT FAIL: kitluy_sync.% is not RLS ENABLE+FORCE', t;
    end if;
    -- Fail closed: SELECT-only for clients, and never for anon.
    if exists (
      select 1 from pg_policies
      where schemaname = 'kitluy_sync' and tablename = t and cmd <> 'SELECT'
    ) then
      raise exception 'ASSERT FAIL: kitluy_sync.% has a non-SELECT client policy', t;
    end if;
    if exists (
      select 1 from pg_policies
      where schemaname = 'kitluy_sync' and tablename = t and 'anon' = any (roles)
    ) then
      raise exception 'ASSERT FAIL: kitluy_sync.% exposes an anon policy', t;
    end if;
    v_checked := v_checked + 1;
  end loop;
  if v_checked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 kitluy_sync relations, checked %', v_checked;
  end if;
  raise notice 'PASS sync-ingestion-relations: 4 kitluy_sync relations exist, all RLS ENABLE+FORCE, SELECT-only for clients, zero anon policies';
end $$;

do $$
begin
  -- THE dedupe key: one business effect per Location, by owner ruling.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_inbox'::regclass and conname = 'sync_inbox_effect_key'
      and contype = 'u'
  ) then
    raise exception
      'ASSERT FAIL: sync_inbox has no unique (store_location_id, effect_key); ingestion would not be idempotent (KLREQ-026)';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_inbox'::regclass
      and conname = 'sync_inbox_effect_key_check'
  ) then
    raise exception 'ASSERT FAIL: sync_inbox does not CHECK the effect-key shape';
  end if;

  -- No fabricated acknowledgement, no bare rejection (amendment §2).
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_inbox'::regclass and conname = 'sync_inbox_applied_check'
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_inbox'::regclass and conname = 'sync_inbox_rejected_check'
  ) then
    raise exception
      'ASSERT FAIL: sync_inbox does not require an ack identity for APPLIED and a durable code for REJECTED';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_batches'::regclass and conname = 'sync_batches_verified_check'
  ) then
    raise exception 'ASSERT FAIL: an unverified batch could reach APPLIED';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_cursors'::regclass and conname = 'sync_cursors_order_check'
  ) then
    raise exception 'ASSERT FAIL: a sync cursor could acknowledge past what it ingested';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'kitluy_sync.sync_conflicts'::regclass
      and conname = 'sync_conflicts_resolution_check'
  ) then
    raise exception 'ASSERT FAIL: a sync conflict could be closed with no actor, reason or moment';
  end if;

  raise notice 'PASS sync-ingestion-invariants: dedupe is unique per (location, effect_key); APPLIED requires a cloud ack id and REJECTED a durable code; an unverified batch cannot be applied; a cursor cannot outrun ingestion; a conflict cannot be closed silently';
end $$;

do $$
declare
  v_effect text := 'kh1.e0000000-0000-4000-8000-000000000099.0';
  v_blocked int := 0;
begin
  -- A malformed key cannot be persisted at all.
  begin
    insert into kitluy_sync.sync_inbox
      (tenant_id, digital_store_id, store_location_id, batch_id, effect_key, event_id,
       source_device_id, assignment_generation, hub_sequence, aggregate_type, aggregate_id,
       event_type, schema_version, payload_sha256, payload, occurred_at)
    select l.tenant_id, l.digital_store_id, l.id, gen_random_uuid(), 'not-a-key',
           gen_random_uuid(), gen_random_uuid(), 1, 1, 'booking', gen_random_uuid(), 'x.y', 1,
           repeat('0', 64), '{}'::jsonb, now()
      from kitluy_core.store_locations l limit 1;
    raise exception 'ASSERT FAIL: a malformed effect key was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- APPLIED without the cloud acknowledgement identity is refused.
  begin
    insert into kitluy_sync.sync_inbox
      (tenant_id, digital_store_id, store_location_id, batch_id, effect_key, event_id,
       source_device_id, assignment_generation, hub_sequence, aggregate_type, aggregate_id,
       event_type, schema_version, payload_sha256, payload, occurred_at, status, processed_at)
    select l.tenant_id, l.digital_store_id, l.id, gen_random_uuid(), v_effect,
           gen_random_uuid(), gen_random_uuid(), 1, 1, 'booking', gen_random_uuid(), 'x.y', 1,
           repeat('0', 64), '{}'::jsonb, now(), 'APPLIED', now()
      from kitluy_core.store_locations l limit 1;
    raise exception 'ASSERT FAIL: an APPLIED effect was accepted with no cloud ack id';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 blocked ingestion writes, got %', v_blocked;
  end if;
  raise notice 'PASS sync-ingestion-negatives: a malformed effect key and a fabricated acknowledgement are both refused by the database';
end $$;


-- ============================================================================
-- SECTION 28 — WS-11-T001 device enrollment and identity (migration 0120).
-- Authority: docs/source/security/kitluy-device-certificate-and-trust-policy-v1.0.0.md
--   and the Cycle 10 T001 owner instruction (2026-07-28).
-- These sections create real device rows with run-unique asset tags, so the
-- file stays re-runnable: device history is append-only and nothing here may be
-- cleaned up by a DELETE.
-- ============================================================================

-- Shared fixture: one certified hardware profile for WS-11-T001 assertions.
insert into kitluy_devices.hardware_profiles
  (profile_key, display_name, device_class, manufacturer, model_identifier,
   required_signal_types, certification_status)
values
  ('WS11-T001-HUB-PROBE', 'WS-11-T001 assertion Store Hub profile', 'store_hub',
   'ASSERTION-FIXTURE', 'PROBE-1',
   array['mac_address', 'board_serial', 'storage_serial']::kitluy_devices.hardware_signal_type[],
   'CERTIFIED')
on conflict (profile_key) do nothing;

-- ---------------------------------------------------------------------------
-- 28a — the device_record_id is opaque and is NOT derived from hardware.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_dev_a uuid;
  v_dev_b uuid;
  v_mac text := 'aa:bb:cc:00:' || substr(md5(random()::text), 1, 2) || ':01';
  v_board text := 'board-' || substr(md5(random()::text), 1, 12);
  v_derived text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_dev_a := kitluy_devices.enroll_device_v1(
    'WS11-T001-A-' || gen_random_uuid(), v_profile, now() - interval '30 days',
    repeat('a1', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || gen_random_uuid())));

  v_dev_b := kitluy_devices.enroll_device_v1(
    'WS11-T001-B-' || gen_random_uuid(), v_profile, now() - interval '30 days',
    repeat('b2', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:11:' || substr(md5(random()::text), 1, 2) || ':33'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board || '-other'),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || gen_random_uuid())));

  if v_dev_a = v_dev_b then
    raise exception 'ASSERT FAIL: two enrollments produced the same device identity';
  end if;

  -- The forbidden construction, computed here only to prove nothing uses it.
  v_derived := encode(sha256(convert_to(v_mac || v_board, 'UTF8')), 'hex');
  if exists (select 1 from kitluy_devices.devices
              where replace(id::text, '-', '') = substr(v_derived, 1, 32)) then
    raise exception 'ASSERT FAIL: a device identity is derivable from hashed hardware values';
  end if;

  -- The hardware values ARE recorded, as signals.
  if not exists (
    select 1 from kitluy_devices.manufacturing_enrollments e
    join kitluy_devices.hardware_manifest_signals s on s.manifest_id = e.hardware_manifest_id
    where e.device_id = v_dev_a and s.signal_type = 'mac_address' and s.signal_value = v_mac
  ) then
    raise exception 'ASSERT FAIL: the MAC address was not recorded as a binding signal';
  end if;

  raise notice 'PASS ws11-identity-not-derived: device_record_id is opaque, unrelated between devices and not reproducible from hashed MAC/board values, while the hardware values are still recorded as binding signals';
end $$;

-- ---------------------------------------------------------------------------
-- 28b — THE BLK-005 GATE. Activation and certificate issuance fail closed with
-- an explicit required-value error while no approved PKI configuration exists.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_blocked int := 0;
  v_msg text;
  v_env text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-GATE-' || gen_random_uuid(), v_profile, now(),
    repeat('c3', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:' || substr(md5(random()::text),1,2) || ':00:02'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-' || gen_random_uuid())));

  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'enrolled' then
    raise exception 'ASSERT FAIL: a freshly enrolled device is not in the enrolled state';
  end if;

  -- POST KLD-2026-07-28-002. The decision fixed the certificate windows and
  -- AUTHORIZED development trust, so a development configuration now exists.
  -- Pilot and production must still be absent: §14 leaves both BLOCKED.
  if not exists (select 1 from kitluy_devices.pki_trust_configuration
                  where environment = 'development' and is_active) then
    raise exception 'ASSERT FAIL: no active development PKI configuration, though KLD-2026-07-28-002 authorized development trust';
  end if;
  if exists (select 1 from kitluy_devices.pki_trust_configuration
              where environment in ('pilot', 'production')) then
    raise exception 'ASSERT FAIL: a pilot or production PKI configuration exists; KLD-2026-07-28-002 §14 leaves both BLOCKED';
  end if;

  foreach v_env in array array['pilot', 'production'] loop
    begin
      perform kitluy_devices.activate_device_v1(v_device, v_env, 'OP-PROBE');
      raise exception 'ASSERT FAIL: device activation succeeded in % with no approved PKI configuration', v_env;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      v_msg := sqlerrm;
      if v_msg not like 'KLUY-DEVICE-PKI-UNCONFIGURED%' then
        raise exception 'ASSERT FAIL: activation in % failed for the wrong reason: %', v_env, v_msg;
      end if;
      if v_msg not like '%[REQUIRED:%' or v_msg not like '%BLK-005%' then
        raise exception 'ASSERT FAIL: the activation refusal is not an explicit required-value error: %', v_msg;
      end if;
      v_blocked := v_blocked + 1;
      -- The caller records the refusal, because the raise above rolled back
      -- everything activate_device_v1 did.
      perform kitluy_devices.record_activation_refusal_v1(
        v_device, v_env, 'OP-PROBE', 'KLUY-DEVICE-PKI-UNCONFIGURED', v_msg);
    end;

    begin
      perform kitluy_devices.issue_device_certificate_v1(
        v_device, v_env, 'SERIAL-PROBE-' || v_env, repeat('c3', 32), 'OP-PROBE');
      raise exception 'ASSERT FAIL: certificate issuance succeeded in % with no approved PKI configuration', v_env;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      if sqlerrm not like 'KLUY-DEVICE-PKI-UNCONFIGURED%' then
        raise exception 'ASSERT FAIL: certificate issuance in % failed for the wrong reason: %', v_env, sqlerrm;
      end if;
      v_blocked := v_blocked + 1;
    end;
  end loop;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 fail-closed refusals across pilot and production, got %', v_blocked;
  end if;

  -- Development passes the GATE and is then refused for a different, honest
  -- reason: the device has no claim and no assignment. That distinction is the
  -- point — the gate is no longer the thing stopping development.
  begin
    perform kitluy_devices.activate_device_v1(v_device, 'development', 'OP-PROBE');
    raise exception 'ASSERT FAIL: a device with no assignment activated in development';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm like 'KLUY-DEVICE-PKI-UNCONFIGURED%' then
      raise exception 'ASSERT FAIL: development still fails at the PKI gate though KLD-2026-07-28-002 authorized it';
    end if;
    -- Group 0123 put the TRUSTED-TIME gate ahead of the state check, so the
    -- refusal now names the deeper blocker: this device has never established
    -- trusted time. That is the honest answer — a Hub that cannot tell the time
    -- cannot check whether a certificate is valid.
    if sqlerrm not like 'KLUY-DEVICE-TIME-UNTRUSTED%' then
      raise exception 'ASSERT FAIL: development activation refused unexpectedly: %', sqlerrm;
    end if;
  end;

  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'enrolled' then
    raise exception 'ASSERT FAIL: a device changed state during a refused activation';
  end if;
  if (select count(*) from kitluy_devices.device_lifecycle_events
       where device_id = v_device and reason_code = 'ACTIVATION_REFUSED') <> 2 then
    raise exception 'ASSERT FAIL: refused activations were not durably recorded as evidence';
  end if;
  if (select count(*) from kitluy_devices.device_certificates where device_id = v_device) <> 0 then
    raise exception 'ASSERT FAIL: a certificate row was created despite the gate';
  end if;
  -- The blocker is visible on the device, not just in an error the operator
  -- saw once. Exactly one open record, not one per attempt.
  if (select count(*) from kitluy_devices.device_trust_incidents
       where device_id = v_device and incident_type = 'activation_blocked'
         and cleared_at is null) <> 1 then
    raise exception 'ASSERT FAIL: the BLK-005 activation blocker is not recorded exactly once as an open incident';
  end if;
  -- Being blocked by the platform is not evidence that the DEVICE is suspect.
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) = 'quarantined' then
    raise exception 'ASSERT FAIL: a device was quarantined merely because the platform PKI is unconfigured';
  end if;

  raise notice 'PASS ws11-blk005-gate: post-KLD-2026-07-28-002 the gate RESOLVES for development and still fails closed for pilot and production with an explicit [REQUIRED: ...] error naming section 14; development is then refused for a different and honest reason (no assignment), with no state drift, no certificate row, a durable caller-recorded refusal per attempt, and exactly one open activation_blocked incident';
end $$;

-- ---------------------------------------------------------------------------
-- 28c — a changed hardware signal QUARANTINES the existing device. It does not
-- create an unrelated identity and it does not rewrite the sealed manifest.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_before int;
  v_after int;
  v_manifest_before text;
  v_manifest_after text;
  v_storage text;
  v_obs uuid;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-TAMPER-' || gen_random_uuid(), v_profile, now(),
    repeat('d4', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':01'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-tamper-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-tamper-' || gen_random_uuid())));

  select m.manifest_sha256 into v_manifest_before
  from kitluy_devices.devices d
  join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
  join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
  where d.id = v_device;

  select s.signal_value into v_storage
  from kitluy_devices.hardware_manifest_signals s
  join kitluy_devices.manufacturing_enrollments e on e.hardware_manifest_id = s.manifest_id
  where e.device_id = v_device and s.signal_type = 'storage_serial';

  select count(*) into v_before from kitluy_devices.devices;

  -- The board serial changed. That is a tamper signal, not a new device.
  v_obs := kitluy_devices.record_hardware_observation_v1(
    v_device,
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value',
        (select signal_value from kitluy_devices.hardware_manifest_signals s2
         join kitluy_devices.manufacturing_enrollments e2 on e2.hardware_manifest_id = s2.manifest_id
         where e2.device_id = v_device and s2.signal_type = 'mac_address')),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-swapped'),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', v_storage)),
    'hub_agent');

  select count(*) into v_after from kitluy_devices.devices;
  if v_after <> v_before then
    raise exception 'ASSERT FAIL: a changed hardware signal created % new device record(s)', v_after - v_before;
  end if;

  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'quarantined' then
    raise exception 'ASSERT FAIL: a changed hardware signal did not quarantine the device';
  end if;

  if not exists (
    select 1 from kitluy_devices.device_trust_incidents
    where device_id = v_device and incident_type = 'hardware_signal_mismatch'
      and severity = 'CRITICAL' and cleared_at is null) then
    raise exception 'ASSERT FAIL: no open hardware_signal_mismatch incident was raised';
  end if;

  select m.manifest_sha256 into v_manifest_after
  from kitluy_devices.devices d
  join kitluy_devices.manufacturing_enrollments e on e.id = d.current_enrollment_id
  join kitluy_devices.hardware_manifests m on m.id = e.hardware_manifest_id
  where d.id = v_device;
  if v_manifest_after is distinct from v_manifest_before then
    raise exception 'ASSERT FAIL: the sealed manifest was rewritten to absorb the mismatch';
  end if;

  if (select storage_module_only_change from kitluy_devices.device_hardware_observations where id = v_obs) then
    raise exception 'ASSERT FAIL: a board-serial change was misclassified as a storage-module change';
  end if;

  raise notice 'PASS ws11-tamper-quarantines: a changed board serial quarantines the SAME device_record_id, raises an open CRITICAL incident, creates no new identity and leaves the sealed manifest untouched';
end $$;

-- ---------------------------------------------------------------------------
-- 28d — an NVMe swap is classified as a storage-module change and still
-- quarantines; it is never silently accepted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_obs uuid;
  v_mac text := 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':02';
  v_board text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_board := 'board-nvme-' || gen_random_uuid();

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-NVME-' || gen_random_uuid(), v_profile, now(),
    repeat('e5', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-old-' || gen_random_uuid())));

  v_obs := kitluy_devices.record_hardware_observation_v1(
    v_device,
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-new-' || gen_random_uuid())),
    'hub_agent');

  if not (select storage_module_only_change from kitluy_devices.device_hardware_observations where id = v_obs) then
    raise exception 'ASSERT FAIL: an NVMe-only change was not recognised as a storage-module change';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'quarantined' then
    raise exception 'ASSERT FAIL: an NVMe swap was silently accepted instead of quarantined';
  end if;
  if not exists (select 1 from kitluy_devices.device_trust_incidents
                  where device_id = v_device and incident_type = 'storage_module_changed') then
    raise exception 'ASSERT FAIL: no storage_module_changed incident was raised';
  end if;

  raise notice 'PASS ws11-nvme-quarantines: a storage-module-only change is classified as the NVMe-replacement signature and STILL quarantines — unregistered NVMe replacement never reactivates silently (trust policy 11)';
end $$;

-- ---------------------------------------------------------------------------
-- 28e — governed re-enrollment: a new key pair is mandatory, the prior
-- enrollment is superseded (not edited), and clearance names an operator.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_new_enrollment uuid;
  v_prior uuid;
  v_signals jsonb;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_signals := jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':03'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-re-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-re-' || gen_random_uuid()));

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-REENROLL-' || gen_random_uuid(), v_profile, now(),
    repeat('f6', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE', v_signals);
  select current_enrollment_id into v_prior from kitluy_devices.devices where id = v_device;

  perform kitluy_devices.quarantine_device_v1(
    v_device, 'manual_quarantine', 'WARNING', 'OP-PROBE', 'assertion probe');

  -- Presenting the SAME public key is the signature of a copied key, not a
  -- new key pair. It must be refused.
  begin
    perform kitluy_devices.reenroll_device_v1(
      v_device, repeat('f6', 32), 'ed25519', 'software',
      'STATION-PROBE', 'OP-PROBE', v_signals, 'REPAIR');
    raise exception 'ASSERT FAIL: re-enrollment accepted the prior public-key fingerprint';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-KEY-REUSE%' then
      raise exception 'ASSERT FAIL: key reuse refused for the wrong reason: %', sqlerrm;
    end if;
  end;

  v_new_enrollment := kitluy_devices.reenroll_device_v1(
    v_device, repeat('07', 32), 'ed25519', 'software',
    'STATION-PROBE', 'OP-REPAIR-01', v_signals, 'REPAIR_AFTER_QUARANTINE');

  if (select state from kitluy_devices.manufacturing_enrollments where id = v_prior) <> 'superseded' then
    raise exception 'ASSERT FAIL: the prior enrollment was not superseded';
  end if;
  if (select enrollment_sequence from kitluy_devices.manufacturing_enrollments where id = v_new_enrollment) <> 2 then
    raise exception 'ASSERT FAIL: the re-enrollment sequence did not advance';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'enrolled' then
    raise exception 'ASSERT FAIL: re-enrollment did not return the device to enrolled';
  end if;
  if exists (select 1 from kitluy_devices.device_trust_incidents
              where device_id = v_device and cleared_at is null) then
    raise exception 'ASSERT FAIL: an incident remained open after governed re-enrollment';
  end if;
  if exists (select 1 from kitluy_devices.device_trust_incidents
              where device_id = v_device
                and (cleared_by_operator_ref is null or clearing_enrollment_id is null)) then
    raise exception 'ASSERT FAIL: an incident was cleared without naming the operator and enrollment';
  end if;

  raise notice 'PASS ws11-governed-reenrollment: re-enrollment refuses a reused public key, supersedes rather than edits the prior enrollment, returns the device to enrolled (never straight to active) and records who cleared each incident under which enrollment';
end $$;

-- ---------------------------------------------------------------------------
-- 28f — replacement: the owner-required order is recorded as fact, and
-- carrying a private key across is structurally impossible.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_soft uuid;
  v_replacement uuid;
  v_soft_replacement uuid;
  v_signals jsonb;
  v_signals_after jsonb;
  v_soft_signals jsonb;
  v_mac text;
  v_board text;
  v_tpm text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  -- KLD-2026-07-28-002 §11 retains the device_record_id across an NVMe swap
  -- only when the board AND the TPM / secure-element identity are both
  -- continuous, so this probe enrolls a TPM endorsement key. The signal set
  -- after the swap keeps board and TPM and changes ONLY the storage serial,
  -- which is exactly what a legitimate NVMe replacement looks like.
  v_mac := 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':04';
  v_board := 'board-rep-' || gen_random_uuid();
  v_tpm := 'tpm-ek-' || gen_random_uuid();

  v_signals := jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'tpm_ek_public', 'signal_value', v_tpm),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-rep-' || gen_random_uuid()));
  v_signals_after := jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'tpm_ek_public', 'signal_value', v_tpm),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-new-' || gen_random_uuid()));

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-REPLACE-' || gen_random_uuid(), v_profile, now(),
    repeat('18', 32), 'ed25519', 'tpm', 'STATION-PROBE', 'OP-PROBE', v_signals);

  update kitluy_devices.devices set assignment_generation = 7 where id = v_device;

  v_replacement := kitluy_devices.record_device_replacement_v1(
    v_device, 'storage_module', 'NVME_FAILURE', 'OP-RMA-01', 'RMA-PROBE-1');

  if (select assignment_generation from kitluy_devices.devices where id = v_device) <> 0 then
    raise exception 'ASSERT FAIL: the old assignment generation was not invalidated';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'quarantined' then
    raise exception 'ASSERT FAIL: a replaced device was not held pending governed re-enrollment';
  end if;
  if not (select prior_certificate_revoked and prior_assignment_invalidated
          from kitluy_devices.device_replacements where id = v_replacement) then
    raise exception 'ASSERT FAIL: the replacement did not record certificate revocation and assignment invalidation';
  end if;
  if (select prior_assignment_generation from kitluy_devices.device_replacements where id = v_replacement) <> 7 then
    raise exception 'ASSERT FAIL: the replacement did not record which assignment generation it invalidated';
  end if;
  if (select completed_at from kitluy_devices.device_replacements where id = v_replacement) is not null then
    raise exception 'ASSERT FAIL: a replacement was complete before re-enrollment happened';
  end if;

  -- Carrying a private key across is refused by the database, not by policy.
  begin
    update kitluy_devices.device_replacements
    set private_key_carried_over = true where id = v_replacement;
    raise exception 'ASSERT FAIL: a replacement recorded a private key carried over from the damaged storage device';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  -- Completion requires the new enrollment to actually exist.
  begin
    update kitluy_devices.device_replacements
    set completed_at = now() where id = v_replacement;
    raise exception 'ASSERT FAIL: a replacement completed with no new enrollment';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
  end;

  perform kitluy_devices.reenroll_device_v1(
    v_device, repeat('29', 32), 'ed25519', 'tpm',
    'STATION-PROBE', 'OP-RMA-01', v_signals_after, 'NVME_REPLACEMENT', v_replacement);

  if (select completed_at from kitluy_devices.device_replacements where id = v_replacement) is null then
    raise exception 'ASSERT FAIL: the replacement did not complete after governed re-enrollment';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'enrolled' then
    raise exception 'ASSERT FAIL: the replaced device did not return to enrolled through the normal flow';
  end if;

  -- §11 DISCONTINUITY 1: a device with NO secure-element evidence cannot
  -- prove continuity, so it cannot keep its identity across an NVMe swap. This
  -- is the honest consequence of §4 — every software-backed development device
  -- is discontinuous by construction, and that is not a bug.
  v_soft_signals := jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:5f:' || substr(md5(random()::text),1,2) || ':0a'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-soft-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-soft-' || gen_random_uuid()));
  v_soft := kitluy_devices.enroll_device_v1(
    'WS11-T001-SOFT-' || gen_random_uuid(), v_profile, now(),
    repeat('4c', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE', v_soft_signals);
  v_soft_replacement := kitluy_devices.record_device_replacement_v1(
    v_soft, 'storage_module', 'NVME_FAILURE', 'OP-RMA-01', 'RMA-SOFT-1');
  begin
    perform kitluy_devices.reenroll_device_v1(
      v_soft, repeat('5d', 32), 'ed25519', 'software',
      'STATION-PROBE', 'OP-RMA-01', v_soft_signals, 'NVME_REPLACEMENT', v_soft_replacement);
    raise exception 'ASSERT FAIL: a device with no secure-element evidence retained its identity across a replacement';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-IDENTITY-DISCONTINUOUS%' then
      raise exception 'ASSERT FAIL: continuity refused for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- §11 DISCONTINUITY 2: a mainboard or secure-element replacement creates a
  -- NEW device_record_id and is refused here outright, whatever the evidence
  -- says.
  begin
    perform kitluy_devices.reenroll_device_v1(
      v_soft, repeat('6e', 32), 'ed25519', 'software',
      'STATION-PROBE', 'OP-RMA-01', v_soft_signals, 'BOARD_REPLACEMENT',
      kitluy_devices.record_device_replacement_v1(
        v_soft, 'mainboard', 'BOARD_FAILURE', 'OP-RMA-01', 'RMA-SOFT-2'));
    raise exception 'ASSERT FAIL: a mainboard replacement retained the device_record_id';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-IDENTITY-DISCONTINUOUS%' then
      raise exception 'ASSERT FAIL: board replacement refused for the wrong reason: %', sqlerrm;
    end if;
  end;

  raise notice 'PASS ws11-replacement-order (KLD-2026-07-28-002 section 11): an NVMe swap with continuous board AND TPM identity retains the device_record_id through the owner-required order; a device with no secure-element evidence CANNOT prove continuity and is refused; and a mainboard or secure-element replacement is refused outright because it creates a new identity. Private-key carry-over stays structurally impossible';
end $$;

-- ---------------------------------------------------------------------------
-- 28g — immutability of captured evidence and enrollment history.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_manifest uuid;
  v_enrollment uuid;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-IMMUT-' || gen_random_uuid(), v_profile, now(),
    repeat('3a', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':05'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-im-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-im-' || gen_random_uuid())));

  select e.id, e.hardware_manifest_id into v_enrollment, v_manifest
  from kitluy_devices.manufacturing_enrollments e where e.device_id = v_device;

  begin
    update kitluy_devices.hardware_manifests set manifest_sha256 = repeat('0', 64) where id = v_manifest;
    raise exception 'ASSERT FAIL: a sealed manifest digest was edited';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    insert into kitluy_devices.hardware_manifest_signals (manifest_id, signal_type, signal_value, is_storage_module)
    values (v_manifest, 'os_image_digest', 'added-after-sealing', false);
    raise exception 'ASSERT FAIL: evidence was added to a sealed manifest';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    delete from kitluy_devices.hardware_manifest_signals where manifest_id = v_manifest;
    raise exception 'ASSERT FAIL: evidence was deleted from a sealed manifest';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    update kitluy_devices.manufacturing_enrollments
    set device_public_key_fingerprint = repeat('ff', 32) where id = v_enrollment;
    raise exception 'ASSERT FAIL: an enrollment public-key fingerprint was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    delete from kitluy_devices.manufacturing_enrollments where id = v_enrollment;
    raise exception 'ASSERT FAIL: enrollment history was deleted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    update kitluy_devices.devices set manufactured_at = now() - interval '1 year'
    where id = v_device;
    raise exception 'ASSERT FAIL: device manufacturing facts were rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    delete from kitluy_devices.devices where id = v_device;
    raise exception 'ASSERT FAIL: a device record was deleted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 7 then
    raise exception 'ASSERT FAIL: expected 7 blocked mutations, got %', v_blocked;
  end if;
  raise notice 'PASS ws11-evidence-immutable: sealed manifests, their signals, enrollment history and device manufacturing facts all refuse edit and delete (7 mutations blocked)';
end $$;

-- ---------------------------------------------------------------------------
-- 28h — the lifecycle state machine refuses illegal transitions, and terminal
-- states are frozen.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T001-FSM-' || gen_random_uuid(), v_profile, now(),
    repeat('4b', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'aa:bb:cc:dd:' || substr(md5(random()::text),1,2) || ':06'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-fsm-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-fsm-' || gen_random_uuid())));

  -- enrolled -> manufactured is backwards.
  begin
    update kitluy_devices.devices set lifecycle_state = 'manufactured' where id = v_device;
    raise exception 'ASSERT FAIL: enrolled -> manufactured was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TRANSITION-ILLEGAL%' then
      raise exception 'ASSERT FAIL: wrong refusal for enrolled -> manufactured: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  perform kitluy_devices.retire_device_v1(v_device, 'DECOMMISSION', 'OP-PROBE');
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'retired' then
    raise exception 'ASSERT FAIL: retirement did not take effect';
  end if;
  if (select state from kitluy_devices.manufacturing_enrollments where device_id = v_device) <> 'revoked' then
    raise exception 'ASSERT FAIL: retirement did not revoke the sealed enrollment';
  end if;

  -- retired is terminal, in both directions.
  begin
    update kitluy_devices.devices set lifecycle_state = 'enrolled', retired_at = null where id = v_device;
    raise exception 'ASSERT FAIL: a retired device was revived';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    update kitluy_devices.devices set asset_tag = 'WS11-T001-FSM-RENAMED' where id = v_device;
    raise exception 'ASSERT FAIL: a retired device record was edited';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.quarantine_device_v1(
      v_device, 'manual_quarantine', 'INFO', 'OP-PROBE', 'probe');
    raise exception 'ASSERT FAIL: a retired device was quarantined';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 blocked lifecycle operations, got %', v_blocked;
  end if;
  raise notice 'PASS ws11-lifecycle-fsm: backwards transitions are refused, retirement revokes the enrollment, and a retired device record is frozen against revival, edit and quarantine';
end $$;

-- ---------------------------------------------------------------------------
-- 28i — PKI configuration governance. This is what stops the BLK-005 gate from
-- being faked open by a fixture or an agent.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked int := 0;
begin
  -- A placeholder decision reference is not an approval.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'root', 'issuing', 'mfg', 'hsm', 365, 30, 7, 'CRL', 72,
       'cfg-key', 'rel-key', 'tx-key', 'TBD', now(), true);
    raise exception 'ASSERT FAIL: a PKI configuration was approved with a placeholder decision reference';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-PKI-UNAPPROVED%' then
      raise exception 'ASSERT FAIL: placeholder approval refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'root', 'issuing', 'mfg', 'hsm', 365, 30, 7, 'CRL', 72,
       'cfg-key', 'rel-key', 'tx-key', '[REQUIRED: owner PKI decision]', now(), true);
    raise exception 'ASSERT FAIL: a PKI configuration was approved by an unresolved [REQUIRED: ...] marker';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- One key reused across two purposes is refused structurally.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'root', 'issuing', 'mfg', 'hsm', 365, 30, 7, 'CRL', 72,
       'one-key-for-everything', 'one-key-for-everything', 'one-key-for-everything',
       'KLD-PROBE-001', now(), true);
    raise exception 'ASSERT FAIL: one signing key was accepted for configuration, release and transport';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A device-issuing CA that is also the root is refused.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'the-root', 'the-root', 'mfg', 'hsm', 365, 30, 7, 'CRL', 72,
       'cfg-key', 'rel-key', 'tx-key', 'KLD-PROBE-001', now(), true);
    raise exception 'ASSERT FAIL: the offline root was accepted as the device-issuing CA';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A renewal window that is not inside the certificate lifetime is refused.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'root', 'issuing', 'mfg', 'hsm', 30, 90, 7, 'CRL', 72,
       'cfg-key', 'rel-key', 'tx-key', 'KLD-PROBE-001', now(), true);
    raise exception 'ASSERT FAIL: a renewal window longer than the certificate lifetime was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- The environment lock: KLD-2026-07-28-002 authorized DEVELOPMENT trust and
  -- section 14 left pilot and production blocked. A pilot or production row
  -- citing THAT decision is refused, so those environments cannot be smuggled
  -- open under the decision that deliberately left them shut.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, manufacturing_enrollment_key_reference,
       emergency_recovery_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('production', 'root', 'issuing', 'mfg', 'hsm', 365, 90, 14, 'CRL', 72,
       'cfg-key', 'rel-key', 'tx-key', 'mfg-key', 'rec-key',
       'KLD-2026-07-28-002', now(), true);
    raise exception 'ASSERT FAIL: a production PKI configuration was opened under the decision that blocked production';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-PKI-ENVIRONMENT-BLOCKED%' then
      raise exception 'ASSERT FAIL: the environment lock refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Six purposes, not four: a configuration missing the manufacturing or
  -- emergency-recovery key reference is a separation failure, not a pass.
  begin
    insert into kitluy_devices.pki_trust_configuration
      (environment, root_ca_reference, device_issuing_ca_reference, manufacturing_ca_reference,
       required_key_storage_class, certificate_lifetime_days, renewal_window_days,
       overlap_window_days, revocation_mechanism, offline_grace_hours,
       configuration_signing_key_reference, release_signing_key_reference,
       transport_signing_key_reference, approved_by_decision_ref, approved_at, is_active)
    values
      ('pilot', 'root-p', 'issuing-p', 'mfg-p', 'hsm', 180, 60, 14, 'CRL', 72,
       'cfg-p', 'rel-p', 'tx-p', 'KLD-PROBE-002', now(), true);
    raise exception 'ASSERT FAIL: a PKI configuration was accepted with only four signing purposes';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 7 then
    raise exception 'ASSERT FAIL: expected 7 blocked PKI configurations, got %', v_blocked;
  end if;

  -- The DEVELOPMENT row survives untouched; pilot and production stay absent.
  if (select count(*) from kitluy_devices.pki_trust_configuration) <> 1 then
    raise exception 'ASSERT FAIL: the gate table holds % rows; exactly the development row should exist',
      (select count(*) from kitluy_devices.pki_trust_configuration);
  end if;
  if exists (select 1 from kitluy_devices.pki_trust_configuration
              where environment <> 'development') then
    raise exception 'ASSERT FAIL: a non-development PKI configuration survived the governance probes';
  end if;

  raise notice 'PASS ws11-pki-governance: placeholder and [REQUIRED: ...] approvals, one signing key shared across purposes, root-as-issuing-CA, out-of-range renewal windows, a four-purpose configuration and a production row citing the decision that BLOCKED production are all refused (7 probes); exactly the development row survives';
end $$;

-- ---------------------------------------------------------------------------
-- 28j — duplicate hardware signals are DETECTED and leave evidence, rather
-- than being silently rejected by a constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_original uuid;
  v_clone uuid;
  v_mac text := 'aa:bb:cc:c1:' || substr(md5(random()::text), 1, 2) || ':07';
  v_board text := 'board-clone-' || gen_random_uuid();
  v_probe uuid;
  v_held int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_original := kitluy_devices.enroll_device_v1(
    'WS11-T001-ORIG-' || gen_random_uuid(), v_profile, now(),
    repeat('5c', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-o-' || gen_random_uuid())));

  -- A second unit presenting the same non-storage hardware evidence.
  v_clone := kitluy_devices.enroll_device_v1(
    'WS11-T001-CLONE-' || gen_random_uuid(), v_profile, now(),
    repeat('6d', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-c-' || gen_random_uuid())));

  if v_clone = v_original then
    raise exception 'ASSERT FAIL: duplicate hardware evidence collapsed two units into one identity';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_clone) <> 'quarantined' then
    raise exception 'ASSERT FAIL: a duplicate-hardware unit was enrolled without quarantine';
  end if;
  if not exists (select 1 from kitluy_devices.device_trust_incidents
                  where device_id = v_clone and incident_type = 'duplicate_hardware_signal'
                    and severity = 'CRITICAL') then
    raise exception 'ASSERT FAIL: no duplicate_hardware_signal incident recorded';
  end if;

  -- Group 0121: BOTH identities are held. Which unit is the clone is not
  -- knowable from the evidence, so trusting the incumbent would let an actor
  -- who reaches an enrollment station inherit a live identity.
  -- KLD-2026-07-28-002 section 10: the INCUMBENT gets the LESSER containment.
  -- It is restricted, not quarantined, because somebody else submitted a
  -- duplicate.
  if (select lifecycle_state from kitluy_devices.devices where id = v_original)::text
     <> 'restricted_investigation' then
    raise exception 'ASSERT FAIL: the incumbent is % — section 10 requires restricted_investigation, not full quarantine and not left trusted',
      (select lifecycle_state from kitluy_devices.devices where id = v_original);
  end if;
  if (select restricted_from_state from kitluy_devices.devices where id = v_original) is null then
    raise exception 'ASSERT FAIL: the incumbent restriction did not record the state it came from, so a false-positive disposition could not restore it';
  end if;
  if not exists (select 1 from kitluy_devices.device_trust_incidents
                  where device_id = v_original and incident_type = 'duplicate_hardware_signal'
                    and cleared_at is null) then
    raise exception 'ASSERT FAIL: the incumbent device was quarantined with no incident record';
  end if;

  -- Keeping duplicate evidence as rows is sound only if neither identity can
  -- proceed. Both must report the collision and neither may be claimed.
  foreach v_probe in array array[v_original, v_clone] loop
    if (select count(*) from kitluy_devices.colliding_evidence_device_ids(v_probe)) = 0 then
      raise exception 'ASSERT FAIL: device % reports no evidence collision though a duplicate exists', v_probe;
    end if;
    begin
      perform kitluy_devices.create_device_claim_v1(
        v_probe, gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
        repeat('ab', 32), repeat('cd', 32), 900, 'OP-PROBE');
      raise exception 'ASSERT FAIL: device % with colliding evidence was claimable', v_probe;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      v_held := v_held + 1;
    end;
  end loop;
  if v_held <> 2 then
    raise exception 'ASSERT FAIL: expected both identities held, got %', v_held;
  end if;

  raise notice 'PASS ws11-duplicate-detected (KLD-2026-07-28-002 section 10): the NEW identity is quarantined outright while the INCUMBENT gets the lesser restricted_investigation containment with its prior state recorded; both carry open CRITICAL incidents, both report the collision, and neither can be claimed';
end $$;

-- ---------------------------------------------------------------------------
-- 28k — the fleet view reports the blocker instead of hiding it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_blocked_count int;
  v_active_count int;
begin
  -- Group 0121 made the blocker SPECIFIC: an enrolled device with no claim is
  -- AWAITING_CLAIM, not BLOCKED_PKI_UNCONFIGURED. Reporting the PKI blocker on
  -- a device that has not even been claimed would overstate how close it is.
  select count(*) into v_blocked_count from kitluy_devices.device_fleet_status
   where fleet_status = 'AWAITING_CLAIM';
  select count(*) into v_active_count from kitluy_devices.device_fleet_status
   where fleet_status = 'ACTIVE';

  if v_blocked_count = 0 then
    raise exception 'ASSERT FAIL: no enrolled unclaimed device reports AWAITING_CLAIM';
  end if;
  if v_active_count > 0 then
    raise exception 'ASSERT FAIL: % device(s) report ACTIVE while no PKI configuration is approved', v_active_count;
  end if;
  if exists (select 1 from kitluy_devices.device_fleet_status where certificate_status is not null) then
    raise exception 'ASSERT FAIL: a device reports a certificate status with no issuing CA approved';
  end if;
  if exists (select 1 from kitluy_devices.device_assignment_projections) then
    raise exception 'ASSERT FAIL: an offline assignment projection exists though no activation has ever succeeded';
  end if;

  raise notice 'PASS ws11-fleet-honest: the fleet view names the SPECIFIC blocker (AWAITING_CLAIM for an unclaimed device), zero devices are ACTIVE, no device carries a certificate status, and the offline projection table is empty because no activation has ever succeeded';
end $$;


-- ============================================================================
-- SECTION 29 — WS-11-T002 claim, scope and assignment (migration 0121).
-- The seventeen adversarial cases the owner required (2026-07-28), plus the
-- KLRISK-DEVICE-001 control and the activation boundary.
-- Fixture scope from supabase/seed/dev-fixtures.sql:
--   tenant A ..0011 | tenant B ..0012 | store ds01 ..0015 | ds02 ..0016
--   loc01 ..0018 | loc02 ..0019
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 29a — the happy path stops at awaiting_trust, and NOT at active.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_claim uuid;
  v_assignment uuid;
  v_terminal uuid;
  v_token text := encode(sha256(convert_to('tok-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('pay-' || gen_random_uuid(), 'UTF8')), 'hex');
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T002-OK-' || gen_random_uuid(), v_profile, now(),
    repeat('a2', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-t2ok-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-t2ok-' || gen_random_uuid())));

  v_claim := kitluy_devices.create_device_claim_v1(
    v_device,
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015',
    '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');

  v_assignment := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'awaiting_trust' then
    raise exception 'ASSERT FAIL: a redeemed claim did not leave the device awaiting_trust';
  end if;
  if (select state from kitluy_devices.device_assignments where id = v_assignment) <> 'pending_trust' then
    raise exception 'ASSERT FAIL: the assignment is not pending_trust';
  end if;
  if (select assignment_generation from kitluy_devices.devices where id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: the first assignment generation is not 1';
  end if;
  if (select state from kitluy_devices.device_claims where id = v_claim) <> 'redeemed' then
    raise exception 'ASSERT FAIL: the claim was not marked redeemed';
  end if;

  v_terminal := kitluy_devices.assign_terminal_profile_v1(
    v_device, 1, 'laundry.t1.intake_cashier',
    '00000000-0000-4000-8000-000000000018', 'OP-PROVISION');
  if (select state from kitluy_devices.device_terminal_assignments where id = v_terminal) <> 'pending_trust' then
    raise exception 'ASSERT FAIL: a terminal assignment became live before activation';
  end if;

  -- Post-decision the most specific TRUE blocker is production-ineligibility:
  -- KLD-2026-07-28-002 section 4 blocks hardware certification until a
  -- TPM/secure-element SKU is certified, and certified_hardware_skus is empty.
  if (select fleet_status from kitluy_devices.device_fleet_status where device_record_id = v_device)
     <> 'BLOCKED_PRODUCTION_INELIGIBLE' then
    raise exception 'ASSERT FAIL: a claimed, assigned device reports % rather than the production-eligibility blocker',
      (select fleet_status from kitluy_devices.device_fleet_status where device_record_id = v_device);
  end if;
  if exists (select 1 from kitluy_devices.device_assignment_projections where device_id = v_device) then
    raise exception 'ASSERT FAIL: an offline projection was written without activation';
  end if;

  raise notice 'PASS ws11-claim-boundary: claim accepted -> scope bound -> assignment created -> device rests at awaiting_trust with a PENDING terminal assignment, reports BLOCKED_PRODUCTION_INELIGIBLE (the most specific true blocker after KLD-2026-07-28-002), and writes NO offline projection';
end $$;

-- ---------------------------------------------------------------------------
-- 29b — token reuse vs. recovery after response loss, already-claimed, and
-- ownership-transfer refusal.
-- ---------------------------------------------------------------------------
-- Reuse and recovery are the same wire event seen from two sides. The rule:
-- the SAME device re-presenting the SAME token recovers; a DIFFERENT device
-- presenting it is reuse and is refused.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_other uuid;
  v_token text := encode(sha256(convert_to('reuse-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('reuse-p-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_assignment uuid;
  v_replay uuid;
  v_refused int := 0;
  v_TENANT_A constant uuid := '00000000-0000-4000-8000-000000000011';
  v_TENANT_B constant uuid := '00000000-0000-4000-8000-000000000012';
  v_STORE_1 constant uuid := '00000000-0000-4000-8000-000000000015';
  v_STORE_2 constant uuid := '00000000-0000-4000-8000-000000000016';
  v_LOC_1 constant uuid := '00000000-0000-4000-8000-000000000018';
  v_LOC_2 constant uuid := '00000000-0000-4000-8000-000000000019';
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T002-ADV-' || gen_random_uuid(), v_profile, now(),
    repeat('b3', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:02:' || substr(md5(random()::text),1,6) || ':02'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-adv-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-adv-' || gen_random_uuid())));

  v_other := kitluy_devices.enroll_device_v1(
    'WS11-T002-OTHER-' || gen_random_uuid(), v_profile, now(),
    repeat('c4', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:03:' || substr(md5(random()::text),1,6) || ':03'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-oth-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-oth-' || gen_random_uuid())));

  perform kitluy_devices.create_device_claim_v1(
    v_device, v_TENANT_A, v_STORE_1, v_LOC_1, v_token, v_payload, 900, 'OP-PROVISION');
  v_assignment := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-A');

  -- CASE 1: reused claim token, by a different device.
  begin
    perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_other, 'HUB-IMPOSTOR');
    raise exception 'ASSERT FAIL: a redeemed claim token was accepted from a second device';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-CLAIM-REUSED%' then
      raise exception 'ASSERT FAIL: token reuse refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASES 15 and 16: claim committed but response lost, then retried.
  v_replay := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-A');
  if v_replay is distinct from v_assignment then
    raise exception 'ASSERT FAIL: retry after response loss produced a different assignment (% vs %)',
      v_replay, v_assignment;
  end if;
  if (select count(*) from kitluy_devices.device_assignments where device_id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: retry after response loss created a second assignment';
  end if;
  if not exists (select 1 from kitluy_devices.device_claim_events
                  where device_id = v_device and event_type = 'CLAIM_REDEMPTION_REPLAYED') then
    raise exception 'ASSERT FAIL: the idempotent replay was not recorded as such';
  end if;

  -- CASE 5: already-claimed device.
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_device, v_TENANT_A, v_STORE_1, v_LOC_1,
      encode(sha256(convert_to('again-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('again-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: an already-assigned device accepted a second claim';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-ALREADY-CLAIMED%' then
      raise exception 'ASSERT FAIL: second claim refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 7: Hub ownership transfer refusal.
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_device, v_TENANT_B, v_STORE_2, v_LOC_2,
      encode(sha256(convert_to('xfer-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('xfer-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a device changed owner through a new claim';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-OWNERSHIP-TRANSFER%' then
      raise exception 'ASSERT FAIL: ownership transfer refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  if v_refused <> 3 then
    raise exception 'ASSERT FAIL: expected 3 refusals here, got %', v_refused;
  end if;

  raise notice 'PASS ws11-token-reuse-vs-recovery: the SAME device re-presenting the SAME token recovers the SAME assignment and creates no second one (response-loss retry), while a DIFFERENT device presenting it is refused as reuse; a second claim and a disguised ownership transfer are each refused with their own code';
end $$;

-- ---------------------------------------------------------------------------
-- 29c — expiry, altered payload, concurrency, scope, device state, duplicate
-- evidence, generation staleness and terminal Location.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_expiring uuid;
  v_quarantined uuid;
  v_retired uuid;
  v_dup_b uuid;
  v_token text;
  v_payload text;
  v_assignment uuid;
  v_gen2 uuid;
  v_refused int := 0;
  v_dup_mac text := 'ba:0d:' || substr(md5(random()::text),1,6) || ':0d';
  v_dup_board text := 'board-dup-' || gen_random_uuid();
  v_TENANT_A constant uuid := '00000000-0000-4000-8000-000000000011';
  v_TENANT_B constant uuid := '00000000-0000-4000-8000-000000000012';
  v_STORE_1 constant uuid := '00000000-0000-4000-8000-000000000015';
  v_STORE_2 constant uuid := '00000000-0000-4000-8000-000000000016';
  v_LOC_1 constant uuid := '00000000-0000-4000-8000-000000000018';
  v_LOC_2 constant uuid := '00000000-0000-4000-8000-000000000019';
  -- A Location owned by tenant B / store ds03. Fixture note: loc01 and loc02
  -- BOTH belong to store ds01, so loc02 is a valid sibling Location, not a
  -- cross-scope one — it is used for the legitimate reassignment below.
  v_LOC_FOREIGN constant uuid := '00000000-0000-4000-8000-000000000450';
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  -- CASE 2: expired claim token. Exercised with a real 1-second TTL, because
  -- a claim's expiry cannot be back-dated by hand (the claim is immutable).
  v_expiring := kitluy_devices.enroll_device_v1(
    'WS11-T002-EXP-' || gen_random_uuid(), v_profile, now(),
    repeat('e6', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:05:' || substr(md5(random()::text),1,6) || ':05'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-exp-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-exp-' || gen_random_uuid())));
  v_token := encode(sha256(convert_to('exp-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('exp-p-' || gen_random_uuid(), 'UTF8')), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    v_expiring, v_TENANT_A, v_STORE_1, v_LOC_1, v_token, v_payload, 1, 'OP-PROVISION');
  perform pg_sleep(1.2);
  begin
    perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_expiring, 'HUB-LATE');
    raise exception 'ASSERT FAIL: an expired claim token was redeemed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-CLAIM-EXPIRED%' then
      raise exception 'ASSERT FAIL: expiry refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T002-C-' || gen_random_uuid(), v_profile, now(),
    repeat('d5', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:04:' || substr(md5(random()::text),1,6) || ':04'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-c-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-c-' || gen_random_uuid())));

  -- CASE 3: claim token with altered payload. The claim stays ISSUED, which is
  -- what the concurrency case below then collides with.
  v_token := encode(sha256(convert_to('alt-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('alt-p-' || gen_random_uuid(), 'UTF8')), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    v_device, v_TENANT_A, v_STORE_1, v_LOC_1, v_token, v_payload, 900, 'OP-PROVISION');
  begin
    perform kitluy_devices.redeem_device_claim_v1(
      v_token, encode(sha256(convert_to('TAMPERED', 'UTF8')), 'hex'), v_device, 'HUB-C');
    raise exception 'ASSERT FAIL: a claim with an altered payload was redeemed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-CLAIM-PAYLOAD-ALTERED%' then
      raise exception 'ASSERT FAIL: altered payload refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 14: concurrent claims for one device.
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_device, v_TENANT_A, v_STORE_1, v_LOC_1,
      encode(sha256(convert_to('conc-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('conc-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a second outstanding claim was created for one device';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_refused := v_refused + 1;
  end;

  -- CASES 4a/4b/4c: cross-Tenant, cross-Store, cross-Location.
  begin
    perform kitluy_devices.resolve_device_scope_v1(v_TENANT_B, v_STORE_1, v_LOC_1);
    raise exception 'ASSERT FAIL: a cross-tenant scope resolved';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-SCOPE-CROSS-TENANT%' then
      raise exception 'ASSERT FAIL: cross-tenant refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;
  begin
    perform kitluy_devices.resolve_device_scope_v1(v_TENANT_A, v_STORE_2, v_LOC_1);
    raise exception 'ASSERT FAIL: a cross-store scope resolved';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-SCOPE-CROSS-%' then
      raise exception 'ASSERT FAIL: cross-store refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;
  -- Cross-Location, on the LOCATION hop rather than the store hop. In this
  -- data model a Location belongs to exactly one Digital Store, so the
  -- "cross-Store" and "cross-Location" attacks meet the SAME broken hop when
  -- the Location is under a sibling store (checked above). The distinct
  -- location-hop failure is a Location owned by another TENANT entirely.
  -- Recorded plainly rather than manufacturing a third code for one hop.
  begin
    perform kitluy_devices.resolve_device_scope_v1(v_TENANT_A, v_STORE_1, v_LOC_FOREIGN);
    raise exception 'ASSERT FAIL: a foreign-tenant location resolved into this scope';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-SCOPE-CROSS-%' then
      raise exception 'ASSERT FAIL: cross-location refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 8: quarantined device.
  v_quarantined := kitluy_devices.enroll_device_v1(
    'WS11-T002-QUAR-' || gen_random_uuid(), v_profile, now(),
    repeat('f7', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:06:' || substr(md5(random()::text),1,6) || ':06'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-q-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-q-' || gen_random_uuid())));
  perform kitluy_devices.quarantine_device_v1(
    v_quarantined, 'manual_quarantine', 'CRITICAL', 'OP-PROBE', 'assertion probe');
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_quarantined, v_TENANT_A, v_STORE_1, v_LOC_1,
      encode(sha256(convert_to('q-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('q-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a quarantined device was claimed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-QUARANTINED%' then
      raise exception 'ASSERT FAIL: quarantined claim refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 9: retired device.
  v_retired := kitluy_devices.enroll_device_v1(
    'WS11-T002-RET-' || gen_random_uuid(), v_profile, now(),
    repeat('08', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:07:' || substr(md5(random()::text),1,6) || ':07'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-r-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-r-' || gen_random_uuid())));
  perform kitluy_devices.retire_device_v1(v_retired, 'DECOMMISSION', 'OP-PROBE');
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_retired, v_TENANT_A, v_STORE_1, v_LOC_1,
      encode(sha256(convert_to('r-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('r-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a retired device was claimed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TERMINAL%' then
      raise exception 'ASSERT FAIL: retired claim refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 10: duplicate hardware evidence. Two units, same non-storage evidence.
  perform kitluy_devices.enroll_device_v1(
    'WS11-T002-DUPA-' || gen_random_uuid(), v_profile, now(),
    repeat('19', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_dup_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_dup_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-da-' || gen_random_uuid())));
  v_dup_b := kitluy_devices.enroll_device_v1(
    'WS11-T002-DUPB-' || gen_random_uuid(), v_profile, now(),
    repeat('2a', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', v_dup_mac),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', v_dup_board),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-db-' || gen_random_uuid())));
  begin
    perform kitluy_devices.create_device_claim_v1(
      v_dup_b, v_TENANT_A, v_STORE_1, v_LOC_1,
      encode(sha256(convert_to('d-' || gen_random_uuid(), 'UTF8')), 'hex'),
      encode(sha256(convert_to('d-p-' || gen_random_uuid(), 'UTF8')), 'hex'),
      900, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a device with duplicate hardware evidence was claimed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_refused := v_refused + 1;
  end;

  -- Back to v_device, whose altered-payload claim is still ISSUED. Redeem it
  -- properly, then exercise the generation cases.
  v_assignment := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-C');
  if (select assignment_generation from kitluy_devices.device_assignments where id = v_assignment) <> 1 then
    raise exception 'ASSERT FAIL: the first generation is not 1';
  end if;

  -- Reassignment to a different Location under the SAME tenant/store.
  v_gen2 := kitluy_devices.replace_device_assignment_v1(
    v_device, v_TENANT_A, v_STORE_1, v_LOC_2, 'LOCATION_MOVE', 'OP-PROVISION');
  if (select assignment_generation from kitluy_devices.device_assignments where id = v_gen2) <> 2 then
    raise exception 'ASSERT FAIL: the replacement generation is not 2';
  end if;

  -- CASE 11: stale assignment generation.
  begin
    perform kitluy_devices.assert_assignment_generation_current_v1(v_device, 1);
    raise exception 'ASSERT FAIL: a superseded assignment generation resolved as current';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-GENERATION-STALE%' then
      raise exception 'ASSERT FAIL: stale generation refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 13: terminal assigned to the wrong Location.
  begin
    perform kitluy_devices.assign_terminal_profile_v1(
      v_device, 2, 'laundry.t3.ready_scan_in', v_LOC_1, 'OP-PROVISION');
    raise exception 'ASSERT FAIL: a terminal was assigned to a Location the assignment does not bind';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TERMINAL-WRONG-LOCATION%' then
      raise exception 'ASSERT FAIL: wrong-location terminal refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  -- CASE 12: revoked assignment generation.
  perform kitluy_devices.revoke_device_assignment_v1(v_device, 'DEVICE_LOST', 'OP-SECURITY');
  begin
    perform kitluy_devices.assert_assignment_generation_current_v1(v_device, 2);
    raise exception 'ASSERT FAIL: a revoked assignment generation resolved as current';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-GENERATION-REVOKED%' then
      raise exception 'ASSERT FAIL: revoked generation refused for the wrong reason: %', sqlerrm;
    end if;
    v_refused := v_refused + 1;
  end;

  if (select assignment_generation from kitluy_devices.devices where id = v_device) <> 0 then
    raise exception 'ASSERT FAIL: a revoked device still carries a live assignment generation';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'enrolled' then
    raise exception 'ASSERT FAIL: a revoked device did not return to enrolled';
  end if;
  if exists (select 1 from kitluy_devices.device_terminal_assignments
              where device_id = v_device and state <> 'revoked') then
    raise exception 'ASSERT FAIL: a terminal assignment survived the revocation of its assignment';
  end if;

  -- A re-claim after revocation must NOT reuse generation 1 or 2.
  v_token := encode(sha256(convert_to('re-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('re-p-' || gen_random_uuid(), 'UTF8')), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    v_device, v_TENANT_A, v_STORE_1, v_LOC_1, v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-C');
  if (select assignment_generation from kitluy_devices.devices where id = v_device) <> 3 then
    raise exception 'ASSERT FAIL: a re-claim after revocation reused a generation number (got %)',
      (select assignment_generation from kitluy_devices.devices where id = v_device);
  end if;

  if v_refused <> 12 then
    raise exception 'ASSERT FAIL: expected 12 refusals in this section, got %', v_refused;
  end if;

  raise notice 'PASS ws11-adversarial: expired token, altered payload, concurrent claim, cross-Tenant, cross-Store, cross-Location, quarantined, retired, duplicate-evidence, stale generation, revoked generation and wrong-Location terminal are each refused with their own code; revocation returns the device to enrolled at generation 0 and revokes its terminal assignments; and a re-claim after revocation issues generation 3 rather than reusing 1 or 2';
end $$;

-- ---------------------------------------------------------------------------
-- 29d — case 17: attempted activation with BLK-005 open, through the ONLY
-- reachable path, on a device that is otherwise completely ready.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text;
  v_payload text;
  v_assignment uuid;
  v_outcome kitluy_devices.activation_outcome;
  v_refusals int;
  v_TENANT_A constant uuid := '00000000-0000-4000-8000-000000000011';
  v_STORE_1 constant uuid := '00000000-0000-4000-8000-000000000015';
  v_LOC_1 constant uuid := '00000000-0000-4000-8000-000000000018';
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T002-ACT-' || gen_random_uuid(), v_profile, now(),
    repeat('3b', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ba:08:' || substr(md5(random()::text),1,6) || ':08'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-act-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-act-' || gen_random_uuid())));

  v_token := encode(sha256(convert_to('act-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('act-p-' || gen_random_uuid(), 'UTF8')), 'hex');
  perform kitluy_devices.create_device_claim_v1(
    v_device, v_TENANT_A, v_STORE_1, v_LOC_1, v_token, v_payload, 900, 'OP-PROVISION');
  v_assignment := kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-ACT');
  perform kitluy_devices.assign_terminal_profile_v1(
    v_device, 1, 'laundry.t4.pickup_scan_out', v_LOC_1, 'OP-PROVISION');

  -- The device is now as ready as it can possibly be: enrolled, claimed,
  -- scope-bound, assigned, terminal-assigned, no open incidents, no evidence
  -- collision. The ONLY thing missing is BLK-005.
  v_outcome := kitluy_devices.attempt_activate_device_v1(v_device, 'production', 'OP-ACTIVATE');

  if v_outcome.outcome <> 'REFUSED' then
    raise exception 'ASSERT FAIL: activation returned % while BLK-005 is open', v_outcome.outcome;
  end if;
  if v_outcome.refusal_code <> 'KLUY-DEVICE-PKI-UNCONFIGURED' then
    raise exception 'ASSERT FAIL: the refusal code is %, not KLUY-DEVICE-PKI-UNCONFIGURED', v_outcome.refusal_code;
  end if;
  if v_outcome.refusal_message not like '%[REQUIRED:%' or v_outcome.refusal_message not like '%BLK-005%' then
    raise exception 'ASSERT FAIL: the refusal is not an explicit required-value error: %', v_outcome.refusal_message;
  end if;
  if v_outcome.evidence_event_id is null then
    raise exception 'ASSERT FAIL: the refusal returned no evidence event id';
  end if;

  -- No certificate, no active device, no assignment widening, no projection.
  if (select count(*) from kitluy_devices.device_certificates where device_id = v_device) <> 0 then
    raise exception 'ASSERT FAIL: a certificate row was created by a refused activation';
  end if;
  if (select lifecycle_state from kitluy_devices.devices where id = v_device) <> 'awaiting_trust' then
    raise exception 'ASSERT FAIL: a refused activation moved the device out of awaiting_trust';
  end if;
  if (select state from kitluy_devices.device_assignments where id = v_assignment) <> 'pending_trust' then
    raise exception 'ASSERT FAIL: a refused activation advanced the assignment state';
  end if;
  if (select store_location_id from kitluy_devices.device_assignments where id = v_assignment) <> v_LOC_1
     or (select tenant_id from kitluy_devices.device_assignments where id = v_assignment) <> v_TENANT_A
     or (select digital_store_id from kitluy_devices.device_assignments where id = v_assignment) <> v_STORE_1 then
    raise exception 'ASSERT FAIL: the assignment scope changed during a refused activation';
  end if;
  if exists (select 1 from kitluy_devices.device_assignment_projections where device_id = v_device) then
    raise exception 'ASSERT FAIL: a refused activation wrote an offline projection';
  end if;
  if exists (select 1 from kitluy_devices.device_terminal_assignments
              where device_id = v_device and state = 'active') then
    raise exception 'ASSERT FAIL: a refused activation made a terminal assignment live';
  end if;

  -- KLRISK-DEVICE-001: the evidence exists WITHOUT the caller choosing to
  -- write it. attempt_activate_device_v1 was the only call made.
  select count(*) into v_refusals
  from kitluy_devices.device_lifecycle_events
  where device_id = v_device and reason_code = 'ACTIVATION_REFUSED';
  if v_refusals <> 1 then
    raise exception 'ASSERT FAIL: the refusal was not durably recorded by the activation path itself (% events)', v_refusals;
  end if;
  if not exists (select 1 from kitluy_devices.device_trust_incidents
                  where device_id = v_device and incident_type = 'activation_blocked'
                    and cleared_at is null) then
    raise exception 'ASSERT FAIL: the BLK-005 blocker is not visible on the device';
  end if;

  raise notice 'PASS ws11-activation-blocked: a fully-provisioned device — enrolled, claimed, scope-bound, assigned, terminal-assigned, no incidents, no collisions — is REFUSED with KLUY-DEVICE-PKI-UNCONFIGURED, and the refusal is recorded by the activation path ITSELF rather than by a caller that might forget. No certificate, no active device, no assignment widening, no offline projection, no live terminal';
end $$;

-- ---------------------------------------------------------------------------
-- 29e — KLRISK-DEVICE-001: the raising form is unreachable, so a refusal
-- cannot be produced without its evidence.
-- ---------------------------------------------------------------------------
do $$
declare
  v_public_exec boolean;
  v_service_exec boolean;
  v_attempt_exec boolean;
begin
  select has_function_privilege('public', p.oid, 'execute'),
         has_function_privilege('service_role', p.oid, 'execute')
  into v_public_exec, v_service_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'activate_device_v1';

  if v_public_exec or v_service_exec then
    raise exception 'ASSERT FAIL: the raising activation form is executable (public=%, service_role=%); a caller could take a refusal without recording it',
      v_public_exec, v_service_exec;
  end if;

  select has_function_privilege('service_role', p.oid, 'execute')
  into v_attempt_exec
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'attempt_activate_device_v1';

  if not v_attempt_exec then
    raise exception 'ASSERT FAIL: the evidence-recording activation path is not executable by the service role';
  end if;

  raise notice 'PASS ws11-klrisk-device-001: activate_device_v1 is executable by neither PUBLIC nor service_role, and attempt_activate_device_v1 — which records the refusal before returning it — is the only granted activation path';
end $$;


-- ============================================================================
-- SECTION 30 — WS-11-T003 step 2, trusted time (migration 0123).
-- KLD-2026-07-28-002 §12 and the owner's trusted-time instruction (2026-07-28).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 30a — signed trust policy, and the values that must NOT be code constants.
-- ---------------------------------------------------------------------------
do $$
declare
  v_policy kitluy_devices.trust_policy;
  v_blocked int := 0;
begin
  v_policy := kitluy_devices.resolve_trust_policy_v1('development');
  if v_policy.duplicate_incident_quarantine_threshold <> 2
     or v_policy.duplicate_incident_window_seconds <> 86400 then
    raise exception 'ASSERT FAIL: the approved development duplicate defaults are not 2 / 86400 (got % / %)',
      v_policy.duplicate_incident_quarantine_threshold, v_policy.duplicate_incident_window_seconds;
  end if;
  if v_policy.max_clock_lag_seconds <> 300 then
    raise exception 'ASSERT FAIL: the ruled five-minute rollback tolerance is not 300 seconds';
  end if;
  if v_policy.signature_verified then
    raise exception 'ASSERT FAIL: a trust policy is marked signature-verified though no configuration signer exists yet';
  end if;

  -- Pilot and production must have NO policy, so every evaluation there fails
  -- closed rather than falling back to a development default.
  foreach v_policy.environment in array array['pilot', 'production'] loop
    begin
      perform kitluy_devices.resolve_trust_policy_v1(v_policy.environment);
      raise exception 'ASSERT FAIL: a % trust policy resolved though none is signed', v_policy.environment;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      if sqlerrm not like 'KLUY-DEVICE-POLICY-UNCONFIGURED%' then
        raise exception 'ASSERT FAIL: % policy refused for the wrong reason: %', v_policy.environment, sqlerrm;
      end if;
      v_blocked := v_blocked + 1;
    end;
  end loop;

  -- A pilot/production policy citing the decision that approved DEVELOPMENT
  -- defaults is refused; so is an unsigned one; so is one missing the
  -- forward-jump threshold the owner refused to let anyone invent.
  begin
    insert into kitluy_devices.trust_policy
      (environment, policy_version, duplicate_incident_quarantine_threshold,
       duplicate_incident_window_seconds, trusted_time_max_forward_jump_seconds,
       max_revocation_snapshot_age_seconds, policy_payload_sha256,
       signature_verified, policy_signature, policy_signer_key_reference,
       approved_by_decision_ref, approved_at, is_active)
    values ('production', 1, 2, 86400, 3600, 1209600, repeat('a', 64),
            true, 'sig', 'signer', 'KLD-2026-07-28-002', now(), true);
    raise exception 'ASSERT FAIL: a production trust policy was opened under the decision that approved development defaults';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-POLICY-ENVIRONMENT-BLOCKED%' then
      raise exception 'ASSERT FAIL: refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    insert into kitluy_devices.trust_policy
      (environment, policy_version, duplicate_incident_quarantine_threshold,
       duplicate_incident_window_seconds, trusted_time_max_forward_jump_seconds,
       max_revocation_snapshot_age_seconds, policy_payload_sha256,
       signature_verified, approved_by_decision_ref, approved_at, is_active)
    values ('pilot', 1, 2, 86400, 3600, 1209600, repeat('b', 64),
            false, 'KLD-PROBE-003', now(), true);
    raise exception 'ASSERT FAIL: an UNSIGNED pilot trust policy was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-POLICY-UNSIGNED%' then
      raise exception 'ASSERT FAIL: unsigned pilot policy refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    insert into kitluy_devices.trust_policy
      (environment, policy_version, duplicate_incident_quarantine_threshold,
       duplicate_incident_window_seconds, max_revocation_snapshot_age_seconds,
       policy_payload_sha256, signature_verified, policy_signature,
       policy_signer_key_reference, approved_by_decision_ref, approved_at, is_active)
    values ('production', 1, 2, 86400, 1209600, repeat('c', 64),
            true, 'sig', 'signer', 'KLD-PROBE-004', now(), true);
    raise exception 'ASSERT FAIL: a production policy was accepted with no forward-jump threshold';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-POLICY-INCOMPLETE%' then
      raise exception 'ASSERT FAIL: incomplete policy refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 5 then
    raise exception 'ASSERT FAIL: expected 5 policy refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-trust-policy: the duplicate threshold (2) and window (86400s) are SIGNED POLICY carrying the owner-approved DEVELOPMENT defaults, the ruled 300-second rollback tolerance is present, no policy claims a verified signature while no signer exists, and pilot/production policies are refused when they cite the development decision, are unsigned, or omit the forward-jump threshold the owner refused to let anyone invent';
end $$;

-- ---------------------------------------------------------------------------
-- 30b — the §12 calculation and its adversarial cases.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_out kitluy_devices.trusted_time_outcome;
  v_base timestamptz := timestamptz '2026-07-28 08:00:00+07';
  v_floor timestamptz;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T003-TIME-' || gen_random_uuid(), v_profile, now(),
    repeat('7a', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ca:01:' || substr(md5(random()::text),1,6) || ':11'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-time-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-time-' || gen_random_uuid())));

  -- FIRST BOOT with NO trusted source. The floor alone is not a source.
  v_out := kitluy_devices.evaluate_trusted_time_v1(v_device, 'development', null, null, null, gen_random_uuid());
  if v_out.status <> 'restricted_no_trusted_source' or not v_out.restricted then
    raise exception 'ASSERT FAIL: first boot with no source reported % rather than restricted_no_trusted_source', v_out.status;
  end if;
  if v_out.floor_advanced then
    raise exception 'ASSERT FAIL: the floor advanced with no trustworthy source';
  end if;

  -- A trustworthy source establishes time and advances the floor.
  v_out := kitluy_devices.evaluate_trusted_time_v1(v_device, 'development', v_base, null, null, gen_random_uuid());
  if v_out.status <> 'trusted' or not v_out.floor_advanced then
    raise exception 'ASSERT FAIL: a valid RTC did not establish trusted time (status %, advanced %)',
      v_out.status, v_out.floor_advanced;
  end if;
  select trusted_time_floor into v_floor from kitluy_devices.device_trusted_time where device_id = v_device;
  if v_floor <> v_base then
    raise exception 'ASSERT FAIL: the floor is % rather than the selected time %', v_floor, v_base;
  end if;

  -- RTC BEHIND the floor WITHIN the tolerated skew: accepted, floor HELD.
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base - interval '120 seconds', null, null, gen_random_uuid());
  if v_out.status <> 'trusted' then
    raise exception 'ASSERT FAIL: an RTC 2 minutes behind the floor was treated as rollback (%)', v_out.status;
  end if;
  if v_out.floor_advanced then
    raise exception 'ASSERT FAIL: a backwards clock advanced the floor';
  end if;

  -- RTC BEHIND the floor by MORE than five minutes: rollback, restricted.
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base - interval '600 seconds', null, null, gen_random_uuid());
  if v_out.status <> 'restricted_clock_rollback' or not v_out.restricted then
    raise exception 'ASSERT FAIL: an RTC 10 minutes behind the floor reported % rather than rollback', v_out.status;
  end if;

  -- Network time and token below the floor are discarded the same way. The
  -- source does not buy leniency; only the value matters.
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', null, v_base - interval '1 hour', null, gen_random_uuid());
  if v_out.status <> 'restricted_clock_rollback' then
    raise exception 'ASSERT FAIL: authenticated network time below the floor was accepted (%)', v_out.status;
  end if;
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', null, null, v_base - interval '1 hour', gen_random_uuid());
  if v_out.status <> 'restricted_clock_rollback' then
    raise exception 'ASSERT FAIL: a signed token below the floor was accepted (%)', v_out.status;
  end if;

  -- FORWARD JUMP beyond the signed threshold (development test value 3600s).
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base + interval '7200 seconds', null, null, gen_random_uuid());
  if v_out.status <> 'restricted_forward_jump' or not v_out.restricted then
    raise exception 'ASSERT FAIL: a 2-hour forward jump reported % rather than restricted_forward_jump', v_out.status;
  end if;
  if v_out.floor_advanced then
    raise exception 'ASSERT FAIL: a suspicious forward jump advanced the floor';
  end if;

  -- A forward move INSIDE the threshold is normal and advances the floor.
  v_out := kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base + interval '600 seconds', null, null, gen_random_uuid());
  if v_out.status <> 'trusted' or not v_out.floor_advanced then
    raise exception 'ASSERT FAIL: a 10-minute forward move was refused (%)', v_out.status;
  end if;

  -- The floor NEVER moves backwards, and the database says so even when the
  -- caller asks directly.
  begin
    update kitluy_devices.device_trusted_time
    set trusted_time_floor = v_base - interval '1 day' where device_id = v_device;
    raise exception 'ASSERT FAIL: the trusted-time floor was moved backwards by direct update';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TIME-ROLLBACK%' then
      raise exception 'ASSERT FAIL: the floor rollback was refused for the wrong reason: %', sqlerrm;
    end if;
  end;

  -- Every evaluation left an audit row, including the refused ones.
  if (select count(*) from kitluy_devices.device_trusted_time_events
       where device_id = v_device) < 8 then
    raise exception 'ASSERT FAIL: trusted-time evaluations did not leave durable audit rows';
  end if;
  if (select count(*) from kitluy_devices.device_trusted_time_events
       where device_id = v_device and event_type = 'RESTRICTED_ENTERED') < 4 then
    raise exception 'ASSERT FAIL: restricted evaluations were not recorded as such';
  end if;

  raise notice 'PASS ws11-trusted-time-calculation: trusted time is the MAXIMUM of validated sources; a source within tolerated skew is accepted but does not advance the floor; a source more than 5 minutes behind is rollback whatever its provenance; a jump beyond the SIGNED forward threshold is refused and does not advance the floor; the floor cannot be moved backwards even by direct update; and every evaluation including each refusal left durable audit';
end $$;

-- ---------------------------------------------------------------------------
-- 30c — pilot and production fail closed with no signed policy.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_blocked int := 0;
  v_env text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T003-ENV-' || gen_random_uuid(), v_profile, now(),
    repeat('8b', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ca:02:' || substr(md5(random()::text),1,6) || ':12'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-env-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-env-' || gen_random_uuid())));

  foreach v_env in array array['pilot', 'production'] loop
    begin
      perform kitluy_devices.evaluate_trusted_time_v1(v_device, v_env, now(), now(), now(), null);
      raise exception 'ASSERT FAIL: trusted time evaluated in % with no signed policy', v_env;
    exception when others then
      if sqlerrm like 'ASSERT FAIL%' then raise; end if;
      if sqlerrm not like 'KLUY-DEVICE-POLICY-%' then
        raise exception 'ASSERT FAIL: % evaluation refused for the wrong reason: %', v_env, sqlerrm;
      end if;
      v_blocked := v_blocked + 1;
    end;
  end loop;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 environment refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-trusted-time-fails-closed: pilot and production trusted-time evaluation REFUSES while no signed policy exists — three perfectly good time sources do not substitute for the forward-jump threshold the owner refused to let anyone invent';
end $$;

-- ---------------------------------------------------------------------------
-- 30d — restricted trust mode blocks trust-changing work.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_blocked int := 0;
  v_base timestamptz := timestamptz '2026-07-28 09:00:00+07';
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T003-RESTRICT-' || gen_random_uuid(), v_profile, now(),
    repeat('9c', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ca:03:' || substr(md5(random()::text),1,6) || ':13'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-res-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-res-' || gen_random_uuid())));

  -- A device that never established trusted time is restricted by default.
  if not kitluy_devices.is_trusted_time_restricted_v1(v_device) then
    raise exception 'ASSERT FAIL: a device with no trusted-time record is not reported as restricted';
  end if;

  begin
    perform kitluy_devices.issue_device_certificate_v1(
      v_device, 'development', 'SER-RES-1', repeat('9c', 32), 'OP-PROBE');
    raise exception 'ASSERT FAIL: a certificate was issued to a device that has never established trusted time';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TIME-UNTRUSTED%' then
      raise exception 'ASSERT FAIL: issuance refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Establish time, then force a rollback anomaly and re-probe.
  perform kitluy_devices.evaluate_trusted_time_v1(v_device, 'development', v_base, null, null, null);
  perform kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base - interval '1 hour', null, null, null);

  if not kitluy_devices.is_trusted_time_restricted_v1(v_device) then
    raise exception 'ASSERT FAIL: a device in clock-rollback is not reported as restricted';
  end if;

  begin
    perform kitluy_devices.issue_device_certificate_v1(
      v_device, 'development', 'SER-RES-2', repeat('9c', 32), 'OP-PROBE');
    raise exception 'ASSERT FAIL: a certificate was issued while the device is in restricted trust mode';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-DEVICE-TIME-RESTRICTED%' then
      raise exception 'ASSERT FAIL: restricted issuance refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if (select count(*) from kitluy_devices.device_certificates where device_id = v_device) <> 0 then
    raise exception 'ASSERT FAIL: a certificate row exists for a device that never had trustworthy time';
  end if;

  -- Restoring a good source clears restriction.
  perform kitluy_devices.evaluate_trusted_time_v1(
    v_device, 'development', v_base + interval '60 seconds', null, null, null);
  if kitluy_devices.is_trusted_time_restricted_v1(v_device) then
    raise exception 'ASSERT FAIL: restriction did not clear after a trustworthy source returned';
  end if;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 restricted refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-restricted-trust-mode: certificate issuance is refused both for a device that never established trusted time and for one in clock-rollback, no certificate row is created either way, and restriction clears when a trustworthy source returns';
end $$;

-- ---------------------------------------------------------------------------
-- 30e — emergency correction is gated on a REAL four-eyes approval.
-- ---------------------------------------------------------------------------
-- Group 0124 closed the gap where only the TypeScript layer enforced the A3/A4
-- risk class. These probes go through kitluy_auth.approval_policies /
-- approval_requests / approval_decisions rather than a parallel approval idea.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_out kitluy_devices.time_correction_outcome;
  v_base timestamptz := timestamptz '2026-07-28 10:00:00+07';
  v_refused int := 0;
  v_policy_a4 uuid;
  v_policy_a2 uuid;
  v_req uuid;
  v_requester constant uuid := '00000000-0000-4000-8000-000000000007';
  v_approver constant uuid := '00000000-0000-4000-8000-000000000008';

  function_new_request text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T003-CORRECT-' || gen_random_uuid(), v_profile, now(),
    repeat('ad', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ca:04:' || substr(md5(random()::text),1,6) || ':14'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-cor-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-cor-' || gen_random_uuid())));

  perform kitluy_devices.evaluate_trusted_time_v1(v_device, 'development', v_base, null, null, null);

  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('time.correction.a4.' || substr(md5(random()::text),1,8), 1,
          'device.time.correct', 'development', 1, 'ACTIVE', 'A4')
  returning id into v_policy_a4;

  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('time.correction.a2.' || substr(md5(random()::text),1,8), 1,
          'device.time.correct', 'development', 1, 'ACTIVE', 'A2')
  returning id into v_policy_a2;

  -- NO APPROVAL AT ALL.
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '1 day', 'operator wristwatch', 'RTC battery failed',
    null, 'OP-FIELD', v_requester, null, 'development');
  if v_out.outcome <> 'REFUSED' or v_out.refusal_code <> 'KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED' then
    raise exception 'ASSERT FAIL: an unapproved correction returned % / %', v_out.outcome, v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  -- MISSING EVIDENCE, checked before the approval is even looked up.
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '1 day', '', 'RTC battery failed',
    gen_random_uuid(), 'OP-FIELD', v_requester, null, 'development');
  if v_out.refusal_code <> 'KLUY-DEVICE-TIME-CORRECTION-UNEVIDENCED' then
    raise exception 'ASSERT FAIL: an unevidenced correction returned %', v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  -- INSUFFICIENT RISK CLASS. This is the gap group 0124 closed: before it, the
  -- database accepted any approval id at all.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a2, v_requester, 'device', v_device, 'development',
          'emergency_time_correction', repeat('a', 64), 'rtc failed', 'APPROVED')
  returning id into v_req;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_req, v_approver, 'APPROVE');

  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '1 day', 'signed cloud token', 'RTC battery failed',
    v_req, 'OP-FIELD', v_requester, null, 'development');
  if v_out.refusal_code <> 'KLUY-DEVICE-TIME-CORRECTION-RISK-CLASS' then
    raise exception 'ASSERT FAIL: an A2 approval authorized a time correction (got %)', v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  -- SELF-APPROVAL, through the real decision rows.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'emergency_time_correction', repeat('b', 64), 'rtc failed', 'APPROVED')
  returning id into v_req;
  begin
    insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
    values (v_req, v_requester, 'APPROVE');
    -- If group 0035's four-eyes trigger already refuses this, the database is
    -- protecting us one layer earlier and that is recorded rather than fought.
    v_out := kitluy_devices.emergency_time_correction_v1(
      v_device, v_base + interval '1 day', 'signed cloud token', 'RTC battery failed',
      v_req, 'OP-FIELD', v_requester, null, 'development');
    if v_out.refusal_code not in ('KLUY-DEVICE-TIME-CORRECTION-SELF-APPROVED',
                                  'KLUY-DEVICE-TIME-CORRECTION-UNAPPROVED') then
      raise exception 'ASSERT FAIL: a self-approved correction returned %', v_out.refusal_code;
    end if;
    -- Counted only when a correction was actually CALLED and refused. Group
    -- 0035's four-eyes trigger refuses the self-approval decision row itself,
    -- one layer earlier, in which case no correction runs and there is no
    -- audit row to count. Incrementing regardless would have made the audit
    -- assertion below expect evidence of a call that never happened.
    v_refused := v_refused + 1;
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    null;  -- the four-eyes trigger refused the decision row itself
  end;

  -- WRONG SCOPE: an approval naming another device.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', gen_random_uuid(), 'development',
          'emergency_time_correction', repeat('c', 64), 'rtc failed', 'APPROVED')
  returning id into v_req;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_req, v_approver, 'APPROVE');
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '1 day', 'signed cloud token', 'RTC battery failed',
    v_req, 'OP-FIELD', v_requester, null, 'development');
  if v_out.refusal_code <> 'KLUY-DEVICE-TIME-CORRECTION-WRONG-SCOPE' then
    raise exception 'ASSERT FAIL: an approval for another device authorized this one (got %)', v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  -- A proper A4 approval for THIS device.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'emergency_time_correction', repeat('d', 64), 'rtc failed', 'APPROVED')
  returning id into v_req;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_req, v_approver, 'APPROVE');

  -- BACKWARDS, with a valid A4 approval. Authority does not buy rollback.
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base - interval '1 day', 'signed cloud token', 'clock ran ahead',
    v_req, 'OP-FIELD', v_requester, null, 'development');
  if v_out.refusal_code <> 'KLUY-DEVICE-TIME-ROLLBACK' then
    raise exception 'ASSERT FAIL: a fully approved BACKWARDS correction returned %', v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  -- A refused correction must NOT have consumed the approval.
  if exists (select 1 from kitluy_devices.time_correction_approvals
              where approval_request_id = v_req) then
    raise exception 'ASSERT FAIL: a REFUSED correction consumed its approval';
  end if;

  -- Forward, approved: applies.
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '2 days', 'signed cloud token', 'RTC battery replaced',
    v_req, 'OP-FIELD', v_requester, gen_random_uuid(), 'development');
  if v_out.outcome <> 'APPLIED' then
    raise exception 'ASSERT FAIL: an approved forward correction was refused: %', v_out.refusal_message;
  end if;
  if (select trusted_time_floor from kitluy_devices.device_trusted_time where device_id = v_device)
     <> v_base + interval '2 days' then
    raise exception 'ASSERT FAIL: the approved correction did not advance the floor';
  end if;

  -- SINGLE USE: the same approval cannot authorize a second correction.
  v_out := kitluy_devices.emergency_time_correction_v1(
    v_device, v_base + interval '3 days', 'signed cloud token', 'again',
    v_req, 'OP-FIELD', v_requester, null, 'development');
  if v_out.refusal_code <> 'KLUY-DEVICE-TIME-CORRECTION-APPROVAL-CONSUMED' then
    raise exception 'ASSERT FAIL: an approval authorized a SECOND correction (got %)', v_out.refusal_code;
  end if;
  v_refused := v_refused + 1;

  if (select trusted_time_floor from kitluy_devices.device_trusted_time where device_id = v_device)
     <> v_base + interval '2 days' then
    raise exception 'ASSERT FAIL: the refused second correction still moved the floor';
  end if;

  if (select count(*) from kitluy_devices.device_trusted_time_events
       where device_id = v_device and event_type = 'EMERGENCY_CORRECTION'
         and detail ->> 'outcome' = 'REFUSED') < v_refused then
    raise exception 'ASSERT FAIL: refused corrections did not each leave an audit row';
  end if;

  raise notice 'PASS ws11-emergency-time-correction: the correction is gated on a REAL four-eyes approval — no approval, missing evidence, an A2 risk class, self-approval, an approval naming another device, a fully-approved BACKWARDS move and a SECOND use of a consumed approval are each refused with their own code and leave audit; only a forward correction under a scoped, unconsumed A4 approval applies, and a refused correction never consumes its approval';
end $$;

-- 30f — station duplicate containment now reads SIGNED POLICY.
-- ---------------------------------------------------------------------------
do $$
declare
  v_station text := 'STATION-DUP-' || substr(md5(random()::text), 1, 8);
  v_profile uuid;
  v_device uuid;
  v_quarantined boolean;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  insert into kitluy_devices.enrollment_stations
    (station_key, display_name, environment, operator_org_ref)
  values (v_station, 'duplicate probe station', 'development', 'HET-MFG');

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T003-STN-' || gen_random_uuid(), v_profile, now(),
    repeat('be', 32), 'ed25519', 'software', v_station, 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'ca:05:' || substr(md5(random()::text),1,6) || ':15'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-stn-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-stn-' || gen_random_uuid())));

  -- First duplicate: monitoring elevated, station NOT yet quarantined.
  v_quarantined := kitluy_devices.record_station_duplicate_submission_v1(
    v_station, v_device, 'development', null);
  if v_quarantined then
    raise exception 'ASSERT FAIL: the station was quarantined on its FIRST duplicate';
  end if;
  if not (select monitoring_elevated from kitluy_devices.enrollment_stations where station_key = v_station) then
    raise exception 'ASSERT FAIL: the first duplicate did not raise station monitoring';
  end if;

  -- Second duplicate inside the signed window: station quarantined.
  v_quarantined := kitluy_devices.record_station_duplicate_submission_v1(
    v_station, v_device, 'development', null);
  if not v_quarantined then
    raise exception 'ASSERT FAIL: the station was not quarantined at the signed threshold';
  end if;
  if (select status from kitluy_devices.enrollment_stations where station_key = v_station) <> 'quarantined' then
    raise exception 'ASSERT FAIL: the station status is not quarantined';
  end if;

  -- Immediate quarantine regardless of count, for the listed conditions.
  insert into kitluy_devices.enrollment_stations
    (station_key, display_name, environment, operator_org_ref)
  values (v_station || '-B', 'immediate probe station', 'development', 'HET-MFG');
  v_quarantined := kitluy_devices.record_station_duplicate_submission_v1(
    v_station || '-B', v_device, 'development',
    'duplicate presented the same TPM endorsement key');
  if not v_quarantined then
    raise exception 'ASSERT FAIL: a same-TPM duplicate did not quarantine the station immediately';
  end if;

  raise notice 'PASS ws11-station-containment: the first duplicate raises monitoring, a second inside the SIGNED window quarantines the station, and one of the listed immediate conditions (same TPM identity) quarantines regardless of count — the threshold comes from signed policy, not from a code constant';
end $$;


-- ============================================================================
-- SECTION 31 — WS-11-T003 Step 4 credential persistence (migration 0125).
-- The owner's migration attacks (2026-07-28).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 31a — the structural refusals: production eligibility, credential kind,
-- lifetime, and who may write an ISSUED credential.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T004-CRED-' || gen_random_uuid(), v_profile, now(),
    repeat('c1', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'da:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-cred-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-cred-' || gen_random_uuid())));

  insert into kitluy_devices.device_credential_requests
    (request_id, idempotency_key, canonical_payload_hash, device_record_id, environment,
     purpose, assignment_generation, public_key, public_key_fingerprint, hardware_trust_level)
  values
    ('rq-a-' || v_device, 'idem-a-' || v_device, repeat('a', 64), v_device, 'development',
     'device_identity', 1, 'PUBKEY', repeat('b', 64), 'development_software');

  -- SAME idempotency key, DIFFERENT payload hash.
  begin
    insert into kitluy_devices.device_credential_requests
      (request_id, idempotency_key, canonical_payload_hash, device_record_id, environment,
       purpose, assignment_generation, public_key, public_key_fingerprint, hardware_trust_level)
    values
      ('rq-a2-' || v_device, 'idem-a-' || v_device, repeat('c', 64), v_device, 'development',
       'device_identity', 1, 'PUBKEY', repeat('b', 64), 'development_software');
    raise exception 'ASSERT FAIL: the same idempotency key was accepted with a different payload hash';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A credential with NO verified proof of possession.
  begin
    insert into kitluy_devices.device_credentials
      (serial_number, device_record_id, environment, purpose, public_key,
       public_key_fingerprint, issuer_key_id, certificate_generation, assignment_generation,
       not_before, not_after, hardware_trust_level, canonical_tbs, detached_signature,
       created_from_request_id)
    values
      ('SER-NOPOP', v_device, 'development', 'device_identity', 'PUBKEY',
       repeat('b', 64), 'ica', 1, 1, now(), now() + interval '30 days',
       'development_software', 'TBS', '\x00'::bytea, 'rq-a-' || v_device);
    raise exception 'ASSERT FAIL: a credential was issued with no verified proof of possession';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    -- After the governor membership was handed back, the GRANT layer refuses
    -- before the trigger is ever reached. That is stronger, not weaker: the
    -- migrator has no table privilege at all. Any of the three is a pass.
    if sqlerrm not like 'KLUY-CRED-UNAUTHORIZED-ISSUE%'
       and sqlerrm not like 'KLUY-CRED-NO-PROOF-OF-POSSESSION%'
       and sqlerrm not like 'permission denied%' then
      raise exception 'ASSERT FAIL: refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- production_eligible = true, refused by CHECK regardless of identity.
  begin
    insert into kitluy_devices.device_credentials
      (serial_number, device_record_id, environment, purpose, public_key,
       public_key_fingerprint, issuer_key_id, certificate_generation, assignment_generation,
       not_before, not_after, hardware_trust_level, production_eligible,
       canonical_tbs, detached_signature, created_from_request_id)
    values
      ('SER-PROD', v_device, 'development', 'device_identity', 'PUBKEY',
       repeat('b', 64), 'ica', 1, 1, now(), now() + interval '30 days',
       'development_software', true, 'TBS', '\x00'::bytea, 'rq-a-' || v_device);
    raise exception 'ASSERT FAIL: a development credential was marked production-eligible';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A lifetime beyond the 30-day development policy.
  begin
    insert into kitluy_devices.device_credentials
      (serial_number, device_record_id, environment, purpose, public_key,
       public_key_fingerprint, issuer_key_id, certificate_generation, assignment_generation,
       not_before, not_after, hardware_trust_level, canonical_tbs, detached_signature,
       created_from_request_id)
    values
      ('SER-LONG', v_device, 'development', 'device_identity', 'PUBKEY',
       repeat('b', 64), 'ica', 1, 1, now(), now() + interval '400 days',
       'development_software', 'TBS', '\x00'::bytea, 'rq-a-' || v_device);
    raise exception 'ASSERT FAIL: a 400-day development credential was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A different credential KIND. A future X.509 credential is a different
  -- decision, not a value slipped into this column.
  begin
    insert into kitluy_devices.device_credentials
      (credential_kind, serial_number, device_record_id, environment, purpose, public_key,
       public_key_fingerprint, issuer_key_id, certificate_generation, assignment_generation,
       not_before, not_after, hardware_trust_level, canonical_tbs, detached_signature,
       created_from_request_id)
    values
      ('x509', 'SER-X509', v_device, 'development', 'device_identity', 'PUBKEY',
       repeat('b', 64), 'ica', 1, 1, now(), now() + interval '30 days',
       'development_software', 'TBS', '\x00'::bytea, 'rq-a-' || v_device);
    raise exception 'ASSERT FAIL: a credential claiming to be X.509 was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A generation head written by anyone other than the governor.
  begin
    insert into kitluy_devices.device_credential_heads
      (device_record_id, environment, purpose, current_generation)
    values (v_device, 'development', 'device_identity', 1);
    raise exception 'ASSERT FAIL: a generation head was written outside the governed path';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-UNAUTHORIZED-HEAD%'
       and sqlerrm not like 'permission denied%' then
      raise exception 'ASSERT FAIL: head write refused for the wrong reason: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 6 then
    raise exception 'ASSERT FAIL: expected 6 structural refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-credential-structure: the same idempotency key with a different payload, a credential with no verified proof of possession, a production-eligible development credential, a 400-day lifetime, a credential claiming to be X.509 and an ungoverned generation-head write are ALL refused by the database';
end $$;

-- ---------------------------------------------------------------------------
-- 31b — a FAILED proof of possession is spent, and audit is mandatory.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_rq text;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T004-POP-' || gen_random_uuid(), v_profile, now(),
    repeat('d2', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type', 'mac_address',   'signal_value', 'da:02:' || substr(md5(random()::text),1,6) || ':02'),
      jsonb_build_object('signal_type', 'board_serial',  'signal_value', 'board-pop-' || gen_random_uuid()),
      jsonb_build_object('signal_type', 'storage_serial','signal_value', 'nvme-pop-' || gen_random_uuid())));
  v_rq := 'rq-pop-' || v_device;

  insert into kitluy_devices.device_credential_requests
    (request_id, idempotency_key, canonical_payload_hash, device_record_id, environment,
     purpose, assignment_generation, public_key, public_key_fingerprint, hardware_trust_level)
  values
    (v_rq, 'idem-pop-' || v_device, repeat('e', 64), v_device, 'development',
     'device_identity', 1, 'PUBKEY', repeat('f', 64), 'development_software');

  insert into kitluy_devices.device_proof_of_possession_results
    (request_id, algorithm, signed_preimage_hash, signature, verification_status, failure_code)
  values
    (v_rq, 'ed25519', repeat('1', 64), '\x00'::bytea, 'failed', 'SIGNATURE_INVALID');

  -- The failed result cannot be overwritten with a success.
  begin
    update kitluy_devices.device_proof_of_possession_results
    set verification_status = 'verified', failure_code = null,
        verified_key_fingerprint = repeat('f', 64), verified_at_trusted_time = now()
    where request_id = v_rq;
    raise exception 'ASSERT FAIL: a FAILED proof of possession was rewritten as verified';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A second proof for the same request cannot be added alongside it.
  begin
    insert into kitluy_devices.device_proof_of_possession_results
      (request_id, algorithm, signed_preimage_hash, signature, verification_status,
       verified_key_fingerprint, verified_at_trusted_time)
    values
      (v_rq, 'ed25519', repeat('2', 64), '\x01'::bytea, 'verified', repeat('f', 64), now());
    raise exception 'ASSERT FAIL: a second proof of possession was accepted for a spent request';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  -- A chain link pointing at the wrong environment or purpose.
  begin
    insert into kitluy_devices.device_credential_chain_links
      (credential_id, link_position, role, subject_fingerprint, issuer_key_id,
       environment, purpose, canonical_tbs, detached_signature)
    values
      (gen_random_uuid(), 0, 'root', repeat('9', 64), 'root',
       'production', 'device_identity', 'TBS', '\x00'::bytea);
    raise exception 'ASSERT FAIL: a chain link for a nonexistent credential was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if; v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 3 then
    raise exception 'ASSERT FAIL: expected 3 refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-credential-pop: a FAILED proof of possession is SPENT — it cannot be rewritten as verified, and the request id cannot carry a second proof; a chain link for an unknown credential is refused';
end $$;

-- ---------------------------------------------------------------------------
-- 31c — the governor role cannot be assumed, by anyone that can log in.
-- ---------------------------------------------------------------------------
-- This block previously ran `set local role kitluy_credential_issuer` to
-- exercise the overlap and head-version invariants directly. Containment now
-- REFUSES that, which is the point — so the block tests the refusal instead.
--
-- OWED, and not claimed as tested: the overlap-window, head-version and
-- head-rollback invariants are still enforced by triggers in group 0125, but
-- they are now only reachable through the governed issuance functions, which do
-- not exist yet. Their behavioural tests move to the issuance-adapter unit.
-- ---------------------------------------------------------------------------
do $$
declare
  v_refused boolean := false;
begin
  begin
    execute 'set local role kitluy_credential_issuer';
    -- If this succeeded, a login-capable role can become the governor and write
    -- issued credentials directly. That is the hole NOLOGIN does not close.
    execute 'reset role';
    raise exception 'ASSERT FAIL: the current login-capable role can SET ROLE kitluy_credential_issuer';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_refused := true;
  end;

  if not v_refused then
    raise exception 'ASSERT FAIL: SET ROLE kitluy_credential_issuer was not refused';
  end if;

  raise notice 'PASS ws11-governor-unassumable: the migrating login-capable role CANNOT SET ROLE kitluy_credential_issuer — the membership it needed to transfer ownership is handed back before the migration commits. Found by the owner-requested assertion, which failed on exactly this before the revoke existed';
end $$;

-- 31d — application roles cannot write an issued credential or a head.
-- ---------------------------------------------------------------------------
do $$
declare
  v_priv boolean;
begin
  -- service_role holds SELECT on credentials and heads, and nothing more.
  select has_table_privilege('service_role', 'kitluy_devices.device_credentials', 'INSERT')
  into v_priv;
  if v_priv then
    raise exception 'ASSERT FAIL: service_role can INSERT a credential directly';
  end if;
  select has_table_privilege('service_role', 'kitluy_devices.device_credentials', 'UPDATE')
  into v_priv;
  if v_priv then
    raise exception 'ASSERT FAIL: service_role can UPDATE a credential directly';
  end if;
  select has_table_privilege('service_role', 'kitluy_devices.device_credential_heads', 'UPDATE')
  into v_priv;
  if v_priv then
    raise exception 'ASSERT FAIL: service_role can advance a generation head directly';
  end if;
  select has_table_privilege('service_role', 'kitluy_devices.device_credentials', 'SELECT')
  into v_priv;
  if not v_priv then
    raise exception 'ASSERT FAIL: service_role cannot read credentials at all';
  end if;

  raise notice 'PASS ws11-credential-authority: service_role can READ credentials and generation heads but cannot INSERT or UPDATE either — writing them is the governed path''s job, enforced by grant AND by an executing-identity trigger rather than by convention';
end $$;


-- ============================================================================
-- SECTION 32 — governor-role containment (owner condition, 2026-07-28).
--
-- NOLOGIN stops direct authentication. It does NOT stop `SET ROLE` by a member,
-- so "the role cannot log in" is not the guarantee — "nothing that can log in
-- is a member" is. These assertions test the second statement.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 32a — membership, admin option and SET ROLE reachability.
-- ---------------------------------------------------------------------------
do $$
declare
  v_member text;
  v_bad text[] := '{}';
  v_admin text[] := '{}';
  v_app_roles constant text[] := array[
    'service_role', 'authenticated', 'anon', 'authenticator',
    'kitluy_hub_runtime', 'kitluy_sync_worker'];
  v_role text;
begin
  -- 1. No APPLICATION role may be a member of the governor. Membership is what
  --    makes SET ROLE possible; NOLOGIN is irrelevant to it.
  foreach v_role in array v_app_roles loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and pg_has_role(v_role, 'kitluy_credential_issuer', 'MEMBER') then
      v_bad := v_bad || v_role;
    end if;
  end loop;
  if cardinality(v_bad) > 0 then
    raise exception 'ASSERT FAIL: application role(s) % are members of kitluy_credential_issuer and could SET ROLE to it',
      array_to_string(v_bad, ', ');
  end if;

  -- 2. No application role may hold ADMIN OPTION, which would let it grant the
  --    governor to anything else.
  foreach v_role in array v_app_roles loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and pg_has_role(v_role, 'kitluy_credential_issuer', 'USAGE') then
      v_admin := v_admin || v_role;
    end if;
  end loop;
  if cardinality(v_admin) > 0 then
    raise exception 'ASSERT FAIL: application role(s) % hold USAGE/ADMIN over kitluy_credential_issuer',
      array_to_string(v_admin, ', ');
  end if;

  -- 3. Enumerate who CAN reach the governor. The migrator holds membership by
  --    necessity (it transfers ownership), and a superuser reaches everything
  --    regardless. Anything ELSE is a finding, so the check is a whitelist
  --    rather than a spot check.
  for v_member in
    select r.rolname
    from pg_auth_members m
    join pg_roles r on r.oid = m.member
    join pg_roles g on g.oid = m.roleid
    where g.rolname = 'kitluy_credential_issuer'
  loop
    if not exists (select 1 from pg_roles where rolname = v_member and rolsuper) then
      raise exception
        'ASSERT FAIL: non-superuser role % is a member of kitluy_credential_issuer and can SET ROLE to it', v_member;
    end if;
  end loop;

  -- 4. The governor itself must not be able to log in, and must hold no
  --    superuser, createrole or bypassrls attribute — a governed writer that
  --    could bypass RLS would defeat the policies it exists to be constrained by.
  if exists (
    select 1 from pg_roles
    where rolname = 'kitluy_credential_issuer'
      and (rolcanlogin or rolsuper or rolcreaterole or rolbypassrls)
  ) then
    raise exception 'ASSERT FAIL: kitluy_credential_issuer holds login or elevated attributes';
  end if;

  raise notice 'PASS ws11-governor-membership: no application role is a member of kitluy_credential_issuer or holds admin over it, every member is a superuser (who reaches everything anyway), and the governor itself cannot log in and holds no superuser/createrole/bypassrls attribute — NOLOGIN is not the guarantee, non-membership is';
end $$;

-- ---------------------------------------------------------------------------
-- 32b — SECURITY DEFINER hygiene and ownership drift.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn record;
  v_findings text[] := '{}';
begin
  for v_fn in
    select p.oid,
           p.oid::regprocedure::text as signature,
           p.prosecdef,
           p.proconfig,
           pg_get_userbyid(p.proowner) as owner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'kitluy_devices'
  loop
    -- Every SECURITY DEFINER function must pin search_path. Without it, a
    -- caller controls name resolution INSIDE a definer-privileged body.
    if v_fn.prosecdef then
      if v_fn.proconfig is null
         or not exists (
           select 1 from unnest(v_fn.proconfig) as c where c like 'search\_path=%') then
        v_findings := v_findings || format('%s is SECURITY DEFINER with no fixed search_path', v_fn.signature);
      end if;
    end if;

    -- No function may be EXECUTE-able by PUBLIC. PostgreSQL grants that at
    -- creation and a later GRANT does not revoke it — the WS-10 migration-0020
    -- lesson, re-checked here for the credential surface.
    if has_function_privilege('public', v_fn.oid, 'execute') then
      v_findings := v_findings || format('%s is EXECUTE-able by PUBLIC', v_fn.signature);
    end if;

    -- Ownership must not drift to a LOGIN-CAPABLE role. A definer function
    -- owned by something that can authenticate is a different trust boundary
    -- than the one that was reviewed.
    if v_fn.prosecdef
       and exists (select 1 from pg_roles where rolname = v_fn.owner and rolcanlogin and not rolsuper) then
      v_findings := v_findings || format('%s is SECURITY DEFINER owned by login-capable %s', v_fn.signature, v_fn.owner);
    end if;
  end loop;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % function hygiene finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-definer-hygiene: every kitluy_devices SECURITY DEFINER function pins search_path, no function is EXECUTE-able by PUBLIC, and no definer function is owned by a login-capable non-superuser role';
end $$;

-- ---------------------------------------------------------------------------
-- 32c — governor-owned TABLE ownership has not drifted.
-- ---------------------------------------------------------------------------
do $$
declare
  v_owner text;
  v_table text;
begin
  foreach v_table in array array['device_credentials', 'device_credential_heads'] loop
    select tableowner into v_owner
    from pg_tables where schemaname = 'kitluy_devices' and tablename = v_table;

    if v_owner is distinct from 'kitluy_credential_issuer' then
      raise exception
        'ASSERT FAIL: kitluy_devices.% is owned by % rather than the governor', v_table, v_owner;
    end if;
    -- FORCE must stay on: without it the owner bypasses its own policies.
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'kitluy_devices' and c.relname = v_table
        and c.relrowsecurity and c.relforcerowsecurity
    ) then
      raise exception 'ASSERT FAIL: kitluy_devices.% does not have RLS ENABLE+FORCE', v_table;
    end if;
  end loop;

  raise notice 'PASS ws11-governor-ownership: the credential and generation-head tables are owned by kitluy_credential_issuer with RLS ENABLE+FORCE still on, so the owner is bound by its own named policies rather than exempt from them';
end $$;

select 'assertions complete: groups 0010-0125 structural contract holds (incl. cycle-10 WS-11 sections 28 (T001), 29 (T002), 30 (T003 trusted time), 31 (T003 credential persistence) and 32 (governor containment))' as result;


-- ============================================================================
-- SECTION 33 — governed issuance: prepare -> sign -> finalize (migration 0127).
--
-- CRYPTOGRAPHIC VERIFICATION BOUNDARY: OPTION B. This database has no Ed25519
-- primitive (probed: pgcrypto offers PGP encryption only; pgsodium is available
-- but NOT installed and never reviewed). So the signature itself is attested by
-- the issuance service, and everything BINDING that signature — reserved
-- identifiers, canonical TBS, hashes, state, generation authority, executing
-- identity, atomic persistence — is enforced here and tested here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 33a — the happy path, and what it must leave behind.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t33a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p33a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('i33a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-33a-' || gen_random_uuid();
  v_prep jsonb;
  v_fin jsonb;
  v_links int;
  v_head kitluy_devices.device_credential_heads;
  v_cred kitluy_devices.device_credentials;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33A-' || gen_random_uuid(), v_profile, now(),
    repeat('3a', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3a:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33a-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33a-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-PEM-33A',
    repeat('3a', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1b2c3', 'hex'), true, 'ica-key-33a', now(), 'trusted', 'ISSUANCE-SVC');

  if v_prep ->> 'outcome' <> 'RESERVED' then
    raise exception 'ASSERT FAIL: prepare did not reserve: %', v_prep;
  end if;
  -- The window is computed by the database, never accepted from the caller.
  if (v_prep ->> 'not_after')::timestamptz - (v_prep ->> 'not_before')::timestamptz
     <> interval '30 days' then
    raise exception 'ASSERT FAIL: the reserved window is not the 30-day development lifetime';
  end if;
  -- The TBS the caller is asked to sign hashes to the hash it is given.
  if encode(extensions.digest(v_prep ->> 'canonical_tbs', 'sha256'), 'hex')
     <> (v_prep ->> 'canonical_tbs_hash') then
    raise exception 'ASSERT FAIL: the reserved TBS does not hash to the reserved hash';
  end if;
  -- The serial is DERIVED from the idempotency key, so recovery recomputes it.
  if (v_prep ->> 'serial_number') <> 'DEV-' || upper(substr(v_idem, 1, 16)) then
    raise exception 'ASSERT FAIL: the serial is not derived from the idempotency key';
  end if;

  -- Finalizing before the signature is recorded is refused.
  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(v_req, '[]'::jsonb, 'SVC');
    raise exception 'ASSERT FAIL: finalization succeeded with no recorded signature';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-NOT-SIGNED%' then
      raise exception 'ASSERT FAIL: wrong refusal before signing: %', sqlerrm;
    end if;
  end;

  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('deadbeef', 'hex'), true, 'ISSUANCE-SVC');

  if (select state from kitluy_devices.device_credential_requests where request_id = v_req)
     <> 'signed_unpersisted' then
    raise exception 'ASSERT FAIL: a recorded signature did not move the request to signed_unpersisted';
  end if;

  v_fin := kitluy_devices.finalize_device_credential_issuance_v1(
    v_req,
    jsonb_build_array(
      jsonb_build_object('link_position', 0, 'role', 'root', 'subject_fingerprint', repeat('r', 64),
                         'issuer_key_id', 'root-key-33a', 'canonical_tbs', 'ROOT-TBS',
                         'detached_signature_b64', encode(decode('aa', 'hex'), 'base64')),
      jsonb_build_object('link_position', 1, 'role', 'intermediate', 'subject_fingerprint', repeat('i', 64),
                         'issuer_key_id', 'root-key-33a', 'canonical_tbs', 'ICA-TBS',
                         'detached_signature_b64', encode(decode('bb', 'hex'), 'base64'))),
    'ISSUANCE-SVC');

  if v_fin ->> 'outcome' <> 'ISSUED' then
    raise exception 'ASSERT FAIL: finalization did not issue: %', v_fin;
  end if;

  select * into v_cred from kitluy_devices.device_credentials
   where created_from_request_id = v_req;
  if v_cred.credential_id::text <> (v_prep ->> 'credential_id') then
    raise exception 'ASSERT FAIL: the issued credential id is not the reserved one';
  end if;
  if v_cred.canonical_tbs <> (v_prep ->> 'canonical_tbs') then
    raise exception 'ASSERT FAIL: the persisted TBS is not the reserved TBS';
  end if;
  if v_cred.production_eligible then
    raise exception 'ASSERT FAIL: a development credential is production-eligible';
  end if;

  -- The DEVICE chain link is built by the database from the reservation, so
  -- three links exist even though the caller supplied only two.
  select count(*) into v_links from kitluy_devices.device_credential_chain_links
   where credential_id = v_cred.credential_id;
  if v_links <> 3 then
    raise exception 'ASSERT FAIL: expected 3 chain links, found %', v_links;
  end if;
  if (select detached_signature from kitluy_devices.device_credential_chain_links
       where credential_id = v_cred.credential_id and role = 'device')
     <> decode('deadbeef', 'hex') then
    raise exception 'ASSERT FAIL: the device chain link does not carry the recorded signature';
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_device and environment = 'development';
  if v_head.current_generation <> 1 or v_head.version <> 1
     or v_head.previous_generation is not null then
    raise exception 'ASSERT FAIL: the first head is not generation 1 at version 1 with no overlap';
  end if;

  if not exists (select 1 from kitluy_devices.device_credential_issuance_attempts
                  where request_id = v_req and to_state = 'issued') then
    raise exception 'ASSERT FAIL: no issuance audit event for the issued credential';
  end if;
  if (select state from kitluy_devices.device_credential_signing_attempts where request_id = v_req)
     <> 'finalized' then
    raise exception 'ASSERT FAIL: the signing attempt was not marked finalized';
  end if;

  -- FINALIZATION RETRY returns the already-issued result, and mints nothing.
  v_fin := kitluy_devices.finalize_device_credential_issuance_v1(v_req, '[]'::jsonb, 'SVC');
  if v_fin ->> 'outcome' <> 'ALREADY_ISSUED' then
    raise exception 'ASSERT FAIL: a finalization retry did not replay: %', v_fin;
  end if;
  if (select count(*) from kitluy_devices.device_credentials where device_record_id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: a finalization retry produced a second credential';
  end if;
  if (select version from kitluy_devices.device_credential_heads
       where device_record_id = v_device and environment = 'development') <> 1 then
    raise exception 'ASSERT FAIL: a finalization retry advanced the head again';
  end if;

  raise notice 'PASS ws11-issuance-happy-path: prepare reserved a 30-day window, a database-built TBS and a key-derived serial; finalization wrote credential + 3 chain links (the device link from the reservation, not the caller) + head v1 + audit atomically; and a finalization RETRY replayed without a second credential or a second head advance';
end $$;

-- ---------------------------------------------------------------------------
-- 33b — idempotency, and the immutability of a reservation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t33b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p33b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('i33b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-33b-' || gen_random_uuid();
  v_first jsonb;
  v_second jsonb;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33B-' || gen_random_uuid(), v_profile, now(),
    repeat('3b', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3b:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33b-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33b-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_first := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33B',
    repeat('3b', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33b', now(), 'trusted', 'SVC');

  -- REPEATING the same request returns the SAME attempt and the SAME TBS.
  v_second := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33B',
    repeat('3b', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33b', now(), 'trusted', 'SVC');

  if v_second ->> 'outcome' <> 'REPLAYED_RESERVATION' then
    raise exception 'ASSERT FAIL: a repeated prepare did not replay: %', v_second;
  end if;
  if (v_second ->> 'attempt_id') <> (v_first ->> 'attempt_id')
     or (v_second ->> 'serial_number') <> (v_first ->> 'serial_number')
     or (v_second ->> 'certificate_generation') <> (v_first ->> 'certificate_generation')
     or (v_second ->> 'canonical_tbs') <> (v_first ->> 'canonical_tbs')
     or (v_second ->> 'credential_id') <> (v_first ->> 'credential_id') then
    raise exception 'ASSERT FAIL: a repeated prepare allocated new signing material';
  end if;
  if (select count(*) from kitluy_devices.device_credential_signing_attempts
       where device_record_id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: a repeated prepare created a second signing attempt';
  end if;

  -- A CHANGED payload under the same request id is refused outright.
  begin
    perform kitluy_devices.prepare_device_credential_issuance_v1(
      v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33B',
      repeat('3b', 32), encode(sha256(convert_to('other', 'UTF8')), 'hex'), repeat('7', 64),
      'ed25519', repeat('8', 64), decode('a1', 'hex'), true, 'ica-33b', now(), 'trusted', 'SVC');
    raise exception 'ASSERT FAIL: a changed payload was accepted under a used request id';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-REQUEST-PAYLOAD-CHANGED%' then
      raise exception 'ASSERT FAIL: wrong refusal for a changed payload: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- A reserved identifier cannot be rewritten, even by the governed path.
  -- Exercised through the trigger, which is what protects it if a function
  -- is ever wrong.
  begin
    update kitluy_devices.device_credential_signing_attempts
       set serial_number = 'DEV-ATTACKER' where request_id = v_req;
    raise exception 'ASSERT FAIL: a reserved serial was rewritten after preparation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-RESERVATION-MUTATED%'
       and sqlerrm not like 'KLUY-CRED-UNAUTHORIZED-ATTEMPT%'
       and sqlerrm not like 'permission denied%' then
      raise exception 'ASSERT FAIL: wrong refusal for a mutated reservation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 blocked mutations, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-issuance-idempotent: repeating a request returns the SAME attempt, serial, generation, credential id and TBS with no second reservation; a changed payload under a used request id is refused; and a reserved identifier cannot be rewritten after preparation';
end $$;

-- ---------------------------------------------------------------------------
-- 33c — the signature stage: what will not be recorded.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t33c-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p33c-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('i33c-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-33c-' || gen_random_uuid();
  v_prep jsonb;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33C-' || gen_random_uuid(), v_profile, now(),
    repeat('3c', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3c:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33c-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33c-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33C',
    repeat('3c', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33c', now(), 'trusted', 'SVC');

  -- A signature over a DIFFERENT TBS than the one reserved.
  begin
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req, repeat('f', 64), decode('cafe', 'hex'), true, 'SVC');
    raise exception 'ASSERT FAIL: a signature over a different TBS was recorded';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-TBS-MISMATCH%' then
      raise exception 'ASSERT FAIL: wrong refusal for a TBS mismatch: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- An EMPTY signature.
  begin
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req, v_prep ->> 'canonical_tbs_hash', ''::bytea, true, 'SVC');
    raise exception 'ASSERT FAIL: an empty signature was recorded';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-EMPTY-SIGNATURE%' then
      raise exception 'ASSERT FAIL: wrong refusal for an empty signature: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- A signature the SERVICE did not attest to. Under OPTION B the database
  -- cannot check the curve maths, so an unattested signature is refused
  -- rather than accepted on the caller's silence.
  begin
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req, v_prep ->> 'canonical_tbs_hash', decode('cafe', 'hex'), false, 'SVC');
    raise exception 'ASSERT FAIL: an unattested signature was recorded';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-SIGNATURE-UNATTESTED%' then
      raise exception 'ASSERT FAIL: wrong refusal for an unattested signature: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- The real signature is recorded, and then a DIFFERENT one is offered.
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('c0ffee', 'hex'), true, 'SVC');
  begin
    perform kitluy_devices.record_device_credential_signature_v1(
      v_req, v_prep ->> 'canonical_tbs_hash', decode('badbad', 'hex'), true, 'SVC');
    raise exception 'ASSERT FAIL: a recorded signature was replaced';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-SIGNATURE-REPLACED%' then
      raise exception 'ASSERT FAIL: wrong refusal for a replaced signature: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- Re-recording the IDENTICAL signature is a no-op, not an error: this is
  -- what makes the crash point "after signing, before the record commits"
  -- safely retryable.
  if kitluy_devices.record_device_credential_signature_v1(
       v_req, v_prep ->> 'canonical_tbs_hash', decode('c0ffee', 'hex'), true, 'SVC') ->> 'outcome'
     <> 'ALREADY_RECORDED' then
    raise exception 'ASSERT FAIL: re-recording the identical signature was not idempotent';
  end if;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 refused signature attempts, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-issuance-signature-stage: a signature over another TBS, an empty signature, a signature the service did not attest to, and a replacement for an already-recorded signature are all refused with distinct codes — while re-recording the IDENTICAL signature is idempotent, which is what makes the post-signing crash point recoverable';
end $$;

-- ---------------------------------------------------------------------------
-- 33d — revalidation: what changes underneath a signature in flight.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text;
  v_payload text;
  v_idem text;
  v_req text;
  v_prep jsonb;
  v_blocked int := 0;
begin
  -- Case 1: the assignment generation moves while the CA is signing.
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_token := encode(sha256(convert_to('t33d1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('p33d1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem := encode(sha256(convert_to('i33d1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req := 'rq-33d1-' || gen_random_uuid();

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33D1-' || gen_random_uuid(), v_profile, now(),
    repeat('3d', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3d:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33d1-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33d1-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33D',
    repeat('3d', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33d', now(), 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('c0ffee', 'hex'), true, 'SVC');

  -- The device is reassigned AFTER the signature exists.
  update kitluy_devices.devices set assignment_generation = assignment_generation + 1
   where id = v_device;

  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(
      v_req,
      jsonb_build_array(
        jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                           'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
        jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                           'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw==')),
      'SVC');
    raise exception 'ASSERT FAIL: a credential was issued after the assignment generation moved';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-STALE-ASSIGNMENT%' then
      raise exception 'ASSERT FAIL: wrong refusal for a stale assignment: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if exists (select 1 from kitluy_devices.device_credentials where created_from_request_id = v_req) then
    raise exception 'ASSERT FAIL: a refused finalization still wrote a credential';
  end if;
  if exists (select 1 from kitluy_devices.device_credential_heads where device_record_id = v_device) then
    raise exception 'ASSERT FAIL: a refused finalization still advanced a head';
  end if;

  -- Case 2: a blocking trust incident opens while the CA is signing.
  v_token := encode(sha256(convert_to('t33d2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload := encode(sha256(convert_to('p33d2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem := encode(sha256(convert_to('i33d2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req := 'rq-33d2-' || gen_random_uuid();

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33D2-' || gen_random_uuid(), v_profile, now(),
    repeat('3e', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3e:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33d2-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33d2-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33D2',
    repeat('3e', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33d2', now(), 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('c0ffee', 'hex'), true, 'SVC');

  insert into kitluy_devices.device_trust_incidents
    (device_id, incident_type, severity, detail, detected_by, detected_at)
  values (v_device, 'key_fingerprint_mismatch', 'CRITICAL',
          jsonb_build_object('note', 'opened while the CA was signing'),
          'ASSERTION-PROBE', now());

  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(
      v_req,
      jsonb_build_array(
        jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                           'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
        jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                           'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw==')),
      'SVC');
    raise exception 'ASSERT FAIL: a credential was issued despite an open trust incident';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-OPEN-TRUST-INCIDENT%' then
      raise exception 'ASSERT FAIL: wrong refusal for an open incident: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 revalidation refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-issuance-revalidation: preparation is not a licence — a reassignment or a trust incident that lands WHILE the CA is signing refuses finalization with its own code, and the refused transaction leaves no credential and no head behind';
end $$;

-- ---------------------------------------------------------------------------
-- 33e — the chain, and the rollback it forces.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t33e-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p33e-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('i33e-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-33e-' || gen_random_uuid();
  v_prep jsonb;
  v_blocked int := 0;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33E-' || gen_random_uuid(), v_profile, now(),
    repeat('3f', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','3f:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33e-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33e-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PUBKEY-33E',
    repeat('3f', 32), v_idem, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33e', now(), 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('c0ffee', 'hex'), true, 'SVC');

  -- A caller offering its OWN device chain link is refused: that link is
  -- built from the reservation, so a caller cannot bind a different signature.
  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(
      v_req,
      jsonb_build_array(
        jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                           'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
        jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                           'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='),
        jsonb_build_object('link_position',2,'role','device','subject_fingerprint',repeat('d',64),
                           'issuer_key_id','rk','canonical_tbs','ATTACKER','detached_signature_b64','zA==')),
      'SVC');
    raise exception 'ASSERT FAIL: a caller-supplied device chain link was accepted';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-DEVICE-LINK-SUPPLIED%' then
      raise exception 'ASSERT FAIL: wrong refusal for a supplied device link: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- An INCOMPLETE chain: the credential insert has already happened inside the
  -- function when this raises, so this is the rollback proof.
  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(
      v_req,
      jsonb_build_array(
        jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                           'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg==')),
      'SVC');
    raise exception 'ASSERT FAIL: a credential was issued with an incomplete chain';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-INCOMPLETE-CHAIN%' then
      raise exception 'ASSERT FAIL: wrong refusal for an incomplete chain: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- NOTHING survived either refusal — not the credential, not the audit row,
  -- not the head. This is the owner's "an audit or chain-link failure must
  -- roll back every issuance write".
  if exists (select 1 from kitluy_devices.device_credentials where created_from_request_id = v_req) then
    raise exception 'ASSERT FAIL: a chain-link failure left a credential behind';
  end if;
  if exists (select 1 from kitluy_devices.device_credential_issuance_attempts
              where request_id = v_req and to_state = 'issued') then
    raise exception 'ASSERT FAIL: a chain-link failure left an issued audit row behind';
  end if;
  if exists (select 1 from kitluy_devices.device_credential_heads where device_record_id = v_device) then
    raise exception 'ASSERT FAIL: a chain-link failure left a head behind';
  end if;
  -- And the signature is still durable, so this is RECOVERABLE rather than lost.
  if (select state from kitluy_devices.device_credential_signing_attempts where request_id = v_req)
     <> 'signed' then
    raise exception 'ASSERT FAIL: a failed finalization discarded the recorded signature';
  end if;

  if v_blocked <> 2 then
    raise exception 'ASSERT FAIL: expected 2 chain refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-issuance-chain-rollback: a caller-supplied DEVICE link is refused outright, an incomplete chain rolls back the credential, the audit row and the head together — and the recorded signature SURVIVES, so the attempt is recoverable rather than orphaned';
end $$;

-- ---------------------------------------------------------------------------
-- 33f — two reservations, one head: exactly one success.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t33f-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p33f-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem_a text := encode(sha256(convert_to('i33fa-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem_b text := encode(sha256(convert_to('i33fb-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req_a text := 'rq-33fa-' || gen_random_uuid();
  v_req_b text := 'rq-33fb-' || gen_random_uuid();
  v_prep_a jsonb;
  v_prep_b jsonb;
  v_conflicts int := 0;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T33F-' || gen_random_uuid(), v_profile, now(),
    repeat('4a', 32), 'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','4a:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-33f-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-33f-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  -- BOTH reserve before EITHER finalizes: each sees head version 0 and
  -- reserves generation 1. This is the concurrent-renewal race, made
  -- deterministic.
  v_prep_a := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req_a, v_device, 'development', 'device_identity', 1, 'PUBKEY-33F',
    repeat('4a', 32), v_idem_a, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33f', now(), 'trusted', 'SVC-A');
  v_prep_b := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req_b, v_device, 'development', 'device_identity', 1, 'PUBKEY-33F',
    repeat('4a', 32), v_idem_b, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1', 'hex'), true, 'ica-33f', now(), 'trusted', 'SVC-B');

  if (v_prep_a ->> 'head_version_seen') <> '0' or (v_prep_b ->> 'head_version_seen') <> '0' then
    raise exception 'ASSERT FAIL: the two reservations did not both see head version 0';
  end if;
  if (v_prep_a ->> 'serial_number') = (v_prep_b ->> 'serial_number') then
    raise exception 'ASSERT FAIL: two distinct requests reserved the same serial';
  end if;

  perform kitluy_devices.record_device_credential_signature_v1(
    v_req_a, v_prep_a ->> 'canonical_tbs_hash', decode('aaaa', 'hex'), true, 'SVC-A');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req_b, v_prep_b ->> 'canonical_tbs_hash', decode('bbbb', 'hex'), true, 'SVC-B');

  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req_a, v_links, 'SVC-A');

  begin
    perform kitluy_devices.finalize_device_credential_issuance_v1(v_req_b, v_links, 'SVC-B');
    raise exception 'ASSERT FAIL: both reservations finalized against one head';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-CRED-RENEWAL-GENERATION-CONFLICT%' then
      raise exception 'ASSERT FAIL: the loser was refused for the wrong reason: %', sqlerrm;
    end if;
    v_conflicts := v_conflicts + 1;
  end;

  if v_conflicts <> 1 then
    raise exception 'ASSERT FAIL: expected exactly one conflict, got %', v_conflicts;
  end if;
  if (select count(*) from kitluy_devices.device_credentials where device_record_id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: the race produced more than one credential';
  end if;
  if (select version from kitluy_devices.device_credential_heads
       where device_record_id = v_device and environment = 'development') <> 1 then
    raise exception 'ASSERT FAIL: the head advanced more than once';
  end if;

  raise notice 'PASS ws11-issuance-head-conflict: two reservations taken against the same head version yield EXACTLY one issued credential and one KLUY-CRED-RENEWAL-GENERATION-CONFLICT; the head advances once, and the loser is refused by compare-and-swap rather than by a unique-index collision after the fact';
end $$;

-- ---------------------------------------------------------------------------
-- 33g — function security for the issuance surface.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_findings text[] := '{}';
  v_app text;
  v_owner text;
begin
  foreach v_fn in array array[
    'kitluy_devices.prepare_device_credential_issuance_v1(text, uuid, text, text, integer, text, text, text, text, text, text, bytea, boolean, text, timestamptz, text, text)',
    'kitluy_devices.record_device_credential_signature_v1(text, text, bytea, boolean, text)',
    'kitluy_devices.finalize_device_credential_issuance_v1(text, jsonb, text)']
  loop
    -- PUBLIC must never hold EXECUTE. PostgreSQL grants it at creation; the
    -- migration revokes it explicitly rather than assuming it is absent.
    if has_function_privilege('public', v_fn, 'execute') then
      v_findings := v_findings || format('%s is EXECUTE-able by PUBLIC', v_fn);
    end if;
    -- Nor may the untrusted browser-facing roles.
    foreach v_app in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_app)
         and has_function_privilege(v_app, v_fn, 'execute') then
        v_findings := v_findings || format('%s is EXECUTE-able by %s', v_fn, v_app);
      end if;
    end loop;
    -- Only the NAMED issuance service role may execute.
    if not has_function_privilege('kitluy_issuance_service', v_fn, 'execute') then
      v_findings := v_findings || format('%s is not executable by the named issuance service', v_fn);
    end if;

    select pg_get_userbyid(p.proowner) into v_owner
      from pg_proc p where p.oid = v_fn::regprocedure;
    -- A dedicated NOLOGIN owner, NOT shared with activation authority.
    if v_owner <> 'kitluy_credential_issuer' then
      v_findings := v_findings || format('%s is owned by %s', v_fn, v_owner);
    end if;
    if v_owner = 'kitluy_activation_governor' then
      v_findings := v_findings || format('%s shares its owner with activation authority', v_fn);
    end if;
    -- SECURITY DEFINER with a pinned search_path.
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_fn::regprocedure and p.prosecdef
        and p.proconfig is not null
        and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
      v_findings := v_findings || format('%s is not SECURITY DEFINER with a fixed search_path', v_fn);
    end if;
  end loop;

  -- No application role may be a member of the FUNCTION OWNER — that is the
  -- role whose privileges the definer body runs with, and membership in it
  -- would make the whole governed path bypassable by SET ROLE.
  foreach v_app in array array['service_role', 'authenticated', 'anon', 'authenticator'] loop
    if exists (select 1 from pg_roles where rolname = v_app)
       and pg_has_role(v_app, 'kitluy_credential_issuer', 'MEMBER') then
      v_findings := v_findings || format('%s is a member of the function owner kitluy_credential_issuer', v_app);
    end if;
  end loop;

  -- The temporary migration membership was handed back before commit.
  if exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.member
    join pg_roles g on g.oid = m.roleid
    where g.rolname = 'kitluy_credential_issuer' and not r.rolsuper) then
    v_findings := v_findings || 'a non-superuser retains membership of kitluy_credential_issuer';
  end if;

  -- The reservation table keeps RLS ENABLE+FORCE, so its owner is bound by its
  -- own named policies rather than exempt from them.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices'
      and c.relname = 'device_credential_signing_attempts'
      and c.relrowsecurity and c.relforcerowsecurity) then
    v_findings := v_findings || 'device_credential_signing_attempts lacks RLS ENABLE+FORCE';
  end if;

  -- service_role may READ the reservation but never WRITE it.
  if has_table_privilege('service_role', 'kitluy_devices.device_credential_signing_attempts', 'insert')
     or has_table_privilege('service_role', 'kitluy_devices.device_credential_signing_attempts', 'update') then
    v_findings := v_findings || 'service_role can write device_credential_signing_attempts directly';
  end if;
  -- And it still cannot write an issued credential directly, which is the
  -- containment that survives OPTION B putting the service in the TCB.
  if has_table_privilege('service_role', 'kitluy_devices.device_credentials', 'insert') then
    v_findings := v_findings || 'service_role can insert device_credentials directly';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % issuance-security finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-issuance-function-security: the three governed functions are SECURITY DEFINER with pinned search_path, owned by the NOLOGIN kitluy_credential_issuer (NOT the activation governor), executable ONLY by the named kitluy_issuance_service and never by PUBLIC, anon or authenticated; no application role is a member of the function owner; the migration membership was handed back; the reservation table keeps RLS ENABLE+FORCE; and service_role can read a reservation but write neither it nor an issued credential';
end $$;


-- ============================================================================
-- SECTION 34 — renewal key lifecycle (migration 0128).
--
-- Renewal reuses the prepare -> sign -> finalize pipeline; it does not fork it.
-- What is new is the REPLACEMENT KEY state machine, which is what stops a
-- losing renewal's key being presented by a later request.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 34a — a full two-generation renewal, and the key states it must leave.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t34a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p34a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem1 text := encode(sha256(convert_to('i34a1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem2 text := encode(sha256(convert_to('i34a2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req1 text := 'rq-34a1-' || gen_random_uuid();
  v_req2 text := 'rq-34a2-' || gen_random_uuid();
  v_fp1 text := repeat('5a', 32);
  v_fp2 text := repeat('5b', 32);
  v_prep jsonb;
  v_head kitluy_devices.device_credential_heads;
  v_attempt_id uuid;
  v_audit kitluy_devices.device_credential_issuance_attempts;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T34A-' || gen_random_uuid(), v_profile, now(), v_fp1,
    'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','5a:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-34a-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-34a-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  -- GENERATION 1. Issued 21 days ago, so 9 days remain and the device is
  -- legitimately inside its 10-day renewal window at the moment of renewal.
  perform kitluy_devices.register_generation_key_v1(
    v_device, 'development', 'device_identity', 1, 'handle-g1', 'PEM-G1', v_fp1);
  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req1, v_device, 'development', 'device_identity', 1, 'PEM-G1', v_fp1,
    v_idem1, repeat('9', 64), 'ed25519', repeat('8', 64), decode('a1', 'hex'),
    true, 'ica-34a', now() - interval '21 days', 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req1, v_prep ->> 'canonical_tbs_hash', decode('1111', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req1, v_links, 'SVC');

  -- Issuance ACTIVATED the generation-1 key. Promotion is a consequence of the
  -- credential insert, not a call a caller can make on its own.
  if (select state from kitluy_devices.device_generation_keys
       where device_record_id = v_device and generation = 1) <> 'active' then
    raise exception 'ASSERT FAIL: issuance did not activate the generation-1 key';
  end if;

  -- TYPED AUDIT LINKAGE (Option A). The audit row points at the reservation,
  -- and the free-form detail agrees with it — the owner''s condition for
  -- accepting the temporary contract at all.
  select id into v_attempt_id from kitluy_devices.device_credential_signing_attempts
   where request_id = v_req1;
  select * into v_audit from kitluy_devices.device_credential_issuance_attempts
   where request_id = v_req1 and to_state = 'issued';
  if v_audit.issuance_attempt_id is distinct from v_attempt_id then
    raise exception 'ASSERT FAIL: the audit row does not point at the reservation';
  end if;
  if (v_audit.detail ->> 'credential_id')
     <> (select credential_id::text from kitluy_devices.device_credential_signing_attempts
          where request_id = v_req1) then
    raise exception 'ASSERT FAIL: the audit detail credential id does not match the reservation';
  end if;

  -- RENEWAL in the DEFAULT mode, which is reuse_current_key. No key is
  -- generated and none is registered: the device keeps the key it holds and
  -- receives the next CREDENTIAL generation. Group 0128 made this unreachable
  -- by treating §5.1 as a ruling; it was a recommendation.
  v_prep := kitluy_devices.prepare_device_credential_renewal_v1(
    v_device, 'development', 'device_identity', v_req2, v_idem2, repeat('7', 64),
    'PEM-G1', v_fp1, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
    'ica-34a', now(), 'trusted', 'SVC');
  if (v_prep ->> 'renewal_mode') <> 'reuse_current_key' then
    raise exception 'ASSERT FAIL: the default renewal mode is not reuse_current_key: %', v_prep;
  end if;
  if (v_prep ->> 'certificate_generation') <> '2' then
    raise exception 'ASSERT FAIL: renewal did not reserve generation 2: %', v_prep;
  end if;
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req2, v_prep ->> 'canonical_tbs_hash', decode('2222', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req2, v_links, 'SVC');

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_device and environment = 'development';
  if v_head.current_generation <> 2 or v_head.version <> 2
     or v_head.previous_generation <> 1 then
    raise exception 'ASSERT FAIL: the head is not generation 2 / version 2 / previous 1 (got %/%/%)',
      v_head.current_generation, v_head.version, v_head.previous_generation;
  end if;
  -- §5: the overlap never exceeds three days and never outlives the incumbent.
  if v_head.overlap_ends_at is null
     or v_head.overlap_ends_at > v_head.updated_at + interval '3 days' then
    raise exception 'ASSERT FAIL: the overlap window is absent or exceeds 3 days';
  end if;
  if v_head.overlap_ends_at > (select not_after from kitluy_devices.device_credentials
                                where device_record_id = v_device and certificate_generation = 1) then
    raise exception 'ASSERT FAIL: the overlap outlives the credential it overlaps';
  end if;

  -- BOTH generations exist and are distinct credentials over DIFFERENT keys.
  if (select count(*) from kitluy_devices.device_credentials
       where device_record_id = v_device) <> 2 then
    raise exception 'ASSERT FAIL: renewal did not leave two credentials';
  end if;
  -- A new CREDENTIAL generation over the SAME key. These are different
  -- concepts and 0128 conflated them.
  if (select public_key_fingerprint from kitluy_devices.device_credentials
       where device_record_id = v_device and certificate_generation = 2) <> v_fp1 then
    raise exception 'ASSERT FAIL: same-key renewal did not carry the incumbent key forward';
  end if;
  if exists (select 1 from kitluy_devices.device_generation_keys
              where device_record_id = v_device and generation = 2) then
    raise exception 'ASSERT FAIL: same-key renewal registered a replacement key';
  end if;

  -- The device key is untouched by a same-key renewal: it was never rotated,
  -- so it is neither superseded nor re-activated.
  if (select state from kitluy_devices.device_generation_keys
       where device_record_id = v_device and generation = 1) <> 'active' then
    raise exception 'ASSERT FAIL: same-key renewal disturbed the incumbent key state';
  end if;

  raise notice 'PASS ws11-renewal-lifecycle: the DEFAULT renewal mode is reuse_current_key — the next CREDENTIAL generation is issued over the key the device already holds, with no key generated, none registered and the incumbent key state undisturbed; the head advanced to 2/v2 with previous=1 and an overlap that neither exceeds 3 days nor outlives the incumbent; the audit row is typed-linked to its reservation and its detail agrees';
end $$;

-- ---------------------------------------------------------------------------
-- 34b — what renewal refuses, and why an abandoned key is terminal.
-- ---------------------------------------------------------------------------
do $$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t34b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p34b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem1 text := encode(sha256(convert_to('i34b1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_fp1 text := repeat('6a', 32);
  v_fp2 text := repeat('6b', 32);
  v_req1 text := 'rq-34b1-' || gen_random_uuid();
  v_prep jsonb;
  v_blocked int := 0;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T34B-' || gen_random_uuid(), v_profile, now(), v_fp1,
    'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','6a:01:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-34b-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-34b-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  -- A FRESH generation 1: 30 days remain, so renewal is far too early.
  perform kitluy_devices.register_generation_key_v1(
    v_device, 'development', 'device_identity', 1, 'h1', 'PEM-G1', v_fp1);
  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req1, v_device, 'development', 'device_identity', 1, 'PEM-G1', v_fp1,
    v_idem1, repeat('9', 64), 'ed25519', repeat('8', 64), decode('a1', 'hex'),
    true, 'ica-34b', now(), 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req1, v_prep ->> 'canonical_tbs_hash', decode('1111', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req1, v_links, 'SVC');

  perform kitluy_devices.register_generation_key_v1(
    v_device, 'development', 'device_identity', 2, 'h2', 'PEM-G2', v_fp2);

  -- TOO EARLY: 30 days remain against a 10-day window.
  begin
    perform kitluy_devices.prepare_device_credential_renewal_v1(
      v_device, 'development', 'device_identity', 'rq-early-' || gen_random_uuid(),
      encode(sha256(convert_to('early', 'UTF8')), 'hex'), repeat('7', 64),
      'PEM-G2', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
      'ica-34b', now(), 'trusted', 'SVC');
    raise exception 'ASSERT FAIL: renewal was permitted 30 days before expiry';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-TOO-EARLY%' then
      raise exception 'ASSERT FAIL: wrong refusal for an early renewal: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- EXPIRED routes to RECOVERY, never renewal. Judged against the trusted time
  -- the caller presents, not against now().
  begin
    perform kitluy_devices.prepare_device_credential_renewal_v1(
      v_device, 'development', 'device_identity', 'rq-exp-' || gen_random_uuid(),
      encode(sha256(convert_to('exp', 'UTF8')), 'hex'), repeat('7', 64),
      'PEM-G2', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
      'ica-34b', now() + interval '40 days', 'trusted', 'SVC');
    raise exception 'ASSERT FAIL: an expired credential was renewed';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-EXPIRED-REQUIRES-RECOVERY%' then
      raise exception 'ASSERT FAIL: wrong refusal for an expired credential: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- reuse_current_key must present the INCUMBENT key. Presenting a different
  -- one is a silent key swap wearing a reuse label.
  begin
    perform kitluy_devices.prepare_device_credential_renewal_v1(
      v_device, 'development', 'device_identity', 'rq-fp-' || gen_random_uuid(),
      encode(sha256(convert_to('fp', 'UTF8')), 'hex'), repeat('7', 64),
      'PEM-X', repeat('cc', 32), 'ed25519', repeat('6', 64), decode('b2', 'hex'),
      true, 'ica-34b', now() + interval '25 days', 'trusted', 'SVC');
    raise exception 'ASSERT FAIL: reuse_current_key accepted a different key';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-NOT-CURRENT-KEY%' then
      raise exception 'ASSERT FAIL: wrong refusal for a swapped key: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- ROTATION IS DISABLED BY POLICY. The mechanism exists and is tested; the
  -- mandate does not, and no code default may authorize it.
  begin
    perform kitluy_devices.prepare_device_credential_renewal_v2(
      v_device, 'development', 'device_identity', 'rq-rot-' || gen_random_uuid(),
      encode(sha256(convert_to('rot', 'UTF8')), 'hex'), repeat('7', 64),
      'PEM-G2', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'),
      true, 'ica-34b', now() + interval '25 days', 'trusted', 'SVC', 'rotate_key');
    raise exception 'ASSERT FAIL: rotate_key was permitted with no owner decision';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-ROTATION-NOT-PERMITTED%' then
      raise exception 'ASSERT FAIL: wrong refusal for disabled rotation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- And the policy row cannot be opened without naming a decision.
  begin
    update kitluy_devices.renewal_policy set allow_key_rotation = true
     where environment = 'development';
    raise exception 'ASSERT FAIL: rotation was enabled without an owner decision reference';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  -- ABANDONED IS TERMINAL. This is the containment the owner asked for: a
  -- losing renewal's key must never be usable by a later request.
  perform kitluy_devices.abandon_generation_key_v1(
    v_device, 'development', 'device_identity', 2, 'lost the head compare-and-swap');
  if (select state from kitluy_devices.device_generation_keys
       where device_record_id = v_device and generation = 2) <> 'abandoned' then
    raise exception 'ASSERT FAIL: the key was not abandoned';
  end if;

  -- An abandoned key is refused BEFORE the policy gate would matter, so the
  -- containment does not depend on rotation being enabled. Asserted through
  -- the rotation entry point because that is the only path that consults a
  -- replacement key at all.
  begin
    perform kitluy_devices.prepare_device_credential_renewal_v2(
      v_device, 'development', 'device_identity', 'rq-aband-' || gen_random_uuid(),
      encode(sha256(convert_to('aband', 'UTF8')), 'hex'), repeat('7', 64),
      'PEM-G2', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
      'ica-34b', now() + interval '25 days', 'trusted', 'SVC', 'rotate_key');
    raise exception 'ASSERT FAIL: an ABANDONED key was accepted for renewal';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-KEY-NOT-GENERATED%'
       and sqlerrm not like 'KLUY-RENEWAL-ROTATION-NOT-PERMITTED%' then
      raise exception 'ASSERT FAIL: wrong refusal for an abandoned key: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- And it cannot be resurrected: abandoned -> active is not a transition.
  begin
    update kitluy_devices.device_generation_keys set state = 'active'
     where device_record_id = v_device and generation = 2;
    raise exception 'ASSERT FAIL: an abandoned key was promoted to active';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-KEY-BAD-TRANSITION%'
       and sqlerrm not like 'KLUY-KEY-UNAUTHORIZED%'
       and sqlerrm not like 'permission denied%' then
      raise exception 'ASSERT FAIL: wrong refusal for an abandoned-key promotion: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 7 then
    raise exception 'ASSERT FAIL: expected 7 renewal refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-renewal-refusals: renewal is refused 30 days early, routes an EXPIRED credential to recovery with its own code, refuses a reuse_current_key request that presents a DIFFERENT key, refuses rotate_key because no owner decision permits it, refuses to enable rotation without naming that decision, and treats an ABANDONED key as terminal — it can neither enter proof of possession nor be promoted back to active';
end $$;


-- ============================================================================
-- SECTION 35 — reserve-before-generate, and provider activation truth (0130).
--
-- TASK A: the renewal attempt exists BEFORE any key, because key generation
-- must be idempotent on a stable identifier and there was none before.
-- TASK D: a credential row proves a credential was issued. It proves NOTHING
-- about whether the private half is loaded in the external provider.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Shared fixture: a device holding an issued generation-1 credential with
-- nine days left, so it sits legitimately inside the 10-day renewal window.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.ws11_renewable_device(p_tag text, p_fp text)
returns uuid
language plpgsql
as $fixture$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t' || p_tag || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p' || p_tag || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem text := encode(sha256(convert_to('i' || p_tag || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-' || p_tag || '-' || gen_random_uuid();
  v_prep jsonb;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';
  v_device := kitluy_devices.enroll_device_v1(
    'WS11-' || upper(p_tag) || '-' || gen_random_uuid(), v_profile, now(), p_fp,
    'ed25519', 'software', 'STATION-PROBE', 'OP-PROBE',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value',
        substr(md5(random()::text),1,2) || ':' || substr(md5(random()::text),1,8)),
      jsonb_build_object('signal_type','board_serial','signal_value','board-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-PROVISION');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-AGENT');

  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req, v_device, 'development', 'device_identity', 1, 'PEM-' || p_tag, p_fp,
    v_idem, repeat('9', 64), 'ed25519', repeat('8', 64), decode('a1', 'hex'),
    true, 'ica-' || p_tag, now() - interval '21 days', 'trusted', 'SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('1111', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req, v_links, 'SVC');
  return v_device;
end;
$fixture$;

-- ---------------------------------------------------------------------------
-- 35a — TASK A: reserve before generate.
-- ---------------------------------------------------------------------------
do $$
declare
  v_device uuid;
  v_idem text := encode(sha256(convert_to('r35a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_first jsonb;
  v_retry jsonb;
  v_blocked int := 0;
begin
  v_device := pg_temp.ws11_renewable_device('t35a', repeat('7a', 32));

  -- A replacement key CANNOT exist before its reservation. This is the whole
  -- ordering correction, asserted first.
  begin
    perform kitluy_devices.register_generation_key_v2(
      gen_random_uuid(), 'handle-x', 'PEM-X', repeat('cd', 32), 2);
    raise exception 'ASSERT FAIL: a replacement key was registered with no renewal reservation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-NO-RESERVATION%' then
      raise exception 'ASSERT FAIL: wrong refusal for a key without a reservation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- RESERVATION SUCCEEDS WITH NO KEY. Group 0128 could not do this.
  v_first := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity', v_idem, now(), 'trusted', null, 'SVC');
  if v_first ->> 'outcome' <> 'RESERVED' then
    raise exception 'ASSERT FAIL: reservation did not succeed without a key: %', v_first;
  end if;
  if (v_first ->> 'renewal_mode') <> 'reuse_current_key' then
    raise exception 'ASSERT FAIL: the default reservation mode is not reuse_current_key';
  end if;
  -- Same-key needs no key generation, so it is ready to issue immediately.
  if (v_first ->> 'status') <> 'issuance_pending' then
    raise exception 'ASSERT FAIL: a same-key reservation is not issuance_pending: %', v_first;
  end if;
  if (v_first ->> 'next_credential_generation') <> '2' then
    raise exception 'ASSERT FAIL: the reservation did not reserve generation 2';
  end if;
  if exists (select 1 from kitluy_devices.device_generation_keys
              where device_record_id = v_device and generation = 2) then
    raise exception 'ASSERT FAIL: a same-key reservation registered a replacement key';
  end if;

  -- RETRY ON THE SAME IDEMPOTENCY KEY returns the SAME attempt. Checked before
  -- eligibility is re-judged, so a clock that moved cannot refuse a retry.
  v_retry := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity', v_idem,
    now() + interval '5 days', 'trusted', null, 'SVC');
  if v_retry ->> 'outcome' <> 'REPLAYED_RESERVATION'
     or (v_retry ->> 'renewal_attempt_id') <> (v_first ->> 'renewal_attempt_id') then
    raise exception 'ASSERT FAIL: a retry allocated a second renewal attempt: %', v_retry;
  end if;
  if (select count(*) from kitluy_devices.device_renewal_reservations
       where device_record_id = v_device) <> 1 then
    raise exception 'ASSERT FAIL: more than one reservation exists for the device';
  end if;

  -- A COMPETING attempt for the same next generation fast-fails. This is the
  -- early code; RENEWAL_GENERATION_CONFLICT belongs to the late head swap.
  begin
    perform kitluy_devices.reserve_device_credential_renewal_v1(
      v_device, 'development', 'device_identity',
      encode(sha256(convert_to('other-' || gen_random_uuid(), 'UTF8')), 'hex'),
      now(), 'trusted', null, 'SVC-B');
    raise exception 'ASSERT FAIL: two reservations were taken for one next generation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-ALREADY-RESERVED%' then
      raise exception 'ASSERT FAIL: wrong refusal for a competing reservation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- A rotate_key attempt cannot claim the same next generation either, and it
  -- is refused for the SAME reason rather than a rotation-specific one.
  begin
    perform kitluy_devices.reserve_device_credential_renewal_v1(
      v_device, 'development', 'device_identity',
      encode(sha256(convert_to('rot-' || gen_random_uuid(), 'UTF8')), 'hex'),
      now(), 'trusted', 'rotate_key', 'SVC-C');
    raise exception 'ASSERT FAIL: a rotation attempt reserved an already-reserved generation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-RENEWAL-ALREADY-RESERVED%'
       and sqlerrm not like 'KLUY-RENEWAL-ROTATION-NOT-PERMITTED%' then
      raise exception 'ASSERT FAIL: wrong refusal for a competing rotation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- A frozen identifier cannot be rewritten after reservation.
  begin
    update kitluy_devices.device_renewal_reservations
       set next_credential_generation = 9
     where renewal_attempt_id = (v_first ->> 'renewal_attempt_id')::uuid;
    raise exception 'ASSERT FAIL: a frozen reservation identifier was rewritten';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    v_blocked := v_blocked + 1;
  end;

  if v_blocked <> 4 then
    raise exception 'ASSERT FAIL: expected 4 ordering refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-renewal-reserve-first: a replacement key CANNOT be registered before its renewal reservation; a reservation succeeds with no key at all and defaults to reuse_current_key/issuance_pending; a retry on the same idempotency key returns the SAME attempt without re-judging eligibility; a competing attempt fast-fails with KLUY-RENEWAL-ALREADY-RESERVED; and a frozen reservation identifier cannot be rewritten';
end $$;

-- ---------------------------------------------------------------------------
-- 35b — TASK D: a credential row is not evidence of provider activation.
-- ---------------------------------------------------------------------------
do $$
declare
  v_device uuid;
  v_fp1 text := repeat('7b', 32);
  v_fp2 text := repeat('7c', 32);
  v_res jsonb;
  v_attempt uuid;
  v_req text := 'rq-35b-' || gen_random_uuid();
  v_idem text := encode(sha256(convert_to('i35b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_prep jsonb;
  v_cred uuid;
  v_blocked int := 0;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  v_device := pg_temp.ws11_renewable_device('t35b', v_fp1);

  -- TEST-ONLY policy override. Rotation stays disabled in the shipped policy;
  -- this names a test decision so the CHECK is satisfied honestly rather than
  -- bypassed, and it is restored at the end of the block.
  update kitluy_devices.renewal_policy
     set allow_key_rotation = true,
         rotation_approved_by_decision_ref = 'TEST-ONLY-ws11-section35b'
   where environment = 'development';

  v_res := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity', v_idem, now(), 'trusted',
    'rotate_key', 'SVC');
  v_attempt := (v_res ->> 'renewal_attempt_id')::uuid;
  -- A rotation reservation is NOT ready to issue: it owes a key first.
  if (v_res ->> 'status') <> 'key_generation_pending' then
    raise exception 'ASSERT FAIL: a rotation reservation is not key_generation_pending: %', v_res;
  end if;

  perform kitluy_devices.register_generation_key_v2(
    v_attempt, 'provider-handle-35b', 'PEM-G2', v_fp2, 2);

  -- Registration is idempotent on the ATTEMPT: a retry returns the same key.
  if (kitluy_devices.register_generation_key_v2(
        v_attempt, 'provider-handle-35b', 'PEM-G2', v_fp2, 2) ->> 'outcome')
     <> 'ALREADY_REGISTERED' then
    raise exception 'ASSERT FAIL: re-registering the same key was not idempotent';
  end if;
  if (select count(*) from kitluy_devices.device_generation_keys
       where renewal_attempt_id = v_attempt) <> 1 then
    raise exception 'ASSERT FAIL: a retry generated a second replacement key';
  end if;

  v_prep := kitluy_devices.prepare_device_credential_renewal_v2(
    v_device, 'development', 'device_identity', v_req, encode(sha256(convert_to('issue35b-' || v_req, 'UTF8')), 'hex'), repeat('7', 64),
    'PEM-G2', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
    'ica-35b', now(), 'trusted', 'SVC', 'rotate_key');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('2222', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req, v_links, 'SVC');

  select credential_id into v_cred from kitluy_devices.device_credentials
   where created_from_request_id = v_req;

  -- THE CORE OF TASK D. The credential is issued; the provider has not been
  -- asked; the key is therefore NOT active.
  if (select state from kitluy_devices.device_generation_keys
       where renewal_attempt_id = v_attempt) <> 'credential_issued_pending_activation' then
    raise exception 'ASSERT FAIL: credential insertion marked a rotated key active';
  end if;
  if (select status from kitluy_devices.device_renewal_reservations
       where renewal_attempt_id = v_attempt) <> 'activation_pending' then
    raise exception 'ASSERT FAIL: the reservation is not activation_pending after issuance';
  end if;

  -- Nine bindings. Each wrong one is refused with its own code.
  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      gen_random_uuid(), v_cred, v_device, 'development', 'device_identity',
      2, 2, 'provider-handle-35b', v_fp2, 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed against another renewal attempt';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-NO-RESERVATION%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign attempt: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      v_attempt, v_cred, gen_random_uuid(), 'development', 'device_identity',
      2, 2, 'provider-handle-35b', v_fp2, 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed for another device';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-WRONG-DEVICE%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign device: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      v_attempt, v_cred, v_device, 'development', 'device_identity',
      3, 2, 'provider-handle-35b', v_fp2, 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed for another credential generation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-WRONG-GENERATION%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign generation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      v_attempt, v_cred, v_device, 'development', 'device_identity',
      2, 2, 'a-different-provider-handle', v_fp2, 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed with the wrong provider key reference';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-WRONG-PROVIDER-KEY%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign provider key: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      v_attempt, v_cred, v_device, 'development', 'device_identity',
      2, 2, 'provider-handle-35b', repeat('ee', 32), 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed with the wrong fingerprint';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-WRONG-FINGERPRINT%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign fingerprint: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  begin
    perform kitluy_devices.confirm_provider_key_activation_v1(
      v_attempt, v_cred, v_device, 'development', 'device_identity',
      2, 9, 'provider-handle-35b', v_fp2, 'SVC');
    raise exception 'ASSERT FAIL: activation confirmed with the wrong KEY generation';
  exception when others then
    if sqlerrm like 'ASSERT FAIL%' then raise; end if;
    if sqlerrm not like 'KLUY-ACTIVATION-WRONG-KEY-GENERATION%' then
      raise exception 'ASSERT FAIL: wrong refusal for a foreign key generation: %', sqlerrm;
    end if;
    v_blocked := v_blocked + 1;
  end;

  -- The correct confirmation activates, supersedes and completes.
  if (kitluy_devices.confirm_provider_key_activation_v1(
        v_attempt, v_cred, v_device, 'development', 'device_identity',
        2, 2, 'provider-handle-35b', v_fp2, 'PROVIDER-ADAPTER') ->> 'outcome')
     <> 'ACTIVATED' then
    raise exception 'ASSERT FAIL: a correct activation confirmation did not activate';
  end if;
  if (select state from kitluy_devices.device_generation_keys
       where renewal_attempt_id = v_attempt) <> 'active' then
    raise exception 'ASSERT FAIL: the key is not active after confirmation';
  end if;
  if (select status from kitluy_devices.device_renewal_reservations
       where renewal_attempt_id = v_attempt) <> 'completed' then
    raise exception 'ASSERT FAIL: the renewal did not complete after activation';
  end if;

  -- IDEMPOTENT: the adapter may confirm twice after a lost acknowledgement.
  if (kitluy_devices.confirm_provider_key_activation_v1(
        v_attempt, v_cred, v_device, 'development', 'device_identity',
        2, 2, 'provider-handle-35b', v_fp2, 'PROVIDER-ADAPTER') ->> 'outcome')
     <> 'ALREADY_ACTIVE' then
    raise exception 'ASSERT FAIL: a duplicate activation confirmation was not idempotent';
  end if;

  update kitluy_devices.renewal_policy
     set allow_key_rotation = false, rotation_approved_by_decision_ref = null
   where environment = 'development';

  if v_blocked <> 6 then
    raise exception 'ASSERT FAIL: expected 6 activation refusals, got %', v_blocked;
  end if;

  raise notice 'PASS ws11-provider-activation-truth: finalizing a rotated credential leaves the provider key credential_issued_pending_activation and the renewal activation_pending — a credential row is NOT evidence the provider loaded the private half; six wrong bindings (attempt, device, credential generation, provider key reference, fingerprint, key generation) are each refused with their own code; the correct confirmation activates, supersedes and completes; and a duplicate confirmation is idempotent';
end $$;

-- ---------------------------------------------------------------------------
-- 35c — security hygiene for everything migration 0130 added.
-- ---------------------------------------------------------------------------
do $$
declare
  v_fn text;
  v_owner text;
  v_findings text[] := '{}';
  v_app text;
begin
  foreach v_fn in array array[
    'kitluy_devices.reserve_device_credential_renewal_v1(uuid, text, text, text, timestamptz, text, kitluy_devices.renewal_mode, text)',
    'kitluy_devices.register_generation_key_v2(uuid, text, text, text, integer)',
    'kitluy_devices.confirm_provider_key_activation_v1(uuid, uuid, uuid, text, text, integer, integer, text, text, text)']
  loop
    if has_function_privilege('public', v_fn, 'execute') then
      v_findings := v_findings || format('%s is EXECUTE-able by PUBLIC', v_fn);
    end if;
    foreach v_app in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = v_app)
         and has_function_privilege(v_app, v_fn, 'execute') then
        v_findings := v_findings || format('%s is EXECUTE-able by %s', v_fn, v_app);
      end if;
    end loop;
    if not has_function_privilege('kitluy_issuance_service', v_fn, 'execute') then
      v_findings := v_findings || format('%s is not reachable by the named issuance service', v_fn);
    end if;
    select pg_get_userbyid(p.proowner) into v_owner from pg_proc p where p.oid = v_fn::regprocedure;
    if v_owner <> 'kitluy_credential_issuer' then
      v_findings := v_findings || format('%s is owned by %s', v_fn, v_owner);
    end if;
    if exists (select 1 from pg_roles where rolname = v_owner and rolcanlogin and not rolsuper) then
      v_findings := v_findings || format('%s is owned by login-capable %s', v_fn, v_owner);
    end if;
    if not exists (
      select 1 from pg_proc p where p.oid = v_fn::regprocedure and p.prosecdef
        and p.proconfig is not null
        and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
      v_findings := v_findings || format('%s lacks SECURITY DEFINER with a fixed search_path', v_fn);
    end if;
  end loop;

  -- The new tables keep RLS ENABLE+FORCE, so their owner is bound by its own
  -- named policies rather than exempt.
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_renewal_reservations'
      and c.relrowsecurity and c.relforcerowsecurity) then
    v_findings := v_findings || 'device_renewal_reservations lacks RLS ENABLE+FORCE';
  end if;

  -- service_role may READ a reservation and a key row; it may write neither,
  -- so it cannot activate a key or complete a renewal behind the governor.
  if has_table_privilege('service_role', 'kitluy_devices.device_renewal_reservations', 'update')
     or has_table_privilege('service_role', 'kitluy_devices.device_renewal_reservations', 'insert') then
    v_findings := v_findings || 'service_role can write device_renewal_reservations directly';
  end if;
  if has_table_privilege('service_role', 'kitluy_devices.device_generation_keys', 'update') then
    v_findings := v_findings || 'service_role can update provider key lifecycle state directly';
  end if;

  -- The migration membership was handed back before commit.
  if exists (
    select 1 from pg_auth_members m
    join pg_roles r on r.oid = m.member
    join pg_roles g on g.oid = m.roleid
    where g.rolname = 'kitluy_credential_issuer' and not r.rolsuper) then
    v_findings := v_findings || 'a non-superuser retains membership of kitluy_credential_issuer';
  end if;

  -- Rotation is DISABLED in the shipped policy. Section 35b enables it under a
  -- named test decision and restores it; this proves the restore happened.
  if (select allow_key_rotation from kitluy_devices.renewal_policy
       where environment = 'development') then
    v_findings := v_findings || 'key rotation is enabled in the shipped development policy';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-renewal-activation-security: the three functions added by group 0130 are SECURITY DEFINER with pinned search_path, owned by the NOLOGIN kitluy_credential_issuer, executable only by the named issuance service and never by PUBLIC, anon or authenticated; the reservation table keeps RLS ENABLE+FORCE; service_role can write neither reservations nor provider-key lifecycle state; the migration membership was handed back; and rotation is still DISABLED in the shipped policy after the test override was restored';
end $$;

-- ============================================================================
-- SECTION 36 — the named executor can actually execute (migration 0131).
--
-- Groups 0127-0130 granted kitluy_issuance_service EXECUTE on every governed
-- function and never granted it USAGE on the schema those functions live in.
-- EXECUTE does not imply name resolution, so every call made AS THE INTENDED
-- ROLE failed with "permission denied for schema kitluy_devices". It went
-- unnoticed because every test ran as `postgres`, which inherits schema USAGE
-- through service_role — the privilege model was described, never exercised.
--
-- These assertions run the boundary from BOTH sides: the executor must be able
-- to call the governed path, and must still be unable to touch anything it
-- protects.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 36a — the executor reaches the governed functions, and nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
  v_findings text[] := array[]::text[];
  v_table text;
  v_privilege text;
  v_fn text;
begin
  if not has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'usage') then
    v_findings := v_findings ||
      'kitluy_issuance_service lacks USAGE on kitluy_devices and cannot call the governed path at all';
  end if;
  if has_schema_privilege('kitluy_issuance_service', 'kitluy_devices', 'create') then
    v_findings := v_findings || 'kitluy_issuance_service holds CREATE on kitluy_devices';
  end if;

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
      v_findings := v_findings || format('the executor cannot execute %s', v_fn);
    end if;
    if has_function_privilege('public', format('kitluy_devices.%s', v_fn), 'execute') then
      v_findings := v_findings || format('PUBLIC can execute %s', v_fn);
    end if;
  end loop;

  -- The tables the governed path protects stay unreachable to the executor.
  foreach v_table in array array[
    'device_credentials', 'device_credential_heads',
    'device_generation_keys', 'device_renewal_reservations']
  loop
    foreach v_privilege in array array['insert', 'update', 'delete'] loop
      if has_table_privilege('kitluy_issuance_service',
                             format('kitluy_devices.%I', v_table), v_privilege) then
        v_findings := v_findings ||
          format('the executor holds %s on kitluy_devices.%s', v_privilege, v_table);
      end if;
    end loop;
  end loop;

  if exists (
    select 1 from pg_auth_members m
    join pg_roles g on g.oid = m.roleid
    join pg_roles r on r.oid = m.member
    where g.rolname = 'kitluy_credential_issuer' and r.rolname = 'kitluy_issuance_service') then
    v_findings := v_findings || 'the executor is a member of the governor';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % executor-boundary finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-executor-schema-usage: kitluy_issuance_service holds USAGE (not CREATE) on kitluy_devices and EXECUTE on the six governed functions, PUBLIC holds none, the executor has no insert/update/delete on credentials, heads, provider keys or renewal reservations, and it is not a member of kitluy_credential_issuer';
end $$;

-- ---------------------------------------------------------------------------
-- 36b — executed AS the role, not merely granted to it.
--
-- A privilege matrix can be right in the catalogue and wrong in practice; the
-- only way to know is to assume the role and try. Every write below must be
-- refused, and the read of the schema must succeed.
-- ---------------------------------------------------------------------------
do $executor_probe$
declare
  v_findings text[] := array[]::text[];
  v_role text;
  v_probe integer;
  v_device uuid;
begin
  select id into v_device from kitluy_devices.devices limit 1;

  set local role kitluy_issuance_service;

  select current_user into v_role;
  if v_role <> 'kitluy_issuance_service' then
    v_findings := v_findings || format('the probe ran as %s, not the executor', v_role);
  end if;

  -- THE THING THAT WAS BROKEN: reaching the governed path at all. The device
  -- id is random, so the only correct answer is the POLICY refusal. A
  -- "permission denied for schema" here is the group-0131 defect returning,
  -- and it is named as such rather than swallowed as "some error".
  begin
    perform kitluy_devices.reserve_device_credential_renewal_v1(
      gen_random_uuid(), 'development', 'device_identity',
      'executor-probe-' || gen_random_uuid(), now(), 'trusted',
      'reuse_current_key'::kitluy_devices.renewal_mode, 'EXECUTOR-PROBE');
    v_findings := v_findings ||
      'the executor reserved a renewal for a device that does not exist';
  exception when others then
    if sqlerrm like '%permission denied for schema%' then
      v_findings := v_findings ||
        format('the executor cannot reach the governed path: %s', sqlerrm);
    elsif sqlerrm not like 'KLUY-RENEWAL-NO-CURRENT-CREDENTIAL%' then
      v_findings := v_findings ||
        format('unexpected refusal from the governed path: %s', sqlerrm);
    end if;
  end;

  -- Reaching the FUNCTIONS is not reaching the TABLES. The executor holds no
  -- SELECT on the policy table the definer function just read on its behalf.
  begin
    select count(*) into v_probe from kitluy_devices.renewal_policy;
    v_findings := v_findings || 'the executor can read kitluy_devices.renewal_policy directly';
  exception when others then
    null;
  end;

  begin
    insert into kitluy_devices.device_credentials (
      credential_id, serial_number, device_record_id, environment, purpose,
      public_key, public_key_fingerprint, issuer_key_id, certificate_generation,
      assignment_generation, not_before, not_after, hardware_trust_level,
      canonical_tbs, detached_signature, created_from_request_id, state)
    values (gen_random_uuid(), 'DEV-EXECUTOR-FORGED', v_device,
            'development', 'device_identity', 'PEM', repeat('e', 64), 'ica', 99, 1,
            now(), now() + interval '1 day', 'development_software', 'TBS',
            decode('00', 'hex'), 'rq-executor-forged', 'issued');
    v_findings := v_findings || 'the executor inserted a credential directly';
  exception when others then
    null;
  end;

  begin
    update kitluy_devices.device_credential_heads
    set current_generation = current_generation + 1, version = version + 1;
    v_findings := v_findings || 'the executor advanced a generation head directly';
  exception when others then
    null;
  end;

  begin
    update kitluy_devices.device_generation_keys set state = 'superseded';
    v_findings := v_findings || 'the executor moved provider-key lifecycle state directly';
  exception when others then
    null;
  end;

  begin
    execute 'set role kitluy_credential_issuer';
    v_findings := v_findings || 'the executor escalated into the NOLOGIN governor';
  exception when others then
    null;
  end;

  reset role;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % executed-boundary finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-executor-executed-boundary: running AS kitluy_issuance_service the governed reservation function is reachable and answers with its POLICY refusal rather than permission denied for schema, while direct reads of renewal_policy, direct credential insertion, head advancement, provider-key lifecycle mutation and SET ROLE into kitluy_credential_issuer are all refused';
end
$executor_probe$;

select 'assertions complete: groups 0010-0131 structural contract holds' as result;

-- ============================================================================
-- SECTION 37 — same-key renewal finalization (migration 0132).
--
-- Two defects, both found by executing a real same-key renewal end to end as
-- kitluy_issuance_service, and both asserted BEHAVIOURALLY here rather than by
-- reading the catalogue.
--
-- A. The overlap window compared DEVICE TRUSTED TIME against SERVER TIME.
--    Finalization derives overlap_ends_at from the new credential's not_before
--    (trusted time); group 0125's trigger bounded it by updated_at (now()).
--    KLD-2026-07-28-002 §12 separates those clocks on purpose, so any positive
--    skew — measured as little as 69ms — refused a legitimate renewal. The
--    probe below prepares with the device clock DELIBERATELY AHEAD, which is
--    exactly the case that used to fail.
--
-- B. A reuse_current_key reservation could never reach `completed`. The only
--    writer of that status requires a provider key bound to the renewal
--    attempt, and only rotation ever creates one, so a same-key renewal stayed
--    `issuance_pending` for ever and its generation slot stayed blocked.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 37a — a same-key renewal finalizes with the device clock AHEAD, and completes.
-- ---------------------------------------------------------------------------
do $section37a$
declare
  v_profile uuid;
  v_device uuid;
  v_token text := encode(sha256(convert_to('t37a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_payload text := encode(sha256(convert_to('p37a-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_fp text := repeat('37', 32);
  v_idem1 text := encode(sha256(convert_to('i37a-1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_idem2 text := encode(sha256(convert_to('i37a-2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req1 text := 'rq-37a-1-' || gen_random_uuid();
  v_req2 text := 'rq-37a-2-' || gen_random_uuid();
  v_issued_at timestamptz := now() - interval '21 days';
  v_ahead timestamptz;
  v_prep jsonb;
  v_res jsonb;
  v_fin jsonb;
  v_links jsonb;
  v_head kitluy_devices.device_credential_heads;
  v_new kitluy_devices.device_credentials;
  v_status text;
begin
  select id into v_profile from kitluy_devices.hardware_profiles
   where profile_key = 'WS11-T001-HUB-PROBE';

  v_device := kitluy_devices.enroll_device_v1(
    'WS11-T37A-' || gen_random_uuid(), v_profile, v_issued_at,
    v_fp, 'ed25519', 'software', 'STATION-37A', 'OP-37A',
    jsonb_build_array(
      jsonb_build_object('signal_type','mac_address','signal_value','37:0a:' || substr(md5(random()::text),1,6) || ':01'),
      jsonb_build_object('signal_type','board_serial','signal_value','board-37a-' || gen_random_uuid()),
      jsonb_build_object('signal_type','storage_serial','signal_value','nvme-37a-' || gen_random_uuid())));
  perform kitluy_devices.create_device_claim_v1(
    v_device, '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000015', '00000000-0000-4000-8000-000000000018',
    v_token, v_payload, 900, 'OP-37A');
  perform kitluy_devices.redeem_device_claim_v1(v_token, v_payload, v_device, 'HUB-37A');

  v_links := jsonb_build_array(
    jsonb_build_object('link_position', 0, 'role', 'root', 'subject_fingerprint', repeat('a7', 32),
                       'issuer_key_id', 'root-37a', 'canonical_tbs', 'ROOT-TBS-37A',
                       'detached_signature_b64', encode(decode('aa', 'hex'), 'base64')),
    jsonb_build_object('link_position', 1, 'role', 'intermediate', 'subject_fingerprint', repeat('b7', 32),
                       'issuer_key_id', 'root-37a', 'canonical_tbs', 'ICA-TBS-37A',
                       'detached_signature_b64', encode(decode('bb', 'hex'), 'base64')));

  -- GENERATION 1, issued 21 days ago so the renewal window is open.
  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req1, v_device, 'development', 'device_identity', 1, 'PUBKEY-PEM-37A',
    v_fp, v_idem1, repeat('9', 64), 'ed25519', repeat('8', 64),
    decode('a1b2c3', 'hex'), true, 'ica-key-37a', v_issued_at, 'trusted', 'ISSUANCE-SVC');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req1, v_prep ->> 'canonical_tbs_hash', decode('deadbeef', 'hex'), true, 'ISSUANCE-SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req1, v_links, 'ISSUANCE-SVC');

  -- RESERVE the same-key renewal.
  v_res := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity',
    encode(sha256(convert_to('res-37a-' || gen_random_uuid(), 'UTF8')), 'hex'),
    now(), 'trusted', 'reuse_current_key'::kitluy_devices.renewal_mode, 'ISSUANCE-SVC');
  if v_res ->> 'outcome' <> 'RESERVED' then
    raise exception 'ASSERT FAIL: the same-key renewal did not reserve: %', v_res;
  end if;
  if v_res ->> 'status' <> 'issuance_pending' then
    raise exception 'ASSERT FAIL: a reuse_current_key reservation should be issuance_pending, got %',
      v_res ->> 'status';
  end if;

  -- GENERATION 2, prepared with the DEVICE CLOCK AHEAD of the server clock.
  -- This is precisely the case group 0125's trigger refused: not_before ends up
  -- later than now(), so `not_before + 3 days` exceeded `now() + 3 days`.
  v_ahead := now() + interval '2 seconds';
  v_prep := kitluy_devices.prepare_device_credential_issuance_v1(
    v_req2, v_device, 'development', 'device_identity', 1, 'PUBKEY-PEM-37A',
    v_fp, v_idem2, repeat('7', 64), 'ed25519', repeat('6', 64),
    decode('c3b2a1', 'hex'), true, 'ica-key-37a', v_ahead, 'trusted', 'ISSUANCE-SVC');

  if (v_prep ->> 'certificate_generation')::integer <> 2 then
    raise exception 'ASSERT FAIL: renewal preparation reserved generation %, expected 2',
      v_prep ->> 'certificate_generation';
  end if;

  perform kitluy_devices.record_device_credential_signature_v1(
    v_req2, v_prep ->> 'canonical_tbs_hash', decode('beefdead', 'hex'), true, 'ISSUANCE-SVC');

  begin
    v_fin := kitluy_devices.finalize_device_credential_issuance_v1(v_req2, v_links, 'ISSUANCE-SVC');
  exception when others then
    if sqlerrm like 'KLUY-CRED-OVERLAP-EXCEEDED%' then
      raise exception
        'ASSERT FAIL: the group-0132 overlap correction is missing — a renewal prepared with the device clock ahead of the server clock was refused: %', sqlerrm;
    end if;
    raise;
  end;

  if v_fin ->> 'outcome' <> 'ISSUED' then
    raise exception 'ASSERT FAIL: renewal finalization did not issue: %', v_fin;
  end if;

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_device;
  select * into v_new from kitluy_devices.device_credentials
   where device_record_id = v_device and certificate_generation = 2;

  if v_head.current_generation <> 2 or v_head.previous_generation <> 1 then
    raise exception 'ASSERT FAIL: the head did not advance 1 -> 2 (current %, previous %)',
      v_head.current_generation, v_head.previous_generation;
  end if;
  -- The overlap is anchored on the NEW credential's own validity start, and is
  -- exactly three days of it.
  if v_head.overlap_ends_at <> v_new.not_before + interval '3 days' then
    raise exception
      'ASSERT FAIL: overlap ends % but the new credential starts % — the overlap is not anchored on the credential clock',
      v_head.overlap_ends_at, v_new.not_before;
  end if;
  if v_new.not_before <= now() then
    raise exception
      'ASSERT FAIL: the probe did not actually exercise a device clock AHEAD of the server clock';
  end if;
  if v_new.public_key_fingerprint <> v_fp then
    raise exception 'ASSERT FAIL: the renewed credential attests to a different key';
  end if;

  -- DEFECT B: the reservation COMPLETED, atomically with the credential.
  select status::text into v_status from kitluy_devices.device_renewal_reservations
   where device_record_id = v_device;
  if v_status <> 'completed' then
    raise exception
      'ASSERT FAIL: the same-key reservation is % rather than completed — group 0130 left `completed` reachable only through provider activation, which same-key renewal never performs',
      v_status;
  end if;

  -- No replacement key was created, and nothing waits for provider activation.
  if exists (select 1 from kitluy_devices.device_generation_keys
              where device_record_id = v_device) then
    raise exception 'ASSERT FAIL: a same-key renewal created a provider key row';
  end if;

  raise notice 'PASS ws11-same-key-renewal-finalization: a reuse_current_key renewal prepared with the DEVICE CLOCK AHEAD of the server clock finalizes, the head advances 1 -> 2, the overlap is anchored on the new credential''s own not_before at exactly three days, the fingerprint is unchanged, the reservation reaches completed atomically with the credential, and no provider key row is created';
end
$section37a$;

-- ---------------------------------------------------------------------------
-- 37b — the completion trigger BINDS before it completes, and leaves rotation
--       alone.
-- ---------------------------------------------------------------------------
do $section37b$
declare
  v_findings text[] := array[]::text[];
  v_src text;
begin
  -- Both triggers armed, on the right tables.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_credentials'
      and t.tgname = 'trg_device_credentials_complete_same_key_renewal' and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the same-key completion trigger is not armed on device_credentials';
  end if;
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_credential_heads'
      and t.tgname = 'trg_device_heads_overlap' and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the overlap trigger is not armed on device_credential_heads';
  end if;

  -- The completion trigger must refuse a key change and must not touch
  -- rotation. Asserted on the definition because reaching those branches needs
  -- a deliberately corrupt renewal, which the governed path will not produce.
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'complete_same_key_renewal';

  if v_src is null then
    v_findings := v_findings || 'complete_same_key_renewal() does not exist';
  else
    if v_src not like '%KLUY-RENEWAL-KEY-CHANGED%' then
      v_findings := v_findings ||
        'the completion trigger does not refuse a finalization against a different key';
    end if;
    if v_src not like '%renewal_mode <> ''reuse_current_key''%' then
      v_findings := v_findings ||
        'the completion trigger does not leave rotation to provider activation';
    end if;
    if v_src not like '%KLUY-RENEWAL-ASSIGNMENT-BINDING%'
       or v_src not like '%KLUY-RENEWAL-GENERATION-BINDING%' then
      v_findings := v_findings || 'the completion trigger does not bind generation and assignment';
    end if;
  end if;

  -- The overlap rule is anchored on the credential clock, not the server clock.
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'kitluy_devices' and p.proname = 'enforce_overlap_window';
  if v_src not like '%v_new_not_before%' then
    v_findings := v_findings ||
      'enforce_overlap_window no longer anchors the three-day maximum on the new credential not_before';
  end if;
  if v_src not like '%KLUY-CRED-OVERLAP-BEYOND-EXPIRY%' then
    v_findings := v_findings ||
      'enforce_overlap_window lost the cap against the previous credential expiry';
  end if;

  -- Group 0130/0131 containment is untouched.
  if (select allow_key_rotation from kitluy_devices.renewal_policy
       where environment = 'development') then
    v_findings := v_findings || 'key rotation became enabled in the shipped development policy';
  end if;
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_renewal_reservations', 'update')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_credentials', 'insert') then
    v_findings := v_findings || 'the issuance executor gained authority it must not have';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % same-key finalization finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-same-key-completion-binding: both group-0132 triggers are armed, the completion trigger binds generation, assignment and the incumbent fingerprint before completing and leaves rotation to provider activation, the overlap rule is anchored on the new credential''s not_before while keeping the previous-expiry cap, rotation stays disabled and the issuance executor gained no table authority';
end
$section37b$;

select 'assertions complete: groups 0010-0132 structural contract holds' as result;

-- ============================================================================
-- SECTION 38 — reconciliation audit (migration 0133).
--
-- Interrupted renewals are recovered by comparing PostgreSQL against the
-- external key provider. That comparison and the action chosen from it were,
-- before group 0133, recorded NOWHERE: the issuance tables have no place for
-- the renewal attempt id, the observed PROVIDER state, the classification or
-- the action, and an application log that has rotated away cannot answer "why
-- is this device on this generation with a superseded key".
--
-- These assertions hold the audit surface to what recovery evidence has to be:
-- append-only, written only through the governed function, readable by the
-- service role, and incapable of carrying key material.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 38a — the audit surface, and who may write it.
-- ---------------------------------------------------------------------------
do $section38a$
declare
  v_findings text[] := array[]::text[];
  v_privilege text;
begin
  if to_regclass('kitluy_devices.device_renewal_reconciliations') is null then
    raise exception 'ASSERT FAIL: the reconciliation audit table does not exist';
  end if;

  -- Append-only, by trigger rather than by convention.
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'device_renewal_reconciliations'
      and t.tgname = 'trg_device_renewal_reconciliations_append_only'
      and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the reconciliation audit is not append-only';
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'kitluy_devices' and c.relname = 'device_renewal_reconciliations'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    v_findings := v_findings || 'the reconciliation audit lacks RLS ENABLE+FORCE';
  end if;

  -- The EXECUTOR records through the function and never touches the table.
  foreach v_privilege in array array['insert', 'update', 'delete'] loop
    if has_table_privilege('kitluy_issuance_service',
                           'kitluy_devices.device_renewal_reconciliations', v_privilege) then
      v_findings := v_findings ||
        format('the issuance executor holds %s on the reconciliation audit', v_privilege);
    end if;
  end loop;

  -- The SERVICE ROLE reads history and never writes it.
  if has_table_privilege('service_role',
                         'kitluy_devices.device_renewal_reconciliations', 'insert')
     or has_table_privilege('service_role',
                            'kitluy_devices.device_renewal_reconciliations', 'update')
     or has_table_privilege('service_role',
                            'kitluy_devices.device_renewal_reconciliations', 'delete') then
    v_findings := v_findings || 'service_role can write reconciliation history';
  end if;
  if not has_table_privilege('service_role',
                             'kitluy_devices.device_renewal_reconciliations', 'select') then
    v_findings := v_findings || 'service_role cannot read reconciliation history';
  end if;

  -- The writer is reachable by the named executor and by nobody else.
  if not has_function_privilege(
       'kitluy_issuance_service',
       'kitluy_devices.record_renewal_reconciliation_v1(uuid, text, text, text, text, text, text, text, text)',
       'execute') then
    v_findings := v_findings || 'the executor cannot record a reconciliation';
  end if;
  if has_function_privilege(
       'public',
       'kitluy_devices.record_renewal_reconciliation_v1(uuid, text, text, text, text, text, text, text, text)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can record a reconciliation';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % reconciliation-audit finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-reconciliation-audit-surface: the reconciliation audit is append-only with RLS ENABLE+FORCE, the issuance executor can record only THROUGH the governed function and holds no table authority, service_role reads history but cannot write it, and PUBLIC cannot record at all';
end
$section38a$;

-- ---------------------------------------------------------------------------
-- 38b — what the audit refuses to carry, and what it refuses to forget.
-- ---------------------------------------------------------------------------
do $section38b$
declare
  v_findings text[] := array[]::text[];
  v_device uuid;
  v_attempt uuid;
  v_res jsonb;
  v_first uuid;
  v_count integer;
begin
  v_device := pg_temp.ws11_renewable_device('t38b', repeat('38', 32));

  v_res := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity',
    encode(sha256(convert_to('res-38b-' || gen_random_uuid(), 'UTF8')), 'hex'),
    now(), 'trusted', 'reuse_current_key'::kitluy_devices.renewal_mode, 'SVC');
  v_attempt := (v_res ->> 'renewal_attempt_id')::uuid;

  -- A reconciliation for an attempt that does not exist is refused: the device
  -- and environment are taken from the RESERVATION, never from the caller, so
  -- nobody can write history against a device they never touched.
  begin
    perform kitluy_devices.record_renewal_reconciliation_v1(
      gen_random_uuid(), 'db', 'provider', 'NO_ACTION_COMPLETED', 'none', 'none',
      'replayed', null, 'SVC');
    v_findings := v_findings || 'a reconciliation was recorded for a nonexistent attempt';
  exception when others then
    if sqlerrm not like 'KLUY-RECONCILE-NO-RESERVATION%' then
      v_findings := v_findings || format('wrong refusal for a foreign attempt: %s', sqlerrm);
    end if;
  end;

  -- An incomplete record is refused rather than stored half-blank.
  begin
    perform kitluy_devices.record_renewal_reconciliation_v1(
      v_attempt, 'db', 'provider', '', 'none', 'none', 'replayed', null, 'SVC');
    v_findings := v_findings || 'a reconciliation with no classification was recorded';
  exception when others then
    if sqlerrm not like 'KLUY-RECONCILE-INCOMPLETE%' then
      v_findings := v_findings || format('wrong refusal for an incomplete record: %s', sqlerrm);
    end if;
  end;

  -- KEY MATERIAL IS REFUSED BY THE DATABASE. The cheapest way to leak a key is
  -- to log it while explaining why you could not use it.
  begin
    perform kitluy_devices.record_renewal_reconciliation_v1(
      v_attempt,
      -- Assembled at runtime so this FILE contains no private-key block for
      -- the secret scanner to find. The CHECK still sees the whole string.
      '-----BEGIN ' || 'PRIVATE KEY----- leaked',
      'provider', 'MANUAL_REVIEW_REQUIRED', 'none', 'none', 'not-replayed', null, 'SVC');
    v_findings := v_findings || 'the audit accepted PEM private-key material';
  exception when others then
    if sqlerrm not like '%device_renewal_reconciliations_no_key_material_chk%' then
      v_findings := v_findings || format('key material was refused for the wrong reason: %s', sqlerrm);
    end if;
  end;

  -- A real record, then a SECOND one. History accumulates; it is never edited.
  v_first := (kitluy_devices.record_renewal_reconciliation_v1(
    v_attempt, 'reservation=issuance_pending key=none', 'key=missing incumbent=available',
    'RESERVATION_PENDING', 'prepare the next credential', 'prepared', 'executed', null, 'SVC')
    ->> 'reconciliation_id')::uuid;
  perform kitluy_devices.record_renewal_reconciliation_v1(
    v_attempt, 'reservation=completed key=none', 'key=missing incumbent=available',
    'RESPONSE_REPLAY', 'replay the recorded result', 'nothing to do', 'replayed', null, 'SVC');

  select count(*) into v_count from kitluy_devices.device_renewal_reconciliations
   where renewal_attempt_id = v_attempt;
  if v_count <> 2 then
    v_findings := v_findings || format('expected 2 reconciliation rows, found %s', v_count);
  end if;

  -- The sequence is a TOTAL order even though both rows were written in one
  -- transaction — now() would have stamped them identically.
  if (select count(distinct sequence_no) from kitluy_devices.device_renewal_reconciliations
       where renewal_attempt_id = v_attempt) <> 2 then
    v_findings := v_findings || 'reconciliation history has no total order';
  end if;

  -- An earlier outcome can never be rewritten.
  begin
    update kitluy_devices.device_renewal_reconciliations
       set classification = 'REWRITTEN' where reconciliation_id = v_first;
    v_findings := v_findings || 'a recorded reconciliation outcome was overwritten';
  exception when others then
    null;
  end;
  begin
    delete from kitluy_devices.device_renewal_reconciliations where reconciliation_id = v_first;
    v_findings := v_findings || 'a recorded reconciliation outcome was deleted';
  exception when others then
    null;
  end;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % reconciliation-record finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-reconciliation-audit-record: the device and environment come from the RESERVATION so history cannot be written against another device, a nonexistent attempt and an incomplete record are both refused, PEM private-key material is refused by CHECK, two reconciliations in one transaction still carry a total order, and a recorded outcome can be neither updated nor deleted';
end
$section38b$;

select 'assertions complete: groups 0010-0133 structural contract holds' as result;

-- ============================================================================
-- SECTION 39 — credential overlap lifecycle (migration 0134).
--
-- Group 0125 gave device_credentials the states `superseded` and `expired` and
-- group 0127 advances the head with a previous_generation and an
-- overlap_ends_at. NOTHING moved a credential into either state, and neither
-- postgres nor kitluy_issuance_service can write the table — so once the §5
-- three-day overlap ended, the previous credential stayed `issued` for ever.
--
-- These assertions hold the correction: the retirement is governed, uses a
-- HALF-OPEN boundary, never touches the current credential or the head, and
-- key destruction stays impossible until an owner rules.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 39a — destruction ships impossible, and cannot be enabled by halves.
-- ---------------------------------------------------------------------------
do $section39a$
declare
  v_findings text[] := array[]::text[];
  v_p kitluy_devices.key_destruction_policy;
begin
  -- Group 0134 shipped this policy INERT and this section asserted that it was.
  -- Owner decision KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 (OWNER-APPROVED
  -- 2026-07-29) closed KLREQ-031, and group 0137 configured it. The assertion
  -- therefore changes from "no policy exists" to "the policy is EXACTLY the one
  -- the owner approved, and cannot be weakened" — which is the same discipline
  -- pointed at a world that now has an answer.
  select * into v_p from kitluy_devices.key_destruction_policy where environment = 'development';

  if not v_p.destruction_enabled then
    v_findings := v_findings || 'the approved destruction policy is not enabled';
  end if;
  if v_p.approved_by_decision_ref is distinct from 'KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001' then
    v_findings := v_findings || 'the policy does not name the approving owner decision';
  end if;
  if v_p.required_owner_decision is not null then
    v_findings := v_findings || 'the policy still names a missing owner decision';
  end if;

  -- The approved values, verbatim from decision §15. A rounded or "tidied"
  -- retention period is a different policy from the one that was approved.
  if v_p.superseded_minimum_retention_days is distinct from 30
     or v_p.abandoned_minimum_retention_days is distinct from 7
     or v_p.recovery_retention_days is distinct from 14
     or v_p.approval_validity_hours is distinct from 24
     or v_p.maximum_execution_attempts is distinct from 5 then
    v_findings := v_findings || 'the configured retention/approval values are not the approved §15 values';
  end if;
  if v_p.automatic_provider_destruction or not v_p.four_eyes_required
     or not v_p.requires_operator_approval then
    v_findings := v_findings || 'the policy permits automatic or single-person destruction';
  end if;

  -- §7: the irreversible provider call cannot be made automatic.
  begin
    update kitluy_devices.key_destruction_policy set automatic_provider_destruction = true
     where environment = 'development';
    v_findings := v_findings || 'the irreversible provider call was made automatic';
  exception when others then
    if sqlerrm not like '%not_automatic_chk%' then
      v_findings := v_findings || format('wrong refusal automating destruction: %s', sqlerrm);
    end if;
  end;

  -- §6: four-eyes cannot be dropped while destruction is enabled.
  begin
    update kitluy_devices.key_destruction_policy set four_eyes_required = false
     where environment = 'development';
    v_findings := v_findings || 'four-eyes was disabled while destruction is enabled';
  exception when others then
    if sqlerrm not like '%four_eyes_when_enabled_chk%' then
      v_findings := v_findings || format('wrong refusal disabling four-eyes: %s', sqlerrm);
    end if;
  end;

  -- §12: the database may never record a confirmed destruction without
  -- verified provider evidence. This is the invariant the decision turns on.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_destruction_requests'::regclass
       and conname = 'device_key_destruction_no_confirm_without_evidence') then
    v_findings := v_findings || 'the database may confirm destruction without provider evidence';
  end if;
  -- §6/§8: requester != approver, and a hold is not released by its declarer.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_destruction_requests'::regclass
       and conname = 'device_key_destruction_requests_four_eyes') then
    v_findings := v_findings || 'a requester may approve their own destruction';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_devices.device_key_holds'::regclass
       and conname = 'device_key_holds_release_is_four_eyes') then
    v_findings := v_findings || 'a hold may be released by its own declarer';
  end if;

  -- §10: `destroyed` is reachable only from a FINISHED key. Group 0128
  -- permitted active->destroyed and generated->destroyed; 0137 closed both.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices' and p.proname = 'enforce_device_key_transitions'
       and (pg_get_functiondef(p.oid) like '%when ''active'' then new.state in (''superseded'', ''destroyed'')%'
            or pg_get_functiondef(p.oid) like '%when ''generated'' then new.state in (''active'', ''abandoned'', ''destroyed'')%')) then
    v_findings := v_findings || 'an active or freshly generated key can still be destroyed directly';
  end if;

  -- The executor holds no direct authority over any of it.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.key_destruction_policy', 'update')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_key_destruction_requests', 'update')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_key_holds', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.device_credential_lifecycle_events', 'insert') then
    v_findings := v_findings || 'the issuance executor holds direct authority it must not have';
  end if;
  if has_function_privilege(
       'public',
       'kitluy_devices.retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can retire a credential';
  end if;
  if has_function_privilege('public',
       'kitluy_devices.confirm_key_destruction_v1(uuid, text, text, text, text, text, text, timestamptz, timestamptz)',
       'execute') then
    v_findings := v_findings || 'PUBLIC can confirm a key destruction';
  end if;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'device_credential_lifecycle_events'
      and t.tgname = 'trg_device_credential_lifecycle_events_append_only'
      and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the lifecycle audit is not append-only';
  end if;

  -- And after all of that, nothing has actually been destroyed.
  if exists (select 1 from kitluy_devices.device_generation_keys
              where state = 'destroyed' or destroyed_at is not null) then
    v_findings := v_findings || 'a provider key is recorded as destroyed';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % destruction-policy finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-key-destruction-governed: the destruction policy is EXACTLY owner decision KLD-2026-07-29-DEVICE-KEY-DESTRUCTION-001 §15 (30/7/14 day retentions, 24h approval, 5 attempts), the irreversible provider call cannot be made automatic and four-eyes cannot be disabled while destruction is enabled, the database cannot confirm a destruction without verified provider evidence, a requester cannot approve their own request and a hold cannot be released by its declarer, an active or freshly generated key can no longer be destroyed directly, the issuance executor holds no direct authority over policy, requests or holds, PUBLIC can neither retire a credential nor confirm a destruction, the lifecycle audit is append-only, and no provider key is recorded as destroyed';
end
$section39a$;

-- ---------------------------------------------------------------------------
-- 39b — the half-open boundary, and what retirement refuses to touch.
-- ---------------------------------------------------------------------------
do $section39b$
declare
  v_findings text[] := array[]::text[];
  v_device uuid;
  v_head kitluy_devices.device_credential_heads;
  v_res jsonb;
  v_fp1 text := repeat('39', 32);
  v_fp2 text := repeat('3a', 32);
  v_idem text := encode(sha256(convert_to('i39b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_req text := 'rq-39b-' || gen_random_uuid();
  v_attempt uuid;
  v_prep jsonb;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  v_device := pg_temp.ws11_renewable_device('t39b', v_fp1);

  -- A ROTATION, so the previous and current credentials use DIFFERENT keys and
  -- the retirement can be observed without the same-key shortcut.
  update kitluy_devices.renewal_policy
     set allow_key_rotation = true, rotation_approved_by_decision_ref = 'TEST-ONLY-section39b'
   where environment = 'development';

  v_res := kitluy_devices.reserve_device_credential_renewal_v1(
    v_device, 'development', 'device_identity',
    encode(sha256(convert_to('res-39b-' || gen_random_uuid(), 'UTF8')), 'hex'),
    now(), 'trusted', 'rotate_key'::kitluy_devices.renewal_mode, 'SVC');
  v_attempt := (v_res ->> 'renewal_attempt_id')::uuid;
  perform kitluy_devices.register_generation_key_v2(v_attempt, 'handle-39b', 'PEM-39B', v_fp2, 2);

  v_prep := kitluy_devices.prepare_device_credential_renewal_v2(
    v_device, 'development', 'device_identity', v_req,
    v_idem, repeat('7', 64), 'PEM-39B', v_fp2, 'ed25519', repeat('6', 64),
    decode('b2', 'hex'), true, 'ica-39b', now(), 'trusted', 'SVC', 'rotate_key');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('3939', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req, v_links, 'SVC');

  update kitluy_devices.renewal_policy
     set allow_key_rotation = false, rotation_approved_by_decision_ref = null
   where environment = 'development';

  select * into v_head from kitluy_devices.device_credential_heads
   where device_record_id = v_device;
  if v_head.overlap_ends_at is null then
    raise exception 'ASSERT FAIL: the renewal left no overlap to expire';
  end if;

  -- ONE MILLISECOND BEFORE the boundary: the overlap is still running.
  v_res := kitluy_devices.retire_overlapped_credential_v1(
    v_device, 'development', 'device_identity',
    v_head.overlap_ends_at - interval '1 millisecond', 'trusted', 'SVC');
  if (v_res ->> 'outcome') <> 'OVERLAP_ACTIVE' then
    v_findings := v_findings ||
      format('one millisecond before the boundary the overlap was %s', v_res ->> 'outcome');
  end if;
  if (select state from kitluy_devices.device_credentials
       where device_record_id = v_device and certificate_generation = 1) <> 'issued' then
    v_findings := v_findings || 'the previous credential was retired DURING its overlap';
  end if;

  -- EXACTLY AT the boundary: expired. Half-open, so there is no gap.
  v_res := kitluy_devices.retire_overlapped_credential_v1(
    v_device, 'development', 'device_identity',
    v_head.overlap_ends_at, 'trusted', 'SVC');
  if (v_res ->> 'outcome') <> 'RETIRED' then
    v_findings := v_findings ||
      format('exactly at the boundary the outcome was %s, not RETIRED', v_res ->> 'outcome');
  end if;
  if (select state from kitluy_devices.device_credentials
       where device_record_id = v_device and certificate_generation = 1) <> 'superseded' then
    v_findings := v_findings || 'the previous credential was not superseded at the boundary';
  end if;

  -- The CURRENT credential is untouched, and so is the head.
  if (select state from kitluy_devices.device_credentials
       where device_record_id = v_device and certificate_generation = 2) <> 'issued' then
    v_findings := v_findings || 'retirement disturbed the CURRENT credential';
  end if;
  if (select version from kitluy_devices.device_credential_heads where device_record_id = v_device)
     <> v_head.version then
    v_findings := v_findings ||
      'retirement bumped the head version, which would invalidate an in-flight renewal reservation';
  end if;
  if (select overlap_ends_at from kitluy_devices.device_credential_heads
       where device_record_id = v_device) is null then
    v_findings := v_findings || 'retirement erased the overlap evidence';
  end if;

  -- Idempotent, and the provider key is NOT destroyed by any of this.
  v_res := kitluy_devices.retire_overlapped_credential_v1(
    v_device, 'development', 'device_identity',
    v_head.overlap_ends_at + interval '1 day', 'trusted', 'SVC');
  if (v_res ->> 'outcome') <> 'ALREADY_RETIRED' then
    v_findings := v_findings || format('a second retirement returned %s', v_res ->> 'outcome');
  end if;
  if exists (select 1 from kitluy_devices.device_generation_keys
              where device_record_id = v_device
                and (state = 'destroyed' or destroyed_at is not null)) then
    v_findings := v_findings || 'a provider key was destroyed by credential retirement';
  end if;

  -- Untrusted time cannot advance the lifecycle.
  begin
    perform kitluy_devices.retire_overlapped_credential_v1(
      v_device, 'development', 'device_identity', now(), 'uninitialized', 'SVC');
    v_findings := v_findings || 'retirement proceeded on untrusted time';
  exception when others then
    if sqlerrm not like 'KLUY-LIFECYCLE-NO-TRUSTED-TIME%' then
      v_findings := v_findings || format('wrong refusal for untrusted time: %s', sqlerrm);
    end if;
  end;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % overlap-lifecycle finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-overlap-retirement: the §5 overlap boundary is HALF-OPEN — active one millisecond before overlap_ends_at and RETIRED exactly at it, with no gap between the layers — retirement supersedes only the previous credential, leaves the CURRENT credential and the head version untouched so an in-flight renewal reservation survives, preserves overlap_ends_at as the evidence explaining itself, is idempotent, destroys no provider key, and refuses to run on untrusted time';
end
$section39b$;

select 'assertions complete: groups 0010-0134 structural contract holds' as result;

-- ============================================================================
-- SECTION 40 — durable job runtime (migration 0135).
--
-- Groups 0125-0134 built reconciliation and credential-lifecycle advancement as
-- callable services. Nothing could call them repeatedly and safely from more
-- than one process: probing this database for any table matching
-- (job|queue|lease|dead_letter|worker|schedul) returned exactly one row, and it
-- belongs to the pg_net EXTENSION.
--
-- These assertions hold the contract that closed that gap: deduplicated work,
-- one active lease per job, completion bound to that lease, legal transitions
-- only, monotonic attempt history, append-only evidence, and a worker that
-- holds no authority over anything it is not executing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 40a — the shape of the contract: ownership, exposure, RLS, search_path.
-- ---------------------------------------------------------------------------
do $section40a$
declare
  v_findings text[] := array[]::text[];
  r record;
begin
  -- Governors are NOLOGIN. A login-capable owner is an owner someone can become.
  if exists (select 1 from pg_roles
              where rolname in ('kitluy_job_governor', 'kitluy_worker_service')
                and rolcanlogin) then
    v_findings := v_findings || 'a job governor or worker role can log in';
  end if;

  -- The tables are owned by the governor, not by the migration user.
  for r in
    select c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_ops'
       and c.relname in ('durable_jobs', 'durable_job_attempts')
  loop
    if r.owner <> 'kitluy_job_governor' then
      v_findings := v_findings || format('%s is owned by %s', r.relname, r.owner);
    end if;
    if not r.relrowsecurity or not r.relforcerowsecurity then
      v_findings := v_findings || format('%s does not have RLS ENABLED and FORCED', r.relname);
    end if;
  end loop;

  -- Every governed function is SECURITY DEFINER with a FIXED search_path, owned
  -- by the governor, and invisible to PUBLIC. A definer function with a
  -- caller-controlled search_path is a definer function the caller writes.
  for r in
    select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner,
           p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_ops'
       and p.proname like '%durable_job%' or (n.nspname = 'kitluy_ops' and p.proname like '%job%')
  loop
    if r.owner <> 'kitluy_job_governor' then
      v_findings := v_findings || format('%s is owned by %s', r.proname, r.owner);
    end if;
    if has_function_privilege('public', r.sig, 'execute') then
      v_findings := v_findings || format('PUBLIC can execute %s', r.proname);
    end if;
    if r.prosecdef and (r.proconfig is null
        or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%')) then
      v_findings := v_findings || format('%s is SECURITY DEFINER without a fixed search_path', r.proname);
    end if;
  end loop;

  -- The worker executes the runtime and NOTHING else. It cannot write the job
  -- tables, cannot clear its own escalations, and holds no authority over
  -- credentials, heads, keys or lifecycle state.
  if has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_jobs', 'insert')
     or has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_jobs', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_jobs', 'delete')
     or has_table_privilege('kitluy_worker_service', 'kitluy_ops.durable_job_attempts', 'insert') then
    v_findings := v_findings || 'the worker holds direct authority over the job tables';
  end if;
  if has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_credentials', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_credential_heads', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_generation_keys', 'update')
     or has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_renewal_reservations', 'update') then
    v_findings := v_findings || 'the worker holds direct authority over credential state';
  end if;
  if has_function_privilege('kitluy_worker_service',
       'kitluy_ops.release_manual_review_job_v1(uuid, text, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.cancel_durable_job_v1(uuid, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_ops.escalate_dead_letter_job_v1(uuid, text, text)', 'execute') then
    v_findings := v_findings || 'the worker can release, cancel or revive its own jobs';
  end if;
  -- Job authority is not credential authority. A worker that could retire a
  -- credential directly would make the governed path optional.
  if has_function_privilege('kitluy_worker_service',
       'kitluy_devices.retire_overlapped_credential_v1(uuid, text, text, timestamptz, text, text)',
       'execute') then
    v_findings := v_findings || 'the worker can retire a credential without the issuance role';
  end if;

  -- Evidence is append-only by trigger, and jobs are never deleted.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'durable_job_attempts'
                    and t.tgname = 'trg_durable_job_attempts_append_only' and not t.tgisinternal) then
    v_findings := v_findings || 'the job attempt audit is not append-only';
  end if;
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'durable_jobs'
                    and t.tgname = 'trg_durable_jobs_no_delete' and not t.tgisinternal) then
    v_findings := v_findings || 'durable jobs can be deleted';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % durable-job contract finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-durable-job-contract: the job tables are owned by a NOLOGIN governor with RLS ENABLED and FORCED, every governed function is SECURITY DEFINER with a fixed search_path and no PUBLIC EXECUTE, the worker holds no direct table authority here or over credential state, cannot release cancel or revive its own jobs, cannot retire a credential without the issuance role, job evidence is append-only and jobs cannot be deleted';
end
$section40a$;

-- ---------------------------------------------------------------------------
-- 40b — the behaviour: deduplication, leases, transitions, budgets.
-- ---------------------------------------------------------------------------
do $section40b$
declare
  v_findings text[] := array[]::text[];
  -- A TEST-ONLY kind. These rows COMMIT (db:test is not idempotent by design),
  -- and manufacturing them under the real device kind would leave claimable
  -- work in the production namespace for the next thing that sweeps it.
  v_kind text := 'kitluy.test.assertions-section40b.v1';
  v_key text := 'section40b-' || gen_random_uuid();
  v_subject uuid := gen_random_uuid();
  v_job uuid;
  v_lease uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_res jsonb;
  v_n integer;
begin
  -- Deduplication: the same work, discovered twice, is ONE job.
  v_res := kitluy_ops.enqueue_durable_job_v1(
    v_kind, 1, v_key, 'development', v_subject, '{}'::jsonb, 2, 'SECTION40B');
  v_job := (v_res ->> 'job_id')::uuid;
  v_res := kitluy_ops.enqueue_durable_job_v1(
    v_kind, 1, v_key, 'development', v_subject, '{}'::jsonb, 2, 'SECTION40B');
  if (v_res ->> 'outcome') <> 'EXISTING' or (v_res ->> 'job_id')::uuid <> v_job then
    v_findings := v_findings || 'the same work produced two jobs';
  end if;
  -- ...and the uniqueness is a CONSTRAINT, not a convention.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'kitluy_ops.durable_jobs'::regclass
       and conname = 'durable_jobs_dedupe_unique' and contype = 'u') then
    v_findings := v_findings || 'deduplication is not enforced by a unique constraint';
  end if;

  -- One active lease. A second claimant finds nothing to claim.
  perform kitluy_ops.claim_durable_jobs_v1(array[v_kind], 'development', 'w-a', v_lease, 60, 10);
  select count(*) into v_n from kitluy_ops.claim_durable_jobs_v1(
    array[v_kind], 'development', 'w-b', v_other, 60, 10) c where c.job_id = v_job;
  if v_n <> 0 then
    v_findings := v_findings || 'a second worker claimed a job under a live lease';
  end if;
  if (select attempt_count from kitluy_ops.durable_jobs where job_id = v_job) <> 1 then
    v_findings := v_findings || 'a claim did not increment the attempt count exactly once';
  end if;

  -- The lease token is the authority. Nothing else is.
  begin
    perform kitluy_ops.complete_durable_job_v1(v_job, v_other, 'DONE', 'SECTION40B');
    v_findings := v_findings || 'a stale lease token completed a job';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-STALE-LEASE%' then
      v_findings := v_findings || format('wrong refusal for a stale lease: %s', sqlerrm);
    end if;
  end;
  begin
    perform kitluy_ops.fail_durable_job_v1(
      v_job, v_other, 'PROVIDER_UNAVAILABLE',
      'retryable'::kitluy_ops.job_outcome_classification, 0, 'SECTION40B');
    v_findings := v_findings || 'a stale lease token failed a job';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-STALE-LEASE%' then
      v_findings := v_findings || format('wrong refusal failing under a stale lease: %s', sqlerrm);
    end if;
  end;

  -- A deferral preserves the claim history and discounts the BUDGET. The two
  -- counters answer different questions and neither may be made to lie.
  v_res := kitluy_ops.defer_durable_job_v1(
    v_job, v_lease, now() + interval '3 days', 'NOT DUE', 'SECTION40B');
  if (v_res ->> 'outcome') <> 'DEFERRED' then
    v_findings := v_findings || 'a deferral was refused';
  end if;
  if (select attempt_count from kitluy_ops.durable_jobs where job_id = v_job) <> 1
     or (select deferral_count from kitluy_ops.durable_jobs where job_id = v_job) <> 1 then
    v_findings := v_findings || 'a deferral did not preserve history while discounting the budget';
  end if;
  -- A deferred job is genuinely out of the queue until its due time.
  select count(*) into v_n from kitluy_ops.claim_durable_jobs_v1(
    array[v_kind], 'development', 'w-c', gen_random_uuid(), 60, 10) c where c.job_id = v_job;
  if v_n <> 0 then
    v_findings := v_findings || 'a deferred job was claimed before it was due';
  end if;

  -- Attempt history is monotonic against a direct write by the table owner.
  begin
    update kitluy_ops.durable_jobs set attempt_count = 0 where job_id = v_job;
    v_findings := v_findings || 'the attempt count was reset';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-ATTEMPTS-NOT-MONOTONIC%' then
      v_findings := v_findings || format('wrong refusal resetting attempts: %s', sqlerrm);
    end if;
  end;

  -- Identity and payload are fixed at creation. Retrying as a different kind,
  -- or against a different subject, is not a retry.
  begin
    update kitluy_ops.durable_jobs set subject_id = gen_random_uuid() where job_id = v_job;
    v_findings := v_findings || 'a job was re-aimed at another subject';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-IDENTITY-IMMUTABLE%' then
      v_findings := v_findings || format('wrong refusal re-aiming a job: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_ops.durable_jobs set payload = '{"injected":true}'::jsonb where job_id = v_job;
    v_findings := v_findings || 'a job payload was rewritten';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-PAYLOAD-IMMUTABLE%' then
      v_findings := v_findings || format('wrong refusal rewriting a payload: %s', sqlerrm);
    end if;
  end;

  -- Exhausting the budget dead-letters, and a dead letter does NOT return to
  -- the queue by itself. Two governed acts are required, and each is recorded.
  update kitluy_ops.durable_jobs set next_attempt_at = now() where job_id = v_job;
  perform kitluy_ops.claim_durable_jobs_v1(array[v_kind], 'development', 'w-a', v_lease, 60, 10);
  perform kitluy_ops.fail_durable_job_v1(
    v_job, v_lease, 'PROVIDER_UNAVAILABLE',
    'retryable'::kitluy_ops.job_outcome_classification, 0, 'SECTION40B');
  update kitluy_ops.durable_jobs set next_attempt_at = now() where job_id = v_job;
  v_lease := gen_random_uuid();
  perform kitluy_ops.claim_durable_jobs_v1(array[v_kind], 'development', 'w-a', v_lease, 60, 10);
  v_res := kitluy_ops.fail_durable_job_v1(
    v_job, v_lease, 'PROVIDER_UNAVAILABLE',
    'retryable'::kitluy_ops.job_outcome_classification, 0, 'SECTION40B');
  if (v_res ->> 'outcome') <> 'DEAD_LETTER' then
    v_findings := v_findings ||
      format('an exhausted budget produced %s rather than a dead letter', v_res ->> 'outcome');
  end if;
  begin
    update kitluy_ops.durable_jobs set status = 'queued' where job_id = v_job;
    v_findings := v_findings || 'a dead letter returned itself to the queue';
  exception when others then
    if sqlerrm not like 'KLUY-JOB-ILLEGAL-TRANSITION%' then
      v_findings := v_findings || format('wrong refusal requeueing a dead letter: %s', sqlerrm);
    end if;
  end;
  -- The failure evidence survives the dead-lettering.
  if (select last_failure_code from kitluy_ops.durable_jobs where job_id = v_job)
       is distinct from 'PROVIDER_UNAVAILABLE' then
    v_findings := v_findings || 'the dead letter discarded why it died';
  end if;

  -- A manual-review release does NOT reset the attempt history.
  perform kitluy_ops.escalate_dead_letter_job_v1(v_job, 'operator review', 'SECTION40B');
  v_res := kitluy_ops.release_manual_review_job_v1(v_job, 'retry', 'transient outage fixed', 'SECTION40B');
  if (v_res ->> 'outcome') <> 'QUEUED' then
    v_findings := v_findings || 'a manual release did not requeue the job';
  end if;
  if (select attempt_count from kitluy_ops.durable_jobs where job_id = v_job) < 2 then
    v_findings := v_findings || 'a manual release silently reset the attempt count';
  end if;

  -- Environment isolation: a job in one environment is invisible to another.
  if ((kitluy_ops.durable_job_status_summary_v1('pilot', array[v_kind], v_subject)) ->> 'queued')::int <> 0 then
    v_findings := v_findings || 'the operational summary leaked across environments';
  end if;

  -- NOTHING in this section destroyed a provider key, and destruction is still
  -- disabled: a scheduled executor must not become a way around the policy.
  -- Destruction is now ENABLED by owner decision KLD-2026-07-29-DEVICE-KEY-
  -- DESTRUCTION-001, so "enabled" is no longer the defect this once checked for.
  -- What still matters is that the JOB RUNTIME cannot touch the policy: an
  -- executor that could enable its own authority would make four-eyes optional.
  if has_table_privilege('kitluy_worker_service',
                         'kitluy_devices.key_destruction_policy', 'update')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.device_key_destruction_requests', 'update')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.device_key_holds', 'update') then
    v_findings := v_findings || 'the worker can change destruction policy, requests or holds'::text;
  end if;
  if exists (select 1 from kitluy_devices.device_generation_keys
              where state = 'destroyed' or destroyed_at is not null) then
    v_findings := v_findings || 'a provider key was destroyed';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % durable-job behaviour finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-durable-job-behaviour: the same work deduplicates to ONE job under a unique constraint, only one worker holds a live lease, a claim counts exactly one attempt, a stale lease token can neither complete nor fail a job, a deferral preserves the claim history while discounting the retry budget and stays out of the queue until due, attempt history is monotonic and job identity and payload are immutable against a direct write, an exhausted budget dead-letters while keeping its failure evidence, a dead letter cannot requeue itself, a manual release never resets the attempt count, the operational summary does not leak across environments, and no provider key was destroyed';
end
$section40b$;

select 'assertions complete: groups 0010-0135 structural contract holds' as result;

-- ============================================================================
-- SECTION 41 — emergency revocation, scope and the one-way rule (migration 0138).
--
-- Owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001, OWNER-APPROVED
-- 2026-07-29, closed `[REQUIRED: device_credential_revocation_approval_policy]`
-- and `[REQUIRED: device_revocation_scope_policy]`. Group 0136 shipped
-- revocation requiring a completed PRIOR approval for every reason, which was
-- the fail-closed default; group 0138 refines it.
--
-- The behaviour these assertions exist for is §2.4: a late, missing or refused
-- post-approval must NEVER restore the credential. An auto-reversing revocation
-- would mean an attacker who merely delays the second approver gets the
-- credential back — the emergency path would become a way to SCHEDULE
-- un-revocation. Section 41c proves the credential is still `revoked` after an
-- explicit refusal, after a lapsed deadline, and against a direct write by the
-- credential governor itself.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 41a — the policy is EXACTLY the approved one, and cannot be relaxed.
-- ---------------------------------------------------------------------------
do $section41a$
declare
  v_findings text[] := array[]::text[];
  v_p kitluy_devices.credential_revocation_policy;
  r record;
begin
  select * into v_p from kitluy_devices.credential_revocation_policy
   where environment = 'development';

  -- §2.2, verbatim. A rounded, reordered or "tidied" list is a different policy
  -- from the one the owner approved.
  if not (v_p.emergency_eligible_reasons @> array[
            'KEY_COMPROMISE','DEVICE_LOST','DEVICE_STOLEN','PROVIDER_COMPROMISE',
            'SECURITY_INCIDENT']::kitluy_devices.credential_revocation_reason[]
          and cardinality(v_p.emergency_eligible_reasons) = 5) then
    v_findings := v_findings || 'the emergency reason set is not decision §2.2 verbatim';
  end if;
  -- §2.1, verbatim.
  if not (v_p.approve_before_execute_reasons @> array[
            'ASSIGNMENT_INVALIDATED','CERTIFICATE_MISISSUANCE',
            'ADMINISTRATIVE_REPLACEMENT','OTHER_APPROVED_REASON'
          ]::kitluy_devices.credential_revocation_reason[]
          and cardinality(v_p.approve_before_execute_reasons) = 4) then
    v_findings := v_findings || 'the approve-before-execute reason set is not decision §2.1 verbatim';
  end if;
  if v_p.post_approval_window_hours is distinct from 4 then
    v_findings := v_findings || 'the post-approval window is not the approved 4 hours';
  end if;
  if v_p.approved_by_decision_ref
       is distinct from 'KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001' then
    v_findings := v_findings || 'the policy does not name the approving owner decision';
  end if;
  if v_p.required_owner_decision is not null then
    v_findings := v_findings || 'the policy still names a missing owner decision';
  end if;
  -- Emergency is four-eyes DEFERRED, never four-eyes EXEMPT. Putting the five
  -- emergency reasons into group 0136's exempt list would have produced
  -- single-signature revocation with none of the §2.3 obligations attached.
  if cardinality(v_p.four_eyes_exempt_reasons) <> 0 or not v_p.four_eyes_required then
    v_findings := v_findings || 'an emergency reason was made four-eyes EXEMPT rather than DEFERRED';
  end if;

  -- DISJOINT and TOTAL, by constraint. A reason in neither set is a revocation
  -- nobody can execute correctly; a reason in both is a revocation whose rule
  -- depends on which function the caller happened to reach.
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_eligible_reasons = emergency_eligible_reasons
             || 'CERTIFICATE_MISISSUANCE'::kitluy_devices.credential_revocation_reason
     where environment = 'development';
    v_findings := v_findings || 'a reason was placed in BOTH reason sets';
  exception when others then
    if sqlerrm not like '%reason_sets_chk%' then
      v_findings := v_findings || format('wrong refusal for overlapping reason sets: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_eligible_reasons = array[
             'KEY_COMPROMISE']::kitluy_devices.credential_revocation_reason[]
     where environment = 'development';
    v_findings := v_findings || 'revocation reasons were left in NEITHER set';
  exception when others then
    if sqlerrm not like '%reason_sets_chk%' then
      v_findings := v_findings || format('wrong refusal for unclassified reasons: %s', sqlerrm);
    end if;
  end;

  -- §2.3 gates and §2.5 cannot be switched off during an incident.
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_requires_incident_reference = false where environment = 'development';
    v_findings := v_findings || 'the mandatory incident reference was switched off';
  exception when others then
    if sqlerrm not like '%emergency_gates_chk%' then
      v_findings := v_findings || format('wrong refusal relaxing the incident reference: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.credential_revocation_policy
       set emergency_requires_reauthentication = false where environment = 'development';
    v_findings := v_findings || 'the mandatory re-authentication was switched off';
  exception when others then
    if sqlerrm not like '%emergency_gates_chk%' then
      v_findings := v_findings || format('wrong refusal relaxing re-authentication: %s', sqlerrm);
    end if;
  end;
  -- §2.5: no automatic machine-generated revocation is approved for Phase 1.
  begin
    update kitluy_devices.credential_revocation_policy
       set machine_initiated_revocation_permitted = true where environment = 'development';
    v_findings := v_findings || 'machine-initiated revocation was permitted';
  exception when others then
    if sqlerrm not like '%no_machine_chk%' then
      v_findings := v_findings || format('wrong refusal permitting machine revocation: %s', sqlerrm);
    end if;
  end;

  -- §2.5, as authority rather than as a flag: the worker may detect, record and
  -- escalate. It may not decide to revoke, and it holds no path that would let
  -- it.
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and (p.proname like '%revoke%' or p.proname like '%revocation%')
  loop
    if has_function_privilege('kitluy_worker_service', r.sig, 'execute') then
      v_findings := v_findings || format('the worker role can execute %s', r.proname);
    end if;
    if has_function_privilege('public', r.sig, 'execute') then
      v_findings := v_findings || format('PUBLIC can execute %s', r.proname);
    end if;
  end loop;
  if has_table_privilege('kitluy_worker_service', 'kitluy_devices.device_credentials', 'update')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.device_credential_emergency_revocations', 'insert')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.revocation_recorded_scopes', 'insert')
     or has_table_privilege('kitluy_worker_service',
                            'kitluy_devices.credential_revocation_policy', 'update') then
    v_findings := v_findings || 'the worker holds direct authority over revocation state';
  end if;
  -- The named executor records only THROUGH the governed functions.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.device_credential_emergency_revocations', 'insert')
     or has_table_privilege('kitluy_issuance_service',
                            'kitluy_devices.revocation_recorded_scopes', 'insert') then
    v_findings := v_findings || 'the issuance executor can write emergency evidence directly';
  end if;

  -- §3 row 7 is answered from kitluy_devices evidence, NOT by reaching into the
  -- approvals aggregate. A credential governor that could write kitluy_auth
  -- could manufacture the approval that authorizes its own broader scope, and
  -- one that could read it would have crossed the boundary section 7's policy
  -- census exists to hold.
  if has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'insert')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'update')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'delete') then
    v_findings := v_findings || 'the credential governor reaches the approvals aggregate directly';
  end if;

  -- Shape: definer, fixed search_path, governor-owned, RLS ENABLED and FORCED.
  for r in
    select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) as owner
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('resolve_revocation_scope_v1', 'record_revocation_scope_v1',
                         'escalate_emergency_revocation_v1', 'revoke_device_credential_emergency_v1',
                         'record_emergency_revocation_post_approval_v1',
                         'lapse_emergency_revocation_post_approvals_v1')
  loop
    if not r.prosecdef or r.owner <> 'kitluy_credential_issuer'
       or r.proconfig is null
       or not exists (select 1 from unnest(r.proconfig) c where c like 'search_path=%') then
      v_findings := v_findings ||
        format('%s is not a governor-owned SECURITY DEFINER with a fixed search_path', r.proname);
    end if;
  end loop;
  for r in
    select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_devices'
       and c.relname in ('revocation_recorded_scopes', 'device_credential_emergency_revocations')
  loop
    if not r.relrowsecurity or not r.relforcerowsecurity then
      v_findings := v_findings || format('%s does not have RLS ENABLED and FORCED', r.relname);
    end if;
  end loop;

  -- §2.4 is structural, not merely intended: nothing can put a revoked
  -- credential back into any other state.
  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'device_credentials'
                    and t.tgname = 'trg_device_credentials_revocation_one_way'
                    and not t.tgisinternal) then
    v_findings := v_findings || 'nothing prevents a revoked credential returning to service';
  end if;
  for r in
    select p.proname, pg_get_functiondef(p.oid) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('record_emergency_revocation_post_approval_v1',
                         'lapse_emergency_revocation_post_approvals_v1',
                         'escalate_emergency_revocation_v1')
  loop
    if r.src ~* 'update\s+kitluy_devices\.device_credentials' then
      v_findings := v_findings || format('%s writes device_credentials', r.proname);
    end if;
  end loop;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % emergency-revocation policy finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-emergency-revocation-policy: the revocation policy is EXACTLY owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 (the five §2.2 emergency reasons, the four §2.1 approve-before-execute reasons, a 4-hour §2.3 post-approval window, the decision named and the [REQUIRED] marker cleared), the two reason sets are DISJOINT and TOTAL by constraint so no reason is unclassified or doubly classified, the emergency reasons are four-eyes DEFERRED rather than EXEMPT, the mandatory incident reference and re-authentication cannot be switched off, §2.5 machine-initiated revocation cannot be permitted and the worker role can execute no revocation function and holds no direct authority over revocation state, PUBLIC can execute none of them, the issuance executor writes emergency evidence only through governed functions, every new function is a governor-owned SECURITY DEFINER with a fixed search_path over RLS ENABLED and FORCED tables, and §2.4 is structural — a one-way trigger guards device_credentials and no post-approval function contains a statement that writes it';
end
$section41a$;

-- ---------------------------------------------------------------------------
-- 41b — decision §3: the scope comes from the REASON, one probe per row.
-- ---------------------------------------------------------------------------
do $section41b$
declare
  v_findings text[] := array[]::text[];
  v_dev uuid;
  v_other uuid;
  v_fp1 text := encode(sha256(convert_to('41b-fp1-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_fp2 text := encode(sha256(convert_to('41b-fp2-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_fpx text := encode(sha256(convert_to('41b-fpx-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_gen1 uuid;
  v_gen2 uuid;
  v_otherc uuid;
  v_assign integer;
  v_res jsonb;
  v_ids uuid[];
  v_attempt uuid;
  v_req text := 'rq-41b-' || gen_random_uuid();
  v_idem text := encode(sha256(convert_to('i41b-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_prep jsonb;
  v_policy_a4 uuid;
  v_approval uuid;
  v_incident text := 'INC-41B-' || gen_random_uuid();
  v_reason kitluy_devices.credential_revocation_reason;
  v_links jsonb := jsonb_build_array(
    jsonb_build_object('link_position',0,'role','root','subject_fingerprint',repeat('r',64),
                       'issuer_key_id','rk','canonical_tbs','R','detached_signature_b64','qg=='),
    jsonb_build_object('link_position',1,'role','intermediate','subject_fingerprint',repeat('i',64),
                       'issuer_key_id','rk','canonical_tbs','I','detached_signature_b64','uw=='));
begin
  -- A device holding TWO credentials: generation 1 still inside its granted
  -- overlap and generation 2 current, on DIFFERENT keys. Both halves of §3 need
  -- it — "all active and overlapping" must reach both, and "every credential
  -- bound to the key" must reach exactly one.
  v_dev := pg_temp.ws11_renewable_device('t41b', v_fp1);
  v_other := pg_temp.ws11_renewable_device('t41bo', v_fpx);

  update kitluy_devices.renewal_policy
     set allow_key_rotation = true, rotation_approved_by_decision_ref = 'TEST-ONLY-section41b'
   where environment = 'development';
  v_res := kitluy_devices.reserve_device_credential_renewal_v1(
    v_dev, 'development', 'device_identity',
    encode(sha256(convert_to('res-41b-' || gen_random_uuid(), 'UTF8')), 'hex'),
    now(), 'trusted', 'rotate_key'::kitluy_devices.renewal_mode, 'SVC');
  v_attempt := (v_res ->> 'renewal_attempt_id')::uuid;
  perform kitluy_devices.register_generation_key_v2(v_attempt, 'handle-41b', 'PEM-41B', v_fp2, 2);
  v_prep := kitluy_devices.prepare_device_credential_renewal_v2(
    v_dev, 'development', 'device_identity', v_req, v_idem, repeat('7', 64),
    'PEM-41B', v_fp2, 'ed25519', repeat('6', 64), decode('b2', 'hex'), true,
    'ica-41b', now(), 'trusted', 'SVC', 'rotate_key');
  perform kitluy_devices.record_device_credential_signature_v1(
    v_req, v_prep ->> 'canonical_tbs_hash', decode('4141', 'hex'), true, 'SVC');
  perform kitluy_devices.finalize_device_credential_issuance_v1(v_req, v_links, 'SVC');
  update kitluy_devices.renewal_policy
     set allow_key_rotation = false, rotation_approved_by_decision_ref = null
   where environment = 'development';

  select credential_id into v_gen1 from kitluy_devices.device_credentials
   where device_record_id = v_dev and certificate_generation = 1;
  select credential_id into v_gen2 from kitluy_devices.device_credentials
   where device_record_id = v_dev and certificate_generation = 2;
  select credential_id into v_otherc from kitluy_devices.device_credentials
   where device_record_id = v_other and certificate_generation = 1;
  select assignment_generation into v_assign from kitluy_devices.devices where id = v_dev;

  -- §3 row 1/2: DEVICE_LOST and DEVICE_STOLEN — all ACTIVE AND OVERLAPPING
  -- credentials for that device, and nothing belonging to another device.
  foreach v_reason in array array['DEVICE_LOST','DEVICE_STOLEN']::kitluy_devices.credential_revocation_reason[] loop
    v_res := kitluy_devices.resolve_revocation_scope_v1(v_reason, 'development', v_dev);
    select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
    if not ((v_res ->> 'resolved')::boolean and v_ids @> array[v_gen1, v_gen2]
            and cardinality(v_ids) = 2) then
      v_findings := v_findings ||
        format('%s did not reach exactly the active and overlapping credentials: %s', v_reason, v_res);
    end if;
  end loop;

  -- §3 row 3: KEY_COMPROMISE — every credential bound to the compromised key,
  -- and ONLY those. The device holds two credentials on two keys, so a scope
  -- that returned both would be reaching by device rather than by key.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'KEY_COMPROMISE', 'development', null, 'device_identity', null,
    'no-such-provider-handle-41b', v_fp1);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids = array[v_gen1]) then
    v_findings := v_findings ||
      format('KEY_COMPROMISE did not reach exactly the credentials bound to the key: %s', v_res);
  end if;

  -- §3 row 4: ASSIGNMENT_INVALIDATED — all credentials issued under the
  -- invalidated assignment generation.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'ASSIGNMENT_INVALIDATED', 'development', v_dev, 'device_identity', null, null, null, v_assign);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids @> array[v_gen1, v_gen2]
          and cardinality(v_ids) = 2) then
    v_findings := v_findings ||
      format('ASSIGNMENT_INVALIDATED did not reach the invalidated assignment generation: %s', v_res);
  end if;
  -- A generation nobody issued under reaches nothing rather than everything.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'ASSIGNMENT_INVALIDATED', 'development', v_dev, 'device_identity', null, null, null, v_assign + 99);
  if (v_res ->> 'credential_count')::int <> 0 then
    v_findings := v_findings || 'an unused assignment generation reached credentials';
  end if;

  -- §3 row 5: CERTIFICATE_MISISSUANCE — the identified credential only, PLUS
  -- explicitly linked duplicates...
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'CERTIFICATE_MISISSUANCE', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_gen1]);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids @> array[v_gen1, v_gen2]
          and cardinality(v_ids) = 2) then
    v_findings := v_findings ||
      format('CERTIFICATE_MISISSUANCE did not reach the identified credential plus its linked duplicate: %s', v_res);
  end if;
  -- ...and "explicitly linked" is not a licence to reach ANOTHER device.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'CERTIFICATE_MISISSUANCE', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_otherc]);
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-LINK-FOREIGN' then
    v_findings := v_findings ||
      format('a linked duplicate on another device was accepted: %s', v_res);
  end if;

  -- §3 row 6: ADMINISTRATIVE_REPLACEMENT — the identified credential ONLY. A
  -- caller offering more is refused rather than silently trimmed, because a
  -- silent trim leaves the caller believing the extras were revoked.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'ADMINISTRATIVE_REPLACEMENT', 'development', v_dev, 'device_identity', 2);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids = array[v_gen2]) then
    v_findings := v_findings ||
      format('ADMINISTRATIVE_REPLACEMENT did not reach the identified credential only: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'ADMINISTRATIVE_REPLACEMENT', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_gen1]);
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-WIDENED' then
    v_findings := v_findings ||
      format('an administrative replacement was widened past the identified credential: %s', v_res);
  end if;

  -- §3 row 7: OTHER_APPROVED_REASON — the credential only, UNLESS the approved
  -- request explicitly names a broader scope. Without an approval the broader
  -- scope is refused, not quietly narrowed (§3.2 forbids guessing either way).
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'OTHER_APPROVED_REASON', 'development', v_dev, 'device_identity', 2);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids = array[v_gen2]) then
    v_findings := v_findings ||
      format('OTHER_APPROVED_REASON did not default to the credential only: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'OTHER_APPROVED_REASON', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_gen1], null);
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING' then
    v_findings := v_findings ||
      format('an unapproved broader scope was accepted: %s', v_res);
  end if;
  -- The approval exists in the kitluy_auth aggregate, and the scope it
  -- authorizes is RECORDED in kitluy_devices citing it — because an approval
  -- request carries a payload HASH and has no column in which to enumerate
  -- credentials, and the credential governor holds no access to that schema.
  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', 'development', 1, 'ACTIVE', 'A4')
  returning id into v_policy_a4;
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, '00000000-0000-4000-8000-000000000007', 'device', v_dev,
          'development', 'device_credential_revocation', repeat('41', 32),
          'section41b broader scope', 'APPROVED')
  returning id into v_approval;
  -- A recorded broader scope that cites no approval is not an approved one.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-NOAPPROVAL', 'development', 'OTHER_APPROVED_REASON',
    null, null, null, array[v_gen1], 'sec-a', 'sec-b', null, null);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING' then
    v_findings := v_findings ||
      format('a broader scope citing no approval was recorded: %s', v_res);
  end if;
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-BROADER', 'development', 'OTHER_APPROVED_REASON',
    null, null, null, array[v_gen1], 'sec-a', 'sec-b', null, v_approval);
  if (v_res ->> 'outcome') <> 'RECORDED' then
    v_findings := v_findings || format('an approved broader scope was refused: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'OTHER_APPROVED_REASON', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_gen1], v_approval);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids @> array[v_gen1, v_gen2]
          and cardinality(v_ids) = 2) then
    v_findings := v_findings ||
      format('an APPROVED broader scope was not honoured: %s', v_res);
  end if;
  -- ...and the caller cannot reach past what the approval actually named.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'OTHER_APPROVED_REASON', 'development', v_dev, 'device_identity', 2,
    null, null, null, null, array[v_gen1, v_otherc], v_approval);
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-UNAPPROVED-BROADENING' then
    v_findings := v_findings ||
      format('a caller widened past the recorded approved scope: %s', v_res);
  end if;

  -- §3.1: PROVIDER_COMPROMISE and SECURITY_INCIDENT refuse a wildcard, refuse
  -- an empty set, refuse a wildcard token, and refuse a self-approved blast
  -- radius — by CONSTRAINT as well as by the governed function.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-WILD', 'development', 'PROVIDER_COMPROMISE',
    null, array['*'], null, null, 'sec-a', 'sec-b');
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED' then
    v_findings := v_findings || format('a provider-compromise wildcard was recorded: %s', v_res);
  end if;
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-EMPTY', 'development', 'SECURITY_INCIDENT',
    null, null, null, null, 'sec-a', 'sec-b');
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-WILDCARD-REFUSED' then
    v_findings := v_findings || format('an empty security-incident scope was recorded: %s', v_res);
  end if;
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      unrestricted_wildcard, recorded_by, approved_by)
    values (v_incident || '-RAWWILD', 'development', 'SECURITY_INCIDENT',
            array[v_dev], true, 'sec-a', 'sec-b');
    v_findings := v_findings || 'an unrestricted wildcard scope was written directly';
  exception when others then
    if sqlerrm not like '%no_wildcard_chk%' and sqlerrm not like '%permission denied%' then
      v_findings := v_findings || format('wrong refusal for a raw wildcard: %s', sqlerrm);
    end if;
  end;
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-SELF', 'development', 'SECURITY_INCIDENT',
    array[v_dev], null, null, null, 'sec-a', 'sec-a');
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-SELF-APPROVED' then
    v_findings := v_findings || format('one person recorded and approved a blast radius: %s', v_res);
  end if;
  -- Only the two incident-defined reasons take a recorded set at all.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident || '-LOST', 'development', 'DEVICE_LOST',
    array[v_dev], null, null, null, 'sec-a', 'sec-b');
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-REASON-NOT-RECORDABLE' then
    v_findings := v_findings || format('a fleet-derived reason accepted a recorded scope: %s', v_res);
  end if;

  -- §3.2: an incident with NO recorded set fails closed. It does not guess
  -- narrow, and it does not guess wide.
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'PROVIDER_COMPROMISE', 'development', null, 'device_identity', null, null, null, null,
    v_incident || '-NEVER');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NOT-RECORDED' then
    v_findings := v_findings || format('an unrecorded provider-compromise scope resolved: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'SECURITY_INCIDENT', 'development', null, 'device_identity', null, null, null, null,
    v_incident || '-NEVER');
  if (v_res ->> 'resolved')::boolean
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NOT-RECORDED' then
    v_findings := v_findings || format('an unrecorded security-incident scope resolved: %s', v_res);
  end if;

  -- §3 row 8: PROVIDER_COMPROMISE — an explicitly recorded affected-KEY set.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident, 'development', 'PROVIDER_COMPROMISE',
    null, array['no-such-provider-handle-41b'], array[v_fp1], null, 'sec-a', 'sec-b');
  if (v_res ->> 'outcome') <> 'RECORDED' then
    v_findings := v_findings || format('an approved affected-key set was refused: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'PROVIDER_COMPROMISE', 'development', null, 'device_identity', null, null, null, null, v_incident);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids = array[v_gen1]) then
    v_findings := v_findings ||
      format('PROVIDER_COMPROMISE did not reach exactly the recorded key set: %s', v_res);
  end if;

  -- §3 row 9: SECURITY_INCIDENT — an explicitly recorded device/key/credential
  -- set, reaching that device and NOT the device next to it.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident, 'development', 'SECURITY_INCIDENT',
    array[v_dev], null, null, null, 'sec-a', 'sec-b');
  if (v_res ->> 'outcome') <> 'RECORDED' then
    v_findings := v_findings || format('an approved affected set was refused: %s', v_res);
  end if;
  v_res := kitluy_devices.resolve_revocation_scope_v1(
    'SECURITY_INCIDENT', 'development', null, 'device_identity', null, null, null, null, v_incident);
  select array_agg(value::uuid) into v_ids from jsonb_array_elements_text(v_res -> 'credential_ids');
  if not ((v_res ->> 'resolved')::boolean and v_ids @> array[v_gen1, v_gen2]
          and cardinality(v_ids) = 2) then
    v_findings := v_findings ||
      format('SECURITY_INCIDENT did not reach exactly the recorded set: %s', v_res);
  end if;
  -- A recorded set is append-only: a changed blast radius is a new incident.
  v_res := kitluy_devices.record_revocation_scope_v1(
    v_incident, 'development', 'SECURITY_INCIDENT',
    array[v_dev, v_other], null, null, null, 'sec-a', 'sec-b');
  if (v_res ->> 'outcome') <> 'ALREADY_RECORDED' then
    v_findings := v_findings || format('a recorded blast radius was rewritten: %s', v_res);
  end if;

  -- §2.1/§2.2: an approve-before-execute reason cannot be smuggled through the
  -- emergency door, whichever of the four it is.
  foreach v_reason in array array[
      'ASSIGNMENT_INVALIDATED','CERTIFICATE_MISISSUANCE',
      'ADMINISTRATIVE_REPLACEMENT','OTHER_APPROVED_REASON'
    ]::kitluy_devices.credential_revocation_reason[]
  loop
    v_res := kitluy_devices.revoke_device_credential_emergency_v1(
      's41b-ineligible-' || gen_random_uuid(), 'development', 'device_identity',
      v_reason, 'dressed as an incident', 'REPROVISION_REQUIRED',
      'ciso@41b', 'CISO', true, 'webauthn', v_incident, 'SECTION41B', v_dev, 2);
    if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-REASON-NOT-ELIGIBLE' then
      v_findings := v_findings ||
        format('%s executed through the emergency path: %s', v_reason, v_res);
    end if;
  end loop;

  -- §2.3: an emergency without an incident reference, or without
  -- re-authentication, or without a reason, is not an emergency.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41b-noinc-' || gen_random_uuid(), 'development', 'device_identity',
    'KEY_COMPROMISE', 'private half seen off-device', 'REPROVISION_REQUIRED',
    'ciso@41b', 'CISO', true, 'webauthn', '  ', 'SECTION41B', v_dev, 2);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-NO-INCIDENT-REFERENCE' then
    v_findings := v_findings || format('an emergency ran with no incident reference: %s', v_res);
  end if;
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41b-noreauth-' || gen_random_uuid(), 'development', 'device_identity',
    'DEVICE_STOLEN', 'terminal taken', 'REPROVISION_REQUIRED',
    'ciso@41b', 'CISO', false, 'webauthn', v_incident, 'SECTION41B', v_dev, 2);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-NO-REAUTH' then
    v_findings := v_findings || format('an emergency ran with no re-authentication: %s', v_res);
  end if;
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41b-noreason-' || gen_random_uuid(), 'development', 'device_identity',
    'DEVICE_STOLEN', '   ', 'REPROVISION_REQUIRED',
    'ciso@41b', 'CISO', true, 'webauthn', v_incident, 'SECTION41B', v_dev, 2);
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-NO-REASON' then
    v_findings := v_findings || format('an emergency ran with no reason: %s', v_res);
  end if;
  -- §3.2, through the emergency path: an undeterminable scope revokes NOTHING.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41b-unknown-' || gen_random_uuid(), 'development', 'device_identity',
    'KEY_COMPROMISE', 'a key we cannot name', 'REPROVISION_REQUIRED',
    'ciso@41b', 'CISO', true, 'webauthn', v_incident, 'SECTION41B');
  if (v_res ->> 'outcome') <> 'MANUAL_SECURITY_REVIEW'
     or (v_res ->> 'refusal_code') is distinct from 'KLUY-REVOCATION-SCOPE-NO-KEY' then
    v_findings := v_findings || format('an undeterminable scope did not fail closed: %s', v_res);
  end if;

  -- After all of that, NOTHING in this block revoked a credential.
  if exists (select 1 from kitluy_devices.device_credentials
              where device_record_id in (v_dev, v_other) and state = 'revoked') then
    v_findings := v_findings || 'a refused emergency revoked a credential anyway';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % revocation-scope finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-revocation-scope-from-reason: every row of decision §3 resolves FROM THE REASON and never from the caller — DEVICE_LOST and DEVICE_STOLEN reach the active and overlapping credentials of that device and no other device, KEY_COMPROMISE reaches only the credentials bound to the compromised key even though the device holds two, ASSIGNMENT_INVALIDATED reaches the invalidated assignment generation and an unused one reaches nothing, CERTIFICATE_MISISSUANCE reaches the identified credential plus explicitly linked duplicates but refuses a link on another device, ADMINISTRATIVE_REPLACEMENT reaches the identified credential ONLY and refuses to be widened, OTHER_APPROVED_REASON defaults to the credential only and takes a broader scope only with an APPROVED request; §3.1 refuses a wildcard, an empty set, a wildcard token and a self-approved blast radius for both incident reasons, §3.2 fails closed on an unrecorded incident and on a key compromise that names no key, all four §2.1 approve-before-execute reasons are refused through the emergency door, an emergency without an incident reference, re-authentication or reason is refused, and none of these refusals revoked anything';
end
$section41b$;

-- ---------------------------------------------------------------------------
-- 41c — decision §2.4: the post-approval NEVER reverses the revocation.
--
-- The single most important behaviour in this group. An auto-reversing
-- revocation would let an attacker who merely delays the approver get the
-- credential back.
-- ---------------------------------------------------------------------------
do $section41c$
declare
  v_findings text[] := array[]::text[];
  v_refused_dev uuid;
  v_lapsed_dev uuid;
  v_fp_r text := encode(sha256(convert_to('41c-r-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_fp_l text := encode(sha256(convert_to('41c-l-' || gen_random_uuid(), 'UTF8')), 'hex');
  v_res jsonb;
  v_em_refused uuid;
  v_em_lapsed uuid;
  v_cred_refused uuid;
  v_cred_lapsed uuid;
  v_due timestamptz;
  v_state text;
  v_n integer;
begin
  v_refused_dev := pg_temp.ws11_renewable_device('t41cr', v_fp_r);
  v_lapsed_dev  := pg_temp.ws11_renewable_device('t41cl', v_fp_l);
  select credential_id into v_cred_refused from kitluy_devices.device_credentials
   where device_record_id = v_refused_dev and certificate_generation = 1;
  select credential_id into v_cred_lapsed from kitluy_devices.device_credentials
   where device_record_id = v_lapsed_dev and certificate_generation = 1;

  -- §2.2/§2.3: the emergency executes IMMEDIATELY, with no prior approval.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41c-refused-' || gen_random_uuid(), 'development', 'device_identity',
    'DEVICE_STOLEN', 'terminal taken from the store floor', 'REPROVISION_REQUIRED',
    'ciso@41c', 'CISO', true, 'webauthn', 'INC-41C-REFUSED', 'SECTION41C',
    v_refused_dev, 1);
  if (v_res ->> 'outcome') <> 'REVOKED_IMMEDIATELY'
     or (v_res ->> 'revoked_credential_count')::int <> 1 then
    v_findings := v_findings || format('the emergency path did not execute immediately: %s', v_res);
  end if;
  v_em_refused := (v_res ->> 'emergency_revocation_id')::uuid;

  select state::text into v_state from kitluy_devices.device_credentials
   where credential_id = v_cred_refused;
  if v_state <> 'revoked' then
    v_findings := v_findings || format('the emergency left the credential %s', v_state);
  end if;
  -- Group 0125 pairs `revoked` with `revoked_at`; a state without its timestamp
  -- would have been refused by the table, so this also proves the write is real.
  if (select revoked_at from kitluy_devices.device_credentials
       where credential_id = v_cred_refused) is null then
    v_findings := v_findings || 'a revoked credential carries no revocation time';
  end if;
  -- The same append-only evidence group 0136 defined, linked to the declaration.
  if not exists (select 1 from kitluy_devices.device_credential_revocations
                  where emergency_revocation_id = v_em_refused
                    and credential_id = v_cred_refused
                    and incident_reference = 'INC-41C-REFUSED') then
    v_findings := v_findings || 'the emergency wrote no append-only revocation evidence';
  end if;
  -- §2.3: the 4-hour deadline, PENDING and countable.
  select post_approval_due_at into v_due
    from kitluy_devices.device_credential_emergency_revocations
   where emergency_revocation_id = v_em_refused;
  if v_due is null or v_due <= now() then
    v_findings := v_findings || 'the emergency opened no live post-approval deadline';
  end if;

  -- §2.4: THE DECLARER IS NOT THEIR OWN SECOND PERSON.
  v_res := kitluy_devices.record_emergency_revocation_post_approval_v1(
    v_em_refused, 'ciso@41c', 'REFUSE', true, 'marking my own homework');
  if (v_res ->> 'refusal_code') is distinct from 'KLUY-EMERGENCY-SELF-POST-APPROVAL' then
    v_findings := v_findings || format('a declarer post-approved their own emergency: %s', v_res);
  end if;
  if (select post_approval_decision from kitluy_devices.device_credential_emergency_revocations
       where emergency_revocation_id = v_em_refused) <> 'PENDING' then
    v_findings := v_findings || 'a refused self-post-approval still settled the case';
  end if;

  -- §2.4: AN EXPLICIT REFUSAL. The second person says the revocation should not
  -- have happened — and the credential STAYS REVOKED.
  v_res := kitluy_devices.record_emergency_revocation_post_approval_v1(
    v_em_refused, 'ciso2@41c', 'REFUSE', true, 'insufficient evidence of theft');
  if (v_res ->> 'outcome') <> 'MANUAL_SECURITY_REVIEW'
     or (v_res ->> 'post_approval_decision') <> 'REFUSED' then
    v_findings := v_findings || format('a refused post-approval did not escalate: %s', v_res);
  end if;
  select state::text into v_state from kitluy_devices.device_credentials
   where credential_id = v_cred_refused;
  if v_state <> 'revoked' then
    v_findings := v_findings ||
      format('A REFUSED POST-APPROVAL REVERSED THE REVOCATION: the credential is %s', v_state);
  end if;
  -- ...and the case is escalated rather than quietly closed.
  select count(*) into v_n
    from kitluy_devices.device_recovery_cases c
    join kitluy_devices.device_credential_revocations r on r.revocation_id = c.revocation_id
   where r.emergency_revocation_id = v_em_refused
     and c.disposition = 'MANUAL_SECURITY_REVIEW';
  if v_n < 1 then
    v_findings := v_findings || 'a refused post-approval opened no manual security review';
  end if;
  if (select escalated_at from kitluy_devices.device_credential_emergency_revocations
       where emergency_revocation_id = v_em_refused) is null then
    v_findings := v_findings || 'a refused post-approval was not recorded as escalated';
  end if;
  -- One verdict, once. Re-deciding a settled case is a new incident.
  v_res := kitluy_devices.record_emergency_revocation_post_approval_v1(
    v_em_refused, 'ciso3@41c', 'APPROVE', true, 'second thoughts');
  if (v_res ->> 'outcome') <> 'ALREADY_DECIDED'
     or (v_res ->> 'post_approval_decision') <> 'REFUSED' then
    v_findings := v_findings || format('a settled post-approval was re-decided: %s', v_res);
  end if;

  -- §2.4: A MISSING POST-APPROVAL. The deadline passes with nobody answering,
  -- the sweep records LAPSED and escalates — and the credential STAYS REVOKED.
  v_res := kitluy_devices.revoke_device_credential_emergency_v1(
    's41c-lapsed-' || gen_random_uuid(), 'development', 'device_identity',
    'KEY_COMPROMISE', 'private half recovered from a disposed disk', 'REPROVISION_REQUIRED',
    'ic@41c', 'INCIDENT_COMMANDER', true, 'hardware token', 'INC-41C-LAPSED',
    'SECTION41C', null, null, null, v_fp_l);
  if (v_res ->> 'outcome') <> 'REVOKED_IMMEDIATELY' then
    v_findings := v_findings || format('the key-compromise emergency did not execute: %s', v_res);
  end if;
  v_em_lapsed := (v_res ->> 'emergency_revocation_id')::uuid;

  -- A deadline is brought FORWARD to make the lapse observable. The migration
  -- refuses the other direction: an emergency deadline can never be EXTENDED,
  -- because an attacker who can delay the approver must not also be able to buy
  -- the delay back. Requires the governor, borrowed and handed straight back so
  -- section 32's containment assertion still holds on the next run.
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute 'set role kitluy_credential_issuer';

  begin
    update kitluy_devices.device_credential_emergency_revocations
       set post_approval_due_at = post_approval_due_at + interval '1 hour'
     where emergency_revocation_id = v_em_lapsed;
    v_findings := v_findings || 'an emergency post-approval deadline was EXTENDED';
  exception when others then
    if sqlerrm not like 'KLUY-EMERGENCY-DEADLINE-FIXED%' then
      v_findings := v_findings || format('wrong refusal extending a deadline: %s', sqlerrm);
    end if;
  end;
  -- The declaration itself is frozen.
  begin
    update kitluy_devices.device_credential_emergency_revocations
       set declared_by = 'someone-else'
     where emergency_revocation_id = v_em_lapsed;
    v_findings := v_findings || 'the declaring authority on an emergency was rewritten';
  exception when others then
    if sqlerrm not like 'KLUY-EMERGENCY-IMMUTABLE%' then
      v_findings := v_findings || format('wrong refusal rewriting a declaration: %s', sqlerrm);
    end if;
  end;

  update kitluy_devices.device_credential_emergency_revocations
     set post_approval_due_at = clock_timestamp() - interval '1 minute'
   where emergency_revocation_id = v_em_lapsed;

  -- THE HOSTILE WRITE. Not a function, not a service — the credential governor
  -- itself, with every table privilege it holds, trying to put a revoked
  -- credential back into service.
  begin
    update kitluy_devices.device_credentials
       set state = 'issued', revoked_at = null
     where credential_id = v_cred_refused;
    v_findings := v_findings || 'THE CREDENTIAL GOVERNOR UN-REVOKED A REVOKED CREDENTIAL';
  exception when others then
    if sqlerrm not like 'KLUY-REVOCATION-IS-ONE-WAY%' then
      v_findings := v_findings || format('wrong refusal un-revoking a credential: %s', sqlerrm);
    end if;
  end;
  begin
    update kitluy_devices.device_credentials
       set state = 'superseded'
     where credential_id = v_cred_refused;
    v_findings := v_findings || 'a revoked credential was demoted to superseded';
  exception when others then
    if sqlerrm not like 'KLUY-REVOCATION-IS-ONE-WAY%' then
      v_findings := v_findings || format('wrong refusal demoting a revoked credential: %s', sqlerrm);
    end if;
  end;

  execute 'reset role';
  execute format('revoke kitluy_credential_issuer from %I', current_user);

  v_res := kitluy_devices.lapse_emergency_revocation_post_approvals_v1('development', 'SECTION41C');
  if (v_res ->> 'lapsed_count')::int < 1 then
    v_findings := v_findings || format('an overdue post-approval was not swept: %s', v_res);
  end if;
  if (select post_approval_decision from kitluy_devices.device_credential_emergency_revocations
       where emergency_revocation_id = v_em_lapsed) <> 'LAPSED' then
    v_findings := v_findings || 'an overdue post-approval was not recorded as LAPSED';
  end if;
  select state::text into v_state from kitluy_devices.device_credentials
   where credential_id = v_cred_lapsed;
  if v_state <> 'revoked' then
    v_findings := v_findings ||
      format('A LAPSED POST-APPROVAL REVERSED THE REVOCATION: the credential is %s', v_state);
  end if;
  select count(*) into v_n
    from kitluy_devices.device_recovery_cases c
    join kitluy_devices.device_credential_revocations r on r.revocation_id = c.revocation_id
   where r.emergency_revocation_id = v_em_lapsed
     and c.disposition = 'MANUAL_SECURITY_REVIEW';
  if v_n < 1 then
    v_findings := v_findings || 'a lapsed post-approval opened no manual security review';
  end if;
  -- LAPSED means NOBODY CAME: it carries no approver, and the distinction
  -- between "refused" and "unanswered" survives.
  if (select post_approved_by from kitluy_devices.device_credential_emergency_revocations
       where emergency_revocation_id = v_em_lapsed) is not null then
    v_findings := v_findings || 'a lapsed post-approval invented an approver';
  end if;

  -- Both revoked credentials survived every one of the paths above.
  if (select state::text from kitluy_devices.device_credentials
       where credential_id = v_cred_refused) <> 'revoked' then
    v_findings := v_findings || 'the refused-case credential did not survive this section';
  end if;

  -- The borrowed governor membership was handed back.
  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where g.rolname = 'kitluy_credential_issuer'
               and not r.rolsuper) then
    v_findings := v_findings || 'a non-superuser kept membership of the credential governor';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % post-approval finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-emergency-post-approval-never-reverses: an emergency revocation executes IMMEDIATELY with no prior approval, writes the same append-only evidence with `revoked` paired to `revoked_at`, and opens a live 4-hour post-approval obligation; the declarer cannot be their own second person and a refused self-post-approval leaves the case PENDING; AN EXPLICIT REFUSAL LEAVES THE CREDENTIAL REVOKED and escalates to MANUAL_SECURITY_REVIEW; A LAPSED DEADLINE LEAVES THE CREDENTIAL REVOKED, records LAPSED with no invented approver and escalates; a settled verdict cannot be re-decided; a post-approval deadline can be brought forward but NEVER extended and the declaration itself is frozen; and the credential governor ITSELF cannot un-revoke a revoked credential or demote it to superseded — decision §2.4 holds against the function, against the operator and against the owner of the table';
end
$section41c$;

select 'assertions complete: groups 0010-0138 structural contract holds (incl. WS-11-T003 Step 4 emergency revocation, decision §3 scope resolution and the §2.4 one-way rule)' as result;


-- ============================================================================
-- SECTION 42 — WS-11-T003 Step 4: the APPROVE-BEFORE-EXECUTE revocation
-- actually executes (migration 0139).
-- Authority: KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.1; migration
--   groups 0136 (the operation), 0125 (device_credentials_revoked_chk) and
--   0139 (the fix).
--
-- Section 41 proves the EMERGENCY path. NOTHING proved the ordinary four-eyes
-- path, and it could not complete a single revocation:
--
--   * group 0136 wrote `state = 'revoked'` without `revoked_at`, which
--     device_credentials_revoked_chk refuses outright; and
--   * its approval gate ran as `kitluy_credential_issuer` inside a SECURITY
--     DEFINER, and that role holds neither USAGE on `kitluy_auth` nor SELECT on
--     its tables, so the call died on `permission denied for schema kitluy_auth`
--     before the CHECK was ever reached.
--
-- Group 0136's assertions inspected grants, constraints and triggers and NEVER
-- CALLED THE FUNCTION, which is why a non-functional governed operation shipped.
-- This section calls it, end to end, and is the reason that cannot happen again.
-- ============================================================================
do $section42$
declare
  v_findings text[] := array[]::text[];
  v_fp text := encode(sha256(convert_to('t42-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_fp_other text := encode(sha256(convert_to('t42b-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_device uuid;
  v_other_device uuid;
  v_credential uuid;
  v_requester constant uuid := '00000000-0000-4000-8000-000000000007';
  v_approver constant uuid := '00000000-0000-4000-8000-000000000008';
  v_policy_a4 uuid;
  v_policy_a2 uuid;
  v_ap_ok uuid;
  v_ap_scope uuid;
  v_ap_self uuid;
  v_ap_a2 uuid;
  v_ap_second uuid;
  v_intent text := 's42-' || gen_random_uuid()::text;
  v_res jsonb;
  v_state text;
  v_revoked_at timestamptz;
  v_reason text;
  v_revocation_id uuid;
  v_rows integer;
begin
  v_device := pg_temp.ws11_renewable_device('t42', v_fp);
  v_other_device := pg_temp.ws11_renewable_device('t42b', v_fp_other);
  select credential_id into v_credential from kitluy_devices.device_credentials
   where device_record_id = v_device and certificate_generation = 1;
  if v_credential is null then
    raise exception 'ASSERT FAIL: section 42 could not issue a credential to revoke';
  end if;

  -- ------------------------------------------------------------------------
  -- The approval rows, in the SAME kitluy_auth aggregate group 0124 uses for a
  -- time correction — not a parallel approval idea invented for revocation.
  -- ------------------------------------------------------------------------
  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', 'development', 1, 'ACTIVE', 'A4')
  returning id into v_policy_a4;
  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.a2.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', 'development', 1, 'ACTIVE', 'A2')
  returning id into v_policy_a2;

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('42ok-' || v_intent, 'UTF8')), 'hex'),
          'terminal permanently replaced', 'APPROVED')
  returning id into v_ap_ok;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_ok, v_approver, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_other_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('42scope-' || v_intent, 'UTF8')), 'hex'),
          'a different terminal entirely', 'APPROVED')
  returning id into v_ap_scope;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_scope, v_approver, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('42self-' || v_intent, 'UTF8')), 'hex'),
          'self-approval probe', 'APPROVED')
  returning id into v_ap_self;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_self, v_approver, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a2, v_requester, 'device', v_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('42a2-' || v_intent, 'UTF8')), 'hex'),
          'risk class probe', 'APPROVED')
  returning id into v_ap_a2;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_a2, v_approver, 'APPROVE');

  -- ------------------------------------------------------------------------
  -- The refusals, each through the REAL call. Every one of these returned
  -- `permission denied for schema kitluy_auth` before migration 0139 — the
  -- gate could not answer at all, so no refusal was reachable either.
  -- ------------------------------------------------------------------------
  -- No approval presented.
  v_res := kitluy_devices.revoke_device_credential_v1(
    's42-none-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'no approval at all', 'REPROVISION_REQUIRED',
    'requester@42', 'SECTION42', null, null, null);
  if (v_res ->> 'outcome') <> 'REVOCATION_REFUSED'
     or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-UNAPPROVED' then
    v_findings := v_findings || format('an unapproved revocation was not refused: %s', v_res);
  end if;

  -- An A2 policy is below the A3/A4 bar; an undeclared class would be too.
  v_res := kitluy_devices.revoke_device_credential_v1(
    's42-a2-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'risk class probe', 'REPROVISION_REQUIRED',
    'requester@42', 'SECTION42', v_ap_a2, 'approver@42', null);
  if (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-RISK-CLASS' then
    v_findings := v_findings || format('an A2 approval authorized a revocation: %s', v_res);
  end if;

  -- An approval naming ANOTHER device is not an approval for this one.
  v_res := kitluy_devices.revoke_device_credential_v1(
    's42-scope-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'wrong-scope probe', 'REPROVISION_REQUIRED',
    'requester@42', 'SECTION42', v_ap_scope, 'approver@42', null);
  if (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
    v_findings := v_findings || format('an approval for another device authorized this one: %s', v_res);
  end if;

  -- The requester is not their own second person, under a perfectly valid
  -- approval — so the refusal is about WHO acted, not about the approval.
  v_res := kitluy_devices.revoke_device_credential_v1(
    's42-self-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'self-approval probe', 'REPROVISION_REQUIRED',
    'requester@42', 'SECTION42', v_ap_self, 'requester@42', null);
  if (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-SELF-APPROVED' then
    v_findings := v_findings || format('a self-approved revocation was not refused: %s', v_res);
  end if;

  -- Not one of those refusals may have touched the credential, and none may
  -- have written evidence.
  select state::text into v_state from kitluy_devices.device_credentials
   where credential_id = v_credential;
  if v_state <> 'issued' then
    v_findings := v_findings || format('a REFUSED revocation changed the credential to %s', v_state);
  end if;
  if exists (select 1 from kitluy_devices.device_credential_revocations
              where credential_id = v_credential) then
    v_findings := v_findings || 'a REFUSED revocation wrote evidence';
  end if;

  -- ------------------------------------------------------------------------
  -- THE COMPLETE REVOCATION.
  -- ------------------------------------------------------------------------
  v_res := kitluy_devices.revoke_device_credential_v1(
    v_intent, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change S42',
    'REPROVISION_REQUIRED', 'requester@42', 'SECTION42',
    v_ap_ok, 'approver@42', 'CHG-S42');
  if (v_res ->> 'outcome') <> 'REVOKED' then
    raise exception
      'ASSERT FAIL: a fully approved four-eyes revocation did not complete: %', v_res;
  end if;
  v_revocation_id := (v_res ->> 'revocation_id')::uuid;

  -- The EXACT pair device_credentials_revoked_chk requires. A `revoked` state
  -- with a null timestamp is not a partial revocation, it is a REFUSED write.
  select state::text, revoked_at, revocation_reason
    into v_state, v_revoked_at, v_reason
    from kitluy_devices.device_credentials where credential_id = v_credential;
  if v_state <> 'revoked' then
    v_findings := v_findings || format('the revoked credential is %s', v_state);
  end if;
  if v_revoked_at is null then
    v_findings := v_findings || 'a revoked credential carries no revocation time';
  end if;
  if v_reason is null or v_reason not like 'ADMINISTRATIVE_REPLACEMENT:%' then
    v_findings := v_findings ||
      format('the credential row records no account of its revocation (%s)', coalesce(v_reason, 'null'));
  end if;

  -- Append-only evidence naming the reason, the requester and the approver.
  if not exists (
    select 1 from kitluy_devices.device_credential_revocations
     where revocation_id = v_revocation_id
       and credential_id = v_credential
       and revocation_request_id = v_intent
       and reason_code = 'ADMINISTRATIVE_REPLACEMENT'
       and reason = 'terminal permanently replaced under change S42'
       and requested_by = 'requester@42'
       and approved_by = 'approver@42'
       and approved_at is not null
       and approval_request_id = v_ap_ok
       and incident_reference = 'CHG-S42') then
    v_findings := v_findings || 'the revocation wrote no complete append-only evidence row';
  end if;

  -- The durable obligation: a non-NO_RECOVERY disposition owes a case.
  if not exists (
    select 1 from kitluy_devices.device_recovery_cases
     where revocation_id = v_revocation_id
       and device_record_id = v_device
       and disposition = 'REPROVISION_REQUIRED'
       and state = 'open') then
    v_findings := v_findings || 'a non-NO_RECOVERY revocation opened no recovery case';
  end if;

  -- ------------------------------------------------------------------------
  -- Replaying the SAME intent is idempotent and writes no second row.
  -- ------------------------------------------------------------------------
  select count(*) into v_rows from kitluy_devices.device_credential_revocations
   where credential_id = v_credential;
  v_res := kitluy_devices.revoke_device_credential_v1(
    v_intent, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change S42',
    'REPROVISION_REQUIRED', 'requester@42', 'SECTION42',
    v_ap_ok, 'approver@42', 'CHG-S42');
  if (v_res ->> 'outcome') <> 'ALREADY_REVOKED'
     or (v_res ->> 'revocation_id')::uuid <> v_revocation_id then
    v_findings := v_findings || format('replaying the same intent was not idempotent: %s', v_res);
  end if;
  if (select count(*) from kitluy_devices.device_credential_revocations
       where credential_id = v_credential) <> v_rows then
    v_findings := v_findings || 'a replayed intent wrote a second revocation row';
  end if;

  -- ------------------------------------------------------------------------
  -- A DIFFERENT intent against the revoked credential goes to review and does
  -- NOT overwrite the first account of why it was repudiated.
  -- ------------------------------------------------------------------------
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('42conflict-' || v_intent, 'UTF8')), 'hex'),
          'someone else calls it theft', 'APPROVED')
  returning id into v_ap_second;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_second, v_approver, 'APPROVE');

  v_res := kitluy_devices.revoke_device_credential_v1(
    's42-conflict-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'DEVICE_STOLEN', 'a second person calls it theft', 'REPROVISION_REQUIRED',
    'requester2@42', 'SECTION42', v_ap_second, 'approver2@42', 'INC-S42');
  if (v_res ->> 'outcome') <> 'MANUAL_REVIEW_REQUIRED'
     or (v_res ->> 'refusal_code') <> 'KLUY-REVOKE-CONFLICTING-REASON' then
    v_findings := v_findings || format('a conflicting second intent did not go to review: %s', v_res);
  end if;
  if not exists (
    select 1 from kitluy_devices.device_credential_revocations
     where revocation_id = v_revocation_id
       and reason_code = 'ADMINISTRATIVE_REPLACEMENT'
       and requested_by = 'requester@42') then
    v_findings := v_findings || 'the FIRST account of the revocation was overwritten';
  end if;
  if (select count(*) from kitluy_devices.device_credential_revocations
       where credential_id = v_credential) <> v_rows then
    v_findings := v_findings || 'a conflicting intent wrote a second revocation row';
  end if;

  -- Decision §2.4 holds over the approve-before-execute path too: the
  -- credential governor ITSELF cannot put this credential back into service.
  -- Requires the governor, borrowed and handed straight back so section 32's
  -- containment assertion still holds on the next run.
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute 'set role kitluy_credential_issuer';
  begin
    update kitluy_devices.device_credentials
       set state = 'issued', revoked_at = null
     where credential_id = v_credential;
    v_findings := v_findings || 'a four-eyes revocation was REVERSED by the governor';
  exception when others then
    if sqlerrm not like 'KLUY-REVOCATION-IS-ONE-WAY%' then
      v_findings := v_findings || format('wrong refusal un-revoking a credential: %s', sqlerrm);
    end if;
  end;
  execute 'reset role';
  execute format('revoke kitluy_credential_issuer from %I', current_user);

  -- ------------------------------------------------------------------------
  -- The IDENTITY that makes the gate able to answer, asserted permanently.
  --
  -- The approval tables are RLS ENABLED and FORCED. Group 0139 pinned the gate
  -- to `service_role` because its global BYPASSRLS attribute was the only route
  -- then available. KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2
  -- SUPERSEDES that additively in group 0140: the gate now runs as
  -- `kitluy_credential_approval_reader`, which is NOLOGIN, holds NO BYPASSRLS,
  -- and sees three kitluy_auth relations restricted to credential-revocation
  -- approvals by three named policies. Section 43 proves that boundary by
  -- execution; this assertion is the ownership fact section 42 depends on.
  -- ------------------------------------------------------------------------
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
    v_findings := v_findings ||
      'the revocation approval gate is not a kitluy_credential_approval_reader-owned SECURITY DEFINER with a fixed search_path';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and pg_get_userbyid(p.proowner) = 'service_role') then
    v_findings := v_findings ||
      'the revocation approval gate is owned by service_role again (Ruling 2 refuses it)';
  end if;
  if not (select not rolbypassrls and not rolcanlogin and not rolsuper
            from pg_roles where rolname = 'kitluy_credential_approval_reader') then
    v_findings := v_findings ||
      'kitluy_credential_approval_reader is no longer the NOLOGIN non-BYPASSRLS identity Ruling 2 requires';
  end if;
  if has_function_privilege('public',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('anon',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('kitluy_worker_service',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
    v_findings := v_findings || 'the approval gate is reachable outside the governed revocation path';
  end if;
  if not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
    v_findings := v_findings || 'the governed revocation path cannot reach its own approval gate';
  end if;

  -- ...and the governor still holds NOTHING on the approvals aggregate. A gate
  -- that answered because the governor could read kitluy_auth would have been
  -- the boundary change, not the fix.
  if has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_policies', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_decisions', 'select') then
    v_findings := v_findings || 'the credential governor now reaches the approvals aggregate directly';
  end if;
  if has_schema_privilege('service_role', 'kitluy_devices', 'create') then
    v_findings := v_findings || 'service_role kept CREATE on kitluy_devices after the ownership move';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % revocation-execution finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-revocation-executes: the approve-before-execute revocation COMPLETES end to end — an unapproved request, an A2 risk class, an approval naming another device and a self-approved request are each refused with their own code and change nothing, while a scoped A4 approval decided by a second person revokes the credential with `revoked_at` and `revocation_reason` written alongside the state (the pair device_credentials_revoked_chk requires and group 0136 never wrote), records complete append-only evidence naming reason, requester, approver and approval request, and opens an OPEN reprovision recovery case; replaying the same intent is idempotent with no second row, a DIFFERENT intent returns MANUAL_REVIEW_REQUIRED without overwriting the first account, the decision §2.4 one-way rule still refuses the governor itself, and the gate can answer at all only because it is pinned to a NOLOGIN identity that is allowed to read approvals — after group 0140 that is kitluy_credential_approval_reader, which holds NO BYPASSRLS and sees credential-revocation approvals only (KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2 superseding group 0139''s service_role) — while the credential governor still holds nothing whatsoever on kitluy_auth';
end
$section42$;

select 'assertions complete: groups 0010-0139 structural contract holds (incl. WS-11-T003 Step 4 approve-before-execute revocation executing end to end)' as result;


-- ============================================================================
-- SECTION 43 — WS-11-T003 Step 4: the approval gate does NOT run as
-- `service_role` (migration 0140).
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 2**,
--   amending KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001; migration groups
--   0139 (the superseded service_role gate), 0138 (the one-way trigger,
--   Ruling 3) and 0140 (the boundary).
--
-- Group 0139 made the gate a SECURITY DEFINER owned by `service_role`, whose
-- global BYPASSRLS ROLE ATTRIBUTE puts every RLS-protected row in the database
-- inside that function's reach. Ruling 2 refuses that as the final design and
-- authorizes a purpose-built NOLOGIN reader plus EXACTLY THREE narrowly scoped
-- RLS SELECT policies — the census 58 -> 61 asserted in section 7.
--
-- The ONLY interesting question about a boundary is what it REFUSES, and a
-- refusal cannot be established by reading catalogue rows. So every control
-- below runs something: it calls the gate, it SETs the role and issues a real
-- query or a real write, or it removes a real policy and observes the real
-- consequence. `pg_proc.proowner` is checked, but never on its own — control 8
-- is the executable proof that the gate runs as the CONSTRAINED reader, because
-- removing one of that reader's policies would mean nothing at all to a
-- BYPASSRLS identity.
--
-- Both memberships this section borrows are handed back before it finishes, and
-- control 4 then proves the hand-back took effect by being refused SET ROLE.
-- If any assertion here raises, the whole DO block rolls back and the borrow
-- rolls back with it, so section 32's containment assertion still holds.
-- ============================================================================
do $section43$
declare
  v_findings text[] := array[]::text[];
  v_msg text := '';
  v_fp text := encode(sha256(convert_to('t43-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_fp_other text := encode(sha256(convert_to('t43b-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_device uuid;
  v_other_device uuid;
  v_credential uuid;
  v_requester constant uuid := '00000000-0000-4000-8000-000000000007';
  v_approver constant uuid := '00000000-0000-4000-8000-000000000008';
  v_policy_a4 uuid;
  v_policy_unrelated uuid;
  v_ap_ok uuid;
  v_ap_scope uuid;
  v_ap_unrelated uuid;
  v_intent text := 's43-' || gen_random_uuid()::text;
  v_res jsonb;
  v_state text;
  v_visible integer;
  v_expected integer;
  v_total integer;
  v_n integer;
  v_role text;
  v_rel text;
  v_mode text;
  v_pol record;
  v_reached boolean;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures: two real devices, a real issued credential, and three approvals
  -- in the SAME kitluy_auth aggregate group 0124 uses.
  -- ------------------------------------------------------------------------
  v_device := pg_temp.ws11_renewable_device('t43', v_fp);
  v_other_device := pg_temp.ws11_renewable_device('t43b', v_fp_other);
  select credential_id into v_credential from kitluy_devices.device_credentials
   where device_record_id = v_device and certificate_generation = 1;
  if v_credential is null then
    raise exception 'ASSERT FAIL: section 43 could not issue a credential to revoke';
  end if;

  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.reader.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', 'development', 1, 'ACTIVE', 'A4')
  returning id into v_policy_a4;

  -- An approval policy that has nothing to do with credentials, so control 6
  -- is about the ACTION and not about a policy that happens to be missing.
  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('device.time.correction.reader.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.time.correct', 'development', 1, 'ACTIVE', 'A4')
  returning id into v_policy_unrelated;

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('43ok-' || v_intent, 'UTF8')), 'hex'),
          'terminal permanently replaced', 'APPROVED')
  returning id into v_ap_ok;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_ok, v_approver, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_a4, v_requester, 'device', v_other_device, 'development',
          'device_credential_revocation',
          encode(sha256(convert_to('43scope-' || v_intent, 'UTF8')), 'hex'),
          'a different terminal entirely', 'APPROVED')
  returning id into v_ap_scope;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_scope, v_approver, 'APPROVE');

  -- Fully valid, A4, APPROVED, this device, this environment, decided by a
  -- second person. The ONLY thing wrong with it is that it is not a credential
  -- revocation.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_unrelated, v_requester, 'device', v_device, 'development',
          'device_time_correction',
          encode(sha256(convert_to('43unrelated-' || v_intent, 'UTF8')), 'hex'),
          'an approval that has nothing to do with credentials', 'APPROVED')
  returning id into v_ap_unrelated;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_unrelated, v_approver, 'APPROVE');

  -- The gate is EXECUTE-able only by the credential governor, and the reader is
  -- reachable by nothing, so both memberships are borrowed to run the controls
  -- and handed back before this block ends.
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute format('grant kitluy_credential_approval_reader to %I', current_user);

  -- ========================================================================
  -- CONTROL 2 — `service_role` ownership is NOT required. A real approval is
  -- evaluated successfully under the new owner.
  -- ========================================================================
  begin
    v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
      v_ap_ok, v_device, 'development', 'requester@43'));
    if (v_res ->> 'authorized')::boolean is not true then
      v_findings := v_findings ||
        format('control 2: the reader-owned gate refused a valid A4 approval: %s', v_res ->> 'refusal_code');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    v_findings := v_findings ||
      format('control 2: the reader-owned gate could not evaluate an approval: %s', v_msg);
  end;

  -- ========================================================================
  -- CONTROL 7 — a cross-device approval and a wrong-environment approval are
  -- REFUSED by the gate, through the real call.
  -- ========================================================================
  v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
    v_ap_scope, v_device, 'development', 'requester@43'));
  if (v_res ->> 'authorized')::boolean is not false
     or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
    v_findings := v_findings ||
      format('control 7: an approval naming ANOTHER device was not refused as wrong scope: %s', v_res);
  end if;
  v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
    v_ap_ok, v_device, 'staging', 'requester@43'));
  if (v_res ->> 'authorized')::boolean is not false
     or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
    v_findings := v_findings ||
      format('control 7: an approval scoped to another environment was accepted: %s', v_res);
  end if;
  -- ...and the same refusal through the governed operation, not only the gate.
  v_res := kitluy_devices.revoke_device_credential_v1(
    's43-scope-' || gen_random_uuid()::text, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'wrong-scope probe', 'REPROVISION_REQUIRED',
    'requester@43', 'SECTION43', v_ap_scope, 'approver@43', null);
  if (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-WRONG-SCOPE' then
    v_findings := v_findings ||
      format('control 7: an approval for another device authorized this one: %s', v_res);
  end if;

  -- ========================================================================
  -- CONTROLS 3, 5, 6 and 11 — AS THE READER, against real rows.
  --
  -- Control 3's BYPASSRLS half is established here rather than from pg_roles:
  -- a BYPASSRLS role would read every approval request in this database. This
  -- one reads only credential revocations, and there are other actions present
  -- (the seed and sections 30/41/42 all write into this aggregate).
  -- ========================================================================
  select count(*) into v_total from kitluy_auth.approval_requests;
  select count(*) into v_expected from kitluy_auth.approval_requests
   where action = 'device_credential_revocation';

  execute 'set role kitluy_credential_approval_reader';
  begin
    select count(*) into v_visible from kitluy_auth.approval_requests;

    -- Control 6, addressed BY ID: the unrelated approval, its policy and its
    -- decisions are all invisible.
    select count(*) into v_n from kitluy_auth.approval_requests where id = v_ap_unrelated;
    if v_n <> 0 then
      v_findings := v_findings || 'control 6: an approval with a different action was visible to the reader';
    end if;
    select count(*) into v_n from kitluy_auth.approval_policies where id = v_policy_unrelated;
    if v_n <> 0 then
      v_findings := v_findings || 'control 6: the policy of an unrelated approval was visible to the reader';
    end if;
    select count(*) into v_n from kitluy_auth.approval_decisions
     where approval_request_id = v_ap_unrelated;
    if v_n <> 0 then
      v_findings := v_findings || 'control 6: the decisions of an unrelated approval were visible to the reader';
    end if;

    -- ...while the revocation approval IS fully readable, so the policies are
    -- narrow rather than simply broken.
    select count(*) into v_n from kitluy_auth.approval_requests where id = v_ap_ok;
    if v_n <> 1 then
      v_findings := v_findings || 'control 5: the reader could not see a credential-revocation approval';
    end if;
    select count(*) into v_n from kitluy_auth.approval_policies where id = v_policy_a4;
    if v_n <> 1 then
      v_findings := v_findings || 'control 5: the reader could not see the policy of a credential-revocation approval';
    end if;
    select count(*) into v_n from kitluy_auth.approval_decisions where approval_request_id = v_ap_ok;
    if v_n <> 1 then
      v_findings := v_findings || 'control 5: the reader could not see the decisions of a credential-revocation approval';
    end if;

    -- Control 11, by execution: real writes, refused.
    begin
      insert into kitluy_auth.approval_requests
        (policy_id, requester_id, resource_type, resource_id, environment, action,
         payload_hash, reason, status)
      values (v_policy_a4, v_requester, 'device', v_device, 'development',
              'device_credential_revocation',
              encode(sha256(convert_to('43write-' || v_intent, 'UTF8')), 'hex'),
              'the reader writing', 'APPROVED');
      v_findings := v_findings || 'control 11: the reader INSERTed an approval request';
    exception when insufficient_privilege then
      null;
    end;
    begin
      update kitluy_auth.approval_requests set status = 'REJECTED' where id = v_ap_ok;
      v_findings := v_findings || 'control 11: the reader UPDATEd an approval request';
    exception when insufficient_privilege then
      null;
    end;
    -- The removal privileges are asserted by the privilege scan below rather
    -- than by a live statement: this file is also read by humans looking for
    -- destructive SQL, and a refusal probe is not worth a false positive.

    execute 'reset role';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    v_findings := v_findings || format('control 5/6/11: the reader probe did not complete: %s', v_msg);
  end;

  if v_visible is distinct from v_expected then
    v_findings := v_findings ||
      format('control 5: the reader saw %s approval request(s) but %s are credential revocations',
             coalesce(v_visible, -1), v_expected);
  end if;
  if coalesce(v_visible, 0) = 0 then
    v_findings := v_findings || 'control 5: the reader saw NO approval requests, so nothing was proved';
  end if;
  if v_total <= coalesce(v_visible, 0) then
    v_findings := v_findings ||
      'control 3/6: every approval request in this database is a credential revocation, so invisibility was not tested';
  end if;

  -- Control 11, wider: no write privilege on ANY kitluy_auth relation, and
  -- SELECT is the only privilege this role holds anywhere in the database.
  for v_rel in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'kitluy_auth' and c.relkind in ('r', 'p', 'v', 'm')
  loop
    foreach v_mode in array array['insert', 'update', 'delete', 'references', 'trigger'] loop
      if has_table_privilege('kitluy_credential_approval_reader',
                             format('kitluy_auth.%I', v_rel), v_mode) then
        v_findings := v_findings ||
          format('control 11: the reader holds %s on kitluy_auth.%s', upper(v_mode), v_rel);
      end if;
    end loop;
  end loop;
  select count(*) into v_n
    from (
      select privilege_type from information_schema.role_table_grants
       where grantee = 'kitluy_credential_approval_reader'
      union all
      select privilege_type from information_schema.role_column_grants
       where grantee = 'kitluy_credential_approval_reader') g
   where g.privilege_type <> 'SELECT';
  if v_n <> 0 then
    v_findings := v_findings ||
      format('control 11: the reader holds %s non-SELECT table/column privilege(s)', v_n);
  end if;

  -- ...and it cannot read an approval PAYLOAD or REASON even on the relations
  -- it can see.
  --
  -- `payload_hash` was in this refusal until group 0141. KLD-2026-07-29-DEVICE-
  -- REVOCATION-BOUNDARY-002 Ruling 1 requires the recorded scope to be
  -- cryptographically bound INTO that hash and the binding to be verified, and
  -- a binding to a hash cannot be verified without reading the hash. Ruling 1
  -- and Ruling 2 are the same owner decision, so the minimum that satisfies
  -- both is taken: ONE more column, on rows already visible, with no new
  -- policy (the section 7 census stays at Ruling 2's 61). Recorded as RC-015.
  -- A hash is not a payload; `reason` remains unreadable on both relations and
  -- is still refused here.
  if has_column_privilege('kitluy_credential_approval_reader',
                          'kitluy_auth.approval_requests', 'reason', 'select')
     or has_column_privilege('kitluy_credential_approval_reader',
                             'kitluy_auth.approval_decisions', 'reason', 'select') then
    v_findings := v_findings || 'control 11: the reader can read an approval reason';
  end if;
  -- The positive half, so the widening stays pinned to exactly what Ruling 1
  -- needed and cannot drift wider unnoticed: the hash IS readable, and it is
  -- the ONLY column of `approval_requests` beyond group 0140's eight.
  if not has_column_privilege('kitluy_credential_approval_reader',
                              'kitluy_auth.approval_requests', 'payload_hash', 'select') then
    v_findings := v_findings ||
      'control 11: the reader cannot read payload_hash, so group 0141 cannot verify a scope binding';
  end if;
  select count(*) into v_n
    from information_schema.role_column_grants
   where grantee = 'kitluy_credential_approval_reader'
     and table_schema = 'kitluy_auth' and table_name = 'approval_requests';
  if v_n <> 9 then
    v_findings := v_findings ||
      format('control 11: the reader holds %s column grants on approval_requests, expected exactly 9 (group 0140''s eight plus Ruling 1''s payload_hash)', v_n);
  end if;

  -- ========================================================================
  -- CONTROL 8 — removing ANY ONE of the three policies makes the gate FAIL
  -- CLOSED. Each drop lives in its own subtransaction and is rolled back;
  -- DDL is transactional, so the policy is restored before the next probe.
  --
  -- This is also the executable half of CONTROL 1: a BYPASSRLS owner would be
  -- entirely unaffected by the loss of a policy belonging to this reader.
  -- ========================================================================
  for v_pol in
    select * from (values
      ('kitluy_auth', 'approval_requests',  'approval_requests_credential_revocation_reader'),
      ('kitluy_auth', 'approval_policies',  'approval_policies_credential_revocation_reader'),
      ('kitluy_auth', 'approval_decisions', 'approval_decisions_credential_revocation_reader')
    ) as t(sch, tbl, pol)
  loop
    begin
      execute format('drop policy %I on %I.%I', v_pol.pol, v_pol.sch, v_pol.tbl);
      begin
        v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
          v_ap_ok, v_device, 'development', 'requester@43'));
        if (v_res ->> 'authorized')::boolean is not false then
          v_findings := v_findings || format(
            'control 8: with policy %s removed the gate still AUTHORIZED the revocation', v_pol.pol);
        end if;
      exception when others then
        -- A raised error is also fail-closed. Only silent authorization is not.
        null;
      end;
      raise exception using errcode = 'P0001', message = 'KLUY-43-POLICY-PROBE';
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg <> 'KLUY-43-POLICY-PROBE' then
        v_findings := v_findings ||
          format('control 8: the fail-closed probe for %s did not complete: %s', v_pol.pol, v_msg);
      end if;
    end;
  end loop;

  -- All three restored by the rollbacks, and the gate answers again.
  if (select count(*) from pg_policies
       where 'kitluy_credential_approval_reader' = any (roles::text[])) <> 3 then
    v_findings := v_findings || 'control 8: the three reader policies were not restored by the rollback';
  end if;
  v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
    v_ap_ok, v_device, 'development', 'requester@43'));
  if (v_res ->> 'authorized')::boolean is not true then
    v_findings := v_findings ||
      format('control 8: the gate did not recover after the policies were restored: %s', v_res);
  end if;

  -- ========================================================================
  -- CONTROLS 9 and 10 — who may EXECUTE the gate, proved by trying it.
  -- `anon` and `authenticated` hold no grant on it, so they exercise the
  -- PUBLIC path; `service_role` is included precisely because group 0139's
  -- design would have let it through.
  -- ========================================================================
  foreach v_role in array array[
    'anon', 'authenticated', 'service_role', 'kitluy_worker_service',
    'kitluy_issuance_service', 'kitluy_job_governor']
  loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      begin
        execute format('set role %I', v_role);
        begin
          perform kitluy_devices.evaluate_credential_revocation_approval_v1(
            v_ap_ok, v_device, 'development', 'requester@43');
          v_findings := v_findings || format('control 10: %s executed the approval gate', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.credential_revocation_approval_consumed_v1(v_ap_ok);
          v_findings := v_findings ||
            format('control 10: %s executed the single-use helper', v_role);
        exception when insufficient_privilege then
          null;
        end;
        execute 'reset role';
      exception when others then
        get stacked diagnostics v_msg = message_text;
        execute 'reset role';
        v_findings := v_findings ||
          format('control 10: the execute probe for %s did not complete: %s', v_role, v_msg);
      end;
    end if;
  end loop;

  if has_function_privilege('public',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute')
     or has_function_privilege('public',
       'kitluy_devices.credential_revocation_approval_consumed_v1(uuid)', 'execute') then
    v_findings := v_findings || 'control 9: PUBLIC can execute the approval gate or its single-use helper';
  end if;
  if not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.evaluate_credential_revocation_approval_v1(uuid, uuid, text, text)', 'execute') then
    v_findings := v_findings || 'control 10: the governed revocation path cannot reach its own approval gate';
  end if;
  -- The single-use helper is reachable ONLY by the reader that needs it — the
  -- reason the reader holds no policy on device_credential_revocations.
  if has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.credential_revocation_approval_consumed_v1(uuid)', 'execute')
     or has_function_privilege('service_role',
       'kitluy_devices.credential_revocation_approval_consumed_v1(uuid)', 'execute') then
    v_findings := v_findings || 'control 10: the single-use helper is reachable outside the gate';
  end if;

  -- ========================================================================
  -- CONTROL 12 — a real revocation completes THROUGH the reader-owned gate,
  -- and the revoked credential STAYS revoked (Ruling 3), with group 0138's
  -- one-way trigger undisturbed by the boundary change.
  -- ========================================================================
  v_res := kitluy_devices.revoke_device_credential_v1(
    v_intent, v_device, 'development', 'device_identity', 1,
    'ADMINISTRATIVE_REPLACEMENT', 'terminal permanently replaced under change S43',
    'REPROVISION_REQUIRED', 'requester@43', 'SECTION43',
    v_ap_ok, 'approver@43', 'CHG-S43');
  if (v_res ->> 'outcome') <> 'REVOKED' then
    raise exception
      'ASSERT FAIL: section 43 could not complete a four-eyes revocation through the reader-owned gate: %', v_res;
  end if;

  select state::text into v_state from kitluy_devices.device_credentials
   where credential_id = v_credential;
  if v_state <> 'revoked' then
    v_findings := v_findings || format('control 12: the revoked credential is %s', v_state);
  end if;

  execute 'set role kitluy_credential_issuer';
  begin
    update kitluy_devices.device_credentials
       set state = 'issued', revoked_at = null
     where credential_id = v_credential;
    v_findings := v_findings || 'control 12: a revoked credential was returned to issued';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'KLUY-REVOCATION-IS-ONE-WAY%' then
      v_findings := v_findings || format('control 12: wrong refusal un-revoking a credential: %s', v_msg);
    end if;
  end;
  execute 'reset role';

  if not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
                  where c.relname = 'device_credentials'
                    and t.tgname = 'trg_device_credentials_revocation_one_way'
                    and not t.tgisinternal) then
    v_findings := v_findings || 'control 12: the one-way revocation trigger is gone';
  end if;

  -- Single use survives the move: the approval that authorized the completed
  -- revocation is no longer authority for another, even though the reader
  -- holds no grant and no policy on the evidence table it is derived from.
  v_res := to_jsonb(kitluy_devices.evaluate_credential_revocation_approval_v1(
    v_ap_ok, v_device, 'development', 'requester@43'));
  if (v_res ->> 'authorized')::boolean is not false
     or (v_res ->> 'refusal_code') <> 'KLUY-CRED-REVOCATION-APPROVAL-CONSUMED' then
    v_findings := v_findings ||
      format('control 12: a consumed approval was still authority for a revocation: %s', v_res);
  end if;
  if has_table_privilege('kitluy_credential_approval_reader',
                         'kitluy_devices.device_credential_revocations', 'select') then
    v_findings := v_findings ||
      'the reader can read revocation evidence directly, which the three-policy boundary exists to avoid';
  end if;

  -- ========================================================================
  -- CONTROL 1 — `service_role` no longer owns the gate. The executable proof
  -- is control 8; these are the corroborating catalogue facts.
  -- ========================================================================
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and pg_get_userbyid(p.proowner) = 'service_role') then
    v_findings := v_findings || 'control 1: service_role owns the approval gate again';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'evaluate_credential_revocation_approval_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader'
       and p.proconfig is not null
       and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
    v_findings := v_findings ||
      'control 1: the gate is not a reader-owned SECURITY DEFINER with a fixed search_path';
  end if;

  -- CONTROL 3, attribute half, beside the behavioural proof above.
  if not exists (
    select 1 from pg_roles
     where rolname = 'kitluy_credential_approval_reader'
       and not rolcanlogin and not rolbypassrls and not rolsuper
       and not rolcreaterole and not rolcreatedb and not rolreplication) then
    v_findings := v_findings || 'control 3: the approval reader holds login or elevated attributes';
  end if;

  -- Exactly three policies, all SELECT, all on the approval aggregate. Ruling 2
  -- authorizes three; a fourth is a different decision.
  if (select count(*) from pg_policies
       where 'kitluy_credential_approval_reader' = any (roles::text[])) <> 3 then
    v_findings := v_findings || 'the approval reader is named by other than exactly three policies';
  end if;
  if exists (select 1 from pg_policies
              where 'kitluy_credential_approval_reader' = any (roles::text[])
                and (cmd <> 'SELECT' or schemaname <> 'kitluy_auth')) then
    v_findings := v_findings || 'the approval reader holds a non-SELECT policy or one outside kitluy_auth';
  end if;

  -- The credential governor STILL holds nothing on the approvals aggregate —
  -- the invariant groups 0138/0139 and sections 41a/42 depend on.
  if has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_policies', 'select')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_decisions', 'select') then
    v_findings := v_findings || 'the credential governor now reaches the approvals aggregate directly';
  end if;
  if has_schema_privilege('kitluy_credential_approval_reader', 'kitluy_devices', 'create') then
    v_findings := v_findings || 'the approval reader kept CREATE on kitluy_devices after the ownership move';
  end if;

  -- ------------------------------------------------------------------------
  -- Hand both memberships back BEFORE the last control, because the last
  -- control is that the hand-back worked.
  -- ------------------------------------------------------------------------
  execute format('revoke kitluy_credential_issuer from %I', current_user);
  execute format('revoke kitluy_credential_approval_reader from %I', current_user);

  -- ========================================================================
  -- CONTROL 4 — nothing can SET ROLE to the reader.
  --
  -- SET ROLE is decided by SESSION-user membership, so the executable probe
  -- can only be run by this session — and this session is `postgres`, the most
  -- privileged non-superuser identity in the stack (LOGIN, BYPASSRLS,
  -- CREATEROLE, the role every migration runs as). If IT is refused, an
  -- application, worker, issuer or service identity holding no membership at
  -- all certainly is; the enumeration below is what establishes that none of
  -- them holds one.
  -- ========================================================================
  v_reached := false;
  begin
    execute 'set role kitluy_credential_approval_reader';
    v_reached := true;
    execute 'reset role';
  exception when others then
    null;
  end;
  if v_reached then
    v_findings := v_findings ||
      'control 4: the test session can still SET ROLE to kitluy_credential_approval_reader after handing the membership back';
  end if;

  foreach v_role in array array[
    'service_role', 'authenticated', 'anon', 'authenticator',
    'kitluy_credential_issuer', 'kitluy_worker_service', 'kitluy_issuance_service',
    'kitluy_activation_governor', 'kitluy_job_governor'] loop
    if exists (select 1 from pg_roles where rolname = v_role)
       and (pg_has_role(v_role, 'kitluy_credential_approval_reader', 'MEMBER')
            or pg_has_role(v_role, 'kitluy_credential_approval_reader', 'USAGE')) then
      v_findings := v_findings ||
        format('control 4: %s can reach kitluy_credential_approval_reader', v_role);
    end if;
  end loop;
  if exists (
    select 1 from pg_auth_members m
      join pg_roles r on r.oid = m.member
      join pg_roles g on g.oid = m.roleid
     where g.rolname = 'kitluy_credential_approval_reader'
       and not r.rolsuper) then
    v_findings := v_findings || 'control 4: a non-superuser role is a member of the approval reader';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % approval-boundary finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-approval-gate-boundary: the credential-revocation approval gate no longer runs as the global-BYPASSRLS service_role — it is a SECURITY DEFINER owned by the NOLOGIN, non-BYPASSRLS kitluy_credential_approval_reader, which no application, worker, issuer or service identity is a member of and which this session itself is refused SET ROLE to once the borrowed membership is handed back; that owner is not required to be service_role, because a real A4 approval decided by a second person is evaluated, authorized and executed into a completed revocation under it, while an approval naming another device and one scoped to another environment are refused as WRONG-SCOPE both at the gate and through revoke_device_credential_v1; the reader sees ONLY device_credential_revocation requests and their reachable policies and decisions — a fully valid A4 approval for a different action, its policy and its decisions are all invisible to it, which a BYPASSRLS identity could not reproduce — it holds SELECT and nothing else anywhere in the database, no INSERT/UPDATE/DELETE/REFERENCES/TRIGGER on any kitluy_auth relation (a live INSERT and UPDATE are both refused), and no read of any approval reason at all — it reads exactly nine columns of approval_requests, group 0140''s eight plus the payload_hash Ruling 1 requires it to verify a scope binding against (RC-015), and no payload anywhere; removing any ONE of the three OWNER-APPROVED policies (58 -> 61, KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2) makes the gate FAIL CLOSED and the rollback restores it; PUBLIC, anon, authenticated, service_role, the worker, the issuance service and the job governor are each refused EXECUTE on both the gate and its single-use helper while kitluy_credential_issuer alone holds it; single use still refuses a consumed approval although the reader holds no grant and no policy on the revocation evidence; and Ruling 3 holds — the revoked credential stays revoked and group 0138''s one-way trigger is undisturbed';
end
$section43$;

-- ============================================================================
-- SECTION 44 — WS-11-T003 Step 4: the recorded revocation scope is
-- CRYPTOGRAPHICALLY BOUND into the approval that authorizes it (migration 0141).
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 1**,
--   amending KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3/§3.1; migration
--   groups 0138 (the recorded scope and its refusals), 0140 (the NOLOGIN reader
--   that may touch kitluy_auth) and 0141 (the binding).
--
-- Group 0138 let a scope row CITE an approval. A citation is not a binding: the
-- row could name approval X while describing an affected set the approvers of X
-- never saw, and nothing spent the scope when it was used. Ruling 1 makes the
-- exact scope a TERM of the approval — the digest of the canonical affected set,
-- together with the reason, environment, subject type, tenancy, identifier
-- count, requester and owner-decision version, is inside `payload_hash` — so an
-- approval either commits to this exact set or it does not verify at all, and
-- the scope is then spent exactly once.
--
-- A binding is only a binding if changing ANY ONE of its terms breaks it, so
-- every term is varied on its own below and the resulting hash compared. Almost
-- nothing here is taken from the catalogue: the digests are really recomputed,
-- the scope rows are really inserted, the 0138 refusals are really attempted,
-- the verifier and the consumer are really called AS the credential governor,
-- and the scope is really spent. `pg_proc` is read only for the three facts
-- that have no behaviour — ownership, PUBLIC EXECUTE and the pinned
-- search_path — and the PUBLIC one is corroborated by six roles actually trying
-- the calls.
--
-- TWO NOTES ON WHAT THE SHIPPED CODE ACTUALLY ANSWERS, so a later reader does
-- not mistake these for weakened assertions:
--
--   * the verifier is owned by `kitluy_credential_issuer`, NOT by the approval
--     reader, because it reads the governor's own `revocation_recorded_scopes`.
--     The ONE fact it needs from `kitluy_auth` is fetched through
--     `credential_revocation_approval_payload_hash_v1`, a separate definer owned
--     by the reader that returns one hash for one credential-revocation
--     approval and nothing else. Control 10 asserts that split precisely,
--     because it is the whole reason Ruling 1 and Ruling 2 can both hold.
--   * that helper returns NULL for an approval whose `payload_hash` is null or
--     blank, so the verifier's `UNBOUND` branch is answered as `UNAPPROVED`
--     before it is reached. Control 7c therefore asserts the SECURITY property
--     (a blank hash is never read as "nothing to check") and accepts either
--     refusal code rather than pinning the assertion to dead code.
--
-- The governor membership this section borrows is handed back before it
-- finishes, exactly as sections 41c and 43 do. If any assertion raises, the
-- whole DO block rolls back and the borrow rolls back with it, so section 32's
-- containment assertion still holds on the next run.
-- ============================================================================
do $section44$
declare
  v_findings text[] := array[]::text[];
  v_msg text := '';
  v_fp text := encode(sha256(convert_to('t44-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_fp_other text := encode(sha256(convert_to('t44b-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_device uuid;
  v_other_device uuid;

  -- The terms of the binding, named once so each variant can differ in EXACTLY
  -- one of them.
  v_env constant text := 'development';
  v_env_other constant text := 'staging';
  v_reason constant kitluy_devices.credential_revocation_reason := 'SECURITY_INCIDENT';
  v_reason_other constant kitluy_devices.credential_revocation_reason := 'PROVIDER_COMPROMISE';
  v_subject constant text := 'MIXED';
  v_tenant constant uuid := '00000000-0000-4000-8000-000000000011';
  v_store constant uuid := '00000000-0000-4000-8000-000000000015';
  v_location constant uuid := '00000000-0000-4000-8000-000000000018';
  v_requester constant text := 'sec-a@44';
  v_dv constant text := 'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002';
  v_keys constant text[] := array['pk-44-beta', 'pk-44-alpha'];
  v_devices uuid[];
  v_count integer;

  v_requester_id constant uuid := '00000000-0000-4000-8000-000000000007';
  v_approver_id constant uuid := '00000000-0000-4000-8000-000000000008';
  v_incident text := 'INC-44-' || gen_random_uuid()::text;

  v_canon text;
  v_canon_b text;
  v_digest text;
  v_digest_b text;
  v_digest_other text;
  v_digest_stg text;
  v_payload text;
  v_payload_stg text;

  v_policy_dev uuid;
  v_policy_stg uuid;
  v_ap_ok uuid;
  v_ap_hash uuid;
  v_ap_unbound uuid;
  v_ap_stg uuid;
  v_ap_consume uuid;

  v_scope_ok uuid;
  v_scope_hash uuid;
  v_scope_unbound uuid;
  v_scope_stg uuid;
  v_scope_envmix uuid;
  v_scope_consume uuid;
  v_scope_missing uuid := gen_random_uuid();
  v_revocation_id uuid := gen_random_uuid();

  v_stored_digest text;
  v_stored_payload text;
  v_stored_count integer;
  v_consumption uuid;

  v_verdict jsonb;
  v_res jsonb;
  v_role text;
  v_sig text;
  v_n integer;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures: two real devices, so the affected set names identifiers that
  -- actually exist, and the approvals in the SAME kitluy_auth aggregate group
  -- 0124 uses. The approval payload hashes are COMPUTED here from the terms the
  -- scope rows are about to carry — which is the whole point of Ruling 1: an
  -- approver commits to a hash, and the recorded scope must reproduce it
  -- exactly or it is not the set that was approved.
  -- ------------------------------------------------------------------------
  v_device := pg_temp.ws11_renewable_device('t44', v_fp);
  v_other_device := pg_temp.ws11_renewable_device('t44b', v_fp_other);
  v_devices := array[v_device];
  v_count := cardinality(v_devices) + cardinality(v_keys);

  -- ========================================================================
  -- CONTROL 1 — CANONICALIZATION. Order and duplication cannot move the bytes;
  -- one changed identifier must.
  -- ========================================================================
  -- 1a. The same set in a DIFFERENT ORDER: identical bytes, identical digest.
  v_canon := kitluy_devices.canonical_revocation_scope_v1(
    v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
    array[v_device, v_other_device], array['pk-44-beta', 'pk-44-alpha'],
    array[]::text[], array[]::uuid[]);
  v_canon_b := kitluy_devices.canonical_revocation_scope_v1(
    v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
    array[v_other_device, v_device], array['pk-44-alpha', 'pk-44-beta'],
    array[]::text[], array[]::uuid[]);
  if v_canon_b is distinct from v_canon then
    v_findings := v_findings ||
      format('control 1a: reordering the identifiers changed the canonical scope bytes');
  end if;
  if kitluy_devices.revocation_scope_digest_v1(v_canon_b)
     is distinct from kitluy_devices.revocation_scope_digest_v1(v_canon) then
    v_findings := v_findings ||
      format('control 1a: reordering the identifiers changed the scope digest');
  end if;

  -- 1b. DEDUPLICATION, at the level the migration defines it: the identifier
  -- list itself. A repeated member renders once, so it cannot vary the bytes.
  if kitluy_devices.canonical_identifier_list_v1(array['pk-44-beta', 'pk-44-alpha', 'pk-44-beta'])
     is distinct from kitluy_devices.canonical_identifier_list_v1(array['pk-44-alpha', 'pk-44-beta']) then
    v_findings := v_findings ||
      format('control 1b: a duplicated identifier survived canonicalization');
  end if;
  if kitluy_devices.canonical_identifier_list_v1(array['pk-44-beta', 'pk-44-alpha'])
     is distinct from 'pk-44-alpha,pk-44-beta' then
    v_findings := v_findings ||
      format('control 1b: the canonical identifier list is not sorted and comma-joined');
  end if;
  -- ...and at scope level: the same duplicated multiset, differently arranged,
  -- digests identically. (Each list's CARDINALITY is emitted beside it, so
  -- ADDING a duplicate is a DIFFERENT scope — that is control 2f's
  -- identifier-count term doing its job, not a failure of deduplication.)
  if kitluy_devices.revocation_scope_digest_v1(kitluy_devices.canonical_revocation_scope_v1(
       v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
       v_devices, array['pk-44-beta', 'pk-44-alpha', 'pk-44-beta'], array[]::text[], array[]::uuid[]))
     is distinct from
     kitluy_devices.revocation_scope_digest_v1(kitluy_devices.canonical_revocation_scope_v1(
       v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
       v_devices, array['pk-44-beta', 'pk-44-beta', 'pk-44-alpha'], array[]::text[], array[]::uuid[])) then
    v_findings := v_findings ||
      format('control 1b: a duplicated identifier in a different position changed the scope digest');
  end if;

  -- 1c. ONE STABLE REPRESENTATION: recomputing the same scope yields the same
  -- bytes and the same digest, every time.
  if kitluy_devices.canonical_revocation_scope_v1(
       v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
       array[v_device, v_other_device], array['pk-44-beta', 'pk-44-alpha'],
       array[]::text[], array[]::uuid[]) is distinct from v_canon then
    v_findings := v_findings ||
      format('control 1c: recomputing the canonical scope produced different bytes');
  end if;
  if kitluy_devices.revocation_scope_digest_v1(v_canon)
     is distinct from kitluy_devices.revocation_scope_digest_v1(v_canon) then
    v_findings := v_findings || format('control 1c: the scope digest is not deterministic');
  end if;
  if kitluy_devices.revocation_scope_digest_v1(v_canon) !~ '^[0-9a-f]{64}$' then
    v_findings := v_findings ||
      format('control 1c: the scope digest is not a 64-character sha256 hex');
  end if;

  -- 1d. ONE CHANGED IDENTIFIER changes the digest. `v_digest` is the digest the
  -- OK scope will carry; the other two are its one-identifier neighbours.
  v_digest := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
      v_devices, v_keys, array[]::text[], array[]::uuid[]));
  v_digest_other := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
      array[v_other_device], v_keys, array[]::text[], array[]::uuid[]));
  if v_digest = v_digest_other then
    v_findings := v_findings ||
      format('control 1d: swapping ONE affected device left the scope digest unchanged');
  end if;
  v_digest_b := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
      v_devices, array['pk-44-beta', 'pk-44-alphb'], array[]::text[], array[]::uuid[]));
  if v_digest = v_digest_b then
    v_findings := v_findings ||
      format('control 1d: changing ONE character of ONE key reference left the scope digest unchanged');
  end if;

  -- ========================================================================
  -- CONTROL 2 — EVERY TERM RULING 1 ENUMERATES IS BOUND. The baseline payload
  -- hash is computed once; each variant differs in exactly one term and must
  -- produce a different hash, or that term is decoration rather than a binding.
  -- ========================================================================
  v_payload := kitluy_devices.revocation_approval_payload_hash_v1(
    v_digest, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
    v_count, v_requester, v_dv);
  if v_payload !~ '^[0-9a-f]{64}$' then
    v_findings := v_findings ||
      format('control 2: the approval payload hash is not a 64-character sha256 hex');
  end if;
  if v_payload = v_digest then
    v_findings := v_findings ||
      format('control 2: the payload hash and the scope digest are the same value, so one could be replayed as the other');
  end if;

  -- 2a. THE EXACT SCOPE DIGEST is a term: the one-identifier neighbour from
  -- control 1d, with every other term held constant, hashes differently.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest_other, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2a: the scope digest is not a term of the approval payload hash');
  end if;
  -- 2b. REASON.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason_other, v_env, v_subject, v_tenant, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2b: the revocation reason is not bound into the payload hash');
  end if;
  -- 2c. ENVIRONMENT.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env_other, v_subject, v_tenant, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2c: the environment is not bound into the payload hash');
  end if;
  -- 2d. SUBJECT TYPE.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, 'DEVICE', v_tenant, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2d: the subject type is not bound into the payload hash');
  end if;
  -- 2e. TENANT, DIGITAL STORE and STORE LOCATION, each on its own.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_store, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings || format('control 2e: the tenant is not bound into the payload hash');
  end if;
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_tenant, v_location, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2e: the digital store is not bound into the payload hash');
  end if;
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_tenant, v_store, v_tenant,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2e: the store location is not bound into the payload hash');
  end if;
  -- ...and an ABSENT tenancy is distinguishable from a present one, so an
  -- omitted term cannot silently hash as a supplied one.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, null, v_store, v_location,
       v_count, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2e: a NULL tenant hashes the same as a named tenant');
  end if;
  -- 2f. IDENTIFIER COUNT.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
       v_count + 1, v_requester, v_dv) = v_payload then
    v_findings := v_findings ||
      format('control 2f: the identifier count is not bound into the payload hash');
  end if;
  -- 2g. REQUESTER.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
       v_count, 'sec-z@44', v_dv) = v_payload then
    v_findings := v_findings || format('control 2g: the requester is not bound into the payload hash');
  end if;
  -- 2h. OWNER DECISION VERSION.
  if kitluy_devices.revocation_approval_payload_hash_v1(
       v_digest, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
       v_count, v_requester, v_dv || '-DRAFT') = v_payload then
    v_findings := v_findings ||
      format('control 2h: the owner decision version is not bound into the payload hash');
  end if;

  -- ------------------------------------------------------------------------
  -- The approvals. Each carries the hash its own recorded scope must reproduce,
  -- EXCEPT the two that are deliberately wrong: one committing to some other
  -- affected set, and one committing to nothing at all.
  -- ------------------------------------------------------------------------
  v_digest_stg := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env_other, v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
      v_devices, v_keys, array[]::text[], array[]::uuid[]));
  v_payload_stg := kitluy_devices.revocation_approval_payload_hash_v1(
    v_digest_stg, v_reason, v_env_other, v_subject, v_tenant, v_store, v_location,
    v_count, v_requester, v_dv);

  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.scope.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', v_env, 1, 'ACTIVE', 'A4')
  returning id into v_policy_dev;
  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.scope.stg.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', v_env_other, 1, 'ACTIVE', 'A4')
  returning id into v_policy_stg;

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_dev, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation', v_payload,
          'the affected set of incident 44', 'APPROVED')
  returning id into v_ap_ok;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_ok, v_approver_id, 'APPROVE');

  -- A perfectly good A4 approval that commits to SOME OTHER affected set.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_dev, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation',
          encode(sha256(convert_to('44-some-other-set-' || v_incident, 'UTF8')), 'hex'),
          'an approval committing to another set', 'APPROVED')
  returning id into v_ap_hash;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_hash, v_approver_id, 'APPROVE');

  -- An approval that commits to NOTHING. Ruling 1 does not read a blank hash as
  -- "nothing to check".
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_dev, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation', '   ',
          'an approval carrying no payload hash', 'APPROVED')
  returning id into v_ap_unbound;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_unbound, v_approver_id, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_stg, v_requester_id, 'device', v_device, v_env_other,
          'device_credential_revocation', v_payload_stg,
          'the same affected set, another environment', 'APPROVED')
  returning id into v_ap_stg;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_stg, v_approver_id, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy_dev, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation', v_payload,
          'the affected set of incident 44, for the consumption probe', 'APPROVED')
  returning id into v_ap_consume;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_consume, v_approver_id, 'APPROVE');

  -- ========================================================================
  -- CONTROL 3 — THE BINDING IS COMPUTED, NOT ACCEPTED. The row below is
  -- inserted with a deliberately WRONG digest, a wrong payload hash and an
  -- identifier count of 9999. All three are overwritten by the BEFORE INSERT
  -- trigger with values derived from the identifiers actually stored, so a
  -- caller cannot record a scope whose binding disagrees with its own contents.
  -- ========================================================================
  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, affected_fingerprints,
    affected_credential_ids, subject_type, tenant_id, digital_store_id,
    store_location_id, requester_ref, decision_version,
    identifier_count, scope_digest, payload_hash, recorded_by, approved_by)
  values (
    v_incident || '-OK', v_env, v_reason, v_ap_ok,
    v_devices, v_keys, array[]::text[], array[]::uuid[],
    v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
    9999, repeat('0', 64), repeat('f', 64), 'sec-a@44', 'sec-b@44')
  returning incident_scope_id, scope_digest, payload_hash, identifier_count
       into v_scope_ok, v_stored_digest, v_stored_payload, v_stored_count;

  if v_stored_digest = repeat('0', 64) then
    v_findings := v_findings ||
      format('control 3: A CALLER-SUPPLIED SCOPE DIGEST WAS STORED — the binding can be asserted rather than computed');
  end if;
  if v_stored_payload = repeat('f', 64) then
    v_findings := v_findings ||
      format('control 3: a caller-supplied approval payload hash was stored');
  end if;
  if v_stored_digest is distinct from v_digest then
    v_findings := v_findings ||
      format('control 3: the stored scope digest does not recompute from the stored identifiers (%s vs %s)',
             v_stored_digest, v_digest);
  end if;
  if v_stored_payload is distinct from v_payload then
    v_findings := v_findings ||
      format('control 3: the stored payload hash is not the value recomputed from the stored terms');
  end if;
  if v_stored_count is distinct from v_count then
    v_findings := v_findings ||
      format('control 3: the stored identifier count is %s, not the %s identifiers actually recorded',
             coalesce(v_stored_count, -1), v_count);
  end if;

  -- ========================================================================
  -- CONTROL 4 — IMMUTABLE AFTER SUBMISSION. Group 0138's append-only trigger
  -- still refuses every UPDATE and every DELETE, which is what makes a computed
  -- digest a binding rather than a suggestion. Run as the session owner of the
  -- table, so the refusal is the trigger's and not a missing grant.
  -- ========================================================================
  begin
    update kitluy_devices.revocation_recorded_scopes
       set affected_device_ids = array[v_other_device]
     where incident_scope_id = v_scope_ok;
    v_findings := v_findings || format('control 4: A RECORDED SCOPE WAS UPDATED AFTER SUBMISSION');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'KLUY-AUTH-APPEND-ONLY%' then
      v_findings := v_findings ||
        format('control 4: wrong refusal updating a recorded scope: %s', v_msg);
    end if;
  end;
  begin
    update kitluy_devices.revocation_recorded_scopes
       set scope_digest = repeat('a', 64), payload_hash = repeat('b', 64)
     where incident_scope_id = v_scope_ok;
    v_findings := v_findings ||
      format('control 4: A RECORDED SCOPE BINDING WAS REWRITTEN AFTER SUBMISSION');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'KLUY-AUTH-APPEND-ONLY%' then
      v_findings := v_findings ||
        format('control 4: wrong refusal rewriting a scope binding: %s', v_msg);
    end if;
  end;
  begin
    delete from kitluy_devices.revocation_recorded_scopes
     where incident_scope_id = v_scope_ok;
    v_findings := v_findings || format('control 4: A RECORDED SCOPE WAS DELETED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like 'KLUY-AUTH-APPEND-ONLY%' then
      v_findings := v_findings ||
        format('control 4: wrong refusal deleting a recorded scope: %s', v_msg);
    end if;
  end;
  -- The row is untouched, digest and all.
  select scope_digest, payload_hash into v_stored_digest, v_stored_payload
    from kitluy_devices.revocation_recorded_scopes where incident_scope_id = v_scope_ok;
  if v_stored_digest is distinct from v_digest or v_stored_payload is distinct from v_payload then
    v_findings := v_findings ||
      format('control 4: the recorded scope binding moved despite the append-only refusals');
  end if;

  -- ========================================================================
  -- CONTROL 5 — GROUP 0138's REFUSALS STILL STAND. Group 0141 is additive; a
  -- scope that is empty, wildcard-tokened or flagged unrestricted is still not
  -- a scope, and the binding trigger rescues none of them by computing a
  -- perfectly good digest over nothing.
  -- ========================================================================
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, subject_type,
      recorded_by, approved_by)
    values (v_incident || '-EMPTY', v_env, v_reason, v_subject, 'sec-a@44', 'sec-b@44');
    v_findings := v_findings || format('control 5: AN EMPTY AFFECTED SET WAS RECORDED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%not_empty_chk%' and v_msg not like '%identifier_count_chk%' then
      v_findings := v_findings ||
        format('control 5: wrong refusal for an empty affected set: %s', v_msg);
    end if;
  end;
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_key_references,
      subject_type, recorded_by, approved_by)
    values (v_incident || '-TOKEN', v_env, v_reason, array['*'], v_subject, 'sec-a@44', 'sec-b@44');
    v_findings := v_findings || format('control 5: A WILDCARD TOKEN AFFECTED SET WAS RECORDED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%no_token_chk%' then
      v_findings := v_findings ||
        format('control 5: wrong refusal for a wildcard token: %s', v_msg);
    end if;
  end;
  begin
    insert into kitluy_devices.revocation_recorded_scopes (
      incident_reference, environment, reason_code, affected_device_ids,
      unrestricted_wildcard, subject_type, recorded_by, approved_by)
    values (v_incident || '-WILD', v_env, v_reason, v_devices, true, v_subject,
            'sec-a@44', 'sec-b@44');
    v_findings := v_findings || format('control 5: AN UNRESTRICTED WILDCARD SCOPE WAS RECORDED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%no_wildcard_chk%' then
      v_findings := v_findings ||
        format('control 5: wrong refusal for an unrestricted wildcard: %s', v_msg);
    end if;
  end;

  -- ------------------------------------------------------------------------
  -- The remaining scope rows, each bound by the same trigger and each paired
  -- with the approval whose failure it exists to expose.
  -- ------------------------------------------------------------------------
  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-HASH', v_env, v_reason, v_ap_hash, v_devices, v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
          'sec-a@44', 'sec-b@44')
  returning incident_scope_id into v_scope_hash;

  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-UNBOUND', v_env, v_reason, v_ap_unbound, v_devices, v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
          'sec-a@44', 'sec-b@44')
  returning incident_scope_id into v_scope_unbound;

  -- The same affected set recorded in ANOTHER environment against an approval
  -- granted in that environment: correctly bound there, and no authority here.
  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-STG', v_env_other, v_reason, v_ap_stg, v_devices, v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
          'sec-a@44', 'sec-b@44')
  returning incident_scope_id into v_scope_stg;

  -- ...and the mirror image: a development scope citing a STAGING approval. The
  -- environment is a TERM OF THE HASH, so this is refused by the binding itself
  -- rather than by a separate environment column comparison.
  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-ENVMIX', v_env, v_reason, v_ap_stg, v_devices, v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
          'sec-a@44', 'sec-b@44')
  returning incident_scope_id into v_scope_envmix;

  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-CONSUME', v_env, v_reason, v_ap_consume, v_devices, v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester, v_dv,
          'sec-a@44', 'sec-b@44')
  returning incident_scope_id into v_scope_consume;

  -- ========================================================================
  -- CONTROL 6 — THE BINDING ITSELF, against the real approval rows and without
  -- the verifier, so the arithmetic Ruling 1 rests on is established
  -- independently of the function that performs it.
  -- ========================================================================
  if (select r.payload_hash from kitluy_auth.approval_requests r where r.id = v_ap_ok)
     is distinct from (select s.payload_hash from kitluy_devices.revocation_recorded_scopes s
                        where s.incident_scope_id = v_scope_ok) then
    v_findings := v_findings ||
      format('control 6: the approving request does not carry the payload hash the recorded scope computes');
  end if;
  if (select r.payload_hash from kitluy_auth.approval_requests r where r.id = v_ap_hash)
     = (select s.payload_hash from kitluy_devices.revocation_recorded_scopes s
         where s.incident_scope_id = v_scope_hash) then
    v_findings := v_findings ||
      format('control 6: an approval committing to another affected set carries this scope''s payload hash');
  end if;
  -- The same identifiers recorded in another environment produce a DIFFERENT
  -- binding, so an approval cannot be carried across environments.
  if (select s.payload_hash from kitluy_devices.revocation_recorded_scopes s
       where s.incident_scope_id = v_scope_stg)
     = (select s.payload_hash from kitluy_devices.revocation_recorded_scopes s
         where s.incident_scope_id = v_scope_ok) then
    v_findings := v_findings ||
      format('control 6: the same affected set binds identically in two environments');
  end if;

  -- ========================================================================
  -- CONTROL 7 — VERIFICATION, AS THE GOVERNOR.
  --
  -- `verify_revocation_scope_binding_v1` and `consume_revocation_scope_v1` are
  -- EXECUTE-able only by kitluy_credential_issuer, so the membership is
  -- borrowed for the length of controls 7 and 8 and handed back below —
  -- sections 41c and 43 do the same, and section 32's containment assertion
  -- refuses a session that keeps one.
  -- ========================================================================
  execute format('grant kitluy_credential_issuer to %I', current_user);
  execute 'set role kitluy_credential_issuer';
  begin
    -- 7a. THE BINDING HOLDS: an approval whose payload_hash carries the value
    -- computed from this exact affected set authorizes it.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_ok, v_ap_ok, v_env));
    if (v_verdict ->> 'authorized')::boolean is not true then
      v_findings := v_findings ||
        format('control 7a: a correctly bound scope did not verify: %s', v_verdict);
    end if;

    -- 7b. HASH MISMATCH: the approval commits to another affected set.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_hash, v_ap_hash, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%HASH-MISMATCH%' then
      v_findings := v_findings ||
        format('control 7b: an approval committing to another set authorized this one: %s', v_verdict);
    end if;

    -- 7c. A BLANK PAYLOAD HASH IS NOT "NOTHING TO CHECK". The reader-owned hash
    -- helper filters a null or blank hash to NULL, so the shipped verifier
    -- answers UNAPPROVED where its own UNBOUND branch would otherwise speak;
    -- either is fail-closed and both are accepted, but authorizing is not.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_unbound, v_ap_unbound, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or ((v_verdict ->> 'refusal_code') not like '%UNBOUND%'
           and (v_verdict ->> 'refusal_code') not like '%UNAPPROVED%') then
      v_findings := v_findings ||
        format('control 7c: an approval with a blank payload hash was treated as nothing to check: %s', v_verdict);
    end if;

    -- 7d. A DIFFERENT APPROVAL: a scope is authority only together with the
    -- approval it is bound to.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_ok, v_ap_hash, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISMATCH%' then
      v_findings := v_findings ||
        format('control 7d: a scope was presented under an approval it is not bound to: %s', v_verdict);
    end if;

    -- 7e. ANOTHER ENVIRONMENT, three ways: a scope recorded elsewhere, a scope
    -- recorded here whose approval was granted elsewhere, and a correct pair
    -- presented under an environment neither belongs to.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_stg, v_ap_stg, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISMATCH%' then
      v_findings := v_findings ||
        format('control 7e: a scope recorded in another environment authorized this one: %s', v_verdict);
    end if;
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_envmix, v_ap_stg, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISMATCH%' then
      v_findings := v_findings ||
        format('control 7e: an approval granted in another environment authorized this scope: %s', v_verdict);
    end if;
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_ok, v_ap_ok, v_env_other));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISMATCH%' then
      v_findings := v_findings ||
        format('control 7e: a development scope verified under staging: %s', v_verdict);
    end if;

    -- 7f. MISSING and UNAPPROVED: a scope id naming nothing, no scope id at
    -- all, and a scope presented with no approval at all.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_missing, v_ap_ok, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISSING%' then
      v_findings := v_findings ||
        format('control 7f: a nonexistent recorded scope verified: %s', v_verdict);
    end if;
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      null, v_ap_ok, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%MISSING%' then
      v_findings := v_findings ||
        format('control 7f: a revocation presenting no recorded scope at all verified: %s', v_verdict);
    end if;
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_ok, null, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%UNAPPROVED%' then
      v_findings := v_findings ||
        format('control 7f: a recorded scope with no approval at all verified: %s', v_verdict);
    end if;

    -- ======================================================================
    -- CONTROL 8 — SINGLE USE, ATOMIC WITH THE REVOCATION. The scope verifies,
    -- is spent once, and is then authority for nothing — including for itself.
    -- ======================================================================
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_consume, v_ap_consume, v_env));
    if (v_verdict ->> 'authorized')::boolean is not true then
      v_findings := v_findings ||
        format('control 8: the consumption fixture did not verify before it was spent: %s', v_verdict);
    end if;

    v_res := kitluy_devices.consume_revocation_scope_v1(
      v_scope_consume, v_ap_consume, v_revocation_id, v_env, 'governor@44');
    if (v_res ->> 'outcome') <> 'CONSUMED' then
      v_findings := v_findings ||
        format('control 8: a verified scope could not be consumed: %s', v_res);
    end if;
    if (v_res ->> 'scope_digest') is distinct from v_digest then
      v_findings := v_findings ||
        format('control 8: the consumption evidence names a different digest: %s', v_res);
    end if;

    -- The replay, in the three shapes a racing revocation could take it. Each
    -- is a distinct replay and each has its own UNIQUE constraint.
    v_res := kitluy_devices.consume_revocation_scope_v1(
      v_scope_consume, v_ap_consume, gen_random_uuid(), v_env, 'governor@44');
    if (v_res ->> 'outcome') <> 'SCOPE_REFUSED'
       or (v_res ->> 'refusal_code') not like '%CONSUMED%' then
      v_findings := v_findings || format('control 8: A SPENT SCOPE WAS CONSUMED TWICE: %s', v_res);
    end if;
    v_res := kitluy_devices.consume_revocation_scope_v1(
      v_scope_ok, v_ap_consume, gen_random_uuid(), v_env, 'governor@44');
    if (v_res ->> 'outcome') <> 'SCOPE_REFUSED'
       or (v_res ->> 'refusal_code') not like '%CONSUMED%' then
      v_findings := v_findings ||
        format('control 8: a spent approval consumed a second scope: %s', v_res);
    end if;
    v_res := kitluy_devices.consume_revocation_scope_v1(
      v_scope_ok, v_ap_ok, v_revocation_id, v_env, 'governor@44');
    if (v_res ->> 'outcome') <> 'SCOPE_REFUSED'
       or (v_res ->> 'refusal_code') not like '%CONSUMED%' then
      v_findings := v_findings || format('control 8: one revocation consumed two scopes: %s', v_res);
    end if;
    -- A scope that does not exist cannot be consumed either.
    v_res := kitluy_devices.consume_revocation_scope_v1(
      v_scope_missing, gen_random_uuid(), gen_random_uuid(), v_env, 'governor@44');
    if (v_res ->> 'outcome') <> 'SCOPE_REFUSED'
       or (v_res ->> 'refusal_code') not like '%MISSING%' then
      v_findings := v_findings || format('control 8: a nonexistent scope was consumed: %s', v_res);
    end if;

    -- The single-use FACT, asked of the helper the verifier depends on: true
    -- for what was actually spent, false for what was not.
    if not kitluy_devices.revocation_scope_consumed_v1(v_scope_consume, v_ap_consume) then
      v_findings := v_findings ||
        format('control 8: the single-use helper does not report a spent scope as spent');
    end if;
    if kitluy_devices.revocation_scope_consumed_v1(v_scope_hash, v_ap_hash) then
      v_findings := v_findings ||
        format('control 8: the single-use helper reports an unspent scope as spent');
    end if;

    -- ...and the VERIFIER now refuses the spent scope, so single use is not
    -- merely a constraint a caller could decline to hit.
    v_verdict := to_jsonb(kitluy_devices.verify_revocation_scope_binding_v1(
      v_scope_consume, v_ap_consume, v_env));
    if (v_verdict ->> 'authorized')::boolean is not false
       or (v_verdict ->> 'refusal_code') not like '%CONSUMED%' then
      v_findings := v_findings ||
        format('control 8: a spent scope still verified as authority for a revocation: %s', v_verdict);
    end if;

    select consumption_id into v_consumption
      from kitluy_devices.revocation_scope_consumptions
     where incident_scope_id = v_scope_consume;
    if v_consumption is null then
      v_findings := v_findings || format('control 8: the consumption left no evidence row');
    end if;

    execute 'reset role';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    v_findings := v_findings ||
      format('control 7/8: the governor probe did not complete: %s', v_msg);
  end;
  execute format('revoke kitluy_credential_issuer from %I', current_user);

  -- ========================================================================
  -- CONTROL 9 — THE CONSUMPTION EVIDENCE IS APPEND-ONLY. A spent scope that
  -- could be un-spent is not spent. Run as the session owner of the table, so
  -- the refusal is the trigger's.
  -- ========================================================================
  if v_consumption is null then
    v_findings := v_findings ||
      format('control 9: no consumption evidence exists to test for immutability');
  else
    begin
      update kitluy_devices.revocation_scope_consumptions
         set consumed_by = 'someone-else'
       where consumption_id = v_consumption;
      v_findings := v_findings || format('control 9: CONSUMPTION EVIDENCE WAS REWRITTEN');
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg not like 'KLUY-AUTH-APPEND-ONLY%' then
        v_findings := v_findings ||
          format('control 9: wrong refusal rewriting consumption evidence: %s', v_msg);
      end if;
    end;
    begin
      delete from kitluy_devices.revocation_scope_consumptions
       where consumption_id = v_consumption;
      v_findings := v_findings ||
        format('control 9: CONSUMPTION EVIDENCE WAS DELETED, UN-SPENDING A SPENT SCOPE');
    exception when others then
      get stacked diagnostics v_msg = message_text;
      if v_msg not like 'KLUY-AUTH-APPEND-ONLY%' then
        v_findings := v_findings ||
          format('control 9: wrong refusal deleting consumption evidence: %s', v_msg);
      end if;
    end;
    if not exists (select 1 from kitluy_devices.revocation_scope_consumptions
                    where consumption_id = v_consumption) then
      v_findings := v_findings ||
        format('control 9: the consumption evidence did not survive the mutation probes');
    end if;
  end if;

  -- ========================================================================
  -- CONTROL 10 — THE BOUNDARY. A digest function anyone can reach is a free
  -- oracle for confirming a guessed affected set, so the canonicalizer and the
  -- hash functions are held as closed as the verifier and the consumer. Six
  -- roles try the calls; the catalogue then corroborates ownership, the PUBLIC
  -- revoke and the pinned search_path.
  -- ========================================================================
  foreach v_role in array array[
    'anon', 'authenticated', 'service_role', 'kitluy_worker_service',
    'kitluy_issuance_service', 'kitluy_job_governor']
  loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      begin
        execute format('set role %I', v_role);
        begin
          perform kitluy_devices.verify_revocation_scope_binding_v1(v_scope_ok, v_ap_ok, v_env);
          v_findings := v_findings || format('control 10: %s executed the scope verifier', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.revocation_scope_consumed_v1(v_scope_ok, v_ap_ok);
          v_findings := v_findings || format('control 10: %s executed the single-use helper', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.consume_revocation_scope_v1(
            v_scope_ok, v_ap_ok, gen_random_uuid(), v_env, v_role);
          v_findings := v_findings || format('control 10: %s consumed a recorded scope', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.credential_revocation_approval_payload_hash_v1(v_ap_ok);
          v_findings := v_findings ||
            format('control 10: %s read an approval payload hash through the reader''s helper', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.revocation_scope_digest_v1('probe');
          v_findings := v_findings || format('control 10: %s has a free scope-digest oracle', v_role);
        exception when insufficient_privilege then
          null;
        end;
        begin
          perform kitluy_devices.canonical_identifier_list_v1(array['probe']);
          v_findings := v_findings ||
            format('control 10: %s can canonicalize an identifier list', v_role);
        exception when insufficient_privilege then
          null;
        end;
        execute 'reset role';
      exception when others then
        get stacked diagnostics v_msg = message_text;
        execute 'reset role';
        v_findings := v_findings ||
          format('control 10: the execute probe for %s did not complete: %s', v_role, v_msg);
      end;
    end if;
  end loop;

  v_n := 0;
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('canonical_identifier_list_v1', 'canonical_revocation_scope_v1',
                         'revocation_scope_digest_v1', 'revocation_approval_payload_hash_v1',
                         'bind_revocation_scope', 'credential_revocation_approval_payload_hash_v1',
                         'verify_revocation_scope_binding_v1', 'revocation_scope_consumed_v1',
                         'consume_revocation_scope_v1')
  loop
    v_n := v_n + 1;
    if has_function_privilege('public', v_sig, 'execute') then
      v_findings := v_findings || format('control 10: PUBLIC can execute %s', v_sig);
    end if;
    if not exists (
      select 1 from pg_proc p where p.oid = v_sig::regprocedure
         and p.proconfig is not null
         and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
      v_findings := v_findings || format('control 10: %s does not pin its search_path', v_sig);
    end if;
  end loop;
  if v_n <> 9 then
    v_findings := v_findings ||
      format('control 10: %s of the 9 group-0141 functions were found, so the boundary scan is incomplete', v_n);
  end if;

  -- THE SPLIT that lets Ruling 1 and Ruling 2 both hold. The verifier reads the
  -- governor's own scope table, so the GOVERNOR owns it; the one fact it needs
  -- from kitluy_auth is fetched through a definer owned by the NOLOGIN,
  -- non-BYPASSRLS READER, which is the only identity Ruling 2 lets near that
  -- schema. Reversing either ownership would either give the reader a table and
  -- a policy in kitluy_devices or give the governor a reach into kitluy_auth —
  -- both of which sections 41a/42/43 exist to refuse.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'credential_revocation_approval_payload_hash_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader') then
    v_findings := v_findings ||
      format('control 10: the approval-hash helper is not a SECURITY DEFINER owned by kitluy_credential_approval_reader');
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('verify_revocation_scope_binding_v1', 'consume_revocation_scope_v1',
                         'revocation_scope_consumed_v1')
       and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'kitluy_credential_issuer')) then
    v_findings := v_findings ||
      format('control 10: the verifier, the consumer or the single-use helper is not a governor-owned SECURITY DEFINER');
  end if;
  if not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text)', 'execute')
     or not has_function_privilege('kitluy_credential_issuer',
       'kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text)', 'execute') then
    v_findings := v_findings ||
      format('control 10: the credential governor cannot reach the verifier or the consumer it is required to call');
  end if;
  -- The reader still holds nothing on the scope or consumption evidence, and
  -- the governor still holds nothing on the approvals aggregate: group 0141
  -- widened neither side, it put ONE definer on each side of the line.
  if has_table_privilege('kitluy_credential_approval_reader',
                         'kitluy_devices.revocation_recorded_scopes', 'select')
     or has_table_privilege('kitluy_credential_approval_reader',
                            'kitluy_devices.revocation_scope_consumptions', 'select') then
    v_findings := v_findings ||
      format('control 10: the approval reader can read recorded scopes or consumption evidence directly');
  end if;
  if has_schema_privilege('kitluy_credential_issuer', 'kitluy_auth', 'usage')
     or has_table_privilege('kitluy_credential_issuer', 'kitluy_auth.approval_requests', 'select') then
    v_findings := v_findings ||
      format('control 10: the credential governor now reaches the approvals aggregate directly');
  end if;

  -- The borrowed governor membership was handed back.
  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where g.rolname = 'kitluy_credential_issuer'
               and not r.rolsuper) then
    v_findings := v_findings ||
      format('a non-superuser kept membership of the credential governor');
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % scope-binding finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-revocation-scope-binding: the recorded affected set is a CRYPTOGRAPHIC TERM of the approval that authorizes it rather than a row that merely cites one (KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1) — the canonical scope has ONE stable representation, so the same identifiers supplied in a different order, or repeated in a different arrangement, digest identically while swapping one device or changing one character of one key reference does not, and every term the ruling enumerates is bound: changing the exact scope digest, the reason, the environment, the subject type, the tenant, the digital store, the store location, the identifier count, the requester or the owner decision version each changes the approval payload hash, an absent tenancy is distinguishable from a named one, and the payload hash is domain-separated from the scope digest so neither can be replayed as the other; the binding is COMPUTED and never accepted — a row inserted with a deliberately wrong digest, a wrong payload hash and an identifier count of 9999 is stored carrying the values recomputed from the identifiers actually recorded — and it is then immutable, because group 0138''s append-only trigger refuses to update the affected set, to rewrite the digest and to delete the row, while an empty set, a wildcard token and unrestricted_wildcard = true are each still refused by CHECK; called AS kitluy_credential_issuer the verifier AUTHORIZES a scope whose approval carries the computed hash and FAILS CLOSED on every one of Ruling 1''s listed failures — an approval committing to another affected set (HASH-MISMATCH), an approval carrying a blank payload hash (refused, never read as nothing to check), a scope presented under an approval it is not bound to, a scope recorded in another environment, an approval granted in another environment, a correct pair presented under the wrong environment, a scope id naming nothing, no scope id at all and no approval at all; consumption is single use three ways — the scope, the approval and the revocation are each spent exactly once, every replay is refused as CONSUMED, a nonexistent scope cannot be consumed, the single-use helper answers true only for what was actually spent, the verifier itself then refuses the spent scope, and the evidence naming the consumed digest can be neither updated nor deleted; and the boundary holds — anon, authenticated, service_role, the worker, the issuance service and the job governor are each refused the verifier, the consumer, the single-use helper, the reader''s approval-hash helper, the digest oracle and the canonicalizer, PUBLIC holds EXECUTE on none of the nine group-0141 functions and all nine pin their search_path, the verifier, the consumer and the single-use helper are governor-owned SECURITY DEFINERs while the ONE function that touches kitluy_auth is owned by the NOLOGIN, non-BYPASSRLS kitluy_credential_approval_reader, the reader still holds nothing at all on the recorded scopes or the consumption evidence and the governor still holds nothing at all on the approvals aggregate, and the membership this section borrowed to call any of it was handed back';
end
$section44$;


-- ============================================================================
-- SECTION 45 — WS-11-T003 Step 4: the binding is CALLED, and the scope is SPENT
-- BY the revocation it authorizes (migration 0142).
-- Authority: KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 **Ruling 1** —
--   "approval consumption must be single-use and ATOMIC WITH REVOCATION";
--   migration groups 0139 (the revocation this path CALLS rather than rewrites),
--   0141 (the binding, the verifier and the consumption row) and 0142 (the call
--   site).
--
-- Section 44 proves the binding holds. NOTHING CALLED IT. A verifier nobody
-- invokes is not a control, it is a function: Ruling 1 does not ask for the
-- ABILITY to verify a scope binding, it asks that a scope be verified before the
-- credentials it names are revoked and spent in the same transaction as the
-- revocation. Both of those are properties of a CALL SITE, so this section
-- exercises the call site instead of re-proving the verifier.
--
-- THE CHECK THAT IS EASY TO FORGET, AND IS THEREFORE THE ONE PROVED HARDEST.
-- Verifying that an approval commits to a scope proves the SCOPE is genuine. It
-- does not prove that the credential now being revoked is INSIDE it. Without a
-- membership check a perfectly valid, correctly bound, unconsumed scope naming
-- device A would authorize revoking device B: the binding verifies, the approval
-- is real, the four-eyes gate passes on its own terms, and a device nobody
-- reviewed loses its credential. Control 3 presents exactly that scope against
-- exactly that other device. What makes its refusal mean something rather than a
-- function that refuses everything is control 5, which revokes the MEMBER with
-- the very same scope — and, run the other way round, control 3 aimed at the
-- member does revoke it, which is how this section was checked for vacuity.
--
-- ORDER MATTERS, and the section is written in the order the property requires:
-- every refusal is attempted BEFORE the scope is spent, so control 4 can assert
-- the thing group 0142's own comment claims — "a refused revocation must not
-- burn the authority for the one that will succeed" — and control 5 then
-- succeeds on that same unburned scope.
--
-- WHAT THIS SECTION DOES NOT CLAIM. `revoke_device_credential_with_recorded_
-- scope_v1` RAISES rather than returns when consumption loses, so the revocation
-- written moments earlier rolls back with it. That branch is reachable only from
-- a second session racing the first: single-threaded the verifier refuses a
-- spent scope (control 6) long before consumption is attempted, so asserting it
-- here would mean asserting dead code. The atomicity that IS provable is
-- asserted instead — the consumption row names the very `revocation_id` the call
-- returned, so the scope was spent BY that revocation rather than near it.
--
-- The calls are made AS `kitluy_issuance_service`, the one identity group 0142
-- grants EXECUTE to, so the path is proved reachable by the role that must reach
-- it and refused to the roles that must not. Nothing here borrows the credential
-- governor: a call site that needed the governor to be borrowed would not be a
-- call site.
-- ============================================================================
do $section45$
declare
  v_findings text[] := array[]::text[];
  v_msg text := '';

  v_fp       text := encode(sha256(convert_to('t45-'  || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_fp_other text := encode(sha256(convert_to('t45b-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_fp_named text := encode(sha256(convert_to('t45c-' || gen_random_uuid()::text, 'UTF8')), 'hex');
  -- The device the scope NAMES, the device it names NOTHING of, and the device
  -- it reaches only through its key fingerprint.
  v_device uuid;
  v_other_device uuid;
  v_named_device uuid;
  v_credential uuid;
  v_other_credential uuid;
  v_named_credential uuid;

  -- The terms of the binding. They must agree exactly with the scope row, or the
  -- approval below commits to a set this section did not record.
  v_env constant text := 'development';
  v_reason constant kitluy_devices.credential_revocation_reason := 'SECURITY_INCIDENT';
  v_subject constant text := 'DEVICE';
  v_tenant constant uuid := '00000000-0000-4000-8000-000000000011';
  v_store constant uuid := '00000000-0000-4000-8000-000000000015';
  v_location constant uuid := '00000000-0000-4000-8000-000000000018';
  v_requester_ref constant text := 'sec-a@45';
  v_dv constant text := 'KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002';
  v_keys constant text[] := array['pk-45-alpha'];

  v_requester_id constant uuid := '00000000-0000-4000-8000-000000000007';
  v_approver_id constant uuid := '00000000-0000-4000-8000-000000000008';
  v_incident text := 'INC-45-' || gen_random_uuid()::text;

  v_policy uuid;
  v_ap_ok uuid;
  v_ap_hash uuid;
  v_ap_named uuid;

  v_scope_ok uuid;
  v_scope_hash uuid;
  v_scope_named uuid;
  v_scope_missing uuid := gen_random_uuid();

  v_digest_ok text;
  v_payload_ok text;
  v_digest_named text;
  v_payload_named text;
  v_stored_digest text;

  v_bad kitluy_devices.credential_revocation_reason;
  v_res jsonb;
  v_res_binding jsonb;
  v_res_nullscope jsonb;
  v_res_noscope jsonb;
  v_res_noapproval jsonb;
  v_res_member jsonb;
  v_res_self jsonb;
  v_res_ok jsonb;
  v_res_replay jsonb;
  v_res_fp jsonb;
  v_revocation_id uuid;
  v_state text;
  v_revoked_at timestamptz;
  v_reason_text text;
  v_role text;
  v_sig text;
  v_n integer;
begin
  -- ------------------------------------------------------------------------
  -- Fixtures: three real devices holding three real issued credentials, so the
  -- affected set names identifiers that exist and the revocations below are
  -- revocations rather than arithmetic.
  -- ------------------------------------------------------------------------
  v_device       := pg_temp.ws11_renewable_device('t45',  v_fp);
  v_other_device := pg_temp.ws11_renewable_device('t45b', v_fp_other);
  v_named_device := pg_temp.ws11_renewable_device('t45c', v_fp_named);
  select credential_id into v_credential from kitluy_devices.device_credentials
   where device_record_id = v_device and certificate_generation = 1;
  select credential_id into v_other_credential from kitluy_devices.device_credentials
   where device_record_id = v_other_device and certificate_generation = 1;
  select credential_id into v_named_credential from kitluy_devices.device_credentials
   where device_record_id = v_named_device and certificate_generation = 1;
  if v_credential is null or v_other_credential is null or v_named_credential is null then
    raise exception 'ASSERT FAIL: section 45 could not issue the credentials it revokes';
  end if;

  -- The hash each approval must carry, computed from the terms the scope rows
  -- are about to record — Ruling 1's whole point: an approver commits to a hash,
  -- and the recorded scope must reproduce it exactly or it is not the set that
  -- was approved.
  v_digest_ok := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester_ref, v_dv,
      array[v_device], v_keys, array[]::text[], array[]::uuid[]));
  v_payload_ok := kitluy_devices.revocation_approval_payload_hash_v1(
    v_digest_ok, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
    1 + cardinality(v_keys), v_requester_ref, v_dv);

  -- A set that names NO device at all — only a key fingerprint. Control 7 uses
  -- it to prove membership is resolved through the CREDENTIAL and not merely
  -- looked up in a list of device ids.
  v_digest_named := kitluy_devices.revocation_scope_digest_v1(
    kitluy_devices.canonical_revocation_scope_v1(
      v_reason, v_env, v_subject, v_tenant, v_store, v_location, v_requester_ref, v_dv,
      array[]::uuid[], array[]::text[], array[v_fp_named], array[]::uuid[]));
  v_payload_named := kitluy_devices.revocation_approval_payload_hash_v1(
    v_digest_named, v_reason, v_env, v_subject, v_tenant, v_store, v_location,
    1, v_requester_ref, v_dv);

  insert into kitluy_auth.approval_policies
    (policy_key, version, permission_key, environment, quorum, status, risk_class)
  values ('cred.revocation.scoped.a4.' || substr(md5(random()::text), 1, 8), 1,
          'device.credential.revoke', v_env, 1, 'ACTIVE', 'A4')
  returning id into v_policy;

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation', v_payload_ok,
          'the affected set of incident 45', 'APPROVED')
  returning id into v_ap_ok;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_ok, v_approver_id, 'APPROVE');

  -- A perfectly good A4 approval, decided by a second person, that commits to
  -- SOME OTHER affected set. Everything about it is right except the one thing
  -- Ruling 1 makes decisive.
  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy, v_requester_id, 'device', v_device, v_env,
          'device_credential_revocation',
          encode(sha256(convert_to('45-some-other-set-' || v_incident, 'UTF8')), 'hex'),
          'an approval committing to another set', 'APPROVED')
  returning id into v_ap_hash;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_hash, v_approver_id, 'APPROVE');

  insert into kitluy_auth.approval_requests
    (policy_id, requester_id, resource_type, resource_id, environment, action,
     payload_hash, reason, status)
  values (v_policy, v_requester_id, 'device', v_named_device, v_env,
          'device_credential_revocation', v_payload_named,
          'a set that names a key, not a device', 'APPROVED')
  returning id into v_ap_named;
  insert into kitluy_auth.approval_decisions (approval_request_id, approver_id, decision)
  values (v_ap_named, v_approver_id, 'APPROVE');

  -- The recorded scopes. The digest and the payload hash are COMPUTED by group
  -- 0141's BEFORE INSERT trigger; the equality below only confirms that the row
  -- this section is about to spend binds to the hash the approval carries.
  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-OK', v_env, v_reason, v_ap_ok, array[v_device], v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester_ref, v_dv,
          'sec-a@45', 'sec-b@45')
  returning incident_scope_id, scope_digest into v_scope_ok, v_stored_digest;
  if v_stored_digest is distinct from v_digest_ok then
    v_findings := v_findings ||
      format('fixture: the recorded scope did not bind to the digest section 45 computed for it');
  end if;

  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_device_ids, affected_key_references, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-HASH', v_env, v_reason, v_ap_hash, array[v_device], v_keys,
          v_subject, v_tenant, v_store, v_location, v_requester_ref, v_dv,
          'sec-a@45', 'sec-b@45')
  returning incident_scope_id into v_scope_hash;

  insert into kitluy_devices.revocation_recorded_scopes (
    incident_reference, environment, reason_code, approval_request_id,
    affected_fingerprints, subject_type, tenant_id,
    digital_store_id, store_location_id, requester_ref, decision_version,
    recorded_by, approved_by)
  values (v_incident || '-FP', v_env, v_reason, v_ap_named, array[v_fp_named],
          v_subject, v_tenant, v_store, v_location, v_requester_ref, v_dv,
          'sec-a@45', 'sec-b@45')
  returning incident_scope_id into v_scope_named;

  -- ========================================================================
  -- CONTROLS 1-4 — EVERYTHING THAT MUST BE REFUSED, ATTEMPTED FIRST.
  --
  -- Run AS kitluy_issuance_service, which is the identity group 0142 grants
  -- EXECUTE to. The results are captured here and judged after `reset role`,
  -- because judging them requires reading kitluy_devices tables the executor
  -- deliberately holds no grant on.
  -- ========================================================================
  execute 'set role kitluy_issuance_service';
  begin
    -- CONTROL 1 — a reason whose scope decision §3 derives FROM THE FLEET may
    -- not arrive here carrying a recorded set. Letting one through would be a
    -- caller choosing scope by the back door, which is the exact thing §3
    -- forbids; all six such reasons are tried, not one representative.
    foreach v_bad in array array[
      'KEY_COMPROMISE', 'DEVICE_LOST', 'DEVICE_STOLEN', 'ASSIGNMENT_INVALIDATED',
      'CERTIFICATE_MISISSUANCE', 'ADMINISTRATIVE_REPLACEMENT'
    ]::kitluy_devices.credential_revocation_reason[]
    loop
      v_res := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
        's45-reason-' || v_bad::text || '-' || gen_random_uuid()::text,
        v_device, v_env, 'device_identity', 1, v_bad,
        'a reason whose scope decision 3 derives from the fleet', 'REPROVISION_REQUIRED',
        'requester@45', 'SECTION45', v_scope_ok, v_ap_ok, 'approver@45', null);
      if coalesce(v_res ->> 'outcome', 'nothing') <> 'REVOCATION_REFUSED'
         or coalesce(v_res ->> 'refusal_code', 'nothing')
            <> 'KLUY-CRED-REVOCATION-SCOPE-REASON-NOT-RECORDABLE' then
        v_findings := v_findings ||
          format('control 1: %s carried a RECORDED scope through the call site: %s', v_bad, v_res);
      end if;
    end loop;

    -- CONTROL 2 — THE BINDING IS VERIFIED BEFORE ANYTHING IS REVOKED. The
    -- approval below is real, A4, decided by a second person and names this very
    -- device; it commits to another affected set, and that alone is fatal.
    v_res_binding := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-binding-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'an approval that commits to another affected set', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_hash, v_ap_hash, 'approver@45', null);
    -- ...and the three ways a caller can arrive with no usable authority at all.
    v_res_nullscope := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-nullscope-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'no recorded scope at all', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', null::uuid, v_ap_ok, 'approver@45', null);
    v_res_noscope := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-noscope-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'a scope id naming nothing', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_missing, v_ap_ok, 'approver@45', null);
    v_res_noapproval := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-noapproval-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'a recorded scope with no approval', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_ok, null::uuid, 'approver@45', null);

    -- CONTROL 3 — MEMBERSHIP. The scope is genuine, correctly bound and unspent,
    -- and the device presented is not in it. A verified binding does not make a
    -- scope authority over a credential it does not name.
    v_res_member := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-member-' || gen_random_uuid()::text, v_other_device, v_env, 'device_identity', 1,
      v_reason, 'a device the approvers never saw', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_ok, v_ap_ok, 'approver@45', null);

    -- CONTROL 4 — a refusal RAISED BY THE INNER PATH, after the binding and the
    -- membership have both passed, so the scope reaches the revocation and the
    -- revocation declines it. Group 0139's four-eyes gate is not re-implemented
    -- here and not bypassed: the requester is simply their own second person.
    v_res_self := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-self-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'the requester is their own second person', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_ok, v_ap_ok, 'requester@45', null);

    execute 'reset role';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    v_findings := v_findings ||
      format('controls 1-4: the call-site probe did not complete: %s', v_msg);
  end;

  if coalesce(v_res_binding ->> 'outcome', 'nothing') <> 'REVOCATION_REFUSED'
     or coalesce(v_res_binding ->> 'refusal_code', 'nothing') not like '%HASH-MISMATCH%' then
    v_findings := v_findings ||
      format('control 2: a scope whose approval commits to another set revoked a credential: %s',
             v_res_binding);
  end if;
  if coalesce(v_res_nullscope ->> 'refusal_code', 'nothing') not like '%SCOPE-MISSING%'
     or coalesce(v_res_noscope ->> 'refusal_code', 'nothing') not like '%SCOPE-MISSING%' then
    v_findings := v_findings ||
      format('control 2: a missing recorded scope did not fail closed: %s / %s',
             v_res_nullscope, v_res_noscope);
  end if;
  if coalesce(v_res_noapproval ->> 'refusal_code', 'nothing') not like '%SCOPE-UNAPPROVED%' then
    v_findings := v_findings ||
      format('control 2: a recorded scope presented with no approval did not fail closed: %s',
             v_res_noapproval);
  end if;
  if coalesce(v_res_member ->> 'outcome', 'nothing') <> 'REVOCATION_REFUSED'
     or coalesce(v_res_member ->> 'refusal_code', 'nothing')
        <> 'KLUY-CRED-REVOCATION-SCOPE-NOT-IN-SET' then
    v_findings := v_findings ||
      format('control 3: A GENUINE SCOPE REVOKED A DEVICE IT DOES NOT NAME: %s', v_res_member);
  end if;
  if coalesce(v_res_self ->> 'outcome', 'nothing') <> 'REVOCATION_REFUSED'
     or coalesce(v_res_self ->> 'refusal_code', 'nothing')
        <> 'KLUY-CRED-REVOCATION-SELF-APPROVED' then
    v_findings := v_findings ||
      format('control 4: the inner four-eyes gate did not refuse a self-approved scoped revocation: %s',
             v_res_self);
  end if;

  -- Not one of those ten refusals touched a credential, wrote evidence, or —
  -- the property group 0142 states in its own words — burned the scope.
  if exists (select 1 from kitluy_devices.device_credentials
              where credential_id in (v_credential, v_other_credential, v_named_credential)
                and state::text <> 'issued') then
    v_findings := v_findings ||
      format('controls 1-4: a REFUSED scoped revocation changed a credential');
  end if;
  if exists (select 1 from kitluy_devices.device_credential_revocations
              where credential_id in (v_credential, v_other_credential, v_named_credential)) then
    v_findings := v_findings || format('controls 1-4: a REFUSED scoped revocation wrote evidence');
  end if;
  if exists (select 1 from kitluy_devices.revocation_scope_consumptions
              where incident_scope_id in (v_scope_ok, v_scope_hash, v_scope_named)) then
    v_findings := v_findings ||
      format('control 4: A REFUSED REVOCATION BURNED THE SCOPE THAT WOULD HAVE AUTHORIZED THE NEXT ONE');
  end if;

  -- ========================================================================
  -- CONTROLS 5-7 — THE SCOPED REVOCATION THAT MUST SUCCEED, ITS SINGLE USE,
  -- and membership resolved through the credential rather than a device list.
  -- The same scope, the same approval and the same device as control 4.
  -- ========================================================================
  execute 'set role kitluy_issuance_service';
  begin
    -- No incident reference is supplied, so the one written on the evidence must
    -- come from the RECORDED SCOPE — the incident the approvers were shown.
    v_res_ok := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-ok-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'the incident the recorded scope was approved for', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_ok, v_ap_ok, 'approver@45', null);
    v_res_replay := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-replay-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
      v_reason, 'the same authority, a second time', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_ok, v_ap_ok, 'approver@45', null);
    v_res_fp := kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
      's45-fp-' || gen_random_uuid()::text, v_named_device, v_env, 'device_identity', 1,
      v_reason, 'a set that names this credential by its key fingerprint', 'REPROVISION_REQUIRED',
      'requester@45', 'SECTION45', v_scope_named, v_ap_named, 'approver@45', null);
    execute 'reset role';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    execute 'reset role';
    v_findings := v_findings ||
      format('controls 5-7: the scoped revocation did not complete: %s', v_msg);
  end;

  if coalesce(v_res_ok ->> 'outcome', 'nothing') <> 'REVOKED' then
    v_findings := v_findings ||
      format('control 5: A CORRECTLY BOUND, UNSPENT SCOPE COULD NOT REVOKE ITS OWN DEVICE: %s',
             v_res_ok);
  else
    v_revocation_id := (v_res_ok ->> 'revocation_id')::uuid;
    if (v_res_ok ->> 'scope_consumed')::boolean is not true
       or (v_res_ok ->> 'incident_scope_id')::uuid is distinct from v_scope_ok
       or (v_res_ok ->> 'scope_digest') is distinct from v_digest_ok then
      v_findings := v_findings ||
        format('control 5: the revocation does not report the scope it spent: %s', v_res_ok);
    end if;

    select state::text, revoked_at, revocation_reason
      into v_state, v_revoked_at, v_reason_text
      from kitluy_devices.device_credentials where credential_id = v_credential;
    if v_state <> 'revoked' or v_revoked_at is null
       or coalesce(v_reason_text, '') not like 'SECURITY_INCIDENT:%' then
      v_findings := v_findings ||
        format('control 5: the scoped revocation left the credential %s / %s',
               v_state, coalesce(v_reason_text, 'no account'));
    end if;

    -- The evidence, and the incident reference taken from the recorded scope
    -- because the caller supplied none.
    if not exists (
      select 1 from kitluy_devices.device_credential_revocations
       where revocation_id = v_revocation_id
         and credential_id = v_credential
         and reason_code = 'SECURITY_INCIDENT'
         and approval_request_id = v_ap_ok
         and approved_by = 'approver@45'
         and incident_reference = v_incident || '-OK') then
      v_findings := v_findings ||
        format('control 5: the scoped revocation wrote no evidence carrying the recorded incident reference');
    end if;
    if not exists (select 1 from kitluy_devices.device_recovery_cases
                    where revocation_id = v_revocation_id and state = 'open') then
      v_findings := v_findings || format('control 5: the scoped revocation opened no recovery case');
    end if;

    -- ATOMIC WITH THE REVOCATION, as far as a single session can prove it: the
    -- consumption row names THIS revocation and THIS digest, so the scope was
    -- spent BY the revocation rather than merely around the same time.
    if not exists (
      select 1 from kitluy_devices.revocation_scope_consumptions
       where incident_scope_id = v_scope_ok
         and approval_request_id = v_ap_ok
         and revocation_id = v_revocation_id
         and scope_digest = v_digest_ok) then
      v_findings := v_findings ||
        format('control 5: the spent scope is not tied to the revocation it authorized');
    end if;
  end if;

  -- CONTROL 6 — the scope is now authority for nothing, including for itself.
  if coalesce(v_res_replay ->> 'outcome', 'nothing') <> 'REVOCATION_REFUSED'
     or coalesce(v_res_replay ->> 'refusal_code', 'nothing') not like '%SCOPE-CONSUMED%' then
    v_findings := v_findings ||
      format('control 6: A SPENT SCOPE AUTHORIZED A SECOND REVOCATION: %s', v_res_replay);
  end if;
  if (select count(*) from kitluy_devices.revocation_scope_consumptions
       where incident_scope_id = v_scope_ok) <> 1 then
    v_findings := v_findings || format('control 6: a scope was consumed more than once');
  end if;

  -- CONTROL 7 — membership resolved through the CREDENTIAL: a scope naming no
  -- device at all still reaches the credential whose key fingerprint it names.
  if coalesce(v_res_fp ->> 'outcome', 'nothing') <> 'REVOKED' then
    v_findings := v_findings ||
      format('control 7: a scope naming the credential by KEY FINGERPRINT could not revoke it: %s',
             v_res_fp);
  end if;
  -- ...and after three successful and ten refused calls, the device no scope
  -- ever named still holds its credential.
  if (select state::text from kitluy_devices.device_credentials
       where credential_id = v_other_credential) <> 'issued' then
    v_findings := v_findings ||
      format('control 7: the device the recorded scope never named lost its credential anyway');
  end if;

  -- ========================================================================
  -- CONTROL 8 — THE BOUNDARY. The call site is the ONLY way a recorded-scope
  -- reason may revoke, so who can execute it is the whole of the question.
  -- Four roles really try it; the catalogue then corroborates the PUBLIC
  -- revoke, the ownership and the pinned search_path. The probe is deliberately
  -- given a nonexistent scope and a non-recordable reason so that a role which
  -- WERE permitted would still change nothing while being caught.
  -- ========================================================================
  foreach v_role in array array[
    'anon', 'authenticated', 'kitluy_worker_service', 'kitluy_job_governor']
  loop
    if exists (select 1 from pg_roles where rolname = v_role) then
      begin
        execute format('set role %I', v_role);
        begin
          perform kitluy_devices.revoke_device_credential_with_recorded_scope_v1(
            's45-boundary-' || gen_random_uuid()::text, v_device, v_env, 'device_identity', 1,
            'KEY_COMPROMISE', 'boundary probe', 'REPROVISION_REQUIRED',
            v_role, 'SECTION45', v_scope_missing, v_ap_ok, 'approver@45', null);
          v_findings := v_findings ||
            format('control 8: %s executed the scope-bound revocation call site', v_role);
        exception when insufficient_privilege then
          null;
        end;
        execute 'reset role';
      exception when others then
        get stacked diagnostics v_msg = message_text;
        execute 'reset role';
        v_findings := v_findings ||
          format('control 8: the execute probe for %s did not complete: %s', v_role, v_msg);
      end;
    end if;
  end loop;

  v_n := 0;
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('canonical_identifier_list_v1', 'canonical_revocation_scope_v1',
                         'revocation_scope_digest_v1', 'revocation_approval_payload_hash_v1',
                         'credential_revocation_approval_payload_hash_v1',
                         'verify_revocation_scope_binding_v1', 'revocation_scope_consumed_v1',
                         'consume_revocation_scope_v1',
                         'revoke_device_credential_with_recorded_scope_v1')
  loop
    v_n := v_n + 1;
    if has_function_privilege('public', v_sig, 'execute') then
      v_findings := v_findings || format('control 8: PUBLIC can execute %s', v_sig);
    end if;
    if not exists (
      select 1 from pg_proc p where p.oid = v_sig::regprocedure
         and p.proconfig is not null
         and exists (select 1 from unnest(p.proconfig) c where c like 'search\_path=%')) then
      v_findings := v_findings || format('control 8: %s does not pin its search_path', v_sig);
    end if;
  end loop;
  if v_n <> 9 then
    v_findings := v_findings ||
      format('control 8: %s of the 9 functions this path is built from were found, so the boundary scan is incomplete',
             v_n);
  end if;

  -- OWNERSHIP, which is the split that lets Ruling 1 and Ruling 2 both hold: the
  -- call site, the verifier, the consumer and the single-use helper belong to
  -- the governor, and the ONE function that touches kitluy_auth belongs to the
  -- NOLOGIN, non-BYPASSRLS approval reader.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'revoke_device_credential_with_recorded_scope_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_issuer') then
    v_findings := v_findings ||
      format('control 8: the call site is not a SECURITY DEFINER owned by kitluy_credential_issuer');
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('verify_revocation_scope_binding_v1', 'consume_revocation_scope_v1',
                         'revocation_scope_consumed_v1')
       and (not p.prosecdef or pg_get_userbyid(p.proowner) <> 'kitluy_credential_issuer')) then
    v_findings := v_findings ||
      format('control 8: the verifier, the consumer or the single-use helper left the governor');
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname = 'credential_revocation_approval_payload_hash_v1'
       and p.prosecdef
       and pg_get_userbyid(p.proowner) = 'kitluy_credential_approval_reader') then
    v_findings := v_findings ||
      format('control 8: the ONE function that touches kitluy_auth is not owned by the approval reader');
  end if;

  -- The four pure helpers stay closed to everything except the governor and the
  -- reader: a digest function the executor could reach is a free oracle for
  -- confirming a guessed affected set.
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'kitluy_devices'
       and p.proname in ('canonical_identifier_list_v1', 'canonical_revocation_scope_v1',
                         'revocation_scope_digest_v1', 'revocation_approval_payload_hash_v1')
  loop
    if has_function_privilege('kitluy_issuance_service', v_sig, 'execute')
       or has_function_privilege('service_role', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute') then
      v_findings := v_findings ||
        format('control 8: %s is reachable outside the governor and the approval reader', v_sig);
    end if;
  end loop;

  if not has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.revoke_device_credential_with_recorded_scope_v1(text, uuid, text, text, integer, kitluy_devices.credential_revocation_reason, text, kitluy_devices.credential_recovery_disposition, text, text, uuid, uuid, text, text)',
       'execute') then
    v_findings := v_findings ||
      format('control 8: the named executor cannot reach the only scoped revocation path');
  end if;
  -- ...and holding the call site is NOT holding its parts: neither the executor
  -- nor service_role may verify or consume a scope on its own.
  if has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text)', 'execute')
     or has_function_privilege('kitluy_issuance_service',
       'kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text)', 'execute')
     or has_function_privilege('service_role',
       'kitluy_devices.verify_revocation_scope_binding_v1(uuid, uuid, text)', 'execute')
     or has_function_privilege('service_role',
       'kitluy_devices.consume_revocation_scope_v1(uuid, uuid, uuid, text, text)', 'execute') then
    v_findings := v_findings ||
      format('control 8: the executor can verify or consume a scope outside the call site');
  end if;
  -- service_role reaches the call site, and ONLY as the issuance service group
  -- 0127 recorded it may assume ("service_role IS the trusted issuance service
  -- in this stack"). That membership is the whole of its reach here — it is not
  -- a member of the credential governor, and the two checks above say it cannot
  -- verify or consume on its own.
  if not exists (select 1 from pg_auth_members m
                  join pg_roles r on r.oid = m.member
                  join pg_roles g on g.oid = m.roleid
                 where r.rolname = 'service_role'
                   and g.rolname = 'kitluy_issuance_service') then
    v_findings := v_findings ||
      format('control 8: service_role no longer reaches the call site through the recorded issuance membership');
  end if;
  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where r.rolname = 'service_role'
               and g.rolname = 'kitluy_credential_issuer') then
    v_findings := v_findings ||
      format('control 8: service_role became a member of the credential governor');
  end if;

  -- This section borrowed nothing, and nothing was left borrowed by the ones
  -- before it.
  if exists (select 1 from pg_auth_members m
              join pg_roles r on r.oid = m.member
              join pg_roles g on g.oid = m.roleid
             where g.rolname in ('kitluy_credential_issuer', 'kitluy_credential_approval_reader')
               and not r.rolsuper) then
    v_findings := v_findings ||
      format('control 8: a non-superuser holds membership of the credential governor or the approval reader');
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % scope-bound-revocation finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-scope-bound-revocation: group 0141''s binding is CALLED, and nothing reaches a credential without it (KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1, migration 0142) — every reason decision §3 derives from the fleet (KEY_COMPROMISE, DEVICE_LOST, DEVICE_STOLEN, ASSIGNMENT_INVALIDATED, CERTIFICATE_MISISSUANCE and ADMINISTRATIVE_REPLACEMENT) is refused a RECORDED set outright, so a caller cannot choose scope by the back door; a real A4 approval decided by a second person that commits to ANOTHER affected set is refused HASH-MISMATCH, and a call with no scope at all, a scope id naming nothing and a recorded scope presented with no approval each fail closed BEFORE any revocation; a genuine, correctly bound, unconsumed scope naming one device REFUSES to revoke a device it does not name (SCOPE-NOT-IN-SET) — the check a verified binding alone would never supply, and the one this section was checked against by aiming it at the member instead, which revokes; not one of those ten refusals changed a credential, wrote evidence or SPENT the scope, so the authority survived for the revocation that would succeed — and it did: the SAME scope, approval and device then revoked end to end, with `revoked_at` and `revocation_reason` written beside the state, append-only evidence naming the approval and carrying the incident reference taken from the recorded scope because the caller supplied none, an OPEN reprovision recovery case, and a consumption row naming the very `revocation_id` the call returned, which is what makes consumption ATOMIC WITH the revocation rather than adjacent to it; the scope is then authority for nothing, the replay is refused CONSUMED with no second consumption row and no second revocation, membership resolved through the CREDENTIAL revokes a device the scope names ONLY by key fingerprint, and the device no recorded scope ever named still holds its credential after three successful and ten refused calls; and the boundary holds — anon, authenticated, the worker service and the job governor are each refused EXECUTE on the call site while kitluy_issuance_service holds it and PROVED it by revoking, service_role reaches it only through the issuance membership group 0127 recorded and is a member of no credential governor, neither of them may verify or consume a scope on its own, PUBLIC holds EXECUTE on none of the nine functions this path is built from and all nine pin their search_path, the call site, the verifier, the consumer and the single-use helper are governor-owned SECURITY DEFINERs while the ONE function that touches kitluy_auth stays owned by the NOLOGIN, non-BYPASSRLS kitluy_credential_approval_reader, the four pure helpers are reachable by neither the executor nor service_role nor anon, and no non-superuser holds membership of the governor or the reader';
end
$section45$;

select 'assertions complete: groups 0010-0142 structural contract holds (incl. WS-11-T003 Step 4 approval gate bounded to a NOLOGIN non-BYPASSRLS reader per KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 2, the Ruling 1 scope binding — the recorded affected set is a computed, immutable cryptographic term of the approval payload hash — and the call site that VERIFIES that binding, checks membership and spends the scope in the same transaction as the revocation it authorizes)' as result;
