# RLS and security evidence

**Date:** 2026-08-07

---

## 1. RLS — executed, passed

`supabase/tests/rls-tests.sql` ran to completion (**exit 0**) against a database
built from zero by all 86 canonical migrations.

Cases executed, per the suite's own closing summary:

- 14 + 9 baseline cases
- Cycle-5: WS5 7 negative + 7 positive · WS6 10 negative + 9 positive
- Cycle-6: WS7 13 negative + 6 positive · WS8 13 negative + 6 positive
- Cycle-10 `kitluy_devices`: T001 4 negative + 1 positive · T002 3 negative + 1 positive
- WS-11-T004: provisioning-code (3 negative), issuance door, presentation
  evaluator, revocation door, expiration helper, replacement lineage, recovery
  door, PoP foundation, redemption door, composition identity, activation state
- WS-11-T005: fleet / support / containment boundary cases
- WS-11-T006: replacement boundary cases · release boundary cases

Sample negative pinned by the run: _"WS11-N23b: authenticated can neither read
releases nor promote one."_

Structural assertions (`assertions.sql`) also passed (**exit 0**), covering
groups `0010`–`0180` including the RC-022 spendability census, governed
emergency revocation `0150`–`0153`, fleet health `0177`, hub replacement `0179`
and release authority `0180`.

**No RLS policy was written, weakened or relaxed by this mission.**

## 2. The BLK-005 gate is still shut, and still fails closed

    kitluy_devices.pki_trust_configuration    -- created EMPTY, never seeded
    kitluy_devices.assert_pki_configuration_approved(environment)
      -> KLUY-DEVICE-PKI-UNCONFIGURED

Re-proven on this reset from zero: the table exists and is empty after all 86
migrations plus seed. `production_eligible` has no path to `true`.

The new firstboot agent respects this. It was built against `KeyProvider` and
`ServerIdentityVerifier` **interfaces**, not against a CA — so it is testable
today and the real providers drop in when BLK-005 implementation lands, without
the agent pretending trust exists.

## 3. Secrets

| Check                     | Result                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Credential committed      | none                                                                                         |
| Secret in any new file    | none                                                                                         |
| Service-role key in image | none — build-time gate + test                                                                |
| Private key in git        | none                                                                                         |
| `.env` printed            | never                                                                                        |
| DB password in image      | none — the Hub DSN is created on-device at activation, deliberately not written by the build |

The only keys that appeared in this session were the Supabase CLI's well-known
local development defaults, inside an ephemeral scratch container with no
relationship to any cloud project. They are not secrets and are not recorded
anywhere in the repository.

`pnpm secret:scan` result: see `13_FINAL_REPORT.md` §J.

## 4. Device authentication is not browser authentication

Confirmed still true, and preserved. The cloud provisioning routes are
pre-credential: the only authority is a sealed manufacturing-enrollment key
proven by Ed25519 signature over a server-issued challenge, plus a one-time
provisioning code. A staff session, browser cookie, shared terminal secret or
Supabase key on that surface is a **refusal**, not a fallback.

No Supabase user refresh token is placed in any OS image. The image is
zero-secret; per-device trust is established during enrollment.

## 5. Tenant isolation for unassigned devices — structural

An unassigned device holds **no** Store scope, because every scope value is
server-derived and delivered only with an assignment. The firstboot agent has no
code that requests or consumes Store data, so the isolation is structural rather
than a check that could be missed.

Pinned by test: the outcome of enrollment and heartbeat contains no `tenant`,
`digitalStore` or `location` value.

## 6. Audit

Audit relations are append-only and were not modified: `device_lifecycle_events`,
`device_credential_lifecycle_events`, `device_containment_events`,
`support_access_events`, `device_claim_events`, `release_events`. Migration
`0180` installed an append-only trigger on `release_events`. No finalized audit
record was mutated by this mission — this mission wrote no SQL at all.
