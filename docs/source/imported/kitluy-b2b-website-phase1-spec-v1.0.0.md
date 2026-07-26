# KitLuy B2B Website — Phase 1 Product, UX, Architecture and Rebuild Specification

**Filename:** `kitluy-b2b-website-phase1-spec-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-25  
**Product:** `kitluy-b2b-website`  
**Public brand:** KitLuy Suite / KitLuy for Business  
**Primary market:** Cambodia  
**Primary Phase 1 vertical:** Laundry  
**Owner:** HET / KitLuy Suite project owner  
**Audience:** Product owner, marketing, sales, UI/UX, frontend, backend, QA, DevOps, security, support, content editors, and AI handoff agents  
**Status:** Canonical target-state Phase 1 specification; not implementation evidence  
**Product type:** Public B2B marketing, product-discovery, lead-generation, registration, authentication and portal-entry website  
**Access:** Public internet, with authenticated account-entry routes  
**Core slogan:** **Create digitally. Operate physically. Sell everywhere.**

> **Mission:** A prospective Cambodian business must be able to understand KitLuy Suite, discover the products and capabilities relevant to its operation, trust the platform, request a demo or register, authenticate securely, and enter the correct Partner or Chain experience without confusing the public marketing website with an operational portal.

> **Rebuild Test:** If the original team disappeared, one qualified engineer and one qualified product/content operator must be able to reconstruct, publish, secure, operate, measure and update the Phase 1 website from this specification, the referenced sources, approved content, environment values and repository evidence.

---

## Source Baseline and Authority

This specification consolidates the current KitLuy source set and owner direction available on 2026-07-25.

### Governing sources

1. Current KitLuy Suite Project Instruction — vertical roadmap, Digital Store model, shared Core, offline Store Hub, technology, authority and evidence rules.
2. `KitLuy Suite Products.txt` — canonical definition, responsibilities, routing, route suggestions and product boundaries for `kitluy-b2b-website`.
3. `kitluy-suite-ecosystem-business-bible-v1.0.0.md` — business positioning, messaging, market, pricing unknowns, GTM, CRM, content and evidence rules.
4. `kitluy-suite-rebuild-bible-v3.0.0.md` — suite architecture, product boundaries, infrastructure, security, localization and shared contracts, except where superseded by later owner decisions.
5. `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md` — CRM, onboarding, lead conversion, support, platform roles and Admin boundaries.
6. `kitluy-partner-pwa-portal-rebuild-bible-v1.1.0.md` — one-Digital-Store back-office boundary and Partner authentication expectations.
7. `kitluy-chain-portal-rebuild-bible-v2.0.0.md` — multi-Store, chain and franchise boundary and membership routing.
8. `kitluy-partner-app-rebuild-bible-v1.1.0.md` — mobile owner/manager boundary and truth/freshness discipline.
9. `Device Management & Provisioning System.txt` — Digital Store first, active Hub second, terminals third.
10. `kitluy-concept-design-1.txt` — owner-locked Laundry T1–T4 model.
11. Evidence-based competitor analyses and classifications — design references only; they do not override KitLuy authority.
12. `kitluy-master-feature-registry-v0.2.md` and owner decision lock — canonical capability normalization and status discipline.

### Authority order

```text
current owner decision and Project Instruction
  -> verified repository, applied migrations, tests, deployments and production evidence
  -> this Phase 1 specification
  -> current Suite, Business and product bibles
  -> approved handoffs
  -> evidence-based competitor analyses
  -> competitor clone/rebuild documents as design references only
  -> superseded planning
```

### Evidence rule

- This file defines a **target product**. It does not prove that code, migrations, tests, domains, content, pricing or production deployment exist.
- Public claims must never be promoted to **Available**, **Live**, **Trusted by**, **Used by**, or equivalent language without approved evidence.
- Demo, sample, estimated, cached, planned, pilot or incomplete data must be labeled accurately.
- Exact prices, trial duration, legal text, customer logos, case-study results, SLA values and production domains remain `[REQUIRED]` until approved.

---

# Part 0 — Rebuild Sequence

Execute in this order.

1. **Confirm authority and release scope**
   - Approve this specification.
   - Confirm public brand name, legal entity, domains and supported languages.
   - Confirm which Suite products and capabilities may be publicly marketed at launch.
   - Create the public capability-availability register.

2. **Create the application boundary**
   - Create `apps/kitluy-b2b-website` in the KitLuy monorepo.
   - Connect shared design system, identity, localization, analytics and API packages.
   - Prevent imports from Partner, Chain, Admin or POS private feature modules.

3. **Configure infrastructure**
   - DigitalOcean hosts the public React web application in Singapore/SGP1.
   - Supabase provides Auth, PostgreSQL, RLS and Edge Functions.
   - DigitalOcean Spaces stores approved public media and downloadable assets.
   - Configure dev, staging and production domains and redirect allowlists.

4. **Implement structured public content**
   - Add Khmer and English content manifests.
   - Add product, feature, solution, industry, security, pricing and resource page content.
   - Add evidence/status metadata to every capability claim.
   - Add media alt text, ownership and publication approval metadata.

5. **Implement public navigation and page system**
   - Home, Products, Features, Solutions, Industries, Hardware, Pricing, Security, Resources, About and Contact.
   - Phase 1 Laundry landing page.
   - Product pages for marketable customer-facing KitLuy products.

6. **Implement lead capture**
   - Request demo, contact sales, hardware consultation, Chain inquiry and future-vertical interest forms.
   - Post through a versioned Edge Function into Admin CRM.
   - Preserve source/campaign attribution and consent.

7. **Implement authentication entry**
   - Phone-first registration and login.
   - Google sign-in as an alternate identity method where enabled.
   - Mandatory verified phone for a new business account.
   - Account recovery, invitation acceptance and session handling.

8. **Implement business registration and portal routing**
   - Collect the minimum business profile and operating structure.
   - Create or resume onboarding intent.
   - Resolve active memberships server-side.
   - Route to Partner Portal, Chain Portal, context selector or safe support state.

9. **Implement SEO, analytics and accessibility**
   - Server-rendered metadata, sitemap, hreflang, structured data and canonical URLs.
   - Privacy-controlled analytics without PII.
   - WCAG 2.2 AA target.

10. **Run quality gates**
    - Content claim audit.
    - Security and tenant-routing tests.
    - Responsive, Khmer, accessibility, performance, SEO and browser QA.
    - CRM lead-delivery and notification tests.
    - Production redirect and portal-handoff tests.

11. **Launch through staged promotion**
    - Internal -> Pilot -> Stable.
    - Signed immutable build artifact.
    - Health checks, synthetic registration tests and rollback.
    - Publish only approved capabilities, prices and proof.

---

# Part 1 — Product Definition

## 1.1 One-line definition

`kitluy-b2b-website` is the public business-facing website where a prospective or existing business customer can learn about KitLuy Suite, browse products and features, understand the active Laundry solution, request sales assistance, register, log in and enter the correct KitLuy management portal.

## 1.2 Primary product outcome

The site converts an anonymous visitor into one of four valid outcomes:

1. An informed prospect who understands KitLuy and continues exploring.
2. A qualified lead in the Admin CRM.
3. A verified new business identity ready to continue onboarding.
4. An authenticated user routed to an authorized Partner or Chain context.

## 1.3 Public front-door model

```text
Search / Social / Referral / Sales Campaign / Direct Visit
                         |
                         v
                kitluy-b2b-website
                         |
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
Discover products   Request a demo     Register / Log in
       |                 |                  |
       v                 v                  v
Understand Laundry  Admin CRM lead     Shared KitLuy Identity
       |                 |                  |
       +-----------------+------------------+
                         |
                         v
          Partner or Chain onboarding/portal
