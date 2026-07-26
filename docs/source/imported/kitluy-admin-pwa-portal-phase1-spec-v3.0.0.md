
# KitLuy Admin PWA Portal — Phase 1 Laundry Product Specification

| Field | Value |
|---|---|
| **Filename** | `kitluy-admin-pwa-portal-phase1-spec-v3.0.0.md` |
| **Version** | v3.0.0 |
| **Date** | 2026-07-25 |
| **Product** | `kitluy-admin-pwa-portal` / `kitluy-admin-portal` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite platform owner |
| **Status** | Approved target specification; not implementation evidence |
| **Operational classification** | HET-internal privileged control plane |
| **Primary stack** | React Web/PWA, Supabase, DigitalOcean, KitLuy shared services |
| **Locales / currency / timezone** | Khmer and English; KHR and USD; `Asia/Phnom_Penh` |
| **Supersedes for Phase 1 product scope** | `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md` where this v3 specification is more recent or explicitly reconciles a conflict |

> **Mission:** Build the HET control plane that can create, verify, provision, operate, support, monitor, update and recover a Laundry Digital Store and its physical edge environment without weakening Store Hub autonomy, source-of-truth rules, tenant isolation or human approval controls.

> **Implementation truth:** Nothing in this document is `IMPLEMENTED` merely because it is specified. Implementation requires repository code, applied migrations, executable tests, deployment evidence and approved pilot/go-live evidence.

---

## 0. Authority, Evidence and Version Contract

### 0.1 Authority order

1. Current project-owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified repository code/tests and production evidence for the relevant environment.
3. This Phase 1 v3.0.0 specification for Admin Portal target behavior.
4. Current KitLuy Rebuild and Business Bibles.
5. Approved product handoffs and master registry.
6. Evidence-based competitor comparisons/classifications.
7. Competitor clone/rebuild documents as design references only.
8. Superseded planning.

A competitor feature, schema, route, price, algorithm or commercial model is never promoted into KitLuy truth without the appropriate KitLuy authority and gate.

### 0.2 Evidence labels

| Label | Meaning |
|---|---|
| `OWNER-LOCKED` | Explicit owner decision; binding until superseded by another versioned owner decision. |
| `APPROVED TARGET` | Approved product direction; still requires build and verification evidence. |
| `PLANNING CANDIDATE` | Useful proposal requiring contract review and normal gates. |
| `DEFERRED` | Explicitly disabled until its re-entry gate is satisfied. |
| `REJECTED` | Prohibited pattern; architecture and QA must prevent accidental implementation. |
| `IMPLEMENTED` | Allowed only with repository, applied migration, tests, deployment and environment evidence. |

### 0.3 Why v3.0.0

v3 is a major boundary because it replaces pre-lock physical-Store assumptions with the Digital Store/Store Location model, adopts Hub-first smartphone-simple provisioning, formalizes T1-T4 Laundry role governance, adds Digital Store System Status, introduces signed staged releases with A/B rollback, and turns go-live/migration/support into evidence-backed controlled workflows.

### 0.4 Source baseline
| Source | Authority/use | Contribution to this specification |
|---|---|---|
| `Current KitLuy Project Instructions` | Owner authority | Eight-phase roadmap, Digital Store model, one Store/one primary vertical, shared Core, offline, audit, API, localization and completion rules. |
| `kitluy-admin-pwa-portal-rebuild-bible-v2.0.0.md` | Approved target baseline | Existing HET control plane, CRM, onboarding, billing, fleet, support, platform operations, audit, Laundry templates, AI Admin and Integration Hub. |
| `kitluy-suite-rebuild-bible-v3.0.0.md` | Approved target baseline | Suite topology, Store Hub, shared services, security, monitoring, recovery and Rebuild Test requirements; superseded where later owner locks conflict. |
| `kitluy-suite-ecosystem-business-bible-v1.0.0.md` | Approved business baseline | Business positioning, operating model, support, SaaS governance and continuity. |
| `KitLuy Suite Project.txt` | Owner vision and lock | Digital Store-first control plane, Store Location separation, four governed APIs, events, jobs, compatibility deployment and channel authority. |
| `kitluy-concept-design-1.txt` | Owner lock | Laundry T1 Intake/Cashier, T2 Customer Display, T3 Ready Scan-In and T4 Pickup Scan-Out. |
| `Device Management & Provisioning System.txt` | Owner lock | Smartphone-simple provisioning: Digital Store, active Hub, assigned terminals, device certificates and LAN discovery. |
| `Project Instruction Writing.txt` | Current architecture note | React PWA, Electron ARM64, Raspberry Pi reference hardware, Supabase/DigitalOcean split, local authority, signed releases and A/B rollback. |
| `kitluy-owner-decision-lock-12-capabilities-v1.0.md` | Owner lock | Payment, finance, reporting, API and marketplace policy decisions that constrain Admin controls. |
| `kitluy-master-feature-registry-v0.2.md/.csv/.json` | Owner-reviewed normalization baseline | 441 canonical capabilities, including 22 assigned to kitluy-admin-portal; no planning row is implementation evidence. |
| `WooCommerce comparison, classification and implementation backlog package` | Evidence and planning input | 20 Admin-owned rows covering Digital Store provisioning, certificates, release governance, System Status, connector/provider health, subscriptions and guardrails. |
| `Toast comparison, classification and implementation backlog package` | Evidence and planning input | Admin control plane, device pairing, staged updates, readiness, SaaS responsibility and hardware/payment guardrails. |
| `Shopify comparison, classification and implementation backlog package` | Evidence and planning input | Managed SaaS upgrades, migration governance, physical Store go-live evidence and later storefront/app marketplace controls. |
| `Lightspeed comparison, classification and implementation backlog package` | Evidence and planning input | Migration validation, go-live checklist, status visibility, support consent and connector certification. |
| `Loyverse comparison and product classification package` | Evidence and planning input | Simpler fleet recovery, lost-device revocation, staged release UX, certified hardware and pricing/export guardrails. |
| `Partner, Chain and Partner App bibles` | Boundary references | Prevent Admin from absorbing Partner, Chain or mobile operational ownership. |


### 0.5 Phase 1 completion standard

The Admin Portal Phase 1 scope is complete only when approved scope, schema, APIs/events, permissions, UI, Store Hub/offline boundaries, device profiles, finance controls, reports, migrations, seeds, QA, security, monitoring, recovery, pilot, go-live checklist and updated Rebuild/Business documentation exist and pass the Rebuild Test.

---

## 1. Product Charter and Boundaries

### 1.1 What the product is

The KitLuy Admin PWA Portal is the HET-only control plane for platform-wide Partner verification, Digital Store and Store Location provisioning, SaaS subscriptions and entitlements, fleet/device governance, release management, System Status, support, incidents, integrations, audit, Laundry defaults and AI administration.

It governs the platform. It does not become the operational source of truth for Store transactions. The Store Hub remains the local operational authority after provisioning, T1-T4 communicate with the Hub over LAN, and cloud synchronization is asynchronous.

### 1.2 Digital-first authority model

```text
Partner Account / Tenant
        |
        v
Digital Store (control plane, exactly one primary vertical)
        |-----------------------------|
        v                             v
Digital sales channels          Store Location(s)
                                      |
                                      v
                                Active Store Hub
                                      |
                   +------------------+------------------+
                   v                  v                  v
             T1 Intake/Cashier   T2 Customer Display   T3/T4 roles
                   |                                     |
                   +----------- local operation ---------+
                                      |
                                      v
                          asynchronous cloud synchronization
```

Configuration flows down. Transactions, events, heartbeats and reconciliation results flow back. External channels never own customer, inventory, payment or finance truth.

### 1.3 What the product is not

- Not a Partner back office.
- Not a Chain operating portal.
- Not a POS or Laundry production client.
- Not the Store Hub.
- Not a statutory ERP/general ledger.
- Not a payment facilitator or merchant of record.
- Not a public app/theme marketplace in Phase 1.
- Not a direct production-database console.
- Not an offline admin mutation client.
- Not a place to copy competitor pricing, processor spread, proprietary hardware dependence or reporting paywalls.

### 1.4 Phase 1 business outcomes

1. HET can onboard and verify a Laundry Partner without manual database intervention.
2. HET can create a Laundry Digital Store, then create and activate its physical Location.
3. A Store Hub can be provisioned before assigned terminals through a smartphone-simple flow.
4. T1-T4 role assignments, certificates, peripherals and offline validation are visible and auditable.
5. HET can see truthful System Status across cloud, Digital Store, Location, Hub, terminals, providers and connectors.
6. HET can deliver signed releases through Internal, Pilot and Stable channels with A/B rollback.
7. Support can diagnose with explicit consent and complete intervention audit.
8. SaaS subscriptions and entitlements can be operated without paywalling reports, exports or history.
9. A physical Laundry Store cannot go live without evidence-backed readiness and reconciliation.
10. One qualified engineer can rebuild and operate the product from approved documentation and migrations.

### 1.5 Phase 1 non-goals and deferred depth

