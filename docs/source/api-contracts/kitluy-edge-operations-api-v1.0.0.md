# KitLuy Edge Operations API — Canonical Contract

**Filename:** `kitluy-edge-operations-api-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26

## 0. Authority, status and evidence discipline

**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Owner-requested canonical target contract; not implementation evidence  
**Primary market:** Cambodia  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

This contract is governed by the current KitLuy Project Instructions and owner-locked decision to maintain four separate API surfaces. It uses current Phase 1 product specifications, the Master Feature Registry and evidence-based comparison/backlog documents as supporting inputs. Competitor or clone contracts are design references only and do not override KitLuy authority.

Nothing in this document is `IMPLEMENTED` merely because it is specified. Implementation requires an executable OpenAPI source, generated validation artifacts, repository code, applied migrations where needed, automated contract/security tests, deployment evidence, monitoring, recovery evidence and approved pilot/go-live evidence.

### 0.1 Authority order

1. Current owner decisions and KitLuy Project Instructions.
2. Applied migrations, verified code/tests, deployments and production evidence.
3. This v1.0.0 API contract after approval.
4. Current KitLuy Rebuild, Business, product, Store Hub and infrastructure specifications.
5. Approved handoffs, feature registry and source traceability.
6. Evidence-based competitor analyses/classifications.
7. Competitor rebuild/clone documents and superseded planning.

### 0.2 Shared supporting registries

- `kitluy-api-error-code-registry-v1.0.0.md`
- `kitluy-api-scope-registry-v1.0.0.md`
- `kitluy-api-version-and-deprecation-policy-v1.0.0.md`
- `kitluy-api-contract-test-registry-v1.0.0.md`

A change to a shared error, scope, lifecycle rule or contract-test obligation updates its registry first or in the same approved change set.

## 1. Product boundary and trust model

**Purpose:** Store Hub, POS, T1–T4, mobile staff, local device, provisioning, LAN operation and cloud synchronization contracts for offline-capable physical Store Locations.

**Authorized callers:** KitLuy Store Hub; assigned T1–T4 clients; approved POS Mobile clients; provisioning services; trusted cloud sync workers.

**Boundary:** It is not a public commerce API, a generic management API, a connector API, or a path for terminals to access PostgreSQL directly.

After provisioning, the Store Hub is the local operational authority. Terminals communicate with the Hub over LAN. Cloud sync is asynchronous and internet failure must not stop approved local operations. The cloud never accepts a terminal as a direct substitute for the assigned Hub unless a separately approved recovery protocol exists.

## 2. Base paths and links

- Canonical route namespace: `/edge/v1`
- Local Hub origin: `https://{assigned-hub-host}/edge/v1`
- Cloud edge gateway: `https://{edge-api-host}/edge/v1`
- Local and cloud endpoints share schemas only where their trust and authority are equivalent.
- Provisioning, sync and heartbeat routes may exist only on the cloud gateway; T1–T4 operational routes primarily terminate on the Hub.

## 3. Canonical OpenAPI 3.1 source

The executable source must live at `[REQUIRED: repository path]/openapi/edge-v1.yaml`. The excerpt below is normative for shared structure; the repository source must include every route in this document.

