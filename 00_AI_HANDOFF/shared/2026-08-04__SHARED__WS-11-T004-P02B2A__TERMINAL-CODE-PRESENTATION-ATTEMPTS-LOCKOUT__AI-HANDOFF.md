# WS-11-T004-P02B2A — terminal code presentation, attempt counting and five-attempt lockout

| Field      | Value |
| ---------- | ----- |
| Package    | WS-11-T004-P02B2A — presentation evaluator + attempts + lockout |
| Date       | 2026-08-04 · Asia/Phnom_Penh |
| Start SHA  | `c3211a5` |
| Toolchain  | Node v22.23.0, pnpm 9.15.9 |
| Migration  | **0164** `20260804100000_0164_terminal_code_presentation_attempts_lockout.sql` (additive; 0163 and earlier unchanged) |
| Status     | **IMPLEMENTED-IN-DEV** |
| Push       | not pushed; URL `disabled://push-requires-owner-approval` |

## Package identity and boundary

Delivered: the **internal** presentation evaluator
`kitluy_devices.evaluate_terminal_provisioning_code_v1(p_terminal_assignment_id,
p_presented_code, p_correlation_id, p_actor_type default 'TERMINAL',
p_actor_ref default null)` plus its constant-time text-compare helper
(`constant_time_text_eq_v1`, byte-XOR loop). Not delivered (later packages):
redemption and proof-of-possession (**P02B3** composes this evaluator and
re-locks/rechecks everything before any redemption), governed revocation and
expiration processing (**P02B2B**), HTTP routes, production grants (**P02C**),
Hub integration.

## The evaluator contract (derived-everything)

Inputs: assignment id, the presented code, a correlation id, actor
classification. The caller cannot supply scope, Hub, state, count or time.

1. Assignment locked `for update` — resolution and evaluation are one
   transaction; every race on one assignment serializes here. Missing →
   `KLUY-PROVCODE-ASSIGNMENT-MISSING`; not pending_trust/active →
   `KLUY-PROVCODE-ASSIGNMENT-INACTIVE`. No residue either way.
2. Outstanding code (`state = 'issued'`) locked `for update`. If none, the
   answer is a terminal classification of the most recent code —
   `KLUY-PROVCODE-ALREADY-LOCKED/REDEEMED/REVOKED/EXPIRED` (computed
   `ALREADY-` + state) — with **no new event and no attempt**, because a
   presentation against nothing outstanding is not a brute-force opportunity.
   No code ever issued → `NO_OUTSTANDING`.
3. **Authoritative expiry first**, on `kitluy_ops.authoritative_now_v1()` only:
   an expired code is a bookkeeping fact, not a failed attempt. Exactly one
   EXPIRED transition and one EXPIRED event; a racer that finds the transition
   done answers the same refusal with no second event; zero attempt counted.
4. **Normalization (DERIVED rule, recorded here, not owner-locked):** `upper()`
   only. Valid lowercase Crockford letters normalize to uppercase; NOTHING is
   trimmed, nothing ambiguous is aliased (no O→0, no I/L→1, no Unicode
   lookalike folding) — anything else is MALFORMED.
5. Syntax gate: exactly 8 chars of the Crockford alphabet. Then the digest:
   sha256(normalized) compared against the STORED digest in **constant time**.
   The presented value and its digest are **never persisted** — the
   eight-character space is searchable, and recording either would hand an
   attacker a dictionary.
6. MATCH → one PRESENTED event, `MATCH_READY` with the scope facts a recheck
   needs. **No consumption, no state change, no attempt increment, no raw
   code.** MATCH_READY is a recheck input for P02B3, never an authorization.
7. Failure → count +1 atomically (monotonic, schema-capped at five), one
   FAILED_ATTEMPT event whose `detail` carries only
   `{"failed_attempt_count": n}` (a count is not brute-forceable); on the
   fifth, the terminal lock: `state = locked`, `locked_at`, `locked_reason =
   'MAX_ATTEMPTS_EXCEEDED'`, exactly one LOCKED event, refusal
   `KLUY-PROVCODE-LOCKED`. A racer that loses the lock answers
   `KLUY-PROVCODE-ALREADY-LOCKED` with no residue.

