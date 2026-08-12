# Naming Migration — `kitluy-ecosystem` → `het-kitluy-project`

**Filename:** `NAMING_MIGRATION_2026-08-07.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT — **one open item requires an owner decision**
**Authority:** OWNER-LOCKED (records an explicit owner naming decision) + IMPLEMENTATION-EVIDENCE (observed results)
**Scope:** The local project-root rename and all filesystem path references
**Source documents:** Owner naming correction, 2026-08-07
**Supersedes:** the `HET-KITLUY-PROJECT` form as the _project_ name
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. The owner decision

| Kind                         | Value                                                         |
| ---------------------------- | ------------------------------------------------------------- |
| Technical project identifier | `het-kitluy-project`                                          |
| Local project path           | `~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project` |
| Human-readable project name  | **HET KitLuy Project**                                        |
| Product name                 | **KitLuy Suite** (unchanged)                                  |

Lowercase kebab-case applies to directory names, repository/workspace
identifiers, configuration references, scripts, registry paths and AI-agent path
references.

This **overrides** earlier instructions that used `HET-KITLUY-PROJECT` for the
project name.

## 2. What was renamed

```text
BEFORE  ~/Development/HET_VEASNA_WORKSPACE/repos/kitluy-ecosystem/
AFTER   ~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project/
```

Method: atomic `mv`, single filesystem. `kitluy-ecosystem` and
`het-kitluy-project` refer to the same local project workspace.

## 3. Child repositories — names unchanged, state preserved

| Repository                    | Branch                       | Dirty | HEAD      | Changed? |
| ----------------------------- | ---------------------------- | ----- | --------- | -------- |
| `kitluy-admin-portal`         | `main`                       | 0     | `b77bd61` | **No**   |
| `kitluy-chain-portal`         | `main`                       | 0     | `1303fa8` | **No**   |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring`       | 0     | `d5d1a26` | **No**   |
| `kitluy-partner-portal`       | `main`                       | 0     | `e7e2576` | **No**   |
| `kitluy-suite-pos-desk-app`   | `chore/add-typecheck-verify` | **3** | `3f66249` | **No**   |
| `kitluy-suite-supabase`       | `working-branch-veasna`      | 0     | `68a2b78` | **No**   |

Identical to the pre-rename capture. `kitluy-suite-pos-desk-app`'s **3
uncommitted files and 3 unpushed commits are intact.**

## 4. Git worktrees — broken by the rename, then repaired

This was the main technical hazard. Git worktrees store **absolute paths in both
directions**, so renaming the parent directory broke them.

### Affected

| Worktree                                                                   | Owning repository             |
| -------------------------------------------------------------------------- | ----------------------------- |
| `worktrees/kitluy-ecosystem/wt-agent3-custui`                              | `kitluy-laundry-pos-desk-app` |
| `worktrees/kitluy-ecosystem/wt-agent4-qa`                                  | `kitluy-laundry-pos-desk-app` |
| `kitluy-suite-pos-desk-app/.claude/worktrees/port-laundry-ui` (**locked**) | `kitluy-suite-pos-desk-app`   |

Immediately after the rename, `git status` inside a worktree failed with
`fatal: not a git repository`.

### Repair

`git worktree repair` was run from each owning repository. **No worktree was
deleted or pruned** — the locked worktree remains locked.

### Verified after repair

| Worktree           | Branch                 | HEAD      | Dirty          |
| ------------------ | ---------------------- | --------- | -------------- |
| `wt-agent3-custui` | `custui/customer-ui`   | `11d3dc2` | 0              |
| `wt-agent4-qa`     | `qa/customer-qa`       | `3fbb61c` | 0              |
| `port-laundry-ui`  | `feat/port-laundry-ui` | `3f66249` | locked, intact |

All identical to the pre-rename baseline.

## 5. Path references updated (24 files, ~78 references)

Only the **filesystem path form** `repos/kitluy-ecosystem` was replaced.

| Area                | Files                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace root      | `CLAUDE.md` (+ naming section), `WORKSPACE_STRUCTURE.md`                                                                                  |
| Registries          | `workspace.yaml` (24 refs), `repository-registry.json` (15), `REPOSITORY_REGISTRY.md`, `FINAL_WORKSPACE_TREE.txt`                         |
| Ecosystem knowledge | `README.md`, 3 `_source-notes/`, `kitluy/repository-map.md`, `machine-readable/repositories.json`, `repository-snapshot.md`               |
| Project root        | `repos/het-kitluy-project/CLAUDE.md` (rewritten header + naming block)                                                                    |
| Monorepo            | `CLAUDE.md`, `AGENTS.md`, `KIMI.md`, `PROJECT_HOME.md`, 3 × `docs/authority/`, `000_INDEX.md`, `000_CURRENT_STATE.md`, 4 × `preparation/` |
| Tooling             | `workspace-tools/scripts/capture-backend-diff.sh`                                                                                         |

`workspace.yaml`, `repository-registry.json` and
`ecosystem-knowledge/machine-readable/repositories.json` were **re-parsed and
validated** after editing. `capture-backend-diff.sh` passed `bash -n` and its
paths now resolve.

### Broken tooling found and fixed

