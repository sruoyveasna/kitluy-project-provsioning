# KitLuy Storefront — Phase 1 Laundry Specification

**Filename:** `kitluy-storefront-phase1-spec-v1.1.0.md`  
**Version:** v1.1.0  
**Date:** 2026-07-25  
**Product:** `kitluy-storefront`  
**Phase:** Phase 1 — Laundry  
**Owner:** HET / KitLuy Suite Project Owner  
**Primary market:** Cambodia  
**Status:** OWNER-APPROVED TARGET SPECIFICATION — NOT IMPLEMENTATION EVIDENCE  
**Customer message:** **Scan, Prepare & Queue**  
**Primary channels:** Responsive Web Storefront, Store/Location QR, Telegram Bot + Telegram Mini App  
**Primary operational integration:** `kitluy-pos-desktop-app` T1/T2, Store Hub, Laundry Vertical Module, Notification Service  
**Languages:** Khmer and English  
**Currencies:** KHR and USD  
**Timezone:** `Asia/Phnom_Penh`

> **Mission:** Let a Laundry customer complete the repetitive preliminary intake steps before reaching T1, then let the cashier verify the customer and physical garments, create the authoritative Laundry Booking, and collect payment with fewer counter actions.

> **Rebuild Test:** A qualified engineer with no previous project context must be able to reconstruct the Phase 1 Storefront, its contracts, customer flows, T1/T2 integration, Store Hub behavior, security controls, QA matrix, deployment process, and operating runbooks from this specification and the referenced canonical KitLuy documents.

---

## Source authority and reconciliation

### Authority order

1. Current KitLuy Project Instructions and explicit project-owner decisions.
2. Applied migrations, verified repository code and executable tests for the target environment.
3. This Storefront Phase 1 specification for the approved v1.1.0 product target.
4. Current KitLuy Suite, Partner Portal, Partner App, POS and Store Hub specifications.
5. Approved comparison, classification and implementation-backlog documents.
6. Competitor rebuild documents as design references only.
7. Superseded planning.

No planning document, mockup, competitor design, or this specification may be used as evidence that a capability is implemented. Implementation status requires repository, applied migration, test, deployment, monitoring, and pilot evidence.

### Source baseline

| Source | Authority used in this specification |
|---|---|
| Current KitLuy Project Instructions | Eight-phase vertical roadmap, Digital Store control plane, one Store/one primary vertical, shared Core, offline Store Hub, Cambodia localization, evidence rules and completion gates. |
| `KitLuy Storefront v1.txt` | Owner-locked QR Pre-Intake, Telegram Shop and Virtual Queue capability; twenty locked feature IDs; customer/T1 authority boundary. |
| `KitLuy Suite Project.txt` | Digital Store-first operating model, Store Location as offline-capable edge environment, governed digital channels and KitLuy source-of-truth rules. |
| `kitluy-concept-design-1.txt` | Owner-locked T1–T4 Laundry terminal architecture. |
| `Device Management & Provisioning System.txt` | Store Hub-first provisioning, device trust and offline operation principles. |
| `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md` | One-Store back-office boundary, configuration ownership, authoritative read models and fail-closed truth rules. |
| `kitluy-partner-app-rebuild-bible-v1.1.0.md` | Booking terminology, freshness labeling and owner/manager cockpit boundary. |
| `kitluy-master-feature-registry-v0.2.md` | Storefront ownership and evidence discipline. |
| Shopify, WooCommerce, Toast, Lightspeed and Loyverse comparison/backlog packages | Supporting design patterns, phase gates and QA expectations; never product truth by themselves. |

### Phase reconciliation

The master roadmap places the complete hosted commerce Storefront in Phase 3. The owner decision dated 2026-07-25 authorizes a narrower Phase 1 Laundry capability:

- public Store/Location entry through QR or link;
- Web and Telegram customer pre-intake;
- phone verification;
- physical Store queue check-in;
- T1 verification and correction;
- T2/web/Telegram customer confirmation;
- atomic conversion into an authoritative Laundry Booking;
- payment at T1 after conversion.

This v1.1.0 specification does **not** pull the full Phase 3 commerce platform into Phase 1. It is a Laundry-specific customer-assisted intake surface built on shared neutral contracts where confirmed reuse exists.

### Superseded conflict rule

Any source that still describes a three-terminal Laundry model is superseded. The authoritative model is:

| Terminal | Role |
|---|---|
| T1 | POS Cashier / Intake Terminal |
| T2 | Customer Display Screen |
| T3 | Clean & Ready Scan-In Terminal |
| T4 | Customer Pickup Scan-Out Terminal |

---

# Part 0 — Rebuild sequence

Execute in dependency order. Exact environment IDs, domains, credentials and migration numbers must be supplied before production deployment.

1. **Confirm authority and scope**
   - Register the v1.1.0 owner decision.
   - Confirm this is a Phase 1 Laundry capability, not a general eCommerce Storefront.
   - Confirm remote active-queue joining is disabled by default.
   - Confirm online prepayment is out of scope for v1.1.0.

2. **Confirm shared foundations**
   - Tenant, Digital Store, Store Location, customer, service catalog and Booking identities.
   - T1/T2 role contracts.
   - Store Hub sync, device identity, RLS, audit, files and notifications.
   - Core money, pricing, payment and finalized-document rules.

3. **Create additive database migrations**
   - Add Storefront publication, entry-point, pre-intake, queue, verification, confirmation and conversion relations.
   - Add RLS, indexes, constraints, idempotency records and audit triggers.
   - Do not alter finalized Booking/payment tables destructively.
   - Migration filenames: `[REQUIRED: reconcile with live migration history]`.

4. **Seed Phase 1 reference data**
   - Queue states and reason codes.
   - Pre-intake statuses.
   - confirmation methods.
   - origin channels.
   - default expiry policies.
   - Khmer and English customer copy.

5. **Implement Commerce Store API Phase 1 subset**
   - Public catalog and Location status reads.
   - customer session and phone verification.
   - pre-intake draft create/update/submit.
   - physical check-in and queue status.
   - customer confirmation and Booking status access.

6. **Implement Store Hub and Edge Operations integration**
   - Project actionable pre-intakes and queue tickets to the Store Hub.
   - Allow T1 to call, verify, correct, confirm and convert.
   - Keep local T1 staff-assisted intake available during WAN failure.
   - Reconcile cloud-created pre-intakes without duplication.

7. **Implement Web Storefront**
   - Responsive React/PWA customer surface.
   - Khmer/English and KHR/USD presentation.
   - QR entry, service selection, pre-intake, check-in and queue tracking.

8. **Implement Telegram channel**
   - Bot entry point and Mini App launch.
   - Server-validated channel identity.
   - Same KitLuy APIs, workflows and truth boundaries as Web.
   - Telegram credentials: `[REQUIRED: Bot identity, Mini App URL and production secrets]`.

9. **Implement T1 and T2 changes**
   - T1 Pre-Intake Queue workspace.
   - customer-versus-T1 difference view.
   - final intake confirmation on T2/web/Telegram.
   - atomic conversion to Booking before payment.

10. **Run verification**
    - unit, contract, RLS, idempotency, privacy, offline, reconciliation, accessibility, performance and recovery tests.
    - cross-product end-to-end pilot.

11. **Deploy through staged release**
    - Internal → Pilot → Stable.
    - feature flags per Digital Store and Store Location.
    - rollback without losing accepted pre-intakes or queue events.

12. **Pass the Rebuild Test and go-live gate**
    - evidence package approved by the authorized owner/operator.
    - support and recovery runbooks tested.
    - no capability labeled implemented before evidence exists.

---

# Part 1 — Product definition and boundaries

## 1.1 Product statement

`kitluy-storefront` v1.1.0 is a customer-facing Laundry pre-intake and virtual-queue surface. It provides the familiar interaction pattern of a modern restaurant QR menu while preserving Laundry-specific physical verification and custody controls.

The customer may prepare the intended service request before the cashier interaction. T1 remains responsible for inspecting the actual garments, measuring quantity or weight, recording condition, confirming capacity and due time, producing the final price, creating the authoritative Booking and collecting payment.

## 1.2 Customer value

- less repetitive data entry at the counter;
- shorter T1 service time;
- clear queue position and call status;
- Khmer/English self-service;
- transparent comparison between customer estimates and verified intake;
- reusable customer phone identity;
- convenient access through browser, QR or Telegram.

## 1.3 Partner value

- faster counter throughput;
- reduced cashier typing errors;
- structured customer-provided information;
- better demand and queue visibility;
- auditable correction history;
- channel attribution;
- staff-assisted fallback when customer channels fail.

## 1.4 What the product is

- a public Laundry service catalog projection;
- a customer pre-intake draft tool;
- a Store/Location-aware QR entry surface;
- a Telegram Mini App channel using KitLuy contracts;
- a physical Store check-in and virtual queue;
- a T1 verification accelerator;
- a customer confirmation surface;
- a secure status and notification surface.

## 1.5 What the product is not

- not the KitLuy B2B marketing and Partner signup website;
- not the Partner Portal;
- not a replacement for T1 or T2;
- not a full Phase 3 eCommerce Storefront;
- not an independent Telegram-owned shop;
- not an authoritative payment, finance, inventory or customer database;
- not a guarantee that customer estimates will be accepted;
- not a remote garment-custody event;
- not an online prepayment surface in v1.1.0;
- not a general CMS, blog, theme marketplace or app marketplace.

## 1.6 Canonical authority boundary

| Information | Customer may propose | T1/KitLuy authority |
|---|---:|---:|
| Phone and name | Yes | Phone must be verified or staff-confirmed |
| Intended service | Yes | T1 confirms or changes it |
| Estimated pieces/bags/weight | Yes | T1 records actual count/weight |
| Stains/damage notes | Yes | T1 records observed condition |
| Add-ons | Yes | T1 confirms eligibility and price |
| Due-time preference | Yes | T1/Store capacity confirms commitment |
| Estimated price | Storefront may show a range | T1 creates final price snapshot |
| Queue position | KitLuy issues it | Queue engine controls status |
| Laundry Booking | No | Created only after verification and confirmation |
| Payment/deposit | No in v1.1.0 | T1 initiates after Booking creation |
| Garment custody | No | Begins only when T1 accepts items |

## 1.7 Primary success measures

Targets must be established from pilot evidence rather than guessed in this document.

| Metric | Required definition |
|---|---|
| T1 intake time saved | Median verified-intake duration for Pre-Intake versus staff-entered intake. |
| Draft conversion rate | Submitted Pre-Intakes converted to authoritative Bookings. |
| Customer correction rate | Percentage of submitted lines changed by T1. |
| Queue abandonment | Checked-in tickets that expire, cancel or become no-show. |
| Duplicate prevention | Duplicate submissions safely deduplicated. |
| Phone verification success | Verified customer sessions divided by attempted sessions. |
| Offline recovery accuracy | Cloud and Hub records reconcile without duplicate Booking creation. |
| Customer confirmation success | Verified intakes confirmed through T2/web/Telegram/staff-assisted path. |

Exact targets: `[REQUIRED: pilot-approved KPI thresholds]`.

---

# Part 2 — Users, actors and permissions

## 2.1 Customer actors

| Actor | Access | Capabilities |
|---|---|---|
| Guest customer | Public link or QR | Browse published Store/Location and services; start phone verification. |
| Verified customer | Verified phone session | Create and manage own Pre-Intake, check in, view own queue, confirm own verified intake, view linked Booking status. |
| Telegram-linked customer | Validated Telegram session plus verified phone | Same capabilities as verified Web customer; Telegram is an access channel only. |
| Assisted customer | Staff-managed at T1 | Staff creates or links a Pre-Intake/Booking with audited assisted reason. |

## 2.2 Store actors