Refusal vocabulary: `MATCH_READY`, `FAILED_PRESENTATION` (1–4, carries
`reason_category` MISMATCH|MALFORMED), `PRESENTATION_REFUSED`
(`KLUY-PROVCODE-LOCKED`, `KLUY-PROVCODE-ALREADY-*`, `KLUY-PROVCODE-EXPIRED`,
assignment/malformation gates), `NO_OUTSTANDING`.

## Idempotency and concurrency

Three races proven on separate recorded backends
(`provisioning-code-presentation.integration.test.ts` 3/3):

- **A** — five concurrent wrong presentations on one issued code → exactly
  count 5, terminally locked, 5 FAILED_ATTEMPT events, exactly 1 LOCKED event,
  0 PRESENTED.
- **B** — primed to 4, then two concurrent wrong presentations → one locks
  4→5 (`KLUY-PROVCODE-LOCKED`), the other gets the terminal
  `KLUY-PROVCODE-ALREADY-LOCKED` with no attempt and no event; totals exactly
  5 FAILED_ATTEMPT + 1 LOCKED.
- **C** — primed to 4, the CORRECT code races a wrong one → the assignment
  lock serializes them: either the match lands first (MATCH_READY + one
  PRESENTED event, then the wrong one locks) or the wrong one locks first
  (the match then gets ALREADY-LOCKED). Both orderings end count 5, state
  locked, 5 FAILED_ATTEMPT + 1 LOCKED, PRESENTED consistent with the winner.

## Security posture

- Owner `kitluy_activation_governor` (NOLOGIN); the helper is governor-owned,
  EXECUTE revoked from PUBLIC.
- **Evaluator is harness-only**: EXECUTE granted to `kitluy_test_harness`
  alone; revoked from public/anon/authenticated/service_role; worker and
  issuance services hold nothing (RLS N12a/b). P02B3 composes it; P02C owns
  any production grant.
- The 0163 door's boundary is unchanged (asserted in section 51 and N12a).
- Tables remain default-deny + FORCE RLS (0162); the evaluator reaches them
  only as its SECURITY DEFINER owner.
- Constant-time compare: byte-XOR over equal-length hex digests; length
  equality is structural (sha256 hex), so the length check leaks nothing.
- Failed-code digests and presented values are persisted NOWHERE (asserted:
  no new columns; events carry count only).
- Membership census: zero login-capable members of either governor.

## Verification (fresh, from zero, effective role postgres unless noted)

| Command | Exit | Result |
| ------- | ---- | ------ |
| `pnpm db:reset` (0000→0164) | 0 | 63 files; 0164 guard NOTICE |
| `pnpm db:seed` | 0 | — |
| `pnpm db:test` | 0 | **206 PASS** (95 assertions incl. section 51 + 111 RLS incl. N12a/b) |
| `pnpm test:rls` | 0 | **111 PASS** |
| presentation race suite | 0 | **3/3** (separate backends, recorded PIDs) |
| `pnpm migrations:validate` / `db:validate` | 0 | 63 files |
| `pnpm secret:scan` / `clock:check` | 0 | 1266 files / — |
| membership census | 0 | zero login-capable members of both NOLOGIN authorities |
| `pnpm hub:db:reset`+seed+`hub:db:test` | 0 | 35 PASS (membership restored per cmdTest) |
| registry service full suite | 0 | **225/225** (18 files; lifecycle 30/30, census 14/14) |

Baselines did not regress: db:test 203 → 206, rls 109 → 111, registry
222 → 225. Zero skips.

Defects found and fixed during this package (recorded honestly): section 51's
second-expired-presentation check expected the transitional refusal
`KLUY-PROVCODE-EXPIRED` where the evaluator correctly answers the terminal
classification `KLUY-PROVCODE-ALREADY-EXPIRED` (state already expired = no new
event, no attempt) — assertion aligned to the designed refusal vocabulary;
fresh replay then passed end to end.

## P02B2B prerequisites

Satisfied: evaluator live and race-safe (0164), issuance door (0163), schema
foundation (0162), event vocabulary (CREATED/PRESENTED/FAILED_ATTEMPT/EXPIRED/
LOCKED), test harness patterns, next free migration **0165**. Recommended next
package: **WS-11-T004-P02B2B — governed code revocation and expiration
processing**. P02B3 (redemption + PoP) follows; P02C owns production grants.

## Rollback

`git revert` this package's commits; the migration has only ever been applied
to the local dev database (a `db:reset` rebuilds without 0164).
