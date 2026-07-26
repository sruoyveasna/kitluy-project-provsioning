# KitLuy Sensitive Action and Four-Eyes Policy

**Filename:** `kitluy-sensitive-action-and-four-eyes-policy-v1.0.0.md`  
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

This policy governs actions whose consequences cannot safely depend on one person, one UI click, one role name, or one long-lived credential.

## 2. Approval classes

| Class                  | Controls                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- |
| `A0_READ`              | Authentication, permission, scope, environment, data-class checks, audit as required.                          |
| `A1_STANDARD_MUTATION` | A0 plus idempotency, reason when required, before/after references, immutable audit.                           |
| `A2_REAUTH_MUTATION`   | A1 plus fresh re-authentication bound to actor/session/action class.                                           |
| `A3_FOUR_EYES`         | A2 plus independent approver, exact payload/scope/environment binding, short-lived single-use execution token. |
| `A4_OWNER_SECURITY`    | A3 plus restricted approver pool, MFA, incident/change ticket, immediate alerts, retrospective review.         |

Exact time values and thresholds remain `[REQUIRED: approved policy values]`.

## 3. Mandatory A3/A4 actions

| Action family                                                     | Minimum class | Required independence                                             |
| ----------------------------------------------------------------- | ------------- | ----------------------------------------------------------------- |
| Production migration execution                                    | A3            | Migration author cannot be sole approver/executor                 |
| Production migration rollback or emergency restore                | A4            | Independent security/operations owner                             |
| Stable release promotion or broad production rollout              | A3            | Rollout creator cannot approve own promotion                      |
| Platform-wide rollout rollback or safety switch                   | A4            | Restricted owner/security approver                                |
| Partner, Digital Store, or Location closure/decommission          | A4            | Requester and approver distinct                                   |
| Partner/Digital Store suspension                                  | A3            | Independent approver; emergency follow-up allowed only under A4   |
| Store Location go-live approval                                   | A3            | Evidence preparer cannot approve own package                      |
| Device wipe, secure erase, identity replacement, CA change        | A3/A4         | Fleet requester and security approver distinct                    |
| Active Store Hub revocation                                       | A3            | Independent security/fleet approver                               |
| Payment connector production enablement or key change             | A3            | Configurer cannot approve enablement                              |
| Manual settlement, material billing adjustment, high-value refund | A3            | Maker-checker separation                                          |
| RBAC permission registry or owner-level assignment change         | A4            | Restricted governance/security approver                           |
| Cross-Tenant support impersonation or write intervention          | A3            | Support requester and approver distinct; Partner consent required |
| Write-capable AI/MCP tool activation                              | A4            | Security + product/owner review                                   |
| Break-glass activation                                            | A4            | Named actor, incident, alerts, retrospective review               |
| Production secrets root/CA/release-signing key ceremony           | A4            | Multi-person custody and evidence                                 |

## 4. Request lifecycle

```text
DRAFT
 -> SUBMITTED
 -> POLICY_RESOLVED
 -> PENDING_APPROVAL
 -> APPROVED | REJECTED | EXPIRED | CANCELLED
 -> EXECUTION_TOKEN_ISSUED
 -> EXECUTING
 -> SUCCEEDED | FAILED | PARTIALLY_APPLIED
 -> REVIEWED / RECONCILED
```

No state may be skipped by client-side logic. `PARTIALLY_APPLIED` requires incident/reconciliation handling and does not permit token reuse.

## 5. Request contract

Every sensitive-action request records:

- requester identity and active assignment IDs;
- permission key;
- exact action and API/worker command;
- target resource IDs and resolved ancestry;
- environment;
- canonical payload hash;
- cohort/group snapshot hash where applicable;
- reason code and free-text reason;
- ticket/change/incident reference;
- evidence references and checksums;
- requested execution window;
- idempotency and correlation IDs;
- policy version and required approver pool/quorum.

## 6. Approval integrity

