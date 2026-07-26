# KitLuy Admin Portal — Rebuild Bible

**File:** `kitluy-admin-portal-rebuild-bible-v1_0_0.md`
**Version:** v1.0.0
**Owner:** Het Sovannara · Founder, HET Digital Ecosystem
**Scope:** The `kitluy-admin-portal` build ONLY — the HQ platform-owner control panel for KitLuy Suite. Sibling builds (Seller Portal, Chain HQ Portal, POS Desktop/Mobile) are referenced only where the Admin Portal touches them.
**Status:** Active — Single Source of Truth for the Admin Portal
**Wireframe baseline:** `kitluy-admin-portal-wireframe-v2_4_1.jsx` (963 lines, 45 routes, 15 sidebar groups)

> **Rebuild Test:** *If every person who built the KitLuy Admin Portal disappeared tomorrow, a single engineer with zero prior context could reconstruct the entire product, its infrastructure, and its business logic from this document alone.*

---

## 0. Front Matter — Rebuild Sequence (Read This First)

The Admin Portal is a **stateless web client** that talks to a shared Supabase backend. It owns no hardware and no local node. "Rebuilding" it means standing up the web app, confirming the backend objects it reads/writes exist, and wiring the service-role edge functions it calls. The portal cannot function without the broader KitLuy backend, so steps 1–5 are backend prerequisites the Admin Portal depends on.

```
REBUILD SEQUENCE — KitLuy Admin Portal
 1. Provision backend: Supabase project qneduoifcsvjajeqmvgb (region ap-southeast-1 / SGP1),
    PostgreSQL v17. Confirm Auth (SSO) and Realtime are enabled.            → Part 11, §11.1
 2. Apply database migrations in order: baseline KitLuy schemas, then the
    kitluy.admin.* Phase-2 delta migration set.                            → Part 6, §6.5
 3. Seed baseline data: KitLuy team users (platform_owner role), plan
    catalog (Commerce, Chain), vertical enum (laundry).                    → Part 16, §16.2
 4. Deploy edge functions: 22 functions (17 core + 5 admin Phase-2).       → Part 7
 5. Configure secrets: Supabase service-role key, ABA PayWay creds,
    Telegram bot tokens, Netra API key.                                    → Part 5, §5.4
 6. Build the web app: React 18 + TypeScript + Vite + Tailwind v4.
    `npm install && npm run build`. Output static bundle.                  → Part 5, §5.3
 7. Authenticate first platform-owner user via Supabase SSO (Phone OTP).   → Part 10, §10.3
 8. Run QA validation scenarios (15 scenarios, admin-portal scope).        → Part 15
 9. Verify monitoring: edge-function health, Hub heartbeat ingest,
    domain-event throughput visible in the portal.                        → Part 12
10. Go-live smoke test: log in, view dashboard, open one subscriber,
    confirm read-only Rotanak mirror renders, confirm a safety switch
    toggles.                                                               → Part 16, §16.5
```

There is **no local hardware step** for the Admin Portal (contrast: the POS builds require Pi imaging). There is **no terminal-pairing step**. The portal is delivered as a static SPA served from DigitalOcean SGP1 (or any static host) and authenticates against Supabase.

---

## Part 1 — Glossary

Every term used in Parts 2–18 is defined here first. Terms with conflicting definitions across documents are flagged **⚠️ RECONCILE** and tracked in Appendix C.

### 1.1 Platform Terms

| Term | Definition |
|---|---|
| **HET Digital Ecosystem** | The umbrella of 22 apps/systems built for the Cambodian market. KitLuy is App #10. |
| **KitLuy Suite** | "Cambodia's Shopify." A modular, multi-vertical SaaS commerce + POS ecosystem for Cambodian SMEs. The Admin Portal is one of its six canonical products. |
| **Admin Portal** | This product. The HQ god-view web console operated by KitLuy/HET staff to manage all subscribers, stores, devices, billing, and platform operations. Internal-only. |
| **Platform Owner** | The top-level role. Het and the KitLuy HQ team. Full access to the Admin Portal. |
| **Subscriber** | A business (tenant) that pays for KitLuy Suite. Has one or more stores. Identified by `SUB-###`. The unit of billing. |
| **Tenant** | Synonym for Subscriber at the database/RLS layer. One tenant = one subscriber organization. |
| **Store** | A physical location belonging to a subscriber. Identified by `ST-###`. Bound to exactly one vertical. |
| **Vertical** | An industry configuration bundle (Laundry, Café, Restaurant, Retail). Phase 1 ships **Laundry only**. A store is permanently bound to one vertical. |
| **Mode** | A subscriber's integration posture: **A** = standalone (0% commission), **B** = standalone + Rotanak loyalty opt-in, **C** = full HSA marketplace integration (25% commission, Phase 2). |

### 1.2 Product Terms (KitLuy six canonical products)

| Term | Definition |
|---|---|
| **kitluy-admin-portal** | This product. Platform-owner HQ web console. |
| **kitluy-chain-portal** | Web. Brand/franchise owner's multi-store HQ console. Not this build. |
| **kitluy-seller-portal** | Web. Individual shop owner's backend. Not this build. |
| **kitluy-seller-app** | Mobile form-factor of the seller portal. Not this build. |
| **kitluy-pos-desktop-app** | Electron app on Raspberry Pi 5, store staff. Not this build. |
| **kitluy-pos-mobile-app** | Mobile form-factor of the POS desktop. Not this build. |
| **Form-factor pairing** | Two products that share identical business logic but differ only in shell (e.g., seller-portal ↔ seller-app). |

### 1.3 Commerce Terms

