-- kitluy:group:0070
-- Migration group 0070: ws05_ws06_rls (WS-05-T003 / WS-06-T003, Cycle-5
-- KLD-2026-07-26-003). RLS enablement, grants, append-only guards and SELECT
-- policies for every relation created by groups 0040/0045/0050/0060/0065 —
-- same release train so the tables are fail-closed from the moment they carry
-- data (migration plan 0120/0130 same-train rule; reconciliation C1).
-- Policy model (RLS spec sections 4/5): SELECT-only policies TO authenticated;
-- anon has NO policy on any kitluy_* table; every write path is PC-RPC/PC-SVC
-- (versioned SECURITY DEFINER RPCs land in group 0130) so NO INSERT/UPDATE/
-- DELETE policy exists here — writes fail closed for client roles.
-- Helpers REUSED from 20260726190035_0035 (kitluy_auth.current_tenant_ids,
-- current_digital_store_ids, current_location_ids, has_permission,
-- enforce_append_only) — nothing is re-created.
-- Reconciliation C4: the RBAC registry (107 keys) defines no customer-data
-- read permission key, so customers/consent/privacy SELECT is PC-TENANT-only
-- this cycle; the additional permission factor awaits a registry amendment.
-- PC-PUBTOK tables (storefront identity) receive NO policy and NO
-- authenticated SELECT grant: RPC-only, deny-all for clients.
-- kitluy_storefront.customer_phone_challenges deliberately has NO append-only
-- trigger: its attempts counter mutates through the challenge RPC (0130);
-- clients still have no path (no policy, no grant).
-- Purely additive; local-only this cycle; never automatic in production
-- (KL-INF-P1-037, OWNER-LOCKED).

begin;

-- ===========================================================================
-- 1. Append-only guards (reusing kitluy_auth.enforce_append_only) on every
--    history/snapshot/consent/merge/privacy evidence table of this slice.
-- ===========================================================================

create trigger trg_append_only_service_prices
  before update or delete on kitluy_laundry.service_prices
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_configuration_versions
  before update or delete on kitluy_config.configuration_versions
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_configuration_acknowledgements
  before update or delete on kitluy_config.configuration_acknowledgements
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_customer_merge_results
  before update or delete on kitluy_core.customer_merge_results
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_customer_status_history
  before update or delete on kitluy_core.customer_status_history
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_consent_purpose_versions
  before update or delete on kitluy_core.consent_purpose_versions
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_consent_grants
  before update or delete on kitluy_core.consent_grants
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_consent_withdrawals
  before update or delete on kitluy_core.consent_withdrawals
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_privacy_requests
  before update or delete on kitluy_core.privacy_requests
  for each row execute function kitluy_auth.enforce_append_only();

create trigger trg_append_only_privacy_request_decisions
  before update or delete on kitluy_core.privacy_request_decisions
  for each row execute function kitluy_auth.enforce_append_only();

-- ===========================================================================
-- 2. RLS ENABLE + FORCE on every relation of this slice (fail-closed deny-all
--    baseline; a table without a policy below denies every command).
-- ===========================================================================

alter table kitluy_core.catalog_items enable row level security;
alter table kitluy_core.catalog_items force row level security;
alter table kitluy_core.catalog_item_translations enable row level security;
alter table kitluy_core.catalog_item_translations force row level security;
alter table kitluy_core.customers enable row level security;
alter table kitluy_core.customers force row level security;
alter table kitluy_core.customer_contacts enable row level security;
alter table kitluy_core.customer_contacts force row level security;
alter table kitluy_core.customer_store_relationships enable row level security;
alter table kitluy_core.customer_store_relationships force row level security;
alter table kitluy_core.customer_merge_requests enable row level security;
alter table kitluy_core.customer_merge_requests force row level security;
alter table kitluy_core.customer_merge_results enable row level security;
alter table kitluy_core.customer_merge_results force row level security;
alter table kitluy_core.customer_status_history enable row level security;
alter table kitluy_core.customer_status_history force row level security;
alter table kitluy_core.consent_purposes enable row level security;
alter table kitluy_core.consent_purposes force row level security;
alter table kitluy_core.consent_purpose_versions enable row level security;
alter table kitluy_core.consent_purpose_versions force row level security;
alter table kitluy_core.consent_grants enable row level security;
alter table kitluy_core.consent_grants force row level security;
alter table kitluy_core.consent_withdrawals enable row level security;
alter table kitluy_core.consent_withdrawals force row level security;
alter table kitluy_core.privacy_requests enable row level security;
alter table kitluy_core.privacy_requests force row level security;
alter table kitluy_core.privacy_request_decisions enable row level security;
alter table kitluy_core.privacy_request_decisions force row level security;

