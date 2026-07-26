# KitLuy Suite Agent Operating Contract

**Version:** v1.0.0  
**Effective date:** 2026-07-26  
**Applies to:** every human, Claude Code agent, KIMI Swarm agent, review agent, automation, and coding assistant operating in this repository  
**Status:** repository-root control document

## 1. Mission

Build KitLuy Suite predictably through small, evidence-backed work packages while preserving the locked Cambodia-first, Digital Store-first, offline-capable, vertically phased architecture.

No agent receives authority merely because it can edit files or run commands. Authority comes from an assigned task, approved source documents, repository evidence, explicit scope, and human approval where required.

## 2. Mandatory startup sequence

Before changing any file, every agent must:

1. Resolve the repository root with `git rev-parse --show-toplevel` when Git is available.
2. Read, in order:
   - `PROJECT_HOME.md`
   - `AGENTS.md`
   - the applicable tool file: `CLAUDE.md` or `KIMI.md`
   - `00_AI_HANDOFF/000_CURRENT_STATE.md`
   - `00_AI_HANDOFF/000_ACTIVE_PHASE.md`
   - `00_AI_HANDOFF/000_BLOCKERS.md`
   - the assigned task file created from `00_AI_HANDOFF/TASK_TEMPLATE.md`
   - the latest relevant handoffs and reviews in `00_AI_HANDOFF/000_INDEX.md`
3. Inspect the live repository files named by the task.
4. Confirm the branch, worktree, primary writer, file ownership, and dependencies.
5. Stop before implementation when the task is broad, unassigned, blocked, or lacks acceptance tests.

Reading documentation is not a substitute for inspecting the live code, migration history, lockfile, configuration, and test commands.

## 3. Authority and conflict order

Use this order when facts conflict:

1. Current versioned project-owner decisions and active KitLuy project instructions.
2. Applied migrations, verified code, executable tests, deployment records, and production evidence for the relevant environment.
3. Current approved KitLuy Rebuild Bible, Business Bible, canonical contracts, standards, and product specifications.
4. Approved task handoffs and independent reviews.
5. Evidence-based competitor analyses and product classifications.
6. Competitor clone/rebuild documents as design references only.
7. Superseded planning.

Do not silently choose between authoritative documents and live implementation. Record the conflict with `00_AI_HANDOFF/CONFLICT_TEMPLATE.md`, preserve data and compatibility, and request an owner decision when the conflict affects product truth.

## 4. Locked KitLuy rules

Every task must preserve these rules unless a newer versioned owner decision explicitly supersedes one:

- Roadmap order is Laundry, Café/Restaurant, eCommerce, Convenience, Pharmacy, Department Store, Grocery, Supermarket.
- Phase 1 is Laundry. Build shared capability only to the level required by Phase 1 and confirmed near-term reuse.
- One Digital Store belongs to exactly one primary vertical. Different business types require separate Digital Stores under the same Tenant or Partner account.
- The Digital Store is the control plane. A physical Store Location is an optional offline-capable edge environment.
- Store Hub is the local operational authority after provisioning. Internet failure must not stop local operations.
- Laundry terminal roles are T1 POS Cashier/Intake, T2 Customer Display Screen, T3 Clean & Ready Scan-In, and T4 Customer Pickup Scan-Out.
- T3 and T4 may share hardware but remain separate modes, permissions, workflows, and audit events.
- Use neutral Core entities. Never hardcode Laundry terminology into shared Core.
- Reuse Core transactions, payments, inventory, customers, finance, reporting, permissions, files, jobs, webhooks, audit, integrations, and AI controls.
- Finalized finance, payment, inventory, custody, and audit records are append-only. Corrections use approved compensating records.
- Authoritative data belongs in relational tables. JSON is optional metadata, not primary business truth.
- APIs and events are versioned, idempotent, scoped, auditable, retry-safe, and backward-compatible by default.
- Enforce Tenant, Digital Store, Store Location, user, role, and device isolation in backend authorization and database policy.
- Connectors never receive direct production-database access and never own customer, inventory, payment, or finance truth.
- Sensitive financial, permission, compliance, production, or safety actions require authorized human confirmation; four-eyes approval applies where policy requires it.
- Support Khmer and English, KHR and USD, `Asia/Phnom_Penh`, and KHQR.
- Releases are signed, staged, health-checked, distributed through Store Hub where applicable, and support rollback.
- Never label a capability `IMPLEMENTED` without repository, migration, test, deployment, and required pilot or production evidence.
- Reporting, analytics, historical retention, exports, and data services are not commercially paywalled. Security, privacy, performance, and abuse controls may apply.

## 5. One task, one branch, one worktree, one writer

The mandatory execution unit is:

```text
one task
→ one branch
→ one worktree
→ one primary coding agent
→ one independent review agent
→ merge only after evidence
```

Rules:

1. A task may have only one primary writer at a time.
2. Two agents must not edit the same file concurrently, even from different worktrees.
3. The task must declare an exclusive `FILES ALLOWED TO CHANGE` list or path boundary.
4. Shared files such as lockfiles, root configuration, migrations, registries, and generated types require explicit ownership in `000_INDEX.md`.
5. A review agent is read-only on the task branch. It produces a review record; it does not quietly fix the code it reviewed.
6. Review findings return to the primary writer. A separate fix task is required when another writer must take over.
7. Never force-push over another agent, rewrite shared history, delete another worktree, or use destructive cleanup to hide conflicts.

Recommended branch convention:

```text
task/<lowercase-task-id>-<short-slug>
```

Recommended worktree convention:

```text
../worktrees/<lowercase-task-id>-<short-slug>
```

## 6. Work packages only

Broad instructions are not executable tasks.

Prohibited examples:

```text
Build the Partner Portal.
Implement the backend.
Finish Phase 1.
Fix all security issues.
```

Acceptable examples:

```text
KL-P1-CORE-001 — Establish Tenant/Digital Store/Store Location schema
KL-P1-AUTH-001 — Implement identity bootstrap and memberships
KL-P1-HUB-001 — Implement Hub identity and provisioning
KL-P1-LND-001 — Implement Laundry Booking lifecycle
KL-P1-POS-001 — Implement T1 intake foundation
```

Every work package must state:

- task ID and title;
- active phase and product/build;
- outcome and non-goals;
- dependencies and blockers;
- authority documents and exact sections;
- files to inspect;
- files allowed to change;
- prohibited changes;
- schema, API, event, permission, audit, offline, localization, and observability impact;
- acceptance criteria;
- exact validation commands;
- rollback approach;
- evidence required;
- mandatory handoff and independent review.

## 7. Implementation discipline

- Make the smallest coherent change that satisfies the task.
- Preserve working behavior outside task scope.
- Prefer additive and backward-compatible migrations.
- Do not move or rename large trees to match a planning diagram without a dedicated approved refactor task.
- Do not invent package names, commands, environment variables, routes, schemas, or statuses. Inspect the live repository first.
- Do not add speculative later-phase features. Record future requirements without implementing them.
- Do not bypass established service boundaries for convenience.
- Do not use frontend visibility as authorization. Enforce permissions in APIs and database policies.
- Do not weaken tests to make a build pass.
- Do not replace a real integration with fake success. Clearly label mocks, stubs, fixtures, cached data, and demonstrations.
- Do not expose secrets, personal data, payment credentials, device private keys, or production records in prompts, logs, commits, screenshots, or handoffs.

## 8. Database and production controls

Agents may author and review migration files. Agents must not:

- auto-apply production migrations;
- connect directly to production unless an explicitly authorized, audited, human-supervised task permits read-only verification;
- reset, reseed, truncate, or restore a shared environment;
- change production secrets, DNS, certificates, payment settings, release channels, or device trust without authorized human execution;
- alter finalized ledger or audit rows destructively.

Every database task must include migration order, rollback or forward-fix strategy, RLS impact, validation SQL, seed impact, compatibility, and evidence that production was not modified by the coding agent.

## 9. Validation and evidence

Use only commands confirmed by the live repository. A task is not complete until the required checks are run or explicitly marked `NOT RUN` with a reason.

Evidence must distinguish:

- file written;
- build passed;
- unit tests passed;
- integration/contract tests passed;
- migration validated locally;
- migration applied to a named environment;
- deployment completed;
- smoke test passed;
- pilot or production behavior observed.

A build passing does not prove authorization, RLS, data integrity, offline continuity, deployment readiness, or product completion.

## 10. Completion gate

A primary agent may mark a task `HANDOFF_READY` only when:

- scope is complete;
- changed files match the task allowlist;
- acceptance criteria are mapped to evidence;
- tests and validation are recorded accurately;
- unresolved risks and blockers are explicit;
- rollback instructions are present;
- docs and contracts are updated when behavior changed;
- the handoff and index are updated.

A task may merge only when:

- independent review is `APPROVED`;
- required evidence is attached or linked;
- no unresolved critical or high finding remains;
- conflicts are resolved through the authority process;
- branch is current with its approved base;
- the authorized merger confirms the final diff and merge commit.

## 11. Required records

Use these templates:

- `TASK_TEMPLATE.md` before work starts.
- `HANDOFF_TEMPLATE.md` when primary work stops or completes.
- `REVIEW_TEMPLATE.md` for independent review.
- `CONFLICT_TEMPLATE.md` for source/code conflicts.
- `ROLLBACK_TEMPLATE.md` for reversible changes.
- `EVIDENCE_TEMPLATE.md` for tests and deployments.

Keep `00_AI_HANDOFF/000_INDEX.md` current. Unindexed work is not an approved part of the swarm operating record.