| Role | Default capability |
|---|---|
| `cashier` / T1 operator | View Location queue, call customer, verify intake, record corrections, request customer confirmation, convert to Booking, collect payment under existing POS permissions. |
| `store_manager` | All cashier capabilities plus queue-policy overrides, no-show/expiry adjustments, feature configuration within Partner scope and exception review. |
| `partner_owner` | Storefront publication, Location participation, queue policy and reporting through Partner Portal. |
| `supervisor` | Queue operations and exception handling only if explicitly granted. |
| `laundry_staff` | No Storefront customer-data access by default. |
| `accountant` | No queue/intake mutation access by default; may view finalized Booking/payment reports according to existing finance permissions. |
| HET support/admin | No customer impersonation or mutation without approved support-consent workflow and audit. |

## 2.3 System actors

- Commerce Store API Phase 1 subset;
- Customer Identity/Phone Verification service;
- Storefront Web client;
- Telegram Bot/Mini App connector;
- Notification Service;
- File Service;
- Store Hub sync service;
- T1 and T2 clients;
- Audit/Event service;
- Payment service after Booking conversion.

## 2.4 Permission principles

- deny by default;
- scope every record to Tenant, Digital Store and Store Location;
- customers access only token- or identity-linked records;
- queue display numbers are not authorization tokens;
- T1 may mutate only assigned Location queue/intake records;
- final Booking/payment corrections use existing authorized compensating workflows;
- every override requires actor, reason, device, timestamp and previous/new state.

---

# Part 3 — Canonical business concepts and state machines

## 3.1 Pre-Intake Draft

A mutable customer-provided preliminary request. It may contain intended services, estimated items, estimated weight, notes, photos, fulfilment preference and preferred timing. It is not a Booking and has no financial finality.

### Pre-Intake states

```text
DRAFT
  -> SUBMITTED
  -> CHECKED_IN
  -> IN_VERIFICATION
  -> VERIFIED
  -> CUSTOMER_CONFIRMED
  -> CONVERTED_TO_BOOKING

DRAFT/SUBMITTED/CHECKED_IN
  -> CANCELLED
  -> EXPIRED
  -> REJECTED
```

Rules:

- `DRAFT` is editable by the owning customer session.
- `SUBMITTED` freezes a customer-submission version but T1 corrections are stored separately.
- `CHECKED_IN` means the customer has joined a specific Location queue.
- `IN_VERIFICATION` is controlled by T1.
- `VERIFIED` contains T1-authoritative intake values but is not yet a Booking.
- `CUSTOMER_CONFIRMED` records acceptance of the verified intake.
- `CONVERTED_TO_BOOKING` is terminal and links exactly one authoritative Booking.
- cancellation or expiry after verification requires an audited reason.

## 3.2 Queue Ticket

A Location- and business-day-scoped waiting record linked to one Pre-Intake or staff-assisted intake context.

### Queue states

```text
PREPARED
  -> CHECKED_IN
  -> WAITING
  -> CALLED
  -> SERVING
  -> VERIFYING
  -> CUSTOMER_CONFIRMED
  -> CONVERTED_TO_BOOKING

WAITING/CALLED
  -> SKIPPED
  -> RECALLED
  -> NO_SHOW
  -> EXPIRED
  -> CANCELLED

ANY NONTERMINAL STATE
  -> REJECTED  [authorized reason required]
```

### Queue invariants

- number uniqueness is scoped by Tenant + Digital Store + Store Location + counter + business date;
- a display number may be reused on a later business date but never identifies a customer by itself;
- a queue ticket must have an immutable event history;
- T1 cannot convert the same ticket twice;
- default remote active-queue join is disabled;
- check-in must prove presence through a Location QR, Location code, staff activation or an owner-approved remote-queue policy;
- skip, recall, no-show and expiry policies are configurable within approved limits.

## 3.3 Verified Intake

A T1-produced version of the intake that records actual customer, garments, quantities, weights, condition, services, add-ons, due-time commitment and final price inputs.

The customer-submitted version is never overwritten. Differences are stored explicitly.

## 3.4 Customer Confirmation

A signed business event acknowledging the verified intake before Booking creation and payment.

Supported methods:

- T2 interaction;
- Web Storefront token;
- Telegram Mini App token;
- printed summary with staff-recorded confirmation;
- staff-assisted verbal confirmation with reason and actor audit.

Customer confirmation is not payment authorization.

## 3.5 Laundry Booking

The authoritative operational transaction created only after the verified intake and customer confirmation pass validation. Existing Core/Laundry Booking, payment, receipt, tag and custody contracts remain authoritative.

## 3.6 Atomic conversion

The conversion transaction must:

1. lock the Pre-Intake and Queue Ticket;
2. verify they are eligible and not already converted;
3. validate the latest verified-intake version;
4. validate customer confirmation;
5. create the Booking and Booking lines;
6. create price and due-time snapshots;
7. link customer, Location and channel attribution;
8. create conversion and audit events;
9. mark Pre-Intake and Queue Ticket converted;
10. return the existing Booking when the same idempotency key is retried.

Any failure must roll back the conversion transaction without leaving a partial Booking.

## 3.7 Channel attribution

Canonical origin values:

```text
WEB_STOREFRONT
STORE_QR
TELEGRAM_MINI_APP
TELEGRAM_BOT_LINK
SOCIAL_LINK
DIRECT_LINK
STAFF_ASSISTED
```

Origin attribution is analytical context. It never changes authority, pricing, payment or finance rules.

---

# Part 4 — Customer and staff journeys

## 4.1 Web/QR customer journey

```text
Scan Location QR
  -> Resolve Digital Store and Store Location
  -> Show open/closed/degraded status and freshness
  -> Browse published Laundry services
  -> Verify phone
  -> Enter preliminary garments/services
  -> Review non-final estimate and conditions
  -> Submit Pre-Intake
  -> Check in at Store
  -> Receive queue number
  -> Follow queue status
  -> Present signed QR/queue reference to T1
  -> Review T1-verified intake
  -> Confirm
  -> T1 creates Booking and collects payment
```

## 4.2 Telegram customer journey

```text
Open approved KitLuy Store bot or deep link
  -> Launch Telegram Mini App
  -> Backend validates channel launch payload
  -> Resolve Store/Location context
  -> Obtain or verify customer phone
  -> Use the same Pre-Intake and queue flow as Web
  -> Receive queue/status notifications according to consent
```

Telegram account identity alone never establishes phone ownership or customer-record ownership.

## 4.3 Prepare-before-arrival journey

A customer may submit a Pre-Intake from anywhere. The result is `SUBMITTED`, not an active queue position. The customer joins the physical Location queue only after approved check-in.

## 4.4 Walk-in check-in journey

A customer scans the current Location check-in QR or enters a Location code, verifies the Pre-Intake reference, and receives a Queue Ticket. The Storefront shows customers ahead only when the configured policy allows it and the value is fresh.

## 4.5 T1 journey

```text
Open Pre-Intake Queue
  -> Select/call ticket
  -> Scan signed customer QR or verify phone/reference
  -> Start service
  -> Inspect garments
  -> Record actual pieces/weight/condition
  -> Confirm or change services/add-ons
  -> Set due time from current capacity
  -> Produce final price preview
  -> Show difference summary
  -> Request customer confirmation
  -> Convert atomically to Booking
  -> Proceed to deposit/payment
  -> Print receipt and garment/bag tags
```

## 4.6 T2 journey

T2 may show:

- masked customer identity;
- intended versus verified services;
- actual quantity/weight;
- condition notes approved for customer display;
- discounts/taxes if applicable;
- final total;
- due-time commitment;
- confirmation action;
- after Booking creation: deposit/balance, KHQR, payment status, receipt choice and pickup reference.

T2 cannot call queue tickets, edit intake, create a Booking or confirm payment.

## 4.7 Staff-assisted fallback

When Web, Telegram or cloud access is unavailable, T1 creates a normal staff-assisted Intake Draft locally through the Store Hub. The system records `STAFF_ASSISTED` attribution and an optional reason. Local operation must not wait for the Storefront to recover.

## 4.8 Exception journeys

- customer arrives without phone access;
- phone verification provider unavailable;
- duplicate Pre-Intake submitted;
- customer checks into wrong Location;
- Store closes after submission;
- queue is paused or capacity is full;
- customer is no-show then returns;
- T1 discovers prohibited/unsupported items;
- customer rejects T1 corrections;
- conversion succeeds but customer delays payment;
- cloud submission arrives after a local staff-assisted Booking already exists.

Each exception requires a deterministic outcome, user-facing explanation and auditable reason.

---

# Part 5 — System architecture and topology

## 5.1 Logical topology

```text
Customer Browser / Telegram Mini App
              |
              v
      KitLuy Storefront Web
              |
              v
 Commerce Store API — Phase 1 subset
    |          |           |
    v          v           v
Customer    Catalog     Pre-Intake/Queue
Identity    Projection       Service
    |          |           |
    +----------+-----------+
               |
               v
      Supabase PostgreSQL/RLS
               |
        Event/Job/Notification
               |
               v
       Cloud <-> Store Hub Sync
                       |
          +------------+------------+
          v                         v
      T1 Intake/POS              T2 CDS
          |
          v
 Authoritative Laundry Booking
          |
          v
 Payment / Receipt / Tags / Custody
```

## 5.2 Authority flow

- Configuration flows from the Digital Store to Storefront and Store Hub.
- Customer Pre-Intakes enter KitLuy through governed APIs.
- Actionable queue/intake data projects to the Store Hub.
- T1 verification and Booking creation are Store operations.
- Operational events return to cloud asynchronously.
- External channels never own customer, queue, Booking, payment or finance truth.

## 5.3 Cloud responsibilities

### Supabase

- authentication and verified customer sessions;
- PostgreSQL authoritative relations;
- RLS and permissions;
- Realtime where appropriate;
- metadata and audit/event records;
- Edge Functions or API-facing database services where approved.

### DigitalOcean

- Storefront application hosting;
- API/worker hosting where not placed in Supabase;
- notification and synchronization workers;
- DigitalOcean Spaces for customer-uploaded evidence files;
- release artifacts, monitoring and operational services.

Exact environment topology: `[REQUIRED: approved deployment architecture and domains]`.

## 5.4 Store Hub responsibilities

- local operational authority after provisioning;
- actionable queue and Pre-Intake projection;
- T1/T2 LAN operation;
- local idempotency and conversion protection;
- local event outbox and cloud reconciliation;
- operational file cache where required;
- no dependency on Telegram or Storefront availability for local intake.

## 5.5 Client responsibilities

| Client | Responsibility |
|---|---|
| Web Storefront | Customer-facing browsing, pre-intake, check-in, queue and confirmation. |
| Telegram Mini App | Alternative shell over the same KitLuy contracts. |
| T1 | Staff queue, verification, Booking conversion and payment. |
| T2 | Customer-facing verified-intake and payment presentation. |
| Partner Portal | Storefront/Location publication, queue policy, service projection and diagnostics. |
| Partner App | Read-only or limited operational summary only when explicitly specified; not a Storefront configuration surface. |

## 5.6 Failure domains

| Failure | Required behavior |
|---|---|
| Telegram unavailable | Web and T1 remain usable. |
| Storefront unavailable | T1 staff-assisted intake remains usable. |
| WAN unavailable at Store | T1/T2 continue through Store Hub; new remote customer submissions cannot be assumed available locally. |
| Store Hub unavailable | T1/T2 fail closed according to POS recovery policy; Storefront must not claim live counter capacity. |
| Phone provider unavailable | Existing verified sessions may continue within policy; new verification fails clearly or uses authorized staff-assisted fallback. |
| Notification provider unavailable | Queue/Booking truth remains valid; delivery state is `QUEUED` or `FAILED`, never falsely `SENT`. |
| Cloud-to-Hub lag | Storefront displays freshness/degraded state and prevents unsafe promises. |

---

# Part 6 — Canonical data contracts

## 6.1 Data-model rules

