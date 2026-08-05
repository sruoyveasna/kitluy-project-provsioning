# WS-11-T004-P02B3A — TERMINAL PROOF-OF-POSSESSION FOUNDATION — AI HANDOFF

| Field          | Value                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| Date           | 2026-08-05                                                                                                         |
| Package        | WS-11-T004-P02B3A (terminal proof-of-possession foundation)                                                        |
| Status         | **IMPLEMENTED-IN-DEV** (audit classification: PARTIAL — additive binding required; migration 0170 created)         |
| Start SHA      | `de208aeda18f225cd9795707f7956cd2ba12a903` (test(ws-11): harden recovery races and replay)                         |
| End SHA        | recorded by `git log -1` after the package commit                                                                  |
| Branch / ahead | `main`, ~102 ahead at intake; push `disabled://push-requires-owner-approval` — **nothing pushed**                  |
| Toolchain      | **Node v22.23.0** (kitluy-toolchain), pnpm 9.15.9 (corepack), engine-strict=true                                   |
| Migration      | `supabase/migrations/20260805200000_0170_terminal_provisioning_pop_challenges.sql` (additive; 0000–0169 untouched) |

## 1. PoP capability audit (§6 — documented BEFORE implementation)

**Classification: PARTIAL — ADDITIVE BINDING REQUIRED.**

Existing and reused unchanged:

- **Terminal key identity**: `kitluy_devices.manufacturing_enrollments`
  (0120) — `device_public_key_fingerprint` (SPKI-DER SHA-256, 64-hex),
  `public_key_algorithm`, sealed/superseded/revoked states,
  `devices.current_enrollment_id` as the currency pointer. The private key
  never exists server-side (trust policy §4).
- **Crypto authority (OPTION B, the 0127 ruling)**: PostgreSQL cannot verify
  Ed25519; `@kitluy/device-identity` is the signature authority —
  `verifyDetachedSignature`, `publicKeyFingerprint`, the
  fixed-order-newline canonical-bytes discipline with domain separators
  (`kitluy.cert.v1`, `kitluy.csr.v1`, `kitluy.renewal-pop.v1`), and the
  bindings-first-signature-last PoP verifier pattern
  (`replacement-key-pop.ts`). Ed25519 remains the recorded PROVISIONAL
  development algorithm under
  `[REQUIRED: device_certificate_signature_algorithm]`; nothing here
  promotes it.
- **Trusted time** (`trusted-time.ts`) and the authoritative DB clock
  (`kitluy_ops.authoritative_now_v1`, 0157/0158).
- **Provisioning eligibility**: the 0162–0169 doors and their
  assignment→code lock order; the active-Hub projection gate.

Gaps (what 0170 + the new module add — nothing else):

- no provisioning-redemption proof purpose/domain existed;
- no challenge bound to the provisioning-code ROW, assignment, Hub, profile,
  environment and enrolled key;
- no single-use, relational verified-proof state P02B3B can lock and consume
  atomically with redemption;
- protocol §8 Hub↔terminal pairing challenges remain ABSENT and OUT OF SCOPE
  (P01 audit rows E2/E7 — later packages).

## 2. Cryptographic-authority decision

No algorithm, encoding, serialization or library invented. The new module
`packages/device-identity/src/provisioning-pop.ts` defines only:

- domain separator **`kitluy.provisioning-pop.v1`** (refuses `kitluy.csr.v1`
  and `kitluy.renewal-pop.v1` proofs structurally);
- purpose **`terminal_provisioning_redemption`** (pinned by check constraint
  AND by the verifier);
- the sixteen-line canonical byte contract (fixed field order): kind,
  challengeId, purpose, tenant, store, location, environment, hub, terminal,
  assignment, profile, **provisioning-code ROW id** (never the raw code),
  enrolled key fingerprint, nonce, issuedAt, expiresAt;
- `verifyProvisioningPop(challenge, signature, pem, expectation,
trustedTime, computeFingerprint, verifySignature=verifyDetachedSignature)`
  — every binding checked against the DATABASE row's expectation, bindings
  first, trusted-time window (equality boundary expires), sealed-enrollment
  and fingerprint gates before the signature, signature last. Verification
  runs in the SERVICE runtime; the DB records only the attestation.

## 3. Files changed (complete list)

1. `supabase/migrations/20260805200000_0170_terminal_provisioning_pop_challenges.sql` — new.
2. `packages/device-identity/src/provisioning-pop.ts` — new module in the crypto authority.
3. `packages/device-identity/src/index.ts` — one export line.
4. `packages/device-identity/test/provisioning-pop.test.ts` — new, 22 unit tests.
5. `services/kitluy-device-registry-service/test/provisioning-code-pop.integration.test.ts` — new, 10 integration tests.
6. `supabase/tests/rls-tests.sql` — WS11-N17 boundary case (3 PASS notices) + summary line.
7. This handoff + one `00_AI_HANDOFF/000_INDEX.md` row.

