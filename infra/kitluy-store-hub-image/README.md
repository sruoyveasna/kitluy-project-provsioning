# KitLuy OS image (Store Hub / Pi terminals)

Approved 64-bit Raspberry Pi OS-based image with KitLuy-signed boot chain,
dm-verity read-only system partition, encrypted data partition, A/B slots
(Hub spec §6.8). Build tooling lands here. Blocked on [REQUIRED]: Pi OS
release pin, signing key custody, secure-element model.

---

## Two build paths, and which one makes an `.img`

| Script                       | Produces                               | Needs a toolchain? |
| ---------------------------- | -------------------------------------- | ------------------ |
| `scripts/build-image.sh`     | staged root filesystem tree + manifest | no                 |
| `scripts/build-rpi-image.sh` | a real arm64 `.img` / `.img.zst`       | yes                |

`build-image.sh` stages an inspectable tree and **refuses** to emit an `.img`
(exit 3). That refusal is deliberate and is not changed by anything below.

`build-rpi-image.sh` drives the pinned upstream builder and does produce an
image. Everything it produces on this host is
**DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT PROMOTABLE**.

## Build host

| Property         | Verified value                                           |
| ---------------- | -------------------------------------------------------- |
| Tested host      | Ubuntu 24.04.4 LTS, x86_64, kernel 6.8                   |
| Supported native | arm64 Debian / Raspberry Pi OS (`upstream.pin`)          |
| Build class here | **DEVELOPMENT CROSS-BUILD** via QEMU — not certified     |
| Free disk        | 25 GB minimum; a Hub build writes a 17.5 GB raw `.img`   |
| Privilege        | **none** — no `sudo`, no `--privileged`, no loop devices |

### Recreate the host

```bash
sudo bash infra/kitluy-store-hub-image/scripts/setup-ubuntu-arm64-builder.sh
bash infra/kitluy-store-hub-image/scripts/doctor.sh          # must be green
```

`setup-ubuntu-arm64-builder.sh` is idempotent and installs only. When a pinned
upstream checkout is present it delegates to upstream's own `install_deps.sh`
rather than a second, drifting copy of the package list.

### The privilege model, which is the part most easily got wrong

The image build runs **rootless**. `rpi-image-gen`'s `bin/ns` wraps every
filesystem operation in `podman unshare`, so the build gets uid 0 inside a user
namespace and needs no real privilege. Verified on this host: both images were
produced with no `sudo`, no privileged container, and no loop device; the
resulting `.img` is owned by the invoking user.

**Docker is optional.** It is used only to register binfmt and to run the arm64
probe. It is _not_ the build engine — an earlier proposal to build inside a
privileged Docker container is superseded by this evidence.

### Two tools you must NOT install from the distro

| Tool        | Why not                                                                                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `genimage`  | upstream compiles **genimage 19 plus its own dm-verity patches**. The Debian/Ubuntu build has no `verity` handler, so it cannot produce the Hub spec §6.8 layout. A distro copy would satisfy `command -v` while silently being the wrong tool. |
| `bdebstrap` | likewise built from source by upstream (`package/bdebstrap`).                                                                                                                                                                                   |

`debootstrap` is **not** a dependency either — the builder uses `mmdebstrap`.

### ARM64 emulation

`qemu-user-static` registers `qemu-aarch64` through **systemd-binfmt**
(`/usr/lib/binfmt.d/qemu-aarch64.conf`), so the handler **survives reboot**.
The handler carries flag `F` (fix-binary), which is what lets an arm64 binary
run inside a chroot or container that has no QEMU of its own.

A `docker run --privileged --rm tonistiigi/binfmt --install arm64` registration
also works but lives only in kernel memory and is **lost on reboot**. The
doctor distinguishes the two and warns when only the temporary one is present.

## Build

```bash
bash infra/kitluy-store-hub-image/scripts/build-rpi-image.sh --profile store-hub
bash infra/kitluy-store-hub-image/scripts/build-rpi-image.sh --profile store-hub
```

Useful flags: `--filesystem-only` (skip image generation),
`--collect-only` (re-hash existing artifacts without rebuilding),
`--skip-doctor` (not recommended — the preflight exists so a missing tool fails
in two seconds instead of twenty minutes).

Output lands under `build/work/` (gitignored):

    build/work/image-<image-name>/     genimage output, incl. system.roothash
    build/work/deploy-v<tag>/          compressed, deployable assets
    build/work/kitluy-<profile>-dev-manifest.json

The deploy directory is keyed by builder version, not by profile, so both
profiles' assets land there side by side; the manifest filters by image name so
an artifact is never attributed to the wrong profile.

## Verify

```bash
bash infra/kitluy-store-hub-image/scripts/doctor.sh              # host readiness
bash infra/kitluy-store-hub-image/scripts/scan-image-secrets.sh <rootfs> [more...]
bash infra/kitluy-store-hub-image/test/build-gates.test.sh
KITLUY_RIG_UPSTREAM=infra/kitluy-store-hub-image/build/upstream \
  bash infra/kitluy-store-hub-image/test/rpi-image-gen.test.sh
```

`scan-image-secrets.sh` checks a **built** tree, which the overlay backstop in
`lib/common.sh` cannot: it catches what the builder, a layer hook or an
installed package wrote. It fails on assignment truth (Tenant, Digital Store,
Location, terminal profile, fixed Hub endpoint) as well as on credentials, and
never prints a matched value.

## Known blockers

| Blocker                                                 | Status                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `KITLUY_IMAGE_SIGNING_KEY_REF` (BLK-005)                | open — pilot/stable refuse                                                           |
| `KITLUY_SECURE_ELEMENT_MODEL`                           | production BOM decision                                                              |
| Debian snapshot pin for reproducible apt state          | owner decision                                                                       |
| `/etc/ssl/private/ssl-cert-snakeoil.key` in both images | **image-definition defect** — a shared private key in a golden image; see handoff 22 |
| Device executables under `/usr/lib/kitluy/`             | not installed by the image (by design, mission §27)                                  |
| Physical Raspberry Pi boot                              | never tested                                                                         |
