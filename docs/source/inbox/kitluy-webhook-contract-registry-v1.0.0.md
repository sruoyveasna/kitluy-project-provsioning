# KitLuy Webhook Contract Registry

**Filename:** `kitluy-webhook-contract-registry-v1.0.0.md`  
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

## 1. Scope

This registry governs:

1. **Outbound KitLuy webhooks** delivering approved domain-event projections to registered connector endpoints.
2. **Inbound provider callbacks** received through the Connector API and converted into verified internal commands/events.

Webhooks are delivery mechanisms, not authoritative ledgers. A `2xx` response proves endpoint acknowledgement only. Provider redirects or browser callbacks never prove payment success.

## 2. Outbound subscription contract

| Field             | Rule                                                                              |
| ----------------- | --------------------------------------------------------------------------------- |
| `subscription_id` | Immutable UUID.                                                                   |
| Scope             | Tenant, Digital Store and optional Location/channel scope.                        |
| Topics            | Explicit allowlist from the domain-event registry; wildcards disabled by default. |
| Endpoint          | HTTPS only; public routable address; no private database endpoint.                |
| Secret            | Generated per subscription, encrypted at rest, display-once/rotatable.            |
| Status            | `pending_verification`, `active`, `degraded`, `suspended`, `revoked`, `deleted`.  |
| Version policy    | Supported event schema versions and compatibility declaration.                    |
| Filters           | Approved non-secret filters only; filters never change source truth.              |
| Rate/capacity     | Per subscription and Tenant limits.                                               |
| Audit             | Creator, approver, test history, secret rotations, suspension and deletion.       |

## 3. Delivery request

### 3.1 Required headers

```text
Content-Type: application/json
User-Agent: KitLuy-Webhook/1.0
X-KitLuy-Webhook-Id: <delivery UUID>
X-KitLuy-Subscription-Id: <subscription UUID>
X-KitLuy-Event: <canonical event name>
X-KitLuy-Event-Version: <integer>
X-KitLuy-Timestamp: <unix seconds>
X-KitLuy-Delivery-Attempt: <integer>
X-KitLuy-Content-SHA256: <lowercase hex sha256 of raw body>
X-KitLuy-Correlation-Id: <UUID>
X-KitLuy-Signature: v1=<lowercase hex HMAC-SHA256>
```

### 3.2 Signature algorithm

```text
body_hash = hex(sha256(raw_request_body))
canonical = timestamp + "." + delivery_id + "." + body_hash
signature = hex(hmac_sha256(subscription_secret, canonical))
header = "v1=" + signature
```

Receivers must compare signatures in constant time, verify body hash, verify the timestamp window and deduplicate `delivery_id`. JSON must be parsed only after signature verification of the raw bytes.

### 3.3 Body

```json
{
  "delivery_id": "00000000-0000-7000-8000-000000000001",
  "subscription_id": "00000000-0000-7000-8000-000000000002",
  "event": {
    "event_id": "00000000-0000-7000-8000-000000000003",
    "event_name": "laundry_booking.ready",
    "schema_version": 1,
    "occurred_at": "2026-07-26T00:00:00Z",
    "tenant_id": "00000000-0000-7000-8000-000000000004",
    "digital_store_id": "00000000-0000-7000-8000-000000000005",
    "location_id": "00000000-0000-7000-8000-000000000006",
    "payload": {}
  }
}
```

External payloads are projections and may omit internal actor, permission, device, security and sensitive fields.

## 4. Replay protection

- Reject timestamps outside `[REQUIRED: approved clock-skew/replay window]`.
- Store `delivery_id`, timestamp, body hash and processing result under a unique key.
- A repeated `delivery_id` with the same hash returns the prior result.
- A repeated `delivery_id` with a different hash is a security incident.
- Secret rotation supports active + previous key overlap for `[REQUIRED: approved overlap]`; key ID must be tracked internally.
- Endpoints must use TLS validation and follow no redirects unless explicitly approved. Redirects to a different host are rejected.

## 5. Response contract

| Response                                 | Meaning                                   | Dispatcher behavior                                             |
| ---------------------------------------- | ----------------------------------------- | --------------------------------------------------------------- |
| `200-299`                                | Accepted/processed or safely deduplicated | Mark delivered.                                                 |
| `408`, `425`, `429`, `500-599`           | Temporary failure                         | Retry under policy; honor bounded `Retry-After`.                |
| `400`, `404`, `405`, `410`, `415`, `422` | Contract/endpoint failure                 | Normally non-retryable; suspend or require operator repair.     |
| `401`, `403`                             | Credential/signature policy mismatch      | Stop automatic retries after bounded diagnostic attempt; alert. |
| Network timeout/TLS/DNS                  | Transport failure                         | Retry according to policy and circuit breaker.                  |

