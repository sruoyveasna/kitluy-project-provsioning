# WS-11-T004-P01 — terminal assignment and provisioning capability audit

| Field      | Value |
| ---------- | ----- |
| Date       | 2026-08-03 · Asia/Phnom_Penh |
| Package    | WS-11-T004-P01 — investigation and evidence only; **no implementation, no migrations, no runtime changes, nothing pushed** |
| Start SHA  | `bef05c4` (verified: main, clean, 88 ahead, push `disabled://push-requires-owner-approval`, Node v22.23.0, pnpm 9.15.9) |
| Title      | Terminal (T1–T4) assignment and provisioning — **DERIVED FROM AUTHORITATIVE SOURCES** (no literal register title; see §3) |

## 1. Repository intake

Verified per package §2. WS-11-T003 COMPLETED-IN-DEV; T004 implementation not
started; no unexplained changes; migration numbering has no conflict
(cloud 0161 applied, hub 0030 applied). Hub database was rebuilt with the
governed `hub:db:reset`/`hub:db:seed` for catalog inspection (cloud resets
wipe it; state at handoff: both chains fully applied, seeded).

## 2. Authority sources (with classification)

| Source | Class |
| ------ | ----- |
| `00_AI_HANDOFF/000_ACTIVE_PHASE.md` §10 (owner-directed dependency order 2026-07-28) | AUTHORITATIVE |
| `kitluy-device-discovery-and-pairing-protocol-v1.0.0.md` §5–§13 | AUTHORITATIVE (canonical protocol) |
| `kitluy-pos-desktop-app-phase1-spec-v4.0.0.md` §3.2, rule "Store Hub must be active before a terminal can be provisioned" | AUTHORITATIVE |
| `kitluy-device-certificate-and-trust-policy-v1.0.0.md` §5 (claim), §11 (replacement), §14 (gate) | AUTHORITATIVE |
| Master build plan §WS-11 (terminal assignment, `pairing_sessions`, `terminal.assigned/paired` events) | AUTHORITATIVE |
| QA registry `POS4-QA-001` (provision terminal from code), `ADMIN-QA-014` (terminal cannot provision before Hub is active) — both SPECIFIED_NOT_EXECUTED | AUTHORITATIVE (as acceptance sources) |
| Migrations 0100, 0120–0128, 0130–0161 and their executable assertions | AUTHORITATIVE (live evidence) |
| Discovery handoff 2026-08-03 | DERIVED (subordinate to the above) |

## 3. Title classification

`WS-11-T004` next-permitted: AUTHORITATIVE. Next step = terminal assignment:
AUTHORITATIVE (ACTIVE_PHASE §10 step 6). Exact title string: DERIVED
("Terminal (T1–T4) assignment and provisioning"). The earlier proposal
"Provisioning codes and Hub activation" is NOT confirmed — Hub activation is
delivered (device_claims + `attempt_activate_device_v1` with the asserted
BLK-005 gate).

## 4. Capability matrix

Legend — schema: PRESENT/PARTIAL/ABSENT · runtime: WIRED/LIBRARY-ONLY/TEST-ONLY/ABSENT · tests: level or ABSENT.

### A. Terminal identity

| ID | Capability | Authority | Schema | Runtime | Tests | Gap | Owner |
| -- | ---------- | --------- | ------ | ------- | ----- | --- | ----- |
| A1 | Terminal as device with hardware profile | 0120 devices/hardware_profiles | PRESENT | WIRED (enroll_device_v1) | package+assertions | none — no subtype table needed | cloud DB |
| A2 | T1–T4 profile identifiers | 0100 (Cycle 5) | PRESENT | WIRED | db:test | none | cloud DB |
| A3 | Terminal hardware identity/manifest signals | 0120 manufacturing_enrollments, hardware_manifest_signals | PRESENT | WIRED | package suites | none | cloud DB |
| A4 | Terminal key proof (non-exportable) | 0125-0128 generation keys, PoP | PRESENT | WIRED (issuance doors) | package suites | none | cloud DB |
| A5 | Terminal operational certificate | 0125-0128 device_credentials | PRESENT | WIRED (same doors as Hub) | package+lifecycle | none | cloud DB |
| A6 | Certificate lifecycle (renewal/rotation/revocation) | T003 groups | PRESENT | WIRED | T003 suites incl. 30-stage lifecycle | none | cloud DB |
| A7 | Terminal status/lifecycle state | devices.lifecycle_state + 0121 awaiting_trust | PRESENT | WIRED | db:test | none | cloud DB |
| A8 | Terminal environment | devices/credentials environment columns | PRESENT | WIRED | suites | none | cloud DB |
| A9 | Terminal-to-device relationship | devices + device_terminal_assignments | PRESENT | TEST-ONLY today | lifecycle fixtures | production caller absent (see B/D) | service |

