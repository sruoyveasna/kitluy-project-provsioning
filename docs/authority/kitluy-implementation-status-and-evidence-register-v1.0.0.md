# KitLuy Implementation Status and Evidence Register — v1.0.0

Last updated: 2026-07-26 (KL-BOOTSTRAP-001). Status advances only with the
evidence chain (specification → code → migrations → tests → integration →
deployment → monitoring → pilot → production). **Scaffolded ≠ built ≠ tested.**
Evidence cited is executable in this repository (`pnpm verify`).

## Legend

- **SCAFFOLDED** — boundary, metadata, placeholder only.
- **BUILT** — real code exists in this repo.
- **TESTED** — automated tests exist and pass locally (evidence: test path).
- Nothing in this repository is DEPLOYED, PILOT-PROVEN or PRODUCTION-PROVEN.

## Shared packages (`packages/`)

| Package                                                                                                                                                                                                                                                                                                                                                                        | Status         | Evidence                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------- |
| shared-types                                                                                                                                                                                                                                                                                                                                                                   | BUILT          | Types/guards; exercised by dependent package tests         |
| money                                                                                                                                                                                                                                                                                                                                                                          | BUILT + TESTED | `packages/money/test/money.test.ts` (8 tests)              |
| localization                                                                                                                                                                                                                                                                                                                                                                   | BUILT + TESTED | `packages/localization/test/localization.test.ts`          |
| api-errors                                                                                                                                                                                                                                                                                                                                                                     | BUILT + TESTED | `packages/api-errors/test/api-errors.test.ts`              |
| feature-flags (phase gates)                                                                                                                                                                                                                                                                                                                                                    | BUILT + TESTED | `packages/feature-flags/test/phase-gates.test.ts`          |
| resource-scope                                                                                                                                                                                                                                                                                                                                                                 | BUILT          | Structural helpers; covered via rbac tests                 |
| rbac                                                                                                                                                                                                                                                                                                                                                                           | BUILT + TESTED | `packages/rbac/test/rbac.test.ts`                          |
| approvals (A0–A4, four-eyes)                                                                                                                                                                                                                                                                                                                                                   | BUILT + TESTED | `packages/approvals/test/approvals.test.ts`                |
| audit (append-only)                                                                                                                                                                                                                                                                                                                                                            | BUILT + TESTED | `packages/audit/test/audit.test.ts`                        |
| sync-protocol                                                                                                                                                                                                                                                                                                                                                                  | BUILT + TESTED | `packages/sync-protocol/test/sync-protocol.test.ts`        |
| observability                                                                                                                                                                                                                                                                                                                                                                  | BUILT + TESTED | `packages/observability/test/observability.test.ts`        |
| shared-config                                                                                                                                                                                                                                                                                                                                                                  | BUILT + TESTED | `packages/shared-config/test/shared-config.test.ts`        |
| web-ui                                                                                                                                                                                                                                                                                                                                                                         | BUILT          | Rendered by app smoke tests (`apps/*/test/smoke.test.tsx`) |
| event-contracts                                                                                                                                                                                                                                                                                                                                                                | BUILT          | Envelope + registry; no registry content yet               |
| auth, tenant-context, digital-store-context, device-identity, api-contracts, job-contracts, webhook-contracts, edge-contracts, configuration-snapshots, file-contracts, notification-contracts, release-manifests, entitlements, pricing, finance, inventory, customers, catalog, transactions, payments, mobile-ui, pos-ui, printing, hardware, test-fixtures, test-utilities | SCAFFOLDED     | Boundary README + typed placeholder each                   |

## Vertical

