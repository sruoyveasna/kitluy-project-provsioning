# KitLuy Partner Portal — Phase 1 Laundry Product Specification

**Filename:** `kitluy-partner-portal-phase1-spec-v2.0.0.md`  
**Version:** v2.0.0  
**Date:** 2026-07-24  
**Product:** `kitluy-partner-portal`  
**Edition:** Phase 1 — Laundry  
**Owner:** HET / KitLuy Suite project owner  
**Audience:** Product owner, product manager, UI/UX, frontend engineers, backend engineers, QA, security, support, implementation operators, and AI handoff agents  
**Status:** Proposed canonical Phase 1 product specification; not implementation evidence  
**Primary market:** Cambodia  
**Languages:** Khmer and English  
**Currencies:** KHR and USD  
**Timezone:** `Asia/Phnom_Penh`

> **Product promise:** Configure deeply. Operate by exception. Show authoritative truth. Keep physical Store operations running through the Store Hub.

> **Evidence rule:** Nothing in this specification is `IMPLEMENTED` unless repository code, applied migrations, executable tests, deployment evidence, and—where required—pilot or production evidence prove it.

---

## 0. Purpose and authority

### 0.1 Purpose

This specification defines the upgraded Phase 1 Laundry version of `kitluy-partner-portal`. It converts the current one-store Partner PWA baseline into a Digital Store-first, task-oriented, truth-aware back office aligned with the latest KitLuy owner decisions and the consolidated master feature registry.

The specification is intended to be sufficiently precise for:

- product and UI/UX design;
- frontend and backend implementation planning;
- schema and API contract design;
- role and permission implementation;
- QA scenario creation;
- pilot and go-live preparation;
- future rebuild documentation.

It is not a substitute for applied migrations, API schemas, Figma source files, repository code, test evidence, deployment runbooks, or production configuration values.

### 0.2 Authority order

When sources conflict, apply this order:

1. Current project-owner decisions and the active KitLuy Project Instructions.
2. Applied migrations, verified repository code, executable tests, deployment records, and production evidence.
3. This v2.0.0 Phase 1 specification after owner approval.
4. `kitluy-master-feature-registry-v0.2.md` and its owner-decision lock.
5. Current KitLuy Rebuild and Business Bibles.
6. Approved competitor comparison and product-backlog documents.
7. Competitor rebuild/clone documents as design references only.
8. Superseded planning.

A competitor pattern cannot override KitLuy architecture, terminology, source-of-truth rules, vertical sequence, or owner decisions.

### 0.3 Source baseline

This specification consolidates:

- `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md`;
- `kitluy-partner-app-rebuild-bible-v1.1.0.md`;
- `kitluy-suite-rebuild-bible-v3.0.0.md`;
- `kitluy-suite-ecosystem-business-bible-v1.0.0.md`;
- `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md`;
- `kitluy-chain-portal-rebuild-bible-v2.0.0.md`;
- the Digital Store-first owner decision in `KitLuy Suite Project.txt`;
- the T1–T4 owner decision in `kitluy-concept-design-1.txt`;
- the smartphone-simple provisioning decision in `Device Management & Provisioning System.txt`;
- `kitluy-owner-decision-lock-12-capabilities-v1.0.md`;
- `kitluy-master-feature-registry-v0.2.md` and JSON/CSV companions;
- evidence-based comparison, product classification, and implementation backlog packages for WooCommerce, Toast, Shopify, Lightspeed, and Loyverse.

### 0.4 Required corrections to the v1.1.0 baseline

The following v1.1.0 assumptions are superseded in this specification:

| Superseded baseline | v2.0.0 correction |
|---|---|
| `Store` described primarily as one physical business location | Use neutral hierarchy: Tenant/Partner Account → Digital Store → Store Location. The Digital Store is the control plane. |
| Three-terminal or T1/T2/T3 Laundry model | Use owner-locked T1–T4 model. |
| T2 as Scan-In | T2 is Customer Display Screen. |
| T3 as Scan-Out | T3 is Clean & Ready Scan-In. |
| Final pickup routed back to T1 | T4 is Customer Pickup Scan-Out and is the only terminal role authorized to complete pickup scan-out. |
| Manual or portal-led IP setup as normal provisioning | Use Hub-first smartphone-simple provisioning, device certificates, automatic LAN discovery, cached endpoints, and manual IP only as fallback. |
| Physical Store creation as the main starting point | Create and configure the Digital Store first; physical Location and Hub provisioning are optional later steps. |
| One-shot active future feature menu | Active navigation contains Phase 1 Laundry only. Future routes may exist in code behind disabled flags but must not appear as active capabilities. |
| Generic inventory breadth at launch | Launch with Laundry consumables and movement-ledger control. Purchasing depth is gated after core pilot evidence. |
| Readiness treated as a simple score | Readiness is evidence-backed, with required, optional, blocked, stale, failed, and skipped states. |

---

## 1. Product definition

### 1.1 What the Partner Portal is

`kitluy-partner-portal` is the full web/PWA back office for an authorized Partner operating one active Digital Store context. In Phase 1 it provides deep Laundry configuration, complete management tables, operational oversight, finance and reconciliation, reports and exports, staff and permission management, Store technology readiness, and Integration Hub foundations.

The Portal is the primary Partner surface for:

- creating and configuring a Laundry Digital Store;
- selecting the Laundry vertical before catalog setup;
- configuring services, add-ons, prices, policies, documents, staff, and payments;
- preparing and monitoring Store Location provisioning;
- overseeing Laundry Orders and exceptions;
- managing customer records and history;
- managing consumable inventory;
- managing employees, Portal roles, POS PINs, and time records;
- reviewing operational finance and completing reconciliation;
- running reports and audited exports;
- viewing Store Hub, T1–T4, peripheral, sync, and configuration status;
- configuring approved optional connectors through Integration Hub.

### 1.2 What the Partner Portal is not

The Portal is not:

- the T1 cashier or Laundry intake application;
- the T2 Customer Display Screen;
- the T3 Ready Scan-In terminal;
- the T4 Pickup Scan-Out terminal;
- the Store Hub local runtime;
- an offline mutation authority;
- the Partner mobile daily-operations cockpit;
- a Chain-level multi-Store governance portal;
- the HET Admin control plane;
- a public Storefront;
- a statutory ERP, general ledger, payroll engine, or tax filing service;
- a connector runtime with direct production-database access;
- evidence that any feature is implemented.

### 1.3 Canonical operating model

```text
Partner Account / Tenant
        ↓
Digital Store
        ↓
Vertical = Laundry
        ↓
Catalog, pricing, staff, payments, rules, documents
        ↓
Digital Store readiness
        ├── Online-only/private operation allowed
        └── Optional physical Store Location provisioning
                ↓
             Store Hub
                ↓
        T1 / T2 / T3 / T4 and peripherals
```

Configuration flows from the Digital Store to authorized Locations and channels. Transactions and operational events return to KitLuy. External channels do not own customer, inventory, payment, finance, or audit truth.

### 1.4 Product outcome

A non-technical Laundry Partner must be able to:

1. create a Partner account and Digital Store;
2. select Laundry as the primary vertical;
3. configure services, pricing, policies, staff, and payments;
4. understand exactly what is complete, blocked, stale, or unavailable;
5. operate online-only or private before physical provisioning;
6. provision an active Store Hub and assigned T1–T4 terminals when ready;
7. monitor daily operations through exception queues;
8. reconcile money and export records from authoritative read models;
9. recover from partial sync, failed jobs, and device issues without seeing false success states.

---

## 2. Product principles

### 2.1 Digital Store first

No physical Store Location or device is required to create the Partner account or Digital Store. Vertical selection is mandatory before catalog setup. A Digital Store may remain private or online-only until physical activation is needed.

### 2.2 One Store, one primary vertical

Each Digital Store belongs to exactly one primary vertical. Phase 1 accepts only `laundry`. A Partner operating another business type must create a separate Digital Store under the same Tenant/Partner account.

### 2.3 Task-first, not module-first

The Home experience must prioritize tasks, exceptions, blockers, due work, and degraded states. A Partner should not need to search through modules to discover operational problems.

