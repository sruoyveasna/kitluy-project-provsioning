# Workspace Preparation — BEFORE Snapshot

**Filename:** `WORKSPACE_PREPARATION_BEFORE.md`
**Version:** v1.0.0
**Date:** 2026-08-07 09:37 +07 (Asia/Phnom_Penh)
**Owner:** HET / KitLuy Suite Project Owner
**Status:** EVIDENCE — immutable record of state prior to preparation
**Authority:** IMPLEMENTATION-EVIDENCE (observed filesystem and Git facts)
**Scope:** `HET-KITLUY-PROJECT` and the six existing KitLuy repositories
**Source documents:** direct inspection only
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** OBSERVED — every value below was read from the live system

> This snapshot was captured **before any modification**. It is the rollback
> reference for the preparation mission.

> **NAMING CORRECTION (2026-08-07, later the same day).** Paths in this snapshot
> read `repos/kitluy-ecosystem/…`. That directory was subsequently renamed to
> **`repos/het-kitluy-project/`** by owner decision. The paths below are
> **left unchanged deliberately** — this is an immutable evidence record of the
> state at capture time, and rewriting it would falsify the rollback reference.
> For current paths see `WORKSPACE_PREPARATION_AFTER.md` and
> `NAMING_MIGRATION_2026-08-07.md`.

## 1. Project location (before)

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/HET-KITLUY-PROJECT
```

The project sat at the **workspace root**, not under `repos/`. This violates
the workspace rule "All Git repositories belong under `repos/`"
(`HET_VEASNA_WORKSPACE/CLAUDE.md`).

**No temporary name was found.** The directory was already named
`HET-KITLUY-PROJECT`. No variant (`kitluy-eco-systen`, `kitluy-eco-system`,
`kitluy-ecosystem-project`, `kitluy-project`) existed anywhere in the
workspace. The mission's rename step was therefore **not applicable**; only a
relocation was required.

**No collision:** `repos/kitluy-ecosystem/HET-KITLUY-PROJECT` did not exist
before this mission.

## 2. Git state (before)

| Property            | Value                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| Is a Git repository | Yes (`.git` present)                                                      |
| Current branch      | `main`                                                                    |
| Working tree        | **Clean** — 0 modified/untracked files                                    |
| Tracked files       | 1,458                                                                     |
| Total commits       | 279                                                                       |
| HEAD                | `e9a7c39 feat(ws-12): complete customer intake and draft synchronization` |
| Remote (fetch)      | `https://github.com/Soenghak3301/HET-KITLUY-PROJECT.git`                  |
| Remote (push)       | `disabled://push-requires-owner-approval` — push already disabled         |
| Branches            | `main` only (local); `origin/main`                                        |
| Worktrees           | 1 (the project root itself)                                               |

The push URL was **already disabled before this mission**. It was not changed.

## 3. Toolchain (before)

| Property                | Value                                         |
| ----------------------- | --------------------------------------------- |
| `.nvmrc`                | `22.23.0`                                     |
| Node actually installed | `v24.14.1`                                    |
| `packageManager`        | `pnpm@9.15.9`                                 |
| pnpm resolved           | `9.15.9` (via Corepack)                       |
| `pnpm-lock.yaml`        | Present (294,732 bytes)                       |
| Turborepo               | `turbo.json` present, `.turbo/` cache present |
| TypeScript              | catalog-pinned `~5.7.2`                       |

**Recorded finding (not fixed):** the installed Node `v24.14.1` does not match
`.nvmrc` `22.23.0`. Out of scope for workspace preparation — see
`NEXT_DEVELOPMENT_STEPS.md`.

## 4. Workspace packages (before)

`pnpm-workspace.yaml` globs: `apps/*`, `services/*`, `packages/*`,
`verticals/*`, `future-clients/*`.

| Category                                        | Count |
| ----------------------------------------------- | ----- |
| Total `package.json` (excluding `node_modules`) | 87    |
| Applications (`apps/`)                          | 8     |
| Services (`services/`)                          | 19    |
| Shared packages (`packages/`)                   | 43    |
| Verticals (`verticals/`)                        | 9     |
| Future clients (`future-clients/`)              | 3     |

## 5. Directory topology (before)

```text
HET-KITLUY-PROJECT/
├── 00_AI_HANDOFF/     (apps, data, evidence, infrastructure, repository,
│                       reviews, services, shared, tasks + 10 templates/state files)
├── apps/              (8)
├── services/          (19)
├── packages/          (43)
├── verticals/         (phase1-laundry, phase1-laundry-persistence, phase2-8)
├── future-clients/    (3 — registered-inactive Phase 2+ clients)
├── hub/               (migrations, seed, tests)
├── supabase/          (config.toml, functions, generated, migrations,
│                       schemas, seed, snippets, tests)
├── infra/             (digitalocean, domains, kitluy-os-image, kubernetes,
│                       manufacturing-station, monitoring, policies,
│                       supabase, terraform)
├── docs/              (21 domains — see §6)
├── tests/             (chaos, contract, end-to-end, hardware, integration,
│                       load, offline, recovery, rls, security)
├── scripts/           (bootstrap, contracts, database, development, docs,
│                       hub, release, testing, verification)
└── root control files (PROJECT_HOME.md, CLAUDE.md, AGENTS.md, KIMI.md,
                        README.md, SECURITY.md, CONTRIBUTING.md,
                        CODE_OF_CONDUCT.md, LICENSE)
```

