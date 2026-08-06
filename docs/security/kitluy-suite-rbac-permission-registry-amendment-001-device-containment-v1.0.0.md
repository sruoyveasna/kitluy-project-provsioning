# KitLuy Suite RBAC Permission Registry — Amendment 001 (device containment) v1.0.0

**Amends:** `docs/source/security/kitluy-suite-rbac-permission-registry-v1.0.0.csv`
(and its `.md` table form) — the imported v1.0.0 original is NEVER edited;
this amendment is additive, the data-dictionary amendment pattern.
**Authority:** WS-11-T005-P02 owner package (2026-08-06), §2 "Permission
identifiers" — owner-locked values recorded verbatim.
**Effect:** the canonical registry grows **107 → 109 keys**. The
`@kitluy/rbac` seed reproduces both amendment keys and asserts 109.

## 1. New keys (owner identifiers, verbatim)

| permission                 | permitted_action                                                                     | resource_type | available_scopes                                        | environment_restrictions | reauthentication  | approval_requirement | reason_requirement | primary_audit_event          |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------- | ------------------------------------------------------- | ------------------------ | ----------------- | -------------------- | ------------------ | ---------------------------- |
| `device.containment.apply` | Flag, restrict, suspend, or quarantine a managed device through governed containment | device        | tenant, digital_store, store_location, device, platform | all                      | Yes in pilot/prod | A3_FOUR_EYES         | Required           | `device.containment_applied` |
| `device.containment.clear` | Clear device containment through an authorized recovery disposition                  | device        | tenant, digital_store, store_location, device, platform | all                      | Yes in pilot/prod | A3_FOUR_EYES         | Required           | `device.containment_cleared` |

The A3 class matches what migration 0177 already ENFORCES structurally
(independent approver for suspension, quarantine, escalation and every
recovery; self-approval refused). The permission key gates WHO may ask; the
door's four-eyes stays regardless (frontend visibility is not authorization).

**Recorded, not resolved silently:** the owner identifiers use the singular
`device.` prefix while the v1.0.0 registry uses `devices.` for this domain.
The owner values are recorded verbatim per repository rule 9; harmonization,
if ever wanted, is a future owner decision.

## 2. Reconciliations — NO new key created (owner rule: no duplicate synonyms)

| Requested identifier            | Canonical existing equivalent(s)                                                               | Semantics                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `device.fleet.read`             | `devices.read` + `fleet.diagnostics.read` (both A0_READ)                                       | Reading device asset/assignment/certificate/health/version and health/failure summaries |
| `device.support_session.manage` | `support.consent_session.start` (A3 where impersonation/write) + `support.session.revoke` (A1) | Opening and revoking consent-bound support sessions — exactly the 0177 door semantics   |

This closes the T005-RC-01 gap for containment and records that fleet-read
and support-session management were never missing.
