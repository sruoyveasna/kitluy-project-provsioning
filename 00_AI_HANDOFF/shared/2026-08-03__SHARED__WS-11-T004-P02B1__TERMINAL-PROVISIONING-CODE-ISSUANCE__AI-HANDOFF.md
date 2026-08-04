# WS-11-T004-P02B1 — governed terminal provisioning-code issuance

| Field      | Value |
| ---------- | ----- |
| Package    | WS-11-T004-P02B1 — governed issuance door |
| Date       | 2026-08-03 · Asia/Phnom_Penh |
| Start SHA  | `0bc0538` |
| Toolchain  | Node v22.23.0, pnpm 9.15.9 |
| Migration  | **0163** `20260803160000_0163_governed_terminal_provisioning_code_issuance.sql` (additive; 0162 and earlier unchanged) |
| Status     | **IMPLEMENTED-IN-DEV** |
| Push       | not pushed; URL `disabled://push-requires-owner-approval` |

## Package identity and boundary

Delivered: the governed database door
`kitluy_devices.issue_terminal_provisioning_code_v1(p_terminal_assignment_id,
p_idempotency_key, p_reason default null)` — issuance only. Not delivered (later
packages): presentation, attempts, lockout, revocation, redemption, PoP,
certificates, HTTP routes, production grants (P02C), Hub integration.

## Permission decision

`fleet.device_provisioning_code.issue` — neutral fleet.* convention, registered
ACTIVE in `kitluy_auth.permissions` (version 1, CRITICAL, resource_types
{device, device_provisioning_code}, environments {all}). Checked inside the
governed transaction via `kitluy_auth.has_permission`, gated on the DERIVED
environment. Tests grant it time-boxed through the existing temporary-grant
harness; no default role holds it.

## The door (derived-everything contract)

Inputs: terminal assignment id, idempotency key, optional reason. The caller
cannot supply actor, scope, Hub, profile, environment or time.

1. Actor resolved by the database from the session (bridge
   `provisioning_code_actor_v1`, owned by `kitluy_credential_approval_reader`,
   granted to the governor only — the 0150 bridge pattern, because the kitluy_auth
   helpers are not executable by the governor).
2. Idempotency first; then again under the assignment lock (a same-key race
   waits for the winner's commit and must be answered ALREADY_ISSUED).
3. Assignment locked `for update` — races serialize; states pending_trust/active
   only.
4. Active-Hub gate: the hub assignment-projection at the assignment's scope
   (written ONLY by successful activation — the BLK-005 posture is inherited).
   Zero projections → KLUY-PROVCODE-HUB-INACTIVE (ADMIN-QA-014's database half).
   Multiple → deterministic earliest-activated binding, documented: this data
   model links terminal↔Hub by Location; an explicit terminal-to-hub binding
   is recorded as later work.
5. Environment derived from the projection; permission gated on it.
6. One outstanding code per assignment → governed OUTSTANDING result.
7. Code: 8 chars, Crockford Base32 (no I/L/O/U), one secure-random byte per
   character; 256 = 8×32 exactly, so byte % 32 is perfectly uniform.
8. Time from `kitluy_ops.authoritative_now_v1()` only; expires = exactly +15 min.
9. Digest = sha256(raw code); payload = sha256 of the canonical scope binding
   (tenant/store/location/hub/terminal/assignment/profile/environment/expires).
10. One CREATED event, atomic with the row; no raw code anywhere.

Raw code: returned ONCE in the ISSUED response; never stored, never in events,
never reconstructable on replay (ALREADY_ISSUED carries no `code` field).

## Idempotency and concurrency

- Identical replay → ALREADY_ISSUED with the canonical id, no code, no second
  event.
- Different key + same assignment → OUTSTANDING.
- Same key + different assignment → CONFLICTING_REPLAY refusal.
- Three races proven on separate recorded backends (`for update` on the
  assignment row; `provisioning-code-issuance.integration.test.ts` 3/3):
  A) two keys → one ISSUED, one OUTSTANDING, one row, one event;
  B) same key identical → one ISSUED, one ALREADY_ISSUED, one row, one event;
  C) same key different assignment → winner ISSUED, loser CONFLICTING_REPLAY,
  no loser residue.

## Security posture

- Owner `kitluy_activation_governor` (NOLOGIN; borrowed and handed back in-file).
- Door: EXECUTE to `authenticated` ONLY; PUBLIC/anon/service_role hold nothing;
  bridges executable by the governor alone. P02C owns any production grant.
- Tables remain default-deny (0162) plus the 0126-style governor policies
  (definer-only visibility; runtime roles see nothing).
- Narrow schema-usage grants added: `extensions` (pgcrypto) and `kitluy_ops`
  (authoritative clock) to the governor, matching the 0127/0157 patterns; the
  approval reader's CREATE on kitluy_devices was borrowed for the ownership move
  and revoked immediately (sections-41/42 invariant holds).
- Membership census: zero login-capable members of either governor.
- No raw-code column exists; events carry no raw code (asserted).

## Verification (fresh, from zero, effective role postgres unless noted)

| Command | Exit | Result |
| ------- | ---- | ------ |
| `pnpm db:reset` (0000→0163) | 0 | 62 files; guard NOTICE |
| `pnpm db:seed` ×2 | 0 | idempotent |
| `pnpm db:test` | 0 | **203 PASS** (94 assertions incl. section 50 + 109 RLS incl. N8–N11) |
| `pnpm test:rls` | 0 | **109 PASS** |
| issuance race suite | 0 | **3/3** (separate backends, recorded PIDs) |
| `pnpm migrations:validate` / `db:validate` | 0 | 62 files |
| `pnpm secret:scan` / `clock:check` | 0 | — |
| membership census | 0 | zero login-capable members of both NOLOGIN authorities |
| `pnpm hub:db:reset`+seed+`hub:db:test` | 0 | 35 PASS (membership restored per cmdTest) |
| registry service full suite | 0 | **222/222** (lifecycle 30/30, census 14/14) |

Baselines did not regress: db:test 200 → 203, rls 107 → 109.

Defects found and fixed during this package (recorded honestly): grant
registration needed a guarded insert (permission_key has no unique constraint);
the door needed the 0150 bridge pattern for kitluy_auth reach plus narrow
schema-USAGE grants (extensions, kitluy_ops); `max(uuid)` removed; trusted-time
establishment and the BLK-005-era certificate issuance added to fixtures;
WS11-P1/P2 RLS invariants reconciled with the ballot (KLD-2026-07-28-002):
development-gated activation is legal, pilot/production stay fail-closed and
are asserted so; N11's catalog checks moved out of the schema-denied anon role;
race idempotency re-check placed under the assignment lock.

## P02B2 prerequisites

Satisfied: issuance door live and race-safe (0163), schema foundation (0162),
event table, permission registry entry, test harness patterns, next free
migration **0164**. Recommended next package: **WS-11-T004-P02B2** — failed
presentation, attempt counting, five-attempt lockout and revocation.

## Rollback

`git revert` this package's commits; the migration has only ever been applied
to the local dev database (a `db:reset` rebuilds without 0163).
