# WS-11-T003 Step 4 — emergency success, the three concurrency scenarios, and the clock

| Field      | Value |
| ---------- | ----- |
| Task ID    | WS-11-T003 Step 4 — §2–§6, §8 (partial), §10 |
| Date       | 2026-07-31 · Asia/Phnom_Penh |
| Start SHA  | `286d11e` (53 ahead, clean) |
| End SHA    | `87c3ed6` + this note |
| Toolchain  | Node **v22.23.0**, pnpm **9.15.9** (project-external; pin unchanged) |
| Migrations | cloud **0158** added (0157 unchanged); Hub 0027 unchanged |
| Status     | **PARTIAL — Step 4 NOT promoted.** §2–§6 and §8 done; §7 lifecycle and §9 review NOT done |

## §2 — the governed emergency actually succeeding

Every emergency suite in this repository proved a REFUSAL. None had driven the
governed door to `REVOKED_IMMEDIATELY`, so the success path was the one thing the
emergency design had never been tested on — and all three outstanding concurrency
scenarios needed it first.

The authority chain, each link real:

| Link | Why it is needed |
| ---- | ---------------- |
| `auth.users` | evidence has an FK to it |
| `admin_user_profiles` ACTIVE | the recorder refuses `KLUY-REAUTH-PROFILE-NOT-ACTIVE` |
| `temporary_grants` | environment-EXACT, time-boxed; never widens across environments |
| `request.jwt.claims` **and** `claim.sub` | `auth.uid()` prefers the legacy singular GUC |
| `set local role authenticated` | the human's own session |
| `record_reauthentication_evidence_v1` | real single-use evidence, recorded BY the human |
| `revoke_..._emergency_governed_v1` | the public door, via the PRODUCTION composition |

No `postgres` credential mutation, no `service_role` impersonation, no fabricated
digest, no legacy helper.

Proved: credential dead; a bystander device untouched; evidence ACTIVE → CONSUMED
exactly once with a window the database sets to exactly **300 seconds**; one
immutable authorization naming the human with a 64-hex database-derived digest;
relational scope containing exactly one credential; obligation PENDING. Also: spent
evidence cannot be reused, and a human granted in `production` is refused against a
`development` credential.

**Four-mode stability (§2 gate):** alone ✓ · after clean reset+seed ✓ · in the full
service suite ✓ · under parallel `pnpm verify` ✓.

## §3 — the clock reaches the real governed path

Group 0157's clock was **decorative**: `consume_reauthentication_evidence_v1`
compared `clock_timestamp()`. Migration **0158** replaces that one comparison and
the audit stamp with `kitluy_ops.authoritative_now_v1()`, captured **once** before
the row lock so a transaction that waited a long time is not judged against one
instant and recorded against another.

Production behaviour is unchanged: that function IS `clock_timestamp()` with no
policy row, and no migration creates one. The migration asserts the signature grew
no clock parameter and that authoritative time equals real time.

## §4/§5/§6 — the three concurrency scenarios, all passing

Separate `pg.Client` backends, recorded PIDs, real lock barriers, each parked
session confirmed WAITING via `pg_stat_activity`.

| | Evidence |
| --- | --- |
| **A — 300s expiry while parked** | blocker 3689 / runner 3690; verified 03:41:08.718Z, expires 03:46:08.718Z, authoritative time advanced to 03:46:09.718Z; barrier `Lock`; **SQLSTATE 42501** `KLUY-EMERGENCY-REAUTHENTICATION-REFUSED`. Credential NOT revoked; evidence still ACTIVE, unconsumed, ORIGINAL expiry; zero authorization residue. No evidence was revoked or superseded to fake expiry — time actually moved. |
| **B — scope mutated while parked** | mutator 3691 / runner 3692; barrier `Lock`. Another session revoked the target and committed. On release the door **re-derived the set under the final lock**, found it empty, and refused `KLUY-CRED-REVOCATION-SCOPE-EMPTY` — "an empty set is an unrestricted one". Zero added revocation rows; ≤1 authorization; no partial effect. |
| **C — identical vs conflicting replay** | three distinct backends. Original `REVOKED_IMMEDIATELY`; identical retry `ALREADY_AUTHORIZED` returning the **same** authorization_id; conflicting retry `EMERGENCY_REFUSED` / `KLUY-EMERGENCY-CONFLICTING-REPLAY`. Exactly **one** authorization and **one** scope for the key; conflicting target never revoked; both losers' evidence still unconsumed. |

## §8 — residue and privilege census (after full parallel verification)

| Check | Result |
| ----- | ------ |
| spendable emergency authorizations past due | **0** |
| effective temporary grants | **0** |
| login-capable members of `kitluy_credential_issuer` | **0** |
| login-capable members of `kitluy_activation_governor` | **0** |
| login-capable members of `kitluy_test_clock_authority` | **0** |
| `test_clock_policy` rows | **0** |

**One honest exception:** 7 ACTIVE re-authentication evidence rows remained, all
belonging to SEEDED actors (`…0007`, `…0010`) used by the pre-existing
`@kitluy/device-identity` governed-emergency suite — **not** by any fixture added
here. Every fixture actor's active evidence is retired. They are bounded by the
governed 300-second window and expire on their own; recorded rather than cleaned
up, because that suite owns them.

## Canonical verification (Node 22.23.0, fresh and serial)

| Step | Exit | Result |
| ---- | ---- | ------ |
| `db:reset` (0000→0158 from zero) | 0 | 0157 and 0158 assertions fired |
| `db:seed` | 0 | — |
| `db:test` | 0 | **196 PASS, 0 FAIL** |
| `test:rls` | 0 | **104 PASS** |
| `@kitluy/device-identity` | 0 | **780 passed (33 files)** |
| device-registry-service | 0 | **141 passed, 0 skipped (12 files)** |
| `pnpm verify` (parallel) | 1 | **12 of 13 PASS** — only `Format check` |
| `migrations:validate` / `db:validate` / `secret:scan` / `lint` / `typecheck` | 0 | `db:validate` all checks pass, 56 files |

Pre-existing conditions, unchanged and not hidden: `format:check` CRLF artifact;
`docs:verify` `check-classified` on imported documents; the Hub agent suite's 8
baseline failures.

## Two defects of mine the verification caught

1. **Parallel-unsafe barrier.** Two suites racing on the same `grant` hit
   `pg_auth_members_role_member_index`. Borrows are now membership-checked and
   tolerate `unique_violation`; the clock-policy row is deleted by `enabled_by` tag
   so one suite cannot disable the clock underneath another.
2. **Teardown that lied.** `disposeEmergencyActor` ended with an unconditional
   `delete from auth.users` inside a swallowed catch. Consumed evidence has an FK
   to it, so for any actor who really revoked something the delete failed silently.
   It now deletes only when nothing references the row, and says why.

## NOT done

- **§7 production lifecycle** — the 30-stage end-to-end run.
- **§9 fresh independent review** — two reviewers, not yet launched.

## FINAL STATUS

```text
WS-11-T003 Step 4 — NOT PROMOTED
```

Per §11 the lifecycle must pass and fresh reviewers must report no blockers.

## Recommended next

1. §7 lifecycle, reusing `emergency-success-fixture.ts` and the Hub offline suite.
2. §9 two fresh reviewers over the whole changeset.
3. Consider retiring the seeded-actor evidence in the device-identity suite's own
   teardown so the census reaches a clean zero.
