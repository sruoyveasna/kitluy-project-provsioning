# KitLuy Work Package

> Copy this file. Do not execute a task from the template itself.

## 0. Task identity

| Field | Value |
|---|---|
| Task ID | `KL-<PHASE>-<DOMAIN>-<NNN>` |
| Title | `[REQUIRED: one bounded outcome]` |
| Status | `DRAFT` |
| Active phase | `Phase 1 — Laundry` |
| Product/build | `[REQUIRED]` |
| Primary coding agent | `[REQUIRED]` |
| Independent review agent | `[REQUIRED or REQUESTED]` |
| Task owner/approver | `[REQUIRED]` |
| Created date | `[YYYY-MM-DD]` |
| Target base branch | `[REQUIRED]` |
| Base commit | `[REQUIRED SHA]` |
| Task branch | `task/<lowercase-task-id>-<slug>` |
| Worktree path | `[REQUIRED resolved path]` |
| Risk level | `LOW | MEDIUM | HIGH | CRITICAL` |

## 1. Goal

`[REQUIRED: describe the single observable outcome in one paragraph.]`

## 2. Why now

`[REQUIRED: dependency, phase need, defect, risk, or approved decision.]`

## 3. Non-goals

- `[REQUIRED]`
- `[REQUIRED]`

## 4. Authority and source-of-truth check

List exact documents, versions, sections, code, migrations, tests, and handoffs that govern this task.

| Source | Version/commit | Exact section/path | Authority role | Checked by/date |
|---|---|---|---|---|
| Current project instruction | current | applicable locked rule | owner authority | `[REQUIRED]` |
| `[canonical document]` | `[version]` | `[section]` | target contract | `[REQUIRED]` |
| `[migration/code/test]` | `[commit/environment]` | `[path]` | implementation evidence | `[REQUIRED]` |
| `[latest handoff/review]` | `[date]` | `[path]` | continuity evidence | `[REQUIRED]` |

### Conflicts found

`NONE` or link a record created from `CONFLICT_TEMPLATE.md`.

## 5. Dependencies and blockers

| Type | ID/reference | Required state | Current state | Resolution |
|---|---|---|---|---|
| Task dependency | `[task ID]` | `MERGED/VERIFIED` | `[state]` | `[evidence]` |
| Blocker | `[KLB-*]` | `CLOSED` | `[state]` | `[evidence]` |
| Contract | `[document/path]` | `APPROVED` | `[state]` | `[evidence]` |

## 6. Locked rules applicable to this task

Select and expand as needed:

- [ ] Digital Store is control plane; Location is edge environment.
- [ ] One Digital Store has one primary vertical.
- [ ] Store Hub local authority and offline continuity.
- [ ] T1/T2/T3/T4 role boundaries.
- [ ] Neutral Core; no Laundry hardcoding.
- [ ] Append-only finance/payment/inventory/custody/audit.
- [ ] Tenant/Store/Location/user/device isolation.
- [ ] Backend permission + RLS enforcement.
- [ ] Versioned/idempotent/retry-safe APIs/events/jobs.
- [ ] Khmer/English, KHR/USD, Asia/Phnom_Penh, KHQR.
- [ ] No direct connector production-database access.
- [ ] Human approval for sensitive actions.
- [ ] Reporting not commercially paywalled.
- [ ] No unverified `IMPLEMENTED` claim.

## 7. Files to inspect

- `[exact path]`
- `[exact path]`

## 8. Files allowed to change — exclusive task ownership

- `[exact path or narrow glob]`
- `[exact path or narrow glob]`

No other files may change without task-owner approval and index update.

## 9. Prohibited changes

- `[paths or behavior that must not change]`
- no production migration/application;
- no real secrets or production data;
- no unrelated dependency upgrades, refactors, formatting sweeps, or renamed trees;
- no later-phase feature activation.

## 10. Required implementation

### Functional behavior

1. `[REQUIRED]`
2. `[REQUIRED]`

### Data/schema

- Tables/columns/constraints: `[NONE or exact requirement]`
- Migration order/name: `[NONE or exact requirement]`
- RLS/authorization: `[REQUIRED]`
- Append-only/immutability impact: `[REQUIRED]`
- Seeds/fixtures: `[REQUIRED]`
- Backward compatibility: `[REQUIRED]`

### API/events/jobs/webhooks

- Contract/version: `[NONE or exact requirement]`
- Authentication/scopes: `[REQUIRED]`
- Idempotency/retry/replay: `[REQUIRED]`
- Error codes/freshness: `[REQUIRED]`
- Audit events: `[REQUIRED]`

### Offline/Store Hub/device behavior

`[NONE, or exact local authority, sync, conflict, discovery, certificate, and degraded-mode requirements.]`

### UI/UX/accessibility/localization

`[NONE, or routes/screens/components/states/permissions/localization keys/analytics/QA.]`

### Observability/security/operations

`[logs, metrics, traces, alerts, privacy, secrets, rate limits, support and runbook impact.]`

### Documentation updates

- `[exact paths]`

## 11. Acceptance criteria

Use objective, independently verifiable conditions.

| AC ID | Acceptance criterion | Verification method | Required evidence |
|---|---|---|---|
| `AC-01` | `[REQUIRED]` | `[test/query/manual check]` | `[record]` |
| `AC-02` | `[REQUIRED]` | `[test/query/manual check]` | `[record]` |

## 12. Validation commands

Use commands confirmed from the live repository.

```bash
# [REQUIRED: exact narrow checks]

# [REQUIRED: exact full checks applicable to this task]
```

Environment and safety constraints:

- target environment: `[local/dev/staging]`;
- production modification: `PROHIBITED` unless a separate human-operated change task authorizes it;
- test data: synthetic/redacted only.

## 13. Rollback / forward-fix plan

Link a record using `ROLLBACK_TEMPLATE.md`, or write `NOT APPLICABLE` with justification.

## 14. Required evidence

- [ ] final commit SHA and diff summary;
- [ ] changed-file allowlist check;
- [ ] validation command log;
- [ ] acceptance-criterion mapping;
- [ ] migration validation and environment state when applicable;
- [ ] security/authorization/offline evidence when applicable;
- [ ] screenshots/artifacts only when safe and relevant;
- [ ] handoff record;
- [ ] independent review record.

## 15. Stop conditions

Stop and mark `BLOCKED` when:

- source authority conflicts;
- file ownership overlaps another active task;
- a dependency is not at the required state;
- required secrets or production access would be needed;
- acceptance criteria cannot be tested;
- the task would cross the active phase scope;
- data integrity, tenant isolation, offline safety, or rollback cannot be protected.

## 16. Mandatory handoff

Create a completion/partial record from `HANDOFF_TEMPLATE.md`, an evidence record from `EVIDENCE_TEMPLATE.md`, and update `000_INDEX.md`.
