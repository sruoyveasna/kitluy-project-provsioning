# KitLuy Chain Portal — Phase 1 Laundry Product Specification

**Filename:** `kitluy-chain-portal-phase1-spec-v3.0.0.md`  
**Version:** v3.0.0  
**Date:** 2026-07-25  
**Product:** `kitluy-chain-portal` / `kitluy-chain-pwa-portal`  
**Vertical:** Phase 1 — Laundry  
**Owner:** HET / KitLuy Suite project owner  
**Audience:** Product owner, product manager, UI/UX designers, frontend engineers, backend engineers, data engineers, QA, DevOps, support, implementation operators, and approved AI handoff agents  
**Status:** Canonical target product specification; not implementation evidence  
**Supersedes for Phase 1 product design:** `kitluy-chain-portal-rebuild-bible-v2.0.0.md` where this specification changes terminology, hierarchy, route ownership, T1–T4 awareness, freshness rules, or Phase 1 scope  
**Primary market:** Cambodia  
**Primary languages:** Khmer and English  
**Currencies:** KHR and USD; KHR is the default display and reporting currency unless an authoritative source record states otherwise  
**Timezone:** `Asia/Phnom_Penh`

> **Mission:** Give a Laundry chain, brand owner, franchise HQ, or multi-location operator one authoritative governance and comparison surface across its Digital Stores and Store Locations without turning Chain Portal into a POS, Partner back office, statutory ERP, or second source of operational truth.

---

## 0. Specification authority and evidence discipline

### 0.1 Authority order

This specification applies the following precedence:

1. Current project-owner decisions and the current KitLuy Project Instructions.
2. Applied migrations, verified repository code/tests, deployment evidence, and production evidence.
3. Current KitLuy Rebuild and Business Bibles.
4. Approved product handoffs and source traceability registries.
5. Evidence-based competitor analyses and product classifications.
6. Competitor rebuild/clone documents as design references only.
7. Superseded planning.

No competitor-derived feature, clone schema, route, threshold, pricing model, or infrastructure choice becomes KitLuy product truth unless adopted by a KitLuy authority source.

### 0.2 Source baseline

| Source | Authority used in this specification |
|---|---|
| Current KitLuy Project Instructions | Locked vertical roadmap, one Store/one primary vertical, Digital-First model, shared Core, infrastructure, offline, finance, API, safety, localization, evidence, and completion rules. |
| `KitLuy Suite Project.txt` | Digital Store-first sequence; Digital Store/Store Location separation; one Digital Store may support multiple Locations; four governed API surfaces; versioned events/jobs; safe deployment; channel authority. |
| `kitluy-concept-design-1.txt` | Owner-locked Laundry T1–T4 model: T1 Intake/Cashier, T2 Customer Display Screen, T3 Clean & Ready Scan-In, T4 Pickup Scan-Out. |
| `Device Management & Provisioning System.txt` | Owner-locked Hub-first smartphone-simple provisioning, certificate trust, LAN discovery, terminal assignment, and recovery fallback. |
| `Project Instruction Writing.txt` | React/PWA, Supabase/DigitalOcean split, Electron/Linux ARM64 edge clients, Store Hub authority, local operational files, signed releases, staged rollout, A/B rollback. |
| `kitluy-chain-portal-rebuild-bible-v2.0.0.md` | Existing Chain scope: master catalog, availability, standards, compliance, franchise, royalties, B2B, reporting, RBAC, audit, APIs, QA, recovery, and go-live controls. |
| `kitluy-suite-rebuild-bible-v3.0.0.md` | Shared ecosystem architecture and product boundaries, treated as approved target where not superseded by later owner locks. |
| `kitluy-suite-ecosystem-business-bible-v1.0.0.md` | Business positioning, operating model, chain value proposition, commercial unknowns, continuity, and successor controls. |
| `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md` | Store-level back-office boundary, fail-closed read models, finance truth labeling, Integration Hub boundary, and Partner responsibilities. |
| `kitluy-partner-app-rebuild-bible-v1.1.0.md` | Owner/manager mobile cockpit boundary, last-known cache, freshness labeling, and human confirmation. |
| `kitluy-master-feature-registry-v0.2.*` | Canonical capability normalization, owner, earliest phase, authority, disposition, and cross-competitor traceability. |
| `kitluy-owner-decision-lock-12-capabilities-v1.0.md` | Layered moderation authority, operational finance subledger boundary, API access policy, deferred public marketplace, payment guardrails, and reporting/analytics no-paywall rule. |
| WooCommerce comparison/classification/backlog | Preserve Chain governance, one Digital Store with multiple Locations, Chain reporting, centralized policy; no WordPress/runtime dependency. |
| Loyverse comparison/classification | Faster Store/region switching, high-signal comparisons, freshness badges, and exception-first Chain reporting while preserving deeper KitLuy governance. |
| Lightspeed comparison/classification/backlog | Multi-location comparison and exception views; per-Location freshness; targeted publication and partial-failure visibility as reusable future depth. |
| Toast comparison/classification/backlog | Future Phase 2 menu/location governance and versioned publication patterns; no Restaurant behavior is activated in this Phase 1 specification. |
| Shopify comparison/classification/backlog | Chain consumes approved multi-Store publication, Location comparison, customer/B2B governance, and reporting contracts without becoming a commerce source of truth. |

### 0.3 Evidence status rule

This document describes **target behavior**. It must not be labeled `IMPLEMENTED` until repository paths, applied migrations, executable tests, deployment records, and environment evidence prove the claim.

Every `[REQUIRED: ...]` value is intentionally unresolved and must not be guessed by engineering or AI.

---

## 1. v3.0.0 upgrade statement

### 1.1 Why v3 is a major version

The v2 product model centered Chain governance on physical Stores. v3 changes the authoritative hierarchy to the Digital-First model:

```text
Tenant / Partner Account
  └── Chain governance context
       ├── Digital Store A — Laundry
       │    ├── Store Location A1
       │    │    └── Store Hub → T1 / T2 / T3 / T4 and peripherals
       │    └── Store Location A2
       │         └── Store Hub → T1 / T2 / T3 / T4 and peripherals
       └── Digital Store B — Laundry, when separately created and authorized
            └── Store Locations...
```

This changes:

- entity hierarchy and route parameters;
- navigation and context selection;
- RLS and role scoping;
- publication targets;
- reporting dimensions;
- sync/freshness treatment;
- Hub and terminal visibility;
- audit context;
- migration requirements;
- product terminology.

### 1.2 v2 → v3 product deltas

| Area | v2 baseline | v3 Phase 1 requirement |
|---|---|---|
| Business hierarchy | Chain → Stores/Branches | Chain → Digital Stores → Store Locations; Branch is a UI alias for Location. |
| Store identity | Store often meant physical shop | Digital Store is the control plane; Store Location is the physical edge. |
| Vertical rule | One Store/one vertical | One Digital Store/one primary vertical; Phase 1 Chain context only admits Laundry Digital Stores. |
| Terminal awareness | Older or incomplete terminal assumptions | T1–T4 names and boundaries are authoritative. |
| Device visibility | Store/Hub/POS health | Location → Hub → assigned terminal profiles, versions, health, and last synchronization. |
| Reporting | Branch totals and comparison | Multi-location exception-first comparison with freshness, completeness, authority, and drill-through. |
| Publication | Catalog push to Stores | Versioned Digital Store policy published to selected Locations; each Hub acknowledges apply state. |
| Grouping | Branch groups | Phase 1 supports explicit saved groups and selected-location targets; generalized reusable publication targeting is a Phase 2 candidate. |
| Availability | Store emergency pause | Location emergency pause remains local operational authority; Chain governs policy, visibility, exceptions, and escalation. |
| PWA offline behavior | Static shell/read-only | No offline mutation; any cached data is visibly last-known and never presented as live. |
| Reporting commercial policy | Previously unresolved packaging | Reporting, exports, history, analytics, and data services cannot be commercially paywalled. |

---

## 2. Product definition

### 2.1 What KitLuy Chain Portal is

KitLuy Chain Portal is the cloud PWA for authorized chain, brand, regional, franchise, finance, compliance, and analysis users to govern multiple Laundry Digital Stores and Store Locations.

It owns:

- Chain profile and governance structure;
- authorized Digital Store and Location network views;
- Chain master Laundry catalog policy;
- price guardrails and local-exception policy;
- versioned publication and rollback governance;
- Location service-availability visibility and policy;
- brand standards;
- compliance foundation;
- multi-location comparison and exception views;
- Chain reports and exports;
- Chain-scoped RBAC and audit;
- read-only Hub/T1–T4 health visibility;
- Chain AI BI under permission, source, freshness, and confirmation controls.

### 2.2 What it is not

Chain Portal is not:

- a POS or Booking-entry surface;
- a Store Hub or offline store runtime;
- a replacement for Partner Portal or Partner App;
- a terminal provisioning authority owned by installers;
- a direct production-database administration console;
- a statutory accounting/general-ledger system;
- a payment capture surface for store transactions;
- a connector runtime or arbitrary plugin host;
- a public storefront;
- a generic horizontal multi-industry admin that mixes active vertical workflows.