```

## 1.4 Marketing-first rule

The website is primarily a **marketing, education and conversion surface**. Registration and login are important entry functions, but they must not turn the website into a second Partner Portal.

## 1.5 Product boundaries

### The B2B website owns

- Public brand and product marketing.
- Product, feature, solution and industry discovery.
- Laundry Phase 1 solution education.
- Public hardware, offline, KHQR and security explanations.
- Public pricing presentation when approved.
- Lead capture and campaign attribution.
- Registration and login entry experiences.
- Invitation acceptance and account recovery entry.
- Server-side membership/context resolution.
- Safe redirect to Partner or Chain Portal.
- Public resources, guides, FAQs and support/contact entry.
- SEO, public analytics and conversion measurement.

### The B2B website does not own

- Digital Store operational configuration.
- Service catalog or pricing administration.
- Laundry Booking intake or production operations.
- Customer commerce or customer checkout.
- Store finance, payment capture or reconciliation.
- Inventory authority.
- Store Hub provisioning or device management.
- POS operation.
- Chain governance.
- HET internal administration.
- Production release claims without evidence.

## 1.6 Separation from other KitLuy surfaces

| Surface | Audience | Purpose | B2B website relationship |
|---|---|---|---|
| `kitluy-b2b-website` | Businesses evaluating or accessing KitLuy | Learn, compare, contact, register, log in and route | Public front door |
| `kitluy-partner-pwa-portal` | Independent Store owner/manager | Configure and operate one Digital Store | Primary single-Store handoff |
| `kitluy-chain-pwa-portal` | Chain, brand or franchise owner | Govern multiple Stores | Multi-Store handoff |
| `kitluy-admin-pwa-portal` | HET internal operators | CRM, onboarding, support, billing, fleet, platform control | Never exposed through customer routing |
| KitLuy Storefront | A Partner's customers | Browse and buy a Partner's products/services | Separate B2C commerce surface |
| POS / Store Hub | Store staff and edge infrastructure | Local operations and offline continuity | Marketed, but never operated from this site |

## 1.7 Publicly marketable versus internal products

| Product or service | Public marketing treatment |
|---|---|
| Partner Portal | Public customer product page |
| Partner App | Public customer product page |
| POS Desktop and POS Mobile | Public customer product family page |
| Store Hub | Public operational-resilience page |
| Chain Portal | Public multi-Store solution page |
| KitLuy Storefront | Status-gated page; publish only when approved for the target phase |
| Restaurant KDS / Guest Display / Kiosk | Roadmap-only or hidden until approved |
| Admin Portal | Do not market as a customer product; explain managed platform support only |
| AI Gateway, MCP, RAG, File Service, Notification Service | Explain benefits at a high level; do not expose internal topology or credentials |

## 1.8 Version decision

This is **v1.0.0** because `kitluy-b2b-website` is a newly defined canonical product with no earlier dedicated product specification or release baseline.

---

# Part 2 — Goals, Non-Goals and Success Measures

## 2.1 Phase 1 goals

1. Clearly explain what KitLuy Suite is.
2. Establish Laundry as the active commercial focus.
3. Explain the Digital Store, physical Location, Store Hub and offline-first model.
4. Present the customer-facing KitLuy product family in understandable language.
5. Help independent businesses, chains and franchises select the correct path.
6. Generate traceable sales and demo leads.
7. Provide phone-first registration and secure login.
8. Route authenticated users to authorized portals.
9. Support Khmer and English from launch.
10. Enforce evidence-backed product, pricing and customer-proof claims.

## 2.2 Non-goals

- Full Partner Portal configuration.
- Full Chain setup and branch governance.
- Operational dashboard or finance data.
- Customer-facing Laundry Booking checkout.
- Store Hub or terminal provisioning.
- Public extension marketplace.
- Full self-service subscription billing unless separately approved.
- Selling unfinished verticals as live.
- Copying Loyverse branding, text, screenshots, layout or trade dress.

## 2.3 Primary success funnel

```text
Qualified visit
  -> meaningful product/feature engagement
  -> demo request or registration start
  -> verified contact or verified phone
  -> qualified CRM lead or business identity
  -> Partner/Chain onboarding started
  -> approved live Store
```

## 2.4 Metrics

Exact targets remain `[REQUIRED: owner-approved baseline and target]`.

| Stage | Metric |
|---|---|
| Reach | Qualified sessions by source, language and campaign |
| Engagement | Product/feature page depth, return visits, resource engagement |
| Intent | Pricing views, demo CTA, contact-sales CTA, signup start |
| Conversion | Lead submit rate, phone verification rate, registration completion rate |
| Routing | Successful portal routing, context selection completion, route errors |
| Sales quality | Qualified-lead rate, demo scheduled, site survey, converted tenant |
| Activation | Onboarding started, blocked, ready for go-live, live |
| Trust | Security page engagement, support/contact completion, complaint rate |
| Quality | Core Web Vitals, accessibility errors, broken links, form failure rate |

## 2.5 Truth rule for metrics

Website analytics are marketing signals. Admin CRM and verified onboarding/finance records remain authoritative for qualified leads, converted Tenants, paying customers and revenue.

---

# Part 3 — Audiences and Jobs To Be Done

## 3.1 Primary audiences

| Audience | Need | Primary CTA |
|---|---|---|
| Independent Laundry owner | Replace paper/manual workflows and gain control | Explore Laundry / Request demo / Get started |
| Laundry manager | Understand daily workflow, staff and reporting | Explore features |
| Chain or franchise owner | Standardize multiple Stores and compare branches | Explore multi-Store / Contact sales |
| New entrepreneur | Understand required software and hardware | See how it works / Get started |
| Existing Partner | Reach Partner Portal quickly | Log in |
| Existing Chain user | Reach Chain Portal securely | Log in |
| Invited staff/owner | Accept invitation and continue | Accept invitation |
| Hardware/service partner | Understand partnership opportunity | Partner inquiry |
| Future vertical prospect | Learn roadmap status without false promise | Join interest list |

## 3.2 Key jobs

- “Show me what KitLuy does for my Laundry business.”
- “Show me how the products work together.”
- “Explain whether KitLuy still works when internet fails.”
- “Show me how KHQR, cash, receipts, tags and pickup fit together.”
- “Tell me whether KitLuy supports one Store or many Stores.”
- “Let me request a demonstration.”
- “Let me create my business account.”
- “Let me log in to my Partner Portal.”
- “Route me to the right Store or Chain context.”
- “Tell me what is available now versus planned.”

## 3.3 Customer-language rule

Public content uses customer language, not internal repository language.

| Internal term | Public preferred language |
|---|---|
| Tenant | Business account or Partner account |
| `kitluy-partner-pwa-portal` | Partner Portal |
| `kitluy-chain-pwa-portal` | Chain Portal |
| `kitluy-pos-desktop-app` | KitLuy POS |
| `kitluy-hub-agent` | Store Hub |
| Vertical schema delta | Industry solution |
| Edge node | Offline Store system or local Store Hub |
| Domain event | Secure system update/event, only when explanation is needed |

---

# Part 4 — Brand, Messaging and Content Principles

## 4.1 Brand foundation

**Category:** Cambodia-first Digital Store operating system.  
**Phase 1 wedge:** Laundry businesses.  
**Core promise:** Run the physical Store reliably, manage the business online, and expand into digital channels without losing operational control.

## 4.2 Messaging hierarchy

1. **Master message:** Create digitally. Operate physically. Sell everywhere.
2. **Laundry message:** Run intake, pricing, payments, garment tracking, production, ready storage and pickup in one connected system.
3. **Resilience message:** Store operations continue through the local Store Hub when internet connectivity is interrupted.
4. **Owner-control message:** See the Store through Partner Portal and Partner App.
5. **Chain message:** Standardize and compare multiple Stores without removing local emergency control.
6. **Cambodia message:** Khmer and English, KHR and USD, KHQR readiness, local phone numbers and affordable hardware.
7. **Trust message:** KitLuy remains the source of truth; connectors, AI and external channels are governed.

## 4.3 Recommended home hero

**Eyebrow:** KitLuy Suite for Cambodian businesses  
**Headline:** Create digitally. Operate physically. Sell everywhere.  
**Supporting copy:** Run your Laundry business with Digital Store management, POS, KHQR-ready payments, garment tracking, offline Store operations and owner tools built for Cambodia.  
**Primary CTA:** Explore the Laundry solution  
**Secondary CTA:** Request a demo  
**Utility CTA:** Log in

Publication copy must be reviewed against actual release status before use.

## 4.4 Content principles

- Lead with business outcomes, then explain products.
- Show an end-to-end workflow, not isolated feature lists.
- Use real evidence or clearly labeled demonstration data.
- Explain offline behavior honestly, including degraded-mode limits.
- Never claim statutory accounting, guaranteed uptime, legal compliance or payment certification without evidence.
- Never present a roadmap vertical as currently available.
- Avoid competitor comparisons on public pages unless approved and evidence reviewed.
- Do not use “AI” as a substitute for operational proof.

## 4.5 Capability availability labels

| Internal state | Public label | Rule |
|---|---|---|
| `production_available` | Available | Requires release, QA, deployment and owner approval evidence |
| `controlled_pilot` | Pilot | Must state eligibility and limitations |
| `planned` | Coming later / Planned | No availability date unless approved |
| `not_announced` | Hidden | Do not publish |
| `temporarily_unavailable` | Temporarily unavailable | Show support/contact path if previously public |
| `retired` | Retired | Remove normal CTAs and document migration/support path |

## 4.6 Claims approval record

Every material public claim must carry:

- claim ID;
- source/evidence reference;
- product owner;
- status;
- approved wording;
- language variants;
- approver;
- approval date;
- expiry/review date;
- pages using the claim.

---

# Part 5 — Information Architecture

## 5.1 Primary navigation

```text
Products
Solutions
Features
Industries
Hardware
Pricing
Resources
About
```

Utility navigation:

```text
Khmer / English
Contact Sales
Log in
Get Started
```

## 5.2 Canonical route inventory

Locale-prefixed public routes are recommended for predictable Khmer/English SEO.

```text
/
/{locale}
/{locale}/products
/{locale}/products/partner-portal
/{locale}/products/partner-app
/{locale}/products/pos
/{locale}/products/store-hub
/{locale}/products/chain-management
/{locale}/products/storefront
/{locale}/features
/{locale}/features/digital-store
/{locale}/features/laundry-bookings
/{locale}/features/pricing-and-deposits
/{locale}/features/khqr-and-payments
/{locale}/features/customers
/{locale}/features/garment-tracking
/{locale}/features/ready-and-pickup
/{locale}/features/staff-and-permissions
/{locale}/features/inventory-and-consumables
/{locale}/features/reports-and-finance
/{locale}/features/offline-operation
/{locale}/features/integrations
/{locale}/solutions
/{locale}/solutions/single-store
/{locale}/solutions/multi-store
/{locale}/solutions/franchise
/{locale}/industries
/{locale}/industries/laundry
/{locale}/industries/coming-later
/{locale}/hardware
/{locale}/offline
/{locale}/pricing
/{locale}/security
/{locale}/resources
/{locale}/resources/guides
/{locale}/resources/faq
/{locale}/resources/blog
/{locale}/status
/{locale}/about
/{locale}/contact
/{locale}/contact-sales
/{locale}/request-demo
/{locale}/partner-inquiry
/{locale}/register
/{locale}/login
/{locale}/verify-phone
/{locale}/forgot-password
/{locale}/accept-invitation
/{locale}/account/select
/{locale}/account/no-access
/{locale}/onboarding/business
/{locale}/onboarding/structure
/{locale}/onboarding/vertical
/{locale}/onboarding/consent
/{locale}/onboarding/complete
```

## 5.3 Route visibility rules

- Hidden routes must return 404 or an approved waitlist page, not unfinished content.
- `pricing` may show “Contact sales” until commercial values are approved.
- `storefront`, future vertical and advanced integration pages are status-gated.
- `status` must not imply real-time platform authority unless connected to an approved status source.
- Admin routes are never linked or resolved from the public website.

## 5.4 Footer

Required groups:

- Products.
- Solutions.
- Industries.
- Resources.
- Company.
- Legal.
- Contact.
- Language.
- Login / Get started.

Required legal links remain `[REQUIRED: approved Terms, Privacy, Cookies, Acceptable Use and Data Processing content]`.

---

# Part 6 — Page Specifications

## 6.1 Home page

### Objective

Explain the whole Suite in under one scroll, establish Laundry as the active solution, and route visitors to discovery, demo or registration.

### Required sections

1. Hero.
2. Trust/evidence strip, hidden until approved proof exists.
3. “One connected KitLuy Suite” product ecosystem overview.
4. Laundry workflow story.
5. Offline Store Hub explanation.
6. Partner/owner management overview.
7. Single Store versus Chain paths.
8. Cambodia-first support.
9. Product feature highlights.
10. Security and source-of-truth statement.
11. Final CTA.

### Acceptance

- Visitor can identify what KitLuy is, who it is for and the active vertical.
- “Log in,” “Request demo” and “Explore Laundry” are visible without menu interaction on desktop and mobile.
- No internal-only product is presented as a customer application.

## 6.2 Products overview

### Objective

Explain how customer-facing KitLuy products work together.

### Product groups

| Group | Products |
|---|---|
| Manage your business | Partner Portal, Partner App |
| Operate your Store | POS, POS Mobile, Store Hub |
| Run multiple Stores | Chain Portal |
| Sell online | KitLuy Storefront, only when status permits |
| Connect and extend | Approved integrations and APIs, status-gated |

Each card displays:

- product name;
- one-sentence outcome;
- target user;
- key capability list;
- availability label;
- “Learn more” CTA.

## 6.3 Partner Portal page

Required content:

- one Digital Store back-office scope;
- services and pricing;
- staff and permissions;
- customers;
- inventory/consumables;
- finance and reports with truthful labels;
- settings and integrations;
- clear statement that POS operation remains in Store applications.

CTA: Get started / Log in.

## 6.4 Partner App page

Required content:

- owner/manager mobile cockpit;
- alerts, approvals and summaries;
- freshness and last-known-data behavior;
- not a replacement for Partner Portal or POS.

## 6.5 POS page

Required content:

- T1 Intake/Cashier;
- T2 Customer Display Screen;
- T3 Clean & Ready Scan-In;
- T4 Customer Pickup Scan-Out;
- per-piece/per-weight pricing;
- deposits, KHQR-ready and cash flows;
- receipt/tag printing;
- local Store Hub operation;
- permissioned staff roles.

The page must use the owner-locked T1–T4 model and must not repeat the superseded three-terminal model.

## 6.6 Store Hub page

Required content:

- local operational authority after provisioning;
- LAN connection to T1–T4;
- local data, queue, files and device coordination;
- asynchronous cloud sync;
- smartphone-simple setup;
- signed staged updates and rollback;
- honest limits: first provisioning requires internet, and hardware support depends on certified profiles.

## 6.7 Chain management page

Required content:

- master standards and catalog governance;
- branch comparison;
- service availability policy;
- compliance and Chain reporting;
- local emergency availability rule;
- multi-Store organization path;
- contact-sales CTA.

## 6.8 Laundry industry page

### Required story

```text
Customer intake
  -> service and price calculation
  -> deposit/payment and KHQR-ready display
  -> receipt and garment tags
  -> production and issue handling
  -> Clean & Ready Scan-In
  -> ready storage
  -> customer verification and Pickup Scan-Out
  -> completed Booking and reporting