- Requester cannot approve their own request.
- Approver must possess the approval permission in the same target scope and environment.
- Approval does not grant the requester a missing execution permission.
- Approver sees human-readable impact plus canonical payload digest.
- Payload, target, environment, policy, or cohort change invalidates prior approval.
- Approval decisions are append-only; a changed decision is a new decision.
- Execution token is short-lived, single-purpose, single-use, and server-consumed.
- Execution re-evaluates current identity, grants, scope, re-auth, SoD, resource state, RLS, and safety constraints.
- Retry uses the original idempotency key and cannot create a second business effect.

## 7. Separation-of-duties matrix

| Conflict                                                      | Treatment                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Create invoice adjustment + approve settlement                | Block self-approval                                                       |
| Create rollout + approve Pilot/Stable promotion               | Block self-approval                                                       |
| Request support impersonation + approve session               | Block self-approval                                                       |
| Change RBAC + certify own access review                       | Block                                                                     |
| Register replacement device + approve old identity revocation | Require independent approver                                              |
| Write migration + approve production execution                | Require independent reviewer/approver                                     |
| Configure payment connector + production enable               | Require independent approver                                              |
| Prepare Store readiness + approve go-live                     | Require independent approver                                              |
| Generate signing key + independently verify ceremony          | Two-person custody                                                        |
| Declare incident + activate broad break-glass                 | A4 restricted approver or documented emergency path with immediate review |

## 8. Re-authentication

A2–A4 require a fresh approved authentication event. The policy must define:

- permitted factors;
- maximum age by environment and risk;
- phishing-resistant requirement for A4 where supported;
- session/device security conditions;
- treatment of suspected compromise;
- no reuse of a prior re-auth event after material context change.

`[REQUIRED: final MFA methods, re-authentication ages, and device posture requirements]`.

## 9. Break-glass

Break-glass:

- is limited to named humans, never a shared account;
- requires MFA and an incident reference;
- grants only the minimum predefined emergency permission set;
- has automatic expiry;
- triggers immediate owner/security alerts;
- cannot disable RLS, audit, finance integrity, custody integrity, or tenant isolation;
- records every allow/deny and action;
- requires retrospective independent review by `[REQUIRED: deadline]`;
- cannot be used for routine support, convenience, or delayed access reviews.

## 10. Offline/Store edge behavior

- Store Hub may authorize approved local operational actions offline using cached signed policy, active staff/device identity, terminal role, business/session context, and append-only local audit.
- Cloud-only A3/A4 actions do not become locally executable merely because the internet is unavailable.
- Local emergency overrides must be explicitly defined, narrow, reasoned, supervisor-authenticated, and synchronized as high-priority audit on reconnect.
- T3 and T4 remain separate modes even on shared hardware; T4 alone releases custody and completes pickup.

## 11. Data model

Required tables:

- `approval_policies`
- `approval_requests`
- `approval_request_targets`
- `approval_request_evidence`
- `approval_decisions`
- `execution_tokens`
- `execution_attempts`
- `separation_of_duties_rules`
- `break_glass_sessions`
- `retrospective_reviews`

## 12. Error catalogue

`APPROVAL_REQUIRED`, `APPROVAL_SELF_DENIED`, `APPROVER_SCOPE_DENIED`, `APPROVAL_EXPIRED`, `APPROVAL_REVOKED`, `APPROVAL_PAYLOAD_MISMATCH`, `APPROVAL_TARGET_CHANGED`, `APPROVAL_POLICY_CHANGED`, `EXECUTION_TOKEN_USED`, `EXECUTION_TOKEN_REPLAY`, `REAUTH_STALE`, `SOD_CONFLICT`, `BREAK_GLASS_NOT_ALLOWED`.

## 13. Tests

- Self-approval denied.
- Approver without scope/environment denied.
- Stale re-auth denied.
- Payload/target/cohort change invalidates approval.
- Expired/revoked/single-use token cannot execute.
- Retry is exactly-once in business effect.
- SoD conflicts block assignment and execution as configured.
- Break-glass expiry removes authority and creates review.
- Offline mode cannot bypass cloud-only A3/A4 controls.
- Historical request remains reconstructable after policy version changes.

## Appendix A — Open values

- `[REQUIRED: approval TTLs and execution windows]`
- `[REQUIRED: approver quorum and restricted pools]`
- `[REQUIRED: financial/refund/materiality thresholds]`
- `[REQUIRED: emergency override set and review deadlines]`
