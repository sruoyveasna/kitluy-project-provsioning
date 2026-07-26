\
# KitLuy Suite — Project Home

**Project:** KitLuy Suite  
**Project ID:** `HET-PRJ-002`  
**Lifecycle:** Active  
**Active build phase:** Phase 1 — Laundry  
**AI operating pack:** v1.0.0, 2026-07-26

## Start here

Humans and AI agents use this page as the repository entry point.

1. Read `AGENTS.md`.
2. Read the tool-specific file: `CLAUDE.md` or `KIMI.md`.
3. Read `00_AI_HANDOFF/000_CURRENT_STATE.md`.
4. Read `00_AI_HANDOFF/000_ACTIVE_PHASE.md`.
5. Read `00_AI_HANDOFF/000_BLOCKERS.md`.
6. Open `00_AI_HANDOFF/000_INDEX.md` and locate the assigned task.
7. Do not change code without a complete task package.

## Product direction

KitLuy is a Cambodia-first Digital Store operating system built through phased vertical expansion.

```text
Partner Account
→ Digital Store
→ Vertical Selection
→ Catalog, Pricing, Staff, Payments and Rules
→ Digital Sales Channels
→ Optional Physical Store Location
→ Store Hub, POS and Connected Devices
```

The Digital Store is the control plane. Store Locations are offline-capable edge environments. External channels are governed projections and connectors, never the source of truth.

## Locked roadmap

1. Laundry Stores and Shops
2. Café and Restaurant Stores
3. Online Retailers and eCommerce Businesses
4. Convenience Stores
5. Drugstores and Pharmacies
6. Department Stores
7. Grocery Stores
8. Supermarkets

Roadmap changes require a versioned owner decision.

## Phase 1 canonical user-facing inventory

- `kitluy-b2b-website`
- `kitluy-admin-pwa-portal`
- `kitluy-chain-pwa-portal`
- `kitluy-partner-pwa-portal`
- `kitluy-partner-app`
- `kitluy-pos-desktop-app`
- `kitluy-pos-mobile-app`
- `kitluy-storefront`
- T1 POS Cashier / Intake
- T2 Customer Display Screen
- T3 Clean & Ready Scan-In
- T4 Customer Pickup Scan-Out

Shared services and contracts include KitLuy Core, Store Hub, four governed APIs, File Service, Notification Service, Integration Hub, Connector Runtime, Reporting/Export Service, Release Service, AI Gateway, MCP Server, RAG Indexer, events, jobs, webhooks, audit, finance, inventory, and offline sync.

## Source authority

1. Current versioned owner decisions and project instructions.
2. Applied migrations, verified code/tests, deployment records, and production evidence.
3. Current approved KitLuy Rebuild/Business Bibles, canonical standards, contracts, and product specs.
4. Approved handoffs and reviews.
5. Evidence-based competitor analyses/classifications.
6. Competitor clone/rebuild documents as references only.
7. Superseded planning.

Expected top-level authority documents should be verified in the live repository. Likely current targets include:

- `kitluy-suite-rebuild-bible-v4.0.0.md`
- `kitluy-suite-business-bible-v2.0.0.md`
- source-of-truth control pack
- canonical Supabase implementation pack
- four governed API contracts
- event/job/webhook pack
- canonical business rules and state machines
- security and authorization pack
- Store Hub/offline protocol pack
- shared-service specifications
- UI/UX build pack
- repository and engineering standards pack
- infrastructure and operations pack

Their existence, path, approval state, and supersession status must be verified before use. A filename mentioned here is not evidence that the file exists in the current checkout.

## Repository zones

```text
00_AI_HANDOFF/   swarm coordination, task, review and evidence records
apps/            user-facing applications
services/        backend and edge services
packages/        reusable neutral packages
supabase/        migrations, functions, tests and seeds
infra/           cloud, edge, monitoring and release infrastructure
docs/            canonical product, architecture, API, security, QA and runbooks
tests/           cross-product test suites
tooling/         code generation, release and validation utilities
```

Preserve a different working repository layout until an approved refactor task changes it.

## Technology direction

- React Web/PWA
- React Native + Expo
- Electron + React on Linux ARM64 for T1–T4
- Raspberry Pi OS 64-bit and Raspberry Pi 5 Store Hub
- Supabase for Auth, PostgreSQL, RLS, Realtime, metadata and audit
- DigitalOcean for hosting, workers, Spaces, AI, MCP, RAG and release distribution
- Store Hub local authority with asynchronous cloud sync
- signed staged releases with A/B rollback

Exact versions, commands, environments, and deployment identifiers come from verified repository and infrastructure evidence, not this summary.

## Current operational truth

See `00_AI_HANDOFF/000_CURRENT_STATE.md`. This AI operating pack does not claim that code, migrations, tests, deployments, or pilots exist. Agents must refresh current-state evidence before coding.

## Task lifecycle

```text
DRAFT
→ READY
→ CLAIMED
→ IN_PROGRESS
→ HANDOFF_READY
→ REVIEW_IN_PROGRESS
→ CHANGES_REQUESTED or APPROVED
→ MERGED
→ VERIFIED
→ RELEASED
```

`IMPLEMENTED` is an evidence classification, not a casual synonym for `MERGED`.

## Human-controlled actions

Only authorized humans may approve or execute production migrations, production secret changes, DNS/TLS changes, payment-provider activation, device trust issuance/revocation, release-channel promotion, destructive recovery, regulated workflows, and other sensitive actions defined by policy.
