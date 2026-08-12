# Pi Terminal mission — blockers and required owner decisions

**Date:** 2026-08-10
**Status:** BLOCKED — three decisions required before the mission chain can proceed.

The mission's success chain is:

    IMAGE → BOOT → FIRST-BOOT IDENTITY → CLOUD ENROLLMENT → ADMIN ONLINE
    → PAIRING CODE → STORE ASSIGNMENT → ASSIGNED TERMINAL

Link 3 (first-boot identity) is buildable today. Links 4 onward are blocked.
Each blocker below is a genuine one, verified at source, not a missing
convenience.

---

## DEC-1 — May agent executables be baked into the OS image?

**The conflict.** Mission §15 requires runtime software packaged into the
image. `infra/kitluy-os-image/rpi-image-gen/layer/kitluy-base.yaml:26-28`
records the opposite decision:

> the agent code itself is delivered by the governed release system, not baked
> here (mission §27: OS image is not an application release)

Mission §15 also says not to add packaging complexity where a canonical
installation mechanism exists — and one does
(`services/kitluy-device-release-and-update-service`, A/B app slots).

**Why it cannot be settled in code.** The two positions produce different
images, different update paths and different release-signing scope. Choosing
silently would either contradict a recorded decision or leave the units dead.

**Options**

| # | Choice | Consequence |
| - | ------ | ----------- |
| A | Bake agents into the image | Units work at first boot. Image becomes an application release; every agent change needs an image rebuild; superseded §27 must be formally retired. |
| B | Keep agents out; deliver via release system | Preserves the recorded architecture. Requires a first-release payload to exist and be installable *before* enrollment — a bootstrap ordering problem, since the update agent is itself one of the missing binaries. |
| C | Split: bake only the bootstrap set (firstboot + enrollment + update agent), deliver POS/session via release | Resolves the bootstrap ordering problem while keeping the application out of the image. **Recommended.** |

Nothing in §15 can be implemented until this is chosen.

---

## DEC-2 — What authenticates a factory-fresh Pi to a self-enrollment endpoint?

**The gap.** Mission Stage A (§3, §10, §22) — a fresh Pi enrolling with the
cloud over the internet, no Store Hub — exists at **no layer**: no HTTP route,
no SQL door, no device-scoped health path. Verified in
`26_PI_TERMINAL_RUNTIME_SOURCE_MAP.md` §4.

**The security question.** §18 forbids baking any key, certificate or secret
into the golden image. The existing governed door
`kitluy_devices.enroll_device_v1` requires `p_enrollment_station_id` and
`p_enrollment_operator_ref` — a manufacturing station and a human operator. A
field Pi has neither.

So: a generic image, no station, no pre-shared secret — **nothing identifies the
device.** Any endpoint accepting such a caller would enrol anything on the
internet that speaks the protocol.

**Options**

| # | Choice | Consequence |
| - | ------ | ----------- |
| A | Keep station enrollment; every Pi is enrolled at a station before shipping | No new security surface. Contradicts the mission's "automatic on first boot". Operationally real for a small fleet. |
| B | Per-device secret written at flash time by a KitLuy provisioning tool | Image stays generic; the *flashing step* becomes the enrollment station. Needs a flashing tool and secret custody — intersects BLK-005. |
| C | Pi 5 hardware root of trust (secure element / OTP) | Strongest. Hardware work, not currently specified; BLK-005's secure-element model is still open. |
| D | Open enrollment with server-side quarantine and manual admin approval | Fastest to build for development. Every device lands `quarantined` pending an admin decision. Acceptable for dev **only**, and must never reach Pilot. |

This decision also gates §23 (heartbeat), because a device→cloud heartbeat route
inherits whatever authentication is chosen here.

---

## DEC-3 — Deploy the (apparently already fixed) chain to the cloud project

**Status: DOWNGRADED from hard blocker. A fix exists, uncommitted, and it
appears to work.** This supersedes `14_CANONICAL_CLOUD_SUPABASE_DEPLOYMENT.md`
§3 on the technical question, though the deployment itself has still not happened.

### The original blocker

PostgreSQL 16 changed `CREATEROLE` semantics so a non-superuser with
`CREATEROLE` is auto-granted membership of roles it creates, making two
migrations mutually unsatisfiable: `0140` needs `postgres` to
`SET ROLE kitluy_job_governor` (requiring recorded membership on PG16+), while
`0151` asserts that **no** non-superuser holds membership of the credential
governor. The chain failed at migration 51/86 on PG17.

