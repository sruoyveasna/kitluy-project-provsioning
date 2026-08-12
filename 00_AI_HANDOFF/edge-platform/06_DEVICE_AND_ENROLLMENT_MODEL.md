# Device and enrollment model

**Date:** 2026-08-07
**New code:** `services/kitluy-device-firstboot-agent`
**Status:** IMPLEMENTED-IN-DEV (31 tests, typecheck clean) · **not hardware-proven**

---

## 1. The identity rule, enforced where identity is created

The primary identity is an opaque, server-generated `device_record_id`. It is
**never** derived from MAC address, board serial or storage serial.

The reason is worth restating because it is easy to "optimise" away: a derived
identity makes a **repaired** device a _different_ device, and makes a **cloned**
device the _same_ device. Both failures are silent.

Hardware values are collected as **binding and tamper signals** and sent as
evidence. A changed signal quarantines the device server-side and requires
governed re-enrollment.

Pinned by test: `firstboot-identity.test.ts` — "collects hardware signals as
evidence without deriving identity from them".

## 2. Private keys never leave the device

`StoredIdentity` holds an opaque `privateKeyHandle`; the transmittable
`IdentityRecord` **has no private-key field at all**. `toRecord()` selects fields
explicitly rather than spreading-and-deleting, so a future field must be opted
**in** to transmission.

Pinned by test: "never exposes private key material in the transmittable record".

## 3. Enrollment is a manufacturing act — a divergence, resolved

The mission's §25 sketch implies firstboot creates enrollment by calling the
cloud. **The canonical model does not work that way.**

Enrollment is a governed manufacturing-time record (`manufacturing_enrollments`,
sealed, created at an `enrollment_station`). The device proves possession of an
already-sealed key; it does not mint its own enrollment. The cloud provisioning
routes are explicit that the caller's only authority is that sealed key plus a
one-time code.

**Resolved in favour of the canonical model.** The agent's `EnrollmentClient` is
an interface over that governed surface, not a self-enrollment shortcut.

## 4. Firstboot rerun safety — a data property, not a marker file

The systemd unit deliberately has **no** `ConditionPathExists` guard. Rerun
safety lives in the data: `StoredIdentity.complete` is written last, and a record
without it is treated as a torn firstboot and recreated.

A marker file written before the work finished is exactly the failure a guard
would misread as "already done", leaving a device permanently half-provisioned.

Three outcomes are distinguished — `created`, `reused`, `recreated` — because
`recreated` is not a success dressed up as one; the fleet needs to see that a
previous attempt left unusable material behind.

Pinned by tests: rerun safety across 10 boots (one key generated, one write);
torn-write recreation; unusable-key recreation.

## 5. The state machine mirrors the database

States are exactly `device_lifecycle_state`. No enum value was invented.

- **`ENROLLED_UNASSIGNED` is not a state.** It is `enrolled` with no active
  assignment — which is how the database models it. Inventing the value would
  put the agent and the database into permanent disagreement.
- **`enrolled -> active` does not exist** (removed in group `0121`). An assigned
  device moves to `awaiting_trust`. Activation additionally requires certificate
  issuance the device does not perform for itself.

## 6. Refusals that fail closed

| Condition                                                                 | Behaviour                                     | Test                              |
| ------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------- |
| Server identity unverified                                                | refuse, **transmit nothing**                  | asserts `enroll` was never called |
| Server identity                                                           | re-verified **every step**, not once per boot | asserts two calls over two steps  |
| `retired`/`replaced`/`quarantined`/`restricted_investigation`/`suspended` | halt, transmit nothing                        | one test per state                |
| Non-retryable refusal                                                     | halt rather than loop                         | enrollment + heartbeat cases      |
| Retryable refusal                                                         | retry, state unchanged                        | asserts no partial state advance  |
| Offline then reconnect                                                    | completes on reconnect                        | 3-step flaky-client test          |

A revoked device that kept retrying would generate exactly the traffic pattern a
stolen device produces, and would bury the real signal — hence halt, not retry.

## 7. Unassigned devices cannot reach Store data

Structurally, not by a check that could be missed: the agent never asks for
Store data and has **no code to consume it**. Every scope value is server-derived
and arrives only with an assignment.

Pinned by test: the outcome of enrollment and heartbeat contains no `tenant`,
`digitalStore` or `location` value.

## 8. Configuration version behaviour

Newer wins · equal is a no-op · **older is refused** · malformed is refused.

Accepting an older version is how a replayed or rolled-back delivery silently
downgrades a device's configuration. Five tests.
