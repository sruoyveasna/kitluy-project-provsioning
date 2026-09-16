# Legacy Repository → Monorepo Map

**Filename:** `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** REFERENCE — **mapping only**
**Scope:** The six standalone KitLuy repositories vs `HET-KITLUY-PROJECT`
**Source documents:** direct inspection of all seven repositories, 2026-08-07
**Supersedes:** none — first issue
**Superseded by:** none
**Implementation evidence status:** OBSERVED (structure and Git state measured)

## 1. THIS IS NOT A MIGRATION AUTHORIZATION

> **No code has been copied, merged, moved, rewritten or retired.**
> **No Git history has been combined.**
> **No repository has been modified.**

This document records *where each legacy repository would eventually land* if a
consolidation is later authorized. Consolidation requires a **separate,
explicitly approved migration task**. Until then all six repositories remain
**valid, independent and authoritative** for their own code.

Registry status to record for each: **`migration/consolidation candidate`** —
not "migrated", not "superseded", not "deprecated".

## 2. Repository states at mapping time (2026-08-07)

| Repository | Branch | Dirty | Sync | Modified by this mission? |
| --- | --- | --- | --- | --- |
| `kitluy-admin-portal` | `main` | 0 | in sync | **No** |
| `kitluy-chain-portal` | `main` | 0 | in sync | **No** |
| `kitluy-partner-portal` | `main` | 0 | behind 2 | **No** |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring` | 0 | in sync | **No** |
| `kitluy-suite-pos-desk-app` | `chore/add-typecheck-verify` | **3** | **ahead 3** | **No** |
| `kitluy-suite-supabase` | `working-branch-veasna` | 0 | in sync | **No** |

> **Preservation flags.** `kitluy-suite-pos-desk-app` carries **3 uncommitted
> files and 3 unpushed commits** — highest preservation priority; any future
> migration must start by preserving that work. `kitluy-partner-portal` is
> **behind 2** commits; pull before using it as a migration source.

## 3. The map

### 3.1 `kitluy-admin-portal` → `apps/kitluy-admin-pwa-portal/`

| | |
| --- | --- |
| Stack (legacy) | Next.js `^16.2.10`, React `^19.2.0`, TypeScript `^5.8.0`, Playwright |
| Structure | `app/ components/ features/ lib/ e2e/ docs/` |
| Monorepo target | `apps/kitluy-admin-pwa-portal/` (exists as fail-closed scaffold) |
| Class | Direct app mapping |

**Migration dependencies:** monorepo catalog pins React `18.3.1` and Next
`14.2.35`; legacy runs React 19 / Next 16. **Framework-version reconciliation is
required before any code move** — this is not a copy-paste migration.

### 3.2 `kitluy-chain-portal` → `apps/kitluy-chain-pwa-portal/`

| | |
| --- | --- |
| Stack (legacy) | Next.js `^16.2.10`, React `^19.2.0`, TypeScript `^5.8.0`, Playwright |
| Structure | `src/ e2e/ scripts/ public/` |
| Monorepo target | `apps/kitluy-chain-pwa-portal/` (exists as scaffold) |
| Class | Direct app mapping |

**Migration dependencies:** same React/Next version gap as §3.1. Also uses
**Yarn** (`yarn.lock`) while the monorepo is **pnpm** — lockfile and workspace
protocol conversion required.

### 3.3 `kitluy-partner-portal` → `apps/kitluy-partner-pwa-portal/`

| | |
| --- | --- |
| Stack (legacy) | Vite `^6.0.7`, React `^18.3.1`, TypeScript `^5.9.3` |
| Structure | `src/ test/ docs/ scripts/` + `AGENTS.md`, `AI_HANDBOOK.md`, `TASKS.md` |
| Monorepo target | `apps/kitluy-partner-pwa-portal/` (exists as scaffold) |
| Class | Direct app mapping |

**Closest stack match** — React 18.3.1 and Vite 6 already align with the
monorepo catalog. Uses **npm** (`package-lock.json`); pnpm conversion required.

> **Terminology guard.** Legacy Drive material includes
> `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md`. **"Seller Portal" is
> prohibited.** The canonical name is **KitLuy Partner Portal**. No migration
> may reintroduce "Seller".

### 3.4 `kitluy-laundry-pos-desk-app` → reference input, two destinations

| | |
| --- | --- |
| Stack (legacy) | Electron `^40.4.1`, React `^18.3.1`, Vite `^6.0.3`, TypeScript `~5.6.3` |
| Structure | `electron/ src/ docs/ assets/ Release/ deployment-logs/`, Pi build configs |
| Monorepo targets | `apps/kitluy-pos-desktop-app/` **and** `verticals/phase1-laundry/` |
| Class | **Split mapping — reference input, not a lift-and-shift** |

This repository mixes **neutral POS shell** concerns with **laundry-specific**
workflows. The monorepo separates these by design:

- neutral POS shell → `apps/kitluy-pos-desktop-app/`
- laundry terminology, workflows, garments, tags → `verticals/phase1-laundry/`
- shared primitives → `packages/` (`pos-ui`, `printing`, `hardware`, `terminal-local-store`)

**Hard constraint:** `packages/` is **neutral Core** and must never contain
laundry terminology. A naive copy would violate this boundary.

**Also carries:** Raspberry Pi 5 / ARM64 Electron builder configs relevant to
`infra/edge/raspberry-pi/pi-terminal-image/` (named `infra/kitluy-os-image/`
when this map was written; moved 2026-09-16, INFRA-EDGE-STRUCTURE-001), and `Release/` + `deployment-logs/` which are
**evidence artifacts**, not source.