```

### Required feature sections

- Booking intake.
- Per-piece and per-weight services.
- Garments, tags and chain of custody.
- Deposits and remaining balance.
- Cash and KHQR-ready payments.
- Pickup and delivery.
- Production statuses.
- Rewash, damage, missing item and evidence handling.
- Consumables and capacity.
- T1–T4.
- Store Hub and offline operation.
- Partner Portal, Partner App and Chain options.

## 6.9 Single-Store solution page

Explains the independent business path:

```text
Learn -> Register -> Partner account -> Partner Portal
-> Create Digital Store -> Configure Laundry -> Optional physical Location
-> Store Hub and POS provisioning -> Go live
```

Do not imply that hardware is required before a Digital Store account can exist.

## 6.10 Multi-Store / franchise pages

Explain qualification and assisted onboarding. A new multi-Store registration creates a Chain onboarding intent; it does not silently grant unrestricted Chain authority.

## 6.11 Hardware page

Show approved hardware categories, not unverified model inventory:

- Store Hub.
- Front-counter terminal.
- Ready/pickup terminal.
- Customer display.
- Receipt and tag printers.
- Barcode/QR scanners.
- USB scale.
- Cash drawer.
- Network and power recommendations.

Exact models, prices and compatibility require the current certified-device register.

## 6.12 Offline page

Explain:

- what continues locally;
- what queues for cloud synchronization;
- how users see sync/freshness state;
- what requires internet;
- recovery and support.

Do not use absolute “works without internet forever” language.

## 6.13 Pricing page

Until prices are approved:

- show product/solution packaging concept;
- explain subscription, hardware and implementation may be separate;
- show “Contact sales” or “Request proposal”;
- do not publish invented monthly amounts, savings or trial duration.

When prices are approved, each price record must include currency, billing interval, tax treatment, effective date, eligible market, included limits and approval reference.

## 6.14 Security page

Explain in customer language:

- Tenant and Store isolation.
- Roles and permissions.
- Device identity.
- Encryption in transit and at rest.
- Audit history.
- Human confirmation for sensitive actions.
- Controlled external channels.
- AI permission boundaries.
- Data export/retention only after policy approval.

## 6.15 Resources

Phase 1 supports:

- guides;
- FAQs;
- implementation checklists;
- Laundry digitization content;
- offline-resilience explainers;
- KHQR and payment explainers with approved provider wording;
- release notes or status when operationally supported.

## 6.16 About and contact

About page includes verified company identity only. Contact page provides approved office/contact channels and does not expose personal credentials or unmonitored addresses.

---

# Part 7 — Marketing Capability Catalog

## 7.1 Product catalog entry

Each marketable product record contains:

```text
product_id
slug
public_name
internal_product_key
audience
one_line_value
long_description
primary_capabilities[]
availability_status
availability_evidence_ref
cta_type
cta_target
supported_locales[]
media_refs[]
seo_title
seo_description
last_reviewed_at
approved_by
```

## 7.2 Feature catalog entry

```text
feature_id
slug
public_name
domain
summary
business_outcome
owning_product
supporting_products[]
vertical_scope[]
phase
availability_status
evidence_ref
limitations
related_routes[]
```

## 7.3 Phase 1 Laundry capability groups

| Group | Public capabilities |
|---|---|
| Digital Store | Business identity, Store setup, services, pricing and rules |
| Customer and Booking | Phone-first customer lookup, Laundry Booking, due/pickup information |
| Pricing | Per-weight, per-piece, flat and add-on pricing |
| Payment | Cash, deposits, remaining balance, KHQR-ready status |
| Garment custody | Garments, tags, scan events, count and identity checks |
| Production | Wash, dry, press, QA, packaging, issue/rewash/damage handling |
| Ready and pickup | T3 Ready Scan-In, ready location, T4 Pickup Scan-Out |
| Owner control | Partner Portal and Partner App |
| Multi-Store | Chain Portal and standards |
| Edge operation | Store Hub, LAN operation, offline queue and sync |
| Hardware | Printers, scanner, scale, display, cash drawer |
| Reporting | Daily operations, sales/finance read models, staff and inventory views |

## 7.4 Future vertical handling

The website may list the eight-vertical roadmap, but only with status from the availability register:

1. Laundry.
2. Café and Restaurant.
3. Online Retail and eCommerce.
4. Convenience.
5. Pharmacy.
6. Department Store.
7. Grocery.
8. Supermarket.

Future vertical pages default to hidden or “planned.” They may collect interest but must not take payment or promise launch dates without approval.

---

# Part 8 — Lead Generation and CRM Integration

## 8.1 Lead forms

Phase 1 forms:

- Request a demo.
- Contact sales.
- Hardware consultation.
- Chain/franchise inquiry.
- Partnership inquiry.
- Future vertical interest.
- General contact.

## 8.2 Minimum form fields

| Field | Rule |
|---|---|
| Contact name | Required for sales/demo |
| Phone | Required; normalized to E.164 where possible |
| Email | Optional or required by form policy |
| Business name | Required for sales/demo |
| Business structure | Single Store, multi-Store, franchise, not sure |
| Vertical interest | Laundry default for Phase 1; future interest allowed |
| Estimated Store count | Positive integer; default 1 |
| City/province | Optional Phase 1 qualification field |
| Current workflow/system | Optional discovery field |
| Message/pain | Optional free text with length limit |
| Preferred language | Khmer or English |
| Consent | Required policy acknowledgement; marketing opt-in separate |
| Source/campaign | Captured automatically and preserved |

## 8.3 CRM authority

Admin CRM is authoritative for lead lifecycle. The browser must not write directly to `kitluy_admin.crm_leads`.

```text
Public form
  -> POST /api/v1/public/leads
  -> validation, anti-abuse, consent, deduplication
  -> Admin CRM lead
  -> lead-created event
  -> optional notification
