# Next Development Steps

**Filename:** `NEXT_DEVELOPMENT_STEPS.md`
**Version:** v1.0.0
**Date:** 2026-08-07
**Owner:** HET / KitLuy Suite Project Owner
**Status:** CURRENT
**Authority:** REFERENCE (recommendations; authorizes nothing on its own)
**Scope:** What to do after workspace preparation
**Source documents:** all preparation deliverables; verification output
**Supersedes:** none
**Superseded by:** none
**Implementation evidence status:** N/A

## 1. Immediate next step (recommended)

> **Review and commit the preparation deliverables.**

The working tree holds **7 uncommitted entries**, all produced by this mission.
Nothing was committed because no commit was requested.

```bash
cd /home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
nvm use 22.23.0 && corepack enable
git status
git diff AGENTS.md CLAUDE.md KIMI.md
```

The three modified files received **additive** changes only (a new section in
`CLAUDE.md`; clearly-marked addenda appended to `AGENTS.md` and `KIMI.md`). The
four added paths are new documents.

The workspace-control registry changes (`workspace.yaml`,
`repository-registry.json`, `REPOSITORY_REGISTRY.md`, `FINAL_WORKSPACE_TREE.txt`)
are **outside the repository** — the workspace root is not a Git repository, so
they are not part of any commit.

## 2. Owner decisions that unblock work

These **cannot be resolved by analysis** — they need your decision.

### 2.1 KLDRV-CONF-001 — vocabulary (blocks POS work)

Owner decision `KLDRV-0001` (2026-07-18) mandates **Order → Service → Service
Item** for `kitluy-laundry-pos-desk-app`. The monorepo's owner-locked T1 model
uses **Laundry Booking**. Both are owner authority at the same level, scoped to
different repositories.

**Decide:** does `KLDRV-0001` (a) apply only to the legacy repository,
(b) stand superseded by the monorepo T1 decisions, or (c) require reconciliation
into one vocabulary?

### 2.2 KLDRV-CONF-003 — POS desktop base

`kitluy-laundry-pos-desk-app` and `kitluy-suite-pos-desk-app` both map to
`apps/kitluy-pos-desktop-app/`. **Decide which is the base** and which
contributes features.

### 2.3 KLDRV-CONF-004 — Supabase migration lineage

21 legacy migrations vs 87 monorepo migrations; the relationship is unrecorded.
**Authorize a comparison analysis** (read-only, per environment) before any
consolidation. Never auto-apply production migrations — `KL-INF-P1-037`.

## 3. Pre-existing blockers (unchanged)

| ID                            | Item                                                                                                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **KLREQ-001**                 | Supabase documentation pack incomplete — schema, RLS/authorization, migration-plan documents missing                               |
| **KLREC-2026-07-26-001**      | `/edge/v1` route fork between Store Hub LAN API and Edge Operations API — **Hub business routes blocked**                          |
| **KLREQ-007**                 | Owner documentation-program instruction (`Pasted text.txt`) never supplied                                                         |
| **KLREC-2026-07-26-009..013** | Contract/code drifts: terminal-profile identifiers, error-code names, event-name format, scope taxonomy, permission-key delimiters |

## 4. Environment items (recorded, not fixed)

These were found during verification and are **outside workspace/document
preparation scope**.

### 4.1 Node version — resolved for this session, not persisted

`.nvmrc` requires `22.23.0`; the system default is `v24.14.1`, which the repo's
`engines` gate rejects. Node 22.23.0 was installed alongside it.

**Every session must activate it:**

```bash
nvm use 22.23.0 && corepack enable
```

Consider making this automatic (`.nvmrc` auto-switch in your shell profile), or
ask whether the engines range should widen to accept Node 24. **Not changed** —
that is a project decision.

### 4.2 Local Supabase belongs to another project

Ports 54321–54324 are held by **`e-menu-platform`**, not KitLuy. This is why
`@kitluy/device-identity` integration tests fail with missing relations and
roles.

To run them, start a KitLuy local stack and apply migrations:

```bash
pnpm supabase:start
pnpm db:apply     # touches a database — confirm intent first
pnpm test
```

**Not performed** — starting a database and applying 87 migrations is outside
preparation scope.

### 4.3 Windows-origin build artifacts

The turbo cache replays paths from `C:\dev\HET-KITLUY-PROJECT`. `pnpm install`
was re-run on Linux (fixing six gates), but the **turbo cache was left alone**.
If stale-cache behavior appears:

```bash
rm -rf .turbo    # destructive to cache only; not run by this mission
```

Also present: a `.DS_Store` file at the repository root (macOS artifact). Left
in place.

### 4.4 Pre-existing format failures

50 files fail `prettier --check`. **Deliberately not fixed** — running
`prettier --write .` would rewrite 50 unrelated files, a scope violation. Fix
them in a dedicated formatting task:

```bash
pnpm format        # rewrites ALL files — run only as its own reviewed change
```

### 4.5 Four cosmetic broken links

`00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`
has 4 markdown links whose targets are bare UUIDs. The referenced review
documents **exist** and are cited correctly alongside. Fixing requires editing a
historical evidence record — do it deliberately, if at all.

## 5. Recommended sequence

1. **Review and commit** the preparation deliverables (§1).
2. **Decide KLDRV-CONF-001** — unblocks POS-desktop work.
3. **Resume Phase 1 — Laundry** on the active WS-12 T1 intake/cashier
   workstream (`00_AI_HANDOFF/000_ACTIVE_PHASE.md`, latest commits are WS-12).
4. Optionally start a KitLuy local Supabase so the full test suite runs (§4.2).
5. Only then consider consolidation — and only under a separate, explicitly
   authorized migration task (§2.2, §2.3).

## 6. How a new session should start

```bash
cd /home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
nvm use 22.23.0 && corepack enable
git status
```

Then read, in order:

1. `CLAUDE.md` — hard rules + local-first policy
2. `PROJECT_HOME.md` — identity and locked direction
3. `docs/authority/LOCAL_DOCUMENTATION_MAP.md` — where everything is
4. `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md` — built vs scaffolded
5. `00_AI_HANDOFF/000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`, `000_BLOCKERS.md`

**Do not search Google Drive to start work** — `docs/authority/DRIVE_SYNC_POLICY.md` §5.

## 7. What this mission deliberately did not do

- No commit, no push, no remote change
- No code migration between repositories
- No Git history merged or rewritten
- No production migration applied
- No legacy repository modified, moved or retired
- No conflict silently resolved
- No `[REQUIRED: …]` value guessed
- No implementation status advanced without evidence
- No `docs/00-governance/` created (would duplicate `docs/authority/`)
- No large source tree moved to match the planning diagram

---

**See also:** `WORKSPACE_PREPARATION_AFTER.md`,
`DOCUMENT_RECONCILIATION_REPORT.md`, `EXISTING_REPOSITORY_MAP.md`.
