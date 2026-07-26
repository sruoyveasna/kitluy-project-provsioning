# KitLuy Audit Event Registry

**Filename:** `kitluy-audit-event-registry-v1.0.0.md`  
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

This registry defines canonical immutable security, authorization, administrative, financial, custody, support, device, release, and operations evidence. Domain events may drive workflows; audit events explain who or what did what, why, under which authority, and with what result.

## 2. Common event envelope

```text
event_id uuid/uuidv7
event_key text
schema_version integer
occurred_at timestamptz
recorded_at timestamptz
business_date optional
actor_type human|service|connector|device|system
actor_id uuid/reference
impersonated_subject_id optional
service_identity_id optional
device_id optional
session_id optional
team_membership_id optional
role_assignment_ids[] normalized/reference
permission_key optional
resource_type
resource_id
resource_parent_refs
scope_snapshot_ref/hash
environment
policy_version optional
approval_request_id optional
reason_code optional
reason_text_ref optional
before_reference optional
after_reference optional
payload_hash optional
idempotency_key optional
correlation_id
causation_id optional
source_component
source_ip/network/security_context optional
result success|failure|denied|partial|queued|pending
error_code optional
classification
retention_policy_ref
integrity_chain/hash optional
```

Sensitive values are referenced, redacted, tokenized, or encrypted by data class. Raw secrets, private keys, full payment credentials, and unnecessary customer data are never stored in audit.

## 3. Registry