```

## 8.4 CRM mapping

| Website field | Admin CRM field |
|---|---|
| Business name | `business_name` |
| Contact name | `contact_name` |
| Phone | `contact_phone` |
| Email | `contact_email` |
| Vertical | `vertical_interest` |
| Store count | `store_count_estimate` |
| Campaign/referral | `source` plus attribution metadata |
| Initial state | `pipeline_stage = new` |
| Converted account | `converted_tenant_id` after approved conversion |

## 8.5 Deduplication

Potential duplicate matching uses normalized phone, email and business name. It must not merge records automatically when confidence is low. Duplicate candidates are linked for Admin review.

## 8.6 Lead notifications

Notification delivery is asynchronous and does not determine lead creation success. CRM creation is authoritative; email/SMS/Telegram notification failure is visible and retryable.

## 8.7 Form abuse controls

- IP/device rate limiting.
- Hidden honeypot.
- Risk-based CAPTCHA after suspicious behavior.
- Server-side schema validation.
- Payload size limits.
- Sanitized free text.
- No confidential data request in public forms.

---

# Part 9 — Registration and Authentication

## 9.1 Identity principles

1. Supabase Auth is the Phase 1 identity provider.
2. A verified phone number is mandatory for first business registration.
3. Google sign-in may be used as an alternate login/identity method, but it does not remove the phone requirement for a new business account.
4. Email may be collected and verified according to policy.
5. Future Keycloak/OIDC SSO is an adapter path, not a Phase 1 dependency.
6. Authentication never grants a Partner, Chain or Admin business role by itself.

## 9.2 Registration flow

```text
Register
  -> choose language
  -> enter phone
  -> verify OTP
  -> create or link identity
  -> optional Google/email link
  -> enter authorized representative
  -> enter business identity
  -> choose operating structure
  -> choose vertical interest
  -> accept Terms/Privacy
  -> create registration/onboarding intent
  -> route to Partner or Chain continuation
```

## 9.3 Business registration fields

- Authorized representative full name.
- Mandatory verified phone.
- Email.
- Business name.
- Business structure.
- Registration number where required and available.
- Single-Store, multi-Store or franchise model.
- Existing/planned Location count.
- Intended vertical.
- Preferred language.
- City/province.
- Consent and policy versions.

Only the minimum needed data is collected publicly. Sensitive verification documents belong to approved onboarding flows with private file access.

## 9.4 Operating structure question

Public copy:

> **How will you operate with KitLuy?**

| Choice | Result |
|---|---|
| One independent business or Store | Partner onboarding path |
| Multiple company-owned Stores | Chain onboarding intent |
| Franchise or licensed brand | Chain/franchise onboarding intent |
| Online first, physical Location later | Partner or Chain based on organization, not hardware count |
| Not sure yet | Assisted review; do not auto-create incorrect authority |

## 9.5 Login flow

```text
Log in
  -> phone OTP / Google / approved method
  -> validate session
  -> resolve active memberships server-side
  -> honor safe return URL if authorized
  -> route to one context, selector, onboarding resume or no-access support
```

## 9.6 Account recovery

Phase 1 supports:

- resend OTP with rate limits;
- phone recovery policy `[REQUIRED]`;
- email recovery if enabled;
- support escalation for lost phone/account conflict;
- no staff disclosure of OTP or secret data.

## 9.7 Invitation acceptance

Invitation route validates:

- signed invitation token;
- expiry;
- intended email/phone where applicable;
- Tenant/Chain/Store scope;
- role being offered;
- current invitation status.

Acceptance creates the approved membership only after server validation. It never allows the browser to select an arbitrary role.

## 9.8 Session behavior

- Use secure, HttpOnly, SameSite cookies where architecture permits.
- Use PKCE, state and nonce for OAuth.
- Rotate sessions after authentication.
- Do not store tokens in localStorage when secure cookies are available.
- Auth pages are excluded from public service-worker response caching.
- Portal handoff uses an allowlisted destination and a short-lived server-issued continuation token or trusted shared session flow.

---

# Part 10 — Portal Routing

## 10.1 Server-side route resolution

The browser never decides authority from UI state alone.

### Resolution order

1. Validate authenticated session.
2. Validate requested return URL against allowlist.
3. Resolve active Partner, Store and Chain memberships server-side.
4. Resolve pending invitation or incomplete registration.
5. Apply product entitlement and account-state checks.
6. Return one safe routing result.

## 10.2 Routing outcomes

| Condition | Outcome |
|---|---|
| One active Partner context | Partner Portal |
| Multiple Partner/Store contexts | Context selector |
| One active Chain context | Chain Portal |
| Multiple Chain/Partner contexts | Context selector grouped by business |
| Pending registration/onboarding | Resume onboarding |
| Pending invitation | Invitation acceptance |
| Suspended or closed context | Restricted state with support path |
| No valid membership | No-access page / registration support |
| HET Admin role only | Do not route to Admin Portal; show separate internal access guidance according to policy |

## 10.3 Route response contract

```json
{
  "ok": true,
  "data": {
    "route_type": "partner|chain|selector|onboarding|invitation|no_access",
    "destination": "allowlisted-url-or-null",
    "contexts": [],
    "reason_code": "SINGLE_PARTNER_CONTEXT",
    "continuation_token": "short-lived-token-or-null"
  },
  "meta": {
    "request_id": "uuid",
    "generated_at": "timestamptz"
  }
}
```

## 10.4 Open-redirect protection

- Destinations are configured by environment.
- Arbitrary `redirect_uri` is rejected.
- Continuation tokens are single-use, audience-bound and short-lived.
- Route results do not expose memberships outside the authenticated user.

---

# Part 11 — Content Management and Editorial Workflow

## 11.1 Phase 1 content architecture decision

The minimum launch baseline is version-controlled structured content in the repository, not an ungoverned third-party CMS dependency.

```text
content/
  en/
  km/
  products/
  features/
  solutions/
  industries/
  resources/
  claims/
  navigation/
```

A future CMS may replace or augment the editor experience only through the same validated content contracts.

## 11.2 Content lifecycle

```text
draft -> product review -> evidence review -> language review
-> legal/security review when required -> approved -> scheduled/published
-> periodic review -> archived or revised
```

## 11.3 Content roles

| Role | Capability |
|---|---|
| Marketing editor | Draft and update content |
| Product reviewer | Validate product scope and terminology |
| Evidence reviewer | Validate availability and proof |
| Language reviewer | Approve Khmer/English quality |
| Legal/security reviewer | Approve legal, privacy, security and payment wording |
| Publisher | Merge/release approved content |

One person may hold multiple roles in a small team, but high-risk claims require documented second review.

## 11.4 Content file contract

Every content item includes front matter:

```yaml
id: product-partner-portal
slug: partner-portal
locale: en
status: approved
availability: production_available
owner: partner-product
claim_refs:
  - CLAIM-KB2B-001
reviewed_at: 2026-07-25
review_due_at: 2026-10-25
seo:
  title: "..."
  description: "..."