1. Authoritative data uses relational tables.
2. JSON is permitted only for optional channel metadata or provider payload snapshots; it must not replace typed customer, queue, intake, Booking, payment or audit fields.
3. Every tenant-owned relation carries Tenant, Digital Store and, where applicable, Store Location scope.
4. All primary records use globally unique identifiers compatible with offline-safe KitLuy identity rules.
5. All timestamps are timezone-aware and stored in UTC; display uses `Asia/Phnom_Penh` unless Store configuration says otherwise.
6. Money uses the existing KitLuy Core money contract. The Storefront must not introduce another representation.
7. Quantities and weights use the existing Core quantity/UOM contract.
8. Customer-submitted and T1-verified values are separate immutable versions after submission/verification.
9. Final Booking, payment, receipt, inventory and audit records remain append-only; corrections use compensating records.
10. All public mutations require idempotency.

## 6.2 Logical relation inventory

Exact physical schema names must be reconciled with the applied database. The logical contracts below are binding for v1.1.0 behavior.

| Logical relation | Purpose |
|---|---|
| `storefront_publications` | Published Storefront state for one Digital Store. |
| `storefront_location_publications` | Per-Location public status, hours and participation. |
| `storefront_entry_points` | Web, QR, Telegram and campaign entry definitions. |
| `storefront_qr_codes` | Signed Store/Location QR records, version and revocation state. |
| `customer_channel_identities` | Customer linkage to verified phone and optional channel identities. |
| `customer_phone_challenges` | Phone verification challenge lifecycle and rate-limit metadata. |
| `customer_sessions` | Short-lived customer access sessions and scopes. |
| `pre_intake_drafts` | Header for customer preliminary intake. |
| `pre_intake_lines` | Services, garments, estimated pieces/weight and notes. |
| `pre_intake_evidence_files` | Customer-uploaded photos/files linked through File Service. |
| `pre_intake_versions` | Immutable customer-submission snapshots. |
| `queue_counters` | Location queue counter definitions. |
| `queue_policies` | Check-in, expiry, no-show, remote-join and display policies. |
| `queue_tickets` | Waiting record and current state. |
| `queue_events` | Append-only queue state history. |
| `intake_verifications` | T1 verification header and status. |
| `intake_verification_lines` | T1 actual values and differences from submitted values. |
| `customer_confirmations` | Confirmation method, payload hash and actor context. |
| `pre_intake_booking_conversions` | Exactly-once link from verified Pre-Intake to authoritative Booking. |
| `storefront_status_snapshots` | Published availability/freshness snapshot. |
| `channel_attributions` | Origin/referrer/campaign context. |
| `notification_preferences` | Customer consent and channel preferences. |
| `idempotency_records` | Request key, scope, response reference and expiry. |

Existing Core relations remain authoritative for:

- Tenant, Digital Store and Store Location;
- services, add-ons and pricing;
- customer and consent;
- Laundry Booking and Booking lines;
- payments, deposits, refunds and balances;
- receipts and garment/bag tags;
- files and permissions;
- events, jobs and audit;
- users, roles and devices.

## 6.3 `storefront_publications`

| Field | Requirement |
|---|---|
| `id` | Unique identifier. |
| `tenant_id` | Required tenant scope. |
| `digital_store_id` | Required and unique per active publication version. |
| `vertical_code` | Must equal Laundry for v1.1.0 activation. |
| `status` | `DRAFT`, `PUBLISHED`, `PAUSED`, `UNPUBLISHED`, `DEGRADED`. |
| `default_locale` | `km` or `en`. |
| `supported_locales` | Typed relation or validated list; minimum Khmer/English. |
| `supported_currencies` | Must use Digital Store currency configuration. |
| `published_version` | Monotonic publication version. |
| `published_at` | Nullable until published. |
| `published_by` | Authorized Partner actor. |
| `created_at`, `updated_at` | Required. |

## 6.4 `storefront_entry_points`

| Field | Requirement |
|---|---|
| `entry_type` | `WEB`, `STORE_QR`, `LOCATION_QR`, `TELEGRAM`, `SOCIAL`, `DIRECT`, `CAMPAIGN`. |
| `digital_store_id` | Required. |
| `store_location_id` | Required for Location-bound entry. |
| `slug_or_code` | Public-safe opaque value; no raw internal identifiers. |
| `signed_context_version` | Version of signing/validation contract. |
| `active_from`, `active_until` | Optional validity period. |
| `revoked_at` | Stops future use. |
| `campaign_code` | Optional attribution only. |

## 6.5 `pre_intake_drafts`

| Field | Requirement |
|---|---|
| `id` | Unique Pre-Intake ID. |
| `public_reference` | Customer-friendly reference; not an authorization secret. |
| `tenant_id`, `digital_store_id` | Required. |
| `store_location_id` | Target Location; nullable only before Location selection. |
| `customer_id` | Nullable until identity resolution. |
| `verified_phone_id` | Required before submission unless authorized assisted fallback. |
| `origin_channel` | Canonical channel value. |
| `status` | Pre-Intake state machine value. |
| `preferred_locale` | Customer language. |
| `fulfilment_preference` | Phase 1 values approved for Laundry; does not promise fulfilment. |
| `preferred_time_window` | Customer preference only. |
| `estimate_currency` | Core currency code. |
| `estimate_min`, `estimate_max` | Nullable non-final estimate using Core money type. |
| `estimate_as_of` | Required when estimate exists. |
| `estimate_freshness_status` | `CURRENT`, `STALE`, `UNAVAILABLE`. |
| `submitted_version` | Latest immutable customer snapshot number. |
| `expires_at` | Required according to policy. |
| `created_at`, `updated_at`, `submitted_at` | Required as applicable. |

## 6.6 `pre_intake_lines`

| Field | Requirement |
|---|---|
| `pre_intake_id` | Required parent. |
| `line_number` | Stable within draft version. |
| `service_id` | Published service reference. |
| `garment_type_id` | Optional customer selection. |
| `estimated_piece_count` | Nullable. |
| `estimated_weight` | Nullable and paired with UOM. |
| `estimated_bag_count` | Nullable. |
| `requested_addons` | Typed child relation preferred. |
| `stain_note` | Customer-provided text. |
| `damage_note` | Customer-provided text. |
| `handling_note` | Customer-provided text. |
| `customer_display_order` | Stable ordering. |

At least one valid service line is required for submission. Customer estimates may not populate final Booking quantity/weight without T1 verification.

## 6.7 `queue_tickets`

| Field | Requirement |
|---|---|
| `id` | Unique ticket ID. |
| `tenant_id`, `digital_store_id`, `store_location_id` | Required scopes. |
| `queue_counter_id` | Required. |
| `business_date` | Store operational date. |
| `display_prefix` | Example `A`; configured by counter. |
| `display_number` | Sequential within scope. |
| `display_label` | Example `A-027`. |
| `pre_intake_id` | Required unless staff-assisted queue-only flow is approved. |
| `status` | Queue state. |
| `priority_class` | Default standard; nonstandard priority requires approved policy and audit. |
| `checked_in_at`, `called_at`, `serving_at`, `closed_at` | As applicable. |
| `current_position_hint` | Derived/cache only; not authoritative history. |
| `assigned_t1_device_id` | Nullable until serving. |
| `assigned_staff_user_id` | Nullable until serving. |
| `version` | Optimistic concurrency/version value. |

Unique constraint:

```text
(tenant_id, digital_store_id, store_location_id, queue_counter_id, business_date, display_prefix, display_number)
```

## 6.8 `queue_events`

Required fields:

- queue ticket ID;
- previous and new state;
- event type;
- actor type and actor ID;
- device ID where applicable;
- reason code and optional note;
- source channel;
- occurred timestamp;
- idempotency key;
- correlation ID;
- sync origin and sync status.

Events are append-only.

## 6.9 `intake_verifications`

| Field | Requirement |
|---|---|
| `id` | Unique verification. |
| `pre_intake_id`, `queue_ticket_id` | Required. |
| `store_location_id` | Required. |
| `t1_device_id`, `staff_user_id` | Required. |
| `status` | `IN_PROGRESS`, `READY_FOR_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `CANCELLED`. |
| `customer_phone_verified` | Boolean plus verification method reference. |
| `actual_total_piece_count` | Derived from verified lines. |
| `actual_total_weight` | Nullable, Core quantity/UOM. |
| `final_currency` | Core currency. |
| `final_amount_preview` | Final pre-Booking price preview. |
| `due_at_preview` | Proposed due commitment. |
| `verification_version` | Monotonic version. |
| `started_at`, `completed_at` | Required as applicable. |

## 6.10 `intake_verification_lines`

Each line stores:

- source customer line reference, if any;
- actual service and garment type;
- actual pieces, weight and UOM;
- approved add-ons;
- observed stain/damage/handling notes;
- price calculation inputs and preview;
- customer-submitted value snapshot hash;
- difference type;
- adjustment reason when a material value changed;
- staff and device context.

## 6.11 `customer_confirmations`

| Field | Requirement |
|---|---|
| `intake_verification_id` | Required. |
| `confirmation_method` | `T2`, `WEB`, `TELEGRAM`, `PRINTED`, `STAFF_VERBAL`. |
| `customer_id` | Required when resolved. |
| `customer_session_id` | Required for digital confirmation. |
| `confirmed_version` | Exact verification version accepted. |
| `summary_hash` | Hash of displayed verified summary. |
| `confirmed_at` | Required. |
| `staff_reason_code` | Required for `STAFF_VERBAL`. |
| `evidence_file_id` | Optional approved evidence. |

A confirmation becomes invalid if T1 changes any confirmed material value. A new confirmation is then required.

## 6.12 `pre_intake_booking_conversions`

| Field | Requirement |
|---|---|
| `pre_intake_id` | Unique; one successful conversion maximum. |
| `verification_id` | Required and must be confirmed. |
| `confirmation_id` | Required. |
| `booking_id` | Unique authoritative Booking link. |
| `conversion_idempotency_key` | Unique within tenant scope. |
| `converted_by_user_id` | Required T1 actor. |
| `converted_by_device_id` | Required T1 device. |
| `converted_at` | Required. |
| `origin_channel` | Preserved from Pre-Intake. |

## 6.13 Retention and deletion

- finalized conversion, queue events, confirmations and audit records follow KitLuy legal/operational retention policy and are not hard-deleted through customer UI;
- abandoned drafts may expire and later be anonymized according to approved privacy policy;
- customer photos use File Service retention, consent and access rules;
- Telegram provider payloads retain only the minimum required validation/audit data;
- exact periods: `[REQUIRED: approved privacy and retention schedule]`.

---

# Part 7 — API and event contracts

## 7.1 API-surface boundary

The Phase 1 Storefront uses a narrow subset of the governed **Commerce Store API** for customer access and the **Edge Operations API** for Store Hub/T1 operations. Management configuration remains in the Partner/Management API. Telegram ingress is isolated behind the Connector/Channel boundary where applicable.

No API may expose direct database access.

## 7.2 Common API requirements

- versioned route or schema;
- tenant and Digital Store resolution;
- explicit Location scope where applicable;
- request correlation ID;
- idempotency key for mutations;
- rate limiting and abuse controls;
- structured errors with stable codes;
- no sensitive internal identifiers in public URLs;
- RLS or equivalent database enforcement;
- append-only audit for sensitive mutations;
- stale/freshness metadata on operational projections;
- retry-safe behavior.

## 7.3 Public Storefront read endpoints

Illustrative route family; exact gateway prefix is `[REQUIRED: approved Commerce Store API base path]`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1/storefront/{store_slug}` | Resolve published Digital Store. |
| GET | `/v1/storefront/{store_slug}/locations` | List participating Locations allowed by publication policy. |
| GET | `/v1/storefront/{store_slug}/locations/{location_slug}` | Public Location details, hours, status and freshness. |
| GET | `/v1/storefront/{store_slug}/locations/{location_slug}/services` | Published Laundry services/add-ons and estimate inputs. |
| GET | `/v1/storefront/{store_slug}/locations/{location_slug}/queue-status` | Public-safe queue availability; never exposes customer identity. |
| GET | `/v1/storefront/{store_slug}/policies` | Customer-facing intake, cancellation, privacy and estimate policies. |

