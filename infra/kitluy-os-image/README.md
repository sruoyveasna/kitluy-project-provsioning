# KitLuy Pi Terminal image

The generic Raspberry Pi Terminal image (owner decision v2.0.0 §4: one image
serves every terminal role and every vertical). 64-bit Debian on the pinned
upstream builder, A/B system slots behind dm-verity, a shared persistent
partition. Build tooling lives here. Blocked for pilot/stable on `[REQUIRED]`:
Pi OS release pin, signing key custody, secure-element model.

**This tree builds the Pi Terminal only.** The Store Hub image is built from
`infra/kitluy-store-hub-image` (owner decision 2026-08-13: two devices, two
images, two sources). The `store-hub` profile files still present here are kept
for record; `build-rpi-image.sh` refuses to build them.

---

## Factory Enrollment is the terminal's first stage

Owner rule KLD-2026-09-03-FACTORY-ENROLLMENT-001. A flashed terminal:

1. creates its device identity at first boot (`kitluy-firstboot`);
2. registers itself with KitLuy and waits for an **explicit Admin approval**
   (`kitluy-cloud-registration`); pending is its designed resting state;
3. shows its state on tty1 (`kitluy-bootstrap-screen`): device id, "Waiting
   for approval" or "Approved", and **Store: Unassigned**.

Approval grants recognition and provisioning eligibility, nothing more. The
image carries **no Store authority of any kind** (no Hub agent, no database,
no business application) and the tests assert that absence. The flash-time
ticket enrollment agent, which used to land a device in `enrolled` with no
Admin decision, is retired from this image and asserted absent.

`runtime-manifest.json` is the one declaration of what the image contains.
`scripts/package-bootstrap-runtime.sh` packages what it declares and refuses
on any disagreement; `test/image-contents.test.sh` inspects a **built** rootfs
against it; `test/systemd-runtime.test.sh` cross-checks enablement. Adding a
component to the image means adding it there.

## Two build paths, and which one makes an `.img`

| Script                       | Produces                               | Needs a toolchain? |
| ---------------------------- | -------------------------------------- | ------------------ |
| `scripts/build-image.sh`     | staged root filesystem tree + manifest | no                 |
| `scripts/build-rpi-image.sh` | a real arm64 `.img` / `.img.zst`       | yes                |

`build-image.sh` stages an inspectable tree and **refuses** to emit an `.img`
(exit 3). That refusal is deliberate. `build-rpi-image.sh` drives the pinned
upstream builder and does produce an image. Everything it produces on this
host is **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT PROMOTABLE**.

## Build host

Identical to the Store Hub tree's (Ubuntu 24.04 x86_64, rootless QEMU
cross-build, no sudo, no loop devices). Recreate and verify it with:

```bash
sudo bash infra/kitluy-os-image/scripts/setup-ubuntu-arm64-builder.sh
bash infra/kitluy-os-image/scripts/doctor.sh          # must be green
```

The privilege model, the two tools that must not come from the distro
(`genimage`, `bdebstrap`) and the binfmt notes are documented in
`infra/kitluy-store-hub-image/README.md` and apply unchanged.

## Build

```bash
pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build

KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub KITLUY_DEV_SUDO=1 \
  bash infra/kitluy-os-image/scripts/build-rpi-image.sh --profile pi-terminal \
    --environment development \
    --registration-url http://<workstation-lan-ip>:<stack-api-port>/functions/v1/device-registration \
    --hardware-profile-key KL-PI5-TERMINAL-DEV
```

The profile key must exist in the stack the route points at:
`KL-PI5-TERMINAL-DEV` on the local development stacks, `CLOUD-TERM-PI5` on
hosted development. A key the stack does not know is refused
`KLUY-REG-UNKNOWN-PROFILE` on every attempt, and the read-only rootfs cannot be
corrected on the card.

`--registration-url` and `--hardware-profile-key` are what make Factory
Enrollment possible; without them the device boots and reports
`NOT_REGISTERED`, and the read-only rootfs cannot be corrected on the card.
`--environment` is never defaulted. `KITLUY_DEV_SUDO=1` is development
diagnostics only.

Useful flags: `--filesystem-only`, `--collect-only`, `--skip-packaging`
(diagnostic only), `--no-interactive-access`.

Output lands under `build/work/` (gitignored):

    build/work/image-<image-name>/     genimage output, incl. system.roothash
    build/work/deploy-v<tag>/          compressed, deployable assets
    build/work/kitluy-pi-terminal-dev-manifest.json

## Verify

```bash
bash infra/kitluy-os-image/scripts/doctor.sh
bash infra/kitluy-os-image/test/build-gates.test.sh
bash infra/kitluy-os-image/test/systemd-runtime.test.sh
bash infra/kitluy-os-image/test/environment-gating.test.sh
KITLUY_RIG_UPSTREAM=infra/kitluy-os-image/build/upstream \
  bash infra/kitluy-os-image/test/rpi-image-gen.test.sh
bash infra/kitluy-os-image/test/image-contents.test.sh          # needs a BUILT rootfs
bash infra/kitluy-os-image/scripts/scan-image-secrets.sh <rootfs>
```

`image-contents.test.sh` is the only suite that inspects the rootfs the builder
actually produced. It SKIPS when no image has been built — treat a skipped run
as no evidence (KLD-EVIDENCE-001), not as a pass.

## What this slice does not carry

- A graphical setup shell. tty1 shows a **text** status screen; the Electron
  Device Shell under `cage` replaces it in the next slice, and
  `runtime-manifest.json` already names `kitluy-terminal-session.service` as
  the declared successor.
- Pairing-code entry, Hub discovery, a terminal credential, an application
  installer, a Terminal PIN. Each is a later slice of the same plan.
- A Wi-Fi join screen. The supplicant, the seeded zero-secret configuration
  and the slot-shared credential store are in place; the screen arrives with
  the Device Shell. A wired installation is the supported path until then.

## Known blockers

| Blocker                                        | Status                                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `KITLUY_IMAGE_SIGNING_KEY_REF` (BLK-005)       | open — pilot/stable refuse                                                               |
| `KITLUY_SECURE_ELEMENT_MODEL`                  | production BOM decision                                                                  |
| Debian snapshot pin for reproducible apt state | owner decision                                                                           |
| Physical boot of an image from this tree       | last booted 2026-08-13 (text screen, ticket path); this slice's image is not yet flashed |