```

## 11.5 Media rules

- Public media lives in approved DigitalOcean Spaces paths.
- Every asset has owner, rights status, alt text, locale, checksum and publication status.
- Customer images/logos require explicit consent.
- Demo screenshots must be labeled and contain no real PII unless consented.
- Internal Admin screens, secrets, device keys or support evidence are never public.

---

# Part 12 — Localization and Cambodia-First Requirements

## 12.1 Required locales

- Khmer (`km`).
- English (`en`).

Additional languages require a versioned decision.

## 12.2 Locale behavior

- Explicit locale URLs.
- Persistent language preference.
- No forced language based solely on IP.
- Correct `lang` and text direction attributes.
- Khmer typography verified on supported devices.
- Search engines receive stable hreflang links.

## 12.3 Formatting

| Data | Rule |
|---|---|
| Timezone | Asia/Phnom_Penh for displayed business dates/times |
| KHR | Integer display unless approved business rule says otherwise |
| USD | Two-decimal display |
| Phone | Store E.164; display Cambodian local format where appropriate |
| Address | Cambodia province/city/district/commune fields as approved |
| Names | Do not assume Western given/family-name ordering |

## 12.4 Translation quality

- No machine translation is published without human review.
- Product names and statuses use a controlled glossary.
- Legal text is translated by an approved reviewer.
- Text expansion is tested in buttons, cards and navigation.

---

# Part 13 — UX and Design System

## 13.1 Design principles

1. Trustworthy and calm.
2. Product-led, not jargon-led.
3. Mobile-first for Cambodian visitors.
4. Fast on ordinary mobile networks.
5. Clear Khmer/English parity.
6. Strong visual explanation of the Suite ecosystem.
7. Reusable sections, not one-off page designs.
8. Accessible by keyboard, screen reader and touch.

## 13.2 Core layout

- Maximum readable content width.
- Responsive grid.
- Sticky but unobtrusive header.
- Visible primary CTA.
- Clear section rhythm.
- Footer with full route coverage.

Exact tokens come from the KitLuy shared design system. The website may define marketing-specific composition tokens but must not fork brand primitives.

## 13.3 Required components

### Navigation

- `PublicHeader`
- `MegaMenu`
- `MobileNavigation`
- `LocaleSwitcher`
- `LoginLink`
- `PrimaryCTA`
- `PublicFooter`

### Marketing

- `HeroSection`
- `ProductCard`
- `FeatureCard`
- `SolutionCard`
- `AvailabilityBadge`
- `WorkflowDiagram`
- `ProductEcosystemMap`
- `ComparisonTable`
- `MetricOrProofBlock`
- `TestimonialCard`, hidden without evidence
- `FAQAccordion`
- `CTASection`

### Forms and auth

- `LeadForm`
- `PhoneInputKH`
- `OTPInput`
- `BusinessStructureSelector`
- `VerticalSelector`
- `ConsentCheckboxGroup`
- `PortalContextSelector`
- `AuthErrorState`
- `NoAccessState`

### Trust and status

- `SecuritySummary`
- `OfflineExplanation`
- `DataTruthNotice`
- `PlannedFeatureNotice`
- `StatusBanner`

## 13.4 Form rules

- Labels are persistent; placeholders are examples only.
- Required/optional status is explicit.
- Errors are adjacent, specific and announced accessibly.
- Phone field supports `+855` and local entry normalization.
- Submit button shows progress and prevents duplicate submission.
- Successful lead creation shows lead reference or clear confirmation.

## 13.5 Responsive targets

Support modern mobile, tablet, laptop and desktop widths. No page may require horizontal scrolling at 320 CSS pixels except intentionally scrollable code/data examples.

## 13.6 Accessibility target

WCAG 2.2 AA target:

- semantic landmarks;
- keyboard access;
- visible focus;
- sufficient contrast;
- reduced motion support;
- form error associations;
- accessible menus/dialogs;
- captions/transcripts for marketing video;
- descriptive link text;
- alt text and decorative-image handling.

---

# Part 14 — Technical Architecture

## 14.1 Target stack

| Layer | Target |
|---|---|
| Web | React Web, server-rendered/static-first framework pinned by monorepo |
| Language | TypeScript strict mode |
| Styling | Shared KitLuy design system and tokens |
| Auth | Supabase Auth |
| Database | Supabase PostgreSQL with RLS |
| Server functions | Supabase Edge Functions and/or approved DigitalOcean service |
| Hosting | DigitalOcean, Singapore region |
| Public media | DigitalOcean Spaces through KitLuy File Service |
| Analytics | `[REQUIRED: privacy-approved provider or first-party pipeline]` |
| Monitoring | Approved error, uptime and log tooling |

## 14.2 Topology

```text
Visitor browser
   |
   v
DigitalOcean-hosted KitLuy B2B Website
   |-- static/server-rendered public content
   |-- KitLuy File Service -> DigitalOcean Spaces public media
   |-- Supabase Auth -> phone / Google / session
   |-- Public Edge API -> leads / registration / route resolver
   |        |-- Admin CRM
   |        |-- Identity and memberships
   |        |-- consent/audit/events
   |        `-- Notification Service
   `-- safe redirect -> Partner Portal or Chain Portal
```

## 14.3 Offline behavior

This public website is not an offline operational system.

- Public static assets may be cached for performance.
- Auth, lead submission, registration and routing require network access.
- Authenticated responses, OTP pages and portal continuation tokens are never served from stale cache.
- Store Hub offline guarantees do not apply to this website.

## 14.4 Repository structure

```text
apps/
  kitluy-b2b-website/
    app/
      [locale]/
        products/
        features/
        solutions/
        industries/
        resources/
        register/
        login/
        onboarding/
    components/
      navigation/
      marketing/
      forms/
      auth/
      seo/
    content/
      en/
      km/
      claims/
      navigation/
    lib/
      auth/
      api/
      content/
      analytics/
      security/
      routing/
    public/
    tests/
      unit/
      component/
      e2e/
      accessibility/
      seo/
      security/
packages/
  design-system/
  auth-client/
  i18n/
  api-contracts/
  analytics-contracts/
  content-schema/