| Item | Treatment |
|---|---|
| Public app/theme marketplace and revenue share | Deferred until post-Phase 3 stability and owner-approved economics. |
| Full storefront status/rollback | Schema and status hooks may be prepared; customer Storefront delivery belongs to Phase 3. |
| Customer/order migration for eCommerce platforms | Phase 3; Phase 1 includes generic migration safety foundation only. |
| Restaurant readiness and KDS health | Phase 2 extension; Phase 1 design must not hardcode Laundry into Core status contracts. |
| Merchant-managed hosting | Rejected as the normal model. |
| Proprietary hardware dependence | Rejected; use certified reference profiles. |
| Offline card capture | Rejected for current roadmap. |
| Statutory accounting ERP | Out of scope; KitLuy owns operational subledger/reconciliation and exports/connectors. |

---

## 2. Users, Roles and Permissions

### 2.1 Role definitions
| Role | Scope | Responsibility |
|---|---|---|
| `platform_owner` | Platform | Full HET control; safety switches, production approvals, billing policy, RBAC, release Stable promotion and high-risk actions. |
| `admin_operator` | Platform | CRM, Partner verification, onboarding, Digital Store/Location setup, template application and standard device registration. |
| `support_lead` | Platform | Tickets, consent-based access, diagnostics, evidence, standard remote actions and incident participation. |
| `finance_admin` | Platform | SaaS plans within approved policy, invoices, payment attempts, dunning, manual settlement and billing reports. |
| `ops_readonly` | Platform | Read-only overview, System Status, fleet, incidents, subscriptions and audit summaries; no exports unless separately granted. |
| `ai_service` | Service | Internal AI Gateway/MCP service identity; no interactive human login. |
| `system_service` | Service | Edge Functions/workers/release services; no interactive human login. |


### 2.2 Sensitive-action policy

The following require re-authentication, reason, evidence, immutable audit and authorized human confirmation. Production migrations, Stable release promotion, high-risk device actions, safety switches, destructive account actions and support access to sensitive data also require four-eyes approval.

- Suspend/reactivate Partner or Digital Store.
- Approve physical Store go-live.
- Revoke/replace Hub or terminal identity.
- Queue wipe/reset/rollback or equivalent high-risk remote action.
- Promote release to Stable or abort a broad rollout.
- Change compatibility or entitlement policy with production impact.
- Toggle safety switches.
- Mark SaaS invoice paid manually or alter dunning/grace state.
- Activate/suspend payment or sensitive connector.
- Start consent-based support impersonation.
- Apply or rollback production migration.

### 2.3 Product-boundary permission rule

Admin permissions never grant ordinary Store operational permissions. HET users may observe and support under policy, but must not create Laundry Bookings, accept customer payments, change finalized transactions, release garments or impersonate Store staff outside an approved support session.

---

## 3. Information Architecture and Route Inventory

### 3.1 Modules
| Module | Route root | Phase 1 responsibility |
|---|---|---|
| Overview | `/overview` | Command board, alerts, onboarding blockers, billing risk, incidents, release health and sync freshness. |
| CRM | `/crm` | Leads, pipeline, activities, site surveys and conversion. |
| Partners | `/partners` | Tenant/Partner identity, verification, documents, users, lifecycle and timeline. |
| Digital Stores | `/digital-stores` | Digital Store identity, vertical lock, readiness, channels, entitlements and system status. |
| Store Locations | `/locations` | Physical Locations, address, Hub assignment, operating state, go-live and decommissioning. |
| Onboarding | `/onboarding` | Guided workspaces, tasks, evidence, template application, training, test Booking and approval. |
| Subscriptions & Entitlements | `/billing` | Plans, entitlements, subscriptions, invoices, attempts, grace and dunning. |
| Device Registry | `/devices` | Hubs, T1-T4 terminals, peripherals, certificates, assignments, hardware profiles, spares and RMA. |
| Fleet & Provisioning | `/fleet` | Provisioning sessions, heartbeats, sync freshness, diagnostics, actions, revocation and recovery. |
| Release Management | `/releases` | Artifacts, signatures, channels, compatibility, cohorts, rollout, installation and rollback. |
| System Status | `/status` | Digital Store, Location, Hub, T1-T4, provider, connector, job, file, AI and cloud health. |
| Support Center | `/support` | Tickets, SLA, consent sessions, interventions, knowledge base and escalation. |
| Platform Ops | `/ops` | Service health, queues, incidents, safety switches, jobs, migrations and backups. |
| Audit & Compliance | `/audit` | Sensitive actions, support access, device actions, billing, releases, integrations, AI and security events. |
| Laundry Templates | `/laundry-templates` | Versioned service, add-on, workflow, receipt, tag, notification and readiness templates. |
| AI Admin | `/ai` | Policies, RAG sources, MCP tools, request logs, evaluations, costs and source-backed summaries. |
| Integration Hub | `/integrations` | Payments, notifications, storage, AI, webhooks, credentials, ERP/export and approved connectors. |
| Settings | `/settings` | Admin team, RBAC, environments, security, alerts, retention, feature flags and policies. |


### 3.2 Required child routes

```text
/overview
/overview/alerts
/overview/readiness
/overview/incidents

/crm/leads
/crm/pipeline
/crm/activities
/crm/site-surveys

/partners
/partners/:partnerId
/partners/:partnerId/verification
/partners/:partnerId/users
/partners/:partnerId/documents
/partners/:partnerId/timeline

/digital-stores
/digital-stores/:digitalStoreId
/digital-stores/:digitalStoreId/readiness
/digital-stores/:digitalStoreId/entitlements
/digital-stores/:digitalStoreId/status
/digital-stores/:digitalStoreId/configuration

/locations
/locations/:locationId
/locations/:locationId/readiness
/locations/:locationId/devices
/locations/:locationId/status
/locations/:locationId/go-live

/onboarding/workspaces
/onboarding/workspaces/:workspaceId
/onboarding/templates
/onboarding/migrations
/onboarding/go-live

/billing/plans
/billing/entitlements
/billing/subscriptions
/billing/invoices
/billing/payment-attempts
/billing/dunning

/devices
/devices/hubs
/devices/terminals
/devices/peripherals
/devices/certificates
/devices/hardware-profiles
/devices/assignments
/devices/rma

/fleet/provisioning
/fleet/heartbeats
/fleet/sync
/fleet/diagnostics
/fleet/actions
/fleet/recovery

/releases/artifacts
/releases/channels
/releases/compatibility
/releases/rollouts
/releases/installations
/releases/rollbacks

/status/components
/status/digital-stores
/status/locations
/status/providers
/status/connectors
/status/jobs
/status/incidents

/support/tickets
/support/consent
/support/interventions
/support/knowledge-base
/support/escalations

/ops/services
/ops/queues
/ops/jobs
/ops/migrations
/ops/backups
/ops/safety-switches
/ops/incidents

/audit/actions
/audit/support
/audit/devices
/audit/releases
/audit/billing
/audit/integrations
/audit/ai
/audit/security
/audit/exports

/laundry-templates/services
/laundry-templates/pricing
/laundry-templates/statuses
/laundry-templates/receipts
/laundry-templates/tags
/laundry-templates/notifications
/laundry-templates/readiness
/laundry-templates/versions

/ai/policies
/ai/rag-sources
/ai/mcp-tools
/ai/requests
/ai/evaluations
/ai/costs

/integrations/connectors
/integrations/payments
/integrations/notifications
/integrations/storage
/integrations/ai
/integrations/webhooks
/integrations/credentials
/integrations/incidents
/integrations/reconciliation

/settings/team
/settings/roles
/settings/environments
/settings/security
/settings/feature-flags
/settings/alerts
/settings/retention
/settings/localization
```

### 3.3 Form-factor rules

| Form factor | Rule |
|---|---|
| Desktop browser/PWA | Primary and complete experience. |
| Tablet browser/PWA | Monitoring, triage and low-risk actions; dense workflows may reduce columns. |
| Phone browser | Emergency read-only/triage only. Sensitive actions require desktop unless a later owner decision approves otherwise. |
| Offline PWA | Static shell and connection/status guidance only. No sensitive cached business data and no offline mutation queue. |

---

## 4. Functional Requirements

