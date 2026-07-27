# KitLuy Store Hub Local Schema Reconciliation

**Filename:** `kitluy-storehub-local-schema-reconciliation-v1.0.0.md`
**Version:** v1.0.0
**Date:** 2026-07-27
**Task:** WS-09-T001
**Owner:** HET / KitLuy Suite Project Owner
**Status:** DECISION-READY reconciliation record — storage/schema mapping only. NOT implementation evidence (KLD-EVIDENCE-001)
**Authority:** `docs/source/offline/kitluy-storehub-local-database-schema-v1.0.0.md` (canonical Hub-local DDL contract); `kitluy-offline-idempotency-and-sequencing-v1.0.0.md`; `kitluy-edge-sync-protocol-v1.0.0.md`; `kitluy-sync-conflict-resolution-policy-v1.0.0.md`; KLREC-2026-07-26-002 (schema portion, OPEN and assigned here)

> **Scope fence.** This record maps STORAGE and SCHEMA identifiers between the
> cloud authoritative database and the Store Hub local database. It changes no
> business vocabulary, no event vocabulary and no API vocabulary. Those are
> settled by KLD-2026-07-26-002 and are out of scope here.

## 1. Naming convention decision (closes the KLREC-2026-07-26-002 schema portion)

| Layer     | Convention   | Example                   |
| --------- | ------------ | ------------------------- |
| Cloud     | **plural**   | `kitluy_laundry.garments` |
| Hub-local | **singular** | `edge_laundry.garment`    |

**Decision: each layer keeps its own convention; neither is changed.**

Rationale, recorded rather than assumed:

1. Singular is **systematic, not isolated** — all 38 relations in the canonical
   Hub-local schema document are singular, with zero exceptions across ten
   schemas. Plural is equally systematic on the cloud side.
2. Both conventions are already embodied in applied/authored artifacts. The
   cloud side is applied in migrations 0010–0100; the Hub side is the canonical
   target contract for a physically separate database on a different device.
3. They are **different databases on different machines**, so there is no
   in-database collision and no query that spans both. The mapping is resolved
   at the sync boundary, not in SQL.
4. Changing either would invalidate applied migrations or contradict a
   canonical contract without owner authority.

**Recorded caveat:** the Hub-local schema document states no rationale for
singular — the convention is implicit. This record makes it explicit and
binding for the Hub-local database. Any future Hub relation MUST be singular.

## 2. Relation mapping (cloud ↔ Hub-local)

Only relations with a genuine counterpart are mapped. Absence in either
direction is stated, not silently ignored.

