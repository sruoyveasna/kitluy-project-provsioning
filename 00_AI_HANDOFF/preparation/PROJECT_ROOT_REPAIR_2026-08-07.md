# Project Root Repair — 2026-08-07

**Filename:** `PROJECT_ROOT_REPAIR_2026-08-07.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (observed)
**Scope:** Correction of the KitLuy project root architecture
**Source documents:** `workspace-control/KITLUY_PROJECT_ROOT_REPAIR_{BEFORE,AFTER}_2026-08-07.md`
**Supersedes:** the container model used by the earlier preparation mission
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. What was wrong

The earlier preparation mission treated `het-kitluy-project` as a **container**
holding the monorepo plus the six standalone repositories:

```text
repos/het-kitluy-project/
├── HET-KITLUY-PROJECT/     <- the real monorepo, nested one level too deep
└── kitluy-*/               <- six standalone repositories
```

The owner correction: **`het-kitluy-project` IS the monorepo**, not a container.

## 2. What it is now

```text
repos/het-kitluy-project/           <- this repository; canonical development,
                                       documentation, AI-handoff, infrastructure
                                       and Supabase root
repos/het-kitluy-standalone-repos/  <- the six preserved migration sources
```

`git rev-parse --show-toplevel` now returns
`/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project`.

## 3. Git identity preserved

| Property    | Value                                                      |
| ----------- | ---------------------------------------------------------- |
| HEAD before | `e9a7c3917ea4ef7b246bf0324d7b1f408d1d9645`                 |
| HEAD after  | `e9a7c3917ea4ef7b246bf0324d7b1f408d1d9645` — **identical** |
| Commits     | 279, unchanged                                             |
| Branch      | `main`, unchanged                                          |
| Remote      | `Soenghak3301/HET-KITLUY-PROJECT`, push still disabled     |

The repository was **moved, not rebuilt**. No new Git repository was
initialised, nothing was cloned, no scaffold was regenerated, no history was
squashed or merged, and the relocation was **not committed**.

## 4. How it was done safely

Staged, reversible `mv` operations on a single filesystem:

1. Six standalone repositories moved out first
2. `git worktree repair` on the two owning repositories
3. Container `CLAUDE.md` preserved to the standalone area
4. Monorepo moved to `repos/.het-kitluy-project-migration-stage`
5. `rmdir repos/het-kitluy-project` — succeeded only because it was empty
   (`rmdir` refuses non-empty directories, so nothing could be lost)
6. Stage moved into place as `repos/het-kitluy-project`

## 5. Consequences for agents

- Canonical entry point: `PROJECT_HOME.md` at the repository root
- AI instructions: `CLAUDE.md`, `AGENTS.md`, `KIMI.md` at the repository root
- Handoffs: `00_AI_HANDOFF/` at the repository root
- Documentation: `docs/` at the repository root (294 documents)
- Raw Drive evidence stays **workspace-level** at `exported-drive-docs/kitluy/`
- The six standalone repositories are **outside** this repository and must not be
  modified as part of monorepo work

## 6. Verification

All 21 structural gates PASS. `pnpm verify` 10/13 and `pnpm docs:verify` 7/8 —
**identical to the pre-repair baseline**, so the relocation broke nothing. Build
passes at the new path. Details in
`workspace-control/KITLUY_PROJECT_ROOT_REPAIR_AFTER_2026-08-07.md` §9.
