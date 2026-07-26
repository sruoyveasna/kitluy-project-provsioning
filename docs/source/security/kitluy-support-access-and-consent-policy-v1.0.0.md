# KitLuy Support Access and Consent Policy

**Filename:** `kitluy-support-access-and-consent-policy-v1.0.0.md`  
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

Support access must solve customer problems without creating standing cross-Tenant access, invisible impersonation, or uncontrolled mutation authority.

## 2. Principles

- No unrestricted standing impersonation path.
- Partner consent is required before sensitive diagnostics, data access, impersonation, export, or intervention, except narrowly defined platform-safety/legal authority.
- Consent is specific to purpose, resources, data classes, actions, people/team, environment, and expiry.
- Read access and write intervention are separate grants.
- Every viewed resource, export, command, and outcome is audited.
- Partner can revoke consent immediately.
- Support cannot alter finalized finance, payment, inventory, custody, or audit truth outside approved compensating workflows.

## 3. Consent classes

| Class                      | Capability                                                                         | Default approval                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `C0_PUBLIC`                | Public status/help content                                                         | None                                                                                                                               |
| `C1_METADATA`              | Non-sensitive health, versions, last-seen, error codes                             | Ticket + support permission                                                                                                        |
| `C2_SENSITIVE_READ`        | Customer/Booking/config/log evidence necessary for case                            | Explicit Partner consent + re-auth                                                                                                 |
| `C3_IMPERSONATED_VIEW`     | Clearly marked view as Partner/Store user                                          | Explicit consent + A3 HET approval                                                                                                 |
| `C4_WRITE_INTERVENTION`    | Approved corrective command/mutation                                               | Explicit consent + action permission + policy-derived A2/A3                                                                        |
| `C5_PLATFORM_SAFETY_LEGAL` | Narrow intervention for fraud, abuse, legal, privacy, security, or platform safety | Authorized HET policy; consent may be bypassed only when legally/policy permitted, with A4 evidence and later notice where allowed |

## 4. Consent record

A consent grant records:

- Tenant/Partner and consenting authorized representative;
- verification of grantor authority;
- support ticket/incident;
- purpose;
- resources and scope;
- data classes/fields;
- allowed actions/read-only flag;
- allowed HET team/subjects;
- environment;
- start and expiry;
- notification preference;
- revocation channel;
- terms/version and evidence;
- approval requirement;
- audit/correlation IDs.

## 5. Session lifecycle

```text
REQUESTED -> PARTNER_REVIEW -> GRANTED | DENIED
GRANTED -> ACTIVE -> EXPIRED | REVOKED | COMPLETED
ACTIVE -> SUSPENDED (security issue) -> REVOKED or RESUMED with new approval
```

Expired or revoked consent terminates active support sessions and invalidates tokens. A new purpose or wider scope requires new consent.

## 6. Impersonation rules

- The UI displays an unavoidable support/impersonation banner.
- Support actor identity remains visible and is never replaced in audit.
- Session is bound to exact Tenant/Digital Store/Location/user-view scope.
- Support cannot change password, MFA, owner identity, RBAC, billing policy, device trust, or payment credentials merely through impersonation.
- Downloads/exports require separate permission and are logged.
- Copy/paste/field redaction follows data classification.
- T1–T4 operational actions are prohibited unless explicitly approved as C4 and product policy permits; support should diagnose rather than act as Store staff.

## 7. Remote device support

- Admin never directly reaches a Store LAN.
- Approved diagnostic/action request is queued in cloud and pulled by the trusted Store Hub.
- Diagnostic bundles are scoped, redacted, checksummed, expiring, and linked to consent.
- High-risk wipe/reset/reprovision requires A3 and device policy.
- Partner/Store receives status and intervention summary where policy permits.

## 8. Emergency/platform-safety authority

C5 may apply to fraud, abuse, legal request, privacy incident, active compromise, malware, dangerous connector behavior, or platform-wide safety. It requires:

- specific authorized permission;
- A4 policy and named human actor;
- incident/legal case;
- minimum scope and duration;
- immediate audit/alerts;
- independent review;
- Partner notice when lawful and safe;
- no use for routine support or commercial pressure.

## 9. Data handling

- Access only the minimum fields necessary.
- Raw secrets, private keys, full payment credentials, and unrelated customer records are never exposed.
- Evidence is stored through File Service with checksum, permissions, retention, and signed access.
- Screenshots/recordings require explicit policy and consent.
- Khmer/English consent wording must be approved; legal text remains `[REQUIRED]`.

## 10. Partner transparency

Partner Portal should show:

- active and historical consent sessions;
- purpose, scope, expiry, and HET team/actor;
- resources viewed and actions performed in a suitable intervention summary;
- revocation control;
- linked support ticket and final outcome;
- appeal/escalation path.

## 11. Tests

- No support impersonation without active scoped consent.
- Expiry/revocation terminates session immediately.
- Support actor cannot widen scope client-side.
- Read consent cannot authorize write action.
- Support cannot access sibling Tenant/Store/Location.
- Every view/export/command appears in intervention audit.
- High-risk device/finance/RBAC action requires its normal approval in addition to consent.
- C5 path requires incident/legal authority and retrospective review.
- Partner intervention summary matches immutable audit.

## Appendix A — Open values

- `[REQUIRED: approved Khmer/English consent and privacy wording]`
- `[REQUIRED: maximum session duration by class]`
- `[REQUIRED: data-field redaction matrix]`
- `[REQUIRED: Partner notification and summary SLA]`
- `[REQUIRED: legal request and platform-safety approver pool]`
