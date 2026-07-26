# KitLuy Store Hub LAN API

**Filename:** `kitluy-storehub-lan-api-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**API family:** Edge Operations API — Store LAN surface  
**Status:** Canonical target contract; not implementation evidence  
**Audience:** POS Desktop, POS Mobile, Store Hub, QA, security and hardware-adapter engineers

> **Purpose:** Provide the only normal write path from T1–T4 and approved local clients into Store Hub operational truth.

## 1. Network and transport contract

| Property           | Value                                                                    |
| ------------------ | ------------------------------------------------------------------------ |
| Scheme             | HTTPS only                                                               |
| Base URL           | `https://{assigned-hub-hostname}:7443/edge/v1`                           |
| Hostname           | `kitluy-hub-{asset_number}.local` plus assigned DNS name where available |
| Transport          | HTTP/2; HTTP/1.1 permitted only for approved adapters                    |
| Authentication     | Mutual TLS device certificate, then Hub-issued actor session token       |
| Event channel      | WebSocket over `wss://...:7443/edge/v1/events`                           |
| Discovery          | mDNS `_kitluy-hub._tcp.local`; discovery never establishes trust         |
| Database access    | Prohibited for all terminals                                             |
| Public inbound WAN | None                                                                     |
| Timeouts           | connect 3 s, request 15 s, print/file operations use asynchronous jobs   |

## 2. Required request headers

```http
X-Kitluy-Request-Id: <uuidv7>
X-Kitluy-Device-Id: <terminal uuid>
X-Kitluy-Session-Id: <actor session uuid>
X-Kitluy-Profile: laundry_t1
X-Kitluy-Config-Version: <active snapshot version>
Idempotency-Key: kl1.<terminal_uuid>.<client_sequence>
Content-Type: application/json
Accept: application/json
```

`Idempotency-Key` is mandatory for every mutation. `X-Kitluy-Config-Version` lets the Hub reject a command created against an incompatible or revoked snapshot.

## 3. Authorization sequence

```text
mTLS terminal certificate
→ validate certificate chain and revocation
→ validate device assignment and Location
→ open actor session with local credential verifier
→ evaluate actor permission + terminal profile + active configuration
→ evaluate action-scoped approval where required
→ execute local transaction
→ return committed result
```

IP address, hostname and possession of a provisioning code are never sufficient authorization.

## 4. Common response envelopes

### 4.1 Success

```json
{
  "request_id": "0198...",
  "result": "committed",
  "aggregate_id": "0198...",
  "aggregate_version": 4,
  "event_ids": ["0198..."],
  "hub_sequence_from": 10423,
  "hub_sequence_to": 10425,
  "sync_state": "pending_cloud_sync",
  "committed_at": "2026-07-26T08:15:13.225Z"
}
```

### 4.2 Asynchronous job accepted

```json
{
  "request_id": "0198...",
  "result": "accepted",
  "job_id": "0198...",
  "job_state": "queued",
  "poll_url": "/edge/v1/print-jobs/0198..."
}
```

### 4.3 Error

```json
{
  "request_id": "0198...",
  "error": {
    "code": "EDGE_BOOKING_VERSION_CONFLICT",
    "message": "The Booking changed after this screen was loaded.",
    "retryable": false,
    "details": {
      "expected_version": 7,
      "actual_version": 8
    }
  }
}
```

Errors must be safe for staff display and separately log a redacted diagnostic record.

## 5. Session routes

| Method and route               | Permission         | Idempotent | Purpose                                     |
| ------------------------------ | ------------------ | ---------: | ------------------------------------------- |
| `GET /health`                  | Device certificate |        Yes | Hub, LAN, database and active-config health |
| `GET /identity`                | Device certificate |        Yes | Trusted Hub identity and assignment summary |
| `GET /config/status`           | Device certificate |        Yes | Active/staged snapshot and compatibility    |
| `POST /sessions/open`          | Device certificate |   Required | Open staff/profile session                  |
| `POST /sessions/refresh`       | Active session     |   Required | Rotate short-lived session token            |
| `POST /sessions/close`         | Active session     |   Required | Close and clear profile state               |
| `POST /approvals/request`      | Active session     |   Required | Request action-scoped manager approval      |
| `POST /approvals/{id}/approve` | Approver session   |   Required | Approve one action and parameter hash       |

Session tokens expire after 15 minutes idle and 8 hours absolute by default. Offline credential validity is bounded by the projected staff policy.

### 5.1 Open session request

```json
{
  "actor_reference": "employee-pin-or-badge-reference",
  "credential": "opaque-client-proof",
  "requested_profile": "laundry_t1",
  "terminal_client_sequence": 8821
}
```

