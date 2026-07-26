# KitLuy RLS and Tenant Isolation Test Pack

| Field      | Value                                                                |
| ---------- | -------------------------------------------------------------------- |
| Filename   | `kitluy-rls-and-tenant-isolation-test-pack-v1.0.0.md`                |
| Version    | `v1.0.0`                                                             |
| Date       | `2026-07-26`                                                         |
| Owner      | HET / KitLuy Suite Project Owner                                     |
| Phase      | Phase 1 - Laundry                                                    |
| Status     | Canonical testing and evidence specification; not execution evidence |
| Timezone   | `Asia/Phnom_Penh`                                                    |
| Languages  | Khmer and English                                                    |
| Currencies | KHR and USD                                                          |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.

## 1. Security objective

Tenant, Partner, Digital Store, Location, user, role, environment and device isolation must hold even when UI controls, API filters, cached claims, or service code are wrong. Supabase RLS is a required enforcement layer, not a substitute for API authorization.

## 2. Canonical test identities

- Tenant A and Tenant B, each with one Laundry Digital Store and two Locations.
- Partner owner, Store manager, supervisor, accountant, readonly, cashier and laundry staff.
- Chain HQ and region-scoped users.
- HET Admin roles with environment-specific permissions.
- Active, revoked and expired support consent.
- Store Hub, T1, T2, T3, T4 and POS Mobile device identities.
- First-party service accounts and connector identities.

## 3. Test methods

1. Direct SQL under simulated JWT claims in an isolated test database.
2. PostgREST reads and writes.
3. RPC and Edge Function calls.
4. Realtime subscription and broadcast authorization.
5. File metadata and signed-access generation.
6. API gateway and service-to-service calls.
7. Cached-token, revoked-membership and concurrent-change tests.

## 4. Mandatory cases

| ID      | Scenario                                                            | Pass condition                                                      |
| ------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| RLS-001 | Anonymous access to tenant table                                    | Denied; no row/count leakage                                        |
| RLS-002 | Authenticated user with no membership                               | Denied across table, RPC, Realtime and API                          |
| RLS-003 | Tenant A read using Tenant B primary key                            | Zero rows or generic not-found; no metadata leak                    |
| RLS-004 | Tenant A insert with Tenant B tenant_id                             | Denied by WITH CHECK; no audit/business row                         |
| RLS-005 | Tenant A update of Tenant B row                                     | Denied; original row unchanged                                      |
| RLS-006 | Tenant A delete of Tenant B mutable row                             | Denied                                                              |
| RLS-007 | Location-scoped user reads sibling Location                         | Denied                                                              |
| RLS-008 | Digital Store-scoped user reads another Store same Tenant           | Denied unless explicit Tenant scope                                 |
| RLS-009 | Chain regional role reads unassigned region                         | Denied and aggregate excludes it                                    |
| RLS-010 | Revoked membership with old JWT                                     | Denied by server-side membership check or token invalidation policy |
| RLS-011 | Suspended user with valid session                                   | Denied                                                              |
| RLS-012 | Inactive Digital Store membership                                   | Denied                                                              |
| RLS-013 | Service account crosses declared Tenant                             | Denied and alerted                                                  |
| RLS-014 | Connector token accesses direct PostgREST tenant table              | Denied; Connector API only                                          |
| RLS-015 | Device certificate for Location A calls Location B Edge API         | Denied                                                              |
| RLS-016 | T3 profile calls T4 completion mutation                             | Denied and audited                                                  |
| RLS-017 | Readonly role calls mutation RPC                                    | Denied                                                              |
| RLS-018 | Finance role reads restricted issue photo                           | Denied unless separately granted                                    |
| RLS-019 | Support operator without active consent                             | Denied                                                              |
| RLS-020 | Support operator after consent expiry                               | Denied immediately                                                  |
| RLS-021 | Four-eyes requester self-approves                                   | Denied                                                              |
| RLS-022 | Environment-scoped role uses production endpoint from staging grant | Denied                                                              |
| RLS-023 | Realtime subscription crosses Tenant topic                          | Denied and no prior buffered event delivered                        |
| RLS-024 | Storage/file signed URL generated for foreign Tenant                | Denied                                                              |
| RLS-025 | Report export includes unauthorized Location                        | Export blocked or rows excluded with explicit scope manifest        |
| RLS-026 | Aggregate count timing probe                                        | No material timing/count side channel                               |
| RLS-027 | RPC SECURITY DEFINER omits scope predicate                          | Static test fails and runtime exploit is denied                     |
| RLS-028 | Migration introduces tenant table without RLS                       | CI fails before apply                                               |
| RLS-029 | Background job processes mixed-Tenant batch                         | Each item resolves scope; no cross-Tenant write/read                |
| RLS-030 | AI/RAG retrieval crosses scope                                      | Unauthorized chunks are absent and citations remain scoped          |

## 5. Validator requirements

- Verify zero unauthorized rows and zero unauthorized mutations.
- Verify generic errors do not disclose existence, IDs, counts, names or status.
- Verify no unauthorized audit/event/job/file side effect.
- Verify allowed control user still succeeds, preventing false-positive policy tests.
- Verify query plans and indexes do not create an unacceptable isolation bypass or denial-of-service risk.
- Enumerate every tenant-scoped table, view, materialized view, function, RPC, Realtime publication and storage/file path; coverage must be 100 percent before G3.

## 6. SQL harness pattern

Use transaction-scoped test claims and roll back after each case. Never test production RLS with destructive probes. Security-definer functions require an explicit owner, fixed `search_path`, least privilege, scope predicate, and dedicated negative tests.

## 7. Gate criteria

G1 requires a table/function/policy inventory and expected access matrix. G2 requires automated positive/negative tests. G3 requires full deployed-path isolation tests. G4 requires alerting for repeated denied probes and policy drift. G5 requires pilot roles and devices to match the approved matrix.
