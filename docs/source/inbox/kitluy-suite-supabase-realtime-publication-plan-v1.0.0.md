# KitLuy Suite Supabase Realtime Publication Plan

**Filename:** `kitluy-suite-supabase-realtime-publication-plan-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical target Realtime plan; not implementation evidence

> **Mission:** Use Supabase Realtime only for bounded, role-safe change notification and operational fan-out, without turning WAL payloads into an uncontrolled data API or weakening Store Hub offline authority.

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

## Principles

1. Store Hub remains local operational authority after provisioning; cloud Realtime failure must not stop T1–T4 local operation.
2. Realtime signals change; clients fetch/receive authorized canonical data through approved views/RPCs when payload exposure would be unsafe.
3. Publish the minimum tables/columns. Finance, payment, audit, authorization, raw provider payload and private file metadata are not broadly published.
4. Every subscription is Tenant/Digital Store/Location scoped and tied to an authenticated user/device assignment.
5. Presence is ephemeral and never authoritative for attendance, cash shift, custody or device health.

## Publication sets

| Publication                        | Included relations                                                                               | Consumers                | Notes                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------- |
| `kitluy_realtime_store_ops_v1`     | safe Booking status projection, queue tickets/events, Ready storage projection, print-job status | T1–T4, Partner App       | Projection tables/views preferred over raw ledgers. |
| `kitluy_realtime_partner_v1`       | partner dashboard snapshot/version, action items, notification-safe job state                    | Partner Portal/App       | Includes `data_as_of` and freshness.                |
| `kitluy_realtime_chain_v1`         | chain action items, publication target status, compliance/corrective action state                | Chain Portal             | Chain/Location scope enforced.                      |
| `kitluy_realtime_fleet_v1`         | device health snapshot, rollout installation state                                               | Admin/authorized Partner | No certificate/private identity material.           |
| `kitluy_realtime_storefront_v1`    | public queue/status projection and publication status                                            | Public Storefront        | Public-safe projection only; no customer PII.       |
| `kitluy_realtime_notifications_v1` | user-specific notification delivery summary                                                      | Authenticated user       | Topic/user scoped.                                  |

## Explicitly excluded from direct publication

- `kitluy_payments.*` ledgers and provider payloads;
- `kitluy_inventory.stock_movements` raw movement ledger;
- `kitluy_auth.*` assignments, scopes, tokens and decisions;
- `kitluy_audit.*`;
- raw `kitluy_events.domain_events` for browser clients;
- `kitluy_files.upload_sessions`, grants and object keys;
- `kitluy_integrations.webhook_events` payloads;
- AI prompts, retrieved content and tool inputs/outputs;
- any table containing secrets or credential references.

## Topic naming

Use private Broadcast/Presence topics where Postgres Changes filtering is insufficient:

```text
store:{digital_store_id}
location:{store_location_id}
booking:{order_id}
queue:{store_location_id}:{business_date}
partner:{tenant_id}:{digital_store_id}
chain:{chain_id}
fleet:{store_location_id}
user:{user_id}
public-storefront:{publication_id}
```

Clients must not choose arbitrary scope IDs; the server issues authorized topic claims or validates membership on channel join.

## Payload contract

- Maximum recommended payload: 16 KB; hard maximum `[REQUIRED: load-tested value]`.
- Include: event/projection type, schema version, resource ID, scope IDs, version, `data_as_of`, freshness and correlation/request ID.
- Exclude: full customer contact, free-text sensitive notes, payment provider payload, file object key, secrets and unrestricted JSON blobs.
- Large changes send an invalidation/version notice and require an authorized fetch.

Example:

```json
{
  "type": "booking.status.changed",
  "schema_version": 1,
  "tenant_id": "uuid",
  "digital_store_id": "uuid",
  "store_location_id": "uuid",
  "booking_id": "uuid",
  "status": "READY",
  "version": 18,
  "data_as_of": "2026-07-26T03:10:00Z"
}
```

## Security

- Private channels only except explicitly public Storefront projection.
- RLS remains enabled on publication source tables.
- Realtime authorization checks user/device assignment, scope, environment and session validity.
- Revocation/role change terminates or expires channel authorization quickly.
- Device topics require active non-revoked certificate/assignment.
- Public queue display uses opaque public ticket references, never phone/name unless separately approved and consented.

## Ordering, replay and recovery

Realtime is not a durable queue. Every payload carries version/cursor. On gap, reconnect or stale cache, client fetches a canonical snapshot/delta. Store Hub sync uses `kitluy_sync` protocols, not Realtime as the authoritative transport.

## Capacity and backpressure

- Per-client and per-topic subscription limits are versioned configuration.
- No one-row-per-heartbeat WAL fan-out to broad audiences; health is aggregated into snapshots.
- High-frequency device telemetry goes through bounded ingestion/worker paths.
- Slow consumers receive invalidation rather than unbounded backlog.
- Load test fan-out, reconnect storms and Location outage scenarios before Pilot.

## Acceptance criteria

1. Publication migration explicitly lists tables; no `FOR ALL TABLES`.
2. Unauthorized cross-Tenant/Store/Location subscription tests fail.
3. Payloads satisfy size and sensitivity checks.
4. Clients recover from gaps using versioned snapshots.
5. Cloud Realtime outage does not break local T1–T4 operation.
6. Publication changes are migration-reviewed and documented in generated schema evidence.
