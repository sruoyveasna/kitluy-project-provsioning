# KitLuy POS Desktop App — Phase 1 Laundry Product Specification

**Filename:** `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md`  
**Product:** `kitluy-pos-desktop-app`  
**Version:** v4.0.0  
**Date:** 2026-07-25  
**Vertical:** Phase 1 — Laundry  
**Owner:** HET / KitLuy Suite Project Owner  
**Audience:** Product owner, UI/UX, frontend engineers, Store Hub engineers, backend engineers, QA, implementation operators, support, security, DevOps, and AI handoff agents  
**Status:** Canonical target specification draft; not implementation evidence  
**Primary runtime:** Electron + React + TypeScript on Linux ARM64 / Raspberry Pi OS 64-bit  
**Local operational authority:** KitLuy Store Hub over the Store LAN  
**Languages:** Khmer and English  
**Currencies:** KHR and USD, subject to authoritative store payment and exchange-rate policy  
**Timezone:** `Asia/Phnom_Penh`

> **Mission:** A qualified engineer must be able to reconstruct the Phase 1 Laundry POS Desktop product from this specification, the referenced shared contracts, approved migrations, and deployment instructions without relying on undocumented knowledge.

---

## 0. Document Authority, Evidence, and Version Meaning

### 0.1 Why v4.0.0

v4.0.0 is a major product-level consolidation because it replaces the older three-terminal POS model with the owner-locked four-profile Laundry terminal model:

| Profile | Canonical name | Binding purpose |
|---|---|---|
| T1 | POS Cashier / Intake Terminal | Customer intake, Booking creation, pricing, deposit/payment, receipt and tag printing |
| T2 | Customer Display Screen | Customer-facing Booking mirror, totals, KHQR, payment state, receipt choice and pickup reference |
| T3 | Clean & Ready Scan-In Terminal | Quality/count verification, packaging, storage assignment and Ready custody event |
| T4 | Customer Pickup Scan-Out Terminal | Collector verification, garment retrieval, balance control, custody release and Booking completion |

The earlier Suite v3.0.0 bible remains a reusable source for shared architecture, local APIs, hardware, payment, files, security, deployment, monitoring and QA patterns. Its older T1/T2/T3 terminal mapping is superseded wherever it conflicts with the July 21, 2026 owner lock.

### 0.2 Status labels used in this specification

| Label | Meaning |
|---|---|
| **OWNER-LOCKED** | Explicit current owner decision. Must not be changed without a versioned owner decision. |
| **APPROVED TARGET** | Approved product direction, but not proven implemented. |
| **SPECIFIED IN v4** | Concrete contract or design defined by this document to make the target buildable. It requires normal product approval and implementation evidence. |
| **PROPOSED / OPTIONAL** | Candidate capability outside the minimum Phase 1 exit or requiring a separate decision. |
| **DEFERRED** | Explicitly excluded from Phase 1 and retained for a later phase. |
| **REJECTED** | Prohibited pattern or product-boundary violation. |
| **[REQUIRED: ...]** | Missing owner, provider, legal, commercial, deployment or implementation-specific value. Do not guess. |
| **IMPLEMENTED** | Reserved for repository, migration, test, deployment or production evidence. This document does not assign this label. |

### 0.3 Authority order

```text
1. Current Project Instructions and explicit owner decisions
2. Applied migrations, verified repository code/tests and production evidence
3. This v4.0.0 POS Desktop specification
4. Current KitLuy Rebuild and Business Bibles where not superseded
5. Approved product backlogs and evidence-based competitor analyses
6. Competitor clone documents as design references only
7. Older or superseded planning
```

### 0.4 Primary source groups used

| Source group | Primary use |
|---|---|
| Current KitLuy Project Instructions | Eight-phase roadmap, one Store/one vertical, Digital Store model, shared Core, offline, finance, security and evidence rules |
| `kitluy-concept-design-1.txt` | OWNER-LOCKED T1–T4 Laundry terminal architecture |
| `Device Management & Provisioning System.txt` | OWNER-LOCKED smartphone-simple Hub-first provisioning, device certificates and LAN discovery |
| `Project Instruction Writing.txt` | Electron/React ARM64, Raspberry Pi hardware, Store Hub authority, files and signed A/B release model |
| `kitluy-suite-rebuild-bible-v3.0.0.md` | Reusable platform topology, data flows, POS/Hub boundaries, hardware, APIs, security, monitoring, SOP and QA baseline; terminal names reconciled here |
| Partner Portal and Partner App bibles | Back-office boundaries, finance truth, approvals, freshness and role boundaries |
| KitLuy Master Feature Registry v0.2 | Canonical capability ownership and source traceability |
| WooCommerce comparison/backlog | Preserve KitLuy POS/Hub authority; shared pricing, approval, event and API foundations only |
| Loyverse comparison/classification | Fast counter UX, T2 phases, staff switching, shift ergonomics, hardware diagnostics, reconnect UX and first-Booking training |
| Toast comparison/backlog | T2 privacy/payment-state rigor, role-gated modes, scoped approvals, print reliability and later Restaurant boundaries |
| Shopify comparison/backlog | Preserve T1–T4; defer retail omnichannel/register depth to later phases |
| Lightspeed comparison/backlog | Phase-exit evidence, hardware/offline rigor and later Restaurant/Retail mode separation |

### 0.5 Conflict resolutions locked by this document

| Conflict | Resolution |
|---|---|
| Older T2 = Scan-In and T3 = Scan-Out | Superseded. T2 is CDS, T3 is Ready Scan-In, T4 is Pickup Scan-Out. |
| T3/T4 as one workflow | They may share hardware but remain separate modes, permissions, state, audit and acceptance tests. |
| T2 as KDS or Laundry production board | Rejected. T2 is customer-facing only. A production display requires a separate product/profile decision. |
| Cloud as POS write authority | Rejected. Store Hub is the local operational authority after provisioning. |
| Direct POS writes to Supabase | Rejected for normal store operation. POS uses authenticated Store Hub LAN contracts. |
| Device trust based on IP address | Rejected. Trust requires device identity, certificate, Tenant, Digital Store, Location and Hub binding. |
| Destructive correction of financial or custody history | Rejected. Use compensating records and append-only events. |
| Competitor POS product as KitLuy architecture | Rejected. Competitors contribute selected UX/control patterns only. |

---

# Part 1 — Product Definition and Boundaries

## 1.1 Product statement

`kitluy-pos-desktop-app` is the fixed-store, offline-first staff application that executes Laundry Bookings through T1–T4 under Store Hub authority.

It is one Electron product with separately assigned and permissioned operational profiles. It is not four independent Suite products.

## 1.2 Primary outcomes

1. Complete a customer Laundry Booking quickly and accurately at T1.
2. Show the customer an accurate, privacy-safe Booking and payment view at T2.
3. Move cleaned garments into Ready storage with verified custody at T3.
4. Release the correct garments to the correct collector with financial and custody controls at T4.
5. Continue core operation during WAN failure.
6. Preserve append-only financial, garment and audit truth.
7. Make provisioning, hardware diagnostics and updates manageable at fleet scale.
8. Keep the product reusable for future vertical profiles without hardcoding Laundry terms into shared Core.

## 1.3 Product boundaries

### POS Desktop owns

- Fixed-terminal staff UX
- T1–T4 profile presentation and local workflow orchestration
- Staff authentication and action-scoped elevation UX
- Booking intake interaction
- Customer lookup/create interaction
- Garment, weight, piece and condition capture
- Payment/deposit interaction through approved Hub/payment contracts
- Receipt/tag print requests and status
- T2 customer display session
- T3 Ready Scan-In workflow
- T4 Pickup Scan-Out workflow
- Shift and cash workflows included in Phase 1 policy
- Hardware status and guided test UX
- Offline/degraded/reconnect UX
- Local application health, logs and update UX

### Store Hub owns

- Local operational database
- Authoritative local write transactions
- Edge Operations API
- Device, profile and certificate validation
- Local permission evaluation
- Idempotency and duplicate suppression
- Print queues and hardware adapters
- Local file repository/upload queue
- Outbox/inbox and cloud synchronization
- LAN event channels
- Receipt/document sequence authority according to approved policy
- Local health and terminal heartbeat processing
- Signed release download and terminal distribution

### Shared Core / cloud owns

- Tenant, Digital Store, Location and membership authority
- Canonical catalog, pricing and configuration
- Cloud system-of-record ingestion after sync
- Payments, finance, customers, inventory/consumables and reporting contracts
- Supabase Auth/PostgreSQL/RLS/Realtime/metadata/audit
- DigitalOcean hosting, workers, Spaces, AI/MCP/RAG and release repository
- Notifications and provider integrations

### Partner Portal owns

- Store configuration
- Services, pricing and policy setup
- Staff and permission administration
- Device assignment and terminal profiles
- Receipt/tag templates
- Payment and KHQR configuration
- Full finance/reconciliation and exports
- Store settings, Integration Hub and support workflows

### Partner App owns

- Owner/manager mobile cockpit
- Alerts, approvals and freshness-aware summaries
- It is not a cashier or fixed-terminal replacement.

## 1.4 Users and actors

| Actor | Primary use | Default access |
|---|---|---|
| Cashier / Intake staff | T1 Booking intake, payment, printing and customer service | T1 only, plus approved shared actions |
| Customer | Reads and optionally enters permitted receipt/contact data on T2 | No staff access |
| Production / Ready staff | T3 QA, count, packaging and Ready storage | T3 only |
| Pickup staff | T4 collector verification, retrieval and release | T4 only |
| Supervisor | Exception handling and selected approvals | Assigned profiles plus scoped approval capability |
| Store manager | All local profiles and action approvals according to policy | Profile access remains explicit; no implicit platform rights |
| Technician / installer | Provisioning and hardware diagnostics | No Booking/payment access unless separately assigned |
| Support operator | Consent-based diagnostics through Admin/Hub tools | No permanent local business-role impersonation |

