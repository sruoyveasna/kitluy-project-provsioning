# KitLuy Suite — Master Rebuild Bible

| Field | Value |
|---|---|
| **Filename** | `kitluy-suite-rebuild-bible-v4.0.0.md` |
| **Version** | `v4.0.0` |
| **Date** | `2026-07-26` |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Status** | **OWNER-DIRECTED CANONICAL MASTER AUTHORITY — TARGET STATE, NOT IMPLEMENTATION EVIDENCE** |
| **Primary market** | Cambodia |
| **Active vertical** | Phase 1 — Laundry Stores and Shops |
| **Languages** | Khmer and English |
| **Currencies** | KHR and USD |
| **Timezone** | `Asia/Phnom_Penh` |
| **Primary cloud region** | Singapore / SGP1 unless an approved deployment record states otherwise |
| **Supersedes** | `kitluy-suite-rebuild-bible-v3.0.0.md` as the cross-suite rebuild authority |
| **Primary handoff audience** | Project owner, architecture, product, engineering, QA, security, DevOps, operations, KIMI Swarm, Claude Code, and other approved AI build agents |

> **Mission:** A qualified engineering team or approved AI coding swarm, starting with a blank repository and blank development environments, must be able to reconstruct the approved KitLuy Suite target without silently reviving superseded terminology, architecture, product boundaries, terminal roles, or competitor-derived assumptions.

> **Critical build rule:** This document is the first authority an implementation agent must read. It defines the Suite-wide model, boundaries, precedence, integration contract, build sequence, and conflict rules. Detailed product specifications and database contracts remain mandatory subordinate artifacts. No agent may treat this document alone as permission to guess missing DDL, production secrets, provider contracts, legal policies, or deployment values.

---

# 0. Canonical Authority, Evidence and Use Contract

## 0.1 Why v4.0.0 exists

The predecessor `kitluy-suite-rebuild-bible-v3.0.0.md` predates material owner decisions and approved Phase 1 specifications. It still contains an obsolete three-role Laundry model in which T2 performs scan-in and T3 performs scan-out. The current approved model is:

| Profile | Canonical name | Binding purpose |
|---|---|---|
| **T1** | **POS Cashier / Intake** | Customer intake, Booking creation, pricing, deposits/payments, receipt and tag printing |
| **T2** | **Customer Display Screen** | Customer-facing Booking mirror, totals, KHQR/payment state, receipt choice and pickup reference |
| **T3** | **Clean & Ready Scan-In** | Quality/count verification, packaging, Ready storage assignment and custody scan-in |
| **T4** | **Customer Pickup Scan-Out** | Collector verification, balance control, garment custody release and Booking completion |

v4.0.0 also consolidates the Digital Store-first model, the eight locked vertical phases, the current application inventory, the Storefront and public B2B website, the Supabase/DigitalOcean responsibility split, closed managed-device Store Hub security, Kubernetes-ready infrastructure, Admin v3.1 authorization, the July 24 owner-decision lock, Master Feature Registry v0.2, and the July 24–25 Phase 1 product specifications.

## 0.2 Exact source-authority order

When sources conflict, use this exact order:

1. **Current project-owner decisions and this active KitLuy Project Instruction.**
2. **Applied migrations, verified repository code and tests, deployment records, infrastructure state, and production evidence.**
3. **Current KitLuy Rebuild, Business, and approved product bibles/specifications.**
4. **Approved implementation handoffs.**
5. **Evidence-based competitor analyses and product classifications.**
6. **Competitor rebuild/clone documents as design references only.**
7. **Superseded planning.**

Interpretation rules:

- Level 1 defines approved product direction and guardrails.
- Level 2 proves what currently exists. It does not silently overrule an owner decision. A conflict between Levels 1 and 2 is a product/implementation defect that must be logged and resolved.
- Within Level 3, this v4.0.0 document controls Suite-wide architecture, terminology, hierarchy, product boundaries and cross-product integration.
- The latest approved product-specific specification controls detailed product behavior when it does not conflict with this document.
- Exact database objects, constraints and RLS policies require the approved Supabase schema, RLS/authorization and migration artifacts plus applied migration evidence.
- No lower source may promote a competitor feature, clone schema, route, threshold, pricing model or infrastructure choice into KitLuy truth.
- No conflict may be silently reconciled. Use Appendix C.

## 0.3 Status labels

| Label | Meaning |
|---|---|
| `OWNER-LOCKED` | Explicit owner decision. Binding until superseded by a later versioned owner decision. |
| `CANONICAL TARGET` | Approved target contract in this master authority or an approved subordinate specification. |
| `SPECIFIED` | Concrete design supplied to make the target buildable; still requires implementation evidence. |
| `PLANNING CANDIDATE` | Proposed work that has not passed the required authority/contract gate. |
| `DEFERRED` | Explicitly disabled until its re-entry conditions are approved and evidenced. |
| `REJECTED` | Prohibited pattern. Architecture, review and QA must prevent it. |
| `IMPLEMENTED` | Allowed only when verified repository code, applied migrations where applicable, executable tests, deployment evidence and required pilot/production evidence exist. |
| `[REQUIRED: ...]` | Missing owner, legal, provider, deployment, security or production value. It must not be guessed. |

## 0.4 Evidence discipline

- Documentation is not implementation evidence.
- A generated repository scaffold is not a completed product.
- A migration file is not an applied migration.
- A deployed function is not proven correct without contract and security tests.
- Demo, sample, estimated, cached, stale, planned, pilot or incomplete data must be labeled accurately.
- Finalized finance, payment, inventory, custody and audit records are append-only. Corrections use compensating entries or explicitly versioned state transitions.
- AI agents may write and review migrations but must never auto-apply production migrations.
- Sensitive financial, permission, compliance, release, infrastructure, device-identity or safety actions require authorized human confirmation under the applicable approval policy.

## 0.5 Conflict procedure

When an agent finds a conflict:

1. Stop work on the conflicting contract only; continue unrelated safe work.
2. Record the conflict in Appendix C or the repository conflict register.
3. Quote the newer and older source names and sections.
4. State the operational, schema, API, security, migration and documentation impact.
5. Apply the higher authority only where the resolution is explicit.
6. If the higher authority does not fully resolve implementation detail, mark `[REQUIRED: owner/architecture decision]`.
7. Do not create an undocumented compromise.

## 0.6 Rebuild Test

A phase passes the Rebuild Test only when one qualified engineer can reconstruct and operate it from:

- this master bible;
- the active product specifications;
- approved schema, data dictionary, API/event and RLS contracts;
- applied migration history and seeds;
- repository and build instructions;
- infrastructure-as-code and environment inventory;
- device manufacturing/provisioning instructions;
- QA, security, monitoring, backup/recovery, support and go-live evidence.

---

# Part 1 — Locked Platform Direction

## 1.1 KitLuy in one sentence

> **KitLuy Suite is a Cambodia-first Digital Store operating system that lets a Partner create digitally, operate physical Locations through offline-capable edge systems, and sell through governed channels while KitLuy remains the authoritative customer, transaction, payment, inventory, finance, audit and reporting platform.**

## 1.2 Canonical operating sequence

```text
Partner Account / Tenant
        ↓
Create Digital Store
        ↓
Select exactly one primary vertical
        ↓
Configure catalog, pricing, staff, payments, rules and channels
        ↓
Operate online-only if desired
        ↓ optional
Create Store Location
        ↓
Provision HET-enrolled Store Hub
        ↓
Assign and provision terminals/devices
        ↓
Operate locally through Store Hub
        ↓ asynchronous
Synchronize authoritative events to KitLuy cloud
```

## 1.3 Core direction locks

The following are binding:

1. KitLuy starts with one vertical, completes it commercially, then expands vertically.
2. Shared capabilities belong in KitLuy Core and are reused; vertical modules add only terminology, schema delta, workflows, interfaces, reports, hardware profile, defaults and rules.
3. One Digital Store belongs to exactly one primary vertical.
4. A Partner operating different business types creates separate Digital Stores under the same Tenant/Partner Account.
5. The Digital Store is the cloud control plane.
6. A physical Store Location is optional and is an offline-capable edge execution environment.
7. Store Hub is the local operational authority after provisioning.
8. T1–T4 communicate with Store Hub over the Store LAN for normal physical-store operation.
9. Public internet failure must not stop approved local Store operations after provisioning.
10. Configuration flows from KitLuy cloud to Locations and channels; transactions and events return to KitLuy.
11. External channels never own customer, inventory, payment, finance or operational truth.
12. Relational tables hold authoritative data. JSON is limited to optional metadata, provider payload retention and versioned extension envelopes.
13. APIs and events are versioned, idempotent, scoped, auditable and retry-safe.
14. Tenant, Digital Store, Store Location, user, role, service and device isolation are mandatory.
15. Connectors never receive direct production-database access.
16. Khmer, English, KHR, USD, Asia/Phnom_Penh and KHQR are first-class requirements.
17. Migrations are additive and backward-compatible by default, supported by feature flags, entitlements and expand/contract rollout.
18. No capability is called implemented without evidence.

## 1.4 What KitLuy is not

KitLuy is not:

- a Laundry-only codebase;
- a physical-POS-first product with an optional web portal;
- a second-hand clone of WooCommerce, Shopify, Toast, Lightspeed or Loyverse;
- a statutory ERP/general ledger in Phase 1;
- a payment facilitator or merchant of record;
- a system that permits unverified offline card capture;
- a cloud-only POS that fails when the public internet is unavailable;
- an open extension marketplace in Phase 1;
- a platform where frontend page visibility is treated as authorization;
- a platform where devices trust an IP address, MAC address or copied image as sufficient identity;
- a platform where AI can perform sensitive mutations without human confirmation.