### B. Terminal assignment

| ID | Capability | Authority | Schema | Runtime | Tests | Gap | Owner |
| -- | ---------- | --------- | ------ | ------- | ----- | --- | ----- |
| B1 | Tenant/Store/Location binding | device_assignments (0121) | PRESENT | TEST-ONLY | lifecycle | production caller | service |
| B2 | Assigned Store Hub | claim redemption creates Hub assignment (0121) | PRESENT | TEST-ONLY | lifecycle stage 6 | production caller | service |
| B3 | Assigned terminal profile | device_terminal_assignments + assign_terminal_profile_v1 (0121) | PRESENT | TEST-ONLY | fixtures/lifecycle | **no production caller** | service |
| B4 | Assignment state machine | assignment_state enum + transitions | PRESENT | WIRED (DB) | db:test | none | cloud DB |
| B5 | Assignment creator attribution | assigned_by_operator_ref | PRESENT | WIRED (DB) | db:test | none | cloud DB |
| B6 | Replacement/expiry of assignments | device_replacements, superseded states | PRESENT | WIRED (DB) | package suites | none (replacement workflow = later task) | later |
| B7 | Installer cannot select roles | profile assigned cloud-side; no installer path | PRESENT (by absence) | ABSENT (no endpoint at all) | none needed yet | endpoint must enforce, not re-offer selection | service |
| B8 | One-live-terminal-per-profile-per-device | device_terminal_assignments_one_live_idx | PRESENT | WIRED (DB constraint) | db:test | none | cloud DB |
| B9 | Reassignment/revocation | revoked_at, assignment_state | PRESENT | TEST-ONLY | fixtures | governed caller | service |
| B10 | Wrong-Location refused structurally | denormalized store_location_id + trigger check | PRESENT | WIRED (DB) | db:test | none | cloud DB |

### C. Provisioning code (pairing protocol §6.1)

| ID | Capability | Authority | Schema | Runtime | Tests | Gap | Owner |
| -- | ---------- | --------- | ------ | ------- | ----- | --- | ----- |
| C1 | 8-char Crockford Base32 code | §6.1 | ABSENT | ABSENT | ABSENT | **entire code format** | cloud DB+service |
| C2 | Case normalization / ambiguous-char rejection | §6.1 | ABSENT | ABSENT | ABSENT | spec-level only | service |
| C3 | 15-minute TTL | §6.1 | ABSENT (claims carry TTL at creation, 900s in fixtures) | TEST-ONLY (claims) | fixtures | code-scoped TTL contract | cloud DB |
| C4 | Single-use | §6.1 | PARTIAL (claim_state pattern) | TEST-ONLY | db:test | terminal-code equivalent | cloud DB |
| C5 | Hash-only storage | §6.1 | PRESENT pattern (claim_token_sha256) | WIRED (claims) | db:test | reuse pattern for codes | cloud DB |
| C6 | Attempt counter | §6.1 (5-attempt lockout) | ABSENT | ABSENT | ABSENT | **new** | cloud DB |
| C7 | Five-attempt lockout + reason | §6.1 | ABSENT | ABSENT | ABSENT | **new** | cloud DB |
| C8 | Lockout security event | §6.1 + threat model | ABSENT | ABSENT | ABSENT | **new** (audit/incident event) | cloud DB |
| C9 | Code regeneration/invalidation | §6.1, §13 | PARTIAL (claim revoked_at) | TEST-ONLY | fixtures | terminal-code revoke path | cloud DB |
| C10 | Concurrent redemption race safety | claim one-outstanding index pattern | PARTIAL pattern | WIRED (claims) | concurrency suites | code-level equivalent | cloud DB |
| C11 | Idempotent redemption | T003 idempotency patterns | PARTIAL pattern | WIRED elsewhere | T003 suites | code redemption idempotency | cloud DB |
| C12 | Tenant/Store/Location/Hub binding | §6.1 + trust policy §5 | PARTIAL (claims bind Tenant/Store/Location; terminal code must bind assigned profiles+Hub) | TEST-ONLY | fixtures | profile/Hub binding columns | cloud DB |

