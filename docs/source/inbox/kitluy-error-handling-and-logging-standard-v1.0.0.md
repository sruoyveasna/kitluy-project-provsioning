# KitLuy Error Handling and Logging Standard

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Objectives

Errors must be actionable, safe, localized and traceable across cloud, Store Hub, terminals, mobile apps, portals, jobs and connectors. Logs support operations and audit without becoming a second business ledger or a privacy leak.

## 2. Error taxonomy

| Class | Meaning | Retry |
|---|---|---|
| Validation | Input fails schema or business precondition | No until corrected |
| Authentication | Identity/session invalid | Re-authenticate |
| Authorization | Actor lacks permission/scope/approval | No automatic retry |
| Conflict | Version, state, idempotency or reservation conflict | Re-read and follow policy |
| Not found | Resource absent or invisible in scope | Usually no |
| Rate limited | Capacity/policy limit | Yes after server delay |
| Dependency unavailable | Provider/service/network failure | Policy-based retry |
| Offline/deferred | Operation accepted locally but not cloud-acknowledged | Queue and reconcile |
| Internal | Unexpected defect | Limited retry; alert |
| Data integrity | Invariant, reconciliation or append-only violation | Stop, alert, human repair |

## 3. Canonical error envelope

```json
{
  "error": {
    "code": "KLY-PAY-409-001",
    "message_key": "errors.payment.state_conflict",
    "category": "conflict",
    "retryable": false,
    "correlation_id": "uuid",
    "details": {}
  }
}
```

`details` contains safe field-level information only. Stable error codes are registered centrally and never repurposed.

## 4. Handling rules

- Validate untrusted input at the boundary.
- Expected domain failures are typed results, not generic exceptions.
- Unexpected exceptions are caught once at the process/request boundary, logged and mapped to a safe internal error.
- Preserve the original cause internally with `cause`; do not expose it to clients.
- Never swallow errors. A deliberate ignore requires a comment, metric or audit reason.
- Retries require idempotency and exponential backoff with jitter. Permanent errors go to dead-letter/reconciliation.
- User interfaces distinguish failed, queued, stale, partial and offline states.
- Sensitive actions fail closed when authorization, approval, audit or authoritative data is unavailable.

## 5. Structured logging

Production logs are structured JSON. Required fields where applicable:

```text
timestamp, level, service, environment, version, event,
message, correlation_id, trace_id, span_id, request_id,
tenant_id, digital_store_id, location_id, device_id,
actor_id, job_id, event_id, error_code, duration_ms, outcome
```

Use stable event names such as `sync.batch.accepted`, not free-form phrases as the only signal.

## 6. Log levels

- `debug`: development diagnostics; sampled/disabled in production by default.
- `info`: successful lifecycle events and bounded operational summaries.
- `warn`: recoverable degradation, retries, stale data or approaching limits.
- `error`: failed operation requiring investigation or exhausted retry.
- `fatal`: process cannot continue safely, data integrity risk or local authority unavailable.

Do not use `error` for normal validation failures.

## 7. Prohibited log content

Never log credentials, tokens, cookies, authorization headers, private keys, full payment data, PINs, raw customer documents, unrestricted phone/email/address, garment evidence bytes, full provider payloads containing personal data or arbitrary SQL parameters.

Sensitive identifiers are omitted, masked or tokenized according to the data classification policy. Logs are not an audit substitute; audit events have separate append-only contracts.

## 8. Correlation across offline and asynchronous flows

- T1-T4 and mobile operations create a correlation ID at the first command.
- Store Hub preserves it through local transaction, outbox, cloud ingestion and acknowledgement.
- Jobs, events, webhooks, notifications and file transfers carry correlation plus their own stable IDs.
- A retry keeps the same idempotency key but creates a new attempt ID.

## 9. Client telemetry

Client error reporting includes app version, device profile, route/screen, connectivity, Hub reachability and safe error code. It excludes customer data and secrets. Crash attachments and screenshots are opt-in and redacted.

## 10. Alerts

Alert on user/business impact, integrity and sustained symptoms—not every individual log. Required alert classes include authentication failure surge, RLS/tenant-isolation failure, Hub offline beyond threshold, sync backlog, payment reconciliation mismatch, outbox/DLQ growth, file failure, release rollback, database saturation and security events.

Exact thresholds, retention and on-call destinations remain environment-controlled values and must be recorded in the observability/runbook pack.

## 11. Testing

Tests verify error-code stability, safe serialization, localization keys, retry classification, redaction, correlation propagation, offline messaging and alert rules. Security tests inject secrets/PII and assert they are absent from logs.