The canonical v3 feature IDs below are the Phase 1 product contract. Source IDs remain traceability anchors and do not replace these KitLuy-owned IDs.
| Feature ID | Capability | Requirement | Minimum acceptance | Traceability |
|---|---|---|---|---|
| `KL-AP3-CORE-001` | **HET-only control plane** | Only approved HET users may access the application. Partner, Chain, Store staff and customer identities must be denied even when they have valid KitLuy sessions. | Negative authorization tests prove product-boundary isolation. | KLMF-GOV-007; KAD-WC-009; KLT-ADM-004 |
| `KL-AP3-CORE-002` | **Fail-closed truth** | Missing read models, stale sync, partial provider responses or permission failures render unavailable/partial states, never fabricated zeroes or demo values. | Every dashboard card exposes source, as-of, freshness and completeness. | Project Instructions; KLMF-OPS-006 |
| `KL-AP3-CORE-003` | **Digital Store hierarchy** | Admin must model Tenant/Partner -> Digital Store -> Store Location. The Digital Store is the control plane; a Location is the physical edge environment. | No new workflow treats Store as only a physical branch; migration tests preserve existing identifiers. | KAD-WC-001; KLMF-DEV-008 |
| `KL-AP3-CORE-004` | **One Store, one primary vertical** | Each Digital Store has exactly one primary vertical. Phase 1 value is laundry. A different vertical requires another Store under the same Tenant/Partner. | Database constraint and API tests reject multi-primary-vertical assignment. | Project Instructions; KLMF-GOV-013 |
| `KL-AP3-CORE-005` | **Managed SaaS responsibility** | HET owns supported cloud operations, release management, upgrades, monitoring and recovery. Merchant-managed hosting is not the normal model. | Operational RACI and upgrade ownership are documented and testable. | KLMF-GOV-010; KAD-WC-007; KLS-SH-BL-ADMIN-001 |
| `KL-AP3-CRM-001` | **Lead and opportunity records** | Capture Partner lead, business type, contact, source, site survey, demo, next action, owner and conversion status. | Lead can convert into a Partner verification case without duplicate identity creation. | Admin v2 baseline |
| `KL-AP3-CRM-002` | **Partner verification** | Record business identity, authorized representative, phone, email, documents, verification result, reviewer and evidence. | Approval/rejection requires reason and immutable audit. | KAD-WC-005 |
| `KL-AP3-ONB-001` | **Guided Partner creation** | Create Tenant/Partner identity and first Digital Store through one guided workspace. | Workspace can resume safely and is idempotent. | Admin v2 baseline; KAD-WC-005 |
| `KL-AP3-ONB-002` | **Laundry vertical selection** | Lock the first Digital Store to Laundry before applying catalog, pricing, workflow and hardware defaults. | Vertical is immutable after first operational transaction except through owner-approved migration. | Project Instructions |
| `KL-AP3-ONB-003` | **Digital Store readiness** | Track identity, service catalog, pricing, staff, payment configuration, receipt/tag templates, policies and channel readiness separately from physical Location readiness. | Readiness blockers are explicit and evidence-backed. | Digital Store model; KLMF-OPS-012 |
| `KL-AP3-ONB-004` | **Store Location creation** | Create physical Location only after Digital Store exists; assign address, timezone, currencies, Hub profile and operating state. | Location creation cannot bypass Digital Store or vertical scope. | KAD-WC-001 |
| `KL-AP3-ONB-005` | **Physical Store go-live evidence** | Collect Hub activation, T1-T4 assignment, peripherals, offline test Booking, payment test, sync reconciliation, support contacts and rollback evidence. | Go-live cannot be approved with unresolved material blockers. | KLMF-OPS-010; KLS-SH-BL-ADMIN-003 |
| `KL-AP3-ONB-006` | **Migration validation and rollback** | Support controlled imports with dry-run, field mapping, validation, reconciliation, error export, cutover record and rollback plan. | No import can directly overwrite finalized finance, inventory or audit truth. | KLMF-OPS-004; KLS-BL-ADMIN-001 |
| `KL-AP3-ONB-007` | **Readiness score** | Compute a transparent readiness score from blocking and non-blocking checks; do not hide individual evidence behind one number. | Score is reproducible from check records and versioned policy. | KLMF-OPS-012; Toast readiness pattern |
| `KL-AP3-DEV-001` | **Hub-first provisioning session** | Generate short-lived provisioning code/QR for a specific Tenant, Digital Store and Location. The Hub must activate before terminals. | Replay, expiry, wrong-scope and duplicate-active-identity tests pass. | KLMF-DEV-008; KLT-ADM-006 |
| `KL-AP3-DEV-002` | **Device certificate trust** | Issue and rotate device identity certificates bound to Hub/device UUID, Tenant, Digital Store, Location and role profile. | IP address alone never establishes trust. | KLMF-DEV-005; KAD-WC-002 |
| `KL-AP3-DEV-003` | **Terminal role assignment** | Assign Laundry roles T1 Intake/Cashier, T2 Customer Display, T3 Ready Scan-In and T4 Pickup Scan-Out. T3 and T4 may share hardware but remain separate permissioned modes. | Role changes require authorization and audit; T4 alone completes pickup. | KLMF-DEV-007; T1-T4 owner lock |
| `KL-AP3-DEV-004` | **Certified hardware profiles** | Maintain supported, conditional and unsupported hardware profiles for Hub, POS, printers, scales, scanners, displays and accessories. | Generic protocol compatibility does not imply HET support. | KLMF-DEV-002; KL-LV-108 |
| `KL-AP3-DEV-005` | **Recovery and reprovisioning** | Provide replace, revoke, rotate certificate, restore approved profile, retest peripherals and verify no duplicate active identity. | Lost/stolen replacement closes sessions and creates an asset/security case. | KLMF-DEV-004; KL-LV-026 |
| `KL-AP3-DEV-006` | **Remote diagnostics** | Expose last seen, last sync, software/config version, resource health, peripheral checks and recent failures without direct production DB access. | Support access requires consent and every diagnostic is audited. | KLMF-DEV-006; KLMF-OPS-003 |
| `KL-AP3-DEV-007` | **Device revocation** | Immediately revoke certificate, sessions and queued privileged actions while preserving audit and last-known evidence. | Revoked device cannot reconnect through cloud or Hub trust paths. | KLMF-DEV-006; KL-LV-107 |
| `KL-AP3-FLT-001` | **Fleet inventory** | Search and filter Hubs, terminals and peripherals by Tenant, Digital Store, Location, role, model, version, status and support profile. | Export reflects filters and access scope. | Admin v2 baseline |
| `KL-AP3-FLT-002` | **Heartbeat and sync freshness** | Display online, degraded, stale, offline and never-seen states using source timestamps and policy thresholds. | WAN loss is distinguished from Hub loss and terminal-to-Hub loss. | Admin v2 baseline; KLMF-OPS-006 |
| `KL-AP3-FLT-003` | **Queued remote actions** | Queue approved actions for later Hub receipt; actions are idempotent, expiring, signed, permissioned and auditable. | No action assumes direct LAN reachability from Admin. | Admin v2 baseline |
| `KL-AP3-FLT-004` | **Peripheral validation** | Record printer, scale, scanner, T2 display and optional device self-test results per Location. | Go-live uses latest successful test with timestamp and operator. | KLMF-OPS-012 |
| `KL-AP3-STS-001` | **Digital Store System Status** | Aggregate Digital Store, Location, Hub, T1-T4, files, payments, connectors, jobs, notifications and cloud service state. | Status cards expose component owner, source, freshness, incident and remediation path. | KLMF-OPS-006; KAD-WC-008 |
| `KL-AP3-STS-002` | **Configuration/software compatibility** | Compare desired, downloaded, installed and active configuration/software versions; flag incompatible combinations. | Compatibility policy is versioned and rollback-aware. | KLMF-OPS-001; KAD-WC-011 |
| `KL-AP3-STS-003` | **Connector health** | Show credential status, last test, webhook/job backlog, reconciliation status, incident and provider degradation. | No connector health is inferred solely from configuration presence. | KLMF-OPS-002; KAD-WC-014 |
| `KL-AP3-STS-004` | **Payment/provider health** | Show configured, sandbox/live, credential expiry, callback verification, settlement/reconciliation freshness and outage state. | Raw secrets are never displayed. | KLMF-OPS-008; KAD-WC-016 |
| `KL-AP3-STS-005` | **Public/system status view** | Provide an internal component dashboard and a sanitized status-page feed when approved. | Tenant-specific confidential data never appears in public status output. | KLS-BL-ADMIN-004 |
| `KL-AP3-REL-001` | **Signed release registry** | Register version, channel, artifact, checksum, signature, compatibility range, migration class, release notes and rollback package. | Unsigned or checksum-mismatched releases cannot progress. | KLMF-OPS-011; KAD-WC-004 |
| `KL-AP3-REL-002` | **Staged rollout** | Promote Internal -> Pilot -> Stable with target cohorts, pause, resume, abort and automatic health gates. | No Stable promotion without Pilot evidence and authorized approval. | KLMF-OPS-011; KL-LV-106 |
| `KL-AP3-REL-003` | **Store Hub distribution** | Hub downloads each release once and distributes approved artifacts over LAN to assigned terminals. | WAN loss after download does not prevent local distribution. | Project architecture note |
| `KL-AP3-REL-004` | **A/B installation and rollback** | Track active slot, previous slot, install result, health check and rollback reason for Hub/terminal software. | Failed health check returns to last known good slot without corrupting data. | KLMF-OPS-011 |
| `KL-AP3-CFG-001` | **Versioned configuration publication** | Publish immutable configuration versions from Digital Store to Locations/channels with target scope and compatibility requirements. | Each publication has checksum, actor, effective time and rollback target. | KLMF-OPS-013 |
| `KL-AP3-CFG-002` | **Configuration rollback** | Rollback by publishing a prior compatible version, never by destructive row editing. | Rollback event and downstream acknowledgement are auditable. | KLMF-OPS-013 |
| `KL-AP3-BIL-001` | **Plan and entitlement controls** | Manage approved feature flags, entitlements, limits and rollout rules without copying competitor plans or gates. | Optional depth remains owner-controlled; changes are versioned and audited. | KLMF-GOV-006; KLMF-GOV-005 |
| `KL-AP3-BIL-002` | **SaaS subscriptions** | Manage trial, active, grace, overdue, suspended and cancelled states with idempotent transitions. | Plan changes do not mutate finalized operational data. | KLMF-GOV-008; KAD-WC-010 |
| `KL-AP3-BIL-003` | **Invoices and payment attempts** | Create SaaS invoices, record attempts, external references, manual settlement evidence and dunning events. | Money uses KHR/USD rules and actions require finance permission. | Admin v2 baseline |
| `KL-AP3-BIL-004` | **No reporting/export paywall** | Admin must not configure paywalls that block reporting, analytics, historical retention, exports or data services. | Entitlement tests verify those capabilities remain available subject only to security, privacy, fair-use and abuse controls. | KLD-2026-07-24-001; KLMF-REP-010 |
| `KL-AP3-SUP-001` | **Support tickets and SLA** | Create, classify, assign, escalate, resolve and reopen tickets with evidence, linked incidents/devices and SLA timers. | State changes are audited and notifications are delivery-tracked. | Admin v2 baseline |
| `KL-AP3-SUP-002` | **Consent-based support access** | Obtain Partner consent with scope, purpose, expiry and revocation before impersonation or sensitive diagnostics. | No standing unrestricted impersonation path exists. | KLMF-OPS-003; KLS-BL-ADMIN-005 |
| `KL-AP3-SUP-003` | **Support intervention log** | Record every viewed resource, action, export, command and outcome during support access. | Partner can receive an intervention summary where policy permits. | Admin v2 baseline |
| `KL-AP3-INT-001` | **Connector lifecycle** | Install/register, configure, test, activate, suspend, rotate credentials and remove governed connectors. | Connectors never receive direct production database access. | KAD-WC-015 |
| `KL-AP3-INT-002` | **Webhook and job operations** | Inspect delivery attempts, signatures, retries, dead letters, replay eligibility and correlated domain events. | Replay is idempotent and permission-gated. | Four API/event rules |
| `KL-AP3-INT-003` | **Connector certification scaffold** | Record review, scopes, test results, compatibility, incident owner and revocation policy; Phase 1 supports first-party/basic connectors only. | Open public marketplace remains disabled. | KLS-BL-ADMIN-003; owner decision KLMF-INT-002 |
| `KL-AP3-OPS-001` | **Platform health** | Monitor PWA, Supabase, Edge Functions, DigitalOcean services, files, AI, notifications, queues and scheduled jobs. | Each service has ownership, SLO placeholder and runbook link. | Admin v2 baseline |
| `KL-AP3-OPS-002` | **Incident management** | Declare severity, impact, affected components, timeline, mitigations, communication and closure review. | Sensitive operational actions require authorized human confirmation. | Admin v2 baseline |
| `KL-AP3-OPS-003` | **Safety switches** | Provide narrowly scoped, reversible safety controls for connectors, releases, background jobs and risky features. | Switches cannot bypass finance, inventory, permissions or audit rules. | Admin v2 baseline |
| `KL-AP3-AUD-001` | **Immutable audit** | Log actor, role, session, device, Tenant/Digital Store/Location scope, action, target, reason, before/after references and correlation ID. | Finalized audit records are append-only. | Project Instructions |
| `KL-AP3-AUD-002` | **Four-eyes approvals** | Require requester and approver separation for production migrations, high-risk remote actions, safety switches, release Stable promotion and destructive account actions. | Self-approval is denied and tested. | Admin v2 baseline |
| `KL-AP3-LND-001` | **Laundry default templates** | Version default services, per-piece/per-weight settings, add-ons, workflow statuses, receipts, tags and notifications. | Applying a template creates Store-owned copies; later template changes do not silently overwrite Store configuration. | Phase 1 Laundry scope |
| `KL-AP3-LND-002` | **T1-T4 validation profile** | Readiness checks verify T1 intake/payment/printing, T2 display/KHQR/privacy, T3 ready scan-in/storage and T4 pickup/balance/scan-out. | Tests prove separate permissions and append-only custody events. | T1-T4 owner lock |
| `KL-AP3-AI-001` | **Permission-scoped AI Admin** | Use AI for support summaries, health explanations, incident summarization and knowledge retrieval only through approved Gateway/RAG/MCP contracts. | Every request exposes sources/freshness and every tool call is audited. | KLMF-AI-001 |
| `KL-AP3-AI-002` | **Human confirmation** | AI may recommend but cannot independently execute sensitive financial, permission, safety, release or production changes. | Confirmation gate is enforced server-side. | Project Instructions |
| `KL-AP3-EXP-001` | **Exports and evidence packages** | Generate scoped exports for audits, incidents, billing, device history, migrations and go-live evidence through asynchronous jobs and File Service. | Export truth includes filters, source, generated-at, checksum and retention policy. | Admin v2 baseline; KLMF-REP-010 |