Responses must identify:

- source version;
- `as_of` timestamp;
- freshness state;
- whether check-in is open;
- whether estimates are available;
- whether the Location is open, paused, full, degraded or unavailable.

## 7.4 Customer identity endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/v1/customer-sessions` | Start customer session from Web/QR/Telegram context. |
| POST | `/v1/customer-sessions/{id}/phone-challenges` | Request verification challenge. |
| POST | `/v1/customer-sessions/{id}/phone-challenges/{challenge_id}/verify` | Verify challenge. |
| POST | `/v1/customer-sessions/{id}/telegram/link` | Link validated Telegram channel identity to verified customer session. |
| DELETE | `/v1/customer-sessions/{id}` | End session/revoke token. |

Rules:

- verification responses must not reveal whether an unrelated phone already has an account;
- challenge attempts and resend cadence are rate-limited;
- customer sessions use least-privilege scopes;
- Telegram linkage requires backend validation and verified phone.

## 7.5 Pre-Intake endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/v1/pre-intakes` | Create draft. |
| GET | `/v1/pre-intakes/{secure_token}` | Read own draft/status. |
| PATCH | `/v1/pre-intakes/{secure_token}` | Update mutable draft. |
| POST | `/v1/pre-intakes/{secure_token}/lines` | Add line. |
| PATCH | `/v1/pre-intakes/{secure_token}/lines/{line_id}` | Update line. |
| DELETE | `/v1/pre-intakes/{secure_token}/lines/{line_id}` | Remove draft line before submission. |
| POST | `/v1/pre-intakes/{secure_token}/evidence` | Request File Service upload. |
| POST | `/v1/pre-intakes/{secure_token}/submit` | Freeze a customer-submission version. |
| POST | `/v1/pre-intakes/{secure_token}/cancel` | Cancel eligible draft/submission. |

`submit` must validate:

- verified phone/session;
- eligible published Store and Location;
- at least one valid line;
- current service availability or clear degraded handling;
- accepted customer policies;
- idempotency key;
- draft version to prevent lost updates.

## 7.6 Check-in and queue endpoints

| Method | Route | Purpose |
|---|---|---|
| POST | `/v1/pre-intakes/{secure_token}/check-in` | Join physical Location queue. |
| GET | `/v1/queue-tickets/{secure_token}` | Own queue state. |
| POST | `/v1/queue-tickets/{secure_token}/cancel` | Customer cancellation when eligible. |
| POST | `/v1/queue-tickets/{secure_token}/presence` | Optional presence refresh under approved policy. |

Check-in requires one approved proof:

- current signed Location QR;
- short-lived Location check-in code;
- staff activation;
- owner-approved remote policy.

The API must not accept a Location parameter that contradicts the signed entry/check-in context without explicit customer confirmation and server-side eligibility checks.

## 7.7 Customer confirmation endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/v1/intake-confirmations/{secure_token}` | Fetch the exact verified summary awaiting confirmation. |
| POST | `/v1/intake-confirmations/{secure_token}/confirm` | Confirm exact verification version. |
| POST | `/v1/intake-confirmations/{secure_token}/reject` | Reject and return to T1 correction. |

A confirm request contains:

- verification version;
- displayed summary hash;
- confirmation method;
- customer session context;
- idempotency key.

## 7.8 T1/Store Hub Edge endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/edge/v1/locations/{location_id}/queue` | Read actionable local queue projection. |
| POST | `/edge/v1/queue-tickets/{id}/call` | Call customer. |
| POST | `/edge/v1/queue-tickets/{id}/start-service` | Assign T1/staff and begin service. |
| POST | `/edge/v1/queue-tickets/{id}/skip` | Skip with reason. |
| POST | `/edge/v1/queue-tickets/{id}/recall` | Recall eligible ticket. |
| POST | `/edge/v1/queue-tickets/{id}/no-show` | Mark no-show with policy validation. |
| POST | `/edge/v1/pre-intakes/{id}/verification` | Start verification. |
| PUT | `/edge/v1/intake-verifications/{id}` | Save verified values/version. |
| POST | `/edge/v1/intake-verifications/{id}/ready-for-confirmation` | Freeze summary for customer. |
| POST | `/edge/v1/intake-verifications/{id}/staff-confirm` | Audited assisted confirmation. |
| POST | `/edge/v1/intake-verifications/{id}/convert-to-booking` | Atomic exactly-once conversion. |

These operations require authenticated Store Hub/device certificates, Location assignment, staff session and role permission.

## 7.9 Booking status endpoint

A secure customer token may expose only the minimum Booking status needed for customer service:

- Booking reference;
- current customer-facing status;
- due estimate/commitment;
- payment/balance presentation approved for customer;
- pickup/delivery state;
- receipt link where authorized;
- Store contact information;
- freshness timestamp.

It must not expose internal staff notes, cost, audit details, other customer data or unrestricted Booking search.

## 7.10 Error catalog

Minimum stable codes:

```text
STOREFRONT_NOT_PUBLISHED
LOCATION_NOT_AVAILABLE
LOCATION_CLOSED
LOCATION_QUEUE_PAUSED
LOCATION_QUEUE_FULL
SERVICE_NOT_AVAILABLE
SESSION_EXPIRED
PHONE_VERIFICATION_REQUIRED
PHONE_CHALLENGE_RATE_LIMITED
PRE_INTAKE_NOT_FOUND
PRE_INTAKE_VERSION_CONFLICT
PRE_INTAKE_ALREADY_SUBMITTED
PRE_INTAKE_EXPIRED
CHECK_IN_PROOF_INVALID
QUEUE_TICKET_ALREADY_ACTIVE
QUEUE_TICKET_NOT_ELIGIBLE
VERIFICATION_VERSION_CONFLICT
CUSTOMER_CONFIRMATION_REQUIRED
CUSTOMER_CONFIRMATION_STALE
ALREADY_CONVERTED
BOOKING_CONVERSION_FAILED
STALE_OPERATIONAL_DATA
IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST
PERMISSION_DENIED
PROVIDER_UNAVAILABLE
```

Errors must be localized for customers while preserving a stable machine-readable code.

## 7.11 Domain events

All events are versioned, scoped, idempotent and auditable.

```text
storefront.published.v1
storefront.paused.v1
storefront.location_status_changed.v1
pre_intake.created.v1
pre_intake.submitted.v1
pre_intake.cancelled.v1
pre_intake.expired.v1
queue_ticket.checked_in.v1
queue_ticket.called.v1
queue_ticket.serving.v1
queue_ticket.skipped.v1
queue_ticket.recalled.v1
queue_ticket.no_show.v1
intake_verification.started.v1
intake_verification.updated.v1
intake_verification.ready_for_confirmation.v1
intake_verification.customer_confirmed.v1
intake_verification.customer_rejected.v1
pre_intake.converted_to_booking.v1
notification.requested.v1
notification.delivery_status_changed.v1
```

## 7.12 Webhooks and connectors

No third party may execute code inside the authoritative intake/Booking transaction. Approved connectors receive signed event projections and use retry/dead-letter controls. Telegram is treated as a governed channel adapter, not a privileged database integration.

---

# Part 8 — Business logic and computation rules

## 8.1 Estimate rules

- estimates are optional and non-final;
- estimates use currently published service rules and customer-entered quantities;
- per-weight services show a range or unit rate unless an actual verified weight exists;
- taxes/fees are displayed only when authoritative configuration is available;
- estimates include `as_of` and freshness state;
- stale/unavailable price inputs must not silently produce a total;
- customer copy must say final quantity, condition, due time and price are confirmed at T1.

## 8.2 Service availability

A published service may be unavailable because of:

- Location emergency override;
- capacity full;
- machine down;
- staffing shortage;
- supply outage;
- power/water issue;
- safety/quality issue;
- holiday/closure;
- unsupported customer request;
- stale configuration.

The Storefront must explain the customer impact without exposing internal sensitive notes.

## 8.3 Queue-number generation

Queue display labels are generated by the authoritative queue service or Store Hub under an allocated sequence policy. Generation must be concurrency-safe and retry-safe.

A failed request may return the previously created ticket when the idempotency key matches. It must never create two active tickets for the same Pre-Intake and counter unless an authorized split workflow is explicitly added later.

## 8.4 Queue ordering

Default ordering is check-in sequence. Approved priority classes may exist for accessibility or business policy, but:

- priority policy must be configured and visible to staff;
- overrides require permission and reason;
- customer-facing position is a hint, not a guaranteed appointment time;
- the system must not expose another customer’s identity;
- T1 may pause calling when counter service is unavailable.

## 8.5 No-show and expiry

Exact durations are configurable within owner-approved limits: `[REQUIRED: default and maximum queue policy values]`.

Required behavior:

- `CALLED` may become `SKIPPED` after configured handling;
- `SKIPPED` may be `RECALLED` once or according to policy;
- `NO_SHOW` closes the active waiting position but does not delete the Pre-Intake;
- returning customers may receive a new ticket or manager-approved reinstatement;
- every transition is an event.

## 8.6 Phone verification

- phone is mandatory for normal customer self-service;
- Cambodia phone normalization follows the shared customer identity contract;
- channel identity is secondary to verified phone;
- staff-assisted fallback records verification method and reason;
- customer merge/link decisions follow Core customer rules and must not be performed silently by Storefront UI.

## 8.7 T1 difference calculation

For every material field, the system classifies:

```text
UNCHANGED
ADDED_BY_T1
REMOVED_BY_T1
QUANTITY_CHANGED
WEIGHT_CHANGED
SERVICE_CHANGED
ADDON_CHANGED
CONDITION_CHANGED
DUE_TIME_CHANGED
PRICE_CHANGED
CUSTOMER_IDENTITY_CHANGED
```

Material changes require a reason according to policy. The customer confirmation view shows customer-readable differences, not internal implementation fields.

## 8.8 Capacity and due time

Customer-preferred timing is a request. T1 or the authoritative capacity service sets the committed due time using current Store rules and workload. Stale capacity data must not produce a guaranteed completion promise.

## 8.9 Confirmation invalidation

Any change after confirmation to service, quantity, weight, add-on, price, due commitment, fulfilment or material condition invalidates the prior confirmation and requires a new confirmation.

## 8.10 Conversion and payment boundary

- conversion creates the Booking before payment begins;
- payment uses the Booking’s authoritative amount and payment policy;
- cash/KHQR/provider state follows existing Payment Service rules;
- a customer screenshot or Telegram message is never payment confirmation;
- payment failure does not erase the Booking; existing cancellation/void policy applies;
- the Storefront cannot finalize or reverse payment.

## 8.11 File/evidence rules

- uploads use signed File Service operations;
- supported media type and size limits are configurable;
- malware/content validation occurs before staff access;
- customer images are preliminary evidence only;
- T1 may capture separate accepted-condition evidence;
- customer files must not leak through predictable URLs;
- Store Hub caches only files required for local operation and according to storage policy.

## 8.12 Duplicate reconciliation

When a cloud Pre-Intake and local staff-assisted intake appear to refer to the same customer/items:

- never auto-merge finalized Bookings;
- use phone, time, Location, customer reference and staff review signals;
- present a possible-duplicate warning;
- allow authorized link/cancel handling with audit;
- preserve both original submissions;
- no generic last-write-wins for Booking, payment, quantity, custody or queue history.

## 8.13 Business-day boundary

Queue numbering and operational reporting use the Store Location’s business-day configuration. A ticket retains its original business date even when service crosses midnight; reopening/requeue follows policy.

---

# Part 9 — Route, screen and component inventory

## 9.1 Public route inventory