The Hub returns a signed opaque token, session ID, permissions, profile, expiry and privacy-reset instructions. Raw PINs are never stored in logs.

## 6. Customer routes

| Method and route                  | Permission                | Notes                                          |
| --------------------------------- | ------------------------- | ---------------------------------------------- |
| `GET /customers/search?q=&limit=` | `customer.read_local`     | Phone/name/ID search, minimum necessary fields |
| `GET /customers/{id}`             | `customer.read_local`     | Scoped detail                                  |
| `POST /customers`                 | `customer.create_local`   | Creates local stable UUID and outbox event     |
| `POST /customers/{id}/consents`   | `customer.consent.record` | Append-only consent evidence                   |

Search response includes `source`, `data_as_of`, and `cloud_sync_state`. Duplicate suggestions never silently merge records.

## 7. T1 Booking routes

| Method and route                             | Permission                       | Concurrency                 |
| -------------------------------------------- | -------------------------------- | --------------------------- |
| `POST /bookings/drafts`                      | `laundry.booking.create`         | Idempotency key             |
| `GET /bookings/{id}`                         | `laundry.booking.read`           | Returns aggregate version   |
| `GET /bookings?number=&customer_id=&status=` | `laundry.booking.read`           | Cursor pagination           |
| `POST /bookings/{id}/lines`                  | `laundry.booking.edit_draft`     | `expected_version` required |
| `POST /bookings/{id}/garments`               | `laundry.garment.capture`        | `expected_version` required |
| `POST /bookings/{id}/evidence`               | `file.capture`                   | Returns local asset ID      |
| `POST /bookings/{id}/confirm-intake`         | `laundry.booking.confirm_intake` | Serializable finalization   |
| `POST /bookings/{id}/status-events`          | Profile-specific                 | State-machine validation    |
| `POST /bookings/{id}/exceptions`             | `laundry.exception.create`       | Reason and evidence rules   |

### 7.1 Create draft

```json
{
  "customer_id": "0198...",
  "business_date": "2026-07-26",
  "language_code": "km",
  "pickup_method": "store_pickup",
  "due_at": "2026-07-28T10:00:00+07:00",
  "source": "t1"
}
```

### 7.2 Add line

```json
{
  "expected_version": 1,
  "service_id": "0198...",
  "service_version": 12,
  "pricing_method": "per_weight",
  "quantity": "4.5000",
  "unit_code": "kg",
  "addons": [{ "addon_id": "0198...", "version": 3, "quantity": "1.0000" }],
  "manual_weight_reason": null
}
```

The Hub recalculates from the active signed price snapshot. A terminal-provided total is advisory and never authoritative.

### 7.3 Confirm intake

```json
{
  "expected_version": 6,
  "customer_confirmation": {
    "method": "t2_confirmed",
    "session_id": "0198..."
  },
  "payment_policy": "deposit",
  "requested_deposit_minor": 500,
  "print": {
    "receipt": true,
    "tags": true
  }
}
```

Success means the Booking, price snapshot, intake custody events, optional cash payment and print jobs are durably committed locally.

## 8. Payment routes

| Method and route                            | Permission                | Rule                                                    |
| ------------------------------------------- | ------------------------- | ------------------------------------------------------- |
| `POST /bookings/{id}/payments/cash`         | `payment.cash.accept`     | Hub-local, shift required when policy says so           |
| `POST /bookings/{id}/payments/khqr`         | `payment.khqr.request`    | Creates pending request; never confirms from QR display |
| `GET /payments/{id}`                        | `payment.read`            | Authoritative local state and provider freshness        |
| `POST /payments/{id}/provider-confirmation` | Hub/provider adapter only | Signed provider path                                    |
| `POST /payments/{id}/void-requests`         | `payment.void.request`    | Approval may be required                                |
| `POST /payments/{id}/refund-requests`       | `payment.refund.request`  | Compensating record only                                |

Offline card capture is not exposed.

## 9. T2 customer-display routes

| Method and route                               | Permission  | Purpose                                       |
| ---------------------------------------------- | ----------- | --------------------------------------------- |
| `POST /display-sessions`                       | T1          | Bind a customer-safe session to assigned T2   |
| `PATCH /display-sessions/{id}`                 | T1          | Update redacted projection using sequence     |
| `GET /display-sessions/{id}`                   | Assigned T2 | Current customer-safe state                   |
| `POST /display-sessions/{id}/customer-actions` | Assigned T2 | Language, receipt choice or confirmation only |
| `POST /display-sessions/{id}/close`            | T1/Hub      | Privacy reset                                 |

