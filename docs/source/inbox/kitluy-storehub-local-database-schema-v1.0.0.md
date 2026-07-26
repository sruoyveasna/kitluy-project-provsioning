# KitLuy Store Hub Local Database Schema

**Filename:** `kitluy-storehub-local-database-schema-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Domain:** KitLuy Store Hub / Edge Operations  
**Primary vertical:** Phase 1 — Laundry  
**Status:** Canonical target contract; not implementation evidence  
**Database target:** PostgreSQL 16 on Linux ARM64  
**Owner:** HET / KitLuy Suite Project Owner

> **Purpose:** Define the authoritative local relational model that lets one KitLuy Store Location continue operating through its Store Hub while disconnected from KitLuy Cloud.

## 0. Authority and relationship to other contracts

This document is subordinate to current owner decisions, applied migrations, verified code/tests and production evidence. It implements the approved rules that the Store Hub is the local operational authority after provisioning; terminals never write directly to PostgreSQL; configuration is projected from cloud; finalized finance, payment, custody and audit records are append-only; and T1–T4 operate through authenticated LAN contracts.

Companion contracts:

- `kitluy-storehub-lan-api-v1.0.0.md`
- `kitluy-edge-sync-protocol-v1.0.0.md`
- `kitluy-sync-conflict-resolution-policy-v1.0.0.md`
- `kitluy-offline-idempotency-and-sequencing-v1.0.0.md`
- `kitluy-configuration-snapshot-contract-v1.0.0.md`
- `kitluy-storehub-file-cache-and-transfer-protocol-v1.0.0.md`
- `kitluy-terminal-profile-contract-t1-t4-v1.0.0.md`

## 1. Binding database conventions

| Concern                       | Contract                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Engine                        | PostgreSQL 16, `UTF8`, locale supplied by the KitLuy OS image                                                    |
| Time                          | `timestamptz`, stored in UTC; business rendering uses `Asia/Phnom_Penh`                                          |
| Primary keys                  | Application-generated UUIDv7; database type `uuid`                                                               |
| Money                         | `amount_minor bigint`, `currency_code char(3)`, `currency_exponent smallint`; KHR exponent `0`, USD exponent `2` |
| Quantities and weights        | `numeric(18,4)`; never floating point                                                                            |
| Hashes                        | Lowercase hexadecimal SHA-256, `char(64)`                                                                        |
| Configuration                 | Immutable signed snapshots; one active snapshot per Location                                                     |
| Operational truth             | Local commit succeeds before a POS mutation is reported successful                                               |
| Finance/payment/custody/audit | Append-only; corrections are compensating records                                                                |
| Inventory/consumables         | Movement ledger; no generic last-write-wins quantity overwrite                                                   |
| Deletion                      | No hard delete for finalized business records; use lifecycle state or tombstone events                           |
| JSON                          | Allowed only for optional metadata, provider payloads and diagnostics; not authoritative core fields             |
| Scoping                       | Every business row contains `tenant_id`, `digital_store_id`, and `location_id` unless it is device-global        |
| Access                        | Only `kitluy-hub-agent` database roles; POS terminals have no database credentials                               |
| Transactions                  | `READ COMMITTED` normally; `SERIALIZABLE` for sequence allocation, storage assignment and final custody release  |

## 2. Local schemas

```text
edge_identity   Hub, installation, credential, terminal and actor cache
edge_config     Signed configuration snapshots, sections and activations
edge_core       Customers, shifts and local business sequences
edge_laundry    Bookings, garments, tags, storage and custody
edge_payments   Payments, tender legs, attempts and compensating adjustments
edge_documents  Receipts, print jobs and print attempts
edge_files      Local asset metadata and resumable transfer state
edge_sync       Events, outbox, inbox, cursors, conflicts and dead letters
edge_hardware   Peripheral bindings, observations and heartbeats
edge_audit      Immutable audit, security and support-session evidence
```

No vertical-specific table may be placed in `edge_core`. Later verticals add their own schema and reuse shared schemas.

## 3. Database roles

| Role                 | Purpose                          | Privileges                                                 |
| -------------------- | -------------------------------- | ---------------------------------------------------------- |
| `kitluy_migrator`    | Signed migration runner          | DDL during controlled maintenance only                     |
| `kitluy_hub_runtime` | Main Hub services                | Required DML and stored procedures                         |
| `kitluy_sync_worker` | Outbox/inbox and reconciliation  | Restricted sync tables plus approved projection procedures |
| `kitluy_backup`      | Encrypted backup                 | Read-only plus backup functions                            |
| `kitluy_support_ro`  | Consent-bound diagnostic session | Redacted views only; no business writes                    |

`postgres`, superuser and service-role credentials must not be available to terminal applications or support staff.

## 4. Migration order

```text
0000_extensions_and_roles.sql
0001_types_and_helpers.sql
0002_identity.sql
0003_configuration.sql
0004_core.sql
0005_laundry.sql
0006_payments_and_cash.sql
0007_documents_and_print.sql
0008_files.sql
0009_sync.sql
0010_hardware.sql
0011_audit_and_security.sql
0012_indexes_and_constraints.sql
0013_views_and_procedures.sql
0014_seed_reference_profiles.sql
```

Migrations are additive and checksum-registered. An applied file is never edited. A failed migration leaves the previous A/B application and schema compatibility set active.

## 5. Shared types

```sql
create type edge_sync.delivery_state as enum
  ('pending','sending','acknowledged','retry_wait','blocked','dead_letter');
