# KitLuy Kiosk and Self-Checkout Client Route and Screen Inventory

| Field          | Value                                                                                  |
| -------------- | -------------------------------------------------------------------------------------- |
| Filename       | `kitluy-kiosk-self-checkout-client-route-screen-inventory-v1.0.0.md`                   |
| Version        | `v1.0.0`                                                                               |
| Date           | 2026-07-26                                                                             |
| Owner          | HET / KitLuy Suite Project Owner                                                       |
| Status         | Preliminary phase-gated route contract; not an approved detailed product specification |
| Primary market | Cambodia                                                                               |
| Languages      | Khmer (`km-KH`) and English (`en-KH`)                                                  |
| Currencies     | KHR and USD                                                                            |
| Timezone       | `Asia/Phnom_Penh`                                                                      |

> **Evidence rule:** This artifact defines a build contract. It is not evidence that Figma files, components, routes, code, migrations, tests or deployments exist. Every missing owner, brand, provider or production value is marked `[REQUIRED: ...]`.

## Authority and scope

Authority order:

1. Current owner decisions and KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. Current approved KitLuy Rebuild, Business and product specifications.
4. This UI/UX build-pack artifact after approval.
5. Approved handoffs and evidence-based analyses.
6. Competitor rebuild documents as design references only.

The shared design system is neutral. Laundry terminology belongs only in Laundry-specific compositions and must not be hardcoded into Core components.

## Phase gate

This inventory exists to prevent the application from being omitted from the shared UI/UX pack. It does **not** approve the detailed workflow, schema, state machine, permissions or API contracts. All routes remain hidden and disabled until the Phase product specification, vertical delta, permissions, offline behavior, hardware profile, QA matrix and owner approval exist.

## Figma file registry

| Field                 | Value                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------- |
| Product Figma URL     | `[REQUIRED: KitLuy Kiosk and Self-Checkout Client Route and Screen Inventory Figma URL]` |
| Figma file key        | `[REQUIRED: file_key]`                                                                   |
| Design-system library | `[REQUIRED: KitLuy Design System Figma URL]`                                             |
| Screen page           | `[REQUIRED: page node-id]`                                                               |
| Review status         | Not supplied; do not claim Designed/Approved                                             |

## Mapping conventions

- `KLUI-KIOSK-NNN` is a stable UI-pack traceability ID, not a replacement for `KLMF-*` or product feature IDs.
- Permission names are contract requirements; exact registry keys must be reconciled with the canonical RBAC permission registry.
- Data-contract names are families until exact OpenAPI/JSON Schema operation IDs are published.
- Every route implements the canonical state model and must not present stale, partial, cached or unavailable data as authoritative.
- Analytics events never include raw PII, free text, payment tokens or secrets.

## Route and screen inventory

