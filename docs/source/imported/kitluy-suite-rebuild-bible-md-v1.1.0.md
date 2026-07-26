# KitLuy Suite Rebuild Bible

**Version:** v1.1.0  
**Date:** 29 May 2026  
**Classification:** Canonical — KitLuy Swarm Approved + Founder Reconciliation  
**Authority:** KitLuy Swarm Multi-Agent Consensus, reconciled by Founder (Het Sovannara)  
**Rebuild Test Status:** VALIDATED  
**v1.1.0 changes:** Franchise layer brought into v1.0.0 scope (overrides Swarm R-5 deferral, per near-term franchise pipeline deal); six-product / six-build model added to Part 0 + Part 17. See Appendix C.6 and Part 18 changelog.

---

> **The Rebuild Test:** *"If every person who built KitLuy disappeared tomorrow, could a single engineer with zero prior context reconstruct the entire product, infrastructure, and business logic from this document alone?"*
>
> **Answer: Yes.**

---

**KitLuy** (ឃីត់លុយ — "estimate / count up") is Cambodia's unified commerce SaaS platform for SMEs. Built for Cambodian realities: KHR-native currency, Khmer-first UI, KHQR/Bakong-native payments, offline-first architecture for unreliable power and internet, and price sensitivity of a developing-market merchant.

**Scope:** MVP — Laundry (live foundation) + Café (active build) verticals. Franchise multi-tenant layer is **in scope** (see §5, §6, Appendix C.6). Six products across six builds (see Part 0, Part 17).

---

## Table of Contents

| Part | Title | Agent Authority |
|---|---|---|
| Part 0 | Rebuild Sequence | Architecture & Topology |
| Part 3 | System Architecture | Architecture & Topology |
| Part 4 | External Contracts | Architecture & Topology |
| Part 5 | Core Business Logic | Business Logic |
| Part 6 | Database Schema | **Schema Authority (Supreme Veto)** |
| Part 7 | Edge Function Specs | Implementation |
| Part 8 | Business Logic & Computation Rules | Business Logic |
| Part 9 | Design System | Implementation |
| Part 10 | Security & RBAC | Business Logic |
| Part 11 | Deployment & Infrastructure | Architecture & Topology |
| Part 15 | QA Matrix | QA Agent |
| Part 17 | Module Inventory | Implementation |
| Appendix C | Reconciliation Register | Schema Authority |

---

*This document was produced by the KitLuy Swarm — a multi-agent consensus process involving the Schema Authority, Architecture & Topology, Business Logic, Implementation, Consistency Auditor, Scope Critic, QA Agent, and Rebuild Auditor. All conflicts were resolved through the escalation chain defined in the Master Context.*

---


## Part 0: Rebuild Sequence

**Version:** v1.0.0  
**Authority:** Architecture & Topology Agent  
**Date:** 29 May 2026  
**Purpose:** Step-by-step reconstruction guide for a zero-context engineer. If every person who built KitLuy disappeared tomorrow, this is the only document needed to reconstruct the entire product, infrastructure, and business logic.

---

### 0.1 Prerequisites

Before touching any code or hardware, the following must be in hand.

#### 0.1.1 Hardware Procurement

| # | Item | Qty | Spec | Notes |
|---|---|---|---|---|
| 1 | Hub Server | 1 | Raspberry Pi 5 8GB + NVMe 128/256GB (M.2 HAT) | Local PostgreSQL replica + sync engine. See Master Context §8. |
| 2 | T1 Cashier Pi | 1 | Raspberry Pi 5 4GB + microSD 32GB + 80mm thermal printer (USB) | HDMI-1 → register screen; HDMI-2 → T2 CDS. |
| 3 | T3 KDS Pi | 1–3 | Raspberry Pi 5 4GB + microSD 32GB + printer per station | Multi-instance per prep station. 80mm thermal or label printer. |
| 4 | T4 DDS Pi | 1 | Raspberry Pi 5 4GB + microSD 32GB + 80mm printer | Expediter + packing list printer. |
| 5 | T5 QDS Pi | 1 | Raspberry Pi 5 4GB + microSD 32GB | Queue display. Independent Pi. |
| 6 | Enclosures | 5+ | Mesh-vent aluminum + copper heatsink + 3007 PWM blower | Rated 35°C+ ambient. Cambodian climate essential. |
| 7 | Screens | 5–7 | 1080p HDMI monitors, 15–22" | T1: 15–17"; T3: 22" per station; T4: 17"; T5: 32–43" wall-mounted |
| 8 | T2 CDS display | 1 | HDMI-capable customer-facing screen | DRIVEN FROM T1 HDMI-2. No separate Pi. |
| 9 | Networking | 1 set | 5-port Gigabit switch + Cat 5e/6 cables | Stable LAN between all terminals and Hub |
| 10 | Internet | 1 | 4G/5G modem or fiber uplink | WAN link: Hub ↔ Supabase. Single failure point. |
| 11 | Power | 1 set | UPS (600VA+) + surge protectors | Cambodia power grid is unreliable. Required. |

> **Café bundle total:** 5–7 Pi units + 5–7 screens + 3–5 printers.  
> **Laundry bundle total:** 3 Pi units (Hub/T1, T2 is HDMI-2 of T1, T4 only). No T3 or T5.

#### 0.1.2 Accounts & Access

| # | Requirement | How to Obtain | Needed By |
|---|---|---|---|
| 1 | Supabase account | https://supabase.com — sign up with HET org email | Phase 1 |
| 2 | ABA PayWay merchant account | Contact ABA Bank Business Banking | Phase 4 |
| 3 | Rotanak partner API key | Contact Rotanak platform team | Phase 4 |
| 4 | HSAL partner API key | Contact HSAL logistics platform | Phase 4 (café with delivery only) |
| 5 | Domain name (optional) | e.g., `seller.kitluy.com` via Cloudflare | Phase 4 |
| 6 | Telegram Bot token | Via @BotFather (for TMA future hook) | Phase 4 |

#### 0.1.3 Development Environment

| # | Tool | Version | Purpose |
|---|---|---|---|
| 1 | Node.js | LTS (20+) | Seller portal, admin portal |
| 2 | Deno | 1.40+ | Supabase Edge Functions |
| 3 | Supabase CLI | Latest | `supabase db push`, `supabase functions deploy` |
| 4 | Git | 2.40+ | Source control |
| 5 | Raspberry Pi Imager | Latest | Flash Pi 5 OS images |
| 6 | `sshpass` or SSH key | — | Headless Pi provisioning |

#### 0.1.4 Knowledge Prerequisites

This document assumes the reader knows:
- Basic PostgreSQL (`psql`, `CREATE TABLE`, `SELECT`, transactions)
- Basic Linux administration (`ssh`, `systemctl`, `apt`)
- Basic networking (IP addresses, DHCP, DNS, port forwarding)
- How to read JSON and SQL DDL

Everything else is defined herein.

---

### 0.2 Phase 1: Infrastructure — Cloud Database

**Goal:** A running Supabase project with all 13 migrations applied, auth configured, and RLS enabled.

**Estimated time:** 2 hours

#### SOP-INF-001: Provision Supabase Project

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Log in to https://app.supabase.io with HET org account | Dashboard loads | Reset password via email |
| 2 | Click "New Project" | Project creation form appears | — |
| 3 | Enter **Project Name:** `KitLuy Production` | Name accepted | — |
| 4 | Enter **Database Password:** 64-character random string (save in 1Password) | Password accepted (green check) | — |
| 5 | Select **Region:** `Southeast Asia (Singapore)` — `ap-southeast-1` | Region selected | This is mandatory. Do NOT select US regions. |
| 6 | Click "Create New Project" | Project provisions in 2–3 minutes | If stuck >10 min, refresh page; if still stuck, contact Supabase support |
| 7 | Note the **Project ID** (e.g., `qneduoifcsvjajeqmvgb`) | ID visible on project settings page | — |
| 8 | Go to Project Settings → API → note `anon` public key and `service_role` secret key | Keys displayed | Rotate keys if compromised |
| 9 | Go to Project Settings → Database → note connection string | String displayed with placeholder `[YOUR-PASSWORD]` | — |

**Expected result:** Supabase project running in `ap-southeast-1` with API keys in hand.

#### SOP-INF-002: Configure Authentication

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | In Supabase Dashboard, go to Authentication → Providers | Provider list loads | — |
| 2 | Enable **Phone** provider (OTP via SMS) | Phone toggle = ON | — |
| 3 | Set **SMS Provider:** choose provider (Twilio/MessageBird for Cambodia) | Provider configured | If OTP undelivered, verify phone format `+855XXXXXXXXX` |
| 4 | Disable **Email confirmations** (optional — phone OTP is primary) | Email toggle = OFF | — |
| 5 | Go to Authentication → Settings → set **Site URL** to seller portal domain (or `http://localhost:3000` for dev) | URL saved | — |
| 6 | Under "JWT Default," set JWT expiry to `3600` (1 hour) | Expiry saved | — |
| 7 | Enable **Row Level Security** globally warning banner is acknowledged | RLS acknowledged | All tenant-scoped tables MUST have RLS per Master Context §2 P7 |

#### SOP-INF-003: Apply Database Migrations

**CRITICAL:** Migrations MUST be applied in exact order 001–013. No skipping. No reordering. See Part 6, §6.5.1 for the canonical migration sequence.

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Clone the KitLuy repository locally | `git clone` succeeds | Verify repository access |
| 2 | `cd` into repo root | In repo directory | — |
| 3 | Run `supabase login` and authenticate with Supabase CLI | "Logged in" message | Re-run with `--token` flag if browser auth fails |
| 4 | Run `supabase link --project-ref qneduoifcsvjajeqmvgb` | Project linked | Verify project ID is correct |
| 5 | Run `supabase db push` | All migrations 001–013 applied in order | If any migration fails: STOP. Do not retry. Read error, fix, then re-run `supabase db push` |
| 6 | Verify migrations in Supabase Dashboard → Table Editor | All schemas (`cp`, `fin`, `pos`, `sal`, `menu`, `cafe`, `ops`, `core`) visible | If schema missing, check migration log |
| 7 | Run validation query from Part 6, §6.5.1 to verify FK integrity | All FK constraints present | If FK missing, migration was skipped |

**Migration order (from Part 6, §6.5.1):**

| Order | File | Schema | Tables / Objects |
|---|---|---|---|
| 1 | `001_cp_schema.sql` | `cp` | `tenants`, `accounts`, `tenant_memberships` |
| 2 | `002_fin_schema.sql` | `fin` | `companies` |
| 3 | `003_pos_core.sql` | `pos` | `stores`, `registers`, `shifts`, `sessions` |
| 4 | `004_pos_carts.sql` | `pos` | `carts`, `cart_lines` |
| 5 | `005_pos_tenders.sql` | `pos` | `tenders`, `tender_attempts` |
| 6 | `006_pos_offline_sync.sql` | `pos` | `offline_sync_batches`, `offline_sync_events` |
| 7 | `007_sal_documents.sql` | `sal` | `sales_invoices`, `receipts` |
| 8 | `008_menu_catalog.sql` | `menu` | `categories`, `items`, `price_history`, `item_modifier_groups` |
| 9 | `009_cafe_vertical.sql` | `cafe` | `modifier_groups`, `modifiers`, `recipes`, `ingredients`, `recipe_ingredients`, `tabs` |
| 10 | `010_ops_cafe.sql` | `ops` | `cafe_orders` |
| 11 | `011_deferred_fks.sql` | All | Cross-schema FKs (R-2, R-3, R-4 resolution) |
| 12 | `012_core_functions.sql` | `core` | Helper functions, RLS policies |
| 13 | `013_triggers.sql` | All | `updated_at` triggers, price history trigger |

**Rollback policy:** Migrations are forward-only. If a migration corrupts data, restore from the automatic Supabase daily backup. Do NOT write `DOWN` migrations.

---

### 0.3 Phase 2: Hub Server — On-Premises Brain

**Goal:** One Hub Server per store running local PostgreSQL replica, sync engine, and acting as LAN coordinator.

**Estimated time:** 3 hours per Hub

#### SOP-HUB-001: Image the Raspberry Pi 5 Hub

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Download **Raspberry Pi OS Lite (64-bit)** from https://downloads.raspberrypi.org/raspios_lite_arm64_latest/ | `.img.xz` file downloaded | Verify SHA-256 checksum |
| 2 | Insert NVMe SSD into M.2 HAT; attach to Pi 5 | Physical assembly complete | Check HAT seating if not detected |
| 3 | Use Raspberry Pi Imager to flash OS to NVMe | Flash completes successfully | Try alternative imager (BalenaEtcher) |
| 4 | Before first boot: create `ssh` file and `wpa_supplicant.conf` in `/boot/firmware/` | Headless SSH enabled on boot | If no WiFi, use Ethernet |
| 5 | Boot Pi 5 with NVMe. Find IP on LAN (check router DHCP table) | IP address visible (e.g., `192.168.1.100`) | Connect monitor + keyboard if IP not found |
| 6 | SSH in: `ssh pi@<IP>` default password `raspberry` | Shell prompt appears | — |
| 7 | Immediately run `sudo raspi-config` → Change password → Hostname: `kitluy-hub-{store_slug}` | Password changed, hostname set | — |
| 8 | Enable I2C, SPI, and serial interfaces: `sudo raspi-config` → Interface Options | All interfaces enabled | — |
| 9 | Run `sudo apt update && sudo apt full-upgrade -y` | All packages updated | If any package fails, retry individually |
| 10 | Install required packages: `sudo apt install postgresql-15 postgresql-contrib-15 redis-tools git htop tmux nginx -y` | All installed | Check `apt` cache if package not found |
| 11 | Configure PostgreSQL for local replica: edit `/etc/postgresql/15/main/postgresql.conf` | Config updated | See §11.3.1 for exact config values |
| 12 | Start PostgreSQL: `sudo systemctl enable postgresql && sudo systemctl start postgresql` | `active (running)` | Check `journalctl -xeu postgresql` |
| 13 | Create local DB: `sudo -u postgres createdb kitluy_local` | DB created | — |
| 14 | Verify: `sudo -u postgres psql -c "\l"` | `kitluy_local` visible in list | — |

#### SOP-HUB-002: Install Sync Engine

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Clone sync engine repo to `/opt/kitluy-sync` | Clone succeeds | — |
| 2 | Copy `.env.example` to `.env` and fill in: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STORE_ID`, `DEVICE_UUID` | `.env` populated | Get `STORE_ID` from `pos.stores` after Phase 4 seeding |
| 3 | Install Node.js 20 LTS: `curl -fsSL https://deb.nodesource.com/setup_20.x \| sudo -E bash - && sudo apt install -y nodejs` | Node v20.x installed | Use nvm if nodesource fails |
| 4 | `cd /opt/kitluy-sync && npm ci` | Dependencies installed | — |
| 5 | Run `npm run bootstrap` — pulls initial schema from cloud to local PostgreSQL | Local tables created matching cloud | Check Supabase connection if fails |
| 6 | Run `npm run sync:pull` — one-shot full sync from cloud | Data downloaded | — |
| 7 | Enable systemd service: `sudo systemctl enable kitluy-sync` | Service enabled | — |
| 8 | Start service: `sudo systemctl start kitluy-sync` | `active (running)` | Check `journalctl -u kitluy-sync -f` |
| 9 | Verify sync loop: `tail -f /var/log/kitluy-sync/sync.log` | Log shows `sync_cycle: success` every 30s | Check network connectivity to Supabase |

---

### 0.4 Phase 3: Terminals — T1 through T5

**Goal:** All terminals boot, pair to Hub, display correct role, and pass LAN connectivity tests.

**Estimated time:** 2 hours for café bundle (5–7 terminals)

#### SOP-TERM-001: Pair T1 Cashier Terminal

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash Pi 5 4GB microSD with Raspberry Pi OS Lite (64-bit) using Raspberry Pi Imager | Flash complete | — |
| 2 | Create `ssh` file in `/boot/firmware/` for headless access | SSH enabled | — |
| 3 | Boot T1 Pi. Find IP on LAN. | IP visible | Connect monitor if needed |
| 4 | SSH in. Change password. Set hostname: `kitluy-t1-{store_slug}` | Hostname set | — |
| 5 | Install POS Desktop App: `wget {release_url}/kitluy-pos-desktop-arm64.deb && sudo dpkg -i kitluy-pos-desktop-arm64.deb` | App installed | Use `apt --fix-broken install` if deps missing |
| 6 | Connect 80mm thermal printer via USB. Power on printer. | Printer LED solid green | Try different USB port if not detected |
| 7 | Run `lsusb` — verify printer appears (e.g., `EPSON TM-T88V`) | Printer in `lsusb` list | Install printer driver if generic not found |
| 8 | Connect HDMI-1 to cashier screen (1080p). HDMI-2 to T2 CDS screen. | Both screens detected in `xrandr` | Check cable seating |
| 9 | On first app launch, enter Hub Server IP. Click "Pair." | "Paired successfully" message | Check LAN connectivity: `ping <hub_ip>` |
| 10 | App auto-detects printer. Print test page. | Test receipt prints with store name | Check CUPS config if blank |
| 11 | Log in with owner account (created in Phase 4) | POS dashboard loads | Verify `cp.tenant_memberships` has owner role |
| 12 | Open shift: enter opening float (e.g., ៛200,000) | Shift opens, register ready | Check `pos.shifts` table if fails |

#### SOP-TERM-002: Configure T2 CDS (Customer Display System)

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | T2 is the HDMI-2 output of T1. No separate Pi. | Physical connection from T1 HDMI-2 to T2 screen | — |
| 2 | On T1 POS app, go to Settings → Display → Enable Customer Display | T2 screen shows KitLuy logo | Check HDMI cable if no signal |
| 3 | Start a test cart on T1. Add an item. | Item name + price appears on T2 facing customer | Verify `xrandr` shows HDMI-2 as connected |
| 4 | T2 auto-updates as cart changes. | Total updates in real-time on T2 | Restart T1 app if T2 frozen |
| 5 | When payment is processing, T2 shows QR code for KHQR scan (if applicable) | QR code rendered | Check `pos.tenders` for `aba_khqr` type |
| 6 | On payment success, T2 shows "Thank you" with amount paid | Confirmation displayed | — |

#### SOP-TERM-003: Pair T3 KDS Terminal (Kitchen Display System)

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T3 Pi 5 4GB microSD with OS Lite. Boot. Find IP. | T3 online | — |
| 2 | Set hostname: `kitluy-t3-{station_name}-{store_slug}` | Hostname set | — |
| 3 | Install KDS app (bundled with POS desktop release) | KDS app installed | — |
| 4 | Pair to Hub Server. Select "KDS" role. Select prep station (e.g., "Hot Drinks", "Cold Drinks", "Food") | Station assigned | Edit `pos.registers` row to change station |
| 5 | Connect printer (80mm thermal OR label printer) via USB | Printer detected | — |
| 6 | Print test cup sticker: item name, modifiers, `n/total`, QR code | Sticker prints legibly | Adjust DPI in printer settings |
| 7 | Create a test order on T1. Mark as paid. | Order appears on T3 KDS within 3 seconds | Check `ops.cafe_orders` row created |
| 8 | On T3, click "Start Preparing." Status changes. | `ops.cafe_orders.order_status` = `preparing` | Check sync engine logs |
| 9 | Click "Complete." Order moves to T4 DDS. | Status = `ready_for_pickup` | — |
| 10 | Verify cup sticker auto-prints with correct data | Sticker shows item + modifiers | Check printer queue with `lpstat` |

> **Note:** T3 is multi-instance. A café with 3 prep stations needs 3 T3 units, each paired independently with its own `pos.registers` row.

#### SOP-TERM-004: Pair T4 DDS Terminal (Digital Display System / Expediter)

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T4 Pi 5 4GB microSD. Boot. Find IP. | T4 online | — |
| 2 | Set hostname: `kitluy-t4-{store_slug}` | Hostname set | — |
| 3 | Install DDS app. Pair to Hub. Select "DDS" role. | App loads expediter view | — |
| 4 | Connect 80mm printer for packing list. | Printer ready | — |
| 5 | When T3 marks order "Complete," order appears on T4 with items listed. | Order visible on T4 screen | Check Realtime connection if delayed |
| 6 | T4 operator assigns slot number (1–20). | `ops.cafe_orders.slot_number` updated | Verify `slot_number` in database |
| 7 | T4 prints packing list: slot number, items, service mode, customer name | Packing list prints | Check CUPS if blank |
| 8 | If `service_mode = delivery`, T4 app auto-triggers HSAL booking | `hsal-booking-create` edge function fires | Check edge function logs in Supabase Dashboard |

#### SOP-TERM-005: Pair T5 QDS Terminal (Queue Display System)

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T5 Pi 5 4GB microSD. Boot. Find IP. | T5 online | — |
| 2 | Set hostname: `kitluy-t5-{store_slug}` | Hostname set | — |
| 3 | Install QDS app. Pair to Hub. Select "QDS" role. | Full-screen queue display loads | — |
| 4 | T5 subscribes to Supabase Realtime channel: `cafe:store:{store_id}` | WebSocket connection established | Check browser console for WS errors |
| 5 | When T4 assigns slot, slot number appears on T5 within 2 seconds. | Slot displayed with order number | Check Realtime channel payload |
| 6 | T5 shows: Now Serving slots + Preparing orders list | Two-section display visible | — |
| 7 | When order marked `served`, slot clears from T5. | Slot removed from display | — |
| 8 | T5 continues to work during WAN outage (LAN to Hub stays up) | Display updates from local cache | Verify Hub local replica has data |

---

### 0.5 Phase 4: Applications — Edge Functions & Portals

**Goal:** All edge functions deployed and tested. Seller portal accessible. End-to-end transaction passes.

**Estimated time:** 3 hours

**Software builds to reconstruct (six, per Part 17 §17.0):**

| # | Build | Platform | Build/deploy |
|---|---|---|---|
| 1 | `kitluy-admin-portal` | Web | `npm ci && npm run build` |
| 2 | `kitluy-chain-portal` | Web | `npm ci && npm run build` |
| 3 | `kitluy-seller-portal` | Web | `npm ci && npm run build` |
| 4 | `kitluy-seller-app` | Mobile (RN+Expo) | EAS Build → Play/App Store |
| 5 | `kitluy-pos-desktop-app` | Desktop (Electron/Pi 5) | `npm run package:arm64` → Pi image |
| 6 | `kitluy-pos-mobile-app` | Mobile (RN+Expo) | EAS Build → Play/App Store |

Plus the backend (`kitluy-edge-functions`, Deno), the Hub Server (`kitluy-hub-server`), and shared packages (`@kitluy/shared-ui`, `@kitluy/shared-utils`, `@kitluy/printer-driver`). Builds 3↔4 and 5↔6 are form-factor pairings (same logic, different shell — §17.0.1). The SOPs below cover the seller portal and the edge functions as the critical-path examples; the other four product builds follow the same deploy pattern for their platform.

#### SOP-APP-001: Deploy Edge Functions

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Ensure Deno 1.40+ installed: `deno --version` | Version printed | Install from https://deno.land |
| 2 | Ensure Supabase CLI linked to project | `supabase status` shows linked | Re-run `supabase link` |
| 3 | Run `supabase functions deploy` from repo root | All functions deploy successfully | If one fails, deploy individually |
| 4 | Set environment variables: `supabase secrets set ABA_PAYWAY_API_KEY=xxx ROTANAK_API_KEY=xxx HSAL_API_KEY=xxx` | Secrets set | Verify in Dashboard → Edge Functions → Secrets |
| 5 | Verify each function in Dashboard → Edge Functions | All functions show "Healthy" | Check logs for startup errors |
| 6 | Test `pos-cart-finalize` with curl: create cart, add line, finalize | Returns 200 with invoice ID | Check function logs for SQL errors |

#### SOP-APP-002: Configure Seller Portal

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` | Env vars loaded | — |
| 2 | Run `npm install` in `kitluy-seller-portal/` directory | Dependencies installed | Clear `node_modules` if stale |
| 3 | Run `npm run build` | Build succeeds with 0 errors | Fix TypeScript errors before proceeding |
| 4 | Deploy to Vercel/Netlify/self-hosted: `npm run deploy` | Live URL returned | Check build logs |
| 5 | Visit seller portal. Sign in with phone OTP. | Dashboard loads | Check browser network tab for CORS errors |
| 6 | Navigate to Menu → Items. Add a test item. | Item appears in `menu.items` table | Check RLS policy if 403 |
| 7 | Navigate to Register Management. Verify T1–T5 registers listed. | All registers visible | Check `pos.registers` has rows |

#### SOP-APP-003: End-to-End Transaction Test

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | On T1, open a shift | `pos.shifts` row created, `is_closed = false` | — |
| 2 | Create a cart. Add 2 items from `menu.items`. | `pos.carts` + `pos.cart_lines` rows created | — |
| 3 | Add modifiers (café vertical). | Modifier upcharges added to line total | — |
| 4 | Lock cart. Process cash tender for full amount. | `pos.tenders` row created, `tender_status = captured` | — |
| 5 | For café: verify `ops.cafe_orders` row auto-created | Row exists with `order_status = new` | Check `pos-cart-finalize` function log |
| 6 | On T3, order appears. Mark "preparing" then "complete." | `order_status` transitions correctly | — |
| 7 | On T4, order appears. Assign slot 5. | `slot_number = 5`, T5 updates | — |
| 8 | On T5, slot 5 appears in "Now Serving." | Slot visible | Check Realtime payload |
| 9 | Mark order "served" on T4. | T5 clears slot, `ops.cafe_orders.order_status = served` | — |
| 10 | Verify `sal.sales_invoices` and `sal.receipts` rows created | Invoice + receipt exist | — |
| 11 | Print receipt from T1. Reprint receipt (creates new `sal.receipts` row). | Two receipt rows, second has `receipt_status = reprinted` | — |
| 12 | Close shift. Verify Z-report. | `pos.shifts.is_closed = true`, `z_report_data` populated | — |
| 13 | Verify `pos.offline_sync_batches` has synced batch for today's events | At least one batch with `batch_status = synced` | Check sync engine if empty |

---

### 0.6 Phase 5: Go-Live — Merchant Onboarding

**Goal:** First real merchant is onboarded, first real transaction succeeds, monitoring is active.

**Estimated time:** 2 hours

#### SOP-GO-001: Onboard First Merchant

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | In admin portal, click "New Tenant" | Tenant form loads | — |
| 2 | Enter: `display_name`, `slug`, `billing_email`, `billing_phone`, `subscription_tier = starter` | Form validates | Slug must be URL-safe |
| 3 | Click "Create Tenant." | `cp.tenants` row inserted with UUID | — |
| 4 | Create owner account: phone number, display name. Send OTP. | `cp.accounts` row created, linked to `auth.users` | — |
| 5 | Create `cp.tenant_memberships` row: `tenant_id`, `account_id`, `membership_role = owner` | Membership created | — |
| 6 | Create `fin.companies` row for legal entity. | Company created | — |
| 7 | Create `pos.stores` row with `vertical_type = cafe` or `laundry` | Store created | — |
| 8 | Create `pos.registers` rows for T1–T5 (or T1/T2/T4 for laundry) | All registers created | — |
| 9 | Seed `menu.categories` and `menu.items` for the store | Items visible in seller portal | — |
| 10 | Seed `cafe.modifier_groups` and `cafe.modifiers` (cafe only) | Modifiers available on T1 | — |
| 11 | Physically install Hub Server at store location. Connect LAN + WAN. | Hub online, sync engine running | — |
| 12 | Pair T1–T5 terminals on-site following Phase 3 SOPs | All terminals operational | — |

#### SOP-GO-002: First Real Transaction

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Cashier opens shift on T1. | Shift active | — |
| 2 | Customer orders items. Cashier builds cart on T1. | Cart created | — |
| 3 | Customer pays via KHQR. Cashier selects "ABA KHQR" tender. | QR code generates on T2 (CDS) | Check ABA PayWay API connectivity |
| 4 | Customer scans QR with Bakong app. | Payment authorized | Check `pos.tender_attempts` for status |
| 5 | T1 shows "Payment Successful." | Cart status = paid | — |
| 6 | For café: T3 shows order. Kitchen prepares. | Operational flow begins | — |
| 7 | T4 assigns slot. T5 broadcasts. Customer picks up. | Order served | — |
| 8 | Receipt auto-prints on T1. | `sal.receipts` row created | — |
| 9 | Verify in seller portal: Sales → Invoices. Invoice visible. | Invoice listed with correct amount | — |
| 10 | Close shift. Z-report prints. | Day reconciled | — |

#### SOP-GO-003: Activate Monitoring

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | In Supabase Dashboard → Database → Health, enable alerts | Alerts configured | — |
| 2 | Set alert threshold: CPU > 80% for 5 min | Alert rule active | — |
| 3 | Set alert threshold: Disk > 85% | Alert rule active | — |
| 4 | Set alert threshold: Active connections > 80% of max | Alert rule active | — |
| 5 | On Hub: install `netdata` or `prometheus-node-exporter` | System metrics available | Use `htop` + cron if netdata fails |
| 6 | On Hub: configure log rotation for sync engine (`/var/log/kitluy-sync/`) | Logs rotate daily | — |
| 7 | Set up weekly `pg_dump` from Supabase to Hub for disaster recovery | Backup script in cron | Verify backup file size > 0 |

---

### 0.7 Troubleshooting Quick Reference

| Symptom | Likely Cause | Fix |
|---|---|---|
| T1 cannot pair to Hub | Hub firewall blocking port 5432 or 3000 | `sudo ufw allow 5432/tcp && sudo ufw allow 3000/tcp` |
| Sync engine stuck in `syncing` | WAN outage | Normal — will retry. Check `pos.offline_sync_batches` for queue depth. |
| T5 not updating | Realtime WebSocket disconnected | Check T5 browser console. Reconnects automatically. |
| KHQR payment timeout | ABA PayWay API down | Retry with exponential backoff (3×). Fall back to cash. |
| Printer prints garbage | Wrong driver/CUPS config | Re-run `lpadmin` with correct PPD file. |
| `pos.cart_lines` FK error | Ghost table reference (`pos.items` instead of `menu.items`) | Verify migration 008 applied. Check Part 6, §C.3. |
| Invoice not created after payment | `pos-cart-finalize` edge function failed | Check Supabase Functions Logs for error traceback. |
| Shift won't close | Open carts still linked to shift | Close or void all carts before closing shift. |
| T3 order not appearing | `ops.cafe_orders` row not created | Check if store `vertical_type = cafe`. Check edge function logs. |
| Duplicate `idempotency_key` | Client retry without new key | Ensure each request uses `[device_uuid]_[counter]_[timestamp]` format. |


---


---


## Part 3: System Architecture

**Version:** v1.0.0  
**Authority:** Architecture & Topology Agent  
**Date:** 29 May 2026  
**Cross-references:** Part 6 (canonical schema), Master Context §2 (primitives), §8 (hardware constants)

---

### 3.1 Architectural Overview

KitLuy is an **offline-first, hub-and-spoke POS system** designed for Cambodian SMEs operating in environments with unreliable power and internet. The architecture has three layers:

1. **Cloud Layer:** Supabase (PostgreSQL 17, Edge Functions, Auth, Realtime, Storage) — the system of record.
2. **Hub Layer:** One Raspberry Pi 5 8GB per store — the LAN coordinator, local PostgreSQL replica, and sync engine.
3. **Terminal Layer:** T1–T5 registers on Raspberry Pi 5 4GB units — the user-facing endpoints.

All writes flow **up:** Terminal → Hub → Supabase.  
All reads flow **down:** Supabase → Hub → Terminal.  
When WAN (internet) fails, the Hub buffers writes locally and replays them on reconnection.

---

### 3.2 LAN/WAN Topology

#### 3.2.1 Network Diagram

```
                              +-----------------------------+
                              |         INTERNET            |
                              |   (WAN — Failure Point)     |
                              +-------------+---------------+
                                            |
                                            | HTTPS/WSS
                                            |
                    +-----------------------v-----------------------+
                    |                                             |
                    |  SUPABASE CLOUD — ap-southeast-1            |
                    |  Project: qneduoifcsvjajeqmvgb              |
                    |                                             |
                    |  + PostgreSQL 17 (system of record)         |
                    |  + Edge Functions (Deno runtime)            |
                    |  + Auth (phone OTP)                         |
                    |  + Realtime (WebSocket broadcast)           |
                    |  + Storage (receipts, images)               |
                    |                                             |
                    +-----------------------^-----------------------+
                                            |
                             +--------------+--------------+
                             |   WAN Link (4G/5G/Fiber)    |
                             |   FAILURE POINT — buffered   |
                             +--------------+--------------+
                                            |
                                            | WireGuard VPN (optional)
                                            | or HTTPS direct
                              +-------------v---------------+
                              |                             |
                              |     HUB SERVER (Pi 5 8GB)   |
                              |     NVMe 128/256GB           |
                              |     kitluy-hub-{store}       |
                              |                             |
                              |  + Local PostgreSQL replica  |
                              |  + Sync Engine (Node.js)     |
                              |  + Redis (session cache)     |
                              |  + Nginx (reverse proxy)     |
                              |                             |
                              |  LAN Coordinator IP:         |
                              |  192.168.1.10 (static DHCP)  |
                              |                             |
                              +--^-----^-----^-----^-----^--+
                                 |     |     |     |     |
                    +------------+     |     |     |     +------------+
                    |  Stable LAN      |     |     |      Stable LAN |
                    |  (Gigabit switch)|     |     |                  |
         +----------+---+   +----------+-+ +-+------+----------+ +----v------+ +---v-------+
         |  T1 Cashier    |   |  T2 CDS     | |  T3 KDS (xN)    | |  T4 DDS   | |  T5 QDS   |
         |  (Pi 5 4GB)    |   |  (HDMI-2    | |  (Pi 5 4GB x    | |  (Pi 5    | |  (Pi 5    |
         |  + 80mm printer|   |   of T1)    | |   per station)  | |  4GB +    | |  4GB)     |
         |  + HDMI screen |   |  No Pi      | |  + printer      | |  printer) | |  Big      |
         |                |   |             | |                 | |           | |  screen   |
         |  POS Desktop   |   |  Customer-  | |  Kitchen app    | |  Expediter| |  Queue    |
         |  App (Electron)|   |  facing     | |  (Electron)     | |  app      | |  app      |
         |                |   |  display    | |                 | |  (React)  | |  (React)  |
         |  192.168.1.11  |   |  (mirrored  | |  192.168.1.12+ | | 192.168.  | | 192.168.  |
         |                |   |  HDMI)      | |                 | | 1.13      | | 1.14      |
         +----------------+   +-------------+ +-----------------+ +-----------+ +-----------+
```

#### 3.2.2 Network Rules

| # | Rule | Rationale |
|---|---|---|
| 1 | **LAN is stable.** All terminals can reach the Hub via Gigabit Ethernet at all times. | Mesh-vent enclosures + local switch. If LAN fails, terminals cannot operate. |
| 2 | **WAN is the failure point.** Internet (4G/5G/fiber) between Hub and Supabase is expected to fail. | Cambodia infrastructure reality. KitLuy is built for this. |
| 3 | **Hub has static LAN IP.** Hub is at `192.168.1.10` via DHCP reservation. | Terminals need a fixed address for pairing. |
| 4 | **Terminals use DHCP.** T1 = `.11`, T3 stations = `.12+`, T4 = `.13`, T5 = `.14` | Resolvable predictable addresses. |
| 5 | **No terminal talks directly to Supabase.** All cloud traffic goes through Hub. | Centralized offline buffering, single point of auth token management. |
| 6 | **T2 is not a network device.** T2 is HDMI-2 output of T1. No IP address. | Cost reduction: one Pi drives two screens. |
| 7 | **Hub may use WireGuard VPN** to Supabase for additional security (optional). | Encrypts WAN traffic. Fallback: HTTPS direct. |

#### 3.2.3 Failure Modes

| Failure | Detection | Behavior | Recovery |
|---|---|---|---|
| WAN down (Hub ↔ Supabase) | Sync engine ping timeout (> 10s) | Hub writes to local PostgreSQL. Batches created in `pos.offline_sync_batches`. Operations continue normally. | Sync engine retries every 30s. On reconnect, burst-syncs queued batches. |
| LAN down (terminal ↔ Hub) | Terminal ping to Hub timeout | Terminal app shows "Offline" banner. Read-only for cached data. Cannot create new carts. | Auto-reconnect when LAN restored. Resume normal operation. |
| Hub crash | All terminals lose connection | Terminals cannot operate. Show "Hub Offline" error. | Reboot Hub. Automatic recovery. Check NVMe health if recurring. |
| Terminal crash | Terminal unresponsive | Other terminals unaffected. Hub continues syncing. | Reboot terminal. Re-pair if needed. |
| Supabase outage | All Hubs show sync failures globally | All stores operate in offline mode. Buffers grow. No cloud data loss. | Supabase recovers. All Hubs burst-sync simultaneously. |

---

### 3.3 Terminal Types (T1–T5)

Each terminal is a row in `pos.registers` with a specific `register_type`. The hardware and software configuration differ per type. See Part 6, §6.3 enum `register_type` for the canonical values: `t1_cashier`, `t2_cds`, `t3_kds`, `t4_dds`, `t5_qds`.

#### 3.3.1 Hardware Matrix

| Register | Hardware | Storage | Screen | Printer | Network | OS / App |
|---|---|---|---|---|---|---|
| **T1** Cashier | Pi 5 4GB | microSD 32GB | HDMI-1: 15–17" register | 80mm thermal USB | Ethernet to LAN | Raspberry Pi OS Lite 64-bit + Electron POS Desktop App |
| **T2** CDS | None (uses T1) | N/A | HDMI-2: customer-facing 15–22" | None | None (driven by T1) | Rendered by T1 app on secondary display |
| **T3** KDS | Pi 5 4GB | microSD 32GB | 22" per station | 80mm thermal OR label | Ethernet to LAN | Raspberry Pi OS Lite 64-bit + Electron KDS App |
| **T4** DDS | Pi 5 4GB | microSD 32GB | 17" expediter | 80mm thermal (packing list) | Ethernet to LAN | Raspberry Pi OS Lite 64-bit + React DDS App |
| **T5** QDS | Pi 5 4GB | microSD 32GB | 32–43" wall-mounted | None | Ethernet to LAN | Raspberry Pi OS Lite 64-bit + React QDS App (fullscreen) |
| **Hub** | Pi 5 8GB | NVMe 128/256GB | Headless (optional) | None | Ethernet to LAN + WAN | Raspberry Pi OS Lite 64-bit + PostgreSQL + Node.js sync |

#### 3.3.2 T1 Cashier Terminal

**Role:** The primary order entry point. Cashier builds carts, processes tenders, opens/closes shifts.

```
T1 Physical Layout:
+--------------------------+--------------------------+
|   HDMI-1: Cashier Screen |   HDMI-2: T2 CDS Screen |
|   (T1 operator faces)    |   (Customer faces)       |
|                          |                          |
|  +--------------------+  |  +--------------------+  |
|  | KitLuy POS Desktop |  |  | Order Total:       |  |
|  |                    |  |  | KHR24,000          |  |
|  | Menu Grid          |  |  | 2x Iced Latte      |  |
|  | Cart Panel         |  |  | +Extra Shot        |  |
|  | Tender Buttons     |  |  |                    |  |
|  +--------------------+  |  | [QR Code for KHQR] |  |
|                          |  +--------------------+  |
|   [80mm Printer] — USB   |   (mirrored from HDMI-2) |
+--------------------------+--------------------------+
         |  Raspberry Pi 5 4GB  |
         +----------------------+
```

**Data flow:**
1. Cashier opens shift → INSERT `pos.shifts` (via Hub, syncs to cloud)
2. Cashier starts cart → INSERT `pos.carts` with `cart_status = 'open'`
3. Cashier adds items → INSERT `pos.cart_lines` referencing `menu.items` (Part 6, §6.2.5)
4. Cashier locks cart → UPDATE `pos.carts.cart_status = 'locked'`
5. Cashier processes tender → INSERT `pos.tenders` + `pos.tender_attempts`
6. Payment succeeds → UPDATE `pos.carts.cart_status = 'paid'`
7. Edge function fires → INSERT `sal.sales_invoice`, `sal.receipts`
8. For café: edge function fires → INSERT `ops.cafe_orders` (Part 6, §6.2.7)

**T2 CDS (Customer Display System):**
- No separate Pi. HDMI-2 output of T1.
- Shows: cart total, item list, payment QR code (KHQR), payment status.
- Electron app detects dual displays via `electron.screen.getAllDisplays()` and renders CDS on secondary monitor.
- T2 has no `pos.registers` row of its own; it is a display mode of T1.

#### 3.3.3 T3 KDS Terminal (Kitchen Display System)

**Role:** One per prep station. Displays orders to kitchen staff. Prints cup stickers.

```
T3 Layout (per station):
+---------------------------------------+
|  KitLuy KDS — "Hot Drinks" Station    |
|                                       |
|  +--------+ +--------+ +--------+     |
|  |ORDER   | |ORDER   | |ORDER   |     |
|  |#104    | |#105    | |#106    |     |
|  |        | |        | |        |     |
|  |2x Latte| |1x Cap  | |3x AM    |     |
|  |+Extra  | |-No Sug | |+Oat   |     |
|  |        | |        | |        |     |
|  |[START] | |[START] | |[START] |     |
|  +--------+ +--------+ +--------+     |
|                                       |
|  [Label Printer — Cup Stickers]       |
+---------------------------------------+
```

**Data flow:**
1. Listens for new `ops.cafe_orders` rows with `assigned_station = {station_name}`
2. Cashier (T1) or kitchen manager assigns station on order creation
3. Kitchen staff clicks "Start Preparing" → UPDATE `ops.cafe_orders.order_status = 'preparing'`
4. Kitchen staff clicks "Complete" → UPDATE `ops.cafe_orders.order_status = 'ready_for_pickup'`
5. On complete: auto-print cup sticker (item name, modifiers, `n/total`, QR code)
6. T3 does NOT write to `pos.carts`. It only writes to `ops.cafe_orders`.

**Multi-instance:** A café with Hot Drinks, Cold Drinks, and Food has 3 T3 units, each with its own `pos.registers` row, each filtering by `assigned_station`.

#### 3.3.4 T4 DDS Terminal (Digital Display System / Expediter)

**Role:** Expediter view. Shows ready orders. Assigns slot numbers. Prints packing lists. Triggers delivery booking.

```
T4 Layout:
+-----------------------------------------------+
|  KitLuy DDS — Expediter Station               |
|                                               |
|  NOW SERVING:    Slot 5  | Slot 3  | Slot 8   |
|  (Ready orders)  #104    | #107    | #112     |
|                                               |
|  PREPARING:      #105 (Hot) | #106 (Cold)     |
|                                               |
|  +-----------------------------------------+  |
|  | Order #104: 2x Iced Latte +Extra Shot   |  |
|  |             1x Cappuccino               |  |
|  | Customer: Sopheap | Mode: Dine-in        |  |
|  |                                         |  |
|  | Assign Slot: [ 1 ] [ 2 ] ... [ 20 ]    |  |
|  | [Print Packing List]  [Mark Served]      |  |
|  +-----------------------------------------+  |
|                                               |
|  [80mm Printer — Packing Lists]               |
+-----------------------------------------------+
```

**Data flow:**
1. Subscribes to `ops.cafe_orders` WHERE `order_status = 'ready_for_pickup'`
2. Expediter selects order, clicks slot number (1–20) → UPDATE `slot_number`
3. Broadcast via Supabase Realtime channel `cafe:store:{store_id}` (§3.5)
4. Prints packing list: slot number, items, service mode, customer name
5. If `service_mode = delivery` → fires `hsal-booking-create` edge function (Part 4, §4.4)
6. Customer picks up → UPDATE `ops.cafe_orders.order_status = 'served'`
7. Fires Rotanak earn → fires `cafe-order-complete` edge function

#### 3.3.5 T5 QDS Terminal (Queue Display System)

**Role:** Customer-facing queue display. Shows "Now Serving" slots and "Preparing" list. Independent Pi with large wall-mounted screen.

```
T5 Layout (Fullscreen):
+-----------------------------------------------------+
|                                                     |
|           KITLUY — NOW SERVING                      |
|                                                     |
|   +--------+  +--------+  +--------+  +--------+   |
|   | SLOT 3 |  | SLOT 5 |  | SLOT 8 |  | SLOT 12|   |
|   | #107   |  | #104   |  | #112   |  | #115   |   |
|   | READY  |  | READY  |  | READY  |  | READY  |   |
|   +--------+  +--------+  +--------+  +--------+   |
|                                                     |
|  +------------------------------------------------+ |
|  | PREPARING: #105, #106, #110, #113, #118        | |
|  +------------------------------------------------+ |
|                                                     |
+-----------------------------------------------------+
```

**Data flow:**
1. Subscribes to Supabase Realtime channel `cafe:store:{store_id}` (§3.5)
2. T4 slot assignment broadcasts → T5 updates "Now Serving" grid
3. T3 status changes broadcast → T5 updates "Preparing" list
4. Order marked `served` → slot removed from display
5. **Offline resilient:** T5 reads from Hub local replica via REST. Realtime is best-effort; on disconnect, T5 polls Hub every 5 seconds.

---

### 3.4 Offline-First Protocol

#### 3.4.1 Design Principles

Per Master Context §2 P3: The Hub Server is the LAN coordinator. Operations continue during internet outages.

1. **LAN always works.** Terminals read from and write to the Hub's local PostgreSQL replica.
2. **WAN may fail.** When it does, the Hub buffers changes locally.
3. **No data is lost.** Every terminal write is captured in `pos.offline_sync_events`.
4. **Conflict resolution is deterministic.** Same input + same state = same output on all devices.
5. **Reconnection is automatic.** The sync engine detects WAN restoration and burst-syncs.

#### 3.4.2 Offline Sync Tables

The sync protocol uses two tables defined in Part 6, §6.2.3:

**`pos.offline_sync_batches`** — The sync envelope.

| Column | Purpose |
|---|---|
| `id` | Batch UUID |
| `tenant_id` | Scoped to tenant (Part 6, §6.1.2) |
| `store_id` | Which store generated this batch |
| `device_uuid` | Hub Server hardware identifier |
| `batch_status` | `pending` → `syncing` → `synced` / `conflict` / `error` / `partial` |
| `event_count` | Total events in this batch |
| `synced_count` | Successfully synced |
| `conflict_count` | Events with conflicts requiring resolution |
| `error_count` | Events that failed permanently (need human intervention) |
| `started_at`, `completed_at` | Sync timing |
| `error_log` | Array of error details |

**`pos.offline_sync_events`** — Individual events within a batch.

| Column | Purpose |
|---|---|
| `id` | Event UUID |
| `batch_id` | Parent batch FK |
| `event_type` | `cart_create`, `cart_update`, `tender_create`, `shift_open`, etc. (Part 6, §6.3 enum `sync_event_type`) |
| `event_status` | `pending` → `synced` / `conflict` / `error` |
| `table_name` | Target table (e.g., `pos.carts`) |
| `record_id` | UUID of the affected row |
| `payload` | Full row data as JSON at time of capture |
| `conflict_info` | Server-side values when conflict detected |
| `idempotency_key` | `[device_uuid]_[counter]_[timestamp]` — prevents duplicates (Master Context §2 P9) |
| `processed_at` | When server processed this event |

#### 3.4.3 Sync Event Lifecycle

```
Terminal App               Hub Local DB               Sync Engine              Supabase Cloud
     |                           |                           |                        |
     |-- 1. Write cart -------->|                           |                        |
     |                           |-- 2. INSERT pos.carts --->|                        |
     |                           |-- 3. INSERT sync_event ->|                        |
     |<-- 4. Ack ---------------|                           |                        |
     |                           |                           |                        |
     |                           |                           |-- 5. Check WAN ------->|
     |                           |                           |   (ping every 30s)     |
     |                           |                           |                        |
     |                           |                           |<-- 6a. Online: sync ---|
     |                           |                           |   (push events)        |
     |                           |<-- 6b. Mark synced -------|                        |
     |<-- 7. Cloud confirms ----| (via Realtime or poll)    |                        |
     |                           |                           |                        |
     |                           |                           |<-- 6c. Offline: buffer-|
     |                           |                           |   (retry in 30s)       |
     |                           |                           |                        |
     |                           |                           |-- 8. WAN restored ---->|
     |                           |                           |<-- 9. Burst sync all -|
     |                           |<-- 10. Mark synced -------|   pending batches      |
     |<-- 11. Cloud confirms ----|                           |                        |
```

#### 3.4.4 Conflict Resolution Strategy

When the sync engine pushes an event and Supabase reports a conflict, the following rules apply:

| Conflict Type | Rule | Example |
|---|---|---|
| **Same-row, same-field update** | Last-write-wins for **non-financial** data. First-write-wins for **financial** data. | Two cashiers edit `menu.items.is_available` → last change wins. Two cashiers edit `pos.carts.grand_total` → first change wins, second is rejected. |
| **Duplicate idempotency key** | Event is silently discarded. | Cashier retries tender; same key = same result, no double-charge. |
| **FK violation (target row missing)** | Event queued for retry. If still failing after 3 retries → `error` status, alert admin. | Cart references deleted item → event errors, needs manual review. |
| **Cart status transition invalid** | Rejected. Valid transitions only: `open → locked → paid → refunded`. | Attempt to `lock` an already `paid` cart → rejected. |
| **Financial document already exists** | Silently succeed (idempotent). | Invoice already created for this cart → no-op. |

**Conflict resolution flow:**

```
+----------+     +----------------+     +-------------------+     +-----------+
|  Event   | --> |  Push to Cloud  | --> |  Conflict?        | --> |  Resolved |
|  Pending |     |  (HTTPS POST)   |     |                   |     |           |
+----------+     +----------------+     +-------------------+     +-----------+
                                               |
                              +----------------v----------------+
                              |  YES → Determine conflict type   |
                              |                                  |
                              |  1. Financial? → first-write-wins|
                              |  2. Non-financial? → compare ts  |
                              |  3. Idempotency dup? → discard   |
                              |  4. FK violation? → retry x3     |
                              |  5. Status invalid? → reject     |
                              |                                  |
                              |  Store resolution in:            |
                              |  `pos.offline_sync_events`       |
                              |  `.conflict_info`                |
                              +----------------------------------+
```

#### 3.4.5 Reconnection Burst Handling

When WAN comes back after an outage:

1. Sync engine detects connectivity (successful HTTPS ping to Supabase in < 5s)
2. Query `pos.offline_sync_batches` WHERE `batch_status = 'pending'` ORDER BY `created_at`
3. Process oldest batch first (maintain causal order)
4. Send events in batches of 50 per HTTP request (avoid payload size limits)
5. For each event:
   - If `idempotency_key` already exists in cloud → mark `synced`, skip
   - If conflict → apply resolution strategy above
   - If success → mark `synced`
6. Update `pos.offline_sync_batches`: `synced_count`, `conflict_count`, `error_count`, `batch_status`
7. If all events in batch synced → `batch_status = 'synced'`
8. If some conflicts → `batch_status = 'conflict'`
9. If some errors → `batch_status = 'partial'`
10. Emit Realtime event to all terminals: `sync:complete` with batch summary

**Burst rate limit:** Max 10 HTTP requests per second to Supabase Edge Functions during burst. This prevents overwhelming the cloud on mass reconnection (e.g., after a regional internet outage affecting hundreds of stores).

---

### 3.5 Sync Engine Specification

#### 3.5.1 Sync Directions

| Direction | Trigger | What | Frequency | Retry Logic |
|---|---|---|---|---|
| **Hub → Cloud (upstream)** | Any local write | `pos.carts`, `pos.cart_lines`, `pos.tenders`, `pos.shifts`, `pos.sessions`, `ops.cafe_orders` | Continuous (event-driven) | Exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s (fixed). Max 10 retries. |
| **Cloud → Hub (downstream)** | Schema changes, master data updates | `menu.items`, `menu.categories`, `cafe.modifier_groups`, `cafe.modifiers`, `cafe.ingredients`, `cp.accounts`, `pos.registers` | Every 60s (pull) + Realtime push | Same as upstream |
| **Full sync** | Hub boot, manual trigger | Complete snapshot of all tenant-scoped data | On boot + daily at 03:00 | Single attempt; alert on failure |
| **Receipt/image sync** | Receipt created | `sal.receipts` + image files to Supabase Storage | Event-driven, async | 3 retries, 5s apart |

#### 3.5.2 Sync Engine Configuration

```json
{
  "hub": {
    "device_uuid": "hub-pi5-8gb-001",
    "store_id": "uuid-from-pos.stores",
    "tenant_id": "uuid-from-cp.tenants",
    "lan_ip": "192.168.1.10",
    "postgres_local_url": "postgresql://localhost:5432/kitluy_local"
  },
  "cloud": {
    "supabase_url": "https://qneduoifcsvjajeqmvgb.supabase.co",
    "supabase_service_role_key": "env_var",
    "region": "ap-southeast-1"
  },
  "sync": {
    "upstream_poll_interval_ms": 1000,
    "downstream_pull_interval_ms": 60000,
    "wan_check_interval_ms": 10000,
    "burst_batch_size": 50,
    "burst_rate_limit_rps": 10,
    "max_retry_attempts": 10,
    "retry_backoff_base_ms": 1000,
    "full_sync_cron": "0 3 * * *"
  },
  "offline": {
    "max_batch_age_hours": 168,
    "batch_prune_cron": "0 4 * * *",
    "alert_on_batch_age_hours": 24
  }
}
```

#### 3.5.3 What Happens When WAN Comes Back

```
WAN Down                          WAN Restored
   |                                    |
   v                                    v
+------+      +--------+      +-------------+
|Sync  |      |Buffer  |      |Detect: ping |
|Engine|      |Growing |      |success <5s  |
|loops |----->|in local|      +------+------+
|every |      |PostgreSQL    |             |
|30s   |      |         |             v
+------+      +--------+      +-------------+
                                |Query pending|
                                |batches ASC  |
                                +------+------+
                                       |
                                       v
+--------------------------------------v-------+
| For each pending batch:                      |
|   1. Read events (oldest first)             |
|   2. POST /functions/v1/sync-batch          |
|   3. For each event in response:            |
|      - synced → update local status         |
|      - conflict → apply resolution rule     |
|      - error → log, alert if >3 errors      |
|   4. Update batch summary                   |
|   5. If batch complete → next batch         |
+----------------------------------------------+
```

**Terminal notification:** When sync completes, the Hub emits a local WebSocket message to all terminals: `{ type: 'sync:complete', batch_id: '...', synced: N, conflicts: M }`. Terminals show a brief "Synced" toast.

---

### 3.6 Real-Time Communication

#### 3.6.1 Supabase Realtime Channels

KitLuy uses Supabase Realtime for sub-second broadcast from T4 (expediter) to T5 (queue display), and for downstream sync notifications.

| Channel Pattern | Purpose | Publishers | Subscribers |
|---|---|---|---|
| `cafe:store:{store_id}` | Slot assignment broadcast from T4 to T5 | T4 DDS | T5 QDS |
| `sync:store:{store_id}` | Sync status notifications from Hub to all terminals | Hub | T1, T3, T4, T5 |
| `order:store:{store_id}` | Order status changes for operational visibility | T3 KDS, T4 DDS | T1 (manager view) |

#### 3.6.2 T4 → T5 Broadcast Protocol

When T4 assigns a slot to a ready order, the following Realtime message is broadcast:

```json
{
  "event": "slot_assigned",
  "payload": {
    "order_id": "uuid-from-ops.cafe_orders",
    "cart_id": "uuid-from-pos.carts",
    "slot_number": 5,
    "order_number": "104",
    "customer_name": "Sopheap",
    "service_mode": "dine_in",
    "items": [
      { "name": "Iced Latte", "qty": 2, "modifiers": ["Extra Shot"] }
    ],
    "assigned_at": "2026-05-29T14:32:00+07:00",
    "store_id": "uuid-from-pos.stores"
  }
}
```

T5 subscribes to channel `cafe:store:{store_id}` and updates its display when this message arrives.

When the order is marked `served`:

```json
{
  "event": "order_served",
  "payload": {
    "order_id": "uuid",
    "slot_number": 5,
    "served_at": "2026-05-29T14:35:00+07:00"
  }
}
```

T5 removes the slot from "Now Serving."

#### 3.6.3 Fallback: Polling

If Realtime WebSocket disconnects (WAN outage or Supabase Realtime maintenance), T5 falls back to polling the Hub's local API:

```
GET http://192.168.1.10:3000/api/orders/ready?store_id={store_id}
```

Response:
```json
{
  "orders": [
    { "order_id": "...", "slot_number": 5, "order_number": "104", ... }
  ]
}
```

Poll interval: 5 seconds. When Realtime reconnects, polling stops.

---

### 3.7 Hardware Specifications

#### 3.7.1 Hardware Constants (from Master Context §8)

| Component | Specification | Notes |
|---|---|---|
| **Hub Server** | Raspberry Pi 5 8GB LPDDR4X RAM + NVMe 128/256GB (M.2 HAT) | Runs local PostgreSQL 15+ replica, sync engine, Redis, Nginx. Headless operation. |
| **T1 Cashier** | Raspberry Pi 5 4GB LPDDR4X RAM + microSD 32GB Class A2 + 80mm thermal printer (USB) | HDMI-1: cashier screen. HDMI-2: T2 CDS. Both displays driven by single Pi. |
| **T2 CDS** | HDMI-2 output of T1 | No separate compute. Dumb display only. Customer-facing. |
| **T3 KDS** | Raspberry Pi 5 4GB + microSD 32GB Class A2 + printer (80mm thermal OR 58mm label) | One per prep station. Multi-instance. Label printer for cup stickers. |
| **T4 DDS** | Raspberry Pi 5 4GB + microSD 32GB Class A2 + 80mm thermal printer | Expediter view + packing list printer. |
| **T5 QDS** | Raspberry Pi 5 4GB + microSD 32GB Class A2 | Queue display. Independent Pi. Large wall-mounted screen (32–43"). |
| **Enclosure** | Mesh-vent aluminum chassis + copper heatsink + 3007 PWM blower | Rated for 35°C+ ambient. Essential for Cambodian climate. |
| **LAN** | 5-port unmanaged Gigabit switch + Cat 5e/6 cables | All devices on same broadcast domain. Hub at static IP. |
| **WAN** | 4G/5G USB modem or fiber ONU | Single uplink. Failure point per §3.2.3. |
| **Power** | 600VA+ UPS + surge protectors | Required. Cambodian power grid has frequent outages. |

#### 3.7.2 Hub Server Detailed Spec

```
+----------------------------------------------------+
|  Raspberry Pi 5 8GB (Hub Server)                   |
|  +----------------------------------------------+  |
|  |  CPU: BCM2712, quad-core Cortex-A76 @ 2.4GHz |  |
|  |  RAM: 8GB LPDDR4X                            |  |
|  |  Storage: NVMe 128/256GB via M.2 HAT+        |  |
|  |  Network: Gigabit Ethernet (RJ45)            |  |
|  |  USB: 2x USB 3.0 (for modem, backup)         |  |
|  |  Power: 5V/5A USB-C (27W)                    |  |
|  +----------------------------------------------+  |
|                                                    |
|  Software Stack:                                   |
|  +----------------------------------------------+  |
|  |  OS: Raspberry Pi OS Lite (64-bit, Debian    |  |
|  |      Bookworm-based)                          |  |
|  |  DB: PostgreSQL 15 (local replica)            |  |
|  |  Cache: Redis 7 (sessions, rate limiting)     |  |
|  |  Sync: Node.js 20 + kitluy-sync engine        |  |
|  |  Proxy: Nginx (TLS termination, static)       |  |
|  |  Monitoring: netdata or custom healthcheck    |  |
|  +----------------------------------------------+  |
+----------------------------------------------------+
```

#### 3.7.3 Thermal Design

Cambodia ambient temperatures regularly exceed 35°C. The enclosure design is non-negotiable.

| Component | Specification | Why |
|---|---|---|
| Chassis | Mesh-vent aluminum | Passive airflow, heat dissipation |
| Heatsink | Copper, full-size, attached to SoC | Thermal conductivity |
| Blower | 3007 PWM (30mm × 30mm × 7mm), temperature-controlled | Active cooling when SoC > 70°C |
| Thermal throttle | SoC throttles at 85°C | With this design, max sustained ~75°C at 40°C ambient |
| Placement | Vertically mounted, vents unobstructed | Critical — do not stack, do not enclose in cabinets |

---

### 3.8 Data Flow Summary

#### 3.8.1 Order Lifecycle (Café Vertical)

```
Customer                T1 Cashier              Hub Local DB            Supabase Cloud
   |                        |                        |                        |
   |-- "2 lattes" -------->|                        |                        |
   |                        |-- CREATE pos.carts --->|                        |
   |                        |-- CREATE pos.cart_lines->                       |
   |                        |   (refs menu.items)    |                        |
   |                        |                        |-- sync event --------->|
   |                        |                        |   (if WAN up)          |
   |                        |                        |                        |
   |-- "pay by KHQR" ----->|                        |                        |
   |                        |-- CREATE pos.tenders ->|                        |
   |                        |   type=aba_khqr        |                        |
   |                        |-- CREATE tender_attempt>|                        |
   |                        |                        |-- KHQR API call ------>|-- ABA PayWay API
   |<-- QR code on T2 -----|                        |                        |   (Part 4, §4.1)
   |   (scan with Bakong)   |                        |                        |
   |                        |                        |<-- payment confirmed --|
   |                        |<-- tender status=auth --|                        |
   |                        |-- UPDATE cart=paid ---->|                        |
   |                        |                        |-- sync event --------->|
   |                        |                        |-- INSERT invoice ----->|
   |                        |                        |   (sal.sales_invoices) |
   |                        |                        |                        |
   |                        |                        |-- INSERT ops.cafe_orders|
   |                        |                        |   (Part 6, §6.2.7)     |
   |<-- receipt printed ----|                        |                        |
   |                        |                        |                        |
   |                        |                        |     T3 KDS              |
   |                        |                        |     (kitchen)           |
   |                        |                        |<-- order appears -------|
   |                        |                        |-- UPDATE preparing --->|
   |                        |                        |-- UPDATE ready --------|
   |                        |                        |                        |
   |                        |                        |     T4 DDS              |
   |                        |                        |     (expediter)         |
   |                        |                        |<-- ready order --------|
   |                        |                        |-- UPDATE slot=5 ------->|
   |                        |                        |-- Realtime broadcast -->|-- T5 QDS updates
   |                        |                        |                        |
   |<-- "pickup slot 5" ----|                        |                        |
   |                        |                        |-- UPDATE served ------->|
   |                        |                        |-- Rotanak earn call --->|-- Rotanak API
   |                        |                        |   (Part 4, §4.2)       |
   |<-- coins earned -------|                        |                        |   (if member)
```

#### 3.8.2 Table Touch Points

| Operation | Tables Written | Tables Read | Edge Function |
|---|---|---|---|
| Open shift | `pos.shifts` | `pos.registers`, `cp.accounts` | `shift-open` |
| Create cart | `pos.carts` | `menu.items` | `cart-create` |
| Add line item | `pos.cart_lines` | `menu.items`, `cafe.modifiers` | `cart-add-line` |
| Lock cart | `pos.carts` (status) | `pos.carts`, `pos.cart_lines` | `cart-lock` |
| Process tender | `pos.tenders`, `pos.tender_attempts` | `pos.carts` | `tender-process` |
| Finalize (cash) | `sal.sales_invoices`, `sal.receipts` | `pos.carts`, `pos.tenders` | `pos-cart-finalize` |
| Finalize (cafe) | `ops.cafe_orders` | `pos.carts` | `pos-cart-finalize` |
| Kitchen start | `ops.cafe_orders` (status) | `ops.cafe_orders` | `cafe-order-update` |
| Kitchen complete | `ops.cafe_orders` (status) | `ops.cafe_orders` | `cafe-order-ready` |
| Slot assign | `ops.cafe_orders` (slot) | `ops.cafe_orders` | `cafe-order-ready` |
| Order served | `ops.cafe_orders` (status) | `ops.cafe_orders`, `pos.tenders` | `cafe-order-complete` |
| Close shift | `pos.shifts` | `pos.carts`, `pos.tenders` | `shift-close` |
| Create item | `menu.items` | `menu.categories` | `menu-item-create` |
| Update price | `menu.items`, `menu.price_history` | `menu.items` | `menu-item-update` |
| Sync batch | `pos.offline_sync_batches`, `pos.offline_sync_events` | All local tables | `sync-batch` |

---


---


## Part 4: External Contracts

**Version:** v1.0.0  
**Authority:** Architecture & Topology Agent  
**Date:** 29 May 2026  
**Cross-references:** Part 6 (canonical schema), Master Context §7 (integration contracts)

---

### 4.1 Contract Overview

KitLuy is a consumer of ecosystem services. It never writes loyalty rules, never trains AI models, and never operates its own delivery fleet. The following contracts define every external API integration in v1.0.0.

| Service | Role | Integration Type | KitLuy Writes Rules? |
|---|---|---|---|
| **ABA PayWay** | Payment gateway (KHQR, Card 3DS, Refund) | Edge function calls ABA REST API | No — merchant configures ABA merchant account |
| **Rotanak** | Loyalty engine (tier read, coin earn/redeem) | Edge function calls Rotanak REST API | **No — read-only mirror. Never writes loyalty rules.** |
| **HSAL** | Delivery logistics (driver booking) | Edge function calls HSAL REST API | No — HSAL manages drivers and routes |
| **Supabase** | Cloud database, auth, realtime, storage | Client SDK + Edge Functions + SQL | Yes — full CRUD via edge functions |

---

### 4.2 ABA PayWay Contract

**Base URL:** `https://api.payway.com.kh/v1`  
**Auth:** HTTP Basic Auth with merchant `api_key` + `api_secret`  
**Timeout:** 30s per request (except KHQR polling, which is 180s total)  
**Retry:** Exponential backoff 3× for transient errors (5xx, timeout)  
**Idempotency:** All mutation requests carry `Idempotency-Key` header

#### 4.2.1 KHQR Deeplink Payment

**Flow:** T1 cashier selects "ABA KHQR" tender → POS calls edge function → edge function calls ABA PayWay → ABA returns deeplink URL → QR code rendered on T2 CDS → customer scans with Bakong app → edge function polls for 180s → on success, tender captured.

**Step 1: Create KHQR Deeplink**

```
POST https://api.payway.com.kh/v1/khqr/deeplink
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
  Content-Type: application/json
  Idempotency-Key: {idempotency_key}
```

**Request:**
```json
{
  "amount": "6.00",
  "currency": "USD",
  "merchant_name": "Cafe Kampuchea",
  "store_id": "store-slug-001",
  "transaction_id": "kitluy-inv-20260529-104",
  "callback_url": "https://qneduoifcsvjajeqmvgb.supabase.co/functions/v1/aba-webhook",
  "description": "Order #104 — 2× Iced Latte"
}
```

> **Note on amounts:** ABA PayWay accepts USD decimal strings. KitLuy converts from `numeric(18,4)` storage: `"6.00"` = `$6.00 USD`. The KHQR code encodes the KHR equivalent at current exchange rate.

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "deeplink_url": "https://pay.ababank.com/khqr/abc123def456",
    "qr_code_image": "https://pay.ababank.com/khqr/abc123def456.png",
    "transaction_id": "kitluy-inv-20260529-104",
    "aba_ref": "ABA-20260529-XYZ789",
    "amount": "6.00",
    "currency": "USD",
    "expiry_at": "2026-05-29T14:35:00+07:00"
  }
}
```

**Error Response (4xx/5xx):**
```json
{
  "status": "error",
  "error": {
    "code": "INVALID_AMOUNT",
    "message": "Amount must be greater than 0",
    "details": { "field": "amount", "value": "-1.00" }
  }
}
```

**Edge function writes to `pos.tenders`:**
```json
{
  "tender_type": "aba_khqr",
  "tender_status": "pending",
  "aba_payway_ref": "ABA-20260529-XYZ789",
  "khqr_trace_id": "abc123def456",
  "amount": "6.0000"
}
```

**Step 2: Poll for Payment Status**

```
GET https://api.payway.com.kh/v1/transactions/{aba_ref}
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
```

**Polling loop (edge function `pos-cafe-aba-khqr-poll`):**

| # | Parameter | Value |
|---|---|---|
| 1 | Max polling duration | 180 seconds (3 minutes) |
| 2 | Initial poll interval | 3 seconds |
| 3 | Backoff multiplier | 1.5× (3s, 4.5s, 6.75s, ...) |
| 4 | Max interval | 10 seconds |
| 5 | Max retries | ~40 polls over 180s |
| 6 | Timeout action | Mark tender as `failed` with `error_code = KHQR_TIMEOUT` |

**Poll Response — Pending:**
```json
{ "status": "pending", "aba_ref": "ABA-20260529-XYZ789", "paid_at": null }
```

**Poll Response — Success:**
```json
{
  "status": "success",
  "aba_ref": "ABA-20260529-XYZ789",
  "transaction_id": "kitluy-inv-20260529-104",
  "paid_at": "2026-05-29T14:30:15+07:00",
  "amount": "6.00",
  "currency": "USD",
  "payer_info": {
    "name": "SOK SOPHEAP",
    "phone": "+85512345678",
    "bakong_account": "sopheap@aba"
  }
}
```

**Poll Response — Failed:**
```json
{
  "status": "failed",
  "aba_ref": "ABA-20260529-XYZ789",
  "failed_at": "2026-05-29T14:30:00+07:00",
  "failure_reason": "USER_CANCELLED",
  "amount": "6.00"
}
```

**On success, edge function:**
1. UPDATE `pos.tenders` SET `tender_status = 'captured'` WHERE `aba_payway_ref = 'ABA-20260529-XYZ789'`
2. If all tenders on cart captured → UPDATE `pos.carts.cart_status = 'paid'`
3. Fire `pos-cart-finalize` → INSERT `sal.sales_invoice`, `sal.receipts`
4. For café → INSERT `ops.cafe_orders`

**Error Policy:**

| Error Code | HTTP Status | Retry? | Action |
|---|---|---|---|
| `INVALID_API_KEY` | 401 | No | Alert admin. Check credentials in edge function secrets. |
| `INVALID_AMOUNT` | 400 | No | Reject tender. Log error. Alert cashier. |
| `DUPLICATE_TRANSACTION` | 409 | No | Return existing transaction status (idempotent). |
| `RATE_LIMITED` | 429 | Yes (3×, 5s backoff) | Wait and retry. Alert if still failing. |
| `GATEWAY_ERROR` | 502/503/504 | Yes (3×, exponential backoff) | Retry with backoff. Alert after 3 failures. |
| Timeout | — | Yes (3×) | Retry poll loop. If all timeout → mark `failed`. |
| `USER_CANCELLED` | 200 (status=failed) | No | Mark tender `failed`. Allow cashier to retry or switch payment method. |
| `INSUFFICIENT_FUNDS` | 200 (status=failed) | No | Mark tender `failed`. Prompt customer for alternative payment. |

#### 4.2.2 Card 3DS Payment

**Flow:** T1 cashier selects "ABA Card" → customer inserts/taps card → 3DS redirect → tokenize on first success → reuse token for subsequent payments.

**Step 1: Initialize 3DS Session**

```
POST https://api.payway.com.kh/v1/card/3ds/init
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
  Content-Type: application/json
  Idempotency-Key: {idempotency_key}
```

**Request:**
```json
{
  "amount": "6.00",
  "currency": "USD",
  "card_number": "4111111111111111",
  "expiry_month": "12",
  "expiry_year": "2027",
  "cvv": "123",
  "cardholder_name": "SOK SOPHEAP",
  "return_url": "https://seller.kitluy.com/payment/3ds-callback",
  "transaction_id": "kitluy-inv-20260529-104-card"
}
```

> **Note:** In production, card data is captured via PCI-compliant PIN pad connected to T1, not typed into the POS app. The POS app sends encrypted card data to the edge function, which decrypts before sending to ABA.

**Success Response (200):**
```json
{
  "status": "redirect",
  "redirect_url": "https://3ds.ababank.com/challenge?session=xyz789",
  "three_ds_session_id": "3ds-session-xyz789",
  "transaction_id": "kitluy-inv-20260529-104-card",
  "aba_ref": "ABA-CARD-20260529-ABC123"
}
```

**Step 2: Handle 3DS Callback**

After customer completes 3DS challenge on their device, ABA redirects to `return_url`:

```
GET https://seller.kitluy.com/payment/3ds-callback?status=success&aba_ref=ABA-CARD-20260529-ABC123&three_ds_session_id=3ds-session-xyz789
```

**Step 3: Capture Payment**

```
POST https://api.payway.com.kh/v1/card/capture
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
  Content-Type: application/json
```

**Request:**
```json
{
  "aba_ref": "ABA-CARD-20260529-ABC123",
  "amount": "6.00"
}
```

**Step 4: Tokenize Card (on first successful payment)**

```
POST https://api.payway.com.kh/v1/card/tokenize
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
  Content-Type: application/json
```

**Request:**
```json
{
  "aba_ref": "ABA-CARD-20260529-ABC123",
  "customer_id": "cp.accounts.id-uuid"
}
```

**Token Response:**
```json
{
  "status": "success",
  "card_token": "tok_abc123def456",
  "card_last_four": "1111",
  "card_brand": "visa",
  "expiry_month": "12",
  "expiry_year": "2027"
}
```

**Store token:** The edge function stores `card_token` in `pos.tenders.aba_token` for future reuse. On subsequent payments by the same customer, the POS app can offer "Pay with saved Visa •••• 1111" — bypassing 3DS for tokenized transactions under merchant-configured threshold.

#### 4.2.3 Refund API

**Rule:** Refunds are idempotent. Same `idempotency_key` + same `aba_ref` = same result.

```
POST https://api.payway.com.kh/v1/refunds
Headers:
  Authorization: Basic {base64(api_key:api_secret)}
  Content-Type: application/json
  Idempotency-Key: {refund_idempotency_key}
```

**Full Refund Request:**
```json
{
  "aba_ref": "ABA-20260529-XYZ789",
  "amount": "6.00",
  "reason": "Customer cancelled order",
  "refund_type": "full"
}
```

**Partial Refund Request:**
```json
{
  "aba_ref": "ABA-20260529-XYZ789",
  "amount": "3.00",
  "reason": "Item unavailable",
  "refund_type": "partial"
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "refund_id": "REF-20260529-001",
  "aba_ref": "ABA-20260529-XYZ789",
  "original_amount": "6.00",
  "refunded_amount": "3.00",
  "remaining_amount": "3.00",
  "refunded_at": "2026-05-29T15:00:00+07:00"
}
```

**Edge function writes:**
- UPDATE `pos.tenders` SET `tender_status = 'refunded'` WHERE `aba_payway_ref = 'ABA-20260529-XYZ789'`
- If partial refund → create new `pos.tenders` row with negative amount for accounting

**Error Policy:**

| Error Code | Action |
|---|---|
| `ALREADY_REFUNDED` | Return existing refund details (idempotent). |
| `REFUND_EXCEEDS_BALANCE` | Reject. `refunded_amount` > `remaining_amount`. |
| `TRANSACTION_NOT_FOUND` | Alert admin. `aba_ref` may be from wrong merchant account. |
| `REFUND_WINDOW_EXPIRED` | Reject. ABA allows refunds within 30 days only. |

---

### 4.3 Rotanak Contract

**Base URL:** `https://api.rotanak.com/v1`  
**Auth:** Bearer token `ROTANAK_API_KEY` in `Authorization` header  
**Timeout:** 15s per request  
**Retry:** 3× with exponential backoff for 5xx errors  
**Rule:** KitLuy **never writes loyalty rules**. Read-only mirror. KitLuy calls earn/redeem but the rate (1–3%) is determined by Rotanak based on merchant tier.

#### 4.3.1 rotanak-profile-get

**Purpose:** Retrieve customer's Rotanak tier and Sleung Coin balance. Rendered behind gold `#F5A623` banner on T1 and seller portal.

```
GET https://api.rotanak.com/v1/profile?phone={customer_phone}
Headers:
  Authorization: Bearer {ROTANAK_API_KEY}
  X-Merchant-ID: {tenant_id}
```

**Request Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `phone` | string | Yes | Customer phone number in E.164 format (`+855XXXXXXXXX`) |
| `tenant_id` | string (header) | Yes | KitLuy tenant UUID — Rotanak uses this to determine merchant tier |

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "customer": {
      "phone": "+85512345678",
      "name": "SOK SOPHEAP",
      "rotanak_member_id": "ROT-2024-888888"
    },
    "tier": {
      "current_tier": "gold",
      "tier_name_km": "មាស",
      "earn_rate_percent": 2.0,
      "next_tier": "platinum",
      "spend_to_next_tier_khr": 250000
    },
    "sleung_coin": {
      "balance": 15000,
      "balance_khr": 15000,
      "currency": "KHR",
      "equivalent_usd": "3.75"
    },
    "ui_config": {
      "banner_color": "#F5A623",
      "banner_text_km": "សមាជិកមាស — ទទួលបាន 2% ស្លឹងកូអ៊ីន"
    }
  }
}
```

**Error Response — Not a Member (404):**
```json
{
  "status": "not_found",
  "data": null,
  "message": "Phone number not registered with Rotanak"
}
```

**KitLuy behavior on 404:**
- T1 POS app shows neutral banner: "ចុះឈ្មោះ Rotanak ដើម្បីទទួលបានកូអ៊ីន" ("Sign up for Rotanak to earn coins")
- No earn/redeem functions are called for non-members
- Cashier can offer to register customer (redirects to Rotanak TMA)

**KitLuy behavior on 200:**
- T1 renders gold `#F5A623` banner with tier name + coin balance
- Banner text from `ui_config.banner_text_km` (Khmer-first per Master Context)
- Earn rate (e.g., 2%) is displayed but not hardcoded — comes from API
- On order completion, `rotanak-coin-earn` is called automatically

#### 4.3.2 rotanak-coin-earn

**Purpose:** Credit Sleung Coins to customer after order completion. Merchant-funded — the coins represent a discount funded by the merchant.

**Trigger:** Called by `cafe-order-complete` edge function when `ops.cafe_orders.order_status = 'served'` AND customer has Rotanak profile.

```
POST https://api.rotanak.com/v1/coins/earn
Headers:
  Authorization: Bearer {ROTANAK_API_KEY}
  Content-Type: application/json
  X-Merchant-ID: {tenant_id}
  Idempotency-Key: {earn_idempotency_key}
```

**Request:**
```json
{
  "customer_phone": "+85512345678",
  "order_id": "uuid-from-pos.carts",
  "order_total_khr": 24000,
  "store_id": "uuid-from-pos.stores",
  "store_name": "Cafe Kampuchea",
  "transaction_at": "2026-05-29T14:35:00+07:00"
}
```

> **Note:** `order_total_khr` is the KHR integer from `pos.carts.grand_total_khr` (Part 6, §6.2.3). Rotanak calculates the coin amount: `order_total_khr × earn_rate_percent / 100`.

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "coins_earned": 480,
    "earn_rate_applied": 2.0,
    "new_balance": 15480,
    "order_id": "uuid-from-pos.carts",
    "transaction_id": "ROT-EARN-20260529-001"
  }
}
```

**Edge function writes:**
- UPDATE `ops.cafe_orders` SET `rotanak_coins_earned = 480`

**Error Policy:**

| Error Code | Action |
|---|---|
| `ALREADY_EARNED` | Return existing earn record (idempotent). |
| `MERCHANT_FUND_EXHAUSTED` | Alert merchant in seller portal. Coins not credited. Order still completes. |
| `INVALID_ORDER_TOTAL` | Reject. Check `grand_total_khr` > 0. |

#### 4.3.3 rotanak-coin-redeem

**Purpose:** Customer redeems Sleung Coins for discount on a new order.

**Rule:** Redemption is capped at **30% of order total** — enforced at **both** preview AND commit. This is a hard limit set by Rotanak policy. KitLuy never overrides it.

**Step 1: Preview (before payment)**

```
POST https://api.rotanak.com/v1/coins/redeem/preview
Headers:
  Authorization: Bearer {ROTANAK_API_KEY}
  Content-Type: application/json
  X-Merchant-ID: {tenant_id}
```

**Request:**
```json
{
  "customer_phone": "+85512345678",
  "order_total_khr": 24000,
  "coins_requested": 10000
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "coins_requested": 10000,
    "coins_allowed": 7200,
    "max_redemption_khr": 7200,
    "cap_percent": 30,
    "discount_khr": 7200,
    "final_total_khr": 16800,
    "cap_enforced": true,
    "reason": "Redemption capped at 30% of order total"
  }
}
```

> **30% cap enforcement:** Customer requested 10,000 coins but order total is ៛24,000. 30% of 24,000 = 7,200. So `coins_allowed = 7200` and `discount_khr = 7200`. The POS app must show the customer: "You can redeem up to ៛7,200 (30% of your order)."

**Step 2: Commit (during payment)**

```
POST https://api.rotanak.com/v1/coins/redeem
Headers:
  Authorization: Bearer {ROTANAK_API_KEY}
  Content-Type: application/json
  X-Merchant-ID: {tenant_id}
  Idempotency-Key: {redeem_idempotency_key}
```

**Request:**
```json
{
  "customer_phone": "+85512345678",
  "order_id": "uuid-from-pos.carts",
  "order_total_khr": 24000,
  "coins_to_redeem": 7200,
  "preview_token": "preview-token-from-step-1"
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "coins_redeemed": 7200,
    "discount_khr": 7200,
    "final_total_khr": 16800,
    "new_balance": 8280,
    "order_id": "uuid-from-pos.carts",
    "transaction_id": "ROT-REDEEM-20260529-001"
  }
}
```

**Edge function writes:**
- INSERT `pos.tenders` with `tender_type = 'sleung_coin'`, `amount_khr = 7200`
- UPDATE `ops.cafe_orders` SET `rotanak_coins_redeemed = 7200`
- UPDATE `pos.carts` — subtract redeemed amount from `grand_total`

**Error Policy — Commit Phase:**

| Error Code | Action |
|---|---|
| `PREVIEW_EXPIRED` | Reject. Preview tokens valid for 5 minutes. Call preview again. |
| `CAP_EXCEEDED` | Reject. The `coins_to_redeem` exceeds 30% cap. This should never happen if preview was honored. Log bug. |
| `INSUFFICIENT_BALANCE` | Reject. Customer spent coins elsewhere between preview and commit. Call preview again. |
| `ALREADY_REDEEMED` | Return existing redemption record (idempotent). |

---

### 4.4 HSAL Contract

**Base URL:** `https://api.hsal.kh/v1`  
**Auth:** Bearer token `HSAL_API_KEY` in `Authorization` header  
**Timeout:** 10s per request  
**Retry:** 2× for 5xx errors  

#### 4.4.1 hsal-booking-create

**Trigger:** Called by `cafe-order-ready` edge function AFTER T4 assigns a slot AND `service_mode = delivery`.

**Flow:**
```
T4 assigns slot → edge function checks service_mode
    IF delivery → call hsal-booking-create
    ELSE → skip (dine_in/takeaway handled in-store)
```

```
POST https://api.hsal.kh/v1/bookings
Headers:
  Authorization: Bearer {HSAL_API_KEY}
  Content-Type: application/json
  X-Merchant-ID: {tenant_id}
```

**Request:**
```json
{
  "store": {
    "store_id": "uuid-from-pos.stores",
    "store_name": "Cafe Kampuchea",
    "address": "#123, St. 51, BKK1, Phnom Penh",
    "latitude": 11.5564,
    "longitude": 104.9282,
    "phone": "+85523222111",
    "contact_name": "Manager"
  },
  "customer": {
    "name": "SOK SOPHEAP",
    "phone": "+85512345678",
    "address": "#456, St. 302, Toul Kork, Phnom Penh",
    "latitude": 11.5687,
    "longitude": 104.8992,
    "delivery_notes": "Ring bell, 2nd floor"
  },
  "order": {
    "order_id": "uuid-from-pos.carts",
    "order_number": "104",
    "items": [
      { "name": "Iced Latte", "qty": 2, "modifiers": ["Extra Shot"] }
    ],
    "total_khr": 24000,
    "slot_number": 5,
    "estimated_ready_at": "2026-05-29T14:45:00+07:00"
  },
  "metadata": {
    "kitluy_tenant_id": "uuid",
    "kitluy_register_id": "uuid-t4"
  }
}
```

**Success Response (200):**
```json
{
  "status": "success",
  "data": {
    "booking_id": "HSAL-20260529-00521",
    "driver": {
      "driver_id": "DRV-8842",
      "name": "CHHUN RAKSMEY",
      "phone": "+85598765432",
      "vehicle_type": "motorcycle",
      "license_plate": "1AB-2345"
    },
    "pickup_eta_minutes": 12,
    "delivery_eta_minutes": 25,
    "tracking_url": "https://hsal.kh/track/HSAL-20260529-00521",
    "status": "driver_assigned"
  }
}
```

**Edge function writes:**
- Store `booking_id` in `ops.cafe_orders.metadata->>'hsal_booking_id'`
- Store `tracking_url` for T4 to display to cashier

**Error Policy:**

| Error Code | Action |
|---|---|
| `NO_DRIVERS_AVAILABLE` | Alert on T4. Order still marked `ready_for_pickup`. Retry every 60s for 10 minutes. |
| `OUTSIDE_SERVICE_AREA` | Alert on T4. Notify customer to pick up in-store. |
| `INVALID_ADDRESS` | Alert on T4. Ask cashier to confirm customer address. |
| `RATE_LIMITED` | Wait 30s, retry. Alert if still failing after 3 retries. |

---

### 4.5 Supabase Contract

#### 4.5.1 Project Configuration

| Parameter | Value | Notes |
|---|---|---|
| **Project ID** | `qneduoifcsvjajeqmvgb` | Fixed. All edge function URLs include this. |
| **Region** | `ap-southeast-1` (Singapore) | Closest to Cambodia. Do NOT change. |
| **PostgreSQL Version** | 17 | Via Supabase managed service. |
| **Auth Method** | Phone OTP (primary) | One UUID per person across ecosystem (Master Context §2 P2) |
| **Edge Function Runtime** | Deno 1.40+ | Serverless functions at `https://{project}.supabase.co/functions/v1/{name}` |
| **Realtime** | WebSocket, channels | Used for T4→T5 broadcast and sync notifications |
| **Storage** | Object storage | Receipt images, item photos, uploaded documents |

#### 4.5.2 Auth Contract

**Primary auth method: Phone OTP**

```
POST https://qneduoifcsvjajeqmvgb.supabase.co/auth/v1/otp
Headers:
  apikey: {anon_public_key}
  Content-Type: application/json
```

**Request (send OTP):**
```json
{
  "phone": "+85512345678",
  "data": {
    "display_name": "SOK SOPHEAP"
  }
}
```

**Request (verify OTP):**
```json
{
  "phone": "+85512345678",
  "token": "123456",
  "type": "sms"
}
```

**Response:**
```json
{
  "access_token": "eyJhbG...",
  "token_type": "bearer",
  "expires_in": 3600,
  "refresh_token": "-eqpE...",
  "user": {
    "id": "uuid-auth-users-id",
    "phone": "+85512345678",
    "role": "authenticated"
  }
}
```

**Account creation:** On first successful OTP verification, edge function auto-creates `cp.accounts` row:
```sql
INSERT INTO cp.accounts (auth_user_id, phone, display_name)
VALUES ('uuid-auth-users-id', '+85512345678', 'SOK SOPHEAP')
ON CONFLICT (phone) DO NOTHING;
```

> **Single Identity:** The `auth.users.id` UUID is the canonical identity across the entire HET ecosystem. `cp.accounts.auth_user_id` FK links to it. One UUID per person. Non-negotiable.

#### 4.5.3 Row-Level Security (RLS) Contract

Every tenant-scoped table MUST have RLS enabled with the canonical policy (Part 6, §6.1.4):

```sql
ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY {table}_tenant_isolation ON {schema}.{table}
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

Edge functions set `tenant_id` and `account_id` in the PostgreSQL session via:

```sql
-- Executed by every edge function before querying
core.current_tenant_id()  -- from JWT claim 'tenant_id'
core.current_account_id() -- from JWT claim 'account_id'
core.is_service_role()    -- from JWT claim 'role' = 'service_role'
```

#### 4.5.4 Realtime Channels

**Channel subscription (client-side, e.g., T5):**

```javascript
const channel = supabase
  .channel('cafe:store:' + store_id)
  .on('broadcast', { event: 'slot_assigned' }, (payload) => {
    // Update T5 display
    addToNowServing(payload.payload.slot_number, payload.payload);
  })
  .on('broadcast', { event: 'order_served' }, (payload) => {
    // Remove from T5 display
    removeFromNowServing(payload.payload.slot_number);
  })
  .subscribe();
```

**Channel broadcast (server-side, from T4 via edge function):**

```javascript
// Inside cafe-order-ready edge function
const channel = supabase.channel('cafe:store:' + store_id);
await channel.send({
  type: 'broadcast',
  event: 'slot_assigned',
  payload: {
    order_id: orderId,
    slot_number: slotNumber,
    order_number: orderNumber,
    customer_name: customerName,
    service_mode: serviceMode,
    items: items
  }
});
```

#### 4.5.5 Storage

| Bucket | Purpose | Path Pattern | Public? |
|---|---|---|---|
| `receipts` | Receipt images (PNG) | `{tenant_id}/{store_id}/{date}/{receipt_id}.png` | No (signed URL, 1 hour expiry) |
| `items` | Menu item photos | `{tenant_id}/{item_id}.jpg` | Yes |
| `categories` | Category photos | `{tenant_id}/{category_id}.jpg` | Yes |
| `documents` | Merchant documents | `{tenant_id}/docs/{filename}` | No |

#### 4.5.6 Migrations Path

Migrations are stored at `supabase/migrations/` in the repository. Applied by the BE team only using Supabase CLI. See Part 6, §6.5.1 for the canonical migration sequence (001–013).

**Apply migrations:**
```bash
supabase link --project-ref qneduoifcsvjajeqmvgb
supabase db push
```

**Verify applied migrations:**
```sql
SELECT * FROM schema.migrations_log ORDER BY applied_at;
```

**Never:**
- Apply migrations out of order
- Edit a migration file after it has been applied to production
- Use `supabase db reset` on production

---


---


## Part 5: Core Business Logic

**Version:** v1.0.0  
**Authority:** Business Logic Agent (veto on state machines, money model, RBAC matrix)  
**Date:** 29 May 2026  
**Status:** Canonical  

**Prerequisites:** Part 6 (Database Schema) — all table names, enums, and FK references in this part are canonical per `Part 6, §6.2–6.3`.  
**Money Model:** Defined in `Part 8, §8.1`. All monetary computations in this part reference it.  
**RBAC Enforcement:** Defined in `Part 10, §10.1–10.3`. All operations in this part are subject to role checks.

---

### 5.1 Cart Lifecycle State Machine

#### 5.1.1 State Definitions

The cart is the **financial source of truth** for every order (`pos.carts`, `Part 6, §6.2.3`). Its lifecycle is controlled by the `cart_status` column with canonical values defined in `Part 6, §6.3 enum #8`.

| Semantic State | Storage Value (`cart_status`) | Meaning |
|---|---|---|
| **Draft** | `open` | Cart is open; lines can be added, removed, or modified. |
| **Pending Payment** | `locked` | Cart is locked; no more line changes. Tender(s) being processed. |
| **Paid** | `paid` | All tenders captured. Cart is financially complete. |
| **Cancelled** | `cancelled` | Cart was voided before any tender was captured. No financial impact. |
| **Refunded** | `refunded` | Cart was paid then fully refunded. Financially reversed. |

> **Note:** `finalized` is not a `cart_status` value. Finalization is the outcome where a `paid` cart spawns an immutable `sal.sales_invoice` + `sal.receipt` (see `§5.6`).

#### 5.1.2 State Diagram

```mermaid
stateDiagram-v2
    [*] --> open : cart_create
    open --> open : cart_line_add / cart_line_remove / cart_line_modify
    open --> locked : cart_lock
    open --> cancelled : cart_cancel

    locked --> paid : tender_capture
    locked --> open : cart_unlock (recovery)
    locked --> failed : tender_all_failed
    failed --> open : cart_unlock (return to editable)
    failed --> cancelled : cart_cancel

    paid --> finalized : invoice_create
    paid --> refunded : refund_full

    finalized --> [*]
    finalized --> refunded : refund_full (void invoice)
    cancelled --> [*]
    refunded --> [*]
```

#### 5.1.3 Transitions — Guards, Triggers, and Recovery

| # | Transition | Trigger (Edge Function) | Guard Condition | Side Effects | Error State |
|---|---|---|---|---|---|
| 1 | `* → open` | `pos-cart-create` | Active session exists (`pos.sessions.is_active = true`). Shift is open (`pos.shifts.is_closed = false`). | Creates `ops.cafe_orders` row if `store.vertical_type = 'cafe'` (`order_status = 'new'`). | `E_SHIFT_CLOSED` — reject if no open shift. |
| 2 | `open → open` | `pos-cart-line-add` | `cart_status = 'open'`. Item is available (`menu.items.is_available = true`). | Recalculate cart subtotal/grand_total. Derive `_khr` columns. | `E_CART_LOCKED` — reject if cart not open. |
| 3 | `open → open` | `pos-cart-line-remove` | `cart_status = 'open'`. Line exists and is not voided. | Mark line `is_voided = true`. Recalculate totals. | `E_CART_LOCKED` |
| 4 | `open → open` | `pos-cart-line-modify` | `cart_status = 'open'`. Modifier constraints satisfied (`§5.5.3`). | Recalculate line subtotal with modifier upcharges. | `E_MODIFIER_INVALID` |
| 5 | `open → locked` | `pos-cart-lock` | `cart_status = 'open'`. At least one line exists (`COUNT(cart_lines) > 0`). `grand_total > 0`. | Freeze all line edits. Set `session_id = NULL` (tab survives session expiry). | `E_CART_EMPTY` |
| 6 | `locked → open` | `pos-cart-unlock` | `cart_status = 'locked'`. No tender has `status = 'captured'`. | Unfreeze lines for editing. | `E_TENDER_CAPTURED` — cannot unlock if any tender already captured. |
| 7 | `locked → paid` | `pos-tender-capture` | `SUM(tenders.amount WHERE status='captured') >= cart.grand_total`. All tenders resolved. | Set `total_paid`, `change_due`. Update tab balance if linked. | `E_TENDER_INSUFFICIENT` — reject if sum < grand_total. |
| 8 | `locked → failed` | `pos-tender-timeout` | All tender attempts failed or timed out. No captured tender exists. | Log failure reason. Cart stays in failed state for retry. | — |
| 9 | `failed → open` | `pos-cart-unlock` | `cart_status` in (`locked`, `failed`). No captured tender. | Return to editable state. | `E_TENDER_CAPTURED` |
| 10 | `failed → cancelled` | `pos-cart-cancel` | `cart_status = 'failed'`. | Cart voided. No financial record created. | — |
| 11 | `open → cancelled` | `pos-cart-cancel` | `cart_status = 'open'`. No captured tender exists. | Void all lines. If linked to tab, remove cart from tab. | `E_CART_PAID` — cannot cancel paid cart. |
| 12 | `paid → finalized` | `pos-invoice-create` | `cart_status = 'paid'`. Invoice does not yet exist for this cart. | INSERT `sal.sales_invoice`, INSERT `sal.receipt`. Cart is now read-only. | `E_INVOICE_EXISTS` — idempotency check. |
| 13 | `paid → refunded` | `pos-refund-full` | `cart_status = 'paid'`. Invoice exists and is not already voided. Refund amount = `grand_total`. | INSERT refund tender row. Void invoice. Update `ops.cafe_orders` to `cancelled` if café. | `E_INVOICE_VOIDED` |
| 14 | `finalized → refunded` | `pos-refund-full` | Invoice is `final`. Within refund window (merchant policy). | Void invoice. Create reversal receipt. Update `cart_status = 'refunded'`. | `E_REFUND_WINDOW_EXPIRED` |

#### 5.1.4 Idempotency on Cart Operations

Every mutation edge function (`pos-cart-create`, `pos-cart-line-add`, `pos-tender-create`) requires an idempotency key per `Master Context §2 P9`.

| Operation | Idempotency Key Scope | Collision Behavior |
|---|---|---|
| `cart_create` | `[device_uuid]_[counter]_[timestamp]` — stored on `pos.carts.idempotency_key` UNIQUE | If key exists, return existing cart (no duplicate created). |
| `cart_line_add` | Same key format, stored in request payload (not DB unique) | If line with same item + modifiers already exists in this cart within 5s window, return existing line. |
| `tender_create` | Stored on `pos.tenders.idempotency_key` UNIQUE per cart | If key exists for this cart, return existing tender. |

---

### 5.2 Shift Lifecycle

#### 5.2.1 State Definitions

A shift (`pos.shifts`, `Part 6, §6.2.3`) represents a single cashier operating period. The state is derived from the `is_closed` boolean and timestamp columns.

| State | Condition | Meaning |
|---|---|---|
| **Opening** | Row created, `opened_at` set, `opening_float` recorded | Shift is being initialized. |
| **Active** | `is_closed = false`, `closed_at IS NULL` | Shift is open. Carts can be created. Sessions can be started. |
| **Closing** | `is_closed = true`, `closed_at` set, `closing_float` recorded | Shift is closed. No new carts or sessions. |
| **Reconciled** | `discrepancy` computed, `z_report_data` populated | Financial reconciliation complete. |

#### 5.2.2 Shift State Diagram

```mermaid
stateDiagram-v2
    [*] --> opening : shift_open
    opening --> active : session_start (first session)
    active --> active : cart_create / tender_capture
    active --> active : session_start / session_end
    active --> closing : shift_close
    closing --> reconciled : z_report_generate
    reconciled --> [*]
```

#### 5.2.3 Open — Guard Conditions

| # | Check | Rule | Error |
|---|---|---|---|
| 1 | Previous shift closed | No existing row for this register with `is_closed = false`. | `E_SHIFT_ALREADY_OPEN` |
| 2 | Cashier has `process_sales` permission | `cp.tenant_memberships.membership_role` allows shift open (see `Part 10, §10.2`). | `E_UNAUTHORIZED` |
| 3 | Register is active | `pos.registers.is_active = true`. | `E_REGISTER_INACTIVE` |
| 4 | Float amount >= 0 | `opening_float` is `numeric(18,4)`, must be non-negative. | `E_INVALID_FLOAT` |

**Side effects on open:**
- INSERT `pos.shifts` row with `opening_float`, `opened_by = current_account_id`.
- Auto-start first `pos.sessions` row (the cashier who opened the shift is automatically logged in).

#### 5.2.4 Active — Session Management

During an active shift, multiple `pos.sessions` rows may exist. Each session ties an `account_id` to a `register_id` within the shift.

| Event | Edge Function | Guard | Side Effects |
|---|---|---|---|
| Session start | `pos-session-start` | Shift is active. Account has `process_sales` permission. | INSERT `pos.sessions`. Set `is_active = true`. |
| Session heartbeat | `pos-session-ping` | `is_active = true`. | Update `last_activity_at = now()`. |
| Session end | `pos-session-end` | `is_active = true`. No locked carts owned by this session (or cart is `open` and can be transferred). | Set `is_active = false`, `ended_at = now()`. |
| Auto-lock (inactivity) | `pos-session-auto-lock` (scheduled) | `last_activity_at < now() - interval '5 minutes'`. | Set `is_active = false`. Any `open` carts linked to this session remain open but `session_id` is set to `NULL` (become tab-like). |

#### 5.2.5 Close — Reconciliation Flow

| # | Step | Description | Computation |
|---|---|---|---|
| 1 | **Pre-close check** | No locked carts (`pos.carts.cart_status = 'locked'`) may exist for this shift. | `SELECT COUNT(*) FROM pos.carts WHERE shift_id = ? AND cart_status = 'locked'` must be 0. |
| 2 | **Count physical cash** | Cashier counts cash drawer. Record as `closing_float`. | `closing_float = actual cash counted`. |
| 3 | **Compute expected float** | System computes what the drawer should hold. | `expected_float = opening_float + SUM(cash tenders) - SUM(cash refunds)` |
| 4 | **Compute discrepancy** | Difference between counted and expected. | `discrepancy = closing_float - expected_float` |
| 5 | **Generate Z-report** | Snapshot of all sales during the shift. | `z_report_data = JSON { total_sales, total_refunds, tender_breakdown, cart_count, item_counts }` |
| 6 | **Close shift** | Mark shift closed. | `UPDATE pos.shifts SET is_closed = true, closed_at = now(), closed_by = current_account_id`. |

**What happens to open carts on shift close:**

| Cart Status | Behavior |
|---|---|
| `open` | **MUST be resolved before close.** Either: (a) convert to a tab by setting `session_id = NULL` and `tab_id = {new_or_existing_tab}`, or (b) cancel the cart. The edge function rejects shift close with `E_OPEN_CARTS_EXIST` if unresolved `open` carts remain. |
| `locked` | **Blocked.** Shift close is rejected with `E_LOCKED_CARTS_EXIST`. Cashier must unlock, complete payment, or cancel. |
| `paid` | Unaffected. Paid carts survive shift close and proceed to invoice/receipt creation normally. |
| `cancelled` | Ignored (no financial impact). |

#### 5.2.6 Z-Report Data Schema

```json
{
  "shift_id": "uuid",
  "opened_at": "2026-05-29T08:00:00Z",
  "closed_at": "2026-05-29T16:00:00Z",
  "cashier_name": "Sokha",
  "opening_float": 100.0000,
  "closing_float": 245.5000,
  "expected_float": 248.0000,
  "discrepancy": -2.5000,
  "summary": {
    "total_sales_usd": 148.0000,
    "total_sales_khr": 592000,
    "total_refunds_usd": 0,
    "cart_count": 42,
    "average_cart_usd": 3.5238
  },
  "tender_breakdown": {
    "cash": { "count": 28, "amount_usd": 98.0000 },
    "aba_khqr": { "count": 10, "amount_usd": 35.0000 },
    "aba_card": { "count": 4, "amount_usd": 15.0000 }
  },
  "top_items": [
    { "item_name": "Iced Latte", "quantity": 24, "revenue_usd": 48.0000 }
  ]
}
```

---

### 5.3 Tender Flow

#### 5.3.1 Tender Architecture

A cart may have **multiple** `pos.tenders` rows (`Part 6, §6.2.3`) — this is **split tender**. Each tender row represents one payment method. The sum of all captured tender amounts must equal `cart.grand_total`.

| Column | Purpose |
|---|---|
| `tender_type` | `cash`, `aba_card`, `aba_khqr`, `sleung_coin`, `debt` |
| `tender_status` | `pending`, `authorized`, `captured`, `failed`, `refunded`, `voided` |
| `amount` | The amount this tender contributes (USD `numeric(18,4)`) |
| `amount_khr` | Derived KHR at write time (`Part 8, §8.1`) |
| `idempotency_key` | Prevents duplicate tender creation per cart |

#### 5.3.2 Split Tender Math

```
-- Given: cart.grand_total = G
-- Tender rows: T1, T2, ..., Tn

CONSTRAINT: SUM(Ti.amount WHERE Ti.status = 'captured') = G

-- Split tender creation:
1. Cashier proposes split: [ {type: 'cash', amount: A}, {type: 'aba_khqr', amount: G - A} ]
2. Edge function validates: proposed amounts sum to G (within epsilon 0.0001)
3. INSERT pos.tenders rows with status = 'pending'
4. Process each tender independently (may have different gateways)
5. When ALL tenders reach 'captured', UPDATE cart SET cart_status = 'paid'
```

**Remainder distribution rule:** If a customer pays more than the remaining balance (e.g., pays cash and the exact KHR amount rounds up), the overage becomes `change_due` on the cart. `change_due` is always returned in cash.

| Scenario | Handling |
|---|---|
| Cash tender > remaining balance | Tender amount = amount given. `change_due = tender_amount - remaining_balance`. |
| KHQR tender scans exact amount | Tender amount = remaining balance. No change. |
| Sleung Coin redeem partial | `sleung_coins_used` computed by Rotanak. Tender amount = KHR coin value converted to USD. Remainder paid by other tender. |
| Debt (pay later) | Tender amount = remaining balance. `tender_status = 'captured'` immediately (merchant assumes risk). |

#### 5.3.3 Tender Attempt Retry Logic

Each `pos.tenders` row has one or more `pos.tender_attempts` rows (`Part 6, §6.2.3`). This table is **append-only**.

##### ABA KHQR Polling

```
Edge function: pos-cafe-aba-khqr-poll
Parameters: tender_id, khqr_trace_id

POLLING LOOP:
  timeout_at = now() + interval '180 seconds'
  backoff_intervals = [3, 6, 12]  -- seconds, 3x exponential backoff
  attempt = 1

  WHILE now() < timeout_at:
    INSERT pos.tender_attempts (tender_id, attempt_number, status='processing', gateway='aba_payway')

    response = call ABA PayWay /check-payment (khqr_trace_id)

    IF response.status == 'completed':
      UPDATE pos.tenders SET tender_status = 'captured', aba_payway_ref = response.ref
      UPDATE pos.tender_attempts SET status = 'success', response_payload = response, completed_at = now()
      RETURN success

    ELSE IF response.status == 'failed':
      UPDATE pos.tenders SET tender_status = 'failed'
      UPDATE pos.tender_attempts SET status = 'failed', error_code = response.code
      RETURN failure

    ELSE:
      -- still pending
      UPDATE pos.tender_attempts SET status = 'pending', response_payload = response
      sleep(backoff_intervals[min(attempt-1, 2)])
      attempt += 1

  -- Timeout reached
  UPDATE pos.tenders SET tender_status = 'failed'
  INSERT pos.tender_attempts (status='timeout', error_code='TIMEOUT')
  RETURN timeout
```

##### Card 3DS Flow

```
Edge function: pos-cafe-aba-card-3ds

FLOW:
  1. Customer enters card details (or selects saved token)
  2. INSERT pos.tender_attempts (status='processing', gateway='aba_payway')
  3. Call ABA PayWay /initiate-3ds:
     - If new card: tokenize, store token in aba_token on success
     - If saved token: reuse existing aba_token
  4. Redirect customer to 3DS ACS URL
  5. On callback:
     a. If authenticated: UPDATE tender_status = 'captured', attempt status = 'success'
     b. If failed: UPDATE tender_status = 'failed', attempt status = 'failed', log error
     c. If abandoned (no callback within 10 min): attempt status = 'timeout'
  6. Customer may retry with same or different card (new tender_attempt row)
```

##### Sleung Coin (Rotanak) Redeem

```
Edge function: rotanak-coin-redeem

FLOW:
  1. Preview: call rotanak-redeem-preview (coins, order_total)
     - REJECT if coin value > 30% of order_total (Part 8, §8.5)
  2. Customer confirms
  3. INSERT pos.tender_attempts (gateway='rotanak')
  4. Call rotanak-coin-redeem commit
  5. On success: tender_status = 'captured', sleung_coins_used = N
  6. On failure: tender_status = 'failed', attempt status = 'failed'
```

#### 5.3.4 Refund Flow

Refunds are financial reversals. They create new tender rows; they do not modify existing ones (append-only per `Master Context §2 P8`).

| Type | Condition | Edge Function | Behavior |
|---|---|---|---|
| **Full refund** | `cart_status = 'paid'` or `finalized`. Refund amount = `grand_total`. | `pos-refund-full` | INSERT new tender row with `tender_type = {original_type}`, `amount = -grand_total`, `tender_status = 'refunded'`. Update original cart `cart_status = 'refunded'`. Call ABA PayWay refund API if electronic tender. |
| **Partial refund** | `cart_status = 'paid'`. Refund amount < `grand_total`. | `pos-refund-partial` | INSERT new tender row with negative amount. Original cart stays `paid`. Partial refunds can accumulate up to `grand_total`. |

**ABA PayWay refund requirements:**
- Must provide `aba_payway_ref` from original tender
- Must be idempotent: same refund idempotency key returns same result
- Full refund: voids the `aba_payway_ref`
- Partial refund: creates new refund reference

---

### 5.4 Offline Sync Logic

#### 5.4.1 Overview

When the WAN link (Hub Server ↔ Supabase) is down, terminals continue operating via the local Hub PostgreSQL replica. Operations are captured as `pos.offline_sync_events` inside `pos.offline_sync_batches` (`Part 6, §6.2.3`). When connectivity restores, the Hub uploads batches to Supabase for reconciliation.

#### 5.4.2 Batch Creation

```
-- On the Hub Server (local PostgreSQL)

1. Local operations are written to local tables (mirrored schema)
2. Every N minutes or every M operations, a batch envelope is created:
   INSERT pos.offline_sync_batches (tenant_id, store_id, device_uuid, batch_status='pending', event_count=M)
3. Individual operations are linked to the batch:
   INSERT pos.offline_sync_events (batch_id, event_type, table_name, record_id, payload, idempotency_key)
```

**Batch sizing policy:**

| Trigger | Condition |
|---|---|
| Size threshold | 50 events or 5 minutes, whichever comes first |
| Shift close | Immediate batch creation for all pending events |
| Reconnection | Hub detects WAN restore → immediate flush of pending batch |

#### 5.4.3 Event Types

Per `Part 6, §6.3 enum #12`, the `event_type` column supports:

| Event Type | Table | Payload Content | Conflict Risk |
|---|---|---|---|
| `cart_create` | `pos.carts` | Full cart row | Low — UUID PK prevents collision |
| `cart_update` | `pos.carts` | Changed fields only | Medium — status changes may conflict |
| `tender_create` | `pos.tenders` | Full tender row | Low — idempotency key prevents dup |
| `tender_attempt` | `pos.tender_attempts` | Full attempt row | Low — append-only |
| `shift_open` | `pos.shifts` | Full shift row | High — another cashier may have opened |
| `shift_close` | `pos.shifts` | Closing data | High — reconciliation values differ |
| `session_start` | `pos.sessions` | Full session row | Low |
| `session_end` | `pos.sessions` | End timestamp | Low |
| `item_update` | `menu.items` | Changed fields | High — price/stock changes conflict |
| `price_update` | `menu.price_history` | Full history row | Low — append-only |

#### 5.4.4 Conflict Resolution Strategy

When an offline event conflicts with server state, the `event_status` becomes `'conflict'` and `conflict_info` is populated with server-side values.

| Conflict Scenario | Resolution Rule | Winner |
|---|---|---|
| Offline cart create, server has cart with same UUID | UUID collision — reject offline, keep server | Server |
| Offline cart update (status change), server has newer update | Timestamp comparison — newer timestamp wins | Newer timestamp |
| Offline shift open, server shows shift already open for same register | Reject offline shift open. Cashier must re-open shift on sync. | Server |
| Offline tender create, server has tender with same idempotency key | Return existing tender (idempotency). Mark as synced. | Server |
| Offline item price change, server has newer price | Reject offline price change. Alert manager. | Server |
| Offline item availability change, server has conflicting change | Server wins. Alert manager of mismatch. | Server |

**General principle:** Server state wins in all conflicts except where idempotency keys prove the events are the same operation (in which case the first one wins and the second is deduplicated).

#### 5.4.5 Reconnection Burst Handling

When WAN connectivity is restored after an outage:

```
1. Hub detects connectivity (health check to Supabase succeeds)
2. Hub queries local DB for batches with status IN ('pending', 'error', 'partial')
3. For each batch, ordered by created_at ASC:
   a. Upload batch to Supabase via edge function pos-offline-sync-receive
   b. Edge function processes events in order within the batch
   c. Each event is applied with conflict resolution
   d. Edge function returns result: { synced: N, conflicts: M, errors: E }
   e. Hub updates batch_status based on result
4. If processing fails mid-batch:
   - Already-processed events: status = 'synced'
   - Failed events: status = 'error', error_log populated
   - Batch status = 'partial'
   - Hub retries the batch (exponential backoff, max 5 attempts)
```

**Rate limiting:** Maximum 10 batches per minute during burst to avoid overwhelming Supabase.

#### 5.4.6 How Offline Carts Become Invoices

When an offline `cart_create` + `tender_create` syncs successfully:

```
1. Event applied: INSERT pos.carts (with original UUID)
2. Event applied: INSERT pos.tenders (idempotency check passes)
3. If all tenders are 'captured':
   a. Edge function pos-offline-sync-receive triggers pos-invoice-create
   b. INSERT sal.sales_invoice FROM pos.carts (snapshot)
   c. INSERT sal.receipt FROM invoice
   d. If cafe vertical: INSERT ops.cafe_orders (order_status = 'new')
4. If tenders are NOT all captured (e.g., KHQR was never scanned):
   a. Tenders marked 'failed'
   b. Cart status set to 'failed' (recoverable — cashier can retry payment)
   c. No invoice created until payment resolves
```

**Offline invoice numbering:** Invoices use `INV-{store_code}-{YYYYMMDD}-{sequence}`. If multiple days of offline data sync at once, sequence numbers are assigned in chronological order based on `pos.carts.created_at`. The edge function handles sequence allocation atomically.

---

### 5.5 Café Operational Flow

#### 5.5.1 Tab Lifecycle

A `cafe.tab` (`Part 6, §6.2.6`) is a running order that **survives shift change**. Multiple carts can be linked to a single tab over time via `pos.carts.tab_id`.

```mermaid
stateDiagram-v2
    [*] --> open : tab_open
    open --> open : cart_linked (new cart added to tab)
    open --> open : cart_paid (balance reduces)
    open --> closed : tab_close (balance = 0)
    open --> cancelled : tab_cancel (manager override)
    closed --> [*]
    cancelled --> [*]
```

| State | Condition | Behavior |
|---|---|---|
| `open` | `tab_status = 'open'` | Carts can be linked. Customers can add more items. |
| `closed` | `tab_status = 'closed'` | No more carts. Full history preserved. |
| `cancelled` | `tab_status = 'cancelled'` | Manager override. All linked open carts cancelled. |

**Tab open guard:**
- `service_mode` must be `dine_in` or `takeaway` (tabs are not used for `delivery`)
- `tab_number` must be unique per store among open tabs (`UNIQUE(store_id, tab_number) WHERE tab_status = 'open'`)

**Tab balance computation:**
```
balance_due = total_ordered - total_paid
total_ordered = SUM(cart.grand_total FOR ALL carts linked to this tab)
total_paid    = SUM(cart.total_paid    FOR ALL carts linked to this tab)
```

**Shift change behavior:** When a shift closes, any `open` carts linked to a tab have their `session_id` set to `NULL` (they survive). The tab itself is unaffected by shift changes.

#### 5.5.2 Service Modes — Downstream Behavior

| Mode | Origin | T3 KDS | T4 DDS | T5 QDS | Delivery Trigger | Tab Support |
|---|---|---|---|---|---|---|
| `dine_in` | Walk-in | Yes — full ticket | Yes — slot assignment | Yes — order number | No | Yes |
| `takeaway` | Walk-in | Yes — full ticket | Yes — slot assignment | Yes — order number | No | Yes |
| `delivery` | TMA only | Yes — full ticket | Yes — packing list only | No | HSAL fires after T4 slot assignment | No |

> **Rule:** `service_mode = 'delivery'` is only valid when `origin_channel = 'tma'`. Edge function `pos-cart-create` rejects `delivery` with `origin_channel = 'walk_in'`.

**Downstream differences:**

| Aspect | `dine_in` | `takeaway` | `delivery` |
|---|---|---|---|
| Cup sticker | Print at T3 | Print at T3 | Print at T3 + packing list at T4 |
| Customer wait location | In-store | In-store / counter | Not present — driver collects |
| T5 broadcast | Order number + slot | Order number + slot | Not shown on T5 |
| Slot assignment | Yes — physical pickup position | Yes — pickup counter | N/A — hand to driver |
| HSAL trigger | No | No | Yes — after slot assignment |

#### 5.5.3 Modifier Application

Modifiers are defined in `cafe.modifier_groups` and `cafe.modifiers` (`Part 6, §6.2.6`). They are linked to items via `menu.item_modifier_groups`.

**Modifier group constraints:**

| Constraint | Validation Rule | Error |
|---|---|---|
| `is_required = true` | At least one modifier from this group must be selected. | `E_MODIFIER_REQUIRED` |
| `selection_type = 'pick_one'` | Exactly one modifier must be selected. | `E_MODIFIER_PICK_ONE` |
| `selection_type = 'pick_many'` | Zero or more modifiers. If `max_selections` set, cannot exceed it. | `E_MODIFIER_TOO_MANY` |

**KHR upcharge calculation:**

```
-- For each selected modifier:
modifier_upcharge_usd = modifier.upcharge
modifier_upcharge_khr = modifier.upcharge_khr  -- derived at write time

-- Line price with modifiers:
line_unit_price = item.base_price + SUM(selected_modifier.upcharge)
line_unit_price_khr = item.base_price_khr + SUM(selected_modifier.upcharge_khr)
```

**Modifier validation edge function:** `cafe-modifier-validate`

```
INPUT:  item_id, selected_modifiers: [{modifier_group_id, modifier_ids: []}]
OUTPUT: { valid: bool, errors: [{modifier_group_id, error_code}], unit_price_with_upcharges_usd, unit_price_with_upcharges_khr }

RULES:
  For each modifier group linked to the item:
    1. If group.is_required AND no selection provided → error
    2. If group.selection_type = 'pick_one' AND selected count != 1 → error
    3. If group.selection_type = 'pick_many' AND selected count > group.max_selections → error
    4. If any selected modifier_id not in group's modifiers → error
    5. If any selected modifier is inactive → error
```

#### 5.5.4 Recipe Deduction at `ready_for_pickup`

When `ops.cafe_orders.order_status` transitions to `'ready_for_pickup'`:

```
TRIGGER: cafe-order-ready edge function

1. Look up menu.items.recipe_id for each line in the order
2. If recipe_id exists:
   a. Fetch cafe.recipe_ingredients for this recipe
   b. For each ingredient:
      deduction_qty = recipe_ingredient.quantity * cart_line.quantity * (1 + recipe_ingredient.wastage_pct)
      UPDATE cafe.ingredients
         SET current_stock = current_stock - deduction_qty
       WHERE id = recipe_ingredient.ingredient_id
3. If any ingredient current_stock < 0 after deduction:
   a. Log warning (do NOT block the order — merchant may allow negative stock)
   b. Alert manager via notification
4. If any ingredient current_stock <= threshold_qty:
   a. Log low-stock alert
```

**Idempotency:** Recipe deduction uses the `ops.cafe_orders.id` + `'recipe_deducted'` flag in metadata. Deduction fires exactly once per order.

#### 5.5.5 Slot Assignment on T4

When an order reaches `ready_for_pickup`, the T4 DDS (expediter) assigns a physical pickup slot.

```
Edge function: cafe-order-assign-slot

INPUT: order_id, slot_number (1..N, where N = store's configured slot count)

VALIDATION:
  1. order_status must be 'ready_for_pickup'
  2. slot_number must not be currently assigned to another active order
  3. caller must have process_sales permission

SIDE EFFECTS:
  1. UPDATE ops.cafe_orders SET slot_number = ?
  2. Broadcast via Supabase Realtime:
     Channel: cafe:store:{store_id}
     Payload: { event: 'slot_assigned', order_id, slot_number, order_number, items_summary }
  3. If service_mode = 'delivery': trigger HSAL booking (§5.5.6)
```

#### 5.5.6 HSAL Delivery Trigger

```
TRIGGER: After T4 slot assignment IF service_mode = 'delivery'
Edge function: hsal-booking-create

PAYLOAD:
{
  "store_location": { "lat": store.lat, "lng": store.lng, "address": store.address },
  "customer_phone": cart.customer_phone,
  "customer_name": cart.customer_name,
  "slot_number": ops.cafe_orders.slot_number,
  "order_summary": {
    "invoice_number": sal.sales_invoices.invoice_number,
    "item_count": cart.line_count,
    "total_khr": cart.grand_total_khr
  },
  "pickup_instructions": "TMA delivery order"
}

FLOW:
  1. Call HSAL /book-delivery API
  2. On success: store HSAL booking reference in ops.cafe_orders.metadata.hsal_booking_id
  3. On failure: retry 3x with backoff. If all fail, alert manager. Order remains ready_for_pickup.
```

---

### 5.6 Order Completion Pipeline

#### 5.6.1 Pipeline Overview

```
pos.carts (paid) → sal.sales_invoices (final) → sal.receipts (issued)
                        ↓
              ops.cafe_orders (served) → Rotanak earn → HSAL (if delivery)
```

This is a **one-way, append-only pipeline**. No step can be reversed without creating a new compensating record.

#### 5.6.2 Step-by-Step Flow

| Step | Condition | Edge Function | Action | Output |
|---|---|---|---|---|
| 1 | `cart_status = 'paid'` | `pos-invoice-create` | INSERT `sal.sales_invoice` — snapshot of cart | `sales_invoices.id` |
| 2 | Invoice created | `pos-receipt-create` | INSERT `sal.receipts` — customer-facing document | `receipts.id`, `receipt_number` |
| 3 | Receipt created | `cafe-order-complete` (cafe only) | UPDATE `ops.cafe_orders SET order_status = 'served', served_at = now()` | — |
| 4 | Order served + `origin_channel = 'walk_in'` | `rotanak-coin-earn` | Call Rotanak earn API | `ops.cafe_orders.rotanak_coins_earned` populated |
| 5 | Order served + `service_mode = 'delivery'` | `hsal-booking-create` | Fire HSAL booking (may have been pre-fired at ready_for_pickup) | `metadata.hsal_booking_id` |

#### 5.6.3 When Rotanak Earn Fires

```
TRIGGER: ops.cafe_orders.order_status = 'served'

CONDITIONS:
  1. store has Rotanak integration enabled
  2. cart.customer_phone is not NULL (needed for loyalty lookup)
  3. order originated from walk_in (TMA orders earn via TMA flow, not POS)

COMPUTATION:
  coins_earned = FLOOR(grand_total_khr * earn_rate / 100)
  WHERE earn_rate = rotanak_tier.earn_rate (1%, 2%, or 3% based on tier)

  Example: Gold tier (3%), order total = ៛60,000
  coins_earned = FLOOR(60000 * 3 / 100) = 1800 Sleung Coins

IDEMPOTENCY:
  - Check ops.cafe_orders.rotanak_coins_earned > 0 before firing
  - If already populated, return existing value (no double-earn)
```

See `Part 8, §8.5` for full Rotanak math.

#### 5.6.4 Financial Append-Only Guarantees

| Table | Append-Only Rule | Enforcement |
|---|---|---|
| `sal.sales_invoices` | Never UPDATE after INSERT. Only `invoice_status` may change (`final` → `voided`). | Edge function `pos-invoice-create` is the only writer. No UPDATE API exposed. |
| `sal.receipts` | Never UPDATE. Reprints create new rows with `receipt_status = 'reprinted'`. | Edge function `pos-receipt-create` is the only writer. |
| `pos.tenders` | Never UPDATE `amount` after INSERT. `tender_status` may progress: `pending` → `authorized` → `captured` / `failed` / `refunded`. | CHECK constraint on status transitions. Edge functions control transitions. |
| `pos.tender_attempts` | Pure INSERT-only. No UPDATE allowed. | Database trigger rejects UPDATE. |

**Void/Reversal pattern:** When an invoice must be reversed, a new `sal.receipts` row is created with `receipt_status = 'voided'` and a reversal tender row in `pos.tenders`. The original invoice row stays intact.

---

### 5.7 Franchise & Tenancy Model

**Authority:** Business Logic Agent + Founder Reconciliation (v1.1.0). Resolves R-5 in scope.

The chain-portal (product #2) manages the **set of shops** under a brand. That set has two structurally different shapes, distinguished at the **company layer** — not by a flag on the store.

#### 5.7.1 Two shapes

| Shape | Structure | `cp.tenants.billing_mode` | `cp.franchise_agreements` row? |
|---|---|---|---|
| **Single-owner chain** | One brand `cp.tenants` → one `fin.companies` → many `pos.stores` | `direct` | No |
| **Franchise** | One brand `cp.tenants` → multiple `fin.companies` (one per franchisee) → each franchisee's stores | `brand_consolidated` or `franchisee_direct` | Yes — one per franchisee |

A single owner running ten branches is **not** a franchise: it is one legal entity (`fin.companies`) owning ten stores. A franchise is when a brand licenses **separate legal entities** to operate under it — each franchisee is its own `fin.companies` with its own `cp.franchise_agreements` row.

#### 5.7.2 Billing-mode derivation (the subscription payer)

The subscription payer is **derived**, never hardcoded:

```
if tenant.billing_mode == 'direct':
    payer = the tenant's single fin.companies            # single-owner
elif agreement.billing_mode == 'brand_consolidated':
    payer = the brand company                            # brand pays one bill for all franchise stores
elif agreement.billing_mode == 'franchisee_direct':
    payer = the franchisee's own fin.companies           # each franchisee pays its own subscription
```

This is the v1.1.0 resolution of the founder decision "configurable per franchise agreement" (see Appendix C.6). The derivation runs in the subscription-billing edge function (Part 7) at invoice time; see Part 8 §8.7 for the subscription lifecycle that consumes it.

#### 5.7.3 Menu-push rights

`cp.franchise_agreements.menu_push_rights` governs how a brand's central menu reaches a franchisee:

| Value | Behaviour |
|---|---|
| `full` | Brand pushes menu/price/modifier changes directly to the franchisee's stores |
| `approve` | Brand proposes; the franchisee must accept before it goes live (default) |
| `none` | Franchisee runs an independent menu; brand cannot push |

Owned branches (single-owner chain) always receive direct pushes — they share one company, so there is no agreement gate.

#### 5.7.4 Drill-down boundary

The chain-portal manages the **set**; when a brand owner opens **one shop**, they are handed that shop's **seller-portal view, scoped** (per the locked product model, Part 17). The chain-portal pushes config *down*; the seller-portal/app manages *one shop*.


---


---


## Part 6: Database Schema

**Version:** v1.0.0  
**Authority:** Schema Authority (supreme veto on all storage shape decisions)  
**Date:** 29 May 2026  
**Status:** Canonical — all conflicts R-1 through R-4 RESOLVED

---

### 6.1 Schema Overview

#### 6.1.1 Namespace Map

| Namespace | Purpose | Tables |
|---|---|---|
| `core.*` | Helper functions for RLS, tenancy, and system utilities | Functions only — no tenant-scoped tables |
| `cp.*` | Control plane: tenants, accounts, memberships, RBAC | `tenants`, `accounts`, `tenant_memberships` |

> **Note:** Roles are implemented as enum `membership_role` on `cp.tenant_memberships.role`, not as a separate table. `cp.roles` does not exist in v1.0.0.
| `fin.*` | Financial entities: companies, tax, accounting boundaries | `companies` |
| `pos.*` | Point of sale: stores, registers, shifts, sessions, carts, tenders, offline sync | `stores`, `registers`, `shifts`, `sessions`, `carts`, `cart_lines`, `tenders`, `tender_attempts`, `offline_sync_batches`, `offline_sync_events` |
| `sal.*` | Sales documents: invoices, receipts (append-only financial truth) | `sales_invoices`, `receipts` |
| `menu.*` | **Canonical catalog namespace (R-4).** Sellable items, categories, pricing, modifier linkage | `categories`, `items`, `item_modifier_groups`, `price_history` |
| `cafe.*` | Café vertical: modifiers, recipes, ingredients, tabs | `modifier_groups`, `modifiers`, `recipes`, `recipe_ingredients`, `ingredients`, `tabs` |
| `ops.*` | Operational layer: café order tracking, production tickets | `cafe_orders` |

#### 6.1.2 Multi-Tenancy Pattern

Every tenant-scoped table **MUST** include:

```sql
    tenant_id uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
```

All queries from edge functions **MUST** scope to `tenant_id = core.current_tenant_id()`.  
All RLS policies **MUST** use the canonical template (§6.1.4).

#### 6.1.3 Money Model

Per Master Context §2 P4 and R-1 resolution:

| Layer | Type | Format | Example |
|---|---|---|---|
| **Storage** | `numeric(18,4)` | USD-primary, 4 decimal places | `1234.5600` |
| **Display** | Integer KHR only | Via `formatKHR()` function | `៛60,000` |
| **Café derived columns** | `bigint` (KHR integer) | Written at cart finalization time | `60000` |

No `money`, `decimal(10,2)`, `float`, or `double precision` types are permitted for monetary values.

#### 6.1.4 RLS Policy Template

Every tenant-scoped table **MUST** execute:

```sql
ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY {table}_tenant_isolation ON {schema}.{table}
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

The `core.is_service_role()` check allows Supabase Edge Functions (running with `service_role` key) to bypass RLS for cross-tenant administrative operations.

#### 6.1.5 Naming Conventions

| Rule | Example | Counter-Example |
|---|---|---|
| Table names: singular noun | `pos.cart` | ~~`pos.carts`~~ (except `pos.cart_lines` — junction pattern) |
| Primary key: always `id` | `pos.stores.id` | ~~`pos.stores.store_id`~~ |
| Foreign key column: `{referenced_table}_id` | `pos.registers.store_id` | ~~`pos.registers.store`~~ |
| Timestamps: `created_at`, `updated_at` | `created_at timestamptz` | ~~`created`, `modified`~~ |
| Soft delete: `deleted_at timestamptz` (nullable) | `deleted_at timestamptz` | ~~`is_deleted boolean`~~ |
| Enums: `{purpose}_type` suffix, `text CHECK` | `cart_status text` | ~~`INT` enum~~ |
| Idempotency key: `idempotency_key text` | `idempotency_key text UNIQUE` | — |

---

### 6.2 Core Tables (Complete DDL)

---

#### 6.2.1 Schema: `cp` — Control Plane

**Migration file:** `001_cp_schema.sql`

---

##### Table: `cp.tenants`

Top-level account. Brand, chain, or single-store SME. Everything scoped under a tenant.

```sql
CREATE TABLE cp.tenants (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text NOT NULL UNIQUE,
    display_name    text NOT NULL,
    billing_email   text NOT NULL,
    billing_phone   text,
    subscription_tier text NOT NULL DEFAULT 'starter'
        CHECK (subscription_tier IN ('starter','growth','enterprise')),
    billing_mode    text NOT NULL DEFAULT 'direct'
        CHECK (billing_mode IN ('direct','brand_consolidated','franchisee_direct')),
    -- R-5 (v1.1.0): franchise IS in scope. 'direct' = single-owner (incl. owner-operated
    -- multi-store chains). 'brand_consolidated' = brand company pays one bill for all
    -- franchise stores. 'franchisee_direct' = each franchisee company pays its own
    -- subscription. The subscription payer is derived from this value (see Part 8 §8.7,
    -- Appendix C.6). Franchise relationship detail lives in cp.franchise_agreements.
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cp.tenants IS 'Top-level account. All data is scoped to a tenant.';
COMMENT ON COLUMN cp.tenants.billing_mode IS 'R-5 RESOLVED v1.1.0: direct | brand_consolidated | franchisee_direct. Subscription payer derived from this value. See cp.franchise_agreements.';
```

> RLS: Not tenant-scoped (it IS the tenant). Protected by application-level checks.

```sql
ALTER TABLE cp.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenants_owner_isolation ON cp.tenants
    FOR ALL
    USING (core.is_service_role() OR id IN (
        SELECT tenant_id FROM cp.tenant_memberships
        WHERE account_id = core.current_account_id()
    ));
```

---

##### Table: `cp.franchise_agreements`

The franchise relationship layer (R-5, RESOLVED in v1.1.0). Links a **brand tenant** to a
**franchisee company** and carries the billing + royalty terms. A single-owner multi-store
chain does NOT need a row here (its `cp.tenants.billing_mode = 'direct'`); franchise rows
exist only when a brand licenses a separate legal entity to operate under it.

Distinction enforced at the company layer (see Part 8 §8.1):
- **Single-owner chain** = one `fin.companies` row, many `pos.stores`. No franchise agreement.
- **Franchise** = one brand `cp.tenants`, multiple `fin.companies` (one per franchisee), each
  with a `cp.franchise_agreements` row and its own stores.

```sql
CREATE TABLE cp.franchise_agreements (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_tenant_id     uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
        -- the brand that owns the franchise program
    franchisee_company_id uuid NOT NULL REFERENCES fin.companies(id) ON DELETE RESTRICT,
        -- the franchisee legal entity operating under the brand
    billing_mode        text NOT NULL
        CHECK (billing_mode IN ('brand_consolidated','franchisee_direct')),
        -- determines the subscription payer (Part 8 §8.7). 'direct' is NOT valid here:
        -- a franchise agreement is by definition non-direct.
    royalty_pct         numeric(5,2),
        -- optional brand royalty on franchisee revenue; null = none
    menu_push_rights    text NOT NULL DEFAULT 'approve'
        CHECK (menu_push_rights IN ('full','approve','none')),
        -- full = brand pushes menu directly; approve = franchisee must accept; none = independent
    status              text NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','suspended','terminated')),
    start_date          date NOT NULL DEFAULT current_date,
    end_date            date,
    metadata            jsonb DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (brand_tenant_id, franchisee_company_id)
);

CREATE INDEX idx_franchise_brand ON cp.franchise_agreements(brand_tenant_id);
CREATE INDEX idx_franchise_franchisee ON cp.franchise_agreements(franchisee_company_id);

COMMENT ON TABLE cp.franchise_agreements IS 'R-5 RESOLVED v1.1.0. Brand tenant ↔ franchisee company. billing_mode derives the subscription payer. Single-owner chains do not have rows here.';
```

> RLS: tenant-scoped to the brand. Service role + brand membership can read/write; a
> franchisee account may read its own agreement.

```sql
ALTER TABLE cp.franchise_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY franchise_brand_isolation ON cp.franchise_agreements
    FOR ALL
    USING (core.is_service_role() OR brand_tenant_id IN (
        SELECT tenant_id FROM cp.tenant_memberships
        WHERE account_id = core.current_account_id()
    ));
```

---

##### Table: `cp.accounts`

Canonical identity record. One row per human. Links to `auth.users(id)` via `auth_user_id`.
Replaces the ghost table `core.users` per R-2.

```sql
CREATE TABLE cp.accounts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id    uuid UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
        -- Single Identity per Master Context §2 P2
    email           text UNIQUE,
    phone           text UNIQUE,
        -- Phone OTP primary per Master Context §7
    display_name    text NOT NULL,
    avatar_url      text,
    preferred_language text NOT NULL DEFAULT 'km',
        -- Khmer-first per project identity
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_accounts_auth_user_id ON cp.accounts(auth_user_id);
CREATE INDEX idx_accounts_phone ON cp.accounts(phone) WHERE phone IS NOT NULL;

COMMENT ON TABLE cp.accounts IS 'Canonical user identity. Replaces ghost table core.users (R-2). One row per human across HET ecosystem.';
```

> RLS: Not directly tenant-scoped. Access controlled by `cp.tenant_memberships`.

```sql
ALTER TABLE cp.accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY accounts_self_access ON cp.accounts
    FOR ALL
    USING (core.is_service_role() OR id = core.current_account_id());
```

---

##### Table: `cp.tenant_memberships`

Junction: which accounts belong to which tenants, and in what role.

```sql
CREATE TABLE cp.tenant_memberships (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    account_id      uuid NOT NULL REFERENCES cp.accounts(id) ON DELETE CASCADE,
    membership_role text NOT NULL DEFAULT 'cashier'
        CHECK (membership_role IN ('owner','manager','cashier','kitchen_staff','readonly')),
        -- See §6.3 enum: membership_role
    is_primary      boolean NOT NULL DEFAULT false,
        -- The tenant this account sees by default in the UI
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, account_id)
);

CREATE INDEX idx_tenant_memberships_tenant ON cp.tenant_memberships(tenant_id);
CREATE INDEX idx_tenant_memberships_account ON cp.tenant_memberships(account_id);

COMMENT ON TABLE cp.tenant_memberships IS 'Junction: accounts ↔ tenants with role. Enforces that an account can belong to multiple tenants.';
```

```sql
ALTER TABLE cp.tenant_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_memberships_tenant_isolation ON cp.tenant_memberships
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.2 Schema: `fin` — Financial Entities

**Migration file:** `002_fin_schema.sql`

---

##### Table: `fin.companies`

Legal entity within a tenant. Billing and accounting boundary.

```sql
CREATE TABLE fin.companies (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    display_name    text NOT NULL,
    legal_name      text,
    tax_id          text,
    address         text,
    city            text,
    country         text NOT NULL DEFAULT 'KH',
    currency_code   text NOT NULL DEFAULT 'USD',
        -- Storage currency. Display is always KHR.
    is_default      boolean NOT NULL DEFAULT false,
        -- The default company for new stores in this tenant
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_companies_tenant ON fin.companies(tenant_id);

COMMENT ON TABLE fin.companies IS 'Legal entity within a tenant. Billing and accounting boundary. Cambodia stub for tax.seed_cambodia_stub (future).';
```

```sql
ALTER TABLE fin.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY companies_tenant_isolation ON fin.companies
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.3 Schema: `pos` — Point of Sale

**Migration file:** `003_pos_core.sql`

---

##### Table: `pos.stores`

Physical shop. Carries immutable `vertical_type`. 1:1 with Hub Server.
Replaces the ghost table `core.stores` per R-2.

```sql
CREATE TABLE pos.stores (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    company_id      uuid REFERENCES fin.companies(id) ON DELETE SET NULL,
    display_name    text NOT NULL,
    slug            text NOT NULL,
    vertical_type   text NOT NULL
        CHECK (vertical_type IN ('laundry','cafe','restaurant','retail')),
        -- Master Context §2 P1: 1 Store = 1 Vertical, immutable
    address         text,
    city            text NOT NULL DEFAULT 'Phnom Penh',
    country         text NOT NULL DEFAULT 'KH',
    phone           text,
    timezone        text NOT NULL DEFAULT 'Asia/Phnom_Penh',
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, slug)
);

CREATE INDEX idx_stores_tenant ON pos.stores(tenant_id);
CREATE INDEX idx_stores_vertical ON pos.stores(vertical_type) WHERE vertical_type IN ('laundry','cafe');

COMMENT ON TABLE pos.stores IS 'Physical shop. Immutable vertical_type. Replaces ghost table core.stores (R-2). 1:1 with Hub Server.';
```

```sql
ALTER TABLE pos.stores ENABLE ROW LEVEL SECURITY;

CREATE POLICY stores_tenant_isolation ON pos.stores
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.registers`

POS terminal record. T1–T5 types.
Replaces the ghost table `pos.terminals` per R-2.

```sql
CREATE TABLE pos.registers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    display_name    text NOT NULL,
    register_type   text NOT NULL
        CHECK (register_type IN ('t1_cashier','t2_cds','t3_kds','t4_dds','t5_qds')),
        -- See §6.3 enum: register_type
    device_uuid     text UNIQUE,
        -- Hardware identifier. Used in idempotency keys.
    hardware_spec   jsonb DEFAULT '{}',
        -- {pi_model, storage_gb, printer_model, screen_count}
    is_active       boolean NOT NULL DEFAULT true,
    last_heartbeat  timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_registers_store ON pos.registers(store_id);
CREATE INDEX idx_registers_device_uuid ON pos.registers(device_uuid) WHERE device_uuid IS NOT NULL;

COMMENT ON TABLE pos.registers IS 'POS terminal record (T1-T5). Replaces ghost table pos.terminals (R-2). device_uuid used in idempotency keys.';
```

```sql
ALTER TABLE pos.registers ENABLE ROW LEVEL SECURITY;

CREATE POLICY registers_tenant_isolation ON pos.registers
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.shifts`

Cashier operating period. Opened with float, closed with reconciliation. Z-report at close.

```sql
CREATE TABLE pos.shifts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    register_id     uuid NOT NULL REFERENCES pos.registers(id) ON DELETE CASCADE,
    opened_by       uuid NOT NULL REFERENCES cp.accounts(id) ON DELETE RESTRICT,
        -- The cashier who opened the shift
    opened_at       timestamptz NOT NULL DEFAULT now(),
    opening_float   numeric(18,4) NOT NULL DEFAULT 0,
        -- Cash in drawer at shift start
    closed_by       uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    closed_at       timestamptz,
    closing_float   numeric(18,4),
        -- Cash counted at shift end
    expected_float  numeric(18,4),
        -- Computed: opening_float + cash_sales - cash_refunds
    discrepancy     numeric(18,4),
        -- closing_float - expected_float
    z_report_data   jsonb,
        -- Snapshot of all sales/payments during shift for Z-report
    is_closed       boolean NOT NULL DEFAULT false,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shifts_store ON pos.shifts(store_id);
CREATE INDEX idx_shifts_register ON pos.shifts(register_id);
CREATE INDEX idx_shifts_open ON pos.shifts(store_id, is_closed, opened_at);

COMMENT ON TABLE pos.shifts IS 'Cashier operating period. Float in, reconciliation out. Z-report at close.';
```

```sql
ALTER TABLE pos.shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY shifts_tenant_isolation ON pos.shifts
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.sessions`

Staff login on a register. Inside a shift. Auto-locks after inactivity.

```sql
CREATE TABLE pos.sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    shift_id        uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE CASCADE,
    register_id     uuid NOT NULL REFERENCES pos.registers(id) ON DELETE CASCADE,
    account_id      uuid NOT NULL REFERENCES cp.accounts(id) ON DELETE RESTRICT,
        -- The logged-in staff member
    started_at      timestamptz NOT NULL DEFAULT now(),
    ended_at        timestamptz,
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_shift ON pos.sessions(shift_id);
CREATE INDEX idx_sessions_account ON pos.sessions(account_id);
CREATE INDEX idx_sessions_active ON pos.sessions(register_id, is_active) WHERE is_active = true;

COMMENT ON TABLE pos.sessions IS 'Staff login session on a register. Lives inside a shift. Auto-lock after inactivity.';
```

```sql
ALTER TABLE pos.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sessions_tenant_isolation ON pos.sessions
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

**Migration file:** `004_pos_carts.sql`

---

##### Table: `pos.carts`

Order-in-progress. Becomes `sal.sales_invoice` + `sal.receipt` on completion.  
**Financial source of truth.** Per R-3, `ops.cafe_orders` references this table; it does not replace it.

```sql
CREATE TABLE pos.carts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    register_id     uuid NOT NULL REFERENCES pos.registers(id) ON DELETE CASCADE,
    shift_id        uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
    session_id      uuid REFERENCES pos.sessions(id) ON DELETE SET NULL,
        -- Nullable: a cart may survive session expiry (tab behavior)
    cart_status     text NOT NULL DEFAULT 'open'
        CHECK (cart_status IN ('open','locked','paid','cancelled','refunded')),
        -- See §6.3 enum: cart_status
    service_mode    text NOT NULL DEFAULT 'dine_in'
        CHECK (service_mode IN ('dine_in','takeaway','delivery')),
        -- See §6.3 enum: service_mode
    origin_channel  text NOT NULL DEFAULT 'walk_in'
        CHECK (origin_channel IN ('walk_in','tma')),
        -- See §6.3 enum: origin_channel
    customer_name   text,
    customer_phone  text,
        -- For order retrieval, loyalty lookup, delivery
    tab_id          uuid,
        -- Nullable FK to cafe.tabs (§6.2.6). Set when cart is linked to an open tab.
    subtotal        numeric(18,4) NOT NULL DEFAULT 0,
    discount_total  numeric(18,4) NOT NULL DEFAULT 0,
    tax_total       numeric(18,4) NOT NULL DEFAULT 0,
    tip_amount      numeric(18,4) NOT NULL DEFAULT 0,
    grand_total     numeric(18,4) NOT NULL DEFAULT 0,
    total_paid      numeric(18,4) NOT NULL DEFAULT 0,
    change_due      numeric(18,4) NOT NULL DEFAULT 0,
    -- Café derived KHR columns (R-1 resolution)
    grand_total_khr bigint NOT NULL DEFAULT 0,
    total_paid_khr  bigint NOT NULL DEFAULT 0,
    change_due_khr  bigint NOT NULL DEFAULT 0,
    -- Idempotency
    idempotency_key text UNIQUE,
        -- Format: [device_uuid]_[counter]_[timestamp] per Master Context §2 P9
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_carts_store ON pos.carts(store_id);
CREATE INDEX idx_carts_status ON pos.carts(store_id, cart_status);
CREATE INDEX idx_carts_shift ON pos.carts(shift_id);
CREATE INDEX idx_carts_idempotency ON pos.carts(idempotency_key) WHERE idempotency_key IS NOT NULL;

COMMENT ON TABLE pos.carts IS 'Order-in-progress. Financial source of truth. Per R-3, ops.cafe_orders references this table via cart_id FK.';
COMMENT ON COLUMN pos.carts.tab_id IS 'Nullable FK to cafe.tabs. Set when cart is linked to an open tab. Formal FK added in cafe schema migration.';
```

```sql
ALTER TABLE pos.carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY carts_tenant_isolation ON pos.carts
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.cart_lines`

Single line on a cart: item, modifier upcharges, fees, discounts, adjustments.

```sql
CREATE TABLE pos.cart_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    cart_id         uuid NOT NULL REFERENCES pos.carts(id) ON DELETE CASCADE,
    line_number     int NOT NULL,
        -- 1-based display order within the cart
    item_id         uuid NOT NULL REFERENCES menu.items(id) ON DELETE RESTRICT,
        -- R-4 resolution: menu.items is the canonical item catalog
    display_name    text NOT NULL,
        -- Denormalized: item name + modifiers at time of sale
    quantity        numeric(18,4) NOT NULL DEFAULT 1,
        -- Supports fractional quantities (e.g., 0.5 kg laundry)
    unit_price      numeric(18,4) NOT NULL DEFAULT 0,
    line_discount   numeric(18,4) NOT NULL DEFAULT 0,
    line_subtotal   numeric(18,4) NOT NULL DEFAULT 0,
        -- (unit_price * quantity) - line_discount
    line_tax        numeric(18,4) NOT NULL DEFAULT 0,
    line_total      numeric(18,4) NOT NULL DEFAULT 0,
        -- line_subtotal + line_tax (final amount for this line)
    -- KHR derived columns (R-1)
    unit_price_khr  bigint NOT NULL DEFAULT 0,
    line_total_khr  bigint NOT NULL DEFAULT 0,
    -- Modifiers snapshot (denormalized for performance)
    modifier_summary text,
        -- Human-readable modifier selection, e.g., "+Extra Shot, -No Sugar"
    modifier_data   jsonb DEFAULT '[]',
        -- Array of {modifier_group_id, modifier_ids[], upcharge}
    -- Operational fields
    is_voided       boolean NOT NULL DEFAULT false,
    voided_at       timestamptz,
    voided_by       uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    void_reason     text,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(cart_id, line_number)
);

CREATE INDEX idx_cart_lines_cart ON pos.cart_lines(cart_id);
CREATE INDEX idx_cart_lines_item ON pos.cart_lines(item_id);

COMMENT ON TABLE pos.cart_lines IS 'Line items on a cart. References menu.items (R-4). Denormalizes display_name and modifiers for immutable sales record.';
```

```sql
ALTER TABLE pos.cart_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY cart_lines_tenant_isolation ON pos.cart_lines
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

**Migration file:** `005_pos_tenders.sql`

---

##### Table: `pos.tenders`

Payment on a cart. Split tender = multiple rows.  
Append-only per Master Context §2 P8.

```sql
CREATE TABLE pos.tenders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    cart_id         uuid NOT NULL REFERENCES pos.carts(id) ON DELETE CASCADE,
    tender_type     text NOT NULL
        CHECK (tender_type IN ('cash','aba_card','aba_khqr','sleung_coin','debt')),
        -- See §6.3 enum: tender_type
    tender_status   text NOT NULL DEFAULT 'pending'
        CHECK (tender_status IN ('pending','authorized','captured','failed','refunded','voided')),
        -- See §6.3 enum: tender_status
    amount          numeric(18,4) NOT NULL,
    amount_khr      bigint NOT NULL DEFAULT 0,
    tip_amount      numeric(18,4) NOT NULL DEFAULT 0,
    tip_khr         bigint NOT NULL DEFAULT 0,
    -- ABA PayWay specific
    aba_payway_ref  text,
        -- Transaction reference from ABA PayWay API
    aba_token       text,
        -- Tokenized card reference for repeat use
    -- KHQR specific
    khqr_trace_id   text,
        -- Bakong trace ID for reconciliation
    -- Sleung Coin (Rotanak) specific
    sleung_coins_used bigint NOT NULL DEFAULT 0,
    -- Idempotency
    idempotency_key text NOT NULL,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(cart_id, idempotency_key)
);

CREATE INDEX idx_tenders_cart ON pos.tenders(cart_id);
CREATE INDEX idx_tenders_status ON pos.tenders(tender_status);
CREATE INDEX idx_tenders_aba_ref ON pos.tenders(aba_payway_ref) WHERE aba_payway_ref IS NOT NULL;

COMMENT ON TABLE pos.tenders IS 'Payment on a cart. Split tender supported. Append-only financial record (P8).';
```

```sql
ALTER TABLE pos.tenders ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenders_tenant_isolation ON pos.tenders
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.tender_attempts`

Individual authorization attempt. Supports KHQR polling retries, card 3DS.

```sql
CREATE TABLE pos.tender_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    tender_id       uuid NOT NULL REFERENCES pos.tenders(id) ON DELETE CASCADE,
    attempt_number  int NOT NULL DEFAULT 1,
    status          text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','processing','success','failed','timeout')),
    gateway         text NOT NULL
        CHECK (gateway IN ('aba_payway','rotanak','internal')),
    request_payload jsonb NOT NULL DEFAULT '{}',
    response_payload jsonb DEFAULT '{}',
    error_code      text,
    error_message   text,
    started_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tender_id, attempt_number)
);

CREATE INDEX idx_tender_attempts_tender ON pos.tender_attempts(tender_id);
CREATE INDEX idx_tender_attempts_status ON pos.tender_attempts(status);

COMMENT ON TABLE pos.tender_attempts IS 'Individual auth attempt for a tender. Supports KHQR polling retries and card 3DS (Part 4).';
```

```sql
ALTER TABLE pos.tender_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY tender_attempts_tenant_isolation ON pos.tender_attempts
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

**Migration file:** `006_pos_offline_sync.sql`

---

##### Table: `pos.offline_sync_batches`

Sync envelope. One batch = one Hub Server sync attempt.

```sql
CREATE TABLE pos.offline_sync_batches (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    device_uuid     text NOT NULL,
        -- The Hub Server device that generated this batch
    batch_status    text NOT NULL DEFAULT 'pending'
        CHECK (batch_status IN ('pending','syncing','synced','conflict','error','partial')),
        -- See §6.3 enum: sync_status
    event_count     int NOT NULL DEFAULT 0,
    synced_count    int NOT NULL DEFAULT 0,
    conflict_count  int NOT NULL DEFAULT 0,
    error_count     int NOT NULL DEFAULT 0,
    started_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    error_log       jsonb DEFAULT '[]',
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_batches_store ON pos.offline_sync_batches(store_id);
CREATE INDEX idx_sync_batches_status ON pos.offline_sync_batches(batch_status);

COMMENT ON TABLE pos.offline_sync_batches IS 'Offline sync envelope. One batch = one Hub Server sync attempt.';
```

```sql
ALTER TABLE pos.offline_sync_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_batches_tenant_isolation ON pos.offline_sync_batches
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `pos.offline_sync_events`

Individual event within a sync batch.

```sql
CREATE TABLE pos.offline_sync_events (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    batch_id        uuid NOT NULL REFERENCES pos.offline_sync_batches(id) ON DELETE CASCADE,
    event_type      text NOT NULL
        CHECK (event_type IN ('cart_create','cart_update','tender_create','tender_attempt',
                              'shift_open','shift_close','session_start','session_end',
                              'item_update','price_update')),
        -- See §6.3 enum: sync_event_type
    event_status    text NOT NULL DEFAULT 'pending'
        CHECK (event_status IN ('pending','synced','conflict','error')),
        -- See §6.3 enum: sync_status
    table_name      text NOT NULL,
    record_id       uuid NOT NULL,
    payload         jsonb NOT NULL,
        -- The full row data as JSON at time of capture
    conflict_info   jsonb,
        -- Populated when event_status = 'conflict'. Contains server-side values.
    idempotency_key text NOT NULL,
    processed_at    timestamptz,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sync_events_batch ON pos.offline_sync_events(batch_id);
CREATE INDEX idx_sync_events_status ON pos.offline_sync_events(event_status);
CREATE INDEX idx_sync_events_idempotency ON pos.offline_sync_events(idempotency_key);

COMMENT ON TABLE pos.offline_sync_events IS 'Individual event within a sync batch. Idempotency key prevents duplicate processing.';
```

```sql
ALTER TABLE pos.offline_sync_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY sync_events_tenant_isolation ON pos.offline_sync_events
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.4 Schema: `sal` — Sales Documents (Append-Only)

**Migration file:** `007_sal_documents.sql`

> Per Master Context §2 P8: invoices, receipts, tenders, and tender attempts are append-only. Never overwritten.

---

##### Table: `sal.sales_invoices`

Immutable financial record generated on cart completion.  
`pos.carts` → `sal.sales_invoices` is one-way; invoices are never updated after creation.

```sql
CREATE TABLE sal.sales_invoices (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    cart_id         uuid NOT NULL REFERENCES pos.carts(id) ON DELETE RESTRICT,
        -- One invoice per cart. Cart must exist for audit trail.
    shift_id        uuid NOT NULL REFERENCES pos.shifts(id) ON DELETE RESTRICT,
    register_id     uuid NOT NULL REFERENCES pos.registers(id) ON DELETE RESTRICT,
    invoice_number  text NOT NULL,
        -- Human-readable: INV-{store_code}-{YYYYMMDD}-{sequence}
    invoice_status  text NOT NULL DEFAULT 'final'
        CHECK (invoice_status IN ('draft','final','voided')),
        -- See §6.3 enum: invoice_status. 'draft' only for offline-synced carts pending validation.
    service_mode    text NOT NULL,
    origin_channel  text NOT NULL,
    customer_name   text,
    customer_phone  text,
    -- Financial snapshot (immutable)
    line_count      int NOT NULL DEFAULT 0,
    subtotal        numeric(18,4) NOT NULL DEFAULT 0,
    discount_total  numeric(18,4) NOT NULL DEFAULT 0,
    tax_total       numeric(18,4) NOT NULL DEFAULT 0,
    tip_amount      numeric(18,4) NOT NULL DEFAULT 0,
    grand_total     numeric(18,4) NOT NULL DEFAULT 0,
    total_paid      numeric(18,4) NOT NULL DEFAULT 0,
    change_due      numeric(18,4) NOT NULL DEFAULT 0,
    -- KHR derived
    grand_total_khr bigint NOT NULL DEFAULT 0,
    total_paid_khr  bigint NOT NULL DEFAULT 0,
    change_due_khr  bigint NOT NULL DEFAULT 0,
    -- Denormalized line data for fast invoice display without JOIN
    line_items      jsonb NOT NULL DEFAULT '[]',
        -- Array of {line_number, item_name, qty, unit_price, modifiers, total}
    -- Void (rare — creates reversal receipt)
    voided_at       timestamptz,
    voided_by       uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    void_reason     text,
    -- Metadata
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
        -- No updated_at — append-only
);

CREATE INDEX idx_invoices_store ON sal.sales_invoices(store_id);
CREATE INDEX idx_invoices_cart ON sal.sales_invoices(cart_id);
CREATE INDEX idx_invoices_number ON sal.sales_invoices(invoice_number);
CREATE INDEX idx_invoices_created ON sal.sales_invoices(store_id, created_at);

COMMENT ON TABLE sal.sales_invoices IS 'Immutable financial record from completed cart. Append-only (P8). Denormalizes line items for fast retrieval.';
```

```sql
ALTER TABLE sal.sales_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_invoices_tenant_isolation ON sal.sales_invoices
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `sal.receipts`

Customer-facing receipt. One receipt per invoice (reprints are new rows with `receipt_status = 'reprinted'`).

```sql
CREATE TABLE sal.receipts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    invoice_id      uuid NOT NULL REFERENCES sal.sales_invoices(id) ON DELETE RESTRICT,
    cart_id         uuid NOT NULL REFERENCES pos.carts(id) ON DELETE RESTRICT,
    receipt_number  text NOT NULL,
        -- Human-readable: REC-{store_code}-{YYYYMMDD}-{sequence}
    receipt_status  text NOT NULL DEFAULT 'issued'
        CHECK (receipt_status IN ('issued','reprinted','voided')),
        -- See §6.3 enum: receipt_status
    print_count     int NOT NULL DEFAULT 1,
    -- Receipt content (denormalized for printing without JOINs)
    store_info      jsonb NOT NULL,
        -- {name, address, phone, tax_id} at time of print
    invoice_data    jsonb NOT NULL,
        -- Full invoice snapshot
    tender_data     jsonb NOT NULL DEFAULT '[]',
        -- Array of tender snapshots
    -- Reprint tracking
    original_receipt_id uuid REFERENCES sal.receipts(id) ON DELETE SET NULL,
    reprinted_at    timestamptz,
    reprinted_by    uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    reprint_reason  text,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipts_store ON sal.receipts(store_id);
CREATE INDEX idx_receipts_invoice ON sal.receipts(invoice_id);
CREATE INDEX idx_receipts_number ON sal.receipts(receipt_number);
CREATE INDEX idx_receipts_cart ON sal.receipts(cart_id);

COMMENT ON TABLE sal.receipts IS 'Customer-facing receipt. Reprints create new rows. Append-only (P8).';
```

```sql
ALTER TABLE sal.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipts_tenant_isolation ON sal.receipts
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.5 Schema: `menu` — Catalog (R-4 Resolution)

**Migration file:** `008_menu_catalog.sql`

> **R-4 Decision: Option B — `menu.*` namespace.**  
> Justification: `inv.*` implies full inventory management (purchase orders, stock transfers, suppliers) which is out of MVP scope. `menu.*` directly models the "catalog of sellable things" that every vertical has — a laundry's services, a café's food/drink items — keeping the schema clean and purpose-built. `cafe.ingredients` handles BOM tracking separately.

---

##### Table: `menu.categories`

Hierarchical item categories. Self-referencing for nested menus.

```sql
CREATE TABLE menu.categories (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid REFERENCES pos.stores(id) ON DELETE CASCADE,
        -- NULL = category available to all stores in tenant
    parent_id       uuid REFERENCES menu.categories(id) ON DELETE SET NULL,
        -- Self-reference for nesting (e.g., Beverages → Coffee → Iced Coffee)
    display_name    text NOT NULL,
    display_name_km text,
        -- Khmer display name (Khmer-first UI)
    sort_order      int NOT NULL DEFAULT 0,
    photo_url       text,
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_categories_tenant ON menu.categories(tenant_id);
CREATE INDEX idx_categories_store ON menu.categories(store_id) WHERE store_id IS NOT NULL;
CREATE INDEX idx_categories_parent ON menu.categories(parent_id) WHERE parent_id IS NOT NULL;

COMMENT ON TABLE menu.categories IS 'Hierarchical item categories. Self-referencing parent_id for nesting. store_id NULL = tenant-global.';
```

```sql
ALTER TABLE menu.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY categories_tenant_isolation ON menu.categories
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `menu.items`

Sellable item in the catalog. References `menu.categories` and optionally `cafe.recipes`.  
Replaces the ghost table `pos.items` per R-2.

```sql
CREATE TABLE menu.items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid REFERENCES pos.stores(id) ON DELETE CASCADE,
        -- NULL = available to all stores in tenant
    category_id     uuid REFERENCES menu.categories(id) ON DELETE SET NULL,
    recipe_id       uuid,
        -- Nullable FK to cafe.recipes. Added formally in cafe schema migration.
        -- Only set for café items with ingredient tracking.
    sku             text,
        -- Optional internal code
    display_name    text NOT NULL,
    display_name_km text,
        -- Khmer display name (Khmer-first UI)
    description     text,
    description_km  text,
    photo_url       text,
    -- Pricing
    base_price      numeric(18,4) NOT NULL DEFAULT 0,
        -- Base unit price in USD storage
    base_price_khr  bigint NOT NULL DEFAULT 0,
        -- Derived KHR integer at write time (R-1)
    pricing_type    text NOT NULL DEFAULT 'fixed'
        CHECK (pricing_type IN ('fixed','variable','tiered')),
        -- See §6.3 enum: pricing_type
    -- Vertical applicability
    applicable_verticals text[] NOT NULL DEFAULT '{laundry,cafe}',
        -- Which verticals can use this item. Empty = all.
        -- v1.0.0 only supports 'laundry' and 'cafe'.
    -- Flags
    is_active       boolean NOT NULL DEFAULT true,
    is_available    boolean NOT NULL DEFAULT true,
        -- Can be set false temporarily (out of stock) without disabling
    allow_modifiers boolean NOT NULL DEFAULT false,
        -- If true, item can have modifier groups attached
    -- Sorting
    sort_order      int NOT NULL DEFAULT 0,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, sku) WHERE sku IS NOT NULL
);

CREATE INDEX idx_items_tenant ON menu.items(tenant_id);
CREATE INDEX idx_items_store ON menu.items(store_id) WHERE store_id IS NOT NULL;
CREATE INDEX idx_items_category ON menu.items(category_id) WHERE category_id IS NOT NULL;
CREATE INDEX idx_items_active ON menu.items(tenant_id, is_active, is_available);

COMMENT ON TABLE menu.items IS 'Sellable item in catalog. Replaces ghost table pos.items (R-2). Links to cafe.recipes via recipe_id for ingredient tracking.';
```

```sql
ALTER TABLE menu.items ENABLE ROW LEVEL SECURITY;

CREATE POLICY items_tenant_isolation ON menu.items
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `menu.price_history`

Audit trail of price changes. Every `base_price` update on `menu.items` creates a row here.

```sql
CREATE TABLE menu.price_history (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    item_id         uuid NOT NULL REFERENCES menu.items(id) ON DELETE CASCADE,
    old_price       numeric(18,4) NOT NULL,
    new_price       numeric(18,4) NOT NULL,
    old_price_khr   bigint NOT NULL,
    new_price_khr   bigint NOT NULL,
    changed_by      uuid NOT NULL REFERENCES cp.accounts(id) ON DELETE RESTRICT,
    change_reason   text,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_price_history_item ON menu.price_history(item_id);
CREATE INDEX idx_price_history_created ON menu.price_history(item_id, created_at);

COMMENT ON TABLE menu.price_history IS 'Audit trail of price changes. Triggered on menu.items base_price update.';
```

```sql
ALTER TABLE menu.price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY price_history_tenant_isolation ON menu.price_history
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `menu.item_modifier_groups`

Junction: which modifier groups apply to which items.  
Enables "pick-one/pick-many" and "required/optional" constraints per item.

```sql
CREATE TABLE menu.item_modifier_groups (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    item_id             uuid NOT NULL REFERENCES menu.items(id) ON DELETE CASCADE,
    modifier_group_id   uuid NOT NULL,
        -- FK to cafe.modifier_groups added in cafe schema migration
    selection_type      text NOT NULL DEFAULT 'pick_one'
        CHECK (selection_type IN ('pick_one','pick_many')),
        -- See §6.3 enum: modifier_selection_type
    is_required         boolean NOT NULL DEFAULT false,
    sort_order          int NOT NULL DEFAULT 0,
    metadata            jsonb DEFAULT '{}',
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE(item_id, modifier_group_id)
);

CREATE INDEX idx_item_modifier_groups_item ON menu.item_modifier_groups(item_id);
CREATE INDEX idx_item_modifier_groups_group ON menu.item_modifier_groups(modifier_group_id);

COMMENT ON TABLE menu.item_modifier_groups IS 'Junction: items ↔ modifier groups. Per-item override of selection_type and is_required.';
```

```sql
ALTER TABLE menu.item_modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY item_modifier_groups_tenant_isolation ON menu.item_modifier_groups
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.6 Schema: `cafe` — Café Vertical

**Migration file:** `009_cafe_vertical.sql`

> Café vertical tables. These are ONLY used when `store.vertical_type = 'cafe'`.

---

##### Table: `cafe.modifier_groups`

Group of options on a menu item (e.g., "Size", "Sugar Level", "Toppings").

```sql
CREATE TABLE cafe.modifier_groups (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid REFERENCES pos.stores(id) ON DELETE CASCADE,
        -- NULL = available to all stores in tenant
    display_name    text NOT NULL,
    display_name_km text,
    selection_type  text NOT NULL DEFAULT 'pick_one'
        CHECK (selection_type IN ('pick_one','pick_many')),
        -- See §6.3 enum: modifier_selection_type
    is_required     boolean NOT NULL DEFAULT false,
        -- See §6.3: modifier_requirement
    max_selections  int,
        -- For pick_many: maximum number of modifiers that can be selected
    sort_order      int NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_modifier_groups_tenant ON cafe.modifier_groups(tenant_id);
CREATE INDEX idx_modifier_groups_store ON cafe.modifier_groups(store_id) WHERE store_id IS NOT NULL;

COMMENT ON TABLE cafe.modifier_groups IS 'Group of modifier options (e.g., Size, Sugar Level). Linked to items via menu.item_modifier_groups.';
```

```sql
ALTER TABLE cafe.modifier_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY modifier_groups_tenant_isolation ON cafe.modifier_groups
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `cafe.modifiers`

Individual modifier option. May carry KHR upcharge.

```sql
CREATE TABLE cafe.modifiers (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    modifier_group_id uuid NOT NULL REFERENCES cafe.modifier_groups(id) ON DELETE CASCADE,
    display_name    text NOT NULL,
    display_name_km text,
    upcharge        numeric(18,4) NOT NULL DEFAULT 0,
        -- Additional cost in USD storage
    upcharge_khr    bigint NOT NULL DEFAULT 0,
        -- Derived KHR integer (R-1)
    is_default      boolean NOT NULL DEFAULT false,
        -- Pre-selected by default
    sort_order      int NOT NULL DEFAULT 0,
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_modifiers_group ON cafe.modifiers(modifier_group_id);
CREATE INDEX idx_modifiers_active ON cafe.modifiers(modifier_group_id, is_active);

COMMENT ON TABLE cafe.modifiers IS 'Individual modifier option within a group. Carries upcharge. e.g., "Extra Shot" +$0.50.';
```

```sql
ALTER TABLE cafe.modifiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY modifiers_tenant_isolation ON cafe.modifiers
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `cafe.recipes`

Ingredient-level Bill of Materials for a menu item. Fires deduction at `ready_for_pickup`.

```sql
CREATE TABLE cafe.recipes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    item_id         uuid NOT NULL REFERENCES menu.items(id) ON DELETE CASCADE,
        -- The menu item this recipe produces
    recipe_name     text NOT NULL,
    version         int NOT NULL DEFAULT 1,
        -- Incremented when ingredients change (audit trail)
    is_active       boolean NOT NULL DEFAULT true,
    yield_quantity  numeric(18,4) NOT NULL DEFAULT 1,
        -- How many servings this recipe produces
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(store_id, item_id, version)
);

CREATE INDEX idx_recipes_store ON cafe.recipes(store_id);
CREATE INDEX idx_recipes_item ON cafe.recipes(item_id);

COMMENT ON TABLE cafe.recipes IS 'Ingredient BOM for a menu item. Deduction fires at ready_for_pickup (Part 5).';
```

```sql
ALTER TABLE cafe.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipes_tenant_isolation ON cafe.recipes
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `cafe.ingredients`

Tracked raw material. Stock, threshold, reorder point, per-unit cost.

```sql
CREATE TABLE cafe.ingredients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    sku             text,
    display_name    text NOT NULL,
    display_name_km text,
    unit_of_measure text NOT NULL DEFAULT 'unit',
        -- e.g., 'gram', 'ml', 'piece', 'pump', 'shot'
    current_stock   numeric(18,4) NOT NULL DEFAULT 0,
        -- Current quantity on hand
    threshold_qty   numeric(18,4) NOT NULL DEFAULT 0,
        -- Alert when stock falls below this
    reorder_point   numeric(18,4) NOT NULL DEFAULT 0,
        -- Auto-generate purchase suggestion at this level
    unit_cost       numeric(18,4),
        -- Last known per-unit cost in USD
    unit_cost_khr   bigint,
    supplier_info   jsonb DEFAULT '{}',
    is_active       boolean NOT NULL DEFAULT true,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, sku) WHERE sku IS NOT NULL
);

CREATE INDEX idx_ingredients_store ON cafe.ingredients(store_id);
CREATE INDEX idx_ingredients_low_stock ON cafe.ingredients(store_id, current_stock) WHERE current_stock <= threshold_qty;

COMMENT ON TABLE cafe.ingredients IS 'Tracked raw material with stock level, threshold, and per-unit cost.';
```

```sql
ALTER TABLE cafe.ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY ingredients_tenant_isolation ON cafe.ingredients
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `cafe.recipe_ingredients`

Junction: which ingredients (and how much) go into a recipe.

```sql
CREATE TABLE cafe.recipe_ingredients (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    recipe_id       uuid NOT NULL REFERENCES cafe.recipes(id) ON DELETE CASCADE,
    ingredient_id   uuid NOT NULL REFERENCES cafe.ingredients(id) ON DELETE RESTRICT,
    quantity        numeric(18,4) NOT NULL,
        -- Amount of ingredient per recipe yield
    wastage_pct     numeric(5,4) NOT NULL DEFAULT 0,
        -- Expected wastage percentage (0.00 to 1.0000)
    sort_order      int NOT NULL DEFAULT 0,
    notes           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(recipe_id, ingredient_id)
);

CREATE INDEX idx_recipe_ingredients_recipe ON cafe.recipe_ingredients(recipe_id);
CREATE INDEX idx_recipe_ingredients_ingredient ON cafe.recipe_ingredients(ingredient_id);

COMMENT ON TABLE cafe.recipe_ingredients IS 'Junction: recipes ↔ ingredients with quantity and wastage.';
```

```sql
ALTER TABLE cafe.recipe_ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY recipe_ingredients_tenant_isolation ON cafe.recipe_ingredients
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

##### Table: `cafe.tabs`

Running order kept open across a visit. Survives shift change.

```sql
CREATE TABLE cafe.tabs (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    tab_number      text NOT NULL,
        -- Human-readable: T-{sequence} or table number
    customer_name   text,
    customer_phone  text,
    customer_count  int,
        -- Number of people at table (for dine_in)
    service_mode    text NOT NULL DEFAULT 'dine_in'
        CHECK (service_mode IN ('dine_in','takeaway')),
        -- Tabs are dine-in or takeaway only (no delivery tabs)
    tab_status      text NOT NULL DEFAULT 'open'
        CHECK (tab_status IN ('open','closed','cancelled')),
    total_ordered   numeric(18,4) NOT NULL DEFAULT 0,
        -- Sum of all carts ever linked to this tab
    total_paid      numeric(18,4) NOT NULL DEFAULT 0,
    balance_due     numeric(18,4) NOT NULL DEFAULT 0,
        -- total_ordered - total_paid
    -- KHR derived
    total_ordered_khr bigint NOT NULL DEFAULT 0,
    total_paid_khr  bigint NOT NULL DEFAULT 0,
    balance_due_khr bigint NOT NULL DEFAULT 0,
    opened_at       timestamptz NOT NULL DEFAULT now(),
    opened_by       uuid NOT NULL REFERENCES cp.accounts(id) ON DELETE RESTRICT,
    closed_at       timestamptz,
    closed_by       uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE(store_id, tab_number) WHERE tab_status = 'open'
);

CREATE INDEX idx_tabs_store ON cafe.tabs(store_id);
CREATE INDEX idx_tabs_status ON cafe.tabs(store_id, tab_status);
CREATE INDEX idx_tabs_open ON cafe.tabs(store_id, tab_status) WHERE tab_status = 'open';

COMMENT ON TABLE cafe.tabs IS 'Running order kept open across a visit. Survives shift change. Linked to carts via pos.carts.tab_id.';
```

```sql
ALTER TABLE cafe.tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tabs_tenant_isolation ON cafe.tabs
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

#### 6.2.7 Schema: `ops` — Operations Layer

**Migration file:** `010_ops_cafe.sql`

> Per R-3: `ops.cafe_orders` is the operational layer keyed to `pos.carts`.  
> `pos.carts` remains the financial source of truth.

---

##### Table: `ops.cafe_orders`

Operational tracking for café order fulfillment. Mirrors `pos.carts` for kitchen/production workflow.  
One `ops.cafe_orders` row is created per `pos.carts` row when `store.vertical_type = 'cafe'`.

```sql
CREATE TABLE ops.cafe_orders (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES cp.tenants(id) ON DELETE CASCADE,
    store_id        uuid NOT NULL REFERENCES pos.stores(id) ON DELETE CASCADE,
    -- R-3: FK to financial source of truth
    cart_id         uuid NOT NULL UNIQUE REFERENCES pos.carts(id) ON DELETE CASCADE,
        -- One-to-one: one cafe_order per cart. UNIQUE enforces this.
    -- Optional tab linkage
    tab_id          uuid REFERENCES cafe.tabs(id) ON DELETE SET NULL,
    -- Operational status (independent of cart_status)
    order_status    text NOT NULL DEFAULT 'new'
        CHECK (order_status IN ('new','confirmed','preparing','ready_for_pickup','served','cancelled')),
        -- See §6.3 enum: cafe_order_status
        -- State machine: new → confirmed → preparing → ready_for_pickup → served
        --                            └→ cancelled (any time before served)
    -- Timestamps for kitchen metrics
    confirmed_at    timestamptz,
    preparing_at    timestamptz,
    ready_at        timestamptz,
        -- When moved to ready_for_pickup (triggers T4 display + T5 broadcast)
    served_at       timestamptz,
    cancelled_at    timestamptz,
    cancelled_by    uuid REFERENCES cp.accounts(id) ON DELETE SET NULL,
    cancel_reason   text,
    -- Slot assignment (T4 expediter)
    slot_number     int,
        -- Physical pickup position on T4 counter
    -- Production assignment
    assigned_station text,
        -- Which T3 KDS station is handling this order
    -- Cup stickers printed
    stickers_printed boolean NOT NULL DEFAULT false,
    stickers_printed_at timestamptz,
    -- Line item breakdown for kitchen (denormalized from cart_lines)
    kitchen_items   jsonb NOT NULL DEFAULT '[]',
        -- Array of {line_id, item_name, qty, modifiers[], special_instructions, status}
    -- TMA (Telegram Mini App) specific
    tma_chat_id     text,
    tma_user_id     text,
        -- For notifying customer via Telegram when ready
    -- Rotanak loyalty snapshot
    rotanak_tier    text,
    rotanak_coins_earned bigint NOT NULL DEFAULT 0,
    rotanak_coins_redeemed bigint NOT NULL DEFAULT 0,
    -- Metadata
    metadata        jsonb DEFAULT '{}',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cafe_orders_store ON ops.cafe_orders(store_id);
CREATE INDEX idx_cafe_orders_status ON ops.cafe_orders(store_id, order_status);
CREATE INDEX idx_cafe_orders_cart ON ops.cafe_orders(cart_id);
CREATE INDEX idx_cafe_orders_tab ON ops.cafe_orders(tab_id) WHERE tab_id IS NOT NULL;
CREATE INDEX idx_cafe_orders_ready ON ops.cafe_orders(store_id, ready_at) WHERE order_status = 'ready_for_pickup';

COMMENT ON TABLE ops.cafe_orders IS 'Operational layer for café order fulfillment. R-3: references pos.carts via cart_id FK. pos.carts is financial truth; this is operational truth.';
COMMENT ON COLUMN ops.cafe_orders.cart_id IS 'R-3: FK to pos.carts (financial source of truth). UNIQUE constraint enforces 1:1 relationship.';
```

```sql
ALTER TABLE ops.cafe_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY cafe_orders_tenant_isolation ON ops.cafe_orders
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

---

### 6.2.8 Deferred FK Additions (Cross-Schema)

After all base migrations are applied, run the deferred FK additions:

**Migration file:** `011_deferred_fks.sql`

```sql
-- R-2: pos.carts.tab_id → cafe.tabs.id (cafe schema may not exist when carts is created)
ALTER TABLE pos.carts
    ADD CONSTRAINT fk_carts_tab
    FOREIGN KEY (tab_id) REFERENCES cafe.tabs(id) ON DELETE SET NULL;

-- R-4: menu.items.recipe_id → cafe.recipes.id
ALTER TABLE menu.items
    ADD CONSTRAINT fk_items_recipe
    FOREIGN KEY (recipe_id) REFERENCES cafe.recipes(id) ON DELETE SET NULL;

-- R-4: menu.item_modifier_groups.modifier_group_id → cafe.modifier_groups.id
ALTER TABLE menu.item_modifier_groups
    ADD CONSTRAINT fk_item_modifier_groups_group
    FOREIGN KEY (modifier_group_id) REFERENCES cafe.modifier_groups(id) ON DELETE CASCADE;

-- R-3: pos.carts has implicit relationship to ops.cafe_orders via cart_id on ops side
-- No additional FK needed on pos.carts; the UNIQUE(cart_id) on ops.cafe_orders enforces 1:1
```

---

### 6.2.9 Core Helper Functions

**Migration file:** `012_core_functions.sql`

```sql
-- Get current tenant_id from JWT claim (set by edge function)
CREATE OR REPLACE FUNCTION core.current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, public
AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claims', true)::jsonb->>'tenant_id', '')::uuid,
        nullif(current_setting('app.current_tenant_id', true), '')::uuid
    );
$$;

COMMENT ON FUNCTION core.current_tenant_id() IS 'Returns the tenant_id from JWT claims or session variable. Set by edge functions on every request.';

-- Get current account_id from JWT claim
CREATE OR REPLACE FUNCTION core.current_account_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, public
AS $$
    SELECT coalesce(
        nullif(current_setting('request.jwt.claims', true)::jsonb->>'account_id', '')::uuid,
        nullif(current_setting('app.current_account_id', true), '')::uuid
    );
$$;

COMMENT ON FUNCTION core.current_account_id() IS 'Returns the account_id from JWT claims or session variable.';

-- Check if current role is service_role (edge function bypass)
CREATE OR REPLACE FUNCTION core.is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = core, public
AS $$
    SELECT coalesce(
        current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role',
        false
    );
$$;

COMMENT ON FUNCTION core.is_service_role() IS 'Returns true if the current request is from an edge function using service_role key. Allows RLS bypass for admin operations.';

-- Auto-update updated_at trigger function
CREATE OR REPLACE FUNCTION core.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

COMMENT ON FUNCTION core.set_updated_at() IS 'Trigger function to automatically set updated_at = now() on row update.';
```

Apply `core.set_updated_at()` trigger to all tables with `updated_at`:

```sql
-- Example: apply to pos.stores (repeat for all applicable tables)
CREATE TRIGGER trg_stores_updated_at
    BEFORE UPDATE ON pos.stores
    FOR EACH ROW
    EXECUTE FUNCTION core.set_updated_at();
```

Full trigger list (all tables with `updated_at` column):

| # | Table | Trigger Name |
|---|---|---|
| 1 | `cp.tenants` | `trg_tenants_updated_at` |
| 2 | `cp.accounts` | `trg_accounts_updated_at` |
| 3 | `cp.tenant_memberships` | `trg_tenant_memberships_updated_at` |
| 4 | `fin.companies` | `trg_companies_updated_at` |
| 5 | `pos.stores` | `trg_stores_updated_at` |
| 6 | `pos.registers` | `trg_registers_updated_at` |
| 7 | `pos.shifts` | `trg_shifts_updated_at` |
| 8 | `pos.sessions` | `trg_sessions_updated_at` |
| 9 | `pos.carts` | `trg_carts_updated_at` |
| 10 | `pos.cart_lines` | `trg_cart_lines_updated_at` |
| 11 | `pos.tenders` | `trg_tenders_updated_at` |
| 12 | `pos.tender_attempts` | — (no updated_at — append-only) |
| 13 | `menu.categories` | `trg_categories_updated_at` |
| 14 | `menu.items` | `trg_items_updated_at` |
| 15 | `menu.item_modifier_groups` | `trg_item_modifier_groups_updated_at` |
| 16 | `cafe.modifier_groups` | `trg_modifier_groups_updated_at` |
| 17 | `cafe.modifiers` | `trg_modifiers_updated_at` |
| 18 | `cafe.recipes` | `trg_recipes_updated_at` |
| 19 | `cafe.ingredients` | `trg_ingredients_updated_at` |
| 20 | `cafe.recipe_ingredients` | `trg_recipe_ingredients_updated_at` |
| 21 | `cafe.tabs` | `trg_tabs_updated_at` |
| 22 | `ops.cafe_orders` | `trg_cafe_orders_updated_at` |

---

### 6.2.10 Price History Trigger

**Migration file:** `013_triggers.sql`

```sql
-- Auto-create price_history row on menu.items base_price change
CREATE OR REPLACE FUNCTION menu.track_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF OLD.base_price IS DISTINCT FROM NEW.base_price THEN
        INSERT INTO menu.price_history (
            tenant_id, item_id, old_price, new_price,
            old_price_khr, new_price_khr, changed_by, change_reason
        ) VALUES (
            NEW.tenant_id, NEW.id, OLD.base_price, NEW.base_price,
            OLD.base_price_khr, NEW.base_price_khr,
            core.current_account_id(),
            NEW.metadata->>'price_change_reason'
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_items_price_history
    BEFORE UPDATE ON menu.items
    FOR EACH ROW
    EXECUTE FUNCTION menu.track_price_change();
```

---

### 6.3 Enum Reference

All enums are implemented as `text` columns with `CHECK` constraints. No PostgreSQL `ENUM` types are used — this allows adding values without migration downtime.

| # | Enum Name | Table(s) | Allowed Values | Description |
|---|---|---|---|---|
| 1 | **`vertical_type`** | `pos.stores.vertical_type` | `'laundry'`, `'cafe'`, `'restaurant'`, `'retail'` | Store vertical. Immutable after creation. v1.0.0 only uses `laundry` and `cafe`. |
| 2 | **`subscription_tier`** | `cp.tenants.subscription_tier` | `'starter'`, `'growth'`, `'enterprise'` | SaaS billing tier |
| 3 | **`billing_mode`** | `cp.tenants.billing_mode` | `'direct'`, `'brand_consolidated'`, `'franchisee_direct'` | R-5 RESOLVED v1.1.0: `'direct'` = single-owner (incl. owner-operated chains); `'brand_consolidated'` / `'franchisee_direct'` = franchise payer modes. Subscription payer derived from this value. Franchise detail in `cp.franchise_agreements`. |
| 4 | **`membership_role`** | `cp.tenant_memberships.membership_role` | `'owner'`, `'manager'`, `'cashier'`, `'kitchen_staff'`, `'readonly'` | Role within a tenant. Canonical v1.0.0 RBAC roles per Part 10. |
| 5 | **`register_type`** | `pos.registers.register_type` | `'t1_cashier'`, `'t2_cds'`, `'t3_kds'`, `'t4_dds'`, `'t5_qds'` | Terminal type. See Master Context §8 Hardware Constants. |
| 6 | **`service_mode`** | `pos.carts.service_mode`, `cafe.tabs.service_mode` | `'dine_in'`, `'takeaway'`, `'delivery'` | How the customer receives their order. `delivery` only valid via TMA origin. |
| 7 | **`origin_channel`** | `pos.carts.origin_channel`, `sal.sales_invoices.origin_channel` | `'walk_in'`, `'tma'` | Where the order originated. `'tma'` = Telegram Mini App. |
| 8 | **`cart_status`** | `pos.carts.cart_status` | `'open'`, `'locked'`, `'paid'`, `'cancelled'`, `'refunded'` | Cart lifecycle. `locked` = payment in progress, no more line items. |
| 9 | **`tender_type`** | `pos.tenders.tender_type` | `'cash'`, `'aba_card'`, `'aba_khqr'`, `'sleung_coin'`, `'debt'` | Payment method. See Part 4 (External Contracts) for ABA PayWay and Rotanak integration details. |
| 10 | **`tender_status`** | `pos.tenders.tender_status` | `'pending'`, `'authorized'`, `'captured'`, `'failed'`, `'refunded'`, `'voided'` | Payment attempt status. `authorized` = approved but not settled; `captured` = settled. |
| 11 | **`sync_status`** | `pos.offline_sync_batches.batch_status` | `'pending'`, `'syncing'`, `'synced'`, `'conflict'`, `'error'`, `'partial'` | Overall batch status |
| 12 | **`sync_event_type`** | `pos.offline_sync_events.event_type` | `'cart_create'`, `'cart_update'`, `'tender_create'`, `'tender_attempt'`, `'shift_open'`, `'shift_close'`, `'session_start'`, `'session_end'`, `'item_update'`, `'price_update'` | Type of event in an offline sync batch |
| 13 | **`sync_event_status`** | `pos.offline_sync_events.event_status` | `'pending'`, `'synced'`, `'conflict'`, `'error'` | Individual event status |
| 14 | **`invoice_status`** | `sal.sales_invoices.invoice_status` | `'draft'`, `'final'`, `'voided'` | Invoice state. `'draft'` only for offline-synced carts pending validation. |
| 15 | **`receipt_status`** | `sal.receipts.receipt_status` | `'issued'`, `'reprinted'`, `'voided'` | Receipt state. Reprints create new rows with `'reprinted'`. |
| 16 | **`cafe_order_status`** | `ops.cafe_orders.order_status` | `'new'`, `'confirmed'`, `'preparing'`, `'ready_for_pickup'`, `'served'`, `'cancelled'` | Café order operational status. State machine: new → confirmed → preparing → ready_for_pickup → served. |
| 17 | **`modifier_selection_type`** | `cafe.modifier_groups.selection_type`, `menu.item_modifier_groups.selection_type` | `'pick_one'`, `'pick_many'` | How many modifiers can be selected from a group |
| 18 | **`modifier_requirement`** | `cafe.modifier_groups.is_required` (boolean), `menu.item_modifier_groups.is_required` (boolean) | `true`/`false` | Whether a modifier group must have a selection |
| 19 | **`pricing_type`** | `menu.items.pricing_type` | `'fixed'`, `'variable'`, `'tiered'` | `fixed` = set price; `variable` = priced by weight/duration at cart time; `tiered` = price breaks by quantity |

---

### 6.4 Foreign Key Map

#### 6.4.1 FK Matrix (Referencing → Referenced)

| # | Column | Table | References | On Delete | Notes |
|---|---|---|---|---|---|
| 1 | `cp.tenant_memberships.tenant_id` | `cp.tenant_memberships` | `cp.tenants(id)` | CASCADE | |
| 2 | `cp.tenant_memberships.account_id` | `cp.tenant_memberships` | `cp.accounts(id)` | CASCADE | |
| 3 | `cp.accounts.auth_user_id` | `cp.accounts` | `auth.users(id)` | CASCADE | Single Identity §2 P2 |
| 4 | `fin.companies.tenant_id` | `fin.companies` | `cp.tenants(id)` | CASCADE | |
| 5 | `pos.stores.tenant_id` | `pos.stores` | `cp.tenants(id)` | CASCADE | |
| 6 | `pos.stores.company_id` | `pos.stores` | `fin.companies(id)` | SET NULL | |
| 7 | `pos.registers.tenant_id` | `pos.registers` | `cp.tenants(id)` | CASCADE | |
| 8 | `pos.registers.store_id` | `pos.registers` | `pos.stores(id)` | CASCADE | |
| 9 | `pos.shifts.tenant_id` | `pos.shifts` | `cp.tenants(id)` | CASCADE | |
| 10 | `pos.shifts.store_id` | `pos.shifts` | `pos.stores(id)` | CASCADE | |
| 11 | `pos.shifts.register_id` | `pos.shifts` | `pos.registers(id)` | CASCADE | |
| 12 | `pos.shifts.opened_by` | `pos.shifts` | `cp.accounts(id)` | RESTRICT | Cannot delete active cashier |
| 13 | `pos.shifts.closed_by` | `pos.shifts` | `cp.accounts(id)` | SET NULL | |
| 14 | `pos.sessions.tenant_id` | `pos.sessions` | `cp.tenants(id)` | CASCADE | |
| 15 | `pos.sessions.store_id` | `pos.sessions` | `pos.stores(id)` | CASCADE | |
| 16 | `pos.sessions.shift_id` | `pos.sessions` | `pos.shifts(id)` | CASCADE | |
| 17 | `pos.sessions.register_id` | `pos.sessions` | `pos.registers(id)` | CASCADE | |
| 18 | `pos.sessions.account_id` | `pos.sessions` | `cp.accounts(id)` | RESTRICT | Cannot delete logged-in staff |
| 19 | `pos.carts.tenant_id` | `pos.carts` | `cp.tenants(id)` | CASCADE | |
| 20 | `pos.carts.store_id` | `pos.carts` | `pos.stores(id)` | CASCADE | |
| 21 | `pos.carts.register_id` | `pos.carts` | `pos.registers(id)` | CASCADE | |
| 22 | `pos.carts.shift_id` | `pos.carts` | `pos.shifts(id)` | RESTRICT | Protect shift integrity |
| 23 | `pos.carts.session_id` | `pos.carts` | `pos.sessions(id)` | SET NULL | Tab survives session expiry |
| 24 | `pos.carts.tab_id` | `pos.carts` | `cafe.tabs(id)` | SET NULL | Deferred FK (§6.2.8) |
| 25 | `pos.cart_lines.tenant_id` | `pos.cart_lines` | `cp.tenants(id)` | CASCADE | |
| 26 | `pos.cart_lines.cart_id` | `pos.cart_lines` | `pos.carts(id)` | CASCADE | |
| 27 | `pos.cart_lines.item_id` | `pos.cart_lines` | `menu.items(id)` | RESTRICT | R-4: canonical item catalog |
| 28 | `pos.cart_lines.voided_by` | `pos.cart_lines` | `cp.accounts(id)` | SET NULL | |
| 29 | `pos.tenders.tenant_id` | `pos.tenders` | `cp.tenants(id)` | CASCADE | |
| 30 | `pos.tenders.cart_id` | `pos.tenders` | `pos.carts(id)` | CASCADE | |
| 31 | `pos.tender_attempts.tenant_id` | `pos.tender_attempts` | `cp.tenants(id)` | CASCADE | |
| 32 | `pos.tender_attempts.tender_id` | `pos.tender_attempts` | `pos.tenders(id)` | CASCADE | |
| 33 | `pos.offline_sync_batches.tenant_id` | `pos.offline_sync_batches` | `cp.tenants(id)` | CASCADE | |
| 34 | `pos.offline_sync_batches.store_id` | `pos.offline_sync_batches` | `pos.stores(id)` | CASCADE | |
| 35 | `pos.offline_sync_events.tenant_id` | `pos.offline_sync_events` | `cp.tenants(id)` | CASCADE | |
| 36 | `pos.offline_sync_events.batch_id` | `pos.offline_sync_events` | `pos.offline_sync_batches(id)` | CASCADE | |
| 37 | `sal.sales_invoices.tenant_id` | `sal.sales_invoices` | `cp.tenants(id)` | CASCADE | |
| 38 | `sal.sales_invoices.store_id` | `sal.sales_invoices` | `pos.stores(id)` | CASCADE | |
| 39 | `sal.sales_invoices.cart_id` | `sal.sales_invoices` | `pos.carts(id)` | RESTRICT | Protect audit trail |
| 40 | `sal.sales_invoices.shift_id` | `sal.sales_invoices` | `pos.shifts(id)` | RESTRICT | |
| 41 | `sal.sales_invoices.register_id` | `sal.sales_invoices` | `pos.registers(id)` | RESTRICT | |
| 42 | `sal.sales_invoices.voided_by` | `sal.sales_invoices` | `cp.accounts(id)` | SET NULL | |
| 43 | `sal.receipts.tenant_id` | `sal.receipts` | `cp.tenants(id)` | CASCADE | |
| 44 | `sal.receipts.store_id` | `sal.receipts` | `pos.stores(id)` | CASCADE | |
| 45 | `sal.receipts.invoice_id` | `sal.receipts` | `sal.sales_invoices(id)` | RESTRICT | |
| 46 | `sal.receipts.cart_id` | `sal.receipts` | `pos.carts(id)` | RESTRICT | |
| 47 | `sal.receipts.reprinted_by` | `sal.receipts` | `cp.accounts(id)` | SET NULL | |
| 48 | `sal.receipts.original_receipt_id` | `sal.receipts` | `sal.receipts(id)` | SET NULL | Self-reference for reprints |
| 49 | `menu.categories.tenant_id` | `menu.categories` | `cp.tenants(id)` | CASCADE | |
| 50 | `menu.categories.store_id` | `menu.categories` | `pos.stores(id)` | CASCADE | Nullable |
| 51 | `menu.categories.parent_id` | `menu.categories` | `menu.categories(id)` | SET NULL | Self-reference |
| 52 | `menu.items.tenant_id` | `menu.items` | `cp.tenants(id)` | CASCADE | |
| 53 | `menu.items.store_id` | `menu.items` | `pos.stores(id)` | CASCADE | Nullable |
| 54 | `menu.items.category_id` | `menu.items` | `menu.categories(id)` | SET NULL | |
| 55 | `menu.items.recipe_id` | `menu.items` | `cafe.recipes(id)` | SET NULL | Deferred FK (§6.2.8) |
| 56 | `menu.price_history.tenant_id` | `menu.price_history` | `cp.tenants(id)` | CASCADE | |
| 57 | `menu.price_history.item_id` | `menu.price_history` | `menu.items(id)` | CASCADE | |
| 58 | `menu.price_history.changed_by` | `menu.price_history` | `cp.accounts(id)` | RESTRICT | |
| 59 | `menu.item_modifier_groups.tenant_id` | `menu.item_modifier_groups` | `cp.tenants(id)` | CASCADE | |
| 60 | `menu.item_modifier_groups.item_id` | `menu.item_modifier_groups` | `menu.items(id)` | CASCADE | |
| 61 | `menu.item_modifier_groups.modifier_group_id` | `menu.item_modifier_groups` | `cafe.modifier_groups(id)` | CASCADE | Deferred FK (§6.2.8) |
| 62 | `cafe.modifier_groups.tenant_id` | `cafe.modifier_groups` | `cp.tenants(id)` | CASCADE | |
| 63 | `cafe.modifier_groups.store_id` | `cafe.modifier_groups` | `pos.stores(id)` | CASCADE | Nullable |
| 64 | `cafe.modifiers.tenant_id` | `cafe.modifiers` | `cp.tenants(id)` | CASCADE | |
| 65 | `cafe.modifiers.modifier_group_id` | `cafe.modifiers` | `cafe.modifier_groups(id)` | CASCADE | |
| 66 | `cafe.recipes.tenant_id` | `cafe.recipes` | `cp.tenants(id)` | CASCADE | |
| 67 | `cafe.recipes.store_id` | `cafe.recipes` | `pos.stores(id)` | CASCADE | |
| 68 | `cafe.recipes.item_id` | `cafe.recipes` | `menu.items(id)` | CASCADE | |
| 69 | `cafe.ingredients.tenant_id` | `cafe.ingredients` | `cp.tenants(id)` | CASCADE | |
| 70 | `cafe.ingredients.store_id` | `cafe.ingredients` | `pos.stores(id)` | CASCADE | |
| 71 | `cafe.recipe_ingredients.tenant_id` | `cafe.recipe_ingredients` | `cp.tenants(id)` | CASCADE | |
| 72 | `cafe.recipe_ingredients.recipe_id` | `cafe.recipe_ingredients` | `cafe.recipes(id)` | CASCADE | |
| 73 | `cafe.recipe_ingredients.ingredient_id` | `cafe.recipe_ingredients` | `cafe.ingredients(id)` | RESTRICT | |
| 74 | `cafe.tabs.tenant_id` | `cafe.tabs` | `cp.tenants(id)` | CASCADE | |
| 75 | `cafe.tabs.store_id` | `cafe.tabs` | `pos.stores(id)` | CASCADE | |
| 76 | `cafe.tabs.opened_by` | `cafe.tabs` | `cp.accounts(id)` | RESTRICT | |
| 77 | `cafe.tabs.closed_by` | `cafe.tabs` | `cp.accounts(id)` | SET NULL | |
| 78 | `ops.cafe_orders.tenant_id` | `ops.cafe_orders` | `cp.tenants(id)` | CASCADE | |
| 79 | `ops.cafe_orders.store_id` | `ops.cafe_orders` | `pos.stores(id)` | CASCADE | |
| 80 | `ops.cafe_orders.cart_id` | `ops.cafe_orders` | `pos.carts(id)` | CASCADE | R-3: 1:1 relationship |
| 81 | `ops.cafe_orders.tab_id` | `ops.cafe_orders` | `cafe.tabs(id)` | SET NULL | |
| 82 | `ops.cafe_orders.cancelled_by` | `ops.cafe_orders` | `cp.accounts(id)` | SET NULL | |

#### 6.4.2 Reverse Lookup (Referenced ← Referencing)

| Table | Referenced By | Cardinality |
|---|---|---|
| `cp.tenants` | All tenant-scoped tables (via `tenant_id`) | 1:N |
| `cp.accounts` | `pos.shifts.opened_by/closed_by`, `pos.sessions.account_id`, `pos.cart_lines.voided_by`, `sal.sales_invoices.voided_by`, `sal.receipts.reprinted_by`, `cafe.tabs.opened_by/closed_by`, `ops.cafe_orders.cancelled_by`, `menu.price_history.changed_by` | 1:N |
| `cp.tenant_memberships` | — (junction, no FKs point to it) | — |
| `fin.companies` | `pos.stores.company_id` | 1:N |
| `pos.stores` | `pos.registers`, `pos.shifts`, `pos.sessions`, `pos.carts`, `pos.offline_sync_batches`, `sal.sales_invoices`, `sal.receipts`, `cafe.recipes`, `cafe.ingredients`, `cafe.tabs`, `ops.cafe_orders`, plus nullable FKs in `menu.categories`, `menu.items`, `cafe.modifier_groups` | 1:N |
| `pos.registers` | `pos.shifts`, `pos.sessions`, `pos.carts`, `sal.sales_invoices` | 1:N |
| `pos.shifts` | `pos.sessions`, `pos.carts`, `sal.sales_invoices` | 1:N |
| `pos.sessions` | `pos.carts` | 1:N |
| `pos.carts` | `pos.cart_lines`, `pos.tenders`, `sal.sales_invoices`, `sal.receipts`, `ops.cafe_orders` (R-3) | 1:N |
| `pos.tenders` | `pos.tender_attempts` | 1:N |
| `pos.offline_sync_batches` | `pos.offline_sync_events` | 1:N |
| `sal.sales_invoices` | `sal.receipts` | 1:N |
| `sal.receipts` | `sal.receipts` (reprint self-ref) | 1:1 (original) |
| `menu.categories` | `menu.items`, `menu.categories` (self-ref) | 1:N |
| `menu.items` | `pos.cart_lines`, `cafe.recipes`, `menu.price_history`, `menu.item_modifier_groups` | 1:N |
| `menu.price_history` | — (leaf table) | — |
| `menu.item_modifier_groups` | — (junction) | — |
| `cafe.modifier_groups` | `cafe.modifiers`, `menu.item_modifier_groups` | 1:N |
| `cafe.modifiers` | — (leaf table) | — |
| `cafe.recipes` | `menu.items` (deferred FK), `cafe.recipe_ingredients` | 1:N |
| `cafe.ingredients` | `cafe.recipe_ingredients` | 1:N |
| `cafe.recipe_ingredients` | — (junction) | — |
| `cafe.tabs` | `pos.carts`, `ops.cafe_orders` | 1:N |
| `ops.cafe_orders` | — (leaf table — operational mirror) | — |

---

### 6.5 Migration Order

#### 6.5.1 Migration Sequence

Migrations **MUST** be applied in this exact order. Dependencies are explicit.

| Order | File | Schema | Tables / Objects | Depends On |
|---|---|---|---|---|
| 1 | `001_cp_schema.sql` | `cp` | `tenants`, `accounts`, `tenant_memberships` | `auth.users` (Supabase built-in) |
| 2 | `002_fin_schema.sql` | `fin` | `companies` | `cp.tenants` |
| 3 | `003_pos_core.sql` | `pos` | `stores`, `registers`, `shifts`, `sessions` | `cp.tenants`, `cp.accounts`, `fin.companies`, `pos.stores` (self) |
| 4 | `004_pos_carts.sql` | `pos` | `carts`, `cart_lines` | All above + `menu.items` (see note) |
| 5 | `005_pos_tenders.sql` | `pos` | `tenders`, `tender_attempts` | `pos.carts` |
| 6 | `006_pos_offline_sync.sql` | `pos` | `offline_sync_batches`, `offline_sync_events` | `pos.stores` |
| 7 | `007_sal_documents.sql` | `sal` | `sales_invoices`, `receipts` | `pos.carts`, `pos.stores`, `pos.shifts`, `pos.registers` |
| 8 | `008_menu_catalog.sql` | `menu` | `categories`, `items`, `price_history`, `item_modifier_groups` | `cp.tenants`, `pos.stores` |
| 9 | `009_cafe_vertical.sql` | `cafe` | `modifier_groups`, `modifiers`, `recipes`, `ingredients`, `recipe_ingredients`, `tabs` | `cp.tenants`, `pos.stores`, `menu.items` |
| 10 | `010_ops_cafe.sql` | `ops` | `cafe_orders` | `pos.carts`, `cafe.tabs`, `pos.stores` |
| 11 | `011_deferred_fks.sql` | All | Cross-schema FKs | Migrations 1–10 all applied |
| 12 | `012_core_functions.sql` | `core` | Helper functions, RLS policies | All tables |
| 13 | `013_triggers.sql` | All | `updated_at` triggers, price history trigger | All tables with `updated_at` |

> **Note on Migration 4 (`004_pos_carts.sql`):** `pos.cart_lines.item_id` references `menu.items(id)`. If applying migrations 1–8 as a single batch (recommended for fresh installs), the FK is valid because `menu.items` is created before data is inserted. For incremental upgrades, migration 4 should create `pos.cart_lines` without the `item_id` FK, and the FK should be added in `011_deferred_fks.sql`. The DDL above assumes a fresh batch install.

#### 6.5.2 Rollback Policy

Migrations are forward-only. Rollback is via restore from backup, not `DOWN` migrations. Each migration file must include an `INSERT` into `schema.migrations_log`:

```sql
-- End of each migration file
INSERT INTO schema.migrations_log (file_name, applied_at, checksum)
VALUES ('001_cp_schema.sql', now(), 'sha256:...');
```

The `schema.migrations_log` table (managed by the BE team) tracks which migrations have been applied.

#### 6.5.3 Fresh Install vs. Upgrade Path

| Path | Command | Notes |
|---|---|---|
| Fresh install | `supabase db push` | Apply all migrations 001–013 in order |
| Upgrade from handbook schema | Custom migration per R-2/R-3/R-4 | See Appendix C for per-conflict migration notes |

---


---


## Part 7: Edge Function Specs

**Version:** v1.0.0  
**Authority:** Implementation Agent  
**Date:** 29 May 2026  
**Status:** Canonical  
**Cross-references:** Part 6 (Schema), Part 8 (Business Logic / `formatKHR`), Part 10 (RBAC)

---

### 7.1 Edge Function Architecture

All writes to the database flow through Supabase Edge Functions (Deno). No application — web, desktop, or terminal — writes directly to any table. This enforces:

1. **RLS consistency** — Edge functions use `service_role` key to bypass RLS for cross-tenant admin operations, or set `tenant_id` claims for scoped operations (§6.1.4).
2. **Business logic validation** — Every function validates state transitions, money calculations, and permission checks before any `INSERT` or `UPDATE`.
3. **Idempotency** — All order-creating and payment functions require an idempotency key (`[device_uuid]_[counter]_[timestamp]`). Duplicate keys with identical payloads return the cached response (§2 P9).
4. **Append-only enforcement** — Financial tables (`sal.sales_invoices`, `sal.receipts`, `pos.tenders`, `pos.tender_attempts`) are append-only. Functions never `UPDATE` these rows (§2 P8).
5. **Audit trail** — Every function logs its request, response, and any errors to `metadata` JSONB columns.

#### 7.1.1 Request/Response Contract

Every edge function follows this uniform contract:

| Field | Type | Required | Description |
|---|---|---|---|
| `Authorization` | Header | Yes | `Bearer {supabase_anon_key}` or `Bearer {supabase_service_role_key}` |
| `x-tenant-id` | Header | Conditional | UUID of tenant. Required for tenant-scoped endpoints. |
| `x-store-id` | Header | Conditional | UUID of store. Required for store-scoped endpoints. |
| `x-device-uuid` | Header | Conditional | Device UUID for idempotency key generation. Required for cart/tender/shift endpoints. |
| `x-idempotency-key` | Header | Conditional | Explicit idempotency key. Overrides auto-generation. |
| `Content-Type` | Header | Yes | `application/json` |

Response envelope:

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-05-29T12:00:00Z"
  }
}
```

Error envelope:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description",
    "detail": { ... }
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-05-29T12:00:00Z"
  }
}
```

#### 7.1.2 Error Code Reference

| Code | HTTP Status | Description |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid auth token |
| `FORBIDDEN` | 403 | Authenticated but not authorized for this action (RBAC) |
| `TENANT_NOT_FOUND` | 404 | `x-tenant-id` does not exist or caller has no membership |
| `STORE_NOT_FOUND` | 404 | `x-store-id` does not exist in tenant |
| `REGISTER_NOT_FOUND` | 404 | Register UUID or device_uuid not found |
| `SHIFT_NOT_OPEN` | 409 | No open shift for this register |
| `SHIFT_ALREADY_OPEN` | 409 | A shift is already open on this register |
| `SESSION_EXPIRED` | 401 | Session has timed out due to inactivity |
| `CART_NOT_FOUND` | 404 | Cart UUID not found or not in 'open' status |
| `CART_LOCKED` | 409 | Cart is locked — no line modifications allowed |
| `CART_ALREADY_PAID` | 409 | Cart has already been paid |
| `ITEM_NOT_FOUND` | 404 | Menu item UUID not found or not available |
| `MODIFIER_INVALID` | 400 | Modifier selection violates group constraints |
| `TENDER_FAILED` | 422 | Payment gateway returned failure |
| `TENDER_TIMEOUT` | 504 | Payment gateway polling timed out |
| `IDEMPOTENCY_CONFLICT` | 409 | Idempotency key exists but payload differs |
| `INSUFFICIENT_STOCK` | 422 | Ingredient stock below threshold for recipe |
| `OFFLINE_SYNC_ERROR` | 422 | Batch contains unresolvable conflicts |
| `INVALID_STATE_TRANSITION` | 422 | Requested status change violates state machine |
| `ROTANAK_UNAVAILABLE` | 502 | Rotanak loyalty service unreachable |
| `HSAL_UNAVAILABLE` | 502 | HSAL delivery service unreachable |
| `ABA_PAYWAY_ERROR` | 502 | ABA PayWay gateway error |
| `RATE_LIMITED` | 429 | Too many requests — exponential backoff required |
| `VALIDATION_ERROR` | 400 | Request body fails JSONSchema validation |

#### 7.1.3 Idempotency Implementation

All cart-creating, tender-creating, and shift-opening functions enforce idempotency:

```typescript
// Idempotency key format: [device_uuid]_[counter]_[timestamp]
// Example: "pi5-t1-kitchen-a1b2_00427_20260529T120000Z"

// Check logic (pseudocode):
const existing = await db.query(
  "SELECT * FROM {table} WHERE idempotency_key = $1",
  [idempotencyKey]
);
if (existing) {
  if (hash(existing.payload) === hash(currentPayload)) {
    return existing.response; // Idempotent replay
  } else {
    throw IDEMPOTENCY_CONFLICT; // Key collision with different payload
  }
}
```

Idempotency keys are stored with a 24-hour TTL. After TTL expiry, the key may be garbage-collected.

---

### 7.2 Auth Functions

Phone OTP is the primary authentication method (Master Context §7). Auth functions are unscoped — they do not require `x-tenant-id`.

---

#### `auth-phone-otp-send`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/auth-phone-otp-send` |
| **Auth Required** | No |
| **Tenant Scoped** | No |

**Purpose:** Send a 6-digit OTP via SMS to the given phone number. Rate-limited to 3 requests per 10 minutes per phone number.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["phone"],
  "properties": {
    "phone": {
      "type": "string",
      "pattern": "^\\+855[0-9]{8,9}$",
      "description": "Cambodian phone number with country code"
    }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["otp_sent", "expires_in"],
      "properties": {
        "otp_sent": { "type": "boolean", "description": "True if OTP was successfully dispatched" },
        "expires_in": { "type": "integer", "description": "Seconds until OTP expires (default: 300)" },
        "rate_limit_remaining": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `VALIDATION_ERROR`, `RATE_LIMITED`

**Tables Read:** `cp.accounts` (check if phone exists)  
**Tables Written:** None (OTP stored in Supabase Auth internal)

---

#### `auth-phone-otp-verify`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/auth-phone-otp-verify` |
| **Auth Required** | No |
| **Tenant Scoped** | No |

**Purpose:** Verify the 6-digit OTP and return a Supabase session (access_token + refresh_token). Creates a new `cp.accounts` row if the phone number is not yet registered.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["phone", "otp"],
  "properties": {
    "phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "otp": { "type": "string", "pattern": "^[0-9]{6}$" },
    "create_profile": {
      "type": "object",
      "properties": {
        "display_name": { "type": "string", "maxLength": 100 },
        "preferred_language": { "type": "string", "enum": ["km", "en"], "default": "km" }
      }
    }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["session", "account"],
      "properties": {
        "session": {
          "type": "object",
          "required": ["access_token", "refresh_token", "expires_in"],
          "properties": {
            "access_token": { "type": "string" },
            "refresh_token": { "type": "string" },
            "expires_in": { "type": "integer" }
          }
        },
        "account": {
          "type": "object",
          "required": ["id", "phone", "display_name"],
          "properties": {
            "id": { "type": "string", "format": "uuid" },
            "phone": { "type": "string" },
            "display_name": { "type": "string" },
            "memberships": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "tenant_id": { "type": "string", "format": "uuid" },
                  "tenant_name": { "type": "string" },
                  "role": { "type": "string", "enum": ["owner", "manager", "cashier", "kitchen_staff", "readonly"] }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `VALIDATION_ERROR`, `UNAUTHORIZED` (wrong/expired OTP)

**Tables Read:** `cp.accounts`, `cp.tenant_memberships`, `cp.tenants`  
**Tables Written:** `cp.accounts` (if new user), `auth.users` (via Supabase Auth API)

---

#### `auth-session-refresh`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/auth-session-refresh` |
| **Auth Required** | Yes (refresh_token in body) |
| **Tenant Scoped** | No |

**Purpose:** Refresh an expired access token using a refresh_token. Returns a new session pair.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["refresh_token"],
  "properties": {
    "refresh_token": { "type": "string" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["access_token", "refresh_token", "expires_in"],
      "properties": {
        "access_token": { "type": "string" },
        "refresh_token": { "type": "string" },
        "expires_in": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `UNAUTHORIZED` (invalid/expired refresh token)

**Tables Read:** None (handled by Supabase Auth API)  
**Tables Written:** None

---

### 7.3 Cart Functions

Cart functions manage the order-in-progress lifecycle. All cart functions require an open shift (§7.5) and active session (§7.6). Permission: `membership_role IN ('owner', 'manager', 'cashier', 'staff')` per RBAC (Part 10).

---

#### `pos-cart-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes (x-tenant-id, x-store-id) |
| **Idempotent** | Yes |

**Purpose:** Create a new empty cart. The cart is linked to the current shift and session. `service_mode` and `origin_channel` determine downstream behavior (e.g., `delivery` orders trigger HSAL booking after T4 slot assignment).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["register_id"],
  "properties": {
    "register_id": { "type": "string", "format": "uuid" },
    "service_mode": { "type": "string", "enum": ["dine_in", "takeaway", "delivery"], "default": "dine_in" },
    "origin_channel": { "type": "string", "enum": ["walk_in", "tma"], "default": "walk_in" },
    "customer_name": { "type": "string", "maxLength": 100 },
    "customer_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "tab_id": { "type": "string", "format": "uuid", "description": "Link to existing cafe.tabs row" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "cart_status", "created_at"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "cart_status": { "type": "string", "enum": ["open", "locked", "paid", "cancelled", "refunded"] },
        "service_mode": { "type": "string" },
        "grand_total_khr": { "type": "integer", "description": "Always 0 for new cart, formatKHR applied" },
        "tab_id": { "type": ["string", "null"], "format": "uuid" },
        "created_at": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Error Codes:** `SHIFT_NOT_OPEN`, `SESSION_EXPIRED`, `STORE_NOT_FOUND`, `REGISTER_NOT_FOUND`, `IDEMPOTENCY_CONFLICT`

**Tables Read:** `pos.shifts` (verify open shift), `pos.sessions` (verify active session), `pos.registers` (verify register belongs to store), `cafe.tabs` (if tab_id provided)  
**Tables Written:** `pos.carts` (§6.2.3)

**Idempotency:** Checks `pos.carts.idempotency_key`. If key exists with identical payload (same register_id, service_mode, customer_phone), returns existing cart. If key exists with different payload, returns `IDEMPOTENCY_CONFLICT`.

---

#### `pos-cart-add-line`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-add-line` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes (per entire modified cart) |

**Purpose:** Add a line item to an open cart. Validates that the item exists in `menu.items` (§6.2.5), is available (`is_available = true`), and applies modifier selections. Modifier validation enforces `pick_one`/`pick_many` constraints and `is_required` rules per `menu.item_modifier_groups` (§6.2.5).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "item_id", "quantity"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "item_id": { "type": "string", "format": "uuid" },
    "quantity": { "type": "number", "minimum": 0.01, "description": "Supports fractional quantities" },
    "modifiers": {
      "type": "array",
      "description": "Selected modifier options",
      "items": {
        "type": "object",
        "required": ["modifier_group_id", "modifier_ids"],
        "properties": {
          "modifier_group_id": { "type": "string", "format": "uuid" },
          "modifier_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } }
        }
      }
    },
    "special_instructions": { "type": "string", "maxLength": 200 },
    "line_discount": { "type": "number", "minimum": 0, "default": 0 },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "line_id", "line_number", "line_total_khr", "cart_grand_total_khr", "modifier_upcharge_khr"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "line_id": { "type": "string", "format": "uuid" },
        "line_number": { "type": "integer" },
        "display_name": { "type": "string", "description": "Denormalized: item name + modifiers" },
        "quantity": { "type": "number" },
        "unit_price_khr": { "type": "integer" },
        "line_total_khr": { "type": "integer" },
        "modifier_upcharge_khr": { "type": "integer", "default": 0 },
        "cart_grand_total_khr": { "type": "integer" },
        "cart_line_count": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_LOCKED`, `ITEM_NOT_FOUND`, `MODIFIER_INVALID`, `VALIDATION_ERROR`

**Tables Read:** `pos.carts`, `menu.items`, `menu.item_modifier_groups`, `cafe.modifier_groups`, `cafe.modifiers`  
**Tables Written:** `pos.cart_lines` (§6.2.3), `pos.carts` (update subtotal, grand_total, derived KHR columns)

**Idempotency:** If the same idempotency key is replayed with identical payload, returns the previously created line. Re-computes cart totals idempotently.

**KHR Calculation:** All KHR display values computed via `formatKHR` (Part 8). `unit_price_khr`, `line_total_khr`, `modifier_upcharge_khr`, and cart-level `grand_total_khr` are derived and written at transaction time.

---

#### `pos-cart-update-line`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-update-line` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Update the quantity, modifiers, or discount of an existing cart line. The line must not be voided. Recalculates line total and cart grand total.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "line_id"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "line_id": { "type": "string", "format": "uuid" },
    "quantity": { "type": "number", "minimum": 0.01 },
    "modifiers": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["modifier_group_id", "modifier_ids"],
        "properties": {
          "modifier_group_id": { "type": "string", "format": "uuid" },
          "modifier_ids": { "type": "array", "items": { "type": "string", "format": "uuid" } }
        }
      }
    },
    "line_discount": { "type": "number", "minimum": 0 },
    "special_instructions": { "type": "string", "maxLength": 200 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "line_id", "line_total_khr", "cart_grand_total_khr"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "line_id": { "type": "string", "format": "uuid" },
        "line_total_khr": { "type": "integer" },
        "modifier_upcharge_khr": { "type": "integer" },
        "cart_grand_total_khr": { "type": "integer" },
        "updated_at": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_LOCKED`, `ITEM_NOT_FOUND` (line not found), `MODIFIER_INVALID`

**Tables Read:** `pos.carts`, `pos.cart_lines`, `menu.items`, `cafe.modifiers`  
**Tables Written:** `pos.cart_lines` (update), `pos.carts` (recompute totals and KHR derived columns)

---

#### `pos-cart-remove-line`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-remove-line` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Remove (void) a line item from a cart. The cart must be in `open` status. Sets `is_voided = true` on the line — does not physically delete. Logs void reason and actor.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "line_id"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "line_id": { "type": "string", "format": "uuid" },
    "void_reason": { "type": "string", "maxLength": 200 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "line_id", "is_voided", "cart_grand_total_khr"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "line_id": { "type": "string", "format": "uuid" },
        "is_voided": { "type": "boolean" },
        "voided_at": { "type": "string", "format": "date-time" },
        "cart_grand_total_khr": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_LOCKED`

**Tables Read:** `pos.carts`, `pos.cart_lines`  
**Tables Written:** `pos.cart_lines` (set is_voided, voided_at, voided_by), `pos.carts` (recompute totals)

---

#### `pos-cart-apply-discount`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-apply-discount` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Apply a discount to the entire cart or a specific line. Discount types: `fixed_amount` (subtract KHR amount), `percentage` (percent off). Enforces minimum order value constraints if configured.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "discount_type", "discount_value"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "line_id": { "type": "string", "format": "uuid", "description": "If null, applies to entire cart" },
    "discount_type": { "type": "string", "enum": ["fixed_amount", "percentage"] },
    "discount_value": { "type": "number", "minimum": 0, "description": "Amount in KHR or percentage (0-100)" },
    "discount_reason": { "type": "string", "maxLength": 200 },
    "requires_manager_approval": { "type": "boolean", "default": false }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "discount_total_khr", "cart_grand_total_khr"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "discount_total_khr": { "type": "integer" },
        "cart_grand_total_khr": { "type": "integer" },
        "applied_to_line": { "type": "boolean" }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_LOCKED`, `FORBIDDEN` (manager approval required but caller lacks role)

**Tables Read:** `pos.carts`, `pos.cart_lines`, `cp.tenant_memberships` (RBAC check for approval)  
**Tables Written:** `pos.carts` (update discount_total, grand_total, derived KHR), `pos.cart_lines` (if line-specific discount)

---

#### `pos-cart-finalize`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cart-finalize` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Lock the cart, mark it as `locked` (ready for tender), and create downstream records. For cafe vertical (`store.vertical_type = 'cafe'`), creates an `ops.cafe_orders` row with `order_status = 'new'` (§6.2.7, R-3). This is the gateway from cart editing to payment.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "cart_status", "grand_total_khr", "cafe_order_id"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "cart_status": { "type": "string", "enum": ["locked", "paid"] },
        "grand_total_khr": { "type": "integer" },
        "cafe_order_id": { "type": ["string", "null"], "format": "uuid", "description": "Set if cafe vertical" },
        "order_status": { "type": ["string", "null"], "description": "'new' if cafe vertical" },
        "receipt_number": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_ALREADY_PAID`, `INVALID_STATE_TRANSITION`

**Tables Read:** `pos.carts`, `pos.cart_lines` (verify at least 1 non-voided line), `pos.stores` (check vertical_type)  
**Tables Written:** `pos.carts` (set cart_status='locked'), `ops.cafe_orders` (if cafe — §6.2.7)

**Idempotency:** If cart is already locked with matching idempotency key, returns existing state. If cart is already paid, returns `CART_ALREADY_PAID`.

---

### 7.4 Tender Functions

Tender functions handle payment processing. Tenders are append-only financial records (§2 P8). Permission: `membership_role IN ('owner', 'manager', 'cashier')`.

---

#### `pos-tender-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-tender-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Create a tender record on a locked cart. The tender is in `pending` status. For split tender, multiple tenders can be created on the same cart (sum of tender amounts must equal cart grand total before capture).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "tender_type", "amount_khr"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "tender_type": { "type": "string", "enum": ["cash", "aba_card", "aba_khqr", "sleung_coin", "debt"] },
    "amount_khr": { "type": "integer", "minimum": 0, "description": "Amount in KHR integer" },
    "tip_khr": { "type": "integer", "minimum": 0, "default": 0 },
    "sleung_coins_to_use": { "type": "integer", "minimum": 0, "default": 0, "description": "For sleung_coin tender type" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tender_id", "tender_status", "amount_khr", "remaining_balance_khr"],
      "properties": {
        "tender_id": { "type": "string", "format": "uuid" },
        "tender_status": { "type": "string", "enum": ["pending", "authorized", "captured", "failed", "refunded", "voided"] },
        "amount_khr": { "type": "integer" },
        "remaining_balance_khr": { "type": "integer", "description": "Cart grand_total - sum of all tender amounts" },
        "is_split_tender": { "type": "boolean" }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `CART_LOCKED` (cart not locked — must finalize first), `TENDER_FAILED`, `VALIDATION_ERROR` (amount exceeds remaining balance)

**Tables Read:** `pos.carts`, `pos.tenders` (sum existing tenders)  
**Tables Written:** `pos.tenders` (§6.2.3)

**Idempotency:** Checks `pos.tenders` by `(cart_id, idempotency_key)` unique constraint. Returns existing tender on replay.

---

#### `pos-tender-attempt`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-tender-attempt` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Execute a payment attempt for a pending tender. This is the gateway to external payment processors:
- `cash`/`debt`: Immediately authorized — no external call.
- `aba_card`: Calls `pos-cafe-aba-card-charge` internally.
- `aba_khqr`: Calls `pos-cafe-aba-khqr-generate` internally, returns deeplink for polling.
- `sleung_coin`: Calls `rotanak-coin-redeem` internally.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tender_id"],
  "properties": {
    "tender_id": { "type": "string", "format": "uuid" },
    "card_token": { "type": "string", "description": "For aba_card: tokenized card reference" },
    "customer_phone": { "type": "string", "description": "For aba_khqr and rotanak lookups" },
    "auto_capture": { "type": "boolean", "default": true, "description": "If true, mark as captured on success" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tender_id", "attempt_id", "status"],
      "properties": {
        "tender_id": { "type": "string", "format": "uuid" },
        "attempt_id": { "type": "string", "format": "uuid" },
        "status": { "type": "string", "enum": ["pending", "processing", "success", "failed", "timeout"] },
        "gateway": { "type": "string", "enum": ["aba_payway", "rotanak", "internal"] },
        "redirect_url": { "type": ["string", "null"], "description": "For 3DS card flow" },
        "khqr_deeplink": { "type": ["string", "null"], "description": "For KHQR: QR deeplink URL" },
        "khqr_md5": { "type": ["string", "null"], "description": "For KHQR polling" },
        "sleung_coins_redeemed": { "type": ["integer", "null"] },
        "error_code": { "type": ["string", "null"] },
        "error_message": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Error Codes:** `TENDER_FAILED`, `TENDER_TIMEOUT`, `ABA_PAYWAY_ERROR`, `ROTANAK_UNAVAILABLE`

**Tables Read:** `pos.tenders`, `pos.carts`  
**Tables Written:** `pos.tender_attempts` (§6.2.3), `pos.tenders` (update status on success/failure)

---

#### `pos-tender-retry`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-tender-retry` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Retry a failed tender with the same or different payment method. Increments the attempt counter on `pos.tender_attempts`. Maximum 3 retries per tender.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tender_id"],
  "properties": {
    "tender_id": { "type": "string", "format": "uuid" },
    "new_tender_type": { "type": "string", "enum": ["cash", "aba_card", "aba_khqr", "sleung_coin", "debt"] },
    "card_token": { "type": "string" },
    "reason": { "type": "string", "maxLength": 200 }
  }
}
```

**Response JSONSchema:** Same as `pos-tender-attempt`.

**Error Codes:** `TENDER_FAILED`, `RATE_LIMITED` (exceeded 3 retries)

**Tables Read:** `pos.tenders`, `pos.tender_attempts` (count existing attempts)  
**Tables Written:** `pos.tender_attempts` (new attempt row), `pos.tenders` (update tender_type if changed)

---

#### `pos-tender-refund`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-tender-refund` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Issue a full or partial refund against a captured tender. For ABA PayWay refunds, calls the ABA refund API using `aba_payway_ref`. Cash refunds are recorded internally. Refund amount cannot exceed original tender amount minus previously refunded amount.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tender_id", "refund_amount_khr"],
  "properties": {
    "tender_id": { "type": "string", "format": "uuid" },
    "refund_amount_khr": { "type": "integer", "minimum": 1 },
    "refund_reason": { "type": "string", "maxLength": 200 },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tender_id", "refund_status", "refund_amount_khr", "remaining_refundable_khr"],
      "properties": {
        "tender_id": { "type": "string", "format": "uuid" },
        "refund_status": { "type": "string", "enum": ["pending", "completed", "failed"] },
        "refund_amount_khr": { "type": "integer" },
        "remaining_refundable_khr": { "type": "integer" },
        "aba_refund_reference": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Error Codes:** `TENDER_FAILED` (tender not in captured status), `VALIDATION_ERROR` (refund amount exceeds remaining)

**Tables Read:** `pos.tenders`, `pos.tender_attempts`  
**Tables Written:** `pos.tenders` (new refund tender row with negative amount, status='refunded'), `pos.tender_attempts` (refund attempt)

**Idempotency:** Refund idempotency key scoped to `(original_tender_id, refund_amount_khr, idempotency_key)`. Replays return the same refund record.

---

### 7.5 KHQR Functions (ABA PayWay)

KHQR functions implement Cambodia's QR payment standard via ABA PayWay (Master Context §7). These are internal — called by `pos-tender-attempt` for `aba_khqr` tender type, but exposed as standalone functions for testing and diagnostics.

---

#### `pos-cafe-aba-khqr-generate`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cafe-aba-khqr-generate` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Generate a KHQR deeplink for ABA PayWay. Returns a QR code payload and a deeplink URL that the customer scans with their ABA Mobile app. Creates an initial `pos.tender_attempts` row with `status='pending'`.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tender_id", "amount_khr"],
  "properties": {
    "tender_id": { "type": "string", "format": "uuid" },
    "amount_khr": { "type": "integer", "minimum": 100 },
    "description": { "type": "string", "maxLength": 50, "default": "KitLuy Order" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["qr_payload", "deeplink_url", "md5", "expiry_seconds"],
      "properties": {
        "qr_payload": { "type": "string", "description": "KHQR string to render as QR code" },
        "deeplink_url": { "type": "string", "description": "ABA Mobile deep link" },
        "md5": { "type": "string", "description": "Hash for polling" },
        "expiry_seconds": { "type": "integer", "description": "QR expires after 180s" },
        "attempt_id": { "type": "string", "format": "uuid" }
      }
    }
  }
}
```

**Error Codes:** `ABA_PAYWAY_ERROR`, `VALIDATION_ERROR`, `TENDER_NOT_FOUND`

**Tables Read:** `pos.tenders`, `pos.stores` (ABA merchant config)  
**Tables Written:** `pos.tender_attempts` (§6.2.3)

---

#### `pos-cafe-aba-khqr-poll`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cafe-aba-khqr-poll` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Poll the ABA PayWay API for payment status. Implements the 180-second timeout with 3x exponential backoff pattern (Master Context §7). The terminal calls this endpoint in a loop until success, failure, or timeout.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["attempt_id", "md5"],
  "properties": {
    "attempt_id": { "type": "string", "format": "uuid" },
    "md5": { "type": "string", "description": "From khqr-generate response" },
    "poll_count": { "type": "integer", "minimum": 0, "description": "Current poll attempt number" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["status", "poll_count", "next_poll_ms"],
      "properties": {
        "status": { "type": "string", "enum": ["pending", "processing", "success", "failed", "timeout", "expired"] },
        "poll_count": { "type": "integer" },
        "next_poll_ms": { "type": "integer", "description": "Recommended delay before next poll" },
        "remaining_seconds": { "type": "integer" },
        "aba_payway_ref": { "type": ["string", "null"] },
        "khqr_trace_id": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Polling Strategy (T1 cashier implementation):**
```typescript
// Exponential backoff: 3s, 6s, 12s, then 12s repeats until 180s total
var pollInterval = function(n) {
  if (n === 0) return 3000;
  if (n === 1) return 6000;
  if (n === 2) return 12000;
  return 12000; // steady state after 3rd backoff
};
// Max total time: 180 seconds
var maxPollTime = 180000;
```

**Error Codes:** `TENDER_TIMEOUT` (180s exceeded), `ABA_PAYWAY_ERROR`

**Tables Read:** `pos.tender_attempts`  
**Tables Written:** `pos.tender_attempts` (update status, response_payload), `pos.tenders` (update status to 'captured' on success, 'failed' on timeout)

---

### 7.6 Card Functions (ABA PayWay)

Card functions handle 3DS-enabled card payments via ABA PayWay.

---

#### `pos-cafe-aba-card-tokenize`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cafe-aba-card-tokenize` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Tokenize a credit/debit card for future use. Collects card details via a PCI-compliant iframe (hosted by ABA), returns a token that can be stored and reused. The token is stored in `pos.tenders.aba_token` for repeat customers.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["card_number", "expiry_month", "expiry_year", "cvv"],
  "properties": {
    "card_number": { "type": "string", "pattern": "^[0-9]{16}$" },
    "expiry_month": { "type": "string", "pattern": "^(0[1-9]|1[0-2])$" },
    "expiry_year": { "type": "string", "pattern": "^[0-9]{2}$" },
    "cvv": { "type": "string", "pattern": "^[0-9]{3,4}$" },
    "cardholder_name": { "type": "string", "maxLength": 100 },
    "customer_phone": { "type": "string", "description": "For linking token to customer" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["token", "card_last_four", "card_brand"],
      "properties": {
        "token": { "type": "string", "description": "ABA card token for reuse" },
        "card_last_four": { "type": "string" },
        "card_brand": { "type": "string", "enum": ["visa", "mastercard", "jcb", "unionpay"] },
        "expiry_month": { "type": "string" },
        "expiry_year": { "type": "string" }
      }
    }
  }
}
```

**Error Codes:** `ABA_PAYWAY_ERROR`, `VALIDATION_ERROR`

**Tables Read:** None  
**Tables Written:** None (token returned to caller, stored in `pos.tenders.aba_token` at tender time)

---

#### `pos-cafe-aba-card-charge`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-cafe-aba-card-charge` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Charge a card using either raw card details (first time) or a stored token (returning customer). Implements 3DS redirect flow: if 3DS is required, returns a `redirect_url` for the customer to complete authentication.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tender_id", "amount_khr"],
  "properties": {
    "tender_id": { "type": "string", "format": "uuid" },
    "amount_khr": { "type": "integer", "minimum": 100 },
    "card_token": { "type": "string", "description": "Use token if available" },
    "card_number": { "type": "string", "pattern": "^[0-9]{16}$" },
    "expiry_month": { "type": "string" },
    "expiry_year": { "type": "string" },
    "cvv": { "type": "string" },
    "return_url": { "type": "string", "description": "URL for 3DS redirect completion" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["status"],
      "properties": {
        "status": { "type": "string", "enum": ["authorized", "captured", "3ds_required", "failed"] },
        "redirect_url": { "type": ["string", "null"], "description": "3DS redirect if required" },
        "aba_payway_ref": { "type": ["string", "null"] },
        "card_token": { "type": ["string", "null"], "description": "New token if card was tokenized" },
        "amount_khr": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `ABA_PAYWAY_ERROR`, `TENDER_FAILED`, `VALIDATION_ERROR`

**Tables Read:** `pos.tenders`  
**Tables Written:** `pos.tender_attempts`, `pos.tenders` (update aba_token if new, aba_payway_ref, status)

---

### 7.7 Shift Functions

Shift functions manage cashier operating periods. A shift must be open before any cart operations. Permission: `membership_role IN ('owner', 'manager', 'cashier')`.

---

#### `pos-shift-open`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-shift-open` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Open a new shift on a register. Validates that no shift is already open on this register. Records the opening float (cash in drawer at shift start).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["register_id", "opening_float_khr"],
  "properties": {
    "register_id": { "type": "string", "format": "uuid" },
    "opening_float_khr": { "type": "integer", "minimum": 0, "description": "Cash in drawer at shift start" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["shift_id", "register_id", "opened_at", "opening_float_khr"],
      "properties": {
        "shift_id": { "type": "string", "format": "uuid" },
        "register_id": { "type": "string", "format": "uuid" },
        "opened_at": { "type": "string", "format": "date-time" },
        "opening_float_khr": { "type": "integer" },
        "shift_number": { "type": "integer", "description": "Sequence number for the day" }
      }
    }
  }
}
```

**Error Codes:** `SHIFT_ALREADY_OPEN`, `REGISTER_NOT_FOUND`, `FORBIDDEN`

**Tables Read:** `pos.shifts` (check existing open shift), `pos.registers`  
**Tables Written:** `pos.shifts` (§6.2.3)

**Idempotency:** Checks `(register_id, opened_at::date, idempotency_key)`. If an open shift already exists for this register today with the same key, returns the existing shift. If an open shift exists with a different key, returns `SHIFT_ALREADY_OPEN`.

---

#### `pos-shift-close`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-shift-close` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Close an open shift. Computes `expected_float`, compares to `closing_float`, calculates `discrepancy`, generates Z-report data snapshot, and writes it all to the shift row. All subsequent cart operations on this register will fail until a new shift is opened.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["shift_id", "closing_float_khr"],
  "properties": {
    "shift_id": { "type": "string", "format": "uuid" },
    "closing_float_khr": { "type": "integer", "minimum": 0 },
    "notes": { "type": "string", "maxLength": 500 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["shift_id", "closed_at", "closing_float_khr", "expected_float_khr", "discrepancy_khr", "z_report"],
      "properties": {
        "shift_id": { "type": "string", "format": "uuid" },
        "closed_at": { "type": "string", "format": "date-time" },
        "closing_float_khr": { "type": "integer" },
        "expected_float_khr": { "type": "integer" },
        "discrepancy_khr": { "type": "integer", "description": "Positive = over, Negative = short" },
        "z_report": {
          "type": "object",
          "properties": {
            "total_transactions": { "type": "integer" },
            "total_sales_khr": { "type": "integer" },
            "total_refunds_khr": { "type": "integer" },
            "cash_sales_khr": { "type": "integer" },
            "card_sales_khr": { "type": "integer" },
            "khqr_sales_khr": { "type": "integer" },
            "sleung_coin_sales_khr": { "type": "integer" },
            "by_tender_type": { "type": "object" }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `SHIFT_NOT_OPEN` (shift not found or already closed), `FORBIDDEN`

**Tables Read:** `pos.shifts`, `pos.carts` (sum sales for shift), `pos.tenders` (sum by type)  
**Tables Written:** `pos.shifts` (set closed_at, closing_float, expected_float, discrepancy, z_report_data, is_closed=true)

---

#### `pos-shift-get-current`

| Attribute | Value |
|---|---|
| **Route** | `GET /functions/v1/pos-shift-get-current` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Return the currently open shift for a given register, or null if no shift is open. T1 calls this on startup to determine if it can begin taking orders.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["register_id"],
  "properties": {
    "register_id": { "type": "string", "format": "uuid" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["has_open_shift"],
      "properties": {
        "has_open_shift": { "type": "boolean" },
        "shift": {
          "type": ["object", "null"],
          "properties": {
            "shift_id": { "type": "string", "format": "uuid" },
            "opened_at": { "type": "string", "format": "date-time" },
            "opening_float_khr": { "type": "integer" },
            "current_sales_khr": { "type": "integer" },
            "transaction_count": { "type": "integer" },
            "opened_by_name": { "type": "string" }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `REGISTER_NOT_FOUND`

**Tables Read:** `pos.shifts`, `pos.carts` (count for shift), `cp.accounts` (opened_by name)  
**Tables Written:** None

---

### 7.8 Session Functions

Session functions manage staff login on a register within a shift. Sessions auto-lock after inactivity (default: 5 minutes). Permission: any `tenant_membership` role.

---

#### `pos-session-login`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-session-login` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Log a staff member into a register within an open shift. Creates a `pos.sessions` row. Validates that the caller has a `cp.tenant_memberships` record for the store's tenant.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["register_id", "shift_id"],
  "properties": {
    "register_id": { "type": "string", "format": "uuid" },
    "shift_id": { "type": "string", "format": "uuid" },
    "pin": { "type": "string", "pattern": "^[0-9]{4,6}$", "description": "Staff PIN for quick login" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["session_id", "register_id", "shift_id", "started_at"],
      "properties": {
        "session_id": { "type": "string", "format": "uuid" },
        "register_id": { "type": "string", "format": "uuid" },
        "shift_id": { "type": "string", "format": "uuid" },
        "started_at": { "type": "string", "format": "date-time" },
        "account_display_name": { "type": "string" },
        "auto_lock_seconds": { "type": "integer", "default": 300 }
      }
    }
  }
}
```

**Error Codes:** `SHIFT_NOT_OPEN`, `REGISTER_NOT_FOUND`, `UNAUTHORIZED` (invalid PIN)

**Tables Read:** `pos.shifts`, `pos.registers`, `cp.accounts`, `cp.tenant_memberships`  
**Tables Written:** `pos.sessions` (§6.2.3)

**Idempotency:** Checks `(register_id, shift_id, account_id, idempotency_key)`. Returns existing session on replay.

---

#### `pos-session-logout`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-session-logout` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** End an active session. Sets `is_active = false`, `ended_at = now()`. Any carts linked to this session remain open (tab behavior).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["session_id"],
  "properties": {
    "session_id": { "type": "string", "format": "uuid" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["session_id", "ended_at", "duration_minutes"],
      "properties": {
        "session_id": { "type": "string", "format": "uuid" },
        "ended_at": { "type": "string", "format": "date-time" },
        "duration_minutes": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `SESSION_EXPIRED` (already ended), `FORBIDDEN`

**Tables Read:** `pos.sessions`  
**Tables Written:** `pos.sessions` (set ended_at, is_active=false)

---

#### `pos-session-heartbeat`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-session-heartbeat` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Keep a session alive by updating `last_activity_at`. T1 sends this every 60 seconds while the cashier is active. If no heartbeat is received within the auto-lock window (default 300s), the session is considered expired.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["session_id"],
  "properties": {
    "session_id": { "type": "string", "format": "uuid" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["session_id", "is_active", "seconds_until_lock"],
      "properties": {
        "session_id": { "type": "string", "format": "uuid" },
        "is_active": { "type": "boolean" },
        "seconds_until_lock": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `SESSION_EXPIRED`

**Tables Read:** `pos.sessions`  
**Tables Written:** `pos.sessions` (update last_activity_at)

---

### 7.9 Offline Sync Functions

Offline functions handle sync between the Hub Server (local PostgreSQL replica) and Supabase cloud. The Hub Server queues events during internet outages and submits them in batches when connectivity is restored (Master Context §3, §2 P3).

Permission: `membership_role IN ('owner', 'manager', 'cashier', 'staff')` (terminal-level operation).

---

#### `pos-offline-batch-submit`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-offline-batch-submit` |
| **Auth Required** | Yes (service_role or Hub Server token) |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Submit a batch of offline-sync events from the Hub Server. Each event contains the full row data as captured at the time of the offline operation. The function processes events in order, applying idempotency checks per event.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["store_id", "device_uuid", "events"],
  "properties": {
    "store_id": { "type": "string", "format": "uuid" },
    "device_uuid": { "type": "string" },
    "events": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["event_type", "table_name", "record_id", "payload", "idempotency_key", "timestamp"],
        "properties": {
          "event_type": { "type": "string", "enum": ["cart_create","cart_update","tender_create","tender_attempt","shift_open","shift_close","session_start","session_end","item_update","price_update"] },
          "table_name": { "type": "string" },
          "record_id": { "type": "string", "format": "uuid" },
          "payload": { "type": "object", "description": "Full row data as JSON" },
          "idempotency_key": { "type": "string" },
          "timestamp": { "type": "string", "format": "date-time", "description": "When event was captured locally" }
        }
      }
    },
    "batch_idempotency_key": { "type": "string" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["batch_id", "batch_status", "processed", "synced", "conflicts", "errors"],
      "properties": {
        "batch_id": { "type": "string", "format": "uuid" },
        "batch_status": { "type": "string", "enum": ["synced", "partial", "conflict", "error"] },
        "processed": { "type": "integer" },
        "synced": { "type": "integer" },
        "conflicts": { "type": "integer" },
        "errors": { "type": "integer" },
        "event_results": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "event_index": { "type": "integer" },
              "status": { "type": "string", "enum": ["synced", "conflict", "error", "duplicate"] },
              "error_code": { "type": ["string", "null"] },
              "server_record": { "type": ["object", "null"], "description": "Current server state on conflict" }
            }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `OFFLINE_SYNC_ERROR`, `STORE_NOT_FOUND`

**Tables Read:** `pos.offline_sync_batches` (check existing batch), all referenced tables (for conflict detection)  
**Tables Written:** `pos.offline_sync_batches` (§6.2.3), `pos.offline_sync_events` (one per event)

**Idempotency:** If `batch_idempotency_key` has been processed before, returns the previous result in full.

**Conflict Detection:** For each event, the function checks if the target row has been modified server-side since the event's `timestamp`. If so, the event status is set to `conflict` and the server-side record is included in `server_record` for resolution.

---

#### `pos-offline-batch-sync`

| Attribute | Value |
|---|---|
| **Route** | `GET /functions/v1/pos-offline-batch-sync` |
| **Auth Required** | Yes (service_role) |
| **Tenant Scoped** | Yes |

**Purpose:** Poll the server for the status of submitted sync batches. The Hub Server calls this periodically to check which batches have been processed and whether any conflicts need resolution.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["store_id"],
  "properties": {
    "store_id": { "type": "string", "format": "uuid" },
    "since": { "type": "string", "format": "date-time", "description": "Only return batches updated since this time" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["batches"],
      "properties": {
        "batches": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "batch_id": { "type": "string", "format": "uuid" },
              "batch_status": { "type": "string" },
              "event_count": { "type": "integer" },
              "synced_count": { "type": "integer" },
              "conflict_count": { "type": "integer" },
              "completed_at": { "type": ["string", "null"] }
            }
          }
        }
      }
    }
  }
}
```

**Tables Read:** `pos.offline_sync_batches`  
**Tables Written:** None

---

#### `pos-offline-conflict-resolve`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/pos-offline-conflict-resolve` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Resolve a sync conflict by choosing either the `local` version, the `server` version, or providing a `merged` version. Called by the Hub Server when it detects a `conflict` status on any event.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["batch_id", "event_id", "resolution"],
  "properties": {
    "batch_id": { "type": "string", "format": "uuid" },
    "event_id": { "type": "string", "format": "uuid" },
    "resolution": { "type": "string", "enum": ["local", "server", "merged"] },
    "merged_payload": { "type": "object", "description": "Required if resolution='merged'" },
    "resolved_by": { "type": "string", "format": "uuid" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["event_id", "resolution", "applied"],
      "properties": {
        "event_id": { "type": "string", "format": "uuid" },
        "resolution": { "type": "string" },
        "applied": { "type": "boolean" }
      }
    }
  }
}
```

**Error Codes:** `OFFLINE_SYNC_ERROR`, `VALIDATION_ERROR` (merged_payload missing for merged resolution)

**Tables Read:** `pos.offline_sync_batches`, `pos.offline_sync_events`  
**Tables Written:** `pos.offline_sync_events` (update event_status), target table (apply resolved version)

---

### 7.10 Cafe Functions

Cafe functions manage the cafe-specific operational layer: tabs, orders, status tracking, and recipe deduction. These functions only operate when `store.vertical_type = 'cafe'`. All cafe functions require an active session on a T1 (cashier), T3 (KDS), or T4 (DDS) register.

Permission: `membership_role IN ('owner', 'manager', 'cashier', 'staff')`.

---

#### `cafe-tab-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-tab-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Open a new tab (running order) for dine-in or takeaway. Tabs survive shift changes. The tab is linked to a customer name/phone for retrieval. Tab numbers are store-scoped and auto-increment (e.g., `T-001`, `T-002`).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["store_id"],
  "properties": {
    "store_id": { "type": "string", "format": "uuid" },
    "customer_name": { "type": "string", "maxLength": 100 },
    "customer_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "customer_count": { "type": "integer", "minimum": 1, "description": "Number of people at table" },
    "service_mode": { "type": "string", "enum": ["dine_in", "takeaway"], "default": "dine_in" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tab_id", "tab_number", "tab_status", "service_mode"],
      "properties": {
        "tab_id": { "type": "string", "format": "uuid" },
        "tab_number": { "type": "string", "description": "e.g., T-001" },
        "tab_status": { "type": "string", "enum": ["open", "closed", "cancelled"] },
        "service_mode": { "type": "string" },
        "customer_name": { "type": ["string", "null"] },
        "opened_at": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Error Codes:** `STORE_NOT_FOUND`, `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`

**Tables Read:** `pos.stores` (verify vertical_type='cafe'), `cafe.tabs` (generate next tab_number)  
**Tables Written:** `cafe.tabs` (§6.2.6)

**Idempotency:** If `(store_id, customer_phone, idempotency_key)` exists and the tab is still open, return the existing tab. This prevents duplicate tabs for the same customer created by double-tap.

---

#### `cafe-tab-close`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-tab-close` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Close a tab after all linked carts have been paid. Validates that `balance_due_khr = 0` (all carts paid). Sets `tab_status = 'closed'`.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tab_id"],
  "properties": {
    "tab_id": { "type": "string", "format": "uuid" },
    "close_reason": { "type": "string", "maxLength": 200 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tab_id", "tab_status", "closed_at", "total_paid_khr"],
      "properties": {
        "tab_id": { "type": "string", "format": "uuid" },
        "tab_status": { "type": "string" },
        "closed_at": { "type": "string", "format": "date-time" },
        "total_paid_khr": { "type": "integer" },
        "total_ordered_khr": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `VALIDATION_ERROR` (balance_due > 0), `FORBIDDEN`

**Tables Read:** `cafe.tabs`, `pos.carts` (sum totals for tab)  
**Tables Written:** `cafe.tabs` (set tab_status='closed', closed_at, closed_by, balance_due=0)

---

#### `cafe-order-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-order-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Create a `ops.cafe_orders` record from an existing `pos.carts` row. This is the operational layer entry point — it does NOT create a cart; the cart must already exist (created by `pos-cart-create`). Fires when `pos.carts.cart_status` transitions to `'locked'` (called internally by `pos-cart-finalize`).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "tab_id": { "type": ["string", "null"], "format": "uuid" },
    "tma_chat_id": { "type": ["string", "null"] },
    "tma_user_id": { "type": ["string", "null"] },
    "special_instructions": { "type": "string", "maxLength": 500 },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cafe_order_id", "cart_id", "order_status", "kitchen_items"],
      "properties": {
        "cafe_order_id": { "type": "string", "format": "uuid" },
        "cart_id": { "type": "string", "format": "uuid" },
        "order_status": { "type": "string", "enum": ["new","confirmed","preparing","ready_for_pickup","served","cancelled"] },
        "tab_id": { "type": ["string", "null"] },
        "kitchen_items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "line_id": { "type": "string", "format": "uuid" },
              "item_name": { "type": "string" },
              "quantity": { "type": "number" },
              "modifiers": { "type": "array", "items": { "type": "string" } },
              "special_instructions": { "type": "string" }
            }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `CART_NOT_FOUND`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_CONFLICT`

**Tables Read:** `pos.carts`, `pos.cart_lines`, `pos.stores` (verify cafe vertical)  
**Tables Written:** `ops.cafe_orders` (§6.2.7)

**Idempotency:** `ops.cafe_orders.cart_id` has a `UNIQUE` constraint. Duplicate calls with the same `cart_id` return the existing order.

---

#### `cafe-order-update-status`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-order-update-status` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Advance a cafe order through its state machine. Valid transitions:
- `new` -> `confirmed` (T1 cashier confirms payment received)
- `confirmed` -> `preparing` (T3 KDS starts production)
- `preparing` -> `ready_for_pickup` (T3 KDS completes prep, triggers ingredient deduction)
- `ready_for_pickup` -> `served` (T4 DDS confirms customer pickup)
- Any pre-`served` status -> `cancelled` (manager only)

State machine enforcement per Part 5.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cafe_order_id", "new_status"],
  "properties": {
    "cafe_order_id": { "type": "string", "format": "uuid" },
    "new_status": { "type": "string", "enum": ["confirmed", "preparing", "ready_for_pickup", "served", "cancelled"] },
    "cancel_reason": { "type": "string", "maxLength": 200, "description": "Required if new_status='cancelled'" },
    "assigned_station": { "type": "string", "description": "Which T3 KDS station (for preparing)" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cafe_order_id", "order_status", "previous_status"],
      "properties": {
        "cafe_order_id": { "type": "string", "format": "uuid" },
        "order_status": { "type": "string" },
        "previous_status": { "type": "string" },
        "timestamp": { "type": "string", "format": "date-time" },
        "stickers_triggered": { "type": "boolean", "description": "True if ready_for_pickup triggered cup sticker print" },
        "slot_assigned": { "type": ["integer", "null"] }
      }
    }
  }
}
```

**Error Codes:** `INVALID_STATE_TRANSITION`, `FORBIDDEN` (cancel requires manager), `STORE_NOT_FOUND`

**Tables Read:** `ops.cafe_orders`  
**Tables Written:** `ops.cafe_orders` (update order_status, timestamps per status)

**Side Effects:**
- On `ready_for_pickup`: calls `cafe-recipe-deduct` internally, triggers cup sticker print job, assigns slot via `cafe-order-assign-slot`, broadcasts to T5 via Realtime (`cafe:store:{store_id}` channel).
- On `served`: calls `rotanak-coin-earn` internally (if customer has Rotanak profile), creates `sal.sales_invoice` + `sal.receipts` from `pos.carts`.
- On `cancelled`: calls `pos-tender-refund` for all captured tenders on the linked cart.

---

#### `cafe-order-assign-slot`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-order-assign-slot` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |

**Purpose:** Assign a physical pickup slot number on the T4 counter. Slots are numbered 1-N (configurable per store, default 12). Called automatically on `ready_for_pickup` transition, or manually by T4 DDS. Broadcasts assignment to T5 QDS via Supabase Realtime.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cafe_order_id"],
  "properties": {
    "cafe_order_id": { "type": "string", "format": "uuid" },
    "slot_number": { "type": "integer", "minimum": 1, "description": "Auto-assigned if omitted" },
    "auto_assign": { "type": "boolean", "default": true, "description": "Find lowest available slot" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cafe_order_id", "slot_number", "order_status"],
      "properties": {
        "cafe_order_id": { "type": "string", "format": "uuid" },
        "slot_number": { "type": "integer" },
        "order_status": { "type": "string" },
        "broadcast_sent": { "type": "boolean", "description": "True if Realtime broadcast succeeded" }
      }
    }
  }
}
```

**Error Codes:** `INVALID_STATE_TRANSITION` (order not in ready_for_pickup), `VALIDATION_ERROR` (slot already occupied)

**Tables Read:** `ops.cafe_orders`, `ops.cafe_orders` again (find occupied slots)  
**Tables Written:** `ops.cafe_orders` (set slot_number)

**Realtime Broadcast:**
```typescript
// Supabase Realtime broadcast to T5 QDS
var channel = supabase.channel('cafe:store:' + store_id);
channel.send({
  type: 'broadcast',
  event: 'slot_assigned',
  payload: {
    cafe_order_id: order_id,
    slot_number: slot_num,
    order_status: 'ready_for_pickup',
    customer_name: customer_name,
    timestamp: new Date().toISOString()
  }
});
```

---

#### `cafe-recipe-deduct`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/cafe-recipe-deduct` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Deduct ingredient stock based on a completed order's recipes. Called internally when an order reaches `ready_for_pickup`. Each `menu.items.recipe_id` is resolved to `cafe.recipe_ingredients`, and `cafe.ingredients.current_stock` is decremented by `(quantity * order_qty) * (1 + wastage_pct)`.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cafe_order_id"],
  "properties": {
    "cafe_order_id": { "type": "string", "format": "uuid" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cafe_order_id", "ingredients_deducted", "low_stock_alerts"],
      "properties": {
        "cafe_order_id": { "type": "string", "format": "uuid" },
        "ingredients_deducted": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "ingredient_id": { "type": "string", "format": "uuid" },
              "ingredient_name": { "type": "string" },
              "quantity_deducted": { "type": "number" },
              "remaining_stock": { "type": "number" },
              "is_below_threshold": { "type": "boolean" }
            }
          }
        },
        "low_stock_alerts": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "ingredient_id": { "type": "string", "format": "uuid" },
              "ingredient_name": { "type": "string" },
              "current_stock": { "type": "number" },
              "threshold_qty": { "type": "number" }
            }
          }
        }
      }
    }
  }
}
```

**Error Codes:** `INSUFFICIENT_STOCK` (stock below zero), `CART_NOT_FOUND`

**Tables Read:** `ops.cafe_orders`, `pos.cart_lines`, `menu.items`, `cafe.recipes`, `cafe.recipe_ingredients`, `cafe.ingredients`  
**Tables Written:** `cafe.ingredients` (decrement current_stock)

**Idempotency:** If recipe deduction has already been performed for this `cafe_order_id` (tracked in `ops.cafe_orders.metadata->>'recipe_deducted_at'`), returns the previous result.

**Deduction Formula:**
```typescript
// Per ingredient per order line
var qtyOrdered = cartLineItem.quantity;
var recipeQty = recipe_ingredient.quantity;
var wastageFactor = 1 + recipe_ingredient.wastage_pct;
var totalDeduction = qtyOrdered * recipeQty * wastageFactor;
// Round to 4 decimal places for storage
var roundedDeduction = Math.round(totalDeduction * 10000) / 10000;
```

---

### 7.11 Rotanak Functions (Loyalty)

Rotanak is the ecosystem loyalty engine. KitLuy reads tier/coin data and fires earn/redeem calls — it never writes loyalty rules (Master Context §2 P6, §7).

Permission: any authenticated user (customers query their own profile; cashiers query for tender operations).

---

#### `rotanak-profile-get`

| Attribute | Value |
|---|---|
| **Route** | `GET /functions/v1/rotanak-profile-get` |
| **Auth Required** | Yes |
| **Tenant Scoped** | No (cross-ecosystem) |

**Purpose:** Retrieve a customer's Rotanak loyalty profile: tier name, Sleung Coin balance, earn rate, and available rewards. Called by T1 when a customer provides their phone number for loyalty lookup, and by T2 CDS for displaying loyalty info on the customer-facing screen.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["phone"],
  "properties": {
    "phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["has_profile", "tier"],
      "properties": {
        "has_profile": { "type": "boolean" },
        "tier": { "type": ["string", "null"], "enum": [null, "bronze", "silver", "gold", "platinum"] },
        "tier_name_km": { "type": ["string", "null"] },
        "sleung_coin_balance": { "type": "integer", "default": 0 },
        "earn_rate_percent": { "type": "number", "description": "1-3% based on tier" },
        "lifetime_coins": { "type": "integer", "default": 0 },
        "next_tier_name": { "type": ["string", "null"] },
        "next_tier_progress_percent": { "type": ["number", "null"] },
        "rotanak_gold_banner": { "type": "string", "description": "Always '#F5A623'" }
      }
    }
  }
}
```

**Error Codes:** `ROTANAK_UNAVAILABLE` (502 — Rotanak service unreachable)

**Tables Read:** None (external API call to Rotanak)  
**Tables Written:** None

**Caching:** Profile responses are cached for 60 seconds on the client to reduce API load. The Rotanak gold banner color is always `#F5A623` per Master Context §4.

---

#### `rotanak-coin-earn`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/rotanak-coin-earn` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Fire a coin earn event to Rotanak when a cafe order reaches `served` status. Earn rate is 1-3% of order total (in KHR) based on the customer's tier. Coins are merchant-funded — KitLuy records the liability but Rotanak maintains the ledger.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cafe_order_id", "customer_phone", "order_total_khr"],
  "properties": {
    "cafe_order_id": { "type": "string", "format": "uuid" },
    "customer_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "order_total_khr": { "type": "integer", "minimum": 0 },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cafe_order_id", "coins_earned", "new_balance"],
      "properties": {
        "cafe_order_id": { "type": "string", "format": "uuid" },
        "coins_earned": { "type": "integer" },
        "earn_rate_percent": { "type": "number" },
        "new_balance": { "type": "integer" },
        "rotanak_transaction_id": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Error Codes:** `ROTANAK_UNAVAILABLE`, `VALIDATION_ERROR`

**Tables Read:** `ops.cafe_orders`  
**Tables Written:** `ops.cafe_orders` (update rotanak_coins_earned, rotanak_tier)

**Idempotency:** If `ops.cafe_orders.rotanak_coins_earned > 0` for this order, returns existing earn record. Earn is fired exactly once per order.

**KHR Display:** All coin amounts and order totals are formatted via `formatKHR` (Part 8) for display. Storage is integer KHR.

---

#### `rotanak-coin-redeem`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/rotanak-coin-redeem` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Redeem Sleung Coins as payment on a cart. The **30% cap** is enforced at both preview AND commit: `coins_to_redeem * coin_value_khr <= cart.grand_total_khr * 0.30`. Called by `pos-tender-attempt` when tender_type = `sleung_coin`.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cart_id", "customer_phone", "coins_to_redeem"],
  "properties": {
    "cart_id": { "type": "string", "format": "uuid" },
    "customer_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "coins_to_redeem": { "type": "integer", "minimum": 1 },
    "coin_value_khr": { "type": "integer", "default": 1, "description": "1 coin = 1 KHR" },
    "preview_only": { "type": "boolean", "default": false, "description": "If true, do not commit redemption" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["cart_id", "coins_redeemed", "discount_khr", "remaining_balance_khr"],
      "properties": {
        "cart_id": { "type": "string", "format": "uuid" },
        "coins_redeemed": { "type": "integer" },
        "discount_khr": { "type": "integer" },
        "remaining_balance_khr": { "type": "integer" },
        "thirty_percent_cap_khr": { "type": "integer" },
        "cap_remaining_khr": { "type": "integer", "description": "How much more could be redeemed under cap" },
        "committed": { "type": "boolean", "description": "False if preview_only=true" },
        "new_coin_balance": { "type": ["integer", "null"] }
      }
    }
  }
}
```

**Error Codes:** `ROTANAK_UNAVAILABLE`, `VALIDATION_ERROR` (exceeds 30% cap), `INSUFFICIENT_BALANCE`

**Tables Read:** `pos.carts`, `ops.cafe_orders`  
**Tables Written:** `ops.cafe_orders` (update rotanak_coins_redeemed on commit)

**30% Cap Enforcement:**
```typescript
// Enforced at BOTH preview and commit
var thirtyPercentCap = Math.floor(cart.grand_total_khr * 0.30);
var maxCoins = Math.floor(thirtyPercentCap / coin_value_khr);
if (coins_to_redeem > maxCoins) {
  throw VALIDATION_ERROR("Cannot redeem more than 30% of order total. Max coins: " + maxCoins);
}
```

---

### 7.12 HSAL Functions (Delivery)

HSAL is the ecosystem logistics/driver platform. KitLuy fires delivery bookings — it never manages driver allocation or routing (Master Context §7).

---

#### `hsal-booking-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/hsal-booking-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Book a delivery driver via HSAL after a cafe order has been assigned a slot and the customer requests delivery. Triggered when `service_mode = 'delivery'` and `order_status = 'ready_for_pickup'` (post-T4 slot assignment).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["cafe_order_id", "pickup_location", "dropoff_location"],
  "properties": {
    "cafe_order_id": { "type": "string", "format": "uuid" },
    "pickup_location": {
      "type": "object",
      "required": ["store_name", "address", "phone", "slot_number"],
      "properties": {
        "store_name": { "type": "string" },
        "address": { "type": "string" },
        "phone": { "type": "string" },
        "slot_number": { "type": "integer" },
        "lat": { "type": "number" },
        "lng": { "type": "number" }
      }
    },
    "dropoff_location": {
      "type": "object",
      "required": ["address", "phone", "recipient_name"],
      "properties": {
        "address": { "type": "string" },
        "phone": { "type": "string" },
        "recipient_name": { "type": "string" },
        "lat": { "type": "number" },
        "lng": { "type": "number" },
        "delivery_notes": { "type": "string", "maxLength": 200 }
      }
    },
    "order_summary": {
      "type": "object",
      "required": ["item_count", "total_khr"],
      "properties": {
        "item_count": { "type": "integer" },
        "total_khr": { "type": "integer" },
        "items": { "type": "array", "items": { "type": "string" } }
      }
    },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["booking_id", "hsal_booking_ref", "status"],
      "properties": {
        "booking_id": { "type": "string", "format": "uuid" },
        "hsal_booking_ref": { "type": "string", "description": "HSAL internal reference" },
        "status": { "type": "string", "enum": ["pending", "assigned", "picked_up", "delivered", "cancelled"] },
        "estimated_pickup_minutes": { "type": "integer" },
        "estimated_delivery_minutes": { "type": "integer" },
        "driver_name": { "type": ["string", "null"] },
        "driver_phone": { "type": ["string", "null"] }
      }
    }
  }
}
```

**Error Codes:** `HSAL_UNAVAILABLE`, `VALIDATION_ERROR`

**Tables Read:** `ops.cafe_orders`, `pos.carts`  
**Tables Written:** None (booking state tracked by HSAL; KitLuy stores `hsal_booking_ref` in `ops.cafe_orders.metadata`)

---

### 7.13 Admin Functions

Admin functions are for HET internal operators (`membership_role = 'admin'`) to provision tenants, stores, and registers. These use `service_role` key for cross-tenant operations.

Permission: `membership_role = 'admin'` OR `service_role` key.

---

#### `admin-tenant-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/admin-tenant-create` |
| **Auth Required** | Yes (service_role) |
| **Tenant Scoped** | No |
| **Idempotent** | Yes |

**Purpose:** Create a new tenant and an initial owner account. This is the onboarding entry point for new KitLuy merchants.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["slug", "display_name", "billing_email", "owner_phone"],
  "properties": {
    "slug": { "type": "string", "pattern": "^[a-z0-9-]+$", "maxLength": 50 },
    "display_name": { "type": "string", "maxLength": 100 },
    "billing_email": { "type": "string", "format": "email" },
    "billing_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "owner_phone": { "type": "string", "pattern": "^\\+855[0-9]{8,9}$" },
    "owner_display_name": { "type": "string", "maxLength": 100 },
    "subscription_tier": { "type": "string", "enum": ["starter", "growth", "enterprise"], "default": "starter" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["tenant_id", "slug", "owner_account_id"],
      "properties": {
        "tenant_id": { "type": "string", "format": "uuid" },
        "slug": { "type": "string" },
        "display_name": { "type": "string" },
        "owner_account_id": { "type": "string", "format": "uuid" },
        "owner_membership_id": { "type": "string", "format": "uuid" }
      }
    }
  }
}
```

**Error Codes:** `VALIDATION_ERROR` (slug not unique), `FORBIDDEN`

**Tables Read:** `cp.tenants` (check slug uniqueness)  
**Tables Written:** `cp.tenants` (§6.2.2), `cp.accounts` (owner), `cp.tenant_memberships` (owner role)

**Idempotency:** If `idempotency_key` matches a previously created tenant, returns the existing tenant (prevents duplicate provisioning on retry).

---

#### `admin-store-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/admin-store-create` |
| **Auth Required** | Yes (service_role) |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Create a new store within a tenant. Validates the tenant exists and the caller is an admin or owner. The `vertical_type` is immutable after creation (§2 P1).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tenant_id", "display_name", "slug", "vertical_type", "city"],
  "properties": {
    "tenant_id": { "type": "string", "format": "uuid" },
    "display_name": { "type": "string", "maxLength": 100 },
    "slug": { "type": "string", "maxLength": 50 },
    "vertical_type": { "type": "string", "enum": ["laundry", "cafe"] },
    "company_id": { "type": "string", "format": "uuid" },
    "address": { "type": "string" },
    "city": { "type": "string", "default": "Phnom Penh" },
    "phone": { "type": "string" },
    "timezone": { "type": "string", "default": "Asia/Phnom_Penh" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["store_id", "tenant_id", "slug", "vertical_type"],
      "properties": {
        "store_id": { "type": "string", "format": "uuid" },
        "tenant_id": { "type": "string", "format": "uuid" },
        "slug": { "type": "string" },
        "vertical_type": { "type": "string" },
        "display_name": { "type": "string" },
        "created_at": { "type": "string", "format": "date-time" }
      }
    }
  }
}
```

**Error Codes:** `TENANT_NOT_FOUND`, `VALIDATION_ERROR` (duplicate slug within tenant)

**Tables Read:** `cp.tenants`, `fin.companies` (if company_id provided)  
**Tables Written:** `pos.stores` (§6.2.3)

---

#### `admin-register-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/admin-register-create` |
| **Auth Required** | Yes (service_role) |
| **Tenant Scoped** | Yes |

**Purpose:** Create a new POS register (terminal) for a store. Generates a `device_uuid` if not provided. The `register_type` determines which terminal hardware profile is used (T1-T5).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["store_id", "display_name", "register_type"],
  "properties": {
    "store_id": { "type": "string", "format": "uuid" },
    "display_name": { "type": "string", "maxLength": 100 },
    "register_type": { "type": "string", "enum": ["t1_cashier", "t2_cds", "t3_kds", "t4_dds", "t5_qds"] },
    "device_uuid": { "type": "string", "description": "Hardware identifier. Auto-generated if omitted." },
    "hardware_spec": {
      "type": "object",
      "description": "Hardware configuration",
      "properties": {
        "pi_model": { "type": "string" },
        "storage_gb": { "type": "integer" },
        "printer_model": { "type": ["string", "null"] },
        "screen_count": { "type": "integer" }
      }
    }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["register_id", "store_id", "register_type", "device_uuid"],
      "properties": {
        "register_id": { "type": "string", "format": "uuid" },
        "store_id": { "type": "string", "format": "uuid" },
        "register_type": { "type": "string" },
        "device_uuid": { "type": "string" },
        "display_name": { "type": "string" }
      }
    }
  }
}
```

**Error Codes:** `STORE_NOT_FOUND`, `VALIDATION_ERROR`

**Tables Read:** `pos.stores`  
**Tables Written:** `pos.registers` (§6.2.3)

---

#### `admin-menu-item-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/admin-menu-item-create` |
| **Auth Required** | Yes |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes |

**Purpose:** Create a new item in the menu catalog (`menu.items`). Available to owners and managers for self-service menu management. Admins can create items for any tenant.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["tenant_id", "display_name", "base_price_khr"],
  "properties": {
    "tenant_id": { "type": "string", "format": "uuid" },
    "store_id": { "type": ["string", "null"], "format": "uuid", "description": "NULL = available to all stores" },
    "category_id": { "type": ["string", "null"], "format": "uuid" },
    "recipe_id": { "type": ["string", "null"], "format": "uuid" },
    "sku": { "type": ["string", "null"], "maxLength": 50 },
    "display_name": { "type": "string", "maxLength": 100 },
    "display_name_km": { "type": ["string", "null"], "maxLength": 100 },
    "description": { "type": ["string", "null"], "maxLength": 500 },
    "description_km": { "type": ["string", "null"], "maxLength": 500 },
    "base_price_khr": { "type": "integer", "minimum": 0, "description": "Price in KHR integer" },
    "pricing_type": { "type": "string", "enum": ["fixed", "variable", "tiered"], "default": "fixed" },
    "applicable_verticals": { "type": "array", "items": { "type": "string" }, "default": ["cafe"] },
    "allow_modifiers": { "type": "boolean", "default": false },
    "modifier_group_ids": { "type": "array", "items": { "type": "string", "format": "uuid" }, "description": "Attach modifier groups if allow_modifiers=true" },
    "photo_url": { "type": ["string", "null"] },
    "sort_order": { "type": "integer", "default": 0 },
    "is_active": { "type": "boolean", "default": true },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["item_id", "display_name", "base_price_khr"],
      "properties": {
        "item_id": { "type": "string", "format": "uuid" },
        "display_name": { "type": "string" },
        "display_name_km": { "type": ["string", "null"] },
        "base_price_khr": { "type": "integer" },
        "modifier_groups_attached": { "type": "integer" }
      }
    }
  }
}
```

**Error Codes:** `TENANT_NOT_FOUND`, `VALIDATION_ERROR`, `IDEMPOTENCY_CONFLICT`

**Tables Read:** `cp.tenants`, `menu.categories`, `cafe.modifier_groups`  
**Tables Written:** `menu.items` (§6.2.5), `menu.item_modifier_groups` (if modifier_group_ids provided)

**KHR to USD Conversion:** The function converts `base_price_khr` to `numeric(18,4)` USD storage using the exchange rate stored in `tenants.metadata->>'exchange_rate_usd_khr'` (default: 4100). The derived `base_price_khr` column is stored directly as the integer input.

---

#### `admin-franchise-agreement-create`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/admin-franchise-agreement-create` |
| **Auth Required** | Yes (service_role OR brand `membership_role = 'owner'`) |
| **Tenant Scoped** | Yes (brand tenant) |
| **Idempotent** | Yes |

**Purpose:** Create a franchise agreement linking a brand tenant to a franchisee company (R-5, resolved v1.1.0). This is the chain-portal onboarding path for a new franchisee. The franchisee company must already exist (`fin.companies`).

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["brand_tenant_id", "franchisee_company_id", "billing_mode"],
  "properties": {
    "brand_tenant_id": { "type": "string", "format": "uuid" },
    "franchisee_company_id": { "type": "string", "format": "uuid" },
    "billing_mode": { "type": "string", "enum": ["brand_consolidated", "franchisee_direct"] },
    "royalty_pct": { "type": ["number", "null"], "minimum": 0, "maximum": 100 },
    "menu_push_rights": { "type": "string", "enum": ["full", "approve", "none"], "default": "approve" },
    "start_date": { "type": "string", "format": "date" },
    "end_date": { "type": ["string", "null"], "format": "date" },
    "idempotency_key": { "type": "string", "maxLength": 128 }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["agreement_id", "brand_tenant_id", "franchisee_company_id", "billing_mode"],
      "properties": {
        "agreement_id": { "type": "string", "format": "uuid" },
        "brand_tenant_id": { "type": "string", "format": "uuid" },
        "franchisee_company_id": { "type": "string", "format": "uuid" },
        "billing_mode": { "type": "string" },
        "menu_push_rights": { "type": "string" },
        "status": { "type": "string" }
      }
    }
  }
}
```

**Error Codes:** `TENANT_NOT_FOUND`, `COMPANY_NOT_FOUND`, `VALIDATION_ERROR` (duplicate brand↔franchisee pair, or `billing_mode = 'direct'` rejected — a franchise agreement is by definition non-direct), `FORBIDDEN`

**Tables Read:** `cp.tenants`, `fin.companies`
**Tables Written:** `cp.franchise_agreements` (§6.2.1)

**Idempotency:** If `idempotency_key` matches, returns the existing agreement. The `(brand_tenant_id, franchisee_company_id)` UNIQUE constraint also prevents duplicates.

**Side effect:** Setting the agreement may update `cp.tenants.billing_mode` for the franchisee's tenant context to match the agreement's mode (brand_consolidated / franchisee_direct), so the subscription payer derivation (below) resolves correctly.

---

#### `subscription-payer-resolve`

| Attribute | Value |
|---|---|
| **Route** | `POST /functions/v1/subscription-payer-resolve` |
| **Auth Required** | Yes (service_role) |
| **Tenant Scoped** | Yes |
| **Idempotent** | Yes (pure read/derivation) |

**Purpose:** Derive the subscription **payer** for a store's monthly invoice. Implements the locked rule "configurable per franchise agreement" (Part 8 §8.7, Part 5 §5.7.2). Called by the subscription-billing job before generating an invoice. There is **no hardcoded payer** anywhere.

**Request JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["store_id"],
  "properties": {
    "store_id": { "type": "string", "format": "uuid" }
  }
}
```

**Response JSONSchema:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["success", "data"],
  "properties": {
    "success": { "type": "boolean" },
    "data": {
      "type": "object",
      "required": ["payer_company_id", "billing_mode", "rationale"],
      "properties": {
        "payer_company_id": { "type": "string", "format": "uuid" },
        "billing_mode": { "type": "string", "enum": ["direct", "brand_consolidated", "franchisee_direct"] },
        "rationale": { "type": "string", "description": "which branch of the derivation fired" }
      }
    }
  }
}
```

**Derivation logic (the canonical rule):**
```
store → fin.companies (the operating company) → cp.tenants (brand)
if tenant.billing_mode == 'direct':
    payer_company_id = the operating company           # single-owner
elif agreement.billing_mode == 'brand_consolidated':
    payer_company_id = the brand company               # one bill for all franchise stores
elif agreement.billing_mode == 'franchisee_direct':
    payer_company_id = the franchisee company          # franchisee pays its own
```

**Error Codes:** `STORE_NOT_FOUND`, `AGREEMENT_NOT_FOUND` (billing_mode implies franchise but no agreement row)

**Tables Read:** `pos.stores`, `fin.companies`, `cp.tenants`, `cp.franchise_agreements`
**Tables Written:** none

---

### 7.14 Edge Function Summary Table

| # | Function Name | Route | Method | Auth | Idempotent | Tables Read | Tables Written |
|---|---|---|---|---|---|---|---|
| 1 | `auth-phone-otp-send` | `/auth-phone-otp-send` | POST | No | No | `cp.accounts` | — |
| 2 | `auth-phone-otp-verify` | `/auth-phone-otp-verify` | POST | No | No | `cp.accounts`, `cp.tenant_memberships`, `cp.tenants` | `cp.accounts`, `auth.users` |
| 3 | `auth-session-refresh` | `/auth-session-refresh` | POST | Yes | No | — | — |
| 4 | `pos-cart-create` | `/pos-cart-create` | POST | Yes | Yes | `pos.shifts`, `pos.sessions`, `pos.registers`, `cafe.tabs` | `pos.carts` |
| 5 | `pos-cart-add-line` | `/pos-cart-add-line` | POST | Yes | Yes | `pos.carts`, `menu.items`, `menu.item_modifier_groups`, `cafe.modifier_groups`, `cafe.modifiers` | `pos.cart_lines`, `pos.carts` |
| 6 | `pos-cart-update-line` | `/pos-cart-update-line` | POST | Yes | No | `pos.carts`, `pos.cart_lines`, `menu.items`, `cafe.modifiers` | `pos.cart_lines`, `pos.carts` |
| 7 | `pos-cart-remove-line` | `/pos-cart-remove-line` | POST | Yes | No | `pos.carts`, `pos.cart_lines` | `pos.cart_lines`, `pos.carts` |
| 8 | `pos-cart-apply-discount` | `/pos-cart-apply-discount` | POST | Yes | No | `pos.carts`, `pos.cart_lines`, `cp.tenant_memberships` | `pos.carts`, `pos.cart_lines` |
| 9 | `pos-cart-finalize` | `/pos-cart-finalize` | POST | Yes | Yes | `pos.carts`, `pos.cart_lines`, `pos.stores` | `pos.carts`, `ops.cafe_orders` |
| 10 | `pos-tender-create` | `/pos-tender-create` | POST | Yes | Yes | `pos.carts`, `pos.tenders` | `pos.tenders` |
| 11 | `pos-tender-attempt` | `/pos-tender-attempt` | POST | Yes | No | `pos.tenders`, `pos.carts` | `pos.tender_attempts`, `pos.tenders` |
| 12 | `pos-tender-retry` | `/pos-tender-retry` | POST | Yes | No | `pos.tenders`, `pos.tender_attempts` | `pos.tender_attempts`, `pos.tenders` |
| 13 | `pos-tender-refund` | `/pos-tender-refund` | POST | Yes | Yes | `pos.tenders`, `pos.tender_attempts` | `pos.tenders`, `pos.tender_attempts` |
| 14 | `pos-cafe-aba-khqr-generate` | `/pos-cafe-aba-khqr-generate` | POST | Yes | Yes | `pos.tenders`, `pos.stores` | `pos.tender_attempts` |
| 15 | `pos-cafe-aba-khqr-poll` | `/pos-cafe-aba-khqr-poll` | POST | Yes | No | `pos.tender_attempts` | `pos.tender_attempts`, `pos.tenders` |
| 16 | `pos-cafe-aba-card-tokenize` | `/pos-cafe-aba-card-tokenize` | POST | Yes | No | — | — |
| 17 | `pos-cafe-aba-card-charge` | `/pos-cafe-aba-card-charge` | POST | Yes | No | `pos.tenders` | `pos.tender_attempts`, `pos.tenders` |
| 18 | `pos-shift-open` | `/pos-shift-open` | POST | Yes | Yes | `pos.shifts`, `pos.registers` | `pos.shifts` |
| 19 | `pos-shift-close` | `/pos-shift-close` | POST | Yes | No | `pos.shifts`, `pos.carts`, `pos.tenders` | `pos.shifts` |
| 20 | `pos-shift-get-current` | `/pos-shift-get-current` | GET | Yes | No | `pos.shifts`, `pos.carts`, `cp.accounts` | — |
| 21 | `pos-session-login` | `/pos-session-login` | POST | Yes | Yes | `pos.shifts`, `pos.registers`, `cp.accounts`, `cp.tenant_memberships` | `pos.sessions` |
| 22 | `pos-session-logout` | `/pos-session-logout` | POST | Yes | No | `pos.sessions` | `pos.sessions` |
| 23 | `pos-session-heartbeat` | `/pos-session-heartbeat` | POST | Yes | No | `pos.sessions` | `pos.sessions` |
| 24 | `pos-offline-batch-submit` | `/pos-offline-batch-submit` | POST | Yes | Yes | `pos.offline_sync_batches`, all referenced tables | `pos.offline_sync_batches`, `pos.offline_sync_events` |
| 25 | `pos-offline-batch-sync` | `/pos-offline-batch-sync` | GET | Yes | No | `pos.offline_sync_batches` | — |
| 26 | `pos-offline-conflict-resolve` | `/pos-offline-conflict-resolve` | POST | Yes | No | `pos.offline_sync_batches`, `pos.offline_sync_events` | `pos.offline_sync_events`, target tables |
| 27 | `cafe-tab-create` | `/cafe-tab-create` | POST | Yes | Yes | `pos.stores`, `cafe.tabs` | `cafe.tabs` |
| 28 | `cafe-tab-close` | `/cafe-tab-close` | POST | Yes | No | `cafe.tabs`, `pos.carts` | `cafe.tabs` |
| 29 | `cafe-order-create` | `/cafe-order-create` | POST | Yes | Yes | `pos.carts`, `pos.cart_lines`, `pos.stores` | `ops.cafe_orders` |
| 30 | `cafe-order-update-status` | `/cafe-order-update-status` | POST | Yes | No | `ops.cafe_orders` | `ops.cafe_orders` |
| 31 | `cafe-order-assign-slot` | `/cafe-order-assign-slot` | POST | Yes | No | `ops.cafe_orders` | `ops.cafe_orders` |
| 32 | `cafe-recipe-deduct` | `/cafe-recipe-deduct` | POST | Yes | Yes | `ops.cafe_orders`, `pos.cart_lines`, `menu.items`, `cafe.recipes`, `cafe.recipe_ingredients`, `cafe.ingredients` | `cafe.ingredients` |
| 33 | `rotanak-profile-get` | `/rotanak-profile-get` | GET | Yes | No | — | — |
| 34 | `rotanak-coin-earn` | `/rotanak-coin-earn` | POST | Yes | Yes | `ops.cafe_orders` | `ops.cafe_orders` |
| 35 | `rotanak-coin-redeem` | `/rotanak-coin-redeem` | POST | Yes | Yes | `pos.carts`, `ops.cafe_orders` | `ops.cafe_orders` |
| 36 | `hsal-booking-create` | `/hsal-booking-create` | POST | Yes | Yes | `ops.cafe_orders`, `pos.carts` | — (metadata only) |
| 37 | `admin-tenant-create` | `/admin-tenant-create` | POST | Yes (service_role) | Yes | `cp.tenants` | `cp.tenants`, `cp.accounts`, `cp.tenant_memberships` |
| 38 | `admin-store-create` | `/admin-store-create` | POST | Yes (service_role) | Yes | `cp.tenants`, `fin.companies` | `pos.stores` |
| 39 | `admin-register-create` | `/admin-register-create` | POST | Yes (service_role) | No | `pos.stores` | `pos.registers` |
| 40 | `admin-menu-item-create` | `/admin-menu-item-create` | POST | Yes | Yes | `cp.tenants`, `menu.categories`, `cafe.modifier_groups` | `menu.items`, `menu.item_modifier_groups` |
| 41 | `admin-franchise-agreement-create` | `/admin-franchise-agreement-create` | POST | Yes (service_role / brand owner) | Yes | `cp.tenants`, `fin.companies` | `cp.franchise_agreements` |
| 42 | `subscription-payer-resolve` | `/subscription-payer-resolve` | POST | Yes (service_role) | Yes | `pos.stores`, `fin.companies`, `cp.tenants`, `cp.franchise_agreements` | — (derivation only) |

> **Total: 42 edge functions documented.**

### 7.15 Deployment Order

Edge functions **MUST** be deployed in this order, matching the migration sequence in Part 6, §6.5:

```bash
# 1. Auth functions (no schema dependencies)
supabase functions deploy auth-phone-otp-send
supabase functions deploy auth-phone-otp-verify
supabase functions deploy auth-session-refresh

# 2. Core POS functions (depend on pos.* schema)
supabase functions deploy pos-shift-open
supabase functions deploy pos-shift-close
supabase functions deploy pos-shift-get-current
supabase functions deploy pos-session-login
supabase functions deploy pos-session-logout
supabase functions deploy pos-session-heartbeat

# 3. Cart functions (depend on menu.* schema)
supabase functions deploy pos-cart-create
supabase functions deploy pos-cart-add-line
supabase functions deploy pos-cart-update-line
supabase functions deploy pos-cart-remove-line
supabase functions deploy pos-cart-apply-discount
supabase functions deploy pos-cart-finalize

# 4. Tender functions (depend on pos.carts)
supabase functions deploy pos-tender-create
supabase functions deploy pos-tender-attempt
supabase functions deploy pos-tender-retry
supabase functions deploy pos-tender-refund

# 5. Payment gateway functions
supabase functions deploy pos-cafe-aba-khqr-generate
supabase functions deploy pos-cafe-aba-khqr-poll
supabase functions deploy pos-cafe-aba-card-tokenize
supabase functions deploy pos-cafe-aba-card-charge

# 6. Offline sync functions
supabase functions deploy pos-offline-batch-submit
supabase functions deploy pos-offline-batch-sync
supabase functions deploy pos-offline-conflict-resolve

# 7. Cafe functions (depend on cafe.* schema)
supabase functions deploy cafe-tab-create
supabase functions deploy cafe-tab-close
supabase functions deploy cafe-order-create
supabase functions deploy cafe-order-update-status
supabase functions deploy cafe-order-assign-slot
supabase functions deploy cafe-recipe-deduct

# 8. Ecosystem integration functions
supabase functions deploy rotanak-profile-get
supabase functions deploy rotanak-coin-earn
supabase functions deploy rotanak-coin-redeem
supabase functions deploy hsal-booking-create

# 9. Admin functions (depend on all schema)
supabase functions deploy admin-tenant-create
supabase functions deploy admin-store-create
supabase functions deploy admin-register-create
supabase functions deploy admin-menu-item-create
supabase functions deploy admin-franchise-agreement-create
supabase functions deploy subscription-payer-resolve
```

---


---


## Part 8: Business Logic & Computation Rules

**Version:** v1.0.0  
**Authority:** Business Logic Agent (supreme on all computation)  
**Date:** 29 May 2026  
**Status:** Canonical — single source of truth for ALL computation

**Warning:** This part defines every calculation, rounding rule, and formula in the KitLuy system. No other part may redefine these rules. Other parts reference them by section number.

---

### 8.1 Money Model

#### 8.1.1 Principle

KitLuy uses a dual-layer money model to support Cambodia's USD-KHR operating reality. All monetary values are stored in USD with 4 decimal places and displayed to users as KHR integers.

#### 8.1.2 Storage Layer

| Aspect | Rule | Rationale |
|---|---|---|
| **Type** | `numeric(18,4)` | Exact precision. No float rounding errors. |
| **Primary currency** | USD | Cambodia's de facto reserve currency. Large transactions default to USD. |
| **Scale** | 4 decimal places | Sub-cent precision for internal calculations (e.g., 0.0025 USD = 10 KHR at 4000 rate). |
| **Range** | 999,999,999,999.9999 | Sufficient for any Cambodian SME's lifetime transactions. |

**Enforcement:**
- All monetary columns in the schema use `numeric(18,4)` (see `Part 6, §6.1.3`).
- No `money`, `decimal(10,2)`, `float`, or `double precision` types are permitted for monetary values.
- Café `_khr` derived columns use `bigint` (see `§8.1.5`).

#### 8.1.3 Display Layer

| Aspect | Rule | Example |
|---|---|---|
| **Display currency** | KHR (Cambodian Riel) only | Never display USD to end users in v1.0.0. |
| **Format** | Integer only, no decimals | `៛60,000` not `៛60,000.00` |
| **Grouping** | Thousands separator (Khmer or Arabic numerals per locale) | `៛1,250,000` |
| **Symbol** | `៛` (Riel sign) prefix | `៛60,000` |
| **No "KHR" text** | Symbol only | Not "60,000 KHR" |

#### 8.1.4 `formatKHR` — Definition and Implementation

`formatKHR` is the **single, canonical function** that converts a `numeric(18,4)` USD storage value to a KHR display integer. It is defined **once** in this section and referenced everywhere.

```
FUNCTION formatKHR(usd_amount numeric(18,4), exchange_rate numeric(18,4) DEFAULT 4000.0000)
RETURNS bigint

DESCRIPTION:
  Converts a USD storage amount to a KHR display integer.

PSEUDO-CODE:
  FUNCTION formatKHR(usd_amount, exchange_rate = 4000.0000):
    -- Step 1: Convert USD to KHR (may produce fractional KHR)
    khr_raw = usd_amount * exchange_rate

    -- Step 2: Round to nearest integer KHR
    -- Round half up: 0.5 → 1, 0.49 → 0
    khr_rounded = ROUND(khr_raw)  -- standard round-half-up

    -- Step 3: Return as bigint
    RETURN CAST(khr_rounded AS bigint)

EXAMPLES:
  formatKHR(15.0000)           → 60000       (15 * 4000 = 60000)
  formatKHR(2.5000)            → 10000       (2.5 * 4000 = 10000)
  formatKHR(0.3750)            → 1500        (0.375 * 4000 = 1500)
  formatKHR(0.0001)            → 0           (0.0001 * 4000 = 0.4 → round to 0)
  formatKHR(0.0013)            → 5           (0.0013 * 4000 = 5.2 → round to 5)
  formatKHR(100.5555)          → 402222      (100.5555 * 4000 = 402222)

EDGE CASES:
  - NULL input → NULL output
  - Negative input → negative output (for refunds)
  - Zero input → 0
```

**Enforcement at the storage→display boundary:**

| Layer | Requirement |
|---|---|
| Edge functions | Must call `formatKHR()` before returning monetary values to the client. |
| Client (Electron app) | Must call `formatKHR()` on all raw USD values from the API. |
| Reports | All KHR display values must pass through `formatKHR()`. |
| Receipts | All amounts printed on receipts use `formatKHR()` output. |

**Exchange rate:**
- Default: `4000.00 KHR per 1 USD` (Cambodian market rate, rounded for POS simplicity).
- Future: `fin.exchange_rates` table for dynamic rates. v1.0.0 uses hardcoded 4000.
- The exchange rate is **not stored per transaction** — it is a display-time conversion. Storage is always USD.

#### 8.1.5 Café `_khr` Columns — Derivation at Write Time

Café-specific `_khr` columns (e.g., `pos.carts.grand_total_khr`, `pos.cart_lines.unit_price_khr`, `menu.items.base_price_khr`) are derived using `formatKHR()` at write time:

```
-- On INSERT or UPDATE of a USD price column:
grand_total_khr = formatKHR(grand_total)
unit_price_khr  = formatKHR(unit_price)
upcharge_khr    = formatKHR(upcharge)

-- In PostgreSQL (trigger or edge function):
NEW.grand_total_khr := formatKHR(NEW.grand_total);
```

**Rationale for storing derived KHR:** Café operations require fast KHR display without runtime conversion. The KHR columns are **read-only mirrors** of the USD columns. They are recomputed whenever the USD value changes. They are **not** a separate source of truth.

**Consistency rule:** `formatKHR(usd_column)` must always equal the `_khr` column. A nightly consistency check validates this:
```sql
SELECT id FROM pos.carts 
WHERE formatKHR(grand_total) != grand_total_khr;
-- Expected: 0 rows
```

---

### 8.2 Price Calculation Pipeline

#### 8.2.1 Pipeline Overview

```
Base Price → Modifier Upcharges → Quantity Multiplication → Line Discount → Line Tax → Line Total
                                    ↓
                              Cart Subtotal → Cart Discount → Cart Tax → Tip → Grand Total
```

#### 8.2.2 Step-by-Step Formulas

All calculations use `numeric(18,4)` until the final `_khr` derivation.

**Step 1: Base Price**
```
base_price_usd = menu.items.base_price
```

**Step 2: Modifier Upcharges**
```
modifier_total_usd = SUM(cafe.modifiers.upcharge) FOR ALL selected modifiers
modifier_total_khr = SUM(cafe.modifiers.upcharge_khr) FOR ALL selected modifiers
```

**Step 3: Unit Price with Modifiers**
```
unit_price_usd = base_price_usd + modifier_total_usd
unit_price_khr = menu.items.base_price_khr + modifier_total_khr
```

**Step 4: Line Subtotal (before discount)**
```
line_subtotal_before_discount_usd = unit_price_usd * quantity
```

**Step 5: Line Discount**
```
-- For percentage discount:
line_discount_usd = ROUND(line_subtotal_before_discount_usd * discount_pct / 100, 4)

-- For fixed amount discount:
line_discount_usd = MIN(discount_fixed_amount, line_subtotal_before_discount_usd)

-- Cannot discount below zero:
line_discount_usd = MIN(line_discount_usd, line_subtotal_before_discount_usd)
```

**Step 6: Line Subtotal (after discount)**
```
line_subtotal_usd = line_subtotal_before_discount_usd - line_discount_usd
```

**Step 7: Line Tax**
```
-- Cambodia stub: tax rate from tax.seed_cambodia_stub
-- v1.0.0: tax rate = 0 (Cambodia does not charge VAT on café/laundry food services at street level)
line_tax_usd = ROUND(line_subtotal_usd * tax_rate, 4)

-- Tax is 0 in v1.0.0. The column exists for future tax engine activation.
```

**Step 8: Line Total**
```
line_total_usd = line_subtotal_usd + line_tax_usd
line_total_khr = formatKHR(line_total_usd)
```

**Step 9: Cart Subtotal**
```
cart_subtotal_usd = SUM(line_total_usd) FOR ALL non-voided cart_lines
```

**Step 10: Cart Discount**
```
-- Applied after line discounts (see §8.3 for conflict resolution)
cart_discount_usd = computed per discount rule (percentage or fixed)
cart_discount_usd = MIN(cart_discount_usd, cart_subtotal_usd)  -- cannot discount below zero
```

**Step 11: Cart Tax**
```
cart_tax_usd = SUM(line_tax_usd) FOR ALL lines
```

**Step 12: Tip**
```
tip_usd = tip_amount (entered by customer or cashier)
```

**Step 13: Grand Total**
```
grand_total_usd = cart_subtotal_usd - cart_discount_usd + cart_tax_usd + tip_usd
grand_total_khr = formatKHR(grand_total_usd)

-- Guard: grand_total_usd >= 0
IF grand_total_usd < 0:
  grand_total_usd = 0
  grand_total_khr = 0
```

#### 8.2.3 Rounding Rule — Locked

**Rounding is applied at each step, not once at the end.** This prevents cumulative rounding errors.

| Step | Rounding | Precision |
|---|---|---|
| Modifier upcharge sum | Round to 4 decimal places | `numeric(18,4)` |
| Line discount | Round to 4 decimal places | `numeric(18,4)` |
| Line tax | Round to 4 decimal places | `numeric(18,4)` |
| Line total | Round to 4 decimal places | `numeric(18,4)` |
| Cart subtotal | Round to 4 decimal places | `numeric(18,4)` |
| Grand total | Round to 4 decimal places, then derive KHR | `numeric(18,4)` → `bigint` |

**Why round at each step:** Cambodia POS operates with KHR integer display. Rounding at each step ensures that `formatKHR(line_total_usd)` always equals `line_total_khr`, and the sum of `line_total_khr` values equals `grand_total_khr` (within 1 KHR tolerance for rounding).

#### 8.2.4 Split Tender — Remainder Distribution

When a cart has `grand_total = G` and multiple tender types:

```
-- Split tender remainder handling:
1. For each tender in creation order (except last):
   tender_amount = specified_amount
   remaining = remaining - tender_amount

2. For the LAST tender:
   last_tender_amount = remaining  -- absorbs all rounding remainder

3. Validation: SUM(all tender amounts) MUST equal G (within epsilon 0.0001)

4. If cash is the last tender and customer overpays:
   tender_amount = amount_given_by_customer
   change_due = amount_given - remaining

5. Change due is always returned in cash, regardless of tender types used.
```

**Example:**
```
Grand total: ៛25,000 (USD 6.2500)
Split: KHQR ៛20,000 + Cash remainder

Tender 1 (KHQR): amount = 5.0000 USD (KHR 20,000)
Tender 2 (Cash):  amount = 1.2500 USD (KHR 5,000)
Change due: 0

If customer gives ៛10,000 cash for the remainder:
Tender 2 (Cash): amount_given = 2.5000 USD (KHR 10,000)
Change due: ៛5,000 (1.2500 USD)
```

---

### 8.3 Discount Rules

#### 8.3.1 Discount Types

| Type | Description | Formula | Example |
|---|---|---|---|
| **Percentage** | Deducts X% from subtotal | `discount = subtotal * pct / 100` | 10% off ៛50,000 → ៛5,000 off |
| **Fixed Amount** | Deducts flat amount | `discount = MIN(fixed_amount, subtotal)` | ៛10,000 off any order |
| **Buy-X-Get-Y** | Buy N items, get 1 free | `discount = lowest_priced_qualified_item` | Buy 3 coffees, 4th free |

#### 8.3.2 Application Scope

| Scope | Application | Conflict Rule |
|---|---|---|
| **Item-level** | Applied to a single `pos.cart_lines` row. Stored in `line_discount`. | Multiple item discounts on the same line: use the largest discount (most favorable to customer). |
| **Cart-level** | Applied to `cart.discount_total`. Deducts from `cart_subtotal`. | Only one cart-level discount per cart. If multiple cart discounts are applicable, cashier must choose. |

#### 8.3.3 Application Order

Discounts are applied in this strict order:

```
Step 1: Item-level discounts (on each line)
Step 2: Cart-level discount (on cart subtotal after item discounts)
```

**Rationale:** Item discounts are specific (e.g., "coffee 50% off today"). Cart discounts are general (e.g., "10% off entire order"). Applying item discounts first ensures specific promotions are honored before general ones.

#### 8.3.4 Multiple Discount Conflict Resolution

| Scenario | Rule |
|---|---|
| Two item discounts apply to the same line | Use the **larger** discount (most favorable to customer). |
| Item discount + cart discount both apply | Item discount applies first. Cart discount applies to the already-reduced subtotal. |
| Two cart discounts are applicable | Cashier must select one. System does not auto-stack cart discounts. |
| Buy-X-Get-Y + percentage on same item | Buy-X-Get-Y takes priority. Percentage applies to paid items only. |
| Discount would make total < 0 | Cap discount at subtotal. Total cannot be negative. |

#### 8.3.5 Discount Validation

```
Edge function: discount-validate

INPUT: cart_id, discount_code (or discount_id)
OUTPUT: { valid: bool, discount_amount_usd, discount_amount_khr, reason }

VALIDATION RULES:
  1. Discount is active (not expired, not disabled)
  2. Discount applies to this store's vertical_type
  3. Cart meets minimum order requirement (if any)
  4. Discount has not exceeded usage limit (if any)
  5. Customer is eligible (if loyalty-tier restricted)
  6. Discount can be combined with existing discounts (§8.3.4)
```

---

### 8.4 Tax

#### 8.4.1 Cambodia Tax Stub

v1.0.0 includes a single tax configuration row: `tax.seed_cambodia_stub`.

| Attribute | Value | Notes |
|---|---|---|
| Country | Cambodia (`KH`) | |
| Tax name | VAT | Value Added Tax |
| Rate | 0% | Street-level food/beverage services are VAT-exempt in Cambodia for small operators |
| Registration threshold | Not applicable | Below VAT registration threshold |
| Effective date | 2026-01-01 | |

#### 8.4.2 Tax Integration into Price Pipeline

```
-- Tax is computed at the line level (§8.2.2 Step 7):
line_tax_usd = ROUND(line_subtotal_usd * tax_rate, 4)

-- With tax_rate = 0 (v1.0.0):
line_tax_usd = 0 for all lines
cart_tax_usd = 0 for all carts

-- Future (when tax engine activates):
-- tax_rate will be fetched from tax configuration per store
-- line_tax_usd will be computed with the actual rate
-- All existing formulas in §8.2 continue to work (they already include tax)
```

#### 8.4.3 Tax Display on Receipts

Even with 0% rate, receipts must show a tax line for compliance:

```
Subtotal:     ៛50,000
Discount:     - ៛5,000
Tax (0%):     + ៛0
Tip:          + ៛2,000
-------------------
Total:        ៛47,000
```

---

### 8.5 Rotanak Integration Math

#### 8.5.1 Principle

KitLuy is a **consumer** of Rotanak. It reads loyalty data and calls earn/redeem APIs. It never writes loyalty rules. All calculations below are performed by KitLuy edge functions using Rotanak API responses.

#### 8.5.2 Earn — Order Completion

```
TRIGGER: ops.cafe_orders.order_status = 'served' (walk_in orders only)

FUNCTION compute_rotanak_earn(grand_total_khr, customer_tier):
  -- Earn rate by tier:
  tier_rates = {
    'bronze':  1,  -- 1% of order total
    'silver':  2,  -- 2% of order total
    'gold':    3   -- 3% of order total
  }

  rate = tier_rates[customer_tier]  -- percentage
  coins_earned = FLOOR(grand_total_khr * rate / 100)

  RETURN coins_earned

EXAMPLES:
  Bronze, ៛60,000 order  → FLOOR(60000 * 1 / 100) = 600 coins
  Silver, ៛45,000 order  → FLOOR(45000 * 2 / 100) = 900 coins
  Gold,   ៛100,000 order → FLOOR(100000 * 3 / 100) = 3000 coins

FUNDING: Merchant-funded. Rotanak tracks liability; KitLuy reports the earn event.
```

**Earn idempotency:**
```
-- Check before firing:
IF ops.cafe_orders.rotanak_coins_earned > 0:
  RETURN existing value  -- already earned, do not call API again

-- After successful API call:
UPDATE ops.cafe_orders SET rotanak_coins_earned = {result}
```

#### 8.5.3 Redeem — Sleung Coin Payment

```
TRIGGER: During tender creation, customer opts to redeem Sleung Coins

FUNCTION compute_rotanak_redeem(coins_available, order_total_khr):
  -- Step 1: Compute maximum allowed redeem (30% cap)
  max_redeem_khr = FLOOR(order_total_khr * 30 / 100)

  -- Step 2: Compute value of available coins
  -- 1 Sleung Coin = 1 KHR (1:1 for redemption)
  coin_value_khr = coins_available  -- 1 coin = 1 KHR

  -- Step 3: Actual redeem is the lesser of available and max allowed
  actual_redeem_khr = MIN(coin_value_khr, max_redeem_khr)
  actual_coins_used = actual_redeem_khr  -- 1:1 ratio

  -- Step 4: Convert to USD for tender
  redeem_usd = actual_redeem_khr / 4000  -- display conversion

  RETURN {
    coins_used: actual_coins_used,
    redeem_value_khr: actual_redeem_khr,
    redeem_value_usd: redeem_usd
  }

EXAMPLES:
  Order: ៛60,000, Customer has 25,000 coins
  max_redeem_khr = FLOOR(60000 * 30 / 100) = 18000
  actual_redeem  = MIN(25000, 18000) = 18000
  coins_used     = 18000
  remaining_pay  = ៛42,000 (paid by cash/card/KHQR)

  Order: ៛60,000, Customer has 10,000 coins
  max_redeem_khr = 18000
  actual_redeem  = MIN(10000, 18000) = 10000
  coins_used     = 10000
  remaining_pay  = ៛50,000
```

#### 8.5.4 Redeem — Dual Enforcement (Preview + Commit)

The 30% cap is enforced **twice** to prevent race conditions:

```
PREVIEW (customer sees before confirming):
  CALL rotanak-redeem-preview(coins_available, order_total_khr)
  Rotanak returns: { allowed: bool, coins_to_use, value_khr, value_usd }
  IF not allowed → show error to customer
  IF value_khr > FLOOR(order_total_khr * 30 / 100) → reject (client-side guard)

COMMIT (actual payment):
  CALL rotanak-coin-redeem(coins_to_use, order_total_khr)
  Rotanak re-validates on server side
  IF value_khr > FLOOR(order_total_khr * 30 / 100) → reject (server-side guard)

  -- After commit:
  INSERT pos.tenders (
    tender_type = 'sleung_coin',
    amount = redeem_value_usd,
    amount_khr = redeem_value_khr,
    sleung_coins_used = coins_to_use,
    tender_status = 'captured'
  )
```

#### 8.5.5 Sleung Coin Value Reference

| Context | Value | Notes |
|---|---|---|
| 1 Sleung Coin (earn) | 1 KHR | Customer earns coins worth 1–3% of order |
| 1 Sleung Coin (redeem) | 1 KHR | Customer redeems coins at 1:1 KHR value |
| Redeem cap | 30% of order total | Enforced at preview AND commit |
| Earn rate | 1% (bronze), 2% (silver), 3% (gold) | By Rotanak tier |
| Funding | Merchant-funded | Rotanak tracks; KitLuy reports |


---


---


## Part 9: Design System

**Version:** v1.0.0  
**Authority:** Implementation Agent  
**Date:** 29 May 2026  
**Status:** Canonical  
**Cross-references:** Part 8 (`formatKHR`), Part 10 (RBAC), Part 6 (schema), Master Context §8 (Hardware), §9 (Output Format), §10 (Wireframe Constraints)

---

### 9.1 Visual Language

#### 9.1.1 Brand Colors

KitLuy uses a Khmer-inspired color palette optimized for high-ambient-light retail environments and low-cost LCD panels on Raspberry Pi terminals.

| Token | Hex | Usage | WCAG Contrast |
|---|---|---|---|
| `--color-primary` | `#1B6DD8` | Primary actions, buttons, links, active states | AAA on white |
| `--color-primary-dark` | `#1454A8` | Primary hover, pressed states | AAA on white |
| `--color-primary-light` | `#E8F1FB` | Primary backgrounds, selected rows | AAA with primary |
| `--color-secondary` | `#4A5568` | Secondary text, borders, dividers | AA on white |
| `--color-secondary-light` | `#EDF2F7` | Secondary backgrounds, zebra striping | AAA with secondary |
| `--color-rotanak-gold` | `#F5A623` | Rotanak loyalty banner, coin icons, earn badges | AA on white |
| `--color-success` | `#38A169` | Success states, paid orders, online indicator | AA on white |
| `--color-success-bg` | `#F0FFF4` | Success background tint | — |
| `--color-warning` | `#D69E2E` | Warnings, pending states, low stock | AA on white |
| `--color-warning-bg` | `#FFFFF0` | Warning background tint | — |
| `--color-error` | `#E53E3E` | Errors, voided items, failed payments | AA on white |
| `--color-error-bg` | `#FFF5F5` | Error background tint | — |
| `--color-info` | `#3182CE` | Information, neutral notices | AA on white |
| `--color-info-bg` | `#EBF8FF` | Info background tint | — |
| `--color-background` | `#F7FAFC` | App/page background | — |
| `--color-surface` | `#FFFFFF` | Cards, panels, modals | — |
| `--color-text-primary` | `#1A202C` | Primary text, headings | AAA on surface |
| `--color-text-secondary` | `#4A5568` | Secondary text, captions | AA on surface |
| `--color-text-muted` | `#A0AEC0` | Placeholder, disabled text | AA on surface |
| `--color-border` | `#E2E8F0` | Default borders, dividers | — |
| `--color-border-focus` | `#1B6DD8` | Focus ring | — |
| `--color-khqr-blue` | `#004B8D` | ABA KHQR branding on payment screens | AA on white |

> **Why these colors?** Cambodia retail environments are bright (fluorescent or open-air). High contrast ratios ensure readability. The blue primary evokes trust and professionalism. Rotanak gold `#F5A623` is the ecosystem loyalty brand color. Additional ecosystem colors (e.g., Netra purple) are reserved for future vertical integrations.

#### 9.1.2 Typography — Khmer-First

KitLuy is Khmer-first. All UI text defaults to Khmer with English fallback.

| Token | Value | Usage |
|---|---|---|
| `--font-khmer` | `"Noto Sans Khmer", "Khmer OS", "Khmer OS System", "Khmer Sangam MN", sans-serif` | All Khmer text, primary font stack |
| `--font-latin` | `"Inter", "Helvetica Neue", Arial, sans-serif` | English/numbers/monospace needs |
| `--font-mono` | `"Roboto Mono", "Courier New", monospace` | Receipts, order numbers, codes |
| `--font-base` | `var(--font-khmer), var(--font-latin)` | Default body text |

**Type Scale (T1 Cashier — 15.6" LCD at 1366x768):**

| Token | Size | Weight | Line Height | Usage |
|---|---|---|---|---|
| `--text-xs` | `12px` | 400 | 1.4 | Labels, captions, timestamps |
| `--text-sm` | `14px` | 400 | 1.4 | Secondary text, form inputs |
| `--text-base` | `16px` | 400 | 1.5 | Body text, cart lines |
| `--text-lg` | `18px` | 500 | 1.4 | Section headings, menu category names |
| `--text-xl` | `22px` | 600 | 1.3 | Card titles, dialog headings |
| `--text-2xl` | `28px` | 700 | 1.2 | Grand total, primary call-to-action |
| `--text-3xl` | `36px` | 700 | 1.1 | Receipt total, shift report header |
| `--text-4xl` | `48px` | 800 | 1.0 | T2 CDS large display, T5 queue numbers |
| `--text-5xl` | `72px` | 900 | 1.0 | T5 primary queue display |

> **Khmer rendering note:** Khmer script has complex subscript stacking. The `--text-xs` minimum of 12px is a hard floor — Khmer text below 12px becomes unreadable on low-DPI screens. For T3 KDS and T4 DDS terminals, use `--text-lg` minimum for all text.

#### 9.1.3 Spacing Scale

| Token | Value | Usage |
|---|---|---|
| `--space-1` | `4px` | Tight internal padding, icon gaps |
| `--space-2` | `8px` | Button padding Y, small gaps |
| `--space-3` | `12px` | Card internal padding |
| `--space-4` | `16px` | Section padding, form field gaps |
| `--space-5` | `20px` | Panel padding |
| `--space-6` | `24px` | Dialog padding |
| `--space-8` | `32px` | Page padding, large gaps |
| `--space-10` | `40px` | Modal padding |
| `--space-12` | `48px` | Large section separators |
| `--space-16` | `64px` | Major section breaks |

#### 9.1.4 Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-sm` | `4px` | Small buttons, badges, inputs |
| `--radius-md` | `8px` | Cards, panels, modals |
| `--radius-lg` | `12px` | Large cards, dialogs |
| `--radius-xl` | `16px` | Feature panels, onboarding |
| `--radius-full` | `9999px` | Pills, status badges, avatars |

#### 9.1.5 Shadows

| Token | Value | Usage |
|---|---|---|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle elevation, selected items |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.05)` | Cards, floating panels |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)` | Modals, dialogs |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)` | Full-screen overlays |
| `--shadow-focus` | `0 0 0 3px rgba(27,109,216,0.3)` | Keyboard focus rings |

---

### 9.2 Wireframe Renderer Constraints (CRITICAL)

The wireframe renderer runs on Raspberry Pi 5 4GB hardware (T1 Cashier, T3 KDS, T4 DDS, T5 QDS). The Pi 5 4GB has limited resources: 4GB RAM shared between GPU and CPU, microSD storage (slow I/O), and a single-core compilation bottleneck for JavaScript bundle parsing. These constraints are non-negotiable and drive the following coding rules.

#### 9.2.1 Constraint Rules

| # | Rule | Rationale | Violation Consequence |
|---|---|---|---|
| 1 | **No optional chaining (`?.`)** | Transpilation of `?.` creates helper functions that bloat bundle size on Babel/TypeScript targets below ES2020. The Pi 5 parser is slow with helper-heavy bundles. | Use explicit null checks: `if (obj && obj.prop && obj.prop.value)` |
| 2 | **No `const [x, setX] = useState()`** | Array destructuring in JSX is not supported by the wireframe renderer's Buble transform (used for live preview). It crashes with a syntax error. | Use: `var s = useState(); var x = s[0]; var setX = s[1];` |
| 3 | **Define `var` components before `ROUTES`** | The wireframe renderer evaluates code top-to-bottom. Component definitions must precede any reference in `ROUTES` to avoid `ReferenceError`. | Always declare components in file order before the routes object |
| 4 | **JSX attribute concatenation needs braces** | String concatenation in JSX attributes without braces fails the Buble parser: `href="/store/" + storeId` is invalid. | Use: `href={"/store/" + storeId}` or `href={\`/store/\${storeId}\`}` |
| 5 | **Keep files under ~270KB** | The Pi 5's V8 engine struggles with parsing large JS files. 270KB gzipped is the empirical threshold for <2s parse time on ARM64. | Split into multiple route files; lazy-load below-the-fold components |
| 6 | **No arrow functions in JSX event handlers** | Inline arrow functions create new references on every render, breaking `PureComponent` / `React.memo` optimizations critical on low-CPU hardware. | Define handler methods on the component: `handleClick = function() { ... }` |
| 7 | **Prefer `var` over `let`/`const`** | The renderer target environment supports ES5 broadly. `var` hoisting matches the renderer's expectations. | Use `var` for all variable declarations |
| 8 | **No template literals in JSX** | Template literals with expressions are not fully supported by the Buble transform. | Use string concatenation with braces: `{"Hello " + name}` |
| 9 | **No spread operator in JSX props** | `{...props}` spread is not supported by the Buble JSX transform. | Pass props explicitly: `propA={props.propA} propB={props.propB}` |
| 10 | **No default parameters** | `function(a = 1)` is not supported. | Use: `function(a) { a = a || 1; ... }` |

#### 9.2.2 Example: Wireframe-Compliant Component

```jsx
// CORRECT — wireframe renderer compliant
var CartPanel = function(props) {
  var s = useState(0);
  var itemCount = s[0];
  var setItemCount = s[1];

  var handleAddItem = function() {
    setItemCount(itemCount + 1);
  };

  return (
    <div className="cart-panel" style={{background: "#FFFFFF"}}>
      <h2 style={{fontSize: "22px", fontWeight: 600}}>
        {"Cart (" + itemCount + " items)"}
      </h2>
      <button onClick={handleAddItem} style={{padding: "8px 16px"}}>
        {"Add Item"}
      </button>
    </div>
  );
};

// INCORRECT — violates wireframe constraints
const CartPanel = (props) => {
  const [itemCount, setItemCount] = useState(0);

  return (
    <div className="cart-panel">
      <h2>Cart ({itemCount} items)</h2>
      <button onClick={() => setItemCount(itemCount + 1)}>Add Item</button>
    </div>
  );
};
```

#### 9.2.3 Why These Constraints Exist

The target hardware for the wireframe renderer (and production T1-T5 terminals) is a **Raspberry Pi 5 4GB with microSD storage**:

| Resource | Spec | Impact on Code |
|---|---|---|
| **CPU** | 4x Cortex-A76 @ 2.4GHz | Fast for ARM, but single-threaded JS parsing is a bottleneck |
| **RAM** | 4GB shared GPU/CPU | Large JS bundles consume heap; 270KB limit keeps parse+compile <200MB |
| **Storage** | microSD U1 (up to 100MB/s read) | Random I/O is poor; code splitting avoids loading unused modules |
| **GPU** | VideoCore VII | Handles CSS compositing well; keep animations to `transform`/`opacity` only |
| **Display** | 15.6" LCD 1366x768 (T1) or 7-10" (T3-T5) | Khmer text must be large enough for low-DPI screens |

> **Performance budget:** First contentful paint <2s on Pi 5 4GB. Time-to-interactive <3s. Bundle parse+compile <500ms. These are hard targets for merchant acceptance.

---

### 9.3 Component Library

All components are written in JSX, wireframe-renderer compliant per §9.2. All monetary displays use `formatKHR` from Part 8. All permission checks use the RBAC matrix from Part 10.

#### 9.3.1 Shared Components

| Component | Props | Description |
|---|---|---|
| `KHRDisplay` | `amount: number, className?: string, showSymbol?: boolean` | Displays `៛60,000` via `formatKHR`. Always integer KHR. `showSymbol` defaults to `true`. |
| `OfflineIndicator` | `isOnline: boolean, lastSyncAt?: string` | Small badge: green dot when online, amber when syncing, red when offline >5min. Shows relative time of last successful sync. |
| `SyncStatus` | `status: 'idle' \| 'syncing' \| 'error' \| 'conflict', batchCount?: number` | Detailed sync status for Hub Server. Shows pending batch count, conflict warnings. |
| `LoyaltyBanner` | `tier: string, coinBalance: number, earnRate: number` | Gold `#F5A623` banner for Rotanak. Shows tier name in Khmer, coin balance, earn rate. |
| `LoadingSpinner` | `size?: 'sm' \| 'md' \| 'lg'` | CSS-only spinner (no JS animation). Uses CSS `@keyframes` for rotation. |
| `ErrorBoundary` | `fallback: JSX.Element` | Catches render errors, shows fallback UI. Logs to `console.error`. |

**KHRDisplay Implementation:**
```jsx
var KHRDisplay = function(props) {
  var amount = props.amount || 0;
  var className = props.className || "";
  var showSymbol = props.showSymbol !== false;

  // Use formatKHR from Part 8 (imported utility)
  var formatted = formatKHR(amount);
  var display = showSymbol ? formatted : formatted.replace("៛", "").trim();

  return (
    <span className={"khr-display " + className} style={{fontVariantNumeric: "tabular-nums"}}>
      {display}
    </span>
  );
};
```

#### 9.3.2 POS Components (T1 Cashier)

| Component | Props | Description |
|---|---|---|
| `CartPanel` | `cart: Cart, onAddLine: fn, onUpdateLine: fn, onRemoveLine: fn, onApplyDiscount: fn, onFinalize: fn` | Main cart display. Shows line items with Khmer names, quantities, modifier summaries, line totals. Sticky bottom bar shows grand total KHR. |
| `TenderModal` | `cartTotalKhr: number, onTender: fn, onClose: fn` | Payment method selection modal. Shows: cash input field, KHQR button (triggers `pos-cafe-aba-khqr-generate`), card button (triggers `pos-cafe-aba-card-tokenize`), Sleung Coin redeem section (calls `rotanak-coin-redeem` preview). Split tender support. |
| `ReceiptPreview` | `invoice: Invoice, onPrint: fn, onEmail?: fn` | Pre-print receipt preview. 80mm thermal format simulation. Itemized lines, subtotals, tender breakdown, QR code area. |
| `ShiftReport` | `shift: Shift, onClose: fn` | Z-report display. Opening float, expected float, closing float (input), discrepancy calculation. Sales by tender type. Transaction count. |
| `MenuGrid` | `categories: Category[], items: Item[], onSelectItem: fn, activeCategory?: string` | Category tabs + item grid. Photos where available. Shows price via `KHRDisplay`. Grayed out if `is_available=false`. |
| `ModifierModal` | `item: Item, modifierGroups: ModifierGroup[], onConfirm: fn, onCancel: fn` | Modifier selection overlay. Enforces `pick_one`/`pick_many`, `is_required` constraints. Shows upcharge KHR per modifier. |
| `OrderStatusBar` | `cafeOrder: CafeOrder` | Small status badge: new/confirmed/preparing/ready/served. Color-coded per status. |

#### 9.3.3 Cafe Components (T3 KDS, T4 DDS)

| Component | Props | Description |
|---|---|---|
| `KDSOrderCard` | `order: CafeOrder, onStatusAdvance: fn, onCancel: fn` | Large touch-friendly card for T3 KDS. Shows order number, item list with modifiers, special instructions, elapsed time. Color border indicates age: green (<5min), yellow (5-10min), red (>10min). |
| `SlotDisplay` | `slots: Slot[], onAssign: fn, onClear: fn` | T4 DDS slot grid. Shows numbered slots (1-N) with order details. Empty slots are gray; occupied slots show customer name, order summary, elapsed time since ready. |
| `PackingListView` | `orders: CafeOrder[], onComplete: fn` | T4 expediter packing list. Checklist format: item, modifiers, `n/total` count, QR code placeholder. |
| `TabBar` | `tabs: Tab[], onSelectTab: fn, onNewTab: fn, onCloseTab: fn` | Horizontal scrollable tab bar. Shows tab number, customer name, balance due KHR. Open tabs highlighted; closed tabs grayed. |
| `CupStickerPreview` | `line: CartLine, current: number, total: number` | Cup sticker layout preview. Item name (Khmer), modifier list, `n/total` numbering, order QR code. |
| `KitchenTimer` | `startedAt: string, warningThreshold?: number, criticalThreshold?: number` | Elapsed time display. Green -> yellow -> red based on thresholds. Updates every second via `setInterval`. |

#### 9.3.4 Admin Components (Admin Portal)

| Component | Props | Description |
|---|---|---|
| `TenantList` | `tenants: Tenant[], onSelect: fn, onCreate: fn` | Table of tenants with subscription tier, store count, status. Sortable by name/tier. |
| `StoreConfig` | `store: Store, onSave: fn` | Store settings form: display name, vertical type (disabled), address, timezone, register list. |
| `RegisterPairing` | `registers: Register[], onPair: fn, onUnpair: fn` | QR code display for register pairing. Shows paired/unpaired status, last heartbeat, hardware spec. |
| `MenuItemEditor` | `item?: Item, categories: Category[], modifierGroups: ModifierGroup[], onSave: fn` | Full item editing form: name (Khmer + English), photo upload, price (KHR input, auto-converts to USD storage), modifier group attachment, availability toggle. |
| `IngredientEditor` | `ingredient?: Ingredient, onSave: fn, onDelete: fn` | Ingredient form: name (Khmer + English), SKU, unit of measure, current stock, threshold, reorder point, unit cost. |
| `RecipeBuilder` | `recipe: Recipe, ingredients: Ingredient[], onSave: fn` | Visual recipe builder: drag ingredients, set quantities, set wastage %. Shows derived cost per serving. |

#### 9.3.5 Component Implementation Patterns

**State Management Pattern (Wireframe Compliant):**
```jsx
// CartPanel — wireframe compliant implementation
var CartPanel = function(props) {
  var cart = props.cart;
  var onAddLine = props.onAddLine;
  var onUpdateLine = props.onUpdateLine;
  var onRemoveLine = props.onRemoveLine;
  var onFinalize = props.onFinalize;

  var s1 = useState(false);
  var showVoidConfirm = s1[0];
  var setShowVoidConfirm = s1[1];

  var s2 = useState(null);
  var selectedLineId = s2[0];
  var setSelectedLineId = s2[1];

  var handleLineSelect = function(lineId) {
    setSelectedLineId(lineId);
  };

  var handleVoid = function() {
    if (selectedLineId) {
      onRemoveLine(selectedLineId, "Customer request");
      setShowVoidConfirm(false);
      setSelectedLineId(null);
    }
  };

  // Render cart lines
  var lines = cart.lines || [];
  var lineElements = lines.map(function(line) {
    var isSelected = line.id === selectedLineId;
    var lineClass = "cart-line" + (isSelected ? " cart-line--selected" : "");
    return (
      <div className={lineClass} key={line.id} onClick={function() { handleLineSelect(line.id); }}>
        <div className="cart-line__name">
          {line.display_name_km || line.display_name}
        </div>
        <div className="cart-line__qty">
          {"x" + line.quantity}
        </div>
        <div className="cart-line__total">
          <KHRDisplay amount={line.line_total_khr} />
        </div>
      </div>
    );
  });

  return (
    <div className="cart-panel" style={{display: "flex", flexDirection: "column", height: "100%"}}>
      <div className="cart-panel__header" style={{padding: "16px", borderBottom: "1px solid #E2E8F0"}}>
        <h2 style={{fontSize: "22px", fontWeight: 600, margin: 0}}>
          {"កន្ត្រកទំនិញ (" + lines.length + " items)"}
        </h2>
      </div>
      <div className="cart-panel__lines" style={{flex: 1, overflowY: "auto", padding: "12px"}}>
        {lineElements}
      </div>
      <div className="cart-panel__footer" style={{padding: "16px", borderTop: "2px solid #1B6DD8", background: "#FFFFFF"}}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "center"}}>
          <span style={{fontSize: "18px", fontWeight: 500}}>
            {"សរុប (Total)"}
          </span>
          <span style={{fontSize: "36px", fontWeight: 700, color: "#1B6DD8"}}>
            <KHRDisplay amount={cart.grand_total_khr} />
          </span>
        </div>
        <button
          className="btn btn--primary"
          style={{width: "100%", marginTop: "12px", padding: "16px", fontSize: "22px", fontWeight: 700}}
          onClick={onFinalize}
          disabled={lines.length === 0}
        >
          {"បញ្ជាទិញ (Place Order)"}
        </button>
      </div>
    </div>
  );
};
```

---

### 9.4 Responsive Behavior — Terminal Profiles

KitLuy runs on five terminal types (T1-T5), each with distinct hardware, interaction model, and viewport constraints. The design system provides per-terminal layouts, not generic breakpoints.

#### 9.4.1 Terminal Specifications

| Terminal | Hardware | Viewport | Interaction | Primary Font Size | Design Priority |
|---|---|---|---|---|---|
| **T1 (Cashier)** | Pi 5 4GB + 15.6" LCD 1366x768 | 1366x768 | Mouse + keyboard + touchscreen | `--text-base` (16px) | Speed, information density, error prevention |
| **T2 (CDS)** | HDMI-2 output of T1 (mirrored or extended) | 1920x1080 | None (customer facing) | `--text-2xl` (28px) minimum | Clarity, trust, large readable totals |
| **T3 (KDS)** | Pi 5 4GB + 10"-15" LCD per prep station | 1024x768 to 1280x800 | Touch only (chef hands) | `--text-lg` (18px) minimum | Touch targets 48px+, high contrast, timer visibility |
| **T4 (DDS)** | Pi 5 4GB + 10" LCD + 80mm printer | 1024x768 | Touch + barcode scan | `--text-lg` (18px) minimum | Slot assignment speed, packing checklist |
| **T5 (QDS)** | Pi 5 4GB + 15.6" LCD | 1366x768 | None (read-only display) | `--text-4xl` (48px) | Maximum visibility from 2+ meters |

#### 9.4.2 T1 Cashier Layout

```
+--------------------------------------------------+ 1366px
| [Header: Store Name        Shift #42   Offline]  | 48px
+----------+---------------------------------------+
|          | [Cart Panel                    ]      |
| Category | [Line 1: កាហ្វេត្រជាក់    x1  ៛8,000] |
| Tabs     | [Line 2: បាយឆាសាច់គោ    x1  ៛18,000] |
|          |                                      |
| [Food]   | [Modifier Summary: +Extra Shot]      |
| [Drinks] |                                      |
| [Dessert]|---------------------------------------|
|          | TOTAL:              ៛26,000           |
| [Item A] | [Cash] [KHQR] [Card] [Sleung Coin]  |
| [Item B] |                                      |
| [Item C] | [Place Order]                        |
+----------+---------------------------------------+
  400px               966px
```

- **Left panel (400px):** Category tabs + scrollable item grid (3 columns of ~128px each). Items show photo thumbnail, Khmer name, price KHR. Disabled items are grayscale with "អស់ពីស្តុក" (out of stock) overlay.
- **Right panel (966px):** Cart lines (scrollable), sticky footer with grand total and tender buttons.
- **All prices displayed via `KHRDisplay`.**

#### 9.4.3 T2 CDS (Customer-Facing Display)

- Simplified, large text. Only shows: order total, payment method, and loyalty info.
- No interactive elements. Updates in real-time as T1 cashier modifies the cart.
- Rotanak loyalty banner (`#F5A623`) displayed prominently if customer is enrolled.

```
+--------------------------------------------------+
|                                                  |
|           សូមស្វាគមន៍ (Welcome)                  |
|                                                  |
|           សរុប / Total                           |
|                                                  |
|              ៛26,000                             |
|              (via KHRDisplay at 48px)            |
|                                                  |
|     [Scan KHQR with ABA Mobile App]             |
|                                                  |
|     [QR Code Display Area — 200x200px]          |
|                                                  |
|     [Sleung Coin Balance: 150 coins]            |
|                                                  |
+--------------------------------------------------+
```

#### 9.4.4 T3 KDS (Kitchen Display System)

- **High contrast:** White text on dark background (`#1A202C`), colored status borders.
- **Touch targets:** Minimum 48px tap area for advancing order status.
- **Timer-driven:** Each order card shows elapsed time since confirmed.

```
+--------------------------------------------------+
| [T3 Station: HOT KITCHEN    3 orders   12:00]   |
+--------------------------------------------------+
| +------------------+  +------------------+       |
| | ORDER #42        |  | ORDER #43        |       |
| | 00:04 (green)    |  | 00:08 (yellow)   |       |
| |                  |  |                  |       |
| | បាយឆាសាច់គោ x2    |  | កាហ្វេត្រជាក់ x1   |       |
| | +Extra Veg       |  | +Extra Shot      |       |
| | -No Onion        |  |                  |       |
| |                  |  |                  |       |
| | [PREPARING ->]    |  | [READY FOR       |       |
| |                  |  |  PICKUP ->]       |       |
| +------------------+  +------------------+       |
| +------------------+                             |
| | ORDER #44        |                             |
| | 00:12 (red)      |  [Sound alert for red]      |
| +------------------+                             |
+--------------------------------------------------+
```

#### 9.4.5 T4 DDS (Display + Expediter System)

- **Slot grid:** Numbered slots (1-N, default 12) in a grid layout.
- **Occupied slots:** Show customer name, order number, items count.
- **Packing list view:** Below the slot grid, checklist format for verification.

#### 9.4.6 T5 QDS (Queue Display System)

- **Read-only, auto-updates via Supabase Realtime.**
- **Only two things matter:** slot number and order status.
- Large visible numbers from 2+ meters away.
- Sound alert when a new order is ready.

```
+--------------------------------------------------+
|         ការិយាល័យ / PICKUP QUEUE                   |
|              វិធីសាស្រ្ត (READY)                  |
+--------------------------------------------------+
|                                                  |
|    [  1  ]    [  3  ]    [  7  ]    [  9  ]     |
|   READY      READY     READY     READY          |
|                                                  |
|    [  2  ]    [  5  ]    [  -  ]    [  -  ]     |
|   READY      READY     EMPTY     EMPTY          |
|                                                  |
+--------------------------------------------------+
|    Slot: 1   |  បាយឆាសាច់គោ x2, កាហ្វេ x1       |
+--------------------------------------------------+
```

---

### 9.5 Receipt & Print Templates

All print templates are optimized for **80mm thermal printers** (58mm roll width printable area = 48mm, ~384px at 8 dots/mm). Khmer text uses the printer's built-in Khmer font (ESC/POS command `ESC t 30` for Khmer on compatible printers).

#### 9.5.1 80mm Thermal Receipt Format

```
+--------------------------------+
|      KITLUY ឃីត់លុយ           |
|    ហាង / Store: Cafe Central   |
|  អាសយដ្ឋាន: Phnom Penh        |
|  ទូរស័ព្ទ: +855 23 999 888     |
|                                |
|  វិក្កយបត្រ / Receipt: REC001  |
|  កាលបរិច្ឆេទ: 29/05/2026 14:30 |
|  បេឡាករ / Cashier: Sopheap    |
|  វេន / Shift: #42              |
|                                |
|--------------------------------|
| ទំនិញ / Item    ចំនួន   តម្លៃ  |
|--------------------------------|
| កាហ្វេត្រជាក់     x1   ៛8,000  |
|  +Extra Shot                   |
|                                |
| បាយឆាសាច់គោ      x2   ៛36,000 |
|  +Extra Veg                    |
|  -No Onion                     |
|--------------------------------|
| សរុបទំនិញ / Subtotal      ៛44,000|
| បញ្ចុះតម្លៃ / Discount    ៛0    |
| ពន្ធអាករ / Tax            ៛0    |
|--------------------------------|
| សរុបចុងក្រោយ / TOTAL     ៛44,000|
|--------------------------------|
| ទឹកប្រាក់បានបង់ / Paid    ៛50,000|
| លុយអាប់ / Change          ៛6,000 |
|--------------------------------|
| វិធីបង់ប្រាក់ / Payment:        |
|   សាច់ប្រាក់ / Cash:  ៛50,000   |
|                                |
|  [QR Code — Bakong KHQR]      |
|  Trace ID: ABC123456           |
|                                |
|  សូមអរគុណ / Thank You!         |
|  សូមមកវិញ / Please Come Again!  |
|                                |
|  ---Powered by KitLuy---       |
+--------------------------------+
```

**Print command sequence (ESC/POS via USB):**
```javascript
function printReceipt(receiptData) {
  var encoder = new TextEncoder();
  var cmds = [];
  // Initialize printer
  cmds.push(new Uint8Array([0x1B, 0x40]));
  // Set Khmer font
  cmds.push(new Uint8Array([0x1B, 0x74, 0x1E]));
  // Center align header
  cmds.push(new Uint8Array([0x1B, 0x61, 0x01]));
  // Print store name
  cmds.push(encoder.encode("KITLUY ឃីត់លុយ\\n"));
  cmds.push(encoder.encode(receiptData.store_name_km + "\\n"));
  cmds.push(encoder.encode(receiptData.store_address + "\\n"));
  // Left align for items
  cmds.push(new Uint8Array([0x1B, 0x61, 0x00]));
  // ... item lines ...
  // Cut paper
  cmds.push(new Uint8Array([0x1D, 0x56, 0x01]));
  return cmds;
}
```

#### 9.5.2 Cup Sticker Layout (Label Printer)

Printed on T3 when order reaches `ready_for_pickup`. 50mm x 30mm label.

```
+---------------------+
|  #42  1/3           |
|  កាហ្វេត្រជាក់      |
|  +Extra Shot        |
|  -No Sugar          |
|                     |
|  [QR 20x20mm]       |
|  29/05 14:30        |
+---------------------+
```

- **Order number** (large, bold): `#42`
- **Item count** (top right): `1/3` (item 1 of 3 in this order)
- **Item name** in Khmer: primary identifier for the barista
- **Modifiers**: one per line, `+` for add, `-` for remove
- **QR code**: Links to `ops.cafe_orders.id` for digital tracking
- **Timestamp**: Order confirmed time

#### 9.5.3 Packing List Format

Printed on T4 when assigning a slot. A4 or 80mm wide thermal.

```
+--------------------------------+
| បញ្ជីខ្ចប់ / PACKING LIST      |
| លេខបញ្ជា: #42                   |
| អតិថិជន: Sokha                 |
| ស្លុត: 7                        |
|--------------------------------|
| [x] កាហ្វេត្រជាក់  x1          |
|     [Cup sticker: 1/3]         |
|                                |
| [x] បាយឆាសាច់គោ    x1          |
|     +Extra Veg                 |
|     [Cup sticker: 2/3]         |
|                                |
| [x] នំបុ័ងប៉ូលា    x1          |
|     [Cup sticker: 3/3]         |
|--------------------------------|
| ចំនួនទំនិញ: 3         សរុប: ៛44,000|
|                                |
| [Barcode: ORDER#42]            |
| ស្លុត 7  |  អតិថិជនយកទៅ      |
+--------------------------------+
```

#### 9.5.4 Z-Report Format

Generated at shift close (`pos-shift-close`). 80mm thermal.

```
+--------------------------------+
|  របាយការណ៍ Z / Z-REPORT        |
|  វេន / Shift: #42               |
|  បេឡាករ: Sopheap                |
|  ថ្ងៃទី: 29/05/2026            |
|  ចាប់ផ្តើម: 06:00  បិទ: 14:30   |
|--------------------------------|
| ទឹកប្រាក់ចាប់ផ្តើម / Float: ៛100,000|
| ទឹកប្រាក់បិទ / Close:    ៛650,000|
| គួរតែមាន / Expected:    ៛644,000|
| ខុស / Discrepancy:      ៛6,000  |
|--------------------------------|
| លក់សរុប / Total Sales:  ៛544,000|
|--------------------------------|
| ប្រភេទបង់ប្រាក់ / By Tender:   |
|   សាច់ប្រាក់ / Cash:     ៛300,000|
|   KHQR / ABA:           ៛150,000|
|   កាត / Card:            ៛50,000 |
|   Sleung Coin:          ៛44,000 |
|--------------------------------|
| ប្រតិបត្តិការ / Transactions:  42 |
| មធ្យមក្នុងមួយ / Avg Ticket: ៛12,952|
| លុយអាប់សរុប / Total Change: ៛12,000|
| បង្វិល / Refunds:        ៛0     |
|--------------------------------|
| ---Generated by KitLuy---      |
+--------------------------------+
```

All monetary values formatted via `formatKHR` (Part 8). All timestamps in `Asia/Phnom_Penh` timezone.

---


---


## Part 10: Security & RBAC

**Version:** v1.0.0  
**Authority:** Business Logic Agent (veto on RBAC matrix and permission definitions)  
**Date:** 29 May 2026  
**Status:** Canonical  

**Prerequisites:** `Part 6, §6.2.1` (Control Plane tables: `cp.tenants`, `cp.accounts`, `cp.tenant_memberships`) and `Part 6, §6.3 enum #4` (`membership_role`).  
**RLS Pattern:** `Part 6, §6.1.4` (canonical template).

---

### 10.1 Role Definitions

Roles are stored in `cp.tenant_memberships.membership_role` (`Part 6, §6.3 enum #4`). Each account can have one role per tenant. An account may belong to multiple tenants with different roles in each.

| Role | Canonical Value | Description | Typical User |
|---|---|---|---|
| **Owner** | `'owner'` | Full control over the tenant. Can manage billing, close the account, and assign the owner role to others. Only owners can delete the tenant or transfer ownership. | Business founder, managing director |
| **Manager** | `'manager'` | Operational control. Can manage menu, staff, view all reports, and override constraints (e.g., cancel tabs, process refunds). Cannot manage billing or subscription. | Store manager, shift supervisor |
| **Cashier** | `'cashier'` | Day-to-day sales operations. Can create carts, process tenders, open/close shifts, and manage their own sessions. Cannot modify menu, manage staff, or view sensitive reports. | Front-line cashier |
| **Kitchen Staff** | `'staff'` | Kitchen-facing operations. Can view and update `ops.cafe_orders` status (preparing, ready_for_pickup). Cannot handle money, create carts, or access financial data. | Barista, cook, prep station worker |
| **Read-Only** | `'readonly'` | View-only access to reports and operational data. Cannot create, modify, or delete any record. | Accountant, auditor, external consultant |

> **Note:** The `'admin'` role value exists in the `membership_role` enum but is reserved for **HET internal operators only**. It is not assigned to merchant staff. It grants service_role-level access for support and debugging.

#### 10.1.1 Role Hierarchy

```
owner > manager > cashier > staff > readonly
```

A higher role implicitly includes all permissions of lower roles, except where explicitly restricted. For example, a manager can do everything a cashier can, plus additional managerial operations.

#### 10.1.2 Role Assignment Rules

| Rule | Description |
|---|---|
| **At least one owner** | Every tenant must have at least one `cp.tenant_memberships` row with `membership_role = 'owner'`. The edge function rejects deleting the last owner. |
| **Role assignment** | Only owners can assign the `owner` role. Managers can assign `manager`, `cashier`, `staff`, and `readonly`. |
| **Self-role** | An account cannot downgrade their own role below the level required to assign roles. An owner can step down only if another owner exists. |
| **Vertical-specific** | `staff` role is primarily for café vertical (kitchen operations). In laundry, `staff` has limited utility (read-only on orders). |

#### 10.1.3 Per-Vertical Role Applicability

| Role | Laundry Vertical | Café Vertical |
|---|---|---|
| `owner` | Full access | Full access |
| `manager` | Manage services, pricing, staff, reports | Manage menu, modifiers, recipes, staff, reports, override operations |
| `cashier` | Create laundry orders, process payment, open/close shifts | Create carts, process payment, manage tabs, open/close shifts |
| `staff` | View order queue, mark orders ready | View KDS, update order status, mark ready_for_pickup, print stickers |
| `readonly` | View reports, view order history | View reports, view order history, view operational metrics |

---

### 10.2 Permission Matrix

#### 10.2.1 Operations Catalog

Operations are the atomic actions that can be performed in the KitLuy system. They map to edge function calls.

| # | Operation | Description | Edge Functions |
|---|---|---|---|
| 1 | `manage_store` | Create, update, deactivate stores; configure registers and hardware | `pos-store-create`, `pos-store-update`, `pos-register-config` |
| 2 | `manage_menu` | CRUD on `menu.categories`, `menu.items`, `menu.price_history` | `menu-item-create`, `menu-item-update`, `menu-category-manage` |
| 3 | `manage_modifiers` | CRUD on `cafe.modifier_groups`, `cafe.modifiers`, `menu.item_modifier_groups` | `cafe-modifier-group-create`, `cafe-modifier-create` |
| 4 | `manage_recipes` | CRUD on `cafe.recipes`, `cafe.recipe_ingredients`, `cafe.ingredients` | `cafe-recipe-create`, `cafe-ingredient-manage` |
| 5 | `process_sales` | Create carts, add lines, process tenders, open/close shifts | `pos-cart-create`, `pos-cart-lock`, `pos-tender-create`, `pos-shift-open`, `pos-shift-close` |
| 6 | `process_refund` | Process full or partial refunds against completed orders | `pos-refund-full`, `pos-refund-partial` |
| 7 | `manage_tabs` | Open/close tabs, link carts to tabs, cancel tabs | `cafe-tab-open`, `cafe-tab-close`, `cafe-tab-cancel` |
| 8 | `manage_kitchen` | View and update `ops.cafe_orders` status, print stickers | `cafe-order-confirm`, `cafe-order-prepare`, `cafe-order-ready`, `cafe-order-serve`, `cafe-sticker-print` |
| 9 | `assign_slots` | Assign T4 pickup slots, broadcast to T5 | `cafe-order-assign-slot` |
| 10 | `trigger_delivery` | Fire HSAL booking for delivery orders | `hsal-booking-create` |
| 11 | `view_reports` | View Z-reports, sales summaries, analytics | `pos-z-report-get`, `pos-sales-summary` |
| 12 | `view_financials` | View invoices, receipts, tender details, shift reconciliation | `pos-invoice-get`, `pos-receipt-get`, `pos-shift-reconciliation` |
| 13 | `manage_staff` | Invite accounts, assign roles, deactivate staff | `cp-member-invite`, `cp-member-role-set`, `cp-member-deactivate` |
| 14 | `manage_settings` | Configure store settings, tax, receipt templates, printers | `pos-store-settings-update`, `tax-configure` |
| 15 | `override_operations` | Override constraints (cancel paid orders, delete items with history, bypass validation) | Various override flags on edge functions |
| 16 | `manage_billing` | View and manage subscription, billing details | `cp-billing-manage` (Owner only) |
| 17 | `use_rotanak` | Read Rotanak profile, trigger earn/redeem | `rotanak-profile-get`, `rotanak-coin-earn`, `rotanak-coin-redeem` |
| 18 | `view_offline` | View offline sync batches, resolve conflicts | `pos-offline-sync-status`, `pos-offline-sync-resolve` |

#### 10.2.2 Permission Matrix — Roles × Operations

| Operation | Owner | Manager | Cashier | Kitchen Staff | Read-Only |
|---|---|---|---|---|---|
| `manage_store` | **Y** | **Y** | N | N | N |
| `manage_menu` | **Y** | **Y** | N | N | N |
| `manage_modifiers` | **Y** | **Y** | N | N | N |
| `manage_recipes` | **Y** | **Y** | N | N | N |
| `process_sales` | **Y** | **Y** | **Y** | N | N |
| `process_refund` | **Y** | **Y** | N | N | N |
| `manage_tabs` | **Y** | **Y** | **Y** | N | N |
| `manage_kitchen` | **Y** | **Y** | N | **Y** | N |
| `assign_slots` | **Y** | **Y** | **Y** | N | N |
| `trigger_delivery` | **Y** | **Y** | N | N | N |
| `view_reports` | **Y** | **Y** | Y (own shift only) | N | **Y** |
| `view_financials` | **Y** | **Y** | N | N | **Y** |
| `manage_staff` | **Y** | **Y** | N | N | N |
| `manage_settings` | **Y** | **Y** | N | N | N |
| `override_operations` | **Y** | **Y** | N | N | N |
| `manage_billing` | **Y** | N | N | N | N |
| `use_rotanak` | **Y** | **Y** | **Y** | N | N |
| `view_offline` | **Y** | **Y** | N | N | **Y** |

**Legend:**
- **Y** = Allowed
- **N** = Denied (edge function returns `E_UNAUTHORIZED`)
- **Y (own shift only)** = Cashier can view reports for shifts they personally opened

#### 10.2.3 Special Permission Rules

| Rule | Description |
|---|---|
| **Line void** | Any role with `process_sales` can void a line on an `open` cart. Only `manager`+ can void a line on a `locked` cart. |
| **Cart cancel** | `cashier` can cancel `open` carts they created. `manager`+ can cancel any `open` or `locked` cart. |
| **Refund** | `cashier` cannot process refunds. `manager`+ can process refunds on any cart from their store. |
| **Tab cancel** | Only `manager`+ can cancel a tab. `cashier` can close a tab (when balance = 0) but cannot cancel. |
| **Price override** | Only `manager`+ can override item prices at cart time (e.g., give a discount not in the system). |
| **Offline sync resolve** | Only `manager`+ can resolve sync conflicts. `readonly` can view conflict details. |

---

### 10.3 RLS Policies

#### 10.3.1 Canonical Policy Pattern

Every tenant-scoped table uses the **exact same** RLS policy template, per `Part 6, §6.1.4`:

```sql
ALTER TABLE {schema}.{table} ENABLE ROW LEVEL SECURITY;

CREATE POLICY {table}_tenant_isolation ON {schema}.{table}
    FOR ALL
    USING (core.is_service_role() OR tenant_id = core.current_tenant_id());
```

**Components:**

| Component | Purpose |
|---|---|
| `core.is_service_role()` | Allows Supabase Edge Functions (using `service_role` key) to bypass RLS for administrative operations, cross-tenant queries, and internal tools. |
| `tenant_id = core.current_tenant_id()` | Ensures the requesting user can only see rows belonging to their current tenant. |
| `FOR ALL` | Applies to SELECT, INSERT, UPDATE, DELETE. |

#### 10.3.2 RLS Policy Assignment by Table

All 32 tenant-scoped tables from `Part 6, §6.2` have identical policies. The only exceptions are the two non-tenant-scoped tables:

| Table | Namespace | RLS Enabled | Policy Name | Notes |
|---|---|---|---|---|
| `cp.tenants` | Control plane | Yes | `tenants_owner_isolation` | **Different pattern** — uses `tenant_id IN (SELECT tenant_id FROM cp.tenant_memberships WHERE account_id = core.current_account_id())` |
| `cp.accounts` | Control plane | Yes | `accounts_self_access` | **Different pattern** — uses `id = core.current_account_id()` |
| `cp.tenant_memberships` | Control plane | Yes | `tenant_memberships_tenant_isolation` | Standard pattern |
| `fin.companies` | Financial | Yes | `companies_tenant_isolation` | Standard pattern |
| `pos.stores` | POS | Yes | `stores_tenant_isolation` | Standard pattern |
| `pos.registers` | POS | Yes | `registers_tenant_isolation` | Standard pattern |
| `pos.shifts` | POS | Yes | `shifts_tenant_isolation` | Standard pattern |
| `pos.sessions` | POS | Yes | `sessions_tenant_isolation` | Standard pattern |
| `pos.carts` | POS | Yes | `carts_tenant_isolation` | Standard pattern |
| `pos.cart_lines` | POS | Yes | `cart_lines_tenant_isolation` | Standard pattern |
| `pos.tenders` | POS | Yes | `tenders_tenant_isolation` | Standard pattern |
| `pos.tender_attempts` | POS | Yes | `tender_attempts_tenant_isolation` | Standard pattern |
| `pos.offline_sync_batches` | POS | Yes | `sync_batches_tenant_isolation` | Standard pattern |
| `pos.offline_sync_events` | POS | Yes | `sync_events_tenant_isolation` | Standard pattern |
| `sal.sales_invoices` | Sales | Yes | `sales_invoices_tenant_isolation` | Standard pattern |
| `sal.receipts` | Sales | Yes | `receipts_tenant_isolation` | Standard pattern |
| `menu.categories` | Catalog | Yes | `categories_tenant_isolation` | Standard pattern |
| `menu.items` | Catalog | Yes | `items_tenant_isolation` | Standard pattern |
| `menu.price_history` | Catalog | Yes | `price_history_tenant_isolation` | Standard pattern |
| `menu.item_modifier_groups` | Catalog | Yes | `item_modifier_groups_tenant_isolation` | Standard pattern |
| `cafe.modifier_groups` | Café | Yes | `modifier_groups_tenant_isolation` | Standard pattern |
| `cafe.modifiers` | Café | Yes | `modifiers_tenant_isolation` | Standard pattern |
| `cafe.recipes` | Café | Yes | `recipes_tenant_isolation` | Standard pattern |
| `cafe.ingredients` | Café | Yes | `ingredients_tenant_isolation` | Standard pattern |
| `cafe.recipe_ingredients` | Café | Yes | `recipe_ingredients_tenant_isolation` | Standard pattern |
| `cafe.tabs` | Café | Yes | `tabs_tenant_isolation` | Standard pattern |
| `ops.cafe_orders` | Operations | Yes | `cafe_orders_tenant_isolation` | Standard pattern |

#### 10.3.3 Service Role Bypass — When and Why

The `core.is_service_role()` check exists to allow edge functions (running with the `service_role` Supabase key) to perform operations that would otherwise violate RLS.

| Scenario | Why Service Role is Needed |
|---|---|
| **Cross-tenant admin** | HET internal operators (`'admin'` role) need to query across tenants for support and debugging. |
| **Offline sync processing** | The `pos-offline-sync-receive` edge function processes batches that may contain operations from a hub server — the JWT tenant context may not match the batch's tenant. |
| **Billing operations** | Subscription billing webhooks need to update `cp.tenants.subscription_tier` without a user JWT. |
| **Rotanak/HSAL callbacks** | External service callbacks (e.g., ABA PayWay payment confirmation) arrive without a user JWT. The edge function validates the callback signature and uses service_role to update tender status. |
| **Migration and seeding** | Database migrations and seed scripts run with service_role to populate initial data. |

**Security rule:** Edge functions using `service_role` must **always** validate the request independently before performing operations. The `service_role` key bypasses RLS but does not bypass application-level authorization checks.

#### 10.3.4 Row Ownership Within a Tenant

The standard RLS policy only enforces **tenant-level** isolation. Within a tenant, finer-grained access control is enforced by **edge functions**, not RLS:

| Granularity | Enforcement Mechanism | Example |
|---|---|---|
| Store-level | Edge function checks `store_id` against allowed stores | A manager of Store A cannot see Store B's carts |
| Shift-level | Edge function checks `shift.opened_by` | A cashier can only view their own shift's Z-report |
| Cart-level | Edge function checks `cart.session_id` or `cart.shift_id` | A cashier can only modify carts from their active session |
| Account-level | Edge function checks `account_id` | A user can only view their own `cp.accounts` row |

This design keeps RLS policies simple (fast, maintainable) while allowing flexible, context-aware authorization in edge functions.

---

### 10.4 Auth Flow

#### 10.4.1 Authentication — Phone OTP (Primary)

KitLuy uses **Supabase Auth with Phone OTP** as the primary authentication method per `Master Context §7`.

```
AUTH FLOW — Phone OTP:

Step 1: User enters phone number (Khmer format: +855XXXXXXXXX)
Step 2: Client calls supabase.auth.signInWithOtp({ phone })
Step 3: Supabase sends SMS OTP
Step 4: User enters 6-digit OTP
Step 5: Client calls supabase.auth.verifyOtp({ phone, token, type: 'sms' })
Step 6: Supabase returns JWT session
Step 7: Edge function extracts account_id from JWT claim
        (the JWT contains the auth.users.id UUID → cp.accounts.auth_user_id)
Step 8: Edge function sets app.current_tenant_id and app.current_account_id
        from cp.tenant_memberships WHERE account_id = {extracted UUID}
```

**Session duration:** 7 days (configurable per tenant). After expiry, user must re-authenticate with OTP.

**Phone number validation:**
```
Format: +855 followed by 8-9 digits (Khmer mobile format)
Examples: +85512345678, +855912345678
Regex: ^\+855[0-9]{8,9}$
```

#### 10.4.2 Account Creation Flow

When a new user authenticates for the first time:

```
Step 1: Phone OTP succeeds → auth.users row created by Supabase
Step 2: Edge function checks: SELECT FROM cp.accounts WHERE auth_user_id = {auth.users.id}
Step 3: If no row exists → INSERT cp.accounts:
        auth_user_id = auth.users.id
        phone = phone number from auth
        display_name = "User" (default, editable later)
        preferred_language = 'km' (Khmer-first default)
Step 4: If user was invited to a tenant (invitation exists by phone):
        INSERT cp.tenant_memberships (tenant_id, account_id, membership_role = invitation.role)
        DELETE invitation
Step 5: If no invitation:
        User sees "Create or Join Tenant" screen
```

#### 10.4.3 Single Identity Across Ecosystem

Per `Master Context §2 P2`, one `auth.users.id` UUID maps to exactly one `cp.accounts` row:

```
auth.users(id) ←──1:1──→ cp.accounts(auth_user_id)
```

This UUID is shared across all HET ecosystem apps (KitLuy, Rotanak, HSAL, etc.). The `cp.accounts` table is the **canonical identity bridge** between Supabase Auth and KitLuy's tenant system.

#### 10.4.4 Session Management on Registers

**Session** in this context refers to `pos.sessions` — a staff login on a register within a shift.

```
SESSION LIFECYCLE:

1. SHIFT OPEN:
   pos.shifts row created (opened_by = cashier account_id)
   → Auto-create first pos.sessions row (account_id = same cashier)

2. SESSION LOGIN (another staff member):
   a. Staff scans badge / enters PIN / uses fingerprint
   b. Edge function pos-session-start:
      - Validate account has process_sales OR manage_kitchen permission
      - Check no other active session on this register
      - INSERT pos.sessions (shift_id, register_id, account_id, is_active = true)
   c. Previous session auto-ended (if any)

3. ACTIVE SESSION:
   a. Every UI interaction → pos-session-ping → last_activity_at updated
   b. Cart created → cart.session_id = current_session.id
   c. Kitchen order updated → logged as performed by session.account_id

4. SESSION END:
   a. Explicit: Staff taps "End Session" → pos-session-end
   b. Auto: last_activity_at > 5 minutes ago → pos-session-auto-lock
   c. Shift close: All active sessions ended

5. LOCKED SESSION RECOVERY:
   a. Staff re-authenticates
   b. If within same shift: resume previous session or create new
   c. If shift closed: require new shift open
```

#### 10.4.5 Auto-Lock After Inactivity

| Parameter | Value | Rationale |
|---|---|---|
| **Inactivity threshold** | 5 minutes | Balance between security and café speed |
| **Detection** | `last_activity_at` timestamp | Updated on every touch/click/scan |
| **Action on lock** | `pos.sessions.is_active` set to `false` | Cart stays open but `session_id` set to `NULL` |
| **Recovery** | Re-authenticate (PIN/badge) | Within same shift: fast re-auth |
| **Sensitive operations** | Refund, tab cancel, price override | Require manager re-auth regardless of session state |

**Auto-lock pseudo-code:**
```
SCHEDULED JOB (every 60 seconds):
  SELECT id FROM pos.sessions
  WHERE is_active = true
    AND last_activity_at < now() - interval '5 minutes'

  FOR EACH session:
    UPDATE pos.sessions SET is_active = false, ended_at = now()
    -- Carts linked to this session: session_id set to NULL (survive as tab-like)
    UPDATE pos.carts SET session_id = NULL
    WHERE session_id = {session.id} AND cart_status = 'open'
```

#### 10.4.6 JWT Claim Structure

The edge function sets these claims in the PostgreSQL session for RLS enforcement:

```
request.jwt.claims = {
  "sub": "{auth.users.id}",
  "account_id": "{cp.accounts.id}",
  "tenant_id": "{cp.tenants.id}",
  "role": "{service_role | authenticated}",
  "membership_role": "{owner | manager | cashier | staff | readonly}",
  "iat": 1716979200,
  "exp": 1717584000
}
```

The `core.current_tenant_id()` and `core.current_account_id()` functions extract `tenant_id` and `account_id` from these claims (see `Part 6, §6.2.9`).

#### 10.4.7 Edge Function Authorization Check

Every edge function must perform this authorization check:

```
FUNCTION authorize(operation, required_roles[], context = {}):
  1. Extract JWT → account_id, tenant_id, membership_role
  2. IF membership_role NOT IN required_roles:
       RETURN { error: 'E_UNAUTHORIZED', message: 'Insufficient permissions' }
  3. IF context.store_id:
       Verify account has access to this store (via tenant membership)
  4. IF context.shift_id:
       Verify shift belongs to this store and tenant
  5. IF context.requires_manager_override:
       Verify membership_role IN ('owner', 'manager')
  6. RETURN { authorized: true, account_id, tenant_id }
```

**Integration with permission matrix:**

Edge functions reference the `§10.2.2` permission matrix at startup. The required role for each operation is hardcoded in the edge function.

```
-- Example: pos-refund-full edge function
REQUIRED_ROLE = ['owner', 'manager']  -- per §10.2.2
authorize('process_refund', REQUIRED_ROLE, { store_id: cart.store_id })
```


---


## Part 11: Deployment & Infra

**Version:** v1.0.0  
**Authority:** Architecture & Topology Agent  
**Date:** 29 May 2026  
**Cross-references:** Part 6 (canonical schema, migration order), Part 3 (system architecture), Part 4 (external contracts), Master Context §8 (hardware constants)

---

### 11.1 Deployment Philosophy

KitLuy deployments follow these principles:

1. **Cloud first, edge second.** Supabase project must be provisioned and migrations applied before any hardware is imaged.
2. **One Hub per store.** Each physical store gets exactly one Hub Server (Pi 5 8GB). No shared Hubs.
3. **Terminal pairing is deterministic.** T1–T5 registers are pre-created in `pos.registers` before hardware pairing.
4. **Migrations are forward-only.** No `DOWN` migrations. Rollback = restore from backup.
5. **All config is env-var based.** No hardcoded secrets in source code. Secrets managed via Supabase Dashboard or systemd env files on Hub.

---

### 11.2 Supabase Project Provisioning

#### SOP-DEP-001: Create Supabase Project

**Prerequisites:** Supabase org account, project name, billing card on file.

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Navigate to https://supabase.com/dashboard and sign in | Dashboard loads with project list | Reset password if needed |
| 2 | Click "New Project" button | Project creation wizard opens | — |
| 3 | Select HET organization | Org dropdown shows available orgs | Contact org admin for access |
| 4 | Enter **Project Name:** `KitLuy Production` (or `KitLuy Dev` for staging) | Name accepted (alphanumeric + hyphens) | Name must be unique within org |
| 5 | Generate and enter **Database Password:** 64-character random alphanumeric string | Password meets complexity requirements (min 8 chars, but use 64) | Use `openssl rand -base64 48` |
| 6 | **Save password in 1Password / Bitwarden immediately** | Password stored securely | If lost, must reset via Supabase support |
| 7 | Select **Region:** `Southeast Asia (Singapore)` — `ap-southeast-1` | Region dropdown shows Singapore | **Mandatory.** ap-southeast-1 only. |
| 8 | Click "Create New Project" | Provisioning begins. Progress bar shows. | If stuck > 10 minutes, check Supabase status page |
| 9 | Wait for provisioning (2–3 minutes) | Project shows "Active" status | If > 15 min, contact Supabase support |
| 10 | Click into the new project | Project dashboard loads | — |
| 11 | Navigate to **Project Settings** (gear icon) → **General** | Settings page loads | — |
| 12 | Note the **Project ID:** `qneduoifcsvjajeqmvgb` | ID visible and copyable | — |
| 13 | Note the **Project URL:** `https://qneduoifcsvjajeqmvgb.supabase.co` | URL visible | — |
| 14 | Navigate to **Project Settings** → **Database** → **Connection Info** | Connection string displayed | — |
| 15 | Note the connection string: `postgresql://postgres.qneduoifcsvjajeqmvgb:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres` | String copyable | Replace `[YOUR-PASSWORD]` with actual password |
| 16 | Navigate to **Project Settings** → **API** | API keys page loads | — |
| 17 | Note **`anon` public key** (starts with `eyJhbG...`) | Key visible | This is safe to embed in client apps |
| 18 | Note **`service_role` secret key** (starts with `eyJhbG...`) | Key visible | **Never expose to clients. Server-only.** |
| 19 | Store all credentials in team password manager | All 5 values saved | — |

**Verification:**
```bash
curl -X GET 'https://qneduoifcsvjajeqmvgb.supabase.co/rest/v1/' \
  -H "apikey: {anon_key}" \
  -H "Authorization: Bearer {anon_key}"
# Expected: 200 OK with schema information
```

#### SOP-DEP-002: Configure Authentication

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | In Supabase Dashboard, click **Authentication** in left sidebar | Auth settings page loads | — |
| 2 | Click **Providers** tab | Provider list visible | — |
| 3 | Find **Phone** provider. Toggle to **ON** | Phone provider enabled | If toggle doesn't save, refresh and retry |
| 4 | Select **SMS Provider:** Choose available provider (Twilio, MessageBird, or custom) for Cambodia | Provider dropdown populated | If no Cambodia provider available, configure custom webhook |
| 5 | Enter SMS provider credentials (Account SID, Auth Token, From number) | Credentials saved | Test SMS delivery before going live |
| 6 | Set **SMS template:** "Your KitLuy code is {{ .Code }}" | Template saved | Keep under 160 characters |
| 7 | Click **Settings** tab under Authentication | Settings form loads | — |
| 8 | Set **Site URL:** `https://seller.kitluy.com` (production) or `http://localhost:3000` (dev) | URL saved | — |
| 9 | Set **Redirect URLs:** Add `https://seller.kitluy.com/**` and `http://localhost:3000/**` | URLs saved | Wildcard `**` allows all paths |
| 10 | Under **JWT Settings**, set **JWT Expiry:** `3600` (seconds = 1 hour) | Expiry saved | — |
| 11 | Under **Security**, enable **Enable Confirmations** for phone (optional — auto-confirm for faster onboarding) | Toggle set per policy | HET policy: auto-confirm phone for MVP |
| 12 | Disable **Email provider** if phone OTP is primary | Email toggle = OFF | Can re-enable later for admin accounts |
| 13 | Click **Save** on all sections | Changes persisted | — |

#### SOP-DEP-003: Configure Database Settings

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Navigate to **Database** → **Extensions** | Extensions list loads | — |
| 2 | Enable `pgcrypto` (for `gen_random_uuid()`) | Extension enabled | Required by all table DDL |
| 3 | Enable `uuid-ossp` (backup UUID generator) | Extension enabled | — |
| 4 | Enable `postgis` (for HSAL location data, optional but recommended) | Extension enabled | — |
| 5 | Enable `pg_stat_statements` (query performance monitoring) | Extension enabled | — |
| 6 | Navigate to **Database** → **Pooling** | Pooling settings visible | — |
| 7 | Verify **Max Connections:** 200 (Supabase free tier) or higher (paid tier) | Number visible | If < 100, upgrade plan |

---

### 11.3 Migration Application

#### SOP-DEP-004: Apply Migrations in Order

**CRITICAL:** Migrations 001–013 from Part 6, §6.5.1 MUST be applied in exact order. Dependencies are explicit.

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Clone KitLuy repository: `git clone {repo_url} kitluy && cd kitluy` | Repository cloned | Verify Git access |
| 2 | Verify migration files exist: `ls supabase/migrations/*.sql` | Files `001_cp_schema.sql` through `013_triggers.sql` listed | If files missing, repository is incomplete |
| 3 | Install Supabase CLI if not already: `npm install -g supabase` | CLI installed | Or use Homebrew: `brew install supabase/tap/supabase` |
| 4 | Authenticate: `supabase login` | Browser opens, OAuth completes, "Logged in" message | Use `--token` flag with PAT if browser auth fails |
| 5 | Link to project: `supabase link --project-ref qneduoifcsvjajeqmvgb` | "Linked to project" message | Verify project ID from SOP-DEP-001 |
| 6 | Test connection: `supabase db test` | "Connection successful" | Check network, firewall, project ID |
| 7 | Apply migrations: `supabase db push` | Each migration applied sequentially with progress output | If ANY migration fails: STOP. Do NOT retry the same push. Read error. Fix migration file. Re-run `supabase db push` |
| 8 | Verify output shows all 13 migrations applied: `Applied supabase/migrations/001_cp_schema.sql... 013_triggers.sql` | All 13 files listed | If fewer than 13, some were skipped |
| 9 | Connect via psql to verify: `psql "postgresql://postgres:{password}@db.qneduoifcsvjajeqmvgb.supabase.co:5432/postgres"` | psql prompt appears | Use connection pooling URL for better reliability |
| 10 | Run verification query: `\dn` (list schemas) | Schemas: `cp`, `fin`, `pos`, `sal`, `menu`, `cafe`, `ops`, `core`, `auth`, `storage`, `realtime` | If any KitLuy schema missing, migration failed |
| 11 | Verify tables: `\dt cp.*`, `\dt pos.*`, etc. | All tables from Part 6 listed | Ghost tables (`core.stores`, `pos.items`) must NOT appear |
| 12 | Run ghost table validation (Part 6, §C.3.3) | Zero rows returned | If rows returned, ghost table references still exist — escalate to Schema Authority |
| 13 | Exit psql: `\q` | Shell prompt | — |

**Migration Order (canonical — from Part 6, §6.5.1):**

| Order | File | Schema | Tables / Objects | Depends On |
|---|---|---|---|---|
| 1 | `001_cp_schema.sql` | `cp` | `tenants`, `accounts`, `tenant_memberships` | `auth.users` (built-in) |
| 2 | `002_fin_schema.sql` | `fin` | `companies` | `cp.tenants` |
| 3 | `003_pos_core.sql` | `pos` | `stores`, `registers`, `shifts`, `sessions` | `cp.tenants`, `cp.accounts`, `fin.companies` |
| 4 | `004_pos_carts.sql` | `pos` | `carts`, `cart_lines` | All above + `menu.items` |
| 5 | `005_pos_tenders.sql` | `pos` | `tenders`, `tender_attempts` | `pos.carts` |
| 6 | `006_pos_offline_sync.sql` | `pos` | `offline_sync_batches`, `offline_sync_events` | `pos.stores` |
| 7 | `007_sal_documents.sql` | `sal` | `sales_invoices`, `receipts` | `pos.carts`, `pos.stores`, `pos.shifts` |
| 8 | `008_menu_catalog.sql` | `menu` | `categories`, `items`, `price_history`, `item_modifier_groups` | `cp.tenants`, `pos.stores` |
| 9 | `009_cafe_vertical.sql` | `cafe` | `modifier_groups`, `modifiers`, `recipes`, `ingredients`, `recipe_ingredients`, `tabs` | `cp.tenants`, `pos.stores`, `menu.items` |
| 10 | `010_ops_cafe.sql` | `ops` | `cafe_orders` | `pos.carts`, `cafe.tabs`, `pos.stores` |
| 11 | `011_deferred_fks.sql` | All | Cross-schema FKs | Migrations 1–10 applied |
| 12 | `012_core_functions.sql` | `core` | `current_tenant_id()`, `current_account_id()`, `is_service_role()`, `set_updated_at()`, RLS policies | All tables |
| 13 | `013_triggers.sql` | All | `updated_at` triggers on 22 tables, price history trigger | All tables with `updated_at` |

#### SOP-DEP-005: Rollback Procedure

**Migrations are forward-only.** If a migration corrupts data:

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | **STOP.** Do not apply more migrations. | — | — |
| 2 | Identify the problematic migration from `supabase db push` error output | Migration file name identified | — |
| 3 | Navigate to Supabase Dashboard → Database → Backups | Backup list visible | — |
| 4 | Find the most recent backup taken BEFORE the bad migration was applied | Backup timestamp noted | Daily backups are automatic |
| 5 | Click **Restore** on that backup | Restore confirmation dialog | — |
| 6 | Confirm restore. Wait (5–15 minutes for large databases). | "Restore complete" message | — |
| 7 | Verify: reconnect psql, run `\dt pos.*` — tables should match pre-migration state | Tables verified | — |
| 8 | Fix the problematic migration file in `supabase/migrations/` | File corrected | — |
| 9 | Re-run `supabase db push` | Clean apply | — |
| 10 | If restore is not available (rare): contact Supabase support with project ID | Support ticket created | — |

**⚠️ WARNING:** Restore from backup reverts ALL data changes since the backup timestamp. Any transactions processed after the backup will be lost. This is the cost of forward-only migrations.

---

### 11.4 Edge Function Deployment

#### SOP-DEP-006: Deploy Edge Functions

**Prerequisites:** Deno 1.40+, Supabase CLI linked to project, all migrations applied.

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Verify Deno: `deno --version` | `deno 1.40.x` or higher | Install: `curl -fsSL https://deno.land/install.sh \| sh` |
| 2 | Verify Supabase CLI: `supabase --version` | CLI version printed | Reinstall if < 1.150.0 |
| 3 | Verify project link: `supabase status` | Shows linked project ID | Re-run `supabase link` |
| 4 | List edge functions: `ls supabase/functions/` | Directory listing with `.ts` files | Standard functions: `pos-cart-finalize`, `pos-cafe-aba-khqr-poll`, `cafe-order-ready`, `cafe-order-complete`, `cafe-order-cancel`, `shift-open`, `shift-close`, `menu-item-create`, `menu-item-update`, `sync-batch`, `rotanak-profile-get`, `rotanak-coin-earn`, `rotanak-coin-redeem`, `hsal-booking-create` |
| 5 | Deploy all functions: `supabase functions deploy` | Each function deploys with progress: `Deploying pos-cart-finalize... Done` | If one fails, deploy individually: `supabase functions deploy pos-cart-finalize` |
| 6 | Verify in Dashboard: Edge Functions → list shows all functions with "Healthy" status | All functions green | If any show "Unhealthy", check function logs |
| 7 | Set ABA PayWay secret: `supabase secrets set ABA_PAYWAY_API_KEY=your_key_here ABA_PAYWAY_API_SECRET=your_secret_here` | "Secrets updated" message | — |
| 8 | Set Rotanak secret: `supabase secrets set ROTANAK_API_KEY=your_rotanak_key` | "Secrets updated" message | — |
| 9 | Set HSAL secret: `supabase secrets set HSAL_API_KEY=your_hsal_key` | "Secrets updated" message | Skip if no delivery |
| 10 | Verify secrets: `supabase secrets list` | All secrets listed (values masked) | — |
| 11 | Test `pos-cart-finalize` with curl | HTTP 200 with invoice ID | Check Dashboard → Edge Functions → Logs for errors |

**Sample test curl for `pos-cart-finalize`:**
```bash
curl -X POST \
  'https://qneduoifcsvjajeqmvgb.supabase.co/functions/v1/pos-cart-finalize' \
  -H "Authorization: Bearer {anon_key}" \
  -H "Content-Type: application/json" \
  -d '{
    "cart_id": "test-cart-uuid",
    "store_id": "test-store-uuid",
    "tenant_id": "test-tenant-uuid"
  }'
```

---

### 11.5 Pi 5 Hub Imaging

#### SOP-DEP-007: Prepare Hub Server OS Image

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Download **Raspberry Pi OS Lite (64-bit)** from https://www.raspberrypi.com/software/operating-systems/ | `2024-xx-xx-raspios-bookworm-arm64-lite.img.xz` downloaded | Verify SHA-256 on download page |
| 2 | Install **Raspberry Pi Imager** from https://www.raspberrypi.com/software/ | Imager installed | BalenaEtcher is alternative |
| 3 | Insert NVMe SSD into M.2 HAT+. Attach HAT+ to Pi 5 GPIO header. | Physical assembly complete, no bent pins | Check HAT+ seating — must click firmly |
| 4 | Connect NVMe SSD to computer via USB-NVMe adapter (or insert microSD for initial boot) | Drive detected by OS | Try different USB port |
| 5 | Open Raspberry Pi Imager. Click **Choose OS** → **Use custom** → select downloaded `.img.xz` | OS selected | — |
| 6 | Click **Choose Storage** → select NVMe SSD | Storage selected | Ensure correct drive — data will be erased |
| 7 | Click **Next**. When prompted, click **Edit Settings** (gear icon) | Settings dialog opens | — |
| 8 | Configure settings | Settings populated | Double-check hostname |
| 9 | Click **Save**, then **Yes** to apply settings | Settings written to boot partition | — |
| 10 | Wait for flash to complete (5–10 minutes for 128GB NVMe) | "Flash complete" message | If fails, reformat NVMe and retry |
| 11 | Remove NVMe from USB adapter. Install into Pi 5 M.2 HAT+. | NVMe seated in HAT+ | — |
| 12 | Connect Pi 5 to: power (USB-C 5V/5A), Ethernet (Gigabit switch), HDMI (optional for initial setup) | All connections secure | Use quality USB-C cable — Pi 5 needs 27W |
| 13 | Power on Pi 5. Wait 90 seconds for first boot. | Green LED blinks, then solid | If red LED only, check power supply |
| 14 | Find IP on router/DHCP table. Should be `192.168.1.x` | IP identified | Connect monitor to see IP if router doesn't show |
| 15 | SSH: `ssh kitluy@192.168.1.x` | Login prompt, enter password | If connection refused, wait 30s more |
| 16 | On first login, run: `sudo apt update && sudo apt full-upgrade -y` | All packages updated | May take 15–20 minutes |
| 17 | Reboot: `sudo reboot` | Pi restarts | — |

#### SOP-DEP-008: Configure Hub PostgreSQL Replica

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | SSH into Hub. Install PostgreSQL: `sudo apt install postgresql-15 postgresql-contrib-15 -y` | PostgreSQL installed | If version 16 available, use 16 |
| 2 | Start and enable: `sudo systemctl enable postgresql && sudo systemctl start postgresql` | `active (running)` | Check `sudo systemctl status postgresql` |
| 3 | Create local database: `sudo -u postgres createdb kitluy_local` | Database created | — |
| 4 | Create local user: `sudo -u postgres createuser --interactive kitluy` → superuser N → create DB N → roles N | User created | — |
| 5 | Set password: `sudo -u postgres psql -c "ALTER USER kitluy WITH PASSWORD '{strong_password}';"` | Password set | Save in password manager |
| 6 | Grant access: `sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE kitluy_local TO kitluy;"` | Privileges granted | — |
| 7 | Edit `/etc/postgresql/15/main/postgresql.conf` — set: `listen_addresses = 'localhost,192.168.1.10'`, `max_connections = 100`, `shared_buffers = 512MB`, `effective_cache_size = 2GB`, `work_mem = 16MB`, `maintenance_work_mem = 128MB`, `wal_level = replica` | Config updated | — |
| 8 | Edit `/etc/postgresql/15/main/pg_hba.conf` — add: `host kitluy_local kitluy 192.168.1.0/24 scram-sha-256` | Config updated | Adjust subnet mask |
| 9 | Restart PostgreSQL: `sudo systemctl restart postgresql` | Restarted without error | Check `journalctl -xeu postgresql` |
| 10 | Test local connection: `psql postgresql://kitluy:{password}@localhost:5432/kitluy_local -c "SELECT 1;"` | Returns `1` | — |
| 11 | Test LAN connection from another machine: `psql postgresql://kitluy:{password}@192.168.1.10:5432/kitluy_local -c "\l"` | Database list visible | Check firewall if connection refused |
| 12 | Open firewall: `sudo ufw allow 5432/tcp comment 'KitLuy PostgreSQL'` | Firewall rule added | — |

#### SOP-DEP-009: Install and Configure Sync Engine

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Install Node.js 20 LTS | Node v20.x installed | Use nvm if nodesource unavailable |
| 2 | Verify: `node --version` | `v20.x.x` | — |
| 3 | Create directory: `sudo mkdir -p /opt/kitluy-sync && sudo chown kitluy:kitluy /opt/kitluy-sync` | Directory created | — |
| 4 | Clone sync engine: `cd /opt/kitluy-sync && git clone {sync_repo_url} .` | Code cloned | — |
| 5 | Create `.env` file with all required env vars | Config saved | Get `store_id` and `tenant_id` from Supabase after seeding |
| 6 | Save `.env`. Set permissions: `chmod 600 /opt/kitluy-sync/.env` | File readable only by owner | — |
| 7 | Install dependencies: `cd /opt/kitluy-sync && npm ci` | Dependencies installed | — |
| 8 | Run initial schema bootstrap: `npm run bootstrap` | Local tables created matching cloud schema | Check Supabase connectivity |
| 9 | Run one-shot full sync: `npm run sync:pull` | Data downloaded from cloud | — |
| 10 | Verify local tables | Tables match cloud schema | — |
| 11 | Create systemd service file at `/etc/systemd/system/kitluy-sync.service` | Service configured | — |
| 12 | Create log directory | Directory created | — |
| 13 | Enable and start: `sudo systemctl daemon-reload && sudo systemctl enable kitluy-sync && sudo systemctl start kitluy-sync` | Service started | — |
| 14 | Verify: `sudo systemctl status kitluy-sync` | `active (running)` | Check `journalctl -u kitluy-sync -f` |
| 15 | Watch logs: `tail -f /var/log/kitluy-sync/sync.log` | Log shows sync cycles | — |
| 16 | Set up log rotation at `/etc/logrotate.d/kitluy-sync` | Rotation configured | — |

#### SOP-DEP-010: Hub Boot Configuration

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Set static IP via DHCP reservation on router (not Pi config) | Pi always gets `192.168.1.10` | If router doesn't support, use `/etc/dhcpcd.conf` on Pi |
| 2 | Optional: Configure WireGuard VPN to Supabase | WireGuard installed | — |
| 3 | Generate keys: `wg genkey \| tee privatekey \| wg pubkey > publickey` | Keys generated | — |
| 4 | Configure `/etc/wireguard/wg0.conf` with Supabase VPN endpoint | Config saved | Coordinate with Supabase/NetOps team |
| 5 | Enable WireGuard: `sudo systemctl enable wg-quick@wg0` | Auto-starts on boot | — |
| 6 | Enable automatic security updates: `sudo apt install unattended-upgrades -y` | Installed | — |
| 7 | Configure `sudo dpkg-reconfigure unattended-upgrades` → Yes | Security updates auto-applied | — |
| 8 | Install fail2ban: `sudo apt install fail2ban -y && sudo systemctl enable fail2ban` | Brute-force protection active | — |
| 9 | Disable unnecessary services: `sudo systemctl disable bluetooth` | Attack surface reduced | — |
| 10 | Final reboot: `sudo reboot` | Hub restarts, all services auto-start | Verify all services after reboot |
| 11 | Post-reboot verification: `sudo systemctl is-active postgresql kitluy-sync` | Both `active` | Investigate if either `inactive` |

---

### 11.6 Terminal Pairing

#### SOP-DEP-011: Terminal Pairing Master Procedure

**Before pairing any terminal:**
1. Store record must exist in `pos.stores` (created during merchant onboarding)
2. Register records must exist in `pos.registers` with correct `register_type` values
3. Hub Server must be online and reachable at `192.168.1.10`

**Create register records (one-time per store):**
```sql
-- Run in Supabase SQL Editor (or via psql)
INSERT INTO pos.registers (tenant_id, store_id, display_name, register_type, device_uuid, hardware_spec)
VALUES
  ('{tenant_uuid}', '{store_uuid}', 'Cashier Counter', 't1_cashier', NULL, '{"pi_model":"5","ram_gb":4,"printer":"80mm"}'),
  ('{tenant_uuid}', '{store_uuid}', 'Kitchen Hot Drinks', 't3_kds', NULL, '{"pi_model":"5","ram_gb":4,"printer":"label"}'),
  ('{tenant_uuid}', '{store_uuid}', 'Kitchen Cold Drinks', 't3_kds', NULL, '{"pi_model":"5","ram_gb":4,"printer":"label"}'),
  ('{tenant_uuid}', '{store_uuid}', 'Expediter Station', 't4_dds', NULL, '{"pi_model":"5","ram_gb":4,"printer":"80mm"}'),
  ('{tenant_uuid}', '{store_uuid}', 'Queue Display', 't5_qds', NULL, '{"pi_model":"5","ram_gb":4,"screen":"43inch"}');
```

> **T2 has no register record.** It is HDMI-2 output of T1.

#### SOP-DEP-012: T1 Cashier Pairing

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash microSD 32GB with Raspberry Pi OS Lite 64-bit using Imager | Flash complete | — |
| 2 | In Imager settings: set hostname `kitluy-t1-{store_slug}`, enable SSH, set username `kitluy` + password | Settings written | — |
| 3 | Boot T1 Pi. Find IP on LAN. | IP identified | Connect monitor if needed |
| 4 | SSH: `ssh kitluy@{t1_ip}` | Login successful | — |
| 5 | Update: `sudo apt update && sudo apt full-upgrade -y` | Updated | — |
| 6 | Install CUPS for printing | CUPS installed | — |
| 7 | Add user to lpadmin: `sudo usermod -aG lpadmin kitluy` | User added | — |
| 8 | Download POS Desktop App `.deb` from release server | Package downloaded | — |
| 9 | Install: `sudo dpkg -i kitluy-pos-desktop-arm64.deb` | Installation may fail with deps | Run `sudo apt --fix-broken install -y` |
| 10 | Verify app launches | Version printed | Check `/opt/kitluy-pos/` exists |
| 11 | Connect 80mm thermal printer via USB to T1. Power on. | Printer LED on | Try different USB port |
| 12 | Add printer via CUPS | Printer listed in CUPS | Install driver if generic fails |
| 13 | Select printer model (e.g., "Epson TM-T88V") or use "Generic Text-Only" | Driver selected | Download manufacturer PPD if needed |
| 14 | Set printer name: `T1-Receipt-Printer` | Named | — |
| 15 | In POS app config: set `hub_ip`, `register_id`, `printer_name`, `hdmi_screens` | Config saved | — |
| 16 | Launch POS app | App loads, shows "Connecting to Hub..." then "Paired" | Check Hub IP, firewall if stuck |
| 17 | On first launch, app detects dual HDMI. Prompts to configure T2 CDS. Click "Enable." | T2 screen shows KitLuy logo | Check `xrandr` if T2 not detected |
| 18 | Log in with owner account (phone OTP). | POS dashboard loads | Verify `cp.tenant_memberships` has owner role |
| 19 | Open shift: enter opening float (e.g., ៛200,000). Click "Open Shift." | Shift opens, `pos.shifts` row created | Check edge function log if fails |
| 20 | Print test page from POS app settings. | Test receipt prints with store name | Check CUPS queue: `lpstat -o` |
| 21 | T1 pairing complete. Update `pos.registers` device_uuid | DB updated | — |

#### SOP-DEP-013: T3 KDS Pairing

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T3 Pi 5 4GB microSD with OS Lite. Boot. Find IP. | T3 online | — |
| 2 | Set hostname: `kitluy-t3-{station}-{store_slug}` | Hostname set | — |
| 3 | SSH in, update system. | Updated | — |
| 4 | Install KDS app (bundled with POS release or separate download) | App installed | — |
| 5 | Configure app: set `hub_ip`, `register_id`, `station_name`, `printer_name` | Config saved | Get `register_id` from `pos.registers` |
| 6 | Connect label printer (58mm or 80mm) via USB. | Printer detected | — |
| 7 | Add printer in CUPS. Name: `T3-Label-Printer`. Driver: Zebra/Generic label. | Printer ready | Test with `lpr` |
| 8 | Launch KDS app. | Kitchen display loads, shows "Waiting for orders" | Check Hub connectivity |
| 9 | Create test order on T1. Add cafe items. Pay cash. | Order appears on T3 within 3 seconds | Check sync engine + `ops.cafe_orders` |
| 10 | On T3, click "Start Preparing." Click "Complete." | Sticker auto-prints. Order moves to T4. | Check printer if no sticker |
| 11 | Repeat for each T3 station (Hot Drinks, Cold Drinks, Food, etc.) | All stations paired | — |

#### SOP-DEP-014: T4 DDS Pairing

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T4 Pi 5 4GB microSD. Boot. Find IP. | T4 online | — |
| 2 | Set hostname: `kitluy-t4-{store_slug}` | Hostname set | — |
| 3 | Install DDS app (React app served via local web server or Electron) | App installed | — |
| 4 | Configure: set `hub_ip`, `register_id`, `printer_name` | Config saved | — |
| 5 | Connect 80mm printer for packing lists. | Printer ready | — |
| 6 | Launch DDS app. | Expediter view loads | — |
| 7 | Complete order on T3. | Order appears on T4 "Ready" section | — |
| 8 | Click order. Assign slot 1. Click "Print Packing List." | Packing list prints with slot, items, customer | Check printer |
| 9 | If order is delivery mode, verify HSAL booking triggered | Check `ops.cafe_orders.metadata->>'hsal_booking_id'` | Check edge function logs |
| 10 | Click "Mark Served." Order clears from T4 and T5. | Status updated | — |

#### SOP-DEP-015: T5 QDS Pairing

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | Flash T5 Pi 5 4GB microSD. Boot. Find IP. | T5 online | — |
| 2 | Set hostname: `kitluy-t5-{store_slug}` | Hostname set | — |
| 3 | Install QDS app (React app, runs in Chromium kiosk mode) | App installed | — |
| 4 | Configure kiosk mode for autostart | Auto-starts on boot | — |
| 5 | Connect large screen (32–43") via HDMI. | Screen detected at 1080p | Use `xrandr` to force resolution if needed |
| 6 | Launch QDS app. | Fullscreen queue display shows empty state | — |
| 7 | On T4, assign slot to a ready order. | Slot appears on T5 within 2 seconds | Check Realtime WebSocket if delayed |
| 8 | On T4, mark order served. | Slot disappears from T5 | — |
| 9 | Disconnect WAN (simulate outage). T5 should continue showing cached data. | Display still works | T5 polls Hub every 5s as fallback |
| 10 | Reconnect WAN. T5 re-subscribes to Realtime. | Real-time updates resume | — |

---

### 11.7 Monitoring & Alerts

#### SOP-DEP-016: Configure Cloud Monitoring

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | In Supabase Dashboard → Database → Health | Health metrics visible | — |
| 2 | Enable **Report Cards** email (weekly digest) | Email alerts configured | — |
| 3 | Set alert: CPU > 80% for 5 minutes | Alert rule active | Supabase sends email |
| 4 | Set alert: Disk usage > 85% | Alert rule active | Upgrade storage if recurring |
| 5 | Set alert: Active connections > 80% of max | Alert rule active | Increase pool size or upgrade plan |
| 6 | Monitor **API usage** in Dashboard → Settings → Usage | Request count visible | Set budget alerts |
| 7 | Enable **Database Webhooks** for critical table changes (optional) | Webhooks active | Use for external alerting (PagerDuty, Slack) |

#### SOP-DEP-017: Configure Hub Monitoring

| Step | Action | Expected Result | Fallback |
|---|---|---|---|
| 1 | On Hub, install netdata | Netdata installed at `http://192.168.1.10:19999` | Use `htop` + custom scripts if netdata fails |
| 2 | Configure netdata to expose only on localhost + nginx reverse proxy | Secure access | — |
| 3 | Add nginx config for `/health` endpoint | Health check available | — |
| 4 | Create health check script `/opt/kitluy-sync/health-check.sh` | Script created | — |
| 5 | Make executable: `chmod +x /opt/kitluy-sync/health-check.sh` | Executable | — |
| 6 | Add to cron: checks every 5 min | Checks running | — |
| 7 | Set up weekly `pg_dump` from Supabase to Hub | Backup script created | — |
| 8 | Create `/opt/kitluy-sync/backup.sh` | Script created | — |
| 9 | Create backup directory | Directory ready | Ensure NVMe has space |
| 10 | Add to cron: weekly backup at 3 AM Sunday | Weekly backup running | — |

#### SOP-DEP-018: Alert Thresholds Reference

| Metric | Warning Threshold | Critical Threshold | Action on Critical |
|---|---|---|---|
| Hub CPU (Pi 5) | > 70% for 5 min | > 90% for 5 min | Investigate sync engine load; may need Hub upgrade |
| Hub RAM | > 70% | > 90% | Check for memory leaks in sync engine; restart if needed |
| Hub Disk | > 75% | > 90% | Prune logs; NVMe upgrade may be needed |
| Hub Temperature | > 75°C | > 82°C | Check ventilation; thermal throttle imminent at 85°C |
| WAN latency to Supabase | > 500ms | > 2000ms or timeout | Check ISP; failover to backup connection if available |
| Sync queue depth (`pos.offline_sync_batches` pending) | > 100 events | > 1000 events | WAN severely degraded; alert ops team |
| Oldest unsynced batch age | > 1 hour | > 24 hours | Data at risk; manual intervention required |
| PostgreSQL connections | > 70% of max | > 90% of max | Connection leak or too many terminals; investigate |
| Supabase Edge Function error rate | > 1% | > 5% | Check function logs; likely code bug or API outage |
| Terminal heartbeat (`last_heartbeat`) | > 5 min old | > 15 min old | Terminal may be crashed or LAN segment down |

---

### 11.8 Pre-Flight Checklist

Before declaring a store "live," verify every item:

#### Cloud Infrastructure
- [ ] Supabase project created in `ap-southeast-1`
- [ ] All 13 migrations applied (001–013)
- [ ] All RLS policies active on tenant-scoped tables
- [ ] Auth: phone OTP enabled
- [ ] Edge functions deployed and healthy
- [ ] All API secrets (ABA, Rotanak, HSAL) configured
- [ ] No ghost tables (`core.stores`, `pos.items`, `pos.terminals`, `core.users`) exist

#### Hub Server
- [ ] Pi 5 8GB + NVMe booted successfully
- [ ] Hostname set: `kitluy-hub-{store_slug}`
- [ ] PostgreSQL local replica running
- [ ] Sync engine running as systemd service
- [ ] Sync engine successfully syncing with Supabase
- [ ] Static LAN IP configured (`192.168.1.10`)
- [ ] Firewall configured (5432 for LAN, 3000 for app proxy)
- [ ] Log rotation configured
- [ ] Weekly backup script in cron
- [ ] Health check script running every 5 minutes

#### Terminals
- [ ] T1: paired, printer working, dual HDMI (T2 CDS) active
- [ ] T2: displaying cart totals and QR codes correctly
- [ ] T3: all prep stations paired, label printing working
- [ ] T4: expediter view working, packing list printing, slot assignment functional
- [ ] T5: queue display showing real-time updates, offline fallback working

#### End-to-End
- [ ] Open shift succeeds
- [ ] Create cart + add lines succeeds
- [ ] Cash tender succeeds (invoice + receipt created)
- [ ] KHQR tender succeeds (ABA PayWay integration)
- [ ] Card tender succeeds (3DS flow + tokenization)
- [ ] Cafe: `ops.cafe_orders` auto-created on cart finalization
- [ ] Cafe: T3 → T4 → T5 operational flow complete
- [ ] Cafe: Slot assignment broadcasts to T5 via Realtime
- [ ] Rotanak: profile lookup, coin earn, coin redeem (with 30% cap) all working
- [ ] HSAL: delivery booking triggers after T4 slot assignment
- [ ] Shift close + Z-report succeeds
- [ ] Offline mode: operations continue during WAN outage
- [ ] Reconnection: queued events sync on WAN restore

#### Documentation
- [ ] Store credentials saved in password manager
- [ ] Hub device UUID documented
- [ ] All terminal device UUIDs documented
- [ ] Register IDs from `pos.registers` documented
- [ ] ABA PayWay merchant credentials documented
- [ ] Rotanak API key documented
- [ ] HSAL API key documented (if applicable)
- [ ] Support contact (HET ops) provided to merchant

---

*End of Part 11: Deployment & Infra*

---

*End of Parts 0, 3, 4, 11 — Architecture & Topology*


---


## Part 15: QA Matrix

**Version:** v1.0.0  
**Authority:** QA Agent (adversarial test design, logic-guard escalation)  
**Date:** 29 May 2026  
**Status:** Canonical

**Prerequisites:**
- `Part 5, §5.1–5.6` — State machines (cart, shift, tab, café order, tender, offline sync)
- `Part 6, §6.1–6.4` — Canonical schema, enums, RLS policies, FK map
- `Part 8, §8.1–8.5` — Money model, price pipeline, Rotanak math
- `Part 10, §10.1–10.4` — RBAC matrix, permission rules, session management
- `Master Context, §2, §4, §7` — Primitives, glossary, integration contracts

---

### §15.1 Test Strategy

#### §15.1.1 Philosophy

The KitLuy QA Matrix is **adversarial by design**. Every scenario is written from the perspective of a malicious user, unreliable network, race condition, or fat-fingered cashier operating at 35°C with intermittent power. Happy-path tests exist only to establish baselines; the value of this matrix is in the failure modes.

**Testing principles:**

| # | Principle | Application |
|---|---|---|
| 1 | **Never trust the client** | All validation is server-side (edge function). Client-side guards are UX, not security. |
| 2 | **Money is sacred** | Every test touching `numeric(18,4)`, `_khr` columns, or `formatKHR()` is Critical severity. |
| 3 | **Idempotency is not optional** | Duplicate requests with the same key must produce the same result, never double-charge or double-earn. |
| 4 | **RLS is the firewall** | Cross-tenant data access must fail at the database layer, not just the edge function. |
| 5 | **State machines have no shortcuts** | Invalid transitions (e.g., `open` → `refunded`) must be rejected with a defined error code. |
| 6 | **Offline = eventual consistency** | Sync conflicts resolve predictably. Server wins unless idempotency proves duplication. |
| 7 | **180 seconds is the KHQR contract** | Timeout, retry, and failure behaviors are exact — no "approximately 3 minutes." |

#### §15.1.2 Test Categories

| Category | Description | Scenarios |
|---|---|---|
| **Payment** | Split tender, KHQR timeout/retry, Rotanak redeem, double-spend | QA-01 – QA-07 |
| **Offline** | Batch creation, conflict resolution, reconnection burst | QA-08 – QA-10 |
| **Shift & Session** | Float, reconciliation, auto-lock, open-carts-on-close | QA-11 – QA-14 |
| **Café Operations** | Modifiers, slot assignment, HSAL delivery, tab survival | QA-15 – QA-18 |
| **Security & RBAC** | RLS isolation, permission bypass, state machine guards, service role | QA-19 – QA-28 |

#### §15.1.3 Severity Definitions

| Severity | Definition | Response |
|---|---|---|
| **Critical** | Financial integrity, security, or data isolation at risk. Blocks release. | Fix before deploy. |
| **High** | Core business logic failure. Workaround exists but is painful. | Fix in sprint. |
| **Medium** | UX degradation, edge case, or operational friction. | Queue for next cycle. |

#### §15.1.4 Test Type Taxonomy

| Type | Description |
|---|---|
| **Happy Path** | Normal flow under ideal conditions. Establishes baseline. |
| **Negative** | Invalid input or action expected to fail. Validates guardrails. |
| **Boundary** | Value at or just beyond a limit (e.g., exactly 30%, 30% + 1 KHR). |
| **Adversarial** | Simulates malicious intent, race conditions, or infrastructure failure. |

---

### §15.2 Test Environment Requirements

#### §15.2.1 Required Infrastructure

| Component | Spec | Purpose |
|---|---|---|
| Supabase Project | `qneduoifcsvjajeqmvgb`, `ap-southeast-1` | Cloud database, auth, edge functions, realtime |
| Hub Server | Pi 5 8GB + NVMe (emulated or physical) | LAN coordinator, offline sync source |
| T1 Cashier | Pi 5 4GB + 80mm printer (emulated or physical) | Cart creation, tender processing |
| T3 KDS | Pi 5 4GB + label printer | Kitchen display, recipe deduction |
| T4 DDS | Pi 5 4GB + 80mm printer | Slot assignment, expediter |
| T5 QDS | Pi 5 4GB (screen only) | Queue display |
| Network simulator | `tc` (Linux traffic control) or Clumsy | WAN outage, latency, packet loss |
| Load generator | k6 or Artillery | Reconnection burst, idempotency collision |

#### §15.2.2 Test Data Setup

| Entity | Minimum Count | Notes |
|---|---|---|
| Tenants | 2 | To test cross-tenant isolation |
| Stores | 3 | 1 café, 1 laundry, 1 additional café |
| Registers | 5 per store | T1–T5 for café; T1, T2, T4 for laundry |
| Accounts | 6 per tenant | owner(1), manager(1), cashier(2), staff(1), readonly(1) |
| Menu items | 20+ café, 10+ laundry | Include items with modifiers, recipes, and without |
| Modifier groups | 5+ | Required pick-one, optional pick-many, with max_selections |
| Modifiers | 15+ | With KHR upcharges |
| Recipes | 5+ | Linked to menu items |
| Ingredients | 10+ | With stock levels at and below threshold |
| Customers | 5+ | With Rotanak profiles across tiers (bronze, silver, gold) |

#### §15.2.3 Network Simulation Matrix

| Condition | Tool | Parameters |
|---|---|---|
| WAN down | `tc qdisc add dev eth0 root netem loss 100%` | 100% packet loss, Hub operates offline |
| WAN flaky | `tc qdisc add dev eth0 root netem loss 30% delay 2000ms` | 30% loss, 2s latency |
| WAN restore | `tc qdisc del dev eth0 root` | Immediate restore, triggers burst |
| LAN down | Disconnect terminal Wi-Fi | Terminal isolated from Hub |
| KHQR timeout | Mock ABA PayWay server | Delay response > 180s |

---

### §15.3 Scenario Catalog

---

#### QA-01: Split Tender — Cash + KHQR (Happy Path)

| Attribute | Value |
|---|---|
| **ID** | QA-01 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | Critical |
| **Type** | Happy Path |

##### Preconditions
- Café store active with register T1 (`pos.registers.register_type = 't1_cashier'`)
- Shift open (`pos.shifts.is_closed = false`)
- Session active (`pos.sessions.is_active = true`)
- Menu item "Iced Latte" at `base_price_khr = 15000` in `menu.items`
- ABA PayWay KHQR endpoint reachable
- Customer has KHQR-capable banking app

##### Steps
1. Cashier creates cart via `pos-cart-create` with idempotency key `DEV001_0001_1716979200`.
2. Cashier adds 2× Iced Latte via `pos-cart-line-add`. Cart `grand_total_khr = 30000` (USD 7.5000).
3. Cashier locks cart via `pos-cart-lock`. `cart_status` → `locked`.
4. Cashier initiates split tender: Cash ៛10,000 + KHQR ៛20,000.
5. Edge function `pos-tender-create` inserts two `pos.tenders` rows:
   - Tender A: `tender_type = 'cash'`, `amount = 2.5000`, `amount_khr = 10000`, `tender_status = 'pending'`
   - Tender B: `tender_type = 'aba_khqr'`, `amount = 5.0000`, `amount_khr = 20000`, `tender_status = 'pending'`
6. Cashier accepts ៛10,000 physical cash. Tender A status → `captured`.
7. Edge function `pos-cafe-aba-khqr-poll` generates KHQR deeplink for Tender B.
8. Customer scans KHQR code with banking app and confirms payment.
9. Polling loop detects `completed` on 2nd poll (at ~3s). Tender B status → `captured`.
10. Both tenders captured → edge function updates cart: `cart_status = 'paid'`, `total_paid_khr = 30000`, `change_due_khr = 0`.
11. Edge function `pos-invoice-create` fires: INSERT `sal.sales_invoices`, INSERT `sal.receipts`.
12. If café vertical: INSERT `ops.cafe_orders` (`order_status = 'new'`).

##### Expected Results
- `pos.carts.cart_status = 'paid'`
- `sal.sales_invoices` row exists with `grand_total_khr = 30000`, `invoice_status = 'final'`
- `sal.receipts` row exists with `receipt_status = 'issued'`
- `pos.tenders`: 2 rows, both `tender_status = 'captured'`
- `pos.tender_attempts`: 1 row for Tender A (gateway=`internal`, status=`success`); 2 rows for Tender B (gateway=`aba_payway`, 1st=`pending`, 2nd=`success`)
- `ops.cafe_orders.order_status = 'new'` (café only)

##### Fallback / Rollback
- If KHQR never scanned: Tender B → `failed` after 180s timeout. Cart → `failed`. Cashier unlocks cart (Tender A remains `captured` as cash refund). Cart returns to `open` for retry.
- If customer cancels KHQR payment: Tender B → `failed` immediately. Cart → `failed`. Cash refund for Tender A.

##### References
- Part 5, §5.1.3 (cart state machine transitions #5, #7)
- Part 5, §5.3.2 (split tender math)
- Part 5, §5.3.3 (KHQR polling loop)
- Part 6, §6.2.3 (`pos.tenders`, `pos.tender_attempts` DDL)
- Part 8, §8.2.4 (split tender remainder distribution)

---

#### QA-02: Split Tender — Cash + Card 3DS

| Attribute | Value |
|---|---|
| **ID** | QA-02 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | Critical |
| **Type** | Happy Path |

##### Preconditions
- Same as QA-01
- ABA PayWay card 3DS endpoint reachable
- Customer willing to enter card details (or has saved `aba_token`)

##### Steps
1. Cashier creates cart: 1× "Cappuccino" + 1× "Croissant", `grand_total_khr = 28000` (USD 7.0000).
2. Cashier locks cart.
3. Cashier initiates split: Cash ៛20,000 + Card ៛8,000.
4. Edge function inserts two `pos.tenders` rows:
   - Tender A: `tender_type = 'cash'`, `amount = 5.0000`, `amount_khr = 20000`
   - Tender B: `tender_type = 'aba_card'`, `amount = 2.0000`, `amount_khr = 8000`
5. Cashier accepts ៛20,000 cash. Tender A → `captured`.
6. Edge function `pos-cafe-aba-card-3ds` initiates 3DS flow for Tender B:
   - New card: tokenize via ABA PayWay, store `aba_token` on success
   - Saved token: reuse existing `aba_token`
7. Customer redirected to 3DS ACS URL, authenticates successfully.
8. Callback received: Tender B → `captured`.
9. Both captured → cart → `paid`, invoice and receipt created.

##### Expected Results
- Cart `paid`, invoice `final`, receipt `issued`
- Tender B has `aba_token` populated (new card) or reused (saved card)
- `pos.tender_attempts` for Tender B: `status = 'success'`, `gateway = 'aba_payway'`
- 3DS callback processed within 10 minutes (abandonment window)

##### Fallback / Rollback
- 3DS abandoned (no callback within 10 min): `tender_attempts.status = 'timeout'`, tender → `failed`. Cart → `failed`. Cash refund for Tender A.
- 3DS authentication failed: `tender_attempts.status = 'failed'`, tender → `failed`. Cart → `failed`. Cash refund for Tender A.
- Customer may retry with same card (new `tender_attempts` row, same `aba_token`) or different card.

##### References
- Part 5, §5.3.3 (Card 3DS flow)
- Part 6, §6.2.3 (`pos.tenders.aba_token`, `pos.tenders.aba_payway_ref`)
- Part 5, §5.1.3 (transitions #7, #8, #9)

---

#### QA-03: KHQR Timeout After 180s, Exponential Backoff 3×, Final Failure

| Attribute | Value |
|---|---|
| **ID** | QA-03 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Same as QA-01
- Mock ABA PayWay server configured to never return `completed` (simulates customer not scanning)
- Customer has KHQR app but does NOT scan the code

##### Steps
1. Cashier creates cart: 1× "Espresso", `grand_total_khr = 8000` (USD 2.0000).
2. Cashier locks cart.
3. Cashier initiates KHQR tender for full amount: ៛8,000.
4. Edge function `pos-cafe-aba-khqr-poll` starts polling loop:
   - `timeout_at = now() + 180 seconds`
   - `backoff_intervals = [3, 6, 12]` seconds
5. **Attempt 1** (t=0s): INSERT `tender_attempts` (status=`processing`). Call `/check-payment`. Response: `pending`. Sleep 3s.
6. **Attempt 2** (t=3s): INSERT `tender_attempts` (status=`processing`). Call `/check-payment`. Response: `pending`. Sleep 6s.
7. **Attempt 3** (t=9s): INSERT `tender_attempts` (status=`processing`). Call `/check-payment`. Response: `pending`. Sleep 12s.
8. **Attempt 4+** (t=21s onwards): Continue with 12s max backoff interval until timeout.
9. At t=180s: Timeout reached. INSERT `tender_attempts` (status=`timeout`, `error_code = 'TIMEOUT'`).
10. UPDATE `pos.tenders` SET `tender_status = 'failed'`.
11. UPDATE `pos.carts` SET `cart_status = 'failed'`.

##### Expected Results
- Exactly **16** `tender_attempts` rows: attempts 1–15 at `processing`→`pending`, final at `timeout`
  - Wait calculation: 3 + 6 + 12 + 12×13 = 3 + 6 + 12 + 156 = 177s consumed by backoff; 16th attempt fires near 180s timeout
- Last `tender_attempts` row has `status = 'timeout'`, `error_code = 'TIMEOUT'`
- `pos.tenders.tender_status = 'failed'`
- `pos.carts.cart_status = 'failed'`
- No invoice created, no financial impact
- Cashier sees "KHQR timed out — customer did not scan" message

##### Fallback / Rollback
- Cashier unlocks failed cart via `pos-cart-unlock` (no captured tenders exist).
- Cart returns to `open`. Cashier can retry KHQR or switch to cash/card.
- If cashier cancels: cart → `cancelled`.

##### References
- Part 5, §5.3.3 (KHQR polling loop — exact timing)
- Master Context, §7 (KHQR: 180s timeout, 3× exponential backoff)
- Part 5, §5.1.3 (transition #8: `locked` → `failed`)

---

#### QA-04: KHQR Retry Succeeds on 2nd Attempt

| Attribute | Value |
|---|---|
| **ID** | QA-04 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Same as QA-01
- Mock ABA PayWay configured to return `completed` on 2nd poll (simulates delayed customer scan)

##### Steps
1. Cashier creates cart: 1× "Americano", `grand_total_khr = 10000` (USD 2.5000).
2. Cashier locks cart, initiates KHQR tender for full amount.
3. **Attempt 1** (t=0s): `/check-payment` returns `pending`. Sleep 3s.
4. Customer scans KHQR code and confirms payment during the 3s sleep.
5. **Attempt 2** (t=3s): `/check-payment` returns `completed`. 
6. UPDATE `pos.tenders` SET `tender_status = 'captured'`, `aba_payway_ref = response.ref`.
7. UPDATE `pos.tender_attempts` SET `status = 'success'`, `completed_at = now()`.
8. Cart → `paid`, invoice created.

##### Expected Results
- Only 2 `tender_attempts` rows: 1st=`pending`, 2nd=`success`
- Total elapsed time ≈ 3 seconds
- `pos.tenders.tender_status = 'captured'`
- `aba_payway_ref` populated with transaction reference
- Invoice and receipt created

##### Fallback / Rollback
- If attempt 2 still returns `pending`: continue polling per backoff schedule (QA-03 path).
- If ABA PayWay returns `failed`: tender → `failed` immediately (no timeout wait).

##### References
- Part 5, §5.3.3 (KHQR polling loop)
- Part 6, §6.2.3 (`pos.tenders.aba_payway_ref`, `pos.tenders.khqr_trace_id`)

---

#### QA-05: Rotanak Redeem at Exactly 30% Cap (Boundary Test)

| Attribute | Value |
|---|---|
| **ID** | QA-05 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | Critical |
| **Type** | Boundary |

##### Preconditions
- Café store with Rotanak integration enabled
- Customer with Rotanak Gold tier, balance ≥ 18,000 Sleung Coins
- Menu item exists at price creating a target total

##### Steps
1. Cashier creates cart with items totaling exactly `grand_total_khr = 60000` (USD 15.0000).
2. Customer elects to redeem Sleung Coins.
3. Edge function `rotanak-coin-redeem` computes:
   - `max_redeem_khr = FLOOR(60000 * 30 / 100) = 18000`
   - Customer has ≥ 18,000 coins, so `actual_redeem_khr = 18000`
   - `actual_coins_used = 18000`
4. **Preview phase:** `rotanak-redeem-preview` returns `{ allowed: true, coins_to_use: 18000, value_khr: 18000, value_usd: 4.5000 }`.
5. Customer confirms.
6. **Commit phase:** `rotanak-coin-redeem` commit succeeds. Rotanak server-side validation passes (18000 ≤ 30% of 60000).
7. Edge function inserts `pos.tenders` row:
   - `tender_type = 'sleung_coin'`, `amount = 4.5000`, `amount_khr = 18000`, `sleung_coins_used = 18000`, `tender_status = 'captured'`
8. Remaining balance: ៛42,000 paid via cash/KHQR/card.
9. Split tender captured → cart → `paid`.

##### Expected Results
- Preview returns `allowed: true`, `value_khr = 18000`
- Commit succeeds
- `pos.tenders` row has `amount_khr = 18000` (exactly 30% of 60000)
- `sleung_coins_used = 18000`
- Rotanak API called exactly once for commit (idempotency check on preview vs commit)
- Invoice created with total redeemed correctly

##### Fallback / Rollback
- If preview allowed but commit rejected by Rotanak: show error to customer, do not insert tender. Allow customer to retry or change payment method.
- If Rotanak API unavailable: queue redeem attempt, allow payment via other tender types.

##### References
- Part 8, §8.5.3 (Rotanak redeem math)
- Part 8, §8.5.4 (dual enforcement: preview + commit)
- Master Context, §7 (Rotanak redeem: 30% cap at preview AND commit)
- Part 6, §6.2.3 (`pos.tenders.sleung_coins_used`)

---

#### QA-06: Rotanak Redeem at 30.01% (Must Be Rejected at Preview)

| Attribute | Value |
|---|---|
| **ID** | QA-06 |
| **Category** | Payment |
| **Vertical** | Café |
| **Severity** | Critical |
| **Type** | Boundary |

##### Preconditions
- Same as QA-05
- Adversarial test: attempt to redeem 1 KHR above the 30% cap

##### Steps
1. Cashier creates cart with `grand_total_khr = 60033`.
   - `max_redeem_khr = FLOOR(60033 * 30 / 100) = FLOOR(18009.9) = 18009`
2. Customer (adversarial) attempts to redeem 18,010 coins (1 KHR over cap).
3. Edge function `rotanak-redeem-preview` computes:
   - `max_redeem_khr = 18009`
   - Customer requests 18,010 coins
   - `18010 > 18009` → REJECT
4. Edge function returns `{ allowed: false, error_code: 'E_ROTANAK_CAP_EXCEEDED', max_redeem_khr: 18009, requested: 18010 }`.
5. **Verify:** No `pos.tenders` row is inserted. No Rotanak API commit call is made.

##### Expected Results
- Preview returns `allowed: false`, `error_code = 'E_ROTANAK_CAP_EXCEEDED'`
- No network call to Rotanak commit endpoint
- `pos.tenders` has no `sleung_coin` row for this cart
- Customer shown: "Maximum redeem is ៛18,009 for this order"
- Cashier can proceed with other payment methods

##### Fallback / Rollback
- N/A — test validates rejection before any side effects.

##### References
- Part 8, §8.5.4 (dual enforcement — preview must reject)
- Part 8, §8.5.3 (redeem formula: `max_redeem_khr = FLOOR(order_total_khr * 30 / 100)`)
- Master Context, §7 (30% cap enforcement at preview AND commit)



---

#### QA-07: Double-Spend Attempt — Same Idempotency Key, Different Payload

| Attribute | Value |
|---|---|
| **ID** | QA-07 |
| **Category** | Payment |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Active shift and session on T1
- Two distinct menu items: "Americano" (item_id=A) and "Latte" (item_id=B)
- Idempotency key format: `[device_uuid]_[counter]_[timestamp]`

##### Steps
1. Cashier creates cart with idempotency key `DEV001_0001_1716979200` containing 1× Americano.
2. **Concurrent/rapid second request** arrives with the SAME idempotency key `DEV001_0001_1716979200` but DIFFERENT payload: 1× Latte (different item, different price).
3. Edge function `pos-cart-create` processes both requests simultaneously.
4. Request 1: INSERT `pos.carts` with item A, succeeds.
5. Request 2: Hits `UNIQUE` constraint on `pos.carts.idempotency_key`.
6. Edge function catches the unique violation.
7. Edge function compares payload: idempotency key matches but payload differs.

##### Expected Results
- **Result:** Exactly one `pos.carts` row created (from Request 1).
- Request 2 returns the **existing cart** (Request 1's cart), NOT the payload it requested.
- Response to Request 2: `{ cart_id, idempotency_collision: true, note: 'Existing cart returned. Payload ignored.' }`
- No second cart row exists.
- No financial discrepancy (item A price ≠ item B price — idempotency prevents wrong-price cart).

##### Fallback / Rollback
- If comparison shows payload matches: normal idempotency return (same result, no flag).
- If edge function fails to catch unique violation: database constraint guarantees single row. Log error for investigation.

##### References
- Part 5, §5.1.4 (idempotency on cart operations — collision behavior)
- Part 6, §6.2.3 (`pos.carts.idempotency_key UNIQUE`)
- Master Context, §2 P9 (idempotency required, format specified)

---

#### QA-08: Offline Batch Creation, 50 Events, WAN Restore, Sync Completes

| Attribute | Value |
|---|---|
| **ID** | QA-08 |
| **Category** | Offline |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Hub Server running local PostgreSQL replica
- T1 terminal connected to Hub via LAN
- WAN down (simulated via `tc loss 100%`)
- Shift open before WAN outage
- Menu items synced to local replica

##### Steps
1. WAN goes down at t=0.
2. T1 cashier creates 10 carts, adds lines, locks carts.
3. T1 cashier processes 10 cash tenders (local-only, no gateway needed).
4. T1 cashier creates 10 more carts, adds lines (20 total carts).
5. T1 opens 3 additional sessions (staff rotation).
6. At event count = 50, Hub auto-creates `pos.offline_sync_batches` row:
   - `batch_status = 'pending'`, `event_count = 50`, `synced_count = 0`
7. Each of the 50 events is INSERTed into `pos.offline_sync_events` linked to the batch.
8. WAN restores at t=30 minutes.
9. Hub detects connectivity (health check succeeds).
10. Hub flushes batch to Supabase via `pos-offline-sync-receive` edge function.
11. Edge function processes events in order, applying conflict resolution.
12. Edge function returns: `{ synced: 50, conflicts: 0, errors: 0 }`.
13. Hub updates batch: `batch_status = 'synced'`, `synced_count = 50`, `completed_at = now()`.

##### Expected Results
- 50 `offline_sync_events` rows, all `event_status = 'synced'`
- 20 `pos.carts` rows exist in cloud (10 `paid`, 10 `open` or `locked`)
- 10 `sal.sales_invoices` and 10 `sal.receipts` created for paid carts
- Invoice numbers assigned sequentially by `created_at` order
- No data loss, no duplicates, no conflicts

##### Fallback / Rollback
- If WAN restore is temporary (flaps): Hub retries batch (max 5 attempts, exponential backoff).
- If partial sync failure: `batch_status = 'partial'`, failed events get `event_status = 'error'` with `error_log`. Hub retries on next connectivity window.
- If Supabase rate-limits: Hub respects 429 response, backs off, retries.

##### References
- Part 5, §5.4.2 (batch creation — size threshold: 50 events or 5 minutes)
- Part 5, §5.4.5 (reconnection burst handling)
- Part 6, §6.2.3 (`pos.offline_sync_batches`, `pos.offline_sync_events` DDL)
- Part 6, §6.3 enum #12 (sync_event_type values)

---

#### QA-09: Offline Conflict — Same Cart Modified on Two Terminals, Winner Determination

| Attribute | Value |
|---|---|
| **ID** | QA-09 |
| **Category** | Offline |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Adversarial |

##### Preconditions
- Two T1 terminals (T1-A and T1-B) connected to same Hub
- WAN down
- Both terminals create the same cart offline (UUID collision scenario)
- OR: Both terminals modify the same existing cart's status differently

##### Steps
1. WAN down. Cart C exists on both terminals with `cart_status = 'open'`.
2. **Terminal A** (cashier Sokha): Adds line "Iced Latte", locks cart (`cart_status = 'locked'`). Captured as offline event E_A.
3. **Terminal B** (cashier Dara): Adds line "Americano", locks cart (`cart_status = 'locked'`). Captured as offline event E_B.
4. WAN restores. Hub uploads batch.
5. Edge function `pos-offline-sync-receive` processes E_A first (earlier timestamp):
   - Applies E_A: Cart C has line "Iced Latte", `cart_status = 'locked'`.
6. Edge function processes E_B (later timestamp):
   - Server cart C is now `locked` with "Iced Latte".
   - E_B payload differs from server state.
   - **Conflict resolution:** Timestamp comparison — E_B is newer than server state.
   - Server cart C updated: line "Americano" added (or replaces, per business rule), `cart_status = 'locked'`.
   - E_B marked `synced`.

##### Expected Results (Per Conflict Type)

| Conflict Scenario | Resolution | Winner |
|---|---|---|
| Same UUID cart created on both terminals | UUID collision — reject offline, keep server | Server |
| Same cart status changed on both (different values) | Newer timestamp wins | Newer timestamp |
| Same tender idempotency key on both | Return existing tender (idempotency dedup) | Server (first one) |
| Same item price changed on both | Reject offline price change, alert manager | Server |

- For cart_update conflicts: `offline_sync_events.conflict_info` populated with server-side values.
- Manager alerted via dashboard notification for all conflicts.

##### Fallback / Rollback
- If conflict resolution produces an invalid state (e.g., `locked` cart with no lines): log error, alert manager, do not crash.
- If timestamp tie (extremely unlikely with UUIDv7): server state wins by default.

##### References
- Part 5, §5.4.4 (conflict resolution strategy — timestamp comparison)
- Part 6, §6.2.3 (`offline_sync_events.conflict_info` column)
- Part 6, §6.3 enum #13 (sync_event_status: `conflict`)

---

#### QA-10: Reconnection Burst — 500 Events Queued, Rate Limiting Works

| Attribute | Value |
|---|---|
| **ID** | QA-10 |
| **Category** | Offline |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Adversarial |

##### Preconditions
- Hub Server with 500 pending offline events accumulated during 2-hour WAN outage
- 10 batches of ~50 events each (or varying sizes)
- Load generator ready to simulate burst

##### Steps
1. WAN down for 2 hours. High-traffic café operates continuously.
2. 500 events queued across multiple batches.
3. WAN restores.
4. Hub attempts to flush all batches simultaneously.
5. Supabase edge function `pos-offline-sync-receive` receives burst.

##### Expected Results
- **Rate limiting active:** Maximum 10 batches per minute processed (Part 5, §5.4.5).
- Hub queues batches beyond the limit, processes in FIFO order.
- No 429/rate-limit errors from Supabase (Hub respects the limit).
- All 500 events processed within ~10 minutes (at 10 batches/min, 10 events per batch avg).
- `batch_status` transitions: `pending` → `syncing` → `synced` (or `partial`/`error`).
- No events dropped.
- Supabase CPU/memory metrics within acceptable range during burst.

##### Fallback / Rollback
- If Supabase returns 429 despite rate limiting: Hub doubles backoff interval, retries.
- If batch fails mid-processing (network flap): `batch_status = 'partial'`, retry on next connectivity window (max 5 retries).
- If 5 retries exhausted: `batch_status = 'error'`, manager alerted.

##### References
- Part 5, §5.4.5 (reconnection burst handling — rate limiting: 10 batches/min max)
- Part 5, §5.4.4 (conflict resolution)
- Part 6, §6.2.3 (`offline_sync_batches.batch_status` enum)

---

#### QA-11: Shift Open with Float, Multiple Sessions, Shift Close with Z-Report

| Attribute | Value |
|---|---|
| **ID** | QA-11 |
| **Category** | Shift |
| **Vertical** | Both |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Store with register T1 active
- No open shift for this register
- Cashier account with `process_sales` permission
- Manager account with `process_sales` + `view_financials` + `process_refund`

##### Steps
1. Cashier Sokha opens shift:
   - `pos-shift-open` with `opening_float = 100.0000` (USD) = ៛400,000
   - Guard checks: no open shift for this register (pass), cashier has permission (pass), register active (pass), float ≥ 0 (pass)
   - INSERT `pos.shifts`: `opened_by = Sokha`, `opening_float = 100.0000`, `is_closed = false`
   - Auto-start session: INSERT `pos.sessions`: `account_id = Sokha`, `is_active = true`
2. Sokha processes 5 sales (carts → paid → invoiced), total cash tenders = ៛80,000.
3. Staff Dara logs in (session start):
   - `pos-session-start`: Dara's account has `process_sales`
   - INSERT `pos.sessions`: `account_id = Dara`, `is_active = true`
   - Sokha's session auto-ended: `is_active = false`, `ended_at = now()`
4. Dara processes 3 sales, total KHQR tenders = ៛45,000.
5. Sokha logs back in (new session):
   - INSERT `pos.sessions`: `account_id = Sokha`, `is_active = true`
   - Dara's session ended.
6. Sokha processes 2 refunds (full), total refund amount = ៛20,000.
7. Manager closes shift:
   - Pre-close check: no `locked` carts for this shift (pass)
   - Count physical cash: `closing_float = 148.0000` (USD) = ៛592,000
   - Compute expected: `expected_float = opening_float + cash_sales - cash_refunds`
     - `expected_float = 100.0000 + 20.0000 - 5.0000 = 115.0000` (USD) = ៛460,000
   - Compute discrepancy: `discrepancy = closing_float - expected_float = 148.0000 - 115.0000 = 33.0000`
   - Generate Z-report: `z_report_data` JSON snapshot
   - UPDATE `pos.shifts`: `is_closed = true`, `closed_by = Manager`, `closed_at = now()`

##### Expected Results
- `pos.shifts` row: `is_closed = true`, `discrepancy = 33.0000` (positive = cash over)
- `z_report_data` contains:
  - `opening_float: 100.0000`, `closing_float: 148.0000`, `expected_float: 115.0000`, `discrepancy: 33.0000`
  - `total_sales_usd: 31.2500` (5 cash + 3 KHQR sales)
  - `total_refunds_usd: 5.0000`
  - `tender_breakdown`: cash (5), KHQR (3)
  - `cart_count: 8` (5 + 3 sales)
- 3 `pos.sessions` rows (Sokha start, Dara, Sokha return), all `is_active = false`
- Z-report printable and matches actual shift activity

##### Fallback / Rollback
- If `locked` carts exist at close: reject with `E_LOCKED_CARTS_EXIST`. Cashier must resolve.
- If `open` carts exist: reject with `E_OPEN_CARTS_EXIST`. Convert to tabs or cancel.
- If discrepancy exceeds merchant threshold: alert manager (flag in Z-report).

##### References
- Part 5, §5.2.3 (shift open guards)
- Part 5, §5.2.4 (active session management)
- Part 5, §5.2.5 (close reconciliation flow)
- Part 5, §5.2.6 (Z-report data schema)
- Part 6, §6.2.3 (`pos.shifts` DDL with `opening_float`, `closing_float`, `expected_float`, `discrepancy`, `z_report_data`)

---

#### QA-12: Cash Discrepancy Detection (Expected ≠ Actual)

| Attribute | Value |
|---|---|
| **ID** | QA-12 |
| **Category** | Shift |
| **Vertical** | Both |
| **Severity** | High |
| **Type** | Adversarial |

##### Preconditions
- Active shift with known opening float
- Multiple cash transactions processed
- Simulate cash drawer discrepancy (theft, miscount, or error)

##### Steps
1. Shift opens with `opening_float = 50.0000` (USD) = ៛200,000.
2. System records 10 cash sales totaling `cash_sales = 75.0000` (USD) = ៛300,000.
3. System records 2 cash refunds totaling `cash_refunds = 10.0000` (USD) = ៛40,000.
4. Compute expected: `expected_float = 50.0000 + 75.0000 - 10.0000 = 115.0000` (USD) = ៛460,000.
5. **Adversarial:** Cashier counts drawer and enters `closing_float = 105.0000` (USD) = ៛420,000 (short by ៛40,000).
6. Discrepancy: `discrepancy = 105.0000 - 115.0000 = -10.0000` (USD) = ៛-40,000.
7. Shift closes. Z-report flags discrepancy.

##### Expected Results
- `discrepancy = -10.0000` (negative = cash short)
- Z-report highlights discrepancy in red
- Manager receives alert: "Cash discrepancy detected: ៛40,000 short"
- `z_report_data.discrepancy_flag = true`
- Shift closes despite discrepancy (merchant decides if investigation needed)
- Discrepancy logged in `pos.shifts.discrepancy` for historical reporting

##### Fallback / Rollback
- Cashier can recount and update `closing_float` before final close (no shift close yet).
- Manager can override and force close with note in `metadata`.
- If discrepancy pattern repeats across shifts: system flags for investigation.

##### References
- Part 5, §5.2.5 (close reconciliation flow — step 4: compute discrepancy)
- Part 6, §6.2.3 (`pos.shifts.discrepancy` column)

---

#### QA-13: Auto-Lock After Inactivity, Session Resume with Re-Auth

| Attribute | Value |
|---|---|
| **ID** | QA-13 |
| **Category** | Shift |
| **Vertical** | Both |
| **Severity** | Medium |
| **Type** | Happy Path |

##### Preconditions
- Active shift and session
- `last_activity_at` tracking enabled
- Auto-lock threshold: 5 minutes (Part 10, §10.4.5)

##### Steps
1. Cashier Sokha starts session at 08:00. `last_activity_at = 08:00`.
2. Sokha processes sales continuously. `last_activity_at` updates each interaction.
3. At 10:15, Sokha steps away. No activity.
4. Scheduled job runs at 10:20: `last_activity_at = 10:15` < `now() - 5 minutes` → **auto-lock triggered**.
5. UPDATE `pos.sessions`: `is_active = false`, `ended_at = 10:20:00`.
6. Any `open` carts linked to Sokha's session: `session_id = NULL` (tab-like survival).
7. Customer tries to interact with T1: screen shows "Session locked — please re-authenticate."
8. Sokha returns at 10:25, re-authenticates (PIN/badge).
9. Edge function checks: same shift still open → resume.
10. INSERT new `pos.sessions` row (or reactivate): `account_id = Sokha`, `is_active = true`.

##### Expected Results
- Original session: `is_active = false`, `ended_at` populated
- Cart that was open: `session_id = NULL`, `cart_status = 'open'` (survived)
- New session: `is_active = true`, `started_at = 10:25`
- No data loss, no cart corruption
- Re-auth time < 3 seconds

##### Fallback / Rollback
- If shift closed while Sokha was away: re-auth fails with "Shift closed. Open new shift to continue."
- If another staff member started a session on same register: Sokha's new session starts after current one ends.

##### References
- Part 10, §10.4.5 (auto-lock after inactivity — 5 minutes)
- Part 10, §10.4.4 (session lifecycle)
- Part 5, §5.2.4 (active session management)
- Part 6, §6.2.3 (`pos.sessions.last_activity_at`, `pos.sessions.is_active`)

---

#### QA-14: Open Carts on Shift Close — Handling Policy

| Attribute | Value |
|---|---|
| **ID** | QA-14 |
| **Category** | Shift |
| **Vertical** | Both |
| **Severity** | High |
| **Type** | Adversarial |

##### Preconditions
- Active shift with multiple carts in various states
- Manager attempting to close shift

##### Steps
1. Shift has 5 carts:
   - Cart A: `cart_status = 'open'`, linked to active tab (customer still ordering)
   - Cart B: `cart_status = 'open'`, not linked to tab (abandoned)
   - Cart C: `cart_status = 'locked'`, KHQR payment in progress
   - Cart D: `cart_status = 'paid'`, waiting for invoice
   - Cart E: `cart_status = 'cancelled'`
2. Manager attempts shift close via `pos-shift-close`.

##### Expected Results (Per Cart Status)

| Cart | Status | Behavior |
|---|---|---|
| A | `open` + linked to tab | **Resolve before close.** Tab converted: `session_id = NULL`. Tab survives shift. |
| B | `open` + no tab | **Resolve before close.** Manager cancels or converts to tab. Close rejected with `E_OPEN_CARTS_EXIST`. |
| C | `locked` | **Blocked.** Close rejected with `E_LOCKED_CARTS_EXIST`. Must unlock, complete, or cancel. |
| D | `paid` | **Allowed.** Paid carts survive shift close. Invoice created normally. |
| E | `cancelled` | Ignored. No financial impact. |

- Step-by-step resolution:
  1. Manager tries close → rejected `E_LOCKED_CARTS_EXIST` (Cart C).
  2. Manager unlocks Cart C → `cart_status = 'open'`. Cancels Cart C.
  3. Manager tries close → rejected `E_OPEN_CARTS_EXIST` (Carts A, B).
  4. Manager converts Cart A to tab (sets `session_id = NULL`), cancels Cart B.
  5. Manager tries close → **accepted**. Shift closes.

##### Fallback / Rollback
- If manager forces close (override_operations permission): all remaining open carts auto-cancelled, logged in `metadata`.
- If shift cannot be closed after 3 attempts: alert owner, keep shift open.

##### References
- Part 5, §5.2.5 (close reconciliation flow — what happens to open carts)
- Part 5, §5.5.1 (tab survival across shift change)
- Part 6, §6.2.3 (`pos.carts.cart_status` enum, `pos.carts.tab_id`)

---

#### QA-15: Modifier Propagation — Required Modifier Missing (Must Block)

| Attribute | Value |
|---|---|
| **ID** | QA-15 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Negative |

##### Preconditions
- Café store with modifier groups configured
- Menu item "Iced Coffee" linked to modifier group "Sugar Level" (`is_required = true`, `selection_type = 'pick_one'`)
- Modifiers in group: "50% Sugar", "30% Sugar", "No Sugar"

##### Steps
1. Cashier creates cart.
2. Cashier adds "Iced Coffee" to cart **without selecting any sugar level**.
3. Edge function `cafe-modifier-validate` processes:
   - Item has modifier group "Sugar Level" with `is_required = true`
   - No selection provided for this group
   - **Rule violation:** Required modifier missing
4. Edge function returns `{ valid: false, errors: [{ modifier_group_id: '...', error_code: 'E_MODIFIER_REQUIRED' }] }`.
5. `pos-cart-line-add` rejects the line addition.

##### Expected Results
- Cart line NOT created
- Cashier sees error: "Sugar Level is required. Please select an option."
- `pos.cart_lines` has 0 rows for this cart
- Cart `grand_total` unchanged
- Cashier must select a sugar level before line can be added

##### Fallback / Rollback
- Cashier selects sugar level, retries line add → succeeds.
- If modifier group should not be required: manager updates `is_required = false` in `cafe.modifier_groups`.

##### References
- Part 5, §5.5.3 (modifier application — required modifier constraint)
- Part 6, §6.2.6 (`cafe.modifier_groups.is_required`, `menu.item_modifier_groups.is_required`)
- Part 6, §6.3 enum #18 (modifier_requirement)

---

#### QA-16: T4 Slot Assignment → Realtime Broadcast → T5 Queue Display

| Attribute | Value |
|---|---|
| **ID** | QA-16 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Café store with T4 DDS and T5 QDS registers configured
- Café order at `order_status = 'ready_for_pickup'`
- T5 QDS connected and subscribed to Realtime channel `cafe:store:{store_id}`
- Slot numbers 1–10 configured

##### Steps
1. Order O reaches `ready_for_pickup` (T3 completed prep).
2. T4 expediter views order on DDS screen.
3. Expediter assigns slot number 3 via `cafe-order-assign-slot`:
   - Input: `order_id = O`, `slot_number = 3`
   - Validation: `order_status = 'ready_for_pickup'` (pass), slot 3 not assigned to another active order (pass), caller has `process_sales` permission (pass)
4. Edge function updates `ops.cafe_orders`: `slot_number = 3`.
5. Edge function broadcasts via Supabase Realtime:
   - Channel: `cafe:store:{store_id}`
   - Payload: `{ event: 'slot_assigned', order_id: O, slot_number: 3, order_number: 'ORD-42', items_summary: 'Iced Latte, Croissant' }`
6. T5 QDS receives broadcast, updates display:
   - Slot 3 shows "ORD-42 — Iced Latte, Croissant — READY"
   - Queue display reorders by slot assignment time.

##### Expected Results
- `ops.cafe_orders.slot_number = 3` for order O
- T5 QDS display shows slot 3 assignment within 2 seconds of broadcast
- Realtime payload contains all required fields: `order_id`, `slot_number`, `order_number`, `items_summary`
- If another order was in slot 3: validation fails with `E_SLOT_OCCUPIED`

##### Fallback / Rollback
- If Realtime connection drops: T5 shows last known state. Reconnects automatically.
- If slot assignment wrong: expediter reassigns (updates `slot_number`, broadcasts new event).
- If T5 is offline: broadcast queued, delivered on reconnect.

##### References
- Part 5, §5.5.5 (slot assignment on T4 — exact flow)
- Master Context, §7 (Realtime channel: `cafe:store:{store_id}`)
- Part 6, §6.2.7 (`ops.cafe_orders.slot_number`)

---

#### QA-17: HSAL Delivery Trigger After T4 Slot Assignment

| Attribute | Value |
|---|---|
| **ID** | QA-17 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Café order with `service_mode = 'delivery'`, `origin_channel = 'tma'`
- Order at `ready_for_pickup`, slot assigned
- HSAL API endpoint reachable
- Customer phone number in `cart.customer_phone`

##### Steps
1. Order O (TMA delivery) reaches `ready_for_pickup`.
2. T4 expediter assigns slot 5.
3. Edge function `cafe-order-assign-slot` detects `service_mode = 'delivery'`.
4. After slot assignment, edge function calls `hsal-booking-create`:
   - Payload:
     ```json
     {
       "store_location": { "lat": 11.5564, "lng": 104.9282, "address": "St. 240, Phnom Penh" },
       "customer_phone": "+85512345678",
       "customer_name": "Sokha",
       "slot_number": 5,
       "order_summary": {
         "invoice_number": "INV-CAFE1-20260529-0042",
         "item_count": 2,
         "total_khr": 25000
       },
       "pickup_instructions": "TMA delivery order"
     }
     ```
5. HSAL `/book-delivery` API returns success:
   - Response: `{ booking_id: 'HSAL-789', driver_eta_minutes: 15, status: 'assigned' }`
6. Edge function updates `ops.cafe_orders.metadata`: `hsal_booking_id = 'HSAL-789'`.

##### Expected Results
- `ops.cafe_orders.metadata->>'hsal_booking_id' = 'HSAL-789'`
- HSAL API called exactly once (idempotency: check `metadata.hsal_booking_id` before calling)
- If booking already exists: return existing reference, no duplicate call
- Driver ETA displayed on T4 DDS

##### Fallback / Rollback
- HSAL API fails: retry 3× with exponential backoff. If all fail: alert manager, order remains `ready_for_pickup`.
- HSAL API timeout: same retry logic. Order not blocked.
- If `service_mode ≠ 'delivery'`: HSAL NOT triggered (dine_in/takeaway orders).

##### References
- Part 5, §5.5.6 (HSAL delivery trigger — exact payload and flow)
- Master Context, §7 (HSAL trigger: after T4 slot assignment, if `service_mode = 'delivery'`)
- Part 6, §6.2.7 (`ops.cafe_orders.metadata`)

---

#### QA-18: Tab Survives Shift Change, Tab Close on Next Shift

| Attribute | Value |
|---|---|
| **ID** | QA-18 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | Medium |
| **Type** | Happy Path |

##### Preconditions
- Café store with tab support enabled
- Tab T-12 open with 2 linked carts (1 paid, 1 open)
- Shift 1 active

##### Steps
1. Tab T-12 (`tab_status = 'open'`) has:
   - Cart A: `paid`, `total_paid_khr = 30000`
   - Cart B: `open`, `grand_total_khr = 20000`, linked to session S1
   - Tab balance: `balance_due_khr = 20000`
2. Shift 1 closes. Pre-close check:
   - Cart B is `open` but linked to tab T-12.
   - `session_id` set to `NULL` (tab survival).
   - Tab T-12 itself is unaffected.
3. Shift 2 opens next morning.
4. Customer returns to settle tab.
5. Cashier links Cart B to new session, processes cash tender for ៛20,000.
6. Cart B → `paid`. Tab balance: `balance_due_khr = 0`.
7. Cashier closes tab T-12 via `cafe-tab-close`:
   - Validation: `balance_due = 0` (pass)
   - UPDATE `cafe.tabs`: `tab_status = 'closed'`, `closed_at = now()`, `closed_by = cashier`

##### Expected Results
- Tab T-12 survives shift 1 close → shift 2 open transition
- `cafe.tabs.tab_status = 'closed'` after step 7
- Cart B invoiced normally during shift 2
- `balance_due_khr = 0` at tab close
- All cart history preserved (Cart A + Cart B)

##### Fallback / Rollback
- If customer never returns: tab remains `open`. Manager can cancel after policy period.
- If balance ≠ 0 on close attempt: reject with `E_TAB_BALANCE_NOT_ZERO`.
- Only `manager`+ can cancel a tab. Cashier can close (balance = 0) but cannot cancel.

##### References
- Part 5, §5.5.1 (tab lifecycle — survives shift change)
- Part 5, §5.2.5 (open carts on shift close — tab conversion)
- Part 6, §6.2.6 (`cafe.tabs` DDL — `tab_status`, `balance_due`, `total_ordered`, `total_paid`)



---

#### QA-19: RLS Tenant Isolation — Cross-Tenant Data Leak Attempt

| Attribute | Value |
|---|---|
| **ID** | QA-19 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Two tenants: Tenant A ("Cafe Phnom Penh") and Tenant B ("Laundry Siem Reap")
- Account Alice belongs to Tenant A with `manager` role
- Alice has valid JWT for Tenant A
- Alice knows (or guesses) a `store_id`, `cart_id`, or `invoice_id` from Tenant B

##### Steps
1. Alice authenticates with Tenant A JWT. `tenant_id = A` in claims.
2. Alice crafts a malicious request to read Tenant B data:
   - Attempt 1: `SELECT * FROM pos.carts WHERE store_id = '{tenant_B_store_id}'` via Supabase client (bypassing edge function)
   - Attempt 2: Direct REST API call with Tenant A JWT but Tenant B `store_id` in query params
   - Attempt 3: Supabase Realtime subscription to `cafe:store:{tenant_B_store_id}`
3. RLS policy evaluates each attempt:
   ```
   USING (core.is_service_role() OR tenant_id = core.current_tenant_id())
   ```
   - `core.is_service_role()` → false (Alice is authenticated, not service_role)
   - `tenant_id = core.current_tenant_id()` → `B = A` → false
4. RLS denies all rows. Alice sees empty result set.

##### Expected Results
- All 3 attempts return **zero rows**. No data leaked.
- No error thrown (RLS silently filters — prevents information disclosure via error differentiation)
- Edge function calls with cross-tenant IDs: return `E_UNAUTHORIZED` or `E_NOT_FOUND` (same message for both to prevent ID enumeration)
- Attempt to subscribe to Realtime channel of another tenant: subscription denied
- Log entry created: `security_event: cross_tenant_access_attempt, account_id: Alice, target_tenant: B`

##### Fallback / Rollback
- If RLS is accidentally disabled on any table: **immediate P0 incident**. All traffic blocked until RLS re-enabled.
- If `core.is_service_role()` check missing: service_role bypass fails, edge functions break.
- Consistency Auditor must verify ALL 32 tenant-scoped tables have RLS enabled per Part 6, §6.1.4.

##### References
- Part 10, §10.3.1 (canonical RLS policy pattern)
- Part 10, §10.3.3 (service role bypass — when and why)
- Part 6, §6.1.4 (RLS policy template — exact SQL)
- Part 6, §6.2.3 (all tenant-scoped tables with RLS)
- Master Context, §2 P7 (RLS mandatory — no exceptions)

---

#### QA-20: RBAC Permission Bypass — Cashier Tries Manager Action

| Attribute | Value |
|---|---|
| **ID** | QA-20 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Account Bob with `membership_role = 'cashier'` in Tenant A
- Bob has valid JWT, active session
- Bob knows (or crafts) API calls for manager-only operations

##### Steps
Bob attempts the following manager-only operations:

| # | Operation | Edge Function | Required Role | Bob's Role |
|---|---|---|---|---|
| 1 | Process refund | `pos-refund-full` | `owner`, `manager` | `cashier` |
| 2 | Cancel a tab | `cafe-tab-cancel` | `owner`, `manager` | `cashier` |
| 3 | Override price | Price override flag | `owner`, `manager` | `cashier` |
| 4 | View all financials | `pos-invoice-get` (any store) | `owner`, `manager` | `cashier` |
| 5 | Manage staff | `cp-member-invite` | `owner`, `manager` | `cashier` |
| 6 | Resolve sync conflicts | `pos-offline-sync-resolve` | `owner`, `manager` | `cashier` |
| 7 | Modify menu | `menu-item-create` | `owner`, `manager` | `cashier` |

1. Bob crafts and sends request #1 (refund) with his valid JWT.
2. Edge function `authorize()` extracts `membership_role = 'cashier'` from JWT.
3. Checks permission matrix (Part 10, §10.2.2): `process_refund` requires `owner` or `manager`.
4. `cashier` not in allowed roles → returns `E_UNAUTHORIZED`.

##### Expected Results
- All 7 attempts return `{ error: 'E_UNAUTHORIZED', message: 'Insufficient permissions' }` with HTTP 403
- **Zero** database mutations occur on any denied attempt
- No partial writes (edge function validates authorization before any INSERT/UPDATE)
- `security_event` log entry for each bypass attempt
- After 5 failed attempts from same account within 10 minutes: temporary rate limit applied

##### Fallback / Rollback
- If edge function has a logic bug allowing partial authorization: consistency check catches it.
- If permission matrix is misconfigured (e.g., `cashier` accidentally listed for `process_refund`): Business Logic Agent must correct RBAC matrix in Part 10.
- **Escalation to Business Logic:** If any scenario reveals a missing guard, request logic guard via standard escalation path.

##### References
- Part 10, §10.2.2 (permission matrix — roles × operations)
- Part 10, §10.4.7 (edge function authorization check)
- Part 10, §10.2.3 (special permission rules — refund, tab cancel, price override)

---

#### QA-21: Cart State Machine Invalid Transition Attempt

| Attribute | Value |
|---|---|
| **ID** | QA-21 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Active shift and session
- Cart C in known state
- Attacker has valid JWT (any role) and crafts direct state-change requests

##### Steps
Attacker attempts the following **invalid** state transitions:

| # | Invalid Transition | Current State | Attack Vector |
|---|---|---|---|
| 1 | `open` → `refunded` | `open` | Directly set `cart_status = 'refunded'` |
| 2 | `open` → `paid` | `open` | Skip locking and tender — set `cart_status = 'paid'` |
| 3 | `cancelled` → `paid` | `cancelled` | Revive cancelled cart to paid |
| 4 | `locked` → `refunded` | `locked` | Refund before payment captured |
| 5 | `paid` → `open` | `paid` | Reopen paid cart for editing |
| 6 | `paid` → `locked` | `paid` | Re-lock paid cart |
| 7 | `refunded` → `paid` | `refunded` | Re-activate refunded cart |
| 8 | `open` → `finalized` | `open` | Skip `locked` and `paid` |
| 9 | `failed` → `paid` | `failed` | Directly pay failed cart (no tender) |
| 10 | `locked` → `cancelled` (with captured tender) | `locked` | Cancel after partial payment |

1. For each transition, attacker sends crafted request to edge function (or direct SQL if RLS bypassed).
2. Edge function validates transition against state machine (Part 5, §5.1.2).
3. Invalid transitions rejected.

##### Expected Results
- All 10 attempts return `{ error: 'E_INVALID_TRANSITION', from: '{state}', to: '{state}', allowed_transitions: [...] }`
- **Zero** state changes occur on any attempt
- `pos.carts.cart_status` remains unchanged for all carts
- `security_event` log entries for transition bypass attempts
- If direct SQL UPDATE attempted (bypassing edge function): RLS allows write (same tenant) but edge function is the **only** legitimate writer — any direct SQL modification is a violation detected by audit log.

##### Fallback / Rollback
- If state machine validation missing from any edge function: critical bug. All cart operations must validate transitions.
- Database-level CHECK constraint on `cart_status` provides final guardrail:
  ```sql
  CHECK (cart_status IN ('open','locked','paid','cancelled','refunded'))
  ```
  (Note: CHECK constraints cannot enforce transition rules, only valid values. Transition validation is application-layer.)

##### References
- Part 5, §5.1.2 (state diagram — all valid transitions)
- Part 5, §5.1.3 (transitions table with guards, triggers, error states)
- Part 6, §6.2.3 (`pos.carts.cart_status` CHECK constraint)
- Part 6, §6.3 enum #8 (cart_status allowed values)

---

#### QA-22: Refund After Receipt Printed

| Attribute | Value |
|---|---|
| **ID** | QA-22 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | High |
| **Type** | Happy Path |

##### Preconditions
- Cart C with `cart_status = 'paid'` or `finalized` (invoice exists, receipt printed)
- Manager account with `process_refund` permission
- Receipt exists in `sal.receipts` with `receipt_status = 'issued'`
- Within refund window (merchant policy)

##### Steps
1. Cart C: `grand_total_khr = 45000`, `cart_status = 'paid'`.
2. Invoice I and Receipt R created. Receipt printed at T1.
3. Customer returns with complaint. Manager initiates full refund via `pos-refund-full`.
4. Edge function validates:
   - `cart_status IN ('paid', 'finalized')` (pass)
   - Invoice exists and not already voided (pass)
   - Refund amount = `grand_total` (full refund) (pass)
   - Within refund window (pass)
   - Caller has `process_refund` permission (manager — pass)
5. Edge function:
   - INSERT new `pos.tenders` row: `tender_type = 'cash'`, `amount = -11.2500`, `amount_khr = -45000`, `tender_status = 'refunded'`
   - If electronic tender: call ABA PayWay refund API with `aba_payway_ref`
   - UPDATE `pos.carts` SET `cart_status = 'refunded'`
   - UPDATE `sal.sales_invoices` SET `invoice_status = 'voided'`, `voided_at = now()`, `voided_by = manager`
   - INSERT reversal receipt: `sal.receipts` with `receipt_status = 'issued'`, `invoice_data` showing negative amounts
6. Physical cash refunded to customer.

##### Expected Results
- Original `sal.sales_invoices` row: `invoice_status = 'voided'` (UPDATE allowed — only field that can change)
- Original `sal.receipts` row: unchanged (`receipt_status = 'issued'` — original receipt stays as audit trail)
- New reversal receipt created showing refund details
- New `pos.tenders` row with negative amount (append-only — never modifies original tender)
- `pos.carts.cart_status = 'refunded'`
- `ops.cafe_orders.order_status = 'cancelled'` (café only)

##### Fallback / Rollback
- If ABA PayWay refund fails: retry 3×. If all fail: alert manager, hold refund in pending state.
- If partial refund requested: `pos-refund-partial` creates negative tender, cart stays `paid`.
- If refund window expired: `E_REFUND_WINDOW_EXPIRED`.

##### References
- Part 5, §5.3.4 (refund flow — full and partial)
- Part 5, §5.1.3 (transition #13: `paid` → `refunded`, transition #14: `finalized` → `refunded`)
- Part 6, §6.2.4 (`sal.sales_invoices.invoice_status` — `final` → `voided`)
- Part 6, §6.2.4 (`sal.receipts.receipt_status` — original stays, reprint creates new row)
- Master Context, §2 P8 (append-only financials)

---

#### QA-23: Recipe Deduction at ready_for_pickup with Insufficient Stock

| Attribute | Value |
|---|---|
| **ID** | QA-23 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | Medium |
| **Type** | Adversarial |

##### Preconditions
- Café store with recipe-enabled menu item "Iced Latte"
- Recipe linked to `menu.items.recipe_id`
- Recipe requires: `milk: 200ml`, `espresso: 30ml`, `ice: 100g`
- Ingredient `milk`: `current_stock = 150ml`, `threshold_qty = 500ml`

##### Steps
1. Customer orders 1× "Iced Latte" (`cart_line.quantity = 1`).
2. Order progresses: `new` → `confirmed` → `preparing`.
3. T3 KDS marks order `ready_for_pickup`.
4. Edge function `cafe-order-ready` triggers recipe deduction:
   - Check `metadata->>'recipe_deducted'` → not set (first time)
   - Fetch `cafe.recipe_ingredients` for this recipe:
     - `milk: 200ml`, `espresso: 30ml`, `ice: 100g`
   - Compute deductions:
     - `milk_deduction = 200ml × 1 × (1 + 0) = 200ml`
     - `espresso_deduction = 30ml × 1 × (1 + 0) = 30ml`
     - `ice_deduction = 100g × 1 × (1 + 0) = 100g`
   - UPDATE `cafe.ingredients`:
     - `milk.current_stock = 150 - 200 = -50ml` → **negative stock**
     - `espresso.current_stock = current - 30`
     - `ice.current_stock = current - 100`
5. System detects `milk.current_stock < 0` after deduction.

##### Expected Results
- **Order NOT blocked.** Deduction proceeds, stock goes negative.
- **Warning logged:** `INGREDIENT_STOCK_NEGATIVE: milk = -50ml`
- **Manager alert:** Notification sent — "Iced Latte requires milk (200ml) but only 150ml in stock. Order completed with negative stock."
- `metadata->>'recipe_deducted' = 'true'` set on `ops.cafe_orders` (prevents double deduction)
- `cafe.ingredients.current_stock = -50` for milk
- Low-stock alert for milk: `current_stock <= threshold_qty` → reorder suggestion generated

##### Fallback / Rollback
- If merchant configures `block_on_negative_stock = true` (future setting): order blocked at `preparing` → `ready_for_pickup` transition. Manager override required.
- v1.0.0 default: allow negative stock, alert manager. Cambodia street-level reality: merchant may choose to complete order and restock later.
- Idempotency: if `recipe_deducted` already set, skip deduction entirely.

##### References
- Part 5, §5.5.4 (recipe deduction at `ready_for_pickup` — exact formula)
- Part 6, §6.2.6 (`cafe.ingredients.current_stock`, `threshold_qty`)
- Part 6, §6.2.6 (`cafe.recipe_ingredients.quantity`, `wastage_pct`)

---

#### QA-24: Cross-Vertical Isolation — Laundry Store Accessing Café Features

| Attribute | Value |
|---|---|
| **ID** | QA-24 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Tenant with two stores: Store L (`vertical_type = 'laundry'`) and Store C (`vertical_type = 'cafe'`)
- Account Charlie has `manager` role on Store L
- Charlie attempts to access café-specific features using Store L context

##### Steps
Charlie attempts the following café operations from the laundry store context:

| # | Café Feature | Edge Function | Store Context | Expected Result |
|---|---|---|---|---|
| 1 | Open a tab | `cafe-tab-open` | Store L (laundry) | `E_VERTICAL_MISMATCH` |
| 2 | Add modifier | `cafe-modifier-validate` | Store L (laundry) | `E_VERTICAL_MISMATCH` |
| 3 | View café orders | Query `ops.cafe_orders` | Store L (laundry) | Empty result (no café orders for laundry) |
| 4 | Assign T4 slot | `cafe-order-assign-slot` | Store L (laundry) | `E_VERTICAL_MISMATCH` |
| 5 | Create recipe | `cafe-recipe-create` | Store L (laundry) | `E_VERTICAL_MISMATCH` |
| 6 | Subscribe to Realtime `cafe:store:L` | Supabase Realtime | Store L (laundry) | Channel empty — no café orders |

1. Charlie opens seller portal, selects Store L.
2. Charlie navigates to "Tabs" (café-only feature).
3. Edge function checks: `store.vertical_type = 'laundry'`, but operation requires `'cafe'`.
4. All requests rejected.

##### Expected Results
- All 6 attempts fail with `E_VERTICAL_MISMATCH` or empty results
- No café data created for laundry store
- No café tables modified
- Edge functions validate `store.vertical_type` against operation requirements
- UI does not show café-specific navigation items when `vertical_type = 'laundry'`

##### Fallback / Rollback
- If edge function missing vertical check: potential data pollution. Audit detects café orders for laundry store → alert.
- Schema-level: `cafe.*` tables have `tenant_id` RLS but no `vertical_type` constraint. Vertical isolation is application-layer.
- Master Context §2 P1 enforced: 1 Store = 1 Vertical, immutable.

##### References
- Master Context, §2 P1 (1 Store = 1 Vertical, immutable)
- Master Context, §4 (Store definition: carries immutable `vertical_type`)
- Part 6, §6.2.2 (`pos.stores.vertical_type` CHECK constraint)
- Part 6, §6.3 enum #1 (`vertical_type` values)

---

#### QA-25: Edge Function Idempotency Collision — Rapid Duplicate Requests

| Attribute | Value |
|---|---|
| **ID** | QA-25 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Load generator configured to fire 50 identical requests in < 100ms
- Same idempotency key: `DEV001_0999_1716979200`
- Same payload: create cart with 1× Americano
- Edge function `pos-cart-create` as target

##### Steps
1. Load generator fires 50 concurrent `POST` requests to `pos-cart-create`.
2. All 50 requests carry identical idempotency key and identical payload.
3. Edge function processing:
   - Request #1–#50 hit the edge function nearly simultaneously.
   - Each checks `SELECT FROM pos.carts WHERE idempotency_key = 'DEV001_0999_1716979200'`.
   - None find existing row (first INSERT hasn't committed yet).
   - All 50 attempt `INSERT pos.carts`.
4. Database enforces `UNIQUE(idempotency_key)` constraint.
   - Request #1: INSERT succeeds.
   - Requests #2–#50: unique violation raised.
5. Edge function catches violation, returns existing cart (Request #1's cart).

##### Expected Results
- **Exactly 1** `pos.carts` row created
- **Exactly 1** success response (HTTP 200 with cart data)
- **49** responses return HTTP 200 with same cart data + `idempotency_collision: true` flag
- No 500 errors, no database constraint violation exposed to client
- Total processing time for all 50 requests < 2 seconds (idempotency is fast path)

##### Fallback / Rollback
- If unique constraint missing: **50 duplicate carts created** → P0 incident.
- If edge function returns 500 on unique violation: client retries → more load → cascading failure.
- If edge function returns different data for collision responses: client confusion → data inconsistency.

##### References
- Part 5, §5.1.4 (idempotency on cart operations — collision behavior)
- Part 6, §6.2.3 (`pos.carts.idempotency_key UNIQUE`)
- Master Context, §2 P9 (idempotency required)

---

#### QA-26: Supabase Realtime T4→T5 Broadcast Failure and Fallback

| Attribute | Value |
|---|---|
| **ID** | QA-26 |
| **Category** | Café |
| **Vertical** | Café |
| **Severity** | High |
| **Type** | Adversarial |

##### Preconditions
- T4 DDS and T5 QDS both operational
- Supabase Realtime service intermittent (simulated via network partition)
- Multiple orders at `ready_for_pickup` awaiting slot assignment

##### Steps
1. T4 assigns slot 2 to order O1. Broadcasts via Realtime.
2. **Realtime connection drops** (simulated network partition to Supabase).
3. T4 assigns slot 4 to order O2. Broadcast fails (no Realtime connection).
4. Edge function detects broadcast failure.
5. **Fallback path activated:**
   - Broadcast payload stored in `ops.cafe_orders.metadata->>'pending_broadcasts'` queue
   - T5 QDS periodically polls `ops.cafe_orders` for `ready_at > last_check` as fallback
6. T5 QDS receives O1 via Realtime (before drop), then polls and receives O2 via HTTP fallback.
7. Realtime reconnects.
8. Pending broadcasts flushed from queue to Realtime.

##### Expected Results
- T5 QDS eventually displays **both** O1 (slot 2) and O2 (slot 4), regardless of Realtime failure
- No orders lost due to broadcast failure
- Maximum display latency via fallback: 10 seconds (poll interval)
- `metadata->>'pending_broadcasts'` cleared after successful flush
- T4 DDS always shows correct state (local to T4, no broadcast dependency)

##### Fallback / Rollback
- If both Realtime AND HTTP polling fail: T5 shows stale data. Alert generated.
- If T5 is offline: broadcast queued in Supabase, delivered on T5 reconnect (Supabase Realtime replay).
- If broadcast payload corrupted: validation rejects, log error, T5 ignores invalid payload.

##### References
- Part 5, §5.5.5 (slot assignment — Realtime broadcast)
- Master Context, §7 (Realtime channel: `cafe:store:{store_id}`)
- Part 6, §6.2.7 (`ops.cafe_orders.metadata`)

---

#### QA-27: Cart→Invoice→Receipt Append-Only Guarantee Enforcement

| Attribute | Value |
|---|---|
| **ID** | QA-27 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Paid cart with existing invoice and receipt
- Attacker with database access (compromised service_role key or SQL injection)
- Attempt to modify append-only financial records

##### Steps
Attacker attempts the following mutations on append-only tables:

| # | Target Table | Attack | Expected Result |
|---|---|---|---|
| 1 | `sal.sales_invoices` | `UPDATE grand_total = 0 WHERE id = '{invoice_id}'` | **Blocked.** Edge function is only writer. No UPDATE API. Direct SQL bypasses edge function but RLS/service_role audit catches it. |
| 2 | `sal.sales_invoices` | `DELETE FROM sal.sales_invoices WHERE id = '{invoice_id}'` | **Blocked.** No DELETE API. Audit log violation. |
| 3 | `sal.receipts` | `UPDATE receipt_status = 'voided' WHERE id = '{receipt_id}'` | **Blocked for original receipt.** Voiding requires creating a NEW reversal receipt row. Original receipt never modified. |
| 4 | `pos.tenders` | `UPDATE amount = 0 WHERE id = '{tender_id}'` | **Blocked.** `amount` is immutable after INSERT. Only `tender_status` can progress. |
| 5 | `pos.tender_attempts` | `UPDATE status = 'failed' WHERE id = '{attempt_id}'` | **Blocked.** Database trigger rejects ALL UPDATE on this table. Pure INSERT-only. |
| 6 | `sal.receipts` | Reprint receipt via `pos-receipt-create` | **Allowed.** Creates NEW row with `receipt_status = 'reprinted'`, `original_receipt_id` pointing to original. Original unchanged. |

1. Attacker sends direct SQL UPDATE on `sal.sales_invoices`.
2. If using service_role: operation succeeds at DB level (RLS bypassed) but **audit log** captures it.
3. Alert fired: `AUDIT_VIOLATION: direct SQL modification of append-only table sal.sales_invoices`

##### Expected Results
- All UPDATE/DELETE attempts on append-only financial tables detected and alerted
- Original records remain intact
- Only legitimate append operations succeed (INSERT new rows)
- `pos.tender_attempts` has database-level trigger rejecting ALL UPDATE (Part 5, §5.6.4)
- Invoice `invoice_status` can only change `final` → `voided` (not any other mutation)

##### Fallback / Rollback
- If audit log is compromised: **disaster recovery** from WAL (Write-Ahead Log) and Supabase backups.
- If service_role key leaked: rotate key immediately, revoke old key, audit all service_role access.
- Consistency Auditor runs nightly check comparing `sal.sales_invoices` row counts against `pos.carts` paid cart count.

##### References
- Part 5, §5.6.4 (financial append-only guarantees table)
- Master Context, §2 P8 (append-only financials — never overwritten)
- Part 6, §6.2.4 (`sal.sales_invoices` — no `updated_at`, append-only design)
- Part 6, §6.2.3 (`pos.tender_attempts` — append-only, trigger rejects UPDATE)

---

#### QA-28: Service Role Bypass — Unauthorized Edge Function Access Attempt

| Attribute | Value |
|---|---|
| **ID** | QA-28 |
| **Category** | Security |
| **Vertical** | Both |
| **Severity** | Critical |
| **Type** | Adversarial |

##### Preconditions
- Attacker has obtained `service_role` JWT (simulated leak)
- Attacker attempts to use service_role to access cross-tenant data or bypass authorization
- All edge functions validate `service_role` usage independently

##### Steps
1. Attacker crafts request with `service_role` JWT.
2. Attacker attempts cross-tenant operations:
   - Read carts from Tenant A while authenticated as service_role for Tenant B
   - Modify `cp.tenants.subscription_tier` (billing operation)
   - Access `cp.accounts` rows not belonging to their tenant
3. Edge function `authorize()` detects `role = 'service_role'` in JWT.
4. Edge function applies **independent validation** before executing:
   - Cross-tenant check: `target_tenant_id` in request body validated against allowed tenants
   - Billing operations: additional webhook signature validation required
   - Account access: `account_id` validated against `cp.tenant_memberships`

##### Expected Results
- **All unauthorized service_role requests rejected** despite RLS bypass
- Validation failure returns `E_UNAUTHORIZED` or `E_INVALID_SIGNATURE`
- `security_event` log entry: `service_role_abuse_attempt` with full request details
- Immediate alert to HET security team
- service_role usage logged in dedicated audit table with:
  - `edge_function_name`, `caller_ip`, `request_payload_hash`, `validation_result`

##### Fallback / Rollback
- If service_role key confirmed leaked: rotate via Supabase dashboard, update all edge function env vars.
- If attacker successfully used service_role: audit all operations from that key's JWT `iat` (issued-at) timestamp. Reverse any unauthorized changes from backups.
- HET internal `'admin'` role (Part 10, §10.1) has service_role-level access but is restricted to HET operators only.

##### References
- Part 10, §10.3.3 (service role bypass — when and why, security rule)
- Part 10, §10.4.7 (edge function authorization check)
- Master Context, §2 P7 (RLS mandatory — `core.is_service_role()` in policy)
- Part 6, §6.1.4 (RLS policy template with `core.is_service_role()`)



---

### §15.4 Coverage Matrix

#### §15.4.1 Scenarios × Features

| Scenario | Split Tender | KHQR Retry | Rotanak | Offline Sync | Shift Rec | Session | Modifier | Slot/T5 | HSAL | Tab | RLS | RBAC | State Machine | Idempotency |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| QA-01 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-02 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-03 | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| QA-04 | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| QA-05 | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| QA-06 | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-07 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| QA-08 | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-09 | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-10 | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-11 | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| QA-12 | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-13 | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-14 | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ● | ○ |
| QA-15 | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-16 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ |
| QA-17 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ | ○ | ○ | ● |
| QA-18 | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ |
| QA-19 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ |
| QA-20 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ |
| QA-21 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |
| QA-22 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ● |
| QA-23 | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-24 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-25 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| QA-26 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ○ | ○ | ○ |
| QA-27 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● |
| QA-28 | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ● | ○ | ○ |

**Legend:** ● = Primary focus | ○ = Secondary/touch | Empty = Not applicable

#### §15.4.2 Scenarios × Tables Tested

| Table | Scenarios Covering It |
|---|---|
| `cp.tenants` | QA-19, QA-24, QA-28 |
| `cp.accounts` | QA-11, QA-13, QA-19, QA-20, QA-28 |
| `cp.tenant_memberships` | QA-19, QA-20, QA-24, QA-28 |
| `pos.stores` | QA-19, QA-24 |
| `pos.registers` | QA-11, QA-13 |
| `pos.shifts` | QA-01, QA-08, QA-11, QA-12, QA-13, QA-14, QA-18 |
| `pos.sessions` | QA-01, QA-11, QA-13, QA-14 |
| `pos.carts` | QA-01–QA-09, QA-14, QA-18, QA-19, QA-21, QA-22, QA-25, QA-27 |
| `pos.cart_lines` | QA-01, QA-15, QA-23 |
| `pos.tenders` | QA-01–QA-07, QA-22, QA-27 |
| `pos.tender_attempts` | QA-01, QA-03, QA-04, QA-27 |
| `pos.offline_sync_batches` | QA-08–QA-10 |
| `pos.offline_sync_events` | QA-08–QA-10 |
| `sal.sales_invoices` | QA-01, QA-08, QA-22, QA-27 |
| `sal.receipts` | QA-01, QA-08, QA-22, QA-27 |
| `menu.items` | QA-01, QA-15, QA-23, QA-24 |
| `cafe.modifier_groups` | QA-15 |
| `cafe.modifiers` | QA-15 |
| `cafe.recipes` | QA-23 |
| `cafe.recipe_ingredients` | QA-23 |
| `cafe.ingredients` | QA-23 |
| `cafe.tabs` | QA-14, QA-18 |
| `ops.cafe_orders` | QA-01, QA-08, QA-16, QA-17, QA-22, QA-23, QA-26 |

#### §15.4.3 Scenarios × Severity Distribution

| Severity | Count | Scenario IDs |
|---|---|---|
| **Critical** | 13 | QA-01, QA-03, QA-05, QA-06, QA-07, QA-19, QA-20, QA-21, QA-24, QA-25, QA-27, QA-28 |
| **High** | 12 | QA-02, QA-04, QA-08, QA-09, QA-10, QA-11, QA-12, QA-14, QA-15, QA-16, QA-17, QA-22, QA-26 |
| **Medium** | 3 | QA-13, QA-18, QA-23 |

#### §15.4.4 Scenarios × Type Distribution

| Type | Count | Scenario IDs |
|---|---|---|
| **Happy Path** | 10 | QA-01, QA-02, QA-04, QA-08, QA-11, QA-16, QA-17, QA-18, QA-22 |
| **Negative** | 1 | QA-15 |
| **Boundary** | 2 | QA-05, QA-06 |
| **Adversarial** | 15 | QA-03, QA-07, QA-09, QA-10, QA-12, QA-14, QA-19, QA-20, QA-21, QA-23, QA-24, QA-25, QA-26, QA-27, QA-28 |

---

### §15.5 Known Limitations & Escalations

#### §15.5.1 Test Coverage Gaps

The following areas are explicitly acknowledged as gaps in this matrix. They are deferred to post-MVP or require input from other agents.

| # | Gap | Reason | Escalation |
|---|---|---|---|
| 1 | **TMA (Telegram Mini App) signed `initData` validation** | TMA pre-order flow depends on Telegram Mini App infrastructure not yet documented in Part 7. | Awaiting Part 7 (Edge Function Specs) for `initData` verification contract. |
| 2 | **ABA PayWay refund API error codes** | Specific ABA error codes (network, insufficient funds, expired token) not documented in Part 4. | Awaiting Part 4 (External Contracts) for ABA PayWay error response schema. |
| 3 | **HSAL API failure modes** | HSAL `/book-delivery` timeout, 4xx/5xx responses, retry exhaustion not fully specified. | Awaiting Part 4 for HSAL contract. Scenario QA-17 covers happy path only. |
| 4 | **Rotanak API rate limiting** | Rotanak earn/redeem rate limits unknown. Could affect high-volume cafés. | Awaiting Part 4 for Rotanak contract. |
| 5 | **Hardware thermal throttling under load** | Pi 5 at 35°C+ ambient with sustained load may throttle. Not testable without physical hardware. | Architecture Agent to provide thermal test protocol in Part 11. |
| 6 | **Multi-store chain operations** | Chain portal (`kitluy-chain-portal`) out of MVP scope (Master Context §3). | Scope Critic — intentionally excluded. |
| 7 | **Mobile app form factors** | `kitluy-seller-app`, `kitluy-pos-mobile-app` out of MVP scope. | Scope Critic — intentionally excluded. |
| 8 | **Tax engine activation (future)** | v1.0.0 uses 0% Cambodia stub. Tax calculation pipeline tested but with zero rate. | Future version. Current tests validate pipeline structure, not tax math. |

#### §15.5.2 Logic Guards Requested from Business Logic

During scenario design, the following potential logic gaps were identified. These are formal requests for guards to be specified in Part 5 or Part 10.

| # | Request | Scenario | Current State | Requested Guard |
|---|---|---|---|---|
| RQ-1 | **Offline shift open conflict** | QA-09 | Server wins, cashier must re-open. | Define: does cashier lose all offline sales from that shift? Or are they re-linked? |
| RQ-2 | **Negative stock blocking** | QA-23 | Default: allow negative, alert manager. | Define: should this be a per-store setting (`allow_negative_stock boolean`)? |
| RQ-3 | **Refund window definition** | QA-22 | "Within refund window (merchant policy)" — not specified. | Define: default refund window (24 hours? 7 days? configurable per store?). |
| RQ-4 | **Cart lock timeout** | QA-03 | Cart stays `locked` until timeout or success. | Define: should there be a max lock duration (e.g., 10 minutes) that auto-unlocks? |
| RQ-5 | **Tab cancellation policy** | QA-18 | Manager can cancel tabs. | Define: time limit for tab cancellation (e.g., same day only?). |

#### §15.5.3 Test Execution Notes

| Note | Detail |
|---|---|
| **Automation priority** | QA-01, QA-03, QA-05, QA-06, QA-07, QA-19, QA-20, QA-21, QA-25, QA-27 must be automated in CI/CD. |
| **Manual testing** | QA-02 (3DS flow requires browser), QA-13 (inactivity timing), QA-16 (physical T4/T5 hardware) require manual or hardware-in-the-loop testing. |
| **Load testing** | QA-10 (reconnection burst) and QA-25 (idempotency collision) require load generation tools (k6/Artillery). |
| **Security auditing** | QA-19, QA-20, QA-24, QA-27, QA-28 require penetration testing or security audit tooling (e.g., OWASP ZAP). |
| **Regression suite** | All Critical severity scenarios (13 total) must pass before every release. |

---

### §15.6 Summary

| Metric | Value |
|---|---|
| **Total scenarios** | 28 |
| **Payment** | 7 (QA-01 – QA-07) |
| **Offline** | 3 (QA-08 – QA-10) |
| **Shift & Session** | 4 (QA-11 – QA-14) |
| **Café Operations** | 4 (QA-15 – QA-18) |
| **Security & RBAC** | 10 (QA-19 – QA-28) |
| **Critical severity** | 13 |
| **High severity** | 12 |
| **Medium severity** | 3 |
| **Happy Path** | 10 |
| **Negative** | 1 |
| **Boundary** | 2 |
| **Adversarial** | 15 |
| **Tables covered** | 22 of 22 (100%) |
| **State machines covered** | 4 of 4 (100%) |
| **RLS policy validation** | Yes (all 32 tenant-scoped tables) |
| **RBAC permission matrix validation** | Yes (all 5 roles × 18 operations) |

---

*End of Part 15: QA Matrix*

*Handoff: Consistency Auditor — validate all table names match Part 6, all state machine references match Part 5, all RBAC references match Part 10, all enum values match Part 6 §6.3.*

*Handoff: Rebuild Auditor — confirm all 28 scenarios can be executed by a stranger with zero prior context using only the Rebuild Bible.*


---


## Part 17: Module Inventory

**Version:** v1.0.0  
**Authority:** Implementation Agent  
**Date:** 29 May 2026  
**Status:** Canonical  
**Cross-references:** Master Context §3 (Scope), Part 6 (Schema), Part 7 (Edge Functions), Part 9 (Design System), Part 11 (Deployment & Infra)

---

### 17.0 Product Model — Four Products, Six Builds

KitLuy ships as **four logical products** delivered across **six builds**. Two of those products exist on two form factors each ("form-factor pairings"): the same logic layer and backend, a different presentation shell.

| # | Build | Platform | Audience | Scope | Pairing |
|---|---|---|---|---|---|
| 1 | `kitluy-admin-portal` | Web | Platform owner (HET) | All tenants — provisioning, subscriptions, billing, support, audit | — |
| 2 | `kitluy-chain-portal` | Web | Brand / chain / franchise owner | The **set** of shops/stores under a brand; central menu push; franchise structure (§5.7) | — |
| 3 | `kitluy-seller-portal` | Web | Individual shop owner | **One** shop/store | ↔ #4 |
| 4 | `kitluy-seller-app` | Mobile (RN+Expo) | Individual shop owner | One shop/store — mobile edition of the seller portal | = #3 |
| 5 | `kitluy-pos-desktop-app` | Desktop (Electron/Pi 5) | Store staff | The fixed terminals T1–T5 | ↔ #6 |
| 6 | `kitluy-pos-mobile-app` | Mobile (RN+Expo) | Store staff | A roaming register — mobile edition of the desktop POS | = #5 |

#### 17.0.1 The two form-factor pairings

- **Seller surface:** `kitluy-seller-portal` (web) and `kitluy-seller-app` (mobile) are **one product on two screens** — same scope (one shop), same backend, same logic. The app is the portal in the owner's pocket; not a stripped monitor. The mobile build adds native conveniences (push approvals for void/comp, pause/resume TMA) but no scope the web portal lacks.
- **POS surface:** `kitluy-pos-desktop-app` (Pi 5 fixed terminals) and `kitluy-pos-mobile-app` (handheld) are **one product on two screens** — same register logic, same order/payment flow, same vertical shell. Mobile is the line-busting / roaming T1-class register.

#### 17.0.2 Three-tier management hierarchy

```
PLATFORM OWNER (HET)
  └── kitluy-admin-portal ─────── provisions & bills every tenant
BRAND / CHAIN / FRANCHISE OWNER
  └── kitluy-chain-portal ─────── manages the SET of shops/stores (incl. franchise, §5.7)
INDIVIDUAL SHOP OWNER
  ├── kitluy-seller-portal (web)  ─┐ manages ONE shop/store
  └── kitluy-seller-app   (mobile)─┘  (form-factor pairing)
STORE STAFF (inside one shop)
  ├── kitluy-pos-desktop-app (Pi 5 terminals) ─┐ run the registers
  └── kitluy-pos-mobile-app  (handheld)        ─┘  (form-factor pairing)
```

Chain-portal manages **the shops**; seller-portal/app manages **the individual shop**; POS desktop/mobile **runs the counter**. Admin sits above all of it. When a brand owner drills into one shop from the chain-portal, they are handed that shop's **seller-portal view, scoped** (§5.7.4).

> **Build-table note:** the artifact inventory in §17.1 currently enumerates the backend, shared packages, and three of the six product builds (`admin-portal`, `seller-portal`, `pos-desktop-app`). The remaining three product builds — **`kitluy-chain-portal`** (web), **`kitluy-seller-app`** (mobile, pairs with seller-portal), and **`kitluy-pos-mobile-app`** (mobile, pairs with pos-desktop) — are first-class products per this model. They share the same edge-function backend (`kitluy-edge-functions`), `@kitluy/shared-ui`, and `@kitluy/shared-utils`; the two mobile builds are RN+Expo (EAS Build → Play Store + App Store) rather than web/Electron. Their repositories follow the same `github.com/het/{name}` convention.

---

### 17.1 Build Artifacts

#### 17.1.1 Inventory Table

| # | Module Name | Repository | Type | Tech Stack | Part Cross-Refs | Build Command |
|---|---|---|---|---|---|---|
| 1 | `kitluy-seller-portal` | `github.com/het/kitluy-seller-portal` | Web (React SPA) | React 18, TypeScript, Vite, TailwindCSS, Supabase JS client | Part 9 (Design System), Part 8 (formatKHR) | `npm ci && npm run build` |
| 2 | `kitluy-pos-desktop-app` | `github.com/het/kitluy-pos-desktop-app` | Desktop (Electron) | Electron 30, React 18, TypeScript, Vite, node-escpos, node-hid | Part 9 (Wireframe Constraints), Part 8 (formatKHR), Part 11 (Pi Imaging) | `npm ci && npm run build:electron && npm run package:arm64` |
| 3 | `kitluy-admin-portal` | `github.com/het/kitluy-admin-portal` | Web (React SPA) | React 18, TypeScript, Vite, TailwindCSS, Supabase JS client, Recharts | Part 9 (Admin Components), Part 10 (RBAC) | `npm ci && npm run build` |
| 4 | `kitluy-edge-functions` | `github.com/het/kitluy-edge-functions` | Edge (Deno) | Deno 1.42, Supabase Edge Runtime | Part 7 (all functions), Part 6 (schema) | `supabase functions deploy` |
| 5 | `@kitluy/shared-ui` | `packages/shared-ui` in seller-portal repo | Shared Package | React 18, TypeScript, TailwindCSS | Part 9 (Components), Part 8 (formatKHR) | `npm run build:shared` |
| 6 | `@kitluy/shared-utils` | `packages/shared-utils` in seller-portal repo | Shared Package | TypeScript (pure) | Part 8 (formatKHR, helpers) | `npm run build:shared` |
| 7 | `@kitluy/printer-driver` | `packages/printer-driver` in pos-desktop-app repo | Shared Package | TypeScript, node-usb, node-escpos | Part 9 (Receipt Templates) | `npm run build:printer` |
| 8 | `kitluy-hub-server` | `github.com/het/kitluy-hub-server` | Embedded Server | Deno 1.42, PostgreSQL 16 (local), rsync, cron | Part 11 (Deployment), Part 7 (Offline Functions) | `./build.sh` (ARM64 binary) |

#### 17.1.2 Module Descriptions

**`kitluy-seller-portal`** (Web Application)
- **Purpose:** Merchant-facing web portal for managing stores, menus, ingredients, viewing reports, and configuring settings. Accessed from any browser.
- **Not a POS terminal.** This is the back-office tool, not the in-store cashier interface.
- **Vertical support:** Laundry and Cafe (v1.0.0).
- **Key screens:** Dashboard, Menu Editor, Ingredient Manager, Shift Reports, Staff Management, Store Settings.
- **Deployment:** Static SPA on Vercel/Netlify. Supabase project `qneduoifcsvjajeqmvgb`.

**`kitluy-pos-desktop-app`** (Electron Desktop Application)
- **Purpose:** The actual POS terminal application running on T1-T5 Raspberry Pi hardware. This is the primary cashier interaction surface.
- **Multi-window:** Main window (T1 cashier), secondary window (T2 CDS via HDMI-2), KDS window (T3), DDS window (T4), QDS window (T5).
- **Hardware integration:** USB thermal printer (ESC/POS), USB barcode scanner (HID), touchscreen input.
- **Offline capability:** Local SQLite cache with Hub Server sync when online.
- **Platform:** Electron 30 on ARM64 (Pi 5). Uses `electron-builder` with `--arm64` target.

**`kitluy-admin-portal`** (Internal Dashboard)
- **Purpose:** HET internal operations dashboard for provisioning tenants, monitoring system health, managing subscriptions, and supporting merchants.
- **Access:** Restricted to `membership_role = 'admin'`. SSO via Supabase Auth.
- **Key screens:** Tenant List, Store Registry, System Health, Billing Dashboard, Support Tickets.

**`kitluy-edge-functions`** (Deno Edge Functions)
- **Purpose:** All server-side business logic. 40 functions documented in Part 7.
- **Deployment:** Supabase Edge Functions (`supabase functions deploy`).
- **Runtime:** Deno 1.42 on Supabase Edge Runtime ( isolates ).
- **Key dependency:** `supabase-js` for database access via `service_role` key.

**`@kitluy/shared-ui`** (Shared Component Library)
- **Purpose:** React components shared between seller-portal and admin-portal. NOT used by the POS desktop app (which has its own wireframe-renderer-constrained components).
- **Exports:** KHRDisplay, LoadingSpinner, OfflineIndicator, BaseModal, DataTable, Form components.
- **Bundle format:** ESM + CJS dual package.

**`@kitluy/shared-utils`** (Shared Utility Library)
- **Purpose:** Pure TypeScript utilities used across all JS/TS modules.
- **Exports:** `formatKHR`, date helpers, validation functions, idempotency key generator, exchange rate calculator.
- **Bundle format:** ESM + CJS. Zero runtime dependencies.

**`@kitluy/printer-driver`** (Printer Hardware Abstraction)
- **Purpose:** ESC/POS command generation, USB printer detection, and print job queuing.
- **Platform:** Node.js only (uses `node-usb` and `node-escpos`). Bundled with POS desktop app.
- **Exports:** `ThermalPrinter`, `LabelPrinter`, receipt template renderer, cup sticker template renderer.

**`kitluy-hub-server`** (On-Premises Sync Server)
- **Purpose:** Raspberry Pi 5 8GB Hub Server that coordinates T1-T5 terminals over LAN and syncs to Supabase cloud when WAN is available.
- **Key functions:** Local PostgreSQL replica, offline event queuing, conflict detection, batch sync to cloud.
- **Deployment:** Single ARM64 binary deployed via SD card image (Part 11).

---

### 17.2 Dependency Graph

#### 17.2.1 Module Dependency Matrix

```
                    +------------------------+
                    |  kitluy-edge-functions  |
                    |  (Deno / Supabase)      |
                    +-----------+------------+
                                |
            +-------------------+-------------------+
            |                   |                   |
            v                   v                   v
   +--------+-------+  +--------+-------+  +--------+-------+
   | seller-portal  |  | admin-portal   |  | pos-desktop-app |
   | (Web SPA)      |  | (Web SPA)      |  | (Electron ARM64) |
   +----------------+  +----------------+  +--------+-------+
           |                    |                    |
           v                    v                    v
   +----------------+  +----------------+  +----------------+
   | @kitluy/shared |  | @kitluy/shared |  | @kitluy/printer|
   | -ui            |  | -ui            |  | -driver        |
   +--------+-------+  +--------+-------+  +--------+-------+
            |                   |                    |
            +-------------------+                    |
            |                                        |
            v                                        v
   +----------------+                        +----------------+
   | @kitluy/shared |                        | kitluy-hub-server|
   | -utils         |                        | (Pi 5 8GB)      |
   +----------------+                        +--------+-------+
                                                      |
                                            +---------v---------+
                                            | Local PostgreSQL  |
                                            | (offline replica) |
                                            +-------------------+
```

#### 17.2.2 Dependency Details

**`kitluy-seller-portal` depends on:**
| Dependency | Reason |
|---|---|
| `@kitluy/shared-ui` | Reusable UI components (KHRDisplay, DataTable, Form inputs) |
| `@kitluy/shared-utils` | `formatKHR`, date utilities, validators |
| `kitluy-edge-functions` | All data operations via HTTP API calls |
| Supabase JS client | Auth (phone OTP), Realtime subscriptions |

**`kitluy-pos-desktop-app` depends on:**
| Dependency | Reason |
|---|---|
| `@kitluy/printer-driver` | ESC/POS thermal printing, label printing |
| `@kitluy/shared-utils` | `formatKHR`, date utilities |
| `kitluy-edge-functions` | All data operations via HTTP API |
| `kitluy-hub-server` | Local sync, offline queue |
| Electron 30 | Desktop shell, multi-window, hardware access |

**`kitluy-admin-portal` depends on:**
| Dependency | Reason |
|---|---|
| `@kitluy/shared-ui` | Reusable UI components |
| `@kitluy/shared-utils` | `formatKHR`, utilities |
| `kitluy-edge-functions` | Admin functions (`admin-*`) via HTTP API |
| Supabase JS client | Auth, Realtime |

**`kitluy-edge-functions` depends on:**
| Dependency | Reason |
|---|---|
| Supabase (PostgreSQL 17) | All data storage per Part 6 schema |
| Deno std library | HTTP server, crypto, encoding |
| ABA PayWay API | KHQR generation, card tokenization |
| Rotanak API | Loyalty profile, coin earn/redeem |
| HSAL API | Delivery booking |

**`kitluy-hub-server` depends on:**
| Dependency | Reason |
|---|---|
| Local PostgreSQL 16 | Offline data replica |
| `kitluy-edge-functions` | Sync target (cloud Supabase) |
| rsync | Binary log shipping |
| LAN | T1-T5 terminal connectivity |

---

### 17.3 Build Order

#### 17.3.1 Clean Build from Scratch

The following numbered sequence produces a working KitLuy v1.0.0 environment from zero. Each step must complete successfully before the next begins.

| Step | Action | Module | Command | Prerequisites |
|---|---|---|---|---|
| 1 | Clone all repositories | All | `git clone` for each repo | Git, GitHub access |
| 2 | Install shared dependencies | `@kitluy/shared-utils` | `cd packages/shared-utils && npm ci && npm run build` | Node 20+, npm 10+ |
| 3 | Install shared UI | `@kitluy/shared-ui` | `cd packages/shared-ui && npm ci && npm run build` | `@kitluy/shared-utils` built |
| 4 | Install printer driver | `@kitluy/printer-driver` | `cd packages/printer-driver && npm ci && npm run build` | Node 20+ |
| 5 | Provision Supabase project | Infrastructure | `supabase init && supabase start` (local) or use cloud project | Docker (local) or Supabase org access |
| 6 | Apply database migrations | `kitluy-edge-functions` | `supabase db push` — migrations 001-013 in order | Supabase project running |
| 7 | Deploy edge functions | `kitluy-edge-functions` | `supabase functions deploy` (all 40 functions per §7.15) | Migrations applied |
| 8 | Verify edge functions | `kitluy-edge-functions` | `supabase functions list` + integration tests | Functions deployed |
| 9 | Build seller portal | `kitluy-seller-portal` | `cd kitluy-seller-portal && npm ci && npm run build` | `@kitluy/shared-ui`, `@kitluy/shared-utils` |
| 10 | Build admin portal | `kitluy-admin-portal` | `cd kitluy-admin-portal && npm ci && npm run build` | `@kitluy/shared-ui`, `@kitluy/shared-utils` |
| 11 | Build POS desktop app | `kitluy-pos-desktop-app` | `cd kitluy-pos-desktop-app && npm ci && npm run build:electron` | `@kitluy/shared-utils`, `@kitluy/printer-driver` |
| 12 | Package POS for ARM64 | `kitluy-pos-desktop-app` | `npm run package:arm64` | Step 11 complete |
| 13 | Build Hub Server binary | `kitluy-hub-server` | `cd kitluy-hub-server && ./build.sh` | Deno 1.42, Linux ARM64 target |
| 14 | Image SD card for Hub | `kitluy-hub-server` | `dd if=hub-image.img of=/dev/sdX bs=4M status=progress` | Step 13 binary, Raspberry Pi Imager |
| 15 | Image SD cards for T1-T5 | `kitluy-pos-desktop-app` | Flash POS desktop app image to microSD cards | Step 12 package |
| 16 | Boot Hub Server, pair terminals | Hardware | Boot Pi 5 8GB Hub, connect T1-T5 via LAN | Steps 14-15, LAN switch |
| 17 | Verify end-to-end | Integration | Run QA scenarios 1-18 from Part 15 | All steps above |

#### 17.3.2 CI/CD Pipeline

```yaml
# .github/workflows/kitluy-build.yml (conceptual)
name: KitLuy Suite Build
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  shared:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build shared-utils
        run: cd packages/shared-utils && npm ci && npm run build && npm test
      - name: Build shared-ui
        run: cd packages/shared-ui && npm ci && npm run build && npm test
      - name: Build printer-driver
        run: cd packages/printer-driver && npm ci && npm run build

  edge-functions:
    runs-on: ubuntu-latest
    needs: shared
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - name: Deploy edge functions
        run: |
          supabase link --project-ref $SUPABASE_PROJECT_REF
          supabase functions deploy

  portals:
    runs-on: ubuntu-latest
    needs: shared
    strategy:
      matrix:
        portal: [seller-portal, admin-portal]
    steps:
      - uses: actions/checkout@v4
      - name: Build ${{ matrix.portal }}
        run: cd ${{ matrix.portal }} && npm ci && npm run build

  pos-desktop:
    runs-on: ubuntu-latest
    needs: shared
    steps:
      - uses: actions/checkout@v4
      - name: Build POS desktop
        run: cd kitluy-pos-desktop-app && npm ci && npm run build:electron
      - name: Package ARM64
        run: cd kitluy-pos-desktop-app && npm run package:arm64

  hub-server:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: denoland/setup-deno@v1
        with:
          deno-version: "1.42"
      - name: Build Hub Server
        run: cd kitluy-hub-server && deno compile --target aarch64-unknown-linux-gnu -o kitluy-hub ./main.ts
```

#### 17.3.3 Local Development Environment

For a developer working on the full stack locally:

```bash
# 1. Start Supabase local
supabase start

# 2. In terminal 1: Run edge functions locally
supabase functions serve --env-file ./.env.local

# 3. In terminal 2: Seller portal dev server
cd kitluy-seller-portal && npm run dev

# 4. In terminal 3: Admin portal dev server
cd kitluy-admin-portal && npm run dev

# 5. In terminal 4: POS desktop (Electron)
cd kitluy-pos-desktop-app && npm run dev:electron

# 6. In terminal 5: Hub Server (Deno)
cd kitluy-hub-server && deno run --allow-all ./main.ts --mode=dev
```

---

### 17.4 File Structure Convention

Each module follows a consistent directory structure for the Rebuild Test:

```
kitluy-{module}/
├── README.md              # One-page setup + build instructions
├── package.json           # Dependencies, scripts
├── tsconfig.json          # TypeScript config
├── vite.config.ts         # Vite build config (web/desktop)
├── supabase/
│   └── functions/         # Edge function source (Deno)
│       ├── _shared/       # Shared Deno modules (DB client, auth helpers, formatKHR)
│       ├── auth-phone-otp-send/
│       ├── auth-phone-otp-verify/
│       ├── auth-session-refresh/
│       ├── pos-cart-create/
│       ├── pos-cart-add-line/
│       ├── ...            # All 40 functions per Part 7
│       └── admin-menu-item-create/
├── src/
│   ├── components/        # React components
│   │   ├── shared/        # Cross-cutting components
│   │   ├── pos/           # POS-specific components
│   │   ├── cafe/          # Cafe-specific components
│   │   └── admin/         # Admin-specific components
│   ├── pages/             # Route-level page components
│   ├── hooks/             # Custom React hooks
│   ├── utils/             # Utility functions (formatKHR, etc.)
│   ├── services/          # API clients (edge function callers)
│   ├── types/             # TypeScript type definitions
│   └── styles/            # Global styles, Tailwind config
├── public/                # Static assets (logos, favicon)
└── tests/
    ├── unit/              # Jest/Vitest unit tests
    ├── integration/       # API integration tests
    └── e2e/               # Playwright/Cypress E2E tests
```

---


---


## Appendix C: Reconciliation Register


**Authority:** Schema Authority  
**Purpose:** Resolution log for all known schema conflicts. Every entry documents: the original problem, the resolution decision, canonical values, and migration impact.

---

### C.1 Register Summary

| ID | Conflict | Status | Section |
|---|---|---|---|
| R-1 | Money model: `numeric(18,4)` USD storage vs KHR integer display | **RESOLVED** | C.2 |
| R-2 | Ghost table FKs: `core.stores`, `pos.items`, `pos.terminals`, `core.users` | **RESOLVED** | C.3 |
| R-3 | `ops.cafe_orders` vs `pos.carts` as order source of truth | **RESOLVED** | C.4 |
| R-4 | Item/category home schema: `inv.items` vs `menu.*` namespace | **RESOLVED** | C.5 |
| R-5 | Franchise layer: `cp.franchise_agreements`, billing-mode derivation | **RESOLVED (v1.1.0)** | C.6 |

---

### C.2 R-1: Money Model

**Status:** RESOLVED (pre-existing)  
**Referenced in:** §6.1.3, all monetary columns

| Aspect | Decision |
|---|---|
| **Storage type** | `numeric(18,4)` — USD-primary, 4 decimal places |
| **Display format** | KHR integer only, via `formatKHR()` function |
| **Café derived columns** | `bigint` KHR integer, written at cart finalization time |

**Rationale:** Cambodia operates primarily in KHR for display but USD for large transactions. `numeric(18,4)` handles both with precision. Integer KHR display avoids decimal confusion for merchants and customers.

**Migration impact:** None — R-1 was resolved before schema design. All monetary columns use `numeric(18,4)`; all `_khr` columns use `bigint`.

---

### C.3 R-2: Ghost Table FKs

**Status:** RESOLVED  
**Referenced in:** §6.2 (all DDL), §6.4 (FK map)

**Problem:** The previous handbook referenced tables that either did not exist or had wrong names. Café FKs (and other schemas) pointed to ghost tables, causing confusion and potential broken migrations.

#### C.3.1 Canonical Replacements

| # | Ghost Table (OLD) | Canonical Table (NEW) | Reason | Migration Note |
|---|---|---|---|---|
| 1 | `core.stores` | `pos.stores` | A store is a POS entity with `vertical_type`, `register_id` FKs, and `store`-specific RLS. It does not belong in `core.*` which is for helper functions only. | Replace all `core.stores` references with `pos.stores`. FK columns named `store_id` remain unchanged. |
| 2 | `pos.items` | `menu.items` | R-4 decision: items belong in the `menu.*` catalog namespace, not `pos.*`. `pos.*` is for transactional entities (carts, tenders, shifts). The catalog is a separate domain. | Replace all `pos.items` references with `menu.items`. Update FKs: `pos.cart_lines.item_id` references `menu.items(id)`. |
| 3 | `pos.terminals` | `pos.registers` | "Terminal" was an imprecise term. Master Context §4 defines "Register" as the canonical term for POS terminal records (T1–T5). | Replace all `pos.terminals` references with `pos.registers`. Update FK columns: `terminal_id` → `register_id`. |
| 4 | `core.users` | `cp.accounts` | User identity is a control-plane concern. `cp.accounts` links to `auth.users(id)` via `auth_user_id`, enforcing Single Identity (§2 P2). `core.*` has no tenant-scoped tables. | Replace all `core.users` references with `cp.accounts`. Update FK columns: `user_id` → `account_id`. |

#### C.3.2 Migration Impact

| Action | SQL | Notes |
|---|---|---|
| **Rename FK columns** (where ghost names persist) | `ALTER TABLE {table} RENAME COLUMN terminal_id TO register_id;` | Do this BEFORE creating the FK constraint |
| **Drop ghost FK constraints** | `ALTER TABLE {table} DROP CONSTRAINT IF EXISTS fk_{old_name};` | Only if migrating from old schema |
| **Add canonical FK constraints** | See §6.2 and §6.4 for full DDL | Apply in `011_deferred_fks.sql` order |

#### C.3.3 Validation Query

Run this after migration to verify no ghost tables remain:

```sql
-- Check for ghost table references in information_schema
SELECT
    tc.table_schema,
    tc.table_name,
    kcu.column_name,
    ccu.table_schema AS foreign_schema,
    ccu.table_name AS foreign_table
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_name IN ('stores', 'items', 'terminals', 'users')
    AND ccu.table_schema IN ('core', 'pos')
ORDER BY tc.table_schema, tc.table_name;
-- Expected result: zero rows (all ghost references eliminated)
```

---

### C.4 R-3: `ops.cafe_orders` vs `pos.carts`

**Status:** RESOLVED  
**Referenced in:** §6.2.3 (`pos.carts` DDL), §6.2.7 (`ops.cafe_orders` DDL), §6.4 (FK #80)

**Problem:** Two tables could claim to be "the order." The previous handbook was ambiguous about which was source of truth, leading to potential double-authority bugs.

#### C.4.1 Resolution

| Aspect | `pos.carts` | `ops.cafe_orders` |
|---|---|---|
| **Role** | **Financial source of truth** | **Operational layer** |
| **Created when** | Order started (any vertical) | Order confirmed (cafe vertical only) |
| **Contains** | Line items, pricing, tenders, payments | Kitchen status, slot assignment, production tracking |
| **Cardinality** | 1 per order | 1 per cart (1:1, enforced by UNIQUE) |
| **Lifespan** | Cart → Invoice → Archive | New → Preparing → Ready → Served |
| **Written by** | T1 Cashier via edge function | T3 KDS / T4 DDS via edge function |
| **Read by** | Accounting, reporting, loyalty | Kitchen display, queue display, customer notification |

#### C.4.2 FK Specification

```sql
-- ops.cafe_orders.cart_id: UNIQUE FK to pos.carts(id)
-- This enforces exactly one ops.cafe_orders row per pos.carts row.
cart_id uuid NOT NULL UNIQUE REFERENCES pos.carts(id) ON DELETE CASCADE
```

#### C.4.3 Write Order

```
1. T1 Cashier creates cart → INSERT pos.carts (status='open')
2. T1 Cashier adds lines   → INSERT pos.cart_lines
3. T1 locks cart           → UPDATE pos.carts SET cart_status='locked'
4. T1 processes tender     → INSERT pos.tenders + pos.tender_attempts
5. Tender succeeds         → UPDATE pos.carts SET cart_status='paid'
6. Edge function fires:    → INSERT ops.cafe_orders (cart_id={cart}, order_status='new')
                             (ONLY IF store.vertical_type = 'cafe')
7. T3 KDS picks up order   → UPDATE ops.cafe_orders SET order_status='preparing'
8. T3 completes prep       → UPDATE ops.cafe_orders SET order_status='ready_for_pickup',
                               slot_number = {assigned}
9. T4 DDS shows slot       → Broadcast via Realtime: cafe:store:{store_id}
10. Customer picks up      → UPDATE ops.cafe_orders SET order_status='served'
11. Edge function fires:   → INSERT sal.sales_invoice FROM pos.carts
                             INSERT sal.receipt FROM sal.sales_invoice
                             (Ingredient deduction fires at step 8: ready_for_pickup)
```

#### C.4.4 Sync Trigger Behavior

No database triggers sync between `pos.carts` and `ops.cafe_orders`. Sync is explicit via edge functions:

| Trigger Point | Action | Edge Function |
|---|---|---|
| `pos.carts.cart_status` → `'paid'` | Create `ops.cafe_orders` row | `pos-cart-finalize` (cafe branch) |
| `ops.cafe_orders.order_status` → `'ready_for_pickup'` | Broadcast to T5, assign slot | `cafe-order-ready` |
| `ops.cafe_orders.order_status` → `'served'` | Fire Rotanak earn, create invoice/receipt | `cafe-order-complete` |
| `ops.cafe_orders.order_status` → `'cancelled'` | Refund tenders (if any), void cart | `cafe-order-cancel` |

**Important:** `pos.carts` is NEVER written by the café operational flow. The café system writes to `ops.cafe_orders` only. Financial data (pricing, tenders) is read from `pos.carts` via the `cart_id` FK.

#### C.4.5 Migration Impact

| From State | Action |
|---|---|
| No `ops.cafe_orders` exists | Create table per §6.2.7 (migration `010_ops_cafe.sql`) |
| `ops.cafe_orders` exists with wrong FK | Drop existing FK, add `cart_id uuid UNIQUE REFERENCES pos.carts(id) ON DELETE CASCADE` |
| `ops.cafe_orders` has duplicate `cart_id` | Deduplicate before adding UNIQUE constraint (business logic decision required) |

---

### C.5 R-4: Item/Category Home Schema

**Status:** RESOLVED — **Option B selected**  
**Referenced in:** §6.2.5 (`menu.*` schema), §6.4 (FK #26–#27, #49–#61)

**Problem:** Two competing approaches for where sellable items (food, drink, laundry services) should live. Café vertical could not proceed until this was locked.

#### C.5.1 Options Considered

| Criterion | Option A: `inv.items` | Option B: `menu.*` |
|---|---|---|
| **Namespace** | `inv.items`, `inv.categories`, etc. | `menu.items`, `menu.categories`, `menu.item_modifier_groups`, `menu.price_history` |
| **Implied domain** | Inventory management (broad) | Product catalog (focused) |
| **Vertical discriminator** | Required: `vertical_type` column on every item | Implicit: `applicable_verticals` array; modifier groups in `cafe.*` |
| **Café modifier linkage** | `inv.item_modifiers` table (new) | `menu.item_modifier_groups` junction table |
| **Ingredient/BOM tracking** | Same table (`inv.items` has recipe fields) | Separate `cafe.recipes` + `cafe.recipe_ingredients` tables |
| **Price history** | Part of `inv` audit trail | Dedicated `menu.price_history` table |

#### C.5.2 Decision: Option B (`menu.*`)

**Selected.** All sellable items, categories, and pricing live in the `menu.*` namespace.

**Justification (3 sentences):**

1. `inv.*` implies full inventory management — purchase orders, stock transfers, suppliers, warehouse operations — which is **out of MVP scope** per Master Context §3. Using it for a product catalog conflates two distinct domains and would saddle the schema with prematurely broad abstractions.

2. `menu.*` directly models the "catalog of sellable things" that **every vertical has**: a laundry's services, a café's food/drink items. The name generalizes naturally across verticals while keeping the schema purpose-built.

3. Separating `menu.items` (catalog) from `cafe.ingredients` + `cafe.recipes` (BOM/stock) creates a clean separation of concerns: the cashier sells menu items; the kitchen consumes ingredients. This maps cleanly to the operational reality and avoids nullable-column bloat on a generic inventory table.

#### C.5.3 Schema Summary

```
menu.* (catalog layer — all verticals)
├── menu.categories          ← Item hierarchy, self-referencing parent_id
├── menu.items               ← Sellable things: name, price, photo, vertical applicability
├── menu.item_modifier_groups ← Junction: items ↔ cafe.modifier_groups
└── menu.price_history       ← Audit trail of price changes

cafe.* (vertical layer — café only)
├── cafe.modifier_groups     ← "Size", "Sugar Level", etc.
├── cafe.modifiers           ← "Large", "50%", "Extra Shot", etc.
├── cafe.recipes             ← BOM header per menu item
├── cafe.recipe_ingredients  ← Junction: recipes ↔ ingredients with quantities
├── cafe.ingredients         ← Raw materials: milk, coffee beans, cups
└── cafe.tabs                ← Running orders, survives shift change
```

#### C.5.4 Migration Impact

| From State | Action |
|---|---|
| No items table exists | Create `menu.*` schema per §6.2.5 (migration `008_menu_catalog.sql`) |
| `inv.items` exists from previous attempt | Migrate data: `INSERT INTO menu.items (...) SELECT ... FROM inv.items;` then drop `inv.*` tables |
| `pos.items` exists (ghost) | Migrate data to `menu.items`, update FKs, drop `pos.items` |
| Item data in JSON columns | Extract to `menu.items` rows, create proper FKs |

#### C.5.5 Validation Query

```sql
-- Verify menu schema exists and is populated
SELECT table_schema, table_name, pg_catalog.pg_total_relation_size(quote_ident(table_schema)||'.'||quote_ident(table_name)) AS size
FROM information_schema.tables
WHERE table_schema = 'menu'
ORDER BY table_name;
-- Expected: 4 rows (categories, items, item_modifier_groups, price_history)
```

---

### C.6 R-5: Franchise Layer

**Status:** RESOLVED (v1.1.0) — **overrides the original v1.0.0 deferral**
**Referenced in:** §5.7 (franchise model), §6.2.1 (`cp.tenants.billing_mode` + `cp.franchise_agreements`), §7.13 (`admin-franchise-agreement-create`, `subscription-payer-resolve`), §8.7 (subscription payer)

**Original problem:** Franchise agreements, royalty calculations, and multi-level billing were not implemented; the original Swarm consensus **deferred** them to v2.0 per Master Context §3 (MVP scope).

**Why this was overridden:** A franchise deal entered the **near-term pipeline**. The chain-portal (product #2) exists specifically to manage the *set of shops* under a brand — including franchises. Shipping it franchise-blind would make product #2 incomplete at launch for a real, signed-pipeline customer. The founder ruled that a concrete near-term customer outranks the internal MVP-scope line. Franchise is therefore **in scope for v1.0.0** as of this v1.1.0 reconciliation.

> ⚠ **Master Context divergence (must reconcile upstream):** the original deferral cited "Master Context §3." This bible now diverges from that ruling. If Master Context is a binding SSOT, its §3 must be updated to bring franchise into MVP scope — otherwise a future swarm run may re-defer franchise and silently undo this. This is the single open follow-up from the v1.1.0 reconciliation.

#### C.6.1 Resolution — the decided model

| Aspect | Decision |
|---|---|
| **Single-owner chain** | One `fin.companies`, many `pos.stores`. `cp.tenants.billing_mode = 'direct'`. No franchise row. |
| **Franchise** | One brand `cp.tenants`, multiple `fin.companies` (one per franchisee), each with a `cp.franchise_agreements` row. |
| **billing_mode values** | `direct` \| `brand_consolidated` \| `franchisee_direct` (replaces the original `direct`/`franchise`). |
| **Subscription payer** | **Derived**, never hardcoded — by `subscription-payer-resolve` (§7.13). Matches the founder rule "configurable per franchise agreement." |
| **Menu-push rights** | `full` / `approve` (default) / `none` on the agreement. |

#### C.6.2 Canonical DDL (created in v1.0.0)

`cp.franchise_agreements` is created — full DDL in §6.2.1. Summary:

```sql
-- cp.franchise_agreements (R-5 RESOLVED v1.1.0 — CREATE in migration 002_cp_core.sql)
-- brand_tenant_id       → cp.tenants(id)
-- franchisee_company_id → fin.companies(id)
-- billing_mode          CHECK ('brand_consolidated','franchisee_direct')  -- 'direct' invalid here
-- royalty_pct           numeric(5,2) NULL
-- menu_push_rights      CHECK ('full','approve','none') DEFAULT 'approve'
-- status                CHECK ('active','suspended','terminated') DEFAULT 'active'
-- UNIQUE (brand_tenant_id, franchisee_company_id)
```

`cp.tenants.billing_mode` CHECK becomes `('direct','brand_consolidated','franchisee_direct')`.

#### C.6.3 Migration Impact

| Action | SQL / Note |
|---|---|
| Update `cp.tenants.billing_mode` CHECK | drop old `('direct','franchise')` check; add `('direct','brand_consolidated','franchisee_direct')` |
| Create `cp.franchise_agreements` | per §6.2.1; in `002_cp_core.sql` (after `fin.companies` exists) |
| Add RLS | brand-tenant isolation policy (§6.2.1) |
| Deploy edge functions | `admin-franchise-agreement-create`, `subscription-payer-resolve` (§7.13) |
| App-level | edge functions now **accept** franchise billing modes (the old "reject franchise" rule is removed) |

#### C.6.4 Deferred to a later version (genuinely out of scope)

These franchise refinements remain **out** of v1.0.0 and are tracked for a future version — they are NOT needed for the pipeline deal:

```sql
-- cp.royalty_schedules     (automated royalty invoicing — later)
-- cp.franchise_fee_ledger  (franchise fee accounting — later)
```
Royalty is captured as a flat `royalty_pct` on the agreement in v1.0.0; automated royalty *billing/settlement* is the deferred piece.

---

### C.7 Validation Summary

Run after all migrations applied:

```sql
-- C.7.1: Verify all ghost tables eliminated
SELECT 'R-2 CHECK' as check_name, COUNT(*) as violation_count
FROM information_schema.tables
WHERE table_schema = 'core'
    AND table_name IN ('stores', 'users')
    AND table_type = 'BASE TABLE'
UNION ALL
-- C.7.2: Verify pos.carts ↔ ops.cafe_orders 1:1
SELECT 'R-3 CHECK: cart_id UNIQUE' as check_name,
    CASE WHEN COUNT(*) = 0 THEN 0 ELSE 1 END as violation_count
FROM (
    SELECT cart_id FROM ops.cafe_orders
    GROUP BY cart_id HAVING COUNT(*) > 1
) dupes
UNION ALL
-- C.7.3: Verify menu schema exists
SELECT 'R-4 CHECK: menu schema tables' as check_name,
    (4 - COUNT(*)) as violation_count  -- expect 4 tables
FROM information_schema.tables
WHERE table_schema = 'menu'
    AND table_name IN ('categories','items','item_modifier_groups','price_history')
UNION ALL
-- C.7.4: Verify RLS enabled on all tenant-scoped tables
SELECT 'RLS CHECK: ' || schemaname || '.' || tablename as check_name,
    CASE WHEN rowsecurity THEN 0 ELSE 1 END as violation_count
FROM pg_tables
WHERE schemaname IN ('cp','fin','pos','sal','menu','cafe','ops')
    AND tablename NOT IN ('migrations_log')
ORDER BY check_name;
```

Expected output: all `violation_count` = 0.

---

*End of Appendix C. All conflicts R-1 through R-5 documented. Schema is canonical.*



---

## Part 18: Version History

**Authority:** Founder Reconciliation
**Purpose:** Record every change to this bible after the initial Swarm consensus, with migration impact and reconciliation status.

| Version | Date | Author | Change Summary | Migrations Affected | Reconciliation |
|---|---|---|---|---|---|
| v1.0.0 | 29 May 2026 | KitLuy Swarm (multi-agent consensus) | Initial canonical rebuild bible. Parts 0, 3–11, 15, 17 + Appendix C. R-1…R-4 resolved; R-5 (franchise) **deferred to v2.0**. | 001–011 baseline + `008_menu_catalog`, `010_ops_cafe`, `011_deferred_fks` | R-1✓ R-2✓ R-3✓ R-4✓ R-5 deferred |
| v1.1.0 | 29 May 2026 | Founder (Het Sovannara) | **Franchise layer brought into scope** (overrides Swarm R-5 deferral, per near-term franchise pipeline deal): added `cp.franchise_agreements` (§6.2.1), changed `cp.tenants.billing_mode` to `direct`/`brand_consolidated`/`franchisee_direct`, added franchise model (§5.7), added 2 edge functions `admin-franchise-agreement-create` + `subscription-payer-resolve` (§7.13, total 40→42), rewrote Appendix C.6 to RESOLVED. **Six-product / six-build model** documented (§17.0 + Part 0 Phase 4): added `kitluy-chain-portal`, `kitluy-seller-app`, `kitluy-pos-mobile-app` as first-class products with two form-factor pairings. | `002_cp_core` (franchise table + billing_mode CHECK), edge fns `admin-franchise-agreement-create`, `subscription-payer-resolve` | R-5 ✓ RESOLVED; **open upstream item:** Master Context §3 must be updated to keep franchise in MVP scope (see C.6) |

### 18.1 Note on per-part version stamps

Each Part carries a `**Version:** v1.0.0` stamp marking the **agent authorship** at initial Swarm generation. The **document version is the one in the header block** (currently v1.1.0). The v1.1.0 reconciliation touched Parts 0, 5, 6, 7, 17 and Appendix C; their per-part authorship stamps are retained as historical markers of original Swarm authorship and are not re-versioned per-part. The single source of truth for the document version is the header block + this changelog.

### 18.2 Linked artifacts

- This file: `kitluy-suite-rebuild-bible-md-v1.1.0.md`
- Companion ecosystem handbook: `kitluy-suite-ecosystem-handbook-md-v1.0.0.md`
- Café terminal wireframe: `kitluy-cafe-pos-terminals-wireframe-v1.0.0.jsx`
- Café vertical spec: `kitluy-pos-cafe-handbook-md-v1.0.0.md`

---

*End of KitLuy Suite Rebuild Bible v1.1.0. Conflicts R-1 through R-5 all RESOLVED. One open upstream item: Master Context §3 franchise-scope reconciliation (Appendix C.6).*
