# KitLuy Partner App - Phase 1 Laundry Product Specification

| Field | Value |
|---|---|
| Filename | `kitluy-partner-app-phase1-spec-v2.0.0.md` |
| Product | `kitluy-partner-app` |
| Target release | Phase 1 - Laundry |
| Target version | `v2.0.0` |
| Codename | Laundry Operations Command Center |
| Date | 2026-07-24 |
| Owner | HET / KitLuy Suite project owner |
| Primary users | Laundry Partner owners and store managers |
| Client | React Native + Expo for iOS and Android |
| Primary market | Cambodia |
| Status | Proposed canonical target specification; not implementation evidence |
| Predecessor | `kitluy-partner-app-rebuild-bible-v1.1.0.md` |

> Product mission: give an authorized Laundry Partner owner or manager an accurate, exception-first understanding of one selected Digital Store and Store Location in under one minute, then provide safe drill-through and a limited set of explicitly approved management actions.

> Evidence rule: this specification defines target behavior. A capability must not be labeled IMPLEMENTED until repository code, applied migrations, executable tests, deployment records, and pilot evidence support that claim.

---

## 0. Specification authority and use

### 0.1 Authority order

Conflicts are resolved in this order:

1. Current project-owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified repository code, executable tests, deployment records, and production evidence.
3. This Phase 1 Partner App specification after owner approval.
4. `kitluy-partner-app-rebuild-bible-v1.1.0.md` for retained product contracts.
5. Current Suite, Business, Admin, Chain, Partner Portal, Store Hub, POS, File, Notification, and AI documentation.
6. Owner-approved implementation handoffs.
7. Evidence-based competitor analyses and product classifications.
8. Competitor rebuild or clone documents as design references only.
9. Superseded planning.

### 0.2 Source register

| Source ID | Source | Authority used in this specification |
|---|---|---|
| `SRC-OWNER-001` | Current KitLuy Project Instructions | Eight-phase roadmap, one Store per primary vertical, Digital Store-first model, shared Core, Cambodia-first requirements, offline authority, finance and audit rules, phase completion test. |
| `SRC-OWNER-002` | Digital-First Hybrid Model and Extended WooCommerce Adoption decision | Digital Store control plane, Store Location edge environment, governed channels, relational truth, API separation, events, jobs, safe deployment, and projection rules. |
| `SRC-OWNER-003` | Laundry Terminal Architecture T1-T4 decision | T1 Intake/Cashier, T2 Customer Display, T3 Clean and Ready Scan-In, T4 Customer Pickup Scan-Out. |
| `SRC-OWNER-004` | Smartphone-Simple Device Provisioning decision | Digital Store first, active Store Hub second, assigned terminals third, device certificates, discovery, and offline operation after provisioning. |
| `SRC-KPA-001` | `kitluy-partner-app-rebuild-bible-v1.1.0.md` | Mobile cockpit boundary, Booking terminology, Pressing label, fail-closed data, protected last-known cache, read-only Finance, RBAC, AI safety, API and QA baseline. |
| `SRC-KPP-001` | `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md` | Partner App versus Partner Portal responsibility split and shared Partner read-model expectations. |
| `SRC-MFR-001` | `kitluy-master-feature-registry-v0.2.md` | Canonical capability normalization and evidence-status discipline. |
| `SRC-LS-001` | Lightspeed comparison, classification, and backlog | Truth freshness/completeness labels and optional exception-first manager metrics after stable read models. |
| `SRC-LV-001` | Loyverse comparison and classification | Simpler task-first navigation, actionable alerts, device-health clarity, and manager usability patterns. |
| `SRC-TOAST-001` | Toast comparison, classification, and backlog | Extend the existing Partner App for future vertical views; reject a duplicate Manager App. Phase 2 features do not enter Laundry Phase 1. |
| `SRC-WC-001` | WooCommerce comparison and backlog | No direct Phase 1 Partner App ownership; preserve the scoped cockpit and defer commerce snapshots to Phase 3. |
| `SRC-SH-001` | Shopify comparison and backlog | No Phase 1 expansion into commerce administration; Phase 3 commerce summaries must remain contract-bound and read-scoped. |

### 0.3 Reconciliation decisions applied in v2.0.0

1. Older text that treats Store as only a physical location is normalized to:
   - Tenant or Partner Account
   - Digital Store as the business and control-plane Store
   - Store Location as the optional physical edge environment
2. All older T1/T2/T3 references are superseded by T1-T4.
3. The Partner App remains cloud-read plus protected mobile cache. It does not directly connect to the Store Hub LAN in Phase 1.
4. The app remains a cockpit, not a mobile copy of the Partner Portal.
5. Finance remains read-only in Phase 1.
6. Advanced `manager_metrics_v2` is scaffolded but pilot-gated until authoritative read models are stable.
7. Restaurant, eCommerce, Retail, Pharmacy, Grocery, and Supermarket behaviors remain outside Phase 1 Laundry.

### 0.4 How to use this specification

- Product and design use Parts 1-7.
- Mobile engineering uses Parts 7-14.
- Backend engineering uses Parts 8-13.
- QA uses Parts 15-17.
- Operations and release owners use Parts 18-20.
- Any unresolved deployment-specific value remains `[REQUIRED: ...]` and must not be guessed in production.

---

## 1. Product definition

### 1.1 What the product is

KitLuy Partner App v2.0.0 is the mobile daily-operations command center for authorized Laundry Partner owners and managers. It provides:

- Digital Store and Store Location context.
- An exception-first Today screen.
- Laundry Booking monitoring and drill-through.
- T1-T4 chain-of-custody visibility.
- Ready-for-pickup aging.
- Issue, Rewash, Damage, and Missing Item visibility.
- Read-only Finance truth.
- Staff coverage and capacity awareness.
- Laundry consumable alerts.
- Store Hub, terminal, peripheral, and sync health.
- Push notifications and deep links.
- Protected last-known offline browsing.
- Permission-scoped AI summaries and explanations.
- A small set of feature-flagged, online-only Phase 1.5 actions.

### 1.2 What the product is not

The Partner App is not:

- T1, T2, T3, or T4.
- A cashier, payment-capture, receipt-printing, tag-printing, scanner, or scale client.
- The Store Hub local authority.
- A full Partner Portal.
- A Chain Portal or Admin Portal.
- A full inventory, purchasing, payroll, accounting, tax, or reconciliation system.
- A storefront, marketplace, theme editor, or connector administration surface.
- A replacement for `kitluy-pos-mobile-app`.
- A direct Store Hub LAN controller.
- An autonomous AI operator.
- A duplicate manager application inspired by a competitor.

### 1.3 Product promise

An authorized owner or manager should be able to answer these questions quickly:

1. Is the selected Location operating normally?
2. What needs attention first?
3. Which Bookings are due, overdue, blocked, damaged, or waiting too long?
4. Are staff and capacity sufficient?
5. Are cash, KHQR, deposits, balances, and reconciliation data complete and fresh?
6. Are the Store Hub and T1-T4 healthy?
7. Which customers should be contacted now?
8. What action is permitted, and where must a sensitive action be completed?

### 1.4 Product principles

| Principle | Required behavior |
|---|---|
| Attention first | Exceptions and urgency appear before broad statistics. |
| Truth before convenience | Missing or partial data is labeled, not replaced by zeroes or demo values. |
| Cockpit, not back office | Mobile shows daily management context and drill-through; heavy configuration remains in Partner Portal. |
| One context at a time | Every screen is scoped to one authorized Digital Store and one Store Location at a time. |
| Booking language | User-facing Laundry work uses Booking or Laundry Booking, not Order. |
| Pressing label | Legacy `ironing` values map to Pressing in the mobile UI. |
| Read-only Finance | Phase 1 does not capture payment, generate KHQR, approve refunds or voids, or finalize reconciliation. |
| Cloud-read Phase 1 | The app reads cloud projections and protected local cache; no direct LAN authority. |
| Human control | Sensitive action recommendations require authorized human confirmation and audit. |
| Cambodia first | Khmer and English, KHR and USD, KHQR status, Cambodia phone formatting, and Asia/Phnom_Penh time. |
| Fail closed | Missing provider, permission, read model, or configuration produces unavailable, partial, or denied states. |
| Rebuild ready | Contracts, failures, permissions, tests, migrations, and release gates must be documented. |

---

## 2. Users, roles, and context

### 2.1 Primary personas

| Persona | Main goal | Typical use |
|---|---|---|
| Partner Owner | Understand business condition, money-control signals, risks, and exceptions. | Several checks per day, approval previews, Store Health, high-severity alerts. |
| Store Manager | Run daily operations, resolve workflow problems, manage workload, and contact customers. | Continuous operational monitoring, Booking drill-through, issue review, staff and inventory checks. |
| Supervisor | Monitor workflow and issues when explicitly entitled. | Booking queues, production pressure, issue evidence, non-financial alerts. |
| Accountant | Review finance snapshot and reconciliation readiness when explicitly entitled. | Gross billed, tender summaries, balances, variance, approval previews. |
| Readonly User | Observe non-sensitive store status when explicitly entitled. | Booking and Store Health visibility without actions or Finance by default. |

