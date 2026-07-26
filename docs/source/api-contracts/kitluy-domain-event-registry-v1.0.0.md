# KitLuy Domain Event Registry

**Filename:** `kitluy-domain-event-registry-v1.0.0.md`  
**Version:** v1.0.0

**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Canonical target contract; not implementation evidence  
**Scope:** Shared KitLuy Core, Integration Hub, Store Hub, all current and future verticals  
**Primary phase:** Phase 1 Laundry foundation with additive cross-vertical reuse  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies target behavior. Nothing is `IMPLEMENTED` until matching repository code, applied migrations, executable tests, deployed workers/services, monitoring evidence and approved pilot or production evidence exist.

## 0. Authority and source baseline

### 0.1 Authority order

1. Current owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. This contract family and the approved canonical Supabase/API contracts.
4. Current KitLuy Rebuild, Business and product specifications.
5. Approved handoffs and feature registries.
6. Evidence-based competitor analyses.
7. Competitor clone documents and superseded planning.

### 0.2 Governing sources

- `Current KitLuy Project Instructions` — highest owner authority for the eight-phase roadmap, Digital Store model, Store Hub authority, append-only truth, API/event rules and evidence discipline.
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — minimum Phase 1 event families, durable-job families, configuration/provisioning state machines, API replay route and four-eyes authorization controls.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — local transactional outbox/inbox, ordered sync, per-event acknowledgement, append-only custody/payment truth and conflict rules.
- `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` — Laundry Booking, Ready, payment, custody and pickup operational event vocabulary.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — at-least-once queues, idempotent consumers, bounded exponential backoff, dead-letter handling, webhook verification and relational job truth.
- `kitluy-master-feature-registry-v0.2.md` and approved comparison/backlog packages — Phase 1 requirement for versioned domain events, durable jobs, webhooks, outbox/inbox and replay controls.

### 0.3 Non-negotiable rules

- Events, jobs and webhook records are relational, versioned, tenant-scoped, auditable and retry-safe.
- Transport is assumed **at least once**. Business effects must be idempotent.
- Finalized payment, refund, inventory, finance, custody and audit truth is append-only or corrected through explicit compensating records.
- Store Hub local operations continue after provisioning when WAN is unavailable.
- External connectors never receive direct production-database access and never become the authority for customer, inventory, payment or finance truth.
- Sensitive replay, repair, financial, permission, configuration, provisioning and production actions require authorized human confirmation; high-risk actions require four-eyes approval.
- Missing, stale, partial or unreconciled data must never be presented as authoritative truth.

## 1. Purpose and boundary

This registry defines immutable facts emitted **after** authoritative state commits. It is not a command API, not a workflow engine and not permission to let consumers mutate producer-owned records.

### 1.1 Event naming

- Canonical form: `<bounded_context>.<past_tense_fact>`, lowercase dot-separated, for example `payment.recorded`.
- The event name is immutable. Schema version is carried in `schema_version`; it is not encoded into the canonical name.
- Older planning aliases such as `digital_store_created.v1` or `laundry.booking_created.v1` are compatibility aliases only. New contracts use `digital_store.created` and `laundry_booking.created`.
- Commands use imperative names and are not placed in this registry.

