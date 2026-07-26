# KitLuy Secrets Inventory — References Only

| Field        | Value                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| **Filename** | `kitluy-secrets-inventory-v1.0.0.md`                                     |
| **Version**  | `v1.0.0`                                                                 |
| **Date**     | `2026-07-26`                                                             |
| **Phase**    | Phase 1 — Laundry                                                        |
| **Owner**    | HET / KitLuy Suite Project Owner                                         |
| **Audience** | Security, infrastructure, release, database, service owners and auditors |
| **Status**   | Canonical operating target; not implementation evidence                  |
| **Timezone** | `Asia/Phnom_Penh`                                                        |

> **Purpose:** Create a complete non-secret registry of credentials, keys and tokens, with ownership, scope, rotation and incident controls.

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

## 1. Non-negotiable rule

This inventory contains references, ownership and lifecycle metadata only. It must never contain a secret value, private key, recovery code, token, password, connection string or certificate private material.

## 2. Required inventory fields

| Field           | Meaning                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------- |
| Secret ID       | Stable non-secret identifier                                                                  |
| Class           | Public config, backend, provider, payment, notification, AI, PKI, device, CI/CD or monitoring |
| Environment     | Exact environment scope                                                                       |
| Owner           | Accountable team/role                                                                         |
| Custodian       | System or operator maintaining the value                                                      |
| Store reference | Provider secret name/path/ID, never value                                                     |
| Consumers       | Named services/jobs/devices                                                                   |
| Privilege       | Read/use/rotate/revoke boundaries                                                             |
| Rotation        | Approved interval or event trigger                                                            |
| Expiry          | Expiry/renewal date if applicable                                                             |
| Recovery        | Escrow/recovery reference if allowed                                                          |
| Audit           | Source for access/change logs                                                                 |
| Incident action | Revoke/rotate/isolate steps                                                                   |

## 3. Canonical secret-reference registry

| Secret ID                   | Class                | Purpose                                               | Consumers                         | Store reference                   | Rotation trigger                        | Approval                      |
| --------------------------- | -------------------- | ----------------------------------------------------- | --------------------------------- | --------------------------------- | --------------------------------------- | ----------------------------- |
| `SEC-SUPA-PUBLIC-001`       | Public client config | Supabase public URL/anon configuration where approved | Web/mobile clients                | `[REQUIRED: reference]`           | Project/config change                   | Standard release              |
| `SEC-SUPA-SERVICE-001`      | Backend service      | Supabase service-role access                          | Approved server services only     | `[REQUIRED: reference]`           | Scheduled and exposure event            | Security + service owner      |
| `SEC-DB-POOL-001`           | Backend database     | Pooled database connection identity                   | API/worker class                  | `[REQUIRED: reference]`           | Scheduled, privilege or incident change | Database + security           |
| `SEC-DO-DEPLOY-001`         | DigitalOcean         | Deployment/API token                                  | CI/CD deployment identity         | `[REQUIRED: reference]`           | Short-lived/preferred; incident         | Release + infra               |
| `SEC-DO-SPACES-FILE-001`    | DigitalOcean         | File Service object access                            | File Service                      | `[REQUIRED: reference]`           | Scheduled/incident                      | File + security               |
| `SEC-DO-SPACES-RELEASE-001` | DigitalOcean         | Release artifact access                               | Release Service                   | `[REQUIRED: reference]`           | Scheduled/incident                      | Release + security            |
| `SEC-REGISTRY-PUSH-001`     | CI/CD                | Container registry push                               | Build pipeline                    | `[REQUIRED: reference]`           | Short-lived/preferred                   | Release operator              |
| `SEC-REGISTRY-PULL-001`     | Runtime              | Container registry pull                               | App Platform/DOKS                 | `[REQUIRED: reference]`           | Scheduled/incident                      | Infra                         |
| `SEC-ARTIFACT-SIGN-001`     | PKI/signing          | Sign cloud and edge artifacts                         | Release signing service           | `[REQUIRED: key reference]`       | Key ceremony/incident                   | Four-eyes security + release  |
| `SEC-CONFIG-SIGN-001`       | PKI/signing          | Sign configuration projections                        | Configuration service             | `[REQUIRED: key reference]`       | Key ceremony/incident                   | Four-eyes security + platform |
| `SEC-PKI-ROOT-001`          | PKI                  | Root CA reference                                     | Offline/key ceremony only         | `[REQUIRED: protected reference]` | Exceptional ceremony                    | Owner + security dual control |
| `SEC-PKI-INT-001`           | PKI                  | Operational intermediate CA                           | Issuance service                  | `[REQUIRED: protected reference]` | Policy/incident/expiry                  | Security dual control         |
| `SEC-HUB-MFG-001`           | Device               | Manufacturing station identity                        | HET manufacturing station         | `[REQUIRED: reference]`           | Station change/incident                 | Fleet + security              |
| `SEC-WEBHOOK-MASTER-001`    | Integration          | First-party webhook signing/derivation                | Webhook dispatcher                | `[REQUIRED: reference]`           | Scheduled/incident                      | Integration + security        |
| `SEC-KHQR-001`              | Payment              | KHQR provider credential reference                    | Payment adapter only              | `[REQUIRED: reference]`           | Provider policy/incident                | Finance/payment + security    |
| `SEC-PAYMENT-PROVIDER-001`  | Payment              | Other approved payment provider                       | Payment adapter only              | `[REQUIRED: reference]`           | Provider policy/incident                | Finance/payment + security    |
| `SEC-EMAIL-001`             | Notification         | Transactional email provider                          | Notification Service              | `[REQUIRED: reference]`           | Scheduled/incident                      | Notification owner            |
| `SEC-SMS-001`               | Notification         | SMS provider                                          | Notification Service              | `[REQUIRED: reference]`           | Scheduled/incident                      | Notification owner            |
| `SEC-TELEGRAM-001`          | Notification/channel | Telegram Bot/Mini App credential                      | Notification/Storefront connector | `[REQUIRED: reference]`           | Scheduled/incident                      | Integration owner             |
| `SEC-PUSH-001`              | Notification         | Mobile push provider credentials                      | Notification Service              | `[REQUIRED: reference]`           | Provider/incident                       | Mobile + notification         |
| `SEC-AI-PROVIDER-001`       | AI                   | Inference provider access                             | AI Gateway only                   | `[REQUIRED: reference]`           | Scheduled/cost/incident                 | AI + security                 |
| `SEC-RAG-EMBED-001`         | AI                   | Embedding provider access if separate                 | RAG Indexer                       | `[REQUIRED: reference]`           | Scheduled/cost/incident                 | AI + security                 |
| `SEC-MONITOR-INGEST-001`    | Monitoring           | Log/error ingest token                                | Services/agents                   | `[REQUIRED: reference]`           | Scheduled/incident                      | Observability                 |
| `SEC-UPTIME-001`            | Monitoring           | Uptime probe credential                               | Probe service                     | `[REQUIRED: reference]`           | Scheduled/incident                      | Observability                 |
| `SEC-STATUS-PUBLISH-001`    | Operations           | Status page publishing identity                       | Incident communication service    | `[REQUIRED: reference]`           | Scheduled/incident                      | Incident commander/ops        |
| `SEC-TERRAFORM-STATE-001`   | IaC                  | State backend access                                  | Terraform apply identity          | `[REQUIRED: reference]`           | Short-lived/preferred                   | Infra + security              |
| `SEC-BACKUP-RESTORE-001`    | Recovery             | Restricted restore identity                           | DR operators                      | `[REQUIRED: reference]`           | Per drill/incident                      | Four-eyes database + security |

