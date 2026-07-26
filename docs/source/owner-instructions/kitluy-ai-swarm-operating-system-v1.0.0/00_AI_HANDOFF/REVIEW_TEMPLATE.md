\

# KitLuy Independent Review Record

## 0. Review identity

| Field           | Value                                         |
| --------------- | --------------------------------------------- |
| Task ID         | `[REQUIRED]`                                  |
| Task title      | `[REQUIRED]`                                  |
| Reviewer        | `[REQUIRED: must differ from primary writer]` |
| Review role     | `independent review agent`                    |
| Reviewed commit | `[REQUIRED SHA]`                              |
| Base commit     | `[REQUIRED SHA]`                              |
| Branch/worktree | `[REQUIRED]`                                  |
| Review date     | `[YYYY-MM-DD]`                                |
| Decision        | `APPROVED                                     | CHANGES_REQUESTED | BLOCKED` |

## 1. Independence check

- Reviewer was not the primary writer: `PASS/FAIL`.
- Reviewer did not modify the task branch: `PASS/FAIL`.
- Reviewed commit matches evidence commit: `PASS/FAIL`.

## 2. Materials reviewed

- task file: `[path]`
- handoff: `[path]`
- evidence: `[path]`
- source authorities: `[paths/sections]`
- diff range: `[base..head]`

## 3. Scope and file ownership

| Check                                  | Result      | Notes |
| -------------------------------------- | ----------- | ----- |
| Changed files stay within allowlist    | `PASS/FAIL` |       |
| No overlapping active task ownership   | `PASS/FAIL` |       |
| Non-goals/prohibited changes preserved | `PASS/FAIL` |       |
| Dependencies/base commit valid         | `PASS/FAIL` |       |

## 4. Acceptance-criteria review

| AC ID   | Primary evidence | Reviewer verification | Result                   | Notes |
| ------- | ---------------- | --------------------- | ------------------------ | ----- |
| `AC-01` | `[reference]`    | `[re-run/inspection]` | `PASS/FAIL/NOT VERIFIED` |       |

## 5. Technical review checklist

Mark `N/A` only with justification.

| Area                                          | Result          | Notes |
| --------------------------------------------- | --------------- | ----- |
| Correctness and edge cases                    | `PASS/FAIL/N/A` |       |
| Contract/schema compatibility                 | `PASS/FAIL/N/A` |       |
| Migration safety and RLS                      | `PASS/FAIL/N/A` |       |
| Tenant/Store/Location isolation               | `PASS/FAIL/N/A` |       |
| Permissions, re-auth, approval, audit         | `PASS/FAIL/N/A` |       |
| Append-only finance/payment/inventory/custody | `PASS/FAIL/N/A` |       |
| Idempotency, retries, replay, ordering        | `PASS/FAIL/N/A` |       |
| Store Hub/offline/reconnect behavior          | `PASS/FAIL/N/A` |       |
| T1/T2/T3/T4 boundaries                        | `PASS/FAIL/N/A` |       |
| Error, stale, partial and degraded states     | `PASS/FAIL/N/A` |       |
| Security, privacy, secrets and logging        | `PASS/FAIL/N/A` |       |
| Khmer/English, KHR/USD, timezone              | `PASS/FAIL/N/A` |       |
| Accessibility and UX states                   | `PASS/FAIL/N/A` |       |
| Observability and operations                  | `PASS/FAIL/N/A` |       |
| Test quality and negative coverage            | `PASS/FAIL/N/A` |       |
| Documentation and rebuildability              | `PASS/FAIL/N/A` |       |

## 6. Reviewer validation

| Command/check | Environment | Result              | Evidence      | Notes |
| ------------- | ----------- | ------------------- | ------------- | ----- |
| `[command]`   | `[env]`     | `PASS/FAIL/NOT RUN` | `[reference]` |       |

## 7. Findings

| Finding ID | Severity                        | Path/location | Description | Required remediation | Blocking? |
| ---------- | ------------------------------- | ------------- | ----------- | -------------------- | --------- |
| `RV-001`   | `CRITICAL/HIGH/MEDIUM/LOW/NOTE` | `[path:line]` | `[finding]` | `[fix/test]`         | `yes/no`  |

## 8. Decision rationale

`[Explain why the task is approved, changes are required, or review is blocked.]`

## 9. Merge conditions

- [ ] reviewed commit is unchanged;
- [ ] all blocking findings resolved;
- [ ] required validation/evidence complete;
- [ ] conflict records resolved;
- [ ] branch updated to approved integration point;
- [ ] integration checks pass;
- [ ] authorized human approval obtained for sensitive implications.

## 10. Reviewer truth statement

The reviewer did not treat documentation, a build, or a primary-agent summary as proof of deployment, migration application, pilot operation, or production correctness.
