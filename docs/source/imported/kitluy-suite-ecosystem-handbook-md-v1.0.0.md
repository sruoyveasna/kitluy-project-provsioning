# KitLuy Suite — Ecosystem Comprehensive Handbook

**Version:** v1.0.0
**Filename:** `kitluy-suite-ecosystem-handbook-md-v1.0.0.md`
**Owner:** Het Sovannara · Founder, HET Digital Ecosystem
**Status:** Active — canonical rebuild reference for the KitLuy Suite
**Last updated:** 29 May 2026

---

## The rebuild test

This handbook exists to answer one question: **"If every person disappeared tomorrow, could someone rebuild this?"** The answer must be yes. Every part below is written so that an engineer, an operator, or an investor with no prior context could reconstruct the relevant slice of KitLuy from this document plus the source SQL migrations and wireframes it references.

Where the live SQL migrations and an earlier vertical handbook disagree, this document **flags the conflict openly** rather than silently choosing — a rebuild bible that hides its seams is not a rebuild bible. Those reconciliation points are marked **⚠️ RECONCILE** and collected in Part 9.

---

## Table of Contents

- Part 1 — Glossary
- Part 2 — Business Overview
- Part 3 — Investor Demo
- Part 4 — Day in the Life
- Part 5 — Core Business Logic
- Part 6 — SOPs (Standard Operating Procedures)
- Part 7 — FAQ
- Part 8 — Tech Stack
- Part 9 — Database Schema
- Part 10 — Edge Functions
- Part 11 — Module Inventory
- Part 12 — AI Architecture
- Part 13 — Design System
- Part 14 — RBAC Matrix
- Part 15 — QA Test Matrix
- Part 16 — Go-Live Checklist
- Part 17 — Version History
- Appendix A — Data Dictionary

---

# Part 1 — Glossary

Read this first. Terms are grouped by domain. Ecosystem-sibling terms (HSA, Canvār, SroulApp, Lineage Vault) are defined only insofar as KitLuy touches them.

## 1.1 Platform & product terms

| Term | Definition |
|---|---|
| **KitLuy** | ឃីត់លុយ — Khmer for "estimate / count up." Cambodia's Shopify-equivalent: a unified commerce SaaS platform for Cambodian SMEs across four verticals (laundry, café, restaurant, retail). Phase 2 of the HET Digital Ecosystem. |
| **KitLuy Suite** | The full set of KitLuy products: the four logical products (admin, chain, seller, POS) delivered as six builds across web/desktop/mobile. |
| **Vertical** | An industry-specific configuration of KitLuy. A vertical is a complete bundle: its own schema delta, edge functions, terminal map, hardware bundle, order lifecycle, feature index, and reporting taxonomy. Not a UI skin. |
| **1 Store = 1 Vertical** | Locked rule. A store is born into one industry (`vertical_type`) and stays there permanently. A laundry shop cannot run café POS. Multi-vertical operators run multiple separate stores. |
| **Tenant** | The top-level account in the data model (`cp.tenants`). Represents a brand, a chain, a franchise, or a single-store SME. Everything is scoped under a tenant. |
| **Company** | A legal entity within a tenant (`fin.companies`). One tenant may have many companies (e.g. a franchise brand with one company per franchisee). The billing and accounting boundary. |
| **Store** | A physical shop location (`pos.stores`). Belongs to a company. Carries the `vertical_type`. Maps 1:1 to a Hub Server and a warehouse. |
| **Hub Server** | The local Pi 5 8GB + NVMe unit per store. Runs a local PostgreSQL replica, the sync engine, and the offline-first service layer. Measured significantly faster than direct cloud Supabase calls — the basis for the local-first architecture. |
| **Register** | A POS terminal record (`pos.registers`). Fixed, mobile, tablet, kiosk, or backoffice. Maps to a physical terminal (T1–T5 in café). |

## 1.2 The six products

| Term | Definition |
|---|---|
| **kitluy-admin-portal** | Web. Platform owner (HET) god-view. SaaS subscription management, tenant provisioning, billing, support, audit across all tenants. |
| **kitluy-chain-portal** | Web. Brand / chain / franchise owner. Manages the **set of shops/stores** — multi-store HQ, central menu push, cross-store reporting, franchise structure. |
| **kitluy-seller-portal** | Web. Individual shop owner. Manages **one shop/store** — menu, modifiers, recipes, hardware monitoring, staff, reports, settings. |
| **kitluy-seller-app** | Mobile (RN + Expo). The **mobile edition of the seller portal** — same scope, same logic, same backend, phone-shaped. Not a stripped monitor; the portal in the owner's pocket. |
| **kitluy-pos-desktop-app** | Desktop (Electron on Pi 5 ARM64). The terminals. A vertical-neutral POS shell gated by the store's `vertical_type`. Drives fixed terminals T1–T5. |
| **kitluy-pos-mobile-app** | Mobile (RN + Expo). The **mobile edition of the desktop POS** — same register logic, same order/payment flow, phone-shaped. The roaming/line-busting register. |

## 1.3 Terminal terms (café reference vertical)

| Term | Definition |
|---|---|
| **T1 Cashier** | Touch register. Order entry, payment, customer interaction. Pi 5 4GB + 80mm thermal printer. HDMI-1 drives T1; HDMI-2 drives T2. |
| **T2 CDS** | Customer Display Screen. Counter-facing. Shows order summary, total, loyalty wallet, payment status. Driven by T1's HDMI-2 (no separate Pi). |
| **T3 KDS** | Kitchen Display Screen. **Multi-instance** — one per prep station. Each T3 has its own Pi 5 4GB and a configurable printer (80mm slip OR label for cup stickers). |
| **T4 DDS** | Dispatch Display Screen / expediter. Scans cup-sticker QRs, assigns each order to a numbered slot, triggers the T5 queue notification. 80mm printer for takeaway/delivery packing lists. |
| **T5 QDS** | Queue Display Screen. Customer-facing wall display showing which order is ready at which slot. Independent Pi (location varies by shop). |
| **Slot** | A numbered physical pickup position on the T4 counter. Virtually mapped on the T4 screen, broadcast to T5. Configurable 4–12 per shop. |
| **Cup Sticker** | Adhesive label printed at T3 per cup. Carries item, modifiers, `n/total` index, store, timestamp, and a unique QR (dual-purpose: T4 scan target + customer feedback link). |
| **Packing List** | 80mm printout from T4 attached to bagged takeaway/delivery orders. Skipped for dine-in. |

## 1.4 Commerce & order terms

| Term | Definition |
|---|---|
| **Shift** | A continuous cashier operating period (`pos.shifts`). Opened with a starting cash count, closed with reconciliation. Z-report at close. |
| **Session** | A staff login session on a register (`pos.sessions`). Auto-locks after inactivity. Sits inside a shift. |
| **Cart** | The order-in-progress (`pos.carts`). Holds lines, tenders, totals. Becomes a sales invoice + receipt on completion. |
| **Cart Line** | A single line on a cart (`pos.cart_lines`): item, service, fee, discount, tip, or adjustment. |
| **Tender** | A payment applied to a cart (`pos.tenders`): cash, KHQR, ABA, card, wallet, loyalty, credit memo. Split tenders = multiple tender rows. |
| **Tender Attempt** | An individual authorization attempt against a tender (`pos.tender_attempts`) — supports retries on a failed KHQR/card capture. |
| **Service Mode** | How the customer receives the order: dine-in, takeaway, or delivery. Drives downstream behaviour. |
| **Origin Channel** | Where the order came from: walk-in (T1) or TMA (Telegram pre-order) in v1.0.0. |
| **Receipt Job** | A queued receipt output (`pos.receipt_jobs`): thermal print, SMS, email, or digital archive. |
| **Offline Batch / Event** | The sync envelope (`pos.offline_sync_batches` / `pos.offline_sync_events`) carrying locally-created operations from the Hub to the cloud with idempotency and conflict status. |

## 1.5 Menu & inventory terms (café)

| Term | Definition |
|---|---|
| **Modifier Group** | A group of related options on an item (e.g. Sweetness). Required or optional; pick-one or pick-many. |
| **Modifier** | An individual option in a group (e.g. Less Sweet, +Pearls). May carry a KHR upcharge. |
| **Combo** | A bundled offer at a discounted total (e.g. Croissant + Coffee). |
| **Recipe** | Ingredient-level breakdown of an item for inventory deduction. Triggered when an item is marked ready. Modifier-aware (extra pearls deduct extra pearls). |
| **Ingredient** | A tracked raw material, syrup, or packaging unit with stock, threshold, reorder point, and per-unit cost. |
| **Tab** | A running order kept open across a visit, charged at close. Survives shift change. |

## 1.6 Ecosystem-consumed terms

| Term | Definition |
|---|---|
| **Rotanak** | The ecosystem loyalty engine. Source of truth for tiers and Sleung Coins. KitLuy **reads** loyalty and **calls** earn/redeem functions; it never writes loyalty rules. Rendered behind a **gold `#F5A623`** mirror banner. |
| **Netra** | The ecosystem AI brain. Source of truth for customer intelligence and campaigns. KitLuy **reads** recommendations; it never trains models. Rendered behind a **purple `#8B5CF6`** mirror banner. |
| **HSAL** | The ecosystem logistics/driver platform. KitLuy fires a delivery booking after T4 consolidation when service mode = delivery. |
| **ABA PayWay** | Payment gateway. KHQR deeplink + Card 3DS + refund API. The payment rail for both customer orders and KitLuy subscriptions. |
| **KHQR** | Cambodia's QR payment standard via Bakong, accessed through ABA PayWay. Highest-trust payment signal. |
| **Sleung Coin** | The spendable loyalty currency in Rotanak. Earned 1–3% by tier, redeemable up to a 30% per-order cap. |
| **Angkorian Star** | The tier-ranking unit in Rotanak (Silver → Gold → Platinum → Diamond → Black Diamond). |
| **TMA** | Telegram Mini App. Customer-facing pre-order surface using signed `initData`. Orders land in a T1 pending queue. |
| **Single Identity** | One Supabase `auth.users.id` UUID per person across the entire HET ecosystem. Non-negotiable architectural primitive. |

