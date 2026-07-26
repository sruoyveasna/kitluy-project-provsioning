# KitLuy Seller Portal — Wireframe Feature Enhancement Prompt
## Paste this into the **kitluy-seller-portal_UI UX** chatroom

---

## PURPOSE

This prompt lists **research-driven features (KF-###)** to add to the existing Seller Portal wireframe. All features below are **Phase 2** — the laundry POS is Phase 1 MVP. These are documented now so wireframe planning can begin.

**Applies to:** `kitluy-seller-portal` wireframe (currently v1.3.4, 2,288 lines, 51 routes, 13 groups)

---

## PHASE 2 — FEATURES TO ADD (13 features)

### From Laundry POS Master (Seller Portal surfaces)

| ID | Feature | Priority | Source | Where in Seller Portal |
|---|---|---|---|---|
| KF-006 | Laundry subscription plans + credit wallets | HIGH | R46 | New module: Subscriptions > Plan Builder, Subscriber List, Usage Dashboard. Paid add-on (not base $30). |
| KF-007 | Rewash / QA disposition analytics | MEDIUM | R21 | Analytics > QA tab — rewash rate by service type, staff, time period. Root cause breakdown. |
| KF-010 | Subscription utilization + margin guardrails | MEDIUM | R46 | Subscriptions > Margin Monitor — flag margin-negative subscribers, usage heatmap, cap alerts. |

### From Marketing & Intelligence Master

| ID | Feature | Priority | Source | Where in Seller Portal |
|---|---|---|---|---|
| KF-041 | Consent-safe audience export / activation | CRITICAL | R16, R20 | Marketing > Audiences — define segments, export to Netra for ad targeting. Consent controls. |
| KF-042 | O2O attribution keys + matchback receipts | CRITICAL | R20 | Marketing > Attribution — promo/QR/campaign matchback tying ad spend to walk-ins and sales. |
| KF-043 | Experiment registry + incrementality dashboard | HIGH | R20, R47 | Advertising > Experiments — A/B memory, holdout logic, post-campaign learnings. |
| KF-044 | Content approval + brand-safety workflow | HIGH | R19 | Advertising > Content Studio — merchant approval, revision, version history for AI-generated content. |
| KF-045 | Segment-to-offer orchestration surface | HIGH | R12, R13 | Marketing > Promotions — map Netra segments to automated flows and offers without rebuilding AI logic. |
| KF-046 | Real-time merchant KPI cockpit | HIGH | R47 | Dashboard — operations-grade view: revenue, queue, campaign impact, anomaly banners. Near-real-time best effort. |
| KF-047 | Creative library with reuse + performance memory | MEDIUM | R19, R16 | Advertising > Creative Library — winning creative reusable by channel, language, objective. |
| KF-048 | Promotion guardrails + margin warnings | MEDIUM | R13, R20 | Marketing > Promotions — prevent over-discounting or stacking into unprofitable states. |
| KF-049 | Loyalty-linked growth plays | MEDIUM | R12, R13 | Marketing > Growth — campaigns around status tiers, habit loops, LTV (not one-off discounts). |
| KF-050 | Plain-language AI explanation layer | LOW | R47 | Dashboard / AI panels — show WHY Netra recommends an action, not just the action. |

---

## LOCKED DECISIONS AFFECTING SELLER PORTAL

| Decision | Answer |
|---|---|
| Laundry subscriptions | Commerce = basic plans only; full suite = paid add-on |
| Subscription credits | No refunds, no carry-over, use-it-or-lose-it |
| Attribution identifiers | All five: phone, QR customer ID, promo code, device proximity, redemption links |
| Paid AI campaigns | Always require explicit merchant approval before any launch |
| Dashboard SLA | Near-real-time best effort |
| Labor-rule violations | Warnings in P1; hard blocks later |
| Experiment complexity | PARKED — revisit after merchant testing |

---

## NEW DATABASE TABLES (Seller Portal relevant)

- `kitluy.marketing.subscription_plans`
- `kitluy.customers.subscription_wallets`
- `kitluy.customers.subscription_entitlements`
- `kitluy.marketing.attribution_events`
- `kitluy.marketing.audience_exports`
- `kitluy.marketing.margin_guardrails`
- `kitluy.advertising.creative_versions`
- `kitluy.advertising.experiments`
- `kitluy.advertising.experiment_results`

## NEW EDGE FUNCTIONS (Seller Portal relevant)

- `kitluy-subscription-billing-cycle`
- `kitluy-attribution-ingest`
- `kitluy-audience-export`
- `kitluy-margin-guardrail-check`
- `kitluy-creative-approve`

---

## REMINDERS

- **KitLuy CONSUMES Netra** — Seller Portal displays intelligence, Netra provides it. Never build AI engines inside KitLuy.
- **KitLuy CONSUMES Rotanak** — loyalty data comes from Rotanak APIs. Never rebuild loyalty logic.
- All monetary values: **KHR ៛ integer only**
- File naming: `xxxxx-wireframe-vX.Y.Z.jsx`
- Never rebuild from scratch — targeted `str_replace` edits only
