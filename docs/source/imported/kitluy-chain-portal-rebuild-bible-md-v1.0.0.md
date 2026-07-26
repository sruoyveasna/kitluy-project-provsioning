# KitLuy Chain Portal — Rebuild Bible

**File:** `kitluy-chain-portal-rebuild-bible-md-v1.0.0.md`
**Product:** `kitluy-chain-portal` (web)
**Owner:** Het Sovannara · Founder, HET Digital Ecosystem
**Vertical scope:** Laundry (Phase 1.0) — the MVP baseline
**Status:** Active · Rebuild-Ready Specification
**Backend project:** Supabase `qneduoifcsvjajeqmvgb` (ap-southeast-1 / SGP1, PostgreSQL 17)
**Date:** 16 June 2026

> **Mission:** This document passes the **Rebuild Test** — *"If every person who built the KitLuy Chain Portal disappeared tomorrow, could a single engineer with zero prior context reconstruct the product, its infrastructure, and its business logic from this document alone?"* The answer must be **yes**.
>
> This bible covers **only** the Chain Portal. Where it touches sibling products (Seller Portal, POS, Admin Portal) or shared ecosystem services (Netra, Rotanak, HSAL, ABA PayWay), it documents the **contract surface only** and points to the owning product's bible for internal detail.

---

## 0. Front Matter — Rebuild Sequence (Read This First)

```
REBUILD SEQUENCE — KitLuy Chain Portal

1.  Provision infrastructure
    - Supabase project qneduoifcsvjajeqmvgb (ap-southeast-1, PostgreSQL 17)
    - DigitalOcean SGP1 droplet/app for the React web frontend
    - (Chain Portal has NO local hardware — it is cloud-only. Stores own the Pi 5 hubs.)
    → See Part 11, §11.1

2.  Apply database migrations in order (Claude writes, BE team applies — never auto-apply)
    - Baseline ecosystem schemas already exist (core.*, pos.*, menu.*, orders.*, inventory.*, finance.*, loyalty.*)
    - 20260616000001_kitluy_chain_schema_init.sql      (creates kitluy.chain.*)
    - 20260616000002_kitluy_loyalty_chain_init.sql     (creates kitluy.loyalty_chain.*)
    - 20260616000003_kitluy_chain_b2b_init.sql         (creates kitluy.customers.chain_b2b_contracts)
    - 20260616000004_kitluy_chain_rls.sql              (RLS policies on all chain tables)
    - 20260616000005_kitluy_chain_indexes.sql          (indexes)
    → See Part 6, §6.5

3.  Seed baseline data
    - Chain plan price book (៛100 HQ + ៛50/store)
    - Royalty rule template library defaults (gross %, net %, tiered, hybrid)
    - Brand-standard rule seed (receipt, pricing-floor, service, hours, staff, quality)
    → See Part 16, §16.2

4.  Deploy API contracts / edge functions
    - Chain-owned: kitluy-royalty-run-calc, kitluy-territory-overlap-check,
      kitluy-compliance-score, kitluy-chain-loyalty-publish, kitluy-location-score-calc,
      kitluy-catalog-push, kitluy-chain-promo-publish, kitluy-chain-b2b-invoice,
      kitluy-chain-subscription-bill
    → See Part 7

5.  Configure secrets & third-party credentials
    - Supabase service-role key, ABA PayWay (chain subscription billing + B2B invoicing),
      Telegram bot token (chain owner alerts)
    → See Part 5, §5.4

6.  Build / image local hardware or nodes
    - N/A for Chain Portal (cloud-only). Skip. Store hardware is provisioned per the
      Seller Portal / POS bibles.

7.  Pair / register clients to backend
    - Chain owner account created (email/password OR phone OTP — shared identity).
    - Chain entity (kitluy.chain.chains) provisioned, stores linked.
    → See Part 14, §14.1

8.  Run QA validation scenarios
    - 16 scenarios: catalog push, royalty run, compliance score, territory overlap,
      loyalty publish, B2B invoice, subscription lifecycle, store isolation.
    → See Part 15

9.  Verify monitoring & alerting
    - Royalty-run failure alert, catalog-push partial-failure alert, subscription
      dunning alert, store-offline rollup gap.
    → See Part 12

10. Go-live smoke test
    - Create chain → add 2 stores → push catalog → run a royalty period → publish a
      chain promo → confirm aggregate dashboard reflects both stores.
    → See Part 16, §16.5
```

---

## Part 1 — Glossary

> Every term used in Parts 2–18 is defined here first. Terms are grouped by domain. Ecosystem-sibling terms appear only insofar as the Chain Portal touches them.

### 1.1 Platform Terms