---

## 5. Phase 1 Laundry Workflows

### 5.1 Partner to Digital Store

```text
Lead
 -> Partner verification
 -> Tenant/Partner identity
 -> Digital Store creation
 -> Laundry vertical lock
 -> default Laundry templates
 -> staff/owner invitation
 -> payment and document readiness
 -> online-ready or physical-setup-ready
```

### 5.2 Digital Store to physical Location

```text
Select existing Digital Store
 -> create Store Location
 -> choose certified Hub profile
 -> create Hub provisioning session
 -> Hub claims code and receives certificate
 -> Hub downloads initial configuration and operational files
 -> validate Hub services
 -> Hub becomes active
 -> create assigned terminal profiles
 -> provision terminals through active Hub
 -> validate T1-T4 and peripherals
 -> run offline test Booking and sync reconciliation
 -> four-eyes go-live approval
```

### 5.3 Canonical Laundry terminal model

| Role | Canonical purpose | Admin validation |
|---|---|---|
| T1 | POS Cashier / Intake | Booking intake, service/pricing, deposit/payment, receipt and garment tag printing. |
| T2 | Customer Display Screen | Customer-facing Booking/services/totals/KHQR/payment/pickup display; privacy timeout and pairing with T1. |
| T3 | Clean & Ready Scan-In | QA/count, Ready storage assignment and Ready-for-Pickup event. |
| T4 | Customer Pickup Scan-Out | Customer verification, remaining balance where permitted, garment scan-out and completion. |

T2 is not a production display. T3 cannot complete pickup. T4 is the only terminal role authorized to complete customer pickup. T3/T4 may share physical hardware, but their modes, permissions and audit events remain separate.

### 5.4 Store readiness checklist

| Domain | Blocking examples | Evidence |
|---|---|---|
| Identity | Partner not verified; Digital Store missing vertical | Verification case and Store record |
| Catalog/pricing | No active service or invalid price rule | Versioned service/pricing snapshot |
| Payments | No approved cash/KHQR path for pilot | Provider/config test result |
| Documents | Receipt/tag template cannot render | Test PDF/print evidence |
| Hub | Hub identity not active or initial sync incomplete | Certificate, heartbeat, sync record |
| Terminals | Required T1-T4 roles missing or incompatible | Assignment and role test |
| Peripherals | Required printer/scale/scanner test failed | Peripheral test record |
| Offline | Offline Booking cannot complete locally | Offline test run and event log |
| Reconnect | Duplicate/replay or reconciliation failure | Sync reconciliation report |
| Support/recovery | No support contact or rollback procedure | Approved runbook references |

---

## 6. Canonical Data Contracts

### 6.1 Data ownership rules

- Relational tables hold authoritative identity, permissions, subscriptions, devices, provisioning, releases, configuration, incidents, support and audit records.
- JSON is allowed only for optional metadata, provider payload snapshots, test details or extension fields; it may not become primary financial, inventory, permission or device-trust truth.
- Finalized finance, payment, inventory and audit records are append-only; corrections use compensating events or versioned replacements.
- Every scoped row carries the required Tenant, Digital Store, Store Location, actor and/or device identifiers.
- All sensitive mutations are idempotent, versioned and audited.

### 6.2 Core and Admin tables

| Table | Purpose | Critical fields |
|---|---|---|
| `kitluy_core.tenants` | Backend Partner account boundary | `id`, `tenant_code`, `status`, identity/contact fields |
| `kitluy_core.digital_stores` | Digital control plane and vertical ownership | `tenant_id`, `store_code`, `primary_vertical`, `status`, locale/currency defaults |
| `kitluy_core.store_locations` | Physical edge site under Digital Store | `digital_store_id`, address, timezone, operating status, Hub requirement |
| `kitluy_core.admin_user_profiles` | HET user eligibility | `user_id`, status, security metadata |
| `kitluy_core.user_roles` | Admin role assignments | user, role, scope, validity |
| `kitluy_admin.crm_leads` | Lead pipeline | source, owner, next action, status |
| `kitluy_admin.partner_verification_cases` | Verification workflow/evidence | Partner, reviewer, status, evidence, reasons |
| `kitluy_admin.onboarding_workspaces` | Guided onboarding aggregate | Partner, Digital Store, Location, progress, owner |
| `kitluy_admin.readiness_policies` | Versioned readiness rules | version, scope, blocking flag, evaluator |
| `kitluy_admin.readiness_results` | Evidence-backed check result | subject, policy version, status, source, as-of, evidence |
| `kitluy_admin.go_live_approvals` | Four-eyes launch approval | requester, approver, decision, evidence package |
| `kitluy_admin.support_tickets` | Support case lifecycle | priority, SLA, assignee, linked subjects |
| `kitluy_admin.support_access_sessions` | Consent-scoped support access | consent, scope, purpose, expiry, revocation |
| `kitluy_admin.support_interventions` | Append-only action record | session, actor, resource/action/outcome |
| `kitluy_admin.platform_incidents` | Incident command record | severity, impact, timeline, mitigation, review |
| `kitluy_billing.plan_policies` | Approved commercial policy versions | plan, entitlements, effective dates, approval |
| `kitluy_billing.subscriptions` | SaaS lifecycle | Tenant/Store, plan, state, renewal/grace |
| `kitluy_billing.invoices` | SaaS invoices | currency, totals, status, due date |
| `kitluy_billing.payment_attempts` | Billing attempt ledger | provider ref, idempotency, outcome |
| `kitluy_billing.dunning_events` | Collection workflow | sequence, channel, delivery status |

