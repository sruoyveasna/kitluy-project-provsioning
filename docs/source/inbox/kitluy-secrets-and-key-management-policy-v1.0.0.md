# KitLuy Secrets and Key Management Policy

**Filename:** `kitluy-secrets-and-key-management-policy-v1.0.0.md`  
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

This policy governs generation, custody, storage, distribution, use, rotation, backup, revocation, and destruction of secrets and cryptographic keys across Supabase, DigitalOcean, CI/CD, connectors, AI, and Store edge.

## 2. Secret classes

| Class                   | Examples                                                   | Minimum treatment                                             |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `PUBLIC_CONFIG`         | Intended Supabase URL/anon key, public client IDs          | Environment-scoped; no privileged access                      |
| `BACKEND_SERVICE`       | Supabase service role, database/service credentials        | Server only, named workload, audited, rotated                 |
| `CLOUD_CONTROL`         | DigitalOcean API tokens, Spaces keys, registry credentials | Least privilege, project/environment scoped                   |
| `PAYMENT_PROVIDER`      | KHQR/payment API credentials, webhook secrets              | Restricted, dual control for production, reconciliation-aware |
| `NOTIFICATION_PROVIDER` | Telegram/SMS/email provider credentials                    | Service-specific, rate-limited, revocable                     |
| `AI_PROVIDER`           | Inference/model API keys                                   | AI Gateway only, cost and data policy controlled              |
| `PKI_ROOT`              | Root/intermediate CA private keys                          | Highest protection, offline/HSM/non-exportable where approved |
| `RELEASE_SIGNING`       | Artifact/configuration signing keys                        | Separate purpose, protected signer, A4 ceremony               |
| `DEVICE_PRIVATE`        | Manufacturing/operational device private keys              | Generated non-exportably on device; no raw backup             |
| `CI_CD`                 | Deploy/migration/signing credentials                       | Short-lived federation preferred; protected environment       |
| `MONITORING`            | DSN/ingest tokens                                          | Environment scoped; cannot mutate business data               |
| `USER_RECOVERY`         | MFA recovery/reset tokens                                  | Short-lived, hashed/encrypted, strict audit                   |
| `DATA_ENCRYPTION`       | App/file/backup encryption keys                            | Versioned, envelope encryption, controlled rotation           |

## 3. Storage locations

- Use approved managed secret stores/Vault capabilities for cloud workloads.
- Supabase Vault or equivalent only for approved server-side uses; never expose through client tables or JWT metadata.
- DigitalOcean secret injection is environment/service scoped.
- CI/CD uses protected environments and federated/short-lived identity where supported.
- Device private keys remain in TPM/secure element or protected device keystore where available.
- `.env` files are development-only under approved controls and never the production source of truth.
- No secret in Git, Markdown, tickets, screenshots, chat, logs, analytics, crash reports, or export files.

## 4. Generation and naming

- Generate with cryptographically secure systems.
- Use separate values per environment, service, provider account, and purpose.
- Secret metadata uses stable ID, class, owner, environment, purpose, system, version, created/rotated/expires, and status.
- Do not encode secret values in names.
- Human-known passwords are avoided for service-to-service authentication.

## 5. Access

- Least privilege and need-to-use, not need-to-know where managed injection is possible.
- Production secret access requires approved permission, reason, and audit; root/signing/CA access is A4.
- Applications receive secrets at runtime through approved injection, not database rows or build-time client bundling.
- Operators see metadata/status, not raw values, unless an approved ceremony absolutely requires it.
- Break-glass secret access is incident-bound and reviewed.

## 6. Rotation

| Trigger                   | Required action                                                      |
| ------------------------- | -------------------------------------------------------------------- |
| Scheduled policy interval | Issue new version, deploy, verify, revoke old                        |
| Staff/owner departure     | Rotate affected human-accessible credentials immediately             |
| Suspected exposure        | Declare incident, revoke/rotate, assess derived credentials and data |
| Provider/account change   | Rotate and revalidate callbacks/reconciliation                       |
| Environment clone/reset   | New secrets; never copy production into non-production               |
| Device/RMA replacement    | New device key/certificate; revoke old identity                      |
| CA/signing event          | Follow dedicated key ceremony and trust-bundle rollout               |

Exact intervals remain `[REQUIRED: approved class-by-class rotation schedule]`.

## 7. Cryptographic key hierarchy

- Separate CA, release-signing, configuration-signing, data-encryption, webhook-HMAC, and token-signing purposes.
- Root CA is offline; intermediates are scoped and revocable.
- Release signing key cannot issue device certificates.
- Webhook secrets are per provider/endpoint or derived with strong separation.
- Encryption uses envelope/key-version design so rotation does not require unsafe mass plaintext handling.
- Cryptographic algorithms and key sizes follow an approved current standard `[REQUIRED: security standard/version]`.

## 8. Logging and redaction

- Logs record secret ID/version and use outcome, never secret value.
- HTTP headers/body fields with credentials are redacted before logging.
- Error messages never return provider keys, database URLs with passwords, tokens, private keys, or full signatures.
- Support bundles and audit exports run automated secret scanning.

## 9. Backup and recovery

- Secret-store backups and key recovery follow provider and HET recovery controls.
- Root/CA/signing recovery uses multi-person custody and offline evidence.
- Device private keys are not backed up raw; device replacement uses new identity.
- Backup encryption keys are protected separately from backup objects.
- Recovery drills prove access without exposing raw material in reports.

## 10. Incident response

1. Declare `secret.compromise_declared`.
2. Classify secret, systems, environments, and blast radius.
3. Revoke/disable affected version.
4. Rotate dependent tokens, certificates, sessions, and webhook secrets.
5. Deploy and verify replacement.
6. Reconcile unauthorized activity using audit/provider evidence.
7. Notify owners/Partners/regulators when required.
8. Complete root-cause and control update.

## 11. Development and test

- Use synthetic credentials/providers where possible.
- No production secret or production customer data in developer machines or CI logs.
- Secret scanning runs pre-commit, CI, artifact, container, and release checks.
- Test fixtures use explicit fake values that cannot authenticate.

## 12. Tests

- Client bundles contain no privileged secrets.
- Logs/telemetry/support bundles redact known and entropy-detected secrets.
- Non-production credentials fail in production and vice versa.
- Revoked credential cannot authenticate.
- Rotation supports no-downtime transition then old-key denial.
- Service can access only its injected secret/purpose.
- Root/signing/CA operations require approved multi-person ceremony.
- Device private key is non-exportable or protected per certified profile.
- Backup restore does not expose keys in plaintext evidence.

## Appendix A — Open values

- `[REQUIRED: approved secret manager/Vault services by workload]`
- `[REQUIRED: cryptographic algorithm and key-size standard]`
- `[REQUIRED: rotation schedule and maximum overlap]`
- `[REQUIRED: key-custodian and recovery quorum]`
- `[REQUIRED: secret scanning tools and blocking thresholds]`
