# KitLuy Phase 1 Security Test System

| Field                           | Value                                                                                                                                                                                                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filename                        | `kitluy-phase1-security-test-system-v1.0.0.md`                                                                                                                                                                                                                                                                      |
| Version                         | v1.0.0                                                                                                                                                                                                                                                                                                              |
| Date                            | 2026-07-26                                                                                                                                                                                                                                                                                                          |
| Owner                           | HET / KitLuy Suite Project Owner                                                                                                                                                                                                                                                                                    |
| Work item                       | SEC-CONS-001                                                                                                                                                                                                                                                                                                        |
| Authority                       | Owner direction [KLD-2026-07-26-003 §3](../authority/kitluy-decision-and-reconciliation-register-v1.0.0.md) — consolidate the two security test plans into ONE governing Phase 1 security test system                                                                                                               |
| Consolidates                    | Plan A: [`kitluy-security-test-plan-phase1-v1.0.0.md`](../source/security/kitluy-security-test-plan-phase1-v1.0.0.md) (90 namespaced `SEC-<DOMAIN>-###` IDs) and Plan B: [`kitluy-security-test-plan-v1.0.0.md`](../source/qa/kitluy-security-test-plan-v1.0.0.md) (36 flat `SEC-###` IDs plus rules of engagement) |
| Incorporates                    | The 64 Security-domain `KLT-*` rows of [`kitluy-test-case-registry-phase1-v1.0.0.csv`](../source/qa/kitluy-test-case-registry-phase1-v1.0.0.csv)                                                                                                                                                                    |
| Status                          | Canonical governing security test system; CONTRACT-APPROVED pending independent review                                                                                                                                                                                                                              |
| Phase                           | Phase 1 — Laundry, designed as a shared cross-vertical foundation                                                                                                                                                                                                                                                   |
| Locales / currencies / timezone | Khmer and English; KHR and USD; `Asia/Phnom_Penh`                                                                                                                                                                                                                                                                   |

> **Implementation truth:** this document specifies required verification. It is not
> proof that any control, repository, migration, test, deployment, certificate, key
> store, or production safeguard exists. `IMPLEMENTED` requires verified evidence.
> Every canonical record below carries execution status `SPECIFIED_NOT_EXECUTED`.

## 1. Consolidation mandate and immutable alias rules

This is the ONE governing Phase 1 security test system ordered by owner direction
KLD-2026-07-26-003 §3 (work item SEC-CONS-001, resolving conflict KLREC-2026-07-26-017).
It supersedes neither source document's text: both remain immutable classified copies
at their `docs/source/` locations and are never edited.

Binding rules:

1. **Both source identifier namespaces are preserved as immutable aliases.** No
   `SEC-<DOMAIN>-###` (Plan A), `SEC-###` (Plan B), or `KLT-*` (registry) identifier is
   ever deleted, renumbered, or reinterpreted. Each alias keeps exactly the meaning
   given by its source document.
2. **Canonical executable records receive new `KLSEC-###` IDs**, assigned by merged
   topic (§7). The canonical namespace is additive; it retires nothing.
3. **A merged record does not shrink coverage.** Where one `KLSEC` record carries
   several aliases, every alias remains an individually citable executable sub-case;
   a `KLSEC` record only counts as executed when evidence covers every aliased source
   scenario. No alias may be silently dropped.
4. **Disambiguation:** flat IDs `SEC-001`…`SEC-036` always refer to Plan B; IDs with a
   domain segment (`SEC-AUTH-001`, `SEC-RBAC-004`, …, including `SEC-SEC-001`…`SEC-SEC-005`)
   always refer to Plan A; `KLT-*` IDs always refer to the test-case registry.
5. Future changes append new `KLSEC` records or new aliases; they never rewrite history.

## 2. Authority order and source baseline

Authority order (from Plan A, unchanged):

1. Current owner decisions and active KitLuy Project Instructions.
2. Applied migrations, verified code/tests, deployment records, and production evidence.
3. This security and authorization pack.
4. Current KitLuy Rebuild and Business Bibles and approved product specifications.
5. Approved handoffs and registries.
6. Evidence-based competitor analyses and classifications.
7. Competitor clone documents and superseded planning.

Primary source baseline (from Plan A, unchanged):

- `kitluy-admin-pwa-portal-phase1-spec-v3.1.0.md` — explicit permissions, scopes,
  environments, A0–A4 approvals, service-identity isolation, access review, support
  consent, audit, and three-layer enforcement.
- `kitluy-storehub-phase1-spec-v1.0.0.md` — managed-device trust, manufacturing and
  operational certificates, secure boot, cloned-device defenses, Hub-first
  provisioning, replacement and recovery.
- `kitluy-ecosystem-infrastructure-phase1-spec-v1.0.0.md` — Supabase/DigitalOcean
  responsibility split, secret classes, PKI custody, CI/CD, cloud/edge boundaries, and
  progressive infrastructure controls.
- Current KitLuy Project Instructions — Digital Store authority, Store Hub offline
  operation, append-only finance/payment/inventory/audit truth, human confirmation for
  sensitive actions, and no connector direct database access.

## 3. Shared security invariants

- Role names organize grants; they are never authoritative by themselves.
- Every privileged request resolves an explicit permission, target resource, resource
  scope, environment, identity type, validity window, and policy version.
- Missing context fails closed.
- Frontend visibility is not a security boundary. API/worker authorization and
  Supabase RLS/database rules are mandatory.
- Sensitive finance, permission, compliance, safety, release, migration, device, and
  production actions require authorized human confirmation according to policy.
- Finalized audit records are append-only; corrections create new events.
- Service accounts and device identities cannot inherit human team membership or
  interactive login rights.
- No browser, POS client, Storefront, connector, or ordinary operator receives
  Supabase service-role credentials, CA private keys, release signing keys, or other
  platform root secrets.
- Store Hub and T1–T4 remain operational offline after provisioning; offline
  continuity does not weaken identity, permission, custody, payment, or audit
  requirements.
- Security tests are authorization- and business-effect-aware. A generic scanner pass
  does not prove Tenant isolation, payment safety, offline device trust, or four-eyes
  controls.

## 4. Rules of engagement

Adopted from Plan B §2 and binding for every execution of this system:

- Written scope, environment, data and time window are required.
- Destructive testing is prohibited in production unless separately approved and isolated.
- Real secrets and customer data are not placed in test artifacts.
- Critical findings are reported immediately through the incident path.
- Retest uses the fix build and preserves the original exploit evidence.
- Third-party testing must follow NDA, access, data-retention and deletion controls.

## 5. Canonical record structure

Every canonical record in §7 carries:

- **KLSEC ID** — new canonical identifier, assigned by merged topic.
- **Source aliases** — the immutable Plan A / Plan B / `KLT-*` identifiers it fulfils.
- **Scope** — the target surface or control boundary.
- **Gate** — the release gate (G0–G5, §11) by which the record must be green; `G2` =
  static/CI, `G3` = integrated verification, `G4` = pilot-readiness drills, chaos/load,
  and independent adversarial work.
- **Priority** — `P0`/`P1` (highest priority among merged aliases wins; e.g. `SEC-API-003`
  was P1 in Plan A but merges with mandatory Plan B `SEC-013`, so the record is P0).
- **Evidence requirement** — evidence classes below.
- **Execution status** — `SPECIFIED_NOT_EXECUTED` for every record (§18).

Evidence classes:

| Class | Evidence requirement                                                                                                                                                                                                                |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EV-A  | Executable test record: test code reference, environment and build SHA, migration set, policy/registry versions, fixture IDs, inputs, expected vs actual results, logs/traces with request and audit/correlation IDs, and reviewer. |
| EV-B  | Database/RLS validator output: positive and negative query results against the deployed schema, RLS policy inventory, migration version.                                                                                            |
| EV-C  | Scanner/CI report: tool and version, ruleset, raw findings, dispositions, gating decision.                                                                                                                                          |
| EV-D  | Device/edge bench evidence: device identity/serial, image and release versions, certificate fingerprints, console/log capture, physical procedure record.                                                                           |
| EV-E  | Drill report: scenario, timeline, participants, actions, outcome, gaps, follow-up owners.                                                                                                                                           |
| EV-F  | Independent adversarial report: tester identity, scope, methodology, exploit evidence, retest results.                                                                                                                              |

A test is not passed by a screenshot or planning checkbox. Skipped, flaky, or
partially executed tests remain visible and cannot be summarized as passed.

## 6. Merged coverage matrix

