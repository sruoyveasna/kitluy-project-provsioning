# KitLuy Core Business Rules

**Filename:** `kitluy-core-business-rules-v1.0.0.md`

## 0. Document status and authority

- **Version:** v1.0.0
- **Date:** 2026-07-26
- **Owner:** HET / KitLuy Suite Project Owner
- **Status:** Canonical target contract; not implementation evidence
- **Primary phase:** Phase 1 — Laundry, with neutral rules designed for confirmed later reuse
- **Authority order:** current owner decisions and Project Instructions → applied migrations/verified code/tests/production evidence → this contract → current Rebuild and Business Bibles → approved handoffs → evidence-based analyses → competitor clone references → superseded planning.

> **Rebuild Test:** A qualified engineer must be able to implement and verify these rules from this document, the canonical schema, API/event contracts, migrations, permission matrix, test registry and deployment instructions without relying on undocumented knowledge.

## Purpose and scope

This document is the canonical cross-product rule contract for authority, isolation, immutability, idempotency, truth labeling, sensitive-action control, connector boundaries, concurrency and safe entitlement behavior.

**Scope boundary:** Neutral shared rules only. Vertical terminology and workflows belong in vertical contracts; Core must not hardcode Laundry semantics.

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

### KBR-CORE-001 — Scope resolution and isolation

| Required field            | Canonical specification                                                                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-001                                                                                                                                                   |
| Purpose                   | Ensure every operation is executed inside one authorized Tenant, Digital Store and optional Store Location.                                                    |
| Inputs                    | Actor identity; role grants; tenant_id; digital_store_id; optional location_id; device identity; environment.                                                  |
| Preconditions             | Authenticated actor or trusted device; active membership; requested resource exists.                                                                           |
| Calculation or transition | Resolve scope from trusted server-side membership and device assignment. Reject client-supplied scope that exceeds grants.                                     |
| Output                    | A canonical scope context attached to the transaction, event, audit record and downstream calls.                                                               |
| Permissions               | Explicit permission plus resource, environment and device scope; service role only through approved service boundary.                                          |
| Audit event               | core.scope_resolved or security.scope_denied.                                                                                                                  |
| Offline behavior          | Store Hub uses provisioned certificate-bound Tenant/Digital Store/Location assignment and cached grants; it cannot broaden scope offline.                      |
| Error behavior            | Fail closed with non-enumerating authorization error; do not reveal whether foreign resources exist.                                                           |
| Compensating action       | None for rejected requests. If a bad grant was used, revoke it, quarantine effects and run scoped reconciliation.                                              |
| Canonical test vectors    | TV1: Partner A requests Store A → allowed. TV2: Partner A requests Store B → denied/no leakage. TV3: terminal changes location_id in payload → ignored/denied. |
| Owning service            | KitLuy Identity and Authorization Core                                                                                                                         |
| Consuming products        | All KitLuy products, APIs, Store Hub, workers and connectors                                                                                                   |

### KBR-CORE-002 — One Digital Store, one primary vertical

