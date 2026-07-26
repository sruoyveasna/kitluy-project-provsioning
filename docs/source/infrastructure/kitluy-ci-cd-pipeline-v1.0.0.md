# KitLuy CI/CD Pipeline

| Field        | Value                                                                       |
| ------------ | --------------------------------------------------------------------------- |
| **Filename** | `kitluy-ci-cd-pipeline-v1.0.0.md`                                           |
| **Version**  | `v1.0.0`                                                                    |
| **Date**     | `2026-07-26`                                                                |
| **Phase**    | Phase 1 — Laundry                                                           |
| **Owner**    | HET / KitLuy Suite Project Owner                                            |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status**   | Canonical operating target; not implementation evidence                     |
| **Timezone** | `Asia/Phnom_Penh`                                                           |

> **Purpose:** Define the build, verification, signing, deployment, approval and evidence pipeline for cloud, database, infrastructure and edge artifacts.

## Source authority and evidence discipline

This document is derived from the current KitLuy Project Instructions and the following approved target sources:

- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`
- `kitluy-storehub-phase1-spec-v1.0.0.md`
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`
- current Phase 1 product specifications and owner-locked Digital Store, Store Hub, T1–T4, provisioning, release and security decisions

Authority order:

1. Current owner decisions and active Project Instructions.
2. Applied migrations, verified code/tests, infrastructure state, deployment records and production evidence.
3. This operating document after approval.
4. Current KitLuy infrastructure, Store Hub, security, API, database and product specifications.
5. Approved handoffs and registries.
6. Competitor analyses or clone documents as design references only.

Nothing in this document is evidence that infrastructure is implemented. `IMPLEMENTED`, `DEPLOYED`, `RESTORED`, `PILOT-APPROVED` or `GO-LIVE-APPROVED` may be used only when the corresponding evidence exists. Unknown provider, account, domain, owner, threshold, retention, RPO, RTO or credential values remain `[REQUIRED: ...]` and must not be guessed.

## Mandatory guardrails

- Supabase owns authoritative cloud PostgreSQL, Auth, RLS, approved Realtime, metadata and audit/event records.
- DigitalOcean owns application and worker compute, Container Registry, Spaces, release storage, AI/MCP/RAG compute and the initial App Platform deployment.
- Store Hub owns local Store operations after provisioning; T1–T4 use it over LAN and do not depend on live cloud access for normal operation.
- Cloud application compute is stateless and replaceable. Containers, pods, caches and queues do not own authoritative business truth.
- Finalized finance, payment, inventory, custody, security and audit records are append-only or corrected through compensating records.
- Production changes require authenticated, authorized and audited human action. Defined high-risk changes require four-eyes approval.
- Production migrations are never run automatically during application startup.
- Production secrets are never committed, embedded in images, copied into client bundles or recorded in this document.
- Monitoring and alert delivery remain available when the Admin Portal is unavailable.
- No multi-region, recovery, readiness or availability claim is made without tested evidence.

## 1. Pipeline objective

Build once, verify deeply, sign, then promote the same immutable artifact through development, staging, Internal, Pilot and Stable. CI/CD must never turn a passing build into an unreviewed production change.

## 2. Pipeline stages

```text
source change
-> formatting/lint/type checks
-> unit/component tests
-> contract/database tests
-> dependency/license/secret/static scans
-> build immutable artifact
-> generate checksum, SBOM and provenance
-> sign artifact
-> deploy development
-> integration tests
-> deploy staging
-> security/load/failure/recovery tests
-> release approval
-> Internal channel
-> Pilot cohort
-> Stable production
```

## 3. Workflow catalog

| Workflow                | Trigger                        | Artifact/output                    | Production mutation allowed       |
| ----------------------- | ------------------------------ | ---------------------------------- | --------------------------------- |
| Pull-request validation | PR opened/updated              | Test and scan evidence             | No                                |
| Main-branch build       | Approved merge                 | Immutable image/package digest     | No                                |
| Development deploy      | Successful build               | Development deployment             | Yes, development only             |
| Staging candidate       | Release candidate tag/approval | Staging deployment + evidence      | Yes, staging only                 |
| Database validation     | Migration change               | Ephemeral/staging migration report | No production apply               |
| Infrastructure plan     | IaC change                     | Plan and policy report             | No apply by default               |
| Infrastructure apply    | Approved environment change    | Applied resources + evidence       | Scoped, authorized                |
| Edge artifact build     | Hub/terminal/OS change         | Signed ARM64 artifact/manifests    | No rollout without channel action |
| Pilot promotion         | Approved release               | Cohort rollout                     | Pilot only                        |
| Stable promotion        | Independent approval           | Production rollout                 | Yes, approved cohort              |
| Emergency release       | Incident-linked approval       | Targeted hotfix                    | Yes, emergency policy             |

