# KitLuy Suite Project Home

**Filename:** `PROJECT_HOME.md`  
**Control-pack version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL ENTRY POINT  
**Audience:** Humans, KIMI Swarm, Claude Code, ChatGPT, implementation agents, reviewers, QA, DevOps, support and operators

> This is the first file every human or AI agent must read before interpreting, planning, changing or building KitLuy Suite.

## 1. Start here

Read these files in order:

1. [`kitluy-authority-and-precedence-v1.0.0.md`](docs/authority/kitluy-authority-and-precedence-v1.0.0.md)
2. [`kitluy-source-of-truth-index-v1.0.0.md`](docs/authority/kitluy-source-of-truth-index-v1.0.0.md)
3. [`kitluy-glossary-and-naming-standard-v1.0.0.md`](docs/authority/kitluy-glossary-and-naming-standard-v1.0.0.md)
4. [`kitluy-decision-and-reconciliation-register-v1.0.0.md`](docs/authority/kitluy-decision-and-reconciliation-register-v1.0.0.md)
5. [`kitluy-open-decisions-and-required-values-v1.0.0.md`](docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md)
6. [`kitluy-implementation-status-and-evidence-register-v1.0.0.md`](docs/authority/kitluy-implementation-status-and-evidence-register-v1.0.0.md)
7. [`kitluy-superseded-document-register-v1.0.0.md`](docs/authority/kitluy-superseded-document-register-v1.0.0.md)
8. The current master Rebuild and Business Bibles.
9. The current specification for the product or vertical being changed.
10. The applicable schema, API, event, migration, test, deployment and operating evidence.

An agent must not begin implementation from a competitor analysis, clone bible, old rebuild bible, backlog or feature registry alone.

## 2. Current master-authority gate

The intended master authority files are:

| File                                    | Required role                                                                                                                          | Current package state                                                            |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `kitluy-suite-rebuild-bible-v4.0.0.md`  | Consolidated product and technical authority reflecting the eight phases, Digital Store model, T1-T4 and current application inventory | **NOT PRESENT in the supplied source bundle. Must be added and owner-approved.** |
| `kitluy-suite-business-bible-v2.0.0.md` | Consolidated business, pricing, pilot, support, ownership and phase-exit authority                                                     | **NOT PRESENT in the supplied source bundle. Must be added and owner-approved.** |

Until those files are present, the active KitLuy Project Instructions and explicit owner decisions remain the highest product-direction authority. `kitluy-suite-rebuild-bible-v3.0.0.md` and `kitluy-suite-ecosystem-business-bible-v1.0.0.md` are retained only for unaffected material and must not restore the obsolete T1-T3 or physical-Store-first model.

## 3. Locked platform direction

### 3.1 Vertical build roadmap

KitLuy is built by phased vertical expansion:

1. Laundry Stores and Shops
2. Café and Restaurant Stores
3. Online Retailers and eCommerce Businesses
4. Convenience Stores
5. Drugstores and Pharmacies
6. Department Stores
7. Grocery Stores
8. Supermarkets

A phase must remain independently deployable and commercially viable. Roadmap changes require a versioned owner decision.

### 3.2 Digital-first operating model

```text
Partner Account
  -> Digital Store
  -> Primary Vertical
  -> Catalog, Pricing, Staff, Payments and Rules
  -> Digital Sales Channels
  -> Optional Store Location
  -> Store Hub, POS and Connected Devices
```

The **Digital Store** is the control plane. A **Store Location** is an optional physical, offline-capable edge environment. External websites, marketplaces, delivery services and connectors are governed channels and never own customer, inventory, payment, finance or audit truth.

### 3.3 Vertical isolation

Each Digital Store belongs to exactly one primary vertical. A Partner operating different business types creates separate Digital Stores under the same Tenant or Partner Account.

### 3.4 Shared Core

All verticals reuse KitLuy Core for Tenant, Digital Store, Store Location, identity, permissions, catalog, pricing, customers, transactions, payments, inventory, purchasing, finance, reporting, Store Hub, POS, offline sync, files, notifications, jobs, webhooks, audit, integrations and AI controls.

A vertical adds only its terminology, schema delta, workflows, interfaces, reports, hardware profile, defaults and rules. Laundry terminology must never be hardcoded into neutral Core contracts.