## 4. Challenge model (migration 0170)

`kitluy_devices.device_provisioning_pop_challenges` — one row per challenge,
bound to: version (pinned `kitluy.provisioning-pop.v1`), purpose (pinned),
tenant/store/location/environment, Hub device, terminal device, terminal
assignment, T1–T4 profile, **provisioning-code row FK**, current
manufacturing-enrollment FK, enrolled key fingerprint (64-hex check), nonce
(32 secure-random bytes hex — stored RAW by design: it is not a bearer
secret, and the verifier must reconstruct the exact signed bytes from
authoritative records), created/expires, one-way state machine
`issued → verified → consumed`, OPTION B attestation fields (only TRUE is
ever storable, all-or-none with `verified_at`), correlation. Immutability
trigger freezes every binding; only the state machine moves; `consumed` is
reserved for P02B3B. **One proof per code, ever** (partial unique index on
`provisioning_code_id where state in ('verified','consumed')` + polite
under-lock guards). FORCE RLS with governor-only policies (the 0126/0163
pattern); zero table grants; no raw-code, private-key or stored-signature
column (asserted on apply and in WS11-N17).

**RECORDED TTL DECISION:** no independent challenge TTL exists in repository
authority and none was invented — `expires_at` inherits the bound code's own
`expires_at` exactly (the owner-approved 15-minute lifetime, 0162), so a
challenge can never outlive the code it exists to redeem. Byte-identical
inheritance is proven in the integration suite.

## 5. Door contracts (both SECURITY DEFINER, owner `kitluy_activation_governor`, pinned search_path, **harness-only until P02C**)

- `issue_terminal_provisioning_pop_challenge_v1(p_terminal_assignment_id uuid) returns jsonb`
  — locks ASSIGNMENT then outstanding CODE (the established order); refuses:
  null/missing/inactive assignment, no outstanding code, expired code
  (authoritative clock; never expires it), attempts ≥5, scope inconsistency,
  Hub-less scope, missing/unsealed/revoked current enrollment, code already
  proven. Returns exactly the authoritative material the service needs to
  build the canonical bytes (never a raw code, digest or key).
- `record_terminal_provisioning_pop_verification_v1(p_challenge_id uuid, p_attested_signature_verified boolean, p_attested_challenge_hash text, p_attested_key_fingerprint text) returns jsonb`
  — locks ASSIGNMENT → CODE → CHALLENGE; single-use under the lock
  (`POP_ALREADY_VERIFIED` stable replay; consumed → refusal); challenge
  expiry on the authoritative clock (equality boundary); re-validates the
  live assignment, ISSUED+unexpired+<5-attempts code, the BOUND Hub's
  current projection, and enrollment currency; refuses a non-TRUE
  attestation (`SIGNATURE-REJECTED`, zero residue — and **no
  provisioning-code attempt increment**: presentation attempts belong to the
  0164 code contract, not PoP) and a fingerprint that is not the bound
  enrolled key (`KEY-MISMATCH`); one-proof-per-code guard; then the ONE
  guarded `issued→verified` transition. Success returns the single-use,
  explicitly **NON-AUTHORITATIVE** proof descriptor.
- EXECUTE: `kitluy_test_harness` only; public/anon/authenticated/
  service_role/worker revoked and asserted. Grants for the real provisioning
  composition authority are P02C's, deliberately absent.

## 6. Race evidence (separate backends; canonical run PIDs 621/622)

| Race                                                                                          | Result                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A identical attestations                                                                      | one `POP_VERIFIED`, one `POP_ALREADY_VERIFIED`; exactly one verified row; no uncontrolled SQLSTATE                                                                                               |
| B valid vs rejected attestation                                                               | success stands; the rejected racer meets the verified challenge and receives the stable reconciliation — never a reversal, never a stored failure                                                |
| C verification vs canonical code expiry at the EXACT boundary (µs-precise `expires_at::text`) | verification refuses `CHALLENGE-EXPIRED`; the 0166 helper owns the one EXPIRED transition; challenge stays `issued`; **no proof exists after expiry**                                            |
| D verification vs governed 0165 revocation                                                    | revocation-first → `CODE-ALREADY-REVOKED`, zero residue; verification-first → proof records, revocation still commits — the proof row is never reversed and remains non-authoritative for P02B3B |
| E verification vs governed 0121 Hub withdrawal                                                | withdrawal-first → `HUB-INACTIVE` fail-closed against the BOUND Hub, zero residue; verification-first → proof stands (non-authoritative), withdrawal unimpeded                                   |

## 7. Success / hostile / privacy evidence