**Governing owner decision:** Drive `KLDRV-0001`
(*KitLuy Laundry POS — Native Source-of-Truth Clarification*, 2026-07-18,
OWNER-LOCKED) establishes KitLuy Suite Supabase as sole backend and the
**Order → Service → Service Item** model for this repository. See
conflict **KLDRV-CONF-001** — this vocabulary has **not** been reconciled
against the monorepo's T1 Booking contracts.

### 3.5 `kitluy-suite-pos-desk-app` → reference input for the POS shell

| | |
| --- | --- |
| Stack (legacy) | Electron `^40.4.1`, React `^19.2.6`, Vite `^8.0.12`, TypeScript `~6.0.2` |
| Structure | `electron/ src/ docs/ build/ public/` |
| Monorepo target | `apps/kitluy-pos-desktop-app/` + `packages/pos-ui/` |
| Class | Reference input |

**Largest toolchain gap of any repository** — React 19, Vite 8, TypeScript 6
against monorepo catalog React 18.3.1, Vite 6, TypeScript 5.7. Migration
requires deliberate version reconciliation, not a copy.

**Overlaps with §3.4**: both are Electron POS desktop applications targeting the
same monorepo app. A consolidation plan must first decide **which is the base**
and which contributes features. This is the single largest unresolved migration
question.

> This repository holds **uncommitted and unpushed work** (see §2). Resolve that
> before it is used as a migration source.

### 3.6 `kitluy-suite-supabase` → `supabase/`

| | |
| --- | --- |
| Structure | `supabase/` (**21 migrations**), `docs/`, `references/`, `test-results/` |
| Monorepo target | `supabase/` (**87 migrations**) |
| Class | **Schema reconciliation — the highest-risk mapping** |

**Do not merge these migration sets.** The monorepo has 87 migrations; the
legacy repository has 21. They are **separate lineages**, not a subset
relationship. Combining them without analysis risks schema divergence or data
loss.

Required before any move:
1. Compare applied-migration state in every named environment.
2. Determine whether the 21 legacy migrations are ancestors, a parallel lineage, or superseded.
3. Produce a reconciliation plan with explicit owner approval.
4. **Never auto-apply production migrations** — OWNER-LOCKED KL-INF-P1-037.

## 4. Summary table

| Legacy repository | Monorepo destination | Class | Risk |
| --- | --- | --- | --- |
| `kitluy-admin-portal` | `apps/kitluy-admin-pwa-portal/` | Direct | Framework version gap |
| `kitluy-chain-portal` | `apps/kitluy-chain-pwa-portal/` | Direct | Version gap + Yarn→pnpm |
| `kitluy-partner-portal` | `apps/kitluy-partner-pwa-portal/` | Direct | **Lowest** — stack aligns |
| `kitluy-laundry-pos-desk-app` | `apps/kitluy-pos-desktop-app/` + `verticals/phase1-laundry/` | Split | Core/vertical boundary |
| `kitluy-suite-pos-desk-app` | `apps/kitluy-pos-desktop-app/` + `packages/pos-ui/` | Reference | Overlap with above; largest toolchain gap |
| `kitluy-suite-supabase` | `supabase/` | Schema reconciliation | **Highest** — migration lineage |

## 5. Cross-cutting migration dependencies

| Dependency | Detail |
| --- | --- |
| Package manager | Monorepo is **pnpm 9.15.9**; legacy repos use npm, yarn and pnpm |
| Version catalog | Monorepo pins versions in `pnpm-workspace.yaml` catalog — **leaves never pin duplicates** |
| Framework drift | React 18.3.1 / 19.2.0 / 19.2.6; Next 14.2.35 / 16.2.10; Vite 6 / 8; TS 5.6 / 5.7 / 5.8 / 5.9 / 6.0 |
| Core neutrality | `packages/` must contain **no vertical terminology** |
| Product boundaries | Apps never import other apps' internals; shared packages never import app code |
| Money | No floating-point money — `@kitluy/money` |
| Append-only records | Financial, custody, inventory-movement and audit records |
| Store Hub | POS terminals must not write directly to Supabase |
| Git history | **Never combine.** No `filter-branch`, `filter-repo`, or history rewriting |

## 6. What a future migration task must do first

1. Obtain **explicit owner authorization** naming the repositories in scope.
2. Preserve `kitluy-suite-pos-desk-app`'s uncommitted and unpushed work.
3. Pull `kitluy-partner-portal` (behind 2).
4. Resolve the §3.4 / §3.5 **POS desktop overlap** — decide the base.
5. Resolve the §3.6 **Supabase migration lineage**.
6. Reconcile **KLDRV-CONF-001** (Order/Service/Service Item vs T1 Booking).
7. Reconcile framework versions against the catalog.
8. Produce a per-repository, reversible, staged plan.
9. Keep every legacy repository intact until migration is **verified**.

## 7. Explicitly prohibited by this document

- Copying production source code between repositories
- Merging or rewriting Git histories
- Rewriting imports across repository boundaries
- Retiring, archiving or deleting any legacy repository
- Marking anything "migrated" before verified migration
- Modifying a legacy repository as part of monorepo work

---

**Related:** `00_AI_HANDOFF/preparation/EXISTING_REPOSITORY_MAP.md` (detailed
inventory), `DRIVE_SYNC_POLICY.md`, `kitluy-decision-and-reconciliation-register-v1.0.0.md`.
