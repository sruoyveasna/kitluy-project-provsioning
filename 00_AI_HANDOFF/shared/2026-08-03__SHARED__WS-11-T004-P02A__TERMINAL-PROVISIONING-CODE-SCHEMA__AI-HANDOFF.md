# WS-11-T004-P02A — terminal provisioning-code schema foundation

| Field      | Value |
| ---------- | ----- |
| Package    | WS-11-T004-P02A — additive cloud schema foundation |
| Date       | 2026-08-03 · Asia/Phnom_Penh |
| Start SHA  | `99ea3a2` |
| Toolchain  | Node v22.23.0, pnpm 9.15.9 |
| Migration  | **0162** `20260803140000_0162_terminal_provisioning_codes.sql` (additive; groups 0000-0161 unchanged) |
| Status     | **IMPLEMENTED-IN-DEV** |
| Push       | not pushed; URL `disabled://push-requires-owner-approval` |

## Package identity and scope boundary

Delivered: neutral relational schema for terminal provisioning codes and their
append-only lifecycle events — constraints, indexes, RLS posture, ownership,
default-deny grants, migration guard, focused database assertions (section 49)
and RLS tests (WS11-N8/N9/N10).

Deliberately NOT delivered (P02B/P02C scope): raw code generation, Crockford
encoding, issue/redeem/revoke/attempt/lockout functions, security-event
producers, active-Hub gate evaluation, PoP validation, certificate issuance,
provisioning endpoints, service composition, pairing, UI, signing custody.

## Schema design

**`kitluy_devices.device_provisioning_codes`** — DD `provisioning_sessions`,
deliberately NOT `device_claims` (the Hub claim keeps its semantics).

- Relational scope (never JSON): `tenant_id`, `digital_store_id`,
  `store_location_id`, `store_hub_device_id` (the assigned Hub),
  `terminal_device_id`, `terminal_assignment_id`, `terminal_profile_key`
  (`<vertical>.t<n>.<role>` shape, same check as `device_terminal_assignments`),
  `environment`.
- Hash-only storage: `code_digest char(64)` (sha-256 hex, UNIQUE, global
  namespace documented in the table comment), `digest_algorithm text default
  'sha256'` (a future keyed digest is a data change, not a schema change; no
  key version exists because no keyed hashing is planned), `payload_sha256`
  binding device+assignment+profile+expiry (claim pattern).
- State enum `provisioning_code_state`: `issued, redeemed, locked, expired,
  revoked` — one-way, terminal states cannot reopen (trigger).
- Storage for later governed behavior: `failed_attempt_count` (0..5),
  `locked_at/locked_reason`, `redeemed_at`, `revoked_at/revocation_reason`,
  `expires_at` (CHECK `> created_at` and `<= created_at + interval '15 minutes'`),
  `issued_by_operator_ref`, `correlation_id`.
- Integrity trigger `enforce_provisioning_code_integrity` (owned by the
  NOLOGIN governor, PUBLIC revoked): on INSERT, scope consistency — the
  assignment must name the same device/location/profile, and the Hub must
  hold a `pending_trust`/`active` assignment to the same Tenant/Store/Location;
  on UPDATE, scope/digest/payload/expiry immutable, state one-way, attempts
  monotonic; DELETE refused.
- One OUTSTANDING code per terminal assignment (partial unique index where
  `state='issued'`); indexes for assignment lookup, expiry sweep
  (`state='issued'` by deadline), Hub scope, Tenant/Store/Location/environment.

**`kitluy_devices.device_provisioning_code_events`** — append-only lifecycle
events (`CREATED, PRESENTED, FAILED_ATTEMPT, LOCKED, REDEEMED, EXPIRED,
REVOKED, RECONCILIATION_REQUIRED`), actor types
(`OPERATOR, TERMINAL, SYSTEM, WORKER`), scope columns for isolation,
non-authoritative `detail` (never a raw code), append-only trigger.

## Ownership, grants, RLS

Both tables owned by **kitluy_activation_governor** (NOLOGIN; borrowed and
handed back in-file per the 0147-0161 pattern). RLS **ENABLE+FORCE**, zero
policies (deny-by-absence). `revoke all from public`; **no grants to any
runtime role in P02A** — the P02B doors are the only future path in.

## Verification (all fresh, from zero, effective role postgres unless noted)

| Command | Exit | Result |
| ------- | ---- | ------ |
| `pnpm db:reset` (0000→0162) | 0 | guard NOTICE: schema applied; 61 files |
| `pnpm db:seed` ×2 | 0 | idempotent |
| `pnpm db:test` | 0 | **200 PASS** (93 assertions + 107 RLS) — section 49 green |
| `pnpm test:rls` | 0 | **107 PASS** (WS11-N8/N9/N10 green) |
| `pnpm migrations:validate` | 0 | 61 files |
| `pnpm db:validate` | 0 | all static checks |
| `pnpm secret:scan` | 0 | — |
| `pnpm clock:check` | 0 | — |
| membership census (psql) | 0 | zero login-capable members of `kitluy_activation_governor` |
| `pnpm hub:db:reset`+seed | 0 | hub rebuilt after cloud reset (0000→0030; unrelated to this package, state restored) |

Section 49 proves, with exception-safe borrowed-owner fixtures: valid scoped
row + event; TTL >15 min refused; expiry ≤ creation refused; attempt count 6
refused; inconsistent locked/redeemed/revoked refused; duplicate digest
refused; second outstanding code refused; profile-vs-assignment mismatch
refused by the trigger (isolated from the unique index by a second fixture
assignment); unassigned-Hub refused; scope/digest/payload/expiry immutable;
issued→revoked closes and cannot reopen; attempts monotonic; events
append-only; code rows undeletable. RLS: anon denied (N8), authenticated
denied read AND insert (N9), no runtime service identity holds direct
mutation (N10). Required tests: **zero skips** (this package adds no
skip-gated tests; the suites run live by default).

Two defects found and fixed during verification, recorded honestly: (1) the
trigger functions initially missed PUBLIC-revoke and NOLOGIN ownership
(definer-hygiene caught it); (2) the first refusal-matrix fixtures collided
with the one-outstanding index and the terminal's own assignment (rewritten
with a second terminal assignment and an orphan device).

## Rollback

`git revert` of this package's commit removes the migration file, assertions
and RLS tests. The migration has only ever been applied to the local dev
database; a `db:reset` rebuilds without it.

## P02B prerequisites (satisfied → recommended next package)

Satisfied: schema foundation (0162), integrity machine, events, posture,
test patterns, next free cloud migration **0163**, P01 audit contract.
Recommended next: **WS-11-T004-P02B** — governed issue/redeem/revoke doors,
TTL/single-use/race/idempotency, attempt counter + 5-attempt lockout +
security event, active-Hub gate, PoP binding.
