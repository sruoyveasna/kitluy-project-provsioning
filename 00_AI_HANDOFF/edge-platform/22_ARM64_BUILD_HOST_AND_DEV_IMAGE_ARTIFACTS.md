# ARM64 build host and development image artifacts

**Date:** 2026-08-10
**Status: BUILD HOST READY — BOTH DEVELOPMENT IMAGES GENERATED.**
Supersedes the "BLOCKED, not faked" build attempt in
`18_RPI_IMAGE_GEN_INTEGRATION_STATUS.md` §6.

> Every artifact below is **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE /
> NOT PROMOTABLE / NOT BOOT-TESTED**. BLK-005 remains **OPEN** and the
> `pilot`/`stable` channels still refuse to build. No promotion policy changed.

---

## 1. What changed

Handoff 18 recorded that no image could be produced because the host lacked
`mmdebstrap`, `podman`, `bdebstrap`, `genimage` and ARM64 emulation. The owner
authorised host package installation. The host is now green and **both** KitLuy
image families build end to end.

## 2. Host

| Property             | Value                                          |
| -------------------- | ---------------------------------------------- |
| OS                   | Ubuntu 24.04.4 LTS                             |
| Kernel               | 6.8.0-137-generic                              |
| Host architecture    | x86_64                                         |
| CPU / RAM            | 28 cores / 62 GiB                              |
| Build classification | DEVELOPMENT CROSS-BUILD (native path is arm64) |

## 3. The privilege model — verified, not assumed

**The image build is rootless.** `rpi-image-gen`'s `bin/ns` runs every
filesystem operation under `podman unshare`, which grants uid 0 inside a user
namespace only.