```

## 14.5 Environment values

```text
NEXT_PUBLIC_APP_ENV
NEXT_PUBLIC_APP_VERSION
NEXT_PUBLIC_SITE_URL
NEXT_PUBLIC_PARTNER_PORTAL_URL
NEXT_PUBLIC_CHAIN_PORTAL_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_DEFAULT_LOCALE
PUBLIC_MEDIA_BASE_URL
ANALYTICS_PUBLIC_KEY [if approved]
```

Server-only:

```text
SUPABASE_SERVICE_ROLE_KEY
CRM_LEAD_WEBHOOK_SECRET [if applicable]
NOTIFICATION_SERVICE_TOKEN
CONTENT_SIGNING_KEY [if applicable]
ANTI_ABUSE_SECRET
```

No server-only secret may use a public prefix or ship to the browser.

## 14.6 Domain placeholders

| Purpose | Value |
|---|---|
| Production B2B site | `[REQUIRED: production public domain]` |
| Staging B2B site | `[REQUIRED: staging domain]` |
| Partner Portal | `[REQUIRED: production Partner Portal domain]` |
| Chain Portal | `[REQUIRED: production Chain Portal domain]` |
| Auth callback | `[REQUIRED: callback URL inventory]` |

---

# Part 15 — Data Model

All tables below are target additions or integrations and require migrations before being treated as implemented.

## 15.1 Existing authoritative records reused

- Supabase `auth.users` — identity.
- Core user/profile and membership records — business authorization.
- `kitluy_admin.crm_leads` — lead lifecycle.
- `kitluy_admin.onboarding_workspaces` — converted onboarding lifecycle.
- `kitluy_audit.audit_logs` — sensitive action audit.
- File metadata — public media authorization and metadata.

## 15.2 Proposed `kitluy_public.capability_availability`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `capability_key` | text | Stable unique key |
| `product_key` | text | Owning product |
| `vertical` | text | Laundry or later vertical |
| `public_status` | enum | production_available, controlled_pilot, planned, hidden, unavailable, retired |
| `public_label_en` | text | Approved label |
| `public_label_km` | text | Approved label |
| `evidence_ref` | text | Release/test/deployment evidence |
| `approved_by` | uuid | Authorized approver |
| `approved_at` | timestamptz | Approval time |
| `review_due_at` | timestamptz | Required revalidation |
| `metadata` | jsonb | Optional non-authoritative metadata only |

## 15.3 Proposed `kitluy_public.public_form_requests`

Append-only intake record for idempotency, anti-abuse and delivery tracking; not the authoritative CRM lifecycle.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `request_type` | enum | demo, sales, hardware, chain, partner, future_vertical, contact |
| `idempotency_key` | text | Unique |
| `normalized_phone_hash` | text | Deduplication without unnecessary raw logging |
| `crm_lead_id` | uuid | Created CRM lead |
| `delivery_status` | enum | received, crm_created, notification_pending, completed, failed |
| `source` | text | First/last attribution summary |
| `consent_record_id` | uuid | Consent reference |
| `created_at` | timestamptz | |
| `completed_at` | timestamptz | |
| `error_code` | text | Redacted operational code |

## 15.4 Proposed `kitluy_public.consent_records`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `auth_user_id` | uuid nullable | Null for anonymous lead |
| `subject_phone_hash` | text nullable | Minimized matching |
| `consent_type` | enum | terms, privacy, marketing_email, marketing_sms, analytics |
| `policy_version` | text | Exact version accepted |
| `granted` | boolean | Explicit state |
| `source_surface` | text | B2B website route/form |
| `ip_address` | inet nullable | According to privacy policy |
| `user_agent_hash` | text nullable | Minimized evidence |
| `created_at` | timestamptz | Append-only event time |

## 15.5 Proposed `kitluy_public.registration_intents`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `auth_user_id` | uuid | Verified identity |
| `status` | enum | started, phone_verified, profile_complete, routed, expired, cancelled |
| `business_name` | text | Draft until converted |
| `structure_type` | enum | single_store, multi_store, franchise, online_first, unsure |
| `vertical_interest` | text | Laundry for active Phase 1 path |
| `store_count_estimate` | integer | |
| `preferred_locale` | text | km/en |
| `crm_lead_id` | uuid nullable | Linked lead |
| `tenant_id` | uuid nullable | Set after approved conversion |
| `chain_id` | uuid nullable | Set after approved Chain creation |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Mutable draft, audited |

## 15.6 RLS principles

- Public anonymous users cannot query raw form, consent, registration or CRM rows.
- Public content/availability receives a purpose-built read projection.
- Authenticated users may read only their own registration intent.
- CRM and conversion actions occur through privileged server functions.
- Admin staff access is enforced by Admin permissions, not by B2B UI.

---

# Part 16 — APIs and Events

## 16.1 API conventions

- Versioned routes under `/api/v1`.
- JSON schema validation.
- Idempotency key required for mutations.
- Standard error envelope.
- Request ID on every response.
- Rate limits and abuse controls.
- No direct production database access for browsers or connectors.

## 16.2 Public content APIs

### `GET /api/v1/public/site-config`

Returns locale support, navigation version, approved domains and public feature flags.

### `GET /api/v1/public/products`

Returns marketable products and approved availability only.

### `GET /api/v1/public/features`

Returns public feature catalog filtered by locale, vertical and status.

### `GET /api/v1/public/availability`

Returns public-safe capability labels. It never exposes internal evidence documents or release secrets.

## 16.3 Lead API

### `POST /api/v1/public/leads`

Required headers:

```http
Content-Type: application/json
Idempotency-Key: <uuid>
X-Kitluy-Locale: km|en
```

Request:

```json
{
  "request_type": "demo",
  "contact_name": "Sokha",
  "phone": "+85512345678",
  "email": "owner@example.com",
  "business_name": "Example Laundry",
  "structure_type": "single_store",
  "vertical_interest": "laundry",
  "store_count_estimate": 1,
  "message": "We want to digitize intake and pickup.",
  "attribution": {
    "first_source": "facebook",
    "last_source": "direct",
    "campaign": "laundry-launch"
  },
  "consents": [
    {"type": "privacy", "version": "[REQUIRED]", "granted": true},
    {"type": "marketing_sms", "version": "[REQUIRED]", "granted": false}
  ]
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "lead_reference": "LEAD-XXXXXX",
    "next_action": "sales_follow_up"
  },
  "meta": {
    "request_id": "uuid",
    "generated_at": "timestamptz"
  }
}
```

## 16.4 Registration APIs

- `POST /api/v1/registration/intents`
- `PATCH /api/v1/registration/intents/{id}`
- `POST /api/v1/registration/intents/{id}/complete`
- `GET /api/v1/account/route`
- `POST /api/v1/invitations/{token}/accept`

Phone OTP initiation/verification uses the approved Supabase Auth client/server flow and provider limits.

## 16.5 Standard error envelope

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Check the highlighted fields.",
    "field_errors": {},
    "retryable": false
  },
  "meta": {
    "request_id": "uuid"
  }
}
```

## 16.6 Domain events

| Event | Trigger |
|---|---|
| `marketing_lead_created.v1` | CRM lead created |
| `demo_requested.v1` | Demo request accepted |
| `business_registration_started.v1` | Registration intent created |
| `phone_verified.v1` | Required phone verified |
| `business_registration_completed.v1` | Public registration complete |
| `portal_route_resolved.v1` | Authorized destination returned |
| `invitation_accepted.v1` | Membership invitation accepted |
| `consent_updated.v1` | Consent grant/revoke recorded |
| `public_capability_status_changed.v1` | Approved public status changes |
| `public_content_published.v1` | Content release published |

Events are tenant/user scoped where applicable, idempotent, versioned and auditable.

---

# Part 17 — Security, Privacy and Abuse Prevention

## 17.1 Security requirements

- HTTPS only.
- TLS 1.2 minimum; TLS 1.3 preferred.
- HSTS after domain validation.
- Strict CSP.
- `frame-ancestors` restrictions.
- Referrer and permissions policies.
- Server-side input validation.
- Sanitized structured content.
- Dependency and secret scanning.
- No service-role key in browser.
- RLS on every private table.
- Short-lived signed upload/access URLs.

## 17.2 Authentication threats

Test and prevent:

- OTP brute force.
- OTP replay.
- phone enumeration.
- OAuth CSRF/state mismatch.
- session fixation.
- token leakage in URL/referrer.
- open redirects.
- invitation token guessing/reuse.
- cross-account membership disclosure.
- suspended-account bypass.

## 17.3 Privacy

- Collect the minimum data needed.
- Separate required legal acceptance from optional marketing consent.
- Do not preselect marketing consent.
- Do not send phone/email to analytics.
- Redact PII in logs and error reports.
- Define retention/deletion policy before production.
- Public forms must not request payment card data, OTP, PIN or confidential evidence.

## 17.4 Content security

- Only approved content branches/builds publish to production.
- MDX/components use an allowlist; no arbitrary script execution.
- External embeds require security and privacy review.
- User-generated form content is never rendered as HTML.

## 17.5 Admin separation

The B2B website may create leads and onboarding intents through APIs, but it cannot:

- query all CRM leads;
- assign sales owners;
- approve go-live;
- provision Stores;
- manage billing;
- operate devices;
- impersonate Partners;
- expose Admin routes.

---

# Part 18 — SEO, Performance and Analytics

## 18.1 SEO baseline

- Server-rendered or statically generated public pages.
- Unique title and description per locale/page.
- Canonical URLs.
- XML sitemap.
- `robots.txt`.
- Khmer/English hreflang.
- Breadcrumbs.
- Open Graph and social metadata.
- Structured data where truthful: Organization, SoftwareApplication, Product, FAQPage, BreadcrumbList.
- No fake ratings, prices, customer counts or review schema.

## 18.2 Search content priorities

Phase 1 content clusters:

- Laundry POS Cambodia.
- Laundry management software Cambodia.
- Laundry garment tracking.
- Laundry KHQR and payment workflow.
- Offline POS / Store Hub.
- Laundry receipt and tag printing.
- Multi-Store Laundry management.
- Digital Store for Laundry business.

SEO wording must remain natural and evidence-backed.

## 18.3 Performance targets

Target at p75 on representative mobile traffic:

- LCP <= 2.5 seconds.
- INP <= 200 milliseconds.
- CLS <= 0.1.

Engineering budgets:

- responsive, compressed hero media;
- lazy-load below-fold media;
- minimize third-party scripts;
- font subset/preload only required weights;
- cache immutable assets;
- no blocking analytics or chat widgets;
- auth bundle isolated from public landing routes where possible.

## 18.4 Analytics event catalog

| Event | Required properties |
|---|---|
| `page_view` | route, locale, referrer class |
| `product_viewed` | product key, availability label |
| `feature_viewed` | feature key, vertical |
| `cta_clicked` | CTA key, placement, destination class |
| `pricing_viewed` | package key/status |
| `demo_started` | form type, source |
| `demo_submitted` | lead reference hash, source |
| `signup_started` | method, locale |
| `phone_verified` | country code, no full phone |
| `registration_completed` | structure type, vertical |
| `login_succeeded` | method, route result type |
| `portal_routed` | destination class, not tenant name |
| `portal_route_failed` | safe reason code |
| `consent_updated` | consent type and state |

## 18.5 Attribution

Preserve first-touch and last-touch campaign data through lead creation. Chain opportunities support multi-touch review. Revenue attribution is recognized only through reconciled business records, not browser cookies alone.

---

# Part 19 — Reliability, Monitoring and Operations

## 19.1 Health endpoints

- `/health/live` — process alive.
- `/health/ready` — dependencies needed for normal traffic.
- `/health/content` — content manifest valid and loaded.
- `/health/auth` — non-sensitive auth configuration check.
- `/health/crm` — synthetic/controlled lead integration status, not customer data.

## 19.2 Monitoring

Monitor:

- site uptime;
- server errors;
- page latency;
- broken links;
- form submit failures;
- CRM delivery failures;
- OTP provider failures;
- auth callback failures;
- portal route errors;
- content build validation failures;
- locale missing-key errors;
- Core Web Vitals;
- suspicious abuse/rate-limit events.