| Term | Definition |
|---|---|
| **Commerce Plan** | SaaS tier for single/independent stores. ៛30/store/month. Modes A or B. |
| **Chain Plan** | SaaS tier for multi-store chains and franchise networks. ៛100/month HQ fee + ៛50/store/month. Modes B or C. |
| **Franchise** | A business relationship within a Chain subscriber (franchisor → franchisee). Not a separate plan or subscriber type — it is a **feature of the Chain plan**. ⚠️ RECONCILE (early wireframes treated "franchise" as a subscriber type; canonical model: Commerce/Chain only). |
| **0% Commission** | KitLuy takes no cut of subscriber order revenue. Revenue is SaaS subscription only. (Exception: Mode C HSA integration applies HSA's 25%, but that is HSA's economics, not KitLuy's.) |
| **MRR / ARR** | Monthly / Annual Recurring Revenue. The platform-owner's core revenue metric. |
| **NRR** | Net Revenue Retention. Expansion minus contraction/churn, as a % of prior MRR. |
| **ARPU** | Average Revenue Per Subscriber (MRR ÷ active subscribers). |
| **Churn Risk** | A 0–100% score per subscriber estimating likelihood of cancellation. Consumed from Netra. |
| **Health Score** | A 0–100 composite per subscriber (order volume, activation, engagement). Consumed from Netra / computed by `kitluy-subscriber-health-v2`. |
| **GMV** | Gross Merchandise Value. Total order value flowing through a subscriber's stores. KHR integer. |
| **14-day trial** | Every new subscriber gets 14 days free, then auto-bills. Locked decision. |

### 1.4 Hardware Terms (referenced; not owned by Admin Portal)

| Term | Definition |
|---|---|
| **Hub** | A Raspberry Pi 5 (8GB + NVMe), headless, one per store. Runs a slim local PostgreSQL + PostgREST and is the store's offline-first sync backbone. The Admin Portal **monitors** Hubs (heartbeat, firmware, status) but does not run on one. |
| **Terminal** | A Pi 5 (4GB) POS device (T1-POS register, T2 customer display, T3-KDS, T4 dispatcher/conveyor, T5 queue monitor). The Admin Portal monitors terminals via the Device Registry and Fleet console. |
| **Device Registry** | The Admin Portal's lifecycle ledger of every Hub and Terminal: serial, store assignment, warranty, firmware, RMA status. |
| **Firmware** | The POS software image version on a device (current target: v2.1.4). The Admin Portal tracks fleet-wide firmware compliance. |
| **OTA** | Over-the-air. Remote firmware/config push to devices, triggered from the Fleet console. |
| **RMA** | Return Merchandise Authorization. A device flagged for repair/replacement. |

### 1.5 Third-Party / Sibling Terms

| Term | Definition |
|---|---|
| **Supabase** | Backend platform: PostgreSQL v17, Auth, Edge Functions (Deno), Realtime, Storage. The Admin Portal's sole backend. |
| **ABA PayWay** | Cambodian payment gateway (KHQR, card, pre-auth). The Admin Portal monitors PayWay health and subscriber billing; it does not process consumer payments directly. |
| **Netra** | The ecosystem's shared AI brain. KitLuy **consumes** Netra for health-risk scoring, churn propensity, and anomaly detection via API. Read-only to the Admin Portal. |
| **Rotanak** | The ecosystem's shared coalition loyalty platform. **WRITE authority** for all loyalty rules (tiers, coins, stars). The Admin Portal shows a **read-only mirror** of loyalty data. |
| **HSAL** | The ecosystem's shared logistics/driver-dispatch platform. KitLuy consumes HSAL for delivery; the Admin Portal shows a read-only logistics feed. |
| **HSA** | The laundry marketplace app. Mode C subscribers integrate with HSA (Phase 2). The Admin Portal shows HSA integration status per subscriber. |
| **PlantOS** | Plant/production operations app (T1–T6 stations). The Admin Portal shows aggregate production-pipeline status. |
| **Telegram Bot** | Per-subscriber customer-notification bot (pickup ready, order status). The Admin Portal monitors bot webhook status per subscriber. |
| **Shared Identity** | One `auth.users.id` UUID per person across all ecosystem apps, via the single Supabase project. |

### 1.6 Feature-Index Terms

| Term | Definition |
|---|---|
| **KF-###** | KitLuy Feature ID. `KF-001`–`KF-010` are Phase-1 MVP laundry features. `KF-061`–`KF-070` are the Phase-2 Admin Portal feature set (CRM, onboarding, fleet ops, etc.). |
| **Domain Event** | An immutable, append-only record of a meaningful state change (order_created, hub_sync_completed, etc.). The AI data foundation. The Admin Portal monitors event throughput. |
| **Read-Only Mirror** | An Admin Portal page that displays data owned/written by a sibling platform (Rotanak loyalty, Netra intelligence). Marked with a colored banner. Never writes. |
| **Safety Switch** | A platform-wide emergency control (maintenance mode, sync pause, billing pause) toggled from the Admin Portal. |

---

## Part 2 — Business Overview

### 2.1 What It Is

The KitLuy Admin Portal is the **internal HQ control plane** for KitLuy Suite — "the Shopify Admin for Cambodia's Shopify." It is the single console where the platform owner (Het + HET staff) manages every paying subscriber, every store, every POS device, all SaaS billing, support, merchant acquisition, and platform health across the entire KitLuy network. If KitLuy Suite is the product sold to laundromats and cafés, the Admin Portal is the cockpit from which the business that sells it is run.

### 2.2 What It Is Not

- **It is NOT the Seller Portal.** Merchants never log into the Admin Portal. Store owners manage their own catalog, staff, and pricing in `kitluy-seller-portal`. The Admin Portal is HQ-only.
- **It is NOT a POS.** No orders are taken here. Order data is **monitored in aggregate** (throughput, GMV), never created.
- **It is NOT the loyalty engine.** Loyalty rules are written in the Rotanak Admin Portal. KitLuy Admin shows a read-only mirror.
- **It is NOT a marketplace admin.** KitLuy is 0% commission SaaS. There is no escrow, no commission split, no B1/B2/B3 buckets in KitLuy's own economics (those are HSA-only constructs).
- **It is NOT multi-tenant-scoped.** Unlike the Seller Portal (which sees one tenant), the Admin Portal is a **god-view** across all tenants. RLS is enforced by the `platform_owner` role, not by `tenant_id`.

### 2.3 Verticals / Modules

The Admin Portal is **vertical-aware but not vertical-specific**. It manages stores across all verticals, displaying each store's bound vertical. Phase 1 ships Laundry only.

| Vertical | Phase | Admin Portal impact |
|---|---|---|
| **Laundry** | Phase 1 (live) | Full support. Service catalog (Wash & Fold, Dry Clean, etc.), PlantOS T1–T6 production pipeline, HSAL delivery feed. |
| **Café** | Phase 2 | Onboarding template exists (draft). Five-terminal architecture. |
| **Restaurant** | Phase 3+ | Onboarding template stub. |
| **Retail** | Phase 3+ | Onboarding template stub. Weight-scale + barcode gaps flagged. |

The Admin Portal enforces **1 store = 1 vertical** at the display/validation layer; the database enforces it via an immutable enum + trigger (Part 6, §6.2; Part 8, §8.2).

### 2.4 Product / Build Inventory (Admin Portal context)

The Admin Portal is one of six KitLuy products. This bible covers only the first row.

| # | Build | Audience | Form factor | Scope |
|---|---|---|---|---|
| 1 | **kitluy-admin-portal** | HET HQ staff | Web (desktop) | God-view: all subscribers, stores, devices, billing, support, CRM, ops. **THIS BUILD.** |
| 2 | kitluy-chain-portal | Brand/franchise owners | Web | One chain's multi-store HQ. |
| 3 | kitluy-seller-portal | Shop owners | Web | One store/chain backend. |
| 4 | kitluy-seller-app | Shop owners | Mobile | Form-factor pairing of #3. |
| 5 | kitluy-pos-desktop-app | Store staff | Electron / Pi 5 | In-store POS. |
| 6 | kitluy-pos-mobile-app | Store staff | Mobile | Form-factor pairing of #5. |

### 2.5 Business Model

The Admin Portal exists to operate this model; the model itself is the data the portal manages.

| Dimension | Rule |
|---|---|
| **Revenue type** | SaaS subscription only. **0% order commission.** |
| **Commerce plan** | ៛30 / store / month. |
| **Chain plan** | ៛100 / month HQ fee + ៛50 / store / month. |
| **Trial** | 14-day free trial, then auto-bill. (Locked.) |
| **Billing rhythm** | Monthly, via `subscriber-billing-cron`. Invoices generated per subscriber. |
| **Transaction fees** | Small per-order processing fee tracked on invoices (pass-through of payment-gateway cost). |
| **Hardware economics** | Pi 5 Hubs + terminals are sold/leased to subscribers. Spares stocked centrally by Het's team (locked decision). Tracked in Device Registry. |
| **Currency** | KHR (៛), **integer only**, no decimals. |

### 2.6 Moat / Defensibility

The Admin Portal surfaces the metrics that prove the moat, but the moat itself is structural:

1. **Local-first Pi 5 Hub architecture** — sub-millisecond local POS performance that cloud-only competitors (one-time-fee box products like POS-PRO) cannot match. The Admin Portal monitors Hub fleet health as a competitive differentiator.
2. **Ecosystem leverage** — KitLuy consumes Netra (AI), Rotanak (coalition loyalty), HSAL (logistics), and shared identity. A single-box competitor cannot replicate a coalition loyalty network or a shared AI brain.
3. **Coalition loyalty** — Rotanak coins are earned/spent across every ecosystem merchant, creating cross-merchant network effects no standalone POS can offer.
4. **Khmer-first localization** — KHR integer money, Khmer Unicode, Asia/Phnom_Penh, E.164 phones, Telegram-native (not email-native) customer comms.
5. **SaaS recurring revenue + 0% commission** — aligns KitLuy with merchant success and undercuts commission-based marketplaces.

### 2.7 Ecosystem Position — Owned vs. Consumed

This is the **single most important architectural principle** for the Admin Portal: **KitLuy consumes; it does not rebuild.**

| Capability | Owned by | Admin Portal relationship |
|---|---|---|
| **Subscriber / store / billing / device data** | **KitLuy (owned)** | Full read/write. Schemas: `kitluy.*`, `kitluy.admin.*`. |
| **Order / POS data** | KitLuy (owned, written by POS) | Read aggregate only (throughput, GMV). |
| **Identity** | Shared (one Supabase `auth.users.id`) | Reads. Does not own the identity table. |
| **Loyalty (stars, coins, tiers)** | **Rotanak (consumed)** | **Read-only mirror.** Gold-banner pages. Never writes. |
| **AI (health, churn, anomaly)** | **Netra (consumed)** | Reads via Netra API. Purple-banner intelligence. |
| **Logistics (delivery)** | **HSAL (consumed)** | Read-only logistics feed. |
| **Marketplace (Mode C)** | **HSA (consumed)** | Shows integration status; HSA owns the 25% economics. |
| **Payments** | **ABA PayWay (consumed)** | Monitors health; PayWay processes funds. |

---

## Part 3 — System Architecture & Topology

### 3.1 Topology Diagram

The Admin Portal is a browser SPA. It has exactly one backend dependency (Supabase) and several sibling services it reads through that backend or via API. It touches **no LAN**, **no Hub**, **no terminal** directly — those are monitored through data the backend aggregates.

```
                              ┌──────────────────────────────────────┐
                              │   PLATFORM OWNER (HET HQ staff)       │
                              │   Browser — desktop                   │
                              └───────────────────┬──────────────────┘
                                                  │ HTTPS (WAN)
                                                  │ Supabase JS client + SSO session
                              ┌───────────────────▼──────────────────┐
                              │   kitluy-admin-portal (React SPA)     │
                              │   Static bundle on DigitalOcean SGP1  │
                              └───────────────────┬──────────────────┘
                                                  │ HTTPS / WSS (WAN)
            ┌─────────────────────────────────────┼─────────────────────────────────────┐
            │                                      │                                     │
   ┌────────▼─────────┐              ┌─────────────▼────────────┐            ┌───────────▼──────────┐
   │ Supabase Auth    │              │ Supabase Edge Functions  │            │ Supabase Realtime    │
   │ (SSO, Phone OTP) │              │ (Deno, 22 functions,     │            │ (live dashboards,    │
   │                  │              │  service-role)           │            │  heartbeats, events) │
   └──────────────────┘              └─────────────┬────────────┘            └──────────────────────┘
                                                   │ service-role
                                     ┌─────────────▼────────────┐
                                     │ Supabase PostgreSQL v17   │
                                     │ project qneduoifcsvjajeqmvgb
                                     │ region ap-southeast-1     │
                                     │ Schemas:                  │
                                     │  kitluy.* (owned)         │
                                     │  kitluy.admin.* (owned)   │
                                     │  commerce.* pos.* (read)  │
                                     │  auth.* core.* (shared)   │
                                     │  loyalty.* (Rotanak,read) │
                                     └─────────────┬────────────┘
                                                   │
        ┌──────────────────────────────┬──────────┼───────────────┬──────────────────────────┐
        │ (consumed via API/data)       │                          │                          │
 ┌──────▼───────┐  ┌──────────▼──────┐  ┌──────────▼──────┐  ┌──────▼─────────┐  ┌─────────────▼──┐
 │ Netra (AI)   │  │ Rotanak         │  │ HSAL            │  │ HSA            │  │ ABA PayWay     │
 │ health/churn │  │ (loyalty WRITE) │  │ (logistics)     │  │ (Mode C mkt.)  │  │ (payments)     │
 │ READ         │  │ READ mirror     │  │ READ feed       │  │ status read    │  │ health monitor │
 └──────────────┘  └─────────────────┘  └─────────────────┘  └────────────────┘  └────────────────┘

  ── Monitored, NOT directly connected ────────────────────────────────────────────────────────
 ┌────────────────────────────────────────────────────────────────────────────────────────────┐
 │  Store Hubs (Pi 5) + Terminals — heartbeat via kitluy-device-heartbeat-ingest → PostgreSQL  │
 │  Admin Portal reads device state from kitluy.admin.device_registry / device_health_metrics  │
 └────────────────────────────────────────────────────────────────────────────────────────────┘

LAN/WAN boundary: The Admin Portal is 100% WAN. All store-local LAN (Hub ↔ terminals)
is invisible to it except as heartbeat data that has already been pushed to the cloud.
```

### 3.2 Data Flow Maps

The Admin Portal is read-heavy. Its few writes are platform-control actions (toggle safety switch, start onboarding, push device action, create lead). Below are the critical transactions.

**Flow A — Load Platform Dashboard (read aggregate):**
```
1. Browser → Admin Portal SPA: user lands on /dashboard
2. SPA → Supabase: authenticated query (service-role via edge fn or RLS platform_owner)
   for aggregate metrics (MRR, active subscribers, store counts, hub health)
3. Supabase PostgreSQL: returns aggregates from kitluy.* + kitluy.admin.*
4. SPA → Supabase Realtime: subscribe to live channels (open tickets, hub heartbeats)
5. Realtime → SPA: pushes deltas; KPI cards update without reload
6. SPA renders Platform Overview (Part 17 feature DASH-01)
```

**Flow B — Remote Device Action (write, KF-063):**
```
1. Operator → SPA: Fleet Ops > Console > selects device DEV-005 > "Remote Restart"
2. SPA → edge fn kitluy-device-heartbeat-ingest's companion action endpoint
   (POST device action) with idempotency-key
3. Edge fn (service-role) → PostgreSQL: INSERT kitluy.admin.device_actions
   (device_id, action='restart', actor, status='queued')
4. Edge fn → device action queue → Hub picks up on next heartbeat poll
5. Hub executes, reports result on next heartbeat
6. kitluy-device-heartbeat-ingest UPDATE device_actions.status='completed' + result
7. Realtime → SPA: action log row updates to "completed"
8. Evidence captured in kitluy.admin.support_interventions (KF-070)
```

**Flow C — Start Subscriber Onboarding (write, KF-062):**
```
1. Operator → SPA: Onboarding > Workspace > "Provision new subscriber"
2. SPA → edge fn kitluy-onboarding-provision (POST) with subscriber + plan + vertical
3. Edge fn (service-role) → PostgreSQL:
   - INSERT kitluy.subscribers (status='onboarding', trial_ends_at = now()+14d)
   - INSERT kitluy.admin.onboarding_workspaces (steps checklist)
   - INSERT kitluy.admin.activation_checkpoints (all false)
4. Edge fn → broadcasts domain event subscriber.created
5. Realtime → SPA: onboarding pipeline shows new workspace at 0%
```

**Flow D — Subscriber Billing (cron, observed by Admin):**
```
1. subscriber-billing-cron fires monthly (00:00 Asia/Phnom_Penh, 1st of month)
2. Cron → PostgreSQL: for each active subscriber past trial,
   compute SaaS fee (Commerce: 30×stores; Chain: 100 + 50×stores) + tx fees
3. Cron → INSERT kitluy.invoices (status='pending')
4. Cron → ABA PayWay: auto-charge stored payment method
5. PayWay webhook → payway-purchase → UPDATE invoice.status='paid'
6. Admin Portal Invoices page reflects new invoices (read)
```

### 3.3 Offline-First Protocol

**The Admin Portal is online-only.** It has no offline mode, no local store, no service worker cache of business data. If the operator's WAN is down, the portal shows a connection error. This is intentional: HQ staff operate from an office with reliable internet, and god-view data must always be fresh.

The **offline-first protocol belongs to the POS/Hub builds**, not the Admin Portal. The Admin Portal only *observes the results* of that protocol:
- It reads `kitluy.admin.device_health_metrics.offline_queue_depth` to show how many operations a Hub has buffered while disconnected.
- It reads `hub_sync_completed` domain events to show sync recency.
- Idempotency keys (`op_id`), CDC columns, and the outbox/inbox pattern are POS/Hub concerns (documented in the POS bible, not here). The Admin Portal never generates `op_id`s.

### 3.4 Hardware Placement (per vertical)

**The Admin Portal runs on no dedicated hardware.** It is a static bundle served over HTTPS and rendered in HQ staff browsers. There is no Pi, no enclosure, no thermal spec, no UPS for the Admin Portal itself.

For **reference** (the hardware the Admin Portal *monitors*), Phase-1 Laundry store hardware is:

| Device | Model | Role | Notes |
|---|---|---|---|
| Hub | Pi 5 8GB + NVMe | Sync backbone, local DB | Mesh aluminium case, copper heatsink, 3007 PWM blower, 35°C+ rated (Cambodia climate). Headless. |
| T1-POS | Pi 5 4GB + microSD, dual HDMI | Register + T2 customer display | |
| T3-KDS | Pi 5 4GB | Kitchen/production display | |
| T4-DISP | Pi 5 4GB + conveyor controller | Dispatcher (laundry conveyor) | |
| T5-QDS | Pi 5 4GB | Queue monitor | Optional |

The Admin Portal's Device Registry (Part 17, FLEET-04) records each unit's serial, store, warranty, firmware, and RMA status. It does not provision or image them — that is an onboarding SOP performed by Het's team (Part 14).

### 3.5 Environment Promotion

| Stage | Purpose | How the Admin Portal moves |
|---|---|---|
| **Dev** | Local development. | `npm run dev` (Vite dev server) against a Supabase dev branch/project. Mock data permitted. |
| **Staging** | Pre-prod validation. | Static build deployed to a staging host, pointed at a staging Supabase project. QA scenarios (Part 15) run here. |
| **Prod** | Live HQ console. | Static build deployed to DigitalOcean SGP1, pointed at `qneduoifcsvjajeqmvgb`. |

- **Migrations** move via the Supabase migration files in sequence (Part 6, §6.5), applied by the **BE team only** (Claude/engineers write them, never auto-apply).
- **Secrets** move via the host's environment configuration (Part 5, §5.4) — never committed.
- **Builds** move as immutable static artifacts (versioned by the wireframe/app semver).

---
## Part 4 — External Contracts & Integrations

The Admin Portal integrates with sibling services in two ways: (a) **reads data the backend already holds** (loyalty mirror, logistics feed, device heartbeats), and (b) **calls service APIs** (Netra for AI scores, PayWay status). It never holds consumer-payment credentials and never writes to sibling-owned tables.

### 4.1 ABA PayWay (Payments — monitored)

**4.1.1 Purpose.** The Admin Portal monitors PayWay health and reflects subscriber billing outcomes. PayWay itself lives in **cloud edge functions** (not the Pi Hub) because it requires secret credentials, a public webhook URL, and subscription auto-billing. The Admin Portal never calls PayWay's purchase API directly — it observes the results.

**4.1.2 Authentication.** PayWay credentials (merchant ID, API key, RSA keys for KHQR) live as Supabase secrets consumed by the `payway-purchase` and `subscriber-billing-cron` edge functions. The Admin Portal holds **none** of these.

**4.1.3 Request / Response Contracts (observed).** The Admin Portal reads the outcome of billing in `kitluy.invoices`:
```
invoice { id, subscriber_id, plan, store_count, saas_amount, tx_fees,
          total, status (pending|paid|failed), period, paid_date }
```
The Infrastructure page reads a PayWay health signal (up/down) surfaced by a health-check probe.

**4.1.4 Error Handling & Retry.** Billing retries are owned by `subscriber-billing-cron` (Part 7). On charge failure, the invoice stays `pending` and the subscriber enters the grace path (Part 8, §8.7). The Admin Portal surfaces `pending`/`failed` invoices as action items but performs no retry itself.

**4.1.5 Webhook Events.** `payway-purchase` receives PayWay's payment webhook (signature-verified). The Admin Portal does not receive webhooks; it reads the post-webhook DB state.

**4.1.6 Sandbox vs. Production.** PayWay sandbox uses test merchant credentials and a sandbox base URL; production uses live credentials. The Admin Portal points at whichever Supabase project (staging/prod) holds the corresponding invoice data. [REQUIRED: exact PayWay sandbox + prod base URLs, held by BE team in secrets store.]

### 4.2 Netra (AI — consumed, read-only)

**4.2.1 Purpose.** KitLuy consumes Netra for **subscriber health scoring, churn propensity, and anomaly detection**. The Admin Portal displays these on the Health & Rescue page, the dashboard health distribution, and the AI Subscriber Insights page. Netra is the *brain*; KitLuy never recomputes these models.

**4.2.2 Authentication.** A Netra API key (Supabase secret) is used by the `kitluy-subscriber-health-v2` and `ai-subscriber-insights` edge functions, which call Netra and cache results in `kitluy.admin.subscriber_health_scores`. The Admin Portal reads the cache, not Netra directly.

**4.2.3 Request / Response Contracts.**
```
// kitluy-subscriber-health-v2 → Netra (conceptual)
Request:  { subscriber_id, signals: { orders_30d, activation_pct,
            last_activity, shift_variance, hub_uptime } }
Response: { health_score: 0-100, churn_risk: 0-100,
            drivers: [string], suggested_actions: [string] }
```
Cached row read by Admin Portal:
```
subscriber_health_scores { subscriber_id, health_score, churn_risk,
                           health_band (excellent|good|at_risk|new),
                           drivers jsonb, computed_at }
```

**4.2.4 Error Handling & Retry.** If Netra is unreachable, the health edge function returns the last cached score and flags staleness. The Admin Portal shows the cached value with `computed_at`. No blocking. [REQUIRED: Netra timeout + backoff values.]

**4.2.5 Webhook Events.** None. Netra is pull-based via daily cron (`06:00 Asia/Phnom_Penh`).

**4.2.6 Sandbox vs. Production.** [REQUIRED: Netra environment endpoints.]

### 4.3 Rotanak (Loyalty — consumed, read-only mirror)

**4.3.1 Purpose.** Rotanak is the **write authority** for all loyalty (Angkorian Stars, Sleung Coins, 5 tiers). The Admin Portal shows a **read-only mirror**: tier config, which subscribers opted in (Mode B/C), and ecosystem coin activity. **All loyalty changes happen in the Rotanak Admin Portal**, never here.

**4.3.2 Authentication.** Loyalty data lives in the shared `loyalty.*` schema (owned by Rotanak) in the same Supabase project. The Admin Portal reads it with the `platform_owner` role under read-only RLS.

**4.3.3 Request / Response Contracts (read).**
```
loyalty tier (read):  { tier_name, min_stars, max_stars, coin_earn_rate }
loyalty opt-in (read): subscriber.loyalty_opt (bool) + mode (A|B|C)
coin activity (read): derived from loyalty_earned / loyalty_redeemed domain events
```

**4.3.4 Error Handling.** Read-only; on failure the mirror shows "data unavailable." Never blocks platform operations.

**4.3.5 Webhook Events.** None consumed. Activity is read from domain events (`loyalty_earned`, `loyalty_redeemed`).

**4.3.6 Sandbox vs. Production.** Same Supabase project; environment follows the portal's target.

**Mirror rule:** Every Rotanak-sourced page carries a **gold banner** (`#F5A623`) reading "READ-ONLY — Source: Rotanak Admin Portal" (Part 9, §9.2).

### 4.4 HSAL (Logistics — consumed, read-only feed)

**4.4.1 Purpose.** The Admin Portal shows an aggregate delivery feed (deliveries today, on-time rate, avg time, failures). Individual delivery tracking lives in the HSAL Admin Portal.

**4.4.2 Authentication.** Reads from logistics data the backend already holds (delivery domain events). No direct HSAL credentials in the Admin Portal.

**4.4.3 Contracts.** Aggregate counters only: `{ deliveries_today, on_time_pct, avg_minutes, failed_today }`. Delivery fee is fixed ៛10,000/booking (PU ៛5K + DL ៛5K), 100% to HSAL.

**4.4.4–4.4.6.** Read-only; degrades to "feed unavailable"; no webhooks; environment follows the portal.

### 4.5 HSA (Marketplace — Mode C, status only)

**4.5.1 Purpose.** Mode C subscribers (Phase 2) integrate with the HSA laundry marketplace (25% commission, escrow, capacity pool). The Admin Portal shows **integration status** per subscriber (connected / not connected) — it does not manage HSA economics.

**4.5.2–4.5.6.** Status read only. The 25% commission, escrow enums, and order lifecycle are **HSA-owned** and documented in the HSA bible, not here.

### 4.6 Telegram Bot (Messaging — monitored)

**4.6.1 Purpose.** Each subscriber store runs a Telegram bot for customer notifications (pickup ready). The Admin Portal monitors **webhook status** per subscriber (active / not configured) and flags subscribers missing a bot.

**4.6.2 Authentication.** Per-store bot tokens are Supabase secrets used by `telegram-bot-notify`. The Admin Portal reads only the boolean status.

**4.6.3–4.6.6.** Status read; `telegram-bot-notify` owns send logic; webhook config is an onboarding task (Part 14).

### 4.7 Supabase (Backend — the platform itself)

Not a "third party" so much as the substrate. Auth (SSO/OTP), PostgreSQL, Edge Functions (Deno), Realtime, Storage. All Admin Portal data flows through it. Full detail in Parts 6, 7, 11.

---

## Part 5 — Tech Stack & Repository Structure

### 5.1 Stack by Layer

| Layer | Technology |
|---|---|
| **Frontend framework** | React 18 + TypeScript |
| **Build tool** | Vite |
| **Styling** | Tailwind CSS v4 |
| **State** | React hooks (`useState`, `useReducer`); Zustand permitted for cross-cutting state |
| **Fonts** | DM Sans (primary UI) |
| **Backend** | Supabase: PostgreSQL v17, Auth, Edge Functions (Deno/TypeScript), Realtime, Storage |
| **Payments (observed)** | ABA PayWay (cloud edge layer) |
| **AI (consumed)** | Netra (API) |
| **Hosting** | DigitalOcean SGP1 (static SPA) |
| **Maps** | Google Maps API (store coverage map) |
| **CI/CD** | [REQUIRED: pipeline tool — GitHub Actions assumed] |

The Admin Portal is a **clone of the HSA Admin Portal** — same component library (`Badge`, `Cd`, `KPI`, `Hdr`, `Btn`, `TH`, `TD`, `Sidebar`, `Topbar`, `HealthBar`), same design tokens, same patterns. Only the data context and module content differ.

### 5.2 Repository Layout

```
kitluy-admin-portal/
├── src/
│   ├── components/        # Shared: Badge, Cd, KPI, Hdr, Btn, TH, TD, HealthBar, Sidebar, Topbar
│   ├── pages/             # One module per sidebar group (Dashboard, Subscribers, CRM, ...)
│   ├── lib/
│   │   ├── supabase.ts    # Supabase client init (URL + anon key from env)
│   │   ├── theme.ts       # Light/dark CSS-variable maps (TV function)
│   │   └── format.ts      # KHR/USD/pct formatters
│   ├── hooks/             # useRealtime, useSubscribers, etc.
│   └── App.tsx            # Router + auth gate + theme provider
├── public/
├── .env.example          # Names only, never values (Part 5.4)
├── vite.config.ts
├── tailwind.config.ts
├── package.json
└── README.md

# Backend objects this app depends on live in the shared KitLuy backend repo:
supabase/
├── migrations/           # Sequenced SQL (Part 6.5). BE team applies; never auto-apply.
└── functions/            # 22 edge functions (Part 7)
```

The wireframe artifact (`kitluy-admin-portal-wireframe-v2_4_1.jsx`) is a **single-file design reference**, not the production source tree. Production splits it into the structure above.

### 5.3 Build & Deploy Pipeline

| Artifact | Build | Deploy |
|---|---|---|
| Admin Portal SPA | `npm install` → `npm run build` (Vite) → static `dist/` | Upload `dist/` to DigitalOcean SGP1 static host / CDN |
| Edge functions | `supabase functions deploy <name>` (Deno) | Supabase (per project) |
| Migrations | Written by engineers | `supabase db push` by **BE team only** |

No Electron, no EAS, no Docker for the Admin Portal — it is a static web bundle.

### 5.4 Secrets Inventory (names only — never values)

| Secret / Env Var | Purpose | Consumed by | Rotation |
|---|---|---|---|
| `SUPABASE_URL` | Backend endpoint | Admin Portal SPA | On project change |
| `SUPABASE_ANON_KEY` | Public client key (RLS-gated) | Admin Portal SPA | On compromise |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged DB access | Edge functions only (**never the SPA**) | Quarterly |
| `ABA_PAYWAY_MERCHANT_ID` | PayWay merchant identity | `payway-purchase`, `subscriber-billing-cron` | On vendor change |
| `ABA_PAYWAY_API_KEY` | PayWay auth | Same | Quarterly |
| `ABA_PAYWAY_RSA_PRIVATE` | KHQR signing | Same | Per vendor policy |
| `NETRA_API_KEY` | AI scoring access | `kitluy-subscriber-health-v2`, `ai-subscriber-insights` | Quarterly |
| `TELEGRAM_BOT_TOKEN_<store>` | Per-store bot send | `telegram-bot-notify` | Per store onboarding |
| `GOOGLE_MAPS_API_KEY` | Store coverage map | Admin Portal SPA (referer-restricted) | On compromise |

**Rule:** The SPA holds only public, RLS-gated keys (`SUPABASE_ANON_KEY`, referer-locked Maps key). All privileged secrets live in edge functions.

### 5.5 Permanently Removed Decisions

| Removed | Reason | Replaced by |
|---|---|---|
| **Zendrite / Matrix** | Evaluated for messaging; removed from the entire KitLuy stack. | Supabase Realtime + Telegram Bot. Do not reintroduce. |
| **Starter / Business / Enterprise plans** | Early wireframe invented a 3-tier model that contradicts the handbook. | **Commerce + Chain** (2 plans) only. |
| **"Franchise" as a subscriber type** | Early wireframe treated franchise as a distinct type. | Franchise is a **feature of the Chain plan**. Subscriber types are Commerce / Chain only. |
| **B1/B2/B3 commission splits in KitLuy** | Those are HSA marketplace constructs. | KitLuy is 0% commission SaaS. (Coin-funding "B2" reference is Rotanak's, not KitLuy's economics.) |
| **3-mode adaptive Admin UI (Solo/Chain/Franchise views)** | Mixed admin with subscriber experience. | Admin Portal is a pure HQ god-view; the 3-mode experience belongs to the Seller Portal. |

---

## Part 6 — Database Schema (Canonical)

**CRITICAL RULE:** Where any earlier wireframe mock data disagrees with the schema below, **the schema wins**. Conflicts go to Appendix C.

The Admin Portal **owns** `kitluy.*` and the Phase-2 `kitluy.admin.*` schema. It **reads** `commerce.*`, `pos.*`, `auth.*`, `core.*`, and `loyalty.*` (Rotanak). It **writes** only to objects it owns.

### 6.1 Schema Inventory

| Schema | Owner | Purpose | Admin Portal access |
|---|---|---|---|
| `auth` | Supabase (shared) | Identity (`auth.users.id`). | Read |
| `core` | Ecosystem (shared) | Cross-app users, roles, tenants. | Read |
| `kitluy` | **KitLuy (owned)** | Subscribers, stores, invoices, plans, terminals. | Read/Write |
| `kitluy.admin` | **KitLuy (owned)** | Phase-2 admin: leads, onboarding, device registry, health scores, support evidence. | Read/Write |
| `commerce` | KitLuy (owned, POS-written) | Orders. | Read (aggregate) |
| `pos` | KitLuy (owned, POS-written) | Stores/terminals operational state, shifts. | Read |
| `loyalty` | **Rotanak (consumed)** | Stars, coins, tiers, wallets. | **Read-only** |
| `audit` | KitLuy (owned) | Immutable audit log. | Read/Append |
| `events` | KitLuy (owned) | Domain events (append-only). | Read |

### 6.2 Table Specifications

Core tables the Admin Portal reads/writes. (Money columns are KHR integer — see §6.6 and Part 8 §8.4.)

**`kitluy.subscribers`** (owned)
| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | PK | `gen_random_uuid()` | Public id `SUB-###` is a display alias |
| `name` | text | NOT NULL | | |
| `owner_user_id` | uuid | FK → `auth.users.id` | | Shared identity |
| `plan` | `kitluy.plan_type` | NOT NULL | `'commerce'` | enum: commerce \| chain |
| `mode` | `kitluy.mode_type` | NOT NULL | `'a'` | enum: a \| b \| c |
| `status` | `kitluy.sub_status` | NOT NULL | `'onboarding'` | enum |
| `has_franchise` | boolean | NOT NULL | `false` | Chain feature flag |
| `loyalty_opt` | boolean | NOT NULL | `false` | Rotanak opt-in (Mode B/C) |
| `trial_ends_at` | timestamptz | NOT NULL | `now()+interval '14 days'` | 14-day trial |
| `email` | text | | | |
| `phone` | text | | | E.164 |
| `created_at` | timestamptz | NOT NULL | `now()` | |

**`kitluy.stores`** (owned)
| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | PK | `gen_random_uuid()` | Display `ST-###` |
| `subscriber_id` | uuid | FK → `kitluy.subscribers.id`, NOT NULL | | |
| `name` | text | NOT NULL | | |
| `region` | text | | | |
| `vertical_type` | `kitluy.vertical_type` | NOT NULL, **IMMUTABLE** | | enum; trigger blocks UPDATE (Part 8 §8.2) |
| `store_type` | `kitluy.store_type` | NOT NULL | `'corporate'` | corporate \| franchise |
| `status` | `kitluy.store_status` | NOT NULL | `'onboarding'` | |
| `created_at` | timestamptz | NOT NULL | `now()` | |

**`kitluy.invoices`** (owned)
| Column | Type | Constraints | Default | Notes |
|---|---|---|---|---|
| `id` | uuid | PK | `gen_random_uuid()` | Display `INV-YYYY-MM-###` |
| `subscriber_id` | uuid | FK, NOT NULL | | |
| `plan` | `kitluy.plan_type` | NOT NULL | | |
| `store_count` | int | NOT NULL | | Billed store count |
| `saas_amount` | bigint | NOT NULL | | KHR integer |
| `tx_fees` | bigint | NOT NULL | `0` | KHR integer |
| `total` | bigint | NOT NULL | | KHR integer |
| `status` | `kitluy.invoice_status` | NOT NULL | `'pending'` | |
| `period` | text | NOT NULL | | e.g. `2026-03` |
| `paid_date` | timestamptz | nullable | | NULL until paid |

**`kitluy.admin.leads`** (owned — KF-061)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | Display `LD-###` |
| `name` | text | NOT NULL | Prospect business |
| `contact_name` | text | | |
| `phone` | text | | E.164 |
| `channel` | text | | Facebook Ad, Website, Field Sales, Referral, Upsell |
| `stage` | `kitluy.admin.lead_stage` | NOT NULL | enum |
| `score` | int | NOT NULL default 0 | 0–100, may be Netra-informed |
| `assignee_user_id` | uuid | FK → auth.users nullable | |
| `plan_intent` | `kitluy.plan_type` | | Commerce/Chain |
| `vertical_intent` | `kitluy.vertical_type` | | |
| `created_at` | timestamptz | NOT NULL | |

**`kitluy.admin.device_registry`** (owned — KF-067)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | Display `DEV-###` |
| `device_type` | text | NOT NULL | Hub \| T1-POS \| T3-KDS \| T4-DISP \| T5-QDS |
| `model` | text | | e.g. "Pi5 8GB NVMe" |
| `serial` | text | UNIQUE NOT NULL | |
| `store_id` | uuid | FK → kitluy.stores nullable | NULL if unassigned |
| `subscriber_id` | uuid | FK nullable | |
| `status` | `kitluy.admin.device_status` | NOT NULL | active \| shipped \| rma \| retired |
| `shipped_at` | date | | |
| `warranty_until` | date | | |
| `firmware` | text | | e.g. "2.1.4" |

**`kitluy.admin.subscriber_health_scores`** (owned cache of Netra — KF-065)
| Column | Type | Notes |
|---|---|---|
| `subscriber_id` | uuid PK FK | |
| `health_score` | int | 0–100 |
| `churn_risk` | int | 0–100 |
| `health_band` | text | excellent \| good \| at_risk \| new |
| `drivers` | jsonb | reasons from Netra |
| `computed_at` | timestamptz | staleness check |

Additional owned tables (full columns in Appendix A): `kitluy.admin.lead_activities`, `onboarding_workspaces`, `activation_checkpoints`, `device_actions`, `support_interventions`, `hardware_bundles`, `spare_policies`, `device_health_metrics`, `backup_runs`, `restore_tests`.

### 6.3 Enum Catalog

| Enum | Values |
|---|---|
| `kitluy.plan_type` | `commerce`, `chain` |
| `kitluy.mode_type` | `a`, `b`, `c` |
| `kitluy.sub_status` | `onboarding`, `active`, `grace`, `suspended`, `churned` |
| `kitluy.vertical_type` | `laundry`, `cafe`, `restaurant`, `retail` (Phase 1 uses `laundry` only) — **IMMUTABLE per store** |
| `kitluy.store_type` | `corporate`, `franchise` |
| `kitluy.store_status` | `onboarding`, `active`, `suspended` |
| `kitluy.invoice_status` | `pending`, `paid`, `failed`, `void` |
| `kitluy.admin.lead_stage` | `new`, `qualified`, `demo_scheduled`, `negotiation`, `won`, `lost` |
| `kitluy.admin.device_status` | `active`, `shipped`, `rma`, `retired` |
| `kitluy.admin.support_priority` | `low`, `medium`, `high`, `critical` |

### 6.4 RLS Policy Summary

RLS is **enabled on every KitLuy table**. The Admin Portal uses the `platform_owner` role, which has god-view read across all tenants — a deliberate departure from the tenant-scoped Seller Portal.

```sql
-- Pattern A: Platform-owner full access (admin-owned tables)
USING ( core.is_service_role() OR core.current_role() = 'platform_owner' )

-- Pattern B: Read-only mirror (loyalty.* owned by Rotanak)
-- SELECT allowed for platform_owner; INSERT/UPDATE/DELETE denied at the Admin Portal layer
USING ( core.is_service_role() OR core.current_role() = 'platform_owner' )
WITH CHECK ( core.is_service_role() )   -- writes only via Rotanak/service-role
```

- App clients never use the service-role key; all privileged mutations go through edge functions (Part 7).
- The Admin Portal SPA authenticates as a `platform_owner` user; its queries are RLS-gated to god-view read + owned-table write.

### 6.5 Migration Sequencing

Applied **in order**, by the **BE team only** (never auto-applied):

```
01_kitluy_baseline.sql            # schemas kitluy, audit, events; subscribers, stores, invoices, plans
02_kitluy_enums.sql               # plan_type, mode_type, vertical_type, status enums
03_kitluy_vertical_trigger.sql    # IMMUTABLE vertical_type trigger (Part 8 §8.2)
04_kitluy_rls.sql                 # enable RLS + platform_owner policies
05_kitluy_loyalty_read_grants.sql # read grants on loyalty.* for platform_owner (Rotanak-owned)
06_kitluy_admin_schema.sql        # Phase-2: kitluy.admin.* (leads, device_registry, ... 13 tables)
07_kitluy_admin_rls.sql           # RLS for kitluy.admin.*
08_kitluy_admin_enums.sql         # lead_stage, device_status, support_priority
```

Baseline = 01–05. Phase-2 admin delta = 06–08. Security patches append as `09_*`, `10_*`.

### 6.6 Naming Conventions

| Convention | Rule |
|---|---|
| **Schema prefix** | Always schema-qualified: `kitluy.subscribers`, never `subscribers`. |
| **Casing** | `snake_case` tables and columns. |
| **Primary keys** | `uuid` via `gen_random_uuid()`. |
| **Display IDs** | Human aliases (`SUB-###`, `ST-###`, `INV-YYYY-MM-###`, `DEV-###`, `LD-###`) derived for UI; the DB PK is the uuid. |
| **Money** | `bigint`, KHR integer, no decimals. The symbol is `៛` (U+17DB). `₭` is **wrong**. |
| **Timestamps** | `timestamptz`, stored UTC, displayed `Asia/Phnom_Penh`. |
| **Phones** | E.164 (`+855…`). |
| **Idempotency** | Edge-function writes accept an `idempotency-key` header; POS `op_id`s are out of scope for the Admin Portal. |

---

## Part 7 — API / Edge Function Specifications

All privileged work runs through Supabase Edge Functions (Deno, service-role). The Admin Portal SPA calls a subset; others are crons/listeners it merely observes. **22 functions total** (17 core + 5 Phase-2 admin).

### 7.1 Shared / Core Functions (17)

| Function | Method/Trigger | Auth | Purpose | Admin Portal relationship |
|---|---|---|---|---|
| `commerce-create-order` | POST | store/PIN | Create an order (POS). | Observes throughput only |
| `pos-sync-heartbeat` | POST | device | Hub↔cloud sync heartbeat. | Reads recency |
| `royalty-calculation-cron` | cron | service | Franchise royalty calc. | Observes |
| `loyalty-points-listener` | event | service | Reacts to loyalty events (Rotanak). | Observes |
| `payway-purchase` | POST/webhook | service + PayWay sig | Process payment + receive PayWay webhook. | Observes invoice outcomes |
| `subscriber-billing-cron` | cron (monthly) | service | Generate invoices + auto-charge. | **Drives the Invoices page** |
| `franchise-royalty-settle` | cron | service | Settle franchise royalties. | Observes |
| `store-onboard-init` | POST | service | Initialize a new store. | Triggered during onboarding |
| `terminal-firmware-push` | POST | service | OTA firmware to a device. | **Triggered by Firmware page** |
| `hub-health-check` | cron | service | Probe Hub health. | Feeds Fleet health |
| `telegram-bot-notify` | POST | service | Send customer Telegram notifications. | Status observed |
| `domain-event-ingest` | POST | service | Append domain events. | **Feeds Domain Events page** |
| `ai-subscriber-insights` | cron (06:00) | service + Netra | Generate proactive insights. | **Feeds AI Insights page** |
| `tab-settlement-cron` | cron | service | Settle B2B customer tabs. | Observes |
| `pay-at-pickup-handler` | POST | store | Handle pay-at-pickup orders. | Observes |
| `marketing-promo-engine` | POST | service | Execute marketing promos. | Feeds Marketing |
| `ai-campaign-runner` | cron (06:00) | service + Netra | Run AI marketing campaigns. | Feeds Campaigns |

### 7.2 Phase-2 Admin Functions (5)

**`kitluy-onboarding-provision`** — KF-062
- **Route:** `POST /kitluy-onboarding-provision`
- **Auth:** `platform_owner` JWT.
- **Headers:** `Content-Type: application/json`, `Authorization: Bearer <jwt>`, `idempotency-key`.
- **Request body:**
```json
{ "subscriber_name": "string", "owner_phone": "+855…",
  "plan": "commerce|chain", "mode": "a|b|c", "vertical": "laundry",
  "store_count": 1 }
```
- **Responses:** `200 { subscriber_id, workspace_id, trial_ends_at }` · `400` validation · `401` not platform_owner · `409` duplicate (idempotency) · `500`.
- **Side effects:** INSERT `kitluy.subscribers` (status `onboarding`, `trial_ends_at = now()+14d`), INSERT `kitluy.admin.onboarding_workspaces` + `activation_checkpoints`; broadcast `subscriber.created` domain event.
- **Idempotency:** replay with same key returns the original `subscriber_id`, no duplicate.
- **RLS enforcement:** function layer (service-role write; caller verified `platform_owner`).

**`kitluy-device-heartbeat-ingest`** — KF-063/067
- **Route:** `POST /kitluy-device-heartbeat-ingest` (devices push) + companion action endpoint (operator pushes remote action).
- **Auth:** device token (ingest) / `platform_owner` (action).
- **Request (heartbeat):** `{ serial, firmware, status, offline_queue_depth, metrics }`.
- **Request (action):** `{ device_id, action: "restart|config_push|printer_repair|log_pull", params }`.
- **Responses:** `200` · `400` · `401` · `404` unknown serial · `500`.
- **Side effects:** UPSERT `device_health_metrics`; for actions INSERT `kitluy.admin.device_actions` (status `queued`→`completed`), append evidence to `support_interventions`.
- **Idempotency:** heartbeats are last-write-wins by `serial`; actions keyed by `idempotency-key`.

**`kitluy-subscriber-health-v2`** — KF-065
- **Route:** `POST /kitluy-subscriber-health-v2` (also cron 06:00).
- **Auth:** service / `platform_owner`.
- **Side effects:** calls Netra, UPSERT `subscriber_health_scores`. Returns `{ subscriber_id, health_score, churn_risk, band, drivers }`.
- **Errors:** Netra down → returns cached + `stale:true`.

**`kitluy-activation-score-calc`** — KF-064
- **Route:** cron 06:00 + on-demand `POST`.
- **Side effects:** evaluates `activation_checkpoints` (first_order, catalog_done, shift_closed, loyalty_used, telegram_bot), computes `days_to_value`; writes back. Feeds the Activation Dashboard.

**`kitluy-upgrade-workflow-start`** — KF-068
- **Route:** `POST /kitluy-upgrade-workflow-start`
- **Auth:** `platform_owner`.
- **Request:** `{ subscriber_id, target_plan: "chain" }`.
- **Side effects:** creates an upgrade checklist record; on completion flips `subscribers.plan` `commerce→chain` and re-bases billing. Append-only audit entry.
- **Responses:** `200 { upgrade_id, checklist }` · `409` already Chain · `422` ineligible.

---

## Part 8 — Business Logic & Computation Rules

### 8.1 Entity Hierarchy

The authoritative ownership chain the Admin Portal manages:

```
Platform (KitLuy HQ)
  └── Subscriber (tenant; Commerce or Chain)        [kitluy.subscribers]
        └── Store (1 vertical, immutable)            [kitluy.stores]
              ├── Hub (1 per store)                  [kitluy.admin.device_registry]
              └── Terminal(s) (T1–T5)                [kitluy.admin.device_registry]
        └── Invoice(s) (monthly)                     [kitluy.invoices]
        └── Lead → (converts to Subscriber)          [kitluy.admin.leads]
        └── Onboarding Workspace (during onboarding) [kitluy.admin.onboarding_workspaces]
        └── Health Score (1 per subscriber)          [kitluy.admin.subscriber_health_scores]
```

A **Lead** is pre-subscriber (CRM). On win, it provisions a **Subscriber**. A **Chain** subscriber may contain **franchise** stores (`store_type='franchise'`); franchise is a relationship, not a separate tenant.

### 8.2 Immutable Rules (architectural, not configurable)

1. **1 Store = 1 Vertical, permanently.** `kitluy.stores.vertical_type` is set at creation and blocked from UPDATE by a DB trigger:
```sql
CREATE TRIGGER trg_lock_vertical BEFORE UPDATE OF vertical_type ON kitluy.stores
FOR EACH ROW WHEN (OLD.vertical_type IS DISTINCT FROM NEW.vertical_type)
EXECUTE FUNCTION kitluy.raise_immutable_vertical();
```
2. **KitLuy consumes, never rebuilds** Netra, Rotanak, HSAL. The Admin Portal never writes loyalty, never recomputes AI, never owns delivery.
3. **0% commission.** KitLuy revenue is SaaS only. No order-revenue cut.
4. **KHR integer money.** No decimals, ever. Symbol `៛` (U+17DB).
5. **Migrations: written by engineers, applied by BE team.** Never auto-apply.
6. **Service-role only for direct DB.** Clients go through edge functions.
7. **Loyalty writes belong to Rotanak.** Admin Portal loyalty pages are read-only mirrors.

### 8.3 State Machines

**Subscriber lifecycle** (`kitluy.subscribers.status`):
```
            provision                pass 14d trial & first payment
   (lead won) ──────► onboarding ───────────────────────────► active
                          │                                      │
                          │ trial expires unpaid                 │ payment fails
                          ▼                                      ▼
                       (grace) ◄──────────────────────────────  grace
                          │  pay within grace window → active     │
                          │  grace window elapses                 │
                          ▼                                       │
                       suspended ◄──────────────────────────────┘
                          │  reactivate (pay) → active
                          │  prolonged non-payment
                          ▼
                       churned   (data retained per retention policy)
```

**Store status:** `onboarding → active → suspended` (suspend cascades from subscriber suspension).

**Lead stage** (`kitluy.admin.lead_stage`):
```
new → qualified → demo_scheduled → negotiation → won
                                              └─► lost  (terminal)
```

**Device status** (`kitluy.admin.device_status`):
```
shipped → active → rma → (active after repair | retired)
```

**Onboarding workspace** (7 gates, KF-062): `account_created → hub_shipped → hub_online → catalog_configured → staff_pins → test_orders → go_live`.

### 8.4 Money Model

| Aspect | Rule |
|---|---|
| **Storage type** | `bigint`, KHR integer (no fractional currency). |
| **Display** | `៛60,000` with comma thousands. Symbol U+17DB. |
| **USD shadow** | Only at explicit final totals when configured: `៛60,000 (~$15.00)`. Not on every figure. |
| **Rounding** | Not applicable to KHR integers internally. USD shadow uses a configured rate, 2-dp, display-only. |
| **MRR formula** | `Σ subscriber.mrr` over active subscribers, where Commerce `mrr = 30 × active_stores` and Chain `mrr = 100 + 50 × active_stores`. KHR. |
| **ARR** | `MRR × 12`. |
| **NRR** | `(MRR_start + expansion − contraction − churn) ÷ MRR_start × 100`. |
| **ARPU** | `MRR ÷ active_subscriber_count`. |
| **Invoice total** | `saas_amount + tx_fees`. |

The formatter helpers live in `src/lib/format.ts`: `fmt(n)` → `៛{n,}`, `usd(n)` → `${n,}`, `pct(n)` → `{n.1}%`.

### 8.5 Cart → Invoice → Receipt Flow

The Admin Portal does not produce carts or receipts (POS does). Its only "invoice" flow is **SaaS billing**, not order checkout:

```
1. subscriber-billing-cron fires (monthly, 1st, 00:00 Asia/Phnom_Penh)
2. For each active subscriber past trial:
     saas = (plan='commerce') ? 30*active_stores : 100 + 50*active_stores
     tx_fees = Σ per-order processing fee for the period
     total = saas + tx_fees
3. INSERT kitluy.invoices (status='pending')
4. Auto-charge via payway-purchase against stored method
5. payway-purchase webhook → UPDATE invoice.status = 'paid' (paid_date set)
6. Admin Portal Invoices page renders the period's invoices (read)
```

### 8.6 Inventory Deduction Rules

Not applicable to the Admin Portal directly — inventory lives in the POS/Seller builds (`inventory.*`). The Admin Portal may **read** aggregate inventory health for support, but performs **no deductions**. For reference, POS deduction fires on **"ready,"** not on "created" (documented in the POS bible).

### 8.7 Subscription Lifecycle

| State | Entry | Behavior | Exit |
|---|---|---|---|
| **onboarding** | Lead won / provisioned. | 14-day free trial. Full feature access. No charge. | Trial passes + first payment → `active`; trial expires unpaid → `grace`. |
| **active** | Trial passed & paid. | Normal billing each month. | Payment fails → `grace`. |
| **grace** | Trial expired unpaid OR payment failed. | [REQUIRED: exact grace window — assume 7 days] read-only or limited access; reminders sent. | Pays → `active`; window elapses → `suspended`. |
| **suspended** | Grace elapsed. | Access blocked; data retained. | Reactivate (pay) → `active`; prolonged → `churned`. |
| **churned** | Cancellation / prolonged non-payment. | Data retained [REQUIRED: retention window]; can re-provision. | Re-subscribe → new `onboarding`. |

Trial = 14 days (locked). Auto-bill on trial end (locked).

### 8.8 Conflict Resolution

| Data class | Policy |
|---|---|
| **Financial (invoices, audit)** | **Append-only.** Invoices are never edited in place; a correction is a new record. Audit log is immutable. |
| **Operational (device heartbeats, health scores)** | **Last-write-wins** by natural key (`serial`, `subscriber_id`). Stale data is replaced. |
| **Onboarding/lead state** | Forward-only state transitions (no backward stage moves except explicit re-open). |

The Admin Portal itself surfaces conflicts (e.g., a Hub reporting offline while a recent heartbeat exists) but does not resolve POS-side sync conflicts — those are reconciled at the Hub.

### 8.9 Tax / Compliance Stub

Cambodian tax handling is currently **stubbed** at the platform level. Invoices store `saas_amount` and `tx_fees` without a separate tax line. Future hook: a `tax_amount` column on `kitluy.invoices` and a `kitluy.tax_policy` table keyed by subscriber jurisdiction. **No public compliance claims are made yet** (locked decision — internal discipline only). [REQUIRED: VAT treatment when formalized.]

---
## Part 9 — Design System & UI Inventory

The Admin Portal inherits the **HSA Admin Portal design system** verbatim (shared codebase). Tokens, components, and patterns are identical; only data context differs.

### 9.1 Core Tokens

| Token | Value |
|---|---|
| Primary | Sky Blue `#0EA5E9` |
| Primary dark / deep | `#0284C7` / `#075985` |
| Accent | `#F5A623` (also Rotanak mirror banner) |
| Dark sidebar | `#0F172A` (light mode) / `#070B14` (dark mode) |
| Semantic | green `#10B981`, red `#EF4444`, amber `#F59E0B`, purple `#8B5CF6`, teal `#14B8A6`, pink `#EC4899` |
| Font | DM Sans |
| Card radius | 12px |
| Base grid | 16px |

**Dark/light theming** is driven by CSS custom properties set on the root container via a `TV(dark)` map. Theme-dependent colors use `var(--xxx)`; accent colors are constant (work on both backgrounds).

| CSS var | Light | Dark |
|---|---|---|
| `--bg` | `#F5F7FA` | `#0B0F19` |
| `--card` | `#fff` | `#151C2C` |
| `--bd` (border) | `#E8ECF0` | `#1E2536` |
| `--side` (sidebar) | `#0F172A` | `#070B14` |
| `--t1` (text primary) | `#111827` | `#F1F5F9` |
| `--t2` (text secondary) | `#6B7280` | `#94A3B8` |
| `--t3` (text tertiary) | `#9CA3AF` | `#64748B` |
| `--th` (table header) | `#F9FAFB` | `#111827` |
| `--sub` (subtle bg) | `#F3F4F6` | `#1A2035` |

The theme toggle (sun/moon) lives in the Topbar and on the login screen.

### 9.2 Mirror Banners

Every read-only page that displays sibling-owned data carries a banner naming the source and the read-only status. This is an **architectural safety rail** — it tells the operator "you cannot change this here."

| Source | Banner color | Text | Pages |
|---|---|---|---|
| **Rotanak (loyalty)** | Gold `#F5A623` | "READ-ONLY — Source: Rotanak Admin Portal" | Loyalty > Tier Config, Subscriber Opt-ins, Coin Activity |
| **Netra (AI)** | Purple `#8B5CF6` | "READ-ONLY — Source: Netra · AI intelligence" | AI Subscriber Insights (and AI-scored fields) |
| **HSAL (logistics)** | Subtle/info | "Data from HSAL Admin Portal" | Logistics Feed |

### 9.3 Localization & Formatting

| Aspect | Rule |
|---|---|
| Currency | KHR `៛` (U+17DB), integer only, comma thousands. USD shadow only at configured totals. |
| Date | `DD/MM/YYYY`. |
| Timezone | `Asia/Phnom_Penh` (UTC+7), strictly. Timestamps stored UTC, displayed local. |
| Locale | `en-KH`. |
| Phone | E.164 (`+855 12 345 678`). |
| Language order | Primary English; Secondary Khmer (Khmer Unicode, allow **40% wider** containers); Tertiary Chinese where applicable. |

### 9.4 Terminal / Screen Patterns

The Admin Portal has **one screen type**: a desktop web console. (It does not drive cashier/KDS/customer-display terminals — those are POS concerns.) Layout pattern, shared across every page:

```
┌──────────┬─────────────────────────────────────────────┐
│ Sidebar  │ Topbar (clock, theme toggle, role badge,     │
│ (dark,   │         notifications, user)                 │
│ 256px,   ├─────────────────────────────────────────────┤
│ zoom 1.2,│ Hdr (page title + description + actions)     │
│ 15 groups├─────────────────────────────────────────────┤
│ collapsi-│ KPI row (4 cards: value, delta %, icon)      │
│ ble)     │ Grid of Cd cards / data tables (TH/TD)       │
│          │ HealthBar where 0–100 scores appear          │
└──────────┴─────────────────────────────────────────────┘
```
- Touch targets are not a concern (desktop, mouse). Min interactive size still ~32px for accessibility.
- Dark/light mode supported (§9.1).
- Idle behavior: session persists until Supabase token expiry; no auto-logout kiosk behavior (HQ office context).

### 9.5 Wireframe References

| Artifact | Notes |
|---|---|
| `kitluy-admin-portal-wireframe-v2_4_1.jsx` | Current baseline: 963 lines, 45 routes, 15 sidebar groups, 22 edge functions, dark/light mode, read-only Rotanak loyalty. |
| Lineage | v2.0.0 (HSA clone) → v2.1.x (platform-owner rebuild) → v2.2.0 (handbook align) → v2.3.x (dark mode) → v2.4.x (Phase-2 KF-061→070 + loyalty mirror). |

**Renderer constraints (artifact Babel — must follow or it won't render):**
- **No optional chaining** (`?.`). Use `x && x.y` or a ternary.
- **No array destructuring in `useState`.** Use `var s = useState(); var x = s[0]; var setX = s[1];`.
- **JSX attribute concatenation must be braced.** `desc={"a " + b}`, never `desc="a " + b`.
- **Define `var` page components BEFORE the `ROUTES`/`getPage` object** (no hoisting for `var`).
- **File < ~270KB.** Trim mock data to 2–3 entries per array.

(These constraints apply to the *wireframe artifact*. The production Vite/React build supports modern syntax.)

### 9.6 App-Specific Brand Overrides

Sibling ecosystem apps have distinct brand colors (reference only): Rotanak Gold `#F5A623`, Netra Purple `#8B5CF6`. The Admin Portal uses these **only** as mirror-banner colors, not as its own theme. KitLuy's own identity is Sky Blue `#0EA5E9`.

---

## Part 10 — Security Model & RBAC

### 10.1 Role Definitions

| Role | Home product | Scope |
|---|---|---|
| **platform_owner** | Admin Portal | Full god-view + owned-table write. Het + senior HQ. |
| **support_lead** | Admin Portal | Tickets, SLA, billing support, Telegram config, device console (read + remote actions). |
| **operations** | Admin Portal | Onboarding, compliance, marketing campaigns, store activation, device registry. |

All three are **internal HQ roles**. Merchant-facing roles (shop owner, cashier) live in the Seller Portal / POS, not here. (Driver auth, where relevant elsewhere, uses `core.users.role_type='driver'` directly — never `core.user_roles`; not an Admin Portal concern.)

### 10.2 Permission Matrix

| Capability | platform_owner | support_lead | operations |
|---|---|---|---|
| View all subscribers / stores | ✓ | ✓ | ✓ |
| Edit subscriber / plan | ✓ | | ✓ |
| Start onboarding / provision | ✓ | | ✓ |
| Start upgrade workflow (Commerce→Chain) | ✓ | | ✓ |
| Toggle **safety switches** | ✓ | | |
| Push firmware / device remote action | ✓ | ✓ | |
| View invoices | ✓ | ✓ | ✓ |
| Refund / billing adjustment | ✓ | ✓ (PIN-gated) | |
| Manage CRM leads | ✓ | | ✓ |
| Manage marketing campaigns | ✓ | | ✓ |
| View loyalty mirror (read-only) | ✓ | ✓ | ✓ |
| Manage KitLuy team / config | ✓ | | |
| View audit trail | ✓ | ✓ | ✓ |

Blank = denied. Safety switches are platform_owner-only (highest blast radius).

### 10.3 PIN / Auth Model

- **Portal users (all three roles):** full Supabase SSO via **Phone OTP** (primary ecosystem auth). One `auth.users.id` per person across the ecosystem (shared identity). Session = Supabase JWT.
- **No 4-digit PIN login for the Admin Portal** (PINs are a POS staff concept). However, **sensitive billing actions** (refund/adjustment) may require a confirming PIN/reason from `support_lead` (§10.4).
- Session timeout = Supabase token TTL; re-auth on expiry. [REQUIRED: exact TTL.]
- Passwords/PINs anywhere in the ecosystem are hashed with **Argon2id**.

### 10.4 Sensitive Action Gating

| Action | Gate |
|---|---|
| Toggle safety switch (maintenance, billing pause, sync pause) | platform_owner only; severity-colored confirm. |
| Refund / billing adjustment | Reason code required; PIN confirm for support_lead. |
| Device remote action (restart/config push) | Logged with actor + evidence (KF-070). All remote actions are allowed (locked decision) but fully audited. |
| Plan change / upgrade cutover | Append-only audit entry; platform_owner or operations. |
| Subscriber suspension | Reason required; audit logged. |

### 10.5 Audit Logging

Every privileged action writes to `audit.*` (immutable, append-only):

| Field | Notes |
|---|---|
| `actor_user_id` | Who (auth.users.id) |
| `action` | e.g., `safety.switch`, `plan.upgraded`, `invoice.refund`, `hub.offline`, `campaign.launched` |
| `target` | Affected entity (subscriber/store/device id + label) |
| `before` / `after` | jsonb snapshots for state changes |
| `ip` | Source IP |
| `created_at` | timestamptz (UTC, displayed Asia/Phnom_Penh) |

The Audit Trail page renders this log with action color-coding. Rows are never edited or deleted.

### 10.6 Encryption Standards

| Layer | Standard |
|---|---|
| At rest | Supabase-managed PostgreSQL encryption. |
| In transit | TLS 1.2+ for all HTTPS/WSS. |
| Field-level PII | Phone numbers stored E.164; sensitive credentials never stored in app tables. |
| Secrets | Supabase secrets vault for edge functions; SPA holds only public/anon + referer-locked keys. |
| Passwords/PINs | Argon2id. |

---

## Part 11 — Deployment & Infrastructure

### 11.1 Cloud Provisioning

| Item | Value |
|---|---|
| Backend provider | Supabase |
| Project ID | `qneduoifcsvjajeqmvgb` |
| Region | `ap-southeast-1` (Singapore / SGP1) |
| Database | PostgreSQL v17 |
| Auth | Supabase Auth (SSO, Phone OTP) |
| Realtime | Enabled (live dashboards, heartbeats, events) |
| Storage | Supabase Storage (assets, exports) |
| SPA host | DigitalOcean SGP1 (static) |

### 11.2 Local Node Provisioning

**None for the Admin Portal.** It runs no Hub, no Pi, no local PostgreSQL replica. (Hub/terminal imaging is a POS-build concern; the Admin Portal only registers devices in its Device Registry after Het's team images them — Part 14.)

### 11.3 Terminal Pairing

**Not applicable to the Admin Portal.** No terminals pair to it. The Admin Portal *observes* paired devices via heartbeat ingest. (Pairing of T1–Tn to a store Hub is documented in the POS bible.)

### 11.4 Secrets Injection

- **SPA:** build-time env (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, referer-locked `GOOGLE_MAPS_API_KEY`) via the host's environment config. No privileged secrets in the bundle.
- **Edge functions:** Supabase secrets (service-role key, PayWay creds, Netra key, Telegram tokens) injected at the function runtime. Vault policy — never in env files committed to source.

### 11.5 Certificate & Domain Management

- SSL terminated at the static host / CDN.
- Custom domain for the Admin Portal: [REQUIRED: exact domain, e.g. `admin.kitluy.com.kh`].
- The ecosystem QR primitive uses `qr.het.digital`; not an Admin Portal surface.

---

## Part 12 — Monitoring, Observability & Alerting

The Admin Portal is itself a monitoring surface for the platform, but it also must be monitored. Both senses are covered.

### 12.1 Health Checks

| Target | Endpoint/Probe | Frequency | Expected | Timeout |
|---|---|---|---|---|
| Edge functions | per-function invoke probe | continuous | 200 + low error rate | [REQUIRED] |
| PostgreSQL | Supabase health | continuous | healthy | — |
| PayWay | gateway reachability probe | periodic | connected | [REQUIRED] |
| Telegram webhook | bot status check | periodic | responding | — |

The Infrastructure page renders these as a services list (healthy/degraded with color dots).

### 12.2 Heartbeat Semantics

| Component | Interval | Missing heartbeat triggers |
|---|---|---|
| Store **Hub** | every ~2 min (`kitluy-device-heartbeat-ingest`) | Hub marked offline; dashboard + Fleet alert; if > threshold, P2 incident. |
| POS terminal | bundled in Hub sync | Terminal marked offline in Fleet. |
| Edge cron jobs | on schedule | Missed run flagged on Edge Functions page (last-call timestamp stale). |

The Admin Portal aggregates: **Hub online rate**, **device online rate**, **firmware compliance %**, **event throughput (24h)**.

### 12.3 Log Aggregation

- **Domain events** (`events.*`, append-only) are the primary observability stream — 20+ event types (order_created, payment_completed, hub_sync_completed, loyalty_earned, etc.), ingested via `domain-event-ingest`, surfaced on the Domain Events page with 24h counts and trends. This is also the **AI data foundation** for Netra.
- **Edge-function logs** live in Supabase; searchable by function + timestamp. Retention [REQUIRED].
- **Audit log** (`audit.*`) for privileged actions (Part 10.5).

### 12.4 Metrics & Dashboards

Key metrics visualized in the Admin Portal:

| Metric | Where |
|---|---|
| MRR / ARR / NRR / Churn | Platform Overview, SaaS Metrics |
| Active subscribers, store counts | Platform Overview |
| Hub online rate, firmware compliance | Fleet & Hub Health |
| Order throughput, GMV | Order Throughput |
| Domain-event throughput (24h) | Domain Events |
| SLA compliance, breach count | Support Center |
| Activation days-to-value | Activation Dashboard |
| Ops benchmarks (orders/store, utilization, shift variance, hub uptime) | Ops Benchmarks |

### 12.5 Alert Thresholds

| Condition | Threshold | Severity |
|---|---|---|
| Hub no heartbeat | > [REQUIRED: e.g. 5] min | P2 |
| Edge-function error rate | > [REQUIRED]% over 1h | P2 |
| SLA breach (support ticket) | elapsed > ticket SLA hours | shown red, escalate |
| Invoice failed (payment) | status `failed` | action item |
| Firmware compliance | < [REQUIRED: e.g. 80]% fleet | warning |
| Churn risk (subscriber) | ≥ 25% | at-risk flag + rescue queue |

### 12.6 Incident Runbooks (lightweight)

**Hub down (single store):** confirm heartbeat gap on Fleet page → attempt Remote Restart (KF-063) → if no recovery, dispatch spare from central stock (Het's team) → log evidence (KF-070). Store keeps operating offline-first on the Hub's last good state until restored.

**Internet partition (store WAN down):** Hub continues serving the store LAN; cash sales stay offline-capable; KHQR/card require WAN. Admin Portal shows the store's Hub as "last sync N min ago." No action beyond monitoring until WAN returns; sync drains the offline queue automatically.

**Payment gateway timeout (PayWay):** Infrastructure page shows PayWay degraded → billing cron retries per backoff → affected invoices stay `pending` → support_lead monitors; no manual double-charge.

---

## Part 13 — Backup & Disaster Recovery

### 13.1 Backup Schedule & Scope

| Asset | Frequency | Retention | Owner |
|---|---|---|---|
| Supabase PostgreSQL (all KitLuy schemas) | [REQUIRED: e.g. daily automated + PITR] | [REQUIRED] | Supabase / BE team |
| Store **Hub NVMe** (per store) | local snapshot cadence | [REQUIRED] | POS build / store ops |
| Terminal configs | captured in Device Registry | versioned | Admin Portal |

The Admin Portal tracks backup/restore *evidence* in `kitluy.admin.backup_runs` and `restore_tests` (KF-adjacent), but the backup *execution* of the cloud DB is Supabase-managed and of the Hub is POS-side.

### 13.2 Restore Procedures

| Failure | Procedure |
|---|---|
| **Admin Portal SPA corrupt/bad deploy** | Re-deploy previous static build artifact (immutable, versioned). No data involved — the portal is stateless. |
| **Cloud DB corruption** | Supabase PITR / restore to last good point (BE team). Admin Portal reconnects automatically; no portal-side state to restore. |
| **Hub hardware failure (store)** | Swap in a centrally-stocked spare Pi 5, re-image, re-provision `store_id` from cloud, sync. Update Device Registry (old → `rma`, new → `active`). |
| **Accidental subscriber deletion** | Restore from DB backup; financial records are append-only so invoices/audit survive; re-link via `subscriber_id`. |

### 13.3 RPO / RTO Targets

| Tier | RPO (max data loss) | RTO (max downtime) |
|---|---|---|
| Admin Portal SPA | 0 (stateless) | minutes (re-deploy) |
| Cloud DB | [REQUIRED: e.g. ≤ 5 min via PITR] | [REQUIRED] |
| Store Hub | [REQUIRED: e.g. ≤ last sync window] | hours (spare swap) |

### 13.4 Degraded Modes

| Condition | Admin Portal behavior |
|---|---|
| Supabase down | Portal shows connection error (online-only). No god-view until backend returns. |
| Netra down | Health/insight pages show cached scores with staleness flag. |
| Rotanak read path down | Loyalty mirror shows "data unavailable"; platform operations unaffected. |
| PayWay down | Billing pauses/retries; invoices stay `pending`; portal flags it. |
| A store Hub down | Portal shows that store offline; rest of god-view fully functional. |

---

## Part 14 — Standard Operating Procedures (SOPs)

Each SOP: **Trigger · Actor · Steps · Expected Result · Fallback.**

### 14.1 Provisioning SOPs

**SOP-P1 — Onboard a new subscriber (KF-062)**
- **Trigger:** A CRM lead reaches `won`.
- **Actor:** operations.
- **Steps:** 1) Onboarding > Workspace → "Provision". 2) Enter name, owner phone (E.164), plan, mode, vertical, store count. 3) Submit → `kitluy-onboarding-provision` runs. 4) Confirm subscriber appears at 0% in pipeline with 14-day trial. 5) Apply a vertical template (KF-069) for default catalog/staff/pricing.
- **Expected:** `kitluy.subscribers` row (`onboarding`, `trial_ends_at = +14d`), workspace + activation checkpoints created, `subscriber.created` event emitted.
- **Fallback:** If provisioning 409s (duplicate), check for an existing subscriber/lead; resume the existing workspace.

