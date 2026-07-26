# KitLuy Suite Supabase RLS and Authorization

**Filename:** `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-26
**Owner:** HET / KitLuy Suite Project Owner
**Status:** Canonical RLS/authorization specification; PROPOSED→CONTRACT-APPROVED pending independent review
**Primary phase:** Phase 1 — Laundry, designed as a shared cross-vertical foundation
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies required behavior. It is not evidence that
> any policy, function, migration, test, or deployment exists. Applied SQL migrations are the
> only deployed schema truth. Nothing here is `IMPLEMENTED` without repository, applied-migration,
> executable-test, and deployment evidence. RLS execution testing is currently **BLOCKED (BLK-002:
> Docker/Supabase CLI absent)**; see `scripts/testing/blocked.mjs` and the static harness in
> `scripts/database/`.

## Authority

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions.
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence.
3. This document, `kitluy-suite-supabase-schema-v1.0.0.md`, and
   `kitluy-suite-supabase-migration-plan-v1.0.0.md`.
4. The Supabase implementation pack in `docs/source/data-contracts/` (data dictionary is the
   exact source of schema and table names used here).
5. The security pack in `docs/source/security/` (RBAC permission registry — 107 keys, resource
   scope model, sensitive-action A0–A4 policy, audit event registry, service-account policy,
   support-access policy, device certificate policy).
6. The RLS test pack `docs/source/qa/kitluy-rls-and-tenant-isolation-test-pack-v1.0.0.md`
   (RLS-001..RLS-030).

## 1. JWT claim assumptions and server-derived context

KitLuy uses Supabase Auth (GoTrue) JWTs for human principals. The following claim contract is
assumed and must be verified before CONTRACT-APPROVED status:

| Claim                                        | Trust class                 | Use in authorization                                                                                                            |
| -------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `sub` (`auth.uid()`)                         | Trusted (signed by GoTrue)  | The only client-carried identity input. Everything else is resolved server-side from it.                                        |
| `role` (`anon`/`authenticated`)              | Trusted (signed)            | Selects the PostgreSQL role. Grants nothing by itself.                                                                          |
| `aal` / `amr`                                | Trusted (signed)            | Assurance level input for re-authentication checks (`kitluy_auth.require_reauthentication`).                                    |
| `session_id`                                 | Trusted (signed)            | Session revocation checks.                                                                                                      |
| `app_metadata` / `user_metadata`             | **Not authorization truth** | Never used in any RLS predicate or authorization decision. `user_metadata` is user-editable; `app_metadata` may be stale.       |
| Any client-supplied tenant/store/location ID | **Untrusted input**         | Treated as a _request parameter only_. The authoritative scope is resolved from relational state, never from the token or body. |

Mandatory rules:

1. **Server-derived context.** Tenant, Digital Store, Store Location, environment, terminal
   role, and device identity are derived server-side from `auth.uid()` (or service/device
   identity) via relational lookups in `kitluy_core.memberships`, `kitluy_auth.role_assignments`,
   `kitluy_auth.assignment_scopes`, `kitluy_auth.service_identities`,
   `kitluy_devices.device_assignments`, and `kitluy_devices.device_certificates`. A client
   sending a `tenant_id` never widens authority (resource scope model §7; RLS-004).
2. **No JWT-embedded tenant claims.** Custom claims listing tenant/store IDs are prohibited as
   authorization truth: they go stale on revocation and violate RLS-010. If a cache claim is
   ever added for performance it must be advisory only and re-verified relationally.
3. **Membership is not permission.** `kitluy_core.memberships` alone grants no action
   (data dictionary invariant); permission evaluation always resolves an explicit permission
   key from `kitluy_auth.permissions` plus scope, environment, and validity window.
4. **Environment is a first-class dimension** (`development`, `staging`, `pilot`,
   `production`, `disaster_recovery`, `store_edge`). Environment is bound to the deployment
   (per-project/per-database), never to a client claim; cross-environment grants fail closed
   (RLS-022).

## 2. Principal classes and PostgreSQL roles

| Principal                | PostgreSQL role                                                            | Identity anchor                                                         | Notes                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anonymous public         | `anon`                                                                     | none                                                                    | Deny-all on every `kitluy_*` table (RLS-001). Public storefront flows use token-bound RPCs only.                                                  |
| Human user               | `authenticated`                                                            | `auth.uid()` → memberships/assignments                                  | Partner, Chain, Store staff, HET Admin — same mechanism, different grants.                                                                        |
| Service workload         | `service_role` (server-only) or dedicated scoped role                      | `kitluy_auth.service_identities` row + propagated context               | Confined to the service-role safety register (§7). Never a generic bypass.                                                                        |
| Store Hub / T1–T4 device | edge-authenticated via Edge Functions/API; DB access through service paths | `kitluy_devices.devices` + `device_certificates` + `device_assignments` | Devices never hold direct PostgREST credentials; the API layer validates certificate and terminal role, then calls RPCs with device context (§6). |
| Connector                | none (no DB role)                                                          | `kitluy_integrations.channel_connections`                               | Connectors have **no** direct database access (RLS-014); Connector API only.                                                                      |

## 3. Context resolution helper functions

All RLS predicates and RPC guards resolve context through the following functions, owned by the
Security domain in schema `kitluy_auth` (names align with
`kitluy-suite-supabase-functions-rpc-and-triggers-v1.0.0.md`):

| Function                                                                              | Contract                                                                                                                                |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `kitluy_auth.current_actor_context()`                                                 | Resolves actor type (human/service/device/system), identity, assurance level, environment, request/correlation context. Fail-closed.    |
| `kitluy_auth.current_tenant_ids()`                                                    | `uuid[]` of tenants with an **active, unexpired, unrevoked** membership/assignment for the current actor. `STABLE`, empty on any doubt. |
| `kitluy_auth.current_digital_store_ids()`                                             | Authorized Digital Stores after assignment-scope and exclusion evaluation. Store scope never implies sibling stores (RLS-008).          |
| `kitluy_auth.current_location_ids()`                                                  | Authorized Store Locations after scope/exclusion evaluation. Location scope never implies sibling locations (RLS-007).                  |
| `kitluy_auth.has_permission(permission_key, resource_type, resource_id, environment)` | Full fail-closed evaluation per resource scope model §7 (identity status → permission → scope → exclusions → validity → SoD).           |
| `kitluy_auth.assert_permission(...)`                                                  | `has_permission` that raises stable `KLUY-AUTH-*` errors; used at the top of every command RPC.                                         |
| `kitluy_auth.require_reauthentication(max_age_seconds)`                               | Verifies a fresh approved re-authentication event for A2–A4 actions.                                                                    |
| `kitluy_auth.consume_execution_token(token, payload_hash)`                            | Atomic single-use consumption of an A3/A4 execution token bound to the exact payload hash.                                              |
| `kitluy_auth.record_authorization_decision(...)`                                      | Append-only allow/deny evidence into `kitluy_auth.authorization_decisions`; never leaks secrets.                                        |

Implementation constraints (all mandatory, statically testable — RLS-027):

- Every helper and every `SECURITY DEFINER` function has an explicit owner, `SET search_path`
  locked to its schemas, `REVOKE EXECUTE FROM PUBLIC`, least-privilege grants, and a scope
  predicate; each ships with dedicated negative tests.
- Scope helpers return **empty** on: disabled/suspended profile (RLS-011), revoked or expired
  membership (RLS-010, RLS-012), missing environment grant (RLS-022), unresolved actor.
- Helpers are `STABLE` (single-statement-consistent) so revocation applies at next statement;
  no session-cached scope longer than the statement.

## 4. Policy categories

| Code          | Category                   | Predicate summary                                                                                                     |
| ------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `PC-TENANT`   | Tenant-isolated            | `tenant_id = ANY (kitluy_auth.current_tenant_ids())` plus permission check where the row class requires it.           |
| `PC-STORE`    | Digital-Store-scoped       | `digital_store_id = ANY (kitluy_auth.current_digital_store_ids())` (tenant predicate implied by ancestry validation). |
| `PC-LOC`      | Location-scoped            | `store_location_id = ANY (kitluy_auth.current_location_ids())`.                                                       |
| `PC-PLATFORM` | Platform/security-governed | `kitluy_auth.has_permission(...)` for the named HET permission; no tenant predicate; `anon` denied.                   |
| `PC-RPC`      | RPC-only write             | Direct DML denied to `anon`/`authenticated`; the only write path is the named `SECURITY DEFINER` RPC.                 |
| `PC-AO`       | Append-only evidence       | INSERT via RPC/trigger only; **UPDATE and DELETE PROHIBITED** for all application roles (`enforce_append_only`).      |
| `PC-SVC`      | Service-identity only      | Only a registered workload in the service-role safety register (§7) may touch the table.                              |
| `PC-DEVICE`   | Device-context required    | Access requires validated device certificate + assignment context propagated by the edge/API layer.                   |
| `PC-PUBTOK`   | Public token-scoped        | No direct table access for `anon`; reads/writes only through token-hash-bound storefront RPCs.                        |
| `PROHIBITED`  | No path                    | No policy exists; RLS enabled ⇒ deny (fail closed).                                                                   |

Global defaults: RLS is `ENABLE`d and `FORCE`d on **every** table in every `kitluy_*` schema
(migration plan group 0120; RLS-028 gate). A table without an explicit policy row below is
deny-all in every command. `anon` has no policy on any `kitluy_*` table.

## 5. Policy category matrix per schema domain

Table names are exactly those of `kitluy-suite-supabase-data-dictionary-v1.0.0.md`.

### 5.1 `kitluy_core`

| Tables                                                                       | SELECT                                                       | INSERT                                          | UPDATE                               | DELETE                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------ | ------------------------------------ |
| `tenants`, `partner_accounts`                                                | PC-TENANT or PC-PLATFORM (`partners.read`)                   | PC-RPC (`kitluy_core.create_tenant_partner_v1`) | PC-RPC (lifecycle RPC)               | **PROHIBITED** (soft lifecycle only) |
| `digital_stores`, `store_locations`                                          | PC-STORE / PC-LOC                                            | PC-RPC (create RPCs)                            | PC-RPC (versioned)                   | **PROHIBITED**                       |
| `digital_store_location_links`                                               | PC-STORE                                                     | PC-RPC                                          | **PROHIBITED** (append-only history) | **PROHIBITED**                       |
| `memberships`                                                                | PC-TENANT                                                    | PC-RPC                                          | PC-RPC (status only)                 | **PROHIBITED**                       |
| `customers`, `customer_contacts`                                             | PC-TENANT + permission                                       | PC-RPC (`link_customer_contact_v1`)             | PC-RPC                               | **PROHIBITED**                       |
| `catalog_items`, `catalog_item_translations`                                 | PC-STORE                                                     | PC-STORE + permission                           | PC-STORE + version check             | PC-RPC soft-delete only              |
| `plans`, `feature_flags`, `reference_values`, `reference_value_translations` | PC-PLATFORM read / all-authenticated read for reference data | PC-PLATFORM                                     | PC-PLATFORM (versioned)              | **PROHIBITED**                       |

### 5.2 `kitluy_auth`

| Tables                                                                                                       | SELECT                                    | INSERT                                   | UPDATE                               | DELETE         |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ---------------------------------------- | ------------------------------------ | -------------- |
| `admin_user_profiles`, `teams`, `team_memberships`                                                           | PC-PLATFORM (`rbac.read`)                 | PC-RPC (A2/A3 per registry)              | PC-RPC                               | **PROHIBITED** |
| `permissions`, `role_templates`, `role_permission_grants`, `approval_policies`, `separation_of_duties_rules` | PC-PLATFORM (`rbac.read`)                 | PC-RPC (A3/A4 governance RPCs)           | **PROHIBITED** (versioned; new rows) | **PROHIBITED** |
| `role_assignments`, `assignment_scopes`, `temporary_grants`                                                  | PC-PLATFORM (`rbac.read`) or self-subject | PC-RPC (`rbac.assignment_manage`, A2/A3) | PC-RPC (revoke/expiry only)          | **PROHIBITED** |
| `access_requests`, `approval_requests`                                                                       | requester/approver scope                  | PC-RPC (`request_approval_v1`)           | PC-RPC (state machine only)          | **PROHIBITED** |
| `approval_decisions`, `authorization_decisions`                                                              | PC-PLATFORM (`audit.read`)                | PC-RPC / trigger (PC-AO)                 | **PROHIBITED**                       | **PROHIBITED** |
| `execution_tokens`                                                                                           | **PROHIBITED** (server-consumed only)     | PC-RPC (`issue_execution_token_v1`)      | PC-RPC (`consume_execution_token`)   | **PROHIBITED** |
| `break_glass_sessions`, `service_identities`                                                                 | PC-PLATFORM                               | PC-RPC (A4)                              | PC-RPC (expiry/revocation)           | **PROHIBITED** |

### 5.3 `kitluy_admin`

| Tables                                                                                        | SELECT                                                   | INSERT                             | UPDATE                                        | DELETE         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------- | --------------------------------------------- | -------------- |
| `crm_leads`, `partner_verification_cases`, `onboarding_workspaces`, `readiness_policies`      | PC-PLATFORM (domain read keys)                           | PC-PLATFORM + permission           | PC-PLATFORM + permission                      | **PROHIBITED** |
| `readiness_results`, `go_live_approvals`, `platform_incident_events`, `support_interventions` | PC-PLATFORM                                              | PC-RPC (PC-AO)                     | **PROHIBITED**                                | **PROHIBITED** |
| `support_tickets`, `platform_incidents`, `safety_switches`                                    | PC-PLATFORM; Partner sees own-tenant tickets (PC-TENANT) | PC-RPC                             | PC-RPC (approval-gated for `safety_switches`) | **PROHIBITED** |
| `support_access_sessions`                                                                     | PC-PLATFORM + consent scope; Partner sees own sessions   | PC-RPC (`begin_support_access_v1`) | PC-RPC (revoke/expire only)                   | **PROHIBITED** |

### 5.4 `kitluy_billing`

| Tables                                           | SELECT                                    | INSERT                                   | UPDATE                                                 | DELETE         |
| ------------------------------------------------ | ----------------------------------------- | ---------------------------------------- | ------------------------------------------------------ | -------------- |
| `plan_policies`, `plan_entitlements`             | authenticated read (plan catalog)         | PC-PLATFORM (A4 `billing.policy_manage`) | **PROHIBITED** (versioned)                             | **PROHIBITED** |
| `subscriptions`                                  | PC-TENANT or PC-PLATFORM (`billing.read`) | PC-RPC                                   | PC-RPC (lifecycle)                                     | **PROHIBITED** |
| `invoices`, `payment_attempts`, `dunning_events` | PC-TENANT or PC-PLATFORM                  | PC-RPC / PC-SVC                          | **PROHIBITED** once finalized (compensating rows only) | **PROHIBITED** |

### 5.5 `kitluy_chain`

All tables (`chains` … `action_items`): SELECT is chain-membership-scoped (chain relationship
records per resource scope model §6.10 — brand similarity is never scope; RLS-009); INSERT/UPDATE
via chain governance RPCs with permission checks; snapshot/history tables
(`catalog_versions`, `catalog_publication_batches`, `catalog_publication_targets`,
`catalog_location_assignments`, `compliance_audits`, `compliance_answers`) are PC-AO —
**UPDATE/DELETE PROHIBITED**. DELETE is **PROHIBITED** on every `kitluy_chain` table.

### 5.6 `kitluy_partner`

| Tables                                                                                                                            | SELECT                                                                                                              | INSERT                | UPDATE                        | DELETE           |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------- | ---------------- |
| `store_profiles`, `store_settings`, `location_settings`, `service_availability_overrides`, `report_presets`, `mobile_preferences` | PC-STORE / PC-LOC                                                                                                   | PC-STORE + permission | PC-STORE versioned            | PC-RPC soft only |
| `employee_profiles`, `employee_roles`, `employee_pin_credentials`                                                                 | PC-TENANT + staff-management permission (PIN hashes never SELECTable by clients — verification is server-side only) | PC-RPC                | PC-RPC (rotate/revoke)        | **PROHIBITED**   |
| `time_entries`, `expenses`, `approval_requests`                                                                                   | PC-LOC                                                                                                              | PC-RPC / PC-DEVICE    | PC-RPC (corrections append)   | **PROHIBITED**   |
| `reconciliations`, `reconciliation_lines`, `mobile_snapshots`                                                                     | PC-STORE                                                                                                            | PC-SVC / PC-RPC       | **PROHIBITED** once completed | **PROHIBITED**   |

### 5.7 `kitluy_pos`

| Tables                                                                                                 | SELECT | INSERT                     | UPDATE                                            | DELETE         |
| ------------------------------------------------------------------------------------------------------ | ------ | -------------------------- | ------------------------------------------------- | -------------- |
| `registers`, `register_pairings`                                                                       | PC-LOC | PC-RPC + PC-DEVICE         | PC-RPC                                            | **PROHIBITED** |
| `shifts`, `sessions`                                                                                   | PC-LOC | PC-RPC (`open_shift_v1`)   | PC-RPC (`close_shift_v1`)                         | **PROHIBITED** |
| `cash_drawer_events`, `scale_readings`, `terminal_mode_events`, `local_command_receipts`, `print_jobs` | PC-LOC | PC-RPC + PC-DEVICE (PC-AO) | **PROHIBITED** (`print_jobs` status via RPC only) | **PROHIBITED** |

### 5.8 `kitluy_storefront`

| Tables                                                                                                                                                                                | SELECT                                                                     | INSERT                | UPDATE                              | DELETE         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------- | ----------------------------------- | -------------- |
| `storefront_publications`, `storefront_location_publications`, `storefront_entry_points`, `storefront_qr_codes`, `queue_counters`, `queue_policies`                                   | PC-STORE; public reads via `storefront_public_status_read` projection only | PC-STORE + permission | PC-STORE versioned                  | **PROHIBITED** |
| `customer_channel_identities`, `customer_phone_challenges`, `customer_sessions`, `idempotency_records`, `channel_attributions`                                                        | PC-PUBTOK (RPC only)                                                       | PC-PUBTOK (RPC only)  | PC-PUBTOK (RPC only)                | **PROHIBITED** |
| `pre_intake_drafts`, `pre_intake_lines`, `pre_intake_evidence_files`, `queue_tickets`                                                                                                 | PC-PUBTOK own-session + PC-LOC staff                                       | PC-PUBTOK RPC         | PC-PUBTOK RPC (pre-submission only) | **PROHIBITED** |
| `pre_intake_versions`, `queue_events`, `intake_verifications`, `intake_verification_lines`, `customer_confirmations`, `pre_intake_booking_conversions`, `storefront_status_snapshots` | PC-LOC                                                                     | PC-RPC (PC-AO)        | **PROHIBITED**                      | **PROHIBITED** |

### 5.9 `kitluy_orders`

| Tables                                                                                            | SELECT                                      | INSERT                               | UPDATE                                                              | DELETE         |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------- | -------------- |
| `orders`                                                                                          | PC-LOC / PC-STORE (`laundry.bookings.read`) | PC-RPC (`create_laundry_booking_v1`) | PC-RPC (`transition_booking_status_v1`; finalized totals immutable) | **PROHIBITED** |
| `order_lines`, `order_adjustments`, `order_events`, `receipts`, `invoices`, `external_order_refs` | PC-LOC / PC-STORE                           | PC-RPC (PC-AO)                       | **PROHIBITED** (compensating rows only)                             | **PROHIBITED** |
| `order_notes`                                                                                     | PC-LOC + visibility class                   | PC-LOC + permission                  | PC-RPC (own note, pre-finalization)                                 | **PROHIBITED** |

### 5.10 `kitluy_payments`

Every table (`tenders`, `payment_attempts`, `khqr_transactions`, `refunds`, `voids`,
`payment_provider_events`, `settlement_refs`, `payment_reconciliations`,
`payment_reconciliation_lines`): SELECT is PC-LOC/PC-STORE gated by `payments.read`; INSERT is
PC-RPC (`add_booking_payment_v1`, refund/void RPCs) or PC-SVC (provider event ingestion);
**UPDATE and DELETE PROHIBITED** on all — payments truth is append-only financial evidence.
Status progression happens through RPC-inserted compensating/lifecycle rows, never in-place
edits of captured amounts.

### 5.11 `kitluy_laundry`

| Tables                                                                                                                   | SELECT            | INSERT                                                                                                | UPDATE                                                     | DELETE         |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------- |
| `services`, `service_prices`, `service_addons`, `consumable_usage_rules`, `capacity_profiles`, `ready_storage_positions` | PC-STORE / PC-LOC | PC-STORE + permission (versioned)                                                                     | PC-STORE versioned                                         | **PROHIBITED** |
| `garments`, `laundry_tags`, `booking_status_history`, `garment_scan_events`, `production_steps`                          | PC-LOC            | PC-RPC + PC-DEVICE (`record_garment_scan_v1`; PC-AO for scans/history)                                | **PROHIBITED** for scan/history; PC-RPC for garment status | **PROHIBITED** |
| `garment_exceptions`                                                                                                     | PC-LOC            | PC-RPC (`open_exception_v1`)                                                                          | PC-RPC (`resolve_exception_v1`)                            | **PROHIBITED** |
| `ready_storage_assignments`, `pickup_handoffs`                                                                           | PC-LOC            | PC-RPC + terminal role: T3-only (`assign_ready_storage_v1`), T4-only (`complete_pickup_v1`) — RLS-016 | **PROHIBITED** (clear via new custody rows)                | **PROHIBITED** |

### 5.12 `kitluy_inventory`

`items`, `item_units`, `stock_locations`, `suppliers`, `purchase_orders`,
`purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `transfer_orders`,
`transfer_order_lines`, `stock_counts`, `stock_count_lines`: SELECT PC-STORE/PC-LOC; writes via
inventory RPCs with permission + approval thresholds. `stock_movements`: PC-AO — INSERT via RPC
only, **UPDATE/DELETE PROHIBITED** (authoritative ledger). `stock_balances`: derived — direct
client writes **PROHIBITED** in all commands (maintenance function only). DELETE **PROHIBITED**
schema-wide.

