# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Task ID            | `KL-P1-TERM-SHELL-003`                                             |
| Task title         | Device Shell image integration (Slice 1B, Milestone C)             |
| Product/build      | `kitluy-os-image` (Pi Terminal), `kitluy-device-shell`             |
| Primary agent      | Claude Opus 5 (1M context)                                         |
| Status             | `PARTIAL` — source and gates complete; hardware acceptance NOT RUN |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                        |
| Base commit        | `d676d92`                                                          |
| Final commit       | see `git log` on this branch                                       |
| Handoff date       | `2026-09-07`                                                       |
| Requested reviewer | Owner (Veasna) — before any card is flashed                        |

## 1. Outcome

The Pi Terminal image now carries a graphical screen that can take a pairing
code. Until this task the image had none: the only display surface was a text
screen that accepts no input, and the Device Shell existed only in the
repository.

What changed, in the order a boot meets it:

1. `cage` — a kiosk compositor that shows exactly one application, full screen,
   with no desktop behind it — is installed and is what the shell runs under.
2. Electron `38.8.6` arm64 is fetched, **checksum-verified** and installed.
3. The Device Shell application is packaged into the terminal overlay.
4. `kitluy-device-shell.service` owns the display; the text screen is displaced.

## 2. Source-of-truth checked

| Source                               | Section/path                    | Result                                         |
| ------------------------------------ | ------------------------------- | ---------------------------------------------- |
| `runtime-manifest.json`              | `tty1.owner` / `tty1.successor` | the slice this file anticipated; flipped       |
| Slice 1B handoff (`…TERM-SHELL-001`) | §8 Next steps                   | items 1 and 2 executed                         |
| ADR-0004                             | electron binary skip            | aligned — the image supplies the runtime       |
| `kitluy-bootstrap-screen.service`    | why the text screen exists      | preserved as the recovery surface              |
| `kitluy-terminal-session.service`    | the labwc path                  | left defined and disabled, for the POS release |

## 3. Files changed

| Path                                                             | Change                                                 | Generated? |
| ---------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| `rpi-image-gen/electron.pin`                                     | NEW — version + arch + **sha256** + install path       | no         |
| `scripts/fetch-electron.sh`                                      | NEW — download, verify, unpack, cache                  | no         |
| `scripts/build-rpi-image.sh`                                     | resolve the runtime, pass `IGconf_kitluy_electron_dir` | no         |
| `scripts/package-bootstrap-runtime.sh`                           | package the shell app; know `pinned-download`          | no         |
| `rpi-image-gen/layer/kitluy-pi-terminal.yaml`                    | `cage`, Electron libs, Khmer fonts, install hook       | no         |
| `…rootfs-overlay/etc/systemd/system/kitluy-device-shell.service` | NEW — the cage session unit                            | no         |
| `…rootfs-overlay/usr/lib/kitluy/device-shell`                    | NEW — the launcher shim                                | no         |
| `…rootfs-overlay/usr/lib/kitluy/lib/device-shell/`               | the built app                                          | **yes**    |
| `…multi-user.target.wants/` (two entries)                        | the tty1 flip                                          | no         |
| `runtime-manifest.json`                                          | `device-shell`, `electron-runtime`, tty1 owner         | no         |
| `test/systemd-runtime.test.sh`                                   | display-owner model + 15 Device Shell gates            | no         |
| `test/image-contents.test.sh`                                    | built-rootfs gates + staleness note                    | no         |
| `apps/kitluy-device-shell/test/electron-pin.test.ts`             | the deferred manifest↔app equality check               | no         |
| `scripts/doctor.sh`, `scripts/setup-ubuntu-arm64-builder.sh`     | `unzip`                                                | no         |

### Allowlist verification

`PASS` — confined to `infra/kitluy-os-image` and `apps/kitluy-device-shell`. The
Store Hub tree was not touched (its suites re-run unchanged: 32/0 and 152/0).

## 4. Implementation details

### Why the runtime is fetched and not committed

Everything else the image installs is committed, because it is kilobytes of our
own source. Electron is 289 MB of somebody else's binary; committing it would
put that into every clone and every fetch for ever. So it is acquired the way
`rpi-image-gen` itself is — a pinned version plus the digest of the exact
artifact — and `fetch-electron.sh` refuses to unpack anything whose sha256 does
not match, discarding the bad download rather than leaving it for the next run.

TLS proves who served a file, not which file was served. The digest is what
makes the runtime reproducible.

### Why cage and not labwc

`labwc` is a general compositor: it has a desktop, and therefore a way out of
the application. `cage` shows one program and nothing else. On a shop counter
that difference is the whole point. `labwc` stays installed for the governed POS
release, which is a desktop-class app.

The retired `kitluy-terminal-session.service` ran `labwc -s terminal-bootstrap-ui`
— a compositor wrapped around a **text** program, which is why the first real
terminal showed a blank display (2026-08-13). That unit is left defined and
disabled rather than repurposed.

### The display now has one owner, and the old one is kept

`kitluy-bootstrap-screen.service` loses its wants symlink and stays **defined**.
It needs no compositor, no GPU and no Electron, so it is the surface that still
works on a board where the shell cannot start. The tests assert it survives.

### Sandboxing, and two hardening directives deliberately not set

`chrome-sandbox` is installed setuid root so the renderer keeps Chromium's
sandbox; the alternative is `--no-sandbox`, which trades the only boundary the
renderer has for a startup convenience. `RestrictNamespaces=` is therefore NOT
set — that sandbox is built on unprivileged user namespaces, and setting it
would leave the shell running with its own sandbox disabled.
`RestrictRealtime=` is not set either: a compositor legitimately asks for
realtime scheduling to pace frames.