## 19.3 Alerts

| Alert | Severity |
|---|---|
| Site unavailable | Critical |
| Registration/login unavailable | Critical |
| Leads accepted but CRM creation failing | Critical |
| Portal routing cross-scope anomaly | Critical/security |
| OTP failure rate elevated | High |
| Broken primary CTA | High |
| Khmer page build failure | High |
| Public claim expired or lacks evidence | High/content |
| Analytics unavailable | Medium; must not block site |

## 19.4 Error handling

- Public pages show useful error states.
- Lead form preserves non-sensitive input after retryable failure.
- Auth failure never reveals whether another person owns a phone/email.
- CRM notification failure does not ask the user to resubmit if lead creation succeeded.
- Route resolver provides support reference and request ID.

## 19.5 Backup and recovery

- Source content and code are version-controlled.
- Supabase data follows project backup/PITR policy.
- Public media has lifecycle and recovery policy in Spaces.
- Production domain, DNS and secrets inventories are documented.
- Recovery drill verifies site, auth callback, lead creation and portal routing.

---

# Part 20 — Deployment and Release

## 20.1 Environments

| Environment | Purpose | Data |
|---|---|---|
| Local | Developer iteration | Synthetic users/leads only |
| Dev | Integrated development | Synthetic data |
| Staging | Release candidate, content approval, portal routing tests | Synthetic or approved test accounts |
| Production | Public site | Real visitors and business identities |

## 20.2 Build and release

1. Lint, typecheck and unit tests.
2. Content schema and claim validation.
3. Khmer/English completeness validation.
4. Build immutable artifact.
5. Dependency/security scan.
6. Deploy staging.
7. Run E2E, accessibility, SEO and security smoke tests.
8. Obtain product/content approval.
9. Promote Internal -> Pilot -> Stable.
10. Monitor and retain rollback artifact.

## 20.3 Content-only release

Content-only changes still require schema validation, broken-link tests, claim/evidence validation and review. High-risk legal, price, security or availability changes require designated approval.

## 20.4 Rollback

Rollback must restore:

- previous application build;
- previous content manifest;
- previous public capability labels;
- previous redirect rules.

Do not roll back database data destructively. Use additive migrations and compensating corrections.

---

# Part 21 — QA and Acceptance Matrix

## 21.1 Marketing and navigation

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-001 | Home page in English | Correct hero, active Laundry focus, CTAs and no unsupported claims |
| KB2B-QA-002 | Home page in Khmer | Content complete, layout intact, correct language metadata |
| KB2B-QA-003 | Products overview | Only customer-marketable products shown; Admin hidden |
| KB2B-QA-004 | Planned product | Correct Planned/Pilot label; no “available now” CTA |
| KB2B-QA-005 | Primary navigation mobile | Keyboard/touch accessible; no trapped focus |
| KB2B-QA-006 | Footer links | All legal/product/resource links valid |
| KB2B-QA-007 | 404 | Localized, safe navigation, no internal route leakage |

## 21.2 Laundry content

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-010 | T1–T4 page content | T1 Intake, T2 CDS, T3 Ready Scan-In, T4 Pickup Scan-Out exactly |
| KB2B-QA-011 | Offline explanation | Hub authority and limitations accurate; no absolute false promise |
| KB2B-QA-012 | Payment content | KHQR/cash wording matches approved provider status |
| KB2B-QA-013 | Pricing claim audit | No unapproved prices/trial/savings |
| KB2B-QA-014 | Customer proof | Hidden unless consent and evidence records exist |

## 21.3 Lead capture

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-020 | Valid demo request | One public request and one CRM lead created |
| KB2B-QA-021 | Duplicate submit | Idempotent; no duplicate CRM lead from same request |
| KB2B-QA-022 | Invalid phone | Inline error; no CRM record |
| KB2B-QA-023 | Notification failure | Lead remains created; retry visible operationally |
| KB2B-QA-024 | Consent | Required policy recorded; optional marketing remains unselected by default |
| KB2B-QA-025 | Bot burst | Rate limited/challenged without affecting normal visitors |
| KB2B-QA-026 | Attribution | First/last source preserved in CRM metadata |

## 21.4 Authentication and registration

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-030 | Phone registration | OTP verifies; phone stored normalized; registration intent created |
| KB2B-QA-031 | Google first sign-in | User must add/verify phone before business account completion |
| KB2B-QA-032 | OTP replay | Rejected |
| KB2B-QA-033 | OTP brute force | Rate limited/locked according to policy |
| KB2B-QA-034 | Existing user login | Session established and routed correctly |
| KB2B-QA-035 | Expired invitation | Safe expired state; no membership grant |
| KB2B-QA-036 | Invitation role tampering | Server ignores client-selected role; signed role/scope enforced |
| KB2B-QA-037 | Registration resume | User resumes own incomplete intent only |
| KB2B-QA-038 | Suspended business | Restricted state, no portal bypass |

## 21.5 Portal routing

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-040 | One Partner membership | Partner Portal destination |
| KB2B-QA-041 | One Chain membership | Chain Portal destination |
| KB2B-QA-042 | Multiple contexts | Context selector only shows authorized contexts |
| KB2B-QA-043 | No membership | No-access/onboarding support state |
| KB2B-QA-044 | Malicious return URL | Rejected; no open redirect |
| KB2B-QA-045 | Admin-only identity | Admin Portal not exposed through customer router |
| KB2B-QA-046 | Cross-tenant probe | No context metadata leakage |
| KB2B-QA-047 | Continuation token replay | Rejected after first use/expiry |

## 21.6 Quality, SEO and accessibility

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-050 | Keyboard journey | Header, menus, forms, auth and selector complete without mouse |
| KB2B-QA-051 | Screen reader form | Labels, errors and progress announced |
| KB2B-QA-052 | Reduced motion | Non-essential motion disabled |
| KB2B-QA-053 | SEO metadata | Unique canonical title/description/hreflang |
| KB2B-QA-054 | Sitemap | Only public approved routes included |
| KB2B-QA-055 | Structured data | No fake reviews/prices/availability |
| KB2B-QA-056 | Performance | Core Web Vitals targets pass representative test |
| KB2B-QA-057 | 320px mobile | No accidental horizontal scroll |
| KB2B-QA-058 | Broken link scan | Zero broken primary links |

## 21.7 Security

| ID | Scenario | Acceptance |
|---|---|---|
| KB2B-QA-060 | CSP | Inline/unapproved script blocked |
| KB2B-QA-061 | XSS payload in form | Stored/rendered safely; no script execution |
| KB2B-QA-062 | CSRF/OAuth state | Invalid request rejected |
| KB2B-QA-063 | Service role exposure scan | No secret in client bundle |
| KB2B-QA-064 | RLS probe | Anonymous/authenticated user cannot read private lead/consent rows |
| KB2B-QA-065 | PII analytics scan | No full phone/email/name in analytics payloads |
| KB2B-QA-066 | Auth page cache | No stale authenticated response from service worker/CDN |

---

# Part 22 — Phase Gates and Definition of Done

## G0 — Authority and content scope

- Product boundary approved.
- Public product inventory approved.
- Laundry Phase 1 capability status register approved.
- Legal entity, brand and domain decisions recorded.
- Unapproved prices and claims explicitly blocked.

## G1 — Contract and design

- Route map approved.
- Content schemas approved.
- API/events approved.
- Auth, registration and routing contracts approved.
- CRM and consent mapping approved.
- Security/privacy model reviewed.
- Khmer/English glossary approved.

## G2 — Build complete

- Pages and components implemented.
- Content complete for both languages.
- Lead forms integrated.
- Phone/Google auth implemented per policy.
- Registration and portal routing implemented.
- Automated tests pass.

## G3 — Integrated verification

- CRM lead creation and deduplication pass.
- Partner/Chain routing pass across membership combinations.
- Security, RLS and open-redirect tests pass.
- SEO, accessibility, responsive and performance tests pass.
- Monitoring and alerts verified.

## G4 — Pilot readiness

- Approved production content and evidence register.
- Terms/privacy/consent versions approved.
- Sales follow-up owner and SLA approved.
- Support runbook and escalation contacts ready.
- Rollback and recovery tested.
- Synthetic production smoke accounts ready.

## G5 — Phase 1 exit / Rebuild Test

- Production deployment evidence exists.
- All launch claims match release evidence.
- Registration/login/portal routing work in production.
- Real lead arrives in CRM and is processed through the operating playbook.
- One qualified engineer can rebuild and deploy from current documentation.
- One qualified content operator can update and publish approved content without codebase ambiguity.

---

# Part 23 — Feature Inventory

