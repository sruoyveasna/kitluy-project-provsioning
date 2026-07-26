# KitLuy Resource Scope Model

**Filename:** `kitluy-resource-scope-model-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Canonical target contract; not implementation evidence  
**Primary phase:** Phase 1 — Laundry, designed as a shared cross-vertical foundation  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies required behavior. It does not prove that repositories, migrations, tests, deployments, certificates, key stores, or production controls exist. `IMPLEMENTED` requires verified evidence.

## Authority and source baseline

Authority order:

1. Current owner decisions and active KitLuy Project Instructions.
2. Applied migrations, verified code/tests, deployment records, and production evidence.
3. This security and authorization pack.
4. Current KitLuy Rebuild and Business Bibles and approved product specifications.
5. Approved handoffs and registries.
6. Evidence-based competitor analyses and classifications.
7. Competitor clone documents and superseded planning.

Primary source baseline:

- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — explicit permissions, scopes, environments, A0–A4 approvals, service-identity isolation, access review, support consent, audit, and three-layer enforcement.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — managed-device trust, manufacturing and operational certificates, secure boot, cloned-device defenses, Hub-first provisioning, replacement and recovery.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — Supabase/DigitalOcean responsibility split, secret classes, PKI custody, CI/CD, cloud/edge boundaries, and progressive infrastructure controls.
- Current KitLuy Project Instructions — Digital Store authority, Store Hub offline operation, append-only finance/payment/inventory/audit truth, human confirmation for sensitive actions, and no connector direct database access.

## Shared invariants

- Role names organize grants; they are never authoritative by themselves.
- Every privileged request resolves an explicit permission, target resource, resource scope, environment, identity type, validity window, and policy version.
- Missing context fails closed.
- Frontend visibility is not a security boundary. API/worker authorization and Supabase RLS/database rules are mandatory.
- Sensitive finance, permission, compliance, safety, release, migration, device, and production actions require authorized human confirmation according to policy.
- Finalized audit records are append-only; corrections create new events.
- Service accounts and device identities cannot inherit human team membership or interactive login rights.
- No browser, POS client, Storefront, connector, or ordinary operator receives Supabase service-role credentials, CA private keys, release signing keys, or other platform root secrets.
- Store Hub and T1–T4 remain operational offline after provisioning; offline continuity does not weaken identity, permission, custody, payment, or audit requirements.

## 1. Purpose

This document defines the only supported way to limit permissions to KitLuy resources. Scope is relational authorization truth, not a UI filter and not a client-provided SQL predicate.

## 2. Canonical resource hierarchy

```text
Platform
├── Environment
├── Region
├── Tenant / Partner Account
│   ├── Chain or organizational governance context (optional)
│   └── Digital Store (exactly one primary vertical)
│       ├── Store Location
│       │   ├── Store Hub
│       │   ├── Terminal / device
│       │   ├── Peripheral
│       │   ├── local operational records
│       │   └── custody / payment / inventory context
│       └── Digital channel / connector / storefront context
├── Platform service
├── Connector/provider
└── Release cohort / device group
```

A Tenant may own multiple Digital Stores. A Digital Store may own multiple Store Locations. Different business types require separate Digital Stores. A Store Location never becomes the parent of its Digital Store.

## 3. Scope types

| Scope key         | Binds to                                    | Typical use                                    | May inherit downward?                                          |
| ----------------- | ------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| `platform`        | Entire KitLuy control plane                 | Very limited HET governance/oversight          | Only when permission explicitly permits                        |
| `region`          | Approved operating or infrastructure region | Regional support, fleet, incident, rollout     | Yes, only for registered child resource types                  |
| `tenant`          | Partner backend account                     | Partner verification, billing, support         | To owned Digital Stores only when explicit                     |
| `digital_store`   | Digital control plane                       | Catalog/configuration/readiness/reporting      | To owned Locations/channels only when explicit                 |
| `store_location`  | Physical edge site                          | Store operation, Hub, T1–T4, peripherals       | To registered local children only                              |
| `chain`           | Approved multi-store governance boundary    | Chain standards and cross-Store read/reporting | Only to participating Digital Stores per relationship          |
| `device_group`    | Versioned group/cohort                      | Fleet action or rollout                        | To current group members, snapshot-bound for sensitive actions |
| `device`          | One registered Hub/terminal/peripheral      | Diagnosis, certificate, assignment, action     | No upward or sibling inheritance                               |
| `connector`       | One governed connector/provider instance    | Test, credential rotation, suspend             | No implicit access to tenant data outside declared scopes      |
| `service`         | One internal service/workload               | Operations and machine identity                | No tenant access unless separately granted                     |
| `file_object`     | One file/evidence object                    | Signed access and export                       | No inheritance                                                 |
| `support_session` | Consent-bound temporary support boundary    | Support read/intervention                      | Only explicit resources listed in consent                      |
| `release_cohort`  | Immutable rollout target snapshot           | Release promotion/rollback                     | Only snapshot members                                          |

## 4. Environment dimension

Environment is evaluated independently from resource scope:

`development`, `staging`, `pilot`, `production`, `disaster_recovery`, and `store_edge`.

- Non-production authority never implies production authority.
- Pilot uses production-grade controls for approved cohorts.
- Disaster-recovery grants are recovery-only and inactive outside an approved event.
- Store-edge authority is bound to a provisioned device, Location, terminal role, business date/session, and local policy version.

## 5. Assignment model

```text
Subject
  -> active identity status
  -> team membership (humans only; organizational context)
  -> role assignment or direct governed machine grant
  -> permission grant
  -> environment grant
  -> one or more inclusion scopes
  -> zero or more explicit exclusions
  -> validity window and review date
  -> contextual constraints
