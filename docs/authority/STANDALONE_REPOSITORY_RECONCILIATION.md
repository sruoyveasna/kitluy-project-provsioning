# Standalone Repository Reconciliation Register

**Filename:** `STANDALONE_REPOSITORY_RECONCILIATION.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (Git state observed) + REFERENCE (mapping only)
**Scope:** The six preserved standalone KitLuy repositories at `repos/het-kitluy-standalone-repos/`
**Source documents:** direct `git` inspection 2026-08-07; `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. What this register is

The six standalone KitLuy repositories are classified **`STANDALONE-MIGRATION-SOURCE`**.

They are **not deleted**, **not migrated**, and **not obsolete**. They remain
valid, independent, authoritative repositories for their own code until a
separate reconciliation/migration task determines what is authoritative, what is
already ported, what must be migrated, and what may eventually be archived.

> **No code reconciliation was performed by the folder-repair mission.** This
> register records *state and intent* only.

## 2. Why they live outside the canonical monorepo

Independent `.git` repositories are deliberately kept out of
`repos/het-kitluy-project/`. Nesting them would make Git status ambiguous,
automation and AI scope detection unreliable, backup behaviour unclear,
source-of-truth ownership unclear, and CI affected-file logic wrong.

Converting them into governed Git submodules is **not authorized**.

```text
repos/
├── het-kitluy-project/              # canonical monorepo (the Git repository itself)
└── het-kitluy-standalone-repos/     # preserved migration sources (6 repositories)
```

## 3. Register