| Cloud relation                             | Hub-local relation                                                                                          | Notes                                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kitluy_orders.orders`                     | `edge_laundry.booking`                                                                                      | Cloud is vertical-neutral (`kitluy_orders`); Hub places the Booking in the vertical schema                                                                            |
| `kitluy_orders.order_lines`                | `edge_laundry.booking_line`                                                                                 | Both immutable after confirmation                                                                                                                                     |
| `kitluy_orders.order_events`               | `edge_laundry.status_event`                                                                                 | Both append-only lifecycle history                                                                                                                                    |
| `kitluy_laundry.garments`                  | `edge_laundry.garment` + `edge_laundry.bag`                                                                 | Cloud uses one relation with `unit_kind`; Hub splits garment and bag. Mapping is by `unit_kind`                                                                       |
| `kitluy_laundry.laundry_tags`              | `edge_laundry.tag`                                                                                          |                                                                                                                                                                       |
| `kitluy_laundry.garment_scan_events`       | `edge_laundry.custody_event`                                                                                | Both append-only custody chain                                                                                                                                        |
| `kitluy_laundry.garment_exceptions`        | `edge_laundry.exception`                                                                                    |                                                                                                                                                                       |
| `kitluy_laundry.ready_storage_positions`   | `edge_laundry.storage_position`                                                                             |                                                                                                                                                                       |
| `kitluy_laundry.ready_storage_assignments` | `edge_laundry.storage_assignment`                                                                           |                                                                                                                                                                       |
| `kitluy_laundry.pickup_handoffs`           | `edge_laundry.pickup_session`                                                                               | Hub models the session; cloud models the completed handoff record                                                                                                     |
| (no cloud counterpart)                     | `edge_laundry.ready_scan_session`                                                                           | Hub-only working session; its OUTCOME syncs as custody events                                                                                                         |
| `kitluy_laundry.booking_production_state`  | projection on `edge_laundry.booking.status`                                                                 | Hub keeps the projection on the Booking row                                                                                                                           |
| `kitluy_payments.tenders`                  | `edge_payments.payment`                                                                                     |                                                                                                                                                                       |
| `kitluy_payments.payment_attempts`         | `edge_payments.payment_attempt`                                                                             |                                                                                                                                                                       |
| `kitluy_payments.refunds` + `voids`        | `edge_payments.refund_adjustment`                                                                           | Hub merges both into one compensating-adjustment relation with `adjustment_type`                                                                                      |
| (no Hub counterpart this cycle)            | —                                                                                                           | `khqr_transactions`, `payment_provider_events`, `settlement_refs`, `payment_reconciliations*` stay CLOUD-ONLY: provider and settlement truth is not Hub-authoritative |
| `kitluy_finance.*` (6 relations)           | (no Hub counterpart this cycle)                                                                             | **Recorded gap** — see §5                                                                                                                                             |
| `kitluy_core.customers`                    | `edge_core.customer`                                                                                        | Hub holds a cache/projection; identity truth is cloud                                                                                                                 |
| `kitluy_core.customer_contacts`            | `edge_core.customer_identifier`                                                                             | Hub stores hashed + masked values only                                                                                                                                |
| `kitluy_audit.audit_logs`                  | `edge_audit.audit_event`                                                                                    | Both immutable                                                                                                                                                        |
| `kitluy_config.configuration_versions`     | `edge_config.configuration_snapshot`                                                                        | Hub snapshots are signed and immutable                                                                                                                                |
| (cloud has none)                           | `edge_identity.*` (7), `edge_sync.*` (6), `edge_documents.*` (3), `edge_files.*` (3), `edge_hardware.*` (2) | Hub-only device, sync, print, file and hardware concerns                                                                                                              |

Per-relation field contracts (identifier type, scope columns, money
representation, aggregate version, append-only behavior, sync ownership,
conflict-policy owner, retention owner) follow the canonical Hub-local schema
document §1/§6/§10 unchanged and are not restated here.

## 3. Binding conventions carried from the canonical Hub contract

| Concern     | Hub-local contract                                                             | Cloud comparison                                                |
| ----------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Engine      | PostgreSQL 16 (dev may run 15.x — recorded deviation, see §5)                  | PostgreSQL 15 (Supabase local)                                  |
| Identifiers | Application-generated UUIDv7, column type `uuid`                               | `gen_random_uuid()` (v4) server-side                            |
| Money       | `amount_minor bigint` + `currency_code char(3)` + `currency_exponent smallint` | `*_minor bigint` + `currency_code char(3)` (no exponent column) |
| Quantities  | `numeric(18,4)`                                                                | integer grams / integral counts (recorded as C12)               |
| Hashes      | lowercase hex SHA-256 `char(64)`                                               | same                                                            |
| Scope       | every business row carries `tenant_id`, `digital_store_id`, `location_id`      | tenant + store, location where applicable                       |
| Append-only | finance, payment, custody, audit                                               | same (enforced by triggers)                                     |
| Access      | only Hub-agent database roles; POS terminals hold no database credentials      | service_role + RLS for clients                                  |

## 4. Conflicts resolved by this record

| ID  | Conflict                                                                                            | Resolution                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Cloud plural vs Hub-local singular relation names (KLREC-2026-07-26-002 schema portion)             | Each layer keeps its convention; §2 is the binding mapping. Hub-local singular is now explicit and binding                                                              |
| R2  | Cloud `kitluy_laundry.garments.unit_kind` (one relation) vs Hub `garment` + `bag` (two relations)   | Mapping is by `unit_kind`: `GARMENT_ITEM`/`GARMENT_GROUP` → `edge_laundry.garment`; `CUSTODY_CONTAINER` → `edge_laundry.bag`                                            |
| R3  | Cloud neutral `kitluy_orders.orders` vs Hub vertical `edge_laundry.booking`                         | Accepted asymmetry: the Hub is a single-vertical appliance, so its Booking lives in the vertical schema. Neutral Core rule still forbids vertical tables in `edge_core` |
| R4  | Hub `refunded_minor` appears in the `edge_laundry.booking` balance CHECK but not in its column list | The column IS required — the Hub DDL adds `refunded_minor bigint not null default 0`. Recorded as a defect in the canonical document (amendment owed)                   |

## 5. Recorded gaps and deviations — NOT silently resolved

| ID  | Item                                                                                                                                                                                                                                                                                                           | Disposition                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | **Idempotency key format conflict.** Canonical offline contract §2: `kl1.{terminal_device_uuid}.{client_sequence}` (terminal-issued, one business intent). Shipped `@kitluy/sync-protocol` produces `location:{location_id}:hub:{hub_id}:seq:{n}` and its comment mis-cites "Hub §8.5, verbatim" as the source | The CANONICAL contract governs. The Hub ledger implements `kl1.*`. `@kitluy/sync-protocol` is non-canonical and its correction is owed — it is consumed by the hub-agent offline harness, so the change is coordinated, not incidental. Tracked **KLREQ-020**                                |
| G2  | **Four competing sync-state vocabularies**: `edge_sync.delivery_state` enum (persisted), Phase-1 spec `sync_state` enum (Hub-level), the wire literal `pending_cloud_sync` (LAN API + Edge Ops), and `OutboxItemState` in code                                                                                 | Persisted delivery state uses the canonical `edge_sync.delivery_state` enum; the API wire value stays `pending_cloud_sync`. The Hub-level `sync_state` enum describes the HUB, not a row — different subject, no conflict. `OutboxItemState` in code is non-canonical. Tracked **KLREQ-021** |
| G3  | **Relations required by the sequencing contract but absent from the schema catalogue**: the "local sequence-gap ledger" (§5) and an idempotency/command-result ledger (§4 "store immutable command result")                                                                                                    | Added additively as `edge_sync.sequence_gap` and `edge_sync.command_result`, documented as additive extensions. Amendment to the canonical document owed                                                                                                                                     |
| G4  | **`assignment_generation` missing** from `edge_sync.local_event` and `edge_sync.outbox`, although §5.1 declares the ordering namespace to be `(location_id, assignment_generation, hub_sequence)`                                                                                                              | Added additively to both relations. Without it, replacement-Hub sequence isolation is impossible. Amendment owed                                                                                                                                                                             |
| G5  | **A fifth relation-naming vocabulary** appears in the master build plan (`local_events`, `local_outbox`, `sync_cursors`, `idempotency_records`, `terminal_sessions`, `device_clients`, `print_jobs`, `file_cache_entries`, `configuration_snapshots`)                                                          | The canonical Hub-local schema document governs (`edge_sync.local_event`, `edge_sync.outbox`, …). The build-plan list is planning shorthand, not a contract                                                                                                                                  |
| G6  | **No Hub-local migration tooling exists.** One migration directory exists repo-wide (`supabase/migrations`); both validators hardcode it and cross-check `kitluy_*` schemas against the cloud dictionary. The Hub contract's `NNNN_name.sql` convention is incompatible with `db-validate.mjs`                 | WS-09 must BUILD Hub migration tooling first: a separate directory, a Hub-aware validator, a checksum registry and a runner. The Hub adopts the canonical `NNNN_name.sql` convention from its own contract; the cloud validator is left untouched                                            |
| G7  | **PostgreSQL 16 target vs 15.8 development instance.** The Hub contract targets PG16 on ARM64                                                                                                                                                                                                                  | Development executes on the available 15.x instance. No PG16-only feature is used. Recorded as a truth-labelled deviation — production Hub imaging remains PG16                                                                                                                              |
| G8  | **No Hub finance schema in the canonical catalogue.** The instruction requires local finance journals, but the Hub-local schema document defines no `edge_finance` schema                                                                                                                                      | Finance posting stays CLOUD-authoritative this cycle. The Hub records the payment/cash events that finance derives from, and the outbox carries them. Implementing a Hub-side journal would create a second ledger, which KLD-FIN-002 forbids. Tracked **KLREQ-022** for owner ruling        |

## 6. Acceptance criteria

1. Hub-local DDL matches §2/§3 and the canonical schema document.
2. Every relation created carries the scope columns required by §1 of the canonical contract unless device-global.
3. The additive extensions in G3/G4 are present and documented as extensions.
4. No cloud migration is modified by WS-09.
5. Conflicts G1–G8 are registered before implementation, and none is silently resolved.

## Version history

| Version | Date       | Change                               |
| ------- | ---------- | ------------------------------------ |
| v1.0.0  | 2026-07-27 | Initial record (WS-09-T001), Cycle 8 |
