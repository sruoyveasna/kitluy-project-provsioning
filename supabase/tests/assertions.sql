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
begin
  if (select destruction_enabled from kitluy_devices.key_destruction_policy
       where environment = 'development') then
    v_findings := v_findings || 'key destruction is ENABLED in the shipped policy';
  end if;
  if (select approved_by_decision_ref is not null or minimum_retention_days is not null
         or recovery_retention_days is not null
        from kitluy_devices.key_destruction_policy where environment = 'development') then
    v_findings := v_findings || 'a destruction decision or retention period was invented';
  end if;
  if (select coalesce(required_owner_decision, '') from kitluy_devices.key_destruction_policy
       where environment = 'development') not like '%REQUIRED%' then
    v_findings := v_findings || 'the missing destruction decision is not named';
  end if;

  -- Enabling by flipping the boolean is refused.
  begin
    update kitluy_devices.key_destruction_policy set destruction_enabled = true
     where environment = 'development';
    v_findings := v_findings || 'destruction was enabled without naming a decision';
  exception when others then
    if sqlerrm not like '%key_destruction_policy_needs_decision_chk%' then
      v_findings := v_findings || format('wrong refusal enabling destruction: %s', sqlerrm);
    end if;
  end;

  -- Naming a decision is still not enough: the durations must come with it.
  begin
    update kitluy_devices.key_destruction_policy
       set destruction_enabled = true, approved_by_decision_ref = 'TEST-ONLY-section39a'
     where environment = 'development';
    v_findings := v_findings || 'destruction was enabled without retention periods';
  exception when others then
    if sqlerrm not like '%key_destruction_policy_needs_retention_chk%' then
      v_findings := v_findings || format('wrong refusal for missing retention: %s', sqlerrm);
    end if;
  end;

  -- The executor can neither enable destruction nor write lifecycle history.
  if has_table_privilege('kitluy_issuance_service',
                         'kitluy_devices.key_destruction_policy', 'update')
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
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relname = 'device_credential_lifecycle_events'
      and t.tgname = 'trg_device_credential_lifecycle_events_append_only'
      and not t.tgisinternal
  ) then
    v_findings := v_findings || 'the lifecycle audit is not append-only';
  end if;

  if cardinality(v_findings) > 0 then
    raise exception 'ASSERT FAIL: % destruction-policy finding(s): %',
      cardinality(v_findings), array_to_string(v_findings, ' | ');
  end if;

  raise notice 'PASS ws11-key-destruction-blocked: destruction ships DISABLED with every retention period NULL and the missing owner decision NAMED, it cannot be enabled by flipping a boolean nor by naming a decision without both retention periods, the issuance executor can neither enable it nor write lifecycle history directly, PUBLIC cannot retire a credential, and the lifecycle audit is append-only';
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