---

# Part 2 — Eight Locked Vertical Phases

## 2.1 Roadmap lock

The vertical order is locked. A change requires a versioned owner decision.

| Phase | Vertical | Required vertical delta and commercial outcome |
|---:|---|---|
| **1** | **Laundry Stores and Shops** | Services; per-piece/per-weight pricing; Booking intake; garments; deposits; KHQR; receipts/tags; pickup/delivery; production; issues/rewash/damage; consumables; capacity; offline operation; reporting; T1–T4. |
| **2** | **Café and Restaurant Stores** | Menus/modifiers; dine-in/takeaway/delivery; floor plans; tables; checks/tabs; course firing; KDS; prep stations; kitchen printing; split/merge; tips; service charges; recipes; waste; shifts; drawers; business-day close; online ordering; QR order-and-pay. |
| **3** | **Online Retailers and eCommerce Businesses** | Storefronts; domains; products/variants; carts; checkout; accounts; fulfilment; taxes; coupons; reviews; reservations; payments; tracking; notifications; SEO; recovery; subscriptions; connectors; Management, Commerce Store and Connector APIs. |
| **4** | **Convenience Stores** | Barcode checkout; large catalogs; weighted goods; purchasing; inventory; expiry; shifts; cash; labels; loyalty; multi-tender. |
| **5** | **Drugstores and Pharmacies** | Medicine data; batch/lot; expiry; FEFO; controlled items; prescription indicators; pharmacist permissions; recalls; quarantine; restricted returns; privacy; approvals; compliance. KitLuy must not diagnose or replace pharmacist judgment. |
| **6** | **Department Stores** | Departments; catalogs; price books; promotions; purchasing; distribution; transfers; returns/exchanges; gift cards; store credit; loyalty; commissions; reporting. |
| **7** | **Grocery Stores** | Produce; weighted goods; embedded barcodes; scales; batch/expiry; FEFO; spoilage/waste; purchasing; labels; fresh production; counts; margin/wastage reporting. |
| **8** | **Supermarkets** | High-volume registers; central catalog; warehouse/store inventory; replenishment; distribution; promotions; member pricing; batch/expiry; self-checkout; cash office; regional reporting; high-availability Store Hub; enterprise approvals. |

## 2.2 Vertical completion rule

A phase is complete only when it has approved and evidenced:

- scope and exclusions;
- terminology and schema delta;
- workflows and state machines;
- APIs, events and idempotency rules;
- permissions, approvals and audit;
- interfaces and accessibility/localization;
- Store Hub/offline behavior;
- hardware profiles and certification;
- payment, finance, inventory and tax rules;
- reports and data freshness;
- integrations and connector boundaries;
- migrations, seeds and rollback;
- automated QA, security, load and recovery tests;
- observability and support runbooks;
- pilot evidence and go-live checklist;
- updated Rebuild and Business Bibles.

## 2.3 Scope-control rule

Build shared capability only to the level required by the active vertical and confirmed near-term reuse. Record future needs without speculative implementation. No later vertical may destabilize or rewrite earlier verticals.

---

# Part 3 — Canonical Entity and Authority Model

## 3.1 Entity hierarchy

```text
HET Platform
  └── Tenant / Partner Account
       ├── memberships, billing relationship and organization policy
       └── Digital Store [1..n]
            ├── exactly one primary vertical
            ├── catalog, pricing, customers, staff policy and channels
            ├── Store Location [0..n]
            │    ├── address and local availability
            │    ├── Store Hub [0..1 active authority]
            │    ├── terminals/devices/peripherals
            │    ├── local inventory/capacity projection
            │    └── local operational events
            └── Digital Channels [0..n]
                 ├── KitLuy Storefront
                 ├── Telegram channel
                 ├── marketplace/delivery/social connectors
                 └── approved APIs
```

## 3.2 Terminology rules

| Term | Canonical meaning |
|---|---|
| **Tenant** | Backend organization and data-isolation boundary. |
| **Partner Account** | Business-facing account operated by a merchant/business. |
| **Digital Store** | The authoritative business/store control plane with one primary vertical. It can exist without a physical Location. |
| **Store Location** | A physical operating site attached to one Digital Store. |
| **Store Hub** | HET-managed local edge appliance and operational authority for one Location. |
| **Channel** | Governed digital sales or integration surface. Never the source of truth. |
| **Booking** | Phase 1 Laundry business-facing transaction term. Dense back-office reports may use Laundry Order where the product specification explicitly permits it. |
| **Transaction** | Neutral Core aggregate covering a vertical-specific Booking, order, check, sale or other commercial document. |

The unqualified word `Store` is allowed only in human-facing prose where context is obvious. Schema, API and event contracts must use `digital_store` or `store_location` explicitly.

## 3.3 Cardinality and isolation invariants

- A Tenant may own multiple Digital Stores.
- A Digital Store has exactly one primary vertical at a time.
- A Store Location belongs to exactly one Digital Store.
- A Store Hub is assigned to exactly one active Location at a time.
- A terminal is assigned to one Location and one approved device profile at a time.
- A user may have multiple scoped memberships, but every effective action is evaluated against Tenant, Digital Store, Location, permission, environment and device context.
- Cross-Tenant joins, exports, support access and AI retrieval require explicit platform permission and audit.
- Chain governance is an authorized relationship across participating Digital Stores/Locations; it is not a second operational source of truth.

## 3.4 Configuration and event direction

```text
Cloud authority
  → Digital Store configuration versions
  → Store Location projection
  → Hub activation package
  → terminal/device configuration

Local authority
  → operational transactions and custody events
  → append-only outbox
  → cloud acknowledgement and reconciliation
  → authoritative reporting/read models
```

## 3.5 External-channel authority

Every connector must use approved projections and ingress contracts. It may not:

- write directly to production tables;
- invent an authoritative customer identity;
- overwrite inventory quantities through generic last-write-wins;
- mark payment confirmed without verified provider evidence;
- rewrite finalized finance entries;
- bypass KitLuy pricing/availability revalidation;
- retain broader data than its approved scope and retention policy.

---

# Part 4 — Updated Product and Application Inventory

## 4.1 Canonical user-facing application inventory

| # | Canonical application | Phase | Primary audience and boundary |
|---:|---|---:|---|
| 1 | `kitluy-b2b-website` | 1 | Public business acquisition, product discovery, registration, authentication and portal entry. Not an operational portal. |
| 2 | `kitluy-admin-pwa-portal` | 1 | HET-internal privileged control plane for governance, onboarding, fleet, releases, infrastructure, support, billing, integrations, AI and audit. |
| 3 | `kitluy-chain-pwa-portal` | 1 | Chain, brand, franchise and multi-store governance. Not a POS or second operational ledger. |
| 4 | `kitluy-partner-pwa-portal` | 1 | Deep Digital Store/Location back office for configuration, data tables, reconciliation, reports and Integration Hub. |
| 5 | `kitluy-partner-app` | 1 | Owner/manager mobile operations cockpit. Not the back office and not staff POS. |
| 6 | `kitluy-pos-desktop-app` | 1 | Electron/Linux ARM64 operational client implementing T1–T4 profiles through Store Hub. |
| 7 | `kitluy-pos-mobile-app` | 1 | Secure scan-first roaming staff app extending, not replacing, T1–T4. |
| 8 | `kitluy-storefront` | 1 and 3 | Phase 1 Laundry QR pre-intake/queue and Telegram access; Phase 3 full customer commerce storefront. |
| 9 | `kitluy-restaurant-kds-client` | 2 | Kitchen/prep display. It is not Laundry T2. |
| 10 | `kitluy-restaurant-guest-display-order-pay` | 2 | Restaurant guest display and QR order-and-pay. It is not Laundry T2. |
| 11 | `kitluy-kiosk-self-checkout-client` | Optional/later | Entitled kiosk or self-checkout profile for approved verticals. Not a Phase 1 Laundry requirement. |

Aliases retained only for compatibility:

- `kitluy-admin-portal` → `kitluy-admin-pwa-portal`
- `kitluy-chain-portal` → `kitluy-chain-pwa-portal`
- `kitluy-partner-portal` → `kitluy-partner-pwa-portal`
- `Seller` naming is retired; use `Partner`.

## 4.2 Non-user-facing platform products and services

| Capability | Boundary |
|---|---|
| KitLuy Core | Neutral Tenant, Digital Store, Location, identity, permissions, catalog, pricing, customers, transactions, payments, inventory, purchasing, finance, reporting, audit, jobs and event contracts. |
| Store Hub / `kitluy-hub-agent` | Local Location authority, operational database, edge API, sync, files, printing, devices and release distribution. |
| Management API | Authenticated business/platform management surface. |
| Commerce Store API | Customer commerce/session/cart/checkout surface, introduced to required depth by phase. |
| Edge Operations API | Store Hub, terminals and approved local clients. |
| Connector API | Governed connector ingress/egress and certification boundary. |
| Integration Hub | Partner-controlled connections, mappings, credentials metadata, health, reconciliation and revocation. |
| File Service | DigitalOcean Spaces bytes with KitLuy metadata, permission, audit and signed access. |
| Notification Service | Templates, consent, provider abstraction, delivery truth, retry and suppression. |
| KitLuy AI Gateway / MCP / RAG | Permission-scoped AI, retrieval and tool execution with audit and human confirmation. |
| Infrastructure & Platform Operations | Admin Portal workspace controlling cloud/edge infrastructure under Admin v3.1 authorization. |

