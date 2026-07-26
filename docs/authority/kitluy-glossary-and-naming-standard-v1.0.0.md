# KitLuy Glossary and Naming Standard — v1.0.0

Created at bootstrap, 2026-07-26, from RB v4 §3.2–3.3 and BB v2 definitions
(quoted verbatim where short). The canonical file of this name was cited but
missing; found-original-wins if it surfaces.

## Canonical terms

| Term                                | Definition (source)                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tenant**                          | "Backend organization and data-isolation boundary." (RB §3.2)                                                                                                                                    |
| **Partner Account**                 | "Business-facing account operated by a merchant/business." (RB §3.2)                                                                                                                             |
| **Digital Store**                   | "The authoritative business/store control plane with one primary vertical. It can exist without a physical Location." (RB §3.2)                                                                  |
| **Store Location**                  | "A physical operating site attached to one Digital Store" — an offline-capable edge execution environment. (RB §3.2, §1.3.6)                                                                     |
| **Store Hub**                       | "HET-managed local edge appliance and operational authority for one Location." (RB §3.2)                                                                                                         |
| **Chain**                           | "An authorized relationship across participating Digital Stores/Locations; not a second operational source of truth." (RB §3.3)                                                                  |
| **Channel**                         | "Governed digital sales or integration surface. Never the source of truth." (RB §3.2)                                                                                                            |
| **Transaction**                     | "Neutral Core aggregate covering a vertical-specific Booking, order, check, sale or other commercial document." (RB §3.2)                                                                        |
| **Booking**                         | "Phase 1 Laundry business-facing transaction term." Partner Portal may use "Laundry Order" in dense tables only where the spec explicitly permits. (RB §3.2, §5.8)                               |
| **Pre-Intake Draft / Queue Ticket** | Storefront artifacts; "not finalized Bookings, prices, weights, garment counts or payment records. T1 must verify the customer and physical items." (RB §4.4)                                    |
| **T1**                              | POS Cashier / Intake — intake, Booking creation, pricing, deposits/payments, receipt/tag printing. (RB §0.1)                                                                                     |
| **T2**                              | Customer Display Screen — customer-facing Booking mirror, totals, KHQR/payment state, receipt choice, pickup reference. Not a production terminal, KDS, or payment-truth source. (RB §0.1, §5.3) |
| **T3**                              | Clean & Ready Scan-In — quality/count verification, packaging, Ready storage assignment, custody scan-in. Never releases garments. (RB §0.1, §5.4)                                               |
| **T4**                              | Customer Pickup Scan-Out — collector verification, balance control, custody release, Booking completion. The only profile that completes pickup. (RB §0.1, §5.5)                                 |
| **Activated**                       | A Store/Digital Store is Activated only when the go-live checklist passes and the first approved transaction is completed and visible in authoritative systems. (BB §7.8)                        |
| **Pilot**                           | "A controlled commercial and operational experiment" — not indefinite free use. (BB §8.1)                                                                                                        |
| **Churn**                           | Recorded when the recurring commercial relationship ends under approved billing policy; suspension/pause is not churn. (BB §12.5)                                                                |
| **Rebuild Test**                    | A phase passes only when one qualified engineer can reconstruct and operate it from the registered artifacts. (RB §0.6)                                                                          |

## Naming rules

- `Seller` is retired — use **Partner**. Portal aliases: `kitluy-admin-portal`
  → `kitluy-admin-pwa-portal`, `kitluy-chain-portal` → `kitluy-chain-pwa-portal`,
  `kitluy-partner-portal` → `kitluy-partner-pwa-portal`. (RB §4.1)
- Unqualified `Store` is allowed only in human-facing prose; schema, API and
  event contracts must use `digital_store` or `store_location` explicitly. (RB §3.2)
- Partner-facing Laundry term is **Booking**; display **Pressing** where a
  legacy backend may use `ironing`. (RB §5.8)
- Terminal profile identifiers: `t1_intake_cashier`, `t2_customer_display`,
  `t3_ready_scan_in`, `t4_pickup_scan_out`. Legacy `t2_scan_in`/`t3_scan_out`
  are permanently retired. (POS spec §13.5)
- Event names are versioned `<domain>.<event>.v<major>` (POS spec §15.2 style).
- Permission keys are dot-separated lowercase (e.g. `releases.promote.stable`);
  broad `admin` roles are rejected. (infra spec §16.5; RB App. B)
- Package namespaces in this repo: `@kitluy/*` (shared), `@kitluy-services/*`,
  `@kitluy-apps/*`, `@kitluy-verticals/*`, `@kitluy-future/*`.

## Cardinality invariants (RB §3.3)

Tenant 1—N Digital Stores · Digital Store exactly 1 primary vertical ·
Store Location belongs to exactly 1 Digital Store · Store Hub assigned to
exactly 1 active Location · terminal assigned to 1 Location + 1 approved
device profile · every effective user action is evaluated against Tenant,
Digital Store, Location, permission, environment and device context.