### Structural differences vs the mission's target diagram

These are **deliberate divergences preserved as working implementation**. Per
mission §6, large working trees are not moved to match a planning diagram.

| Mission diagram                                                   | Live repository                                                                              | Decision                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `future/`                                                         | `future-clients/`                                                                            | **Keep live name** — more descriptive, in use by `pnpm-workspace.yaml`       |
| `docs/00-governance/`                                             | `docs/authority/`                                                                            | **Keep live name** — all 8 required governance documents already exist there |
| `tooling/`                                                        | `scripts/` (9 subdirs)                                                                       | **Keep live name** — equivalent role, already populated                      |
| `supabase/{migrations,functions,seed,tests}`                      | present, plus `schemas/`, `generated/`, `snippets/`, `config.toml`                           | **Keep** — superset of the target                                            |
| `infra/*`                                                         | present, plus `manufacturing-station/`                                                       | **Keep** — superset of the target                                            |
| `tests/{unit,integration,contract,e2e,offline,security,fixtures}` | `chaos, contract, end-to-end, hardware, integration, load, offline, recovery, rls, security` | **Keep live names** — superset; `e2e`→`end-to-end`                           |
| (not in diagram)                                                  | `hub/`                                                                                       | **Keep** — Store Hub migrations/seed/tests                                   |
| `docs/` flat 00–99 numbering                                      | 21 named domains                                                                             | **Keep** — established and cross-linked by 290 documents                     |

## 6. Documentation state (before)

**290 Markdown documents** under `docs/`.

| Domain                                                                                                                                  | Docs   |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `docs/source/`                                                                                                                          | 197    |
| `docs/evidence/`                                                                                                                        | 33     |
| `docs/decisions/`                                                                                                                       | 18     |
| `docs/data/`                                                                                                                            | 9      |
| `docs/authority/`                                                                                                                       | 8      |
| `docs/security/`                                                                                                                        | 7      |
| `docs/runbooks/`                                                                                                                        | 3      |
| `docs/jobs/`                                                                                                                            | 2      |
| `api, architecture, business-rules, events, generated, infrastructure, offline, product, qa, services, superseded, verticals, webhooks` | 1 each |

### Governance pack — already complete

All eight required source-of-truth control documents **already existed** at
`docs/authority/` (the mission specified `docs/00-governance/`):

1. `kitluy-source-of-truth-index-v1.0.0.md`
2. `kitluy-authority-and-precedence-v1.0.0.md`
3. `kitluy-decision-and-reconciliation-register-v1.0.0.md`
4. `kitluy-open-decisions-and-required-values-v1.0.0.md`
5. `kitluy-implementation-status-and-evidence-register-v1.0.0.md`
6. `kitluy-superseded-document-register-v1.0.0.md`
7. `kitluy-glossary-and-naming-standard-v1.0.0.md`
8. `000_INDEX.md`

**Missing from that pack (created by this mission):** `DRIVE_SYNC_POLICY.md`,
`LOCAL_DOCUMENTATION_MAP.md`, `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`.

### Master bibles — present

`PROJECT_HOME.md` §2 states both master bibles are "NOT PRESENT". That claim is
**stale**; both are physically present at `docs/source/canonical/`:

- `kitluy-suite-rebuild-bible-v4.0.0.md`
- `kitluy-suite-business-bible-v2.0.0.md`

The stale claim is already annotated in the PROJECT_HOME addendum
(KLREC-2026-07-26-005) and is retained verbatim because owner text is never
silently edited.

### Existing source-provenance system

`docs/source/` already implements a provenance model with `manifests/`
(inventory v1.0.0–v1.2.0 in md/json/csv, plus a source document manifest),
`inbox/` (empty — all originals processed), `canonical/`, `processed/`,
`superseded/`, and 20+ classification folders. The workspace-level Drive mirror
created by this mission **complements** this; it does not replace it.

## 7. Existing AI handoff system (before)

`00_AI_HANDOFF/` already contained:

- State files: `000_INDEX.md`, `000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`, `000_BLOCKERS.md`
- Templates: `TASK_TEMPLATE.md`, `HANDOFF_TEMPLATE.md`, `REVIEW_TEMPLATE.md`, `CONFLICT_TEMPLATE.md`, `ROLLBACK_TEMPLATE.md`, `EVIDENCE_TEMPLATE.md`
- Work areas: `apps/`, `data/`, `evidence/`, `infrastructure/`, `repository/`, `reviews/`, `services/`, `shared/`, `tasks/`
- `OPERATOR-INSTRUCTION-BLK-002.md`, two WS-11 package files

