# KitLuy API Contract Test Registry

**Filename:** `kitluy-api-contract-test-registry-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Status:** Canonical shared target registry; not implementation evidence

## 1. Purpose

Provide immutable test identifiers and evidence obligations for the four governed API contracts. A document, endpoint or feature is not complete because a test row exists; the row requires linked executable evidence for the exact build and environment.

## 2. Test record schema

Each implementation evidence record contains:

```json
{
  "test_id": "KACT-SHR-001",
  "contract_version": "v1.0.0",
  "openapi_checksum": "sha256:...",
  "build_sha": "...",
  "environment": "staging",
  "executed_at": "date-time",
  "result": "pass|fail|blocked",
  "evidence_locations": [],
  "owner": "team-or-person",
  "notes": ""
}
```

## 3. Gate meanings

- `G1`: contract approved.
- `G2`: build/unit/component/contract evidence.
- `G3`: integrated security/offline/reconciliation/performance/recovery evidence.
- `G4`: pilot readiness, monitoring, rollback and support.
- `G5`: approved pilot/phase exit and Rebuild Test.

## 4. Canonical registry

| Test ID        | Surface    | Category      | Required assertion                                                    | Minimum evidence                       | Gate  |
| -------------- | ---------- | ------------- | --------------------------------------------------------------------- | -------------------------------------- | ----- |
| `KACT-SHR-001` | ALL        | Schema        | OpenAPI 3.1 parses; every $ref resolves; examples validate.           | validator report + checksum            | G1/G2 |
| `KACT-SHR-002` | ALL        | Errors        | Every emitted error is registered with matching status/retryability.  | automated conformance report           | G2    |
| `KACT-SHR-003` | ALL        | Scopes        | Every operation uses registered scope or explicit public declaration. | OpenAPI-scope diff                     | G1/G2 |
| `KACT-SHR-004` | ALL        | Idempotency   | Identical replay returns same result; changed payload is rejected.    | integration test + DB assertions       | G2/G3 |
| `KACT-SHR-005` | ALL        | Isolation     | Cross-Tenant/Digital Store/Location access fails at API and DB/RLS.   | security test + SQL evidence           | G3    |
| `KACT-SHR-006` | ALL        | Pagination    | Cursor is stable, opaque and query/scope bound.                       | property/integration tests             | G2    |
| `KACT-SHR-007` | ALL        | Rate limit    | Headers, 429 and Retry-After behavior conform.                        | load-test report                       | G3    |
| `KACT-SHR-008` | ALL        | Freshness     | Fresh/stale/partial labels match source state; no false authority.    | fault-injection tests                  | G3    |
| `KACT-SHR-009` | ALL        | Audit         | Request/actor/scope/resource/idempotency/outcome are recorded.        | audit query evidence                   | G3    |
| `KACT-SHR-010` | ALL        | Compatibility | No unapproved breaking diff versus supported version.                 | OpenAPI diff + consumer tests          | G4/G5 |
| `KACT-SHR-011` | ALL        | Localization  | Khmer/English messages and money/time formatting pass.                | locale test report                     | G3    |
| `KACT-SHR-012` | ALL        | Resilience    | Retryable outages do not duplicate finalized effects.                 | chaos/recovery evidence                | G3    |
| `KACT-MGT-001` | Management | Surface       | OpenAPI conformance                                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-002` | Management | Surface       | human/session authentication                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-003` | Management | Surface       | scope and resource isolation                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-004` | Management | Surface       | four-eyes approval                                                    | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-005` | Management | Surface       | configuration publication idempotency                                 | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-006` | Management | Surface       | report/export async behavior                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-007` | Management | Surface       | Store freshness labeling                                              | automated test + logs/audit/assertions | G2/G3 |
| `KACT-MGT-008` | Management | Surface       | append-only finance/audit guardrail                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-001` | Commerce   | Surface       | OpenAPI conformance                                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-002` | Commerce   | Surface       | public/customer credential isolation                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-003` | Commerce   | Surface       | session enumeration resistance                                        | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-004` | Commerce   | Surface       | cart idempotency/versioning                                           | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-005` | Commerce   | Surface       | checkout server revalidation                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-006` | Commerce   | Surface       | stale availability fail-safe                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-007` | Commerce   | Surface       | payment retry/reconciliation                                          | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-008` | Commerce   | Surface       | secure-token data minimization                                        | automated test + logs/audit/assertions | G2/G3 |
| `KACT-COM-009` | Commerce   | Surface       | pre-intake exactly-once confirmation                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-001` | Edge       | Surface       | OpenAPI conformance                                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-002` | Edge       | Surface       | certificate and assignment trust                                      | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-003` | Edge       | Surface       | terminal profile isolation                                            | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-004` | Edge       | Surface       | offline local commit                                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-005` | Edge       | Surface       | sync replay/deduplication                                             | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-006` | Edge       | Surface       | conflict/reconciliation behavior                                      | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-007` | Edge       | Surface       | T1–T4 custody and finance audit                                       | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-008` | Edge       | Surface       | configuration compatibility and rollback                              | automated test + logs/audit/assertions | G2/G3 |
| `KACT-EDG-009` | Edge       | Surface       | WAN outage/recovery                                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-001` | Connector  | Surface       | OpenAPI conformance                                                   | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-002` | Connector  | Surface       | installation consent/scope                                            | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-003` | Connector  | Surface       | callback signature/replay protection                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-004` | Connector  | Surface       | inbound deduplication                                                 | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-005` | Connector  | Surface       | mapping version enforcement                                           | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-006` | Connector  | Surface       | projection freshness                                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-007` | Connector  | Surface       | webhook retry/dead-letter/replay                                      | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-008` | Connector  | Surface       | connector revocation                                                  | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-009` | Connector  | Surface       | cross-Tenant isolation                                                | automated test + logs/audit/assertions | G2/G3 |
| `KACT-CON-010` | Connector  | Surface       | reconciliation and ledger guardrail                                   | automated test + logs/audit/assertions | G2/G3 |

## 5. Execution rules

1. Tests run against generated validators and deployed service, not mocks alone.
2. Security/isolation tests include direct API and database/RLS assertions.
3. Financial, inventory, payment and custody tests assert append-only/compensating behavior and zero duplicates.
4. Edge tests include WAN outage, power interruption where safe, replay, rollback and Store Hub recovery.
5. Connector tests use signed raw payloads, duplicate events, time skew, retries, dead letter and replay.
6. Compatibility tests run for every supported client/server and event/webhook version.
7. Failing required tests block promotion. Waivers require owner/security approval, expiry and explicit risk acceptance; no waiver may permit tenant leakage or financial/audit corruption.

## 6. Traceability

Every OpenAPI `operationId` maps to:

- positive schema/auth/scope test;
- negative validation/auth/scope test;
- documented errors;
- idempotency test for mutations;
- audit test for significant operations;
- freshness test for projections;
- compatibility test when changed.

## Appendix A — Required implementation values

- `[REQUIRED: test repository paths and CI workflow names]`
- `[REQUIRED: evidence storage and retention policy]`
- `[REQUIRED: environment owners and promotion approvers]`
- `[REQUIRED: performance/load targets by surface]`
- `[REQUIRED: certified client/connector/device compatibility matrix]`