| #   | Merged topic                                    | KLSEC records                | Plan A IDs | Plan B IDs | KLT rows | KLT-only records |
| --- | ----------------------------------------------- | ---------------------------- | ---------- | ---------- | -------- | ---------------- |
| 1   | Authentication, session, and identity lifecycle | `KLSEC-001`…`KLSEC-010` (10) | 5          | 2          | 5        | 3                |
| 2   | RBAC and permission registry                    | `KLSEC-011`…`KLSEC-017` (7)  | 5          | 1          | 1        | 1                |
| 3   | Resource scope, tenancy, and environment        | `KLSEC-018`…`KLSEC-025` (8)  | 8          | 1          | 3        | 0                |
| 4   | Sensitive actions, approvals, and four-eyes     | `KLSEC-026`…`KLSEC-034` (9)  | 9          | 1          | 6        | 2                |
| 5   | Audit and evidence integrity                    | `KLSEC-035`…`KLSEC-039` (5)  | 4          | 1          | 1        | 1                |
| 6   | Machine identity and connector boundary         | `KLSEC-040`…`KLSEC-043` (4)  | 5          | 2          | 2        | 0                |
| 7   | Secrets and key custody                         | `KLSEC-044`…`KLSEC-049` (6)  | 5          | 1          | 12       | 2                |
| 8   | Device and edge trust                           | `KLSEC-050`…`KLSEC-065` (16) | 10         | 5          | 22       | 6                |
| 9   | Offline continuity                              | `KLSEC-066`…`KLSEC-070` (5)  | 5          | 0          | 1        | 0                |
| 10  | Support access and consent                      | `KLSEC-071`…`KLSEC-076` (6)  | 6          | 2          | 4        | 0                |
| 11  | API, web, and input security                    | `KLSEC-077`…`KLSEC-086` (10) | 5          | 8          | 5        | 1                |
| 12  | Data integrity and recovery                     | `KLSEC-087`…`KLSEC-091` (5)  | 4          | 2          | 1        | 0                |
| 13  | File and object security                        | `KLSEC-092`…`KLSEC-094` (3)  | 3          | 2          | 0        | 0                |
| 14  | Payments                                        | `KLSEC-095`…`KLSEC-097` (3)  | 3          | 0          | 0        | 0                |
| 15  | AI, RAG, and MCP                                | `KLSEC-098`…`KLSEC-101` (4)  | 4          | 3          | 0        | 0                |
| 16  | Release and supply chain                        | `KLSEC-102`…`KLSEC-106` (5)  | 3          | 3          | 1        | 0                |
| 17  | Resilience and abuse detection                  | `KLSEC-107`…`KLSEC-111` (5)  | 3          | 2          | 0        | 0                |
| 18  | Incident response drills                        | `KLSEC-112`…`KLSEC-114` (3)  | 3          | 0          | 0        | 0                |
| —   | **Total**                                       | **114**                      | **90**     | **36**     | **64**   | **16**           |

Reconciliation totals: 190 source identifiers (90 Plan A + 36 Plan B + 64 registry)
map into 114 canonical records. Every source identifier is mapped exactly once;
none is unmappable. 48 registry rows merge into plan-derived records; the 16 registry
rows with no counterpart in either plan become their own canonical records (§8.3).

## 7. Canonical executable security records

All records: execution status `SPECIFIED_NOT_EXECUTED` (repeated per row by rule).

### 7.1 Authentication, session, and identity lifecycle

| KLSEC ID    | Canonical scenario                                                                              | Source aliases                                  | Scope                                                 | Gate | Priority | Evidence | Execution status       |
| ----------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------------- | ---- | -------- | -------- | ---------------------- |
| `KLSEC-001` | Partner identity cannot access the Admin Portal (HET-only boundary)                             | `SEC-AUTH-001`                                  | Admin Portal authentication boundary                  | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-002` | Service identity cannot log into any human UI                                                   | `SEC-AUTH-002`                                  | All human UIs; service/machine identities             | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-003` | Disabled/dormant/departed user cannot renew or continue a session                               | `SEC-AUTH-003`                                  | Identity lifecycle; all portals and clients           | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-004` | Stale re-authentication fails an A2-A4 sensitive action                                         | `SEC-AUTH-004`                                  | Sensitive-action policy; Admin Portal and APIs        | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-005` | MFA policy applies to A4 subjects and actions                                                   | `SEC-AUTH-005`                                  | A4 subjects/actions per approved MFA policy           | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-006` | No authentication bypass or session fixation; session rotation and expiry correct               | `SEC-001`                                       | All authentication surfaces (websites, portals, apps) | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-007` | OTP brute force is rate-limited/locked; OTP replay is rejected                                  | `SEC-002`; `KLT-KB2B-QA-032`; `KLT-KB2B-QA-033` | OTP flows (B2B website registration/login)            | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-008` | Phone registration verifies OTP, stores the phone normalized, and creates a registration intent | `KLT-KB2B-QA-030`                               | B2B website public registration                       | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-009` | No stale authenticated response is served from service worker or CDN cache                      | `KLT-KB2B-QA-066`                               | B2B website caching layers                            | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-010` | Revoking a high-risk assignment invalidates affected sessions/tokens                            | `KLT-ADMIN-QA-075`                              | Admin Portal assignment lifecycle                     | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |

### 7.2 RBAC and permission registry

| KLSEC ID    | Canonical scenario                                                          | Source aliases     | Scope                                      | Gate | Priority | Evidence   | Execution status       |
| ----------- | --------------------------------------------------------------------------- | ------------------ | ------------------------------------------ | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-011` | Team membership alone grants no access                                      | `SEC-RBAC-001`     | Permission registry; API and RLS           | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-012` | Role name without an explicit permission is denied                          | `SEC-RBAC-002`     | Permission registry; API                   | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-013` | Unknown or deprecated permission fails closed                               | `SEC-RBAC-003`     | Policy evaluation (unit/contract)          | G2   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-014` | Wildcard grants are rejected in production                                  | `SEC-RBAC-004`     | Permission registry migrations/contracts   | G2   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-015` | Permission deprecation preserves historical decisions                       | `SEC-RBAC-005`     | Registry lifecycle; audit data             | G3   | P1       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-016` | Combined RBAC/resource/environment escalation is denied at both API and RLS | `SEC-003`          | All privileged APIs plus RLS               | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-017` | Infrastructure operator cannot execute a billing action                     | `KLT-INFRA-QA-027` | Infrastructure/billing permission boundary | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.3 Resource scope, tenancy, and environment

| KLSEC ID    | Canonical scenario                                                                                    | Source aliases                      | Scope                                             | Gate | Priority | Evidence   | Execution status       |
| ----------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-018` | Cross-Tenant access and direct object reference denied; no data or metadata leak                      | `SEC-SCOPE-001`; `SEC-007`          | Tenant isolation; API and RLS                     | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-019` | Digital Store scope excludes sibling Stores; cross-Store payload injection is rejected and not cached | `SEC-SCOPE-002`; `KLT-KPA2-QA-004`  | Digital Store scope; Partner App repository layer | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-020` | Location scope excludes sibling/parent authority                                                      | `SEC-SCOPE-003`                     | Location scope; API and RLS                       | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-021` | Device scope excludes Hub and sibling devices                                                         | `SEC-SCOPE-004`                     | Device scope; edge APIs                           | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-022` | Staging/non-production grant cannot execute a production action                                       | `SEC-SCOPE-005`; `KLT-INFRA-QA-029` | Environment model; infrastructure controls        | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-023` | Exclusion overrides inherited inclusion                                                               | `SEC-SCOPE-006`                     | Scope policy evaluation                           | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-024` | Client-modified target IDs/metadata do not widen scope (server-side target derivation)                | `SEC-SCOPE-007`; `KLT-KPM-QA-072`   | All clients; server target derivation             | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-025` | Sensitive cohort membership change invalidates the prior approval (snapshot hash)                     | `SEC-SCOPE-008`                     | Approval snapshot binding                         | G3   | P1       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.4 Sensitive actions, approvals, and four-eyes