| Required field            | Canonical specification                                                                                                                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-002                                                                                                                                                                                                                           |
| Purpose                   | Prevent mixed vertical semantics and schema rules inside one Digital Store.                                                                                                                                                            |
| Inputs                    | digital_store_id; requested vertical_code; current vertical_code; activation and transaction history.                                                                                                                                  |
| Preconditions             | Digital Store exists; actor can configure vertical; vertical registry value is active.                                                                                                                                                 |
| Calculation or transition | Allow initial vertical selection while draft/configuring. After operational activation or authoritative transactions, changing primary vertical requires a versioned owner-approved migration or creation of a separate Digital Store. |
| Output                    | Persisted primary vertical and vertical configuration version, or a blocked transition with migration requirement.                                                                                                                     |
| Permissions               | Partner owner during initial setup; later changes require platform governance approval and explicit migration authority.                                                                                                               |
| Audit event               | digital_store.vertical_selected or digital_store.vertical_change_blocked.                                                                                                                                                              |
| Offline behavior          | Hub accepts only the provisioned vertical package; stale or conflicting packages are rejected and the last compatible active package remains.                                                                                          |
| Error behavior            | Return vertical_locked_after_activation or incompatible_vertical_package.                                                                                                                                                              |
| Compensating action       | Create a separate Digital Store, or execute an approved migration that preserves all historical records under their original vertical context.                                                                                         |
| Canonical test vectors    | TV1: draft Laundry Store selects LAUNDRY → success. TV2: active Laundry Store requests RESTAURANT → blocked. TV3: same Tenant creates second Restaurant Store → success.                                                               |
| Owning service            | Digital Store Core                                                                                                                                                                                                                     |
| Consuming products        | Admin Portal, Partner Portal, Chain Portal, Storefront, Store Hub, all vertical modules                                                                                                                                                |

### KBR-CORE-003 — Append-only finalized truth

| Required field            | Canonical specification                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-003                                                                                                                                                                                                     |
| Purpose                   | Protect finalized transaction, payment, inventory, finance and audit records from destructive change.                                                                                                            |
| Inputs                    | Record type; record state; requested mutation; actor; reason; linked document/event.                                                                                                                             |
| Preconditions             | Record is authoritative; state classification and correction policy are known.                                                                                                                                   |
| Calculation or transition | Draft records may be edited under optimistic concurrency. Finalized records reject update/delete of protected facts; corrections require a new linked reversal, adjustment, refund, void or superseding version. |
| Output                    | Original preserved plus optional compensating record and current derived balance/state.                                                                                                                          |
| Permissions               | Domain-specific correction permission; sensitive corrections may require re-authentication and approval.                                                                                                         |
| Audit event               | <domain>.mutation_rejected or <domain>.compensation_posted.                                                                                                                                                      |
| Offline behavior          | Hub enforces the same immutability locally and queues both original and compensation; sync never rewrites original events.                                                                                       |
| Error behavior            | Reject mutation with immutable_record error and identify allowed compensation command.                                                                                                                           |
| Compensating action       | Post an equal-and-opposite or delta correction linked by original_record_id and reason_code.                                                                                                                     |
| Canonical test vectors    | TV1: edit finalized payment amount → denied. TV2: authorized refund posts new negative settlement effect. TV3: replay compensation key → original result returned once.                                          |
| Owning service            | KitLuy Ledger Core                                                                                                                                                                                               |
| Consuming products        | POS, Partner Portal/App, Admin, reports, APIs, Store Hub and connectors                                                                                                                                          |

### KBR-CORE-004 — Idempotent business effect

| Required field            | Canonical specification                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-004                                                                                                                                                                      |
| Purpose                   | Guarantee retries and duplicate delivery do not duplicate business effects.                                                                                                       |
| Inputs                    | Idempotency key; operation type; scope; canonical request hash; actor/device; correlation ID.                                                                                     |
| Preconditions             | Key format valid; key is unique within defined scope and retention window.                                                                                                        |
| Calculation or transition | Atomically reserve key with request hash. First execution commits result and response reference. Same key/same hash returns original result; same key/different hash is rejected. |
| Output                    | One business effect and a stable replay response.                                                                                                                                 |
| Permissions               | Same permission as original command; replay does not bypass current access to retrieve sensitive response data.                                                                   |
| Audit event               | core.idempotency_reserved, core.idempotency_replayed or core.idempotency_conflict.                                                                                                |
| Offline behavior          | Hub stores idempotency records durably across restart and includes them in sync. Cloud deduplicates Hub-originated events by event ID and idempotency key.                        |
| Error behavior            | On ambiguous timeout, caller retries same key. Never advise creating a new key until status is resolved.                                                                          |
| Compensating action       | Reconcile unknown outcome; if duplicate escaped due to defect, post governed compensating entries and incident record.                                                            |
| Canonical test vectors    | TV1: same Booking command twice → one Booking. TV2: same key with changed total → conflict. TV3: Hub reconnect replays payment event → one payment effect.                        |
| Owning service            | KitLuy Command and Idempotency Core                                                                                                                                               |
| Consuming products        | All write APIs, Store Hub, workers, webhooks and connectors                                                                                                                       |

