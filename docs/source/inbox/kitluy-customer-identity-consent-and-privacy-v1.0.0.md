# KitLuy Customer Identity, Consent and Privacy Rules

**Filename:** `kitluy-customer-identity-consent-and-privacy-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This contract defines phone-first Phase 1 identity while preserving future multi-contact identity, explicit consent, purpose limitation, privacy request processing and secure support access.

**Scope boundary:** Customer identity, contact verification, duplicate resolution, consent, privacy, retention and support access. Exact legal retention periods remain owner/legal decisions.

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

### KBR-CUS-001 — Phone-first customer identity

| Required field            | Canonical specification                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-001                                                                                                                                                                            |
| Purpose                   | Use normalized phone as the primary Phase 1 customer contact identifier without assuming it is globally unique forever.                                                                |
| Inputs                    | Phone number; country context; verification evidence; name; channel/source; consent choices.                                                                                           |
| Preconditions             | Phone syntax valid; source permitted; verification requirement satisfied for claimed access.                                                                                           |
| Calculation or transition | Normalize to governed E.164-compatible representation, preserve entered/display form, and search identity links. Create or link customer according to confidence and duplicate policy. |
| Output                    | Customer/person ID, contact point, verification status and source trace.                                                                                                               |
| Permissions               | Customer may manage own verified identity; staff create/update within Store scope; merge restricted.                                                                                   |
| Audit event               | customer.created; customer_contact.added/verified.                                                                                                                                     |
| Offline behavior          | Hub can create provisional Store-scoped customer identity offline. Cloud reconciliation may suggest duplicates but never auto-merge based only on phone.                               |
| Error behavior            | Invalid or already-claimed verified contact follows recovery/duplicate workflow; do not expose another customer.                                                                       |
| Compensating action       | Correct contact with history; split/merge through governed identity operations.                                                                                                        |
| Canonical test vectors    | TV1: 012 345 678 normalized under KH policy. TV2: same phone unverified in another context → duplicate review, no auto-merge.                                                          |
| Owning service            | Customer Identity Service                                                                                                                                                              |
| Consuming products        | T1/T4, Storefront, Partner Portal/App, Commerce API, Notification                                                                                                                      |

### KBR-CUS-002 — Identity verification and access

| Required field            | Canonical specification                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-002                                                                                                                                                                           |
| Purpose                   | Prevent possession-free lookup from granting customer account or Booking access.                                                                                                      |
| Inputs                    | Contact point; OTP/challenge; session; requested resource; risk signals.                                                                                                              |
| Preconditions             | Challenge active and unexpired; attempt limit not exceeded; resource access policy known.                                                                                             |
| Calculation or transition | Verify challenge, bind session to customer/access grant, apply rate limits and record assurance level. Booking guest access uses scoped expiring token and anti-enumeration controls. |
| Output                    | Verified session/access grant or generic failure.                                                                                                                                     |
| Permissions               | Customer self-service; support access requires consent and separate operator scope.                                                                                                   |
| Audit event               | identity.challenge_issued/verified/failed; access_grant.created.                                                                                                                      |
| Offline behavior          | Staff can verify in person using approved local method; public OTP requires provider connectivity. Offline staff lookup does not create a customer-auth session.                      |
| Error behavior            | Generic errors; lock/rate-limit abuse; never reveal whether phone/order exists.                                                                                                       |
| Compensating action       | Revoke session/token; re-verify through approved recovery.                                                                                                                            |
| Canonical test vectors    | TV1: valid OTP → scoped session. TV2: wrong OTP repeated → locked/rate-limited. TV3: guessed Booking number → no disclosure.                                                          |
| Owning service            | KitLuy Identity Service                                                                                                                                                               |
| Consuming products        | B2B website, Storefront, Partner Portal, POS, Notification                                                                                                                            |

### KBR-CUS-003 — Customer duplicate detection and merge

| Required field            | Canonical specification                                                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-003                                                                                                                                                                                 |
| Purpose                   | Consolidate proven duplicates without losing source, consent, financial or Booking history.                                                                                                 |
| Inputs                    | Candidate customer IDs; matching evidence; conflicts; memberships; consents; balances; actor/approval.                                                                                      |
| Preconditions             | Same Tenant governance scope; actor has merge permission; preview generated; no prohibited legal/finance conflict.                                                                          |
| Calculation or transition | Create merge plan showing surviving identity, moved links and conflicts. Require confirmation/approval. Repoint references through governed mapping; retain tombstone/alias and full audit. |
| Output                    | Merged identity graph and conflict resolutions; originals remain traceable.                                                                                                                 |
| Permissions               | Restricted customer-data permission; high-risk merge may require four-eyes.                                                                                                                 |
| Audit event               | customer.merge_previewed/approved/completed.                                                                                                                                                |
| Offline behavior          | Hub may flag possible duplicates but authoritative cross-record merge is cloud-governed; Hub receives resulting identity map.                                                               |
| Error behavior            | Ambiguous identity, conflicting verified contacts or incompatible ownership blocks merge.                                                                                                   |
| Compensating action       | Unmerge only through governed reversal plan where technically/legal feasible; otherwise create corrected links and incident.                                                                |
| Canonical test vectors    | TV1: same verified phone + matching profile → merge after preview. TV2: conflicting verified owners → blocked.                                                                              |
| Owning service            | Customer Identity Resolution Service                                                                                                                                                        |
| Consuming products        | Partner Portal, Admin support, POS/Hub sync, reports                                                                                                                                        |

### KBR-CUS-004 — Consent capture and purpose limitation

| Required field            | Canonical specification                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-004                                                                                                                                                                  |
| Purpose                   | Ensure messages and data uses are tied to explicit purpose, channel and policy version.                                                                                      |
| Inputs                    | Customer; purpose; channel; grant/withdraw action; policy version; locale; evidence; source.                                                                                 |
| Preconditions             | Purpose/channel registered; notice available; actor/customer authorized.                                                                                                     |
| Calculation or transition | Store append-only consent event with state derived from latest valid grant/withdrawal per purpose/channel. Transactional messages are distinguished from optional marketing. |
| Output                    | Consent state, evidence and effective timestamp.                                                                                                                             |
| Permissions               | Customer self-service or authorized staff recording customer choice; no blanket implied marketing consent.                                                                   |
| Audit event               | consent.granted/withdrawn.                                                                                                                                                   |
| Offline behavior          | Hub caches consent needed for local capture and queues events. Notification service uses latest authoritative state and suppression list.                                    |
| Error behavior            | Missing or stale optional-marketing consent means do not send. Essential service message follows approved lawful/contractual purpose.                                        |
| Compensating action       | Stop future sends; record suppression; investigate and notify if unauthorized use occurred.                                                                                  |
| Canonical test vectors    | TV1: SMS pickup notification accepted under service purpose. TV2: marketing unchecked → no campaign. TV3: withdrawal → future marketing suppressed.                          |
| Owning service            | Consent and Privacy Service                                                                                                                                                  |
| Consuming products        | T1/T2, Storefront, Partner Portal, Notification, Marketing later phase                                                                                                       |

### KBR-CUS-005 — Customer data minimization and masking

| Required field            | Canonical specification                                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-005                                                                                                                                                 |
| Purpose                   | Collect and expose only data needed for the current workflow and role.                                                                                      |
| Inputs                    | Field classification; purpose; actor role; product surface; customer scope.                                                                                 |
| Preconditions             | Data classification registry active; purpose established.                                                                                                   |
| Calculation or transition | Apply allowlisted fields, masking and row/field scope. Do not copy sensitive identity into generic metadata, logs or analytics.                             |
| Output                    | Minimized response/export and access audit.                                                                                                                 |
| Permissions               | Explicit read permission and purpose; support requires active consent session where applicable.                                                             |
| Audit event               | customer_data.accessed/exported/masked.                                                                                                                     |
| Offline behavior          | Hub stores only operational fields required for offline service and protects local cache. Terminals do not retain unnecessary profiles after policy expiry. |
| Error behavior            | Unauthorized field request denied; logs redact secrets/PII.                                                                                                 |
| Compensating action       | Revoke access, purge prohibited copies under incident process, rotate tokens and notify as required.                                                        |
| Canonical test vectors    | TV1: cashier sees phone suffix and service history needed. TV2: readonly report excludes sensitive notes.                                                   |
| Owning service            | Privacy Enforcement Service                                                                                                                                 |
| Consuming products        | All apps, APIs, exports, support and AI/RAG                                                                                                                 |

### KBR-CUS-006 — Privacy request lifecycle

| Required field            | Canonical specification                                                                                                                                                                             |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-006                                                                                                                                                                                         |
| Purpose                   | Handle access, correction, deletion/restriction and consent requests without deleting legally required ledgers.                                                                                     |
| Inputs                    | Requester verification; request type; scope; jurisdiction/policy; customer records; retention holds.                                                                                                |
| Preconditions             | Identity verified to required assurance; request valid; retention/legal obligations evaluated.                                                                                                      |
| Calculation or transition | Create case, discover data, apply correction/restriction/export/deletion/anonymization by data class. Preserve required transaction/finance/audit records with minimization and access restriction. |
| Output                    | Case status, evidence package and applied actions/exceptions.                                                                                                                                       |
| Permissions               | Privacy operator; sensitive execution approved; customer views own case.                                                                                                                            |
| Audit event               | privacy_request.created/verified/completed/denied.                                                                                                                                                  |
| Offline behavior          | Cloud workflow required. Hub receives approved deletion/restriction commands for eligible caches and reports acknowledgement.                                                                       |
| Error behavior            | Cannot promise deletion where records must be retained; explain governed exception. Missing Hub acknowledgement remains open.                                                                       |
| Compensating action       | Retry purge, quarantine inaccessible device, or apply compensating access restriction.                                                                                                              |
| Canonical test vectors    | TV1: access request returns scoped export. TV2: deletion request retains immutable invoice but anonymizes optional profile fields.                                                                  |
| Owning service            | Privacy Operations Service                                                                                                                                                                          |
| Consuming products        | Admin Portal, Partner Portal, File Service, Hub fleet, support                                                                                                                                      |

### KBR-CUS-007 — Retention and deletion execution

| Required field            | Canonical specification                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-007                                                                                                                       |
| Purpose                   | Remove expired optional data while preserving governed records and evidence.                                                      |
| Inputs                    | Data class; created/last-used time; retention policy/version; holds; deletion target.                                             |
| Preconditions             | Policy approved; no active legal/business hold; target classified.                                                                |
| Calculation or transition | Schedule deletion/anonymization job, create manifest/checksum, execute across cloud/files/Hub caches and record acknowledgements. |
| Output                    | Retention job result, exceptions and audit manifest.                                                                              |
| Permissions               | Privacy/data governance operator; automatic jobs under approved policy.                                                           |
| Audit event               | privacy.retention_job_started/completed/exception.                                                                                |
| Offline behavior          | Hub applies signed cache-retention command when online; overdue/offline devices remain exception and may be revoked.              |
| Error behavior            | Partial deletion is never marked complete. File/object and metadata deletion must reconcile.                                      |
| Compensating action       | Retry, revoke device/access, restore mistakenly deleted data only if approved backup policy permits.                              |
| Canonical test vectors    | TV1: expired OTP records purged. TV2: active finance hold blocks transaction-data deletion.                                       |
| Owning service            | Privacy and Data Lifecycle Service                                                                                                |
| Consuming products        | Auth, Notification, Files, Hub, all data domains                                                                                  |

### KBR-CUS-008 — Support access consent

| Required field            | Canonical specification                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CUS-008                                                                                                                                              |
| Purpose                   | Permit HET support to inspect Partner/customer data only through explicit scoped temporary access.                                                       |
| Inputs                    | Support case; requester; Partner approver; scope; duration; environment; reason.                                                                         |
| Preconditions             | Case active; consent granted; support actor has role; scope and expiry defined.                                                                          |
| Calculation or transition | Issue temporary grant/session, display active-access banner, log all reads/actions, automatically expire or allow revocation. No raw credentials shared. |
| Output                    | Active/expired/revoked support session and complete audit trail.                                                                                         |
| Permissions               | Partner-authorized consent plus HET support permission; production sensitive actions retain normal approval.                                             |
| Audit event               | support_consent.requested/granted/revoked/expired; support_session.action.                                                                               |
| Offline behavior          | Remote support requires connectivity. Local technician access uses device-service procedure and physical/owner authorization, separately audited.        |
| Error behavior            | No consent/expired grant → deny. Scope escalation requires new consent.                                                                                  |
| Compensating action       | Revoke session, rotate affected credentials and review actions if misuse suspected.                                                                      |
| Canonical test vectors    | TV1: 2-hour read-only support grant expires automatically. TV2: support tries finance mutation → denied without separate approval.                       |
| Owning service            | Support Access and Authorization Service                                                                                                                 |
| Consuming products        | Admin Portal, Partner Portal, support tooling, audit                                                                                                     |

## 4. Identity and privacy invariants

- A phone number is a contact point and evidence signal, not sufficient proof to merge two people automatically.
- Consent is purpose- and channel-specific, versioned and withdrawable.
- Privacy deletion never means destructive removal of required finalized finance, payment, inventory or audit truth.
- AI/RAG receives only permission-filtered, purpose-appropriate and freshness-labeled customer data.

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID           | Required value                                                                                |
| ------------ | --------------------------------------------------------------------------------------------- |
| `CUS-OD-001` | Final privacy workflow depth, legal basis and statutory retention by data class/jurisdiction. |
| `CUS-OD-002` | OTP provider, expiry, rate-limit and recovery values.                                         |
| `CUS-OD-003` | Customer merge approval threshold and permitted unmerge scope.                                |
| `CUS-OD-004` | Transactional versus marketing notification purpose registry.                                 |

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