**SOP-P2 — Add a store to a subscriber**
- **Trigger:** Subscriber opens a new location.
- **Actor:** operations.
- **Steps:** 1) Subscriber detail → Add Store. 2) Set name, region, **vertical (immutable)**. 3) `store-onboard-init` runs. 4) Register the store's Hub + terminals in Device Registry.
- **Expected:** `kitluy.stores` row (`onboarding`), devices linked.
- **Fallback:** Vertical mismatch → a store cannot change vertical; create a separate store.

**SOP-P3 — Register a device (KF-067)**
- **Trigger:** Het's team images a new Hub/terminal.
- **Actor:** operations.
- **Steps:** 1) Fleet Ops > Devices → Register. 2) Enter type, model, serial, warranty. 3) Assign to store. 4) Device begins heartbeating.
- **Expected:** `device_registry` row (`shipped`→`active` on first heartbeat).
- **Fallback:** No heartbeat after install → Remote diagnostics (KF-063); if dead, mark `rma`, dispatch spare.

### 14.2 Daily Operations (HQ)

**SOP-D1 — Morning platform check**
- **Trigger:** Start of business day.
- **Actor:** platform_owner / operations.
- **Steps:** 1) Dashboard → review MRR delta, at-risk subscribers, hub health, open tickets. 2) Clear "Requires Attention" items. 3) Check Domain Events throughput is nominal.
- **Expected:** All red items triaged; no silent Hub outages.
- **Fallback:** Anomaly → drill into the relevant module; open incident runbook (Part 12.6).

