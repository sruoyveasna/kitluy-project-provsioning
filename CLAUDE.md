# CLAUDE.md — instructions for AI build agents in the KitLuy repository

## Repository location

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
```

## Canonical naming and architecture (owner decision, 2026-08-07)

| Kind                           | Value                                                         |
| ------------------------------ | ------------------------------------------------------------- |
| Technical project identifier   | `het-kitluy-project`                                          |
| Canonical Git repository       | `~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project` |
| Human-readable project name    | **HET KitLuy Project**                                        |
| Product name                   | **KitLuy Suite**                                              |
| Portfolio / architectural term | **KitLuy Ecosystem** (still valid — not replaced)             |

**This repository IS `repos/het-kitluy-project`.** It is simultaneously the
development root, documentation root, AI-handoff root, infrastructure root and
Supabase root. It is **not** contained inside another KitLuy directory, and
neither of these exists or may be created:

```text
repos/het-kitluy-project/HET-KITLUY-PROJECT/     <- removed 2026-08-07
repos/het-kitluy-project/het-kitluy-project/     <- never create
```

Use lowercase kebab-case for directory names, identifiers, configuration,
scripts and path references. The remote is still named
`Soenghak3301/HET-KITLUY-PROJECT` — that is the GitHub repository name and was
not changed.

### The six standalone repositories

They live **outside** this repository, at
`repos/het-kitluy-standalone-repos/`, classified
**`STANDALONE-MIGRATION-SOURCE`**. They are preserved reference and migration
sources — not deleted, not migrated, not obsolete.

**Do not modify them as part of monorepo work**, and do not copy code, merge
migrations, rewrite imports or merge history between them and this repository.
Mapping and next actions:
`docs/authority/STANDALONE_REPOSITORY_RECONCILIATION.md`.

## LOCAL-FIRST KNOWLEDGE POLICY (KL-DOCS-002, 2026-08-07)

**Develop from local documentation. Do not search Google Drive to start work.**

1. Read `PROJECT_HOME.md`.
2. Read `docs/authority/kitluy-source-of-truth-index-v1.0.0.md`.
3. Resolve the active product/feature documentation **locally** — use
   `docs/authority/LOCAL_DOCUMENTATION_MAP.md` to find it.
4. Read the relevant current handoff in `00_AI_HANDOFF/`.
5. Inspect live code, migrations and tests.
6. Use Google Drive **only** when one of these holds:
   - the local manifest says a required source is missing;
   - the owner explicitly requests a refresh;
   - a source conflict requires upstream verification;
   - the local source is known to be stale;
   - a new approved document is known to exist;
   - exact source provenance is required.

**Never re-scan all of Google Drive at the start of a task.** An authorized
query fetches identified documents by `drive_file_id` from
`exported-drive-docs/kitluy/DRIVE_SOURCE_MANIFEST.json` — it does not enumerate
folders or sweep by title. Full rules: `docs/authority/DRIVE_SYNC_POLICY.md`.

> **The repository outranks Drive.** Local canonical authority is rebuild bible
> **v4.0.0** and business bible **v2.0.0** (`docs/source/canonical/`). Drive's
> newest are v3.0.0 and v1.0.0 — both **superseded**. Do not use Drive material
> to "correct" local canonical documents without explicit owner authority.

## Cloud environment — READ BEFORE ANY CLAIM ABOUT "THE CLOUD"

The canonical cloud **development** Supabase project is:

```text
kitluy-project-pos   ref gjgbnkhuwlwhngbtrgts   PostgreSQL 17.6
```

`het-kitluy-dev` (`gkfcxxtryqmjnhujlkdr`) is **superseded and empty** — never
deploy to it. Authority: `KLD-2026-08-10-CLOUD-TARGET-001` in
`docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`.

Identifiers and credentials live OUTSIDE this repository at
`../../local-config/het-kitluy-project/supabase.env.local`. **Read the
non-secret identifiers there (`KITLUY_SUPABASE_PROJECT_REF`) before asserting
anything about hosted state.** Never print or commit the secret values.

Two facts that have each cost a session already:

1. **Project enumeration through one channel is not an inventory.** The
   `supabase` CLI and the claude.ai Supabase MCP connector on this workstation
   are authenticated to _different accounts_ and return disjoint project lists.
   Check both before declaring a project absent.
2. **Connect via the IPv4 session-mode pooler**
   (`aws-0-ap-southeast-1.pooler.supabase.com:5432`). `db.<ref>.supabase.co` is
   IPv6-only and the workstation has no IPv6 route; transaction mode (6543)
   cannot run DDL.

Deployment goes through `pnpm db:deploy:hosted-dev` only — an exact-project
allowlist, forward-only, destructive operations refused. `db:apply`/`db:reset`/
`db:seed` remain local-only (KL-INF-P1-037).

## Before any work

1. Read `PROJECT_HOME.md`.
2. Read `docs/authority/kitluy-source-of-truth-index-v1.0.0.md` and
   `docs/authority/kitluy-authority-and-precedence-v1.0.0.md`.
3. Read `docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md`
   — know what is actually built vs scaffolded.
4. Read the latest handoff in `00_AI_HANDOFF/` (see `000_INDEX.md`).

## Hard rules

1. Work only within the requested scope; record out-of-scope findings instead
   of fixing them silently.
2. Preserve product boundaries: apps never import other apps' internals;
   shared packages never import app code; neutral Core (`packages/`) never
   contains Laundry or other vertical terminology; provider clients stay
   behind adapters.
3. **Never auto-apply production migrations** (OWNER-LOCKED KL-INF-P1-037) —
   not from CI, not from app startup, not from this session.
4. **Never expose secrets.** No credentials in code, config, logs or docs.
   `.env.example` holds names only. Run `pnpm secret:scan` before finishing.
5. **Never call scaffolded functionality implemented.** Statuses advance only
   with evidence recorded in the evidence register.
6. **Never bypass the Store Hub** for normal Store operations — POS terminals
   do not write directly to Supabase.
7. **Never weaken RLS or permission checks.** Frontend visibility is not
   authorization. Four-eyes rules cannot be relaxed (`@kitluy/approvals`).
8. **Record conflicts instead of silently resolving them** in
   `docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md`,
   preserving the higher-authority decision.
9. Unknown owner/legal/commercial/production/credential/domain/provider values
   stay `[REQUIRED: description]` — never guessed.
10. Preserve the owner-locked T1–T4 Laundry model
    (`verticals/phase1-laundry`); reject any three-terminal mapping.
11. Financial, custody, inventory-movement and audit records are append-only;
    corrections are compensating records.
12. No floating-point money — use `@kitluy/money`.

## Before finishing any session

1. Run `pnpm verify` and report the ACTUAL result — never claim a command
   passed unless it was executed successfully.
2. Create a handoff note in `00_AI_HANDOFF/<area>/` using the template in
   `000_INDEX.md`.
3. Update `00_AI_HANDOFF/000_INDEX.md`.
4. Update the evidence register for any status that changed (with evidence).

## Reusable task template

```markdown
### Task