### 2.3 Phase 1 success outcomes

A Phase 1 pilot succeeds when an authorized Chain user can:

1. View all authorized Laundry Digital Stores and Store Locations.
2. Identify stale, offline, blocked, partially configured, and exception Locations immediately.
3. Compare comparable Location metrics without treating partial data as complete truth.
4. Create and publish a versioned Laundry catalog policy.
5. Preview and publish that version to selected Locations.
6. See each Hub acknowledge, apply, reject, or remain pending.
7. Roll back safely without deleting historical assignments.
8. Govern price floors/ceilings and approval-required exceptions.
9. See and govern Location emergency service pauses without removing local emergency authority.
10. Publish brand standards and monitor acknowledgement.
11. Export authoritative Chain reports without commercial paywall.
12. Prove every sensitive action through immutable audit.
13. Pass cross-Tenant, cross-Chain, cross-Digital-Store, cross-Location, and role-isolation tests.
14. Reconstruct the product from approved documentation and contracts.

---

## 3. Canonical hierarchy and terminology

### 3.1 Entity hierarchy

| Entity | Definition | Chain Portal treatment |
|---|---|---|
| Tenant | Backend account/isolation boundary. | Resolved from authenticated session; never chosen by arbitrary URL input. |
| Partner Account | Business-facing account that operates Digital Stores. | Displayed where useful; Partner product owns Store-level administration. |
| Chain | Governance container for a brand, branch network, or franchise organization. | Primary application context. |
| Digital Store | Business, brand, catalog, customer, policy, and channel control plane; exactly one primary vertical. | Chain may govern one or more authorized Laundry Digital Stores. |
| Store Location | Physical shop/edge environment belonging to a Digital Store. | Main comparison, health, availability, and publication target. |
| Branch | Business-facing alias for Store Location in Chain UI. | May appear in friendly labels, but contracts use `location_id`. |
| Store Hub | Local authority for a Store Location after provisioning. | Read-only health, version, sync, and deployment acknowledgement. |
| Terminal Profile | Permissioned role assigned to a terminal. | Read-only visibility; Chain cannot self-assign operational roles. |
| T1 | POS Cashier / Intake Terminal. | Health/readiness visibility only. |
| T2 | Customer Display Screen. | Health/readiness visibility only; never treated as KDS or production screen. |
| T3 | Clean & Ready Scan-In Terminal. | Health and custody-flow exception visibility only. |
| T4 | Customer Pickup Scan-Out Terminal. | Health and custody-flow exception visibility only. |
| Digital Channel | Website, marketplace, delivery, or connector governed by Digital Store. | Read connector/channel status where authorized; no external channel owns truth. |

### 3.2 Vertical enforcement

- Each Digital Store has exactly one primary vertical.
- This specification supports `laundry` only.
- A Chain may display only authorized Laundry Digital Stores in active Phase 1 routes.
- Future Restaurant, eCommerce, Convenience, Pharmacy, Department Store, Grocery, and Supermarket fields must not be hardcoded into Phase 1 Laundry screens.
- Shared components must use neutral labels internally and vertical adapters for Laundry-specific display.

### 3.3 Authority boundaries

| Decision/data | Authority |
|---|---|
| Tenant and Chain provisioning | Admin Portal / authorized platform operator |
| Digital Store creation and primary vertical | Partner/Admin workflow under Core contracts |
| Location provisioning and Hub activation | Admin/Partner + Device Management workflow |
| Chain membership/linkage | Admin provisioning plus Chain acceptance where policy allows |
| Master catalog policy | Chain Portal |
| Effective Location catalog | Chain policy + approved local exception + active availability + Hub-applied projection |
| Emergency service pause | Authorized Store/Location actor; Chain may also act only where policy grants it |
| POS Booking/payment writes | T1/Store Hub and authorized store surfaces |
| Ready Scan-In | T3 only |
| Pickup Scan-Out | T4 only |
| Chain reports | Reporting read models with freshness/completeness labels |
| Financial truth | Authoritative operational finance subledger; Chain Portal is read/export only for Phase 1 |
| Connector truth | KitLuy Integration Hub/Connector API; external channels never own authoritative customer, inventory, payment, or finance truth |

---

## 4. Users, roles, and context

### 4.1 Phase 1 roles

| Role | Default scope | Core responsibility |
|---|---|---|
| `chain_owner` | Entire Chain | Full Chain governance, team, publication, standards, reports, audit, sensitive approvals. |
| `chain_manager` | Entire Chain or assigned Digital Stores | Catalog, standards, availability governance, operational comparison, reports. |
| `regional_manager` | Assigned saved groups/Locations | Location health, comparisons, availability, standards, corrective follow-up. |
| `finance_manager` | Entire Chain or assigned Digital Stores | Finance/report views and exports; no catalog mutation by default. |
| `catalog_manager` | Assigned Digital Stores | Catalog draft, validation, publication preview; publish only if explicitly granted. |
| `compliance_manager` | Entire Chain or assigned groups | Standards, checklists, assignments, findings, and corrective action governance. |
| `field_auditor` | Assigned audits/Locations | Audit execution and evidence; no unrelated Chain mutation. |
| `chain_analyst` | Authorized read scope | Reports, comparisons, exports, AI read queries. |
| `chain_readonly` | Authorized read scope | Read-only dashboard and reports; no exports unless explicitly granted. |

### 4.2 Context selector

The application shell must always show:

- active Chain;
- active Digital Store filter: All authorized or one selected;
- active Location group/filter;
- reporting period;
- timezone;
- data freshness summary;
- active vertical badge: Laundry.

A context change must:

1. update the URL;
2. update query keys and cache scope;
3. revalidate permissions server-side;
4. clear incompatible selected rows/actions;
5. preserve only safe filters;
6. emit a context-view audit event for sensitive modules where required.

### 4.3 Deep-link rule

Deep links must contain opaque IDs, but the backend must independently verify:

- Tenant membership;
- Chain membership;
- Digital Store linkage;
- Location linkage;
- role capability;
- record state;
- feature flag/phase entitlement.

A guessed ID must return `403` or `404` without leaking existence.

---

## 5. Application shell and information architecture

### 5.1 Primary navigation

| Group | Route | Phase 1 state |
|---|---|---|
| Overview | `/overview` | Required |
| Action Center | `/actions` | Required |
| Digital Stores | `/digital-stores` | Required |
| Locations | `/locations` | Required |
| Compare | `/compare` | Required |
| Catalog | `/catalog` | Required |
| Publication | `/publication` | Required |
| Availability | `/availability` | Required |
| Standards | `/standards` | Required |
| Compliance | `/compliance` | Foundation |
| Reports | `/reports` | Required |
| Hub & Devices | `/fleet` | Required read-only Chain scope |
| AI Chain BI | `/ai` | Optional, read-only initial scope |
| Integrations | `/integrations` | Readiness/status only |
| Team & Access | `/team` | Required |
| Audit | `/audit` | Required |
| Settings | `/settings` | Required |

### 5.2 Detailed route inventory

#### Overview and action center

- `/overview`
- `/overview/daily-summary`
- `/overview/alerts`
- `/actions`
- `/actions/catalog`
- `/actions/availability`
- `/actions/standards`
- `/actions/sync`
- `/actions/compliance`

#### Digital Stores

- `/digital-stores`
- `/digital-stores/:digitalStoreId`
- `/digital-stores/:digitalStoreId/locations`
- `/digital-stores/:digitalStoreId/catalog-policy`
- `/digital-stores/:digitalStoreId/publication`
- `/digital-stores/:digitalStoreId/reports`

#### Locations

- `/locations`
- `/locations/:locationId`
- `/locations/:locationId/operations`
- `/locations/:locationId/availability`
- `/locations/:locationId/catalog`
- `/locations/:locationId/standards`
- `/locations/:locationId/fleet`
- `/locations/:locationId/audit`
- `/locations/sync-health`

#### Comparison

- `/compare`
- `/compare/operations`
- `/compare/services`
- `/compare/turnaround`
- `/compare/issues`
- `/compare/payments`
- `/compare/availability`
- `/compare/freshness`

#### Catalog and publication

- `/catalog/services`
- `/catalog/add-ons`
- `/catalog/pricing`
- `/catalog/guardrails`
- `/catalog/versions`
- `/catalog/exceptions`
- `/publication/preview`
- `/publication/deployments`
- `/publication/deployments/:deploymentId`
- `/publication/rollbacks`

#### Availability and standards

- `/availability/matrix`
- `/availability/pauses`
- `/availability/policies`
- `/availability/history`
- `/standards`
- `/standards/receipt`
- `/standards/tags`
- `/standards/workflow`
- `/standards/quality`
- `/standards/pricing-rules`
- `/standards/hours`
- `/standards/exceptions`

#### Compliance foundation

- `/compliance/checklists`
- `/compliance/assignments`
- `/compliance/audits`
- `/compliance/findings`
- `/compliance/actions`
- `/compliance/evidence`

#### Reports

