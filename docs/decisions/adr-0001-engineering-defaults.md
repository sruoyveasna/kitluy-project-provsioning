# ADR-0001 — Engineering defaults for the blank repository

Date: 2026-07-26 · Status: Accepted · **Engineering defaults, NOT owner-locked
product decisions** (per bootstrap instructions §8).

## Context

The repository was empty; no existing workspace tooling to preserve. The
canonical specs pin product stacks (React/PWA, RN+Expo, Electron ARM64,
Supabase, DigitalOcean) but not repository tooling.

## Decision

pnpm workspaces (9.15.9, pinned in `packageManager`) · Turborepo 2 task
orchestration · strict TypeScript ~5.7 (one version via catalog) · Prettier 3
· ESLint 9 flat + typescript-eslint · Vitest 2 unit/contract testing · React
Testing Library and Playwright adopted when the first DOM/journey tests are
implementable (deferred, recorded in tests/ READMEs) · k6 for load (deferred)
· Supabase CLI for DB development · Terraform for IaC · GitHub Actions CI ·
OCI/Docker containers · Node 22.23.0 (`.nvmrc`), single lockfile.

Version pins live in the `catalog:` of `pnpm-workspace.yaml`.

## Consequences

Another supported choice found later in higher-authority evidence wins; record
the change here and in the reconciliation register.