### KBR-CORE-005 — Authoritative truth envelope

| Required field            | Canonical specification                                                                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-005                                                                                                                                                                       |
| Purpose                   | Prevent stale, partial or estimated data from appearing current and complete.                                                                                                      |
| Inputs                    | Source system; as_of_at; sync cursor; completeness status; reconciliation status; estimate/cache flags.                                                                            |
| Preconditions             | Read model declares authority source and freshness policy.                                                                                                                         |
| Calculation or transition | Attach source, as-of, freshness, completeness and reconciliation attributes to sensitive reads. Unknown is distinct from zero; stale is distinct from current.                     |
| Output                    | Truth-labeled response or explicit unavailable state.                                                                                                                              |
| Permissions               | Read permission for the underlying data; masking rules apply before envelope delivery.                                                                                             |
| Audit event               | read_model.served with truth metadata; stale/partial warnings are observable.                                                                                                      |
| Offline behavior          | Portal may display cached snapshots only with prominent cached/as-of labels and no prohibited mutation. Hub-local operational reads identify local authority and cloud sync state. |
| Error behavior            | Fail closed for decisions requiring complete/reconciled data; render available modules independently where safe.                                                                   |
| Compensating action       | Trigger refresh/rebuild/reconciliation; never fabricate missing values.                                                                                                            |
| Canonical test vectors    | TV1: no finance contract → unavailable, not 0. TV2: Hub offline, last sync 2h → stale label. TV3: complete reconciled close → authoritative label.                                 |
| Owning service            | KitLuy Read Model and Reporting Core                                                                                                                                               |
| Consuming products        | All dashboards, reports, Partner App/Portal, Chain, Admin and APIs                                                                                                                 |

### KBR-CORE-006 — Human confirmation for sensitive actions

| Required field            | Canonical specification                                                                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-006                                                                                                                                                                                  |
| Purpose                   | Require intentional authorized human control over financial, permission, compliance and safety changes.                                                                                       |
| Inputs                    | Action classification; actor; re-auth proof; reason; preview; approval policy; approver evidence.                                                                                             |
| Preconditions             | Action is classified; actor has request permission; required context is complete.                                                                                                             |
| Calculation or transition | For sensitive actions, create a preview and approval request. Require re-authentication, reason and independent approver when policy says four-eyes. Execute only approved immutable command. |
| Output                    | Approved execution result or rejected/expired request; complete approval chain.                                                                                                               |
| Permissions               | Explicit request/approve/execute permissions; requester cannot self-approve where segregation is required.                                                                                    |
| Audit event               | approval.requested, approval.approved/rejected/expired and action.executed/failed.                                                                                                            |
| Offline behavior          | Offline execution allowed only for explicitly pre-authorized local policies. High-risk cloud/admin changes remain blocked offline.                                                            |
| Error behavior            | No silent downgrade of approval. Expired, missing or conflicting approval blocks execution.                                                                                                   |
| Compensating action       | If execution partially completes, freeze retries, reconcile side effects and use domain compensation with incident review.                                                                    |
| Canonical test vectors    | TV1: cashier refund above threshold → manager approval required. TV2: same actor attempts self-approval → denied. TV3: approved action payload changes → approval invalidated.                |
| Owning service            | KitLuy Authorization and Approval Core                                                                                                                                                        |
| Consuming products        | Admin, Partner Portal/App, POS, Store Hub, Finance and compliance workflows                                                                                                                   |