```yaml
openapi: 3.1.0
info:
  title: KitLuy Edge Operations API
  version: 1.0.0
  description: >-
    Store Hub, POS, T1–T4, mobile staff, local device, provisioning, LAN operation and cloud synchronization contracts for offline-capable physical Store Locations.
servers:
  - url: https://{api_host}/edge/v1
    description: Environment-specific KitLuy API gateway
tags:
  - name: Edge
paths:
  /laundry/bookings/drafts:
    post:
      tags: [Edge]
      operationId: edge_post_laundry_bookings_drafts
      summary: Create a local Laundry Booking draft
      security:
        - deviceMtls: [edge.bookings.create]
      parameters:
        - $ref: "#/components/parameters/RequestId"
        - $ref: "#/components/parameters/IdempotencyKey"
      responses:
        "200":
          description: Successful response
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SuccessEnvelope"
        "400":
          $ref: "#/components/responses/Problem"
        "401":
          $ref: "#/components/responses/Problem"
        "403":
          $ref: "#/components/responses/Problem"
        "409":
          $ref: "#/components/responses/Problem"
        "429":
          $ref: "#/components/responses/Problem"
components:
  securitySchemes:
    userOAuth:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://{identity_host}/oauth/authorize
          tokenUrl: https://{identity_host}/oauth/token
          scopes: {}
    customerSession:
      type: http
      scheme: bearer
      bearerFormat: JWT
    publicStoreToken:
      type: apiKey
      in: header
      name: X-KitLuy-Storefront-Token
    deviceMtls:
      type: mutualTLS
    connectorOAuth:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://{identity_host}/oauth/authorize
          tokenUrl: https://{identity_host}/oauth/token
          scopes: {}
  parameters:
    RequestId:
      name: X-Request-Id
      in: header
      required: false
      schema: { type: string, minLength: 8, maxLength: 128 }
    IdempotencyKey:
      name: Idempotency-Key
      in: header
      required: false
      schema: { type: string, minLength: 16, maxLength: 255 }
  schemas:
    SuccessEnvelope:
      type: object
      required: [request_id, data]
      properties:
        request_id: { type: string }
        source: { type: string }
        as_of: { type: string, format: date-time }
        freshness:
          type: string
          enum: [fresh, aging, stale, unknown, local_authoritative_pending_sync]
        completeness:
          type: string
          enum: [complete, partial, unknown]
        reconciliation_status: { type: string }
        data: {}
    ErrorEnvelope:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message, retryable, request_id]
          properties:
            code: { type: string }
            message: { type: string }
            message_key: { type: string }
            retryable: { type: boolean }
            severity: { type: string, enum: [informational, warning, blocking, critical] }
            request_id: { type: string }
            details: { type: array, items: { type: object } }
            operator_action: { type: string }
  responses:
    Problem:
      description: Registered KitLuy API error
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorEnvelope"
```

### 3.1 Source-generation rules

- The OpenAPI file is hand-reviewed source, not generated from unreviewed runtime code.
- Server validators, SDK types, mocks and contract tests are generated from the approved source.
- Generated artifacts are reproducible and carry source commit and checksum.
- Runtime behavior that is absent from the source is a defect; undocumented production endpoints are prohibited.
- Surface-specific schemas may reference a shared package, but deployment must remain independent.

## 4. Authentication, authorization and context resolution

### 4.1 Device trust

Cloud Edge calls require an HET-issued device certificate, active certificate chain, device identity, hardware/provisioning state and assignment. LAN clients authenticate to the assigned Hub and receive short-lived Hub sessions bound to device, terminal profile, Location and configuration compatibility.

### 4.2 Staff actor sessions

Staff actions additionally require an active employee session and role permission. Manager approvals are action-, payload-, Location- and expiry-bound and are consumed once.

### 4.3 Context resolution

Tenant, Digital Store, Location, Hub and terminal profile come from the signed device assignment. Client body fields cannot change them. A T3 profile cannot call T4 release routes; a T2 display cannot call T1 financial routes. Small Stores may share physical hardware but still use separate logical profile sessions and audit.

### 4.4 Scope groups

`edge.provision.*`, `edge.health.*`, `edge.identity.*`, `edge.config.*`, `edge.session.*`, `edge.approval.*`, `edge.customers.*`, `edge.bookings.*`, `edge.payments.*`, `edge.print.*`, `edge.display.*`, `edge.ready.*`, `edge.pickup.*`, `edge.shifts.*`, `edge.cash.*`, `edge.peripherals.*`, `edge.sync.*`, `edge.support.*`.

## 5. Common protocol rules

### 5.1 Transport and media types

- HTTPS is mandatory outside the trusted Store LAN.
- Edge cloud transport uses mTLS. Edge LAN transport uses authenticated Hub-issued sessions and the assigned Store network boundary.
- JSON uses UTF-8 and `application/json` unless a registered media type is required.
- OpenAPI 3.1 and JSON Schema 2020-12 are canonical for request/response validation.
- Timestamps are RFC 3339 `date-time` values with UTC storage. Business timezone is resolved from the authoritative Location and defaults to `Asia/Phnom_Penh` only where the contract explicitly permits it.
- Money is represented as integer minor units plus ISO 4217 currency code and currency exponent. KHR exponent is 0; USD exponent is 2. APIs never silently convert currency.
- IDs are opaque strings, normally UUIDs. Public secure tokens are distinct from internal resource IDs.

### 5.2 Required headers