alter table kitluy_laundry.services enable row level security;
alter table kitluy_laundry.services force row level security;
alter table kitluy_laundry.service_addons enable row level security;
alter table kitluy_laundry.service_addons force row level security;
alter table kitluy_laundry.service_prices enable row level security;
alter table kitluy_laundry.service_prices force row level security;

alter table kitluy_config.configuration_versions enable row level security;
alter table kitluy_config.configuration_versions force row level security;
alter table kitluy_config.configuration_publications enable row level security;
alter table kitluy_config.configuration_publications force row level security;
alter table kitluy_config.configuration_targets enable row level security;
alter table kitluy_config.configuration_targets force row level security;
alter table kitluy_config.configuration_acknowledgements enable row level security;
alter table kitluy_config.configuration_acknowledgements force row level security;

alter table kitluy_storefront.customer_channel_identities enable row level security;
alter table kitluy_storefront.customer_channel_identities force row level security;
alter table kitluy_storefront.customer_phone_challenges enable row level security;
alter table kitluy_storefront.customer_phone_challenges force row level security;
alter table kitluy_storefront.customer_sessions enable row level security;
alter table kitluy_storefront.customer_sessions force row level security;

alter table kitluy_notifications.preferences enable row level security;
alter table kitluy_notifications.preferences force row level security;

-- ===========================================================================
-- 3. Privileges. anon and PUBLIC receive nothing. authenticated receives
--    SELECT only (RLS filters rows); PC-PUBTOK tables get NO authenticated
--    SELECT at all (execution_tokens precedent). service_role receives
--    select/insert/update for the RPC/service layer; append-only truth is
--    still guarded by the triggers above.
-- ===========================================================================

revoke all on schema kitluy_laundry, kitluy_config, kitluy_storefront, kitluy_notifications from public;

grant usage on schema kitluy_laundry, kitluy_config, kitluy_storefront, kitluy_notifications
  to authenticated, service_role;

grant select on all tables in schema kitluy_core to authenticated;
grant select on all tables in schema kitluy_laundry to authenticated;
grant select on all tables in schema kitluy_config to authenticated;
grant select on all tables in schema kitluy_storefront to authenticated;
grant select on all tables in schema kitluy_notifications to authenticated;

-- PC-PUBTOK: storefront identity tables are RPC-only — clients never SELECT.
revoke select on kitluy_storefront.customer_channel_identities from authenticated;
revoke select on kitluy_storefront.customer_phone_challenges from authenticated;
revoke select on kitluy_storefront.customer_sessions from authenticated;

grant select, insert, update on all tables in schema kitluy_core to service_role;
grant select, insert, update on all tables in schema kitluy_laundry to service_role;
grant select, insert, update on all tables in schema kitluy_config to service_role;
grant select, insert, update on all tables in schema kitluy_storefront to service_role;
grant select, insert, update on all tables in schema kitluy_notifications to service_role;

-- ===========================================================================
-- 4. Policies. SELECT-only, TO authenticated. anon: no policy anywhere.
--    INSERT/UPDATE/DELETE: no policy anywhere (PC-RPC/PC-AO/PROHIBITED).
-- ===========================================================================

-- 4.1 Catalog (RLS spec 5.1: PC-STORE) --------------------------------------

create policy catalog_items_select_store on kitluy_core.catalog_items
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

create policy catalog_item_translations_select_store on kitluy_core.catalog_item_translations
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_core.catalog_items ci
      where ci.id = catalog_item_id
        and ci.digital_store_id = any (kitluy_auth.current_digital_store_ids())
    )
  );

-- 4.2 Laundry catalog/pricing (RLS spec 5.11: PC-STORE / PC-LOC) ------------

create policy services_select_store on kitluy_laundry.services
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