| Feature ID | Capability | Priority | Phase | Primary acceptance anchor |
|---|---|---:|---|---|
| KB2B-MKT-001 | Public home and Suite positioning | P0 | 1 | QA-001/002 |
| KB2B-MKT-002 | Product overview | P0 | 1 | QA-003 |
| KB2B-MKT-003 | Product detail pages | P0 | 1 | Content and availability audit |
| KB2B-MKT-004 | Feature catalog | P0 | 1 | Status/evidence validation |
| KB2B-MKT-005 | Laundry industry page | P0 | 1 | QA-010–014 |
| KB2B-MKT-006 | Single-Store solution | P0 | 1 | Correct Partner path |
| KB2B-MKT-007 | Chain/franchise solution | P1 | 1 | Correct assisted Chain path |
| KB2B-MKT-008 | Hardware page | P1 | 1 | Certified-profile-only claims |
| KB2B-MKT-009 | Offline/Store Hub page | P0 | 1 | QA-011 |
| KB2B-MKT-010 | Security page | P0 | 1 | Security review |
| KB2B-MKT-011 | Pricing page without invented values | P0 | 1 | QA-013 |
| KB2B-MKT-012 | Resource/FAQ system | P1 | 1 | Content review |
| KB2B-MKT-013 | Future vertical interest pages | P2 | 1 | Planned label and lead capture |
| KB2B-CLAIM-001 | Capability availability register | P0 | 1 | G0/G1 |
| KB2B-CLAIM-002 | Evidence-backed proof/testimonial gate | P0 | 1 | QA-014 |
| KB2B-LEAD-001 | Request demo | P0 | 1 | QA-020–026 |
| KB2B-LEAD-002 | Contact sales | P0 | 1 | CRM mapping |
| KB2B-LEAD-003 | Hardware consultation | P1 | 1 | CRM request type |
| KB2B-LEAD-004 | Chain inquiry | P1 | 1 | Chain qualification |
| KB2B-LEAD-005 | Partnership inquiry | P2 | 1 | CRM request type |
| KB2B-AUTH-001 | Phone-first signup | P0 | 1 | QA-030 |
| KB2B-AUTH-002 | Google sign-in with mandatory phone completion | P1 | 1 | QA-031 |
| KB2B-AUTH-003 | Login | P0 | 1 | QA-034 |
| KB2B-AUTH-004 | Account recovery | P0 | 1 | Approved recovery policy |
| KB2B-AUTH-005 | Invitation acceptance | P0 | 1 | QA-035/036 |
| KB2B-REG-001 | Business registration intent | P0 | 1 | QA-030/037 |
| KB2B-REG-002 | Business structure selection | P0 | 1 | Correct path |
| KB2B-REG-003 | Vertical selection | P0 | 1 | Laundry active; later status-gated |
| KB2B-REG-004 | Consent capture | P0 | 1 | QA-024 |
| KB2B-ROUTE-001 | Server-side membership resolver | P0 | 1 | QA-040–047 |
| KB2B-ROUTE-002 | Multi-context selector | P0 | 1 | QA-042 |
| KB2B-ROUTE-003 | Safe no-access/restricted states | P0 | 1 | QA-043/038 |
| KB2B-I18N-001 | Khmer locale | P0 | 1 | QA-002 |
| KB2B-I18N-002 | English locale | P0 | 1 | QA-001 |
| KB2B-SEO-001 | Metadata/canonical/hreflang | P0 | 1 | QA-053 |
| KB2B-SEO-002 | Sitemap/robots | P0 | 1 | QA-054 |
| KB2B-SEO-003 | Structured data | P1 | 1 | QA-055 |
| KB2B-A11Y-001 | WCAG 2.2 AA baseline | P0 | 1 | QA-050–052 |
| KB2B-ANL-001 | Privacy-controlled analytics | P1 | 1 | QA-065 |
| KB2B-OPS-001 | Health checks and monitoring | P0 | 1 | G3 |
| KB2B-OPS-002 | Staged deployment and rollback | P0 | 1 | G4 |
| KB2B-CMS-001 | Version-controlled structured content | P0 | 1 | Content build validation |
| KB2B-CMS-002 | Optional visual CMS adapter | P3 | 1.1+ | Separate decision |
| KB2B-SSO-001 | Future Keycloak/OIDC enterprise SSO | P3 | Later | Deferred; not Phase 1 dependency |

---

# Appendix A — Public Product Ecosystem Map

```text
KitLuy B2B Website
  |
  +-- Learn about KitLuy Suite
  |     +-- Partner Portal
  |     +-- Partner App
  |     +-- POS
  |     +-- Store Hub
  |     +-- Chain Portal
  |     `-- Storefront / future products by status
  |
  +-- Request Demo / Contact Sales
  |     `-- Admin CRM and onboarding operations
  |
  `-- Register / Log in
        +-- Single Store -> Partner Portal
        +-- Chain/Franchise -> Chain onboarding/Portal
        `-- Multiple contexts -> Context selector
```

---

# Appendix B — Public Copy Guardrails

## Approved style

- “Designed for Cambodian Laundry operations.”
- “Built around a Digital Store and optional physical Store Locations.”
- “Store Hub supports local operation during internet interruption, within documented limits.”
- “KHQR-ready” only when provider/flow status supports that wording.
- “Planned” or “Pilot” for unfinished capabilities.

## Prohibited without evidence

- “Best” or “number one.”
- “100% uptime.”
- “Works forever without internet.”
- “Fully compliant” without named legal scope and evidence.
- “Complete accounting/ERP.”
- “Trusted by X businesses” without audited count/date.
- Customer logos or quotes without consent.
- Exact savings or ROI without methodology and evidence.
- “Available now” for target-state planning only.

---

# Appendix C — Open Decisions

| ID | Decision | Current treatment |
|---|---|---|
| KB2B-OD-001 | Production public domain | `[REQUIRED]` |
| KB2B-OD-002 | Final public brand label: KitLuy Suite vs KitLuy for Business | Use KitLuy Suite master brand; confirm navigation label |
| KB2B-OD-003 | Exact pricing and plan packaging | Do not publish numeric values |
| KB2B-OD-004 | Trial duration | Do not publish until approved |
| KB2B-OD-005 | Legal entity, Terms, Privacy, Cookies and consent versions | `[REQUIRED]` before production forms/auth |
| KB2B-OD-006 | Email requirement in registration | Phone mandatory; email policy `[REQUIRED]` |
| KB2B-OD-007 | MFA policy for Partner/Chain owners | `[REQUIRED]`; portal security decision |
| KB2B-OD-008 | Analytics provider | `[REQUIRED: privacy-approved]` |
| KB2B-OD-009 | Public CMS after v1 | Repo content baseline; CMS later if justified |
| KB2B-OD-010 | Customer stories/logos at launch | Hidden until evidence and consent |
| KB2B-OD-011 | Public status page source and SLA | Hide or label basic status until operationally supported |
| KB2B-OD-012 | Self-service subscription checkout | Not Phase 1 default; separate commercial approval |
| KB2B-OD-013 | Chain auto-provision versus assisted approval | Assisted/reviewed by default |
| KB2B-OD-014 | Support SLA for public leads | `[REQUIRED]` |
| KB2B-OD-015 | Production phone/email providers | `[REQUIRED]` |

---

# Appendix D — Launch Checklist

## Product and content

- [ ] Product boundary approved.
- [ ] Public product inventory approved.
- [ ] All Laundry claims have status/evidence.
- [ ] No superseded T1–T3 language remains.
- [ ] Khmer and English content reviewed.
- [ ] Pricing page contains no unapproved values.
- [ ] Customer proof has consent and evidence.

## Identity and routing

- [ ] Phone OTP works in production.
- [ ] Google callback works if enabled.
- [ ] Mandatory phone completion enforced.
- [ ] Partner routing tested.
- [ ] Chain routing tested.
- [ ] Multi-context selector tested.
- [ ] Admin Portal cannot be reached through public routing.
- [ ] Open-redirect and token-replay tests pass.

## Lead and sales

- [ ] CRM lead creation works.
- [ ] Deduplication reviewed.
- [ ] Attribution preserved.
- [ ] Sales owner and follow-up SLA assigned.
- [ ] Notification retry works.

## Legal, privacy and security

- [ ] Terms and Privacy approved.
- [ ] Consent versions configured.
- [ ] Cookie/analytics behavior approved.
- [ ] CSP/HSTS/security headers verified.
- [ ] No secrets in client build.
- [ ] RLS tests pass.
- [ ] PII absent from analytics.

## Quality and operations

- [ ] Accessibility tests pass.
- [ ] SEO validation passes.
- [ ] Core Web Vitals target passes.
- [ ] Broken-link scan passes.
- [ ] Monitoring and alerts active.
- [ ] Rollback tested.
- [ ] Recovery runbook tested.
- [ ] Production smoke test completed.

---

# Version History

| Version | Date | Change |
|---|---|---|
| v1.0.0 | 2026-07-25 | First canonical Phase 1 specification for the public KitLuy Suite marketing, product-discovery, lead-generation, registration, login and Partner/Chain portal-entry website. |

---

# Final Product Statement

> **`kitluy-b2b-website` v1.0.0 is the public marketing and business-access front door of KitLuy Suite. It helps prospective businesses explore the Suite, understand the active Laundry solution, request sales assistance, register with a mandatory verified phone, log in, and continue into the correct Partner or Chain experience. It does not own Store operations, Digital Store configuration, finance, device provisioning, customer commerce or HET administration.**