### D. Provisioning endpoint and runtime

| ID | Capability | Authority | Schema | Runtime | Tests | Gap | Owner |
| -- | ---------- | --------- | ------ | ------- | ----- | --- | ----- |
| D1 | Installer/operator provisioning route | pos spec §3.2, admin /fleet | ABSENT | ABSENT (service is SCAFFOLD) | http.test.ts only | **entire endpoint** | provisioning-service |
| D2 | Authenticated operator context | approvals domain + actors | PARTIAL pattern | WIRED (other services) | T003 fixtures | operator identity for code issuance | service |
| D3 | Enrollment validation | enroll machinery | PRESENT | WIRED (DB) | package | wire into flow | service |
| D4 | Assignment validation | assign machinery | PRESENT | TEST-ONLY | fixtures | wire into flow | service |
| D5 | **Active-Hub ordering gate** (no terminal before active Hub) | pos spec §3.x; ADMIN-QA-014 | ABSENT | ABSENT | ABSENT | **named acceptance case, unimplemented** | service+DB |
| D6 | Terminal key proof verification | PoP machinery (0127) | PRESENT | WIRED (issuance) | package | flow composition | service |
| D7 | Certificate issuance in flow | 0125-0128 doors | PRESENT | TEST-ONLY for terminals | package | production caller for terminal flow | service |
| D8 | Hub endpoint return (identity/addresses) | protocol §5, §12 | PARTIAL (assignment carries Hub) | ABSENT | none | endpoint contract | service |
| D9 | T1–T4 profile set return | profile machinery | PRESENT (DB) | ABSENT (no endpoint) | none | endpoint contract | service |
| D10 | Config snapshot return | WS-10 publication | PRESENT (WS-10) | WIRED (sync) | WS-10 suites | composition reference only | sync-service |
| D11 | Terminal → active transition | awaiting_trust → active | PRESENT (state machine) | TEST-ONLY | db:test | governed caller | service |
| D12 | Retry/reconciliation of flow | job runtime + idempotency | PARTIAL pattern | WIRED elsewhere | T003 suites | flow-level retry contract | service |
| D13 | Production composition root | T003 composition.ts pattern | PRESENT (registry) | WIRED | composition tests | provisioning-service equivalent | service |
| D14 | Test-only adapters or unused exports | — | — | claim/assign doors are TEST-ONLY today | — | documented as gaps, not removed | — |

### E. Pairing session (protocol §8–§13)