**SOP-D2 — Handle a support ticket + remote intervention (KF-063/070)**
- **Trigger:** New ticket (e.g., Hub not syncing).
- **Actor:** support_lead.
- **Steps:** 1) Support > Tickets → open ticket. 2) Identify device. 3) Fleet > Console → Remote Restart / Log Pull / Config Push. 4) Verify resolution. 5) Evidence auto-logged to Evidence Log.
- **Expected:** Ticket resolved within SLA; intervention recorded with artifacts.
- **Fallback:** Remote action fails → escalate to spare-swap dispatch.

**SOP-D3 — Churn rescue (KF-065)**
- **Trigger:** Subscriber churn risk ≥ 25%.
- **Actor:** operations.
- **Steps:** 1) Subscribers > Health & Rescue → review drivers (from Netra). 2) Execute suggested rescue (outreach / training / bot enablement). 3) Track in lead/health notes.
- **Expected:** Risk drivers addressed; health score re-evaluated next cron.
- **Fallback:** No response → schedule follow-up; consider win-back offer.

### 14.3 Exception Handling

| Exception | Handling |
|---|---|
| Failed payment | Invoice `pending/failed` → subscriber enters grace → reminders → support_lead monitors; no manual double-charge. |
| Subscription grace elapsed | Auto-suspend; access blocked; data retained; reactivation on payment. |
| Hardware failure | Remote diagnostics → spare swap from central stock → Device Registry updated. |
| Sync conflict (store) | Reconciled at Hub (LWW operational / append-only financial); Admin Portal observes only. |
| Missing Telegram bot | Dashboard flags subscriber; operations completes webhook config during onboarding. |

