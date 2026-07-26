# KitLuy Phase 1 Threat Model

**Filename:** `kitluy-threat-model-phase1-v1.0.0.md`  
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

## 1. Scope

Phase 1 covers:

- B2B website and shared identity entry;
- Admin, Chain, Partner portals and Partner App;
- Storefront QR/Telegram pre-intake and queue;
- Management, Edge Operations, Commerce Store foundation, and Connector APIs;
- Supabase PostgreSQL/Auth/RLS/Realtime/metadata/audit;
- DigitalOcean apps, workers, Spaces, AI/MCP/RAG, release repository;
- Store Hub, T1–T4 terminals, local PostgreSQL, printers/scanners/scales/displays;
- cash/KHQR and payment/provider callbacks;
- device manufacturing, provisioning, updates, support, and recovery.

## 2. Security objectives

1. Tenant, Digital Store, Location, user, device, environment, and connector isolation.
2. Authoritative transaction/payment/inventory/custody/audit integrity.
3. Store offline availability without weakening trust or audit.
4. Least privilege and independent approval for high-risk actions.
5. Confidentiality of customer, business, credential, support, and security data.
6. Traceability and non-repudiation of privileged and operational actions.
7. Recoverability from cloud, device, credential, release, and data failures.

## 3. Primary assets

- human identities, sessions, MFA, assignments, permissions, scopes, approvals;
- Tenant/Digital Store/Location configuration;
- customer identity/consent and Laundry Bookings;
- payments, refunds, voids, finance subledger and reconciliation;
- inventory/consumables and garment custody;
- Store Hub local database and sync outbox;
- device certificates, CA, release/config signing keys;
- provider/connector/API secrets;
- files/evidence/exports;
- audit and authorization decisions;
- releases, configuration publications, backups;
- AI/RAG sources and MCP tool authority.

## 4. Trust boundaries

```text
Public internet
  -> Public web / Storefront
  -> API gateways (Management / Commerce / Edge / Connector)
  -> Supabase and DigitalOcean internal services
  -> provider/connector boundaries

HET operator boundary
  -> Admin Portal
  -> approval/security operations

Partner/Chain boundary
  -> Partner/Chain portals and mobile app

Store boundary
  -> Store Hub (local authority)
  -> T1–T4 and peripherals over LAN
  -> asynchronous cloud sync

Manufacturing/repair boundary
  -> HET enrollment station
  -> device hardware and PKI
```

## 5. Threat actors

- unauthenticated internet attacker;
- malicious or compromised Partner/Store user;
- malicious or compromised HET operator;
- former employee with residual access;
- compromised service account/CI runner;
- malicious or compromised connector/provider;
- LAN attacker or rogue device;
- physical thief/repair-chain attacker;
- malware/supply-chain attacker;
- abusive AI prompt/user;
- accidental operator/developer error.

## 6. Threat register