| KLSEC ID    | Canonical scenario                                                                                                                             | Source aliases                          | Scope                                               | Gate | Priority | Evidence   | Execution status       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-026` | Requester cannot approve own request; sensitive production action requires fresh re-authentication, reason, and independent four-eyes approval | `SEC-APR-001`; `SEC-004`; `KLT-SEC-002` | Four-eyes across all A2-A4 actions                  | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-027` | Approver without target scope/environment is denied                                                                                            | `SEC-APR-002`                           | Approval authority checks                           | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-028` | Approval token is bound to payload hash, target, and environment; any change denies execution                                                  | `SEC-APR-003`; `SEC-APR-004`            | Approval token binding                              | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-029` | Expired or revoked approval cannot execute                                                                                                     | `SEC-APR-005`; `KLT-ADMIN-QA-071`       | Approval token lifecycle                            | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-030` | Approved execution is exactly-once: single-use token cannot replay; retry creates one business effect                                          | `SEC-APR-006`; `SEC-APR-007`            | Approval execution; concurrency and fault injection | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-031` | Separation of duties blocks the release requester/rollout creator from Stable self-approval                                                    | `SEC-APR-008`; `KLT-INFRA-QA-028`       | SoD matrix; release promotion                       | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-032` | Break-glass access auto-expires and creates a mandatory review                                                                                 | `SEC-APR-009`; `KLT-INFRA-QA-031`       | A4 break-glass policy                               | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-033` | Temporary Admin access activates only in the approved window and auto-revokes                                                                  | `KLT-ADMIN-QA-074`                      | Admin Portal temporary assignments                  | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-034` | Expired temporary infrastructure access is immediately denied per policy                                                                       | `KLT-INFRA-QA-030`                      | Infrastructure temporary access                     | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.5 Audit and evidence integrity

| KLSEC ID    | Canonical scenario                                                                           | Source aliases           | Scope                                 | Gate | Priority | Evidence   | Execution status       |
| ----------- | -------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-035` | Privileged allow/deny records assignment, permission, scope, environment, and policy version | `SEC-AUD-001`            | Audit envelope; all privileged paths  | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-036` | Audit is append-only: update/delete/tamper is denied and integrity monitoring alerts         | `SEC-AUD-002`; `SEC-034` | Audit tables; app roles; monitoring   | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-037` | Business transaction and audit/outbox write are atomic (no missing audit)                    | `SEC-AUD-003`            | Transactional outbox; fault injection | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-038` | Audit export checksum and manifest verify                                                    | `SEC-AUD-004`            | Evidence export integrity             | G3   | P1       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-039` | Portal export is scope-checked, its signed link expires, and the event is audited            | `KLT-CHP3-QA-024`        | Chain Portal exports                  | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.6 Machine identity and connector boundary

| KLSEC ID    | Canonical scenario                                                                                                                           | Source aliases                                              | Scope                                                    | Gate | Priority | Evidence   | Execution status       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-040` | Environment credential separation: a non-production credential fails production and a production secret in development is denied and alerted | `SEC-SVC-001`; `SEC-SEC-004`; `SEC-028`; `KLT-INFRA-QA-001` | All environments; human, service, and device credentials | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-041` | Revoked service identity cannot claim a job or token                                                                                         | `SEC-SVC-002`                                               | Service identity revocation                              | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-042` | Worker cannot invent a missing human approval                                                                                                | `SEC-SVC-003`                                               | Human-plus-machine authority chain                       | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-043` | Connector has no database network or credential access; direct attempts are blocked and alerted                                              | `SEC-SVC-004`; `SEC-016`; `KLT-SEC-001`                     | Connector runtime boundary                               | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |

### 7.7 Secrets and key custody

| KLSEC ID    | Canonical scenario                                                                                                                                                           | Source aliases                                                                                                                             | Scope                                                  | Gate | Priority | Evidence   | Execution status       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-044` | Client artifacts and client runtime contain no privileged secret (service-role keys, raw execution tokens, platform root secrets)                                            | `SEC-SEC-001`; `KLT-ADMIN-QA-081`; `KLT-KB2B-QA-063`; `KLT-KPM-QA-070`                                                                     | Browser bundles, PWA payloads, mobile/desktop packages | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-045` | No raw secret or credential on any output surface: logs, traces, UI, exports, crash reports, support/diagnostic bundles, audit records, connector credential views           | `SEC-SEC-002`; `SEC-AUD-005`; `SEC-017`; `KLT-SEC-004`; `KLT-ADMIN-QA-026`; `KLT-CHP3-QA-027`; `KLT-PPORTAL-QA-KPP2-024`; `KLT-KPM-QA-074` | All products and services; every output surface        | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-046` | Rotation: the old credential/certificate is denied after the overlap window; services and devices reconnect through the approved rotation path without unauthorized fallback | `SEC-SEC-003`; `KLT-INFRA-QA-048`; `KLT-KPM-QA-007`                                                                                        | Credential and certificate rotation (cloud and device) | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-047` | Secret access and rotation emit audit events                                                                                                                                 | `SEC-SEC-005`                                                                                                                              | Secret store audit linkage                             | G3   | P1       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-048` | Secret committed to the repository fails CI and starts the incident workflow                                                                                                 | `KLT-INFRA-QA-032`                                                                                                                         | Repository secret scanning                             | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-049` | Production service with a missing secret fails closed at startup (no partial unsafe operation)                                                                               | `KLT-INFRA-QA-003`                                                                                                                         | Service startup; fail-closed                           | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.8 Device and edge trust

| KLSEC ID    | Canonical scenario                                                                                                         | Source aliases                                                                | Scope                                       | Gate | Priority | Evidence   | Execution status       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-050` | Unregistered hardware or an invalid manufacturing certificate cannot provision                                             | `SEC-DEV-001`; `KLT-HUB-QA-005`                                               | Hub/terminal provisioning                   | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-051` | Eligible HET-enrolled Hub provisions with correct Store assignment and operational certificate (positive control)          | `KLT-HUB-QA-001`                                                              | Hub-first provisioning                      | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-052` | Expired/replayed/wrong-scope provisioning codes and wrong Tenant/Digital Store/Location certificate claims are denied      | `SEC-DEV-002`; `KLT-KPM-QA-002`; `KLT-ADMIN-QA-015`                           | Provisioning codes and certificate claims   | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-053` | Cloned OS image/NVMe/certificate without a hardware-backed key fails provisioning and challenge; the device is quarantined | `SEC-DEV-003`; `SEC-020`; `KLT-SEC-003`; `KLT-HUB-QA-006`; `KLT-INFRA-QA-036` | Clone defense (Store Hub and unknown Pi)    | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-054` | Duplicate certificate use is detected and quarantined                                                                      | `SEC-DEV-004`                                                                 | Certificate uniqueness monitoring           | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-055` | Revoked/lost/stolen device cannot reconnect to cloud or Hub; sessions are blocked                                          | `SEC-DEV-005`; `SEC-021`; `KLT-KPM-QA-006`; `KLT-POS4-QA-032`                 | Device revocation (mobile, desktop, Hub)    | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-056` | Terminal cannot locally change its T1-T4 role; the assigned role remains authoritative                                     | `SEC-DEV-006`; `SEC-022`; `KLT-PPORTAL-QA-KPP2-023`                           | T1-T4 role binding; tamper test             | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-057` | Manual IP entry/discovery and LAN rogue clients cannot bypass mutual certificate trust (mTLS)                              | `SEC-DEV-007`; `SEC-023`; `KLT-KPM-QA-004`                                    | Store LAN; Hub API; malicious Hub           | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-058` | Unsigned/tampered/checksum-mismatch update or build is rejected at install                                                 | `SEC-DEV-008`; `SEC-024`; `KLT-HUB-QA-029`; `KLT-KPM-QA-080`                  | Device update supply chain (Hub and mobile) | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-059` | A/B update failing its health check rolls back safely                                                                      | `SEC-DEV-009`; `KLT-HUB-QA-030`                                               | Hub A/B release health                      | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-060` | Hub replacement/repair (NVMe failure, board repair, board replacement) yields no duplicate active identity                 | `SEC-DEV-010`; `KLT-HUB-QA-031`; `KLT-HUB-QA-032`; `KLT-HUB-QA-033`           | RMA/recovery; identity uniqueness           | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-061` | Signed release installs on the Hub, passes health checks, and is promoted (positive control)                               | `KLT-HUB-QA-028`                                                              | Hub release install                         | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-062` | Hub blocks IP forwarding/bridge enablement and raises a security alert                                                     | `KLT-HUB-QA-035`                                                              | Hub network hardening                       | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-063` | Local database copied from a device cannot be read without the required keys                                               | `KLT-KPM-QA-071`                                                              | Mobile at-rest protection                   | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-064` | Evidence/media access without permission is denied and audited                                                             | `KLT-KPM-QA-073`                                                              | POS evidence/media access                   | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-065` | Lock-screen notifications show no sensitive data                                                                           | `KLT-KPM-QA-075`                                                              | Mobile notification surface                 | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.9 Offline continuity

