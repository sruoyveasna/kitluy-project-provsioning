# KitLuy Khmer-English Content Style Guide

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-khmer-english-content-style-guide-v1.0.0.md`   |
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

## 1. Canonical terminology

| Concept                        | English                   | Khmer                                                        | Rule                                                         |
| ------------------------------ | ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| Business operator              | Partner                   | `[REQUIRED: approved Khmer translation]`                     | Never use Seller as a current product term                   |
| Account boundary               | Tenant                    | Internal/technical; `[REQUIRED: approved Khmer admin label]` | Avoid exposing Tenant to customers unless necessary          |
| Digital business control plane | Digital Store             | `[REQUIRED: approved Khmer translation]`                     | Distinct from physical Location                              |
| Physical site                  | Store Location / Location | `[REQUIRED: approved Khmer translation]`                     | Do not collapse into Digital Store                           |
| Laundry transaction            | Booking / Laundry Booking | `[REQUIRED: approved Khmer translation]`                     | Partner App/POS/mobile/customer UI uses Booking              |
| Portal dense report term       | Laundry Order             | `[REQUIRED: approved Khmer translation]`                     | Allowed only where approved in Partner Portal reports/tables |
| Production step                | Pressing                  | `[REQUIRED: approved Khmer translation]`                     | User label; backend may retain `ironing` adapter             |
| T1                             | POS Cashier / Intake      | `[REQUIRED]`                                                 | Customer intake/payment/tag printing                         |
| T2                             | Customer Display Screen   | `[REQUIRED]`                                                 | Never production/KDS                                         |
| T3                             | Clean & Ready Scan-In     | `[REQUIRED]`                                                 | Never pickup release                                         |
| T4                             | Customer Pickup Scan-Out  | `[REQUIRED]`                                                 | Only canonical final pickup profile                          |
| Storefront message             | Scan, Prepare & Queue     | `[REQUIRED: approved Khmer campaign phrase]`                 | Customer-facing Phase 1 message                              |

## 2. Voice and tone

- **Operational:** direct, specific and calm. State what happened, what remains safe and the next action.
- **Customer:** plain language, no internal codes, no false finality for estimates or pending payments.
- **Admin/security:** precise about scope, environment, approval and audit; do not expose secrets or sensitive policy internals.
- **Errors:** use cause category + consequence + recovery. Avoid blame and vague “Something went wrong” when a safe category is known.
- **AI:** identify that content is AI-generated, show sources/time and state limitations; never present AI as authoritative finance, compliance or safety truth.

## 3. Action labels

Use verb + object + outcome:

- `Send to T1 for Review`
- `Prepare for T4`
- `Hand Off to T4`
- `Retry with Store Hub`
- `Request Approval`
- `Publish Configuration`
- `Roll Back Release`
- `Download Export`

Avoid generic `Submit`, `Process`, `Done`, `Complete` or `OK` when the business effect can be named.

## 4. Status and truth language

| State                      | Preferred pattern                                                                        |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Stale                      | `Last updated {time}. Newer Store activity may not be included.`                         |
| Partial                    | `{count} Locations are not included in this result.`                                     |
| Offline with Hub available | `Internet is unavailable. Store operations continue through Store Hub.`                  |
| Hub unavailable            | `Store Hub cannot be reached. New operational actions are paused on this device.`        |
| Pending payment            | `Payment confirmation is pending. Do not collect or release based on this screen alone.` |
| Empty                      | `No {records} in this scope.` plus a relevant next action                                |
| Unauthorized               | `You do not have permission for this action.` plus access-request path when approved     |

## 5. Khmer writing and review

- Khmer is authored or reviewed by a qualified human before pilot; machine output alone is not approval.
- Preserve numbers, currency and identifiers using the approved locale convention; do not transliterate IDs.
- Avoid line breaking that separates currency symbol from amount or number from unit.
- UI labels should be concise, but never remove safety meaning to fit.
- Product names may remain Latin where the owner has not approved a Khmer brand rendering.
- Maintain a terminology decision log for every disputed translation.

## 6. Localization key writing

Keys are semantic and stable: `product.area.object.action_or_label`. Do not include English copy in keys. Interpolation uses named variables, for example `state.stale.message` with `{asOf}`. Plural/select behavior must be implemented through the localization framework, not string concatenation.

## 7. Content QA

Every release checks terminology, Khmer overflow, English clarity, placeholders/interpolation, missing keys, fallback behavior, sensitive-data redaction, date/money units and customer/staff boundary language.
