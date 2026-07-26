\
# KitLuy Active Phase and Scope Fence

**Active phase:** Phase 1 — Laundry  
**Status:** owner-locked roadmap position  
**Effective record date:** 2026-07-26

## 1. Phase objective

Deliver a usable, deployable, commercially viable Laundry Digital Store operating system with a stable shared foundation that later verticals can reuse without Laundry hardcoding.

The phase is not complete merely when screens or services exist. Exit requires approved scope, schema, workflows, APIs, permissions, interfaces, offline behavior, hardware, finance rules, reports, integrations, migrations, seeds, QA, security, monitoring, recovery, pilot, go-live checklist, and updated Rebuild/Business Bibles.

## 2. Permitted Phase 1 scope

### Shared Core and platform foundation

- Tenant, Partner account, Digital Store, Store Location, user, membership, role, permission, device, and environment isolation.
- Neutral catalog/service definitions, pricing, customers, transactions, payments, inventory/consumables, purchasing foundation, finance subledger, reporting, files, notifications, jobs, webhooks, audit, integrations, and AI controls to the level required by Laundry.
- Four governed API surfaces: Management, Commerce Store, Edge Operations, and Connector.
- Versioning, idempotency, retries, error contracts, freshness labels, append-only ledgers, event delivery, and compatibility controls.
- Supabase/DigitalOcean responsibility split and Kubernetes-ready, non-Kubernetes-first deployment design.

### Laundry vertical delta

- services and per-piece/per-weight pricing;
- customer pre-intake, virtual queue, T1 verification, and Laundry Booking creation;
- garments, tags, bags, evidence, stains, damage and special handling;
- deposits, payments, KHQR, receipts and pickup references;
- production statuses, pressing, quality checks, issues, rewash and damage handling;
- pickup/delivery where approved for Phase 1;
- consumables, capacity and Laundry reporting;
- custody, ready storage, pickup release and completion;
- offline operations and reconciliation.

### Phase 1 client/product surfaces

- public B2B website and account entry;
- Admin Portal control plane;
- Chain Portal Laundry governance;
- Partner Portal one-Digital-Store back office;
- Partner App owner/manager cockpit;
- POS Desktop and approved POS Mobile operations;
- Storefront QR/Telegram pre-intake and queue;
- Store Hub and managed devices;
- T1, T2, T3, and T4 profiles.

### Laundry terminal rules

| Profile | Canonical purpose | Hard boundary |
|---|---|---|
| T1 | POS Cashier / Intake | intake, authoritative Booking creation, price, deposit/payment, receipt/tag |
| T2 | Customer Display Screen | customer-facing mirror, totals, KHQR/payment state, receipt/pickup information; no production workflow |
| T3 | Clean & Ready Scan-In | quality/count, packaging, storage assignment, ready custody event; no customer release |
| T4 | Customer Pickup Scan-Out | collector verification, balance control, custody release, Booking completion |

## 3. Allowed shared forward preparation

An agent may add a neutral seam for a later vertical only when all are true:

- Phase 1 requires the shared abstraction now or confirmed near-term reuse is documented;
- no later-vertical workflow is activated;
- the change is additive and backward-compatible;
- no Laundry term enters Core;
- feature flags/entitlements keep later functionality disabled;
- the task explicitly lists the forward-compatibility requirement and tests.

## 4. Prohibited active scope

Without a new owner-approved task and phase decision, do not implement:

- Café/Restaurant menus, tables, checks, KDS, course firing, recipes, tips, or service-charge workflows;
- full Phase 3 eCommerce carts, checkout, subscriptions, international commerce, public extension marketplace, or theme marketplace beyond the exact Laundry Storefront need;
- Convenience, Pharmacy, Department Store, Grocery, or Supermarket vertical workflows;
- speculative enterprise scale, multi-region, self-checkout, warehouse distribution, or regulated pharmacy behavior;
- a generic all-industry UI or schema that destabilizes Laundry;
- competitor clone architecture as product truth;
- pricing, legal, tax, processor-risk, or compliance choices not approved for Cambodia.

## 5. Phase 1 source-of-truth constraints

- Digital Store first; optional physical Location second.
- One Digital Store, one primary vertical.
- Store Hub active before terminal provisioning.
- T1–T4 roles remain separate even when hardware is shared.
- Cloud sync is asynchronous; internet failure does not stop local operation.
- External channels are governed projections and connectors.
- Reporting cannot be commercially paywalled.
- No capability is marked implemented without evidence.

## 6. Scope-change procedure

A task that needs to cross this fence must stop and file a conflict/decision record stating:

- requested capability;
- reason Phase 1 cannot succeed without it;
- whether it is Core or vertical-specific;
- impact on schema, APIs, offline behavior, products, migration, security, operations, and roadmap;
- options and recommendation;
- owner decision required.
