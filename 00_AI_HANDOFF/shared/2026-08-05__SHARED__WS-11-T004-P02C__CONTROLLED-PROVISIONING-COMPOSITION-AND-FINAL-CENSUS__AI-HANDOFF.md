# WS-11-T004-P02C — CONTROLLED PROVISIONING COMPOSITION AND FINAL CENSUS — AI HANDOFF

| Field          | Value                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| Date           | 2026-08-05                                                                                                      |
| Package        | WS-11-T004-P02C (controlled provisioning composition, runtime grants, final capability census)                  |
| Status         | **PARTIAL — TERMINAL TRANSPORT IDENTITY REQUIRED**                                                              |
| Start SHA      | `c5eb58dabc47fb9b0780748cb936ade72ddddef2` (test(ws-11): harden redemption races and replay)                    |
| End SHA        | recorded by `git log -1` after the package commit                                                               |
| Branch / ahead | `main`, ~105 ahead at intake; push `disabled://push-requires-owner-approval` — **nothing pushed**               |
| Toolchain      | **Node v22.23.0** (kitluy-toolchain), pnpm 9.15.9 (corepack), engine-strict=true                                |
| Migration      | `supabase/migrations/20260805230000_0172_provisioning_composition_identity.sql` (additive; 0000–0171 untouched) |

## 1. Identity classification (§6 — recorded BEFORE implementation)