Evidence from the two real builds:

    sudo invoked ................... none (the 15 log hits are the builder's
                                     own IGconf_device_user1sudo=none variable)
    privileged container ........... none
    loop devices ................... none
    docker in the build ............ none (only the doctor's arm64 probe)
    output ownership ............... veasna:veasna, not root

**The earlier privileged-Docker-builder proposal is superseded.** Docker's only
roles are binfmt registration and the arm64 probe; it is not the build engine.

## 4. ARM64 emulation is now persistent

| Property        | Value                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Interpreter     | `/usr/libexec/qemu-binfmt/aarch64-binfmt-P`                                                      |
| QEMU            | 8.2.2 (Debian 1:8.2.2+ds-0ubuntu1.18)                                                            |
| Flags           | `POF` — `F` (fix-binary) is what makes it work inside a chroot/container with no QEMU of its own |
| Owner           | **systemd-binfmt** (`/usr/lib/binfmt.d/qemu-aarch64.conf`)                                       |
| Survives reboot | **YES**                                                                                          |

`update-binfmts` does _not_ own the handler; the packaged systemd-binfmt unit
does. The temporary `tonistiigi/binfmt` registration used earlier lived in
kernel memory only and has been replaced. `doctor.sh` distinguishes the two and
warns when only the temporary one is present.

## 5. Toolchain

| Tool          | Version                    | Source                                      |
| ------------- | -------------------------- | ------------------------------------------- |
| podman        | 4.9.3                      | Ubuntu (rootless; subuid/subgid configured) |
| mmdebstrap    | 1.4.3                      | Ubuntu                                      |
| qemu-aarch64  | 8.2.2                      | Ubuntu `qemu-user-static`                   |
| veritysetup   | 2.7.0                      | Ubuntu `cryptsetup`                         |
| genimage      | **19 + dm-verity patches** | **built from source by the pinned builder** |
| bdebstrap     | 0.7.0                      | built from source by the pinned builder     |
| docker/buildx | 29.6.2 / v0.35.0           | optional; probe + binfmt only               |

**Do not install the distro `genimage`.** Upstream patches genimage 19 to add
the `verity` and `verity-sig` handlers (`package/genimage/patches/19/`). The
distro build lacks them and cannot produce the Hub spec §6.8 layout, while
still satisfying a `command -v` check. `debootstrap` is not a dependency.

## 6. Pinned builder — verified, not updated

    repository  https://github.com/raspberrypi/rpi-image-gen
    tag         v2.7.0
    commit      a7b6d4806183195f3efadb533f58c8e46393d057

Checkout lives at `infra/kitluy-os-image/build/upstream` (gitignored via the
repository-wide `build/` rule, so upstream is still **not vendored** and the
anti-vendoring test still passes). The build refuses if the checkout does not
match the pinned commit.

## 7. Tests — re-run after the host changed

    infra/kitluy-os-image/test/build-gates.test.sh      34 passed, 0 failed
    infra/kitluy-os-image/test/rpi-image-gen.test.sh    36 passed, 0 failed, 0 skipped

The rpi-image-gen suite's upstream-validation class ran **fully for the first
time** (previously all SKIPPED) because the pinned tree is now present. Every
device/image/suite layer name and every config key KitLuy references was
confirmed to exist in `v2.7.0`.

## 8. Store Hub artifact

    profile         store-hub / store_hub
    image name      kitluy-storehub-os-arm64
    base OS         Debian Bookworm arm64 (bookworm-minbase)
    architecture    arm64, Raspberry Pi 5 (rpi5)
    layout          image-rota — A/B slots + userdata

| Artifact                                  | Bytes          | SHA-256                                                            |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------ |
| `kitluy-storehub-os-arm64.img`            | 17,490,268,160 | `be0b594f779ea8de88a380305e3b3ed705e157e2a097e69a414ea610822f40b8` |
| `kitluy-storehub-os-arm64.img.zst`        | 649,401,226    | `b8c540d3bb227bfbe92799c2f44c593e088c84fb36905bde51e11ba03ece42af` |
| `kitluy-storehub-os-arm64.img.sparse`     | 826,765,108    | `aa056b0d4bb9d9bd2883cb687ad928f197d473231d9f113fe33be94910fab9e1` |
| `kitluy-storehub-os-arm64.img.sparse.zst` | 649,252,987    | `59a84b1e50e0590eb31c5246a1475030f2054c7ea5adab1bf2d7258bc62d66c5` |
| `kitluy-storehub-os-arm64-v2.7.0.tar.zst` | 981,048,735    | `192d5f5a9a72d2d8ce959f709caaa6413323b83f542b8adf5127f7ed87614e31` |

Partition table (GPT, 6 partitions):

    bootconfig  32M   boot_a 128M   boot_b 128M
    system_a    4G    system_b 4G   persistent 8G

Composition verified: 279 packages (224 arm64), `postgresql-15`,
`postgresql-client-15`, `nodejs`, `avahi-daemon`, `libnss-mdns`, `cryptsetup`,
`systemd-journal-remote`, `fake-hwclock`, `systemd-timesyncd` all present.
**Headless confirmed** — no `labwc`, `wlr-randr`, `seatd`, `xserver-xorg` or
`cups`. `/etc/kitluy/hub.env` carries the LAN/mDNS/database settings and **no
DSN**. mDNS advertisement `_kitluy-edge._tcp` on port 8443 present.

## 9. Terminal artifact

    profile         pi-terminal / terminal
    image name      kitluy-pos-terminal-wayland-arm64

| Artifact                                           | Bytes         | SHA-256                                                            |
| -------------------------------------------------- | ------------- | ------------------------------------------------------------------ |
| `kitluy-pos-terminal-wayland-arm64.img`            | 8,900,333,568 | (see manifest)                                                     |
| `kitluy-pos-terminal-wayland-arm64.img.zst`        | 729,460,636   | `a6f5040046cecc66f679916ba9a17c130eaa3cb585eef12ad9a3846f131b6f20` |
| `kitluy-pos-terminal-wayland-arm64.img.sparse`     | 870,583,724   | (see manifest)                                                     |
| `kitluy-pos-terminal-wayland-arm64.img.sparse.zst` | 729,687,091   | `891077b7eebd0557755979c9c08090511b91f6d9b6c2637fc5fa6731229e2240` |
| `kitluy-pos-terminal-wayland-arm64-v2.7.0.tar.zst` | 1,097,074,866 | `568cd07faa01ee9cca0d77ad84b96f300afcde7039207cf65866a8c8163902b6` |

Partition table: `bootconfig 32M`, `boot_a/b 128M`, `system_a/b 3G`,
`persistent 2G`.

Composition verified: 434 packages (365 arm64), `labwc`, `wlr-randr`, `seatd`,
`libinput-tools`, `evtest`, `cups`, `libcups2` present. **No local database** —
`postgresql-15` and `postgresql-client-15` absent. `/etc/kitluy/terminal.env`
carries `wayland/labwc` with no profile, Tenant, Store, Location or Hub endpoint.

### OS image generated ≠ Terminal GUI implemented

These are different milestones and only the first is done.

    /usr/lib/kitluy/                    EXISTS but is EMPTY
    /usr/lib/kitluy/terminal-session    NOT PRESENT (unit ExecStart target)
    kitluy-enrollment-agent.service     NOT PRESENT (unit Requires it)
    kitluy-terminal-session.service     present, NOT enabled

The kiosk unit is a correct declaration of intent that **cannot currently
start**. This is consistent with mission §27 — the OS image is not an
application release, and the agents travel through the governed release system.
The same holds for the Hub: no Hub agent executable is installed. Do not read
"image builds" as Hub CLI, Terminal GUI, firstboot, heartbeat or provisioning
being implemented.

## 10. dm-verity is composed — status change

Handoff 18 §9 listed "dm-verity / LUKS2 wiring — not yet composed" as an open
item. The `image-rota` layer **does** compose dm-verity, and it ran:

    veritysetup format --hash sha256 --data-block-size 16384 ... → system.roothash

Both builds produced a 64-byte SHA-256 root hash over a read-only `erofs`
system slot. `provisionmap.json` declares `"system_type": "slotted"` with A/B
slots, and `autoboot.txt` carries the Raspberry Pi `tryboot_a_b=1` selector.

One upstream warning to carry forward:

    WARNING: Kernel cannot activate device if data block size exceeds page size (4096)

The verity data-block size is 16384 while the Pi kernel page size is 4096. This
needs resolving before dm-verity can actually be activated on hardware. It does
not affect image generation. **Not yet validated on a Pi.**

## 11. Golden-image secret scan

`scripts/scan-image-secrets.sh` (new) scans a built tree for credentials **and**
for assignment truth, printing only `file:line`, never a value.

| Result     | Store Hub           | Terminal            |
| ---------- | ------------------- | ------------------- |
| Categories | 17 passed, 1 failed | 17 passed, 1 failed |

**PASS** — Supabase service_role/JWT, `sb_secret`, Supabase PAT, database
password assignment, DB URL with inline password, admin/partner password,
provisioning code, signing-key value, Tenant binding, Digital Store binding,
Location binding, terminal profile, fixed Hub endpoint, device identity absent,
`/etc/machine-id` empty, no pre-seeded SSH host keys.

**FAIL — "Private key material"**, from two distinct causes:

1. **`/etc/ssl/private/ssl-cert-snakeoil.key` — a real, genuine defect.**
   A 1704-byte PEM private key generated into **both** golden images by the
   `ssl-cert` package (pulled in transitively — via `cups` on the Terminal and
   via `postgresql` on the Hub). Every device flashed from these images would
   carry the **same TLS private key**. This is precisely the clone-hygiene class
   `kitluy-base` already guards for SSH host keys (`rm -f /etc/ssh/ssh_host_*`);
   `ssl-cert` slipped past because it is nobody's declared dependency.

   Recorded, **not fixed** — changing image composition is outside this task's
   scope (CLAUDE.md hard rule 1). The fix is one hook in `kitluy-base.yaml`
   alongside the existing SSH host-key removal, plus a test assertion, and then
   a rebuild.

2. `python3-pycryptodome`'s `SelfTest` tree (2.8 MB of PEM test vectors) and a
   `freedesktop.org.xml` MIME magic string. Third-party test fixtures, not
   KitLuy credentials — but also dead weight that a golden image need not ship.

Neither finding was suppressed to make the scan green.

## 12. Repository changes (task-owned)

    infra/kitluy-os-image/scripts/setup-ubuntu-arm64-builder.sh   new
    infra/kitluy-os-image/scripts/doctor.sh                       new
    infra/kitluy-os-image/scripts/build-rpi-image.sh              new
    infra/kitluy-os-image/scripts/scan-image-secrets.sh           new
    infra/kitluy-os-image/README.md                               extended

No commits, no pushes. `build/` output is gitignored.

## 13. Remaining blockers

| Blocker                                      | Class                        |
| -------------------------------------------- | ---------------------------- |
| BLK-005 release signing                      | unchanged, still fail-closed |
| `KITLUY_SECURE_ELEMENT_MODEL`                | production BOM               |
| Debian snapshot pin (reproducible apt state) | owner decision               |
| snakeoil private key in both images          | **image definition**         |
| verity block size 16384 vs Pi page size 4096 | **image definition**         |
| Device executables under `/usr/lib/kitluy/`  | application release path     |
| Physical Raspberry Pi boot validation        | hardware                     |
| Factory QA persistence, PG17 SIGSEGV         | untouched, other workstreams |