Every T2 update includes `display_sequence`; a lower or repeated sequence is ignored. QR and payment results are tied to the current display session and expiry.

## 10. T3 Ready Scan-In routes

| Method and route                           | Permission                 |
| ------------------------------------------ | -------------------------- |
| `POST /ready-scan/sessions`                | `laundry.ready.start`      |
| `POST /ready-scan/{session_id}/items`      | `laundry.ready.scan`       |
| `POST /ready-scan/{session_id}/qa`         | `laundry.ready.qa`         |
| `POST /ready-scan/{session_id}/exceptions` | `laundry.exception.create` |
| `POST /ready-scan/{session_id}/storage`    | `laundry.storage.assign`   |
| `POST /ready-scan/{session_id}/complete`   | `laundry.ready.complete`   |

### 10.1 Complete Ready Scan-In

```json
{
  "expected_booking_version": 14,
  "expected_count": 8,
  "scanned_item_ids": ["0198..."],
  "qa_result": "pass",
  "storage_assignments": [{ "bag_id": "0198...", "position_code": "RACK-A-014" }],
  "blocking_exception_ids": []
}
```

The Hub commits count verification, QA result, storage assignment, custody events and Ready transition atomically. A blocking exception prevents standard completion.

## 11. T4 Pickup Scan-Out routes

| Method and route                                  | Permission                               |
| ------------------------------------------------- | ---------------------------------------- |
| `POST /pickup-scan/sessions`                      | `laundry.pickup.start`                   |
| `POST /pickup-scan/{session_id}/verify-collector` | `laundry.pickup.verify_collector`        |
| `POST /pickup-scan/{session_id}/items`            | `laundry.pickup.scan`                    |
| `POST /pickup-scan/{session_id}/payment`          | `payment.accept_at_pickup` when assigned |
| `POST /pickup-scan/{session_id}/complete`         | `laundry.pickup.complete`                |

### 11.1 Complete pickup

```json
{
  "expected_booking_version": 19,
  "collector_verification": {
    "method": "pickup_token",
    "proof_reference": "masked-token-reference"
  },
  "scanned_item_ids": ["0198..."],
  "payment_gate": {
    "required_balance_minor": 0,
    "confirmed_payment_ids": ["0198..."]
  },
  "exception_approval_id": null
}
```

The Hub blocks completion when payment, count, collector, storage or custody invariants are unsatisfied.

## 12. Printing and peripheral routes

```text
GET  /peripherals
POST /peripherals/discover
POST /peripherals/{id}/test
POST /peripherals/{id}/bind-request
POST /print-jobs
GET  /print-jobs/{id}
POST /print-jobs/{id}/retry
POST /print-jobs/{id}/reprint
GET  /scales/{id}/reading
POST /scales/{id}/tare
```

A reprint creates a new auditable job with `reprint_of_job_id` and reason. Retrying the same job cannot create an intentional second copy.

## 13. File routes

```text
POST /files/initiate
PUT  /files/{asset_id}/chunks/{chunk_number}
POST /files/{asset_id}/complete
GET  /files/{asset_id}
GET  /files/{asset_id}/content
POST /files/{asset_id}/retention-hold
```

Default LAN chunk size is 4 MiB. The Hub validates each chunk hash and the final file hash before making the asset available.

## 14. Status, sync and diagnostics routes

```text
GET  /sync/status
POST /sync/request
GET  /status/summary
GET  /diagnostics/summary
POST /diagnostics/bundles
POST /support-sessions/authorize
POST /support-sessions/{id}/revoke
```

Diagnostics never expose private keys, credential verifiers, full payment payloads or unrelated customer PII.

## 15. Event WebSocket

Connect:

```text
GET /edge/v1/events?resume_after={event_sequence}
Sec-WebSocket-Protocol: kitluy-edge-v1
```

Envelope:

```json
{
  "event_sequence": 50121,
  "event_id": "0198...",
  "topic": "booking.0198...",
  "event_type": "laundry.booking.ready",
  "aggregate_id": "0198...",
  "aggregate_version": 15,
  "occurred_at": "2026-07-26T08:18:00Z",
  "payload": {}
}
```

Rules:

- Sequence is per terminal session event stream.
- Client acknowledges the highest contiguous sequence.
- On reconnect, Hub replays retained events or instructs the client to refresh the affected aggregate.
- T2 subscribes only to its display-session topic.
- No event delivery substitutes for authoritative mutation response.

## 16. Pagination and query limits

