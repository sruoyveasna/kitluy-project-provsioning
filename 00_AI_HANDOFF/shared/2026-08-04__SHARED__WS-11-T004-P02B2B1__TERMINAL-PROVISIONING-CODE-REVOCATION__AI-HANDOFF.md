# WS-11-T004-P02B2B1 — governed terminal provisioning-code revocation

| Field     | Value                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Package   | WS-11-T004-P02B2B1 — governed explicit revocation of an outstanding terminal provisioning code                           |
| Date      | 2026-08-04 · Asia/Phnom_Penh                                                                                             |
| Start SHA | `8fb0bf4`                                                                                                                |
| Toolchain | Node v24.15.0, pnpm 9.15.9 (see ENVIRONMENT CONDITION below)                                                             |
| Migration | **0165** `20260804120000_0165_governed_terminal_provisioning_code_revocation.sql` (additive; 0164 and earlier unchanged) |
| Status    | **IMPLEMENTED-IN-DEV**                                                                                                   |
| Push      | not pushed; URL `disabled://push-requires-owner-approval`                                                                |

## Package identity and boundary

Delivered: the governed public revocation door
`kitluy_devices.revoke_terminal_provisioning_code_v1(p_provisioning_code_id,
p_idempotency_key, p_reason)` plus the minimum internal helpers (two
permission bridges) and the revocation idempotency column. Explicit
revocation only. Not delivered (later packages): background expiration,
sweeps or workers (**P02B2B2**), replacement-code issuance, redemption and
PoP (**P02B3**), HTTP routes, production grants (**P02C**), Store Hub
behavior.

## Permission decision

- Added `fleet.device_provisioning_code.revoke` (version 1, CRITICAL,
  resource types `device`/`device_provisioning_code`, environments `all`,
  ACTIVE) through the same additive reference-data insert 0163 used for
  `.issue`. No existing revocation permission fit; the conceptual name in
  the package matched the registry convention exactly.
- NOT granted to any default role. Tests use the sanctioned
  `kitluy_auth.temporary_grants` pattern and remove every grant.
- Sensitive-action policy determination: the P01 capability audit declared
  this door "revoke (operator)". The re-authentication and four-eyes
  requirements of KLD-2026-07-29/30 govern device-CREDENTIAL revocation, not
  a 15-minute terminal provisioning code; no canonical authority requires
  re-authentication, confirmation or approval here, so none is invented.
  **Reason is required** (enforced).

## Function contract

Signature (asserted on apply and in section 52):

```text
revoke_terminal_provisioning_code_v1(
  p_provisioning_code_id uuid,
  p_idempotency_key text,
  p_reason text
) returns jsonb
```

The caller cannot supply actor, Tenant, Digital Store, Location, Hub,
profile, environment, assignment state, code state or a timestamp — there is
no such parameter, and the catalog assertion pins it. Actor is resolved from
the session through 0163's `provisioning_code_actor_v1` bridge (reused
unchanged). Owner `kitluy_activation_governor` (NOLOGIN), SECURITY DEFINER,
pinned `search_path`. Granted to `authenticated` only (the 0163 boundary);
public/anon/service_role/worker hold nothing. The two new bridges
(`provisioning_code_revoke_held_v1`, `provisioning_code_revoke_permitted_v1`)
are owned by `kitluy_credential_approval_reader` and executable by the
governor alone.

## Scope derivation and leak posture

All scope is read from the code row and its assignment under lock. Two
permission gates: a COARSE gate (`has_permission(key, null, null, null)`)
BEFORE any row read — an actor holding the permission nowhere gets
`KLUY-PROVCODE-PERMISSION-DENIED` whether the code exists or not, so no
cross-scope existence leaks to unauthorized callers — then the SCOPED gate
against the DERIVED `terminal_device_id` and `environment`. Resource-scope
granularity (device/tenant/location-exact grants) is the group-0130 model
the repository has not yet built (same posture 0163 shipped); environment
gating is exact and wrong-environment refusal is executable-tested. Cross
Tenant/Store/Location reach is additionally bounded by the fact that the
actor cannot name scope at all; unrelated-scope inaccessibility is proven by
WS11-N8/N9.

## Reason contract

Mandatory; trimmed; blank refused; bounded at 500 characters (derived bound,
recorded here — no canonical bound exists); control characters refused; key
material (`private key`) refused; a standalone 8-character Crockford token
refused (the only safely detectable raw-code shape — the raw code is never
stored, so digest comparison is impossible by design). Stored in the 0162
`revocation_reason` column (never JSON metadata); immutable — no replay can
overwrite it. Full validated reason is also carried in the REVOKED event's
`detail.revocation_reason` with `reason_code = 'OPERATOR_REVOCATION'`.

