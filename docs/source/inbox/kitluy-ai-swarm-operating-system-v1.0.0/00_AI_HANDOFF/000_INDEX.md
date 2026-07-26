\
# KitLuy AI Handoff Index

**Version:** v1.0.0  
**Last initialized:** 2026-07-26  
**Purpose:** authoritative registry of AI/human work packages, worktree ownership, handoffs, reviews, evidence, and merge state

## Index rules

1. Update this file before a task begins, whenever ownership/status changes, and after merge/release evidence.
2. One active row per task ID.
3. One primary writer per task.
4. No two active tasks may own the same file.
5. A task may not move to `APPROVED` without an independent review record.
6. A task may not move to `MERGED` without evidence tied to the reviewed commit.
7. Do not mark `VERIFIED`, `RELEASED`, `PILOT_PROVEN`, or `IMPLEMENTED` without the corresponding evidence.

## Status vocabulary

`DRAFT`, `READY`, `CLAIMED`, `IN_PROGRESS`, `BLOCKED`, `HANDOFF_READY`, `REVIEW_IN_PROGRESS`, `CHANGES_REQUESTED`, `APPROVED`, `MERGED`, `VERIFIED`, `RELEASED`, `CANCELLED`, `SUPERSEDED`.

## Active worktree registry

| Task ID | Title | Status | Product/build | Primary writer | Independent reviewer | Branch | Worktree | Base commit | Exclusive paths/files | Dependencies | Latest handoff | Review | Evidence | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| _none_ | No repository task has been claimed in this generated pack. | DRAFT | — | — | — | — | — | — | — | — | — | — | — | 2026-07-26 |

## File ownership collision check

Before claiming a task, compare its allowlist against every `CLAIMED`, `IN_PROGRESS`, `HANDOFF_READY`, `REVIEW_IN_PROGRESS`, or `CHANGES_REQUESTED` row above. Resolve overlaps before editing.

High-contention paths that should normally be serialized:

- root `package.json`, lockfiles, workspace files, TypeScript base configs;
- root agent/governance files;
- migration numbering and schema-owner files;
- API/event/error/permission registries;
- generated database/API types;
- shared design tokens and localization registries;
- CI/CD and release workflows;
- environment and secrets-reference inventories.

## Completed task register

| Task ID | Title | Product/build | Merge commit | Verification state | Handoff | Review | Evidence | Release/deployment | Closed date |
|---|---|---|---|---|---|---|---|---|---|
| _none recorded by this pack_ | Repository history was not inspected during pack generation. | — | — | UNVERIFIED | — | — | — | — | — |

## Seed work-package candidates

These are examples and planning seeds, not assigned or approved implementation tasks. Create a full task file and resolve dependencies before activating one.

| Candidate task ID | Bounded outcome | Likely dependencies | Prohibited expansion |
|---|---|---|---|
| `KL-P1-CORE-001` | Establish Tenant, Digital Store, Store Location, and vertical-isolation schema/contracts. | source-of-truth, data dictionary, migration rules, RLS model | no Laundry workflow tables; no production apply |
| `KL-P1-AUTH-001` | Implement identity bootstrap, memberships, scoped session context, and denial tests. | Core identity schema, permission registry | no full Admin RBAC UI; no service-role bypass |
| `KL-P1-HUB-001` | Implement Store Hub identity, certificate binding, provisioning state, and audit contract. | device trust policy, Edge API, local schema | no terminal UI; no production certificate issuance |
| `KL-P1-LND-001` | Implement Laundry Booking lifecycle and append-only status/custody events. | Core transactions, business rules, event registry | no T1 UI; no payment-provider activation |
| `KL-P1-POS-001` | Implement T1 intake foundation against approved Hub/Laundry contracts. | HUB-001, LND-001, pricing/payment contracts | no T2/T3/T4 expansion; no cloud-direct writes |

## Record locations

Recommended naming:

```text
00_AI_HANDOFF/tasks/YYYY-MM-DD__TASK-ID__short-title__TASK.md
00_AI_HANDOFF/handoffs/YYYY-MM-DD__PRODUCT__TASK-ID__short-title__HANDOFF.md
00_AI_HANDOFF/reviews/YYYY-MM-DD__TASK-ID__short-title__REVIEW.md
00_AI_HANDOFF/evidence/YYYY-MM-DD__TASK-ID__short-title__EVIDENCE.md
00_AI_HANDOFF/conflicts/YYYY-MM-DD__TASK-ID__short-title__CONFLICT.md
00_AI_HANDOFF/rollbacks/YYYY-MM-DD__TASK-ID__short-title__ROLLBACK.md
```

Create subdirectories when the first record is added. Do not invent a completed task history.