### 5.13 `kitluy_devices`

All tables (`hardware_profiles`, `devices`, `device_certificates`, `device_assignments`,
`device_capabilities`, `provisioning_sessions`, `device_actions`, `peripheral_tests`,
`rma_cases`): SELECT PC-PLATFORM (`devices.read`) or owning-tenant read where assigned; all
writes PC-RPC gated by the fleet permission keys (`devices.register`, `devices.assign`,
`devices.certificate.issue/rotate`, `devices.revoke`, `devices.remote_action.*`) with the
approval classes from the RBAC registry. `device_certificates`, `peripheral_tests`, and
completed `device_actions` are PC-AO. DELETE **PROHIBITED** schema-wide.

### 5.14 `kitluy_sync`

All tables: PC-SVC/PC-DEVICE — only the Sync Service workload and validated device context
touch them (`ingest_event_batch_v1`, `pull_changes_v1`). `device_heartbeats`, `sync_inbox`,
`sync_outbox` rows are PC-AO (**UPDATE limited to status columns via service RPC; DELETE
PROHIBITED**). `sync_conflicts` resolution is PC-RPC with governed reconciliation permission.
No human client role has direct DML.

### 5.15 `kitluy_files`

| Tables                                       | SELECT                                                                | INSERT                              | UPDATE                                   | DELETE                               |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------- | ------------------------------------ |
| `file_objects`, `file_links`                 | PC-TENANT/PC-STORE + `files.read` + classification (RLS-018, RLS-024) | PC-RPC (`create_upload_session_v1`) | PC-RPC (`complete_upload_v1` activation) | **PROHIBITED** (retention jobs only) |
| `upload_sessions`, `download_grants`         | own-session / grantee only                                            | PC-RPC                              | PC-RPC (revoke/complete)                 | **PROHIBITED**                       |
| `file_processing_jobs`, `retention_policies` | PC-SVC / PC-PLATFORM                                                  | PC-SVC / PC-PLATFORM                | PC-SVC                                   | **PROHIBITED**                       |
| `file_access_events`                         | PC-PLATFORM (`audit.read`)                                            | PC-SVC (PC-AO)                      | **PROHIBITED**                           | **PROHIBITED**                       |

