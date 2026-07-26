# KitLuy Seller Portal — Rebuild Bible

**File:** `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md`
**Product:** `kitluy-seller-portal` (+ `kitluy-seller-app` mobile form-factor)
**Ecosystem:** HET Digital Ecosystem → KitLuy Suite (App #10)
**Owner:** Het Sovannara · Founder & Lead Architect
**Status:** v1.0.0 — Canonical
**Last updated:** 2026-04-10

> **Mission:** This document passes the **Rebuild Test** — *"If every person who built the KitLuy Seller Portal disappeared tomorrow, could a single engineer with zero prior context reconstruct the entire product, infrastructure, and business logic from this document alone?"* The answer is **yes**.
>
> **Scope note:** This bible covers the **Seller Portal only** — the web back-office for an individual shop owner, plus its mobile form-factor (`kitluy-seller-app`). Sibling products (Admin Portal, Chain HQ Portal, POS Desktop/Mobile) are referenced only where the Seller Portal touches them. For the full suite, see the KitLuy Master Handbook.

---

## 0. Front Matter — Rebuild Sequence (Read This First)

The Seller Portal is **not** a standalone system. It is a read/write client on top of a shared Supabase backend, consuming sibling ecosystem services. A lone engineer must resurrect the backend dependencies first, then the portal.

```
REBUILD SEQUENCE — KitLuy Seller Portal
1.  Provision infrastructure:
      Supabase project qneduoifcsvjajeqmvgb (region ap-southeast-1 / SGP1, PostgreSQL v17)
      DigitalOcean SGP1 for any static hosting / object storage
2.  Apply database migrations in order (Part 6, §6.5):
      kitluy baseline schemas → laundry vertical delta → security/RLS patches
      Migrations are WRITTEN by Claude, APPLIED only by the BE team. Never auto-apply.
3.  Seed baseline data (Part 16, §16.2):
      One tenant, one store (vertical_type='laundry', immutable), service catalog,
      item prices, staff + PINs, seed users password = password123
4.  Deploy edge functions (Part 7):
      17 KitLuy edge functions on Supabase Deno runtime. Seller Portal calls a subset.
5.  Configure secrets & credentials (Part 5, §5.4):
      ABA PayWay merchant credentials, Telegram bot token, Netra API key,
      Rotanak API key (read), HSAL API key (read). NEVER commit values.
6.  Build / image local hardware (Part 11, §11.2):
      Pi 5 Hub Server is a POS concern, NOT a Seller Portal concern. The Seller
      Portal is cloud-only (web). It reads data the Hub syncs up. Skip for portal-only rebuild.
7.  Pair / register clients (Part 11, §11.3):
      Seller Portal = browser client. No device pairing. Auth via Supabase
      (phone OTP primary). Seller App = same logic, mobile shell (EAS build).
8.  Run QA validation scenarios (Part 15):
      Execute the 25-scenario matrix. Seller-Portal-relevant: QA-009 (promo code),
      QA-018 (garment exception), QA-019 (customer prefs), QA-022 (customer tab).
9.  Verify monitoring & alerting (Part 12):
      Health checks on edge functions, Realtime channel subscriptions, sync-lag metric.
10. Go-live smoke test (Part 16, §16.6):
      Log in as Owner → view Dashboard → create a promo code → confirm it validates
      at POS → view a live order flowing from POS → reconcile finance dashboard.
```

**One-line truth:** The Seller Portal is the **shop owner's brain and control panel**. It does not process payments or run a register (that is the POS). It configures the store, monitors operations, manages customers and loyalty, runs marketing, and reads AI intelligence from Netra.

---

## Part 1 — Glossary

Every term used in Parts 2–18 is defined here first. Grouped by domain. Conflicting definitions are flagged **⚠️ RECONCILE** and listed in Appendix C.

### 1.1 Platform Terms

| Term | Definition |
|---|---|
| **HET Digital Ecosystem** | The 22-app parent platform built for the Cambodian market. KitLuy is App #10. |
| **KitLuy Suite** | "Cambodia's Shopify" — a modular, multi-vertical SaaS commerce + POS ecosystem for Cambodian SMEs. |
| **Seller Portal** | This product. The web back-office for an **individual shop owner** (single store, not a chain). API string surface: `kitluy-seller-portal`. |
| **Seller App** | The **mobile form-factor** of the Seller Portal. Same product, same logic, different shell. API string: `kitluy-seller-app`. |
| **Shared identity** | One `auth.users.id` UUID per person across every ecosystem app, via the single Supabase project. |
| **Vertical** | An industry configuration (laundry, café, restaurant, retail). One store = exactly one vertical, permanently. |
| **Phase 1 / Phase 2** | Rollout stages. Phase 1 = Laundry (live). Phase 2 = Café + Commerce features (marketing, advertising, subscriptions). |

### 1.2 Product / Build Terms

| Term | Definition |
|---|---|
| **Admin Portal** | `kitluy-admin-portal` — platform owner (HET HQ) god-view. Sibling product. |
| **Chain HQ Portal** | `kitluy-chain-portal` — brand/franchise owner multi-store control. Sibling product. |
| **POS Desktop** | `kitluy-pos-desktop-app` — Electron on Pi 5, store staff register. Sibling product. Source of all orders. |
| **POS Mobile** | `kitluy-pos-mobile-app` — mobile form-factor of POS Desktop. Sibling product. |
| **PlantOS** | The plant-operations pipeline (laundry processing stations T2–T6). Orders flow through it. Seller Portal monitors it read-mostly. |

### 1.3 Commerce Terms

| Term | Definition |
|---|---|
| **SaaS fee** | KitLuy's revenue. Flat monthly subscription. Commerce plan ៛30/store/month. **0% order commission.** |
| **Loyalty contribution** | Optional opt-in: 1–3% of gross revenue routed to the loyalty pool (Rotanak). Mode A = 0% (no loyalty). Mode B = 0% + 1–3% contribution. |
| **Promo code** | A merchant-created discount code, redeemed at POS. Funded entirely from store revenue. |
| **Automated flow** | A trigger-based marketing message (7 types) sent via Telegram. |
| **In-store offer** | An auto-applied POS-time discount (6 types). |
| **Subscription plan** | (Phase 2) A laundry credit-wallet plan customers buy. Use-it-or-lose-it. Paid add-on for the merchant. |
| **B2B account** | A business customer (hotel, spa) with a credit limit, customer tab, and invoicing. |
| **Customer tab** | A pay-later balance for a B2B account, settled weekly/biweekly/monthly. |

### 1.4 Hardware Terms (Reference Only — Portal is Cloud)

| Term | Definition |
|---|---|
| **Pi 5 Hub Server** | The local performance backbone at the store (8GB + NVMe). Runs a local PostgreSQL replica. A **POS** concern; the Seller Portal reads data the Hub syncs to cloud. |
| **Terminal (T1–T6)** | Pi 5 stations. T1=register, T2=customer display, T4=dispatcher/conveyor. POS concern. |
| **USB scale** | Weight-input device at T1 for weight-based laundry pricing. POS concern; Seller Portal configures the price/kg. |

### 1.5 Third-Party Terms

| Term | Definition |
|---|---|
| **ABA PayWay** | Cambodia's #1 payment gateway. KHQR deeplink + Card 3DS + escrow. Lives in cloud edge functions. |
| **KHQR** | The dynamic QR payment standard. Online-only (WAN required). |
| **Telegram** | Messaging channel for customer notifications, automated flows, and the merchant AI bot. |
| **Netra** | The shared AI brain. **Consumed** by the Seller Portal via API — never rebuilt inside KitLuy. Provides intelligence, suggestions, attribution. |
| **Rotanak** | The shared coalition loyalty platform. **Consumed** read-only (mirror) by the Seller Portal. The Rotanak Admin Portal is the write authority. |
| **HSAL** | The shared logistics/driver dispatch platform. **Consumed** read-only (tracking) by the Seller Portal. Phase 2 delivery only. |

### 1.6 Loyalty Terms (Rotanak — Consumed Read-Only)

| Term | Definition |
|---|---|
| **Angkorian Stars** | Non-spendable, tier-ranking points. 1★ per ៛1,000 spent. |
| **Sleung Coins** | Spendable currency. 1 coin = ៛100. Earned 1–3% by tier. 30% per-order redemption cap. |
| **Sleung Day** | Wednesday, when coin earning is multiplied 2×. |
| **Tiers** | Silver / Gold / Platinum / Diamond / Black Diamond (5 tiers). |

### 1.7 Feature-Index Terms

| Term | Definition |
|---|---|
| **KF-LD-*** | Laundry feature prefix. |
| **KF-CF-*** | Café feature prefix (Phase 2+). |
| **KF-001–010** | Phase 1 MVP laundry features. |
| **KF-041–050** | Phase 2 marketing & intelligence features surfaced in the Seller Portal (Part 17). |


---

## Part 2 — Business Overview

### 2.1 What it is

The KitLuy Seller Portal is the **web back-office for a single-store laundry owner**. It is the owner's command center: configure the store and services, set prices and capacity, monitor live orders flowing in from the POS, manage the customer base and loyalty, run marketing campaigns, and read AI-driven business intelligence. In one line: **the Shopify admin panel for a Cambodian laundry shop** — but consuming a shared AI brain, a coalition loyalty network, and a local-first POS pipeline that a single-box competitor cannot replicate.

### 2.2 What it is not

To prevent scope creep during rebuild, the Seller Portal is explicitly **NOT**:

- **Not a POS / register.** It does not take walk-in orders, scan garments at intake, or collect payment at a counter. That is `kitluy-pos-desktop-app`. The Seller Portal *monitors* orders the POS creates.
- **Not a payment processor.** It never calls ABA PayWay directly. Payment is a POS + edge-function concern. The Seller Portal *reconciles* and *reports* on payments.
- **Not a chain/franchise console.** It manages exactly **one** store. Multi-store brand control is `kitluy-chain-portal`.
- **Not an AI engine.** It does not run models. It **consumes** Netra via API and displays the output.
- **Not a loyalty authority.** It does not mint Stars or Coins or define tiers. It **mirrors** Rotanak read-only. Writes happen in the Rotanak Admin Portal.
- **Not a commission platform.** There are no B1/B2/B3 commission splits. Those are HSA-only constructs, explicitly excluded from KitLuy. Revenue is SaaS subscription only.

### 2.3 Verticals / Modules

The Seller Portal is **vertical-aware**. Phase 1 ships the **Laundry** bundle. One store = one vertical, enforced at the DB level (`pos.stores.vertical_type` is an immutable enum with a DB trigger). The Seller Portal renders the laundry-specific surfaces (Plants & Production, Garment Exceptions, weight pricing, garment-care knowledge base). Phase 2 adds the Café bundle as a sibling configuration; a single owner's store is still one vertical only.

| Vertical | Status | Seller Portal surfaces unlocked |
|---|---|---|
| **Laundry** | Phase 1 (live) | Plants & Production, Work Orders, Live Station Map, Garment Exceptions, weight-based pricing, garment-care KB |
| **Café** | Phase 2 (active design) | (Sibling bundle — different store) |
| **Restaurant / Retail** | Phase 3+ | (Future bundles) |

### 2.4 Product / Build Inventory (Seller-Portal Scope)

| Build | Audience | Form factor | Scope |
|---|---|---|---|
| `kitluy-seller-portal` | Individual shop owner, store manager | Web (React 18 + Vite + Tailwind v4) | Full back-office: dashboard, catalog, orders monitoring, customers, loyalty, marketing, advertising, subscriptions, finance, production monitoring, settings |
| `kitluy-seller-app` | Same owner, on the go | Mobile (React Native + Expo) | **Form-factor pairing** — same logic, mobile shell. Parity target: dashboard, orders, customers, approvals, AI alerts. See Part 17, §17.3. |

### 2.5 Business Model

| Dimension | Value |
|---|---|
| **Revenue type** | SaaS subscription only. **0% order commission.** |
| **Commerce plan** | ៛30 / store / month |
| **Chain plan** (sibling) | ៛100 HQ + ៛50 / store / month |
| **Trial** | 14-day free trial, then auto-bill |
| **Loyalty contribution** | Optional 1–3% of gross → loyalty pool (Mode B), or 0% (Mode A) |
| **Paid add-ons** | AI Advertising suite, full Subscription suite (base plan = basic subscriptions only) |
| **Hardware economics** | Pi 5 + terminals sold/leased per store. A POS concern, not Seller-Portal revenue. |

The Seller Portal **displays** the owner's subscription status, trial countdown, and SaaS invoice — it does not bill (the Admin Portal + `kitluy-subscriber-health` cron own billing). It shows the loyalty contribution rate the owner selected and the resulting Coin liability.

### 2.6 Moat / Defensibility

Structural moats a single-box competitor (e.g., a $180 one-time POS bundle with a perpetual license) cannot replicate:

1. **Netra AI** — shared intelligence brain; cross-tenant learning the Seller Portal surfaces as plain-language recommendations.
2. **Rotanak coalition loyalty** — network-effect loyalty spendable across every ecosystem merchant, not a single-shop punch card.
3. **HSAL logistics** — on-demand delivery fleet (Phase 2) the Seller Portal can attach.
4. **Shared identity** — one customer UUID across all ecosystem apps; the Seller Portal sees a richer customer than any standalone POS.
5. **Pi 5 Hub local-first** — sub-millisecond POS performance with offline capability; the Seller Portal reads a continuously-synced, conflict-resolved data set.

### 2.7 Ecosystem Position

| Service | Relationship | Direction | Owned vs Consumed |
|---|---|---|---|
| **Shared identity** (`auth.users`) | One UUID per person | Read | **Consumed** (shared) |
| **Netra** (AI brain) | Intelligence, suggestions, attribution, explanations | Read (via API) | **Consumed** — never rebuilt |
| **Rotanak** (loyalty) | Stars, Coins, tiers, wallets | Read-only mirror | **Consumed** — write authority is Rotanak Admin Portal |
| **HSAL** (logistics) | Delivery tracking (Phase 2) | Read-only | **Consumed** |
| **ABA PayWay** (payments) | Settlement/reconciliation data | Read (via edge fn) | **Consumed** |
| **Telegram** (messaging) | Notifications, flows, AI bot | Write (via edge fn) | **Consumed** |
| **KitLuy schemas** (`menu.*`, `orders.*`, `inventory.*`, `pos.*`, `kitluy.*`, `audit.*`) | Store/catalog/orders/customers/marketing | Read + Write | **Owned** by KitLuy |

**The governing rule:** KitLuy *consumes* Netra, Rotanak, and HSAL — it **never rebuilds them**. This "consumes-not-builds" rule governs every feature decision in the Seller Portal.


---

## Part 3 — System Architecture & Topology

### 3.1 Topology Diagram

The Seller Portal is a **cloud-only browser client**. It has no local hardware footprint. It reads and writes through Supabase (edge functions for mutations, direct queries via RLS for reads). The diagram below shows the Seller Portal's position relative to the data it depends on.

```
                              ☁  CLOUD (Supabase project qneduoifcsvjajeqmvgb, ap-southeast-1)
   ┌──────────────────────────────────────────────────────────────────────────────┐
   │                                                                                │
   │   ┌───────────────┐     ┌──────────────────┐     ┌────────────────────────┐   │
   │   │  PostgreSQL 17 │◄────┤   Edge Functions  │────►│  Supabase Realtime     │   │
   │   │  kitluy.* RLS  │     │   (Deno, 17 fns)  │     │  (live order push)     │   │
   │   └───────┬───────┘     └────────┬─────────┘     └───────────┬────────────┘   │
   │           │                      │                            │                │
   │           │            ┌─────────┴──────────┐                 │                │
   │           │            │  3rd-party gateways │                 │                │
   │           │            │  • ABA PayWay       │                 │                │
   │           │            │  • Telegram Bot API │                 │                │
   │           │            │  • Netra API (AI)   │                 │                │
   │           │            │  • Rotanak API (RO) │                 │                │
   │           │            │  • HSAL API (RO)    │                 │                │
   │           │            └────────────────────┘                 │                │
   └───────────┼──────────────────────────────────────────────────┼────────────────┘
       ░ WAN ░ │  (HTTPS / TLS 1.3)                        ░ WAN ░  │ (WSS)
   ┌───────────┴──────────────────┐              ┌──────────────────┴───────────────┐
   │  💻 SELLER PORTAL (browser)   │              │  📱 SELLER APP (Expo, mobile)     │
   │  React 18 + Vite + Tailwind  │              │  React Native — form-factor pair  │
   │  Owner / Manager             │              │  Owner on the go                  │
   └──────────────────────────────┘              └───────────────────────────────────┘

   ────────────────────────────────────────────────────────────────────────────────
   DATA ORIGIN (not part of the portal, but the portal reads its output):

   ┌──────────────────────────────────────────┐
   │  🏪 STORE (LAN) — POS concern             │
   │  ┌──────────┐   ┌──────────┐  ┌────────┐  │
   │  │ Pi 5 Hub │◄──┤ T1 POS   │  │ T4 Disp│  │   Hub batches events → syncs UP to
   │  │ PG replica│   │ register │  │ conveyor│  │   cloud via kitluy-sync-hub.
   │  └────┬─────┘   └──────────┘  └────────┘  │   The Seller Portal reads the
   │       └── outbox/inbox sync ──────────────┼─► synced, conflict-resolved data.
   └──────────────────────────────────────────┘
```

**LAN vs WAN boundaries:**
- The **Seller Portal ↔ Cloud** link is always **WAN** (HTTPS/WSS). The portal has no offline mode — it is a management tool, not an operational register.
- The **Hub ↔ Terminals** link is **LAN** (a POS concern). Cash orders survive WAN loss locally; the portal simply shows stale data until sync resumes.

### 3.2 Data Flow Maps

The Seller Portal participates in flows mostly as a **reader** and as a **config writer**. Three critical flows:

**Flow A — Promo code creation → POS redemption (write, then observe):**
```
1. Owner (Seller Portal) → POST kitluy-* promo create → INSERT kitluy.marketing.promo_codes
2. kitluy-chain-catalog-push (if chain) OR direct → promo available to POS
3. Cashier (POS) enters code at checkout → kitluy-create-order validates against promo_codes
4. On valid → INSERT kitluy.marketing.promo_redemptions, discount applied
5. Seller Portal → Marketing > Promo Analytics reads promo_redemptions → usage + revenue
```

**Flow B — Live order monitoring (read via Realtime):**
```
1. Cashier (POS) creates order → kitluy-create-order → INSERT kitluy.orders.orders
2. Edge fn emits order_created → kitluy.events.domain_events (immutable)
3. Supabase Realtime broadcasts on the store's channel
4. Seller Portal (subscribed) → Dashboard / Order Center updates live
5. As PlantOS advances status → order_status_changed events → portal timeline updates
```

**Flow C — AI recommendation surfacing (read from Netra):**
```
1. kitluy-ai-alerts-cron (daily) analyzes kitluy.events.domain_events
2. Calls Netra API → receives recommendations + confidence + reasoning
3. Writes to kitluy.ai.ai_alerts / ai_predictions
4. Seller Portal → AI Insights / AI Explanations reads ai_alerts
5. Owner acts → action pre-fills the relevant module (e.g., campaign builder)
```

### 3.3 Offline-First Protocol

**The Seller Portal itself is online-only.** It does not capture local state or sync. However, it *reads the product of* the POS offline-first protocol, so a rebuild engineer must understand it to interpret the data:

- **Capture:** POS writes operations to a local **outbox** on the Pi Hub.
- **Batch:** 2-second flush window, gzip-batched.
- **Idempotency key format:** `op_id` (a UUID generated on the terminal **before** any DB write).
- **CDC columns:** every synced row carries change-data-capture columns.
- **Conflict resolution policy:**
  - **Operational data** (inventory levels): **last-write-wins**.
  - **Financial documents** (orders, payments): **append-only** — never mutated, corrections are new rows.

The Seller Portal therefore must treat order/payment records as immutable history and render corrections as additive events, never as edits.

### 3.4 Hardware Placement (per vertical)

**None for the Seller Portal.** It is a browser/mobile app. This section exists to state explicitly: a rebuild engineer provisioning the Seller Portal needs **zero physical hardware**. The Pi 5 Hub, terminals, USB scale, thermal enclosures, and UPS strategy are all **POS concerns** documented in the POS bible. The Seller Portal's only "placement" is the owner's laptop or phone.

### 3.5 Environment Promotion

| Stage | Purpose | How artifacts move |
|---|---|---|
| **Dev** | Local development | Vite dev server against a dev Supabase branch |
| **Staging** | Pre-prod validation | EAS preview build (app) / preview deploy (web); migrations applied to staging by BE team |
| **Prod** | Live | EAS production build → App/Play Store (app); production web deploy on DigitalOcean SGP1 |

Migrations are **written by Claude, applied only by the BE team** — never auto-applied from the portal repo. Secrets are injected per environment (Part 5, §5.4); they never live in the portal bundle.


---

## Part 4 — External Contracts & Integrations

The Seller Portal touches six external services. It calls most **indirectly** through edge functions (which hold the secrets); it never embeds third-party credentials in the browser bundle.

### 4.1 ABA PayWay (Payments)

- **4.1.1 Purpose** — The Seller Portal does **not** initiate payments. It reads settlement and reconciliation data so the owner can verify payouts. Payment initiation is a POS + `kitluy-process-payment` concern.
- **4.1.2 Authentication** — Merchant credentials live in edge-function secrets only. The portal calls an internal reconciliation endpoint, authenticated by the owner's Supabase session + RLS on `kitluy.orders.order_payments`.
- **4.1.3 Request/Response Contracts** — Portal-side reads: `GET` order payments scoped by `store_id`. Fields: `payment_type` (full/deposit/balance/tab), `payment_method` (cash/khqr/aba/card/coin/split/tab/deposit), `amount_khr` (integer), `paid_at` (timestamptz), `payway_ref` (nullable text).
- **4.1.4 Error Handling & Retry** — Reconciliation reads are idempotent GETs; on timeout the portal retries with exponential backoff (1s, 2s, 4s; max 3). No circuit breaker needed for reads.
- **4.1.5 Webhook Events** — The **PayWay webhook receiver is an edge function** (cloud layer), not the portal. It verifies the PayWay signature and writes `payment_completed` to `domain_events`. The portal observes via Realtime. (Webhook receiver is a v1.1.0 backend patch item.)
- **4.1.6 Sandbox vs Production** — Sandbox uses PayWay test merchant + simulated KHQR confirmation. The portal behaves identically; only the underlying edge-function endpoint differs.

### 4.2 Netra (AI Brain — Consumed)

- **4.2.1 Purpose** — Source of all intelligence the Seller Portal displays: AI Copilot insights, Smart Suggestions, O2O attribution, audience scoring, plain-language explanations.
- **4.2.2 Authentication** — Netra API key in edge-function secrets. The portal never calls Netra directly; it reads `kitluy.ai.*` tables that edge functions populate.
- **4.2.3 Request/Response Contracts** — Edge fn `kitluy-ai-query` accepts `{store_id, question}` → returns `{answer, sql_used, confidence}`. `kitluy-ai-alerts-cron` writes `ai_alerts {type, title, body, confidence, source, created_at}`.
- **4.2.4 Error Handling & Retry** — If Netra is unreachable, edge functions log and skip; the portal shows "No new insights" rather than an error. AI is **additive** — its absence never blocks operations.
- **4.2.5 Webhook Events** — None inbound to the portal. Netra results are polled by crons and written to tables.
- **4.2.6 Sandbox vs Production** — Phase 1 ships **no AI** (data-foundation only — events are logged but not consumed). AI surfaces light up in Phase 2A. A Phase-1 rebuild can stub all `kitluy.ai.*` reads to empty.

### 4.3 Rotanak (Loyalty — Consumed Read-Only)

- **4.3.1 Purpose** — Source of Stars, Coins, tiers, and wallet balances the portal mirrors. The portal **displays** loyalty; it never mints or mutates it.
- **4.3.2 Authentication** — Rotanak API key (read scope) in edge-function secrets. The portal reads a **read-only mirror** in `loyalty.*` (owned by Rotanak) plus chain loyalty in `kitluy.loyalty_chain.*` for chain stores.
- **4.3.3 Request/Response Contracts** — Earn calc is performed by `kitluy-loyalty-earn` on `order_completed`: Stars = floor(spend_khr / 1000); Coins = spend_khr × tier_rate (1–3%), Sleung Day ×2. Redeem by `kitluy-loyalty-redeem`: verify identity → deduct coins → 30% per-order cap.
- **4.3.4 Error Handling & Retry** — If Rotanak is unreachable during earn, the event is queued in `domain_events` and reconciled later. Display falls back to last-known mirror values.
- **4.3.5 Webhook Events** — None to the portal. Mirror refresh is pull-based.
- **4.3.6 Sandbox vs Production** — Sandbox uses a Rotanak test program. Tier rates and Sleung Day config are identical.

**Display rule:** Loyalty pages in the Seller Portal that mirror Rotanak data **must carry a gold `#F5A623` banner** per ecosystem rule §5.3 (Part 9, §9.2).

### 4.4 HSAL (Logistics — Consumed Read-Only, Phase 2)

- **4.4.1 Purpose** — Delivery tracking when the owner attaches HSAL delivery (Phase 2). Phase 1 is walk-in/counter only.
- **4.4.2 Authentication** — HSAL API key (read scope) in edge-function secrets. Portal reads tracking status only.
- **4.4.3 Request/Response Contracts** — Read driver/delivery status by `order_id`. Driver authorization (server-side) uses `core.users.role_type = 'driver'` **directly** — never `core.user_roles` (globally empty, legacy).
- **4.4.4–4.4.6** — Phase 2 scope. Phase-1 rebuild stubs the Fulfillment > Delivery surfaces as placeholders.

### 4.5 Telegram (Messaging — Consumed)

- **4.5.1 Purpose** — Channel for customer notifications (order ready, late pickup), automated marketing flows, and the merchant AI bot.
- **4.5.2 Authentication** — Telegram bot token in edge-function secrets. The portal triggers sends by writing config (flow enable/disable, templates) that edge functions act on.
- **4.5.3 Request/Response Contracts** — `kitluy-notify-customer` and `kitluy-order-progress-notify` read `kitluy.notifications.notification_templates`, send via Telegram Bot API, and log to `notification_logs`.
- **4.5.4 Error Handling & Retry** — Failed sends are logged; late-pickup reminders cap at 3 attempts.
- **4.5.5 Webhook Events** — `kitluy-telegram-bot` handles inbound merchant messages (AI advisor). Verified by the Telegram secret token. Not portal-facing.
- **4.5.6 Sandbox vs Production** — Sandbox uses a test bot. Identical template logic.

### 4.6 Supabase (Identity, Storage, Realtime)

- **4.6.1 Purpose** — Auth (phone OTP primary), Realtime (live order push), Storage (receipt/creative assets).
- **4.6.2 Authentication** — Supabase anon key in the portal bundle (safe — RLS enforces tenancy). Service-role key is **edge-function-only**, never in the portal.
- **4.6.3 Request/Response Contracts** — Standard Supabase JS client. Reads are RLS-scoped by `store_id`. Mutations route through edge functions (service-role).
- **4.6.4 Error Handling & Retry** — Realtime auto-reconnects; on reconnect the portal re-fetches the current page to reconcile any missed events.
- **4.6.5 Webhook Events** — Realtime channel messages (order/status). Subscribed per store.
- **4.6.6 Sandbox vs Production** — Supabase branches per environment; same client code.

**Integration coverage matrix:**

| Integration | Portal calls | Secret location | Phase |
|---|---|---|---|
| ABA PayWay | Indirect (read recon) | Edge fn | 1 |
| Netra | Indirect (read tables) | Edge fn | 2 (stub in 1) |
| Rotanak | Indirect (read mirror) | Edge fn | 1 |
| HSAL | Indirect (read tracking) | Edge fn | 2 |
| Telegram | Indirect (write config) | Edge fn | 1 |
| Supabase | Direct (anon + RLS) | Bundle (anon only) | 1 |


---

## Part 5 — Tech Stack & Repository Structure

### 5.1 Stack by Layer

| Layer | Technology |
|---|---|
| **Web frontend** | React 18 + TypeScript + Vite + Tailwind CSS v4 |
| **Mobile frontend** | React Native + Expo + TypeScript (form-factor pairing) |
| **State management** | Zustand |
| **Backend** | Supabase (PostgreSQL 17, Auth, Edge Functions/Deno, Realtime, Storage) |
| **Payments** | ABA PayWay (KHQR deeplink + Card 3DS + escrow) — edge-function layer |
| **AI gateway** | Claude (Haiku/Sonnet) via Netra, consumed through edge functions |
| **Maps** | Google Maps API (external); HelloMap (sovereign, in development) — minimal in Seller Portal |
| **Messaging** | Telegram Bot API (notifications/flows/AI bot) via edge functions |
| **Hosting** | DigitalOcean SGP1 (web static); Supabase cloud (backend) |
| **Mobile build** | EAS Build → Play Store + App Store |
| **Accounting sync** | ERPNext (back-office, sibling concern) |

### 5.2 Repository Layout

The Seller Portal lives in the KitLuy monorepo. Portal-relevant tree:

```
kitluy/
├── apps/
│   ├── seller-portal/          # THIS PRODUCT (web)
│   │   ├── src/
│   │   │   ├── pages/          # Route components (Dashboard, Orders, Marketing, …)
│   │   │   ├── components/     # Shared UI (Card, KPI, Badge, Table primitives)
│   │   │   ├── lib/            # Supabase client, formatters (KHR), hooks
│   │   │   ├── store/          # Zustand stores
│   │   │   └── routes.ts       # Route → page map (mirrors wireframe ROUTES)
│   │   └── vite.config.ts
│   └── seller-app/             # Mobile form-factor (React Native + Expo)
├── supabase/
│   ├── migrations/             # SQL — written by Claude, applied by BE team ONLY
│   └── functions/              # Edge functions (Deno) — 17 KitLuy fns
├── wireframes/
│   └── kitluy-seller-portal-wireframe-vX.Y.Z.jsx   # Design source of truth
├── docs/
│   └── kitluy-seller-portal-rebuild-bible-md-vX.Y.Z.md   # THIS FILE
└── packages/
    └── shared/                 # Cross-app types, KHR helper, enums
```

### 5.3 Build & Deploy Pipeline

| Artifact | Build | Deploy |
|---|---|---|
| Seller Portal (web) | `vite build` | DigitalOcean SGP1 static + CDN |
| Seller App (mobile) | `eas build` | Play Store + App Store |
| Edge functions | `supabase functions deploy` (BE team) | Supabase Deno runtime |
| Migrations | Hand-authored SQL (Claude) | `supabase db push` by **BE team only** |

### 5.4 Secrets Inventory (Names Only — Never Values)

| Secret | Purpose | Consumed by | Rotation |
|---|---|---|---|
| `SUPABASE_URL` | Backend endpoint | Portal + edge fns | Static |
| `SUPABASE_ANON_KEY` | Public client key (RLS-guarded) | Portal bundle | On compromise |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged DB access | **Edge fns only** | Quarterly |
| `PAYWAY_MERCHANT_ID` | ABA PayWay merchant | `kitluy-process-payment`, webhook receiver | On vendor request |
| `PAYWAY_API_KEY` | ABA PayWay auth | Same | On vendor request |
| `PAYWAY_WEBHOOK_SECRET` | Verify webhook signatures | Webhook receiver edge fn | On vendor request |
| `TELEGRAM_BOT_TOKEN` | Send/receive Telegram | `kitluy-notify-customer`, `kitluy-telegram-bot` | On compromise |
| `NETRA_API_KEY` | AI brain access | `kitluy-ai-query`, `kitluy-ai-alerts-cron` | Quarterly |
| `ROTANAK_API_KEY` | Loyalty read | `kitluy-loyalty-*` | Quarterly |
| `HSAL_API_KEY` | Logistics read (P2) | HSAL tracking edge fn | Quarterly |

**Rule:** Only `SUPABASE_URL` and `SUPABASE_ANON_KEY` reach the portal bundle. Everything else is edge-function-only. The portal never holds a service-role key or any third-party secret.

### 5.5 Permanently Removed Decisions

To prevent zombie reconsideration during rebuild:

| Rejected | In favor of | Reason |
|---|---|---|
| **Zendrite** | Supabase Realtime / SroulApp Engine (P3) | Consolidated on the ecosystem stack |
| **Matrix** | Supabase Realtime / SroulApp Engine (P3) | Same |
| **B1/B2/B3 commission splits** | SaaS subscription (0% commission) | Those are HSA-only constructs, explicitly excluded from KitLuy |
| **`core.user_roles` for driver auth** | `core.users.role_type = 'driver'` direct lookup | `user_roles` is globally empty, legacy |
| **Abstract docx numbering** (handbook authoring) | Plain bullet characters | 80+ numbering defs crash the Word viewer |
| **`₭` currency symbol** | `៛` (U+17DB) | `₭` is Lao Kip, wrong for KHR |


---

## Part 6 — Database Schema (Canonical)

**CRITICAL RULE:** Where any earlier spec disagrees with live SQL on a table name, column type, or FK target, **the live SQL wins** here. Conflicts are moved to Appendix C. This chapter is clean.

> **Naming reconciliation note:** The KitLuy Master Handbook v1.0.1 documents schemas under the `kitluy.*` umbrella (e.g., `kitluy.orders`, `kitluy.marketing`). Project architecture also references schema-prefixed homes `menu.*`, `orders.*`, `inventory.*`, `pos.*`, `kitluy.*`, `audit.*`. This bible uses the **handbook's `kitluy.*`-prefixed** namespace as canonical for Seller-Portal-owned data, and notes the prefix mapping in Appendix C (RECON-01). All tables have **RLS enabled**.

### 6.1 Schema Inventory

| Schema | Owner | Purpose | Seller Portal access |
|---|---|---|---|
| `auth` | Supabase | Identity (`auth.users.id` UUID) | Read (session) |
| `core` | Ecosystem | Shared users, roles | Read |
| `loyalty` | **Rotanak** | Stars, Coins, wallets, tiers | **Read-only mirror** |
| `kitluy.stores` | KitLuy | Store config, staff, shifts, devices | Read + write (config) |
| `kitluy.catalog` | KitLuy | Products/services, variants, categories, modifiers, recipes (BOM) | Read + write |
| `kitluy.inventory` | KitLuy | Stock levels, adjustments, POs, suppliers, supplies tracking | Read + write |
| `kitluy.orders` | KitLuy | Orders, items, payments, garment details/tags/exceptions | Read (mostly), write via edge fn |
| `kitluy.customers` | KitLuy | Customers, preferences, tabs, B2B accounts | Read + write |
| `kitluy.loyalty_chain` | KitLuy | Chain loyalty (chain stores only) | Read + write (chain) |
| `kitluy.marketing` | KitLuy | Promo codes, redemptions, automated flows, in-store offers, referrals | Read + write |
| `kitluy.advertising` | KitLuy | AI campaigns, content, suggestions (paid add-on) | Read + write |
| `kitluy.chain` | KitLuy | Chains, franchisees, royalty, compliance, territories | Read (chain context) |
| `kitluy.events` | KitLuy | `domain_events` (immutable, append-only) | Read (analytics) |
| `kitluy.ai` | KitLuy | AI queries, alerts, predictions | Read (display) |
| `kitluy.notifications` | KitLuy | Templates, logs | Read + write (templates) |

### 6.2 Table Specifications (Seller-Portal-Critical)

Only tables the Seller Portal reads or writes are specified. Full DDL lives in migrations (Part 6, §6.5).

**`kitluy.stores.stores`** — the anchor row.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, default gen | Store identifier |
| `tenant_id` | UUID | NOT NULL, FK → tenant | Ownership chain root |
| `vertical_type` | TEXT | NOT NULL, CHECK in (laundry,cafe,restaurant,retail) | **IMMUTABLE** — DB trigger blocks change. 1 store = 1 vertical. |
| `name` | TEXT | NOT NULL | Display name |
| `loyalty_opt_in` | BOOLEAN | NOT NULL, default false | Mode A (false) vs Mode B (true) |
| `loyalty_rate_pct` | INTEGER | CHECK 0–3 | Contribution rate; ≤3 enforced |
| `created_at` | timestamptz | NOT NULL, default now() | `Asia/Phnom_Penh` |

**`kitluy.orders.orders`** — financial document (append-only; never mutated).

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK, **generated on terminal** | Created BEFORE any DB write (idempotency) |
| `store_id` | UUID | NOT NULL, FK → stores | RLS scope |
| `total_khr` | INTEGER | NOT NULL, ≥ 0 | **KHR integer only.** No decimals. |
| `payment_method` | TEXT | NOT NULL | cash/khqr/aba/card/coin/split/tab/deposit |
| `status` | TEXT | NOT NULL | created/paid/processing/ready/collected/completed/cancelled |
| `customer_id` | UUID | nullable, FK → customers | Walk-ins may be anonymous |
| `due_date` | timestamptz | nullable | Set by `kitluy-due-date-calc` |
| `created_at` | timestamptz | NOT NULL | |

**`kitluy.orders.garment_details`** — laundry-specific.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `order_id` | UUID | NOT NULL, FK → orders | |
| `tag_barcode` | TEXT | UNIQUE | Durable tag, scannable at every station |
| `slot_number` | INTEGER | nullable | Conveyor slot; freed on pickup |
| `fabric` / `color` / `instructions` | TEXT | nullable | Intake detailing (Feature #2) |

**`kitluy.orders.garment_exceptions`** — Feature #14.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `garment_id` | UUID | FK → garment_details | |
| `reason` | TEXT | NOT NULL | re_clean/stain_treatment/wrong_service/complaint |
| `status` | TEXT | NOT NULL | pending/in_progress/resolved |

**`kitluy.customers.customers` / `customer_preferences` / `customer_tabs` / `b2b_accounts`**

| Table.Column | Type | Constraints | Notes |
|---|---|---|---|
| `customers.id` | UUID | PK | Linked to `auth.users.id` when known |
| `customer_preferences.key` | TEXT | NOT NULL | care_level/packaging/instructions/pickup_method (Feature #15) |
| `customer_tabs.settlement_period` | TEXT | NOT NULL | weekly/biweekly/monthly (Feature #18) |
| `order_payments.payment_type` | TEXT | NOT NULL | full/deposit/balance/tab (Features #16/#17) |
| `b2b_accounts.credit_limit_khr` | INTEGER | ≥ 0 | Feature #6 |

**`kitluy.marketing.*`**

| Table.Column | Type | Constraints | Notes |
|---|---|---|---|
| `promo_codes.discount_type` | TEXT | NOT NULL | pct/fixed |
| `promo_codes.code` | TEXT | UNIQUE per store | Merchant-defined or auto |
| `automated_flows.flow_type` | TEXT | NOT NULL | we_miss_you/review_request/late_pickup/first_visit/birthday/tier_up/recurring |
| `instore_offers.offer_type` | TEXT | NOT NULL | happy_hour/bundle/seasonal/double_coins/min_spend/new_customer |
| `referrals.status` | TEXT | NOT NULL | pending/completed/expired |

**`kitluy.advertising.ai_campaigns`** (paid add-on)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `status` | TEXT | NOT NULL | draft/running/paused/completed |
| `budget_khr` | INTEGER | ≥ 0 | KHR integer |

**`kitluy.events.domain_events`** (immutable)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `event_type` | TEXT | NOT NULL | order_created/payment_completed/garment_checked_in/etc. |
| `payload` | JSONB | NOT NULL | Full event data; schema varies by type |
| `created_at` | timestamptz | NOT NULL | Append-only; never updated/deleted |

### 6.3 Enum Catalog

Stored as TEXT + CHECK constraints (handbook convention), logically grouped:

| Enum domain | Values |
|---|---|
| `stores.vertical_type` | laundry, cafe, restaurant, retail |
| `orders.status` | created, paid, processing, ready, collected, completed, cancelled |
| `orders.payment_method` | cash, khqr, aba, card, coin, split, tab, deposit |
| `order_payments.payment_type` | full, deposit, balance, tab |
| `garment_exceptions.reason` | re_clean, stain_treatment, wrong_service, complaint |
| `customer_preferences.key` | care_level, packaging, instructions, pickup_method |
| `customer_tabs.settlement_period` | weekly, biweekly, monthly |
| `promo_codes.discount_type` | pct, fixed |
| `automated_flows.flow_type` | we_miss_you, review_request, late_pickup, first_visit, birthday, tier_up, recurring |
| `instore_offers.offer_type` | happy_hour, bundle, seasonal, double_coins, min_spend, new_customer |
| `ai_campaigns.status` | draft, running, paused, completed |
| Loyalty tiers (Rotanak) | Silver, Gold, Platinum, Diamond, Black Diamond |

### 6.4 RLS Policy Summary

**Every table has RLS enabled.** The canonical pattern scopes by store ownership:

```sql
-- Read: owner/manager/staff of the store, or service role
USING (
  core.is_service_role()
  OR store_id IN (SELECT store_id FROM kitluy.stores.store_staff
                  WHERE user_id = auth.uid())
)
```

- **Reads** from the portal are RLS-scoped by `store_id` derived from the logged-in user's staff membership.
- **Writes** route through edge functions using the **service role**, which re-validates scope at the function layer (Part 7).
- **Direct DB access is service-role-only**; apps go through edge functions for mutations.

### 6.5 Migration Sequencing

```
1. BASELINE         kitluy schemas (stores, catalog, inventory, orders,
                    customers, marketing, advertising, chain, events, ai,
                    notifications, loyalty_chain) + RLS enable
2. LAUNDRY DELTA    garment_details, garment_tags, garment_exceptions,
                    weight-pricing columns, customer_preferences,
                    customer_tabs, b2b_accounts, order_payments types
3. SECURITY PATCHES RLS policy refinements, immutability trigger on
                    stores.vertical_type, append-only guard on orders/payments
```

Migrations are **written by Claude, applied only by the BE team**. Never auto-applied. The vertical-franchise migration (`kitluy-vertical-franchise-migration-sql-v1.0.0.sql`) resolves four reconciliation items: `menu.*` schema home, `vertical_type` immutable enum + trigger, `cp.franchise_agreements` billing modes, and café FK reconciliation.

### 6.6 Naming Conventions

- **Schema-prefixed table names always.** ✓ `kitluy.orders.orders`, never bare `orders`.
- **KHR is integer-only**, no decimals; symbol `៛` (U+17DB).
- **Phone numbers:** E.164 (`+855 12 345 678`).
- **Timestamps:** `timestamptz`, timezone `Asia/Phnom_Penh`.
- **Passwords/PINs:** Argon2id.
- **Idempotency key:** `op_id` UUID, generated on the terminal before any DB write.
- **UUIDs:** generated client-side for orders (pre-write); server default elsewhere.


---

## Part 7 — API / Edge Function Specifications

The Seller Portal calls a **subset** of the 17 KitLuy edge functions. Functions the POS owns (e.g., `kitluy-create-order`, `kitluy-process-payment`) are listed for context but are not portal-initiated. Portal-initiated or portal-observed functions are marked.

### 7.1 Shared / Core Functions

**`kitluy-sync-hub`** — *(observed, not called by portal)*
- **Route:** `POST /kitluy-sync-hub`
- **Auth:** Hub service token
- **Purpose:** Receive batched events from the Pi Hub, merge, resolve conflicts (operational = last-write-wins, financial = append-only). The Seller Portal reads the merged result.
- **Side effects:** Writes across `kitluy.orders.*`, `kitluy.inventory.*`; emits Realtime broadcasts the portal subscribes to.

**`kitluy-ai-query`** — *(portal-initiated)*
- **Route:** `POST /kitluy-ai-query`
- **Auth:** Owner/Manager session (RBAC: Access AI advisor)
- **Request:** `{ "store_id": "uuid", "question": "string" }`
- **Response 200:** `{ "answer": "string", "sql_used": "string", "confidence": 0.0-1.0 }`
- **Response 401:** `{ "error": "unauthorized" }` (Cashier role denied)
- **Side effects:** Reads `kitluy.events.domain_events` → Netra → writes `kitluy.ai.ai_queries`.
- **Idempotency:** Read-only analysis; safe to replay.

### 7.2 Domain / Vertical Functions

**`kitluy-loyalty-earn`** — *(observed)*
- **Route:** `POST /kitluy-loyalty-earn`
- **Auth:** service role (triggered by `order_completed`)
- **Purpose:** Stars = floor(spend/1000); Coins = spend × tier_rate (Sleung Day ×2). Commerce → Rotanak; Chain → own wallet.
- **Side effects:** Writes `loyalty.*` (Rotanak) or `kitluy.loyalty_chain.*`; portal reads the result.

**`kitluy-loyalty-redeem`** — *(observed; POS-initiated)*
- **Route:** `POST /kitluy-loyalty-redeem`
- **Auth:** Cashier+ at POS
- **Purpose:** Verify identity → deduct coins → apply discount (30% per-order cap).

**`kitluy-garment-exception`** — *(portal- or POS-initiated)*
- **Route:** `POST /kitluy-garment-exception`
- **Auth:** Manager/Owner (portal) or staff (POS)
- **Request:** `{ "garment_id": "uuid", "reason": "re_clean|stain_treatment|wrong_service|complaint", "note": "string?" }`
- **Response 200:** `{ "exception_id": "uuid", "routed_to_station": "string" }`
- **Side effects:** INSERT `kitluy.orders.garment_exceptions`; routes garment back to a station; **customer-facing status unchanged**.

**`kitluy-tab-settlement`** — *(observed; cron)*
- **Route:** cron (weekly/monthly)
- **Purpose:** Calculate B2B tab balances → generate invoices → Telegram. Portal reads balances and invoices in Customers > B2B Accounts.

**`kitluy-marketing-campaign`** — *(portal-initiated; paid add-on)*
- **Route:** `POST /kitluy-marketing-campaign`
- **Auth:** Owner (RBAC: Launch AI campaign). **Requires explicit merchant approval before any launch.**
- **Request:** `{ "store_id", "creative_id", "goal", "budget_khr", "radius_m", "audience_segment_id", "channels": ["facebook"|"tiktok"|"telegram"] }`
- **Response 200:** `{ "campaign_id": "uuid", "status": "running" }`
- **Side effects:** Generates/deploys AI content to social APIs; monitors + reallocates budget; writes `kitluy.advertising.ai_campaigns`.

**`kitluy-subscriber-health`** — *(observed; weekly cron)*
- **Purpose:** Score subscription health, flag churn risk. Portal reads in Subscriptions > Margin Monitor.

**`kitluy-order-progress-notify`** / **`kitluy-notify-customer`** — *(config-driven)*
- **Purpose:** Send Telegram notifications on status transitions if the template is enabled. Portal enables/edits templates in Settings > Notifications and Marketing > Automated Flows.

**`kitluy-due-date-calc`** — *(observed)*
- **Purpose:** Service-type turnaround + express multiplier → set `orders.due_date`. Portal configures turnaround per service in Catalog.

**Per-function contract summary (portal-relevant):**

| Function | Method/Route | Auth (min role) | Touches | Idempotent |
|---|---|---|---|---|
| `kitluy-ai-query` | POST | Owner/Manager | ai_queries, events (read) | Yes |
| `kitluy-garment-exception` | POST | Manager | garment_exceptions | No (creates row) |
| `kitluy-marketing-campaign` | POST | Owner | ai_campaigns | No |
| `kitluy-loyalty-earn` | POST (svc) | service | loyalty wallets | Yes (by op_id) |
| `kitluy-tab-settlement` | cron | service | customer_tabs, invoices | Yes (period-keyed) |
| `kitluy-order-progress-notify` | trigger | service | notification_logs | Yes (event-keyed) |

**RLS enforcement point:** Mutations enforce store scoping at the **edge-function layer** (service role re-validates `store_id` against the caller's staff membership) AND at the **DB layer** (RLS). Reads enforce at the DB layer (RLS) only.


---

## Part 8 — Business Logic & Computation Rules

### 8.1 Entity Hierarchy

The authoritative ownership chain the Seller Portal operates within:

```
Tenant (owner identity)
  └── Store  (vertical_type = laundry, immutable)
        ├── Staff (Owner / Manager / Cashier — PIN-authenticated at POS)
        ├── Catalog (services → items → variants → modifiers)
        ├── Customers (B2C + B2B accounts)
        │     ├── Preferences (auto-apply)
        │     └── Tabs (B2B pay-later)
        ├── Orders (append-only)
        │     ├── Order Items
        │     ├── Garment Details (tag, slot)
        │     ├── Garment Exceptions
        │     └── Payments (full/deposit/balance/tab)
        └── Marketing (promo codes, flows, offers, referrals, campaigns)
```

A single-store owner sits at the **Store** node. Chain context (Tenant → Brand → many Stores) is a `kitluy-chain-portal` concern; the Seller Portal manages exactly one Store.

### 8.2 Immutable Rules

Architectural, not configurable:

1. **1 Store = 1 Vertical, permanently.** Enforced by `stores.vertical_type` CHECK + DB trigger blocking UPDATE.
2. **KHR is integer-only.** No decimals anywhere. Symbol `៛`.
3. **Orders & payments are append-only.** Corrections are new rows; financial documents are never mutated.
4. **0% commission.** Revenue is SaaS only; no B1/B2/B3 splits exist in KitLuy.
5. **Loyalty contribution ≤ 3%.** `loyalty_rate_pct` CHECK 0–3.
6. **KitLuy consumes Netra/Rotanak/HSAL; never rebuilds them.**
7. **Migrations applied by BE team only.**
8. **Driver authorization via `core.users.role_type` direct lookup**, never `core.user_roles`.

### 8.3 State Machines

**Order lifecycle (laundry):**

```
created ──► paid ──► processing ──► ready ──► collected ──► completed
   │                                  ▲
   │                                  │ (garment exception re-routes here,
   │                                  │  customer status unchanged)
   └────────────────────────► cancelled
```

- **Guards:** `paid` requires a payment record (full or deposit). `collected` requires pickup + balance settled (if deposit). `cancelled` frees any reserved capacity and conveyor slot.
- **Side effects:** `completed` fires `kitluy-loyalty-earn`. `ready` fires `kitluy-order-progress-notify`. Each transition appends to `domain_events`.

**Garment exception sub-state:** `pending → in_progress → resolved`. Re-routes garment to a station; the **customer-facing order status does not change**.

**Subscription lifecycle (Phase 2):** see §8.7.

### 8.4 Money Model

| Aspect | Rule |
|---|---|
| **Storage type** | `INTEGER` KHR (e.g., `total_khr`). **No `numeric`, no cents.** KHR has no minor unit in practice. |
| **Display** | `៛60,000` — comma thousands separator, integer only. |
| **USD shadow** | Only at final totals when explicitly configured: `៛60,000 (~$15.00)`. |
| **Rounding** | All amounts are already integers; no rounding helper needed at storage. Percentage discounts round to the nearest ៛ (integer) at computation, capped by `max_cap`. |
| **Total formula** | `order.total_khr = Σ(item.qty × item.unit_price_khr) − discounts + surcharges`. Discounts: promo code (pct/fixed, capped), in-store offer (auto), loyalty coin redemption (1 coin = ៛100, ≤30% of order). |

**Loyalty math (Rotanak, consumed):**
- Stars earned = `floor(spend_khr / 1000)` (non-spendable).
- Coins earned = `floor(spend_khr × tier_rate)` where tier_rate ∈ {1%,2%,3%} by tier; Sleung Day (Wed) ×2.
- Coin value = ៛100 each. Redemption cap = 30% of order total per order.

### 8.5 Cart → Invoice → Receipt Flow

The **cart** lives at the POS, not the Seller Portal. The portal observes the materialized result:

```
1. (POS) Build cart → apply offers/promos → cart total
2. (POS) Checkout → kitluy-create-order → orders + order_items written
3. (Edge) kitluy-due-date-calc sets due_date
4. (Edge) Payment via kitluy-process-payment → order_payments
5. (Edge) Receipt rendered (80mm ESC/POS at POS)
6. (Portal) Order appears in Order Center; analytics tables update
```

The Seller Portal's role: configure the inputs (prices, offers, promos, turnaround) and read the outputs (orders, payments, analytics).

### 8.6 Inventory Deduction Rules

- **Supplies/consumables** (detergent, hangers, bags) deduct based on usage, surfaced in Supplies with low-stock alerts and reorder suggestions (Feature #13).
- **Deduction timing:** consumable deduction is modeled on processing, not on order creation (mirrors the café rule "deduct on ready, not created"). The portal shows `days_remaining = current_stock / usage_per_day`.
- **COGS:** computed from `cost_per_unit × consumed`; surfaced in margin guardrails (Part 17, KF-048) and subscription margin monitor (KF-010).

### 8.7 Subscription Lifecycle (Phase 2)

```
trial(14d) ──► active ──► grace ──► suspended ──► (reactivate → active)
```

- **Trial:** 14 days, then auto-bill.
- **Credits:** use-it-or-lose-it. **No refunds, no carry-over.**
- **Margin floor:** 5% minimum; `kitluy-subscriber-health` flags margin-negative subscribers (Margin Monitor).
- **Data retention:** subscriber data retained through suspension; reactivation restores wallet state minus expired credits.

### 8.8 Conflict Resolution

| Data class | Policy |
|---|---|
| **Operational** (inventory levels, capacity) | Last-write-wins |
| **Financial** (orders, payments, tabs) | Append-only; never mutated. Corrections = new rows. |

The Seller Portal must render financial history as immutable and surface corrections additively (e.g., a refund is a new payment row, not an edit).

### 8.9 Tax / Compliance Stub

Phase 1 tax behavior is **stubbed** (no VAT line in laundry MVP). Hook points: a future `tax_khr` column on `orders` and a tax-rule table in `kitluy.catalog`. The portal reserves a Settings > Tax surface for Phase 2+. ERPNext handles back-office accounting sync.


---

## Part 9 — Design System & UI Inventory

### 9.1 Core Tokens

| Token | Value |
|---|---|
| **Primary** | Sky Blue `#0EA5E9` |
| **Dark sidebar** | `#0F172A` |
| **Accent** (loyalty/gold) | `#F5A623` |
| **Success** | `#10B981` |
| **Danger** | `#EF4444` |
| **Warning** | `#F59E0B` |
| **Purple** (AI/Netra) | `#8B5CF6` |
| **Font** | DM Sans |
| **Card radius** | 12px |
| **Base grid** | 16px |

### 9.2 Mirror Banners

When a Seller Portal page renders **read-only data from another app's source of truth**, it carries a colored banner at the top:

| Page type | Source | Banner |
|---|---|---|
| Loyalty pages (Config, Coin Activity, tier mirror) | **Rotanak** | **Gold `#F5A623`** banner (ecosystem rule §5.3) |
| AI Insights / Explanations / Suggestions | **Netra** | **Purple `#8B5CF6`** banner |
| Delivery tracking (Phase 2) | **HSAL** | Tracking banner |

The banner signals "this data is mirrored; edit at the source." Loyalty writes happen in the Rotanak Admin Portal; AI is produced by Netra.

### 9.3 Localization & Formatting

| Aspect | Rule |
|---|---|
| **Currency** | `៛60,000` — integer, comma separator, symbol U+17DB. USD shadow only at final totals when configured. |
| **Languages** | Primary English; Secondary Khmer (ខ្មែរ, allow **40% wider** containers); Tertiary Chinese (中文). |
| **Date format** | `DD/MM/YYYY` |
| **Timezone** | `Asia/Phnom_Penh` (UTC+7), strictly enforced |
| **Locale** | `en-KH` |
| **Phone** | E.164 (`+855 12 345 678`); errors on bad format |
| **Fallback order** | en → kh → zh |

### 9.4 Terminal / Screen Patterns

The Seller Portal is a **standard web admin shell**, not a terminal UI. Pattern:

- **Layout:** dark left sidebar (`#0F172A`) with grouped navigation + top bar (search, language, profile) + main content area.
- **Components:** cards (12px radius), KPI stat tiles, data tables, badges, modals, form rows. DM Sans throughout.
- **Light mode** is the portal default. (Dark "Midnight Glass" is a HelloHR override, not KitLuy.)
- **Touch targets:** the mobile Seller App uses ≥44px targets; the web portal uses standard pointer targets.
- **Idle behavior:** the portal is a management tool; no kiosk idle/screensaver (that is a POS T2 concern).

### 9.5 Wireframe References

| Artifact | Notes |
|---|---|
| `kitluy-seller-portal-wireframe-v1.5.0.jsx` | Current design source of truth. **20 sidebar groups, 80 routes, 79 page components.** |

**Renderer constraints (Babel in artifact/Figma Make — MANDATORY or it will not render):**
- **No optional chaining** (`?.`) → use `&&` or ternary.
- **No array destructuring in `useState`** → use `var s = useState(); var x = s[0]; var setX = s[1];`.
- **No JSX attribute string concat without braces** → `<div style={{color: color}}>`.
- **File size ceiling ~270KB** to render reliably (the renderer rejects larger bundles; the live v1.5.0 was trimmed from 355KB to ~268KB to load).
- **Define `var` page components BEFORE the `ROUTES` object** (var assignments do not hoist).
- **New pages:** single-line arrow functions, 2–3 mock entries per array.

### 9.6 App-Specific Brand Overrides (Reference)

Sibling apps have distinct identities, listed for reference only (the Seller Portal uses the KitLuy default `#0EA5E9`):

| App | Override |
|---|---|
| Rotanak | Gold `#F5A623` |
| Netra | Purple `#8B5CF6` |
| (Other ecosystem apps) | Per their own bibles |


---

## Part 10 — Security Model & RBAC

### 10.1 Role Definitions

| Role | Home product | Scope (re: a single store) |
|---|---|---|
| **Platform Admin** | Admin Portal | Read-all across tenants; not a Seller Portal user |
| **Chain HQ** | Chain HQ Portal | Pushes catalog/promos to stores; read franchise royalties |
| **Owner** | **Seller Portal** | Full control of their one store |
| **Manager** | **Seller Portal + POS** | Operate store; void/refund with PIN; no staff/PIN management |
| **Cashier** | **POS only** | Process orders at register; no portal back-office access |

The Seller Portal's primary users are **Owner** and **Manager**. Cashiers do not log into the portal.

### 10.2 Permission Matrix

Capability × Role (✓ = allowed; blank = denied; "PIN" = manager-PIN-gated):

| Action | Plt Admin | Chain HQ | Owner | Manager | Cashier |
|---|---|---|---|---|---|
| View all subscribers | ✓ | | | | |
| Push catalog to stores | | ✓ | | | |
| Manage chain loyalty | | ✓ | | | |
| Edit store catalog | ✓ | ✓ (push) | ✓ | ✓ | |
| Process POS order | | | ✓ | ✓ | ✓ |
| Void / refund order | | | ✓ | ✓ PIN | |
| Manage staff / PINs | | | ✓ | | |
| Access AI advisor | ✓ | ✓ | ✓ | ✓ | |
| Launch AI campaign | ✓ (plt) | ✓ (chain) | ✓ (store) | | |
| Create promo codes | | ✓ (chain) | ✓ | ✓ | |
| View franchise royalties | ✓ | ✓ | | | |

### 10.3 PIN / Auth Model

| User type | Authentication |
|---|---|
| **Portal users** (Owner, Manager) | Full Supabase auth — **phone OTP primary** (one `auth.users.id` UUID across the ecosystem). Email/password is the exception (HSAL Driver App only; not KitLuy). |
| **POS staff** (Cashier, Manager-at-register) | 4-digit **PIN**, device-bound, with session timeout. PINs hashed with **Argon2id**. |

The Seller Portal authenticates via OTP; it does not use PINs (PINs are a POS register concern). Owners manage staff PINs from the portal, but the PIN itself is entered at the POS.

### 10.4 Sensitive Action Gating

| Action | Gate |
|---|---|
| Void / refund | Manager **PIN** + reason code (logged) |
| Minimum-order override | Manager **PIN** at POS (Feature #20) |
| Launch paid AI campaign | Explicit **owner approval** before any spend |
| Change loyalty contribution rate | Owner-only; ≤3% enforced |
| Deactivate store / change vertical | **Blocked** — vertical is immutable (DB trigger) |

### 10.5 Audit Logging

Audited to an audit table (`audit.*` / handbook audit log) and to immutable `kitluy.events.domain_events`:

| Field | Content |
|---|---|
| `actor` | User (or "System") performing the action |
| `action` | e.g., Promo Created, Complaint Response, Capacity Updated, Worker Deactivated |
| `entity` | Target (order ID, promo code, worker) |
| `detail` | Human-readable summary (before/after where relevant) |
| `timestamp` | `Asia/Phnom_Penh` |

Financial events additionally land in `domain_events` (append-only) for AI consumption and reconciliation.

### 10.6 Encryption Standards

| Layer | Standard |
|---|---|
| **At rest** | Supabase-managed Postgres encryption |
| **In transit** | TLS 1.3 (portal ↔ cloud, WSS for Realtime) |
| **Field-level** | Passwords/PINs hashed with **Argon2id**; PII minimized in `domain_events` payloads |
| **Key management** | Secrets in edge-function environment only (Part 5, §5.4); service-role key never in the portal bundle |


---

## Part 11 — Deployment & Infrastructure

### 11.1 Cloud Provisioning

| Item | Value |
|---|---|
| **Provider** | Supabase (backend) + DigitalOcean SGP1 (web static/CDN) |
| **Supabase project** | `qneduoifcsvjajeqmvgb` |
| **Region** | `ap-southeast-1` (Singapore / SGP1) |
| **Database** | PostgreSQL v17 |
| **Storage buckets** | Receipt/creative assets (Storage); RLS-scoped |
| **Runtime** | Deno (edge functions) |

### 11.2 Local Node Provisioning

**Not applicable to the Seller Portal.** The portal is a cloud web app. The Pi 5 Hub Server imaging, OS, local PostgreSQL replica, and sync engine boot are **POS concerns**. A Seller-Portal-only rebuild requires **no local nodes**. (Documented here to make the absence explicit.)

### 11.3 Terminal Pairing

**Not applicable to the Seller Portal.** No terminals pair to the portal. The portal client is a browser session authenticated by Supabase OTP. The mobile Seller App is an EAS build authenticated the same way. Terminal `register_id` assignment is a POS concern.

### 11.4 Secrets Injection

- **Portal bundle:** receives only `SUPABASE_URL` + `SUPABASE_ANON_KEY` at build time (Vite env). RLS guards everything.
- **Edge functions:** receive all privileged secrets (service role, PayWay, Telegram, Netra, Rotanak, HSAL) via Supabase function secrets — **never** in the portal.
- **Policy:** env-file for local dev; Supabase secret store for staging/prod. No secret is ever committed.

### 11.5 Certificate & Domain Management

| Item | Value |
|---|---|
| **Web domain** | Served via DigitalOcean SGP1 + CDN, TLS terminated at the edge |
| **QR/links** (ecosystem) | `https://qr.het.digital/v1/{type}/{token}` with iOS Universal Links + Android App Links (a POS/customer concern; portal references only) |
| **SSL** | Managed certificates, TLS 1.3 |

---

## Part 12 — Monitoring, Observability & Alerting

### 12.1 Health Checks

| Target | Endpoint | Frequency | Expected | Timeout |
|---|---|---|---|---|
| Edge functions | per-function health route | 1 min | 200 OK | 5s |
| Supabase Realtime | channel ping | 30s | pong | 5s |
| Portal app | static asset 200 | external uptime monitor | 200 | 10s |

### 12.2 Heartbeat Semantics

The **Hub** heartbeats to `kitluy-sync-hub` (POS concern). The Seller Portal surfaces the *consequence*: if a store's Hub stops syncing, the portal's data goes stale. The portal shows a "last synced" indicator; a missing heartbeat (Hub) means stale order data, not a portal outage.

### 12.3 Log Aggregation

| Source | Location | Retention | Searchable fields |
|---|---|---|---|
| Edge functions | Supabase function logs | Per Supabase policy | function, status, store_id, op_id |
| Domain events | `kitluy.events.domain_events` | Permanent (append-only) | event_type, store_id, created_at |
| Notifications | `kitluy.notifications.notification_logs` | Operational | template, channel, status |

### 12.4 Metrics & Dashboards

The Seller Portal's **Real-Time Cockpit** (KF-046) is itself a near-real-time metrics surface for the owner: revenue today vs. average, order queue, queue wait, campaign impact, anomaly banners. Platform-level metrics (orders/min, sync lag, payment failure rate) are visualized in the Admin Portal; the Seller Portal scopes to one store.

### 12.5 Alert Thresholds

| Condition | Threshold | Severity |
|---|---|---|
| Hub no sync | > 5 min | stale-data banner (portal) / P2 (ops) |
| Payment failure rate | elevated (Admin-monitored) | P2 |
| Supplies critical | `days_remaining ≤ 3` | in-portal critical badge + reorder CTA |
| Subscription margin | below 5% floor | Margin Monitor alert |
| Order queue wait | > target (e.g., 30 min) | cockpit warning |

### 12.6 Incident Runbooks (Lightweight)

**Hub down (store loses local sync):**
1. Portal shows stale data + "last synced" time.
2. POS continues on cloud fallback for new orders (QA-003).
3. On Hub recovery, `kitluy-sync-hub` re-merges; portal data catches up.

**Internet partition at store:**
1. Cash orders queue locally on the Hub (outbox).
2. KHQR/card unavailable (WAN-dependent).
3. Portal data frozen until reconnect; then outbox flushes (2s window, gzip).

**Payment gateway (PayWay) timeout:**
1. POS payment retries with backoff; webhook receiver reconciles on the late callback.
2. Portal finance dashboard shows pending until `payment_completed` lands.

---

## Part 13 — Backup & Disaster Recovery

### 13.1 Backup Schedule & Scope

| Asset | Frequency | Retention |
|---|---|---|
| Cloud Postgres (all `kitluy.*`) | Supabase automated backups | Per Supabase plan |
| `domain_events` | Continuous (append-only, never deleted) | Permanent |
| Hub NVMe (local replica) | POS concern | Per POS policy |

The Seller Portal stores **no local data**; its DR is entirely the cloud Postgres DR.

### 13.2 Restore Procedures

| Failure | Procedure |
|---|---|
| **Cloud DB corruption** | Restore Supabase backup; re-emit any in-flight events from Hub outboxes; portal reconnects automatically |
| **Accidental data change** | Financial docs are append-only (cannot be silently lost); operational data restored from backup |
| **Portal deploy broken** | Roll back web deploy to previous build (stateless; instant) |
| **Hub hardware failure** | Re-image Hub (POS runbook); portal unaffected beyond stale-data window |

### 13.3 RPO / RTO Targets

| Tier | RPO (max data loss) | RTO (max downtime) |
|---|---|---|
| Cloud DB (financial) | ~0 (append-only events + backups) | Restore time per Supabase |
| Portal app (stateless) | 0 (no state) | Minutes (redeploy/rollback) |
| Store sync (Hub) | ≤ one flush window (2s) of un-synced ops | Hub re-image time (POS) |

### 13.4 Degraded Modes

| Condition | Seller Portal behavior |
|---|---|
| **Hub offline** | Stale data + banner; reads last-synced state |
| **Internet offline at owner's device** | Portal unusable (online-only by design); no data loss |
| **Netra down** | AI surfaces show "no new insights"; everything else works |
| **Rotanak down** | Loyalty mirror shows last-known values; earn queued |
| **PayWay down** | Finance shows pending; reconciles on recovery |


---

## Part 14 — Standard Operating Procedures (SOPs)

Each SOP: **Trigger, Actor, Steps, Expected Result, Fallback.**

### 14.1 Provisioning SOPs

**SOP-P1 — Onboard a new store (owner self-serve via Setup Wizard)**
- **Trigger:** New owner signs up; hardware shipped; Hub auto-provisions.
- **Actor:** Owner (Seller Portal Setup Wizard).
- **Steps:** (1) Create business profile. (2) Confirm vertical = laundry (immutable). (3) Add services + item prices. (4) Set daily capacity. (5) Set operating hours. (6) Configure POS terminals + staff PINs + loyalty preference. (7) Submit → KitLuy Admin reviews → activates.
- **Expected:** Store row active; catalog + prices live; staff can PIN-login at POS.
- **Fallback:** If activation stalls, KitLuy Admin manually activates; owner re-checks wizard completeness.

**SOP-P2 — Add a staff member**
- **Trigger:** New hire.
- **Actor:** Owner (Team > Members).
- **Steps:** (1) Add member, assign role (Manager/Cashier). (2) Issue PIN. (3) Set terminal access.
- **Expected:** Member can PIN-login at POS with correct permissions.
- **Fallback:** Deactivate + reissue if PIN compromised.

### 14.2 Daily Operations (Seller-Portal-relevant)

**SOP-D1 — Morning review**
- **Trigger:** Start of day.
- **Actor:** Owner/Manager.
- **Steps:** (1) Open Dashboard / Real-Time Cockpit. (2) Check overnight orders, queue, anomaly banners. (3) Review AI Insights. (4) Check Supplies for critical stock.
- **Expected:** Owner has situational awareness; reorders flagged supplies.
- **Fallback:** If data is stale, check Hub sync status.

**SOP-D2 — Launch a promotion**
- **Trigger:** Marketing decision.
- **Actor:** Owner/Manager.
- **Steps:** (1) Marketing > Promo Codes > Create. (2) Set 11 fields (code, type, value, applies-to, min order, max cap, usage limit, per-customer, dates, eligibility, stackable). (3) Verify guardrails (no over-discount). (4) Activate.
- **Expected:** Code validates at POS (QA-009); usage tracked in Promo Analytics.
- **Fallback:** Deactivate code; guardrails block unprofitable stacking automatically.

**SOP-D3 — Handle a garment exception**
- **Trigger:** PlantOS QC flags a defect (or staff reports).
- **Actor:** Manager (Production > Garment Exceptions).
- **Steps:** (1) Review flagged garment. (2) Assign resolution (re_clean/stain_treatment/wrong_service/complaint). (3) Confirm re-route.
- **Expected:** Garment re-routed; **customer status unchanged** (QA-018); exception logged.
- **Fallback:** Escalate to owner; notify customer manually if pickup is delayed.

### 14.3 Exception Handling

| Scenario | Handling |
|---|---|
| **Hardware failure (Hub/terminal)** | Portal shows stale data; POS uses cloud fallback; re-image Hub (POS runbook) |
| **Failed payment** | Reconciles on PayWay webhook; finance shows pending then resolved |
| **Subscription grace** | Margin Monitor + `kitluy-subscriber-health` flag; owner prompted |
| **Supply stockout** | Critical badge + reorder suggestion (qty = max − current) |
| **Sync conflict** | Operational = last-write-wins; financial = append-only (no conflict possible) |

### 14.4 Recovery SOPs

| Recovery | Steps |
|---|---|
| **Restore from backup** | BE team restores Supabase backup; portal reconnects automatically (stateless) |
| **Re-image terminal** | POS runbook; portal unaffected |
| **Swap failed printer** | POS/T-printer runbook; portal unaffected |
| **Roll back portal** | Redeploy previous web build (instant, stateless) |

---

## Part 15 — QA Test Matrix & Acceptance Criteria

The full suite is 25 scenarios (KitLuy Master Handbook Part 17). Below are all 25 with **Seller-Portal relevance** marked **[SP]**. Each: ID, Name, Path, Pass Condition.

| ID | Name | Path (user actions) | Pass Condition (DB + UI) |
|---|---|---|---|
| QA-001 | POS + KHQR payment | Order → KHQR → confirm → receipt → loyalty | Order, payment, loyalty all recorded; portal Order Center shows it |
| QA-002 | Offline order | Disconnect → cash order → reconnect → sync | Order synced, no loss; portal shows after sync |
| QA-003 | Hub failover | Hub down → tablet via cloud → order → Hub re-syncs | Order processed; portal data catches up |
| QA-004 | Shift open/close | Float → 5 orders → blind count → variance → Z-report | Z-report correct; portal finance reflects shift |
| QA-005 | Garment tag + conveyor | Tag → process → slot → Telegram → pickup → rotate → freed | Slot freed on pickup; portal Live Station Map updates |
| QA-006 | Loyalty earn + redeem | ID customer → earn by tier → redeem next order | Correct Stars/Coins; **[SP]** Coin Activity log shows it |
| QA-007 | New customer at POS | Unknown phone → auto-register Silver → earn | Customer row created; **[SP]** appears in Customers |
| QA-008 | Split payment | 50K: 100 coins + 20K cash + 20K KHQR | All payment rows recorded; portal reconciliation balances |
| **QA-009** | **Promo code [SP]** | Create in Seller → enter at POS → validate → discount → track | promo_redemptions row; **Promo Analytics** usage + revenue update |
| QA-010 | Void (manager PIN) | Cashier attempts → blocked → PIN → voided → reason | Void logged with reason; **[SP]** audit log shows it |
| QA-011 | Late pickup reminder | Ready > 3d → Telegram with shop address | notification_log row; **[SP]** flow analytics increment |
| QA-012 | Chain catalog push | HQ creates product → push → appears on POS | (Chain) catalog synced |
| QA-013 | Chain local override | HQ allows → store changes price → HQ sees | (Chain) override visible |
| QA-014 | Chain loyalty cross-store | Earn at A → redeem at B → balance correct | (Chain) wallet consistent |
| QA-015 | USB scale weight | 5kg on scale → POS reads → price = 5 × per_kg | Correct weight price; **[SP]** per-kg configured in Catalog |
| QA-016 | AI Telegram bot | "How much today?" → AI responds revenue | Correct answer; **[SP]** mirrors AI advisor |
| QA-017 | Commerce → Chain upgrade | Upgrade → data intact → HQ live | Data preserved on plan change |
| **QA-018** | **Garment exception [SP]** | Flag re-clean → logged → re-routed → status unchanged | exception row; order status unchanged; **Garment Exceptions** shows it |
| **QA-019** | **Customer preferences [SP]** | Regular ID'd → prefs auto-load → badge → override | Prefs applied; **Saved Preferences** drives it |
| QA-020 | Pay-at-pickup | Drop-off no payment → ready → pickup → pay at T4 | payment_type=balance at pickup; **[SP]** Payment Options enables it |
| QA-021 | Deposit + balance | 50% deposit → receipt shows balance → pickup → remainder | deposit + balance rows; **[SP]** configured in Payment Options |
| **QA-022** | **Customer tab [SP]** | 3 orders to tab → balance = sum → cron → invoice → Telegram | tab balance correct; **B2B Accounts** shows balance + invoice |
| QA-023 | Progress notifications | Received → processing → ready, each Telegram | 3 notification rows; **[SP]** templates enabled |
| QA-024 | Min order enforcement | Below min → warning → blocked → manager PIN | Override logged; **[SP]** min value configured |
| QA-025 | Auto due date | DC → +72h auto → express → +36h → override | due_date correct; **[SP]** turnaround configured in Catalog |

**Acceptance:** all 25 pass; offline test (QA-002) passes; loyalty verified (QA-006); Z-report confirmed (QA-004). Vertical isolation: no data leakage across stores/tenants (RLS-enforced) — verified by attempting a cross-store read as a non-member (must return zero rows).


---

## Part 16 — Go-Live Checklist

Each item is verifiable. Use `[ ]`.

### 16.1 Infrastructure
- [ ] Supabase project `qneduoifcsvjajeqmvgb` (ap-southeast-1, PG17) reachable
- [ ] All `kitluy.*` migrations applied by BE team (baseline → laundry delta → security patches)
- [ ] RLS enabled and verified on every table (cross-store read returns 0 rows)
- [ ] Edge functions deployed (17 functions; portal-relevant subset live)
- [ ] Realtime channels broadcasting on store channel
- [ ] `stores.vertical_type` immutability trigger active
- [ ] Append-only guard on orders/payments active

### 16.2 Data & Config
- [ ] One tenant + one store seeded (`vertical_type='laundry'`)
- [ ] Service catalog + item prices configured
- [ ] Weight-based pricing (per-kg) set for Wash & Fold
- [ ] Daily capacity per service set
- [ ] Operating hours + holidays set
- [ ] Loyalty preference chosen (Mode A or Mode B; rate ≤3%)
- [ ] Notification templates enabled (ready, late pickup, progress)
- [ ] Seed users password = `password123` (rotate before public launch)

### 16.3 Hardware (POS — Reference, Not Portal)
- [ ] Hub imaged, UPS tested, terminals paired, printers tested, thermals validated *(POS runbook)*
- [ ] (Seller Portal requires **no** hardware)

### 16.4 People
- [ ] Owner account (phone OTP) active
- [ ] Manager account active
- [ ] Staff PINs issued (Argon2id), roles assigned
- [ ] Owner trained on Dashboard, Marketing, Customers, Finance
- [ ] SOPs printed (Part 14)

### 16.5 Validation
- [ ] All 25 QA scenarios pass
- [ ] Offline test (QA-002) passes
- [ ] Loyalty earn/redeem verified (QA-006), gold mirror banner present
- [ ] Promo code validates at POS (QA-009)
- [ ] Garment exception flow (QA-018) — customer status unchanged
- [ ] Finance dashboard reconciles a real order end-to-end
- [ ] Z-report confirmed (QA-004)

### 16.6 Pilot & Monitor
- [ ] Soft-launch hours defined
- [ ] Hub heartbeat monitoring on
- [ ] "Last synced" indicator verified in portal
- [ ] Daily reconciliation cadence scheduled
- [ ] 5+ end-to-end test orders completed and visible in portal

---

## Part 17 — Module / Feature Inventory

### 17.1 Build-by-Build Feature Table (Seller Portal)

The live wireframe (`kitluy-seller-portal-wireframe-v1.5.0.jsx`) implements **20 sidebar groups / 80 routes**. Mapping major capability areas to backend dependencies:

| Sidebar Group | Key Routes | Backend dependencies |
|---|---|---|
| **Dashboard** | dashboard | Realtime (orders), `domain_events` (read) |
| **AI Insights** | copilot, scorecard, **cockpit (KF-046)**, **explain (KF-050)** | `kitluy.ai.*`, `kitluy-ai-query`, Netra |
| **Messages** | inbox, customers, platform, team | `kitluy.notifications.*` |
| **Orders** | order center (POS view), timeline, cancellations | `kitluy.orders.*`, Realtime |
| **Customers** | list, **B2B accounts (#6/#18)**, **saved prefs (#15)** | `kitluy.customers.*`, `kitluy-tab-settlement` |
| **Catalog & Pricing** | services, item pricing (weight #5), dynamic pricing, promotions, publishing | `kitluy.catalog.*`, `kitluy-due-date-calc` |
| **Marketing** | **promo codes (13.1)**, **flows (13.2)**, **offers (13.3)**, **referrals (13.4)**, **analytics (13.5)**, **audiences (KF-041)**, **attribution (KF-042)**, **segment-to-offer (KF-045)**, **guardrails (KF-048)**, **growth (KF-049)** | `kitluy.marketing.*`, Netra (audiences/attribution) |
| **Advertising** (paid) | **experiments (KF-043)**, **content approval (KF-044)**, **creative library (KF-047)** | `kitluy.advertising.*`, `kitluy-marketing-campaign` |
| **Subscriptions** (P2) | **plans (KF-006)**, subscribers, **margin monitor (KF-010)** | `kitluy.*` subscription tables, `kitluy-subscriber-health` |
| **Plants & Production** | plants, workers, performance, QC, equipment, live station map, work orders, conveyor, **exceptions (#14)**, **QA/rewash (KF-007)** | `kitluy.orders.garment_*`, `kitluy-garment-exception` |
| **Fulfillment** | counter, collection queue, delivery (P2), issues (P2) | HSAL (P2) |
| **Finance** | dashboard, earnings, reconciliation, calculator, payouts, settlement, **payment options (#5/#16/#17/#20)** | `kitluy.orders.order_payments`, PayWay recon |
| **Loyalty** (mirror) | config, coin activity | `loyalty.*` (Rotanak), `kitluy-loyalty-*` — **gold banner** |
| **Complaints & Reviews** | inbox, reviews | `kitluy.*` reviews |
| **Capacity** | daily, demand forecast | `kitluy.*` capacity |
| **Supplies** | consumables (#13) | `kitluy.inventory.supplies_tracking` |
| **Knowledge Base** | articles, garment care | static content |
| **Integration Hub** (P2) | connectors | HSA/Canvār/HSAL connectors |
| **Team** | members, roles & permissions | `kitluy.stores.store_staff` |
| **Settings** | setup wizard, profile, hours, holidays, areas, language, webhooks, notifications, audit | `kitluy.stores.*`, `audit.*` |

### 17.2 Feature-ID System

Stable prefixes, cross-referenced to QA scenarios and edge functions:

| Prefix | Domain | Examples |
|---|---|---|
| **KF-LD-*** / KF-001–010 | Phase 1 laundry MVP | #2 garment detailing, #5 weight pricing, #6 B2B, #13 supplies, #14 exceptions, #15 prefs, #16 pay-at-pickup, #17 deposit, #18 tabs, #20 min order |
| **KF-041–050** | Phase 2 marketing/intelligence | 041 audiences, 042 attribution, 043 experiments, 044 content approval, 045 segment-to-offer, 046 cockpit, 047 creative library, 048 guardrails, 049 growth, 050 AI explain; 006 subscriptions, 007 QA/rewash, 010 margin monitor |
| **KF-CF-*** | Café (Phase 2+) | Sibling vertical |

Cross-reference: KF-009→QA-009, KF-#14→QA-018, KF-#15→QA-019, KF-#18→QA-022, KF-#5→QA-015, KF-#16→QA-020, KF-#17→QA-021, KF-#20→QA-024.

### 17.3 Mobile ↔ Web Parity Rules

`kitluy-seller-app` is a **form-factor pairing** of `kitluy-seller-portal`: **same business logic, same backend, different shell.** It is not a separate product.

- **Parity (must match):** authentication, data model, RBAC, all reads/writes through the same edge functions, KHR formatting, loyalty mirror rules.
- **Documented delta (mobile-first subset):** the mobile app prioritizes Dashboard, Real-Time Cockpit, Orders, Customers, approvals (campaign approval, void review), and AI alerts — the surfaces an owner needs on the go. Deep configuration (catalog editing, complex marketing builders) remains web-primary. Any mobile screen that diverges from web is a presentation difference only; the underlying logic is identical.


---

## Part 18 — Version History

| Version | Date | Author | Change Summary | Migrations Affected | Reconciliation Items Closed |
|---|---|---|---|---|---|
| v1.0.0 | 2026-04-10 | Het Sovannara (via Claude) | Initial Seller Portal Rebuild Bible — Parts 0–18 + Appendices A–D. Derived from KitLuy Master Handbook v1.0.1 + wireframe v1.5.0. | Baseline + laundry delta + security patches (Part 6, §6.5) | RECON-01 (schema prefix), RECON-02 (franchise scope) documented in Appendix C |

**Linked artifacts:**
- Wireframe: `kitluy-seller-portal-wireframe-v1.5.0.jsx`
- Source handbook: `KitLuy_Master_Handbook_doc_v1.0.1.docx`
- This bible: `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md`

---

## Appendix A — Data Dictionary

The 8 most rebuild-critical Seller-Portal tables, field-level.

**`kitluy.stores.stores`**
| Column | Type | Constraint | FK | Notes |
|---|---|---|---|---|
| id | UUID | PK | — | Store ID |
| tenant_id | UUID | NOT NULL | tenant | Ownership root |
| vertical_type | TEXT | NOT NULL, CHECK | — | laundry/cafe/restaurant/retail. **Immutable** (trigger). |
| loyalty_opt_in | BOOLEAN | NOT NULL | — | Mode A/B |
| loyalty_rate_pct | INTEGER | CHECK 0–3 | — | Contribution % |

**`kitluy.orders.orders`**
| Column | Type | Constraint | FK | Notes |
|---|---|---|---|---|
| id | UUID | PK | — | Generated on terminal pre-write |
| store_id | UUID | NOT NULL | stores | RLS scope |
| total_khr | INTEGER | NOT NULL, ≥0 | — | KHR integer only |
| payment_method | TEXT | NOT NULL | — | cash/khqr/aba/card/coin/split/tab/deposit |
| status | TEXT | NOT NULL | — | created/paid/processing/ready/collected/completed/cancelled |
| due_date | timestamptz | nullable | — | Set by due-date-calc |

**`kitluy.orders.garment_details`**
| Column | Type | Constraint | FK | Notes |
|---|---|---|---|---|
| tag_barcode | TEXT | UNIQUE | — | Scannable at every station |
| slot_number | INTEGER | nullable | — | Conveyor slot; freed on pickup |
| order_id | UUID | NOT NULL | orders | |

**`kitluy.orders.garment_exceptions`**
| Column | Type | Constraint | Notes |
|---|---|---|---|
| reason | TEXT | NOT NULL | re_clean/stain_treatment/wrong_service/complaint |
| status | TEXT | NOT NULL | pending/in_progress/resolved |

**`kitluy.customers.customer_preferences`**
| Column | Type | Constraint | Notes |
|---|---|---|---|
| key | TEXT | NOT NULL | care_level/packaging/instructions/pickup_method |
| customer_id | UUID | NOT NULL | FK → customers |

**`kitluy.customers.customer_tabs`**
| Column | Type | Constraint | Notes |
|---|---|---|---|
| settlement_period | TEXT | NOT NULL | weekly/biweekly/monthly |
| balance_khr | INTEGER | ≥0 | Running tab |

**`kitluy.orders.order_payments`**
| Column | Type | Constraint | Notes |
|---|---|---|---|
| payment_type | TEXT | NOT NULL | full/deposit/balance/tab |
| payment_method | TEXT | NOT NULL | cash/khqr/aba/card/coin/split/tab/deposit |
| amount_khr | INTEGER | NOT NULL ≥0 | KHR integer |

**`kitluy.marketing.promo_codes`**
| Column | Type | Constraint | Notes |
|---|---|---|---|
| code | TEXT | UNIQUE/store | Merchant or auto |
| discount_type | TEXT | NOT NULL | pct/fixed |
| max_cap_khr | INTEGER | nullable | Cap for pct |

**`kitluy.events.domain_events`** (immutable)
| Column | Type | Constraint | Notes |
|---|---|---|---|
| event_type | TEXT | NOT NULL | order_created/payment_completed/garment_checked_in/… |
| payload | JSONB | NOT NULL | Varies by type; append-only |

---

## Appendix B — FAQ (Reference, Not Rebuild-Critical)

**For Owners / Operators**
- *Q: Can I change my store from laundry to café?* A: No. Vertical is immutable. Open a separate store (Part 8, §8.2).
- *Q: How does KHQR work?* A: A dynamic QR for the exact amount appears on the POS T2 display, polling PayWay every 2s, green on success (Part 4, §4.1). The portal reconciles after.
- *Q: Do I have to use loyalty?* A: No — choose Mode A (0%, no loyalty) or Mode B (0% + 1–3% contribution). Loyalty data mirrors Rotanak (gold banner).
- *Q: Why is some data delayed?* A: Live order data flows from the Hub via sync. If the Hub is offline, the portal shows the last-synced state (Part 12, §12.2).

**For Staff**
- *Q: Do cashiers use the Seller Portal?* A: No — cashiers use the POS with a PIN. The portal is for Owner/Manager.
- *Q: How do I void an order?* A: At the POS, with a manager PIN + reason; it appears in the portal audit log (QA-010).

**For Engineers**
- *Q: Where do mutations happen?* A: Through edge functions (service role). Reads are RLS-scoped direct queries (Part 6, §6.4; Part 7).
- *Q: Why integer KHR?* A: KHR has no minor unit in practice; integers avoid float drift (Part 8, §8.4).
- *Q: Where is AI built?* A: Nowhere in KitLuy — Netra is consumed via edge functions (Part 4, §4.2).

**For Investors**
- *Q: What's the moat?* A: Netra AI + Rotanak coalition loyalty + HSAL logistics + shared identity + Pi 5 local-first — none replicable by a single-box POS (Part 2, §2.6; Appendix D).

---

## Appendix C — Reconciliation Register (Technical Debt)

**Nothing in Parts 1–18 contains an unresolved conflict. All open items live here.**

| ID | Conflict Description | Affected Parts | Recommended Resolution | Owner | Target Version |
|---|---|---|---|---|---|
| RECON-01 | Schema-prefix namespace: handbook uses `kitluy.orders.*` etc.; project architecture also references bare-domain homes `menu.*`, `orders.*`, `inventory.*`, `pos.*`. | Part 6 | Adopt one canonical prefix map; update "Master Context §3" and migrations to a single convention. Bible uses handbook `kitluy.*` as canonical pending decision. | Het / BE team | v1.1.0 |
| RECON-02 | Franchise scope: a Swarm draft deferred franchise to v2.0; Het confirmed a near-term franchise deal, so franchise is from-launch. Seller Portal is single-store, but chain context references must stay consistent. | Parts 2, 8, 17 | Update "Master Context §3" to reflect franchise-from-launch; ensure Seller↔Chain boundary is explicit. | Het | v1.1.0 |
| RECON-03 | PayWay webhook receiver + refund function + subscription billing cron are a v1.1.0 backend patch (not yet in the bootstrap). Portal finance reconciliation depends on the webhook receiver. | Parts 4, 7, 12 | Ship backend bootstrap v1.1.0 (PayWay webhook, refund fn, subscription cron). | BE team | v1.1.0 |
| RECON-04 | Weight-scale + retail barcode are genuine gaps flagged for the Retail vertical (Phase 3+), not pulled forward. Seller Portal weight pricing exists for laundry W&F only. | Parts 6, 8, 17 | Keep weight scale laundry-only; route retail barcode to Retail vertical. | Het | Phase 3+ |
| RECON-05 | AI surfaces (Insights/Suggestions/Attribution/Explain) are Phase-1-stubbed (events logged, not consumed). | Parts 4, 7, 17 | Light up in Phase 2A; Phase-1 rebuild stubs `kitluy.ai.*` reads to empty. | Het | Phase 2A |

---

## Appendix D — Investor / Stakeholder Narratives

**Clearly labeled NON-CRITICAL for reconstruction.**

**Pitch paragraph.** KitLuy is "Cambodia's Shopify" — a modular SaaS commerce + POS suite for Cambodian SMEs. The Seller Portal is the shop owner's command center: it turns a local laundry into a data-driven, loyalty-enabled, AI-advised business without the owner touching infrastructure. Unlike the one-time-fee, single-box POS boxes that dominate the market, KitLuy is a living ecosystem — a shared AI brain (Netra), a coalition loyalty network (Rotanak), and an on-demand logistics fleet (HSAL) — all consumed through one identity and powered by a local-first Pi 5 Hub that makes the register feel instant even offline.

**Problem statement.** Cambodian SMEs run on cash, paper tickets, and disconnected tools. They have no customer data, no loyalty leverage, no marketing intelligence, and no way to compete with larger, tech-enabled players. Existing POS products sell a box and walk away.

**Demo script.** (1) Log in as a laundry owner. (2) Watch a live walk-in order flow from the POS into the Dashboard. (3) Create a promo code; redeem it at the POS; see it tracked in Promo Analytics. (4) Open AI Insights — Netra recommends a Tuesday campaign with reasoning. (5) Open Loyalty (gold banner) — a Gold customer's Sleung Coins, spendable across the whole ecosystem. (6) Open Finance — reconcile the day, 0% commission, flat ៛30/month.

**Traction & ask.** Phase 1 (Laundry) live/near-live in Phnom Penh; Phase 2 (Café + Commerce features) in active design. Structural moats compound with every merchant and customer added. *(Specific traction figures and funding ask: see live deck.)*

---

*End of Document — "If every person who built the KitLuy Seller Portal disappeared tomorrow, could a single engineer rebuild it from this file? **Yes.**"*