## 1.5 Phase 1 non-goals

The following are not part of the Phase 1 Laundry POS release:

- Restaurant Quick Order, tables, checks, tabs, courses or KDS
- Retail barcode-first large-catalog checkout
- BOPIS, ship-to-customer and any-location returns
- Retail exchanges, store credit and gift cards
- Self-checkout or unattended payment
- Pharmacy/controlled-item workflows
- Grocery embedded-weight barcode workflows
- Offline card capture
- Incremental card preauthorization
- Public app/theme marketplace
- Direct connector access to the production database
- A Laundry production display disguised as T2
- AI autonomous mutation of payment, finance, permission, custody or safety records

---

# Part 2 — Terminal Architecture and Physical Deployment

## 2.1 Canonical T1–T4 model

```text
Customer arrives
      │
      ▼
T1 — POS Cashier / Intake
      │ mirrored session
      ├──────────────► T2 — Customer Display Screen
      │
      ▼
Laundry production
Washing → Drying → Pressing → QA → Packaging
      │
      ▼
T3 — Clean & Ready Scan-In
      │
      ▼
Ready storage / rack / shelf / conveyor
      │
      ▼
Customer or authorized collector arrives
      │
      ▼
T4 — Customer Pickup Scan-Out
      │
      ▼
Booking completed
```

## 2.2 Reference hardware topology

| Physical unit | Reference hardware | Assigned profiles |
|---|---|---|
| Store Hub | Raspberry Pi 5, 8 GB RAM, 256 GB NVMe, active cooling, UPS recommended | Hub service only |
| Front Counter Terminal | Raspberry Pi 5, 4 GB, touchscreen/desktop display | T1 operator UI + T2 customer-facing display |
| Ready/Pickup Terminal | Raspberry Pi 5, 4 GB, scanner and optional secondary display | T3 + T4, separately permissioned modes |

A larger store may deploy T1, T2, T3 and T4 on separate devices. The logical model must not depend on physical colocation.

## 2.3 Peripheral profile

| Device | Phase 1 purpose | Authority/adapter |
|---|---|---|
| Receipt printer | Customer receipts, payment evidence and reprints | Hub print service |
| Tag/label printer | Booking, bag and garment tags | Hub print service |
| Barcode/QR scanner | Booking, tag, receipt and pickup lookup | Hub hardware adapter / POS input service |
| Weighing scale | Per-weight intake | Hub scale adapter with stability/tare metadata |
| Cash drawer | Cash handling and approved open action | Printer pulse or certified adapter through Hub |
| Customer display | T2 presentation | Assigned T2 profile and Hub session channel |
| Camera | Garment/stain/damage evidence where terminal hardware supports it | POS capture to Hub file queue |
| Conveyor/storage controller | Optional future/qualified hardware | Must not block baseline Phase 1 operation |
| UPS | Power continuity for Hub and critical terminal | Operational recommendation |

## 2.4 Profile assignment rules

1. Partner Portal creates terminal assignments.
2. Store Hub must be active before a terminal can be provisioned.
3. Terminal receives its permitted profile set during provisioning.
4. Installer cannot self-select T1–T4 roles.
5. Profile changes require an authorized cloud assignment and signed configuration deployment.
6. T3 and T4 may share hardware but must require explicit mode entry and actor validation.
7. Temporary application state must be cleared when changing profiles or actors.
8. Every profile change is audited.

---

# Part 3 — Rebuild and Activation Sequence

## 3.1 Rebuild sequence

1. Provision or select the Supabase and DigitalOcean environments defined by Suite infrastructure authority.
2. Apply approved Core, POS, Laundry, payments, devices/sync, files and audit migrations in verified order.
3. Apply an additive v4 T1–T4 delta migration; never rename or rewrite already-applied production migrations.
4. Seed terminal profiles, permissions, event types, reason codes, device types and default Laundry workflow data.
5. Deploy Store Hub services and Edge Operations contracts.
6. Build the signed Electron ARM64 package.
7. Prepare Store Hub and terminal images.
8. Create a Digital Store and Laundry Store/Location.
9. Provision and activate the Store Hub.
10. Create terminal assignments in Partner Portal.
11. Provision front-counter and ready/pickup terminals.
12. Pair and test peripherals.
13. Run offline, payment, custody, print, recovery and security QA.
14. Execute a full Booking lifecycle smoke test.
15. Approve pilot go-live.

## 3.2 Smartphone-simple terminal activation

```text
Power on terminal image
→ Choose language
→ Connect to network
→ Enter or scan provisioning code
→ Confirm assigned Store and terminal name
→ Receive device certificate and assigned Hub
→ Receive T1–T4 profiles
→ Discover and authenticate to Store Hub
→ Download active configuration
→ Test display and peripherals
→ Become Active
```

## 3.3 Hub connection priority

```text
1. Assigned Hub private IP
2. Assigned Hub hostname
3. Automatic LAN discovery
4. Last successful Hub IP
5. Latest trusted Hub IP reported through cloud
6. Manual IP recovery fallback
```

An address locates the Hub; it does not establish trust. Every connection validates Hub UUID, certificate, Tenant, Digital Store, Location and terminal assignment.

---

# Part 4 — Shared POS Application Shell

## 4.1 Shell modules

| Module | Purpose |
|---|---|
| Boot and health gate | Validates installation, profile, certificate, Hub, time and required configuration |
| Actor session | Staff PIN login, lock, switch and scoped elevation |
| Profile launcher | Shows only profiles assigned to both device and actor |
| Navigation shell | Profile-specific navigation and shared status areas |
| Connectivity center | Hub, WAN, cloud-sync, payment provider and notification status |
| Peripheral center | Printer, scanner, scale, drawer and display status/tests |
| Sync/recovery center | Pending events, oldest age, retries, conflicts and recovery guidance |
| Update center | Current version, assigned channel, staged update, health check and rollback state |
| Diagnostics bundle | Redacted logs, device state and support export with consent |
| Training/practice mode | Guided first Booking and device tests without posting live financial truth |

## 4.2 Shared interaction principles

- Touch-first, large targets and high-contrast state indicators
- Persistent current actor, Location, profile and shift indicators
- Clear separation of Hub offline versus internet offline
- No unlabeled stale, cached, estimated or demo data
- Destructive-looking actions replaced by controlled correction workflows
- A result is shown as successful only after authoritative Hub persistence
- One primary action per screen state
- Barcode/QR scanning should work without tapping into a field where possible
- Manual fallback is visible, permissioned and audited
- Khmer and English labels must fit without truncating critical values
- Keyboard, scanner and touch workflows must coexist

## 4.3 Actor switching

1. Current actor selects **Switch staff** or the session locks.
2. New actor enters PIN or approved credential.
3. Hub validates actor, device, Location and profile permissions.
4. Previous one-shot approvals are invalidated.
5. Temporary customer and payment data are cleared unless a controlled handoff is active.
6. New actor is visibly displayed.
7. Audit records old actor, new actor, device, profile and time.

## 4.4 Action-scoped manager approval

Manager elevation must be:

- Bound to one requested action
- Bound to the target entity and action parameters
- Time-limited
- Reason-coded where required
- Attributed to requester and approver separately
- Invalid after use, actor switch, profile switch or material parameter change
- Available locally through the Hub when policy permits offline approval
- Synced to cloud audit later

It must never become a persistent hidden manager session.

## 4.5 Application routes

**SPECIFIED IN v4 — target route inventory**

| Route | Profile | Purpose |
|---|---|---|
| `/boot` | Shared | Startup validation and recovery |
| `/login` | Shared | Staff authentication |
| `/profiles` | Shared | Authorized profile launcher |
| `/status` | Shared | Hub, sync, payment, file and peripheral health |
| `/devices` | Shared | Local device status and guided tests |
| `/updates` | Shared | Release state and rollback visibility |
| `/training` | Shared | Practice mode |
| `/t1/intake` | T1 | New Booking intake |
| `/t1/bookings` | T1 | Active/open Booking lookup |
| `/t1/booking/:id` | T1 | Booking detail and controlled actions |
| `/t1/payment/:id` | T1 | Deposit, balance and tender |
| `/t1/print/:id` | T1 | Receipt/tag print status and reprint |
| `/t1/shift` | T1 | Shift and cash controls |
| `/t2/session` | T2 | Customer display state machine |
| `/t3/ready` | T3 | Ready Scan-In queue/workspace |
| `/t3/booking/:id` | T3 | QA, count, packaging and storage assignment |
| `/t4/pickup` | T4 | Pickup lookup and scan workspace |
| `/t4/booking/:id` | T4 | Verification, retrieval, balance and release |
| `/exceptions` | Assigned profiles | Role-scoped garment/operation exceptions |

---

# Part 5 — T1 POS Cashier / Intake Specification

## 5.1 T1 responsibilities

T1 is the customer-facing staff terminal for:

- Customer search/create
- Booking intake
- Service and add-on selection
- Per-weight and per-piece capture
- Garment/bag details
- Condition, stain and damage evidence
- Due/pickup or delivery details
- Price and discount preview
- Deposit/full payment/pay-at-pickup handling
- Cash and KHQR interaction
- Receipt and tag printing
- Controlled void/refund/reprint requests
- Shift and cash operations where enabled

T1 must not mark garments Ready without T3 custody evidence and must not complete pickup without the T4 release workflow.

## 5.2 T1 intake layout