| KLSEC ID    | Canonical scenario                                                                                                | Source aliases                   | Scope                                  | Gate | Priority | Evidence   | Execution status       |
| ----------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-066` | Offline Booking/payment/custody creates a complete local audit                                                    | `SEC-OFF-001`                    | Store Hub offline authority            | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-067` | Reconnect deduplicates Booking/payment/inventory events                                                           | `SEC-OFF-002`                    | Outbox replay/idempotency              | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-068` | Revoked/expired staff lease follows offline policy; revoked membership on reconnect removes cached sensitive data | `SEC-OFF-003`; `KLT-KPA2-QA-066` | Offline auth leases; Partner App cache | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-069` | Cloud-only A3/A4 action cannot execute offline                                                                    | `SEC-OFF-004`                    | Offline sensitive-action policy        | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-070` | T3 cannot release custody; T4 is required                                                                         | `SEC-OFF-005`                    | T1-T4 custody permissions              | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |

### 7.10 Support access and consent

| KLSEC ID    | Canonical scenario                                                              | Source aliases                                                                | Scope                                         | Gate | Priority | Evidence   | Execution status       |
| ----------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-071` | No support impersonation without active scoped consent                          | `SEC-SUP-001`; `SEC-005`; `KLT-ADMIN-QA-040`                                  | Support access; Admin Portal                  | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-072` | Consent/support-session expiry or revocation terminates access (portal and Hub) | `SEC-SUP-002`; `SEC-006`; `KLT-SEC-005`; `KLT-ADMIN-QA-041`; `KLT-HUB-QA-034` | Consent lifecycle across all support surfaces | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-073` | Read consent cannot perform a write intervention                                | `SEC-SUP-003`                                                                 | Consent classes                               | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-074` | Every support resource view/export/command is audited                           | `SEC-SUP-004`                                                                 | Intervention log                              | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-075` | Support scope cannot cross sibling resources                                    | `SEC-SUP-005`                                                                 | Consent scope; API and RLS                    | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-076` | C5 emergency path requires A4 incident/legal evidence                           | `SEC-SUP-006`                                                                 | Emergency authority                           | G3   | P1       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.11 API, web, and input security

| KLSEC ID    | Canonical scenario                                                                                                                                            | Source aliases                                  | Scope                                | Gate | Priority | Evidence   | Execution status       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-077` | Mutating retry requires an idempotency key where specified; idempotency abuse cannot replay or alter a business effect                                        | `SEC-API-001`; `SEC-014`                        | API standard; all mutating endpoints | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-078` | Authorization denial uses a stable code and correlation ID without policy leakage                                                                             | `SEC-API-002`                                   | Error standard                       | G3   | P1       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-079` | Rate limits are enforced by actor/Tenant/token/IP/device/connector/resource; bypass fails                                                                     | `SEC-API-003`; `SEC-013`                        | Abuse resistance                     | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-080` | Webhook forgery, stale timestamp, replay, and duplicate deliveries are denied                                                                                 | `SEC-API-004`; `SEC-015`                        | Connector and provider webhooks      | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-081` | Mass assignment/unknown fields cannot change protected role/scope/tenant/device attributes; invitation role tampering is ignored (signed role/scope enforced) | `SEC-API-005`; `SEC-012`; `KLT-KB2B-QA-036`     | Input validation; invitation flows   | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-082` | SQL/NoSQL/command/template injection is rejected or encoded; no execution                                                                                     | `SEC-008`                                       | All input surfaces                   | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-083` | Stored/reflected/DOM XSS is blocked; CSP and output encoding are effective                                                                                    | `SEC-009`; `KLT-KB2B-QA-060`; `KLT-KB2B-QA-061` | Web surfaces; CSP                    | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-084` | CSRF and OAuth-state protection hold on sensitive browser mutations                                                                                           | `SEC-010`; `KLT-KB2B-QA-062`                    | Browser session context              | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-085` | Open redirect and unsafe return URL are rejected                                                                                                              | `SEC-011`                                       | Auth and redirect flows              | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-086` | No full phone/email/name PII appears in analytics payloads                                                                                                    | `KLT-KB2B-QA-065`                               | B2B website analytics                | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |

### 7.12 Data integrity and recovery

| KLSEC ID    | Canonical scenario                                                                                                       | Source aliases                    | Scope                                 | Gate | Priority | Evidence   | Execution status       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ------------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-087` | Finalized finance/payment/inventory/audit rows reject destructive edits                                                  | `SEC-DATA-001`                    | Append-only tables; database negative | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-088` | A correction creates a compensating record/event                                                                         | `SEC-DATA-002`                    | Ledger rules                          | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-089` | RLS is enabled and covered on all scoped tables; direct probes are denied                                                | `SEC-DATA-003`; `KLT-KB2B-QA-064` | Schema inspection plus deployed probe | G3   | P0       | EV-A, EV-B | SPECIFIED_NOT_EXECUTED |
| `KLSEC-090` | Backup restore drill verifies RPO/RTO, encryption, and access controls; unauthorized backup access is denied and audited | `SEC-DATA-004`; `SEC-029`         | DR; backup custody                    | G4   | P0       | EV-A, EV-E | SPECIFIED_NOT_EXECUTED |
| `KLSEC-091` | Restore into the wrong Tenant/environment is blocked by procedure and validation                                         | `SEC-030`                         | Restore validation                    | G4   | P0       | EV-A, EV-E | SPECIFIED_NOT_EXECUTED |

### 7.13 File and object security

| KLSEC ID    | Canonical scenario                                                                                                                      | Source aliases                            | Scope                     | Gate | Priority | Evidence | Execution status       |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------- | ---- | -------- | -------- | ---------------------- |
| `KLSEC-092` | Private object requires valid signed authorization; the signed URL is scope-bound and expires; cross-tenant path/key guessing is denied | `SEC-FILE-001`; `SEC-FILE-002`; `SEC-018` | File service; signed URLs | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-093` | Object checksum mismatch is detected                                                                                                    | `SEC-FILE-003`                            | File integrity            | G3   | P1       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-094` | Malicious file type/content is quarantined or rejected; metadata stays safe                                                             | `SEC-019`                                 | Upload pipeline           | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |

### 7.14 Payments

| KLSEC ID    | Canonical scenario                                                                  | Source aliases | Scope                     | Gate | Priority | Evidence | Execution status       |
| ----------- | ----------------------------------------------------------------------------------- | -------------- | ------------------------- | ---- | -------- | -------- | ---------------------- |
| `KLSEC-095` | KHQR/provider callback signature is verified and bound to amount/currency           | `SEC-PAY-001`  | Payment callbacks         | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-096` | UI payment success without an authoritative callback/reconciliation is not accepted | `SEC-PAY-002`  | Payment truth labeling    | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |
| `KLSEC-097` | Refund/void enforces re-authentication, reason, and approval                        | `SEC-PAY-003`  | Sensitive payment actions | G3   | P0       | EV-A     | SPECIFIED_NOT_EXECUTED |

### 7.15 AI, RAG, and MCP

| KLSEC ID    | Canonical scenario                                                                                 | Source aliases          | Scope                      | Gate | Priority | Evidence   | Execution status       |
| ----------- | -------------------------------------------------------------------------------------------------- | ----------------------- | -------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-098` | Cross-Tenant retrieval is blocked before model context; no unauthorized chunk or citation          | `SEC-AI-001`; `SEC-032` | RAG scope enforcement      | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-099` | Prompt injection cannot obtain secrets, broaden tool scope, or cause an unsafe action              | `SEC-AI-002`; `SEC-031` | Adversarial AI red-teaming | G4   | P0       | EV-A, EV-F | SPECIFIED_NOT_EXECUTED |
| `KLSEC-100` | Sensitive AI tool call requires human approval and is audited; an unapproved call does not execute | `SEC-AI-003`; `SEC-033` | AI human confirmation      | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-101` | AI read identity cannot call a write tool                                                          | `SEC-SVC-005`           | AI/MCP tool policy         | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.16 Release and supply chain

