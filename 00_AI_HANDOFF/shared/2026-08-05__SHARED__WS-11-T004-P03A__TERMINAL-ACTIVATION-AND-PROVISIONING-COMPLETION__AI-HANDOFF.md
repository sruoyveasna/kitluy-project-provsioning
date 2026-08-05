# WS-11-T004-P03A — TERMINAL ACTIVATION AND PROVISIONING COMPLETION — AI HANDOFF

| Field          | Value                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| Date           | 2026-08-05                                                                                                   |
| Package        | WS-11-T004-P03A (terminal activation and provisioning-completion state)                                      |
| Status         | **IMPLEMENTED-IN-DEV — ACTIVATION IS COMPLETION, NOT DELIVERY**                                              |
| Start SHA      | `960b36feed12837fb3d785439c2aff755d52609e` (fix(ws-11): enforce provisioning composer role entry)            |
| End SHA        | recorded by `git log -1` after the package commit                                                            |
| Branch / ahead | `main`; push `disabled://push-requires-owner-approval` — **nothing pushed**                                  |
| Toolchain      | **Node v22.23.0**, pnpm 9.15.9 (corepack), engine-strict=true                                                |
| Migration      | `supabase/migrations/20260806020000_0174_terminal_activation_completion.sql` (additive; 0000–0173 untouched) |

## 1. The distinction this package establishes

Before P03A, `redeem_terminal_provisioning_code_v1` was the last governed
event: a certificate existed and was bound, and nothing recorded whether the
terminal ever received it. P03A makes activation a SEPARATE, LATER fact
(pairing protocol §7): a terminal becomes `activated` only when it signs an
acknowledgment **under its enrolled key** binding the **exact credential**
(certificate id + serial + public-key fingerprint) that redemption produced.
A successful cloud transaction activates nothing.

