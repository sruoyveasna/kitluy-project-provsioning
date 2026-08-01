# KitLuy Decision and Reconciliation Register

**Filename:** `kitluy-decision-and-reconciliation-register-v1.0.0.md`  
**Version:** v1.0.0  
**Date:** 2026-07-26  
**Owner:** HET / KitLuy Suite Project Owner  
**Status:** CANONICAL DECISION AND CONFLICT REGISTER

## 1. Register rules

- Owner decisions are immutable historical records. A later decision supersedes; it does not erase.
- A decision establishes direction, not implementation.
- Every material conflict receives an `RC-*` entry.
- A reconciliation is closed only after all affected documents and implementation evidence are aligned.
- Unresolved values belong in the open-decisions register, not in this closed-decision table.

## 2. Owner decisions

| Decision ID        | Decision                                      | Authority status       | Binding result                                                                                                                                                           | Source                                                            | Scope                            | State  |
| ------------------ | --------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | -------------------------------- | ------ |
| KLD-2026-07-20-001 | Digital Store control plane                   | OWNER-LOCKED           | Partner Account -> Digital Store -> vertical/configuration -> channels -> optional Store Location and edge devices.                                                      | KitLuy Suite Project.txt                                          | All products                     | Active |
| KLD-2026-07-21-001 | Extended commerce architecture                | OWNER-LOCKED           | Digital Store/Store Location separation, relational transaction truth, governed APIs/events/jobs/channels and safe deployments.                                          | KitLuy Suite Project.txt                                          | Core, APIs, channels, deployment | Active |
| KLD-2026-07-21-002 | Laundry terminal architecture                 | OWNER-LOCKED           | T1 Cashier/Intake, T2 Customer Display, T3 Clean & Ready Scan-In, T4 Pickup Scan-Out.                                                                                    | kitluy-concept-design-1.txt; POS Desktop v4                       | Laundry POS/Hub                  | Active |
| KLD-2026-07-21-003 | Smartphone-simple provisioning                | OWNER-LOCKED           | Digital Store first, active Hub second, assigned terminals third; certificates, discovery, cached endpoints and manual IP only as fallback.                              | Device Management & Provisioning System.txt                       | Devices, Hub, Admin, Partner     | Active |
| KLD-2026-07-21-004 | Cloud, edge and release split                 | OWNER-LOCKED DIRECTION | React/PWA, React Native/Expo, Electron ARM64, Supabase authority, DigitalOcean compute/files/AI/releases, Hub offline authority and signed A/B releases.                 | Project Instruction Writing.txt                                   | Platform and infrastructure      | Active |
| KLD-2026-07-24-001 | Twelve master registry decisions              | OWNER-LOCKED           | Moderation, finance, APIs, extensions, card policy, pricing, reporting and Restaurant tabs decisions are binding.                                                        | kitluy-owner-decision-lock-12-capabilities-v1.0.md                | Multiple domains                 | Active |
| KLD-2026-07-25-001 | Storefront QR pre-intake and virtual queue    | OWNER-LOCKED           | Web/QR/Telegram pre-intake creates a draft and queue ticket; T1 verifies physical garments and creates the authoritative Booking.                                        | KitLuy Storefront v1.txt; Storefront v1.1                         | Storefront/T1/T2                 | Active |
| KLD-2026-07-25-002 | Admin scoped RBAC                             | OWNER-LOCKED           | Teams and role templates organize access; backend authorization uses explicit permission, resource scope, environment and approval policy with immutable audit.          | Infrastructure upgrade version.txt; Admin v3.1                    | Admin/security                   | Active |
| KLD-2026-07-25-003 | Progressive infrastructure scaling            | OWNER-LOCKED DIRECTION | Kubernetes-ready from day one; do not operate Kubernetes from day one. Start cost-efficiently and preserve container portability.                                        | Infrastructure upgrade version.txt; Infrastructure v1             | Infrastructure                   | Active |
| KLD-ROADMAP-001    | Eight-phase vertical roadmap                  | OWNER-LOCKED           | Laundry -> Restaurant -> eCommerce -> Convenience -> Pharmacy -> Department Store -> Grocery -> Supermarket.                                                             | Current KitLuy Project Instructions                               | Suite roadmap                    | Active |
| KLD-VERTICAL-001   | One primary vertical per Digital Store        | OWNER-LOCKED           | Different business types require separate Digital Stores under the same Tenant/Partner Account.                                                                          | Current KitLuy Project Instructions                               | Core identity/store model        | Active |
| KLD-CORE-001       | Shared Core with vertical deltas              | OWNER-LOCKED           | Reuse neutral Core; add only required vertical terminology, schema delta, workflows, interfaces, reports, hardware profile, defaults and rules.                          | Current KitLuy Project Instructions                               | Architecture                     | Active |
| KLD-EVIDENCE-001   | No planning-to-implementation promotion       | OWNER-LOCKED           | A capability is not IMPLEMENTED without repository, migration, test, deployment or production evidence.                                                                  | Current KitLuy Project Instructions; Master Feature Registry v0.2 | All products                     | Active |
| KLD-FIN-001        | Append-only authoritative records             | OWNER-LOCKED           | Finalized finance, payment, inventory and audit records remain append-only; corrections use governed compensating records.                                               | Current KitLuy Project Instructions                               | Finance/payments/inventory/audit | Active |
| KLD-REPORT-001     | Reporting cannot be commercially paywalled    | OWNER-LOCKED           | History, reporting, analytics, exports and data services cannot be restricted by plan tier; security/privacy/fair-use controls remain allowed.                           | KLD-2026-07-24-001 / KLMF-REP-010                                 | Reporting/commercial             | Active |
| KLD-PAY-001        | Offline card capture rejected                 | OWNER-LOCKED           | No offline card capture in the current roadmap.                                                                                                                          | KLD-2026-07-24-001 / KLMF-PAY-014                                 | Payments                         | Active |
| KLD-FIN-002        | Operational subledger, not full statutory ERP | OWNER-LOCKED           | KitLuy owns operational finance truth, liabilities, reconciliation and exports/connectors but is not initially a complete statutory general ledger.                      | KLD-2026-07-24-001 / KLMF-FIN-005                                 | Finance                          | Active |
| KLD-API-001        | Essential API access included                 | OWNER-LOCKED           | Essential first-party, Edge, Partner-data, export and basic connector APIs are included; advanced capacity/support may be monetized without throttling Store operations. | KLD-2026-07-24-001 / KLMF-INT-001                                 | APIs/commercial                  | Active |

## 3. Reconciliation register