Recommended landscape layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Header: Store | T1 | Actor | Shift | Hub/WAN/Sync | Time           │
├───────────────────────────────┬─────────────────────────────────────┤
│ Service/category grid         │ Persistent Booking panel            │
│ Search                        │ Customer                             │
│ Common services               │ Lines / weight / pieces             │
│ Recent services               │ Add-ons / discounts                 │
│ Scanner/scale state           │ Deposit / balance / total           │
│                               │ Primary next action                  │
├───────────────────────────────┴─────────────────────────────────────┤
│ Footer: peripherals | draft saved | validation/errors              │
└─────────────────────────────────────────────────────────────────────┘
```

## 5.3 New Booking workflow

1. Start new draft.
2. Search or create customer; anonymous/walk-in behavior follows store policy.
3. Select service category and service.
4. Choose per-piece, per-weight or mixed line type allowed by service contract.
5. Capture weight from scale or audited manual fallback.
6. Enter piece count and garment/bag details where required.
7. Add add-ons, handling instructions and urgency.
8. Record garment condition, stains, damage and evidence.
9. Set due date and pickup/delivery option.
10. Review calculated price snapshot.
11. Apply approved discount or request action-scoped approval.
12. Select deposit/full payment/pay-at-pickup policy.
13. Persist Booking locally through Hub.
14. Create payment/tender records if payment occurs.
15. Queue receipt and tag print jobs.
16. Show Booking number, due date and next status only after Hub confirms persistence.
17. T2 transitions to confirmation/thank-you state.

## 5.4 Draft behavior

- Draft is mutable and recoverable before financial finalization.
- Draft must be Hub-authoritative when Hub is reachable.
- Draft auto-save status is visible.
- A recovered draft shows original actor, last edited time and state.
- Finalization creates immutable financial/transaction snapshots.
- Abandoned drafts follow `[REQUIRED: retention and cleanup policy]`.
- Named/predefined open-Booking templates are optional after pilot and must use Laundry-neutral names such as corporate batch, hotel batch, awaiting weight or pickup/delivery intake.

## 5.5 Customer lookup and creation

Search inputs:

- Cambodian phone number
- Customer name
- Customer ID
- Booking number
- Receipt/tag/QR
- Recent Booking history

Requirements:

- Phone-first normalization for Cambodia
- Duplicate warning without blocking legitimate shared numbers
- Minimum PII collection
- Consent captured for notification or e-receipt use
- Existing customer data not exposed beyond role need
- Pickup requires secondary verification; customer lookup alone is insufficient

## 5.6 Service and line capture

Each Booking line must retain an authoritative snapshot of:

- Service ID/version
- Display name in selected language
- Pricing method
- Unit price
- Quantity/weight
- Add-ons
- Discount allocation
- Tax components if applicable
- Currency
- Staff/device/time
- Source configuration version

POS must not recalculate historical lines from later catalog changes.

## 5.7 Scale interaction

The scale component shows:

- Device identity
- Connected/disconnected state
- Raw reading
- Tare
- Stable reading
- Stability/confidence state
- Unit
- Last valid reading time
- Manual fallback status

Manual entry requires a reason when policy says so and records actor/device/audit. Test mode must not create live Booking lines.

## 5.8 Garment and condition capture

Supported Phase 1 details:

- Garment/category type
- Color or distinguishing information
- Piece count
- Bag/package grouping
- Customer note
- Internal handling note
- Existing stain/damage marker
- Photo/evidence attachment
- Special handling and rewash/damage acknowledgement where applicable

Photos captured offline are stored through the Hub local file repository and upload queue. Cloud metadata must not claim the file is available until upload confirmation.

## 5.9 Discounts

- Named quick discount buttons may be configured.
- The preview shows original amount, discount, reason, approver state and final amount.
- Restricted discounts request scoped approval.
- Historical price/discount snapshots are immutable.
- Post-payment correction uses void/refund/adjustment policy, not silent line editing.

## 5.10 Payments and deposits

Phase 1 required:

- Cash
- KHQR when configured and provider contract is active
- Deposit
- Full payment
- Pay remaining balance at pickup
- Authoritative pending/confirmed/failed/expired/reversed states

Optional after pilot:

- Mixed cash + KHQR or other approved tender, represented as separate append-only tender legs

Rules:

1. T1 never labels a payment confirmed from QR presentation alone.
2. KHQR confirmation comes from an authoritative provider reconciliation path.
3. Pending KHQR remains visibly pending.
4. Internet/provider failure cannot fabricate success.
5. Cash may continue during WAN outage through Hub-local authority.
6. Offline card capture is prohibited.
7. Payment reversals and refunds are compensating records.

## 5.11 Receipt and tag printing

Required print artifacts:

- Customer receipt
- Booking receipt/reference
- Bag tag
- Garment tag where configured
- Reprint copy with reprint marker/reason

Print flow:

1. Hub creates a unique print job ID.
2. Hub selects the signed printer profile and template version.
3. Job enters local durable queue.
4. Adapter prints and returns status.
5. Duplicate suppression prevents accidental reprint on retry.
6. Failure shows actionable recovery.
7. Reprint requires permission and reason.
8. Job history is auditable.

The final receipt/document numbering policy remains `[REQUIRED: owner-approved collision-safe Store/Location numbering policy]`.

## 5.12 Refund, void and correction requests

- Original Booking/payment context is shown.
- Staff selects reason and affected amount/line.
- Manager approval is requested if required.
- Core/Hub validates eligibility.
- Result is a compensating document/event.
- Historical records remain visible.
- Provider refund pending/failure states remain explicit.
- POS does not silently reopen a finalized financial document.

---

# Part 6 — T2 Customer Display Screen Specification

## 6.1 T2 boundary

T2 is a customer-facing display paired to the active T1 session. It is not:

- A staff terminal
- A KDS
- A Laundry production board
- A pickup custody terminal
- A source of payment truth

## 6.2 T2 state machine

```text
IDLE
  → SESSION_BOUND
  → INTAKE_MIRROR
  → REVIEW
  → PAYMENT_REQUESTED
      → KHQR_PENDING
      → CASH_PROCESSING
      → PAYMENT_CONFIRMED
      → PAYMENT_FAILED_OR_EXPIRED
  → RECEIPT_CHOICE
  → PICKUP_REFERENCE
  → THANK_YOU
  → PRIVACY_RESET
  → IDLE