| Item                                               | Status               | Evidence                                        |
| -------------------------------------------------- | -------------------- | ----------------------------------------------- |
| phase1-laundry: T1–T4 profiles + capability matrix | BUILT + TESTED       | `verticals/phase1-laundry/test/laundry.test.ts` |
| phase1-laundry: T2 display state machine           | BUILT + TESTED       | same file (spec: POS v4 §6.2)                   |
| phase1-laundry: custody event registry             | BUILT + TESTED       | same file (spec: Hub v1 §10.3–10.4)             |
| phase1-laundry: per-piece/per-weight pricing lines | BUILT + TESTED       | same file                                       |
| phase1-laundry: Booking/production state machines  | REQUIRED VALUE       | Blocked by KLREQ-003 — not invented             |
| Phases 2–8                                         | REGISTERED, INACTIVE | Boundary READMEs only                           |
| Future clients (KDS, guest display, kiosk)         | REGISTERED, INACTIVE | Flags default OFF (tested in feature-flags)     |

## Services (`services/`)

| Item                                                                            | Status                                        | Evidence                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| 18 service kernels (health/ready/version, config validation, graceful shutdown) | SCAFFOLDED boundary; kernel BUILT + TESTED    | `services/*/test/http.test.ts` (5 tests each)                                    |
| 4 governed API OpenAPI governance skeletons                                     | SCAFFOLDED + contract-TESTED                  | `services/kitluy-*-api/test/contract.test.ts`; `pnpm contracts:validate`         |
| kitluy-hub-agent transactional outbox + offline/reconnect harness               | BUILT + TESTED                                | `services/kitluy-hub-agent/test/offline-reconnect.test.ts` (`pnpm test:offline`) |
| kitluy-hub-agent LAN API kernel (agreed routes only)                            | BUILT + TESTED                                | `services/kitluy-hub-agent/test/lan-api.test.ts`                                 |
| kitluy-hub-agent device identity/trust                                          | SCAFFOLDED (interfaces)                       | Blocked: PKI/HSM REQUIRED values                                                 |
| Hub local PostgreSQL adapter                                                    | SCAFFOLDED (interface + in-memory simulation) | Production adapter is next-milestone work                                        |
| Dockerfiles                                                                     | SCAFFOLDED                                    | Not built in CI (no docker on this machine)                                      |
| All service business behavior                                                   | NOT STARTED                                   | —                                                                                |

## Applications (`apps/`)

All eight are **SCAFFOLDED**: buildable branded shells with Khmer/English
locale support, error boundaries, fail-closed data surfaces (operational
portals show no synthetic operational values), and smoke tests.
Evidence: `pnpm build` (68 tasks) + `apps/*/test/*.test.ts(x)`.
React Native apps (partner-app, pos-mobile-app) are typecheck-only shells —
full Expo generation is the next app milestone (ADR-0002).

## Data, infra, CI

| Item                                                          | Status                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Supabase local config + migration conventions + linter        | BUILT (linter TESTED via `pnpm migrations:validate`)                       |
| Production DDL / RLS                                          | REQUIRED VALUE (KLREQ-001) — deliberately absent                           |
| RLS test harness                                              | BLOCKED (Supabase CLI + RLS pack)                                          |
| Terraform env skeletons                                       | SCAFFOLDED (fmt/validate in CI only; terraform absent locally — NOT RUN)   |
| CI workflows (ci/security/infra)                              | SCAFFOLDED — **NOT TESTED** (no GitHub remote; never executed)             |
| Production deploy workflow                                    | DISABLED by design                                                         |
| Integration / e2e / load / recovery / chaos / hardware suites | BLOCKED (documented per tests/*/README.md; runners exit non-zero honestly) |

## Verification evidence (executed 2026-07-26 on this machine)

`pnpm install` · `pnpm format:check` · `pnpm lint` · `pnpm typecheck` (80
tasks) · `pnpm test` (48 tasks) · `pnpm test:contract` (16) · `pnpm
test:offline` (13) · `pnpm build` (68) · `pnpm contracts:validate` ·
`pnpm migrations:validate` · `pnpm secret:scan` · `pnpm docs:check` — all
passing; full transcript summarized in the bootstrap handoff
(`00_AI_HANDOFF/repository/`).