## 2. Common event envelope v1

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/envelope/v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "event_id",
    "event_name",
    "schema_version",
    "occurred_at",
    "recorded_at",
    "tenant_id",
    "aggregate_type",
    "aggregate_id",
    "aggregate_version",
    "producer",
    "source",
    "correlation_id",
    "idempotency_key",
    "payload",
    "payload_sha256"
  ],
  "properties": {
    "event_id": { "type": "string", "format": "uuid", "description": "UUIDv7 preferred" },
    "event_name": { "type": "string", "pattern": "^[a-z0-9_]+\\.[a-z0-9_]+$" },
    "schema_version": { "type": "integer", "minimum": 1 },
    "occurred_at": { "type": "string", "format": "date-time" },
    "recorded_at": { "type": "string", "format": "date-time" },
    "tenant_id": { "type": "string", "format": "uuid" },
    "digital_store_id": { "type": ["string", "null"], "format": "uuid" },
    "location_id": { "type": ["string", "null"], "format": "uuid" },
    "aggregate_type": { "type": "string" },
    "aggregate_id": { "type": "string", "format": "uuid" },
    "aggregate_version": { "type": "integer", "minimum": 1 },
    "producer": { "type": "string" },
    "source": {
      "type": "object",
      "additionalProperties": false,
      "required": ["source_type", "source_id"],
      "properties": {
        "source_type": {
          "enum": [
            "cloud_service",
            "store_hub",
            "terminal",
            "mobile_client",
            "connector",
            "operator"
          ]
        },
        "source_id": { "type": "string" },
        "device_id": { "type": ["string", "null"], "format": "uuid" },
        "software_version": { "type": ["string", "null"] }
      }
    },
    "actor": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "properties": {
        "actor_type": { "enum": ["user", "service", "device", "connector", "system"] },
        "actor_id": { "type": "string" },
        "permission_key": { "type": ["string", "null"] },
        "approval_request_id": { "type": ["string", "null"], "format": "uuid" }
      }
    },
    "correlation_id": { "type": "string", "format": "uuid" },
    "causation_id": { "type": ["string", "null"], "format": "uuid" },
    "trace_id": { "type": ["string", "null"] },
    "idempotency_key": { "type": "string", "minLength": 8, "maxLength": 200 },
    "payload": { "type": "object" },
    "payload_sha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
    "replay": {
      "type": "object",
      "additionalProperties": false,
      "required": ["is_replay"],
      "properties": {
        "is_replay": { "type": "boolean" },
        "replay_run_id": { "type": ["string", "null"], "format": "uuid" },
        "original_event_id": { "type": ["string", "null"], "format": "uuid" }
      }
    },
    "metadata": { "type": "object", "description": "Optional non-authoritative metadata only" }
  }
}
```

## 3. Retention and data-class policy

| Class | Intended records                                                   | Online retention                | Archive / deletion                                                                |
| ----- | ------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| `R1`  | Low-risk operational telemetry                                     | `[REQUIRED: approved duration]` | May be aggregated after approved period.                                          |
| `R2`  | Business lifecycle and onboarding                                  | `[REQUIRED: approved duration]` | Archive according to legal and support policy.                                    |
| `R3`  | Provisioning, configuration, sync and connector evidence           | `[REQUIRED: approved duration]` | Preserve enough history for incident reconstruction and compatibility support.    |
| `R4`  | Payment, refund, inventory, custody, finance and security evidence | `[REQUIRED: approved duration]` | Append-only; deletion or anonymization only under approved legal/privacy process. |

Payloads must minimize personal data. Secrets, access tokens, private keys, full card data and unrestricted file bytes are prohibited.

## 4. Registry

| ID             | Event                             | Producer                                        | Authorized consumers                                                                     | Aggregate                   | Version | Retention | Ordering                                                                     |
| -------------- | --------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- | ------: | --------- | ---------------------------------------------------------------------------- |
| `EVT-CORE-001` | `digital_store.created`           | Management API / Digital Store Service          | Configuration Service; Partner/Chain projections; Audit; onboarding jobs                 | `digital_store`             |      v1 | R2        | Per `digital_store_id` aggregate version                                     |
| `EVT-EDGE-001` | `location.provisioning_requested` | Management API / Provisioning Service           | Provisioning Worker; Device/Fleet Service; System Status                                 | `store_location`            |      v1 | R2        | Per `location_id` request sequence                                           |
| `EVT-EDGE-002` | `hub.activated`                   | Edge Operations API / Hub Provisioning Service  | Device/Fleet Service; Configuration Service; System Status; Admin/Partner projections    | `device`                    |      v1 | R3        | Per `hub_device_id` activation generation                                    |
| `EVT-EDGE-003` | `terminal.assigned`               | Management API / Device Assignment Service      | Store Hub; Fleet Service; POS entitlement projection; Audit                              | `device_assignment`         |      v1 | R3        | Per `terminal_device_id` assignment generation                               |
| `EVT-LND-001`  | `laundry_booking.created`         | Store Hub Laundry Service / Edge Operations API | Laundry workflow projections; Partner/Chain reports; Notification Service; cloud sync    | `laundry_booking`           |      v1 | R3        | Per `booking_id` aggregate version                                           |
| `EVT-LND-002`  | `laundry_booking.ready`           | Store Hub T3 Laundry Service                    | T4 pickup projection; Notification Service; Partner App/Portal; reporting                | `laundry_booking`           |      v1 | R3        | Per `booking_id` aggregate version; after all required Ready custody entries |
| `EVT-LND-003`  | `garment.custody_scanned_in`      | Store Hub T3 Custody Service                    | Laundry Booking projection; storage projection; audit; cloud sync                        | `garment`                   |      v1 | R4        | Strict per `garment_id` custody sequence                                     |
| `EVT-LND-004`  | `garment.custody_scanned_out`     | Store Hub T4 Custody Service                    | Laundry Booking completion projection; audit; customer receipt; cloud sync               | `garment`                   |      v1 | R4        | Strict per `garment_id` custody sequence                                     |
| `EVT-PAY-001`  | `payment.recorded`                | Payment Service / Store Hub Payment Ledger      | Finance subledger; Booking/transaction projection; receipt; reconciliation; audit        | `payment`                   |      v1 | R4        | Per `payment_id`; linked transaction balance recalculated deterministically  |
| `EVT-PAY-002`  | `payment.refunded`                | Payment Service / Refund Service                | Finance subledger; transaction projection; provider reconciliation; audit; notifications | `refund`                    |      v1 | R4        | Per `refund_id`; references original `payment_id`                            |
| `EVT-INV-001`  | `inventory.movement_posted`       | Inventory Service / Store Hub Inventory Ledger  | Inventory balances; costing; purchasing; reports; reconciliation                         | `inventory_movement`        |      v1 | R4        | Per stock item + Location ledger sequence                                    |
| `EVT-CFG-001`  | `configuration.published`         | Management API / Configuration Service          | Store Hub inbox; channel projections; status/readiness; audit                            | `configuration_publication` |      v1 | R3        | Per target scope publication generation                                      |
| `EVT-CFG-002`  | `configuration.activated`         | Store Hub Configuration Agent / Channel Runtime | Configuration Service; System Status; Audit; rollout health                              | `configuration_activation`  |      v1 | R3        | Per target device/channel activation generation                              |
| `EVT-SYNC-001` | `sync.batch_accepted`             | Edge Operations API / Sync Ingestion Service    | Store Hub acknowledgement; reconciliation; System Status; audit                          | `sync_batch`                |      v1 | R3        | Per Hub sync cursor and local sequence range                                 |
| `EVT-INT-001`  | `connector.delivery_failed`       | Webhook Dispatcher / Connector Worker           | Integration health; retry scheduler; alerting; reconciliation; Admin Portal              | `connector_delivery`        |      v1 | R3        | Per `delivery_id` attempt sequence                                           |

## 5. Exact payload contracts

### EVT-CORE-001 — `digital_store.created`

**Meaning:** A new Digital Store was committed under a Tenant/Partner.  
**Producer:** Management API / Digital Store Service  
**Consumers:** Configuration Service; Partner/Chain projections; Audit; onboarding jobs  
**Aggregate / ordering:** `digital_store` / Per `digital_store_id` aggregate version  
**Retention class:** R2

| Payload field      | Type     | Rule                          |
| ------------------ | -------- | ----------------------------- |
| `digital_store_id` | `uuid`   | required                      |
| `tenant_id`        | `uuid`   | required                      |
| `partner_id`       | `uuid`   | required                      |
| `name`             | `string` | required                      |
| `primary_vertical` | `string` | required; Phase 1 = `laundry` |
| `status`           | `string` | required                      |
| `created_by`       | `uuid`   | required                      |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/digital_store.created/v1.json",
  "title": "digital_store.created payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "digital_store_id",
    "tenant_id",
    "partner_id",
    "name",
    "primary_vertical",
    "status",
    "created_by"
  ],
  "properties": {
    "digital_store_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "tenant_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "partner_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "name": {
      "type": "string",
      "description": "required"
    },
    "primary_vertical": {
      "type": "string",
      "description": "required; Phase 1 = `laundry`"
    },
    "status": {
      "type": "string",
      "description": "required"
    },
    "created_by": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "digital_store_id": "00000000-0000-7000-8000-000000000001",
  "tenant_id": "00000000-0000-7000-8000-000000000001",
  "partner_id": "00000000-0000-7000-8000-000000000001",
  "name": "example",
  "primary_vertical": "example",
  "status": "example",
  "created_by": "00000000-0000-7000-8000-000000000001"
}
```