| ID | Capability | Authority | Schema | Runtime | Tests | Gap | Owner |
| -- | ---------- | --------- | ------ | ------- | ----- | --- | ----- |
| E1 | Pairing session creation + id | §8 | ABSENT (terminal_session is an OPERATOR session, not device pairing) | ABSENT | ABSENT | **new table + doors** | cloud DB+Hub |
| E2 | Challenge/response handshake | §8.1–8.3 | ABSENT | ABSENT | ABSENT | **new** | cloud DB+Hub |
| E3 | Hub verification of terminal | §8.3 | PARTIAL (hub terminal_device registry, WS-09) | WIRED (hub gate) | hub-agent suites | certificate-based verification | Hub |
| E4 | Cloud verification of Hub | §8 | PRESENT (credentials) | WIRED | T003 suites | flow composition | service |
| E5 | Pairing state machine | §10 | ABSENT | ABSENT | ABSENT | **new** | cloud DB |
| E6 | Session expiry | §10 | PARTIAL pattern | WIRED elsewhere | suites | pairing-scoped TTL | cloud DB |
| E7 | Replay protection | §8 (nonce) | ABSENT | ABSENT | ABSENT | **new** | cloud DB+Hub |
| E8 | LAN discovery of Hub | §4–§5 | PARTIAL (hub identity/heartbeat on Hub) | WIRED (Hub) | hub suites | discovery client = terminal app, later | terminal app (later) |
| E9 | Cached Hub endpoint | §11 | PARTIAL (Hub holds identity) | WIRED (Hub) | hub suites | terminal-side cache, later | terminal app (later) |
| E10 | Manual IP fallback | §12 | ABSENT | ABSENT | ABSENT | defer to terminal-app package | later |
| E11 | Offline completion of pairing | §10–§11 | ABSENT | ABSENT | ABSENT | receipt must enable it | Hub |
| E12 | **Pairing receipt** (signed, Hub-persisted) | §9 | ABSENT | ABSENT | ABSENT | **new — the offline-trust artifact** | cloud DB+Hub |
| E13 | Receipt integrity/signature | §9 + snapshot signing pattern (T003) | PARTIAL pattern | WIRED (snapshots) | signing suites | receipt signature design | shared package |
| E14 | Receipt acknowledgement | §9 | ABSENT | ABSENT | ABSENT | new | service |
| E15 | Recovery after interruption | §10, §13 | PARTIAL (job patterns) | WIRED elsewhere | suites | flow recovery contract | service |
| E16 | Replacement and retry after replacement | §13 | PARTIAL (device_replacements) | TEST-ONLY | fixtures | later task (step 11) | later |

### F. Security and authorization

| ID | Capability | Schema/Runtime | Tests | Gap |
| -- | ---------- | -------------- | ----- | --- |
| F1 | Permissions/roles for code issuance | ABSENT (no fleet-operator grant for codes) | — | permission key + approval policy (approvals domain) |
| F2 | RLS on new tables | pattern PRESENT (ENABLE+FORCE everywhere) | db:test | P02 must add, asserted |
| F3 | NOLOGIN definer doors | PRESENT pattern (activation_governor, credential_issuer) | db:test | reuse or one new governor (P02 decides) |
| F4 | Narrow service identity | PARTIAL (provisioning-service has none yet) | — | no new broad grants; no service_role shortcuts |
| F5 | Audit events | PRESENT pattern (claim events, lifecycle events) | db:test | code lifecycle + lockout + redemption events |
| F6 | Rate limiting / brute-force | ABSENT (§6.1 lockout missing) | ABSENT | C6–C8 |
| F7 | Idempotency | PRESENT pattern | T003 suites | code issuance/redemption idempotency |
| F8 | Sensitive action confirmation | approvals pattern | T003 suites | four-eyes where policy says |
| F9 | Cross-Tenant isolation | PRESENT (claims scoped + RLS) | db:test+rls | code must bind scope identically |
| F10 | Cross-Store/Location isolation | PRESENT (structural refusal) | db:test | terminal code binding must refuse wrong scope |
| F11 | Environment isolation | PRESENT | suites | code carries environment |
| F12 | Hub-active-before-terminal rule | ABSENT | ABSENT | D5 (named acceptance case) |
| F13 | Private-key custody | PRESENT (provider vault, never stored) | package suites | terminal key must follow identically |
| F14 | BLK-005 fail-closed behavior | PRESENT (gate, asserted) | db:test | gate posture unchanged by T004 |

### G. Offline and Store Hub behavior