Receiver response body is optional and capped. KitLuy records status, latency and a redacted response excerpt; it never stores returned secrets.

## 6. Delivery lifecycle

```text
queued
→ dispatching
→ delivered
  | retry_scheduled
  | failed_non_retryable
  | suspended
  | dead_letter
  | cancelled

manual replay:
replay_requested → approved → queued(replay generation) → delivered | dead_letter
```

Every attempt is append-only in `kitluy_integrations.webhook_delivery_attempts`. Current status is a derived projection.

## 7. Retry and suspension

- Default proposed policy `WH-RP-001`: immediate, 1m, 5m, 15m, 1h, 4h, 12h and 24h.
- Exact production policy is configurable by endpoint class and requires approval.
- Circuit breaker opens for repeated transport/provider failure and creates `connector.delivery_failed`.
- Automatic suspension occurs only under an approved policy and records reason, threshold, last success, next action and notification status.
- Re-enabling or replaying a production endpoint is permissioned and audited; financial or high-impact replay requires four-eyes approval.

## 8. Inbound provider callback contract

Inbound route family:

```text
POST /connector/v1/provider-events/{provider}
```

Processing order:

1. Identify provider/credential version from route and headers.
2. Read raw bytes and enforce size/content-type limits.
3. Verify provider signature, timestamp and endpoint binding.
4. Persist `provider_event_receipt` with provider event ID, body hash and verification result.
5. Deduplicate provider event ID under provider + account/merchant scope.
6. Validate provider-specific schema.
7. Queue asynchronous processing unless the provider contract requires a bounded synchronous acknowledgement.
8. Re-read authoritative provider status when necessary.
9. Append KitLuy payment/refund/reconciliation records and emit KitLuy domain events.

Unverified payloads never update payment, inventory, finance or customer truth.

## 9. Registry

| Contract ID     | Direction | Topic / source                         | Endpoint class                           | Signing                       | Idempotency                               | Retention       |
| --------------- | --------- | -------------------------------------- | ---------------------------------------- | ----------------------------- | ----------------------------------------- | --------------- |
| `WH-OUT-001`    | Outbound  | Approved domain events                 | Partner/private connector HTTPS endpoint | KitLuy HMAC v1                | `delivery_id` + source event              | R3              |
| `WH-IN-PAY-001` | Inbound   | Payment provider callbacks             | Connector API provider route             | Provider-specific + timestamp | provider event ID + merchant scope        | R4              |
| `WH-IN-NOT-001` | Inbound   | Notification provider status           | Connector API provider route             | Provider-specific             | provider message/event ID                 | R3              |
| `WH-IN-CHN-001` | Inbound   | Marketplace/delivery/channel callbacks | Connector API provider route             | Provider-specific             | provider event/order ID + channel account | R3/R4 by effect |
| `WH-IN-IDN-001` | Inbound   | Identity/verification provider         | Connector API provider route             | Provider-specific             | provider case/event ID                    | R2/R3           |

## 10. Delivery-status schema

Required tables:

- `kitluy_integrations.webhook_subscriptions`
- `kitluy_integrations.webhook_endpoints`
- `kitluy_integrations.webhook_secrets`
- `kitluy_integrations.webhook_deliveries`
- `kitluy_integrations.webhook_delivery_attempts`
- `kitluy_integrations.provider_event_receipts`
- `kitluy_integrations.provider_event_processing`

Each delivery exposes source event, projection version, endpoint/secret generation, status, attempts, timestamps, next retry, last failure class, replay lineage and reconciliation status.

## 11. Contract tests

- Valid and invalid HMAC; raw-body whitespace changes; constant-time comparison.
- Old/new secret rotation overlap and expired secret rejection.
- Timestamp outside replay window.
- Duplicate delivery with same and different hash.
- Endpoint `2xx`, `429`, `4xx`, `5xx`, timeout, TLS failure and DNS failure.
- Retry schedule, circuit breaker, suspension and approved replay.
- Provider event duplicate and out-of-order callbacks.
- Cross-Tenant subscription/filter isolation.
- Sensitive-field projection tests.
- Payment callback cannot mark success without verified provider evidence.

## 12. Open production values

- `[REQUIRED: replay-window and clock-skew limits]`
- `[REQUIRED: maximum body/response size]`
- `[REQUIRED: TLS minimum and outbound egress policy]`
- `[REQUIRED: retry/suspension thresholds]`
- `[REQUIRED: secret rotation overlap and retention]`
- `[REQUIRED: webhook delivery SLO and alert thresholds]`