| Header                 | Requirement                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `Authorization`        | Required except explicitly public reads or signed provider callbacks.       |
| `X-Request-Id`         | Client may supply a valid unique value; server always returns one.          |
| `traceparent`          | Accepted and propagated when valid.                                         |
| `Idempotency-Key`      | Required for retryable mutations identified by this contract.               |
| `If-Match`             | Required for protected updates using ETag/aggregate version.                |
| `X-KitLuy-API-Version` | Optional response echo/diagnostic; URL major version remains authoritative. |
| `Accept-Language`      | `km` or `en`; machine error code never changes with language.               |

### 5.3 Response envelope

Resource responses may place the resource directly under `data`. Read-model and projection responses include truth metadata:

```json
{
  "request_id": "0190f8f4-2d4f-7b40-a7b5-72dcf8a2e610",
  "source": "authoritative_read_model",
  "as_of": "2026-07-26T09:00:00Z",
  "freshness": "fresh",
  "completeness": "complete",
  "reconciliation_status": "reconciled",
  "data": {}
}
```

Allowed freshness values: `fresh`, `aging`, `stale`, `unknown`, `local_authoritative_pending_sync`. Allowed completeness values: `complete`, `partial`, `unknown`. A response must not use `fresh` unless the surface-specific freshness contract is satisfied.

### 5.4 Error envelope

```json
{
  "error": {
    "code": "SCOPE_PERMISSION_DENIED",
    "message": "You are not permitted to perform this action.",
    "message_key": "api.error.scope_permission_denied",
    "retryable": false,
    "severity": "blocking",
    "request_id": "0190f8f4-2d4f-7b40-a7b5-72dcf8a2e610",
    "details": [],
    "operator_action": "Request an authorized role or use the correct Store context."
  }
}
```

The shared error registry is authoritative. No endpoint invents an unregistered production error code.

### 5.5 Idempotency

- The idempotency domain is `{surface, credential_or_device, tenant, digital_store, location_if_any, HTTP method, normalized route}`.
- Keys are opaque, client-generated and unique. Payload hash is stored with the first accepted request.
- A replay with the same key and identical semantic payload returns the original status/body or a stable operation reference.
- Reuse with a different payload returns `IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST`.
- Idempotency does not hide authorization, version or state conflicts; those checks are re-evaluated according to the endpoint contract.
- Retention windows are `[REQUIRED: approved per-surface retention values based on retry/reconciliation evidence]`.
- Financial, inventory, custody and finalized transaction effects are protected by both request idempotency and domain uniqueness/ledger constraints.

### 5.6 Concurrency and conditional writes

- Mutable resources expose `version` and ETag.
- `If-Match` or explicit expected version is required when lost-update risk exists.
- Conflicts return `RESOURCE_VERSION_CONFLICT` with safe current-version metadata.
- Finalized ledgers are append-only; corrections use compensating records or approved state transitions, not destructive update.

### 5.7 Pagination, filtering and sorting

Collection endpoints use opaque cursor pagination:

```json
{
  "data": [],
  "page": {
    "next_cursor": "opaque-or-null",
    "has_more": false,
    "limit": 50
  }
}
```

- `limit` defaults and maxima are set per endpoint and capacity-tested; exact values are `[REQUIRED: capacity evidence]`.
- Supported filters are allow-listed in OpenAPI. Unknown filters return `FILTER_NOT_SUPPORTED`.
- Filter syntax is `filter[field]=value`; repeated parameters represent OR only where documented.
- Sorting uses `sort=field` or `sort=-field`; a stable unique tie-breaker is always added server-side.
- Cursors bind to the normalized query, authorization scope and sort order. Reuse outside that context returns `CURSOR_CONTEXT_MISMATCH`.
- Offset pagination is prohibited for unbounded operational datasets.

### 5.8 Rate limiting

Rate limits are enforced by surface, credential, actor, Tenant, Digital Store, Location, IP/device and risk class as applicable. Responses include:

```text
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
Retry-After
X-RateLimit-Policy
```

Limit values are not guessed in this contract. They require load, abuse and commercial-policy approval and are registered as `[REQUIRED: approved rate-limit profile values]`. Throttling never bypasses critical reconciliation, revocation or security callback processing; those use separately protected queues and quotas.

### 5.9 Retry rules