| ID | Capability | Schema/Runtime | Tests | Gap |
| -- | ---------- | -------------- | ----- | --- |
| G1 | Hub-side terminal registry | PRESENT (edge_identity.terminal_device, WS-09) | hub suites | none for registration |
| G2 | Hub-side pairing listener/enforcement | PARTIAL (device gate exists; no pairing handshake) | hub suites | handshake endpoint (P04/P05) |
| G3 | Pairing state persistence on Hub | ABSENT | ABSENT | receipt persistence (P05) |
| G4 | Local terminal trust verification | PARTIAL (gate checks assignment+serial; no certificate-chain check of terminal) | hub suites | receipt-driven trust |
| G5 | Local configuration delivery | PRESENT (WS-09/10 config projection) | hub suites | none |
| G6 | Restart recovery | PRESENT (Hub re-reads state) | hub suites | receipt reload semantics |
| G7 | Internet-loss behavior | PRESENT (offline authority) | hub suites | pairing must complete from receipt alone |
| G8 | Terminal reconnect without code | §11 | ABSENT | receipt-driven reconnect (P04/P05) |
| G9 | Stale configuration handling | PRESENT (watermark/sequence pattern) | hub suites | none |
| G10 | Last-known-good preservation | PRESENT (snapshot pattern) | lifecycle | receipt equivalent |
| G11 | Local audit evidence | PRESENT (hub append-only ledgers) | hub suites | pairing events on Hub |
| G12 | Eventual cloud reconciliation | PRESENT (sync outbox) | hub suites | pairing acknowledgement upstream |

### H. Tests and evidence

| Case | Status |
| ---- | ------ |
| Claim create/redeem/scope/append-only | production-composition (lifecycle), integration (fixtures) |
| Terminal profile assignment | fixture-level (lifecycle, package suites) |
| Certificate issuance/renewal/revocation | production-composition (T003 suites, 30-stage lifecycle) |
| Provisioning codes (any aspect) | **ABSENT** |
| Attempt lockout / brute-force event | **ABSENT** |
| Role-choice refusal | ABSENT (no endpoint exists to test it) |
| Active-Hub ordering (ADMIN-QA-014) | **ABSENT** (SPECIFIED_NOT_EXECUTED in registry) |
| Provision terminal from code (POS4-QA-001) | **ABSENT** (SPECIFIED_NOT_EXECUTED) |
| Pairing handshake/receipt/state machine | **ABSENT** |
| Offline pairing/reconnect/restart | PARTIAL (hub offline suites cover gate, not pairing) |

## 5. Schema inventory (live catalog)

Cloud latest: **0161** → next free **0162**. Hub latest: **0030** → next free **0031**.

- Terminal-related tables: `device_terminal_assignments` (only one with 'terminal'/'pair'/'provision' in name anywhere, cloud or hub).
- Assignment tables: `device_assignments`, `device_terminal_assignments`, `device_assignment_projections`.
- Certificate tables: `device_credentials`, `device_credential_heads`, `device_generation_keys`, `device_certificates`, chain links.
- Provisioning-session/code tables: `device_claims` (Hub claim; DD `provisioning_sessions` lineage) — **no terminal-code table**.
- Pairing tables: **NONE** (hub `terminal_session` = operator session).
- Roles: `kitluy_activation_governor`, `kitluy_credential_issuer`, `kitluy_credential_approval_reader`, `kitluy_issuance_service`, `kitluy_worker_service`, `kitluy_job_governor`, `kitluy_test_clock_authority`, `kitluy_test_harness` (+ `authenticated`/`anon`/`service_role`/`postgres`).
- Claim/assign function grants: EXECUTE to `postgres`, `service_role`, `kitluy_activation_governor` — no dedicated code-issuance identity yet.

## 6. Runtime call-path map (intended vs actual)

Intended (protocol §7): operator issues code → terminal presents code + key proof → active-Hub check → assignment validation → certificate → Hub identity + profiles → pairing session → receipt → terminal active.

Actual participation today: **none of the chain has a production caller.**
- `create_device_claim_v1` / `redeem_device_claim_v1` / `assign_terminal_profile_v1`: EXECUTE-able by service_role/activation_governor, invoked ONLY from test fixtures and the lifecycle (TEST-ONLY).
- Provisioning-service: kernel only (`/health/live`, `/health/ready`, `/version`); no business route.
- Device-registry: issues credentials through governed doors; no terminal-provisioning caller.
- Hub: enforces assignment+revocation at the gate; no pairing handshake endpoint.
- Broken/missing links: D1 (route), D5 (ordering gate), D7 (flow caller), E1–E5/E7/E12–E14 (pairing machinery), C1–C3/C6–C8 (code format + lockout).