```

## 6.3 T2 displayed information

- Store identity
- Booking number after creation
- Service/garment line descriptions
- Quantity and weight
- Add-ons
- Discounts
- Taxes where applicable
- Total
- Deposit
- Amount paid
- Remaining balance
- KHQR
- Payment state
- Change due where appropriate
- Due/pickup date
- Receipt choice
- Pickup reference/instructions

## 6.4 T2 privacy requirements

1. T2 receives a session-bound, customer-safe projection only.
2. Customer phone/email are masked unless being entered or confirmed for the current session.
3. New T1 session must never inherit prior customer data.
4. Profile/actor switch clears T2.
5. T1 cancellation clears T2.
6. Reconnect rebinds only after validating the active T1 session token through Hub.
7. Idle timeout triggers privacy reset.
8. Screenshots, logs and diagnostics must redact customer and payment-sensitive data.
9. Promotional content must not obscure payment or consent information.

## 6.5 T2 customer interaction

Phase 1 may support:

- Language selection
- Receipt choice
- Confirming displayed Booking information
- Entering phone/email for e-receipt where consent and notification contracts exist

T2 must not allow customers to alter service price, payment state, custody state or staff-only notes.

## 6.6 T2 offline behavior

- T2 derives state from Store Hub, not cloud.
- WAN outage does not break active T1/T2 mirroring.
- KHQR provider unavailability is shown separately from Hub status.
- Reconnect replays only the current authorized session state.
- T2 must never show a stale QR or previous customer payment result.

---

# Part 7 — T3 Clean & Ready Scan-In Specification

## 7.1 T3 responsibility

T3 moves garments from production completion into Ready storage. It creates the authoritative local custody transition after QA, count and storage verification.

T3 does not collect final payment and cannot complete customer pickup.

## 7.2 T3 workflow

1. Actor authenticates and enters T3.
2. Scan Booking, bag or garment tag.
3. Hub resolves expected items and latest custody state.
4. Display production/ready eligibility.
5. Verify identity and count.
6. Complete QA checklist.
7. Record packaging state.
8. Resolve or create exceptions.
9. Scan/select storage position.
10. Persist scan and storage assignment in one local transaction.
11. Repeat for remaining units.
12. Evaluate Ready rule.
13. When satisfied, mark the Booking or eligible group Ready.
14. Emit ready event and notification request.
15. Show storage summary and completion result.

## 7.3 Ready eligibility

A unit or Booking cannot become Ready when any blocking condition exists:

- Missing expected garment/package
- Unresolved identity mismatch
- Failed QA
- Required rewash
- Unresolved damage exception
- Invalid or occupied storage position
- Duplicate scan
- Booking status incompatible with readiness

The exact partial-ready policy is `[REQUIRED: owner decision on partial Booking readiness and customer notification]`.

## 7.4 T3 QA and exceptions

Minimum exception types:

- Missing
- Extra
- Damaged
- Rewash required
- Mismatch
- Unreadable tag
- Count difference
- Packaging issue
- Storage conflict
- Other reason-coded exception

Each exception records:

- Booking/garment/package reference
- Type and severity
- Actor/device/profile
- Timestamp
- Note
- Evidence attachment where required
- Blocking/non-blocking state
- Resolution state and resolver

## 7.5 Storage assignment

Supported storage abstractions:

- Rack
- Shelf
- Bin
- Room/zone
- Conveyor position
- Other configured location type

Rules:

- Position identity is unique within Location.
- Occupied/block/maintenance status is Hub-authoritative.
- Assignment and clearing are append-only custody events plus current projection.
- Double assignment is blocked transactionally.
- Manual override requires permission and reason.
- Conveyor hardware is optional; baseline workflow works with barcode-labeled storage.

## 7.6 T3 completion

Successful completion shows:

- Verified count
- QA status
- Packaging status
- Storage positions
- Remaining exceptions
- Ready state
- Notification queued/blocked state

The UI must not claim notification delivered until Notification Service reports delivery truth.

---

# Part 8 — T4 Customer Pickup Scan-Out Specification

## 8.1 T4 responsibility

T4 verifies the collector, retrieves the correct garments, enforces remaining-balance policy, records custody release and completes the Booking.

T4 is the only terminal profile authorized to complete pickup.

## 8.2 Pickup lookup

Supported inputs:

- Booking number
- Receipt QR/barcode
- Bag/garment tag
- Pickup token
- Customer phone
- Customer ID
- Customer name with secondary verification

Customer lookup is not sufficient proof of authorization by itself.

## 8.3 Collector verification

Verification options are store-policy driven and may include:

- Receipt/pickup token
- Phone challenge or matching customer data
- Customer ID reference
- Authorized collector record
- Staff-confirmed exception with manager approval

The exact identity-verification policy and any OTP provider are `[REQUIRED: owner/legal/privacy decision]`.

## 8.4 T4 workflow

1. Actor authenticates and enters T4.
2. Search or scan pickup reference.
3. Hub validates Booking Ready state.
4. Show storage positions, expected garment/package count and balance.
5. Verify collector.
6. Retrieve and scan each expected unit.
7. Block wrong, duplicate or missing scans.
8. Resolve exceptions or request manager approval.
9. Enforce remaining-balance policy.
10. Capture payment through approved local/payment flow if permitted at T4.
11. Show final handover summary.
12. Confirm release.
13. Persist append-only custody release and financial linkage.
14. Clear storage positions.
15. Mark Booking `Picked Up` / completed only after all required checks pass.
16. Print or send final receipt where configured.

## 8.5 Balance and payment at T4

- T4 displays authoritative balance from Hub.
- The product must specify whether T4 directly captures payment or invokes a T1 payment handoff per store profile.
- Default v4 target permits T4 payment only when device, actor, cash/KHQR hardware and policy are assigned.
- Otherwise T4 pauses at `payment_required` and hands off to T1 without releasing custody.
- A release override requires scoped manager approval and explicit reason.
- No release is completed from an unconfirmed KHQR state.

## 8.6 T4 custody rules

- Every scan records actor/device/profile/time.
- Wrong-Booking scan is blocked and audited.
- Duplicate scan is ignored or blocked deterministically and shown.
- Missing unit blocks standard completion.
- Exceptional partial release requires explicit policy, reason and approval.
- Storage positions clear only as part of a successful release transaction or authorized correction.
- Final Booking completion is append-only.

---

# Part 9 — Cross-Profile Workflow and State Machines

## 9.1 Booking lifecycle

User-facing recommended statuses:

```text
Draft
→ Received
→ Washing
→ Drying
→ Pressing
→ QA / Packaging
→ Ready
→ Picked Up
```

Exception paths:

```text
Any eligible stage
→ Issue
→ Rewash / Damage Review / Resolution
→ Return to approved stage
```

Other terminal states:

- Cancelled
- Payment Pending
- Payment Required
- Pickup Exception
- Delivery/Pickup scheduling states when enabled

Backend compatibility may retain legacy `order` and `ironing` values behind adapters. User-facing POS copy uses **Booking** and **Pressing**.

## 9.2 Custody lifecycle

```text
Intake registered
→ In production
→ QA verified
→ Packaged
→ Assigned to Ready storage
→ Retrieved for pickup
→ Collector verified
→ Released
```

Every transition that changes custody is append-only and actor/device scoped.

## 9.3 Payment lifecycle

```text
No payment
→ Payment requested
→ Pending verification
→ Confirmed
→ Partially paid / balance remaining
→ Paid
```

Correction paths:

```text
Confirmed payment
→ Void requested / Refund requested
→ Approved or rejected
→ Provider pending if applicable
→ Compensating record posted
```

## 9.4 T1–T2 session relationship

- One active customer-facing session per assigned T2 display unless multi-display contract is approved.
- Session created by T1 through Hub.
- T2 receives a redacted projection.
- Session closes on completion, cancellation, timeout, actor switch or error recovery.
- Session IDs and sequence numbers prevent stale replay.

## 9.5 T3–T4 relationship

T3 and T4 share the same custody model but not the same authority:

| Concern | T3 | T4 |
|---|---|---|
| Verify production completion | Yes | Read only |
| QA/count/packaging | Yes | Verify expected release count |
| Assign Ready storage | Yes | No |
| Locate storage | Read/write assignment | Read/retrieve |
| Collect remaining balance | No | Conditional by policy |
| Release garments | No | Yes |
| Complete Booking | No | Yes |

---

# Part 10 — Shift, Cash and Employee Operations

## 10.1 Phase 1 target

Phase 1 includes practical shift and cash control required for Laundry cash operations. Detailed Retail register features remain later-phase work.

## 10.2 Shift open

- Actor signs in.
- Select/open assigned register/shift.
- Enter opening float where required.
- Hub records opening cash movement.
- Required printers/drawer/payment health is checked.
- Shift opening is allowed offline under Hub authority.

## 10.3 Cash movements

Supported types:

- Opening float
- Cash sale/deposit
- Pay-in
- Pay-out
- Cash drop
- Refund cash out
- Drawer open/no-sale where approved
- Closing count
- Variance adjustment only through approved accounting workflow

Every movement requires actor, device, reason where applicable and append-only ledger entry.

## 10.4 Shift close

1. Stop or transfer active cash responsibilities according to policy.
2. Count cash.
3. Enter counted values.
4. Hub calculates expected and variance.
5. Resolve missing actions and required reason codes.
6. Request manager approval for variance threshold breaches.
7. Persist close locally.
8. Queue cloud sync and report generation.
9. Show reconciliation state and unresolved items.

Whether expected cash is hidden until blind count is `[REQUIRED: owner-approved cash-count policy]`.

## 10.5 Time clock

Time clock/time cards are Phase 1 optional. If enabled:

- Employee clock state is separate from POS shift state.
- Clock action works locally through Hub.
- Missing clock alerts are visible.
- Corrections require explicit approval and audit.

---

# Part 11 — Offline, Store Hub and Synchronization

## 11.1 Authority model

```text
Cloud configuration authority
          ↓ signed/versioned projection
Store Hub local operational authority
          ↓ authenticated LAN contracts
T1 / T2 / T3 / T4
          ↓ local events and files
Store Hub outbox
          ↓ asynchronous sync