| ID     | Threat                                 | Boundary                  | Attack scenario                                             | STRIDE/objective                 | Inherent risk | Required controls                                                                           | Residual status                    |
| ------ | -------------------------------------- | ------------------------- | ----------------------------------------------------------- | -------------------------------- | ------------- | ------------------------------------------------------------------------------------------- | ---------------------------------- |
| TM-001 | Cross-Tenant data access               | Cloud API/RLS             | Malicious or compromised user alters Tenant/Store IDs       | Confidentiality                  | Critical      | Server-derived target, explicit scope, RLS, negative tests, authorization audit             | Open until implementation evidence |
| TM-002 | Role-name or UI bypass                 | Admin/portals             | User invokes hidden endpoint directly                       | Elevation of privilege           | High          | Permission registry, API authorization, RLS, no role-name authority                         | Open                               |
| TM-003 | Client JWT metadata escalation         | Supabase/Auth             | User edits app metadata or stale token claims               | Elevation of privilege           | Critical      | Trusted server assignment resolution, no user-editable metadata authority                   | Open                               |
| TM-004 | Approval replay/payload swap           | Sensitive actions         | Attacker reuses token or changes target/payload             | Tampering/Elevation              | Critical      | Payload-bound single-use token, TTL, re-evaluation, idempotency                             | Open                               |
| TM-005 | Self-approval/SoD failure              | Admin operations          | Requester approves own migration/release/settlement         | Elevation/Repudiation            | High          | Independent approver, SoD rules, immutable decisions                                        | Open                               |
| TM-006 | Dormant/departed account abuse         | Human identity            | Old employee/session remains active                         | Spoofing/Elevation               | High          | Immediate revocation, dormant controls, access reviews, session invalidation                | Open                               |
| TM-007 | Service-role key leakage               | Backend/clients           | Privileged key embedded in browser/mobile/log               | Confidentiality/Elevation        | Critical      | Server-only secret store, scanning, client artifact test, rotation                          | Open                               |
| TM-008 | Connector direct DB or overbroad scope | Integrations              | Third party reads/writes authoritative database             | Confidentiality/Tampering        | Critical      | Connector API only, scoped OAuth/HMAC/mTLS, no DB network/access                            | Open                               |
| TM-009 | Webhook forgery/replay                 | Connector API             | Forged or replayed provider callback                        | Spoofing/Tampering               | High          | Signature, timestamp, nonce/dedupe, idempotency, rate limits                                | Open                               |
| TM-010 | AI prompt/tool privilege escalation    | AI/MCP                    | Prompt causes cross-tenant retrieval or write action        | Elevation/Information disclosure | Critical      | Permission-scoped retrieval, separate tool identity, human confirmation, audit              | Open                               |
| TM-011 | Support impersonation abuse            | Support                   | HET actor accesses Partner without consent                  | Privacy/Elevation                | Critical      | Consent session, A3, banner, scope, intervention audit, revocation                          | Open                               |
| TM-012 | Audit tampering or omission            | Audit pipeline            | Actor modifies/deletes evidence or mutation lacks audit     | Repudiation/Tampering            | Critical      | Append-only tables, outbox, restricted roles, checksummed exports                           | Open                               |
| TM-013 | Store Hub cloned image/device          | Edge                      | Copied OS/NVMe used as trusted bridge                       | Spoofing/Elevation               | Critical      | Manufacturing identity, non-exportable key, operational cert, manifest, duplicate detection | Open                               |
| TM-014 | Provisioning code replay               | Provisioning              | Code reused/wrong Store/device                              | Spoofing                         | High          | Short TTL, one-time claim, manufacturing auth, target binding, audit                        | Open                               |
| TM-015 | Terminal role tampering                | Edge terminal             | Local file change turns T2/T3 into T4                       | Elevation                        | Critical      | Signed assignment, cert-bound role, Hub policy, separate app modes/audit                    | Open                               |
| TM-016 | Revoked device remains trusted offline | Edge trust                | Lost device uses cached trust indefinitely                  | Spoofing                         | High          | Trust-bundle expiry, revocation propagation, restricted mode, incident process              | Open                               |
| TM-017 | Unsigned/malicious update              | Release chain             | Artifact/config replaced in transit/repository              | Tampering                        | Critical      | Signing, checksum, compatibility, A/B rollback, channel approval                            | Open                               |
| TM-018 | Malicious migration/data loss          | Database                  | Migration overwrites finalized truth or cross-tenant rows   | Tampering/Availability           | Critical      | Dry run, A3, backups, additive migrations, invariants, rollback/compensation                | Open                               |
| TM-019 | Offline duplicate transaction          | Store sync                | Retry creates duplicate Booking/payment/inventory effect    | Tampering                        | High          | UUID/idempotency/outbox, append-only ledgers, reconciliation                                | Open                               |
| TM-020 | Offline authorization stale            | Store edge                | Revoked staff uses cached session during outage             | Elevation                        | High          | Offline lease/expiry, local revocation cache, supervisor policy, post-sync review           | Open                               |
| TM-021 | Payment callback mismatch              | Payments                  | False success or wrong amount/currency/provider reference   | Tampering                        | Critical      | Signed callback, amount/currency binding, reconciliation, no UI-only truth                  | Open                               |
| TM-022 | Secret leakage through logs/exports    | All                       | Credentials appear in diagnostics, audit, support bundle    | Information disclosure           | Critical      | Redaction, scanning, metadata-only audit, restricted exports                                | Open                               |
| TM-023 | Object storage exposure                | Files/Spaces              | Public URL or broken metadata exposes documents             | Information disclosure           | High          | Private buckets, signed URLs, metadata/RLS, TTL, checksum, access audit                     | Open                               |
| TM-024 | Denial of service/cloud outage         | Cloud                     | API/queue/provider outage halts operations                  | Availability                     | High          | Store Hub offline authority, queues, backoff, health, DR/scaling                            | Open                               |
| TM-025 | LAN attacker/MITM                      | Store network             | Rogue device intercepts or impersonates Hub/terminal        | Spoofing/Disclosure              | High          | mTLS/cert pairing, firewall, least services, no trust by IP                                 | Open                               |
| TM-026 | Physical theft/tamper                  | Edge hardware             | Attacker steals Hub/terminal/NVMe                           | Disclosure/Elevation             | High          | Disk encryption where supported, key protection, revocation, no raw secret backup           | Open                               |
| TM-027 | Time/clock manipulation                | Edge/API                  | Clock changed to extend cert/session or alter business date | Tampering                        | Medium/High   | Trusted time sync, monotonic counters, server receipt, anomaly alerts                       | Open                               |
| TM-028 | Mass export/data exfiltration          | Portals/API               | Authorized user abuses broad export                         | Disclosure                       | High          | Scoped export permission, re-auth/A3 by sensitivity, rate/fair-use, audit                   | Open                               |
| TM-029 | Finalized record destructive edit      | Finance/inventory/custody | Operator/API overwrites historical truth                    | Tampering/Repudiation            | Critical      | Append-only ledgers, compensating events, DB constraints, restricted functions              | Open                               |
| TM-030 | Break-glass abuse                      | Admin                     | Emergency access used for routine or malicious changes      | Elevation/Repudiation            | Critical      | Named humans, MFA, incident, expiry, alerts, retrospective review                           | Open                               |

