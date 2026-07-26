# KitLuy API Version and Deprecation Policy

**Filename:** `kitluy-api-version-and-deprecation-policy-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical shared target policy; not implementation evidence

## 1. Purpose

Govern compatible evolution of Management, Commerce Store, Edge Operations and Connector APIs without collapsing them into one API and without destabilizing Stores or earlier verticals.

## 2. Version dimensions

| Contract                  | Version mechanism                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------- |
| HTTP API                  | Major version in route: `/management/v1`, `/commerce/v1`, `/edge/v1`, `/connector/v1`. |
| OpenAPI document          | Semantic document version and source checksum.                                         |
| JSON Schema               | `$id`, schema version and compatibility classification.                                |
| Domain event              | Event name suffix, e.g. `.v1`; immutable historical schema.                            |
| Webhook                   | Event type/version headers and payload schema ID.                                      |
| Configuration publication | Immutable publication version plus client compatibility range.                         |
| Connector mapping         | Installation-specific immutable mapping version.                                       |
| Edge sync protocol        | Protocol major/minor and capability negotiation.                                       |

## 3. Lifecycle states

`DRAFT -> INTERNAL_PREVIEW -> PILOT_PREVIEW -> STABLE -> DEPRECATED -> RETIRED`

- Preview contracts may change but still require explicit version and test evidence.
- Stable contracts receive compatibility guarantees.
- Deprecated contracts remain operational for the approved support window.
- Retired contracts return a registered retirement error or are removed after verified zero-use and migration completion.

## 4. Compatibility classification

### Additive/compatible candidates

- Optional response field.
- New endpoint.
- Optional request field with unchanged default behavior.
- New error code for a new condition, with clients required to handle unknown codes safely.
- New enum value only when tolerant-reader behavior is part of the supported client contract.
- New scope that does not change existing scope meaning.

### Breaking changes

- Removing/renaming endpoint, field, error or scope.
- Changing field type, requiredness, nullability, money/time meaning or default.
- Changing authorization/resource resolution.
- Reusing an ID, error or scope with different semantics.
- Changing pagination ordering/cursor binding.
- Changing idempotency domain/retention in a way that risks duplicate effects.
- Weakening audit, reconciliation or freshness behavior.
- Treating stale or cached data as authoritative.

## 5. Change process

1. Change proposal with affected surfaces, clients, verticals, schema, events and migrations.
2. Compatibility diff from OpenAPI/JSON Schema tooling.
3. Security, finance/inventory, offline and freshness impact review.
4. Registry updates: errors, scopes, tests and required values.
5. Parallel implementation or additive migration.
6. Consumer contract tests for all supported first-party and certified clients.
7. Preview/pilot rollout with monitoring.
8. Stable promotion and documentation.

## 6. Deprecation requirements

A deprecation record contains:

- contract/operation/schema/scope/error identifier;
- replacement and migration guide;
- announcement date;
- last supported date and retirement date;
- affected clients/installations/devices and usage evidence;
- owner, support and incident route;
- compatibility tests and rollback;
- security/legal urgency if applicable.

Responses use standard `Deprecation`, `Sunset` and `Link` headers where practical, plus KitLuy documentation metadata. Exact support windows and notice periods are `[REQUIRED: owner-approved values]`.

## 7. Edge compatibility policy

Store Hub and T1–T4 must keep operating offline after provisioning. Cloud release cannot require immediate online upgrade to continue already-approved local operations. Configuration and client releases declare minimum/maximum compatible protocol, schema and vertical bundle versions. Store Hub distributes signed releases and supports A/B rollback.

A cloud breaking change cannot retire an Edge protocol until all active/pilot devices are migrated or explicitly quarantined under an approved plan.

## 8. Connector compatibility policy

Certified connectors declare supported API, webhook, event and mapping versions. Deprecation tracks each installation and blocks retirement while unresolved active installations remain, unless a security/legal emergency is approved. Connectors do not receive direct database compatibility promises.

## 9. Emergency change

A critical security, fraud, legal or safety issue may require accelerated change. The change still needs incident ID, owner/security approval, audit, affected-client communication, safe failure behavior and a follow-up compatibility/restoration plan. Finance, inventory, payment and audit integrity cannot be disabled.

## 10. Required tests

- OpenAPI breaking-change diff.
- Old client/new server and new client/old supported server matrices.
- Unknown field/enum/error tolerant-reader tests.
- Deprecation/Sunset header tests.
- Edge offline/upgrade/rollback tests.
- Connector webhook/event compatibility tests.
- Migration/reconciliation and zero-duplicate tests.

## Appendix A — Owner decisions required

1. `[REQUIRED: minimum Stable support window]`
2. `[REQUIRED: minimum deprecation notice period]`
3. `[REQUIRED: preview support and SLA policy]`
4. `[REQUIRED: emergency retirement authority and communication matrix]`
5. `[REQUIRED: SDK release/support cadence]`