### EVT-EDGE-001 — `location.provisioning_requested`

**Meaning:** An approved physical Location entered Hub provisioning.  
**Producer:** Management API / Provisioning Service  
**Consumers:** Provisioning Worker; Device/Fleet Service; System Status  
**Aggregate / ordering:** `store_location` / Per `location_id` request sequence  
**Retention class:** R2

| Payload field             | Type          | Rule                  |
| ------------------------- | ------------- | --------------------- |
| `location_id`             | `uuid`        | required              |
| `digital_store_id`        | `uuid`        | required              |
| `provisioning_session_id` | `uuid`        | required              |
| `hardware_profile_id`     | `uuid`        | required              |
| `requested_profile`       | `string`      | required; `store_hub` |
| `expires_at`              | `timestamptz` | required              |
| `approval_request_id`     | `uuid         | null`                 | required for production policy |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/location.provisioning_requested/v1.json",
  "title": "location.provisioning_requested payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "location_id",
    "digital_store_id",
    "provisioning_session_id",
    "hardware_profile_id",
    "requested_profile",
    "expires_at"
  ],
  "properties": {
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "digital_store_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "provisioning_session_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "hardware_profile_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "requested_profile": {
      "type": "string",
      "description": "required; `store_hub`"
    },
    "expires_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "approval_request_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "required for production policy"
    }
  }
}
```

Example payload:

```json
{
  "location_id": "00000000-0000-7000-8000-000000000001",
  "digital_store_id": "00000000-0000-7000-8000-000000000001",
  "provisioning_session_id": "00000000-0000-7000-8000-000000000001",
  "hardware_profile_id": "00000000-0000-7000-8000-000000000001",
  "requested_profile": "example",
  "expires_at": "2026-07-26T00:00:00Z",
  "approval_request_id": null
}
```

### EVT-EDGE-002 — `hub.activated`

**Meaning:** A certified Store Hub completed identity, bootstrap, sync and validation.  
**Producer:** Edge Operations API / Hub Provisioning Service  
**Consumers:** Device/Fleet Service; Configuration Service; System Status; Admin/Partner projections  
**Aggregate / ordering:** `device` / Per `hub_device_id` activation generation  
**Retention class:** R3

| Payload field              | Type          | Rule     |
| -------------------------- | ------------- | -------- |
| `hub_device_id`            | `uuid`        | required |
| `location_id`              | `uuid`        | required |
| `assignment_generation`    | `integer`     | required |
| `certificate_serial`       | `string`      | required |
| `software_release_id`      | `uuid`        | required |
| `configuration_version_id` | `uuid`        | required |
| `initial_sync_cursor`      | `string`      | required |
| `activated_at`             | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/hub.activated/v1.json",
  "title": "hub.activated payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "hub_device_id",
    "location_id",
    "assignment_generation",
    "certificate_serial",
    "software_release_id",
    "configuration_version_id",
    "initial_sync_cursor",
    "activated_at"
  ],
  "properties": {
    "hub_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "assignment_generation": {
      "type": "integer",
      "description": "required"
    },
    "certificate_serial": {
      "type": "string",
      "description": "required"
    },
    "software_release_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "configuration_version_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "initial_sync_cursor": {
      "type": "string",
      "description": "required"
    },
    "activated_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "hub_device_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "assignment_generation": 1,
  "certificate_serial": "example",
  "software_release_id": "00000000-0000-7000-8000-000000000001",
  "configuration_version_id": "00000000-0000-7000-8000-000000000001",
  "initial_sync_cursor": "example",
  "activated_at": "2026-07-26T00:00:00Z"
}
```

### EVT-EDGE-003 — `terminal.assigned`

**Meaning:** A terminal was assigned to a Location, Hub and operational profile.  
**Producer:** Management API / Device Assignment Service  
**Consumers:** Store Hub; Fleet Service; POS entitlement projection; Audit  
**Aggregate / ordering:** `device_assignment` / Per `terminal_device_id` assignment generation  
**Retention class:** R3