### 2.4 Truth-first UI

Every sensitive metric or status must disclose:

- source;
- as-of timestamp;
- freshness;
- completeness;
- reconciliation state when relevant;
- whether the value is authoritative, partial, estimated, cached, stale, or unavailable.

Zero is a valid value only when returned by an authoritative contract. Missing data is never converted to zero.

### 2.5 Store Hub local authority

After provisioning, the Store Hub is the local operational authority for T1–T4, local data, files, peripherals, and offline execution. The Portal may display cloud-synchronized projections but cannot pretend to be the local runtime.

### 2.6 Append-only finalized records

Finalized finance, payment, inventory movement, custody, and audit records are append-only. Corrections use compensating records linked to originals.

### 2.7 Human confirmation for sensitive actions

Refunds, voids, reconciliation completion/reopen, high-risk configuration changes, permission changes, device revocation, connector disconnect, and other sensitive actions require authorized human confirmation, reason capture, and audit.

### 2.8 Khmer and Cambodia first

The Portal must support Khmer and English, KHR and USD, Cambodian phone numbers, KHQR, and `Asia/Phnom_Penh`. It must remain usable under intermittent internet and power conditions.

### 2.9 Additive evolution

Schema and API changes should be additive and backward-compatible. Future verticals extend neutral Core contracts and add vertical deltas; they do not replace Laundry or hardcode Laundry terminology into Core.

---

## 3. Users and roles

### 3.1 Primary personas

| Persona | Main goals | Typical access |
|---|---|---|
| Partner Owner | Configure business, control money and permissions, approve sensitive actions, review performance | Full one-Digital-Store authority |
| Store Manager | Run daily back office, manage services, staff, inventory, exceptions, and delegated finance | Broad delegated authority |
| Supervisor | Monitor operations, production, issues, staff activity, and delegated adjustments | Limited operational authority |
| Accountant | Review ledgers, reconcile, prepare exports and statements | Finance-focused authority |
| Readonly User | Review permitted records without mutation | Filtered and masked read-only access |
| HET Support | Troubleshoot through explicit consent and time-limited support session | Admin-mediated, audited, scoped access |

Cashiers and Laundry staff use POS/edge surfaces and do not receive Portal membership by default.

### 3.2 Canonical Portal roles

- `partner_owner`
- `store_manager`
- `supervisor`
- `accountant`
- `readonly`
- `support_readonly` through an Admin-mediated consent session

### 3.3 Permission model

Permissions must be capability-based, scoped to Tenant, Digital Store, Store Location, user, role, and where relevant device. UI hiding is not authorization. Every API or database operation must independently enforce scope.

### 3.4 High-level permission matrix

| Capability | Owner | Manager | Supervisor | Accountant | Readonly |
|---|---:|---:|---:|---:|---:|
| View Home and Operations | Yes | Yes | Yes | Finance subset | Filtered |
| Configure Digital Store identity | Yes | Delegated | View | No | View |
| Configure services and pricing | Yes | Yes | View | No | View |
| Publish configuration | Yes | Delegated | No | No | No |
| Emergency service pause/resume | Yes | Yes | Delegated | No | No |
| View and manage Laundry exceptions | Yes | Yes | Yes | View financial impact | View |
| Manage customers | Yes | Yes | Limited | View balances | View masked |
| Post inventory counts/adjustments | Yes | Yes | Threshold/delegated | No | No |
| Manage employees | Yes | Yes | Limited | No | No |
| Manage roles and POS PINs | Yes | Delegated | PIN unlock only if delegated | No | No |
| View Finance | Yes | Yes | Limited/none | Yes | Optional masked |
| Approve refund/void | Yes | Threshold/delegated | Request only | Review only | No |
| Complete/reopen reconciliation | Yes | Delegated | No | Prepare/delegated | No |
| Export sensitive records | Yes | Delegated | Operational only | Finance exports | No |
| View Store technology status | Yes | Yes | Yes | View | View |
| Revoke/replace device | Yes | Request/delegated | No | No | No |
| Connect/pause connector | Yes | Delegated | View | View finance status | View |
| Disconnect connector | Yes | Explicit delegation only | No | No | No |
| Security and membership changes | Yes | Limited | No | No | No |

---

## 4. Information architecture

### 4.1 Primary navigation

```text
Home
├── Action Center
├── Messages
└── AI Summary [feature-gated]

Setup
├── Digital Store Checklist
├── Digital Store Profile
├── Store Location Readiness
├── Physical Provisioning
└── Go-Live Review

Operations
├── Laundry Order Center
├── Production Monitor
├── Ready & Pickup
├── Issues / Rewash / Damage
└── Pickup & Delivery

Customers
├── Customer Directory
├── Customer Detail & History
├── Complaints & Notes
└── Duplicate Review

Store
├── Services & Pricing
├── Add-ons & Special Handling
├── Service Availability
├── Order Rules & Workflow
├── Business Hours & Closures
├── Receipt Templates
├── Laundry Tag Templates
├── Payment Methods
├── Notifications
├── Language & Currency
└── Data Import / Export

Inventory
├── Overview
├── Consumables
├── Movement History
├── Counts
├── Adjustments
├── Waste / Loss
└── Purchasing [post-pilot flag]

Employees
├── Overview
├── Employees
├── Roles & Access
├── POS PINs
├── Time Clock & Time Cards
├── Attendance
├── Staff Activity
└── Training Checklist

Finance
├── Overview
├── Sales Ledger
├── Payment Ledger
├── Deposits & Balances
├── Cash & Shifts
├── Refunds & Voids
├── Reconciliation
├── Documents
└── Export Center

Reports
├── Overview
├── Operations
├── Services
├── Customers
├── Inventory
├── Employees
└── Finance

Store Technology
├── Store Hub
├── Terminals
├── Peripherals
├── Sync Status
├── Configuration Versions
└── Diagnostics

Integrations
├── Connector Catalog
├── Connections
├── Sync Jobs
├── Errors
└── Connector Audit

System
├── Files
├── Audit Log
├── Security
├── Knowledge Base
├── Support
└── Settings
```

### 4.2 Route contract

Recommended route roots:

```text
/app/home
/app/setup
/app/operations
/app/customers
/app/store
/app/inventory
/app/employees
/app/finance
/app/reports
/app/store-technology
/app/integrations
/app/system
```

Every authenticated route must resolve and revalidate:

- `tenant_id`;
- `digital_store_id`;
- active `store_location_id` when the route is Location-specific;
- membership;
- role/capabilities;
- vertical entitlement;
- feature flag;
- data source and freshness requirements.

The Portal must never silently switch Digital Stores or Locations.

### 4.3 Future navigation rule

Restaurant, eCommerce, Convenience, Pharmacy, Department Store, Grocery, and Supermarket pages must not appear in Phase 1 active navigation. Future route scaffolds may exist only when:

- feature flags are off by default;
- they are excluded from normal bundles;
- permissions and API contracts reject access;
- they do not destabilize Laundry routes or migrations.

---

## 5. Shared UI system

### 5.1 Required shell elements

Every authenticated page includes:

- global navigation;
- Digital Store context;
- active Location context where relevant;
- Laundry vertical badge;
- sync/freshness indicator;
- data-as-of timestamp where relevant;
- role-aware actions;
- notifications/messages entry;
- user/session menu.

### 5.2 Core reusable components

