# KitLuy device liveness thresholds — OWNER-APPROVED DEVELOPMENT DEFAULT

| Field       | Value                                                   |
| ----------- | ------------------------------------------------------- |
| Decision ID | `OD-EDGE-LIVENESS-001`                                  |
| Status      | **OWNER-APPROVED DEVELOPMENT DEFAULT**                  |
| Decided     | 2026-08-10                                              |
| Scope       | development environment only                            |
| Supersedes  | the previous "threshold unruled → always UNKNOWN" state |
| Review gate | **MUST be reviewed before Pilot**                       |

## Decision

Device liveness is derived from the most recent accepted device observation
using these thresholds:

| State        | Condition                                      |
| ------------ | ---------------------------------------------- |
| `ONLINE`     | last accepted observation ≤ 90 seconds ago     |
| `STALE`      | > 90 seconds and ≤ 5 minutes                   |
| `OFFLINE`    | > 5 minutes                                    |
| `NEVER_SEEN` | no accepted observation has ever been recorded |

## Why this is configuration, not database truth

The thresholds are **configuration**, deliberately not a database enum, not a
migration and not a product constant.

A threshold baked into schema becomes a fact the fleet cannot re-tune without a
schema change. The correct value is a property of heartbeat cadence and Store
network behaviour, and neither is known until real devices run on real Store
networks. Encoding a guess as schema would give it an authority it has not
earned.

Migration count is therefore unchanged: **86 → 86**. No DDL was written.

## Where it is implemented

| Concern      | Location                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Defaults     | `DEVELOPMENT_STALE_AFTER_SECONDS` / `DEVELOPMENT_OFFLINE_AFTER_SECONDS` in `services/kitluy-management-api/src/composition.ts` |
| Override     | `MANAGEMENT_API_STALE_AFTER_SECONDS`, `MANAGEMENT_API_OFFLINE_AFTER_SECONDS`                                                   |
| Derivation   | `deriveFreshness` in `services/kitluy-management-api/src/fleet.ts`                                                             |
| Presentation | `freshnessLabel` in `apps/kitluy-admin-pwa-portal/src/device-presentation.ts`                                                  |

## Refusals encoded with the decision

- An **unparseable or non-positive** threshold is a startup refusal, never a
  silent fallback to the default. A deployment that meant `600` and typed
  `600s` would otherwise report devices offline five minutes early with nobody
  aware a value had been ignored.
- **Inverted thresholds are refused**: `OFFLINE` must exceed `STALE`, or the
  `STALE` state becomes unreachable and a merely degraded device is reported as
  fully offline.
- The Admin Portal **labels these as development defaults** wherever liveness is
  shown. A ruled threshold permits the word "Online"; it does not permit
  presenting a provisional number as settled truth.

## What must happen before Pilot

1. Measure the real heartbeat cadence of Store Hub and Terminal agents.
2. Measure Store network behaviour, including NAT/DHCP interruption windows.
3. Re-rule the thresholds against that evidence and change this status from
   `OWNER-APPROVED DEVELOPMENT DEFAULT` to a Pilot decision.

Until step 3, an `ONLINE` badge in the Admin Portal means "observed within the
development threshold", not "verified live".

## Source of the liveness signal

`kitluy_devices.device_fleet_status.last_observed_at` is
`max(device_hardware_observations.observed_at)`, written by the canonical
`kitluy_devices.record_hardware_observation_v1`. A device heartbeat is
therefore also a **hardware attestation**: the observation is compared against
the enrolled manifest, and a mismatch quarantines the device rather than simply
refreshing a timestamp.

This is why no separate heartbeat table was introduced. It is also why a
heartbeat must never be sent with approximate signals.