- `/reports/bookings`
- `/reports/sales`
- `/reports/payments`
- `/reports/services`
- `/reports/turnaround`
- `/reports/ready-aging`
- `/reports/issues`
- `/reports/rewash-damage`
- `/reports/pickup-delivery`
- `/reports/capacity`
- `/reports/availability`
- `/reports/catalog-adoption`
- `/reports/fleet-health`
- `/reports/exports`

#### Operations and governance

- `/fleet/hubs`
- `/fleet/terminals`
- `/fleet/releases`
- `/fleet/exceptions`
- `/ai/overview`
- `/ai/location-insights`
- `/ai/catalog-insights`
- `/ai/compliance-risk`
- `/ai/request-log`
- `/integrations`
- `/integrations/channels`
- `/integrations/payments`
- `/integrations/notifications`
- `/integrations/status`
- `/team`
- `/team/roles`
- `/team/invites`
- `/team/scopes`
- `/team/activity`
- `/audit`
- `/audit/catalog`
- `/audit/availability`
- `/audit/standards`
- `/audit/reports`
- `/audit/security`
- `/settings/profile`
- `/settings/brand`
- `/settings/notifications`
- `/settings/security`

### 5.3 Future-gated routes

The following may be scaffolded but must remain hidden/disabled until their phase gate is approved:

- `/franchisees/*`
- `/agreements/*`
- `/territories/*`
- `/royalties/*`
- `/b2b/*`
- `/promotions/*`
- `/loyalty/*`
- `/moderation/*`
- Restaurant menu/location governance routes
- Retail transfer/distribution routes

---

## 6. Phase 1 module specifications

## 6.1 Overview

### Purpose

Provide a high-signal Chain summary focused on exceptions and freshness, not decorative totals.

### Required widgets

1. Locations operational now.
2. Locations stale/offline/unknown.
3. Hubs requiring attention.
4. T1–T4 profile health exceptions.
5. Catalog publication pending/failed.
6. Active emergency service pauses.
7. Overdue Laundry Bookings.
8. Ready-for-pickup aging.
9. Rewash/damage/issues trend.
10. Payment/reconciliation exceptions when authoritative data exists.
11. Compliance actions due.
12. Recent sensitive activity.

### Truth rules

- Every card shows `as_of`, freshness, completeness, and source.
- A stale Location is not counted as zero.
- A partially synchronized period is labeled partial.
- Finance cards remain unavailable rather than fabricated when the authoritative read model is missing.
- Currency aggregation is allowed only under approved currency/FX rules.

### Main components

- `ChainContextHeader`
- `FreshnessSummaryBanner`
- `ExceptionKpiCard`
- `LocationStatusMapOrList`
- `ActionQueuePanel`
- `PublicationHealthPanel`
- `AvailabilityPausePanel`
- `LaundryOperationsTrend`
- `DataAuthorityPopover`

---

## 6.2 Action Center

### Purpose

Unify approval-required and exception work across the Chain.

### Action types

- catalog exception review;
- publication failure review;
- emergency pause expiry/escalation;
- standards exception review;
- stale Location review;
- Hub/terminal version exception;
- compliance finding review;
- export failure;
- AI-drafted action awaiting human confirmation.

### Required fields

| Field | Rule |
|---|---|
| Action type | Stable enum. |
| Severity | `info`, `warning`, `high`, `critical`. |
| Scope | Chain, Digital Store, Location, or deployment. |
| Source | Authoritative subsystem. |
| Created/due | Server timestamps. |
| Assignee | Optional role/user. |
| Required capability | Server-enforced permission. |
| Status | `open`, `acknowledged`, `in_progress`, `resolved`, `dismissed`. |
| Resolution | Reason and evidence where required. |

Bulk resolve is prohibited for financial, compliance-critical, security, or safety actions.

---

## 6.3 Digital Store directory

### Purpose

Show each authorized Laundry Digital Store as a control-plane entity, distinct from its physical Locations.

### List columns

- Digital Store name and code;
- primary vertical;
- status/readiness;
- number of active Locations;
- active catalog version;
- publication health;
- availability exceptions;
- latest synchronized operational time;
- connected channels summary;
- owner/Partner account;
- actions permitted to the current role.

### Detail tabs

- Summary;
- Locations;
- Catalog policy;
- Pricing guardrails;
- Publication history;
- Standards;
- Reports;
- Audit.

### Guardrails

- Chain Portal cannot change the primary vertical.
- Chain Portal cannot create an unverified Tenant or bypass Partner/Admin onboarding.
- A Digital Store from another vertical must not appear in Laundry-only comparison widgets.

---

## 6.4 Location directory and detail

### Purpose

Provide an operationally useful but non-invasive view of every physical Location.

### List behavior

- fast search by name, code, city, region, Partner, Hub ID, or status;
- sticky Chain/Digital Store/group filters;
- saved views;
- sortable exception columns;
- row-level freshness badge;
- vertical-aware metric columns;
- no silent fallback to cached values.

### Location detail tabs

1. Summary.
2. Laundry operations.
3. Service availability.
4. Effective catalog/pricing.
5. Standards compliance.
6. Hub and terminals.
7. Reports.
8. Audit.

### Location summary fields

- Digital Store;
- address and timezone;
- ownership/operation type;
- operating status;
- Hub status and last heartbeat;
- last cloud synchronization;
- assigned terminal profiles;
- active catalog assignment;
- active pauses;
- open issues;
- current data completeness.

---

## 6.5 Multi-location comparison and exception views

### Purpose

Adopt clearer comparative UX while preserving KitLuy authority and vertical-specific definitions.

### Comparison dimensions

- Digital Store;
- Location;
- saved group/region;
- ownership type;
- service category;
- date/business period;
- sync state;
- catalog version;
- availability state.

### Core Phase 1 metrics

- Booking count;
- gross billed;
- paid amount and outstanding balance when authoritative;
- average Booking value;
- service mix;
- average turnaround;
- on-time completion rate;
- overdue count;
- ready-for-pickup aging;
- rewash rate;
- damage/issue rate;
- pickup/delivery completion;
- emergency pause duration;
- catalog adoption;
- Hub/terminal availability;
- data freshness.

### Comparison rules

- Each row displays freshness and completeness.
- Incomparable rows are blocked or clearly separated.
- Rank only where all included metrics use compatible definitions.
- Missing data is `unavailable`, not zero.
- Drill-through must preserve the active scope and period.
- Export includes the metric dictionary version and freshness metadata.

---

## 6.6 Master Laundry catalog

### Scope

- service categories;
- services;
- per-piece, per-weight, and flat pricing methods;
- unit definitions;
- add-ons;
- turnaround standards;
- service display names in Khmer/English;
- handling rules;
- evidence requirements;
- active/inactive state;
- version notes.

### Catalog ownership

- Chain owns master policy and immutable versions.
- Digital Store/Location receives assignments.
- Partner may request permitted exceptions.
- POS and channels consume effective projections; they do not edit Chain master truth.

### Version lifecycle

```text
draft → validating → ready → published → superseded
                       └────→ rejected
```

Published/superseded versions are immutable. Corrections require a new version.

### Catalog editor components

- `CatalogVersionHeader`
- `ServiceCategoryTree`
- `ServiceTable`
- `ServiceEditorDrawer`
- `PricingMethodEditor`
- `AddonMatrix`
- `LocalizationEditor`
- `ValidationIssuesPanel`
- `VersionDiffViewer`
- `PublishPreviewButton`

---

## 6.7 Pricing guardrails and exceptions

### Phase 1 capabilities

- base price policy in KHR/USD where approved;
- allowed pricing method;
- minimum/maximum local price;
- fixed/locked or locally editable mode;
- approval-required exceptions;
- effective dates;
- reason codes;
- expiry;
- immutable decision history.

### Effective price rule

```text
Chain catalog price policy
+ approved local exception valid for Location and time
+ applicable Digital Store/Location price book
= effective price projection
```

The exact calculation contract must be versioned and tested with canonical vectors. No UI-only calculation is authoritative.

### Exception states

```text
draft → submitted → under_review → approved → active → expired
                         └────────→ rejected
active → revoked
```

No pending request changes the effective Location projection.

---

## 6.8 Publication and deployment governance

### Purpose

Safely project approved catalog/standard configuration to Store Hubs.

### Phase 1 target selection

- all Locations in one Digital Store;
- manually selected Locations;
- existing explicitly managed saved group where the data contract is approved.

Dynamic generalized grouping and reusable publication targeting remains a Phase 2 candidate even if the Phase 1 UI supports saved explicit selections.

### Publication workflow

1. Select immutable version.
2. Select Digital Store and target Locations.
3. Generate preview.
4. Validate vertical, permissions, Hub compatibility, active pauses, pending exceptions, and stale status.
5. Display blocked, warned, and eligible targets.
6. Require reason and confirmation.
7. Create idempotent deployment batch.
8. Deliver through approved Management → Edge projection path.
9. Track each Location: queued, delivered, acknowledged, applied, rejected, failed, rolled back.
10. Keep partial failure visible.
11. Allow approved rollback by Location or batch.

### Publication states