### 2.2 Access policy

| Role | Default Partner App access | Default scope |
|---|---|---|
| `partner_owner` | Allowed | Full Phase 1 cockpit for authorized Digital Stores and Locations. |
| `store_manager` | Allowed | Daily operations, limited Finance, staff, inventory, health, and enabled manager actions. |
| `supervisor` | Denied unless explicitly entitled | Operations, issues, staff workload, health; no Finance by default. |
| `accountant` | Denied unless explicitly entitled | Finance and related health/freshness; operational access limited by permission. |
| `readonly` | Denied unless explicitly entitled | Non-financial read-only views. |
| `cashier` | Denied | Uses POS surfaces. |
| `laundry_staff` | Denied | Uses POS or staff workflow surfaces. |

### 2.3 Active context model

Every request and cached snapshot must carry:

```text
tenant_id
partner_account_id (when distinct from tenant_id)
digital_store_id
location_id
vertical_code = laundry
user_id
role_id or effective_role
mobile_device_id
context_version
```

Rules:

1. A user may only select a Digital Store and Location returned by the mobile bootstrap contract.
2. The app must never combine metrics from multiple Digital Stores or Locations in Phase 1.
3. Context switching clears in-memory screen state and loads the matching protected cache.
4. A cache entry is keyed by user, role, Digital Store, Location, and schema version.
5. Role revocation or Store membership removal invalidates affected cache and deep links.
6. Chain-level rollups are not included in this release.

---

## 3. Release scope

### 3.1 Scope classes

| Class | Meaning |
|---|---|
| `P1-REQ` | Required for Phase 1 v2.0.0 release. |
| `P1-PILOT` | Included behind a feature flag after stable read models and pilot approval. |
| `P1.5` | Contracted and documented but disabled by default until separately approved. |
| `DEFER` | Not part of Phase 1; no release dependency. |
| `REJECT` | Prohibited product pattern. |

### 3.2 Feature inventory summary

| Domain | Required | Pilot-gated | Phase 1.5 | Deferred or rejected |
|---|---:|---:|---:|---:|
| Context and shell | 4 | 0 | 0 | 0 |
| Today and Attention | 6 | 1 | 1 | 0 |
| Bookings and chain of custody | 8 | 0 | 2 | 0 |
| Finance | 5 | 0 | 0 | 4 |
| Staff, inventory, customers | 6 | 0 | 0 | 2 |
| Store Health and support | 5 | 1 | 0 | 1 |
| Offline and freshness | 5 | 0 | 0 | 0 |
| Notifications | 4 | 0 | 0 | 0 |
| AI | 4 | 1 | 0 | 2 |
| Security and audit | 6 | 0 | 0 | 0 |

### 3.3 Explicit Phase 1 exclusions

- Booking intake and price calculation.
- Cash or KHQR payment capture.
- KHQR creation.
- Refund or void approval mutation.
- Cash variance approval mutation.
- Reconciliation completion.
- Receipt and tag printing.
- Shift open or close mutation.
- Full service catalog, price, discount, tax, or promotion configuration.
- Purchase orders, stock counts, stock adjustments, or supplier management.
- Staff role and permission management.
- Chain rollups.
- Direct device commands.
- Direct Store Hub LAN access.
- Storefront, online checkout, channel, theme, app, or marketplace management.
- Restaurant alerts, 86ing, waitlist, table, kitchen, or hospitality workflows.
- Autonomous AI actions.

---

## 4. Detailed feature catalog

### 4.1 Context and application shell

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-CTX-001` | Mobile bootstrap and access resolution | `P1-REQ` | Returns only authorized Digital Store and Location memberships, roles, capabilities, feature flags, minimum app version, and truth/freshness policy. |
| `KPA-V2-CTX-002` | Digital Store and Location context header | `P1-REQ` | Every operational screen shows or can reveal the active context; no cross-context data mixing. |
| `KPA-V2-CTX-003` | Authorized context switcher | `P1-REQ` | Switches only among authorized contexts, invalidates in-memory state, and loads context-specific cache. |
| `KPA-V2-CTX-004` | Global truth and freshness shell | `P1-REQ` | Global banners distinguish live, last-known, partial, stale, offline, unavailable, and permission-limited states. |

### 4.2 Today command center

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-TDY-001` | Today command center | `P1-REQ` | Presents critical exceptions first, then status, workflow, money-control, people, stock, and health summaries. |
| `KPA-V2-TDY-002` | Operational status strip | `P1-REQ` | Shows Location availability, last authoritative refresh, pending sync, active Bookings, Ready count, and high-severity condition. |
| `KPA-V2-TDY-003` | Laundry workflow summary | `P1-REQ` | Shows Received, Washing, Drying, Pressing, Ready, Due Soon, Overdue, and Issue counts with drill-through. |
| `KPA-V2-TDY-004` | Ready pickup summary | `P1-REQ` | Shows Ready count, longest waiting Booking, aging groups, and contact-required count. |
| `KPA-V2-TDY-005` | Staff and capacity summary | `P1-REQ` | Shows clocked-in staff, role coverage, workload pressure, and inspectable source values. |
| `KPA-V2-TDY-006` | Finance control signals | `P1-REQ` | Shows only role-authorized finance fields with truth labels and no unlabeled calculations. |
| `KPA-V2-MET-001` | Advanced exception-first manager metrics | `P1-PILOT` | Under `manager_metrics_v2`, shows overdue Bookings, cash variance, device/sync faults, and freshness with correct drill-through. |

### 4.3 Attention center

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-ATT-001` | Unified Needs Attention queue | `P1-REQ` | Combines operational, finance, inventory, staff, health, and notification exceptions into one priority-sorted queue. |
| `KPA-V2-ATT-002` | Actionable attention item | `P1-REQ` | Each item states what happened, impact, context, source time, permitted action, and escalation path. |
| `KPA-V2-ATT-003` | Attention filters and saved view | `P1-REQ` | Filters by criticality, type, Booking, age, read state, and assignment. Saved view remains local preference only. |
| `KPA-V2-ATT-004` | Attention acknowledgement | `P1.5` | Optional append-only acknowledgement; does not resolve underlying business truth. Online, permissioned, idempotent, and audited. |
| `KPA-V2-ATT-005` | Approval preview grouping | `P1-REQ` | Displays pending previews without mutation controls when Phase 1 read-only policy applies. |
| `KPA-V2-ATT-006` | Deep-link integrity | `P1-REQ` | Every supported attention item opens the correct scoped screen or a safe unavailable state. |

### 4.4 Laundry Booking list and search

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-BKG-001` | Booking queues | `P1-REQ` | Supports New, Received, Washing, Drying, Pressing, Ready, Picked Up, Cancelled, and Issue/Rewash/Damaged. |
| `KPA-V2-BKG-002` | Urgency and exception filters | `P1-REQ` | Supports Due Today, Due Soon, Overdue, Ready Too Long, Balance Due, Deposit Received, Unpaid, Has Issue, Rewash, Damaged/Missing, Pickup/Delivery, T3 complete, T4 pending, and Pending Sync where contracts support them. |
| `KPA-V2-BKG-003` | Booking search | `P1-REQ` | Searches authorized projections by Booking number, customer name, and normalized phone number. |
| `KPA-V2-BKG-004` | Booking card | `P1-REQ` | Shows Booking number, customer, service summary, status, due time, payment state, issue state, SLA, and freshness. |

### 4.5 Booking detail and chain of custody

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-BKG-005` | Booking detail | `P1-REQ` | Shows customer, services, garment/item summary, weight/piece data, gross, paid, balance, deposit, payment summary, pickup/delivery, notes, evidence, and allowed actions. |
| `KPA-V2-BKG-006` | T1-T4 chain-of-custody timeline | `P1-REQ` | Displays intake, production, T3 Ready Scan-In, T4 Pickup Scan-Out, actor, terminal, device, location, and event time where authoritative events exist. |
| `KPA-V2-BKG-007` | Ready pickup aging | `P1-REQ` | Calculates server-defined aging from authoritative Ready event, labels source and as-of time, and groups attention thresholds without client-invented truth. |
| `KPA-V2-BKG-008` | Allowed-action contract | `P1-REQ` | Backend returns allowed actions and reason when an action is denied; UI does not infer permissions. |
| `KPA-V2-BKG-009` | Add Booking note | `P1.5` | Append-only, online, permissioned, idempotent, and audited. |
| `KPA-V2-BKG-010` | Contact customer shortcut | `P1-REQ` | Opens device phone or approved messaging link after explicit user action; no silent messaging. |

### 4.6 Issue, Rewash, Damage, and Missing Item

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-ISS-001` | Issue case detail | `P1-REQ` | Shows category, severity, affected items, evidence, assigned person, customer-contact state, proposed resolution, financial implication when authoritative, and event history. |
| `KPA-V2-ISS-002` | Issue evidence gallery | `P1-REQ` | Uses signed File Service access, permission checks, safe placeholders, and no public object URLs. |
| `KPA-V2-ISS-003` | Create issue or upload evidence | `P1.5` | Creates an issue/evidence event only; no implicit refund, credit, inventory, or status mutation. |
| `KPA-V2-ISS-004` | Issue assignment or acknowledgement | `P1.5` | Optional, permissioned, idempotent, and audited; assignment does not erase previous ownership history. |

