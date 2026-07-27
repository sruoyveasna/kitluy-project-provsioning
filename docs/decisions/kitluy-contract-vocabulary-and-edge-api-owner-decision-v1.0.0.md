# KitLuy Contract Vocabulary and Edge API Owner Decision

**Filename:** `kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md`
**Decision ID:** `KLD-2026-07-26-002`
**Task:** `KL-DEC-001`
**Version:** `v1.0.0`
**Decision date:** 2026-07-27
**Authority:** KitLuy Project Owner
**Status:** OWNER-APPROVED

## Owner decision

The Project Owner approves Groups 1–5 of the KitLuy Contract Vocabulary and Edge API decision package, subject to the explicit corrections and implementation controls recorded below.

This decision establishes canonical contract vocabulary. It does not, by itself, prove implementation, migration execution, deployment, integration verification, pilot readiness, or production readiness.

---

## Group 1 — Edge Operations API route boundary

**Decision: APPROVED**

The canonical Edge API boundary is:

```text
Generic shared Edge operations:
  /edge/v1/*

Laundry-specific operational commands:
  /edge/v1/laundry/*
```

Approved route decisions include:

```text
POST /edge/v1/sessions/open
POST /edge/v1/sessions/refresh
POST /edge/v1/sessions/switch
POST /edge/v1/sessions/close

POST /edge/v1/laundry/bookings/drafts
POST /edge/v1/laundry/bookings/{id}/confirm-intake

POST /edge/v1/laundry/ready-sessions
POST /edge/v1/laundry/ready-sessions/{id}/scans
POST /edge/v1/laundry/ready-sessions/{id}/qa
POST /edge/v1/laundry/ready-sessions/{id}/exceptions
POST /edge/v1/laundry/ready-sessions/{id}/storage
POST /edge/v1/laundry/ready-sessions/{id}/complete

POST /edge/v1/display-sessions
PATCH /edge/v1/display-sessions/{id}
GET /edge/v1/display-sessions/{id}
POST /edge/v1/display-sessions/{id}/customer-actions
POST /edge/v1/display-sessions/{id}/close

POST /edge/v1/laundry/pickup-sessions
POST /edge/v1/laundry/pickup-sessions/{id}/collector-verification
POST /edge/v1/laundry/pickup-sessions/{id}/scans
POST /edge/v1/laundry/pickup-sessions/{id}/payments
POST /edge/v1/laundry/pickup-sessions/{id}/complete
```

The losing route shapes are `REJECTED-BEFORE-IMPLEMENTATION`.

No compatibility aliases or deprecation period are required because no affected mutation route, deployed client, SDK, or external caller exists.

Approval of Group 1 also authorizes additive registration of all missing generic Edge API scopes required by the approved route catalogue, including session, approval, shift, cash, display, diagnostics, support, printing, peripheral, file, and device-operation scopes.

The scope amendment must preserve the separation between:

```text
API scope
permission
resource scope
environment scope
device/profile authorization
approval policy
```

No API scope alone grants authority.

---

## Group 2 — Terminal-profile identifiers

**Decision: APPROVED**

Canonical logical terminal-profile identifiers are:

```text
laundry.t1.intake_cashier
laundry.t2.customer_display
laundry.t3.ready_scan_in
laundry.t4.pickup_scan_out
```

These identifiers represent permissioned logical workflow profiles.

They do not replace physical device-profile codes such as:

```text
laundry_front_counter
laundry_ready_pickup
laundry_t1_dedicated
laundry_t2_dedicated
laundry_t3_dedicated
laundry_t4_dedicated
```

A logical profile identifier is not, by itself:

- a permission grant;
- a device assignment;
- a resource scope;
- an environment scope;
- an approval;
- a physical hardware profile.

Shared T3/T4 hardware continues to use separate, audited application modes and actor sessions.

The retired identifiers `t2_scan_in` and `t3_scan_out` must never be reused.

Because no affected profile identifier has been deployed, the existing scaffold identifiers may be mechanically renamed in one governed implementation change without runtime aliases.

---

## Group 3 — Permission and authorization vocabulary

**Decision: APPROVED**

The canonical permission grammar is lowercase, dot-separated vocabulary based on the Suite RBAC Permission Registry:

```text
<domain>.<resource_or_capability>.<verb>
```

The existing 107-key registry is the canonical baseline.

Released permission keys are immutable. Unknown or deprecated keys fail closed. Production wildcards are prohibited.

Canonical release permissions include:

```text
releases.promote_internal
releases.promote_pilot
releases.promote_stable
```

The following repository seed mappings are approved:

```text
releases.promote.stable
  -> releases.promote_stable

infrastructure.backup.restore
  -> platform.backup.restore_production
  -> platform.backup.restore_test

security.certificates.rotate
  -> devices.certificate.rotate
```

The Resource Scope Model v1.0.0 taxonomy is canonical.

Approved mappings include:

```text
tenant_or_partner -> tenant
individual_device -> device
```

Approved additive resource-scope types include:

```text
chain
file_object
support_session
release_cohort
```

The following remain separate authorization dimensions:

```text
permission key
API scope
resource scope
environment scope
device/profile authorization
approval policy
```

No identifier may collapse these dimensions into one string or bypass another required authorization check.

---

## Group 4 — Domain-event naming and versioning

**Decision: APPROVED WITH CORRECTION**

Canonical domain-event names are stable semantic facts:

```text
<bounded_context>.<past_tense_fact>
```