| Event key                            | Category      | Trigger                                        | Required event-specific fields                                         | Result values     | Retention class                 |
| ------------------------------------ | ------------- | ---------------------------------------------- | ---------------------------------------------------------------------- | ----------------- | ------------------------------- |
| `identity.authentication_succeeded`  | Security      | Human/service/device authenticated             | subject_id, identity_type, session_id, factor, device, IP/context      | Success           | Standard security retention     |
| `identity.authentication_failed`     | Security      | Authentication denied                          | claimed_subject, factor, reason_code, IP/context                       | Denied            | Security retention              |
| `identity.session_revoked`           | Security      | Session/token revocation                       | subject_id, session_ids, reason, actor                                 | Success/partial   | Security retention              |
| `identity.break_glass_activated`     | Critical      | Emergency access activated                     | actor, incident, permissions, scopes, environment, expiry, approver    | Success           | Highest retention               |
| `identity.break_glass_expired`       | Critical      | Emergency access expired/revoked               | session, actor, grants, review_due                                     | Success           | Highest retention               |
| `rbac.permission_registered`         | Governance    | Permission added/versioned/deprecated          | permission_key, old/new version, impact, approvers                     | Success           | Highest retention               |
| `rbac.role_template_versioned`       | Governance    | Role template version created                  | role_key, version, grant diff, owner                                   | Success           | Highest retention               |
| `rbac.assignment_changed`            | Governance    | Assignment granted/changed/revoked             | subject, role_version, permissions, scopes, environment, validity      | Success           | Highest retention               |
| `rbac.approval_policy_versioned`     | Governance    | Approval policy changed                        | policy, action/permission, old/new, approvers                          | Success           | Highest retention               |
| `rbac.authorization_allowed`         | Security      | Privileged authorization allowed               | subject, assignments, permission, target, scope, environment, policy   | Allowed           | Security retention              |
| `rbac.authorization_denied`          | Security      | Privileged authorization denied                | subject, permission, target, reason_code, correlation                  | Denied            | Security retention              |
| `rbac.access_review_completed`       | Governance    | Access review decision finalized               | campaign, reviewer, assignments, decisions, followups                  | Success           | Highest retention               |
| `approval.requested`                 | Critical      | Sensitive action approval requested            | requester, permission, target, payload_hash, policy, evidence          | Pending           | Highest retention               |
| `approval.decided`                   | Critical      | Independent approval decision                  | request, approver, decision, reason, evidence                          | Approved/rejected | Highest retention               |
| `approval.execution_attempted`       | Critical      | Approved action execution attempted            | request, token, executor, payload_hash, idempotency                    | Success/failure   | Highest retention               |
| `partner.verification_decided`       | Business      | Partner verification approved/rejected         | tenant, case, reviewer, decision, evidence                             | Approved/rejected | Business retention              |
| `partner.suspended`                  | Critical      | Partner restricted/suspended                   | tenant, actor, approver, reason, effective_at                          | Success           | Highest retention               |
| `digital_store.created`              | Business      | Digital Store created                          | tenant, digital_store, vertical, actor                                 | Success           | Business retention              |
| `digital_store.vertical_locked`      | Business      | Primary vertical locked                        | digital_store, old/new, actor, reason                                  | Success           | Business retention              |
| `digital_store.activated`            | Critical      | Digital Store activated                        | digital_store, readiness, requester, approver                          | Success           | Highest retention               |
| `location.created`                   | Business      | Store Location created                         | digital_store, location, timezone, actor                               | Success           | Business retention              |
| `location.go_live_requested`         | Critical      | Go-live package submitted                      | location, requester, evidence checksums                                | Pending           | Highest retention               |
| `location.go_live_approved`          | Critical      | Physical Store go-live approved                | location, requester, approver, policy, evidence                        | Success           | Highest retention               |
| `device.registered`                  | Security      | HET-managed hardware registered                | device, serials, hardware_manifest_hash, manufacturing_cert            | Success           | Device lifetime + archive       |
| `device.identity_issued`             | Security      | Operational device identity issued             | device, tenant, store, location, role, cert serial                     | Success           | Device lifetime + archive       |
| `device.certificate_rotated`         | Security      | Device operational certificate rotated         | device, old/new serial, reason, actor                                  | Success           | Device lifetime + archive       |
| `device.revoked`                     | Critical      | Device identity/cert/session revoked           | device, cert serials, reason, incident, approver                       | Success           | Highest retention               |
| `device.clone_detected`              | Critical      | Duplicate/cloned identity signal detected      | device, conflicting identity, attestation, network/context             | Alert             | Highest retention               |
| `device.remote_action_queued`        | Critical      | Remote device action queued                    | device, action, payload_hash, expiry, requester, approval              | Queued            | Highest retention               |
| `device.remote_action_completed`     | Critical      | Remote device action completed                 | device, action, result, evidence, correlation                          | Success/failure   | Highest retention               |
| `release.artifact_registered`        | Release       | Signed artifact registered                     | version, checksum, signature, compatibility, actor                     | Success           | Release lifetime                |
| `release.promoted_pilot`             | Critical      | Release promoted to Pilot                      | version, cohort_hash, requester, approver, evidence                    | Success           | Highest retention               |
| `release.promoted_stable`            | Critical      | Release promoted to Stable                     | version, target, requester, approver, evidence                         | Success           | Highest retention               |
| `release.rolled_back`                | Critical      | Release/cohort rolled back                     | version, cohort, reason, incident, approver                            | Success/partial   | Highest retention               |
| `configuration.published`            | Configuration | Immutable config published                     | config_version, targets, checksum, actor, approval                     | Success           | Configuration lifetime          |
| `configuration.rolled_back`          | Critical      | Prior compatible config republished            | from/to version, targets, reason, approver                             | Success           | Highest retention               |
| `support.consent_granted`            | Privacy       | Partner support consent granted                | tenant, grantor, scope, purpose, expiry, ticket                        | Success           | Privacy retention               |
| `support.consent_revoked`            | Privacy       | Support consent revoked/expired                | tenant, session, revoker, reason                                       | Success           | Privacy retention               |
| `support.impersonation_started`      | Critical      | Scoped support impersonation began             | session, support_actor, consent, scope, banner/session id              | Success           | Highest retention               |
| `support.resource_viewed`            | Privacy       | Sensitive resource viewed during support       | session, actor, resource, fields/class, purpose                        | Success           | Privacy retention               |
| `support.intervention_recorded`      | Critical      | Support command/mutation executed              | session, actor, permission, target, before/after refs, outcome         | Success/failure   | Highest retention               |
| `billing.invoice_adjustment_created` | Financial     | Compensating invoice adjustment created        | tenant, invoice, amount/currency, reason, actor, approval              | Success           | Financial retention             |
| `billing.invoice_marked_paid`        | Financial     | Manual settlement recorded                     | invoice, evidence, actor, approver                                     | Success           | Financial retention             |
| `payment.cash_recorded`              | Financial     | Cash payment recorded                          | transaction, payment, amount/currency, location, terminal, staff       | Success           | Financial retention             |
| `payment.khqr_requested`             | Financial     | KHQR request created                           | transaction, request, amount/currency, provider ref                    | Success           | Financial retention             |
| `payment.refund_requested`           | Financial     | Refund requested                               | payment, amount/currency, reason, requester                            | Pending           | Financial retention             |
| `payment.refund_approved`            | Financial     | Refund approved/rejected                       | refund, approver, decision, policy                                     | Approved/rejected | Financial retention             |
| `inventory.adjustment_requested`     | Inventory     | Inventory correction requested                 | item, location, delta, reason, actor                                   | Pending           | Inventory retention             |
| `inventory.adjustment_approved`      | Inventory     | Inventory correction approved                  | request, approver, result movement id                                  | Success           | Inventory retention             |
| `laundry.booking_created`            | Operational   | Laundry Booking created                        | booking, customer ref, location, T1/staff, totals refs                 | Success           | Operational retention           |
| `laundry.price_overridden`           | Critical      | Laundry price overridden                       | booking, line/rule, old/new, reason, actor                             | Success           | Financial/operational retention |
| `garment.ready_scanned_in`           | Custody       | T3 Ready custody event                         | booking, garment/tag, storage, T3/device/staff, exception              | Success           | Custody retention               |
| `garment.pickup_scanned_out`         | Custody       | T4 custody release                             | booking, garment/tag, collector verification, T4/device/staff          | Success           | Custody retention               |
| `laundry.booking_completed`          | Operational   | Booking completed                              | booking, payment/custody conditions, T4/staff                          | Success           | Operational retention           |
| `integration.credential_rotated`     | Security      | Connector credential reference rotated         | connector, old/new key version metadata, actor, approver               | Success           | Highest retention               |
| `integration.production_enabled`     | Critical      | Connector enabled in production                | connector, scopes, certification, requester, approver                  | Success           | Highest retention               |
| `webhook.replay_requested`           | Integration   | Webhook replay requested                       | delivery, event, actor, idempotency, reason                            | Queued            | Integration retention           |
| `job.dead_letter_changed`            | Operations    | Dead-letter job requeued/cancelled/quarantined | job, action, actor, reason, approval                                   | Success           | Operations retention            |
| `incident.declared`                  | Operations    | Platform/security incident declared            | incident, severity, impact, commander, scope                           | Open              | Incident retention              |
| `platform.safety_switch_changed`     | Critical      | Safety switch changed                          | switch, old/new, scope, incident/change, approver                      | Success           | Highest retention               |
| `backup.production_restore_started`  | Critical      | Production restore/failover started            | system, backup, target, incident, requester, approver                  | Started           | Highest retention               |
| `secret.accessed`                    | Security      | Privileged secret access/use issued            | secret_id/class, workload/actor, purpose, environment, lease           | Success           | Security retention              |
| `secret.rotated`                     | Security      | Secret/key version rotated                     | secret_id/class, old/new version, actor/workload, reason               | Success           | Highest retention               |
| `secret.compromise_declared`         | Critical      | Suspected secret/key compromise declared       | secret class/id, incident, affected systems, containment               | Open              | Highest retention               |
| `ai.policy_versioned`                | Governance    | AI policy/version changed                      | policy, old/new, evaluation evidence, approvers                        | Success           | Governance retention            |
| `ai.mcp_tool_enabled`                | Critical      | MCP tool enabled/changed                       | tool, mode read/write, scopes, policy, approvers                       | Success           | Highest retention               |
| `ai.tool_call_executed`              | Security      | AI/MCP tool call executed                      | request, service identity, tool, permission, target, approval, outcome | Success/failure   | Security retention              |
| `audit.export_requested`             | Audit         | Audit/evidence export requested                | scope, filters, actor, purpose, approval                               | Queued            | Audit retention                 |
| `audit.export_completed`             | Audit         | Checksummed evidence package completed         | export, checksum, object ref, retention, requester                     | Success/failure   | Audit retention                 |

