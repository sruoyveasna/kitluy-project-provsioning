# KitLuy Chain Portal — Rebuild Bible

**Filename:** `kitluy-chain-portal-rebuild-bible-v2.0.0.md`  
**Version:** v2.0.0  
**Date:** 2026-07-13  
**Product:** `kitluy-chain-portal`  
**Owner:** HET / KitLuy Suite project owner  
**Audience:** Chain owners, brand owners, franchise HQ teams, regional managers, finance managers, field auditors, HET operators, backend engineers, frontend engineers, QA, and support.  
**Primary industry:** Laundry Industry  
**Status:** Canonical rebuild-ready handbook draft  
**Project boundary:** KitLuy-first. No active dependency on SroulERP, Netra, Rotanak, Prajna, HSAL, HSA, Canvar, or other future projects for MVP operation. Future integrations are represented as optional connectors or export-readiness layers.  
**Naming rule:** Use **Partner**, not Seller. Any older `seller-*` references map to `partner-*`. Use **Tenant** as the backend account term and **Partner** as the business-facing store operator term.  
**Build philosophy:** One-shot complete product scaffold for MVP, Phase 1.5, and Phase 2 modules. Implementation can still be sequenced internally by dependency order.  
**Primary scope:** Multi-store operations, chain and franchise governance, master catalog control, branch service availability, brand standards, compliance audits, corrective actions, royalties, and chain-level reporting.

**Source baseline used for v2 consolidation:**

- `rebuild-bible-ai-template(3).md`, uploaded 2026-07-13.
- `kitluy-suite-ecosystem-rebuild-bible-v2.0.0.md`, dated 2026-07-01.
- `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md`, dated 2026-07-03.
- `kitluy-partner-pwa-portal-rebuild-bible-v1.0.0.md`, dated 2026-07-03.
- `kitluy-partner-app-rebuild-bible-v1.0.0.md`, dated 2026-07-05.
- Older `kitluy-chain-portal-rebuild-bible-md-v1.0.0.md`, dated 2026-06-16, used only as legacy Chain scope input and reconciled into current v2 direction.
- User decision added on 2026-07-03: store level must be able to temporarily enable/disable services for emergencies and day-to-day operational availability.
- Project rules confirmed through 2026-07-13: Laundry-first, Partner naming, KitLuy-only MVP, strict Admin/Chain/Partner/POS/Hub/File/AI boundaries, offline-first store operation, integer KHR, and provider-agnostic permission-scoped AI.

> **Mission:** This handbook must pass the **Rebuild Test**:  
> *If every person who built KitLuy Chain Portal disappeared tomorrow, could a single engineer with zero prior context reconstruct the product, infrastructure, database model, user flows, and business logic from this document alone?*  
> **Required answer:** Yes.

---

## 0. Front Matter — Rebuild Sequence

### REBUILD SEQUENCE — KitLuy Chain Portal v2.0.0

1. **Provision infrastructure**
   - Supabase project in Singapore / SGP1 region for PostgreSQL, Auth, Realtime, Edge Functions, RLS, audit/events, and pgvector if AI/RAG Chain BI is enabled.
   - DigitalOcean SGP1 App Platform or static hosting for the Chain Portal frontend.
   - DigitalOcean Spaces for exports, compliance evidence, audit attachments, royalty/B2B statement PDFs, report files, AI/RAG source documents, logs, and backups.
   - DigitalOcean Inference Engine as the first LLM inference layer for KitLuy AI Gateway if AI Chain BI is enabled.
   - Required exact values: `[REQUIRED: production Supabase project ref]`, `[REQUIRED: DigitalOcean project name]`, `[REQUIRED: Spaces bucket names]`, `[REQUIRED: production chain portal domain]`, `[REQUIRED: staging chain portal domain]`.

2. **Apply database migrations in order**
   - `000_enable_extensions.sql`
   - `001_kitluy_core_schema.sql`
   - `002_kitluy_admin_schema.sql`
   - `003_kitluy_chain_schema.sql`
   - `004_kitluy_partner_schema.sql`
   - `005_kitluy_pos_schema.sql`
   - `006_kitluy_laundry_vertical_schema.sql`
   - `007_kitluy_orders_payments_schema.sql`
   - `008_kitluy_devices_sync_schema.sql`
   - `009_kitluy_files_schema.sql`
   - `010_kitluy_ai_schema.sql`
   - `011_kitluy_events_audit_schema.sql`
   - `012_kitluy_chain_rls_policies.sql`
   - `013_kitluy_chain_indexes.sql`
   - `014_kitluy_chain_seed_baseline.sql`
   - Production migrations are written by engineering and applied only by an authorized backend/operator. Do not auto-apply production migrations from AI tools.

3. **Seed baseline data**
   - Chain Plan policy placeholders.
   - Chain roles: `chain_owner`, `chain_manager`, `regional_manager`, `finance_manager`, `field_auditor`, `chain_analyst`, `chain_readonly`.
   - Default Laundry master services: Wash & Fold, Wash & Iron, Dry Clean, Press Only, Ironing, Stain Removal, Bedding/Blanket, Express Service.
   - Default add-ons: express, fragrance, hanger, delicate handling, stain treatment, pickup/delivery placeholder.
   - Default brand standard templates: receipt, laundry tag, workflow, pricing floor/ceiling, service availability, business hours, quality checklist.
   - Default store availability reason codes: `machine_down`, `staff_shortage`, `supply_out`, `power_issue`, `water_issue`, `capacity_full`, `quality_issue`, `safety_issue`, `holiday_or_closure`, `other`.
   - Default compliance checklist templates and scoring pillars.
   - Default royalty rule template library, inactive unless Phase 1.5 franchise features are enabled.
   - Default AI prompt policies and MCP tool registry entries for chain-safe read-only insights.

4. **Deploy API contracts / Edge Functions**
   - Core session context and chain membership helpers.
   - Chain overview/dashboard functions.
   - Branch/store network read functions.
   - Catalog control and catalog push functions.
   - Store service availability override functions.
   - Brand standards and override governance functions.
   - Reports/export functions.
   - Compliance functions.
   - Franchise/royalty/B2B functions for Phase 1.5.
   - AI Chain BI functions through KitLuy AI Gateway.
   - File Service functions for DigitalOcean Spaces signed upload/download/export.

5. **Configure secrets and third-party credentials**
   - Supabase URL, anon key, service role key.
   - DigitalOcean Spaces access key and secret key.
   - DigitalOcean Inference Engine key or selected LLM provider key.
   - ABA PayWay / KHQR credentials when payment or chain B2B collection is activated.
   - Telegram/SMS/email/push provider tokens when notifications are activated.
   - Maps/geocoding key if territory or branch maps are activated.
   - Do not commit secrets. Chain Portal shows connector status only where allowed.

6. **Build / image local hardware or nodes**
   - Chain Portal itself is cloud/web only and does not run on store hardware.
   - Store Hub and POS devices are sibling builds required for live store operation.
   - For end-to-end chain testing, at least two Laundry stores must have Store Hub/POS sync data available.

7. **Pair / register clients to backend**
   - Admin PWA creates the tenant and chain record.
   - Admin PWA creates or links Laundry stores to the chain.
   - Admin PWA invites the first Chain Owner account.
   - Chain Owner logs into Chain Portal via Supabase Auth.
   - Chain Owner verifies linked stores, branch groups, master catalog, service availability policy, and reports.
   - Verify store heartbeats and sync freshness appear in Chain Portal.

8. **Run QA validation scenarios**
   - Run minimum Chain MVP QA scenarios covering chain login, cross-chain isolation, branch list, branch comparison, sync freshness, catalog push, catalog rollback, store emergency service pause, POS enforcement, brand standards, RBAC, reports, exports, audit, AI logging, and go-live readiness.
   - Run Phase 1.5 QA if compliance, franchise, royalty, promotions, or B2B modules are enabled.

9. **Verify monitoring and alerting**
   - Chain Portal frontend health.
   - Supabase Auth/DB/Realtime/Edge Function health.
   - Store Hub heartbeat rollup.
   - POS heartbeat rollup.
   - Sync queue age and stale branch count.
   - Catalog push partial failure rate.
   - Store service emergency pause count and expiry alerts.
   - Report export job failure rate.
   - File upload failure rate.
   - AI Gateway latency/cost/error rate if AI enabled.

10. **Go-live smoke test**
    - Admin logs in -> creates tenant -> creates Chain Plan customer -> creates two Laundry stores -> creates chain owner -> links stores to chain -> applies default Laundry templates -> registers Hubs/POS devices -> chain owner logs in -> creates master catalog -> pushes catalog to both stores -> Partner Portal sees store services -> POS creates Laundry order using pushed service -> store manager emergency-pauses one service -> POS hides/blocks that service -> Chain Portal shows service availability matrix and audit -> reports show branch comparison and sync freshness -> export report -> verify audit trail.

---

## Part 1 — Glossary

### 1.1 Platform Terms

| Term | Definition |
|---|---|
| KitLuy | Cambodia-first commerce operating ecosystem for SMEs, starting with Laundry. In v2, KitLuy is self-contained for MVP and does not depend on removed/future sibling projects. |
| KitLuy Suite | Full KitLuy ecosystem: Admin PWA Portal, Chain Portal, Partner PWA Portal, Partner App, POS Desktop App, POS Mobile App, Store Hub, File Service, AI Gateway, MCP Server, RAG Indexer, Notification Service, and shared backend. |
| KitLuy-only stage | Current development rule: active MVP features are built inside KitLuy or represented as generic optional connectors. No active MVP dependency on SroulERP, Netra, Rotanak, HSAL, HSA, Canvar, or Prajna. |
| Cambodia-first | Product decisions prioritize Cambodian realities: Khmer-ready UX, KHR-native money, KHQR/payment readiness, offline-first stores, affordable hardware, and practical SME workflows. |
| Vertical | Industry-specific business bundle with its own schema delta, workflow, order lifecycle, reports, hardware profile, feature index, and UI adjustments. It is not a UI skin. |
| Laundry Industry | First active KitLuy vertical and Chain Portal v2 MVP baseline. |
| Tenant | Backend account representing a business customer organization using KitLuy. One tenant can own one store, many stores, or a chain structure. |
| Partner | Business/store owner or operator using KitLuy. Replaces the retired term `Seller`. |
| Platform Owner | HET / KitLuy internal operator with top-level authority in Admin PWA Portal. |
| Store | One physical business location using KitLuy. A store belongs to exactly one tenant and exactly one vertical. |
| Chain | Multi-store brand, branch network, or franchise group managed through Chain Portal. |
| Store Hub | Local Raspberry Pi 5 server at a store. Runs local PostgreSQL, Hub API, sync agent, device monitor, local file queue, and employee/PIN cache. |
| Offline-first | Store operations continue during internet/WAN failure. POS writes to Store Hub first; Hub syncs to cloud when WAN returns. |
| Sync freshness | UI indicator showing whether cloud data is fresh, stale, pending, or offline relative to Store Hub sync status. |
| Domain Event | Immutable event representing a meaningful business or system state change, such as `chain_catalog_pushed`, `store_service_emergency_paused`, or `chain_royalty_run_locked`. |
| Rebuild Test | Standard requiring a single engineer with no prior context to reconstruct the product, infrastructure, and business logic from this bible and referenced migrations. |

### 1.2 Product Terms

| Product | Definition |
|---|---|
| `kitluy-admin-pwa-portal` | HET-only web/PWA platform control plane. Manages tenants, subscriptions, billing policy, support, device registry, audit, platform health, Integration Hub, and AI governance. |
| `kitluy-chain-portal` | This product. Web/PWA for brand, chain, or franchise owners. Manages multiple stores, branch performance, master catalog push, brand standards, store availability governance, compliance, franchise structure, royalties, B2B, and chain reports. |
| `kitluy-partner-pwa-portal` | One-store web/PWA back office for business owner/manager. Manages one store's services, staff, customers, inventory, finance, reports, settings, and store-level service availability. |
| `kitluy-partner-app` | Mobile form factor of Partner Portal. Same store-management scope, optimized for phone. |
| `kitluy-pos-desktop-app` | Fixed in-store POS terminal for staff. Handles order intake, payment, receipt/tag printing, shifts, order status, and offline operation through Store Hub. |
| `kitluy-pos-mobile-app` | Mobile POS for roaming intake, scan/status, pickup helper, and line-busting. It extends POS Desktop but does not replace it in Phase 1. |
| `kitluy-hub-agent` | Store Hub service for local database, sync, device health, local APIs, file queue, and offline queue. |
| `kitluy-file-service` | Internal service controlling DigitalOcean Spaces upload/download, file metadata, permissions, thumbnails, export files, and RAG source registration. |
| `kitluy-ai-gateway` | KitLuy-native AI orchestration layer for permissions, prompt policy, RAG retrieval, MCP/tool routing, provider routing, safety, logging, and DigitalOcean Inference Engine calls. |
| `kitluy-mcp-server` | Internal tool/action server used by AI for approved operations. Chain tools are permission-scoped and audited. |
| `kitluy-rag-indexer` | Worker that chunks/indexes documents and selected operational records for AI retrieval. |
| `kitluy-notification-service` | Internal service for Telegram, SMS, email, push, and in-app notifications. |

### 1.3 Chain Module Terms

| Term | Definition |
|---|---|
| Chain HQ | Owner headquarters view across all stores in a chain. Chain Portal is the software surface for Chain HQ. |
| Branch | A store inside a chain. Branch is a business-facing term; Store is the backend term. |
| Branch Group | Named grouping of chain stores, such as Phnom Penh, Siem Reap, Franchise North, Company-Owned, or Pilot Stores. |
| Master Catalog | Chain-level authoritative laundry service catalog. Defines service names, categories, base pricing policy, add-ons, and brand display rules. |
| Catalog Version | Immutable snapshot of Master Catalog content used for push, rollback, and audit. |
| Catalog Push | Chain action that publishes a Catalog Version to target stores. Targets can be all stores, selected stores, branch groups, or franchise groups. |
| Catalog Push Batch | Header record for one catalog push operation. Tracks actor, target scope, version, status, and summary counts. |
| Catalog Push Target | Per-store status row inside a Catalog Push Batch. Tracks pending, applied, skipped, failed, stale, or rolled back state. |
| Brand Standard | Chain rule that standardizes operations across stores: receipt format, laundry tag format, service promise, pricing floors, due-date policy, business hours, quality process, and customer-facing wording. |
| Override Governance | Policy that defines what a store can change locally: HQ locked, local editable, approval-required, read-only, or emergency-override allowed. |
| Store Service Availability | Store-level operational state showing whether a service is currently available at a branch. This is separate from the Master Catalog definition. |
| Emergency Service Pause | Store-level action that temporarily disables a service for an operational reason such as machine failure, staff shortage, supply outage, power/water issue, capacity overload, quality issue, or safety issue. |
| Effective Store Service | System-calculated final service state after combining HQ catalog status, store enabled status, emergency pause, and availability window. POS and future online booking use the effective state. |
| Compliance Audit | Structured branch inspection with checklist, score, evidence, notes, corrective actions, and audit history. |
| Compliance Pillar | Scoring category for compliance audits. MVP defaults: Brand Identity, Process Adherence, Service Standards, Experience Consistency. |
| Corrective Action | Required follow-up item after a compliance issue, assigned to a branch or manager. |
| Franchisee | Legal/business entity operating one or more stores under the chain brand. Can be independent franchisee or company-owned operator. |
| Franchise Agreement | Contract metadata linking franchisee, stores, billing mode, royalty rule, territory, dates, and status. |
| Royalty Rule | Formula used to compute franchise royalties, such as gross percentage, net percentage, tiered, hybrid, or minimum floor. |
| Royalty Run | Periodic append-only calculation of royalties due from franchisees to chain HQ. This is chain-internal money, not HET revenue. |
| Territory | Geographic area assigned to a franchisee or branch group. Phase 2 if map provider is confirmed. |
| Chain B2B | Chain-level institutional customer module for hotels, spas, schools, corporate accounts, negotiated laundry rates, statements, and B2B invoicing. |
| Chain AI BI | KitLuy-native AI layer for chain insights, summaries, anomaly explanation, catalog performance, compliance risk, and drafted actions. |

### 1.3A Multi-Store, Franchise, Catalog, and Compliance Terms

| Term | Definition |
|---|---|
| Multi-store Operator | A Tenant or Chain operating two or more stores under one governance structure. The stores may be company-owned, franchise-operated, or Partner-operated, but each store remains a separate Store record. |
| Brand Owner | The organization that owns the chain brand, master catalog, brand standards, and franchise policy. In most deployments this is the Chain HQ. |
| Franchise HQ | Chain Portal operating role/context used by the franchisor to manage franchisees, agreements, standards, compliance, royalties, and territory metadata. |
| Franchise Unit | A Store operated under an active Franchise Agreement. It is still a normal KitLuy Store and retains Partner/POS boundaries. |
| Company-Owned Store | A branch directly operated by the chain owner rather than an independent franchisee. |
| Catalog Assignment | The current Catalog Version assigned to a Store, including application status, source push batch, and rollback reference. |
| Catalog Exception | A time-bounded, approval-governed request for a store to vary an HQ-controlled catalog field. It never silently changes the Master Catalog. |
| Price Guardrail | HQ-defined minimum and maximum KHR price allowed for a locally editable service. |
| Compliance Program | Chain-level set of versioned templates, schedules, assignments, audits, evidence, scoring rules, and corrective actions. |
| Compliance Template | Versioned checklist definition containing weighted audit items, pass threshold, critical-fail rules, and evidence requirements. |
| Audit Assignment | A scheduled instruction for an auditor to inspect a particular Store using a specific Compliance Template by a due date. |
| Evidence Asset | Photo, document, receipt, or other proof stored through KitLuy File Service and linked to an audit answer or corrective action. |
| Corrective Action SLA | Due date and escalation policy for closing a compliance finding. Severity controls the default SLA. |
| Critical Fail | A compliance answer that fails a mandatory safety, legal, customer-protection, or brand requirement. A Critical Fail forces the audit result to `failed` regardless of numeric score. |
| Royalty Adjustment | Append-only correction applied after a Royalty Run is locked. Locked run lines are never edited in place. |
| Data Freshness Gate | Rule that blocks or warns a catalog, report, compliance, or royalty action when one or more Stores have stale or unknown synchronized data. |

### 1.4 Commerce and Laundry Terms

| Term | Definition |
|---|---|
| Chain Plan | Multi-store subscription plan. Exact final price is `[REQUIRED: final Chain Plan monthly KHR price]`. Older working assumption was `៛100 HQ + ៛50/store/month`, but production must use Admin billing policy rather than hard-coding. |
| Commerce Plan | Single-store subscription plan. Exact final price is `[REQUIRED: final Commerce Plan monthly KHR price]`. |
| Subscription | Monthly SaaS billing relationship between HET/KitLuy and a tenant/store/chain. Admin PWA owns billing policy and invoicing. |
| Trial | Free trial period before billing. Final duration is `[REQUIRED: final trial days]`. |
| Grace Period | Time after failed billing before restriction/suspension. Final duration is `[REQUIRED: final grace days]`. |
| 0% Commission | KitLuy does not take order revenue commission in the current stage. Revenue is SaaS/subscription/add-on based. |
| KHR | Cambodian Riel. KitLuy displays KHR using `៛` and stores KHR money as integer fields unless a future ledger explicitly requires decimals. |
| KHQR | Cambodia QR payment standard. Used by payment connectors when activated. Chain Portal does not capture POS payments. |
| Laundry Service | Service sold by a Laundry store, such as Wash & Fold, Wash & Iron, Dry Clean, Press Only, Ironing, Stain Removal, Bedding/Blanket, Express Service. |
| Add-on | Extra handling or service such as express, fragrance, hanger, delicate handling, stain treatment. |
| Per-kg Pricing | Laundry price model based on weight. POS may use scale input. |
| Per-piece Pricing | Laundry price model based on garment/item quantity. |
| Flat Pricing | Fixed price model independent of weight or quantity. |
| Laundry Tag | Physical label/slip attached to an order, bag, or garment for tracking. |
| Receipt | Customer proof of payment/order, printed or digital. |
| Order Status | Laundry lifecycle state. MVP defaults: New, Received, Washing, Drying, Ironing, Ready, Picked Up, Cancelled, Issue/Rewash/Damaged. |
| Rewash / Damaged / Issue | Exception workflow for operational problems requiring evidence, review, customer communication, or compensation. |

### 1.5 Hardware and Integration Terms

| Term | Definition |
|---|---|
| Raspberry Pi 5 Hub | Recommended local store hub hardware. Minimum 8GB RAM, NVMe storage, active cooling, UPS. Chain Portal reads its heartbeat; it does not connect to it directly. |
| POS Desktop Terminal | Fixed in-store POS device, usually Raspberry Pi 5 or desktop-class terminal running Electron POS. |
| Receipt Printer | ESC/POS thermal printer used for customer receipts. |
| Tag Printer | Label printer for Laundry tags. May use ESC/POS, TSPL, or ZPL depending model. |
| USB Scale | Scale used for per-kg Laundry pricing. Chain Portal reads aggregate service performance only. |
| Supabase | Active cloud database/auth/realtime/edge-function backend. |
| DigitalOcean Spaces | Active object storage provider for files, exports, evidence, logs, backups, and RAG source documents. |
| DigitalOcean Inference Engine | First LLM inference layer for KitLuy AI Gateway. Provider must remain swappable. |
| ABA PayWay | Payment gateway connector for KHQR/card/subscription/B2B collection when activated. Chain Portal may use payment status for chain subscription and B2B invoice collection, not POS payment capture. |
| Notification Service | Telegram/SMS/email/push/in-app provider orchestration. |
| ERP Export Prep | Future export package/readiness module for ERP/back-office integration. Not an MVP dependency. |
| Logistics Connector | Future generic pickup/delivery provider connector. Not an MVP dependency. |
| Loyalty Connector | KitLuy-native basic loyalty or future optional external loyalty connector. Not an MVP dependency. |

### 1.6 Removed / Future Terms

| Term | Current Status |
|---|---|
| Seller | Retired official product term. Use Partner. |
| SroulERP | Future ERP/back-office integration. Not active dependency for Chain Portal MVP. Represent only as export readiness. |
| Netra | Old external AI name. Replace with KitLuy AI Gateway/RAG/MCP. |
| Rotanak | Old external loyalty dependency. Use KitLuy-native future loyalty or optional connector readiness. |
| Prajna | Removed/future separate project. Not KitLuy MVP dependency. |
| HSAL | Old logistics dependency. Replace with generic future logistics connector readiness. |
| HSA / Canvar | Future e-commerce/marketplace connector concept only. Not active Chain Portal dependency. |
| B1/B2/B3 Commission | HSA-only marketplace construct. Excluded from KitLuy. KitLuy remains SaaS/subscription with 0% order commission. |

### 1.7 Feature-Index Terms

| Prefix | Meaning |
|---|---|
| `KF-CORE-*` | Core tenant, auth, membership, base platform features. |
| `KF-ADM-*` | Admin Portal features. |
| `KF-CHN-*` | Chain Portal features. |
| `KF-PRT-*` | Partner Portal/App features. |
| `KF-POS-*` | POS Desktop/Mobile features. |
| `KF-LDY-*` | Laundry vertical features. |
| `KF-FIL-*` | File Service / storage features. |
| `KF-AI-*` | AI/RAG/MCP/LLM features. |
| `KF-SYN-*` | Sync/offline/Store Hub features. |

---

## Part 2 — Business Overview

### 2.1 What it is

KitLuy Chain Portal is the multi-store HQ command center for Cambodian Laundry chains, brands, branch networks, and franchise operators using KitLuy. If Partner PWA is the back office for one store and Admin PWA is HET's platform control plane, Chain Portal is the middle layer: it lets chain owners compare branches, push a master Laundry catalog, govern brand standards, monitor sync/store health, audit compliance, coordinate franchise structures, and read chain-level reports without touching POS counter operations.

In product terms: **Shopify Plus-style multi-branch control + Laundry chain/franchise operating discipline + Cambodia-first offline-aware commerce management.**

### 2.2 What it is not

Chain Portal is not Admin PWA. It cannot provision arbitrary tenants platform-wide, set HET billing policy, manage platform support queues, rotate connector credentials, or operate the global device registry. Admin provisions and monitors chains; Chain Portal manages one chain's business operations after provisioning.

Chain Portal is not Partner PWA. It does not replace one-store staff management, one-store inventory operations, one-store daily finance reconciliation, local customer service settings, or POS PIN/time-card management. Partner PWA owns the store back office.

Chain Portal is not POS. It never creates customer laundry orders, captures customer payment at the counter, prints receipts/tags, opens/closes shifts, or writes offline operational orders. POS Desktop/Mobile and Store Hub own counter operation. Chain Portal reads synced store data and labels freshness.

Chain Portal is not ERP/accounting. Royalty runs, B2B statements, and finance rollups are operational tools. Formal general ledger, tax filing, payroll, procurement accounting, and statutory reporting remain future ERP/export integration items.

### 2.3 Verticals / Modules

KitLuy is phased by industry vertical. Chain Portal v2 begins with Laundry only.

| Vertical | Stage | Chain Portal behavior |
|---|---|---|
| Laundry | Active MVP | Full support for master Laundry catalog, branch reports, store service availability, brand standards, compliance, sync health, franchise/royalty/B2B phased modules. |
| Cafe / Milk Tea | Future | Parked. No active Chain Portal v2 MVP workflow. Requires separate vertical bundle later. |
| Restaurant | Future | Parked. No active MVP workflow. Requires tables/course/KDS-specific chain logic later. |
| Retail | Future | Parked. No active MVP workflow. Requires SKU/barcode/inventory-specific chain logic later. |

