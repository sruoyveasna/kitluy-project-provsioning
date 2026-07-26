# KitLuy Phase 1 Security Test Plan

**Filename:** `kitluy-security-test-plan-phase1-v1.0.0.md`  
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

This plan proves that the security contracts are enforced across UI, APIs, Edge Functions, trusted workers, PostgreSQL/RLS, cloud infrastructure, Store Hub, T1–T4, devices, connectors, secrets, files, payments, AI, and release pipelines.

## 2. Evidence rule

A test is not passed by a screenshot or planning checkbox. Evidence includes applicable test code, environment/build SHA, migration version, policy/registry versions, inputs, expected/actual results, logs, audit/correlation IDs, and reviewer.

Skipped, flaky, or partially executed tests remain visible and cannot be summarized as passed.

## 3. Test levels

- static analysis and secret scanning;
- schema/migration and RLS inspection;
- unit and policy evaluation tests;
- API/contract/fuzz/negative tests;
- integration and end-to-end tests;
- hardware/edge/physical tamper tests;
- chaos, replay, concurrency, and fault injection;
- vulnerability scanning and penetration testing;
- backup/restore and incident-response drills;
- pilot security monitoring and access review.

## 4. Required test matrix

| Test ID         | Domain           | Scenario                                                                      | Method                   | Control/contract         | Priority |
| --------------- | ---------------- | ----------------------------------------------------------------------------- | ------------------------ | ------------------------ | -------- |
| `SEC-AUTH-001`  | Authentication   | Partner identity cannot access Admin Portal                                   | Negative E2E             | HET-only boundary        | P0       |
| `SEC-AUTH-002`  | Authentication   | Service identity cannot log into human UI                                     | API/UI negative          | Service policy           | P0       |
| `SEC-AUTH-003`  | Authentication   | Disabled/dormant/departed user cannot renew session                           | Integration              | Identity lifecycle       | P0       |
| `SEC-AUTH-004`  | Authentication   | Stale re-authentication fails A2–A4 action                                    | API negative             | Sensitive-action policy  | P0       |
| `SEC-AUTH-005`  | Authentication   | MFA policy applies to A4 subjects/actions                                     | E2E                      | Approved MFA policy      | P0       |
| `SEC-RBAC-001`  | RBAC             | Team membership alone grants no access                                        | API/RLS negative         | Permission registry      | P0       |
| `SEC-RBAC-002`  | RBAC             | Role name without explicit permission is denied                               | API negative             | Permission registry      | P0       |
| `SEC-RBAC-003`  | RBAC             | Unknown/deprecated permission fails closed                                    | Unit/contract            | Permission registry      | P0       |
| `SEC-RBAC-004`  | RBAC             | Wildcard grants rejected in production                                        | Migration/contract       | Permission registry      | P0       |
| `SEC-RBAC-005`  | RBAC             | Permission deprecation preserves historical decisions                         | Data/audit               | Registry lifecycle       | P1       |
| `SEC-SCOPE-001` | Scope            | Tenant-scoped actor cannot access another Tenant                              | API/RLS negative         | Scope model              | P0       |
| `SEC-SCOPE-002` | Scope            | Digital Store scope excludes sibling Stores                                   | API/RLS negative         | Scope model              | P0       |
| `SEC-SCOPE-003` | Scope            | Location scope excludes sibling/parent authority                              | API/RLS negative         | Scope model              | P0       |
| `SEC-SCOPE-004` | Scope            | Device scope excludes Hub/sibling devices                                     | API negative             | Scope model              | P0       |
| `SEC-SCOPE-005` | Scope            | Staging grant cannot execute production action                                | API negative             | Environment model        | P0       |
| `SEC-SCOPE-006` | Scope            | Exclusion overrides inherited inclusion                                       | Policy unit/integration  | Scope model              | P0       |
| `SEC-SCOPE-007` | Scope            | Client-modified target IDs/metadata do not widen scope                        | API/RLS negative         | Server target derivation | P0       |
| `SEC-SCOPE-008` | Scope            | Sensitive cohort membership change invalidates approval                       | Integration              | Snapshot hash            | P1       |
| `SEC-APR-001`   | Approval         | Requester cannot approve own request                                          | API negative             | Four-eyes                | P0       |
| `SEC-APR-002`   | Approval         | Approver without target scope/environment denied                              | API negative             | Four-eyes                | P0       |
| `SEC-APR-003`   | Approval         | Payload hash change denies execution                                          | API negative             | Token binding            | P0       |
| `SEC-APR-004`   | Approval         | Target/environment change denies execution                                    | API negative             | Token binding            | P0       |
| `SEC-APR-005`   | Approval         | Expired/revoked token denied                                                  | API negative             | Token lifecycle          | P0       |
| `SEC-APR-006`   | Approval         | Single-use token cannot replay                                                | Concurrency/API          | Exactly once             | P0       |
| `SEC-APR-007`   | Approval         | Retry creates one business effect                                             | Fault injection          | Idempotency              | P0       |
| `SEC-APR-008`   | Approval         | SoD blocks rollout creator Stable self-approval                               | E2E                      | SoD matrix               | P0       |
| `SEC-APR-009`   | Approval         | Break-glass auto-expires and creates review                                   | E2E/time travel          | A4 policy                | P0       |
| `SEC-AUD-001`   | Audit            | Privileged allow/deny records assignment, permission, scope, env, policy      | Integration              | Audit envelope           | P0       |
| `SEC-AUD-002`   | Audit            | Audit table rejects update/delete by app roles                                | Database negative        | Append-only              | P0       |
| `SEC-AUD-003`   | Audit            | Transaction and audit/outbox are atomic                                       | Fault injection/database | No missing audit         | P0       |
| `SEC-AUD-004`   | Audit            | Export checksum and manifest verify                                           | Integration              | Evidence integrity       | P1       |
| `SEC-AUD-005`   | Audit            | Audit redacts secrets/payment credentials                                     | Automated scan           | Data minimization        | P0       |
| `SEC-SVC-001`   | Machine identity | Environment credential isolation                                              | Integration              | Service policy           | P0       |
| `SEC-SVC-002`   | Machine identity | Revoked service identity cannot claim job/token                               | Integration              | Revocation               | P0       |
| `SEC-SVC-003`   | Machine identity | Worker cannot invent missing human approval                                   | E2E negative             | Human+machine chain      | P0       |
| `SEC-SVC-004`   | Machine identity | Connector has no database network/credential access                           | Infra/security test      | Connector boundary       | P0       |
| `SEC-SVC-005`   | Machine identity | AI read identity cannot call write tool                                       | Tool policy negative     | AI/MCP                   | P0       |
| `SEC-SEC-001`   | Secrets          | Client artifacts contain no privileged secret                                 | SAST/artifact scan       | Secrets policy           | P0       |
| `SEC-SEC-002`   | Secrets          | Logs, traces, crash reports, support bundles redact secrets                   | Dynamic/scan             | Secrets policy           | P0       |
| `SEC-SEC-003`   | Secrets          | Rotated old credential denied after overlap                                   | Integration              | Rotation                 | P0       |
| `SEC-SEC-004`   | Secrets          | Non-production credential fails production                                    | Integration              | Environment separation   | P0       |
| `SEC-SEC-005`   | Secrets          | Secret access and rotation emit audit events                                  | Integration              | Audit linkage            | P1       |
| `SEC-DEV-001`   | Device trust     | Unregistered hardware cannot provision                                        | Edge E2E negative        | Device policy            | P0       |
| `SEC-DEV-002`   | Device trust     | Expired/replayed/wrong-scope code denied                                      | Edge API negative        | Provisioning             | P0       |
| `SEC-DEV-003`   | Device trust     | Copied image/NVMe without valid key denied                                    | Hardware/edge            | Clone defense            | P0       |
| `SEC-DEV-004`   | Device trust     | Duplicate certificate use detected/quarantined                                | Edge concurrency         | Clone defense            | P0       |
| `SEC-DEV-005`   | Device trust     | Revoked device cannot reconnect cloud or Hub                                  | Edge E2E                 | Revocation               | P0       |
| `SEC-DEV-006`   | Device trust     | Terminal cannot locally change T1–T4 role                                     | Tamper test              | Role binding             | P0       |
| `SEC-DEV-007`   | Device trust     | Manual IP/discovery does not bypass certificate trust                         | Network negative         | mTLS                     | P0       |
| `SEC-DEV-008`   | Device trust     | Unsigned/checksum-mismatch update rejected                                    | Supply chain E2E         | Release trust            | P0       |
| `SEC-DEV-009`   | Device trust     | A/B failed health check rolls back safely                                     | Fault injection          | Availability/integrity   | P0       |
| `SEC-DEV-010`   | Device trust     | Replacement Hub has no duplicate active identity                              | Recovery drill           | RMA                      | P0       |
| `SEC-OFF-001`   | Offline          | Offline Booking/payment/custody creates complete local audit                  | Edge E2E                 | Offline authority        | P0       |
| `SEC-OFF-002`   | Offline          | Reconnect deduplicates Booking/payment/inventory events                       | Fault/replay             | Idempotency              | P0       |
| `SEC-OFF-003`   | Offline          | Revoked/expired staff lease follows offline policy                            | Time/edge negative       | Offline auth             | P0       |
| `SEC-OFF-004`   | Offline          | Cloud-only A3/A4 action cannot execute offline                                | Edge negative            | Sensitive policy         | P0       |
| `SEC-OFF-005`   | Offline          | T3 cannot release custody; T4 required                                        | Edge permission E2E      | T1–T4                    | P0       |
| `SEC-SUP-001`   | Support          | No impersonation without active consent                                       | API/UI negative          | Support policy           | P0       |
| `SEC-SUP-002`   | Support          | Consent expiry/revocation terminates session                                  | E2E/time                 | Support policy           | P0       |
| `SEC-SUP-003`   | Support          | Read consent cannot perform write intervention                                | API negative             | Consent class            | P0       |
| `SEC-SUP-004`   | Support          | Every resource view/export/command audited                                    | E2E                      | Intervention log         | P0       |
| `SEC-SUP-005`   | Support          | Support scope cannot cross sibling resources                                  | API/RLS negative         | Consent scope            | P0       |
| `SEC-SUP-006`   | Support          | C5 path requires A4 incident/legal evidence                                   | E2E negative             | Emergency authority      | P1       |
| `SEC-API-001`   | API              | Mutating retry requires idempotency key where specified                       | Contract                 | API standard             | P0       |
| `SEC-API-002`   | API              | Authorization denial uses stable code/correlation without policy leakage      | Contract                 | Error standard           | P1       |
| `SEC-API-003`   | API              | Rate limits by actor/Tenant/device/connector                                  | Load/security            | Abuse resistance         | P1       |
| `SEC-API-004`   | API              | Webhook forgery, stale timestamp, replay, duplicate denied                    | Integration/fuzz         | Connector API            | P0       |
| `SEC-API-005`   | API              | Mass assignment/unknown fields do not change protected scope                  | Fuzz/API                 | Input validation         | P0       |
| `SEC-DATA-001`  | Data integrity   | Finalized finance/payment/inventory/audit rows reject destructive edit        | Database negative        | Append-only              | P0       |
| `SEC-DATA-002`  | Data integrity   | Correction creates compensating record/event                                  | Integration              | Ledger rules             | P0       |
| `SEC-DATA-003`  | Data integrity   | RLS enabled and covered on all scoped tables                                  | Schema inspection        | Tenant isolation         | P0       |
| `SEC-DATA-004`  | Data integrity   | Backup restore verifies RPO/RTO and access controls                           | Recovery drill           | DR                       | P0       |
| `SEC-FILE-001`  | Files            | Private object not accessible without valid signed authorization              | Integration              | File service             | P0       |
| `SEC-FILE-002`  | Files            | Signed URL expires and is scope-bound                                         | Time/integration         | File service             | P0       |
| `SEC-FILE-003`  | Files            | Object checksum mismatch detected                                             | Integrity test           | File service             | P1       |
| `SEC-PAY-001`   | Payments         | KHQR/provider callback signature and amount/currency bound                    | Integration              | Payment integrity        | P0       |
| `SEC-PAY-002`   | Payments         | UI payment success without authoritative callback/reconciliation not accepted | E2E negative             | Truth labeling           | P0       |
| `SEC-PAY-003`   | Payments         | Refund/void policy enforces re-auth/reason/approval                           | E2E                      | Sensitive action         | P0       |
| `SEC-AI-001`    | AI               | Cross-Tenant retrieval blocked before model context                           | Integration/attack       | RAG scope                | P0       |
| `SEC-AI-002`    | AI               | Prompt injection cannot obtain secrets or broaden tool scope                  | Adversarial              | AI/MCP                   | P0       |
| `SEC-AI-003`    | AI               | Sensitive tool call requires human approval and is audited                    | E2E                      | AI human confirmation    | P0       |
| `SEC-REL-001`   | Supply chain     | Dependency/container/SBOM vulnerability scan gates release                    | CI                       | Supply chain             | P0       |
| `SEC-REL-002`   | Supply chain     | Artifact provenance/signature verified before promotion/install               | CI/E2E                   | Release trust            | P0       |
| `SEC-REL-003`   | Supply chain     | Production deploy requires protected environment/approval                     | CI/CD                    | Deployment control       | P0       |
| `SEC-PERF-001`  | Resilience       | Authorization service fail/timeout fails closed for privileged action         | Fault injection          | Fail closed              | P0       |
| `SEC-PERF-002`  | Resilience       | Store operations continue during WAN outage                                   | Chaos/edge               | Availability             | P0       |
| `SEC-PERF-003`  | Resilience       | Queue retry/backoff does not amplify duplicate effects                        | Load/fault               | Idempotency              | P0       |
| `SEC-IR-001`    | Incident         | Secret compromise rotation drill completes                                    | Tabletop/technical       | IR                       | P1       |
| `SEC-IR-002`    | Incident         | Lost device revocation/replacement drill completes                            | Tabletop/edge            | IR                       | P0       |
| `SEC-IR-003`    | Incident         | Cross-Tenant access alert and containment drill completes                     | Tabletop/technical       | IR                       | P0       |

