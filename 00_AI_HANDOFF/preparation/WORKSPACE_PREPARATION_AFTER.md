# Workspace Preparation — AFTER Snapshot

**Filename:** `WORKSPACE_PREPARATION_AFTER.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** EVIDENCE
**Authority:** IMPLEMENTATION-EVIDENCE (observed facts)
**Scope:** State after the workspace preparation mission
**Source documents:** `WORKSPACE_PREPARATION_BEFORE.md`; direct inspection
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED — every value measured, none estimated

## 1. Project location (after)

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
```

Moved from the workspace **root**, satisfying the rule that all Git repositories
live under `repos/<ecosystem>/`.

### Rename result

**No rename was performed, and none was required.** The directory was already
named `HET-KITLUY-PROJECT`. No temporary name (`kitluy-eco-systen`,
`kitluy-eco-system`, `kitluy-ecosystem-project`, `kitluy-project`) existed
anywhere in the workspace. No collision occurred — the target path was empty.

**Deliberately left unchanged:**

- the parent ecosystem directory `repos/het-kitluy-project/` (it is the category, not the project);
- all six standalone KitLuy repository names;
- product identifiers `kitluy-admin-portal`, `kitluy-partner-portal`, `kitluy-chain-portal`, `kitluy-hub-agent`;
- "KitLuy Ecosystem" wherever it denotes the product/organizational concept.

## 2. Move verification

| Check                         | Result                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Method                        | `mv` — atomic rename, single filesystem (`/dev/nvme0n1p4`)                       |
| Branch                        | `main` — unchanged                                                               |
| HEAD                          | `e9a7c39` — unchanged                                                            |
| Remote fetch                  | `Soenghak3301/HET-KITLUY-PROJECT.git` — unchanged                                |
| Remote push                   | `disabled://push-requires-owner-approval` — unchanged (**was already disabled**) |
| Worktree registration         | Auto-updated to the new path; `git worktree list` correct                        |
| Tracked files                 | 1,458 — unchanged                                                                |
| Commits                       | 279 — unchanged                                                                  |
| Old root path                 | Confirmed absent                                                                 |
| Absolute-path rewrites needed | **0**                                                                            |

## 3. Git status (after)

```text
 M 00_AI_HANDOFF/000_BLOCKERS.md
 M 00_AI_HANDOFF/000_CURRENT_STATE.md
 M 00_AI_HANDOFF/000_INDEX.md
 M AGENTS.md
 M CLAUDE.md
 M KIMI.md
 M PROJECT_HOME.md
?? 00_AI_HANDOFF/preparation/
?? docs/authority/DRIVE_SYNC_POLICY.md
?? docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md
?? docs/authority/LOCAL_DOCUMENTATION_MAP.md
```

**11 entries — all are this mission's deliverables.** Nothing was committed or
pushed; no commit was requested. **No source code was modified** — every change
is documentation or agent instructions.

## 4. What changed inside the repository

### Modified (3) — all additive

| File                                 | Change                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                          | Added repository location, canonical name, and the **LOCAL-FIRST KNOWLEDGE POLICY (KL-DOCS-002)** section. Existing rules untouched                  |
| `AGENTS.md`                          | Appended **Addendum KL-DOCS-002**, clearly marked "not part of the owner original". Owner text unchanged                                             |
| `KIMI.md`                            | Appended **Addendum KL-DOCS-002** with orchestrator/reviewer duties. Owner text unchanged                                                            |
| `PROJECT_HOME.md`                    | Appended a marked preparation-update section (location, local-first policy, new governance documents, environment requirement). Owner text unchanged |
| `00_AI_HANDOFF/000_INDEX.md`         | Added the workspace-preparation section listing the 7 reports                                                                                        |
| `00_AI_HANDOFF/000_CURRENT_STATE.md` | Appended location change, verification results, environment requirement                                                                              |
| `00_AI_HANDOFF/000_BLOCKERS.md`      | Appended the 3 new consolidation conflicts + non-blocking environment items                                                                          |

Owner-authored text was never edited in place — the addendum pattern already
established by `PROJECT_HOME.md` was followed.

### Added (4 paths)

| Path                                                  | Purpose                                                                 |
| ----------------------------------------------------- | ----------------------------------------------------------------------- |
| `docs/authority/DRIVE_SYNC_POLICY.md`                 | When Drive may be queried; conflict, deletion and supersession handling |
| `docs/authority/LOCAL_DOCUMENTATION_MAP.md`           | Where to read about X locally; question → location table                |
| `docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md` | Legacy → monorepo mapping (**mapping only**)                            |
| `00_AI_HANDOFF/preparation/`                          | The 7 preparation deliverables                                          |

Documentation count: **290 → 293** Markdown files under `docs/`.

## 5. Governance pack — final state

All ten control documents now live in **`docs/authority/`**.

