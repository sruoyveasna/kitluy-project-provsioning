# KitLuy Event Schema Compatibility Policy

**Filename:** `kitluy-event-schema-compatibility-policy-v1.0.0.md`  
**Version:** v1.0.0

**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** Canonical target contract; not implementation evidence  
**Scope:** Shared KitLuy Core, Integration Hub, Store Hub, all current and future verticals  
**Primary phase:** Phase 1 Laundry foundation with additive cross-vertical reuse  
**Locales / currencies / timezone:** Khmer and English; KHR and USD; `Asia/Phnom_Penh`

> **Implementation truth:** This document specifies target behavior. Nothing is `IMPLEMENTED` until matching repository code, applied migrations, executable tests, deployed workers/services, monitoring evidence and approved pilot or production evidence exist.

## 0. Authority and source baseline

### 0.1 Authority order

1. Current owner decisions and current KitLuy Project Instructions.
2. Applied migrations, verified code/tests and production evidence.
3. This contract family and the approved canonical Supabase/API contracts.
4. Current KitLuy Rebuild, Business and product specifications.
5. Approved handoffs and feature registries.
6. Evidence-based competitor analyses.
7. Competitor clone documents and superseded planning.

### 0.2 Governing sources

- `Current KitLuy Project Instructions` — highest owner authority for the eight-phase roadmap, Digital Store model, Store Hub authority, append-only truth, API/event rules and evidence discipline.
- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — minimum Phase 1 event families, durable-job families, configuration/provisioning state machines, API replay route and four-eyes authorization controls.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — local transactional outbox/inbox, ordered sync, per-event acknowledgement, append-only custody/payment truth and conflict rules.
- `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` — Laundry Booking, Ready, payment, custody and pickup operational event vocabulary.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — at-least-once queues, idempotent consumers, bounded exponential backoff, dead-letter handling, webhook verification and relational job truth.
- `kitluy-master-feature-registry-v0.2.md` and approved comparison/backlog packages — Phase 1 requirement for versioned domain events, durable jobs, webhooks, outbox/inbox and replay controls.

### 0.3 Non-negotiable rules

- Events, jobs and webhook records are relational, versioned, tenant-scoped, auditable and retry-safe.
- Transport is assumed **at least once**. Business effects must be idempotent.
- Finalized payment, refund, inventory, finance, custody and audit truth is append-only or corrected through explicit compensating records.
- Store Hub local operations continue after provisioning when WAN is unavailable.
- External connectors never receive direct production-database access and never become the authority for customer, inventory, payment or finance truth.
- Sensitive replay, repair, financial, permission, configuration, provisioning and production actions require authorized human confirmation; high-risk actions require four-eyes approval.
- Missing, stale, partial or unreconciled data must never be presented as authoritative truth.

## 1. Policy objective

Allow KitLuy Core, Store Hub, POS, portals, workers and connectors to evolve independently without silent data corruption or coordinated all-at-once deployments.

## 2. Version model

- `event_name` identifies the immutable business fact.
- `schema_version` is a positive integer.
- Additive compatible changes stay in the same version only when every supported consumer is required to ignore unknown optional fields.
- A breaking change creates a new schema version; it does not repurpose the old version.
- Event semantics, aggregate identity and authoritative meaning may never change under an existing name/version.

## 3. Compatible additive changes

Allowed after contract review and tests:

- add an optional field with a safe documented absence meaning;
- add an optional object whose absence preserves behavior;
- relax a maximum length/quantity without weakening security or finance invariants;
- add a new enum value only when consumers are explicitly unknown-value tolerant or the field has an `OTHER/UNKNOWN` handling contract;
- add non-authoritative metadata under the approved `metadata` extension object.

## 4. Breaking changes

Require a new version:

- remove or rename a field;
- make an optional field required;
- narrow a type, range, precision or format;
- change units, currency representation, timezone meaning or rounding;
- change ID scope or aggregate identity;
- change a field from identifier to display value or vice versa;
- split/merge fields in a way old consumers cannot preserve meaning;
- change enum meaning or reuse a retired enum value;
- change ordering, idempotency or business-effect semantics;
- expose or remove sensitive data classifications.