### 5.16 `kitluy_releases`

`release_artifacts`, `release_channels`, `rollout_campaigns`, `device_installations`: SELECT
PC-PLATFORM (`releases.read`); writes PC-RPC (`start_rollout_v1`,
`record_installation_health_v1`, `trigger_rollback_v1`) gated by promotion permissions with
A2/A3/A4 per the registry. Registered artifacts and completed campaigns are PC-AO. DELETE
**PROHIBITED** schema-wide.

### 5.17 `kitluy_config`

`configuration_versions`: PC-AO — published versions immutable (**UPDATE/DELETE PROHIBITED**);
corrections publish a higher version via `publish_configuration_v1`.
`configuration_publications`, `configuration_targets`, `configuration_acknowledgements`:
SELECT PC-STORE/PC-LOC/PC-DEVICE; INSERT PC-RPC/PC-SVC/PC-DEVICE (acknowledgements); UPDATE
status-only via RPC; DELETE **PROHIBITED**.

### 5.18 `kitluy_integrations`

`connector_definitions`: PC-PLATFORM governance. `channel_connections`, `connection_scopes`:
PC-TENANT/PC-STORE read (`integrations.read`); writes PC-RPC with `integrations.*` permissions
(production enable = A3). `webhook_events`: PC-SVC INSERT (signature-verified ingress, PC-AO);
`outbound_deliveries`, `channel_ingress_orders`, `shop_projections`, `catalog_projections`,
`catalog_projection_items`, `reconciliation_statuses`: PC-SVC writes; tenant-scoped reads.
Connector identities themselves have **no** database path (RLS-014). UPDATE prohibited on
received `webhook_events` payloads; DELETE **PROHIBITED** schema-wide.