| Payload field           | Type            | Rule                               |
| ----------------------- | --------------- | ---------------------------------- |
| `terminal_device_id`    | `uuid`          | required                           |
| `hub_device_id`         | `uuid`          | required                           |
| `location_id`           | `uuid`          | required                           |
| `digital_store_id`      | `uuid`          | required                           |
| `terminal_profiles`     | `array<string>` | required; e.g. `T1`,`T2`,`T3`,`T4` |
| `assignment_generation` | `integer`       | required                           |
| `effective_at`          | `timestamptz`   | required                           |
| `assigned_by`           | `uuid`          | required                           |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/terminal.assigned/v1.json",
  "title": "terminal.assigned payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "terminal_device_id",
    "hub_device_id",
    "location_id",
    "digital_store_id",
    "terminal_profiles",
    "assignment_generation",
    "effective_at",
    "assigned_by"
  ],
  "properties": {
    "terminal_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "hub_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "digital_store_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "terminal_profiles": {
      "type": "array",
      "items": {
        "type": "string"
      },
      "description": "required; e.g. `T1`,`T2`,`T3`,`T4`"
    },
    "assignment_generation": {
      "type": "integer",
      "description": "required"
    },
    "effective_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "assigned_by": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "terminal_device_id": "00000000-0000-7000-8000-000000000001",
  "hub_device_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "digital_store_id": "00000000-0000-7000-8000-000000000001",
  "terminal_profiles": ["example"],
  "assignment_generation": 1,
  "effective_at": "2026-07-26T00:00:00Z",
  "assigned_by": "00000000-0000-7000-8000-000000000001"
}
```

### EVT-LND-001 — `laundry_booking.created`

**Meaning:** The authoritative Laundry Booking was finalized from verified intake.  
**Producer:** Store Hub Laundry Service / Edge Operations API  
**Consumers:** Laundry workflow projections; Partner/Chain reports; Notification Service; cloud sync  
**Aggregate / ordering:** `laundry_booking` / Per `booking_id` aggregate version  
**Retention class:** R3

| Payload field         | Type          | Rule     |
| --------------------- | ------------- | -------- |
| `booking_id`          | `uuid`        | required |
| `booking_number`      | `string`      | required |
| `location_id`         | `uuid`        | required |
| `customer_id`         | `uuid         | null`    | optional |
| `source_channel`      | `string`      | required |
| `pricing_snapshot_id` | `uuid`        | required |
| `currency_code`       | `string`      | required |
| `total_minor`         | `integer`     | required |
| `deposit_due_minor`   | `integer`     | required |
| `item_count`          | `integer`     | required |
| `created_at`          | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/laundry_booking.created/v1.json",
  "title": "laundry_booking.created payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "booking_id",
    "booking_number",
    "location_id",
    "source_channel",
    "pricing_snapshot_id",
    "currency_code",
    "total_minor",
    "deposit_due_minor",
    "item_count",
    "created_at"
  ],
  "properties": {
    "booking_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "booking_number": {
      "type": "string",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "customer_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "optional"
    },
    "source_channel": {
      "type": "string",
      "description": "required"
    },
    "pricing_snapshot_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "currency_code": {
      "type": "string",
      "description": "required"
    },
    "total_minor": {
      "type": "integer",
      "description": "required"
    },
    "deposit_due_minor": {
      "type": "integer",
      "description": "required"
    },
    "item_count": {
      "type": "integer",
      "description": "required"
    },
    "created_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "booking_id": "00000000-0000-7000-8000-000000000001",
  "booking_number": "example",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "customer_id": null,
  "source_channel": "example",
  "pricing_snapshot_id": "00000000-0000-7000-8000-000000000001",
  "currency_code": "example",
  "total_minor": 1,
  "deposit_due_minor": 1,
  "item_count": 1,
  "created_at": "2026-07-26T00:00:00Z"
}
```

### EVT-LND-002 — `laundry_booking.ready`

**Meaning:** The Booking became Ready for Pickup after T3 QA, count and storage verification.  
**Producer:** Store Hub T3 Laundry Service  
**Consumers:** T4 pickup projection; Notification Service; Partner App/Portal; reporting  
**Aggregate / ordering:** `laundry_booking` / Per `booking_id` aggregate version; after all required Ready custody entries  
**Retention class:** R3

