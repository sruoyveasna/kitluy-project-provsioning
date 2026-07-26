# KitLuy Management API — Canonical Contract

**Filename:** `kitluy-management-api-v1.0.0.md`  
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

**Purpose:** Authenticated back-office and platform-control contracts for HET Admin, Chain Portal, Partner Portal, approved first-party management clients and governed automation.

**Authorized callers:** HET Admin Portal; Chain Portal; Partner Portal; approved first-party management services; approved service identities.

**Boundary:** It is not a customer storefront API, a Store Hub/POS protocol, a provider callback endpoint, or a generic database CRUD façade.

The Management API controls cloud-side configuration and governed business management. It may publish immutable configuration to Locations through the Edge Operations API, but it does not execute LAN operations directly. Generic CRUD of finalized transaction, payment, inventory, custody or audit rows is prohibited.

## 2. Base path and environments

- Canonical base path: `/management/v1`
- Environment hosts: `[REQUIRED: development, staging, pilot and production API hosts]`
- The caller cannot select environment through request data; environment is determined by host and credential binding.
- Tenant and Digital Store context are resolved from the authenticated principal and explicit resource path. Headers may narrow a permitted context but never grant it.

## 3. Canonical OpenAPI 3.1 source

The executable source must live at `[REQUIRED: repository path]/openapi/management-v1.yaml`. The excerpt below is normative for shared structure; the repository source must include every route in this document.

```yaml
openapi: 3.1.0
info:
  title: KitLuy Management API
  version: 1.0.0
  description: >-
    Authenticated back-office and platform-control contracts for HET Admin, Chain Portal, Partner Portal, approved first-party management clients and governed automation.
servers:
  - url: https://{api_host}/management/v1
    description: Environment-specific KitLuy API gateway
tags:
  - name: Management
paths:
  /digital-stores:
    post:
      tags: [Management]
      operationId: management_post_digital_stores
      summary: Create a Digital Store
      security:
        - userOAuth: [digital_stores.create]
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

### 4.1 Authentication

Supabase Auth/OIDC is used for first-party human sessions. Approved third-party/private management clients use OAuth 2.0 Authorization Code with PKCE. Backend automation uses purpose-limited service credentials. Personal access tokens are not enabled by this contract; any future PAT requires a separate security decision.

### 4.2 Authorization

Authorization is permission-, resource-, environment- and approval-aware. Role names are organizational templates, not the final decision. Sensitive production actions require fresh re-authentication, reason, immutable audit and four-eyes approval according to the Admin policy.

### 4.3 Context resolution

Resolution order:

1. authenticated subject/service identity;
2. active Tenant/Partner memberships or HET Admin profile;
3. explicit route resource;
4. permitted Tenant and Digital Store scope;
5. explicit or derived Location where required;
6. vertical entitlement and feature entitlement;
7. environment and approval policy.

A caller cannot gain broader access by supplying `tenant_id`, `digital_store_id` or `location_id` in request data. The server compares them with resolved authority and rejects mismatch.

### 4.4 Core scope groups

`admin.*`, `partners.*`, `digital_stores.*`, `locations.*`, `catalog.*`, `pricing.*`, `bookings.*`, `customers.*`, `inventory.*`, `finance.*`, `reports.*`, `exports.*`, `devices.*`, `releases.*`, `support.*`, `integrations.*`, `audit.*`, `rbac.*`. Exact scopes and risk classes are in the shared scope registry.

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

Supabase Auth/OIDC user sessions for first-party portals; OAuth 2.0 Authorization Code + PKCE for approved management applications; narrowly scoped service credentials for backend jobs. Production-sensitive actions also require re-authentication and, where policy requires, an approval token.

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

### 9.1 Platform and onboarding

| Method | Route                                 | Scope                          | Notes                                              |
| ------ | ------------------------------------- | ------------------------------ | -------------------------------------------------- |
| `POST` | `/admin/onboarding-workspaces`        | `admin.onboarding.write`       | Idempotent workspace creation.                     |
| `POST` | `/admin/partners/{partner_id}/verify` | `admin.partners.verify`        | Reason/evidence required.                          |
| `POST` | `/digital-stores`                     | `digital_stores.create`        | Tenant/Partner parent required.                    |
| `POST` | `/digital-stores/{id}/vertical-lock`  | `digital_stores.vertical_lock` | Owner-locked one-primary-vertical rule; high-risk. |
| `POST` | `/store-locations`                    | `locations.create`             | Creates physical Location under Digital Store.     |
| `POST` | `/readiness/{scope}/evaluate`         | `readiness.evaluate`           | Versioned readiness definition.                    |
| `POST` | `/go-live/{location_id}/approve`      | `locations.go_live_approve`    | Four-eyes and re-auth required.                    |

### 9.2 Configuration, catalog and operations management

| Method     | Route                                   | Scope                            | Notes                                                                            |
| ---------- | --------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------- |
| `GET/POST` | `/digital-stores/{id}/catalog/services` | `catalog.read` / `catalog.write` | Neutral service/product model; vertical validation applied.                      |
| `GET/POST` | `/digital-stores/{id}/price-books`      | `pricing.read` / `pricing.write` | Versioned price rules.                                                           |
| `POST`     | `/config-publications`                  | `config.publish`                 | Immutable publication version.                                                   |
| `POST`     | `/config-publications/{id}/rollback`    | `config.rollback`                | Publishes compatible prior version; never edits history.                         |
| `GET`      | `/bookings`                             | `bookings.read`                  | Truth-labeled Store data; Location filter required unless broader scope granted. |
| `POST`     | `/bookings/{id}/actions/{action}`       | action-specific scope            | Finalized finance/custody changes use domain commands, not generic patch.        |
| `GET`      | `/customers`                            | `customers.read`                 | PII field masking by capability.                                                 |
| `GET`      | `/inventory/movements`                  | `inventory.movements.read`       | Append-only movement reads.                                                      |
| `POST`     | `/reports`                              | `reports.run`                    | Asynchronous report job.                                                         |
| `POST`     | `/exports`                              | `exports.create`                 | Asynchronous, audited and not commercially paywalled.                            |

### 9.3 Fleet, releases, support and governance

| Method | Route                                  | Scope                           | Notes                                   |
| ------ | -------------------------------------- | ------------------------------- | --------------------------------------- |
| `POST` | `/provisioning-sessions`               | `devices.provision`             | Short-lived, assignment-bound.          |
| `POST` | `/devices/{id}/assign`                 | `devices.assign`                | Digital Store/Location/profile binding. |
| `POST` | `/devices/{id}/revoke`                 | `devices.revoke`                | Re-auth; approval by risk policy.       |
| `POST` | `/device-actions`                      | `devices.remote_action.*`       | Signed, idempotent action queue.        |
| `GET`  | `/system-status`                       | `platform.health.read`          | Truth-labeled health and freshness.     |
| `POST` | `/releases`                            | `releases.artifact_register`    | Signed artifact metadata.               |
| `POST` | `/rollouts`                            | `releases.rollout_create`       | Internal/Pilot/Stable targeting.        |
| `POST` | `/rollouts/{id}/promote`               | `releases.promote_*`            | Approval policy enforced.               |
| `POST` | `/support-sessions`                    | `support.consent_session.start` | Consent/scope/expiry required.          |
| `GET`  | `/rbac/effective-access`               | `rbac.read`                     | Server-resolved effective grants.       |
| `POST` | `/rbac/approval-requests`              | `rbac.approval.request`         | Payload-bound action approval.          |
| `POST` | `/rbac/approval-requests/{id}/execute` | target action scope             | Single-purpose approval consumption.    |

### 9.4 Bulk and asynchronous operations

Bulk mutations are not enabled by default. Every bulk family requires an approved endpoint-specific contract, preview/dry-run, per-item outcome, scope enforcement, maximum batch policy, resumability and cancellation rules. `KLMF-API-002` remains unresolved; no generic bulk endpoint is authorized by this v1.0.0 contract.

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

The shared version/deprecation policy is authoritative. This surface uses URL major versions (`/management/v1`) and additive schema evolution within a major version.

- Backward-compatible additions may ship without a new major version after contract tests pass.
- Breaking behavior requires a new major route or an explicitly approved parallel contract.
- Required fields are never added to existing request schemas without a new compatible mechanism or major version.
- Enum expansion is treated as an additive change only when clients are required and tested to tolerate unknown values; otherwise it is breaking.
- Deprecation requires replacement guidance, usage discovery, owner approval, published dates, migration tests and support evidence.
- Exact minimum support window and announcement cadence are `[REQUIRED: owner-approved API support policy values]`.
- Security or legal emergency changes may use the emergency process but must preserve audit, incident communication and a remediation path.

## 12. Stale-data and freshness behavior

Management reads return authoritative cloud records or truth-labeled read models. Store-operational data must include source, as_of, freshness, completeness, reconciliation_status and, where relevant, hub_sync_state. Cloud data must never be presented as live Store truth when the Store Hub has not synchronized.

### 12.1 Freshness classes

| Data class                | Authority and behavior                                                                |
| ------------------------- | ------------------------------------------------------------------------------------- |
| Cloud configuration       | Authoritative after committed publication; Location acknowledgement shown separately. |
| Store transaction/Booking | Cloud read model; includes last Hub event/cursor and freshness.                       |
| Device health             | Time-sensitive projection; `stale` when heartbeat policy is exceeded.                 |
| Finance/reconciliation    | Includes as-of, currency, completeness and reconciliation status.                     |
| Report/export             | Snapshot metadata, definition version and generated-at required.                      |

Mutations that depend on live Store state either route through the Edge API or fail with `STALE_OPERATIONAL_DATA`; the Management API does not guess.

## 13. Examples

### 13.1 Create Digital Store

```http
POST /management/v1/digital-stores HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: 01J2K-DIGITAL-STORE-0001
Content-Type: application/json