## 5. Tooling and environments

Required categories, exact tools `[REQUIRED: approved toolchain]`:

- SAST and dependency/SBOM scanning;
- secret and high-entropy scanning;
- IaC/container/image scanning;
- DAST/API fuzzing;
- PostgreSQL/RLS policy tests;
- mobile/Electron/client artifact inspection;
- TLS/mTLS/certificate tests;
- hardware secure-boot/key-export/tamper tests;
- load/chaos/fault injection;
- centralized security log and alert validation.

Production data/secrets are not used in development tests. Pilot tests use approved limited cohorts and controlled evidence.

## 6. Release gates

| Gate                         | Security exit condition                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `G0 Authority`               | Security owners, open values, accepted risks, and prohibited patterns recorded.                            |
| `G1 Contract`                | Permission, scope, approval, audit, identity, device, secret, threat, and test contracts approved.         |
| `G2 Build`                   | P0 automated tests implemented and green in development; no critical secret/vulnerability findings.        |
| `G3 Integrated verification` | P0 cross-product, RLS, approval, device, offline, payment, support, AI, replay, recovery tests pass.       |
| `G4 Pilot readiness`         | Independent security review/penetration test, monitoring/alerts, IR drills, access review, rollback ready. |
| `G5 Phase exit`              | Pilot evidence approved; no unaccepted critical/high risk; Rebuild Test passes.                            |