> **Directory decision.** The mission brief specified `docs/00-governance/`. The
> established location is `docs/authority/`, which already held all eight
> required documents and is referenced by `PROJECT_HOME.md`, `CLAUDE.md`,
> `AGENTS.md` and the `pnpm docs:authority-check` gate. **Creating a parallel
> `00-governance/` directory would have produced duplicate canonical documents —
> explicitly prohibited.** The existing structure was preserved and extended.

| Document                                                       | State        |
| -------------------------------------------------------------- | ------------ |
| `kitluy-source-of-truth-index-v1.0.0.md`                       | Pre-existing |
| `kitluy-authority-and-precedence-v1.0.0.md`                    | Pre-existing |
| `kitluy-decision-and-reconciliation-register-v1.0.0.md`        | Pre-existing |
| `kitluy-open-decisions-and-required-values-v1.0.0.md`          | Pre-existing |
| `kitluy-implementation-status-and-evidence-register-v1.0.0.md` | Pre-existing |
| `kitluy-superseded-document-register-v1.0.0.md`                | Pre-existing |
| `kitluy-glossary-and-naming-standard-v1.0.0.md`                | Pre-existing |
| `000_INDEX.md`                                                 | Pre-existing |
| `DRIVE_SYNC_POLICY.md`                                         | **Created**  |
| `LOCAL_DOCUMENTATION_MAP.md`                                   | **Created**  |
| `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`                         | **Created**  |

## 6. Structure decisions — divergences preserved

Per mission §6, working implementation was preserved over the planning diagram.
**No large source tree was moved.**

| Mission diagram             | Live repository                                                                              | Decision                                        |
| --------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `docs/00-governance/`       | `docs/authority/`                                                                            | Keep live — see §5                              |
| `future/`                   | `future-clients/`                                                                            | Keep live — referenced by `pnpm-workspace.yaml` |
| `tooling/`                  | `scripts/`                                                                                   | Keep live — equivalent, populated               |
| `tests/{unit,e2e,fixtures}` | `chaos, contract, end-to-end, hardware, integration, load, offline, recovery, rls, security` | Keep live — superset                            |
| `docs/` numbered 00–99      | 21 named domains                                                                             | Keep live — 293 docs cross-link it              |
| (absent)                    | `hub/`                                                                                       | Keep — Store Hub migrations/seed/tests          |
| `supabase/`, `infra/`       | supersets of the diagram                                                                     | Keep                                            |

## 7. Workspace-level changes (outside the repository)

| Path                                         | Change                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `exported-drive-docs/kitluy/`                | **Created** — 15 classification folders, 2 mirrored sources, `DRIVE_SOURCE_MANIFEST.md` + `.json` (4 files total)              |
| `workspace-control/workspace.yaml`           | `HET-KITLUY-PROJECT` registered; **7** KitLuy repositories now listed (6 pre-existing preserved). YAML re-parsed and validated |
| `workspace-control/repository-registry.json` | Entry `het-kitluy-project` added; **12** repositories. JSON validated                                                          |
| `workspace-control/REPOSITORY_REGISTRY.md`   | Monorepo section added above the existing KitLuy entries                                                                       |
| `workspace-control/FINAL_WORKSPACE_TREE.txt` | Tree updated to show the new location and the Drive mirror                                                                     |

## 8. Existing repositories — non-modification confirmed

