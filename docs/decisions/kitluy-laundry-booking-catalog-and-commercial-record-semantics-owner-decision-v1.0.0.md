# KitLuy Laundry Booking, Catalog and Commercial Record Semantics — Owner Decision v1.0.0

**Decision ID:** `KLD-2026-08-07-BOOKING-SEMANTICS-001`
**Status:** `OWNER-APPROVED — LOCKED`
**Date:** 2026-08-07 · Asia/Phnom_Penh
**Resolves:** `KLDRV-CONF-001` — Order / Service / Service Item vs Laundry Booking
**Authority chain:** owner decision 2026-08-07 (POS unification, §5/§6) →
this decision. It establishes domain-model semantics; it creates no new
authority, relaxes no fail-closed gate and completes no WS-12 task.
**Supersedes:** the unresolved status of `KLDRV-CONF-001` recorded in
`00_AI_HANDOFF/preparation/DOCUMENT_RECONCILIATION_REPORT.md` §3
**Superseded by:** none

## 1. The conflict being resolved

| Source                                                                                          | Model                                                                                                        |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Drive `KLDRV-0001` (OWNER-LOCKED, 2026-07-18), implemented across `kitluy-laundry-pos-desk-app` | **Order → Service → Service Item** (`pos.orders`, `pos.order_items`, `laundry.garments`, `catalog.services`) |
| Canonical monorepo (WS-07 aggregate, WS-12 drafts)                                              | **Laundry Booking** (`booking-lifecycle`, `custody-events`, cloud 0187)                                      |

Both were owner authority at the same level, scoped to different repositories.
Neither stated which governed the canonical monorepo.

## 2. Resolution — three separated layers

The conflict is resolved by **separating catalog, operational vertical
aggregate and shared commercial record**. They are different things; the
earlier dispute treated them as competing names for one thing.

```text
CATALOG                 OPERATIONAL AGGREGATE          SHARED COMMERCIAL RECORD
(vertical-neutral)      (vertical-specific)            (vertical-neutral)

Service            →    Laundry Booking           →    Transaction
                                                        ├── Payment
                                                        ├── Refund / Void
                                                        ├── Inventory movement
                                                        ├── Finance entries
                                                        └── Audit events
```

### 2.1 Catalog layer

A **Service** is something offered by a Digital Store — for Laundry, e.g.
Wash & Fold, Dry Cleaning, Ironing, Express Service, Delivery. Service
configuration and pricing belong to the catalog and pricing domains.

- A Service is **NOT** a Laundry Booking.
- A Service is **NOT** a payment transaction.

### 2.2 Laundry operational aggregate

For Phase 1 Laundry the canonical customer/operational aggregate is the
**Laundry Booking**, owning: customer · Digital Store · Location · Booking
lines · service snapshots · garments/units · piece quantities · weight
quantities · pricing snapshot · discounts · pickup/delivery · deposit
requirement · production state · custody state · lifecycle timestamps.

A Booking line **references and snapshots** the selected catalog Service and
the price and rules effective at Booking creation.

> **Mutable live catalog pricing must never be used as historical Booking
> truth after finalization.** Snapshots are the historical record.

### 2.3 Shared commercial records

The shared Core transaction/payment layer remains **vertical-neutral**. A
shared Transaction does **not** replace the Laundry Booking: the Booking owns
the Laundry operational workflow, while the shared transaction, payment and
finance systems own commercial and financial truth.

Append-only rules for finalized payment, finance, inventory and audit records
are preserved unchanged.

## 3. Future vertical model — `Booking` is not universal

Operational aggregates are **vertical-specific**. Do not force every vertical
to use the word `Booking`.

| Vertical          | Operational aggregate                |
| ----------------- | ------------------------------------ |
| Laundry           | **Booking**                          |
| Café / Restaurant | Check / Order                        |
| eCommerce         | Order                                |
| Convenience       | Sale                                 |
| Pharmacy          | Sale / regulated dispensing workflow |
| Department Store  | Sale                                 |
| Grocery           | Sale                                 |
| Supermarket       | Sale                                 |

Each reuses neutral Core for customers, catalog, pricing, payments,
inventory, finance, audit and reporting.

**Laundry Booking terminology must never be hardcoded into neutral Core.**

## 4. Legacy `Order` compatibility

Where existing code or schema uses `Order` terminology, **do not rename
database objects merely to satisfy this decision**. Classify each use first:

`CORE-COMMERCIAL-TRANSACTION` · `LAUNDRY-BOOKING-COMPATIBILITY` ·
`FUTURE-VERTICAL-ORDER` · `LEGACY-NAMING` · `SUPERSEDED` ·
`OWNER-REVIEW-REQUIRED`

Use compatibility adapters where required. Changes must be **additive and
backward-compatible**. Applied migration history is never rewritten.

## 5. Vertical authority clarification

Canonical truth for the business vertical is:

```text
Digital Store.primary_vertical
```

The **terminal profile** describes the terminal's role _inside_ that Store —
e.g. `primary_vertical = laundry`, `terminal_profile = laundry.t1.cashier`.

### 5.1 The current derivation is TEMPORARY

The implemented resolver derives the vertical from the Hub-signed
`terminalProfileCode` prefix because the configuration envelope carries no
explicit vertical field. That is accepted as a
**`TEMPORARY-COMPATIBILITY-DERIVATION`** only.

> The terminal-profile prefix must **not** become the permanent source of
> business-vertical truth.

Its fail-closed behaviour is **retained and must not be weakened**:

```text
explicit vertical present + profile-derived vertical + they disagree → REFUSE
```

### 5.2 Governed follow-up recorded

A governed contract change is required to deliver authoritative Digital Store
vertical information through the Hub configuration/assignment envelope. It is
recorded as an open item (`KLREQ-VERTICAL-ENVELOPE-001`) and must be executed
by the task that **owns** that signed contract — a signed contract is not
modified casually by a task that does not own it.

## 6. Effect on WS-12

This decision unblocks the **domain semantics** for WS-12 T003–T005. It does
**not**:

- start, complete or reorder any WS-12 task;
- relax the composition rule (T1 remains a composition surface, not a new
  source of Booking, payment, pricing, customer or audit truth);
- relax BLK-005 / BLK-006;
- authorize schema changes outside the owning task.

## 7. Consequences for classification

Entries previously blocked on `KLDRV-CONF-001` in
`00_AI_HANDOFF/migrations/pos-unification/10_POS_FEATURE_DISPOSITION_REGISTER.md`
move from `OWNER-DECISION-REQUIRED` to `GATED-PENDING-WS12-TASK`: the
semantics are settled, the sequencing is not.

Donor `serviceCatalog.ts` / `serviceCode.ts` map to the **catalog Service**
layer. Donor `data/orders` / `order-hierarchy-repository` require the §4
classification before any port.
