# KitLuy Security Test Plan

| Field | Value |
|---|---|
| Filename | `kitluy-security-test-plan-v1.0.0.md` |
| Version | `v1.0.0` |
| Date | `2026-07-26` |
| Owner | HET / KitLuy Suite Project Owner |
| Phase | Phase 1 - Laundry |
| Status | Canonical testing and evidence specification; not execution evidence |
| Timezone | `Asia/Phnom_Penh` |
| Languages | Khmer and English |
| Currencies | KHR and USD |

> Evidence discipline: this document defines required verification. It is not proof that any capability is implemented, tested, deployed, pilot-proven, or production-ready.


## 1. Purpose

Verify the Phase 1 threat model across public websites, portals, mobile/desktop clients, Supabase, DigitalOcean, APIs, events/jobs/webhooks, Store Hub, T1-T4, files, providers, AI/MCP/RAG, releases and support operations.

Security tests are authorization- and business-effect-aware. A generic scanner pass does not prove Tenant isolation, payment safety, offline device trust, or four-eyes controls.

## 2. Rules of engagement

- Written scope, environment, data and time window are required.
- Destructive testing is prohibited in production unless separately approved and isolated.
- Real secrets and customer data are not placed in test artifacts.
- Critical findings are reported immediately through the incident path.
- Retest uses the fix build and preserves the original exploit evidence.
- Third-party testing must follow NDA, access, data-retention and deletion controls.

## 3. Coverage methods

Threat modeling; secure design review; SAST; dependency/SBOM and license scanning; secret scanning; IaC/container/image scanning; migration/RLS static analysis; DAST; API abuse tests; manual authorization/business-logic testing; mobile/desktop storage analysis; device/LAN tests; release/update tests; cloud configuration review; backup/restore access tests; AI red-teaming; and incident/alert drills.

## 4. Mandatory cases

| ID | Scenario | Pass condition |
|---|---|---|
| SEC-001 | Authentication bypass and session fixation | No bypass; session rotation and expiry correct |
| SEC-002 | OTP brute force and replay | Rate limited/locked; replay rejected |
| SEC-003 | RBAC/resource/environment scope escalation | Denied at API and RLS |
| SEC-004 | Four-eyes approval bypass | Denied; requester cannot self-approve |
| SEC-005 | Support impersonation without consent | Denied |
| SEC-006 | Expired/revoked consent | Active access terminated |
| SEC-007 | Cross-tenant direct object reference | No data or metadata leak |
| SEC-008 | SQL/NoSQL/command/template injection | Input rejected/encoded; no execution |
| SEC-009 | Stored/reflected DOM XSS | No script execution; CSP and encoding effective |
| SEC-010 | CSRF on sensitive browser mutation | Request rejected without valid anti-CSRF/session context |
| SEC-011 | Open redirect and unsafe return URL | Rejected |
| SEC-012 | Mass assignment of role/scope/tenant/device fields | Server ignores unauthorized fields |
| SEC-013 | API rate-limit bypass | Limits apply by actor, token, IP and resource as designed |
| SEC-014 | Idempotency abuse | No replayed or altered business effect |
| SEC-015 | Webhook forgery and replay | Invalid/replayed delivery rejected |
| SEC-016 | Connector direct database network attempt | Blocked and alerted |
| SEC-017 | Secret leakage in logs/traces/UI/export | No raw secret present |
| SEC-018 | File cross-tenant access and path/key guessing | Denied; signed URL scoped and expires |
| SEC-019 | Malicious file type/content | Quarantined or rejected; metadata safe |
| SEC-020 | Store Hub cloned OS/NVMe/certificate | Provisioning and challenge fail; device quarantined |
| SEC-021 | Lost/stolen device revocation | Sessions and reconnect blocked |
| SEC-022 | Terminal role tampering | Assigned role remains authoritative |
| SEC-023 | LAN rogue client calls Hub API | Mutual trust/auth fails |
| SEC-024 | Release signature or checksum tamper | Install blocked |
| SEC-025 | Downgrade to vulnerable release/config | Blocked unless approved rollback policy permits signed target |
| SEC-026 | Dependency/supply-chain malicious package | Policy/lockfile/signature/scanning blocks or flags |
| SEC-027 | Container/IaC misconfiguration | Policy-as-code fails build/deploy |
| SEC-028 | Production secret used in development | Denied and alerted |
| SEC-029 | Backup unauthorized access | Denied; encryption and access audit verified |
| SEC-030 | Restore into wrong Tenant/environment | Blocked by procedure and validation |
| SEC-031 | AI prompt injection in RAG source | Tool/data scope and human confirmation prevent unsafe action |
| SEC-032 | AI retrieves unauthorized Tenant source | No unauthorized chunk or citation |
| SEC-033 | Sensitive AI tool call without approval | No execution |
| SEC-034 | Audit tamper/delete attempt | Denied; integrity monitoring alerts |
| SEC-035 | Denial of service against public endpoints | Rate limiting/challenge/degradation protects core services |
| SEC-036 | Repeated failed privileged actions | Alert and response workflow triggers |


## 5. Finding severity

Critical includes Tenant escape, unauthorized payment/custody/finance effect, remote code execution, signing-key compromise, unrecoverable data loss, or broad secret exposure. High includes material privilege escalation, device trust bypass, persistent XSS on privileged surfaces, or auditable-control bypass. Severity includes exploitability, scope, data/business effect, detection and recovery.

## 6. Evidence and closure

Each finding records affected asset/version, exact reproduction, request/log/trace IDs, impact, severity, root cause, remediation owner/date, fix SHA, regression test ID, retest result, and residual risk approval. Closing a ticket without a passing regression test is not closure.

## 7. Gate mapping

G0/G1 approve threat model, data classification and security requirements. G2 runs static and component security tests. G3 runs deployed authorization, API, device, offline and business-logic tests. G4 runs infrastructure, release, backup, alert and incident drills plus independent assessment. G5 confirms pilot controls and no unresolved Critical/High finding within the approved exit policy.
