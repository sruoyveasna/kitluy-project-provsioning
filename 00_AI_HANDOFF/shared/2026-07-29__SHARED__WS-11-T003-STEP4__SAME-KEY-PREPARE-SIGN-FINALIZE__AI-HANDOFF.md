# Same-key prepare, sign and finalize — AI Handoff

| Field           | Value                                                            |
| --------------- | ---------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Prompt 2B-2 (same-key prepare/sign/finalize) |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                     |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                      |
| Starting SHA    | `8bb6b42`                                                        |

## Scope

**In:** consume the frozen renewal reservation; prepare the next credential
through PostgreSQL; sign the database-provided canonical TBS; record the
detached signature; finalize; advance the head; complete the renewal; verify the
new credential cryptographically.

**Out, and absent rather than stubbed:** replacement-key rotation, provider-key
activation, crash reconciliation, old-credential overlap expiry, credential
revocation workflow, independent hostile review.

## What was built

`packages/device-identity/src/same-key-renewal-issuance.ts` —
`completeSameKeyCredentialRenewal`. The middle four stages are
`runGovernedIssuance` from `issuance-adapter.ts`, **unchanged**: renewal does not
get a second issuance route. What is new is the RENEWAL BINDING, checked in a
gateway decorator between the database's preparation and the CA being asked to
sign — so a moved head, a moved assignment generation, a changed fingerprint or
an unexpected generation refuses with **nothing signed**.

- **The caller supplies nothing that decides identity.** Credential id, serial,
  generation, window, canonical TBS and digest all come from the database, and
  so does the idempotency key — it is DERIVED from the frozen renewal attempt id,
  because the database derives the credential id and serial FROM that key. A
  caller able to choose it would be choosing the serial.
- **Post-finalization verification.** The credential is read back OUT of
  PostgreSQL and put through the real verifier. A one-byte mutation of the
  persisted signature is refused although the row still says `issued`.
- **The result states four facts separately:** `credentialGenerationAdvanced`,
  `keyGenerationUnchanged`, `keyRotated: false`, unchanged fingerprint.

### A deliberate reading of §6, recorded rather than silently resolved

§6 says "use the same private key to sign the new credential TBS". Literally
that has the DEVICE key sign its own credential — which `verifyCertificateChain`
refuses (the device link must be signed by the intermediate) and which §9 then
requires to verify. Both cannot hold. Implemented as: the **CA intermediate**
signs the credential TBS so the chain verifies; the **device key** signs a
domain-separated, renewal-bound proof of possession
(`kitluy.same-key-renewal-pop.v1`), which is what makes the renewal _same-key_
rather than an assertion that the key is unchanged. Verified with the real
verifier before the database is told anything.

## Two database defects, found by execution

Both surfaced on the FIRST genuine renewal finalization, both under
`kitluy_issuance_service`, neither a fixture or seed problem.

**KLRISK-DEVICE-005 — the overlap window compared two different clocks.**
Finalization derives `overlap_ends_at` from the new credential's `not_before`
(DEVICE trusted time); group 0125's trigger bounded it by `updated_at` (SERVER
`now()`). §12 separates those clocks on purpose, so any positive skew refused the
renewal — **69 milliseconds was enough**. Isolated exactly: the identical fixture
finalizes with trusted time 5 minutes behind the transaction clock and is refused
with it 1 second ahead. Missed for four migration groups because no renewal had
ever been finalized: generation 1 INSERTs the head with a null overlap and never
reaches the comparison.

**KLRISK-DEVICE-006 — a `reuse_current_key` reservation could never complete.**
`completed` is written in exactly one place, and that function requires a
provider key bound to the renewal attempt, which only rotation ever creates. A
same-key reservation stayed `issuance_pending` for ever — and because group
0130's partial unique index treats non-terminal as OPEN, the completed renewal
kept blocking the next one.

Migration `0132` fixes both, additively: it anchors the three-day maximum on the
new credential's own `not_before` (keeping the previous-expiry cap and failing
closed when the credential row is absent), and completes a same-key reservation
atomically with the credential insert — binding generation, assignment
generation and the INCUMBENT FINGERPRINT first, so a renewal finalized against a
different key is refused rather than completed. Rotation is untouched and still
waits for provider activation.