### 6.3 Device, provisioning and fleet tables

| Table | Purpose |
|---|---|
| `kitluy_devices.hardware_profiles` | Certified/conditional/unsupported hardware and compatibility. |
| `kitluy_devices.devices` | Asset/device identity and lifecycle. |
| `kitluy_devices.device_certificates` | Issuance, rotation, expiry and revocation history. |
| `kitluy_devices.device_assignments` | Tenant/Digital Store/Location and role assignments. |
| `kitluy_devices.provisioning_sessions` | Short-lived Hub/terminal code or QR workflow. |
| `kitluy_devices.device_actions` | Signed, idempotent remote action queue. |
| `kitluy_devices.peripheral_tests` | Printer, scale, scanner, display and other validation. |
| `kitluy_devices.rma_cases` | Repair/replacement lifecycle. |
| `kitluy_sync.device_heartbeats` | Append-only liveness/health signals. |
| `kitluy_sync.sync_batches` | Cloud/Hub synchronization batches and reconciliation. |
| `kitluy_sync.component_health_snapshots` | Truth-labeled component health read model. |

### 6.4 Release, configuration and operations tables

| Table | Purpose |
|---|---|
| `kitluy_releases.release_artifacts` | Version, checksum, signature, platform and compatibility. |
| `kitluy_releases.release_channels` | Internal, Pilot and Stable channel policy. |
| `kitluy_releases.rollout_campaigns` | Cohorts, targets, state, health gate and approvals. |
| `kitluy_releases.device_installations` | Desired/downloaded/installed/active/rollback state. |
| `kitluy_config.configuration_versions` | Immutable configuration snapshots. |
| `kitluy_config.configuration_publications` | Targeted publication and acknowledgement. |
| `kitluy_integrations.connectors` | Governed connector registry/lifecycle. |
| `kitluy_integrations.credential_statuses` | Non-secret credential state and expiry. |
| `kitluy_integrations.webhook_deliveries` | Signed delivery attempts, retries and replay. |
| `kitluy_integrations.reconciliation_statuses` | Provider/source reconciliation freshness. |
| `kitluy_jobs.jobs` | Durable asynchronous work, retries and dead letters. |
| `kitluy_files.file_objects` | Spaces object metadata, permission, checksum and retention. |
| `kitluy_events.domain_events` | Versioned, scoped and idempotent event stream. |
| `kitluy_audit.audit_logs` | Immutable privileged-action audit. |
| `kitluy_ai.ai_requests` | AI request, sources, policy, cost and result metadata. |
| `kitluy_ai.mcp_tool_calls` | Tool invocation, approval and outcome audit. |

### 6.5 Money and time

- KHR uses integer riel minor units (`bigint`, exponent 0).
- USD uses integer cents (`bigint`, exponent 2) unless the shared Core money contract defines a compatible approved alternative.
- Never silently convert currencies.
- Store operational timestamps are persisted as `timestamptz` and rendered in `Asia/Phnom_Penh` by default.
- Financial aggregates expose source, period, currency, as-of and reconciliation state.

---

## 7. API, Events and Jobs

### 7.1 Governed API boundaries

| API | Admin relationship |
|---|---|
| Management API | Primary Admin browser contract for authorized platform operations. |
| Commerce Store API | Customer-facing Phase 3 contract; Admin may monitor health but does not use it for Phase 1 operations. |
| Edge Operations API | Hub/device provisioning, heartbeats, sync and action delivery; Admin browser never bypasses it to talk directly to LAN devices. |
| Connector API | External provider/channel callbacks, mappings and projections; no direct database access. |

### 7.2 Required endpoints
| Method | Route | Contract |
|---|---|---|
| `POST` | `/management/v1/admin/onboarding-workspaces` | Create idempotent Partner/Digital Store onboarding workspace. |
| `POST` | `/management/v1/admin/partners/{partner_id}/verify` | Approve/reject Partner verification with evidence and reason. |
| `POST` | `/management/v1/admin/digital-stores` | Create a Digital Store under a Tenant/Partner. |
| `POST` | `/management/v1/admin/digital-stores/{id}/vertical-lock` | Lock primary vertical to laundry. |
| `POST` | `/management/v1/admin/store-locations` | Create physical Location under a Digital Store. |
| `POST` | `/management/v1/admin/readiness/{scope}/evaluate` | Evaluate versioned readiness checks. |
| `POST` | `/management/v1/admin/go-live/{location_id}/approve` | Approve physical Store go-live with four-eyes evidence. |
| `POST` | `/management/v1/admin/provisioning-sessions` | Create short-lived Hub or terminal provisioning session. |
| `POST` | `/management/v1/admin/devices/{id}/assign` | Assign Tenant/Digital Store/Location and role profile. |
| `POST` | `/management/v1/admin/devices/{id}/revoke` | Revoke certificate, sessions and privileged actions. |
| `POST` | `/management/v1/admin/device-actions` | Queue signed, idempotent remote action. |
| `GET` | `/management/v1/admin/system-status` | Read truth-labeled component status. |
| `POST` | `/management/v1/admin/releases` | Register signed release artifact and compatibility. |
| `POST` | `/management/v1/admin/rollouts` | Create staged rollout campaign. |
| `POST` | `/management/v1/admin/rollouts/{id}/promote` | Promote rollout channel with approval evidence. |
| `POST` | `/management/v1/admin/config-publications` | Publish immutable configuration version. |
| `POST` | `/management/v1/admin/config-publications/{id}/rollback` | Publish compatible prior configuration. |
| `POST` | `/management/v1/admin/support-sessions` | Create consent-scoped support access. |
| `POST` | `/management/v1/admin/connectors/{id}/test` | Run governed connector test. |
| `POST` | `/management/v1/admin/webhook-deliveries/{id}/replay` | Replay eligible delivery idempotently. |
| `POST` | `/management/v1/admin/migrations/{id}/validate` | Run migration dry-run and validation. |
| `POST` | `/management/v1/admin/exports` | Create asynchronous evidence export. |
| `POST` | `/management/v1/admin/ai/summarize` | Request source-backed AI summary. |
| `POST` | `/edge/v1/provision/claim` | Hub/terminal claims a provisioning session; not called by browser UI directly. |
| `POST` | `/edge/v1/heartbeats` | Hub submits signed heartbeat and component health. |
| `POST` | `/connector/v1/provider-events/{provider}` | Receive signed provider callback through Connector API. |


### 7.3 Shared API rules

- Calendar/versioned route namespace or approved semantic versioning.
- OAuth/session scopes and server-side RBAC.
- `Idempotency-Key` required for mutating commands that may retry.
- Correlation ID returned on every response and propagated to jobs/events/audit.
- Cursor pagination for large collections.
- Consistent errors: code, message, field details, retryability and correlation ID.
- Rate limits by actor, Tenant, device and connector where applicable.
- Optimistic version/ETag for policy/configuration changes.
- Sensitive actions require re-auth and approval token.

### 7.4 Domain events

Minimum Phase 1 events:

```text
partner_verification_requested.v1
partner_verified.v1
digital_store_created.v1
digital_store_vertical_locked.v1
store_location_created.v1
readiness_evaluated.v1
store_go_live_approved.v1
provisioning_session_created.v1
device_identity_issued.v1
device_assigned.v1
device_revoked.v1
device_heartbeat_received.v1
device_action_queued.v1
device_action_completed.v1
configuration_published.v1
configuration_rolled_back.v1
release_signed.v1
rollout_started.v1
rollout_paused.v1
rollout_rolled_back.v1
subscription_state_changed.v1
invoice_state_changed.v1
connector_health_changed.v1
provider_health_changed.v1
support_consent_granted.v1
support_intervention_recorded.v1
platform_incident_declared.v1
migration_validation_completed.v1
```

Events are versioned, scoped, auditable and retry-safe. The transactional outbox pattern or an equivalent proven atomic publishing mechanism is required for authoritative mutations.

### 7.5 Durable jobs

| Job family | Examples |
|---|---|
| Provisioning | Initial Digital Store projection, Hub bootstrap, terminal profile distribution. |
| Release | Artifact verification, cohort targeting, rollout health evaluation, rollback. |
| Configuration | Publication, acknowledgement timeout, compatibility validation. |
| Integration | Connector tests, webhook retry, reconciliation polling. |
| Billing | Invoice generation, dunning, subscription transitions. |
| Migration | Dry-run, validation, import, reconciliation and rollback package. |
| Files/exports | Evidence package, audit export, report rendering and retention cleanup. |
| AI/RAG | Indexing, source validation, summary/evaluation tasks. |

