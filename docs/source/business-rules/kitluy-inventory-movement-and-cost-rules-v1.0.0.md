# KitLuy Inventory Movement and Cost Rules

**Filename:** `kitluy-inventory-movement-and-cost-rules-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines movement truth, balances, reservations, Laundry consumable usage, counts, transfers, costing and negative-inventory controls.

**Scope boundary:** Neutral inventory and capacity foundation, with Phase 1 Laundry consumables as the active vertical use. Later lot/expiry/FEFO rules are additive vertical deltas.

## 1. Governing principles

1. Current owner decisions and the active KitLuy Project Instructions override older planning.
2. Applied migrations, verified code/tests, deployment records and production evidence override target-state prose for implementation truth.
3. A Partner Account owns one or more Digital Stores; each Digital Store has exactly one primary vertical. Physical Store Locations are optional offline-capable edge environments.
4. Finalized transaction, payment, inventory, finance and audit records are append-only. Corrections use linked compensating records; destructive edits are prohibited.
5. Authoritative business data uses relational tables. JSON is limited to optional metadata and transport envelopes.
6. Every write is tenant-, Digital-Store-, Location-, actor- and device-scoped; versioned, idempotent, retry-safe and auditable.
7. The Store Hub is the local operational authority after provisioning. WAN failure must not stop approved local operations.
8. External channels and connectors never own KitLuy customer, inventory, payment, finance or audit truth.
9. Sensitive financial, permission, compliance or safety actions require authorized human confirmation and, where policy requires, four-eyes approval.
10. Khmer and English, KHR and USD, Asia/Phnom_Penh, KHQR and intermittent connectivity are first-class requirements.
11. Missing, stale, partial, estimated or unreconciled data must be labeled; it must never be presented as authoritative current truth.
12. No capability is `IMPLEMENTED` without repository, applied migration, test, deployment and required pilot/production evidence.

## 2. Canonical data conventions

| Concern        | Canonical rule                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| IDs            | UUID; offline-created aggregates use client-generated UUIDv7 when available.                                         |
| Idempotency    | Caller supplies a stable idempotency key. Replays return the original business result without duplicating effects.   |
| Money          | `amount_minor bigint` plus ISO-4217 currency code. KHR exponent is 0; USD exponent is 2. No floating-point money.    |
| Quantities     | `numeric(18,4)` plus unit-of-measure; weight and piece quantities are never silently interchanged.                   |
| Time           | Store UTC `timestamptz`; render in `Asia/Phnom_Penh`. Operational grouping uses explicit Location business date.     |
| Scope          | Every authoritative record resolves Tenant, Digital Store and, when physical, Store Location.                        |
| Truth envelope | Reads expose source, as-of time, completeness, sync freshness and reconciliation status.                             |
| Corrections    | Reverse or adjust with linked compensating entries; preserve the original.                                           |
| Audit          | Actor, role, device, source, reason, correlation ID, before/after references and approval evidence where applicable. |
| Offline        | Store Hub accepts only locally authorized operations and queues immutable outbox events for cloud synchronization.   |

## 3. Rule catalogue

### KBR-INV-001 — Movement ledger is inventory truth

| Required field            | Canonical specification                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-001                                                                                                                                                     |
| Purpose                   | Derive inventory from append-only movements rather than editable on-hand fields.                                                                                |
| Inputs                    | Item/location/lot; movement type; quantity/UOM; source document; actor/device; idempotency key.                                                                 |
| Preconditions             | Item active; UOM compatible; Location scoped; movement type/reason allowed.                                                                                     |
| Calculation or transition | Post signed quantity delta and immutable source reference. On-hand is the sum of posted movements at a cutoff, optionally accelerated by rebuildable snapshots. |
| Output                    | Movement ID, resulting projection version and audit/outbox event.                                                                                               |
| Permissions               | Operational movement permission by type; adjustments/count corrections require elevated permission.                                                             |
| Audit event               | inventory.movement_posted.                                                                                                                                      |
| Offline behavior          | Hub posts physical Location movements locally and syncs events. Cloud deduplicates and rebuilds projection; generic LWW is prohibited.                          |
| Error behavior            | Reject zero/invalid UOM, foreign scope, duplicate or unsupported movement.                                                                                      |
| Compensating action       | Post a linked opposite/delta correction movement; never edit/delete original.                                                                                   |
| Canonical test vectors    | TV1: receive +10, use -3 → on-hand 7. TV2: replay use → remains 7.                                                                                              |
| Owning service            | Inventory Ledger Service                                                                                                                                        |
| Consuming products        | Partner Portal, POS/Hub, purchasing, Laundry consumables, reports                                                                                               |

### KBR-INV-002 — Canonical movement types

| Required field            | Canonical specification                                                                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-002                                                                                                                                                                                                                                        |
| Purpose                   | Standardize why quantity changes.                                                                                                                                                                                                                  |
| Inputs                    | Requested operation; source object; reason code; quantity direction.                                                                                                                                                                               |
| Preconditions             | Mapped movement type exists and is valid for source.                                                                                                                                                                                               |
| Calculation or transition | Use OPENING, PURCHASE_RECEIPT, USAGE, ADJUSTMENT_IN, ADJUSTMENT_OUT, COUNT_VARIANCE, WASTE_LOSS, TRANSFER_OUT, TRANSFER_IN, RETURN, RESERVATION, RELEASE, COMMITMENT or CORRECTION as governed types; verticals may add additive typed subreasons. |
| Output                    | Typed movement with direction and source linkage.                                                                                                                                                                                                  |
| Permissions               | Permission matrix per movement type.                                                                                                                                                                                                               |
| Audit event               | inventory.movement_type_validated.                                                                                                                                                                                                                 |
| Offline behavior          | Hub caches active movement registry/version. Unknown type is rejected, not stored as generic metadata.                                                                                                                                             |
| Error behavior            | Invalid mapping blocks posting and raises contract error.                                                                                                                                                                                          |
| Compensating action       | Correct source workflow and post proper movement; erroneous posted movement uses CORRECTION.                                                                                                                                                       |
| Canonical test vectors    | TV1: stock count increase uses COUNT_VARIANCE, not PURCHASE_RECEIPT. TV2: Location transfer creates paired OUT/IN.                                                                                                                                 |
| Owning service            | Inventory Governance Service                                                                                                                                                                                                                       |
| Consuming products        | All inventory-producing products and APIs                                                                                                                                                                                                          |

### KBR-INV-003 — On-hand, reserved, committed and available

| Required field            | Canonical specification                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-003                                                                                                                                                                                                                                   |
| Purpose                   | Keep physical quantity and sale/usage commitments distinct.                                                                                                                                                                                   |
| Inputs                    | Posted movements; active reservations; commitments; cutoff/version.                                                                                                                                                                           |
| Preconditions             | Projection inputs complete for requested authority scope.                                                                                                                                                                                     |
| Calculation or transition | OnHand = sum physical quantity movements. Reserved = active unexpired holds. Committed = accepted fulfilment/production obligations per policy. Available = OnHand - Reserved - Committed, unless vertical policy explicitly defines overlap. |
| Output                    | Truth-labeled quantity balances and projection version.                                                                                                                                                                                       |
| Permissions               | Read permission; reservation/commit permissions separate.                                                                                                                                                                                     |
| Audit event               | inventory.balance_projected.                                                                                                                                                                                                                  |
| Offline behavior          | Hub derives local Location balances and reservations. Cloud aggregates only acknowledged synchronized data and labels freshness.                                                                                                              |
| Error behavior            | Incomplete movement stream returns partial/unavailable, never guessed quantity. Negative available follows policy and raises exception.                                                                                                       |
| Compensating action       | Rebuild projection; release expired holds; post correction only for proven physical variance.                                                                                                                                                 |
| Canonical test vectors    | TV1: on-hand 20, reserved 4, committed 3 → available 13. TV2: stale cloud → balance marked stale.                                                                                                                                             |
| Owning service            | Inventory Projection Service                                                                                                                                                                                                                  |
| Consuming products        | POS, Storefront, Partner/Chain portals, Connector projections, reports                                                                                                                                                                        |

### KBR-INV-004 — Reservation create, expire and release

| Required field            | Canonical specification                                                                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-004                                                                                                                                               |
| Purpose                   | Prevent overselling while guaranteeing abandoned holds do not remain forever.                                                                             |
| Inputs                    | Item/Location/quantity; owner transaction/session; expiry; idempotency key.                                                                               |
| Preconditions             | Sufficient available quantity/capacity; owner valid; policy permits reservation.                                                                          |
| Calculation or transition | Atomically create reservation and reduce available projection. At expiry/cancel/failure post release; confirmation may convert reservation to commitment. |
| Output                    | Reservation state and expiry/release event.                                                                                                               |
| Permissions               | Authorized transaction/commerce service; manual override privileged.                                                                                      |
| Audit event               | inventory.reserved/released/committed.                                                                                                                    |
| Offline behavior          | Hub handles local reservations. Cloud commerce reservations cannot assume Hub stock without accepted synchronization/availability policy.                 |
| Error behavior            | Insufficient quantity rejects. Expiry worker retries idempotently. Conflicting authorities produce review, not silent oversell.                           |
| Compensating action       | Release reservation; if accepted transaction cannot be fulfilled, open shortage exception and customer remedy workflow.                                   |
| Canonical test vectors    | TV1: available 5 reserve 2 → available 3. TV2: reserve 6 → reject. TV3: expiry replay → one release.                                                      |
| Owning service            | Inventory Reservation Service                                                                                                                             |
| Consuming products        | Storefront, Commerce API, POS, Hub, connectors                                                                                                            |

### KBR-INV-005 — Consumable usage from Laundry production

| Required field            | Canonical specification                                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-005                                                                                                                                                   |
| Purpose                   | Record detergent, bags, tags and other Laundry consumables without changing garment custody counts.                                                           |
| Inputs                    | Booking/work record; consumable item; quantity/UOM; station; actor/device.                                                                                    |
| Preconditions             | Booking active; item configured as consumable; quantity reasonable; Location scope matches.                                                                   |
| Calculation or transition | Post USAGE movement linked to Booking/work event. Optional standard usage may be suggested, but actual posting is explicit or governed automation with trace. |
| Output                    | Usage movement, updated balance and variance basis.                                                                                                           |
| Permissions               | Laundry staff or approved automatic rule; adjustments require supervisor.                                                                                     |
| Audit event               | laundry_consumable.used.                                                                                                                                      |
| Offline behavior          | Hub posts during production offline.                                                                                                                          |
| Error behavior            | Unknown item/UOM or extreme variance follows validation/approval policy.                                                                                      |
| Compensating action       | Post CORRECTION movement; do not edit Booking or prior usage.                                                                                                 |
| Canonical test vectors    | TV1: use 0.25L detergent → -0.2500 L. TV2: garment scan does not decrement consumable automatically unless rule configured.                                   |
| Owning service            | Laundry Inventory Adapter                                                                                                                                     |
| Consuming products        | T1/production/POS Mobile, Partner Portal, Store Hub, reports                                                                                                  |

### KBR-INV-006 — Stock count and variance

| Required field            | Canonical specification                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-006                                                                                                                      |
| Purpose                   | Convert a physical count into an auditable variance movement.                                                                    |
| Inputs                    | Count session; expected snapshot/cutoff; counted quantity; item/lot/location; counter; approver.                                 |
| Preconditions             | Count session open; expected quantity frozen for cutoff; item not double-counted; permission valid.                              |
| Calculation or transition | Variance = counted - expected. Close count line by posting COUNT_VARIANCE delta with reason and approval according to threshold. |
| Output                    | Count result, variance movement and discrepancy report.                                                                          |
| Permissions               | Counter and approver segregation where required; blind-count option policy driven.                                               |
| Audit event               | inventory.count_recorded/approved/closed.                                                                                        |
| Offline behavior          | Hub supports local count offline and isolates concurrent movements by cutoff/late-movement handling.                             |
| Error behavior            | Stale count session, missing lines or concurrent ambiguity blocks close or creates explicit exception.                           |
| Compensating action       | Reopen with reason; post correction movement after recount.                                                                      |
| Canonical test vectors    | TV1: expected 10, counted 8 → -2 variance. TV2: retry close → one movement.                                                      |
| Owning service            | Inventory Count Service                                                                                                          |
| Consuming products        | Partner Portal, POS Mobile, Hub, Finance/reporting                                                                               |

### KBR-INV-007 — Location transfer pairing

| Required field            | Canonical specification                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-007                                                                                                                                                                             |
| Purpose                   | Preserve custody and quantity across Store Locations.                                                                                                                                   |
| Inputs                    | Source/destination; item/lot; quantity; transfer document; dispatch/receive actors.                                                                                                     |
| Preconditions             | Locations authorized under same governed Tenant context; sufficient source quantity; transfer open.                                                                                     |
| Calculation or transition | Dispatch posts TRANSFER_OUT and in-transit quantity. Receipt posts TRANSFER_IN at destination against same transfer lines. Partial receipt remains explicit.                            |
| Output                    | Transfer states, paired movements and in-transit balance.                                                                                                                               |
| Permissions               | Source dispatch and destination receive permissions; sensitive corrections approved.                                                                                                    |
| Audit event               | inventory.transfer_dispatched/received.                                                                                                                                                 |
| Offline behavior          | Each Hub records its local side. Cloud coordinates transfer; destination cannot fabricate source dispatch. Offline cross-Location transfer requires approved pre-issued package/policy. |
| Error behavior            | Over-receipt, wrong lot/UOM or missing dispatch rejected.                                                                                                                               |
| Compensating action       | Return/reject shipment or post governed corrections on each side; preserve in-transit history.                                                                                          |
| Canonical test vectors    | TV1: dispatch 5, receive 4 → 1 in transit. TV2: receive 6 → reject.                                                                                                                     |
| Owning service            | Inventory Transfer Service                                                                                                                                                              |
| Consuming products        | Partner/Chain portals, Hub, later retail verticals, reports                                                                                                                             |

### KBR-INV-008 — Cost layer posting

| Required field            | Canonical specification                                                                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-008                                                                                                                                                                                                                                   |
| Purpose                   | Calculate operational inventory cost without rewriting quantity history.                                                                                                                                                                      |
| Inputs                    | Receipt/usage/adjustment movements; unit cost; currency; cost method/version; landed-cost allocation if approved.                                                                                                                             |
| Preconditions             | Cost method selected per item/Store policy; source cost authoritative; currency policy valid.                                                                                                                                                 |
| Calculation or transition | Attach cost effects to movements. Phase-appropriate default is governed moving-average or specified-cost policy; calculations use high precision and round only at posting/report boundary. Quantity corrections do not silently invent cost. |
| Output                    | Cost ledger entries, average/unit cost projection and cost-of-usage amount.                                                                                                                                                                   |
| Permissions               | Purchasing/finance permissions for cost; operators may post quantities without seeing restricted cost where policy says.                                                                                                                      |
| Audit event               | inventory.cost_posted/recalculated.                                                                                                                                                                                                           |
| Offline behavior          | Hub may carry approved current cost snapshot for local operational posting; cloud performs authoritative reconciliation/rebuild.                                                                                                              |
| Error behavior            | Missing cost yields uncosted exception, not zero cost. Unsupported retroactive change requires governed recalculation.                                                                                                                        |
| Compensating action       | Post cost adjustment linked to original movement and rerun affected period reconciliation.                                                                                                                                                    |
| Canonical test vectors    | TV1: 10 units at 100 + 10 at 200 minor → average 150. TV2: missing receipt cost → uncosted exception.                                                                                                                                         |
| Owning service            | Inventory Costing Service                                                                                                                                                                                                                     |
| Consuming products        | Partner Portal, Finance, purchasing, reports                                                                                                                                                                                                  |

### KBR-INV-009 — Negative inventory and oversell guardrail

| Required field            | Canonical specification                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-INV-009                                                                                                                                                    |
| Purpose                   | Prevent uncontrolled negative stock while allowing explicit exceptional operations where approved.                                                             |
| Inputs                    | Available balance; requested decrement; vertical policy; actor; reason/approval.                                                                               |
| Preconditions             | Balance freshness sufficient; negative policy known.                                                                                                           |
| Calculation or transition | Default reject decrement below allowed floor. If approved exception exists, require reason/approval and create negative-stock exception with remediation task. |
| Output                    | Posted or rejected movement plus exception status.                                                                                                             |
| Permissions               | Normal staff cannot override; manager/finance/inventory role per policy.                                                                                       |
| Audit event               | inventory.negative_blocked/approved_exception.                                                                                                                 |
| Offline behavior          | Hub enforces last active signed policy. Cloud cannot retroactively pretend negative never occurred.                                                            |
| Error behavior            | Unknown/stale balance may block high-risk decrement or require explicit local physical verification according to vertical policy.                              |
| Compensating action       | Receive/correct stock, reverse erroneous movement or resolve fulfilment shortage; close exception with evidence.                                               |
| Canonical test vectors    | TV1: available 2, request -3 → blocked. TV2: approved emergency use → -1 plus exception.                                                                       |
| Owning service            | Inventory Policy Service                                                                                                                                       |
| Consuming products        | POS/Hub, Storefront, Partner Portal, connectors, reports                                                                                                       |

## 4. Balance equations

```text
on_hand(location,item,cutoff) = SUM(posted physical movement deltas)
reserved = SUM(active unexpired reservations)
committed = SUM(active accepted commitments not represented in reserved, per policy)
available = on_hand - reserved - committed
in_transit = SUM(dispatched transfer quantity - received/rejected quantity)
```

Snapshots and materialized views are rebuildable accelerators. They are never the primary movement truth.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                      |
| ------------ | ------------------------------------------------------------------- |
| `INV-OD-001` | Approved operational cost method by phase/item class.               |
| `INV-OD-002` | Negative inventory thresholds and override authorities by vertical. |
| `INV-OD-003` | Count blind-entry, approval threshold and late-movement policy.     |
| `INV-OD-004` | Phase 1 supplier/PO and landed-cost pilot entry criteria.           |

## Verification and completion gate

- Every rule has schema, API/event, permission, audit, offline, error and compensating-action coverage.
- Canonical test vectors are represented in automated unit, contract, integration and Store-Hub reconnect tests.
- Cross-Tenant, cross-Digital-Store and cross-Location isolation tests pass.
- Duplicate delivery, stale configuration, partial sync and replay tests produce no duplicate business effect.
- Reconciliation proves subledgers and operational totals from authoritative entries.
- Documentation, migrations, seeds, monitoring, rollback, support and pilot evidence pass the applicable phase gate.
- No planning-only capability is labeled implemented.

## Version history

| Version | Date       | Change                                                      |
| ------- | ---------- | ----------------------------------------------------------- |
| v1.0.0  | 2026-07-26 | Initial canonical business-rule and state-machine contract. |
