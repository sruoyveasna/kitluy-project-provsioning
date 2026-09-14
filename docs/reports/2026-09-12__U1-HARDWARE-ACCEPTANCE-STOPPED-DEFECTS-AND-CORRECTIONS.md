# U1 hardware acceptance — STOPPED at bootstrap. Four defects, all corrected, all requiring a reflash

**Date:** 2026-09-12
**Branch:** `claude/fix-firstboot-esm-and-ssh-hostkeys`
**Board:** Pi Terminal `KL-1054DD1CCC8E` / `pi5-tueynu` / `172.16.29.72`
**Status claim:** **NOT HARDWARE VERIFIED.** Acceptance A/B/C/D did not run.

---

## 1. The headline

The reflash succeeded. The board is running the IMAGE VERIFIED artifact. It
registered, paired, and drew its screen.

**And it could never have installed a release, nor even activated.** Four
independent faults, any one of which alone stops acceptance:

| #   | Defect                                                 | What it stopped                                    |
| --- | ------------------------------------------------------ | -------------------------------------------------- |
| 1   | `ReadWritePaths=` named a directory nothing creates    | the update agent never ran, on any boot            |
| 2   | the baked release source pointed at the management API | Test A would have read a scaffold 404              |
| 3   | no `KITLUY_ENROLLMENT_BASE_URL` was baked              | no operational certificate — never reaches SERVING |
| 4   | `UMask=0077` silently masked a deliberate `0644`       | the Device Shell could not read the edge status    |

Defects 1 and 2 were found by acceptance. **Defects 3 and 4 were found while
preparing the corrected image, before the card was written** — each would
otherwise have cost its own flash.

All four are corrected in source. All four live in places only a new image can
change.

---

## 2. What was proven on the physical board

| Claim                                       | Evidence                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The board runs the NEW image                | `/usr/lib/kitluy/lib/firstboot-agent/release-runtime.js` exists on the read-only rootfs — the file that fixed the ignition gap, absent from build `e06e3c62…` |
| The release source was baked                | `/etc/kitluy/release.env` → `KITLUY_RELEASE_SOURCE=http://172.16.21.17:8790`                                                                                  |
| The trust anchor was baked                  | `/etc/kitluy/trust/release-signing.json`, `purpose=release_signing`, `environment=development`, `state=current`, `keyVersion=1`, no private material          |
| The rootfs is EROFS read-only               | `findmnt /` → `erofs ro`; `touch /etc/...` → `Read-only file system`                                                                                          |
| Fallback visibility works (req. D, partial) | witness `{"source":"IMAGE_FALLBACK","app":"/usr/lib/kitluy/lib/device-shell"}`, and the journal line `starting Device Shell from IMAGE_FALLBACK`              |
| The device reaches the release source       | from the board: `/health` → `200`, `/release/v1/assignment?device=KL-1054DD1CCC8E` → `200 {"assignment":null}`, unknown device → `404`                        |

### 2.1 Two readings that looked wrong and were not

**The asset tag did not change, and that is correct.** A fresh card mints a new
registration key, so the derived tag should change — but registration contract
§9 says the server never renames a board it already knows, and commit `515202b`
("a re-flashed device can be recovered, not just refused") implements exactly
that. The evidence is in the installation generations:

```
gen 1 | superseded | first 09-11 01:21:14 | superseded 09-12 01:58:03
gen 2 | current    | first 09-12 01:58:03 | -
```

Generation 2 opened at 01:58:03 UTC = 08:58:03 +07, matching the boot at
08:57:50. The re-flash recovery path ran and worked.

**The journal appears to span two days in one boot.** `journalctl --list-boots`
shows a single boot ID from "Sep 11 17:31:04" to "Sep 12 09:21:16". The board
boots with no valid clock, stamps early entries near the image build time, then
authenticated time sync jumps it forward mid-boot. The restart counter confirms
the real boot time: 8 restarts × `RestartSec=120s` = 16 minutes, consistent with
08:57:50 today.

---

## 3. Defect 1 — the update agent never ran, on any boot

```
kitluy-update-agent.service: Failed to set up mount namespacing:
  /run/systemd/unit-root/persistent/shared/kitluy: No such file or directory
kitluy-update-agent.service: Failed at step NAMESPACE spawning /usr/lib/kitluy/update-agent
Main process exited, code=exited, status=226/NAMESPACE
NRestarts=8
```

### Root cause

The unit declares:

```
ReadWritePaths=/var/lib/kitluy/update /persistent/shared/kitluy
```

systemd requires every `ReadWritePaths=` entry to **exist** when it builds the
unit's mount namespace. Nothing creates `/persistent/shared/kitluy`:

- It is deliberately **not** a declared slot-shared path. Those are rsynced from
  the image on every boot by `persistent-shared-init`, which would restore image
  content over whatever a device had installed — the reason the store was kept
  out of that mechanism in the first place.
- So no generator, and no seeding step, ever makes it.
- The image ships nothing there, by design and by gate.

On a fresh card the directory is absent, and **declaring it writable is what made
the unit unstartable.** The agent restarted every 120 s forever while the rest of
the device looked perfectly healthy.

### Why nothing caught it

- `build-gates.test.sh` asserted the path was **declared** writable. It was. That
  gate passed on a fatally broken unit.
- Unit tests call `runInstallPass` directly; they never construct the sandbox.
- `image-contents.test.sh` inspects the built **rootfs**; `/persistent` is a
  runtime mount on a separate partition, so it is not visible there.

This is the same shape as the ignition gap found before the first flash: every
test exercised the code, and nothing exercised the thing that starts it.

### The correction

In `kitluy-base.rootfs-overlay/etc/systemd/system/kitluy-update-agent.service`:

```
RequiresMountsFor=/persistent/shared
ExecStartPre=+/usr/bin/install -d -m 0755 -o root -g root /persistent/shared/kitluy
```

- `+` runs the command **outside** the sandbox. That is the whole point: the
  directory that must be created is the one whose absence stops the sandbox
  forming. The same idiom is already house style in `kitluy-device-shell.service`.
- `0755` because the Device Shell runs as `kitluy-terminal` and must traverse the
  store to reach an installed payload.
- `RequiresMountsFor=` orders the unit after `persistent.mount`, so the create
  cannot land on the read-only root instead.

`systemd-analyze verify` reports no complaint about the unit.

### The gate that now exists

Two new gates in `build-gates.test.sh`. The first walks every `ReadWritePaths=`
entry under `/persistent/` and requires a matching `ExecStartPre=+` that creates
it; the second requires `RequiresMountsFor=/persistent`.

Mutation-tested — each defect reintroduced separately, and each caught:

| Mutation                                              | Result                  |
| ----------------------------------------------------- | ----------------------- |
| remove the `ExecStartPre` (the exact shipped defect)  | **FAIL** (58/1)         |
| keep the mkdir, drop the `+` (sandboxed, cannot work) | **FAIL** (58/1)         |
| drop `RequiresMountsFor`                              | **FAIL** (58/1)         |
| restored                                              | **59 passed, 0 failed** |

---

## 4. Defect 2 — the baked release source points at the wrong service

The image bakes `http://172.16.21.17:8790`. From the board that address answers
in 14 ms — with this:

```
{"error":{"code":"RESOURCE_NOT_FOUND",
  "message":"No such route. Business contracts are not implemented in this scaffold."}}
```

That is the **management API's** scaffold 404, not the release service's
`{"error":"no such route"}`. Port 8790 is held by the management API
(`PORT=8790`, pid 3288273), which the Admin Portal depends on. The release
service was not running at all, and `release-service.mjs` **defaults to 8790** —
so it could never have bound alongside it.

This defect is mine: I chose a port already in use.

**Reachable and correct are different questions.** The precondition check the
agent performs would have passed, and Test A would have failed on a confusing
response from an unrelated service.

### The correction

- `release-service.mjs` now defaults to **8791**, with the reason recorded in
  the source.
- It refuses to start on a busy port with a message naming the consequence,
  rather than an anonymous `EADDRINUSE` stack:

```
REFUSED: port 8790 is already in use by another process.
  A device pointed at this port would reach THAT service and receive its
  responses, not a governed assignment. Free the port or pass --port.
```

- The rebuilt image bakes `http://172.16.21.17:8791`.

Verified after the change, from the physical board: `/health` → `200`,
`/release/v1/assignment?device=KL-1054DD1CCC8E` → `200 {"assignment":null}`,
unknown device → `404 unknown device on this target`.

---

## 4b. Defect 3 — the terminal could never obtain an operational certificate

`kitluy-operational-tls` logged this every 30 seconds, for ever:

```
[operational-tls] waiting: no KITLUY_ENROLLMENT_BASE_URL in /etc/kitluy/image.env
```

and `/etc/kitluy/image.env` carried `KITLUY_ENROLLMENT_BASE_URL=` — empty. With
no certificate, `kitluy-terminal-edge` stays `NOT_ACTIVATED`:

```
[terminal-edge] NOT_ACTIVATED: no operational certificate yet
  (no operational material at /var/lib/kitluy/operational/operational-tls.crt.pem)
```

The board therefore **can never reach SERVING** — the owner's bootstrap item 6
would have been unreachable on a card that registered, paired and drew its
screen normally.