| Condition                                | Client behavior                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Network timeout before response          | Retry only with the same idempotency key for mutations.                                       |
| `429`                                    | Wait for `Retry-After`; apply jitter.                                                         |
| `502`, `503`, `504` and `retryable=true` | Exponential backoff with jitter, bounded attempts, then durable queue or operator escalation. |
| `409` state/version conflict             | Refresh state; do not blind-retry.                                                            |
| `401`, `403`                             | Refresh/re-authorize only as documented; do not loop.                                         |
| Validation `4xx`                         | Correct request; do not retry unchanged.                                                      |
| Accepted asynchronous operation          | Poll operation status or consume registered event/webhook; do not resubmit.                   |

### 5.10 Audit and correlation

Every privileged or business-significant mutation records:

- request/correlation/causation IDs;
- surface and API version;
- actor, credential, device and service identity;
- Tenant, Digital Store, Location and target resource;
- permission/scope and policy version;
- idempotency key and payload hash where applicable;
- reason, approval and support-consent references where required;
- before/after safe summary or event IDs;
- result, error code and retry/operation reference;
- source IP/device/network metadata under privacy policy.

Audit records are append-only and cannot be disabled by client input.

## 6. Authentication summary

HET-issued device certificate plus mutually authenticated transport for Hub/cloud; Hub-issued short-lived device session for LAN clients; active device assignment; optional staff actor session; explicit terminal/profile permission. Browser bearer tokens and connector tokens are rejected.

## 7. Scope and permission governance

Scopes are action-oriented, registered and immutable once released. A token receives only scopes approved for its credential class and resource scope. A scope does not replace resource membership, device assignment, environment restrictions, approval policy, RLS or business-state validation. Deprecated scopes remain recognized only for the approved migration window and never change meaning.

The shared scope registry defines scope key, surface, credential classes, resource types, risk, approval class, audit category, phase and deprecation replacement.

## 8. Tenant, Digital Store and Location resolution

- Tenant is the root isolation boundary.
- A Digital Store belongs to one Tenant/Partner and exactly one primary vertical.
- A physical Location belongs to a Digital Store and is required for Location-specific operational truth.
- Context is resolved server-side from trusted identity/installation/device/publication data.
- Client-supplied context is a requested narrowing or external reference, never an authorization grant.
- Cross-Tenant and cross-Digital-Store operations are denied unless the Management API caller has an explicit HET platform permission and the operation itself is designed for that scope.
- Every SQL path is protected by RLS, trusted security-definer functions or equivalent server enforcement; browser/client claims alone are insufficient.

## 9. Route and resource catalog

### 9.1 Provisioning, identity and sessions

| Method | Route                | Scope                   | Notes                                                         |
| ------ | -------------------- | ----------------------- | ------------------------------------------------------------- |
| `POST` | `/provision/claim`   | `edge.provision.claim`  | Device certificate bootstrap; short-lived provisioning grant. |
| `GET`  | `/health`            | `edge.health.read`      | Local dependencies and cloud-link state.                      |
| `GET`  | `/identity`          | `edge.identity.read`    | Tenant/Digital Store/Location/device assignment.              |
| `GET`  | `/config/status`     | `edge.config.read`      | Active/pending configuration versions.                        |
| `POST` | `/sessions/login`    | `edge.session.open`     | Staff local login.                                            |
| `POST` | `/sessions/switch`   | `edge.session.switch`   | Actor switch with audit.                                      |
| `POST` | `/approvals/request` | `edge.approval.request` | Scoped manager approval.                                      |

### 9.2 T1 POS Cashier / Intake

| Method  | Route                               | Scope                        | Notes                                                    |
| ------- | ----------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `POST`  | `/laundry/bookings/drafts`          | `edge.bookings.create`       | Local draft.                                             |
| `PATCH` | `/laundry/bookings/drafts/{id}`     | `edge.bookings.update_draft` | Expected version required.                               |
| `POST`  | `/laundry/bookings/{id}/finalize`   | `edge.bookings.finalize`     | Immutable price/service/custody snapshots.               |
| `POST`  | `/laundry/bookings/{id}/payments`   | `edge.payments.record`       | Append payment attempt/evidence.                         |
| `POST`  | `/laundry/bookings/{id}/discounts`  | `edge.discounts.apply`       | Permission/approval policy.                              |
| `POST`  | `/laundry/bookings/{id}/print-jobs` | `edge.print.create`          | Durable local print queue.                               |
| `GET`   | `/customers/search`                 | `edge.customers.search`      | Location-authorized lookup.                              |
| `POST`  | `/customers`                        | `edge.customers.create`      | Local-first identity creation with later reconciliation. |

