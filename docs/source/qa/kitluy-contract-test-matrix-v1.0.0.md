# KitLuy Contract Test Matrix

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Filename   | `kitluy-contract-test-matrix-v1.0.0.md`                              |
| Version    | `v1.0.0`                                                             |
| Date       | `2026-07-26`                                                         |
| Owner      | HET / KitLuy Suite Project Owner                                     |
| Phase      | Phase 1 - Laundry                                                    |
| Status     | Canonical testing and evidence specification; not execution evidence |
| Timezone   | `Asia/Phnom_Penh`                                                    |
| Languages  | Khmer and English                                                    |
| Currencies | KHR and USD                                                          |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.

## 1. Objective

This matrix prevents a service or client from declaring success merely because its own tests pass. Every governed boundary must have provider tests, consumer tests, negative authorization tests, compatibility tests, retry/idempotency tests, observability assertions, and evidence ownership.

## 2. Contract matrix

| Contract surface                      | Producers/consumers                                               | Authentication and scope                                          | Canonical schema                                              | Delivery semantics                                                           | Minimum contract tests                                                                                     |
| ------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Management API                        | Admin, Chain, Partner Portal, internal services                   | Tenant/Digital Store/Location resolution; explicit scopes         | OpenAPI + JSON Schema                                         | Idempotent mutations; cursor pagination; stable errors                       | Provider/consumer validation; auth negatives; scope negatives; pagination; concurrency; deprecation; audit |
| Commerce Store API                    | Storefront, Telegram channel, future first-party commerce clients | Public/session/customer auth with Store scope                     | OpenAPI + JSON Schema                                         | Session/cart/pre-intake/queue retry rules; freshness envelope                | Schema examples; abuse/rate limit; replay; stale pricing; Store isolation; channel projection              |
| Edge Operations API                   | Store Hub, T1-T4, POS Mobile                                      | Device certificate + actor session + Location/profile scope       | OpenAPI/JSON Schema + local protocol schemas                  | Monotonic sequencing; idempotency; offline retry; compatibility window       | LAN and cloud contract; duplicate/reorder; expired cert; role mismatch; config compatibility               |
| Connector API                         | Integration Hub and approved connectors                           | OAuth/service identity; consented scopes; no DB access            | OpenAPI + JSON Schema                                         | Signed callbacks; mapping version; retry/dead-letter; reconciliation         | Scope, consent, signature, replay, projection, rate limit, deletion/revocation                             |
| Domain events                         | Core and vertical services                                        | Producer identity and Tenant/Store/Location context               | Versioned event schema registry                               | Transactional outbox; additive compatibility; replay-safe consumers          | Schema compatibility; atomicity; ordering key; duplicate delivery; replay; retention                       |
| Durable jobs                          | Workers and schedulers                                            | Service identity and queue permission                             | Versioned payload schema                                      | Deduplication; bounded retry; timeout; dead-letter; operator replay          | Payload validation; retry schedule; poison message; cancellation; replay approval                          |
| Webhooks                              | Webhook dispatcher and subscribers                                | HMAC signature and endpoint ownership                             | Versioned webhook envelope                                    | Replay window; retry; delivery status; auto-disable policy                   | Signature; timestamp; duplicate; 429/5xx; endpoint rotation; redaction                                     |
| Read-model truth envelope             | Portals, apps, reports, AI                                        | Same resource authorization as source data                        | source/as_of/freshness/completeness/reconciliation schema     | No silent fallback; explicit partial/stale/unavailable                       | Zero-vs-unavailable; stale threshold; partial aggregation; cache invalidation                              |
| Configuration snapshot                | Cloud configuration and Store Hub                                 | Authorized publisher; target scope; signed version                | Snapshot/manifest JSON Schema                                 | Atomic activation; prior version retained; acknowledgement; rollback         | Signature; partial download; incompatible software; duplicate publish; rollback                            |
| Device identity and provisioning      | Admin, Store Hub, terminals, POS Mobile                           | Enrollment + provisioning code + certificate + hardware-bound key | Certificate claims and provisioning schemas                   | One-time code; expiry; revocation; replacement; no self-role selection       | Cloned image; copied NVMe; wrong scope; replay; revoked device; replacement                                |
| File contract                         | File Service, Spaces, Hub cache, clients                          | Metadata/RLS plus signed access                                   | File metadata, upload session, checksum and retention schemas | Multipart retry; checksum; local pending state; single committed object      | Cross-tenant access; expired link; interrupted upload; duplicate commit; retention                         |
| Notification contract                 | Notification Service and clients                                  | Event and consent scope                                           | Template/input/delivery schemas                               | Provider abstraction; retry; suppression; delivery truth                     | Template validation; consent; provider outage; duplicate event; delivered-vs-queued                        |
| Payment adapter and finance subledger | POS, payment service, provider adapter, reconciliation            | Authorized terminal/user and provider webhook verification        | Tender, attempt, callback, settlement and ledger schemas      | Idempotent payment effects; append-only corrections; explicit reconciliation | Cash, deposit, KHQR pending/success, callback duplicate, refund, variance                                  |
| Offline sync protocol                 | Store Hub and cloud sync services                                 | Certificate + Location + stream authorization                     | Push/pull batch, cursor, ack and conflict schemas             | Per-stream sequencing; bounded batches; retry; quarantine; reconciliation    | Loss, reorder, duplicate, corrupt payload, long backlog, clock skew                                        |
| Audit event contract                  | Every sensitive action producer                                   | Actor/user/device/service; scope and approval context             | Immutable audit schema                                        | Append-only; reason/evidence/approval; correlation IDs                       | Required fields; no secret; failed attempts; four-eyes; retention                                          |

## 3. Required test dimensions

Every contract is tested for valid minimum payload, valid full payload, missing required field, unknown additive field, wrong type, boundary size, invalid enum/state, unauthorized actor, wrong Tenant/Store/Location, revoked credential, stale version, duplicate request, reordered delivery, timeout, retry, partial dependency failure, audit completeness, and redaction.

## 4. Compatibility policy

- Additive optional fields may be introduced within a compatible version.
- Required-field removal, type narrowing, enum removal, semantic reinterpretation, identifier reuse, or changed money/time meaning is breaking.
- Consumers must ignore approved unknown optional fields but must not ignore unknown security-sensitive meaning.
- Breaking changes require a new version, migration plan, dual-run or compatibility period, deprecation evidence, and rollback.
- Store Hub and terminal compatibility is tested across the approved N/N-1 release window; exact window remains governed by the release policy.

## 5. Contract test execution

Provider suites run on every change. Consumer suites run against generated or deployed contract stubs. Staging runs full provider-consumer verification. Release candidates run backward-compatibility and replay corpora. Evidence records contract version, producer/consumer build, schema checksum, environment, result, and incompatibility disposition.

## 6. Gate mapping

- G1: schemas, examples, ownership, compatibility and test design approved.
- G2: provider and consumer tests pass in development.
- G3: deployed integrations, retries, replay, authorization and failure paths pass.
- G4: monitoring, deprecation, rollback and operator replay procedures pass.
- G5: pilot evidence contains the contract versions actually used.
