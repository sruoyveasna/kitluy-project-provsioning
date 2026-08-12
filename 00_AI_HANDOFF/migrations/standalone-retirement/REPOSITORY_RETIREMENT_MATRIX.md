# Repository Retirement Matrix

**Filename:** `REPOSITORY_RETIREMENT_MATRIX.md` · **Version:** v1.0.0 · **Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner · **Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (Git state observed) · **Evidence status:** OBSERVED

> **Deletion allowed = NO for all six.** `repos/het-kitluy-standalone-repos/`
> must not be removed.

## Matrix

| Repository                    | Canonical target                                             | Source HEAD | Branch                       | Dirty | Unpushed         | Feature inventory | Code reconciliation       | Tests reconciled | Unique implementation remaining          | Backup bundle verified | Retirement status | **Deletion allowed** |
| ----------------------------- | ------------------------------------------------------------ | ----------- | ---------------------------- | ----- | ---------------- | ----------------- | ------------------------- | ---------------- | ---------------------------------------- | ---------------------- | ----------------- | -------------------- |
| `kitluy-laundry-pos-desk-app` | `apps/kitluy-pos-desktop-app/` + `verticals/phase1-laundry/` | `d5d1a26…`  | `feat/full-app-wiring`       | 0     | 0                | **DONE**          | **NOT STARTED** (blocked) | NOT STARTED      | **YES — extensive**                      | **YES**                | **BLOCKED**       | **NO**               |
| `kitluy-suite-pos-desk-app`   | `apps/kitluy-pos-desktop-app/` + `packages/pos-ui/`          | `3f66249…`  | `chore/add-typecheck-verify` | **3** | **3**            | **DONE**          | **NOT STARTED** (blocked) | NOT STARTED      | **YES — Phase 2 + shell**                | **YES**                | **BLOCKED**       | **NO**               |
| `kitluy-admin-portal`         | `apps/kitluy-admin-pwa-portal/`                              | `b77bd61…`  | `main`                       | 0     | 0                | NOT STARTED       | NOT STARTED               | NOT STARTED      | **UNKNOWN**                              | **YES**                | **BLOCKED**       | **NO**               |
| `kitluy-chain-portal`         | `apps/kitluy-chain-pwa-portal/`                              | `1303fa8…`  | `main`                       | 0     | 0                | NOT STARTED       | NOT STARTED               | NOT STARTED      | **UNKNOWN**                              | **YES**                | **BLOCKED**       | **NO**               |
| `kitluy-partner-portal`       | `apps/kitluy-partner-pwa-portal/`                            | `e7e2576…`  | `main`                       | 0     | 0 (**behind 2**) | NOT STARTED       | NOT STARTED               | NOT STARTED      | **UNKNOWN**                              | **YES**                | **BLOCKED**       | **NO**               |
| `kitluy-suite-supabase`       | `supabase/`                                                  | `68a2b78…`  | `working-branch-veasna`      | 0     | 0                | NOT STARTED       | NOT STARTED               | NOT STARTED      | **YES — 21 migrations, lineage unknown** | **YES**                | **BLOCKED**       | **NO**               |

## Evidence per repository

### `kitluy-laundry-pos-desk-app` — BLOCKED

Inventory complete (`01_LAUNDRY_POS_INVENTORY.md`): 285 `src/` files, T1 = 64
files, printing builders + raster + 2 transports, ABA PayWay (25 files), KHQR
(10), barcode (30), scanner service, USB printer, express pricing, 27 tests,
Khmer localization (8).

**Unique implementation remaining: extensive.** None migrated — blocked by
BLOCKER-1 (WS-12 register), BLOCKER-2 (KLDRV-CONF-001) and BLOCKER-5
(84/285 files are cloud-direct and need re-implementation, not porting).

Also owns **2 external worktrees** (`wt-agent3-custui`, `wt-agent4-qa`) which
would be orphaned by deletion.

### `kitluy-suite-pos-desk-app` — BLOCKED

Inventory complete (`02_SUITE_POS_INVENTORY.md`): 113 `src/` files. Bulk is
**Phase 2** — tabs (39), tables (30), floor plans (14), KDS (2), plus
`references/cafe-pos-ui/`. Classified `REFERENCE-FUTURE`; Phase 2 must not be
activated, so this material has **no canonical home yet**.

Carries **3 uncommitted files and 3 unpushed commits** — recoverable
(bundle + staged patch verified) but **not yet reconciled into the canonical
repository**. Owns 1 internal **locked** worktree.

Blocked additionally by BLOCKER-3 (which POS is the base) and BLOCKER-6
(React 19 / Vite 8 / TS 6).

### `kitluy-admin-portal` · `kitluy-chain-portal` · `kitluy-partner-portal` — BLOCKED

**No feature inventory has been performed.** This mission's scope was the two POS
repositories. Mission §19 is explicit: _"DO NOT delete those four repositories
merely because the two POS migrations are complete."_

Their canonical counterparts (`apps/kitluy-*-pwa-portal/`) are **fail-closed
scaffolds** — folder-name correspondence is not equivalence, and mission §20
forbids assuming it. Unique implementation is **UNKNOWN** until inventoried.

