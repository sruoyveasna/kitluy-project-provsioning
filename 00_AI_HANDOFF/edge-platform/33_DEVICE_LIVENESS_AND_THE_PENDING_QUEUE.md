# Device liveness, and a pending board that leaves the queue when it stops answering

**Date:** 2026-09-08
**Status:** **TESTED-IN-DEV.** Migration 0216 authored and applied to both local
stacks; edge function, Management API and Admin Portal changed and tested.
**No cloud write was performed.**

---

## 1. What the owner asked for

> "in admin portal I already power off both pi but it still show on waiting
> approval. so before approval it should not be there if the pi were already
> offline and one more thing is about tracking the pi is online is still not
> working properly right now as an admin I am not able to know that is my device
> is online or offline"

and, when asked to state the rule:

> "Tracking online when only device is already approve if it is not waiting for
> approve yet or registed yet when it down just make it disappear from list."

Two requirements, both implemented:

1. **Liveness is tracked and shown**, for approved devices and for every other.
2. **A board still waiting for approval that has stopped answering leaves the
   approval queue.** It is not deleted and not marked — it is simply not listed,
   and it returns the moment it answers again.

---

## 2. Why liveness read NEVER_SEEN for every device

`device_fleet_status.last_observed_at` — the only column the freshness
projection read — is a subquery over `kitluy_devices.device_hardware_observations`,
which records **enrolment-time hardware evidence comparisons**.

    kitluy-fresh          device_hardware_observations   0 rows
                          device_health_reports          0 rows
                          device_health_projections      0 rows

Nothing writes it on a self-registering board, so it is null for every device
awaiting approval and empty on a fresh stack. Every badge therefore derived
`NEVER_SEEN`, however healthy the hardware was.