### 3.5 Store edge authority

After provisioning, the Store Hub is the local operational authority. T1-T4 and approved local clients communicate with the Hub over LAN. Cloud synchronization is asynchronous. Internet failure must not stop approved local operations.

### 3.6 Laundry terminal roles

| Role | Canonical name                    | Binding responsibility                                                                                      |
| ---- | --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| T1   | POS Cashier / Intake Terminal     | Customer intake, authoritative Laundry Booking creation, pricing, deposit/payment, receipt and tag printing |
| T2   | Customer Display Screen           | Customer-facing mirror of Booking, services, totals, KHQR/payment state and pickup information              |
| T3   | Clean & Ready Scan-In Terminal    | Quality/count verification, packaging, storage assignment and Ready custody event                           |
| T4   | Customer Pickup Scan-Out Terminal | Collector verification, balance control, custody release and Booking completion                             |

T2 is not KDS and is not production Scan-In. T3 never performs customer release. T4 alone completes pickup scan-out. T3 and T4 may share hardware but remain separate roles, permissions, modes and audit events.

### 3.7 Technology and provider responsibility

| Layer                 | Direction                                                                          |
| --------------------- | ---------------------------------------------------------------------------------- |
| Web/PWA               | React                                                                              |
| Mobile                | React Native + Expo                                                                |
| Fixed Laundry clients | Electron + React on Linux ARM64                                                    |
| Edge OS               | Raspberry Pi OS 64-bit                                                             |
| Store Hub             | Raspberry Pi 5 reference platform                                                  |
| Supabase              | Auth, PostgreSQL, RLS, Realtime, metadata, audit and authoritative cloud records   |
| DigitalOcean          | App/service hosting, workers, Spaces, AI, MCP, RAG and signed release distribution |

### 3.8 Evidence discipline

Never label a capability `IMPLEMENTED` because it appears in a bible, specification, registry, backlog, mockup or clone document. Use the implementation status model in the evidence register. Every status above `SPECIFIED` requires linked evidence.

## 4. Source classes

| Class                            | Meaning                                                                                   | Permitted use                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Owner authority                  | Current Project Instructions and explicit owner decisions                                 | Product direction, guardrails and conflict resolution |
| Verified implementation evidence | Applied migrations, verified code/tests, deployment records and production/pilot evidence | What actually exists in a named environment           |
| Master authority                 | Current approved Rebuild and Business Bibles                                              | Consolidated target architecture and business model   |
| Product specification            | Current approved product/phase specification                                              | Product-specific target behavior and contracts        |
| Planning registry/backlog        | Master registry, classifications and implementation backlogs                              | Normalization, traceability and work planning only    |
| Competitor evidence              | Evidence-based analyses                                                                   | Comparison and design input only                      |
| Clone/rebuild reference          | Competitor clone bibles                                                                   | Hypotheses and design references only                 |
| Superseded material              | Older or conflicting documents                                                            | Historical traceability only                          |

## 5. Agent startup checklist

Before changing any artifact or repository:

- [ ] Identify the requested product, vertical, environment and release.
- [ ] Read the authority and glossary files.
- [ ] Confirm the active master and product specifications.
- [ ] Check the decision register for owner locks and conflict resolutions.
- [ ] Check the open-value register for unresolved `[REQUIRED: ...]` inputs.
- [ ] Check the superseded register for prohibited legacy concepts.
- [ ] Check the implementation register before making any status claim.
- [ ] Identify Tenant, Digital Store, Store Location, user, role and device scope.
- [ ] Identify offline, finance, payment, inventory, audit and migration impact.
- [ ] Preserve append-only finalized records and human confirmation controls.
- [ ] Create or update tests, monitoring, rollback and documentation evidence.

## 6. Stop conditions

Stop implementation and create a reconciliation entry when:

- two authorities at the same level conflict;
- the requested change would alter a locked roadmap, vertical rule or source-of-truth boundary;
- an exact production value is still `[REQUIRED]`;
- a migration, finance, payment, permission, compliance or safety action lacks authorized human confirmation;
- implementation evidence contradicts the intended target model;
- a competitor or clone design is being promoted without KitLuy approval;
- a change would reintroduce T1-T3, T2-as-Scan-In, T3-as-Scan-Out, Seller naming or physical-Store-first onboarding;
- a connector would receive direct production-database access;
- stale, cached, estimated or demo data would be shown as authoritative truth.