### 4.7 Finance control center

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-FIN-001` | Finance truth header | `P1-REQ` | Shows truth status, completeness, source, data-as-of time, reconciliation state, and missing fields. |
| `KPA-V2-FIN-002` | Gross billed and payment snapshot | `P1-REQ` | Shows Gross billed today, paid amount, outstanding balance, deposits, cash, KHQR, and other tenders only when authoritative. |
| `KPA-V2-FIN-003` | Refund, void, and variance summary | `P1-REQ` | Read-only counts and amounts with source and status; no approve or reconcile controls. |
| `KPA-V2-FIN-004` | Approval previews | `P1-REQ` | Shows request type, Booking, amount, requester, reason, evidence, required authority, and current state without mutation. |
| `KPA-V2-FIN-005` | Reconciliation checklist | `P1-REQ` | Shows readiness and missing steps; it cannot complete reconciliation. |
| `KPA-V2-FIN-X01` | Payment capture | `DEFER` | Not present in Partner App Phase 1. |
| `KPA-V2-FIN-X02` | KHQR generation | `DEFER` | Not present in Partner App Phase 1. |
| `KPA-V2-FIN-X03` | Refund or void approval mutation | `DEFER` | Disabled; preview only. |
| `KPA-V2-FIN-X04` | Cash variance approval or reconciliation mutation | `DEFER` | Disabled; review only. |

### 4.8 Inventory, staff, and customer views

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-INV-001` | Laundry consumable alerts | `P1-REQ` | Shows item, current, available, threshold, trend, days remaining when authoritative, Location, suggested action, and last movement time. |
| `KPA-V2-INV-002` | Inventory alert drill-through | `P1-REQ` | Shows movement summary and deep link to Partner Portal for purchasing or adjustment when available. |
| `KPA-V2-EMP-001` | Staff on shift | `P1-REQ` | Shows staff, role or capability, clock-in time, assigned workload, and freshness. |
| `KPA-V2-EMP-002` | Coverage and capacity pressure | `P1-REQ` | Shows missing role coverage and server-defined workload indicators with inspectable inputs. |
| `KPA-V2-CUS-001` | Customer mini profile | `P1-REQ` | Shows identity, contact, active and Ready Bookings, outstanding balance when authorized, recent issue flags, preferences, and approved notes. |
| `KPA-V2-CUS-002` | Customer contact actions | `P1-REQ` | Explicit user action only; respects permissions and available contact data. |
| `KPA-V2-INV-X01` | Inventory adjustment or stock count | `DEFER` | Partner Portal or POS/Hub domain. |
| `KPA-V2-EMP-X01` | Role, PIN, payroll, or time-card administration | `DEFER` | Partner Portal and workforce domain. |

### 4.9 Store Health and T1-T4 diagnostics

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-HLT-001` | Store Hub health | `P1-REQ` | Shows online state, heartbeat, last successful sync, pending queue count, storage warning, version, update state, and backup/recovery warning when available. |
| `KPA-V2-HLT-002` | T1-T4 health grid | `P1-REQ` | Shows each canonical role separately even when roles share physical hardware. |
| `KPA-V2-HLT-003` | Peripheral health | `P1-REQ` | Shows receipt printer, tag printer, scanner, scale, customer display, and network state when authoritative. |
| `KPA-V2-HLT-004` | Sync and last-good-state detail | `P1-REQ` | Distinguishes Hub heartbeat, cloud sync, terminal heartbeat, file queue, and mobile cache time. |
| `KPA-V2-HLT-005` | Software compatibility status | `P1-REQ` | Shows current version, minimum compatible version, pending rollout, and unsupported state without direct update control. |
| `KPA-V2-SUP-001` | Operational support escalation | `P1-PILOT` | Creates or drafts a support case with authorized diagnostic context, consent, redaction, and audit. |
| `KPA-V2-HLT-X01` | Direct terminal or Hub command | `REJECT` | No direct restart, update, pairing, LAN discovery, or device-control command from Partner App Phase 1. |

#### T1-T4 display requirements

| Terminal | Canonical role | Required Partner App health fields |
|---|---|---|
| T1 | POS Cashier / Intake | Online state, last activity, Booking sync, payment sync, receipt/tag printer summary, software version. |
| T2 | Customer Display Screen | Pairing state, display connection, last activity, software version. |
| T3 | Clean and Ready Scan-In | Online state, scanner state, last Ready scan, pending sync, software version. |
| T4 | Customer Pickup Scan-Out | Online state, scanner state, last pickup scan, pending sync, software version. |

### 4.10 Offline, freshness, and fail-closed behavior

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-OFF-001` | Protected last-known cache | `P1-REQ` | Stores latest successful role-scoped snapshot and selected detail records using protected local storage. |
| `KPA-V2-OFF-002` | Browse-only offline mode | `P1-REQ` | Cached Today, Bookings, Booking detail, Attention, Finance, and Health remain viewable with visible timestamp where cached. |
| `KPA-V2-OFF-003` | Cache invalidation | `P1-REQ` | Clears on logout, role or membership removal, context invalidation, incompatible schema version, or explicit security reset. |
| `KPA-V2-OFF-004` | Separate truth and freshness states | `P1-REQ` | UI and contracts do not collapse authority, completeness, freshness, and cache mode into one ambiguous status. |
| `KPA-V2-OFF-005` | Live-mode fail closed | `P1-REQ` | Production composition cannot silently use demo providers or invented values. |

### 4.11 Notifications and deep links

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-NOT-001` | Push token registration | `P1-REQ` | Idempotently registers device token, platform, app version, locale, and context capability without exposing provider secrets. |
| `KPA-V2-NOT-002` | Notification center | `P1-REQ` | Shows read/unread, severity, source, context, created time, and deep-link target. |
| `KPA-V2-NOT-003` | Notification read state | `P1-REQ` | Marks only the current recipient state; underlying exception remains unchanged. |
| `KPA-V2-NOT-004` | Safe deep-link resolution | `P1-REQ` | Revalidates session, membership, context, and object access before opening content. |

### 4.12 AI operations assistant

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-AI-001` | AI Daily Brief | `P1-REQ` | Summarizes changes, risks, high-priority Bookings, staffing, inventory, finance completeness, and health with source links. |
| `KPA-V2-AI-002` | Booking overload and staff-capacity explanation | `P1-REQ` | Shows inspectable inputs, severity, data-as-of time, and recommended human action. |
| `KPA-V2-AI-003` | Finance, inventory, and health explanations | `P1-REQ` | Explains authoritative signals without inventing missing values or executing actions. |
| `KPA-V2-AI-004` | AI unavailable fallback | `P1-REQ` | Operational screens remain usable when AI is unavailable; no blocked core workflow. |
| `KPA-V2-AI-005` | Advanced prioritized action plan | `P1-PILOT` | Feature-flagged, evaluated for accuracy, source coverage, and false-positive rate before broad release. |
| `KPA-V2-AI-X01` | Autonomous sensitive action | `REJECT` | AI cannot pause services, alter Finance, change price, change permissions, adjust stock, or control devices. |
| `KPA-V2-AI-X02` | Unlabeled AI-generated business truth | `REJECT` | AI output is advisory and source-linked; it is never an authoritative ledger or status source. |

### 4.13 Emergency service availability

| Feature ID | Feature | Scope | Acceptance summary |
|---|---|---|---|
| `KPA-V2-SVC-001` | Emergency pause preview | `P1-REQ` | Shows current availability, policy constraints, affected service, Location, and whether a mutation contract is enabled. |
| `KPA-V2-SVC-002` | Emergency pause or resume mutation | `P1.5` | Online only, authorized, reasoned, time-bounded when applicable, idempotent, Chain-aware, audited, and synced through approved contracts. |

Allowed reason codes:

```text
machine_down
staff_shortage
supply_out
power_issue
water_issue
capacity_full
quality_issue
safety_issue
holiday_or_closure
other
```

---

## 5. Information architecture and navigation

### 5.1 Bottom navigation

| Tab | Route root | Purpose |
|---|---|---|
| Today | `/today` | Exception-first daily command center. |
| Bookings | `/bookings` | Laundry Booking queues, search, filters, and detail. |
| Attention | `/attention` | Unified exceptions, notifications, and approval previews. |
| Finance | `/finance` | Read-only Finance control center. |
| More | `/more` | Staff, inventory, customers, Store Health, services, support, account, and app information. |

### 5.2 Route inventory