<one sentence>

### Authority

<spec/decision that authorizes this work, e.g. "RB v4 §10.2", "KLV4-DEC-005">

### Scope

In: <files/boundaries>. Out: <explicitly excluded>.

### Evidence target

<which register entries move, e.g. "SCAFFOLDED → BUILT for X, tests Y">

### Steps

1. Read PROJECT_HOME.md, authority pack, latest handoff.
2. <implementation steps>
3. pnpm verify (must pass).
4. Record conflicts/required values discovered.
5. Write handoff + update index + evidence register.
```

## Repository conventions

- Node version from `.nvmrc`; pnpm version pinned in `package.json`.
- Catalog versions in `pnpm-workspace.yaml` — never pin duplicates in leaves.
- Strict TypeScript; `pnpm lint`/`pnpm format` before finishing.
- Source citations in code comments for every rule taken from a spec
  (e.g. "Hub spec §11.2"), so the Rebuild Test holds.

## Parent contract (KL-BUILD-000, 2026-07-26)

`AGENTS.md` at the repository root is the swarm parent contract (installed
from the owner AI Swarm Operating System pack per the Phase 1 master build
plan execution instruction). This file adds repository-specific rules and
grants no authority beyond it. Task records use `00_AI_HANDOFF/TASK_TEMPLATE.md`;
reviews/evidence/conflicts use the sibling templates. State files:
`000_CURRENT_STATE.md`, `000_ACTIVE_PHASE.md`, `000_BLOCKERS.md`.
