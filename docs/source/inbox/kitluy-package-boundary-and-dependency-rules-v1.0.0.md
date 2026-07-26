# KitLuy Package Boundary and Dependency Rules

> **Status:** Canonical target engineering standard; not implementation evidence.  
> **Owner:** HET / KitLuy Suite Project Owner  
> **Version:** v1.0.0  
> **Date:** 2026-07-26  
> **Applies to:** KitLuy Suite monorepo, all applications, shared services, packages, Supabase assets, infrastructure, Store Hub and AI handoff work.  
> **Authority:** Current owner decisions and Project Instructions override this document. Applied migrations, verified code/tests and production evidence remain implementation truth.


## 1. Governing rule

KitLuy is one platform with shared Core and additive vertical modules. Dependency direction must prevent applications, providers and Laundry terminology from contaminating neutral Core.

```text
UI / transport adapters
        ↓
application use cases
        ↓
domain contracts and policies
        ↓
shared primitives

infrastructure adapters implement ports upward;
they are not imported by the domain.
```

## 2. Workspace classes

| Class | Examples | May depend on | Must not depend on |
|---|---|---|---|
| Shared primitives | `validation`, `errors`, `money`, `i18n` | other primitives with no cycles | apps, services, verticals, provider SDKs |
| Core domain | `core-domain`, `permissions`, `events`, `jobs` | primitives and stable contracts | Laundry module, UI, Supabase client, DigitalOcean SDK |
| Vertical domain | `vertical-laundry` | Core domain and primitives | application UI, provider SDKs, future verticals |
| Contract packages | `api-contracts`, `edge-contracts`, `file-contracts`, `sync-protocol` | primitives, schemas, error catalogue | concrete server/client implementations |
| Platform adapters | auth, logging, observability, database adapter libraries | contracts and vendor SDKs | importing an app or owning business policy |
| Applications | portals, mobile, Electron, Storefront | packages and app-local features | another app's internals or privileged server packages |
| Services | sync, file, notification, AI, provisioning | packages and service-local modules | another service's private source tree |
| Tests/tooling | factories, validators, test runners | public exports | production imports from test packages |

## 3. Non-negotiable boundaries

1. `packages/core-domain` never imports `packages/vertical-laundry`.
2. A vertical module may extend Core through explicit interfaces, registrations and schema deltas; it may not fork transaction, payment, inventory, finance, audit or identity logic.
3. Apps and services import another workspace only through its declared package exports, never `../../other-workspace/src/...`.
4. No browser, mobile or Electron renderer package imports Node-only modules, service-role credentials or database drivers.
5. No POS client bypasses the Store Hub for normal in-store operations.
6. No connector imports database repositories. Connectors use the Connector API and governed event/job contracts.
7. No AI package receives unrestricted production database access. AI uses scoped retrieval and MCP tools.
8. No package writes finalized finance, payment, inventory or audit data outside the owning service/transaction boundary.
9. Circular workspace dependencies are forbidden.
10. Optional metadata JSON never becomes an authority substitute for relational columns and constraints.

## 4. Package public API

Every package must use explicit exports:

```json
{
  "name": "@kitluy/money",
  "private": true,
  "type": "module",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./format": { "types": "./dist/format.d.ts", "default": "./dist/format.js" }
  },
  "sideEffects": false
}
```

- `src/index.ts` exposes the supported surface.
- Deep imports into undocumented paths are forbidden.
- Breaking public-export changes require a change record and coordinated migration.
- Shared React libraries declare React as a peer dependency; they do not bundle a second React runtime.
- Runtime packages and type-only packages are separated when this prevents client bundles from importing server code.

## 5. Ports and adapters

Domain/application code defines ports such as:

```ts
export interface BookingRepository {
  findById(scope: StoreScope, id: BookingId): Promise<Booking | null>;
  save(command: SaveBookingCommand): Promise<SaveBookingResult>;
}
```

Supabase, local PostgreSQL, HTTP and test-memory implementations live in infrastructure packages or deployable-local adapters. The interface does not mention PostgREST, SQL clients, DigitalOcean or Electron IPC.

## 6. Platform-specific rules

### 6.1 Web/PWA

- Server-only code is isolated from browser bundles.
- `window`, DOM and service-worker APIs do not appear in universal Core packages.
- Auth tokens are handled by approved auth adapters; service-role keys are server-only.

### 6.2 React Native / Expo

- Native modules are accessed through app-owned adapters.
- Shared mobile packages cannot import Electron or browser-only APIs.
- Expo SDK libraries are installed with `pnpm expo install` to preserve the SDK compatibility set.

### 6.3 Electron

- Main, preload and renderer are separate TypeScript projects.
- Renderer has no direct Node integration.
- Preload exposes a minimal typed IPC bridge; arbitrary channel invocation is forbidden.
- Hardware drivers live behind capability interfaces and cannot be imported by general UI components.

### 6.4 Store Hub

- Hub domain and sync logic is independently testable from systemd, Linux and hardware adapters.
- Local PostgreSQL repositories cannot be imported into cloud services.
- Cloud synchronization cannot rewrite immutable local events; reconciliation uses acknowledgements and compensating records.

### 6.5 Supabase Edge Functions

- Functions share contracts but not mutable global state.
- Service-role use is explicit, minimal and audited.
- Business mutations call canonical use cases/RPCs rather than duplicating domain rules per function.

## 7. Dependency declaration rules

- Internal dependency: `"@kitluy/errors": "workspace:*"`.
- External direct dependencies use exact versions; ranges are forbidden in deployables.
- Peer ranges are narrow and deliberate.
- `dependencies` are runtime; build/test tools stay in `devDependencies`.
- An app must not depend on a provider SDK used only by its backend.
- Duplicate libraries serving the same purpose require an ADR.

## 8. Enforcement

CI must run:

- ESLint restricted-import rules.
- A workspace dependency graph cycle check.
- A rule that Core packages cannot import `vertical-*`.
- A rule that client bundles cannot import server-only packages.
- A rule that package exports cover all cross-workspace imports.
- Bundle analysis for secrets, Node built-ins and duplicated React runtimes.

Suggested machine-readable policy lives at `tooling/validation/dependency-boundaries.json`.

## 9. Change procedure

A new package needs: owner, purpose, class, allowed dependencies, public exports, tests, README, build script and consumers. A package split/merge needs an ADR and migration plan. A temporary boundary exception has an expiry date, issue ID and CODEOWNER approval; permanent undocumented exceptions are prohibited.