## 4. Append-only and integrity rules

- Applications cannot update or delete finalized audit rows.
- Corrections append a new event referencing the original.
- Database roles that write business records do not automatically gain direct audit-table mutation rights.
- High-risk events use transactional outbox or equivalent atomic capture.
- Cloud and Store Hub events retain local sequence/idempotency and reconcile without duplicate business evidence.
- Export packages include filters, policy version, generation time, checksums, and source completeness/freshness.
- Clock differences are recorded; server receipt time never silently replaces device occurrence time.

## 5. Audit access

Audit access itself is audited. Views are scope-filtered and field-redacted. Support consent does not automatically grant audit/security access. Bulk or high-sensitivity exports require re-authentication and policy-derived approval.

## 6. Retention

Exact periods remain `[REQUIRED: approved legal, privacy, financial, security, and operational retention schedule]`. Retention classes must at minimum distinguish:

- highest/security-root evidence;
- financial and payment evidence;
- inventory/custody evidence;
- privacy/support evidence;
- authorization decisions;
- device lifetime evidence;
- operational telemetry;
- routine read-access events.

A retention job may archive or cryptographically seal records; it may not rewrite event content.

## 7. Contract tests

- Every registered sensitive permission has a matching primary audit event.
- Every allow/deny decision for privileged actions records stable reason and correlation ID.
- Self-approval attempts and replay attempts are auditable.
- Offline Store events reconcile exactly once while preserving original actor/device/time.
- Audit tables reject update/delete from application roles.
- Export checksum and row-count manifest verify.
- Redaction prevents secret/private-key/payment credential leakage.
- Historical authorization can be reconstructed after role/policy changes.
