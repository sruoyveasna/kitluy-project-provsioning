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
  -- kitluy_core (catalog 2 + customers 6 + consent/privacy 6) = 58.
  select count(*) into v_select from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit')
    and cmd = 'SELECT';
  if v_select <> 58 then
    raise exception 'ASSERT FAIL: expected 58 SELECT policies, found %', v_select;
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

  raise notice 'PASS policies: 58 + 17 + 21 SELECT, 0 write, 0 anon, execution_tokens and PUBTOK tables deny-all';
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

select 'assertions complete: groups 0010-0095 structural contract holds (incl. cycle-6 WS-07/WS-08 sections 17-26)' as result;