## 4.3 Public B2B website boundary

`kitluy-b2b-website` is the public front door for businesses buying KitLuy. It owns:

- product/vertical explanation;
- trust, content and lead capture;
- request-demo and registration entry;
- account-type selection;
- shared authentication entry;
- initial business/identity information;
- routing to Partner or Chain Portal.

It does not own Digital Store operational configuration, transactions, finance, Store Hub provisioning, fleet actions or customer commerce.

## 4.4 Storefront boundary

`kitluy-storefront` is for customers buying from a KitLuy Partner.

Phase 1 Laundry includes:

- Store/Location QR entry;
- responsive web experience;
- Telegram Bot/Mini App as an alternative KitLuy-controlled channel;
- phone verification;
- Pre-Intake Draft;
- intended services and estimated garments/pieces/bags/weight;
- stain/damage/add-on notes;
- virtual queue ticket;
- T1 verification and conversion to an authoritative Laundry Booking.

The Pre-Intake Draft and Queue Ticket are not finalized Bookings, prices, weights, garment counts or payment records. T1 must verify the customer and physical items.

Phase 3 expands Storefront into full eCommerce under the approved Phase 3 contracts. Phase 1 implementation must not prematurely introduce unapproved full-commerce complexity.

---

# Part 5 — Phase 1 Laundry Operating Model

## 5.1 Canonical T1–T4 architecture

```text
Customer / Storefront Pre-Intake
            ↓
T1 POS Cashier / Intake
            ⇄ T2 Customer Display Screen
            ↓
Laundry Production
Wash → Dry → Press → QA
            ↓
T3 Clean & Ready Scan-In
            ↓
Ready Storage
            ↓
T4 Customer Pickup Scan-Out
            ↓
Booking Completed
```

## 5.2 T1 — POS Cashier / Intake

T1 owns the authorized intake flow:

- identify/create customer;
- retrieve Storefront Pre-Intake/Queue Ticket when present;
- verify phone, physical garments, count, weight, service, price and instructions;
- create authoritative Laundry Booking;
- take approved deposit/payment;
- generate receipt and garment tags;
- record photos/evidence when required;
- communicate the customer-facing view to T2;
- operate through Store Hub when the internet is unavailable.

## 5.3 T2 — Customer Display Screen

T2 is customer-facing and paired with the active T1 session. It may show only the approved customer-safe projection, including:

- Store identity;
- selected services/items;
- quantities/weight;
- discounts, taxes/fees where applicable and totals;
- deposit/balance;
- KHQR and verified payment state;
- receipt choice and pickup reference;
- privacy-safe confirmation prompts where specified.

T2 is not:

- a KDS;
- a Laundry production display;
- a Clean & Ready scan-in terminal;
- a Pickup scan-out terminal;
- an independent source of price or payment truth.

## 5.4 T3 — Clean & Ready Scan-In

T3 owns the Ready custody entry:

- scan Booking/garment/tag;
- verify garment count and completion state;
- record QA outcome and exceptions;
- confirm packaging;
- assign Ready storage location;
- append Ready custody event;
- make the Booking eligible for pickup when all rules pass;
- trigger approved notification event.

T3 never releases garments to a customer.

## 5.5 T4 — Customer Pickup Scan-Out

T4 owns final custody release:

- identify customer or authorized collector;
- locate the authoritative Booking and Ready storage assignment;
- verify items/garments retrieved;
- enforce unresolved issue and balance rules;
- collect an approved remaining balance when the profile and permissions allow, or coordinate the authorized payment step;
- append scan-out/custody release events;
- complete pickup and the Booking.

T4 is the only terminal profile authorized to perform the final customer pickup scan-out. T3 and T4 may share one physical device in a small Store, but they remain separate modes, permissions, sessions, state machines and audit events.

## 5.6 Chain of custody

Every garment or package custody transition records at minimum:

- Tenant, Digital Store and Location;
- Booking and garment/package identity;
- event type and state transition;
- actor and device identity;
- profile/mode;
- timestamp and business date;
- correlation and idempotency keys;
- previous and resulting custody state;
- reason/evidence for exceptions.

Custody history is append-only.

## 5.7 Production and issue handling

Phase 1 must support the approved Laundry production states and exceptions, including wash, dry, press, QA, issue, rewash, damage and exception evidence. Exact state-machine names and transitions belong in the approved Laundry schema/API specifications. A production display, if later approved, is a separate surface and cannot reuse the T2 identity.

## 5.8 Booking truth and terminology

- Partner App uses `Booking` / `Laundry Booking` and displays `Pressing` where a legacy backend may use `ironing`.
- Partner Portal may use `Laundry Order` in dense tables/reports only where explicitly specified.
- APIs may use neutral transaction/order compatibility fields, but adapters must preserve the business-facing terminology of each surface.
- Final price, weight, garment count and services are created at T1 after verification, not accepted directly from customer pre-intake.

---

# Part 6 — Store Hub and Managed-Device Security

## 6.1 Local authority

Store Hub is a managed edge appliance deployed at a Store Location. After provisioning it owns the local operational runtime for:

- approved local transaction writes;
- T1–T4 orchestration;
- local PostgreSQL and append-only outbox/inbox;
- local files and upload queue;
- printing and peripherals;
- terminal/device trust;
- configuration activation and rollback;
- local health and diagnostics;
- asynchronous cloud synchronization.

Normal Store operations must not depend on terminals writing directly to Supabase.

## 6.2 Closed HET enrollment

Only HET-enrolled hardware may become an active Store Hub. A copied KitLuy OS or NVMe image on unknown hardware must fail closed.

Canonical trust equation:

```text
Approved hardware identity
+ approved installation identity
+ valid manufacturing certificate
+ valid cryptographic key proof
+ approved software/security posture
+ active provisioning assignment
= eligible operational Store Hub
```

## 6.3 Composite identity

Required identity classes include:

| Identifier | Role | Mismatch treatment |
|---|---|---|
| Raspberry Pi factory DUID | Root hardware evidence | Hard reject |
| Raspberry Pi board serial | Root hardware evidence | Hard reject |
| Secure-element/TPM identity | Root cryptographic evidence | Hard reject |
| Non-exportable device key | Cryptographic proof | Hard reject |
| Manufacturing certificate | Factory trust | Hard reject |
| NVMe serial/model/capacity | Installation identity | Quarantine; HET maintenance required |
| Approved image/release digest | Software identity | Reject or recovery path |
| Factory MAC addresses | Supporting mandatory evidence | Quarantine on unexplained mismatch |
| Hub UUID | Platform device identity | Reject duplicate/reuse |
| IP address | Reachability only | Never trusted as identity |

A MAC address, part number or IP address alone is never sufficient security identity.

## 6.4 Certificates and key separation

- Private keys are generated in an approved non-exportable key store.
- Manufacturing and operational certificates are separate.
- The manufacturing certificate proves HET enrollment.
- The operational certificate binds the approved Hub to Tenant, Digital Store, Location, environment and lifecycle state.
- Revocation must take effect at cloud gateways and local terminal trust checks.
- Certificate issuance, renewal, rotation, quarantine removal and revocation are audited sensitive actions.

## 6.5 Smartphone-simple provisioning

Canonical order:

```text
1. Create and configure Digital Store
2. Create optional Store Location
3. Select HET-enrolled Hub
4. Power on pre-installed Hub
5. Choose language and connect internet
6. Enter/scan short-lived provisioning code
7. Verify hardware, certificate, image and security posture
8. Confirm Tenant, Digital Store and Location
9. Issue operational certificate and assignment manifest
10. Synchronize Store configuration and required operational data
11. Validate services, storage and peripherals
12. Activate Hub
13. Assign terminals in Partner/Admin controls
14. Provision terminals through the active Hub
15. Run test Booking, T2, T3, T4, offline and sync validation
16. Approve Location go-live
```

The provisioning code selects an assignment; it cannot bypass hardware identity, certificate or security posture checks.

## 6.6 Terminal connection priority

A terminal stores the assigned Hub UUID, certificate fingerprint, hostname and last successful IP. Connection order is:

1. validated cached Hub endpoint;
2. secure LAN discovery matching the assigned Hub identity;
3. assigned hostname;
4. assigned private IP;
5. manual IP as a controlled fallback only.

The endpoint is accepted only when the Hub certificate and assignment match.

## 6.7 Recovery and replacement

- Store staff do not replace or reimage Hub NVMe storage.
- A failed Hub is normally replaced with a pre-enrolled HET device.
- HET may service an original board and register a replacement NVMe through the approved maintenance process.
- Board or secure-element replacement creates a new device identity, keys and certificates.
- Cloned NVMe, duplicate certificate, identity mismatch or unknown hardware is a security incident and quarantine condition.
- Recovery must validate local/cloud reconciliation before Store reopening.

## 6.8 Release security

- Releases are immutable and signed.
- Store Hub downloads each approved release once and distributes it to terminals.
- Channels are `Internal → Pilot → Stable`.
- Health checks and compatibility ranges gate activation.
- Store Hub and terminals use A/B deployment with rollback.
- Emergency revocation or rollback requires the approved Admin authorization policy and immutable audit.

---

# Part 7 — Cloud, Edge and Infrastructure Responsibility Split

## 7.1 Supabase responsibilities

Supabase is the authoritative cloud data and identity platform for:

- Auth and supported identity flows;
- PostgreSQL;
- Row-Level Security;
- Realtime where appropriate;
- relational KitLuy Core and vertical schemas;
- metadata, ownership and permission records;
- audit and event truth;
- applied migration history;
- approved short-lived Edge Functions;
- vector metadata/pgvector where approved.