| Route | Screen | Scope |
|---|---|---|
| `/auth/sign-in` | Sign in | P1 |
| `/auth/session-expired` | Session expired | P1 |
| `/context/select` | Digital Store and Location selection | P1 |
| `/today` | Today command center | P1 |
| `/attention` | Attention center | P1 |
| `/attention/:id` | Attention detail | P1 |
| `/bookings` | Booking list | P1 |
| `/bookings/:bookingId` | Booking detail | P1 |
| `/bookings/:bookingId/timeline` | Chain-of-custody timeline | P1 |
| `/bookings/:bookingId/issues/:issueId` | Issue detail | P1 |
| `/finance` | Finance control center | P1 |
| `/finance/approval-previews` | Approval previews | P1 |
| `/finance/variance` | Variance detail | P1 read-only |
| `/more/staff` | Staff coverage | P1 |
| `/more/inventory` | Consumable alerts | P1 |
| `/more/customers/:customerId` | Customer mini profile | P1 |
| `/more/store-health` | Store Health | P1 |
| `/more/store-health/terminal/:terminalRole` | T1-T4 health detail | P1 |
| `/more/services/availability` | Service availability preview | P1 |
| `/more/services/emergency-pause` | Emergency pause flow | P1.5 |
| `/more/support` | Support and diagnostics | P1/Pilot |
| `/more/ai-brief` | AI Daily Brief | P1 |
| `/more/account` | Account and preferences | P1 |
| `/more/about` | App version, legal, diagnostics identifiers | P1 |

### 5.3 Navigation rules

1. Deep links never bypass authentication, context selection, RLS, or feature gates.
2. Hidden capability is preferred when access is categorically unavailable.
3. Disabled controls may be shown only when the user benefits from an explanation and no security information is leaked.
4. A context mismatch redirects to a safe context-selection or unavailable screen.
5. Back navigation must not reveal data from a previous unauthorized context after a role or membership change.

---

## 6. Screen specifications

### 6.1 Today screen

#### Required order

1. Global freshness or offline banner.
2. Digital Store and Location context.
3. Needs Attention queue preview.
4. Operational status strip.
5. Booking workflow summary.
6. Ready pickup aging.
7. Staff and capacity.
8. Finance control signals if permitted.
9. Consumable risk.
10. Store Health.
11. AI Daily Brief.

#### Required empty and failure states

| State | Behavior |
|---|---|
| No exceptions | Show healthy summary and last refresh; do not fabricate activity. |
| Partial read model | Show available sections and a visible partial-data notice listing unavailable sections. |
| Stale cloud projection | Show last-known values with stale warning and last successful sync. |
| Offline mobile | Load protected cache and block online-only actions. |
| No cache | Show shell, context if known, and clear unavailable message. |
| Permission-limited | Hide restricted sections and explain only when useful. |

### 6.2 Attention screen

Each attention row must include:

- Severity: critical, high, normal, or info.
- Type.
- Concise title.
- Business impact.
- Related Booking, customer, device, or item where permitted.
- Created time.
- Data-as-of time.
- Freshness and truth state.
- Assignment or acknowledgement state when enabled.
- Primary permitted action.
- Escalation target.

Priority order is server-defined. The client may apply user-selected filters but must not reclassify severity as business truth.

### 6.3 Booking list

Required card fields:

```text
booking_id
booking_number
customer_display_name
customer_phone_masked_or_full_by_permission
service_summary
status_display
payment_status
balance_due_khr_or_usd
received_at
due_at
ready_at
sla_state
issue_state
pickup_delivery_mode
sync_freshness
truth_status
```

Required sorting:

- Urgency.
- Due time.
- Ready aging.
- Newest received.
- Oldest received.

### 6.4 Booking detail

Required sections:

1. Header and current status.
2. Customer and contact actions.
3. Service and add-on lines.
4. Garment/item or weight/piece summary.
5. Gross, paid, deposit, balance, and payment state.
6. Due and pickup/delivery details.
7. Issue and evidence summary.
8. T1-T4 chain-of-custody timeline.
9. Notes and audit-relevant operational events.
10. Allowed actions.
11. Truth, freshness, and source metadata.

### 6.5 Finance screen

Required labels:

- Gross billed today.
- Paid amount.
- Outstanding balance.
- Deposits received.
- Cash received.
- KHQR received.
- Other tenders.
- Refund summary.
- Void summary.
- Cash variance.
- Approval previews.
- Reconciliation state.
- Business-day or register-close state when authoritative.

Prohibited labels and behavior:

- Do not label gross billed as Today's sales.
- Do not convert null to zero.
- Do not show a green healthy state when the read model is missing.
- Do not add mutation controls for refund, void, variance, or reconciliation in Phase 1.

### 6.6 Store Health screen

Required layers:

1. Cloud projection health.
2. Store Hub health.
3. Sync pipeline health.
4. T1-T4 logical role health.
5. Physical device mapping when available.
6. Peripheral health.
7. Software compatibility.
8. Mobile cache state.
9. Support escalation availability.

A shared physical terminal that runs T3 and T4 must still show separate logical role states and separate last operational events.

---

## 7. Component inventory

### 7.1 Shell and context

- `PartnerAppShell`
- `AuthenticatedNavigator`
- `StoreContextHeader`
- `StoreContextSwitcher`
- `BottomNavigation`
- `RoutePermissionGate`
- `FeatureFlagGate`
- `MinimumVersionGate`
- `GlobalFreshnessBanner`
- `OfflineCacheBanner`
- `PartialDataNotice`
- `UnavailableState`
- `ErrorBoundary`
- `LastUpdatedLabel`

### 7.2 Today and Attention

- `NeedsAttentionQueue`
- `AttentionItemCard`
- `AttentionSeverityBadge`
- `OperationalStatusStrip`
- `BookingStageSummary`
- `ReadyPickupAgingCard`
- `StaffCoverageCard`
- `CapacityPressureCard`
- `FinanceControlSignalCard`
- `CriticalStockCard`
- `StoreHealthSummaryCard`
- `AiDailyBriefCard`
- `ApprovalPreviewCard`

### 7.3 Booking and issue

- `BookingCard`
- `BookingStatusPill`
- `PaymentStatusPill`
- `BookingSlaIndicator`
- `BookingFilterSheet`
- `BookingSearchBar`
- `BookingDetailHeader`
- `ServiceLineList`
- `GarmentItemSummary`
- `DepositBalanceSummary`
- `BookingTimeline`
- `TimelineEventRow`
- `TerminalRoleBadge`
- `ReadyAgingBadge`
- `EvidenceGallery`
- `IssueSummaryCard`
- `IssueSeverityBadge`
- `CustomerContactActions`
- `AllowedActionsPanel`

### 7.4 Finance

- `FinanceTruthHeader`
- `GrossBilledCard`
- `TenderBreakdown`
- `DepositBalanceCard`
- `CashVarianceCard`
- `RefundVoidSummary`
- `ReconciliationStatusCard`
- `BusinessDayCloseStatusCard`
- `ApprovalPreviewList`
- `MissingFinanceFieldsNotice`

### 7.5 Store Health

- `HubHealthCard`
- `TerminalHealthGrid`
- `TerminalHealthCard`
- `PeripheralHealthList`
- `SyncBacklogCard`
- `LastGoodSyncCard`
- `SoftwareCompatibilityCard`
- `MobileCacheHealthCard`
- `SupportEscalationCard`

### 7.6 Controlled actions

- `ActionConfirmationSheet`
- `ReasonCodePicker`
- `ReauthenticationGate`
- `PermissionExplanation`
- `EvidenceUploader`
- `AuditConfirmationReceipt`

---

## 8. Domain rules and state machines

### 8.1 Entity hierarchy

```text
Tenant / Partner Account
  -> Digital Store (exactly one primary vertical: Laundry)
       -> Store Location (optional physical edge environment)
            -> Store Hub
                 -> T1 / T2 / T3 / T4 logical terminal roles
                 -> connected peripherals
```

The Partner App selects one Digital Store and one Store Location at a time.

### 8.2 Laundry Booking display state machine

```text
New
  -> Received
  -> Washing
  -> Drying
  -> Pressing
  -> Ready
  -> Picked Up
```

Additional states or flags:

```text
Cancelled
Issue
Rewash
Damaged
Missing Item
Pending Sync
```

Rules:

1. The mobile UI displays Pressing even when a legacy backend status is `ironing`.
2. The Partner App does not authoritatively transition production states in Phase 1.
3. T3 authoritative Ready Scan-In creates or confirms the Ready chain-of-custody event.
4. T4 authoritative Pickup Scan-Out creates or confirms the final pickup event.
5. An Issue/Rewash/Damaged state does not erase prior lifecycle history.
6. Cancelled or Picked Up records remain visible according to retention and permissions.

### 8.3 Ready pickup aging

The server contract must provide:

```text
ready_at
ready_age_seconds or ready_age_bucket
aging_policy_id or policy_version
data_as_of
truth_status
freshness_status
```

The client may display elapsed time but must not invent the authoritative Ready event or policy threshold.

### 8.4 Attention severity

Severity is server-provided. Suggested categories are not binding until approved:

```text
critical
high
normal
info
```

Examples of candidate critical conditions:

- Safety or severe quality issue.
- Store Hub unavailable beyond approved threshold.
- T1 unavailable during open hours with no fallback.
- Confirmed financial variance above approved threshold.
- Overdue Booking with escalation rule.

Thresholds remain `[REQUIRED: approved policy and evidence]`.

### 8.5 Money model

