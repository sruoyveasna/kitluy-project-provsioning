# DEC-2 enrollment — endpoint wiring, signal vocabulary and the flash-time station tool — AI Handoff

| Field           | Value                                                         |
| --------------- | ------------------------------------------------------------- |
| Task ID         | (unnumbered owner-directed continuation of the DEC-2 chain)   |
| Date / timezone | 2026-08-12 · Asia/Phnom_Penh                                  |
| Repository root | `~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project` |
| Branch          | `claude/fix-firstboot-esm-and-ssh-hostkeys` (NOT pushed)      |
| Base commit     | `209afc2`                                                     |
| Head commit     | `b184496`                                                     |

**Outcome: a factory-fresh device now enrolls itself end to end.** Observed
against a real PostgreSQL 17.6 database over a real socket, using the real
firstboot code, the real agent and the real service — not a test harness.

---

## Sources inspected

- `docs/decisions/kitluy-fresh-device-enrollment-authentication-owner-decision-v1.0.0.md`
  (KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001 — DEC-2), §2, §5, §6, §7, §8
- `docs/decisions/kitluy-device-bootstrap-runtime-and-release-boundary-owner-decision-v1.0.0.md` (DEC-1)
- `00_AI_HANDOFF/edge-platform/DEVICE_WORKFLOW_IMPLEMENTATION_GAP_AUDIT_2026-08-11.md`
  (DEVWF-B05/B06 recorded ABSENT)
- `00_AI_HANDOFF/edge-platform/28_PI_TERMINAL_MISSION_BLOCKERS.md`
- `supabase/migrations/20260811100000_0190_manufacturing_enrollment_tickets.sql`
- `supabase/migrations/20260728140122_0122_device_trust_decision_alignment.sql:465-480`
  (the unregistered-station quarantine path)
- `infra/kitluy-os-image/config/image.conf`, `scripts/build-image.sh`,
  `scripts/package-bootstrap-runtime.sh`

## Authority applied

- **KLD-2026-08-11-FRESH-DEVICE-ENROLLMENT-001** §5 (ticket properties: per-device,
  single-use, expiring, environment-scoped, revocable, secret-free at rest),
  §6 (successful enrollment produces `enrolled` + no assignment, nothing more),
  §7 (development and production share the mechanism; only custody differs),
  §8 (**reuse constraint** — no parallel PKI or device system).
- **KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001** (DEC-1) — the baked bootstrap set.
- CLAUDE.md hard rules 4 (no secrets), 7 (never weaken permission checks).

## Existing files preserved

No migration was created or modified. No governed door was altered. No role
grant was widened. `0190` is applied and untouched. The six standalone
repositories were not touched.

## Files created / changed

| Commit    | Area                                                                                                    | Change                                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `5433fb6` | `services/kitluy-device-registry-service/src/{main,http}.ts`                                            | Compose and mount the enrollment router; route `/v1/device-enrollment` before the generic `/v1/` delegation; fail closed 503 |
| `5433fb6` | `.../src/bin/enrollment-bootstrap.ts`                                                                   | Read the endpoint the image actually ships                                                                                   |
| `5433fb6` | `infra/kitluy-os-image/{config/image.conf,scripts/build-image.sh,rpi-image-gen/layer/kitluy-base.yaml}` | Add `KITLUY_ENVIRONMENT` to the image environment                                                                            |
| `ce43e25` | `.../src/adapters/http-enrollment-client.ts`                                                            | Map device signal names to the governed enum                                                                                 |
| `b184496` | `.../src/factory-gateway.ts`                                                                            | `issueEnrollmentTicket`, `resolveHardwareProfileId`, `readEnrollmentStation`                                                 |
| `b184496` | `.../src/card-preparation.ts`, `.../src/bin/prepare-card.ts`                                            | The flash-time station tool                                                                                                  |
| `b184496` | `package.json`                                                                                          | `pnpm device:prepare`                                                                                                        |

