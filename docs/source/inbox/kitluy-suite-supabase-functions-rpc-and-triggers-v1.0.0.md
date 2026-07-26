# KitLuy Suite Supabase Functions, RPC and Triggers

**Filename:** `kitluy-suite-supabase-functions-rpc-and-triggers-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target function/trigger contract; not implementation evidence

> **Mission:** Define the only approved database-side computation and mutation boundaries, with explicit authorization, idempotency, locking, validation, audit and side effects.

## Authority and implementation-truth rule

This artifact is a **canonical target implementation contract**. It is not evidence that a database object, policy, function, seed, deployment, backup, or test exists.

Authority order:

1. Current KitLuy project-owner decisions and the active KitLuy Project Instructions.
2. Applied SQL migrations, verified repository code/tests, deployed environment evidence, and production evidence.
3. `kitluy-suite-supabase-schema-v1.0.0.md`, `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`, and `kitluy-suite-supabase-migration-plan-v1.0.0.md`.
4. This artifact and the other documents in the Supabase implementation pack.
5. Current Suite, Business, product, Store Hub, infrastructure, and API specifications.
6. Approved handoffs and evidence-based comparison/classification documents.
7. Competitor clone documents and superseded planning.

**Applied SQL migrations are the final deployed schema truth.** Documentation may generate, review, explain, or validate migrations, but it must never become a parallel database definition. A documentation-to-migration mismatch must fail CI or be recorded in the reconciliation register before release.

No capability may be labeled `IMPLEMENTED` without repository, applied-migration, executable-test, deployment, and applicable pilot/production evidence.

## Function classes

| Class                | Security                                                  | Use                                                                        |
| -------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Pure helper          | invoker                                                   | Deterministic formatting, validation or scope computation; no writes.      |
| Authorization helper | stable/invoker or tightly reviewed definer                | Resolve actor context, permissions and scope for RLS/API.                  |
| Command RPC          | `SECURITY DEFINER`, locked `search_path`, explicit grants | Multi-table side-effecting mutation with idempotency and audit.            |
| Query RPC            | invoker/security barrier                                  | Complex role-safe read where views are insufficient.                       |
| Trigger function     | owner-only                                                | Mechanical invariant, timestamps, append-only guard, outbox/audit capture. |
| Maintenance function | service identity only                                     | Controlled projection refresh, partition maintenance or fixture reset.     |

Rules: revoke `PUBLIC`; set explicit `search_path`; schema-qualify all objects; validate `auth.uid()`/service identity; never trust client-supplied tenant scope; set row locks in deterministic order; return stable typed results and errors.

## Authorization helpers

| Function                                                                              | Contract                                                                                      |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `kitluy_auth.current_actor_context()`                                                 | Returns user/service/device identity, assurance, environment and request/correlation context. |
| `kitluy_auth.has_permission(permission_key, resource_type, resource_id, environment)` | Fail-closed effective permission evaluation.                                                  |
| `kitluy_auth.assert_permission(...)`                                                  | Raises stable `KLUY-AUTH-*` error on deny.                                                    |
| `kitluy_auth.current_tenant_ids()`                                                    | Tenant IDs authorized for current actor; used carefully in RLS.                               |
| `kitluy_auth.current_digital_store_ids()`                                             | Authorized Digital Stores after membership/scope evaluation.                                  |
| `kitluy_auth.current_location_ids()`                                                  | Authorized Locations after scope/exclusion evaluation.                                        |
| `kitluy_auth.require_reauthentication(max_age_seconds)`                               | Verifies recent high-assurance authentication.                                                |
| `kitluy_auth.consume_execution_token(token, payload_hash)`                            | Atomic single-use approval token consumption.                                                 |
| `kitluy_auth.record_authorization_decision(...)`                                      | Append-only diagnostic evidence; must not leak secrets.                                       |

## Core command RPC catalog

| RPC                                                                                     | Required behavior                                                                            |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `kitluy_core.create_tenant_partner_v1(payload, idempotency_key)`                        | Create Tenant and Partner atomically; no Location.                                           |
| `kitluy_core.create_digital_store_v1(payload, idempotency_key)`                         | Validate exactly one primary vertical and create initial configuration state.                |
| `kitluy_core.create_store_location_v1(payload, idempotency_key)`                        | Create optional physical Location under existing Digital Store; validate inherited vertical. |
| `kitluy_core.update_store_configuration_v1(payload, expected_version, idempotency_key)` | Optimistic concurrency and immutable publication history.                                    |
| `kitluy_core.link_customer_contact_v1(...)`                                             | Normalize, verify and prevent cross-customer duplicate contact.                              |
| `kitluy_core.resolve_reference_value_v1(registry_key, value_code, at_time)`             | Returns effective reference row and translation context.                                     |

## Laundry/POS command RPC catalog

| RPC                                                                                                                   | Required behavior                                                                                      |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `kitluy_orders.create_laundry_booking_v1(payload, idempotency_key)`                                                   | Validate T1/authorized source, current price version, customer, lines, totals and produce event/audit. |
| `kitluy_orders.add_booking_payment_v1(payload, idempotency_key)`                                                      | Create tender/attempt atomically; never overwrite captured payment.                                    |
| `kitluy_orders.transition_booking_status_v1(order_id, target_status, reason_code, expected_version, idempotency_key)` | Validate transition matrix, role/terminal, blocking exceptions and produce history/event.              |
| `kitluy_laundry.record_garment_scan_v1(payload, idempotency_key)`                                                     | Validate T1/T3/T4 role, custody state, tag and Location.                                               |
| `kitluy_laundry.assign_ready_storage_v1(payload, idempotency_key)`                                                    | T3-only; lock position; one active assignment; mark Ready only when counts/quality pass.               |
| `kitluy_laundry.complete_pickup_v1(payload, idempotency_key)`                                                         | T4-only; verify collector, garments, balance policy and create custody release/completion atomically.  |
| `kitluy_laundry.open_exception_v1(...)`                                                                               | Append exception and block unsafe transitions.                                                         |
| `kitluy_laundry.resolve_exception_v1(...)`                                                                            | Permission, reason/evidence and optional approval required.                                            |
| `kitluy_pos.open_shift_v1(...)`                                                                                       | One valid open shift per register policy; record float.                                                |
| `kitluy_pos.close_shift_v1(...)`                                                                                      | Compute expected cash, accept count, variance and approval path.                                       |
| `kitluy_pos.record_scale_reading_v1(...)`                                                                             | Store raw/tare/stability and only authorize stable reading for pricing.                                |

## Storefront RPC catalog

| RPC                                                       | Required behavior                                                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `kitluy_storefront.create_pre_intake_draft_v1(...)`       | Public-safe session, rate limit and Digital Store/Location validation.                              |
| `kitluy_storefront.submit_pre_intake_v1(...)`             | Freeze immutable submitted version and payload hash.                                                |
| `kitluy_storefront.join_queue_v1(...)`                    | Apply queue policy and issue scoped ticket exactly once.                                            |
| `kitluy_storefront.call_queue_ticket_v1(...)`             | T1 permission and FIFO/priority policy evidence.                                                    |
| `kitluy_storefront.verify_intake_v1(...)`                 | Store T1 actual values and typed differences.                                                       |
| `kitluy_storefront.convert_pre_intake_to_booking_v1(...)` | Exactly-once link to authoritative Booking; uses Booking RPC internally or shared command function. |

## Device/sync/file command RPC catalog

| RPC                                          | Required behavior                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `kitluy_devices.start_provisioning_v1(...)`  | Validate HET-recorded device, hardware profile and intended assignment; issue short-lived code hash.       |
| `kitluy_devices.activate_device_v1(...)`     | Proof of non-exportable key possession; certificate and assignment creation; one-time session consumption. |
| `kitluy_devices.rotate_certificate_v1(...)`  | Approved rotation, overlap policy, revocation history.                                                     |
| `kitluy_sync.ingest_event_batch_v1(...)`     | Verify device certificate/context, sequence/hash, dedupe, per-event result and reconciliation.             |
| `kitluy_sync.pull_changes_v1(...)`           | Scope-safe cursor page; compatibility version and payload limits.                                          |
| `kitluy_files.create_upload_session_v1(...)` | Create metadata and presign request contract; bytes go to Spaces.                                          |
| `kitluy_files.complete_upload_v1(...)`       | Verify size/checksum/object existence, activate metadata, enqueue scan/processing.                         |
| `kitluy_files.create_download_grant_v1(...)` | Permission/purpose/expiry and access audit; return grant metadata, not permanent URL.                      |

## Approval, release and support RPCs

- `kitluy_auth.request_approval_v1`
- `kitluy_auth.decide_approval_v1`
- `kitluy_auth.issue_execution_token_v1`
- `kitluy_admin.begin_support_access_v1`
- `kitluy_admin.record_support_intervention_v1`
- `kitluy_releases.start_rollout_v1`
- `kitluy_releases.record_installation_health_v1`
- `kitluy_releases.trigger_rollback_v1`
- `kitluy_config.publish_configuration_v1`

Each validates environment, permission, approval policy, request hash and immutable audit.

## Trigger catalog

| Trigger                           | Tables                                                                      | Rule                                                                         |
| --------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `set_updated_at`                  | Approved mutable configuration tables                                       | Mechanical timestamp only; no hidden business behavior.                      |
| `enforce_append_only`             | payments, stock movements, audit, events, custody scans, approval decisions | Reject UPDATE/DELETE for non-maintenance owner role.                         |
| `enforce_scope_consistency`       | Tenant/Store/Location tables                                                | Child Tenant/Digital Store/Location must match parent FKs.                   |
| `validate_digital_store_vertical` | Digital Store/vertical links and vertical tables                            | One primary vertical and correct vertical delta.                             |
| `increment_version`               | Mutable config aggregates                                                   | Atomic monotonic version when explicitly updated.                            |
| `write_domain_event_outbox`       | Approved aggregate roots                                                    | Insert versioned event in same transaction; no external network call.        |
| `write_audit_log`                 | Sensitive tables/RPCs                                                       | Append actor/action/resource/result; business RPC may supply richer context. |
| `prevent_finalized_mutation`      | finalized order/payment/invoice records                                     | Corrections require compensating RPC.                                        |
| `validate_money_currency`         | money-bearing tables                                                        | Currency/exponent and nonnegative/allowed-sign rules.                        |
| `validate_active_period`          | versioned/effective rows                                                    | Non-overlapping active ranges where required.                                |
| `notify_realtime_hint`            | selected projection tables only                                             | Optional lightweight notification; never publish sensitive payload blindly.  |

Triggers must not call HTTP, providers, queues or Edge Functions. External side effects are driven from transactional outbox/job rows after commit.

## Stable error model

Database functions raise structured codes such as `KLUY-AUTH-001`, `KLUY-IDEMP-001`, `KLUY-STATE-001`, `KLUY-SCOPE-001`, `KLUY-PAY-001`, `KLUY-INVENTORY-001`, `KLUY-DEVICE-001`, `KLUY-FILE-001`. Edge/API layers map them without exposing SQL text.

## Acceptance criteria

1. Every `SECURITY DEFINER` function has locked search path, explicit owner, revoked public execute and tests for privilege escalation.
2. Commands are idempotent and concurrent-safe.
3. All side effects produce outbox/job rows in the same transaction.
4. Trigger behavior is deterministic, minimal and covered by SQL tests.
5. No client writes directly to append-only or multi-table aggregate tables where an RPC is required.
6. Function signatures are versioned; breaking changes create a new function version.
