\
# Claude Code Instructions — KitLuy Suite

**Version:** v1.0.0  
**Parent contract:** `AGENTS.md`

Claude Code must follow `AGENTS.md`. This file adds Claude-specific operating behavior and does not grant additional authority.

## 1. Session bootstrap

At the start of every coding session:

1. Read `PROJECT_HOME.md`, `AGENTS.md`, this file, and the four `000_*` handoff control files.
2. Locate the assigned task and confirm its status is `READY` or `CLAIMED` by this agent.
3. Print or record the resolved repository root, branch, worktree, base commit, task ID, and allowed change paths.
4. Inspect the root `package.json`, lockfile, workspace configuration, Git status, and the exact source files named by the task.
5. Refuse to begin broad or unscoped implementation. You may draft task decomposition, but execute only one approved work package.

## 2. Planning behavior

Before edits, create a concise implementation plan tied to the acceptance criteria. The plan must identify:

- files likely to change;
- contracts or migrations affected;
- tests to add or update;
- security, authorization, audit, offline, and compatibility risks;
- documentation and handoff updates.

Do not make a hidden architecture decision when the source is ambiguous. Create a conflict report or blocker.

## 3. Tool and command discipline

- Prefer targeted repository searches and small file reads over indiscriminate corpus loading.
- Run commands from the current task worktree, never from another task's worktree.
- Use commands discovered in the live repository. Do not assume the example `pnpm` commands are valid.
- Avoid destructive Git and filesystem commands. Never run `git reset --hard`, `git clean -fdx`, history rewrites, or mass deletion unless an approved recovery task explicitly requires it.
- Do not change the base branch directly.
- Do not install global packages or alter host configuration without explicit task scope.
- Do not fetch, print, or persist production secrets.

## 4. Editing behavior

- Stay inside `FILES ALLOWED TO CHANGE`.
- Ask the task owner to expand scope rather than opportunistically editing unrelated files.
- Preserve existing code style and package boundaries.
- Add comments only where they explain invariants, security boundaries, or non-obvious behavior.
- For generated files, identify the generator and regenerate rather than hand-editing unless the repository says otherwise.
- For migrations, use additive forward-safe changes and include validation and rollback/forward-fix notes.

## 5. Testing behavior

Claude must record each command and result in `EVIDENCE_TEMPLATE.md` format.

- Run the narrowest relevant checks early.
- Run all task-required checks before handoff.
- Mark skipped checks `NOT RUN`; never imply they passed.
- Do not edit snapshots, fixtures, or expected outputs merely to hide a real regression.
- Include negative authorization, tenant-isolation, retry/idempotency, and offline tests where the task changes those boundaries.

## 6. Handoff behavior

Before stopping:

1. Re-read the task and map every acceptance criterion to evidence.
2. Review `git diff --check`, the final diff, and untracked files.
3. Confirm no secrets or unrelated changes are present.
4. Write a handoff using `HANDOFF_TEMPLATE.md`.
5. Write or update an evidence record using `EVIDENCE_TEMPLATE.md`.
6. Update `000_INDEX.md` with branch, worktree, commit, status, handoff, evidence, and requested reviewer.
7. Do not merge your own task unless an explicit emergency policy says otherwise.

## 7. Claude response format for coding tasks

Use this compact structure in the final task response:

```text
TASK: <ID> — <title>
STATUS: HANDOFF_READY | PARTIAL | BLOCKED
CHANGED: <paths>
VALIDATION: <commands and outcomes>
EVIDENCE: <record path>
HANDOFF: <record path>
RISKS/BLOCKERS: <none or exact list>
NEXT GATE: independent review
```

## 8. Prohibited Claude behavior

Claude must not:

- claim production, deployment, migration, pilot, or implementation success without evidence;
- bypass RLS, API authorization, approvals, or audit through service-role shortcuts;
- convert a task into an unreviewed multi-product refactor;
- silently reconcile contradictory sources;
- let a review agent edit the code it is reviewing;
- continue when another writer has claimed the same files.
