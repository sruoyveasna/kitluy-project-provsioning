# kitluy-device-shell — Pi Terminal Device Shell

The neutral graphical first-boot surface for a Pi Terminal. A hardened kiosk
(Electron on Wayland under `cage`) that shows the board's KitLuy registration
state and, once HET approves the board, takes an 8-character pairing code. It
carries **no Store authority** and offers **no path to a business application**
before activation (owner decision v2.0.0 §4–§5). Slice 1B — `KL-P1-TERM-SHELL-001`.

## What it shows

`booting` → `waiting for approval` (not registered / registering / awaiting
approval / unreachable, with a "no network" note) → `halted` (trust review or
contained) → `approved, not assigned` (the pairing keypad) → `assigned`. The
screen names the board by the same `KL-…` asset tag the Admin Portal lists, so
the person at the Pi and the person at the portal agree.

In this slice, submitting a code is shape-checked and answered
`PAIRING_NOT_AVAILABLE_IN_THIS_BUILD`; the pairing transport lands in Phase 3.

## Layout

- `src/model/code-entry.ts` — the pure keypad reducer (Crockford Base32, length 8),
  shared by the on-screen keypad and a USB keyboard-wedge scanner.
- `src/model/shell-state.ts` — the pure screen derivation from a `ShellSnapshot`;
  mirrors the firstboot agent's phase unions (guarded by `test/drift.test.ts`).
- `src/messages.ts`, `src/screens.tsx`, `src/App.tsx` — Khmer-default UI.
- `electron/device-state-files.ts` — read-only readers for the device's own state
  files (`/var/lib/kitluy/*.json`) and network state.
- `electron/snapshot.ts` — 2 s poll + `fs.watch` feed.
- `electron/main.ts` — the hardened kiosk window and the read-only IPC.
- `electron/preload.cts` — exposes exactly `getSnapshot` / `onSnapshot` /
  `submitPairingCode` on `window.kitluyShell`, nothing else.

## Electron

The shell pins its own Electron (`38.8.6`) — the image ships that exact version as
the arm64 runtime. The pnpm binary download is skipped in this repo (ADR-0004:
`pnpm.neverBuiltDependencies`); nothing here depends on it. Under `cage` the shim
launches Electron with `--ozone-platform=wayland`.

## Commands

```bash
pnpm --filter @kitluy-apps/kitluy-device-shell typecheck   # renderer + electron
pnpm --filter @kitluy-apps/kitluy-device-shell test        # vitest (no hardware)
pnpm --filter @kitluy-apps/kitluy-device-shell build       # vite + tsc electron
```

## Not done here

The image integration (arm64 Electron packaging, the `cage` session unit, the
`kitluy-pi-terminal.yaml` layer changes and the image test suites) is the next
part of Slice 1B and is verified against a built rootfs and a Pi 5. Wi-Fi join,
the sealed-identity stale-card guard and the real pairing transport are later
slices.