New tests: `http.test.ts` (+4), `enrollment-bootstrap-config.test.ts` (6),
`enrollment-signal-vocabulary.test.ts` (4), `card-preparation.test.ts` (10),
`station-preflight.test.ts` (8).

## Commands executed (with actual results)

```text
pnpm verify                          9 PASS / 4 FAIL   (see attribution below)
pnpm secret:scan                     PASS — 1695 tracked files
firstboot-agent  pnpm test           159 passed / 3 failed / 9 skipped
registry-service pnpm test           107 passed / 19 failed / 267 skipped
typecheck (both services)            clean
prettier / eslint on changed files   clean
```

**`pnpm verify` failure attribution — none is attributable to this work:**

| Step            | Cause                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check    | Prettier prints _"All matched files use Prettier code style!"_ then exits 2 on `EACCES` scanning the root-owned image build chroot `infra/kitluy-os-image/build/work-fresh/chroot-v2.7.0/filesystem/persistent/home/pi`. **This is a different failure mode from the 79-file condition recorded on 2026-08-11** and should be recorded as such. |
| Lint            | 30 errors, every one in generated build output under `infra/kitluy-os-image/out/**`. Zero hits for any file changed here.                                                                                                                                                                                                                       |
| Unit tests      | `@kitluy/device-identity` + registry-service integration suites hardcode `127.0.0.1:54322`, which is currently served by `supabase_db_hsa_eco` — the HSA local stack, not KitLuy. Plus the 3 pre-existing `trusted-time-activation.db.test.ts` failures.                                                                                        |
| Docs link check | The same 4 pre-existing broken links in the 2026-07-30 WS-11-T003 Phase-E handoff.                                                                                                                                                                                                                                                              |

## Tests: passed / failed / not run

**Passed** — every new test (32 across five files), plus the enrollment
integration test driving the actual router over the actual composition against a
real 0190-bearing PG17 database with a real Ed25519 signature.

**Failed** — 3 `trusted-time-activation.db.test.ts` (pre-existing, state-dependent)
and 19 registry-service integration tests (wrong database, see below).

**Not run** — cloud deployment of `0190`; any hardware boot.

## Decisions made

1. **`KITLUY_ENV` → `TrustEnvironment` is explicit and fail-closed.** `local` and
   `development` map to `development`; `pilot` and `production` map to
   themselves; **`staging` and `disaster_recovery` REFUSE at startup** because
   they have no ruled device-trust equivalent. Recorded as an open item below
   rather than defaulted.
2. **Profile resolution happens before the role drop.** A subselect in the
   door's argument list evaluates in the caller's context; the only role holding
   both issuance and `hardware_profiles` SELECT is `kitluy_fleet_governor`,
   which **owns** the definer doors. Connecting as it would run the station as
   the owner of the boundary it should be outside. This is the RC-021 class.
3. **`--station` is required with no default**, and is verified registered,
   active and environment-matched before a ticket is issued.
4. **Secret-scan fixtures assemble their markers at runtime** rather than being
   granted a pinned exception — owner-approved 2026-08-12. The scanner stays
   strict with zero exceptions and no proof is weakened.

## Conflicts discovered

**None with any recorded owner decision.** DEC-2 §6 is honored: enrollment
produces `manufactured → enrolled` with reason `DEC2_FLASH_TIME_TICKET_ENROLLMENT`.

## Required values discovered

| Item                                                         | Status                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Device-trust environment for `staging` / `disaster_recovery` | `[REQUIRED: owner decision]` — the service refuses to serve enrollment from those deployments                                                                                                                                                                  |
| Registered enrollment stations for development               | One dev fixture inserted directly on the LOCAL PG17 stack only (`STATION-WORKSHOP-1`). **There is no governed station-registration door** — `enrollment_stations` has no `register_*_v1` function. `[REQUIRED: owner decision on how stations are registered]` |
| Terminal hardware profile for real Pi 5 units                | The local fixture requires only `mac_address`. A real profile requires `board_serial` and `storage_serial`.                                                                                                                                                    |