Supabase Storage is not the primary heavy-file layer.

## 7.2 DigitalOcean responsibilities

DigitalOcean owns:

- web/PWA and API application hosting;
- stateless services and workers;
- container registry and immutable images;
- DigitalOcean Spaces for long-term object bytes;
- CDN for approved public/static assets;
- AI inference integration, MCP services and RAG workers;
- release repository/distribution services;
- monitoring/worker infrastructure as approved;
- App Platform at Phase 1 launch;
- DOKS when migration triggers are met.

## 7.3 Store edge responsibilities

Store Hub owns the Location-scoped local operational runtime. Terminals and POS Mobile use the Edge Operations API and do not treat public-cloud availability as a prerequisite for local operation.

## 7.4 File authority

```text
DigitalOcean Spaces = long-term object bytes
Supabase = metadata, ownership, permissions and audit
Store Hub = local operational repository and upload queue
Clients = temporary authorized cache
```

Clients never receive long-lived object-storage credentials.

## 7.5 Kubernetes-ready, not Kubernetes-first

The locked direction is:

> **Build KitLuy Kubernetes-ready from day one, but do not operate Kubernetes from day one.**

Phase 1 uses DigitalOcean App Platform for appropriate stateless web/API/worker workloads. Every service intended for future orchestration must:

- build as an immutable container;
- expose health/readiness endpoints;
- externalize configuration and secrets;
- avoid local persistent state;
- support graceful shutdown and connection draining;
- declare resource requirements and dependencies;
- use stable API/event contracts;
- be horizontally scalable where appropriate;
- emit structured logs, metrics and traces;
- run unchanged or with deployment-only adaptation on DOKS.

## 7.6 DOKS migration triggers

DOKS is activated only after an approved operational/economic review and evidence such as:

- sustained service count or independent scaling complexity;
- App Platform limits or cost inefficiency;
- need for workload-specific node pools;
- stable SRE/DevOps ownership and on-call capacity;
- validated staging deployment of existing images;
- load, failure, rollback and security tests;
- documented cost comparison and exit plan.

Do not move Supabase authoritative PostgreSQL into Kubernetes for uniformity.

## 7.7 Cache and queue rule

Managed Valkey may accelerate reads, rate limits, locks, short-lived sessions and coordination. It must never be the only truth for payments, finance, inventory, custody, audit, provisioning, releases or durable jobs. Durable job/event state is relational and replayable.

## 7.8 Cloud/edge security boundaries

- No public inbound Store Hub administration.
- Hub cloud connections use mutual device trust and outbound-initiated channels.
- Service identities are distinct from humans.
- Service-role credentials are server-only and tightly scoped.
- AI services never receive unrestricted production-database access.
- Rate limits differ by anonymous, user, Hub/device, internal service, webhook, bulk/export and AI route classes.

---

# Part 8 — Admin v3.1 Authorization and Approval Model

## 8.1 HET-only control plane

`kitluy-admin-pwa-portal` is never exposed as a Partner, Chain, Store staff or customer application. It controls highly sensitive platform functions and requires least privilege from Phase 1.

## 8.2 Authorization model

Authorization is not `user → role → page`. It is:

```text
Authenticated identity
  + active team membership
  + role assignment/template version
  + explicit permission grant
  + resource scope
  + environment scope
  + assignment validity/review state
  + separation-of-duties policy
  + re-authentication freshness
  + reason/evidence requirement
  + approval state
  + session/device security context
  + API enforcement
  + Supabase RLS
= effective authorization decision
```

Frontend controls are convenience only. API policy and RLS are authoritative.

## 8.3 Teams

Required organizational teams include:

- Platform Operations;
- Infrastructure and DevOps;
- Security Operations;
- Fleet and Hardware Operations;
- Partner Onboarding;
- Support Operations;
- Finance and Billing;
- Integration Operations;
- AI Operations;
- Audit and Compliance;
- Product Operations;
- Executive Oversight.

Team membership never grants authority by itself.

## 8.4 Role templates

Phase 1 templates include, at minimum:

`platform_owner`, `platform_governance_admin`, `partner_verification_operator`, `onboarding_operator`, `go_live_approver`, `finance_operator`, `finance_approver`, `fleet_operator`, `hardware_lifecycle_operator`, `release_operator`, `release_approver`, `platform_ops_operator`, `infrastructure_operator`, `security_operator`, `support_operator`, `support_lead`, `integration_operator`, `ai_operator`, `audit_reviewer`, `ops_readonly`, and `executive_readonly`.

Templates are versioned bundles. Backend logic evaluates grants and policy, not role-name conditionals.

## 8.5 Scope model

Supported scope classes include:

`platform`, `region`, `tenant_or_partner`, `digital_store`, `store_location`, `device_group`, `individual_device`, `connector`, and `service`.

Scope inheritance is explicit. A Location grant cannot expand to sibling Locations or the Tenant. Arbitrary client-supplied authorization filters are prohibited.

## 8.6 Environment model

`development`, `staging`, `pilot`, `production`, and `disaster_recovery` grants are independent. No non-production assignment implies production access.

## 8.7 Approval classes

| Class | Treatment |
|---|---|
| `A0_READ` | Authentication and scope enforcement. |
| `A1_STANDARD_MUTATION` | Permission, required reason and immutable audit. |
| `A2_REAUTH_MUTATION` | Fresh re-authentication plus A1 controls. |
| `A3_FOUR_EYES` | Independent approver plus A2 controls. |
| `A4_OWNER_SECURITY` | Restricted approver pool, MFA, incident/ticket reference, alerting and retrospective review. |

## 8.8 Four-eyes actions

The following normally require two different authorized humans:

- production migration execution or rollback;
- Stable release promotion, broad rollout, broad pause or rollback;
- platform-wide/cross-Tenant safety switches;
- Partner or Digital Store suspension/closure;
- Store Location go-live approval where the requester prepared evidence;
- device wipe, identity replacement, certificate-authority change or quarantine override;
- payment connector production activation;
- high-risk billing adjustment or manual settlement;
- cross-Tenant support access/impersonation;
- write-capable AI/MCP activation;
- bulk permission or owner-level assignment changes;
- break-glass activation.

The requester cannot approve their own request. Approval is payload- and scope-bound, short-lived and single-use.

## 8.9 Temporary and break-glass access

Temporary elevation records exact permission, resource, environment, reason, ticket/incident, requester, approver, start, expiry and revocation. Standing broad support or emergency access is prohibited. Break-glass use triggers immediate alerting and mandatory retrospective review.

## 8.10 Audit minimum

Sensitive audit events record:

- actor and authenticated session;
- team, assignment and permission;
- resource and environment;
- request/payload hash;
- reason and evidence references;
- approval request and approver;
- policy version and authorization decision;
- correlation/idempotency keys;
- before/after or compensating reference;
- outcome and error classification;
- timestamp and source IP/device context where appropriate.

---

# Part 9 — Shared Core, Data and Finance Rules

## 9.1 Shared Core domains

KitLuy Core provides neutral contracts for:

- Tenant and Partner Account;
- Digital Store and Store Location;
- identity, memberships, roles, permissions and approvals;
- device registry, certificates and lifecycle;
- catalog, services/products, variants/options and availability;
- pricing, discounts, taxes/fees and snapshots;
- customers, identifiers, consent and privacy;
- transactions and lines;
- payments, refunds, liabilities and reconciliation;
- inventory, capacity, purchasing and movement ledgers;
- fulfilment and custody;
- operational finance subledger;
- files, notifications, jobs, events and webhooks;
- reporting/read models and freshness;
- integrations and channel projections;
- AI policy, retrieval and tool audit.

A vertical module must not duplicate these domains under Laundry-specific names.

## 9.2 Relational authority

Authoritative business state uses typed relational tables, constraints and ledgers. JSON may be used only for:

- optional metadata that is not queried as core truth;
- versioned provider payloads;
- extension settings with an approved schema;
- immutable event payload snapshots;
- localized content where the approved model requires it.

## 9.3 Append-only rules

Finalized records in these domains are never destructively rewritten:

- payment and refund evidence;
- operational finance subledger;
- inventory/consumable movement;
- garment/package custody;
- audit/security events;
- applied migration and release evidence.

Corrections use reversals, compensating entries, linked adjustments or explicitly versioned state transitions.

## 9.4 Money and currency

- Every monetary amount has a currency code.
- KHR and USD are first-class.
- Exact storage type and rounding policy are defined in the approved Supabase schema/money contract and used consistently across products.
- A transaction stores price, discount, tax/fee and exchange-rate snapshots required for historical reconstruction.
- Floating-point money is prohibited.
- Exchange-rate changes do not mutate finalized historical documents.

## 9.5 Operational finance boundary

KitLuy owns the authoritative operational finance subledger, liabilities, reconciliation and accountant-ready exports/connectors. It is not initially a complete statutory ERP/general ledger. Statutory accounting and revenue-recognition mappings require qualified human approval.

## 9.6 Inventory and capacity truth

- Inventory and consumable quantities are derived from movement ledgers and controlled reconciliation, not generic last-write-wins quantity replacement.
- Laundry service capacity may be modeled separately from stock but follows the same authority, audit and freshness principles.
- Cloud channels must revalidate availability against the approved source and display stale/conservative status when authoritative freshness is unavailable.

## 9.7 Read-model truth labels

Every non-authoritative read model that may lag exposes:

- `source`;
- `data_as_of`;
- sync/freshness status;
- reconciliation status where applicable;
- degraded or partial state;
- whether actions are permitted from that view.

