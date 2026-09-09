# Terminal Settings, and the privileged broker that makes it possible

**Date:** 2026-09-08
**Status:** **TESTED-IN-DEV — no hardware run yet.** Both images rebuilt.
**No cloud write was performed.**

---

## 1. What was asked

> "build some device config UI on our image place it in setting example like
> network configuration and … that we need and it usally crack example printer
> set up."

and, first:

> "check migration file do we have table to store 4 PIN digit of PI Terminals yet"

---

## 2. The PIN answer: NO, and it would not live where it was looked for

Verified independently rather than taken from the register: no `pin_verifier`,
`pin_hash`, `pin_salt` or `terminal_pin` in `hub/migrations/`,
`supabase/migrations/`, `services/` or `packages/`, and no PIN screen in
`apps/kitluy-device-shell/`.

**It is not a cloud migration.** Owner decision v2.0.0 §12 locks the **Store Hub**
as the authoritative OFFLINE verifier; the Hub holds only a salted Argon2id-class
verifier and the raw PIN is never stored anywhere. So it is a **Hub** migration —
the next free number is `hub/migrations/0042`.

**It is also blocked, not merely unbuilt.** §10 requires PIN setup only after
pairing, assignment, connection *and application install* succeed. The ladder in
`terminal-presentation.ts` is
`hubActive → issued → redeemed → hubPaired → activated → appInstalled → pinSet → active`;
the fleet is at `activated` and rung 6 is not built. Architecturally it is
stricter still: the Hub IS the verifier and the Terminal reaches it over mTLS
that requires activation. Owner chose **Settings first, PIN after**.

---

## 3. The constraint that shaped Settings

`kitluy-device-shell.service` runs as `kitluy-terminal` with:

    CapabilityBoundingSet=          (empty)
    NoNewPrivileges=yes
    ProtectSystem=strict
    ReadWritePaths=/var/lib/kitluy/terminal

It therefore **cannot** join a Wi-Fi network or set the backlight. That hardening
was not weakened. Instead the privileged verbs moved to a root broker and the
Shell became its client:

```text
Device Shell (kitluy-terminal, zero capabilities)
      │  13 named preload methods — no generic send/invoke
      ▼
main process — re-validates every argument
      ├── device-config-broker (root, unix socket 0660 root:kitluy-terminal)
      │        └── network.ts: scanAccessPoints / joinNetwork / readNetworkStatus
      ├── device-info  (unprivileged file reads)
      └── printer      (TCP 9100 + a file in the Shell's own writable directory)
```

`network.ts` already existed, tested, and is what the Hub console uses; no network
logic was rewritten.

### Why the printer does NOT go through the broker

A network receipt printer is a TCP socket and a file under
`/var/lib/kitluy/terminal` — both things the Shell's own user can already do.
Routing them through root would add power to the broker for no gain, and the
whole argument for the broker is that its verb list stays short. **USB printers
are excluded for the same reason**: reaching one needs the `lp` group, which is a
privilege change and a separate owner decision. The screen says so rather than
offering a control that silently fails.

---

## 4. What was built

| File | What it is |
| --- | --- |
| `services/…/src/device-config.ts` | The whole decision surface: six verbs, and the refusals that bound them |
| `services/…/src/bin/device-config-broker.ts` | Socket only; kept small so the security argument lives in one place |
| `…/kitluy-pi-terminal.rootfs-overlay/etc/systemd/system/kitluy-device-config.service` | Root, `RuntimeDirectory`, `ReadWritePaths=/etc/wpa_supplicant` and `-/sys/class/backlight` |
| `apps/kitluy-device-shell/electron/device-config-client.ts` | Client; a missing broker is an ANSWER, never a crash |
| `apps/kitluy-device-shell/electron/device-info.ts` | Hostname, serial, image version, class, environment |
| `apps/kitluy-device-shell/electron/printer.ts` | Config, validation, ESC/POS test receipt |
| `apps/kitluy-device-shell/src/model/settings.ts` | Pure: signal bars, network ranking, form validation |
| `apps/kitluy-device-shell/src/settings.tsx` | Four tabs, pure presentational, km-KH + en-US |

---

## 5. Evidence

| Check | Result |
| --- | --- |
| `@kitluy-services/kitluy-device-firstboot-agent` | **495 passed / 9 skipped** (was 455; +40) |
| `@kitluy-apps/kitluy-device-shell` | **119 passed** (was 72; +47) |
| Terminal image gates (5 suites) | **357 passed, 0 failed** |
| Store Hub image gates (6 suites) | **300 passed, 0 failed** |
| Typecheck, both packages | clean |

**Mutation-tested, because a guard that cannot fail is not a guard:**

- Smuggling a `runAnything` method into the preload fails
  `exposes no method the bridge type does not declare`, by name.
- Reverting the Hub storage key to `openssl rand` fails exactly the two tests
  written for it (see `33_…`).

**Properties the tests pin, which are decisions rather than behaviour:**

- **The Wi-Fi passphrase never comes back out** — not in a success, not in a
  refusal, and specifically not when `wpa_passphrase` fails and quotes its own
  input. It is also dropped from renderer state on every outcome, because this
  screen is wall-mounted and the installer walks away.
- **Nothing privileged runs on an invalid request.** Malformed JSON, non-hex
  SSID or an out-of-range PSK is refused before any dependency is touched.
- **An unterminated line is abandoned, not buffered** — a client that never
  sends a newline cannot grow the root process.
- **Brightness is floored at 1 in two places**, the slider and the broker. A dark
  till reads as broken and the only recovery is a reboot.
- **Networks are deduplicated by real SSID bytes, not the printable name.** Three
  ceiling access points showed one name three times; but two networks differing
  only by a control byte must stay separate or the wrong one is joined.

---

## 6. Known gaps, recorded rather than discovered later

1. **Settings is NOT locked.** Anyone standing at the Terminal can open it. The
   4-digit PIN is what will gate it and is blocked per §2. Stated in
   `settings.tsx`'s header so it is not a surprise.
2. **`@kitluy/printing` is a 9-line stub** — one exported constant. The ESC/POS
   bytes here are local and deliberately minimal; when the POS application brings
   real receipt rendering, that is what belongs in the package and this screen
   should call it. It must not grow into a printing subsystem here.
3. **USB printers unsupported** (see §3).
4. **`kitluy-terminal-client` is absent from the image** by design —
   `ConditionPathExists` makes the unit inert. That is rung 6, not built.

---

## 7. What is NOT claimed

- No hardware run. Both images are built and gate-green; neither has booted.
- Nothing deployed to hosted development or cloud.
- The broker has not been exercised against a real radio. Its logic is tested
  with injected dependencies; `scanAccessPoints`/`joinNetwork` are the pre-existing
  tested implementations, but the socket has never carried a real join.