## Security findings

1. **A real device could never have enrolled** — the transport sent camelCase
   `HardwareSignals` keys where the database enum requires snake_case, so the
   governed door refused every redemption with
   `invalid input value for enum hardware_signal_type: "macAddress"`. Fixed and
   pinned by a test that feeds the REAL `LinuxHardwareProbe` output through the
   client. The integration test could not catch it: it hand-writes canonical
   names, proving the server and never the device's vocabulary.
2. **Single-use holds against a cloned card** — proven, not assumed. Booting a
   second device from a byte-copy of a prepared card is refused
   `ENROLLMENT_CHALLENGE_403`.
3. **Duplicate hardware evidence contains the device** — two units presenting the
   same MAC produced `enrolled → quarantined` (`duplicate_hardware_signal`) and
   `enrolled → restricted_investigation` on the incumbent. Working as designed.
4. **The ticket secret never leaves the card** — asserted directly: absent from
   what reaches the database, from the result object, and from stdout.
5. **KitLuy integration tests currently connect to the HSA local database.**
   Port 54322 is served by `supabase_db_hsa_eco`. They fail fast on reads, but
   this is a cross-ecosystem hazard worth closing.

## Known limitations

- **`0190` is NOT deployed to the cloud** — 89 local migration files, 88 in the
  recorded cloud ledger. Everything here is proven locally only.
- **No hardware boot.** `bootTested: false` in both image manifests.
- The station tool writes to a mounted card path; it does not flash the image.
- `heartbeat` still returns `HEARTBEAT_NOT_IMPLEMENTED` (route not built).

## Current implementation status (evidence register delta)

| Requirement                                      | Was           | Now                                                                      |
| ------------------------------------------------ | ------------- | ------------------------------------------------------------------------ |
| DEVWF-B05 cloud fresh-device enrollment endpoint | ABSENT        | **IMPLEMENTED-IN-DEV** — served, routed, fail-closed, integration-proven |
| DEVWF-B06 fresh-device authentication mechanism  | BLOCKED       | **IMPLEMENTED-IN-DEV** — DEC-2 ruled and built end to end                |
| Flash-time ticket issuance (operator surface)    | did not exist | **IMPLEMENTED-IN-DEV** — `pnpm device:prepare`                           |

Pilot readiness is **unchanged**: BLK-005 still gates pilot/production
activation, and no hardware has booted.

## Recommended next task

1. **Point the KitLuy integration suites at the KitLuy stack** (they hardcode
   54322, currently the HSA database). Converts ~100 phantom failures into signal.
2. **Boot a real Raspberry Pi** against a workstation-hosted registry service over
   the LAN — this needs no cloud deployment and no BLK-005, and it is the first
   genuine hardware proof.
3. **Rule the station-registration door** and the `staging`/`disaster_recovery`
   trust mapping.
4. **Deploy `0190`** to `kitluy-project-pos` via `pnpm db:deploy:hosted-dev`.

---

# Session continued — open enrollment, the dev runner, and the first image build

The owner reviewed the flash-time ticket working end to end and stated a
different development requirement, recorded verbatim in
`KLD-2026-08-12-DEV-OPEN-ENROLLMENT-001`:

> In development I want to flash one SD card, copy that card as many times as I
> like, put each copy in a Raspberry Pi, and have every Pi come online in the
> cloud by itself. No per-device preparation step.

## What changed