### 3.1 `kitluy-admin-portal`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-admin-portal` |
| Branch | `main` |
| HEAD | `b77bd612d7adf0d888cd605bd471a3c26016bbef` (10 commits) |
| Remote | `het-admin/kitluy-admin-portal` |
| Dirty | 0 |
| Ahead/behind | in sync |
| Worktrees | none |
| Corresponding monorepo target | `apps/kitluy-admin-pwa-portal/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | Next.js 16 / React 19 admin surface, Playwright e2e, `features/` + `lib/` layout |
| Next reconciliation action | Compare feature coverage against the monorepo scaffold; reconcile React 19 → catalog React 18.3.1 and Next 16 → 14.2.35 before any port |

### 3.2 `kitluy-chain-portal`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-chain-portal` |
| Branch | `main` |
| HEAD | `1303fa82ac21d6c7ca70fb590e2c6923c67c17e6` (6 commits) |
| Remote | `het-admin/kitluy-chain-portal` |
| Dirty | 0 |
| Ahead/behind | in sync |
| Worktrees | none |
| Corresponding monorepo target | `apps/kitluy-chain-pwa-portal/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | Next.js chain management, Supabase SSR, Leaflet maps, Playwright |
| Next reconciliation action | Same framework reconciliation as §3.1, **plus** Yarn → pnpm workspace conversion (`yarn.lock` present) |

### 3.3 `kitluy-partner-portal`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-partner-portal` |
| Branch | `main` |
| HEAD | `e7e2576bb386ef74afc1882bc0973fda599bf101` (10 commits) |
| Remote | `het-admin/kitluy-partner-portal` |
| Dirty | 0 |
| Ahead/behind | **behind 2** |
| Worktrees | none |
| Corresponding monorepo target | `apps/kitluy-partner-pwa-portal/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | Vite + React 18.3.1 partner operations, Recharts; carries `AGENTS.md`, `AI_HANDBOOK.md`, `TASKS.md` |
| Next reconciliation action | **Pull the 2 missing commits first.** Lowest-risk port — stack already matches the monorepo catalog (React 18.3.1, Vite 6). npm → pnpm conversion required |

> **Terminology guard.** Google Drive holds `kitluy-seller-portal-rebuild-bible-md-v1.0.0.md`.
> **"Seller Portal" is prohibited** — the canonical name is **KitLuy Partner Portal**.

### 3.4 `kitluy-laundry-pos-desk-app`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-laundry-pos-desk-app` |
| Branch | `feat/full-app-wiring` |
| HEAD | `d5d1a26dd6c23d16e7f0fca6edb90cea2c9ae150` (94 commits) |
| Remote | `het-admin/kitluy-pos-laundry` |
| Dirty | 0 |
| Ahead/behind | in sync |
| Worktrees | **2 external** — `worktrees/kitluy-ecosystem/wt-agent3-custui` (`custui/customer-ui`, `11d3dc2`), `worktrees/kitluy-ecosystem/wt-agent4-qa` (`qa/customer-qa`, `3fbb61c`) |
| Corresponding monorepo target | **Split** — `apps/kitluy-pos-desktop-app/` **and** `verticals/phase1-laundry/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | Electron ARM64 POS, ESC/POS printing, serialport, Raspberry Pi 5 builder configs, `Release/` + `deployment-logs/` evidence |
| Next reconciliation action | **Not a lift-and-shift.** Separate neutral POS shell from laundry-specific workflows — `packages/` is neutral Core and must never contain laundry terminology. Also resolve conflict **KLDRV-CONF-001** (Order/Service/Service Item vs T1 Booking) before porting vocabulary |

### 3.5 `kitluy-suite-pos-desk-app`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-suite-pos-desk-app` |
| Branch | `chore/add-typecheck-verify` |
| HEAD | `3f66249a1f49a40b072a9521c44472305900da00` (6 commits) |
| Remote | `het-admin/kitluy-pos-cafe` |
| Dirty | **3** — `A .claude/settings.json`, `A CLAUDE.md`, `?? .claude/worktrees/` |
| Ahead/behind | **ahead 3 (unpushed)** |
| Worktrees | **1 internal, locked** — `.claude/worktrees/port-laundry-ui` (`feat/port-laundry-ui`, `3f66249`) |
| Corresponding monorepo target | `apps/kitluy-pos-desktop-app/` + `packages/pos-ui/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | Electron POS shell on the newest toolchain (React 19.2.6, Vite 8, TS 6.0); ported laundry UI work |
| Next reconciliation action | **Preserve the unpushed work first.** Then resolve **KLDRV-CONF-003** — this and §3.4 both target `apps/kitluy-pos-desktop-app/`; the owner must name the base. Largest toolchain gap of any repository |

> **HIGHEST PRESERVATION PRIORITY.** Unpushed commits exist nowhere else:
>
> ```text
> 3f66249 feat(ui): port laundry UI to Dashboard, Order Queue, Order Detail, Shift Close
> 5c308be feat(ui): port KitLuy Laundry POS UI to Suite POS launcher, PIN, settings, T2
> 2c83025 feat: add design tokens, touch input pad styles, and shared types for laundry POS
> ```

### 3.6 `kitluy-suite-supabase`

| Field | Value |
| --- | --- |
| Path | `repos/het-kitluy-standalone-repos/kitluy-suite-supabase` |
| Branch | `working-branch-veasna` — **do not switch** |
| HEAD | `68a2b7820cc59adcc881a96981522036de919419` (92 commits) |
| Remote | `het-admin/kitluy-suite-supabase` |
| Dirty | 0 |
| Ahead/behind | in sync (observed 2026-08-07) |
| Worktrees | none |
| Corresponding monorepo target | `supabase/` |
| Migration status | **NOT MIGRATED** |
| Known unique functionality | **21 migrations** on a separate lineage from the monorepo's 87 |
| Next reconciliation action | **HIGHEST RISK.** Resolve **KLDRV-CONF-004**: determine whether the 21 legacy migrations are ancestors, a parallel lineage, or superseded. Requires per-environment applied-migration comparison and explicit owner approval. **Never auto-apply production migrations** (`KL-INF-P1-037`) |

## 4. Summary

| Repository | Monorepo target | Migration status | Risk |
| --- | --- | --- | --- |
| `kitluy-partner-portal` | `apps/kitluy-partner-pwa-portal/` | NOT MIGRATED | **Lowest** — stack aligns |
| `kitluy-admin-portal` | `apps/kitluy-admin-pwa-portal/` | NOT MIGRATED | Framework version gap |
| `kitluy-chain-portal` | `apps/kitluy-chain-pwa-portal/` | NOT MIGRATED | Version gap + Yarn→pnpm |
| `kitluy-laundry-pos-desk-app` | `apps/kitluy-pos-desktop-app/` + `verticals/phase1-laundry/` | NOT MIGRATED | Core/vertical boundary |
| `kitluy-suite-pos-desk-app` | `apps/kitluy-pos-desktop-app/` + `packages/pos-ui/` | NOT MIGRATED | Overlap + toolchain gap + unpushed work |
| `kitluy-suite-supabase` | `supabase/` | NOT MIGRATED | **Highest** — migration lineage |

## 5. Blocking conflicts

Recorded in `00_AI_HANDOFF/preparation/DOCUMENT_RECONCILIATION_REPORT.md`.
**No agent may proceed past these by choosing a side.**

| ID | Conflict | Blocks |
| --- | --- | --- |
| **KLDRV-CONF-001** | Order → Service → Service Item (owner decision `KLDRV-0001`) vs monorepo T1 **Booking** model | Any POS-desktop vocabulary work |
| **KLDRV-CONF-003** | Which POS desktop repository is the base for `apps/kitluy-pos-desktop-app/` | POS consolidation |
| **KLDRV-CONF-004** | Supabase migration lineage — 21 legacy vs 87 monorepo | Supabase consolidation |

## 6. Prohibited without a separate authorized migration task

- Copying application source into `apps/`, `services/` or `packages/`
- Merging database migrations
- Rewriting imports across repository boundaries
- Merging or rewriting Git history
- Retiring, archiving or deleting any standalone repository
- Removing duplicated implementation
- Changing business logic
- Converting the standalone repositories into Git submodules

## 7. Cross-cutting migration dependencies

| Dependency | Detail |
| --- | --- |
| Package manager | Monorepo is **pnpm 9.15.9**; standalone repos use npm and yarn |
| Version catalog | Pinned in `pnpm-workspace.yaml` — leaves never pin duplicates |
| Framework drift | React 18.3.1 / 19.2.0 / 19.2.6; Next 14.2.35 / 16.2.10; Vite 6 / 8; TS 5.6–6.0 |
| Core neutrality | `packages/` must contain **no** vertical terminology |
| Product boundaries | Apps never import other apps' internals; shared packages never import app code |
| Money | No floating-point money — `@kitluy/money` |
| Append-only records | Financial, custody, inventory-movement and audit records |
| Store Hub | POS terminals must not write directly to Supabase |
| Git history | **Never combine.** No `filter-branch`, `filter-repo`, or history rewriting |

---

**Related:** `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md` (destination rationale),
`00_AI_HANDOFF/preparation/STANDALONE_REPOSITORY_INVENTORY_2026-08-07.md`,
`workspace-control/KITLUY_PROJECT_ROOT_REPAIR_AFTER_2026-08-07.md`.
