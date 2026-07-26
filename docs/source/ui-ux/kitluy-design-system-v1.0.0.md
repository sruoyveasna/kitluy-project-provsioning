# KitLuy Shared Design System

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-design-system-v1.0.0.md`                       |
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

## 1. Design principles

1. **Truth before decoration.** Operational and financial data shows source, scope, `as_of`, freshness and completeness. Missing data is never converted into a healthy zero.
2. **Digital Store context is explicit.** Authenticated management surfaces show Tenant, Digital Store, Location and vertical context. A route never silently changes context.
3. **Store Hub authority is visible.** Edge clients distinguish Hub-confirmed, local draft, pending sync, cloud projection and provider-pending states.
4. **Exception first.** Dashboards prioritize blockers, degraded states, approvals, risk and next actions over vanity metrics.
5. **Khmer and English are equal.** Layouts tolerate at least 40% text expansion; customer and staff copy uses approved terminology.
6. **One primary action.** High-frequency and customer flows present one dominant next action and expose secondary actions progressively.
7. **No color-only meaning.** Status always combines text, icon and, where useful, shape or pattern.
8. **Safe sensitive actions.** High-risk actions show effect, scope, environment, reason, approval requirement and immutable audit consequence before execution.
9. **Offline and stale are different.** Offline describes reachability; stale describes age/freshness. A cached value may be both available and stale.
10. **Shared primitives, vertical compositions.** Core components remain neutral; Laundry, Restaurant and later vertical language is supplied by configuration and localization.

## 2. Product surface modes

| Mode              | Products                               | Density                        | Input                                    | Offline expectation                                       |
| ----------------- | -------------------------------------- | ------------------------------ | ---------------------------------------- | --------------------------------------------------------- |
| Public marketing  | B2B website                            | Spacious                       | Touch, keyboard                          | Informational fallback only                               |
| Customer commerce | Storefront, guest order-and-pay, kiosk | Mobile/touch first             | Touch, keyboard, scanner where certified | Session-safe degraded behavior; no false confirmation     |
| Management PWA    | Admin, Chain, Partner Portal           | Dense but readable             | Keyboard, mouse, touch                   | Static shell/status only unless explicitly specified      |
| Owner mobile      | Partner App                            | Card-based, exception first    | Touch                                    | Protected last-known cache; online-only mutations blocked |
| Store operations  | POS Desktop, POS Mobile, KDS           | High contrast, task/scan first | Touch, keyboard, scanner, hardware       | Must operate through Store Hub after provisioning         |
| Customer display  | Laundry T2, Restaurant Guest Display   | Simplified, privacy safe       | Mostly passive, optional touch           | Follows paired operational session                        |

## 3. Canonical UI state model

| State ID    | State                | Required presentation                                                                                        | Prohibited presentation                                                |
| ----------- | -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| `UI-ST-001` | Loading              | Skeleton or progress with accessible name; preserve page structure                                           | Blank white page or indefinite spinner without message                 |
| `UI-ST-002` | Empty                | Valid zero-state message, scope and useful next action                                                       | Error styling or fabricated sample rows                                |
| `UI-ST-003` | Error                | Plain-language cause category, safe consequence, retry/support path and incident/reference ID when available | Raw stack trace, secret, provider credential or opaque error-only code |
| `UI-ST-004` | Stale                | Last-known value, `as_of`, last successful sync and policy consequence                                       | Green/healthy state or silently refreshed timestamp                    |
| `UI-ST-005` | Partial              | Available sections plus explicit list/count of unavailable sources or scopes                                 | Summed totals that imply completeness                                  |
| `UI-ST-006` | Offline              | Hub/WAN distinction, actions that remain safe, queued/pending count                                          | Treating cloud loss as Store closure when Hub remains operational      |
| `UI-ST-007` | Cached               | Cache source, protected-device requirement and refresh state                                                 | Presenting cache as live authority                                     |
| `UI-ST-008` | Pending              | Submitted time, owner/system, next retry/check and cancel rule                                               | Re-submission that can duplicate business effect                       |
| `UI-ST-009` | Conflict             | Competing versions/actors, safe resolution path and preserved history                                        | Generic last-write-wins for money, inventory, custody or queue history |
| `UI-ST-010` | Unauthorized         | Safe reason category and approved request/access path                                                        | Resource existence leakage or hidden backend denial                    |
| `UI-ST-011` | Unavailable          | Required dependency/contract unavailable; explain what remains safe                                          | Converting unavailable to zero or empty                                |
| `UI-ST-012` | Revoked/incompatible | Stop gated work, preserve safe local records and provide recovery path                                       | Bypass, local override or continued sensitive operation                |

Every route must implement the applicable state set and be tested in Khmer and English.

## 4. Application shell contracts

| Shell                | Required regions                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ManagementShell`    | Product navigation, context breadcrumb, vertical badge, freshness/status area, page title, actions, notifications, user/session menu |
| `MobileCockpitShell` | Store/Location context, freshness/offline banner, bottom navigation, protected cache indicator, action sheet region                  |
| `TerminalShell`      | Employee session, terminal profile, Hub status, scan/input focus, business date, peripheral/payment status, profile-safe navigation  |
| `CustomerShell`      | Store/Location identity, language switch, progress, privacy notice, one primary action, help/fallback                                |
| `DisplayShell`       | Paired-session state, privacy reset, large type, reduced controls, no staff-only information                                         |