create policy service_addons_select_store on kitluy_laundry.service_addons
  for select to authenticated
  using (digital_store_id = any (kitluy_auth.current_digital_store_ids()));

create policy service_prices_select_store_or_location on kitluy_laundry.service_prices
  for select to authenticated
  using (
    digital_store_id = any (kitluy_auth.current_digital_store_ids())
    or store_location_id = any (kitluy_auth.current_location_ids())
  );

-- 4.3 Configuration (RLS spec 5.17; configuration.read for platform/vertical
--     scope rows; tenant hierarchy rows via tenant scope) -------------------

create policy configuration_versions_select_scoped on kitluy_config.configuration_versions
  for select to authenticated
  using (
    (tenant_id is not null and tenant_id = any (kitluy_auth.current_tenant_ids()))
    or (tenant_id is null
        and kitluy_auth.has_permission('configuration.read', null, null, null))
  );

create policy configuration_publications_select_scoped on kitluy_config.configuration_publications
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_config.configuration_versions v
      where v.id = configuration_version_id
    )
  );

create policy configuration_targets_select_scoped on kitluy_config.configuration_targets
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_config.configuration_publications p
      where p.id = publication_id
    )
  );

create policy configuration_acknowledgements_select_scoped on kitluy_config.configuration_acknowledgements
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_config.configuration_targets t
      -- Outer column qualified: configuration_targets also has a target_id
      -- column, so an unqualified reference would bind to the inner table.
      where t.id = configuration_acknowledgements.target_id
    )
  );

-- 4.4 Customers (RLS spec 5.1 PC-TENANT; reconciliation C4: the additional
--     permission factor awaits an RBAC registry amendment) ------------------

create policy customers_select_tenant on kitluy_core.customers
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy customer_contacts_select_tenant on kitluy_core.customer_contacts
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy customer_store_relationships_select_tenant on kitluy_core.customer_store_relationships
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy customer_merge_requests_select_tenant on kitluy_core.customer_merge_requests
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy customer_merge_results_select_tenant on kitluy_core.customer_merge_results
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy customer_status_history_select_tenant on kitluy_core.customer_status_history
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

-- 4.5 Consent and privacy ----------------------------------------------------
-- Purpose registry rows are platform reference data (customer-facing notice
-- catalog — RLS spec 5.1 reference-data read class); grants/withdrawals/
-- privacy records are PC-TENANT.

create policy consent_purposes_select_reference on kitluy_core.consent_purposes
  for select to authenticated
  using (true);

create policy consent_purpose_versions_select_reference on kitluy_core.consent_purpose_versions
  for select to authenticated
  using (true);

create policy consent_grants_select_tenant on kitluy_core.consent_grants
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy consent_withdrawals_select_tenant on kitluy_core.consent_withdrawals
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy privacy_requests_select_tenant on kitluy_core.privacy_requests
  for select to authenticated
  using (tenant_id = any (kitluy_auth.current_tenant_ids()));

create policy privacy_request_decisions_select_tenant on kitluy_core.privacy_request_decisions
  for select to authenticated
  using (
    exists (
      select 1 from kitluy_core.privacy_requests r
      where r.id = privacy_request_id
        and r.tenant_id = any (kitluy_auth.current_tenant_ids())
    )
  );

-- 4.6 Notification preferences (RLS spec 5.19: subject-scoped) ---------------

create policy preferences_select_subject on kitluy_notifications.preferences
  for select to authenticated
  using (
    user_id = auth.uid()
    or (tenant_id is not null and tenant_id = any (kitluy_auth.current_tenant_ids()))
  );

-- kitluy_storefront.customer_channel_identities / customer_phone_challenges /
-- customer_sessions: NO policy in any command (PC-PUBTOK, RPC-only) —
-- deny-all by RLS, and authenticated holds no SELECT grant.

-- Manifest: 22 SELECT policies (kitluy_core 14, kitluy_laundry 3,
-- kitluy_config 4, kitluy_notifications 1, kitluy_storefront 0 by design);
-- 0 INSERT/UPDATE/DELETE policies; 0 anon policies; 25 relations RLS
-- ENABLE+FORCE; 10 append-only triggers reusing kitluy_auth.enforce_append_only;
-- 0 new functions. Asserted by supabase/tests/assertions.sql.

commit;