Locked rule: **one store belongs to exactly one vertical**. A Laundry store cannot later become a Cafe store under the same store record. Multi-vertical operators must create separate stores or separate chains.

#### 2.3.1 Chain Portal Domain Map

| Domain | MVP | Phase 1.5 | Phase 2 | Authority boundary |
|---|---:|---:|---:|---|
| Chain Overview and Branch Network | Yes | Enhance | Enhance | Chain reads only linked Stores; Admin provisions Tenant/Store records. |
| Master Catalog and Store Assignment | Yes | Enhance | Enhance | Chain owns catalog versions; Partner/POS consume effective Store services. |
| Service Availability and Emergency Pause | Yes | Enhance | Enhance | Store can pause operational availability; Chain governs policy and visibility. |
| Brand Standards and Exceptions | Yes | Enhance | Enhance | Chain publishes standards; Store exceptions require policy, reason, expiry, and audit. |
| Compliance Program | Foundation | Yes | Field/tablet automation | Chain owns templates, assignments, audits, scores, and corrective actions. |
| Franchise Structure and Agreements | Foundation | Yes | Enhance | Admin provisions platform records; Chain owns business relationship metadata within its scope. |
| Royalties and Franchise Statements | No | Yes | Enhance | Chain-internal operational finance only; not HET billing and not statutory accounting. |
| Chain B2B | No | Yes | Enhance | Chain contracts and statements; Store operational bookings remain POS/Partner-owned. |
| Chain AI BI | Read-only summary | Yes | Advanced | AI Gateway enforces Chain/Store scope, confirmation, and audit. |
| Marketplace / Sales Channels | Readiness only | Optional connector | Expanded | Integration Hub owns connector framework; no active Canvar dependency for MVP. |


### 2.4 Product / Build Inventory

| Build | Audience | Form factor | Scope | Chain relationship |
|---|---|---|---|---|
| `kitluy-admin-pwa-portal` | HET/platform owner | Web/PWA | Platform control: tenants, subscriptions, billing, support, device registry, audit, Integration Hub, platform health. | Admin provisions and monitors chains; does not replace Chain Portal. |
| `kitluy-chain-portal` | Brand/chain/franchise owner | Web/PWA | This build. Multi-store HQ, catalog push, branch reports, standards, compliance, franchise, royalty, B2B, Chain AI BI. | Owns chain business operations. |
| `kitluy-partner-pwa-portal` | One-store owner/manager/accountant | Web/PWA | One-store back office: services, staff, customers, inventory, finance, reports, store settings. | Receives chain catalog/standards; owns local service availability. |
| `kitluy-partner-app` | Store owner/manager on phone | Mobile | Mobile form factor of Partner Portal. | May approve local store actions and alerts. |
| `kitluy-pos-desktop-app` | Store staff | Electron/desktop/Pi | Fixed register: orders, payment, receipt/tag printing, status updates, shift, offline operation. | Uses effective store services pushed from catalog/availability logic. |
| `kitluy-pos-mobile-app` | Store staff | Mobile | Roaming POS/status/pickup helper. | Uses same order/payment/status logic as POS Desktop. |
| `kitluy-hub-agent` | Store infrastructure | Raspberry Pi 5 service | Local DB, sync, device health, local APIs, file queue. | Chain Portal reads synced heartbeat and store data only. |
| `kitluy-file-service` | Internal service | Cloud | File metadata, signed URLs, exports, evidence, RAG sources. | Used for compliance evidence and chain exports. |
| `kitluy-ai-gateway` | Internal service | Cloud | AI/RAG/MCP orchestration, permissions, audit, provider routing. | Powers Chain AI BI. |
| `kitluy-notification-service` | Internal service | Cloud | Telegram/SMS/email/push/in-app notifications. | Sends chain alerts and store service pause notifications. |

### 2.5 Business Model

| Lever | Rule |
|---|---|
| Revenue model | SaaS subscription and optional add-ons. 0% order commission in current stage. |
| Chain Plan | `[REQUIRED: final HQ fee and per-store monthly KHR price]`. Previous working assumption: `៛100 HQ + ៛50/store/month`; do not hard-code until confirmed. |
| Trial | `[REQUIRED: final trial days]`. Previous docs used 14 days. |
| Grace period | `[REQUIRED: final grace days]`. |
| Billing rhythm | Monthly by default. Other rhythms require explicit future decision. |
| Subscription owner | Admin PWA owns subscription/billing policy. Chain Portal reads its own subscription status only. |
| Hardware | Store hardware is sold, leased, or procured separately. `[REQUIRED: commercial hardware policy]`. |
| AI | Basic Chain AI summaries may be included; advanced AI recommendations may be add-on. `[REQUIRED: AI pricing decision]`. |
| Storage | Compliance evidence/export/RAG storage may require plan limits or add-ons. `[REQUIRED: storage policy]`. |
| Royalties | Franchise royalties are chain-internal money between franchisee and chain owner. HET does not take franchise royalty. |
| Payments | POS payment capture remains POS/Store Hub. Chain may later use payment connectors for subscription visibility and B2B invoice collection. |

### 2.6 Moat / Defensibility

1. **Multi-branch control at SME pricing:** Cambodian Laundry chains get enterprise-like branch comparison, catalog push, standards, compliance, franchise, and B2B tools without enterprise ERP complexity.
2. **Laundry-specific depth:** Master services, per-kg/per-piece rules, due-date policy, receipt/tag standards, rewash/damaged issue reporting, branch quality scoring, and store availability overrides are deeper than generic POS HQ dashboards.
3. **Offline-aware chain management:** Chain HQ sees store sync freshness and avoids false assumptions during WAN outages. Store POS continues through internet failure; Chain Portal labels stale data.
4. **Cambodia-first localization:** Khmer-ready UX, KHR integer money, KHQR readiness, local phone formats, affordable Pi-based store architecture, and realistic branch operations.
5. **Clear six-build ecosystem:** Admin, Chain, Partner, POS Desktop, POS Mobile, and Partner App serve different users without mixing authority.
6. **Native AI BI:** KitLuy AI Gateway/RAG/MCP can summarize chain performance, explain branch anomalies, and draft actions while preserving permission and audit controls.

### 2.7 Ecosystem Position — Owned vs Consumed

| Capability | Current owner | Chain Portal relationship |
|---|---|---|
| Chain profile, branch groups, franchisees, standards | Chain Portal | Owns. |
| Master catalog and catalog push | Chain Portal | Owns chain-level definition and push. |
| Store service availability | Partner/store level | Chain Portal governs and monitors; Partner/store can enable/disable locally. |
| Tenant/store provisioning | Admin PWA | Consumes linked chain/store records. Chain cannot create arbitrary platform stores without Admin provisioning. |
| Subscription billing policy | Admin PWA | Reads chain subscription status. Does not own global billing. |
| Store-specific staff, inventory, finance | Partner PWA | Consumes aggregate data. Does not mutate daily store operations in MVP. |
| POS order/payment operation | POS + Store Hub | Reads aggregate/synced data only. Does not create orders or capture payments. |
| Hub/POS health | Hub/POS/Sync services | Consumes heartbeat/sync metrics. Does not connect to LAN. |
| Compliance evidence and exports | File Service + DigitalOcean Spaces | Consumes signed upload/download/export. |
| AI summaries/insights | KitLuy AI Gateway | Consumes scoped AI BI. Tool calls audited. |
| Payment connector | ABA PayWay/KHQR connector | Future B2B/subscription visibility only; not POS capture. |
| Notifications | Notification Service | Sends chain/store alerts. |
| ERP/back-office | Future connector/export | Not MVP dependency. |
| E-commerce/marketplace | Future connector | Not MVP dependency. |
| Logistics | Future generic connector | Not MVP dependency. |
| Loyalty | KitLuy-native/future connector | Phase 2 / not MVP dependency. |

---

## Part 3 — System Architecture & Topology

### 3.1 Topology Diagram

```text
                                      WAN / INTERNET
┌─────────────────────────────────────────────────────────────────────────────┐
│                         DIGITALOCEAN / SUPABASE CLOUD                      │
│                                                                             │
│  ┌─────────────────────────────┐       ┌────────────────────────────────┐  │
│  │ kitluy-chain-portal         │ HTTPS │ Supabase SGP1                  │  │
│  │ React + TypeScript + PWA    │──────▶│ - PostgreSQL                   │  │
│  │ DigitalOcean SGP1 hosting   │ WSS   │ - Auth / RLS                   │  │
│  └─────────────────────────────┘       │ - Realtime                     │  │
│                                        │ - Edge Functions               │  │
│  ┌─────────────────────────────┐       │ - pgvector metadata            │  │
│  │ kitluy-admin-pwa-portal     │──────▶│ - audit/events/sync tables     │  │
│  └─────────────────────────────┘       └───────────────┬────────────────┘  │
│                                                        │                   │
│  ┌─────────────────────────────┐                       │                   │
│  │ kitluy-partner-pwa-portal   │───────────────────────┘                   │
│  └─────────────────────────────┘                                           │
│                                                                             │
│  ┌─────────────────────────────┐       ┌────────────────────────────────┐  │
│  │ KitLuy File Service         │──────▶│ DigitalOcean Spaces            │  │
│  │ signed upload/download      │       │ evidence / exports / docs      │  │
│  └─────────────────────────────┘       └────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────┐       ┌────────────────────────────────┐  │
│  │ KitLuy AI Gateway           │──────▶│ DigitalOcean Inference Engine  │  │
│  │ RAG + MCP + prompt policy   │       │ first LLM layer                │  │
│  └──────────────┬──────────────┘       └────────────────────────────────┘  │
│                 │                                                           │
│  ┌──────────────▼──────────────┐                                           │
│  │ KitLuy MCP Server           │ approved tools / audited actions           │
│  └─────────────────────────────┘                                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                ▲
                                │ HTTPS sync / heartbeat / file queue
                                │ WAN can fail; stores continue locally
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              STORE LAN                                      │
│                                                                             │
│  ┌─────────────────────────────┐       LAN       ┌───────────────────────┐ │
│  │ Store Hub / Pi 5            │◀───────────────▶│ POS Desktop           │ │
│  │ local PostgreSQL            │                 │ order/payment/print    │ │
│  │ sync agent / hub API        │                 └───────────────────────┘ │
│  │ heartbeat / file queue      │                 ┌───────────────────────┐ │
│  └──────────────┬──────────────┘◀───────────────▶│ POS Mobile            │ │
│                 │                                │ scan/status/pickup     │ │
│                 │                                └───────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

Chain Portal is 100% WAN/cloud. It never connects directly to store LAN or device IPs. It reads cloud-reported data that Store Hub has synced.

### 3.2 Data Flow Maps

#### Flow A — Chain owner loads Overview

1. Browser opens `https://[REQUIRED: chain domain]/overview`.
2. Chain Portal loads static PWA shell from DigitalOcean SGP1.
3. Supabase Auth session is validated.
4. Client calls `GET /chain-dashboard-summary` edge function.
5. Function resolves `current_user_id` and chain memberships.
6. Function queries chain stores, order rollups, payment rollups, issue metrics, sync freshness, active service pauses, and alerts.
7. Function returns scoped dashboard payload.
8. Client subscribes to Realtime channels for chain alerts and sync freshness.
9. UI renders KPIs with `as_of` timestamps and stale warnings.

#### Flow B — Master catalog push to stores

1. Chain Owner opens Catalog Control.
2. Chain Owner edits master service or creates a Catalog Version.
3. Chain Owner selects target scope: all stores, branch group, selected stores, or franchise group.
4. Client calls `POST /chain-catalog-push-preview`.
5. Edge function validates chain ownership, target stores, price rules, locked fields, stale store states, and existing active emergency pauses.
6. Preview returns target count, warnings, conflicts, and stores that are stale/offline.
7. Chain Owner confirms.
8. Client calls `POST /chain-catalog-push` with idempotency key.
9. Edge function writes `catalog_push_batches` and `catalog_push_targets`.
10. Store-specific service records or catalog projections are updated in cloud.
11. Domain event `chain_catalog_pushed` is emitted.
12. Store Hub pulls updated catalog during downstream sync.
13. POS uses updated effective store services after local sync.
14. Chain Portal shows per-store push status.

#### Flow C — Store emergency pauses a service

1. Store manager opens Partner PWA or POS manager screen.
2. Manager selects service, such as Dry Clean, and chooses Emergency Pause.
3. UI requires reason code, optional note, customer message, and duration/expiry.
4. Client calls `POST /store-service-availability-set` with store-scoped auth.
5. Function validates store permission, chain policy, service existence, and override type.
6. Function writes `store_service_availability_overrides`.
7. Effective service view recalculates the final availability.
8. POS hides/blocks the paused service on next local sync or immediate Hub notification.
9. Domain event `store_service_emergency_paused` is emitted.
10. Chain Portal receives alert and displays the branch in Service Availability matrix.
11. Active pause remains active even if Chain HQ pushes a catalog version. Catalog definition updates, but pause is preserved.

#### Flow D — Branch performance report

1. Chain user opens Branches -> Compare.
2. Client calls `GET /chain-branch-compare` with date range, branch IDs, and metric list.
3. Function validates membership and role.
4. Function reads reporting views from orders, payments, laundry status, issues, and sync freshness.
5. Function excludes or labels stale stores based on sync age.
6. Response includes totals, per-branch metrics, freshness state, and `generated_at`.
7. UI renders table/chart and export option.

#### Flow E — Franchisee and agreement onboarding

1. Admin PWA confirms Tenant, Chain, and Store records exist.
2. Chain Owner creates Franchisee business record through `POST /chain-franchisee-create`.
3. Chain Owner or Chain Manager creates a draft Franchise Agreement with billing mode, royalty rule, dates, and linked Stores.
4. Backend validates all Stores belong to the same Tenant, Chain, and `laundry` vertical.
5. Signed agreement evidence is uploaded through File Service.
6. Agreement becomes `active` only after required fields, signature evidence, and start date pass validation.
7. Domain events and immutable audit rows are written.

#### Flow F — Scheduled compliance audit and corrective action

1. Chain Manager publishes a versioned Compliance Template.
2. Regional Manager creates an Audit Assignment for a Store and Field Auditor.
3. Field Auditor opens the assignment, captures answers, notes, and evidence assets.
4. `POST /chain-compliance-submit` computes weighted score and evaluates Critical Fail rules.
5. Submitted audit becomes immutable.
6. Failed/low-scoring items create Corrective Actions with severity-based due dates.
7. Store manager uploads resolution evidence.
8. Regional Manager or Field Auditor verifies closure; audit and corrective-action history remain append-only.

#### Flow G — Royalty preview, lock, and adjustment

1. Finance Manager selects a closed reporting period and Franchisees.
2. Backend reads synced financial projections from eligible Franchise Stores.
3. Data Freshness Gate identifies stale or missing Stores.
4. Preview calculates gross/net bases and royalty formulas without persistence.
5. Finance Manager creates a draft Royalty Run and reviews Store-level lines.
6. Authorized actor locks the run; header and lines become immutable.
7. Later corrections are posted as Royalty Adjustments, never direct edits.
8. Statement export is generated through File Service.

#### Flow H — Catalog exception and price guardrail

1. Store manager requests a local price or service-rule exception.
2. Backend validates requested value against HQ control level and Price Guardrail.
3. Approval-required requests remain non-effective until Chain approval.
4. Chain Manager approves/rejects with note and expiry.
5. Effective Store Service projection merges Catalog Assignment, approved exception, and operational availability.
6. Store Hub/POS receive the new projection through normal sync.
7. Expired exceptions automatically stop affecting effective price/configuration.

### 3.3 Offline-First Protocol

Chain Portal itself is online-only for business data. It can cache the static PWA shell, but it must not cache sensitive chain data for offline use and must not perform offline mutations.

Offline-first behavior belongs to Store Hub and POS:

| Layer | Behavior |
|---|---|
| POS Desktop/Mobile | Writes orders/payments/status to Store Hub first. Reads active services from local Hub projection. |
| Store Hub | Writes local events to PostgreSQL and queues sync events. Pulls catalog/service updates from cloud. Pushes orders/heartbeats/status back to cloud. |
| Cloud backend | Receives synced data, records idempotency keys, resolves conflicts, updates reporting views. |
| Chain Portal | Reads cloud data and labels freshness. Does not assume missing/stale store data equals zero activity. |

Required Chain Portal freshness states:

| State | Meaning |
|---|---|
| `fresh` | Store synced within threshold. Default threshold: `[REQUIRED: define; recommended <= 2 minutes for heartbeat, <= 5 minutes for reporting]`. |
| `stale` | Store has not synced within reporting threshold. Reports must show `as_of`. |
| `pending_sync` | Store has unsynced local events known from sync queue metadata. |
| `offline` | Hub heartbeat missing beyond offline threshold. |
| `unknown` | Store not yet paired or no heartbeat ever received. |

Conflict resolution principles:

| Data class | Rule |
|---|---|
| Catalog version | Immutable after publish. New changes create a new version. |
| Catalog push batch | Append-only lifecycle. Retry creates new attempt rows or updates status only. |
| Store service availability | Latest active override by effective time wins, but all history is retained. |
| Emergency pause during catalog push | Catalog definition updates, active store pause remains active until expiry/re-enable. |
| Brand standards | Versioned. Publish creates a new version. |
| Financial/royalty rows | Append-only after lock. Corrections use adjustment rows. |
| Compliance audit | Submitted audit is append-only except allowed corrective action updates. |

### 3.4 Hardware Placement

Chain Portal has no local hardware footprint. It depends on store hardware data already synced to cloud.

| Component | Where it runs | Chain Portal relationship |
|---|---|---|
| Chain Portal PWA | DigitalOcean SGP1 / browser | Primary product. |
| Store Hub | Store LAN, Raspberry Pi 5 8GB + NVMe | Emits heartbeat and sync data; receives catalog downstream. |
| POS Desktop | Store LAN, terminal/Pi/Electron | Uses effective store services, creates orders and payments. |
| POS Mobile | Store LAN/WAN mobile device | Uses same effective service logic. |
| Receipt/tag printers | Store LAN/USB/Bluetooth depending device | Chain only sees device health summary if reported. |
| Scale/scanner | Store hardware | Chain reads no direct input. |
| UPS | Store hardware | Chain may display hardware profile if Admin records it. |

### 3.5 Environment Promotion

| Environment | Purpose | Data | Deployment rule |
|---|---|---|---|
| Local | Developer iteration | Seed/demo data only | Supabase local + mock connectors. |
| Dev Cloud | Shared integration | Non-production sample tenants | Auto-deploy from development branch allowed. |
| Staging | Pre-production QA | Sanitized or generated data | Mirrors prod migrations and secrets shape. Release candidate only. |
| Production | Live customers | Real data | Manual approval required for migrations, edge function deploys, and feature flags. |

Promotion rules: migrations move local -> dev -> staging -> production; production migrations are forward-only; secrets are configured per environment; Chain Portal frontend deploys after migrations/functions are verified; feature flags gate Phase 1.5/Phase 2 modules.

---

## Part 4 — External Contracts & Integrations

### 4.1 Supabase Auth / Identity

#### 4.1.1 Purpose

Chain Portal uses Supabase Auth for portal user authentication, session management, and JWT validation. Chain users are scoped through `kitluy_chain.chain_user_roles` and core tenant memberships.

#### 4.1.2 Authentication

| Item | Rule |
|---|---|
| Portal auth method | Supabase Auth. Phone OTP and/or email/password depending HET policy. `[REQUIRED: final auth methods]` |
| Session | JWT with server-side role resolution. |
| MFA | `[REQUIRED: decide whether chain_owner and finance_manager require MFA]`. |
| Scope check | Edge functions resolve chain membership server-side. Client-side role display is not security. |

#### 4.1.3 Request / Response Contracts

Business functions use `Authorization: Bearer <jwt>`.

```json
{
  "user_id": "uuid",
  "tenant_id": "uuid",
  "chain_memberships": [
    {
      "chain_id": "uuid",
      "role": "chain_owner",
      "branch_group_ids": ["uuid"],
      "store_ids": ["uuid"]
    }
  ],
  "expires_at": "2026-07-03T10:00:00+07:00"
}
```

#### 4.1.4 Error Handling & Retry Policy

| Error | Behavior |
|---|---|
| Expired token | Redirect to login; preserve return URL. |
| Missing chain membership | Show access denied and support contact. |
| Auth service unavailable | Show maintenance/error page; retry session check with exponential backoff up to 3 attempts. |

#### 4.1.5 Auth Events and Internal Hooks

Supabase Auth is not trusted as the sole business-role source. On `user.created`, `user.updated`, or `user.deleted`, an internal identity hook may queue membership reconciliation, but Chain access remains denied until an active `chain_user_roles` row exists. Hooks must verify the Supabase webhook signature or run as a database trigger owned by the backend migration.

Internal event envelope:

```json
{
  "event_id": "uuid",
  "event_type": "identity_user_updated",
  "occurred_at": "2026-07-13T16:00:00+07:00",
  "user_id": "uuid",
  "changed_fields": ["phone"],
  "source": "supabase_auth"
}
```

Replay is idempotent by `event_id`. Identity events never grant a Chain role automatically.

#### 4.1.6 Local, Staging, and Production Differences

| Environment | Auth behavior |
|---|---|
| Local | Supabase local Auth; generated test users; no real SMS/email. |
| Dev/Staging | Separate project and callback URLs; test OTP/email provider where available; synthetic users only. |
| Production | Approved phone/email provider, production redirect allowlist, MFA/session policy, and audit alerts. |


### 4.2 DigitalOcean Spaces + KitLuy File Service

#### 4.2.1 Purpose

Store compliance evidence, export files, statement PDFs, audit attachments, generated reports, and RAG source documents outside Supabase Storage.

#### 4.2.2 Authentication

| Secret | Used by |
|---|---|
| `DO_SPACES_ACCESS_KEY_ID` | File Service only. |
| `DO_SPACES_SECRET_ACCESS_KEY` | File Service only. |
| `DO_SPACES_BUCKET_CHAIN_FILES` | File Service config. |
| `DO_SPACES_REGION` | File Service config. |

Clients never receive Spaces credentials. They receive short-lived signed URLs.

#### 4.2.3 Request / Response Contracts

Request signed upload:

```http
POST /file-signed-upload-create
Authorization: Bearer <jwt>
Content-Type: application/json
```

```json
{
  "scope": "chain_compliance_evidence",
  "chain_id": "uuid",
  "store_id": "uuid",
  "filename": "branch-b-machine-photo.jpg",
  "mime_type": "image/jpeg",
  "size_bytes": 1048576,
  "sha256": "hex"
}
```

Response:

```json
{
  "asset_id": "uuid",
  "upload_url": "signed-url",
  "method": "PUT",
  "headers": {"Content-Type": "image/jpeg"},
  "expires_at": "2026-07-03T10:10:00+07:00"
}
```

#### 4.2.4 Error Handling & Retry Policy

| Failure | Policy |
|---|---|
| Signed URL expired | Request new signed URL. |
| Upload timeout | Retry up to 3 times with backoff: 1s, 3s, 10s. |
| Confirm hash mismatch | Mark upload rejected and request re-upload. |
| Spaces unavailable | Queue export/evidence job as failed-retryable; alert if failure rate > threshold. |

#### 4.2.5 File Events and Idempotency

DigitalOcean Spaces does not directly authorize KitLuy business access. File Service emits internal events after hash verification:

```json
{
  "event_id": "uuid",
  "event_type": "file_asset_confirmed",
  "asset_id": "uuid",
  "tenant_id": "uuid",
  "chain_id": "uuid",
  "scope": "chain_compliance_evidence",
  "sha256": "hex",
  "size_bytes": 1048576
}
```

`asset_id` and SHA-256 are the idempotency pair. A duplicate confirmation with the same hash returns the existing asset. A different hash for the same reserved asset returns `409`.

#### 4.2.6 Local, Staging, and Production Differences

| Environment | Storage behavior |
|---|---|
| Local | S3-compatible emulator or dedicated development bucket; generated files only. |
| Staging | Separate Spaces bucket/prefix, short retention, no production evidence. |
| Production | Private bucket, server-side encryption, lifecycle/retention policy, access logs, and backup/replication policy `[REQUIRED]`. |


### 4.3 ABA PayWay / KHQR Connector

#### 4.3.1 Purpose

Chain Portal does not capture counter POS payments. Payment connector may be used later for Chain subscription billing visibility, Chain B2B invoice collection, and payment health/status display through Integration Hub.

#### 4.3.2 Authentication

`ABA_PAYWAY_MERCHANT_ID`, `ABA_PAYWAY_API_KEY`, webhook signing secret. Raw credentials are stored only in secure environment/credential store and managed through Admin Integration Hub.

#### 4.3.3 Request / Response Contracts

B2B invoice payment link request, future:

```json
{
  "chain_id": "uuid",
  "b2b_invoice_id": "uuid",
  "amount_khr": 250000,
  "currency": "KHR",
  "customer_phone": "+855XXXXXXXX",
  "callback_url": "https://[domain]/api/payments/webhook"
}
```

Response:

```json
{
  "payment_request_id": "provider-id",
  "qr_url": "string",
  "payment_url": "string",
  "expires_at": "2026-07-03T23:59:00+07:00",
  "status": "pending"
}
```

#### 4.3.4 Error Handling & Retry Policy