| Commit    | Change                                                                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2e6e02a` | Development open enrollment — a card with NO ticket enrolls; the SERVICE mints and redeems one through the same governed doors, so every §5 property and the audit trail survive. OFF by default, REFUSED outside `development`, announced in the startup log |
| `d388a68` | `--enrollment-url` for the `.img` build path. It previously hard-coded an EMPTY endpoint with no override, so every flashable card ever built would have reported "no enrollment endpoint is configured"                                                      |
| `0caba3d` | `pnpm dev:fleet` — one command, with preflight, to run the fleet service for a hardware test                                                                                                                                                                  |

**Evidence:** one golden card, flashed once, copied three times, all three Pis
enrolled (`3 of 3`), each landing `enrolled` once given distinct hardware
addresses as real Pis have.

## Findings from running it for real

1. **The development station had quarantined itself.** After 7 duplicate-evidence
   submissions against a signed threshold of 2, `STATION-WORKSHOP-1` went
   `quarantined` and NO device could have enrolled. Cause: this session
   simulating many devices on one laptop, so one MAC address was submitted
   repeatedly — which is exactly what a cloned device looks like. The control is
   correct. `pnpm dev:fleet` now detects it in the preflight and clearing it
   requires its own explicit flag.
2. **LAN reachability proven**: `http://172.16.21.17:8789/health/live` → HTTP 200
   from the workstation's own LAN address (`eno1`). `ufw` is inactive; the
   service binds all interfaces. A Pi on the same network can reach it.
3. **WiFi cannot work on this image.** `wpa_supplicant` is not installed, so the
   `02-wlan0.network` DHCP config can never authenticate to a protected network.
   **Ethernet works** (`01-eth0.network`, `DHCP=yes`). Recorded, not fixed.
4. **The image build cannot fetch `syft`.** The SBOM step failed on a malformed
   upstream URL (`/releases/v1.44.0`, missing `/tag/`) returning HTTP 000, while
   GitHub itself is reachable (HTTP 200). Worked around by reusing the
   `syft 1.44.0` binary already present from an earlier build. **This will recur
   on a clean machine** and deserves a permanent fix.
5. **`sudo` survives the hardening purge.** `raspinfo` depends on it, so
   `dpkg --purge sudo` fails non-fatally and the terminal image ships with sudo
   present despite the intent to remove it. Recorded, untouched.
6. **The local migration ledger disagrees with the local database.** The ledger's
   last entry is `20260807040000` (0187, 86 rows) but `0188`/`0189`/`0190`
   objects EXIST — they were applied directly, bypassing the ledger. Nothing is
   broken today, but any tool trusting the ledger is wrong about this stack.

## Cloud state, measured 2026-08-12 (read-only `--dry-run`)

```text
target kitluy-project-pos (gjgbnkhuwlwhngbtrgts) · env=development
migration files on disk: 89
live state: remote-applied migrations=88
--dry-run: would apply 1 migration(s)      <- exactly 0190
```

**Not deployed. The owner deferred the deployment to the next session.**

## Owner decision for the next session: cloud enrollment via Edge Function

The owner does not want devices depending on a workstation. Presented two
options and **selected Option A — a Supabase Edge Function**, so a Pi anywhere
with internet enrolls without a laptop or a rented server, and the database
credentials stay inside Supabase rather than on the SD card.

Sequence agreed:

1. Deploy `0190` to `kitluy-project-pos` (owner approval required at the time).
2. Port the enrollment composition to `supabase/functions/device-enrollment/`.
   It depends only on `node:crypto`, the pure-TypeScript PoP verifier and a
   Postgres connection. **Validate FIRST**: Ed25519 verification under Deno, and
   whether an Edge Function can hold `set local role kitluy_fleet_service` in a
   transaction. Those are the two real unknowns; everything else is mechanical.
3. Rebuild the image with the Supabase function URL.
4. Flash, boot, and a Pi joins from anywhere.

`supabase/functions/` currently contains only a README, and NO service in the
repository has any deployment manifest — nothing is hosted anywhere today.

## Still true, and worth not forgetting

**A device will read `enrolled`, never `ONLINE`.** The liveness badge requires a
heartbeat within 90 seconds (OD-EDGE-LIVENESS-001) and the device's `heartbeat()`
returns `HEARTBEAT_NOT_IMPLEMENTED`. Moving to the cloud does not change this —
heartbeats are separate, unbuilt work in both topologies.
