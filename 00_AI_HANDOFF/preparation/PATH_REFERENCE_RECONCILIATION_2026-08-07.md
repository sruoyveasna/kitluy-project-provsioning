# Path Reference Reconciliation — 2026-08-07

**Filename:** `PATH_REFERENCE_RECONCILIATION_2026-08-07.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** IMPLEMENTATION-EVIDENCE (observed)
**Scope:** Every active path reference affected by the root repair
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED

## 1. The two substitutions

```text
repos/het-kitluy-project/HET-KITLUY-PROJECT  ->  repos/het-kitluy-project
repos/het-kitluy-project/kitluy-             ->  repos/het-kitluy-standalone-repos/kitluy-
```

Applied to **20 files, ~70 references**. The longer pattern was applied first so
the two never collided.

## 2. Files updated

| Area                | Files                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Workspace root      | `CLAUDE.md` (6 refs; architecture section also rewritten)                                                                |
| Registries          | `workspace.yaml` (22), `repository-registry.json` (15), `REPOSITORY_REGISTRY.md` (2)                                     |
| Ecosystem knowledge | `_source-notes/kitluy-pos-apps.md` (2), `_source-notes/kitluy-supabase.md` (1), `machine-readable/repositories.json` (6) |
| Tooling             | `workspace-tools/scripts/capture-backend-diff.sh` (2)                                                                    |
| Monorepo root       | `CLAUDE.md`, `AGENTS.md`, `KIMI.md`, `PROJECT_HOME.md`                                                                   |
| Monorepo governance | `docs/authority/DRIVE_SYNC_POLICY.md`, `docs/authority/LOCAL_DOCUMENTATION_MAP.md` (2)                                   |
| Monorepo handoff    | `000_INDEX.md`, `000_CURRENT_STATE.md`, `preparation/` × 4                                                               |

## 3. Validation

| Artefact                                                 | Check                                                 | Result   |
| -------------------------------------------------------- | ----------------------------------------------------- | -------- |
| `workspace.yaml`                                         | YAML re-parsed; 7 repositories resolve                | **PASS** |
| `repository-registry.json`                               | JSON re-parsed; 12 entries                            | **PASS** |
| `ecosystem-knowledge/machine-readable/repositories.json` | JSON re-parsed                                        | **PASS** |
| `capture-backend-diff.sh`                                | `bash -n`; both paths resolve on disk                 | **PASS** |
| `find-dirty-repos.sh`                                    | Resolves canonical **and** standalone roots correctly | **PASS** |
| `docs:verify` hashes                                     | `docs/source/**` untouched                            | **PASS** |

## 4. Registry identifier changes

| Field                                         | Before               | After                                                                                 |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `workspace.yaml` repository `name`            | `HET-KITLUY-PROJECT` | `het-kitluy-project` (+ `display_name`, `previous_directory_name`)                    |
| `workspace.yaml` group                        | `path` only          | added `canonical_monorepo_root`, `standalone_preservation_root`, `worktree_group_dir` |
| `repository-registry.json` `directory_name`   | `HET-KITLUY-PROJECT` | `het-kitluy-project`                                                                  |
| `repository-registry.json` standalone entries | —                    | `standalone_status: STANDALONE-MIGRATION-SOURCE`                                      |

The YAML group key stays **`kitluy_ecosystem`** — `group_to_dir()` maps it to
`worktrees/kitluy-ecosystem/`, which the owner instruction keeps unchanged.

## 5. Deliberately NOT changed

| Item                                                                     | Reason                                                                                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-control/KITLUY_PROJECT_ROOT_REPAIR_BEFORE_2026-08-07.md`      | Immutable evidence of pre-repair paths                                                                                                        |
| Dated records in `workspace-control/`, `backups/`, `scratch/`            | Historical evidence; rewriting would falsify history                                                                                          |
| `docs/source/**`                                                         | Hash-verified immutable copies; contains no path-form references                                                                              |
| Files inside the six standalone repositories                             | Out of scope. `kitluy-laundry-pos-desk-app/.claude/settings.local.json` and two dated handoffs still hold old paths — **recorded, not fixed** |
| `group_to_dir()` in `_common.sh`                                         | Returns `kitluy-ecosystem`; **correct** for worktree destinations                                                                             |
| `worktrees/kitluy-ecosystem/`, `environment-templates/kitluy-ecosystem/` | Owner instruction: worktree group naming is a separate concern                                                                                |
| Architectural terms "KitLuy Ecosystem" / "KitLuy Suite Ecosystem"        | Product/portfolio terminology, not paths                                                                                                      |
| Document filenames containing `kitluy-ecosystem`                         | e.g. `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — a document name, not a path                                                    |

## 6. Known residual references (recorded, not fixed)

| Path                                                                                        | Reason                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `repos/het-kitluy-standalone-repos/kitluy-laundry-pos-desk-app/.claude/settings.local.json` | Inside a standalone repository — modifying it is out of scope |
| Same repository's `docs/handoffs/2026-07-18__*.md` (2 files)                                | Historical handoffs inside a standalone repository            |
| `worktrees/kitluy-ecosystem/*/docs/handoffs/*`                                              | Historical handoffs inside worktrees                          |
| `.obsidian/workspace.json`                                                                  | Editor state; self-heals on next open                         |

None affects tooling or agent path resolution.