### 9.3 T2 Customer Display

| Method   | Route                                    | Scope                         | Notes                     |
| -------- | ---------------------------------------- | ----------------------------- | ------------------------- |
| `POST`   | `/displays/sessions`                     | `edge.display.open`           | Bind assigned T1/T2.      |
| `PATCH`  | `/displays/sessions/{id}`                | `edge.display.update`         | Customer-safe state only. |
| `POST`   | `/displays/sessions/{id}/receipt-choice` | `edge.display.receipt_choice` | Consent/evidence.         |
| `DELETE` | `/displays/sessions/{id}`                | `edge.display.close`          | Privacy reset.            |
| `GET/WS` | `/displays/sessions/{id}/stream`         | `edge.display.read`           | Authenticated LAN stream. |

### 9.4 T3 Clean & Ready Scan-In

| Method | Route                                   | Scope                 | Notes                                |
| ------ | --------------------------------------- | --------------------- | ------------------------------------ |
| `POST` | `/laundry/ready-sessions`               | `edge.ready.open`     | Start Ready session.                 |
| `POST` | `/laundry/ready-sessions/{id}/scans`    | `edge.ready.scan`     | Append scan/custody evidence.        |
| `POST` | `/laundry/ready-sessions/{id}/qa`       | `edge.ready.qa`       | Count/quality/packaging result.      |
| `POST` | `/laundry/ready-sessions/{id}/storage`  | `edge.ready.storage`  | Storage occupancy validation.        |
| `POST` | `/laundry/ready-sessions/{id}/complete` | `edge.ready.complete` | Posts Ready transition exactly once. |

### 9.5 T4 Customer Pickup Scan-Out

| Method | Route                                                  | Scope                          | Notes                                 |
| ------ | ------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| `POST` | `/laundry/pickup-sessions`                             | `edge.pickup.open`             | Customer/Booking lookup.              |
| `POST` | `/laundry/pickup-sessions/{id}/collector-verification` | `edge.pickup.verify_collector` | Verification evidence.                |
| `POST` | `/laundry/pickup-sessions/{id}/scans`                  | `edge.pickup.scan`             | Retrieval/custody evidence.           |
| `POST` | `/laundry/pickup-sessions/{id}/payments`               | `edge.pickup.payment`          | Allowed remaining balance.            |
| `POST` | `/laundry/pickup-sessions/{id}/release`                | `edge.pickup.release`          | Final custody release and completion. |

### 9.6 Shift, peripherals, support and sync

| Method | Route                         | Scope                   | Notes                                  |
| ------ | ----------------------------- | ----------------------- | -------------------------------------- |
| `POST` | `/shifts/open`                | `edge.shifts.open`      | Local shift.                           |
| `POST` | `/shifts/{id}/cash-movements` | `edge.cash.append`      | Append-only.                           |
| `POST` | `/shifts/{id}/close`          | `edge.shifts.close`     | Reconciliation.                        |
| `GET`  | `/peripherals`                | `edge.peripherals.read` | Assigned hardware state.               |
| `POST` | `/peripherals/{id}/test`      | `edge.peripherals.test` | Guided test.                           |
| `GET`  | `/sync/status`                | `edge.sync.read`        | Cursors, outbox, files, conflicts.     |
| `POST` | `/sync/push`                  | `edge.sync.push`        | Batched local events to cloud.         |
| `POST` | `/sync/pull`                  | `edge.sync.pull`        | Compatible configuration/inbox events. |
| `POST` | `/support/diagnostic-bundles` | `edge.support.bundle`   | Consented, redacted, encrypted.        |

### 9.7 Sync protocol

Each pushed event contains `event_id`, `aggregate_type`, `aggregate_id`, `aggregate_version`, `event_type`, `event_version`, `occurred_at`, `business_date`, `actor_id`, `device_id`, `location_id`, `causation_id`, `correlation_id`, `payload`, `payload_hash` and `local_commit_sequence`. The cloud acknowledges each event independently as `accepted`, `duplicate`, `rejected_permanent` or `retry_later`.