1. KHR values use integer minor units with currency exponent 0.
2. USD values use the authoritative shared money model and must not be converted client-side without an approved exchange-rate contract.
3. The app formats KHR with the Riel symbol U+17DB when supported and no decimal places.
4. Every Finance value carries currency, source, truth status, and data-as-of time.
5. Derived metrics are named for what they measure.
6. Finalized finance records are append-only or corrected through compensating records outside the app.

### 8.6 Allowed actions

Every Booking or attention detail response may include:

```json
{
  "allowed_actions": [
    {
      "action": "contact_customer",
      "enabled": true,
      "online_required": false,
      "reason": null
    },
    {
      "action": "add_note",
      "enabled": false,
      "online_required": true,
      "reason": "feature_not_enabled"
    }
  ]
}
```

The mobile client must not infer authorization from role name alone.

---

## 9. Data contracts and read models

### 9.1 Contract status rule

The names in this Part are target logical contracts. Live applied SQL wins for exact table and column names. Any mismatch must be recorded and resolved; the mobile client uses repository adapters and view models rather than direct table assumptions.

### 9.2 Accepted retained read-model inputs

Where available and verified, v2 may consume the accepted Partner projections already named in v1.1.0:

- `partner_store_memberships`
- `partner_orders_read`
- `partner_customers_read`
- `partner_services_read`
- `partner_service_addons_read`

They must be adapted to current Digital Store and Store Location context and T1-T4 terminology.

### 9.3 Proposed v2 logical read contracts

| Contract | Purpose | Status |
|---|---|---|
| `PartnerAppBootstrapV2` | User, memberships, contexts, permissions, flags, version policy. | Proposed target |
| `PartnerAppTodaySnapshotV2` | Today command center aggregate. | Proposed target |
| `PartnerAppAttentionPageV2` | Paginated unified attention queue. | Proposed target |
| `LaundryBookingSummaryV2` | Booking cards and lists. | Proposed target |
| `LaundryBookingDetailV2` | Booking detail. | Proposed target |
| `LaundryBookingTimelineV2` | Chain-of-custody and operational events. | Proposed target |
| `PartnerAppFinanceSnapshotV2` | Read-only Finance truth. | Proposed target |
| `PartnerAppStaffCoverageV2` | Staff and workload. | Proposed target |
| `PartnerAppInventoryAlertV2` | Consumable alert detail. | Proposed target |
| `PartnerAppCustomerSummaryV2` | Customer mini profile. | Proposed target |
| `PartnerAppStoreHealthV2` | Hub, T1-T4, peripherals, sync, and versions. | Proposed target |
| `PartnerAppAiBriefV2` | Permission-scoped AI brief with sources. | Proposed target |

### 9.4 Common response envelope

```json
{
  "data": {},
  "context": {
    "tenant_id": "uuid",
    "digital_store_id": "uuid",
    "location_id": "uuid",
    "vertical_code": "laundry"
  },
  "truth": {
    "status": "authoritative",
    "source": "partner_app_today_read_model_v2",
    "missing_fields": []
  },
  "freshness": {
    "status": "fresh",
    "data_as_of": "2026-07-24T09:00:00+07:00",
    "last_good_sync_at": "2026-07-24T08:59:50+07:00"
  },
  "permissions": {
    "capabilities": []
  },
  "request_id": "uuid"
}
```

### 9.5 Truth, freshness, and cache enums

Truth status:

```text
authoritative
partial
unavailable
unknown
```

Freshness status:

```text
fresh
pending_sync
stale
offline
unknown
```

Client data mode:

```text
live
last_known
none
```

These dimensions must remain separate.

### 9.6 `PartnerAppBootstrapV2`

Required fields:

```text
user
mobile_device
memberships[]
contexts[]
active_context
roles[]
capabilities[]
feature_flags[]
locale
currency_preferences
minimum_supported_app_version
recommended_app_version
cache_schema_version
session_policy
```

### 9.7 `PartnerAppTodaySnapshotV2`

Required sections:

```text
attention_summary
operational_status
booking_stage_counts
ready_pickup_aging
staff_coverage
capacity_pressure
finance_signals
inventory_risks
store_health_summary
ai_brief_summary
```

Each section has its own truth and freshness metadata so one missing domain does not invalidate the entire screen.

### 9.8 `LaundryBookingTimelineV2`

Required event fields:

```text
event_id
event_type
booking_id
status_before
status_after
occurred_at
recorded_at
actor_type
actor_user_id
actor_display_name
device_id
terminal_role
location_id
source_system
sync_state
reason_code
note_summary
evidence_count
```

Canonical terminal role values:

```text
t1_intake_cashier
t2_customer_display
t3_ready_scan_in
t4_pickup_scan_out
store_hub
cloud_service
partner_app
unknown
```

### 9.9 `PartnerAppFinanceSnapshotV2`

Required fields are nullable unless authoritative:

```text
truth_status
completeness_status
data_as_of
business_date
gross_billed_today
paid_amount_today
outstanding_balance
deposits_received
cash_received
khqr_received
other_tenders_received
refund_summary
void_summary
cash_variance
approval_preview_count
reconciliation_state
business_day_close_state
missing_fields[]
```

---

## 10. API specification

### 10.1 API family

Target internal Management API routes:

```text
/api/v1/partner-app/...
```

Existing unversioned v1.1 routes may remain behind compatibility adapters during migration. Product version v2.0.0 does not require an API v2 label by itself.

### 10.2 Shared request requirements

```http
Authorization: Bearer <supabase_jwt>
X-Request-Id: <uuid>
X-Device-Id: <uuid>
X-Digital-Store-Id: <uuid>
X-Location-Id: <uuid>
X-Idempotency-Key: <required for mutation routes>
Accept-Language: km-KH or en-US
```

### 10.3 Error envelope

```json
{
  "error": {
    "code": "permission_denied",
    "message": "You do not have access to this Store Location.",
    "details": {},
    "retryable": false
  },
  "request_id": "uuid"
}
```

### 10.4 Read routes

| Method and route | Purpose | Required scope |
|---|---|---|
| `GET /api/v1/partner-app/bootstrap` | Resolve session, contexts, capabilities, flags, and version policy. | Mobile-entitled role |
| `GET /api/v1/partner-app/today` | Today command center snapshot. | Role-scoped |
| `GET /api/v1/partner-app/attention` | Unified attention queue. | Role-scoped |
| `GET /api/v1/partner-app/attention/{id}` | Attention detail. | Object and context scope |
| `GET /api/v1/partner-app/bookings` | Booking list, filters, search, pagination. | Role-scoped |
| `GET /api/v1/partner-app/bookings/{id}` | Booking detail and allowed actions. | Object and context scope |
| `GET /api/v1/partner-app/bookings/{id}/timeline` | Chain-of-custody events. | Object and context scope |
| `GET /api/v1/partner-app/bookings/{id}/issues` | Issue list. | Role-scoped |
| `GET /api/v1/partner-app/finance` | Finance snapshot. | Finance capability |
| `GET /api/v1/partner-app/finance/approval-previews` | Non-mutating previews. | Review capability |
| `GET /api/v1/partner-app/staff-coverage` | Staff and workload. | Operations capability |
| `GET /api/v1/partner-app/inventory-alerts` | Laundry consumable alerts. | Inventory-view capability |
| `GET /api/v1/partner-app/customers/{id}/summary` | Customer mini profile. | Customer-view capability |
| `GET /api/v1/partner-app/store-health` | Hub, T1-T4, peripherals, sync, versions. | Health capability |
| `GET /api/v1/partner-app/services/availability` | Current service availability preview. | Operations capability |
| `GET /api/v1/partner-app/ai/daily-brief` | Source-linked AI brief. | AI capability |

### 10.5 Phase 1 mutation routes

| Method and route | Purpose | Rule |
|---|---|---|
| `POST /api/v1/partner-app/push/register` | Register or refresh mobile push token. | Idempotent |
| `POST /api/v1/partner-app/notifications/{id}/read` | Mark recipient notification read. | Does not resolve underlying exception |
| `POST /api/v1/partner-app/support/draft` | Draft support context when enabled. | P1-PILOT; consent and redaction |

### 10.6 Phase 1.5 mutation routes

These routes must return `feature_not_enabled` until separately approved and enabled:

| Method and route | Purpose |
|---|---|
| `POST /api/v1/partner-app/attention/{id}/acknowledge` | Append attention acknowledgement. |
| `POST /api/v1/partner-app/bookings/{id}/notes` | Append Booking note. |
| `POST /api/v1/partner-app/bookings/{id}/issues` | Create issue without financial side effects. |
| `POST /api/v1/partner-app/bookings/{id}/evidence` | Attach evidence through File Service contract. |
| `POST /api/v1/partner-app/services/emergency-pause` | Create time-bounded or open-ended emergency availability override. |
| `POST /api/v1/partner-app/services/emergency-resume` | End an emergency override. |

### 10.7 Prohibited Phase 1 routes

No Phase 1 Partner App route may:

- Capture or confirm payment.
- Generate KHQR.
- Approve refund or void.
- Approve cash variance.
- Finalize reconciliation.
- Change service price.
- Change staff role or permission.
- Adjust stock quantity.
- Control Hub or terminal.