### Root cause

I built without `--enrollment-url`, because the builder's own help said:

> Retained for the Store Hub's fleet service; a terminal registers through
> `--registration-url`.

That stopped being true at commit `f6fe6c8` ("a Pi Terminal can obtain its
operational certificate"). The documentation drifted from the code, and the
stale line is what made the flag look optional. The value required is the
**fleet service** origin that serves `/v1/operational-certificate` —
`http://172.16.21.17:8787`, verified answering `422` rather than `404`.

### The correction

- The builder now **REFUSES** a build without it, beside the other three
  inert-image checks. Verified by omitting the flag:

```
REFUSED: this image would be inert on the bench.
  missing: --enrollment-url  (no operational certificate: terminal-edge stays NOT_ACTIVATED, never SERVING)
exit: 2
```

- The stale comment and usage text are corrected, stating what the value is and
  what its absence costs.
- `image-contents.test.sh` gained a second-wall gate asserting the built rootfs
  states a non-empty enrollment origin — because the builder has a documented
  escape hatch, and the image is what gets flashed.

This is the same failure mode the builder already records from 2026-09-10
("two SD cards were flashed, and the boards booted and sat there"), recurring
for a value that was not yet on the list.

---

## 4c. Defect 4 — a deliberate 0644 arrived as 0600 on every device

`edge-session.ts` writes the terminal's status file with an explicit mode, and
says why:

```ts
// 0644: the Device Shell runs as a different user and must be able to read
// it. Nothing here is a secret — a phase, a fingerprint and a sentence.
atomicWriteJson(statusPath, status, 0o644);
```

On the board it is `-rw------- root root`.

### Root cause

`atomicWriteJson` uses `writeFileSync(temp, data, { mode })`, and **that mode is
masked by the process umask**. `kitluy-terminal-edge.service` sets `UMask=0077`,
so `0644 & ~0077` = `0600`.

Consequences, both silent:

- the **Device Shell** — which runs as `kitluy-terminal` and exists to display
  that phase — could not read it;
- **acceptance tooling** (`verify-terminal.mjs --ssh`) read `{}` and reported
  "the terminal is still SERVING its Store Hub" as `unreported`: a false failure
  on every future acceptance run.

Asking for a mode and not getting it is worse than not asking, because the
intent is stated at the call site and nobody re-checks the result.

### The correction

`chmodSync(temp, mode)` before the rename — `chmod(2)` is not subject to the
umask, and applying it to the temp file means the name is never briefly visible
at the wrong mode. The unit's `UMask=0077` is left alone deliberately: the same
function writes `last-hub-endpoint.json` at `0600`, which should stay that way.

### The test that now exists

The defect is **invisible under the default umask** — `0644 & ~0022` is still
`0644` — so the test sets `process.umask(0o077)` itself, and asserts the
resulting mode. Mutation-tested by removing the `chmodSync`:

```
AssertionError: expected '600' to be '644'
Tests  1 failed | 17 passed (18)
```

restored: **18 passed**.

---

## 5. Does the correction require another image build and reflash?

**Yes — a build and a reflash, and there is no alternative that is not a bypass.**

| Path                        | Why it is not available                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit the unit on the device | `/etc` is EROFS read-only — `touch` returns `Read-only file system`                                                                         |
| systemd drop-in             | would need `/etc/systemd/system/kitluy-update-agent.service.d`; same read-only filesystem. `/run` is writable but does not survive a reboot |
| Slot-shared escape          | only `/etc/ssh` and `/etc/wpa_supplicant` are declared; `/etc` as a whole is not                                                            |
| A/B system OTA              | that is **U5**, not built, and explicitly out of U1 scope                                                                                   |
| SSH file replacement        | forbidden by owner instruction; SSH is diagnosis only                                                                                       |

This is the bootstrap problem in its purest form: the component that would
deliver an OTA is the component that is broken. U1's first working agent must
arrive on a flashed image.

The release-source port alone **could** have been fixed without a reflash, via
the persistent override at `/persistent/shared/kitluy/release-source.env` — that
mechanism exists precisely for this. But the override lives _inside the directory
that defect 1 prevents from existing_, and a reflash is required regardless, so
the correct default is baked rather than shipped knowingly wrong.

---

## 6. Collateral findings

1. **The same SD card was re-flashed.** Both installation generations report
   `storageSerial 0xd4b64a26` and `storageModel sh32g`. The preference to flash a
   separate card and preserve the known-good one was not met — **there is
   currently no fallback card.** Owner has restated the preference for the second
   flash.
2. **Documentation drift caused defect 3.** The builder's help described the
   enrollment flag as unused by terminals; that ceased to be true at `f6fe6c8`.
   The text is corrected and the absence is now a refusal, so the next reader
   cannot be misled the same way.
3. **A 9-day-old orphaned `catatonit` (pid 160477) held mount namespaces** over
   the build tree, surviving with zero podman containers behind it. It made the
   first rebuild fail with `PermissionError: [Errno 13] ... 'warn_count'` and
   made the corrupted chroot unremovable (`Device or resource busy` on
   `/dev/urandom`). Cleared. Worth knowing: a killed image build can leave one,
   and the symptom names neither the cause nor the holder.
4. **Dangling `.wants` symlinks in the Store Hub image tree** —
   `kitluy-hub-base.rootfs-overlay/etc/systemd/system/multi-user.target.wants/`
   points at five units absent from that overlay. Pre-existing (committed in
   `68e0249`), untouched, out of U1 scope.
5. **The agent suite is intermittently flaky under full-suite parallelism.**
   Across runs: 1 failed, then 2 failed, then clean, then clean. Failures differ
   between runs and pass in isolation — shared dev-database contention between
   test files. Not caused by this work.
6. **Only one unit in either image tree** declares a writable path under
   `/persistent` — the one corrected here. Defect 1's class has no other instance.
7. **`pi` cannot sudo on the previous image** (not in the `sudo` group; created
   with `--disabled-password`, so no password exists to type). The §8
   release-source override writes a root-owned file and was therefore
   impossible. Owner authorised `KITLUY_DEV_SUDO=1` for the acceptance image —
   the builder's documented development-only flag, refused for pilot/production
   by design.

---

## 7. Verification

| Check                        | Result                                                                      |
| ---------------------------- | --------------------------------------------------------------------------- |
| `build-gates.test.sh`        | **59 passed, 0 failed** (was 57; +2 new gates)                              |
| `systemd-runtime.test.sh`    | **215 passed, 0 failed** — matches baseline                                 |
| `environment-gating.test.sh` | **20 passed, 0 failed** — matches baseline                                  |
| `rpi-image-gen.test.sh`      | **29 passed, 0 failed** — matches baseline                                  |
| `image-contents.test.sh`     | 106/106 before; **+1 enrollment-origin gate**, re-run against the new image |
| `release:pack:check`         | **14/14**                                                                   |
| `release:chain:check`        | **31/31**                                                                   |
| agent suite                  | **749 passed, 0 failed** (748 baseline + the new umask test)                |
| package typecheck            | **clean**                                                                   |
| repo lint                    | **2 errors — exactly the pre-existing baseline**, none in changed files     |
| `pnpm secret:scan`           | **PASS** (2161 tracked files)                                               |
| `systemd-analyze verify`     | no complaint about the corrected unit                                       |

**Mutation tests** (a gate that cannot fail proves nothing):

| Reintroduced defect                      | Caught by                                |
| ---------------------------------------- | ---------------------------------------- |
| remove `ExecStartPre` creating the store | build gate — FAIL 58/1                   |
| keep the mkdir, drop the `+`             | build gate — FAIL 58/1                   |
| drop `RequiresMountsFor`                 | build gate — FAIL 58/1                   |
| omit `--enrollment-url`                  | builder REFUSES, exit 2                  |
| remove `chmodSync`                       | unit test — `expected '600' to be '644'` |
| release service on a busy port           | REFUSED, naming the consequence          |

**Cleanup:** the chain check's three synthetic `0.0.0-chain-*` releases were
withdrawn via `revoke_release_v1` with distinct requester/approver. The authority
holds 0 internal / 26 revoked, and `current_device_assignment_v1` returns
**NULL** for the terminal — no installable assignment, as the fail-closed reader
should.

---

## 8. Files changed since IMAGE VERIFIED

```
infra/kitluy-os-image/rpi-image-gen/layer/kitluy-base.rootfs-overlay/
  etc/systemd/system/kitluy-update-agent.service   RequiresMountsFor + ExecStartPre  (defect 1)
infra/kitluy-os-image/scripts/build-rpi-image.sh   --enrollment-url required; stale text corrected (defect 3)
infra/kitluy-os-image/test/build-gates.test.sh     +2 gates, mutation-tested        (defect 1)
infra/kitluy-os-image/test/image-contents.test.sh  +1 enrollment-origin gate        (defect 3)
scripts/development/release-service.mjs            default port 8791 + EADDRINUSE refusal (defect 2)
services/kitluy-device-firstboot-agent/
  src/edge-session.ts                              chmodSync before rename          (defect 4)
  test/terminal-edge.test.ts                       umask-restrictive mode test      (defect 4)
docs/reports/2026-09-11__U1-HARDWARE-ACCEPTANCE-RUNBOOK.md   port 8791; §8 needs no mkdir
```

No migration changed. Nothing committed or pushed.

---

## 9. The acceptance image

Built with every correction and the owner-authorised development sudo:

```
--profile pi-terminal --environment development
--registration-url http://172.16.21.17:54371/functions/v1/device-registration
--enrollment-url   http://172.16.21.17:8787
--release-source   http://172.16.21.17:8791
--hardware-profile-key KL-PI5-TERMINAL-DEV
KITLUY_DEV_SUDO=1          (development only; refused for pilot/production)
```

SHA-256 and the pre-flash confirmations are recorded in the follow-up section
once the build completes.

---

## 9b. BLOCKER, outside U1 — a re-flashed board cannot obtain an operational certificate

This is **not** caused by the U1 work and cannot be fixed by the image. It is
recorded here because it will stop the owner's bootstrap item 6
("Terminal is paired/activated/SERVING") after the next flash.

### What is happening now

The **Store Hub** is refusing to serve terminals, and has been for 23 hours:

```
"Store Hub will NOT serve terminals"
refusal: KLUY-HUB-TLS-MISSING
detail:  configured certificate material does not exist:
         /var/lib/kitluy/operational/operational-tls.{key,crt,chain}.pem
```

It exits `0/SUCCESS` deliberately, and its `Restart=on-failure` therefore never
retries. Port 7443 is refused while mDNS still advertises it —
`_kitluy-edge._tcp` at `172.16.13.204:7443`.

The Hub asks for a certificate every 30 s and is refused every time:

```
OPCERT_KEY_REGISTRATION_REFUSED
KLUY-KEY-GENERATION-TAKEN: generation 1 already holds a different key for this device
```

### Why, exactly

`register_generation_key_v1` binds **one key per generation, permanently** — and
rightly so: a device that could re-register generation 1 under a new key could
silently replace its own identity.

Both boards already hold an **issued** credential at generation 1:

```
KL-1054DD1CCC8E | device_identity | gen 1 | active | fp 4b98acbb51b6ac43 | 09-11 01:33
KL-97A30575BCB7 | device_identity | gen 1 | active | fp 24192a639930df54 | 09-11 01:23
```

Re-flashing destroyed the **private halves**. Each board now generates a new key
and asks to register it at generation 1; the fingerprint differs; the binding
refuses. The operational-certificate flow registers under
`purpose: "device_identity"` at `request.assignmentGeneration`, so this is the
slot in question.

### The terminal is in the identical state

Its generation-1 key is `active` with a fingerprint from the **previous card**.
It has not hit the refusal yet only because defect 3 meant it never asked —
`KITLUY_ENROLLMENT_BASE_URL` was empty, so `operational-tls` never made a
request. **Once the corrected image supplies that URL, the terminal will ask and
be refused exactly as the Hub is.** The Hub is the terminal's future, already
arrived.

### What it does and does not block

| Bootstrap item                       | Effect                                                                      |
| ------------------------------------ | --------------------------------------------------------------------------- |
| 1 `/persistent` mounted              | unaffected                                                                  |
| 2 `/persistent/shared/kitluy` exists | unaffected                                                                  |
| 3 update agent active                | unaffected                                                                  |
| 4 `:8791` correct service            | unaffected                                                                  |
| 5 release trust loads                | unaffected                                                                  |
| 6 paired/activated/**SERVING**       | **BLOCKED** — no operational certificate, and the Hub is not serving either |
| 7 no assignment outstanding          | unaffected                                                                  |

The OTA mechanism itself does not depend on the Store Hub: the health gate
probes `systemctl is-active kitluy-device-shell.service`, and releases arrive
from the release source. So A/B/C/D can demonstrate install, rollback, power-cut
recovery and tamper refusal — but their "**and the terminal is still SERVING**"
clause cannot be satisfied while this stands.

### The governed remedy was attempted, and correctly refused

Owner authorised `abandon_generation_key_v1` for both boards. The door
**refused**, and it was right to:

```
KLUY-KEY-ABANDON-REFUSED: generation 1 already carries a certificate artifact;
                          abandoning it would replace a live identity
```

Group 0205 wrote that door for an issuance that **failed** and left the slot
spent on a key whose certificate never existed. Here issuance **succeeded** —
the certificate exists and is live — and only the private half was destroyed.
The refusal is the control working as designed. No credential was changed.

### The actual root cause — a hardcoded generation

`services/kitluy-device-registry-service/src/first-operational-issuance.ts:547`

```sql
select kitluy_devices.register_generation_key_v1(
          $1::uuid, $2::text, 'device_identity', 1, $3::text, $4::text, $5::text)
```

The generation is the **literal `1`**. The governed credential immediately below
is issued at `request.assignmentGeneration`, so the two disagree: the credential
follows the device's generation while the key is always bound at generation 1.

Consequence: **no requested generation can avoid the collision.** A board whose
generation-1 key was destroyed by a re-flash can never obtain a new operational
certificate through this path.

Proven, not inferred. The device's own override
(`KITLUY_ASSIGNMENT_GENERATION`, which the code comment offers precisely for a
Hub) was applied to the Store Hub as a **runtime-only** drop-in under `/run`,
and confirmed present in the process environment:

```
KITLUY_ASSIGNMENT_GENERATION=2
```

The refusal did not change — still `generation 1 already holds a different key`.
The override was then removed and the Hub returned to its prior state.

### Why this is a design gap, not a typo

The module's authority note is explicit: this composition is deliberately "the
same shape at generation 1", for the first certificate a device ever receives,
and `prepare_…_issuance_v1` "allocates generation 1 explicitly when the device
has no credential head yet". Generation N+1 belongs to the renewal
compositions.

A re-flashed board is **neither case**:

- not _first issuance_ — it already has a credential head;
- not a _renewal_ — renewal proves possession of the previous key, and that key
  went with the card.

The hardcoded `1` is therefore correct **for the path it is on**. The fault is
that a re-flashed board is sent down that path at all. Nothing routes it to the
rotate-key renewal that exists for precisely this shape:

```
reserve_device_credential_renewal_v1
  -> prepare_device_credential_renewal_v1 / _v2
  -> register_generation_key_v2(p_renewal_attempt_id, key…)   -- advances the head
```

This is the same SD-card-failure path that `515202b` closed for **pairing**
("in a shop it strands the Store"), left open for **operational credentials**.

### Every route around it is closed, by design

Asked whether the database could simply be reset, three routes were examined.
All are shut, and each refusal is the system working correctly:

| Route                                          | Outcome                                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:reset`                                | Targets `supabase_db_kitluy-**local**`. The hardware stack is `kitluy-**fresh**` (`:54372`). It would reset an uninvolved stack and leave the blocker untouched.       |
| `abandon_generation_key_v1` (owner-authorised) | `KLUY-KEY-ABANDON-REFUSED: generation 1 already carries a certificate artifact; abandoning it would replace a live identity`                                           |
| Deleting the blocking rows directly            | `KLUY-CRED-HEAD-IMMUTABLE: a generation head is advanced, never deleted` — raised by `enforce_head_authority` while holding the owning role `kitluy_credential_issuer` |

Every probe ran inside a transaction that was rolled back. Row counts before and
after are identical (2 heads / 2 credentials / 2 generation keys / 2 devices).
**No credential state was changed.**

The third refusal states the remedy in its own words: a head is **advanced**.
That is what the rotate-key renewal path does, and what nothing currently calls
for a board that lost its key.

There is also no sanctioned reset path for `kitluy-fresh`: wiping it manually
would mean re-applying 121 migrations, re-creating the fixtures that carry
`KL-PI5-TERMINAL-DEV`, and re-registering the release signing key — all of which
the flashed image depends on and none of which the rootfs can be corrected for.

### What it would take

Routing the re-flash case to the rotate-key renewal path is a change inside a
governed issuance flow in `kitluy-device-registry-service`, not a one-line edit:
the key is registered (step 3) **before** `prepare_…` allocates the generation
(step 4), which is why the literal exists. Either the order changes, or the
device's requested generation drives both.

That is a real piece of work, outside U1, and a governance decision about device
identity. It is recorded here and not attempted.

### RESOLVED for this stack by an owner-ordered device-state reset

Owner instruction: reset the database so the devices run the full workflow from
scratch. Done on `kitluy-fresh` (`:54372`) only, after a full `pg_dumpall`
backup (5.8 MB, both devices present).

`TRUNCATE ... RESTART IDENTITY CASCADE` across all 82 tables of
`kitluy_devices` + `kitluy_releases`. TRUNCATE fires statement-level triggers
only, so it does not fight the row-level immutability guards — it removes the
tables' contents rather than rewriting protected rows.

Preserved (not in scope of the truncate): `kitluy_core` tenants/stores/
locations, `kitluy_auth` permissions and roles, `kitluy_config`, all 122
migrations, every function, role and policy definition.

Restored from the backup afterwards, because they are configuration rather than
device state:

```
trust_policy · renewal_policy · credential_revocation_policy
key_destruction_policy · fleet_health_policy · pki_trust_configuration
release_channels (6) · pki_pinned_trust_anchors (2)
```

Two needed their governing role (`kitluy_fleet_governor`,
`kitluy_release_governor`) because `enforce_*_governed` checks `current_user`;
`release_channels` and `fleet_health_policy` also refused `COPY` under RLS and
went in as INSERTs. The trust anchors had to go back via `COPY` — a first
attempt as generated INSERTs corrupted the PEM (`KLUY-PEM-UNDECODABLE`) because
the dump's backslash escaping was unwound in the wrong order.

Fixtures were recreated by restarting the fleet service with
`--ensure-fixtures`: station `STATION-WORKSHOP-1`, profiles
`KL-PI5-TERMINAL-DEV` and `KL-PI5-STORE-HUB-DEV`. There is no signing-key table
in the database — the release key is file-based in `dev-pki` — so the baked
trust anchor `bfccb44e…` still matches.

**Outcome.** Both boards re-enrolled as new devices with no credential head, so
first issuance is correct for them again and the collision is gone:

| Board       | Asset tag         | State                                                                   |
| ----------- | ----------------- | ----------------------------------------------------------------------- |
| Store Hub   | `KL-CFADA8C75001` | **active — "Store Hub is serving terminals"**, `7443`, mDNS advertising |
| Pi Terminal | `KL-1CB3577C26A7` | enrolled (pre-reflash identity)                                         |

The Hub's refusal walked forward at each step, which is how the remaining gaps
were found: `KLUY-KEY-GENERATION-TAKEN` → `KLUY-KEY-NO-DEVICE` (stale on-card
pairing state, cleared) → `KLUY-OPCERT-NO-TRUST-ANCHOR` (anchors restored) →
`KLUY-PEM-UNDECODABLE` (my escaping bug, fixed) → issued.

**The underlying defect is untouched.** It will return the next time any board
that already holds an operational certificate is re-flashed. It does not affect
acceptance A/B/C/D, which change no SD card between tests.

---

## 10. What remains

Acceptance A/B/C/D has **not** started.

Post-flash bootstrap proof (owner's list), before any acceptance step:

1. `/persistent` mounted
2. `/persistent/shared/kitluy` exists
3. `kitluy-update-agent.service` active (running)
4. release service `:8791` reachable **and is the release service**
5. release trust loads
6. terminal paired/activated/**SERVING**
7. no installable assignment outstanding

Instrumented as a read-only script and validated as a **negative control**
against the defective board, where it correctly failed items 2, 3, 5 and 6 and
passed 1, 4 and 7.

Then A/B/C/D with no SD-card change between them, and the §8 override exercised
once.

**HARDWARE VERIFIED will not be claimed until A/B/C/D all pass.**

---

## 11. Bootstrap proof on the corrected image (2026-09-14) — 6 of 7, stopped at item 6

Image `6ea367bd…`, board `pi5-unljtj` / `KL-1CB3577C26A7`.

| #   | Item                               | Result                                           |
| --- | ---------------------------------- | ------------------------------------------------ |
| 1   | `/persistent` mounted              | PASS `/dev/mmcblk0p6 ext4`                       |
| 2   | `/persistent/shared/kitluy` exists | **PASS** `drwxr-xr-x root:root` — defect 1 fixed |
| 3   | update agent active                | **PASS** `active`, **0 restarts**                |
| 4   | `:8791` is the release service     | PASS `HTTP 200`                                  |
| 5   | release trust loads                | PASS `trustedKeys=1`                             |
| 6   | paired / activated / SERVING       | **STOPPED — `DEGRADED`**                         |
| 7   | no installable assignment          | PASS `NULL`                                      |

All four image defects are confirmed fixed on hardware, including
`edge-status.json` at mode **644** (was 600).

### Item 6: how far it got, and the exact failure

Pairing succeeded and the certificate was issued:

```
[operational-tls] ADOPTED: credential b89cf140… generation 1 serial DEV-B89CF140B755C24B
[terminal-edge]   DEGRADED: paired with Store Hub 549a41c6… at 172.16.13.204:7443;
                  the Hub cannot serve eligibility, configuration yet
```

Hub side, on every request:

```
edge:runtime-eligibility    503  HUB_NOT_OPERATIONAL
edge:configuration-current  503  HUB_NOT_OPERATIONAL
```

Steps completed along the way, each unblocking the next refusal:
`TERMINAL_NOT_RECOGNIZED` → terminal projection delivered;
`PAIR_PROFILE_FORBIDDEN` → development configuration published (4 grants, snapshot v2);
`PAIR_CERT_INVALID` → the Hub's self-identity re-projected. **Pairing then succeeded.**

### Root cause — and a latent defect worth recording

The cloud reset gave the Hub a NEW cloud identity (`549a41c6…`); its local
`edge_identity.hub_device` still held the pre-reset one (`c00ce1a3…`). The old
row cannot be deleted: `pairing_receipt` references it and is **append-only by
design** (`KLUY-EDGE-APPEND-ONLY`). It was therefore marked `revoked`, and the
current identity projected alongside it.

**The two Hub-side paths then disagree about which identity is "the Hub".**

`begin_terminal_pairing_v1` (hub migration 0042) selects correctly:

```sql
where h.device_kind = 'store_hub' and h.trust_status = 'trusted'
  and h.lifecycle_status = 'deployed'
order by h.created_at limit 1
```

`runtime-bootstrap.ts:189` does not filter at all:

```sql
select id, lifecycle_status, trust_status from edge_identity.hub_device
 where device_kind = 'store_hub' order by created_at limit 1
```

It takes the **oldest row unconditionally**, then rejects it — so the revoked
pre-reset identity wins and every eligibility and configuration request is
refused `HUB_NOT_OPERATIONAL`. Pairing works; serving does not.

This is latent beyond this stack: any Hub that is ever re-identified —
replacement, recovery, or a re-provisioned cloud — reaches the same state, and
the append-only receipt guarantees the old row cannot simply be removed.

### Why this stopped rather than being worked around

The available moves are all out of U1 scope or need authority:

- **re-provision the Hub's local database** — destructive to Hub state, needs owner authorization;
- **change the `runtime-bootstrap` query** to filter on trusted+deployed, matching 0042 — a real fix, but Store Hub code and a Hub image rebuild;
- **back-date the new row's `created_at`** so it sorts first — falsifies an audit timestamp; refused.

### What this does not block

A/B/C/D do not depend on the Store Hub: the health gate probes
`systemctl is-active kitluy-device-shell.service`, and releases arrive from the
release source. Install, rollback, power-cut recovery and tamper refusal can all
be demonstrated. Only the "**and the terminal is still SERVING**" clause in each
test cannot be satisfied while this stands.

---

## 12. DEFECT 5 — the device names itself to the release source by a tag the cloud may not know

Found at Test A, 2026-09-14. **Mine, in U1 code.**

### Symptom

Release `0.4.12-a` published, signed, promoted and assigned (sequence 1); the
release source serves it; the agent polls every 300 s with trust loaded and the
store present — and reports, on every pass:

```
event=kitluy.update.pass outcome="NOTHING_TO_DO" detail="no release is assigned to this device"
```

### Cause

`services/kitluy-device-firstboot-agent/src/release-runtime.ts:207`

```ts
// The device names ITSELF to the source. The asset tag is derived from the
// device's own key fingerprint, so a transport cannot talk it into asking
// about somebody else's board.
assetTag: assetTagFromFingerprint(fingerprint),
```

The security intent is sound. The **derivation** is not: the authoritative name
lives in the cloud, not in the device's local key.

```
device computes   KL-6F4E86A71516   (KL- + first 12 hex of its current key fingerprint)
cloud holds       KL-1CB3577C26A7   (kept across the re-flash, registration contract §9)

GET /release/v1/assignment?device=KL-1CB3577C26A7  -> 200, assignment
GET /release/v1/assignment?device=KL-6F4E86A71516  -> 404 "unknown device on this target"
```

The board re-registered after a flash with a NEW key. Contract §9 says the
server never renames a board it already knows, so the cloud kept the old tag
while the device now derives a different one. They agree only until the first
re-flash — and a device that has been re-flashed is exactly the device an OTA
system exists to serve.

### The correct fix

The device already holds the authoritative identifier, written by the cloud at
registration: `deviceId` in `/var/lib/kitluy/registration-state.json`
(`7a6f1e26-…`). It is local state, so it is no more spoofable by a transport
than the derived tag, and it is what the cloud actually keys on.

- device: name itself by `deviceId` rather than a locally derived tag;
- release service: accept a device id as well as an asset tag.

There is **no asset-tag override path** on the device, so the device half needs
another image build and reflash.

### What this does not explain away

Everything else in the chain worked on hardware: publish → sign → promote →
assign → assignment-sign, the release source served the signed assignment, and
the agent polled with `trustedKeys=1` and a present store. The failure is
entirely in how the device addresses itself.

### Why no gate caught it

`release:chain:check` (31/31) passes `KITLUY_DEV_TERMINAL_ASSET_TAG` explicitly
and never derives a tag from a key, so publisher and device agree by
construction. Nothing exercised a device whose cloud tag and local derivation
disagree — which only happens after a re-flash recovery.