Configuration pulls use immutable publication versions and compatibility declarations. Server-wins applies only to approved configuration classes; it never overwrites newer local transaction, payment, inventory or custody truth. Conflicts become explicit reconciliation records.

## 10. Error catalogue

This surface uses `kitluy-api-error-code-registry-v1.0.0.md`. Surface-specific codes are reserved by prefix:

| Surface         | Prefixes                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Management      | `MGT_`, plus shared identity/scope/resource/audit codes                                               |
| Commerce Store  | `COM_`, `STOREFRONT_`, `CART_`, `CHECKOUT_`, `CUSTOMER_`, `PRE_INTAKE_`, `QUEUE_`                     |
| Edge Operations | `EDG_`, `DEVICE_`, `PROFILE_`, `HUB_`, `SYNC_`, `BOOKING_`, `PAYMENT_`, `PRINT_`, `READY_`, `PICKUP_` |
| Connector       | `CON_`, `INSTALLATION_`, `MAPPING_`, `PROJECTION_`, `PROVIDER_`, `WEBHOOK_`, `RECONCILIATION_`        |

HTTP status is transport classification; machine behavior is controlled by registered error code and `retryable` flag. Confidential authorization policy internals are not exposed.

## 11. API version lifecycle and compatibility

The shared version/deprecation policy is authoritative. This surface uses URL major versions (`/edge/v1`) and additive schema evolution within a major version.

- Backward-compatible additions may ship without a new major version after contract tests pass.
- Breaking behavior requires a new major route or an explicitly approved parallel contract.
- Required fields are never added to existing request schemas without a new compatible mechanism or major version.
- Enum expansion is treated as an additive change only when clients are required and tested to tolerate unknown values; otherwise it is breaking.
- Deprecation requires replacement guidance, usage discovery, owner approval, published dates, migration tests and support evidence.
- Exact minimum support window and announcement cadence are `[REQUIRED: owner-approved API support policy values]`.
- Security or legal emergency changes may use the emergency process but must preserve audit, incident communication and a remediation path.

## 12. Stale-data, offline and reconciliation behavior

The Store Hub is the local operational authority after provisioning. Local committed responses remain authoritative for the Location and may be pending cloud sync. Every response identifies local commit status, aggregate version and cloud sync state. Cloud projections must identify last acknowledged edge cursor and may not override newer local events silently.

### 12.1 Local mutation response

```json
{
  "request_id": "uuid",
  "idempotency_key": "device-key",
  "result": "accepted",
  "aggregate_id": "uuid",
  "aggregate_version": 4,
  "local_event_ids": ["uuid"],
  "accepted_at": "2026-07-26T09:00:00Z",
  "sync_state": "pending_cloud_sync"
}
```

### 12.2 Offline rules

- Approved local operations continue during WAN failure.
- Payment methods that require online provider authority must not be falsely marked paid.
- Local files, print jobs and events remain durably queued.
- Reconnect uses ordered, idempotent push/pull with explicit acknowledgements.
- Cloud rejects do not delete local truth; they create reconciliation work.
- Inventory, finance, payment and custody conflicts are not solved by generic last-write-wins.

## 13. Examples

### 13.1 Finalize a local Laundry Booking

```http
POST /edge/v1/laundry/bookings/7a3d.../finalize
Authorization: Bearer <hub-device-session>
Idempotency-Key: pos-2e4b-01J2K5QZ
If-Match: "draft-v7"
Content-Type: application/json

{
  "actor_session_id": "0e1a...",
  "expected_draft_version": 7,
  "customer_confirmation": {"method":"t2_confirm","summary_hash":"sha256:..."}
}
```

```json
{
  "request_id": "0190...",
  "idempotency_key": "pos-2e4b-01J2K5QZ",
  "result": "accepted",
  "aggregate_id": "7a3d...",
  "aggregate_version": 1,
  "local_event_ids": ["4d23...", "7f11..."],
  "accepted_at": "2026-07-26T09:00:00Z",
  "sync_state": "pending_cloud_sync"
}
```

## 14. Audit expectations

Every T1–T4 mutation, staff switch, approval, payment, cash movement, print job, custody transition, device action, sync acknowledgement and support bundle is append-only audited locally and synchronized to cloud.

All audit events include the common fields in §5.10 and are retained under the approved audit/finance/privacy policies.