create type edge_sync.inbox_state as enum
  ('received','verified','applied','rejected','dead_letter');
create type edge_sync.conflict_state as enum
  ('open','auto_resolved','operator_required','resolved','waived');
create type edge_documents.print_state as enum
  ('queued','dispatching','printed','failed','retry_wait','dead_letter','cancelled');
create type edge_config.activation_state as enum
  ('downloaded','verified','staged','active','rejected','rolled_back');
create type edge_files.transfer_state as enum
  ('local_only','queued','uploading','uploaded','verifying','available','failed','quarantined','evicted');
create type edge_hardware.health_state as enum
  ('unknown','ready','busy','degraded','disconnected','misconfigured','unsupported','maintenance_required');
```

## 6. Mandatory table catalogue

The column list is normative. Implementations may add diagnostic columns through additive migrations, but may not remove or repurpose listed columns.

### 6.1 `edge_identity`

#### `edge_identity.hub_device`

| Column                      | Type                 | Rule                                |
| --------------------------- | -------------------- | ----------------------------------- |
| `id`                        | uuid PK              | KitLuy device UUID                  |
| `asset_number`              | text unique not null | HET asset identifier                |
| `device_kind`               | text not null        | `store_hub`                         |
| `lifecycle_status`          | text not null        | Registry lifecycle value            |
| `trust_status`              | text not null        | `trusted`, `quarantined`, `revoked` |
| `board_serial_hash`         | char(64) not null    | Hashed board serial                 |
| `factory_duid_hash`         | char(64) not null    | Hashed Raspberry Pi DUID            |
| `root_key_fingerprint`      | char(64) not null    | Hardware-backed key fingerprint     |
| `manufacturing_cert_serial` | text not null        | Factory certificate serial          |
| `created_at`                | timestamptz not null | Enrollment time                     |
| `updated_at`                | timestamptz not null | Last local observation              |

#### `edge_identity.hub_installation`

`id uuid PK`, `hub_device_id uuid FK`, `installation_generation int`, `nvme_serial_hash char(64)`, `nvme_model text`, `nvme_capacity_bytes bigint`, `os_release_id text`, `os_image_sha256 char(64)`, `secure_boot_generation int`, `storage_key_generation int`, `installed_at timestamptz`, `status text`. Unique: `(hub_device_id, installation_generation)`.

#### `edge_identity.hub_assignment`

`id uuid PK`, `hub_device_id uuid FK`, `tenant_id uuid`, `digital_store_id uuid`, `location_id uuid`, `assignment_generation int`, `assigned_at timestamptz`, `ended_at timestamptz null`, `status text`, `operational_cert_serial text`. Exactly one active assignment per Hub.

#### `edge_identity.device_credential`

`id uuid PK`, `device_id uuid`, `credential_type text`, `public_key_fingerprint char(64)`, `certificate_serial text unique`, `issuer text`, `issued_at timestamptz`, `expires_at timestamptz`, `status text`, `revoked_at timestamptz null`, `revocation_reason text null`, `rotation_generation int`.

#### `edge_identity.terminal_device`

`id uuid PK`, scope columns, `terminal_name text`, `hardware_profile_id uuid`, `installation_id uuid`, `certificate_serial text`, `assignment_generation int`, `lifecycle_status text`, `last_client_sequence bigint default 0`, `last_seen_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`. Unique: `(location_id, terminal_name)`.

#### `edge_identity.terminal_session`

`id uuid PK`, scope columns, `terminal_device_id uuid`, `actor_id uuid`, `profile_code text`, `opened_at timestamptz`, `expires_at timestamptz`, `closed_at timestamptz null`, `session_generation int`, `last_event_sequence bigint default 0`, `status text`. A terminal can have one active staff session per profile.

#### `edge_identity.staff_cache`

`actor_id uuid PK`, scope columns, `display_name text`, `credential_verifier bytea`, `permission_snapshot_version bigint`, `profile_codes text[]`, `offline_valid_until timestamptz`, `disabled boolean`, `last_synced_at timestamptz`. The credential verifier is one-way and encrypted at rest.

### 6.2 `edge_config`

#### `edge_config.configuration_snapshot`

`id uuid PK`, scope columns, `snapshot_version bigint`, `schema_version int`, `created_at timestamptz`, `not_before timestamptz`, `expires_at timestamptz null`, `minimum_hub_version text`, `maximum_hub_version text null`, `manifest_sha256 char(64)`, `signature_algorithm text`, `signature bytea`, `signing_key_id text`, `state edge_config.activation_state`, `downloaded_at timestamptz`, `activated_at timestamptz null`. Unique: `(location_id, snapshot_version)`.

#### `edge_config.configuration_section`

`id uuid PK`, `snapshot_id uuid FK`, `section_code text`, `section_version bigint`, `content_sha256 char(64)`, `content_json jsonb`, `required boolean`, `validation_state text`, `validation_error text null`. Unique: `(snapshot_id, section_code)`.

#### `edge_config.configuration_activation`

`id uuid PK`, scope columns, `snapshot_id uuid`, `previous_snapshot_id uuid null`, `started_at timestamptz`, `completed_at timestamptz null`, `result text`, `health_check_json jsonb`, `rollback_reason text null`, `actor_type text`, `actor_id uuid null`. Only one active snapshot is exposed through the active-configuration view.

#### `edge_config.terminal_profile_assignment`

`id uuid PK`, scope columns, `terminal_device_id uuid`, `profile_code text`, `assignment_version bigint`, `enabled boolean`, `effective_from timestamptz`, `effective_until timestamptz null`, `source_snapshot_id uuid`. Unique active assignment: `(terminal_device_id, profile_code)`.

#### `edge_config.hardware_profile`

`id uuid PK`, `profile_code text unique`, `device_class text`, `manufacturer text`, `model text`, `hardware_revision text`, `interface_type text`, `driver_id text`, `driver_version text`, `capabilities_json jsonb`, `certification_status text`, `certification_evidence_id text null`, `minimum_hub_version text`, `created_at timestamptz`, `retired_at timestamptz null`.

#### `edge_config.peripheral_binding`

`id uuid PK`, scope columns, `hardware_profile_id uuid`, `logical_role text`, `connection_uri text`, `terminal_device_id uuid null`, `fallback_priority smallint`, `enabled boolean`, `source_snapshot_id uuid`, `last_validated_at timestamptz`. Unique: `(location_id, logical_role, fallback_priority)`.

### 6.3 `edge_core`

#### `edge_core.customer`

`id uuid PK`, scope columns, `cloud_customer_id uuid null`, `display_name text`, `phone_e164 text null`, `email_normalized text null`, `language_code text`, `consent_sms boolean`, `consent_email boolean`, `source text`, `record_version bigint`, `created_at timestamptz`, `updated_at timestamptz`, `deleted_at timestamptz null`. Local duplicate detection never auto-merges customer identity.

#### `edge_core.customer_identifier`

`id uuid PK`, scope columns, `customer_id uuid`, `identifier_type text`, `normalized_value_hash char(64)`, `masked_value text`, `verified_at timestamptz null`, `created_at timestamptz`. Unique: `(location_id, identifier_type, normalized_value_hash, customer_id)`.

#### `edge_core.business_sequence`

`location_id uuid`, `sequence_code text`, `business_date date`, `next_value bigint`, `allocation_generation int`, `updated_at timestamptz`; PK `(location_id, sequence_code, business_date)`. Updated only by a serializable stored procedure.

#### `edge_core.shift`

`id uuid PK`, scope columns, `terminal_device_id uuid`, `actor_id uuid`, `business_date date`, `opened_at timestamptz`, `closed_at timestamptz null`, `opening_float_minor bigint`, `currency_code char(3)`, `expected_cash_minor bigint null`, `counted_cash_minor bigint null`, `variance_minor bigint null`, `status text`, `close_approval_id uuid null`.

#### `edge_core.cash_movement`

`id uuid PK`, scope columns, `shift_id uuid`, `movement_type text`, `amount_minor bigint`, `currency_code char(3)`, `reason_code text null`, `related_payment_id uuid null`, `actor_id uuid`, `terminal_device_id uuid`, `occurred_at timestamptz`, `event_id uuid unique`. Append-only.

### 6.4 `edge_laundry`

#### `edge_laundry.booking`

| Column               | Type             | Rule                                                               |
| -------------------- | ---------------- | ------------------------------------------------------------------ |
| `id`                 | uuid PK          | Stable Booking ID                                                  |
| scope columns        | uuid             | Required                                                           |
| `booking_number`     | text             | Unique per Location                                                |
| `customer_id`        | uuid null        | Walk-in allowed only by policy                                     |
| `status`             | text             | Current projection from events                                     |
| `business_date`      | date             | Location business date                                             |
| `currency_code`      | char(3)          | Snapshot currency                                                  |
| `subtotal_minor`     | bigint           | Immutable after intake confirmation except compensating adjustment |
| `discount_minor`     | bigint           | Snapshot                                                           |
| `tax_minor`          | bigint           | Snapshot                                                           |
| `total_minor`        | bigint           | Snapshot                                                           |
| `paid_minor`         | bigint           | Projection of append-only payments                                 |
| `balance_minor`      | bigint           | Derived and checked                                                |
| `due_at`             | timestamptz null | Due time                                                           |
| `pickup_method`      | text             | `store_pickup` or approved delivery value                          |
| `config_snapshot_id` | uuid             | Pricing and policy provenance                                      |
| `aggregate_version`  | bigint           | Increments per accepted event                                      |
| `created_at`         | timestamptz      | Local commit time                                                  |
| `updated_at`         | timestamptz      | Projection update time                                             |

Unique: `(location_id, booking_number)`. Check: `balance_minor = total_minor - paid_minor + refunded_minor` through a maintained projection.

#### `edge_laundry.booking_line`

`id uuid PK`, scope columns, `booking_id uuid`, `service_id uuid`, `service_version bigint`, `display_name text`, `pricing_method text`, `unit_price_minor bigint`, `currency_code char(3)`, `quantity numeric(18,4)`, `unit_code text`, `line_subtotal_minor bigint`, `discount_minor bigint`, `tax_minor bigint`, `line_total_minor bigint`, `addon_snapshot_json jsonb`, `source_config_version bigint`, `created_at timestamptz`. Confirmed lines are immutable.

#### `edge_laundry.garment`

`id uuid PK`, scope columns, `booking_id uuid`, `booking_line_id uuid null`, `garment_code text`, `garment_type text`, `color text null`, `condition_code text null`, `special_handling text null`, `current_custody_state text`, `created_at timestamptz`. Unique `(location_id, garment_code)`.

#### `edge_laundry.bag`

`id uuid PK`, scope columns, `booking_id uuid`, `bag_code text`, `expected_piece_count int null`, `current_piece_count int null`, `current_custody_state text`, `created_at timestamptz`. Unique `(location_id, bag_code)`.

#### `edge_laundry.tag`

`id uuid PK`, scope columns, `booking_id uuid`, `garment_id uuid null`, `bag_id uuid null`, `tag_code text`, `tag_type text`, `issued_at timestamptz`, `voided_at timestamptz null`, `void_reason text null`. Unique `(location_id, tag_code)`.

#### `edge_laundry.status_event`

`id uuid PK`, scope columns, `booking_id uuid`, `from_status text null`, `to_status text`, `reason_code text null`, `actor_id uuid`, `terminal_device_id uuid`, `occurred_at timestamptz`, `local_sequence bigint`, `event_id uuid unique`. Append-only.

#### `edge_laundry.exception`

`id uuid PK`, scope columns, `booking_id uuid`, `garment_id uuid null`, `bag_id uuid null`, `exception_type text`, `severity text`, `blocking boolean`, `status text`, `note text null`, `evidence_asset_id uuid null`, `created_by uuid`, `created_at timestamptz`, `resolved_by uuid null`, `resolved_at timestamptz null`, `resolution_code text null`.

#### `edge_laundry.storage_position`

`id uuid PK`, scope columns, `position_code text`, `position_type text`, `zone_code text null`, `capacity int default 1`, `status text`, `record_version bigint`, `source_snapshot_id uuid`, `updated_at timestamptz`. Unique `(location_id, position_code)`.

#### `edge_laundry.storage_assignment`

`id uuid PK`, scope columns, `booking_id uuid`, `garment_id uuid null`, `bag_id uuid null`, `storage_position_id uuid`, `assigned_at timestamptz`, `assigned_by uuid`, `terminal_device_id uuid`, `cleared_at timestamptz null`, `cleared_by uuid null`, `clear_reason text null`, `assignment_event_id uuid unique`. A partial unique index prevents more than one active assignment per stored unit and prevents over-capacity assignment.

#### `edge_laundry.custody_event`

`id uuid PK`, scope columns, `booking_id uuid`, `garment_id uuid null`, `bag_id uuid null`, `event_type text`, `from_custody_state text null`, `to_custody_state text`, `storage_position_id uuid null`, `actor_id uuid`, `terminal_device_id uuid`, `session_id uuid`, `occurred_at timestamptz`, `local_sequence bigint`, `reason_code text null`, `payload_sha256 char(64)`, `event_id uuid unique`. Append-only.

#### `edge_laundry.ready_scan_session`

`id uuid PK`, scope columns, `booking_id uuid`, `terminal_device_id uuid`, `actor_id uuid`, `started_at timestamptz`, `completed_at timestamptz null`, `expected_count int`, `scanned_count int`, `qa_state text`, `storage_state text`, `status text`, `idempotency_key text unique`.

#### `edge_laundry.pickup_session`

`id uuid PK`, scope columns, `booking_id uuid`, `terminal_device_id uuid`, `actor_id uuid`, `started_at timestamptz`, `collector_verification_method text null`, `collector_verified_at timestamptz null`, `expected_count int`, `scanned_count int`, `payment_gate_state text`, `completed_at timestamptz null`, `status text`, `idempotency_key text unique`.

### 6.5 `edge_payments`

#### `edge_payments.payment`

`id uuid PK`, scope columns, `booking_id uuid`, `payment_number text`, `payment_type text`, `amount_minor bigint`, `currency_code char(3)`, `state text`, `provider_code text null`, `provider_reference text null`, `requested_at timestamptz`, `confirmed_at timestamptz null`, `reversed_at timestamptz null`, `actor_id uuid`, `terminal_device_id uuid`, `event_id uuid unique`, `idempotency_key text unique`. Append-only state transitions through payment events; no state may jump from `requested` to `confirmed` without an authorized confirmation path.

#### `edge_payments.payment_attempt`

`id uuid PK`, scope columns, `payment_id uuid`, `attempt_number int`, `request_sha256 char(64)`, `provider_state text`, `provider_reference text null`, `requested_at timestamptz`, `responded_at timestamptz null`, `error_code text null`, `response_metadata jsonb`. Unique `(payment_id, attempt_number)`.

#### `edge_payments.tender_leg`

`id uuid PK`, scope columns, `payment_id uuid`, `tender_type text`, `amount_minor bigint`, `currency_code char(3)`, `state text`, `provider_reference text null`, `event_id uuid unique`. Required when mixed tender becomes enabled.

#### `edge_payments.refund_adjustment`

`id uuid PK`, scope columns, `booking_id uuid`, `original_payment_id uuid null`, `adjustment_type text`, `amount_minor bigint`, `currency_code char(3)`, `reason_code text`, `approval_id uuid null`, `state text`, `created_at timestamptz`, `event_id uuid unique`. Append-only.

### 6.6 `edge_documents`

#### `edge_documents.receipt`

`id uuid PK`, scope columns, `booking_id uuid`, `payment_id uuid null`, `receipt_number text`, `document_type text`, `template_version bigint`, `content_sha256 char(64)`, `render_asset_id uuid null`, `issued_at timestamptz`, `issued_by uuid`, `reprint_of_id uuid null`, `reprint_reason text null`, `event_id uuid unique`. Unique `(location_id, receipt_number)`.

#### `edge_documents.print_job`

`id uuid PK`, scope columns, `document_type text`, `document_id uuid`, `printer_binding_id uuid`, `template_version bigint`, `payload_sha256 char(64)`, `copies smallint`, `duplicate_suppression_key text unique`, `state edge_documents.print_state`, `priority smallint`, `created_at timestamptz`, `next_attempt_at timestamptz`, `attempt_count int`, `last_error_code text null`, `created_by uuid`, `terminal_device_id uuid`.

#### `edge_documents.print_attempt`

`id uuid PK`, `print_job_id uuid`, `attempt_number int`, `started_at timestamptz`, `completed_at timestamptz null`, `adapter_version text`, `printer_observation_id uuid null`, `result text`, `error_code text null`, `bytes_sent bigint null`. Unique `(print_job_id, attempt_number)`.

### 6.7 `edge_files`

#### `edge_files.asset`

`id uuid PK`, scope columns, `asset_class text`, `owner_type text`, `owner_id uuid`, `mime_type text`, `size_bytes bigint`, `sha256 char(64)`, `local_relative_path text`, `encryption_key_generation int`, `retention_class text`, `state edge_files.transfer_state`, `cloud_object_key text null`, `cloud_etag text null`, `created_at timestamptz`, `uploaded_at timestamptz null`, `verified_at timestamptz null`, `evicted_at timestamptz null`. Unique `(location_id, sha256, owner_type, owner_id, asset_class)` where policy permits dedupe.

#### `edge_files.asset_chunk`

`asset_id uuid`, `chunk_number int`, `offset_bytes bigint`, `size_bytes int`, `sha256 char(64)`, `received boolean`, `uploaded boolean`, `updated_at timestamptz`; PK `(asset_id, chunk_number)`.

#### `edge_files.file_transfer_job`

`id uuid PK`, scope columns, `asset_id uuid`, `direction text`, `state edge_files.transfer_state`, `remote_session_id text null`, `next_chunk_number int`, `attempt_count int`, `next_attempt_at timestamptz`, `last_error_code text null`, `created_at timestamptz`, `updated_at timestamptz`.

### 6.8 `edge_sync`

#### `edge_sync.local_event`

`id uuid PK`, scope columns, `hub_device_id uuid`, `origin_device_id uuid`, `actor_id uuid null`, `aggregate_type text`, `aggregate_id uuid`, `aggregate_version bigint`, `event_type text`, `schema_version int`, `business_date date`, `occurred_at timestamptz`, `hub_sequence bigint unique`, `origin_sequence bigint`, `idempotency_key text unique`, `payload_sha256 char(64)`, `payload jsonb`, `created_at timestamptz`. Immutable.

#### `edge_sync.outbox`

`event_id uuid PK`, scope columns, `hub_sequence bigint unique`, `delivery_state edge_sync.delivery_state`, `attempt_count int`, `next_attempt_at timestamptz`, `last_attempt_at timestamptz null`, `last_error_code text null`, `cloud_ack_id text null`, `acknowledged_at timestamptz null`, `dead_letter_reason text null`. Inserted in the same transaction as the business mutation.

#### `edge_sync.inbox`

`message_id uuid PK`, scope columns, `message_type text`, `schema_version int`, `cloud_sequence bigint`, `issued_at timestamptz`, `expires_at timestamptz null`, `payload_sha256 char(64)`, `payload jsonb`, `signature bytea`, `signing_key_id text`, `state edge_sync.inbox_state`, `received_at timestamptz`, `applied_at timestamptz null`, `error_code text null`. Unique `(location_id, cloud_sequence)`.

#### `edge_sync.sync_cursor`

`location_id uuid`, `stream_code text`, `last_pushed_hub_sequence bigint`, `last_acked_hub_sequence bigint`, `last_pulled_cloud_sequence bigint`, `last_applied_cloud_sequence bigint`, `updated_at timestamptz`; PK `(location_id, stream_code)`.

#### `edge_sync.sync_conflict`

`id uuid PK`, scope columns, `conflict_type text`, `data_class text`, `local_event_id uuid null`, `cloud_reference text null`, `detected_at timestamptz`, `state edge_sync.conflict_state`, `severity text`, `local_summary jsonb`, `cloud_summary jsonb`, `resolution_code text null`, `resolved_by uuid null`, `resolved_at timestamptz null`, `resolution_event_id uuid null`.

#### `edge_sync.dead_letter_item`

`id uuid PK`, scope columns, `source_kind text`, `source_id uuid`, `error_code text`, `error_message text`, `payload_sha256 char(64)`, `first_failed_at timestamptz`, `last_failed_at timestamptz`, `attempt_count int`, `operator_action_required boolean`, `resolved_at timestamptz null`, `resolution_note text null`.

### 6.9 `edge_hardware`

#### `edge_hardware.peripheral_observation`

`id uuid PK`, scope columns, `peripheral_binding_id uuid`, `observed_at timestamptz`, `health_state edge_hardware.health_state`, `firmware_version text null`, `driver_version text`, `connection_state text`, `capabilities_hash char(64)`, `details_json jsonb`, `terminal_device_id uuid null`.

#### `edge_hardware.device_heartbeat`

`id uuid PK`, scope columns, `device_id uuid`, `device_kind text`, `observed_at timestamptz`, `application_version text`, `config_snapshot_version bigint`, `uptime_seconds bigint`, `cpu_temperature_c numeric(5,2) null`, `disk_free_bytes bigint null`, `lan_state text`, `wan_state text`, `last_hub_sequence bigint null`, `health_state text`, `details_json jsonb`.

### 6.10 `edge_audit`

#### `edge_audit.audit_event`

`id uuid PK`, scope columns, `event_code text`, `actor_type text`, `actor_id uuid null`, `requester_id uuid null`, `approver_id uuid null`, `terminal_device_id uuid null`, `hub_device_id uuid`, `profile_code text null`, `resource_type text`, `resource_id uuid null`, `reason_code text null`, `correlation_id uuid`, `occurred_at timestamptz`, `payload_sha256 char(64)`, `details_json jsonb`, `local_sequence bigint unique`. Immutable.

#### `edge_audit.security_event`

`id uuid PK`, scope columns nullable for pre-assignment events, `event_code text`, `severity text`, `device_id uuid null`, `certificate_serial text null`, `source_ip inet null`, `detected_at timestamptz`, `details_json jsonb`, `acknowledged_by uuid null`, `acknowledged_at timestamptz null`, `cloud_synced_at timestamptz null`.

#### `edge_audit.support_session`

`id uuid PK`, scope columns, `support_actor_id uuid`, `approved_by uuid`, `reason text`, `scopes text[]`, `started_at timestamptz`, `expires_at timestamptz`, `revoked_at timestamptz null`, `status text`, `consent_evidence_id uuid`, `session_public_key bytea`, `last_activity_at timestamptz null`.

## 7. Required stored procedures

| Procedure                                                 | Transaction isolation | Result                                                                |
| --------------------------------------------------------- | --------------------- | --------------------------------------------------------------------- |
| `edge_core.allocate_business_number(code, business_date)` | Serializable          | Collision-safe display number                                         |
| `edge_sync.accept_terminal_command(...)`                  | Serializable          | Deduplicated command acceptance and Hub sequence allocation           |
| `edge_laundry.confirm_intake(...)`                        | Serializable          | Booking totals, payment gate, custody intake and outbox in one commit |
| `edge_laundry.assign_ready_storage(...)`                  | Serializable          | Prevents double storage assignment                                    |
| `edge_laundry.complete_pickup(...)`                       | Serializable          | Collector/payment gate, custody release, storage clear and completion |
| `edge_payments.record_cash_payment(...)`                  | Serializable          | Payment, cash movement, audit and outbox                              |
| `edge_documents.enqueue_print_job(...)`                   | Read committed        | Durable deduplicated job                                              |
| `edge_config.activate_snapshot(...)`                      | Serializable          | Atomic configuration switch                                           |
| `edge_sync.apply_inbox_message(...)`                      | Serializable          | Signature-verified deduplicated cloud message                         |

Every procedure returns `request_id`, `aggregate_id`, `aggregate_version`, `event_ids`, `hub_sequence_range`, and `sync_state`.

## 8. Required indexes

- All scoped tables: `(tenant_id, digital_store_id, location_id)`.
- Open outbox: `(delivery_state, next_attempt_at, hub_sequence)` partial where not acknowledged.
- Inbox: `(state, cloud_sequence)`.
- Booking lookup: `(location_id, booking_number)`, `(location_id, customer_id, updated_at desc)`.
- Tag lookup: `(location_id, tag_code)`.
- Active storage: `(location_id, storage_position_id)` partial where `cleared_at is null`.
- Payment provider reference: `(provider_code, provider_reference)` partial when present.
- File upload queue: `(state, next_attempt_at)`.
- Audit and security: `(location_id, occurred_at desc)` and `(severity, detected_at desc)`.

## 9. Event/outbox transaction invariant

```sql
begin;
  -- validate actor, device, profile and idempotency key
  -- mutate only allowed projection rows
  -- append immutable domain event(s)
  -- append immutable audit event(s)
  -- insert each domain event into outbox
