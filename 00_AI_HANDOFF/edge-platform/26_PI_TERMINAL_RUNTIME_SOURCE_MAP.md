# Pi Terminal runtime source map

**Date:** 2026-08-10
**Status:** VERIFIED — analysis only. No code was written and nothing was committed.

> **Numbering note.** The mission requested this document as `20_…`, but
> `20_CANONICAL_TARGET_CHANGE.md` … `25_CLOUD_DEPLOYMENT_TASK_SCOPE.md` already
> exist in this directory. Overwriting them would destroy recorded history, so
> this series continues at 26. The mission's 20→31 names map onto 26→37.

---

## 1. The previously reported defect — re-verified

The prior report said the image's systemd units point at executables that do
not exist. **Confirmed, and it is worse than reported in one respect and much
better in another.**

Every `ExecStart` target in the staged terminal tree is absent:

    ABSENT  /usr/lib/kitluy/enrollment-agent
    ABSENT  /usr/lib/kitluy/firstboot-identity
    ABSENT  /usr/lib/kitluy/health-reporter
    ABSENT  /usr/lib/kitluy/hub-discovery-listen
    ABSENT  /usr/lib/kitluy/terminal-client
    ABSENT  /usr/lib/kitluy/update-agent

Nothing in `rpi-image-gen/layer/*.yaml` writes a file into `/usr/lib/kitluy/`;
only the empty directory is created (`kitluy-base.yaml:73`).

### 1.1 The correction that matters

This is **not an oversight**. `kitluy-base.yaml:26-28` records the reason:

> Device agent runtime. Node is the runtime the KitLuy agents are written in;
> the agent code itself is delivered by the governed release system, not baked
> here (mission §27: OS image is not an application release).

`nodejs` **is** installed in the image. The absence of agent code is a
deliberate, recorded architectural decision: the OS image is a platform, and
application payloads arrive through the release/update system into A/B app
slots.

