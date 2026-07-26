\
# KitLuy Blockers and Required Decisions

**Record version:** v1.0.0  
**Initialized:** 2026-07-26  
**Important:** this list is a safe starting register, not a verified complete extraction from the live repository and all current canonical documents.

## Blocking classes

- `B0 — Repository access`: prevents any reliable coding task.
- `B1 — Authority`: conflicting or missing owner decision.
- `B2 — Contract`: missing schema/API/event/security/offline contract.
- `B3 — Environment`: missing development/test environment or configuration reference.
- `B4 — External`: provider, legal, commercial, hardware, or compliance dependency.
- `B5 — Evidence`: work may exist but cannot be verified.

## Current known blockers

| Blocker ID | Class | Description | Blocks | Required resolution/evidence | Owner | Status |
|---|---|---|---|---|---|---|
| `KLB-B0-001` | B0 | Target repository root, integration branch, HEAD, worktree status, and active task ownership are unverified. | all implementation | refresh `000_CURRENT_STATE.md` from live repository | repository owner | OPEN |
| `KLB-B5-001` | B5 | Applied migration state for development, staging, and production is unknown. | schema-dependent work and readiness claims | environment-specific migration history and validation | authorized backend/operator | OPEN |
| `KLB-B5-002` | B5 | Baseline test/build/CI status is unknown. | regression-sensitive tasks | dated CI or local evidence tied to commit | engineering | OPEN |
| `KLB-B1-001` | B1 | Exact canonical source-of-truth index and supersession map in the target repository must be verified. | architecture/schema decisions | approved index with paths, versions, owners and superseded files | product owner | OPEN |
| `KLB-B2-001` | B2 | Exact live commands, toolchain versions, package boundaries, and generated-file rules are unverified. | safe implementation | repository standards and lockfiles | engineering | OPEN |
| `KLB-B3-001` | B3 | Development/staging environment identifiers and safe test credentials references are unverified. | integration and deployment tests | references-only environment matrix and access approval | DevOps/security | OPEN |
| `KLB-B4-001` | B4 | Production provider, payment, KHQR, domain, hardware certification, SLA and commercial values may remain `[REQUIRED]`. | go-live and provider activation | owner/operator decisions and provider evidence | product/finance/ops | OPEN |
| `KLB-B5-003` | B5 | Pilot store count, device fleet, operational telemetry, recovery drill and go-live evidence are unverified. | pilot/production claims | approved evidence package | operations | OPEN |

## Non-blocking unresolved roadmap decisions

The current master feature registry previously retained optional-depth decisions such as privacy workflow depth, entitlement/plan-control depth, subscriptions/recurring commerce, and tax-service/multi-market depth. Verify the latest decision register before activating any related work. These do not automatically block unrelated Phase 1 Laundry foundation tasks.

## Blocker handling

1. A task lists every applicable blocker ID.
2. `READY` requires all blocking items to be resolved or explicitly converted into assumptions approved by the task owner.
3. An agent that discovers a new blocker adds it here or creates a proposed update in the task branch, then updates the index.
4. Never resolve owner, legal, commercial, security, or production questions by guessing.
5. A blocker may be closed only with a dated evidence or decision reference.

## Closed blockers

| Blocker ID | Resolution | Evidence/decision | Closed by | Date |
|---|---|---|---|---|
| _none recorded by this generated pack_ | — | — | — | — |