Supabase / DigitalOcean services
```

## 11.2 Required offline capabilities

During WAN outage, provided the Hub and LAN remain healthy:

- Staff login from valid local credential cache
- T1 Booking intake
- Local service/pricing snapshot use
- Cash payment and deposits
- Receipt/tag printing
- Customer/Booking lookup from local authorized data
- T1/T2 display session
- T3 scans, QA, storage and Ready state
- T4 lookup, retrieval and custody release subject to payment/provider policy
- Shift/cash movements
- Local file/evidence capture
- Audit and outbox creation

## 11.3 Degraded capabilities

The UI must distinguish:

| Condition | Message/behavior |
|---|---|
| WAN unavailable, Hub healthy | Store operations continue; cloud sync delayed |
| Payment provider unavailable | Cash continues; KHQR/card states follow provider policy and remain pending/blocked as applicable |
| Notification provider unavailable | Booking action succeeds locally; notification queued, not claimed delivered |
| Spaces unavailable | Local evidence retained; upload queued |
| Hub unreachable | Normal operations blocked or limited to explicitly approved bounded recovery cache; no unofficial independent truth |
| Printer unavailable | Booking may persist; print job remains failed/pending with recovery path |
| Scale unavailable | Audited manual fallback if authorized |
| Cloud configuration stale | Continue last approved local configuration within compatibility policy; show version/freshness |

## 11.4 Terminal-side cache

POS may maintain:

- Signed application assets
- UI preferences
- Assigned Hub endpoints
- Device certificate/private-key material in secure storage
- Short-lived session data
- Temporary display cache
- Optional bounded encrypted retry buffer for transient LAN loss after pilot

POS must not become a second independent transaction database. Any optional LAN-loss buffer must clearly say **Not accepted by Store Hub** until acknowledged.

## 11.5 Idempotency

Every mutation request includes:

- Device ID
- Terminal profile
- Local monotonic sequence or approved idempotency key
- Actor ID
- Store/Location ID
- Operation type
- Client occurred-at time
- Payload hash where required

Hub returns the original result for replayed keys. Duplicate payment, Booking, print and custody actions must be prevented.

## 11.6 Conflict policy

| Data class | Conflict treatment |
|---|---|
| Financial/payment | Append-only, first-write/command validation and compensating records; never generic LWW |
| Custody/scan | Append-only events with transactional current projection |
| Inventory/consumables | Ledger/reconciliation rules; never generic LWW for authoritative quantities |
| Store configuration | Versioned signed deployment; reject incompatible/stale writes |
| Draft safe fields | Deterministic version check; controlled merge only where safe |
| Device health | Latest observation may replace projection while retaining event history |
| UI preference | Safe last-write-wins allowed |

## 11.7 Reconnect UX

Show:

- Hub connection state
- WAN state
- Cloud sync state
- Pending event count
- Oldest pending event age
- File upload backlog
- Last successful sync
- Retry state
- Blocking conflict count
- Required operator action

Automatic recovery must not duplicate operations.

---

# Part 12 — Files, Images and Documents

## 12.1 File authority

- DigitalOcean Spaces stores long-term bytes.
- Supabase stores authoritative metadata, ownership and permissions.
- Store Hub stores the complete local operational repository needed for offline store work.
- POS stores temporary display/capture cache only.

## 12.2 Phase 1 file classes

- Garment photo
- Stain photo
- Damage photo
- Pickup/handover evidence where approved
- Receipt PDF or generated document
- Laundry tag asset/template
- Device diagnostic log
- Support attachment
- Print template assets

## 12.3 Offline file flow

1. POS captures or receives file.
2. POS sends it to Hub.
3. Hub assigns local asset ID and checksum.
4. Business operation references the local asset.
5. Hub queues cloud upload.
6. When WAN returns, Hub obtains signed upload authority.
7. Hub uploads and confirms.
8. Cloud metadata becomes active.
9. Audit retains original actor/device and sync timestamps.

## 12.4 Security

- No DigitalOcean Spaces secret in POS.
- Signed URLs are short-lived and scope-limited.
- Local files are access-controlled by Hub.
- Diagnostics are redacted.
- Retention and deletion require approved policy.
- Sensitive evidence access is audited.

---

# Part 13 — Target Data Model Delta

The following is a target product contract, not proof of applied schema. Exact names must be reconciled with live migrations.

## 13.1 Required profile and device records

| Target entity | Purpose |
|---|---|
| `terminal_profiles` | Canonical profile definitions: T1, T2, T3, T4 |
| `device_profile_assignments` | Signed, versioned assignment of profiles to device/Location |
| `terminal_sessions` | Actor/profile/device sessions |
| `display_sessions` | T1–T2 customer-safe mirrored sessions |
| `device_certificates` | Device trust and revocation |
| `device_heartbeats` | Health, version and peripheral state |

## 13.2 Required Laundry operational records

| Target entity | Purpose |
|---|---|
| `laundry_bookings` / compatible transaction table | Booking header and lifecycle |
| `booking_lines` | Service/add-on/price snapshots |
| `garments` / `booking_units` | Garment, bag and package identity |
| `garment_condition_events` | Intake condition and evidence |
| `garment_scan_events` | Append-only custody events |
| `ready_storage_positions` | Rack/shelf/bin/conveyor positions |
| `storage_assignments` | Assignment/current projection with event linkage |
| `garment_exceptions` | Missing, damaged, rewash and other exceptions |
| `pickup_sessions` | T4 collector/retrieval process |
| `pickup_release_events` | Final custody release |

## 13.3 Required payment and print records

| Target entity | Purpose |
|---|---|
| `tenders` / payment ledger | Deposit and payment legs |
| `payment_attempts` | Provider/KHQR attempts and reconciliation state |
| `refunds` / compensating documents | Refund/void records |
| `pos_shifts` | Shift lifecycle |
| `cash_movements` | Append-only cash ledger |
| `print_jobs` | Durable local print queue and result |
| `document_sequences` | Approved collision-safe receipt/tag numbering |

## 13.4 Required audit fields

Every sensitive event must include, directly or through immutable linkage:

- Tenant ID
- Digital Store ID
- Location ID
- Hub ID
- Device ID
- Terminal profile
- Actor ID
- Approver ID when applicable
- Entity type and ID
- Event type
- Reason code
- Occurred-at and recorded-at timestamps
- Idempotency key
- Source software/configuration version
- Before/after snapshot or delta where appropriate
- Correlation/causation IDs

## 13.5 Terminal profile enum

**SPECIFIED IN v4 target:**

```text
t1_intake_cashier
t2_customer_display
t3_ready_scan_in
t4_pickup_scan_out
```

The old `t2_scan_in` and `t3_scan_out` names must be treated as legacy/superseded mappings, never reused for new v4 assignments.

---

# Part 14 — Edge Operations API Contracts

These routes are target contracts. Final OpenAPI schemas must be generated and contract-tested.

## 14.1 Shared request rules

Every mutation requires:

- Mutual device/Hub trust
- Active device assignment
- Actor session where staff action exists
- Tenant/Digital Store/Location scope
- Profile permission
- Idempotency key
- Compatible client/config version
- Audit context

## 14.2 Target local routes

### Session and profile

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/sessions/login` | Staff local login |
| POST | `/edge/v1/sessions/switch` | Staff switch |
| POST | `/edge/v1/approvals/request` | Request scoped approval |
| POST | `/edge/v1/approvals/confirm` | Manager approval |
| GET | `/edge/v1/device/assignment` | Device and profile assignment |
| GET | `/edge/v1/health` | Hub and dependency health |

### T1

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/laundry/bookings/drafts` | Create intake draft |
| PATCH | `/edge/v1/laundry/bookings/drafts/{id}` | Update safe draft fields with version check |
| POST | `/edge/v1/laundry/bookings/{id}/finalize` | Persist Booking and immutable snapshots |
| POST | `/edge/v1/laundry/bookings/{id}/payments` | Add tender/payment attempt |
| POST | `/edge/v1/laundry/bookings/{id}/discounts` | Apply/request discount |
| POST | `/edge/v1/laundry/bookings/{id}/print-jobs` | Queue receipt/tag print |
| POST | `/edge/v1/laundry/bookings/{id}/refund-requests` | Request refund/void |
| GET | `/edge/v1/customers/search` | Authorized customer lookup |
| POST | `/edge/v1/customers` | Create customer |
| POST | `/edge/v1/hardware/scale/read` | Obtain validated scale reading |

### T2

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/displays/sessions` | Bind T1 to assigned T2 |
| PATCH | `/edge/v1/displays/sessions/{id}` | Advance customer-safe state |
| POST | `/edge/v1/displays/sessions/{id}/receipt-choice` | Record receipt choice/consent |
| DELETE | `/edge/v1/displays/sessions/{id}` | End and privacy-reset session |
| GET/WS | `/edge/v1/displays/sessions/{id}/stream` | Authenticated LAN state stream |

### T3

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/laundry/ready-sessions` | Start Ready Scan-In |
| POST | `/edge/v1/laundry/ready-sessions/{id}/scans` | Record garment/package scan |
| POST | `/edge/v1/laundry/ready-sessions/{id}/qa` | Record QA/count/packaging result |
| POST | `/edge/v1/laundry/ready-sessions/{id}/storage` | Assign storage position |
| POST | `/edge/v1/laundry/ready-sessions/{id}/exceptions` | Create exception |
| POST | `/edge/v1/laundry/ready-sessions/{id}/complete` | Evaluate and post Ready transition |

### T4

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/laundry/pickup-sessions` | Start pickup lookup/session |
| POST | `/edge/v1/laundry/pickup-sessions/{id}/collector-verification` | Record verification |
| POST | `/edge/v1/laundry/pickup-sessions/{id}/scans` | Record retrieval scan |
| POST | `/edge/v1/laundry/pickup-sessions/{id}/payments` | Capture allowed remaining payment |
| POST | `/edge/v1/laundry/pickup-sessions/{id}/exceptions` | Record pickup exception |
| POST | `/edge/v1/laundry/pickup-sessions/{id}/release` | Post final custody release and completion |

### Shift, devices and support

| Method | Route | Purpose |
|---|---|---|
| POST | `/edge/v1/shifts/open` | Open shift |
| POST | `/edge/v1/shifts/{id}/cash-movements` | Append cash movement |
| POST | `/edge/v1/shifts/{id}/close` | Close/reconcile shift |
| GET | `/edge/v1/peripherals` | Peripheral status |
| POST | `/edge/v1/peripherals/{id}/test` | Guided test |
| GET | `/edge/v1/sync/status` | Outbox/file/conflict status |
| POST | `/edge/v1/support/diagnostic-bundles` | Create consented redacted bundle |

## 14.3 Error model

Errors must include:

- Stable error code
- Human-readable Khmer/English message key
- Retryability
- Blocking/non-blocking severity
- Correlation ID
- Field details where safe
- Required operator action

Examples:

```text
DEVICE_NOT_ASSIGNED
PROFILE_NOT_ALLOWED
ACTOR_PERMISSION_DENIED
HUB_UNREACHABLE
CONFIG_VERSION_INCOMPATIBLE
BOOKING_VERSION_CONFLICT
DUPLICATE_IDEMPOTENCY_KEY
PAYMENT_PENDING
PAYMENT_PROVIDER_UNAVAILABLE
PRINT_FAILED
SCALE_UNSTABLE
GARMENT_COUNT_MISMATCH
STORAGE_POSITION_OCCUPIED
COLLECTOR_VERIFICATION_REQUIRED
BALANCE_PAYMENT_REQUIRED
PICKUP_RELEASE_BLOCKED
```

---

# Part 15 — Domain Events and Audit

## 15.1 Event rules

- Versioned
- Tenant/Digital Store/Location scoped
- Idempotent
- Auditable
- Retry-safe
- Correlation and causation linked
- Append-only for payment, finance, inventory and custody truth

## 15.2 Minimum POS event catalog

```text
pos.session_started.v1
pos.session_switched.v1
pos.profile_entered.v1
pos.profile_exited.v1
pos.approval_requested.v1
pos.approval_granted.v1
pos.approval_rejected.v1
laundry.booking_draft_created.v1
laundry.booking_created.v1
laundry.booking_line_added.v1
laundry.condition_recorded.v1
payment.deposit_recorded.v1
payment.khqr_requested.v1
payment.khqr_confirmed.v1
payment.khqr_failed.v1
payment.cash_recorded.v1
print.job_queued.v1
print.job_completed.v1
print.job_failed.v1
print.job_reprinted.v1
display.session_bound.v1
display.session_reset.v1
laundry.ready_scan_recorded.v1
laundry.qa_completed.v1
laundry.storage_assigned.v1
laundry.booking_ready.v1
laundry.pickup_session_started.v1
laundry.collector_verified.v1
laundry.pickup_scan_recorded.v1
laundry.custody_released.v1
laundry.booking_completed.v1
laundry.exception_opened.v1
laundry.exception_resolved.v1
shift.opened.v1
cash.movement_recorded.v1
shift.closed.v1
device.peripheral_tested.v1
device.update_installed.v1
device.update_rolled_back.v1
```