| Reconciliation ID | Conflict                                                       | Resolution state | Canonical resolution / safe behavior                                                                                         | Winning authority                         | Affected artifacts                                          | Closure state                                   |
| ----------------- | -------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------- |
| RC-001            | Suite v3 T1/T2/T3 vs current T1-T4                             | RESOLVED         | Use T1-T4. T2 is CDS; T3 Ready Scan-In; T4 Pickup Scan-Out.                                                                  | Owner lock and POS Desktop v4             | Suite v3, Business v1, Partner PWA v1.1, old concept tables | Open until all replacement bibles are published |
| RC-002            | Physical-Store-first vs Digital-Store-first                    | RESOLVED         | Create Digital Store first; Store Location and hardware are optional later provisioning.                                     | Digital Store owner decision              | Pre-July bibles and onboarding copy                         | Open documentation remediation                  |
| RC-003            | Store used for both digital and physical entity                | RESOLVED         | Use Digital Store and Store Location explicitly; avoid unqualified Store in authoritative contracts.                         | Current Project Instructions and glossary | All schemas/docs/UI                                         | Monitor                                         |
| RC-004            | Seller vs Partner                                              | RESOLVED         | Partner is canonical business term. Seller is migration/history only.                                                        | Current owner naming rule                 | Legacy files/fields                                         | Monitor                                         |
| RC-005            | T2 CDS vs Restaurant KDS or production display                 | RESOLVED         | T2 is Laundry Customer Display. Restaurant KDS and any Laundry production display are separate clients.                      | T1-T4 lock and product classifications    | POS/KDS/product inventory                                   | Monitor                                         |
| RC-006            | Manual IP as normal provisioning vs automatic discovery        | RESOLVED         | Automatic secure pairing/discovery is normal. Cached Hub endpoint and manual IP are fallback only.                           | Provisioning owner lock                   | Older setup instructions                                    | Open documentation remediation                  |
| RC-007            | Master Feature Registry interpreted as implementation evidence | RESOLVED         | Registry is planning/normalization and traceability only.                                                                    | Registry v0.2 status and evidence rule    | All implementation reporting                                | Monitor                                         |
| RC-008            | Competitor clone schemas/routes treated as KitLuy contracts    | RESOLVED         | Clone material is design reference only until explicitly adopted into KitLuy authority.                                      | Source authority standard                 | All clone/research docs                                     | Monitor                                         |
| RC-009            | Deployed schema conflicts with target specification            | PROCESS-LOCKED   | Record target/actual divergence; preserve production data; obtain owner/technical approval; migrate or revise specification. | Authority standard                        | Any product/environment                                     | Case-by-case                                    |
| RC-010            | Reporting/history/export paywall recommendations               | RESOLVED         | Commercial paywall is prohibited; only security/privacy/fair-use/abuse controls may restrict access.                         | KLMF-REP-010 owner choice C               | Pricing, entitlements, reports                              | Monitor                                         |
| RC-011            | AI or agent auto-applies production migrations                 | REJECTED         | AI may draft/review but never auto-apply production migrations.                                                              | Current bibles and safety rule            | All environments                                            | Monitor                                         |
| RC-012            | Frontend visibility used as authorization                      | REJECTED         | API enforcement and Supabase RLS are mandatory; frontend controls are UX only.                                               | Admin v3.1 owner direction                | All privileged products                                     | Monitor                                         |
| RC-013            | Revocation decision §3 row 7 presumes an approval request can enumerate a broader credential scope | RESOLVED-BY-MATERIALISATION | KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3 row 7 reads "the credential only, unless the approved request explicitly names a broader scope". `kitluy_auth.approval_requests` has no column that can name one — it carries `payload_hash`, not a payload — and `kitluy_credential_issuer` holds no access to `kitluy_auth` (assertions section 7 fixes that schema's RLS policy census at 58 SELECT policies, so a WS-11 device migration widening it would be a boundary change needing its own decision). Materialised in migration 0138 as `kitluy_devices.revocation_recorded_scopes`: the broader scope is recorded, cites the approving request id, is recorded by one person and approved by another, and is single-use per approval. The decision's intent — an explicit, approved, auditable widening — is preserved; only the storage location differs. Owner confirmation requested. | Owner decision KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §3 | `supabase/migrations/20260729180138_0138_emergency_revocation_and_scope.sql`; `supabase/tests/assertions.sql` section 41b | Open until owner confirms the materialisation |
| RC-014            | Group 0136 governed revocation cannot complete a revocation    | RESOLVED         | `kitluy_devices.revoke_device_credential_v1` (migration 0136, COMMITTED) sets `device_credentials.state = 'revoked'` without `revoked_at`, violating group 0125's `device_credentials_revoked_chk CHECK ((state = 'revoked') = (revoked_at IS NOT NULL))`; and `evaluate_credential_revocation_approval_v1` reads `kitluy_auth.approval_requests/policies/decisions` while executing as `kitluy_credential_issuer`, which holds no privilege on that schema. Both failures are fail-closed (the approve-before-execute path errors rather than under-revoking), and group 0136's hostile assertions never call the function, which is why it shipped. NOT fixed by group 0138 — out of the scope that session was given. Group 0138's emergency path writes both columns and reads no `kitluy_auth` table, so it is unaffected. | Group 0125 schema constraint over group 0136 function body | `supabase/migrations/20260729160136_0136_credential_revocation_and_recovery.sql` | RESOLVED 2026-07-29 by group 0139 (`0139_revocation_execution_fix.sql`), which writes `revoked_at` with the state and moves the `kitluy_auth` read behind a definer the governor may execute. Proved BY EXECUTION, not by inspection: group 0140's `ws11-approval-gate-boundary` assertion drives a real A4 approval, decided by a second person, through `revoke_device_credential_v1` into a COMPLETED revocation, and re-verified on a clean reset at group 0141 |
| RC-015            | Ruling 1 requires verifying a binding to `payload_hash`; Ruling 2's reader was built unable to read it | RESOLVED-BY-MINIMUM-WIDENING | KLD-2026-07-29-DEVICE-REVOCATION-BOUNDARY-002 Ruling 1 requires the recorded revocation scope to be "cryptographically bound into the approval payload hash" and the binding to be verified, failing closed on mismatch. Group 0140, implementing Ruling 2 of the SAME decision, deliberately withheld `payload_hash` from `kitluy_credential_approval_reader` and asserted it could read "no payload_hash or reason at all". A binding to a hash cannot be verified without reading that hash, so the two rulings could not both hold as built. Options considered: (a) a definer owned by a role that can already read `payload_hash` — refused, because no such role exists here except `service_role`, whose global BYPASSRLS is exactly what Ruling 2 removed from this path, so it would undo Ruling 2 to satisfy Ruling 1; (b) a fourth RLS policy — refused, Ruling 2 authorizes EXACTLY three and the census increase 58 -> 61 and no further; (c) ONE additional COLUMN-level SELECT grant on `kitluy_auth.approval_requests.payload_hash`, on rows the reader can already see, with no new policy. (c) is taken as the minimum that satisfies both rulings. `reason` stays unreadable on `approval_requests` and `approval_decisions`, the SELECT-policy census stays at Ruling 2's 61, and the verifier returns an `approval_verdict` and never a hash, a payload or a scope row. A hash is not a payload: it discloses nothing about an affected set to a role that does not already hold the set, and only permits an equality the ruling requires to be checked. | Ruling 1 and Ruling 2 are the same owner decision and are read together; the narrower privilege is preferred over re-introducing BYPASSRLS | `supabase/migrations/20260729210141_0141_revocation_scope_binding.sql` section 5; `supabase/tests/assertions.sql` control 11 | Recorded, not silently resolved. The assertion was AMENDED rather than deleted: it still refuses `reason` on both relations, now positively requires `payload_hash` to be readable, and pins the reader to EXACTLY nine `approval_requests` column grants so the widening cannot drift further unnoticed. Owner may reverse this by ruling that scope binding is verified elsewhere. |
| RC-016            | `db:validate` schemas-in-dictionary check reads role names inside SQL string literals as schema references | OPEN — OUT OF SCOPE, RECORDED NOT FIXED | `scripts/database/db-validate.mjs` strips only `--` line comments (`stripLineComments`) and then matches `(kitluy_[a-z0-9_]+)\s*\.` across the remainder, INCLUDING `COMMENT ON ... IS '...'` string literals. Any sentence inside a comment body that ends with a `kitluy_`-prefixed ROLE name is therefore reported as an unknown SCHEMA. This is why groups 0127 (`...checks for kitluy_credential_issuer.'`) and 0131 fail the check today; both are FALSE POSITIVES — neither migration references a schema of that name, and `kitluy_credential_issuer` is a NOLOGIN role. Group 0141 initially reproduced the same false positive and was reworded (no semantic change) so the repository baseline stays at the two pre-existing failures rather than three. The check is otherwise valuable and was NOT weakened, disabled or allowlisted. | Repository tooling defect; not a migration defect. The two pre-existing failures are the authority on the baseline, not evidence about 0141 | `scripts/database/db-validate.mjs` lines ~128, ~155-165; `supabase/migrations/20260728190127_0127_*.sql`, `20260729110131_0131_*.sql` | Open — needs the extractor to ignore string literals (or to match only after `create schema` / a schema-qualified identifier in executable SQL). Out of scope for WS-11-T003 Step 4; recorded per CLAUDE.md hard rule 1. |
| RC-017            | 150 assertion failure paths in `assertions.sql` destroy their own diagnostic on PostgreSQL 15 | OPEN — OUT OF SCOPE, RECORDED NOT FIXED | `v_findings := v_findings || 'a plain literal'` does NOT append in PostgreSQL 15. With an untyped literal the operator resolves to `array_cat(anyarray, anyarray)` rather than `array_append(anyarray, anyelement)`, so the literal is parsed as an array and the statement raises `malformed array literal … Array value must start with "{"`. Verified by execution against the local PostgreSQL 17 image running the group-0015 schema. `grep` counts **150** occurrences of the pattern in `supabase/tests/assertions.sql`. CONSEQUENCE, and it is narrower than it first looks: the line only executes when a check has ALREADY detected a violation, so the suite still FAILS CLOSED — but it fails with an array-syntax error instead of `ASSERT FAIL: <the finding>`, which invites a future reader to diagnose a harness bug rather than the security regression that actually fired. Lines using `format(...)` are unaffected, because `format()` returns a typed `text`. Group 0141's new SECTION 44 uses `format(...)` throughout, so its own failure paths report correctly. | Existing assertions still fail closed; only their diagnostics are degraded, so this is a reporting defect and not an authorization defect | `supabase/tests/assertions.sql` (150 lines matching `v_findings := v_findings || '`) | Open — the mechanical fix is `|| format('%s', '…')` or an explicit `::text` cast on each literal. Deliberately NOT applied here: it would touch 150 lines across every workstream's assertions in a WS-11 device task, and CLAUDE.md hard rule 1 requires recording an out-of-scope finding rather than fixing it silently. |
| RC-018            | `service_role` can execute the group-0142 scope-bound revocation call site | RESOLVED-AS-PRE-EXISTING-ARCHITECTURE, RECORDED | Verified by execution: `has_function_privilege('service_role', 'kitluy_devices.revoke_device_credential_with_recorded_scope_v1(...)', 'execute')` is TRUE. The route is NOT a group-0142 grant — 0142 grants EXECUTE to `kitluy_issuance_service` and to nothing else, exactly matching the existing grantee of group 0139's `revoke_device_credential_v1`. `service_role` reaches it through the membership `service_role -> kitluy_issuance_service` recorded in group 0127 (whose comment states "service_role IS the trusted issuance service in this stack"). WHAT IT STILL CANNOT DO, verified in the same probe: `has_function_privilege` is FALSE for both `verify_revocation_scope_binding_v1` and `consume_revocation_scope_v1`, so it cannot verify a binding, cannot consume a scope, and cannot reach either except THROUGH the call site — which performs the Ruling 1 binding check, the membership check and the atomic consumption on its behalf. It therefore still needs a genuine four-eyes approval whose `payload_hash` commits to the exact recorded scope. Group 0142 expands no privilege; this entry exists so a later reviewer who finds the TRUE privilege does not mistake it for one. | Group 0127's recorded membership is the authority on this route; group 0142 adds nothing to it | `supabase/migrations/20260728190127_0127_governed_issuance_functions.sql` (the membership); `..._0142_scope_bound_revocation.sql` (the grant, to kitluy_issuance_service only) | Recorded, not open. Revisit only if the owner decides the trusted issuance service should stop being reachable as `service_role` — a Ruling 2-shaped decision affecting far more than WS-11. |
| RC-019            | Group 0142 is not the only revocation path; the unscoped group-0139 function bypasses the entire Ruling 1 binding | **CLOSED by group 0147 — the bound path is now the ONLY normal revocation a runtime identity can execute.** | Independent hostile review, 2026-07-30, finding C-1, demonstrated BY EXECUTION and independently re-verified: `has_function_privilege('kitluy_issuance_service','kitluy_devices.revoke_device_credential_v1(...)','execute')` is TRUE. That group-0139 function accepts PROVIDER_COMPROMISE, SECURITY_INCIDENT and OTHER_APPROVED_REASON, takes NO scope argument, and its gate `evaluate_credential_revocation_approval_v1` never reads `payload_hash`. The reviewer drove a completed revocation through it with ZERO recorded scopes, ZERO consumption rows, and an approval whose payload_hash was the literal string 'deadbeef-not-a-scope-hash'. Group 0142 added a door and removed nothing, so every property Ruling 1 requires — the cryptographic binding, the membership check, the single-use atomic consumption — is OPTIONAL for the only role that can invoke either path. The 0142 function comment claiming it is "The ONLY path" was FALSE and is withdrawn in group 0144. | Ruling 1 requires the binding to govern the reasons it names; a control that can be walked around is not a control | `supabase/migrations/20260729190139_0139_revocation_execution_fix.sql` (the grant); `..._0142_scope_bound_revocation.sql:203` (the withdrawn claim); correction in `20260730090144_0144_*.sql` | REMEDIATED 2026-07-30 by `supabase/migrations/20260730100145_0145_single_governed_revocation_entry.sql`. The exploit was REPRODUCED first (role `kitluy_issuance_service`, payload_hash `'deadbeef-not-a-scope-hash'`, 0 scope rows, 0 consumptions, credential issued -> revoked, outcome REVOKED) and then re-run after the migration, where it now fails `permission denied for function revoke_device_credential_v1`. EXECUTE on the unscoped function is revoked from PUBLIC and from `kitluy_issuance_service` and held by exactly one grantee, the NOLOGIN `kitluy_credential_issuer`; a census inside the migration asserts postgres, anon, authenticated, service_role, kitluy_issuance_service, kitluy_worker_service, kitluy_job_governor, kitluy_activation_governor, kitluy_credential_approval_reader and PUBLIC are each false, and it runs AFTER the borrowed membership is handed back so it describes the state the migration leaves. All nine reasons are re-homed through `revoke_device_credential_governed_v1`: the three recorded-set reasons delegate to group 0142 and fail closed without a recorded scope; the six fleet-derived reasons have their affected set resolved from the REASON and require the named credential to be a member of it, with an unresolved or empty set refused rather than treated as unrestricted. RE-REVIEW 2026-07-30 VERDICT **BLOCKED**, and the reviewer was right. Group 0145 closes the bypass for the THREE recorded-set reasons ONLY. For the SIX fleet-derived reasons its membership check is a TAUTOLOGY: `resolve_revocation_scope_v1` is fed `p_provider_key_reference`, `p_public_key_fingerprint` and `p_assignment_generation` STRAIGHT FROM THE CALLER, so the resolved set is built out of the caller's own request and always contains the credential the caller named. Confirmed by my own execution against the live database and rolled back: `revoke_device_credential_governed_v1` with `ADMINISTRATIVE_REPLACEMENT` and the approval whose payload_hash is the literal `deadbeef-not-a-scope-hash` returned outcome REVOKED, scope_rule IDENTIFIED_CREDENTIAL_ONLY, count 1. The only surviving gate on that path is the pre-existing four-eyes approval, which that very approval satisfies. FIX REQUIRED: for fleet-derived reasons the approval payload_hash must commit to the RESOLVED set (route them through `revocation_approval_payload_hash_v1` as groups 0141/0142 do), and the key / fingerprint / assignment terms must be read from the stored credential row rather than accepted as caller parameters. WS-11-T003 Step 4 remains BLOCKED. UPDATE 2026-07-30 (group 0146): the tautology is understood and the correct control is built and PROVED IN BOTH DIRECTIONS. `authoritative_revocation_scope_v1(credential_id, reason)` derives the affected set from STORED ROWS ONLY — it has no fingerprint, key-reference or assignment-generation parameter — and `revoke_device_credential_bound_v1` requires the approval's payload_hash to equal the hash of THAT derived set. Verified live: the `deadbeef-not-a-scope-hash` exploit is refused `KLUY-CRED-REVOCATION-SCOPE-HASH-MISMATCH`, and an approval carrying the database-derived hash revokes with `scope_bound=true`. **RC-019 REMAINS OPEN** because the bound path is ADDED, not ENFORCED: group 0145's tautological entry point still holds EXECUTE for `kitluy_issuance_service`. Revoking it turns db:test red until the nine assertion call sites and SECTION 46 are rebuilt to carry database-derived hashes — that re-homing is the remaining step and was not attempted rather than half-done. An available control is not an enforced one. CLOSED 2026-07-30 by `20260730120147_0147_enforce_bound_revocation.sql`. All nineteen assertion call sites were re-homed onto `revoke_device_credential_bound_v1` with database-derived hashes, SECTION 46 was rebuilt so it no longer leaves a live exploit approval behind, and EXECUTE on BOTH group 0145's tautological entry point AND group 0136's unscoped helper was then revoked from every runtime identity. Verified after a clean 46-migration reset: `postgres`, `service_role`, `kitluy_issuance_service` and `kitluy_worker_service` are FALSE on both functions; only the NOLOGIN `kitluy_credential_issuer` retains EXECUTE, as the definer identity of the governed wrappers. db:test 192 PASS, test:rls 104 PASS, device-identity 759 PASS / 0 skipped. |
| RC-020            | `confirm_key_destruction_v1` recorded a confirmed destruction on a NULL provider result | RESOLVED by group 0144 | Independent hostile review, 2026-07-30, finding C-2, demonstrated by execution and reproduced independently before the fix. The guard read `p_provider_result not in ('DESTROYED','ALREADY_DESTROYED')`; in three-valued logic `NULL not in (...)` is NULL, not TRUE, so the rejecting branch never fired for a NULL and control fell through to the success path — outcome DESTROYED, `device_generation_keys.state = 'destroyed'`, request `executed`, attempt row CONFIRMED with no failure code. The backstop CHECK failed open the SAME way: with a NULL `provider_result` the right-hand side is NULL, `false or NULL` is NULL, and a CHECK is satisfied by anything that is not FALSE. Two independent guards, one shared blind spot. UNLIKE group 0143 and RC-017, which are the same PostgreSQL trap but fail CLOSED, this one FAILED OPEN: a provider adapter returning no result — a timeout, a dropped connection, a deserialisation miss — was recorded as a confirmed erasure of a private key, which is the exact outcome the destruction service was written to make impossible. | KLREQ-031 §9/§12: the database may not record a confirmed destruction without provider evidence. An invariant that depends on its callers is not an invariant | `supabase/migrations/20260729170137_0137_device_key_destruction_workflow.sql:754` and `:236-238`; fixed in `20260730090144_0144_destruction_confirmation_null_safety.sql` | RESOLVED. The guard is `coalesce`-wrapped and two NULL-safe table constraints stand behind it. Verified after fix: the live definition is coalesce-wrapped, and the predicate for a confirmed row carrying a NULL result evaluates FALSE, so the CHECK rejects it. |
| RC-021            | The emergency revocation path is an unapproved, unbounded revocation entry point for the same runtime identity | **CLOSED by group 0151 — legacy EXECUTE revoked; governed path is the only runtime emergency door** | Independent re-review 2026-07-30 finding C-2, demonstrated by execution. `revoke_device_credential_emergency_v1` retains EXECUTE for `kitluy_issuance_service` (and therefore `service_role`), consults NO approval at all, revokes the ENTIRE resolved set rather than one credential, accepts a NULL device id, and takes reauthentication / declaring authority / declared-by as unverified caller assertions. The reviewer revoked THREE credentials across THREE unrelated devices in one call with zero approvals. Its SECURITY_INCIDENT / PROVIDER_COMPROMISE branch reads `revocation_recorded_scopes` by incident reference and never calls `verify_revocation_scope_binding_v1` — independently confirmed, the live function body contains no reference to it — while `record_revocation_scope_v1`, granted to the same role, gates only on two caller-supplied strings differing. Group 0145's census does not enumerate this function at all. | KLREQ-032 permits an emergency path but requires an explicit exact scope; an unapproved path revoking a whole resolved set is broader than the decision allows | `supabase/migrations/20260729180138_0138_emergency_revocation_and_scope.sql`; census omission in `20260730100145_0145_*.sql` | CLOSED 2026-07-30 by `20260730160151_0151_enforce_governed_emergency_revocation.sql` after the seven assertion call sites were re-homed onto `revoke_device_credential_emergency_governed_v1`. The RC-021 exploit was REPRODUCED first (role `kitluy_issuance_service`, asserted CISO + reauth, DEVICE_STOLEN, outcome REVOKED_IMMEDIATELY, rolled back) and then re-run after 0151, where it fails `permission denied for function revoke_device_credential_emergency_v1` before mutation. EXECUTE on the legacy function is revoked from PUBLIC, anon, authenticated, service_role, kitluy_issuance_service, kitluy_worker_service, kitluy_job_governor, kitluy_activation_governor, kitluy_credential_approval_reader and postgres; only the NOLOGIN `kitluy_credential_issuer` retains it. The governed door remains `authenticated`-only. db:test 193 PASS, test:rls 104 PASS. Phase B still owns governed post-approval/lapse and the recorded-set spend path for PROVIDER_COMPROMISE / SECURITY_INCIDENT. |
| RC-022            | SECTION 46 leaves a live, APPROVED, unconsumed exploit approval committed in the development database | **CLOSED by section 48 census + group 0153 — post-suite spendability census returns zero reusable authority** | Independent re-review 2026-07-30 finding C-4, independently confirmed: the approval with payload_hash `deadbeef-not-a-scope-hash` exists as `f235e503-87ab-47eb-a04f-0c19d3b7d5b4`, status APPROVED, quorum 2 satisfied, unconsumed, naming a device that holds issued credentials. It is directly spendable and I spent it (rolled back) to confirm RC-019's C-1. A test fixture that leaves live authorization behind changes the security posture of the database it ran against. | Test fixtures must not leave spendable authority | `supabase/tests/assertions.sql` SECTION 46 | CLOSED 2026-07-30. SECTION 46 exploit fixtures remain rolled back. Group 0153 adds `emergency_approval_still_approved_v1` so a REJECTED / expired citation cannot authorize a recorded-set emergency. SECTION 48 (end of `assertions.sql`) neutralizes leftover APPROVED `device_credential_revocation` approvals, lapses unanswered governed emergencies, revokes ACTIVE reauth residue, and asserts zero reusable approvals, zero pending emergency post-approvals, zero ACTIVE reauth, and zero unconsumed recorded scopes citing a live APPROVED approval. Immutable history rows may remain; they are no longer spendable. |
| RC-023            | The emergency-revocation authority check cannot be wired: no device/fleet permission key is registered | **CLOSED by groups 0148+0150+0151 — keys registered; governed RPC evaluates them under the human's own session; legacy assertion path unreachable** | KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 requires emergency immediate revocation to be executed by an authorized CISO or incident commander. A governed emergency entry point must therefore VERIFY that authority rather than accept it. It cannot today, verified by query: `kitluy_auth.permissions` holds **8** rows and **none** matches `fleet%` or `%device%`, so there is no `fleet.device_credential.emergency_revoke` (or equivalent) key to check. Worse for this purpose, `kitluy_auth.has_permission(permission_key, resource_type, resource_id, environment)` resolves the CURRENT SESSION identity, not a passed actor — and the emergency caller is `kitluy_issuance_service` acting on behalf of a named human, so a session-scoped check would answer the wrong question even if a key existed. The existing `declaring_authority` column is an enum value the CALLER supplies, which is precisely the RC-021 defect. | Same shape as KLREQ-031's recorded destruction note: permission keys must be registered via the governed RBAC registry before the control that depends on them can be enforced; until then the control fails closed or is unimplementable | `kitluy_auth.permissions` (8 rows, none fleet/device); `kitluy_auth.has_permission` signature; `kitluy_devices.device_credential_emergency_revocations.declaring_authority` | CLOSED 2026-07-30. Group 0148 registered `fleet.device_credential.emergency_revoke` and `fleet.device_credential.emergency_post_approve`. Group 0150's governed RPC evaluates `has_permission` under `auth.uid()` via the approval-reader bridges (RC-026) and refuses `KLUY-EMERGENCY-UNAUTHORIZED` / `KLUY-EMERGENCY-NO-AUTHENTICATED-ACTOR` without inventing an actor-scoped variant. Group 0151 made that the only runtime door. Section 47 proves both refusals and the positive path under a real authenticated session. |
| RC-024            | No sensitive-action re-authentication max-age exists, so the emergency RPC cannot verify freshness without inventing policy | **RESOLVED — owner supplied 300s (KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001), implemented in group 0149** | KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.3 requires re-authentication before immediate emergency revocation. The mechanism exists and is sound: `kitluy_auth.require_reauthentication(p_max_age_seconds integer)` reads `admin_user_profiles.last_reauth_at` for `auth.uid()`, requires an ACTIVE, non-disabled profile, and returns false otherwise — session-bound and fail-closed, exactly what RC-023 needs for actor identity. WHAT IS MISSING IS THE NUMBER. The max age is a CALLER PARAMETER, so the governed emergency RPC must pass one, and a search of `docs/` found no sensitive-action re-authentication duration anywhere in repository or owner authority. For a CRITICAL, immediate, irreversible, fleet-affecting action, choosing that value is a policy decision and not an engineering one: too long and re-authentication stops meaning anything, too short and an incident responder is locked out mid-incident. A SECOND, SEPARABLE GAP: there is NO re-authentication EVIDENCE model — no `reauth`/`step_up`/`elevation` table anywhere. `last_reauth_at` is a timestamp on the profile, not an evidence row, so an evidence ID cannot be passed, and evidence cannot be bound to an action class, marked superseded or revoked, or audit-linked as the emergency contract requires. That gap is schema and CAN be built additively; the duration cannot be guessed. | Repository authority already fixes the mechanism and the actor binding; only the freshness threshold is unstated, and inventing it would be inventing security policy | `kitluy_auth.require_reauthentication`; `kitluy_auth.admin_user_profiles.last_reauth_at`; no table matching `reauth|re_auth|step_up|elevation` | Open. EXACT VALUE REQUIRED FROM THE OWNER: the maximum age, in seconds, of a re-authentication that may authorize `fleet.device_credential.emergency_revoke`, and whether `fleet.device_credential.emergency_post_approve` takes the same value or a different one. Everything else on the emergency path can then be built: the evidence model additively, the authorization record, and the session-scoped RPC. RESOLVED 2026-07-30. The owner set **300 seconds** for both `fleet.device_credential.emergency_revoke` and `fleet.device_credential.emergency_post_approve` (KLD-2026-07-30-DEVICE-EMERGENCY-REAUTH-001). Group 0149 implements it: the window lives in ONE governed reference table, `kitluy_auth.sensitive_action_reauth_policy`, and is deliberately NOT an RPC parameter — a caller who could pass a max age could pass a day. An in-migration assertion fails if a `300` literal ever appears in a re-auth function body instead of being read from that row. The evidence gap is closed too: `kitluy_auth.reauthentication_evidence` binds evidence to a named human, an action class, an environment and a single use, with `expires_at` computed from the policy row and the DATABASE clock. `record_reauthentication_evidence_v1` has NO actor parameter and derives the human from `auth.uid()` — verified by execution: a service session with no `auth.uid()` is refused `KLUY-REAUTH-NO-AUTHENTICATED-ACTOR`. Class binding is what stops one step-up authorizing both an emergency revocation and its own four-eyes post-approval. |
| RC-025            | The kitluy_auth SELECT-policy census moves 61 -> 62 for the re-auth policy reference table | RESOLVED-AS-MINIMUM, RECORDED | Group 0149 adds `sensitive_action_reauth_policy_read` (SELECT, TO authenticated) on `kitluy_auth.sensitive_action_reauth_policy`. The repository requires RLS ENABLED AND FORCED on every table in these schemas — the structural assertion refuses one that does not, and it caught this table when it was first added without it — and FORCE applies to the table OWNER too, so a forced table with NO policy is readable by nobody, including the SECURITY DEFINER that must look the window up. The row is the PUBLISHED RULE (how fresh a re-authentication must be), carries no tenancy, no subject and no evidence, and discloses nothing an authenticated user should not know. Distinct from Ruling 2's OWNER-APPROVED 58 -> 61, which widened the approval-reader surface: this touches a different table for a different reason and is recorded separately rather than folded into that number. | A forced table with no policy is unreadable even by its owner, so the choice was a policy or an unusable governed constant | `supabase/migrations/20260730140149_0149_emergency_reauthentication_evidence.sql`; `supabase/tests/assertions.sql` section 7 census | Recorded, not open. The census assertion now pins 62 and states the reason inline, so a further increase still trips it. |
| RC-026            | The approval reader's job widens from reading approvals to being the bridge kitluy_devices asks kitluy_auth through | RESOLVED-AS-MINIMUM, RECORDED | Group 0150 needed the session actor and the permission verdict inside a `kitluy_devices` definer, and could not get them directly. Verified by execution: inside a definer owned by `kitluy_credential_issuer`, `auth.uid()` raises `permission denied for schema auth` — the governor holds USAGE on neither `auth` nor `kitluy_auth`, and assertion sections 42/43/44 explicitly FORBID granting it `kitluy_auth` USAGE; `postgres` holds USAGE on `auth` WITHOUT grant option, so a migration cannot widen that either. Three narrow SECURITY DEFINER bridges in `kitluy_devices` are therefore owned by the NOLOGIN, non-BYPASSRLS `kitluy_credential_approval_reader` — group 0141's established pattern — each hard-coding its own permission key or action class, with EXECUTE granted to the governor alone. They add NO table grant, NO column grant and NO policy, so section 43's "SELECT is the only privilege this role holds" census and the section 7 policy census (still 62; `kitluy_devices` is not counted) are both untouched. | The reader was introduced by Ruling 2 as the constrained identity that touches `kitluy_auth` so nothing wider has to; asking it one more narrowly-scoped question is that role working as designed, not a new privilege | `supabase/migrations/20260730150150_0150_governed_emergency_revocation.sql` | Recorded, not open. Revisit if a future bridge needs a table or column grant, which would change the reader's character rather than its workload. |
| RC-027 | The revocation WRITE side and the certificate VERIFIER were both complete and nothing joined them, so a governed revocation did not stop the credential authenticating | **CLOSED by `pg-revocation-lookup.ts` — the read side now exists and is proven against a real governed revocation** | Found by WS-11-T003 Step 4 Phase D. `evaluateCertificateValidity` takes a `RevocationLookup` and rejects `CERT_REVOKED` before it even considers expiry, so the verifier was never the weak part. `revocationLookupFrom` builds a lookup from a signed snapshot whose `revokedCertificateSerials` are CALLER-SUPPLIED, and **no code anywhere populated that list from `kitluy_devices.device_credentials`**. Every test that reached the verifier passed `isCertificateRevoked: () => false` — not a stub standing in for an implementation, but the ONLY implementation. Each half therefore looked finished in isolation and reviewed as finished, which is why groups 0136-0153 could add revocation doors, one-way triggers, four-eyes approval, post-approval and lapse without anyone noticing that a credential revoked through all of it still verified. The gap is the JOIN, and a join is exactly what neither half's tests could fail on. | A revocation that the verifier is never told about is not a revocation; KLD-2026-07-29-DEVICE-CREDENTIAL-REVOCATION-001 §2.4 and KLD-2026-07-28-002 §5.4/§6.1 read together require containment at the point of use, not only in the database | `packages/device-identity/src/pg-revocation-lookup.ts` (new); `packages/device-identity/src/certificate-validity.ts`; `packages/device-identity/src/revocation-snapshot.ts`; `packages/device-identity/test/revocation-containment.integration.test.ts` (new) | CLOSED 2026-07-30 for the ONLINE path only. `loadRevocations` keys on `serial_number` (what the verifier reads out of the TBS; `credential_id` never appears in a certificate) and treats `state = 'revoked' OR revoked_at is not null` as an OR so a half-written revocation fails toward revoked. Every test is shaped `verify BEFORE -> revoke through a REAL governed door -> verify AFTER`, because an AFTER-only test passes equally against a lookup that reports everything revoked. **STILL OPEN and deliberately not claimed: nothing yet populates a signed snapshot's `revokedCertificateSerials` from `loadRevocations`, so the OFFLINE Store Hub path is unchanged.** `createLiveRevocationLookup` is explicitly unusable offline — with no connection every call throws, and a verifier treating a thrown lookup as "not revoked" would fail OPEN. |
| RC-028 | Group 0152 verified the grant it had just made instead of the capability the caller needed, and shipped a lapse sweeper the worker could not reach | **CLOSED by group 0154 — USAGE granted, and the assertion rewritten to prove capability** | Found by WS-11-T003 Step 4 Phase D concurrency scenarios 8 and 10, which are the first tests to call the sweeper as the role the durable job actually runs under. Group 0152 granted EXECUTE on `lapse_governed_emergency_post_approvals_v1` to `kitluy_worker_service` and checked itself with `has_function_privilege`, which was TRUE. The grant was real and UNUSABLE: reaching a function needs USAGE on its schema as well as EXECUTE on the function, and the worker held USAGE on `kitluy_ops` only, so every call by the intended caller died with `42501 permission denied for schema kitluy_devices` before the body ran. Nothing caught it afterwards because every existing assertion calls the sweeper as `postgres` (BYPASSRLS, USAGE everywhere) or as `kitluy_issuance_service` (which does hold USAGE). CONSEQUENCE HAD IT SHIPPED: containment still held — the credential stays revoked and nothing was ever at risk — but the lapse path is the ONLY mechanism that turns an unreviewed emergency into a recorded LAPSED verdict and an escalation, so the four-eyes obligation would have closed silently never. **A missing escalation looks exactly like nothing to escalate.** | A privilege assertion must test what the intended caller can DO, not what the migration just granted; same shape as the group 0135 defect where `record_job_attempt_v1` reached a function its definer-owner could not use and the migration's own assertions missed it by inspecting grants without CALLING | `supabase/migrations/20260730160152_0152_governed_emergency_post_approval.sql` (COMMITTED, not edited); `supabase/migrations/20260730180154_0154_lapse_sweeper_worker_reachability.sql` (new, additive) | CLOSED 2026-07-30. 0154 grants USAGE on `kitluy_devices` to `kitluy_worker_service` and NOTHING else, then refuses to apply unless: both privilege halves hold for the intended caller; ZERO functions in the schema are PUBLIC-executable (a refusal, not a comment, so the grant cannot widen silently later); zero table privileges leaked; and the sweeper actually EXECUTES under `set role kitluy_worker_service` in a savepoint against a deliberately unused environment. `set role`, not `set local role` — outside an explicit transaction the LOCAL form is a no-op with a warning and would have run the probe as the migration's own superuser. A wrapper in `kitluy_ops` was REJECTED: it would add a second public entry point to the emergency lifecycle and a second place for a grant to drift out of step with the function it fronts, which is the failure being repaired. |
| RC-029 | "A revoked credential cannot become current" cannot be asserted on the head row, because the head is required to point at it | RESOLVED-BY-RESTATEMENT, RECORDED | Found by WS-11-T003 Step 4 Phase D while writing the containment matrix. `device_credential_heads.current_generation` is a MONOTONIC COUNTER, not a validity oracle, and the `enforce_head_authority` trigger requires monotonicity — so after a revocation the head DOES point at the revoked generation and cannot be made to point anywhere else without breaking a committed invariant. The obvious assertion ("the head does not name a revoked credential") is therefore not merely unavailable, it is WRONG, and writing it would have forced a change to 0125-era schema to satisfy a test. Containment consequently rests entirely on CONSUMERS reading the head and then constraining credential state — which is an invariant nobody had written down and nothing enforced. | The committed head-authority trigger outranks a convenient test; where the honest assertion differs from the intended one, the assertion is restated rather than the schema bent | `supabase/tests/assertions.sql` SECTION 47b; `kitluy_devices.device_credential_heads`; `enforce_head_authority` | Recorded, not open. SECTION 47b asserts the invariant in its only honest form, as a permanent CATALOG CENSUS: **no view may read the heads table**, and every function that reads it must constrain credential state. Seven functions read it at the time of writing and all seven filter. A future view over `device_credential_heads`, or a function that reads it without a state predicate, now fails the suite. |

## 4. New decision template

```markdown
### KLD-YYYY-MM-DD-NNN — <decision title>

- Authority: Project Owner / authorized owner
- Effective date: YYYY-MM-DD
- Status: OWNER-LOCKED | SUPERSEDED
- Decision:
- Binding rules:
- Scope:
- Alternatives rejected:
- Required documentation changes:
- Required implementation/migration changes:
- Evidence note: this decision is not implementation evidence
- Supersedes:
- Superseded by:
```

## 5. New reconciliation template

```markdown
### RC-NNN — <conflict title>

- Status: OPEN | PROVISIONAL | RESOLVED | VERIFIED | CLOSED
- Conflict type: direction | terminology | schema | implementation | security | commercial | evidence
- Source A:
- Source B:
- Exact conflict:
- Precedence result:
- Safe interim behavior:
- Owner/approver:
- Affected documents:
- Affected code/migrations/APIs/tests:
- Closure evidence:
```

---

## Repository addendum — KL-DOCS-001 (not part of the owner original)

Owner original (immutable): `docs/source/canonical/kitluy-decision-and-reconciliation-register-v1.0.0.md`
(owner decisions KLD-* and reconciliations RC-001..012). This addendum
registers repository-discovered conflicts and engineering decisions. IDs are
stable; several are cited by live code and must not be renamed.

### Open conflicts (repository register, KLREC series)

| ID | Conflict | State |
| --- | --- | --- |
| KLREC-2026-07-26-001 | `/edge/v1` route-shape fork. UPDATED by KL-DOCS-001: now between `docs/source/offline/kitluy-storehub-lan-api-v1.0.0.md` (`/sessions/open`, `/bookings/{id}/confirm-intake`, `/ready-scan/sessions`, `/pickup-scan/...`) and `docs/source/api-contracts/kitluy-edge-operations-api-v1.0.0.md` (`/sessions/login`, `/laundry/bookings/{id}/finalize`, `/laundry/ready-sessions`, `/laundry/pickup-sessions/{id}/release`). Same namespace, incompatible paths/verbs; neither supersedes the other. Cited by `services/kitluy-hub-agent/src/lan-api.ts` (mutating routes blocked). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-002 | Custody-concept naming drift, UPDATED: four styles across layers — cloud `kitluy_laundry.garments`/`garment_scan_events`/`ready_storage_positions` (data dictionary), Hub-local `edge_laundry.garment`/`custody_event`/`storage_position` (storehub local DB schema), plus the two API vocabularies. | **RESOLVED 2026-07-27 (Cycle 8)** — the API-vocabulary portion was settled by KLD-2026-07-26-002 (Group 1); the SCHEMA-NAMING portion is now settled by the WS-09-T001 record `docs/data/kitluy-storehub-local-schema-reconciliation-v1.0.0.md`: each layer keeps its own convention (cloud plural, Hub-local singular — systematic across all 38 Hub relations), with an explicit binding mapping table. Storage/schema mapping only; no business, event or API vocabulary changed |
| KLREC-2026-07-26-003 | BB v1 register inconsistency (bootstrap) | OPEN (low) |
| KLREC-2026-07-26-004 | Master feature registry exists only as CSV | OPEN |
| KLREC-2026-07-26-005 | Owner control pack claims RB v4.0.0 / BB v2.0.0 are "Missing from package" (PROJECT_HOME §2, SOT-010/011, SUP-001/002, OD-001/002) — both are physically present and canonical since KL-DOCS-001 ingestion. | RESOLVED-BY-EVIDENCE; owner index row update proposed |
| KLREC-2026-07-26-006 | SOT-027 indexes `kitluy-owner-decision-lock-12-capabilities-v1.0.md` as an active file; file not found machine-wide (content preserved in RB v4 §11.2). | OPEN — owner to supply file or amend index |
| KLREC-2026-07-26-007 | Pack-flattening collision: the security pack's declared `README.md` (890 B) was overwritten by the API pack index (707 B) when packs were merged into one inbox; 61 declared-vs-physical size/hash mismatches show the in-corpus pack manifests predate a regeneration of their members. | RECORDED — originals preserved; manifests marked non-authoritative for hashes |
| KLREC-2026-07-26-008 | Status-model migration: bootstrap statuses BUILT/TESTED have no slot in the owner 11-status model; repo evidence rows are re-registered as SCAFFOLDED with linked E-REPO/E-TEST evidence (unit-tested foundations exceed bare scaffolding but do not meet IMPLEMENTED-IN-DEV gates: no applied dev migrations, no reproducible dev deployment). No feature was advanced. | RESOLVED — mapping recorded in the implementation-status register addendum |
| KLREC-2026-07-26-009 | Terminal-profile identifiers: POS Desktop spec v4.0.0 §13.5 specifies `t1_intake_cashier`/`t2_customer_display`/`t3_ready_scan_in`/`t4_pickup_scan_out` (implemented in `verticals/phase1-laundry`); `kitluy-terminal-profile-contract-t1-t4-v1.0.0.md` uses device-profile codes `laundry_front_counter`/`laundry_ready_pickup`/`laundry_t1..t4` and does not restate the logical identifiers. | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-010 | Error-code naming: POS spec §14.3 codes `BOOKING_VERSION_CONFLICT`/`DUPLICATE_IDEMPOTENCY_KEY` (implemented in `@kitluy/api-errors`) vs API error registry v1.0.0 `RESOURCE_VERSION_CONFLICT`/`IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST` (~51 codes). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-011 | Event-name format: repo `@kitluy/event-contracts` enforces `<domain>.<event>.v<major>` (POS spec §15.2); domain-event registry v1.0.0 canonicalizes unversioned `<context>.<fact>` with envelope schema_version and demotes `.v1` names to compatibility aliases. | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |
| KLREC-2026-07-26-012 | Scope taxonomy drift: RB v4 §8.5 `tenant_or_partner`/`individual_device` (implemented in `@kitluy/resource-scope`) vs resource-scope model v1.0.0 `tenant`/`device` (+ new `chain`, `file_object`, `support_session`, `release_cohort`). | **PARTIALLY RESOLVED 2026-07-27** — the scope-taxonomy vocabulary portion is settled by KLD-2026-07-26-002 (Group 3: `tenant_or_partner` -> `tenant`, `individual_device` -> `device`, plus additive `chain`/`file_object`/`support_session`/`release_cohort`). Implementation tracked by KL-DEC-001-T003 |
| KLREC-2026-07-26-013 | Permission-key drift: `releases.promote.stable` (infra spec §16.5, `@kitluy/rbac` seed) vs `releases.promote_stable` (RBAC permission registry v1.0.0, 107 keys). | **RESOLVED 2026-07-27** by owner decision KLD-2026-07-26-002 (KL-DEC-001, all five groups OWNER-APPROVED). Implementation tracked by KL-DEC-001-T002..T006; approval alone is not implementation evidence (KLD-EVIDENCE-001) |

### Owner direction KLD-2026-07-26-003 — Close G1, begin executable data foundation (recorded verbatim intent, 2026-07-26)

| # | Direction | Register effect |
| --- | --- | --- |
| 1 | Schema/RLS/migration-plan trio remain CONTRACT-APPROVED (not execution proof) | Confirms cycle-2 statuses |
| 2 | Current repo toolchain = ACTIVE-BASELINE; engineering-pack versions = TARGET-APPROVED (inactive until a coordinated compatibility task passes all gates; no independent upgrades) | RESOLVES KLREQ-009 decision; KL-ENG-001 remains the coordinated task; BLK-004 → DIRECTION-RECORDED |
| 3 | Consolidate the two security test plans into ONE governing Phase 1 security test system; both identifier namespaces preserved as immutable source aliases; explicit mappings; no delete/renumber/reinterpret | RESOLVES KLREQ-011 decision; work item SEC-CONS-001 |
| 4 | Additive finance-subledger data-dictionary amendment APPROVED (relational, append-only, KHR/USD integer minor units, full context+balancing+idempotency invariants; independent schema AND finance review; no invention of accounting/tax/rounding/statutory policy) | Work item FIN-DD-001; closes the DD gap found in WS-02-T001 review |
| 5 | Local DB execution proceeds only AFTER repository-pinned Docker+Supabase tools are available; then groups: controls → identity/tenant → store/location → authz/audit → functions/RLS helpers → policies → seeds → types → assertions → RLS tests; never production | BLK-002 remains the gate; sequence recorded |
| 6 | IMPLEMENTED-IN-DEV requires: applied dev migrations + assertions + RLS pos/neg execution + generated types + migration-safety review + authorization review + linked evidence | Evidence-gate restated |
| 7 | No authoritative T1-T4/Hub/Booking/payment persistence before WS-02/03/04 executable foundations pass; WS-07/08 stay SCAFFOLDED until DB-backed integration evidence | Dependency rule recorded |

NOT decided by this direction: KL-DEC-001 five-group ballot (KLD-2026-07-26-002) — still OWNER-APPROVAL-REQUIRED; Hub mutations stay blocked. **SUPERSEDED 2026-07-27: the ballot was decided — see the Cycle-7 owner decision below.**

### Owner decision KLD-2026-07-26-002 — contract vocabulary and Edge API (OWNER-APPROVED 2026-07-27)

| Field         | Value                                                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decision ID   | KLD-2026-07-26-002                                                                                                                                                               |
| Task          | KL-DEC-001                                                                                                                                                                       |
| Status        | **OWNER-APPROVED** (decision **ACTIVE**)                                                                                                                                         |
| Decision date | 2026-07-27                                                                                                                                                                       |
| Owner         | KitLuy Project Owner                                                                                                                                                             |
| Record        | `docs/decisions/kitluy-contract-vocabulary-and-edge-api-owner-decision-v1.0.0.md`; ballot `docs/source/processed/reconciliation/kitluy-contract-vocabulary-owner-review-v1.0.0.md` |

Group verdicts: 1 APPROVED (`/edge/v1/*` generic, `/edge/v1/laundry/*` vertical);
2 APPROVED (logical profiles `laundry.t{1..4}.*`; physical device-profile codes
unchanged; `t2_scan_in`/`t3_scan_out` never reusable); 3 APPROVED (grammar
`<domain>.<resource_or_capability>.<verb>`; 107-key registry canonical; approved
release/backup/certificate mappings; `tenant_or_partner`->`tenant`,
`individual_device`->`device`; additive `chain`/`file_object`/`support_session`/
`release_cohort`); 4 APPROVED WITH REGEX CORRECTION (`^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$`;
versions only in `schema_version`); 5 APPROVED WITH ADDITIVE CODES AND
`PAYMENT_PENDING` CLARIFICATION (adds `INTERNAL_ERROR`, `SCALE_UNSTABLE`,
`GARMENT_COUNT_MISMATCH`, `HUB_READ_ONLY`; `PAYMENT_PENDING` is HTTP 202
non-terminal and never a paid state).

Losing forms are REJECTED-BEFORE-IMPLEMENTATION with no aliases or deprecation
paths, because no affected mutation route, event or client was deployed.
Approval removes the decision blockage only — it is NOT implementation evidence
(KLD-EVIDENCE-001). BLK-003 moves to APPROVED-PENDING-IMPLEMENTATION and closes
only on linked implementation evidence and an approving independent review.

### Batch-2 conflicts (KL-DOCS-002, 2026-07-26)

| ID | Conflict | State |
| --- | --- | --- |
| KLREC-2026-07-26-014 | Toolchain divergence: engineering-standards pack `selected_versions` (Node 24.18.0, pnpm 11.4.0, TypeScript 6.0.3, React 19.2.7, RN 0.86.0, Expo 57.0.8, Electron 43.2.0, Supabase CLI 2.109.1, PostgreSQL 17.10, Terraform =1.15.5, root `tool-versions.json` required) conflicts with EVERY repo pin (.nvmrc 22.23.0, pnpm@9.15.9, TS ~5.7.2, React 18.3.1, Next 14.2.35, RN 0.76.6, Electron ^33; ADR-0001/0002 pre-declare that higher-authority choices win once recorded). | OPEN — coordinated toolchain-upgrade task proposed (KL-ENG-001); not applied during ingestion |
| KLREC-2026-07-26-015 | AI Swarm Operating System pack ships root-file replacements (AGENTS.md, CLAUDE.md, KIMI.md, PROJECT_HOME.md, CONTRIBUTING.md, SECURITY.md, 00_AI_HANDOFF templates/state files) that would displace the repo's root governance and handoff system; the two handoff systems are structurally incompatible (different directories, naming, 14-state lifecycle, index format); pack state files self-declare "UNVERIFIED — the target repository was not inspected". Philosophically aligned; nothing in the pack asserts owner-approved displacement. | OPEN — adoption is a registered proposal requiring an owner decision; pack classified under owner-instructions/, not installed |
| KLREC-2026-07-26-016 | Monorepo blueprint v1.0.0 vs actual repository tree: `tooling/` vs `scripts/`; `packages/vertical-laundry` vs `verticals/phase1-laundry..phase8`; blueprint forbids Phase 1 future-client workspaces (repo has registered-inactive `future-clients/`); 21-package vocabulary vs repo's 40; portal names without `-pwa-`; no Turborepo; pack CODEOWNERS references nonexistent paths and handle `@vongvichetpa` vs repo placeholder. | OPEN — structural reconciliation or blueprint revision required before adoption |
| KLREC-2026-07-26-017 | Two co-dated "canonical" security test plans: batch-1 `kitluy-security-test-plan-phase1-v1.0.0.md` (~90 namespaced SEC-*-* IDs, deeper) vs batch-2 `kitluy-security-test-plan-v1.0.0.md` (36 flat SEC-### IDs + rules of engagement). Neither references the other; test-case registry uses a third namespace (KLT-SEC-*). | OPEN — owner must pick/merge one canonical plan |
| KLREC-2026-07-26-018 | `kitluy-testing-and-evidence-system-v1.0.0` is cited as source_document for 41 of 524 registry test cases (all canonical-shared KLT-* rows) but does not physically exist anywhere. | OPEN — supply the document or re-source the 41 rows (KLREQ-008) |
| KLREC-2026-07-26-019 | TypeScript base-config conflicts: coding standard requires `skipLibCheck: false`, `moduleResolution: Bundler`, target ES2023, `exactOptionalPropertyTypes`/`useUnknownInCatchVariables`/`noPropertyAccessFromIndexSignature`; repo base uses skipLibCheck true, NodeNext, ES2022 without those three flags. | OPEN — fold into KL-ENG-001 toolchain task |
| KLREC-2026-07-26-020 | Minor drifts: IaC plan env layout omits a `pilot` Terraform root (repo has one); swarm evidence vocabulary (PLANNED..PRODUCTION_VERIFIED / DRAFT..RELEASED) differs from the adopted owner 11-status model; pack CONTRIBUTING command matrix (`pnpm db:lint` etc.) does not match repo scripts. | OPEN — reconcile on adoption |

Batch-2 non-findings (verified): secrets inventory contains references only, zero
secret values; domain/DNS plan is all `[REQUIRED]` placeholders; environment
matrix exactly matches `KITLUY_ENVIRONMENTS`; CI/CD doc reinforces
KL-INF-P1-037 (no auto-applied production migrations); no batch-2 document
contradicts any owner-locked invariant.

### Cycle-5 reconciliation (WS-05/06, 2026-07-27)

Conflicts C1–C10 recorded in
`docs/source/processed/reconciliation/kitluy-ws05-ws06-entity-reconciliation-v1.0.0.md`
(none silently resolved). Highest-impact: **C2 — ten cycle-mandated entities
absent from the data dictionary** → DD **Amendment-002 REQUIRED** (KLREQ-012,
owner review path as Amendment-001); C4 missing customer-data RBAC key
(PC-TENANT interim, registry amendment proposed); C8 kitluy_notifications
partial schema (remainder group 0100).

### Cycle-6 reconciliation (WS-07/08, 2026-07-27)

Recorded, not silently resolved (register rule; higher-authority decision
preserved in each cell):

| ID  | Conflict / deviation                                                                                                                                                                                                                                                                                                                     | Disposition                                                                                                                                                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C11 | Enum-registry `laundry_booking_status` (14 values incl. `IN_PRODUCTION`, `QA`, `PICKUP_IN_PROGRESS`, `COMPLETED`) conflicts with the owner-canonical state machines: KBR-TXN §4 lifecycle (10 states incl. `CONFIRMED/FINALIZED`) + KBR-LND §4 production chain (7 states incl. `QA_PACKAGING`, `PICKED_UP`), which the tested engines implement | Persistence encodes the owner-canonical §4 vocabularies (migrations 0075/0080; engines are the canonical implementation per Cycle-6 §6). The enum-registry set is NOT encoded and NOT deleted — owner decision owed on the registry row; compatibility mapping required if both survive                                                                            |
| C12 | Cycle-6 relations/columns mandated by the cycle instruction but absent from DD v1.0.0: `kitluy_laundry.booking_production_state` (projection), `kitluy_payments.payment_status_history` (append-only history); additive columns (orders `version`/`payment_state`/`required_deposit_minor`/intake verification, order_lines `weight_rounding_rule`, garments `unit_kind`/`container_id`, tenders `applied_minor`/`change_due_minor`); weight stored as integer grams (engine contract) vs DD `numeric(18,4)` quantity convention; DD has no payment-allocations relation (tender→order binding + `applied_minor` is the implemented allocation form) | Implemented-and-tested schema is the implementation truth (C1/C2 precedent); DD Amendment-003 REQUIRED (KLREQ-013). All differences are omission-class except the weight representation (convention conflict — engine integer grams preserved; DD convention row unchanged) and `laundry_booking_status` (see C11)                                                 |
| C13 | RBAC 107-key registry has no neutral transaction-read key and no finance-read key for the new `kitluy_orders`/`kitluy_finance` SELECT policies                                                                                                                                                                                             | Interim strictest scopes encoded in group 0095 (store-scope-only / tenant-scope-only, C4 precedent); registry amendment proposed (KLREQ-014)                                                                                                                                                                                                                     |

DD Amendment-002 (KLREQ-012, conflict C2) authored 2026-07-27 in
decision-ready form at
`docs/data/kitluy-suite-supabase-data-dictionary-amendment-002-customer-identity-and-consent-v1.0.0.md`
— PROPOSED, pending independent schema review and owner approval; C1–C10
records preserved unchanged. KL-DEC-001 (KLD-2026-07-26-002 ballot) remains
OWNER-APPROVAL-REQUIRED — no Edge/Hub route shapes, public event names, public
error vocabulary or terminal-profile renames were finalized this cycle; custody
event names stay internal (KLREC-2026-07-26-011 fence) and outbox publication
stays unimplemented.

> Cycle-7 update (2026-07-27): the KL-DEC-001 fence described above was lifted
> by owner decision KLD-2026-07-26-002 (OWNER-APPROVED). The Cycle-6 statement
> is preserved verbatim as the record of what was true at Cycle-6 close.

### Cycle-7 reconciliation (KL-DEC-001 contract alignment, 2026-07-27)

Discovered during implementation of the approved decision. Recorded, not
silently resolved. In every case the owner decision KLD-2026-07-26-002
outranks the contract-family document per the authority order, so the decision
was implemented and a documentation amendment is owed.

| ID  | Conflict / deviation                                                                                                                                                                                                                                       | Disposition                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C14 | Domain Event Registry v1.0.0 §2 JSON Schema defines three flat required envelope fields `aggregate_type` / `aggregate_id` / `aggregate_version`; owner decision Group 4 lists a single `aggregate` field                                                     | Decision implemented as a nested `aggregate: { type, id, version }` in `@kitluy/event-contracts` (authority order: owner decision > contract family). **Registry amendment owed** to match       |
| C15 | Domain Event Registry §2 event-name pattern `^[a-z0-9_]+\.[a-z0-9_]+$` admits names beginning with a digit; the approved corrected pattern `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` requires a leading letter                                                   | Decision (stricter) implemented. **Registry amendment owed**                                                                                                                                    |
| C16 | Store Hub LAN API v1.0.0 §error table still specifies the `EDGE_*` error-identifier convention (e.g. `EDGE_HUB_READ_ONLY`, `EDGE_SCALE_UNSTABLE`, `EDGE_INTERNAL`), which Group 5 rejects for production identifiers                                        | Code carries no `EDGE_*` identifier and a regression test forbids the prefix. **Documentation amendment owed** to the LAN API spec                                                              |
| C17 | `@kitluy/api-errors` diverged from the canonical API Error Code Registry beyond the Group-5 mapping list (e.g. `PRINT_FAILED` 502 in code vs 503 in the registry)                                                                                            | Package realigned to the canonical registry during KL-DEC-001-T005; every remaining divergence enumerated in the task evidence                                                                   |
| C18 | Approved event-name grammar cannot structurally reject a two-segment legacy alias such as `digital_store_created.v1` — it is indistinguishable from a valid `<context>.<fact>` pair                                                                          | Accepted limitation of the approved pattern; such aliases are excluded by the registry as documentation-only mappings, not by the validator. Documented in code and in a documenting test        |
| C19 | **OWNER RULING REQUIRED.** Group 3 states the permission grammar as `<domain>.<resource_or_capability>.<verb>` (three segments) AND states the 107-key registry is the canonical baseline — but **60 of the 107 canonical keys have exactly two segments**, including the three release keys the decision itself names canonical (`releases.promote_internal`/`_pilot`/`_stable`), plus `rbac.read`, `laundry.ready_scan_in`, `webhooks.replay`. Enforcing three segments would invalidate 56% of the baseline | NOT silently resolved. Implemented as: grammar admits **2-or-3** segments (still a real tightening — 1-segment, 4+-segment, uppercase, hyphen and wildcard forms are now rejected) and **registry membership is the authoritative fail-closed gate**. Either the grammar sentence or 60 registry rows must move — owner decision owed |
| C20 | Embedding the full 107-key registry in `packages/rbac` brings six vertical-namespaced key STRINGS (`laundry.bookings.*`, `laundry.ready_scan_in`, `laundry.pickup_scan_out`, `laundry.booking.complete`) into neutral Core, which CLAUDE.md hard rule 2 restricts | Followed the existing precedent for canonical contract identifiers (key strings only, no Laundry behavior, block marked inline). Owner decision owed on whether vertical rows should instead be contributed by the owning vertical package at registration time |
| C21 | Resource Scope Model §4 lists `store_edge` as an environment, but `KITLUY_ENVIRONMENTS` in `packages/shared-types` is `local, development, staging, pilot, production, disaster_recovery` (has `local`, lacks `store_edge`). The RBAC environment-segment denylist derives from that list, so a `store_edge` segment would not be rejected | Recorded, NOT fixed (outside the task's allowed paths). Requires a `packages/shared-types` change under a separate governed task                                                                 |
| C22 | **OWNER ACTION REQUIRED.** Nine approved Group-1 routes have NO actor-permission key in the 107-key RBAC registry: Edge session open/refresh/switch/close (4), T2 display-session open/update/close from T1 (3), T2 reading its own customer-safe state (1), and recording a customer-originated T2 action as consent evidence (1). `identity.sessions.revoke` is Management-surface revocation, not Edge issuance | Routes carry explicit `[REQUIRED: …]` markers and FAIL CLOSED; no key invented. Registering them needs `rbac.permission_registry_manage` (A4_OWNER_SECURITY, impact assessment) — tracked as **KLREQ-015** |
| C23 | Audit-event vocabulary conflict: the RBAC registry CSV `primary_audit_event` column and the Domain Event Registry use different bounded-context tokens for identical facts — `laundry.booking_created` vs `laundry_booking.created`; `garment.ready_scanned_in` vs `garment.custody_scanned_in`; `garment.pickup_scanned_out` vs `garment.custody_scanned_out`; `payment.cash_recorded` vs `payment.recorded`. Both satisfy the approved Group-4 regex, so the grammar does not disambiguate | Domain Event Registry / Group 4 vocabulary implemented (owner decision outranks a supporting registry); divergence exported machine-readably as `AUDIT_EVENT_RECONCILIATION`. **RBAC CSV amendment owed**                                                    |
| C24 | 17 of the 22 Edge route audit-event names are `proposed`, not present in the Domain Event Registry (e.g. `edge_session.opened`, `display_session.*`, `laundry_ready_session.*`, `laundry_pickup_session.*`, `laundry_booking.completed`). Only 5 are `registered`                                                                    | Marked `proposed` in the registry data and must be registered in the Domain Event Registry before any release — tracked as **KLREQ-016**                                                        |
| C25 | Neutral-Core boundary tension: CLAUDE.md hard rule 2 states `packages/` carries no vertical terminology, but approved Group 1 places `/edge/v1/laundry/*` inside the Edge boundary                                                                                                                                                   | Laundry vocabulary quarantined as inert CONTRACT DATA in `packages/edge-contracts/src/laundry-routes.ts` + `terminal-profiles.ts`, with no build or runtime dependency on the vertical. Owner decision owed on whether the Laundry table should move to a vertical-owned Edge package |

### Owner decision KLD-2026-07-28-001 — WS-10 prerequisite decisions (OWNER-APPROVED 2026-07-28)

| Field         | Value                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Decision ID   | KLD-2026-07-28-001                                                                                                                 |
| Status        | **OWNER-APPROVED** — ACTIVE                                                                                                        |
| Decision date | 2026-07-28                                                                                                                         |
| Owner         | KitLuy Project Owner                                                                                                               |
| Applies to    | WS-10 Synchronization and Configuration Publication                                                                                |
| Source ballot | `docs/decisions/kitluy-ws10-prerequisite-decisions-owner-review-v1.0.0.md`                                                          |
| Evidence      | Approves architecture and contract rules ONLY. Not implementation, integration, deployment, pilot or production evidence           |

Resolved: **KLREQ-020** (canonical terminal key `kl1.{terminal_device_uuid}.{terminal_client_sequence}`; Hub jobs, cloud deliveries and provider events must use their own namespaces and must never impersonate `kl1.*`) · **KLREQ-021** (separate persisted and wire vocabularies with a canonical mapping; acknowledgement requires a durable authenticated cloud acknowledgement; transport timeout is neither success nor rejection; transitions monotonic except by approved repair) · **KLREQ-022** (no `edge_finance` authoritative ledger; Hub holds operational source evidence and reports `cloud_posting_status: unknown` until cloud confirmation) · **KLREQ-023** (additive mechanics ratified, incl. `currency_exponent` and `refunded_minor`; applied migrations never rewritten; relation counts must distinguish canonical / additive-invariant / tooling) · **KLREQ-025** (signed versioned local projection of cloud-managed grants; Hub never authors or broadens a grant; deny overrides allow; **no arbitrary grace period may be invented in code**) · **KLREQ-026** (Hub-issued event-effect key `kh1.{command_result_uuid}.{event_ordinal}`, ordinals from the command contract not insertion order, deterministic under replay) · **KLREQ-027** (direct provider-to-Hub callbacks NOT authorized; canonical path is provider → cloud connector → signed WS-10 delivery; dedupe on `provider_code + provider_account_reference + provider_event_id`; conflicting outcomes go to `reconciliation_required`, never silently overwritten).

Deferred and ruled together: **KLREQ-024** and **KLREQ-028**. Until resolved the strict production-state guard remains, no production-stage route or permission may be invented, **no complete T1→T4 lifecycle may be claimed**, WS-10 may synchronize existing supported aggregates but must not introduce production-stage semantics, and WS-12–WS-15 cannot claim full lifecycle integration.

### Amendment KLD-2026-07-28-001-A01 — WS-10 delivery and reconciliation state model (OWNER-APPROVED 2026-07-28)

Resolves conflict **C26**. `reconciliation_required` remains an **orthogonal
conflict/reconciliation state** and must NOT be added to
`edge_sync.delivery_state`. Delivery state records the transport and
cloud-processing lifecycle; conflict state records whether an acknowledged or
rejected business effect requires reconciliation. The two dimensions stay
separately queryable and auditable.

Canonical `edge_sync.delivery_state`: `pending`, `in_flight`, `retry_wait`,
`acknowledged`, `rejected`, `dead_letter`. Aligned by ADDITIVE forward
migration in Cycle 9: `sending → in_flight`, `blocked → rejected`. The applied
migration that introduced the enum is NOT edited. No runtime aliases are
required because no production or pilot deployment exists.

`rejected` means a DURABLE cloud rejection. It must never be used for temporary
network errors, rate limiting, a scheduled retry, an in-progress attempt, a
local operator pause, or an unverified timeout — those belong to `retry_wait`,
`in_flight` or separate operational metadata.

External status is derived by ONE shared mapping function or view, with
**conflict override first**: when reconciliation is required, report
`reconciliation_required` regardless of whether delivery state is
`acknowledged`, `rejected` or `dead_letter`. Otherwise map delivery state
directly. Services must not maintain divergent mappings.

Transition ownership: WS-09 runtime creates outbox records only as `pending`;
WS-10 owns `in_flight`, `retry_wait`, `acknowledged`, `rejected`,
`dead_letter`. A delivery worker must NOT independently clear
`reconciliation_required` — clearing requires an authorized actor or governed
automated reconciliation, a reason, prior and resulting states, immutable
audit, and correlation to the repair or compensating action.

**Pre-rename audit (required by §1, executed 2026-07-28).** Every executable
use of `blocked` was enumerated before authorizing the rename:

| Location                                                     | Use                                      | Verdict                            |
| ------------------------------------------------------------ | ---------------------------------------- | ---------------------------------- |
| `hub/migrations/0001_types_and_helpers.sql:15`               | the enum value declaration itself        | mechanical                         |
| `hub/tests/assertions.sql:163`                               | assertion listing the expected enum values | mechanical                         |
| `services/kitluy-hub-agent/src/hub-database.ts:69` (+ test)  | TypeScript union mirror of the enum      | mechanical                         |
| live `edge_sync.outbox` rows with `delivery_state='blocked'` | **0 rows**                               | nothing to migrate                 |

All other `blocked` occurrences are unrelated: `blocked_balance_due` is a
pickup payment-gate reason code, and `v_blocked` is a local counter in the
assertions. **No code branches on the value and nothing has ever been written
with it**, so no ambiguous use exists to correct. The rename is purely
mechanical and safe.

### Owner decision KLD-2026-07-28-002 — BLK-005 PKI, device trust and signing-key custody (OWNER-APPROVED 2026-07-28)

Full record: `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md`.
Source ballot: `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`.

All twelve ballot items ruled. **BLK-005 decision values are RESOLVED;
BLK-005 IMPLEMENTATION is PENDING.** The owner's evidence boundary is recorded
verbatim in the decision document: approving the architecture proves no CA
exists, no key is in an HSM, no Hub has a TPM or RTC, no certificate has been
issued and nothing has been activated.

**Status effect:**

```text
BLK-005 decision values                 RESOLVED
BLK-005 implementation                  PENDING
WS-11-T003                              AUTHORIZED TO BEGIN
WS-11                                   SCAFFOLDED / IN PROGRESS
development certificate implementation  AUTHORIZED
pilot activation                        BLOCKED (hardware + signer evidence)
production activation                   BLOCKED (implementation + security evidence)
WS-10 production signer                 BLOCKED (signer implementation + evidence)
```

**Two sub-gates survive the decision and are not agent-closable:**

1. **§4 hardware SKU.** Pilot and production hardware certification stay BLOCKED
   until a specific TPM 2.0 or secure-element SKU is selected and certified in
   the production BOM. The ruling explicitly does NOT block the provider
   interface, lifecycle or test doubles.
2. **§10 KLRISK-DEVICE-002.** Remains OPEN until the restricted-investigation
   state, station containment and the runbook are implemented and independently
   tested.

**The ruling CONTRADICTS behavior already shipped in T001 and T002.** Recorded
here so the corrections are owed rather than discovered:

| §    | Ruling                                                                                       | What T001/T002 currently does                                          |
| ---- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 10   | Incumbent goes to `restricted_investigation`, NOT full quarantine                             | T002 quarantines BOTH identities unconditionally — **must be corrected** |
| 11   | NVMe replacement retains `device_record_id` only when board AND TPM identity match             | T001 retains identity for any storage-module-only change                 |
| 11   | Pi board or TPM replacement creates a NEW `device_record_id`                                   | Not implemented                                                          |
| 1, 7 | SIX signing purposes (adds `manufacturing_enrollment`, `emergency_recovery`)                   | Four in `SIGNING_PURPOSES` and in the 0120 CHECK constraint              |
| 5    | Certificate windows are now known values                                                       | `pki_trust_configuration` deliberately empty; opens for DEVELOPMENT only |

The duplicate-evidence correction is the significant one: T002 deliberately held
both identities and the owner has now ruled that the incumbent gets a lesser
containment state. The current behavior is MORE restrictive than the ruling, so
it fails safe in the interim, but it is not the approved policy and must not be
described as such.

### Owner rulings 2026-07-28 (post-T003 step 1) — KLD-2026-07-28-002 addenda

**Development NVMe replacement — ACCEPTED as implemented.** A software-backed
development device has no hardware trust anchor proving continuity, so an NVMe
replacement creates a NEW device_record_id. A production hardware-backed Hub may
retain identity only when board identity AND TPM/secure-element identity both
match. The owner directed: "Do not weaken this for development convenience."
Recorded so a future agent does not read the development friction as a defect.

**Enrollment-station duplicate threshold — NOT a code constant.** The owner
refused the hardcoded 2 that T003 step 1 shipped with a [REQUIRED] marker, and
ruled it a SIGNED TRUST-POLICY value alongside a window:

    duplicate_incident_quarantine_threshold   development default: 2
    duplicate_incident_window_seconds         development default: 86400

Behavior: the first duplicate quarantines the NEW identity, creates a critical
incident and raises station monitoring; a second inside the window quarantines
the STATION. Immediate station quarantine regardless of count when the duplicate
carries the same TPM/secure-element identity, the same private-key fingerprint,
an invalid or revoked station certificate, or evidence of deliberate tampering.
**Pilot and production values must come from signed configuration; no code
default may silently authorize them.** These are owner-approved DEVELOPMENT
defaults, not final pilot or production values.

Implemented in group 0123 as `kitluy_devices.trust_policy`. The pilot and
production rows do not exist, and the environment lock refuses one that is
unsigned, cites the development decision, or omits the forward-jump threshold.

### Cycle-10 execution findings — WS-11-T003 step 2 (2026-07-28)

| ID  | Finding                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C41 | The trusted-time status CHECK read `(status = trusted) = (anomaly_type is null)`, which made the `uninitialized` starting state unrepresentable — the very first insert failed. Corrected to key the anomaly off `restricted%`: never having established time is a starting condition, not an anomaly |
| C42 | A four-argument `record_station_duplicate_submission_v1` with DEFAULTS made every two-argument call ambiguous against the group-0122 overload. Defaults removed and a delegating wrapper added, so the environment is an explicit choice at each call site |

**`trusted_time_max_forward_jump_seconds` is deliberately NULLABLE.** The owner
refused to let a forward-jump threshold be invented, so an absent value makes
trusted-time evaluation FAIL CLOSED. Development carries an explicit TEST value
(3600s) that is marked as such and is not a ruled pilot or production value.

**Signature verification is NOT claimed.** `trust_policy.signature_verified` is
false everywhere, because the configuration signer does not exist until step 6.
Recording an unverified signature as verified would be exactly the fabrication
this programme keeps refusing, and pilot/production policies are refused on that
basis alone.

### Cycle-9 reconciliation — decision vs implemented enum (2026-07-28)

| ID  | Conflict                                                                                                                                                                                                                                                                                              | Disposition                                                                                                                                                                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C26 | **KLD-2026-07-28-001 §KLREQ-021 approves a local-persistence vocabulary that differs from the deployed `edge_sync.delivery_state` enum.** Approved: `pending, in_flight, retry_wait, acknowledged, rejected, reconciliation_required, dead_letter`. Deployed (created verbatim from canonical Hub schema §5): `pending, sending, acknowledged, retry_wait, blocked, dead_letter`. Three differences: `in_flight` vs `sending`; `rejected` vs `blocked`; `reconciliation_required` is absent from `delivery_state` and lives in the separate `conflict_state` enum | **RESOLVED 2026-07-28** by amendment KLD-2026-07-28-001-A01. `reconciliation_required` stays an ORTHOGONAL conflict state and is NOT added to `delivery_state`. The enum aligns by additive forward migration in Cycle 9 (`sending`→`in_flight`, `blocked`→`rejected`); the applied migration is not edited. Pre-rename audit executed: only 3 mechanical executable uses of `blocked` and 0 live rows, so no ambiguous use required correction |

### Cycle-9 execution findings — WS-10 (2026-07-28)

Recorded rather than silently fixed, per hard rule 8. All were found by tests or
by running the gates, and all were closed in the same cycle except where stated.

| ID  | Finding                                                                                                                                                                                                                                                                                                                                                                                                | Disposition |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| C27 | **Every Hub stored procedure was EXECUTE-able by PUBLIC.** PostgreSQL grants EXECUTE to PUBLIC on function creation and a later `GRANT ... TO <role>` does not revoke it, so every `grant execute` in 0013, 0015, 0016 and 0019 was decorative. For `edge_sync.clear_reconciliation` — the ONE sanctioned way past the conflict-dimension guard — this meant amendment KLD-2026-07-28-001-A01 §5 was enforced only by the delivery worker choosing not to call it | **CLOSED 2026-07-28.** Migration 0020 revokes PUBLIC EXECUTE and re-grants explicitly, covering the WS-09 (0013) procedures as well; leaving a known privilege hole open beside the one being closed would have been worse than the recorded scope-widening. Hub assertion 29c now fails if any `edge_*` procedure is PUBLIC-executable, and asserts the §5 asymmetry directly (the sync worker may RAISE a conflict, never CLEAR one) |
| C28 | **A per-stream density assumption, found twice.** `unexplainedSequences` (T002) and the first `recover_sync_cursor` (T009) both assumed a stream's `hub_sequence` values are contiguous. `edge_sync.hub_sequence_seq` is ONE allocator for the whole Hub (offline §5) while ordering is per `(location_id, assignment_generation)` (§5.1), so a stream's sequences are SPARSE by construction and absent values usually belong to another stream | **CLOSED 2026-07-28.** The batch manifest now makes a self-consistency claim only (declared gaps inside the declared range, no sequence both carried and burnt); cursor contiguity is over the stream's OWN rows. Both files carry the finding in place. The sequence-gap ledger keeps its real job: naming burnt values so they are never chased as missing events |
| C29 | **KLREQ-025's approved definition enumerates 21 required fields for the grant projection, and that enumeration is not reproduced verbatim in this register.** | OPEN as a required VALUE. `edge_config.permission_grant_projection` implements the fields the ruling's semantics require; the remainder are NOT invented to reach the count. Carried as `GRANT_PROJECTION_FIELD_CONTRACT` and in the open-decisions register |
| C30 | **The amendment §5 gate was FORGEABLE — found by independent review (RV-001), not by the implementer.** 0015 gated conflict-dimension writes on `current_setting('kitluy.reconciliation_governed')`, a custom GUC that ANY role can set with `set_config()`. Running as `kitluy_sync_worker` the reviewer set the marker and cleared a raised reconciliation with a forged authority, an unrelated correlation event and ZERO audit rows. 0015's comment claimed "This trigger makes it structural"; it did not, and C27's "CLOSED" was therefore true only of the PUBLIC EXECUTE hole, not of the §5 rule it was cited for | **CLOSED 2026-07-28** by migration 0024. The gate is now the EXECUTING IDENTITY: both governed procedures are SECURITY DEFINER owned by `kitluy_reconciliation_governor`, a NOLOGIN role whose membership is granted to nobody, and the trigger recognises only that identity. Re-probed independently: the forge now fails for the sync worker AND for the database owner, while the governed path still works. Hub assertion 29c asserts the role's NOLOGIN/memberless state and both procedures' ownership |
| C34 | **The external-status projection DIVERGED FROM THE OWNER RULING on three of six rows — implementer error, found by re-reading §3 against the running database.** §3 publishes an explicit six-value table. 0015 collapsed `in_flight` and `retry_wait` into `pending_cloud_sync` and mapped `dead_letter` to `reconciliation_required`, on the reasoning that the approved five-value COMMAND sync-state registry forbade a sixth value. That reasoning confused two subjects: `edge_sync.command_result.sync_state` describes a COMMAND outcome, while §3 describes an OUTBOX ROW. The wrong list was then written into the assertions, which is why the gates stayed green | **CLOSED 2026-07-28** by migration 0026: the §3 table is implemented verbatim in `edge_sync.external_sync_status` and in `@kitluy/sync-protocol.projectExternalSyncStatus`. `edge_sync.command_result.sync_state` is UNCHANGED. Hub assertion 29e reproduces the §3 table row by row so the divergence cannot recur silently |
| C35 | **`dead_letter + none` was unreachable, contradicting the §2 example.** Because of C34 the projection could never return `delivery_failed`, and 0019's `dead_letter_outbox_event` additionally REQUIRED a conflict id, forcing the conflict dimension up on every dead letter. §2 gives `delivery_state = dead_letter, conflict_state = none` as an explicit valid combination | **CLOSED 2026-07-28** by 0026: the conflict is now OPTIONAL — raised when a business conflict exists, omitted when delivery simply failed. The `dead_letter_item` record is still ALWAYS written, and that is what carries the operator obligation §1 describes |
| C36 | **§6 invalid transitions were not refused.** Nothing stopped `pending -> acknowledged`, so an acknowledgement could be recorded for a row that had never been transmitted — the same fabrication the ack constraints guard from the other direction | **CLOSED 2026-07-28** by 0026's `enforce_delivery_transition` trigger. Legal: `pending->in_flight`, `in_flight->{acknowledged,rejected,retry_wait,dead_letter}`, `retry_wait->{in_flight,dead_letter}`, `dead_letter->retry_wait` (authorized repair). `acknowledged` and `rejected` are TERMINAL. Hub assertion 29e proves the §6 invalid set fails closed |
| C32 | **A grant belonging to ANOTHER TENANT could permit this one — found by independent review (RV-013).** `resolve_permission_grant` filtered on the requested Location but never on the GRANT'S OWN `tenant_id`/`digital_store_id`, and the `platform` branch matched unconditionally. A platform-scoped ALLOW carrying the attacker tenant's scope columns resolved to `allow` for a different tenant | **CLOSED 2026-07-28** by migration 0025: a grant must belong to the tenant, Digital Store and Location being asked about. Re-probed: the same case now returns `unknown`. Hub assertion 29d covers it. Classed NON-BLOCKING by the reviewer because the resolver has no production caller; fixed anyway, because that describes today and not the cycle that adds one |
| C33 | **A DENY with a NULL `scope_id` FAILED OPEN — found by independent review (RV-014).** The scope match used `is not distinct from`, which is false when the grant's `scope_id` is NULL and the request's is not, so a `tenant`-scoped DENY with no `scope_id` was never loaded and a narrow ALLOW won. Nothing forced a non-platform grant to carry a `scope_id`, because `platform` legitimately has none. This is the ONE direction the rest of the cycle is built to avoid | **CLOSED 2026-07-28** by migration 0025 in two layers: a CHECK makes the malformed row unstorable, and the resolver loads a malformed non-platform DENY anyway so the failure direction stays closed if the CHECK is ever relaxed. A malformed ALLOW is deliberately still not loaded |
| C31 | **A narrow ALLOW defeated a broad DENY — found by independent review (RV-002).** `edge_config.resolve_permission_grant` compared only the exact `(scope_type, scope_id)` tuple, so a `deny` at Digital Store scope was invisible when resolving at Location scope. The column comment claimed "DENY OVERRIDES ALLOW at every scope", which was false | **CLOSED 2026-07-28** by migration 0024. The resolver walks the whole scope chain (platform → tenant → digital_store → store_location, plus the exact tuple for scope types outside it) and a deny anywhere in it wins. The defective signature is DROPPED rather than left callable. Hub assertion 29d covers it |

Additive Hub-schema extensions introduced by WS-10, each owing an amendment to
`kitluy-storehub-local-database-schema-v1.0.0.md` exactly as the G3 extensions
do:

| Gap | Relation(s)                                             | Why it is unavoidable                                                                                                                                        |
| --- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G9  | `edge_sync.transmission_batch`, `transmission_batch_item` | The catalogue has no Hub-local batch header, so there was nowhere to record WHAT was signed and WHICH cloud response answered it — an acknowledgement could not be tied to the attempt that earned it |
| G10 | `edge_sync.provider_outcome_delivery`                     | KLREQ-027 REQUIRES a dedupe on `provider_code + provider_account_reference + provider_event_id`, and a dedupe with nowhere to remember what it saw is not a dedupe. Stores no provider secret and verifies no provider signature |
| G11 | `edge_config.permission_grant_projection`                 | KLREQ-025 REQUIRES a signed local grant projection; the §6 catalogue defines none                                                                             |

### Cycle-10 execution findings — WS-11-T001 (2026-07-28)

#### C37 — refusal evidence written inside the refusing transaction is erased by the refusal

`activate_device_v1` originally recorded an `ACTIVATION_ATTEMPTED` lifecycle
event before hitting the BLK-005 gate, so that a blocked activation would leave
a trace. It did not. Raising rolls back everything the function did, including
that row, so the evidence survived only in the case where it was not needed.
Assertion 28b was written to fail if the evidence were absent, and it failed.

This is the **same shape** as WS-10's `verifySnapshot`, where a throw erased the
rejection it was reporting. Recording it as a named pattern rather than a
one-off bug: **in PostgreSQL an audit row and the exception that makes it
interesting cannot live in the same transaction.** Any future "record the
refusal, then refuse" must split into a raising function and a caller-invoked
recorder in a new transaction.

RESOLVED in group 0120: `activate_device_v1` raises and writes nothing;
`record_activation_refusal_v1` is called by the caller's exception handler and
also opens one `activation_blocked` incident so the blocker is visible on the
device rather than only in an error an operator saw once. That incident is
excluded from the activation open-incident check — counting it would mean
resolving BLK-005 left every device permanently un-activatable by the evidence of
having been blocked — and is cleared by a successful activation.

**Residual limitation:** the database cannot compel a caller to report its own
failure. A caller that swallows the refusal writes no evidence.

#### G12 — clock bootstrap and offline certificate validation (NEW GAP, unaddressed anywhere)

Certificate validity is a time window. A Raspberry Pi without a battery-backed
RTC boots with an untrusted clock; NTP is unauthenticated and may be unreachable
during exactly the outage that matters. A Hub that trusts a wrong clock can
accept an expired certificate or reject a valid one.

Nothing in the repository, the DD, or
`kitluy-device-certificate-and-trust-policy-v1.0.0.md` addresses how trusted time
is established before certificate validation, or what happens when it cannot be.
This is not a runbook detail: it decides whether certificate expiry is enforced
or advisory, and it constrains the hardware bill of materials.

**Recorded, not resolved.** Carried as item 11 of the BLK-005 ballot
(`docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-ballot-v1.0.0.md`).

#### `kitluy_devices` relation-dictionary deviations (D1-D6)

The schema name `kitluy_devices` is already in DD v1.0.0, so creating it needs no
amendment. The RELATIONS deviate, and the DD **owes an amendment for D1-D5
before WS-11 closes**:

| ID  | Deviation                                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `hardware_manifest_signals` — in neither the DD nor trust policy §13. A manifest whose signals are not individually queryable cannot be compared field by field, which is the entire tamper mechanism |
| D2  | `device_hardware_observations` — new. §13's `device_attestations` is a different concept (boot / secure-element proof) and is deliberately NOT created, being blocked on BLK-005 item 4 |
| D3  | `pki_trust_configuration` — in neither list. §13's `trust_bundle_versions` is distribution, not approval. The gate needs a relation whose EMPTINESS is the refusal      |
| D4  | `device_replacements` — new; the DD's `rma_cases` (reason / status / replacement_device_id) cannot record the owner's required precondition ORDER. `rma_cases` NOT created |
| D5  | `device_lifecycle_events` — new; append-only audit of the state machine, including refused transitions                                                                  |
| D6  | NOT created, deliberately: `device_assignments`, `device_capabilities`, `provisioning_sessions`, `device_actions`, `peripheral_tests`, `rma_cases` (DD); `certificate_revocations`, `device_attestations`, `trust_bundle_versions` (§13). They belong to T002+; creating them empty would imply capability that does not exist (repository rule 5, the same reasoning as WS-10's D3) |

#### KLRISK-DEVICE-001 — activation-refusal evidence was caller-enforced

**Raised by the owner 2026-07-28, before T002 was authorized.** T001's fix for
C37 moved refusal evidence into a second, caller-managed transaction. That
stopped the rollback loss, but it was not structural: a defective or malicious
caller could invoke `activate_device_v1`, receive the refusal, and simply omit
`record_activation_refusal_v1`.

**CLOSED STRUCTURALLY in group 0121**, using the pattern the owner specified
rather than deferring it. `attempt_activate_device_v1` writes the refusal or the
activation result, commits, and RETURNS a typed `activation_outcome`; the API
converts a `REFUSED` outcome into the external error. The raising form is then
revoked from `public` and `service_role`, so **there is no path that produces a
refusal without producing its evidence**. Asserted by section 29e, which queries
`has_function_privilege` for both roles.

**Residual:** `attempt_activate_device_v1` is SECURITY DEFINER with a locked
`search_path`, owned by the migration role. That is the same trusted-
infrastructure boundary as KLRISK-HUB-003 — a database superuser can still call
anything.

#### Duplicate hardware evidence now blocks activation, and holds BOTH identities

**Owner requirement, 2026-07-28:** "ensure activation rejects any device whose
hardware evidence collides with another non-retired device. Keeping duplicate
evidence as rows is sound only if both identities remain quarantined and neither
can activate."

Implemented in group 0121: `colliding_evidence_device_ids()` compares CURRENT
enrollments only (so a repaired device never collides with its own superseded
manifest) and excludes storage-module signals (a refurbished NVMe legitimately
carries a previously-reported serial). Activation, claim creation and claim
redemption all refuse on a collision, and enrollment quarantines the incumbent
as well as the newcomer.

**RESIDUAL RISK, recorded rather than hidden.** Holding both identities means an
actor with access to an approved enrollment station can quarantine a LIVE device
by enrolling a unit that presents its evidence. This is the deliberate cost of
not trusting the incumbent by default — which unit is the clone is not knowable
from the evidence. Promoted to KLRISK-DEVICE-002 below.

#### KLRISK-DEVICE-002 — duplicate-evidence enrollment can quarantine an incumbent device

**Raised by the owner 2026-07-28, after reviewing T002.**

    attacker or defective enrollment station
      -> submits hardware evidence matching an ACTIVE device
        -> active incumbent is quarantined
          -> Store operation may be interrupted

This is a denial-of-service path created deliberately by the T002 duplicate
policy. It is the honest trade: the alternative — trusting whichever unit
enrolled first — means a clone that arrives second is simply refused, leaving no
evidence, and a clone that arrives first inherits the identity. Neither is
acceptable, so both units are held and the availability cost is paid.

**Status: OPEN — recorded, NOT mitigated. The current fail-closed behavior is
NOT weakened until an owner-approved policy exists.**

Owner-recommended controls, to be designed and implemented as one policy:

| Control                                                                                                 | Notes                                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Enrollment station must use a device certificate and a named operator session                            | Depends on BLK-005 — an enrollment station certificate is itself PKI                             |
| Duplicate-evidence quarantine requires immutable incident creation                                       | Already true: `device_trust_incidents` is append-only and clearance names an operator            |
| Quarantining an ACTIVE incumbent requires A3/A4 approval unless the evidence proves key compromise        | NOT implemented. Today the incumbent is held unconditionally                                     |
| Automatic containment may block the NEW identity immediately while placing the incumbent in a RESTRICTED investigation state rather than unconditional shutdown | NOT implemented. Requires a restricted state that does not exist yet, and overlaps the BLK-005 item-6 restricted mode |
| Recovery requires physical evidence inspection and a signed disposition                                  | NOT implemented; "signed" depends on BLK-005                                                     |
| Repeated duplicate submissions from ONE station should revoke or quarantine that enrollment station       | NOT implemented. `enrollment_station_id` is recorded on every enrollment, so the signal exists but nothing acts on it |
| The runbook must distinguish cloning, refurbished hardware, board replacement, data-entry error and malicious enrollment | NOT written. This is the substantive piece — the database cannot tell these apart, and today it treats all five identically |

**Dependency note.** Four of the seven controls depend on BLK-005 (station
certificates, signed dispositions, the restricted state, and the compromise
evidence that would justify skipping A3/A4). This risk is therefore not
independently closable ahead of the ballot, and is recorded as blocked on it
rather than left as an open action with no owner.

#### Cycle-10 execution findings — WS-11-T002 (2026-07-28)

Three defects found and fixed by tests written to catch them:

| ID  | Defect                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C38 | **Claim expiry was evaluated against transaction-start time.** The check used `now()`, which in PostgreSQL is transaction start, so a transaction opened before expiry would redeem an expired claim and never notice. Fixed to `clock_timestamp()`. Expiry is a wall-clock question, not a transaction-snapshot one |
| C39 | **Assignment generation could be reused after revocation.** `redeem_device_claim_v1` computed the next generation from `devices.assignment_generation`, which a revocation sets to 0 — so a re-claim would re-issue generation 1, and a stale Hub presenting the old generation would have been accepted as current. Fixed to follow the highest generation EVER issued |
| C40 | **A re-created view silently lost its service grant.** `device_fleet_status` had to be DROPped and re-CREATEd because its column order changed; PostgreSQL discards grants on drop. Caught by an RLS control case failing with `permission denied for view`, not by the migration succeeding. Re-granted explicitly |

**Cross-Location is not a distinct hop in this data model.** A Location belongs
to exactly one Digital Store, so a "cross-Store" and a "cross-Location" claim
meet the SAME broken hop when the Location is under a sibling store. The
distinct location-hop failure is a Location owned by another Tenant, which is
what section 29c tests. Recorded plainly rather than manufacturing a third error
code for one hop. A TEST defect was found here (the first version used fixture
`loc02`, which belongs to the same store as `loc01`, so the scope was valid) —
the code was right and the assertion was wrong.

#### `kitluy_devices` T002 relation deviations (D7-D9)

| ID  | Deviation                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D7  | `device_claims` implements the DD's `provisioning_sessions` (id, device_id, code_hash, intended assignment, expires_at, used_at, status) under a name that says what it is. `provisioning_sessions` is NOT separately created |
| D8  | `device_assignment_projections` and `device_claim_events` are new; neither the DD nor trust policy §13 has an offline assignment projection or a claim audit                                    |
| D9  | `device_terminal_assignments` splits terminal binding out of `device_assignments` so a terminal profile is bound to a GENERATION rather than to a device, which is what makes stale-generation rejection meaningful |

#### Evidence-metric correction — the `test:rls` 94-vs-95 question is closed

The WS-10 evidence recorded RV-005 as "`test:rls` reports **94**, not 95; the 95
carried in earlier rows is a miscount". That correction was applied in the wrong
direction. Measured directly at the WS-10 close commit by stashing Cycle-10
changes and re-running: the runtime figure is **95** `NOTICE:  PASS`.

Both numbers were right under different metrics — **94 distinct case ids, 95 PASS
notices**, because case `KLSEC-036` emits two. Nothing was miscounted; the metric
was never stated. Every future evidence row states which it is using.

### Repository-operation risks (2026-07-28)

| ID              | Risk | Status |
| --------------- | ---- | ------ |
| KLRISK-REPO-001 | **Commits reached `origin/main` without an explicit push being issued, so "commit locally and wait for approval" could NOT be guaranteed.** Observed in Cycle 9: `git reflog show origin/main` records pushes at `f63dbd6`, `3321dc5`, `8a64492`, `a124bc2` and `1a9c6af`, none of which followed a `git push` command in the session. The build agent had stated the commits were being held locally pending owner authorization; that statement was FALSE, and the error surfaced only when the authorized push found a single commit ahead. **Mechanism NOT IDENTIFIED** — no git hook, no husky/lefthook configuration and no `push.*` git config was found. The cause is unknown rather than explained, and no claim is made about it | **CONTROLLED, NOT RESOLVED (2026-07-28).** Owner-directed control applied: `git remote set-url --push origin disabled://push-requires-owner-approval`. VERIFIED — `git push` and `git push --dry-run` both fail with exit 128 (`remote helper 'disabled' aborted session`) while `git fetch` still exits 0 and resolves `origin/main`. An authorized push requires explicitly restoring the real push url, pushing, verifying the SHAs match, and disabling it again. The underlying mechanism could act again the moment the url is restored, so the restore window is kept as short as possible. **No agent restores the push url without an explicit owner instruction naming the push it is for** |

**Governance consequence.** Until KLRISK-REPO-001 is understood, no cycle may
treat "committed but not pushed" as a containment boundary. Work that must not
reach the remote is left uncommitted, or the push url is disabled before the
work begins.

### Cycle-8/8B residual risks — Store Hub (WS-09, 2026-07-27)

Retained at authority level so they cannot be dropped once a workaround exists.

| ID              | Risk                                                                                                                                                                                                                                                                                    | Status                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KLRISK-HUB-001  | **PostgreSQL server crash on `GRANT ... TO current_user`.** Observed: signal 11, postmaster terminated every other backend, full cluster restart into crash recovery (redo replayed to `0/71E4CF8`); no committed data lost                                                             | **RETAINED — NOT FIXED, only avoided.** Explicit-grantee form is used and a test asserts this record still says so. Mitigations still owed: pin/patch the dev image, or a CI guard rejecting the `TO current_user` form |
| KLRISK-HUB-002  | `edge_audit.security_event` is fully mutable by `kitluy_hub_runtime` — an independent probe downgraded severity and erased `details_json` on 43 rows. Contract-consistent (canonical §6.10 does not mark it immutable and it carries acknowledgement columns) but lacks the column-scoped freeze `payment` has | OPEN — recommend a column-scoped freeze under a governed task                                                                                                                                 |
| KLRISK-HUB-003  | **Engine authority is a COMMAND-LAYER guarantee, not a database constraint.** A probe advanced 9 bookings `intake_confirmed → ready` in one raw SQL statement. Terminals hold no database credentials, so the exposure is limited to actors with direct DB access                        | OPEN — accepted for development; evidence wording must always say "in the command layer", never "impossible"                                                                                   |
| KLRISK-HUB-004  | `EDGE_PERMISSION_KEY_UNREGISTERED` and `EDGE_COMMAND_UNKNOWN` throw outside the pipeline try/catch, so those two refusals emit no security event. The other 15 authorization dimensions each log exactly one                                                                            | OPEN — low severity; the refusal itself is correct and fail-closed                                                                                                                            |
| KLRISK-HUB-005  | The backup runner's own fingerprint is row-counts only while printing "restore verified". An independent content-level fingerprint (row counts + per-relation md5 over 54 relations) also matched, so the claim is correct today but under-evidenced by the runner itself                | OPEN — strengthen the runner's fingerprint                                                                                                                                                    |
| KLRISK-HUB-007  | **The §5 "immutable audit" is a CALLER convention, not a database guarantee** (review RV-011). `clear_reconciliation` enforces authority, reason and correlation at the database but writes no audit row itself, and accepts any authority STRING with a NULL `cleared_by` | OPEN (added 2026-07-28). The single implemented caller writes the row in the same transaction and the test asserts its content. Mitigation owed: have the procedure write the audit itself, or require a verified actor reference. **Evidence must say "the caller writes the audit", never "the database enforces the audit"** |
| KLRISK-HUB-008  | **The database owner can still forge the §5 identity** (review RV-012). It holds CREATEROLE, so it can grant itself the governor role and SET ROLE, or simply DISABLE TRIGGER. Inherent to PostgreSQL ownership, not a defect in 0024 — but the Hub agent currently connects as that identity | OPEN (added 2026-07-28), inside the standing KLRISK-HUB-003 trust boundary. 0024 turns a one-statement forge into a deliberate, auditable privilege escalation, and assertion 29c fails if the governor role ever gains a member. Mitigation owed with WS-11: connect as `kitluy_hub_runtime`, not the owner. **Evidence must never claim the §5 gate constrains a database superuser** |
| KLRISK-HUB-006  | **`pnpm db:reset` destroys the Hub-local database.** The Supabase CLI recreates the whole local PostgreSQL cluster, and `kitluy_hub_local` lives in it (recorded gaps G6/G7). Observed twice in Cycle 9 — once silently, then deliberately: a cloud-then-Hub gate order left the Hub database non-existent, and the following repository run reported 109 passed / **154 SKIPPED** instead of 261 passed while still printing PASS | OPEN (added 2026-07-28). Gate ORDER is now part of the procedure: cloud gate first, then rebuild the Hub, then the repository gate. **Any evidence citing Hub DB-backed suite counts must state the passed AND skipped counts**, because a Hub-less run still reports PASS. Mitigations owed: give the Hub database its own container/cluster, or make `hub:db:reset` a prerequisite of the repository test gate |

**Owner disposition (2026-07-27).** All five risks remain VISIBLE and OPEN
going into WS-10. Two are singled out by the owner as standing constraints:

- **KLRISK-HUB-001** — the `GRANT ... TO current_user` PostgreSQL crash remains
  an ENVIRONMENT HAZARD. It is avoided, not fixed. Mitigation (pin/patch the dev
  image, or a CI guard rejecting the `TO current_user` form) is still owed.
- **KLRISK-HUB-003** — **database credentials are a TRUST BOUNDARY**, because raw
  SQL bypasses command-layer engine transition authority. Any WS-10 component
  granted direct database access inherits this boundary and must be treated as
  trusted infrastructure, never as an ordinary client.

**Fixture-vs-runtime rule (carried into WS-10).** The development fixtures
deliberately contain `acknowledged` and `retry_wait` outbox rows and a cursor
with `last_acked_hub_sequence = 1`. These are **WS-10-shaped TEST STATE, not
WS-09 runtime behavior**, and must remain labelled as such wherever they are
cited. No WS-09 code path writes a non-`pending` delivery state.

### Engineering decisions (bootstrap + this task)

KLBOOT-DEC-001..007 (see ADR-0001..0005 in `docs/decisions/`) remain in force.
New: **KLBOOT-DEC-010** — taxonomy extension for batch 2: classified dirs `engineering/` and `qa/` added to the Phase B taxonomy (packs had no matching family); recorded here rather than silently inventing structure. **KLBOOT-DEC-008** — owner governance originals adopted at
`docs/authority/` with clearly-marked repository addenda; the 2.2 MB
open-decisions register is kept as a single immutable copy with a working
pointer file (this avoids a third full copy while preserving hash integrity).
**KLBOOT-DEC-009** — imported bible copies registered as
DUPLICATE-FORMATTING-VARIANT after content-identity verification.

### Owner instructions received in-session

| ID | Instruction | Date |
| --- | --- | --- |
| KLOI-2026-07-26-001 | The `docs/source/inbox/` directory is a transient drop zone: after a batch is ingested (inventoried, hashed, classified with hash-verified copies), the originals are deleted from the inbox so future drops contain only new files. Provenance is preserved via the source manifest (SHA-256 + original_path), git history, and the immutable classified copies, which become the surviving originals. Enforced by `pnpm docs:inbox-state`. | 2026-07-26 |

### Owner-locked decision traceability (preserved from bootstrap)

KLV4-DEC-001..012 and KLD-2026-07-24-001 (12 KLMF capability decisions) are
defined in RB v4 Parts 11; the owner register above adds KLD-2026-07-20-001 ..
KLD-API-001. Full text lives in the bibles; none may be altered here.

---

## KLD-2026-07-28-003 — cryptographic verification boundary for governed issuance

**Owner instruction, 2026-07-28:** _"Do not claim that PostgreSQL independently
verifies Ed25519 unless the development database already has a tested, approved
primitive for it."_ The owner required the answer be DETERMINED before
`finalize_device_credential_issuance_v1` was written, and prohibited introducing
an unreviewed extension or hand-written cryptography to satisfy the claim.

### What was probed (not assumed)

| Probe                       | Result                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Installed extensions        | `btree_gist`, `pg_graphql`, `pg_net`, `pg_stat_statements`, `pgcrypto 1.3`, `pgjwt`, `plpgsql`, `supabase_vault`, `uuid-ossp` |
| `pgcrypto` asymmetric surface | `pgp_pub_encrypt` / `pgp_pub_decrypt` and PGP variants ONLY — encryption, no signature verification of any kind          |
| Cluster-wide function name probe | No function matches `ed25519 \| eddsa \| sign_detached \| verify_detached \| crypto_sign`                           |
| `pgsodium`                  | AVAILABLE in the image, **NOT INSTALLED**, never reviewed or approved by this project                                     |
| `extensions.digest()`       | Present; SHA-256 over `text` and `bytea` agree (self-tested)                                                              |

### Ruling — OPTION B

PostgreSQL does **not** have an approved Ed25519 verification primitive.
Therefore the trusted issuance service verifies the cryptography, while
PostgreSQL independently enforces request binding, hashes, state, generation,
authority and atomic persistence.

Installing `pgsodium` — or writing curve arithmetic in plpgsql — purely so the
system could claim "the database verifies it" was rejected. It would have traded
a recorded, honest boundary for an unreviewed one, which is the trade the owner
prohibited.

### KLRISK-DEVICE-003 — the issuance service is inside the trusted computing base

**Status: OPEN. Accepted for development; must be revisited before pilot.**

    compromised or defective issuance service
      -> presents a detached signature this database cannot check
        -> the signature is accepted as attested
          -> a credential is issued over bytes the database DID reserve,
             but with a signature no one independently verified

The database refuses an *unattested* signature (`KLUY-CRED-SIGNATURE-UNATTESTED`)
and refuses one recorded against a different TBS hash, so the service cannot be
silent or careless. It can, however, lie. Nothing in migration 0127 closes that,
and the migration says so in its own header rather than leaving a reader to infer
it.

**What survives the risk** — the containment that still holds even with the
service inside the TCB, because none of it needs asymmetric cryptography:

- the canonical TBS is **built by the database** from reserved fields; the caller
  echoes it back and a mismatch refuses;
- the credential id, serial, generation and 30-day validity window are reserved
  by the database and cannot be replaced at finalization (row-level trigger
  `KLUY-CRED-RESERVATION-MUTATED`);
- the **device** chain link is built from the reservation, never accepted from
  the caller (`KLUY-CRED-DEVICE-LINK-SUPPLIED`);
- generation authority is a head compare-and-swap, so a race yields one issue and
  one `KLUY-CRED-RENEWAL-GENERATION-CONFLICT`;
- `service_role` still cannot write `device_credentials` or advance a head
  directly — the group-0125 trigger demands `kitluy_credential_issuer`, and no
  application role is a member of it.

**Candidate closures, none selected — these need an owner decision:**

1. Review and approve `pgsodium` (or another audited primitive) so finalization
   verifies Ed25519 database-side. Note `pgsodium`'s deprecation status must be
   established first — `[REQUIRED: approved_database_signature_verification_primitive]`.
2. Move signing behind an HSM/KMS whose attestation is itself verifiable, so the
   service attests to something it cannot forge.
3. Independent out-of-band verification: a second service re-verifies every
   issued credential from `canonical_tbs` + `detached_signature` and raises on
   mismatch. Detective rather than preventive, but it does not require a new
   primitive.

Pilot and production issuance remain **BLOCKED** (KLD-2026-07-28-002 §14), so
this risk is currently confined to development-only credentials of kind
`kitluy.development-device-credential.v1`, which are refused production
eligibility by CHECK constraint.

### Recorded divergence — the audit `credential_id` column is unusable on this path

Group 0125 pins two requirements that point in opposite directions:
`enforce_credential_issuance_integrity()` refuses a credential whose audit row is
not ALREADY present, while `device_credential_issuance_attempts.credential_id`
carries a foreign key to a credential that does not YET exist.

Audit-before-credential wins, because it is what makes `issued` unreachable
without an audit trail. The typed `credential_id` column is therefore written
NULL on the issuance path and the reserved value travels in the `detail` payload;
the credential remains joinable through
`device_credentials.created_from_request_id`. Recorded here rather than fixed by
editing group 0125, which is committed.

---

## KLRISK-DEVICE-003 — canonical record (owner wording, 2026-07-28)

```text
KLRISK-DEVICE-003 — OPEN

PostgreSQL cannot independently verify KitLuy development-device
credential Ed25519 signatures. The trusted issuance service performs
cryptographic verification before finalization.

PostgreSQL independently reconstructs and hashes canonical signing
material, enforces immutable reservations, authority, state transitions,
generation concurrency, chain bindings and atomic persistence.

Development permitted.
Pilot and production promotion blocked pending an approved closure.
```

### The distinction that bounds this risk

**A compromised issuance service can poison or deny issuance. It cannot forge a
credential that a conforming chain verifier will accept.**

Those are different attacks and must not be collapsed:

| Attack                             | Reachable under KLRISK-DEVICE-003? | Why                                                                                     |
| ---------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------- |
| Write a `device_credentials` row whose `detached_signature` is garbage | **YES**   | PostgreSQL cannot check the curve maths, so it accepts the service's attestation         |
| Refuse to issue / stall the fleet  | **YES**                            | The service is the only path to the governed functions                                    |
| Bind a credential to another device, serial, generation or window      | **NO**    | Those are reserved and frozen by the database; the caller only echoes them back           |
| Produce a credential that AUTHENTICATES | **NO**                        | Authentication runs `verifyCertificateChain`, which needs the development signing key      |

So the residual is a **database-state integrity and availability** risk, not an
authentication bypass. A poisoned row reaches the database and then fails at the
verifier — which is why the next requirement is non-negotiable:

> **No read model may treat `state = 'issued'` as proof of cryptographic
> validity.** `issued` means "the governed pipeline persisted this atomically".
> It does not mean "this signature verifies". Every credential consumer must run
> the actual Ed25519 chain verification before trusting a credential.

`certificate-validity.ts` already enforces this: it takes a `CertificateChain`
and `trustedRootFingerprints` and calls `verifyCertificateChain` itself. It has
no `signatureValid` parameter to be lied to — that cutover happened before this
risk existed, and it is what keeps the risk bounded.

---

## Divergence — concurrent renewal refuses EARLIER than specified

**Specified outcome:** two simultaneous renewals yield one finalized renewal and
one `RENEWAL_GENERATION_CONFLICT`.

**Implemented outcome:** the second renewal is refused at PREPARATION with
`KLUY-RENEWAL-ALREADY-RESERVED`, before a replacement key is generated.

`prepare_device_credential_renewal_v1` locks the credential head and then
refuses if an unfinished reservation already exists for the next generation.
That guard was added so a doomed renewal does not generate a key that is
guaranteed to be abandoned — but it means the head compare-and-swap conflict is
no longer the FIRST thing a losing renewal meets.

The compare-and-swap itself is unchanged and still proven: assertion `33f` takes
two reservations against the same head version and shows exactly one issued
credential and one `KLUY-CRED-RENEWAL-GENERATION-CONFLICT`, with the head
advancing once.

**Recorded rather than resolved — this needs an owner ruling:**

- **A.** Keep the early guard. Concurrent renewal refuses with
  `KLUY-RENEWAL-ALREADY-RESERVED`; no key is wasted; the specified
  `RENEWAL_GENERATION_CONFLICT` remains reachable only on the raw issuance path.
- **B.** Remove the guard so renewal produces the specified conflict at
  finalization, accepting that the loser generates a key it will then abandon.

Option A was implemented because it wastes less and fails earlier. It is a
DIVERGENCE FROM THE SPECIFIED OUTCOME and is not being presented as compliance.

### Also owed, not done

`device_generation_keys` is unique per `(device, environment, purpose,
generation)`, so two concurrent renewals cannot register two different keys for
the same generation — the second gets `KLUY-KEY-GENERATION-TAKEN`. Under option
B that constraint would also need revisiting, since each attempt would want its
own key.

---

## Renewal concurrency — two distinct errors (owner ruling, 2026-07-28)

The divergence recorded above was ruled **acceptable and preferable**. The
contract is now two errors with different meanings, and they must not be
collapsed:

| Code                              | Raised at     | Means                                                                 |
| --------------------------------- | ------------- | ---------------------------------------------------------------------- |
| `KLUY-RENEWAL-ALREADY-RESERVED`   | preparation   | another open renewal already owns the next generation — expected fast-fail, no key is generated |
| `RENEWAL_GENERATION_CONFLICT`     | finalization  | a genuine race, detected by the credential-head compare-and-swap        |

Acceptance criterion: exactly one reservation may own the next generation; the
other normally gets `KLUY-RENEWAL-ALREADY-RESERVED`; if both nonetheless reach
finalization through a race or a recovery path, exactly one succeeds and the
other gets `RENEWAL_GENERATION_CONFLICT`; **never two credentials for the same
generation**.

Implemented: the preparation guard is in `prepare_device_credential_renewal_v1`
(group 0128). The compare-and-swap is in
`finalize_device_credential_issuance_v1` (group 0127) and is proven by assertion
33f. What is NOT yet asserted is the two paths TOGETHER — a renewal that reaches
finalization via recovery while another holds the head. Owed to closure item 4.

---

## OWED — the renewal ordering is currently INVERTED

**Ruled order:** renewal eligibility → prepare reservation → receive
`renewal_attempt_id` and `next_generation` → **then** generate the replacement
key, idempotently on
`(device_record_id, environment, purpose, next_generation, renewal_attempt_id)`.

**What group 0128 implements:** the opposite.
`prepare_device_credential_renewal_v1` refuses with
`KLUY-RENEWAL-NO-REPLACEMENT-KEY` unless the key is ALREADY registered, so a key
must exist before a reservation does.

This is a real conflict, not a detail. The ruled ordering is what makes key
generation idempotent on `renewal_attempt_id` — an identifier that does not
exist until the reservation is taken. Under the current ordering there is
nothing stable to key idempotency on, so a retry that loses its response could
generate a second key.

**Required change (additive migration, not an edit to 0128):**

1. Split the key check out of `prepare_device_credential_renewal_v1`; the
   reservation must succeed with no key registered.
2. Add a `renewal_attempt_id` column to `device_generation_keys`, unique
   together with the generation, so `register_generation_key_v1` becomes
   idempotent on the attempt and a CONFLICTING attempt can neither receive nor
   reuse the key.
3. Move the `state = 'generated'` and fingerprint checks to
   `record_device_credential_signature_v1` / finalization, where the key does
   exist.

Until this lands, the renewal path is reachable and tested (assertions 34a/34b)
but does NOT match the ruled ordering, and retry-safety of key generation is
NOT established.

---

## OWED — cross-system atomicity is not implemented

PostgreSQL and the private-key provider cannot share a transaction. The ruled
authority model is:

```text
PostgreSQL = authoritative credential and key-lifecycle state
Provider   = private-key custody and operational key availability
```

with an `activation_pending` state between credential finalization and confirmed
provider activation, and a reconciliation process that retries using the SAME
attempt and key reference.

**None of this is built.** Group 0128 marks a key `active` the moment the
credential row is inserted, which asserts something about the PROVIDER that the
database cannot know. That is optimistic and wrong under the ruled model.

Consequence, stated plainly: **a renewed credential must not be reported usable
today**, because only one of the two required conditions is checkable —
`credential cryptographically valid` is enforced, `provider key activation
confirmed` does not yet exist as a concept in the schema.

Owed to closure item 3, together with the five crash points named in the ruling
(after key generation before registration; after registration before PoP; after
finalization before provider activation; after activation before
acknowledgement; and during retry of each).

---

## CORRECTION — forced key rotation was never owner-approved (2026-07-29)

**Supersedes** the renewal-rotation behaviour recorded for group 0128 above.

§5.1 was treated as a ruling requiring every renewal to generate a new device
key pair. The owner has corrected the record: it was a **recommendation**, and
no versioned owner decision requires rotation. Group 0128 had encoded it as a
database refusal (`KLUY-RENEWAL-KEY-REUSED`) and additionally refused to prepare
any renewal without a registered replacement key — between them, those two rules
made `reuse_current_key` **unreachable**, not merely discouraged.

Encoding a recommendation as a refusal is the precise failure this register
exists to prevent, so group 0129 undoes it rather than annotating it.

### What group 0129 changes

| Before (0128)                                             | After (0129)                                                         |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| Renewal always rotates                                     | Two modes: `reuse_current_key`, `rotate_key`                          |
| Rotation implicit and mandatory                            | Mode is explicit; NULL resolves to environment policy                  |
| `KLUY-RENEWAL-KEY-REUSED` refuses reuse                    | **Removed.** Reuse is a supported mode                                |
| Replacement key required before any reservation            | Required **only** in `rotate_key` mode                                |
| —                                                          | `KLUY-RENEWAL-NOT-CURRENT-KEY` — reuse must present the incumbent key |
| —                                                          | `KLUY-RENEWAL-ROTATION-NOT-PERMITTED` — rotation is policy-gated      |

Default for development: **`reuse_current_key`**, rotation **disabled**.

`kitluy_devices.renewal_policy.allow_key_rotation` cannot be set true without
naming an owner decision — a CHECK constraint, not a convention, because a
boolean an operator can flip is exactly how a recommendation becomes policy
again. The missing value is recorded as
`[REQUIRED: renewal_key_rotation_owner_decision]`.

### Classification of the PoP work

```text
Replacement-key renewal PoP — IMPLEMENTED-IN-DEV component
```

It is the correct mechanism **when rotation is selected**. It is **not** evidence
that the canonical renewal lifecycle requires rotation, and must not be cited as
such.

### Noted for the review — refusal codes as an oracle

Checking bindings before signature verification gives typed operational
diagnosis, which is the right trade internally. It also means the refusal code
distinguishes *which* binding was wrong. That is safe only while these functions
are reachable exclusively by `kitluy_issuance_service`; if any renewal surface is
ever exposed to an unauthenticated caller, the codes must be collapsed at the
boundary. Recorded so the reviewer tests it rather than assumes it.

### Still owed — the credential/key generation conflation

`device_generation_keys` is keyed on `generation`, meaning the CREDENTIAL
generation. Under `reuse_current_key` the credential generation advances while
the key generation does not, so the two are now demonstrably different concepts
sharing one field. A later additive migration needs a separate
`key_generation`, and `renewal_attempt_id` alongside it for idempotent provider
generation. **Not done.**

### Still owed — provider activation reconciliation

Unchanged from the entry above and now more visible: group 0128's trigger marks
a key `active` on credential insert. Under `reuse_current_key` that trigger does
not fire on a new key at all (there is none), so same-key renewal is unaffected —
but the rotation path still asserts provider state the database cannot know.
The ruled states (`credential_issued_pending_activation`, confirmation function,
reconciliation) are **not built**, and a rotated credential must not be reported
usable until they are.

---

## Group 0130 — reserve-before-generate, and provider activation truth

### Task A — the ordering correction

Group 0128 refused to prepare a renewal until a replacement key was already
registered. That ordering **cannot be made retry-safe**: provider key generation
must be idempotent on a stable identifier, and the only stable identifier is the
renewal attempt — which did not exist yet. A retry that lost its response had
nothing to key on and could generate a second key.

`reserve_device_credential_renewal_v1` now creates the attempt **first**, with no
key and none consulted. `register_generation_key_v2` is idempotent on
`renewal_attempt_id`, and a *different* attempt can neither receive nor reuse
that key.

Retry is checked **before** eligibility is re-judged, deliberately: a legitimate
retry must not be refused because the clock moved past the renewal window while
the first response was lost.

Concurrency keeps the two approved codes distinct. A partial unique index
permits exactly one OPEN reservation per next generation while letting terminal
attempts release the slot — so a refused renewal does not wedge the device.

### Task D — what a credential row does and does not prove

Group 0128 marked a rotated key `active` the instant a credential row was
inserted. **PostgreSQL cannot observe the external provider.** A credential row
proves a credential was issued; it proves nothing about whether the private half
is loaded and usable.

A rotated key now lands in `credential_issued_pending_activation` and leaves it
only through `confirm_provider_key_activation_v1`, which compares **nine
bindings** against what the database reserved rather than what the caller
asserts about itself. Confirmation is idempotent for an identical success.

**Initial issuance is not a rotation.** The enrollment key is already operational
when the first credential is issued, so it still activates directly. The trigger
distinguishes the two by whether the key carries a `renewal_attempt_id`.

Operational usability is therefore two conditions, not one:

```text
credential cryptographically valid
AND
provider key active, or an already-active reused key
```

For `reuse_current_key` the second is satisfied on arrival — there is no
replacement key to activate.

### Still owed — cross-system reconciliation

The states and the confirmation exist; the **reconciliation loop does not**.
Nothing yet retries a rotation stranded in `activation_pending`, and no
TypeScript orchestration drives reserve → generate → PoP → issue → confirm.
Until that lands, a rotated credential must not be reported operationally usable
on the strength of these states alone.

`rotate_key` remains disabled in the shipped development policy. Section 35b
enables it under a *named test decision* and restores it; assertion 35c proves
the restore happened, so a leaked override cannot pass unnoticed.

---

## KLRISK-REPO-002 — unexplained commit `9d324f7` (2026-07-29)

An unrequested commit appeared between two authorized ones:

```text
9d324f7  "Implement code changes to enhance functionality and improve performance"
         deletes R&D_HSA_AI_Agent_MVP.md (3,498 lines) — and nothing else
         Author = Committer = the repository's own configured git identity
         AuthorDate = CommitDate = 2026-07-29 09:08:08 +0700
```

It landed **72 seconds** after the authorized `614e217`. The same deletion had
been caught STAGED and explicitly reverted during that commit's preparation, so
this is the second time it appeared. Its message describes work the commit does
not contain.

**Verdict: UNKNOWN SOURCE.** What was ruled out by inspection:

- `git show --name-status` confirms the deletion is the ONLY change;
- `.git/hooks` contains no non-sample hook and `core.hooksPath` is unset;
- no file under `.claude`, `.github`, `scripts`, `tools` or `00_AI_HANDOFF`
  invokes `git commit`;
- the reflog entry is a plain `commit:`, not an amend, rebase or merge.

So it was not repository automation. It was a normal commit made with the
repository's configured identity by something outside this session — an editor,
extension or agent. Which one is **not** identified, and is not guessed here.

**Disposition:** reverted by `4fcb4d5` (`git revert`, no history rewriting).
The file is restored at 3,498 lines.

**Why this stays open rather than closing as "fixed":** the deletion recurred
after an explicit revert. Until the mechanism is identified, any file in this
repository can be removed by a commit nobody authorized, and the next one may
not be a document. This is the same shape as the earlier KLRISK-REPO-001, whose
mechanism also went unidentified.

Recommended owner actions: audit editor/extension git integrations and any
background agent with write access to this checkout; consider whether the push
block is the only thing currently preventing an unauthorized change reaching a
remote.

---

## Device-identity database harness (test-only)

`@kitluy/device-identity` gained `pg` and `@types/pg` as DEV dependencies and a
gated harness at `test/support/dev-database.ts`. Renewal orchestration needs to
run against the real governed functions, and there was no way to reach them from
Node in that package.

Deliberately **not** exported from `src/`: nothing in the shipped package should
be able to open a database connection. A general-purpose database utility
escaping into the runtime is how a local-only tool becomes a production one.

The environment contract is the repository's existing `KITLUY_DEV_DB_URL` with
the local default, reused rather than reinvented so one place decides what a
development database is.

Fail-closed refusals, each with its own test: empty URL, malformed URL,
non-postgres protocol, remote host, hosted Supabase, RDS, `NODE_ENV=production`,
and — the one that is easy to miss — a **production-named database on
localhost**, because a restored production dump on `127.0.0.1` is still
production data. Error messages never interpolate the URL, which carries a
password; a test asserts the password, user and host are absent.

A refused target reports as *not reachable* rather than throwing, so a suite
cannot catch the refusal and read it as a pass. Skips are announced explicitly:
`SKIPPED … this suite did NOT run and is not evidence.`

`withDatabaseTransaction` rolls back **unconditionally**, not only on failure —
the SQL assertion suite is order-sensitive and leaked fixture rows would surface
as failures far from their cause.

**Still pending: Prompt 2B renewal orchestration.** The harness is infrastructure
only. No same-key or rotation orchestration exists in TypeScript, reconciliation
is not implemented, and the full lifecycle and KLRISK-DEVICE-003 containment
suites are not written.

---

## Same-key renewal preflight and reservation — IMPLEMENTED-IN-DEV component

`packages/device-identity/src/same-key-renewal-preflight.ts` implements one
operation, `prepareSameKeyCredentialRenewal`, and stops where the next unit
begins:

```
trusted time -> credential head -> incumbent credential -> stored chain
  -> REAL Ed25519 verification -> renewal eligibility -> provider key
  -> governed reservation (reuse_current_key) -> frozen reservation
```

No credential is prepared, signed or finalized. No key is generated, rotated or
activated. No head is advanced. No lifecycle status is promoted. Those are later
units and are absent rather than stubbed.

**The incumbent is derived, never accepted.** The credential renewed is whichever
one the authoritative head points at. `assertedCurrentCredentialId` exists only
so a caller's belief can be COMPARED; the repository fetches by GENERATION, so
the id a caller supplies is never used to look anything up. A caller nominating
another issued credential is refused with
`RENEWAL_PREFLIGHT_INCUMBENT_NOT_CURRENT`.

**No caller-supplied trust.** There is no `signatureValid`, no `isVerified` and
no injectable verifier on this boundary. `state = 'issued'`, the existence of a
row and the existence of an issuance audit are treated as bookkeeping, never as
evidence that a signature verifies. Tests prove it by flipping ONE byte of the
device link's stored signature and observing
`CHAIN_DEVICE_NOT_SIGNED_BY_INTERMEDIATE` while the row still reads `issued`.
The result carries no caller-usable verified boolean either — only
`consumersMustReVerifyAtAuthenticationBoundary`.

`tbsFromCanonicalBytes` was added to `dev-crypto.ts` because a chain loaded from
PostgreSQL arrives as canonical strings. The subject PEM is the only field that
contains newlines and sits at a FIXED position, so the split is positional, and
the parsed structure is re-serialized and compared byte for byte before use. A
structure that does not round-trip is refused rather than repaired.

**Purpose is pinned, and a unit test found why it had to be.** With the caller
asking to renew a `transport_signing` credential, `evaluateCertificateValidity`
verified a `device_identity` chain and returned VALID: that function pins the
purpose internally and has no purpose input. The preflight now refuses any
purpose other than `device_identity`, matching the `purpose = 'device_identity'`
CHECK on every credential table, and additionally compares the SIGNED purpose.

---

## KLRISK-DEVICE-004 — the named executor could never execute (migration 0131)

**Found by running the integration suite AS `kitluy_issuance_service` instead of
as `postgres`.**

Groups 0127-0130 created `kitluy_issuance_service` as THE named executor of the
governed issuance path and granted it EXECUTE on every governed function. None
of them granted it USAGE on the schema those functions live in. The ACL read:

```
postgres=UC  service_role=U  authenticated=U
kitluy_credential_issuer=UC  kitluy_activation_governor=UC
```

EXECUTE is not sufficient to CALL: PostgreSQL resolves `kitluy_devices.<fn>`
through the schema first, so every governed call made as the intended role
failed with `permission denied for schema kitluy_devices`.

**Why it survived four migration groups and 174 passing assertions:** every test
ran as `postgres`, which is a member of `service_role`, which HAS schema USAGE.
The inherited privilege masked the gap completely. The functions ran, the
assertions passed, and the role the whole design names as the executor had never
once executed them. The privilege model was described, never exercised.

**Disposition:** migration `0131` grants USAGE — and only USAGE — on
`kitluy_devices` to `kitluy_issuance_service`. It does not grant CREATE, does not
grant any table privilege, and does not grant any role membership. The migration
carries hostile assertions that FAIL THE MIGRATION if the boundary widens:
CREATE absent, no insert/update/delete on credentials, heads, provider keys or
reservations, not a member of `kitluy_credential_issuer`, both roles still
NOLOGIN, PUBLIC still holding no EXECUTE, RLS still ENABLE+FORCE.

Assertion section 36 makes the same checks permanent, and 36b runs them **as the
role**: it calls the governed reservation function and requires the answer to be
the POLICY refusal (`KLUY-RENEWAL-NO-CURRENT-CREDENTIAL`) rather than a
permission error, then confirms that direct reads of `renewal_policy`, direct
credential insertion, head advancement, provider-key lifecycle mutation and
`SET ROLE kitluy_credential_issuer` are all still refused.

**Generalized lesson, recorded rather than fixed here:** a privilege matrix can
be correct in the catalogue and wrong in practice. Any future governed role must
be tested by ASSUMING it, not by executing as a superset that inherits its
grants.

---

## Renewal-preflight findings recorded, not fixed (out of scope)

1. **No governed credential-revocation path exists.** Migrations 0125-0131
   define `credential_state = 'revoked'` and
   `KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY`, but no function moves a credential
   into `revoked`, and `postgres` cannot (probed: `permission denied for table
   device_credentials`). The database branch is therefore UNREACHABLE and
   untested from any caller. Renewal preflight covers the revoked case through
   device containment (`quarantine_device_v1`) instead, which is a real signal
   but a different one. A governed revocation function is needed before
   `KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY` can be called tested.

2. **`R&D_HSA_AI_Agent_MVP.md` fails `prettier --check` at `8b9ecb7`.** The file
   is unmodified by this session and fails on its own, so `pnpm format:check`
   — and therefore `pnpm verify` — cannot pass at the recorded baseline. Not
   fixed here: it is outside this unit's scope and a repository-wide format run
   is prohibited.

3. **Node 22 is not installed on this machine.** The repository pins
   `>=22.12.0 <23` with `engine-strict=true`; only Node v24.15.0 is present, so
   `pnpm verify` and `pnpm docs:verify` cannot be invoked as aggregates (their
   nested `pnpm` children re-read the project `.npmrc`). Every constituent step
   was run individually with the engine check relaxed and the results are
   recorded per step. The toolchain deviation is recorded rather than papered
   over: these results were NOT produced on the ACTIVE-BASELINE Node 22.23.0.

**Still pending: Prompt 2B-2 — same-key prepare, sign and finalize.** No
credential issuance, key rotation, provider activation, lifecycle
reconciliation, overlap expiry or independent review exists for renewal.
`KLRISK-DEVICE-003`, `KLRISK-REPO-001` and `KLRISK-REPO-002` remain OPEN.

---

## Same-key prepare/sign/finalize — IMPLEMENTED-IN-DEV component

`packages/device-identity/src/same-key-renewal-issuance.ts` adds one operation,
`completeSameKeyCredentialRenewal`, which runs:

```
preflight + reservation (Prompt 2B-1, reused verbatim)
  -> prepare_device_credential_issuance_v1
  -> the CA signs the reserved bytes
  -> record_device_credential_signature_v1
  -> finalize_device_credential_issuance_v1
  -> the PERSISTED credential, re-verified cryptographically
```

The middle four steps are `runGovernedIssuance` from `issuance-adapter.ts`,
**unchanged**. Renewal does not get a second issuance route. What the new module
adds is the RENEWAL BINDING — the reservation the database froze must still
describe reality at the moment the database prepares — and that check runs
inside a gateway decorator, between preparation and signing, so a disagreement
refuses with **nothing signed**.

**The caller supplies nothing that decides identity.** Credential id, serial,
generation, validity window, canonical TBS and its digest all come from the
database. So does the idempotency key: it is DERIVED from the frozen renewal
attempt id, because `prepare_device_credential_issuance_v1` derives the
credential id and serial FROM that key — a caller able to choose it would be
choosing the serial.

**WHO SIGNS WHAT — a deliberate reading of the instruction.** Prompt 2B-2 §6
says "use the same private key to sign the new credential TBS". Taken
literally that would have the DEVICE key sign its own credential, which
`verifyCertificateChain` refuses (the device link must be signed by the
intermediate) and which §9 of the same instruction then requires to verify. The
two cannot both hold. Implemented as: the **CA intermediate** signs the
credential TBS, so the chain verifies; the **device key** signs a
domain-separated, renewal-bound proof of possession (`kitluy.same-key-renewal-pop.v1`,
binding attempt, device, incumbent, both generations, fingerprint, assignment
generation and scope). That proof is what makes it a *same-key* renewal rather
than an assertion that the key is unchanged, and it is verified with the real
verifier before the database is told anything about it. Recorded here rather
than silently resolved.

**Post-finalization verification is not optional.** Finalization succeeding is a
statement about bookkeeping. The credential is loaded back OUT of PostgreSQL and
put through `evaluateCertificateValidity`; a one-byte mutation of the persisted
signature is refused even though the row still reads `issued`. The result still
carries no caller-usable "verified" boolean — only
`consumersMustReVerifyAtAuthenticationBoundary`.

**What the result reports, as four separate facts rather than one:**
`credentialGenerationAdvanced: true`, `keyGenerationUnchanged: true`,
`keyRotated: false`, and the unchanged fingerprint.

---

## KLRISK-DEVICE-005 — the overlap window compared two different clocks

**Found by executing a real same-key renewal end to end as
`kitluy_issuance_service`. Reproduced deterministically; not a fixture or seed
problem.**

Group 0127's finalization derives the overlap from DEVICE TRUSTED TIME:

```sql
overlap_ends_at := least(attempt.not_before + interval '3 days',
                         previous_credential.not_after)
```

Group 0125's trigger bounded the same value by SERVER TIME:

```sql
if new.overlap_ends_at > new.updated_at + interval '3 days' then refuse
```

`not_before` is the trusted time the device presented; `updated_at` is `now()`.
KLD-2026-07-28-002 §12 separates those clocks ON PURPOSE — device trusted time
governs certificate validity, server time governs approval creation and expiry —
so they are never guaranteed to agree.

Consequence: whenever the device's trusted time was AHEAD of the server clock by
**any** amount, `not_before + 3 days` exceeded `now() + 3 days` and finalization
was refused with `KLUY-CRED-OVERLAP-EXCEEDED`. Measured on the local stack, a
skew of **69 milliseconds** was enough. Same-key renewal was therefore not
fragile — it was impossible for any device whose trusted time did not happen to
lag the database.

Isolation was exact: the identical fixture finalizes with trusted time 5 minutes
BEHIND the transaction clock and is refused with it 1 second AHEAD.

**Why four migration groups and 176 assertions missed it:** no renewal had ever
been finalized. Group 0127's tests issue GENERATION 1, where the head is
INSERTed with a null overlap and the comparison never runs. The rule was only
reachable on the second generation, which nothing had ever created.

**Disposition:** migration `0132` anchors the three-day maximum on the NEW
credential's own `not_before` — the same clock the value is derived from — so
the rule now says what §5 means: at most three days OF THE NEW CREDENTIAL'S OWN
VALIDITY. The independent cap against the previous credential's expiry is
unchanged, and a missing credential row for the incoming head generation still
fails closed on the original server-clock rule. This is not a relaxation: under
the old rule a `not_before` in the past permitted an overlap running to
`now() + 3 days`, i.e. more than three days of the new credential's life.

---

## KLRISK-DEVICE-006 — a reuse_current_key renewal could never complete

Group 0130 defines `completed` in `renewal_reservation_status` and writes it in
exactly one place: `confirm_provider_key_activation_v1`. That function requires a
`device_generation_keys` row bound to the renewal attempt, and the only writer of
that binding, `register_generation_key_v2`, REFUSES any reservation that is not
`rotate_key`.

So a `reuse_current_key` reservation reached `issuance_pending`, its credential
was issued, the head advanced — and the reservation stayed `issuance_pending`
for ever. Observed directly: after a fully successful renewal,
`status = issuance_pending`. Worse than cosmetic — group 0130's partial unique
index treats a non-terminal reservation as OPEN, so the completed renewal kept
blocking the next renewal of that generation.

**Disposition:** migration `0132` completes it where it actually completes —
atomically with the credential insert, in the same transaction as the audit,
chain links and head advance. Rotation is untouched and still waits for provider
activation, because for a rotated key a credential row genuinely does not prove
the private half is usable (group 0130 TASK D).

The trigger BINDS before it completes: generation, assignment generation, and
the incumbent's fingerprint. That last check is what makes `reuse_current_key`
MEAN reuse at the database level — a renewal that finalized against a different
key is refused outright rather than silently completed.

Assertion section 37a proves both corrections BEHAVIOURALLY, in SQL, independent
of the TypeScript suite: it prepares a renewal with the device clock
deliberately ahead of the server clock, finalizes it, and asserts the head
advanced, the overlap is anchored on the new credential's `not_before`, the
fingerprint is unchanged, the reservation reached `completed`, and no provider
key row was created.

---

## KLRISK-DEVICE-007 — there is no governed credential-revocation operation

Restated and escalated to a named risk, having now been confirmed a second time.

Migrations 0125–0132 define `credential_state = 'revoked'`, the refusal
`KLUY-RENEWAL-REVOKED-REQUIRES-RECOVERY`, and a revocation-aware verifier — but
**no function moves a credential into `revoked`**, and `postgres` cannot write
the table (probed: `permission denied for table device_credentials`). The
database branch is unreachable from any caller and therefore untested.

Renewal preflight covers the revoked case through DEVICE CONTAINMENT
(`quarantine_device_v1`) instead. **Containment and revocation are different
controls** and the substitution is recorded, not claimed as equivalent: nothing
in this repository has tested an authorized revocation path, and direct
credential status mutation has NOT been tested as one.

Not implemented here — out of scope for Prompt 2B-2, and inventing a revocation
workflow without an owner decision on who may revoke, on what evidence and with
what four-eyes requirement would be exactly the failure this project exists to
avoid.

---

## Findings recorded, not fixed (out of scope)

1. **The live device-identity fixtures depend on `db:test` having run.** The
   hardware profile `WS11-T001-HUB-PROBE` is created by
   `supabase/tests/assertions.sql`, NOT by the seed — `supabase/seed/` creates no
   hardware profiles at all. The canonical order (reset → seed → db:test →
   test:rls → vitest) therefore is not a convention, it is a requirement. The
   fixture's error message now says so explicitly, because "profile is missing"
   on its own sends a reader hunting through the seed for something that was
   never there. Not resolved by inventing a profile: certification status and
   secure-element expectation are owner decisions.

2. **Orchestration-level retry after a COMPLETED renewal refuses as
   `RENEWAL_PREFLIGHT_NOT_IN_RENEWAL_WINDOW`.** This is correct and safe — the
   head now carries a fresh 30-day credential, so a second renewal of it is
   genuinely too early, and nothing is minted. Idempotency lives one level down,
   on the request id derived from the frozen attempt: preparation, signature
   recording and finalization each replay rather than duplicate, proven stage by
   stage in the live suite. A caller that lost its response and wants the
   credential back should read the head, not re-run the orchestration.

3. **`R&D_HSA_AI_Agent_MVP.md` still fails `prettier --check` at `8bb6b42`**, as
   it did at `8b9ecb7`. Untouched by this session and explicitly excluded from
   it, so `format:check` — and therefore aggregate `pnpm verify` — still cannot
   pass at the recorded baseline.

4. **Node 22.23.0 is still not installed.** Re-checked at session start. Only
   Node v24.15.0 is present, so aggregate `pnpm verify` and `pnpm docs:verify`
   remain non-authoritative and every gate was run individually with the
   documented temporary engine override. No `.npmrc`, `package.json` engines or
   lockfile change was made to silence the mismatch.

**Still pending: Prompt 2C — optional rotate_key orchestration and provider
activation.** Not begun. Crash-point reconciliation, overlap expiry, credential
revocation and independent hostile review of this unit all remain absent.
`KLRISK-DEVICE-003`, `KLRISK-REPO-001` and `KLRISK-REPO-002` remain OPEN.

---

## Optional rotate_key orchestration and provider activation — IMPLEMENTED-IN-DEV component

Two new modules complete the OPTIONAL rotation path:

- `packages/device-identity/src/replacement-key-provider.ts` — replacement-key
  custody: generation, possession proof, activation, abandonment.
- `packages/device-identity/src/rotate-key-renewal-issuance.ts` —
  `completeRotateKeyCredentialRenewal`, the orchestration.

```
preflight + reservation -> generate -> register -> prove possession
  -> prepare/sign/finalize -> PENDING ACTIVATION -> provider activates
  -> database confirms -> re-verify the persisted credential
```

**ROTATION IS STILL NOT THE DEFAULT, AND THIS DOES NOT MAKE IT ONE.** Migration
0129's correction stands: §5.1 was a RECOMMENDATION, and
`kitluy_devices.renewal_policy` keeps `rotate_key` DISABLED pending
`[REQUIRED: renewal_key_rotation_owner_decision]`. Nothing in either module
enables it. Asking for the mode authorizes nothing — the database refuses it
unless the policy permits it, and `renewal_policy_rotation_needs_decision_chk`
means the policy cannot permit it without naming an owner decision. Tests enable
rotation only by NAMING a test decision, satisfying the CHECK honestly rather
than bypassing it, and every test transaction rolls back. A test asserts the
shipped policy is unchanged in a FRESH transaction afterwards.

**Verification is the SHARED route, not a weaker one.** Rather than duplicating
incumbent loading, trusted-time evaluation and real Ed25519 chain verification,
the same-key preflight was widened additively to carry a `renewalMode` that
defaults to `reuse_current_key`. Rotation gets the same verification with a
different mode; there is no second, laxer path to a reservation.

**The signing split is unchanged and deliberate.** The CA intermediate signs the
credential TBS — `verifyCertificateChain` requires it, and a device-signed
credential could not satisfy the post-finalization check. The REPLACEMENT device
key signs a renewal-bound proof of possession instead. Twelve bindings, each
killing one replay, reused verbatim from `replacement-key-pop.ts`.

**Provider activation is where the truth lives.** Migration 0130 TASK D: a
credential row proves issuance, never that the private half is loaded. So
finalization leaves the replacement key
`credential_issued_pending_activation` and the reservation `activation_pending`;
the PROVIDER activates; the database RECORDS that answer. A test drives a
provider that refuses to activate and asserts the credential exists, the key is
still pending, the reservation is still `activation_pending`, the INCUMBENT key
is still `active`, and NO readiness is reported at all.

**Operational readiness is three separate booleans, not one.** Written as a
conjunction — credential cryptographically valid AND replacement key active in
the provider AND database confirmation recorded — so a future edit has to delete
a term rather than quietly widen a flag.

**The incumbent survives.** Nothing in these modules abandons, supersedes or
destroys the incumbent key. Supersession belongs to
`confirm_provider_key_activation_v1`, and only after the replacement is active.
The live suite asserts the end state is `superseded:1,active:2` — two keys, the
old one retired by the database and not by this code.

---

## NO migration was required — verified by execution, not assumed

Prompt 2C's migration policy was tested rather than taken on faith. The whole
rotation path was executed end to end under `kitluy_issuance_service` before any
migration was considered, and the database contract turned out to be COMPLETE:

- `register_generation_key_v2` (0130) binds the key to the renewal attempt and
  is idempotent on it;
- `confirm_provider_key_activation_v1` (0130) enforces nine bindings;
- the `credential_issued_pending_activation` state and the
  `promote_generation_key` trigger (0130) already distinguish rotation from
  initial issuance;
- and — the one that would have blocked everything — group 0128 had already
  GENERALIZED the enrollment-fingerprint check in
  `prepare_device_credential_issuance_v1`. Group 0127 accepted only the
  manufacturing-enrollment key, which made rotation unreachable by construction
  since a new key pair can never match it. 0128 widened it to also accept a
  provider-GENERATED replacement registered for this device and still in state
  `generated`.

So `0133` was NOT added. The next free migration remains `0133`.

---

## Findings recorded, not fixed

1. **Registration cannot be replayed once the renewal COMPLETES.**
   `register_generation_key_v2` refuses a terminal reservation with
   `KLUY-RENEWAL-RESERVATION-TERMINAL`. That is stronger than idempotence and
   correct, but it means registration idempotency is only exercisable
   MID-FLIGHT — before finalization. The live suite proves it there, and proves
   the terminal refusal separately. A first attempt to assert both at once was
   wrong about the contract, not about the database.

2. **`key_generation` may be null on keys predating group 0130.** 0130 SPLIT key
   generation from credential generation; earlier rows carry null. The preflight
   falls back to the credential generation the key was registered against, which
   for a generation-1 key is 1, so rotation still computes the next key
   generation correctly. Asserted explicitly rather than left implicit.

3. **There is no durable challenge-nonce ledger.** The PoP challenge nonce is
   DERIVED from the renewal attempt, so it cannot be freely chosen, and a proof
   bound to another attempt, device, incumbent, generation, fingerprint,
   assignment generation, environment or purpose is refused by binding — each
   proven with a GENUINE signature over a differently bound challenge. A
   verbatim replay of the SAME challenge for the SAME attempt is idempotent
   rather than refused, because `device_proof_of_possession_results` is UNIQUE
   per request id and the request id is derived from the frozen attempt. That is
   durable protection for the case that matters; a cross-process nonce store
   does not exist and is not claimed.

4. **`R&D_HSA_AI_Agent_MVP.md` still fails `prettier --check` at `67152d2`**, as
   at `8b9ecb7` and `8bb6b42`. Untouched and explicitly excluded, so
   `format:check` — and aggregate `pnpm verify` — still cannot pass at baseline.

5. **Node 22.23.0 is still not installed.** Re-checked at session start; only
   v24.15.0. Aggregate verification remains non-authoritative and every gate was
   run individually with the documented temporary override. No `.npmrc`,
   `package.json` engines or lockfile change was made.

---

## Risk register status after Prompt 2C

**CLOSED, with evidence:**

- **KLRISK-DEVICE-005** (the overlap window compared two clocks) — closed by
  migration `0132`, which anchors the three-day maximum on the new credential's
  own `not_before`. Evidence: migration-local hostile assertions; permanent SQL
  assertion section 37a, which prepares a renewal with the device clock
  deliberately AHEAD of the server clock and asserts it finalizes; and the live
  same-key issuance suite.
- **KLRISK-DEVICE-006** (a `reuse_current_key` reservation could never complete)
  — closed by migration `0132`'s completion trigger, which binds generation,
  assignment generation and the incumbent fingerprint before completing.
  Evidence: section 37a asserts `status = completed` after a real renewal;
  section 37b asserts the binding and that rotation is left to provider
  activation; the live same-key suite asserts the same from PostgreSQL.

Both registers reference the migration and the tests. Neither is reopened: no
contrary evidence was found this session, and the rotation path exercised the
same triggers again without incident.

**STILL OPEN, unchanged:**

- **KLRISK-DEVICE-003** — OPTION B. This package remains the only cryptographic
  verifier and is inside the trusted computing base. Rotation did not change
  that and does not weaken it.
- **KLRISK-DEVICE-007** — there is still NO governed credential-revocation
  operation. NOT implemented here, and device containment is still not equated
  with credential revocation.
- **KLRISK-REPO-001**, **KLRISK-REPO-002** — unchanged.

**Still pending: Prompt 3A — crash reconciliation and interrupted-rotation
recovery.** Not begun. Scheduled retry workers, full overlap-expiry lifecycle,
credential revocation, automatic key destruction and independent hostile review
all remain absent.

---

## Renewal reconciliation and interrupted-operation recovery — IMPLEMENTED-IN-DEV component

`packages/device-identity/src/renewal-reconciliation.ts` adds
`reconcileDeviceCredentialRenewal`: it asks PostgreSQL and the key provider what
each believes, classifies the PAIR, and performs exactly ONE safe action.

**The authority split is the design.** PostgreSQL owns the reservation, the
mode, both generations, credential id and serial, canonical TBS, issuance state,
credential persistence, head state, lifecycle and audit. The PROVIDER owns
private-key custody, whether a key exists, its reference and its operational
state. Neither is asked about the other's facts — a reconciler that trusted one
system for the other's would "repair" states that were never broken.

**One decision table, exhaustive, failing closed.** Nineteen rules, each with an
id, the database condition, the provider condition, the classification, the
single action and the reason it is safe. Ordered most-specific first, so a
DIVERGENCE is never mistaken for progress. A state pair matching no rule is
`INCONSISTENT_STATE` and is never guessed at — the states this module exists for
are exactly the ones nobody predicted.

**Exactly-once BUSINESS EFFECT, not exactly-once signing.** Nothing can promise
the latter across a process boundary with a signer that may have completed
before its caller died. What is guaranteed is one credential, one serial, one
head advance, one provider key, one activation. An existing signature is REUSED;
a second different signature for the same frozen TBS is never silently taken.
`KLRISK-DEVICE-003` is untouched.

**Single-step by design.** One action per call, one audit row per call, and the
caller decides whether to call again. A reconciler that drove a renewal to
completion in one pass would be a second implementation of the forward path, and
the second implementation is always the one that drifts.

---

## KLRISK-DEVICE-008 — the granted three-day overlap could never be used

**§9 asked what `superseded` means. Answered by execution, and the answer was
worse than the question suggested.**

What `superseded` does NOT do: it does not destroy the key. After a rotation the
row has `destroyed_at = null`, and the incumbent private key is still in the
provider. Cryptographic verification of the old credential does not need the
private half at all — verified directly, the old credential returns VALID
against its own key and generation.

What was actually broken is the VERIFIER CONTRACT, not the database.
`evaluateCertificateValidity` admitted exactly ONE `currentKeyFingerprint` and
one generation floor. Presented with the device's CURRENT state after a rotation
— generation 2, replacement key, which is what PostgreSQL reports — the previous
credential was refused with `CERT_KEY_FINGERPRINT_MISMATCH`. Measured directly.

So the three-day overlap §5 grants, which migration 0125 models explicitly
(`previous_generation`, `overlap_ends_at`, with the comment that "two
generations are legitimately usable at once"), was unreachable: the moment the
head advanced, the previous credential stopped verifying.

**§9's suggested remedy does not apply.** It says to record a DATABASE-contract
defect and correct it additively. The database side is correct — it models the
overlap faithfully. The defect is in this package's verification contract, so a
migration would have fixed nothing. Recorded here rather than forced into the
shape the instruction assumed.

**Disposition: corrected additively in `certificate-validity.ts`.** An OPTIONAL
`permittedOverlap` — previous generation, previous key fingerprint, and the
head's `overlap_ends_at` — is now accepted. Absent by default, so a caller that
supplies nothing gets exactly the previous behaviour and nothing loosens by
omission. When supplied it admits EXACTLY the one previous generation and
exactly the key it attested to, until the overlap ends against TRUSTED time.
Chain, purpose, environment, device binding, validity window and revocation are
unchanged and still apply: tests prove an overlap rescues neither a revoked nor
an expired credential, and that "older than current" is not the test —
generation 1 is refused when the head says generation 4 overlaps.

Not fixed here, and belonging to Prompt 3B: overlap EXPIRY advancement and
superseded-key destruction.

---

## KLRISK-DEVICE-009 — every rotation retry was refused as a changed payload

**Found by the crash matrix, which is what it is for.**

`completeRotateKeyCredentialRenewal` passed the proof-of-possession CHALLENGE
hash as the governed `canonical_payload_hash`. The challenge embeds `issuedAt`
and `expiresAt` so that it can expire — so it differs on every attempt. And
`prepare_device_credential_issuance_v1` refuses a used request id whose payload
hash changed, correctly, because that is how it detects a different request
wearing an old id.

Consequence: ANY rotation retry after a lost response was refused with
`KLUY-CRED-REQUEST-PAYLOAD-CHANGED`. Rotation could be performed once and never
recovered. The same-key path was unaffected because its payload hash is derived
from frozen reservation values with no timestamp in it.

The mistake was conflating two different questions: "which request is this"
(must be stable) and "which proof was presented" (must expire). They are now
separate: `rotationCanonicalPayloadHash` is derived from the frozen reservation
and the replacement fingerprint only, and the PoP preimage hash still travels in
its own field.

No migration was needed — the database was refusing correctly. Proven by three
crash-matrix cases that failed before the fix and pass after it.

---

## Migration 0133 — the durable-audit gap §15 anticipated

Reconciliation had no durable evidence anywhere. The issuance tables
(`device_credential_issuance_attempts`, `device_credential_renewal_attempts`,
`device_credential_orphan_incidents`) have no place for the renewal attempt id,
the observed PROVIDER state, the classification, the action or its result — so
recording reconciliations there would have discarded most of what makes one
explainable. Application logs are not an answer: the question "why is this
device on this generation with a superseded key" gets asked long after a log has
rotated away.

`device_renewal_reconciliations` is append-only, RLS ENABLE+FORCE, written only
through `record_renewal_reconciliation_v1`. The device and environment come from
the RESERVATION rather than the caller, so nobody can write history against a
device they never touched. It carries a `sequence_no` identity column because
several reconciliations can occur inside one transaction and `now()` would stamp
them identically — leaving "the sequence of rows IS the history" with no order
at all. A CHECK refuses PEM private-key material outright: the cheapest way to
leak a key is to log it while explaining why you could not use it.

Assertion section 38 holds all of that permanently, including that the executor
can record only THROUGH the function, that service_role reads but never writes,
and that a recorded outcome can be neither updated nor deleted.

---

## Findings recorded, not fixed

1. **Provider durability is not proven across a real process restart.** The
   development provider keeps keys in memory, so the crash matrix hands a
   "fresh" reconciler the SAME provider instance. PostgreSQL state IS genuinely
   durable and is re-read. What is proven is that recovery decisions come from
   OBSERVED state rather than from anything carried in the caller's variables:
   the reconciler is constructed fresh, reads everything it acts on, and is
   given no result from the interrupted run. A hardware provider surviving a
   real restart is what would close the gap; it does not exist yet. Labelled in
   the suite header rather than hidden.

2. **True parallel reconcilers are not exercised in the live suite.** Two
   reconcilers cannot share one `pg` client — interleaved queries on a single
   connection corrupt the transaction, and the suite needs one rolled-back
   transaction for isolation. The live test runs them SEQUENTIALLY and proves
   the second produces no second business effect; the unit suite covers the
   interleaved-decision case, where both read the same pre-state before either
   acts.

3. **PoP has no durable marker of its own.** `prepare_device_credential_issuance_v1`
   is what records the proof, so prove-and-prepare is ONE durable step for
   recovery. A rule that classified them separately would have named a
   completion nothing could observe, and recovery would have looped on it. An
   early draft did exactly that and was corrected.

4. **`R&D_HSA_AI_Agent_MVP.md` still fails `prettier --check`** at `ea26e49`, as
   at every prior head. Untouched and explicitly excluded.

5. **Node 22.23.0 is still not installed.** Only v24.15.0. Aggregate
   verification remains non-authoritative; every gate was run individually with
   the documented temporary override and no config file was changed.

---

## Risk register status after Prompt 3A

**OPEN, unchanged and NOT closed:** `KLRISK-DEVICE-003` (OPTION B — this package
is still the only cryptographic verifier), `KLRISK-DEVICE-007` (still no
governed credential-revocation operation; containment is still NOT equated with
revocation, and none was implemented here), `KLRISK-REPO-001`, `KLRISK-REPO-002`.

**NEW:** `KLRISK-DEVICE-008` (overlap unreachable — corrected additively in the
verifier; expiry lifecycle deferred to Prompt 3B) and `KLRISK-DEVICE-009`
(rotation retry refused as a changed payload — corrected, no migration needed).

**Divergence that cannot be repaired automatically** is now a named, durable
condition rather than an implicit one: a database-active key the provider does
not have is classified `INCONSISTENT_STATE`, refused, and RECORDED in the
reconciliation audit for a human. Nothing regenerates a key to "fix" it.

**Still pending: Prompt 3B — credential overlap expiry and superseded-key
lifecycle.** Not begun. Scheduled workers, cron deployment, overlap-expiry time
advancement, automatic destruction of superseded keys, credential revocation and
independent hostile review all remain absent.

---

## Credential overlap expiry and superseded-key lifecycle — IMPLEMENTED-IN-DEV component

`packages/device-identity/src/credential-lifecycle.ts` adds
`advanceDeviceCredentialLifecycle`: it reads authoritative state, decides
whether the §5 overlap is over, retires the previous credential through a
governed function, and evaluates — but never performs — provider-key
destruction.

**Three lifecycles, kept apart.** Credential validity, credential-head status
and provider private-key state are related and are NOT the same thing. A
credential expiring does not prove its key can be destroyed: under every
same-key renewal that key still backs the CURRENT credential. The first blocker
`evaluateKeyDestruction` checks is exactly that, because getting it wrong would
nominate a device's only working key for destruction as a routine consequence of
a routine renewal.

**The boundary is half-open and stated once per layer.**

```
overlap usable   while  trusted_now <  overlap_ends_at
overlap expired  when   trusted_now >= overlap_ends_at
```

Written identically in `overlapIsActive`, in `evaluateCertificateValidity` and
in `retire_overlapped_credential_v1`, and asserted at all three points — one
millisecond before, exactly at, and after — in both the unit suite and SQL
section 39b. A one-millisecond disagreement between the layer that verifies and
the layer that retires is precisely the gap this discipline closes.

---

## KLRISK-DEVICE-010 — the previous credential could never be retired

**Proven by execution, under both identities, before any code was written:**

```
postgres                -> permission denied for table device_credentials
kitluy_issuance_service -> permission denied for table device_credentials
```

and no function in `kitluy_devices` performed the transition. Group 0125 defined
`superseded` and `expired`; group 0127 advances the head with a
`previous_generation` and an `overlap_ends_at`; nothing ever moved a credential
into either state. Once the three-day overlap ended, the previous credential
stayed `issued` for ever.

Combined with the KLRISK-DEVICE-008 fix, that mattered: `permittedOverlap` lets
a caller present the previous credential during the granted window, and without
a durable RETIRED state the only thing standing between a lapsed overlap and a
still-accepted credential was the caller remembering to stop supplying the
overlap. A lifecycle fact has to be persisted, not remembered.

**Disposition:** migration `0134` adds `retire_overlapped_credential_v1`. It
selects the credential from the HEAD rather than from the caller, so the current
credential cannot be retired; it is idempotent; it refuses on untrusted time;
and it never overwrites a `revoked` credential, because revocation says more
than supersession and must not be erased.

**The head is deliberately not rewritten.** Bumping its `version` would
invalidate the frozen `head_version_seen` of any renewal reservation in flight —
retiring an old credential would break a concurrent renewal — and
`overlap_ends_at` is the evidence that explains the retirement. Asserted in
section 39b.

---

## KLRISK-DEVICE-008 hardened — the overlap grant is not a bypass

The optional `permittedOverlap` added in Prompt 3A now carries a REQUIRED
`previousCredentialState`, read from the credential row. An overlap vouches only
for a credential that is still `issued`; once the lifecycle retires it the grant
is spent, and a caller still holding the old overlap object cannot keep it
alive. Making the state a required field means a caller cannot construct an
overlap without having read the row it vouches for.

The boundary comparison also moved from `>` to `>=`, matching the database
exactly. Everything else was already refused and is now asserted: a generation
gap, a fingerprint the credential never attested to, another device, another
environment, a revoked credential and an expired one.

`permittedOverlapFrom` is the only supported way to build a grant, and it
returns null unless the previous generation is EXACTLY one behind the head and
the window is still open.

---

## OWNER DECISION REQUIRED — device private-key destruction

**`[REQUIRED: device_key_destruction_owner_decision]`**

No owner decision governs private-key retention or destruction. Rather than
invent a duration, migration `0134` creates
`kitluy_devices.key_destruction_policy` with destruction DISABLED, both
retention periods NULL, and the missing decision named — the same shape group
0129 used for key rotation.

`destruction_enabled` cannot be set true without naming an approving decision
AND supplying both retention periods. Two CHECK constraints, not conventions,
and section 39a proves both refuse.

The decision must bind:

- **minimum retention** — how long a superseded private key is kept before it
  may be destroyed at all;
- **recovery retention** — how long it must survive specifically so an
  interrupted renewal can still be reconciled;
- **incident and legal hold** — what suspends destruction, and who declares it;
- **provider destruction authorization** — who may ask the provider to destroy;
- **approval requirement** — whether destruction is automatic once eligible or
  requires named operator approval (the table currently defaults
  `requires_operator_approval` to true);
- **evidence** — what must be recorded to prove a key was destroyed, and what
  must survive its destruction.

Until it exists, `advanceDeviceCredentialLifecycle` returns
`KEY_DESTRUCTION_NOT_AUTHORIZED` for a fully unblocked key and destroys nothing.

**Provider-key destruction — SPECIFIED / BLOCKED ON OWNER POLICY.**

---

## Findings recorded, not fixed

1. **Destruction states were NOT added.** §10 lists `destruction_pending` and
   `destruction_failed` as states a safe model *may* require. Execution proved
   neither is required yet: with no policy, destruction never runs, so adding
   them would be speculative schema for a path nothing can reach. `superseded`
   and `destroyed` already exist and are untouched. To be added when the owner
   decision lands and the flow can actually be exercised.

2. **`abandoned` is not reused for a superseded historical key.** A key that
   lost a race is `abandoned`; a key that served a generation and was replaced
   is `superseded`. Keeping them distinct is what lets a reader tell "this key
   never worked" from "this key worked and was retired".

3. **True parallel executors are not exercised live.** Two executors cannot
   share one `pg` client — interleaved queries corrupt the transaction the suite
   needs for isolation. The live test runs them sequentially and proves the
   second produces no second retirement; the unit suite covers the interleaved
   case. Same limitation as Prompt 3A, unchanged.

4. **The retirement refusal differs by mode, correctly.** After retirement a
   same-key previous credential is refused with
   `CERT_STALE_CERTIFICATE_GENERATION` — the two credentials share a fingerprint,
   so the credential really does attest to a key the device holds and is simply a
   superseded generation. Rotation refuses on the fingerprint instead. An early
   test asserted the rotation code for both and was corrected; asserting the
   wrong one would have hidden which check was doing the work.

5. **`R&D_HSA_AI_Agent_MVP.md` still fails `prettier --check`**, as at every
   prior head. Untouched and explicitly excluded.

6. **Node 22.23.0 is still not installed.** Only v24.15.0. Aggregate
   verification remains non-authoritative; every gate ran individually with the
   documented override and no config file was changed.

---

## Risk register status after Prompt 3B

**NEW:** `KLRISK-DEVICE-010` — the previous credential could never be retired.
Corrected by migration 0134 with migration-local hostile assertions and
permanent SQL section 39.

**CORRECTED, pending independent-review disposition:** `KLRISK-DEVICE-008`
(overlap unreachable — the grant is now additionally gated on the previous
credential's persisted state) and `KLRISK-DEVICE-009` (rotation retry refused as
a changed payload).

**OPEN, unchanged and NOT closed:** `KLRISK-DEVICE-003` (OPTION B — this package
is still the only cryptographic verifier), `KLRISK-DEVICE-007` (still no
governed credential revocation; overlap RETIREMENT is not revocation and
provider-key DESTRUCTION is not revocation — three different controls, and none
of the other two was implemented as a stand-in), `KLRISK-REPO-001`,
`KLRISK-REPO-002`.

**Still pending: Prompt 3C — scheduled lifecycle/reconciliation execution and
operational controls.** Not begun. Worker scheduling, cron and queue
infrastructure, production key-provider durability, credential revocation and
independent hostile review all remain absent.

---

## Renewal and credential-lifecycle worker runtime — IMPLEMENTED-IN-DEV component

Groups 0125-0134 built reconciliation and credential-lifecycle advancement as
callable services. Nothing could call them repeatedly and safely from more than
one process. Migration group `0135` and `@kitluy/job-contracts` close that, and
neither adds a scheduler.

**The gap was proven by execution, not inferred.** Before a line was written the
cloud database was probed for anything that could carry the work:

```
tables matching (job|queue|lease|dead_letter|worker|schedul)
  -> exactly one: net.http_request_queue, owned by the pg_net EXTENSION
columns matching (lease|next_attempt|attempt_count|backoff|dedup)
  in any kitluy_* schema
  -> none
```

**The Hub lease model was examined and deliberately NOT extended**, for two
reasons that are facts rather than preferences. It lives in `kitluy_hub_local`,
a SEPARATE database — a job table cannot lease work it cannot see. And its
semantics are an ORDERED stream: the scan STOPS rather than skips, because
skipping past an undelivered event silently reorders history. Device jobs are
INDEPENDENT per device, so one stuck device must never block another device's
renewal. Reusing it would have imported a head-of-line block as a feature.
`kitluy_ops.claim_durable_jobs_v1` uses `FOR UPDATE SKIP LOCKED` for exactly the
opposite reason.

**A shared contract, not a device queue.** Nothing in group 0135 names a device,
a credential or a key: work arrives as a job KIND and an opaque `subject_id`. A
device-only queue would have to be rebuilt the first time any other subsystem
needs durable retries, and two queues with two lease models is how one of them
ends up subtly wrong. `@kitluy/job-contracts` — SCAFFOLDED since bootstrap — is
the matching neutral package boundary and now has a relational contract to
implement.

**Placement was decided by the validator, not by taste.**
`scripts/database/db-validate.mjs` allowlists exactly one control-plane schema:

```js
const CONTROL_PLANE_SCHEMAS = new Set(["kitluy_ops"]);
```

A new `kitluy_jobs` schema would fail `db:validate` for want of a data-dictionary
entry. `kitluy_ops` is already declared as "migration and operations control
plane; no tenant data".

---

## Two counters, because they answer different questions

`attempt_count` is MONOTONIC evidence of how often a job was picked up.
`deferral_count` records how many of those claims ended in "not due yet". The
retry BUDGET is the difference.

This was not the first design. The first `defer_durable_job_v1` refunded the
claim by decrementing `attempt_count`, and the monotonicity trigger refused it —
correctly. Conflating the two breaks one of them: refunding by decrementing
falsifies the history, and charging deferrals to the budget would dead-letter a
perfectly healthy device whose overlap simply ran the three days it was granted.
Keeping both is the only version where neither lies. Asserted in the migration
and in SQL section 40b.

---

## KEY_DESTRUCTION_NOT_AUTHORIZED is a completed job

It is classified `terminal_success`, not `retryable`. An absent owner decision
(KLREQ-031) is not a transient fault: retrying would produce a storm of identical
evaluations that can only ever reach the same answer, and would eventually
dead-letter a job whose result was correct every single time.

Re-opening the question is handled by IDENTITY rather than by polling. The
cleanup dedupe key includes the policy reference, so when an owner decision lands
the reference changes, the key changes, and a NEW deduplicated job asks again.

The cleanup handler contains no reference to a destroy operation — not a disabled
one, not a guarded one, none — so there is no branch anyone could flip. Live
evidence: `eligible: true, authorized: false`, job COMPLETED, provider destroy
calls 0, database destroyed transitions 0, `destruction_enabled` still false.

---

## Defects found by executing group 0135

All four were found by running the path, and all four are in code written this
session. Recorded because the shape of each is a shape that recurs.

**1. A worker that died AFTER starting could never be recovered.**
`claim_durable_jobs_v1` reclaims expired leases from both `leased` and `running`,
but `running -> leased` was missing from the transition table. The crash this
whole model exists for was the one crash it could not recover from. Found by the
live lease-expiry scenario; fixed in both layers.

**2. Every attempt record failed with "permission denied for schema extensions".**
`record_job_attempt_v1` is SECURITY DEFINER and runs as `kitluy_job_governor`,
which holds no USAGE on `extensions` — so `extensions.digest()` was unreachable.
Replaced with the `pg_catalog` builtin, removing the dependency rather than
widening the grant. **The migration's own assertions had missed this because they
only inspected grants and never CALLED the function**; an assertion that executes
it was added.

**3. Ownership transfer was refused before it began.** `alter table ... owner to
kitluy_job_governor` failed with "permission denied for schema kitluy_ops":
PostgreSQL requires a new owner to hold CREATE on the containing schema, and
group 0000 revokes everything on `kitluy_ops` from public. Same family as
KLRISK-DEVICE-004, where a named executor held EXECUTE on every function and no
schema USAGE.

**4. The worker role could not be assumed at all.** `set local role
kitluy_worker_service` was refused because nothing granted membership. Group 0127
makes `kitluy_issuance_service` assumable via `grant ... to service_role`; 0135
now does the same. Membership grants the right to BECOME the worker and confers
none of the worker's absent authorities, which the assertions check on the worker
itself rather than on its members.

---

## A test-isolation defect worth recording

The live suite was intermittently green. The cause was not the runtime: the
concurrency scenarios must COMMIT (two real connections cannot share a rolled-back
transaction), so a mid-test failure leaked claimable rows, and the next run's
claim assertions picked up a stranger's job. Section 40b compounded it by
committing a `queued` job under the REAL device job kind.

Three corrections, because a flaky boundary test is worse than no boundary test:
each concurrency scenario now uses its own unique job kind; section 40b uses a
test-only kind rather than manufacturing claimable work in the production
namespace; and the suite purges leftover `kitluy.test.%` jobs before it starts,
so a failure reproduces where it happened instead of migrating to an unrelated
test next run. Four consecutive full runs at 589/589 after the fix.

---

## Findings recorded, not fixed

1. **No scheduler was deployed, and none was written.** No cron, no pg_cron, no
   Kubernetes CronJob, no Supabase scheduled function, no timer in the package.
   The runtime makes work CLAIMABLE; how often anything claims is a deployment
   decision that has not been taken, and a migration that scheduled itself would
   be that decision taken silently.

2. **Provider durability across a real process restart is still NOT proven.** The
   development provider is in memory, so a reconstructed worker is handed the
   same instance. What IS proven is that recovery decisions come from OBSERVED
   database state, re-read on every path. When a reconstructed worker cannot
   resolve a provider key reference the job goes to `manual_review` with a typed
   result and durable evidence, and never silently generates a replacement.
   Unchanged from Prompt 3A and labelled in the suite header rather than hidden.

3. **The renewal-reconcile job kind has no live end-to-end scenario of its own.**
   Its handler and decision table are unit-tested, and the reconciliation state
   machine it calls already has a 21-case live crash matrix from Prompt 3A. What
   is NOT separately re-proved live is the job wrapper around it. Stated rather
   than implied by the aggregate count.

4. **`durable_jobs` pins `environment = 'development'`** by CHECK, as the device
   tables do. It widens when pilot or production is authorized.

5. **`R&D_HSA_AI_Agent_MVP.md` still fails `prettier --check`**, as at every
   prior head. Untouched and explicitly excluded.

6. **Node 22.23.0 is still not installed.** Only v24.15.0. Aggregate
   verification remains non-authoritative; every gate ran individually with the
   documented override and no config file was changed.

---

## Risk register status after Prompt 3C

**OPEN, unchanged and NOT closed:** `KLRISK-DEVICE-003` (OPTION B — the
device-identity package is still the only cryptographic verifier),
`KLRISK-DEVICE-007` (still no governed credential revocation anywhere; overlap
RETIREMENT is not revocation, key DESTRUCTION is not revocation, and a scheduled
executor is not revocation either), `KLRISK-REPO-001`, `KLRISK-REPO-002`.

**OPEN owner decision:** `KLREQ-031` — device private-key destruction. Unchanged
and deliberately not closed. The cleanup job evaluates and completes; it destroys
nothing and contains no code that could.

**CORRECTED, pending independent hostile review:** `KLRISK-DEVICE-008`,
`KLRISK-DEVICE-009`, `KLRISK-DEVICE-010`.

**No new KLRISK-DEVICE entry was opened.** The four defects above are in code
first written in this session and corrected before it shipped; none describes a
weakness that reached a prior head. Recording them as risks against the shipped
system would misstate what the register is for.

**Still pending: Prompt 3D — governed credential revocation and recovery
disposition.** Not begun. Production scheduling and deployment cadence, external
queue infrastructure, production key-provider durability, credential revocation
and independent hostile review all remain absent.

---

## Findings recorded, not fixed — WS-11-T003 Step 4 Phase D (2026-07-30)

1. **`format:check` fails on 102 files that predate this work, and they are left
   alone.** The gate reports 813 files, which is two different things, and the
   difference was established by execution rather than asserted. `core.autocrlf`
   is `true` with **no `.gitattributes`**, so every text file in a Windows working
   tree is CRLF while Prettier defaults to `endOfLine: "lf"` — roughly 708 of the
   813 are that artifact and nothing else. Checking the **committed** blob of all
   1031 tracked files through the Prettier API gives the real number: 1 file has
   CRLF committed and **105 are genuinely unformatted**. Three are fixed here —
   `packages/device-identity/test/pg-revocation-gateway.integration.test.ts`
   (committed unformatted by Phase C, so genuinely this session's defect),
   `00_AI_HANDOFF/000_INDEX.md` and the Phase A handoff. The remaining 102 are
   imported authority documents, QA and infrastructure specifications and
   `pnpm-lock.yaml`, last touched between 2026-07-26 and 2026-07-29. Reformatting
   imported source-of-truth material is an out-of-scope edit to authority
   documents (CLAUDE.md hard rule 1), so it is recorded here instead. **Four of
   the 102 received an appended row from this phase and were still not
   reformatted** — `00_AI_HANDOFF/000_CURRENT_STATE.md` and the decision,
   evidence and open-decisions registers — because Prettier's fix for each is a
   whole-file markdown-table realignment, and burying a Phase D addition inside
   one immediately before independent review is a real review cost for no
   correctness gain. This also supersedes the narrower Prompt-3C note that named
   only `R&D_HSA_AI_Agent_MVP.md`: that file is one of the 102, not the whole of
   them. **A repository-wide fix wants its own task, and probably wants a
   `.gitattributes` first**, since without one the gate is unrunnable on Windows
   and every future agent will re-measure this.

2. **Nothing populates a signed snapshot's `revokedCertificateSerials` from
   `loadRevocations`.** RC-027 closed the ONLINE path only. The offline Store Hub
   still consumes caller-supplied snapshots, so the join this phase built does not
   yet reach the edge. Stated rather than implied by the fact that a revocation
   lookup now exists.

3. **Concurrency is proven on a local single-node PostgreSQL.** Thirteen scenarios
   run on genuinely separate connections with recorded backend PIDs, barriers,
   winners and losers — but no multi-node behaviour, no connection pooler and no
   Supabase-hosted equivalent is covered, and a pooler in particular can change
   which session holds which lock.

4. **Node v24.14.1, not the `.nvmrc` baseline (`>=22.12.0 <23`).** `pnpm` was
   reached through a local shim with `npm_config_engine_strict=false`. No config
   file was changed. Every Phase D result was produced under that deviation and
   should be re-run on the baseline before promotion — the same limitation carried
   since Prompt 3C, and still not fixed.

5. **No independent review of Phase A–D exists yet.** Phase E is the gate; nothing
   in the evidence register was promoted by this phase, deliberately.

## KLRISK-DEVICE-011 — canonical closure record (2026-08-01)

KLRISK-DEVICE-011 — **CLOSED**.

Group 0135 borrowed `kitluy_job_governor` (NOLOGIN) and never returned it,
leaving a login-capable role able to `set role` into the owner of every
governed durable-job function. An earlier additive repair was REVERTED because
`supabase/tests/assertions.sql` itself relied on the membership.

Group **0160** completed the repair: four narrow governor-owned inspection
readers (attempt/deferral counts, status, last failure code; fixed
`search_path`, explicit return columns, no dynamic SQL, read-only), four
harness-only test-scaffold functions (due-now, mutation-refusal probes,
test-namespace purge, lease expiry), harness EXECUTE on the two governed
operator acts, and the membership itself revoked. `assertions.sql` section 40b
and `packages/device-identity/test/support/job-fixtures.ts` now borrow
`kitluy_test_harness` for exactly one block instead of the governor
permanently; three set-role probe loops treat `permission denied to set role`
as the fail-closed answer it is.

Executable evidence: `db:test` 196 PASS from a from-zero reset (0000→0160);
residue census asserts `job_governor_recorded_exception 0` and
`leaked_memberships 0`; reviewer R2 reproduced zero members (login or not) of
the governor and governor-ownership of all eight 0160 functions.

## KLRISK-DEVICE-007 — closure candidate recorded (2026-08-01)

"There is no governed credential-revocation operation" is superseded by the
WS-11-T003 Step-4 evidence: the governed bound normal path, the governed
emergency path with four-eyes post-approval (APPROVE, REFUSE and LAPSE all
executable), the production lapse worker, offline enforcement in the live Hub
gate, and the 30-stage production lifecycle (30/30). CLOSED by that evidence;
the handoff of 2026-08-01 carries the full record.

## KLRISK-DEVICE-012 — abandoned-key destruction can never reach `destroyed` (2026-08-01)

KLRISK-DEVICE-012 — **OPEN** (contained; requires a future additive migration).

| Field | Value |
| ----- | ----- |
| Title | Migration-0137 abandoned-key destruction basis is unreachable at confirm |
| Source migration | `20260729170137_0137_device_key_destruction_workflow.sql` (eligibility + confirm) and `20260728200128_0128_renewal_key_lifecycle.sql` (`device_generation_keys_abandon_chk`) |
| Defect | `evaluate_key_destruction_eligibility_v1` admits an `abandoned` retention basis (with `abandoned_minimum_retention_days`), but `confirm_key_destruction_v1` sets `state='destroyed'` without clearing `abandon_reason`, and `device_generation_keys_abandon_chk` requires `abandon_reason IS NULL` for every non-`abandoned` state. Since `abandon_generation_key_v1` always sets a reason, **every abandoned key fails the confirm with a check-constraint violation** — the abandoned retention basis is dead code in practice. |
| Affected branch | abandoned-key destruction (unreachable end-to-end) |
| Proven working branch | **superseded-key destruction** — proven end-to-end by the WS-11-T003 Step-4 production lifecycle stage 29 (four-eyes DESTROYED, reconciliation recorded, key row destroyed) and by the key-destruction suites |
| Impact | A documented policy basis cannot execute; an operator abandoning a key for destruction will hit a constraint violation at confirm, after provider-side erasure may already have happened (ambiguous-outcome reconciliation path engaged) |
| Current containment | None needed for integrity: the constraint fails CLOSED (the database refuses the inconsistent state); the superseded path covers every destruction the lifecycle currently needs |
| Required future correction | One additive migration: either clear `abandon_reason` inside `confirm_key_destruction_v1` on the destroyed transition, or amend the constraint to admit `destroyed` with a non-null reason. Out of WS-11-T003 Step-4 scope; no task file exists yet — title to come from the next WS-11/fleet work package |
| Status | OPEN |
| Evidence | `00_AI_HANDOFF/shared/2026-08-01__SHARED__WS-11-T003-STEP4__RUNTIME-ENFORCEMENT-AND-REVIEW-REMEDIATION__AI-HANDOFF.md` (risk section + stage-29 build notes); reproduction: `confirm_key_destruction_v1` on an abandoned key raises `new row for relation "device_generation_keys" violates check constraint "device_generation_keys_abandon_chk"` |

Does not reopen KLRISK-DEVICE-007 (closed 2026-08-01): the governed destruction
operation exists and is exercised through the superseded basis.