## 1.7 Feature-index terms

| Term | Definition |
|---|---|
| **KF** | KitLuy Feature. The stable feature-ID system, vertical-branched. |
| **KF-LD-NNN** | KitLuy Feature, Laundry vertical. |
| **KF-CF-NNN** | KitLuy Feature, Café vertical. 68 features across 12 domains in v1.0.0. |
| **KF-RS / KF-RT** | Reserved prefixes for the future Restaurant and Retail verticals. |
| **Q-CF-NN** | A parked/open café decision tracked for a later iteration. |

---

# Part 2 — Business Overview

## 2.1 What KitLuy is

KitLuy is a commerce operating system for Cambodian small and medium businesses. It packages everything an SME needs to run a physical retail or service operation — point of sale, inventory, payments, loyalty, reporting, and multi-store management — into a subscription product that runs on affordable Raspberry Pi 5 hardware with an offline-first local architecture.

The positioning is deliberate: **"Cambodia's Shopify."** Where Shopify gave Western SMEs a unified e-commerce backend, KitLuy gives Cambodian SMEs a unified *physical-commerce* backend, tuned for local realities — KHR currency, Khmer language, KHQR/Bakong payments, intermittent connectivity, and the price sensitivity of a developing-market merchant.

## 2.2 What KitLuy is not

- **Not** a generic global POS. It is built for Cambodia first: KHR-native, Khmer-first UI, KHQR-native payments, offline-first for unreliable power and internet.
- **Not** an AI company, a loyalty company, or a logistics company. KitLuy **consumes** those as ecosystem services (Netra, Rotanak, HSAL). It owns commerce execution only.
- **Not** a single monolithic app. It is four products across six builds, each tuned to an audience and form factor.
- **Not** a marketplace. KitLuy runs the merchant's own operation. The ecosystem's marketplace surface is Canvār (a sibling app), not KitLuy.

## 2.3 The four verticals

KitLuy is built vertical-by-industry. Each vertical is a full bundle, not a config toggle. Adding a vertical is a major-version event.

| Vertical | Status | Terminals | Lifecycle | Vertical-specific features |
|---|---|---|---|---|
| **Laundry** | Live (Phase 1 foundation) | 3 (T1, T2, T4) | 10-state | Conveyor, FloorScan, Tag Profiles, QA |
| **Café** | Active build (Phase 2.0) | 5 (T1–T5) | 8-state | Multi-instance KDS, T4 expediter, T5 queue, modifiers, recipes, tabs |
| **Restaurant** | Future (Phase 2.x / 4.0) | TBD | Table/course model | Floor plan, course timing, seat-level ordering, split bills |
| **Retail** | Future (Phase 2.x / 4.0) | TBD | Scan-and-go | Barcode SKUs, returns, shelf inventory |

The verticals share one design system, one component library, one trading-core data layer, and one set of ecosystem integrations. They diverge only where the industry's workflow genuinely differs.

## 2.4 The six products

| Product | Build | Audience | Manages |
|---|---|---|---|
| `kitluy-admin-portal` | Web | Platform owner (HET) | All tenants — provisioning, billing, support, audit |
| `kitluy-chain-portal` | Web | Brand / chain / franchise owner | The set of shops/stores under a brand |
| `kitluy-seller-portal` | Web | Individual shop owner | One shop/store |
| `kitluy-seller-app` | Mobile | Individual shop owner | One shop/store (mobile edition of the seller portal) |
| `kitluy-pos-desktop-app` | Desktop (Pi 5) | Store staff | The fixed registers |
| `kitluy-pos-mobile-app` | Mobile | Store staff | A roaming register (mobile edition of the desktop POS) |

**Two form-factor pairings.** `seller-portal ↔ seller-app` are one product on two screens. `pos-desktop ↔ pos-mobile` are one product on two screens. Each pairing shares its logic layer; only the presentation shell differs.

**Three-tier management hierarchy.** Chain portal manages *the shops*. Seller portal/app manages *the individual shop*. POS desktop/mobile *runs the counter*. Admin sits above all of it.

## 2.5 Business model

KitLuy is **SaaS subscription only**. It takes **0% commission** on merchant order revenue — the merchant keeps 100% of every sale. Subscription is the sole KitLuy revenue line from operators. (This is deliberately distinct from the sibling HSA marketplace, which uses commission economics.)

| Plan | Target | Price | Includes | Trial |
|---|---|---|---|---|
| **Commerce** | Single-store operator | ៛30 / store / month | 1 store, all terminals, full feature set | 14 days |
| **Chain** | Multi-store / franchise operator | ៛100 HQ + ៛50 / store / month | Unlimited stores, Chain Portal, cross-store reports, central menu | 14 days |

Hardware is one-time merchant CapEx, procured separately, outside the subscription.

## 2.6 Why this wins in Cambodia — the moat

Three structural advantages, in order of durability:

1. **Coalition loyalty as infrastructure.** A KitLuy café customer earns Sleung Coins (via Rotanak) that spend at any HSA laundry, any Canvār purchase, any future ecosystem touchpoint. No standalone POS in Cambodia offers a cross-brand coalition program. The moat compounds: every additional ecosystem app strengthens every merchant's loyalty pull.
2. **Ingredient-level recipe inventory.** Modifiers fan out to ingredients (extra pearls deduct extra pearls; 50% sugar deducts half the syrup). The owner gets true per-cup COGS, real wastage signals, and procurement intelligence. Loyverse and most regional POS stop at item level.
3. **Pickup-pad + T4 dispatcher.** A silent fulfilment workflow where delivery drivers self-serve via slip-QR scan. Validated by regional chains; not natively supported by other POS in the region.

## 2.7 Position in the HET Digital Ecosystem

KitLuy is the commerce layer of a larger sovereign ecosystem. It does not stand alone:

- **Identity** — every KitLuy user shares one `auth.users.id` UUID with HSA, Canvār, SroulApp, and the rest of the ecosystem.
- **Loyalty** — consumed from Rotanak (gold mirror).
- **AI** — consumed from Netra (purple mirror).
- **Delivery** — consumed from HSAL.
- **Payments** — ABA PayWay, shared across the ecosystem.

KitLuy owns commerce execution. Everything else, it borrows.

---

# Part 3 — Investor Demo

A scripted walkthrough for a 15-minute investor session. The narrative, the live demo path, and the numbers.

## 3.1 The pitch in one paragraph

Cambodia has hundreds of thousands of SMEs running on cash drawers, paper tickets, and disconnected apps. KitLuy gives them a single affordable subscription that turns a ~$150 Raspberry Pi into a full commerce operating system — POS, inventory with true per-cup cost, KHQR payments, and a coalition loyalty program that works across an entire ecosystem of apps. We charge a flat monthly fee, take zero commission, and run offline-first so it works through Phnom Penh's power cuts and patchy internet. We're live in laundry, launching in café, and the same platform extends to restaurant and retail.

## 3.2 The problem (2 min)

- SMEs use cash drawers and paper; no sales data, no inventory truth, no customer memory.
- Imported POS systems are priced for Western margins and assume reliable connectivity.
- Loyalty, where it exists, is per-shop plastic stamp cards — no network effect.
- Payments are fragmented; KHQR adoption is high but rarely integrated into the till.

## 3.3 The product (3 min) — live demo path

Run on the café 5-terminal wireframe. Demo order, narrated:

1. **T1 Cashier** — tap a Brown Sugar Milk Tea → modifier sheet → Large, 50% sugar, +Pearls → add to cart. *"Every modifier is priced and, behind the scenes, mapped to ingredients."*
2. **T2 Customer Display** — the customer sees their order, their Silver tier, and the Sleung Coins they'll earn. *"This is coalition loyalty — these coins spend across our whole ecosystem."*
3. **Payment** — KHQR QR appears; mark paid. *"Sub-three-second Bakong confirmation."*
4. **T3 KDS** — the drink fires to the barista station; barista taps Ready → a cup sticker with a QR prints.
5. **T4 Expediter** — scan the cup QR; the Bag & Print button is hard-locked until every cup is scanned, then unlocks; assign slot 2.
6. **T5 Queue Display** — the customer's pad number appears at slot 2. *"The customer or the delivery driver just walks to slot 2. No name called, no confusion."*

## 3.4 The moat (2 min)

Lead with coalition loyalty (Part 2.6). The one-liner: *"Every merchant we add makes every other merchant's loyalty program more valuable. That's a network effect a standalone POS can never have."*

## 3.5 The business model (2 min)

- Flat SaaS: ៛30/store/month single, ៛100 + ៛50/store for chains. 0% commission.
- Hardware is the merchant's one-time cost (~$150–$400 per store depending on terminal count).
- Revenue scales with store count, not transaction volume — predictable, high-margin, low-support recurring revenue.

## 3.6 Traction & roadmap (2 min)

- Laundry vertical: live foundation, full product suite built.
- Café vertical: in active build; pilot target ~3 shops, scaling to ~50 cafés by end of Phase 2.0.
- Platform extends to restaurant and retail on the same rails.
- Ecosystem siblings (HSA marketplace, Canvār, Rotanak, Netra) compound the loyalty moat.

## 3.7 The ask & close (2 min)

Frame around store count: each store is a recurring subscription with near-zero marginal cost. The investment funds vertical expansion (café → restaurant → retail) and ecosystem density (more apps → stronger coalition loyalty → lower merchant churn).

## 3.8 Demo failure fallbacks

- No internet → demo on the Hub Server local instance; *"this is the offline-first architecture, not a bug."*
- Payment won't confirm → use the demo "Mark paid" control; explain the real path is ABA PayWay polling.
- Hardware not present → run the wireframe; it mirrors production flows screen-for-screen.

---

# Part 4 — Day in the Life

Five narratives. Each shows the system from one human's vantage point, end to end.

## 4.1 Sophea — café shop owner

**07:00.** Sophea unlocks her BKK1 café. She opens `kitluy-seller-app` on her phone over coffee: yesterday's Z-report, today's low-stock alerts (pearls running low — reorder point hit), and a note that one T3 label printer missed a heartbeat overnight. She taps to acknowledge and reorders pearls from her supplier list.