### 14.4 Recovery SOPs

| Recovery | Steps |
|---|---|
| Restore from DB backup | BE team triggers Supabase PITR; Admin Portal auto-reconnects (stateless). |
| Re-image a terminal | Het's team re-images Pi; operations re-registers/links in Device Registry; confirm heartbeat. |
| Swap a failed printer | Field swap (POS-side); support_lead re-pairs via Remote Console config push; log evidence. |
| Bad Admin Portal deploy | Re-deploy previous static artifact; no data impact. |

---

## Part 15 — QA Test Matrix & Acceptance Criteria

Admin-portal-scoped scenarios. Each: **ID · Name · Path · Pass Condition (DB + UI) · Validator.**

| ID | Name | Path (user actions) | Pass Condition | Validator |
|---|---|---|---|---|
| QA-AP-01 | Platform-owner login | Open portal → SSO Phone OTP → land on Dashboard | Session JWT issued; role `platform_owner`; Dashboard renders KPIs | Auth session row; UI shows MRR card |
| QA-AP-02 | MRR correctness | Dashboard → read MRR | MRR = Σ(Commerce 30×stores + Chain 100+50×stores) over active | SQL sum vs. displayed value |
| QA-AP-03 | Provision subscriber (14-day trial) | Onboarding → Provision → submit | `subscribers` row `onboarding`, `trial_ends_at = +14d`; event `subscriber.created` | `SELECT trial_ends_at` = created+14d |
| QA-AP-04 | Vertical immutability | Try to change a store's vertical | UPDATE rejected by trigger; UI blocks | Trigger raises; store row unchanged |
| QA-AP-05 | Plan/pricing correctness | Plans page | Shows Commerce ៛30/store + Chain ៛100+៛50/store; no Starter/Business/Enterprise | Visual + plan catalog rows |
| QA-AP-06 | Read-only loyalty mirror | Loyalty > Tier Config | Gold banner present; no edit controls; write attempt denied by RLS | RLS denies INSERT to `loyalty.*` |
| QA-AP-07 | Subscriber health from Netra | Health & Rescue | Scores render from `subscriber_health_scores`; at-risk (<60) highlighted | Cache row vs. UI |
| QA-AP-08 | Churn rescue queue | Health & Rescue | Subscribers with risk ≥25% appear in rescue list | SQL filter vs. UI list |
| QA-AP-09 | Device registry lifecycle | Fleet > Devices | New device `shipped`→`active` on heartbeat; RMA shows red | Status transitions in `device_registry` |
| QA-AP-10 | Remote device action (all allowed) | Fleet > Console → Restart | `device_actions` row `queued`→`completed`; evidence logged | `device_actions` + `support_interventions` |
| QA-AP-11 | Firmware compliance | Fleet > Firmware | Compliance % = on-target ÷ total; push updates non-compliant | SQL vs. displayed % |
| QA-AP-12 | Billing cron → invoice | Run `subscriber-billing-cron` (staging) | Invoices created `pending`; totals = saas+tx; auto-charge → `paid` | `invoices` rows + status |
| QA-AP-13 | Grace on payment failure | Simulate charge failure | Subscriber → `grace`; invoice `failed`; flagged on dashboard | `subscribers.status='grace'` |
| QA-AP-14 | SLA breach surfacing | Support > Tickets with elapsed > SLA | Ticket shows "BREACHED" red; counted in breach KPI | elapsed vs. SLA hours |
| QA-AP-15 | Tenant isolation (god-view correctness) | View two subscribers | Each subscriber shows only its own stores/devices/invoices; no cross-leak in detail views | FK-scoped queries per subscriber |
| QA-AP-16 | Domain-event throughput | Domain Events | 24h counts render; ingestion increments live via Realtime | `events.*` count vs. UI |
| QA-AP-17 | Upgrade workflow Commerce→Chain | Subscribers > Upgrade → complete checklist | On completion `plan` flips to `chain`; billing re-based; audit appended | `subscribers.plan` + audit row |
| QA-AP-18 | Safety switch gating | Toggle billing pause as support_lead | Denied (platform_owner only); as platform_owner succeeds + audit | RBAC denial + audit row |
| QA-AP-19 | Dark/light theme | Toggle theme | All pages re-theme via CSS vars; accent colors constant | Visual; `--bg` swaps |
| QA-AP-20 | Audit immutability | Attempt to edit/delete an audit row | Rejected; append-only | DB denies UPDATE/DELETE on `audit.*` |

