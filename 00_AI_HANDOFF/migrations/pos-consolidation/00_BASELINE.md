# POS Consolidation — Baseline

**Filename:** `00_BASELINE.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner · **Status:** EVIDENCE
**Authority:** IMPLEMENTATION-EVIDENCE (observed) · **Implementation evidence status:** OBSERVED

> Captured before any migration. No secret values are recorded anywhere in this set.

## 1. Repositories

| Repository                           | Path                                  | Branch                       | HEAD                                       | Commits | Dirty          | Sync        |
| ------------------------------------ | ------------------------------------- | ---------------------------- | ------------------------------------------ | ------- | -------------- | ----------- |
| **Target** `het-kitluy-project`      | `repos/het-kitluy-project`            | `main`                       | `e9a7c3917ea4ef7b246bf0324d7b1f408d1d9645` | 279     | 12 (docs only) | in sync     |
| Source `kitluy-laundry-pos-desk-app` | `repos/het-kitluy-standalone-repos/…` | `feat/full-app-wiring`       | `d5d1a26dd6c23d16e7f0fca6edb90cea2c9ae150` | 94      | 0              | in sync     |
| Source `kitluy-suite-pos-desk-app`   | `repos/het-kitluy-standalone-repos/…` | `chore/add-typecheck-verify` | `3f66249a1f49a40b072a9521c44472305900da00` | 6       | **3**          | **ahead 3** |

Remotes: `het-admin/kitluy-pos-laundry`, `het-admin/kitluy-pos-cafe`,
`Soenghak3301/HET-KITLUY-PROJECT` (push disabled).

Worktrees: laundry POS owns 2 external (`wt-agent3-custui`, `wt-agent4-qa`);
suite POS owns 1 internal locked (`.claude/worktrees/port-laundry-ui`).

## 2. Toolchain divergence

|                 | Target monorepo     | Laundry POS | Suite POS |
| --------------- | ------------------- | ----------- | --------- |
| Package manager | **pnpm 9.15.9**     | npm         | npm       |
| React           | 18.3.1 (catalog)    | `^18.3.1`   | `^19.2.6` |
| Vite            | 6 (catalog)         | `^6.0.3`    | `^8.0.12` |
| TypeScript      | 5.7.3 (catalog)     | `~5.6.3`    | `~6.0.2`  |
| Electron        | `^33.3.1` (catalog) | `^40.4.1`   | `^40.4.1` |

## 3. Scale

| Metric                              | Laundry POS | Suite POS | Target                  |
| ----------------------------------- | ----------- | --------- | ----------------------- |
| `src/` files                        | **285**     | 113       | —                       |
| `electron/` files                   | 6           | 3         | 10                      |
| Test files                          | 27          | —         | 8 (POS app)             |
| `apps/kitluy-pos-desktop-app` files | —           | —         | 73 (incl. build output) |
| `verticals/phase1-laundry` files    | —           | —         | 44 (incl. build output) |

## 4. Verification baseline (target, BEFORE migration)

Node 22.23.0 / pnpm 9.15.9 — read from the repository's own `.nvmrc` and `packageManager`.

| Suite              | Result                         |
| ------------------ | ------------------------------ |
| `pnpm verify`      | **10 PASS / 3 FAIL**           |
| `pnpm docs:verify` | **7 PASS / 1 FAIL**            |
| `pnpm secret:scan` | **PASS** (1,458 tracked files) |

Known pre-existing failures — **must not be misclassified as migration regressions**:

1. **Unit tests** — `@kitluy/device-identity` integration suites need a KitLuy local Postgres. Ports 54321–54324 are held by `e-menu-platform`.
2. **Format check** — 48 pre-existing files.
3. **Docs link check** — 4 bare-UUID link targets in one 2026-07-30 handoff.