**The signal was already arriving.** `services/kitluy-device-firstboot-agent/src/bin/cloud-registration.ts`
polls the registration route every `POLL_SECONDS = 60`, for ever, and explicitly
keeps polling after approval ("An approved board still polls", line 268).
`register_device_v1` returns the **same** `device_id` on every repeat call
(its own comment: "PATHS B and C: board already known. Same device_record_id,
always"). A 60s beat against the ruled 90s ONLINE threshold is exactly the
headroom `health-reporter.ts` documents. Nothing recorded it.

> The health reporter is **not** the source. It states plainly that it "does not
> open a socket" and reports locally until the device is paired. No image change
> and no reflash is required for any of this.

---

## 3. What changed

### Migration `20260908150000_0216_device_registration_sightings.sql`

- `kitluy_devices.device_registration_sightings` — one row per device:
  `first_seen_at`, `last_seen_at`, `sighting_count`, `last_installation_id`.
  Deliberately **mutable**: this is liveness, not evidence, so it carries no
  append-only trigger and no history. RLS enabled and forced.
- `record_device_sighting_v1(uuid, uuid)` — `security definer`, granted to
  `kitluy_device_registration_service` **only**. It creates nothing, decides
  nothing, and **never raises**: a null id, or an id that is not a device, is
  silently ignored. A liveness write must not be able to turn a successful
  registration into an error the board then retries for ever.
- `device_fleet_status` gains `last_seen_at` and `sighting_count`.
  **CREATE OR REPLACE, not DROP** — `kitluy_devices.fleet_health_read` is defined
  on top of it, so a drop is refused and a cascade would silently take the
  dependent view. Replace permits appending columns only, which is exactly this
  change: 0122's body verbatim plus two columns at the end.

### `supabase/functions/device-registration/index.ts`

Calls the door in the **same transaction**, after the registration succeeded, with
the device id that call just produced — never anything a caller supplied — wrapped
in try/catch so a liveness write can never fail a registration.

### `services/kitluy-management-api/src/fleet.ts`

`lastSeenAt` and `freshness` now take the **later** of `last_observed_at` and
`last_seen_at`. Composed in the route, not in the view: `last_observed_at` has a
settled meaning group 0122 owns, and widening it in place would change that column
for every other reader.

`mostRecent` treats `undefined` like `null`. A row from a query that did not
select the column has the field *absent*, and `new Date(undefined)` is NaN, which
`deriveFreshness` reports as `UNKNOWN` — a device plainly ONLINE reading as
unknowable. An unparseable timestamp also cannot win the comparison and blank out
a good one.

### `services/kitluy-management-api/src/device-approval.ts` + `http.ts`

`PENDING_QUERY` joins the beat and filters on
`greatest(sight.last_seen_at, di.created_at)`, with the window passed in.
The fallback to the last registration means a board enrolled before sightings
existed is still judged on a real timestamp; `greatest` ignores nulls, and once
the board polls once the beat is always the later of the two.

**The window is the ruled OFFLINE threshold** (`DEVELOPMENT_OFFLINE_AFTER_SECONDS`,
300s, OD-EDGE-LIVENESS-001) — not a new number — so a device can never read
OFFLINE on the fleet page while still sitting in the approval queue. A test pins
the two together. The value is floored at 1s, because a zero window would hide a
board that answered this second.

A board with **no** liveness evidence at all (never self-registered — enrolled at
a QA station, say) has a null here and is **kept**: absence of evidence is not
evidence of absence, and hiding it would strand it with no way back.

### `apps/kitluy-admin-pwa-portal`

The pending queue shows "Last answered" (`pendingLastSeen`, EN + KM). Every board
in the list is by definition answering; this says *how recently*, which is what
makes it safe to walk over and check the board.

---

## 4. Evidence

| Check | Result |
| --- | --- |
| `@kitluy-services/kitluy-management-api` tests | **162 passed / 11 files** (was 148; +11 sightings, +3 fleet-fold) |
| `@kitluy-apps/kitluy-admin-pwa-portal` tests | **107 passed / 6 files** |
| Typecheck (both packages) | clean |
| `deno check` on the edge function under `denoland/deno:alpine-2.1.4` | **clean** (plain `tsc` cannot check a Deno function: `npm:` specifiers and `.ts` extensions) |
| `pnpm probe:device-registration` (real HTTP, repo17) | **12 passed / 0 failed** |
| `pnpm migrations:validate` | 115 files, passed |
| `pnpm secret:scan` | 2118 files, passed |

**The wire path is proven, not assumed.** Against a served instance the probe's
board registered four times across its replay and key-rotation scenarios and
produced **one** sightings row with `sighting_count = 4` and the installation
linked. The eleven *refused* scenarios (401/400/404/405) produced **no** sighting
at all — an unauthenticated caller cannot fake liveness for a device.

**Both new behaviours were mutation-tested.** Neutralising the pending filter
fails exactly 3 tests; reverting the fleet fold to `row.last_observed_at` fails
exactly 2. Tests that cannot fail would be worthless here.

The sightings suite registers real hardware, so **every test runs inside a
transaction that is rolled back** — one suite has already had to be fixed for
growing the fleet on every run.

---

## 5. Pre-existing failures NOT caused by this work

`pnpm verify` reports these; each was confirmed to predate this change.

1. **Format check** — `EACCES: permission denied, scandir .../infra/kitluy-os-image/build/work/chroot-v2.7.0/filesystem/persistent/home/pi`.
   Prettier cannot scan the rootless image build tree. It still printed
   "All matched files use Prettier code style!" and every file changed here is
   individually clean. The build tree is an artifact directory.
2. **`@kitluy/device-identity`** — 2 suites **refuse to start**; 899 tests passed
   and none failed. The guard reports `kitluy_credential_issuer is ALREADY
   granted to this login`. On repo17 `postgres` holds both
   `kitluy_credential_issuer` and `kitluy_fleet_governor` with **0 active
   backends** — a stale membership, matching the DEC-4 probe recorded in
   `32_DEC4_SELF_ESCALATION_PROBE_AND_0189.md` (which performed exactly that
   grant) and/or 0189's borrow-and-return that a crash left half-done.
   **Not cleared here:** the guard says in terms "do not revoke the membership by
   hand", and that is an owner decision, not a test-fixing one.
3. **Docs link check** — 4 broken links in
   `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__...`. Untouched.

---

## 6. Deployment note — the local stack the boards actually talk to

`supabase_edge_runtime_kitluy-fresh` does **not** serve this repository's
`supabase/functions`. It bind-mounts a **copy** under a scratchpad directory
belonging to a previous session:

    /tmp/claude-1000/.../87481d20-.../scratchpad/fresh-stack/supabase/functions

The copy was byte-identical to the repository apart from this change, and it has
been updated and the runtime restarted, so the boards get the new behaviour. But
**this is fragile**: it is under `/tmp`, it is owned by no repository, and if it
is cleared the stack stops serving. Registering the repo's own functions
directory with that stack is a follow-up worth doing.

---

## 7. Out of scope, recorded not fixed

`FreshnessPolicy` in `fleet.ts` still carries the comment "Freshness thresholds
are an owner value the repository has NOT ruled." They **were** ruled
(OD-EDGE-LIVENESS-001, 2026-08-10) and `composition.ts` applies 90/300 as
defaults. The comment is stale and misleading; it is adjacent to this change but
not part of it.

---

## 8. What is NOT claimed

- Nothing was deployed to hosted development or to cloud.
- This does not make the health reporter a network reporter. The canonical fleet
  health contract (`device_fleet.health_projection_reported`) remains the
  intended long-term liveness path; this uses the registration beat that already
  exists, and does not create a second telemetry architecture.
- 4-digit Terminal PIN remains **SPECIFIED — NOT BUILT** (owner-parked).
