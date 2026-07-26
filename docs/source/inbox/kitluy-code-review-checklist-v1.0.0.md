# KitLuy Code Review Checklist

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


Use the applicable sections. Reviewers verify evidence rather than checking boxes mechanically.

## 1. Authority and scope

- [ ] The change cites the correct owner decision/specification/contract.
- [ ] It does not revive superseded T1-T3, physical-Store-first or Seller terminology.
- [ ] It respects one primary vertical per Store and shared Core boundaries.
- [ ] No capability is labeled implemented without evidence.
- [ ] Out-of-scope/future vertical behavior is not speculatively built.

## 2. Design and dependencies

- [ ] Business rules are in the owning domain/application layer, not duplicated in UI/adapters.
- [ ] Core does not depend on Laundry or provider-specific code.
- [ ] Public package exports and dependency direction are valid; no cycles/deep imports.
- [ ] Provider SDKs and privileged code stay out of clients.
- [ ] The design supports idempotency, retry and horizontal/edge safety.

## 3. TypeScript and code quality

- [ ] Strict types; no unjustified `any`, assertions or suppressed lint.
- [ ] Inputs are validated and untrusted data is narrowed.
- [ ] Naming communicates domain intent.
- [ ] Time, money, currency, quantities and IDs use canonical types.
- [ ] Side effects and errors are explicit and testable.

## 4. Security and authorization

- [ ] Authentication, permission, resource scope, environment and approval are enforced server-side/RLS/Hub-side.
- [ ] Sensitive actions require re-authentication, reason and four-eyes where specified.
- [ ] Secrets and personal/financial data do not enter source, logs or client bundles.
- [ ] Electron IPC, uploads, URLs and external inputs are allowlisted/validated.
- [ ] Threat model and security tests are updated when the attack surface changes.

## 5. Database and data integrity

- [ ] Migration is additive/backward-compatible or has approved migration/rollback evidence.
- [ ] RLS, constraints, indexes and tenant isolation are included and tested.
- [ ] Finalized payment, finance, inventory, custody and audit truth remains append-only.
- [ ] JSON is not used for authoritative relational facts.
- [ ] Backfills are resumable and do not lock critical tables unacceptably.
- [ ] Generated database types are updated from migrations.

## 6. APIs, events, jobs and connectors

- [ ] Correct governed API surface is used.
- [ ] Version, scopes, errors, idempotency, pagination and freshness are defined.
- [ ] Event/job/webhook schemas and compatibility registries change together.
- [ ] Retries cannot create duplicate business effects.
- [ ] Connectors have no direct database access and preserve KitLuy truth ownership.

## 7. Offline and Store Hub

- [ ] Normal Store operations use the Hub over LAN.
- [ ] WAN failure, restart, reconnect, duplicates and conflicts are tested.
- [ ] T1-T4 role boundaries and audit events remain correct.
- [ ] Local and cloud freshness/authority is visible and not misrepresented.
- [ ] Release/update behavior is signed, health-checked and rollback-safe.

## 8. UI/UX and localization

- [ ] Loading, empty, error, stale, partial and offline states are present.
- [ ] Khmer and English content/layout are tested.
- [ ] KHR/USD and Asia/Phnom_Penh formatting use shared utilities.
- [ ] Accessibility names, focus, keyboard/touch and screen-reader behavior pass.
- [ ] UI controls do not imply permission authority they do not enforce.

## 9. Reliability and observability

- [ ] Structured logs have safe fields, correlation IDs and no secrets/PII leakage.
- [ ] Metrics/traces/alerts cover meaningful failure modes.
- [ ] Timeouts, retries, backoff, circuit/degradation behavior are bounded.
- [ ] Reporting/AI/bulk work cannot starve transaction/auth/sync paths.
- [ ] Recovery and operator actions are documented.

## 10. Tests and evidence

- [ ] Unit/component tests cover rules and UI behavior.
- [ ] Contract/integration/RLS/offline/security tests cover changed boundaries.
- [ ] Tests are deterministic and use synthetic data.
- [ ] Coverage meets the criticality target; no unexplained flaky tests.
- [ ] Commands/results and artifact/environment evidence are recorded.

## 11. Documentation and release

- [ ] Canonical docs, registries, diagrams, runbooks and handoff are updated.
- [ ] Required values are not guessed or silently hardcoded.
- [ ] Feature flag/entitlement defaults and removal plan are defined.
- [ ] Compatibility, migration, deployment and rollback are clear.
- [ ] CODEOWNERS and operational ownership match the new path/capability.