**Consequence for the current mission.** Its §15 ("Package Real Runtime
Software Into the Image") asks for the opposite of that decision. §15 also
says "Do not make packaging unnecessarily complex if the repository already
defines another canonical installation mechanism" — and one is defined. This
conflict is an **owner decision**, recorded in `28_…MISSION_BLOCKERS.md` as
DEC-1. It was not resolved unilaterally.

---

## 2. Source / disposition matrix (§12)

| Runtime role        | Existing source                                                                             | Current status                                                                             | Image target                    | Action                                        |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------- |
| First-boot identity | `services/kitluy-device-firstboot-agent/src/identity.ts` → `bootstrapIdentity`               | IMPLEMENTED-IN-DEV. Pure logic + 3 injected ports. **No adapters, no executable entrypoint** | `/usr/lib/kitluy/firstboot-identity` | **UNBLOCKED** — build adapters + bin           |
| Enrollment agent    | same package, `src/enrollment.ts` → `runEnrollmentStep`                                      | IMPLEMENTED-IN-DEV. `EnrollmentClient` port has **no server counterpart**                    | `/usr/lib/kitluy/enrollment-agent`   | **BLOCKED** — no Stage A cloud contract exists |
| Health reporter     | `enrollment.ts` heartbeat (3 fields); cloud consumer `device-registry-service/src/health-report-ingestion.ts` | Contract implemented. Consumer is **Hub-scoped** (`AuthenticatedHubDelivery`), not device-scoped | `/usr/lib/kitluy/health-reporter`    | **BLOCKED** — BLK-006 + no device→cloud route  |
| Terminal runtime    | `apps/kitluy-pos-desktop-app` (13-state bootstrap machine, WS-12-T001)                       | IMPLEMENTED-IN-DEV                                                                          | A/B app slot                    | Delivered by release system, not baked         |
| Hub discovery       | `packages/device-identity/src/edge-discovery.ts`; `services/kitluy-hub-agent/src/hub/edge/discovery.ts` | IMPLEMENTED-IN-DEV                                                                          | `/usr/lib/kitluy/hub-discovery-listen` | Needs bin wrapper. Post-assignment only        |
| Update agent        | `services/kitluy-device-release-and-update-service`; `release-agent.ts` (WS-11-T006-P04)      | IMPLEMENTED-IN-DEV. **SlotAdapter runtimes are production-shaped fakes**; physical Pi boot-slot adapters are unwritten | `/usr/lib/kitluy/update-agent`       | **BLOCKED** — hardware adapters, BLK-005       |
| POS launcher/shell  | `apps/kitluy-pos-desktop-app` (Electron)                                                     | IMPLEMENTED-IN-DEV                                                                          | A/B app slot                    | Not baked, per the recorded decision           |

### 2.1 What is genuinely unblocked

Exactly one role: **first-boot identity**. Identity generation is a purely
local operation — a keypair, a hardware probe and an atomic write. It needs no
cloud, no Hub, no server contract and no owner security decision. It is the
only row above that can be turned into working software today.

---

## 3. `kitluy-device-firstboot-agent` — deep inspection (§13)

Do **not** build a second enrollment agent. This service is the canonical owner
and is well built.

    src/identity.ts            154 lines   firstboot identity bootstrap
    src/enrollment.ts          239 lines   cloud enrollment + fleet state machine
    src/factory.ts             472 lines   factory/QA model
    src/factory-gateway.ts     470 lines   composition over governed SQL doors
    src/trusted-time-gateway.ts 265 lines  trusted-time establishment
    test/ (8 files)          2,478 lines

Design properties worth preserving:

- **Zero runtime dependencies.** `package.json` `dependencies` is `{}`, pinned
  by `test/machine-enrollment-boundary.test.ts`.
- **No transport of its own.** No `fetch`, no `node:http`, no axios — asserted
  by source-reading tests. The cloud is reachable only through the injected
  `EnrollmentClient`, so the agent cannot acquire an ungoverned path to
  Supabase even by accident.
- **Four injected ports:** `IdentityStore`, `KeyProvider`, `HardwareProbe`,
  `EnrollmentClient` (+ `ServerIdentityVerifier`).
- **The private key has no field to travel in.** `IdentityRecord` deliberately
  omits it, and `toRecord()` selects fields explicitly rather than spreading,
  so a new field must be opted *in* to transmission.
- **Identity is server-generated and opaque.** Never derived from MAC, board
  serial or storage serial — those are collected as binding/tamper evidence
  only.
- **Rerun safety is a property of the data.** `complete` is written last; a
  record without it is treated as a torn write and re-created, rather than
  relying on a marker file.

The gap is precisely and only this: **the ports have no production adapters and
the package has no executable entrypoint.** There is no `bin/`, and `main` points
at `dist/index.js`, a library.

---

## 4. The Stage A finding (§3, §10, §22)

The mission's Stage A — a factory-fresh Pi reaching the cloud over the internet
to self-enrol, with no Store Hub — **does not exist at any layer.** This was
verified at four levels, not inferred:

**HTTP.** A census of every `/v1/…` route literal across `services/*/src`
returns exactly three surfaces:

    /v1/terminal-provisioning            (challenges, verify, redemptions)
    /v1/device-credentials/revocations
    /v1/device-credentials/emergency-revocations

There is no device self-enrollment route, no heartbeat route and no
assignment-poll route. The three `EnrollmentClient` methods have no server
counterpart.

**SQL.** The governed enrollment door requires a manufacturing station and a
human operator:

    kitluy_devices.enroll_device_v1(
      p_asset_tag, p_hardware_profile_id, p_manufactured_at,
      p_device_public_key_fingerprint, p_public_key_algorithm,
      p_key_storage_class,
      p_enrollment_station_id,      -- a field Pi has none
      p_enrollment_operator_ref,    -- a field Pi has none
      p_signals, p_enrollment_batch_ref, p_enrollment_reason)

**Health.** `health-report-ingestion.ts` consumes the Hub's
`device_fleet.health_projection_reported` events under an
`AuthenticatedHubDelivery` scope. It is a Hub→cloud path, and that transport is
the recorded BLK-006 gap. There is no device→cloud equivalent.

**Provisioning.** The existing terminal-provisioning routes are **not** Stage A.
They are pre-credential routes whose caller authority is "(a) its sealed
manufacturing-enrollment key … and (b) a one-time provisioning code". They
presuppose a device that has **already** been factory-enrolled at a station.

### 4.1 The security question this raises

§18 (clone hygiene) forbids baking any key, certificate or secret into the
golden image. A generic image, no enrollment station, and no pre-shared secret
means **nothing authenticates a factory-fresh Pi** to a self-enrollment
endpoint.

Resolving that is a security-boundary decision that intersects BLK-005 (key
custody and secure-element model). It is not a coding choice, and it was not
invented here. See DEC-2 in `28_…MISSION_BLOCKERS.md`.

---

## 5. What already exists on the cloud side (better than expected)

Two mission sections are substantially already built:

**§24 Admin fleet visibility.** `services/kitluy-management-api` serves
`GET /management/v1/devices` from `kitluy_devices.device_fleet_status` via
`src/fleet.ts`, with an explicit DTO (fields selected, never spread, so device
binding evidence cannot leak to a browser). `FleetFreshness` is
`ONLINE | STALE | OFFLINE | NEVER_SEEN | UNKNOWN`.

Liveness thresholds were ruled **today** by `OD-EDGE-LIVENESS-001`
(ONLINE ≤ 90 s, STALE ≤ 5 min, OFFLINE > 5 min) as an owner-approved
*development default*, implemented as configuration in `composition.ts` with
startup refusals for unparseable or inverted values.

**§5 Pairing code.** The mission's "pairing code" already exists under a
different name: **provisioning codes**, with issuance, presentation, proof-of-
possession, redemption, lockout, revocation, expiry, replacement and recovery
— roughly 25 integration test files in `kitluy-device-registry-service/test/`.
Per §5's own instruction ("Use existing normalized schema/contracts"), **no new
pairing-code table or column should be created.**

---

## 6. Evidence commands

    # route census
    grep -rhoE '"/v1/[a-z0-9/_{}:.-]*"' services/*/src/*.ts | sort -u

    # ExecStart targets vs reality
    grep -rh '^ExecStart=' infra/kitluy-os-image/out/pi-terminal/rootfs/etc/systemd

    # governed enrollment door
    grep -rn -A12 'function kitluy_devices.enroll_device_v1' supabase/migrations/