## 15.3 Audit retention

Audit, payment, custody and release records must not be edited or deleted through normal product workflows. Retention and legal deletion policy are `[REQUIRED: approved policy]`.

---

# Part 16 — Security, Privacy and RBAC

## 16.1 Trust boundaries

```text
Cloud identity/configuration boundary
↕ signed sync and certificates
Store Hub authority boundary
↕ authenticated LAN contracts
POS device boundary
↕ actor sessions and profile permissions
Customer display privacy boundary
```

## 16.2 Required controls

- Device certificate and private-key protection
- Certificate rotation and revocation
- Tenant/Digital Store/Location isolation
- Device/profile assignment enforcement
- Local staff PIN throttling and lockout policy
- Role/capability checks at Hub, not UI only
- One-shot manager approvals
- Sensitive-action reason codes
- Session lock and auto-lock
- T2 privacy reset
- Redacted logs
- Encrypted sensitive local storage
- Signed configuration and release verification
- No cloud/service secrets in Electron renderer
- Electron context isolation, sandboxing and restricted IPC
- Allowlisted local origins and CSP
- Dependency/SBOM and signature checks

## 16.3 Permission matrix

| Capability | Cashier | Ready staff | Pickup staff | Supervisor | Manager |
|---|---:|---:|---:|---:|---:|
| Enter T1 | Assigned | No | No | Assigned | Assigned |
| Enter T2 staff controls | T1-bound only | No | No | Assigned support | Assigned support |
| Enter T3 | No | Assigned | No | Assigned | Assigned |
| Enter T4 | No unless assigned | No | Assigned | Assigned | Assigned |
| Create Booking | Yes | No | No | Yes | Yes |
| Apply unrestricted discount | No | No | No | Policy | Policy |
| Approve discount | No | No | No | Policy | Yes |
| Record Ready custody | No | Yes | No | Yes | Yes |
| Release pickup | No | No | Yes | Yes | Yes |
| Override pickup exception | No | No | No | Policy | Yes |
| Refund/void approval | No | No | No | Policy | Yes |
| Reprint | Policy | Policy | Policy | Yes | Yes |
| Hardware diagnostics | Basic | Basic | Basic | Assigned | Assigned |
| Change terminal assignment | No | No | No | No | Portal/Admin authority only |

Exact role names and capability keys must match the canonical RBAC registry.

## 16.4 T2 privacy checklist

- No prior customer data after reset
- No internal notes
- No staff-only reason codes
- No full customer history
- No provider secret or raw transaction payload
- Masked contact data
- QR expires/clears correctly
- Payment state from authoritative Hub/provider projection
- Privacy-safe idle state

---

# Part 17 — Design System, Localization and Accessibility

## 17.1 Visual requirements

- High-contrast status labels
- Large touch targets
- Scanner-first focus treatment
- Clear numeric hierarchy for weight, total, deposit and balance
- Color is never the only state signal
- Offline and provider-pending states are visually distinct
- Critical confirmation requires deliberate action
- Customer-facing T2 uses simplified language and larger typography
- T3/T4 use scan-progress and exception-first layouts

## 17.2 Localization

- Khmer and English strings are first-class resources.
- Do not hardcode strings in workflow logic.
- User-facing term is **Booking / Laundry Booking**.
- User-facing production status is **Pressing**, even if backend compatibility uses `ironing`.
- KHR formatting is native.
- USD appears only when store policy and authoritative payment contract allow it.
- Dates/times render in `Asia/Phnom_Penh`.
- Cambodian phone normalization is supported.
- Printed receipts/tags use approved Khmer-capable fonts and printer-compatible templates.

## 17.3 Accessibility

- Keyboard navigation for non-touch terminals
- Visible focus states
- Screen-reader labels where practical in Electron UI
- Minimum contrast and text scaling targets defined in design tokens
- Do not rely only on sound for scan confirmation/error
- Error messages include corrective action
- T2 interaction must be understandable without staff-only terminology

---

# Part 18 — Hardware Integration and Diagnostics

## 18.1 Adapter boundary

Device drivers and protocols belong behind Store Hub hardware adapters. POS consumes stable capability contracts rather than raw serial/USB implementation details.

## 18.2 Guided setup

For each peripheral:

1. Detect devices.
2. Show friendly model and connection method.
3. Select signed/certified profile.
4. Run test action.
5. Show result and corrective steps.
6. Save versioned assignment.
7. Record health and test event.

## 18.3 Printer diagnostics

- Connection state
- Paper/cover status if available
- Template compatibility
- Test receipt/tag
- Queue depth
- Last successful print
- Last error
- Fallback printer if configured
- Duplicate-suppression verification

## 18.4 Scale diagnostics

- Connected state
- Unit
- Zero/tare
- Stable reading
- Reading latency
- Test capture
- Manual fallback permission
- Certified profile/version

## 18.5 Scanner diagnostics

- Keyboard-wedge/HID mode
- Sample scan
- Prefix/suffix behavior
- Duplicate scan handling
- Tag/QR compatibility
- Focus capture behavior

## 18.6 Device health

Terminal heartbeat should include:

- Software version and release channel
- Assigned profiles
- Certificate status
- Hub reachability
- CPU/memory/storage
- Temperature where available
- Peripheral summary
- Last successful operation
- Update/rollback state
- Clock/time sync state

---

# Part 19 — Release, Update and Rollback

## 19.1 Release model

```text
Internal → Pilot → Stable
```

## 19.2 Package requirements

- Electron Linux ARM64 package
- Cryptographic signature
- Checksum
- SBOM
- Release notes
- Minimum/maximum Hub compatibility
- Configuration/schema compatibility range
- Terminal profile compatibility
- Migration impact declaration
- Rollback declaration

## 19.3 Store Hub distribution

1. Hub receives assigned release metadata.
2. Hub downloads package once.
3. Hub verifies signature/checksum.
4. Hub stages package locally.
5. Hub distributes to assigned terminals over LAN.
6. Terminal installs to inactive A/B slot.
7. Health checks run.
8. Terminal promotes or rolls back.
9. Hub reports status when cloud is available.

## 19.4 Rollback requirements

- Automatic rollback on failed boot/health threshold
- Manual authorized rollback
- No rollback that would corrupt newer local data contracts
- Compatibility gate before install
- Failed release quarantined
- Exact previous/target version recorded
- Business operation preserved where safe

## 19.5 Update UX

POS shows:

- Current version
- Assigned channel
- Update availability
- Required/optional state
- Download/staged/install state
- Planned restart
- Compatibility warnings
- Success/failure/rollback result

Staff cannot install an unassigned package.

---

# Part 20 — Monitoring, Observability and Support

## 20.1 Required metrics

- Terminal online/offline and heartbeat age
- Hub reachability
- WAN and cloud-sync status
- Booking creation latency and failure rate
- Payment attempt state/failure
- KHQR pending age
- Print queue depth/failures
- Scan latency and duplicate rate
- Ready exceptions
- Pickup exceptions
- File upload backlog
- Outbox depth/oldest age
- Storage conflicts
- App crash/restart count
- Update success/rollback rate
- Peripheral health

## 20.2 Required logs

- Structured JSON logs
- Correlation IDs
- Device/profile/actor context where allowed
- Redaction of PII, PINs, QR payloads, secrets and provider credentials
- Local rotation and storage caps
- Consent-based diagnostic export

## 20.3 Alerts

Minimum alert categories:

- Hub unreachable from terminal
- Terminal heartbeat stale
- High print failure rate
- Payment provider degraded
- KHQR pending beyond policy threshold
- Sync backlog excessive
- File repository low space
- Repeated certificate/auth failures
- Storage-position conflict spike
- Pickup/Ready exception spike
- Update rollback

Exact thresholds are `[REQUIRED: environment and support policy]`.

## 20.4 Support consent

Remote diagnostics or support actions require:

- Authorized support role
- Store consent where required
- Time-bound access
- Audit
- Redacted data by default
- No permanent unrestricted impersonation

---

# Part 21 — QA and Acceptance Matrix

## 21.1 Gate model

| Gate | Required evidence |
|---|---|
| G0 — Authority | Owner locks, conflicts, phase scope, rejected patterns and required decisions are recorded |
| G1 — Contract | Schema delta, Edge API, events, RBAC, offline behavior, files, hardware and documentation approved |
| G2 — Build | Code, migrations, seeds, UI, adapters and automated tests complete in development |
| G3 — Integrated verification | T1–T4, Hub, payments, print, files, security, recovery and duplicate tests pass |
| G4 — Pilot readiness | Monitoring, support, training, rollback, hardware matrix and go-live checklist ready |
| G5 — Phase exit / Rebuild Test | Pilot evidence approved and one engineer can reconstruct/operate the product |

## 21.2 Minimum QA scenarios

