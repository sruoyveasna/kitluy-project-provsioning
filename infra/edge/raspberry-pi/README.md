# Raspberry Pi device images

KitLuy has **two Raspberry Pi device classes, so it has two image products**,
each built from its own source tree:

| Image       | Source (this directory) | Builds                                                   | Image name                          |
| ----------- | ----------------------- | -------------------------------------------------------- | ----------------------------------- |
| Pi Terminal | `pi-terminal-image/`    | the one **generic** Pi Terminal image for every terminal | `kitluy-pos-terminal-wayland-arm64` |
| Store Hub   | `store-hub-image/`      | the Store Hub image (Hub Agent, PostgreSQL, Hub storage) | `kitluy-storehub-os-arm64`          |

This is a navigation page. Build, host setup and test details are in each
project's own `README.md`.

## Rules that hold for both

- **Two independent projects.** Each has its own `runtime-manifest.json`,
  packaging script, `rpi-image-gen` layers and test suites, and each builds
  without the other. The Terminal build refuses `--profile store-hub`. There
  is no `shared/` tooling yet. The duplication between the two trees is
  deliberate until each duplicated piece is proven identical and safe to share.
- **Same pinned upstream builder.** Both consume the official
  [`raspberrypi/rpi-image-gen`](https://github.com/raspberrypi/rpi-image-gen)
  at tag `v2.7.0`, commit `a7b6d4806183195f3efadb533f58c8e46393d057`, pinned in
  each project's `rpi-image-gen/upstream.pin`. It is never vendored: the build
  clones it into `<project>/build/upstream` and refuses a checkout at any other
  commit. `test/rpi-image-gen.test.sh` validates the pin.
- **No identity in a golden image.** No business, Store, Store Location, device
  id, certificate or terminal role (T1–T4) is baked in. A device creates its
  identity at first boot and receives approval, assignment and pairing at
  runtime.
- **The manifest is the authority.** `runtime-manifest.json` declares what the
  image contains, and packaging refuses when the manifest and the overlay
  disagree.

## Where to change what

| To change…                                    | Edit                                                                                      | Then                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| the Pi Terminal image (units, layers, config) | `pi-terminal-image/rpi-image-gen/layer/` (`kitluy-base`, `kitluy-pi-terminal`), `config/` | `pi-terminal-image/test/*.test.sh`                                          |
| the Store Hub image                           | `store-hub-image/rpi-image-gen/layer/` (`kitluy-hub-base`, `kitluy-store-hub`), `config/` | `store-hub-image/test/*.test.sh`                                            |
| the firstboot runtime (both images)           | `services/kitluy-device-firstboot-agent/src/`                                             | build it, then run **both** `scripts/package-bootstrap-runtime.sh`          |
| the Hub Agent                                 | `services/kitluy-hub-agent/src/`                                                          | `build:bundle`, then `store-hub-image/scripts/package-bootstrap-runtime.sh` |
| Hub database migrations                       | `hub/migrations/`                                                                         | `store-hub-image/scripts/package-bootstrap-runtime.sh`                      |
| the Device Shell (Terminal screen)            | `apps/kitluy-device-shell/`                                                               | build it, then `pi-terminal-image/scripts/package-bootstrap-runtime.sh`     |

Never edit `usr/lib/kitluy/lib/**` or `usr/lib/kitluy/hub-migrations/` inside an
overlay by hand. Those files are packaged output, committed so the image build
needs no TypeScript toolchain, and packaging deletes and rewrites them. A new
firstboot module must be added to `DEVICE_MODULES` in **both** packaging scripts.
`build-rpi-image.sh` runs packaging itself before every build.

## Where generated output goes

Everything a build writes stays inside its own project, under gitignored
directories. Nothing here is source, and none of it is committed:

- `<project>/build/upstream/`: the pinned `rpi-image-gen` checkout
- `<project>/build/work/`: `chroot-*/filesystem` (the built rootfs that
  `test/image-contents.test.sh` inspects), `image-*/*.img` and
  `deploy-*/*.img.zst`
- `pi-terminal-image/build/electron/`: the pinned Electron runtime cache
- `<project>/out/`: staged trees from `scripts/build-image.sh`

## Path history

These trees moved on 2026-09-16 (INFRA-EDGE-STRUCTURE-001, handoff
[`45_RASPBERRY_PI_IMAGE_SOURCES_UNDER_EDGE.md`](../../../00_AI_HANDOFF/edge-platform/45_RASPBERRY_PI_IMAGE_SOURCES_UNDER_EDGE.md)). Records written before that date use the
old paths, which were correct when they were written:

| Previous path                  | Current path                                |
| ------------------------------ | ------------------------------------------- |
| `infra/kitluy-os-image`        | `infra/edge/raspberry-pi/pi-terminal-image` |
| `infra/kitluy-store-hub-image` | `infra/edge/raspberry-pi/store-hub-image`   |
