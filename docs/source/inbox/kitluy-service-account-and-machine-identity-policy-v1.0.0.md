# KitLuy Service Account and Machine Identity Policy

**Filename:** `kitluy-service-account-and-machine-identity-policy-v1.0.0.md`  
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

This policy separates non-human authority from human accounts. A machine identity is a named workload or integration principal with explicit purpose, permissions, environment, owner, credentials, rotation, and audit.

## 2. Identity classes

| Class                          | Examples                                                      | Authentication                                                | Interactive UI |
| ------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------- | -------------- |
| `internal_service`             | API gateway, Sync Service, File Service, Notification Service | Workload identity, short-lived token, mTLS, or managed secret | Prohibited     |
| `background_worker`            | jobs, webhooks, exports, reconciliation                       | Workload identity/queue-bound token                           | Prohibited     |
| `supabase_privileged_workload` | narrowly approved server using service role                   | Server-only secret plus application policy                    | Prohibited     |
| `ci_cd`                        | build, deploy, migration runner, release signer               | Short-lived federated identity or protected credential        | Prohibited     |
| `connector_identity`           | payment, notification, channel adapter                        | OAuth client/mTLS/HMAC/API credential                         | Prohibited     |
| `ai_service`                   | AI Gateway, RAG indexer, MCP runtime                          | Workload identity and tool-specific grants                    | Prohibited     |
| `store_hub_device`             | Store Hub                                                     | Device certificate + signed assignment                        | Prohibited     |
| `terminal_device`              | T1–T4 terminal                                                | Device certificate, Hub-issued local session, role assignment | Prohibited     |
| `manufacturing_station`        | HET enrollment station                                        | Restricted station identity + operator approval               | Prohibited     |
| `break_glass_machine`          | None by default                                               | Not permitted as a substitute for named human break-glass     | Prohibited     |

## 3. Required record

Each `service_identity` record includes:

- stable identity ID and unique key;
- identity class and workload name;
- owning team and named human owner;
- business/technical purpose;
- allowed environments;
- explicit permission grants and resource scopes;
- credential type and non-secret metadata;
- creation, activation, rotation, expiry, disable, and revocation state;
- network/workload binding where available;
- data classification and maximum accessible sensitivity;
- review date and incident contact;
- approved deployment/service references.

## 4. Prohibited patterns

- Shared human/service accounts.
- Service credentials used for Admin Portal login.
- Human team membership inherited by a service.
- One credential reused across development, staging, pilot, and production.
- Supabase service-role key in browser/mobile/Electron bundles or ordinary operator environments.
- Root/cloud-owner credentials for routine workloads.
- Long-lived static credentials when a supported short-lived/federated method exists.
- Connector direct database access.
- AI service automatically using a write tool because it can read the same resource.
- Unowned or unreviewed service identities.

## 5. Authorization

Machine identities use the same permission registry and resource-scope model, with machine-specific eligibility. They do not use human role names as a shortcut.

A human-triggered sensitive action executed by a worker must carry:

- originating human actor and assignment;
- permission and approval request;
- payload hash;
- idempotency/correlation IDs;
- worker service identity;
- final action outcome.

The worker's authority is necessary but not sufficient; it cannot manufacture missing human approval.

## 6. Credential lifecycle

```text
REQUESTED -> APPROVED -> ISSUED -> ACTIVE -> ROTATING -> ACTIVE
                                     -> SUSPENDED -> REVOKED -> RETIRED
```

- Generation occurs in approved secret/PKI systems.
- Credential material is never stored in the service identity table.
- Rotation supports overlap only for the shortest safe window.
- Revocation is immediate for compromise, owner loss, decommission, or scope violation.
- Disabled identity cannot renew tokens or claim work.
- Rotation and use are audited.

Exact rotation periods remain `[REQUIRED: credential-class rotation schedule]`.

## 7. Supabase service role

- Restricted to named trusted backend workloads.
- Never exposed to clients.
- Not used for routine PostgREST requests when scoped user/service paths are available.
- Human-triggered sensitive mutations still require application authorization and approval.
- All uses are attributable to workload, deployment, environment, correlation, and originating actor where applicable.
- Separate keys/projects/environments; compromise triggers rotation and incident response.

## 8. Connector identities

- Receive only the scopes needed for declared projections/callbacks.
- No direct production database access.
- Webhooks require signature verification, timestamp/replay protection, deduplication, rate limits, and audit.
- OAuth refresh tokens/API keys are stored only in approved secret stores.
- Production enablement requires certification and A3 approval.

## 9. AI and MCP identities

- AI Gateway and MCP tool identities are separate.
- Read and write tool grants are separate.
- Retrieval is tenant/scope filtered before model access.
- Tool calls use explicit permission, target, approval where required, and audit.
- Model output never becomes authorization evidence.
- Write-capable tool enablement is A4 and human-confirmed per action policy.

## 10. Edge identities

Store Hub and terminals use device-certificate policy, not shared service secrets. Local service-to-service tokens are short-lived, Location-scoped, role-scoped, and rotated by the Hub. A terminal cannot claim another role merely by changing local configuration.

## 11. Access review

- Monthly: production machine identities, owners, credentials, permissions, and last use.
- Quarterly: full machine-identity and SoD review.
- Immediate: owner departure, workload decommission, secret exposure, unusual use, or environment transfer.
- Dormant identity threshold: `[REQUIRED]`; dormant identities suspend before deletion.

## 12. Tests

- Service identity cannot log into human UI.
- Credential from one environment is rejected in another.
- Disabled/revoked identity cannot obtain token or process jobs.
- Worker cannot execute A3 action without valid human approval context.
- Connector cannot query production database.
- AI read identity cannot invoke write tool.
- Browser/client builds contain no privileged credentials.
- Rotation overlap does not permit replay after old credential revocation.
- Every machine action is attributable to identity, workload, environment, permission, scope, and correlation.
