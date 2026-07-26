\
# KitLuy Current Repository State

**Record version:** v1.0.0  
**Record date:** 2026-07-26  
**Evidence status:** `UNVERIFIED — MUST BE REFRESHED IN THE LIVE REPOSITORY`

## Critical notice

This AI operating pack was generated from KitLuy project instructions and supplied documentation, not from a verified checkout of the target KitLuy repository, its Git history, applied environments, CI system, or production platform.

Therefore, this file intentionally does not claim that code, migrations, tests, deployments, pilots, or products are implemented.

The first authorized repository task must refresh this record with exact command output and evidence links before implementation begins.

## Repository evidence snapshot

| Area | Current recorded state | Evidence required to update | Authority consequence |
|---|---|---|---|
| Repository root | `[REQUIRED: resolve with git rev-parse --show-toplevel]` | command output and path | no path assumptions allowed |
| Default/integration branch | `[REQUIRED]` | `git remote -v`, branch policy, protected branch settings | do not create task branch from an assumed base |
| HEAD commit | `[REQUIRED]` | `git rev-parse HEAD` | all evidence must identify commit |
| Working tree | `[REQUIRED]` | `git status --short --branch` | do not overwrite unknown local work |
| Package manager and lockfile | `[REQUIRED]` | live files and versions | example commands are non-authoritative |
| Node/pnpm/TypeScript versions | `[REQUIRED: read repository standards and toolchain files]` | version files, package metadata, CI | do not install guessed versions |
| Monorepo applications/services | `[REQUIRED: inventory live paths]` | directory and workspace inventory | planning layout does not prove actual layout |
| Applied migrations — development | `UNKNOWN` | environment ID, migration history, validation output | migration files alone are not applied evidence |
| Applied migrations — staging | `UNKNOWN` | environment ID and migration history | no staging readiness claim |
| Applied migrations — production | `UNKNOWN` | authorized operator record and migration history | agents must not apply production migrations |
| Test status | `UNKNOWN` | CI run IDs and/or local command logs | no test pass claim |
| Build status | `UNKNOWN` | build logs and artifact identifiers | no deployability claim |
| Deployment status | `UNKNOWN` | environment, release ID, commit, health checks | no deployment claim |
| Pilot stores/devices | `UNKNOWN` | approved pilot records and monitoring | no pilot-proven claim |
| Production traffic/telemetry | `UNKNOWN` | authorized dashboards and dated evidence | no operational claim |
| Open incidents | `UNKNOWN` | incident register | safety status unverified |
| Secrets/config readiness | `UNKNOWN` | references-only inventory and operator verification | never request secret values in this file |

## Documentation state

The project has a large approved/planned document corpus, including Suite/Product bibles, Phase 1 product specifications, infrastructure direction, owner decisions, master feature registry, and competitor evidence packages. Prior project work also requested source-of-truth, database, API, event, business-rule, security, offline, shared-service, UI/UX, engineering, and infrastructure packs.

Before implementation, verify for every required document:

- exact path;
- version;
- approval state;
- owner;
- superseded predecessor;
- unresolved `[REQUIRED: ...]` values;
- consistency with current project instructions;
- whether a corresponding repository contract, migration, test, or deployment exists.

Documentation is target authority but not implementation evidence.

## Mandatory refresh procedure

Run from the live repository worktree and paste redacted output or link to evidence records:

```text
1. Resolve repository root and Git remotes.
2. Capture branch, HEAD, worktree status, tags, and recent merge history.
3. Inventory root files, workspaces, applications, services, packages, migrations, tests, docs, and CI workflows.
4. Read toolchain/version authority files.
5. Run repository-provided documentation verification.
6. Run the approved baseline lint/typecheck/test/build commands, or record NOT RUN with reason.
7. Read migration history for each environment through authorized tooling.
8. Record deployments and release identifiers without exposing secrets.
9. Link open blockers, incidents, reviews, and active tasks.
10. Update this file and `000_INDEX.md` in a dedicated governance task.
```

## Evidence-state vocabulary

Use only these states:

- `PLANNED`
- `SPECIFIED`
- `BUILT_UNVERIFIED`
- `TESTED_LOCAL`
- `TESTED_INTEGRATED`
- `MIGRATION_VALIDATED`
- `MIGRATION_APPLIED_DEV`
- `MIGRATION_APPLIED_STAGING`
- `DEPLOYED_STAGING`
- `PILOT_PROVEN`
- `DEPLOYED_PRODUCTION`
- `PRODUCTION_VERIFIED`
- `BLOCKED`
- `UNKNOWN`

Use `IMPLEMENTED` only as a summarized classification when the required repository, migration, test, deployment, and operational evidence all exist for the claim.