Assertion section 37a proves both BEHAVIOURALLY in SQL, independent of the
TypeScript suite, by preparing a renewal with the device clock deliberately
ahead.

## Commands executed (with actual results)

Canonical order: `db:reset` → `db:seed` → `db:test` → `test:rls` → vitest.

| Command                               | Exit | Result                                                 |
| ------------------------------------- | ---- | ------------------------------------------------------ |
| `pnpm db:reset`                       | 0    | 0000→0132 from zero; 0132's hostile assertions passed  |
| `pnpm db:seed`                        | 0    | seeded                                                 |
| `pnpm db:test`                        | 0    | **178 PASS** (176 + two new section-37 cases)          |
| `pnpm test:rls`                       | 0    | **104 PASS** (unchanged)                               |
| device-identity `vitest run`          | 0    | **362 passed / 0 skipped**, 17 files                   |
| live renewal-issuance suite           | 0    | **11 EXECUTED**, 0 skipped                             |
| live renewal-preflight suite          | 0    | **15 EXECUTED**, 0 skipped                             |
| `pnpm typecheck`                      | 0    | 89/89                                                  |
| `pnpm lint`                           | 0    | 0 errors, 2 pre-existing warnings                      |
| `pnpm clock:check --require-complete` | 0    | COMPLETE 4/4                                           |
| `pnpm secret:scan`                    | 0    | clean                                                  |
| `docs:verify` (8 steps)               | 0    | **8/8 PASS**                                           |
| `verify` (12 steps)                   | —    | **11/12**; `format:check` fails on a pre-existing file |

**TOOLCHAIN DEVIATION.** Node 22.23.0 was re-checked at session start and is
still **not installed**; only **v24.15.0** is present. Aggregate `pnpm verify`
and `pnpm docs:verify` are therefore NOT authoritative — their nested `pnpm`
children re-read `engine-strict=true` — so every constituent step was run
individually with a temporary environment override. No `.npmrc`, `package.json`
engines or lockfile change was made.

**Pre-existing failure, not a regression.** `format:check` fails on
`R&D_HSA_AI_Agent_MVP.md`, which this session did not touch and which fails
identically at `8b9ecb7`.

## Ordering requirement discovered

The live device-identity suites REQUIRE `db:test` to have run first: the hardware
profile they use is created by `supabase/tests/assertions.sql`, and
`supabase/seed/` creates no hardware profiles at all. The fixture's error message
now says so, because "profile is missing" alone sends a reader hunting through
the seed for something that was never there.

## Security findings

Preserved and asserted: private keys stay inside the provider (no export surface
exists, asserted); no private-key serialization; no caller-supplied
cryptographic verdict anywhere; no direct credential, head, chain-link, audit or
issuance-attempt writes; NOLOGIN governors; no login-capable governor membership;
no `PUBLIC EXECUTE`; fixed `search_path`; RLS ENABLE+FORCE; non-X.509
classification; development-only Ed25519; `production_eligible = false`;
rotation disabled by default. `pgsodium` NOT installed. `KLRISK-DEVICE-003`
containment unchanged — the service is still the only cryptographic verifier and
still says so.

New: **KLRISK-DEVICE-005**, **KLRISK-DEVICE-006** (both closed by 0132 with
assertions in the migration and permanently in section 37), and
**KLRISK-DEVICE-007** — there is still no governed credential-revocation
operation. Containment and revocation are different controls; the substitution
is recorded, not claimed as equivalent, and direct credential status mutation
has NOT been tested as an authorized revocation path.

## Known limitations

No rotation, no provider activation, no crash reconciliation, no overlap expiry,
no revocation, no independent review of this unit. Orchestration-level retry
after a COMPLETED renewal refuses as `NOT_IN_RENEWAL_WINDOW` (correct: the head
now carries a fresh 30-day credential); idempotency lives on the frozen request
id, proven stage by stage.

## Current implementation status (evidence register delta)

**Same-key prepare/sign/finalize — IMPLEMENTED-IN-DEV component.**

Nothing else advances. WS-11 stays SCAFFOLDED / IN PROGRESS, WS-11-T003 Step 4 is
NOT complete, and no renewal-lifecycle claim is made.

## Recommended next task

Prompt 2C — optional `rotate_key` orchestration and provider activation.
