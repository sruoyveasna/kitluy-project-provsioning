# Contributing to KitLuy Suite

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## Before you begin

Read `PROJECT_HOME.md`, the authority/precedence standard, the relevant product/service specification, this repository engineering pack and the latest handoff. Current owner decisions and verified repository/migration/test evidence take precedence over older planning.

## Prerequisites

- Node.js `24.18.0`
- pnpm `11.4.0` through Corepack
- Docker Engine `29.6.2`
- Supabase CLI `2.109.1` as a project dependency
- Terraform `1.15.5` for infrastructure work
- Git and platform build tools required by Electron/Expo

```bash
corepack enable
node --version
pnpm --version
pnpm install --frozen-lockfile
```

## Local setup

```bash
pnpm supabase start
pnpm db:types
pnpm validate
```

Copy only approved `.env.example` files. Never request or reuse production secrets locally. Synthetic data is the default.

## Choose the correct workspace

- User-facing deployables live in `apps/`.
- Independently deployed backends/agents live in `services/`.
- Reusable neutral logic/contracts live in `packages/`.
- Database assets live in `supabase/`.
- Infrastructure lives in `infra/`.
- Cross-product verification lives in `tests/`.

Do not create a new package/service when an existing owner should contain the change. Core must stay neutral; Laundry behavior belongs in the Laundry vertical package and consuming interfaces.

## Development workflow

1. Create a task-linked short-lived branch.
2. Confirm source authority and acceptance criteria.
3. Make the smallest coherent change.
4. Add/update tests, docs, registries and handoff together.
5. Run applicable validation.
6. Open a PR using the repository template.
7. Address CODEOWNER and automated review.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm db:lint
pnpm db:test
pnpm test:contract
pnpm test:integration
```

Use filters during development, but run the required complete matrix before requesting final review.

## Commits and pull requests

Use Conventional Commits and the branching/PR policy. No direct pushes to `main`. Keep PRs focused. Explain source documents, data/API/offline/security impact, tests and rollback.

## Database changes

- Create a new timestamped migration; never edit an applied migration.
- Include RLS, constraints, indexes and isolation tests.
- Generate database types and commit the result.
- Do not apply production migrations. Production apply belongs to an authorized operator and approval process.

## API, event and sync changes

Update the machine-readable schema and canonical registry in the same PR. Preserve backward compatibility and idempotency. Run producer/consumer contract tests. Do not create one generic API or bypass the Store Hub/Connector boundaries.

## UI changes

Implement loading, empty, error, stale, partial and offline states. Test Khmer and English, KHR and USD, `Asia/Phnom_Penh`, accessibility and responsive/mobile behavior. UI permission checks do not replace backend/RLS authorization.

## Store Hub and hardware changes

Use simulators first, then certified ARM64/hardware evidence. Validate WAN loss, restart, reconnect, duplicate handling, signed updates and rollback. Unknown or cloned hardware cannot be provisioned.

## Security

Read `SECURITY.md`. Never place vulnerability details in public issues. Never commit secrets, production data, customer evidence or private keys. Sensitive action and device-trust changes require Security review.

## AI-assisted contributions

AI may draft code and documents but cannot approve, apply production changes or claim implementation. The contributor is responsible for understanding, testing and reviewing every generated line. Record the AI handoff with files changed, tests run/not run, risks and remaining work.

## Documentation

Update canonical documents rather than creating competing truth. Use explicit status labels. Required unknowns use `[REQUIRED: ...]`; do not guess them. Diagrams, examples and commands must be kept executable.

## Getting help

Use the task/decision register and repository discussion channel defined by the project owner. Security matters follow `SECURITY.md`.
