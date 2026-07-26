# KitLuy Monorepo Blueprint

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Purpose

This document turns the KitLuy Suite repository proposal into an executable, reviewable monorepo contract. It preserves the Digital Store control plane, Store Location edge model, T1-T4 Laundry profiles, Supabase/DigitalOcean responsibility split, offline Store Hub authority, shared Core rule and phased vertical strategy.

The repository must pass the **Rebuild Test**: one qualified engineer can clone the repository, install the pinned toolchain, start local dependencies, run validation, understand ownership and reconstruct an environment without undocumented steps.

## 2. Selected toolchain baseline

These are **project selections**, not claims that every existing source file already uses them. Exact dependency resolution remains recorded in `pnpm-lock.yaml`, container digests, the Supabase local configuration and the KitLuy OS image manifest.

| Technology | Selected version | Scope | Pinning rule |
|---|---:|---|---|
| Node.js | `24.18.0` LTS | Workspace scripts, web/services, Hub build tooling | `.nvmrc`, `.node-version`, `engines.node >=24.18.0 <25` |
| pnpm | `11.4.0` | Monorepo package manager | root `packageManager`, Corepack; no global unpinned pnpm |
| TypeScript | `6.0.3` | Shared compiler baseline | exact root catalog version; TypeScript 7 requires compatibility ADR |
| React, web | `19.2.7` | B2B, Admin, Chain, Partner, Storefront, Electron renderer | exact app version; shared UI uses peer range `>=19.2.3 <19.3.0` |
| React, Expo apps | `19.2.3` | Partner App and POS Mobile | Expo SDK compatibility pin |
| React Native | `0.86.0` | Expo mobile applications | Expo-managed native dependency; no independent upgrade |
| Expo SDK / `expo` | `57.0.8` | Partner App and POS Mobile | exact `expo` package; install native libraries with `pnpm expo install` |
| Electron | `43.2.0` | POS Desktop T1-T4 clients | exact dev dependency and lockfile; Linux ARM64 build required |
| Supabase CLI | `2.109.1` | Local stack, migrations, functions, type generation | project dev dependency; invoke through `pnpm supabase` |
| PostgreSQL | `17.10` compatibility target | Supabase schema contracts and Store Hub local PostgreSQL | major 17 required; provider patch is recorded per environment |
| Raspberry Pi OS | `2026-06-18`, Debian 13 Trixie, kernel 6.18, 64-bit | Hub Lite image and terminal desktop image | image URL and SHA-256 locked in manufacturing manifest |
| Docker Engine | `29.6.2` | Local Supabase, CI builders, services and test containers | engine minor/patch fixed in CI image; production images pinned by digest |
| Terraform | `1.15.5` | Infrastructure as code | exact CI and operator version; `required_version = "= 1.15.5"` |

### 2.1 Version-management rules

1. The version table is copied into root `tool-versions.json` and verified by CI.
2. No tool upgrades are performed as drive-by changes.
3. A version PR includes release notes, compatibility review, lockfile/container changes, rollback notes and the full validation matrix.
4. Security patches may use an expedited path but still require evidence and review.
5. Supabase Cloud may run a provider-managed PostgreSQL patch. The repository records the observed version and verifies compatibility with PostgreSQL 17.10; it does not pretend to control a provider-managed patch.
6. Expo controls the React/React Native compatibility pair. Do not upgrade React Native independently of the selected Expo SDK.

## 3. Canonical repository shape

```text
kitluy-suite/
├── 00_AI_HANDOFF/
│   ├── 000_INDEX.md
│   ├── tasks/
│   ├── reviews/
│   ├── releases/
│   └── archive/
├── apps/
│   ├── kitluy-b2b-website/
│   ├── kitluy-admin-portal/
│   ├── kitluy-chain-portal/
│   ├── kitluy-partner-portal/
│   ├── kitluy-partner-app/
│   ├── kitluy-pos-desktop-app/
│   ├── kitluy-pos-mobile-app/
│   └── kitluy-storefront/
├── services/
│   ├── kitluy-api-gateway/
│   ├── kitluy-configuration-service/
│   ├── kitluy-connector-runtime/
│   ├── kitluy-device-registry-service/
│   ├── kitluy-file-service/
│   ├── kitluy-hub-agent/
│   ├── kitluy-integration-hub/
│   ├── kitluy-notification-service/
│   ├── kitluy-provisioning-service/
│   ├── kitluy-release-service/
│   ├── kitluy-reporting-service/
│   ├── kitluy-sync-service/
│   ├── kitluy-ai-gateway/
│   ├── kitluy-mcp-server/
│   └── kitluy-rag-indexer/
├── packages/
│   ├── api-contracts/
│   ├── auth-context/
│   ├── core-domain/
│   ├── database-types/
│   ├── design-system/
│   ├── device-identity/
│   ├── edge-contracts/
│   ├── errors/
│   ├── events/
│   ├── file-contracts/
│   ├── i18n/
│   ├── jobs/
│   ├── logging/
│   ├── money/
│   ├── observability/
│   ├── permissions/
│   ├── release-manifests/
│   ├── sync-protocol/
│   ├── test-factories/
│   ├── validation/
│   └── vertical-laundry/
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── functions/
│   ├── seed/
│   ├── tests/
│   └── generated/
├── infra/
│   ├── terraform/
│   │   ├── modules/
│   │   └── environments/
│   ├── digitalocean/
│   ├── supabase/
│   ├── kubernetes/
│   ├── monitoring/
│   ├── policies/
│   ├── kitluy-os-image/
│   └── manufacturing-station/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── e2e/
│   ├── load/
│   ├── security/
│   ├── recovery/
│   ├── chaos/
│   ├── hardware/
│   └── fixtures/
├── docs/
│   ├── source/
│   ├── authority/
│   ├── architecture/
│   ├── product/
│   ├── api/
│   ├── database/
│   ├── security/
│   ├── ui-ux/
│   ├── qa/
│   ├── operations/
│   ├── decisions/
│   └── evidence/
├── tooling/
│   ├── codegen/
│   ├── lint-rules/
│   ├── release/
│   ├── scripts/
│   └── validation/
├── .github/
│   ├── workflows/
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md
│   └── CODEOWNERS
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── eslint.config.mjs
├── prettier.config.mjs
├── tool-versions.json
├── CONTRIBUTING.md
└── SECURITY.md
```