### 5.19 `kitluy_notifications`

`templates`: PC-PLATFORM versioned. `preferences`, `push_tokens`: subject-scoped
(own-user/own-tenant) reads and RPC writes. `notification_jobs`, `delivery_attempts`,
`notification_events`: PC-SVC (PC-AO for attempts/events — **UPDATE/DELETE PROHIBITED**);
tenant-scoped read of own delivery truth.

### 5.20 `kitluy_jobs` and `kitluy_events`

All tables (`jobs`, `job_attempts`, `job_leases`, `dead_letters`, `schedules`,
`domain_events`, `event_subscriptions`, `event_delivery_attempts`): PC-SVC only — no human
client role has direct DML; humans interact via governed RPCs (`platform.jobs.retry`,
`platform.jobs.dead_letter_manage` — A3 for finance/device/release jobs). `domain_events`,
`job_attempts`, `event_delivery_attempts` are PC-AO (**UPDATE/DELETE PROHIBITED**). Background
workers resolve per-item scope; a mixed-tenant batch never leaks across items (RLS-029).

### 5.21 `kitluy_audit`

| Tables                                                       | SELECT                                            | INSERT                       | UPDATE         | DELETE         |
| ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------- | -------------- | -------------- |
| `audit_logs`, `sensitive_action_approvals`                   | PC-PLATFORM (`audit.read`) + scope-filtered views | trigger/definer only (PC-AO) | **PROHIBITED** | **PROHIBITED** |
| `access_reviews`, `access_review_items`, `evidence_packages` | PC-PLATFORM                                       | PC-RPC (PC-AO)               | **PROHIBITED** | **PROHIBITED** |