Every job has idempotency, attempt count, next retry, dead-letter state, input checksum, actor/correlation context and audit linkage.

---

## 8. State Machines and Business Rules

### 8.1 Canonical states
| Aggregate | State machine |
|---|---|
| Partner/Tenant | `lead -> verification_pending -> onboarding -> active -> restricted -> suspended -> closed` |
| Digital Store | `draft -> configuring -> ready_online -> physical_setup -> active -> paused -> archived` |
| Store Location | `draft -> hub_pending -> hub_active -> terminals_pending -> validation -> live -> maintenance -> decommissioned` |
| Provisioning session | `created -> claimed -> identity_issued -> syncing -> validating -> active | expired | revoked | failed` |
| Device | `inventory -> assigned -> provisioning -> active -> degraded -> offline -> revoked -> retired` |
| Release | `draft -> signed -> internal -> pilot -> stable -> superseded | withdrawn` |
| Rollout | `planned -> running -> paused -> completed | aborted | rolled_back` |
| Configuration publication | `draft -> approved -> published -> acknowledged -> superseded | rolled_back` |
| Support consent | `requested -> granted -> active -> expired | revoked -> closed` |
| Incident | `detected -> triaged -> mitigated -> monitoring -> resolved -> reviewed` |
| Subscription | `trial -> active -> grace -> overdue -> suspended -> cancelled` |
| Connector | `registered -> configured -> testing -> active -> degraded -> suspended -> removed` |


### 8.2 Immutable rules

1. Finalized transaction, payment, inventory and audit truth is never edited destructively from Admin.
2. Device certificate history, go-live approval, support interventions and release decisions are append-only.
3. A Digital Store's primary vertical cannot change casually after operational activation.
4. A Location cannot become live without an active Hub when the approved hardware profile requires one.
5. Terminals cannot be provisioned before their assigned Hub is active.
6. Configuration and releases are versioned; rollback activates a prior compatible version rather than rewriting history.
7. Connectors and external channels cannot own KitLuy customer, payment, finance or inventory truth.
8. Missing/stale/partial data is labeled and never presented as current authoritative truth.
9. AI does not perform sensitive actions without authorized human confirmation.
10. Production migrations are applied only by authorized human operators with backup and rollback evidence.

### 8.3 Conflict handling

- Partner identity conflicts: block automatic merge; require reviewed resolution.
- Device identity conflict: fail closed and open a provisioning/security case.
- Configuration conflict: Digital Store approved version wins for desired state; Hub retains local active state until a compatible publication is accepted.
- Transaction/payment/inventory conflict: reconcile through domain rules and compensating records; never generic last-write-wins.
- Heartbeat/status conflict: latest trusted source is shown with source and as-of; do not collapse conflicting component states into one unlabeled status.

---

## 9. Store Hub, Offline and Remote-Action Boundaries

### 9.1 Admin PWA connectivity

The Admin PWA is cloud-connected. It never requires direct LAN access to Store devices and must not pretend an offline browser mutation succeeded. The PWA may cache static assets but not sensitive tenant, billing, support, audit or device data for offline use.

### 9.2 Store continuity

After provisioning, internet failure must not stop approved local operations while the Store Hub and LAN remain healthy. Admin displays WAN outage and stale cloud state but does not instruct Store staff to stop normal operations unless a separate safety incident requires it.

### 9.3 Connection priority for terminals

```text
1. Assigned Hub private IP
2. Assigned Hub hostname
3. Automatic LAN discovery
4. Last successful Hub IP
5. Latest Hub IP reported through cloud
6. Manual IP override as recovery fallback
```

Every connection verifies Hub UUID, certificate, Tenant, Digital Store and Location. IP is reachability, not trust.

### 9.4 Remote actions

Remote actions are cloud-queued, signed and pulled by the trusted Hub. They include explicit scope, expiry, risk class, idempotency key, expected version and approval evidence. Examples include refresh config, run diagnostics, collect support bundle, restart approved service, install release, rollback release and revoke terminal. Data wipe or equivalent destructive actions require the highest approval class and documented recovery plan.

---

## 10. Design System and UX Requirements

### 10.1 Operator design principles

- Dense but readable desktop-first information hierarchy.
- Exception-first command board rather than vanity metrics.
- Every metric displays source, as-of, freshness and scope.
- Clear distinction among Digital Store, Store Location, Hub, terminal role and peripheral.
- Destructive/high-risk actions use explicit review screens, reason and confirmation.
- No raw secrets, internal tokens or production database credentials in UI.
- Khmer and English with consistent terminology; do not use Seller.
- KHR and USD are shown with original currency; no silent conversion.
- Status labels use text and icons, not color alone.
- Long-running tasks use job progress, retry state and evidence links.

### 10.2 Core reusable components

`ScopeBreadcrumb`, `TruthBadge`, `FreshnessBadge`, `ReadinessChecklist`, `ApprovalPanel`, `AuditTimeline`, `DeviceIdentityCard`, `TerminalRoleBadge`, `CompatibilityMatrix`, `ProvisioningWizard`, `ReleasePromotionPanel`, `RolloutCohortTable`, `SystemStatusTree`, `ConnectorHealthCard`, `SupportConsentPanel`, `MigrationValidationReport`, `EvidencePackagePanel`, `IncidentTimeline`, `AsyncJobDrawer`.

### 10.3 Accessibility and localization

- Keyboard navigable major workflows.
- Visible focus states and screen-reader labels.
- No status communicated only by color.
- Khmer font rendering and text expansion tested.
- Dates/times rendered in Asia/Phnom_Penh with absolute timestamp available.
- Phone numbers stored/validated in an approved canonical form.

---

## 11. Security, Privacy and Audit

### 11.1 Authentication

- Supabase Auth or approved equivalent.
- Active Admin profile and role required.
- Production MFA policy: `[REQUIRED: approved admin MFA methods and enforcement]`.
- Idle/session and sensitive-action re-auth values: `[REQUIRED: approved security policy values]`.
- Service identities cannot log into human UI.

### 11.2 Isolation

RLS and service authorization enforce Tenant, Digital Store, Store Location, user, role, device and connector scope. Cross-tenant support requires an explicit consent session or platform-safety/legal authority documented in policy.

### 11.3 Audit minimum

Every sensitive event records actor, effective role, session, source IP/device, Tenant/Digital Store/Location, action, target, reason, correlation ID, request/approval identity, outcome and evidence references. Audit exports include checksum and generation context.

### 11.4 Secrets

Raw secrets are stored only in approved secret managers/vaults. Admin displays provider, environment, status, expiry and last-test metadata. Secret values must not appear in client bundles, logs, screenshots, exports or AI prompts.

### 11.5 Support privacy

Support access is purpose-limited, time-limited, scope-limited, revocable and fully logged. HET platform safety, fraud, legal, privacy, abuse or policy intervention may use separately approved authority; ordinary troubleshooting requires Partner consent.

---

## 12. Monitoring, Alerts, Backup and Recovery

### 12.1 Required health domains

- Admin PWA availability and client errors.
- Supabase Auth, database, RLS, Realtime and Edge Functions.
- DigitalOcean application services, workers, Spaces and AI endpoint.
- Job queues, retry rates, dead letters and oldest pending job.
- Hub heartbeat, terminal heartbeat and sync freshness.
- Release rollout and installation failure rate.
- Configuration acknowledgement and compatibility failures.
- Payment/provider callback and reconciliation freshness.
- Connector/webhook failure and credential expiry.
- File/export and RAG indexing failures.
- Support SLA and incident severity.
- Sensitive-action and security anomaly review.

### 12.2 Alert policy

Exact numerical thresholds remain `[REQUIRED: environment baselines and approved SLOs]`. Thresholds must be versioned, environment-specific and tested through synthetic faults. Alerts include owner, severity, impacted scopes, evidence link and runbook.

### 12.3 Backup and recovery

| Asset | Requirement |
|---|---|
| Supabase/PostgreSQL | PITR where available, scheduled logical backups, restore drills and migration rollback evidence. |
| Spaces files | Versioning/retention as approved, checksums, inventory and restore procedure. |
| Release artifacts | Immutable signed artifacts and rollback packages retained per policy. |
| Configuration | Immutable versions and publication history. |
| Audit | Protected append-only retention and verified exports. |
| Secrets | Provider-managed backup/rotation; never reconstructed from application exports. |

RPO/RTO values remain `[REQUIRED: approved service tier targets]` and must be measured through drills before pilot exit.

---