{
  "tenant_id": "f6a6...",
  "name": {"km": "បោកអ៊ុតស្អាត", "en": "Clean Laundry"},
  "primary_vertical": "laundry",
  "timezone": "Asia/Phnom_Penh",
  "currencies": ["KHR", "USD"]
}
```

```json
{
  "request_id": "0190...",
  "data": {
    "id": "2ec8...",
    "state": "draft",
    "version": 1,
    "primary_vertical": "laundry"
  }
}
```

### 13.2 Approval-required response

```json
{
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Independent approval is required.",
    "retryable": false,
    "request_id": "0190...",
    "details": [{ "approval_policy": "A3_FOUR_EYES", "action_hash": "sha256:..." }]
  }
}
```

## 14. Audit expectations

Privileged mutations, configuration publication, RBAC, support, releases, exports and sensitive reads are audited. Read audit may be sampled only where approved; access to PII, finance, secrets metadata and cross-Tenant support is always recorded.

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

- `KACT-MGT-001` — OpenAPI conformance.
- `KACT-MGT-002` — human/session authentication.
- `KACT-MGT-003` — scope and resource isolation.
- `KACT-MGT-004` — four-eyes approval.
- `KACT-MGT-005` — configuration publication idempotency.
- `KACT-MGT-006` — report/export async behavior.
- `KACT-MGT-007` — Store freshness labeling.
- `KACT-MGT-008` — append-only finance/audit guardrail.

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