Roles that write business records receive **no** direct audit-table mutation rights (audit
registry §4); audit capture happens in the same transaction via `write_audit_log` /
transactional outbox.

### 5.22 `kitluy_ai`

`ai_requests`, `ai_responses`, `retrieval_events`, `tool_calls`, `feedback_events`: PC-SVC
INSERT (AI Gateway identity, PC-AO), actor-scoped reads. `prompt_policies`, `model_routes`,
`tool_registry`: PC-PLATFORM versioned (`ai.policies.manage` A3; write-tool enablement A4).
`documents`, `chunks`, `generated_insights`: PC-TENANT/PC-STORE with access-scope labels —
retrieval is scope-filtered **before** model access, and unauthorized chunks must be absent
from results and citations (RLS-030). DELETE **PROHIBITED** on request/response/event tables.

### 5.23 `kitluy_reporting`

Views/materialized views only; each declares a security-barrier/RLS strategy and inherits the
strictest scope of its sources. `authorization_effective_grants_read` is diagnostics-only —
authorization is still enforced by API/RLS/helpers, never by the view. Exports honor scope
manifests (RLS-025). No independent write authority; refresh is a maintenance function under a
registered service identity.

## 6. Service and device identity rules

1. Machine principals use `kitluy_auth.service_identities` records with class, environment,
   owner, and explicit grants (service-account policy §3). They never inherit human team
   membership or interactive login.
