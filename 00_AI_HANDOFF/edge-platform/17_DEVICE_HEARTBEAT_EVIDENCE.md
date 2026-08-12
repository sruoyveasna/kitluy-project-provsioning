# Device heartbeat evidence

**Date:** 2026-08-07
**Status: NOT PROVEN AGAINST CLOUD.** No heartbeat reached a cloud database.
The heartbeat _contract_ is implemented and tested in simulation.

---

## 1. Fields reported

The agent's heartbeat carries exactly three fields:

    deviceRecordId
    osImageVersion
    releaseChannel

Deliberately minimal. The mission (§16) says a basic governed heartbeat is
enough for this milestone and warns against building a high-frequency telemetry
architecture that is not part of the current design — so device class,
hardware profile and health summary are **not** re-sent per beat. Device class
is established at enrollment and is server-held; re-transmitting it every beat
would let a device restate its own class, which is server-derived truth.

Against the existing cloud contracts (`device_health_reports`,
`device_health_projections`, `fleet_health_read`), last-seen and assignment
state are **derived server-side** from the beat rather than asserted by the
device. The mission's §16 field list is satisfied by the existing schema, not by
widening the device's claims.

## 2. Store scope is absent — by test

    for (const forbidden of ["tenantId", "digitalStoreId", "locationId", "hubId"])
      expect(Object.keys(captured)).not.toContain(forbidden);

An enrolled unassigned device holds no Store scope, so it has none to send. The
test asserts the beat's shape rather than trusting that no future field creeps
in.

## 3. Idempotency and retry

    a repeated heartbeat is idempotent from the agent's side ......... PASS

Two consecutive steps from the same position produce **identical** request
payloads and identical outcomes. The agent accumulates no state across beats, so
a retry after a timeout is indistinguishable from the first attempt — which is
what lets the server's idempotency handling actually work.

Failure behaviour:

| Condition                                          | Behaviour                                          |
| -------------------------------------------------- | -------------------------------------------------- |
| retryable refusal                                  | retry; position unchanged                          |
| non-retryable refusal (e.g. `KLUY-DEVICE-REVOKED`) | **halt**, do not loop                              |
| server identity unverified                         | refuse and transmit nothing; re-checked every step |
| terminal lifecycle state                           | halt; transmit nothing                             |

A revoked device that kept retrying would generate exactly the traffic pattern a
stolen device produces and bury the real signal.

## 4. Last-seen behaviour

Not demonstrable without the cloud. The existing schema owns it — the cloud
health projection is ordered by the Hub's report sequence and carries explicit
freshness that fails closed (WS-11-T005). The device never asserts its own
last-seen time; a device-asserted timestamp would be trivially forgeable and
would also be wrong whenever device time is wrong, which is precisely the
condition trusted time exists to detect.

## 5. Honest status

    heartbeat contract (agent side) ..... IMPLEMENTED-IN-DEV, 43 tests
    heartbeat against cloud ............. NOT PROVEN
    last-seen in a cloud record ......... NOT PROVEN
    fleet health projection ............. pre-existing, not re-verified remotely