**Boundary A (service → database): A2 — existing machine-identity framework,
new narrow role.** The repository already runs capability roles as NOLOGIN
identities granted to `service_role` and assumed per transaction with `SET
LOCAL ROLE` (0127 `kitluy_issuance_service`, 0135 `kitluy_worker_service`,
`database.ts::withServiceRole`). Migration 0172 adds
**`kitluy_provisioning_service`** on exactly that pattern: NOLOGIN, member of
nothing, granted to `service_role`, holding schema USAGE plus EXECUTE on
**exactly five** capabilities and **zero table privileges**. The broad
`service_role` shortcut was NOT used: it holds no direct grant on any
provisioning door (asserted by direct-ACL inspection, since its INHERIT
attribute makes membership-aware checks report the composer's capabilities).

**Boundary B (terminal → composition service): B3 — transport authority
undefined.** No pre-credential terminal request authority exists in this
repository; the shipped revocation routes already refuse every request with
`AUTHENTICATION_NOT_CONFIGURED` for the same reason (BLK-006). Inventing
mTLS, device tokens or session cookies is exactly what that gate forbids, so
**no HTTP route ships in this package.** What ships is the trusted internal
composition service, its typed contract, the controlled grants and executable
tests. This is why the package status is PARTIAL rather than complete.

## 2. Files changed (complete list)

1. `supabase/migrations/20260805230000_0172_provisioning_composition_identity.sql` — new (role, narrow context reader, five grants, assertions).
2. `services/kitluy-device-registry-service/src/provisioning-composition.ts` — new (the composition service).
3. `services/kitluy-device-registry-service/src/database.ts` — the composer added to `REGISTRY_ROLES` and to `withServiceRole`'s role union.
4. `services/kitluy-device-registry-service/test/provisioning-composition.integration.test.ts` — new, 7 tests (scenarios A–F + identity), zero skips.
5. `supabase/tests/rls-tests.sql` — WS11-N19 added (3 PASS); WS11-N12/N17/N18 `service_role` checks converted to direct-ACL semantics.
6. `supabase/tests/assertions.sql` — the evaluator privilege census converted to direct-ACL semantics for `service_role`.
7. `services/kitluy-device-registry-service/test/provisioning-code-pop|redemption|redemption-races.integration.test.ts` — `service_role` removed from three denial probes (it now reaches the doors only through the intended 0172 membership).
8. `services/kitluy-device-registry-service/test/residue-spendability-census.integration.test.ts` — documented grant bound 8 → 10.
9. This handoff, the final capability census, one `000_INDEX.md` row.

**Recorded boundary evolution (not a weakening):** three pre-existing
assertions declared the provisioning doors "harness/governor-only" and
listed `service_role` as denied. P02C is the package that replaces
harness-only access with a composition identity, so those assertions were
updated to the intended boundary — and hardened at the same time, because
membership-aware checks would have silently passed while a _direct_
`service_role` grant existed. The new checks read the ACL itself, which is a
stricter test than the one they replace.

## 3. The composition surface

`TerminalProvisioningComposition` — three typed operations, each one
transaction as the NOLOGIN composer:

1. `presentCodeAndIssueChallenge` — validates the request shape, calls the
   0164/0166 evaluator, and issues the 0170 challenge **only** on the
   canonical MATCH_READY. Wrong presentations return the governed bounded
   failure; attempt counting and lockout stay entirely in the evaluator.
   Returns terminal-facing challenge material only (no digest, no scope
   grants, no enrollment data).
2. `verifyProofAndRecord` — reads authoritative context through the new
   narrow 0172 reader (never table SELECT), reconstructs the canonical
   `kitluy.provisioning-pop.v1` bytes from **stored rows** (never a
   caller-supplied payload), verifies with the existing
   `@kitluy/device-identity` authority, and records the attestation only on a
   genuine pass. A failed verification never touches the successful path.
3. `redeemProvisioning` — the terminal presents the raw code **again** (the
   earlier MATCH_READY is never trusted), and the certificate serial is
   **server-derived** from the idempotency key — never terminal-selected, and
   deliberately deterministic so an identical retry after an ambiguous
   outcome re-presents the same immutable request instead of colliding with
   the credential authority's uniqueness rule.

**Request validation:** UUID shape, exact 8-character Crockford alphabet,
bounded idempotency key (≤96 chars, so the derived serial stays inside its
own contract), base64 signature charset and ≤128 chars, PEM shape. Malformed
input maps to `REQUEST_INVALID` before any database work.

**Result mapping:** one closed `ProvisioningResultCode` union; `mapRefusal`
maps by refusal-code family, never by SQLSTATE or message text, and an
unknown refusal becomes `INTERNAL_ERROR` rather than being passed through.
No SQLSTATE, function name, schema name, role name or digest detail can
escape.

**Observability:** the logger receives exactly `{operation, correlationId,
result}` — proven by a census that asserts the field set and scans every log
line for every raw code the suite ever created. Redaction is structural: the
secrets are never passed to the logger at all.

## 4. End-to-end evidence (scenarios A–F, real identity, real Ed25519 keys)

| Scenario                       | Result                                                                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A full development composition | challenge → real signature → verified → redeemed; credential ISSUED against the enrolled fingerprint; server-derived serial; response carries no raw code, no private material and no activation claim; code REDEEMED  |
| B wrong code → lockout         | four bounded `CODE_INVALID`, fifth `CODE_LOCKED`, correct code afterwards still `CODE_LOCKED`; **zero challenges ever issued**; no proof, no credential                                                                |
| C invalid proof                | another terminal's genuine signature → `PROOF_INVALID`; challenge stays `issued`; redemption then refused; no verified record                                                                                          |
| D ambiguous outcome            | first `REDEEMED`, same-key retry `REDEMPTION_REPLAYED` with identical certificate id and `redeemedAt`; one credential; changed immutable input → `IDEMPOTENCY_CONFLICT`                                                |
| E Hub withdrawn mid-flow       | presentation and proof already committed, then governed withdrawal → redemption `HUB_INACTIVE`; code unredeemed, proof unconsumed                                                                                      |
| F pilot / production           | `issue_device_certificate_v1` raises P0001 for both; **zero** pilot/production certificates exist — a function grant is never signing approval                                                                         |
| identity                       | the composer executes its five capabilities and is refused (42501) on a non-capability door and on direct table SELECT; anon and authenticated refused on the context reader and the redemption door; log census clean |

## 5. Security posture

Composer: NOLOGIN, member of nothing, five function grants, schema USAGE
only, zero table privileges (asserted three ways: migration guard, WS11-N19,
live 42501 probes). `service_role`: no direct grant on any provisioning door
— its only path is the composer, per transaction. Human doors
(issue/revoke/recover) remain `authenticated`-scoped and unchanged. No
login-capable role holds any NOLOGIN owner; no escalation path from the
composer to a governor role. Raw-code, nonce, signature, digest and
private-key census clean across events, certificates and logs. Residue
census after the full run: 0 suite grants, 0 test-clock rows, 0 borrowed
memberships, 0 fault triggers, composer held by exactly 1 role.

## 6. Verification (Node v22.23.0; fresh reset; cloud and Hub serialized)

| Command                                    | Exit | Result                                                                          |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| `pnpm migrations:validate` / `db:validate` | 0/0  | 71 files                                                                        |
| `pnpm db:reset` (0000→**0172**) + seed ×2  | 0    | 71 applied; 0172 guard NOTICE; idempotent                                       |
| `pnpm db:test`                             | 0    | **227 PASS, 0 FAIL** (baseline 224 + 3 WS11-N19)                                |
| `pnpm test:rls`                            | 0    | **129 PASS, 0 FAIL** (baseline 126 + 3 WS11-N19)                                |
| composition suite                          | 0    | **7/7, zero skips** (scenarios A–F + identity)                                  |
| `pnpm hub:db:reset` + seed + test          | 0    | **35 PASS**                                                                     |
| registry full suite (serial)               | 0    | **320/320, 29 files, zero skips** (baseline 313 + 7)                            |
| device-identity                            | 0    | **803/803**                                                                     |
| `pnpm secret:scan` / `clock:check`         | 0/0  | 1300 files clean / PASS                                                         |
| targeted `prettier` on changed files       | 0    | clean                                                                           |
| `pnpm verify`                              | 1    | **11 of 12** — only the recorded pre-existing ~830-file `format:check` artifact |

No baseline regressed: db:test 224→227, rls 126→129, registry 313→320
(28→29 files), device-identity 803→803, Hub 35→35, lifecycle 30→30, census
14→14. Recorded operational note: `db:test` is not independently idempotent
and must follow a reset (pre-existing, re-confirmed here), and the cloud
reset drops `kitluy_hub_local`, so the Hub must be rebuilt before the two
Hub-dependent suites run.

## 7. Format condition

Every changed package file passes targeted prettier. The full
`format:check` failure is the recorded pre-existing ~830-file artifact,
identical at starting HEAD, with no package file flagged. `pnpm verify`
exits 1 for that reason alone and is reported as 11 of 12 — not as passing.

## 8. BLK-005 posture

Unchanged and re-exercised: development composes through the approved PKI
configuration; **pilot and production fail closed inside
`assert_pki_configuration_approved`** and are proven to create zero
certificates (scenario F). No production signer, key location, custody
owner, rotation policy or HSM integration was invented. No production grant
exists.

## 9. Remaining T004 gaps

See the final census. In short: versioned route contract (blocked on
terminal transport identity), credential delivery to the Store Hub, terminal
acknowledgment, terminal activation, and the entire §8 pairing handshake
(challenge, nonce replay protection, receipt, persistence, offline recovery)
are MISSING/NOT STARTED. **WS-11-T004 is not complete.**

## 10. Rollback

`git revert <package commit>`, then `pnpm db:reset` (0000→0171) and Hub
rebuild. Additive only — the role and reader vanish with the migration; no
earlier object was modified.

## 11. Recommended next package

**WS-11-T004-P03A — terminal activation and provisioning-completion state**,
then P03B (pairing challenge, nonce, receipt) and P03C (pairing persistence,
replay, offline recovery). The terminal-transport identity decision (Boundary
B) is an owner value that gates the versioned route contract and should be
resolved before or alongside P03A.