**07:30.** Her barista arrives and powers on the Hub Server and the five terminals. The POS desktop app boots straight into the café shell because the store's `vertical_type` is `cafe`.

**12:30.** Lunch rush. A modifier — oat milk — runs out. Sophea, still on the floor, opens the seller-app and toggles oat milk unavailable. It vanishes from T1 in real time. No code, no laptop.

**21:00.** Close. The cashier runs shift close on T1; the Z-report prints and pushes to Sophea's Telegram automatically. She reviews per-item sales, modifier popularity, and the day's waste log from her couch.

## 4.2 Dara — barista at the drink station

Dara works the T3 KDS pinned to "Drink Bar." Order cards stream in, each with a pad number, items, and modifiers. He makes the Brown Sugar Milk Tea (Large, 50%, +Pearls), taps **Ready · print**, and a cup sticker with a QR prints from his label printer. He sticks it on the cup and slides it to the expediter. He never touches a cash drawer or a customer — the KDS is his entire world.

## 4.3 Lina — cashier at T1

Lina runs the register. A regular walks up; she scans his loyalty QR — his Gold tier and 1,240 Sleung Coins appear. He orders two drinks; she adds them, applies a coin redemption (capped at 30% of the order), and takes KHQR. The customer watches it all mirrored on T2. Payment confirms; the order fires to the kitchen. When a customer wants a refund, Lina needs a manager PIN — the void/refund flow is gated and logged with a reason code.

## 4.4 Visal — brand/franchise owner

Visal owns a coffee brand with four owned branches and two franchised locations. He logs into `kitluy-chain-portal`. He sees all six stores. He pushes a new seasonal drink to the menu of all owned branches at once. The two franchisees, under a `franchisee_direct` billing agreement, get the menu pushed but pay their own KitLuy subscriptions. He pulls a cross-store report: branch 3 is outselling the rest on pastries; franchisee B has a high waste ratio he'll flag. He drills into one store — and is handed that store's seller-portal view, scoped.

## 4.5 Rithy — platform operator at HET

Rithy runs `kitluy-admin-portal`. His morning: three new café stores finished their 14-day trials overnight and auto-billed successfully via ABA PayWay; one failed payment entered its 3-day grace window; a chain in Siem Reap requested a new store be provisioned. He provisions it — creating the tenant/company/store records, assigning a `vertical_type`, and queueing the Hub Server image. He checks the audit log: every subscription state change, every provisioning action, every support impersonation is recorded with actor, action, target, and timestamp.

---

# Part 5 — Core Business Logic

The rules that govern the system. If the code were lost, these rules plus the schema would let you rewrite it correctly.

## 5.1 The tenant → store hierarchy (authoritative, from live SQL)

The real trading-core migrations define this chain. It is the backbone of everything.

```
cp.tenants              (brand / chain / franchise / single-store SME)
  └── cp.tenant_environments   (prod / staging per tenant)
        └── fin.companies      (legal entity — the billing & accounting boundary)
              └── pos.stores   (physical shop — carries vertical_type, 1:1 with a Hub & warehouse)
                    └── pos.registers   (terminals T1–T5)
                          └── pos.shifts → pos.sessions → pos.carts → pos.cart_lines / pos.tenders
```

Supporting actors: `cp.accounts` = staff/users; `core.parties` = customers; `inv.warehouses` = stock location (one per store); `sal.sales_channels` = order origin.

## 5.2 The 1 Store = 1 Vertical rule

- Every store carries an immutable `vertical_type` (`laundry` / `cafe` / `restaurant` / `retail`) set at provisioning.
- The POS shell reads `vertical_type` at boot and loads the matching vertical module. A `cafe` store can never present laundry flows.
- A multi-vertical operator (e.g. a chain running 2 cafés and 1 laundry) operates **three separate stores** under one tenant/brand. There is no "mixed" store.
- Enforced by architecture because hardware bundles, order lifecycles, edge functions, schema deltas, and reporting taxonomies all differ per vertical.

## 5.3 The franchise model

The chain portal supports **both** single-owner chains and true franchises. The distinction lives in the company layer.

- **Single-owner chain:** one `fin.company`, many `pos.stores`. One entity, many branches.
- **Franchise:** one **brand** `cp.tenant`, multiple `fin.companies` (one per franchisee), each owning its own stores.

**Franchise agreement & billing (KitLuy delta — not yet in live SQL).** A `cp.franchise_agreements` record links the brand tenant to a franchisee company and carries a `billing_mode`:

| `billing_mode` | Meaning |
|---|---|
| `brand_consolidated` | The brand company is the subscription payer; all franchise stores roll into one bill. |
| `franchisee_direct` | Each franchisee company is its own payer with its own stored card. |

The subscription invoice target is **derived** from `billing_mode`, never hardcoded. Royalty terms, brand-menu-push rights, and reporting visibility also hang off this record.

## 5.4 The money model ⚠️ RECONCILE

This is the single most important reconciliation in the platform. There are two truths that must be made consistent:

- **Storage truth (live SQL):** `pos.stores` defaults `primary_currency_code = 'USD'`, `display_currency_code = 'KHR'`, `default_exchange_rate = 4100`. All money columns are `numeric(18,4)` — precise decimals, multi-currency capable. This is an accounting-grade substrate (Cambodia's wholesale and accounting layers frequently run USD).
- **Display truth (project rule §4.1 + café handbook §13.2):** KHR is the locked **display** currency. Integer only, never decimals. Format `៛60,000`. The café `ops.cafe_orders` `_khr` columns are `INTEGER`.

**Locked reconciliation position:**
1. The **storage layer stays `numeric(18,4)` and multi-currency.** This preserves FX, accounting integrity, and future multi-currency verticals.
2. The **presentation layer is always KHR integer.** Every customer-facing and operator-facing surface rounds to whole KHR using `formatKHR()`. No decimals ever reach a screen or a receipt.
3. The café vertical's `_khr` integer columns are a **vertical convention** for KHR-native reporting; they are derived from the canonical `numeric` amounts at write time, rounded to integer KHR.
4. The exchange rate is per-store, daily-settable; USD shadow totals appear only at final totals when explicitly configured (`៛60,000 (~$15.00)`).

The BE team must enforce: rounding happens once, at the storage→display boundary, using a single shared helper, to avoid drift between the `numeric` ledger and the `_khr` integers.

## 5.5 Order lifecycles

Lifecycles are vertical-specific. Each is locked.

**Café — 8 states** (`ops.cafe_orders.current_state`):
`created → confirmed → in_prep → ready_for_pickup → dispatched → completed`, with the practical café path running order entry → kitchen → expediter → pickup. Side states: `voided`, `comped`, `refunded`. (Exact 8-state enumeration is held in the café handbook §8.1; this handbook treats it as the café authority.)

**Laundry — 10 states** (locked at ecosystem level):
`created → pickup_assigned → pickup_in_progress → picked_up → in_production → ready_for_delivery → delivery_assigned → delivery_in_progress → delivered → completed`.

State history is append-only (`state_log` JSONB), never overwritten. Every transition records actor and timestamp.

## 5.6 The cart → invoice → receipt flow (from live SQL)

The POS does **not** invent its own order table at the trading-core level. It uses the cart machinery:

1. `pos.start_cart(...)` opens a cart (sale / return / deposit / pickup_balance).
2. `pos.add_cart_line(...)` adds items; `pos.compute_cart_line_amounts(...)` computes qty × price ± surcharge ± discount + tax; a trigger rebuilds cart totals.
3. `pos.add_tender(...)` applies payment; split tender = multiple tenders; `pos.add_tender_attempt(...)` + `pos.mark_tender_attempt_result(...)` handle KHQR/card retries.
4. On completion the cart materializes a `sal.sales_invoice` + `sal.receipt`. The cart carries `sales_invoice_id` and `receipt_id` back-references.

⚠️ **RECONCILE:** The café handbook §18 assumes a separate `ops.cafe_orders` table. The live trading-core routes POS through `pos.carts → sal.sales_invoices`. The rebuild must decide: is `ops.cafe_orders` (a) the café operational/KDS view layered **on top of** `pos.carts`, or (b) a replacement? Recommended: **(a)** — `pos.carts` remains the financial source of truth; `cafe.*` and `ops.cafe_orders` hold café-operational state (KDS routing, slot, sticker, service mode) keyed to the cart. See Part 9.6.

## 5.7 Shift & session rules

- A register cannot take an order without an **open shift**. `pos.open_shift(...)` records the opening float; `pos.close_shift(...)` records the actual counted cash and computes variance.
- A **session** (`pos.start_session`) is a staff login on a register inside a shift; it auto-locks after `auto_lock_minutes` of inactivity.
- Shift events (`pos.shift_events`) log opening float, pay-in, pay-out, safe-drop, float adjustment, variance, drawer-open — a complete cash-handling audit.

## 5.8 Recipe deduction & inventory truth

- A recipe (`cafe.recipes`) maps an item to ingredients with quantities and units.
- Deduction fires when an item reaches `ready_for_pickup` — not at order creation — so abandoned/voided orders don't wrongly deduct stock.
- Modifier variants resolve at deduction: `modifier_variants` JSONB defines swaps (extra pearls → +X g pearls; 50% sugar → ½ syrup).
- Low-stock crossing a threshold auto-marks dependent items unavailable and emits an alert.
- True per-cup COGS = sum of deducted ingredient costs (`cost_per_unit_khr`), giving real margin per item.

## 5.9 Loyalty rules (consumed from Rotanak)

- KitLuy **reads** tier and Sleung Coin balance; it **never writes** loyalty rules.
- **Earn** fires on order completion via `rotanak-coin-earn` — 1–3% by tier, funded from the merchant's own margin if the merchant enables loyalty.
- **Redeem** is capped at **30% of the order total**, enforced both at preview and at commit.
- All loyalty UI carries the gold `#F5A623` mirror banner (read-only mirror per design rule §5.3).

## 5.10 Subscription lifecycle

```
provisioned → trial (14 days) → active (auto-bill monthly via ABA PayWay)
   active --payment fails--> grace (3 days) --still unpaid--> suspended (data retained)
   suspended --payment--> active
   any --cancel--> retention (30 days) → deleted
```

- **Suspended** = terminals read-only, no new orders; in-flight orders complete.
- Credits are no-refund, no-carry-over, use-it-or-lose-it.
- Cancellation deletes the store and its data after a 30-day retention window.

## 5.11 Offline-first & sync conflict resolution

- The Hub Server is the LAN coordinator; terminals never talk to each other directly — all cross-terminal signalling goes through the Hub (and Supabase Realtime for cloud).
- Locally-created operations queue as `pos.offline_sync_events` inside `pos.offline_sync_batches`, each with an **idempotency key**.
- On reconnect, batches sync to cloud. Conflicts are surfaced via `conflicted` status (not silently merged).
- Conflict policy: **last-write-wins** at the field level for operational data; financial documents (invoices, receipts, tenders) are append-only and never overwritten, so they cannot conflict destructively.

## 5.12 Tax (stubbed, Cambodia)

- `tax.*` provides a lightweight tax foundation: regimes, jurisdictions, categories, codes, determination rules, and document calculations.
- `tax.resolve_tax_code(...)` picks the applicable code; `tax.calculate_tax_stub(...)` computes tax; `tax.seed_cambodia_stub(...)` seeds a Cambodia baseline.
- For café v1.0.0, VAT is typically a single line if configured; the engine is a stub pending full tax work.

---

# Part 6 — SOPs (Standard Operating Procedures)

Step-by-step procedures. Each is written so a new operator could follow it cold.

## 6.1 SOP — Provision a new store (Platform Admin)

1. In `kitluy-admin-portal`, create or select the **tenant** (brand/chain/SME).
2. Ensure a **company** (`fin.companies`) exists under the tenant; for a franchise, create the franchisee company and a `cp.franchise_agreements` record with the agreed `billing_mode`.
3. Create the **store** (`pos.stores`): set `store_code`, `store_name`, `timezone_name = Asia/Phnom_Penh`, `display_currency_code = KHR`, exchange rate, and the **`vertical_type`**.
4. Provision the **warehouse** (`inv.warehouses`) and link it to the store.
5. Queue the **Hub Server image** for the vertical; assign register records (`pos.registers`) for each terminal.
6. Start the **14-day trial**; confirm the merchant's ABA PayWay card is stored for auto-bill.
7. Verify the store boots into the correct vertical shell.

## 6.2 SOP — Open a shift (Cashier, T1)

1. Power on Hub Server, then terminals. Confirm T1 reaches the PIN screen.
2. Enter PIN → Shift Open.
3. Count the starting cash by denomination; confirm the expected float total.
4. Tap **Open shift**. The register is now live.

## 6.3 SOP — Take a walk-in order (Cashier, T1)

1. From the register, select category → item.
2. In the modifier sheet, pick required modifiers (size/sugar/ice) and any optional add-ons; confirm the live price.
3. Add to cart. Repeat for all items.
4. (Optional) Scan the customer's loyalty QR or look up by phone → tier and coins appear.
5. Tap **Pay** → choose method (KHQR / Cash / Card / Tab / Split).
6. On payment confirm, the order fires to T3. Receipt prints per the configured template.

## 6.4 SOP — Handle a void or refund (Cashier + Manager)

1. On the cart or completed order, select Void/Refund.
2. The flow demands a **manager PIN** (gated).
3. Select a **reason code**; enter notes if required.
4. Confirm. The action is recorded in the audit log with before/after state, actor, and timestamp. Cash refunds open the drawer and record a cash-movement event.

## 6.5 SOP — KDS workflow (Barista, T3)

1. On first launch, pin this T3 to a station (one-time; re-pinnable from the seller portal).
2. Work order cards top to bottom. Tap a card item to move it new → in-prep.
3. When the item is made, tap **Ready · print**. A cup sticker prints; apply it to the cup.
4. If an ingredient runs out, toggle the item **86 / out-of-stock** — it updates T1 in real time.

## 6.6 SOP — Expedite takeaway/delivery (Expediter, T4)

1. Open the order card awaiting consolidation; note the cup counter (e.g. `3/6 received`).
2. Scan each cup's QR as it arrives. The counter increments.
3. The **Bag & Print** button stays hard-disabled until `n/total = total/total` (KF-CF-019).
4. When all cups are scanned, tap **Bag & Print** → an 80mm packing list prints; attach it to the bag.
5. Assign a numbered **slot** → this broadcasts to T5.
6. For **delivery**, an HSAL booking auto-fires after slot assignment.
7. On customer/driver pickup, release the slot.

## 6.7 SOP — Close a shift & Z-report (Cashier, T1)

1. Tap Shift Close.
2. The system shows opening float + cash sales − cash refunds ± cash movements = expected ending cash.
3. Count the drawer; enter the counted ending cash; the system shows variance.
4. Confirm close → Z-report prints and pushes to the owner's Telegram. Daily counters reset.

## 6.8 SOP — Daily inventory reconciliation (Owner/Manager)

1. In the seller portal, open Inventory → Reconciliation.
2. For each tracked ingredient, enter the physical count.
3. The system shows system-expected vs counted and computes variance and variance cost.
4. Confirm to post the reconciliation; investigate large variances (theft, spillage, recipe error).

## 6.9 SOP — Push a menu change across a chain (Brand Owner, Chain Portal)

1. In `kitluy-chain-portal`, edit the central menu (item, modifier group, combo, price).
2. Select the target stores (all owned branches, specific franchisees, or all).
3. Push. Owned branches update immediately; franchisees receive per their agreement's menu-push rights.
4. Verify on a target store's T1 that the change is live.

## 6.10 SOP — Recover from hardware failure

- **A T3 printer misses heartbeat:** the seller portal shows the alert; reprint stickers manually from T3 or reassign that station's categories to another T3 temporarily.
- **A terminal Pi fails:** orders continue on remaining terminals; the Hub holds state. Swap the Pi, re-image, re-pair the register.
- **The Hub Server fails:** this is the critical node. Terminals lose the LAN coordinator. Procedure: restore the Hub from its NVMe backup or a fresh image; the cloud retains all synced data; replay any unsynced local batches. Until restored, the store cannot take new orders.
- **Internet down:** operations continue offline against the Hub; batches queue and sync on reconnect.

## 6.11 SOP — Handle a failed subscription payment (Platform Admin)

1. The admin portal flags the account entering **grace** (3 days).
2. Notify the merchant; offer to update the stored card.
3. If paid within grace → return to active automatically.
4. If unpaid past grace → the store **suspends** (read-only, data retained). Reactivation on payment.

---

# Part 7 — FAQ

## 7.1 For operators

**Q: Does KitLuy take a cut of my sales?**
No. KitLuy is subscription-only and takes 0% commission. You keep 100% of every sale.

**Q: What happens if the internet goes down mid-service?**
Nothing stops. The Hub Server runs everything locally; orders, payments (cash), and the kitchen flow continue. KHQR confirmation needs connectivity, but the rest is offline-first. Data syncs when the connection returns.

**Q: I run two cafés and a laundry. One account?**
One brand/tenant, three stores. Each store is its own vertical. You manage them all from the chain portal; each shop has its own seller portal/app.

**Q: Can I manage my shop from my phone?**
Yes — the seller-app is the full seller portal on mobile. Same data, same controls.

**Q: What if I miss a subscription payment?**
You get a 3-day grace period. After that the store goes read-only (your data is safe) until you pay. Cancelling keeps your data for 30 days.

## 7.2 For staff

**Q: Do I need a username and password at the till?**
No — staff use a 4-digit PIN per register. Sensitive actions (void/refund) need a manager PIN.

**Q: I'm a barista. Do I handle money?**
No. The KDS (T3) is order-only. Cash and payment live at T1.

**Q: How does the customer know their order is ready?**
The expediter (T4) assigns a slot; the queue display (T5) shows the pad number at that slot. No names called.

## 7.3 For investors

**Q: How do you make money?**
Flat monthly SaaS per store. Revenue scales with store count, not transaction volume — predictable and high-margin.

**Q: What stops a competitor copying this?**
The coalition loyalty network effect. Sleung Coins span the whole ecosystem; a standalone POS can't replicate a cross-brand loyalty currency. The moat compounds with every app and merchant added.

**Q: Why Raspberry Pi?**
Cost. A full terminal runs on ~$80 of hardware. It makes a complete commerce OS affordable for a developing-market SME, and the local-first Pi is faster than cloud round-trips.

## 7.4 For engineers

**Q: Where is the order's financial source of truth?**
`pos.carts → sal.sales_invoices / sal.receipts`. Café-operational state (KDS, slot, sticker) layers on top in `cafe.*` / `ops.cafe_orders`, keyed to the cart. (See Part 5.6 reconciliation.)

**Q: Integer KHR or decimal?**
Storage is `numeric(18,4)` multi-currency. Display is always KHR integer via a single rounding helper. Never decimals on screen. (Part 5.4.)

**Q: Can Claude apply migrations?**
No. Claude (and Claude Code) writes migrations to `supabase/migrations/`; the BE team owns deployment.

**Q: Does KitLuy build its own AI or loyalty?**
No. It consumes Netra (AI) and Rotanak (loyalty) via edge functions and renders them as read-only mirrors. Early specs that attributed AI/loyalty ownership to KitLuy were corrected.

---

# Part 8 — Tech Stack

## 8.1 Stack by layer

| Layer | Stack |
|---|---|
| **Web frontend** (admin, chain, seller portals) | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| **Mobile** (seller-app, pos-mobile-app) | React Native + Expo + TypeScript; Zustand; expo-sqlite; expo-print; EAS Build → Play Store + App Store |
| **Desktop POS** (pos-desktop-app) | Electron 28.x + React 18 on Raspberry Pi 5 (ARM64) |
| **Backend** | Supabase — PostgreSQL 17, Auth, Edge Functions (Deno), Realtime, Storage |
| **Hub Server** | Node.js 20 + TypeScript 5; local PostgreSQL replica; sync engine; LAN broadcast via Realtime |
| **Payments** | ABA PayWay — KHQR deeplink + Card 3DS + escrow + refund API |
| **Maps** | Google Maps API (external) · HelloMap (sovereign, in development) — relevant to HSAL delivery |
| **Hosting** | DigitalOcean SGP1 (Singapore) |
| **AI Gateway** | Claude Haiku/Sonnet (primary) → Gemini Flash (failover) → Prājñā (Phase 4) — consumed via Netra |
| **Messaging** | Supabase Realtime (`messaging.*`); SroulApp Engine = Phase 3 replacement |

**Permanently removed from the stack:** Zendrite, Matrix.

## 8.2 Supabase project

- **Project ID:** `qneduoifcsvjajeqmvgb`
- **Region:** ap-southeast-1
- **Engine:** PostgreSQL v17
- **Auth:** Phone OTP primary; one `auth.users.id` UUID per person across all ecosystem apps.
- All writes go through **Edge Functions** — apps never write directly to tables.

## 8.3 Local-first architecture

- Each store has a Hub Server (Pi 5 8GB + NVMe) running a local PostgreSQL replica and the sync engine.
- Terminals talk to the Hub over LAN; the Hub syncs to Supabase cloud.
- Validated as significantly faster than direct cloud calls for POS operations, and resilient to power/internet interruptions.

## 8.4 Hardware bundle (café reference)

| Component | Spec |
|---|---|
| Hub Server | Pi 5 8GB + NVMe 128/256GB |
| T1 Main Register | Pi 5 4GB + microSD 32GB (HDMI-1 register, HDMI-2 → T2) |
| T2 Customer Display | HDMI-2 output of T1 (no separate Pi) |
| T3 KDS (×N) | Pi 5 4GB + microSD 32GB + printer (80mm OR label) |
| T4 Dispatcher | Pi 5 4GB + microSD 32GB + 80mm printer |
| T5 Queue Display | Pi 5 4GB + microSD 32GB (independent) |
| Enclosure | Mesh-vent aluminium case, pure copper heatsink, 3007 PWM blower fan rated for 35°C+ ambient (Cambodia climate) |

Laundry uses 3 Pi + 3 screens (T1, T2, T4). Café uses 5–7 Pi + 5–7 screens + 3–5 printers.

## 8.5 Repository & build conventions

- Migrations: `supabase/migrations/` — written by Claude/Claude Code, **applied by the BE team only**.
- Edge functions: `supabase/functions/`.
- File naming follows semver: `xxxxx-wireframe-vX.Y.Z.jsx`, `xxxxx-docx-vX.Y.Z.docx`, `xxxxx-md-vX.Y.Z.md`.
- Schema-prefixed table names are mandatory (`pos.stores`, never `stores`).

---

# Part 9 — Database Schema

This is the heart of the rebuild test. The schema below is drawn from the **live trading-core migrations** (`033b`, `036`, `037`, plus referenced `034`/`035`) and the **café vertical deltas**. Where the two disagree, the conflict is flagged ⚠️ RECONCILE and the recommended resolution given.

## 9.1 Schema inventory

| Schema | Owner | Purpose | Source |
|---|---|---|---|
| `cp` | Platform | Tenants, environments, accounts (control plane) | Referenced by live SQL |
| `fin` | Platform | Companies (legal/billing/accounting entity) | Referenced by live SQL |
| `core` | Platform | Parties (customers), shared primitives, RLS helpers | Referenced by live SQL |
| `inv` | Trading-core | Warehouses, items, stock, transfers | `034_inv_core.sql` |
| `sal` | Trading-core | Sales channels, sales orders, sales invoices, receipts | `035_sal_core.sql` |
| `pos` | Trading-core | Stores, registers, shifts, sessions, carts, tenders, receipt jobs, offline sync | `036_pos_core.sql` |
| `pur` | Trading-core | Procure-to-pay: PR, PO, GRN, purchase invoices, debit notes, landed costs | `037_pur_core.sql` |
| `tax` | Trading-core | Tax regimes, jurisdictions, codes, determination, document calc (stub) | `033b_tax_stub.sql` |
| `cafe` | Café vertical | Modifiers, recipes, ingredients, T3 assignments, T4 slots, tabs, cup stickers | Café handbook §18 (delta) |
| `ops` | Operational | `ops.cafe_orders` operational/KDS state | Café handbook §18 (delta) |
| `loyalty` | Rotanak | Tiers, wallets, coins — **read-only mirror; owned by Rotanak** | External |

## 9.2 `pos` schema — the POS runtime core (live SQL, authoritative)

**Tables (12):**

| Table | Purpose |
|---|---|
| `pos.stores` | Physical store. FK → `cp.tenants`, `cp.tenant_environments`, `fin.companies`, `inv.warehouses`, `sal.sales_channels`. Carries currency config + exchange rate. |
| `pos.registers` | Terminal record. `register_type` enum. |
| `pos.shifts` | Cashier shift with opening float and reconciliation. |
| `pos.shift_events` | Cash-handling audit: opening_float, pay_in, pay_out, safe_drop, float_adjustment, variance, drawer_open. |
| `pos.sessions` | Staff login session on a register; auto-lock. |
| `pos.carts` | The order. Holds totals, currency, FK → invoice + receipt on completion. Offline-origin aware (`offline_local_ref`, `sync_revision`). |
| `pos.cart_lines` | Line items: item/service/fee/discount/tip/adjustment. |
| `pos.tenders` | Payments on a cart; split tender = multiple rows. |
| `pos.tender_attempts` | Per-tender authorization attempts (retry support). |
| `pos.receipt_jobs` | Queued receipt outputs (thermal/SMS/email/archive). |
| `pos.offline_sync_batches` | Sync envelope from Hub → cloud. |
| `pos.offline_sync_events` | Individual queued operations with idempotency keys. |

**Enums (14):**
`register_type` (fixed, mobile, tablet, kiosk, backoffice) · `shift_status` (open, closing, closed, cancelled) · `shift_event_type` (opening_float, pay_in, pay_out, safe_drop, float_adjustment, variance, drawer_open) · `session_status` (active, locked, closed, expired) · `cart_type` (sale, return, deposit, pickup_balance) · `cart_status` (open, held, checkout, completed, voided, cancelled, sync_pending, synced) · `cart_line_type` (item, service, fee, discount, tip, adjustment) · `tender_method` (cash, khqr, aba, card, wallet, loyalty, credit_memo, other) · `tender_status` (pending, authorized, captured, failed, cancelled, refunded) · `tender_attempt_status` (initiated, pending, succeeded, failed, expired, cancelled) · `receipt_job_channel` (thermal_print, sms, email, digital_archive) · `receipt_job_status` (queued, processing, completed, failed, cancelled) · `offline_batch_status` (queued, syncing, synced, failed, conflicted, cancelled) · `offline_event_status` (pending, synced, failed, conflicted, cancelled).

## 9.3 `pur` schema — procure-to-pay (live SQL)

**Tables (12):** `purchase_requests` + `_lines`, `purchase_orders` + `_lines`, `goods_receipts` + `_lines`, `purchase_invoices` + `_lines`, `debit_notes` + `_lines`, `landed_costs`, `landed_cost_allocations`.

**Enums (6):** `purchase_request_status`, `purchase_order_status` (draft→submitted→approved→partially/fully_received→partially/fully_billed→closed/cancelled), `goods_receipt_status`, `purchase_invoice_status`, `debit_note_status`, `landed_cost_status`.

3-way match (PO ↔ GRN ↔ invoice) is modeled explicitly. Café stock-in flows tie here; café ingredient procurement is a `pur` cycle against `inv` items.

## 9.4 `tax` schema — Cambodia tax stub (live SQL)

**Tables (9):** `regimes`, `jurisdictions`, `categories`, `company_registrations`, `codes`, `code_components`, `determination_rules`, `document_calculations`, `document_tax_lines`.

A lightweight foundation to unblock sales/purchasing/POS before the full tax engine. `tax.resolve_tax_code(...)` → `tax.calculate_tax_stub(...)` → `tax.upsert_document_calculation(...)`; `tax.seed_cambodia_stub(...)` seeds a Cambodia baseline.

## 9.5 `inv` & `sal` schemas (live SQL, referenced)

- `inv.warehouses` — one per store, FK target from `pos.stores`. `inv.*` also holds items and stock (items referenced by `pos.cart_lines.item_id`).
- `sal.sales_channels` — order origin classification (`pos.ensure_pos_sales_channel(...)` guarantees a POS channel exists per company).
- `sal.sales_orders`, `sal.sales_invoices`, `sal.receipts` — the financial documents a completed cart materializes into.

## 9.6 `cafe` schema — café vertical deltas

All café-specific tables. ⚠️ **RECONCILE:** the café handbook §18 wrote these against assumed names (`core.stores`, `pos.items`, `pos.categories`, `pos.terminals`, `ops.cafe_orders`). The live trading-core uses `pos.stores`, `inv` items, `pos.registers`. The rebuild must rewrite café FKs to the real targets. Mapping table:

| Café handbook §18 reference | Real trading-core target | Action |
|---|---|---|
| `core.stores` | `pos.stores` | Rename FK |
| `core.users` | `cp.accounts` | Rename FK |
| `pos.items` | `inv.items` (or a `menu.*` schema TBD) | Resolve item home |
| `pos.categories` | `inv` category or new `menu.categories` | Resolve category home |
| `pos.terminals` | `pos.registers` | Rename FK |
| `ops.cafe_orders` | layer on `pos.carts` | Keep as operational view (Part 5.6) |
| `hsal.bookings` | `hsal.bookings` | OK (external) |

**Café tables (delta):**

| Table | Key columns |
|---|---|
| `cafe.modifier_groups` | `group_id` PK, `store_id` FK, `name_en`, `selection_rule` (required_one/optional_one/optional_many), `min_select`, `max_select`, `display_order` |
| `cafe.modifiers` | `modifier_id` PK, `group_id` FK, `name_en`, `upcharge_khr` INTEGER, `available`, `display_order` |
| `cafe.item_modifier_group_links` | (`item_id`, `group_id`) composite PK, `display_order` |
| `cafe.recipes` | `recipe_id` PK, `item_id` FK (one per item), `modifier_variants` JSONB, `active` |
| `cafe.recipe_ingredients` | (`recipe_id`, `ingredient_id`) composite PK, `quantity` DECIMAL(10,3), `unit` (g/ml/unit) |
| `cafe.ingredients` | `ingredient_id` PK, `store_id` FK, `name_en`, `unit`, `current_stock`, `low_stock_threshold`, `reorder_point`, `cost_per_unit_khr` INTEGER |
| `cafe.t3_assignments` | `assignment_id` PK, `store_id` FK, `terminal_id` FK (T3 instance), `category_id` FK, `printer_mode` (receipt_80mm/label) |
| `cafe.t4_slots` | `slot_id` PK, `store_id` FK, `slot_number`, `current_state` (available/occupied/released_pending), `current_order_id` FK, `assigned_at`, `released_at` |
| `cafe.tabs` | `tab_id` PK, `store_id` FK, `opened_by_user_id` FK, `customer_name`, `table_reference`, `tab_type` (cash/pre_auth_card), `state` (open/closed/completed), `opened_at`, `closed_at` |
| `cafe.cup_stickers` | `sticker_id` PK (= QR payload base), `order_id` FK, `order_line_id` FK, `position_index`, `position_total`, `printed_at`, `scanned_at_t4_at`, `scanned_by_customer_at` |
| `ops.cafe_orders` | `order_id` PK, `store_id` FK, `customer_id` FK, `service_mode` (dine_in/takeaway/delivery), `origin_channel` (walk_in/tma), `current_state`, `state_log` JSONB, `subtotal_khr`…`total_khr` INTEGER, `payment_method`, `aba_payway_ref`, `hsal_booking_id` FK, `tab_id` FK, `table_reference`, `created_by_user_id` FK, timestamps |

## 9.7 RLS (row-level security)

Per `039_rls_trading.sql`, every tenant-scoped table enables RLS with the platform pattern:

```
USING      (core.is_service_role() OR tenant_id = core.current_tenant_id())
WITH CHECK (core.is_service_role() OR tenant_id = core.current_tenant_id())
```

- `core.is_service_role()` — bypass for postgres/service_role.
- `core.current_tenant_id()` — session-injected tenant scope.
- Café tables must follow the same pattern, scoped by the store's tenant. Cross-vertical and cross-tenant leakage is a real risk caught during the café build — RLS discipline is mandatory.

## 9.8 The franchise delta (KitLuy addition, not yet in live SQL)

| Table | Key columns |
|---|---|
| `cp.franchise_agreements` | `agreement_id` PK, `brand_tenant_id` FK → `cp.tenants`, `franchisee_company_id` FK → `fin.companies`, `billing_mode` (brand_consolidated/franchisee_direct), `royalty_pct` numeric, `menu_push_rights` enum, `status`, `start_date`, `end_date` |
| Subscription invoice target | Derived from `billing_mode`: brand company vs franchisee company. No hardcoded payer. |

## 9.9 Scale tier (defined, not yet active)

For high-volume operators (target 100K orders/day), a Warehouse Tier swaps the Pi Hub for an Intel/AMD mini-PC 32GB running PostgreSQL. The schema is unchanged; only the Hub hardware and tuning differ.

---

# Part 10 — Edge Functions

All writes go through Deno edge functions in `supabase/functions/`. Functions are written by Claude/Claude Code and **deployed by the BE team only**.

## 10.1 POS database functions (live SQL — Postgres functions, not edge functions)

These are PL/pgSQL functions inside `036_pos_core.sql` that the edge layer calls:

`pos.touch_updated_at` · `pos.next_doc_number` · `pos.assign_shift_no` · `pos.assign_cart_no` · `pos.assign_batch_no` · `pos.ensure_pos_sales_channel` · `pos.compute_cart_line_amounts` · `pos.set_cart_line_amounts` · `pos.rebuild_cart_totals` · `pos.after_cart_line_change` · `pos.after_tender_change` · `pos.open_shift` · `pos.close_shift` · `pos.start_session` · `pos.start_cart` · `pos.add_cart_line` · `pos.add_tender` · `pos.add_tender_attempt` · `pos.queue_offline_event` · `pos.mark_tender_attempt_result`.

`pur` and `tax` carry analogous function sets (numbering, line-amount computation, document rebuild, 3-way match for `pur`; resolve/calculate/upsert/seed for `tax`).

## 10.2 Shared POS edge functions (all verticals)

| Slug | Purpose |
|---|---|
| `pos-pin-verify` | Verify a staff PIN against a register/store. |
| `pos-shift-open` | Open a shift with opening float. |
| `pos-shift-close` | Close a shift, compute variance, build Z-report. |
| `pos-receipt-reprint` | Reprint a receipt by id. |
| `pos-hardware-heartbeat` | Terminal/printer heartbeat; feeds hardware-health monitoring. |

## 10.3 Café edge functions (25, vertical delta)

| Slug | Purpose |
|---|---|
| `pos-cafe-order-create` | Create a café order (lines, modifiers, recipes); idempotency key required; called by T1 and TMA. |
| `pos-cafe-order-route-to-kds` | Fan out lines to T3 instances per `cafe.t3_assignments`; trigger on order create. |
| `pos-cafe-item-set-status` | Update a line status (in_prep / ready_for_pickup); called by T3. |
| `pos-cafe-sticker-print` | Generate cup-sticker ESC-POS/PDF; dispatch to the T3 printer. |
| `pos-cafe-t4-scan-qr` | Resolve a sticker QR at T4; return order context + cup-counter state. |
| `pos-cafe-t4-bag-print` | Hard-gated; refuses unless all cups scanned; generate packing list; dispatch to T4 printer. |
| `pos-cafe-t4-slot-assign` | Assign order to slot N; update `cafe.t4_slots`; broadcast to T5 via `cafe:store:{store_id}`. |
| `pos-cafe-t4-slot-release` | Release a slot back to the pool. |
| `pos-cafe-t5-broadcast-pull` | T5 boot-time pull of ready/almost-ready lists (network-blip recovery). |
| `pos-cafe-tab-open` | Open a tab (table ref, customer, type). |
| `pos-cafe-tab-add-items` | Append items to a tab; route to T3. |
| `pos-cafe-tab-close` | Close tab, capture payment, consolidated receipt. |
| `pos-cafe-tma-confirm` | Cashier confirms a pending TMA order; transition to created + route. |
| `pos-cafe-recipe-deduct` | Deduct ingredients on item ready; resolve modifier variants. |
| `pos-cafe-low-stock-check` | Cron + on-demand threshold check; emit alerts. |
| `pos-cafe-waste-log` | Record a waste entry with reason code + ingredient cost. |
| `pos-cafe-modifier-group-upsert` | Seller-portal authoring: modifier group create/edit. |
| `pos-cafe-recipe-upsert` | Seller-portal authoring: recipe create/edit. |
| `pos-cafe-tma-menu-pull` | Public menu JSON for TMA. |
| `pos-cafe-tma-order-create` | TMA order entry with signed initData verification. |
| `pos-cafe-hsal-handoff` | Fire HSAL booking after T4 slot assignment (delivery). |
| `pos-cafe-aba-khqr-init` | Initiate KHQR via ABA PayWay; return QR payload. |
| `pos-cafe-aba-khqr-poll` | Poll for payment confirmation. |
| `pos-cafe-x-report` | Build X-report payload for the current shift. |
| `pos-cafe-z-report` | Build Z-report at close; persist; return ESC-POS for print. |

## 10.4 Ecosystem-consumed functions (not owned by KitLuy)

| Slug | Owner | KitLuy use |
|---|---|---|
| `rotanak-coin-earn` | Rotanak | Fire coin earn on order completion. |
| `rotanak-coin-redeem` | Rotanak | Redeem coins (30% cap enforced). |
| `rotanak-profile-get` | Rotanak | Read tier + balance for T1/T2. |
| `netra-recommendations-get` | Netra | Read customer intel / recommendations (purple mirror). |
| `hsal-booking-create` | HSAL | Create a delivery booking after T4 consolidation. |
| `aba-payway-*` | ABA | KHQR + card + refund (also used for subscription billing). |

## 10.5 Idempotency & safety rules

- Every order-creating and payment function requires an **idempotency key** (offline replay safety).
- Hard-gated functions (`pos-cafe-t4-bag-print`) re-check their guard server-side; the UI lock is not trusted alone.
- Financial documents are append-only; no edge function overwrites a posted invoice/receipt/tender.

---

# Part 11 — Module Inventory

Four logical products · six builds. Mobile editions inherit their twin's feature set rather than defining their own.

## 11.1 `kitluy-admin-portal` (web · platform owner)

| Area | Function |
|---|---|
| Tenants | Provision/suspend tenants, companies, stores; assign `vertical_type`. |
| Subscriptions | Trial → active → grace → suspended lifecycle; ABA auto-bill; plan management. |
| Billing | Invoices, payment status, franchise billing-mode resolution. |
| Support | Impersonation (audited), ticket linkage. |
| Audit | Global audit log: actor, action, target, before/after, timestamp. |
| Hardware fleet | Heartbeat/health across all stores. |

## 11.2 `kitluy-chain-portal` (web · brand/chain/franchise owner)

| Area | Function |
|---|---|
| Store set | List/manage all shops/stores under the brand; owned branches vs franchisees. |
| Central menu | Author and push menu/modifiers/combos/pricing to selected stores. |
| Franchise | Manage `cp.franchise_agreements`, royalty, menu-push rights, billing mode. |
| Cross-store reports | Sales, COGS, waste, modifier popularity across stores. |
| Drill-down | Open one store → scoped seller-portal view. |

## 11.3 `kitluy-seller-portal` (web · single shop owner) ↔ 11.4 `kitluy-seller-app` (mobile)

One product, two form factors. Same scope, logic, backend.

| Area | Function |
|---|---|
| Menu | Categories, items, modifier groups, modifiers, combos, pricing, availability. |
| Recipes | Per-item BOM, modifier variants, ingredient catalog. |
| Inventory | Stock levels, thresholds, reorder points, reconciliation, waste log. |
| Hardware | Terminal/printer monitoring; T3 station assignment + printer mode. |
| Staff | Accounts, roles, PINs. |
| Reports | Daily sales by hour/item/category, X/Z reports, service-mode breakdown. |
| Settings | Receipt/sticker templates, slot count, hours, exchange rate, TMA on/off. |
| **Seller-app extras (mobile-native)** | Live orders, push-notified void/comp approvals, pause/resume TMA, quick reports, alerts. |

## 11.5 `kitluy-pos-desktop-app` (Pi 5 · store staff) ↔ 11.6 `kitluy-pos-mobile-app` (mobile)

One product, two form factors. Vertical-neutral shell gated by `vertical_type`. Café terminal screens:

| Terminal | Screens (anchor set) |
|---|---|
| **T1 Cashier** | PIN login, shift open, register (category grid + cart), modifier sheet, payment (KHQR/cash/card), TMA pending queue, shift close + Z, settings. (+ deferred: tabs, split bill, refund, customer 360, cash movement, audit peek, reprint.) |
| **T2 CDS** | Idle/carousel, order mirror, payment status. |
| **T3 KDS** | Station picker, active orders, item-ready confirm + sticker, 86/out-of-stock toggle. |
| **T4 DDS** | Awaiting queue, QR scan progress (hard-gated bag), bag & print, slot assign, slot release. |
| **T5 QDS** | Standby/carousel, orders-ready board (Now / Almost). |

Wireframe reference: `kitluy-cafe-pos-terminals-wireframe-v1.0.0.jsx` (22 anchor screens). Mobile POS presents T1's flow handheld for line-busting.

---

# Part 12 — AI Architecture

## 12.1 The consumption principle

KitLuy **consumes** AI from Netra; it does not build, train, or own models. Early café specs that attributed AI edge functions to KitLuy were corrected and removed. Every AI surface in KitLuy is a **read-only mirror** of Netra data, marked with the purple `#8B5CF6` banner.

## 12.2 What AI does for KitLuy

| Capability | Source | Surface |
|---|---|---|
| Customer intelligence (segments, lifetime value, churn signal) | Netra | Seller/chain portal intel pages (purple mirror). |
| Product recommendations / upsell hints | Netra | Optional T1 prompt; portal insights. |
| Demand signals / procurement intelligence | Netra (fed by KitLuy's recipe-level COGS data) | Inventory planning views. |
| Campaign intelligence | Netra | Read-only campaign banners (e.g. "Sleung Day 2× active" on T2). |

## 12.3 The AI gateway (inside Netra)

Netra's gateway routes: **Claude Haiku/Sonnet (primary) → Gemini Flash (failover) → Prājñā (Phase 4, sovereign)**. KitLuy never calls a model directly; it calls Netra edge functions (`netra-*`) which encapsulate the gateway.

## 12.4 The data KitLuy contributes upward

KitLuy's distinctive asset is **ingredient-level COGS and modifier-level demand**. This data flows to Netra to power better forecasting and recommendations across the ecosystem — a one-directional contribution that strengthens the shared brain without KitLuy owning the AI.

## 12.5 Boundaries

- KitLuy stores **no model weights**, runs **no training**, and makes **no autonomous AI decisions** about pricing or promotions.
- All AI output is advisory and rendered read-only. The merchant or Netra owns the action.

---

# Part 13 — Design System

## 13.1 Core tokens (ecosystem-wide)

| Token | Value |
|---|---|
| Primary | Sky Blue `#0EA5E9` |
| Primary dark | `#0284C7` |
| Dark sidebar | `#0F172A` |
| Font | DM Sans |
| Card radius | 12px |
| Base grid | 16px |
| Success / Warning / Danger | `#10B981` / `#F59E0B` / `#EF4444` |

## 13.2 Mirror banners (read-only source-of-truth indicators)

- **Rotanak loyalty pages** → gold `#F5A623` banner on top (loyalty is read-only; Rotanak owns it).
- **Netra intelligence pages** → purple `#8B5CF6` banner on top (AI is read-only; Netra owns it).

These are not decorative — they tell the user "this data is mirrored, not editable here."

## 13.3 Currency & localization

- **KHR display:** symbol ៛ (U+17DB), integer only, comma thousands (`៛60,000`). USD shadow only at final totals when configured (`៛60,000 (~$15.00)`).
- **Languages:** English primary; Khmer secondary (Khmer Unicode, allow **40% wider** containers); Chinese tertiary where applicable.
- **Phone:** E.164 (`+855 12 345 678`).
- **Timezone/locale:** `Asia/Phnom_Penh` (UTC+7), `en-KH`, date `DD/MM/YYYY`.

## 13.4 Terminal UI patterns (café)

- **T1** — split layout: menu grid left, cart right; modifier sheet as bottom sheet.
- **T2** — dark, large-type, customer-facing; loyalty and total prominent.
- **T3** — dark KDS grid; pad-number badges; status colors (new red, in-prep amber, ready green); large touch targets for kitchen gloves.
- **T4** — light expediter; cup-counter progress bar; hard-locked primary button until complete.
- **T5** — dark, huge pad numbers + slot numbers; Now / Almost sections; marketing footer.

## 13.5 App-specific brand overrides (ecosystem siblings, for reference)

Rotanak Gold `#F5A623` · Netra Purple `#8B5CF6` · SroulApp Emerald+Gold · HelloHR Midnight Glass · HelloESA Indigo+Orange. KitLuy itself uses the core Sky Blue identity.

## 13.6 Wireframe renderer constraints (JSX)

When authoring KitLuy wireframes for the artifact/Figma Make renderer:
- No optional chaining (`?.`) → use `&&` or ternary.
- No `const [x, setX] = useState()` → use `var s = useState(); var x = s[0]; var setX = s[1]`.
- Define `var` page components **before** the `ROUTES` object.
- JSX attribute concatenation needs braces.
- Keep files under ~270KB.

---

# Part 14 — RBAC Matrix

## 14.1 Roles

| Role | Home product | Scope |
|---|---|---|
| **Platform Admin** | admin-portal | All tenants |
| **Brand/Chain Owner** | chain-portal | All stores under the brand |
| **Shop Owner** | seller-portal / seller-app | One store |
| **Manager** | seller-portal + POS | One store; elevated POS actions |
| **Cashier** | pos (T1) | Register operations |
| **Barista / Kitchen** | pos (T3) | KDS only |
| **Expediter** | pos (T4) | Dispatch/slots only |

## 14.2 Permission matrix (✓ = allowed)

| Capability | Platform Admin | Brand Owner | Shop Owner | Manager | Cashier | Barista | Expediter |
|---|---|---|---|---|---|---|---|
| Provision tenant/store | ✓ | | | | | | |
| Manage subscription/billing | ✓ | franchise-scoped | | | | | |
| Manage franchise agreements | ✓ | ✓ | | | | | |
| Push central menu | | ✓ | | | | | |
| Cross-store reports | ✓ | ✓ | | | | | |
| Edit menu/modifiers/recipes (one store) | ✓ | ✓ | ✓ | ✓ | | | |
| Manage staff/PINs (one store) | ✓ | ✓ | ✓ | ✓ | | | |
| Inventory + reconciliation | ✓ | ✓ | ✓ | ✓ | | | |
| View store reports | ✓ | ✓ | ✓ | ✓ | own shift | | |
| Open/close shift | | | ✓ | ✓ | ✓ | | |
| Take order + payment (T1) | | | ✓ | ✓ | ✓ | | |
| Void / refund | | | ✓ | ✓ | PIN-gated → mgr | | |
| Apply discount/comp | | | ✓ | ✓ | PIN-gated → mgr | | |
| KDS item status (T3) | | | ✓ | ✓ | | ✓ | |
| 86 / out-of-stock toggle (T3) | | | ✓ | ✓ | | ✓ | |
| T4 scan / bag / slot | | | ✓ | ✓ | | | ✓ |
| Pause/resume TMA | | | ✓ | ✓ | | | |

## 14.3 PIN access model

- Staff authenticate at a register with a 4-digit PIN (no username/password at the till).
- Sensitive actions (void, refund, discount/comp above a threshold) require a **manager PIN** even within a cashier session.
- Every PIN-gated action is logged with actor, action, target, before/after, timestamp (KF-CF-064).
- Portal logins (admin/chain/seller) use full Supabase auth; POS PIN sits on top of a device-bound register session.

---

# Part 15 — QA Test Matrix

18 scenarios. The first 8 mirror the live `038_trading_smoke.sql` validators; the rest are café/platform-specific. Each lists the path and the pass condition.

| # | Scenario | Path | Pass condition |
|---|---|---|---|
| 1 | Retail/café sale | Open shift → cart → line → cash tender → complete | Cart completes; invoice + receipt created; totals match; drawer event logged. |
| 2 | Service sale | Cart with service line → tender → complete | Service line priced; no inventory deduction for service. |
| 3 | Purchase cycle | PR → PO → GRN → purchase invoice (3-way match) | Statuses progress; 3-way match reconciles; stock increments on GRN. |
| 4 | Stock transfer | Warehouse A → B transfer | Source decremented, destination incremented; net zero. |
| 5 | Sales return | Return cart against an invoice | Return recorded; stock restored; refund tender created. |
| 6 | Reorder trigger | Deduct ingredient below reorder point | Low-stock alert emitted; dependent item auto-marked unavailable. |
| 7 | Multi-currency settlement | Cart in KHR display, USD primary, FX 4100 | Stored `numeric` correct; KHR display integer; no decimal on screen. |
| 8 | Offline POS sync | Create order offline → reconnect | Batch syncs with idempotency; no duplicate; conflicts surfaced not silently merged. |
| 9 | Café full order flow | T1 order → T3 ready → T4 scan → slot → T5 | Order traverses 8 states; T5 shows correct pad+slot. |
| 10 | T4 hard-gate | Attempt Bag & Print before all cups scanned | Button disabled; server function refuses; only unlocks at n/total = total/total. |
| 11 | Recipe deduction with modifiers | Order Large +Pearls 50% sugar → mark ready | Pearls + half-syrup deducted per modifier variants; COGS computed. |
| 12 | Loyalty earn + redeem cap | Identified customer; redeem > 30% | Earn fires on completion; redeem blocked above 30% at preview and commit. |
| 13 | Split tender | Cart paid part cash, part KHQR | Two tender rows; balance_due reaches 0; cart completes. |
| 14 | Tender retry | KHQR attempt fails then succeeds | tender_attempt failed → new attempt succeeded; tender captured once. |
| 15 | Void/refund RBAC | Cashier attempts void without manager PIN | Blocked until manager PIN; reason code required; audit logged. |
| 16 | Vertical isolation | Café store queries laundry-shaped data | RLS + shop-scoping returns nothing cross-vertical; no leakage. |
| 17 | Franchise billing resolution | Brand with `franchisee_direct` vs `brand_consolidated` | Invoice target derived correctly per `billing_mode`; no hardcoded payer. |
| 18 | Subscription suspend/reactivate | Fail payment → grace → suspend → pay | Grace 3 days; suspend = read-only, data retained; payment restores full operation. |

Each scenario should be encoded as a validator returning JSONB `{ passed, checks[] }`, following the `038` pattern.

---

# Part 16 — Go-Live Checklist

## 16.1 Infrastructure

- [ ] Supabase project `qneduoifcsvjajeqmvgb` reachable; schemas `cp/fin/core/inv/sal/pos/pur/tax/cafe/ops` migrated.
- [ ] RLS enabled and verified on every tenant-scoped table (incl. café).
- [ ] Edge functions deployed (shared `pos-*` + 25 café + ecosystem connectors).
- [ ] ABA PayWay credentials configured (KHQR + card + refund) for orders **and** subscriptions.
- [ ] Realtime channel `cafe:store:{store_id}` live for T4→T5 broadcast.

## 16.2 Data & config

- [ ] Tenant, company, store records created; `vertical_type` set.
- [ ] Franchise agreements + `billing_mode` set where applicable.
- [ ] Warehouse linked; exchange rate set; KHR display confirmed integer-only end to end.
- [ ] Menu, modifiers, combos, recipes, ingredient catalog loaded.
- [ ] Receipt + cup-sticker templates configured; slot count set.

## 16.3 Hardware

- [ ] Hub Server imaged, on UPS, NVMe backup configured.
- [ ] T1–T5 paired as `pos.registers`; T2 confirmed on T1 HDMI-2; T3 station assignments + printer modes set.
- [ ] All printers print a test (80mm + label); scanner paired at T4.
- [ ] Enclosure thermals validated for ambient (fan/heatsink) — Cambodia climate.

## 16.4 People

- [ ] Staff accounts + PINs created; roles assigned per RBAC matrix.
- [ ] Owner trained on seller-portal/app; manager trained on void/refund + reconciliation.
- [ ] Cashier/barista/expediter trained on their terminal SOPs.

## 16.5 Validation

- [ ] All 18 QA scenarios pass on the store's stack.
- [ ] Offline test: pull internet mid-order, confirm continuity + clean sync on reconnect.
- [ ] Loyalty earn/redeem verified against Rotanak; gold banner present.
- [ ] Z-report prints and pushes to owner Telegram.

## 16.6 Pilot & monitor

- [ ] Soft-launch with limited hours; monitor hardware heartbeats + sync conflicts.
- [ ] Daily reconciliation reviewed for the first week.
- [ ] Subscription auto-bill confirmed at trial end.

---

# Part 17 — Version History

| Version | Date | Change |
|---|---|---|
| v1.0.0 | 29 May 2026 | Initial KitLuy Suite Ecosystem Handbook. 17 parts + Appendix A. Grounded in live trading-core SQL (`033b/036/037/038/039` + referenced `034/035`), café vertical spec (68 KF-CF features, `cafe.*` deltas, 25 edge functions), and the locked six-product / franchise model. Documents two open reconciliations (money model; café schema naming) and the franchise billing delta. |

---

# Appendix A — Data Dictionary

Field-level reference for the most rebuild-critical tables. Types reflect the live SQL where known; café deltas reflect the café handbook (pending the §9.6 FK reconciliation).

## A.1 `pos.stores`

| Column | Type | Notes |
|---|---|---|
| `store_id` | uuid PK | gen_random_uuid() |
| `tenant_id` | uuid FK → cp.tenants | required |
| `env_id` | uuid FK → cp.tenant_environments | required |
| `company_id` | uuid FK → fin.companies | required |
| `sales_channel_id` | uuid FK → sal.sales_channels | nullable |
| `warehouse_id` | uuid FK → inv.warehouses | required |
| `store_code` | text | unique per (tenant, env, company) |
| `store_name` | text | |
| `legal_name` | text | nullable |
| `phone`, `email` | text | nullable |
| `timezone_name` | text | default `Asia/Phnom_Penh` |
| `primary_currency_code` | text(3) | default `USD` ⚠️ see Part 5.4 |
| `display_currency_code` | text(3) | default `KHR` |
| `default_exchange_rate` | numeric(18,6) | default 4100 |
| `is_active` | boolean | default true |
| `metadata` | jsonb | default `{}` |
| `created_by` | uuid FK → cp.accounts | nullable |
| `created_at`, `updated_at` | timestamptz | |
| — | — | **`vertical_type` (KitLuy delta): add enum laundry/cafe/restaurant/retail, immutable.** |

## A.2 `pos.carts`

| Column | Type | Notes |
|---|---|---|
| `cart_id` | uuid PK | |
| `tenant_id`, `env_id`, `company_id` | uuid FK | scope |
| `store_id`, `register_id`, `shift_id` | uuid FK | required |
| `session_id` | uuid FK | nullable |
| `sales_channel_id` | uuid FK → sal | nullable |
| `party_id` | uuid FK → core.parties | customer, nullable |
| `source_sales_order_id` / `source_sales_invoice_id` | uuid FK → sal | nullable |
| `cart_no` | text | unique per (tenant, env, company) |
| `cart_type` | pos.cart_type | default sale |
| `status` | pos.cart_status | default open |
| `currency_code` / `display_currency_code` | text(3) | USD / KHR |
| `exchange_rate` | numeric(18,6) | |
| `subtotal_amount`…`change_due_amount` | numeric(18,4) | totals block |
| `tendered_at`, `completed_at`, `voided_at`, `cancelled_at` | timestamptz | nullable |
| `offline_origin` | boolean | default false |
| `offline_local_ref` | text | nullable; unique per (store, register) |
| `sync_revision` | bigint | default 0 |
| `sales_invoice_id`, `receipt_id` | uuid FK → sal | set on completion |
| `notes`, `metadata` | text / jsonb | |
| `created_by` | uuid FK → cp.accounts | |
| `created_at`, `updated_at` | timestamptz | |

## A.3 `cafe.ingredients`

| Column | Type | Notes |
|---|---|---|
| `ingredient_id` | uuid PK | |
| `store_id` | uuid FK | ⚠️ → `pos.stores` (rename from `core.stores`) |
| `name_en` | text | |
| `unit` | enum | g / ml / unit |
| `current_stock` | decimal(10,3) | |
| `low_stock_threshold` | decimal(10,3) | |
| `reorder_point` | decimal(10,3) | |
| `cost_per_unit_khr` | integer | KHR integer |

## A.4 `ops.cafe_orders`

| Column | Type | Notes |
|---|---|---|
| `order_id` | uuid PK | |
| `store_id` | uuid FK | ⚠️ → `pos.stores` |
| `customer_id` | uuid FK | nullable (guest) |
| `service_mode` | enum | dine_in / takeaway / delivery |
| `origin_channel` | enum | walk_in / tma |
| `current_state` | enum | 8 states + voided/comped/refunded |
| `state_log` | jsonb | append-only |
| `subtotal_khr`…`total_khr` | integer | derived from cart `numeric`, rounded KHR |
| `payment_method` | enum | cash/khqr/card/tab/tma_prepaid |
| `aba_payway_ref` | text | nullable |
| `hsal_booking_id` | uuid FK → hsal.bookings | delivery only |
| `tab_id` | uuid FK → cafe.tabs | nullable |
| `table_reference` | text | nullable |
| `created_by_user_id` | uuid FK | ⚠️ → `cp.accounts` |
| `created_at`, `updated_at`, `completed_at` | timestamptz | |

## A.5 `cp.franchise_agreements` (KitLuy delta)

| Column | Type | Notes |
|---|---|---|
| `agreement_id` | uuid PK | |
| `brand_tenant_id` | uuid FK → cp.tenants | the brand |
| `franchisee_company_id` | uuid FK → fin.companies | the franchisee entity |
| `billing_mode` | enum | brand_consolidated / franchisee_direct |
| `royalty_pct` | numeric | nullable |
| `menu_push_rights` | enum | full / approve / none |
| `status` | enum | active / suspended / terminated |
| `start_date`, `end_date` | date | |

## A.6 Enum catalog (POS, live SQL)

`register_type`, `shift_status`, `shift_event_type`, `session_status`, `cart_type`, `cart_status`, `cart_line_type`, `tender_method`, `tender_status`, `tender_attempt_status`, `receipt_job_channel`, `receipt_job_status`, `offline_batch_status`, `offline_event_status` — values enumerated in Part 9.2.

## A.7 Reconciliation register (must resolve before/at rebuild)

| ID | Conflict | Recommended resolution |
|---|---|---|
| R-1 | Money: `numeric(18,4)` USD-primary storage vs KHR-integer display rule | Storage stays decimal/multi-currency; display always KHR integer via one shared rounding helper; café `_khr` derived at write (Part 5.4). |
| R-2 | Café FKs to `core.stores`/`pos.items`/`pos.terminals`/`core.users` | Rewrite to `pos.stores`/`inv.items` (or new `menu.*`)/`pos.registers`/`cp.accounts` (Part 9.6). |
| R-3 | `ops.cafe_orders` vs `pos.carts` as order source of truth | `pos.carts` = financial truth; `ops.cafe_orders`/`cafe.*` = café-operational layer keyed to cart (Part 5.6). |
| R-4 | Item/category home schema undefined in live SQL | Decide `inv.items` + category, or introduce `menu.*`; café links depend on this. |
| R-5 | Franchise layer absent from live SQL | Add `cp.franchise_agreements` + derive subscription payer from `billing_mode` (Part 9.8). |

---

*End of KitLuy Suite — Ecosystem Comprehensive Handbook v1.0.0.*
