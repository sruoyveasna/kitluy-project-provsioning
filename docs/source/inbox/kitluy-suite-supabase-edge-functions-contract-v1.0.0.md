# KitLuy Suite Supabase Edge Functions Contract

**Filename:** `kitluy-suite-supabase-edge-functions-contract-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target Edge Function/API contract; not implementation evidence

> **Mission:** Define secure, versioned and auditable Supabase Edge Functions for public/client orchestration while keeping authoritative mutations in reviewed database RPCs and durable workers.

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

## Boundary

Edge Functions may authenticate, validate JSON, enforce rate limits, call approved RPCs, verify provider signatures, issue short-lived upload/download grants and enqueue durable jobs. They must not become an alternative schema, bypass RLS/authorization, hold long-running jobs, store file bytes, or directly expose service-role database access to clients.

## Common request contract

Required headers where applicable:

- `Authorization: Bearer <JWT>` or device/service mTLS/gateway assertion;
- `Idempotency-Key` for every mutation;
- `X-KitLuy-Request-Id` optional client value, otherwise generated;
- `X-KitLuy-Client-Version`;
- `X-KitLuy-Contract-Version`;
- `Content-Type: application/json`;
- provider signature/timestamp headers for webhooks.

Body size defaults to 256 KB unless a function has a lower approved limit. Files use Spaces upload sessions, never Edge Function body upload for normal operation.

## Common response envelope

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": {
    "request_id": "uuid",
    "contract_version": "v1",
    "server_time": "2026-07-26T00:00:00Z",
    "idempotency_replayed": false
  }
}
```

