# First device cloud enrollment

**Date:** 2026-08-07
**Status: NOT ACHIEVED.** No device enrolled against the cloud, because there is
no deployed backend to enrol against (`14_…DEPLOYMENT.md` §3).

The mission's critical acceptance scenario (§14) is therefore **not proven**, and
nothing below should be read as proving it. What advanced is the _boundary_ the
enrollment must cross, which is now enforced by tests rather than by intention.

---

## 1. The machine-enrollment boundary (§13) — verified

The agent must not require a service-role key, a human Supabase session, a
database password, or a shared permanent manufacturing private key. That is now
pinned by architectural tests, not just by design.

`services/kitluy-device-firstboot-agent`:

    runtime dependencies ............... {} (none)
    Supabase client / service_role ..... absent
    database password / DSN ............ absent
    human auth session tokens .......... absent
    embedded private key ............... absent
    fetch / http client / axios ........ absent

The last line is the load-bearing one. The agent has **no transport of its
own**: the cloud is reached only through the injected `EnrollmentClient` port,
so it cannot acquire an ungoverned path to Supabase even by accident. The four
injected ports are `IdentityStore`, `KeyProvider`, `EnrollmentClient` and
`ServerIdentityVerifier`.

These are asserted by `test/machine-enrollment-boundary.test.ts`, which reads
the source files and fails on any reintroduction. A Supabase client added later
"just to read one table" breaks the build rather than shipping to a shop floor.

## 2. The governed cloud surface it will use

Already built, unchanged by this mission —
`services/kitluy-device-registry-service`:

    POST /v1/terminal-provisioning/challenges
    POST /v1/terminal-provisioning/challenges/{id}/verify
    POST /v1/terminal-provisioning/redemptions

These are **pre-credential** routes. The caller's only authority is its sealed
manufacturing-enrollment key, proven by Ed25519 signature over a server-issued
challenge, plus a one-time provisioning code. A staff session, browser cookie,
shared terminal secret or Supabase key on this surface is a refusal. Tenant,
Store, Location, Hub, environment, profile and every timestamp are
**server-derived**.

That is exactly the boundary §13 asks for, and it already exists. **No new
backend adapter was required or written.**

## 3. Identity requirements (§15) — verified in simulation

| Requirement                                         | Status                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------- |
| each instance has unique identity material          | **tested** — two instances produce different public keys and hardware signals |
| image contains no per-device private identity       | **tested** — image layers create `/var/lib/kitluy/identity` empty at 0700     |
| `machine-id` not cloned                             | **tested** — `kitluy-base` truncates `/etc/machine-id` and relinks dbus       |
| SSH host keys not cloned                            | **tested** — removed in the base layer                                        |
| no cached Hub endpoint / assignment / configuration | **tested** — removed in the terminal layer                                    |
| private key never transmitted                       | **tested** — `IdentityRecord` has no such field                               |

Truncating `/etc/machine-id` rather than deleting it is deliberate: systemd
regenerates a unique id from an empty file on first boot, whereas a deleted file
can leave it unset.

## 4. Enrollment logic — proven in simulation only

43 tests pass (up from 31). The §30 device-agent list is covered:

| §30 requirement             | Covered                                                                                                                                                                                                           |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| existing unit tests         | yes — no regression, 31 → 43                                                                                                                                                                                      |
| unique identity             | yes — clone-hygiene suite                                                                                                                                                                                         |
| retry                       | yes — retryable vs non-retryable refusals                                                                                                                                                                         |
| idempotency                 | yes — repeated heartbeat produces identical effect                                                                                                                                                                |
| token replay handling       | partly — server-side replay protection is governed by the existing provisioning doors and is **not** re-implemented in the agent; the agent's contribution is that a retry is byte-identical to the first attempt |
| cloud failure / reconnect   | yes — 3-step flaky-client test completes                                                                                                                                                                          |
| invalid enrollment response | yes — non-retryable refusal halts rather than looping                                                                                                                                                             |

**Test doubles stand in for the cloud.** That is the correct approach where the
backend is unavailable, and it is not the same as an end-to-end run.

## 5. The resulting state the agent would produce

Preserved exactly as canonical (§11): `ENROLLED_UNASSIGNED` is **not** an enum
value and none was added. The condition is `lifecycle_state = 'enrolled'` with
no active row in `device_assignments`. UI may render "Enrolled · Unassigned"
from that; the database stays normalized.

`enrolled → active` does not exist (removed in group `0121`). On assignment the
agent moves to `awaiting_trust`, never to `active`. Both are pinned by test.

## 6. What remains before §14 can be proven

1. Resolve the PostgreSQL 17 blocker and deploy the chain.
2. Implement the real `EnrollmentClient` against `/v1/terminal-provisioning`,
   and a real `ServerIdentityVerifier` doing certificate pinning.
3. Provide a real `KeyProvider` (development crypto exists in
   `@kitluy/device-identity`; hardware-backed custody is BLK-005 §4-gated).
4. Seed a manufacturing-enrollment record — enrollment is a governed
   manufacturing act, not a self-service network call.
5. Package the agent into the `/usr/lib/kitluy/*` executables the systemd units
   already reference.

Step 1 blocks all of them.