| Term | Definition |
|---|---|
| HET Digital Ecosystem | Umbrella platform of sovereign apps sharing one Supabase backend. Members the Chain Portal touches: KitLuy (POS suite), Rotanak (loyalty), Netra (AI marketing), HSAL (logistics), ABA PayWay (payments). |
| KitLuy (ឃីត់លុយ) | Khmer for "estimate / count up." The unified commerce SaaS platform — "Cambodia's Shopify." Verticals: laundry (Phase 1, this bible's scope), café (Phase 2), restaurant, retail (Phase 3+). |
| Shared identity | One `auth.users.id` UUID per person across all ecosystem apps. A chain owner who also uses HSA has the same UUID. |
| Tenant | The HET platform itself is the top tenant. In Chain Portal context, the **Chain** is the tenant-scoping boundary for all chain-owned data. |
| SSOT | Single Source of Truth. For chain architecture decisions, the `hsa_brainstorming` / KitLuy brainstorming rooms hold authority. |

### 1.2 Product Terms (Chain Portal)

| Term | Definition |
|---|---|
| Chain Portal | `kitluy-chain-portal`. The web application specified in this bible. Used by chain/franchise owners to manage multiple stores under one brand. |
| Chain | A brand operating ≥1 store. May be single-owner (one legal entity owns all stores) or a franchisor (independent franchisees operate stores under the brand). Stored in `kitluy.chain.chains`. |
| Chain HQ | The owner's headquarters view — the aggregate, god-view across all stores in the chain. Synonym for what the Chain Portal presents. |
| Store | A single physical location running KitLuy POS. Belongs to exactly one chain (if chained) and exactly one vertical. The Seller Portal manages a single store; the Chain Portal manages all of them in aggregate. |
| Franchisee | A legal entity that operates one or more stores under a chain's brand. Type is `company_owned` (the chain owns it) or `franchisee` (independent operator paying royalties). Stored in `kitluy.chain.franchisees`. |
| Catalog Control | The Chain Portal module that defines the master service menu and **pushes** it down to stores. Stores cannot remove HQ-pushed items. |
| Master Catalog | The chain's authoritative service menu (e.g., Wash & Fold, Dry Clean, Press Only) with HQ pricing. The source that store catalogs derive from. |
| Brand Standards | Locked operational rules (receipt format, pricing floors/ceilings, service minimums, hours) enforced across all stores. |
| Royalty | A fee an independent franchisee pays the chain, computed per a **royalty rule template** (gross %, net %, tiered, hybrid, minimum floor). |
| Royalty Run | A periodic (usually monthly) calculation of royalties due across all franchisees for a period. Produced by `kitluy-royalty-run-calc`. |
| Territory | A geographic zone assigned to a franchisee. Modeled as a polygon. Overlap between territories triggers cannibalization alerts. |
| Chain Loyalty | The chain's **OWN branded** loyalty program (stamp cards, points, tiers). **NOT Rotanak.** ⚠️ RECONCILE — see §1.6. |
| Loyalty Studio | The self-serve kit inside the Chain Portal for designing the chain's branded loyalty (card visuals, rule packs, campaign controls). |
| Compliance Audit | A structured store inspection with evidence (photos, checklists, receipts, mystery-shopper). Scored by pillar. |
| Compliance Pillar | One of four scoring dimensions: Brand Identity, Process Adherence, Service Standards, Experience Consistency. Each carries a weight. |
| Chain B2B | The module for chains serving institutional clients (hotels, schools, corporates) under contract with invoicing. |

### 1.3 Commerce Terms

| Term | Definition |
|---|---|
| Chain Plan | The subscription tier required to use the Chain Portal: **៛100 HQ/month + ៛50/store/month**. 14-day free trial, then auto-bill. 0% order commission. |
| Commission | KitLuy charges **0% commission** on orders. Revenue is SaaS-subscription only. (Note: B1/B2/B3 commission splits are an **HSA-only** construct and are explicitly **excluded** from KitLuy — see §1.6.) |
| Subscription billing mode | Per franchise agreement: `brand_consolidated` (chain HQ pays for all stores) or `franchisee_direct` (each franchisee pays for their own stores). |
| KHR (៛) | Cambodian Riel. The locked ecosystem currency. **Integer only, no decimals.** Symbol is `៛` (Unicode U+17DB). The symbol `₭` is **wrong** (that is Lao Kip). |
| Royalty base | The revenue figure a royalty percentage applies to: `gross` (all sales) or `net` (sales minus returns/voids/discounts). Defined per template. |

### 1.4 Hardware Terms (Reference Only)

> The Chain Portal runs **no hardware**. These terms appear only because the Chain Portal monitors store hardware health in aggregate.

| Term | Definition |
|---|---|
| Pi 5 Hub | Raspberry Pi 5 (8GB + NVMe) running the local PostgreSQL + sync engine at a store. The Chain Portal reads its heartbeat status; it never connects to it directly. |
| POS Terminal | A Pi-based touchscreen at a store (T1 cashier, etc.). The Chain Portal shows online/offline counts only. |
| Heartbeat | A periodic liveness signal from store hardware. Aggregated into the Chain Portal's store-health view. |

### 1.5 Third-Party / Sibling Terms

| Term | Definition |
|---|---|
| ABA PayWay | Cambodia's dominant payment gateway. The Chain Portal uses it for (a) chain subscription auto-billing and (b) B2B invoice collection. KHQR + card 3DS. |
| Rotanak | The ecosystem coalition loyalty platform (Angkorian Stars + Sleung Coins, five tiers). The Chain Portal can **optionally partner** with Rotanak, but the chain's primary loyalty is its **own branded** program. Read-only mirror with **gold banner** per ecosystem §5.3. |
| Netra | The shared AI marketing brain. The Chain Portal surfaces Netra-driven insights as a read-only mirror with **purple banner**. AI Chain Advisor consumes Netra. |
| HSAL | The shared logistics/driver dispatch platform. Surfaced read-only in store views for laundry pickup/delivery. Not central to chain management. |
| Canvār | Ecosystem e-commerce app. Listed in the Integrations module as an optional channel connector (future). |

### 1.6 ⚠️ RECONCILE — Conflicting / Cross-Document Definitions

| Term | Conflict | Resolution (this bible) |
|---|---|---|
| Chain loyalty vs Rotanak | The café handbook describes a **read-only Rotanak mirror** as the loyalty surface. The Chain Portal instead has its **OWN branded loyalty** (Loyalty Studio) with Rotanak as an **optional** add-on partnership. | Chain Portal = own branded program is primary; Rotanak is optional. The café/POS read-only mirror is the **store-level** loyalty surface; the chain-level branded program is a **separate** construct. Tracked in Appendix C (RC-01). |
| B1/B2/B3 commission | HSA bibles define B1=7%, B2=3%, B3=15% commission splits. | **Excluded from KitLuy entirely.** KitLuy is 0% commission, SaaS-only. Any B1/B2/B3 reference in a KitLuy context is an error. Tracked in Appendix C (RC-02). |
| "Chain HQ Portal" vs "Chain Portal" | Master handbook lists `kitluy-chain-hq-portal`; this bible uses `kitluy-chain-portal`. | Same product. Canonical id: `kitluy-chain-portal`. Tracked in Appendix C (RC-03). |

---

## Part 2 — Business Overview

### 2.1 What it is

The KitLuy Chain Portal is the **multi-store command center** for brand and franchise owners on KitLuy. If the Seller Portal is "the dashboard for one shop," the Chain Portal is **"the HQ dashboard for a brand that runs many shops"** — it aggregates every store's performance, pushes a master catalog and brand standards down to all of them, runs franchise royalties, and lets the owner design their own branded loyalty program. It is **"Shopify Plus for Cambodian laundry/F&B chains."**

### 2.2 What it is not

- **It is not a POS.** It never processes a customer order. Orders happen at stores on Pi 5 hardware.
- **It is not the Seller Portal.** The Seller Portal manages a single store's day-to-day. The Chain Portal sits above many Seller Portals and reads them in aggregate while writing catalog/standards down.
- **It is not the Admin Portal.** The Admin Portal is HET's internal god-view over the whole SaaS platform (all chains, all tenants, billing, support). The Chain Portal is owned by a **customer** (a chain owner), scoped to **their** chain only.
- **It is not Rotanak.** The chain's loyalty is its own branded program. Rotanak is an optional ecosystem partnership.
- **It does not rebuild Netra, Rotanak, or HSAL.** It **consumes** them. (The "consumes-not-builds" rule governs every feature decision.)
- **It does not run hardware.** Cloud-only.

### 2.3 Verticals / Modules

The Chain Portal is **vertical-aware but vertical-scoped per chain**. The **1 Store = 1 Vertical** rule means a chain's stores are all the same vertical, OR a multi-vertical operator runs separate chains. This bible's scope is **Laundry (Phase 1.0)** — the MVP.

| Vertical | Phase | Chain Portal status |
|---|---|---|
| Laundry | 1.0 | **This bible.** Live/near-live. Services: Wash & Fold, Dry Clean, Press Only, Stain Removal. |
| Café / Milk Tea | 2.0 | Separate vertical bundle. Out of scope here. Uses `cafe.*` schema deltas. |
| Restaurant | 3.0 | Future. |
| Retail | 3.1+ | Future. Weight-scale + barcode gaps flagged for this vertical. |

The vertical is set on each store at provisioning via `pos.stores.vertical_type` (immutable enum + DB trigger). The Chain Portal does not let an owner change a store's vertical.

### 2.4 Product / Build Inventory

The Chain Portal is **one web build**. For context, the full KitLuy suite has six canonical products:

| # | Product | Form factor | Audience | In this bible? |
|---|---|---|---|---|
| 1 | `kitluy-admin-portal` | Web | HET HQ (platform owner) | Contract reference only |
| 2 | `kitluy-chain-portal` | **Web** | **Brand / franchise owner** | **YES — full scope** |
| 3 | `kitluy-seller-portal` | Web | Individual shop owner | Contract reference only |
| 4 | `kitluy-seller-app` | Mobile | Shop owner (mobile form factor of #3) | No |
| 5 | `kitluy-pos-desktop-app` | Electron on Pi 5 | Store staff | No |
| 6 | `kitluy-pos-mobile-app` | Mobile | Store staff (mobile form factor of #5) | No |

The Chain Portal has **no mobile form-factor pairing in v1.0.0** (unlike Seller/POS which pair web↔mobile). A responsive web layout serves tablets; a dedicated mobile app is a future consideration.

### 2.5 Business Model

| Lever | Value |
|---|---|
| Plan | **Chain Plan** |
| HQ fee | **៛100 / month** (flat, per chain) |
| Per-store fee | **៛50 / store / month** |
| Trial | **14 days free**, then auto-bill |
| Commission | **0%** on all orders (SaaS-only) |
| Billing rhythm | Monthly, auto-charged via ABA PayWay |
| Billing mode | `brand_consolidated` (HQ pays all) or `franchisee_direct` (each franchisee pays own) — set per franchise agreement |
| Hardware economics | Not bundled. Stores procure Pi 5 hardware separately (see Seller/POS bibles). |
| Royalty (chain → HET) | **None.** HET does not take franchise royalties. Royalties are a **chain-internal** construct (independent franchisee → chain owner), computed by the portal as a convenience. |

**Worked example.** A chain with 5 active stores on `brand_consolidated` billing: `៛100 + (5 × ៛50) = ៛350/month` to HET. The chain's own royalties from its 2 independent franchisees are separate money that flows franchisee→chain, never touching HET.

### 2.6 Moat / Defensibility

1. **Aggregation no single-box POS can match.** Competitors (e.g., POS-PRO, one-time $180 hardware bundles, perpetual license) sell isolated boxes. They have no HQ layer, no cross-store rollup, no franchise royalty engine.
2. **Franchise-grade tooling at SME pricing.** Royalty templates, territory polygons, compliance scoring, and B2B contracts are normally enterprise-only. KitLuy ships them at ៛50/store.
3. **Ecosystem structural moats** — shared identity, Rotanak coalition loyalty (optional), Netra AI insights, HSAL logistics, Pi 5 local-first performance — cannot be replicated by a standalone product.
4. **Localization** — KHR integer money, Khmer UI, ABA PayWay native, Cambodia climate-spec hardware at stores.

### 2.7 Ecosystem Position — Owned vs Consumed

| Capability | Owned by Chain Portal? | Source / Authority |
|---|---|---|
| Chain entity, franchisees, territories | **Owned** | `kitluy.chain.*` |
| Master catalog & catalog push | **Owned** | `menu.*` (chain-level rows) + `kitluy.chain.*` push log |
| Brand standards & compliance | **Owned** | `kitluy.chain.compliance_*` |
| Royalty rules & runs | **Owned** | `kitluy.chain.royalty_*` |
| Chain-branded loyalty | **Owned** | `kitluy.loyalty_chain.*` |
| B2B contracts & invoicing | **Owned** | `kitluy.customers.chain_b2b_contracts` |
| Aggregate store data (orders, revenue, staff) | **Consumed (read)** | `orders.*`, `finance.*`, `pos.*`, `core.*` |
| Rotanak coalition loyalty | **Consumed (read-only mirror, optional)** | `loyalty.*` (owned by Rotanak Admin) |
| Netra AI insights | **Consumed (read-only mirror)** | Netra event registry / profiles |
| HSAL logistics tracking | **Consumed (read-only)** | HSAL |
| Payments (subscription + B2B) | **Consumed** | ABA PayWay |
| Identity | **Consumed** | `auth.users` (one project) |

---

## Part 3 — System Architecture & Topology

### 3.1 Topology Diagram

```
                          ┌─────────────────────────────────────────────┐
                          │          CLOUD (DigitalOcean SGP1)           │
                          │                                              │
   Chain Owner ─ HTTPS ─▶ │  ┌────────────────────────────────────────┐ │
   (browser/tablet)       │  │  kitluy-chain-portal (React 18 + Vite)  │ │
                          │  │  Static SPA, served via CDN             │ │
                          │  └───────────────┬────────────────────────┘ │
                          │                  │ HTTPS (supabase-js)        │
                          │                  ▼                            │
                          │  ┌────────────────────────────────────────┐ │
                          │  │  Supabase (qneduoifcsvjajeqmvgb)         │ │
                          │  │  ┌──────────────┐  ┌──────────────────┐ │ │
                          │  │  │ Edge Funcs   │  │ PostgreSQL 17    │ │ │
                          │  │  │ (Deno)       │─▶│ kitluy.chain.*   │ │ │
                          │  │  │ chain-*      │  │ kitluy.loyalty_  │ │ │
                          │  │  │              │  │   chain.*        │ │ │
                          │  │  │              │  │ + read: orders.* │ │ │
                          │  │  │              │  │   finance.* pos.*│ │ │
                          │  │  └──────┬───────┘  │   menu.* loyalty.│ │ │
                          │  │         │          │   * core.*       │ │ │
                          │  │         │          └──────────────────┘ │ │
                          │  └─────────┼──────────────────────────────┘ │
                          └────────────┼──────────────────────────────────┘
                                       │ (server-to-server)
              ┌────────────────────────┼─────────────────────┬───────────────┐
              ▼                        ▼                     ▼               ▼
        ┌───────────┐          ┌──────────────┐      ┌────────────┐  ┌────────────┐
        │ ABA       │          │ Rotanak      │      │ Netra      │  │ Telegram   │
        │ PayWay    │          │ (loyalty,    │      │ (AI        │  │ (owner     │
        │ (sub +    │          │  optional,   │      │  insights, │  │  alerts)   │
        │  B2B inv) │          │  read mirror)│      │  read)     │  │            │
        └───────────┘          └──────────────┘      └────────────┘  └────────────┘

   ════════════════════════════════════════════════════════════════════════════
   STORES (separate infrastructure — Chain Portal only READS their data via cloud DB)
   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
   │ Store A      │  │ Store B      │  │ Store C ...  │   Each: Pi 5 Hub + terminals.
   │ Pi 5 Hub +   │  │ Pi 5 Hub +   │  │ Pi 5 Hub +   │   Local PostgreSQL, syncs UP to
   │ POS terminals│  │ POS terminals│  │ POS terminals│   cloud Supabase via outbox/inbox.
   └──────────────┘  └──────────────┘  └──────────────┘   Chain Portal NEVER connects to
                                                          a Pi directly. LAN-isolated.
```

**LAN vs WAN boundaries:**
- The Chain Portal is **100% WAN/cloud**. It has no LAN presence.
- Store Pi 5 hubs are **LAN-local** at each store; they sync UP to the cloud DB. The Chain Portal reads the **cloud** copy of store data only.
- Therefore the Chain Portal's freshness for store data is bounded by store **sync lag** (typically the 2-second flush window + WAN latency).

### 3.2 Data Flow Maps

**3.2.1 Catalog Push (chain → stores)**

```
1. Owner edits Master Catalog in Chain Portal UI, selects target stores.
2. Browser → POST kitluy-catalog-push  { chain_id, service_ids[], store_ids[], pricing }
3. Edge function validates: caller owns chain (RLS), prices respect brand floors/ceilings.
4. Edge function writes/updates menu.* rows scoped to each target store_id.
5. Edge function writes a push record to kitluy.chain.catalog_push_log (audit).
6. Each store's Pi 5 Hub picks up the menu change on its next inbox sync pull.
7. Edge function returns { pushed: N stores, failed: [] }.
8. UI shows per-store push status.
```

**3.2.2 Royalty Run (period close)**

```
1. Owner (or scheduled cron) triggers a royalty run for period P.
2. → POST kitluy-royalty-run-calc  { chain_id, period: "2026-03" }
3. Function reads each franchisee's assigned royalty rule (kitluy.chain.royalty_rules).
4. For each franchisee: reads gross/net revenue from finance.* for the franchisee's stores
   over period P (read-only aggregate).
5. Applies the rule model (gross %, net %, tiered, hybrid, min floor) → royalty_due.
6. Writes one kitluy.chain.royalty_runs row per franchisee (append-only ledger).
7. Returns the run summary. UI renders the Royalty Ledger.
8. Disputes (if filed) create kitluy.chain.royalty_disputes rows; settlement adjusts
   via a new append-only adjustment row (never edits the original).
```

**3.2.3 Chain Subscription Billing (HET ← chain)**

```
1. pg_cron (daily) invokes kitluy-chain-subscription-bill.
2. Function computes due = ៛100 + (active_store_count × ៛50) per chain.
3. On trial expiry or billing date: charge via ABA PayWay (saved card / KHQR).
4. ABA PayWay webhook → kitluy-payway-webhook (shared) → marks invoice paid.
5. On failure: dunning state, grace period, then suspension (Part 8, §8.7).
```

### 3.3 Offline-First Protocol

The **Chain Portal itself is online-only** — it is a cloud web app with no offline mode. There is no local capture/batch/sync for the portal.

However, the Chain Portal **depends on** the offline-first protocol of its **stores**:
- Stores capture orders locally on the Pi 5 Hub even when WAN is down (cash stays offline-capable).
- Stores sync UP via an **outbox/inbox pattern** with **idempotency keys (`op_id`)**, CDC columns on every synced row, and a **2-second flush window with gzip batching**.
- **Conflict resolution:** last-write-wins for operational data; financial documents are **append-only** (never mutated).
- **Implication for the Chain Portal:** aggregate numbers are **eventually consistent**. A store that is currently WAN-partitioned will show stale revenue until it reconnects and drains its outbox. The Chain Portal must label rollups as "as of last sync" and must not assume a store offline = a store with zero sales.

### 3.4 Hardware Placement (per vertical)

**N/A for the Chain Portal — it is cloud-only.** For reference, a laundry store (which the Chain Portal monitors) runs: **3 Pi units + 3 screens** — Hub (8GB + NVMe), T1 (dual-HDMI cashier driving a T2 customer display), and T4 (dispatcher). Cambodia climate spec: mesh aluminium case, pure copper heatsink, 3007 PWM blower fan, rated for 35 °C+ ambient. The Chain Portal reads these units' heartbeat/online status only. Full hardware spec lives in the POS bible.

### 3.5 Environment Promotion

| Stage | Frontend | Database | Edge Functions |
|---|---|---|---|
| Dev | Local Vite dev server | Supabase branch / local | `supabase functions serve` |
| Staging | DO SGP1 staging app | Staging Supabase project | Deployed to staging |
| Prod | DO SGP1 prod app (CDN) | `qneduoifcsvjajeqmvgb` | Deployed to prod |

- **Migrations** move Dev → Staging → Prod by the **BE team only** (Claude writes, never applies — project rule §7.1).
- **Secrets** are injected via Supabase project env (never committed). See §5.4.
- **Frontend builds** ship via the DO app pipeline (Git push → build → CDN deploy).

---

## Part 4 — External Contracts & Integrations

### 4.1 ABA PayWay (Payments)

The Chain Portal uses PayWay for **two** flows: chain subscription auto-billing and B2B invoice collection.

- **4.1.1 Purpose** — (a) Auto-charge the Chain Plan monthly. (b) Collect on B2B invoices issued to institutional clients.
- **4.1.2 Authentication** — Merchant ID + API key + HMAC request hash. Credentials live in Supabase secrets (`ABA_PAYWAY_MERCHANT_ID`, `ABA_PAYWAY_API_KEY`, `ABA_PAYWAY_RSA_PUBLIC_KEY`). PayWay lives in the **cloud edge-function layer** (never on a store Pi) because it needs secret credentials, a public webhook URL, and subscription auto-billing.
- **4.1.3 Request / Response Contracts** — Subscription charge: `POST` to PayWay purchase endpoint with `{ merchant_id, tran_id, amount, currency: "KHR", items, hash }`. Response: `{ status, tran_id, ... }`. (KHR integer amounts only.)
- **4.1.4 Error Handling & Retry** — Timeout 30s. On gateway timeout: do **not** double-charge — check transaction status by `tran_id` before retry. Dunning: 3 attempts over 7 days, then grace, then suspend.
- **4.1.5 Webhook Events** — PayWay posts payment status to the shared `kitluy-payway-webhook` receiver (public URL). Verify the RSA signature before trusting. Idempotent on `tran_id`. Events: payment success, payment failure, refund.
- **4.1.6 Sandbox vs Production** — Distinct base URLs and merchant credentials. Sandbox simulates success/failure by amount conventions. Never point prod at sandbox merchant.

### 4.2 Rotanak (Loyalty — Optional, Read-Only Mirror)

- **4.2.1 Purpose** — Optionally let the chain join the ecosystem coalition loyalty so customers earn Angkorian Stars + Sleung Coins across the ecosystem. The chain's **own** branded loyalty is separate and primary.
- **4.2.2 Authentication** — Service-role read of `loyalty.*` cached tables; writes (earn/redeem) go through **Rotanak's** edge functions, never the Chain Portal's.
- **4.2.3 Contracts** — Read tier table cache (`tier_id`, `name`, `min_stars`, `earn_rate_pct`) and wallet balances. The Chain Portal **never writes** loyalty.
- **4.2.4 Error Handling** — If Rotanak is unreachable, the Rotanak mirror panel renders an unavailable state; the chain's own branded loyalty is unaffected.
- **4.2.5 Webhooks** — None consumed by the Chain Portal.
- **4.2.6 Sandbox vs Prod** — Per Rotanak Admin bible.
- **Banner rule:** any Rotanak-sourced panel shows a **gold `#F5A623` banner** (ecosystem §5.3).

### 4.3 Netra (AI Insights — Read-Only Mirror)

- **4.3.1 Purpose** — Power the "AI Chain Advisor" with cross-store intelligence (foot-traffic alerts, staffing recommendations, win-back suggestions).
- **4.3.2 Authentication** — Read Netra profiles/insights via service role; the Chain Portal contributes **events** (orders, etc.) only indirectly via the stores' POS instrumentation, not from the portal itself.
- **4.3.3 Contracts** — Read insight objects `{ type, title, description, confidence, recommended_action }`.
- **4.3.4 Error Handling** — If Netra is down, AI Advisor shows an empty/unavailable state; no other module is affected.
- **4.3.5 Webhooks** — None.
- **Banner rule:** Netra-sourced panels show a **purple `#8B5CF6` banner** (ecosystem §5.3).

### 4.4 HSAL (Logistics — Read-Only Tracking)

- **4.4.1 Purpose** — Surface pickup/delivery tracking for laundry orders at stores that use HSAL dispatch.
- **4.4.2–4.4.6** — Read-only tracking surface; all dispatch authority lives in HSAL. Driver authorization in HSAL uses `core.users.role_type = 'driver'` **directly**, never `core.user_roles` (which is globally empty/legacy). The Chain Portal does not invoke driver flows.

### 4.5 Telegram (Owner Alerts)

- **4.5.1 Purpose** — Push daily chain summaries and exception alerts (royalty-run complete, catalog-push failures, subscription dunning) to the chain owner.
- **4.5.2 Authentication** — Bot token in Supabase secrets (`TELEGRAM_BOT_TOKEN`). Owner's chat id stored per chain.
- **4.5.3 Contracts** — `sendMessage` with text + optional inline buttons.
- **4.5.4 Error Handling** — Best-effort; failures logged, not retried aggressively. Email fallback optional.

### 4.6 Maps (Territories)

- **4.6.1 Purpose** — Render territory polygons and store pins; compute overlap. v1.0.0 uses **simple polygons first** (not rich scoring). Google Maps API external; HelloMap (sovereign) in development.
- **4.6.2–4.6.6** — Standard Maps JS API key in frontend env. Overlap computation runs server-side in `kitluy-territory-overlap-check`.

---

## Part 5 — Tech Stack & Repository Structure

### 5.1 Stack by Layer

| Layer | Technology |
|---|---|
| Web frontend | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| State | Zustand (consistent with the KitLuy app family) |
| Backend | Supabase — PostgreSQL 17, Auth, Edge Functions (Deno), Realtime, Storage |
| Payments | ABA PayWay (KHQR + Card 3DS) for subscription + B2B |
| Maps | Google Maps API (external) · HelloMap (sovereign, in development) |
| Hosting | DigitalOcean SGP1 |
| AI Gateway | Claude Haiku/Sonnet (primary) → Gemini Flash (failover) — consumed via Netra |
| Messaging | Supabase Realtime (`messaging.*`) where needed; Telegram for owner push |
| Accounting | ERPNext (daily finalized-invoice sync) |

### 5.2 Repository Layout

```
kitluy-chain-portal/
├── src/
│   ├── pages/                 # Route components (Dashboard, Catalog, Stores, ...)
│   ├── components/            # Shared UI (Cd, KPI, Hdr, Badge, HealthBar, ...)
│   ├── lib/
│   │   ├── supabase.ts        # supabase-js client (anon key, RLS-scoped)
│   │   ├── money.ts           # KHR integer formatting (៛, no decimals)
│   │   └── api/               # Typed wrappers around edge-function calls
│   ├── stores/                # Zustand stores
│   └── App.tsx
├── supabase/
│   ├── migrations/            # Claude writes here; BE team applies
│   │   ├── 20260616000001_kitluy_chain_schema_init.sql
│   │   ├── 20260616000002_kitluy_loyalty_chain_init.sql
│   │   ├── 20260616000003_kitluy_chain_b2b_init.sql
│   │   ├── 20260616000004_kitluy_chain_rls.sql
│   │   └── 20260616000005_kitluy_chain_indexes.sql
│   └── functions/             # Deno edge functions (chain-*)
├── wireframes/
│   └── kitluy-chainhq-portal-wireframe-v1.1.0.jsx   # Phase-1 MVP wireframe
└── docs/
    └── kitluy-chain-portal-rebuild-bible-md-v1.0.0.md   # this file
```

### 5.3 Build & Deploy Pipeline

| Artifact | Build | Deploy |
|---|---|---|
| Web SPA | `vite build` → static bundle | DO SGP1 app → CDN |
| Edge functions | Deno bundle | `supabase functions deploy chain-*` (BE team) |
| Migrations | Hand-authored SQL | `supabase db push` by BE team only |

### 5.4 Secrets Inventory (names only — never values)

| Secret / Env Var | Purpose | Consumed by | Rotation |
|---|---|---|---|
| `SUPABASE_URL` | Project URL | Frontend + functions | Static |
| `SUPABASE_ANON_KEY` | RLS-scoped client key | Frontend | On compromise |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged DB access | Edge functions only | Quarterly |
| `ABA_PAYWAY_MERCHANT_ID` | PayWay merchant identity | Subscription + B2B functions | On contract change |
| `ABA_PAYWAY_API_KEY` | PayWay request signing | Subscription + B2B functions | Quarterly |
| `ABA_PAYWAY_RSA_PUBLIC_KEY` | Webhook signature verify | `kitluy-payway-webhook` | On PayWay rotation |
| `TELEGRAM_BOT_TOKEN` | Owner alert push | Alert functions | On compromise |
| `GOOGLE_MAPS_API_KEY` | Territory map render | Frontend | On compromise |
| `NETRA_SERVICE_TOKEN` | AI insight read | AI Advisor function | Per Netra policy |

### 5.5 Permanently Removed Decisions

| Removed item | Reason |
|---|---|
| Zendrite | Removed in favor of Supabase. Never reintroduce. |
| Matrix (messaging) | Removed in favor of Supabase Realtime / SroulApp Engine (Phase 3). |
| B1/B2/B3 commission splits | HSA-only construct, **explicitly excluded** from KitLuy. KitLuy is 0% commission. |
| Franchise deferral to v2.0 | The "Swarm" version deferred franchise; **reinstated** — franchise is supported from launch. |
| Per-store HQ-pricing override | **No store overrides.** HQ pricing + menu items are immutable at store level (locked decision). |

---

## Part 6 — Database Schema (Canonical)

> **CRITICAL RULE:** Where any earlier spec and the live migration disagree, **the migration in this chapter wins**; the conflict moves to Appendix C. This chapter is clean.

### 6.1 Schema Inventory

| Schema | Owner | Purpose | Chain Portal access |
|---|---|---|---|
| `kitluy.chain` | Chain Portal | Chains, franchisees, royalty rules/runs/disputes, territories, location scores, compliance audits/evidence, catalog push log, brand rules, promos | **Read + Write** |
| `kitluy.loyalty_chain` | Chain Portal | Branded loyalty programs, tiers, rule versions, stamp cards, member ledger | **Read + Write** |
| `kitluy.customers` | Chain Portal (this slice) | `chain_b2b_contracts`, B2B invoices | **Read + Write** |
| `core` | Shared | Identity, organizations, stores, users, roles | **Read** (provision stores via function) |
| `pos` | KitLuy POS | Stores, terminals, shifts, sessions | **Read** (store health, vertical_type) |
| `menu` | KitLuy | Service menu items, pricing | **Read + Write-down** (catalog push) |
| `orders` | KitLuy | Orders, lines, events | **Read** (aggregate rollups) |
| `inventory` | KitLuy | Supplies/consumables | **Read** (aggregate supply levels) |
| `finance` | KitLuy | Revenue, P&L inputs, subscription invoices | **Read** + subscription write via function |
| `loyalty` | Rotanak | Coalition tier cache, wallets | **Read-only mirror** |
| `audit` | Shared | Append-only audit log | **Write via function** |

### 6.2 Table Specifications (chain-owned tables)

> Types: `uuid`, `text`, `integer` (KHR is integer — no `numeric` for money), `boolean`, `timestamptz`, `jsonb`, `text[]`. All money columns are `integer` KHR. All timestamps `timestamptz` defaulting `now()` in `Asia/Phnom_Penh`. All tables **RLS enabled**.

**`kitluy.chain.chains`**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `chain_id` | uuid | PK, default `gen_random_uuid()`, NOT NULL | |
| `name` | text | NOT NULL | Brand name |
| `owner_user_id` | uuid | FK→`auth.users.id`, NOT NULL | Shared identity |
| `vertical_type` | text | NOT NULL, CHECK in (`laundry`,`cafe`,`restaurant`,`retail`) | **Immutable** (trigger) — all stores share it |
| `plan` | text | NOT NULL, default `chain` | |
| `billing_mode` | text | NOT NULL, CHECK in (`brand_consolidated`,`franchisee_direct`) | |
| `branded_loyalty_enabled` | boolean | NOT NULL, default `false` | |
| `rotanak_partner` | boolean | NOT NULL, default `false` | Optional ecosystem loyalty |
| `trial_ends_at` | timestamptz | nullable | 14-day trial |
| `status` | text | NOT NULL, CHECK in (`trial`,`active`,`grace`,`suspended`,`cancelled`) | |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**`kitluy.chain.franchisees`**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `franchisee_id` | uuid | PK, NOT NULL | |
| `chain_id` | uuid | FK→`chains.chain_id`, NOT NULL | |
| `name` | text | NOT NULL | Legal entity |
| `contact_user_id` | uuid | FK→`auth.users.id`, nullable | |
| `phone` | text | E.164 format | |
| `type` | text | NOT NULL, CHECK in (`company_owned`,`franchisee`) | |
| `royalty_rule_id` | uuid | FK→`royalty_rules.rule_id`, nullable | Null for `company_owned` |
| `territory_id` | uuid | FK→`territory_polygons.territory_id`, nullable | |
| `since` | date | nullable | |
| `compliance_score` | integer | 0–100, default 0 | Cached |

**`kitluy.chain.store_links`** (which stores belong to which chain/franchisee)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `link_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `franchisee_id` | uuid | FK→`franchisees`, NOT NULL | |
| `store_id` | uuid | FK→`pos.stores`, NOT NULL, UNIQUE | A store belongs to one chain |
| `status` | text | CHECK in (`active`,`onboarding`,`suspended`) | |

**`kitluy.chain.royalty_rules`** (KF-051)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `rule_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `name` | text | NOT NULL | e.g., "Gross Sales %" |
| `model` | text | NOT NULL, CHECK in (`gross_pct`,`net_pct`,`net_pct_min`,`tiered`,`hybrid`) | |
| `rate_pct` | integer | nullable | Whole-number percent (e.g., 5) |
| `min_monthly_khr` | integer | nullable | Minimum floor (KHR) |
| `tiers` | jsonb | nullable | For `tiered`: `[{ up_to_khr, pct }]` |
| `fixed_monthly_khr` | integer | nullable | For `hybrid` |
| `active` | boolean | NOT NULL, default true | |

**`kitluy.chain.royalty_runs`** (append-only ledger)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `run_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `franchisee_id` | uuid | FK→`franchisees`, NOT NULL | |
| `period` | text | NOT NULL | `YYYY-MM` |
| `gross_revenue_khr` | integer | NOT NULL | |
| `net_revenue_khr` | integer | NOT NULL | |
| `rule_id` | uuid | FK→`royalty_rules`, NOT NULL | Rule applied |
| `royalty_due_khr` | integer | NOT NULL | Computed |
| `paid` | boolean | NOT NULL, default false | |
| `paid_at` | timestamptz | nullable | |
| `created_at` | timestamptz | NOT NULL, default `now()` | Append-only |

**`kitluy.chain.royalty_disputes`** (KF-059)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `dispute_id` | uuid | PK | |
| `run_id` | uuid | FK→`royalty_runs`, NOT NULL | |
| `franchisee_id` | uuid | FK→`franchisees`, NOT NULL | |
| `original_due_khr` | integer | NOT NULL | |
| `disputed_amount_khr` | integer | NOT NULL | |
| `reason` | text | NOT NULL | |
| `status` | text | CHECK in (`under_review`,`resolved`,`rejected`) | |
| `resolution` | text | nullable | |
| `filed_at` | timestamptz | NOT NULL, default `now()` | |

**`kitluy.chain.territory_polygons`** (KF-052)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `territory_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `name` | text | NOT NULL | Zone name |
| `franchisee_id` | uuid | FK→`franchisees`, nullable | Null = unassigned |
| `polygon` | jsonb | NOT NULL | GeoJSON polygon (simple, v1) |
| `population` | integer | nullable | Estimated |
| `saturation_pct` | integer | nullable | Cached |

**`kitluy.chain.location_scores`** (KF-057)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `score_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `zone_name` | text | NOT NULL | |
| `population` | integer | nullable | |
| `competitor_count` | integer | nullable | |
| `demand_score` | integer | 0–100 | |
| `traffic_score` | integer | 0–100 | |
| `competitor_gap_score` | integer | 0–100 | |
| `overall_score` | integer | 0–100 | Weighted |
| `status` | text | CHECK in (`recommended`,`evaluate`,`rejected`) | |

**`kitluy.chain.compliance_audits`** (KF-053/054)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `audit_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `store_id` | uuid | FK→`pos.stores`, NOT NULL | |
| `auditor_user_id` | uuid | FK→`auth.users.id`, NOT NULL | |
| `audit_type` | text | CHECK in (`full`,`brand_check`,`mystery_shopper`,`spot_check`) | |
| `pillar_scores` | jsonb | NOT NULL | `{ brand_identity, process, service, experience }` |
| `overall_score` | integer | 0–100 | Weighted |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**`kitluy.chain.compliance_evidence`** (KF-053)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `evidence_id` | uuid | PK | |
| `audit_id` | uuid | FK→`compliance_audits`, NOT NULL | |
| `type` | text | CHECK in (`photo`,`checklist`,`receipt`,`mystery_shopper`) | All four supported |
| `storage_path` | text | nullable | Supabase Storage path for photos |
| `payload` | jsonb | nullable | Checklist answers, etc. |

**`kitluy.chain.brand_rules`** (KF-058 governance source)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `rule_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `category` | text | CHECK in (`receipt`,`pricing`,`service`,`hours`,`staff`,`quality`) | |
| `rule` | text | NOT NULL | Human-readable |
| `locked` | boolean | NOT NULL | true = no store override |
| `params` | jsonb | nullable | e.g., `{ floor_khr, ceiling_khr }` |

**`kitluy.chain.catalog_push_log`** (audit of pushes)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `push_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `service_ids` | text[] | NOT NULL | Menu items pushed |
| `store_ids` | uuid[] | NOT NULL | Targets |
| `pushed_by` | uuid | FK→`auth.users.id` | |
| `result` | jsonb | NOT NULL | `{ pushed, failed[] }` |
| `created_at` | timestamptz | NOT NULL, default `now()` | |

**`kitluy.chain.chain_promos`** (chain-wide promotions)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `promo_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `name` | text | NOT NULL | |
| `type` | text | CHECK in (`discount`,`loyalty_boost`,`referral`,`bundle`) | |
| `value` | integer | NOT NULL | Percent or multiplier |
| `scope` | text | CHECK in (`all_stores`,`selected_stores`) | |
| `store_ids` | uuid[] | nullable | For `selected_stores` |
| `start_date` | date | NOT NULL | |
| `end_date` | date | nullable | Null = ongoing |
| `budget_cap_khr` | integer | nullable | |
| `budget_used_khr` | integer | NOT NULL, default 0 | |
| `status` | text | CHECK in (`active`,`scheduled`,`ended`) | |

**`kitluy.loyalty_chain.programs`** (KF-055 — branded loyalty)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `program_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `name` | text | NOT NULL | Chain-branded |
| `card_design` | jsonb | NOT NULL | Colors, logo path, layout |
| `earn_rate` | jsonb | NOT NULL | e.g., `{ points_per_khr: 1000 }` |
| `published` | boolean | NOT NULL, default false | |

**`kitluy.loyalty_chain.tiers`**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tier_id` | uuid | PK | |
| `program_id` | uuid | FK→`programs`, NOT NULL | |
| `name` | text | NOT NULL | e.g., "Gold" |
| `min_points` | integer | NOT NULL | |
| `multiplier` | text | NOT NULL | e.g., "2x" |
| `discount_pct` | integer | NOT NULL | |

**`kitluy.loyalty_chain.rule_versions`** (versioned rule packs)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `version_id` | uuid | PK | |
| `program_id` | uuid | FK→`programs`, NOT NULL | |
| `version` | integer | NOT NULL | Monotonic |
| `rules` | jsonb | NOT NULL | Full rule pack snapshot |
| `published_at` | timestamptz | nullable | |

**`kitluy.customers.chain_b2b_contracts`** (KF-056)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `contract_id` | uuid | PK | |
| `chain_id` | uuid | FK→`chains`, NOT NULL | |
| `client_name` | text | NOT NULL | e.g., "Sofitel Phnom Penh" |
| `client_type` | text | CHECK in (`hotel`,`institution`,`corporate`) | |
| `store_ids` | uuid[] | NOT NULL | Servicing stores |
| `billing_terms` | text | NOT NULL | e.g., `NET-30` |
| `rate_terms` | text | NOT NULL | Negotiated bulk / per-piece / fixed |
| `status` | text | CHECK in (`active`,`negotiation`,`ended`) | |
| `monthly_revenue_khr` | integer | NOT NULL, default 0 | |
| `since` | date | nullable | |

### 6.3 Enum Catalog

| Enum domain | Values |
|---|---|
| `chain.status` | `active`, `cancelled`, `grace`, `suspended`, `trial` |
| `billing_mode` | `brand_consolidated`, `franchisee_direct` |
| `vertical_type` | `cafe`, `laundry`, `restaurant`, `retail` (immutable per store) |
| `franchisee.type` | `company_owned`, `franchisee` |
| `royalty.model` | `gross_pct`, `hybrid`, `net_pct`, `net_pct_min`, `tiered` |
| `dispute.status` | `rejected`, `resolved`, `under_review` |
| `audit_type` | `brand_check`, `full`, `mystery_shopper`, `spot_check` |
| `evidence.type` | `checklist`, `mystery_shopper`, `photo`, `receipt` |
| `brand_rule.category` | `hours`, `pricing`, `quality`, `receipt`, `service`, `staff` |
| `promo.type` | `bundle`, `discount`, `loyalty_boost`, `referral` |
| `promo.scope` | `all_stores`, `selected_stores` |
| `promo.status` | `active`, `ended`, `scheduled` |
| `b2b.client_type` | `corporate`, `hotel`, `institution` |
| `b2b.status` | `active`, `ended`, `negotiation` |
| `location_score.status` | `evaluate`, `recommended`, `rejected` |

### 6.4 RLS Policy Summary

All `kitluy.chain.*`, `kitluy.loyalty_chain.*`, and `kitluy.customers.chain_b2b_contracts` tables have **RLS enabled**. The canonical pattern:

```sql
-- Read/write only by members of the owning chain, or service role.
USING (
  core.is_service_role()
  OR chain_id IN (
    SELECT c.chain_id FROM kitluy.chain.chains c
    WHERE c.owner_user_id = auth.uid()
       OR c.chain_id IN (SELECT chain_id FROM kitluy.chain.chain_team WHERE user_id = auth.uid())
  )
)
```

- **Read of aggregate store data** (`orders.*`, `finance.*`, `pos.*`) is mediated by **edge functions** running with service role that filter to the chain's `store_ids`. Apps never read raw store tables directly with broad scope.
- **Append-only tables** (`royalty_runs`, `catalog_push_log`, `audit.*`): SELECT per chain; INSERT via service role only.
- **Rotanak `loyalty.*`**: read-only cache; no write policy granted to chain users.

### 6.5 Migration Sequencing

| Order | File | Type |
|---|---|---|
| 1 | `20260616000001_kitluy_chain_schema_init.sql` | Baseline (chains, franchisees, store_links, royalty_*, territory_*, location_scores, compliance_*, brand_rules, catalog_push_log, chain_promos) |
| 2 | `20260616000002_kitluy_loyalty_chain_init.sql` | Branded loyalty (programs, tiers, rule_versions, members, member_ledger) |
| 3 | `20260616000003_kitluy_chain_b2b_init.sql` | B2B (chain_b2b_contracts, b2b_invoices) |
| 4 | `20260616000004_kitluy_chain_rls.sql` | RLS policies + `vertical_type` immutability trigger |
| 5 | `20260616000005_kitluy_chain_indexes.sql` | Indexes (chain_id, period, store_id, status) |

Baseline ecosystem schemas (`core`, `pos`, `menu`, `orders`, `finance`, `loyalty`) are assumed already applied from the shared platform migrations.

### 6.6 Naming Conventions

- **Schema-prefixed** table names always (`kitluy.chain.chains`, never `chains`).
- **snake_case** columns; `_id` suffix for keys; `_khr` suffix for money; `_at` for timestamps; `_pct` for percentages.
- **UUIDs** via `gen_random_uuid()`.
- **Idempotency keys** for sync/op flows: `op_id` (store-side); for edge-function replay, an `Idempotency-Key` header maps to a dedupe row.
- **Money**: `integer` KHR only. No decimals anywhere.

---

## Part 7 — API / Edge Function Specifications

> All writes go through edge functions; the React app never writes raw tables. Every function below runs on Deno, enforces chain ownership, and applies tenant scoping at the **function layer** (service role) plus DB RLS as defense in depth.

### 7.1 Shared / Core Functions (consumed)

| Function | Purpose | Auth |
|---|---|---|
| `kitluy-payway-webhook` | Receives ABA PayWay payment/refund callbacks (subscription + B2B). RSA-verified, idempotent on `tran_id`. | Public URL + signature |
| `pos-store-health` | Returns aggregate heartbeat/online status for a set of stores. | Service role, chain-scoped |
| `auth` (Supabase) | Email/password + phone OTP login (shared identity). | Public |

### 7.2 Chain-Owned Functions

Each spec: **Route · Auth · Headers · Request · Responses · Side Effects · Idempotency · RLS point.**

**`POST /kitluy-catalog-push`**
- **Auth:** chain owner (or chain team with catalog permission).
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <jwt>`, `Idempotency-Key`.
- **Request:**
```json
{
  "chain_id": "uuid",
  "service_ids": ["SVC-001", "SVC-002"],
  "store_ids": ["uuid", "uuid"],
  "pricing": { "SVC-001": { "S": 12000, "M": 15000 } }
}
```
- **Responses:** `200 { pushed: 2, failed: [] }` · `400` invalid price (violates brand floor/ceiling) · `401` not chain owner · `409` replay (returns prior result) · `422` unknown store/service · `500`.
- **Side effects:** upserts `menu.*` rows per store; writes `kitluy.chain.catalog_push_log`. Stores pull the change on next inbox sync.
- **Idempotency:** replay with same key returns the original push result; no double upsert.
- **RLS point:** function verifies `chain_id` ownership; DB RLS on `catalog_push_log`.

**`POST /kitluy-chain-promo-publish`**
- **Auth:** chain owner. **Request:** promo object (Part 6 `chain_promos`). **Responses:** `200 { promo_id }` · `422` overlapping/invalid dates · `409` replay.
- **Side effects:** inserts `chain_promos`; promo auto-applies at target stores (store POS reads active chain promos). **Store-level promo creation is disabled** (governance).

**`POST /kitluy-royalty-run-calc`** (KF-051)
- **Auth:** chain owner or cron (service role).
- **Request:** `{ chain_id, period: "YYYY-MM" }`.
- **Responses:** `200 { run_summary: [{ franchisee_id, royalty_due_khr }] }` · `409` run already exists for period (idempotent — returns existing) · `422` no rule assigned to a franchisee.
- **Side effects:** reads `finance.*` per franchisee's stores; inserts one `royalty_runs` row per franchisee (append-only). Never edits prior runs.
- **Idempotency:** one run per `(chain_id, franchisee_id, period)`; replay returns existing.
- **RLS point:** function-layer chain scope; reads aggregate finance via service role.

**`POST /kitluy-territory-overlap-check`** (KF-052)
- **Auth:** chain owner. **Request:** `{ chain_id, polygon }` (candidate) or `{ chain_id }` (check all). **Responses:** `200 { overlaps: [{ territory_id, area_pct }] }`. **Side effects:** none (pure compute); optionally caches `saturation_pct`.

**`POST /kitluy-location-score-calc`** (KF-057)
- **Auth:** chain owner. **Request:** `{ chain_id, zone_name, population, competitor_count, ... }`. **Responses:** `200 { overall_score, status }`. **Side effects:** inserts `location_scores`.

**`POST /kitluy-compliance-score`** (KF-053/054)
- **Auth:** chain owner or field auditor role. **Request:** audit object with `pillar_scores` + evidence refs. **Responses:** `200 { audit_id, overall_score }`. **Side effects:** inserts `compliance_audits` + `compliance_evidence`; updates franchisee `compliance_score` cache.

**`POST /kitluy-chain-loyalty-publish`** (KF-055)
- **Auth:** chain owner. **Request:** `{ program_id }`. **Responses:** `200 { version }`. **Side effects:** snapshots current rules into `loyalty_chain.rule_versions` (version++), sets `programs.published = true`. Stores begin honoring the branded program on next sync.
- **Idempotency:** publishing an unchanged program is a no-op returning the current version.

**`POST /kitluy-chain-b2b-invoice`** (KF-056)
- **Auth:** chain owner / finance role. **Request:** `{ contract_id, period }`. **Responses:** `200 { invoice_id, amount_khr }`. **Side effects:** generates a B2B invoice row; optionally triggers ABA PayWay collection link.

**`POST /kitluy-chain-subscription-bill`**
- **Auth:** cron (service role). **Request:** `{ chain_id }` or batch. **Responses:** `200 { invoice_id, amount_khr, charged }`. **Side effects:** computes `៛100 + active_stores × ៛50`; charges ABA PayWay; on success marks paid (via webhook); on failure enters dunning → grace → suspend.

---

## Part 8 — Business Logic & Computation Rules

### 8.1 Entity Hierarchy

```
HET Platform (tenant root)
  └─ Chain                 (kitluy.chain.chains)  ← brand / franchisor
       ├─ Franchisee       (company_owned | franchisee)
       │     └─ Store      (pos.stores, 1 vertical, immutable)
       │           ├─ Register / Terminal (pos.*)
       │           │     └─ Shift
       │           │           └─ Session
       │           │                 └─ Order (orders.*)
       │           └─ ...
       ├─ Master Catalog   (menu.* chain rows → pushed down to stores)
       ├─ Brand Standards  (kitluy.chain.brand_rules)
       ├─ Branded Loyalty  (kitluy.loyalty_chain.*)
       └─ B2B Contracts    (kitluy.customers.chain_b2b_contracts)
```

### 8.2 Immutable Rules (architectural, not configurable)

1. **1 Store = 1 Vertical, permanently.** `pos.stores.vertical_type` is set at provisioning and enforced immutable by a DB trigger. A multi-vertical operator runs separate chains.
2. **0% commission.** KitLuy never takes order commission. Revenue is subscription-only. No B1/B2/B3.
3. **No store-level overrides of HQ pricing or menu.** HQ pricing and menu items are immutable at the store level (locked governance decision). Stores may add local items only if explicitly permitted; they can never remove or reprice HQ-pushed items.
4. **Financial documents are append-only.** Royalty runs, invoices, and audit logs are never edited; corrections are new append rows.
5. **Chain loyalty is the chain's own branded program**, separate from Rotanak. Rotanak is optional and additive.
6. **KHR is integer-only.** No decimals anywhere. Symbol `៛` (U+17DB).
7. **Migrations are written by Claude, applied only by the BE team.**

### 8.3 State Machines

**8.3.1 Chain Subscription Lifecycle**

```
            create
              │
              ▼
   ┌────────────────┐  trial_ends_at reached & paid    ┌──────────┐
   │     trial      │ ───────────────────────────────▶ │  active  │
   └───────┬────────┘                                   └────┬─────┘
           │ trial_ends_at reached & unpaid                  │ charge fails
           ▼                                                 ▼
   ┌────────────────┐       grace window elapses        ┌──────────┐
   │     grace      │ ───────────────────────────────▶ │ suspended│
   └───────┬────────┘                                   └────┬─────┘
           │ payment succeeds                                │ payment succeeds
           ▼                                                 ▼
        active ◀──────────────────────────────────────── active
                          (cancel → cancelled, terminal)
```

**8.3.2 Royalty Run Lifecycle**

```
period_open → calc (kitluy-royalty-run-calc) → run_posted (append-only)
   run_posted → [dispute filed] → under_review → resolved | rejected
   resolved → adjustment row appended (original run untouched)
   run_posted → paid (paid_at set)
```

**8.3.3 Compliance Audit Lifecycle**

```
scheduled → in_progress (field audit, evidence captured) → scored (pillars weighted) → closed
   closed → feeds franchisee.compliance_score cache
```

**8.3.4 Chain Promo Lifecycle**

```
draft → scheduled (start_date future) → active (in window) → ended (end_date passed | budget_cap reached)
```

### 8.4 Money Model

- **Storage type:** `integer` KHR. **Never** `numeric`, **never** cents, **never** decimals.
- **Display:** `៛` + comma thousands separator, e.g., `៛350,000`. USD shadow only at explicit final totals when configured: `៛60,000 (~$15.00)`.
- **Exchange rate:** owner-set daily rate at store level (for USD-tendered cash); the Chain Portal displays KHR natively and only shows USD shadow on configured totals.
- **Rounding helper:** `lib/money.ts → formatKHR(n: integer): string`. There is **no** sub-unit rounding because there is no sub-unit.
- **Formulas:**
  - Chain subscription due = `100 + (active_store_count × 50)` KHR.
  - Royalty (gross %) = `gross_revenue_khr × rate_pct / 100`.
  - Royalty (net % + min) = `max(net_revenue_khr × rate_pct / 100, min_monthly_khr)`.
  - Royalty (tiered) = sum over tiers of `min(tier_band, remaining) × tier_pct / 100`.
  - Royalty (hybrid) = `gross_revenue_khr × rate_pct / 100 + fixed_monthly_khr`.
  - Compliance overall = `Σ(pillar_score × pillar_weight) / Σ(weight)`, weights: Brand Identity 25, Process 30, Service 25, Experience 20.
  - Store health = weighted avg: SLA 30%, rating 25%, complaints 20%, POS uptime 15%, volume trend 10%.

### 8.5 Catalog Push → Store Materialization Flow

```
1. Owner edits Master Catalog (chain-level menu rows).
2. Owner selects services + target stores → kitluy-catalog-push.
3. Function validates prices against brand_rules floors/ceilings.
4. Function upserts per-store menu.* rows (store catalog = HQ catalog projection).
5. Function appends catalog_push_log.
6. Store Pi Hub pulls the new menu on next inbox sync (eventually consistent).
7. Store POS now sells the pushed services at HQ prices. Store cannot remove/reprice them.
```

### 8.6 "Inventory" / Supply Deduction (Laundry)

Laundry tracks **consumable supplies** (detergent, softener, tags, hangers, poly bags), **not** SKU inventory. The Chain Portal **reads** aggregate supply levels across stores and surfaces reorder alerts. Actual deduction happens at the store POS on the laundry order lifecycle; the Chain Portal does not deduct. Reorder threshold breaches push Telegram alerts to store managers (store-side) and roll up to the Chain Portal's Inventory analytics.

### 8.7 Subscription Lifecycle (detail)

| State | Trigger in | Behavior | Data retention |
|---|---|---|---|
| `trial` | Chain created | Full access, 14 days | Full |
| `active` | First successful charge | Full access | Full |
| `grace` | Charge failed at renewal | Full access, dunning banner, retry 3× / 7 days | Full |
| `suspended` | Grace elapsed unpaid | Read-only or locked; stores keep operating offline-capable; rollups frozen | Retained ≥ 90 days |
| `cancelled` | Owner cancels | Terminal; export window then archival | Per policy |

Reactivation path: pay outstanding → return to `active`.

### 8.8 Conflict Resolution

| Data class | Policy |
|---|---|
| Operational (store status, supply counts read by portal) | Last-write-wins; portal shows "as of last sync" |
| Financial (royalty runs, B2B invoices, subscription invoices) | **Append-only**; corrections are new rows; originals immutable |
| Catalog (HQ → store) | HQ is authoritative; store cannot diverge on HQ items |
| Loyalty (branded) | Versioned via `rule_versions`; publish snapshots a new version |

### 8.9 Tax / Compliance Stub

Cambodia VAT handling is **stubbed** in v1.0.0 (no VAT line computed by the Chain Portal). B2B invoices carry a `rate_terms` free-field that may include tax language. Future hook: a `tax_pct` parameter on B2B invoices and a VAT summary in finance rollups. ERPNext receives finalized invoices for accounting treatment.

---

## Part 9 — Design System & UI Inventory

### 9.1 Core Tokens

| Token | Value |
|---|---|
| Primary | Sky Blue `#0EA5E9` |
| Primary dark / deep | `#0284C7` / `#075985` |
| Dark sidebar | `#0F172A` |
| Accent (chain) | `#F5A623` (also Rotanak mirror) |
| Success / Warn / Danger | `#10B981` / `#F59E0B` / `#EF4444` |
| Netra purple | `#8B5CF6` |
| Font | DM Sans |
| Card radius | 12px |
| Base grid | 16px |
| Background | `#F5F7FA` |

### 9.2 Mirror Banners

| Source | Banner color | Placement |
|---|---|---|
| Rotanak (coalition loyalty, optional) | **Gold `#F5A623`** | Top of any Rotanak-sourced panel |
| Netra (AI insights / Chain Advisor) | **Purple `#8B5CF6`** | Top of any Netra-sourced panel |

A panel showing the chain's **own** branded loyalty carries **no** mirror banner (it is owned data, not a mirror).

### 9.3 Localization & Formatting

| Aspect | Rule |
|---|---|
| Currency | `៛` (U+17DB), integer only, comma thousands, e.g., `៛350,000` |
| Languages | English (primary), Khmer ខ្មែរ (secondary, allow **40% wider** containers), Chinese 中文 (tertiary where applicable) |
| Phone | E.164 only, e.g., `+855 12 345 678` |
| Timezone | `Asia/Phnom_Penh` (UTC+7) |
| Locale / Date | `en-KH`, `DD/MM/YYYY` |

### 9.4 Screen Patterns

The Chain Portal is a **web dashboard** (not a terminal POS). Patterns: left dark sidebar (`#0F172A`) with grouped, collapsible nav; top bar with Cambodia time + plan badge + owner avatar; content area of cards (`Cd`), KPI tiles, tables, and `HealthBar` meters. Responsive down to tablet width. No KDS/CDS terminal patterns (those belong to the POS).

### 9.5 Wireframe References

- **File:** `kitluy-chainhq-portal-wireframe-v1.1.0.jsx` (Phase-1 MVP baseline) — **2,011 lines, 36 routes, 13 sidebar groups.**
- **Renderer constraints (mandatory):** no optional chaining (`?.`); no array destructuring in `useState` (use `var s = useState(); var x = s[0]; var setX = s[1]`); no JSX attribute string concat without braces; file < ~270KB; define all `var` page components **before** the `ROUTES` object; new pages as single-line arrow functions with 2–3 mock entries.
- **Sidebar groups (13):** Dashboard, Catalog Control, Stores, Operations, Promotions, Brand Standards, Finance, Franchise, Staff, Chain Loyalty, Analytics, Marketing, Settings.

### 9.6 App-Specific Brand Overrides (reference)

Sibling apps have distinct identities (e.g., Rotanak gold `#F5A623`, Netra purple `#8B5CF6`). The Chain Portal uses the KitLuy ecosystem default (sky blue) and only borrows gold/purple for the **mirror banners** above.

---

## Part 10 — Security Model & RBAC

### 10.1 Role Definitions

| Role | Home | Scope |
|---|---|---|
| Chain Owner | Chain Portal | Full access to all stores, finance, staff, settings, billing for **their chain** |
| Regional Manager | Chain Portal | View all stores in a region, manage staff, view finance (no billing) |
| Finance Manager (HQ) | Chain Portal | Finance, royalties, B2B invoicing; no brand-rule edits |
| Field Auditor | Chain Portal (mobile audit) | Create compliance audits + evidence only |
| Store Manager | Seller Portal | Single store (read in Chain Portal context only) |
| Shift Lead / Cashier | POS | Store terminal (not Chain Portal users) |

### 10.2 Permission Matrix (Chain Portal)

| Capability | Owner | Regional Mgr | Finance Mgr | Field Auditor |
|---|---|---|---|---|
| View aggregate dashboard | ✓ | ✓ | ✓ | |
| Edit master catalog / push | ✓ | | | |
| Create chain promo | ✓ | ✓ | | |
| Edit brand standards | ✓ | | | |
| Run royalties | ✓ | | ✓ | |
| Resolve royalty disputes | ✓ | | ✓ (PIN-gated) | |
| Manage franchisees / territories | ✓ | ✓ (view) | | |
| Edit branded loyalty / publish | ✓ | | | |
| B2B contracts / invoicing | ✓ | | ✓ | |
| Compliance audit (create) | ✓ | ✓ | | ✓ |
| Subscription & billing | ✓ | | view | |
| Manage HQ team / permissions | ✓ | | | |

### 10.3 PIN / Auth Model

- **Chain Portal users** authenticate via full Supabase auth: **email/password or phone OTP** (shared identity, one `auth.users.id`). Session timeout per platform policy.
- **There is no 4-digit POS PIN in the Chain Portal** (PINs are a store-terminal construct). Sensitive chain actions use re-auth or a confirm-with-reason step rather than a terminal PIN. (See §10.4.)
- All passwords/PINs ecosystem-wide are hashed with **Argon2id**.

### 10.4 Sensitive Action Gating

| Action | Gate |
|---|---|
| Resolve/adjust a royalty dispute | Reason code + Finance/Owner role; logged |
| Delete/suspend a franchisee | Owner only + confirm |
| Change billing mode | Owner only + confirm |
| Publish branded loyalty version | Owner only |
| Push catalog overriding active prices | Validated against floors/ceilings; logged |

### 10.5 Audit Logging

Every administrative action writes to the audit log (`audit.*` / `kitluy.chain.catalog_push_log` for pushes) with: **actor (`auth.users.id`), action, target, before/after (jsonb where applicable), timestamp (`timestamptz`).** The Chain Portal surfaces these under Settings → Audit Logs. Append-only; never edited.

### 10.6 Encryption Standards

- **At rest:** Supabase-managed Postgres encryption.
- **In transit:** TLS 1.2+ for all HTTPS and DB connections.
- **Field-level:** PII (phone, contact) stored normally but access-controlled by RLS; passwords hashed with Argon2id.
- **Key management:** secrets in Supabase project env / vault; service-role key never shipped to the browser.

---

## Part 11 — Deployment & Infrastructure

### 11.1 Cloud Provisioning

| Item | Value |
|---|---|
| Backend | Supabase project `qneduoifcsvjajeqmvgb` |
| Region | ap-southeast-1 / SGP1 (Singapore) |
| Database | PostgreSQL 17 |
| Frontend host | DigitalOcean SGP1 (app + CDN) |
| Storage | Supabase Storage buckets (compliance evidence photos) |

### 11.2 Local Node Provisioning

**N/A — the Chain Portal has no local node.** Store Pi 5 hubs are provisioned per the Seller/POS bibles. The Chain Portal only consumes the cloud-synced copy of store data.

### 11.3 Terminal Pairing

**N/A for the Chain Portal.** Store terminals pair to their store's Pi Hub (see POS bible). The Chain Portal never pairs to hardware.

### 11.4 Secrets Injection

Secrets reach **edge functions** via Supabase function env (set by BE team); the **frontend** receives only public keys (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_MAPS_API_KEY`) at build time. **Service-role key and PayWay/Telegram secrets live only in edge functions** — never in the SPA. Vault/env policy: no secret is committed to Git.

### 11.5 Certificate & Domain Management

Custom domain (e.g., `chain.kitluy.com`) terminates TLS at the DO app/CDN edge. Supabase endpoints use Supabase-managed certificates. CDN fronts static assets.

---

## Part 12 — Monitoring, Observability & Alerting

### 12.1 Health Checks

| Endpoint | Frequency | Expected | Timeout |
|---|---|---|---|
| SPA root (CDN) | 1 min | 200 | 5s |
| Supabase REST/Auth | 1 min | 200 | 5s |
| `kitluy-royalty-run-calc` (synthetic) | Daily | 200 + valid summary | 30s |

### 12.2 Heartbeat Semantics

The Chain Portal itself is stateless web + functions (no heartbeat of its own). It **reads** store heartbeats via `pos-store-health`. A store with **no heartbeat** is shown as offline in the aggregate; this must **not** be interpreted as zero sales (the store may be WAN-partitioned and selling offline).

### 12.3 Log Aggregation

Edge-function logs live in Supabase logs (retention per plan). Client errors via Sentry. Searchable fields: `chain_id`, `function`, `tran_id`, `period`.

### 12.4 Metrics & Dashboards

Key metrics: royalty-run success rate, catalog-push partial-failure rate, subscription dunning count, B2B invoice aging, store-rollup staleness (max sync lag across stores).

### 12.5 Alert Thresholds

| Condition | Alert |
|---|---|
| Royalty run fails for a chain | P2 → Telegram to owner + ops |
| Catalog push partial failure (≥1 store failed) | P3 → owner |
| Subscription charge fails (enters grace) | P2 → owner dunning |
| Store rollup staleness > 24h for an active store | P3 → ops (possible sync break) |
| B2B invoice overdue > NET terms | P3 → finance |

### 12.6 Incident Runbooks (lightweight)

- **Supabase/API down:** Chain Portal read/write halts; stores keep operating offline; wait for restore, then verify rollups catch up.
- **PayWay timeout during subscription charge:** do **not** retry blindly — query `tran_id` status; if unknown, hold and alert.
- **Royalty run produced wrong base:** do **not** edit the run; file a correction (append adjustment) and open Appendix-C item.

---

## Part 13 — Backup & Disaster Recovery

### 13.1 Backup Schedule & Scope

| Asset | Frequency | Retention |
|---|---|---|
| Cloud Postgres (all schemas incl. `kitluy.chain.*`) | Daily snapshot + PITR | 30 days |
| Supabase Storage (compliance evidence) | Daily | 30 days |
| Store Pi NVMe | Per store policy (POS bible) | N/A to Chain Portal |

### 13.2 Restore Procedures

- **Cloud DB corruption:** restore from Supabase PITR to the last good point; re-verify chain rollups and re-run any affected (non-posted) royalty calculations. Posted (append-only) runs are immutable and survive.
- **Accidental chain deletion:** restore the chain's rows from PITR; chains are soft-deletable in practice (status `cancelled`) to avoid hard loss.
- **Total store rebuild:** handled by the store's own DR (POS bible); the Chain Portal simply resumes reading once the store re-syncs.

### 13.3 RPO / RTO Targets

| Tier | RPO | RTO |
|---|---|---|
| Cloud DB (financial/append-only) | ≤ 5 min (PITR) | ≤ 1 hour |
| Chain Portal frontend | 0 (stateless, redeploy) | ≤ 15 min |
| Store data freshness | Bounded by store sync lag | N/A |

### 13.4 Degraded Modes

| Failure | Chain Portal behavior |
|---|---|
| Internet/WAN down at HQ | Owner cannot reach the portal (cloud-only); stores keep operating locally |
| A store WAN-partitioned | That store shows stale/offline; rest of chain unaffected |
| Rotanak down | Rotanak mirror unavailable; branded loyalty unaffected |
| Netra down | AI Advisor empty; everything else works |
| PayWay down | Subscription/B2B charges deferred + retried; access continues during grace |

---

## Part 14 — Standard Operating Procedures (SOPs)

> Each SOP: **Trigger · Actor · Steps · Expected Result · Fallback.**

### 14.1 Provisioning SOPs

**SOP-1 New Chain**
- **Trigger:** A multi-store owner subscribes to the Chain Plan.
- **Actor:** HET onboarding (Admin Portal) + chain owner.
- **Steps:** 1) Create owner account (email/password or phone OTP). 2) Create `chains` row with `vertical_type`, `billing_mode`, 14-day `trial_ends_at`. 3) Set status `trial`. 4) Email/Telegram welcome.
- **Expected:** Owner logs into Chain Portal, sees empty dashboard, can add stores.
- **Fallback:** If provisioning fails mid-way, delete the partial chain row and retry (idempotent on owner+name).

**SOP-2 New Store (under a chain)**
- **Trigger:** Chain opens a new location.
- **Actor:** Chain owner.
- **Steps:** 1) Create `pos.stores` row (vertical = chain vertical, immutable). 2) Link via `store_links` (status `onboarding`). 3) Push master catalog to the new store. 4) Provision store hardware per POS bible. 5) Flip `store_links.status` to `active` once POS terminals heartbeat.
- **Expected:** Store appears in Store Directory; once live, contributes to rollups.
- **Fallback:** Onboarding store shows "setting up" until terminals pair.

**SOP-3 New Franchisee**
- **Trigger:** Chain signs an independent operator.
- **Actor:** Chain owner.
- **Steps:** 1) Create `franchisees` row (type `franchisee`). 2) Assign a `royalty_rule_id`. 3) Assign a `territory_id` (run overlap check first). 4) Link the franchisee's store(s).
- **Expected:** Franchisee appears in directory; royalties compute next period.
- **Fallback:** If territory overlaps, resolve before assigning.

### 14.2 Daily / Periodic Operations

**SOP-4 Push a Catalog Change** — Trigger: price/service change. Actor: Owner. Steps: edit Master Catalog → select services + stores → push → verify per-store status. Expected: stores reflect change on next sync. Fallback: re-push failed stores.

**SOP-5 Run a Royalty Period** — Trigger: month close. Actor: Owner/Finance. Steps: open Royalty Ledger → run period → review per-franchisee dues → mark paid as collected. Expected: append-only runs posted. Fallback: disputes filed are reviewed, never edited in place.

**SOP-6 Publish Branded Loyalty Change** — Trigger: loyalty tweak. Actor: Owner. Steps: Loyalty Studio → edit card/rules/tiers → publish (version++). Expected: stores honor new version next sync. Fallback: re-publish; prior versions retained.

**SOP-7 Field Compliance Audit** — Trigger: scheduled/spot audit. Actor: Field Auditor (tablet). Steps: select store → audit type → walk checklist, capture photos → submit. Expected: `compliance_audits` + evidence saved; score updates. Fallback: partial audit saved as draft.

**SOP-8 Issue a B2B Invoice** — Trigger: month close for a contract. Actor: Owner/Finance. Steps: B2B → select contract + period → generate invoice → send/collect. Expected: invoice row + optional PayWay link. Fallback: mark paid manually on bank confirmation.

### 14.3 Exception Handling

| Exception | Steps |
|---|---|
| Store rollup stale > 24h | Check store heartbeat; if WAN-partitioned, expect catch-up on reconnect; if sync broken, escalate to POS support |
| Subscription charge failed | Banner + dunning; owner updates card; retry; grace before suspend |
| Royalty base disputed | File dispute → review → resolve via append adjustment |
| Catalog push partial failure | Re-push failed stores; check store online status |
| Pricing override attempt at store | Blocked by governance; appears in audit log as denied |

### 14.4 Recovery SOPs

| Recovery | Steps |
|---|---|
| Restore chain after accidental cancel | PITR restore chain rows; set status back to `active` |
| Re-issue a wrong B2B invoice | Void (status) + append a corrected invoice; never edit original |
| Recover from bad royalty run | Append correction; open Appendix-C item; communicate to franchisee |

---

## Part 15 — QA Test Matrix & Acceptance Criteria

> Per scenario: **ID · Name · Path · Pass Condition (DB + UI) · Validator.**

| ID | Name | Path (user actions) | Pass Condition | Validator |
|---|---|---|---|---|
| QA-01 | Create chain (trial) | Onboard new chain | `chains.status='trial'`, `trial_ends_at = now()+14d`; dashboard renders empty | `SELECT status,trial_ends_at FROM kitluy.chain.chains WHERE chain_id=?` |
| QA-02 | Add 2 stores | Create + link two stores | 2 `store_links` rows; both appear in directory | `SELECT count(*) FROM kitluy.chain.store_links WHERE chain_id=?` → 2 |
| QA-03 | Catalog push happy path | Push 2 services to 2 stores | `catalog_push_log.result.pushed=2,failed=[]`; store menu rows upserted | `SELECT result FROM kitluy.chain.catalog_push_log ORDER BY created_at DESC LIMIT 1` |
| QA-04 | Catalog push respects floor | Push price below brand floor | `400`; no menu write; UI error | function returns 400; menu row unchanged |
| QA-05 | Store cannot override HQ price | Attempt store reprice of HQ item | Denied; audit log "Pricing Override Denied" | `SELECT * FROM audit... WHERE action='Pricing Override Denied'` |
| QA-06 | Royalty run (gross %) | Run period for a 5% franchisee | One `royalty_runs` row; `royalty_due = gross×5/100` | `SELECT royalty_due_khr FROM kitluy.chain.royalty_runs WHERE period=? AND franchisee_id=?` |
| QA-07 | Royalty run idempotent | Re-run same period | No duplicate; returns existing run | row count unchanged for `(chain,franchisee,period)` |
| QA-08 | Royalty min floor | Net% run where computed < floor | `royalty_due = min_monthly_khr` | compare to floor |
| QA-09 | Dispute is append-only | File + resolve a dispute | Original run row unchanged; new adjustment appended | original `royalty_runs.royalty_due_khr` unchanged |
| QA-10 | Territory overlap alert | Assign overlapping polygon | Overlap returned; UI warns; assignment blocked until resolved | `kitluy-territory-overlap-check` returns non-empty overlaps |
| QA-11 | Location score | Score a candidate zone | `location_scores` row; `status` set by `overall_score` | `SELECT overall_score,status FROM kitluy.chain.location_scores ...` |
| QA-12 | Compliance score weighting | Submit audit with pillar scores | `overall_score = Σ(pillar×weight)/Σweight`; evidence rows saved | recompute vs stored |
| QA-13 | Branded loyalty publish | Publish a program | `rule_versions.version` increments; `programs.published=true` | `SELECT max(version) FROM kitluy.loyalty_chain.rule_versions WHERE program_id=?` |
| QA-14 | Loyalty ≠ Rotanak isolation | Earn branded points; check Rotanak | Branded ledger updated; Rotanak wallet untouched | branded ledger +; `loyalty.*` unchanged |
| QA-15 | B2B invoice | Generate invoice for a contract | Invoice row; amount = contract monthly; optional PayWay link | `SELECT amount_khr FROM ... b2b_invoices ...` |
| QA-16 | Subscription lifecycle | Force trial expiry unpaid → grace → pay → active | `status` transitions `trial→grace→active`; charges via PayWay | `SELECT status FROM kitluy.chain.chains WHERE chain_id=?` over time |
| QA-17 | Store isolation (no leak) | Owner of Chain A queries Chain B store | RLS denies; zero rows | cross-chain `SELECT` returns 0 |
| QA-18 | Offline store rollup | Partition a store, check dashboard | Store shows offline/stale, **not** zero sales; label "as of last sync" | UI shows stale badge; rollup excludes unsynced |
| QA-19 | KHR integer money | Render all money fields | No decimals anywhere; `៛` symbol; comma thousands | UI snapshot; no `.` in money |
| QA-20 | Audit log completeness | Perform 3 admin actions | 3 audit rows with actor/action/target/timestamp | `SELECT count(*) FROM audit... WHERE actor=? AND created_at>=?` |

---

## Part 16 — Go-Live Checklist

### 16.1 Infrastructure
- [ ] Migrations 1–5 applied to prod by BE team (chain, loyalty_chain, b2b, RLS, indexes).
- [ ] RLS enabled & verified on all `kitluy.chain.*`, `kitluy.loyalty_chain.*`, `chain_b2b_contracts`.
- [ ] `vertical_type` immutability trigger live and tested.
- [ ] Edge functions deployed: catalog-push, chain-promo-publish, royalty-run-calc, territory-overlap-check, location-score-calc, compliance-score, chain-loyalty-publish, chain-b2b-invoice, chain-subscription-bill.
- [ ] `kitluy-payway-webhook` reachable at public URL; RSA verify on.
- [ ] Secrets set (service role, PayWay, Telegram, Maps) — none in the SPA bundle.

### 16.2 Data & Config
- [ ] Chain plan price book seeded (៛100 HQ + ៛50/store).
- [ ] Royalty rule template library seeded (gross %, net %, tiered, hybrid).
- [ ] Brand-standard rule seed loaded (receipt, pricing, service, hours, staff, quality).
- [ ] Test chain + 2 stores provisioned.

### 16.3 Hardware
- [ ] N/A for Chain Portal. (Store hardware validated per POS bible.)

### 16.4 People
- [ ] Owner account created; HQ team invited with correct roles.
- [ ] Field auditor account (if used) created with audit-only scope.
- [ ] Owner trained on catalog push, royalty run, loyalty publish; SOPs available.

### 16.5 Validation
- [ ] All QA-01…QA-20 pass.
- [ ] Offline-store rollup test passes (stale ≠ zero).
- [ ] Branded-loyalty-vs-Rotanak isolation verified.
- [ ] Cross-chain RLS isolation verified.

### 16.6 Pilot & Monitor
- [ ] Soft-launch with one real chain.
- [ ] Royalty-run + catalog-push alerts wired to Telegram.
- [ ] Daily reconciliation cadence agreed (rollup staleness watched).

---

## Part 17 — Module / Feature Inventory

### 17.1 Build-by-Build Feature Table (Chain Portal)

| Module (sidebar group) | Capability areas | Backend dependencies |
|---|---|---|
| Dashboard | Aggregate KPIs, store performance, revenue trend, recent orders | reads `orders.*`, `finance.*`, `pos-store-health` |
| Catalog Control | Master catalog, push to stores | `menu.*`, `kitluy-catalog-push`, `catalog_push_log` |
| Stores | Directory, store detail, health | `pos.*`, `pos-store-health` |
| Operations | Cross-store order monitor, throughput, SLA | reads `orders.*` |
| Promotions | Chain-wide promos, scheduling | `chain_promos`, `kitluy-chain-promo-publish` |
| Brand Standards | Compliance rules, store compliance | `brand_rules` |
| Finance | Revenue rollup, store P&L | reads `finance.*` |
| Franchise | Directory, royalty ledger, compliance, territories | `franchisees`, `royalty_runs`, `kitluy-royalty-run-calc`, `territory_polygons` |
| Staff | All staff, permissions | `core.*` |
| Chain Loyalty | Program builder, tiers & rewards, analytics, Rotanak partnership | `loyalty_chain.*`, `kitluy-chain-loyalty-publish`, `loyalty.*` (mirror) |
| Analytics | Revenue, staff, inventory, customers, AI advisor | reads `finance.*`,`orders.*`,`inventory.*`; Netra |
| Marketing | Campaigns, create campaign | Netra; Telegram |
| Settings | Profile, subscription & billing, HQ team, integrations, audit logs | `chains`, `kitluy-chain-subscription-bill`, `audit.*` |

### 17.2 Feature-ID System

- **Phase-1 MVP** = the 13 handbook-aligned modules above (no KF research features in v1.0.0 baseline).
- **Phase-2 research features** use prefix **`KF-0NN`** (chain series): KF-051 royalty rule templates, KF-052 territory polygons, KF-053 compliance audits + evidence, KF-054 compliance scoring engine, KF-055 loyalty studio, KF-056 B2B contracts, KF-057 location scoring, KF-058 override governance, KF-059 royalty disputes, KF-060 field audit mobile. These cross-reference the QA scenarios and edge functions above and are **documented but gated to Phase 2**.

### 17.3 Mobile ↔ Web Parity Rules

The Chain Portal is **web-only in v1.0.0**. There is **no** mobile form-factor pairing (unlike Seller Portal ↔ Seller App or POS desktop ↔ POS mobile). A responsive layout covers tablets. The lone exception on the roadmap is the **Field Audit mobile mode** (KF-060), which is a tablet-executed audit surface — a Phase-2 capability, not a full mobile app.

---

## Part 18 — Version History

| Version | Date | Author | Change Summary | Migration Files | Reconciliation Closed |
|---|---|---|---|---|---|
| v1.0.0 | 16 Jun 2026 | Het Sovannara | Initial Chain Portal Rebuild Bible. Parts 0–18 + Appendices A–D. Scope: Laundry P1.0 MVP, 13 modules, chain-owned schema, 9 edge functions. | `20260616000001`–`20260616000005` | Opens RC-01..RC-05 (see Appendix C) |

Linked wireframe: `kitluy-chainhq-portal-wireframe-v1.1.0.jsx`.

---

## Appendix A — Data Dictionary

> The most rebuild-critical chain-owned tables, field-level.

**`kitluy.chain.chains`**

| Column | Type | Constraints | FK |
|---|---|---|---|
| chain_id | uuid | PK, default gen_random_uuid() | — |
| name | text | NOT NULL | — |
| owner_user_id | uuid | NOT NULL | auth.users.id |
| vertical_type | text | NOT NULL, CHECK(laundry/cafe/restaurant/retail), immutable | — |
| billing_mode | text | NOT NULL, CHECK(brand_consolidated/franchisee_direct) | — |
| branded_loyalty_enabled | boolean | NOT NULL default false | — |
| rotanak_partner | boolean | NOT NULL default false | — |
| trial_ends_at | timestamptz | nullable | — |
| status | text | NOT NULL, CHECK(trial/active/grace/suspended/cancelled) | — |
| created_at | timestamptz | NOT NULL default now() | — |

**`kitluy.chain.royalty_rules`**

| Column | Type | Constraints | FK |
|---|---|---|---|
| rule_id | uuid | PK | — |
| chain_id | uuid | NOT NULL | chains |
| model | text | NOT NULL, CHECK(gross_pct/net_pct/net_pct_min/tiered/hybrid) | — |
| rate_pct | integer | nullable | — |
| min_monthly_khr | integer | nullable (KHR) | — |
| tiers | jsonb | nullable | — |
| fixed_monthly_khr | integer | nullable (KHR) | — |
| active | boolean | NOT NULL default true | — |

**`kitluy.chain.royalty_runs`** (append-only)

| Column | Type | Constraints | FK |
|---|---|---|---|
| run_id | uuid | PK | — |
| chain_id | uuid | NOT NULL | chains |
| franchisee_id | uuid | NOT NULL | franchisees |
| period | text | NOT NULL (YYYY-MM) | — |
| gross_revenue_khr | integer | NOT NULL | — |
| net_revenue_khr | integer | NOT NULL | — |
| rule_id | uuid | NOT NULL | royalty_rules |
| royalty_due_khr | integer | NOT NULL | — |
| paid | boolean | NOT NULL default false | — |
| created_at | timestamptz | NOT NULL default now() | — |

**`kitluy.chain.compliance_audits`**

| Column | Type | Constraints | FK |
|---|---|---|---|
| audit_id | uuid | PK | — |
| chain_id | uuid | NOT NULL | chains |
| store_id | uuid | NOT NULL | pos.stores |
| auditor_user_id | uuid | NOT NULL | auth.users.id |
| audit_type | text | CHECK(full/brand_check/mystery_shopper/spot_check) | — |
| pillar_scores | jsonb | NOT NULL | — |
| overall_score | integer | 0–100 | — |
| created_at | timestamptz | NOT NULL default now() | — |

**`kitluy.loyalty_chain.programs`**

| Column | Type | Constraints | FK |
|---|---|---|---|
| program_id | uuid | PK | — |
| chain_id | uuid | NOT NULL | chains |
| card_design | jsonb | NOT NULL | — |
| earn_rate | jsonb | NOT NULL | — |
| published | boolean | NOT NULL default false | — |

**`kitluy.customers.chain_b2b_contracts`**

| Column | Type | Constraints | FK |
|---|---|---|---|
| contract_id | uuid | PK | — |
| chain_id | uuid | NOT NULL | chains |
| client_type | text | CHECK(hotel/institution/corporate) | — |
| store_ids | uuid[] | NOT NULL | pos.stores |
| billing_terms | text | NOT NULL | — |
| status | text | CHECK(active/negotiation/ended) | — |
| monthly_revenue_khr | integer | NOT NULL default 0 | — |

**Enum values referenced:** see Part 6, §6.3 (full catalog).

---

## Appendix B — FAQ (Reference, Not Rebuild-Critical)

**For Operators (chain owners)**
- *Can a store lower a price below my set price?* No — HQ pricing is immutable at the store level (Part 8, §8.2).
- *Is my loyalty the same as Rotanak?* No — you run your **own** branded program. Rotanak is optional and additive (Part 1, §1.6).
- *What do I pay?* ៛100/month + ៛50 per store. 0% commission (Part 2, §2.5).

**For Staff (HQ team)**
- *Why can't I see billing?* Only the Owner role sees billing (Part 10, §10.2).
- *Why did a store show offline but still had sales?* The store was WAN-partitioned and sold offline; numbers catch up on reconnect (Part 12, §12.2).

**For Investors**
- *What's the moat?* Aggregation + franchise tooling + ecosystem (Part 2, §2.6).
- *Why SaaS not commission?* Predictable revenue; merchants keep 100% of sales (Part 2, §2.5).

**For Engineers**
- *Where does money live?* `integer` KHR, no decimals (Part 8, §8.4).
- *How is a royalty corrected?* Append an adjustment; never edit the run (Part 8, §8.8).
- *Where do I add a new chain table?* `kitluy.chain.*` with RLS + migration; Claude writes, BE applies (Part 6).

---

## Appendix C — Reconciliation Register (Technical Debt)

> Nothing in Parts 1–18 contains an unresolved conflict. All open items live here.

| ID | Conflict / Ambiguity | Affected Parts | Recommended Resolution | Owner | Target Version |
|---|---|---|---|---|---|
| RC-01 | Chain branded loyalty vs Rotanak read-only mirror (café handbook treats Rotanak as the loyalty surface). | 1, 4, 9, 17 | Confirm in Master Context that chain-level branded loyalty is a distinct construct from store-level Rotanak mirror; document both layers. | Het | v1.1.0 |
| RC-02 | B1/B2/B3 commission appears in HSA bibles; must never bleed into KitLuy. | 1, 5, 8 | Keep an explicit "excluded" note in any shared doc; lint for B1/B2/B3 in KitLuy contexts. | Het | v1.1.0 |
| RC-03 | Product id naming: `kitluy-chain-hq-portal` (master handbook) vs `kitluy-chain-portal` (this bible / wireframe). | 2, 5 | Standardize on `kitluy-chain-portal`; update Master Context §3. | Het | v1.1.0 |
| RC-04 | KF-051..KF-060 (Phase-2 features) are specified here but gated out of the v1.0.0 build. | 6, 7, 15, 17 | On Phase-2 kickoff, promote KF features into the live wireframe + migrations; bump bible. | Het | v2.0.0 |
| RC-05 | VAT/tax is stubbed; B2B invoices carry free-text tax terms only. | 8, §8.9 | Add `tax_pct` to B2B invoices + VAT summary in finance rollups when tax treatment is finalized. | Het | TBD |
| RC-06 | Chain Portal mobile form factor undecided (web-only in v1.0.0). | 2, 17 | Decide whether to ship a chain mobile app or rely on responsive web + field-audit tablet mode. | Het | TBD |

---

## Appendix D — Investor / Stakeholder Narratives

> **Non-critical for reconstruction.**

**Pitch.** KitLuy is Cambodia's Shopify for physical-service SMEs. The Chain Portal is the layer that turns a single successful laundry shop into a **scalable brand**: one HQ dashboard to push a master menu to every store, run franchise royalties, enforce brand standards, design a branded loyalty program, and land institutional B2B contracts — at ៛50 per store per month, 0% commission.

**Problem.** Cambodian chains run on spreadsheets and WhatsApp. Franchise royalties are computed by hand; pricing drifts store to store; there is no cross-store visibility. Enterprise franchise software is priced for the West.

**Demo script.** Create a chain → add two laundry stores → push a "Dry Clean" price to both → watch both stores adopt it → run March royalties for an independent franchisee → publish a "10th Wash Free" branded loyalty card → show the aggregate dashboard reflecting both stores in real time.

**Traction / Ask.** (Placeholder — populate with live pilot metrics and the current raise.) `[REQUIRED: pilot chain count, store count, MRR, raise ask]`

---

*End of `kitluy-chain-portal-rebuild-bible-md-v1.0.0.md`.*
