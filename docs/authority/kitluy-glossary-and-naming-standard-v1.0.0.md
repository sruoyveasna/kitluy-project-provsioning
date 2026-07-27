# KitLuy Glossary and Naming Standard

**Filename:** `kitluy-glossary-and-naming-standard-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL TERMINOLOGY STANDARD

## 1. Canonical entity hierarchy

```text
Tenant
  -> Partner Account / authorized Chain context
      -> Digital Store (exactly one primary vertical)
          -> Digital Channels
          -> zero or more Store Locations
              -> Store Hub
                  -> T1-T4 and approved devices
```

The Digital Store is the control plane. The Store Location is the physical edge environment. Do not collapse them into one ambiguous `Store` entity.

## 2. Glossary

| Term                          | Canonical definition                                                                                                                                                              | Usage rule                                                               | Prohibited/legacy usage                                              |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| KitLuy Suite                  | The complete Cambodia-first Digital Store operating system and its shared Core, applications, edge runtime, services and vertical modules.                                        | Use exact brand casing `KitLuy`.                                         | Kitluy, Kit Luy when used as product brand                           |
| Tenant                        | Backend isolation, ownership and billing boundary. All tenant-scoped records must be isolated and auditable.                                                                      | Technical/backend term.                                                  | Using Tenant as customer-facing replacement for Partner without need |
| Partner Account               | Business-facing account for the organization or operator using KitLuy. It may own one or more Digital Stores subject to permissions and plan.                                     | Use in onboarding and business UX.                                       | Seller Account                                                       |
| Partner                       | Business-facing owner/operator using KitLuy.                                                                                                                                      | Use Partner, Partner owner, Partner staff.                               | Seller                                                               |
| Chain                         | An authorized multi-Digital-Store or multi-Location governance context for a brand, group, franchise or operator.                                                                 | Use only where chain membership/governance exists.                       | Using Chain as a Tenant synonym                                      |
| Digital Store                 | Authoritative business control plane for one primary vertical: identity, catalog/services, pricing, staff, payments, rules, channels and reporting structure.                     | Always use full term in authoritative contracts.                         | Treating Digital Store as merely a website                           |
| Store Location                | Optional physical operating location of a Digital Store, with address, local availability/inventory/capacity, staff, Store Hub, POS and devices.                                  | Use `Store Location` for physical site.                                  | Using Store alone to mean physical site                              |
| Store                         | Restricted shorthand. In authoritative documents, use Digital Store or Store Location. When shorthand is unavoidable, define it once and use it consistently.                     | Prefer full terms.                                                       | Unqualified use across digital and physical contexts                 |
| Location                      | Generic scope term. Use only when the contract may include non-store locations or when the schema name is already canonical.                                                      | Prefer Store Location for physical store site.                           | Assuming every Location is a Digital Store                           |
| Primary Vertical              | Exactly one industry operating model assigned to a Digital Store.                                                                                                                 | Laundry, Café/Restaurant, eCommerce, etc.                                | Multiple primary verticals on one Digital Store                      |
| KitLuy Core                   | Neutral shared platform entities, ledgers, rules and services reused across verticals.                                                                                            | Do not hardcode Laundry terminology.                                     | Rebuilding Core per vertical                                         |
| Vertical Module               | The schema delta, terminology, workflow, interfaces, reports, hardware profile, defaults and rules required by one vertical.                                                      | Additive and reusable.                                                   | Forking the whole platform                                           |
| Channel                       | A governed digital sales or service surface such as Storefront, Telegram, marketplace, delivery platform or connector.                                                            | KitLuy remains authority.                                                | External channel as customer/inventory/payment/finance truth         |
| Store Hub                     | HET-managed local edge runtime and operational authority after provisioning. Coordinates local data, devices, offline operations, sync, files and releases.                       | Product/service ID `kitluy-hub-agent` where applicable.                  | Cloud portal as local operational authority                          |
| Edge Operations API           | Versioned, device-scoped API between Store Hub/local clients and KitLuy services.                                                                                                 | Keep separate from Management, Commerce Store and Connector APIs.        | Direct production DB access                                          |
| Management API                | Governed administrative API for authorized management operations.                                                                                                                 | Versioned/scoped/audited.                                                | Commerce checkout API                                                |
| Commerce Store API            | Customer-facing commerce/session/cart/checkout/account API surface.                                                                                                               | Phase 3 depth; governed authority.                                       | Management or Edge API                                               |
| Connector API                 | Governed integration surface for external systems/channels.                                                                                                                       | No direct DB access.                                                     | Unscoped database credentials                                        |
| Transaction                   | Neutral Core umbrella for authoritative commercial/operational records and their lines, payments, adjustments, fulfilment and state history.                                      | Use in shared Core.                                                      | Using Order for every vertical                                       |
| Laundry Booking               | Canonical Laundry business aggregate created after T1 verifies the customer and physical garments.                                                                                | Use `Booking` or `Laundry Booking` in Laundry mobile/customer-facing UX. | Order in Partner App/customer copy                                   |
| Pre-Intake Draft              | Customer-submitted preliminary Laundry intent; not an authoritative Booking.                                                                                                      | Must be verified at T1.                                                  | Treating draft values as final price/count/weight                    |
| Queue Ticket                  | Customer waiting position for an applicable T1 counter/business day.                                                                                                              | Separate from Booking.                                                   | Using queue number as transaction ID                                 |
| Order                         | Canonical for eCommerce order contexts and allowed in dense operational portal/report contexts where explicitly defined. Legacy backend `order` names may remain behind adapters. | Do not use as universal cross-vertical term.                             | Replacing Laundry Booking in customer/mobile UX                      |
| Check / Tab                   | Restaurant Phase 2 commercial/guest-running-balance concepts.                                                                                                                     | Restaurant vertical only unless neutralized.                             | Laundry Booking                                                      |
| Customer                      | Person or organization receiving goods/services. Customer identity remains KitLuy-controlled.                                                                                     | Use source/freshness/consent rules.                                      | Channel-owned customer truth                                         |
| T1                            | POS Cashier / Intake Terminal. Creates authoritative Laundry Booking and handles price/payment/receipt/tag workflow.                                                              | Canonical Laundry role.                                                  | Generic front counter without role controls                          |
| T2                            | Customer Display Screen paired with T1.                                                                                                                                           | Customer-facing display only.                                            | Scan-In, KDS, production display                                     |
| T3                            | Clean & Ready Scan-In Terminal. Verifies completion and assigns Ready storage.                                                                                                    | No customer release.                                                     | Pickup Scan-Out                                                      |
| T4                            | Customer Pickup Scan-Out Terminal. Verifies collector, handles balance policy, releases custody and completes Booking.                                                            | Only role authorized for final pickup scan-out.                          | Routing final scan-out back to T1                                    |
| Restaurant KDS Client         | Phase 2 kitchen production display and routing client.                                                                                                                            | Separate product/client from Laundry T2.                                 | Calling it T2                                                        |
| Customer Display Screen (CDS) | Customer-facing transaction display. Laundry T2 is a CDS role.                                                                                                                    | Use CDS when generic technical framework is intended.                    | KDS                                                                  |
| Authoritative truth           | The approved source for a fact, scoped by domain and environment.                                                                                                                 | State source, as-of time and freshness.                                  | Demo/estimated/cached/stale as live truth                            |
| Projection                    | Versioned subset of authoritative KitLuy data sent to a Location or channel.                                                                                                      | Projection never transfers ownership.                                    | Replica as independent authority                                     |
| Append-only                   | Finalized records are not destructively edited; corrections use compensating records/events.                                                                                      | Finance/payment/inventory/audit.                                         | Hard update/delete of finalized truth                                |
| OWNER-LOCKED                  | Approved product direction.                                                                                                                                                       | Not implementation evidence.                                             | Implemented                                                          |
| SPECIFIED                     | Buildable target documented.                                                                                                                                                      | Baseline status only.                                                    | Implemented without evidence                                         |
| IMPLEMENTED                   | Prohibited generic label in this control pack; use the explicit evidence status model, e.g. IMPLEMENTED-IN-DEV.                                                                   | Requires evidence.                                                       | Claim from planning docs                                             |

## 3. Canonical product inventory

| Canonical product name                   | Boundary                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| kitluy-b2b-website                       | Public B2B marketing, acquisition, registration, authentication and portal-entry website |
| kitluy-admin-pwa-portal                  | HET internal privileged control plane; short alias `kitluy-admin-portal`                 |
| kitluy-chain-pwa-portal                  | Chain/multi-Store governance PWA; short alias `kitluy-chain-portal`                      |
| kitluy-partner-pwa-portal                | Partner back-office PWA; short alias `kitluy-partner-portal`                             |
| kitluy-partner-app                       | Owner/manager mobile operations cockpit                                                  |
| kitluy-pos-desktop-app                   | Electron fixed-terminal application containing authorized T1-T4 profiles                 |
| kitluy-pos-mobile-app                    | Hub-bound roaming staff mobile application                                               |
| kitluy-storefront                        | Customer-facing Storefront, QR and Telegram access surface                               |
| kitluy-hub-agent / KitLuy Store Hub      | Local edge runtime and managed-device authority                                          |
| Restaurant KDS Client                    | Phase 2 kitchen display client                                                           |
| Restaurant Guest Display / Order-and-Pay | Phase 2 restaurant guest-facing client/surface                                           |
| Optional Kiosk / Self-Checkout Client    | Optional later vertical client; not Phase 1 Laundry default                              |

## 4. Transaction terminology by vertical/surface

| Context                                      | Preferred term                                              | Notes                                                             |
| -------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------- |
| Shared Core                                  | Transaction / Transaction Line                              | Neutral authoritative umbrella                                    |
| Laundry customer, Storefront and Partner App | Booking / Laundry Booking                                   | Do not expose generic Order wording by default                    |
| Laundry dense Partner Portal/report tables   | Laundry Order may be used if the screen defines the mapping | Must not change the authoritative aggregate or mobile terminology |
| eCommerce                                    | Order                                                       | Customer checkout and fulfilment context                          |
| Restaurant                                   | Order, Check or Tab according to exact workflow             | Check/Tab have running-balance and service semantics              |
| Legacy database/API                          | Existing `order` identifiers may remain behind adapters     | New business copy and neutral contracts follow this standard      |

## 5. Casing and identifier rules

- Brand: `KitLuy`.
- Product IDs: lowercase kebab-case, for example `kitluy-partner-app`.
- Database tables/columns: plural `snake_case` under the approved schema convention.
- API routes: versioned and lowercase.
- Event names: versioned, domain-qualified and stable.
- Status/enum values: follow the approved contract; do not create display copy directly from raw enum names.
- UI display text: Khmer and English; use approved terminology adapters.
- Currency codes: `KHR`, `USD`.
- Timezone: `Asia/Phnom_Penh`.

## 6. Naming review checklist

- [ ] Digital Store and Store Location are not conflated.
- [ ] Store is not used ambiguously.
- [ ] Partner replaces Seller.
- [ ] Laundry customer/mobile copy uses Booking.
- [ ] T2 is Customer Display Screen.
- [ ] T3 is Ready Scan-In.
- [ ] T4 is Pickup Scan-Out.
- [ ] KDS is not called T2.
- [ ] Neutral Core names do not embed Laundry-only vocabulary.
- [ ] External channels are described as governed projections/connectors, not authorities.
- [ ] Status words do not imply implementation without evidence.

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/kitluy-glossary-and-naming-standard-v1.0.0.md`.
Preserved bootstrap-era registrations (proposals where they exceed the owner text):

