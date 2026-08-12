# Suite POS Inventory — `kitluy-suite-pos-desk-app`

**Filename:** `03_SUITE_POS_INVENTORY.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Status:** EVIDENCE (carried into pos-unification under the 2026-08-07 owner decision) · **Authority:** IMPLEMENTATION-EVIDENCE · **Evidence status:** OBSERVED

HEAD `3f66249…`, branch `chore/add-typecheck-verify`, 6 commits, **3 dirty, ahead 3**.
**113 `src/` files.**

## 1. Structure

```text
src/
├── app/       App.tsx, providers/, router/
├── features/  auth · terminals          <- only two
├── shared/    assets components hooks mock-data styles types utils
electron/      main/ preload/ services/
references/    cafe-pos-ui/              <- café UI reference material
```

## 2. Capability probes

| Capability                   | Files  | Classification                |
| ---------------------------- | ------ | ----------------------------- |
| **tab**                      | **39** | **Café/restaurant — Phase 2** |
| **table**                    | **30** | **Café/restaurant — Phase 2** |
| **floor**                    | **14** | **Café/restaurant — Phase 2** |
| KHQR                         | 8      | Shared payment presentation   |
| printer                      | 3      | Thin                          |
| KDS                          | 2      | **Phase 2**                   |
| thermal                      | 1      | Thin                          |
| payway, barcode, course, tip | 0      | Absent                        |

## 3. Assessment

This repository is **much thinner than the laundry POS** (113 vs 285 files) and
its `features/` contains only `auth` and `terminals`. Its distinguishing content
is **café/restaurant** material — tables, floor plans, tabs, KDS — plus a
`references/cafe-pos-ui/` folder.

Per mission §11 and the Phase 1 fence, café/restaurant features are classified
**`REFERENCE-FUTURE`** and must **not** become active Phase 1 Laundry
functionality. Phase 2 must not be activated during this mission.

## 4. What is potentially shared-valuable

`shared/components`, `shared/hooks`, `shared/utils`, `shared/styles`,
`app/providers`, `app/router`, `electron/{main,preload,services}` — a modern
Electron + React 19 shell. These are candidates for `SHARED-POS-DESKTOP` or
`PROMOTE-TO-SHARED`, subject to the React 19 → 18.3.1 and Vite 8 → 6
reconciliation.

`shared/mock-data` is **not** production material.

## 5. Unpushed work (preserved)

```text
3f66249 feat(ui): port laundry UI to Dashboard, Order Queue, Order Detail, Shift Close
5c308be feat(ui): port KitLuy Laundry POS UI to Suite POS launcher, PIN, settings, T2
2c83025 feat: add design tokens, touch input pad styles, and shared types for laundry POS
```

Working tree: `A .claude/settings.json`, `A CLAUDE.md`, `?? .claude/worktrees/`.

**Note for KLDRV-CONF-003:** these commits port _laundry_ UI _into_ the suite
shell — evidence that a consolidation direction was already being explored here.
This is recorded as evidence; it does **not** decide the conflict.

## 6. Architecture

Same concern as the laundry POS: verify Hub-mediated vs cloud-direct data flow
before reusing any data-touching code. `references/cafe-pos-ui/` contains build
output (`dist`) and is reference material, not source to migrate.