## 7. Vulnerability treatment

- Critical: block promotion/go-live unless owner/security-approved emergency exception with compensating controls and expiry.
- High: block production unless approved risk process explicitly permits; default is remediation.
- Medium/Low: tracked with owner, SLA, and regression test where applicable.
- Severity framework and SLA: `[REQUIRED: approved standard and timelines]`.

## 8. Penetration testing scope

At minimum:

- authentication/session/MFA;
- RBAC/scope/environment/approval bypass;
- Supabase RLS and security-definer functions;
- API mass assignment, injection, SSRF, IDOR/BOLA, rate-limit abuse;
- Storefront/Telegram/webhook trust;
- connector and payment callbacks;
- files/signed URLs;
- Admin/support impersonation;
- AI/RAG/MCP prompt/tool attacks;
- Store LAN, Hub, terminal pairing, certificate, update, and physical clone attempts;
- CI/CD, artifact provenance, and secret exposure.

## 9. Test data and fixtures

Use idempotent fixtures for:

- at least two Tenants, multiple Digital Stores, sibling Locations;
- HET teams/roles with conflicting and non-conflicting assignments;
- development/staging/pilot/production contexts;
- active/expired/revoked approvals and consent sessions;
- registered/unregistered/revoked/cloned devices;
- T1/T2/T3/T4 assignments;
- cash/KHQR successful, failed, duplicate, and mismatched payments;
- offline outbox/reconnect and duplicate delivery;
- sensitive and non-sensitive file classes;
- AI read-only and write-tool policies.

## 10. Security evidence package

Each candidate package contains:

- test manifest and result summary;
- full failing/skipped list;
- build/container/image/SBOM identifiers;
- migration/schema/RLS versions;
- permission/scope/approval/audit registry versions;
- device image/release/trust-bundle versions;
- vulnerability findings and dispositions;
- penetration-test report;
- backup/restore and incident drill evidence;
- pilot monitoring/anomaly review;
- owner/security sign-off and accepted-risk register.

## 11. Regression policy

Any change to permission, scope, approval, audit, machine identity, device trust, secrets, API, RLS, payment, offline sync, support, AI tools, releases, or infrastructure automatically selects the relevant tests. P0 tests cannot be waived by a product team without the approved risk process.

## Appendix A — Open values

- `[REQUIRED: approved tools and CI integration]`
- `[REQUIRED: security severity standard and remediation SLA]`
- `[REQUIRED: independent penetration tester and cadence]`
- `[REQUIRED: load/chaos targets and alert thresholds]`
- `[REQUIRED: pilot monitoring duration and exit criteria]`
