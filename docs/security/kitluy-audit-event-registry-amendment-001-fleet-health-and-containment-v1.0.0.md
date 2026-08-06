# KitLuy Audit Event Registry — Amendment 001 (fleet health and containment) v1.0.0

**Amends:** `docs/source/security/kitluy-audit-event-registry-v1.0.0.csv`
(and its `.md` table form) — additively; the imported original is not edited.
**Authority:** WS-11-T005-P02 owner package (2026-08-06), §2 "Audit events".
**Grammar:** the registry's `<domain>.<snake_case_past_tense>` naming is kept;
the owner's semantic identifiers map onto canonical keys below, recorded
rather than duplicated.

## 1. Newly registered events

| event_key                          | category | trigger                                                          | required_fields                                                                             | result_values | retention_class             |
| ---------------------------------- | -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- | --------------------------- |
| `device.health_report_accepted`    | Security | Hub accepted an authenticated terminal heartbeat/health report   | device, hub, tenant, store, location, report_sequence, derived_state, correlation           | Success       | Standard security retention |
| `device.health_projection_updated` | Security | Cloud fleet-health projection advanced by an accepted Hub report | device, hub, projection_version, classification, observed_at, received_at, correlation      | Success       | Standard security retention |
| `device.containment_applied`       | Critical | Governed containment applied (flag/restrict/suspend/quarantine)  | device, containment_state, reason, actor, approver, evidence, command_ref, correlation      | Success       | Highest retention           |
| `device.containment_cleared`       | Critical | Governed recovery cleared containment with a runbook disposition | device, disposition, reason, actor, approver, restored_state, correlation                   | Success       | Highest retention           |
| `support.consent_session_started`  | Privacy  | Consent-bound support session opened (policy §3 class recorded)  | session, actor, approver, tenant, store, device, consent_class, ticket, consent_ref, expiry | Success       | Privacy retention           |
| `support.consent_session_revoked`  | Privacy  | Support session revoked before expiry                            | session, actor, reason, revoked_at                                                          | Success       | Privacy retention           |

`support.consent_session_started` / `support.consent_session_revoked` were
already REFERENCED by the RBAC registry's `primary_audit_event` column while
absent from the audit registry (the T005-RC-02 desync); registering them here
reconciles exactly that pair.

## 2. Owner-identifier mapping (recorded, no duplicates created)

| Owner semantic event               | Canonical registry key             |
| ---------------------------------- | ---------------------------------- |
| `device.health_report.accepted`    | `device.health_report_accepted`    |
| `device.health_projection.updated` | `device.health_projection_updated` |
| `device.support_session.started`   | `support.consent_session_started`  |
| `device.support_session.revoked`   | `support.consent_session_revoked`  |
| `device.containment.applied`       | `device.containment_applied`       |
| `device.containment.cleared`       | `device.containment_cleared`       |

The remaining four RBAC-referenced keys the audit registry still lacks
(`fleet.diagnostics_read`, `fleet.diagnostic_bundle_requested`,
`fleet.sync_triggered`, `support.evidence_viewed`) stay recorded in
T005-RC-02 — out of this amendment's owner-ruled scope.
