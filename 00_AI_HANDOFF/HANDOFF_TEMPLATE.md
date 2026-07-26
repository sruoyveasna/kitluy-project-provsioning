# KitLuy Task Handoff

## 0. Identity

| Field | Value |
|---|---|
| Task ID | `[REQUIRED]` |
| Task title | `[REQUIRED]` |
| Product/build | `[REQUIRED]` |
| Primary agent | `[REQUIRED]` |
| Status | `HANDOFF_READY | PARTIAL | BLOCKED` |
| Branch | `[REQUIRED]` |
| Worktree | `[REQUIRED]` |
| Base commit | `[REQUIRED]` |
| Final commit | `[REQUIRED or UNCOMMITTED]` |
| Handoff date | `[YYYY-MM-DD]` |
| Requested reviewer | `[REQUIRED]` |

## 1. Outcome

`[What was achieved, in observable terms. Do not claim deployment or implementation beyond evidence.]`

## 2. Source-of-truth checked

| Source | Version/commit | Section/path | Result |
|---|---|---|---|
| `[source]` | `[version]` | `[section]` | `[aligned/conflict/not found]` |

## 3. Files inspected

- `[path]`

## 4. Files changed

| Path | Change summary | Why | Generated? |
|---|---|---|---|
| `[path]` | `[summary]` | `[task requirement]` | `yes/no` |

### Allowlist verification

`PASS | FAIL` — `[explanation]`

## 5. Implementation details

### Functional behavior

`[summary]`

### Schema/data/migrations

`[NONE or exact files, order, validation, RLS and compatibility. State clearly whether any migration was applied and to which environment.]`

### APIs/events/jobs/webhooks

`[NONE or exact contracts and behavior]`

### Permissions/audit/security

`[exact enforcement and tests]`

### Offline/Store Hub/device impact

`[NONE or exact behavior]`

### UI/localization/accessibility

`[NONE or exact behavior]`

### Observability/runbooks/docs

`[updates]`

## 6. Acceptance criteria evidence

| AC ID | Result | Evidence reference | Notes |
|---|---|---|---|
| `AC-01` | `PASS/FAIL/NOT RUN` | `[path/link/log]` | `[notes]` |

## 7. Validation performed

| Command/check | Environment | Result | Evidence | Notes |
|---|---|---|---|---|
| `[command]` | `[local/dev/staging]` | `PASS/FAIL/NOT RUN` | `[record]` | `[notes]` |

## 8. Not run / not verified

- `[exact item and reason]`

## 9. Risks and known limitations

| Severity | Risk/limitation | Impact | Mitigation/follow-up |
|---|---|---|---|
| `[level]` | `[item]` | `[impact]` | `[action]` |

## 10. Blockers and open decisions

- `NONE` or `[blocker/conflict/decision ID]`

## 11. Rollback / recovery

- rollback record: `[path]`
- recovery caveats: `[notes]`

## 12. Review focus

Ask the reviewer to focus on:

- `[high-risk area]`
- `[contract/security/offline area]`

## 13. Next step

`Independent review` or exact continuation task.

## 14. Truth statement

- Production modified by primary coding agent: `NO` unless explicitly documented and authorized.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO` unless all required evidence is linked.