| Component | Responsibility |
|---|---|
| `DigitalStoreContextHeader` | Shows Digital Store, Location, vertical, status, and context-switch rules |
| `SetupProgress` | Displays resumable setup progress and task ownership |
| `ReadinessGate` | Displays requirements, blockers, evidence, and remediation |
| `SyncFreshnessBanner` | Displays fresh, pending, stale, offline, unknown, or degraded state |
| `TruthStatus` | Displays authoritative, partial, estimated, cached, stale, or unavailable |
| `MetricCard` | Metric, definition, source, as-of time, and drill-through |
| `ExceptionQueue` | Prioritized records requiring attention |
| `StatusBadge` | Consistent operational, payment, sync, device, and readiness states |
| `DataTable` | Filtering, sorting, saved views, columns, pagination, row actions, export |
| `RecordDrawer` | Summary, details, timeline, documents, audit, and permitted actions |
| `RecordTimeline` | Append-only event timeline with actor and source |
| `WizardForm` | Resumable multi-step setup with validation and autosave |
| `ApprovalDrawer` | Action preview, effect, reason, evidence, approver, and confirmation |
| `ConfigurationDiff` | Draft-versus-active preview and downstream impact |
| `MoneySummary` | Gross, discount, refund, net, paid, balance, source, and reconciliation |
| `EvidenceUploader` | Signed upload, confirmation, class, retention, and audit |
| `ExportJobPanel` | Queue, progress, failure, expiry, and download history |
| `FailureRecoveryPanel` | Error, dependency state, safe retry, support route, and verification |
| `EmptyState` | Valid zero-record state with relevant next action |
| `PartialState` | Some authoritative sources are unavailable |
| `UnavailableState` | Required authoritative contract is unavailable |
| `StaleState` | Data exists but exceeds freshness policy |
| `PermissionDeniedState` | Explicitly explains missing capability without leaking protected data |

### 5.3 Responsive behavior

- Desktop: full sidebar, multi-column dashboards, tables, and drawers.
- Tablet: collapsible sidebar, reduced columns, full-screen detail panels as needed.
- Mobile web: responsive management view, but not a replacement for Partner App or POS.
- No critical action may rely on hover.
- Khmer text expansion must not clip labels or buttons.

### 5.4 Formatting

| Type | Rule |
|---|---|
| KHR | Integer minor units; display without decimal places |
| USD | Decimal display according to approved money contract |
| Date | `DD/MM/YYYY` in UI; ISO 8601 in APIs |
| Time | Location-local display, stored as `timestamptz` |
| Phone | E.164 storage, local display allowed |
| CSV | UTF-8 with Khmer-safe text |
| Status | Text + icon; color alone is insufficient |

---

## 6. Home and Action Center

### 6.1 Goal

The Home page brings the most important work, risks, and degraded states to the Partner. It is not a decorative analytics dashboard.

### 6.2 Feature inventory

| ID | Feature | Phase 1 requirement |
|---|---|---|
| `KPP-DASH-001` | Digital Store readiness | Show overall state and blocking tasks; score is derived and never authoritative by itself |
| `KPP-DASH-002` | Today’s Laundry Orders | Count and drill-through from authoritative order read model |
| `KPP-DASH-003` | Due today | Filtered queue by due time and status |
| `KPP-DASH-004` | Overdue | Prioritized by overdue duration and service commitment |
| `KPP-DASH-005` | Ready for pickup | Queue with balance and notification status |
| `KPP-DASH-006` | Issues and rewash | Queue with age, severity, evidence, and owner |
| `KPP-DASH-007` | Outstanding balances | Authoritative balance total and records |
| `KPP-DASH-008` | Cash variance | Latest open/closed variance requiring review |
| `KPP-DASH-009` | Low stock | Consumables below threshold |
| `KPP-DASH-010` | Staff exceptions | Attendance, locked PIN, unapproved time-card adjustment, or missing role |
| `KPP-DASH-011` | Store technology health | Hub, T1–T4, peripherals, version, and sync summary |
| `KPP-DASH-012` | Sync and freshness | Pending, stale, failed, or unknown data sources |
| `KPP-DASH-013` | Approval queue | Sensitive actions awaiting user decision |
| `KPP-DASH-014` | Failed jobs and connector warnings | Scoped Partner-visible failures only |
| `KPP-DASH-015` | Messages | Operational and support messages |
| `KPP-AI-001` | AI daily summary | Optional, grounded, permission-scoped, timestamped, and never authoritative |

### 6.3 Acceptance criteria

- Every metric provides a definition, source, and as-of timestamp.
- Every actionable card links to a filtered record set.
- Stale or missing data cannot appear as green/healthy.
- Users see only permitted data and actions.
- The page remains usable when one module is unavailable; unavailable modules show explicit state.
- The Action Center never mutates edge-operational records directly.

---

## 7. Guided Digital Store setup and readiness

### 7.1 Goal

A Partner with no technical knowledge can create a runnable Laundry Digital Store, keep it private or online-only, and later provision physical operations.

### 7.2 Setup stages

| Stage | Required tasks |
|---|---|
| 1. Partner | Identity, verification status, primary contact, phone |
| 2. Digital Store | Name, code/handle, brand details, language, currency, timezone |
| 3. Vertical | Select `laundry`; selection is immutable after operational activation without controlled migration |
| 4. Location | Optional physical Location details and business hours |
| 5. Services | At least one active Laundry service and pricing method |
| 6. Add-ons | Optional express, stain, hanger, delicate handling, fragrance, pickup/delivery |
| 7. Policies | Due-date, cancellation, deposit, balance, pickup, issue, rewash, damage |
| 8. Payments | Cash baseline; KHQR readiness when configured; other methods disabled until approved |
| 9. Staff | Owner membership, at least one operational employee when physical Location is activated |
| 10. Documents | Receipt and Laundry tag template validation |
| 11. Notifications | Customer and staff notification preferences and consent rules |
| 12. Hub | Store Hub assignment and activation for physical operation |
| 13. Terminals | Assigned T1–T4 profiles and required peripherals |
| 14. Tests | Configuration publish, Hub sync, peripheral checks, test transaction |
| 15. Go-live | Evidence review and authorized approval |

### 7.3 Readiness state model

Each task uses:

- `not_started`
- `in_progress`
- `complete`
- `blocked`
- `failed`
- `stale`
- `optional`
- `skipped_with_reason`
- `not_applicable`

A task contains:

- task ID and version;
- required/optional rule;
- responsible role;
- source records;
- current evidence;
- last evaluated time;
- blocker reason;
- remediation route;
- expiry/revalidation rule.

### 7.4 Feature inventory

| ID | Feature | Requirement |
|---|---|---|
| `KPP-SETUP-001` | Guided Partner and Digital Store creation | Owner-locked Phase 1 capability |
| `KPP-SETUP-002` | Vertical selection before catalog | Must complete before service editor |
| `KPP-SETUP-003` | Resumable setup checklist | Autosave and continue later |
| `KPP-SETUP-004` | Readiness evidence | Derived from authoritative records and test results |
| `KPP-SETUP-005` | Online-only/private path | Physical provisioning may be deferred |
| `KPP-SETUP-006` | Physical provisioning handoff | Generate assignment/provisioning readiness, not device trust itself |
| `KPP-SETUP-007` | Go-live review | Clear blockers and authorization boundary |
| `KPP-SETUP-008` | Setup audit | Every completion, override, and skip is audited |

### 7.5 Acceptance criteria

- A Partner can complete Digital Store setup without a Store Hub.
- A physical Location cannot be marked operational until Hub-first provisioning and required tests pass.
- The Portal cannot mark readiness complete using demo values.
- A failed or stale task shows remediation and remains incomplete.
- Readiness overrides require permission, reason, expiry, and audit; safety/security blockers cannot be overridden by Partner roles.

---

## 8. Store configuration

### 8.1 Services and pricing

Phase 1 service pricing methods:

- per piece;
- per weight;
- flat price;
- add-on/surcharge;
- optional minimum charge when approved;
- effective-dated price books supported by Core, but Phase 1 UI remains simple.

Required service fields:

- service ID/code;
- Khmer and English names;
- description;
- pricing method;
- KHR price and optional USD display/price according to approved money policy;
- default turnaround;
- tax/fee treatment placeholder;
- active catalog state;
- current availability state;
- Location assignment;
- supported add-ons;
- document labels;
- version and publication state.

### 8.2 Configuration publication lifecycle

```text
draft
→ validation_failed | validated
→ approval_required | approved
→ publishing
→ active
→ partial_failure | failed
→ superseded
→ rolled_back
```

The Portal must distinguish:

- saved draft;
- cloud-approved version;
- projected-to-Hub version;
- Hub-acknowledged active version;
- channel projection version.

### 8.3 Service availability

Catalog existence and operational availability are separate.

Effective availability considers:

- catalog active state;
- Digital Store policy;
- Location enablement;
- emergency pause;
- scheduled pause;
- business hours/closure;
- capacity policy;
- Chain restriction when applicable later;
- latest Hub acknowledgment;
- channel projection status.

Required pause reasons:

- `machine_down`
- `staff_shortage`
- `supply_out`
- `power_issue`
- `water_issue`
- `capacity_full`
- `quality_issue`
- `safety_issue`
- `holiday_or_closure`
- `other`

### 8.4 Order rules and workflow

The Portal configures, but does not execute as local authority:

- accepted Laundry lifecycle states;
- due-date rules;
- deposit and pay-at-pickup policy;
- balance-before-release policy;
- cancellation rules;
- rewash and issue rules;
- damage/missing-item handling;
- notification triggers;
- consumable usage triggers;
- receipt and tag rules;
- pickup/delivery settings;
- approval thresholds.

### 8.5 Documents

Receipt and Laundry tag templates require:

- versioning;
- preview;
- Khmer/English text;
- Store identity;
- order and customer fields;
- payment/balance fields;
- due/pickup information;
- QR/barcode fields where approved;
- printer profile compatibility;
- publish and rollback history.

### 8.6 Feature inventory

| ID | Feature |
|---|---|
| `KPP-STORE-001` | Digital Store profile |
| `KPP-STORE-002` | Store Location profile |
| `KPP-STORE-003` | Business hours, holidays, and closures |
| `KPP-STORE-004` | Laundry service catalog |
| `KPP-STORE-005` | Per-piece/per-weight/flat pricing |
| `KPP-STORE-006` | Add-ons and special handling |
| `KPP-STORE-007` | Service availability and emergency pause |
| `KPP-STORE-008` | Order rules and workflow |
| `KPP-STORE-009` | Deposit and balance rules |
| `KPP-STORE-010` | Pickup and delivery rules |
| `KPP-STORE-011` | Receipt templates |
| `KPP-STORE-012` | Laundry tag templates |
| `KPP-STORE-013` | Payment method configuration |
| `KPP-STORE-014` | Notification configuration |
| `KPP-STORE-015` | Language and currency configuration |
| `KPP-STORE-016` | Configuration validation and preview |
| `KPP-STORE-017` | Versioned publication and rollback |
| `KPP-STORE-018` | Import/export foundation |

---

## 9. Laundry Order Center

### 9.1 Goal

Provide one evidence-rich, read-mostly management view of each Laundry Order across customer, services, garments, production, payment, fulfilment, notifications, and audit.

### 9.2 List views

- All
- New / Received
- In Production
- Due Today
- Overdue
- Ready
- Awaiting Pickup
- Balance Due
- Pickup / Delivery
- Issue
- Rewash
- Damaged
- Missing Garment
- Cancelled
- Completed

### 9.3 Order detail

The detail view includes:

- order identity and number;
- source/channel;
- customer and contact;
- services, quantities, weight, and add-ons;
- garment records and evidence;
- due and pickup/delivery information;
- operational status and timeline;
- staff and device actors;
- gross, discounts, refunds, net, paid, and balance;
- payment and receipt documents;
- issue, rewash, damage, and missing-item records;
- notification history;
- T3 storage assignment and T4 pickup evidence when available;
- sync/freshness and source status;
- immutable audit timeline.

### 9.4 Role-safe actions

The Portal may support cloud-authorized management actions only when contracts exist. Examples:

- add internal note;
- assign follow-up owner;
- request correction;
- request refund/void;
- approve or reject request according to capability;
- upload evidence;
- resend an approved notification;
- mark a cloud-side administrative review state.

The Portal cannot fabricate local completion or bypass T3/T4 custody actions.

### 9.5 Named/open Booking decision hold

`KLMF-LND-013 — Named/predefined open Bookings` remains unresolved. It must not be enabled in Phase 1 v2.0.0 until an owner decision defines:

- use case;
- creation and ownership;
- pricing lock;
- lifecycle and expiry;
- offline behavior;
- close/cancel rules;
- reporting and audit.

### 9.6 Feature inventory

| ID | Feature |
|---|---|
| `KPP-OPS-001` | Order Center with saved views |
| `KPP-OPS-002` | Order detail and unified timeline |
| `KPP-OPS-003` | Due and overdue queues |
| `KPP-OPS-004` | Ready and pickup monitoring |
| `KPP-OPS-005` | Production status monitoring |
| `KPP-OPS-006` | Issue, rewash, damage, and missing-item management |
| `KPP-OPS-007` | Pickup and delivery monitoring |
| `KPP-OPS-008` | Balance and payment context |
| `KPP-OPS-009` | Evidence and files |
| `KPP-OPS-010` | Notification history |
| `KPP-OPS-011` | Custody and terminal event visibility |
| `KPP-OPS-012` | Sync and source truth visibility |

---

## 10. Customers

### 10.1 Customer identity

Phase 1 uses phone-first customer identity with optional email and address. Identity linking and duplicate handling must be explicit and audited.

### 10.2 Customer detail

- profile and contact;
- preferred language;
- addresses;
- Laundry Order history;
- outstanding balances;
- notes;
- garment/service preferences;
- complaint and issue history;
- consent and notification preferences;
- activity timeline;
- source and freshness.

### 10.3 Duplicate review

Potential duplicates may be suggested, but merging requires:

- authorized role;
- preview of retained/combined data;
- conflict handling;
- audit;
- ability to trace original identities;
- no silent destructive merge.

### 10.4 Feature inventory

| ID | Feature |
|---|---|
| `KPP-CUST-001` | Customer directory |
| `KPP-CUST-002` | Phone-first profile |
| `KPP-CUST-003` | Order and payment history |
| `KPP-CUST-004` | Notes and preferences |
| `KPP-CUST-005` | Complaints and issue history |
| `KPP-CUST-006` | Consent and communication preferences |
| `KPP-CUST-007` | Duplicate review and merge workflow |
| `KPP-CUST-008` | Permission-controlled export |

### 10.5 Deferred customer scope

Deferred from v2.0.0 launch:

- B2B company hierarchy;
- full customer credit program;
- loyalty;
- campaigns;
- subscriptions;
- customer self-service portal;
- review/rating moderation.

---

## 11. Laundry consumables inventory

### 11.1 Scope

Inventory represents Partner-owned consumables and optional resale items, not customer garments.

Typical classes:

- detergent;
- softener;
- stain remover;
- chemicals;
- bags;
- hangers;
- receipt rolls;
- Laundry tag rolls;
- barcode labels;
- cleaning supplies;
- optional resale items.

### 11.2 Authoritative movement model

Current quantity is a projection. The movement ledger is audit truth.

Movement types include:

- opening;
- purchase receipt;
- usage;
- adjustment increase/decrease;
- count variance;
- waste/loss;
- transfer;
- return;
- correction/compensating movement.

Every manual movement requires actor, reason, timestamp, quantity, unit, and idempotency key.

### 11.3 Phase 1 launch scope

- stock item catalog;
- units and categories;
- current stock;
- minimum/reorder threshold;
- movement history;
- manual adjustment;
- physical count;
- variance review;
- consumable usage deduction;
- low-stock queue;
- waste/loss;
- files/evidence;
- audited import/export foundation.

### 11.4 Post-pilot flag

`consumables_purchasing` may enable:

- suppliers;
- supplier-item mappings;
- purchase orders;
- partial receiving;
- stock receipts;
- labels;
- direct low-stock-to-PO flow.

This depth must not block Phase 1 launch and must use neutral inventory contracts rather than retail hardcoding.

### 11.5 Feature inventory

| ID | Feature |
|---|---|
| `KPP-INV-001` | Consumables overview |
| `KPP-INV-002` | Stock item catalog |
| `KPP-INV-003` | Movement ledger |
| `KPP-INV-004` | Manual adjustments |
| `KPP-INV-005` | Physical counts and variance |
| `KPP-INV-006` | Usage deduction visibility |
| `KPP-INV-007` | Low-stock exceptions |
| `KPP-INV-008` | Waste/loss records |
| `KPP-INV-009` | Inventory files/evidence |
| `KPP-INV-010` | Import/export foundation |
| `KPP-INV-011` | Suppliers and purchase orders [post-pilot] |
| `KPP-INV-012` | Receiving [post-pilot] |