**Missing (created by this mission):** `preparation/`. The mission also names
`active/` and `archive/`; the live equivalents are `tasks/` (active work) and
the per-area folders. See the AFTER report for the decision.

## 8. Supabase state (before)

| Property               | Value                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| Migrations             | **87**                                                                                               |
| Structure              | `config.toml`, `functions/`, `generated/`, `migrations/`, `schemas/`, `seed/`, `snippets/`, `tests/` |
| Production application | Not performed by this mission (OWNER-LOCKED KL-INF-P1-037)                                           |

## 9. Workspace-level Drive mirror (before)

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/exported-drive-docs/
```

**Empty.** No `kitluy/` subtree, no manifest.

## 10. Existing KitLuy repositories — protected baseline

Captured to prove non-modification. **None of these was modified by this mission.**

| Repository                    | Branch                       | Dirty files | HEAD                                                             | Sync state             |
| ----------------------------- | ---------------------------- | ----------- | ---------------------------------------------------------------- | ---------------------- |
| `kitluy-admin-portal`         | `main`                       | 0           | `b77bd61 docs: add README`                                       | in sync                |
| `kitluy-chain-portal`         | `main`                       | 0           | `1303fa8 docs: add README`                                       | in sync                |
| `kitluy-laundry-pos-desk-app` | `feat/full-app-wiring`       | 0           | `d5d1a26 feat: update environment configuration…`                | in sync                |
| `kitluy-partner-portal`       | `main`                       | 0           | `e7e2576 feat: implement portal application shell…`              | **behind 2**           |
| `kitluy-suite-pos-desk-app`   | `chore/add-typecheck-verify` | **3**       | `3f66249 feat(ui): port laundry UI…`                             | **ahead 3 (unpushed)** |
| `kitluy-suite-supabase`       | `working-branch-veasna`      | 0           | `68a2b78 feat(pos): implement POS login and terminal access API` | in sync                |

### Preservation flags

- **`kitluy-suite-pos-desk-app`** carries **3 uncommitted files and 3 unpushed
  commits**. Highest preservation priority in the workspace.
- **`kitluy-suite-supabase`** is currently **in sync** with
  `origin/working-branch-veasna`. The standing workspace warning about
  "unpushed local commits" does not apply at this snapshot, but the branch
  remains non-default and must not be switched.
- **`kitluy-partner-portal`** is **behind 2** commits. Not pulled by this
  mission — pulling is a separate authorized action.

## 11. Relocation risk assessment (performed before the move)

| Check                                                               | Result                                       |
| ------------------------------------------------------------------- | -------------------------------------------- |
| Absolute-path references to `HET_VEASNA_WORKSPACE` in tracked files | **0** — safe to relocate                     |
| `.env` / `.env.local` files                                         | **None** — only `.env.example` (names only)  |
| Symlinks escaping the project (outside `node_modules`)              | **None**                                     |
| Target path already occupied                                        | **No**                                       |
| Same filesystem (rename is atomic)                                  | Yes — `mv` within `/home/veasna/Development` |
| pnpm `node_modules` links                                           | Relative — survive relocation                |

**Conclusion:** relocation by `mv` is safe and fully reversible.

## 12. Known conflicts carried into this mission

From `PROJECT_HOME.md` §"Current blockers" (not resolved here):

1. **KLREQ-001** — Supabase documentation pack incomplete (schema, RLS/authorization, migration-plan documents missing).
2. **KLREC-2026-07-26-001** — `/edge/v1` route fork between Store Hub LAN API and Edge Operations API; Hub business routes blocked.
3. **KLREQ-007** — owner documentation-program instruction (`Pasted text.txt`) not physically supplied.
4. **KLREC-2026-07-26-009..013** — contract/code drifts pending owner confirmation: terminal-profile identifiers, error-code names, event-name format, scope taxonomy, permission-key delimiters.

## 13. Known missing directories (before)

| Path                                                  | Status                                  |
| ----------------------------------------------------- | --------------------------------------- |
| `repos/kitluy-ecosystem/HET-KITLUY-PROJECT`           | Missing — project was at workspace root |
| `exported-drive-docs/kitluy/`                         | Missing — mirror never created          |
| `00_AI_HANDOFF/preparation/`                          | Missing                                 |
| `docs/authority/DRIVE_SYNC_POLICY.md`                 | Missing                                 |
| `docs/authority/LOCAL_DOCUMENTATION_MAP.md`           | Missing                                 |
| `docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md` | Missing                                 |

---

**End of BEFORE snapshot.** Continue to `WORKSPACE_PREPARATION_AFTER.md`.