Exact URL structure may be adapted to the approved domain strategy, but route responsibilities are binding.

| Route pattern | Screen | Access |
|---|---|---|
| `/s/{store_slug}` | Digital Store landing | Public |
| `/s/{store_slug}/locations` | Location selector | Public |
| `/s/{store_slug}/l/{location_slug}` | Location landing and status | Public |
| `/s/{store_slug}/l/{location_slug}/services` | Laundry service catalog | Public |
| `/s/{store_slug}/l/{location_slug}/prepare` | Start Pre-Intake | Public → verified session |
| `/p/{secure_token}` | Resume own Pre-Intake | Token/session scoped |
| `/p/{secure_token}/review` | Review and submit | Token/session scoped |
| `/p/{secure_token}/check-in` | Physical check-in | Token + Location proof |
| `/q/{secure_token}` | Own queue status | Token/session scoped |
| `/c/{secure_token}` | Verified-intake confirmation | Token/session scoped |
| `/b/{secure_token}` | Customer Booking status | Token/session scoped |
| `/telegram` | Telegram Mini App bootstrap | Validated channel session |
| `/unavailable` | Fail-closed unavailable state | Public |
| `/privacy` | Customer privacy information | Public |
| `/terms/intake` | Pre-Intake and queue conditions | Public |

No route may contain raw customer, Booking, Tenant or Location database identifiers.

## 9.2 Store landing screen

Required content:

- Store name and brand;
- vertical label: Laundry;
- supported language switch;
- participating Location selection;
- Storefront operational status;
- primary action: **Prepare Laundry Intake**;
- alternate action: **Track Queue or Booking**;
- contact and privacy links;
- freshness/degraded label where required.

## 9.3 Location landing screen

Required content:

- Location name and address;
- open/closed/paused/full/degraded status;
- business hours;
- service availability summary;
- queue check-in state;
- pickup/delivery availability if approved;
- map/contact actions where configured;
- current data `as_of` timestamp when operational status may be stale;
- QR context indicator so the customer knows which Location was scanned.

## 9.4 Service catalog screen

Components:

- service categories;
- service card;
- per-piece/per-weight pricing label;
- add-on chips;
- turnaround guidance;
- unavailable/degraded reason;
- selected-service summary;
- estimated-price disclaimer;
- Khmer/English search if enabled for Phase 1.

The screen does not require the full Phase 3 navigation-tree, theme-editor or faceted-search system.

## 9.5 Customer identity screen

Components:

- phone input with Cambodia-aware normalization;
- name input when needed;
- challenge delivery selection only when approved providers exist;
- challenge code input;
- resend timer and attempt feedback;
- privacy/notification consent;
- Telegram linkage explanation;
- staff-assisted alternative message when provider is unavailable.

## 9.6 Pre-Intake editor

### Header

- Location;
- customer name/phone mask;
- draft status;
- expiry guidance;
- save state.

### Line editor

- intended service;
- garment/item type;
- estimated pieces;
- estimated bags;
- estimated weight and UOM;
- add-ons;
- stain note;
- damage note;
- special handling note;
- optional photo upload.

### Summary

- line summary;
- estimated price/range when available;
- non-final disclosure;
- preferred time/fulfilment;
- submit action.

## 9.7 Check-in screen

Required states:

- eligible and ready to check in;
- Store closed;
- queue paused;
- queue full;
- wrong Location;
- invalid/expired QR;
- already checked in;
- staff activation required;
- remote queue disabled.

Successful check-in shows:

- queue label;
- masked Location/counter;
- people ahead only if policy allows;
- current state;
- instructions to remain available;
- signed customer QR/reference;
- cancel action if eligible.

## 9.8 Queue-status screen

Components:

- large queue number;
- state badge;
- called/serving animation that respects reduced-motion settings;
- customers-ahead hint if enabled;
- last updated/freshness;
- Location and counter;
- call instructions;
- notification preference;
- cancel/return instructions;
- help/contact action.

The screen must never display names or phone numbers of other customers.

## 9.9 Verified-intake confirmation screen

Required comparison sections:

- customer-submitted summary;
- T1-verified summary;
- changed values highlighted in plain language;
- actual piece count/weight;
- services and add-ons;
- condition notes intended for customer;
- due commitment;
- final price preview;
- acceptance statement;
- **Confirm** and **Ask cashier to correct** actions.

If T1 updates the intake, the screen must reload the new version and invalidate the previous confirmation token/version.

## 9.10 Booking-status screen

Required content:

- Booking reference;
- current customer-facing Laundry status;
- due date/time;
- payment/deposit/balance status approved for display;
- pickup/delivery state;
- receipt link if authorized;
- Store contact;
- data freshness.

## 9.11 Telegram Mini App shell

The Telegram shell must:

- display the same KitLuy brand and Store/Location context;
- validate channel launch on the backend before granting a customer session;
- use the same service, Pre-Intake, queue and confirmation components or shared packages;
- provide a browser fallback;
- avoid Telegram-only business logic;
- not expose Bot credentials in client code;
- show notification-consent choices clearly.

## 9.12 T1 Pre-Intake Queue workspace

### Queue list

- queue number;
- waiting/called/skipped state;
- wait age;
- customer phone mask;
- intended service summary;
- estimate/bag summary;
- origin channel;
- sync/freshness indicator;
- possible duplicate warning;
- action buttons according to state.

### Verification workspace

- customer identity verification;
- customer-submitted lines;
- actual garment/item entry;
- scale status and weight capture through existing Hub hardware service;
- condition/evidence capture;
- service/add-on correction;
- due-time/capacity check;
- final price preview;
- difference panel;
- customer confirmation status;
- convert-to-Booking action.

### Required safety behavior

- conversion disabled until all required fields, confirmation and permissions pass;
- stale cloud-only record cannot be processed until safely projected to Hub or explicitly refreshed;
- an already converted record opens the existing Booking;
- concurrent T1 attempts show assignment/conflict rather than overwriting.

## 9.13 T2 confirmation states

```text
IDLE
CUSTOMER_IDENTIFIED
INTAKE_SUMMARY
DIFFERENCE_REVIEW
AWAITING_CONFIRMATION
CONFIRMED
BOOKING_CREATED
PAYMENT_REQUESTED
KHQR_DISPLAYED
PAYMENT_PENDING
PAYMENT_CONFIRMED
PAYMENT_FAILED
RECEIPT_CHOICE
COMPLETE
PRIVACY_RESET
```

T2 must reset customer data after the session or configured timeout.

## 9.14 Shared component inventory

| Component | Purpose |
|---|---|
| `StorefrontStatusBanner` | Open/closed/degraded/freshness truth. |
| `LocationContextCard` | Location identity and check-in context. |
| `ServiceCard` | Published Laundry service. |
| `EstimateDisclosure` | Non-final price/weight/time notice. |
| `PhoneVerificationForm` | Customer identity step. |
| `PreIntakeLineEditor` | Preliminary item/service input. |
| `EvidenceUploader` | File Service upload flow. |
| `QueueNumberCard` | Large accessible queue label. |
| `QueueTimeline` | Customer-safe state progression. |
| `SecureCustomerQr` | Signed reference for T1 lookup. |
| `DifferenceSummary` | Customer estimate versus T1 verification. |
| `CustomerConfirmationPanel` | Confirm/reject exact verification version. |
| `FreshnessLabel` | Source/as-of/degraded information. |
| `ProviderFailureNotice` | Phone/Telegram/notification failure handling. |
| `PrivacyReset` | T2/customer-session cleanup. |

---

# Part 10 — Design, localization and accessibility

## 10.1 Design principles

- mobile-first customer flow;
- large touch targets;
- one primary action per step;
- progressive disclosure;
- plain-language estimates and corrections;
- no technical error codes without customer explanation;
- clear Store/Location context;
- visible save/submit/check-in state;
- no hidden payment or finality assumptions;
- consistent Web, Telegram and T2 terminology.

## 10.2 Canonical customer terminology

| Internal concept | Customer-facing copy |
|---|---|
| Pre-Intake Draft | Prepare Laundry Intake |
| Submit Pre-Intake | Send preparation details |
| Queue Ticket | Queue number |
| Verification | Cashier checks your items |
| Customer Confirmation | Confirm final intake |
| Conversion | Booking created |
| Estimate | Estimated only — final at cashier |
| Queue state `CALLED` | It is your turn |
| Queue state `SKIPPED` | Please see the cashier |
| Queue state `NO_SHOW` | Queue place ended |

The product message is **Scan, Prepare & Queue**.

## 10.3 Localization

- complete Khmer and English UI coverage;
- Store/Location content supports both languages where supplied;
- service fallback order follows approved Digital Store localization rules;
- phone, date, time, quantity and currency formatting follow Cambodia requirements;
- KHR and USD display use Core currency formatting and no floating-point client calculations;
- customer notices are professionally translated and reviewed before pilot.

## 10.4 Accessibility requirements

- keyboard operation for all Web flows;
- semantic headings and form labels;
- screen-reader announcements for queue-state changes;
- minimum contrast according to approved accessibility standard;
- no color-only state communication;
- reduced-motion support;
- large text and zoom support;
- accessible validation summaries;
- camera/QR is never the only path;
- confirmation is available without Telegram;
- T2 timeout allows an accessibility extension under staff control.

Exact compliance target: `[REQUIRED: approved WCAG level and browser/device matrix]`.

## 10.5 Performance budgets

Exact budgets require pilot approval. At minimum:

- critical Store/Location page remains usable on common Cambodia mobile networks;
- service catalog uses optimized images and cached publication data;
- interaction remains responsive on supported low/mid-range Android devices;
- Telegram shell does not duplicate heavy assets unnecessarily;
- queue polling/realtime has bounded retry and battery/network usage;
- stale cache is labeled and never presented as live queue truth.

Thresholds: `[REQUIRED: approved LCP, INP, payload and API latency budgets]`.

## 10.6 Empty, loading and failure states

Every route defines:

- loading;
- no published services;
- no participating Location;
- closed;
- queue paused/full;
- stale status;
- provider unavailable;
- session expired;
- permission denied;
- token invalid;
- offline browser;
- safe retry.

Skeletons or cached content must not look authoritative when operational data is unknown.

---

# Part 11 — Security, privacy and abuse controls

## 11.1 Trust boundaries

- Browser and Telegram clients are untrusted.
- QR payloads identify context but do not grant unrestricted access.
- Queue numbers are public-friendly labels, not secrets.
- Secure tokens are scoped, expiring and revocable.
- Telegram identity is validated server-side and remains secondary to verified phone.
- Store Hub/T1 operations require device certificate, Location assignment and staff authorization.
- payment state is accepted only from authoritative Payment Service contracts.

## 11.2 Customer-session security

- short-lived access tokens;
- refresh/re-auth policy appropriate to customer risk;
- session bound to intended scopes and Pre-Intake/queue resources;
- token rotation after sensitive transitions where appropriate;
- logout/revoke support;
- no tokens in analytics logs;
- rate limiting by IP, session, phone and device signals;
- secure cookie or approved mobile-Web storage strategy;
- CSRF protection where relevant.

## 11.3 QR security

Store/Location QR:

- carries an opaque signed context or public entry code;
- has a version and revocation mechanism;
- does not contain raw internal IDs or secrets;
- may be long-lived for marketing entry but check-in proof should be short-lived or server-validated against current Location policy;
- supports replacement after compromise or signage change.

Customer QR:

- is short-lived and scoped to the customer’s queue/intake context;
- may be scanned only by an authorized T1/Store device;
- cannot be used to enumerate other records;
- is invalidated or narrowed after Booking conversion.

## 11.4 Phone verification abuse controls

- challenge and resend limits;
- failed-attempt limits;
- IP/device/phone velocity monitoring;
- provider outage handling;
- no account-existence disclosure;
- manual fallback restricted to authorized T1 staff;
- audited override reason;
- suspicious activity alerting.

