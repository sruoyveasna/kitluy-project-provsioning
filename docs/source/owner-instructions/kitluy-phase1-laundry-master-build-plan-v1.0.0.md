# KitLuy Phase 1 Laundry — Master Build Plan

| Field | Value |
|---|---|
| **Filename** | `kitluy-phase1-laundry-master-build-plan-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Active vertical** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Primary execution audience** | Claude Code, KIMI Swarm, engineering leads, reviewers, QA, security, DevOps, product owners, implementation operators |
| **Status** | Master execution plan; direct swarm input; not implementation evidence |
| **Primary market** | Cambodia |
| **Locales / money / timezone** | Khmer and English; KHR and USD; `Asia/Phnom_Penh` |
| **Core runtime direction** | React Web/PWA; React Native + Expo; Electron + React on Linux ARM64; Raspberry Pi 5 Store Hub; Supabase + DigitalOcean |
| **Execution model** | Contract-first, dependency-gated, evidence-backed, offline-first, additive and backward-compatible |

> **Mission:** Convert the approved KitLuy Phase 1 Laundry target into an executable, dependency-safe program of work that an AI swarm can build, review, verify, pilot, and hand over without inventing product truth or destabilizing future verticals.

> **Implementation truth:** This plan authorizes work; it does not prove work exists. A capability may advance beyond `SPECIFIED` only when the implementation-status register links to repository, migration, test, deployment, and—where required—pilot evidence.

---

## 1. Authority and source baseline

### 1.1 Authority order

Resolve every conflict in this order:

1. Current project-owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified repository code and executable tests, deployed infrastructure, and production or pilot evidence.
3. Current master authorities: `kitluy-suite-rebuild-bible-v4.0.0.md`, `kitluy-suite-business-bible-v2.0.0.md`, and the approved source-of-truth control pack when present in the repository.
4. Current canonical shared contracts: Supabase, API, events/jobs/webhooks, business rules/state machines, security, Store Hub/offline, shared services, UI/UX, engineering, infrastructure, operations, and AI handoff packs.
5. Current Phase 1 product specifications dated July 24–25, 2026.
6. `kitluy-master-feature-registry-v0.2.*` and owner decision locks.
7. Approved implementation handoffs and independent review records.
8. Evidence-based competitor analyses and classifications.
9. Competitor clone/rebuild documents as design references only.
10. Superseded planning.

If an authority named above is absent from the repository, the swarm must record the missing artifact in `00_AI_HANDOFF/000_BLOCKERS.md`; it must not silently replace the missing authority with an older document.

### 1.2 Primary planning sources used

- Current KitLuy Project Instructions and owner locks.
- `kitluy-master-feature-registry-v0.2.md`, `.json`, and `.csv`.
- `kitluy-owner-decision-lock-12-capabilities-v1.0.md`.
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`.
- `kitluy-chain-portal-phase1-spec-v3.0.0.md`.
- `kitluy-partner-portal-phase1-spec-v2.0.0.md`.
- `kitluy-partner-app-phase1-spec-v2.0.0.md`.
- `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md`.
- `kitluy-pos-mobile-app-phase1-spec-v2.2.0.md` as a supporting staff-client boundary, not a replacement for T1–T4.
- `kitluy-storehub-phase1-spec-v1.0.0.md`.
- `kitluy-storefront-phase1-spec-v1.1.0.md`.
- `kitluy-b2b-website-phase1-spec-v1.0.0.md`.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`.
- Approved comparison, classification, and implementation-backlog packages for WooCommerce, Toast, Shopify, Lightspeed, and Loyverse, used only through the KitLuy authority rules.

---

## 2. Locked Phase 1 boundaries

### 2.1 Product and architecture locks

- KitLuy is a **Digital Store operating system**. The Partner account and Digital Store exist before any optional physical Store Location.
- Each Store has exactly one primary vertical. Phase 1 implements the Laundry delta only.
- Shared Core owns neutral Tenant, Digital Store, Location, identity, permissions, catalog, pricing, customer, transaction, payment, inventory, finance, reporting, files, notifications, jobs, events, webhooks, audit, integrations, and AI controls.
- Laundry adds only Laundry terminology, schema delta, workflows, rules, reports, hardware profile, defaults, and interfaces.
- Store Hub is the local operational authority after provisioning. T1–T4 use the Hub over LAN; cloud synchronization is asynchronous.
- T1 is POS Cashier / Intake; T2 is Customer Display Screen; T3 is Clean & Ready Scan-In; T4 is Customer Pickup Scan-Out.
- T3 and T4 may share hardware in a small Store but remain distinct modes, permissions, workflows, and audit events.
- Supabase owns Auth, PostgreSQL, RLS, Realtime, metadata, and audit. DigitalOcean owns application hosting, workers, Spaces, AI, MCP, RAG, and release distribution.
- Releases are signed and promoted `Internal → Pilot → Stable`; Store Hub distributes edge artifacts and supports A/B rollback.
- Reporting, analytics, historical retention, exports, and data services are not commercially paywalled. Security, privacy, fair-use, and abuse controls still apply.

### 2.2 Phase 1 Storefront boundary

Phase 1 Storefront means QR/Web/Telegram **Pre-Intake Draft + physical queue check-in + T1 verification + customer confirmation + atomic Booking conversion**. It does not authorize general eCommerce carts, online prepayment before T1 verification, themes, custom domains, subscriptions, broad promotion engines, shipping zones, or a public app marketplace.

### 2.3 Explicit program exclusions

The master plan does not build:

- Café/Restaurant menus, KDS, floor plans, tables, checks, course firing, tips, or restaurant shifts.
- Phase 3 general eCommerce storefront, cart, checkout, subscriptions, international markets, themes, or public extensions.
- Phase 4+ retail, convenience, pharmacy, department-store, grocery, or supermarket workflows.
- A full statutory general ledger, payroll system, diagnostic medicine features, or autonomous financial/compliance decisions.
- Offline card capture.
- Direct connector access to production databases.
- A separate infrastructure PWA in Phase 1.
- Any capability marked `DEFER`, `REJECT`, or unresolved without its required decision gate.

---

## 3. Swarm execution contract

### 3.1 Unit of work

Every coding assignment must be a versioned task record using `00_AI_HANDOFF/TASK_TEMPLATE.md` and an ID in this form:

```text
WS-<workstream>-T<three-digit sequence>
Example: WS-07-T014
```

A task must declare:

- objective and acceptance criteria;
- authoritative source sections and Feature IDs;
- allowed repository paths;
- dependencies and expected contracts;
- schema/API/event/permission/offline impact;
- migration and rollback impact;
- tests to add or update;
- evidence paths;
- documentation changes;
- explicit non-goals.

### 3.2 Agent rules

1. Read `PROJECT_HOME.md`, `AGENTS.md`, the active phase file, current state file, blockers, and this plan before editing.
2. Do not widen scope beyond the assigned workstream and task.
3. Do not rename canonical entities or introduce competing models without a conflict record and owner-approved decision.
4. Do not mark work complete because code compiles. Completion requires the task's evidence package.
5. Do not apply production migrations, rotate production secrets, approve sensitive actions, or promote Stable releases automatically.
6. Preserve append-only finalized transaction, payment, inventory, finance, custody, and audit records; use compensating records.
7. Keep APIs/events versioned, idempotent, scoped, auditable, retry-safe, and backward-compatible unless a versioned breaking change is approved.
8. Never bypass API authorization with frontend controls or service-role shortcuts. RLS and backend enforcement remain mandatory.
9. Never make Store operations depend on WAN availability after provisioning.
10. Never represent demo, cached, stale, partial, or estimated data as authoritative truth.

### 3.3 Required independent review

A different agent or human reviewer must independently review:

- migrations and destructive-risk SQL;
- RLS and authorization changes;
- payment, finance, inventory, custody, and audit logic;
- sync/conflict/idempotency logic;
- device certificate, provisioning, release, and recovery logic;
- production infrastructure and secrets changes;
- Phase gate evidence.

---

## 4. Implementation status model

| Status | Meaning | Minimum evidence |
|---|---|---|
| `PROPOSED` | Candidate only | Planning source |
| `OWNER-LOCKED` | Binding owner decision | Versioned decision record |
| `SPECIFIED` | Approved target behavior | Canonical specification |
| `CONTRACT-APPROVED` | Schema/API/event/permission/offline contracts approved | Reviewed G1 package |
| `SCAFFOLDED` | Repository shape and non-authoritative skeleton exist | Commit/build evidence |
| `IMPLEMENTED-IN-DEV` | Functional in development | Code, migrations, automated tests |
| `INTEGRATION-VERIFIED` | Cross-product behavior verified | G3 test evidence |
| `PILOT-READY` | Operational package prepared | G4 evidence |
| `PILOT-PROVEN` | Approved real pilot evidence | Pilot records and sign-off |
| `PRODUCTION` | Authorized production operation | Change, deployment, monitoring evidence |
| `DEPRECATED` | Superseded and controlled | Migration/removal record |

No status above `SPECIFIED` may exist without direct evidence links in `kitluy-implementation-status-and-evidence-register-v1.0.0.md`.

---

## 5. Global gates

| Gate | Program-level exit condition |
|---|---|
| **G0 — Authority** | Active Phase 1 scope, terminology, owner locks, source precedence, exclusions, open decisions, and required values are versioned. |
| **G1 — Contract** | Canonical schema delta, APIs/events/jobs/webhooks, state machines, permissions/RLS, audit, offline behavior, migrations, feature flags, and documentation plan are approved. |
| **G2 — Build** | Code, migrations, seeds, UI, jobs/workers, localization, observability hooks, and automated unit/component/contract tests are complete in development. |
| **G3 — Integrated verification** | Cross-product, Hub/LAN, offline/reconnect, RLS/isolation, payment/finance/inventory/custody reconciliation, performance, security, release, restore, and recovery tests pass. |
| **G4 — Pilot readiness** | Monitoring, alerts, support, training, hardware certification, migration/rollback rehearsals, spares, incident response, and go-live checklists are ready. |
| **G5 — Phase exit / Rebuild Test** | Approved pilot evidence exists, controlled go-live succeeds, all required workstreams pass their exit gates, and one qualified engineer reconstructs and operates Phase 1 from current artifacts. |

A workstream may reach a local G2 while another remains at G1, but no dependent workstream may claim integrated completion before all required upstream contracts and evidence are accepted.

---

## 6. Dependency graph and execution waves

### 6.1 Critical path

```text
WS-00 → WS-01 → WS-02/03/04 → WS-05/06 → WS-07 → WS-08
                                      ↓
WS-09 → WS-10 → WS-11 → WS-12/13/14/15
  ↓                 ↓
WS-16/17/18/19  WS-20
  ↓                 ↓
WS-22 → WS-23 → WS-24 → WS-25 → WS-26