```text
batch: draft → previewed → queued → running → completed | partial | failed | cancelled

target: queued → delivered → acknowledged → applied
                         ├──────→ rejected
                         └──────→ failed
applied → rollback_queued → rolled_back | rollback_failed
```

### Required components

- `PublicationTargetSelector`
- `CompatibilityCheckPanel`
- `TargetOutcomeTable`
- `DeploymentTimeline`
- `RetryFailedTargetsAction`
- `RollbackWizard`
- `HubAcknowledgementBadge`

---

## 6.9 Service availability governance

### Core rule

A Location may temporarily disable a service for operational reasons. Chain Portal governs policy, visibility, escalation, and authorized intervention but must not remove the Store’s emergency control.

### Reason codes

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

### Effective availability

```text
Chain service enabled
AND Digital Store service published
AND Location service enabled
AND no active emergency pause
AND effective date/time valid
AND Hub has accepted a compatible projection
= available for new Booking selection
```

### Required behaviors

- pause requires reason and expected expiry;
- high-risk/safety reasons may require immediate escalation;
- expired pause does not silently reactivate if policy requires review;
- Chain matrix shows current reason, actor, start, expiry, and freshness;
- T1 and digital channels must reject new selection when effective availability is false;
- existing Bookings remain governed by their original committed terms unless an authorized workflow changes them;
- re-enable and extension are audited.

---

## 6.10 Brand standards

### Standard families

- receipt format;
- Laundry tag format;
- customer-facing terminology;
- workflow milestones;
- quality checklist;
- service promise and due-date rules;
- pricing display rules;
- business hours presentation;
- pickup/delivery presentation;
- evidence requirements;
- issue/rewash/damage handling guidance.

### Standard lifecycle

```text
draft → review → published → superseded → archived
```

Published versions are immutable. Local exceptions require policy, reason, scope, expiry, approval, and audit.

### Location acknowledgement

Each relevant Location/Hub must expose:

- target standard version;
- delivered time;
- acknowledgement;
- apply status;
- exception state;
- last verified time.

---

## 6.11 Compliance foundation

Phase 1 includes the data and UI foundation needed to operate basic Laundry compliance without claiming legal/regulatory completeness.

### Included

- versioned checklist templates;
- weighted items;
- critical-fail items;
- Location assignments;
- evidence links;
- draft/submitted audit state;
- findings;
- corrective actions;
- due dates and ownership;
- Chain comparison of open actions.

### Deferred depth

- advanced territory scheduling;
- full field tablet offline mutation;
- regulated pharmacy compliance;
- legal certification workflows;
- automated penalties;
- franchise royalty coupling.

### Compliance truth rule

KitLuy may support internal standards and evidence. It must not claim legal certification or replace qualified human judgment.

---

## 6.12 Chain reports and exports

### Required report families

| Report | Minimum dimensions |
|---|---|
| Booking report | Digital Store, Location, service, status, date, source |
| Sales/gross billed | Digital Store, Location, service, currency, period |
| Payments | Location, tender, status, period, reconciliation state |
| Outstanding balances | Location, aging bucket, status |
| Service performance | service, add-on, pricing method, Location |
| Turnaround | promised vs actual, service, Location |
| Ready aging | time since Ready, Location, storage state |
| Issues/rewash/damage | type, severity, service, Location |
| Pickup/delivery | method, status, timeliness, Location |
| Capacity | configured/used capacity, period, Location |
| Availability downtime | service, reason, duration, Location |
| Catalog adoption | version, target state, Location |
| Fleet health | Hub/terminal profile/version/status |
| Audit activity | actor, action, scope, period |

### Reporting policy

- No sales-history, export, analytics, retention, or data-service paywall.
- Security, privacy, fair-use performance, and abuse controls may apply.
- Export jobs must be idempotent, auditable, permission-scoped, and expire signed URLs.
- Every export carries source/as-of/freshness/completeness metadata.
- Financial reports are operational subledger views, not statutory statements.

---

## 6.13 Hub and T1–T4 fleet visibility

### Scope

Chain Portal reads authorized aggregate health only. Device registration, certificate issuance, terminal assignment, release signing, and remote privileged operations remain Admin/Partner/Device Management responsibilities.

### Hub fields

- Location;
- Hub UUID;
- certificate status;
- software version/channel;
- last heartbeat;
- last successful cloud sync;
- pending queue age/count;
- local storage health;
- current catalog/standard projection versions;
- last deployment acknowledgement;
- connectivity state.

### Terminal fields

- terminal ID/name;
- assigned profile: T1, T2, T3, T4, or approved combined physical profile;
- device certificate state;
- app version;
- last heartbeat;
- last successful Hub connection;
- peripherals summary where available;
- update status;
- health exception.

### Prohibited Chain actions

- assigning itself elevated terminal roles;
- changing device certificates;
- bypassing Hub identity verification;
- issuing arbitrary shell commands;
- presenting last cloud heartbeat as proof that the LAN workflow is healthy.

---

## 6.14 Integrations status

### Phase 1 behavior

- display connector/channel status;
- display last successful synchronization where authoritative;
- display configuration ownership and support contact;
- link to permitted Partner/Admin configuration surfaces;
- show disabled/future/degraded states honestly;
- never expose raw credentials.

### API boundary

Chain Portal consumes the Management API. It does not directly call private connector databases or the production database with service-role credentials from the browser.

---

## 6.15 AI Chain BI

### Initial scope

Read-only, permission-scoped analysis:

- summarize Location exceptions;
- explain metric variance using cited sources;
- identify stale or incomplete data;
- summarize catalog adoption;
- summarize availability downtime;
- draft a corrective-action proposal;
- draft a management summary.

### Mandatory controls

- source citations;
- source timestamps/freshness;
- actor and scope in every request;
- tool allowlist;
- prompt/tool/output audit;
- no silent mutation;
- explicit human confirmation for any future action;
- no unauthorized cross-Chain retrieval;
- unavailable state when authoritative sources are missing.

---

## 7. Shared component inventory

### 7.1 Application shell

| Component | Responsibility |
|---|---|
| `ChainAppShell` | Responsive layout, route guard, navigation, active context. |
| `ChainContextSwitcher` | Chain/Digital Store/Location group selection with permission revalidation. |
| `VerticalBadge` | Displays active `Laundry` vertical. |
| `GlobalPeriodSelector` | Applies compatible reporting period. |
| `GlobalFreshnessIndicator` | Summarizes fresh/stale/partial/unknown Locations. |
| `GlobalSearch` | Search Digital Stores, Locations, deployments, standards, and audit records. |
| `UserCapabilityMenu` | Shows only authorized actions and account options. |

### 7.2 Data truth and status

| Component | Responsibility |
|---|---|
| `FreshnessBadge` | `live`, `fresh`, `stale`, `offline`, `unknown`, `partial`. |
| `AuthorityBadge` | Identifies source of truth/read model. |
| `CompletenessBadge` | Complete/partial/missing/incompatible. |
| `AsOfTimestamp` | Explicit source time. |
| `DegradedModeBanner` | Explains missing subsystem and affected actions. |
| `UnavailableState` | Replaces fabricated zero/empty data. |
| `LastKnownDataBanner` | Clearly labels cached, browse-only values. |

### 7.3 Tables and comparison

| Component | Responsibility |
|---|---|
| `ChainDataTable` | Dense accessible table with column chooser and saved views. |
| `LocationFilterBar` | Digital Store, group, Location, status, and search filters. |
| `MetricDefinitionPopover` | Formula, source, exclusions, currency, freshness. |
| `VarianceCell` | Value, comparison baseline, direction, significance. |
| `ExceptionRowMarker` | High-signal status without color-only communication. |
| `DrillThroughLink` | Preserves scope, period, and metric definition. |
| `ExportMenu` | Permission-aware audited export action. |

### 7.4 Governance actions

| Component | Responsibility |
|---|---|
| `SensitiveActionDialog` | Target, impact, reason, permission, audit preview. |
| `ApprovalDecisionPanel` | Approve/reject/request changes with reason. |
| `VersionDiffViewer` | Compare immutable versions. |
| `ScopeImpactPreview` | Show Digital Stores/Locations affected. |
| `IdempotencyStatus` | Prevent duplicate action submission. |
| `AuditTrailDrawer` | Actor, role, before/after, reason, source, time. |

### 7.5 Laundry-specific components

| Component | Responsibility |
|---|---|
| `LaundryServiceMethodBadge` | Per-piece, per-weight, flat. |
| `TurnaroundStandardEditor` | Standard duration and exception policy. |
| `ReadyAgingBucketChart` | Ready-for-pickup aging by Location. |
| `IssueRewashDamageSummary` | Laundry quality exception metrics. |
| `TerminalProfileHealth` | T1–T4 profile status and last seen. |
| `AvailabilityMatrix` | Service × Location effective availability. |

---

## 8. Critical workflows

## 8.1 First Chain login and readiness

