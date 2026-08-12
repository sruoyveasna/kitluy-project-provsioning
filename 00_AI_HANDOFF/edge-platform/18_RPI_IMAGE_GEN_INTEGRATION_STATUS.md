# rpi-image-gen integration status

**Date:** 2026-08-07
**Status: INTEGRATED AND VALIDATED — NOT BUILT.** The KitLuy external source is
real, pinned, and accepted by the upstream builder itself. No image was produced
on this host.

---

## 1. What was built

    infra/kitluy-os-image/rpi-image-gen/        <- the KitLuy external source (-S)
    ├── upstream.pin                            pinned builder + verified names
    ├── config/
    │   ├── kitluy-store-hub.yaml
    │   └── kitluy-pi-terminal.yaml
    └── layer/
        ├── kitluy-base.yaml                    shared by both profiles
        ├── kitluy-store-hub.yaml
        └── kitluy-pi-terminal.yaml

    infra/kitluy-os-image/test/rpi-image-gen.test.sh    36 tests

Invocation, matching the documented external-source model exactly:

    rpi-image-gen build -S infra/kitluy-os-image/rpi-image-gen -c kitluy-store-hub.yaml
    rpi-image-gen build -S infra/kitluy-os-image/rpi-image-gen -c kitluy-pi-terminal.yaml

## 2. Builder pinning (§24) — resolved

| Field                | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| Upstream repository  | `https://github.com/raspberrypi/rpi-image-gen`         |
| Approved tag         | **`v2.7.0`**                                           |
| Commit               | `a7b6d4806183195f3efadb533f58c8e46393d057`             |
| Base OS              | Debian Bookworm arm64 (`bookworm-minbase`)             |
| Target architecture  | `arm64`                                                |
| Target device        | Raspberry Pi 5 (`rpi5`)                                |
| Image layout         | `image-rota` — A/B slots + separate userdata partition |
| KitLuy source commit | `e9a7c39` (working tree, uncommitted)                  |

A tag **and** its resolved commit are recorded: a tag can be moved, a 40-hex
commit cannot. `master` is explicitly not tracked — an image built from a moving
branch is irreproducible, which makes release identity meaningless.

Upstream is a **dependency, not a fork**. Nothing from it is vendored, and a
test fails if an upstream tree ever appears inside the KitLuy source directory.

> This resolves the previously unresolved `KITLUY_BASE_OS_RELEASE` blocker for
> **development** builds. A release-grade pin additionally needs a Debian
> snapshot/date pin so apt state is reproducible — still an owner decision.

## 3. Validated against the pinned tree, by the pinned tool

Not just by KitLuy's own tests. The upstream builder loaded and resolved every
KitLuy layer:

    rpi-image-gen layer --srcroot <KitLuy source> --list
      Loaded layer: kitluy-base (0.1.0)
      Loaded layer: kitluy-store-hub (0.1.0)
      Loaded layer: kitluy-pi-terminal (0.1.0)

    rpi-image-gen layer --srcroot <KitLuy source> --describe kitluy-store-hub
      Depends:
        - kitluy-base
          - bookworm-minbase → debian-bookworm-arm64-multi → locale-base → locale-config
                             → rpi-debian-bookworm, rpi-misc-utils, rpi-essential-base,
                               rpi-misc-skel, systemd-net-min → systemd-min,
                               fake-hwclock, openssh-server → device-user-admin
                               → device-user-credentials

The full dependency graph resolves against real upstream layers. **No
configuration key or layer name was invented** — every name is verified present
in `v2.7.0`, and the test suite re-checks this on every run.

Config keys used, all confirmed present upstream: `device.layer`,
`layer.custom`, `image.layer`, `image.name`, `image.compression`,
`image.boot_part_size`, `image.system_part_size`, `image.data_part_size`.

## 4. Profiles share a base (§22)

Two managed profiles, one platform:

    kitluy-base                  identity bootstrap, firstboot, enrollment agent,
      │                          health reporter, update runtime, hardening,
      │                          persistent journald, trusted-time sources
      ├── kitluy-store-hub       PostgreSQL 15, LAN /edge/v1, mDNS advertise, headless
      └── kitluy-pi-terminal     kiosk runtime, mDNS listen, peripherals, no database

Asserted in both directions: the terminal must not carry a database, the Hub
must not carry a display stack.

Trusted time requires **both** `systemd-timesyncd` and `fake-hwclock`, not
either — the owner-fixed model takes the maximum of RTC time, authenticated
time and a persisted floor, and never moves backwards.

## 5. Zero-secret and clone hygiene (§15, §23) — tested

    external source is zero-secret ....................... PASS
    no assignment truth baked into the image ............. PASS
    machine-id reset in the golden image ................. PASS
    SSH host keys not pre-seeded ......................... PASS
    terminal carries no cached endpoint or assignment .... PASS

The terminal image carries **no** terminal profile, Tenant, Digital Store,
Location or Hub endpoint. One image serves T1–T4; the profile arrives as
governed configuration after cloud-authorised assignment. A baked profile would
make the image a source of assignment truth and would mean a spare terminal
could only replace the one role it was flashed for.

The Hub image carries no database DSN — a DSN in a golden image is a credential
in a golden image. It is created on the device at activation.

## 6. Build attempt (§26) — BLOCKED, not faked

    ./rpi-image-gen build -S <KitLuy source> -c kitluy-pi-terminal.yaml
    → Required dependencies (all) not installed
    → mmdebstrap debian-archive-keyring podman uidmap mtools pv btrfs-progs
      dctrl-tools uuid-runtime cryptsetup autopoint flex
    BUILD_EXIT=1

Missing on this host: `mmdebstrap`, `bdebstrap`, `genimage`,
`qemu-aarch64-static`, `podman`, `crudini`. Installing them requires root
package installation, which is a host change outside this mission's authority
and was **not** performed.

**No image was produced and none is claimed.**

## 7. Build-host classification (§25)

    this host ......... x86_64, Ubuntu 24.04.4 LTS, non-root
    supported native .. arm64 Debian / Raspberry Pi OS

Any build on this workstation would be a **DEVELOPMENT CROSS-BUILD** relying on
QEMU/foreign-package support — explicitly _not_ the official native path and
**not hardware-certified**. Recorded in `upstream.pin` as
`KITLUY_RIG_NATIVE_BUILD_ARCH="arm64"`.

## 8. Image vs application release (§27) — preserved

The image provides the OS, the device agent runtime, the update runtime, the
kiosk substrate, public trust anchors and firstboot. The KitLuy agent _code_ and
the POS application are **not** baked in — they travel through the governed
release system. Rebuilding the whole OS image for a POS update is exactly what
this separation avoids.

## 9. Remaining image blockers

| Blocker                                                       | Status                                     |
| ------------------------------------------------------------- | ------------------------------------------ |
| Build host with rpi-image-gen dependencies                    | **required next** — arm64 Debian preferred |
| Debian snapshot pin for reproducible apt state                | owner decision                             |
| `KITLUY_IMAGE_SIGNING_KEY_REF`                                | BLK-005 implementation                     |
| `KITLUY_SECURE_ELEMENT_MODEL`                                 | production BOM decision                    |
| Device executables under `/usr/lib/kitluy/`                   | not built; agent logic exists              |
| dm-verity / LUKS2 wiring (`rpi-idp-luks2` available upstream) | not yet composed                           |

The two earlier `scripts/build-image.sh` gates still hold and still refuse:
`pilot`/`stable` channels are unbuildable while the signing key is unresolved,
and no unsigned `.img` is ever emitted.