2. One credential never spans environments; a staging credential presented to production fails
   closed (RLS-013/RLS-022 analogues for machines).
3. Devices authenticate with operational certificates from `kitluy_devices.device_certificates`
   validated against `device_assignments`; a certificate assigned to Location A cannot invoke
   Location B APIs (RLS-015), and terminal roles are enforced at the RPC layer — a T3 profile
   cannot call the T4 completion mutation (RLS-016).
4. Store Hub offline continuity never weakens identity/custody/audit: local actions carry
   device identity, staff PIN session, terminal role, and append-only local audit, reconciled
   idempotently by the Sync Service.
5. A worker executing a human-triggered sensitive action must carry the originating human
   actor, assignment, approval request, and payload hash; worker authority cannot manufacture
   missing human approval (service-account policy §5).

## 7. Service-role safety register

The Supabase service role (or any RLS-bypassing role) is **never a generic bypass**. Every path
must appear in this register; an unregistered service-role usage is a release blocker. Columns:
authz-before-DB = the application-layer authorization performed before any query runs.

| #   | Owning service (identity key)                    | Operation                                                                                                                               | Context propagated                                             | Authz before DB                                                                                    | Audit                                              | Tests                                                        |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------ |
| 1   | Sync Service (`svc_sync`)                        | `kitluy_sync` inbox/outbox ingestion, cursor updates, batch reconciliation                                                              | device_id, certificate serial, location, sequence, correlation | Device certificate + assignment + environment validated; per-event scope resolved                  | `sync` events + `device.*` audit rows              | RLS-013, RLS-015, RLS-029; replay/dedupe tests               |
| 2   | Job worker (`svc_jobs`)                          | `kitluy_jobs` lease/claim/attempt/dead-letter writes                                                                                    | job scope, originating actor (if human-triggered), correlation | Job payload scope resolved per item; A3 approval context verified for sensitive job types          | `job.*` audit events                               | RLS-029; worker-cannot-execute-A3-without-approval test      |
| 3   | Notification Service (`svc_notifications`)       | `kitluy_notifications` job/attempt/event writes                                                                                         | recipient scope, template version, correlation                 | Consent/preference checked; recipient scope resolved server-side                                   | delivery lifecycle events                          | cross-tenant recipient denial; consent-suppression test      |
| 4   | File Service (`svc_files`)                       | `kitluy_files` metadata activation, grant issuance, processing jobs                                                                     | actor, tenant/store scope, purpose, classification             | `files.read`/class checks via `has_permission` before signing                                      | `file_access_events` (PC-AO), `file.access_issued` | RLS-018, RLS-024; foreign-tenant signing denial              |
| 5   | Integration ingress (`svc_webhook_ingress`)      | `kitluy_integrations.webhook_events` insert, `channel_ingress_orders` quarantine                                                        | provider key, signature verdict, connection scope              | Signature + timestamp/replay + connection status verified before insert                            | `webhook.*` / `integration.*` events               | RLS-014; forged-signature and replay tests                   |
| 6   | Reporting refresh (`svc_reporting`)              | `kitluy_reporting` materialized view refresh; `kitluy_partner.mobile_snapshots`, `kitluy_storefront.storefront_status_snapshots` builds | snapshot scope + `as_of`                                       | Source scope fixed at definition time; no ad-hoc SQL                                               | refresh evidence with freshness                    | RLS-025 scope-manifest test; projection scope test           |
| 7   | Migration runner (`svc_migrations`, CI/CD class) | DDL application in development/staging only                                                                                             | migration id, content hash, actor, environment                 | KL-INF-P1-037: production application is human-operated with A3 four-eyes; CI may never auto-apply | `kitluy_ops.migration_journal` + evidence package  | RLS-028 (CI fails on tenant table without RLS); journal test |
| 8   | AI Gateway (`svc_ai_gateway`)                    | `kitluy_ai` request/response/retrieval/tool-call writes                                                                                 | actor, tenant/store scope, policy version, correlation         | Retrieval filters applied before model access; tool calls check permission + approval              | `ai.tool_call_executed`, retrieval events          | RLS-030; read-identity-cannot-write-tool test                |
| 9   | Audit writer (definer functions)                 | `kitluy_audit.audit_logs`, `kitluy_auth.authorization_decisions` appends                                                                | full event envelope per audit registry §2                      | Invoked only from RPC/trigger paths that already passed authorization                              | is the audit                                       | append-only rejection tests; redaction tests                 |

Register rules: every row's credential is server-only, environment-separated, rotated per the
secrets policy, and attributable (workload, deployment, correlation, originating actor). Adding
a service-role path requires updating this register plus a negative test in the same change.

## 8. Sensitive-action RPC workflows

Every workflow below runs the full chain — permission → resource scope → environment →
re-authentication → reason → approval (A-class) → separation of duties → immutable audit —
through `kitluy_auth.request_approval_v1` / `decide_approval_v1` / `issue_execution_token_v1`
and `consume_execution_token` (sensitive-action policy §4–§7). No state may be skipped
client-side; payload/target/environment change invalidates prior approval.