---

## 12. Employees and access

### 12.1 Staff onboarding workflow

```text
Create employee
→ assign Location
→ choose role/permission bundle
→ grant Portal membership if needed
→ create/reset POS PIN
→ assign terminal permissions
→ complete training checklist
→ supervised first action
→ activate
```

### 12.2 POS PIN rules

- 4–6 digits;
- raw PIN never stored or displayed;
- strong hash only;
- reject weak/common values according to policy;
- attempt throttling and lockout;
- reset/unlock requires capability and audit;
- Store Hub receives versioned permission/PIN cache;
- cloud suspension while Hub is offline is flagged for review after reconnect.

### 12.3 Phase 1 features

- employee profiles;
- active/suspended status;
- Location assignment;
- Portal membership;
- role and capability assignment;
- POS PIN create/reset/unlock;
- terminal permission bundles;
- time clock and time cards;
- attendance;
- staff activity;
- training checklist;
- shift and employee reports;
- sensitive-action approval limits.

### 12.4 Feature inventory

| ID | Feature |
|---|---|
| `KPP-EMP-001` | Employee directory |
| `KPP-EMP-002` | Employee detail and status |
| `KPP-EMP-003` | Roles and capability assignment |
| `KPP-EMP-004` | Portal membership management |
| `KPP-EMP-005` | POS PIN create/reset/unlock |
| `KPP-EMP-006` | Terminal permission assignment |
| `KPP-EMP-007` | Time clock and time cards |
| `KPP-EMP-008` | Attendance |
| `KPP-EMP-009` | Staff activity log |
| `KPP-EMP-010` | Training checklist |
| `KPP-EMP-011` | Shift and employee reports |
| `KPP-EMP-012` | Approval limits |

### 12.5 Deferred employee scope

- payroll processing;
- overtime engine;
- incentives;
- labor-cost accounting;
- advanced scheduling;
- AI staffing recommendations.

---

## 13. Finance and reconciliation

### 13.1 Boundary

KitLuy owns the authoritative operational finance subledger, liabilities, reconciliation, and accountant-ready exports/connectors. The Partner Portal is not initially a complete statutory ERP/general ledger.

### 13.2 Phase 1 finance views

- Finance Overview;
- Sales Ledger;
- Payment Ledger;
- Deposits and Balances;
- Cash and Shift summaries;
- Refunds and Voids;
- Reconciliation;
- Finance Documents;
- Export Center.

### 13.3 Truth requirements

Every financial amount shows:

- exact definition;
- source contract;
- date range/business date;
- currency;
- as-of timestamp;
- sync freshness;
- completeness;
- reconciliation state;
- drill-through to source records.

### 13.4 Refund and void lifecycle

```text
request
→ validate eligibility
→ preview affected lines and amounts
→ capture reason and evidence
→ approval if required
→ route to original payment method/provider when applicable
→ provider confirmation or failure
→ create append-only correction documents
→ update reconciliation
→ audit and notify
```

No destructive edit of the original payment or finalized transaction is permitted.

### 13.5 Reconciliation lifecycle

```text
not_started
→ preparing
→ exceptions_found
→ ready_for_review
→ completed
→ reopened_with_reason
```

Completion requires:

- orders versus sales ledger check;
- payments versus payment ledger check;
- deposit/balance check;
- cash expected versus counted check;
- refund/void check;
- KHQR/provider pending check;
- sync completeness check;
- unresolved exception acknowledgment according to policy;
- authorized confirmation and audit.

### 13.6 Business date and shift reporting

Phase 1 foundation includes business-date, tender, register, and closure reporting. Exact rollover and blind-count policy remain `[REQUIRED: owner-approved finance policy]` before production activation.

### 13.7 Feature inventory

| ID | Feature |
|---|---|
| `KPP-FIN-001` | Finance overview |
| `KPP-FIN-002` | Sales ledger |
| `KPP-FIN-003` | Payment ledger |
| `KPP-FIN-004` | Deposits and balances |
| `KPP-FIN-005` | Cash and shift summary |
| `KPP-FIN-006` | Refund and void workflow |
| `KPP-FIN-007` | Reconciliation workflow |
| `KPP-FIN-008` | Finance documents |
| `KPP-FIN-009` | Finance exports |
| `KPP-FIN-010` | Truth/freshness/completeness labels |
| `KPP-FIN-011` | Business-date and closure reporting foundation |

### 13.8 Rejected finance behavior

- offline card capture;
- rewriting finalized payments;
- silent cash-variance adjustment;
- presenting browser redirect as remote-payment confirmation;
- statutory tax filing;
- payroll;
- full general ledger;
- unlabeled estimates as actual profit or settled money.

---

## 14. Reports and exports

### 14.1 Phase 1 reports

- Daily Sales;
- Laundry Orders;
- Due and Overdue;
- Ready and Pickup;
- Payments;
- Deposits and Balances;
- Shifts;
- Cash Variance;
- Services;
- Customers;
- Issues/Rewash/Damage;
- Consumable Usage;
- Inventory Movements;
- Staff Activity;
- Employee Time;
- Finance Reconciliation.

### 14.2 Reporting rules

- reporting, analytics, history, exports, and data services are not commercially paywalled;
- security, privacy, fair-use performance, and abuse limits may apply;
- every report has source, as-of time, freshness, and completeness;
- charts drill through to records;
- export creation is an audited asynchronous job;
- export access expires according to policy;
- masked fields remain masked in exports unless the user has explicit capability;
- report presets do not grant additional access.

### 14.3 Feature inventory

| ID | Feature |
|---|---|
| `KPP-RPT-001` | Reports overview |
| `KPP-RPT-002` | Operations reports |
| `KPP-RPT-003` | Service reports |
| `KPP-RPT-004` | Customer reports |
| `KPP-RPT-005` | Inventory reports |
| `KPP-RPT-006` | Shift and employee reports |
| `KPP-RPT-007` | Finance reports |
| `KPP-RPT-008` | Saved filters/presets foundation |
| `KPP-RPT-009` | Export jobs and history |
| `KPP-RPT-010` | Source/freshness/completeness labels |

### 14.4 Deferred reports

Custom report builder and scheduled report delivery remain Phase 3/planning candidates and are not launch scope.

---

## 15. Store technology and provisioning

### 15.1 Partner-facing responsibility

The Portal manages Partner-visible assignment, readiness, and status. Device certificates, deep fleet operations, release control, and platform diagnostics remain Admin/Hub responsibilities.

### 15.2 Canonical provisioning sequence

```text
1. Create and configure Digital Store
2. Create optional Store Location
3. Assign and provision Store Hub
4. Hub completes initial cloud synchronization
5. Create terminal assignments in Partner Portal
6. Provision T1–T4 through active Hub
7. Validate peripherals and workflows
8. Run test transaction
9. Approve physical Store go-live
```

### 15.3 T1–T4 model

| Terminal | Canonical name | Portal-visible responsibility |
|---|---|---|
| T1 | POS Cashier / Intake | Assignment, readiness, version, peripherals, health |
| T2 | Customer Display Screen | T1 pairing, privacy, display state, payment-state health |
| T3 | Clean & Ready Scan-In | Assignment, readiness, storage/scan service health |
| T4 | Customer Pickup Scan-Out | Assignment, readiness, pickup/scan service health |

T3 and T4 may share a physical device but remain separate modes, permissions, workflows, and audit events.

### 15.4 Partner-visible health

- Hub assignment and activation;
- last heartbeat;
- last successful cloud sync;
- current/expected private endpoint metadata;
- certificate status;
- configuration version;
- software version/channel;
- terminal inventory and role assignments;
- peripheral test status;
- update status;
- sync queue summary;
- file cache status summary;
- diagnostic bundle request/consent;
- revoke/replace request.

### 15.5 Connection priority reference

```text
1. Assigned Hub private IP
2. Assigned Hub hostname
3. Automatic LAN discovery
4. Last successful Hub IP
5. Latest Hub IP reported through cloud
6. Manual IP override
```