## 4. Required checks

- formatting and linting;
- TypeScript type checks where applicable;
- unit, component and contract tests;
- migration syntax/order/rollback metadata checks;
- RLS and tenant-isolation tests for affected data paths;
- dependency, license, secret and static security scanning;
- container/image vulnerability scan;
- SBOM generation;
- artifact digest and signature;
- API/schema compatibility checks;
- Store Hub/terminal protocol compatibility checks where applicable;
- configuration schema validation;
- test result and evidence upload.

## 5. Artifact rules

Every deployable has:

- immutable version and digest;
- source commit;
- build workflow/run ID;
- checksum;
- SBOM;
- signature;
- provenance record where supported;
- release notes;
- compatibility manifest;
- retention class;
- revocation status.

Production may not reference mutable `latest` tags.

## 6. Application deployment

1. Resolve artifact digest and environment configuration references.
2. Validate schema/API compatibility.
3. Confirm required feature flags and dependencies.
4. Deploy to development/staging.
5. Run health, smoke and contract tests.
6. For production, obtain required approval and change window.
7. Deploy gradually where supported.
8. Validate latency, errors, queue age, database pressure and business smoke tests.
9. Complete or rollback within defined observation window.
10. Archive evidence.

## 7. Database change handling

- Application pipelines never auto-apply production migrations.
- Migration artifacts are validated in disposable and staging databases.
- Production apply is a separate human-authorized workflow using `kitluy-database-deployment-runbook-v1.0.0.md`.
- Release compatibility supports expand/contract sequencing.
- Application rollout stops if applied migration history differs from the expected repository chain.

## 8. IaC handling

- PRs produce speculative plans and policy results.
- Applies use environment-specific identities.
- Production apply requires named operator and approval policy.
- Destructive or high-cost changes require independent approval.
- Post-apply checks verify reachability, security, health, monitoring and cost impact.

## 9. Store edge build and distribution

- Build Linux ARM64 Hub/terminal artifacts.
- Sign release and manifest.
- Publish to private release repository/Spaces class.
- Store Hub downloads once, verifies signature and compatibility, and distributes over LAN.
- A/B or equivalent rollback is required.
- Failed health checks revert automatically.
- Tampered, expired or revoked artifacts are rejected.

## 10. Deployment concurrency and safety

- One production rollout per service/cohort unless explicitly coordinated.
- Migration and application rollout locks prevent incompatible overlap.
- Retries are safe and do not duplicate deployment side effects.
- Cancellation leaves a known state and records partial actions.
- Deployment identity cannot self-approve a required four-eyes action.

## 11. Branch and approval assumptions

Exact branch policy is governed by the repository engineering standards. At minimum:

- protected main/release branches;
- required status checks;
- required reviewer/CODEOWNERS approval;
- signed or attributable commits/tags according to policy;
- no direct production deployment from unreviewed branches;
- emergency branch use linked to an incident.

## 12. Evidence record

```text
release_id
artifact_digest
source_commit
build_run_id
sbom_reference
signature_reference
test_evidence_references
migration_compatibility
approvals
target_environment/cohort
start/end timestamps
validation result
rollback/forward-fix result
operator identities
```

## 13. Failure and rollback

| Failure                            | Action                                                        |
| ---------------------------------- | ------------------------------------------------------------- |
| Build/test/scan failure            | Stop; no artifact promotion                                   |
| Signature/provenance failure       | Quarantine artifact                                           |
| Development/staging deploy failure | Fix or rollback; no promotion                                 |
| Production health regression       | Pause, rollback or forward-fix per runbook                    |
| Database migration failure         | Stop release; database runbook                                |
| Edge health failure                | Automatic A/B rollback; fleet alert                           |
| Monitoring unavailable             | Production promotion blocked unless approved emergency policy |

## 14. Required values

- `[REQUIRED: CI/CD platform and runner trust model]`
- `[REQUIRED: artifact signing technology and key custody]`
- `[REQUIRED: SBOM/provenance formats]`
- `[REQUIRED: scan severity gates and exception policy]`
- `[REQUIRED: production change windows]`
- `[REQUIRED: rollout percentages/observation windows]`
- `[REQUIRED: artifact retention/revocation policy]`

## 15. Acceptance tests

- [ ] Same digest reaches staging, Pilot and Stable.
- [ ] A seeded secret blocks CI.
- [ ] A critical image vulnerability blocks promotion according to policy.
- [ ] Production migration cannot run from application startup.
- [ ] Requester cannot approve own Stable promotion.
- [ ] Tampered edge artifact is rejected.
- [ ] Failed edge health check rolls back.
- [ ] Deployment evidence links commit, digest, tests and approvals.
