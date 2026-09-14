# U1 Phase 4 — Pi Terminal image integration, IMAGE VERIFIED

| Field      | Value                                                                                   |
| ---------- | --------------------------------------------------------------------------------------- |
| Date       | 2026-09-11 · Asia/Phnom_Penh                                                            |
| Status     | **IMAGE VERIFIED.** Not `HARDWARE VERIFIED` — no card was written, no device contacted. |
| Committed  | **No.** Nothing committed or pushed.                                                    |
| Stop point | The physical reflash has **not** happened.                                              |

---

## 1. The exact image built

```
kitluy-pos-terminal-wayland-arm64.img            8,900,333,568 bytes  sha256 e06e3c622fd503f5…
kitluy-pos-terminal-wayland-arm64.img.zst          998,642,333 bytes  sha256 8fe80f5ebfa412cc…
kitluy-pos-terminal-wayland-arm64.img.sparse.zst   999,184,919 bytes  sha256 0e3ccfe4afeb4435…
kitluy-pos-terminal-wayland-arm64-v2.7.0.tar.zst 1,500,993,439 bytes  sha256 f1f72a743178d715…
```

|                        |                                                                     |
| ---------------------- | ------------------------------------------------------------------- |
| profile / device class | `pi-terminal` / `terminal`                                          |
| architecture / board   | `arm64` / `raspberry-pi-5`                                          |
| base OS                | `debian-bookworm-arm64` (node **18.20.4**)                          |
| builder                | `rpi-image-gen v2.7.0` @ `a7b6d4806183195f3efadb533f58c8e46393d057` |
| build class            | `DEVELOPMENT-CROSS-BUILD` (QEMU, x86_64 host)                       |
| classification         | `DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED`   |

Built with:

```
--environment development
--registration-url http://172.16.21.17:54371/functions/v1/device-registration
--hardware-profile-key KL-PI5-TERMINAL-DEV
--release-source http://172.16.21.17:8790
KITLUY_DEV_PKI_DIR=../../local-config/het-kitluy-project/dev-pki
```

Baked and verified in the rootfs:

```
/etc/kitluy/release.env           KITLUY_RELEASE_SOURCE=http://172.16.21.17:8790
/etc/kitluy/trust/release-signing.json
    keyId bfccb44e064bf824…  v1  purpose release_signing  environment development
    productionEligible false · PUBLIC key only
```

The anchor was loaded **with the device's own built loader** (`dist/release-trust.js`) against the rootfs path: **1 key accepted, 0 rejected.**

---

## 2. Image test results — actual

| Suite                                   | Result                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `build-gates.test.sh`                   | **57 passed, 0 failed** (was 45; +12 U1 gates)                             |
| `systemd-runtime.test.sh`               | **215 passed, 0 failed**                                                   |
| `environment-gating.test.sh`            | **20 passed, 0 failed**                                                    |
| `rpi-image-gen.test.sh`                 | **29 passed, 0 failed, 0 skipped**                                         |
| `image-contents.test.sh` (BUILT rootfs) | **105 passed, 0 failed, 0 skipped** (was 101 + 4 failing before the build) |
| `scan-image-secrets.sh` (BUILT rootfs)  | **17 passed, 0 failed — RESULT: PASS**                                     |

The new built-rootfs assertions, each checked in the filesystem the builder actually produced:

```
the image carries its own Device Shell (the fallback floor)
the built launcher prefers an installed release
the built launcher records what it started
the release runtime is in the shipped device closure   (10 modules)
the trust registry directory exists
NO private key material anywhere in the trust registry
the baked release source file exists
the image ships no release store (it is created at runtime)
the image ships no release-source override (an edit would be overwritten)
```

The last two are the ones worth having: the image shipping either path would silently overwrite what a device installed or what an operator configured.

**Confirming the test is real:** those four U1 assertions **failed** against the previous rootfs and passed only after this build. A gate that has never been red has not been tested.

---

## 3. Release-source behaviour (requirement 1)