(Minimum 15 required; 20 provided for admin scope. Inventory deduction / multi-currency split-tender are POS-scope and validated in the POS bible.)

---

## Part 16 — Go-Live Checklist

Use `[ ]`. Every item verifiable. (Mirrors the platform Go-Live, scoped to what the Admin Portal needs live.)

### 16.1 Infrastructure
- [ ] Supabase project `qneduoifcsvjajeqmvgb` (ap-southeast-1) reachable.
- [ ] All KitLuy migrations 01–08 applied **in order** by BE team.
- [ ] RLS enabled on every `kitluy.*` and `kitluy.admin.*` table; `platform_owner` policies verified.
- [ ] Read grants on `loyalty.*` confirmed (Rotanak-owned, read-only).
- [ ] All **22 edge functions** deployed and responding.
- [ ] Realtime channels live (dashboards, heartbeats, events).
- [ ] Telegram bot webhook configured + responding (per onboarded store).
- [ ] Cron jobs scheduled: daily alerts, weekly health, monthly billing/royalty, tab settlement.

### 16.2 Data & Config
- [ ] KitLuy team users created with correct roles (platform_owner / support_lead / operations).
- [ ] Plan catalog seeded: Commerce (៛30/store), Chain (៛100 + ៛50/store).
- [ ] Vertical enum seeded; Laundry active.
- [ ] At least one active subscriber + store visible in god-view.
- [ ] Service catalog (Laundry) visible with adoption metrics.