## 5. Prohibited evolution

- Unversioned arbitrary callbacks that mutate producer transactions.
- Silent field reinterpretation.
- Generic JSON blobs becoming authoritative finance, inventory, custody or payment data.
- Consumer-specific payload mutation under the same event ID.
- Producer deployment that emits an unsupported version without compatibility evidence.
- Deleting the only historical schema artifact used to interpret retained events.

## 6. Producer requirements

- Register owner, source table/command, aggregate, schema path, retention and supported versions.
- Validate before writing the outbox.
- Preserve exact emitted schema and payload hash.
- Dual-publish only under an approved migration plan; versions use distinct event IDs linked by causation/migration metadata.
- Stop emitting a deprecated version only after every required consumer has migrated or an approved exception exists.

## 7. Consumer requirements

Each consumer declares:

- supported event names and versions;
- minimum/maximum version;
- unknown-field behavior;
- unknown-enum behavior;
- ordering and gap policy;
- idempotency key;
- data classification and retention;
- failure/dead-letter behavior;
- migration and rollback test evidence.

Unsupported versions are quarantined with `schema_incompatible`; they are never silently treated as another version.

## 8. Compatibility matrix

| Producer state                          | Consumer supports | Result                                                  |
| --------------------------------------- | ----------------- | ------------------------------------------------------- |
| Emits v1 with optional additive field   | v1 tolerant       | Process.                                                |
| Emits v1 with unknown required semantic | v1 not tolerant   | Quarantine; producer violation.                         |
| Emits v2                                | v1 only           | Quarantine or route through approved adapter.           |
| Dual emits v1/v2                        | Consumer v1       | Process v1; dedupe migration linkage.                   |
| Dual emits v1/v2                        | Consumer v2       | Process v2; suppress corresponding v1 by migration key. |

## 9. Lifecycle

```text
draft → review → approved → active → deprecated → emission_stopped → archived
```

Proposed baseline lifecycle, subject to owner approval:

- Internal contracts: minimum two stable release cycles before emission stop.
- External connector contracts: minimum 180-day notice unless a security/legal emergency requires accelerated action.
- Store Hub/POS contracts: retain compatibility for every supported deployed release and the documented offline upgrade window.

Exact periods remain `[REQUIRED: approved lifecycle values]`.

## 10. Schema repository

```text
contracts/
  events/<event_name>/v1.schema.json
  jobs/<job_type>/v1.schema.json
  webhooks/outbound/v1.schema.json
  webhooks/providers/<provider>/v1.schema.json
  compatibility/consumer-matrix.yaml
  examples/
  tests/
```

Every artifact has checksum, owner, status, effective date and change history. Generated code must not replace the source JSON Schema.

## 11. Contract review and gates

A new or changed event requires:

1. owner and bounded-context approval;
2. schema diff classification;
3. security/privacy review;
4. finance/inventory/custody review when applicable;
5. Store Hub/offline impact review;
6. consumer inventory and compatibility matrix update;
7. producer/consumer contract tests;
8. migration, rollout, rollback and replay plan;
9. documentation and registry update.

## 12. Required tests

- Golden examples for each version.
- Backward/forward compatibility tests.
- Unknown optional field and unknown enum tests.
- Old supported Store Hub/POS build against new producer.
- New consumer against retained old events.
- Dual-publish dedupe and migration linkage.
- Replay retained v1 after v2 activation.
- Schema registry checksum and immutable artifact tests.

## 13. Emergency changes

A security, legal or data-corruption emergency may accelerate deprecation only through a versioned incident/change decision, affected-consumer inventory, mitigation, explicit owner approval and rollback/repair plan. Emergency action does not authorize silent semantic reuse.

## 14. Open production values

- `[REQUIRED: supported release matrix and minimum client versions]`
- `[REQUIRED: exact deprecation notice periods]`
- `[REQUIRED: schema registry hosting and signing policy]`
- `[REQUIRED: external connector certification policy]`