### 3.1 Scope-control rule

Future vertical clients such as Restaurant KDS, restaurant guest order-and-pay, kiosk and self-checkout are reserved product names but are not empty deployables in Phase 1. Create their workspace only when the phase scope and contracts are approved. Shared Core must remain neutral so later additions do not require Laundry rewrites.

## 4. Workspace configuration

### 4.1 `pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - services/*
  - packages/*
  - supabase/functions/*
  - tooling/*
```

### 4.2 Root `package.json` minimum

```json
{
  "name": "kitluy-suite",
  "private": true,
  "packageManager": "pnpm@11.4.0",
  "engines": { "node": ">=24.18.0 <25", "pnpm": "11.4.0" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "lint": "pnpm -r --if-present lint",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test",
    "test:contract": "pnpm --filter @kitluy/tests-contract test",
    "test:integration": "pnpm --filter @kitluy/tests-integration test",
    "validate": "pnpm lint && pnpm typecheck && pnpm test && pnpm db:lint",
    "db:lint": "pnpm supabase db lint",
    "db:test": "pnpm supabase test db",
    "db:types": "pnpm supabase gen types typescript --local > packages/database-types/src/database.generated.ts"
  },
  "devDependencies": {
    "supabase": "2.109.1",
    "typescript": "6.0.3"
  }
}
```

Package names use `@kitluy/<name>`. Internal dependencies use `workspace:*`. Published public packages require an explicit owner decision; private is the default.

## 5. Application and service anatomy

Every workspace contains:

```text
src/
├── application/      # use cases and orchestration
├── domain/           # local domain types only when not shared
├── infrastructure/   # provider, database and transport adapters
├── interface/        # HTTP/UI/CLI handlers
├── config/
└── index.ts

tests/
├── unit/
├── integration/
└── contract/

package.json
README.md
tsconfig.json
```

UI apps may replace `interface/` with `app/`, `routes/`, `features/`, `components/` and `screens/`, but business rules still belong in domain/application packages rather than view components.

## 6. Build graph and deployment units

- Applications and services are independent deployables.
- Packages are libraries and never deploy themselves.
- Supabase migrations and functions are separately reviewed release artifacts.
- The Store Hub image, terminal image and Electron package are signed release artifacts.
- Infrastructure plans and applies are separate from application deployments.
- The same immutable application image is promoted development -> staging -> pilot -> production.

## 7. Required root checks

A pull request cannot merge until applicable checks pass:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:lint
pnpm db:test
pnpm test:contract
pnpm test:integration
```

Additional checks run by path: Electron Linux ARM64 packaging, Expo doctor/build, Playwright, container build, Terraform format/validate/plan, security scanning, SBOM generation and Store Hub hardware simulation.

## 8. Environments and configuration

Required environments are `local`, `development`, `staging`, `pilot`, `production` and `disaster_recovery`. Configuration is validated at startup. Secrets are never committed and never bundled into browser/mobile/Electron renderer code. Production service credentials are unavailable to local clients.

Environment variables use a schema owned by each deployable. A checked-in `.env.example` contains names, descriptions and safe example values only.

## 9. Repository governance

- `main` is protected and always releasable.
- CODEOWNERS governs path review.
- Architecture changes require an ADR under `docs/decisions/`.
- Database, API, event, permission and sync changes require their canonical registries to change in the same PR.
- Every AI-authored change uses the same review and evidence gates as human-authored work.
- Generated files declare their source and generation command; manual edits are rejected.

## 10. Bootstrap sequence

1. Install the pinned Node.js and enable Corepack.
2. Clone the repository and run `pnpm install --frozen-lockfile`.
3. Copy safe local environment templates.
4. Start Docker Engine and run `pnpm supabase start`.
5. Apply local migrations through the Supabase CLI.
6. Generate database types and verify a clean diff.
7. Run `pnpm validate`.
8. Start only the required application/service filters.
9. Record local deviations in the AI handoff or engineering task note.

## 11. Evidence required before this blueprint is labeled implemented

- Root workspace files and lockfile exist.
- Every declared workspace has an owner and build/test scripts.
- CI enforces dependency boundaries and required checks.
- Local bootstrap succeeds from a clean machine.
- At least one cloud app, one Supabase migration path and one Store Hub simulation pass from this layout.
- Repository evidence is linked from the implementation-status register.