The canonical validation pattern is:

```regex
^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$
```

Examples:

```text
digital_store.created
laundry_booking.created
laundry_booking.ready
garment.custody_scanned_in
garment.custody_scanned_out
payment.recorded
payment.refunded
```

Schema versions must be carried only in the envelope:

```json
{
  "event_name": "laundry_booking.created",
  "schema_version": 1
}
```

A `.v1` suffix must not be embedded in the canonical event name.

The canonical wire envelope uses the snake-case fields defined in the Domain Event Registry, including:

```text
event_id
event_name
schema_version
occurred_at
tenant_id
digital_store_id
location_id
aggregate
source
actor
payload
payload_sha256
correlation_id
causation_id
idempotency_key
replay
```

Earlier `.v1` event names are documentation-only reconciliation mappings. No runtime alias layer is required because no affected event has been deployed or published.

---

## Group 5 — API error identifiers

**Decision: APPROVED WITH ADDITIONS**

The API Error Code Registry v1.0.0 is canonical for all four governed API surfaces.

Canonical codes use uppercase `SNAKE_CASE`.

HTTP status is transport classification; client behavior is governed by:

```text
code
retryable
details
message_key
operator_action
correlation_id
```

The mappings in Group 5 are approved, including:

```text
UNAUTHENTICATED
  -> AUTHENTICATION_REQUIRED

PERMISSION_DENIED
ACTOR_PERMISSION_DENIED
  -> SCOPE_PERMISSION_DENIED

NOT_FOUND
  -> RESOURCE_NOT_FOUND

BOOKING_VERSION_CONFLICT
  -> RESOURCE_VERSION_CONFLICT

IDEMPOTENCY_KEY_REUSED
DUPLICATE_IDEMPOTENCY_KEY
  -> IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST

SERVICE_UNAVAILABLE
PAYMENT_PROVIDER_UNAVAILABLE
  -> DEPENDENCY_UNAVAILABLE

STALE_DATA
  -> STALE_OPERATIONAL_DATA
```

The generic `CONFLICT` code is retired. Each call site must emit the applicable specific registered conflict code.

The `EDGE_` prefix convention is rejected for production error identifiers.

The following additive canonical codes are approved for registration:

### `INTERNAL_ERROR`

```text
HTTP: 500
retryable: true with the same idempotency key
message_key: api.error.internal_error
```

The server must never claim success when the authoritative outcome is unknown.

### `SCALE_UNSTABLE`

```text
HTTP: 422
retryable: true after a stable reading is available
message_key: api.error.scale_unstable
```

### `GARMENT_COUNT_MISMATCH`

```text
HTTP: 409
retryable: false for blind automatic replay
message_key: api.error.garment_count_mismatch
```

The operator must resolve or record the exception before Ready or pickup completion.

### `HUB_READ_ONLY`

```text
HTTP: 503
retryable: true
message_key: api.error.hub_read_only
```

Mutations must remain blocked while the Store Hub is in read-only safety mode. The same idempotency key may be retried only after Hub health and write authority recover.

### `PAYMENT_PENDING`

`PAYMENT_PENDING` is an accepted, non-terminal business outcome returned with HTTP `202`.

It must not be represented as a terminal error or authoritative success.

The response must visibly preserve:

```text
payment status: pending
authoritative confirmation: absent
retry or polling guidance
correlation and payment identifiers
```

No client, Store Hub, connector, POS, or API may mark a Booking paid until authoritative confirmation is recorded.

---

## Conflict resolution

Upon recording this decision, the following conflicts may move to `RESOLVED`:

```text
KLREC-2026-07-26-001
KLREC-2026-07-26-002 — API-vocabulary portion only
KLREC-2026-07-26-009
KLREC-2026-07-26-010
KLREC-2026-07-26-011
KLREC-2026-07-26-012 — vocabulary portion only
KLREC-2026-07-26-013
```

The cloud-versus-Hub local custody schema-name difference remains outside this decision and must be handled by its assigned schema reconciliation task.

---

## Implementation authorization

This decision authorizes a governed implementation cycle to:

1. Amend the Edge Operations API and Store Hub LAN API specifications.
2. Add missing API scopes.
3. Rename logical terminal-profile identifiers.
4. Normalize RBAC seed keys and resource-scope types.
5. Update the event-contract package and tests.
6. Regenerate the API error package from the canonical registry.
7. Add the four approved missing error codes.
8. Update contract tests, registries, examples, route inventories and evidence records.
9. Remove fail-closed blocks that exist solely because `KL-DEC-001` was unresolved, after the corresponding implementation and tests pass.

This decision does not authorize:

- production deployment;
- production migration execution;
- weakening RLS, permission, scope, device, environment or approval checks;
- business-route activation without executable tests;
- bypassing Store Hub local authority;
- changing Laundry state-machine semantics;
- implementing speculative later-vertical behavior;
- claiming integration, pilot or production readiness without evidence.

---

## Status effect

After this decision is recorded:

```text
KL-DEC-001: OWNER-APPROVED
KLD-2026-07-26-002: ACTIVE
BLK-003: eligible for implementation closure
```

`BLK-003` must not be marked closed merely because this document is approved.

It closes only after:

- canonical repository identifiers are aligned;
- the approved contract amendments are committed;
- relevant unit and contract tests pass;
- Hub mutation routes fail closed for unauthorized actors;
- RLS and device/profile enforcement remain intact;
- independent review approves the implementation;
- linked evidence is registered.