- **Logical terminal-profile identifier strings** (canonical per owner decision
  KLD-2026-07-26-002 Group 2, OWNER-APPROVED 2026-07-27; implemented in
  `verticals/phase1-laundry`): `laundry.t1.intake_cashier`,
  `laundry.t2.customer_display`, `laundry.t3.ready_scan_in`,
  `laundry.t4.pickup_scan_out`.
  The pre-decision snake_case forms (`t1_intake_cashier`, `t2_customer_display`,
  `t3_ready_scan_in`, `t4_pickup_scan_out`) from POS Desktop spec v4.0.0 §13.5
  are REJECTED-BEFORE-IMPLEMENTATION with no alias layer, because no affected
  identifier was deployed. `t2_scan_in` and `t3_scan_out` remain permanently
  retired and are never reusable.
  NOTE: `kitluy-terminal-profile-contract-t1-t4-v1.0.0.md` uses device-profile
  codes (`laundry_front_counter`, `laundry_ready_pickup`, `laundry_t1..t4`)
  and does not restate these logical identifiers — recorded as conflict
  KLREC-2026-07-26-009 (unreconciled; do not rename code silently).
- **Event-name format**: repo contracts enforce `<domain>.<event>.v<major>`
  (POS spec §15.2 style); the owner domain-event registry canonicalizes
  unversioned `<context>.<fact>` names with envelope schema_version and
  demotes `.v1` forms to compatibility aliases — recorded as
  KLREC-2026-07-26-011.
- **Permission keys**: dot-separated lowercase; broad `admin` roles rejected.
  Registry drift `releases.promote.stable` (infra spec §16.5) vs
  `releases.promote_stable` (RBAC registry v1.0.0) — KLREC-2026-07-26-013.
- **Package namespaces**: `@kitluy/*`, `@kitluy-services/*`, `@kitluy-apps/*`,
  `@kitluy-verticals/*`, `@kitluy-future/*`.
- **Cardinality invariants** (RB v4 §3.3) and BB v2 verbatim definitions
  (Activated §7.8, Pilot §8.1, Churn §12.5, Rebuild Test RB §0.6) with
  citations, as registered at bootstrap.
- Partner-facing display rule: **Booking**; display **Pressing** where a
  legacy backend uses `ironing` (RB v4 §5.8).
