# KitLuy Localization Key Registry

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-localization-key-registry-v1.0.0.md`           |
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

## 1. Registry convention

```text
<application_or_shared>.<area>.<object>.<label|action|state|message|help>
```

- Lowercase dot notation.
- Keys are immutable after production use. Deprecate; do not repurpose.
- Both `km-KH` and `en-KH` are required for a key to be release-ready.
- Product route inventories reserve namespaces. Exact screen copy is populated during design/content review.
- Runtime fallback is `requested locale → approved application fallback → en-KH`. Missing Khmer is visible in QA and must not silently pass pilot.

## 2. Shared namespaces

| Namespace             | Purpose                         | Example keys                                                                         |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------ |
| `shared.action.*`     | Common actions                  | `shared.action.retry`, `shared.action.cancel`, `shared.action.requestApproval`       |
| `shared.state.*`      | Canonical UI states             | `shared.state.loading`, `shared.state.stale.message`, `shared.state.partial.message` |
| `shared.a11y.*`       | Accessible labels/announcements | `shared.a11y.opensDialog`, `shared.a11y.statusChanged`                               |
| `shared.money.*`      | Money labels                    | `shared.money.gross`, `shared.money.paid`, `shared.money.balance`                    |
| `shared.time.*`       | Time/freshness                  | `shared.time.asOf`, `shared.time.lastSynced`, `shared.time.businessDate`             |
| `shared.permission.*` | Authorization                   | `shared.permission.denied`, `shared.permission.requestAccess`                        |
| `shared.offline.*`    | Edge/WAN states                 | `shared.offline.hubAvailable`, `shared.offline.hubUnavailable`                       |
| `shared.error.*`      | Safe error categories           | `shared.error.unavailable`, `shared.error.conflict`, `shared.error.rateLimited`      |

## 3. Application namespaces

| Application         | Reserved root       | Required cross-cutting subkeys                                                  |
| ------------------- | ------------------- | ------------------------------------------------------------------------------- |
| B2B website         | `b2b.*`             | `nav`, `auth`, `onboarding`, `marketing`, `status`, `footer`                    |
| Admin               | `admin.*`           | `scope`, `approval`, `audit`, `device`, `release`, `support`, `rbac`            |
| Chain               | `chain.*`           | `compare`, `catalog`, `publication`, `availability`, `standards`, `compliance`  |
| Partner Portal      | `partnerPortal.*`   | `setup`, `operations`, `customer`, `inventory`, `finance`, `technology`         |
| Partner App         | `partnerApp.*`      | `today`, `attention`, `booking`, `finance`, `health`, `cache`                   |
| POS Desktop         | `posDesktop.*`      | `shared`, `t1`, `t2`, `t3`, `t4`, `hardware`, `approval`                        |
| POS Mobile          | `posMobile.*`       | `provisioning`, `scan`, `intake`, `booking`, `pickup`, `diagnostics`            |
| Storefront          | `storefront.*`      | `store`, `location`, `service`, `preIntake`, `queue`, `confirmation`, `booking` |
| Restaurant KDS      | `restaurantKds.*`   | preliminary; `[REQUIRED: Phase 2 content approval]`                             |
| Guest order-and-pay | `restaurantGuest.*` | preliminary; `[REQUIRED: Phase 2 content approval]`                             |
| Kiosk/self-checkout | `kiosk.*`           | preliminary; `[REQUIRED: vertical content approval]`                            |

## 4. Required key records

Each localization source record must contain:

| Field                      | Rule                                                    |
| -------------------------- | ------------------------------------------------------- |
| `key`                      | Stable unique key                                       |
| `locale`                   | `km-KH` or `en-KH`                                      |
| `value`                    | Approved translation with named placeholders            |
| `description`              | Context and business meaning                            |
| `screen_ids`               | Consuming Screen IDs                                    |
| `sensitivity`              | public / staff / financial / security / privacy         |
| `owner`                    | Product/content owner                                   |
| `review_status`            | draft / linguist-reviewed / product-approved / released |
| `version`                  | Increment on meaning change                             |
| `deprecated_by`            | Replacement key when applicable                         |
| `figma_text_style_or_node` | `[REQUIRED: node-id]` when screen design exists         |

## 5. Seed key catalog

| Key                                  | English seed                                                          | Khmer                        | Status |
| ------------------------------------ | --------------------------------------------------------------------- | ---------------------------- | ------ |
| `shared.state.loading`               | Loading                                                               | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.state.empty`                 | No records in this scope                                              | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.state.stale.message`         | Last updated {asOf}. Newer activity may not be included.              | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.state.partial.message`       | Some sources are unavailable. Included scope: {includedScope}.        | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.offline.hubAvailable`        | Internet is unavailable. Store operations continue through Store Hub. | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.offline.hubUnavailable`      | Store Hub cannot be reached. New operational actions are paused.      | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.action.retry`                | Retry                                                                 | `[REQUIRED: approved Khmer]` | Draft  |
| `shared.action.requestApproval`      | Request approval                                                      | `[REQUIRED: approved Khmer]` | Draft  |
| `posDesktop.t1.action.createBooking` | Create Laundry Booking                                                | `[REQUIRED: approved Khmer]` | Draft  |
| `posDesktop.t3.action.markReady`     | Complete Ready Scan-In                                                | `[REQUIRED: approved Khmer]` | Draft  |
| `posDesktop.t4.action.release`       | Confirm Pickup Scan-Out                                               | `[REQUIRED: approved Khmer]` | Draft  |
| `storefront.preIntake.title`         | Prepare Laundry Intake                                                | `[REQUIRED: approved Khmer]` | Draft  |
| `storefront.queue.called`            | It is your turn                                                       | `[REQUIRED: approved Khmer]` | Draft  |

## 6. CI and QA gates

Builds fail for duplicate keys, invalid placeholders, missing required locale values on release-scoped keys, unused deprecated keys after removal date, or route inventory namespaces without registered ownership. Screenshots/visual tests cover the longest Khmer strings.