| KLSEC ID    | Canonical scenario                                                                                                      | Source aliases                    | Scope                    | Gate | Priority | Evidence   | Execution status       |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------ | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-102` | Dependency/container/SBOM vulnerability and malicious-package scanning gates the release (policy, lockfile, signature)  | `SEC-REL-001`; `SEC-026`          | CI supply chain          | G2   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-103` | Artifact provenance/signature is verified before promotion/install; a tampered container or release artifact is blocked | `SEC-REL-002`; `KLT-INFRA-QA-046` | Release trust chain      | G3   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |
| `KLSEC-104` | Production deploy requires a protected environment and approval                                                         | `SEC-REL-003`                     | CI/CD deployment control | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-105` | Downgrade to a vulnerable release/config is blocked unless the approved rollback policy permits a signed target         | `SEC-025`                         | Rollback policy          | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-106` | Container/IaC misconfiguration fails build/deploy via policy-as-code                                                    | `SEC-027`                         | IaC and container policy | G2   | P0       | EV-A, EV-C | SPECIFIED_NOT_EXECUTED |

### 7.17 Resilience and abuse detection

| KLSEC ID    | Canonical scenario                                                                                                  | Source aliases | Scope                             | Gate | Priority | Evidence   | Execution status       |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-107` | Authorization service fail/timeout fails closed for privileged actions                                              | `SEC-PERF-001` | Fail-closed under fault injection | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-108` | Store operations continue during a WAN outage                                                                       | `SEC-PERF-002` | Chaos/edge availability           | G3   | P0       | EV-A, EV-D | SPECIFIED_NOT_EXECUTED |
| `KLSEC-109` | Queue retry/backoff does not amplify duplicate effects                                                              | `SEC-PERF-003` | Load/fault idempotency            | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-110` | Public-endpoint denial of service is mitigated by rate limiting/challenge/degradation; core services stay protected | `SEC-035`      | Public endpoints under load       | G4   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-111` | Repeated failed privileged actions trigger the alert and response workflow                                          | `SEC-036`      | Detection and alerting            | G3   | P0       | EV-A       | SPECIFIED_NOT_EXECUTED |

### 7.18 Incident response drills

| KLSEC ID    | Canonical scenario                                        | Source aliases | Scope                 | Gate | Priority | Evidence   | Execution status       |
| ----------- | --------------------------------------------------------- | -------------- | --------------------- | ---- | -------- | ---------- | ---------------------- |
| `KLSEC-112` | Secret compromise rotation drill completes                | `SEC-IR-001`   | IR tabletop/technical | G4   | P1       | EV-E       | SPECIFIED_NOT_EXECUTED |
| `KLSEC-113` | Lost device revocation/replacement drill completes        | `SEC-IR-002`   | IR tabletop/edge      | G4   | P0       | EV-D, EV-E | SPECIFIED_NOT_EXECUTED |
| `KLSEC-114` | Cross-Tenant access alert and containment drill completes | `SEC-IR-003`   | IR tabletop/technical | G4   | P0       | EV-E       | SPECIFIED_NOT_EXECUTED |

## 8. Explicit mapping tables

### 8.1 Plan B flat IDs — `SEC-###` → `KLSEC-###`

All 36 Plan B cases are mapped; none was unmappable.

| Source ID | Source scenario (verbatim)                         | Canonical record |
| --------- | -------------------------------------------------- | ---------------- |
| `SEC-001` | Authentication bypass and session fixation         | `KLSEC-006`      |
| `SEC-002` | OTP brute force and replay                         | `KLSEC-007`      |
| `SEC-003` | RBAC/resource/environment scope escalation         | `KLSEC-016`      |
| `SEC-004` | Four-eyes approval bypass                          | `KLSEC-026`      |
| `SEC-005` | Support impersonation without consent              | `KLSEC-071`      |
| `SEC-006` | Expired/revoked consent                            | `KLSEC-072`      |
| `SEC-007` | Cross-tenant direct object reference               | `KLSEC-018`      |
| `SEC-008` | SQL/NoSQL/command/template injection               | `KLSEC-082`      |
| `SEC-009` | Stored/reflected DOM XSS                           | `KLSEC-083`      |
| `SEC-010` | CSRF on sensitive browser mutation                 | `KLSEC-084`      |
| `SEC-011` | Open redirect and unsafe return URL                | `KLSEC-085`      |
| `SEC-012` | Mass assignment of role/scope/tenant/device fields | `KLSEC-081`      |
| `SEC-013` | API rate-limit bypass                              | `KLSEC-079`      |
| `SEC-014` | Idempotency abuse                                  | `KLSEC-077`      |
| `SEC-015` | Webhook forgery and replay                         | `KLSEC-080`      |
| `SEC-016` | Connector direct database network attempt          | `KLSEC-043`      |
| `SEC-017` | Secret leakage in logs/traces/UI/export            | `KLSEC-045`      |
| `SEC-018` | File cross-tenant access and path/key guessing     | `KLSEC-092`      |
| `SEC-019` | Malicious file type/content                        | `KLSEC-094`      |
| `SEC-020` | Store Hub cloned OS/NVMe/certificate               | `KLSEC-053`      |
| `SEC-021` | Lost/stolen device revocation                      | `KLSEC-055`      |
| `SEC-022` | Terminal role tampering                            | `KLSEC-056`      |
| `SEC-023` | LAN rogue client calls Hub API                     | `KLSEC-057`      |
| `SEC-024` | Release signature or checksum tamper               | `KLSEC-058`      |
| `SEC-025` | Downgrade to vulnerable release/config             | `KLSEC-105`      |
| `SEC-026` | Dependency/supply-chain malicious package          | `KLSEC-102`      |
| `SEC-027` | Container/IaC misconfiguration                     | `KLSEC-106`      |
| `SEC-028` | Production secret used in development              | `KLSEC-040`      |
| `SEC-029` | Backup unauthorized access                         | `KLSEC-090`      |
| `SEC-030` | Restore into wrong Tenant/environment              | `KLSEC-091`      |
| `SEC-031` | AI prompt injection in RAG source                  | `KLSEC-099`      |
| `SEC-032` | AI retrieves unauthorized Tenant source            | `KLSEC-098`      |
| `SEC-033` | Sensitive AI tool call without approval            | `KLSEC-100`      |
| `SEC-034` | Audit tamper/delete attempt                        | `KLSEC-036`      |
| `SEC-035` | Denial of service against public endpoints         | `KLSEC-110`      |
| `SEC-036` | Repeated failed privileged actions                 | `KLSEC-111`      |

### 8.2 Plan A namespaced IDs — `SEC-<DOMAIN>-###` → `KLSEC-###`

All 90 Plan A cases are mapped; none was unmappable.