## 11.5 Data minimization

Public/customer surfaces collect only information required for pre-intake, communication, queue and conversion. Avoid collecting government ID, birth date or unrelated profile data in Phase 1 unless a separate approved requirement exists.

## 11.6 File security

- signed uploads/downloads;
- content-type and size validation;
- malware scanning or approved safety control;
- tenant/customer ownership metadata;
- no public bucket URLs;
- least-privilege staff access;
- retention and deletion workflow;
- EXIF/location metadata handling according to privacy policy.

## 11.7 RLS and isolation tests

Tests must prove:

- one customer cannot fetch another customer’s Pre-Intake, queue, confirmation or Booking status;
- one Partner/Location cannot access another Tenant/Location queue;
- Telegram user ID manipulation cannot cross customer scope;
- a signed QR for one Location cannot join another Location queue;
- HET support access requires authorized consent and audit;
- service-role paths are not exposed to public clients.

## 11.8 Audit requirements

Audit at minimum:

- Storefront publication and pause;
- QR creation/revocation;
- queue-policy changes;
- phone verification override;
- queue call/skip/recall/no-show;
- T1 assignment;
- verification changes;
- customer confirmation/rejection;
- conversion to Booking;
- duplicate resolution;
- staff-assisted fallback;
- sensitive file access;
- support access.

## 11.9 Privacy requirements

Before production:

- approved privacy notice in Khmer and English;
- consent purpose for notifications and Telegram linkage;
- retention schedule;
- customer access/correction/deletion handling where legally applicable;
- operational-record retention exception handling;
- incident-response procedure;
- processor/provider register.

Values and legal text: `[REQUIRED: approved privacy/legal package]`.

## 11.10 Prohibited patterns

- direct client database credentials;
- raw service-role key in Storefront/Telegram client;
- trusting client-supplied Telegram identity without backend validation;
- using queue number as sole authentication;
- storing payment card PAN;
- accepting payment screenshots as confirmation;
- destructive update of submitted or verified evidence;
- generic last-write-wins for Booking/payment/custody/queue history;
- exposing another customer’s queue or contact data;
- silently using stale status as live availability.

---

# Part 12 — Store Hub, offline and synchronization

## 12.1 Offline principle

The Storefront is an internet customer channel. Store operations are not. After provisioning, Store Hub and T1/T2 must continue local required operations without internet.

## 12.2 Projection to Store Hub

The cloud projects only actionable, authorized records needed by the Location:

- submitted/check-in Pre-Intake snapshot;
- queue ticket and event cursor;
- customer phone mask and verified identity reference;
- customer notes/files required for intake;
- service/catalog version used for estimate;
- channel attribution;
- notification/confirmation context.

Store Hub verifies Tenant, Digital Store, Location, schema version and event signature before accepting a projection.

## 12.3 Local processing

T1 verification, customer confirmation through T2 and Booking conversion should use Store Hub-local contracts when the record is available locally. The Hub records an outbox event for cloud synchronization.

## 12.4 WAN-loss scenarios

### Customer submitted before outage and record is already on Hub

T1 may process normally. Cloud status updates queue locally and synchronize later.

### Customer submitted before outage but record is not on Hub

T1 cannot assume the cloud draft exists. Staff may use the customer’s displayed reference to search local data; if absent, create a staff-assisted intake. Reconciliation later flags possible duplicates.

### Customer scans QR during Store WAN outage

The cloud Storefront may still be available, but live Location queue/capacity may be stale. It must show degraded status and may disable physical check-in when safe confirmation is unavailable.

### Storefront/Telegram outage while Hub works

T1 staff-assisted intake continues. T2 continues through Hub.

## 12.5 Sync ordering

Recommended aggregate ordering:

1. publication/catalog versions;
2. customer identity reference;
3. Pre-Intake submitted version;
4. Queue Ticket and events;
5. verification versions;
6. customer confirmation;
7. conversion/Booking link;
8. notification events.

Consumers must tolerate duplicate delivery and process idempotently.

## 12.6 Conflict policy

| Data | Conflict rule |
|---|---|
| Customer draft before submission | Version check; customer may retry/merge own edits. |
| Submitted Pre-Intake | Immutable submitted version; later customer changes create a new version only if allowed. |
| Queue events | Append-only ordered events; no destructive overwrite. |
| T1 verification | Optimistic version plus assigned T1 lock/lease. |
| Customer confirmation | Exact verification-version match. |
| Booking conversion | Unique Pre-Intake link + idempotency; exactly one Booking. |
| Payment/custody | Existing authoritative append-only rules. |

## 12.7 Sync freshness presentation

Operational responses include:

- source: cloud or Hub projection;
- last successful sync;
- pending event count where staff-authorized;
- freshness state;
- degraded impact.

Customer copy avoids technical terms but states when live queue or availability cannot be confirmed.

## 12.8 Recovery

Recovery runbooks must cover:

- rebuild Hub queue projection from cloud event cursor;
- replay idempotent events;
- detect and quarantine schema-incompatible records;
- reconcile local Booking conversion after cloud outage;
- reissue customer status token safely;
- restore Storefront database without duplicating notifications/conversions;
- revoke compromised QR or Telegram credentials.

---

# Part 13 — Notifications and Telegram channel

## 13.1 Notification events

Phase 1 may notify:

- Pre-Intake submitted;
- check-in successful;
- queue number issued;
- customer called;
- customer skipped/recall requested;
- verification ready for confirmation;
- confirmation accepted/rejected;
- Booking created;
- payment/receipt status through existing approved templates;
- Booking ready for pickup through existing Laundry notifications.

## 13.2 Supported channels

- in-app Web status;
- Telegram message when linked and consented;
- SMS or other approved provider through Notification Service;
- T2 display while at counter.

Channel availability is provider/configuration dependent. The product must not promise delivery when no provider is configured.

## 13.3 Delivery truth

Canonical delivery states:

```text
REQUESTED
QUEUED
SENT
DELIVERED
FAILED
SUPPRESSED
CANCELLED
UNAVAILABLE
```

A notification failure does not change queue, verification, Booking or payment truth.

## 13.4 Telegram principles

- Telegram is an optional channel, not a dependency for Phase 1 operations;
- Bot/Mini App identity and launch payload are validated on the backend;
- verified phone remains the primary customer linkage requirement;
- Telegram messages contain minimum necessary customer data;
- sensitive status links are expiring and scoped;
- customer may unlink Telegram without deleting operational records;
- bot commands and Mini App actions call KitLuy APIs rather than mutate business state inside Telegram-specific storage;
- Bot webhook failures use retry/dead-letter handling;
- provider payload logging is minimized and access-controlled.

## 13.5 Telegram entry patterns

- Store bot profile button;
- direct Mini App link;
- Location QR opening a chooser: Web Storefront or Telegram;
- Storefront button to open Telegram for future status;
- approved social link.

Exact Bot username, Mini App short name, webhook domain and secrets: `[REQUIRED]`.

## 13.6 Template requirements

All templates:

- support Khmer and English;
- include Store/Location identity;
- use the customer’s queue/Booking reference without exposing raw IDs;
- state whether an amount/time is estimated or final;
- avoid exposing full phone numbers;
- include help/contact action;
- preserve notification delivery audit.

---

# Part 14 — Partner configuration and operational controls

## 14.1 Partner Portal ownership

Partner Portal controls the Storefront configuration. The customer Storefront does not contain back-office administration.

## 14.2 Configuration inventory

| Configuration | Phase 1 requirement |
|---|---|
| Storefront enablement | Per Digital Store feature flag. |
| Location participation | Per Location enable/pause. |
| Published services | Choose eligible Laundry services/add-ons. |
| Public descriptions/media | Controlled by Partner publication permissions. |
| Business hours | Location authoritative hours. |
| Queue counters | Name, prefix and T1 assignment policy. |
| Check-in policy | Location QR, code, staff activation; remote disabled by default. |
| Queue expiry/no-show | Configurable within approved limits. |
| Queue visibility | Whether to show people ahead/estimated wait. |
| Pre-Intake expiry | Configurable within approved limits. |
| Evidence uploads | Enable, file limits and customer notice. |
| Telegram | Enable only after Bot/channel readiness passes. |
| Notifications | Provider/channel/template readiness. |
| Estimate display | Unit rate, range or unavailable; never final. |
| Customer confirmation methods | T2/Web/Telegram/staff-assisted allowed methods. |
| Emergency pause | Immediate Location/Storefront/queue pause with reason. |

## 14.3 Publication readiness checklist

Partner may publish only when:

- Digital Store is active;
- vertical is Laundry;
- at least one Location and service are eligible;
- Store/Location names and contact data exist;
- customer policies are published;
- phone verification path is ready or approved assisted-only pilot exists;
- queue counter and T1 assignment exist;
- Store Hub is active for physical queue operation;
- T1/T2 compatible release is installed;
- notification/Telegram status is accurately labeled;
- test Pre-Intake and conversion pass;
- rollback/pause control works.

## 14.4 Emergency controls

Authorized Partner/manager may:

- pause new Pre-Intakes;
- pause physical check-in;
- mark queue full;
- temporarily disable a service;
- close a Location;
- revoke a QR entry point;
- disable Telegram channel;
- switch to staff-assisted intake.

Every action requires reason, actor and audit. Existing queued customers receive truthful status handling.

## 14.5 Chain governance

For Chain Stores, Chain may define brand standards and approved catalog/publication rules. Store-level emergency availability remains possible according to current Chain/Store governance. Chain cannot bypass Tenant/Store/Location isolation or overwrite finalized operational records.

---

# Part 15 — Observability, reporting and support

## 15.1 Operational dashboards

Minimum dashboards:

- Storefront availability and error rate;
- API latency and mutation failures;
- phone verification success/failure/abuse;
- Pre-Intake create/submit/check-in funnel;
- queue size, wait age, no-show and abandonment;
- Hub projection lag;
- T1 verification duration;
- conversion success/failure/duplicate protection;
- customer confirmation success/rejection;
- notification delivery state;
- Telegram webhook/Mini App errors;
- file upload failures;
- stale operational-data incidents.

## 15.2 Business reporting

Reports must retain origin and authority labels:

- Pre-Intakes by channel;
- conversion rate by Location/channel;
- T1 time saved comparison;
- corrections by field/service;
- queue abandonment/no-show;
- average verification time;
- duplicate warnings and resolutions;
- Storefront-created Booking value only after authoritative Booking conversion;
- payment reporting from Finance/Payment truth, never from draft estimates.

Reporting and historical data must not be labeled authoritative when incomplete or stale.

## 15.3 Alerts

Minimum alert families:

- Storefront unavailable;
- API error spike;
- phone provider failure or abuse spike;
- Telegram webhook failure/dead-letter growth;
- Store Hub sync lag above approved threshold;
- conversion failure or duplicate anomaly;
- queue backlog/age threshold;
- notification delivery failure;
- file scanning/upload failure;
- RLS/security anomaly;
- expired credentials/certificates.

Thresholds and escalation: `[REQUIRED: approved monitoring and on-call policy]`.

## 15.4 Logging

Logs include correlation IDs and exclude secrets, full verification codes, raw access tokens, payment credentials and unnecessary customer content. Sensitive customer/file access logs are access-controlled and retained according to policy.

## 15.5 Support tools

Authorized support views may show:

- Storefront publication and provider readiness;
- Location queue state and freshness;
- correlation/event timeline;
- sync lag and schema compatibility;
- notification delivery state;
- QR/channel status;
- customer record only with approved support consent and masking.

Support cannot silently mutate customer, Booking or payment data.

---

# Part 16 — QA, acceptance and phase gates

## 16.1 Completion gates

