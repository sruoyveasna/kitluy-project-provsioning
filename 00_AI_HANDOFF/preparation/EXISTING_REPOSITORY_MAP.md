# Existing Repository Map

**Filename:** `EXISTING_REPOSITORY_MAP.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (Git state observed directly)
**Scope:** All seven repositories under `repos/het-kitluy-project/`
**Source documents:** direct `git` inspection before and after the mission
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. Non-modification statement

> **None of the six standalone KitLuy repositories was modified by this mission.**
> No file was edited, no branch switched, no commit created, no push attempted,
> no pull performed, no worktree removed, no repository moved or deleted.

Every value below was captured **before** any action and **re-verified after**.
The two captures are identical.

## 2. The seven repositories

```text
repos/het-kitluy-project/
├── HET-KITLUY-PROJECT              # consolidated monorepo (relocated here 2026-08-07)
├── kitluy-admin-portal
├── kitluy-chain-portal
├── kitluy-laundry-pos-desk-app
├── kitluy-partner-portal
├── kitluy-suite-pos-desk-app
└── kitluy-suite-supabase
```

## 3. Git state — before and after (identical)

| Repository                    | Branch                       | Dirty | HEAD      | Remote                            | Sync         | Changed?                             |
| ----------------------------- | ---------------------------- | ----- | --------- | --------------------------------- | ------------ | ------------------------------------ |
| `HET-KITLUY-PROJECT`          | `main`                       | 0 → 7 | `e9a7c39` | `Soenghak3301/HET-KITLUY-PROJECT` | in sync      | **Deliverables added** (uncommitted) |
| `kitluy-admin-portal`         | `main`                       | 0     | `b77bd61` | `het-admin/kitluy-admin-portal`   | in sync      | **No**                               |
| `kitluy-chain-portal`         | `main`                       | 0     | `1303fa8` | `het-admin/kitluy-chain-portal`   | in sync      | **No**                               |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring`       | 0     | `d5d1a26` | `het-admin/kitluy-pos-laundry`    | in sync      | **No**                               |
| `kitluy-partner-portal`       | `main`                       | 0     | `e7e2576` | `het-admin/kitluy-partner-portal` | **behind 2** | **No**                               |
| `kitluy-suite-pos-desk-app`   | `chore/add-typecheck-verify` | **3** | `3f66249` | `het-admin/kitluy-pos-cafe`       | **ahead 3**  | **No**                               |
| `kitluy-suite-supabase`       | `working-branch-veasna`      | 0     | `68a2b78` | `het-admin/kitluy-suite-supabase` | in sync      | **No**                               |

## 4. Preservation flags

### `kitluy-suite-pos-desk-app` — highest priority

Carries **3 uncommitted tracked files** and **3 unpushed commits** on
`chore/add-typecheck-verify`. This work exists **nowhere else**. Do not switch
branches, stash, reset, clean, or pull in this repository without explicitly
preserving it first.

### `kitluy-suite-supabase` — standing warning updated

Workspace governance carries a standing warning about unpushed local commits.
**At this snapshot the branch `working-branch-veasna` is in sync with its
remote** — no unpushed commits were observed on 2026-08-07. The branch is
non-default and must not be switched; the warning remains appropriate as a
default posture.

### `kitluy-partner-portal` — behind remote

**Behind 2** commits. Not pulled by this mission — pulling is a separate
authorized action. Pull before using it as a migration source.

## 5. Stack inventory

| Repository                    | Framework                                           | Runtime      | Package manager | Migrations |
| ----------------------------- | --------------------------------------------------- | ------------ | --------------- | ---------- |
| `HET-KITLUY-PROJECT`          | Turborepo monorepo (Next/React/RN/Electron)         | Node 22.23.0 | **pnpm** 9.15.9 | **87**     |
| `kitluy-admin-portal`         | Next.js `^16.2.10`, React `^19.2.0`                 | —            | npm             | 0          |
| `kitluy-chain-portal`         | Next.js `^16.2.10`, React `^19.2.0`                 | —            | **yarn**        | 0          |
| `kitluy-partner-portal`       | Vite `^6.0.7`, React `^18.3.1`                      | —            | npm             | 0          |
| `kitluy-laundry-pos-desk-app` | Electron `^40.4.1`, React `^18.3.1`, Vite `^6.0.3`  | —            | npm             | 0          |
| `kitluy-suite-pos-desk-app`   | Electron `^40.4.1`, React `^19.2.6`, Vite `^8.0.12` | —            | npm             | 0          |
| `kitluy-suite-supabase`       | Supabase project                                    | —            | —               | **21**     |

### Toolchain divergence

Five distinct React lines (18.3.1, 19.2.0, 19.2.6), two Next lines (14.2.35 in
the monorepo catalog vs 16.2.10), three Vite lines (6, 8), five TypeScript lines
(5.6, 5.7, 5.8, 5.9, 6.0), and three package managers. **No migration is a
copy-paste operation.**

## 6. Overlaps and risks

| Finding                 | Detail                                                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POS desktop overlap** | `kitluy-laundry-pos-desk-app` and `kitluy-suite-pos-desk-app` are both Electron POS apps mapping to the same monorepo target. **Base not decided** — KLDRV-CONF-003                          |
| **Migration lineage**   | 21 legacy vs 87 monorepo migrations, relationship unknown. **Highest risk** — KLDRV-CONF-004                                                                                                 |
| **Core neutrality**     | `kitluy-laundry-pos-desk-app` mixes neutral POS shell with laundry specifics; the monorepo separates these. A naive copy would put laundry terminology into neutral `packages/` — prohibited |
| **Vocabulary**          | Owner decision `KLDRV-0001` mandates Order → Service → Service Item for the legacy POS repo; the monorepo uses T1 Booking. **Unreconciled** — KLDRV-CONF-001                                 |
| **Naming**              | Drive holds a "Seller Portal" bible. **"Seller" is prohibited** — canonical is Partner Portal                                                                                                |

## 7. Consolidation status

All six are recorded as **`migration/consolidation candidate`** in
`workspace-control/workspace.yaml` and `repository-registry.json`.

**They remain valid, independent, authoritative repositories.** No migration has
occurred and none is authorized. Nothing is marked "migrated", "superseded" or
"deprecated".

Destination mapping (mapping only):
`docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`.

## 8. Access policy — unchanged

All seven KitLuy repositories are **WRITE-ALLOWED** under the KitLuy policy of
2026-07-23. No blocking hooks are installed and no push URL was disabled by this
mission.

> `HET-KITLUY-PROJECT`'s push URL was **already** `disabled://push-requires-owner-approval`
> before this mission began. It was not changed.

Write authorization does not broaden scope: a task targeting one application
does not authorize changes in every KitLuy repository.

## 9. Git safety compliance

| Prohibited operation                                               | Performed? |
| ------------------------------------------------------------------ | ---------- |
| `git reset --hard`                                                 | **No**     |
| `git clean -fd`                                                    | **No**     |
| `git push --force`                                                 | **No**     |
| `git rebase --onto`                                                | **No**     |
| `git filter-branch` / `filter-repo`                                | **No**     |
| Commit                                                             | **No**     |
| Push                                                               | **No**     |
| Remote created or URL changed                                      | **No**     |
| History merged                                                     | **No**     |
| Branch/tag/worktree deleted                                        | **No**     |
| Repository deleted or moved (other than the authorized relocation) | **No**     |

---

**See also:** `docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`,
`WORKSPACE_PREPARATION_BEFORE.md` §10, `WORKSPACE_PREPARATION_AFTER.md` §8.