## 7. Change-control rule

Every material change must update, as applicable:

1. decision/reconciliation register;
2. source-of-truth index;
3. glossary/naming standard;
4. open required-values register;
5. implementation/evidence register;
6. superseded-document register;
7. master Rebuild and Business Bibles;
8. affected product/vertical specification;
9. schema/API/event/migration/test/deployment/runbook artifacts.

## 8. Phase completion and Rebuild Test

A phase is complete only when scope, schema, workflows, APIs, permissions, interfaces, offline behavior, hardware, finance rules, reports, integrations, migrations, seeds, QA, security, monitoring, recovery, pilot, go-live checklist and updated Rebuild/Business documentation are approved and evidenced.

**Rebuild Test:** one qualified engineer must be able to reconstruct and operate the vertical from approved documentation, migrations, contracts and deployment instructions.

---

# Repository Operations Addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/PROJECT_HOME.md`. This
addendum carries the repository-specific operating knowledge from the
bootstrap PROJECT_HOME (preserved in git at commit `4a79f66`).

## State correction (KLREC-2026-07-26-005)

Section 2's master-authority gate declares `kitluy-suite-rebuild-bible-v4.0.0.md`
and `kitluy-suite-business-bible-v2.0.0.md` "NOT PRESENT in the supplied
source bundle". **Both are now physically present and canonical** at
`docs/source/canonical/` (ingested 2026-07-26, KL-DOCS-001). The gate is
satisfied; the claim is retained verbatim above only because owner text is
never silently edited.

## Repository map

| Path                                        | Contents                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/`                                     | 8 Phase 1 product shells (fail-closed scaffolds)                                                     |
| `future-clients/`                           | Registered-inactive Phase 2+ clients                                                                 |
| `services/`                                 | 4 governed APIs, shared services, `kitluy-hub-agent` (Store Hub)                                     |
| `packages/`                                 | 40 shared packages (neutral Core)                                                                    |
| `verticals/`                                | `phase1-laundry` (ACTIVE) + phases 2–8 (registered, inactive)                                        |
| `docs/authority/`                           | Working governance documents (owner originals + marked repository addenda)                           |
| `docs/source/`                              | Owner-supplied corpus: `inbox/` originals (immutable), classified copies, `manifests/`, `processed/` |
| `supabase/`, `infra/`, `tests/`, `scripts/` | Data conventions, IaC skeletons, harnesses, tooling                                                  |
| `00_AI_HANDOFF/`                            | Session handoffs — read the latest before working                                                    |

## How to run / test / validate

```bash
pnpm install
pnpm verify        # full safe local suite (11 gates)
pnpm docs:verify   # documentation-governance suite (inventory, hashes,
                   # duplicates, classification, authority, coverage,
                   # status-register evidence, links)
```

Migrations: see `supabase/migrations/README.md` — never auto-applied to
production (KL-INF-P1-037). Handoffs: template in `00_AI_HANDOFF/000_INDEX.md`.

## Current blockers (full register: docs/authority/kitluy-open-decisions-and-required-values-v1.0.0.md)

1. Supabase pack incomplete — `kitluy-suite-supabase-schema-v1.0.0.md`,
   `-rls-and-authorization-`, `-migration-plan-` missing (KLREQ-001).
2. `/edge/v1` route fork between the Store Hub LAN API and Edge Operations
   API documents (KLREC-2026-07-26-001) — Hub business routes stay blocked.
3. Owner documentation-program instruction (`Pasted text.txt`) not physically
   supplied (KLREQ-007).
4. Contract/code drifts pending owner confirmation: terminal-profile
   identifiers, error-code names, event-name format, scope taxonomy,
   permission-key delimiters (KLREC-2026-07-26-009..013).

> Mechanical repair note (KL-DOCS-001): the owner text above linked its
> control-pack siblings by bundle-relative filename; link _paths_ were
> adjusted to `docs/authority/…` so they resolve in this repository. No
> wording was changed. Pristine original: `docs/source/canonical/PROJECT_HOME.md`.