### KBR-CORE-007 — External channel authority boundary

| Required field            | Canonical specification                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-007                                                                                                                                                                            |
| Purpose                   | Keep KitLuy as customer, inventory, payment, finance and audit source of truth.                                                                                                         |
| Inputs                    | Connector identity; mapping version; channel event; external IDs; signatures; scopes.                                                                                                   |
| Preconditions             | Connector active, certified, scoped and signature verified; mapping version supported.                                                                                                  |
| Calculation or transition | Accept external data as a versioned ingress proposal/event. Validate, map and create KitLuy authoritative records through governed APIs. Never allow direct production database access. |
| Output                    | Accepted/rejected/quarantined ingress with KitLuy IDs and mapping trace.                                                                                                                |
| Permissions               | Connector scopes plus Partner authorization; sensitive effects follow normal approval rules.                                                                                            |
| Audit event               | connector.ingress_received, mapped, accepted, rejected or quarantined.                                                                                                                  |
| Offline behavior          | Hub may consume only cloud-accepted projections/events. An external channel cannot directly mutate Hub ledgers.                                                                         |
| Error behavior            | Invalid signature/schema/mapping is rejected or quarantined; retries are deduplicated.                                                                                                  |
| Compensating action       | Reverse accepted effects through normal business compensation; correct mapping and replay from retained ingress evidence.                                                               |
| Canonical test vectors    | TV1: marketplace duplicate order event → one KitLuy transaction. TV2: connector posts inventory SQL → impossible/denied. TV3: unknown SKU mapping → quarantine.                         |
| Owning service            | Integration Hub and Connector API                                                                                                                                                       |
| Consuming products        | Storefront, connectors, Partner Portal, Commerce/Management APIs, reports                                                                                                               |

### KBR-CORE-008 — Reason codes and evidence

| Required field            | Canonical specification                                                                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-008                                                                                                                                                                                       |
| Purpose                   | Make exceptional actions explainable and consistently reportable.                                                                                                                                  |
| Inputs                    | Action type; reason code; optional note; evidence files; actor; policy version.                                                                                                                    |
| Preconditions             | Reason registry contains active code valid for action; required evidence is present.                                                                                                               |
| Calculation or transition | Validate reason code against action and effective policy version. Store immutable reason snapshot and evidence references with the action.                                                         |
| Output                    | Governed action with reason/evidence linkage or validation rejection.                                                                                                                              |
| Permissions               | Permission to perform action and, separately, to view sensitive evidence.                                                                                                                          |
| Audit event               | <domain>.reason_recorded and file access audit.                                                                                                                                                    |
| Offline behavior          | Hub caches active reason-code subset and policy version. Unknown/new codes cannot be invented offline.                                                                                             |
| Error behavior            | Reject missing, inactive or incompatible reason; preserve draft until corrected.                                                                                                                   |
| Compensating action       | Void/reverse the requested action if not finalized; otherwise compensate under a valid correction reason.                                                                                          |
| Canonical test vectors    | TV1: damage write-off with active code/evidence → success. TV2: free-text only where coded reason required → reject. TV3: stale Hub reason code disabled in cloud → quarantine on sync for review. |
| Owning service            | KitLuy Governance and Audit Core                                                                                                                                                                   |
| Consuming products        | POS, Partner/Admin portals, Inventory, Payments, Laundry issues and support                                                                                                                        |

### KBR-CORE-009 — Optimistic concurrency for mutable configuration