## 7. Threat audit (25 named threats, condensed)

| # | Threat | Existing control | Gap → P02 requirement |
| - | ------ | ---------------- | --------------------- |
| 1-3 | code guessing/enumeration/replay | hash-only pattern (claims); single-use pattern | 8-char space + lockout + security event (C6–C8); redeem bound to payload hash |
| 4 | parallel redemption | one-outstanding index pattern (claims) | equivalent unique partial index for codes (C10) |
| 5 | expired-code use | TTL pattern (claims expires_at) | authoritative-time expiry check at redeem (C3) |
| 6 | lockout bypass | none | counter increments on EVERY failed attempt, transaction-safe, lockout row append-only (C6–C8) |
| 7-8 | code in logs / raw storage | token never stored pattern | hash-only (C5); code never logged; constant-time compare at redeem |
| 9-11 | cross-Tenant/Store/Location use | scope-bound claims + structural refusal | code binds Tenant/Store/Location/environment at issue; redeem refuses any other scope (C12) |
| 12 | inactive-Hub provisioning | none | ordering gate: Hub assignment `active` required before redeem proceeds (D5/F12) |
| 13 | installer profile selection | no endpoint exists (by absence) | endpoint accepts NO profile input; profile comes from assignment only (B7) |
| 14 | terminal public-key substitution | PoP + fingerprint binding (issuance) | redeem requires PoP against the ENROLLED fingerprint |
| 15 | certificate to wrong assignment | scope binding in issuance | issue under the code's recorded assignment only |
| 16 | stale assignment use | assignment state machine | redeem re-validates assignment state at use time |
| 17-18 | pairing replay / fake receipt | snapshot-signing pattern (T003) | nonce-bound receipt, signed, Hub verifies (E7/E12–E13) |
| 19 | LAN impersonation | Hub gate checks assignment+serial | pairing receipt required for trust (E3/E12) |
| 20 | manual-IP downgrade | spec says address never creates trust | defer to terminal-app package (E10) |
| 21 | offline state rollback | watermark/sequence pattern | receipt carries sequence/watermark (E12) |
| 22 | reassignment without revocation | transition matrix + revocation | revoke-before-reassign door (B9) |
| 23-24 | direct DB mutation / service-role shortcut | NOLOGIN doors, RLS, no broad grants | same pattern; census assertion in P02C |
| 25 | missing immutable audit | append-only event pattern | code lifecycle events append-only (F5) |

## 8. Exact gap list (what P02+ must deliver)

1. Terminal provisioning-code table (neutral, DD `provisioning_sessions` lineage, distinct from Hub-scoped `device_claims`).
2. Code format engine: 8-char Crockford Base32, case/ambiguity handling, hash-only storage.
3. Attempt counter + 5-attempt lockout + reason + security event.
4. Governed issue/redeem doors with scope binding, TTL, single-use, race-safe redemption, idempotency.
5. Active-Hub ordering gate (ADMIN-QA-014).
6. Provisioning-service endpoint with production composition (D1–D4, D6–D9, D11–D13).
7. Pairing session table + handshake doors + nonce replay protection + state machine.
8. Signed pairing receipt with Hub persistence + offline verification + acknowledgement.
9. All security tests for C/F items + POS4-QA-001 + ADMIN-QA-014 executable.
10. Offline pairing/reconnect/restart/receipt tests (G items).

## 9. P02 implementation contract (recommended: DECOMPOSED)

P02 as one package is oversized. Recommended decomposition:

### P02A — schema and constraints (cloud migration 0162)