1. Authenticate through Supabase Auth.
2. Resolve session context server-side.
3. Select or auto-select authorized Chain.
4. Load Digital Store and Location linkage.
5. Validate active Laundry vertical scope.
6. Display readiness checklist:
   - Chain profile;
   - authorized Digital Stores;
   - active Locations;
   - Hub connectivity;
   - team roles;
   - catalog version;
   - publication status;
   - reporting read models;
   - notification configuration.
7. Block only material actions; do not fabricate readiness.

## 8.2 Create and publish a catalog version

1. Create draft from current published version or approved template.
2. Edit services/add-ons/pricing/turnaround/localized labels.
3. Validate required fields and pricing rules.
4. Save immutable candidate snapshot for preview.
5. Select target Digital Store/Locations.
6. Run compatibility/freshness/exception preview.
7. Resolve blockers or acknowledge warnings where policy allows.
8. Confirm with reason.
9. Create idempotent deployment batch.
10. Track per-Location acknowledgement/application.
11. Notify affected users.
12. Preserve all outcomes and audit.

## 8.3 Partial publication failure

1. Batch enters `partial` when one or more targets fail.
2. Applied targets remain active unless policy requires batch-wide rollback.
3. Failed targets show error class and retry eligibility.
4. Retry creates a new attempt linked to the original target.
5. Rollback is explicit, permissioned, and audited.
6. Dashboard and Action Center remain open until resolved/accepted.

## 8.4 Location emergency pause

1. Authorized Store or Chain actor selects service and Location.
2. Enter reason, expected expiry, note, and evidence if required.
3. Backend validates scope and current effective service.
4. Create append-only override event.
5. Hub/POS projection updates; T1 blocks new selection.
6. Chain matrix and alerts update with freshness.
7. Re-enable, extend, or expire through a separate audited action.

## 8.5 Compare Location performance

1. Choose metric set, period, Digital Store, and Locations/group.
2. Backend returns standardized read model plus freshness/completeness.
3. UI separates incompatible currencies/definitions.
4. User sorts or filters exception rows.
5. Drill-through preserves exact filters.
6. Export includes metric dictionary and data status.

## 8.6 Review a price exception

1. Partner submits allowed request.
2. Chain reviewer opens Action Center item.
3. View current policy, requested value, guardrail, reason, evidence, and impact.
4. Approve, reject, or request changes.
5. Approved request gets effective dates/expiry and new projection.
6. Decision is immutable and audited.

## 8.7 Investigate stale Location

1. Freshness monitor flags threshold breach.
2. Overview and Location row display stale/offline, never zero.
3. Reviewer opens Hub/terminal detail.
4. View last heartbeat, last sync, pending queue age, release status, and known incident.
5. Link to authorized support workflow; Chain Portal does not perform privileged device control.
6. Resolution closes the action with evidence.

---

## 9. State machines

### 9.1 Digital Store Chain linkage

```text
pending → active → suspended → removed
    └────→ rejected
```

Linkage changes require Admin/Core authority where provisioning rules demand it.

### 9.2 Catalog version

```text
draft → validating → ready → published → superseded → archived
                  └──────→ rejected
```

### 9.3 Publication batch and target

See §6.8. Published assignments are never destructively replaced; a new assignment supersedes the prior record.

### 9.4 Availability override

```text
draft → active → resolved
             ├→ expired
             └→ revoked
```

### 9.5 Standard version

```text
draft → review → published → superseded → archived
```

### 9.6 Compliance audit

```text
assigned → accepted → in_progress → submitted → reviewed → closed
                              └────→ rejected_for_completion
```

### 9.7 Corrective action

```text
open → acknowledged → in_progress → submitted_for_verification → verified → closed
                                                └──────────────→ rejected
open/in_progress → waived only with authorized reason and audit
```

### 9.8 Export job

```text
queued → running → completed
             ├──→ failed → retry_queued
             └──→ cancelled
```

---

## 10. Data model and read-model requirements

### 10.1 Shared Core references

The exact physical schema is migration-authoritative. This specification requires logical contracts for:

- `tenants`
- `partner_accounts`
- `chains`
- `chain_memberships`
- `digital_stores`
- `digital_store_verticals`
- `store_locations`
- `digital_store_location_links`
- users, roles, permissions, and scoped assignments
- devices, certificates, Hubs, terminals, profiles
- transactions/Bookings, lines, payments, refunds, adjustments
- sync cursors, heartbeats, projection versions
- files, notifications, jobs, events, audit, AI requests

### 10.2 Chain-owned logical tables

| Logical table | Purpose |
|---|---|
| `kitluy_chain.chains` | Chain profile and lifecycle. |
| `kitluy_chain.chain_digital_stores` | Authorized Digital Store linkage. |
| `kitluy_chain.chain_locations` | Authorized Location linkage and business-facing metadata. |
| `kitluy_chain.location_groups` | Explicit saved group definitions/memberships. |
| `kitluy_chain.chain_user_roles` | Chain-scoped role assignments. |
| `kitluy_chain.master_services` | Chain Laundry service policy records. |
| `kitluy_chain.master_service_addons` | Chain add-on definitions. |
| `kitluy_chain.catalog_versions` | Immutable version snapshots. |
| `kitluy_chain.catalog_publication_batches` | Publication headers. |
| `kitluy_chain.catalog_publication_targets` | Per-Location outcomes. |
| `kitluy_chain.catalog_location_assignments` | Current/historical effective assignment. |
| `kitluy_chain.price_guardrails` | Min/max/locked/local-edit policy. |
| `kitluy_chain.catalog_exception_requests` | Local exception request/decision lifecycle. |
| `kitluy_chain.location_service_availability_overrides` | Temporary availability changes. |
| `kitluy_chain.effective_location_services` | Materialized/read model only; derivable from authoritative inputs. |
| `kitluy_chain.brand_standards` | Versioned standards. |
| `kitluy_chain.standard_publication_targets` | Per-Location standard deployment state. |
| `kitluy_chain.compliance_templates` | Versioned checklist definitions. |
| `kitluy_chain.compliance_assignments` | Location/auditor schedules. |
| `kitluy_chain.compliance_audits` | Audit headers/results. |
| `kitluy_chain.compliance_answers` | Item answers/evidence links. |
| `kitluy_chain.corrective_actions` | Findings and resolution lifecycle. |
| `kitluy_chain.saved_views` | User-scoped filter/column definitions. |
| `kitluy_chain.action_items` | Unified exception/approval queue. |

### 10.3 Required read models

- `chain_overview_read`
- `chain_digital_store_summary_read`
- `chain_location_summary_read`
- `chain_location_comparison_read`
- `chain_location_freshness_read`
- `chain_laundry_operations_read`
- `chain_catalog_adoption_read`
- `chain_availability_matrix_read`
- `chain_fleet_health_read`
- `chain_booking_report_read`
- `chain_sales_payment_report_read`
- `chain_issue_quality_report_read`

Each read model must expose:

- source system/view version;
- `as_of`;
- freshness state;
- completeness state;
- included Location count;
- excluded Location IDs/reasons where permitted;
- currency and metric definition version;
- reconciliation status where applicable.

### 10.4 Data constraints

- All authoritative relationships are relational.
- JSON may hold optional display metadata, not primary authority.
- Finalized financial, payment, inventory, publication, and audit records are append-only or corrected by compensating records.
- Location quantity or financial values never use generic last-write-wins conflict resolution.
- Every tenant-scoped table has enforced Tenant isolation.
- Every Chain-scoped row has enforced Chain membership/scope.
- Every Location-targeted row validates Digital Store and Chain linkage.

---

## 11. APIs, events, and jobs

### 11.1 API surface usage

| API surface | Chain Portal usage |
|---|---|
| Management API | Primary browser/backend contract for Chain reads and governed mutations. |
| Commerce Store API | Not a Chain Portal management dependency in Phase 1. |
| Edge Operations API | Used by backend/Hub projection path; browser never bypasses trust boundary. |
| Connector API | Read connector status and approved projections only. |

### 11.2 Phase 1 endpoint families

| Endpoint family | Purpose |
|---|---|
| `GET /v1/chain/session-context` | Actor, Chain, scopes, permissions, flags. |
| `GET /v1/chain/overview` | Overview and exception summary. |
| `GET /v1/chain/digital-stores` | Authorized Digital Store directory. |
| `GET /v1/chain/locations` | Location list, health, freshness. |
| `POST /v1/chain/locations/compare` | Standardized comparison read. |
| `POST /v1/chain/catalog/versions` | Create draft/version. |
| `POST /v1/chain/catalog/versions/:id/validate` | Validate candidate. |
| `POST /v1/chain/publications/preview` | Preview targets/blockers/warnings. |
| `POST /v1/chain/publications` | Create idempotent publication. |
| `POST /v1/chain/publications/:id/retry` | Retry eligible failed targets. |
| `POST /v1/chain/publications/:id/rollback` | Create audited rollback. |
| `GET /v1/chain/availability` | Availability matrix/history. |
| `POST /v1/chain/availability/overrides` | Authorized pause/re-enable action. |
| `POST /v1/chain/catalog-exceptions/:id/decision` | Approve/reject/request changes. |
| `POST /v1/chain/standards` | Create/publish versioned standard. |
| `GET /v1/chain/reports/:reportKey` | Read report with metadata. |
| `POST /v1/chain/exports` | Queue audited export. |
| `GET /v1/chain/fleet` | Authorized aggregate Hub/terminal health. |
| `GET /v1/chain/audit` | Scoped immutable audit query. |
| `POST /v1/chain/ai/query` | Permission-scoped read-only AI query. |