Equally deliberate is what activation does **not** say. There is **no
`delivered` state** — the state machine is `ready_for_delivery → activated` —
because no delivery evidence exists yet: Store Hub credential delivery (#28),
the terminal transport identity (#22) and the §8 pairing handshake (P03B/C)
are all still unbuilt. The composition layer never emits the words
"delivered" or "paired", and the activation suite asserts their absence in
the success payload.

## 2. What was built

**Migration 0174** (all objects owned by NOLOGIN `kitluy_activation_governor`,
FORCE RLS with governor-only policies, refusal-contract jsonb doors):

- `device_terminal_provisioning_activations` — exactly one row per redeemed
  code (unique on `provisioning_code_id` AND on `pop_challenge_id`),
  immutable bindings to tenant/store/location/environment/hub/terminal/
  assignment/profile/code/PoP-challenge/enrollment/fingerprint/certificate;
  trigger `trg_dtpa_integrity` forbids rewriting any binding or leaving
  `activated`.
- `device_terminal_activation_challenges` — the `kitluy.activation-ack.v1`
  domain: 32-byte nonce, expiry inherited from the certificate's
  `expires_at`, `issued → consumed`, partial unique index
  `uq_dtac_one_outstanding` (at most one outstanding challenge per
  activation); trigger `trg_dtac_integrity`.
- Three doors, EXECUTE to `kitluy_provisioning_service, kitluy_test_harness`
  only: `prepare_terminal_provisioning_activation_v1(uuid, text)` (idempotent
  on the redemption idempotency key; reuses the outstanding challenge),
  `read_terminal_activation_challenge_context_v1(uuid)` (the one narrow read;
  now also returns `acknowledged_at`/`activated_at` so a replay answers from
  the authoritative row), and
  `complete_terminal_provisioning_activation_v1(uuid, boolean, text, text)`
  (consumes the challenge and activates in ONE transaction; OPTION B — the
  service attests the Ed25519 verdict, the database records the attestation).
- Lock order preserved: DEVICE → ASSIGNMENT → CODE → ACTIVATION → CHALLENGE.
- The migration guard re-proves the 0173 boundary (service_role must NOT
  effectively hold the new capabilities), asserts the composer census grew by
  exactly THREE (to eight), and rejects any invented `'delivered'` state.

**`packages/device-identity/src/activation-ack.ts`** — the crypto authority:
`activationAckBytes` (fixed field order, domain-separated), `activationAckHash`,
`verifyActivationAck` (bindings first, signature last, trusted time only).
The payload binds certificate id/serial/fingerprint — the fact this proof
exists to establish, which the provisioning PoP could not mention because the
certificate did not exist when that proof was signed.

**`TerminalActivationComposition`** (provisioning-composition.ts) —
`prepareActivation` and `verifyAcknowledgmentAndActivate`, same discipline as
the provisioning composition: one transaction per operation under explicit
`SET LOCAL ROLE kitluy_provisioning_service`, canonical bytes reconstructed
from AUTHORITATIVE rows, closed result vocabulary, safe-field logging. An
ALREADY_ACTIVATED replay is a pure lookup returning the original timestamps.

## 3. Evidence (all executed, zero skips)

`services/kitluy-device-registry-service/test/terminal-activation.integration.test.ts` (9):

| Case     | Proven                                                                                                                                                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| success  | redemption leaves NO activation; prepare → `ready_for_delivery`; signed ack → `activated` once; replays are stable lookups; no delivery/pairing words in the payload                                                                                     |
| replay   | preparation replay reuses the one outstanding challenge; one activation lineage per redemption                                                                                                                                                           |
| refusals | unredeemed assignment → REDEMPTION_REQUIRED; forged ack (another terminal's genuine key) and superseded enrollment → ACTIVATION_ACK_INVALID with zero residue (challenge stays `issued`); malformed signature → REQUEST_INVALID                          |
| race A   | two identical completions — one creator, one consumed challenge, one timestamp                                                                                                                                                                           |
| race B   | two concurrent preparations — one lineage, one outstanding challenge (partial unique index is the authority)                                                                                                                                             |
| race C   | Hub withdrawn before ack → HUB_INACTIVE, fails closed, challenge unconsumed                                                                                                                                                                              |
| race D   | certificate revoked before ack → CREDENTIAL_INELIGIBLE, fails closed                                                                                                                                                                                     |
| rollback | a KL940 fault AFTER the challenge is consumed in-flight aborts everything (challenge back to `issued`, no idempotency residue); the undamaged state then activates cleanly                                                                               |
| security | anon/authenticated/service_role denied 42501 on doors and tables; `has_function_privilege('service_role', …)` = **false** for all three new doors (0173 boundary covers 0174); composer has zero table reach; logs stay `correlationId,operation,result` |

`packages/device-identity/test/activation-ack.test.ts` (27): correct-binding
pass; 14 transplant replays each refused with its specific code (including
credential id/serial/fingerprint — the binding unique to this domain);
purpose/environment/expiry-boundary/future-dated/no-trusted-time/superseded-
enrollment/wrong-key/forged/malformed/altered-payload refusals; domain
separation from `kitluy.provisioning-pop.v1` proven byte-level; no raw
Crockford code in the canonical payload.

`supabase/tests/rls-tests.sql`: WS11-N19 updated to the EIGHT-capability
census (both direct-ACL and effective-privilege postures, per P02C1);
**WS11-N20 added** — governor-only FORCE RLS on both tables, policy census,
both integrity triggers, the partial unique index, no `'delivered'` state,
governor-owned completion door, and runtime probes that `authenticated` can
neither read activation state nor call a door.

## 4. Verification (Node v22.23.0; fresh reset; cloud and Hub serialized)

| Command                                    | Exit | Result                                                                          |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| `pnpm migrations:validate` / `db:validate` | 0/0  | **73** migration files                                                          |
| `pnpm db:reset` (0000→**0174**) + seed ×2  | 0    | 73 applied; KLUY-MIGRATION-0174 guard NOTICE; seeds idempotent                  |
| `pnpm db:test`                             | 0    | **229 PASS, 0 FAIL** (baseline 227 + WS11-N20a/b)                               |
| `pnpm test:rls`                            | 0    | **131 PASS, 0 FAIL** (baseline 129 + 2)                                         |
| `pnpm hub:db:reset` + seed + test          | 0    | Hub suite green (36 PASS lines)                                                 |
| registry full suite (serial)               | 0    | **334/334, 30 files, zero skips** (baseline 325 + 9)                            |
| device-identity full suite (serial)        | 0    | **830/830, 35 files** (baseline 803 + 27)                                       |
| `pnpm secret:scan` / `clock:check`         | 0/0  | 1307 files clean / PASS                                                         |
| `pnpm typecheck` / `pnpm lint` (root)      | 0/0  | clean                                                                           |
| targeted `prettier --check` on P03A files  | 0    | clean (no P03A file among the pre-existing warnings)                            |
| `pnpm verify`                              | 1    | **11 of 12** — only the recorded pre-existing ~832-file `format:check` artifact |

No baseline regressed: db:test 227→229 (additions only), rls 129→131,
registry 325→334, device-identity 803→830, Hub unchanged.

## 5. Recorded finding — OUT OF SCOPE (unchanged from P02C1)

The `kitluy_issuance_service` and `kitluy_worker_service` machine identities
still rely on direct-ACL denial only; whether they need the same NOINHERIT
gateway treatment as the provisioning composer (0173) **remains an owner
decision**. Recorded here per the package instruction — NOT expanded in P03A.
WS11-N19 continues to assert both roles hold no effective privilege on any of
the eight provisioning/activation capabilities, so the specific surface of
this package is covered; the general posture of those two identities is not.

## 6. What P03A deliberately did NOT claim

- **No Store Hub delivery** (#28): nothing records that a credential reached
  a Hub. The state name `ready_for_delivery` describes cloud readiness only.
- **No terminal transport identity** (#22): every "terminal-signed" input in
  the suites is produced by the test harness holding real Ed25519 keys; no
  route exists for a real terminal to submit an acknowledgment.
- **No pairing** (§8, P03B/C): activation says the terminal holds its
  credential — not that it can reach, or has ever spoken to, its Store Hub.

## 7. Rollback

Migration 0174 is additive. Rollback = drop the two triggers, two tables (in
FK order: challenges then activations), three doors, and the
`kitluy_activation_governor` role; revert the WS11-N19/N20 edits in
rls-tests.sql; delete `activation-ack.ts` + its export, the
`TerminalActivationComposition` class and the two test files. 0000–0173 are
untouched.

## 8. Next

**P03B — Hub-terminal pairing challenge, nonce replay protection, receipt**
(census rows 31–33), then P03C (pairing persistence, offline recovery, rows
34–35). The terminal transport identity (#22) remains the precondition for
exposing any door to a real terminal.