| Workflow                 | Entry RPC / path                                                               | Permission key                                                     | Scope                           | Env                     | Re-auth                      | Reason                        | Approval                           | SoD rule                                                                                   | Primary audit event                                                 |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------- | ----------------------- | ---------------------------- | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Role/permission grant    | `request_approval_v1` → assignment RPC                                         | `rbac.assignment_manage` (owner-level: `rbac.owner_access_manage`) | platform…store_location         | all (A4: pilot/prod/dr) | Yes pilot/prod               | Required                      | A2; A3 high-risk/broad; A4 owner   | Granter cannot certify own access review                                                   | `rbac.assignment_changed` / `rbac.owner_access_changed`             |
| Digital Store activation | activation RPC                                                                 | `digital_stores.activate`                                          | digital_store                   | pilot/prod              | Yes                          | Required + readiness evidence | A3                                 | Readiness preparer ≠ approver                                                              | `digital_store.activated`                                           |
| Refund                   | `payments.refund` request/approve RPCs                                         | `payments.refund.request` / `payments.refund.approve`              | payment, store_location, tenant | pilot/prod              | Yes/PIN                      | Required                      | A2 request; A3 above threshold     | Requester cannot approve own refund                                                        | `payment.refund_requested` / `payment.refund_approved`              |
| Void                     | void RPC                                                                       | `payments.void.request`                                            | store_location, transaction     | store_edge/pilot/prod   | Yes/PIN                      | Required                      | A2                                 | Supervisor distinct from cashier for overrides                                             | `payment.void_requested`                                            |
| Reconciliation override  | `kitluy_sync.sync_conflicts` / `kitluy_partner.reconciliations` resolution RPC | `inventory.adjustment.approve` / finance reconciliation key        | store_location, tenant          | pilot/prod              | Yes                          | Required                      | A3 above materiality threshold     | Counter ≠ approver of variance resolution                                                  | `inventory.adjustment_approved`                                     |
| Support access           | `kitluy_admin.begin_support_access_v1`                                         | `support.consent_session.start` (+ `support.impersonation.start`)  | support_session                 | pilot/prod              | Yes (+MFA for impersonation) | Required + ticket + consent   | A3 for impersonation/write         | Support requester ≠ approver; Partner consent mandatory, revocable, expiring (RLS-019/020) | `support.consent_session_started` / `support.impersonation_started` |
| Device revocation        | device revocation RPC                                                          | `devices.revoke`                                                   | device, store_location          | pilot/prod              | Yes                          | Required + incident           | A3 for active Hub                  | Replacement registrar ≠ revocation approver                                                | `device.revoked`                                                    |
| Release promotion        | `kitluy_releases.start_rollout_v1` / promotion RPCs                            | `releases.promote_pilot` / `releases.promote_stable`               | region/cohort → platform        | pilot / prod            | Yes (+MFA stable)            | Required + evidence           | A3 (A4 platform-wide rollback)     | Rollout creator cannot approve own promotion                                               | `release.promoted_pilot` / `release.promoted_stable`                |
| Replay repair            | `webhooks.replay` RPC; `platform.jobs.dead_letter_manage` RPC                  | `webhooks.replay` / `platform.jobs.dead_letter_manage`             | connector/tenant; service/job   | all / pilot/prod        | Yes in prod                  | Required                      | A2; A3 finance/device/release jobs | Original failure owner ≠ sole replay approver for finance jobs                             | `webhook.replay_requested` / `job.dead_letter_changed`              |

Common guarantees: idempotency key mandatory; retry is exactly-once in business effect;
execution tokens are single-use, short-lived, payload-hash-bound, server-consumed; requester
self-approval is denied at both RPC and RLS layers (RLS-021); every allow/deny lands in
`kitluy_auth.authorization_decisions` and `kitluy_audit.audit_logs`.

## 9. Isolation test plans (RLS-001..RLS-030)

Execution home: `supabase/tests/` (pgTAP/SQL harness per test pack §6 — transaction-scoped
claims, rollback per case). **Execution is BLOCKED (BLK-002)**; static structure checks run via
`pnpm db:validate` and `pnpm db:schema:check`.