`workspace-tools/scripts/capture-backend-diff.sh` hard-coded
`$REPO_ROOT/kitluy-ecosystem/kitluy-suite-supabase` in two places. Both were
**broken by the rename** and are now corrected.

## 6. Deliberately NOT changed

### Architectural and business terms

**"KitLuy Ecosystem"** and **"KitLuy Suite Ecosystem"** were **not** globally
replaced, per the owner instruction. They remain valid as the portfolio area and
as product-architecture terminology. Document _filenames_ containing
`kitluy-ecosystem` (e.g. `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`)
were likewise untouched.

### Historical records

Dated audit, migration and handoff records keep their original paths — rewriting
them would falsify history:

`backups/**`, `scratch/**`, `workspace-control/MIGRATION_SUMMARY.md`,
`PROJECT_LOCATION_CLEANUP_PLAN.md`, `PROJECT_LOCATION_CLEANUP_SUMMARY.md`,
`PROJECT_LOCATION_MIGRATION_MANIFEST.csv`, `migration-manifest.csv`,
`CLAUDE_CONFIGURATION_AUDIT.md`, `SECURITY_FINDINGS.md`, `UNRESOLVED_ITEMS.md`,
`PROJECT_LOCATION_UNRESOLVED_ITEMS.md`, and
`00_AI_HANDOFF/preparation/WORKSPACE_PREPARATION_BEFORE.md` (which carries a
marked correction note instead).

### Immutable evidence

`docs/source/**` was **not touched** — it holds hash-verified classified copies,
and `pnpm docs:verify` checks those hashes. Confirmed it contained no path-form
references.

### Child repositories

No file inside the six standalone repositories was edited. This means
`kitluy-laundry-pos-desk-app/.claude/settings.local.json` and two of its dated
handoffs still contain the old path — **recorded, not fixed**, because modifying
those repositories is out of scope.

### Sibling directories (owner decision covered `repos/` only)

| Path                                                     | Status                                                                                                                           |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `worktrees/kitluy-ecosystem/`                            | **Kept.** Holds two live worktrees; renaming would break them again                                                              |
| `environment-templates/kitluy-ecosystem/`                | **Kept**                                                                                                                         |
| `group_to_dir()` in `workspace-tools/scripts/_common.sh` | **Kept returning `kitluy-ecosystem` — this is correct.** It resolves `worktrees/<dir>/` only, and that directory was not renamed |
| `kitluy_ecosystem:` YAML group key                       | **Kept.** Consistent with sibling keys (`hsa_ecosystem`) and consumed by tooling                                                 |

Renaming `worktrees/kitluy-ecosystem/` would require updating `_common.sh` and
re-running `git worktree repair`. Say the word and it can be done as a follow-up.

## 7. OPEN ITEM — the consolidated monorepo

> **`repos/het-kitluy-project/` still uses the superseded
> uppercase form, and it does not appear in the owner's target tree.**

Facts:

- It is a **real Git repository** — 279 commits, branch `main`, HEAD `e9a7c39`,
  remote `Soenghak3301/HET-KITLUY-PROJECT` (push disabled).
- It is the consolidated Turborepo monorepo: 87 workspace packages, 8 apps,
  19 services, 43 packages, 87 Supabase migrations, 294 documents.
- It has its own `docs/` and `00_AI_HANDOFF/` at its root — the same names that
  appear as siblings in the owner's target tree.
- The owner's tree lists the six standalone repos plus `docs/`, `00_AI_HANDOFF/`,
  `project-control/`, `infrastructure/`, `shared-resources/`, `scripts/` — the
  monorepo is absent.
- The owner forbade `repos/kitluy-ecosystem/het-kitluy-project/` (now
  `repos/het-kitluy-project/het-kitluy-project/`) and `repos/HET-KITLUY-PROJECT/`.
- The owner also said "do not change established child repository names".

**Nothing was renamed, moved, dissolved or merged.** Dissolving it would destroy
a 279-commit repository with a live remote, which is irreversible without the
remote. That requires an explicit decision, not an inference.

See the question raised alongside this report.

## 8. Verification after the rename

| Check                                                                   | Result                               |
| ----------------------------------------------------------------------- | ------------------------------------ |
| All 7 repositories resolve and report correct branch/HEAD/dirty         | **PASS**                             |
| 3 worktrees repaired, branches/HEADs identical to baseline              | **PASS**                             |
| `workspace.yaml` parses; 7 KitLuy repositories listed                   | **PASS**                             |
| `repository-registry.json` parses; 12 entries                           | **PASS**                             |
| `ecosystem-knowledge/machine-readable/repositories.json` parses         | **PASS**                             |
| `capture-backend-diff.sh` syntax + path resolution                      | **PASS**                             |
| Zero stale `repos/kitluy-ecosystem` refs in current/authoritative files | **PASS**                             |
| `pnpm secret:scan`                                                      | **PASS**                             |
| `pnpm docs:verify`                                                      | 7/8 (same pre-existing link failure) |

---

**See also:** `WORKSPACE_PREPARATION_AFTER.md`, `EXISTING_REPOSITORY_MAP.md`,
`repos/het-kitluy-project/CLAUDE.md`.