WS-21 begins after WS-02/03 and can proceed in parallel.
```

### 6.2 Execution waves

| Wave | Workstreams | Advancement rule |
|---|---|---|
| **Wave A — Authority and engineering base** | WS-00, WS-01 | No domain build starts until repository, source authority, environments, CI, and evidence conventions pass G0/G1. |
| **Wave B — Shared control plane** | WS-02, WS-03, WS-04 | Identity, hierarchy, authorization, RLS, audit, and approvals become reusable platform contracts. |
| **Wave C — Shared business foundations** | WS-05, WS-06, WS-08 | Catalog/pricing, customer, and payment/finance contracts are approved before Booking finalization. |
| **Wave D — Laundry and edge core** | WS-07, WS-09, WS-10, WS-11 | Laundry lifecycle, local runtime, sync, configuration publication, and fleet identity converge. |
| **Wave E — Store operational clients** | WS-12, WS-13, WS-14, WS-15 | T1–T4 are built against the accepted Hub and domain contracts. |
| **Wave F — Management and acquisition surfaces** | WS-16, WS-17, WS-18, WS-19, WS-20, WS-21 | Portals/apps/site consume accepted contracts; they do not invent domain truth. |
| **Wave G — Shared delivery and insight** | WS-22, WS-23 | Files, notifications, integrations, reports, exports, and truth envelopes are integrated. |
| **Wave H — Operational assurance** | WS-24, WS-25 | Infrastructure, monitoring, recovery, security, and performance prove the system. |
| **Wave I — Pilot and exit** | WS-26 | Pilot executes only from a signed release candidate with accepted G4 evidence. |

### 6.3 Parallelism constraints

- WS-02 and WS-03 may run in parallel after WS-00/01, but WS-03 cannot finalize provisioning without WS-02 identity and membership contracts.
- WS-04 may design in parallel with WS-02/03; enforcement migration waits for stable resource IDs and scope hierarchy.
- WS-05, WS-06, and WS-08 may build in parallel after G1 shared contracts.
- WS-09, WS-10, and WS-11 require one shared Edge contract owner to prevent divergent local/cloud models.
- WS-12–15 may scaffold clients early, but mutations cannot be accepted until WS-07/08/09/10/11 contracts pass G1.
- WS-16–21 may build shells and read-only pages early; authoritative mutations and status claims wait for domain evidence.
- WS-24 and WS-25 start in Wave A as continuous disciplines, but their final gates occur after system integration.

---

## 7. Cross-workstream invariants

Every workstream must preserve:

- `tenant_id`, `digital_store_id`, `location_id`, actor, device, environment, and correlation context where applicable;
- Khmer/English localization, KHR/USD, and `Asia/Phnom_Penh`;
- append-only finalized business effects and immutable audit;
- explicit source, authority, completeness, freshness, and reconciliation labels;
- idempotency keys and replay safety for writes and jobs;
- RLS plus backend permission enforcement;
- offline Store continuity and deterministic reconnect behavior;
- versioned schemas, APIs, events, configuration, and releases;
- human confirmation for sensitive financial, permission, compliance, safety, or production actions;
- additive migrations and backward-compatible rollout by default;
- documented rollback and recovery before promotion.

---

## 8. Workstream specifications

### WS-00 — Governance and repository foundation

| Field | Workstream contract |
|---|---|
| **Objective** | Create the authoritative repository control system that prevents agents from treating conflicting documents, plans, and implementation evidence as equivalent. |
| **In scope** | Repository root governance files; source-of-truth index; authority and precedence; glossary; active phase; current state; blockers; decision/reconciliation register; superseded-document register; implementation-status/evidence register; AI handoff templates; CODEOWNERS and ownership map; documentation verification tooling. |
| **Explicitly out of scope** | Business-domain implementation, UI, database tables beyond documentation registries, production deployment, or automatic resolution of owner decisions. |
| **Dependencies** | None. This is the first executable workstream. |
| **Feature IDs** | `KLMF-GOV-002`, `KLMF-GOV-003`, `KLMF-GOV-004`, `KLMF-API-003`, `KLMF-OPS-009`; governance artifacts from the owner-approved documentation program. |
| **Schema objects** | Documentation registries only. If machine-readable governance is stored in DB later, it requires a separate contract; do not create production tables here. |
| **APIs / events / jobs** | No product API. Add documentation validators, source-link checks, feature-ID orphan checks, and evidence-link checks as repository scripts/CI jobs. |
| **UI routes** | None. |
| **Permissions** | Document owners, approvers, reviewers, and production evidence signatories; CODEOWNERS must protect authority, migration, security, and release paths. |
| **Offline behavior** | Not applicable to Store operation. Repository and handoff artifacts must remain usable without external chat history. |
| **Tests** | Broken-link checks; duplicate/superseded authority checks; unresolved `[REQUIRED:]` registry check; feature-ID uniqueness; missing handoff/evidence path check; documentation lint. |
| **Evidence** | Commits for all governance files; green `docs:verify`; review record; repository tree snapshot; signed owner approval of active Phase 1 and authority map. |
| **Documentation updates** | `PROJECT_HOME.md`, `AGENTS.md`, `CLAUDE.md`, `KIMI.md`, `CONTRIBUTING.md`, `SECURITY.md`, control-pack files, and `00_AI_HANDOFF/*` templates. |
| **Exit gate** | Local G0 passes: every source has an authority/status, active Phase 1 is explicit, obsolete T1–T3 and physical-Store-first concepts are registered as superseded, and agents have one entry path. |

### WS-01 — Development environments and CI

| Field | Workstream contract |
|---|---|
| **Objective** | Create reproducible development, test, staging, and production delivery foundations with locked toolchains, quality gates, artifact traceability, and no automatic production change. |
| **In scope** | Monorepo scaffolding; package boundaries; exact Node/pnpm/TypeScript versions; local dev bootstrap; Supabase local/dev setup; container standards; CI workflows; lint/type/test/build/security/docs gates; preview deployments; migration validation; artifact signing/SBOM; branch/PR policy; evidence retention. |
| **Explicitly out of scope** | Business functionality, production account credentials, automatic production migrations, Stable promotion, or DOKS operation. |
| **Dependencies** | WS-00. |
| **Feature IDs** | `KL-INF-P1-004`, `005`, `006`, `008`, `022`, `023`, `037`; `KLMF-DEV-009`, `KLMF-OPS-004`, `KLMF-OPS-011`. |
| **Schema objects** | Migration directory conventions, schema ownership map, migration ledger/evidence format; no unapproved domain DDL. |
| **APIs / events / jobs** | CI checks for OpenAPI/JSON Schema/event compatibility; health checks for deployables; build metadata endpoint contract. |
| **UI routes** | Developer tooling only; optional internal preview index. No customer route. |
| **Permissions** | Repository read/write, CI maintainers, protected branches, environment-specific deploy roles, production approval role separated from build role. |
| **Offline behavior** | Local development must support mocked cloud dependencies, but production offline behavior belongs to WS-09/10. |
| **Tests** | Clean-clone bootstrap; deterministic install; lint/type/unit; migration up/down or forward-repair validation; contract diff; dependency and secret scans; artifact signature verification. |
| **Evidence** | Pinned toolchain files, lockfile, CI run links, reproducible build hashes, SBOM, signed artifact example, preview deployment, migration validation report. |
| **Documentation updates** | Monorepo blueprint, package boundaries, coding/testing/database/error/logging standards, branching/PR policy, dependency policy, Definition of Done, environment matrix, CI/CD policy. |
| **Exit gate** | G1 engineering foundation accepted and one clean environment can build/test all scaffolds without undocumented steps. |

### WS-02 — Identity, Tenant and membership

| Field | Workstream contract |
|---|---|
| **Objective** | Implement the root identity, authentication, Tenant/Partner account, user, employee, membership, invitation, session, and context-resolution contracts used by every product. |
| **In scope** | Supabase Auth integration; phone-first/passwordless baseline; Google sign-in completion path where approved; users/profiles; Partner account/Tenant; memberships; invitations; account recovery; session claims; employee linkage; context resolver; multi-context selector; service identities boundary. |
| **Explicitly out of scope** | Digital Store configuration, device certificates, detailed RBAC grants, customer identity, subscription pricing, or production support impersonation. |
| **Dependencies** | WS-00, WS-01. Coordinate resource hierarchy with WS-03 and authorization with WS-04. |
| **Feature IDs** | `KLMF-FIN-007`, `KLMF-RES-024`, `KLMF-CUS-014`, `KLMF-SEC-003`, `KLMF-SEC-011`; `KB2B-AUTH-001..005`, `KB2B-REG-001..002`, `KB2B-ROUTE-001..003`. |
| **Schema objects** | `users`, `user_profiles`, `tenants`, `partner_accounts`, `tenant_memberships`, `membership_roles` compatibility layer, `invitations`, `auth_identities`, `employee_user_links`, `session_contexts`, `service_accounts` references, status/history tables. |
| **APIs / events / jobs** | Management API: auth bootstrap, membership resolution, invitation, recovery, profile completion; events: `tenant.created`, `membership.invited`, `membership.accepted`, `membership.revoked`, `identity.linked`; jobs: invitation delivery and membership cache invalidation. |
| **UI routes** | B2B `/register`, `/login`, `/recover`, `/invite/:token`, `/select-context`; shared auth callback/error routes; portal access-denied and no-membership states. |
| **Permissions** | Self-profile; tenant owner; membership admin; HET verification roles; service identity registration only through authorized backend. RLS isolates users and memberships by permitted Tenant context. |
| **Offline behavior** | Authentication and initial provisioning require cloud access. Existing Store users may authenticate locally under WS-09 policies after provisioning; cloud account changes synchronize and may revoke local access. |
| **Tests** | Phone normalization; OTP throttling; invitation replay/expiry; account recovery; cross-Tenant isolation; membership revocation; multi-context selection; session claim tamper; disabled user; audit completeness. |
| **Evidence** | Applied dev migrations; Auth configuration export; API contract tests; RLS negative tests; end-to-end signup/invite/login/recovery recordings; audit events. |
| **Documentation updates** | Identity/auth contract, data dictionary, RLS policies, API scopes/errors, privacy/retention, route inventory, QA cases, support runbook. |
| **Exit gate** | G3 identity verification passes and every app can resolve an authorized context without trusting client-supplied Tenant/Store/Location IDs. |

### WS-03 — Digital Store and Location

| Field | Workstream contract |
|---|---|
| **Objective** | Implement the Digital Store control plane, one-primary-vertical rule, optional Store Locations, readiness state, operating settings, and provisioning handoff. |
| **In scope** | Digital Store creation; Laundry vertical selection; Store profile; Location profile; addresses; hours/closures; languages/currencies; online-only/private state; readiness checklist; physical provisioning request; Location activation lifecycle; channel and physical readiness status. |
| **Explicitly out of scope** | Catalog detail, device trust, terminal activation, Storefront general commerce, multi-vertical Store records, or implied implementation status. |
| **Dependencies** | WS-02; authorization primitives from WS-04; catalog dependency WS-05; provisioning consumes WS-11. |
| **Feature IDs** | `KLMF-GOV-002`, `003`, `004`, `012`; `KLMF-CAT-042`; `KLMF-OPS-005`, `007`, `010`, `012`; `KPP-SETUP-001..008`, `KPP-STORE-001..003`, `015..017`. |
| **Schema objects** | `digital_stores`, `store_vertical_assignments`, `store_locations`, `location_addresses`, `business_hours`, `holiday_closures`, `store_settings`, `location_settings`, `readiness_checks`, `provisioning_requests`, `activation_history`, `store_channels`. |
| **APIs / events / jobs** | Management API CRUD/publication for Digital Store/Location; events: `digital_store.created`, `digital_store.vertical_selected`, `location.created`, `location.provisioning_requested`, `location.activated`, `location.suspended`; jobs: readiness recompute and configuration snapshot request. |
| **UI routes** | Partner `/setup`, `/store`, `/locations`, `/locations/:id`, `/settings/business`, `/settings/hours`, `/readiness`; Admin Store/Location verification and activation routes; Chain Store/Location directory routes. |
| **Permissions** | Partner owner/store manager for own Store; Chain roles for governed Stores; HET onboarding/verification/activation roles; Location-scoped mutations; production activation requires reason/audit and policy-defined approval. |
| **Offline behavior** | Digital Store/Location configuration is cloud-authoritative. Published snapshots flow to Hub; local Store operations continue on the last active compatible snapshot during WAN loss. |
| **Tests** | One Store/one vertical constraint; online-only path; Location isolation; closure/emergency status; readiness blockers; duplicate activation; publication compatibility; stale portal display; audit and RLS. |
| **Evidence** | Applied schema; contract tests; setup E2E; activation/rejection history; published snapshot evidence; Hub receipt acknowledgment; owner review. |
| **Documentation updates** | Core model/glossary, data dictionary, state machines, Management/Edge API specs, configuration publication contract, route inventory, go-live checklist. |
| **Exit gate** | G3: a Partner creates a Laundry Digital Store, optionally creates a Location, passes readiness, and generates an auditable provisioning handoff without creating device trust directly. |

### WS-04 — RBAC, RLS, audit and approvals

| Field | Workstream contract |
|---|---|
| **Objective** | Provide explicit, scope-aware, environment-aware authorization with database isolation, immutable audit, re-authentication, reasons, separation of duties, and four-eyes approval. |
| **In scope** | Permission registry; resource scopes; teams/role templates; explicit grants; effective access; environment restrictions; RLS helpers/policies; approval policies/requests/decisions; re-auth tokens; reason codes; audit event registry; support access consent; break-glass; access review. |
| **Explicitly out of scope** | Frontend-only RBAC, broad legacy admin roles as authority, silent scope inference, self-approval, destructive audit edits, or production bypass using service role. |
| **Dependencies** | WS-02 resource identity and memberships; WS-03 scope hierarchy; WS-00 owner/authority records. |
| **Feature IDs** | `KLMF-SEC-003`, `004`, `009`, `010`, `011`; `KL-INF-P1-027..029`; Admin v3.1 authorization direction; `KLMF-CUS-002` layered moderation authority. |
| **Schema objects** | `permissions`, `role_templates`, `teams`, `team_memberships`, `permission_grants`, `resource_scopes`, `environment_scopes`, `approval_policies`, `approval_requests`, `approval_decisions`, `reauth_sessions`, `support_consents`, `break_glass_sessions`, `audit_events`, `access_reviews`. |
| **APIs / events / jobs** | Management API effective-access, grants, approvals, support access, audit search; events: `permission.granted/revoked`, `approval.requested/approved/rejected/expired`, `support_access.started/ended`, `break_glass.activated`; jobs: approval expiry, access review, audit export. |
| **UI routes** | Admin `/access/*`, `/approvals`, `/audit`, `/support/access`; Partner/Chain team and role routes; shared unauthorized/re-auth/reason dialogs. |
| **Permissions** | Authorization administration itself is permissioned and scoped; sensitive production grants require re-auth, reason, immutable audit, and four-eyes approval; SoD rules prevent requester/approver identity overlap. |
| **Offline behavior** | Hub enforces cached signed permission snapshots and local PIN/device identity. Revocations synchronize with priority; high-risk actions fail closed when authorization freshness exceeds policy. |
| **Tests** | RLS cross-Tenant/Store/Location probes; privilege escalation; scope/environment mismatch; self-approval denial; approval binding/replay; support consent expiry; break-glass; audit immutability; shadow-mode comparison. |
| **Evidence** | Permission registry, applied RLS, negative-test suite, effective-access fixtures, approval lifecycle E2E, audit extracts, over-privilege remediation report. |
| **Documentation updates** | RBAC registry, resource-scope model, sensitive-action/four-eyes policy, audit registry, service identity policy, support consent, threat model, security test plan. |
| **Exit gate** | G3 security gate: no protected mutation succeeds through UI/API/SQL without the same authorized, scoped, audited decision. |

### WS-05 — Catalog, pricing and configuration

| Field | Workstream contract |
|---|---|
| **Objective** | Build the neutral Core catalog and Laundry service/pricing delta, then publish versioned compatible configuration to Locations and channels. |
| **In scope** | Services, categories, add-ons, units, piece/weight/flat pricing, price books, contextual assignment, tax presentation, discounts, service availability, emergency pause, receipt/tag templates, configuration drafts, validation, preview, publication, rollback, channel projections. |
| **Explicitly out of scope** | Restaurant menus/modifiers, retail variants depth, arbitrary JSON as authoritative catalog, general eCommerce themes/coupons, or direct local edits that bypass publication. |
| **Dependencies** | WS-03 Store/Location; WS-04 authorization; money/tax rules; WS-10 publication transport. |
| **Feature IDs** | `KLMF-CAT-008`, `011`, `027`, `036`, `042`; `KLMF-LND-012`; `KLMF-PRC-005`; `KLMF-COM-018`, `049`; `KPP-STORE-004..008`, `011..017`; `KCP3-009..017` where Chain governance applies. |
| **Schema objects** | `catalog_items`, `service_definitions`, `service_categories`, `service_addons`, `units_of_measure`, `price_books`, `price_rules`, `location_price_assignments`, `tax_profiles`, `discount_rules`, `availability_rules`, `document_templates`, `configuration_versions`, `publication_targets`, `publication_deployments`. |
| **APIs / events / jobs** | Management API catalog/pricing/configuration; Edge snapshot delivery; Connector projections read only; events: `catalog.version_created`, `pricing.version_created`, `configuration.published/rolled_back`, `service.availability_changed`; jobs: validation, projection build, deployment, retry. |
| **UI routes** | Partner `/catalog/services`, `/catalog/add-ons`, `/pricing`, `/availability`, `/documents`, `/configuration/publish`; Chain `/catalog`, `/pricing`, `/publication`; POS service grid consumes local snapshot. |
| **Permissions** | Catalog editor, pricing editor, publisher, emergency-availability manager, Chain governance roles; publication and rollback require separate permissions and audit; price overrides at POS follow WS-04 approval. |
| **Offline behavior** | Hub uses last active signed configuration; configuration changes are never authored locally except approved emergency availability commands captured as auditable events and reconciled. |
| **Tests** | Per-piece/per-weight/flat calculations; rounding; Location assignment; emergency pause; publication diff/preview; incompatible snapshot rejection; rollback; offline enforcement; cross-channel projection; RLS. |
| **Evidence** | Applied migrations; seeded Laundry services; contract and calculation tests; published/rolled-back snapshot; Hub hash acknowledgment; POS display verification; audit records. |
| **Documentation updates** | Catalog/pricing rules, data dictionary, configuration snapshot contract, publication/rollback policy, route inventory, localization keys, QA matrix. |
| **Exit gate** | G3: an authorized user publishes a validated Laundry configuration to a pilot Hub, POS renders it, rollback restores the prior version, and no finalized Booking is repriced silently. |

### WS-06 — Customer identity and consent

| Field | Workstream contract |
|---|---|
| **Objective** | Create one governed customer identity across T1, Storefront, Telegram, portals, and future channels while preserving consent, privacy, merge history, and offline lookup safety. |
| **In scope** | Phone normalization/verification; guest and identified customer; customer profiles; contact methods; communication consent; privacy requests; duplicate detection/merge; preferences/notes; cross-channel history; customer-safe projections; e-receipt destination. |
| **Explicitly out of scope** | Loyalty depth unless explicitly activated, advertising profiles, unauthorized cross-Store sharing, automatic destructive merge, or diagnosing customer/garment issues. |
| **Dependencies** | WS-02 identity primitives; WS-04 permissions; WS-22 files/notifications; WS-20 Storefront sessions. |
| **Feature IDs** | `KLMF-CUS-006`, `007`, `013`, `014`, `017`; `KLMF-COM-015`, `016`; `KPP-CUST-001..008`; `KLSF-LND-004`; `KPA-V2-CUS-001..002`. |
| **Schema objects** | `customers`, `customer_identities`, `customer_contacts`, `customer_consents`, `customer_preferences`, `customer_notes`, `customer_merge_cases`, `customer_merge_history`, `privacy_requests`, `customer_channel_links`, `customer_activity_refs`. |
| **APIs / events / jobs** | Management/Edge/Commerce Store APIs for lookup, verify, create, consent, merge request, privacy request; events: `customer.created`, `customer.identified`, `customer.consent_changed`, `customer.merge_completed`, `privacy_request.received`; jobs: duplicate review and privacy export/delete workflow. |
| **UI routes** | Partner `/customers`, `/customers/:id`, merge/privacy flows; Storefront phone verification and consent; T1 customer lookup/create; Partner App mini profile. |
| **Permissions** | Customer view/edit/export/merge/privacy permissions separated; consent and privacy actions audited; customer-safe Storefront scope uses session-bound limited projections. |
| **Offline behavior** | Hub caches minimum operational customer data and consent state; local creation uses client IDs/idempotency and later reconciliation; stale consent blocks optional communications but not necessary transactional operation according to policy. |
| **Tests** | Phone normalization; duplicate detection; guest conversion; merge reversibility/history; consent by channel/purpose; privacy access/export/delete guardrails; cross-Tenant isolation; offline lookup/create/convergence. |
| **Evidence** | Applied schema, PII/RLS tests, verification flow, merge case evidence, consent audit, privacy-request dry run, Hub sync proof. |
| **Documentation updates** | Customer identity/consent/privacy rules, schema/data dictionary, API contracts, retention, localization, support and incident runbooks. |
| **Exit gate** | G3: the same authorized customer can enter through Storefront or T1, resolve to one governed identity, preserve consent history, and remain correctly scoped offline and online. |

### WS-07 — Laundry Booking and garment custody

| Field | Workstream contract |
|---|---|
| **Objective** | Implement the authoritative Laundry Booking lifecycle, garments/items, production states, custody events, issues, rewash/damage, due commitments, pickup/delivery context, and append-only history. |
| **In scope** | Draft/final Booking boundary; Booking numbering; service lines; pieces/weight/bags; garments/tags; condition/evidence refs; intake confirmation; production states; due time; issues/rewash/damage/missing; pickup/delivery; T3 Ready event; T4 handover; controlled cancellation/reopen policy; capacity signals. |
| **Explicitly out of scope** | Restaurant orders, general retail checkout, destructive status edits, implicit refunds from issue actions, Laundry Production Display as a new product unless separately approved, or unresolved named/open Booking behavior. |
| **Dependencies** | WS-03/04/05/06; payment/deposit contracts WS-08; Hub/Sync WS-09/10. |
| **Feature IDs** | `KLMF-LND-002..005`, `008..010`, `012`, `014..018`; `KLMF-TXN-002`, `005`, `007..009`; `KLMF-SEC-002`; `KL-POSD4-004`, `006`, `007`, `018..020`; `KL-HUB-P1-012..016`. |
| **Schema objects** | `transactions` neutral header, `laundry_bookings`, `booking_lines`, `booking_line_measurements`, `garments`, `garment_tags`, `booking_status_history`, `custody_events`, `production_events`, `issue_cases`, `issue_items`, `rewash_events`, `damage_reports`, `fulfilment_records`, `storage_assignments`, `booking_notes`. |
| **APIs / events / jobs** | Edge mutations for intake/finalize/status/custody/issue; Management reads/controlled actions; events: `laundry_booking.created/received/production_status_changed/ready/picked_up/completed/cancelled`, `garment.custody_scanned_in/out`, `issue.opened/resolved`; jobs: due/overdue evaluation, notification requests, reconciliation. |
| **UI routes** | T1 intake/detail; T3 ready scan; T4 pickup; Partner Order Center/detail/issues; Partner App Booking queues/detail/timeline; Chain reports read-only. |
| **Permissions** | T1 intake/finalize; production staff status transitions; T3 ready-only; T4 release-only; managers issue/cancel/controlled reopen; custody and finalized Booking changes append-only and audited. |
| **Offline behavior** | All Store operational writes persist on Hub first with local IDs/idempotency. T1–T4 complete LAN workflows without WAN. Cloud receives ordered events; conflicts use domain policies, never generic last-write-wins for custody or finalized records. |
| **Tests** | State-machine transitions; duplicate scan; wrong terminal role; tag collision; partial garments; T3 count/QA/storage; T4 collector/balance/release; issue/rewash/damage; cancellation compensation; offline full day and replay; numbering convergence. |
| **Evidence** | State-machine approval; applied migrations; scenario fixtures; Hub/POS E2E; custody ledger proof; replay/reconciliation report; pilot Booking samples with redacted evidence. |
| **Documentation updates** | Laundry state machines, transaction lifecycle, custody policy, issue rules, API/events, schema/data dictionary, terminal SOPs, QA and recovery. |
| **Exit gate** | G3: a Booking moves from T1 intake through production, T3 Ready, and T4 pickup exactly once, online or offline, with complete custody and audit history. |

### WS-08 — Payments, deposits and reconciliation

| Field | Workstream contract |
|---|---|
| **Objective** | Implement provider-independent cash/KHQR/tender handling, deposits and balances, verified payment state, refunds/voids through compensating records, settlement, cash control, and operational finance subledger. |
| **In scope** | Tender registry; cash and KHQR; deposit/balance rules; mixed tender if approved; payment intents/attempts/events; provider webhook verification/deduplication; receipts; refunds/voids/adjustments; register/cash sessions; reconciliation; liabilities; accountant-ready exports; payment/provider health. |
| **Explicitly out of scope** | Offline card capture, card surcharges at Cambodia launch, full statutory GL, automatic sensitive approvals, deletion of finalized payments, or client/browser redirects as payment truth. |
| **Dependencies** | WS-04 approvals; WS-05 pricing/money; WS-07 Booking; WS-24 provider infrastructure; WS-22 notifications/files. |
| **Feature IDs** | `KLMF-PAY-006..008`, `012`, `015`, `017..021`, `023`, `025`, `028`, `029`, `033`, `036`; `KLMF-FIN-001`, `002`, `005`, `008`; `KL-POSD4-013`, `014`, `016`, `023`; owner lock `KLMF-FIN-005`. |
| **Schema objects** | `payment_methods`, `payment_intents`, `payment_attempts`, `payments`, `payment_events`, `provider_events`, `deposits`, `refunds`, `voids`, `adjustments`, `settlements`, `reconciliation_runs`, `reconciliation_items`, `finance_subledger_entries`, `register_sessions`, `cash_movements`, `receipt_documents`. |
| **APIs / events / jobs** | Edge payment create/confirm/cash/receipt; provider webhooks; Management refund/void/reconciliation; events: `payment.initiated/confirmed/failed/refunded/voided`, `deposit.received`, `reconciliation.completed/exception`; jobs: webhook processing, settlement import, reconciliation, receipt generation. |
| **UI routes** | T1 payment/deposit/KHQR; T2 QR/payment status; T4 balance settlement; Partner Finance/reconciliation/cash; Admin provider health; Partner App read-only finance. |
| **Permissions** | Tender, discount, refund, void, cash movement, reconciliation, and export permissions separated; thresholds trigger re-auth/reason/four-eyes; Partner App cannot mutate Phase 1 finance. |
| **Offline behavior** | Cash operates locally and syncs append-only. KHQR requires provider confirmation; when WAN/provider unavailable, show pending/unavailable truthfully and use approved fallback, never false success. No offline card capture. |
| **Tests** | Money/rounding; deposit and balance; duplicate webhook; signature failure; payment retry; mixed tender; refund/void compensation; cash expected vs counted; reconciliation; provider outage; offline cash and reconnect; receipt immutability. |
| **Evidence** | Provider sandbox evidence; applied schema; webhook signature/dedupe logs; reconciliation report; cash close evidence; finance/RLS tests; approval audit; failure-recovery run. |
| **Documentation updates** | Payment/refund/void rules, finance subledger/reconciliation, business-date/close rules, provider contracts, API/error/event registries, cashier SOP, incident runbook. |
| **Exit gate** | G3: every payment state is traceable to an authorized local action or verified provider event, Booking balances reconcile, and no duplicate business effect occurs under retries. |

### WS-09 — Store Hub local runtime

| Field | Workstream contract |
|---|---|
| **Objective** | Build the managed Raspberry Pi 5 local authority that persists Store operations, serves T1–T4 over LAN, controls peripherals/files/queues, survives WAN loss, and exposes truthful health. |
| **In scope** | Linux ARM64 service; local PostgreSQL; local API gateway; device/client authentication; Booking/payment/custody local write path; file cache; print queue; peripheral adapters; local authorization snapshot; health/telemetry; backup; recovery; replacement-first appliance behavior. |
| **Explicitly out of scope** | Cloud database replacement, unmanaged generic hardware, direct terminal-to-cloud normal writes, arbitrary OS access, local authoring of cloud configuration, or field NVMe replacement outside HET policy. |
| **Dependencies** | WS-01 engineering; WS-04 permissions; WS-07/08 contracts; WS-11 device identity. Coordinates tightly with WS-10. |
| **Feature IDs** | `KL-HUB-P1-001..030`; `KLMF-EDGE-003`, `007`, `009`, `011..013`; `KLMF-DEV-012..019`; `KLMF-CAT-039`. |
| **Schema objects** | Local mirrors/projections plus `local_events`, `local_outbox`, `local_inbox`, `sync_cursors`, `idempotency_records`, `terminal_sessions`, `device_clients`, `print_jobs`, `file_cache_entries`, `peripheral_status`, `configuration_snapshots`, `hub_backups`, `health_samples`. |
| **APIs / events / jobs** | Versioned LAN Edge Operations API; local WebSocket/event stream; health/diagnostics; file/print endpoints; cloud mTLS sync client; events/jobs as defined in WS-07/08/10/11. |
| **UI routes** | No public web routes. Local provisioning/diagnostic UI, terminal pairing status, and Admin/Partner read projections. |
| **Permissions** | Hub device certificate; terminal certificates and assigned profiles; staff/PIN actor; local scope and action checks; support access time-limited, consented, redacted, and audited. |
| **Offline behavior** | Primary requirement: full approved T1–T4 and cash operation over LAN during WAN outage; persistent queues; local files; truthful cloud-unavailable status; deterministic recovery. |
| **Tests** | Power loss, DB restart, disk pressure, LAN-only day, duplicate requests, queue replay, clock drift, peripheral faults, terminal replacement, Hub backup/restore, NVMe/board failure policy, mTLS revocation. |
| **Evidence** | Bootable image/build; device bench report; local schema migrations; LAN API tests; 24-hour offline scenario; recovery drill; signed package; hardware inventory and telemetry screenshots. |
| **Documentation updates** | Local DB schema, LAN API, file cache/transfer, terminal profiles, hardware matrix, recovery/replacement runbook, diagnostics SOP, security policy. |
| **Exit gate** | G3: a certified Hub runs a complete pilot Store workflow without WAN and later reconciles exactly once without data loss or authority ambiguity. |

### WS-10 — Sync and configuration publication

| Field | Workstream contract |
|---|---|
| **Objective** | Implement versioned cloud-to-edge configuration projection and edge-to-cloud event synchronization with idempotency, sequencing, replay, conflict policy, freshness, and reconciliation. |
| **In scope** | Configuration snapshot build/sign/publish/activate/rollback; sync push/pull; cursors; event ordering; idempotency; deduplication; outbox/inbox; conflict classes; stale/partial states; retry/backoff; DLQ; replay and reconciliation; compatibility negotiation. |
| **Explicitly out of scope** | Generic last-write-wins for inventory/custody/finance, silent conflict overwrites, cloud-synchronous Store operation, unversioned payloads, or irreversible publication. |
| **Dependencies** | WS-05 configuration; WS-07/08 events; WS-09 Hub; WS-11 certificates; WS-24 workers/queues. |
| **Feature IDs** | `KLMF-EDGE-002`, `009..011`, `014`, `016`, `017`; `KLMF-DEV-003`, `021`; `KL-HUB-P1-017..019`; `KL-INF-P1-015`, `020`, `021`; `KLMF-OPS-013`. |
| **Schema objects** | Cloud/local `event_outbox`, `event_inbox`, `sync_devices`, `sync_cursors`, `sync_batches`, `sync_failures`, `dead_letters`, `replay_requests`, `reconciliation_cases`, `configuration_packages`, `configuration_activations`, `compatibility_matrix`. |
| **APIs / events / jobs** | Edge Operations `/sync/push`, `/sync/pull`, `/config/check`, `/config/download`, `/config/activate`; events: sync/config lifecycle; jobs: snapshot build, delivery, retry, replay, reconciliation, compaction/retention. |
| **UI routes** | Admin configuration deployment/status/retry/rollback; Partner sync/freshness read-only; Hub local sync diagnostics; portals display freshness envelopes. |
| **Permissions** | Device mTLS and Location binding; publish/rollback/replay/reconcile permissions; sensitive replay or conflict repair needs approval and audit. |
| **Offline behavior** | Hub queues writes indefinitely within capacity policy; configuration continues from last active version; reconnect resumes from durable cursors; incomplete sync is visible and never called live truth. |
| **Tests** | Duplicate/out-of-order batches; cursor loss; network flapping; schema version mismatch; snapshot corruption; rollback; large backlog; poison event/DLQ; replay; concurrent configuration; no duplicate finance/custody effects. |
| **Evidence** | Protocol contract tests; chaos/network test results; replay/reconciliation proof; snapshot signatures/hashes; freshness UI evidence; runbook rehearsal. |
| **Documentation updates** | Edge sync protocol, conflict policy, idempotency/sequencing, configuration snapshot contract, compatibility policy, replay/reconciliation runbook, monitoring thresholds. |
| **Exit gate** | G3: configuration and operational events converge after prolonged disconnection with deterministic, auditable outcomes and no duplicate finalized effects. |

### WS-11 — Device provisioning and fleet management

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver smartphone-simple, closed-fleet provisioning for HET-enrolled Hubs and assigned terminals using certificates, composite identity, role profiles, revocation, diagnostics, releases, and replacement workflows. |
| **In scope** | Manufacturing/enrollment records; part IDs/serials/MAC/fingerprint; hardware-backed keys; manufacturing and operational certificates; provisioning codes; Hub activation; terminal assignment; LAN discovery; cached endpoint/manual fallback; fleet health; revocation; replacement; signed release targeting. |
| **Explicitly out of scope** | Provisioning arbitrary cloned hardware, installer-selected roles, exportable private keys, remote production actions without approval, or Store operation before Hub activation. |
| **Dependencies** | WS-02 identity; WS-03 Location; WS-04 auth/audit; WS-09 runtime; WS-10 config/sync; WS-24 PKI/secrets/release infrastructure. |
| **Feature IDs** | `KLMF-DEV-002`, `004..008`, `019`; `KL-HUB-P1-004..010`, `023..030`; `KL-INF-P1-018`, `019`, `022..024`, `032`; `KLMF-OPS-001`, `006`, `010..012`. |
| **Schema objects** | `hardware_inventory`, `manufacturing_enrollments`, `device_identities`, `device_certificates`, `certificate_revocations`, `provisioning_codes`, `hubs`, `terminals`, `device_assignments`, `terminal_profiles`, `pairing_sessions`, `device_health`, `release_assignments`, `replacement_cases`. |
| **APIs / events / jobs** | Management provisioning/fleet/release APIs; device enrollment/attestation; events: `hub.enrolled/activated/quarantined/revoked/replaced`, `terminal.assigned/paired/revoked`, `certificate.issued/revoked`, `release.assigned/installed/rolled_back`; jobs: certificate issuance, health evaluation, staged rollout. |
| **UI routes** | Admin `/fleet`, `/hardware`, `/provisioning`, `/certificates`, `/releases`; Partner Location hardware readiness and assignment requests; local Hub/terminal guided setup screens. |
| **Permissions** | HET manufacturing, fleet, security, release, support roles separated; Partner may request/assign approved logical names but cannot issue certificates or override hardware identity; production revocation/release promotion controlled. |
| **Offline behavior** | Provisioning requires cloud and active Hub. After activation, terminals resolve Hub via assigned IP/hostname/discovery/cache; normal operation remains LAN-only capable. Revocation enforcement follows signed priority updates. |
| **Tests** | Eligible/ineligible hardware; cloned disk/identity mismatch; expired/reused code; wrong Store assignment; key replacement; certificate rotation/revocation; discovery failure/manual fallback; lost device; Hub/NVMe replacement; staged update/rollback. |
| **Evidence** | PKI test hierarchy, enrollment records, provisioning videos, attestation logs, revocation drill, replacement drill, certified hardware report, release rollout evidence. |
| **Documentation updates** | Device certificate/trust policy, provisioning protocol, hardware matrix, terminal profile contract, fleet SOPs, recovery, secrets references, support consent. |
| **Exit gate** | G4: a new Store can provision Hub then assigned T1–T4 terminals without technical configuration, and compromised/lost devices can be revoked and replaced safely. |

### WS-12 — T1 Intake/Cashier

| Field | Workstream contract |
|---|---|
| **Objective** | Build the cashier/intake terminal for customer lookup, physical garment verification, Booking finalization, pricing, deposit/payment, receipt/tag printing, and Pre-Intake queue processing. |
| **In scope** | Electron shell; T1 profile; staff/PIN switching; service grid; persistent Booking panel; customer lookup/create; pieces/weight/bags; scale/scanner/manual fallback; conditions/evidence; due time; pricing/discount approval; deposit/payment; receipt/tag printing; draft recovery; queue call/assign/verify/convert. |
| **Explicitly out of scope** | T2-only display logic, T3 Ready, T4 handover, cloud-only operation, general retail checkout, offline cards, or finalizing customer estimates without physical verification. |
| **Dependencies** | WS-05/06/07/08/09/10/11; WS-20 for Pre-Intake integration. |
| **Feature IDs** | `KL-POSD4-001..004`, `009..016`, `020..030` as applicable; `KLMF-LND-014`; `KLSF-LND-011..015`, `020`; `KPP-OPS-001..012` read integration. |
| **Schema objects** | Uses Hub schemas for customers, intake drafts, Bookings, lines, measurements, garments, payments, print jobs, actor sessions, idempotency and audit. No direct cloud tables. |
| **APIs / events / jobs** | LAN APIs: customer lookup/create, draft save/finalize, queue call/assign/open, verify differences, convert Booking, payment, receipt/tag print, file capture, staff session; emits Booking/payment/custody/audit events. |
| **UI routes** | Electron T1 `/intake`, `/queue`, `/booking/:id`, `/payment`, `/print`, `/customer-search`, `/diagnostics`, `/practice`. |
| **Permissions** | `booking.intake`, `booking.finalize`, `customer.lookup/create`, `payment.capture_cash/khqr`, `discount.apply/request`, `print.receipt/tag`; manager elevation one-shot and audited. |
| **Offline behavior** | Complete local intake/cash workflow on Hub. KHQR follows WS-08 degraded policy. Queue items already projected to Hub can process; staff-assisted intake always available. |
| **Tests** | Fast path; draft recovery; weight/piece input; scanner/scale faults; duplicate finalize; discount approval; cash/KHQR; print suppression; queue differences/customer confirmation; offline day; actor switching; privacy. |
| **Evidence** | Electron ARM64 build, certified hardware run, T1 E2E suite, performance timings, offline/reconnect capture, receipts/tags, audit and payment reconciliation. |
| **Documentation updates** | T1 screen inventory, keyboard/scan flows, SOP, permissions, error states, localization, hardware setup, QA, support/recovery. |
| **Exit gate** | G3: trained staff completes a correct first Booking and a Storefront-assisted Booking under target performance, online or offline, with exact payment and print evidence. |

### WS-13 — T2 Customer Display

| Field | Workstream contract |
|---|---|
| **Objective** | Build the customer-safe paired display that mirrors the active intake, totals, KHQR, payment state, confirmation version, receipt choice, and pickup reference without exposing staff or prior-customer data. |
| **In scope** | T2 profile/pairing; safe projection; localized service/line/totals; KHQR and verified payment status; customer confirmation; material-difference presentation; e-receipt choice; privacy reset; reconnect/idle lifecycle; accessibility. |
| **Explicitly out of scope** | Production/KDS use, staff controls, T3/T4 workflows, direct payment authority, customer account browsing, or retaining data after session end. |
| **Dependencies** | WS-07/08/09/11/12; WS-20 final confirmation. |
| **Feature IDs** | `KL-POSD4-005`, `017`; `KLMF-LND-016`; `KLMF-CAT-013`; `KLSF-LND-014`; `KL-HUB-P1-013`. |
| **Schema objects** | Ephemeral `customer_display_sessions` and confirmation records where required; authoritative data remains Booking/payment/customer consent records on Hub. No broad customer cache. |
| **APIs / events / jobs** | LAN subscribe/acknowledge/confirm/receipt-choice endpoints; events: `customer_display.session_started/reset`, `intake.confirmed`, `receipt.preference_selected`; no direct finance mutation. |
| **UI routes** | Electron T2 `/display/idle`, `/display/booking`, `/display/payment`, `/display/confirm`, `/display/complete`, `/display/offline`. |
| **Permissions** | Device profile T2 plus session binding to one T1. Customer actions are token/session constrained; no staff permission inheritance. |
| **Offline behavior** | Works from Hub over LAN during WAN loss; displays KHQR/provider status truthfully; resets on disconnect, timeout, T1 completion, or explicit privacy clear. |
| **Tests** | Wrong T1 pairing; stale session; previous customer leakage; confirmation version invalidation; KHQR status; reconnect; timeout/reset; screenshots in Khmer/English; screen reader/color independence; malicious input. |
| **Evidence** | Paired T1/T2 E2E; privacy test recording; confirmation/audit event; offline payment-state demonstration; accessibility report. |
| **Documentation updates** | T2 privacy checklist, screen inventory, pairing protocol, confirmation contract, localization/accessibility, recovery SOP. |
| **Exit gate** | G3: T2 displays only the current customer-safe projection, captures the exact confirmation version, and clears all sensitive state reliably. |

### WS-14 — T3 Ready Scan-In

| Field | Workstream contract |
|---|---|
| **Objective** | Build the role-restricted terminal mode that validates completed garments, QA/count, packaging, storage assignment, and append-only Ready custody events. |
| **In scope** | T3 profile; scan Booking/tag; verify expected vs actual items; QA checklist; issue diversion; packaging; storage location selection; duplicate prevention; Ready event; optional print; operator identity; exception handling. |
| **Explicitly out of scope** | Customer release, payment collection, intake editing, destructive correction, or using T3 as T2/KDS. |
| **Dependencies** | WS-07/09/10/11; files/issues WS-22; POS shell WS-12 shared package. |
| **Feature IDs** | `KL-POSD4-006`, `018`, `020`, `024..029`; `KLMF-LND-017`; `KL-HUB-P1-014`, `016`; `KLMF-SEC-002`. |
| **Schema objects** | Uses `garments`, `garment_tags`, `custody_events`, `production_events`, `storage_locations`, `storage_assignments`, `qa_checks`, `issue_cases`, local idempotency/audit. |
| **APIs / events / jobs** | LAN scan lookup, QA submit, storage assign, issue divert, ready finalize; events: `garment.custody_scanned_in`, `laundry_booking.ready`, `storage.assigned`, `qa.failed`. |
| **UI routes** | Electron T3 `/ready/scan`, `/ready/verify`, `/ready/storage`, `/ready/issue`, `/ready/complete`, `/diagnostics`. |
| **Permissions** | `custody.ready_scan_in`, `qa.perform`, `storage.assign`, `issue.open`; explicitly denied `pickup.release`, `payment.capture`, `booking.intake`. |
| **Offline behavior** | Fully local over Hub; Ready event and storage assignment persist before UI success; later cloud sync preserves sequence and actor/device. |
| **Tests** | Duplicate scan; wrong Booking state; missing/extra garment; failed QA; occupied storage; concurrent T3; device/profile denial; power loss after commit; offline/replay. |
| **Evidence** | T3 hardware/E2E run; custody ledger; storage consistency report; role-negative tests; recovery from interrupted scan; audit evidence. |
| **Documentation updates** | T3 SOP, QA/storage rules, screen inventory, permission matrix, issue paths, hardware/scanner setup, recovery. |
| **Exit gate** | G3: T3 can mark a Booking Ready exactly once only after QA/count/storage validation, without any customer-release authority. |

### WS-15 — T4 Pickup Scan-Out

| Field | Workstream contract |
|---|---|
| **Objective** | Build the only terminal role authorized to verify collector, retrieve garments, enforce balance/exception policy, record handover, and complete pickup. |
| **In scope** | T4 profile; Booking/customer/queue lookup; collector verification; storage retrieval; item/count confirmation; balance collection handoff; issue/hold; custody scan-out; receipt; pickup completion; duplicate prevention. |
| **Explicitly out of scope** | Ready Scan-In, intake editing, unauthorized balance override, releasing held/unpaid goods contrary to policy, or generic last-write-wins completion. |
| **Dependencies** | WS-07/08/09/10/11/14; shared POS shell. |
| **Feature IDs** | `KL-POSD4-007`, `019`, `020`, `024..029`; `KLMF-LND-018`; `KL-HUB-P1-015`, `016`; `KPA-V2-BKG-006..008` read integration. |
| **Schema objects** | Uses Booking/payment balance, storage assignment, collector verification, `pickup_handover`, `custody_events`, receipts, issues/holds, idempotency/audit. |
| **APIs / events / jobs** | LAN pickup lookup, collector verify, balance status/approved payment, retrieve checklist, handover finalize; events: `garment.custody_scanned_out`, `pickup.completed`, `laundry_booking.completed`, `pickup.blocked`. |
| **UI routes** | Electron T4 `/pickup/search`, `/pickup/verify`, `/pickup/retrieve`, `/pickup/balance`, `/pickup/handover`, `/pickup/complete`, `/diagnostics`. |
| **Permissions** | `pickup.lookup`, `collector.verify`, `pickup.release`; payment permissions per WS-08; manager exception approval separated and audited; T4 is sole normal release authority. |
| **Offline behavior** | Local lookup, cash balance, retrieval, and handover work on Hub. KHQR/provider limitations display honestly. Completion persists locally before success. |
| **Tests** | Wrong collector; unpaid/partial balance; already picked up; missing item; storage mismatch; issue hold; manager override; duplicate scan; power loss; offline/replay; T3/T1 profile denial. |
| **Evidence** | T4 E2E/hardware run; payment/custody reconciliation; duplicate-release negative tests; offline handover and cloud convergence; audit/receipt. |
| **Documentation updates** | T4 SOP, collector policy, balance/hold rules, screen/permission inventory, exception handling, recovery and training. |
| **Exit gate** | G3: garments can leave custody only through an authorized, balanced or approved T4 handover with exactly-once completion evidence. |

### WS-16 — Partner Portal

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver the one-Digital-Store back office for setup, configuration, exception-based operation, customers, consumables, employees, finance, reports, Store health, files, notifications, audit, and support. |
| **In scope** | PWA shell; setup/readiness; dashboard/action center; Store/Location configuration; Laundry catalog/pricing/publication; Order Center/issues; customer directory; consumables ledger; employee/PIN/roles; Finance/reconciliation; reports/exports; Hub/T1–T4 health; files; notification settings; audit/support; disabled Integration Hub foundation. |
| **Explicitly out of scope** | POS operations, Chain-wide authority, HET Admin actions, general eCommerce, supplier/PO depth before post-pilot gate, full ERP/payroll, offline mutations, or unlabeled stale finance. |
| **Dependencies** | WS-02..11; WS-22/23. Can scaffold shell after WS-01. |
| **Feature IDs** | `KLMF-CAT-001`, `KLMF-OPS-005`, `007`; `KPP-DASH-001..015`, `KPP-SETUP-001..008`, `KPP-STORE-001..018`, `KPP-OPS-001..012`, `KPP-CUST-001..008`, `KPP-INV-001..010`, employee/finance/report/health feature families. |
| **Schema objects** | Consumes shared authoritative tables/read models. Portal preferences, saved views, export requests, notification settings, support cases, and configuration drafts only in owned schemas. |
| **APIs / events / jobs** | Management API reads/writes; file/notification/report services; domain events/jobs from upstream. Portal must not write ledger tables directly. |
| **UI routes** | `/dashboard`, `/setup`, `/store`, `/locations`, `/catalog`, `/pricing`, `/orders`, `/customers`, `/inventory`, `/employees`, `/finance`, `/reports`, `/store-health`, `/files`, `/notifications`, `/audit`, `/support`, `/settings`. |
| **Permissions** | Partner owner/store manager plus capability-limited supervisors/accountants/read-only; Location and action scopes; backend allowed-actions; sensitive actions re-auth/reason/approval. |
| **Offline behavior** | Installable static shell and protected last-known read cache where specified; cloud back office does not mutate offline. Stale/partial/unavailable states explicit; Store continues through Hub. |
| **Tests** | Route/permission matrix; setup; config publish; Order Center; customer/inventory/employee flows; finance truth; reports; freshness; RLS; accessibility; PWA; failures; cross-product links. |
| **Evidence** | Built routes, API contracts, E2E suite, RLS/permission report, localization/accessibility report, staging deployment, pilot operator acceptance. |
| **Documentation updates** | Partner Portal spec updates, route inventory, components/states/localization/analytics, support and role guides, QA/go-live, source traceability. |
| **Exit gate** | G4: a pilot Partner can configure and supervise one Laundry Digital Store, see truthful operational/finance status, and complete all administrative launch tasks without bypassing Hub or Admin boundaries. |

### WS-17 — Partner App

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver the owner/manager mobile command center with exception-first, truth-labeled, browse-offline views and safe drill-through—not a second back office or POS. |
| **In scope** | Expo app; auth/context; Today; Needs Attention; Booking queues/detail/timeline; Ready aging; issues/evidence; read-only finance; consumables/staff/customer summaries; Hub/T1–T4/peripheral health; notifications/deep links; protected cache; AI Daily Brief/explanations; pilot support escalation. |
| **Explicitly out of scope** | Payment capture, KHQR generation, refunds/void approvals, inventory adjustments, role/PIN administration, direct Hub/terminal commands, or silent demo data. |
| **Dependencies** | WS-02/04/07/08/09/10/16/22/23; AI service foundation if enabled. |
| **Feature IDs** | `KLMF-REP-006`; `KPA-V2-CTX-*`, `TDY-*`, `ATT-*`, `BKG-*`, `ISS-*`, `FIN-*`, `INV/EMP/CUS-*`, `HLT-*`, `OFF-*`, `NOT-*`, `AI-*`; pilot-gated `KPA-V2-MET-001`, `KPA-V2-SUP-001`. |
| **Schema objects** | Mobile device registrations/push tokens, user preferences, notification recipient state, approved read-model projections, AI request/audit metadata. No direct ledger ownership. |
| **APIs / events / jobs** | Mobile bootstrap/context, Today/Attention/Booking/Finance/Health read models, notification read state, AI gateway, support-case creation; safe deep-link resolver. |
| **UI routes** | Tabs/screens: Today, Attention, Bookings, Booking Detail, Issue, Finance, Staff, Inventory, Customer, Store Health, Notifications, Settings/Context. |
| **Permissions** | Partner owner/store manager primary; supervisor/accountant/read-only capability limits; cashier/laundry staff denied by default; all allowed actions supplied by backend. |
| **Offline behavior** | Protected last-known browse-only cache with source time and state labels; logout/membership/schema changes invalidate cache; live mode fails closed. |
| **Tests** | Context isolation; cache security; stale/partial states; read-only finance; deep links; push; T1–T4 health; Khmer/English; accessibility; crashes/performance; AI grounding and failure fallback. |
| **Evidence** | iOS/Android builds; automated/mobile E2E; cache threat tests; read-model freshness proof; AI evaluation; staging/pilot feedback; crash/latency dashboards. |
| **Documentation updates** | Partner App route/screen inventory, read-model contracts, cache policy, AI safety/evaluation, permissions, support and release runbooks. |
| **Exit gate** | G4: an authorized owner understands the Store state in under one minute, can inspect every signal’s source/freshness, and cannot perform prohibited Phase 1 mutations. |

### WS-18 — Chain Portal

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver multi-Store/Location governance, publication, comparison, exception, standards, compliance foundation, and chain reporting without becoming a POS or second operational source of truth. |
| **In scope** | Chain context; overview/action center; Digital Store/Location directories; comparison; master Laundry catalog; pricing guardrails; publication preview/deploy/retry/rollback; service availability/emergency governance; standards/acknowledgement; reports/exports; Hub/T1–T4 health read-only; scoped teams/RBAC; audit; readiness status. |
| **Explicitly out of scope** | Royalties/franchise/B2B depth unless gated, Restaurant governance, stock transfer depth, production mutations, local offline writes, or commercial report paywalls. |
| **Dependencies** | WS-02..11, WS-23; shares publication contracts with WS-05/10 and permissions WS-04. |
| **Feature IDs** | `KLMF-GOV-011`, `012`; `KLMF-CAT-009`, `010`; `KLMF-REP-005`, `012`; `KCP3-001..031` required/foundation; `KCP3-032..040` remain gated as specified. |
| **Schema objects** | `chains`, `chain_memberships`, `chain_store_links`, `catalog_standards`, `pricing_guardrails`, `publication_groups`, `standard_acknowledgements`, `compliance_cases` foundation, saved views, report/export requests. |
| **APIs / events / jobs** | Management API chain resources/publication/reporting; events: chain/store linked, standard published/acknowledged, publication deployment status; jobs: comparison aggregates, publication fan-out, exports. |
| **UI routes** | `/overview`, `/action-center`, `/stores`, `/locations`, `/compare`, `/catalog`, `/pricing`, `/publication`, `/availability`, `/standards`, `/compliance`, `/reports`, `/technology`, `/team`, `/audit`, `/integrations`. |
| **Permissions** | Chain owner/admin/catalog/pricing/publisher/auditor/analyst; scopes limited to linked Stores/Locations; Partner emergency actions remain layered; publication/rollback sensitive. |
| **Offline behavior** | Installable static shell and optional last-known read cache; no offline mutations. Location operations continue via Hub; Chain data carries freshness/completeness labels. |
| **Tests** | Linked-scope isolation; comparison correctness; publication partial failure/retry/rollback; Partner vs Chain availability authority; reports/export; audit; stale gates; localization/accessibility/performance. |
| **Evidence** | Applied Chain schema, route/API tests, multi-Location fixtures, publication integration, RLS/permission report, report reconciliation, pilot Chain acceptance if Phase 1 pilot includes Chain. |
| **Documentation updates** | Chain route inventory, governance matrix, publication/availability rules, metric dictionary, reporting definitions, permission/audit, QA/go-live. |
| **Exit gate** | G4: authorized Chain users govern and compare linked Laundry Stores while every operational value remains sourced, scoped, and freshness-labeled. |

### WS-19 — Admin Portal

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver the HET-only control plane for onboarding, verification, authorization, fleet, releases, provider health, infrastructure, support, billing, incidents, migration governance, and pilot evidence. |
| **In scope** | Admin shell; teams/roles/grants/approvals/audit; Partner/Tenant verification; Store/Location activation; subscriptions/entitlements foundation; fleet/hardware/provisioning/certs; releases; system/provider/connector health; migration/rollback; support consent; incident/ops workspace; infrastructure command center; pilot/go-live records. |
| **Explicitly out of scope** | Partner/Chain access, unscoped super-admin as normal operation, frontend-only enforcement, production migration automation, separate infra PWA, or claiming production truth without evidence. |
| **Dependencies** | WS-02/03/04/08/10/11/24/25; consumes all operational status contracts. |
| **Feature IDs** | `KLMF-GOV-006..010`; `KLMF-DEV-002`, `004..008`; `KLMF-OPS-001..004`, `006`, `008`, `010..013`; `KL-INF-P1-026..029`, `038`; Admin master-registry traceability list. |
| **Schema objects** | Admin authorization/approval/audit tables; verification cases; entitlements/subscriptions; support consents/sessions; incidents; fleet/release tables from WS-11; migration records; go-live evidence; health snapshots/read models. |
| **APIs / events / jobs** | Management/admin APIs, approval service, fleet/release, status, support, migration control, evidence register. Events/jobs for verification, provisioning, releases, incidents, access review, health aggregation. |
| **UI routes** | `/command-center`, `/partners`, `/stores`, `/locations`, `/access`, `/approvals`, `/audit`, `/fleet`, `/hardware`, `/provisioning`, `/releases`, `/providers`, `/connectors`, `/infrastructure`, `/incidents`, `/support`, `/billing`, `/migrations`, `/pilots`. |
| **Permissions** | HET teams and explicit scoped grants; production/environment scopes; re-auth/reason/four-eyes; SoD; temporary support; break-glass; immutable privileged audit. |
| **Offline behavior** | Admin requires cloud. Remote Store actions are queued, scoped, signed, visible, and cannot be assumed applied until Hub acknowledgment. Store operations continue independently. |
| **Tests** | Authorization/RLS negatives; approval/SoD; verification/activation; provisioning/revocation; release staged rollout/rollback; support consent; migration controls; health truth; incident workflow; audit immutability. |
| **Evidence** | Admin routes, applied schema, authorization shadow/enforcement reports, staging deployment, fleet/release/support drills, incident/rollback records, pilot evidence package. |
| **Documentation updates** | Admin spec, SOP index, permission/audit registries, infrastructure workspace, migration/release/support/incident runbooks, route inventory, go-live. |
| **Exit gate** | G4: HET can securely onboard, provision, observe, support, update, recover, and approve a pilot Store with least privilege and complete evidence. |

### WS-20 — Storefront and virtual queue

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver the owner-approved QR/Web/Telegram customer pre-intake and physical virtual queue that reduces T1 data entry while preserving T1 verification and KitLuy authority. |
| **In scope** | Signed Store/Location QR; responsive Web flow; Telegram Bot/Mini App adapter; customer phone verification; preliminary services/items/estimates/notes/evidence; physical check-in; queue ticket/status; T1 queue workspace; difference record; T2/Web/Telegram confirmation; atomic conversion; skip/recall/expiry/no-show; notifications; origin analytics; offline fallback. |
| **Explicitly out of scope** | General cart/checkout, online prepayment, remote queue joining by default, themes/custom domains, reviews, subscriptions, broad promotions, Telegram-owned truth, or automatic Booking from unverified estimates. |
| **Dependencies** | WS-03/05/06/07/09/10/12/13/22/23. Public infrastructure WS-24. |
| **Feature IDs** | `KLSF-LND-001..020`; relevant `KLMF-COM-005..008`, `025`, `027`, `029`, `036`; `KLMF-OPS-013`; customer/file/notification IDs. |
| **Schema objects** | `pre_intake_drafts`, `pre_intake_items`, `pre_intake_evidence`, `queue_tickets`, `queue_events`, `physical_checkins`, `intake_verifications`, `intake_differences`, `intake_confirmations`, `conversion_records`, `channel_sessions`, `channel_attribution`. |
| **APIs / events / jobs** | Commerce Store API session/draft/check-in/status/confirm; Edge queue projection/verification/conversion; Telegram webhook adapter; events: pre-intake/queue/verification/confirmation/conversion lifecycle; jobs: expiry, notifications, projection/reconciliation. |
| **UI routes** | Public `/:store/:location`, `/pre-intake`, `/check-in`, `/queue/:token`, `/confirm/:token`; Telegram commands/Mini App; Partner publication/readiness; T1 `/queue`. |
| **Permissions** | Customer session tokens limited to own draft/ticket; T1 verifies/converts; Partner configures publication; Admin manages rollout/provider health; raw IDs and other queue customers never exposed. |
| **Offline behavior** | Existing projected queue records can be processed on Hub. If no record reached Hub, T1 uses staff-assisted local intake. Telegram/Web never becomes a local dependency. |
| **Tests** | Signed QR; rate/abuse; duplicate submit; physical presence; queue concurrency/privacy; assignment conflict; difference preservation; confirmation version; exactly-once conversion; WAN/provider outage; files; load/accessibility/localization. |
| **Evidence** | Public/staging deployment; Web/Telegram E2E; queue concurrency report; T1/T2 conversion evidence; offline fallback; security/abuse test; pilot customer observations. |
| **Documentation updates** | Storefront spec/contracts, route/UI inventory, Telegram runbook, queue/state rules, consent/privacy, support/incident, analytics, go-live. |
| **Exit gate** | G4: a customer submits preliminary data, physically checks in, T1 verifies it, the customer confirms the exact version, and one Booking is created—or safe fallback occurs. |

### WS-21 — B2B website

| Field | Workstream contract |
|---|---|
| **Objective** | Launch the public KitLuy for Business front door for evidence-backed product discovery, Laundry positioning, lead capture, registration, authentication, and correct portal routing. |
| **In scope** | Home; product/solution pages; Laundry page; hardware/offline/security/pricing-with-unknowns; FAQ/resources; demo/contact/consultation/chain leads; phone-first signup/login/recovery/invite; business structure/vertical intent; context resolver; Khmer/English; SEO; analytics; version-controlled content; monitoring/rollback. |
| **Explicitly out of scope** | Operational Portal functionality, invented prices/testimonials/implementation claims, public Admin routes, visual CMS unless separately decided, or self-service Chain activation without approved process. |
| **Dependencies** | WS-00 claim authority; WS-02 auth; WS-03 registration intent; WS-24 hosting/monitoring. Can build in parallel after contracts. |
| **Feature IDs** | `KB2B-MKT-001..013`, `CLAIM-001..002`, `LEAD-001..005`, `AUTH-001..005`, `REG-001..004`, `ROUTE-001..003`, `I18N-*`, `SEO-*`, `A11Y-001`, `ANL-001`, `OPS-001..002`, `CMS-001`. |
| **Schema objects** | `marketing_leads`, `lead_events`, `registration_intents`, `business_structure_intents`, `vertical_interests`, `content_entries`, `content_versions`, `capability_claims`, `proof_assets`, `analytics_consents`, attribution records. |
| **APIs / events / jobs** | Public content, lead capture, registration intent, auth/context resolver; events: `lead.created`, `registration.started`, `vertical_interest.recorded`; jobs: lead routing, notifications, sitemap/content build. |
| **UI routes** | `/`, `/products`, `/products/:slug`, `/solutions/laundry`, `/solutions/single-store`, `/solutions/chain`, `/hardware`, `/offline`, `/security`, `/pricing`, `/resources`, `/request-demo`, `/contact`, `/register`, `/login`, `/select-context`. |
| **Permissions** | Public content; authenticated account routes; content publisher/reviewer; claims/proof require approval; HET Admin remains separate. |
| **Offline behavior** | Static/CDN public content may cache; account operations require cloud. Cached pages must not misstate live operational availability. |
| **Tests** | Content/claim audit; links/navigation; forms/spam/rate limits; signup/routing; Khmer/English; SEO/canonical/hreflang/sitemap; WCAG; performance; security headers; analytics consent; rollback. |
| **Evidence** | Production-like preview, content approval, SEO/a11y/performance reports, lead/auth E2E, monitoring/rollback test, legal/privacy review. |
| **Documentation updates** | Content style guide, claim/availability register, route inventory, analytics catalog, SEO/a11y standards, content release and incident SOP. |
| **Exit gate** | G4: a Cambodian prospect understands Phase 1 accurately, can request help or register, and reaches the correct authorized portal without false claims. |

### WS-22 — Files, notifications and integrations

| Field | Workstream contract |
|---|---|
| **Objective** | Deliver shared File Service, Notification Service, Integration Hub foundation, connector runtime boundary, and supporting AI/MCP/RAG controls required by Phase 1 without exposing authority or direct database access. |
| **In scope** | Spaces bytes + Supabase metadata/permissions; signed upload/download; checksums; retention; thumbnails; Hub cache; notification templates/consent/suppression/provider abstraction/delivery truth/retry; transactional email/SMS/Telegram/push; disabled-by-default connector registry/credentials/health/mapping/retry/audit; AI Gateway permission/logging foundation. |
| **Explicitly out of scope** | Public extension marketplace, connector DB access, ungoverned promotional messaging, public object URLs, AI autonomous sensitive actions, or storing heavy files primarily in Supabase Storage. |
| **Dependencies** | WS-04 permissions; WS-06 consent; WS-09/10 local file/sync; WS-24 Spaces/workers/secrets. |
| **Feature IDs** | `KLMF-FILE-003`; `KLMF-NOT-002`; `KLMF-EDGE-004..007`; `KLMF-SEC-001`; `KLMF-AI-001`; `KL-POSD4-025`; `KL-HUB-P1-020`; `KLSF-LND-007`, `017`. |
| **Schema objects** | `files`, `file_versions`, `file_links`, `file_access_grants`, `file_checksums`, `file_retention`, `notification_templates`, `notification_messages`, `delivery_attempts`, `suppressions`, `provider_configs`, `connectors`, `connector_credentials_refs`, `connector_mappings`, `connector_runs`, `ai_requests`, `ai_source_refs`. |
| **APIs / events / jobs** | File upload/sign/access; notification send/status/preferences; connector lifecycle/health foundation; AI Gateway read-only explanations. Events/jobs for media processing, notification delivery, connector retries, RAG indexing where enabled. |
| **UI routes** | Partner files/notifications/integrations status; Admin provider/connector/AI health; Storefront uploads; Partner App evidence and notification center. |
| **Permissions** | File class/object permissions; notification purpose/recipient; connector/admin scopes; provider secrets never exposed; AI permission mirrors source access; sensitive AI actions require human confirmation and are Phase 1 disabled unless approved. |
| **Offline behavior** | Hub caches required operational files and queues uploads/notifications. Local workflow does not wait for remote notification success. Delivery state and file sync state remain truthful. |
| **Tests** | Cross-Tenant file access; signed URL expiry; corrupted/duplicate file; offline cache/upload; notification consent/suppression/retry/dedupe; provider outage; connector isolation; secret leakage; AI source authorization. |
| **Evidence** | Spaces integration, metadata/RLS tests, Hub cache run, provider sandbox delivery, retry/DLQ evidence, connector disabled-state proof, AI evaluation/logs. |
| **Documentation updates** | File/Notification/Integration/Connector/AI service specs, retention and consent, template/event registries, provider runbooks, API/security/monitoring. |
| **Exit gate** | G3: files and messages support pilot workflows with correct access and delivery truth, connectors remain governed/isolated, and no external service owns KitLuy truth. |

### WS-23 — Reporting and exports

| Field | Workstream contract |
|---|---|
| **Objective** | Build authoritative, freshness-labeled operational and management reporting across Bookings, payments, Laundry performance, customers, staff, consumables, technology, queues, channels, and Chains, with included exports. |
| **In scope** | Metric dictionary; read models/materialized views; source/as-of/completeness/reconciliation envelope; Store reports; Chain comparison; Partner App summaries; report filters; exports; scheduling where approved; retention; channel/queue conversion metrics; no commercial paywall. |
| **Explicitly out of scope** | Statutory financial statements, unlabeled cached estimates, metrics invented client-side, destructive warehouse sync, or paywalling reports/exports/history. |
| **Dependencies** | WS-07/08/09/10/16/18/20/22; infrastructure/data jobs WS-24. |
| **Feature IDs** | `KLMF-REP-003`, `005..008`, `010..013`; `KLMF-LND-001`; Partner/Chain/Partner App report feature families; Storefront `KLSF-LND-019`. |
| **Schema objects** | Operational read models, `metric_definitions`, `report_definitions`, `report_runs`, `report_exports`, `data_freshness`, `data_completeness`, `reconciliation_status`, aggregate tables/materialized views, export files linked through File Service. |
| **APIs / events / jobs** | Reporting/query/export endpoints; events from domains; jobs: aggregate refresh, report generation, export, reconciliation/completeness evaluation, retention. |
| **UI routes** | Partner `/reports/*`, Chain `/reports` and `/compare`, Partner App summary screens, Admin platform reports/status, Storefront analytics internal views. |
| **Permissions** | Report and field-level finance/customer permissions; Store/Location/Chain scopes; exports audited and protected; no commercial entitlement may remove core reporting. |
| **Offline behavior** | Portals/apps may display last-known reports with source/as-of/completeness. Hub may retain local operational summaries; cloud reports must not pretend to be live during sync gaps. |
| **Tests** | Metric reconciliation to ledgers; timezone/business date; KHR/USD; filters/scopes; stale/partial states; export integrity/permissions; large datasets; retry/idempotency; report-paywall guardrail. |
| **Evidence** | Metric dictionary approval; SQL/contract tests; reconciliation samples; export files; performance results; freshness UI; Chain/Partner acceptance. |
| **Documentation updates** | Reporting/export service spec, metric dictionary, finance/report definitions, route inventory, retention/privacy, QA and support. |
| **Exit gate** | G3: every pilot metric traces to authoritative records, reports reconcile within approved tolerance, and exports are securely available without commercial paywall. |

### WS-24 — Infrastructure, monitoring and recovery

| Field | Workstream contract |
|---|---|
| **Objective** | Provision and operate the secure, observable, cost-efficient cloud/edge platform, backups, releases, incidents, and recovery needed for Phase 1 and future scaling without operating Kubernetes prematurely. |
| **In scope** | Environment isolation; Supabase projects; DigitalOcean App Platform/services/workers/Spaces/registry; DNS/TLS; network/security; IaC; secrets; queues; logs/metrics/traces; dashboards/alerts; status/incident; backups/PITR; restore drills; Store Hub recovery; signed releases; cost/capacity; Kubernetes-ready standards and migration triggers. |
| **Explicitly out of scope** | DOKS by default, multi-region claims without evidence, separate infra PWA, startup production migrations, secrets in repo, or cloud dependencies that stop local Stores. |
| **Dependencies** | WS-01 continuous; contracts from all service workstreams; Admin workspace WS-19; device/release WS-11. |
| **Feature IDs** | `KL-INF-P1-001..038` with growth/deferred items staying gated; `KLMF-RES-002`; `KLMF-OPS-006`, `011`, `012`; Hub recovery IDs. |
| **Schema objects** | Infrastructure metadata and operational records only: deployment/release records, health samples, incidents, backup/restore evidence, cost/capacity metrics, secret references. Authoritative business DB remains Supabase. |
| **APIs / events / jobs** | Service health/readiness; Admin infrastructure/status; deployment hooks; monitoring ingestion; incident/backup/release jobs; no connector DB exposure. |
| **UI routes** | Admin Infrastructure workspace and command center; internal status/health endpoints; no separate customer-facing infra app. |
| **Permissions** | Cloud IAM by team/environment; least privilege; production deploy/secret/restore/release approval separation; audited break-glass; device PKI controls. |
| **Offline behavior** | Cloud outage does not stop provisioned Store operation. Recovery priorities protect sync ingestion and configuration after return. Hub backup/replacement procedures are mandatory. |
| **Tests** | IaC plan/apply in non-prod; autoscaling/load; connection budgets; queue failure; Spaces; TLS; secret scan/rotation; alerts; PITR/logical restore; Hub replacement; release rollback; incident game day; cost guardrails. |
| **Evidence** | IaC state/plan, environment inventory, dashboards/alerts, backup and restore reports, incident drill, signed release chain, cost/capacity baseline, security scan. |
| **Documentation updates** | Environment/IaC/topology/DNS/TLS/secrets/CI-CD/release/database/observability/backup/incident/rollback/pilot runbooks. |
| **Exit gate** | G4: staging and pilot infrastructure is reproducible, monitored, restorable, supportable, cost-governed, and proven not to compromise Store offline continuity. |

### WS-25 — Security and performance verification

| Field | Workstream contract |
|---|---|
| **Objective** | Independently verify tenant/device isolation, authorization, data protection, payment/webhook safety, supply chain, offline integrity, recovery, usability, and performance before pilot. |
| **In scope** | Threat-model execution; SAST/SCA/secret/container/IaC scans; penetration testing; RLS/IDOR; auth/session; approval bypass; PKI/device cloning; LAN/API abuse; file/privacy; provider webhooks; sync/replay; finance/custody invariants; load/soak; client performance; accessibility; recovery/security game days. |
| **Explicitly out of scope** | Self-attestation by implementation agents alone, production exploitation, accepting known critical findings, or security-by-frontend. |
| **Dependencies** | All G2 workstreams; begins threat modeling at WS-00 and repeats continuously. |
| **Feature IDs** | `KLMF-SEC-001..011` applicable set; `KL-INF-P1-025`, `027..031`; product QA matrices and performance/security acceptance sections. |
| **Schema objects** | Security findings/evidence register, test tenants/devices, audit and monitoring evidence. No product schema except approved fixes. |
| **APIs / events / jobs** | Exercise all four governed API surfaces, LAN API, provider webhooks, file access, admin actions, and health endpoints; verify rates/errors/idempotency. |
| **UI routes** | All high-risk and public routes; authorization and accessibility matrices. |
| **Permissions** | Independent tester roles; scoped test environments; no production secrets; remediation approvals and risk acceptance require authorized humans. |
| **Offline behavior** | Verify complete WAN-loss operation, local attacker boundaries, revoked user/device behavior, queue integrity, data at rest, recovery, and reconnect storm performance. |
| **Tests** | Cross-Tenant/Store/Location/device access; privilege escalation; replay/dedupe; certificate cloning; webhook forgery; file leakage; OWASP; load/soak; sync storm; power loss; restore; A/B rollback; WCAG; Khmer layout. |
| **Evidence** | Signed test reports, reproducible scripts, finding tracker, remediation commits, retest results, load dashboards, restore evidence, formal risk acceptance for non-blocking findings. |
| **Documentation updates** | Threat model, security test plan/report, performance plan/report, residual risk register, incident playbooks, QA matrices, phase evidence index. |
| **Exit gate** | G4 security/performance gate: zero unresolved critical/high findings unless owner-approved exception with mitigation; SLO and recovery targets supported by evidence. |

### WS-26 — Pilot and go-live

| Field | Workstream contract |
|---|---|
| **Objective** | Execute a controlled Laundry pilot, prove complete online/offline operations and support, promote through release channels, and close Phase 1 only with evidence and the Rebuild Test. |
| **In scope** | Pilot Store selection; data/config/hardware readiness; staff/customer training; signed Pilot release; provisioning; first Booking; T1–T4 full cycle; Storefront optional pilot flow; payment/reconciliation; WAN/power/failure drills; monitoring/support; incident/rollback; business-day close; feedback; defect triage; Stable promotion decision; handover and Rebuild Test. |
| **Explicitly out of scope** | Unapproved broad rollout, hiding pilot defects, treating pilot plan as proof, changing scope during go-live, or Stable promotion without independent sign-off. |
| **Dependencies** | All required WS-00..25 at G4; optional surfaces explicitly flagged if not in pilot. |
| **Feature IDs** | `KLMF-OPS-010`, `011`, `012`; `KLMF-RES-010`, `026`; all Phase 1 P0 Feature IDs and approved P1 pilot set; G5 evidence requirements. |
| **Schema objects** | Pilot configuration and test data; go-live/evidence/incident records; no new domain schema except approved fixes through normal migration gates. |
| **APIs / events / jobs** | End-to-end use of Management, Edge Operations, Commerce Store (narrow Pre-Intake), and Connector/status foundations; validate events/jobs/webhooks/replay. |
| **UI routes** | Every pilot product route and T1–T4 mode; Admin command center; support and status routes. |
| **Permissions** | Production-like least privilege, named staff, HET support consent, approval and break-glass procedures; access review before and after pilot. |
| **Offline behavior** | Mandatory planned WAN outage and recovery; optional power/device failure drills; Store must continue local operations and reconcile later. |
| **Tests** | Go-live smoke; first Booking; payment/receipt/tag; T3/T4 custody; full business day; Storefront conversion if enabled; queue/provider failure; backup/restore; Hub/terminal replacement; incident/rollback; reports reconciliation. |
| **Evidence** | Signed pilot checklist; release hashes; hardware inventory; training attendance; test and transaction IDs; monitoring/incident logs; reconciliation; customer/operator feedback; defect closure; production change record; Rebuild Test sign-off. |
| **Documentation updates** | Pilot runbook, go-live checklist, support/SLA, training, rollback/emergency change, known issues, current-state/evidence registers, updated Rebuild and Business Bibles. |
| **Exit gate** | Program G5: owner approves pilot evidence, one qualified engineer reconstructs and operates the vertical, all mandatory artifacts are current, and Stable promotion has an explicit human decision. |

---

## 9. Program-level integration scenarios

The following scenarios are mandatory G3/G4 evidence. Each scenario must have a test ID, environment, build hashes, data IDs, expected invariants, logs, screenshots where useful, and an independent review record.

| Scenario | Required workstreams | Pass condition |
|---|---|---|
| **INT-001 — Digital Store to active Location** | 02, 03, 04, 05, 10, 11, 19 | Authorized Partner creates Laundry Digital Store, configures it, HET verifies, Location provisions, active snapshot reaches Hub, and all steps are audited. |
| **INT-002 — First local Booking** | 05–12 | T1 creates customer and Booking, receives deposit/payment, prints receipt/tags, and local records survive restart. |
| **INT-003 — Full T1–T4 custody** | 07, 09, 12–15 | Booking moves through intake, production, T3 Ready/storage, and T4 pickup exactly once with complete custody. |
| **INT-004 — Full WAN outage** | 07–15, 24 | Store operates T1–T4 and cash locally, exposes truthful cloud state, queues events, and reconciles after WAN returns. |
| **INT-005 — KHQR verified payment** | 08, 12, 13, 24 | QR is shown, provider event is verified/deduplicated, payment state updates once, receipt and ledger reconcile. |
| **INT-006 — Payment/provider outage** | 08, 12, 13, 19, 24 | No false success; approved fallback is available; incident/status/support evidence is created. |
| **INT-007 — QR/Telegram Pre-Intake** | 06, 07, 12, 13, 20, 22 | Customer draft and queue flow ends in exact-version confirmation and one Booking or safe local fallback. |
| **INT-008 — Configuration publish/rollback** | 05, 09, 10, 16, 18, 19 | Previewed configuration deploys to selected Location, incompatible activation fails safely, rollback restores prior version. |
| **INT-009 — Device compromise/replacement** | 04, 09–11, 19, 24 | Device is revoked, cannot reconnect, replacement provisions, Store data restores/reprojects, audit remains complete. |
| **INT-010 — Refund/void approval** | 04, 08, 16, 19 | Sensitive compensating action follows re-auth/reason/approval, creates immutable records, and reconciles. |
| **INT-011 — Reporting truth** | 07, 08, 10, 23 | Partner/Chain/App reports reconcile to ledgers and show correct source/as-of/completeness during sync delay. |
| **INT-012 — Backup and disaster recovery** | 09, 10, 24, 25 | Cloud restore and Hub replacement meet approved RPO/RTO and produce no duplicate business effects. |
| **INT-013 — Tenant and scope isolation** | 02–25 | Automated negative tests prove no cross-Tenant/Store/Location/user/device data access or mutation. |
| **INT-014 — Release rollback** | 01, 09, 11, 19, 24 | Signed Pilot artifact installs through Hub, health check fails by injection, A/B rollback restores working version. |
| **INT-015 — First business-day close** | 08, 12, 16, 23, 26 | Cash, KHQR, deposits, refunds/voids, Booking balances, reports, and exceptions reconcile for the pilot day. |

---

## 10. Required evidence package per workstream

Each workstream directory or evidence index must link to:

1. Approved G0/G1 authority and contract package.
2. Repository commit(s) and changed-path inventory.
3. Applied development migration identifiers and validation output.
4. Unit, component, contract, integration, RLS/security, offline, and recovery results as applicable.
5. Build artifact hashes, SBOM, signature, environment, and deployment record.
6. Monitoring/log/trace evidence for key success and failure paths.
7. Rollback or forward-repair rehearsal.
8. Documentation updates and source traceability.
9. Independent review record.
10. Status-register update with no unsupported status promotion.

Suggested path:

```text
docs/evidence/phase1/<workstream>/<task-or-gate>/
```

---

## 11. Swarm completion and handoff rules

### 11.1 Workstream completion

A workstream is not complete until:

- all mandatory Feature IDs assigned to it are mapped to code/contracts/tests/docs;
- all dependencies have accepted evidence;
- deferred/rejected/unresolved items remain disabled and documented;
- every schema mutation has migration and rollback/repair treatment;
- every API/event/job has compatibility and idempotency tests;
- every permission has positive and negative tests;
- every offline-impacting feature has WAN-loss/reconnect tests;
- monitoring and support ownership exist;
- the workstream exit gate is signed by an independent reviewer.

### 11.2 Handoff content

Every completed task must produce `HANDOFF_TEMPLATE.md` content including:

- what changed and why;
- Feature IDs and authority sources;
- exact paths and migrations;
- contracts added/changed;
- test commands and results;
- evidence links;
- rollout/rollback notes;
- known limitations/open decisions;
- downstream tasks unblocked;
- reviewer identity and decision.

### 11.3 Conflict handling

When code, migration, specification, or owner direction conflicts:

1. Stop only the affected task, not unrelated work.
2. Preserve data and backward compatibility.
3. Create a `CONFLICT_TEMPLATE.md` record with exact evidence.
4. Apply authority order.
5. Obtain owner decision when higher authorities do not resolve the conflict.
6. Update supersession and traceability records before resuming.

---

## 12. Phase 1 final exit checklist

### Authority and documentation

- [ ] Master authorities and source-of-truth pack are approved and current.
- [ ] All owner locks and superseded concepts are reconciled.
- [ ] All `[REQUIRED:]` values that block production are resolved or explicitly waived by owner decision.
- [ ] Rebuild and Business Bibles include the final Phase 1 implementation truth.

### Product and data

- [ ] Partner/Tenant, Digital Store, Location, membership, RBAC/RLS, audit, catalog, customer, Booking, payment, custody, files, notifications, reports, and edge schemas are applied and verified.
- [ ] Every finalized finance, payment, inventory, custody, and audit effect is append-only.
- [ ] No Phase 2+ vertical scope leaked into Phase 1 Core or Laundry modules.

### Edge and devices

- [ ] Certified Hub and terminal hardware profiles are approved.
- [ ] Hub-first provisioning and certificate trust pass.
- [ ] T1–T4 complete the full local workflow during WAN loss.
- [ ] Sync/replay, configuration rollback, release rollback, and replacement-first recovery pass.

### Security and operations

- [ ] Tenant/Store/Location/user/device isolation passes independent testing.
- [ ] Sensitive production actions require re-auth, reason, audit, and approval where policy requires.
- [ ] Monitoring, alerts, incident response, backup, restore, cost/capacity, and support are active.
- [ ] No unresolved critical/high security or data-integrity defects remain without explicit risk acceptance.

### Commercial pilot

- [ ] Pilot Store is approved, trained, provisioned, and supported.
- [ ] First Booking, full T1–T4 lifecycle, payment/reconciliation, business-day close, reports, and recovery drills pass.
- [ ] Storefront Pre-Intake is either proven in pilot or explicitly excluded from the first pilot release with its gate retained.
- [ ] Pilot feedback and defects are recorded and dispositioned.
- [ ] Stable promotion receives an explicit human approval.

### Rebuild Test

- [ ] One qualified engineer who did not build the system reconstructs a clean Phase 1 environment from approved documentation, migrations, contracts, IaC, release artifacts, and runbooks.
- [ ] The engineer provisions a pilot-equivalent Store, completes a Booking through T1–T4, reconciles it, performs a rollback/recovery exercise, and explains all authority boundaries.
- [ ] The owner signs the Phase 1 exit record.

---

## 13. Version history

| Version | Date | Change |
|---|---|---|
| `v1.0.0` | 2026-07-26 | Initial Phase 1 Laundry master execution plan with WS-00 through WS-26, dependency waves, G0–G5 gates, swarm operating contract, integration scenarios, evidence requirements, and final Rebuild Test. |

---

## Final execution statement

This plan is the direct work-order map for the Phase 1 Laundry swarm. It does not permit agents to convert planning into implementation truth, widen the vertical, weaken Store Hub authority, collapse T1–T4 roles, bypass RLS/approvals, or trade auditability and offline continuity for delivery speed. The accepted outcome is a commercially usable Laundry vertical whose code, contracts, migrations, operations, evidence, and documentation can be rebuilt and operated independently.