| Source ID       | Plan A domain    | Source scenario (verbatim)                                                    | Canonical record |
| --------------- | ---------------- | ----------------------------------------------------------------------------- | ---------------- |
| `SEC-AUTH-001`  | Authentication   | Partner identity cannot access Admin Portal                                   | `KLSEC-001`      |
| `SEC-AUTH-002`  | Authentication   | Service identity cannot log into human UI                                     | `KLSEC-002`      |
| `SEC-AUTH-003`  | Authentication   | Disabled/dormant/departed user cannot renew session                           | `KLSEC-003`      |
| `SEC-AUTH-004`  | Authentication   | Stale re-authentication fails A2-A4 action                                    | `KLSEC-004`      |
| `SEC-AUTH-005`  | Authentication   | MFA policy applies to A4 subjects/actions                                     | `KLSEC-005`      |
| `SEC-RBAC-001`  | RBAC             | Team membership alone grants no access                                        | `KLSEC-011`      |
| `SEC-RBAC-002`  | RBAC             | Role name without explicit permission is denied                               | `KLSEC-012`      |
| `SEC-RBAC-003`  | RBAC             | Unknown/deprecated permission fails closed                                    | `KLSEC-013`      |
| `SEC-RBAC-004`  | RBAC             | Wildcard grants rejected in production                                        | `KLSEC-014`      |
| `SEC-RBAC-005`  | RBAC             | Permission deprecation preserves historical decisions                         | `KLSEC-015`      |
| `SEC-SCOPE-001` | Scope            | Tenant-scoped actor cannot access another Tenant                              | `KLSEC-018`      |
| `SEC-SCOPE-002` | Scope            | Digital Store scope excludes sibling Stores                                   | `KLSEC-019`      |
| `SEC-SCOPE-003` | Scope            | Location scope excludes sibling/parent authority                              | `KLSEC-020`      |
| `SEC-SCOPE-004` | Scope            | Device scope excludes Hub/sibling devices                                     | `KLSEC-021`      |
| `SEC-SCOPE-005` | Scope            | Staging grant cannot execute production action                                | `KLSEC-022`      |
| `SEC-SCOPE-006` | Scope            | Exclusion overrides inherited inclusion                                       | `KLSEC-023`      |
| `SEC-SCOPE-007` | Scope            | Client-modified target IDs/metadata do not widen scope                        | `KLSEC-024`      |
| `SEC-SCOPE-008` | Scope            | Sensitive cohort membership change invalidates approval                       | `KLSEC-025`      |
| `SEC-APR-001`   | Approval         | Requester cannot approve own request                                          | `KLSEC-026`      |
| `SEC-APR-002`   | Approval         | Approver without target scope/environment denied                              | `KLSEC-027`      |
| `SEC-APR-003`   | Approval         | Payload hash change denies execution                                          | `KLSEC-028`      |
| `SEC-APR-004`   | Approval         | Target/environment change denies execution                                    | `KLSEC-028`      |
| `SEC-APR-005`   | Approval         | Expired/revoked token denied                                                  | `KLSEC-029`      |
| `SEC-APR-006`   | Approval         | Single-use token cannot replay                                                | `KLSEC-030`      |
| `SEC-APR-007`   | Approval         | Retry creates one business effect                                             | `KLSEC-030`      |
| `SEC-APR-008`   | Approval         | SoD blocks rollout creator Stable self-approval                               | `KLSEC-031`      |
| `SEC-APR-009`   | Approval         | Break-glass auto-expires and creates review                                   | `KLSEC-032`      |
| `SEC-AUD-001`   | Audit            | Privileged allow/deny records assignment, permission, scope, env, policy      | `KLSEC-035`      |
| `SEC-AUD-002`   | Audit            | Audit table rejects update/delete by app roles                                | `KLSEC-036`      |
| `SEC-AUD-003`   | Audit            | Transaction and audit/outbox are atomic                                       | `KLSEC-037`      |
| `SEC-AUD-004`   | Audit            | Export checksum and manifest verify                                           | `KLSEC-038`      |
| `SEC-AUD-005`   | Audit            | Audit redacts secrets/payment credentials                                     | `KLSEC-045`      |
| `SEC-SVC-001`   | Machine identity | Environment credential isolation                                              | `KLSEC-040`      |
| `SEC-SVC-002`   | Machine identity | Revoked service identity cannot claim job/token                               | `KLSEC-041`      |
| `SEC-SVC-003`   | Machine identity | Worker cannot invent missing human approval                                   | `KLSEC-042`      |
| `SEC-SVC-004`   | Machine identity | Connector has no database network/credential access                           | `KLSEC-043`      |
| `SEC-SVC-005`   | Machine identity | AI read identity cannot call write tool                                       | `KLSEC-101`      |
| `SEC-SEC-001`   | Secrets          | Client artifacts contain no privileged secret                                 | `KLSEC-044`      |
| `SEC-SEC-002`   | Secrets          | Logs, traces, crash reports, support bundles redact secrets                   | `KLSEC-045`      |
| `SEC-SEC-003`   | Secrets          | Rotated old credential denied after overlap                                   | `KLSEC-046`      |
| `SEC-SEC-004`   | Secrets          | Non-production credential fails production                                    | `KLSEC-040`      |
| `SEC-SEC-005`   | Secrets          | Secret access and rotation emit audit events                                  | `KLSEC-047`      |
| `SEC-DEV-001`   | Device trust     | Unregistered hardware cannot provision                                        | `KLSEC-050`      |
| `SEC-DEV-002`   | Device trust     | Expired/replayed/wrong-scope code denied                                      | `KLSEC-052`      |
| `SEC-DEV-003`   | Device trust     | Copied image/NVMe without valid key denied                                    | `KLSEC-053`      |
| `SEC-DEV-004`   | Device trust     | Duplicate certificate use detected/quarantined                                | `KLSEC-054`      |
| `SEC-DEV-005`   | Device trust     | Revoked device cannot reconnect cloud or Hub                                  | `KLSEC-055`      |
| `SEC-DEV-006`   | Device trust     | Terminal cannot locally change T1-T4 role                                     | `KLSEC-056`      |
| `SEC-DEV-007`   | Device trust     | Manual IP/discovery does not bypass certificate trust                         | `KLSEC-057`      |
| `SEC-DEV-008`   | Device trust     | Unsigned/checksum-mismatch update rejected                                    | `KLSEC-058`      |
| `SEC-DEV-009`   | Device trust     | A/B failed health check rolls back safely                                     | `KLSEC-059`      |
| `SEC-DEV-010`   | Device trust     | Replacement Hub has no duplicate active identity                              | `KLSEC-060`      |
| `SEC-OFF-001`   | Offline          | Offline Booking/payment/custody creates complete local audit                  | `KLSEC-066`      |
| `SEC-OFF-002`   | Offline          | Reconnect deduplicates Booking/payment/inventory events                       | `KLSEC-067`      |
| `SEC-OFF-003`   | Offline          | Revoked/expired staff lease follows offline policy                            | `KLSEC-068`      |
| `SEC-OFF-004`   | Offline          | Cloud-only A3/A4 action cannot execute offline                                | `KLSEC-069`      |
| `SEC-OFF-005`   | Offline          | T3 cannot release custody; T4 required                                        | `KLSEC-070`      |
| `SEC-SUP-001`   | Support          | No impersonation without active consent                                       | `KLSEC-071`      |
| `SEC-SUP-002`   | Support          | Consent expiry/revocation terminates session                                  | `KLSEC-072`      |
| `SEC-SUP-003`   | Support          | Read consent cannot perform write intervention                                | `KLSEC-073`      |
| `SEC-SUP-004`   | Support          | Every resource view/export/command audited                                    | `KLSEC-074`      |
| `SEC-SUP-005`   | Support          | Support scope cannot cross sibling resources                                  | `KLSEC-075`      |
| `SEC-SUP-006`   | Support          | C5 path requires A4 incident/legal evidence                                   | `KLSEC-076`      |
| `SEC-API-001`   | API              | Mutating retry requires idempotency key where specified                       | `KLSEC-077`      |
| `SEC-API-002`   | API              | Authorization denial uses stable code/correlation without policy leakage      | `KLSEC-078`      |
| `SEC-API-003`   | API              | Rate limits by actor/Tenant/device/connector                                  | `KLSEC-079`      |
| `SEC-API-004`   | API              | Webhook forgery, stale timestamp, replay, duplicate denied                    | `KLSEC-080`      |
| `SEC-API-005`   | API              | Mass assignment/unknown fields do not change protected scope                  | `KLSEC-081`      |
| `SEC-DATA-001`  | Data integrity   | Finalized finance/payment/inventory/audit rows reject destructive edit        | `KLSEC-087`      |
| `SEC-DATA-002`  | Data integrity   | Correction creates compensating record/event                                  | `KLSEC-088`      |
| `SEC-DATA-003`  | Data integrity   | RLS enabled and covered on all scoped tables                                  | `KLSEC-089`      |
| `SEC-DATA-004`  | Data integrity   | Backup restore verifies RPO/RTO and access controls                           | `KLSEC-090`      |
| `SEC-FILE-001`  | Files            | Private object not accessible without valid signed authorization              | `KLSEC-092`      |
| `SEC-FILE-002`  | Files            | Signed URL expires and is scope-bound                                         | `KLSEC-092`      |
| `SEC-FILE-003`  | Files            | Object checksum mismatch detected                                             | `KLSEC-093`      |
| `SEC-PAY-001`   | Payments         | KHQR/provider callback signature and amount/currency bound                    | `KLSEC-095`      |
| `SEC-PAY-002`   | Payments         | UI payment success without authoritative callback/reconciliation not accepted | `KLSEC-096`      |
| `SEC-PAY-003`   | Payments         | Refund/void policy enforces re-auth/reason/approval                           | `KLSEC-097`      |
| `SEC-AI-001`    | AI               | Cross-Tenant retrieval blocked before model context                           | `KLSEC-098`      |
| `SEC-AI-002`    | AI               | Prompt injection cannot obtain secrets or broaden tool scope                  | `KLSEC-099`      |
| `SEC-AI-003`    | AI               | Sensitive tool call requires human approval and is audited                    | `KLSEC-100`      |
| `SEC-REL-001`   | Supply chain     | Dependency/container/SBOM vulnerability scan gates release                    | `KLSEC-102`      |
| `SEC-REL-002`   | Supply chain     | Artifact provenance/signature verified before promotion/install               | `KLSEC-103`      |
| `SEC-REL-003`   | Supply chain     | Production deploy requires protected environment/approval                     | `KLSEC-104`      |
| `SEC-PERF-001`  | Resilience       | Authorization service fail/timeout fails closed for privileged action         | `KLSEC-107`      |
| `SEC-PERF-002`  | Resilience       | Store operations continue during WAN outage                                   | `KLSEC-108`      |
| `SEC-PERF-003`  | Resilience       | Queue retry/backoff does not amplify duplicate effects                        | `KLSEC-109`      |
| `SEC-IR-001`    | Incident         | Secret compromise rotation drill completes                                    | `KLSEC-112`      |
| `SEC-IR-002`    | Incident         | Lost device revocation/replacement drill completes                            | `KLSEC-113`      |
| `SEC-IR-003`    | Incident         | Cross-Tenant access alert and containment drill completes                     | `KLSEC-114`      |