Add one row for every real secret before deployment. Reuse of a secret across environments or unrelated services is prohibited unless explicitly approved and justified.

## 4. Secret classes and storage policy

| Class                       | Storage rule                                                      | Client exposure                           |
| --------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Public client configuration | Environment-scoped config store                                   | Only values explicitly designed as public |
| Backend/database            | Server secret store; least privilege                              | Never                                     |
| Provider deployment         | CI/infra secret system; short-lived preferred                     | Never                                     |
| Payment/notification/AI     | Owning service only                                               | Never                                     |
| PKI/signing                 | Strongest protected key system; non-exportable/HSM where approved | Never                                     |
| Store device private key    | Generated and retained on device secure storage                   | Never exported                            |
| Monitoring ingest           | Environment scoped; cannot mutate business data                   | Agent/server only                         |
| Recovery/escrow             | Restricted dual control                                           | Never routine use                         |

## 5. Lifecycle

```text
request
-> classify and approve
-> generate/import securely
-> bind least-privilege consumers
-> validate
-> monitor usage/expiry
-> rotate
-> revoke
-> archive metadata and evidence
```

## 6. Access and separation of duties

- Developers do not receive reusable production credentials for convenience.
- Human accounts and service identities are separate.
- Secret reading, rotation and consumer binding are distinct permissions where supported.
- Root/CA/signing/recovery materials require dual control.
- Break-glass retrieval is time-limited, alerted and retrospectively reviewed.
- Support operators never receive provider-root or database credentials.

## 7. Rotation policy

Rotation occurs on the approved schedule and immediately after:

- confirmed or suspected disclosure;
- staff/service access change;
- provider incident;
- signing-key compromise;
- certificate/private-key integrity failure;
- repository/log exposure;
- environment clone or boundary mistake;
- algorithm or provider deprecation.

Exact intervals remain `[REQUIRED: approved rotation matrix]`.

## 8. Secret incident procedure

1. Classify exposure and affected environments/consumers.
2. Revoke or disable the credential.
3. Isolate affected workloads and block unsafe access.
4. Issue replacement through approved workflow.
5. Redeploy/rebind consumers without exposing value.
6. Verify old credential rejection.
7. Review logs and business/audit impact.
8. Record timeline, root cause and remediation.
9. Scan repositories, artifacts and logs for secondary exposure.

## 9. CI and repository controls

- Secret scanning is mandatory on commits, pull requests and artifacts.
- `.env` files with real values are prohibited from version control.
- Build logs redact sensitive inputs.
- Container layers and SBOMs are inspected for accidental secret inclusion.
- Generated support bundles exclude secrets and private keys.
- A secret finding blocks release and starts incident handling.

## 10. Required values

- `[REQUIRED: approved secret manager(s)]`
- `[REQUIRED: secret naming/path convention]`
- `[REQUIRED: rotation intervals by class]`
- `[REQUIRED: dual-control key ceremonies]`
- `[REQUIRED: recovery/escrow design]`
- `[REQUIRED: secret-access log retention]`
- `[REQUIRED: break-glass approvers]`

## 11. Evidence checklist

- [ ] Every production secret has an inventory row and owner.
- [ ] No inventory row contains a value.
- [ ] No secret is shared across environments without approval.
- [ ] Client bundles contain no privileged credential.
- [ ] Rotation and revocation tests pass for representative classes.
- [ ] Signing and CA keys use approved protected custody.
- [ ] Secret scanning blocks a seeded test secret.
- [ ] Break-glass retrieval produces alerts and audit.
