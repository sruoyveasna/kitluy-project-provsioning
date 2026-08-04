# WS-11-T004-P02B2B2A — canonical terminal-code expiration transition

| Field     | Value                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package   | WS-11-T004-P02B2B2A — one canonical ISSUED→EXPIRED authority + evaluator delegation                                                               |
| Date      | 2026-08-04 · Asia/Phnom_Penh                                                                                                                      |
| Start SHA | `20bd0e0`                                                                                                                                         |
| Toolchain | **Node v22.23.0** (`C:\Users\Hello-Evo-PC\AppData\Local\kitluy-toolchain\node-v22.23.0-win-x64\node.exe`), pnpm 9.15.9, engine enforcement ACTIVE |
| Migration | **0166** `20260804140000_0166_canonical_terminal_code_expiration.sql` (additive; 0165 and earlier unchanged)                                      |
| Status    | **IMPLEMENTED-IN-DEV**                                                                                                                            |
| Push      | not pushed; URL `disabled://push-requires-owner-approval`                                                                                         |

## Toolchain correction (mandatory, from the package)

The prior package ran under unsupported Node v24.15.0 with
`engine-strict=false`. No standalone Node 22 and no version manager existed
on this machine, so option 3 was executed: the official
`node-v22.23.0-win-x64.zip` was downloaded from nodejs.org, its SHA-256 was
verified against the official `SHASUMS256.txt`
(`425a5bd6…31e8`, `sha256sum -c` OK), and it was extracted to a non-admin
location outside the repository (nothing committed). With that directory on
PATH, `node --version` = **v22.23.0**, `pnpm --version` = **9.15.9**, and
`engine-strict=true` is ACTIVE — every command in this handoff ran WITHOUT
any engine override. P02B2B1 was fully revalidated under Node 22 as part of
this fresh chain (its assertion section, RLS cases and race file all ran).

## Package identity and boundary

Delivered: the canonical internal expiration helper
`expire_terminal_provisioning_code_v1` — the ONLY implementation of the
ISSUED→EXPIRED transition in the repository — and the additive refactor of
the 0164 presentation evaluator to delegate to it. Not delivered (later
packages): replacement issuance (**P02B2B2B**), expiration sweeps/jobs/
worker runtime, redemption and PoP (**P02B3**), HTTP routes, production
grants (**P02C**), Store Hub behavior. `issue_terminal_provisioning_code_v1`
is untouched.

## Helper contract

```text
expire_terminal_provisioning_code_v1(
  p_provisioning_code_id uuid,
  p_correlation_id uuid,
  p_trigger_source text,          -- ^[A-Z0-9_]{1,64}$
  p_actor_type text default 'SYSTEM',
  p_actor_ref text default null
) returns jsonb
```