### 8.3 Registry rows — `KLT-*` → `KLSEC-###`

All 64 Security-domain registry rows are mapped; none was unmappable. Rows marked
**KLT-only** matched no case in either plan and therefore become their own canonical
records, as required. **Count of KLT-only records: 16.**

| Registry row              | Registry title                                                                           | Canonical record | Disposition                           |
| ------------------------- | ---------------------------------------------------------------------------------------- | ---------------- | ------------------------------------- |
| `KLT-ADMIN-QA-015`        | Wrong Tenant/Digital Store/Location certificate claim is rejected.                       | `KLSEC-052`      | Merged with plan case(s)              |
| `KLT-ADMIN-QA-026`        | Raw credentials never appear in UI, logs or exports.                                     | `KLSEC-045`      | Merged with plan case(s)              |
| `KLT-ADMIN-QA-040`        | Support impersonation is impossible without active scoped consent.                       | `KLSEC-071`      | Merged with plan case(s)              |
| `KLT-ADMIN-QA-041`        | Expired/revoked consent terminates support access.                                       | `KLSEC-072`      | Merged with plan case(s)              |
| `KLT-ADMIN-QA-071`        | Expired/revoked approval cannot execute.                                                 | `KLSEC-029`      | Merged with plan case(s)              |
| `KLT-ADMIN-QA-074`        | Temporary access activates only in approved window and auto-revokes.                     | `KLSEC-033`      | KLT-only — dedicated canonical record |
| `KLT-ADMIN-QA-075`        | Revoking high-risk assignment invalidates affected sessions/tokens.                      | `KLSEC-010`      | KLT-only — dedicated canonical record |
| `KLT-ADMIN-QA-081`        | Browser never receives Supabase service-role credential or raw execution token.          | `KLSEC-044`      | Merged with plan case(s)              |
| `KLT-CHP3-QA-024`         | Export security                                                                          | `KLSEC-039`      | KLT-only — dedicated canonical record |
| `KLT-CHP3-QA-027`         | Connector secrets                                                                        | `KLSEC-045`      | Merged with plan case(s)              |
| `KLT-HUB-QA-001`          | Provision an eligible HET-enrolled Hub                                                   | `KLSEC-051`      | KLT-only — dedicated canonical record |
| `KLT-HUB-QA-005`          | Correct identifiers but invalid certificate                                              | `KLSEC-050`      | Merged with plan case(s)              |
| `KLT-HUB-QA-006`          | Certificate copied without hardware-backed key                                           | `KLSEC-053`      | Merged with plan case(s)              |
| `KLT-HUB-QA-028`          | Install signed release                                                                   | `KLSEC-061`      | KLT-only — dedicated canonical record |
| `KLT-HUB-QA-029`          | Tampered release package                                                                 | `KLSEC-058`      | Merged with plan case(s)              |
| `KLT-HUB-QA-030`          | Candidate release fails health                                                           | `KLSEC-059`      | Merged with plan case(s)              |
| `KLT-HUB-QA-031`          | Production NVMe failure                                                                  | `KLSEC-060`      | Merged with plan case(s)              |
| `KLT-HUB-QA-032`          | HET repairs same board with new NVMe                                                     | `KLSEC-060`      | Merged with plan case(s)              |
| `KLT-HUB-QA-033`          | Pi board replacement                                                                     | `KLSEC-060`      | Merged with plan case(s)              |
| `KLT-HUB-QA-034`          | Expired support session                                                                  | `KLSEC-072`      | Merged with plan case(s)              |
| `KLT-HUB-QA-035`          | Attempt IP forwarding or bridge enablement                                               | `KLSEC-062`      | KLT-only — dedicated canonical record |
| `KLT-INFRA-QA-001`        | Development credential used against production                                           | `KLSEC-040`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-003`        | Production service starts with missing secret                                            | `KLSEC-049`      | KLT-only — dedicated canonical record |
| `KLT-INFRA-QA-027`        | Infrastructure operator attempts billing action                                          | `KLSEC-017`      | KLT-only — dedicated canonical record |
| `KLT-INFRA-QA-028`        | Release requester approves own Stable promotion                                          | `KLSEC-031`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-029`        | Staging admin attempts production scale change                                           | `KLSEC-022`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-030`        | Temporary access expires                                                                 | `KLSEC-034`      | KLT-only — dedicated canonical record |
| `KLT-INFRA-QA-031`        | Break-glass access used                                                                  | `KLSEC-032`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-032`        | Secret found in repository                                                               | `KLSEC-048`      | KLT-only — dedicated canonical record |
| `KLT-INFRA-QA-036`        | Unknown Pi with copied OS                                                                | `KLSEC-053`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-046`        | Tampered container/release artifact                                                      | `KLSEC-103`      | Merged with plan case(s)              |
| `KLT-INFRA-QA-048`        | Certificate rotation                                                                     | `KLSEC-046`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-030`         | Phone registration                                                                       | `KLSEC-008`      | KLT-only — dedicated canonical record |
| `KLT-KB2B-QA-032`         | OTP replay                                                                               | `KLSEC-007`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-033`         | OTP brute force                                                                          | `KLSEC-007`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-036`         | Invitation role tampering                                                                | `KLSEC-081`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-060`         | CSP                                                                                      | `KLSEC-083`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-061`         | XSS payload in form                                                                      | `KLSEC-083`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-062`         | CSRF/OAuth state                                                                         | `KLSEC-084`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-063`         | Service role exposure scan                                                               | `KLSEC-044`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-064`         | RLS probe                                                                                | `KLSEC-089`      | Merged with plan case(s)              |
| `KLT-KB2B-QA-065`         | PII analytics scan                                                                       | `KLSEC-086`      | KLT-only — dedicated canonical record |
| `KLT-KB2B-QA-066`         | Auth page cache                                                                          | `KLSEC-009`      | KLT-only — dedicated canonical record |
| `KLT-KPA2-QA-004`         | Cross-Store payload injection                                                            | `KLSEC-019`      | Merged with plan case(s)              |
| `KLT-KPA2-QA-066`         | Reconnect membership revoked                                                             | `KLSEC-068`      | Merged with plan case(s)              |
| `KLT-KPM-QA-002`          | Use expired provisioning code                                                            | `KLSEC-052`      | Merged with plan case(s)              |
| `KLT-KPM-QA-004`          | Discover malicious Hub on same LAN                                                       | `KLSEC-057`      | Merged with plan case(s)              |
| `KLT-KPM-QA-006`          | Revoke device                                                                            | `KLSEC-055`      | Merged with plan case(s)              |
| `KLT-KPM-QA-007`          | Rotate certificate                                                                       | `KLSEC-046`      | Merged with plan case(s)              |
| `KLT-KPM-QA-070`          | Inspect app package                                                                      | `KLSEC-044`      | Merged with plan case(s)              |
| `KLT-KPM-QA-071`          | Copy local DB from device                                                                | `KLSEC-063`      | KLT-only — dedicated canonical record |
| `KLT-KPM-QA-072`          | Tamper with client scope IDs                                                             | `KLSEC-024`      | Merged with plan case(s)              |
| `KLT-KPM-QA-073`          | Access evidence without permission                                                       | `KLSEC-064`      | KLT-only — dedicated canonical record |
| `KLT-KPM-QA-074`          | Diagnostic bundle                                                                        | `KLSEC-045`      | Merged with plan case(s)              |
| `KLT-KPM-QA-075`          | Lock-screen notification                                                                 | `KLSEC-065`      | KLT-only — dedicated canonical record |
| `KLT-KPM-QA-080`          | Install unsigned/tampered build                                                          | `KLSEC-058`      | Merged with plan case(s)              |
| `KLT-POS4-QA-032`         | Certificate revoked                                                                      | `KLSEC-055`      | Merged with plan case(s)              |
| `KLT-PPORTAL-QA-KPP2-023` | Terminal self-role escalation                                                            | `KLSEC-056`      | Merged with plan case(s)              |
| `KLT-PPORTAL-QA-KPP2-024` | Connector credential display                                                             | `KLSEC-045`      | Merged with plan case(s)              |
| `KLT-SEC-001`             | Prevent direct production database access by connector                                   | `KLSEC-043`      | Merged with plan case(s)              |
| `KLT-SEC-002`             | Require reauthentication, reason, and four-eyes approval for sensitive production action | `KLSEC-026`      | Merged with plan case(s)              |
| `KLT-SEC-003`             | Reject cloned Store Hub identity                                                         | `KLSEC-053`      | Merged with plan case(s)              |
| `KLT-SEC-004`             | Prevent secrets from appearing in logs, UI, traces, or exports                           | `KLSEC-045`      | Merged with plan case(s)              |
| `KLT-SEC-005`             | Enforce support-access consent expiry                                                    | `KLSEC-072`      | Merged with plan case(s)              |

## 9. Coverage methods and test levels

Merged from Plan A §3 and Plan B §3:

- threat modeling and secure design review;
- static analysis (SAST) and secret/high-entropy scanning;
- dependency/SBOM and license scanning;
- IaC/container/image scanning;
- schema/migration and RLS inspection and static analysis;
- unit and policy evaluation tests;
- API/contract/fuzz/negative tests and DAST/API abuse tests;
- manual authorization and business-logic testing;
- integration and end-to-end tests;
- mobile/desktop storage and client artifact analysis;
- hardware/edge/physical tamper, device/LAN, and release/update tests;
- chaos, replay, concurrency, and fault injection;
- vulnerability scanning and penetration testing;
- cloud configuration review;
- backup/restore and incident-response/alert drills;
- AI red-teaming;
- pilot security monitoring and access review.

## 10. Tooling and environments

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

Production data/secrets are not used in development tests. Pilot tests use approved
limited cohorts and controlled evidence.

## 11. Release gates (G0–G5)

Merged from Plan A §6 and Plan B §7:

| Gate                         | Security exit condition                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `G0 Authority`               | Security owners, open values, accepted risks, and prohibited patterns recorded. Threat model, data classification, and security requirements approved (G0/G1).                                                |
| `G1 Contract`                | Permission, scope, approval, audit, identity, device, secret, threat, and test contracts approved.                                                                                                            |
| `G2 Build`                   | P0 automated tests implemented and green in development; static and component security tests run; no critical secret/vulnerability findings.                                                                  |
| `G3 Integrated verification` | P0 cross-product, RLS, approval, device, offline, payment, support, AI, replay, recovery tests pass against deployed environments, including authorization, API, device, offline, and business-logic testing. |
| `G4 Pilot readiness`         | Independent security review/penetration test, infrastructure/release/backup/alert and incident-response drills, monitoring/alerts, access review, and rollback readiness complete.                            |
| `G5 Phase exit`              | Pilot evidence approved; pilot controls confirmed; no unaccepted (unresolved) Critical/High risk within the approved exit policy; Rebuild Test passes.                                                        |

## 12. Vulnerability treatment, severity, and remediation SLA

Treatment (Plan A §7, unchanged):

- Critical: block promotion/go-live unless owner/security-approved emergency exception
  with compensating controls and expiry.
- High: block production unless approved risk process explicitly permits; default is
  remediation.
- Medium/Low: tracked with owner, SLA, and regression test where applicable.
- Severity framework and SLA: `[REQUIRED: approved standard and timelines]`.

Severity definitions (Plan B §5, unchanged): Critical includes Tenant escape,
unauthorized payment/custody/finance effect, remote code execution, signing-key
compromise, unrecoverable data loss, or broad secret exposure. High includes material
privilege escalation, device trust bypass, persistent XSS on privileged surfaces, or
auditable-control bypass. Severity assessment includes exploitability, scope,
data/business effect, detection and recovery.

## 13. Finding evidence and closure

Each finding records affected asset/version, exact reproduction, request/log/trace
IDs, impact, severity, root cause, remediation owner/date, fix SHA, regression test
ID, retest result, and residual risk approval. Closing a ticket without a passing
regression test is not closure.

## 14. Penetration testing scope

At minimum (Plan A §8):

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

## 15. Test data and fixtures

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

## 16. Security evidence package

Each candidate package contains:

- test manifest and result summary keyed by `KLSEC-###` with all source aliases;
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