### What was found today

The working tree contains an **uncommitted fix spanning 14 migration files**,
recorded as `KLREC-2026-08-07-PG16-CREATEROLE-001`. It narrows the `0151`
assertion to ignore the un-removable PG16 auto-grant while still treating a
self-taken borrow as a finding:

    and not (r.rolname = current_user and m.grantor <> m.member)

### Evidence that it works

A local PostgreSQL **17.6** stack (`supabase_db_kitluy-repo17`, port 54392)
already carries the chain:

    server_version .............. 17.6
    kitluy schemas .............. 15
    migrations applied .......... 86   (latest 20260807040000 / 0187)

`supabase/tests/assertions.sql` was run against that PG17 database. It reached
the credential-issuance security family and **passed** it — including the
assertion that is the direct descendant of the original blocker:

> PASS ws11-issuance-function-security: … owned by the NOLOGIN
> `kitluy_credential_issuer` … **no application role is a member of the function
> owner; the migration membership was handed back** …

### What is NOT proven

The run then stopped with:

    ERROR: duplicate key value violates unique constraint
           "device_generation_keys_fingerprint_key"

That is **test-fixture collision against a dirty database**, not a chain
failure — `assertions.sql` expects a freshly reset database. A clean verdict
needs `db:reset` on a PG17 target.

Two further caveats:

- `pnpm db:test` could not be used as-is: `scripts/database/db-exec.mjs:131`
  hardcodes the container name `supabase_db_kitluy-local`, and the running
  stacks are `kitluy-repo15` / `kitluy-repo17`. The SQL was therefore invoked
  directly. Host `psql` is not installed.
- Migration `0188` (added today) is **not** among the 86 applied.
- `supabase/config.toml` still declares `major_version = 15`.

### The cloud project is still empty — verified live today

    project  het-kitluy-dev  (ref gkfcxxtryqmjnhujlkdr)
    status   ACTIVE_HEALTHY
    Postgres 17.6.1.155
    migrations applied .......... 0
    repository migrations ....... 87

**The decision required is therefore no longer "how do we fix PG17" but
"do we deploy".** Options:

| # | Choice | Consequence |
| - | ------ | ----------- |
| A | Reset a local PG17 target, get `assertions.sql` + `rls-tests.sql` fully green, then deploy to `het-kitluy-dev` | **Recommended.** Proves the fix before it touches cloud. |
| B | Deploy to `het-kitluy-dev` now | Faster; deploys 14 files of unverified uncommitted migration changes to the canonical project. |
| C | Commit the PG16 fix first | The 14 modified migration files are currently uncommitted and unbacked-up. See §M of the report. |

Whichever is chosen, DEC-3 no longer blocks DEC-1 or DEC-2, and the cloud half
of this mission is closer to reachable than the prior evidence recorded.

---

## What is buildable right now, with no decision

**First-boot identity.** `bootstrapIdentity` in
`services/kitluy-device-firstboot-agent/src/identity.ts` is implemented and
tested; it needs three production adapters (`IdentityStore`, `KeyProvider`,
`HardwareProbe`) and an executable entrypoint. Identity generation is purely
local — no cloud, no Hub, no server contract.

That work satisfies §19 in full and converts exactly one of the six dead
`ExecStart` targets into working software. It is worth doing regardless of how
DEC-1/2/3 are decided, with one caveat: under DEC-1 option B the binary would be
delivered by the release system rather than baked, which changes *where* it is
installed but not the code.

---

## Honest status against the mission's own vocabulary (§38)

| Claim               | Status                                                         |
| ------------------- | -------------------------------------------------------------- |
| IMPLEMENTED-IN-DEV  | firstboot identity logic, enrollment state machine, admin fleet read model, provisioning-code lifecycle |
| TESTED-IN-DEV       | the above, under vitest                                         |
| BUILT-IMAGE         | `v2.7.0`, DEVELOPMENT-UNSIGNED-NOT-RELEASE-ELIGIBLE             |
| CLOUD-TESTED        | **NO** — zero migrations applied to the canonical project       |
| HARDWARE-BOOT-TESTED| **NO** — `bootTested: false` in both dev manifests              |
| ADMIN ONLINE        | **NO**                                                          |
| PAIRING COMPLETE    | **NO**                                                          |
| ASSIGNED / ACTIVE   | **NO**                                                          |