Error:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "KLUY-STATE-001",
    "message": "Localized safe message",
    "details": {},
    "retryable": false
  },
  "meta": { "request_id": "uuid", "contract_version": "v1" }
}
```

Never return SQL, stack traces, secret/provider payloads or unauthorized identifiers.

## Auth classes

| Class                    | Proof                                                      | Typical functions                                  |
| ------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| Public anonymous         | signed public session/entry token + rate limit             | Storefront publication, QR entry, phone challenge. |
| Authenticated customer   | Supabase JWT/customer session                              | Pre-Intake, queue status, confirmations.           |
| Partner/Chain/Admin user | Supabase JWT + DB authorization                            | Management operations.                             |
| Store device             | device certificate assertion + signed request + assignment | Hub sync, provisioning, health.                    |
| Provider webhook         | raw-body signature + replay window + provider event ID     | KHQR/payment/notification callbacks.               |
| Internal service         | service identity assertion                                 | jobs, callbacks, controlled maintenance.           |

## Function inventory

| Function slug                       | Auth                         | Purpose                                                           | Primary RPC/job                  |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------------------- | -------------------------------- |
| `v1-storefront-session`             | public                       | Resolve entry point and issue short-lived public session.         | query + session RPC              |
| `v1-phone-challenge-start`          | public/rate-limited          | Start phone verification.                                         | notification job                 |
| `v1-phone-challenge-verify`         | public                       | Verify challenge and link customer session.                       | customer RPC                     |
| `v1-pre-intake-upsert`              | customer                     | Create/update draft.                                              | Storefront RPC                   |
| `v1-pre-intake-submit`              | customer                     | Freeze submitted version.                                         | Storefront RPC                   |
| `v1-queue-join`                     | customer                     | Join T1 queue.                                                    | queue RPC                        |
| `v1-queue-status`                   | customer                     | Read public-safe ticket state.                                    | security-barrier query           |
| `v1-intake-convert`                 | T1 staff                     | Verify/convert to Booking.                                        | verification + Booking RPC       |
| `v1-bookings-command`               | authorized user/device       | Create/transition Booking commands.                               | Orders/Laundry RPC               |
| `v1-payments-khqr-create`           | T1/customer approved flow    | Create KHQR intent.                                               | payment RPC/provider adapter job |
| `v1-payments-webhook-khqr`          | provider                     | Verify raw signature and process event once.                      | provider-event RPC/job           |
| `v1-files-upload-start`             | authorized                   | Create metadata/upload grant.                                     | file RPC                         |
| `v1-files-upload-complete`          | authorized/provider callback | Verify checksum/object and queue processing.                      | file RPC/job                     |
| `v1-files-download-grant`           | authorized                   | Issue short-lived download grant.                                 | file RPC                         |
| `v1-device-provision-start`         | HET/installer                | Begin approved device provisioning.                               | device RPC                       |
| `v1-device-provision-activate`      | device                       | Activate certificate/assignment.                                  | device RPC                       |
| `v1-sync-push`                      | device                       | Push event batch.                                                 | sync RPC                         |
| `v1-sync-pull`                      | device                       | Pull scoped changes/cursors.                                      | sync RPC                         |
| `v1-device-heartbeat`               | device                       | Record health with size/rate controls.                            | heartbeat insert/RPC             |
| `v1-approval-request`               | authorized                   | Request sensitive action approval.                                | auth RPC                         |
| `v1-approval-decide`                | approver                     | Decide request.                                                   | auth RPC                         |
| `v1-release-rollout`                | internal authorized          | Start/pause/rollback rollout.                                     | release RPC/job                  |
| `v1-support-session`                | support + consent            | Start/end consent-scoped support access.                          | admin RPC                        |
| `v1-connector-webhook-{provider}`   | provider                     | Verify, dedupe and quarantine/process connector events.           | integration RPC/job              |
| `v1-notification-provider-callback` | provider                     | Delivery state callback.                                          | notification RPC/job             |
| `v1-ai-gateway`                     | authorized                   | Permission-scoped AI request; sensitive tool calls need approval. | AI service/job/RPC               |

## Idempotency contract

- Scope: actor/service/device + function slug + target Tenant/Digital Store/Location.
- Store `idempotency_key`, canonical request hash, state, result reference and expiry.
- Same key/same hash returns original result with `idempotency_replayed=true`.
- Same key/different hash returns `409 KLUY-IDEMP-002`.
- Provider webhooks dedupe on provider key + provider event ID and signature evidence.

## Audit and observability

Every invocation records request ID, function/version, auth class, actor/service/device, target scope, result code, latency, payload size, rate-limit result and RPC/job reference. Sensitive payloads are hashed/redacted. Logs are not authoritative audit; sensitive successful/failed actions also write `kitluy_audit.audit_logs` through approved RPCs.

## Error and retry semantics

|    HTTP | Meaning                                                                                                      |
| ------: | ------------------------------------------------------------------------------------------------------------ |
| 200/201 | Success or idempotent replay.                                                                                |
|     202 | Durable job accepted; not completed.                                                                         |
|     400 | Schema/validation error.                                                                                     |
|     401 | Authentication failed.                                                                                       |
|     403 | Authenticated but unauthorized.                                                                              |
|     404 | Safe not-found within authorized scope.                                                                      |
|     409 | Idempotency/state/version conflict.                                                                          |
|     422 | Valid request but business invariant failed.                                                                 |
|     429 | Rate limited; include safe retry hint.                                                                       |
|     503 | Dependency unavailable; only return retryable when operation did not commit or idempotency makes retry safe. |

## Deployment/security requirements

- Separate dev/staging/prod projects and secrets.
- Deny wildcard CORS; public Storefront origins are explicit and versioned.
- Validate JWT issuer/audience and reject expired/weak sessions.
- Service-role access only inside function runtime; never forwarded.
- Webhook raw body captured before JSON parsing for signature verification.
- Egress allowlist for provider endpoints where supported.
- Function deployments are immutable, signed/traceable to Git SHA and contract version.

## Acceptance criteria

1. OpenAPI/JSON Schema exists for every function and is contract-tested.
2. Auth, idempotency, rate-limit, audit and safe-error tests pass.
3. No function stores file bytes in Supabase Storage or long-running work in request lifetime.
4. Provider replay/invalid-signature tests pass.
5. Every function maps to an approved RPC/query/job and has an owner/runbook.