- Objective: neutral terminal provisioning-code schema only.
- Allowed: `supabase/migrations/20260803*_0162_terminal_provisioning_codes.sql`, `supabase/tests/assertions.sql` (additive section).
- Prohibited: runtime code, other migrations, hub files.
- Table (neutral Core, no Laundry terms): `kitluy_devices.device_provisioning_codes`
  - `id uuid pk default gen_random_uuid()`
  - `device_record_id uuid not null references kitluy_devices.devices(id)`
  - `assignment_id uuid not null references kitluy_devices.device_assignments(id)` (carries Tenant/Store/Location; Hub binding derived through it — no denormalized scope columns unless P02A's audit shows the join is unsafe)
  - `environment text not null`
  - `code_hash char(64) not null unique` (SHA-256 hex; the code itself never stored)
  - `payload_sha256 char(64) not null` (binds device+assignment+profiles+expiry)
  - `terminal_profile_keys text[] not null` (the assigned profile set, `<vertical>.t<n>.<role>` shape per B10)
  - `state enum('issued','redeemed','expired','revoked','locked') not null default 'issued'`
  - `failed_attempts integer not null default 0 check (failed_attempts >= 0)`
  - `locked_reason text` (+ consistency check: locked ⇒ reason present)
  - `expires_at timestamptz not null`, `redeemed_at`, `revoked_at`, `issued_by_operator_ref text not null`, `created_at`
  - Partial unique index: one outstanding (`state='issued'`) code per device
  - Indexes: (device_record_id, created_at desc), (assignment_id)
- RLS: ENABLE+FORCE; zero anon; read only through definer doors.
- Doors (this package declares them; P02B implements): issue/redeem/revoke owned by `kitluy_activation_governor` (reuse existing NOLOGIN authority — a new governor is NOT justified by the audit).
- Events: `device_provisioning_code_events` append-only (issue/redeem/expire/revoke/lock).
- Gate: from-zero reset + db:test green incl. new assertion section (shape, RLS, indexes, grants absent-for-runtime).

### P02B — governed doors: issue, redeem, lockout, security event

- Objective: the code lifecycle as SECURITY DEFINER functions.
- Allowed: one additive migration (0163), assertions.sql.
- Contract: issue (operator permission + approval per approvals domain; TTL from policy value, default 900s; code generated outside DB, hash recorded); redeem (constant-time hash compare; payload match; TTL under authoritative time; single-use via state transition; failed attempt increments counter; 5th failure sets locked + reason + security event; active-Hub gate — assignment's Hub must be `active`; PoP binding to enrolled fingerprint); revoke (operator); idempotency by idempotency key; race: two concurrent redeems produce exactly one success.
- Events: every transition + lockout emits append-only event with actor/source.
- Gate: all §6.1 cases executable in db:test; concurrency case for parallel redemption.

### P02C — RLS, grants and executable security census

- Objective: grant boundary + census.
- Allowed: one additive migration (0164), assertions.sql, census test file.
- Contract: EXECUTE grants to `kitluy_activation_governor` + the provisioning-service's future identity path (service_role per existing pattern — no new login role); census asserts no runtime role can read code_hash lists, no PUBLIC, no worker, lockout counter immutable by runtime roles, events append-only.
- Gate: census green; db:test/rls green.

Each package ≤59 min / ≤80 steps, one primary outcome. P02A→P02B→P02C strictly serial.

## 10. Unresolved values

- **TTL source of truth**: §6.1 says "15 minutes by default" — the policy HOME for the value (renewal_policy-style signed policy vs constant) is DERIVED; P02A must pick one and document it (recommend: constant with comment, policy change = later owner decision).
- **Security event destination**: `device_claim_events` pattern vs `device_trust_incidents` — DERIVED (recommend incidents for lockout, events for lifecycle; P02B decides with the assertions).
- **Code issuance permission key name**: `fleet.device_provisioning_code.issue` (DERIVED; confirm against `kitluy_auth` permission registry in P02B).
- **Whether terminal codes share `device_claims`**: resolved here as NO — new neutral table (Hub-claim semantics stay untouched); recorded as an audit decision, not an authority change.

## 11. Risks and blockers

- BLK-005 stays OPEN: the flow must issue through the existing gate; development resolves, pilot/production fail closed with named `[REQUIRED: ...]` values. No signer invention.
- KLRISK-DEVICE-003 OPEN: unchanged.
- The claim/assign doors' TEST-ONLY state means no production behavior exists to regress; P03 must not widen claim semantics.
- Cross-service file ownership for P03–P05 is mapped in the discovery record; no conflicts found with current tree.

## 12. Final P01 decision

```text
READY FOR DECOMPOSED P02A/P02B/P02C
```