commit;
```

A business mutation without its corresponding event and outbox row is invalid and must fail the transaction.

## 10. Retention and compaction

| Data                          | Local minimum                                                        |
| ----------------------------- | -------------------------------------------------------------------- |
| Unacknowledged events/outbox  | Until acknowledged and included in verified backup                   |
| Acknowledged events           | 180 days minimum; longer when disk permits                           |
| Finance/payment/custody/audit | Entire active Location retention; archive only through signed policy |
| Inbox                         | 90 days after apply                                                  |
| Heartbeats                    | 30 days raw, then summarized                                         |
| Diagnostics                   | 14 days by default; configurable                                     |
| Files                         | Per retention class and watermarks in the file-cache contract        |

The Hub may compact projections, never immutable event identifiers needed for reconciliation.

## 11. Backup and restore rules

- `pg_basebackup` or approved physical backup plus WAL continuity.
- Backups encrypted with installation-generation keys.
- Restore preserves UUIDs, Hub sequence, origin sequence and idempotency keys.
- After restore, outbox acknowledgements are reconciled before sending; duplicates are safe.
- A restored Hub cannot activate if its device, installation or assignment identity fails trust verification.

## 12. Acceptance tests

1. Terminal cannot connect directly to PostgreSQL.
2. Duplicate idempotency key returns the original result without new events.
3. Power loss between business mutation and outbox insertion is impossible because both share one transaction.
4. Concurrent T3 assignments cannot exceed storage capacity.
5. T4 completion cannot occur with unresolved payment or custody blockers.
6. A confirmed payment cannot be deleted or silently rewritten.
7. Configuration activation is all-or-nothing and retains the previous version.
8. Restore and replay create no duplicate receipt, payment, notification or custody event.
9. Cross-Tenant, cross-Digital-Store and cross-Location rows are rejected by procedures and tests.
10. One qualified engineer can recreate the schema from this document and versioned migrations.

## Appendix A — Scope columns

Unless explicitly exempted, “scope columns” means:

```sql
tenant_id uuid not null,
digital_store_id uuid not null,
location_id uuid not null
```

## Appendix B — Default display-number profiles

These are operational identifiers, not statutory fiscal-number declarations:

```text
Booking: KLB-{LOCATION_CODE}-{YYMMDD}-{SEQ6}
Receipt: KLR-{LOCATION_CODE}-{YYMMDD}-{SEQ6}
Tag:     KLT-{LOCATION_CODE}-{BASE32_UUID10}
```

A later owner-approved legal/fiscal numbering policy may replace the receipt display format without changing UUID identity or event idempotency.