## 5. Layout and interaction rules

- Use an 8-point spacing system with 4-point micro increments.
- Minimum touch target is 48×48 logical pixels; high-frequency terminal actions prefer 56×56.
- Visible keyboard focus uses a 2-pixel minimum ring with contrast against both component and page background.
- Forms use persistent labels. Placeholders are examples, never labels.
- Validation appears next to the field and in an accessible summary for multi-field submissions.
- Destructive and financial actions never rely on swipe-only or gesture-only interaction.
- Tables expose headers, sort state, row selection count and action context to assistive technology.
- Long-running work is represented as a durable job with queued/running/retrying/failed/completed state.

## 6. Figma governance

| Registry field             | Rule                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------ |
| Figma organization/project | `[REQUIRED: approved Figma organization and project URL]`                                              |
| Design-system file         | `[REQUIRED: KitLuy Design System Figma URL]`                                                           |
| Product files              | One file per canonical application or an approved multi-product file with product pages                |
| Component reference        | Store `file_key`, `node_id`, component name, variant properties and version in the component inventory |
| Screen reference           | Each route inventory row contains `FIG-<APP>-NNN` and a node placeholder until created                 |
| Publication                | Only reviewed library versions may be enabled for production design work                               |
| Change control             | Breaking component/token changes require version, migration notes, affected routes and regression QA   |
| Evidence                   | A URL or node ID alone is not implementation evidence; include review and publication status           |

### Required Figma page structure

```text
00 Cover and status
01 Foundations
02 Tokens
03 Components
04 Patterns
05 States
06 Accessibility
10+ Product screens by application
90 Deprecated
99 Change log
```

## 7. Analytics and privacy

- Event names use `domain.object.action` or `ui.screen_viewed` conventions.
- Every event includes `event_version`, application, route/screen ID, locale, form factor and coarse outcome.
- Never include raw customer name, phone, email, garment evidence, payment token, free-text note or secret.
- Route inventories define expected events, but event schemas remain governed by the analytics/event registry.
- Analytics failure must never block operational work.

## 8. Definition of done for a screen

A screen is design-complete only when it has:

1. Route and stable Screen ID.
2. Feature and permission mapping.
3. Read and mutation contract references.
4. Desktop/tablet/mobile or device-specific responsive behavior.
5. Khmer and English content.
6. Empty, loading, error, stale, partial and offline handling where applicable.
7. Keyboard/touch/screen-reader behavior.
8. Analytics events without sensitive payloads.
9. QA case references.
10. Figma node and reviewed component references.
11. Implementation and visual-regression evidence before `IMPLEMENTED` is claimed.