## State-transition contract

Primary transition ISSUED → REVOKED: assignment locked FIRST, code row
locked SECOND (the 0164 evaluator's exact order — revoke-versus-presentation
serializes, no deadlock), scope re-read under the lock, assignment must be
`pending_trust`/`active`, `revoked_at` from `kitluy_ops.authoritative_now_v1()`
only, exactly one REVOKED event atomic with the transition. Terminal states
are never overwritten:

| State    | Answer                                                | Mutation |
| -------- | ----------------------------------------------------- | -------- |
| revoked  | `ALREADY_REVOKED` (original timestamp/correlation)    | none     |
| locked   | `REVOCATION_REFUSED` / `KLUY-PROVCODE-ALREADY-LOCKED` | none     |
| expired  | `KLUY-PROVCODE-ALREADY-EXPIRED`                       | none     |
| redeemed | `KLUY-PROVCODE-ALREADY-REDEEMED`                      | none     |

No delete, no event deletion, no attempt reset, no expiry extension, no
profile/Hub/assignment change, no replacement, no reactivation — all
executable-tested in section 52.

## Idempotency

0163's pattern: `revocation_idempotency_key` column, unique when present.
Immutable replay identity = (code id, trimmed reason, actor). Identical
replay → `ALREADY_REVOKED` with `replay: true`, the ORIGINAL `revoked_at`
and `correlation_id` (from the original REVOKED event), no mutation, no
second event. Any difference (code, reason or actor) →
`KLUY-PROVCODE-CONFLICTING-REPLAY`, fail closed, loser leaves zero residue.
The key check runs twice — before the locks and again under them (the 0163
same-key-race pattern). No raw code or secret in any idempotency record.

## Event behavior

Exactly one append-only REVOKED event per committed revocation, carrying
code id, derived Tenant/Store/Location/environment, actor type OPERATOR +
actor ref, authoritative `occurred_at`, correlation id, safe reason
reference; never raw code, candidate, digest, key or session material
(asserted). Replays and terminal refusals append nothing. Append-only
trigger proven to refuse even the borrowed table OWNER (section 52).

## Interaction with presentation and lockout

- Revoke-first: evaluator classifies `KLUY-PROVCODE-ALREADY-REVOKED`, no
  attempt, no event (section 52; races C/D).
- Presentation-first: MATCH_READY stays transient; revocation still commits;
  final state REVOKED; MATCH_READY never blocks revocation and is never a
  redemption (race D).
- Fifth-failure race: exactly one terminal state wins — REVOKED or LOCKED;
  attempts never exceed five; no `revoked_at` on a locked row, no
  `locked_at` on a revoked row; no duplicate terminal event (race C).
- The 0164 evaluator is unchanged (guard + N13 + section-52 census).

## Concurrency evidence

`provisioning-code-revocation.integration.test.ts` — 4/4 on genuinely
separate backends (recorded PIDs, barrier-synchronized starts, independent
assignment+code per race):

- **A** same code/key/reason → one REVOKED, one canonical ALREADY_REVOKED
  replay (same timestamp), one transition, one REVOKED event.
- **B** same code, different keys → one REVOKED, one stable ALREADY_REVOKED,
  one REVOKED event, no constraint exception.
- **C** primed to 4; revoke vs wrong presentation → exactly one terminal
  state (REVOKED xor LOCKED), attempts ≤ 5, consistent timestamps, event
  residue matches the winning serialization.
- **D** revoke vs correct presentation → final state REVOKED either way;
  MATCH_READY transient when first; no redemption; one REVOKED event;
  PRESENTED residue consistent with the winner.

## Privilege evidence

Door: authenticated-only. Bridges: governor-only. No direct table mutation
grant for any application identity (migration guard + N13 + section 52).
Tables remain RLS ENABLE+FORCE with policies for the governor only. No
login-capable member of `kitluy_activation_governor`,
`kitluy_credential_approval_reader` or `kitluy_test_harness` (live census:
zero rows). Temporary grants deleted in fixtures and in afterAll. P02B1
issuance and P02B2A evaluator ownership/grants unchanged (guarded in 0165
itself). No production/service grant added — P02C owns that boundary.

## Commands and results (fresh, local DB `postgres`/`kitluy_hub_local`, effective role postgres unless noted)