## 15. Contract testing and release gates

Every operation maps to the shared Contract Test Registry. Minimum gates:

1. OpenAPI syntax and JSON Schema validation.
2. Generated server/client compatibility check.
3. Authentication and wrong-credential-surface rejection.
4. Tenant, Digital Store, Location, user, role, device and connector isolation as applicable.
5. Positive and negative scope tests.
6. Idempotent replay and mismatched-payload rejection.
7. Error-code registry conformance.
8. Cursor/filter/sort stability and scope binding.
9. Rate-limit headers and retry behavior.
10. Freshness/stale-data behavior.
11. Audit, request ID and trace propagation.
12. Append-only finance/inventory/custody behavior where applicable.
13. Backward compatibility against all supported contract versions.
14. Khmer/English error localization and KHR/USD/timezone tests.
15. Performance, outage, recovery and security tests required by the surface.

A contract is not released until its required `KACT-*` records have passing evidence linked to the build, schema and environment.

### 15.1 Surface test anchors

- `KACT-EDG-001` — OpenAPI conformance.
- `KACT-EDG-002` — certificate and assignment trust.
- `KACT-EDG-003` — terminal profile isolation.
- `KACT-EDG-004` — offline local commit.
- `KACT-EDG-005` — sync replay/deduplication.
- `KACT-EDG-006` — conflict/reconciliation behavior.
- `KACT-EDG-007` — T1–T4 custody and finance audit.
- `KACT-EDG-008` — configuration compatibility and rollback.
- `KACT-EDG-009` — WAN outage/recovery.

## 16. Security, privacy and abuse controls

- Least privilege and deny-by-default.
- No direct production database access from clients or connectors.
- Secrets never appear in response bodies, logs, audit summaries or generated SDKs.
- PII is minimized, masked and purpose-scoped.
- File access uses signed, short-lived grants and authoritative metadata.
- Sensitive actions require authorized human confirmation where project rules require it.
- Abuse controls do not make stale, cached or estimated data appear authoritative.
- Security scans, dependency checks, schema fuzzing and authorization probes are release gates.

## 17. Observability and service-level signals

Minimum metrics: request rate, status/error code, p50/p95/p99 latency, auth denials, scope denials, idempotency replay/conflict, rate-limit events, stale responses, queue/backlog, reconciliation exceptions and dependency health. Logs are structured and carry request/trace, surface, version and safe scope identifiers. No sensitive payload logging by default.

Exact SLOs and paging thresholds are `[REQUIRED: approved environment-specific SLO values]` and must be based on capacity tests and pilot evidence.

## 18. Release and migration checklist

- [ ] OpenAPI source approved and checksum recorded.
- [ ] Shared error/scope/version/test registries updated.
- [ ] Database/schema migration is additive or has approved compatibility plan.
- [ ] Generated validators and SDK artifacts match source.
- [ ] Required contract tests pass in development and staging.
- [ ] Security and isolation tests pass.
- [ ] Freshness, retry and outage behavior pass.
- [ ] Monitoring, dashboards and alert rules exist.
- [ ] Rollback/parallel-version plan tested.
- [ ] Documentation and examples published.
- [ ] Pilot evidence approved before production promotion.

## Appendix A — Required owner/security/capacity values

1. `[REQUIRED: repository and package paths for OpenAPI source and generated artifacts]`
2. `[REQUIRED: API gateway hosts and domain ownership per environment]`
3. `[REQUIRED: OAuth issuer, audiences, token TTLs and refresh rotation policy]`
4. `[REQUIRED: per-surface idempotency retention windows]`
5. `[REQUIRED: rate-limit profile values and commercial quota policy]`
6. `[REQUIRED: freshness thresholds by data class]`
7. `[REQUIRED: API support/deprecation windows and announcement cadence]`
8. `[REQUIRED: SLOs, alert thresholds and incident ownership]`
9. `[REQUIRED: audit, payload, idempotency and webhook retention periods]`
10. `[REQUIRED: public documentation and developer-support ownership]`

## Appendix B — Rebuild Test

A qualified engineer passes this contract's Rebuild Test only when they can recreate the gateway surface, credentials, scopes, context resolution, schemas, routes, errors, idempotency store, rate limits, audit, freshness rules, tests, monitoring and rollout from approved repository artifacts without undocumented production knowledge.