| Repository                    | Branch                       | Dirty           | HEAD      | Changed? |
| ----------------------------- | ---------------------------- | --------------- | --------- | -------- |
| `kitluy-admin-portal`         | `main`                       | 0               | `b77bd61` | **No**   |
| `kitluy-chain-portal`         | `main`                       | 0               | `1303fa8` | **No**   |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring`       | 0               | `d5d1a26` | **No**   |
| `kitluy-partner-portal`       | `main`                       | 0 (behind 2)    | `e7e2576` | **No**   |
| `kitluy-suite-pos-desk-app`   | `chore/add-typecheck-verify` | **3** (ahead 3) | `3f66249` | **No**   |
| `kitluy-suite-supabase`       | `working-branch-veasna`      | 0               | `68a2b78` | **No**   |

Identical to the BEFORE snapshot. **`kitluy-suite-pos-desk-app`'s 3 uncommitted
files and 3 unpushed commits are intact.** No branch was switched, no repository
was pulled, reset, cleaned, or moved.

## 9. Environment changes (recorded, reversible)

Two environment actions were taken so that verification could run honestly
rather than being skipped or bypassed.

### 9.1 Node 22.23.0 installed via nvm

The repository's `engines.node` gate is `>=22.12.0 <23`; the system had only
`v24.14.1`, which **blocked every pnpm script**. Node 22.23.0 was installed
**alongside** v24.14.1 — nothing was removed and the nvm default was not changed.

```bash
nvm use 22.23.0 && corepack enable
```

### 9.2 `pnpm install --frozen-lockfile` re-run on Linux

`node_modules/.bin` contained **Windows shims** (`.CMD`/`.ps1`) without POSIX
execute bits, dated 2026-08-06 22:33 — **before this mission**. Every binary
failed with `Permission denied`. The turbo cache independently confirms a Windows
origin: it replays logs from `C:\dev\HET-KITLUY-PROJECT`.

| Property       | Result                                                                      |
| -------------- | --------------------------------------------------------------------------- |
| Lockfile       | **Unchanged** (`--frozen-lockfile`; `git status` clean for it)              |
| `node_modules` | Gitignored — not a tracked change                                           |
| Gates fixed    | Lint, Typecheck, Contract tests, Offline harness, Build, OpenAPI validation |

## 10. Verification results (2026-08-07)

### `pnpm secret:scan` — **PASS**

```text
Secret scan passed (1458 tracked files).
```

### `pnpm verify` — 10 PASS / 3 FAIL

| Gate                     | Result                                    |
| ------------------------ | ----------------------------------------- |
| Lint                     | **PASS**                                  |
| Typecheck                | **PASS**                                  |
| Contract tests           | **PASS**                                  |
| Offline harness          | **PASS**                                  |
| Build                    | **PASS**                                  |
| OpenAPI validation       | **PASS**                                  |
| Migration validation     | **PASS**                                  |
| Hub migration validation | **PASS**                                  |
| Secret scan              | **PASS**                                  |
| Clock usage              | **PASS** (4/4 required consumers)         |
| Format check             | **FAIL** — 50 pre-existing files          |
| Unit tests               | **FAIL** — environment precondition       |
| Docs link check          | **FAIL** — 4 pre-existing bare-UUID links |

### `pnpm docs:verify` — 7 PASS / 1 FAIL

| Gate                              | Result                                            |
| --------------------------------- | ------------------------------------------------- |
| Inbox state                       | **PASS**                                          |
| Hashes                            | **PASS**                                          |
| Duplicates & canonical collisions | **PASS**                                          |
| Classification & original links   | **PASS** (161 classified sources)                 |
| Authority index completeness      | **PASS**                                          |
| Coverage matrix vs filesystem     | **PASS** (101 PRESENT rows)                       |
| Status register evidence          | **PASS** (59 above-SPECIFIED rows carry evidence) |
| Internal links                    | **FAIL** — same 4 links                           |

### The three failures, characterized

**All three are pre-existing. None was introduced by this mission.**

1. **Unit tests** — `@kitluy/device-identity` integration suites fail with
   `relation "kitluy_devices.hardware_profiles" does not exist`,
   `role "kitluy_credential_issuer" does not exist`,
   `relation "kitluy_ops.durable_jobs" does not exist`.
   **Root cause:** the Supabase stack on ports 54321–54324 belongs to
   **`e-menu-platform`**, a different project (confirmed via running container
   names). KitLuy's schema is not there. This is an **environment precondition**,
   not a code defect. Not fixed — starting a KitLuy database is out of scope and
   `db:apply` touches a database.

2. **Format check** — 52 files failed initially; **2 were mine** and were
   formatted. The remaining **50 are pre-existing** and were deliberately left
   alone: `prettier --write .` would have rewritten 50 unrelated files, a scope
   violation.

3. **Docs link check** — 4 links in
   `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`
   whose targets are **bare UUIDs** (session IDs pasted as link targets). The
   referenced review documents **exist** and are correctly cited in the adjacent
   table column. **No documentation is missing** — this is a cosmetic authoring
   defect in a historical evidence record, left unedited.

## 11. Final counts

| Metric                        | Value                                             |
| ----------------------------- | ------------------------------------------------- |
| Project root                  | `repos/het-kitluy-project`                        |
| Branch / HEAD                 | `main` / `e9a7c39`                                |
| Working-tree entries          | 11 (all preparation deliverables; no source code) |
| Workspace packages            | 87                                                |
| Applications                  | 8                                                 |
| Services                      | 19                                                |
| Shared packages               | 43                                                |
| Verticals                     | 9 (+3 future clients)                             |
| Supabase migrations           | 87                                                |
| Documentation files           | 293                                               |
| Drive sources indexed         | 45                                                |
| Drive sources mirrored        | 2                                                 |
| Drive sources superseded      | 12                                                |
| Drive sources unresolved      | 0                                                 |
| AI handoff areas              | 9 + `preparation/`                                |
| Secret scan                   | **PASS**                                          |
| Broken local links            | 4 (pre-existing, cosmetic)                        |
| Missing referenced documents  | 0                                                 |
| Duplicate canonical documents | 0                                                 |

---

**Continue to:** `LOCAL_KNOWLEDGE_COMPLETENESS_REPORT.md` and
`NEXT_DEVELOPMENT_STEPS.md`.