### 16.3 Hardware (monitored, not hosted)
- [ ] Each onboarded store's Hub registered in Device Registry + heartbeating.
- [ ] Terminals registered + firmware version captured.
- [ ] Spare Pi 5 stock recorded centrally (Het's team).

### 16.4 People
- [ ] HQ staff accounts provisioned; SSO Phone OTP tested.
- [ ] Roles assigned; permission matrix (§10.2) verified.
- [ ] SOPs (Part 14) printed/available.

### 16.5 Validation
- [ ] All QA-AP scenarios (Part 15) pass.
- [ ] Read-only Rotanak mirror renders with gold banner; write denied.
- [ ] Billing cron produces correct invoices in staging.
- [ ] Safety switch toggles (platform_owner) + audit logged.
- [ ] Dark/light mode verified across pages.

### 16.6 Pilot & Monitor
- [ ] Soft-launch: monitor Hub heartbeats + domain-event throughput for first stores.
- [ ] Daily reconciliation cadence established (invoices, audit review).
- [ ] Alert thresholds (§12.5) configured.

---

## Part 17 — Module / Feature Inventory

### 17.1 Build-by-Build Feature Table (Admin Portal)

15 sidebar groups → 45 routes. Capability → backing functions/tables.

| Sidebar group | Pages | Key backend |
|---|---|---|
| **Platform Overview** | Dashboard | aggregate reads; Realtime |
| **CRM** (KF-061) | Leads, Pipeline, Conversion | `kitluy.admin.leads`, `lead_activities` |
| **Subscribers** | All, Health & Rescue (KF-065), Plans, Upgrade (KF-068) | `kitluy.subscribers`, `subscriber_health_scores`, `kitluy-upgrade-workflow-start` |
| **Onboarding** (KF-062/069) | Workspace, Pipeline, Templates | `onboarding_workspaces`, `kitluy-onboarding-provision`, `activation_checkpoints` |
| **Store Network** | All Stores, Coverage, Benchmarks (KF-066) | `kitluy.stores`, Google Maps |
| **Fleet Ops** | Fleet & Hub Health, Firmware, Console (KF-063), Devices (KF-067) | `device_registry`, `device_actions`, `device_health_metrics`, `kitluy-device-heartbeat-ingest`, `terminal-firmware-push`, `hub-health-check` |
| **Platform Activity** | Throughput, Domain Events, Production, Logistics, Activation (KF-064) | `commerce.*` (read), `events.*`, `kitluy-activation-score-calc` |
| **Revenue & Billing** | SaaS Metrics, Invoices | `kitluy.invoices`, `subscriber-billing-cron`, `payway-purchase` |
| **Service Catalog** | Laundry Services | catalog (read) |
| **Loyalty (Read-Only)** | Tier Config, Opt-ins, Coin Activity | `loyalty.*` (Rotanak, read), loyalty events |
| **Platform Marketing** | Campaigns, AI Insights | `marketing-promo-engine`, `ai-campaign-runner`, `ai-subscriber-insights` |
| **Support Center** | Tickets & SLA, Evidence Log (KF-070) | tickets, `support_interventions` |
| **Platform Ops** | Audit, Edge Functions, Infrastructure, Safety Switches, Go-Live | `audit.*`, edge health |
| **Integrations** | Integration Hub | status of HSA/HSAL/PlantOS/PayWay/Supabase/Telegram |
| **Settings** | KitLuy Team, Platform Config | `core` users, config |

### 17.2 Feature-ID System

- Stable prefix **`KF-###`**. Phase-1 MVP laundry = `KF-001`–`KF-010`. Phase-2 Admin Portal = `KF-061`–`KF-070`:

| ID | Feature | Page home | QA |
|---|---|---|---|
| KF-061 | Merchant acquisition CRM + funnel | CRM | QA-AP (lead flow) |
| KF-062 | Zero-touch onboarding workspace | Onboarding > Workspace | QA-AP-03 |
| KF-063 | Fleet remote actions + observability | Fleet > Console | QA-AP-10 |
| KF-064 | Activation / time-to-value dashboard | Activity > Activation | — |
| KF-065 | Subscriber health + churn rescue | Subscribers > Health & Rescue | QA-AP-07/08 |
| KF-066 | Ops benchmark console | Stores > Benchmarks | — |
| KF-067 | Device assignment + lifecycle registry | Fleet > Devices | QA-AP-09 |
| KF-068 | Assisted migration / upgrade | Subscribers > Upgrade | QA-AP-17 |
| KF-069 | Guided self-onboarding templates | Onboarding > Templates | — |
| KF-070 | Remote support evidence log | Support > Evidence | QA-AP-10 |

(KF-LD-* laundry and KF-CF-* café feature prefixes exist at the vertical level; the Admin Portal uses plain `KF-###`.)

### 17.3 Mobile ↔ Web Parity Rules

The Admin Portal is **web-only**. There is no mobile form-factor pairing for it (unlike seller-portal ↔ seller-app or pos-desktop ↔ pos-mobile). HQ operates from desktop. If a mobile companion is ever introduced, it would be a new build with its own bible.

---

## Part 18 — Version History

| Version | Date | Author | Change Summary | Migrations Affected | Reconciliation Closed |
|---|---|---|---|---|---|
| v1.0.0 | 2026-03-28 | Het Sovannara | Initial Admin Portal Rebuild Bible. Covers Parts 0–18 + Appendices A–D. Baselined on wireframe v2.4.1 (45 routes, 15 groups, 22 edge functions, dark/light, read-only Rotanak loyalty). | 01–08 (baseline + admin delta) | RC-01, RC-02 (plan model + franchise type) closed in canon |

Wireframe lineage feeding this bible: v2.0.0 (HSA clone) → v2.1.x (platform-owner) → v2.2.0 (handbook align) → v2.3.x (dark mode) → v2.4.0 (KF-061→070) → v2.4.1 (loyalty mirror).

---
## Appendix A — Data Dictionary

The 8 most rebuild-critical Admin Portal tables, field-level.

### A.1 `kitluy.subscribers`
| Column | Type | Constraints | FK | Notes |
|---|---|---|---|---|
| id | uuid | PK | | `gen_random_uuid()`; display `SUB-###` |
| name | text | NOT NULL | | |
| owner_user_id | uuid | | auth.users.id | shared identity |
| plan | enum plan_type | NOT NULL, default `commerce` | | commerce \| chain |
| mode | enum mode_type | NOT NULL, default `a` | | a \| b \| c |
| status | enum sub_status | NOT NULL, default `onboarding` | | onboarding \| active \| grace \| suspended \| churned |
| has_franchise | boolean | NOT NULL, default false | | Chain feature flag |
| loyalty_opt | boolean | NOT NULL, default false | | Rotanak opt-in (Mode B/C) |
| trial_ends_at | timestamptz | NOT NULL | | `now()+14d` |
| email | text | | | |
| phone | text | | | E.164 |
| created_at | timestamptz | NOT NULL, default now() | | |

### A.2 `kitluy.stores`
| Column | Type | Constraints | FK | Notes |
|---|---|---|---|---|
| id | uuid | PK | | display `ST-###` |
| subscriber_id | uuid | NOT NULL | kitluy.subscribers.id | |
| name | text | NOT NULL | | |
| region | text | | | |
| vertical_type | enum vertical_type | NOT NULL, **IMMUTABLE** | | laundry\|cafe\|restaurant\|retail; trigger-locked |
| store_type | enum store_type | NOT NULL, default corporate | | corporate \| franchise |
| status | enum store_status | NOT NULL, default onboarding | | onboarding \| active \| suspended |
| created_at | timestamptz | NOT NULL | | |

### A.3 `kitluy.invoices`
| Column | Type | Constraints | FK | Notes |
|---|---|---|---|---|
| id | uuid | PK | | display `INV-YYYY-MM-###` |
| subscriber_id | uuid | NOT NULL | kitluy.subscribers.id | |
| plan | enum plan_type | NOT NULL | | |
| store_count | int | NOT NULL | | billed stores |
| saas_amount | bigint | NOT NULL | | KHR integer |
| tx_fees | bigint | NOT NULL, default 0 | | KHR integer |
| total | bigint | NOT NULL | | saas+tx |
| status | enum invoice_status | NOT NULL, default pending | | pending\|paid\|failed\|void |
| period | text | NOT NULL | | `YYYY-MM` |
| paid_date | timestamptz | nullable | | NULL until paid |

### A.4 `kitluy.admin.leads`
| Column | Type | Constraints | FK | Notes |
|---|---|---|---|---|
| id | uuid | PK | | display `LD-###` |
| name | text | NOT NULL | | |
| contact_name | text | | | |
| phone | text | | | E.164 |
| channel | text | | | acquisition source |
| stage | enum lead_stage | NOT NULL | | new\|qualified\|demo_scheduled\|negotiation\|won\|lost |
| score | int | NOT NULL, default 0 | | 0–100 |
| assignee_user_id | uuid | nullable | auth.users.id | |
| plan_intent | enum plan_type | | | |
| vertical_intent | enum vertical_type | | | |
| created_at | timestamptz | NOT NULL | | |

### A.5 `kitluy.admin.device_registry`
| Column | Type | Constraints | FK | Notes |
|---|---|---|---|---|
| id | uuid | PK | | display `DEV-###` |
| device_type | text | NOT NULL | | Hub\|T1-POS\|T3-KDS\|T4-DISP\|T5-QDS |
| model | text | | | |
| serial | text | UNIQUE NOT NULL | | |
| store_id | uuid | nullable | kitluy.stores.id | |
| subscriber_id | uuid | nullable | kitluy.subscribers.id | |
| status | enum device_status | NOT NULL | | active\|shipped\|rma\|retired |
| shipped_at | date | | | |
| warranty_until | date | | | |
| firmware | text | | | target v2.1.4 |

### A.6 `kitluy.admin.subscriber_health_scores` (Netra cache)
| Column | Type | Constraints | Notes |
|---|---|---|---|
| subscriber_id | uuid | PK, FK | |
| health_score | int | | 0–100 |
| churn_risk | int | | 0–100 |
| health_band | text | | excellent\|good\|at_risk\|new |
| drivers | jsonb | | Netra reasons |
| computed_at | timestamptz | | staleness |

### A.7 `kitluy.admin.activation_checkpoints` (KF-064)
| Column | Type | Notes |
|---|---|---|
| subscriber_id | uuid PK FK | |
| first_order | boolean | |
| catalog_done | boolean | |
| shift_closed | boolean | |
| loyalty_used | boolean | |
| telegram_bot | boolean | |
| days_to_value | int | computed |

### A.8 `audit.events` (immutable)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| actor_user_id | uuid FK | who |
| action | text | e.g. `plan.upgraded` |
| target | text | entity id+label |
| before | jsonb | snapshot |
| after | jsonb | snapshot |
| ip | inet | source |
| created_at | timestamptz | UTC |

**Enum quick reference:** plan_type{commerce,chain} · mode_type{a,b,c} · sub_status{onboarding,active,grace,suspended,churned} · vertical_type{laundry,cafe,restaurant,retail} · store_type{corporate,franchise} · store_status{onboarding,active,suspended} · invoice_status{pending,paid,failed,void} · lead_stage{new,qualified,demo_scheduled,negotiation,won,lost} · device_status{active,shipped,rma,retired}.

---

## Appendix B — FAQ (Reference, Not Rebuild-Critical)

### For Operators (HQ staff)
- **Can I change loyalty rules here?** No. Loyalty is read-only (Rotanak owns writes). Use the Rotanak Admin Portal. (Part 4.3, Part 9.2)
- **Can a store switch from Laundry to Café?** No. 1 store = 1 vertical, permanently. Create a new store. (Part 8.2)
- **Who can toggle a safety switch?** Only platform_owner. (Part 10.2)
- **Where do I see why a subscriber is at risk?** Subscribers > Health & Rescue; the drivers come from Netra. (Part 4.2)

### For Engineers
- **Does the Admin Portal hold the service-role key?** No. Only edge functions do. The SPA uses the anon key with `platform_owner` RLS. (Part 5.4, 6.4)
- **Is there an offline mode?** No. The Admin Portal is online-only. (Part 3.3)
- **How is money stored?** `bigint`, KHR integer, symbol `៛` (U+17DB). No decimals. (Part 8.4)
- **Where are migrations applied?** By the BE team only, in order 01–08. Never auto-apply. (Part 6.5)
- **Why is the Admin Portal a clone of HSA Admin?** Shared component DNA and design system across the ecosystem; only data context differs. (Part 5.1)

### For Investors
- **What is this?** The HQ cockpit for "Cambodia's Shopify" — where the SaaS business is run. (Part 2.1, Appendix D)
- **How does KitLuy make money?** SaaS subscriptions, 0% commission. Commerce ៛30/store/mo; Chain ៛100 + ៛50/store/mo. (Part 2.5)
- **What's the moat?** Local-first Pi Hub performance + ecosystem leverage (Netra AI, Rotanak coalition loyalty, HSAL logistics, shared identity). (Part 2.6)

---

## Appendix C — Reconciliation Register (Technical Debt)

Every open conflict, ambiguity, or deferred decision. **Nothing in Parts 1–18 contains an unresolved conflict** — all `⚠️` items live here.

| ID | Conflict / Gap | Affected Parts | Recommended Resolution | Owner | Target |
|---|---|---|---|---|---|
| RC-01 | Early wireframes used Starter/Business/Enterprise plans; canon is Commerce/Chain. | 2.5, 5.5, 6 | **Closed** — Commerce/Chain is canonical; old tiers permanently removed. | Het | v1.0.0 ✅ |
| RC-02 | "Franchise" treated as a subscriber type in early mock data; canon = Chain feature. | 1.3, 6.2, 8.1 | **Closed** — franchise is a Chain-plan feature (`store_type='franchise'`, `has_franchise`). | Het | v1.0.0 ✅ |
| RC-03 | Grace-window duration not finalized. | 8.7, 14.3 | Set explicit grace days (assume 7) + reminder cadence. | BE team | v1.1.0 |
| RC-04 | Churned-subscriber data retention window unspecified. | 8.7 | Define retention policy + purge job. | Het / legal | v1.1.0 |
| RC-05 | Netra/PayWay exact timeouts, backoff, and sandbox endpoints not captured. | 4.1, 4.2, 12.1 | BE team to document from secrets/runbook. | BE team | v1.1.0 |
| RC-06 | Backup/PITR cadence, log retention, and RPO/RTO numbers are placeholders. | 12.3, 13.1, 13.3 | Fill exact Supabase backup config + targets. | BE team | v1.1.0 |
| RC-07 | Admin Portal custom domain + token TTL not fixed. | 10.3, 11.5 | Set domain (e.g. `admin.kitluy.com.kh`) + session TTL. | BE team | v1.1.0 |
| RC-08 | Tax/VAT treatment stubbed. | 8.9 | Add `tax_amount` + `tax_policy` when formalized; no public compliance claims yet. | Het | v2.0.0 |
| RC-09 | CI/CD pipeline tool unspecified. | 5.1, 5.3 | Confirm (GitHub Actions assumed) + document deploy steps. | BE team | v1.1.0 |

This appendix is the punch list for the next version — not a crutch for this one.

---

## Appendix D — Investor / Stakeholder Narratives

**Clearly labeled NON-CRITICAL for reconstruction.**

**Pitch.** KitLuy is Cambodia's Shopify: a SaaS commerce + POS platform that lets any Cambodian SME — starting with laundromats — run a modern, offline-capable, loyalty-connected business on affordable Raspberry Pi hardware. The Admin Portal is the cockpit from which we operate the entire network: every subscriber, store, device, and dollar of recurring revenue in one god-view.

**Problem.** Cambodian SMEs are served either by cash-and-notebook operations or by expensive, internet-dependent foreign POS systems that don't speak Khmer, don't handle KHR properly, and have no local support. One-time-fee box products (e.g. POS-PRO) lock merchants into stale software with no ecosystem.

**Why we win.** (1) Local-first Pi Hub = the POS works even when the internet doesn't. (2) Ecosystem leverage — a shared AI brain (Netra), a coalition loyalty network (Rotanak) where coins move across every merchant, and shared logistics (HSAL) — none of which a single-box competitor can replicate. (3) 0% commission SaaS aligns us with merchant success. (4) Khmer-first everything.

**Traction (operated via this portal).** MRR, active subscribers, store network, and GMV are tracked live on the Platform Overview. Phase 1 is Laundry in Phnom Penh; Phase 2 adds Café, the merchant-acquisition CRM, zero-touch onboarding, and full fleet observability.

**Demo script.** Log in → Platform Overview (MRR, subscriber health, hub fleet) → open a subscriber (plan, stores, health, devices) → Fleet Console (remote-restart a Hub live) → Loyalty mirror (coalition coins, read-only from Rotanak) → SaaS Metrics (NRR, ARPU). The story: "this is the entire business on one screen."

**Ask.** [REQUIRED: fundraising ask — amount, use of funds, milestones.]

---

*End of KitLuy Admin Portal Rebuild Bible v1.0.0.*
