# KitLuy Responsive Layout Standard

| Field          | Value                                                  |
| -------------- | ------------------------------------------------------ |
| Filename       | `kitluy-responsive-layout-standard-v1.0.0.md`          |
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

## 1. Breakpoints

| Token | Minimum width | Primary use                        |
| ----- | ------------: | ---------------------------------- |
| `xs`  |        320 px | Small public/mobile web baseline   |
| `sm`  |        480 px | Large phone                        |
| `md`  |        768 px | Tablet/compact desktop             |
| `lg`  |       1024 px | Laptop/management full shell       |
| `xl`  |       1280 px | Wide desktop                       |
| `2xl` |       1536 px | Operations wallboard/large desktop |

Breakpoints are layout thresholds, not device detection. Hardware-profile layouts may use fixed certified resolutions in addition to these tokens.

## 2. Layout classes

| Class            | Rules                                                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marketing        | Mobile first; one column → 2/3/4-column composition; readable copy max 720 px; page max 1280 px                                                               |
| Management       | Full sidebar at `lg`; collapsible at `md`; phone is triage/read-focused unless product spec explicitly allows action                                          |
| Data table       | Preserve critical columns; move secondary detail into row drawer; never hide money/status/freshness without an explicit alternate                             |
| Mobile app       | Safe-area aware; bottom navigation; one primary action; forms may use full-screen steps                                                                       |
| Terminal         | Certified-resolution layout; high-frequency action zones; persistent Hub/profile/session status; no browser-style responsive assumptions that break scan flow |
| Customer display | Large type, low density, privacy-safe; landscape/portrait variants as certified                                                                               |
| Kiosk            | Large targets, fixed progress and help entry; accessibility controls visible from welcome screen                                                              |

## 3. Khmer expansion

- Allow at least 40% horizontal expansion for ordinary labels and 50% for critical customer instructions.
- Never constrain Khmer text with fixed heights that clip combining marks or line height.
- Buttons may wrap to two lines; primary actions retain minimum target size.
- Tables use localized column priority and responsive drawers rather than truncating essential meaning.
- Test the longest approved Khmer translation, not pseudo-Latin expansion alone.

## 4. Responsive component behavior

| Component     | Wide                      | Compact             | Phone/terminal                                                      |
| ------------- | ------------------------- | ------------------- | ------------------------------------------------------------------- |
| Navigation    | Sidebar + labels          | Collapsible sidebar | Bottom nav, drawer or profile launcher                              |
| Record detail | Side drawer               | Full-height drawer  | Full-screen route                                                   |
| Filter bar    | Inline                    | Wrap/overflow menu  | Filter sheet                                                        |
| Data table    | Full columns              | Priority columns    | Cards or horizontally scrollable governed table only when necessary |
| Metric grid   | 4–6 columns               | 2–3 columns         | 1–2 columns                                                         |
| Wizard        | Stepper + panel           | Compact stepper     | One step per screen                                                 |
| Approval      | Side-by-side before/after | Stacked             | Full-screen review; confirm separated from back                     |

## 5. Offline and degraded layout

Offline, stale and partial banners reserve space and do not cover primary actions. A persistent state may collapse to a compact bar only after the user has acknowledged it; critical Hub loss, device revocation or incompatible release remains blocking.

## 6. QA

Every route receives `-RESP` QA coverage at its supported sizes, including 320 CSS pixels for public web, tablet and laptop management widths, certified terminal resolutions and both Khmer/English content. Horizontal scrolling is prohibited except deliberate data/code regions with accessible labeling.