| Error | Policy |
|---|---|
| Provider timeout | Retry read/status, not duplicate payment create, using idempotency key. |
| Invalid signature | Reject webhook with 401 and log security event. |
| Payment pending too long | Keep invoice `payment_pending`; show manual follow-up. |
| Provider outage | Circuit-breaker after `[REQUIRED: threshold]`; notify finance/admin. |

#### 4.3.5 Payment Webhook Contract

Future ABA/PayWay webhook receiver:

```http
POST /payments/aba/webhook
Content-Type: application/json
X-ABA-Signature: <provider-signature>
X-Idempotency-Key: <provider-event-id>
```

```json
{
  "provider_event_id": "string",
  "payment_request_id": "string",
  "merchant_reference": "B2B-INVOICE-UUID",
  "amount_khr": 250000,
  "currency": "KHR",
  "status": "paid",
  "paid_at": "2026-07-13T16:00:00+07:00"
}
```

Verification order: raw-body signature -> merchant/reference lookup -> exact amount/currency check -> event-id replay check -> append payment event -> update invoice projection. Invalid amount or reference is quarantined, not auto-applied.

#### 4.3.6 Sandbox and Production Differences

| Environment | Behavior |
|---|---|
| Local | Mock adapter; deterministic success/pending/failure fixtures. |
| Staging | Provider sandbox credentials and callback domain; no real settlement. |
| Production | Production merchant credentials, signed webhook, reconciliation, and incident alerts. |

Exact ABA endpoint paths, signature algorithm, timeout, and credential rotation are `[REQUIRED: confirm from approved ABA PayWay merchant documentation before implementation]`.


### 4.4 KitLuy AI Gateway / DigitalOcean Inference Engine

#### 4.4.1 Purpose

Power Chain AI BI: branch summaries, anomaly explanations, catalog performance insights, compliance risk summaries, and drafted actions.

#### 4.4.2 Authentication

Chain Portal calls KitLuy AI Gateway with user JWT. AI Gateway calls DigitalOcean Inference Engine using server-side provider key. AI Gateway enforces prompt policy and MCP tool permissions.

#### 4.4.3 Request / Response Contracts

```json
{
  "chain_id": "uuid",
  "prompt": "Why is Branch B revenue down this week?",
  "context": {
    "date_range": {"from": "2026-07-01", "to": "2026-07-03"},
    "store_ids": ["uuid"]
  },
  "mode": "explain"
}
```

```json
{
  "request_id": "uuid",
  "answer": "Branch B appears lower mainly because Dry Clean was emergency-paused for 2 days and Express Service was capacity limited.",
  "confidence": "medium",
  "sources": [
    {"type": "metric", "id": "branch_compare", "label": "Branch comparison report"},
    {"type": "event", "id": "uuid", "label": "store_service_emergency_paused"}
  ],
  "suggested_actions": [
    {"action_type": "draft_message", "requires_confirmation": true}
  ],
  "tool_calls": ["chain-branch-compare", "chain-service-availability-list"]
}
```

#### 4.4.4 Error Handling & Retry Policy

| Error | Policy |
|---|---|
| AI timeout | Return graceful failure and log. No automatic long retry from UI. |
| Policy violation | Return 403 with safe explanation. |
| Tool permission denied | Exclude tool and log denied tool call. |
| Provider error | Retry once through provider adapter; if fails, mark request failed. |
| Cost threshold exceeded | Stop request and return limit message. |

#### 4.4.5 AI Async Events and Tool Confirmation

AI responses may be synchronous or job-based. Async completion uses an internal event, not a client-trusted callback:

```json
{
  "event_id": "uuid",
  "event_type": "ai_request_completed",
  "ai_request_id": "uuid",
  "chain_id": "uuid",
  "status": "completed",
  "model_provider": "digitalocean_inference",
  "input_tokens": 1200,
  "output_tokens": 420,
  "tool_call_count": 2
}
```

Draft actions have `requires_confirmation=true`; an AI completion event never performs a sensitive mutation by itself. Tool calls use their own idempotency key and audit row.

#### 4.4.6 Sandbox and Production Differences

| Environment | AI behavior |
|---|---|
| Local | Mock provider and deterministic fixture responses; no cost. |
| Staging | Non-production model endpoint, synthetic/sanitized data, low quotas. |
| Production | Approved model/provider routing, cost caps, retention/redaction policy, and audited tool execution. |


### 4.5 Notification Service

#### 4.5.1 Purpose

Send in-app/Telegram/SMS/email/push alerts for catalog push failures, store service emergency pauses, expired pauses, key service disabled too long, compliance audit failures, royalty runs, B2B overdue invoices, and stale/offline branches.

#### 4.5.2 Authentication

Chain Portal never stores channel credentials. It authenticates to `kitluy-notification-service` with a short-lived internal service token or signed service JWT. The Notification Service resolves provider credentials by Tenant/connector configuration managed in Admin Integration Hub. Recipient consent, channel eligibility, and template authorization are checked server-side.

#### 4.5.3 Request / Response Contracts

```json
{
  "recipient_scope": "chain_role",
  "chain_id": "uuid",
  "role": "regional_manager",
  "template_key": "service_emergency_paused",
  "channels": ["in_app", "telegram"],
  "payload": {
    "store_name": "Branch B",
    "service_name": "Dry Clean",
    "reason": "machine_down",
    "ends_at": "2026-07-03T18:00:00+07:00"
  }
}
```

```json
{
  "notification_batch_id": "uuid",
  "status": "queued",
  "recipient_count": 3
}
```

#### 4.5.4 Error Handling & Retry Policy

| Channel | Retry |
|---|---|
| In-app | Immediate DB write; retry once on transient DB error. |
| Telegram/SMS/email | Exponential backoff: 1m, 5m, 30m; then dead-letter. |
| Push | Provider retry policy; mark failed if token invalid. |

#### 4.5.5 Delivery Status Callbacks and Dead Letter

Provider delivery receipts are normalized into:

```json
{
  "provider": "telegram",
  "provider_message_id": "string",
  "notification_id": "uuid",
  "status": "delivered",
  "occurred_at": "2026-07-13T16:00:00+07:00",
  "failure_code": null
}
```

Callbacks verify provider-specific signatures where supported. Duplicate provider message/status pairs are ignored. Permanent failures, invalid tokens, and exhausted retries enter a dead-letter queue with redacted payload and operator action.

#### 4.5.6 Sandbox and Production Differences

| Environment | Notification behavior |
|---|---|
| Local | Console/in-app sink; no external delivery. |
| Staging | Test bot/numbers/emails and recipient allowlist. |
| Production | Approved provider credentials, consent checks, templates, rate limits, and delivery receipts. |


### 4.6 Maps / Geocoding

#### 4.6.1 Purpose

Maps may support branch visualization, address normalization, territory polygons, overlap checks, candidate location scoring, and future service zones. Core MVP branch list/catalog/compliance workflows must work without maps.

#### 4.6.2 Authentication

The selected provider key is held server-side in a map adapter. Browser-restricted public keys may be used only for map tiles after domain restriction. Provider selection is `[REQUIRED]`.

#### 4.6.3 Request / Response Contract

```json
{
  "request_id": "uuid",
  "address_text": "Street 123, Phnom Penh, Cambodia",
  "country": "KH",
  "language": "km",
  "chain_id": "uuid"
}
```

```json
{
  "request_id": "uuid",
  "lat": 11.5564,
  "lng": 104.9282,
  "formatted_address": "string",
  "confidence": "high",
  "provider_place_id": "string"
}
```

Territory polygons use GeoJSON `Polygon` or `MultiPolygon` in WGS84 (`EPSG:4326`). Overlap result returns intersection area and percentage; exact tolerance is `[REQUIRED: territory overlap tolerance]`.

#### 4.6.4 Error Handling and Retry

Timeout: 5 seconds. Retry only `429` and transient `5xx` up to two times with jittered backoff. Cache successful geocodes by normalized address/provider. On failure, retain entered address and show map unavailable; never block core Chain operation.

#### 4.6.5 Webhooks

No incoming map webhook is required in MVP. Batch geocoding jobs emit internal `geocode_completed` or `geocode_failed` events keyed by `request_id`.

#### 4.6.6 Sandbox and Production Differences

Local uses fixture coordinates; staging uses a restricted test key and low quota; production uses domain/IP-restricted credentials, billing alerts, and provider usage monitoring.

### 4.7 Integration Hub and Future Connector Contracts

#### 4.7.1 Generic Connector Envelope

Future connectors are disabled until registered and configured by Admin Integration Hub. Chain Portal receives status and may request approved actions through a provider-neutral envelope:

```json
{
  "connector_key": "loyalty|logistics|ecommerce|erp_export",
  "tenant_id": "uuid",
  "chain_id": "uuid",
  "operation": "string",
  "idempotency_key": "chn_<chain_id>_<operation>_<uuid>",
  "payload": {},
  "requested_by_user_id": "uuid"
}
```

Response:

```json
{
  "connector_request_id": "uuid",
  "status": "accepted|completed|failed|not_configured",
  "provider_reference": null,
  "retryable": false,
  "error_code": null
}
```

All connectors use server-side credentials, signed inbound webhooks when supported, append-only request/event logs, and dead-letter handling. Unknown/unconfigured connectors return `not_configured` without partial side effects.

#### 4.7.2 Loyalty Connector

**MVP status:** not an active dependency. A future connector may publish a Chain promotion/benefit definition or read aggregate loyalty performance. It must not expose cross-Chain member data or let Chain Portal mint value without the owning loyalty service's authorization.

Minimum future operations: `loyalty_program_status_get`, `loyalty_campaign_publish`, `loyalty_performance_read`. Provider webhook events normalize to `loyalty_campaign_activated`, `loyalty_campaign_failed`, and aggregate performance updates.

#### 4.7.3 Logistics Connector

**MVP status:** not an active dependency. Future operations may request pickup/delivery coverage or read aggregate SLA. Store Booking dispatch remains owned by POS/Partner/logistics workflow, not Chain Portal.

Minimum future operations: `coverage_check`, `service_level_list`, `aggregate_delivery_report`. Chain Portal may not dispatch a specific customer order unless a later product decision explicitly grants it.

#### 4.7.4 E-commerce / Marketplace Connector

**MVP status:** readiness only. The Chain Portal may later govern Chain-level channel eligibility, catalog policies, and availability feeds; Partner Integration Hub remains the Store opt-in surface. KitLuy is the merchant operating authority and the marketplace consumes projections rather than live Store database reads.

Minimum future operations: `channel_status_get`, `catalog_projection_publish`, `availability_projection_publish`, `channel_performance_read`. Customer orders flowing back into KitLuy require a separate idempotent order-ingest contract owned by the Integration service.

#### 4.7.5 ERP Export Connector

**MVP status:** export readiness only. Chain Portal produces signed CSV/JSON/PDF packages; it does not depend on SroulERP or any ERP to operate. Export contracts include schema version, Chain/Tenant scope, period, SHA-256, and generated asset ID.

#### 4.7.6 Sandbox and Production Rules

Local and staging use mocks or provider sandboxes with synthetic data. Production activation requires Admin approval, credential status `configured`, successful connection test, webhook verification test, documented retry/dead-letter policy, privacy review, and rollback/disable switch.


---

## Part 5 — Tech Stack & Repository Structure

### 5.1 Stack by Layer

| Layer | Technology |
|---|---|
| Chain Portal frontend | React + TypeScript + Vite + Tailwind CSS |
| PWA | Web app manifest + service worker for static shell only |
| Web state | TanStack Query for server state + Zustand for lightweight UI state |
| Forms / validation | React Hook Form + Zod |
| Charts/tables | `[REQUIRED: choose chart/table libraries]` |
| Backend database | Supabase PostgreSQL |
| Auth/RLS | Supabase Auth + PostgreSQL RLS |
| Edge Functions | Supabase Edge Functions / Deno TypeScript |
| Realtime | Supabase Realtime for alerts/freshness events |
| File storage | DigitalOcean Spaces via KitLuy File Service |
| AI | KitLuy AI Gateway + DigitalOcean Inference Engine |
| AI tools | KitLuy MCP Server |
| RAG | pgvector + RAG Indexer + Spaces source files |
| Notifications | KitLuy Notification Service |
| Hosting | DigitalOcean SGP1 App Platform/static hosting/CDN |
| CI/CD | `[REQUIRED: GitHub Actions / GitLab CI / DO deploy pipeline decision]` |
| Testing | Vitest, React Testing Library, Playwright, Supabase local, mocked connectors |
| Monitoring | Sentry `[REQUIRED: confirm]`, Supabase logs, DigitalOcean logs, custom health tables |

### 5.2 Repository Layout

```text
kitluy-suite/
  apps/
    admin-pwa-portal/
    chain-portal/
      public/
        manifest.webmanifest
        icons/
      src/
        routes/
          overview/
          branches/
          catalog/
          standards/
          availability/
          compliance/
          franchise/
          royalties/
          b2b/
          promotions/
          loyalty/
          reports/
          ai/
          integrations/
          team/
          audit/
          settings/
        modules/
          catalog-control/
          service-availability/
          branch-performance/
          brand-standards/
          compliance/
          royalties/
          b2b/
        components/
        design-system/
        lib/
        services/
        auth/
        pwa/
        tests/
    partner-pwa-portal/
    partner-app/
    pos-desktop-app/
    pos-mobile-app/
  services/
    file-service/
    ai-gateway/
    mcp-server/
    rag-indexer/
    notification-service/
    hub-agent/
  supabase/
    migrations/
    functions/
  packages/
    shared-ui/
    shared-types/
    shared-utils/
    auth/
    rbac/
    money/
    i18n/
    api-contracts/
  docs/
    rebuild-bibles/
      kitluy-chain-portal-rebuild-bible-v2.0.0.md
```

### 5.3 Build & Deploy Pipeline

| Artifact | Build | Deploy |
|---|---|---|
| Chain Portal | `pnpm install && pnpm --filter chain-portal build` | DigitalOcean App Platform/static hosting/CDN |
| Edge Functions | `supabase functions deploy <slug>` | Supabase project |
| Migrations | SQL | Authorized BE/operator applies in order |
| File/AI/MCP services | Docker/Node build `[REQUIRED: final service runtime]` | DigitalOcean App Platform/Droplet/Kubernetes `[REQUIRED]` |
| Tests | `pnpm test`, Playwright, Supabase local tests | CI pipeline before staging/prod |

Production deployment order: apply migrations, seed baseline data, deploy edge functions, deploy service dependencies, run smoke API tests, deploy Chain Portal frontend, verify health checks/logs, enable feature flags.

### 5.4 Secrets Inventory

| Secret | Purpose | Consumed by | Rotation |
|---|---|---|---|
| `SUPABASE_URL` | Supabase API URL | clients/services | On project change |
| `SUPABASE_ANON_KEY` | Client Supabase access | Chain Portal | On project key rotation |
| `SUPABASE_SERVICE_ROLE_KEY` | Privileged server functions | Edge Functions/services only | 90 days or incident |
| `DO_SPACES_ACCESS_KEY_ID` | Object storage access | File Service | 90 days or incident |
| `DO_SPACES_SECRET_ACCESS_KEY` | Object storage secret | File Service | 90 days or incident |
| `DO_SPACES_BUCKET_CHAIN_FILES` | Bucket name | File Service | On bucket change |
| `DO_INFERENCE_API_KEY` | LLM provider access | AI Gateway | 90 days or incident |
| `AI_GATEWAY_INTERNAL_TOKEN` | Service-to-service auth | Chain functions/AI Gateway | 90 days |
| `MCP_SERVER_INTERNAL_TOKEN` | AI tool server auth | AI Gateway/MCP | 90 days |
| `NOTIFICATION_SERVICE_TOKEN` | Notification service auth | Edge Functions | 90 days |
| `ABA_PAYWAY_MERCHANT_ID` | Future payment/B2B | Payment service | Provider policy |
| `ABA_PAYWAY_API_KEY` | Future payment/B2B | Payment service | Provider policy |
| `MAPS_PROVIDER_API_KEY` | Branch map/territory | Map service | Provider policy |
| `SENTRY_DSN` | Frontend error logging | Chain Portal | On project change |

Do not place service-role, DO Spaces, payment, AI, or map secrets in frontend bundles.

### 5.5 Permanently Removed Decisions

| Old / rejected item | Current v2 decision |
|---|---|
| Seller naming | Use Partner. |
| Netra as active AI dependency | Use KitLuy AI Gateway + DigitalOcean Inference Engine + RAG + MCP. |
| Rotanak as active loyalty dependency | No active dependency. Use KitLuy-native future loyalty/connector readiness. |
| HSAL as active logistics dependency | Generic future logistics connector only. |
| SroulERP as MVP dependency | Future export/readiness only. |
| Supabase Storage for heavy files | DigitalOcean Spaces via File Service. |
| Chain native mobile app in v2 MVP | Use responsive Chain Portal PWA first; field audit tablet mode in Phase 2. |
| HSA/B1/B2/B3 commission | Excluded from KitLuy. KitLuy is SaaS/subscription, 0% order commission. |

---

## Part 6 — Database Schema (Canonical)

### 6.1 Schema Inventory

| Schema | Owner | Purpose | Source migration |
|---|---|---|---|
| `kitluy_core` | Core backend | tenants, stores, users, memberships, base roles | `001_kitluy_core_schema.sql` |
| `kitluy_admin` | Admin PWA | provisioning/onboarding references used by Chain | `002_kitluy_admin_schema.sql` |
| `kitluy_chain` | Chain Portal | chain profile, branch groups, catalog, standards, availability, franchise, royalties, B2B, compliance | `003_kitluy_chain_schema.sql` |
| `kitluy_partner` | Partner PWA | store management read/projection; store-level settings | `004_kitluy_partner_schema.sql` |
| `kitluy_pos` | POS/Hub | registers, shifts, local POS projections | `005_kitluy_pos_schema.sql` |
| `kitluy_laundry` | Laundry vertical | laundry service/status/order workflow references | `006_kitluy_laundry_vertical_schema.sql` |
| `kitluy_orders` | Orders | synced order/order-line/status data | `007_kitluy_orders_payments_schema.sql` |
| `kitluy_payments` | Payments | tenders, payment status, finance read data | `007_kitluy_orders_payments_schema.sql` |
| `kitluy_devices` | Devices | Hub/POS/peripheral registry references | `008_kitluy_devices_sync_schema.sql` |
| `kitluy_sync` | Sync | heartbeats, sync queue, freshness state | `008_kitluy_devices_sync_schema.sql` |
| `kitluy_files` | File Service | asset metadata, exports, evidence | `009_kitluy_files_schema.sql` |
| `kitluy_ai` | AI Gateway | AI requests, tool calls, RAG metadata | `010_kitluy_ai_schema.sql` |
| `kitluy_events` | Events | domain events | `011_kitluy_events_audit_schema.sql` |
| `kitluy_audit` | Audit | immutable audit logs | `011_kitluy_events_audit_schema.sql` |
| `kitluy_integrations` | Integration Hub | connector registry/status read by Chain | `[REQUIRED: final integration migration]` |

### 6.2 Chain Table Specifications

**Schema authority note:** No production Chain v2 migration set was supplied with this handbook. The definitions below are the target canonical model for implementation. Once reviewed migration SQL exists, the reviewed live SQL becomes supreme for physical names, types, constraints, and foreign keys; any difference must move to Appendix C before release.

The tables below are canonical for Chain Portal v2. Engineering may split large tables into additional indexes/materialized views, but business meaning must remain equivalent.

#### 6.2.1 `kitluy_chain.chains`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | Owning tenant. |
| `chain_code` | text | no | | | Unique human code, e.g. `CHN-0001`. |
| `display_name` | text | no | | | Business-facing chain name. |
| `legal_name` | text | yes | | | Legal name if different. |
| `vertical_type` | text | no | `'laundry'` | | Immutable in v2. |
| `status` | chain_status | no | `'draft'` | | Draft/trial/active/suspended/cancelled. |
| `brand_logo_asset_id` | uuid | yes | | `kitluy_files.assets.id` | Optional logo. |
| `timezone` | text | no | `'Asia/Phnom_Penh'` | | Fixed default. |
| `currency_code` | text | no | `'KHR'` | | KHR MVP. |
| `settings_json` | jsonb | no | `'{}'` | | Non-critical UI/settings. |
| `created_at` | timestamptz | no | `now()` | | |
| `updated_at` | timestamptz | no | `now()` | | Trigger maintained. |

Constraints: `unique(tenant_id, chain_code)`, immutable `vertical_type`, RLS by active chain membership.

#### 6.2.2 `kitluy_chain.chain_stores`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | Linked store. |
| `branch_group_id` | uuid | yes | | `kitluy_chain.branch_groups.id` | Optional grouping. |
| `franchisee_id` | uuid | yes | | `kitluy_chain.franchisees.id` | Optional. |
| `store_relationship_type` | store_relationship_type | no | `'company_owned'` | Company-owned/franchisee/partner-operated. |
| `status` | chain_store_status | no | `'active'` | Active/suspended/pending_removed. |
| `joined_at` | timestamptz | no | `now()` | | |
| `removed_at` | timestamptz | yes | | | Soft unlink timestamp. |

Constraints: `unique(chain_id, store_id)` where `removed_at is null`; store vertical must equal chain vertical. Admin provisions stores; Chain groups/labels linked stores but cannot create platform stores.

#### 6.2.3 `kitluy_chain.branch_groups`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `name` | text | no | | | Example: Phnom Penh. |
| `description` | text | yes | | | |
| `sort_order` | int | no | `0` | | |
| `is_active` | boolean | no | `true` | | |
| `created_at` | timestamptz | no | `now()` | | |
| `updated_at` | timestamptz | no | `now()` | | |

#### 6.2.4 `kitluy_chain.chain_user_roles`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `user_id` | uuid | no | | `auth.users.id` | |
| `role` | chain_user_role | no | | | Chain Owner, Chain Manager, Regional Manager, etc. |
| `branch_group_ids` | uuid[] | yes | | | Scope for regional roles. |
| `store_ids` | uuid[] | yes | | | Optional direct store scope. |
| `status` | user_role_status | no | `'active'` | | |
| `created_by_user_id` | uuid | yes | | `auth.users.id` | |
| `disabled_at` | timestamptz | yes | | | |

#### 6.2.5 `kitluy_chain.master_services`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `service_code` | text | no | | | Unique per chain. |
| `name` | text | no | | | Display name. |
| `khmer_name` | text | yes | | | Khmer display when available. |
| `service_category` | laundry_service_category | no | | wash_fold, dry_clean, pressing, etc. |
| `pricing_model` | laundry_pricing_model | no | | per_kg/per_piece/flat/add_on. |
| `base_price_khr` | integer | no | `0` | | KHR integer. |
| `min_price_khr` | integer | yes | | | Optional floor. |
| `max_price_khr` | integer | yes | | | Optional ceiling. |
| `is_add_on` | boolean | no | `false` | | |
| `hq_enabled` | boolean | no | `true` | | Whether HQ allows service. |
| `control_level` | catalog_control_level | no | `'hq_locked'` | Store edit control. |
| `default_due_hours` | integer | yes | | | Service promise. |
| `metadata_json` | jsonb | no | `'{}'` | | |
| `archived_at` | timestamptz | yes | | | Soft archive. |

Constraints: `unique(chain_id, service_code)`, `base_price_khr >= 0`, `min_price_khr <= max_price_khr` when both set.

#### 6.2.6 `kitluy_chain.catalog_versions`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `version_label` | text | no | | Example `v2026.07.03-001`. |
| `version_number` | integer | no | | Incrementing per chain. |
| `status` | catalog_version_status | no | `'draft'` | draft/published/archived. |
| `snapshot_json` | jsonb | no | | Immutable service snapshot. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `published_at` | timestamptz | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

Published versions are immutable. New changes create a new version.

#### 6.2.7 `kitluy_chain.catalog_push_batches`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `catalog_version_id` | uuid | no | | `kitluy_chain.catalog_versions.id` | |
| `target_scope` | catalog_push_scope | no | | all_stores/branch_group/selected_stores/franchisee. |
| `status` | catalog_push_status | no | `'queued'` | queued/running/completed/partial_failed/failed/rolled_back. |
| `target_count` | integer | no | `0` | | |
| `applied_count` | integer | no | `0` | | |
| `failed_count` | integer | no | `0` | | |
| `stale_count` | integer | no | `0` | | |
| `preserved_pause_count` | integer | no | `0` | | Active pauses kept. |
| `requested_by_user_id` | uuid | no | | `auth.users.id` | |
| `reason_note` | text | yes | | | Required for sensitive changes if configured. |
| `started_at` | timestamptz | yes | | | |
| `completed_at` | timestamptz | yes | | | |

#### 6.2.8 `kitluy_chain.catalog_push_targets`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `batch_id` | uuid | no | | `catalog_push_batches.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `target_status` | catalog_push_target_status | no | `'pending'` | pending/applied/skipped/stale/failed/rolled_back. |
| `error_code` | text | yes | | | |
| `error_message` | text | yes | | | |
| `active_pause_preserved` | boolean | no | `false` | | |
| `applied_at` | timestamptz | yes | | | |

#### 6.2.9 `kitluy_chain.store_service_availability_overrides`

