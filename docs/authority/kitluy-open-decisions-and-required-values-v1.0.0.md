# KitLuy Open Decisions and Required Values — v1.0.0 (working pointer)

**The canonical register is the owner original:**
[`docs/source/canonical/kitluy-open-decisions-and-required-values-v1.0.0.md`](../source/canonical/kitluy-open-decisions-and-required-values-v1.0.0.md)
(v1.0.0 · 2026-07-26 · HET / Project Owner · CANONICAL OPEN-VALUE REGISTER —
15 open decisions OD-001..015, 730 deduplicated REQ-#### keys, 827-occurrence
ledger, closure-state model OPEN → OPTIONS-PROPOSED → OWNER-APPROVED →
CONFIGURED-*). It is kept as a single immutable copy because of its size
(2.2 MB); this working file adds repository deltas without duplicating it.

## Repository addendum — KL-DOCS-001 (not part of the owner original)

### Staleness note (KLREC-2026-07-26-005)

The owner register's scan predates Rebuild Bible v4.0.0 / Business Bible
v2.0.0 (343 of 827 ledger occurrences cite the superseded ecosystem business
bible v1.0.0; 49 cite rebuild bible v3.0.0). OD-001/OD-002 (publish the v4/v2
bibles) are now satisfiable — both bibles are physically present. A rescan
against the current corpus is a registered follow-up owner task.

### Engineering-milestone blockers (bootstrap register, still open unless noted)

| ID | Required value / decision | State after KL-DOCS-001 |
| --- | --- | --- |
| KLREQ-001 | Supabase schema + RLS + migration plan v1.0.0 | STILL OPEN — pack of 10 ingested, but `kitluy-suite-supabase-schema-v1.0.0.md`, `-rls-and-authorization-`, `-migration-plan-` are missing (each pack member cites them as higher authority) |
| KLREQ-002 | Reconciled `/edge/v1` route contract | STILL OPEN — the fork now exists between two ingested docs (storehub-lan-api vs edge-operations-api); see KLREC-2026-07-26-001 (updated) |
| KLREQ-003 | Laundry Booking + production state machines | **SATISFIED (SPECIFIED)** by `kitluy-laundry-state-machines-v1.0.0.md` + `kitluy-transaction-and-booking-lifecycle-v1.0.0.md` |
| KLREQ-004 | Hub local-schema naming | PARTIALLY RESOLVED — `kitluy-storehub-local-database-schema-v1.0.0.md` defines schema-qualified singular names (edge_laundry.booking_line, custody_event…), a third style; cross-layer naming drift recorded in KLREC-2026-07-26-002 (updated) |
| KLREQ-005 | Feature registry .md/.json | STILL OPEN (CSV only) |
| KLREQ-006 | store-hub managed-device-security lock spec | STILL OPEN (not found) |
| KLREQ-007 (new) | Owner documentation-program instruction (`Pasted text.txt` → kitluy-ai-build-readiness-document-program-v1.0.0.md) | OPEN — file not physically present in the inbox at ingestion |

### Batch-2 additions (KL-DOCS-002)

| ID | Required value / decision | State |
| --- | --- | --- |
| KLREQ-008 | `kitluy-testing-and-evidence-system-v1.0.0` — cited as source_document by 41 of 524 test-registry cases; not physically present anywhere | OPEN — supply or re-source (KLREC-2026-07-26-018) |
| KLREQ-009 | Owner confirmation of the engineering-pack toolchain (`selected_versions`) as the target, and approval of the coordinated upgrade task KL-ENG-001 (Node 24 / pnpm 11 / TS 6 / React 19 / RN 0.86+Expo 57 / Electron 43 / tool-versions.json / tsconfig flags) | OPEN (KLREC-2026-07-26-014/-019) |
| KLREQ-010 | AI Swarm Operating System adoption decision: replace repo-root governance + handoff system with the pack, map handoff/evidence vocabularies onto the 11-status model, migrate existing handoff records | OPEN (KLREC-2026-07-26-015/-020) |
| KLREQ-011 | Canonical security test plan selection/merge (batch-1 phase1 plan vs batch-2 plan, incompatible ID namespaces) | OPEN (KLREC-2026-07-26-017) |

### Cycle-6 additions (WS-07/WS-08 execution, 2026-07-27)

| ID        | Required value / decision                                                                                                                                                                                                                                                                       | State                                                                                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KLREQ-012 | Data Dictionary Amendment-002 (customer identity + consent; the ten Cycle-5 entities absent from DD v1.0.0 per conflict C2)                                                                                                                                                                       | DECISION-READY — authored 2026-07-27 at `docs/data/kitluy-suite-supabase-data-dictionary-amendment-002-customer-identity-and-consent-v1.0.0.md`; OPEN pending independent schema review AND owner approval        |
| KLREQ-013 | Data Dictionary amendment for Cycle-6 additions recorded in reconciliation C12: `kitluy_laundry.booking_production_state`, `kitluy_payments.payment_status_history`, additive columns on DD relations (orders version/payment_state/deposit input, garment unit_kind, tender applied/change) and the weight-quantity representation (integer grams vs DD `numeric(18,4)` convention) | OPEN — Amendment-003 candidate; implemented-and-tested schema is the implementation truth, dictionary update owed (C2/C12 precedent)                                                                              |
| KLREQ-014 | RBAC registry amendment: neutral transaction-read permission key (kitluy_orders SELECT is store-scope-only interim) and finance-read permission key (kitluy_finance SELECT is tenant-scope-only interim)                                                                                          | OPEN — C4 precedent; interim strictest scopes encoded in migration group 0095                                                                                                                                    |