## 13. QA and Acceptance Matrix
| ID | Acceptance scenario |
|---|---|
| `QA-001` | Non-HET user is denied Admin PWA access. |
| `QA-002` | Inactive Admin profile is denied even with valid Auth session. |
| `QA-003` | Role matrix blocks unauthorized billing, device, release and support actions. |
| `QA-004` | Tenant/Partner, Digital Store, Location and device scope isolation negative tests pass. |
| `QA-005` | Digital Store cannot be created without Tenant/Partner. |
| `QA-006` | Location cannot be created without Digital Store. |
| `QA-007` | A Store cannot receive a second primary vertical. |
| `QA-008` | Laundry template application creates Store-owned copies and is idempotent. |
| `QA-009` | Readiness score is reproducible from versioned checks. |
| `QA-010` | Go-live approval fails with missing Hub activation. |
| `QA-011` | Go-live approval fails with missing T1-T4 validation. |
| `QA-012` | Go-live approval requires separate requester and approver. |
| `QA-013` | Hub provisioning code expires and cannot be replayed. |
| `QA-014` | Terminal cannot provision before Hub is active. |
| `QA-015` | Wrong Tenant/Digital Store/Location certificate claim is rejected. |
| `QA-016` | T1, T2, T3 and T4 role assignments are enforced. |
| `QA-017` | T4 completion permission cannot be used by T3 role. |
| `QA-018` | Lost device revocation kills active sessions and blocks reconnect. |
| `QA-019` | Replacement workflow prevents duplicate active identity. |
| `QA-020` | Unsupported hardware is visibly unsupported and cannot pass certified go-live. |
| `QA-021` | Heartbeat freshness distinguishes cloud outage, Hub outage and terminal LAN outage. |
| `QA-022` | Admin remote action queues while Location is offline and runs once after reconnect. |
| `QA-023` | Duplicate remote action delivery does not duplicate effect. |
| `QA-024` | System Status shows source, as-of, freshness and completeness. |
| `QA-025` | Missing provider data is unavailable, not zero or healthy. |
| `QA-026` | Raw credentials never appear in UI, logs or exports. |
| `QA-027` | Connector callback duplicate is deduplicated. |
| `QA-028` | Webhook replay is idempotent and audited. |
| `QA-029` | Unsigned release is rejected. |
| `QA-030` | Checksum mismatch prevents installation. |
| `QA-031` | Internal release cannot skip directly to Stable. |
| `QA-032` | Pilot health gate can pause or abort rollout. |
| `QA-033` | A/B failed health check returns to previous slot. |
| `QA-034` | Hub distributes cached release to terminals during WAN outage. |
| `QA-035` | Incompatible config/software combination is blocked. |
| `QA-036` | Configuration rollback publishes a prior version without destructive edits. |
| `QA-037` | Subscription transitions are idempotent. |
| `QA-038` | Invoice manual mark-paid requires finance permission, evidence and reason. |
| `QA-039` | Reports/exports remain available independent of commercial plan. |
| `QA-040` | Support impersonation is impossible without active scoped consent. |
| `QA-041` | Expired/revoked consent terminates support access. |
| `QA-042` | Every support action appears in intervention audit. |
| `QA-043` | High-risk remote action requires four-eyes approval. |
| `QA-044` | Safety switch cannot bypass transaction, payment, inventory or audit rules. |
| `QA-045` | Migration dry-run reports invalid rows without mutating production truth. |
| `QA-046` | Migration rollback evidence is linked to cutover. |
| `QA-047` | PWA offline mode exposes shell/error only; sensitive cached data is unavailable. |
| `QA-048` | Khmer/English labels and Asia/Phnom_Penh timestamps render correctly. |
| `QA-049` | KHR and USD values retain original currency and precision rules. |
| `QA-050` | AI summary includes sources/freshness and cannot execute sensitive action. |
| `QA-051` | Audit records are append-only and export checksums verify. |
| `QA-052` | Backup restore drill reconstructs Admin operational records within approved RPO/RTO placeholders. |
| `QA-053` | Phase 1 Laundry regression passes after additive migration. |
| `QA-054` | One qualified engineer passes the Rebuild Test from current docs and migrations. |


### 13.1 Test evidence package

Each release candidate includes unit, component, contract, RLS/RBAC, integration, migration, Store Hub/offline, security, performance, backup/restore and end-to-end results. Failed or skipped tests are visible; they cannot be summarized as passed.

---

## 14. Phase Gates

| Gate | Required evidence |
|---|---|
| G0 — Authority | Owner decisions, Phase 1 scope, rejected/deferred patterns and conflict register are resolved and versioned. |
| G1 — Contract | Schema, API/events, state machines, permissions, audit, offline boundary, migrations, flags/entitlements and documentation plan approved. |
| G2 — Build | Code, migrations, seeds, UI, jobs and automated tests complete in development. |
| G3 — Integrated verification | Cross-product, Hub/offline, security, payment/provider, migration, performance and recovery tests pass. |
| G4 — Pilot readiness | Monitoring, alerts, rollback, hardware support matrix, training, runbooks, support and go-live checklist ready. |
| G5 — Phase exit / Rebuild Test | Pilot evidence approved and one qualified engineer reconstructs and operates the product from current documentation/contracts. |
| G-D — Deferred | Feature remains disabled until documented re-entry prerequisites and owner approval are satisfied. |
| G-X — Guardrail | Architecture, code review and automated checks prevent a rejected pattern from entering production. |

### 14.1 Phase 1 exit criteria

- All non-deferred Phase 1 Admin master capabilities have G5 evidence.
- All T1-T4, Hub-first provisioning and Digital Store/Location regressions pass.
- No old three-terminal model remains in active routes, schemas, docs or QA.
- No product page labels planning as implemented.
- Public marketplace/revenue share, proprietary hardware dependence, merchant-managed hosting and report/export paywalls remain disabled or rejected.
- Rebuild Bible, Business Bible, device/provisioning handbook, API/event registry, schema dictionary, runbooks and feature registry are updated.

---

## 15. v2.0.0 to v3.0.0 Migration Plan
| Migration ID | Required change |
|---|---|
| `M3-001` | Introduce/confirm neutral `digital_stores` and `store_locations` contracts; map legacy physical `stores` without destructive renaming until compatibility views are validated. |
| `M3-002` | Add immutable primary-vertical assignment and one-Store/one-vertical constraint. |
| `M3-003` | Add provisioning sessions, short-lived codes, device certificates and certificate-rotation history. |
| `M3-004` | Add T1-T4 terminal profiles, device-role assignments and role-change audit. |
| `M3-005` | Add hardware profile/certification tables and support-state fields. |
| `M3-006` | Add readiness policies, check results, evidence references and four-eyes go-live approval. |
| `M3-007` | Add release artifacts, signatures, channels, compatibility rules, rollout campaigns, installations and rollback records. |
| `M3-008` | Add immutable configuration versions, publications, acknowledgements and rollback references. |
| `M3-009` | Add component health snapshots, incidents, provider/connector reconciliation status and freshness metadata. |
| `M3-010` | Add consent-based support sessions and intervention logs. |
| `M3-011` | Add migration/import jobs, dry-run reports, cutover and rollback evidence. |
| `M3-012` | Backfill legacy Admin v2 device/store records using auditable jobs; do not infer implementation success without validation evidence. |


### 15.1 Compatibility strategy

- Prefer additive migrations and compatibility views/adapters.
- Preserve legacy IDs and references while introducing Digital Store/Location semantics.
- Do not rename production tables destructively without verified migration and rollback.
- Gate v3 UI routes behind feature flags until contracts and data backfills pass.
- Record each superseded term, route, table assumption and QA case in the reconciliation register.
- Run Partner, Chain, POS, Hub and reporting regressions before promotion.

### 15.2 Required repository evidence before `IMPLEMENTED`

1. Application route and component implementation under the canonical Admin app root.
2. Reviewed and applied development migrations.
3. RLS/RBAC negative tests.
4. API/event/job contract tests.
5. Store Hub provisioning and offline/reconnect integration tests.
6. Release signing, staged rollout and rollback tests.
7. Migration/backfill validation report.
8. Staging deployment and observability evidence.
9. Pilot Store go-live package.
10. Approved production change record.

---

## 16. Master Registry Traceability