---

## 11. Domain events and notifications

### 11.1 Events consumed by Partner App read models

```text
booking_created.v1
booking_status_changed.v1
booking_due_changed.v1
booking_issue_created.v1
booking_issue_updated.v1
booking_ready_scanned_in.v1
booking_pickup_scanned_out.v1
payment_recorded.v1
payment_status_changed.v1
cash_variance_detected.v1
inventory_threshold_crossed.v1
staff_clocked_in.v1
staff_clocked_out.v1
store_service_paused.v1
store_service_resumed.v1
hub_heartbeat_received.v1
terminal_heartbeat_received.v1
sync_delay_detected.v1
software_compatibility_changed.v1
notification_created.v1
```

### 11.2 Events produced by Phase 1 Partner App

```text
partner_app_session_started.v1
partner_app_context_selected.v1
partner_app_push_token_registered.v1
partner_app_notification_read.v1
partner_app_support_draft_created.v1
```

### 11.3 Phase 1.5 events

```text
partner_app_attention_acknowledged.v1
booking_note_added.v1
booking_issue_created_from_partner_app.v1
booking_evidence_added_from_partner_app.v1
store_service_emergency_paused_from_partner_app.v1
store_service_emergency_resumed_from_partner_app.v1
```

All events must be versioned, tenant-scoped, Digital Store and Location-scoped where applicable, idempotent, auditable, and retry-safe.

### 11.4 Notification categories

- Booking due soon.
- Booking overdue.
- Ready waiting too long.
- Issue/Rewash/Damage/Missing Item.
- Staff shortage or capacity pressure.
- Critical low stock.
- Cash variance.
- KHQR or payment-provider status problem.
- Store Hub offline.
- T1-T4 unavailable.
- Sync delayed.
- Data partial or stale.
- Notification delivery failure.
- Security or permission change.

---

## 12. Offline and cache specification

### 12.1 Cache classes

| Cache class | Contents | Offline availability |
|---|---|---|
| Bootstrap cache | Last valid contexts, capability shell, locale, version policy. | Limited; must revalidate before sensitive access. |
| Today cache | Last successful Today sections. | Browse only. |
| Booking list cache | Recent list pages and filters. | Browse only. |
| Booking detail cache | Recently opened authorized details. | Browse only. |
| Attention cache | Recent attention items. | Browse only. |
| Finance cache | Last authorized snapshot. | Browse only with strong last-known label. |
| Store Health cache | Last cloud-reported health. | Browse only; never presented as current physical state. |

### 12.2 Cache protection

- Use platform-protected secure storage for keys and sensitive metadata.
- Encrypt cached payloads at rest using approved mobile storage strategy.
- Do not cache provider secrets, service-role credentials, raw payment credentials, or raw POS PINs.
- Minimize customer PII in list caches.
- Apply retention and maximum-size policy `[REQUIRED: engineering and privacy approval]`.
- Clear cache on logout and security invalidation.

### 12.3 Offline action policy

Allowed offline:

- Browse cached screens.
- Use local search over already cached Booking summaries where implemented.
- Open device phone dialer from cached authorized contact information after explicit user action.

Blocked offline:

- Any mutation.
- Any financial decision.
- Emergency pause or resume.
- Evidence upload.
- Support submission.
- Permission-dependent action whose current authority cannot be revalidated.

### 12.4 Reconnect behavior

1. Reauthenticate or refresh session if needed.
2. Revalidate active membership and capabilities.
3. Revalidate cache schema and context version.
4. Refresh global truth/freshness status.
5. Refresh Today and Attention.
6. Refresh visible screen.
7. Remove inaccessible cache entries.
8. Do not replay blocked offline actions because Phase 1 does not queue business mutations.

---

## 13. Security, privacy, RBAC, and audit

### 13.1 Security boundaries

- Supabase Auth provides user session.
- PostgreSQL RLS or equivalent server enforcement is mandatory.
- The client never receives service-role credentials.
- DigitalOcean Spaces access uses File Service signed contracts.
- AI receives only permission-filtered context.
- Push payloads minimize sensitive data and rely on authenticated deep links.
- Store Hub and terminal certificates are never exposed as mobile command credentials.

### 13.2 Capability matrix

| Capability | Owner | Manager | Supervisor* | Accountant* | Readonly* |
|---|---:|---:|---:|---:|---:|
| Today non-financial | Yes | Yes | Yes | Limited | Yes |
| Booking list/detail | Yes | Yes | Yes | Limited | Yes |
| Chain-of-custody | Yes | Yes | Yes | Limited | Yes |
| Issue detail/evidence view | Yes | Yes | Yes | Limited | Yes |
| Finance snapshot | Yes | Limited | No | Yes | No by default |
| Approval previews | Yes | Conditional | No | Conditional | No |
| Staff coverage | Yes | Yes | Yes | Limited | Limited |
| Inventory alerts | Yes | Yes | Yes | View | Yes |
| Store Health | Yes | Yes | Yes | Yes | Yes |
| AI Daily Brief | Yes | Yes | Operations only | Finance only | Conditional |
| Add note/create issue | P1.5 | P1.5 conditional | P1.5 conditional | No | No |
| Emergency pause/resume | P1.5 | P1.5 conditional | No | No | No |

`*` Optional roles require explicit mobile entitlement.

### 13.3 Sensitive action requirements

Any Phase 1.5 action requires:

1. Current online session.
2. Current membership and capability check.
3. Active feature flag.
4. Reason code when applicable.
5. Human confirmation.
6. Reauthentication when policy requires it.
7. Idempotency key.
8. Request ID.
9. Immutable audit event.
10. Read-after-write verification.
11. Safe failure with no ambiguous success.

### 13.4 Audit fields

```text
audit_id
tenant_id
digital_store_id
location_id
actor_user_id
actor_role
mobile_device_id
action
target_type
target_id
reason_code
before_reference
after_reference
request_id
idempotency_key
created_at
```

### 13.5 Privacy rules

- Customer phone and financial context are permission-scoped.
- Support diagnostic packages require explicit consent and redaction policy.
- AI prompts and logs must not include more customer data than required.
- Notification payloads should avoid full customer names, phone numbers, or sensitive issue details on the lock screen.
- Screenshots and screen recording controls are `[REQUIRED: mobile security decision]` for sensitive Finance and customer screens.

---

## 14. AI behavior specification

### 14.1 AI role

AI may:

- Summarize.
- Explain.
- Prioritize.
- Identify patterns in approved read models.
- Draft a recommended action.
- Draft a support or manager note.

AI may not:

- Create authoritative Booking, payment, inventory, finance, staff, permission, or device truth.
- Execute sensitive actions.
- Hide source freshness or missing data.
- Present cached or incomplete values as live.
- Override role or Store scope.

### 14.2 AI response contract

```json
{
  "summary": "Three overdue Bookings need attention.",
  "severity": "high",
  "recommendations": [
    {
      "text": "Contact the customer for Booking BK-...",
      "action_type": "open_booking",
      "target_id": "uuid",
      "requires_confirmation": false
    }
  ],
  "sources": [
    {
      "type": "read_model",
      "name": "partner_app_attention_v2",
      "data_as_of": "2026-07-24T09:00:00+07:00"
    }
  ],
  "limitations": ["Finance data is partial."],
  "request_id": "uuid"
}
```

### 14.3 AI evaluation

Required evaluation categories:

- Source faithfulness.
- Correct context and role scope.
- No invented Finance values.
- Correct Booking and Pressing terminology.
- Correct T1-T4 terminology.
- Appropriate severity.
- Useful and safe recommendations.
- Clear limitations.
- Core app remains usable when AI fails.

---

## 15. Localization, accessibility, and design system

### 15.1 Localization

Required locales:

- Khmer (`km-KH`).
- English (`en-US` or approved KitLuy English locale).

Required rules:

- Asia/Phnom_Penh for business date and display time.
- KHR and USD formatting through shared money utilities.
- Cambodia E.164 phone normalization.
- Khmer strings may be wider than English and must not be truncated in critical actions.
- User-facing Laundry term is Booking.
- User-facing finishing term is Pressing.

### 15.2 Accessibility

- Support dynamic text within approved layout bounds.
- Provide accessibility labels for status, severity, money, and terminal health.
- Do not rely on color alone.
- Maintain touch targets appropriate for mobile use.
- Support screen-reader order for critical attention items.
- Confirm contrast ratios against final brand tokens.
- Provide text alternatives for evidence thumbnails and health icons.

### 15.3 Design tokens

Final values remain `[REQUIRED: KitLuy design system approval]`.

Required semantic tokens:

```text
surface_background
surface_card
text_primary
text_secondary
border_default
action_primary
status_success
status_warning
status_danger
status_info
status_stale
status_offline
status_partial
status_ai
```

---

## 16. Non-functional requirements

### 16.1 Reliability

- No blank operational screen when a valid protected cache exists.
- A failed section must not crash unrelated sections.
- Mutation responses must be unambiguous and idempotent.
- Push deep links must fail safely.
- Production builds must not silently fall back to demo data.

### 16.2 Performance targets

The following require engineering confirmation before becoming release SLOs:

| Metric | Proposed target | Status |
|---|---:|---|
| Warm start to usable cached shell | <= 1.5 seconds on pilot Android profile | `[REQUIRED: confirm]` |
| Cold start to usable shell | <= 3 seconds on pilot Android profile | `[REQUIRED: confirm]` |
| Today read p95 under pilot load | <= 2 seconds excluding offline network failure | `[REQUIRED: confirm]` |
| Booking list read p95 | <= 2 seconds for first page | `[REQUIRED: confirm]` |
| Crash-free sessions | >= 99.5 percent pilot | `[REQUIRED: confirm]` |
| Push deep-link resolution | <= 3 seconds after app ready | `[REQUIRED: confirm]` |

### 16.3 Scalability

- Pagination is required for Bookings, Attention, notifications, and issue history.
- Server-side filters and search must be index-supported.
- Mobile payloads should return compact read models, not full ledger records.
- One request must never aggregate unauthorized Stores or Locations.

### 16.4 Compatibility

Required values:

- Minimum iOS version: `[REQUIRED]`.
- Minimum Android version: `[REQUIRED]`.
- Expo SDK and React Native versions: `[REQUIRED: repository decision]`.
- Minimum backend contract version: returned by bootstrap.
- Forced update policy: `[REQUIRED: owner and release decision]`.

---

## 17. QA matrix

### 17.1 Core access and context

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-001` | Owner login | Authorized contexts and capabilities load. |
| `KPA2-QA-002` | Cashier login | Partner App access is denied by default. |
| `KPA2-QA-003` | Context switch | Data and cache switch without leakage. |
| `KPA2-QA-004` | Cross-Store payload injection | Repository rejects payload and does not cache it. |
| `KPA2-QA-005` | Role removal | Session or capability refresh hides restricted content and invalidates cache. |
| `KPA2-QA-006` | Deep link to unauthorized context | Safe denial or context selection; no data shown. |

### 17.2 Today and Attention

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-010` | Today full snapshot | All authorized sections render with section-level truth and freshness. |
| `KPA2-QA-011` | Partial Finance, healthy operations | Today shows operations and partial Finance notice; no zero substitution. |
| `KPA2-QA-012` | Needs Attention ordering | Server severity and priority order are preserved. |
| `KPA2-QA-013` | Attention drill-through | Opens correct scoped detail. |
| `KPA2-QA-014` | No attention items | Healthy empty state displays refresh time. |
| `KPA2-QA-015` | `manager_metrics_v2` disabled | Advanced metrics are absent without breaking base Today. |

### 17.3 Bookings and chain of custody

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-020` | Booking language audit | User-facing operational text uses Booking, not Order. |
| `KPA2-QA-021` | Pressing mapper | Legacy `ironing` renders as Pressing. |
| `KPA2-QA-022` | Booking filters | Each supported filter returns only matching scoped rows. |
| `KPA2-QA-023` | Phone search | Normalized Cambodian phone finds authorized customer Bookings. |
| `KPA2-QA-024` | T3 Ready event | Timeline identifies T3 Ready Scan-In and correct actor/device/time. |
| `KPA2-QA-025` | T4 pickup event | Timeline identifies T4 Pickup Scan-Out and completion. |
| `KPA2-QA-026` | Shared T3/T4 hardware | Logical roles remain separate in timeline and health. |
| `KPA2-QA-027` | Ready aging | Uses authoritative Ready time and policy; no client-invented event. |
| `KPA2-QA-028` | Issue history | Prior lifecycle events remain visible after issue or rewash. |
| `KPA2-QA-029` | Allowed actions | UI follows backend allowed-action contract. |

### 17.4 Finance

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-030` | Gross billed label | UI says Gross billed today and never Today's sales. |
| `KPA2-QA-031` | Missing Finance fields | Fields remain null/unavailable with missing list; no zeros. |
| `KPA2-QA-032` | Readonly role | Finance hidden by default. |
| `KPA2-QA-033` | Approval preview | Opening repeatedly causes no mutation or audit decision event. |
| `KPA2-QA-034` | Refund route attempt | Returns feature_not_enabled; no ledger or decision mutation. |
| `KPA2-QA-035` | Cash variance | Displays authoritative signed value and state; no approval control. |
| `KPA2-QA-036` | Cached Finance | Strong last-known label and timestamp are visible. |

### 17.5 Staff, inventory, customer

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-040` | Staff shortage | Coverage alert appears with inspectable inputs. |
| `KPA2-QA-041` | No staff read model | Section shows unavailable, not zero staff. |
| `KPA2-QA-042` | Low-stock consumable | Correct item, threshold, Location, freshness, and action link display. |
| `KPA2-QA-043` | Customer mini profile | Only authorized fields display. |
| `KPA2-QA-044` | Customer contact | Requires explicit tap and available data. |

### 17.6 Store Health

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-050` | Hub heartbeat stops | Health becomes stale/offline after approved threshold. |
| `KPA2-QA-051` | T1 offline | T1 alert appears without marking all other terminals offline. |
| `KPA2-QA-052` | T2 disconnected | Customer Display-specific state displays. |
| `KPA2-QA-053` | T3 scan pending sync | T3 shows pending sync and last scan. |
| `KPA2-QA-054` | T4 healthy | T4 health and last pickup scan display. |
| `KPA2-QA-055` | Peripheral unknown | Shows unknown/unavailable, not healthy. |
| `KPA2-QA-056` | Unsupported software | Compatibility warning appears; no direct update command. |
| `KPA2-QA-057` | Support draft | Consent, redaction, context, and audit pass when flag enabled. |

### 17.7 Offline and fail-closed

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-060` | Airplane mode after online load | Cached screens remain browseable with offline banner. |
| `KPA2-QA-061` | Offline no cache | Safe unavailable shell; no demo fallback. |
| `KPA2-QA-062` | Logout offline reopen | No sensitive cache accessible. |
| `KPA2-QA-063` | Cache schema mismatch | Cache is invalidated safely. |
| `KPA2-QA-064` | Production provider missing | App fails closed and does not display fixtures as live. |
| `KPA2-QA-065` | Offline mutation attempt | Action blocked before network mutation. |
| `KPA2-QA-066` | Reconnect membership revoked | Cached sensitive data is removed. |

### 17.8 Notifications and AI

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-070` | Push registration retry | Idempotent; one active token record per policy. |
| `KPA2-QA-071` | Booking push deep link | Opens correct authorized Booking. |
| `KPA2-QA-072` | Notification read | Recipient state changes; underlying exception does not. |
| `KPA2-QA-073` | AI source faithfulness | Summary matches approved read models and cites data-as-of. |
| `KPA2-QA-074` | AI missing Finance data | Explicitly states limitation; invents no values. |
| `KPA2-QA-075` | AI unavailable | Core screens continue without crash. |
| `KPA2-QA-076` | AI sensitive recommendation | Requires human action and does not execute. |

### 17.9 Localization and accessibility

| QA ID | Scenario | Pass condition |
|---|---|---|
| `KPA2-QA-080` | KHR formatting | Correct Riel formatting, grouping, and no decimals. |
| `KPA2-QA-081` | USD formatting | Uses shared currency rules. |
| `KPA2-QA-082` | Khmer layout | Critical labels and actions do not clip. |
| `KPA2-QA-083` | Screen reader | Critical status, severity, and money have meaningful labels. |
| `KPA2-QA-084` | Color independence | Status remains understandable without color. |

---

## 18. Monitoring and observability

### 18.1 Mobile metrics

- App starts and startup failures.
- Crash-free sessions.
- Screen-load latency.
- API error rate by route and code.
- Cache hit, miss, age, and invalidation reason.
- Context-switch success and failure.
- Push registration and deep-link success.
- Unauthorized or context-mismatch rejections.
- AI request latency, failure, source coverage, and cost.
- Feature flag exposure.

### 18.2 Backend and projection metrics

- Today snapshot build latency and failure.
- Attention queue lag.
- Booking projection lag.
- Finance read-model freshness and completeness.
- Hub heartbeat age.
- T1-T4 heartbeat age.
- Sync backlog.
- File signed-access failures.
- Notification delivery failures.
- RLS denial anomalies.

### 18.3 Alerting principles

- Alert on failure of truth pipelines, not merely UI symptoms.
- Separate Store-specific incidents from platform-wide incidents.
- Do not present monitoring estimates as authoritative business values.
- Include runbook link, owner, impact, and rollback or mitigation.

Thresholds are `[REQUIRED: production SLO and pilot evidence]`.

---

## 19. Delivery plan and phase gates

### 19.1 Execution sequence