This table implements the store-level enable/disable/emergency pause rule.

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `service_id` | uuid | no | | `kitluy_chain.master_services.id` | Chain-pushed service. |
| `catalog_version_id` | uuid | yes | | `kitluy_chain.catalog_versions.id` | Version when override created. |
| `override_type` | service_availability_override_type | no | | disable/enable/emergency_pause/scheduled_unavailable. |
| `reason_code` | service_availability_reason_code | no | | Required. |
| `reason_note` | text | yes | | | Optional but recommended. |
| `customer_message` | text | yes | | | Optional customer-facing message. |
| `starts_at` | timestamptz | no | `now()` | | |
| `ends_at` | timestamptz | yes | | | Null means manual re-enable required. |
| `is_active` | boolean | no | `true` | | |
| `approval_status` | override_approval_status | no | `'not_required'` | not_required/pending/approved/rejected. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `created_from` | override_source | no | | partner_pwa/pos_desktop/pos_mobile/chain_portal/admin_support. |
| `re_enabled_by_user_id` | uuid | yes | | `auth.users.id` | |
| `re_enabled_at` | timestamptz | yes | | | |
| `audit_event_id` | uuid | yes | | `kitluy_audit.audit_logs.id` | |

Rules: Store can always emergency-pause a service if chain policy permits emergency overrides. Default Chain v2 policy: HQ controls definition/pricing; store controls operational availability with reason/audit. Catalog push must not automatically clear active emergency pauses.

#### 6.2.10 `kitluy_chain.effective_store_services`

This is a view or materialized view used by Partner/POS/Chain.

| Column | Type | Notes |
|---|---|---|
| `chain_id` | uuid | Chain. |
| `store_id` | uuid | Branch/store. |
| `service_id` | uuid | Master service. |
| `catalog_version_id` | uuid | Current version. |
| `hq_enabled` | boolean | From master service/version. |
| `store_enabled` | boolean | Derived from latest enable/disable override. |
| `emergency_disabled` | boolean | True if active emergency pause. |
| `availability_state` | effective_service_state | available/unavailable/emergency_paused/scheduled_unavailable/hq_disabled. |
| `reason_code` | text | Active unavailable reason. |
| `customer_message` | text | Optional. |
| `available_from` | timestamptz | Optional. |
| `available_until` | timestamptz | Optional. |
| `last_changed_at` | timestamptz | Source change time. |

Effective availability formula:

```text
effective_available =
  hq_enabled = true
  AND store_enabled = true
  AND emergency_disabled = false
  AND current_time is inside any configured availability window
```

#### 6.2.11 `kitluy_chain.catalog_store_assignments`

Tracks the effective Catalog Version assigned to each Store and provides deterministic rollback history.

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | Tenant scope. |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | Chain scope. |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | Target Store. |
| `catalog_version_id` | uuid | no | | `kitluy_chain.catalog_versions.id` | Assigned immutable version. |
| `source_push_batch_id` | uuid | yes | | `kitluy_chain.catalog_push_batches.id` | Push that created assignment. |
| `previous_assignment_id` | uuid | yes | | self | Rollback lineage. |
| `status` | catalog_assignment_status | no | `'pending'` | | pending/applied/failed/rolled_back/superseded. |
| `applied_at` | timestamptz | yes | | | Cloud application time. |
| `hub_acknowledged_at` | timestamptz | yes | | | Store Hub acknowledgement. |
| `failure_code` | text | yes | | | Stable machine code. |
| `failure_detail` | text | yes | | | Redacted operator detail. |
| `created_at` | timestamptz | no | `now()` | | |

Constraint: one non-superseded current assignment per `(chain_id, store_id)`. Assignment does not clear active service availability overrides.

#### 6.2.12 `kitluy_chain.master_service_addons`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | Primary key. |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `service_id` | uuid | no | | `kitluy_chain.master_services.id` | Parent service. |
| `addon_code` | text | no | | | Unique per service. |
| `name` | text | no | | | English/business-facing name. |
| `khmer_name` | text | yes | | | Khmer label. |
| `price_khr` | integer | no | `0` | | Integer KHR. |
| `control_level` | catalog_control_level | no | `'hq_locked'` | | Local edit policy. |
| `is_required` | boolean | no | `false` | | Whether automatically included. |
| `hq_enabled` | boolean | no | `true` | | HQ availability. |
| `sort_order` | integer | no | `0` | | |
| `archived_at` | timestamptz | yes | | | Soft archive. |

Constraints: `price_khr >= 0`, `unique(service_id, addon_code)`.

#### 6.2.13 `kitluy_chain.brand_standards`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `standard_type` | brand_standard_type | no | | | Receipt, tag, workflow, pricing, hours, quality, availability, customer message. |
| `version_number` | integer | no | | | Monotonic per chain/type. |
| `title` | text | no | | | |
| `status` | brand_standard_status | no | `'draft'` | | draft/published/archived. |
| `rules_json` | jsonb | no | `'{}'` | | Versioned validated rules. |
| `target_scope_json` | jsonb | no | `'{}'` | | All Stores, groups, Franchisees, selected Stores. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `published_at` | timestamptz | yes | | | Published versions immutable. |
| `created_at` | timestamptz | no | `now()` | | |

Constraint: `unique(chain_id, standard_type, version_number)`.

#### 6.2.14 `kitluy_chain.override_policies`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `policy_scope` | override_policy_scope | no | | | service_price/service_availability/due_hours/business_hours/template/workflow. |
| `control_level` | catalog_control_level | no | | | |
| `requires_reason` | boolean | no | `true` | | |
| `requires_expiry` | boolean | no | `true` | | |
| `max_duration_hours_without_approval` | integer | yes | | | Null means no unapproved override. |
| `min_price_khr` | integer | yes | | | Optional guardrail. |
| `max_price_khr` | integer | yes | | | Optional guardrail. |
| `approval_role` | chain_user_role | yes | | | Minimum approver. |
| `is_active` | boolean | no | `true` | | |
| `updated_at` | timestamptz | no | `now()` | | |

#### 6.2.15 `kitluy_chain.franchisees`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `franchisee_code` | text | no | | | Unique human code. |
| `display_name` | text | no | | | |
| `legal_name` | text | yes | | | |
| `operator_type` | franchise_operator_type | no | `'independent_franchisee'` | | |
| `status` | franchisee_status | no | `'prospect'` | | |
| `contact_name` | text | yes | | | |
| `phone_e164` | text | yes | | | Cambodia format `+855...`. |
| `email` | text | yes | | | |
| `billing_mode` | franchise_billing_mode | no | `'brand_consolidated'` | | |
| `metadata_json` | jsonb | no | `'{}'` | | Non-authoritative extra metadata. |
| `created_at` | timestamptz | no | `now()` | | |
| `updated_at` | timestamptz | no | `now()` | | |

Constraint: `unique(chain_id, franchisee_code)`.

#### 6.2.16 `kitluy_chain.franchise_agreements`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `franchisee_id` | uuid | no | | `kitluy_chain.franchisees.id` | |
| `agreement_no` | text | no | | | Unique per chain. |
| `status` | franchise_agreement_status | no | `'draft'` | | |
| `starts_on` | date | no | | | |
| `ends_on` | date | yes | | | Null for open-ended agreement. |
| `billing_mode` | franchise_billing_mode | no | | | |
| `royalty_rule_id` | uuid | yes | | `kitluy_chain.royalty_rules.id` | Required before royalty calculation. |
| `territory_id` | uuid | yes | | `kitluy_chain.territories.id` | Phase 2 optional. |
| `signed_asset_id` | uuid | yes | | `kitluy_files.assets.id` | Agreement PDF/image. |
| `terms_json` | jsonb | no | `'{}'` | | Validated non-financial clauses/metadata. |
| `activated_at` | timestamptz | yes | | | |
| `terminated_at` | timestamptz | yes | | | |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `created_at` | timestamptz | no | `now()` | | |

Guards: `ends_on >= starts_on`; active agreement requires signed evidence if policy demands it; Store links must fall within Chain/Tenant/vertical scope.

#### 6.2.17 `kitluy_chain.territories`

Phase 2 geographic governance table. Core multi-store/franchise operation does not depend on maps.

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `territory_code` | text | no | | | Unique per Chain. |
| `name` | text | no | | | |
| `geometry_geojson` | jsonb | no | | | Valid WGS84 Polygon/MultiPolygon. |
| `status` | territory_status | no | `'draft'` | | |
| `assigned_franchisee_id` | uuid | yes | | `kitluy_chain.franchisees.id` | |
| `overlap_tolerance_bps` | integer | no | `0` | | Approved overlap tolerance. |
| `created_at` | timestamptz | no | `now()` | | |
| `updated_at` | timestamptz | no | `now()` | | |

Constraint: `unique(chain_id, territory_code)`; geometry validation occurs in function/DB extension selected by backend.

#### 6.2.18 `kitluy_chain.royalty_rules`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `name` | text | no | | | |
| `rule_type` | royalty_rule_type | no | | | |
| `rate_bps` | integer | yes | | | 100 bps = 1%. |
| `fixed_fee_khr` | integer | no | `0` | | Hybrid/fixed component. |
| `minimum_floor_khr` | integer | no | `0` | | |
| `tiers_json` | jsonb | no | `'[]'` | | Ordered thresholds for tiered rule. |
| `base_type` | royalty_base_type | no | `'net_sales'` | | gross_sales/net_sales. |
| `status` | royalty_rule_status | no | `'draft'` | | |
| `effective_from` | date | yes | | | |
| `effective_to` | date | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

Constraints: non-negative KHR; `rate_bps between 0 and 10000`; published rules immutable.

#### 6.2.19 `kitluy_chain.royalty_runs`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `run_no` | text | no | | | Unique per chain. |
| `period_start` | date | no | | | Inclusive. |
| `period_end` | date | no | | | Inclusive. |
| `status` | royalty_run_status | no | `'draft'` | | |
| `currency_code` | text | no | `'KHR'` | | |
| `gross_sales_khr` | bigint | no | `0` | | Aggregate snapshot. |
| `net_sales_khr` | bigint | no | `0` | | Aggregate snapshot. |
| `royalty_amount_khr` | bigint | no | `0` | | Before later adjustments. |
| `adjustment_total_khr` | bigint | no | `0` | | Sum append-only adjustments. |
| `stale_store_count` | integer | no | `0` | | Freshness evidence. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `reviewed_by_user_id` | uuid | yes | | `auth.users.id` | |
| `locked_by_user_id` | uuid | yes | | `auth.users.id` | |
| `locked_at` | timestamptz | yes | | | Locked records immutable. |
| `created_at` | timestamptz | no | `now()` | | |

Constraint: no overlapping locked runs for the same Franchisee/Store/period through run-line uniqueness.

#### 6.2.20 `kitluy_chain.royalty_run_lines`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `run_id` | uuid | no | | `kitluy_chain.royalty_runs.id` | |
| `franchisee_id` | uuid | no | | `kitluy_chain.franchisees.id` | |
| `agreement_id` | uuid | no | | `kitluy_chain.franchise_agreements.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `royalty_rule_id` | uuid | no | | `kitluy_chain.royalty_rules.id` | Snapshot reference. |
| `gross_sales_khr` | bigint | no | `0` | | |
| `discounts_khr` | bigint | no | `0` | | |
| `refunds_khr` | bigint | no | `0` | | |
| `voids_khr` | bigint | no | `0` | | |
| `net_sales_khr` | bigint | no | `0` | | |
| `royalty_base_khr` | bigint | no | `0` | | |
| `royalty_amount_khr` | bigint | no | `0` | | |
| `source_freshness` | report_freshness_state | no | | | |
| `calculation_json` | jsonb | no | | | Exact formula inputs/output. |
| `created_at` | timestamptz | no | `now()` | | |

Locked parent Run makes lines immutable.

#### 6.2.21 `kitluy_chain.royalty_adjustments`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `run_id` | uuid | no | | `kitluy_chain.royalty_runs.id` | Must be locked. |
| `run_line_id` | uuid | yes | | `kitluy_chain.royalty_run_lines.id` | Optional Store-specific adjustment. |
| `amount_khr` | bigint | no | | | Signed integer; negative reduces due. |
| `reason_code` | royalty_adjustment_reason | no | | | |
| `reason_note` | text | no | | | Required. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `approved_by_user_id` | uuid | yes | | `auth.users.id` | Dual approval when policy requires. |
| `created_at` | timestamptz | no | `now()` | | |

Adjustments are append-only and cannot change the original calculation snapshot.

#### 6.2.22 `kitluy_chain.compliance_templates`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `template_code` | text | no | | | |
| `name` | text | no | | | |
| `version_number` | integer | no | | | |
| `status` | compliance_template_status | no | `'draft'` | | |
| `pass_threshold_bps` | integer | no | `8000` | | 8000 = 80.00%. |
| `critical_fail_enabled` | boolean | no | `true` | | |
| `published_at` | timestamptz | yes | | | Published version immutable. |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `created_at` | timestamptz | no | `now()` | | |

Constraint: `unique(chain_id, template_code, version_number)`.

#### 6.2.23 `kitluy_chain.compliance_template_items`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `template_id` | uuid | no | | `kitluy_chain.compliance_templates.id` | |
| `pillar` | compliance_pillar | no | | | |
| `item_code` | text | no | | | |
| `prompt` | text | no | | | |
| `max_score` | integer | no | `5` | | |
| `weight_bps` | integer | no | | | All active items total 10000. |
| `is_critical` | boolean | no | `false` | | A zero score can trigger Critical Fail. |
| `requires_evidence` | boolean | no | `false` | | |
| `sort_order` | integer | no | `0` | | |

Constraints: `max_score > 0`, `weight_bps between 1 and 10000`, unique item code per template.

#### 6.2.24 `kitluy_chain.compliance_audit_assignments`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `template_id` | uuid | no | | `kitluy_chain.compliance_templates.id` | Published template only. |
| `assigned_to_user_id` | uuid | no | | `auth.users.id` | Field Auditor/Regional Manager. |
| `scheduled_for` | date | no | | | |
| `due_at` | timestamptz | no | | | |
| `status` | audit_assignment_status | no | `'assigned'` | | |
| `created_by_user_id` | uuid | no | | `auth.users.id` | |
| `created_at` | timestamptz | no | `now()` | | |

#### 6.2.25 `kitluy_chain.compliance_audits`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `assignment_id` | uuid | yes | | `kitluy_chain.compliance_audit_assignments.id` | Ad hoc audits allowed if policy permits. |
| `template_id` | uuid | no | | `kitluy_chain.compliance_templates.id` | Version snapshot source. |
| `auditor_user_id` | uuid | no | | `auth.users.id` | |
| `status` | compliance_audit_status | no | `'draft'` | | |
| `score_bps` | integer | yes | | | 0-10000. |
| `result` | compliance_result | yes | | | pass/fail/critical_fail. |
| `critical_fail_count` | integer | no | `0` | | |
| `overall_note` | text | yes | | | |
| `submitted_at` | timestamptz | yes | | | Submitted audit immutable. |
| `reviewed_at` | timestamptz | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

#### 6.2.26 `kitluy_chain.compliance_audit_answers`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `audit_id` | uuid | no | | `kitluy_chain.compliance_audits.id` | |
| `template_item_id` | uuid | no | | `kitluy_chain.compliance_template_items.id` | |
| `score` | integer | no | | | 0 to item max score. |
| `note` | text | yes | | | |
| `evidence_asset_ids` | uuid[] | no | `'{}'` | `kitluy_files.assets.id` logically | DB trigger/function validates ownership. |
| `is_critical_fail` | boolean | no | `false` | | Derived. |
| `created_at` | timestamptz | no | `now()` | | |

Constraint: one answer per `(audit_id, template_item_id)`.

#### 6.2.27 `kitluy_chain.corrective_actions`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `store_id` | uuid | no | | `kitluy_core.stores.id` | |
| `audit_id` | uuid | no | | `kitluy_chain.compliance_audits.id` | |
| `audit_answer_id` | uuid | yes | | `kitluy_chain.compliance_audit_answers.id` | |
| `title` | text | no | | | |
| `severity` | corrective_action_severity | no | | critical/high/medium/low. |
| `status` | corrective_action_status | no | `'open'` | | |
| `assigned_to_user_id` | uuid | yes | | `auth.users.id` | Usually Store manager. |
| `due_at` | timestamptz | no | | | Derived from severity policy. |
| `resolution_note` | text | yes | | | Required to resolve. |
| `resolution_asset_ids` | uuid[] | no | `'{}'` | | Evidence. |
| `resolved_at` | timestamptz | yes | | | |
| `verified_by_user_id` | uuid | yes | | `auth.users.id` | Cannot equal assignee if segregation policy enabled. |
| `verified_at` | timestamptz | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

#### 6.2.28 `kitluy_chain.b2b_contracts`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `contract_no` | text | no | | | |
| `customer_name` | text | no | | | Hotel/spa/corporate. |
| `assigned_store_ids` | uuid[] | no | `'{}'` | | Validated Chain Stores. |
| `rate_card_json` | jsonb | no | | | Versioned negotiated rates. |
| `settlement_cycle` | b2b_settlement_cycle | no | `'monthly'` | | |
| `credit_limit_khr` | bigint | no | `0` | | |
| `status` | b2b_contract_status | no | `'draft'` | | |
| `starts_on` | date | no | | | |
| `ends_on` | date | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

#### 6.2.29 `kitluy_chain.b2b_invoices`

| Column | Type | Null | Default | FK | Notes |
|---|---|---:|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | | |
| `tenant_id` | uuid | no | | `kitluy_core.tenants.id` | |
| `chain_id` | uuid | no | | `kitluy_chain.chains.id` | |
| `contract_id` | uuid | no | | `kitluy_chain.b2b_contracts.id` | |
| `invoice_no` | text | no | | | Unique per chain. |
| `period_start` | date | no | | | |
| `period_end` | date | no | | | |
| `subtotal_khr` | bigint | no | `0` | | |
| `tax_khr` | bigint | no | `0` | | Tax stub until policy confirmed. |
| `total_khr` | bigint | no | `0` | | `subtotal + tax`. |
| `status` | b2b_invoice_status | no | `'draft'` | | |
| `file_asset_id` | uuid | yes | | `kitluy_files.assets.id` | Generated PDF. |
| `issued_at` | timestamptz | yes | | | |
| `due_at` | timestamptz | yes | | | |
| `paid_at` | timestamptz | yes | | | |
| `created_at` | timestamptz | no | `now()` | | |

### 6.3 Enum Catalog

```text
chain_status:
  draft, trial, active, suspended, cancelled, archived
chain_user_role:
  chain_owner, chain_manager, regional_manager, finance_manager, field_auditor, chain_analyst, chain_readonly
user_role_status:
  invited, active, disabled, expired
store_relationship_type:
  company_owned, franchisee, partner_operated
chain_store_status:
  pending, active, suspended, pending_removed, removed
laundry_service_category:
  wash_fold, wash_iron, dry_clean, press_only, ironing, stain_removal, bedding_blanket, express, add_on, other
laundry_pricing_model:
  per_kg, per_piece, flat, add_on
catalog_control_level:
  hq_locked, local_editable, approval_required, read_only, emergency_override_allowed
catalog_version_status:
  draft, published, archived
catalog_push_scope:
  all_stores, branch_group, selected_stores, franchisee
catalog_push_status:
  queued, running, completed, partial_failed, failed, rolled_back
catalog_push_target_status:
  pending, applied, skipped, stale, failed, rolled_back
catalog_assignment_status:
  pending, applied, failed, rolled_back, superseded
service_availability_override_type:
  disable, enable, emergency_pause, scheduled_unavailable
service_availability_reason_code:
  machine_down, staff_shortage, supply_out, power_issue, water_issue, capacity_full, quality_issue, safety_issue, holiday_or_closure, other
override_source:
  partner_pwa, partner_app, pos_desktop, pos_mobile, chain_portal, admin_support, system
override_approval_status:
  not_required, pending, approved, rejected, expired
effective_service_state:
  available, hq_disabled, store_disabled, emergency_paused, scheduled_unavailable, expired_override
brand_standard_type:
  receipt, tag, workflow, pricing, hours, quality, service_availability, customer_message
brand_standard_status:
  draft, published, archived
override_policy_scope:
  service_price, service_availability, due_hours, business_hours, template, workflow
franchise_operator_type:
  company_owned_operator, independent_franchisee, joint_venture, managed_partner
franchisee_status:
  prospect, onboarding, active, suspended, terminated, archived
franchise_billing_mode:
  brand_consolidated, franchisee_direct, hybrid
franchise_agreement_status:
  draft, pending_signature, scheduled, active, suspended, expired, terminated, archived
territory_status:
  draft, active, suspended, retired
royalty_rule_type:
  gross_percent, net_percent, tiered, hybrid, minimum_floor
royalty_base_type:
  gross_sales, net_sales
royalty_rule_status:
  draft, published, retired
royalty_run_status:
  draft, reviewed, locked, disputed, voided
royalty_adjustment_reason:
  late_sync, refund_correction, void_correction, manual_credit, manual_debit, contract_correction, other
report_freshness_state:
  fresh, pending_sync, stale, offline, unknown
compliance_template_status:
  draft, published, retired
compliance_pillar:
  brand_identity, process_adherence, service_standards, experience_consistency, safety_and_legal
audit_assignment_status:
  assigned, accepted, in_progress, submitted, overdue, cancelled
compliance_audit_status:
  draft, submitted, reviewed, voided
compliance_result:
  passed, failed, critical_fail
corrective_action_severity:
  critical, high, medium, low
corrective_action_status:
  open, acknowledged, in_progress, awaiting_verification, resolved, rejected, overdue, waived
b2b_settlement_cycle:
  weekly, biweekly, monthly, custom
b2b_contract_status:
  draft, active, suspended, expired, terminated
b2b_invoice_status:
  draft, issued, partially_paid, paid, overdue, voided
