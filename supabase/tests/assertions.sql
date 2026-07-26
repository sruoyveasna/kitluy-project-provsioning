-- ============================================================================
-- KitLuy structural assertions for migration groups 0010, 0020, 0030, 0035
-- and the Cycle-5 groups 0040, 0045, 0050, 0060, 0065, 0070 (WS-05/WS-06).
-- Executes against the LOCAL Supabase stack via `pnpm db:test`
-- (scripts/database/db-exec.mjs) after `pnpm db:reset` + `pnpm db:seed`.
-- Pattern: migration plan group 0160 (DO blocks; assertion failure raises and
-- aborts). Asserted: 45 + 25 tables (+1 partition), 58 + 8 SELECT policies,
-- 9 helper functions, append-only/four-eyes guards, money integer storage,
-- snapshot immutability, identifier uniqueness, merge/consent structure.
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
                      'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
    and c.relkind in ('r', 'p')
    and not (c.relrowsecurity and c.relforcerowsecurity);
  if v_bad is not null then
    raise exception 'ASSERT FAIL: RLS not enabled+forced on: %', v_bad;
  end if;
  raise notice 'PASS rls: every relation in all eight kitluy_* domain schemas is RLS enabled + forced';
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
    'kitluy_core.privacy_request_decisions'
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
  raise notice 'PASS append-only: 22 A/O tables have no UPDATE/DELETE policies and carry enforce_append_only';
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
  -- + kitluy_storefront 0 (PC-PUBTOK deny-all by design) = 8.
  select count(*) into v_select from pg_policies
  where schemaname in ('kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
    and cmd = 'SELECT';
  if v_select <> 8 then
    raise exception 'ASSERT FAIL: expected 8 SELECT policies in cycle-5 schemas, found %', v_select;
  end if;

  select count(*) into v_writes from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                       'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  if v_writes <> 0 then
    raise exception 'ASSERT FAIL: expected 0 write/ALL policies (PC-RPC model), found %', v_writes;
  end if;

  select count(*) into v_anon from pg_policies
  where schemaname in ('kitluy_core', 'kitluy_auth', 'kitluy_admin', 'kitluy_audit',
                       'kitluy_laundry', 'kitluy_config', 'kitluy_storefront', 'kitluy_notifications')
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

  raise notice 'PASS policies: 58 + 8 SELECT, 0 write, 0 anon, execution_tokens and PUBTOK tables deny-all';
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

select 'assertions complete: groups 0010-0070 structural contract holds' as result;
