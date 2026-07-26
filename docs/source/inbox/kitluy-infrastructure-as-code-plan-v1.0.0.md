# KitLuy Infrastructure-as-Code Plan

| Field | Value |
|---|---|
| **Filename** | `kitluy-infrastructure-as-code-plan-v1.0.0.md` |
| **Version** | `v1.0.0` |
| **Date** | `2026-07-26` |
| **Phase** | Phase 1 — Laundry |
| **Owner** | HET / KitLuy Suite Project Owner |
| **Audience** | Infrastructure, platform, security, release, database, support and QA teams |
| **Status** | Canonical operating target; not implementation evidence |
| **Timezone** | `Asia/Phnom_Penh` |

> **Purpose:** Turn the Phase 1 infrastructure architecture into reviewable, repeatable and recoverable code and evidence.

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



## 1. IaC objective

One qualified engineer must be able to reconstruct approved non-secret infrastructure from versioned code and documented provider prerequisites. IaC must minimize undocumented console work, detect drift and preserve a safe migration path from App Platform to DOKS without changing public contracts.

## 2. Repository layout

```text
infra/
├── terraform/
│   ├── modules/
│   │   ├── digitalocean-project/
│   │   ├── container-registry/
│   │   ├── app-platform-service/
│   │   ├── app-platform-worker/
│   │   ├── spaces-bucket/
│   │   ├── dns-zone-and-records/
│   │   ├── monitoring-alerts/
│   │   ├── managed-valkey/          # disabled until approved trigger
│   │   ├── regional-load-balancer/ # disabled until approved trigger
│   │   └── doks-foundation/         # readiness, not Phase 1 default
│   └── environments/
│       ├── development/
│       ├── staging/
│       ├── production/
│       └── disaster-recovery/
├── supabase/
│   ├── project-config/
│   ├── policies/
│   └── validation/
├── digitalocean/
│   ├── app-specs/
│   └── deployment-manifests/
├── domains/
│   ├── zones/
│   └── records/
├── kubernetes/
│   ├── base/
│   └── overlays/
├── monitoring/
├── policies/
└── evidence/
```

## 3. IaC ownership boundaries

| Domain | Managed through IaC | Separate controlled process |
|---|---|---|
| DigitalOcean project, apps, workers, buckets, registry | Yes | Initial provider organization/legal setup |
| DNS records and certificate references | Yes where provider supports it | Registrar ownership and recovery credentials |
| Supabase project configuration | Versioned configuration where supported | Initial project creation, plan selection and owner billing |
| Database schema | Supabase migration repository | Applied through database deployment runbook |
| Secrets | References, names, policies and bindings only | Secret values entered through approved secret system |
| PKI | Policies, profiles and service integration | Root/intermediate key ceremonies and protected key custody |
| Store Hub images | Image build definitions and manifests | Hardware enrollment/manufacturing station ceremony |
| DOKS | Prepared module, disabled by default | Owner-approved migration gate |

## 4. State and locking

- State backends are environment-separated.
- Production state access is limited to authorized infrastructure identities.
- State locking is mandatory.
- State backups are encrypted and tested.
- Sensitive state fields are minimized; state is treated as confidential.
- Destroy permission is separate from normal apply permission.
- A state-recovery runbook records backup location, recovery identity and validation steps.

Exact backend and locking technology remain `[REQUIRED: approved Terraform state design]`.

## 5. Module standards

Every module declares:

- inputs, outputs and validation;
- owner and supported environments;
- security assumptions;
- tagging/labeling scheme;
- encryption and network defaults;
- cost-sensitive inputs and limits;
- lifecycle and deletion protection;
- observability outputs;
- import procedure;
- upgrade and rollback notes;
- provider exit considerations.

Modules must be composable and must not embed Laundry terminology in shared infrastructure.

## 6. Plan and apply workflow

```text
change request
-> format/validate
-> static security and policy checks
-> speculative plan
-> human review
-> approval policy evaluation
-> environment-scoped apply identity
-> apply
-> post-apply validation
-> evidence capture
-> drift baseline update
```

Production apply requires an authorized operator. Changes involving deletion, public ingress, DNS cutover, production database connectivity, CA/PKI, region enablement or material cost increase require independent approval.

## 7. Policy-as-code gates

CI rejects:

- public PostgreSQL/database exposure;
- wildcard inbound rules without approved exception;
- unencrypted object storage or state;
- production resources without ownership tags;
- mutable production image tags;
- missing liveness/readiness checks;
- missing resource limits or autoscaling maximums;
- cross-environment secret references;
- direct connector database credentials;
- provider-root tokens injected into applications;
- automatic production migration at application startup;
- unprotected destroy operations;
- production DNS records without documented owner and rollback.

## 8. Existing-resource adoption

1. Inventory the resource and capture its current configuration.
2. Confirm ownership and environment.
3. Write the matching IaC definition.
4. Import without recreation.
5. Produce a no-op plan.
6. Record deviations and reconcile them through an approved change.
7. Enable drift monitoring.

No production resource is recreated merely to make adoption convenient.

## 9. Drift management

| Drift class | Example | Required action |
|---|---|---|
| Benign metadata | Provider-added timestamp | Ignore explicitly if safe |
| Authorized emergency | Manual scale increase during incident | Record incident, import/reconcile, review |
| Unauthorized configuration | Public access or changed firewall | Contain immediately and investigate |
| Secret/value drift | Credential rotated out of band | Update reference/version metadata, never store value |
| Destructive drift | Resource missing or replaced | Incident and recovery runbook |

## 10. App Platform to DOKS readiness

IaC must prepare, but not activate by default:

- immutable container deployment;
- externalized configuration;
- health endpoints;
- resource requests/limits;
- service accounts and network policy;
- namespaces/overlays;
- HPA and PodDisruptionBudget templates;
- ingress and certificate integration;
- rollback to App Platform until migration exit criteria pass.

## 11. Evidence package per apply

- change/approval ID;
- commit and plan digest;
- plan output;
- reviewer and applier identities;
- apply start/end and result;
- changed resource inventory;
- post-apply tests;
- cost-impact note;
- rollback or forward-fix status;
- drift baseline result.

## 12. Required values

- `[REQUIRED: Terraform version and provider-version policy]`
- `[REQUIRED: state backend, locking and backup design]`
- `[REQUIRED: production apply identities and approvers]`
- `[REQUIRED: provider tagging standard]`
- `[REQUIRED: deletion-protection matrix]`
- `[REQUIRED: cost-change approval threshold]`
- `[REQUIRED: drift scan cadence]`

## 13. Acceptance tests

- [ ] A clean development environment can be reconstructed from code.
- [ ] Production plan is reviewable without exposing secrets.
- [ ] Unauthorized public database configuration fails policy checks.
- [ ] Manual drift is detected.
- [ ] Existing resources can be imported without recreation.
- [ ] Destroy requires separate permission and approval.
- [ ] State backup restoration is rehearsed.
- [ ] DOKS staging can deploy the same service image without application rewrite.