```

### 6.4 RLS Policy Summary

RLS is enabled on every tenant/chain-scoped table.

```sql
USING (
  kitluy_core.is_service_role()
  OR kitluy_chain.user_can_access_chain(auth.uid(), chain_id)
)
```

Store-scoped patterns must also check branch assignment:

```sql
USING (
  kitluy_core.is_service_role()
  OR kitluy_chain.user_can_access_store(auth.uid(), chain_id, store_id)
)
```

Write policies must check action permission:

```sql
WITH CHECK (
  kitluy_chain.user_has_chain_permission(auth.uid(), chain_id, 'catalog.push')
)
```

### 6.5 Migration Sequencing

```text
000_enable_extensions.sql
001_kitluy_core_schema.sql
002_kitluy_admin_schema.sql
003_kitluy_chain_schema.sql
004_kitluy_partner_schema.sql
005_kitluy_pos_schema.sql
006_kitluy_laundry_vertical_schema.sql
007_kitluy_orders_payments_schema.sql
008_kitluy_devices_sync_schema.sql
009_kitluy_files_schema.sql
010_kitluy_ai_schema.sql
011_kitluy_events_audit_schema.sql
012_kitluy_chain_rls_policies.sql
013_kitluy_chain_indexes.sql
014_kitluy_chain_seed_baseline.sql
```

### 6.6 Naming Conventions

| Convention | Rule |
|---|---|
| Schemas | `kitluy_<domain>` lowercase snake case. |
| Tables | Plural snake case. |
| Primary keys | `id uuid primary key default gen_random_uuid()`. |
| FK columns | `<entity>_id`. |
| Money | Integer KHR columns named `*_khr`. |
| Timestamps | `timestamptz`; use `created_at`, `updated_at`, domain-specific `published_at`, `locked_at`. |
| Soft delete | Use `archived_at`, `removed_at`, or status enum. |
| Immutable records | Catalog versions, locked royalty runs, submitted audits, audit logs. |
| Idempotency key | `chn_<chain-id-short>_<operation>_<uuid-or-ulid>`; max 128 ASCII characters. |
| Human codes | Chain/Franchise/Agreement/Run/Invoice codes are unique per Chain and never reused after archive. |

---

## Part 7 — API / Edge Function Specifications

### 7.1 API Design Rules

Chain Portal uses Supabase Edge Functions for all sensitive mutations and privileged reads. Direct client reads may be allowed only for RLS-safe views, small lookup tables, and read-only profile data. All functions must be tenant-scoped, chain-scoped, audited when mutating, and idempotent when the action can be retried.

| Rule | Canonical behavior |
|---|---|
| Runtime | Supabase Edge Functions / Deno TypeScript. |
| Auth | Supabase JWT required for all Chain Portal functions. |
| Scope | Every request resolves `tenant_id`, `chain_id`, `actor_user_id`, and role from server-side session context. |
| Idempotency | Required for create, publish, push, export, invoice, royalty, AI tool, and retry actions. |
| Validation | Zod or equivalent schema validation at function edge. |
| RLS | DB RLS remains enabled. Functions also enforce scope before touching tables. |
| Audit | All sensitive actions write `kitluy_audit.audit_logs`. |
| Domain events | Meaningful state changes write `kitluy_events.domain_events`. |
| File output | Exports and evidence use File Service + DigitalOcean Spaces. |
| AI actions | AI may summarize/draft. Human confirmation is required for sensitive writes. |

Every function in §7.5-§7.30 inherits the common headers, error envelope, server-side Chain/Tenant resolution, RLS enforcement, request ID, and audit/event rules in §7.1-§7.3. A function subsection documents its request/response and any stricter role or idempotency behavior. Reads are idempotent by definition. Writes persist the first successful response against `(tenant_id, actor_user_id, x-idempotency-key, route)` and return that response on an exact replay; reuse with a different body returns `409 IDEMPOTENCY_KEY_REUSED`.

### 7.2 Common Request Headers

| Header | Required | Description |
|---|---:|---|
| `Authorization: Bearer <jwt>` | Yes | Supabase user session token. |
| `Content-Type: application/json` | Yes for body requests | JSON body. |
| `x-idempotency-key` | Required for writes | Stable UUID or ULID generated by client. |
| `x-client-build` | Recommended | App version for debugging. |
| `x-request-source` | Recommended | `chain_portal`, `partner_pwa`, `admin_support`, or `pos_desktop`. |

### 7.3 Common Error Shape

```json
{
  "ok": false,
  "error": {
    "code": "CHAIN_FORBIDDEN",
    "message": "Actor is not allowed to perform this chain action.",
    "details": {},
    "request_id": "req_..."
  }
}
```

| HTTP | Meaning | Examples |
|---:|---|---|
| 200 | Success | Read, preview, mutation complete. |
| 202 | Accepted | Async export/report/AI job queued. |
| 400 | Bad request | Invalid JSON, missing required field. |
| 401 | Unauthenticated | Missing/expired token. |
| 403 | Forbidden | Role or chain scope denied. |
| 404 | Not found | Chain/store/service not visible to actor. |
| 409 | Conflict | Duplicate idempotency key, stale catalog version, locked record. |
| 422 | Validation error | Invalid business rule. |
| 429 | Rate limited | Too many AI/export requests. |
| 500 | Server error | Unexpected exception. |

### 7.4 Function Index

| Function | Method / Path | Phase | Purpose |
|---|---|---|---|
| `chain-session-context` | `GET /chain-session-context` | MVP | Resolve actor, chain, role, permissions. |
| `chain-dashboard-summary` | `GET /chain-dashboard-summary` | MVP | Chain overview KPIs. |
| `chain-stores-list` | `GET /chain-stores-list` | MVP | Chain-scoped store list and health. |
| `chain-branch-compare` | `POST /chain-branch-compare` | MVP | Compare branch performance. |
| `chain-catalog-version-create` | `POST /chain-catalog-version-create` | MVP | Create draft catalog version. |
| `chain-catalog-push-preview` | `POST /chain-catalog-push-preview` | MVP | Validate push before publish. |
| `chain-catalog-push` | `POST /chain-catalog-push` | MVP | Publish catalog to target stores. |
| `chain-catalog-rollback` | `POST /chain-catalog-rollback` | MVP | Roll back target stores to earlier catalog version. |
| `store-service-availability-set` | `POST /store-service-availability-set` | MVP | Store-level enable/disable/emergency pause. |
| `chain-service-availability-list` | `GET /chain-service-availability-list` | MVP | Availability matrix across stores. |
| `chain-standard-publish` | `POST /chain-standard-publish` | MVP | Publish brand standard. |
| `chain-override-request-review` | `POST /chain-override-request-review` | MVP | Approve/reject local override request. |
| `chain-report-export-create` | `POST /chain-report-export-create` | MVP | Queue report export. |
| `chain-compliance-submit` | `POST /chain-compliance-submit` | 1.5 | Submit compliance audit. |
| `chain-royalty-run-preview` | `POST /chain-royalty-run-preview` | 1.5 | Preview royalty run. |
| `chain-royalty-run-calc` | `POST /chain-royalty-run-calc` | 1.5 | Calculate and store royalty run. |
| `chain-b2b-invoice-generate` | `POST /chain-b2b-invoice-generate` | 1.5 | Generate institutional B2B invoice. |
| `chain-ai-ask` | `POST /chain-ai-ask` | 1.5 / 2 | Ask Chain BI question via AI Gateway. |
| `chain-franchisee-create` | `POST /chain-franchisee-create` | 1.5 | Create Chain-scoped Franchisee. |
| `chain-franchise-agreement-create` | `POST /chain-franchise-agreement-create` | 1.5 | Create/version Franchise Agreement. |
| `chain-franchise-store-link` | `POST /chain-franchise-store-link` | 1.5 | Link eligible Stores to Franchisee/agreement. |
| `chain-compliance-assignment-create` | `POST /chain-compliance-assignment-create` | 1.5 | Schedule Store audit. |
| `chain-corrective-action-update` | `POST /chain-corrective-action-update` | 1.5 | Progress, resolve, or verify corrective action. |
| `chain-royalty-run-lock` | `POST /chain-royalty-run-lock` | 1.5 | Lock reviewed Royalty Run. |
| `chain-royalty-adjustment-create` | `POST /chain-royalty-adjustment-create` | 1.5 | Append correction to locked Run. |
| `chain-catalog-exception-request` | `POST /chain-catalog-exception-request` | MVP / 1.5 | Request governed Store catalog exception. |

### 7.5 `GET /chain-session-context`

**Purpose:** Resolve current actor and permitted chain context before the app renders.

| Attribute | Value |
|---|---|
| Auth | Any authenticated chain user. |
| Request body | None. |
| Side effects | None. |
| RLS | DB policies restrict memberships to actor. |

Response:

```json
{
  "ok": true,
  "actor": {
    "user_id": "uuid",
    "display_name": "Sokha",
    "email": "owner@example.com",
    "phone": "+855..."
  },
  "chains": [
    {
      "chain_id": "uuid",
      "tenant_id": "uuid",
      "chain_name": "CleanPro Laundry",
      "role": "chain_owner",
      "permissions": ["chain.catalog.push", "chain.reports.read"]
    }
  ],
  "default_chain_id": "uuid"
}
```

### 7.6 `GET /chain-dashboard-summary`

**Purpose:** Return chain overview KPIs for selected date range.

Query parameters:

| Name | Type | Required | Rule |
|---|---|---:|---|
| `chain_id` | UUID | Yes | Must belong to actor. |
| `date_from` | date | Yes | Inclusive. |
| `date_to` | date | Yes | Inclusive. |
| `timezone` | string | No | Default `Asia/Phnom_Penh`. |

Response body:

```json
{
  "ok": true,
  "summary": {
    "gross_sales_khr": 2450000,
    "net_sales_khr": 2380000,
    "orders_count": 187,
    "active_stores_count": 5,
    "stale_stores_count": 1,
    "issue_orders_count": 3,
    "top_branch": { "store_id": "uuid", "store_name": "BKK", "net_sales_khr": 850000 },
    "as_of": "2026-07-03T17:00:00+07:00"
  },
  "alerts": [
    { "severity": "warning", "type": "store_stale", "store_id": "uuid", "message": "Toul Kork store stale for 42 minutes." }
  ]
}
```

Side effects: none. The function reads branch rollup views, sync freshness, issue order counts, and device health projections.

### 7.7 `GET /chain-stores-list`

**Purpose:** Return linked branch/store list with sync and device summary.

Query parameters: `chain_id`, optional `branch_group_id`, `status`, `sync_state`.

Response:

```json
{
  "ok": true,
  "stores": [
    {
      "store_id": "uuid",
      "store_code": "ST-0001",
      "store_name": "BKK Branch",
      "vertical_type": "laundry",
      "store_relationship_type": "company_owned",
      "branch_group_name": "Phnom Penh Central",
      "store_status": "active",
      "sync_state": "fresh",
      "last_hub_heartbeat_at": "2026-07-03T16:55:00+07:00",
      "open_service_pauses": 0,
      "today_orders_count": 48,
      "today_net_sales_khr": 620000
    }
  ]
}
```

### 7.8 `POST /chain-branch-compare`

**Purpose:** Compare branch KPIs across a time range.

Request schema:

```json
{
  "chain_id": "uuid",
  "date_from": "2026-07-01",
  "date_to": "2026-07-03",
  "metrics": ["net_sales_khr", "orders_count", "issue_rate", "service_mix"],
  "store_ids": ["uuid"],
  "include_stale_warning": true
}
```

Response contains a table-ready array of store metrics and a `freshness` object per store. Stale stores remain visible; the function never converts missing sync data into zero sales.

### 7.9 `POST /chain-catalog-version-create`

**Purpose:** Create or update a draft chain master catalog version.

Auth: `chain_owner`, `chain_manager`, or any role with `chain.catalog.write`.

Request schema:

```json
{
  "chain_id": "uuid",
  "version_name": "July 2026 Laundry Catalog",
  "base_version_id": "uuid",
  "services": [
    {
      "client_temp_id": "svc_1",
      "name": "Wash & Fold",
      "name_km": "[REQUIRED: Khmer label]",
      "service_type": "per_kg",
      "category": "washing",
      "base_price_khr": 4500,
      "min_price_khr": 3000,
      "max_price_khr": 6000,
      "default_due_hours": 24,
      "is_required_brand_service": true,
      "availability_policy": "emergency_override_allowed"
    }
  ],
  "notes": "Updated price and due hour policy."
}
```

Side effects:

1. Inserts or updates `kitluy_chain.catalog_versions` in `draft` state.
2. Inserts service snapshot rows for the version.
3. Writes `chain_catalog_version_created` event.
4. Writes audit log.

Idempotency: Same `x-idempotency-key` returns the same `catalog_version_id`.

### 7.10 `POST /chain-catalog-push-preview`

**Purpose:** Validate a catalog push before it mutates stores.

Request schema:

```json
{
  "chain_id": "uuid",
  "catalog_version_id": "uuid",
  "target": {
    "mode": "selected_stores",
    "store_ids": ["uuid", "uuid"],
    "branch_group_ids": []
  },
  "options": {
    "preserve_active_emergency_pauses": true,
    "fail_if_store_stale_minutes_gt": 1440,
    "allow_partial_push": true
  }
}
```

Response:

```json
{
  "ok": true,
  "preview": {
    "target_store_count": 2,
    "eligible_store_count": 2,
    "blocked_store_count": 0,
    "stale_store_count": 1,
    "active_emergency_pause_count": 1,
    "warnings": [
      {
        "store_id": "uuid",
        "code": "ACTIVE_EMERGENCY_PAUSE_PRESERVED",
        "message": "Dry Clean catalog will update, but local pause remains active."
      }
    ]
  }
}
```

### 7.11 `POST /chain-catalog-push`

**Purpose:** Publish a chain catalog version to target stores.

Auth: `chain_owner`, `chain_manager`; optional dual approval when chain policy requires.

Request schema:

```json
{
  "chain_id": "uuid",
  "catalog_version_id": "uuid",
  "target": {
    "mode": "all_stores",
    "store_ids": [],
    "branch_group_ids": []
  },
  "reason": "Monthly catalog update",
  "options": {
    "preserve_active_emergency_pauses": true,
    "allow_partial_push": true,
    "notify_store_managers": true
  }
}
```

Side effects:

1. Inserts `catalog_push_batches`.
2. Inserts `catalog_push_targets` for each store.
3. Materializes or queues store-level service records for Partner/POS sync.
4. Preserves active store-level emergency availability overrides.
5. Emits `chain_catalog_pushed` event.
6. Writes audit log.
7. Sends notifications if enabled.

Conflict behavior:

| Conflict | Behavior |
|---|---|
| Duplicate idempotency key | Return original batch. |
| Catalog version not published/draft state invalid | 409. |
| Store stale over threshold | Block or warn depending on option. |
| Active emergency pause | Preserve pause; log `chain_catalog_push_kept_store_pause`. |
| Store not in chain | 403/404. |

### 7.12 `POST /chain-catalog-rollback`

**Purpose:** Roll back selected stores to a previous catalog version.

Request schema:

```json
{
  "chain_id": "uuid",
  "rollback_to_catalog_version_id": "uuid",
  "target_store_ids": ["uuid"],
  "reason": "Rollback incorrect price update",
  "preserve_active_emergency_pauses": true
}
```

Side effects: creates rollback batch, updates store service snapshots, preserves emergency pauses, emits event, writes audit.

### 7.13 `POST /store-service-availability-set`

**Purpose:** Allow Partner PWA, POS manager mode, Chain Portal, or Admin support to enable, disable, or emergency-pause a store service.

Auth rules:

| Source | Allowed actors |
|---|---|
| Partner PWA | `partner_owner`, `store_manager`, `supervisor` with permission. |
| POS | Manager PIN / staff permission cache. |
| Chain Portal | Chain owner/manager if policy permits chain-originated availability action. |
| Admin support | Support role only for audited intervention. |

Request schema:

```json
{
  "chain_id": "uuid",
  "store_id": "uuid",
  "service_id": "uuid",
  "override_type": "emergency_pause",
  "reason_code": "machine_down",
  "reason_note": "Dry clean machine is under repair.",
  "customer_message": "Dry cleaning is temporarily unavailable at this branch.",
  "starts_at": "2026-07-03T14:00:00+07:00",
  "ends_at": "2026-07-03T18:00:00+07:00",
  "affects_pos": true,
  "affects_online_booking": true,
  "notify_chain_hq": true
}
```

Response:

```json
{
  "ok": true,
  "override_id": "uuid",
  "effective_status": "unavailable",
  "expires_at": "2026-07-03T18:00:00+07:00",
  "audit_event_id": "uuid"
}
```

Side effects:

1. Inserts or updates `store_service_availability_overrides`.
2. Recomputes `effective_store_services` projection.
3. Notifies POS/Store Hub via sync/realtime if online.
4. Emits `store_service_emergency_paused`, `store_service_disabled`, or `store_service_reenabled`.
5. Writes audit.

Business rule: this function never changes master catalog definition, price policy, or brand standard. It only changes operational availability.

### 7.14 `GET /chain-service-availability-list`

**Purpose:** Return chain-level availability matrix.

Query parameters: `chain_id`, optional `service_id`, `store_id`, `reason_code`, `active_only`.

Response:

```json
{
  "ok": true,
  "matrix": [
    {
      "service_id": "uuid",
      "service_name": "Dry Clean",
      "stores": [
        {
          "store_id": "uuid",
          "store_name": "BKK Branch",
          "effective_status": "available",
          "active_override": null
        },
        {
          "store_id": "uuid",
          "store_name": "Toul Kork",
          "effective_status": "unavailable",
          "active_override": {
            "reason_code": "machine_down",
            "ends_at": "2026-07-03T18:00:00+07:00"
          }
        }
      ]
    }
  ]
}
```

### 7.15 `POST /chain-standard-publish`

**Purpose:** Publish a brand standard or workflow rule.

Request schema:

```json
{
  "chain_id": "uuid",
  "standard_type": "receipt_template",
  "title": "Receipt v2",
  "payload": {
    "template_id": "uuid",
    "show_chain_logo": true,
    "show_branch_phone": true
  },
  "target": { "mode": "all_stores", "store_ids": [] },
  "reason": "New brand receipt layout"
}
```

Side effects: insert/update `brand_standards`, queue materialization to store settings, emit `chain_standard_published`, audit.

### 7.16 `POST /chain-override-request-review`

**Purpose:** Approve or reject Partner/store request to deviate from HQ rule.

Request schema:

```json
{
  "chain_id": "uuid",
  "override_request_id": "uuid",
  "decision": "approved",
  "decision_note": "Approved for holiday weekend capacity control.",
  "expires_at": "2026-07-08T23:59:59+07:00"
}
```

### 7.17 `POST /chain-report-export-create`

**Purpose:** Queue export of reports to DigitalOcean Spaces.

Request schema:

```json
{
  "chain_id": "uuid",
  "report_type": "branch_sales",
  "format": "csv",
  "date_from": "2026-07-01",
  "date_to": "2026-07-03",
  "filters": { "store_ids": [] }
}
```

Response: `202` with `export_job_id`. File Service later returns signed download URL.

### 7.18 `POST /chain-compliance-submit`

**Phase:** 1.5.

Purpose: Submit branch compliance audit with optional evidence files.

Request schema:

```json
{
  "chain_id": "uuid",
  "store_id": "uuid",
  "template_id": "uuid",
  "audit_date": "2026-07-03",
  "answers": [
    { "item_id": "uuid", "score": 4, "note": "Receipt layout correct.", "evidence_asset_ids": ["uuid"] }
  ],
  "overall_note": "Branch is compliant except minor tag-printer alignment issue."
}
```

Side effects: stores audit, computes weighted score, creates corrective actions if needed, writes file/evidence links, emits event, audit.

### 7.19 `POST /chain-royalty-run-preview`

**Phase:** 1.5.

Purpose: Preview royalty amounts without creating locked financial records.

Request schema:

```json
{
  "chain_id": "uuid",
  "period_start": "2026-07-01",
  "period_end": "2026-07-31",
  "franchisee_ids": ["uuid"],
  "include_stale_store_warning": true
}
```

Response includes per franchisee gross/net revenue, rule applied, calculated royalty, stale-store warnings, and exceptions.

### 7.20 `POST /chain-royalty-run-calc`

**Phase:** 1.5.

Purpose: Calculate and persist royalty run.

Request schema:

```json
{
  "chain_id": "uuid",
  "period_start": "2026-07-01",
  "period_end": "2026-07-31",
  "franchisee_ids": ["uuid"],
  "lock_after_create": false,
  "reason": "Monthly royalty calculation"
}
```

Side effects: inserts `royalty_runs`, `royalty_run_lines`, events, audit. Locked runs are append-only; corrections use adjustments.

### 7.21 `POST /chain-b2b-invoice-generate`

**Phase:** 1.5.

Purpose: Generate chain-level invoice for institutional B2B customer.

Request schema:

```json
{
  "chain_id": "uuid",
  "b2b_contract_id": "uuid",
  "period_start": "2026-07-01",
  "period_end": "2026-07-31",
  "store_ids": ["uuid"],
  "format": "pdf"
}
```

Side effects: creates invoice record, queues PDF export via File Service, optionally sends notification.

### 7.22 `POST /chain-ai-ask`

**Phase:** 1.5 / 2.

Purpose: Ask KitLuy AI Gateway chain-scoped business question.

Request schema:

```json
{
  "chain_id": "uuid",
  "question": "Why did Branch B have more rewash issues this week?",
  "scope": {
    "store_ids": ["uuid"],
    "date_from": "2026-07-01",
    "date_to": "2026-07-03"
  },
  "allowed_tools": ["chain_branch_compare", "chain_issue_rate_report"],
  "response_mode": "summary_with_sources"
}
```

Response:

```json
{
  "ok": true,
  "answer": "Branch B had higher issue rate mainly from Dry Clean orders after a machine-down event.",
  "sources": [
    { "type": "report", "id": "uuid", "title": "Issue Rate Report" }
  ],
  "draft_actions": [
    { "type": "create_compliance_audit", "requires_confirmation": true }
  ],
  "ai_request_id": "uuid"
}
```

AI side effects: write request log, retrieval log, tool-call log, model usage, cost estimate, and audit when a tool action is executed.

### 7.23 `POST /chain-franchisee-create`

**Auth:** `chain_owner` or `chain_manager` with `franchise.write`.

```json
{
  "chain_id": "uuid",
  "franchisee_code": "FRA-0007",
  "display_name": "Siem Reap Franchise Co.",
  "legal_name": "[REQUIRED OR NULL]",
  "operator_type": "independent_franchisee",
  "billing_mode": "franchisee_direct",
  "contact": { "name": "Sokha", "phone_e164": "+855...", "email": "..." }
}
```

**Responses:** `200` created; `409` duplicate code; `422` invalid contact/billing mode.

**Side effects:** inserts `franchisees`, emits `chain_franchisee_created`, writes audit. No Tenant, Auth user, or Store is created.

### 7.24 `POST /chain-franchise-agreement-create`

**Auth:** `chain_owner` or `chain_manager` with `franchise.agreement.write`.

```json
{
  "chain_id": "uuid",
  "franchisee_id": "uuid",
  "agreement_no": "AGR-2026-0007",
  "starts_on": "2026-08-01",
  "ends_on": null,
  "billing_mode": "franchisee_direct",
  "royalty_rule_id": "uuid",
  "signed_asset_id": "uuid",
  "terms": {}
}
```

**Guards:** Franchisee, rule, and evidence asset must belong to same Tenant/Chain; active agreement dates may not conflict with another active agreement for the same Store set.

**Side effects:** inserts draft agreement, emits event, audit. Activation is a separate confirmed transition.

### 7.25 `POST /chain-franchise-store-link`

**Auth:** `chain_owner` or `chain_manager`.

```json
{
  "chain_id": "uuid",
  "franchisee_id": "uuid",
  "agreement_id": "uuid",
  "store_ids": ["uuid"],
  "effective_from": "2026-08-01",
  "reason": "New franchise unit activation"
}
```

**Guards:** each Store is already linked to Chain, is `laundry`, is not linked to another active Franchise Agreement for the same period, and Admin provisioning is complete.

### 7.26 `POST /chain-compliance-assignment-create`

**Auth:** `chain_owner`, `chain_manager`, or `regional_manager` within assigned branch scope.

```json
{
  "chain_id": "uuid",
  "store_id": "uuid",
  "template_id": "uuid",
  "assigned_to_user_id": "uuid",
  "scheduled_for": "2026-07-20",
  "due_at": "2026-07-20T18:00:00+07:00",
  "note": "Monthly quality audit"
}
```

**Side effects:** inserts assignment, sends notification, emits event, writes audit. Published template only.

### 7.27 `POST /chain-corrective-action-update`

**Auth:** assignee can acknowledge/progress/submit resolution; `field_auditor`, `regional_manager`, `chain_manager`, or `chain_owner` can verify/reject within scope.

```json
{
  "chain_id": "uuid",
  "corrective_action_id": "uuid",
  "transition": "submit_resolution",
  "resolution_note": "Tag printer recalibrated and samples verified.",
  "resolution_asset_ids": ["uuid"]
}
```

**Guards:** valid state transition; required note/evidence; verifier separation when enabled. Every transition is audited.

### 7.28 `POST /chain-royalty-run-lock`

**Auth:** `chain_owner` or `finance_manager` with `royalty.lock`. Optional dual approval is policy-controlled.

```json
{
  "chain_id": "uuid",
  "royalty_run_id": "uuid",
  "confirm_stale_store_ids": [],
  "reason": "July 2026 run reviewed and approved"
}
```

**Guards:** Run is `reviewed`; all lines reconcile; stale Stores are zero or explicitly confirmed under policy; period does not overlap another locked run.

**Side effects:** sets `locked`, stamps actor/time, makes run/lines immutable, emits event, audit.

### 7.29 `POST /chain-royalty-adjustment-create`

**Auth:** `chain_owner` or `finance_manager` with `royalty.adjust`.

```json
{
  "chain_id": "uuid",
  "royalty_run_id": "uuid",
  "royalty_run_line_id": "uuid",
  "amount_khr": -25000,
  "reason_code": "late_sync",
  "reason_note": "Refund synchronized after run lock."
}
```

**Guards:** parent Run is locked; amount is non-zero; reason is mandatory; dual approval applies above `[REQUIRED: adjustment threshold KHR]`.

### 7.30 `POST /chain-catalog-exception-request`

**Auth:** Partner owner/Store manager for own Store; Chain roles may create on behalf only with support reason.

```json
{
  "chain_id": "uuid",
  "store_id": "uuid",
  "service_id": "uuid",
  "field": "price_khr",
  "requested_value": 6500,
  "starts_at": "2026-07-15T00:00:00+07:00",
  "ends_at": "2026-07-31T23:59:59+07:00",
  "reason_code": "local_market_exception",
  "reason_note": "Approved pilot pricing request"
}
```

**Behavior:** locally editable values inside guardrails may auto-approve; approval-required values remain pending; HQ-locked values return `422`; no effective projection changes before approval.

---

## Part 8 — Business Logic & Computation Rules

### 8.1 Entity Hierarchy

The canonical operational hierarchy for Chain Portal is:

```text
Platform Owner / HET
  -> Tenant
    -> Chain
      -> Branch Group / Region
        -> Store
          -> Store Hub
          -> POS Registers
          -> Partner PWA Store Settings
          -> Laundry Orders / Payments / Inventory / Staff
      -> Chain Users / Roles
      -> Chain Master Catalog
      -> Brand Standards
      -> Compliance Audits
      -> Franchise / Royalty / B2B Records
```

Chain Portal never bypasses this hierarchy. A chain user may only read or mutate records belonging to a chain where they have an active chain role.

### 8.2 Immutable Rules

| Rule | Description |
|---|---|
| One store equals one vertical | `vertical_type` is immutable. Laundry MVP stores cannot become Cafe stores. |
| Chain Portal is not POS | It cannot create customer orders, capture payments, print receipts/tags, or open/close shifts. |
| Admin provisions; Chain operates HQ | Admin creates tenants, stores, subscriptions, devices. Chain manages chain strategy after activation. |
| Partner controls store operations | Partner PWA controls one-store services, staff, inventory, finance, reports, and store settings within policy. |
| Store can emergency-pause services | Local store can immediately pause/resume operational service availability with reason, timestamp, and audit. |
| Catalog push does not clear emergency pause | HQ catalog updates cannot accidentally reactivate locally paused services. |
| Financial records are append-only after lock | Royalty runs, B2B invoices, and exports use adjustments or new versions after lock. |
| KHR integer money | Store and chain money display as `៛` integer, no decimals. |
| AI cannot silently mutate sensitive data | AI can summarize or draft; confirmed human action is required for sensitive writes. |
| Future connectors are non-blocking | ERP, loyalty, logistics, and e-commerce connectors do not block MVP. |

### 8.3 State Machines

#### 8.3.1 Catalog Version Lifecycle

```text
draft -> reviewed -> published -> superseded
  |          |            |
  |          |            -> rolled_back (per store push target only)
  |          -> draft
  -> archived
```

| From | To | Guard | Side effects |
|---|---|---|---|
| `draft` | `reviewed` | Required fields valid | Validation report saved. |
| `reviewed` | `published` | Actor has catalog publish permission | Domain event and audit. |
| `published` | `superseded` | New version published | Previous active pointer updated. |
| `draft` | `archived` | No active push | Audit. |

#### 8.3.2 Catalog Push Target Lifecycle

```text
pending -> queued -> applied -> synced
   |        |        |
   |        |        -> partially_applied
   |        -> failed
   -> blocked