| Payload field             | Type          | Rule     |
| ------------------------- | ------------- | -------- |
| `booking_id`              | `uuid`        | required |
| `location_id`             | `uuid`        | required |
| `ready_at`                | `timestamptz` | required |
| `ready_item_count`        | `integer`     | required |
| `storage_assignment_ids`  | `array<uuid>` | required |
| `qa_result`               | `string`      | required |
| `remaining_balance_minor` | `integer`     | required |
| `currency_code`           | `string`      | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/laundry_booking.ready/v1.json",
  "title": "laundry_booking.ready payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "booking_id",
    "location_id",
    "ready_at",
    "ready_item_count",
    "storage_assignment_ids",
    "qa_result",
    "remaining_balance_minor",
    "currency_code"
  ],
  "properties": {
    "booking_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "ready_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "ready_item_count": {
      "type": "integer",
      "description": "required"
    },
    "storage_assignment_ids": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid"
      },
      "description": "required"
    },
    "qa_result": {
      "type": "string",
      "description": "required"
    },
    "remaining_balance_minor": {
      "type": "integer",
      "description": "required"
    },
    "currency_code": {
      "type": "string",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "booking_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "ready_at": "2026-07-26T00:00:00Z",
  "ready_item_count": 1,
  "storage_assignment_ids": ["00000000-0000-7000-8000-000000000001"],
  "qa_result": "example",
  "remaining_balance_minor": 1,
  "currency_code": "example"
}
```

### EVT-LND-003 — `garment.custody_scanned_in`

**Meaning:** A garment/package entered Ready custody and an approved storage position.  
**Producer:** Store Hub T3 Custody Service  
**Consumers:** Laundry Booking projection; storage projection; audit; cloud sync  
**Aggregate / ordering:** `garment` / Strict per `garment_id` custody sequence  
**Retention class:** R4

| Payload field         | Type          | Rule     |
| --------------------- | ------------- | -------- |
| `garment_id`          | `uuid`        | required |
| `booking_id`          | `uuid`        | required |
| `location_id`         | `uuid`        | required |
| `storage_location_id` | `uuid`        | required |
| `scan_code`           | `string`      | required |
| `custody_sequence`    | `integer`     | required |
| `condition_status`    | `string`      | required |
| `scanned_by_user_id`  | `uuid`        | required |
| `terminal_device_id`  | `uuid`        | required |
| `scanned_at`          | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/garment.custody_scanned_in/v1.json",
  "title": "garment.custody_scanned_in payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "garment_id",
    "booking_id",
    "location_id",
    "storage_location_id",
    "scan_code",
    "custody_sequence",
    "condition_status",
    "scanned_by_user_id",
    "terminal_device_id",
    "scanned_at"
  ],
  "properties": {
    "garment_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "booking_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "storage_location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "scan_code": {
      "type": "string",
      "description": "required"
    },
    "custody_sequence": {
      "type": "integer",
      "description": "required"
    },
    "condition_status": {
      "type": "string",
      "description": "required"
    },
    "scanned_by_user_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "terminal_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "scanned_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "garment_id": "00000000-0000-7000-8000-000000000001",
  "booking_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "storage_location_id": "00000000-0000-7000-8000-000000000001",
  "scan_code": "example",
  "custody_sequence": 1,
  "condition_status": "example",
  "scanned_by_user_id": "00000000-0000-7000-8000-000000000001",
  "terminal_device_id": "00000000-0000-7000-8000-000000000001",
  "scanned_at": "2026-07-26T00:00:00Z"
}
```

### EVT-LND-004 — `garment.custody_scanned_out`

**Meaning:** A garment/package was released through the authorized T4 pickup workflow.  
**Producer:** Store Hub T4 Custody Service  
**Consumers:** Laundry Booking completion projection; audit; customer receipt; cloud sync  
**Aggregate / ordering:** `garment` / Strict per `garment_id` custody sequence  
**Retention class:** R4

| Payload field               | Type          | Rule     |
| --------------------------- | ------------- | -------- |
| `garment_id`                | `uuid`        | required |
| `booking_id`                | `uuid`        | required |
| `location_id`               | `uuid`        | required |
| `pickup_session_id`         | `uuid`        | required |
| `custody_sequence`          | `integer`     | required |
| `collector_verification_id` | `uuid`        | required |
| `payment_clearance_status`  | `string`      | required |
| `scanned_by_user_id`        | `uuid`        | required |
| `terminal_device_id`        | `uuid`        | required |
| `scanned_at`                | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/garment.custody_scanned_out/v1.json",
  "title": "garment.custody_scanned_out payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "garment_id",
    "booking_id",
    "location_id",
    "pickup_session_id",
    "custody_sequence",
    "collector_verification_id",
    "payment_clearance_status",
    "scanned_by_user_id",
    "terminal_device_id",
    "scanned_at"
  ],
  "properties": {
    "garment_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "booking_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "pickup_session_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "custody_sequence": {
      "type": "integer",
      "description": "required"
    },
    "collector_verification_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "payment_clearance_status": {
      "type": "string",
      "description": "required"
    },
    "scanned_by_user_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "terminal_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "scanned_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "garment_id": "00000000-0000-7000-8000-000000000001",
  "booking_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "pickup_session_id": "00000000-0000-7000-8000-000000000001",
  "custody_sequence": 1,
  "collector_verification_id": "00000000-0000-7000-8000-000000000001",
  "payment_clearance_status": "example",
  "scanned_by_user_id": "00000000-0000-7000-8000-000000000001",
  "terminal_device_id": "00000000-0000-7000-8000-000000000001",
  "scanned_at": "2026-07-26T00:00:00Z"
}
```

### EVT-PAY-001 — `payment.recorded`

**Meaning:** A verified cash, KHQR or approved tender payment was appended to the payment ledger.  
**Producer:** Payment Service / Store Hub Payment Ledger  
**Consumers:** Finance subledger; Booking/transaction projection; receipt; reconciliation; audit  
**Aggregate / ordering:** `payment` / Per `payment_id`; linked transaction balance recalculated deterministically  
**Retention class:** R4

| Payload field           | Type          | Rule     |
| ----------------------- | ------------- | -------- |
| `payment_id`            | `uuid`        | required |
| `transaction_id`        | `uuid`        | required |
| `booking_id`            | `uuid         | null`    | optional vertical link                      |
| `location_id`           | `uuid`        | required |
| `tender_type`           | `string`      | required |
| `amount_minor`          | `integer`     | required |
| `currency_code`         | `string`      | required |
| `provider_reference`    | `string       | null`    | required for remote provider when available |
| `provider_event_id`     | `string       | null`    | dedupe key for callbacks                    |
| `recorded_at`           | `timestamptz` | required |
| `reconciliation_status` | `string`      | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/payment.recorded/v1.json",
  "title": "payment.recorded payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "payment_id",
    "transaction_id",
    "location_id",
    "tender_type",
    "amount_minor",
    "currency_code",
    "recorded_at",
    "reconciliation_status"
  ],
  "properties": {
    "payment_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "transaction_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "booking_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "optional vertical link"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "tender_type": {
      "type": "string",
      "description": "required"
    },
    "amount_minor": {
      "type": "integer",
      "description": "required"
    },
    "currency_code": {
      "type": "string",
      "description": "required"
    },
    "provider_reference": {
      "type": ["string", "null"],
      "description": "required for remote provider when available"
    },
    "provider_event_id": {
      "type": ["string", "null"],
      "description": "dedupe key for callbacks"
    },
    "recorded_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "reconciliation_status": {
      "type": "string",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "payment_id": "00000000-0000-7000-8000-000000000001",
  "transaction_id": "00000000-0000-7000-8000-000000000001",
  "booking_id": null,
  "location_id": "00000000-0000-7000-8000-000000000001",
  "tender_type": "example",
  "amount_minor": 1,
  "currency_code": "example",
  "provider_reference": null,
  "provider_event_id": null,
  "recorded_at": "2026-07-26T00:00:00Z",
  "reconciliation_status": "example"
}
```