No stale dashboard number may be presented as live truth.

---

# Part 10 — APIs, Events, Jobs and Integration Contracts

## 10.1 Four governed API surfaces

| API | Primary consumers | Boundary |
|---|---|---|
| **Management API** | Admin, Chain, Partner back office, approved private integrations | Business/platform management and controlled mutations. |
| **Commerce Store API** | Storefronts, customer commerce and approved headless surfaces | Session, catalog projection, cart/checkout/account and customer-commerce contracts by phase. |
| **Edge Operations API** | Store Hub, POS Desktop, POS Mobile and approved local devices | Location-scoped offline-first operational contracts. |
| **Connector API** | Marketplaces, delivery/social channels and certified external systems | Governed projection, ingress, mapping, webhook and reconciliation contracts. |

Do not collapse these surfaces for convenience.

## 10.2 API requirements

Every mutation contract defines:

- version and compatibility policy;
- authenticated principal and required permission;
- Tenant/Digital Store/Location scope;
- request and response schema;
- idempotency key and replay behavior;
- optimistic/concurrency rules where applicable;
- audit event;
- error codes and retry guidance;
- event/job side effects;
- offline behavior;
- rate-limit class;
- deprecation path.

## 10.3 Event requirements

Domain events are immutable, versioned and retry-safe. Minimum envelope:

- event ID and schema version;
- aggregate type and ID;
- Tenant, Digital Store and Location;
- actor/service/device identity;
- source application/profile;
- correlation and causation IDs;
- idempotency key;
- business date and event time;
- payload classification;
- previous event/version reference where needed.

## 10.4 Durable jobs

Authoritative job state is relational and includes status, attempt count, next-attempt time, lease, error class, result reference and dead-letter reason. Consumers assume at-least-once delivery and are idempotent.

## 10.5 Webhooks and connectors

- Verify signature and timestamp.
- Validate schema before use.
- Persist receipt and provider event identity where required.
- Deduplicate and process asynchronously.
- Record retry/dead-letter history.
- Rotate credentials through controlled workflows.
- Reconcile external status to KitLuy truth; never overwrite truth blindly.

## 10.6 AI/MCP boundary

AI and MCP tools are permission-scoped, source-aware, logged and provider-agnostic. They may propose or prepare sensitive actions but execution requires the same authorization, approval, idempotency and audit as a human action. Retrieval must obey Tenant, Store, role and document permissions.

---

# Part 11 — Current Owner Decision Locks

## 11.1 Architecture and product locks

| v4 register ID | Decision | Effective/source status | Binding result |
|---|---|---|---|
| `KLV4-DEC-001` | Eight-phase vertical roadmap | Current Project Instruction | Phases 1–8 are ordered as defined in Part 2. |
| `KLV4-DEC-002` | One Digital Store / one primary vertical | Current Project Instruction | Different business types require separate Digital Stores under the same Tenant. |
| `KLV4-DEC-003` | Digital Store-first hybrid model | Owner direction, July 2026 | Digital Store precedes optional physical Location provisioning. |
| `KLV4-DEC-004` | Extended WooCommerce adoption | OWNER-LOCKED, effective 2026-07-21 | Dedicated relational transactions, four APIs, events/jobs, safe deployments, governed extensions and channel projections become KitLuy baseline. |
| `KLV4-DEC-005` | Laundry T1–T4 architecture | OWNER-LOCKED, effective 2026-07-21 | T1 Cashier/Intake; T2 CDS; T3 Ready Scan-In; T4 Pickup Scan-Out. |
| `KLV4-DEC-006` | Smartphone-simple provisioning | OWNER-LOCKED, effective 2026-07-21 | Digital Store → active Hub → assigned terminals; discovery plus validated fallback. |
| `KLV4-DEC-007` | Closed HET managed-device Store Hub | OWNER-LOCKED target in Store Hub v1.0.0 | Composite identity, certificates, quarantine, HET-only repair and replacement-first recovery. |
| `KLV4-DEC-008` | Kubernetes-ready, not Kubernetes-first | OWNER-LOCKED target in infrastructure v1.0.0 | App Platform first; DOKS only on evidence-based triggers. |
| `KLV4-DEC-009` | Admin v3.1 authorization | Approved target, 2026-07-25 | Explicit permissions, resource/environment scope, re-authentication, four-eyes approval, API/RLS enforcement. |
| `KLV4-DEC-010` | B2B website canonical product | Approved Phase 1 target, 2026-07-25 | Public acquisition/registration/authentication front door. |
| `KLV4-DEC-011` | Storefront QR/Telegram pre-intake and queue | OWNER-APPROVED target, 2026-07-25 | Customer prepares intake; T1 verifies and creates authoritative Booking. |
| `KLV4-DEC-012` | Cambodia-first stack and localization | Current Project Instruction | React/PWA, React Native/Expo, Electron ARM64, Supabase, DigitalOcean, Pi 5, Khmer/English, KHR/USD, KHQR. |

## 11.2 Owner Decision Lock KLD-2026-07-24-001

The following twelve Master Feature Registry decisions are binding:

| Master feature | Choice | Binding decision | Phase treatment |
|---|---:|---|---|
| `KLMF-CUS-002` | B | Layered moderation: Partner for its Digital Store, Chain for participating Store standards, HET only for platform safety/fraud/legal/privacy/abuse/policy. Reason, appeal, override and audit required. | Phase 3 |
| `KLMF-FIN-005` | B | KitLuy owns operational finance subledger, liabilities, reconciliation and accountant-ready exports/connectors; not initially a statutory ERP/GL. | Phase 1 foundation onward |
| `KLMF-INT-001` | B | Essential first-party, Edge, Partner-data, export and basic connector API access is included; advanced capacity/environments/connectors/support/SLA may be commercial. Store operations are never commercially throttled. | Phase 3 onward |
| `KLMF-INT-002` | B | Build governed first-party/private extension and theme foundations in Phase 3; defer open public marketplace and revenue share until post-Phase 3 stability. | Phase 3 foundation; later marketplace |
| `KLMF-PAY-004` | B | Card surcharges disabled by default and for initial Cambodia launch; later only with approved country/provider policy. | Disabled initially |
| `KLMF-PAY-005` | B | Provider-independent card-present/contactless architecture is optional Phase 2/2.5, not a launch dependency. | Optional Phase 2/2.5 |
| `KLMF-PAY-011` | B | Incremental card preauthorization deferred to Phase 2.5 and eligible certified hospitality Stores. | Deferred |
| `KLMF-PAY-014` | C | Offline card capture is rejected for the current roadmap. | Rejected |
| `KLMF-PAY-025` | B | KitLuy is software integrator/payment orchestrator, not merchant of record or payment facilitator. | All phases |
| `KLMF-PRC-008` | B | Cambodia-first subscription/service model informed by pilots; do not copy Toast US pricing or proprietary processor/hardware economics. | Phase 1 pilot economics |
| `KLMF-REP-010` | C | Reporting, analytics, historical retention, exports and data services cannot be commercially paywalled. Security/privacy/fair-use controls remain allowed. | All phases |
| `KLMF-RES-004` | B | Restaurant tabs are confirmed for Phase 2; card-backed preauthorization is optional Phase 2.5. | Phase 2 / 2.5 |

---

# Part 12 — Master Feature Registry v0.2 Contract

## 12.1 Registry status

`kitluy-master-feature-registry-v0.2.md`, JSON and CSV companions are the canonical normalized planning registry subordinate to owner decisions and this bible.

Verified v0.2 coverage:

- original source rows: **687**;
- canonical KitLuy capabilities: **441**;
- canonical capabilities with two or more source rows: **117**;
- capabilities supported by more than one competitor source: **99**;
- unmapped source rows: **0**;
- duplicate source-row assignments: **0**;
- newly owner-locked capabilities: **12**.

The registry is not implementation evidence.

## 12.2 Registry use rules

- Master Feature IDs are stable planning/traceability identifiers.
- Source comparison IDs remain unchanged for evidence traceability.
- Owner decisions override source classifications.
- `REJECT` entries remain guardrails.
- `DEFER` entries remain disabled.
- `UNRESOLVED` entries cannot enter production scope merely because a competitor has the capability.
- Every build work item maps to one or more Master Feature IDs where applicable.
- Every completed item links to repository path, migration, API/event, test, deployment and documentation evidence.

## 12.3 Remaining owner-depth queue

Four approved-base capabilities still require owner decisions for optional depth:

| Master feature | Approved base | Remaining decision |
|---|---|---|
| `KLMF-CUS-006` | Customer consent, privacy, export and deletion | Exact workflow depth, retention, verification, deletion/anonymization exceptions and self-service scope. |
| `KLMF-GOV-006` | Feature flags, entitlements and plan controls | Optional commercial/operational depth without paywalling safety, finance truth, audit, backup access or data portability. |
| `KLMF-SUB-001` | Subscriptions, renewals and recurring commerce | Product scope, providers, dunning, proration, taxes, pause/cancel, vertical eligibility and timing. |
| `KLMF-TAX-001` | Tax configuration, calculation, snapshots and reporting | Cambodia launch depth, multi-market service depth, provider use, filings boundary and legal/accounting review. |

Until decided, implement only the approved minimum required by the active phase and keep optional depth disabled.

---

# Part 13 — Phase 1 Canonical Specification Set

## 13.1 Current approved target documents