IP identifies reachability, not trust. Trust requires Hub UUID, certificate, Tenant, Digital Store, and Location verification.

### 15.6 Feature inventory

| ID | Feature |
|---|---|
| `KPP-TECH-001` | Hub assignment and activation status |
| `KPP-TECH-002` | Terminal assignment and role profiles |
| `KPP-TECH-003` | T1–T4 readiness |
| `KPP-TECH-004` | Peripheral readiness |
| `KPP-TECH-005` | Sync and queue summary |
| `KPP-TECH-006` | Configuration version status |
| `KPP-TECH-007` | Software/update status |
| `KPP-TECH-008` | Certificate and trust status |
| `KPP-TECH-009` | Diagnostics and recovery guidance |
| `KPP-TECH-010` | Revoke/replace request |

---

## 16. Integration Hub foundation

### 16.1 Boundary

Connectors use governed Connector API contracts, mappings, scopes, signatures, jobs, retries, and audit. They never receive direct production-database access and never become KitLuy source of truth.

### 16.2 Phase 1 Portal features

- connector catalog;
- eligibility/status;
- declared capabilities and scopes;
- consent and policy version;
- credential metadata without raw secrets;
- test/live status;
- compatibility state;
- mapping status;
- last successful sync;
- sync jobs;
- item-level errors;
- safe retry;
- pause/resume;
- disconnect with authorization;
- audit history.

### 16.3 Connector lifecycle

- `disconnected`
- `eligibility_pending`
- `eligible`
- `application_submitted`
- `provisioning`
- `connected`
- `paused`
- `error`
- `revoked`

### 16.4 Launch policy

The framework and disabled connector registry may ship in v2.0.0. No external connector is active without:

- approved connector contract;
- scope and mapping review;
- credentials;
- security and privacy approval;
- sandbox tests;
- retry and reconciliation behavior;
- support ownership;
- feature flag/entitlement;
- owner-approved go-live.

### 16.5 Feature inventory

| ID | Feature |
|---|---|
| `KPP-INT-001` | Connector catalog |
| `KPP-INT-002` | Eligibility and consent |
| `KPP-INT-003` | Connection wizard |
| `KPP-INT-004` | Connection detail |
| `KPP-INT-005` | Mapping status |
| `KPP-INT-006` | Sync jobs and failures |
| `KPP-INT-007` | Safe retry/pause/resume |
| `KPP-INT-008` | Disconnect/revoke workflow |
| `KPP-INT-009` | Connector audit |

---

## 17. Files, notifications, audit, support, and AI

### 17.1 Files

File classes include:

- garment photos;
- issue, rewash, and damage evidence;
- inventory receipts and evidence;
- receipt and Laundry tag PDFs;
- finance/export documents;
- support diagnostic bundles;
- knowledge-base and RAG source files when enabled.

DigitalOcean Spaces stores bytes. Supabase stores metadata, ownership, permissions, and audit. Store Hub stores operational files and thumbnails required for offline Store operation.

### 17.2 Notifications

Supported event classes include:

- order received;
- due reminder;
- ready for pickup;
- balance due;
- pickup completed;
- delivery status;
- issue/rewash update;
- low stock;
- staff alert;
- sync/device alert.

Templates, consent, suppression, provider status, delivery truth, retries, and audit belong to Notification Service. The Portal configures and reads scoped status.

### 17.3 Audit

Audit records include:

- actor/user;
- role/capability;
- device/session where relevant;
- Tenant, Digital Store, and Location;
- action;
- target entity;
- reason;
- before/after or referenced versions;
- correlation/idempotency key;
- timestamp;
- source surface;
- result.

Audit is immutable to Partner roles.

### 17.4 Support

Support access requires:

- Partner consent;
- reason;
- scope;
- time limit;
- visible session banner;
- immutable audit;
- automatic expiry/revocation.

### 17.5 AI

AI is optional and must be:

- provider-agnostic;
- permission-scoped;
- source-grounded;
- freshness-aware;
- logged;
- human-confirmed for sensitive actions;
- unable to present generated content as authoritative truth.

Phase 1 AI may summarize authorized records and explain anomalies. It cannot independently execute finance, permission, compliance, safety, or connector actions.

---

## 18. Data and contract requirements

### 18.1 Existing read contracts to preserve

The v1.1.0 baseline identifies these accepted Partner read contracts:

- `partner_store_memberships`
- `partner_orders_read`
- `partner_customers_read`
- `partner_services_read`
- `partner_service_addons_read`

They remain compatibility inputs until repository and migration evidence establishes exact replacements.

### 18.2 Required v2 contract families

| Contract family | Minimum responsibility |
|---|---|
| Partner context | Tenant, Digital Store, Location, membership, role, capabilities |
| Readiness | Tasks, evidence, blockers, state, revalidation |
| Catalog/configuration | Services, prices, add-ons, availability, rules, templates, publication versions |
| Orders | Order summary/detail, garments, status history, payments, fulfilment, custody, files |
| Customers | Profile, contacts, history, balance, notes, consent, duplicates |
| Inventory | Items, levels, movements, counts, adjustments, usage, low stock |
| Employees | Profiles, memberships, roles, capabilities, PIN status, time cards, activity |
| Finance | Sales, payments, deposits, balances, cash, refunds/voids, reconciliation |
| Reports | Definitions, rows, summaries, freshness, export jobs |
| Store technology | Hub, devices, roles, heartbeats, versions, queues, tests, certificates |
| Integrations | Connector registry, connections, mappings, jobs, errors, audit |
| Files | Metadata, signed upload/download, confirmation, retention, access |
| Notifications | Templates/settings, consent, delivery status, retry summary |
| Audit | Store-scoped immutable event reads |

### 18.3 API surface boundaries

- **Management API:** Partner Portal and approved back-office management contracts.
- **Commerce Store API:** public/customer commerce; Phase 3 except explicitly approved Laundry beta subset.
- **Edge Operations API:** Store Hub/POS/device sync and operational commands.
- **Connector API:** external-channel projection and ingress.

The Partner Portal must not collapse or bypass these boundaries.

### 18.4 Write rules

All writes must be:

- scoped;
- authorized;
- versioned;
- idempotent where retry is possible;
- audited;
- validation-driven;
- retry-safe;
- non-destructive for finalized records;
- explicit about downstream publication/sync status.

### 18.5 Source-state envelope

Sensitive API responses should expose an equivalent of:

```json
{
  "source": "authoritative_read_model",
  "as_of": "2026-07-24T12:00:00+07:00",
  "freshness": "fresh",
  "completeness": "complete",
  "reconciliation_status": "reconciled",
  "data": {}
}
```

Exact schema is `[REQUIRED: API contract approval]`, but the semantics are mandatory.

---

## 19. Security and privacy requirements

### 19.1 Isolation

Every query and mutation must enforce:

- Tenant isolation;
- Digital Store isolation;
- Location isolation;
- user membership;
- role/capability;
- device identity where relevant;
- vertical and feature entitlement.

### 19.2 Sensitive fields

Mask or withhold according to capability:

- customer contact information;
- payment/provider references;
- bank/settlement metadata;
- cost and margin;
- employee personal information;
- support diagnostic data;
- raw connector payloads;
- secrets and credentials.

### 19.3 Session requirements

- Supabase Auth or approved replacement;
- short-lived sessions and refresh policy;
- secure cookies/tokens;
- CSRF protection where applicable;
- session revocation;
- login and sensitive-action logging;
- no raw secret in browser storage;
- support sessions separately identified.

### 19.4 Privacy depth decision

`KLMF-CUS-006 — privacy workflow depth` remains one of the optional-depth owner decisions. Phase 1 must still provide baseline consent, access control, export auditing, and secure deletion/retention rules where legally required. Optional self-service privacy tooling remains gated.

---

## 20. Offline and degraded behavior

### 20.1 Portal offline boundary

The PWA may cache:

- static shell;
- localization bundles;
- approved last-successful read snapshots;
- non-sensitive user preferences.

It does not gain offline mutation authority for finance, configuration, inventory, permissions, or operations.

