# KIMI Swarm Instructions — KitLuy Suite

**Version:** v1.0.0  
**Parent contract:** `AGENTS.md`

KIMI Swarm must follow `AGENTS.md`. This file defines orchestration, worker isolation, review separation, and merge gates.

## 1. Swarm roles

Use explicit roles. Do not let a worker silently change roles mid-task.

| Role                     | Responsibility                                                                 | Write authority                                             |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Orchestrator             | Decomposes approved scope, assigns tasks, maintains dependency graph and index | Handoff control files only unless assigned a separate task  |
| Primary coding agent     | Implements exactly one task in one worktree                                    | Task allowlist only                                         |
| Independent review agent | Reviews source, tests, security, docs, and evidence                            | Review record only; code branch is read-only                |
| Integration/merge agent  | Verifies approved review and merges in dependency order                        | Merge operations and conflict resolution authorized by task |
| Evidence verifier        | Re-runs selected checks and validates evidence integrity                       | Evidence/review record only                                 |
| Human owner/operator     | Approves direction and sensitive production actions                            | As authorized by governance                                 |

One agent may perform multiple roles over time, but never primary writer and independent reviewer for the same task.

## 2. Swarm admission gate

The orchestrator must not dispatch a coding worker until the work package contains:

- stable task ID;
- one bounded outcome;
- dependencies and base commit;
- exclusive file/path ownership;
- non-goals and prohibited changes;
- acceptance tests and validation commands;
- rollback expectation;
- required evidence;
- assigned primary agent and reviewer.

If the instruction is broad, the orchestrator creates a dependency-ordered task map. It does not dispatch a worker with the broad instruction.

## 3. Worktree allocation

For every task:

1. Create one branch from the approved base.
2. Create one worktree bound to that branch.
3. Register branch, worktree path, base commit, primary agent, reviewer, and exclusive files in `000_INDEX.md`.
4. Verify no active task owns an overlapping file or migration range.
5. Dispatch exactly one primary coding agent.

A worker must stop and notify the orchestrator if it discovers:

- overlapping file ownership;
- a dependency not merged into the base;
- unexpected generated-file coupling;
- a required shared lockfile or registry owned by another task;
- a conflict between live code and authority documents.

## 4. Dependency and merge graph

The orchestrator maintains a directed acyclic dependency graph. Tasks merge in dependency order.

- Schema/contract tasks precede consumers.
- Authorization and identity foundations precede privileged UI flows.
- Store Hub local contracts precede POS clients that consume them.
- State-machine and business-rule tasks precede workflow UI.
- Generated clients/types merge after their source contract.
- Cross-cutting root configuration changes are isolated and serialized.

Do not merge two individually green tasks when their combined integration has not been tested and the tasks touch the same contract boundary.

## 5. Review separation

The independent reviewer:

1. Reads the task, source authorities, handoff, evidence, and final diff.
2. Verifies that changed files are within scope.
3. Re-runs or samples high-risk validation.
4. Reviews security, RLS/RBAC, tenant isolation, append-only records, audit, offline behavior, retries, compatibility, localization, and docs as applicable.
5. Produces `APPROVED`, `CHANGES_REQUESTED`, or `BLOCKED` using `REVIEW_TEMPLATE.md`.

The reviewer must not repair the task branch. Findings return to the primary writer. A different writer requires a new takeover or fix task and a new review.

## 6. Merge gate

The integration/merge agent may merge only when all are true:

- task status is `HANDOFF_READY`;
- independent review is `APPROVED`;
- critical and high findings are zero;
- required evidence records exist;
- validation evidence matches the reviewed commit;
- task branch is based on or rebased onto the approved integration point;
- required integration checks pass;
- conflicts have approved resolutions;
- no concurrent task still owns the same files;
- an authorized human has approved any sensitive production implication.

After merge, update `000_INDEX.md` with merge commit and status. Do not mark `DEPLOYED`, `PILOT_PROVEN`, or `IMPLEMENTED` unless separate evidence supports those states.

## 7. Failure containment

When a worker fails, stalls, or produces uncertain work:

- preserve the worktree and branch;
- record current commit and uncommitted diff state;
- write a partial handoff;
- mark exact unverified areas;
- do not reassign the same files until ownership transfer is recorded;
- do not let a replacement agent infer hidden context from chat alone.

## 8. KIMI task dispatch envelope

Every worker dispatch must contain:

```text
TASK FILE: <path>
TASK ID: <id>
ROLE: primary | reviewer | integrator | evidence-verifier
REPOSITORY ROOT: <resolved path>
BRANCH: <branch>
WORKTREE: <path>
BASE COMMIT: <sha>
ALLOWED CHANGES: <paths>
PROHIBITED CHANGES: <paths/actions>
DEPENDENCIES: <task IDs and merge commits>
EXPECTED OUTPUT RECORDS: <handoff/review/evidence paths>
STOP CONDITIONS: <blockers and overlap conditions>
```

## 9. Prohibited swarm patterns

- Multiple coding agents in one worktree.
- Multiple worktrees editing the same file concurrently.
- A single task spanning an entire product without bounded acceptance criteria.
- A reviewer making undocumented code changes.
- Merging based only on a worker's summary.
- Parallel migrations that compete for the same numbering or schema ownership.
- Mass autonomous production changes.
- Treating clone documents or competitor recommendations as KitLuy authority.

---

# Addendum KL-DOCS-002 — Local-First Knowledge Policy (2026-08-07)

> **Not part of the owner original.** Appended during the workspace preparation
> mission. Inherits from `AGENTS.md` Addendum KL-DOCS-002 and grants no
> authority beyond the parent contract.

## A.1 Repository location

```text
/home/veasna/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
```

Canonical repository/project name: **`HET-KITLUY-PROJECT`**.

## A.2 Orchestrator duty — resolve knowledge locally before dispatch

The orchestrator must **not** dispatch a coding worker to search Google Drive.
A work package is admissible only when its source references resolve to **local
paths**. Resolve them in this order:

1. `PROJECT_HOME.md`
2. `docs/authority/kitluy-source-of-truth-index-v1.0.0.md`
3. Active product/feature documentation — via `docs/authority/LOCAL_DOCUMENTATION_MAP.md`
4. The relevant current handoff in `00_AI_HANDOFF/`
5. Live code, migrations and tests

If a required source is genuinely missing locally, the **orchestrator** — not a
worker — retrieves that one document under `docs/authority/DRIVE_SYNC_POLICY.md`
§5, records it in the manifest, and only then dispatches.

## A.3 Prohibited swarm patterns (extending §9)

Add to the prohibited list:

- Dispatching a worker whose task requires a general Google Drive search.
- Multiple workers independently querying Google Drive for the same source.
- Re-scanning all of Google Drive at task start.
- Editing a Level A mirror (`exported-drive-docs/kitluy/`) or a `docs/source/`
  classified copy to resolve a contradiction — conflicts go in the decision
  register, never into evidence files.
- Treating a Drive document as canonical. Drive holds **no** CANONICAL-class
  KitLuy document; local `docs/source/canonical/` outranks it.
- Copying code between the six legacy KitLuy repositories and this monorepo —
  no migration is authorized.

## A.4 Review-agent duty

An independent reviewer must reject work whose source citations point at Google
Drive when an equivalent local canonical source exists, and must confirm that no
`[REQUIRED: …]` value was guessed and no status was advanced without evidence.