| Date | Document | Version | Authority under v4 |
|---|---|---:|---|
| 2026-07-24 | `kitluy-partner-portal-phase1-spec-v2.0.0.md` | v2.0.0 | Detailed Partner PWA Phase 1 target; subordinate to v4. |
| 2026-07-24 | `kitluy-partner-app-phase1-spec-v2.0.0.md` | v2.0.0 | Detailed Partner App Phase 1 target; subordinate to v4. |
| 2026-07-25 | `kitluy-chain-portal-phase1-spec-v3.0.0.md` | v3.0.0 | Detailed Chain Phase 1 target; subordinate to v4. |
| 2026-07-25 | `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` | v4.0.0 | Detailed T1–T4 POS Desktop target; primary T1–T4 product contract. |
| 2026-07-25 | `kitluy-storefront-phase1-spec-v1.1.0.md` | v1.1.0 | Phase 1 QR/Telegram pre-intake and queue target. |
| 2026-07-25 | `kitluy-storehub-phase1-spec-v1.0.0.md` | v1.0.0 | Store Hub, managed-device, edge, sync and recovery target. |
| 2026-07-25 | `kitluy-pos-mobile-app-phase1-spec-v2.2.0.md` | v2.2.0 | Roaming staff client target; does not replace T1–T4. |
| 2026-07-25 | `kitluy-b2b-website-phase1-spec-v1.0.0.md` | v1.0.0 | Public business-acquisition and portal-entry target. |
| 2026-07-25 | `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` | v1.0.0 | Cloud/edge, scaling, operations, security and recovery target. |
| 2026-07-25 | `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` | v3.1.0 | HET control-plane target and canonical Admin authorization model. |

## 13.2 Retained supporting bibles

The following remain useful for non-conflicting retained detail:

- `kitluy-suite-ecosystem-business-bible-v1.0.0.md`;
- `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md`;
- `kitluy-partner-app-rebuild-bible-v1.1.0.md`;
- `kitluy-chain-portal-rebuild-bible-v2.0.0.md`;
- `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md`.

They do not override v4 or the Phase 1 specifications in 13.1.

## 13.3 Required database authority pack

Before broad implementation, the approved source pack must include and reconcile:

1. `kitluy-suite-supabase-schema-v1.0.0.md`;
2. `kitluy-suite-supabase-rls-and-authorization-v1.0.0.md`;
3. `kitluy-suite-supabase-migration-plan-v1.0.0.md`;
4. canonical data dictionary and enum/state registry;
5. API/OpenAPI/JSON Schema contracts for all active route families;
6. domain-event and durable-job registry;
7. Edge Operations API and sync protocol;
8. file/notification/payment provider contracts;
9. production-value and secret reference inventory.

If an approved version exists outside the current source pack, it must be attached and registered. Agents must not invent exact table names or production RLS from planning prose.

---

# Part 14 — Repository, Technology and Build Boundaries

## 14.1 Technology direction

| Layer | Approved direction |
|---|---|
| Web/PWA | React + TypeScript |
| Mobile | React Native + Expo |
| POS Desktop | Electron + React + TypeScript on Linux ARM64 |
| Edge OS | Raspberry Pi OS 64-bit / approved KitLuy OS image |
| Store Hub | Raspberry Pi 5 reference hardware, local PostgreSQL, managed system services |
| Cloud database/identity | Supabase |
| Cloud compute/workers/files/AI/releases | DigitalOcean |
| Primary timezone | Asia/Phnom_Penh |
| Localization | Khmer and English |
| Currency | KHR and USD |
| Payments | Cash and approved KHQR at launch depth; provider-certified integrations only |

Exact framework/runtime versions must be pinned in the repository and compatibility matrix. They are not guessed from competitor clone documents.

## 14.2 Canonical monorepo shape

```text
apps/
  kitluy-b2b-website/
  kitluy-admin-portal/
  kitluy-chain-portal/
  kitluy-partner-portal/
  kitluy-partner-app/
  kitluy-pos-desktop/
  kitluy-pos-mobile/
  kitluy-storefront/
  kitluy-restaurant-kds/              # Phase 2
  kitluy-restaurant-guest-display/    # Phase 2
services/
  api-gateway/
  management-api/
  commerce-store-api/
  connector-api/
  sync-worker/
  job-worker/
  webhook-worker/
  notification-worker/
  file-worker/
  release-service/
  ai-gateway/
  mcp-server/
  rag-indexer/
  kitluy-hub-agent/
packages/
  auth/
  rbac/
  api-contracts/
  edge-contracts/
  device-identity/
  sync-protocol/
  domain-events/
  jobs/
  money/
  localization/
  observability/
  file-contracts/
  release-manifests/
  ui/
supabase/
  migrations/
  functions/
  seed/
  tests/
infra/
  terraform/
  digitalocean/
  supabase/
  kubernetes/
  monitoring/
  domains/
  policies/
  kitluy-os-image/
  manufacturing-station/
docs/
  bibles/
  architecture/
  api/
  data/
  security/
  runbooks/
  disaster-recovery/
  capacity/
  decisions/
tests/
  unit/
  contract/
  integration/
  offline/
  hardware/
  security/
  load/
  recovery/
  chaos/
```

The final repository may adjust folder names through an approved ADR, but product boundaries must remain intact.

## 14.3 Code-reuse rule

Shared logic goes in packages/services/Core. Product applications own presentation, orchestration and product-specific workflows. A vertical module may extend a neutral contract but must not fork common payment, inventory, customer, finance, audit, file or authorization logic.

## 14.4 Secrets and production values

Secrets never live in source files, prompts, generated documentation or client bundles. All production values remain `[REQUIRED]` until supplied through the approved secret/reference process.

---

# Part 15 — Rebuild and Delivery Sequence

## 15.1 Gate 0 — Authority freeze

Before coding:

- approve and register this v4.0.0 bible;
- assemble the canonical source pack in one versioned location;
- hash/register every source artifact;
- identify duplicates and superseded documents;
- resolve blocking Appendix C conflicts;
- confirm the ten Phase 1 specifications;
- confirm Master Feature Registry v0.2 and owner lock;
- confirm exact owner/architecture contacts and approval process.

Exit: every agent reads the same manifest and authority order.

## 15.2 Gate 1 — Contract completion

Complete and approve:

- Supabase schema, RLS/authorization and migration plan;
- API/event/job/enum/state registries;
- money, customer, payment, finance and inventory contracts;
- Edge Operations API and sync protocol;
- device identity/PKI/manufacturing contracts;
- file, notification and provider contracts;
- environment, domain, secret-reference and release inventories.

Exit: no unresolved foundational object name, authority boundary or state machine required for Phase 1.

## 15.3 Gate 2 — Platform foundation

Build:

- monorepo and CI;
- shared identity/RBAC packages;
- base schemas and migrations in approved order;
- tenant/Digital Store/Location isolation;
- audit/events/jobs;
- file and notification foundations;
- App Platform environments and container pipeline;
- observability and backup baselines.

Exit: contract, RLS, migration and environment tests pass in development.

## 15.4 Gate 3 — Store edge foundation

Build and validate:

- manufacturing registry and PKI;
- KitLuy OS/Hub image;
- Hub local database and services;
- Edge Operations API;
- configuration projection and sync;
- terminal pairing/trust;
- printing, files and peripherals;
- signed releases and A/B rollback;
- replacement/recovery process.

Exit: an HET-enrolled Hub can be provisioned, run offline, sync, reject a clone and recover.

## 15.5 Gate 4 — Phase 1 product implementation

Implement by dependency order:

1. Admin control plane foundation and v3.1 authorization;
2. Partner Portal Digital Store/Location setup and operational configuration;
3. Store Hub/edge contracts;
4. POS Desktop T1 and T2;
5. Laundry production and T3;
6. T4 pickup and final custody;
7. payments, KHQR, receipts/tags and reconciliation;
8. Storefront pre-intake/queue and Telegram channel;
9. Partner App and POS Mobile approved read/action scopes;
10. Chain governance/read models;
11. B2B website and registration/portal routing;
12. Infrastructure operations, release and support workflows.

Exit: each product passes its product specification QA and shared integration gates.

## 15.6 Gate 5 — Integrated verification

Required cross-product tests include:

- Tenant/Digital Store/Location isolation;
- T1–T4 end-to-end custody;
- T2 privacy and payment-state correctness;
- internet failure during intake, Ready scan-in and pickup;
- outbox replay and idempotency;
- KHQR verified callback and reconciliation;
- file upload delay/recovery;
- cloned Hub/NVMe rejection;
- certificate revocation;
- signed release rollback;
- Admin scope/environment/four-eyes controls;
- Storefront draft-to-verified Booking boundary;
- stale-data labels;
- backup/restore and replacement Hub;
- load and App Platform scaling;
- DOKS staging portability of selected images.

## 15.7 Gate 6 — Pilot and go-live

- one approved pilot Partner/Digital Store/Location;
- trained operators and support;
- approved hardware and peripherals;
- production values and providers validated;
- monitoring/alerts/on-call active;
- backup restore drill complete;
- security review complete;
- finance/payment reconciliation complete;
- issue/rollback and replacement runbooks rehearsed;
- pilot acceptance and owner sign-off recorded.

Only then may Phase 1 be described as production-ready.

---

# Part 16 — QA, Security, Observability and Recovery Minimums

## 16.1 QA evidence classes

Every Phase 1 capability has, as applicable:

- unit tests;
- schema/migration tests;
- RLS/authorization tests;
- API contract tests;
- integration tests;
- offline/reconnect tests;
- hardware/peripheral tests;
- security tests;
- load/soak tests;
- backup/restore tests;
- upgrade/rollback tests;
- pilot evidence.