```

| State | Meaning |
|---|---|
| `pending` | Push target created but not processed. |
| `queued` | Waiting for materialization/sync. |
| `applied` | Store-level catalog rows updated in cloud. |
| `synced` | Store Hub acknowledged downstream sync. |
| `partially_applied` | Some service rows applied, some failed. |
| `blocked` | Validation blocked store. |
| `failed` | Runtime error; retry required. |

#### 8.3.3 Store Service Availability Lifecycle

```text
available -> disabled -> available
available -> emergency_paused -> available
available -> scheduled_unavailable -> available
```

Effective availability formula:

```text
effective_available =
  hq_enabled = true
  AND store_enabled = true
  AND emergency_disabled = false
  AND current_time is within allowed availability window
```

| Transition | Guard | Side effects |
|---|---|---|
| `available -> disabled` | Reason required | Hide/block in POS, audit, notify chain if policy. |
| `available -> emergency_paused` | Emergency reason required | Hide/block in POS immediately, notify Chain HQ, audit. |
| `disabled -> available` | Actor has permission | Re-enable in POS after sync/local event, audit. |
| `emergency_paused -> available` | Issue resolved or expiry | Re-enable, audit, optional notification. |

#### 8.3.4 Compliance Audit Lifecycle

```text
draft -> submitted -> reviewed -> closed
  |             |
  -> cancelled -> corrective_action_open -> closed
```

Submitted audits are immutable except review status and corrective-action links.

#### 8.3.5 Royalty Run Lifecycle

```text
preview -> calculated -> reviewed -> locked -> exported
             |             |
             -> cancelled  -> disputed -> adjusted -> locked
```

Locked royalty runs cannot be edited. Corrections use `royalty_adjustments`.

#### 8.3.6 B2B Invoice Lifecycle

```text
draft -> issued -> partially_paid -> paid
   |        |
   -> void  -> overdue -> paid
```

Paid or issued invoices cannot be deleted. Void requires reason and audit.

### 8.4 Money Model

| Rule | Value |
|---|---|
| Currency | Cambodian Riel, `KHR`. |
| Display | Prefix symbol `៛`; integer only; thousands separators. |
| Storage | Integer KHR in columns ending `_khr`. |
| Decimal money | Not used in MVP for KHR. |
| Rounding | Not required for KHR integer values; any percentage result rounds to nearest integer KHR using `kitluy_money.round_khr(value)`. |
| Negative values | Allowed only for adjustments, refunds, voids, or corrections. |

Royalty formula examples:

```text
gross_royalty_khr = round_khr(gross_sales_khr * royalty_rate_bps / 10000)
net_royalty_khr   = round_khr(net_sales_khr * royalty_rate_bps / 10000)
final_royalty_khr = max(calculated_royalty_khr, minimum_floor_khr)
```

B2B invoice formula:

```text
line_total_khr = quantity * unit_price_khr
subtotal_khr   = sum(line_total_khr)
discount_khr   = sum(discount lines)
tax_khr        = 0 until tax policy is finalized or configured
invoice_total_khr = subtotal_khr - discount_khr + tax_khr + adjustment_khr
```

### 8.5 Catalog Push Computation

Catalog push follows this deterministic order:

1. Resolve actor and permissions.
2. Resolve target store set from all stores, selected stores, or branch groups.
3. Confirm every store belongs to the chain and is Laundry vertical.
4. Validate catalog version is publishable.
5. Validate service price policy and required fields.
6. Read active store-level emergency availability overrides.
7. Create push batch.
8. Create push target rows.
9. Materialize store service records or queue downstream sync.
10. Preserve active emergency pauses.
11. Mark target result.
12. Emit events and audit logs.
13. Notify store managers and chain managers where configured.

### 8.6 Store-Level Service Availability Rule

Chain Portal owns the master catalog, service definition, brand rules, and chain-level pricing policy. Partner PWA owns store-level operational availability. A store owner or authorized manager may temporarily enable, disable, or emergency-pause a chain-pushed service when real operating conditions require it, such as machine failure, staff shortage, supply outage, power/water issue, capacity overload, or quality/safety concern. This action does not modify the master catalog or chain price rules. It only changes whether the service is currently available at that branch. All actions require reason, timestamp, actor, audit log, and optional expiry. Chain HQ can view, report, and govern these overrides, but local stores must be able to act immediately during emergencies.

### 8.7 Store Availability Reasons

| Reason code | Meaning |
|---|---|
| `machine_down` | Washer, dryer, iron, dry-cleaning unit, scale, or printer is broken. |
| `staff_shortage` | Not enough staff to perform service. |
| `supply_out` | Detergent, chemical, hanger, bag, tag roll, or receipt roll unavailable. |
| `power_issue` | Power outage or unstable electricity. |
| `water_issue` | No water or low water pressure. |
| `capacity_full` | Store cannot accept more orders for that service. |
| `quality_issue` | Service paused to prevent quality failures. |
| `safety_issue` | Chemical, equipment, or workplace safety risk. |
| `holiday_or_closure` | Branch closed or partially operating. |
| `other` | Custom note required. |

### 8.8 Reporting and Sync Freshness

Chain reports are eventually consistent because stores sync from Store Hub to cloud. Every chain KPI must carry a freshness marker.

| Freshness state | Rule |
|---|---|
| `fresh` | Last store sync within configured threshold, default 5 minutes. |
| `stale` | Last sync older than threshold but less than offline threshold. |
| `pending_sync` | Store has unsynced local queue reported. |
| `offline` | Hub heartbeat missing past threshold. |
| `unknown` | Store has not yet reported heartbeat after provisioning. |

A stale or offline branch must not be counted as zero sales. Reports must display `as_of` time and stale warning.

### 8.9 Franchise and Royalty Computation

#### 8.9.1 Franchise eligibility

A Store can participate in a Franchise Agreement only when all are true:

```text
store.tenant_id = chain.tenant_id
store is actively linked to chain
store.vertical_type = chain.vertical_type = laundry
franchisee.status in (onboarding, active)
agreement.status in (scheduled, active)
store is not covered by an overlapping active agreement
```

#### 8.9.2 Royalty base

All KHR values are integers. Source values are snapshot into `royalty_run_lines`.

```text
gross_sales_khr = sum(finalized booking gross totals in period)
net_sales_khr = max(0, gross_sales_khr - discounts_khr - refunds_khr - voids_khr)
royalty_base_khr = gross_sales_khr when base_type = gross_sales
royalty_base_khr = net_sales_khr when base_type = net_sales
```

Cancelled/unfinalized Bookings contribute zero. Deposits are not double-counted: revenue is taken from finalized Booking totals, not tender rows.

#### 8.9.3 Royalty formulas

```text
percent_amount = round_half_up(royalty_base_khr * rate_bps / 10000)

gross_percent or net_percent:
  royalty_amount_khr = max(minimum_floor_khr, percent_amount)

hybrid:
  royalty_amount_khr = max(minimum_floor_khr, percent_amount + fixed_fee_khr)

tiered:
  apply each ordered tier to only the base slice inside that tier;
  sum rounded tier amounts;
  royalty_amount_khr = max(minimum_floor_khr, tier_sum + fixed_fee_khr)
```

Rounding helper: `kitluy_core.round_khr_half_up(numeric) -> bigint` `[REQUIRED: migration implementation]`. Negative royalty is forbidden. Locked calculations are immutable; corrections use `royalty_adjustments`.

#### 8.9.4 Freshness gate

A Run may be previewed with stale Stores, but lock behavior is policy-controlled. Default safe policy: block lock if any included Store is `offline`, `unknown`, or stale more than 24 hours. An authorized explicit exception must record Store IDs and reason in audit.

### 8.10 Compliance Scoring and Corrective Actions

#### 8.10.1 Weighted score

Every published template has active item weights totaling exactly `10000` basis points.

```text
item_ratio = answer.score / template_item.max_score
item_weighted_bps = round_half_up(item_ratio * template_item.weight_bps)
audit.score_bps = sum(item_weighted_bps)
```

`score_bps` is an integer from `0` to `10000`; UI displays `score_bps / 100` with two decimals.

#### 8.10.2 Result rule

```text
if any critical item has score = 0 and critical_fail_enabled:
  result = critical_fail
else if score_bps >= pass_threshold_bps:
  result = passed
else:
  result = failed
```

Submitted answers, template version, and score snapshot are immutable. Review adds metadata; it does not rewrite submitted content. A void creates a new audit event and reason.

#### 8.10.3 Corrective Action SLA defaults

| Severity | Default due time | Escalation |
|---|---:|---|
| critical | 24 hours | Immediate Chain Owner + Store Manager alert; service may be paused if safety-related. |
| high | 3 calendar days | Regional Manager alert at creation and overdue. |
| medium | 7 calendar days | Reminder 48 hours before due. |
| low | 14 calendar days | Included in weekly digest. |

Exact values remain configurable in Chain policy, but a production policy must exist before compliance go-live. Resolution requires note; evidence is mandatory when source item required evidence or severity is critical/high.

### 8.11 Subscription Lifecycle

Admin PWA owns subscription billing, but Chain Portal reads subscription state for entitlement display.

```text
trial -> active -> grace -> suspended -> reactivated
                  |          |
                  -> cancelled
```

| State | Chain Portal behavior |
|---|---|
| `trial` | Full allowed features unless Admin policy restricts. Show trial banner. |
| `active` | Normal operation. |
| `grace` | Warning banner. Sensitive exports/AI may be limited by policy. |
| `suspended` | Read-only mode except support/contact billing. No catalog pushes or finance exports. |
| `cancelled` | Access disabled after retention policy. |

Trial days, grace days, and prices are `[REQUIRED: final HET billing policy]` and must not be hard-coded.

### 8.12 Conflict Resolution

| Data class | Conflict policy |
|---|---|
| Chain profile text | Last-write-wins with audit trail. |
| Catalog version | Versioned immutable snapshots; no in-place mutation after publish. |
| Catalog push | Idempotent by batch key. Retry failed targets only. |
| Store emergency availability | Latest active override wins by time; prior override retained. |
| Financial royalty run | Append-only after calculation; adjustments for corrections. |
| B2B invoice | Append-only after issue; void or credit adjustment. |
| Compliance audit | Immutable after submit; review/corrective actions are separate rows. |
| AI insights | Append-only request/response log. |

### 8.13 Tax / Compliance Stub

MVP Chain Portal does not perform formal Cambodian tax filing. B2B invoices and royalty statements may store `tax_policy_snapshot_json` and `tax_khr`, but default `tax_khr = 0` until HET confirms tax/VAT policy. Future ERP export can map summary data into SroulERP or another back-office system without making Chain Portal dependent on ERP.

---

## Part 9 — Design System & UI Inventory

### 9.1 Core Tokens

The Chain Portal uses the shared KitLuy design system. Exact brand tokens must be centralized in `packages/ui`.

| Token | Value / Rule |
|---|---|
| Primary brand | `[REQUIRED: KitLuy primary hex]` |
| Success | `[REQUIRED: success hex]` |
| Warning | `[REQUIRED: warning hex]` |
| Error | `[REQUIRED: error hex]` |
| Info | `[REQUIRED: info hex]` |
| Font | Khmer-ready sans-serif stack: `[REQUIRED: final font stack]` |
| Spacing | 4px base grid. |
| Radius | 8px default, 12px card, 16px modal. |
| Breakpoints | Mobile 360, tablet 768, desktop 1024, wide 1440. |
| Table density | Compact and comfortable modes. |

### 9.2 Status and Banner Patterns

| Pattern | Placement | Meaning |
|---|---|---|
| Sync freshness banner | Report header, branch detail, dashboard KPI group | Data may be stale or pending sync. |
| Connector banner | Integrations pages | Connector is active, missing, future, or degraded. |
| AI banner | AI Chain BI responses | AI-generated content; verify before action. |
| Sensitive action modal | Before catalog push, royalty lock, user disable, B2B invoice issue | Shows action, target, reason, audit preview. |
| Store service pause chip | Branch/service matrix and POS-facing views | Service unavailable with reason and expiry. |
| Read-only subscription banner | Top of app if suspended/grace | Subscription limitation. |

### 9.3 Localization and Formatting

| Format | Rule |
|---|---|
| Currency | `៛` + integer with thousands separators, e.g., `៛1,250,000`. |
| Timezone | `Asia/Phnom_Penh`. |
| Date | `YYYY-MM-DD` for technical tables; localized display in UI. |
| Time | 24-hour local time. |
| Phone | Cambodia E.164 preferred, `+855...`. |
| Language order | Khmer first when localized; English fallback during build. |
| Text expansion | Components must handle Khmer labels 30-50% wider than English. |

### 9.4 Sidebar and Route Inventory

| Sidebar group | Routes |
|---|---|
| Overview | `/overview`, `/overview/daily-summary`, `/overview/alerts` |
| Branches | `/branches`, `/branches/:storeId`, `/branches/compare`, `/branches/map`, `/branches/sync-health` |
| Catalog Control | `/catalog/services`, `/catalog/add-ons`, `/catalog/pricing`, `/catalog/versions`, `/catalog/pushes`, `/catalog/rollbacks` |
| Service Availability | `/availability`, `/availability/matrix`, `/availability/pauses`, `/availability/policies` |
| Brand Standards | `/standards`, `/standards/receipt`, `/standards/tags`, `/standards/workflow`, `/standards/pricing-rules`, `/standards/hours`, `/standards/overrides` |
| Compliance | `/compliance/checklists`, `/compliance/audits`, `/compliance/evidence`, `/compliance/scores`, `/compliance/actions` |
| Franchise | `/franchisees`, `/franchisees/:id`, `/agreements`, `/billing-modes`, `/territories` |
| Royalties | `/royalties/rules`, `/royalties/runs`, `/royalties/statements`, `/royalties/disputes`, `/royalties/exports` |
| B2B | `/b2b/contracts`, `/b2b/accounts`, `/b2b/rates`, `/b2b/invoices`, `/b2b/statements` |
| Promotions | `/promotions`, `/promotions/new`, `/promotions/performance`, `/promotions/approvals` |
| Loyalty | `/loyalty/overview`, `/loyalty/rules`, `/loyalty/members`, `/loyalty/campaigns` |
| Reports | `/reports/sales`, `/reports/orders`, `/reports/services`, `/reports/customers`, `/reports/issues`, `/reports/exports` |
| AI Chain BI | `/ai/overview`, `/ai/branch-insights`, `/ai/catalog-insights`, `/ai/compliance-risk`, `/ai/request-log` |
| Integrations | `/integrations`, `/integrations/payments`, `/integrations/notifications`, `/integrations/maps`, `/integrations/future-connectors` |
| Team & RBAC | `/team`, `/team/roles`, `/team/invites`, `/team/activity` |
| Audit | `/audit`, `/audit/catalog`, `/audit/compliance`, `/audit/finance`, `/audit/exports`, `/audit/security` |
| Settings | `/settings/profile`, `/settings/brand`, `/settings/subscription`, `/settings/notifications`, `/settings/security` |

### 9.5 Critical Screen Patterns

| Screen | Required components |
|---|---|
| Overview | KPI cards, alert list, top/bottom branches, sync freshness banner. |
| Branch Detail | Store profile, service availability, device/sync health, order/sales trend, issue rate. |
| Catalog Version Editor | Service table, per-kg/per-piece/flat price fields, add-ons, validation panel, version notes. |
| Catalog Push Preview | Target count, blocked stores, stale warnings, active emergency pause warnings, confirmation modal. |
| Service Availability Matrix | Services as rows, branches as columns, status chips, filter by reason/expiry. |
| Compliance Audit | Checklist, score, evidence upload, corrective action creator. |
| Royalty Run | Period selector, preview table, stale data warning, lock/adjust/export actions. |
| AI Chain BI | Question box, answer with source list, confidence, draft actions requiring confirmation. |

### 9.6 Wireframe References

| Artifact | Status |
|---|---|
| `kitluy-chain-portal-wireframe-v2.0.0.jsx` | `[REQUIRED: create]` |
| `kitluy-chain-portal-routes-v2.0.0.md` | `[REQUIRED: create]` |
| `kitluy-chain-portal-feature-map-v2.0.0.md` | This bible Part 17 can seed it. |
| Shared design tokens | `packages/ui` `[REQUIRED: final token file]` |

### 9.7 PWA Behavior

Chain Portal is installable as a PWA. It may cache static shell assets only. It must not support offline mutations. If offline, display shell with last-known non-sensitive metadata only if approved; otherwise show reconnect screen.


---

## Part 10 — Security Model & RBAC

### 10.1 Role Definitions

| Role | Home product | Scope | Description |
|---|---|---|---|
| `platform_owner` | Admin PWA | Platform | HET owner/operator. Not a Chain Portal merchant role. |
| `admin_support` | Admin PWA | Platform support | May support chains/stores with audited intervention. |
| `chain_owner` | Chain Portal | One chain | Full chain control. |
| `chain_manager` | Chain Portal | One chain | Catalog, standards, reports, branches, limited settings. |
| `regional_manager` | Chain Portal | Assigned branch groups | Branch performance, compliance, service availability visibility. |
| `finance_manager` | Chain Portal | One chain | Reports, B2B, royalty, finance exports. |
| `field_auditor` | Chain Portal | Assigned audits/stores | Compliance audits and evidence. |
| `chain_readonly` | Chain Portal | One chain | Read-only dashboard/report visibility. |
| `partner_owner` | Partner PWA | One store | Store owner; can manage store operations. |
| `store_manager` | Partner PWA/POS | One store | Store operations, service availability, staff actions. |
| `supervisor` | Partner/POS | One store | Limited sensitive store actions. |
| `cashier` | POS | One store/register | Order/payment intake, no Chain Portal. |
| `laundry_staff` | POS | One store | Production/status workflow, no Chain Portal. |

### 10.2 Permission Matrix

| Capability | Chain Owner | Chain Manager | Regional Manager | Finance Manager | Field Auditor | Readonly | Partner Owner/Store Manager |
|---|---:|---:|---:|---:|---:|---:|---:|
| View overview | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | Store only |
| View branch list | ✓ | ✓ | Assigned | ✓ | Assigned | ✓ | Own store only |
| Create/edit master catalog draft | ✓ | ✓ |  |  |  |  | Local only if policy |
| Publish catalog push | ✓ | ✓ |  |  |  |  |  |
| Roll back catalog push | ✓ | ✓ |  |  |  |  |  |
| View service availability matrix | ✓ | ✓ | Assigned | ✓ | Assigned | ✓ | Own store only |
| Emergency pause store service | ✓ | ✓ | Assigned |  |  |  | Own store ✓ |
| Re-enable store service | ✓ | ✓ | Assigned |  |  |  | Own store ✓ |
| Publish brand standard | ✓ | ✓ |  |  |  |  |  |
| Approve override request | ✓ | ✓ | Assigned |  |  |  |  |
| View reports | ✓ | ✓ | Assigned | ✓ | Limited | ✓ | Store only |
| Export reports | ✓ | ✓ |  | ✓ |  |  | Store only |
| Run compliance audit | ✓ | ✓ | Assigned |  | Assigned ✓ |  | Evidence only |
| Review compliance score | ✓ | ✓ | Assigned |  | Assigned | ✓ | Own store |
| Manage franchisees | ✓ |  |  | ✓ read/write if permitted |  |  |  |
| Run royalty preview | ✓ |  |  | ✓ |  |  |  |
| Lock royalty run | ✓ |  |  | ✓ with approval |  |  |  |
| Generate B2B invoice | ✓ |  |  | ✓ |  |  |  |
| Manage chain team | ✓ |  |  |  |  |  |  |
| View audit | ✓ | ✓ | Assigned | Finance audit | Own audits | Limited | Own store audit |
| Ask AI | ✓ | ✓ | Assigned | Finance-scoped | Audit-scoped | Read-only | Store AI only |
| Execute AI-drafted action | Permission-specific | Permission-specific | Permission-specific | Permission-specific | Permission-specific |  | Permission-specific |

### 10.3 Auth Model

| User type | Auth method | Session rule |
|---|---|---|
| Chain Portal users | Supabase Auth with email/password, magic link, or phone OTP `[REQUIRED: final method]` | JWT expiry `[REQUIRED]`, refresh via Supabase client. |
| Admin support | Supabase Auth + admin RBAC | Admin tool access only; support impersonation requires audit and explicit policy. |
| POS staff | PIN cached on Store Hub | No direct Chain Portal access. |
| Partner/store manager | Portal auth for Partner; POS PIN for register | May trigger service availability from Partner or POS if permitted. |

### 10.4 Sensitive Action Gating

| Action | Gate |
|---|---|
| Publish catalog push | Permission + reason + preview confirmation + audit. |
| Rollback catalog | Permission + reason + target list + audit. |
| Emergency pause service | Store/chain permission + reason + duration + audit. |
| Disable required brand service | Reason + optional notification to Chain HQ + audit. |
| Publish brand standard | Permission + reason + version snapshot + audit. |
| Approve override | Permission + decision note + expiry if relevant. |
| Lock royalty run | Finance permission + stale data confirmation + audit. |
| Generate B2B invoice | Finance permission + period + audit. |
| Export finance/report | Export permission + export audit. |
| Disable user | Chain owner only + confirmation + audit. |
| AI-drafted action | Human review + explicit confirmation; AI request/action log. |

### 10.5 Audit Logging

Every sensitive action writes `kitluy_audit.audit_logs` with at least:

| Field | Description |
|---|---|
| `id` | UUID. |
| `tenant_id` | Tenant scope. |
| `chain_id` | Chain scope if applicable. |
| `store_id` | Store target if applicable. |
| `actor_user_id` | User performing action. |
| `actor_role` | Role at time of action. |
| `action` | Stable action string. |
| `target_table` | Table affected. |
| `target_id` | Record affected. |
| `before_json` | Before snapshot when feasible. |
| `after_json` | After snapshot when feasible. |
| `reason` | Required for sensitive actions. |
| `source` | `chain_portal`, `partner_pwa`, `pos_desktop`, `admin_support`, `ai_gateway`. |
| `ip_address` | Client IP if available. |
| `user_agent` | Browser/device info if available. |
| `created_at` | Server timestamp. |

Audit logs are append-only in production. No update/delete except by break-glass DBA recovery, and such recovery must be externally logged.

### 10.6 Encryption and Privacy Standards

| Area | Rule |
|---|---|
| In transit | HTTPS/TLS 1.2+ minimum; TLS 1.3 preferred. |
| At rest | Supabase/DigitalOcean managed encryption. |
| Secrets | Stored in Supabase secrets, DigitalOcean app secrets, or approved vault. Never commit to Git. |
| PII | Customer/staff data displayed only under proper scope. Exporting customer data requires audit. |
| File access | Signed URL with short expiry; permission checked before signing. |
| AI | AI Gateway must redact or scope PII based on role and prompt policy. |
| Logs | Do not log raw tokens, secrets, PINs, or full payment details. |

---

## Part 11 — Deployment & Infrastructure

### 11.1 Cloud Provisioning

| Resource | Provider / Region | Requirement |
|---|---|---|
| Database/Auth/Realtime/Edge | Supabase SGP1 / Singapore | `[REQUIRED: production project ref]` |
| Web hosting | DigitalOcean SGP1 App Platform/static hosting | Chain Portal PWA. |
| Object storage | DigitalOcean Spaces SGP1 | Exports, evidence, generated PDFs, RAG source files. |
| AI runtime | DigitalOcean Inference Engine first | Through KitLuy AI Gateway only. |
| File Service | DigitalOcean service / Supabase functions | Signed uploads/downloads. |
| Notification Service | DigitalOcean service / edge functions | Telegram/SMS/email/push/in-app providers. |
| DNS/CDN | `[REQUIRED: Cloudflare / DO / other]` | Production and staging domains. |

Production exact values required before launch:

- `[REQUIRED: production Supabase project ref]`
- `[REQUIRED: staging Supabase project ref]`
- `[REQUIRED: DigitalOcean production project name]`
- `[REQUIRED: Spaces bucket names]`
- `[REQUIRED: production Chain Portal domain]`
- `[REQUIRED: staging Chain Portal domain]`

### 11.2 Local Node Provisioning

Chain Portal itself has no store hardware. For end-to-end validation, the following sibling infrastructure must exist:

| Node | Why required for E2E |
|---|---|
| Raspberry Pi 5 Store Hub | Store offline sync and heartbeat source. |
| POS Desktop | Creates real Laundry orders and reads effective services. |
| Receipt/tag printer | Validates store operational workflows. |
| Scanner/scale | Validates Laundry POS service use. |
| Partner PWA | Store-level service availability and store config. |
| Admin PWA | Tenant/chain/store provisioning and device registry. |

### 11.3 Client Registration

1. Admin PWA creates tenant.
2. Admin PWA creates Chain subscription/state.
3. Admin PWA creates Chain record or activation workspace.
4. Admin PWA invites first `chain_owner`.
5. Admin PWA provisions Laundry stores and links them to chain.
6. Store Hub and POS devices are registered under store.
7. Partner owner/store managers are created.
8. Chain owner logs into Chain Portal and confirms branch list.
9. Catalog push test confirms Store Hub/POS receives active service updates.

### 11.4 Secrets Injection

| Target | Injection method |
|---|---|
| Chain Portal web app | Public anon key and public environment only; no service keys. |
| Supabase Edge Functions | `supabase secrets set ...` or CI-managed secret deployment. |
| DigitalOcean services | DO App Platform encrypted environment variables. |
| Store Hub | Local `.env` or secure provisioning file, service-role-like sync credential where approved. |
| CI/CD | Repository environment secrets with protected branch deployments. |

### 11.5 Certificate and Domain Management

| Domain | Purpose | Requirement |
|---|---|---|
| `[REQUIRED: chain.kitluy... production domain]` | Chain Portal production | HTTPS, HSTS preferred. |
| `[REQUIRED: staging chain domain]` | Staging validation | Separate Supabase project and storage prefix. |
| `[REQUIRED: api domain if not Supabase default]` | Edge/service gateway | HTTPS. |

Certificate renewal must be automatic where possible. Manual renewal tasks must be tracked in monitoring.

### 11.6 Deployment Steps

```bash
# install dependencies
pnpm install

