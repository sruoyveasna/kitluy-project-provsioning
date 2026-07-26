# KitLuy Branching, Commit and Pull Request Policy

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Branching model

KitLuy uses protected-main, short-lived trunk-based development.

- `main`: always releasable; no direct pushes.
- Feature/fix branches: normally less than three working days.
- Release branches are exceptional and time-bounded.
- Long-running work is integrated behind feature flags and backward-compatible contracts.

Branch names:

```text
feature/KL-123-short-description
fix/KL-456-short-description
security/KL-789-short-description
chore/KL-321-short-description
release/2026.07.0
hotfix/KL-999-short-description
```

## 2. Commit policy

Use Conventional Commits:

```text
feat(sync): persist acknowledgements before dequeue
fix(payments): reject duplicate refund idempotency key
docs(repo): add package-boundary standard
chore(deps): update Electron to 43.2.0
```

Allowed types: `feat`, `fix`, `security`, `docs`, `refactor`, `test`, `perf`, `build`, `ci`, `chore`, `revert`.

Commits are focused, compile independently where practical and contain no generated noise unrelated to the task. Release and production-sensitive commits must be verified/signed. The repository should move toward signed commits for all contributors once identity setup is complete.

## 3. Pull request requirements

Every PR includes:

- Task/decision link and concise problem statement.
- Source-of-truth documents checked.
- Scope and excluded scope.
- Architecture/data/API/security/offline impact.
- Screenshots or recordings for UI changes, including Khmer/English where affected.
- Migrations, compatibility and rollback notes.
- Tests run with exact commands/results.
- Documentation and handoff changes.
- Risks, required values and follow-up work.

Draft PRs are encouraged for early design feedback but cannot be used to bypass required review.

## 4. Size and focus

Prefer PRs under 400 changed production lines excluding generated files, migrations and lockfiles. Larger PRs need a review plan and logical commit structure. Do not mix dependency upgrades, formatting sweeps and business changes unless inseparable.

## 5. Required approvals

- At least one CODEOWNER approval for normal changes.
- Two approvals for security, auth/RLS, payments, finance, inventory, audit, device trust, production infrastructure or destructive migrations.
- The requester cannot be the sole approver for four-eyes actions.
- Product behavior changes require the owning product/domain reviewer.
- Generated AI code requires the same approvals; the AI is never an approver.

## 6. Required checks

Applicable checks include lint, typecheck, unit/component, database/RLS, contract, integration, E2E, dependency boundary, secret scan, SCA/license, container scan, Terraform validate/plan, SBOM and build/package verification.

Required checks cannot be bypassed by changing workflow files in the same PR without Platform/Security approval.

## 7. Merge strategy

Default merge is **squash merge** using the approved Conventional Commit title. Preserve separate commits only when release, migration or audit needs justify them. Delete merged branches.

## 8. Releases

Tags are signed and use semantic/calendar versioning defined by the release policy. A release references immutable application images, mobile builds, Electron/Hub artifacts, migration set and Terraform plan/apply evidence. Promotion reuses the same artifact; do not rebuild between staging, pilot and production.

## 9. Hotfixes

Hotfixes branch from `main`, remain minimal, receive expedited but not absent review, run the critical validation set and merge back to `main`. Any temporary mitigation creates a follow-up issue and expiry date.

## 10. Reverts and incidents

Prefer reverting the application artifact or feature flag when safe. Database corrections are forward migrations/compensating records. Incident-driven changes record timeline, authorization, impact and post-incident follow-up.

## 11. Protected branch configuration

`main` requires PRs, resolved conversations, current approvals after new commits, CODEOWNERS, required status checks, linear history, signed release tags and restricted force-push/deletion. Administrators follow the same policy except documented break-glass incidents.
