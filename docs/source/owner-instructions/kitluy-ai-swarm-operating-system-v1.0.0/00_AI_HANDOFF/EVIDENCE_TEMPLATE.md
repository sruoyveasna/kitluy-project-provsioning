\
# KitLuy Test and Deployment Evidence Record

## 0. Identity

| Field | Value |
|---|---|
| Task ID | `[REQUIRED]` |
| Evidence ID | `KLEV-<YYYY>-<NNN>` |
| Commit SHA | `[REQUIRED]` |
| Branch/worktree | `[REQUIRED]` |
| Environment | `local | dev | staging | pilot | production` |
| Executor | `[human/agent/CI identity]` |
| Date/time | `[ISO 8601 with timezone]` |
| Evidence classification | `[choose from approved state vocabulary]` |

## 1. Environment fingerprint

Record references, never secrets.

- OS/runtime/container: `[REQUIRED]`
- Node/pnpm/TypeScript or relevant tool versions: `[REQUIRED]`
- dependency lockfile hash: `[REQUIRED when applicable]`
- database project/environment reference: `[redacted identifier]`
- migration head: `[REQUIRED when applicable]`
- application/release ID: `[REQUIRED when applicable]`
- device/Hub profile: `[REQUIRED when applicable]`

## 2. Changed-file integrity

- final diff range: `[base..head]`
- changed-file list artifact: `[path/output]`
- task allowlist result: `PASS/FAIL`
- secret scan result: `PASS/FAIL/NOT RUN`

## 3. Command evidence

| # | Command/check | Started | Ended | Exit/result | Output artifact/log | Notes |
|---:|---|---|---|---|---|---|
| 1 | `[exact command]` | `[time]` | `[time]` | `PASS/FAIL/NOT RUN` | `[path/run ID]` | `[notes]` |

Do not paste huge logs or sensitive payloads. Store or link the approved artifact and include concise relevant excerpts.

## 4. Acceptance-criterion evidence

| AC ID | Evidence method | Result | Artifact/query/test | Reviewer reproducible? |
|---|---|---|---|---|
| `AC-01` | `[method]` | `PASS/FAIL/NOT VERIFIED` | `[reference]` | `yes/no` |

## 5. Migration evidence

Complete when applicable.

| Item | Result/evidence |
|---|---|
| Migration file authored | `[path]` |
| Local lint | `[result]` |
| Fresh local apply | `[result]` |
| Upgrade from prior head | `[result]` |
| RLS/constraint validation | `[result]` |
| Seed idempotency | `[result]` |
| Rollback/forward-fix rehearsal | `[result]` |
| Applied to development | `[operator/run/evidence or NO]` |
| Applied to staging | `[operator/run/evidence or NO]` |
| Applied to production | `[authorized operator/run/evidence or NO]` |

A migration file or local apply does not prove production application.

## 6. Security and isolation evidence

| Scenario | Expected | Result | Evidence |
|---|---|---|---|
| unauthenticated request | denied | `[result]` | `[reference]` |
| wrong Tenant/Store/Location | denied | `[result]` | `[reference]` |
| wrong permission/role | denied | `[result]` | `[reference]` |
| approval/re-auth required | enforced | `[result]` | `[reference]` |
| audit event | immutable record | `[result]` | `[reference]` |
| replay/idempotency | one business effect | `[result]` | `[reference]` |

## 7. Offline / Store Hub evidence

Complete when applicable:

- LAN operation with WAN unavailable: `[result]`;
- queued operation preservation: `[result]`;
- reconnect and sync: `[result]`;
- conflict/reconciliation behavior: `[result]`;
- T1/T2/T3/T4 role denial: `[result]`;
- device certificate/revocation: `[result]`.

## 8. Build/deployment/release evidence

| Stage | Commit/artifact | Environment/channel | Result | Health/smoke | Operator/approval |
|---|---|---|---|---|---|
| build | `[ID]` | `[env]` | `[result]` | `[result]` | `[identity]` |
| deploy | `[ID]` | `[env]` | `[result]` | `[result]` | `[identity]` |
| release promotion | `[ID]` | `Internal/Pilot/Stable` | `[result]` | `[result]` | `[approval]` |

Leave rows blank or mark `NOT PERFORMED`. Never infer deployment from a build.

## 9. Failures, flakes and deviations

| Item | Classification | Impact | Disposition/task |
|---|---|---|---|
| `[failure]` | `real defect/flake/environment/not run` | `[impact]` | `[action]` |

## 10. Evidence conclusion

State exactly what this evidence proves and does not prove.

```text
PROVES: [narrow factual claims]
DOES NOT PROVE: [deployment/pilot/production/other unverified claims]
```