| Required field            | Canonical specification                                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule ID                   | KBR-CORE-009                                                                                                                                                                         |
| Purpose                   | Prevent silent overwrites of draft/configuration data.                                                                                                                               |
| Inputs                    | Aggregate ID; expected version/ETag; proposed change; actor.                                                                                                                         |
| Preconditions             | Aggregate is mutable and actor can edit; expected version supplied.                                                                                                                  |
| Calculation or transition | Compare expected version atomically. On match apply change and increment version. On mismatch reject with current version and conflict-safe summary.                                 |
| Output                    | New version or conflict response; no partial write.                                                                                                                                  |
| Permissions               | Domain edit permission; approval may be required before publication.                                                                                                                 |
| Audit event               | <domain>.draft_updated or concurrency_conflict.                                                                                                                                      |
| Offline behavior          | Hub does not author cloud configuration unless explicitly allowed. Local operational settings use Hub-local versions and merge only by domain policy, never generic LWW for ledgers. |
| Error behavior            | Return conflict; do not auto-merge sensitive pricing, permission, payment or inventory policy.                                                                                       |
| Compensating action       | User rebases/reviews changes; no ledger compensation needed because write did not occur.                                                                                             |
| Canonical test vectors    | TV1: version 4 update against v4 → v5. TV2: second editor still uses v4 → conflict.                                                                                                  |
| Owning service            | KitLuy Configuration Core                                                                                                                                                            |
| Consuming products        | Admin, Chain, Partner Portal, Storefront publisher and API clients                                                                                                                   |

### KBR-CORE-010 — Feature flag and entitlement safety

| Required field            | Canonical specification                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rule ID                   | KBR-CORE-010                                                                                                                                                                                         |
| Purpose                   | Gate optional capability without damaging safety, data access or completed records.                                                                                                                  |
| Inputs                    | Tenant/Store plan; entitlement; feature flag; environment; vertical; compatibility version.                                                                                                          |
| Preconditions             | Entitlement evaluation service available or approved local cache exists; feature policy defined.                                                                                                     |
| Calculation or transition | Evaluate security permission first, then feature entitlement and compatibility. Disabling a feature hides/blocks new use but preserves access to owned data, required exports and finalized records. |
| Output                    | Enabled/disabled decision with policy reason and effective version.                                                                                                                                  |
| Permissions               | Entitlement administration is privileged and audited; it never grants missing security permission.                                                                                                   |
| Audit event               | entitlement.evaluated and entitlement.changed.                                                                                                                                                       |
| Offline behavior          | Hub uses signed cached entitlements with expiry/grace policy. Core safety, offline continuity and required data export cannot be disabled by commercial outage.                                      |
| Error behavior            | Fail safe according to capability class: safety-critical remains available; optional new actions fail closed; reads remain truth-labeled.                                                            |
| Compensating action       | Restore prior entitlement version or apply grace; reconcile any operations accepted during approved grace.                                                                                           |
| Canonical test vectors    | TV1: report export remains available despite plan downgrade. TV2: optional connector disabled blocks new sync but retains history. TV3: forged client entitlement ignored.                           |
| Owning service            | KitLuy Entitlement and Feature Governance                                                                                                                                                            |
| Consuming products        | All products and vertical modules                                                                                                                                                                    |

## 4. Cross-document dependency map

| Contract family          | Required companion                                                            |
| ------------------------ | ----------------------------------------------------------------------------- |
| Identity and isolation   | Supabase RLS/authorization specification and API scope registry               |
| Commands and idempotency | Four API contracts, event registry and outbox pattern                         |
| Immutable truth          | Transaction, payment, inventory and finance rule documents in this package    |
| Sensitive actions        | Product permission matrix, approval policy and audit-event registry           |
| Offline                  | Store Hub local schema, Edge Operations API and replay/reconciliation runbook |
| Truth labels             | Report-definition registry and implementation-status/evidence register        |

## Open required values

These values are intentionally not guessed. They must be resolved through the governed decision register before production activation.

| ID            | Required value                                               |
| ------------- | ------------------------------------------------------------ |
| `CORE-OD-001` | Exact idempotency-record retention by operation class.       |
| `CORE-OD-002` | Final action-classification and four-eyes policy matrix.     |
| `CORE-OD-003` | Signed entitlement cache expiry and commercial grace values. |

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
