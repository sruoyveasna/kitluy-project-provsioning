\
# Contributing to KitLuy Suite

All contributors, including AI agents, follow `AGENTS.md` and the active task package.

## 1. Contribution unit

Every change begins as a bounded task using `00_AI_HANDOFF/TASK_TEMPLATE.md`.

```text
one task
→ one branch
→ one worktree
→ one primary writer
→ one independent reviewer
→ evidence-gated merge
```

Do not open an implementation branch for a broad product request. Decompose it first.

## 2. Before claiming a task

Confirm:

- the task is `READY`;
- dependencies are merged or explicitly available in the approved base;
- no active task owns overlapping files;
- the allowed change list is complete;
- acceptance criteria and validation commands are executable;
- blockers and required owner decisions are resolved;
- a reviewer is assigned or requested.

Register the claim in `00_AI_HANDOFF/000_INDEX.md` before editing.

## 3. Branch and worktree conventions

Recommended branch:

```text
task/<lowercase-task-id>-<short-slug>
```

Recommended worktree:

```text
../worktrees/<lowercase-task-id>-<short-slug>
```

The exact path may vary by environment. Record the resolved path and base commit in the task and index.

Do not commit directly to protected integration or release branches. Do not force-push shared branches.

## 4. Commit conventions

Use focused commits that can be reviewed and reverted. Recommended subject:

```text
<task-id>: <imperative summary>
```

Examples:

```text
KL-P1-CORE-001: add digital store location constraints
KL-P1-HUB-001: validate provisioning certificate binding
KL-P1-POS-001: add T1 intake draft submission
```

Commit messages must not claim deployment or implementation evidence beyond the commit.

## 5. Change rules

- Change only task-allowed files.
- Preserve neutral Core terminology and vertical boundaries.
- Prefer additive migrations and backward-compatible contracts.
- Update contracts, docs, generated types, tests, and observability with behavior changes.
- Keep finalized finance, payment, inventory, custody, and audit records append-only.
- Enforce authorization in backend APIs and database policy, not only UI.
- Preserve Store Hub offline operation and cloud reconciliation behavior.
- Never add direct production database access for connectors.
- Never commit secrets, private keys, credentials, production payloads, or unredacted personal data.

## 6. Tests and evidence

The task defines required commands. Discover their exact syntax from the live repository.

At minimum, contributors should consider:

- formatting/lint;
- type checking;
- unit tests;
- component tests;
- contract/API tests;
- migration lint and local apply tests;
- RLS/RBAC and cross-tenant denial tests;
- idempotency/retry tests;
- offline/reconnect tests;
- integration and end-to-end tests;
- build/package tests;
- security and dependency checks;
- documentation validation.

Record results using `EVIDENCE_TEMPLATE.md`. A command not run is `NOT RUN`, not assumed pass.

## 7. Pull request / merge request requirements

A reviewable change must include:

- task ID and task file;
- problem and bounded solution;
- changed-file list;
- schema/API/event/permission/audit/offline impact;
- acceptance criteria mapped to evidence;
- test commands and results;
- screenshots only when they contain no sensitive data and improve review;
- migration and rollback notes;
- risks, blockers, and follow-up tasks;
- primary handoff record;
- independent review record.

## 8. Independent review

The reviewer must be independent of the primary writer and use `REVIEW_TEMPLATE.md`.

Review severity:

- `CRITICAL`: data exposure, cross-tenant access, destructive corruption, auth bypass, unrecoverable production risk.
- `HIGH`: major contract break, ledger/audit violation, offline outage risk, missing required migration protection.
- `MEDIUM`: functional defect, incomplete error handling, insufficient test or documentation coverage.
- `LOW`: maintainability, clarity, or minor consistency issue.
- `NOTE`: non-blocking observation.

`CRITICAL` and `HIGH` findings block merge. Required `MEDIUM` findings also block merge until resolved or explicitly accepted by the authorized owner.

## 9. Merge and post-merge

Only an authorized integration/merge agent or human merges after review approval and evidence verification.

After merge:

- record the merge commit in `000_INDEX.md`;
- update current state when the merge changes repository truth;
- close or archive the worktree only after evidence and handoff are preserved;
- create separate release/deployment tasks;
- do not label work deployed or pilot-proven from a merge alone.

## 10. Documentation contributions

Documentation follows the same one-writer and review rules. When changing authority documents:

- state version and supersession;
- preserve source traceability;
- separate target specification from implementation evidence;
- update indexes and conflict/decision registers;
- do not promote competitor or clone content into KitLuy truth without owner adoption.