- Full loop with a REAL Ed25519 keypair: door-issued challenge → service
  canonical bytes → terminal signature → service verification → attestation
  door → one verified single-use proof; **the provisioning code never moves**
  (state ISSUED, zero new events), no credential, no activation.
- Unit (22) + integration (10): every transplant of a genuine signature into
  a wrong context refuses with its specific code (wrong challenge / tenant /
  store / location / environment / hub / terminal / assignment / profile /
  code / purpose; superseded enrollment; wrong fingerprint; forged key;
  altered payload; malformed/empty/oversized signatures; boundary expiry;
  future-dated challenge; no trusted time).
- Doors 42501 for anon, authenticated AND service_role; challenge table
  unreachable (SELECT/INSERT/UPDATE 42501); raw-code census across all
  challenge columns: zero hits; no login-capable governor member; zero
  grant/membership/clock residue after the run.
- BLK-005 posture unchanged: the dev CA remains development-only and nothing
  here touches pilot/production signing custody.

## 8. Verification (Node v22.23.0 throughout; fresh reset; cloud and Hub serialized)

| Command                                        | Exit | Result                                                                                                                                               |
| ---------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm migrations:validate` / `db:validate`     | 0/0  | 69 files PASS                                                                                                                                        |
| `pnpm db:reset` (0000→**0170**) + `db:seed` ×2 | 0    | 69 applied; 0170 guard NOTICE; seed idempotent                                                                                                       |
| `pnpm db:test`                                 | 0    | **221 PASS, 0 FAIL** (baseline 218 + 3 WS11-N17)                                                                                                     |
| `pnpm test:rls`                                | 0    | **123 PASS, 0 FAIL** (baseline 120 + 3 WS11-N17)                                                                                                     |
| device-identity suite                          | 0    | **803/803, 34 files, zero skips** (+22 new)                                                                                                          |
| PoP integration suite                          | 0    | **10/10, zero skips**; race PIDs 621/622                                                                                                             |
| `pnpm hub:db:reset` + seed + test              | 0    | 31 migrations, **35 PASS**                                                                                                                           |
| registry full suite (serial)                   | 0    | **293/293, 26 files, zero skips** (baseline 283 + 10; lifecycle 30/30, residue census 14/14)                                                         |
| `pnpm secret:scan` / `clock:check`             | 0/0  | 1290 files clean / PASS 4/4                                                                                                                          |
| targeted `prettier --check` on changed files   | 0    | clean                                                                                                                                                |
| `pnpm verify`                                  | 1    | **11 of 12 PASS** — only the recorded pre-existing ~830-file `format:check` artifact (identical at clean HEAD; none of this package's files flagged) |

Baseline comparison — **no regression**: db:test 218→221, rls 120→123,
registry 283→293 (25→26 files), Hub 35→35, lifecycle 30→30, census 14→14,
device-identity 781→803. Required new tests: zero skips.

## 9. Unresolved owner values / risks

1. `[REQUIRED: device_certificate_signature_algorithm]` stands — Ed25519
   remains dev-provisional; the PoP module inherits whatever the owner rules
   via the injected `verifySignature`/`computeFingerprint` seams.
2. Enrollment supersession MID-FLIGHT (challenge issued, then
   `reenroll_device_v1` replaces the key, then attestation) is enforced by
   the record door's currency check but not integration-proven — driving the
   governed re-enrollment continuity flow would entangle its quarantine
   rules; the gate is proven at unit level (`POP_ENROLLMENT_NOT_ELIGIBLE`)
   and asserted structurally on apply. P02B3B/C may add it once a
   lightweight re-enrollment fixture exists.
3. Terminal-side transport (how the challenge reaches a real terminal and
   the signature returns) is provisioning-service HTTP work — out of scope
   here, part of the P02C-era composition.
4. The redeemed-state evidence gap recorded since 0165 continues (P02B3B
   builds redemption and closes it).

## 10. Rollback

`git revert <package commit>`, then `pnpm db:reset` (0000→0169) and Hub
rebuild. Additive only; no earlier object changed.

## 11. P02B3B prerequisites (exact)

- Consume `device_provisioning_pop_challenges` row in state `verified`
  (lock assignment → code → challenge; the trigger permits exactly
  `verified→consumed` with `consumed_at`), **atomically with**: re-checks of
  assignment/code/Hub/enrollment, the `issued→redeemed` code transition, and
  credential binding/issuance through the existing 0125–0128 machinery.
- Refuse redemption when the proof is expired, consumed, or when ANY
  authoritative fact changed since verification (the proof is a
  prerequisite, never authorization — asserted in every door comment).
- One redemption per code; the one-proof-per-code index is already in place.
- P02C then owns the production composition grants for both PoP doors and
  the redemption door.

Do not mark WS-11-T004 complete.