| ID | Scenario | Required result |
|---|---|---|
| POS4-QA-001 | Provision terminal from code | Correct device/Hub/Store/profile assignment; no manual DB action |
| POS4-QA-002 | Attempt profile not assigned to device | Denied and audited |
| POS4-QA-003 | Attempt profile without actor permission | Denied and audited |
| POS4-QA-004 | T1 cash Booking online | Booking, payment, receipt/tag and sync succeed |
| POS4-QA-005 | T1 cash Booking during WAN outage | Local completion and printing succeed; cloud delayed visibly |
| POS4-QA-006 | Duplicate T1 finalize request | One Booking only; original result replayed |
| POS4-QA-007 | Scale stable capture | Correct reading and metadata persisted |
| POS4-QA-008 | Scale unavailable manual fallback | Permission/reason/audit enforced |
| POS4-QA-009 | KHQR pending then confirmed | T1/T2 show authoritative transitions; no early success |
| POS4-QA-010 | KHQR provider unavailable | Cash remains available; QR state not fabricated |
| POS4-QA-011 | T2 normal lifecycle | Correct mirror, payment, receipt and reset states |
| POS4-QA-012 | T2 previous-customer leakage test | No prior PII/Booking/QR remains |
| POS4-QA-013 | T2 disconnect/reconnect | Only current authorized session restored |
| POS4-QA-014 | T3 complete Ready Scan-In | Count, QA, storage and Ready event persisted |
| POS4-QA-015 | T3 missing garment | Completion blocked; exception created |
| POS4-QA-016 | T3 storage position occupied | Assignment blocked transactionally |
| POS4-QA-017 | T3 duplicate scan | No duplicate custody event |
| POS4-QA-018 | T4 correct pickup | Collector, scans, balance and release complete |
| POS4-QA-019 | T4 wrong Booking garment | Blocked and audited |
| POS4-QA-020 | T4 unpaid balance | Release blocked or approved handoff policy enforced |
| POS4-QA-021 | T4 pending KHQR | Release blocked until confirmation or approved policy |
| POS4-QA-022 | T4 exceptional partial release | Default blocked; approval/policy required if enabled |
| POS4-QA-023 | T3/T4 share hardware | State clears and permission/audit remain separate |
| POS4-QA-024 | Actor switch | Prior approval and customer state cleared |
| POS4-QA-025 | One-shot manager approval | Cannot be reused or applied to changed parameters |
| POS4-QA-026 | Printer failure and retry | One intended copy; queue/recovery visible |
| POS4-QA-027 | Reprint | Reason, actor and reprint marker recorded |
| POS4-QA-028 | File capture offline | Local asset usable and later uploads once |
| POS4-QA-029 | Hub restart during operation | Durable state recovers without duplicate mutation |
| POS4-QA-030 | Terminal restart | Active/recoverable state follows contract |
| POS4-QA-031 | WAN reconnect burst | Oldest-first controlled sync; no duplicates |
| POS4-QA-032 | Certificate revoked | Terminal loses operational trust and shows recovery |
| POS4-QA-033 | Cross-Tenant/Store request | Denied at Hub/cloud boundary |
| POS4-QA-034 | Signed update success | A/B health check passes and version reports |
| POS4-QA-035 | Bad update | Automatic rollback and audit |
| POS4-QA-036 | Low Hub storage | Alert and safe operational behavior |
| POS4-QA-037 | Shift open/close offline | Local ledger and later sync reconcile |
| POS4-QA-038 | Cash variance threshold | Reason/approval policy enforced |
| POS4-QA-039 | Refund/void | Compensating record; original history unchanged |
| POS4-QA-040 | Full smoke lifecycle | T1 → T2 → production → T3 → T4 → cloud/report trace passes |

## 21.3 Performance acceptance

Exact thresholds require environment and hardware benchmark approval. At minimum, test and publish:

- Boot to operational readiness
- Staff PIN validation
- Service search latency
- Scan-to-result latency
- Scale-read latency
- Booking local commit latency
- T1-to-T2 mirror latency
- T3/T4 scan latency
- Print queue dispatch latency
- Reconnect recovery time
- Outbox replay throughput
- Memory/CPU/temperature under a full business day

Never claim a target without measured pilot evidence.

## 21.4 Security acceptance

- Electron security checklist passes
- No secrets in renderer/package/logs
- Certificate revocation test passes
- Cross-scope negative tests pass
- PIN brute-force controls pass
- Approval replay test passes
- T2 privacy tests pass
- Tampered package/config is rejected
- Diagnostic export redaction test passes

---

# Part 22 — Pilot, Go-Live and Recovery

## 22.1 Pilot readiness checklist

- Approved v4 schema/API/event/RBAC contracts
- Applied development/staging migrations with validators
- T1–T4 UI complete
- Certified reference hardware and peripheral matrix
- Offline/WAN-loss matrix passed
- Cash/KHQR test evidence
- Print/tag templates approved
- T2 privacy test passed
- T3/T4 custody test passed
- Backup/restore drill passed
- Signed release and rollback passed
- Monitoring and alerts active
- Operator training complete
- Support runbooks complete
- Required owner decisions closed or features disabled

## 22.2 Go-live smoke test

1. Create/verify Digital Store and Laundry Location.
2. Verify active Store Hub and healthy local database.
3. Verify terminal certificates and assignments.
4. Open shift.
5. Create customer and Booking at T1.
6. Capture weight/pieces, service, condition and due date.
7. Mirror to T2.
8. Record deposit/payment.
9. Print receipt and tags.
10. Simulate production completion.
11. T3 verify, assign storage and mark Ready.
12. Verify notification queued/delivered truth.
13. Locate Booking at T4.
14. Verify collector, scan garments and settle balance.
15. Complete custody release.
16. Verify storage cleared and Booking completed.
17. Verify cloud sync and Partner/Admin read models with freshness.
18. Close shift and reconcile.
19. Export diagnostic and audit evidence.

## 22.3 Recovery runbooks required

- Hub unreachable
- WAN outage
- Terminal replacement
- Certificate revoke/reprovision
- Printer failure
- Scale failure
- T2 display failure
- Tag unreadable
- Missing garment at T3
- Missing garment at T4
- Payment pending/provider outage
- Sync backlog/dead-letter
- Low disk/storage
- Failed update/rollback
- Restore from Hub backup

---

# Part 23 — Feature Inventory and Traceability

## 23.1 v4 feature IDs

| Feature ID | Capability | Priority | Source authority |
|---|---|---:|---|
| KL-POSD4-001 | Shared Electron ARM64 POS shell | P0 | Project architecture + Suite baseline |
| KL-POSD4-002 | Store Hub-only normal write path | P0 | OWNER-LOCKED |
| KL-POSD4-003 | Device certificate and assigned-profile enforcement | P0 | OWNER-LOCKED provisioning |
| KL-POSD4-004 | T1 Intake/Cashier | P0 | KLMF-LND-014 OWNER-LOCKED |
| KL-POSD4-005 | T2 Customer Display Screen | P0 | KLMF-LND-016 OWNER-LOCKED |
| KL-POSD4-006 | T3 Clean & Ready Scan-In | P0 | KLMF-LND-017 OWNER-LOCKED |
| KL-POSD4-007 | T4 Customer Pickup Scan-Out | P0 | KLMF-LND-018 OWNER-LOCKED |
| KL-POSD4-008 | T1–T4 profile model | P0 | KLMF-LND-015 OWNER-LOCKED |
| KL-POSD4-009 | Fast counter service grid and persistent Booking panel | P1 | Loyverse adaptation |
| KL-POSD4-010 | Khmer/English search and customer/Booking lookup | P1 | Approved target |
| KL-POSD4-011 | Scale/scanner integration and audited manual fallback | P1 | Approved target |
| KL-POSD4-012 | Intake draft recovery and immutable finalization | P1 | Approved target |
| KL-POSD4-013 | Deposit, balance, cash and KHQR | P0 | Laundry scope / Cambodia-first |
| KL-POSD4-014 | Discount approval and audit | P0/P1 | Approved target |
| KL-POSD4-015 | Receipt and garment/bag tag printing | P0 | Phase 1 scope |
| KL-POSD4-016 | Refund/void compensating workflow | P1 | Finance guardrail |
| KL-POSD4-017 | T2 privacy/payment-state/reconnect lifecycle | P0 | Toast/Loyverse adaptation |
| KL-POSD4-018 | T3 QA/count/packaging/storage validation | P0 | OWNER-LOCKED detail |
| KL-POSD4-019 | T4 collector/balance/retrieval/release validation | P0 | OWNER-LOCKED detail |
| KL-POSD4-020 | Append-only custody event ledger | P0 | OWNER-LOCKED |
| KL-POSD4-021 | Fast staff switching with visible actor | P1 | KLMF-WRK-003 |
| KL-POSD4-022 | One-shot manager elevation | P1 | Approved target |
| KL-POSD4-023 | Shift open/close and cash movement | P1 | Approved Phase 1 target depth |
| KL-POSD4-024 | Offline local operation and reconnect UX | P0 | OWNER-LOCKED |
| KL-POSD4-025 | Local file/evidence queue | P0 | Approved target |
| KL-POSD4-026 | Guided peripheral diagnostics | P1 | Loyverse adaptation |
| KL-POSD4-027 | Signed Internal/Pilot/Stable releases | P0 | Approved architecture |
| KL-POSD4-028 | A/B install and rollback | P0 | Approved architecture |
| KL-POSD4-029 | Monitoring, diagnostics and support consent | P1 | Shared platform requirement |
| KL-POSD4-030 | Practice mode / first Booking walkthrough | P1 | Loyverse time-to-first-value adaptation |

## 23.2 Source backlog mapping

| Source IDs | v4 treatment |
|---|---|
| KLMF-LND-014..018 | Directly preserved as T1–T4 owner locks |
| KPD-WC-001..007 | Preserve POS, T1–T4, discount/audit and Electron client boundaries |
| KL-LV-009, 014, 025, 027..041, 044..048, 067..071, 096, 100, 111 | Adopt scoped Phase 1 UX/operation improvements; optional items remain flagged |
| KST-017..020 | Preserve T1–T4; adopt T2 display rigor |
| KST-040..041 | Reuse role gating and staff switching without importing Restaurant scope |
| KLS-SH-089..094 | Preserve Hub architecture; later retail features remain deferred |
| KLS-LS Phase 1 gate | Require T1–T4 operation, local files, payment/deposit truth, sync/replay, device health and recovery evidence |