**The problem:** `/etc/kitluy/release.env` is baked into an EROFS rootfs, so a DHCP lease change on the workstation would cost a reflash.

**The solution — resolution order in the update agent:**

```
1. /persistent/shared/kitluy/release-source.env     the OVERRIDE, wins
2. /etc/kitluy/release.env                          the baked DEFAULT
```

The agent reports which one decided (`sourceFrom=image|override`) in its journal line, so an address that is not in the image is explained rather than mysterious.

**Why that path, and not a slot-shared declaration.** `/persistent` is a real partition mounted before `local-fs.target` by the upstream `slot-perst-generator`, and is **shared across A/B slots by construction** — so the override survives a system update, which a file under per-slot `/var` would not.

More importantly it is **not** a declared `slot-shared.d` path, and that is deliberate. `rpi-persistent-shared-init` runs `rsync -av --checksum` from the image INTO `/persistent/shared` on every boot for declared paths, so a file the image also ships would be **silently restored from the image on the next reboot** — an override that appears to work and quietly reverts. Keeping it on a path the image never writes is what makes an edit stick, and there is a gate asserting the override is not declared slot-shared.

**A simplification against the plan:** the plan budgeted for a third slot-shared declaration plus generalising the known upstream `.wants` symlink bug. Neither was needed — both the release store and the override live directly on `/persistent`, so **no new slot-shared path was declared and the `.wants` workaround was not required.** Two existing declarations (`/etc/ssh`, `/etc/wpa_supplicant`) are untouched.

Tested: 9 cases in `test/update-preconditions.test.ts` — override wins; absent/empty/unparseable override falls back silently; override with no baked default works; whitespace trimmed; `.json` anchors accepted.

---

## 4. Newest-unsigned-assignment (requirement 2)

**The defect was real and I reproduced it before fixing it.** Group 0222 put the signature test in the `WHERE` clause and _then_ ordered by sequence, so an unsigned newest row was **skipped** and the previous signed one returned. A publisher that crashed between `assign_release_v1` and `record_assignment_signature_v1` left the device being told about the previous release while the operator believed the new one was assigned — no error, no log, just two sides disagreeing.

**Group 0223** picks the newest row **by sequence alone**, then tests it:

```sql
with newest as (
  select i.* from kitluy_releases.device_installations i
   where i.device_id = p_device_id
   order by i.assignment_sequence desc limit 1
)
select … from newest n … where c.status='active' and r.state in (…)
  and r.signature_b64 is not null and n.assignment_signature_b64 is not null;
```

**The rule: the device is told about its newest assignment, or about nothing.** No fallback — every fallback is a silent disagreement waiting to happen. This also gives revocation a clear meaning, and keeps "return to an earlier release" as device-local rollback rather than something the cloud reader does by omission.

**Test result** — `release:chain:check` step 12b, against the real database:

```
12b. a NEWER unsigned assignment hides the older signed one (group 0223)
  ok   the reader returns NOTHING while the newest assignment is unsigned
  ok   and specifically does NOT fall back to the older signed assignment
  ok   the device therefore has nothing to install
  ok   once signed, the NEWEST release becomes current
```

The third assertion goes through the device's own HTTP client, so it proves the property end to end and not merely in SQL.

---

## 5. Everything else in the Phase 4 list