```

Required relational records:

- `role_assignments`
- `assignment_permissions` or versioned role-permission relation
- `assignment_scopes`
- `assignment_scope_exclusions`
- `environment_grants`
- `resource_relationships`
- `authorization_decisions`

## 6. Inheritance rules

1. Inheritance is denied by default.
2. A permission definition declares which parent-to-child paths are eligible.
3. An assignment declares whether eligible inheritance is enabled.
4. Exclusions are evaluated after inclusion and before approval.
5. Dynamic groups cannot be used for payload-bound A3/A4 execution unless their membership is snapshot-hashed.
6. A `digital_store` scope never includes sibling Digital Stores or the whole Tenant.
7. A `store_location` scope never includes sibling Locations or parent-level configuration authority.
8. A `device` scope never includes the Store Hub, Location, or other devices unless explicitly listed.
9. Platform-wide Admin scope cannot bypass product-boundary restrictions or Store operational role rules.
10. Chain scope applies only through approved relationship records; brand similarity or shared owner name is insufficient.

## 7. Authorization evaluation

The server evaluates in this order:

1. authenticate subject and identity type;
2. verify active human profile, service identity, connector identity, or device certificate;
3. resolve registered permission;
4. derive target resource server-side;
5. determine target environment and current resource relationships;
6. collect active assignments/grants;
7. apply environment match;
8. apply inclusion scope and explicit inheritance;
9. apply exclusions;
10. apply validity, access-review, dormant, and revocation state;
11. apply separation-of-duties and contextual constraints;
12. apply re-authentication, reason, and approval policy;
13. enforce RLS/database mutation constraints;
14. emit allow/deny decision and audit evidence.

All steps are fail-closed. The client cannot choose the authoritative Tenant, Digital Store, Location, or environment merely by sending IDs.

## 8. RLS and database enforcement

- Tenant-owned tables carry the necessary `tenant_id`, `digital_store_id`, and/or `store_location_id` relationships.
- RLS uses trusted session context or security-definer functions that resolve active assignments; user-editable JWT metadata is not authorization truth.
- Service-role database access is confined to named workloads and never substitutes for human permission/approval checks on human-triggered actions.
- Finalized finance, payment, inventory, custody, and audit tables expose append-only write paths through approved functions/services.
- Direct database grant editing is prohibited outside approved migrations or recovery procedures with A4 evidence.

## 9. Scope examples

| Scenario                            | Correct scope                                                      | Explicitly denied expansion                     |
| ----------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------- |
| Onboarding operator for one Partner | `tenant:<id>` with create/read onboarding permissions              | Other Tenants; production billing policy        |
| Support operator for one incident   | `support_session:<id>` listing one Location and device             | Standing Tenant-wide impersonation              |
| Fleet operator for Cambodia pilot   | `region:KH` + `release_cohort:<snapshot>`                          | All production devices outside cohort           |
| T1 cashier                          | `store_location:<id>` + `terminal_role:T1` + active staff session  | T3/T4 custody actions; sibling Locations        |
| T4 pickup operator                  | `store_location:<id>` + `terminal_role:T4`                         | Price policy, Partner settings, T3-only scan-in |
| Connector worker                    | `connector:<id>` + declared Tenant/Digital Store projection scopes | Direct database or unrelated customer records   |
| AI summarizer service               | `service:ai_gateway` + read-only approved source scopes            | Write tool, secrets, cross-tenant retrieval     |

## 10. Scope lifecycle

- Assignment creation: owner, justification, validity, environment, scope, review date.
- Scope broadening: impact preview and policy-derived approval.
- Scope narrowing/revocation: immediate for security events; invalidate sessions/tokens where required.
- Resource transfer: old assignments do not silently follow ownership changes.
- Resource deletion/archive: retain historical scope identifiers for audit reconstruction.
- Access review: certify exact permissions, scope, environment, owner, and ongoing need.

## 11. Required errors

| Code                                 | Meaning                                                   |
| ------------------------------------ | --------------------------------------------------------- |
| `AUTH_SCOPE_MISSING`                 | No active inclusion scope matches target.                 |
| `AUTH_SCOPE_EXCLUDED`                | Target is explicitly excluded.                            |
| `AUTH_SCOPE_INHERITANCE_DENIED`      | Requested parent-to-child inheritance is not allowed.     |
| `AUTH_ENVIRONMENT_DENIED`            | Assignment does not cover target environment.             |
| `AUTH_RESOURCE_RELATIONSHIP_INVALID` | Claimed resource ancestry/ownership is not authoritative. |
| `AUTH_SCOPE_SNAPSHOT_STALE`          | Sensitive group/cohort membership changed after approval. |

## 12. Contract tests

- Cross-Tenant, cross-Digital-Store, cross-Location, cross-device, and cross-environment negative tests.
- Parent scope inheritance disabled unless both permission and assignment enable it.
- Exclusion wins over inclusion.
- Client-modified IDs/metadata do not widen authority.
- RLS denies direct PostgREST access outside effective scope.
- Support consent scope expires and revokes immediately.
- Approval fails after target, payload, environment, or cohort snapshot changes.
- Archived resources remain reconstructable in audit without becoming actionable.

## Appendix A — Open values

- `[REQUIRED: regional taxonomy and ownership]`
- `[REQUIRED: permission-by-permission inheritance matrix approval]`
- `[REQUIRED: maximum allowed scope breadth by role/risk]`
- `[REQUIRED: scope cache TTL and revocation propagation SLO]`