### EVT-PAY-002 — `payment.refunded`

**Meaning:** An approved refund document was finalized without editing the original payment.  
**Producer:** Payment Service / Refund Service  
**Consumers:** Finance subledger; transaction projection; provider reconciliation; audit; notifications  
**Aggregate / ordering:** `refund` / Per `refund_id`; references original `payment_id`  
**Retention class:** R4

| Payload field           | Type          | Rule     |
| ----------------------- | ------------- | -------- |
| `refund_id`             | `uuid`        | required |
| `payment_id`            | `uuid`        | required |
| `transaction_id`        | `uuid`        | required |
| `amount_minor`          | `integer`     | required |
| `currency_code`         | `string`      | required |
| `reason_code`           | `string`      | required |
| `provider_reference`    | `string       | null`    | optional                      |
| `approval_request_id`   | `uuid         | null`    | required where policy applies |
| `refunded_at`           | `timestamptz` | required |
| `reconciliation_status` | `string`      | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/payment.refunded/v1.json",
  "title": "payment.refunded payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "refund_id",
    "payment_id",
    "transaction_id",
    "amount_minor",
    "currency_code",
    "reason_code",
    "refunded_at",
    "reconciliation_status"
  ],
  "properties": {
    "refund_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "payment_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "transaction_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "amount_minor": {
      "type": "integer",
      "description": "required"
    },
    "currency_code": {
      "type": "string",
      "description": "required"
    },
    "reason_code": {
      "type": "string",
      "description": "required"
    },
    "provider_reference": {
      "type": ["string", "null"],
      "description": "optional"
    },
    "approval_request_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "required where policy applies"
    },
    "refunded_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "reconciliation_status": {
      "type": "string",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "refund_id": "00000000-0000-7000-8000-000000000001",
  "payment_id": "00000000-0000-7000-8000-000000000001",
  "transaction_id": "00000000-0000-7000-8000-000000000001",
  "amount_minor": 1,
  "currency_code": "example",
  "reason_code": "example",
  "provider_reference": null,
  "approval_request_id": null,
  "refunded_at": "2026-07-26T00:00:00Z",
  "reconciliation_status": "example"
}
```

### EVT-INV-001 — `inventory.movement_posted`

**Meaning:** An append-only inventory movement was posted; balances are derived rather than overwritten.  
**Producer:** Inventory Service / Store Hub Inventory Ledger  
**Consumers:** Inventory balances; costing; purchasing; reports; reconciliation  
**Aggregate / ordering:** `inventory_movement` / Per stock item + Location ledger sequence  
**Retention class:** R4

| Payload field          | Type          | Rule                                |
| ---------------------- | ------------- | ----------------------------------- |
| `movement_id`          | `uuid`        | required                            |
| `location_id`          | `uuid`        | required                            |
| `stock_item_id`        | `uuid`        | required                            |
| `movement_type`        | `string`      | required                            |
| `quantity`             | `number`      | required; decimal quantity contract |
| `unit_code`            | `string`      | required                            |
| `lot_id`               | `uuid         | null`                               | optional |
| `source_document_type` | `string`      | required                            |
| `source_document_id`   | `uuid`        | required                            |
| `ledger_sequence`      | `integer`     | required                            |
| `posted_at`            | `timestamptz` | required                            |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/inventory.movement_posted/v1.json",
  "title": "inventory.movement_posted payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "movement_id",
    "location_id",
    "stock_item_id",
    "movement_type",
    "quantity",
    "unit_code",
    "source_document_type",
    "source_document_id",
    "ledger_sequence",
    "posted_at"
  ],
  "properties": {
    "movement_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "stock_item_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "movement_type": {
      "type": "string",
      "description": "required"
    },
    "quantity": {
      "type": "number",
      "description": "required; decimal quantity contract"
    },
    "unit_code": {
      "type": "string",
      "description": "required"
    },
    "lot_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "optional"
    },
    "source_document_type": {
      "type": "string",
      "description": "required"
    },
    "source_document_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "ledger_sequence": {
      "type": "integer",
      "description": "required"
    },
    "posted_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "movement_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "stock_item_id": "00000000-0000-7000-8000-000000000001",
  "movement_type": "example",
  "quantity": 1.0,
  "unit_code": "example",
  "lot_id": null,
  "source_document_type": "example",
  "source_document_id": "00000000-0000-7000-8000-000000000001",
  "ledger_sequence": 1,
  "posted_at": "2026-07-26T00:00:00Z"
}
```

