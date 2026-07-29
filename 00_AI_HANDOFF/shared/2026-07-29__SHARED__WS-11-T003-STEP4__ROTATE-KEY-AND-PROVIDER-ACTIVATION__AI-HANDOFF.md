# Optional rotate_key renewal and provider activation — AI Handoff

| Field           | Value                                                          |
| --------------- | -------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Prompt 2C (optional rotation + activation) |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                   |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                    |
| Starting SHA    | `67152d2`                                                      |

## Scope

**In:** rotation preflight reusing the shared verification; `rotate_key`
reservation; idempotent replacement-key generation; governed public-metadata
registration; renewal-specific proof of possession; prepare/sign/finalize;
pending activation; provider activation; database confirmation; post-finalization
cryptographic verification.

**Out, and absent rather than stubbed:** crash reconciliation, scheduled retry
workers, full overlap-expiry lifecycle, credential revocation, automatic key
destruction, independent hostile review.

## What was built

- `src/replacement-key-provider.ts` — replacement-key custody. Generation is
  idempotent on the renewal attempt; possession proof and activation re-check
  every binding against what the provider itself generated; abandonment is
  terminal for issuance; there is no export surface.
- `src/rotate-key-renewal-issuance.ts` — `completeRotateKeyCredentialRenewal`.

The shared same-key preflight was widened ADDITIVELY to carry a `renewalMode`
defaulting to `reuse_current_key`, so rotation reuses the same incumbent
loading, trusted-time evaluation and real Ed25519 chain verification. There is
no second, weaker route to a reservation.

**Rotation is still not the default.** Nothing in these modules enables it. The
database refuses `rotate_key` unless `kitluy_devices.renewal_policy` permits it,
and `renewal_policy_rotation_needs_decision_chk` means the policy cannot permit
it without naming an owner decision. Tests enable it only by naming a TEST
decision, satisfying the CHECK honestly; a test then proves the shipped policy
is unchanged in a fresh transaction.

**The signing split is unchanged:** the CA intermediate signs the credential
(the chain verifier requires it), the replacement device key signs only the
renewal-bound proof of possession.

**Provider activation is where the truth lives.** Finalization leaves the key
`credential_issued_pending_activation` and the reservation `activation_pending`.
A test drives a provider that refuses to activate and asserts the credential
exists, the key is still pending, the INCUMBENT is still `active`, and NO
readiness is reported. Operational readiness is three separate booleans ANDed
together, so a future edit must delete a term rather than widen a flag.

## No migration was added — verified, not assumed

The full rotation was executed end to end under `kitluy_issuance_service` before
any migration was considered. The database contract proved COMPLETE: 0130
supplies `register_generation_key_v2`, `confirm_provider_key_activation_v1` and
the pending state; and group 0128 had already generalized the
enrollment-fingerprint check in `prepare_device_credential_issuance_v1` — group
0127 accepted only the enrollment key, which made rotation unreachable by
construction. `0133` was NOT written; it remains the next free migration.

## Commands executed (with actual results)

Canonical order: `db:reset` → `db:seed` → `db:test` → `test:rls` → vitest.
Node **v24.15.0** throughout.

| Command                               | Exit | Result                                       |
| ------------------------------------- | ---- | -------------------------------------------- |
| `pnpm db:reset` / `db:seed`           | 0    | 0000→0132 from zero, seeded                  |
| `pnpm db:test`                        | 0    | **178 PASS** (unchanged — no SQL changed)    |
| `pnpm test:rls`                       | 0    | **104 PASS** (unchanged)                     |
| device-identity `vitest run`          | 0    | **418 passed / 0 skipped**, 19 files         |
| live rotation suite                   | 0    | **15 EXECUTED**, 0 skipped                   |
| rotation unit suite                   | 0    | **41 passed**                                |
| `pnpm typecheck`                      | 0    | 89/89                                        |
| `pnpm lint`                           | 0    | 0 errors, 2 pre-existing warnings            |
| `pnpm clock:check --require-complete` | 0    | COMPLETE 4/4                                 |
| `pnpm secret:scan`                    | 0    | clean                                        |
| `docs:verify` (8 steps)               | 0    | **8/8 PASS**                                 |
| `verify` (12 steps)                   | —    | **11/12**; `format:check` fails pre-existing |

**TOOLCHAIN DEVIATION.** Node 22.23.0 re-checked at session start and still not
installed. Aggregate `pnpm verify` and `pnpm docs:verify` are NOT
baseline-authoritative; every step was run individually with the documented
temporary override, and no `.npmrc`, engines field or lockfile was changed.

**Pre-existing failure, not a regression:** `format:check` on
`R&D_HSA_AI_Agent_MVP.md`, untouched and explicitly excluded.

## Tests: passed / failed / not run

All added tests pass. Two of my own assertions were wrong and were corrected
against the real contract, not the other way round:

- registration idempotency is only exercisable MID-FLIGHT; once the renewal
  completes, `register_generation_key_v2` refuses a terminal reservation with
  `KLUY-RENEWAL-RESERVATION-TERMINAL`, which is the stronger guarantee;
- `key_generation` is null on keys predating group 0130's split, and the
  preflight's fallback to the credential generation is correct — so the test now
  asserts the fallback rather than a refusal.

## Security findings

Preserved and asserted: rotation disabled by default and un-enablable without a
named owner decision; private keys never leave the provider and no export
surface exists (asserted by name sweep, with `exportable: false` excluded and
checked separately); no caller-supplied cryptographic verdict anywhere; the
canonical TBS is the database's and is signed unchanged; the CA intermediate
signs credentials, the device key only proves possession; a rotated key waits in
`credential_issued_pending_activation`; nine activation bindings each refuse
with their own code; the issuance service still cannot write credentials, heads
or key lifecycle directly; NOLOGIN governors; RLS ENABLE+FORCE.

Every PoP binding-negative test uses a GENUINE signature over a differently
bound challenge, so the refusal proves the binding rather than a broken
signature.

No new risks. **KLRISK-DEVICE-005** and **KLRISK-DEVICE-006** are CLOSED with
migration 0132 plus assertion sections 37a/37b and the live suites; both
registers reference them, and neither was reopened. **KLRISK-DEVICE-003**,
**KLRISK-DEVICE-007**, **KLRISK-REPO-001** and **KLRISK-REPO-002** remain OPEN;
credential revocation was NOT implemented and containment is still not equated
with it.

## Known limitations

No crash reconciliation, no retry workers, no overlap expiry, no key
destruction, no revocation, no independent review. There is no durable
cross-process challenge-nonce ledger: cross-attempt replay is refused by
binding, and same-attempt replay is idempotent through the unique
proof-of-possession row per request id.

## Current implementation status (evidence register delta)

**Optional rotate_key orchestration and provider activation —
IMPLEMENTED-IN-DEV component.**

Nothing else advances. WS-11-T003 Step 4 is NOT complete and WS-11 overall stays
SCAFFOLDED / IN PROGRESS.

## Recommended next task

Prompt 3A — crash reconciliation and interrupted-rotation recovery.