- Cursor pagination only.
- Default page size 50; maximum 250.
- Search minimum two normalized characters except exact code scan.
- Maximum request body 1 MiB, excluding file-chunk endpoints.
- Maximum batch mutation 100 items unless a specific contract states less.
- Rate limits are per device and route; local operational paths favor bounded backpressure rather than silent dropping.

## 17. Retry policy

| Operation                           | Client retry                                              |
| ----------------------------------- | --------------------------------------------------------- |
| GET                                 | Exponential backoff with jitter; safe                     |
| Mutation with same idempotency key  | Safe; Hub returns original outcome                        |
| Mutation with a new idempotency key | New business intent; never automatic                      |
| Print-job retry                     | Same job ID; duplicate suppressed                         |
| Reprint                             | New job and explicit permission/reason                    |
| Payment provider request            | Hub controls retry; terminal does not invent confirmation |

Recommended client backoff: 250 ms, 500 ms, 1 s, 2 s, 5 s, then visible degraded state.

## 18. Error catalogue

| Code                                | HTTP |                 Retryable | Meaning                                |
| ----------------------------------- | ---: | ------------------------: | -------------------------------------- |
| `EDGE_AUTH_CERT_INVALID`            |  401 |                        No | Certificate invalid or revoked         |
| `EDGE_AUTH_SESSION_EXPIRED`         |  401 |           Yes after login | Actor session expired                  |
| `EDGE_SCOPE_MISMATCH`               |  403 |                        No | Tenant/Store/Location mismatch         |
| `EDGE_PROFILE_FORBIDDEN`            |  403 |                        No | Device or actor lacks profile          |
| `EDGE_APPROVAL_REQUIRED`            |  409 |                        No | Action-scoped approval needed          |
| `EDGE_CONFIG_INCOMPATIBLE`          |  409 |                        No | Client snapshot cannot perform action  |
| `EDGE_IDEMPOTENCY_PAYLOAD_MISMATCH` |  409 |                        No | Same key reused with different payload |
| `EDGE_BOOKING_VERSION_CONFLICT`     |  409 |                        No | Refresh aggregate                      |
| `EDGE_BOOKING_STATE_INVALID`        |  422 |                        No | State machine rejected transition      |
| `EDGE_PAYMENT_PENDING`              |  409 |                 Yes later | Provider state not final               |
| `EDGE_PAYMENT_NOT_CONFIRMED`        |  422 |                        No | Release/finalization blocked           |
| `EDGE_DUPLICATE_SCAN`               |  409 |                        No | Item already accepted                  |
| `EDGE_WRONG_BOOKING_ITEM`           |  422 |                        No | Scanned item belongs elsewhere         |
| `EDGE_BLOCKING_EXCEPTION`           |  422 |                        No | Unresolved blocker                     |
| `EDGE_STORAGE_OCCUPIED`             |  409 | Yes after operator action | Position unavailable                   |
| `EDGE_PRINTER_UNAVAILABLE`          |  503 |                       Yes | Job remains queued/failed              |
| `EDGE_SCALE_UNSTABLE`               |  422 |                       Yes | Wait for stable reading                |
| `EDGE_FILE_HASH_MISMATCH`           |  422 |            Yes from chunk | File integrity failed                  |
| `EDGE_HUB_READ_ONLY`                |  503 |         No until recovery | Database or disk safety gate           |
| `EDGE_RATE_LIMITED`                 |  429 |                       Yes | Backpressure                           |
| `EDGE_INTERNAL`                     |  500 |         Yes with same key | Unexpected failure; no success claim   |

## 19. Security requirements

- TLS 1.3 preferred; TLS 1.2 only with approved cipher suite.
- Device private keys remain non-exportable.
- Certificate revocation cache must work during WAN outage according to last signed trust snapshot.
- Session tokens are bound to device certificate, terminal profile and Location.
- Request body hash is stored with idempotency record.
- Sensitive values are redacted from logs and WebSocket payloads.
- CORS is disabled except for the packaged Electron origin and explicitly approved local clients.
- CSRF protection applies to browser-based local clients even on the LAN.

## 20. Contract tests

1. Unknown or cloned terminal certificate is rejected.
2. Cross-Location token cannot read or mutate data.
3. Repeated mutation with same key and payload returns identical result.
4. Reused key with changed payload is rejected.
5. T2 cannot call Booking, payment or custody mutation routes.
6. T3 cannot complete pickup; T4 cannot mark production Ready.
7. Hub restart does not lose committed mutation or queued print job.
8. WebSocket replay never exposes another display session.
9. Stale aggregate version causes deterministic conflict response.
10. Mutation success is never returned before PostgreSQL commit.