# build shared packages
pnpm --filter @kitluy/shared-types build
pnpm --filter @kitluy/ui build

# build Chain Portal
pnpm --filter kitluy-chain-portal lint
pnpm --filter kitluy-chain-portal test
pnpm --filter kitluy-chain-portal build

# deploy Supabase functions (authorized operator only)
supabase functions deploy chain-session-context
supabase functions deploy chain-dashboard-summary
supabase functions deploy chain-catalog-push
supabase functions deploy store-service-availability-set

# deploy web app through configured CI/CD
# [REQUIRED: exact CI/CD command]
```

Production deployments require:

- Approved migration set.
- Passing unit/integration tests.
- Passing Playwright smoke tests.
- Manual approval for production environment.
- Rollback artifact available.

---

## Part 12 — Monitoring, Observability & Alerting

### 12.1 Health Checks

| Component | Endpoint / source | Frequency | Healthy condition |
|---|---|---:|---|
| Chain Portal web | `GET /healthz` or static app health | 1 min | 200 response under 2s. |
| Supabase DB | Supabase health/dashboard | 1 min | Available, connection count normal. |
| Edge Functions | Synthetic request per critical function | 5 min | 200/expected auth response under 3s. |
| File Service | `GET /file-service/health` | 5 min | Can generate test signed URL. |
| AI Gateway | `GET /ai-gateway/health` | 5 min | Provider route available or degraded flag. |
| Notification Service | Provider heartbeat/status | 5-15 min | Provider status OK or degraded visible. |
| Store Hub heartbeat | `kitluy_sync.device_heartbeats` | 1 min ingest check | Last heartbeat under threshold. |

### 12.2 Heartbeat Semantics

| Component | Expected interval | Warning threshold | Critical threshold |
|---|---:|---:|---:|
| Store Hub | 60 seconds | > 5 minutes missing | > 15 minutes missing |
| POS Desktop | 60 seconds when active | > 5 minutes missing during open hours | > 15 minutes missing during open hours |
| POS Mobile | 5 minutes when active | > 15 minutes missing | > 60 minutes missing |
| Edge function synthetic | 5 minutes | 2 failures | 5 failures |
| Sync queue age | continuous | > 15 minutes | > 60 minutes |
| Catalog push target | event-based | queued > 10 minutes | queued/failed > 30 minutes |

### 12.3 Log Aggregation

| Log source | Retention | Search fields |
|---|---:|---|
| Supabase Edge logs | `[REQUIRED]` | request_id, function, user_id, chain_id, status. |
| DigitalOcean app logs | `[REQUIRED]` | service, route, severity, request_id. |
| Browser error logs | `[REQUIRED: Sentry or alternative]` | app version, route, user id hash. |
| AI logs | `[REQUIRED]` | ai_request_id, tool, latency, cost estimate, chain_id. |
| Audit logs | Product retention policy | actor, action, target, chain_id, store_id. |

### 12.4 Metrics and Dashboards

| Metric | Owner | Dashboard |
|---|---|---|
| Chain Portal page error rate | Frontend | App monitoring. |
| Edge function error rate | Backend | Supabase/DO. |
| Catalog push failure count | Chain Portal | Chain Ops dashboard. |
| Catalog push target queue age | Chain/Sync | Monitoring dashboard. |
| Active emergency service pauses | Chain Portal | Overview alerts. |
| Store stale count | Sync | Chain Overview. |
| Report export failures | File Service | Export Center / Platform Ops. |
| AI request failures | AI Gateway | AI Chain BI / Admin AI governance. |
| B2B invoice generation failures | Chain Finance | Finance monitoring. |
| Royalty run stale data warnings | Chain Finance | Royalty dashboard. |

### 12.5 Alert Thresholds

| Alert | Severity | Trigger |
|---|---|---|
| Chain Portal unavailable | P1 | Web app health fails 5 consecutive minutes. |
| Critical edge function failing | P1 | `chain-catalog-push` or `store-service-availability-set` fails synthetic 5 times. |
| Store Hub offline | P2 | Active branch heartbeat missing > 15 minutes. |
| Sync queue old | P2 | Queue age > 60 minutes for active branch. |
| Catalog push partial failure | P2 | Any target failed after retry. |
| Required service paused too long | P2 | Required brand service emergency-paused > configured threshold, default 4 hours. |
| Repeated emergency pauses | P3 | Same service/store paused 3+ times in 7 days. |
| Report export failure | P3 | Export job failed. |
| AI Gateway degraded | P3 | AI error rate > 10% over 15 minutes. |
| B2B invoice overdue | Business alert | Invoice overdue past configured days. |

### 12.6 Incident Runbooks

#### 12.6.1 Catalog Push Failure

1. Open Chain Portal Catalog Push detail.
2. Identify failed target stores.
3. Check edge function logs by `push_batch_id`.
4. Check store sync state.
5. Retry failed targets if validation-safe.
6. If retry fails, mark target `failed` and create support task.
7. Notify chain owner/regional manager if branch service availability is affected.

#### 12.6.2 Store Offline / Stale Data

1. Confirm `last_hub_heartbeat_at`.
2. Confirm branch open hours.
3. Check Admin Fleet Ops for device status.
4. Do not treat branch sales as zero.
5. Show stale warning in reports.
6. Contact store manager or HET support based on SLA.

#### 12.6.3 Emergency Service Pause Too Long

1. Open Service Availability matrix.
2. Review reason, actor, note, and expiry.
3. Contact store manager if beyond threshold.
4. Create compliance/corrective action if repeated.
5. Chain manager may extend or re-enable only if operationally safe.

---

## Part 13 — Backup & Disaster Recovery

### 13.1 Backup Schedule and Scope

| Data | Backup method | Frequency | Retention |
|---|---|---:|---:|
| Supabase PostgreSQL | Managed backup + manual pre-migration dump | Daily + before migrations | `[REQUIRED]` |
| DigitalOcean Spaces files | Bucket versioning / replication `[REQUIRED]` | Continuous/daily | `[REQUIRED]` |
| Edge function source | Git repository | Every commit | Permanent Git history. |
| Chain Portal build artifact | CI/CD artifact | Every release | `[REQUIRED]` |
| Store Hub local DB | Store Hub backup policy | Daily where configured | `[REQUIRED]` |
| Audit logs | DB backup and immutable table policy | Daily | Longer than operational data `[REQUIRED]` |

### 13.2 Restore Procedures

#### 13.2.1 Chain Portal Web App Failure

1. Confirm static host/app platform incident.
2. Roll back to last successful deployment artifact.
3. Verify `/healthz`.
4. Run Chain Portal smoke test: login, dashboard, branch list, catalog page.
5. Record incident in Platform Ops.

#### 13.2.2 Cloud DB Corruption

1. Stop all production writes if corruption is active.
2. Export current audit/event logs if possible.
3. Restore latest clean Supabase backup to staging.
4. Validate critical tables: chains, stores, catalog versions, push batches, service overrides, audit logs.
5. Promote restored DB according to Supabase DR procedure.
6. Re-run sync reconciliation for stores.
7. Notify affected customers.

#### 13.2.3 Accidental Catalog Push

1. Locate `catalog_push_batch_id`.
2. Confirm affected stores.
3. Use `chain-catalog-rollback` to previous catalog version.
4. Preserve active emergency pauses.
5. Verify target store effective services.
6. Audit rollback reason.
7. Notify branch managers.

#### 13.2.4 Lost Compliance Evidence File

1. Query file metadata in `kitluy_files.assets`.
2. Check Spaces object version/replica.
3. Restore object if available.
4. If not available, mark evidence missing and attach incident note.
5. Audit recovery action.

### 13.3 RPO / RTO Targets

| System | RPO target | RTO target |
|---|---:|---:|
| Chain Portal web app | 0 code loss, last release artifact | 30 minutes |
| Chain DB data | 24 hours max until final backup policy | 4 hours |
| Catalog/version/audit records | Same as DB; aim < 1 hour in future | 4 hours |
| DigitalOcean Spaces evidence | `[REQUIRED]` | `[REQUIRED]` |
| Store operations during WAN outage | POS/Hub local RPO near-zero locally | Store continues if Hub works |

### 13.4 Degraded Modes

| Failure | Chain Portal behavior | Store behavior |
|---|---|---|
| Chain Portal down | Chain users cannot access HQ portal. | POS/Partner continue if backend/store hub available. |
| Supabase down | Chain Portal unavailable/stale. | Store POS continues offline through Hub where configured. |
| WAN down at store | Chain Portal shows stale/offline branch. | Store continues locally; data syncs later. |
| File Service down | Evidence/export unavailable. | Core catalog/report reads continue. |
| AI Gateway down | AI Chain BI disabled/degraded. | Core operations unaffected. |
| Payment provider down | B2B/payment functions degraded. | Cash POS may continue; electronic payment affected. |


---

## Part 14 — Standard Operating Procedures

### 14.1 SOP — Provision New Chain

| Field | Value |
|---|---|
| Trigger | New chain customer signed or pilot approved. |
| Actor | HET Admin operator. |
| Tools | Admin PWA, Supabase, Chain Portal invite flow. |

Steps:

1. Admin logs into Admin PWA.
2. Create or select Tenant.
3. Assign Chain Plan or trial policy.
4. Create Chain record with name, brand slug, billing mode, primary owner.
5. Invite `chain_owner` user.
6. Link existing Laundry stores or create new store onboarding workspaces.
7. Apply default Laundry templates.
8. Register Store Hub/POS devices per store if live store operation is required.
9. Chain owner logs into Chain Portal.
10. Confirm Branches page shows expected stores.

Expected result: Chain owner can access Chain Portal and see linked Laundry stores.

Fallback: If chain owner cannot log in, verify Auth user, chain role assignment, tenant status, and subscription state.

### 14.2 SOP — Link Store to Chain

| Field | Value |
|---|---|
| Trigger | A branch is added to an existing chain. |
| Actor | Admin operator. |
| Tools | Admin PWA, Chain Portal. |

Steps:

1. Confirm store `vertical_type = laundry`.
2. Confirm store is active or onboarding.
3. Select Chain in Admin PWA.
4. Add store link with `store_relationship_type` and optional branch group.
5. Assign franchisee if needed.
6. Save and audit.
7. Chain user opens Branches.
8. Confirm store appears.

Expected result: Store appears in Chain Portal, while Partner Portal remains store-scoped.

Fallback: If store missing, verify `chain_stores` link, RLS policies, and user role assignment.

### 14.3 SOP — Create and Push Master Catalog

| Field | Value |
|---|---|
| Trigger | Chain HQ wants to standardize Laundry services. |
| Actor | Chain owner or chain manager. |
| Tools | Chain Portal. |

Steps:

1. Open Catalog Control.
2. Create draft catalog version.
3. Add services: Wash & Fold, Wash & Iron, Dry Clean, Press Only, Stain Removal, Bedding/Blanket, Express Service.
4. Configure service type: per-kg, per-piece, flat, or add-on.
5. Set KHR price, min/max rules, due hours, and availability policy.
6. Validate catalog version.
7. Open Push Preview.
8. Select target stores.
9. Review stale store and emergency pause warnings.
10. Confirm push with reason.
11. Monitor push targets.
12. Verify one store receives updated catalog in Partner/POS.

Expected result: Target stores receive updated chain services. Existing emergency pauses remain active.

Fallback: Retry failed target. If unsafe price/config was pushed, use Catalog Rollback.

### 14.4 SOP — Store Emergency Pause Service

| Field | Value |
|---|---|
| Trigger | Store cannot offer a service due to machine, staff, supply, power, water, capacity, quality, or safety issue. |
| Actor | Partner owner, store manager, supervisor, or POS manager. |
| Tools | Partner PWA or POS manager mode. |

Steps:

1. Open Store Management > Services or POS manager unavailable-service action.
2. Select service.
3. Choose Emergency Pause.
4. Select reason code.
5. Enter internal note.
6. Enter customer-facing message if needed.
7. Choose duration or expiry time.
8. Confirm affects POS and future online booking.
9. Submit.
10. Verify service is hidden/blocked in POS.
11. Verify Chain Portal Service Availability matrix shows pause.

Expected result: Service is unavailable for new orders at that branch only. Existing orders remain valid.

Fallback: If POS still shows service, check sync/realtime; trigger manual sync or restart POS service cache. If urgent, tell staff to avoid intake manually and contact support.

### 14.5 SOP — Re-enable Paused Service

| Field | Value |
|---|---|
| Trigger | Store issue resolved. |
| Actor | Store manager, Partner owner, or authorized Chain manager. |
| Tools | Partner PWA, POS manager mode, or Chain Portal. |

Steps:

1. Open active service pause.
2. Verify operational issue resolved.
3. Click Re-enable.
4. Enter resolution note.
5. Confirm.
6. Verify POS service grid shows service again.
7. Verify Chain Portal matrix status is available.

Expected result: Service becomes available for new orders.

Fallback: If service remains unavailable, check `hq_enabled`, catalog version state, store override expiry, and POS sync status.

### 14.6 SOP — Run Compliance Audit

| Field | Value |
|---|---|
| Trigger | Scheduled branch audit or repeated issue/service pause. |
| Actor | Field auditor or regional manager. |
| Tools | Chain Portal tablet/desktop, File Service. |

Steps:

1. Open Compliance > New Audit.
2. Select branch and checklist template.
3. Complete checklist items.
4. Upload evidence photos/documents via signed upload.
5. Enter notes and scores.
6. Submit audit.
7. Review computed score.
8. Create corrective actions if required.
9. Notify branch manager.

Expected result: Submitted audit is immutable, evidence is stored in Spaces, corrective actions are tracked.

Fallback: If upload fails, save draft without evidence and retry when File Service recovers.

### 14.7 SOP — Run Royalty Period

| Field | Value |
|---|---|
| Trigger | Monthly franchise royalty calculation. |
| Actor | Finance manager or chain owner. |
| Tools | Chain Portal. |

Steps:

1. Open Royalties > New Run.
2. Select period.
3. Select franchisees.
4. Preview royalty calculation.
5. Review stale-store warnings.
6. Confirm revenue source and rule applied.
7. Calculate run.
8. Review generated lines.
9. Lock run when approved.
10. Export statement.

Expected result: Royalty run is stored and, once locked, cannot be edited directly.

Fallback: If stale-store warnings are unacceptable, wait for sync, exclude branch with explanation, or create adjustment after lock.

### 14.8 SOP — Generate Chain B2B Invoice

| Field | Value |
|---|---|
| Trigger | Monthly invoice for hotel/spa/corporate laundry contract. |
| Actor | Finance manager or chain owner. |
| Tools | Chain Portal, File Service. |

Steps:

1. Open B2B > Contracts.
2. Select contract.
3. Choose invoice period.
4. Preview order/service lines.
5. Review branch/store inclusion.
6. Generate invoice.
7. Export PDF/CSV.
8. Send or mark ready for manual sending depending on notification policy.

Expected result: Invoice created, file generated, audit written.

Fallback: If export fails, retry export job; invoice record remains draft or issued based on step reached.

### 14.9 SOP — Provision Franchisee and Activate Agreement

| Field | Value |
|---|---|
| Trigger | Signed franchise deal or approved pilot franchise unit. |
| Actor | Chain Owner/Chain Manager; Admin operator for platform provisioning. |
| Tools | Admin PWA, Chain Portal, File Service. |

Steps:

1. Confirm Tenant, Chain, and intended Laundry Stores exist in Admin PWA.
2. In Chain Portal, create Franchisee with legal/contact/billing metadata.
3. Create or select published Royalty Rule.
4. Create draft Franchise Agreement with dates and billing mode.
5. Upload signed agreement evidence through File Service.
6. Link eligible Stores to Franchisee/agreement.
7. Validate no Store/period overlap.
8. Activate agreement.
9. Confirm Franchise view lists the Store units and active rule.
10. Review audit trail.

Expected result: Active Franchisee/agreement with valid Store links and no cross-Chain leakage.

Fallback: If a Store fails validation, leave agreement draft, correct Admin provisioning/Chain link, and retry. Never bypass vertical or Tenant checks.

### 14.10 SOP — Assign Audit and Verify Corrective Action

| Field | Value |
|---|---|
| Trigger | Scheduled compliance cycle, incident, repeated rewash/damage, or management request. |
| Actor | Chain Manager/Regional Manager assigns; Field Auditor audits; Store Manager resolves. |
| Tools | Chain Portal PWA/tablet, File Service, Notification Service. |

Steps:

1. Select published Compliance Template.
2. Create Audit Assignment with Store, auditor, schedule, and due time.
3. Auditor accepts assignment and completes every required item.
4. Upload required evidence.
5. Submit audit.
6. Confirm score, result, and Critical Fail count.
7. Review auto-created Corrective Actions.
8. Store Manager acknowledges and submits resolution evidence.
9. Auditor/Regional Manager verifies or rejects resolution.
10. Confirm resolved action and complete audit history.

Expected result: Immutable audit plus traceable corrective-action lifecycle and evidence.

Fallback: Save draft during connectivity/file failure. Submission is blocked when required answers/evidence are missing.

### 14.11 SOP — Correct a Locked Royalty Run

| Field | Value |
|---|---|
| Trigger | Late refund, void, sync correction, contract correction, or approved credit/debit after lock. |
| Actor | Finance Manager or Chain Owner. |
| Tools | Chain Portal Royalties. |

Steps:

1. Open locked Royalty Run.
2. Identify affected Franchisee/Store line.
3. Confirm source financial evidence.
4. Create signed KHR Royalty Adjustment with reason code and note.
5. Obtain second approval when threshold policy requires it.
6. Confirm adjustment appears separately from original line.
7. Regenerate statement/export.
8. Review audit event.

Expected result: Original locked calculation remains unchanged; payable total reflects append-only adjustment.

Fallback: If evidence is incomplete, keep adjustment pending/unapproved and do not alter the Run.

---

## Part 15 — QA Test Matrix & Acceptance Criteria

### 15.1 QA Matrix

| ID | Name | Path | Exact pass condition | Validator SQL / API |
|---|---|---|---|---|
| CHN-QA-001 | Chain owner login | Login -> session context -> Overview | JWT resolves one active Chain role; UI header shows correct Chain. | `GET /chain-session-context`; compare `chain_id`. |
| CHN-QA-002 | Cross-Chain isolation | Chain A user calls Chain B URL/API | API returns 403/404; UI shows no Chain B data. | `select * from kitluy_chain.chains where id=:chain_b`; RLS returns 0 rows as Chain A user. |
| CHN-QA-003 | Branch list | Open Branches | UI count equals active `chain_stores` links in actor scope. | `select count(*) from kitluy_chain.chain_stores where chain_id=:c and removed_at is null`. |
| CHN-QA-004 | Branch performance | Compare two Stores for period | UI net totals equal reporting projection; freshness visible. | Compare API response to `sum(net_sales_khr)` in approved report view. |
| CHN-QA-005 | Stale branch | Stop test Hub heartbeat | Branch shows `stale/offline`, never silently reports zero. | Set heartbeat older than threshold; `GET /chain-stores-list`. |
| CHN-QA-006 | Draft catalog version | Create service and save draft | New immutable snapshot draft with next version number. | `select status,version_number from kitluy_chain.catalog_versions where id=:id`. |
| CHN-QA-007 | Catalog push | Push to two Stores | Two targets and two assignments reach applied/acknowledged state. | Count `catalog_push_targets` and `catalog_store_assignments`. |
| CHN-QA-008 | Push preserves pause | Pause Dry Clean, then push new version | Assignment changes; active pause and effective unavailable state remain. | Query override `is_active=true` and `effective_store_services.availability_state='emergency_paused'`. |
| CHN-QA-009 | Catalog rollback | Roll back one Store | New assignment references previous version and old assignment is superseded. | Inspect `previous_assignment_id`, statuses, Store projection. |
| CHN-QA-010 | Emergency pause | Partner pauses service | POS blocks new line; Chain matrix shows reason/expiry. | Active override row + effective state + POS effective-service response. |
| CHN-QA-011 | Re-enable service | Resolve pause | Override inactive; effective state available when HQ/store enabled. | Query override timestamps and effective projection. |
| CHN-QA-012 | Availability matrix | Filter by service/reason | Matrix lists every in-scope Store exactly once. | `GET /chain-service-availability-list`; compare Store IDs. |
| CHN-QA-013 | Brand standard publish | Publish receipt standard | Published version immutable; target materialization queued. | Standard status/published_at + event `chain_standard_published`. |
| CHN-QA-014 | Catalog exception | Store requests price exception | HQ-locked returns 422; approval-required remains pending; no projection mutation before approval. | API response + effective price unchanged. |
| CHN-QA-015 | Price guardrail | Request price below floor | Request rejected; no approved exception. | API 422; query exception table/status. |
| CHN-QA-016 | Report export | Export branch sales CSV | Job completes; asset belongs to same Tenant/Chain; signed URL expires. | Export job/asset rows and signed download HEAD. |
| CHN-QA-017 | Regional scope | Regional Manager opens unassigned Store | Store absent/403; assigned group visible. | `user_can_access_store()` for both Stores. |
| CHN-QA-018 | Finance role isolation | Finance Manager attempts catalog push | 403; no push batch/audit mutation row. | API response; row count unchanged. |
| CHN-QA-019 | Chain Manager authority | Chain Manager publishes catalog | Allowed with preview/reason/audit. | Push batch actor role = `chain_manager`. |
| CHN-QA-020 | Chain read-only | Chain Readonly attempts any mutation | 403; UI mutation controls hidden/disabled. | API response and no domain/audit mutation. |
| CHN-QA-021 | Audit completeness | Execute catalog push | Audit contains actor, role, target, before/after/reason/source/time. | Query `kitluy_audit.audit_logs` by target ID. |
| CHN-QA-022 | No POS writes | Attempt Booking creation from Chain | No route or 403; Booking tables unchanged. | Compare Booking count before/after. |
| CHN-QA-023 | KHR formatting | View all money cards/exports | UI uses `៛`, integer values, no floating artifacts. | UI snapshot + exported integer cells. |
| CHN-QA-024 | Suspended subscription | Suspend Chain subscription | Reads allowed per policy; catalog/franchise/royalty mutations blocked. | Mutation API returns 403/422 with subscription code. |
| CHN-QA-025 | Evidence upload | Upload audit photo | File asset scoped to Tenant/Chain and retrievable only by authorized signed URL. | Asset metadata + unauthorized download denied. |
| CHN-QA-026 | Franchisee create | Create Franchisee | Row uses correct Chain/Tenant and unique code; event/audit exist. | Query `franchisees` + event/audit. |
| CHN-QA-027 | Agreement activation | Create, sign, link, activate agreement | Active agreement has evidence/rule/dates; Store link valid and non-overlapping. | Agreement/chain_stores query + overlap validation call. |
| CHN-QA-028 | Cross-Chain franchise link | Link Chain B Store to Chain A Franchisee | 422/403; no link written. | Query link rows = 0. |
| CHN-QA-029 | Compliance weighted score | Submit known 4-item audit | `score_bps` equals hand-calculated weighted score; UI percentage matches. | Query audit and recompute from answers/items. |
| CHN-QA-030 | Compliance Critical Fail | Score critical item zero | Result `critical_fail` even if numeric score above pass threshold. | Audit `result='critical_fail'`, count > 0. |
| CHN-QA-031 | Required evidence | Submit item requiring evidence without asset | 422; audit remains draft. | API response; submitted_at is null. |
| CHN-QA-032 | Corrective Action SLA | Submit failed audit | Actions created with correct severity due dates. | Compare `due_at` to policy defaults. |
| CHN-QA-033 | Corrective verification | Assignee submits; auditor verifies | State transitions valid; resolution/evidence retained; verifier audit written. | Query corrective action history/audit. |
| CHN-QA-034 | Royalty percentage | Preview fixed known base/rate | KHR amount matches half-up basis-point formula. | Compare API output to `round_khr_half_up(base*rate_bps/10000)`. |
| CHN-QA-035 | Royalty lock immutability | Lock reviewed Run then update line | Update denied; run/lines unchanged. | SQL update as app role fails; checksum unchanged. |
| CHN-QA-036 | Stale royalty gate | Include Store stale >24h | Lock blocked unless explicit authorized exception. | API 422 or audit with confirmed stale Store IDs. |
| CHN-QA-037 | Royalty adjustment | Add -25,000 KHR to locked Run | Original line unchanged; adjustment append-only; payable total reduced. | Query line hash, adjustment, aggregate total. |
| CHN-QA-038 | B2B invoice | Generate known contract period | `total_khr=subtotal_khr+tax_khr`; asset generated and scoped. | Invoice row + export asset. |
| CHN-QA-039 | AI scoped answer | Ask cross-branch question | Sources all belong to actor Chain/Stores; no unauthorized IDs. | AI request/tool logs and source ownership query. |
| CHN-QA-040 | AI confirmation gate | AI drafts corrective action | No mutation before explicit confirm; confirmed action audited. | Compare corrective action count before/after confirmation. |
| CHN-QA-041 | Connector status | Open Integrations | Disabled/future connectors show inactive/readiness; no raw credentials. | UI/API payload excludes secret fields. |
| CHN-QA-042 | PWA offline | Disconnect browser and attempt mutation | Shell/read-only cached screen may render; no mutation request queued or falsely confirmed. | Browser network log + no DB rows. |

### 15.2 Acceptance Criteria

- MVP pilot requires `CHN-QA-001` through `CHN-QA-025`, `CHN-QA-039` through `CHN-QA-042` when the corresponding feature is enabled.
- Franchise/royalty/compliance go-live requires `CHN-QA-026` through `CHN-QA-038`.
- Every scenario must store evidence: test data IDs, API response, validator output, UI screenshot when applicable, tester, date, and environment.
- No QA scenario may require a removed/future sibling dependency.
- Failed QA blocks the affected module; bypass requires documented owner acceptance and a dated Appendix C item.

---

## Part 16 — Go-Live Checklist

### 16.1 Infrastructure

- [ ] Supabase production project exists in Singapore/SGP1 or approved region.
- [ ] DigitalOcean production project exists in SGP1.
- [ ] Chain Portal production domain configured with HTTPS.
- [ ] DigitalOcean Spaces bucket exists for exports/evidence.
- [ ] File Service deployed and signed URL flow tested.
- [ ] Chain Portal Edge Functions deployed.
- [ ] RLS enabled on Chain tables.
- [ ] Audit tables protected from update/delete.
- [ ] Realtime/sync channels tested where applicable.
- [ ] AI Gateway health verified if AI Chain BI enabled.
- [ ] Notification Service configured if alerts enabled.

### 16.2 Data and Config

- [ ] Chain roles seeded.
- [ ] Default branch groups seeded or empty-state tested.
- [ ] Default Laundry master catalog seeded.
- [ ] Service availability reason codes seeded.
- [ ] Brand-standard templates seeded.
- [ ] Override policy defaults seeded.
- [ ] Compliance checklist templates seeded if compliance enabled.
- [ ] Royalty templates seeded if royalties enabled.
- [ ] B2B contract defaults seeded if B2B enabled.
- [ ] AI prompt policy seeded if AI enabled.
- [ ] Alert thresholds seeded.
- [ ] Plan prices/trial/grace either finalized or safely configurable.

### 16.3 Store / Hardware Dependencies

- [ ] At least one test Laundry store provisioned.
- [ ] Store Hub registered and heartbeat visible.
- [ ] POS Desktop registered and heartbeat visible.
- [ ] Partner PWA can see store catalog.
- [ ] POS can use active chain-pushed service.
- [ ] Store service emergency pause hides service in POS.
- [ ] Re-enable resumes service in POS.

### 16.4 People

- [ ] Chain owner account can log in.
- [ ] Chain manager account can log in.
- [ ] Chain readonly account can log in and cannot mutate.
- [ ] Regional manager account can log in and is scoped correctly.
- [ ] Finance manager account can log in and is scoped correctly.
- [ ] Field auditor can log in if compliance enabled.
- [ ] Partner owner/store manager tested for service availability action.
- [ ] HET support knows Admin/Chain/Partner/POS boundaries.

### 16.5 Validation

- [ ] MVP QA scenarios passed in staging.
- [ ] Cross-chain RLS isolation passed.
- [ ] Catalog push and rollback tested.
- [ ] Emergency pause preservation during catalog push tested.
- [ ] Brand standard publish tested.
- [ ] Report export tested.
- [ ] Audit log reviewed.
- [ ] Sync freshness warning tested.
- [ ] Subscription suspended read-only behavior tested.
- [ ] PWA offline mutation block tested.
- [ ] Franchisee/agreement activation tested if franchise module enabled.
- [ ] Compliance score, Critical Fail, and corrective-action SLA tested if compliance enabled.
- [ ] Royalty lock, stale-data gate, and append-only adjustment tested if royalties enabled.

### 16.6 Pilot and Monitor

- [ ] Pilot chain selected.
- [ ] Two or more pilot stores linked if possible.
- [ ] HET support contact assigned.
- [ ] First catalog push monitored.
- [ ] First service emergency pause/re-enable test completed.
- [ ] Daily branch report reviewed for first 7 days.
- [ ] Sync stale alerts monitored.
- [ ] Post-pilot feedback review scheduled.

---

## Part 17 — Module / Feature Inventory

### 17.1 Build-by-Build Feature Table

| Capability | Admin PWA | Chain Portal | Partner PWA/App | POS Desktop/Mobile | Backend/service |
|---|---|---|---|---|---|
| Tenant provisioning | Owns | Reads if assigned | Reads own tenant | No | Admin functions |
| Chain activation | Owns initial creation | Owns profile after activation | No | No | Chain functions |
| Store provisioning | Owns | Reads linked stores | Reads own store | Reads assigned store | Admin/store functions |
| Device registry | Owns | Reads aggregate | Reads own store devices | Reports heartbeat | Device/sync functions |
| Master Laundry catalog | Seeds defaults | Owns master catalog | Receives/apply local policy | Uses active services | Chain/catalog functions |
| Catalog push | No daily ownership | Owns | Receives | Receives via sync | `chain-catalog-push` |
| Store service availability | Support/audit | View/govern | Owns local availability | Enforces availability | `store-service-availability-set` |
| Brand standards | Seeds defaults only | Owns chain standards | Applies | Displays/prints if relevant | standards functions |
| Store staff | No daily management | Aggregate/read only | Owns employees/PINs | Uses PIN/session | Partner/POS functions |
| Orders/payments | Aggregate/support read | Aggregate branch read | Store read/reconcile | Owns write/capture | Orders/payment functions |
| Reports | Platform reports | Chain reports | Store reports | Shift/Z reports | report/export functions |
| Compliance | Platform audit/support | Owns chain audits | Store evidence/input | No | compliance/file functions |
| Royalties | No | Owns chain-internal royalties | No | No | royalty functions |
| B2B | No | Owns chain contracts/invoices | Store-level customer data source | No | B2B/export functions |
| AI | Governs platform AI | Chain BI | Store BI | No | AI Gateway/MCP |
| Integrations | Owns connector registry | Reads status/preferences | Reads store connector state | Uses configured connectors | Integration service |
| Audit | Platform-wide | Chain-scoped | Store-scoped | POS events | audit service |

### 17.2 Feature-ID System

| Feature ID | Feature | Module | Phase | Key functions | QA |
|---|---|---|---|---|---|
| `KF-CHN-001` | Chain Overview | Overview | MVP | `chain-dashboard-summary` | CHN-QA-001,005 |
| `KF-CHN-002` | Branch Performance | Branches/Reports | MVP | `chain-branch-compare` | CHN-QA-004 |
| `KF-CHN-003` | Store Network | Branches | MVP | `chain-stores-list` | CHN-QA-003 |
| `KF-CHN-004` | Chain Team & RBAC | Team | MVP | role functions | CHN-QA-016,017 |
| `KF-CHN-005` | Master Laundry Catalog | Catalog | MVP | `chain-catalog-version-create` | CHN-QA-006 |
| `KF-CHN-006` | Catalog Push | Catalog | MVP | `chain-catalog-push` | CHN-QA-007 |
| `KF-CHN-007` | Store Override Governance | Standards/Availability | MVP | `chain-override-request-review` | CHN-QA-014 |
| `KF-CHN-008` | Brand Standards | Standards | MVP | `chain-standard-publish` | CHN-QA-013 |
| `KF-CHN-009` | Compliance Program | Compliance | 1.5 | `chain-compliance-assignment-create`, `chain-compliance-submit`, `chain-corrective-action-update` | CHN-QA-029-033 |
| `KF-CHN-010` | Chain Reports | Reports | MVP | `chain-report-export-create` | CHN-QA-015 |
| `KF-CHN-011` | Sync & Store Health | Branches/Overview | MVP | health reads | CHN-QA-005 |
| `KF-CHN-012` | Chain Activity & Audit | Audit | MVP | audit reads | CHN-QA-018 |
| `KF-CHN-013` | Chain Settings | Settings | MVP | profile update | CHN-QA-001 |
| `KF-CHN-014` | Franchise Structure | Franchise | 1.5 | `chain-franchisee-create`, `chain-franchise-agreement-create`, `chain-franchise-store-link` | CHN-QA-026-028 |
| `KF-CHN-015` | Royalty Rules | Royalties | 1.5 | royalty rule functions | CHN-QA-024 |
| `KF-CHN-016` | Royalty Runs | Royalties | 1.5 | `chain-royalty-run-calc`, `chain-royalty-run-lock`, `chain-royalty-adjustment-create` | CHN-QA-034-037 |
| `KF-CHN-017` | Territory Management | Franchise/Map | 2 | territory functions | future QA |
| `KF-CHN-018` | Chain B2B Contracts | B2B | 1.5 | `chain-b2b-invoice-generate` | CHN-QA-026 |
| `KF-CHN-019` | Chain Promotions | Promotions | 1.5 | promo functions | future QA |
| `KF-CHN-020` | Chain Loyalty | Loyalty | 2 | loyalty functions | future QA |
| `KF-CHN-021` | AI Chain BI | AI | 1.5/2 | `chain-ai-ask` | CHN-QA-027,028 |
| `KF-CHN-022` | Integration Status | Integrations | MVP/1.5 | connector reads | CHN-QA-029 |
| `KF-CHN-023` | Field Audit Tablet Mode | Compliance | 2 | compliance UI | future QA |
| `KF-CHN-024` | Store Availability Governance | Availability | MVP | `chain-service-availability-list` | CHN-QA-012 |
| `KF-CHN-025` | Availability Policy | Availability | MVP | policy functions | CHN-QA-010,011 |
| `KF-CHN-026` | Emergency Pause Alerts | Availability/Alerts | MVP | notification functions | CHN-QA-010 |
| `KF-PRT-SVC-AVAIL` | Partner Service Availability | Partner PWA | MVP | `store-service-availability-set` | CHN-QA-010,011 |
| `KF-POS-SVC-BLOCK` | POS Availability Enforcement | POS | MVP | POS effective service read | CHN-QA-010,011 |

### 17.3 Web/PWA Parity Rules

Chain Portal v2.0.0 is a web/PWA product only. There is no native Chain mobile app in this version.

| Form factor | Rule |
|---|---|
| Desktop web | Primary experience; full functionality. |
| Desktop installed PWA | Same as web; static shell cache only. |
| Tablet web/PWA | Supported for dashboards, branch review, and field audits. |
| Phone web | Read-only emergency triage unless future approval. |
| Offline PWA | No business-data mutation. Show reconnect or read-only shell. |

---

## Part 18 — Version History

| Version | Date | Author | Change Summary | Migration Files Affected | Reconciliation Items Closed |
|---|---|---|---|---|---|
| v2.0.0 | 2026-07-13 | HET / ChatGPT planning assistant | Consolidated complete Chain Portal rebuild bible using the supplied template. Strengthens multi-store boundaries, canonical Chain roles, catalog assignment/exception/availability logic, full franchise agreements and royalty append-only model, compliance templates/assignments/scoring/corrective actions, API contracts, SOPs, exact QA validators, and go-live controls. | Target `000`-`014` sequence; reviewed live SQL still required before production | Closed historical naming/dependency conflicts; open production values isolated in Appendix C. |
| v1.0.0 | 2026-06-16 | HET prior Chain planning | Original Chain Portal bible with master catalog, franchise, royalties, territories, compliance, B2B, Chain loyalty, and older ecosystem dependencies. | Legacy chain migrations | Superseded for v2 planning. |

---

## Appendix A — Data Dictionary

This appendix is a quick reference. Part 6 remains canonical.

### A.1 `kitluy_chain.chains`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | Chain identity. |
| `tenant_id` | uuid | not null FK | Owning Tenant. |
| `chain_code` | text | unique per Tenant, not null | Human code. |
| `display_name` | text | not null | Brand/Chain name. |
| `vertical_type` | text/enum | immutable, not null | MVP `laundry`. |
| `status` | chain_status | not null | `draft, trial, active, suspended, cancelled, archived`. |
| `timezone` | text | not null | Default `Asia/Phnom_Penh`. |
| `currency_code` | text | not null | `KHR`. |

### A.2 `kitluy_chain.chain_stores`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | Link identity. |
| `tenant_id` | uuid | not null FK | Tenant scope. |
| `chain_id` | uuid | not null FK | Chain. |
| `store_id` | uuid | not null FK | Store. |
| `branch_group_id` | uuid | nullable FK | Region/group. |
| `franchisee_id` | uuid | nullable FK | Operator. |
| `store_relationship_type` | store_relationship_type | not null | `company_owned, franchisee, partner_operated`. |
| `status` | chain_store_status | not null | Link lifecycle. |

### A.3 `kitluy_chain.catalog_versions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK | Version. |
| `chain_id` | uuid | not null FK | Chain. |
| `version_number` | integer | unique per Chain | Monotonic. |
| `status` | catalog_version_status | not null | `draft, published, archived`. |
| `snapshot_json` | jsonb | not null | Immutable after publish. |
| `published_at` | timestamptz | nullable | Publish time. |

