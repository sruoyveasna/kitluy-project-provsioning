# KitLuy Configuration Publication and Rollback Rules

**Filename:** `kitluy-configuration-publication-and-rollback-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document defines immutable versions, validation, approval, target publication, Hub staging/activation, acknowledgement truth, rollback, supersession and emergency local overrides.

**Scope boundary:** Versioned publication for catalog, pricing, availability, permissions, payments, documents, terminal profiles and other governed configuration. Software releases use the same safety principles but retain their separate release contract.

## 1. Governing principles

1. Current owner decisions and the active KitLuy Project Instructions override older planning.
2. Applied migrations, verified code/tests, deployment records and production evidence override target-state prose for implementation truth.
3. A Partner Account owns one or more Digital Stores; each Digital Store has exactly one primary vertical. Physical Store Locations are optional offline-capable edge environments.
4. Finalized transaction, payment, inventory, finance and audit records are append-only. Corrections use linked compensating records; destructive edits are prohibited.
5. Authoritative business data uses relational tables. JSON is limited to optional metadata and transport envelopes.
6. Every write is tenant-, Digital-Store-, Location-, actor- and device-scoped; versioned, idempotent, retry-safe and auditable.
7. The Store Hub is the local operational authority after provisioning. WAN failure must not stop approved local operations.
8. External channels and connectors never own KitLuy customer, inventory, payment, finance or audit truth.
9. Sensitive financial, permission, compliance or safety actions require authorized human confirmation and, where policy requires, four-eyes approval.
10. Khmer and English, KHR and USD, Asia/Phnom_Penh, KHQR and intermittent connectivity are first-class requirements.
11. Missing, stale, partial, estimated or unreconciled data must be labeled; it must never be presented as authoritative current truth.
12. No capability is `IMPLEMENTED` without repository, applied migration, test, deployment and required pilot/production evidence.

## 2. Canonical data conventions

| Concern        | Canonical rule                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| IDs            | UUID; offline-created aggregates use client-generated UUIDv7 when available.                                         |
| Idempotency    | Caller supplies a stable idempotency key. Replays return the original business result without duplicating effects.   |
| Money          | `amount_minor bigint` plus ISO-4217 currency code. KHR exponent is 0; USD exponent is 2. No floating-point money.    |
| Quantities     | `numeric(18,4)` plus unit-of-measure; weight and piece quantities are never silently interchanged.                   |
| Time           | Store UTC `timestamptz`; render in `Asia/Phnom_Penh`. Operational grouping uses explicit Location business date.     |
| Scope          | Every authoritative record resolves Tenant, Digital Store and, when physical, Store Location.                        |
| Truth envelope | Reads expose source, as-of time, completeness, sync freshness and reconciliation status.                             |
| Corrections    | Reverse or adjust with linked compensating entries; preserve the original.                                           |
| Audit          | Actor, role, device, source, reason, correlation ID, before/after references and approval evidence where applicable. |
| Offline        | Store Hub accepts only locally authorized operations and queues immutable outbox events for cloud synchronization.   |

## 3. Rule catalogue

### KBR-CFG-001 — Create immutable configuration version

| Required field            | Canonical specification                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-001                                                                                                    |
| Purpose                   | Represent every publishable configuration as a versioned artifact rather than mutable live rows.               |
| Inputs                    | Configuration domain; source draft; base version; schema version; author; checksum.                            |
| Preconditions             | Actor can edit domain; base version current; schema supported.                                                 |
| Calculation or transition | Validate draft structure and create immutable candidate version with content checksum and dependency manifest. |
| Output                    | DRAFT candidate version and validation report.                                                                 |
| Permissions               | Domain editor permission; no publication authority implied.                                                    |
| Audit event               | configuration.version_created.                                                                                 |
| Offline behavior          | Hub does not create cloud candidates except approved emergency local override domains.                         |
| Error behavior            | Schema/dependency validation failure leaves draft and creates report; no active effect.                        |
| Compensating action       | Correct draft or create a new candidate; never mutate signed/published artifact.                               |
| Canonical test vectors    | TV1: price-book candidate from active v4 → draft v5. TV2: checksum changes after signing → reject.             |
| Owning service            | Configuration Registry Service                                                                                 |
| Consuming products        | Partner/Chain/Admin portals, APIs, Hub deployment                                                              |

### KBR-CFG-002 — Validate compatibility and dependencies

| Required field            | Canonical specification                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-002                                                                                                                                                     |
| Purpose                   | Prevent configuration that clients/Hubs cannot safely interpret.                                                                                                |
| Inputs                    | Candidate; schema version; vertical; client/Hub minimum versions; referenced entities; effective interval.                                                      |
| Preconditions             | Candidate immutable and checksum valid.                                                                                                                         |
| Calculation or transition | Run semantic validation, reference integrity, vertical boundary, money/tax/permission safety and client compatibility checks. Produce blocking errors/warnings. |
| Output                    | VALIDATED or VALIDATION_FAILED state and machine-readable report.                                                                                               |
| Permissions               | Validator service; authorized reviewer may accept warnings but not bypass hard safety checks.                                                                   |
| Audit event               | configuration.validated/validation_failed.                                                                                                                      |
| Offline behavior          | Hub performs independent package signature/checksum/compatibility validation before staging.                                                                    |
| Error behavior            | Hard errors block approval/publish. Unknown schema fails closed.                                                                                                |
| Compensating action       | Create corrected candidate; do not patch artifact in place.                                                                                                     |
| Canonical test vectors    | TV1: Laundry package contains restaurant modifier rule → fail. TV2: minimum Hub version unmet → target excluded/blocked.                                        |
| Owning service            | Configuration Validation Service                                                                                                                                |
| Consuming products        | Admin/Partner/Chain portals, Hub, release system                                                                                                                |

### KBR-CFG-003 — Approval before publication

| Required field            | Canonical specification                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-003                                                                                                                                     |
| Purpose                   | Require governed review for financially or operationally sensitive configuration.                                                               |
| Inputs                    | Validated candidate; diff/impact preview; target scope; effective time; requester; approval policy.                                             |
| Preconditions             | Validation passed; impact preview current; requester authorized.                                                                                |
| Calculation or transition | Create approval request with immutable candidate checksum and target/effective-time snapshot. Approval is invalid if artifact or scope changes. |
| Output                    | APPROVED/REJECTED/EXPIRED candidate and approval evidence.                                                                                      |
| Permissions               | Publisher request permission; independent approver for sensitive domains according to policy.                                                   |
| Audit event               | configuration.approval_requested/approved/rejected.                                                                                             |
| Offline behavior          | Approval is cloud-governed. Emergency Hub-local overrides are limited to pre-approved domains such as service pause and synchronize later.      |
| Error behavior            | Missing/expired/self-approval where prohibited blocks publication.                                                                              |
| Compensating action       | Submit new approval request; no active configuration change occurred.                                                                           |
| Canonical test vectors    | TV1: price change approved by allowed manager. TV2: scope changed after approval → approval invalid.                                            |
| Owning service            | Approval and Configuration Services                                                                                                             |
| Consuming products        | Partner/Chain/Admin portals, Hub deployment, audit                                                                                              |

### KBR-CFG-004 — Publish to explicit targets

| Required field            | Canonical specification                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-004                                                                                                                                                      |
| Purpose                   | Distribute an approved version to named Digital Stores, Location groups, channels or devices with no hidden global blast radius.                                 |
| Inputs                    | Approved version; target set; rollout policy; effective time; idempotency key.                                                                                   |
| Preconditions             | Artifact approved/signed; targets resolve; compatibility checks passed.                                                                                          |
| Calculation or transition | Create publication/deployment record per target and enqueue signed package. State becomes PUBLISHING; each target independently reports staged/activated/failed. |
| Output                    | Publication ID, target results and outbox/job records.                                                                                                           |
| Permissions               | Authorized publisher within target scope; production publishing may require higher environment permission.                                                       |
| Audit event               | configuration.published; target.deployment_started.                                                                                                              |
| Offline behavior          | Hub downloads once, verifies and distributes to assigned terminals. Current active version remains until activation succeeds.                                    |
| Error behavior            | Partial target failure remains visible; publication is not globally ACTIVE until policy-defined acknowledgement criteria pass.                                   |
| Compensating action       | Retry failed targets idempotently or roll back/supersede; successful targets are not silently reverted unless commanded.                                         |
| Canonical test vectors    | TV1: 3 Locations, 2 acknowledge, 1 offline → PARTIAL, not complete.                                                                                              |
| Owning service            | Configuration Publication Service                                                                                                                                |
| Consuming products        | Partner/Chain/Admin portals, Store Hub, POS, Storefront/channels                                                                                                 |

### KBR-CFG-005 — Hub stage and atomic activation

| Required field            | Canonical specification                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-005                                                                                                                                                          |
| Purpose                   | Prevent partially written configuration from becoming operational.                                                                                                   |
| Inputs                    | Signed package; checksum; compatibility manifest; current active slot; target version.                                                                               |
| Preconditions             | Hub identity valid; package assigned; disk/health checks pass; signature and dependencies valid.                                                                     |
| Calculation or transition | Download to inactive slot, verify, run local migration/dry-run and health checks, then atomically switch active pointer. Keep prior compatible version for rollback. |
| Output                    | STAGED/ACTIVE/FAILED result and acknowledgement.                                                                                                                     |
| Permissions               | Hub system authority; no terminal self-selection of version.                                                                                                         |
| Audit event               | configuration.staged/activated/activation_failed.                                                                                                                    |
| Offline behavior          | This is the primary offline-safe activation path. Terminals receive config from Hub over LAN.                                                                        |
| Error behavior            | Any validation/health failure leaves prior active version untouched.                                                                                                 |
| Compensating action       | Rollback active pointer to prior slot; restore local projection from versioned package and migration rollback/forward plan.                                          |
| Canonical test vectors    | TV1: valid v5 activates atomically. TV2: corrupt checksum → reject, v4 stays active.                                                                                 |
| Owning service            | Store Hub Configuration Agent                                                                                                                                        |
| Consuming products        | Store Hub, T1–T4, POS Mobile, peripherals                                                                                                                            |

### KBR-CFG-006 — Acknowledgement and truth status

| Required field            | Canonical specification                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-006                                                                                                                                                         |
| Purpose                   | Separate publication intent from downstream application truth.                                                                                                      |
| Inputs                    | Publication; per-target package state; Hub/client acknowledgement; timestamp; active version.                                                                       |
| Preconditions             | Target records exist and acknowledgements signed/trusted.                                                                                                           |
| Calculation or transition | Derive PUBLISHED, ACKNOWLEDGED, PARTIAL_FAILURE, FAILED, ACTIVE or SUPERSEDED from target evidence. UI shows intended version and actual active version per target. |
| Output                    | Truth-labeled rollout status and lag/exception list.                                                                                                                |
| Permissions               | Scoped read; override/mark-complete prohibited without evidence.                                                                                                    |
| Audit event               | configuration.acknowledged/status_derived.                                                                                                                          |
| Offline behavior          | Offline Hub remains on last active version and reports when connected. Cloud never assumes an offline target updated.                                               |
| Error behavior            | Missing acknowledgement becomes pending/stale, not success.                                                                                                         |
| Compensating action       | Retry, diagnose, exclude target with approved scope change, or roll back.                                                                                           |
| Canonical test vectors    | TV1: cloud says publish v5, Hub active v4 → pending/stale.                                                                                                          |
| Owning service            | Configuration Status Service                                                                                                                                        |
| Consuming products        | Admin/Chain/Partner portals, support, monitoring                                                                                                                    |

### KBR-CFG-007 — Rollback activates prior compatible version

| Required field            | Canonical specification                                                                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-CFG-007                                                                                                                                                                                                  |
| Purpose                   | Recover quickly without rewriting transaction history or deleting failed versions.                                                                                                                           |
| Inputs                    | Publication/version; target set; rollback reason; prior version; actor/approval.                                                                                                                             |
| Preconditions             | Prior version retained and compatible; actor authorized; impact assessed.                                                                                                                                    |
| Calculation or transition | Create rollback publication that activates prior version for future operations. Preserve failed/newer version and all transactions created under it. Run any governed local data rollback/forward migration. |
| Output                    | ROLLED_BACK target states and active prior version.                                                                                                                                                          |
| Permissions               | Publisher plus approval for sensitive/production rollback.                                                                                                                                                   |
| Audit event               | configuration.rollback_requested/completed/failed.                                                                                                                                                           |
| Offline behavior          | Hub can autonomously A/B roll back after failed health check within signed policy, then report evidence.                                                                                                     |
| Error behavior            | No compatible prior version blocks automatic rollback and triggers maintenance mode/support.                                                                                                                 |
| Compensating action       | Deploy corrected forward version or restore approved recovery image/package.                                                                                                                                 |
| Canonical test vectors    | TV1: v5 health fails → Hub reactivates v4; v5 remains in history.                                                                                                                                            |
| Owning service            | Configuration Publication and Hub Agent                                                                                                                                                                      |
| Consuming products        | Admin/Partner/Chain portals, Hub, POS, Storefront                                                                                                                                                            |

### KBR-CFG-008 — Supersede rather than edit published version

| Required field            | Canonical specification                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CFG-008                                                                                                                                                |
| Purpose                   | Maintain clear version lineage and effective configuration history.                                                                                        |
| Inputs                    | Active/published version; new approved version; effective time; lineage.                                                                                   |
| Preconditions             | New version approved and published.                                                                                                                        |
| Calculation or transition | When new version becomes active, mark old version SUPERSEDED for future resolution while retaining it for historical snapshots, rollback window and audit. |
| Output                    | Version lineage and effective intervals.                                                                                                                   |
| Permissions               | System transition after activation; archival permission controlled.                                                                                        |
| Audit event               | configuration.superseded.                                                                                                                                  |
| Offline behavior          | Hub retains allowed prior versions according to disk/retention policy.                                                                                     |
| Error behavior            | Overlapping active effective intervals in same target/domain are rejected unless explicitly modeled as priority rules.                                     |
| Compensating action       | Correct publication timing or roll back; do not change old effective interval silently.                                                                    |
| Canonical test vectors    | TV1: v6 active at 09:00 → v5 superseded at 09:00.                                                                                                          |
| Owning service            | Configuration Registry Service                                                                                                                             |
| Consuming products        | Pricing, catalog, permissions, Hub, reports                                                                                                                |

### KBR-CFG-009 — Emergency local override

| Required field            | Canonical specification                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-CFG-009                                                                                                                                                                    |
| Purpose                   | Allow a safe bounded Store response during WAN outage without granting broad offline configuration authority.                                                                  |
| Inputs                    | Allowed override domain; Location; reason; expiry; actor/device; base cloud version.                                                                                           |
| Preconditions             | Domain pre-approved for local override; actor authorized; Hub healthy; scope Location-only.                                                                                    |
| Calculation or transition | Create signed local override layered over active package, with expiry and conflict metadata. Typical Phase 1 example: emergency service pause. Queue for cloud reconciliation. |
| Output                    | Active local override and later accepted/superseded/conflicted result.                                                                                                         |
| Permissions               | Store manager/supervisor for allowlisted action; no local tax, entitlement, role or provider-secret changes.                                                                   |
| Audit event               | configuration.local_override_created/expired/reconciled.                                                                                                                       |
| Offline behavior          | Designed for offline operation.                                                                                                                                                |
| Error behavior            | Non-allowlisted domain or missing expiry/reason rejected. Cloud conflict is surfaced for human reconciliation, never silently lost.                                            |
| Compensating action       | Expire, revoke or supersede override; existing transactions keep snapshots.                                                                                                    |
| Canonical test vectors    | TV1: WAN down, machine breaks, manager pauses service locally for 4h. TV2: cashier tries tax change → denied.                                                                  |
| Owning service            | Store Hub Configuration Agent and Cloud Reconciliation                                                                                                                         |
| Consuming products        | Partner Portal status, T1/Storefront availability, Admin support                                                                                                               |

## 4. Canonical publication state machine

```text
DRAFT -> VALIDATION_FAILED | VALIDATED
VALIDATED -> APPROVAL_REQUIRED -> APPROVED | REJECTED | EXPIRED
APPROVED -> PUBLISHING -> ACKNOWLEDGED/ACTIVE | PARTIAL_FAILURE | FAILED
ACTIVE -> SUPERSEDED | ROLLED_BACK
```

Publication intent, package delivery, staging, activation and acknowledgement are separate facts. The system must show both intended and actually active versions at each Location/channel/device.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                               |
| ------------ | ---------------------------------------------------------------------------- |
| `CFG-OD-001` | Final configuration-domain sensitivity and approval matrix.                  |
| `CFG-OD-002` | Acknowledgement quorum/completion policy for group publications.             |
| `CFG-OD-003` | Package retention count/period and Hub disk-pressure policy.                 |
| `CFG-OD-004` | Emergency local override allowlist, maximum duration and conflict ownership. |
| `CFG-OD-005` | Client/Hub compatibility window and forced-upgrade policy.                   |

## Verification and completion gate

- Every rule has schema, API/event, permission, audit, offline, error and compensating-action coverage.
- Canonical test vectors are represented in automated unit, contract, integration and Store-Hub reconnect tests.
- Cross-Tenant, cross-Digital-Store and cross-Location isolation tests pass.
- Duplicate delivery, stale configuration, partial sync and replay tests produce no duplicate business effect.
- Reconciliation proves subledgers and operational totals from authoritative entries.
- Documentation, migrations, seeds, monitoring, rollback, support and pilot evidence pass the applicable phase gate.
- No planning-only capability is labeled implemented.

## Version history

| Version | Date       | Change                                                      |
| ------- | ---------- | ----------------------------------------------------------- |
| v1.0.0  | 2026-07-26 | Initial canonical business-rule and state-machine contract. |