## 17. Regression policy

Any change to permission, scope, approval, audit, machine identity, device trust,
secrets, API, RLS, payment, offline sync, support, AI tools, releases, or
infrastructure automatically selects the relevant `KLSEC` records (and thereby every
aliased source case). P0 records cannot be waived by a product team without the
approved risk process.

## 18. Execution status — blocked; nothing executed

- **Every one of the 114 canonical records is `SPECIFIED_NOT_EXECUTED`. No case in
  this system — under any namespace — is claimed executed, passing, or implemented.**
- Execution is blocked by the current implementation state: local database execution
  is gated by **BLK-002** (repository-pinned Docker+Supabase tooling not yet
  available; see KLD-2026-07-26-003 §5), and the repository's security/integration/
  e2e/RLS suites are intentionally blocked stubs (`pnpm test:security` runs
  `scripts/testing/blocked.mjs security`).
- Per KLD-2026-07-26-003 §6–§7, `IMPLEMENTED-IN-DEV` and any executed-status claim
  require applied dev migrations, assertions, RLS positive/negative execution,
  generated types, migration-safety and authorization review, and linked evidence.
- Status transitions for any record follow the evidence rule (§5) and the owner's
  11-status model; this document itself is a contract, not execution evidence.

## 19. WS-11-T007 execution decision (KLD-2026-08-06-WS11-T007-001)

| Field    | Value                                                                                                                                                                                                                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision | `KLD-2026-08-06-WS11-T007-001`                                                                                                                                                                                                                                                                                                    |
| Status   | **OWNER-APPROVED — LOCKED**                                                                                                                                                                                                                                                                                                       |
| Date     | 2026-08-06                                                                                                                                                                                                                                                                                                                        |
| Scope    | Independent security-oriented implementation verification of WS-11-T001..T006 (authorization, isolation, effective privileges, cryptographic identity, concurrency, expiry boundaries, trusted time, offline, restart, crash recovery, idempotency, replay, replacement, backup/restore, release rollback, secret/residue safety) |

This section is the T007 execution authority ordered into THIS canonical
system (no duplicate plan document is created). It updates §18's
"nothing executed" posture for the WS-11 subset T007 executes: execution
status for those records moves ONLY with evidence linked from the T007
handoff, per the §5 evidence rule.

Locked rules:

1. All required T007 tests run under development identities.
2. Pilot and production remain fail-closed under BLK-005.
3. Physical Pi and Electron certification remains a pilot gate.
4. Production Hub-to-cloud transport remains under BLK-006.
5. Required new T007 tests have zero skips.
6. Concurrency tests use genuinely separate database sessions or processes.
7. Race tests repeat enough to prove determinism (minimum 20 controlled
   iterations per race family unless a stronger repository standard exists).
8. Caller clocks never establish authoritative expiry.
9. Historical append-only facts may not be rewritten to repair a test.
10. A defect fix uses a forward migration when schema behavior must change;
    previous migrations remain immutable.
11. Unrelated product scope must not be added.

Inputs: the T007 debt census
(`00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-11-T007__DEBT-CENSUS.md`),
which enumerates every debt explicitly assigned to T007 by T001–T006
records with exact citations. EXECUTED 2026-08-06: the WS-11 subset ran under this decision — all 16 race families with separate sessions and governed outcomes, the security/isolation/cryptographic, offline/restart/recovery and fault matrices, two defects found and fixed forward (cloud 0181), every census debt dispositioned. Results: recorded in
`00_AI_HANDOFF/shared/2026-08-06__SHARED__WS-11-T007__DEVICE-SECURITY-OFFLINE-RECOVERY-AND-CONCURRENCY-VERIFICATION__AI-HANDOFF.md`.

## Appendix A — Open values

Kept verbatim from Plan A; unresolved until the owner supplies them:

- `[REQUIRED: approved tools and CI integration]`
- `[REQUIRED: security severity standard and remediation SLA]`
- `[REQUIRED: independent penetration tester and cadence]`
- `[REQUIRED: load/chaos targets and alert thresholds]`
- `[REQUIRED: pilot monitoring duration and exit criteria]`