| Route              | Screen ID       | Screen               | Feature IDs      | Permission                 | Data contracts                                                                                      | Mutations                                                                        | Components                                                                                    | States                                                                                                                     | Localization keys                                                 | Analytics events                                                                               | QA cases                                                 | Figma reference                         |
| ------------------ | --------------- | -------------------- | ---------------- | -------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------- |
| `/welcome`         | `KIOSK-SCR-001` | Welcome              | `KLUI-KIOSK-001` | `public`                   | Commerce Store/customer-session read contract `kiosk.welcome`; `[REQUIRED: schema/version]`         | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.welcome.*`; shared `state.*`, `action.*`, `a11y.*`         | `ui.screen_viewed` (`screen=kiosk.welcome`); `ui.primary_action` when used; no raw PII         | `QA-KIOSK-001-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-001` / `[REQUIRED: node-id]` |
| `/accessibility`   | `KIOSK-SCR-002` | Accessibility        | `KLUI-KIOSK-002` | `kiosk.accessibility.read` | Commerce Store/customer-session read contract `kiosk.accessibility`; `[REQUIRED: schema/version]`   | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.accessibility.*`; shared `state.*`, `action.*`, `a11y.*`   | `ui.screen_viewed` (`screen=kiosk.accessibility`); `ui.primary_action` when used; no raw PII   | `QA-KIOSK-002-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-002` / `[REQUIRED: node-id]` |
| `/catalog`         | `KIOSK-SCR-003` | Catalog              | `KLUI-KIOSK-003` | `public`                   | Commerce Store/customer-session read contract `kiosk.catalog`; `[REQUIRED: schema/version]`         | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.catalog.*`; shared `state.*`, `action.*`, `a11y.*`         | `ui.screen_viewed` (`screen=kiosk.catalog`); `ui.primary_action` when used; no raw PII         | `QA-KIOSK-003-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-003` / `[REQUIRED: node-id]` |
| `/item/:itemId`    | `KIOSK-SCR-004` | Item / Item detail   | `KLUI-KIOSK-004` | `public`                   | Commerce Store/customer-session read contract `kiosk.item.detail`; `[REQUIRED: schema/version]`     | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.item.detail.*`; shared `state.*`, `action.*`, `a11y.*`     | `ui.screen_viewed` (`screen=kiosk.item_detail`); `ui.primary_action` when used; no raw PII     | `QA-KIOSK-004-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-004` / `[REQUIRED: node-id]` |
| `/cart`            | `KIOSK-SCR-005` | Cart                 | `KLUI-KIOSK-005` | `customer.cart.own`        | Commerce Store/customer-session read contract `kiosk.cart`; `[REQUIRED: schema/version]`            | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.cart.*`; shared `state.*`, `action.*`, `a11y.*`            | `ui.screen_viewed` (`screen=kiosk.cart`); `ui.primary_action` when used; no raw PII            | `QA-KIOSK-005-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-005` / `[REQUIRED: node-id]` |
| `/checkout`        | `KIOSK-SCR-006` | Checkout             | `KLUI-KIOSK-006` | `customer.checkout.own`    | Commerce Store/customer-session read contract `kiosk.checkout`; `[REQUIRED: schema/version]`        | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.checkout.*`; shared `state.*`, `action.*`, `a11y.*`        | `ui.screen_viewed` (`screen=kiosk.checkout`); `ui.primary_action` when used; no raw PII        | `QA-KIOSK-006-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-006` / `[REQUIRED: node-id]` |
| `/payment`         | `KIOSK-SCR-007` | Payment              | `KLUI-KIOSK-007` | `customer.payment.own`     | Commerce Store/customer-session read contract `kiosk.payment`; `[REQUIRED: schema/version]`         | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.payment.*`; shared `state.*`, `action.*`, `a11y.*`         | `ui.screen_viewed` (`screen=kiosk.payment`); `ui.primary_action` when used; no raw PII         | `QA-KIOSK-007-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-007` / `[REQUIRED: node-id]` |
| `/payment/pending` | `KIOSK-SCR-008` | Payment / Pending    | `KLUI-KIOSK-008` | `customer.payment.own`     | Commerce Store/customer-session read contract `kiosk.payment.pending`; `[REQUIRED: schema/version]` | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.payment.pending.*`; shared `state.*`, `action.*`, `a11y.*` | `ui.screen_viewed` (`screen=kiosk.payment_pending`); `ui.primary_action` when used; no raw PII | `QA-KIOSK-008-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-008` / `[REQUIRED: node-id]` |
| `/receipt`         | `KIOSK-SCR-009` | Receipt              | `KLUI-KIOSK-009` | `customer.receipt.own`     | Commerce Store/customer-session read contract `kiosk.receipt`; `[REQUIRED: schema/version]`         | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.receipt.*`; shared `state.*`, `action.*`, `a11y.*`         | `ui.screen_viewed` (`screen=kiosk.receipt`); `ui.primary_action` when used; no raw PII         | `QA-KIOSK-009-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-009` / `[REQUIRED: node-id]` |
| `/order/:orderId`  | `KIOSK-SCR-010` | Order / Order detail | `KLUI-KIOSK-010` | `kiosk.order.read`         | Commerce Store/customer-session read contract `kiosk.order.detail`; `[REQUIRED: schema/version]`    | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.order.detail.*`; shared `state.*`, `action.*`, `a11y.*`    | `ui.screen_viewed` (`screen=kiosk.order_detail`); `ui.primary_action` when used; no raw PII    | `QA-KIOSK-010-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-010` / `[REQUIRED: node-id]` |
| `/help`            | `KIOSK-SCR-011` | Help                 | `KLUI-KIOSK-011` | `public`                   | Commerce Store/customer-session read contract `kiosk.help`; `[REQUIRED: schema/version]`            | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.help.*`; shared `state.*`, `action.*`, `a11y.*`            | `ui.screen_viewed` (`screen=kiosk.help`); `ui.primary_action` when used; no raw PII            | `QA-KIOSK-011-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-011` / `[REQUIRED: node-id]` |
| `/status`          | `KIOSK-SCR-012` | Status               | `KLUI-KIOSK-012` | `device.health.read`       | Commerce Store/customer-session read contract `kiosk.status`; `[REQUIRED: schema/version]`          | Phase-gated domain command; `[REQUIRED: approved API operationId/state machine]` | KioskShell; LargeActionGrid; CartSummary; PaymentStatus; AccessibilityControls; StateBoundary | loading, empty, error, stale, partial, offline, unauthorized, unavailable, expired-session, provider-pending, rate-limited | `kiosk.status.*`; shared `state.*`, `action.*`, `a11y.*`          | `ui.screen_viewed` (`screen=kiosk.status`); `ui.primary_action` when used; no raw PII          | `QA-KIOSK-012-AUTH`, `-STATE`, `-A11Y`, `-L10N`, `-RESP` | `FIG-KIOSK-012` / `[REQUIRED: node-id]` |

## Required common QA bundles

| Suffix   | Minimum verification                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| `-AUTH`  | Authentication, permission, resource scope, context mismatch, deep-link and negative-access tests           |
| `-STATE` | Loading, valid empty, error, stale, partial, offline, unavailable and route-specific conflict/pending tests |
| `-A11Y`  | Keyboard/touch, focus, labels, announcements, contrast, text size and reduced motion                        |
| `-L10N`  | Khmer/English completeness, text expansion, terminology, formatting and missing-key behavior                |
| `-RESP`  | Supported breakpoints or certified device resolutions, orientation and safe-area behavior                   |

## Completion evidence

A route can be marked `IMPLEMENTED` only with repository path, component exports, contract tests, permission/RLS tests, visual/accessibility tests, Figma/code reconciliation, deployment evidence and the applicable phase/pilot gate.
