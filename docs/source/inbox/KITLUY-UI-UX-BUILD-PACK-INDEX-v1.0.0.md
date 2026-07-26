# KitLuy UI/UX Build Pack Index

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `KITLUY-UI-UX-BUILD-PACK-INDEX-v1.0.0.md`              |
| Version        | `v1.0.0`                                               |
| Date           | 2026-07-26                                             |
| Owner          | HET / KitLuy Suite Project Owner                       |
| Status         | Canonical target standard; not implementation evidence |
| Primary market | Cambodia                                               |
| Languages      | Khmer (`km-KH`) and English (`en-KH`)                  |
| Currencies     | KHR and USD                                            |
| Timezone       | `Asia/Phnom_Penh`                                      |

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

## Pack contents

|   # | File                                                                             | Purpose                                                                                                   |
| --: | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
|   1 | `kitluy-design-system-v1.0.0.md`                                                 | Shared principles, shells, states, Figma governance and screen definition of done                         |
|   2 | `kitluy-design-token-registry-v1.0.0.json`                                       | Machine-readable token registry with provisional brand values                                             |
|   3 | `kitluy-component-inventory-v1.0.0.md`                                           | Shared component IDs, responsibilities, variants and Figma/code references                                |
|   4 | `kitluy-accessibility-standard-v1.0.0.md`                                        | WCAG 2.2 AA target and product-specific accessibility requirements                                        |
|   5 | `kitluy-responsive-layout-standard-v1.0.0.md`                                    | Breakpoints, product layout classes and Khmer expansion rules                                             |
|   6 | `kitluy-khmer-english-content-style-guide-v1.0.0.md`                             | Canonical terminology, action labels, truth language and translation review                               |
|   7 | `kitluy-localization-key-registry-v1.0.0.md`                                     | Localization namespace, record schema, seed keys and CI gates                                             |
|   8 | `kitluy-date-time-money-formatting-standard-v1.0.0.md`                           | Cambodia date/time, KHR/USD and freshness formatting                                                      |
|   9 | `kitluy-b2b-website-route-screen-inventory-v1.0.0.md`                            | KitLuy B2B Website Route and Screen Inventory; Phase 1 canonical                                          |
|  10 | `kitluy-admin-pwa-portal-route-screen-inventory-v1.0.0.md`                       | KitLuy Admin PWA Portal Route and Screen Inventory; Phase 1 canonical                                     |
|  11 | `kitluy-chain-pwa-portal-route-screen-inventory-v1.0.0.md`                       | KitLuy Chain PWA Portal Route and Screen Inventory; Phase 1 canonical                                     |
|  12 | `kitluy-partner-pwa-portal-route-screen-inventory-v1.0.0.md`                     | KitLuy Partner PWA Portal Route and Screen Inventory; Phase 1 canonical                                   |
|  13 | `kitluy-partner-app-route-screen-inventory-v1.0.0.md`                            | KitLuy Partner App Route and Screen Inventory; Phase 1 canonical                                          |
|  14 | `kitluy-pos-desktop-app-route-screen-inventory-v1.0.0.md`                        | KitLuy POS Desktop App Route and Screen Inventory; Phase 1 canonical T1-T4                                |
|  15 | `kitluy-pos-mobile-app-route-screen-inventory-v1.0.0.md`                         | KitLuy POS Mobile App Route and Screen Inventory; Phase 1 canonical                                       |
|  16 | `kitluy-storefront-route-screen-inventory-v1.0.0.md`                             | KitLuy Storefront Route and Screen Inventory; Phase 1 Laundry canonical                                   |
|  17 | `kitluy-restaurant-kds-client-route-screen-inventory-v1.0.0.md`                  | KitLuy Restaurant KDS Client Route and Screen Inventory; Phase 2 preliminary / gated                      |
|  18 | `kitluy-restaurant-guest-display-order-and-pay-route-screen-inventory-v1.0.0.md` | KitLuy Restaurant Guest Display and Order-and-Pay Route and Screen Inventory; Phase 2 preliminary / gated |
|  19 | `kitluy-kiosk-self-checkout-client-route-screen-inventory-v1.0.0.md`             | KitLuy Kiosk and Self-Checkout Client Route and Screen Inventory; Phase 4+ preliminary / gated            |

## Canonical application coverage

| Application                              | Phase                                         | Inventory status             |
| ---------------------------------------- | --------------------------------------------- | ---------------------------- |
| `kitluy-b2b-website`                     | Phase 1                                       | Phase 1 canonical            |
| `kitluy-admin-pwa-portal`                | Phase 1                                       | Phase 1 canonical            |
| `kitluy-chain-pwa-portal`                | Phase 1                                       | Phase 1 canonical            |
| `kitluy-partner-pwa-portal`              | Phase 1                                       | Phase 1 canonical            |
| `kitluy-partner-app`                     | Phase 1                                       | Phase 1 canonical            |
| `kitluy-pos-desktop-app`                 | Phase 1                                       | Phase 1 canonical T1-T4      |
| `kitluy-pos-mobile-app`                  | Phase 1                                       | Phase 1 canonical            |
| `kitluy-storefront`                      | Phase 1 Laundry / Phase 3 commerce foundation | Phase 1 Laundry canonical    |
| `restaurant-kds-client`                  | Phase 2                                       | Phase 2 preliminary / gated  |
| `restaurant-guest-display-order-and-pay` | Phase 2                                       | Phase 2 preliminary / gated  |
| `kiosk-self-checkout-client`             | Phase 4+ optional                             | Phase 4+ preliminary / gated |

## Open required values

1. `[REQUIRED: KitLuy Design System Figma URL and file_key]`.
2. `[REQUIRED: one approved product Figma file/page and node mapping per application]`.
3. `[REQUIRED: owner-approved brand colors, typography and logo-use rules]`.
4. `[REQUIRED: approved Khmer translations and linguist/product reviewers]`.
5. `[REQUIRED: exact RBAC permission registry reconciliation]`.
6. `[REQUIRED: exact OpenAPI/JSON Schema operation IDs and read-model versions]`.
7. `[REQUIRED: approved analytics event schema and retention/privacy policy]`.
8. `[REQUIRED: approved browser, OS, device and assistive-technology matrix]`.
9. `[REQUIRED: Phase 2 KDS and Guest product specifications]`.
10. `[REQUIRED: later-vertical kiosk/self-checkout product specification and entitlement]`.

## Source baseline

- Current KitLuy Project Instructions (owner authority)
- `KitLuy Suite Products.txt`
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`
- `kitluy-chain-portal-phase1-spec-v3.0.0.md`
- `kitluy-partner-portal-phase1-spec-v2.0.0.md`
- `kitluy-partner-app-phase1-spec-v2.0.0.md`
- `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md`
- `kitluy-pos-mobile-app-phase1-spec-v2.2.0.md`
- `kitluy-storefront-phase1-spec-v1.1.0.md`
- `kitluy-b2b-website-phase1-spec-v1.0.0.md`
- `kitluy-storehub-phase1-spec-v1.0.0.md`
- `kitluy-master-feature-registry-v0.2.md/.json`