### EVT-CFG-001 — `configuration.published`

**Meaning:** An immutable configuration version was approved and published to target scopes.  
**Producer:** Management API / Configuration Service  
**Consumers:** Store Hub inbox; channel projections; status/readiness; audit  
**Aggregate / ordering:** `configuration_publication` / Per target scope publication generation  
**Retention class:** R3

| Payload field              | Type          | Rule     |
| -------------------------- | ------------- | -------- |
| `publication_id`           | `uuid`        | required |
| `configuration_version_id` | `uuid`        | required |
| `target_scope_type`        | `string`      | required |
| `target_scope_ids`         | `array<uuid>` | required |
| `compatibility_policy_id`  | `uuid`        | required |
| `published_by`             | `uuid`        | required |
| `approval_request_id`      | `uuid         | null`    | required where policy applies |
| `published_at`             | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/configuration.published/v1.json",
  "title": "configuration.published payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "publication_id",
    "configuration_version_id",
    "target_scope_type",
    "target_scope_ids",
    "compatibility_policy_id",
    "published_by",
    "published_at"
  ],
  "properties": {
    "publication_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "configuration_version_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "target_scope_type": {
      "type": "string",
      "description": "required"
    },
    "target_scope_ids": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid"
      },
      "description": "required"
    },
    "compatibility_policy_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "published_by": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "approval_request_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "required where policy applies"
    },
    "published_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "publication_id": "00000000-0000-7000-8000-000000000001",
  "configuration_version_id": "00000000-0000-7000-8000-000000000001",
  "target_scope_type": "example",
  "target_scope_ids": ["00000000-0000-7000-8000-000000000001"],
  "compatibility_policy_id": "00000000-0000-7000-8000-000000000001",
  "published_by": "00000000-0000-7000-8000-000000000001",
  "approval_request_id": null,
  "published_at": "2026-07-26T00:00:00Z"
}
```

### EVT-CFG-002 — `configuration.activated`

**Meaning:** A published configuration version passed verification and became active on a target.  
**Producer:** Store Hub Configuration Agent / Channel Runtime  
**Consumers:** Configuration Service; System Status; Audit; rollout health  
**Aggregate / ordering:** `configuration_activation` / Per target device/channel activation generation  
**Retention class:** R3

| Payload field              | Type          | Rule     |
| -------------------------- | ------------- | -------- |
| `activation_id`            | `uuid`        | required |
| `publication_id`           | `uuid`        | required |
| `configuration_version_id` | `uuid`        | required |
| `target_type`              | `string`      | required |
| `target_id`                | `uuid`        | required |
| `previous_version_id`      | `uuid         | null`    | optional |
| `verification_checksum`    | `string`      | required |
| `activated_at`             | `timestamptz` | required |
| `health_status`            | `string`      | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/configuration.activated/v1.json",
  "title": "configuration.activated payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "activation_id",
    "publication_id",
    "configuration_version_id",
    "target_type",
    "target_id",
    "verification_checksum",
    "activated_at",
    "health_status"
  ],
  "properties": {
    "activation_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "publication_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "configuration_version_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "target_type": {
      "type": "string",
      "description": "required"
    },
    "target_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "previous_version_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "optional"
    },
    "verification_checksum": {
      "type": "string",
      "description": "required"
    },
    "activated_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    },
    "health_status": {
      "type": "string",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "activation_id": "00000000-0000-7000-8000-000000000001",
  "publication_id": "00000000-0000-7000-8000-000000000001",
  "configuration_version_id": "00000000-0000-7000-8000-000000000001",
  "target_type": "example",
  "target_id": "00000000-0000-7000-8000-000000000001",
  "previous_version_id": null,
  "verification_checksum": "example",
  "activated_at": "2026-07-26T00:00:00Z",
  "health_status": "example"
}
```

### EVT-SYNC-001 — `sync.batch_accepted`

**Meaning:** A Hub batch was validated, deduplicated and accepted with per-event results.  
**Producer:** Edge Operations API / Sync Ingestion Service  
**Consumers:** Store Hub acknowledgement; reconciliation; System Status; audit  
**Aggregate / ordering:** `sync_batch` / Per Hub sync cursor and local sequence range  
**Retention class:** R3