| Item                                  | State                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| trust anchor integration              | `IGconf_kitluy_release_trust_record` → `/etc/kitluy/trust/release-signing.json`; refuses a record containing a private key, at build time **and** at read time; absent is safe |
| release-source configuration          | §3                                                                                                                                                                             |
| slot-shared release store             | **not needed** — `/persistent/shared/kitluy/releases`, created at runtime                                                                                                      |
| slot-shared mount workaround          | **not needed** — no new declared path                                                                                                                                          |
| launcher release/fallback indirection | prefers `current/payload`, tests `-f package.json` (never `-d`), falls back to the image copy                                                                                  |
| running-source witness                | written before `exec`, best-effort, to a directory the unit already owns                                                                                                       |
| update-agent permissions              | `ReadWritePaths=/var/lib/kitluy/update /persistent/shared/kitluy`                                                                                                              |
| runtime manifest                      | `releaseStore` / `releaseTrust` / `releaseSource` declared; `device-shell` gains `appRoots` + `witness`                                                                        |
| bootstrap-runtime packaging           | 10 new modules; **45 js files** packaged; manifest cross-check clean                                                                                                           |
| image gates                           | §2                                                                                                                                                                             |
| complete image build                  | §1                                                                                                                                                                             |
| built-rootfs inspection               | §2 — 105/105                                                                                                                                                                   |
| secret scan                           | §2 — 17/17 PASS                                                                                                                                                                |
| no-regression verification            | §6                                                                                                                                                                             |

---

## 6. No-regression verification

| Check           | Baseline                                                                | Now        | Verdict    |
| --------------- | ----------------------------------------------------------------------- | ---------- | ---------- |
| Format check    | FAIL — `EACCES` on the rootless build tree                              | identical  | **no new** |
| Lint            | FAIL — 2 errors: `terminal-edge.test.ts:310`, `dev-configuration.ts:40` | the same 2 | **no new** |
| Typecheck       | PASS                                                                    | **PASS**   |            |
| Unit tests      | FAIL — `@kitluy/device-identity#test` only, 899 passed / 23 skipped     | identical  | **no new** |
| Docs link check | FAIL — 4 broken links                                                   | 4          | **no new** |
| everything else | PASS                                                                    | PASS       |            |

> **BASELINE FAILURES: 4, all pre-existing. NEW REGRESSIONS: 0.**

```
services/kitluy-device-firstboot-agent   733 passed |  9 skipped | 0 failed
apps/kitluy-device-shell                 147 passed | 0 failed
pnpm release:pack:check                   14/14 passed
pnpm release:chain:check                  31/31 passed
pnpm migrations:validate                 122 migration files, passed
```

The device stack is clean: no assignment outstanding, both boards still `active`.

---

## 7. Unexpected issues found during Phase 4

Three, all fixed:

1. **`RELEASE_SOURCE: unbound variable`.** My new flag was parsed but never initialised, and the builder runs `set -u`, so it died _after_ validating the environment but _before_ emitting the overrides. Two existing environment-gating assertions went red. Fixed by initialising it beside the other env-or-flag values. Worth noting the gate caught it, not the build: the build "worked" right up to the point it did not.
2. **`Error: Overrides must be provided as key=value pairs.`** The trust record on disk is pretty-printed JSON, and `rpi-image-gen` refuses an override containing a newline. Fixed by compacting to one line at the point of use — identical JSON, different whitespace.
3. **The four new built-rootfs assertions failed against the old rootfs**, which is correct and is recorded because it is the evidence the gate works.

None changed the design; all three were caught by gates rather than at the bench.

---

## 8. Is the image ready for the one U1 reflash?

**Yes, with one thing to know before you flash it.**

Ready:

- every image suite green, including 105/105 against the rootfs this build produced;
- secret scan PASS — no private key, no host key, no per-device material;
- the trust anchor loads with the device's own loader;
- the launcher falls back to the image's Device Shell, so a bad release cannot leave the board without a screen;
- the release source is overridable without a reflash.

**The thing to know:** the image bakes `http://172.16.21.17:8790` as the release-source **default** — this workstation's current address. If it changes, that is no longer a reflash; write the new value to `/persistent/shared/kitluy/release-source.env` on the device. The image also has no release store and no override, by design: both are created at runtime.

Also unchanged and worth restating: this artifact is **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED**, and `bootTested: false` stays false until a board runs it.

**Not claimed:** `HARDWARE VERIFIED`. No card was written, no device was contacted, and acceptance A/B/C/D has not been attempted.

Nothing committed or pushed. Three migrations created this slice (0221, 0222, 0223), all applied to the local development stack only. No U2–U6 work.
