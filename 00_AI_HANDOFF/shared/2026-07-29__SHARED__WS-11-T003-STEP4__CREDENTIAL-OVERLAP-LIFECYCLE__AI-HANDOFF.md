# Credential overlap expiry and superseded-key lifecycle — AI Handoff

| Field           | Value                                                         |
| --------------- | ------------------------------------------------------------- |
| Task ID         | WS-11-T003 Step 4 — Prompt 3B (overlap expiry, key lifecycle) |
| Date / timezone | 2026-07-29 · Asia/Phnom_Penh                                  |
| Repository root | `C:\dev\HET-KITLUY-PROJECT`                                   |
| Starting SHA    | `e00b495`                                                     |

## Scope

**In:** detection of expired overlap; deterministic credential-lifecycle
advancement; refusal of the previous credential once the overlap ends;
preservation of the current credential; superseded-key destruction ELIGIBILITY;
durable lifecycle evidence.

**Out, and absent rather than stubbed:** scheduled workers and cron deployment,
actual key destruction (no owner policy exists), governed credential revocation,
production key-provider durability, independent hostile review.

## What was built

`src/credential-lifecycle.ts` — `advanceDeviceCredentialLifecycle`. It reads
authoritative state, decides whether the overlap is over, retires the previous
credential through a governed function, and EVALUATES — never performs —
provider-key destruction.

**Three lifecycles, kept apart.** Credential validity, credential-head status
and provider private-key state are related and are NOT the same thing. A
credential ending does not license destroying its key: under every same-key
renewal that key still backs the CURRENT credential. That is the first blocker
`evaluateKeyDestruction` checks, because getting it wrong would nominate a
device's only working key for destruction as a routine consequence of a routine
renewal.

**The boundary is half-open, and written once per layer.**

```
overlap usable   while  trusted_now <  overlap_ends_at
overlap expired  when   trusted_now >= overlap_ends_at
```

Identical in `overlapIsActive`, in `evaluateCertificateValidity` and in
`retire_overlapped_credential_v1`, and asserted at all three points — one
millisecond before, exactly at, and after — in the unit suite and in SQL section
39b. A one-millisecond disagreement between the layer that verifies and the
layer that retires is exactly the gap this closes.

**Eligible and authorized are separate answers.** `evaluateKeyDestruction`
returns both. A key can be fully unblocked — superseded, backing no live
credential, no reconciliation depending on it — and still not be destroyed,
because no owner policy authorizes it.

`supabase/migrations/…0134_credential_overlap_lifecycle.sql` — the governed
retirement, the append-only `device_credential_lifecycle_events` audit, and
`key_destruction_policy` shipped inert.

## The defect execution found — KLRISK-DEVICE-010

Probed under **both** identities before writing any code:

```
postgres                -> permission denied for table device_credentials
kitluy_issuance_service -> permission denied for table device_credentials
```

and no function in `kitluy_devices` performed the transition. Group 0125 defined
`superseded` and `expired`; group 0127 advances the head with a
`previous_generation` and an `overlap_ends_at`; **nothing ever moved a credential
into either state.** Once the three-day overlap ended the previous credential
stayed `issued` for ever.

That mattered more after the KLRISK-DEVICE-008 fix: `permittedOverlap` lets a
caller present the previous credential during the granted window, and without a
durable retired state the only thing stopping a lapsed overlap from still being
honoured was the caller remembering to stop supplying it. A lifecycle fact has
to be persisted, not remembered.

`retire_overlapped_credential_v1` selects the credential from the HEAD rather
than from the caller, so the current credential cannot be retired; it is
idempotent; it refuses on untrusted time; and it never overwrites `revoked`,
because revocation says more than supersession and must not be erased.

**The head is deliberately not rewritten.** Bumping its `version` would
invalidate the frozen `head_version_seen` of any renewal reservation in flight —
retiring an old credential would break a concurrent renewal — and
`overlap_ends_at` is the evidence that explains the retirement.

## KLRISK-DEVICE-008 hardened

The optional `permittedOverlap` now carries a REQUIRED `previousCredentialState`
read from the credential row, so an overlap vouches only for a credential that is
still `issued` and a spent grant cannot keep a retired credential alive. The
boundary also moved from `>` to `>=`, matching the database exactly.

## Destruction: specified, and blocked

**`[REQUIRED: device_key_destruction_owner_decision]`**