## 7. Abuse cases

### 7.1 HET operator tries to become `platform_owner`

Denied unless current permission, scope, environment, A4 approval, MFA, assignment impact preview, final-owner invariant, and immutable audit all pass.

### 7.2 Stolen Store Hub image is booted elsewhere

Copied image lacks valid non-exportable device key/manufacturing identity or conflicts with active operational certificate; session is quarantined and clone incident created.

### 7.3 Support agent opens customer Booking without consent

API denies because no active consent session scope; denial is audited. Emergency C5 requires separate A4 incident/legal authority.

### 7.4 AI summary is instructed to refund a customer

Model output has no authority. Write tool is unavailable unless separately enabled; refund requires registered permission, human actor, scope, re-auth, reason, and approval policy.

### 7.5 Offline terminal replays payment/Booking after reconnect

Idempotency and append-only ingest deduplicate; discrepancies enter reconciliation rather than overwriting truth.

## 8. Security assumptions

Assumptions must be tested or tracked:

- Supabase and DigitalOcean account security/MFA are configured.
- Production network and secret stores are not accessible to client apps.
- Certified reference hardware supports the selected key protection/secure boot design.
- Store staff identity/PIN/session processes are implemented.
- Payment/KHQR provider contracts support signed/reconcilable callbacks.
- Backups and restore procedures exist and are tested.

Unknown assumptions remain risks, not facts.

## 9. Risk acceptance

- Critical/high residual risks require owner/security decision before pilot or go-live.
- Acceptance records include scope, rationale, compensating controls, expiry, owner, and review date.
- A planning document cannot mark a risk closed without implementation/test/deployment evidence.
- Deferred features remain disabled; their absence is not accepted risk when code paths still expose them.

## 10. Review triggers

Review this threat model after:

- new vertical, product, API, connector, payment provider, or AI write tool;
- RBAC/scope/approval policy change;
- Store Hub hardware/PKI/update change;
- major infrastructure migration or Kubernetes activation;
- security incident or material near miss;
- new data class/legal requirement;
- Phase gate G1, G3, G4, and G5.

## Appendix A — Open security decisions

- `[REQUIRED: approved MFA/session/re-authentication policy]`
- `[REQUIRED: PKI/secure boot/disk encryption profile]`
- `[REQUIRED: security logging and retention periods]`
- `[REQUIRED: vulnerability severity SLA and risk acceptance authority]`
- `[REQUIRED: payment/provider security contracts]`