| Work package | Output |
|---|---|
| WP0 - Authority and reconciliation | Approved terminology, Digital Store/Location model, T1-T4 correction, exclusions, and decision register. |
| WP1 - Contracts and repository seams | Bootstrap, context, truth/freshness envelope, read-model contracts, API schemas, provider/repository interfaces. |
| WP2 - Shell, auth, context, cache | Navigation, access gates, context switcher, protected cache, offline shell. |
| WP3 - Today, Attention, Bookings | Required screens, search, filters, detail, timeline, Ready aging. |
| WP4 - Finance, staff, inventory, customers | Read-only Finance, coverage, consumables, mini profile. |
| WP5 - Store Health and T1-T4 | Hub, terminals, peripherals, sync, software compatibility. |
| WP6 - Notifications and AI | Push, deep links, Daily Brief, explanations, failure fallback. |
| WP7 - Pilot-gated features | `manager_metrics_v2`, support escalation, advanced AI plan. |
| WP8 - Phase 1.5 contracts | Notes, issues, evidence, acknowledgement, emergency pause/resume, disabled by default. |
| WP9 - QA, security, pilot, release | Automated evidence, monitoring, support, rollback, training, Rebuild Test. |

### 19.2 Gate model

| Gate | Required evidence |
|---|---|
| G0 - Authority | Owner decisions, scope, terminology, T1-T4, Digital Store/Location model, exclusions, and open decisions are versioned. |
| G1 - Contract | Read models, API/events, permissions, truth/freshness, cache, audit, failure states, migration plan, and docs are approved. |
| G2 - Build | Mobile code, backend contracts, migrations, flags, components, and automated unit/component/contract tests exist in development. |
| G3 - Integrated verification | RLS, cross-context isolation, Store Hub/POS projections, finance truth, cache, notifications, AI safety, performance, and recovery tests pass. |
| G4 - Pilot readiness | Monitoring, alerts, rollback, app distribution, support, training, privacy, and go-live checklist are ready. |
| G5 - Phase exit / Rebuild Test | Pilot evidence is approved and one qualified engineer can reconstruct and operate the release from current docs and contracts. |

### 19.3 Feature flags

Required feature-flag candidates:

```text
partner_app_v2_shell
partner_app_attention_v2
partner_app_t1_t4_health
partner_app_booking_timeline_v2
partner_app_ready_aging
manager_metrics_v2
partner_app_support_diagnostics_v2
partner_app_ai_daily_brief_v2
partner_app_phase15_notes
partner_app_phase15_issues
partner_app_phase15_emergency_pause
```

Flags must not weaken RLS, permissions, or audit.

---

## 20. Go-live checklist

### 20.1 Authority and documentation

- [ ] Owner approves this specification or records changes.
- [ ] Digital Store and Store Location terminology is consistent.
- [ ] T1-T4 terminology is consistent across app, API, schema, QA, and support.
- [ ] Superseded Partner App and Suite text is reconciled.
- [ ] Feature inventory and source traceability are updated.

### 20.2 Backend and data

- [ ] Required read models exist and are versioned.
- [ ] RLS and negative isolation tests pass.
- [ ] Finance truth definitions are approved.
- [ ] Truth, freshness, and cache dimensions are present.
- [ ] Event and notification contracts are registered.
- [ ] Migrations are additive, reviewed, and applied by an authorized operator.
- [ ] No production claim relies only on planning documents.

### 20.3 Mobile

- [ ] iOS and Android bundle identifiers are approved.
- [ ] Signed builds are available for the pilot channel.
- [ ] Minimum-version policy works.
- [ ] Khmer and English pass UI review.
- [ ] KHR and USD formatting pass.
- [ ] Protected cache passes security review.
- [ ] Production composition cannot select demo providers.
- [ ] Deep links revalidate context and permission.

### 20.4 Store and edge integration

- [ ] Pilot Digital Store and Store Location are provisioned.
- [ ] Store Hub is active.
- [ ] T1, T2, T3, and T4 roles are assigned and reporting health.
- [ ] T3 Ready Scan-In events appear correctly.
- [ ] T4 Pickup Scan-Out events appear correctly.
- [ ] Peripheral and software status projections are verified.
- [ ] WAN outage and reconnect scenarios pass.

### 20.5 Finance and safety

- [ ] Gross billed label is correct.
- [ ] Missing values do not become zero.
- [ ] Finance remains read-only.
- [ ] Approval previews are non-mutating.
- [ ] Phase 1.5 routes are disabled by default.
- [ ] AI cannot execute sensitive actions.
- [ ] Audit and idempotency tests pass for enabled mutations.

### 20.6 Pilot and support

- [ ] Pilot Store and users are selected.
- [ ] Owner and manager training is complete.
- [ ] Support route and incident process are visible.
- [ ] Monitoring dashboards and alerts are active.
- [ ] Rollback plan and previous compatible build are available.
- [ ] Feedback and false-positive review cadence is defined.
- [ ] Rebuild Test is passed.

---

## Appendix A - Feature traceability

| v2 capability | Retained or new | Main source basis |
|---|---|---|
| Cockpit, not back office | Retained | Partner App v1.1.0 |
| Booking and Pressing terminology | Retained | Partner App v1.1.0 |
| Fail-closed providers | Retained | Partner App v1.1.0 |
| Protected last-known cache | Retained and deepened | Partner App v1.1.0; Lightspeed truth/freshness requirement |
| Read-only Finance | Retained and deepened | Partner App v1.1.0 |
| Digital Store and Location context | New reconciliation | Current owner Digital-First model |
| Needs Attention queue | New v2 feature | Existing attention-first goal; Loyverse usability adaptation |
| T1-T4 health center | New v2 feature | Owner-locked T1-T4 model |
| T1-T4 chain-of-custody timeline | New v2 feature | Owner-locked terminal events plus Booking detail baseline |
| Ready pickup aging | New v2 feature | Laundry operational deepening |
| Advanced manager metrics | New pilot-gated feature | Lightspeed backlog `KLS-BL-PAPP-001`; `manager_metrics_v2` |
| Support escalation with diagnostic context | New pilot-gated feature | Store Health and support diagnostics adaptation |
| Restaurant manager workflows | Deferred | Toast Phase 2 backlog |
| Commerce operations snapshot | Deferred to Phase 3 | WooCommerce/Shopify Partner App integration boundary |
| Duplicate Manager App | Rejected | Toast backlog guardrail |

---

## Appendix B - Open required decisions

| Decision ID | Required decision | Blocking scope |
|---|---|---|
| `KPA2-DEC-001` | Final iOS and Android bundle IDs and app store names. | Build and release |
| `KPA2-DEC-002` | Minimum iOS and Android versions. | Build and QA |
| `KPA2-DEC-003` | Final React Native, Expo, navigation, cache, and telemetry library versions. | Repository contract |
| `KPA2-DEC-004` | Final brand tokens, typography, iconography, and Khmer font behavior. | UI sign-off |
| `KPA2-DEC-005` | Cache retention, size, encryption implementation, and privacy policy. | Security and offline |
| `KPA2-DEC-006` | Heartbeat, stale, overdue, and Ready-aging thresholds. | Alerts and health |
| `KPA2-DEC-007` | Finance read-model definitions and business-day close fields available in Phase 1. | Finance |
| `KPA2-DEC-008` | Pilot SLOs and supported device performance profile. | Non-functional gate |
| `KPA2-DEC-009` | Push provider and notification privacy policy. | Notifications |
| `KPA2-DEC-010` | AI limits, evaluation thresholds, cost controls, and pilot entitlement. | AI |
| `KPA2-DEC-011` | Whether support diagnostic draft is included in first pilot or later. | P1-PILOT |
| `KPA2-DEC-012` | Phase 1.5 action approval and rollout sequence. | Mutations |

---

## Appendix C - Rejected and deferred patterns

### Rejected

- A second competitor-inspired Manager App.
- Direct Store Hub or terminal control from Partner App Phase 1.
- Unlabeled demo, cached, stale, partial, estimated, or AI-generated values presented as truth.
- Client-side permission inference as the only control.
- Destructive edits to finalized finance, payment, inventory, or audit records.
- Automatic AI execution of sensitive actions.

### Deferred

- Restaurant manager workflows to Phase 2.
- eCommerce and channel summaries to Phase 3.
- Retail manager workflows to Phase 4 and later vertical phases.
- Finance approval mutations until separately approved.
- Full support diagnostics until consent, redaction, security, and operator workflows are approved.

---

## Appendix D - Definition of Done

KitLuy Partner App Phase 1 v2.0.0 is complete only when:

1. Owner-approved scope and authority reconciliation are recorded.
2. Required schema/read-model and API contracts exist.
3. Digital Store, Location, user, role, and device isolation pass negative tests.
4. Today, Attention, Bookings, Finance, staff, inventory, customer, Store Health, notifications, AI, and offline behavior meet this specification.
5. T1-T4 events and health are correctly represented.
6. Finance truth and read-only policy pass tests.
7. Protected cache and fail-closed behavior pass security and recovery tests.
8. Monitoring, support, rollback, and release procedures are ready.
9. Pilot evidence is approved.
10. One qualified engineer passes the Rebuild Test using current documentation, contracts, migrations, and deployment instructions.

---

## Version history

| Version | Date | Change |
|---|---|---|
| v2.0.0 | 2026-07-24 | Proposed Phase 1 Laundry specification. Carries forward v1.1.0 safety and cockpit rules; reconciles Digital Store/Location and T1-T4 owner locks; adds unified Attention, chain-of-custody timeline, Ready aging, T1-T4 health, pilot-gated manager metrics, and implementation-grade contracts and gates. |