`XDG_RUNTIME_DIR` comes from `RuntimeDirectory=`, not `/run/user/%U`, because
`ProtectHome=yes` makes `/run/user` inaccessible — the combination the retired
session unit had, and never ran with.

### The Khmer font is not cosmetic

The shell is Khmer-default. Without a Khmer face the first screen a Cambodian
installer sees is a row of empty boxes: the application working perfectly and
communicating nothing. `fonts-khmeros` is installed and asserted in both the
layer and the built rootfs; `fonts-dejavu-core` carries the Latin fallback for
the asset tag and the pairing code.

## 5. Verification performed

| Check                                              | Result  | Evidence                                                                                                                                                                                                             |
| -------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch-electron.sh` — real download                | `PASS`  | 289 MB, sha256 matched the pin, binary confirmed `ARM aarch64`                                                                                                                                                       |
| `systemd-runtime.test.sh`                          | `PASS`  | **171/0** (was 140/0)                                                                                                                                                                                                |
| — mutation: drop `fonts-khmeros`                   | `FAILS` | the gate catches it                                                                                                                                                                                                  |
| — mutation: drop `cage`                            | `FAILS` | the gate catches it                                                                                                                                                                                                  |
| — mutation: drop one Electron library              | `FAILS` | the gate catches it                                                                                                                                                                                                  |
| `rpi-image-gen.test.sh`                            | `PASS`  | 23/0/1                                                                                                                                                                                                               |
| `build-gates.test.sh`                              | `PASS`  | 43/0                                                                                                                                                                                                                 |
| `environment-gating.test.sh`                       | `PASS`  | 20/0                                                                                                                                                                                                                 |
| `package-bootstrap-runtime.sh`                     | `PASS`  | 10 components, cross-check clean                                                                                                                                                                                     |
| device-shell suite                                 | `PASS`  | **70/70** (was 66)                                                                                                                                                                                                   |
| device-shell typecheck + build                     | `PASS`  | —                                                                                                                                                                                                                    |
| Store Hub image suites (regression)                | `PASS`  | 32/0 and 152/0, unchanged                                                                                                                                                                                            |
| `pnpm secret:scan`                                 | `PASS`  | 2098 tracked files                                                                                                                                                                                                   |
| `scan-image-secrets.sh` (terminal overlay)         | `PASS`  | 16/0                                                                                                                                                                                                                 |
| Full terminal image build (QEMU cross-build)       | `PASS`  | exit 0; 8.9 GB raw / 734 MB compressed; classified DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED                                                                                                   |
| `image-contents.test.sh` vs the **rebuilt** rootfs | `PASS`  | **83/0/1** — Electron present and confirmed `aarch64`, `cage` installed, app/main/preload/renderer all present, no source maps, `chrome-sandbox` setuid root, a Khmer font present, text screen present-but-disabled |

## 6. Not run / not verified

- **No hardware.** No card was flashed and no Pi has booted this. Whether cage
  starts, whether the touchscreen registers input, and whether the Khmer text
  renders at the display's DPI are all unproven.
- **No Electron process has ever started**, here or anywhere: this workstation
  is x86_64 and the runtime is arm64.
- The Chromium library list is derived from Electron's documented Linux
  dependencies, not from `ldd` against the arm64 binary on a Pi. Every package
  name RESOLVED and installed during the build, so none is misspelled or absent
  from bookworm — but whether the set is COMPLETE for this binary is unproven,
  and a missing one would appear as a loader error at first boot.
- The image built here is a **development cross-build via QEMU** and is not
  hardware-certified.
- Built with `--no-interactive-access`: this specific artifact has no console
  and no SSH, and must NOT be flashed for bring-up. Rebuild with
  `KITLUY_DEV_SSH_PUBKEY` before putting it on a card.

## 7. Risks and known limitations

| Severity | Risk                                                        | Mitigation/follow-up                                                  |
| -------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| HIGH     | The shared-library list is unverified against a real Pi     | first boot will show it immediately; `ldd` on the board is the check  |
| MEDIUM   | cage + seatd + DRM on Pi 5 with Touch Display 2 is untested | hardware acceptance is the next task                                  |
| MEDIUM   | `chrome-sandbox` setuid root inside the image               | standard Electron requirement; the alternative is no sandbox at all   |
| LOW      | The shell app is committed build output                     | same convention as the firstboot closure; regenerated by the packager |

## 8. Blockers and open decisions

- **BLK-005** is unchanged and does not block this: it gates pilot and
  production, and development is explicitly authorized.
- Owner decision still open from Slice 1B §8 item 2: confirm the Electron
  **38.8.6** pin. The pin is now enforced in three places, so changing it is a
  one-line edit plus a re-fetch.

## 9. Next step

Hardware acceptance on a Pi 5 with Touch Display 2:

1. rebuild with `KITLUY_DEV_SSH_PUBKEY`, `--registration-url` and
   `--hardware-profile-key`
2. flash, boot, confirm the shell appears instead of the text screen
3. register, approve in the Admin Portal, and **type a pairing code** — the
   first end-to-end exercise of the transport built in `KL-P1-TERM-SHELL-002`

## 10. Truth statement

- Production modified: `NO`.
- Secrets in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO`. Source and gates are complete;
  everything about a running screen is `NOT RUN`.
