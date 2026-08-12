# Standalone Repository Inventory — 2026-08-07

**Filename:** `STANDALONE_REPOSITORY_INVENTORY_2026-08-07.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (Git state observed directly)
**Scope:** The six repositories at `repos/het-kitluy-standalone-repos/`
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. Classification

All six are **`STANDALONE-MIGRATION-SOURCE`** — preserved, valid, independent
repositories. Not deleted, not migrated, not obsolete.

Full per-repository reconciliation detail, including monorepo targets and next
actions, is in `docs/authority/STANDALONE_REPOSITORY_RECONCILIATION.md`.

## 2. Inventory (state identical before and after the root repair)

| Repository                    | Branch                       | HEAD                                       | Commits | Dirty | Sync         | Remote                            |
| ----------------------------- | ---------------------------- | ------------------------------------------ | ------- | ----- | ------------ | --------------------------------- |
| `kitluy-admin-portal`         | `main`                       | `b77bd612d7adf0d888cd605bd471a3c26016bbef` | 10      | 0     | in sync      | `het-admin/kitluy-admin-portal`   |
| `kitluy-chain-portal`         | `main`                       | `1303fa82ac21d6c7ca70fb590e2c6923c67c17e6` | 6       | 0     | in sync      | `het-admin/kitluy-chain-portal`   |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring`       | `d5d1a26dd6c23d16e7f0fca6edb90cea2c9ae150` | 94      | 0     | in sync      | `het-admin/kitluy-pos-laundry`    |
| `kitluy-partner-portal`       | `main`                       | `e7e2576bb386ef74afc1882bc0973fda599bf101` | 10      | 0     | **behind 2** | `het-admin/kitluy-partner-portal` |
| `kitluy-suite-pos-desk-app`   | `chore/add-typecheck-verify` | `3f66249a1f49a40b072a9521c44472305900da00` | 6       | **3** | **ahead 3**  | `het-admin/kitluy-pos-cafe`       |
| `kitluy-suite-supabase`       | `working-branch-veasna`      | `68a2b7820cc59adcc881a96981522036de919419` | 92      | 0     | in sync      | `het-admin/kitluy-suite-supabase` |

## 3. Preservation flags

### `kitluy-suite-pos-desk-app` — highest priority

Working tree (intact):

```text
A  .claude/settings.json
A  CLAUDE.md
?? .claude/worktrees/
```

Unpushed commits (exist nowhere else):

```text
3f66249 feat(ui): port laundry UI to Dashboard, Order Queue, Order Detail, Shift Close
5c308be feat(ui): port KitLuy Laundry POS UI to Suite POS launcher, PIN, settings, T2
2c83025 feat: add design tokens, touch input pad styles, and shared types for laundry POS
```

### `kitluy-suite-supabase`

On `working-branch-veasna`, **in sync** at this observation. **Do not switch the
branch.** (Older workspace notes warned of unpushed commits here; that was not
the case on 2026-08-07.)

### `kitluy-partner-portal`

**Behind 2** commits. Pull before using it as a migration source.

## 4. Worktrees

| Worktree                                               | Owner                         | Branch                 | HEAD      |
| ------------------------------------------------------ | ----------------------------- | ---------------------- | --------- |
| `worktrees/kitluy-ecosystem/wt-agent3-custui`          | `kitluy-laundry-pos-desk-app` | `custui/customer-ui`   | `11d3dc2` |
| `worktrees/kitluy-ecosystem/wt-agent4-qa`              | `kitluy-laundry-pos-desk-app` | `qa/customer-qa`       | `3fbb61c` |
| `.claude/worktrees/port-laundry-ui` (locked, internal) | `kitluy-suite-pos-desk-app`   | `feat/port-laundry-ui` | `3f66249` |

All three were broken by the moves and repaired with `git worktree repair`.
None was deleted, pruned or recreated. `worktrees/kitluy-ecosystem/` keeps its
name deliberately.

## 5. Stacks and package managers

| Repository                    | Stack                                                            | Package manager |
| ----------------------------- | ---------------------------------------------------------------- | --------------- |
| `kitluy-admin-portal`         | Next.js `^16.2.10`, React `^19.2.0`, TS `^5.8.0`                 | npm             |
| `kitluy-chain-portal`         | Next.js `^16.2.10`, React `^19.2.0`, TS `^5.8.0`                 | **yarn**        |
| `kitluy-partner-portal`       | Vite `^6.0.7`, React `^18.3.1`, TS `^5.9.3`                      | npm             |
| `kitluy-laundry-pos-desk-app` | Electron `^40.4.1`, React `^18.3.1`, Vite `^6.0.3`, TS `~5.6.3`  | npm             |
| `kitluy-suite-pos-desk-app`   | Electron `^40.4.1`, React `^19.2.6`, Vite `^8.0.12`, TS `~6.0.2` | npm             |
| `kitluy-suite-supabase`       | Supabase, **21 migrations**                                      | —               |

The canonical monorepo uses **pnpm 9.15.9** with catalog-pinned React 18.3.1,
Next 14.2.35, Vite 6, TS 5.7. **No migration is a copy-paste operation.**

## 6. Not performed

No code was copied, no migrations merged, no imports rewritten, no history
merged, no repository retired. This inventory records state only.