## 16.2 Mandatory negative tests

At minimum verify denial/rejection for:

- cross-Tenant reads/writes;
- wrong Digital Store or Location scope;
- frontend-only permission bypass;
- expired/used/mismatched approval token;
- requester self-approval;
- staging identity in production;
- POS direct cloud mutation that bypasses Hub;
- unknown Pi with copied image;
- cloned NVMe on another board;
- revoked Hub/terminal certificate;
- T3 pickup completion attempt;
- T2 production scan attempt;
- unverified KHQR/payment confirmation;
- duplicate offline mutation replay;
- connector direct DB access;
- AI tool execution without permission/human confirmation;
- unsigned/tampered release.

## 16.3 Observability minimum

Every service and Hub exposes:

- health/readiness;
- structured logs with correlation IDs;
- latency, error, saturation and queue metrics;
- sync lag and reconciliation health;
- certificate/release status;
- data freshness where relevant;
- owner team and runbook;
- alert severity and escalation path.

Monitoring must be independently usable during an application incident.

## 16.4 Backup and recovery

Required recovery scenarios:

- Supabase database incident;
- DigitalOcean service incident;
- Spaces partial outage;
- lost/revoked credential;
- Store Hub NVMe failure;
- complete Hub failure;
- terminal replacement;
- bad release and rollback;
- accidental/malicious Tenant deletion attempt;
- queue/webhook backlog;
- corrupted local database or file queue.

RPO/RTO values remain `[REQUIRED: approved service-tier targets]` and require restore evidence.

## 16.5 Truth during degradation

- Local Store operation may continue through Hub when permitted.
- Cloud portals show freshness and degraded state.
- Storefront uses approved conservative availability policy.
- No system marks payment confirmed without evidence.
- No connector or stale replica becomes authoritative during an outage.
- Operators receive explicit recovery/reconciliation status.

---

# Part 17 — Business, Commercial and Safety Guardrails

## 17.1 Cambodia-first requirements

- Khmer and English UX/content support;
- KHR and USD money handling;
- Asia/Phnom_Penh business date/time;
- KHQR as an approved launch-relevant payment path, subject to provider contract;
- Cambodia-first pricing, support and hardware economics;
- public legal, tax, privacy and payment claims approved by qualified humans.

## 17.2 Pricing and entitlements

- Core safety, finance truth, audit, backup access and Partner data portability cannot be paywalled.
- Reporting, analytics, exports, retention and data services cannot be commercially paywalled.
- Advanced API capacity, extra connectors, dedicated environments, premium support and SLA may be commercial, but security scopes and Store operations are not weakened or throttled by pricing.
- Hardware pricing and service terms are transparent and separate from payment-processing economics.

## 17.3 Payment guardrails

- No raw card storage.
- No offline card capture in the current roadmap.
- No false confirmed-payment state.
- Card surcharges disabled for initial Cambodia launch.
- Card-present/contactless and card-backed preauthorization are provider-certified later-phase options.
- KitLuy does not assume merchant-of-record, settlement or chargeback liability without a later legal owner decision.

## 17.4 Pharmacy guardrail

Phase 5 KitLuy supports operational/compliance controls but does not diagnose, prescribe or replace pharmacist judgment.

## 17.5 AI safety

AI may summarize, explain, search, draft and recommend within permission scope. Sensitive financial, permission, compliance, device, release, infrastructure, customer-impact or safety actions require authorized human confirmation and normal API/RLS enforcement.

---

# Part 18 — Multi-Agent Build and Handoff Protocol

## 18.1 Required reading order for KIMI Swarm / Claude Code

1. this `kitluy-suite-rebuild-bible-v4.0.0.md`;
2. current Project Instruction and owner decision locks;
3. Master Feature Registry v0.2 and source traceability;
4. approved Supabase schema/RLS/migration authority pack;
5. active product specification for the assigned work;
6. API/event/job/device/file/payment contracts;
7. repository ADRs and implementation evidence;
8. QA, security, release and runbooks.

## 18.2 Work-package manifest

Every agent work package declares:

- work-package ID and owner;
- target phase/product/domain;
- Master Feature IDs;
- authority sources and versions;
- dependencies and blocked items;
- schema/API/event changes;
- migration and rollback impact;
- permission/audit impact;
- Store Hub/offline impact;
- tests and evidence required;
- documentation files to update;
- explicit non-goals;
- unresolved decisions.

## 18.3 Single-writer and contract-first rules

- One designated writer owns a given schema/API contract at a time.
- Other agents propose changes through reviewed patches.
- Schema and API contracts are approved before parallel UI implementation.
- Generated clients/types come from canonical contracts where possible.
- Agents do not fork shared logic into application repositories.
- No agent renames a canonical entity or permission without an approved compatibility/migration plan.

## 18.4 Implementation evidence ledger

A completed feature records:

- repository commit/tag;
- code paths;
- migration IDs and applied environments;
- API/event contract version;
- tests and results;
- deployment/release artifact digest;
- monitoring/dashboard evidence;
- security review;
- pilot/production evidence where required;
- updated documentation and Rebuild Test result.

## 18.5 Prohibited AI-agent behavior

An AI agent must not:

- infer that planning equals implementation;
- auto-apply production migrations;
- invent secrets, domains, provider IDs or legal policies;
- restore the T1/T2/T3 model;
- call T2 a KDS or production display;
- collapse Digital Store and Store Location;
- bypass Store Hub for normal POS writes;
- trust copied OS/NVMe, MAC or IP as device identity;
- create broad Admin roles as a shortcut;
- grant itself production or break-glass access;
- copy competitor clone schemas as KitLuy truth;
- silently resolve a source conflict;
- present stale or synthetic data as authoritative.

## 18.6 Handoff completion

A handoff is complete when the receiving engineer/agent can:

- identify authority and current versions;
- explain entity and product boundaries;
- run development setup;
- apply development migrations in order;
- run tests and reproduce evidence;
- trace a feature from registry to code/API/schema/tests/docs;
- operate local Hub/POS flows;
- recover/rollback safely;
- list unresolved owner decisions without guessing.

---

# Appendix A — Canonical Source Register

## A.1 Level 1 — Owner authority

- Current KitLuy Project Instruction — vertical build strategy and engineering/source rules.
- Digital Store-first and Extended WooCommerce Adoption decisions in `KitLuy Suite Project.txt`.
- T1–T4 Laundry decision in `kitluy-concept-design-1.txt`.
- Smartphone-Simple Provisioning decision in `Device Management & Provisioning System.txt`.
- `kitluy-owner-decision-lock-12-capabilities-v1.0.md`.
- Owner-approved Storefront QR/Telegram/virtual-queue decision reflected in `kitluy-storefront-phase1-spec-v1.1.0.md`.

## A.2 Level 2 — Implementation truth

At publication of this bible, the supplied planning source set does not provide a complete repository checkout, applied migration history, executable full-system test package, production deployment record or production telemetry sufficient to label the Suite implemented. Those evidence artifacts must be registered as they are created.

## A.3 Level 3 — Current KitLuy bibles/specifications

- this v4 master bible;
- `kitluy-suite-ecosystem-business-bible-v1.0.0.md`;
- ten Phase 1 documents in Part 13;
- retained product bibles where non-conflicting;
- approved Supabase schema/RLS/migration pack when attached.

## A.4 Level 4 — Approved handoffs

Approved implementation plans, ADRs, release handoffs and feature evidence packages stored in the canonical repository/handoff location.

## A.5 Level 5 — Evidence-based competitor analyses

- WooCommerce comparison/classification/backlog package;
- Toast comparison/classification/backlog package;
- Shopify comparison/classification/backlog package;
- Lightspeed comparison/classification/backlog package;
- Loyverse comparison/classification package;
- Master Feature Registry v0.2 and source traceability normalize these inputs but remain subordinate to owner authority.

## A.6 Level 6 — Competitor rebuild/clone references

- `woocommerce-rebuild-bible-v1.0.0.md`;
- `toast-pos-rebuild-bible-v1.0.0.md`;
- `lightspeed-pos-rebuild-bible-v1.0.0.md`;
- `loyverse-rebuild-bible-v1.0.md`;
- `shopify-commerce-rebuild-bible-v1.0.1.md`;
- external research analyses.

These may inform design questions only. Their schemas, exact routes, thresholds, topology and business models are not KitLuy truth.

---

# Appendix B — Superseded-Document Register

