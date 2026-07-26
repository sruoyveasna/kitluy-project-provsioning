# KitLuy Environment Matrix

| Field | Value |
|---|---|
| **Filename** | `kitluy-environment-matrix-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status** | Canonical operating target; not implementation evidence |
| **Timezone** | `Asia/Phnom_Penh` |

> **Purpose:** Define the hard isolation, data, access, deployment and evidence rules for every KitLuy environment.

## Source authority and evidence discipline

This document is derived from the current KitLuy Project Instructions and the following approved target sources:

- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md`
- `kitluy-storehub-phase1-spec-v1.0.0.md`
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md`
- current Phase 1 product specifications and owner-locked Digital Store, Store Hub, T1–T4, provisioning, release and security decisions

Authority order:

1. Current owner decisions and active Project Instructions.
2. Applied migrations, verified code/tests, infrastructure state, deployment records and production evidence.
3. This operating document after approval.
4. Current KitLuy infrastructure, Store Hub, security, API, database and product specifications.
5. Approved handoffs and registries.
6. Competitor analyses or clone documents as design references only.

Nothing in this document is evidence that infrastructure is implemented. `IMPLEMENTED`, `DEPLOYED`, `RESTORED`, `PILOT-APPROVED` or `GO-LIVE-APPROVED` may be used only when the corresponding evidence exists. Unknown provider, account, domain, owner, threshold, retention, RPO, RTO or credential values remain `[REQUIRED: ...]` and must not be guessed.

## Mandatory guardrails

- Supabase owns authoritative cloud PostgreSQL, Auth, RLS, approved Realtime, metadata and audit/event records.
- DigitalOcean owns application and worker compute, Container Registry, Spaces, release storage, AI/MCP/RAG compute and the initial App Platform deployment.
- Store Hub owns local Store operations after provisioning; T1–T4 use it over LAN and do not depend on live cloud access for normal operation.
- Cloud application compute is stateless and replaceable. Containers, pods, caches and queues do not own authoritative business truth.
- Finalized finance, payment, inventory, custody, security and audit records are append-only or corrected through compensating records.
- Production changes require authenticated, authorized and audited human action. Defined high-risk changes require four-eyes approval.
- Production migrations are never run automatically during application startup.
- Production secrets are never committed, embedded in images, copied into client bundles or recorded in this document.
- Monitoring and alert delivery remain available when the Admin Portal is unavailable.
- No multi-region, recovery, readiness or availability claim is made without tested evidence.



## 1. Environment model

KitLuy uses six named environments. `pilot` is a real-production cohort boundary, not a second staging environment. `disaster_recovery` is isolated recovery capacity and rehearsal space, not a permanent active-active claim.

| Environment | Primary purpose | Data policy | User access | Deployment policy | Destructive change policy |
|---|---|---|---|---|---|
| `local` | Individual development and local integration | Synthetic only | Named developer | Developer-controlled; no production credentials | Allowed only against disposable local resources |
| `development` | Shared engineering integration | Synthetic or approved masked fixtures | Engineering and automated test identities | Frequent automated deployment from protected branches | Allowed with team review; no production impact |
| `staging` | Production-like release-candidate verification | Synthetic, anonymized or approved test data | Engineering, QA, security, release operators | Controlled deployment of immutable candidates | Approval required for shared-state resets |
| `pilot` | Limited approved real Store cohort | Authoritative production data for pilot Stores | Pilot-authorized operators and scoped support | Human-approved, audited cohort rollout | Four-eyes for high-risk or irreversible action |
| `production` | Commercial operation | Authoritative production data | Least-privilege, environment-scoped production roles | Strict change window, approval, evidence and rollback | Four-eyes and explicit recovery plan |
| `disaster_recovery` | Restore, failover and continuity rehearsal | Isolated restored copy or controlled recovery data | DR-authorized operators only | Break-glass/DR runbook | Destructive actions permitted only inside documented isolation |

## 2. Provider and resource isolation matrix

| Resource class | Local | Development | Staging | Pilot | Production | Disaster recovery |
|---|---|---|---|---|---|---|
| Supabase project | Local stack or disposable project | Separate project | Separate project | Production project with pilot cohort controls or separately approved project | Separate production project | Isolated restore target `[REQUIRED]` |
| DigitalOcean project | None/disposable | Non-production project | Non-production project or isolated staging project | Production project, pilot-scoped rollouts | Production project | Isolated recovery project `[REQUIRED]` |
| App Platform apps | Local containers | `*-development` | `*-staging` | Production services with cohort flags | `*-production` | Recreated from IaC if invoked |
| Spaces | Local emulator optional | Separate buckets/credentials | Separate buckets/credentials | Production buckets with scoped data | Production buckets | Backup/restore buckets or isolated prefixes `[REQUIRED]` |
| Container Registry | Local images | Non-production repositories | Candidate repositories/tags | Same immutable digest as staging | Same immutable digest promoted | Retained immutable artifacts |
| Secrets | Local developer secret store | Development store | Staging store | Production store, pilot-scoped where possible | Production store | DR escrow/recovery references |
| DNS | `localhost`/hosts | Non-production zone/subdomain | Staging subdomains | Production domains with pilot routing | Production domains | Recovery records prepared but inactive unless approved |
| Monitoring | Local logs | Development project | Staging project | Production monitoring with pilot filters | Production monitoring | Independent recovery probes |
| Device PKI | Simulated/test CA | Test CA | Test/pre-production CA | Production operational CA | Production operational CA | CA recovery procedure only; no duplicate uncontrolled issuer |

## 3. Required naming convention

```text
kitluy-{service}-{environment}
kitluy-{resource-class}-{environment}
kitluy-{region}-{service}-{environment}     # only when region is operationally meaningful
```

Examples are logical only. Exact provider names require the approved environment inventory.

## 4. Access policy by environment

| Control | Local | Development | Staging | Pilot | Production | DR |
|---|---:|---:|---:|---:|---:|---:|
| MFA for human access | Recommended | Required for shared consoles | Required | Required | Required | Required |
| Environment-specific role assignment | N/A | Required | Required | Required | Required | Required |
| Four-eyes approval | No | Only high-risk shared actions | Release/security exceptions | High-risk actions | Defined sensitive actions | Restore/failover over active data |
| Break-glass | No | No | Rare | Yes, audited | Yes, audited | Yes, audited |
| Production service-role credential | Prohibited | Prohibited | Prohibited | Server-only | Server-only | Recovery-only |
| Real customer data | Prohibited | Prohibited unless approved masked | Prohibited unless approved anonymized | Allowed for pilot scope | Allowed | Isolated restore only |

## 5. Promotion path

```text
local -> development -> staging -> Internal channel -> pilot -> Stable production
```

Promotion reuses the same immutable digest. A rebuild is required only when source, dependencies, build configuration or signing inputs change. Configuration differences are injected through environment-scoped references, not image mutation.

## 6. Environment readiness criteria

Each non-local environment requires:

- owner and technical custodian;
- provider resource inventory;
- domain and certificate inventory;
- service identity inventory;
- secret-reference inventory;
- backup classification;
- monitoring and alert route;
- deployment and rollback route;
- data handling and retention policy;
- access review date;
- cost budget and anomaly threshold;
- evidence folder and last validation timestamp.

## 7. Environment drift and retirement

1. IaC state is reconciled before every production release.
2. Manual console changes create a drift record and must be imported, reverted or approved.
3. An environment may not be retired until data, artifacts, secrets, DNS, logs, audit and cost resources are handled through an approved retirement plan.
4. Production-like temporary environments use expiry dates and automatic cleanup where safe.

## 8. Required values

- `[REQUIRED: approved provider account owner]`
- `[REQUIRED: exact Supabase project references per environment]`
- `[REQUIRED: exact DigitalOcean project and application names]`
- `[REQUIRED: exact bucket and registry inventory]`
- `[REQUIRED: exact domains and DNS zones]`
- `[REQUIRED: environment owners and access-review cadence]`
- `[REQUIRED: cost budgets and anomaly thresholds]`
- `[REQUIRED: data masking process and approver]`
- `[REQUIRED: DR isolation model]`

## 9. Evidence checklist

- [ ] Environment inventory is versioned and owner-approved.
- [ ] Cross-environment credentials are absent.
- [ ] Development credentials fail against production.
- [ ] Production data-copy controls are tested.
- [ ] Promotion reuses an immutable digest.
- [ ] Environment-scoped RBAC negative tests pass.
- [ ] Drift detection produces an actionable record.
- [ ] Retention, backup and monitoring are mapped for every environment.