### Cycle-7 additions (KL-DEC-001 contract alignment, 2026-07-27)

| ID        | Required value / decision                                                                                                                                                                                                                                                        | State                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KLREQ-015 | Actor-permission keys for nine approved Edge routes absent from the 107-key RBAC registry: Edge session open/refresh/switch/close; T2 display-session open/update/close from T1; T2 self-read; T2 customer-action consent evidence (reconciliation C22)                            | OPEN — routes fail closed with `[REQUIRED: …]` markers; registration needs `rbac.permission_registry_manage` (A4_OWNER_SECURITY) with impact assessment    |
| KLREQ-016 | Domain Event Registry registration for the 17 `proposed` Edge audit-event names (`edge_session.*`, `display_session.*`, `laundry_ready_session.*`, `laundry_pickup_session.*`, `laundry_booking.completed`) — reconciliation C24                                                  | OPEN — must be registered before any release publishes these events                                                                                       |
| KLREQ-017 | Owner ruling on the permission-grammar segment count: Group 3 states three segments but 60 of the 107 canonical keys have two (reconciliation C19). Either the grammar sentence or 60 registry rows must move                                                                     | OPEN — implemented as 2-or-3 segments with registry membership as the authoritative gate                                                                   |
| KLREQ-018 | Documentation amendments owed by the approved decision: Domain Event Registry envelope `aggregate` shape and name pattern (C14/C15), Store Hub LAN API `EDGE_*` error table (C16), RBAC CSV audit-event vocabulary (C23), API Error Code Registry rows for the four additive codes | OPEN — code implements the owner decision; the supporting contract documents still carry the superseded forms                                              |
| KLREQ-019 | Owner ruling on neutral-Core boundary for vertical contract data (`/edge/v1/laundry/*` routes and Laundry RBAC key strings inside `packages/`) — reconciliation C20/C25                                                                                                          | OPEN — currently quarantined as inert contract data with no runtime dependency on the vertical                                                             |

### Cycle-8 additions (WS-09 Store Hub local persistence, 2026-07-27)

Recorded by the WS-09-T001 reconciliation record
`docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md` (§5).

| ID        | Required value / decision                                                                                                                                                                                                                                                                    | State                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| KLREQ-020 | Idempotency-key format conflict: the canonical offline contract §2 specifies the terminal-issued `kl1.{terminal_device_uuid}.{client_sequence}`, but shipped `@kitluy/sync-protocol` produces `location:{location_id}:hub:{hub_id}:seq:{n}` while mis-citing "Hub §8.5, verbatim" as its source | OPEN — the canonical contract governs and the Hub ledger implements `kl1.*`. Correcting `@kitluy/sync-protocol` is a coordinated change (its format is asserted by the hub-agent offline harness) |
| KLREQ-021 | Four sync-state vocabularies coexist: `edge_sync.delivery_state` (persisted), the Phase-1 spec Hub-level `sync_state`, the wire literal `pending_cloud_sync`, and `OutboxItemState` in code                                                                                                   | OPEN — persisted state uses the canonical enum, the wire keeps `pending_cloud_sync`, and the Hub-level enum describes the Hub rather than a row. `OutboxItemState` is non-canonical |
| KLREQ-022 | The instruction requires local finance journals, but the canonical Hub-local schema document defines NO `edge_finance` schema. Implementing one would create a second ledger, which KLD-FIN-002 forbids                                                                                        | OPEN — owner ruling required. This cycle keeps finance posting CLOUD-authoritative; the Hub records the payment and cash events finance derives from and carries them in the outbox  |
| KLREQ-023 | Amendments owed to the canonical Hub-local schema document: the missing `refunded_minor` column referenced by its own balance CHECK; the sequence-gap ledger and command-result ledger required by the sequencing contract but absent from the catalogue; `assignment_generation` on `local_event`/`outbox` despite being part of the declared ordering namespace | OPEN — implemented additively by WS-09 and documented as extensions                                                                                                                |

Staleness correction (Cycle-5/6): the KLREQ-001 row above predates BLK-001
closure — the schema/RLS/migration-plan trio now exists under `docs/data/` and
is CONTRACT-APPROVED (see the decision register); the row is retained verbatim
as bootstrap history only.

### Repository-level required values (bootstrap section F, unchanged)

Legal entity for LICENSE · security contact (SECURITY.md) · conduct contact ·
GitHub organization/handles · canonical ID format · minimum API deprecation
window · approved brand tokens / Khmer font strategy (provisional values now
exist in `kitluy-design-token-registry-v1.0.0.json`) · dependency-audit
triage policy.