| Command                                | Exit | Result                                                            |
| -------------------------------------- | ---- | ----------------------------------------------------------------- |
| `pnpm migrations:validate`             | 0    | 64 files                                                          |
| `pnpm db:reset` (0000→0165)            | 0    | 64 files; 0165 guard NOTICE                                       |
| `pnpm db:seed` ×2                      | 0    | idempotent                                                        |
| `pnpm db:test`                         | 0    | **209 PASS** (96 assertions + 113 RLS), 0 FAIL, 0 SKIP            |
| `pnpm test:rls`                        | 0    | **113 PASS** (incl. WS11-N13a/b)                                  |
| revocation race suite (vitest file)    | 0    | **4/4** separate backends, recorded PIDs                          |
| registry service full suite            | 0    | **229/229** (19 files; lifecycle 30/30, census 14/14), zero skips |
| `pnpm db:validate`                     | 0    | 64 files                                                          |
| `pnpm secret:scan`                     | 0    | 1269 tracked files                                                |
| `pnpm clock:check`                     | 0    | PASS, 4/4 consumers                                               |
| membership census (live query)         | 0    | zero members of governor/approval-reader/harness                  |
| `pnpm hub:db:reset`+seed+`hub:db:test` | 0    | 31 migrations, **35 PASS**                                        |

Baselines did not regress: db:test 206 → **209**, test:rls 111 → **113**,
registry 225/225 → **229/229**, lifecycle 30/30, census 14/14, Hub 35/35.
Required package tests: zero skips.

## Baseline comparison and defects fixed in-package

Recorded honestly: (1) fixture claim-token collision between the section-52
hub and the terminal loop (`to_hex` range overlap) — retokenized; (2)
immutable-binding assertion assumed the fixture's own Hub, but 0163 binds
the earliest-activated Hub at the scope — assertion now captures the bound
Hub from the ISSUED result; (3) `postgres` is NOT a superuser in the local
Supabase stack, so the redeemed/scope-tamper/event fixtures and the race
suite's evaluator calls needed the sanctioned borrow pattern
(`kitluy_activation_governor` / `kitluy_test_harness`, granted and returned
in-block/afterAll, census-clean); (4) `authoritative_now_v1()` is
`clock_timestamp()`, so the timestamp assertion compares against wall time,
not transaction `now()`.

## ENVIRONMENT CONDITION (recorded, not hidden)

The repository pins Node `>=22.12.0 <23` (`.nvmrc` 22.23.0,
`engine-strict=true`). This session's environment provides only Node
v24.15.0; every `pnpm` script was run with `npm_config_engine_strict=false`.
Docker and the Supabase CLI were absent from the session PATH and were added
explicitly (`/c/Program Files/Docker/Docker/resources/bin`,
`/c/Users/Hello-Evo-PC/AppData/Roaming/npm`). All reported results are real
executions under that condition.

## Files changed

- `supabase/migrations/20260804120000_0165_governed_terminal_provisioning_code_revocation.sql` (new)
- `supabase/tests/assertions.sql` (+ section 52)
- `supabase/tests/rls-tests.sql` (+ WS11-N13)
- `services/kitluy-device-registry-service/test/provisioning-code-revocation.integration.test.ts` (new)
- `00_AI_HANDOFF/000_INDEX.md` (this record)

No earlier migration, Hub migration, runtime route, expiration worker,
redemption or PoP code was touched.

## Risks and unresolved values

- Resource-scope granularity for grants (device/tenant/location-exact) is
  the unfinished group-0130 model; environment gating is exact and tested.
  Recorded here as the inherited 0163 posture, not a new gap.
- The 500-character reason bound is a derived package decision (no canonical
  bound); tightening later is a compatible change.
- Revocation of a code whose assignment later closes is stable by design;
  the one-outstanding index means a NEW code can be issued for the same
  assignment after revocation — intended (re-issuance stays P02B1's door).

## Rollback

`git revert` this package's commits; migration 0165 has only ever been
applied to the local dev database (a `db:reset` rebuilds without it).

## P02B2B1 status: IMPLEMENTED-IN-DEV

Not marked: P02B2B overall, expiration processing, P02B3, P02C, WS-11-T004,
pilot or production readiness.

## P02B2B2 prerequisites

Satisfied: revocation door live and race-safe (0165), evaluator (0164),
issuance (0163), schema (0162), full event vocabulary, harness patterns,
next free migration **0166**. Recommended next package:
**WS-11-T004-P02B2B2 — authoritative terminal-code expiration transition
and replacement eligibility.**