### 20.2 Required states

| State | UI behavior |
|---|---|
| Fresh | Normal display with as-of time |
| Pending sync | Display pending badge and known scope |
| Stale | Warning, age, and refresh/recovery path |
| Offline browser | Read-only cached shell/snapshot where permitted |
| Hub unreachable | Explicit Local Store technology warning; do not imply Store is stopped if status is unknown |
| Partial | Render available sections and identify missing sources |
| Unavailable | Fail closed; no invented data |
| Reconciliation incomplete | Finance pages show unresolved state prominently |
| Configuration pending | Show saved/published/Hub-acknowledged distinction |

### 20.3 Recovery

Safe recovery actions may include:

- refresh status;
- re-run an idempotent read or job;
- request configuration republish;
- request diagnostic bundle;
- open support session;
- download/export known records;
- display manual operational fallback guidance.

The Portal cannot force unsafe local mutations during uncertainty.

---

## 21. Non-functional requirements

### 21.1 Technology

Target stack:

- React Web/PWA;
- strict TypeScript;
- approved router/build framework from live repository;
- Supabase Auth/PostgreSQL/RLS/Realtime/metadata/audit;
- DigitalOcean application hosting, workers, Spaces, AI/MCP/RAG, and releases;
- shared KitLuy design-system packages;
- no heavy-file primary storage in Supabase Storage.

Exact package versions and repository paths are `[REQUIRED: repository inspection]`.

### 21.2 Performance objectives

Final budgets require measured pilot evidence. Initial targets:

- primary route shell interactive on standard Cambodian 4G within `[REQUIRED: approved budget]`;
- common table filter response within `[REQUIRED]` for approved dataset size;
- pagination for large datasets;
- background export for large records;
- no unbounded client-side fetches;
- no dashboard dependency on all modules succeeding;
- lazy-load heavy charts and editors.

### 21.3 Accessibility

- keyboard navigation;
- visible focus;
- semantic headings and labels;
- adequate contrast;
- status not communicated by color alone;
- screen-reader-compatible form validation;
- accessible dialogs/drawers;
- Khmer font and text rendering validation.

### 21.4 Reliability

- idempotent retries;
- no duplicate financial or inventory effects;
- optimistic UI only when contract semantics permit and rollback is clear;
- explicit background-job state;
- correlation IDs for support;
- structured logs without secrets/PII leakage.

### 21.5 Browser/PWA support

Exact support matrix is `[REQUIRED: owner and QA approval]`. At minimum, current Chromium-based desktop browsers and supported mobile browsers must be tested. The app shell may install as PWA but remains cloud-managed.

---

## 22. Feature flags and entitlements

### 22.1 Always-on Phase 1 foundations

- Digital Store setup;
- Laundry vertical;
- core Store configuration;
- customer management;
- order monitoring;
- consumables inventory core;
- employee and PIN core;
- finance/reconciliation core when authoritative contracts pass;
- reporting/export core;
- Store technology status;
- security/audit;
- disabled Integration Hub registry.

### 22.2 Optional flags

| Flag | Purpose | Default |
|---|---|---|
| `digital_store_readiness_v1` | Setup/readiness workflow | On after contract approval |
| `catalog_import_v2` | Validated service import UX | Off until post-pilot |
| `consumables_purchasing` | Suppliers/PO/receiving | Off until post-pilot |
| `laundry_shift_close_v2` | Enhanced shift close and blind-count policy | Off until finance policy approval |
| `partner_ai_summary` | Grounded AI summaries | Off until AI governance/tests |
| `integration_hub_registry` | Connector catalog and disabled registry | On when contracts exist |
| `connector_<name>` | Specific connector | Off until connector approval |
| `laundry_online_booking_beta` | Minimal approved online Laundry Booking subset | Off; owner-approved pilot only |
| `guest_booking_status` | Guest status/receipt access | Off; privacy/security approval required |

### 22.3 Entitlement rules

Feature flags do not replace permission checks. Entitlements do not override vertical, security, legal, provider, or readiness gates.

---

## 23. Phase 1 scope decisions

### 23.1 Mandatory v2.0.0 launch scope

- Digital Store-first onboarding and vertical selection;
- setup/readiness checklist;
- Action Center;
- Laundry services, pricing, add-ons, policies, hours, documents, payments;
- service availability and emergency pause;
- Laundry Order Center and exception monitoring;
- customer directory/history;
- consumables and movement ledger;
- employee, role, PIN, time-card, and activity core;
- authoritative Finance and reconciliation when contracts pass;
- core reports and exports;
- Store Hub and T1–T4 readiness/status;
- sync/freshness/fail-closed UI;
- files, notifications configuration, audit, security, support;
- disabled Integration Hub foundation.

### 23.2 Post-pilot or v2.1 scope

- supplier management;
- purchase orders and receiving;
- advanced validated imports;
- inventory labels;
- advanced waste analysis;
- employee scheduling/workload;
- expenses and B2B statements when contracts mature;
- report presets and advanced exports;
- approved AI explanations;
- approved connector sandbox.

### 23.3 Explicitly excluded from v2.0.0

- Restaurant setup, menus, KDS, floor plans, checks, tabs, tips, and kitchen workflows;
- full Storefront, cart, checkout, themes, domains, and commerce analytics;
- bulk retail product editor;
- international markets/duties;
- subscriptions;
- gift cards/store credit;
- full ERP/general ledger/payroll;
- public extension marketplace;
- Laundry Production Display as a new product;
- named/open Bookings before owner decision;
- offline card capture;
- direct connector database access.

---

## 24. Delivery gates

### G0 — Authority

Required:

- owner approval of this specification;
- conflict register updated;
- Digital Store/Location terminology approved;
- T1–T4 corrections accepted;
- Phase 1 scope and exclusions confirmed;
- unresolved decisions explicitly gated.

### G1 — Contract

Required:

- schema delta;
- API and event contracts;
- read-model truth envelopes;
- state machines;
- RBAC and RLS;
- audit model;
- Store Hub/offline impact;
- feature flags/entitlements;
- migration/rollback plan;
- documentation plan.

### G2 — Build

Required:

- code;
- migrations and seeds;
- UI routes/components;
- jobs/workers;
- automated unit/component/contract tests;
- localization;
- feature flags;
- observability hooks.

### G3 — Integrated verification

Required:

- cross-product contract tests;
- Store Hub and T1–T4 integration;
- offline/reconnect tests;
- RLS/tenant isolation;
- payment/inventory reconciliation;
- file and notification tests;
- performance and recovery;
- no duplicate business effects.

### G4 — Pilot readiness

Required:

- monitoring and alerts;
- migration and rollback rehearsal;
- support and diagnostic procedures;
- hardware matrix;
- training;
- go-live checklist;
- approved pilot Store;
- data retention/privacy review.

### G5 — Phase exit / Rebuild Test

Required:

- approved pilot evidence;
- production or controlled go-live evidence;
- one qualified engineer can reconstruct and operate the Portal from current documentation, migrations, contracts, deployment instructions, and runbooks;
- Rebuild and Business Bibles updated;
- no capability marked implemented without evidence.

---

## 25. QA acceptance matrix