### 11.3 Contract rules

- calendar or semantic versioning is mandatory;
- mutations require idempotency keys;
- retries are safe;
- errors use stable codes;
- actor/scope are derived server-side;
- pagination uses stable cursor contracts;
- exports and heavy comparisons run as durable jobs;
- request and response schemas are documented and contract-tested;
- no browser service-role key;
- no connector direct production-database access.

### 11.4 Domain events

Minimum event set:

- `chain.digital_store_linked.v1`
- `chain.location_linked.v1`
- `chain.catalog_version_created.v1`
- `chain.catalog_version_published.v1`
- `chain.publication_started.v1`
- `chain.publication_target_applied.v1`
- `chain.publication_target_failed.v1`
- `chain.publication_partial.v1`
- `chain.publication_rollback_requested.v1`
- `chain.publication_target_rolled_back.v1`
- `location.service_paused.v1`
- `location.service_reenabled.v1`
- `chain.catalog_exception_submitted.v1`
- `chain.catalog_exception_decided.v1`
- `chain.standard_published.v1`
- `chain.compliance_audit_submitted.v1`
- `chain.corrective_action_updated.v1`
- `chain.export_completed.v1`
- `chain.ai_request_completed.v1`

Events must be tenant-scoped, versioned, idempotent, auditable, and retry-safe.

### 11.5 Durable jobs

- publication delivery;
- publication retry;
- rollback delivery;
- read-model refresh;
- report export;
- notification delivery;
- standard projection;
- compliance reminder/escalation;
- AI/RAG indexing when enabled.

Every job exposes status, attempts, next retry, last error, dead-letter state, and correlation ID.

---

## 12. Security, permissions, and audit

### 12.1 Permission principles

- deny by default;
- least privilege;
- scope by Tenant, Chain, Digital Store, Location group, and Location;
- sensitive actions require fresh server authorization;
- hidden buttons are not security controls;
- human confirmation for financial, permission, compliance, safety, publication, and AI-drafted actions;
- no permanent privilege elevation through one-time approval.

### 12.2 Phase 1 permission matrix

| Capability | Owner | Manager | Regional | Finance | Catalog | Compliance | Auditor | Analyst | Readonly |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| View overview | ✓ | ✓ | Scoped | ✓ | ✓ | ✓ | Scoped | ✓ | ✓ |
| View Locations | ✓ | ✓ | Scoped | ✓ | ✓ | Scoped | Assigned | ✓ | ✓ |
| Compare metrics | ✓ | ✓ | Scoped | ✓ | ✓ | Scoped | Assigned | ✓ | ✓ |
| Edit catalog draft | ✓ | ✓ |  |  | ✓ |  |  |  |  |
| Publish catalog | ✓ | Optional |  |  | Optional |  |  |  |  |
| Roll back publication | ✓ | Optional |  |  | Optional |  |  |  |  |
| Review price exception | ✓ | ✓ | Scoped optional |  | ✓ |  |  |  |  |
| View availability | ✓ | ✓ | Scoped | ✓ | ✓ | Scoped | Assigned | ✓ | ✓ |
| Pause/re-enable service | ✓ | Optional | Scoped optional |  |  |  |  |  |  |
| Publish standard | ✓ | ✓ |  |  |  | ✓ |  |  |  |
| Manage compliance | ✓ | Optional | Scoped |  |  | ✓ | Assigned execution | Read | Read |
| Export operations report | ✓ | ✓ | Scoped optional | ✓ | Optional | Optional |  | ✓ | Optional |
| View fleet health | ✓ | ✓ | Scoped | Read | Read | Read | Assigned | Read | Read |
| Manage team | ✓ |  |  |  |  |  |  |  |  |
| View audit | ✓ | ✓ | Scoped | Finance scope | Catalog scope | Compliance scope | Own audits | Read scope | Limited |
| Ask AI | ✓ | ✓ | Scoped | Finance scope | Catalog scope | Compliance scope | Audit scope | ✓ | Read-only |

Exact grants must be represented as capabilities, not hardcoded role names alone.

### 12.3 Sensitive action audit

Audit entry minimum:

- Tenant ID;
- Chain ID;
- Digital Store ID when applicable;
- Location ID when applicable;
- actor user and role/capabilities;
- action code;
- target type/ID;
- before/after snapshot or immutable references;
- reason;
- approval/confirmation context;
- source app/service;
- request/correlation/idempotency IDs;
- server timestamp;
- IP/user agent where lawful and available.

Audit records are append-only.

### 12.4 Layered moderation authority

The owner-locked moderation model is reserved for Phase 3:

- Partner moderates its Digital Store content within policy;
- Chain governs Chain standards and participating Stores;
- HET intervenes only for platform safety, fraud, legal, privacy, abuse, or policy reasons;
- reason codes, appeal, override, and immutable audit are mandatory;
- HET may not silently rewrite operational truth.

No Phase 1 public reviews/ratings moderation module is activated by this specification.

---

## 13. Freshness, offline, and degraded behavior

### 13.1 Store edge rule

Store Hub remains the local operational authority after provisioning. Chain Portal is cloud management and reporting; internet failure must not stop T1–T4 local operation.

### 13.2 Chain PWA offline rule

- static shell may be cached;
- no offline business mutation;
- no queued catalog/availability/approval mutation from an offline browser;
- last-known data may be browsed only when policy permits;
- cached data must display `last_known`, source time, and non-authoritative status;
- reconnect triggers revalidation before actions become available.

### 13.3 Freshness states

| State | Meaning | UI behavior |
|---|---|---|
| `live` | Direct current cloud state where appropriate. | Standard display. |
| `fresh` | Latest Hub projection within approved threshold. | Standard display with as-of. |
| `stale` | Older than threshold. | Warning, no zero substitution, sensitive action gate. |
| `offline` | Location/Hub explicitly offline. | Exception state and last-known time. |
| `partial` | Some expected sources/Locations missing. | Partial banner and excluded scope. |
| `unknown` | Freshness cannot be established. | Unavailable/high-risk warning. |

Thresholds are `[REQUIRED: approved per-read-model thresholds]` and must not be invented in UI code.

### 13.4 Sensitive-action freshness gates

Publication, rollback, financial export, compliance closure, and AI-generated action confirmation may be blocked or require explicit authorized acknowledgement when targeted data is stale/unknown.

---

## 14. UX, design system, localization, and accessibility

### 14.1 Design principles

1. Exception first.
2. Truth before decoration.
3. Dense but readable desktop workflow.
4. Progressive disclosure.
5. Khmer-ready layouts.
6. No color-only status.
7. Safe destructive/sensitive actions.
8. Consistent cross-product components.

### 14.2 Responsive behavior

| Form factor | Requirement |
|---|---|
| Wide desktop | Primary full experience; multi-column dashboards and dense tables. |
| Desktop/laptop | Full experience. |
| Tablet | Full read and most governance actions; compliance execution supported. |
| Phone | Emergency triage, read, and limited explicitly approved actions; not a substitute for Partner App. |
| Installed PWA | Same permissions and online requirements as browser. |

### 14.3 Localization

- Khmer and English are required.
- Khmer labels may be 30–50% wider; layouts must not truncate essential meaning.
- Store names and service names support localized fields.
- `Asia/Phnom_Penh` is the default timezone.
- KHR formatting uses integer riel values, for example `៛1,250,000`.
- USD display preserves authoritative decimal precision.
- Technical tables may use ISO dates; user-facing dates are localized.

### 14.4 Accessibility

- WCAG 2.2 AA target;
- keyboard navigation for all data tables and dialogs;
- visible focus;
- accessible names for icons/actions;
- status text plus icon, not color alone;
- table headers and sort state exposed;
- reduced-motion support;
- contrast verified for all status tokens;
- screen-reader announcement for async job/status changes.

### 14.5 Required design tokens

All tokens are centralized in the shared design system. Exact brand values remain `[REQUIRED: approved KitLuy design tokens]`.

---

## 15. Metric dictionary requirements

Every metric must have a versioned definition with:

- metric ID;
- business name;
- formula;
- source tables/read model;
- included statuses;
- excluded statuses;
- currency treatment;
- rounding;
- timezone/business-day treatment;
- freshness threshold;
- completeness rules;
- drill-through route;
- owner;
- change history.

### 15.1 Minimum Laundry metric IDs