| ID      | Method (test pack §3)      | Plan and pass condition                                                                                                                                               |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RLS-001 | SQL + PostgREST            | `anon` probes `kitluy_core.tenants` (and every other `kitluy_*` table in the enumeration sweep): zero rows, zero counts, generic error — no policy exists for `anon`. |
| RLS-002 | SQL + RPC + Realtime + API | `authenticated` user with no membership: `current_tenant_ids()` returns empty; denied across table, RPC, Realtime and API.                                            |
| RLS-003 | SQL + PostgREST            | Tenant A reads a Tenant B primary key (`kitluy_orders.orders`, `kitluy_core.customers`): zero rows or generic not-found; no metadata leak.                            |
| RLS-004 | SQL + PostgREST            | Tenant A INSERT carrying Tenant B `tenant_id`: fails `WITH CHECK`; no business or audit row is created.                                                               |
| RLS-005 | SQL                        | Tenant A UPDATE of a Tenant B row: denied; original row byte-identical.                                                                                               |
| RLS-006 | SQL                        | Tenant A DELETE of a Tenant B mutable row: denied (and DELETE is prohibited on most tables regardless of tenant).                                                     |
| RLS-007 | SQL + API                  | Location-scoped user reads sibling Location rows (`kitluy_pos.shifts`, `kitluy_laundry.pickup_handoffs`): denied — `current_location_ids()` excludes siblings.        |
| RLS-008 | SQL + API                  | Digital-Store-scoped user reads another Store of the same Tenant: denied unless an explicit tenant-level scope exists.                                                |
| RLS-009 | SQL + reporting            | Chain regional role reads an unassigned region: denied; `kitluy_reporting` chain aggregates exclude it.                                                               |
| RLS-010 | Cached-token method        | Membership revoked while JWT still valid: helpers re-resolve relationally per statement; access stops at the next statement.                                          |
| RLS-011 | SQL + API                  | Suspended user with a live session: `admin_user_profiles`/profile status check in helpers denies.                                                                     |
| RLS-012 | SQL                        | Inactive Digital Store membership: store-scoped reads/writes denied.                                                                                                  |
| RLS-013 | service-to-service         | Service identity crosses its declared tenant (register §7 rows 1–3): denied, alerted, and recorded in `authorization_decisions`.                                      |
| RLS-014 | PostgREST                  | Connector token against a tenant table: denied — connectors have no database path at all (Connector API only).                                                        |
| RLS-015 | Edge API                   | Location-A device certificate calls a Location-B Edge API: assignment mismatch denies before any query.                                                               |
| RLS-016 | RPC                        | T3 device/profile calls `kitluy_laundry.complete_pickup_v1` (T4-only): denied and audited (`terminal_mode_events` evidence).                                          |
| RLS-017 | RPC                        | Readonly role calls any mutation RPC: `assert_permission` raises `KLUY-AUTH-*`; no side effects.                                                                      |
| RLS-018 | SQL + files                | Finance role reads a restricted issue photo: `kitluy_files` classification policy denies unless separately granted.                                                   |
| RLS-019 | SQL + API                  | Support operator without an active consent session: denied on consent-scoped resources.                                                                               |
| RLS-020 | SQL + API                  | Consent expiry/revocation: denial is immediate (helpers are `STABLE`, no cross-statement cache).                                                                      |
| RLS-021 | RPC + SQL                  | Four-eyes requester self-approves: denied by SoD check and `kitluy_auth.approval_decisions` constraints.                                                              |
| RLS-022 | API + SQL                  | Staging-environment grant against production: `AUTH_ENVIRONMENT_DENIED`; environments never bleed.                                                                    |
| RLS-023 | Realtime                   | Subscription to a foreign tenant topic: denied and no previously buffered event is delivered (publications only attach in migration group 0140, after policies).      |
| RLS-024 | files                      | Signed-URL/download-grant generation for a foreign tenant `kitluy_files.file_objects` row: denied; `file_access_events` records the denial.                           |
| RLS-025 | reporting/export           | Export including an unauthorized Location: blocked, or rows excluded with an explicit scope manifest.                                                                 |
| RLS-026 | timing probe               | Aggregate count/timing probes across tenants show no material side channel (generic errors, no count leak).                                                           |
| RLS-027 | static + runtime           | `SECURITY DEFINER` without a scope predicate: static catalog assertion (group 0160) fails, and the runtime exploit attempt is denied.                                 |
| RLS-028 | CI static                  | A migration introducing a tenant table without RLS fails CI before apply (`pnpm db:validate` conventions + group 0120/0160 assertions).                               |
| RLS-029 | worker                     | Mixed-tenant background batch: each item resolves scope independently; no cross-tenant read/write occurs.                                                             |
| RLS-030 | AI/RAG                     | Retrieval across scope: unauthorized `kitluy_ai.chunks` are absent from results and citations remain scoped.                                                          |

Validator requirements (test pack §5) apply to every case: zero unauthorized rows/mutations,
generic errors, no unauthorized side effects, positive control user still succeeds, and 100%
enumeration of tenant-scoped tables/views/functions/publications before G3.

## 10. Realtime and file-access authorization

1. Realtime publications are defined only by migration group 0140, only for projection-safe
   tables — never raw finance, payment, custody, audit, or PII rows. Publication membership is
   part of the reviewed migration surface, not runtime configuration.
2. Subscription authorization runs the same helper chain as SELECT policies: a topic resolves
   to tenant/store/location scope and the subscriber must hold it; a denied subscriber receives
   no buffered backlog (RLS-023).
3. File bytes live in DigitalOcean Spaces; Supabase stores metadata only. Signed access is
   issued exclusively through `kitluy_files.create_download_grant_v1`, which checks
   `files.read` + classification + scope before signing, writes `download_grants`, and appends
   `file_access_events` (RLS-018, RLS-024). There is no direct-bucket enumeration path.
4. Support-consent file access additionally requires an active `support_access_sessions` row
   whose scope lists the resource; consent expiry revokes signing immediately (RLS-020).

## 11. Fail-closed rules

1. RLS `ENABLE` + `FORCE` on every `kitluy_*` table; missing policy means deny, never allow.
2. Helper functions return empty/false on any unresolved input: unknown actor, disabled
   profile, expired assignment, unknown permission key, missing environment grant, missing
   scope, ambiguous ancestry.
3. Unknown, disabled, expired, or deprecated-without-compatibility permission keys fail closed;
   wildcard grants are prohibited in production.
4. Client-supplied tenant/store/location IDs are parameters, never predicates; ancestry is
   re-derived server-side (`AUTH_RESOURCE_RELATIONSHIP_INVALID` on mismatch).
5. Approval evaluation failure, SoD conflict, stale re-auth, or payload mismatch aborts before
   any DML; partial application requires incident/reconciliation handling.
6. Errors are generic: no existence, ID, count, name, or status disclosure across scope
   boundaries (RLS-003, RLS-026).
7. Break-glass cannot disable RLS, audit, finance/custody integrity, or tenant isolation.
8. A migration that would leave a tenant-scoped table without RLS, or an append-only table
   without its `enforce_append_only` guard, must fail CI before apply (RLS-028; migration plan
   groups 0120/0160).

## 12. Acceptance criteria for CONTRACT-APPROVED

1. Independent review confirms this specification against the data dictionary (every table
   classified; no orphan), the RBAC registry (every mutation path names a permission key), and
   the test pack (all RLS-001..030 mapped).
2. The migration plan groups 0120/0130/0160 implement exactly these categories; the observed
   dictionary diff shows no unclassified relation.
3. The service-role safety register matches deployed workload identities one-to-one.
4. RLS execution evidence (blocked today under BLK-002) is attached before any status beyond
   CONTRACT-APPROVED is claimed.

## Post-review disclosure (WS-04-T001 review, 2026-07-26)

Four audit events cited by workflows in this specification are not yet rows in
the 68-key audit event registry: `rbac.owner_access_changed`,
`payment.void_requested`, `support.consent_session_started`,
`file.access_issued`. Approving this specification authorizes their additive
registration in `kitluy-audit-event-registry-v1.0.0` — no existing key is
altered.