### A.4 `kitluy_chain.catalog_store_assignments`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `store_id` | uuid | not null FK | Target Store. |
| `catalog_version_id` | uuid | not null FK | Effective version. |
| `source_push_batch_id` | uuid | nullable FK | Source push. |
| `previous_assignment_id` | uuid | nullable self FK | Rollback lineage. |
| `status` | catalog_assignment_status | not null | `pending, applied, failed, rolled_back, superseded`. |
| `hub_acknowledged_at` | timestamptz | nullable | Store receipt proof. |

### A.5 `kitluy_chain.store_service_availability_overrides`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `store_id` | uuid | not null FK | Store. |
| `service_id` | uuid | not null FK | Master Service. |
| `override_type` | service_availability_override_type | not null | Disable/enable/emergency/scheduled. |
| `reason_code` | service_availability_reason_code | not null | Operational reason. |
| `starts_at` / `ends_at` | timestamptz | start required | Effective window. |
| `is_active` | boolean | not null | Current flag. |
| `approval_status` | override_approval_status | not null | Governance state. |

### A.6 `kitluy_chain.franchise_agreements`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `franchisee_id` | uuid | not null FK | Franchisee. |
| `agreement_no` | text | unique per Chain | Contract code. |
| `status` | franchise_agreement_status | not null | Agreement lifecycle. |
| `starts_on` / `ends_on` | date | start required | Contract period. |
| `billing_mode` | franchise_billing_mode | not null | Consolidated/direct/hybrid. |
| `royalty_rule_id` | uuid | nullable FK | Rule. |
| `signed_asset_id` | uuid | nullable FK | Evidence. |

### A.7 `kitluy_chain.royalty_runs` and `royalty_run_lines`

| Field | Type | Rule |
|---|---|---|
| `period_start`, `period_end` | date | Inclusive period. |
| `gross_sales_khr`, `net_sales_khr` | bigint | Integer KHR snapshots. |
| `royalty_amount_khr` | bigint | Formula output before adjustments. |
| `status` | royalty_run_status | `draft, reviewed, locked, disputed, voided`. |
| `source_freshness` | report_freshness_state | Per-Store line freshness. |
| `calculation_json` | jsonb | Exact rule/input snapshot. |

### A.8 `kitluy_chain.compliance_audits` and `compliance_audit_answers`

| Field | Type | Rule |
|---|---|---|
| `template_id` | uuid FK | Published version used. |
| `score_bps` | integer | 0-10000. |
| `result` | compliance_result | `passed, failed, critical_fail`. |
| `critical_fail_count` | integer | Derived count. |
| answer `score` | integer | 0 to item max. |
| answer `evidence_asset_ids` | uuid[] | Validated Chain/File scope. |

### A.9 `kitluy_chain.corrective_actions`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `audit_id` | uuid | not null FK | Source Audit. |
| `severity` | corrective_action_severity | not null | SLA source. |
| `status` | corrective_action_status | not null | Action lifecycle. |
| `due_at` | timestamptz | not null | SLA deadline. |
| `resolution_note` | text | required on resolution | |
| `verified_by_user_id` | uuid | nullable FK | Closure verifier. |

### A.10 `kitluy_audit.audit_logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `tenant_id`, `chain_id`, `store_id` | uuid | scoped | Target scope. |
| `actor_user_id`, `actor_role` | uuid/text | not null for user action | Actor snapshot. |
| `action` | text | not null | Stable event key. |
| `target_table`, `target_id` | text/uuid | nullable | Target. |
| `before_json`, `after_json` | jsonb | nullable | Change evidence. |
| `reason` | text | required for sensitive actions | |
| `created_at` | timestamptz | not null | Append-only timestamp. |

---

## Appendix B — FAQ

### B.1 Operator FAQ

**Can Chain Portal create customer laundry orders?**  
No. Orders are created in POS Desktop/Mobile through Store Hub.

**Can Chain Portal change a store from Laundry to Cafe?**  
No. Store vertical is immutable. A multi-vertical business must create separate stores or separate chains.

**Can the branch pause a chain-pushed service?**  
Yes. Store-level operational availability belongs to Partner/store operations. A branch can emergency-pause or disable a service with reason, audit, and optional expiry.

**Can a catalog push reactivate a paused service?**  
No. Chain catalog push updates definition/version but preserves active emergency pauses.

**Can Chain users see all KitLuy tenants?**  
No. They only see their chain and linked stores.

### B.2 Engineer FAQ

**Where do files go?**  
DigitalOcean Spaces through KitLuy File Service, not heavy Supabase Storage.

**Can Chain Portal use Netra directly?**  
No. v2 uses KitLuy AI Gateway/RAG/MCP and provider-agnostic inference.

**Does Chain Portal have offline writes?**  
No. It is cloud/web management software. Store POS/Hub handles offline operation.

**What happens when a branch is offline?**  
Chain Portal shows stale/offline freshness. Reports must not count offline stores as zero sales.

### B.3 Stakeholder FAQ

**What is the MVP value?**  
A Laundry chain can standardize services, compare branches, monitor store health, and control brand rules without forcing each branch into one isolated POS box.

**What is the biggest differentiator?**  
Cambodia-first offline-aware chain operations: central HQ control plus store-level emergency flexibility.

---

## Appendix C — Reconciliation Register and Production Decisions

### C.1 Closed Reconciliations

| ID | Historical conflict | Canonical v2 resolution |
|---|---|---|
| RC-CHN-001 | Seller naming in older documents. | Use Partner; legacy Seller maps only for history/migration. |
| RC-CHN-002 | Netra as mandatory AI dependency. | Use KitLuy AI Gateway/RAG/MCP; provider remains swappable. |
| RC-CHN-003 | Rotanak/Chain loyalty ambiguity. | No active loyalty dependency in MVP; KitLuy-native/connector scope is future. |
| RC-CHN-004 | HSAL/logistics dependency. | Generic optional logistics connector only. |
| RC-CHN-005 | SroulERP dependency. | Export/readiness only; not required for MVP. |
| RC-CHN-006 | Supabase Storage as heavy-file layer. | DigitalOcean Spaces through File Service. |
| RC-CHN-007 | Store service availability ownership unclear. | Store can operationally pause/re-enable; Chain owns governance and visibility; HQ catalog remains authoritative. |
| RC-CHN-008 | Chain roles inconsistent across sections. | Canonical roles: chain_owner, chain_manager, regional_manager, finance_manager, field_auditor, chain_analyst, chain_readonly. |
| RC-CHN-009 | Locked financial correction behavior unclear. | Royalty Runs/lines immutable after lock; append-only adjustments only. |
| RC-CHN-010 | Compliance scoring incomplete. | Weighted basis-point score plus Critical Fail override and corrective-action SLA. |

### C.2 Open Production Decisions

| ID | Decision required | Affected Parts | Required resolution | Owner | Target |
|---|---|---|---|---|---|
| OPEN-CHN-001 | Production Supabase project ref and reviewed migration filenames. | 0,5,6,11 | Record exact refs and replace target migration placeholders after backend review. | Backend/Ops | Before staging apply |
| OPEN-CHN-002 | Final Chain Plan price, trial, grace, suspension behavior. | 2,8,16 | Approve business policy in Admin billing configuration. | Business Owner | Before pilot billing |
| OPEN-CHN-003 | Authentication method, JWT/session timeout, MFA policy. | 4,10 | Approve Supabase Auth configuration. | Security/Product | Before production |
| OPEN-CHN-004 | Production/staging domains, DNS/CDN provider. | 5,11 | Record exact domains and certificate owner. | Ops | Before staging |
| OPEN-CHN-005 | Spaces bucket names, quotas, evidence/export retention. | 4,5,12,13 | Approve data classification and retention schedule. | Ops/Compliance | Before compliance pilot |
| OPEN-CHN-006 | Compliance default template weights and policy overrides. | 6,8,14,15 | Publish first approved Laundry compliance template; weights total 10000. | Product/Operations | Before compliance enablement |
| OPEN-CHN-007 | Royalty dual-approval and adjustment threshold. | 7,8,10 | Set exact KHR threshold and approver separation. | Finance/Owner | Before royalty enablement |
| OPEN-CHN-008 | Tax/VAT and statutory invoice requirements. | 8,14 | Keep tax zero/configurable until Cambodia legal/accounting policy is approved. | Finance/Legal | Before B2B invoice production |
| OPEN-CHN-009 | Map/geocoding provider and territory polygon rules. | 4,17 | Select provider and define accuracy/overlap tolerance. | Product/Architecture | Before territory module |
| OPEN-CHN-010 | AI inclusion/add-on pricing, model retention, cost limits. | 2,4,12 | Approve commercial and privacy policy. | Business/AI | Before AI production |
| OPEN-CHN-011 | Hardware sale/lease economics. | 2,16 | Approve commercial policy in Admin plan catalog. | Business Owner | Before paid deployment |
| OPEN-CHN-012 | Phone/mobile Chain experience. | 9,17 | Current rule remains responsive PWA; approve any native app separately. | Product | Phase 2 |

### C.3 Required Exact Values Before Production

- `[REQUIRED: production Supabase project ref]`
- `[REQUIRED: reviewed migration filenames and checksums]`
- `[REQUIRED: DigitalOcean project and Spaces bucket names]`
- `[REQUIRED: production/staging Chain Portal domains]`
- `[REQUIRED: final Chain Plan price, trial days, grace days]`
- `[REQUIRED: authentication, session, and MFA values]`
- `[REQUIRED: file retention and backup retention periods]`
- `[REQUIRED: royalty adjustment dual-approval threshold KHR]`
- `[REQUIRED: approved first Laundry compliance template]`
- `[REQUIRED: map provider if territories enabled]`
- `[REQUIRED: tax/VAT policy if B2B invoice issuance enabled]`
- `[REQUIRED: AI cost/retention policy if AI enabled]`

---

## Appendix D — Investor / Stakeholder Narrative

### D.1 Pitch Paragraph

KitLuy Chain Portal is the multi-store HQ layer for Cambodian Laundry brands that outgrow one-store POS tools. It gives a chain owner centralized control over Laundry services, branch performance, catalog pushes, brand standards, compliance, and franchise-ready reporting, while still letting each store react immediately to operational emergencies like machine failure or staff shortage. The product combines Cambodia-first localization, offline-aware store architecture, and practical chain management at SME pricing.

### D.2 Problem Statement

Laundry chains in Cambodia often operate with inconsistent pricing, inconsistent service names, paper-based branch reporting, and little visibility into why one branch performs better than another. Generic POS products may work for one counter, but they rarely provide chain-wide catalog control, brand standards, franchise royalties, compliance audits, or sync-aware multi-store reporting.

### D.3 Demo Script

1. Open Chain Overview and show total sales, active branches, stale branch warning, and top branch.
2. Open Branch Compare and compare BKK vs Toul Kork.
3. Open Catalog Control and show Wash & Fold / Dry Clean master services.
4. Push updated catalog to two stores.
5. Show warning that Branch B has Dry Clean emergency-paused because the machine is down.
6. Confirm the push updates price/version but preserves the pause.
7. Open Service Availability Matrix and show which branches can offer each service.
8. Open Partner/POS view and show the paused service hidden from new intake.
9. Re-enable service and show Chain/POS availability update.
10. Export branch sales report.

### D.4 Non-Critical Reconstruction Note

Appendix D is not required to rebuild the system. It exists to align stakeholders, sales, and onboarding teams.

---

## Final Checklist Before Finalizing

- [x] Rebuild Sequence can be followed linearly.
- [x] Product boundary vs Admin, Partner, and POS is explicit.
- [x] Third-party/future integrations are listed with current MVP dependency status.
- [x] Database target schema has full multi-store, catalog, franchise, royalty, compliance, and corrective-action tables; reviewed live SQL remains a pre-production gate.
- [x] Edge functions have routes, auth, body shapes, side effects, and idempotency behavior.
- [x] Store-level service enable/disable/emergency pause is included as canonical v2 behavior.
- [x] Catalog push preservation of emergency pauses is included.
- [x] QA scenarios include exact DB/UI pass conditions and validator SQL/API guidance.
- [x] SOPs include triggers, actors, steps, expected results, and fallbacks.
- [x] Monitoring and DR are specified with thresholds and restore sequences.
- [x] Appendix C contains open gaps and reconciliation items.
- [x] A stranger with this file, cloud accounts, and referenced migration files can rebuild the Chain Portal direction.