- `CHN_LND_BOOKINGS_COUNT`
- `CHN_LND_GROSS_BILLED_KHR`
- `CHN_LND_PAID_KHR`
- `CHN_LND_OUTSTANDING_KHR`
- `CHN_LND_AVG_BOOKING_VALUE_KHR`
- `CHN_LND_AVG_TURNAROUND_MIN`
- `CHN_LND_ON_TIME_RATE_BPS`
- `CHN_LND_OVERDUE_COUNT`
- `CHN_LND_READY_AGING_COUNT`
- `CHN_LND_REWASH_RATE_BPS`
- `CHN_LND_DAMAGE_RATE_BPS`
- `CHN_LND_ISSUE_RATE_BPS`
- `CHN_LND_AVAILABILITY_DOWNTIME_MIN`
- `CHN_LND_CATALOG_ADOPTION_RATE_BPS`
- `CHN_EDGE_HUB_ONLINE_RATE_BPS`
- `CHN_EDGE_TERMINAL_HEALTH_RATE_BPS`

Formulas remain `[REQUIRED: approved canonical metric definitions]` until documented and test-vector verified.

---

## 16. QA and acceptance criteria

### 16.1 Core QA matrix

| ID | Scenario | Pass condition |
|---|---|---|
| `CHP3-QA-001` | Chain session | Actor resolves only authorized Chain and capabilities. |
| `CHP3-QA-002` | Cross-Tenant isolation | No IDs, counts, errors, or timing leak another Tenant. |
| `CHP3-QA-003` | Cross-Chain isolation | Chain A cannot read/mutate Chain B. |
| `CHP3-QA-004` | Digital Store scope | User sees only authorized Laundry Digital Stores. |
| `CHP3-QA-005` | Location scope | Regional user sees only assigned Locations/groups. |
| `CHP3-QA-006` | Vertical guardrail | Non-Laundry Digital Store is excluded/blocked. |
| `CHP3-QA-007` | Freshness truth | Stale Location displays stale, never zero/live. |
| `CHP3-QA-008` | Partial comparison | Partial data is labeled and excluded Locations identified. |
| `CHP3-QA-009` | Metric compatibility | Incompatible rows are separated or blocked. |
| `CHP3-QA-010` | Catalog version | Published version is immutable. |
| `CHP3-QA-011` | Publication preview | Blockers/warnings and target count match backend validation. |
| `CHP3-QA-012` | Idempotent publication | Duplicate key creates one logical batch. |
| `CHP3-QA-013` | Hub acknowledgement | Per-Location outcome is visible and traceable. |
| `CHP3-QA-014` | Partial failure | Successful targets remain explicit; failures stay open. |
| `CHP3-QA-015` | Retry | Retry affects only eligible targets and preserves history. |
| `CHP3-QA-016` | Rollback | New rollback record supersedes assignment without destructive edit. |
| `CHP3-QA-017` | Active pause preservation | Catalog publication does not silently clear emergency pause. |
| `CHP3-QA-018` | Availability enforcement | T1/approved channel blocks unavailable service after projection. |
| `CHP3-QA-019` | T2 identity | T2 is shown only as Customer Display Screen. |
| `CHP3-QA-020` | T3/T4 separation | T3 and T4 retain distinct profiles, permissions, and events. |
| `CHP3-QA-021` | Exception guardrail | Pending price exception does not change effective price. |
| `CHP3-QA-022` | Role denial | Finance/readonly roles cannot publish catalog. |
| `CHP3-QA-023` | Audit completeness | Sensitive action records actor, role, scope, reason, target, and IDs. |
| `CHP3-QA-024` | Export security | Export scoped correctly; signed link expires; event audited. |
| `CHP3-QA-025` | Reporting access | History/export is not hidden by commercial plan tier. |
| `CHP3-QA-026` | PWA offline | No mutation is queued or falsely confirmed while offline. |
| `CHP3-QA-027` | Connector secrets | Browser payload never contains raw credentials. |
| `CHP3-QA-028` | AI source scope | AI cites only authorized Chain/Digital Store/Location sources. |
| `CHP3-QA-029` | AI confirmation | Draft action creates no mutation before explicit authorized confirmation. |
| `CHP3-QA-030` | Rebuild Test | Qualified engineer reconstructs approved Phase 1 product from docs/contracts. |

### 16.2 Non-functional acceptance

- accessibility audit passes the approved WCAG target;
- Khmer and English critical routes pass visual regression;
- critical APIs meet `[REQUIRED: approved latency/error SLOs]`;
- comparison/export load tests meet approved capacity;
- job retry/dead-letter tests pass;
- RLS negative test suite passes;
- backup/restore test passes;
- migration and rollback rehearsal passes;
- monitoring and alert tests pass;
- no critical/high unresolved security finding;
- Phase 1 Laundry regression across Partner/Hub/T1–T4 passes.

### 16.3 Evidence package

Every test result records:

- build SHA/version;
- migration version;
- environment;
- test data IDs;
- actor/role;
- API evidence;
- validator query/result;
- screenshot/video when relevant;
- timestamp/tester;
- pass/fail and linked defect.

---

## 17. Delivery sequence and phase gates

### Gate G0 — Authority

- v3 hierarchy approved;
- conflicts with older Store terminology logged;
- Phase 1 vs future scope accepted;
- unresolved owner values listed.

### Gate G1 — Contract

- entity and read-model contracts;
- API/event/job contracts;
- permission matrix;
- metric dictionary;
- freshness policy;
- migration plan;
- route/component inventory;
- audit and error codes.

### Gate G2 — Build

- UI and backend code;
- migrations/seeds;
- jobs;
- automated tests;
- feature flags;
- docs updated.

### Gate G3 — Integrated verification

- Admin/Partner/Hub/T1–T4 integration;
- publication/rollback;
- availability enforcement;
- RLS/security;
- freshness/partial data;
- reports/exports;
- recovery.

### Gate G4 — Pilot readiness

- monitoring/alerts;
- support runbooks;
- training;
- migration/rollback rehearsal;
- pilot Chain and Locations;
- go-live checklist.

### Gate G5 — Phase exit / Rebuild Test

- approved pilot evidence;
- no critical unresolved defect;
- current bibles/specs/contracts;
- one qualified engineer reconstructs and operates the product.

---

## 18. Migration and compatibility requirements

### 18.1 Required v2 → v3 semantic migration

1. Inventory every use of `store` and classify it as Digital Store or Store Location.
2. Add/verify Digital Store entities and vertical ownership.
3. Add/verify Store Location entities and linkage.
4. Replace Chain `store_id` route context with `location_id` where physical.
5. Add Digital Store filters/foreign keys to catalog policy.
6. Migrate catalog assignments to Location targets under a Digital Store.
7. Preserve existing IDs through mapping tables where possible.
8. Update audit context with Digital Store and Location IDs.
9. Update report dimensions and metric definitions.
10. Replace old terminal names with T1–T4.
11. Preserve historical publication and availability records.
12. Run dual-read/compatibility validation before cutover.
13. Use additive migrations and feature flags.
14. Provide rollback without data loss.

### 18.2 Compatibility rules

- Older clients may consume compatibility projections during staged rollout.
- No destructive rename without a migration/compatibility window.
- Hub/POS activation checks projection schema version.
- Publication preview blocks incompatible Hub versions unless approved compatibility exists.
- Release promotion follows Internal → Pilot → Stable.
- Signed artifacts and A/B rollback remain mandatory for edge releases.

---

## 19. Stable feature inventory

| Feature ID | Capability | Phase 1 disposition |
|---|---|---|
| `KCP3-001` | Chain application shell and context | Required |
| `KCP3-002` | Chain overview | Required |
| `KCP3-003` | Unified Action Center | Required |
| `KCP3-004` | Digital Store directory | Required |
| `KCP3-005` | Location directory/detail | Required |
| `KCP3-006` | Multi-location comparison | Required |
| `KCP3-007` | Exception-first views | Required |
| `KCP3-008` | Freshness/completeness/authority labels | Required |
| `KCP3-009` | Master Laundry catalog | Required |
| `KCP3-010` | Catalog versioning/diff | Required |
| `KCP3-011` | Pricing guardrails | Required |
| `KCP3-012` | Catalog exception requests | Required |
| `KCP3-013` | Publication preview | Required |
| `KCP3-014` | Per-Location deployment tracking | Required |
| `KCP3-015` | Retry and rollback | Required |
| `KCP3-016` | Service availability matrix | Required |
| `KCP3-017` | Emergency pause governance | Required |
| `KCP3-018` | Brand standards | Required |
| `KCP3-019` | Standard acknowledgement | Required |
| `KCP3-020` | Compliance foundation | Foundation |
| `KCP3-021` | Booking/sales/payment reports | Required |
| `KCP3-022` | Laundry turnaround/quality reports | Required |
| `KCP3-023` | Report exports | Required; no commercial paywall |
| `KCP3-024` | Hub health visibility | Required read-only |
| `KCP3-025` | T1–T4 health visibility | Required read-only |
| `KCP3-026` | Chain team and scoped RBAC | Required |
| `KCP3-027` | Immutable Chain audit | Required |
| `KCP3-028` | Integrations status | Readiness/status only |
| `KCP3-029` | AI Chain BI | Optional read-only initial scope |
| `KCP3-030` | PWA install/static shell | Required; no offline mutation |
| `KCP3-031` | Saved Location views/groups | Explicit selection foundation |
| `KCP3-032` | Generalized targeted publication groups | Phase 2 candidate |
| `KCP3-033` | Franchise structure | Phase 1.5/future gated |
| `KCP3-034` | Royalties | Phase 1.5/future gated |
| `KCP3-035` | Chain B2B | Phase 1.5/future gated |
| `KCP3-036` | Promotions | Future gated |
| `KCP3-037` | Loyalty | Future gated |
| `KCP3-038` | Layered review/moderation workflow | Phase 3 owner-locked, not active Phase 1 |
| `KCP3-039` | Restaurant menu/location governance | Phase 2 vertical delta |
| `KCP3-040` | Stock transfer governance | Phase 4+ shared/later vertical capability |