No owner decision governs private-key retention or destruction, so none was
invented. `key_destruction_policy` ships with destruction DISABLED, both
retention periods NULL and the missing decision named — the shape group 0129
used for rotation. `destruction_enabled` cannot be set true without naming an
approving decision AND supplying both retention periods: two CHECK constraints,
not conventions, and section 39a proves both refuse.

The decision must bind minimum retention, recovery retention (how long a key
must survive so an interrupted renewal can still be reconciled), incident and
legal hold, who may authorize destruction at the provider, whether destruction
is automatic once eligible or requires named operator approval, and what
evidence must survive the key.

**Provider-key destruction — SPECIFIED / BLOCKED ON OWNER POLICY.**

## Verification (Node v24.15.0, canonical order)

| Gate                                  | Exit | Result                                 |
| ------------------------------------- | ---- | -------------------------------------- |
| `pnpm db:reset` → `db:seed`           | 0    | clean rebuild, 0000→**0134**           |
| `pnpm db:test`                        | 0    | **182 PASS**                           |
| `pnpm test:rls`                       | 0    | **104 PASS**                           |
| `@kitluy/device-identity` vitest      | 0    | **543 passed / 0 skipped** (23 files)  |
| — live lifecycle suite                | 0    | **8 EXECUTED**, 0 skipped              |
| — lifecycle unit suite                | 0    | **36 passed**                          |
| `pnpm typecheck`                      | 0    | 89/89                                  |
| `pnpm lint`                           | 0    | 0 errors, 2 pre-existing warnings      |
| `pnpm clock:check --require-complete` | 0    | COMPLETE 4/4                           |
| `pnpm secret:scan`                    | 0    | clean                                  |
| `docs:verify` (8 steps)               | 0    | **8/8 PASS**                           |
| `verify` (12 steps)                   | —    | **11/12**; `format:check` pre-existing |

**TOOLCHAIN DEVIATION.** Node 22.23.0 is still not installed. Aggregate
verification is NOT baseline-authoritative; every step ran individually with the
documented override and no config file was changed.

The one `verify` failure is `format:check` on `R&D_HSA_AI_Agent_MVP.md`, which
this session did not touch and which fails identically at every prior head.

## Tests: passed / failed / not run

All added tests pass. One of my own assertions was wrong and was corrected
against the real contract: after retirement a **same-key** previous credential
is refused with `CERT_STALE_CERTIFICATE_GENERATION`, not a fingerprint mismatch —
the two credentials share a fingerprint, so the credential really does attest to
a key the device holds and is simply a superseded generation. Rotation refuses on
the fingerprint. Asserting the rotation code for both would have hidden which
check was doing the work.

Not run: nothing was skipped. The live lifecycle suite EXECUTED against
PostgreSQL under `SET LOCAL ROLE kitluy_issuance_service`.

## Security findings

Preserved: no caller-supplied trust verdict; no key material in the lifecycle
audit; the executor can neither enable destruction nor write lifecycle history
directly; PUBLIC cannot retire a credential; the audit is append-only by trigger;
RLS ENABLE+FORCE; NOLOGIN governors.

Observed across the live runs: same-key ends `credentials superseded:1, issued:2`
with `keys active:1` — the shared key is never destruction-eligible. Rotation
holds `keys superseded:1, active:2` throughout. **Zero keys destroyed in either
path**, and a fully unblocked key returns `KEY_DESTRUCTION_NOT_AUTHORIZED` with
`eligible: true, authorized: false`.

## Known limitations

No scheduled worker or cron — the lifecycle advances only when something calls
it. `destruction_pending` and `destruction_failed` were deliberately NOT added:
with no policy, destruction never runs, so they would be speculative schema for
a path nothing can reach. True parallel executors are not exercised live (two
executors cannot share one `pg` client); the live test runs them sequentially and
proves the second produces no second retirement. Still **no governed credential
revocation (KLRISK-DEVICE-007)** — overlap RETIREMENT is not revocation and key
DESTRUCTION is not revocation, and neither was implemented as a stand-in. No
independent review.

## Current implementation status (evidence register delta)

**Credential overlap expiry and superseded-key lifecycle — IMPLEMENTED-IN-DEV
component.**

**Provider-key destruction — SPECIFIED / BLOCKED ON OWNER POLICY.**

Nothing else advances. WS-11-T003 Step 4 is NOT complete; WS-11 stays
SCAFFOLDED / IN PROGRESS.

## Recommended next task

Prompt 3C — scheduled lifecycle and reconciliation execution with operational
controls. Not begun.