The current master registry assigns 22 canonical capabilities to `kitluy-admin-portal`. Phase 3 or unresolved items are shown for boundary awareness but are not silently added to the Phase 1 delivery scope.
| Master ID | Domain | Capability | Authority | Disposition | Earliest phase | Source platforms | Phase 1 treatment |
|---|---|---|---|---|---|---|---|
| `KLMF-COM-048` | `COM` | Storefront status and rollback | UNRESOLVED | ADOPT / ADAPT CANDIDATE | Phase 3 | Shopify | Deferred/guardrail |
| `KLMF-DEV-002` | `DEV` | Certified hardware profiles and compatibility matrix | OWNER-LOCKED | ADAPT WITH CERTIFICATION GUARDRAIL | Phase 1 | Lightspeed, Loyverse | Required |
| `KLMF-DEV-004` | `DEV` | Device recovery, reprovisioning and revocation | APPROVED TARGET | ADOPT / ADAPT CANDIDATE | Phase 1 | Loyverse | Required |
| `KLMF-DEV-005` | `DEV` | Device registration, certificates and trust | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce | Required |
| `KLMF-DEV-006` | `DEV` | Device revocation, replacement and remote diagnostics | APPROVED TARGET | PRESERVE / DEEPEN KITLUY TARGET | Phase 1 | WooCommerce, Loyverse | Required |
| `KLMF-DEV-007` | `DEV` | Device role assignment | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | Loyverse | Required |
| `KLMF-DEV-008` | `DEV` | Digital Store-first Hub and terminal provisioning | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce, Loyverse | Required |
| `KLMF-GOV-005` | `GOV` | Do not copy competitor plans, gates or commercial limits | PLANNING CANDIDATE | REJECT / ARCHITECTURAL GUARDRAIL | Unresolved | Shopify | Deferred/guardrail |
| `KLMF-GOV-006` | `GOV` | Feature flags, entitlements and plan controls | APPROVED TARGET | APPROVED BASE + OWNER DECISION FOR OPTIONAL DEPTH | Phase 1 | WooCommerce, Shopify, Loyverse | Required |
| `KLMF-GOV-007` | `GOV` | HET Admin control plane | APPROVED TARGET | PRESERVE / DEEPEN KITLUY TARGET | Phase 1 | WooCommerce, Toast, Loyverse | Required |
| `KLMF-GOV-008` | `GOV` | KitLuy SaaS subscription billing | APPROVED TARGET | PRESERVE / DEEPEN KITLUY TARGET | Phase 1 | WooCommerce | Required |
| `KLMF-GOV-010` | `GOV` | Managed SaaS operating and upgrade responsibility | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce, Toast, Shopify | Required |
| `KLMF-OPS-001` | `OPS` | Configuration and software compatibility status | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce | Required |
| `KLMF-OPS-002` | `OPS` | Connector health, incidents and reconciliation status | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce | Required |
| `KLMF-OPS-003` | `OPS` | Consent-based support and Partner diagnostics | APPROVED TARGET | ADOPT / ADAPT CANDIDATE | Phase 1 | WooCommerce, Lightspeed | Required |
| `KLMF-OPS-004` | `OPS` | Data import, migration validation and rollback | APPROVED TARGET | ADOPT / ADAPT CANDIDATE | Phase 1 | Shopify, Lightspeed | Required |
| `KLMF-OPS-006` | `OPS` | Digital Store system status and component health | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce, Toast, Lightspeed | Required |
| `KLMF-OPS-008` | `OPS` | Payment and provider health | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce | Required |
| `KLMF-OPS-010` | `OPS` | Physical Store go-live evidence | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | Shopify | Required |
| `KLMF-OPS-011` | `OPS` | Signed releases, staged rollout, A/B installation and rollback | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce, Toast, Loyverse | Required |
| `KLMF-OPS-012` | `OPS` | Store readiness, test transaction and go-live checklist | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | WooCommerce, Lightspeed, Loyverse | Required |
| `KLMF-OPS-013` | `OPS` | Versioned configuration publication and rollback | OWNER-LOCKED | PRESERVE OWNER-LOCKED AUTHORITY | Phase 1 | Toast, Lightspeed | Required |


### 16.1 Competitor-package traceability summary

| Package | Admin rows | Incorporated Phase 1 lessons | Guardrails/deferred items |
|---|---:|---|---|
| WooCommerce | 20 | Digital Store-first provisioning, certificates, release governance, System Status, subscriptions, connector/provider health. | Merchant-managed hosting rejected; marketplace and revenue-share depth deferred/decision-gated. |
| Toast | 10 | Hosted SaaS responsibility, HET control plane, pairing UX, staged updates and readiness. | Hardware ownership/proprietary dependence rejected; US pricing/payment relationship not copied. |
| Shopify | 5 | Managed upgrades and physical Store go-live evidence. | Customer/order migration and storefront rollback belong to Phase 3; marketplace economics deferred. |
| Lightspeed | 5 | Migration validation, go-live checklist, component health and consent-based support. | Connector certification depth enters Phase 3. |
| Loyverse | 7 | Recovery/reprovisioning, lost-device revocation, staged rollout UX and certified hardware state. | Free/add-on pricing and export paywalls not copied; arbitrary hardware support rejected. |

---

## 17. Operational SOP Index

| SOP | Required output |
|---|---|
| Create/verify Partner | Verification case, evidence and audit. |
| Create Laundry Digital Store | Vertical lock, defaults and readiness workspace. |
| Create Store Location | Location record, Hub profile and readiness checks. |
| Provision Store Hub | Provisioning session, certificate, initial sync and service validation. |
| Provision T1-T4 terminals | Assigned roles, Hub trust, peripheral tests and active identity. |
| Replace lost/stolen device | Revoke, rotate, restore profile, validate replacement and close asset/security case. |
| Approve physical Store go-live | Evidence package and four-eyes approval. |
| Publish configuration | Immutable version, target, compatibility and acknowledgement. |
| Release software | Sign, Internal, Pilot, Stable, health check and rollback. |
| Run support session | Consent, scoped access, intervention log and closure summary. |
| Validate migration | Dry-run, reconciliation, cutover and rollback evidence. |
| Declare incident | Severity, command owner, timeline, communications, mitigation and review. |
| Operate subscription/dunning | Invoice/attempt state, communications and audit. |
| Test/recover connector | Credential status, signed callback, retry/replay and reconciliation. |
| Perform backup restore drill | Restore evidence, measured RPO/RTO and remediation. |

---

## 18. Go-Live Checklist

### 18.1 Product and authority

- [ ] Owner decisions and Phase 1 scope are current.
- [ ] Deferred and rejected patterns are disabled and tested.
- [ ] No three-terminal or physical-first conflict remains.
- [ ] Documentation and registry versions are linked.

### 18.2 Infrastructure and security

- [ ] Production domains, projects, buckets and secret stores are approved.
- [ ] Admin authentication, MFA and role assignments are validated.
- [ ] RLS/RBAC negative tests pass.
- [ ] Backups and restore drill pass.
- [ ] Monitoring, alerts and incident runbooks are active.

### 18.3 Data and services

- [ ] Migrations are applied and validated by an authorized operator.
- [ ] Digital Store/Location backfill is reconciled.
- [ ] APIs, events, jobs and dead-letter handling pass.
- [ ] File, notification, AI and connector services expose truthful health.
- [ ] Audit is append-only and export verification passes.

### 18.4 Laundry pilot

- [ ] Partner verification and Digital Store creation pass.
- [ ] Laundry templates apply successfully.
- [ ] Store Hub provisions and initial sync completes.
- [ ] T1, T2, T3 and T4 role tests pass.
- [ ] Receipt/tag printer, scale and scanner tests pass as required.
- [ ] Offline test Booking completes locally.
- [ ] Reconnect sync is idempotent and reconciled.
- [ ] Payment/KHQR readiness passes approved provider rules.
- [ ] Signed Pilot release installation and rollback pass.
- [ ] Support consent and recovery workflow pass.
- [ ] Four-eyes physical Store go-live approval is recorded.

### 18.5 Phase exit

- [ ] All required QA scenarios pass or have approved documented exceptions.
- [ ] Pilot monitoring period and incident review are complete.
- [ ] Rebuild Test passes with one qualified engineer.
- [ ] Production status is reported accurately; no planning item is labeled implemented without evidence.

---

## Appendix A — Reconciliation Register

| Conflict | v3 resolution |
|---|---|
| `Store` used only for physical branch | Use Digital Store for control plane and Store Location for physical edge. Maintain compatibility adapters until migration is proven. |
| Three-terminal Laundry model | Superseded by T1-T4 owner lock. |
| T2 used as production/scan-in terminal | T2 is Customer Display only. T3 is Ready Scan-In. T4 is Pickup Scan-Out. |
| Manual IP/.env provisioning as normal path | Superseded by smartphone-simple code/QR provisioning and certificate trust; manual IP is recovery fallback. |
| Direct Admin-to-LAN operation | Prohibited; use cloud queue and trusted Hub pull. |
| Unsigned direct terminal updates | Superseded by signed, staged Hub-distributed A/B releases. |
| Generic Store health without freshness | Superseded by truth-labeled Digital Store System Status. |
| Competitor pricing/add-on gates | Not copied; Cambodia-first policy requires owner decisions and pilot evidence. |
| Reporting/export/history paywall | Prohibited by owner decision. |
| Public extension marketplace in Phase 1 | Deferred; only governed first-party/basic connector foundation. |

## Appendix B — Required Open Values

The source set does not establish the following exact deployment values. They must remain explicit `[REQUIRED]` items rather than guesses:

- Production/staging Supabase project references and Admin domains.
- DigitalOcean project, service and Spaces bucket names.
- Approved Admin MFA, session timeout and sensitive re-auth policy.
- Final SaaS plan prices, trial length, grace period and billing provider contracts.
- Approved SLOs, alert thresholds, RPO/RTO and retention durations.
- Final certified hardware model list and warranty/support policy.
- Final payment-provider live credentials and reconciliation SLA.
- Production signing keys, key-custody policy and release approvers.
- Legal/privacy wording for support consent and platform intervention.

## Appendix C — Version History

| Version | Date | Change summary |
|---|---|---|
| v3.0.0 | 2026-07-25 | Reconciled Admin v2 baseline with current Project Instructions, Digital Store/Location owner lock, T1-T4, smartphone-simple provisioning, master registry v0.2 and WooCommerce/Toast/Shopify/Lightspeed/Loyverse adoption backlogs. Added System Status, certificate trust, release/configuration governance, support consent, migration safety and evidence-based go-live. |
| v2.0.0 | 2026-07-13 | Existing HET Admin PWA rebuild baseline for CRM, onboarding, billing, fleet, support, platform ops, audit, Laundry templates, AI and Integration Hub. |

## Final Rebuild Validation

This specification passes only when a qualified engineer can use it with approved migrations, contracts, runbooks and deployment values to reconstruct and operate the Phase 1 Admin Portal. The document itself is a target contract, not proof that the product has been built.