### 19.1 Master registry traceability

| Master feature | Chain Portal treatment |
|---|---|
| `KLMF-CAT-009` Chain operations | Preserved and deepened through v3 modules. |
| `KLMF-GOV-011` Multi-store and Chain governance | Core Phase 1 product outcome. |
| `KLMF-GOV-012` One Digital Store with multiple Store Locations | Required shared Core + Chain contract. |
| `KLMF-LND-001` Booking, sales, and payment reports | Included with truth/freshness labels. |
| `KLMF-REP-005` Multi-location comparison and exception views | Included as Phase 1 UX/build candidate. |
| `KLMF-REP-012` Store comparison and Chain reporting | Preserved and deepened. |
| `KLMF-REP-010` Reporting/analytics/data no-paywall | Binding all-phase policy. |
| `KLMF-CUS-002` Layered moderation authority | Architecture reserved; Phase 3 only. |
| `KLMF-GOV-009` Location groups and targeted publication | Explicit-selection foundation only in Phase 1; generalized reusable depth remains Phase 2 candidate. |

---

## 20. Product boundaries by build

| Capability | Admin Portal | Chain Portal | Partner Portal/App | Store Hub/T1–T4 | Shared service |
|---|---|---|---|---|---|
| Tenant/Chain provisioning | Owns | Reads/accepts | Reads | No | Core/Auth |
| Digital Store creation | Govern/support | Governs linked stores | Owns creation/config | Receives projection | Core |
| Location provisioning | Govern/support | Reads linked Locations | Owns business config | Hub activation | Device service |
| Master catalog | Seed/support | Owns Chain policy | Local permitted config/request | Enforces projection | Catalog/Management/Edge APIs |
| Publication | Release visibility | Owns preview/publish/rollback | Receives status | Acknowledge/apply | Jobs/events |
| Availability | Support/audit | Govern/view | Local operational authority | Enforce | Edge API |
| Booking/payment writes | Support only | Aggregate read | Store read/manage | T1 writes; Hub authority | Transaction/payment services |
| T3 Ready Scan-In | No | Aggregate read | Read/manage issue | T3 owns action | Laundry workflow |
| T4 Pickup Scan-Out | No | Aggregate read | Read/manage issue | T4 owns action | Laundry workflow |
| Reports | Platform | Chain | Store | Shift/operational local | Reporting service |
| Fleet | Owns registry/release | Read aggregate | Read own Location | Reports health | Device/release service |
| Integrations | Owns registry/policy | Read status | Configure allowed Store connectors | Uses config | Integration Hub |
| AI | Governs | Chain BI | Store BI | No direct Phase 1 AI | AI Gateway/MCP/RAG |

---

## 21. Monitoring, recovery, and support requirements

### 21.1 Monitoring

- frontend availability and errors;
- auth/session failures;
- RLS denial anomaly rate;
- API latency/error rate;
- publication batch partial/failure rate;
- target acknowledgement/apply age;
- stale/offline Location count;
- export queue/failure rate;
- notification failure/dead-letter rate;
- AI latency/cost/error rate if enabled;
- file upload/download failures;
- read-model lag;
- audit write failure: critical alert.

### 21.2 Recovery

- restore Chain data from managed backups/PITR;
- rebuild read models from authoritative records/events;
- recover publication state without duplicate apply;
- reissue signed export URLs rather than exposing permanent links;
- restore evidence metadata and bytes consistently;
- preserve append-only audit and financial records;
- document RPO/RTO as `[REQUIRED: approved targets]`.

### 21.3 Support boundary

Support may diagnose through authorized Admin tools. Chain Portal must not embed hidden impersonation or privileged support access. Any support intervention requires policy, user/owner consent where applicable, time-bound access, and audit.

---

## 22. Go-live checklist

### Authority and documentation

- [ ] v3 specification approved.
- [ ] entity/terminology conflict register closed or accepted.
- [ ] current schema/API/event/metric/RBAC documents approved.
- [ ] `[REQUIRED]` production values supplied.

### Data and security

- [ ] migrations applied and verified in target environment.
- [ ] RLS negative tests pass.
- [ ] seed roles/reason codes/templates pass.
- [ ] audit append-only controls pass.
- [ ] backup/restore drill passes.

### Product

- [ ] Chain login/context works.
- [ ] Digital Store and Location directories match authoritative linkage.
- [ ] comparison freshness/completeness works.
- [ ] catalog publication and rollback pass.
- [ ] emergency pause enforcement passes T1/Hub integration.
- [ ] T1–T4 names/profiles are correct.
- [ ] reports/exports pass and are not paywalled.
- [ ] degraded/offline behavior is honest.

### Operations

- [ ] monitoring and alerts active.
- [ ] support runbooks approved.
- [ ] pilot Chain has at least two Laundry Locations with active Hubs.
- [ ] training completed.
- [ ] Internal → Pilot promotion completed.
- [ ] rollback rehearsed.
- [ ] Rebuild Test passed.

---

## 23. Open required values

- `[REQUIRED: production and staging domains]`
- `[REQUIRED: Supabase project refs and environment names]`
- `[REQUIRED: DigitalOcean project/app/Spaces names]`
- `[REQUIRED: final design tokens and font stack]`
- `[REQUIRED: auth methods, MFA policy, and session durations]`
- `[REQUIRED: per-read-model freshness thresholds]`
- `[REQUIRED: API latency/error SLOs]`
- `[REQUIRED: load/capacity targets]`
- `[REQUIRED: backup RPO/RTO]`
- `[REQUIRED: final metric formulas and test vectors]`
- `[REQUIRED: exact notification providers/templates]`
- `[REQUIRED: final Chain commercial packaging; reporting/history/exports may not be commercially gated]`
- `[REQUIRED: approved compliance template content and SLA rules]`
- `[REQUIRED: production migration filenames after engineering review]`

---

## 24. Version history

| Version | Date | Summary |
|---|---|---|
| v3.0.0 | 2026-07-25 | Major Phase 1 upgrade: Digital Store/Store Location hierarchy, owner-locked T1–T4 awareness, Hub-first edge boundaries, multi-location exception comparison, freshness/completeness authority labels, versioned publication outcomes, reporting no-paywall policy, updated roles/routes/components, and source-traceable phase gates. |
| v2.0.0 | 2026-07-13 | Prior Chain Rebuild Bible baseline: physical Store-centric multi-store governance, catalog, availability, standards, compliance, franchise, royalties, B2B, reporting, APIs, RBAC, QA, and recovery. |

---

## Appendix A — Recommended repository layout

```text
kitluy-suite/
  apps/
    kitluy-chain-portal/
      public/
        manifest.webmanifest
        icons/
      src/
        app/
        routes/
          overview/
          actions/
          digital-stores/
          locations/
          compare/
          catalog/
          publication/
          availability/
          standards/
          compliance/
          reports/
          fleet/
          ai/
          integrations/
          team/
          audit/
          settings/
        modules/
          chain-context/
          digital-store-network/
          location-network/
          location-comparison/
          catalog-control/
          publication-control/
          service-availability/
          brand-standards/
          compliance/
          reporting/
          fleet-health/
          action-center/
        components/
        design-system/
        auth/
        services/
        pwa/
        tests/
  packages/
    shared-ui/
    shared-types/
    shared-utils/
    auth/
    rbac/
    money/
    i18n/
    api-contracts/
    metric-dictionary/
  services/
    file-service/
    notification-service/
    ai-gateway/
    mcp-server/
    rag-indexer/
    hub-agent/
    reporting-worker/
  supabase/
    migrations/
    functions/
  docs/
    product-specs/
      kitluy-chain-portal-phase1-spec-v3.0.0.md
```

## Appendix B — Rebuild Test

A qualified engineer passes the Chain Portal v3 Phase 1 Rebuild Test only when they can, from approved documentation and a blank non-production environment:

1. provision required cloud resources;
2. apply migrations/seeds;
3. create a Tenant, Chain, Laundry Digital Store, and two Store Locations;
4. provision/link active Hubs and T1–T4 profiles through the proper sibling systems;
5. deploy the Chain PWA and APIs;
6. log in as scoped roles;
7. create, publish, partially fail, retry, and roll back a catalog version;
8. trigger and resolve a Location emergency service pause;
9. compare Locations with correct freshness/completeness;
10. export an authoritative report;
11. prove RLS and audit behavior;
12. recover from a tested failure;
13. execute the Phase 1 go-live checklist without relying on undocumented tribal knowledge.
