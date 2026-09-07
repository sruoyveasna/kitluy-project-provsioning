# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                        |
| ------------------ | ----------------------------------------------------------- |
| Task ID            | `KL-P1-TERM-SHELL-001` (Slice 1B — app source, part 1 of 2) |
| Task title         | Pi Terminal Device Shell — graphical first-boot app         |
| Product/build      | KitLuy Suite — Pi Terminal image                            |
| Primary agent      | Claude (Fable 5.1)                                          |
| Status             | `PARTIAL` — app source + tests done; image integration not started |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                 |
| Worktree           | `repos/het-kitluy-project`                                  |
| Base commit        | `0a30a74`                                                   |
| Final commit       | `UNCOMMITTED`                                               |
| Handoff date       | `2026-09-04`                                                |
| Requested reviewer | Owner (Veasna)                                              |

## 1. Outcome

A new app, `apps/kitluy-device-shell` (`@kitluy-apps/kitluy-device-shell`), is the
neutral graphical first-boot surface for a Pi Terminal: a hardened kiosk
(Electron on Wayland under `cage`) that shows the board's KitLuy registration
state and, once HET approves the board, takes an 8-character pairing code. It
carries **no Store authority** and offers **no path to a business application**
(owner decision v2.0.0 §4–§5).

The whole app is built and verified WITHOUT hardware: renderer and Electron-main
typecheck clean, the app builds (`vite` + `tsc`), and **54 tests pass** across 7
files — the pure keypad reducer, the pure screen-state model, the screens in both
locales, the read-only device-state readers, the preload attack surface, the
Electron pin, and a **drift guard** that imports the firstboot agent and fails
(at compile time for the phase unions, at run time for the behaviour) if the shell
and the agent ever disagree on registration/pairing semantics.

Slice 1B's second half — packaging arm64 Electron into the image, the `cage`
session unit, the `kitluy-pi-terminal.yaml` layer changes and the image test
suites — is **not** in this handoff; it needs a built rootfs and a Pi 5.

## 2. Source-of-truth checked

| Source | Version | Section | Result |
| ------ | ------- | ------- | ------ |
| Owner decision (terminal transport & Factory Enrollment) | v2.0.0 | §4–§5 | aligned (generic image, graphical first boot, no app before activation) |
| Development plan | approved 2026-09-03 | Slice 1B | followed; Electron pin decided 38.8.6 (plan recommended 38.x); drift/preload/screens tests as specified |
| firstboot agent | current | registration-state.ts / pairing-state.ts / bootstrap-state.ts / image-env.ts | mirrored; guarded by drift test |

## 3. Files inspected

- `services/kitluy-device-firstboot-agent/src/{registration-state,pairing-state,bootstrap-state,image-env}.ts` and `src/bin/hub-pairing-ui.ts` (code format, semantics)
- `apps/kitluy-pos-desktop-app/{package.json,tsconfig*.json,vite.config.ts,index.html,electron/main.ts,electron/preload.cts}` (build shape + hardening patterns)
- `pnpm-workspace.yaml`, `tsconfig.base.json`, root `package.json` (`pnpm.neverBuiltDependencies`)

## 4. Files changed

| Path | Change summary | Why | Generated? |
| ---- | -------------- | --- | ---------- |
| `apps/kitluy-device-shell/**` (new) | The whole app: scaffold, `src/model/{code-entry,shell-state}.ts`, `src/{messages.ts,screens.tsx,App.tsx,styles.ts,main.tsx,bridge.ts}`, `electron/{device-state-files,snapshot,main.ts,preload.cts}`, 7 test files, README | Slice 1B app | no |
| `services/kitluy-device-firstboot-agent/src/index.ts` | Additive barrel exports of the four display-state modules (registration/pairing/bootstrap state, image-env) | so the shell's drift test can assert against the real definitions | no |

### Allowlist verification

`PASS` — one new app under `apps/` and one additive re-export line in the agent
barrel. The shell imports the agent ONLY as a devDependency, ONLY in the drift
test; it copies the agent's semantics rather than depending on it at runtime
("two devices, two images, two sources"). No app imports another app's internals.

## 5. Implementation details

### Functional behavior

Screens: `booting` → `waiting_for_approval` (NOT_REGISTERED / REGISTERING /
AWAITING_APPROVAL / UNREACHABLE, with a "no network" note) → `halted`
(trust_review / contained) → `approved_unassigned` (keypad) → `assigned`. The
board is named by the `KL-…` asset tag derived from the registration key
fingerprint — the same string the Admin Portal lists. Code entry is a pure
reducer over Crockford Base32 length 8, shared by the on-screen keypad and a USB
keyboard-wedge scanner; out-of-alphabet keys ignored, I/L→1, O→0, U ignored.
Submitting a complete code is shape-checked in the main process and answered
`PAIRING_NOT_AVAILABLE_IN_THIS_BUILD` — the code is never logged or persisted.

### Schema/data/migrations

`NONE`.

### APIs/events/jobs/webhooks

IPC only, all local: `getSnapshot`, `onSnapshot`, `submitPairingCode` on
`window.kitluyShell`. The preload exposes exactly those three and no generic
pass-through (asserted by `test/preload-surface.test.ts`).

### Permissions/audit/security

Kiosk hardening: `contextIsolation`, `sandbox`, no `nodeIntegration`, null menu,
`will-navigate` and `setWindowOpenHandler` both deny. The shell runs unprivileged
and only READS `/var/lib/kitluy/*.json` and sysfs — it writes nothing and never
touches a private key. No Store authority artifact exists in the app.

## 6. Verification (actual results)

Run with Node v22.23.0.

| Check | Result |
| ----- | ------ |
| `tsc -p tsconfig.json --noEmit` (renderer) | PASS |
| `tsc -p tsconfig.electron.json --noEmit` (main) | PASS |
| `vitest run` | PASS — 54/54 (7 files) |
| `vite build && tsc -p tsconfig.electron.json` | PASS (dist/index.html + dist-electron/electron/{main,preload.cjs,snapshot,device-state-files}.js) |
| `prettier --check` (new files) | PASS (after `--write`) |
| `eslint` (new files + agent index) | PASS (no findings) |
| firstboot agent `tsc` build after barrel change | PASS |

Electron `38.8.6` is pinned in the app's own devDependencies (the image will ship
that exact arm64 version). Its binary download is skipped by
`pnpm.neverBuiltDependencies` (ADR-0004); nothing here depends on it.

## 7. Not run / not verified

- **No hardware.** Nothing has run on a Pi. No Electron process has actually
  launched (no binary on this x86 workstation by design).
- **Image integration not started**: arm64 Electron packaging in
  `package-bootstrap-runtime.sh`, the `kitluy-device-shell.service` cage unit,
  the `kitluy-pi-terminal.yaml` layer swap (labwc→cage + Chromium libs), the
  manifest `device-shell` component and tty1 owner flip, and the
  `image-contents`/`systemd-runtime` additions — all pending.
- **electron-pin ↔ manifest equality** test is stubbed (asserts an exact 38.x
  pin); it gains the manifest comparison when the manifest block is added.

## 8. Next steps

1. Slice 1B image integration (own task record): package Electron `38.8.6` arm64
   into the terminal image, add the `cage` session unit replacing the text
   screen, swap the layer to `cage` + Chromium runtime libs, extend the image
   tests, build a rootfs and inspect; then hardware acceptance on a Pi 5 +
   Touch Display 2.
2. Owner decision to confirm the Electron 38.8.6 pin (plan recommended 38.x).
3. Commit is the owner's call (not committed).