| Gate | Required evidence |
|---|---|
| G0 — Authority | v1.1.0 owner decision, scope, exclusions, privacy/payment policies and conflict register approved. |
| G1 — Contract | Schema, API/events, state machines, RLS, permissions, audit, Store Hub/offline behavior, migrations and documentation approved. |
| G2 — Build | Code, migrations, seeds, Web/Telegram/T1/T2 UI, jobs and automated tests complete in development. |
| G3 — Integrated verification | Cross-product, Hub/offline, security, idempotency, reconciliation, accessibility, performance and recovery tests pass. |
| G4 — Pilot readiness | Monitoring, alerts, rollback, support, training, signage/QR, provider readiness and go-live checklist complete. |
| G5 — Phase exit / Rebuild Test | Pilot evidence approved and one qualified engineer can rebuild and operate v1.1.0 from current documentation. |

## 16.2 Core acceptance scenarios

### QA-SF-001 — Store QR resolution

- scan valid Location QR;
- resolve correct Tenant, Digital Store and Location;
- do not expose raw IDs;
- show Location context and current status;
- reject revoked or tampered QR.

### QA-SF-002 — Web Pre-Intake happy path

- verify phone;
- select per-piece and per-weight services;
- enter estimates and notes;
- submit draft exactly once;
- show non-final estimate disclosure;
- confirm immutable submitted version exists.

### QA-SF-003 — Telegram parity

- launch Mini App through approved entry;
- validate channel launch on backend;
- link verified phone;
- complete same Pre-Intake flow;
- confirm no Telegram-only business record or divergent state.

### QA-SF-004 — Duplicate submit

- send identical submit request repeatedly with same idempotency key;
- return one submitted Pre-Intake;
- send different payload with reused key;
- return stable idempotency misuse error.

### QA-SF-005 — Physical check-in

- submit Pre-Intake remotely;
- prove Location presence with current check-in QR/code;
- receive one Queue Ticket and unique business-day label;
- confirm remote join fails when policy is disabled.

### QA-SF-006 — Queue concurrency

- simulate concurrent check-ins;
- prove no duplicate display labels within scope;
- preserve deterministic event order and retry safety.

### QA-SF-007 — Queue privacy

- customer sees only own ticket;
- public queue view reveals no names/phones/tokens;
- one customer token cannot fetch another ticket.

### QA-SF-008 — T1 assignment conflict

- two T1 devices attempt service start;
- one assignment wins according to contract;
- other device receives conflict and cannot overwrite verification.

### QA-SF-009 — Customer/T1 difference preservation

- customer submits estimated values;
- T1 changes service, weight and add-on;
- original submission remains intact;
- difference record, reasons, staff and device are auditable.

### QA-SF-010 — Confirmation versioning

- T1 freezes verification version 1;
- customer opens confirmation;
- T1 changes a material value to version 2;
- version 1 confirmation fails as stale;
- customer confirms version 2 successfully.

### QA-SF-011 — Exactly-once Booking conversion

- submit multiple concurrent conversion requests;
- create exactly one authoritative Booking;
- link one conversion record;
- retries return existing Booking;
- no partial Booking if transaction fails.

### QA-SF-012 — Payment boundary

- prove customer cannot initiate/finalize payment before Booking conversion in v1.1.0;
- T1 initiates cash/KHQR/deposit after Booking creation;
- Payment Service remains authoritative;
- draft estimate never becomes payment amount.

### QA-SF-013 — T2 privacy reset

- display verified intake and confirmation;
- complete or timeout session;
- clear customer data;
- next customer cannot see previous data.

### QA-SF-014 — WAN loss with record on Hub

- project checked-in Pre-Intake to Hub;
- disconnect WAN;
- T1 verifies, confirms through T2 and converts locally;
- sync later without duplicate Booking or event loss.

### QA-SF-015 — WAN loss without record on Hub

- create cloud Pre-Intake not yet projected;
- disconnect Store WAN;
- T1 cannot falsely load it;
- staff-assisted intake remains available;
- reconnect flags possible duplicate without auto-merging finalized Booking.

### QA-SF-016 — Provider outage

- disable phone/Telegram/notification provider separately;
- show truthful unavailable/delivery state;
- preserve core Store operations;
- no false verification or sent status.

### QA-SF-017 — Location closure/emergency pause

- pause Location while drafts and tickets exist;
- block new check-ins;
- preserve existing records;
- show customer instructions;
- record owner/manager reason and audit.

### QA-SF-018 — File isolation

- upload garment photo;
- validate type/size/security path;
- deny cross-customer/tenant access;
- confirm signed URL expiry and audit.

### QA-SF-019 — Localization

- complete end-to-end Khmer and English flows;
- validate service fallback, date/time, phone and KHR/USD display;
- no untranslated critical customer or error copy.

### QA-SF-020 — Accessibility

- keyboard-only Web flow;
- screen-reader queue changes;
- contrast and focus validation;
- reduced motion;
- QR/camera alternative;
- confirmation without Telegram.

### QA-SF-021 — Load and abuse

- approved concurrent customer/check-in load;
- phone/submit rate limits;
- queue sequence contention;
- no tenant leakage, duplicate creation or unbounded retries.

### QA-SF-022 — Backup and restore

- restore Storefront/queue data to isolated environment;
- replay event cursor;
- prove conversion uniqueness and audit integrity;
- no duplicate notifications from replay outside policy.

## 16.3 Security test matrix

- RLS cross-tenant probes;
- token tampering and expiry;
- QR signature tampering/revocation;
- Telegram identity manipulation;
- ID enumeration;
- CSRF/XSS/content injection;
- file upload abuse;
- rate-limit bypass;
- staff role/device/location isolation;
- service-role leakage scan;
- audit immutability;
- log secret/PII scan.

## 16.4 Pilot acceptance

Pilot requires:

- at least one approved Laundry Digital Store and physical Location;
- active Store Hub and compatible T1/T2;
- Web QR flow enabled;
- Telegram enabled only if provider readiness passes;
- trained cashier and manager;
- baseline and pilot T1 timing measurements;
- customer feedback and accessibility observation;
- daily queue/conversion/reconciliation review;
- incident and rollback contacts;
- owner approval of exit evidence.

Pilot duration/volume: `[REQUIRED: owner-approved pilot plan]`.

## 16.5 Rebuild Test evidence

A qualified engineer must be able to:

1. provision development infrastructure;
2. apply migrations and seeds;
3. run Web Storefront and API;
4. configure one Store/Location QR;
5. configure a Telegram development channel or documented disabled state;
6. submit/check in a Pre-Intake;
7. project it to a Store Hub test environment;
8. verify it at T1 and confirm at T2/Web;
9. convert exactly once to Booking;
10. run offline/reconnect tests;
11. inspect logs/metrics/audit;
12. restore from backup;
13. execute rollback.

---

# Part 17 — Deployment, release and go-live

## 17.1 Environments

Minimum:

- local/development;
- staging;
- pilot;
- production.

Each environment uses separate secrets, Telegram Bot configuration, phone provider configuration, databases, file buckets and observability labels.

## 17.2 Repository boundary

Recommended logical structure; exact monorepo paths require repository confirmation.

```text
apps/
  kitluy-storefront/
  kitluy-pos-desktop-app/
services/
  commerce-store-api/
  notification-service/
  channel-telegram-adapter/
packages/
  storefront-ui/
  customer-session-client/
  pre-intake-contracts/
  queue-contracts/
  localization/
  observability/
supabase/
  migrations/
  functions/
docs/
  products/kitluy-storefront/
```

Do not create duplicate customer, pricing, payment or Booking business logic inside the Web app or Telegram adapter.

## 17.3 Frontend stack

Owner-approved base:

- React Web/PWA;
- TypeScript;
- shared component/contracts packages;
- responsive customer UI;
- installable PWA behavior where approved.

Exact framework, build tool, router, state/query libraries and versions: `[REQUIRED: repository-approved choices]`.

## 17.4 Deployment stack

- DigitalOcean application/static hosting for Storefront where approved;
- Supabase for Auth/PostgreSQL/RLS/Realtime/metadata/audit;
- DigitalOcean workers/services and Spaces according to project infrastructure split;
- signed configuration and secrets management;
- CDN/TLS/domain setup according to approved platform domain architecture.

Phase 1 may use a KitLuy-controlled shared domain and Store/Location slugs. Full Partner custom domains remain outside v1.1.0 unless separately approved.

## 17.5 Feature flags

Minimum flags:

```text
storefront_phase1_laundry
storefront_qr_entry
storefront_pre_intake
storefront_physical_queue
storefront_customer_confirmation
storefront_telegram_channel
storefront_customer_evidence_upload
storefront_queue_people_ahead
storefront_remote_queue_join
storefront_booking_status
```

Defaults:

- main Phase 1 capability: disabled until pilot approval;
- Telegram: disabled until provider readiness;
- evidence uploads: disabled until file/privacy readiness;
- people-ahead display: disabled until queue accuracy is proven;
- remote queue join: disabled by default;
- online payment: no v1.1.0 feature flag because it is out of scope.

## 17.6 Release process

1. merge approved code with tests;
2. build immutable artifacts;
3. run security/dependency scans;
4. deploy development/staging;
5. apply additive migrations by authorized operator;
6. run smoke/contract/RLS tests;
7. release Internal;
8. release Pilot to selected Digital Stores;
9. monitor and reconcile;
10. promote Stable after G5 approval.

Store Hub/T1/T2 compatibility must be checked before enabling Storefront flags for a Location.

## 17.7 Rollback

Rollback must:

- disable new customer entry/check-in quickly;
- keep existing Pre-Intakes, queue events and conversions intact;
- preserve T1 local staff-assisted intake;
- avoid destructive down-migrations on accepted records;
- revert Web/API release independently where possible;
- revoke compromised QR/Telegram entry points;
- provide customer-facing degraded/paused message;
- reconcile queued events after recovery.

## 17.8 Go-live checklist

### Authority and documentation

- [ ] Owner decision registered.
- [ ] This specification approved.
- [ ] Privacy/legal/retention values supplied.
- [ ] API, schema, RBAC and event contracts published.
- [ ] Store Hub/POS specifications updated.

### Infrastructure

- [ ] Production domains/TLS ready.
- [ ] Supabase RLS and migrations validated.
- [ ] DO services/buckets/secrets ready.
- [ ] monitoring, alerts and backups tested.
- [ ] phone provider ready.
- [ ] Telegram ready or explicitly disabled.

### Store readiness

- [ ] Digital Store and Laundry vertical active.
- [ ] Location, hours, services and policies published.
- [ ] active Store Hub.
- [ ] compatible T1/T2 release.
- [ ] queue counter and policy configured.
- [ ] QR printed and scan-tested.
- [ ] staff trained.
- [ ] staff-assisted fallback tested.

### Verification

- [ ] QA-SF-001 through QA-SF-022 pass as applicable.
- [ ] security review approved.
- [ ] accessibility review approved.
- [ ] offline/reconnect reconciliation passes.
- [ ] pilot KPI baseline captured.
- [ ] rollback drill completed.
- [ ] authorized go-live approval recorded.

---

# Part 18 — Locked feature inventory and version history

## 18.1 Owner-locked feature inventory

The following IDs are stable for v1.1.0 and must not be recycled.

