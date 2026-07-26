# KitLuy Accessibility Standard

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-accessibility-standard-v1.0.0.md`              |
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

## 1. Compliance target

- Target **WCAG 2.2 AA** for web/PWA and applicable mobile/desktop interfaces.
- Native and Electron clients apply the same principles using platform accessibility APIs.
- A route is not release-ready until keyboard/touch, screen-reader, contrast, zoom/text-size, reduced-motion and state-announcement tests pass on the approved matrix.
- Exact approved browser, OS, device and assistive-technology matrix: `[REQUIRED: accessibility test matrix]`.

## 2. Non-negotiable requirements

| Area         | Standard                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Keyboard     | Every action reachable without pointer; logical order; no keyboard trap; skip links in management/public shells        |
| Focus        | Visible focus at all times; focus moves to dialog/error summary/new content intentionally; returns on close            |
| Touch        | 48×48 logical-pixel minimum target; 56×56 preferred for scan/high-frequency actions                                    |
| Contrast     | Text and UI components meet AA; status tokens verified in light/dark/high-contrast variants before release             |
| Color        | Never the only carrier of status, selection, severity, payment or freshness                                            |
| Text         | 200% zoom for web without loss; native dynamic text where supported; Khmer line height tested                          |
| Forms        | Persistent labels, explicit required/optional, field error association, accessible summary, no placeholder-only fields |
| Tables       | Headers, captions where needed, sort state, selection state, row action context and keyboard interaction               |
| Async        | Loading, job, queue and status changes announced without stealing focus unnecessarily                                  |
| Motion       | Reduced-motion preference removes nonessential animation; no flashing content                                          |
| Media        | Captions/transcripts; meaningful alt text; decorative images hidden from accessibility tree                            |
| Scanning     | Camera/QR/scanner is never the only route; provide manual code entry or staff-assisted path                            |
| Audio/haptic | Never the only confirmation; visible equivalent required                                                               |
| Privacy      | Screen readers and displays must not announce or expose more customer data than the active permission/session allows   |

## 3. Product-specific rules

### Management PWAs

- Dense tables must provide a card/list alternative only when the table cannot remain usable at target width.
- Approval dialogs state action, target, scope, environment, effect and audit consequence before the confirm control.
- Status dashboards provide text equivalents for charts and do not require chart interaction to obtain values.

### Store operations

- Scan success, duplicate, wrong Store, wrong status and hardware failure use different text, icon and optional sound/haptic patterns.
- Critical actions do not depend on double-click, long press or swipe.
- T2/customer displays use larger typography and plain language, with privacy reset and accessible timeout extension.

### Mobile

- Bottom navigation labels remain visible or have accessible names.
- Screen-reader order follows visual task order.
- Camera permission denial has an in-app recovery explanation and manual path.

## 4. Test evidence

Each route references `-A11Y` QA cases. Minimum evidence:

1. Automated semantic/lint scan.
2. Keyboard-only test.
3. Screen-reader smoke test in Khmer and English.
4. Contrast/token test.
5. 200% zoom or largest supported text-size test.
6. Reduced-motion test.
7. Error, loading, stale, partial and offline announcement test.
8. Device-specific scan/haptic/audio equivalence test where applicable.

Accessibility exceptions require an owner, severity, affected users, workaround, remediation version and expiry; indefinite exceptions are prohibited.