`kitluy-partner-portal` is additionally **behind 2** commits — its own remote
holds work not present locally.

### `kitluy-suite-supabase` — BLOCKED

Holds **21 migrations** on a lineage whose relationship to the canonical **86**
is unrecorded (**KLDRV-CONF-004**). Deleting it would destroy the only local copy
of a potentially divergent schema history. **Highest data risk of the six.**

Constraint: never auto-apply production migrations (`KL-INF-P1-037`).

## Deletion gate — mission §22

| Gate                                                                         | Status                                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------- |
| All 6 repositories inventoried                                               | **FAIL** — only 2 of 6                                  |
| All 6 Git histories recoverable                                              | **PASS** — 6 bundles verified `is okay`                 |
| All dirty/unpushed work recoverable                                          | **PASS** — restore test proved 3 commits + staged patch |
| All worktrees repaired or intentionally retained                             | **PASS** — 3 repaired, verified                         |
| All authoritative implementation migrated or proven superseded               | **FAIL** — 0 units migrated                             |
| All unique source identified                                                 | **FAIL** — 4 repositories not inventoried               |
| All canonical target mappings resolved                                       | **FAIL** — KLDRV-CONF-003 open                          |
| Relevant tests migrated/reconciled                                           | **FAIL** — none migrated                                |
| Canonical monorepo verifies                                                  | **PASS** — no new failures vs baseline                  |
| No production-critical feature exists only in standalone                     | **FAIL** — extensive unique implementation remains      |
| No migration/RLS/financial/payment/audit authority exists only in standalone | **FAIL** — KLDRV-CONF-004 unresolved                    |
| Retirement matrix says YES for all six                                       | **FAIL** — all six NO                                   |
| Owner blockers affecting deletion resolved                                   | **FAIL** — 6 open blockers                              |

**4 gates pass, 9 fail.**

## Verdict

```text
het-kitluy-standalone-repos NOT removed.
```

All six repositories remain in place, intact and unmodified. Removing any of
them now would destroy the only local copy of unmigrated, unreconciled
implementation.

## What would unblock retirement

1. Owner resolves **BLOCKER-1** (WS-12 sequencing), **KLDRV-CONF-001**, **-003**, **-004**.
2. WS-12 T003–T008 run in their locked order, consuming the laundry POS as evidence.
3. Feature inventories for the three portals.
4. Migration-lineage analysis for `kitluy-suite-supabase`.
5. Per-repository proof of migration or recorded supersession.
6. Re-run this matrix; retire **individually** as each gate passes — never the parent directory in one unverified operation.

---

## Update — 2026-08-07, POS unification cycle

The owner decision of 2026-08-07 resolved **KLDRV-CONF-003** (canonical app is
the base; standalone apps are donors) and, via §6
(`MIGRATED-NOT-YET-ACCEPTED`), unblocked consolidation without falsifying the
WS-12 register. Real architectural work followed — see
`../pos-unification/13_POS_CONSOLIDATION_REPORT.md`.

### What changed

| Gate                                                           | Before               | After                                                                                                           |
| -------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------- |
| All 6 repositories inventoried                                 | FAIL (2 of 6)        | FAIL — still 2 of 6                                                                                             |
| All canonical target mappings resolved                         | FAIL (CONF-003 open) | **PASS** — CONF-003 resolved                                                                                    |
| All authoritative implementation migrated or proven superseded | FAIL                 | FAIL — but **every donor capability now has a disposition** (`10_POS_FEATURE_DISPOSITION_REGISTER.md`, 45 rows) |
| Canonical monorepo verifies                                    | PASS                 | **PASS** — 10/13, no new failures, +30 tests                                                                    |

**4 of 13 gates passed before; 5 pass now.** Deletion remains blocked.

### Per-repository update

| Repository                    | Change                                                                                                                                                                                              | Deletion allowed |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `kitluy-laundry-pos-desk-app` | Full capability disposition recorded. **No code migrated** — intake, pricing, payment, printing and hardware are gated behind WS-12 T003–T006 and KLDRV-CONF-001                                    | **NO**           |
| `kitluy-suite-pos-desk-app`   | Café/restaurant **boundary** registered canonically as `REGISTERED_INACTIVE_PHASE2` — but the **code** (tabs 39, tables 30, floor 14, KDS) still exists only here. Unpushed work still unreconciled | **NO**           |
| `kitluy-admin-portal`         | No change — not inventoried                                                                                                                                                                         | **NO**           |
| `kitluy-chain-portal`         | No change — not inventoried                                                                                                                                                                         | **NO**           |
| `kitluy-partner-portal`       | No change — not inventoried; still behind 2                                                                                                                                                         | **NO**           |
| `kitluy-suite-supabase`       | No change — KLDRV-CONF-004 still open                                                                                                                                                               | **NO**           |

### The decisive remaining reason

> The café/restaurant **boundary** is now canonical; the café **implementation**
> is not. Registering a module is not migrating 85+ files of Phase 2 UI.
> Deleting `kitluy-suite-pos-desk-app` today would destroy the only copy of that
> implementation, plus its 3 unpushed commits.

Four repositories remain entirely un-inventoried. **Verdict unchanged:
`het-kitluy-standalone-repos` is NOT removed.**