---

# Part 24 — Deferred and Rejected Capability Register

## 24.1 Deferred by roadmap

| Capability | Earliest phase |
|---|---|
| Restaurant Quick Order and Table Service | Phase 2 |
| Restaurant guest display profile | Phase 2 |
| Restaurant KDS | Phase 2 |
| Online order/Orders Hub depth for Restaurant | Phase 2 |
| Hosted eCommerce Storefront POS integration | Phase 3 |
| Retail barcode-first checkout | Phase 4 |
| BOPIS / ship-to-customer | Phase 4 |
| Retail shifts/register reconciliation depth | Phase 4 |
| Pharmacy restricted workflows | Phase 5 |
| Exchanges and store credit | Phase 6 |
| Embedded-weight barcode grocery workflow | Phase 7 |
| Self-checkout and enterprise register HA | Phase 8 |

## 24.2 Rejected patterns

- T2 as a KDS or production display
- Device-only authority replacing Store Hub
- Direct POS database access to cloud production tables
- Direct connector database access
- Offline card capture
- Payment success inferred from QR display
- Generic last-write-wins for money, inventory or custody
- Deleting finalized financial/custody history
- Persistent hidden manager mode
- Installer-selected unauthorized terminal roles
- Unsigned updates
- Cloud-dependent printing as the only path
- Stale/cached/estimated data shown as authoritative without labels

---

# Part 25 — Required Owner and Deployment Decisions

The following gaps are not resolved by the supplied sources and must remain explicit:

1. `[REQUIRED: final receipt and tag numbering policy, including offline sequence and collision rules]`
2. `[REQUIRED: exact KHQR provider/acquirer contracts and degraded/offline behavior]`
3. `[REQUIRED: whether T4 may collect cash/KHQR by default or hands payment to T1]`
4. `[REQUIRED: partial Ready policy and partial pickup/release policy]`
5. `[REQUIRED: collector identity-verification and privacy policy]`
6. `[REQUIRED: cash blind-count and variance approval thresholds]`
7. `[REQUIRED: retry, dead-letter and operator escalation thresholds]`
8. `[REQUIRED: exact device certificate lifetime, rotation and recovery policy]`
9. `[REQUIRED: certified printer, scale, scanner and display models for Pilot]`
10. `[REQUIRED: print template dimensions, commands and Khmer font strategy per certified printer]`
11. `[REQUIRED: local Hub backup frequency, RPO/RTO and storage retention]`
12. `[REQUIRED: diagnostic log retention and support-consent policy]`
13. `[REQUIRED: minimum performance thresholds after hardware benchmarking]`
14. `[REQUIRED: whether optional time clock, mixed tender, e-receipt entry and named open-Booking templates enter v4.0.0 Pilot]`
15. `[REQUIRED: separate owner decision for any Laundry production-display product/profile]`

No unresolved item may be silently enabled in production.

---

# Part 26 — Documentation and Repository Deliverables

A complete Phase 1 delivery must include:

- This POS Desktop product specification
- POS feature inventory and traceability map
- Terminal/profile permission matrix
- UI route and component inventory
- Design tokens and bilingual string catalog
- Edge Operations OpenAPI contract
- Domain event registry
- Schema/data dictionary and additive migration plan
- Store Hub integration specification
- Payment/KHQR rules and reconciliation test vectors
- Print and document specification
- Device/provisioning specification
- Certified hardware matrix
- Offline/reconnect/conflict specification
- Security threat model and Electron hardening checklist
- Automated unit/component/contract/integration/E2E tests
- QA evidence package
- Monitoring/alert definitions
- Release signing and rollback runbook
- Support and recovery SOPs
- Pilot and go-live checklist
- Updated Suite Rebuild Bible and Business Bible

---

# Part 27 — Completion Definition

`kitluy-pos-desktop-app` Phase 1 Laundry v4.0.0 is complete only when:

1. Scope and outstanding owner decisions are approved.
2. T1–T4 contracts and permissions are implemented without legacy terminal-role leakage.
3. Store Hub remains the local authority and WAN-loss operation passes.
4. Booking, payment, print, file and custody ledgers reconcile.
5. T2 privacy and payment-state tests pass.
6. T3 Ready and T4 release controls pass all blocking/exception scenarios.
7. Device provisioning and certificate recovery work without manual database editing.
8. Signed release, A/B installation and rollback pass on reference hardware.
9. Security, isolation, duplicate and recovery tests pass.
10. Monitoring, support and backup/restore are operational.
11. Pilot evidence is approved.
12. One qualified engineer passes the Rebuild Test from current documentation and contracts.

A planning checklist, UI prototype or successful happy-path demo alone is not completion evidence.

---

# Appendix A — Canonical Screen Inventory

| Screen ID | Profile | Screen |
|---|---|---|
| POS-SH-001 | Shared | Boot validation |
| POS-SH-002 | Shared | Login/PIN |
| POS-SH-003 | Shared | Profile launcher |
| POS-SH-004 | Shared | Connectivity/sync center |
| POS-SH-005 | Shared | Peripheral center |
| POS-SH-006 | Shared | Update center |
| POS-SH-007 | Shared | Practice mode |
| POS-T1-001 | T1 | Intake workspace |
| POS-T1-002 | T1 | Customer search/create |
| POS-T1-003 | T1 | Garment/condition capture |
| POS-T1-004 | T1 | Price/discount review |
| POS-T1-005 | T1 | Payment/deposit |
| POS-T1-006 | T1 | Print status/reprint |
| POS-T1-007 | T1 | Active Booking lookup/detail |
| POS-T1-008 | T1 | Shift/cash |
| POS-T2-001 | T2 | Idle/privacy state |
| POS-T2-002 | T2 | Intake mirror |
| POS-T2-003 | T2 | Review/total |
| POS-T2-004 | T2 | KHQR/payment state |
| POS-T2-005 | T2 | Receipt choice |
| POS-T2-006 | T2 | Pickup reference/thank-you |
| POS-T3-001 | T3 | Ready queue/scan |
| POS-T3-002 | T3 | QA/count/packaging |
| POS-T3-003 | T3 | Storage assignment |
| POS-T3-004 | T3 | Exception handling |
| POS-T3-005 | T3 | Ready completion |
| POS-T4-001 | T4 | Pickup lookup |
| POS-T4-002 | T4 | Collector verification |
| POS-T4-003 | T4 | Retrieval scan checklist |
| POS-T4-004 | T4 | Balance/payment gate |
| POS-T4-005 | T4 | Exception/approval |
| POS-T4-006 | T4 | Release confirmation |

---

# Appendix B — Reconciliation Register

| ID | Legacy/source statement | v4 resolution |
|---|---|---|
| POS-RC-001 | T2 Scan In | Replaced by T2 Customer Display Screen |
| POS-RC-002 | T3 Scan Out | Replaced by T3 Ready Scan-In and new T4 Pickup Scan-Out |
| POS-RC-003 | T1 performs final handover after shared retrieval terminal | T4 is the only canonical profile that completes pickup; T1 payment handoff may be used by policy |
| POS-RC-004 | Shared conveyor terminal has T2/T3 modes | Shared Ready/Pickup hardware may have T3/T4 modes |
| POS-RC-005 | Three terminal roles in Suite v3 | Four role profiles are authoritative |
| POS-RC-006 | T2 production/display ambiguity | T2 is CDS only; production display remains separate decision |
| POS-RC-007 | Cloud/mobile terminology varies between Order and Booking | POS UI uses Booking; backend adapters may retain order naming |
| POS-RC-008 | `ironing` backend/user label | User-facing POS label is Pressing |
| POS-RC-009 | Shift/register depth differs by source | Phase 1 includes Laundry cash controls; full Retail register depth remains Phase 4 |
| POS-RC-010 | POS terminal-side outbox suggested | Optional only after pilot; Hub remains authority and terminal cannot become truth silo |

---

# Appendix C — Version History

| Version | Date | Change summary | Status |
|---|---|---|---|
| Suite POS direction v3.0.0 | 2026-07-10 | Three logical Laundry roles and shared conveyor model | Superseded for terminal roles; retained as shared architecture input |
| POS Desktop v4.0.0 | 2026-07-25 | Consolidates current owner locks, T1–T4, Digital Store/Hub-first provisioning, source-driven UX improvements, offline, hardware, security, release, QA and phase gates | Canonical target specification draft |

---

# Appendix D — Source Traceability Notes

This specification intentionally preserves KitLuy’s stronger architecture and uses competitor-derived material only as secondary design evidence:

- **WooCommerce:** contributes governed commerce/event/API/price/approval concepts; does not define the physical POS or Hub.
- **Loyverse:** contributes approachable POS ergonomics, display phases, staff switching, shift interaction, pairing and hardware-test UX.
- **Toast:** contributes display privacy/payment-state rigor, scoped approvals, print reliability and later Restaurant workflow decomposition.
- **Shopify:** confirms later Retail omnichannel/register opportunities but does not redefine Phase 1 Laundry.
- **Lightspeed:** contributes hardware/offline/phase-exit rigor and later Retail/Restaurant workflow depth.

No competitor clone schema, endpoint name, threshold, topology or algorithm is represented as observed competitor internals unless separately evidenced. KitLuy source-of-truth, Store Hub authority, T1–T4 owner locks and eight-phase roadmap remain controlling.