| Feature ID | Capability | Primary owner | Phase 1 acceptance summary |
|---|---|---|---|
| `KLSF-LND-001` | Store and Location QR entry | Storefront | Signed/revocable entry resolves correct Store/Location without exposing raw IDs. |
| `KLSF-LND-002` | Responsive Web Storefront Pre-Intake | Storefront | Customer completes supported flow on approved mobile/browser matrix. |
| `KLSF-LND-003` | Telegram Bot and Mini App access | Storefront/Channel Adapter | Validated Telegram shell reaches same KitLuy contracts; Telegram owns no truth. |
| `KLSF-LND-004` | Verified customer-phone linkage | Customer Core | Phone verification and assisted fallback are secure, rate-limited and audited. |
| `KLSF-LND-005` | Preliminary service and garment entry | Storefront/Laundry | Customer can propose eligible services/items without creating a Booking. |
| `KLSF-LND-006` | Estimated piece, bag and weight entry | Storefront/Laundry | Values are clearly estimated and never used as final without T1 verification. |
| `KLSF-LND-007` | Stain, damage and special-handling notes | Storefront/File Service | Notes/files are isolated, preliminary and available to authorized T1. |
| `KLSF-LND-008` | Physical Store queue check-in | Queue Service | Presence proof required by default; remote joining disabled unless approved. |
| `KLSF-LND-009` | Location and business-day queue numbering | Queue Service/Hub | Concurrent generation is unique, scoped and retry-safe. |
| `KLSF-LND-010` | Customer queue-status screen | Storefront | Own state is fresh/truthful and leaks no other customer data. |
| `KLSF-LND-011` | T1 Pre-Intake queue workspace | POS Desktop/Hub | T1 can call, assign and open actionable projected records. |
| `KLSF-LND-012` | T1 verification and correction | POS Desktop/Laundry | Actual values and reasons are recorded without overwriting customer submission. |
| `KLSF-LND-013` | Customer-versus-T1 difference record | Core/Laundry | Material differences are typed, auditable and customer-readable. |
| `KLSF-LND-014` | T2, Web or Telegram final confirmation | T2/Storefront | Exact verification version is confirmed; later changes invalidate confirmation. |
| `KLSF-LND-015` | Atomic Pre-Intake-to-Booking conversion | Core/Edge | Exactly one authoritative Booking is created or the transaction rolls back. |
| `KLSF-LND-016` | Queue skip, recall, expiry and no-show handling | Queue Service/Hub | State transitions follow policy and append-only event history. |
| `KLSF-LND-017` | Web and Telegram queue notifications | Notification Service | Delivery truth, consent, retry and suppression are auditable. |
| `KLSF-LND-018` | Store Hub queue projection and offline continuity | Store Hub | Existing projected records process offline; local operation never depends on Telegram. |
| `KLSF-LND-019` | Origin-channel attribution and analytics | Core/Reporting | Attribution survives conversion but never changes authority or finance truth. |
| `KLSF-LND-020` | Staff-assisted fallback intake | T1/Store Hub | T1 can continue local intake with audited attribution during channel/provider failure. |

## 18.2 Cross-product obligations

| Product/service | Required v1.1.0 changes |
|---|---|
| Shared KitLuy Core | Customer/session, idempotency, events, audit, draft/final boundary and conversion uniqueness. |
| Laundry Vertical Module | Service/item fields, estimate rules, condition, due-time and Booking conversion mapping. |
| `kitluy-pos-desktop-app` | T1 queue/verification workspace and T2 confirmation/payment presentation. |
| Store Hub | queue projection, local verification/conversion, outbox, reconciliation and file cache. |
| Partner Portal | publication, Location, service, queue and Telegram configuration/readiness. |
| Notification Service | queue and confirmation templates, Telegram/SMS delivery truth and consent. |
| File Service | secure customer evidence upload and local operational cache. |
| Reporting | channel, queue, correction, conversion and T1-time metrics with freshness labels. |
| Admin Portal | platform/provider/channel health, feature rollout and support diagnostics. |

## 18.3 Explicit Phase 1 exclusions

The following remain outside v1.1.0:

- full general eCommerce cart and checkout;
- online prepayment before T1 verification;
- general customer account portal/address book;
- custom Partner domains;
- theme/sections/block editor;
- broad CMS/blog;
- reviews/ratings;
- coupons/general promotion engine beyond existing T1 pricing rules;
- retail variants and large SKU catalog behavior;
- shipping zones/classes;
- international markets/duties;
- subscriptions/recurring commerce;
- abandoned-cart marketing;
- public app/theme marketplace;
- AI garment diagnosis, automatic damage judgment or automatic pricing override;
- remote queue join by default.

## 18.4 Version history

| Version | Date | Status | Change |
|---|---|---|---|
| v1.0.0 | 2026-07-25 planning recommendation | Superseded planning target | Initial narrow Laundry public Storefront concept. |
| **v1.1.0** | **2026-07-25** | **OWNER-APPROVED TARGET** | Adds QR entry, Web Pre-Intake, Telegram channel, physical virtual queue, T1 verification, customer difference confirmation, atomic Booking conversion and offline fallback. |

---

# Appendix A — Canonical reason codes

## A.1 Queue reason codes

```text
CUSTOMER_REQUEST
STORE_CLOSED
QUEUE_FULL
COUNTER_PAUSED
CUSTOMER_NOT_PRESENT
CUSTOMER_RETURNED
WRONG_LOCATION
DUPLICATE_REQUEST
UNSUPPORTED_SERVICE
SAFETY_RESTRICTION
SYSTEM_RECOVERY
MANAGER_OVERRIDE
OTHER
```

## A.2 Verification adjustment reasons

```text
CUSTOMER_ESTIMATE_INCORRECT
ACTUAL_WEIGHT_MEASURED
ACTUAL_PIECES_COUNTED
GARMENT_TYPE_CORRECTED
SERVICE_NOT_SUITABLE
SERVICE_UPGRADED_WITH_CONSENT
ADDON_ADDED_WITH_CONSENT
ADDON_REMOVED
STAIN_OR_DAMAGE_OBSERVED
CAPACITY_DUE_TIME_CHANGED
PRICE_RULE_RECALCULATED
CUSTOMER_IDENTITY_CORRECTED
DUPLICATE_LINE_MERGED
OTHER
```

## A.3 Storefront availability reasons

```text
OPEN
CLOSED
HOLIDAY
MACHINE_DOWN
STAFF_SHORTAGE
SUPPLY_OUT
POWER_ISSUE
WATER_ISSUE
CAPACITY_FULL
QUALITY_ISSUE
SAFETY_ISSUE
QUEUE_PAUSED
SYNC_STALE
SYSTEM_MAINTENANCE
OTHER
```

---

# Appendix B — Example contract payloads

The examples show shape and authority only. Exact schema names and fields must match the published API contract.

## B.1 Submit Pre-Intake

```json
{
  "locationRef": "loc_public_7x...",
  "customerSessionRef": "cs_...",
  "preferredLocale": "km",
  "originChannel": "STORE_QR",
  "lines": [
    {
      "serviceRef": "svc_wash_fold",
      "estimatedBagCount": 2,
      "estimatedWeight": {
        "value": "6.0",
        "unit": "kg"
      },
      "stainNote": "One white shirt has a coffee stain",
      "requestedAddonRefs": ["addon_fragrance"]
    }
  ],
  "preferredTimeWindow": {
    "date": "2026-07-25",
    "label": "Afternoon"
  },
  "policyAcceptanceVersion": "p1.1"
}
```

Response:

```json
{
  "preIntakeRef": "PI-260725-0182",
  "secureToken": "<redacted>",
  "status": "SUBMITTED",
  "estimate": {
    "status": "ESTIMATED",
    "currency": "KHR",
    "minimum": 24000,
    "maximum": 32000,
    "asOf": "2026-07-25T08:15:00Z",
    "disclaimerKey": "final_at_t1"
  },
  "checkIn": {
    "eligible": true,
    "presenceRequired": true
  }
}
```

## B.2 Queue Ticket

```json
{
  "queueRef": "<secure-token-scoped-reference>",
  "displayLabel": "A-027",
  "status": "WAITING",
  "customersAhead": 3,
  "customersAheadStatus": "CURRENT",
  "location": {
    "name": "Example Laundry — Central",
    "counter": "T1 Intake"
  },
  "asOf": "2026-07-25T08:22:00Z"
}
```

## B.3 T1 verified summary

```json
{
  "verificationRef": "iv_...",
  "version": 2,
  "customer": {
    "phoneMasked": "*** *** 483"
  },
  "submitted": {
    "estimatedBagCount": 2,
    "estimatedWeight": "5-7 kg",
    "service": "Wash and Fold"
  },
  "verified": {
    "pieceCount": 18,
    "weight": "6.4 kg",
    "service": "Wash and Fold",
    "addons": ["Stain treatment", "Fragrance"],
    "dueAt": "2026-07-27T16:00:00+07:00",
    "currency": "KHR",
    "finalAmountPreview": 28800
  },
  "differences": [
    {
      "type": "ACTUAL_WEIGHT_MEASURED",
      "from": "5-7 kg estimated",
      "to": "6.4 kg actual"
    },
    {
      "type": "ADDON_ADDED_WITH_CONSENT",
      "from": null,
      "to": "Stain treatment"
    }
  ],
  "summaryHash": "sha256:..."
}
```

## B.4 Conversion request

```json
{
  "verificationRef": "iv_...",
  "verificationVersion": 2,
  "confirmationRef": "cc_...",
  "idempotencyKey": "storehub-device-businessdate-sequence"
}
```

Response:

```json
{
  "bookingRef": "LB-260725-0041",
  "conversionStatus": "CONVERTED_TO_BOOKING",
  "paymentNextStep": "T1_PAYMENT",
  "originChannel": "STORE_QR"
}
```

---

# Appendix C — Decision and required-value register

## C.1 Owner-locked decisions

| Decision | Status |
|---|---|
| QR Pre-Intake, Telegram Shop and Virtual Queue | OWNER-LOCKED, effective 2026-07-25 |
| T1 remains final physical intake and payment authority | OWNER-LOCKED through product flow |
| Pre-Intake, Queue Ticket, Verified Intake and Laundry Booking are distinct | OWNER-LOCKED |
| Telegram is a channel, not a source of truth | OWNER-LOCKED |
| Customer/T1 versions are preserved separately | OWNER-LOCKED |
| Payment occurs only after authoritative Booking creation in v1.1.0 | OWNER-LOCKED scope |
| Store Hub/local T1 operation continues without Storefront/Telegram | OWNER-LOCKED architecture |

## C.2 Required values before production

- production Storefront domain and URL strategy;
- repository paths and approved package versions;
- production Supabase project references;
- DigitalOcean project, app/service and Spaces bucket names;
- API gateway/base paths;
- migration numbering reconciled with live history;
- phone verification provider, sender and rate limits;
- Telegram Bot identity, Mini App short name/URL, webhook and secrets;
- customer privacy notice and retention periods;
- file type/size/retention policy;
- queue expiry, skip, recall and no-show defaults/limits;
- accessibility target and browser/device matrix;
- performance budgets;
- monitoring thresholds and escalation policy;
- pilot Stores, duration, volume and KPI targets;
- approved support-consent and incident contacts.

No engineer or AI agent may guess these production values.

## C.3 Deferred decisions

- remote active-queue joining policy;
- online payment/prepayment before T1;
- custom domains in Phase 1;
- customer account depth;
- loyalty display/redemption;
- AI-assisted garment classification;
- broad pickup/delivery scheduling depth;
- wait-time prediction beyond simple queue hints.

Deferred items remain disabled until a versioned owner decision and phase gate are approved.

---

# Appendix D — Documentation impact

Approval and implementation of this specification require updates to:

- KitLuy Suite Rebuild Bible;
- KitLuy Suite Business Bible;
- Master Feature Registry and traceability map;
- Laundry vertical schema/data dictionary;
- Commerce Store API contract;
- Edge Operations API/Store Hub contract;
- POS Desktop T1/T2 Phase 1 specification;
- Partner Portal Storefront configuration routes;
- Notification Service templates/events;
- File Service customer-evidence policy;
- RBAC and audit registry;
- offline/sync/reconciliation runbooks;
- QA matrix and go-live checklist;
- customer privacy and support documentation.

---

# Final product statement

> **KitLuy Storefront v1.1.0 brings the familiar convenience of a modern restaurant QR menu to Laundry intake without treating customer estimates as operational truth. Customers scan, prepare and queue. T1 verifies the physical items, the customer confirms the final intake, KitLuy creates the authoritative Booking, and payment proceeds through the existing POS and finance controls.**