| Document/source | Superseded scope | Current replacement/treatment |
|---|---|---|
| `kitluy-suite-rebuild-bible-v3.0.0.md` | Entire cross-suite authority; especially source order, physical-first wording, three-role terminal model, product inventory and old POS/API/SOP sections | This v4.0.0 master authority. Reuse only explicitly non-conflicting technical detail after review. |
| v3 §3.6/§3.7 Laundry terminal topology and flows | T1 Intake, T2 Scan-In, T3 Scan-Out/shared conveyor assumptions | Part 5 here plus POS Desktop v4.0.0 and Store Hub v1.0.0. |
| v3 §7.7 POS endpoints | `/t2/scan-in`, `/t3/retrievals`, handover contracts tied to obsolete profiles | Replaced by T1/T2/T3/T4 Edge Operations API in approved current contracts. |
| v3 §8.11 T1/T2/T3 state machine | Entire state machine | T1–T4 model in this bible and current product specifications. |
| v3 §9.9 Laundry terminal layouts | T2 Scan-In, T3 Scan-Out and shared mode switch | T2 CDS, T3 Ready Scan-In, T4 Pickup Scan-Out. |
| v3 §11.8 pairing roles | Shared conveyor terminal mapping | Assigned approved T1–T4 profiles; T3/T4 may share hardware but not logical identity. |
| v3 §14.5 terminal SOPs | T2/T3 retrieval/handover SOPs | Current T1–T4 SOPs must be generated from POS Desktop v4 and Store Hub v1. |
| v3 Part 17 feature map | Old application inventory and terminal ownership | Part 4 and Master Feature Registry v0.2. |
| `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md` | Admin scope where v3.1 adds Digital Store/Location, multi-team authorization, approvals, fleet/security and Phase 1 routes | `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`. |
| `kitluy-chain-portal-rebuild-bible-v2.0.0.md` | Phase 1 hierarchy, T1–T4 awareness, freshness and route ownership | `kitluy-chain-portal-phase1-spec-v3.0.0.md`. |
| `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md` | Physical-first Store assumptions, obsolete terminal/provisioning flows and Phase 1 active navigation | `kitluy-partner-portal-phase1-spec-v2.0.0.md`. |
| `kitluy-partner-app-rebuild-bible-v1.1.0.md` | Phase 1 Digital Store/Location and T1–T4 detail where changed | `kitluy-partner-app-phase1-spec-v2.0.0.md`. |
| Older three-terminal references in concept/planning documents | T2 scan-in and T3 scan-out | Owner-locked T1–T4 decision and this v4. |
| Manual IP as normal provisioning | Installer-selected IP/role as primary path | Hub-first automatic secure discovery; manual IP fallback only. |
| Physical Store as the first created entity | Physical-first onboarding | Tenant/Partner → Digital Store → optional Store Location. |
| Supabase Storage as heavy-file authority | Heavy operational/media bytes in Supabase Storage | DigitalOcean Spaces bytes; Supabase metadata/permissions/audit. |
| Kubernetes at Phase 1 launch | Kubernetes-first operating model | App Platform first; Kubernetes-ready services; triggered DOKS migration. |
| Broad `admin` role/page-based authorization | Role/page visibility as security | Admin v3.1 explicit permission, scope, environment, approval, API and RLS model. |
| Competitor clone architecture | Exact tables/routes/topology treated as product truth | Design reference only through evidence-based analysis and owner adoption. |
| Duplicate copies of `KitLuy Suite Project.txt`, `kitluy-concept-design-1.txt`, and `Infrastructure upgrade version.txt` | Duplicate source identity | Keep one content-hashed canonical copy in the handoff manifest; duplicates do not create extra authority. |

---

# Appendix C — Conflict and Decision Register

## C.1 Required conflict record

| Field | Required content |
|---|---|
| Conflict ID | Stable ID, e.g. `KLCON-2026-001` |
| Date/status | Detected date and open/resolved/deferred status |
| Newer authority | Exact file/version/section |
| Older source | Exact file/version/section |
| Conflict | Precise incompatible statements |
| Resolution | Applied higher-authority result or `[REQUIRED]` |
| Implementation impact | Schema/API/UI/offline/security/migration/operations |
| Files to correct | Complete list |
| Owner/approver | Responsible decision authority |
| Evidence | PR, migration, tests, deployment and docs |

## C.2 Initial resolved conflicts

| ID | Newer authority | Older source | Resolution |
|---|---|---|---|
| `KLCON-2026-001` | T1–T4 owner lock and POS Desktop v4 | Suite v3 three-role model | Replace all T2 Scan-In/T3 Scan-Out assumptions with T2 CDS, T3 Ready Scan-In and T4 Pickup Scan-Out. |
| `KLCON-2026-002` | Digital Store-first owner direction | Physical-first wording in older bibles | Digital Store is created first; physical Location is optional. |
| `KLCON-2026-003` | Smartphone-simple provisioning | Manual IP/role-selection normal flows | Automatic assignment and identity-validated discovery are normal; manual IP is fallback only. |
| `KLCON-2026-004` | Store Hub v1 managed-device model | Generic copied-image/device enrollment assumptions | Only HET-enrolled hardware with composite identity/certificates may activate. |
| `KLCON-2026-005` | Infrastructure v1 | Kubernetes-first or uncontainerized assumptions | App Platform first; immutable Kubernetes-ready containers; evidence-triggered DOKS. |
| `KLCON-2026-006` | Admin v3.1 | Broad role/page authorization | Explicit permission + resource/environment scope + approval + API/RLS. |
| `KLCON-2026-007` | Current app inventory | Older inventory omitting B2B website/Storefront and later clients | Use Part 4 inventory. |
| `KLCON-2026-008` | Owner decision KLMF-REP-010 | Tiered reporting/history paywall proposals | Reporting, analytics, exports, history and data services cannot be commercially paywalled. |
| `KLCON-2026-009` | Owner decision KLMF-PAY-014 | Clone designs allowing offline card capture | Offline card capture is rejected. |
| `KLCON-2026-010` | Exact authority order in current Project Instruction | Older bibles with different precedence | Use §0.2 of this v4. |

## C.3 Open owner-depth decisions

Use the four items in Part 12.3. No agent may expand them beyond approved minimum scope without a versioned decision.

---

# Appendix D — Phase 1 Go-Live Master Checklist

## D.1 Authority and documentation

- [ ] v4 approved and registered.
- [ ] Source manifest, hashes and supersession register complete.
- [ ] Ten Phase 1 specifications approved.
- [ ] Supabase schema/RLS/migration pack approved.
- [ ] API/event/job/enum/device/file/payment contracts approved.
- [ ] Master Feature IDs mapped to build work.
- [ ] Open decisions disabled or resolved.

## D.2 Cloud and security

- [ ] Supabase development/staging/pilot/production responsibilities validated.
- [ ] RLS isolation tests pass.
- [ ] DigitalOcean services use immutable signed images.
- [ ] App Platform scaling and cost guardrails approved.
- [ ] Spaces buckets, lifecycle, signed access and backup policies validated.
- [ ] Admin v3.1 permissions, scopes, approvals and break-glass controls pass.
- [ ] Secrets and PKI are production-ready.

## D.3 Store edge

- [ ] HET manufacturing enrollment process works.
- [ ] Unknown/copied Hub is rejected.
- [ ] Hub provisions through a short-lived code without bypassing identity checks.
- [ ] Terminals pair through the active Hub.
- [ ] T1/T2/T3/T4 profiles are correctly assigned.
- [ ] Offline operations and reconnect pass.
- [ ] Signed release and A/B rollback pass.
- [ ] Replacement Hub and HET NVMe service procedures pass.

## D.4 Laundry operation

- [ ] Storefront pre-intake/queue converts only after T1 verification.
- [ ] T1 creates Booking, takes approved payment and prints documents.
- [ ] T2 displays the correct customer-safe projection.
- [ ] Production states and issue handling pass.
- [ ] T3 records Ready custody and storage.
- [ ] T4 verifies collector, balance and final custody release.
- [ ] No other profile can complete pickup scan-out.
- [ ] Payment, finance, inventory/consumables and reports reconcile.

## D.5 Operations and recovery

- [ ] Monitoring, alerting, on-call and runbooks active.
- [ ] Backup/restore evidence approved.
- [ ] Incident and security response rehearsed.
- [ ] Support consent/access controls pass.
- [ ] Training and pilot acceptance complete.
- [ ] Rebuild Test passed by a qualified engineer not involved in original implementation.

---

# Appendix E — Required Production Values

The following must remain `[REQUIRED]` until supplied through approved channels:

- legal HET/KitLuy entity and public legal text;
- production/staging/pilot domains;
- Supabase project references, plans and connection modes;
- DigitalOcean project, App Platform application and DOKS trigger values;
- Spaces bucket names, classes, regions and retention;
- production PKI/CA design, HSM/secure-element models and rotation windows;
- approved Store Hub and terminal bill of materials;
- provider contracts and credentials for KHQR, email, SMS, push and maps;
- tax, privacy, retention and deletion policies;
- security session, re-authentication, approval expiry and quorum values;
- RPO/RTO/SLO targets;
- pricing, plans, hardware terms and support SLAs;
- pilot Partner, Digital Store, Location and go-live date;
- production owners, approvers, on-call and escalation contacts.

---

# Version History

| Version | Date | Summary |
|---|---|---|
| `v3.0.0` | 2026-07-10 | Prior Suite ecosystem bible. Retained as historical/reusable input but contains obsolete T1/T2/T3 and pre-lock architecture. |
| `v4.0.0` | 2026-07-26 | New master authority consolidating eight vertical phases, Digital Store-first hierarchy, T1–T4 Laundry, updated applications, B2B website, Storefront, Supabase/DigitalOcean split, managed-device Store Hub security, Kubernetes-ready infrastructure, Admin v3.1 authorization, owner locks, Master Feature Registry v0.2, July 24–25 Phase 1 specs, exact authority order and superseded-document register. |

---

# Final Canonical Statement

> **KitLuy must be built as one reusable Digital Store operating system with phase-specific vertical deltas, not as disconnected clones or Laundry-hardcoded applications. The Digital Store is the control plane; optional Store Locations are offline-capable edge environments governed by HET-enrolled Store Hubs. Phase 1 Laundry uses T1 POS Cashier/Intake, T2 Customer Display Screen, T3 Clean & Ready Scan-In and T4 Customer Pickup Scan-Out. Supabase owns authoritative cloud identity and relational truth; DigitalOcean owns application compute, workers, object bytes, AI/MCP/RAG and release infrastructure; Store Hub owns local operational continuity. Every build decision must follow the exact authority order, preserve append-only truth, enforce scoped authorization and remain reconstructable from approved contracts and evidence.**