Owner `kitluy_activation_governor` (NOLOGIN), SECURITY DEFINER, pinned
`search_path`. INTERNAL: EXECUTE revoked from public/anon/authenticated/
service_role/worker/issuance; granted to `kitluy_test_harness` alone (the
0164 evaluator's pattern). The evaluator composes it as the same definer
owner — no grant needed. No caller time, no caller scope, no raw code.

Lock order: assignment first, code second — the shared order with the 0164
evaluator and the 0165 revocation door, so expiration serializes with both
instead of deadlocking; the evaluator's nested call under its own locks is
re-entrant and safe.

## Authoritative-time and state contract

- Clock: `kitluy_ops.authoritative_now_v1()` only. Due rule:
  `authoritative_now >= expires_at` expires; valid only while `<`. The exact
  equality boundary is executable-tested (transition at exactly `expires_at`,
  `expired_at` equals the override instant); one second before is NOT_DUE.
- Eligible: ISSUED + due → atomic transition + exactly one EXPIRED event;
  attempts, assignment, Hub, scope, profile, `locked_at`, `revoked_at`
  preserved by not being touched.
- Stable results: `NOT_DUE` (no mutation/event), `ALREADY_EXPIRED`,
  `ALREADY_REVOKED`, `ALREADY_LOCKED`, `ALREADY_REDEEMED` (no mutation, no
  timestamp change), `KLUY-PROVCODE-NOT-FOUND` for a missing code; contract
  violations refuse as jsonb (`NO-CODE`, `NO-CORRELATION`,
  `BAD-TRIGGER-SOURCE`, `BAD-ACTOR-TYPE`, `SCOPE-INCONSISTENT`).
- EXPIRED event: derived scope, trusted actor classification, correlation
  id, `reason_code = 'TTL_ELAPSED'`, `detail.trigger_source` — never raw
  code, candidate, digest or secret (asserted). Repeated calls append none.

## Evaluator integration

The 0164 evaluator's step 3 now delegates: for an outstanding code it calls
the helper FIRST (before normalization/digest/counting); `EXPIRED`/
`ALREADY_EXPIRED` map onto the established refusal vocabulary
`KLUY-PROVCODE-EXPIRED` (state `expired`), and the second presentation keeps
its `KLUY-PROVCODE-ALREADY-EXPIRED` classification from the unchanged
no-outstanding path. The evaluator retains NO due-time calculation, EXPIRED
mutation or EXPIRED event of its own; its lockout branch now stamps
`locked_at` itself from the authoritative clock (the only timestamp it still
owns). Signature, owner and grants unchanged — asserted in the migration
guard, N14 and section 53. Expiry on a due code can never count an attempt
(proven by race D).

## Concurrency evidence

`provisioning-code-expiration.integration.test.ts` — 4/4 on genuinely
separate backends (recorded PIDs, barrier-synchronized, independent
assignment+code per race, sanctioned test clock: committed policy row +
transaction-local override, both removed in afterAll):

- **A** two expirations → one EXPIRED, one ALREADY_EXPIRED, one EXPIRED event.
- **B** expiration vs revocation → exactly one terminal state (EXPIRED xor
  REVOKED); the loser answers the stable terminal classification
  (`KLUY-PROVCODE-ALREADY-EXPIRED` / `ALREADY_REVOKED`); exactly one winning
  terminal event; no `revoked_at` on an expired row; no state reversal.
- **C** expiration vs correct presentation on a due code → final EXPIRED
  either way; never MATCH_READY; no attempt; one EXPIRED event; zero
  PRESENTED/FAILED_ATTEMPT residue.
- **D** primed to 4, expiration vs wrong presentation → final EXPIRED
  always (evaluator checks expiry before counting); count stays 4; one
  EXPIRED event; zero LOCKED residue.

## Privilege evidence

Helper harness-only (guard + N14a/b + section-53 census + anon probe).
No direct table mutation grant introduced; tables RLS ENABLE+FORCE;
append-only event trigger asserted; no raw-code-capable column (identifier
and reason-reference exclusions as 0165); no login-capable member of any
NOLOGIN authority (live census: zero rows); test-clock policy residue zero.
0163 issuance, 0164 evaluator, 0165 revocation signature/owner/grants
unchanged (guard + N14 + section 53).

## Commands and results (all under Node v22.23.0, engine-strict ACTIVE)

| Command                                | Exit | Result                                                            |
| -------------------------------------- | ---- | ----------------------------------------------------------------- |
| `pnpm migrations:validate`             | 0    | 65 files                                                          |
| `pnpm db:reset` (0000→0166)            | 0    | 65 files; 0166 guard NOTICE                                       |
| `pnpm db:seed` ×2                      | 0    | idempotent                                                        |
| `pnpm db:test`                         | 0    | **212 PASS** (97 assertions + 115 RLS), 0 FAIL, 0 SKIP            |
| `pnpm test:rls`                        | 0    | **115 PASS** (incl. WS11-N14a/b)                                  |
| expiration race suite                  | 0    | **4/4** separate backends, recorded PIDs                          |
| registry service full suite            | 0    | **233/233** (20 files; lifecycle 30/30, census 14/14), zero skips |
| `pnpm db:validate`                     | 0    | 65 files                                                          |
| `pnpm secret:scan`                     | 0    | 1272 tracked files                                                |
| `pnpm clock:check`                     | 0    | PASS, 4/4 consumers                                               |
| membership + clock-policy census       | 0    | zero residue                                                      |
| `pnpm hub:db:reset`+seed+`hub:db:test` | 0    | 31 migrations, **35 PASS**                                        |

Baselines did not regress: db:test 209 → **212**, test:rls 113 → **115**,
registry 229/229 → **233/233**, lifecycle 30/30, census 14/14, Hub 35/35.
Required package tests: zero skips. **P02B2B1 revalidated under Node 22**
(its sections and races are inside this chain).

## Defects found and fixed in-package (recorded honestly)

1. Guard signature assertions compared `pg_get_function_arguments` exactly,
   but functions with DEFAULTs spell them (`DEFAULT 'SYSTEM'::text`…) —
   comparisons now strip ` DEFAULT …` before equality (helper, evaluator,
   section-53 pins).
2. The no-raw-code column guard matched `_code_` inside
   `provisioning_code_id` on the events table (false positive) — identifier
   and reason-reference exclusions added, matching the 0165 guard.
3. The refactored evaluator dropped the `v_now` assignment the LOCKOUT
   branch still needed (0164 assigned it in the expiry step) — the lockout
   branch now assigns it from the authoritative clock itself.

## Files changed

- `supabase/migrations/20260804140000_0166_canonical_terminal_code_expiration.sql` (new)
- `supabase/tests/assertions.sql` (+ section 53)
- `supabase/tests/rls-tests.sql` (+ WS11-N14)
- `services/kitluy-device-registry-service/test/provisioning-code-expiration.integration.test.ts` (new)
- `00_AI_HANDOFF/000_INDEX.md` (this record)

No earlier migration, Hub migration, runtime route, sweep, worker, issuance
change or production grant was touched.

## Remaining environment conditions

- Node 22.23.0 lives at the recorded non-admin path; if that path is wiped,
  the documented download+verify steps reproduce it.
- `docs:verify` classification gate fails identically on clean HEAD on this
  Windows checkout (pre-existing; unchanged by this package).
- Docker and the Supabase CLI are absent from the default session PATH and
  were added explicitly for DB commands.

## Risks and unresolved values

- The evaluator now calls the helper on EVERY presentation (NOT_DUE is the
  common path): one extra definer call per presentation, no extra locks
  beyond those already held. Accepted for single-authority expiration.
- EXPIRED events via the evaluator now name the presenter (TERMINAL + ref)
  instead of SYSTEM/null; the established refusal vocabulary is unchanged
  and no test relied on the old attribution. Recorded as a deliberate,
  package-sanctioned improvement ("trusted actor … where available").

## Rollback

`git revert` this package's commits; migration 0166 has only ever been
applied to the local dev database (a `db:reset` rebuilds without it).

## P02B2B2A status: IMPLEMENTED-IN-DEV

Not marked: replacement issuance, expiration workers, P02B2B2B/B2C, P02B3,
P02C, WS-11-T004, pilot or production readiness.

## P02B2B2B prerequisites

Satisfied: canonical expiration helper live and race-safe (0166), evaluator
delegation proven, revocation (0165), issuance (0163), schema (0162), next
free migration **0167**. Recommended next package:
**WS-11-T004-P02B2B2B — expired-code replacement issuance**, whose rule is
already recorded: unexpired issued → OUTSTANDING; overdue issued → expire
canonically, then assess replacement; expired historical row immutable; new
code = new row + new idempotency key.