| Payload field          | Type          | Rule     |
| ---------------------- | ------------- | -------- |
| `sync_batch_id`        | `uuid`        | required |
| `hub_device_id`        | `uuid`        | required |
| `location_id`          | `uuid`        | required |
| `first_local_sequence` | `integer`     | required |
| `last_local_sequence`  | `integer`     | required |
| `event_count`          | `integer`     | required |
| `accepted_count`       | `integer`     | required |
| `duplicate_count`      | `integer`     | required |
| `rejected_count`       | `integer`     | required |
| `next_cloud_cursor`    | `string`      | required |
| `accepted_at`          | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/sync.batch_accepted/v1.json",
  "title": "sync.batch_accepted payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "sync_batch_id",
    "hub_device_id",
    "location_id",
    "first_local_sequence",
    "last_local_sequence",
    "event_count",
    "accepted_count",
    "duplicate_count",
    "rejected_count",
    "next_cloud_cursor",
    "accepted_at"
  ],
  "properties": {
    "sync_batch_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "hub_device_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "location_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "first_local_sequence": {
      "type": "integer",
      "description": "required"
    },
    "last_local_sequence": {
      "type": "integer",
      "description": "required"
    },
    "event_count": {
      "type": "integer",
      "description": "required"
    },
    "accepted_count": {
      "type": "integer",
      "description": "required"
    },
    "duplicate_count": {
      "type": "integer",
      "description": "required"
    },
    "rejected_count": {
      "type": "integer",
      "description": "required"
    },
    "next_cloud_cursor": {
      "type": "string",
      "description": "required"
    },
    "accepted_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "sync_batch_id": "00000000-0000-7000-8000-000000000001",
  "hub_device_id": "00000000-0000-7000-8000-000000000001",
  "location_id": "00000000-0000-7000-8000-000000000001",
  "first_local_sequence": 1,
  "last_local_sequence": 1,
  "event_count": 1,
  "accepted_count": 1,
  "duplicate_count": 1,
  "rejected_count": 1,
  "next_cloud_cursor": "example",
  "accepted_at": "2026-07-26T00:00:00Z"
}
```

### EVT-INT-001 — `connector.delivery_failed`

**Meaning:** A connector/webhook delivery attempt failed and requires retry, suspension or operator review.  
**Producer:** Webhook Dispatcher / Connector Worker  
**Consumers:** Integration health; retry scheduler; alerting; reconciliation; Admin Portal  
**Aggregate / ordering:** `connector_delivery` / Per `delivery_id` attempt sequence  
**Retention class:** R3

| Payload field     | Type          | Rule     |
| ----------------- | ------------- | -------- |
| `delivery_id`     | `uuid`        | required |
| `connector_id`    | `uuid`        | required |
| `subscription_id` | `uuid         | null`    | optional |
| `endpoint_id`     | `uuid`        | required |
| `source_event_id` | `uuid`        | required |
| `attempt_number`  | `integer`     | required |
| `failure_class`   | `string`      | required |
| `http_status`     | `integer      | null`    | optional |
| `retryable`       | `boolean`     | required |
| `next_attempt_at` | `timestamptz  | null`    | optional |
| `failed_at`       | `timestamptz` | required |

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.kitluy.internal/events/connector.delivery_failed/v1.json",
  "title": "connector.delivery_failed payload v1",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "delivery_id",
    "connector_id",
    "endpoint_id",
    "source_event_id",
    "attempt_number",
    "failure_class",
    "retryable",
    "failed_at"
  ],
  "properties": {
    "delivery_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "connector_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "subscription_id": {
      "type": ["string", "null"],
      "format": "uuid",
      "description": "optional"
    },
    "endpoint_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "source_event_id": {
      "type": "string",
      "format": "uuid",
      "description": "required"
    },
    "attempt_number": {
      "type": "integer",
      "description": "required"
    },
    "failure_class": {
      "type": "string",
      "description": "required"
    },
    "http_status": {
      "type": ["integer", "null"],
      "description": "optional"
    },
    "retryable": {
      "type": "boolean",
      "description": "required"
    },
    "next_attempt_at": {
      "type": ["string", "null"],
      "format": "date-time",
      "description": "optional"
    },
    "failed_at": {
      "type": "string",
      "format": "date-time",
      "description": "required"
    }
  }
}
```

Example payload:

```json
{
  "delivery_id": "00000000-0000-7000-8000-000000000001",
  "connector_id": "00000000-0000-7000-8000-000000000001",
  "subscription_id": null,
  "endpoint_id": "00000000-0000-7000-8000-000000000001",
  "source_event_id": "00000000-0000-7000-8000-000000000001",
  "attempt_number": 1,
  "failure_class": "example",
  "http_status": null,
  "retryable": true,
  "next_attempt_at": null,
  "failed_at": "2026-07-26T00:00:00Z"
}
```

## 6. Consumer contract

Every consumer must:

1. Validate the envelope and event-specific JSON Schema before processing.
2. Insert `(consumer_name, event_id)` into the relational inbox under a unique constraint before performing business effects.
3. Verify Tenant, Digital Store and Location scope against the consumer's authorized scope.
4. Enforce aggregate ordering where the registry requires it; hold gaps rather than silently skipping.
5. Execute the business effect and inbox completion in one database transaction where possible.
6. Return success for duplicate events after confirming the prior outcome.
7. Classify failures as `retryable`, `non_retryable`, `schema_incompatible`, `scope_denied` or `manual_reconciliation_required`.
8. Never mutate payment, refund, inventory or custody truth merely because an event was redelivered.

## 7. Publication and observability

Required relational records:

- `kitluy_events.outbox_events`
- `kitluy_events.domain_events`
- `kitluy_events.consumer_inbox`
- `kitluy_events.consumer_failures`
- `kitluy_events.replay_runs`
- `kitluy_events.replay_items`

Metrics include publish lag, oldest unpublished age, consumer lag, duplicate rate, schema rejection count, ordering gaps, dead letters and reconciliation-required count. Every metric is scoped and truth-labeled.

## 8. Contract tests

Minimum test suite:

- Envelope and each payload schema accept valid examples and reject missing/unknown fields.
- Duplicate delivery produces one business effect.
- Out-of-order custody and inventory events do not overwrite authoritative sequence.
- Cross-Tenant, cross-Store and cross-Location events fail closed.
- Producer transaction rollback leaves no publishable outbox record.
- Producer commit plus publisher crash still publishes after lease recovery.
- Replay retains original event identity linkage and does not bypass approval or dedupe.
- Old supported consumers accept additive v1 fields.
- Unknown enum values are handled according to the compatibility policy, never silently mapped to a financial meaning.

## 9. Open production values

- `[REQUIRED: exact retention durations by class]`
- `[REQUIRED: approved event broker/transport implementation]`
- `[REQUIRED: maximum payload size by event class]`
- `[REQUIRED: consumer lag SLOs and alert thresholds]`
- `[REQUIRED: archive and legal/privacy deletion policy]`
