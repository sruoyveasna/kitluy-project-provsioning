# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                     |
| ------------------ | -------------------------------------------------------- |
| Task ID            | `KL-PT-PORTAL-UI-001`                                    |
| Task title         | Admin + Partner PWA portal console redesign             |
| Product/build      | KitLuy Suite — Admin PWA Portal, Partner PWA Portal      |
| Primary agent      | Claude (Fable 5.1)                                       |
| Status             | `HANDOFF_READY`                                          |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`             |
| Worktree           | `repos/het-kitluy-project` (canonical monorepo)          |
| Base commit        | `0a30a74`                                                |
| Final commit       | `UNCOMMITTED`                                            |
| Handoff date       | `2026-09-04`                                             |
| Requested reviewer | Owner (Veasna)                                           |

## 1. Outcome

Both PWA portals now share one professional console design: a deep-slate **left
sidebar** (brand, navigation, account), a sticky top bar with **language and
theme toggles**, and a card-based content area. The palette is **refined
enterprise blue** and the whole surface is **light + dark**, following the
viewer's OS theme with an in-app toggle that persists to `localStorage`. The
design was previewed and approved by the owner before implementation.

No data-honesty behaviour changed. Every test hook (`aria-label`, `role`,
`data-*`, visible text) is preserved, so all portal test suites pass unchanged
in count: **Admin 107/107**, **Partner 56/56**. Both apps build.

The theming is token-driven: `@kitluy/web-ui` `kitluyTokens` values now resolve
to `var(--kl-*)` CSS variables, so pre-existing inline styles became
theme-aware for free; new surfaces use shared `kl-*` classes.

## 2. Source-of-truth checked

| Source                | Version | Section/path                | Result   |
| --------------------- | ------- | --------------------------- | -------- |
| Owner design decision | 2026-09-03 (AskUserQuestion) | Left sidebar / Refined enterprise blue / Light + dark | aligned |
| RB v4.0.0             | v4.0.0  | §9.7 data-surface states    | preserved (`DataSurface` unchanged) |
| CLAUDE.md hard rules  | current | rule 7 (frontend visibility ≠ authorization) | preserved (nav gating is presentation only; API re-decides) |

## 3. Files inspected

- `packages/web-ui/src/index.tsx`
- `apps/kitluy-admin-pwa-portal/src/{App.tsx,views.tsx,messages.ts,routing.ts,access.ts,device-presentation.ts}`
- `apps/kitluy-partner-pwa-portal/src/{App.tsx,views.tsx,hub-screen.tsx,terminals-screen.tsx,messages.ts,routing.ts}`
- All portal test files under `apps/*/test/`

## 4. Files changed

| Path | Change summary | Why | Generated? |
| ---- | -------------- | --- | ---------- |
| `packages/web-ui/src/index.tsx` | Token→CSS-var mapping; `injectKitluyTheme`/`restoreKitluyTheme`/`ThemeToggle`/`LocaleToggle`/`AppShell`/`Card`/`PageHeader`/`Pill`/`Badge`; full `kl-*` THEME_CSS (sidebar, topbar, tiles, table, codebox, ladder, forms, notices) + Google Fonts link; added `.kl-login` | shared design layer for both portals | no |
| `apps/kitluy-admin-pwa-portal/src/App.tsx` | Wrap in `AppShell` (sidebar nav, topbar toggles, account); `restoreKitluyTheme()` on mount; crumb per route | left-sidebar shell | no |
| `apps/kitluy-admin-pwa-portal/src/views.tsx` | `AdminNav` rewritten as sidebar `{locale,access,route}`; `StatTile`→`kl-tile`; `FleetSummaryBar`→`kl-tiles`; device table→`kl-table`; `LoginView`/`DeviceDetailView`/`ApprovalForm`/`PendingApprovalsView`/store views restyled with `kl-*` | apply design, keep hooks | no |
| `apps/kitluy-partner-pwa-portal/src/App.tsx` | Restructured so `SignedIn` renders its own `AppShell` with the per-Store `StoreNav` in the sidebar; toggles in topbar; sign-out in account slot; sign-in as centered card | per-Store sidebar nav | no |
| `apps/kitluy-partner-pwa-portal/src/views.tsx` | `StoreNav`→sidebar; `HubReadinessLine`→`kl-hub-line`; `PairingCodeDisplay`→`kl-codebox`; `ProvisioningLadder`→`kl-ladder/kl-rung`; `DefineTerminalForm` + `TerminalsView` table restyled | apply design, keep hooks | no |
| `apps/kitluy-partner-pwa-portal/src/hub-screen.tsx` | Page head, location field, notices, generate button carded/`kl-*` | apply design | no |
| `apps/kitluy-admin-pwa-portal/src/views.tsx` (store-create submit) | Reordered button attributes so `type="submit" disabled` precedes `className` | keep the existing `store-creation.test.tsx` assertion valid | no |

Other changed files in the same working tree (`messages.ts`, `access.ts`,
`device-presentation.ts`, `management-client.ts`, `routing.ts`, and the new
Partner `terminals-*`, `routing.ts`, `terminal-*` modules) belong to the earlier
**Phase 2** slices (2A–2D), not to this redesign; they were already in place.

### Allowlist verification

`PASS` — only `packages/web-ui` and the two portal apps were modified for the
redesign. No app imports another app's internals; the shared package imports no
app code; no vertical terminology entered neutral Core.

## 5. Implementation details

### Functional behavior

Pure presentation. Navigation, routing, sign-in/out, data loading, pairing,
approval and store-creation logic are unchanged. Nav links remain presentation
gates only (`holdsPermission`) — the Management API re-decides authority on every
request. The theme toggle stamps `data-theme` on `<html>` and persists to the
`kitluy-theme` `localStorage` key; `restoreKitluyTheme()` restores it on load.

### Schema/data/migrations

`NONE`.

### APIs/events/jobs/webhooks

`NONE`.

### Permissions/audit/security

Unchanged. No RLS, four-eyes, or permission check was touched. Frontend
visibility is still not authorization.

## 6. Verification (actual results)

Run with `PATH` pointed at Node v22.23.0 and, for tests, the `VITE_KITLUY_*`
env vars blanked (the portals fail closed when unconfigured under the runner).

| Check | Result |
| ----- | ------ |
| `pnpm --filter @kitluy/web-ui build` | PASS |
| Admin `tsc -p tsconfig.json --noEmit` | PASS |
| Admin `vitest run` | PASS — 107/107 (6 files) |
| Admin `vite build` | PASS |
| Partner `tsc -p tsconfig.json --noEmit` | PASS |
| Partner `vitest run` | PASS — 56/56 (5 files) |
| Partner `vite build` | PASS |
| `prettier --check` (changed files) | PASS (after `--write`) |
| `eslint` (changed files) | PASS (no findings) |
| `pnpm secret:scan` | PASS — 1879 tracked files |
| `pnpm verify` (whole monorepo) | Overall FAIL (exit 1); 4 pre-existing failing steps, all unrelated to this change (see below) |

Full `pnpm verify` (executed 2026-09-04) per-step:

| Step | Result | Cause if failed |
| ---- | ------ | --------------- |
| Format check | FAIL | `EACCES` scandir on `infra/kitluy-os-image/build/work/chroot-*/…/home/pi` (rootless image build tree); "All matched files use Prettier code style!" for everything readable |
| Lint | FAIL | 1 error in `packages/payments-persistence/test/integration.test.ts:77` (unused `error`) — not a portal file |
| Typecheck | PASS | |
| Unit tests | FAIL | turbo 36/37 tasks passed (both portals cached green); only `@kitluy/device-identity#test` failed — the two concurrency integration suites (fleet-service role borrow) |
| Contract tests | PASS | |
| Offline harness | PASS | |
| Build | PASS | |
| OpenAPI validation | PASS | |
| Migration validation | PASS | |
| Hub migration validation | PASS | |
| Secret scan | PASS | |
| Clock usage | PASS | |
| Docs link check | FAIL | 4 broken links in `00_AI_HANDOFF/shared/2026-07-30__…PHASE-E-PROMOTION-GATE…md` — pre-existing |

None of the four failing steps involve the redesigned files. Every step that
touches this change (Typecheck, Build, both portal test tasks, Secret scan)
passed.

`@kitluy/web-ui` resolves to `dist/index.js`, so it was rebuilt after each edit
so the apps pick up the new design.

## 7. Known issues / notes

- `@kitluy/web-ui` MUST be rebuilt (`pnpm --filter @kitluy/web-ui build`) for
  the apps to see design changes — it is consumed as built `dist`, not source.
- Full `pnpm verify` includes the whole working tree (Phase 2 + Hub image work)
  and carries known pre-existing failures unrelated to this redesign (Hub build
  tree prettier EACCES, a docs link check in an older handoff, and DB-backed
  integration suites that need a running local stack). Report the actual per-step
  result; do not attribute those to the redesign.
- A faithful visual preview of both portals (light/dark toggle) was published as
  a Claude artifact for owner review.

## 8. Next steps

- Owner browser walk-through of both portals against `kitluy-fresh` with the
  Management API running, in light and dark.
- Commit is owner's call (not committed per standing policy).
