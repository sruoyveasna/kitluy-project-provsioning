# POS Unification — Baseline

**Filename:** `00_BASELINE.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner · **Status:** EVIDENCE
**Authority:** IMPLEMENTATION-EVIDENCE (observed) · **Evidence status:** OBSERVED
**Supersedes:** extends `../pos-consolidation/00_BASELINE.md` under the 2026-08-07 owner decision

> No secret value is recorded anywhere in this set.

## 1. The three POS implementations

|                 | Canonical                                         | Laundry donor                                                   | Suite donor                                |
| --------------- | ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------ |
| Path            | `apps/kitluy-pos-desktop-app`                     | `repos/het-kitluy-standalone-repos/kitluy-laundry-pos-desk-app` | `…/kitluy-suite-pos-desk-app`              |
| Git root        | `repos/het-kitluy-project`                        | own repository                                                  | own repository                             |
| Branch          | `main`                                            | `feat/full-app-wiring`                                          | `chore/add-typecheck-verify`               |
| HEAD            | `e9a7c3917ea4ef7b246bf0324d7b1f408d1d9645`        | `d5d1a26dd6c23d16e7f0fca6edb90cea2c9ae150`                      | `3f66249a1f49a40b072a9521c44472305900da00` |
| Commits         | 279                                               | 94                                                              | 6                                          |
| Dirty           | docs only                                         | 0                                                               | **3**                                      |
| Sync            | in sync                                           | in sync                                                         | **ahead 3**                                |
| Remote          | `Soenghak3301/HET-KITLUY-PROJECT` (push disabled) | `het-admin/kitluy-pos-laundry`                                  | `het-admin/kitluy-pos-cafe`                |
| Worktrees       | main only                                         | 2 external                                                      | 1 internal, locked                         |
| Package manager | **pnpm 9.15.9**                                   | npm                                                             | npm                                        |
| Node            | 22.23.0 (`.nvmrc`)                                | not pinned                                                      | not pinned                                 |
| Electron        | `^33.3.1` (catalog)                               | `^40.4.1`                                                       | `^40.4.1`                                  |
| React           | 18.3.1 (catalog)                                  | `^18.3.1`                                                       | `^19.2.6`                                  |
| TypeScript      | 5.7.3 (catalog)                                   | `~5.6.3`                                                        | `~6.0.2`                                   |
| Vite            | 6 (catalog)                                       | `^6.0.3`                                                        | `^8.0.12`                                  |
| Build           | `vite build && tsc -p tsconfig.electron.json`     | electron-builder (+ rpi5)                                       | vite/electron                              |
| Test            | `vitest run`                                      | vitest (27 files)                                               | vitest                                     |

## 2. Verification baseline (BEFORE this mission)

Run at the canonical root on Node 22.23.0 / pnpm 9.15.9.

| Suite              | Result                         |
| ------------------ | ------------------------------ |
| `pnpm verify`      | **10 PASS / 3 FAIL**           |
| `pnpm docs:verify` | **7 PASS / 1 FAIL**            |
| `pnpm secret:scan` | **PASS** (1,458 tracked files) |
| POS app tests      | 58 passed, 1 skipped           |

Known pre-existing failures — **not migration regressions**:

1. **Unit tests** — `@kitluy/device-identity` integration suites: 85 failed / 757 passed. They need a KitLuy local Postgres; ports 54321–54324 are held by `e-menu-platform`.
2. **Format check** — 48 pre-existing files.
3. **Docs link check** — 4 bare-UUID link targets in one 2026-07-30 handoff.