| ID | Scenario | Required result |
|---|---|---|
| `QA-KPP2-001` | Create Partner and Digital Store | Laundry Digital Store created with correct Tenant isolation |
| `QA-KPP2-002` | Attempt catalog setup before vertical | Blocked until Laundry selected |
| `QA-KPP2-003` | Online-only setup | Digital Store can remain private/online-only without Hub |
| `QA-KPP2-004` | Readiness with missing payment config | Task blocked; score/status not falsely complete |
| `QA-KPP2-005` | Readiness stale evidence | Task becomes stale and requires revalidation |
| `QA-KPP2-006` | Publish service config | Draft validates, publishes, and shows downstream acknowledgment separately |
| `QA-KPP2-007` | Emergency service pause | Authorized action requires reason and shows downstream state |
| `QA-KPP2-008` | Unauthorized Store access | RLS/API reject with no data leakage |
| `QA-KPP2-009` | Dashboard partial outage | Available modules render; unavailable module is explicit |
| `QA-KPP2-010` | Zero versus unavailable finance | Authoritative zero displays as zero; missing contract displays unavailable |
| `QA-KPP2-011` | Order timeline | Displays status, payment, custody, files, notification, actor, source, and freshness |
| `QA-KPP2-012` | Attempt Portal pickup completion | Rejected; T4 remains required local authority |
| `QA-KPP2-013` | Customer duplicate merge | Preview, permission, conflict handling, and audit pass |
| `QA-KPP2-014` | Inventory adjustment replay | Idempotency prevents duplicate movement |
| `QA-KPP2-015` | Inventory count variance | Variance posts append-only movements with reason |
| `QA-KPP2-016` | PIN reset | Raw PIN never displayed/stored; cache version updates; audit recorded |
| `QA-KPP2-017` | Cross-role finance access | Supervisor/readonly restricted according to capability |
| `QA-KPP2-018` | Refund request/approval | Reason/evidence/approval and append-only corrections pass |
| `QA-KPP2-019` | Reconciliation incomplete sync | Completion blocked or explicitly governed; never silently complete |
| `QA-KPP2-020` | Report export | Store scoped, audited, UTF-8, correct masking, expiring download |
| `QA-KPP2-021` | Hub offline | Portal shows unknown/stale without declaring Store stopped |
| `QA-KPP2-022` | T1–T4 assignment | T2 is CDS, T3 scan-in, T4 scan-out; no old mapping remains |
| `QA-KPP2-023` | Terminal self-role escalation | Rejected; assignment is authoritative and certificate-bound |
| `QA-KPP2-024` | Connector credential display | No raw credential rendered |
| `QA-KPP2-025` | Connector retry | Safe, scoped, idempotent, audited retry |
| `QA-KPP2-026` | Support session | Consent, banner, expiry, scope, and audit pass |
| `QA-KPP2-027` | Khmer layout | No clipping; forms/tables usable |
| `QA-KPP2-028` | Cached PWA read | Clearly labeled cached/as-of; no offline mutation |
| `QA-KPP2-029` | Sensitive AI request | AI cannot execute without authorized human confirmation |
| `QA-KPP2-030` | Phase 2/3 route access | Disabled routes absent or return feature-disabled without leakage |

---

## 26. Go-live checklist

- [ ] Owner-approved v2.0.0 scope and decisions recorded.
- [ ] Exact repository framework and package versions recorded.
- [ ] Applied migration set documented and validated.
- [ ] Digital Store and Location terminology reconciled across Suite docs.
- [ ] Every old T2/T3 reference removed or clearly marked superseded.
- [ ] T1–T4 permissions and audit tested.
- [ ] Readiness checklist uses authoritative evidence.
- [ ] Finance modules fail closed until validated contracts exist.
- [ ] Inventory movement ledger and idempotency pass.
- [ ] RLS and cross-Store isolation tests pass.
- [ ] Support consent and session expiry pass.
- [ ] File upload/download, retention, and access tests pass.
- [ ] Notification consent/delivery status tests pass.
- [ ] Hub, terminal, peripheral, sync, and configuration status tested.
- [ ] Khmer and English QA pass.
- [ ] KHR/USD formatting and calculations pass.
- [ ] Export audit and masking pass.
- [ ] Monitoring and alerting active.
- [ ] Backup/restore and rollback rehearsal completed.
- [ ] Pilot runbook and training approved.
- [ ] Rebuild and Business Bibles updated.
- [ ] No planning-only capability labeled implemented.

---

## 27. Documentation changes required

This specification requires updates to:

- KitLuy Suite Rebuild Bible;
- KitLuy Suite Business Bible;
- Partner Portal Rebuild Bible;
- Partner App Rebuild Bible;
- Admin Portal Rebuild Bible;
- Chain Portal Rebuild Bible;
- Store Hub and Device Provisioning specifications;
- POS Desktop T1–T4 specification;
- canonical schema/data dictionary;
- Management and Edge API contracts;
- event/job registries;
- RBAC matrix;
- finance/reconciliation rules;
- inventory movement rules;
- report definitions;
- File and Notification Service specifications;
- QA and go-live documents;
- decision and reconciliation register.

---

## 28. Source-to-feature traceability summary

| Source decision/capability | v2.0.0 treatment |
|---|---|
| Digital Store control plane | Core product model and setup workflow |
| Guided Partner/Digital Store creation | `KPP-SETUP-001` |
| Vertical selection before catalog | `KPP-SETUP-002` |
| Online-only Digital Store launch | `KPP-SETUP-005` |
| Digital Store setup checklist | `KPP-SETUP-003/004` |
| Partner back office | Entire product boundary |
| Shift and employee reports | `KPP-RPT-006`, `KPP-EMP-011` |
| Staff onboarding and PIN | `KPP-EMP-001`–`012` |
| Business-date/tender/register/closure reporting | `KPP-FIN-011` |
| Data freshness/completeness/authority labels | Shared components and all sensitive modules |
| Included unlimited reporting/data services | Section 14 policy |
| Operational finance subledger, not full ERP | Section 13 boundary |
| T1–T4 owner lock | Section 15 and QA coverage |
| Smartphone-simple provisioning | Section 15 sequence and trust model |
| Store Hub local authority | Product principles and degraded-state rules |
| Versioned publication/rollback | `KPP-STORE-016/017` |
| Exception-first manager usability | Home/Action Center and module queues |
| WooCommerce guided/status patterns | Setup, readiness, system status, timelines |
| Loyverse interaction economy | Staff/PIN, inventory, simple back-office workflows |
| Lightspeed import/purchasing lessons | Post-pilot validated import and purchasing flags |
| Toast cash/approval/business-day lessons | Finance foundation without Restaurant scope |
| Shopify setup checklist/readiness blockers | Evidence-backed setup workflow |

---

## 29. Open decisions and required values

The following remain unresolved and must not be silently guessed:

| ID | Decision/value |
|---|---|
| `OD-001` | Exact repository path, router mode, package versions, and build commands |
| `OD-002` | Final design tokens, font stack, and Figma source IDs |
| `OD-003` | Digital Store handle/domain behavior before Phase 3 Storefront |
| `OD-004` | Required versus optional readiness checks and override authority |
| `OD-005` | Business-date rollover, register close, and blind-count policy |
| `OD-006` | Final POS PIN length, lockout threshold, and recovery policy |
| `OD-007` | KHQR provider contracts, test/live handling, and settlement fields |
| `OD-008` | Refund/void thresholds and approval limits |
| `OD-009` | Finance completeness and reconciliation completion rules during delayed sync |
| `OD-010` | Data retention and privacy workflow depth |
| `OD-011` | Exact Phase 1 supplier/PO pilot entry criteria |
| `OD-012` | Named/open Booking decision (`KLMF-LND-013`) |
| `OD-013` | Laundry online Booking beta scope and payment/deposit policy |
| `OD-014` | Approved connector list and support ownership |
| `OD-015` | Browser support and performance budgets |
| `OD-016` | AI provider, cost limits, evaluation thresholds, and enabled tools |

---

## 30. Version history

| Version | Date | Change summary |
|---|---|---|
| v2.0.0 | 2026-07-24 | Upgraded Partner Portal to Digital Store-first Phase 1 Laundry specification; corrected T1–T4 and provisioning model; added evidence-backed readiness, Action Center, truth/freshness system, versioned configuration publication, Store technology area, master-registry traceability, delivery gates, and explicit Phase 2/3 exclusions. |
| v1.1.0 baseline | 2026-07-13 | One-store Partner PWA rebuild baseline with store management, operations, customers, inventory, employees, finance, reports, Integration Hub, and fail-closed truth rules. |

---

## Final acceptance statement

This specification is acceptable as the Phase 1 Partner Portal target only when:

1. the project owner approves the scope and open-decision handling;
2. all superseded Digital Store/Location and T1–T4 conflicts are reconciled;
3. contracts, migrations, permissions, offline boundaries, and QA are approved;
4. implementation evidence is kept separate from planning status;
5. one qualified engineer can use the resulting approved documents, migrations, API contracts, deployment instructions, and tests to reconstruct and operate the product.
