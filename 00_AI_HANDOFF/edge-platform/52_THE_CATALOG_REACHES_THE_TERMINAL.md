# 52 — The real catalog and the money contract reach the Pi Terminal (T1-REAL-OPERATIONS-001, slice 1)

**Date** 2026-09-19 · **Area** edge-platform / laundry · **Status** IMPLEMENTED · TESTED · RELEASED to the development Terminal (`0.1.0-catalog-202609191140`, `fae08e69…`) · HARDWARE VERIFIED (the running POS reads the catalog and money from its verified configuration; the Items grid itself needs the owner's PIN to be seen) · **Commits** `e478925` on `dev` (worktree `4b9c069`). Plan: `docs/decisions/kitluy-t1-real-operations-plan-owner-decision-v1.0.0.md` (KLD-2026-09-19-T1-REAL-OPERATIONS-001).

## 1. What this slice does

The designed price list (30 per-piece services in two families — Dry Clean, Wash & Press — plus Wash & Fold at 4,000 KHR/kg, 5 categories, 24 garment-checklist types) now travels **cloud → Store Hub → Pi Terminal** on the only path the architecture allows: WS-05 tables → the Hub-identity-authenticated projection door → the Hub's SIGNED configuration snapshot → the terminal's digest-checked delivery → the face. No fixture, no default, no price invented anywhere; the Store's money contract (KHR, exponent 0, whole-kg-up minimum 1, location code, optional FX and express) rides beside it as the Hub's own `pricing` section, so what the face shows is what the Hub will charge in slice 2.

## 2. What exists now

| Tier | Piece |
| --- | --- |
| Cloud (group 0233) | `kitluy_laundry.service_families / catalog_categories / garment_types` (vocabulary, never a price; RLS enable+force; governor read policies); `read_hub_terminal_projections_v1` grows `catalog` (effective KHR price per service for the Hub's Location — Location book over Store base book, KBR-PRC-002 — with `content_hash`) and `money` (the Location's PUBLISHED `laundry.money.v1`). Applied on `kitluy-fresh` and `repo17`. |
| Loader | `pnpm dev:catalog:load` (`scripts/development/load-laundry-catalog.mjs`, file `fixtures/laundry-catalog.designed.json`): idempotent by code; a price change closes the open window and opens a new one; `--pause-others`; `--khr-per-usd` is the ONLY way FX enters. Run on `kitluy-fresh`: 31 services active, the two demo services paused, `laundry.money.v1` v1 published for `DEMO-PP-01`. |
| Producer + Hub | envelope carries `catalog` + `money`; the Hub verifies their shape, publishes `terminal_profiles + pricing + catalog` in one signed snapshot (`publishDevelopmentConfiguration({ extraSections })`) and republishes only when grants, catalog hash or money changed. Hot-deployed `hotfix-4b9c069` (sha256 `2a9e8c12…`). |
| Terminal | `PiTerminalRuntime.configurationRead()` hands the VERIFIED sections over `kitluy:t1:configuration:read` (preload `kitluyT1Configuration`, read-only, no input); `src/bootstrap/configuration-sections.ts` (neutral), `src/vertical/laundry/catalog-section.ts` (closed shape; `billableKilograms` as data); `face/ports.ts` `catalogAnswerFromSections`; one card per delivered family (Khmer name beneath), the per-piece grid per family with real prices, the kg offering, the garment checklist. |

## 3. Proof

- Tests: hub-agent terminal-sync 23 + integration 10 (sections published; unchanged → nothing; catalog hash alone → `because catalog`; FX alone → `because money`); app 161/2 skipped incl. `laundry-catalog-delivery` 7; Hub image static suites unchanged.
- Hardware 2026-09-19 11:20–11:50 +07:00: producer `KL-CFADA8C75001: 2 terminal(s) · catalog 31 services 6707ae28d74d · money published`; Hub `terminal sync applied … configuration: v6 (6 grants; terminal_profiles+pricing+catalog; because catalog,money)`; active snapshot v6 sections `catalog` 21,797 B / `pricing` 240 B / `terminal_profiles`; both terminals stayed SERVING and moved to configuration v6. Terminal `KL-54A3320E1201` installed and committed `0.1.0-catalog-202609191140`; over DevTools in the running POS, `window.kitluyT1Configuration.read()` answered `delivered v6` with `catalog` (31 services; families "Wash & Fold / បោកបត់", "Dry Clean / បោកស្ងួត", "Wash & Press / បោកអ៊ុត"; `WF-KG 4000`, `DC-SUIT_2PC 25000`, `DC-DRESS_SHIRT 8000`; 24 garment types) and `pricing` (KHR, whole-kg-up min 1, `DEMO-PP-01`, no FX yet). Diagnostic drop-in removed afterwards.

## 4. Lessons of the run (recorded so they are not paid twice)

- `release-publish.mjs` packs the PRE-BUILT `apps/kitluy-pos-desktop-app/release-payload/`; run `pnpm --filter @kitluy-apps/kitluy-pos-desktop-app build:release-payload` in the release worktree first, or the previous payload ships under a new version (`310eefda…`, `0.1.0-catalog-202609191100`, is such a stale re-pack — superseded, harmless).
- The release service serves bytes from the MAIN tree's `build/releases/<id>/`; a worktree publish must copy its `build/releases/<id>/` there, or the update agent refuses `ARTIFACT_SOURCE_UNAVAILABLE`.
- The worktree's untracked image-build leftovers (`infra/edge/raspberry-pi/pi-terminal-image/build` symlink, `build.worktree-own/`) make `buildId` read `-dirty`; the content is the clean commit. Owner approval requested to remove them.
- The board has no `ss`; read `/proc/net/tcp` (`:2406` = 9222).

## 5. Open / next

- Slice 2 (a real Booking on the Hub: quote → confirm → cash KHR/USD → receipt record) needs the owner's KHR/USD rate (`pnpm dev:catalog:load --khr-per-usd <rate>` republishes the money contract; the Hub picks it up within a minute).
- ~~The old terminal `KL-1CB3577C26A7` keeps its previous release until assigned~~ — closed by `pnpm release:assign` (`9bbc938`); both running boards hold `0.1.0-catalog-202609191140`.
- ~~The new board refuses the workstation's SSH key~~ — an address mix-up, not a key problem (§7: the board is 172.16.21.43).
- Settings verbs (Wi-Fi, brightness) on the two running boards stay unreachable until they run the fixed agent (§7 cause 1) — reflash, or an agent release carrying `2354af3`.
- Hub image rebuild (hub-sync + these bundles) still pending after the owner's first-boot scenario.

## 6. Amendment the same day: the Terminal PIN moves to AFTER pairing (KLD-2026-09-19-PIN-AFTER-PAIRING-001)

Before flashing, the owner corrected the first-boot flow: the PIN is created right after pairing and activation, on the Store Hub — not at first boot. Built as `04f3b2d` (+ overlays `5e16c5e`): the Device Shell shows the PIN screen only when APPROVED + PAIRED + edge `SERVING` + Hub `setup_required` (read from `terminal/edge-status.json`), then the install; the broker's `pin.setup` forwards the two entries to the Hub's setup route over the bridge and maps the Hub's verdicts; the sealed first-boot PIN and its registration at pairing are gone. The Terminal image is rebuilt from worktree `bf89766`; read-back and hashes follow in this section when done.

**Image read-back (2026-09-21, worktree `bf89766` = dev `04f3b2d` + overlays `5e16c5e`) — IMAGE VERIFIED, not boot-tested.** `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` sha256 `7d0a5e9e396e501d5a7105d00f4471fe49cb4b88bb21aa00b3125e19636a3900` (998 821 173 B); raw `.img` `df7e4875d77bddf5cde10b071aff827e2fb743fdd60219a67810c7b897820b3f`; `.img.sparse.zst` `fd0b44d3…`; IDP `9b2bab34…` — all four equal to the manifest. Overlay 112/112 (100 files + 12 links). In the image: `device-pin.js` carries no seal and `registerDevicePinWithHub` with the Hub setup route; `device-config.js` forwards; `terminal-edge.js` has no unseal; Shell `shell-state.js` gates on `setup_required` with no first-boot gate; `device-state-files.js` reads `edge-status.json`; bundle `index-D7HSXeik.js` carries "The Store Hub keeps this PIN"; Electron 38.8.6 present. Suites: rpi-image-gen 23/0/1, build-gates 67/0, environment-gating 20/0, systemd-runtime 245/0, image-contents 117/0/0, secret+binding scan 17/0. This supersedes the 2026-09-18 image (`41109b3d…`, first-boot PIN) for flashing.


## 7. The first hardware run of the PIN-after-pairing image (2026-09-21) — what happened, and the fix (`ad68de1` + `2354af3`, overlays `4faf8b0` + `c740087`)

The owner flashed `7d0a5e9e…` on a new card (board `KL-5CA5F71B726A`, hostname `pi5-wkhfdt`, **172.16.21.43** — not 172.16.30.242, which is an unrelated Raspberry Pi), paired it, and typed `1234` twice on the Shell's PIN screen. The Shell answered that the Store Hub did not accept / was not reached; a moment later the POS appeared; on the T1 screen `1234` did not unlock, an old PIN did.

**Timeline from the board's own journals.** 09:48:13 terminal-edge `SERVING` (Hub `172.16.13.203:7443`, PIN state `setup_required` → the Shell shows the PIN screen). 09:48–09:50 the owner types the PIN twice; the bridge logs NOTHING in that window. 09:50:11 the update agent's poll installs the POS release; the Shell is stopped; the POS starts. 09:50:12 the POS's first bridge calls (`pin.status → 200`, still `setup_required` → the POS shows its create-PIN fallback face). 09:50:29 `pin.setup → 200` from the POS: the PIN the owner typed THERE is the one the Hub holds (`setAt 02:50:29Z`).

**Root causes — two, both reproduced on the board, neither the flow.**

1. **The Shell could never reach the broker.** `sudo -u kitluy-terminal node -e 'net.connect("/run/kitluy-device-config/socket")'` → `EACCES` on BOTH boards. The broker chowns its socket to `root:kitluy-terminal 0660`, but the `RuntimeDirectory` around it is `0750 root:root` (the unit has no `Group=`); the Shell's user cannot enter the directory, so `connect()` fails before the socket's mode is consulted. Every Settings verb (Wi-Fi, brightness) and the Terminal PIN failed on that leg since the first image; nobody had used Settings on a board, so it went unnoticed. The Shell's client reports `DEVICE_CONFIG_UNAVAILABLE` → "The Store Hub did not accept the PIN — …".
2. **The setup call carried no `Idempotency-Key`.** The same POST driven from root through the bridge reached the Hub and was answered `422 VALIDATION_FAILED "an Idempotency-Key header is required"`. The broker's `bridgePinSetupCall` sent none (the POS's client mints `t1-pin-<verb>-<uuid>`), so even a reachable broker would have ended in `HUB_REFUSED`.

**What was NOT the cause (recorded because `ad68de1` claimed it).** `ProtectSystem=strict` on the broker unit does not block `connect()` to the bridge socket: run under the unit's exact sandbox with `systemd-run`, the connect succeeded — the kernel exempts sockets from the read-only-filesystem write check. `ReadWritePaths=/run` was removed again in `2354af3`; `-/var/lib/kitluy` stays (the posture-file write under strict is real).

**Fix.**

| Where | Change | Commit |
| --- | --- | --- |
| `device-config-broker.ts` | `shareSocketWithGroup()`: the directory `0750` and the socket `0660`, both group-owned by `kitluy-terminal` — exactly as the terminal-edge bridge already does | `2354af3` |
| `device-pin.ts` | every setup attempt carries `idempotency-key: shell-pin-setup-<uuid>` (Hub shape `/^[A-Za-z0-9_.:-]{1,96}$/`) | `2354af3` |
| broker unit | `After=kitluy-terminal-edge.service`; `ReadWritePaths=-/var/lib/kitluy` (posture file) | `ad68de1`, corrected `2354af3` |
| update agent | `terminalPinSetupPending()`: a FIRST install of `kitluy-terminal` waits while `edge-status.json` says `SERVING` + `setup_required` (`kitluy.update.waiting TERMINAL_PIN_SETUP_PENDING`); updates of an installed POS are never held | `ad68de1` |
| Device Shell `electron/main.ts` | after a confirmed `pin.setup`, ask the agent for `update.check` | `ad68de1` |
| `device-pin.ts` | posture write after the Hub's 200 is best-effort | `ad68de1` |

Tests that would have caught it and now exist: the REAL bridge request over a unix socket (route, body, `Idempotency-Key` shape), the directory sharing, a missing bridge rejects (`device-pin.test.ts`, `device-config-broker.test.ts`); `terminalPinSetupPending` cases. Agent suite 910 passed (2 `.db.test` failures are the shared-DB fixture state); Device Shell 169; `systemd-runtime.test.sh` 245.

**For the owner's current boards.** `KL-5CA5F71B726A`'s PIN is the one created on the POS face (the owner reports `1111`); the Hub, the catalog release and the seat are in order. To make it `1234`: the application's change-PIN action, or `hub-agent reset-terminal-pin` on the Hub and the create face again. Settings (Wi-Fi/brightness) on BOTH running boards stay unreachable until they carry the new agent — the fix ships in the image and in the next agent release; a runtime drop-in cannot fix a chown the process does at start.

**SSH note.** The earlier "new board rejects the SSH key" was an address mix-up: `172.16.30.242` is an unrelated Pi (`raspberrypi`, docker/tailscale). The two terminals are `172.16.21.43` (`KL-5CA5F71B726A`, `pi5-wkhfdt`) and `172.16.30.241` (`KL-54A3320E1201`, `pi5-rsylze`); the Store Hub is `172.16.13.203` (`pi5-ivldvf`). The image's baked key works on both terminals.

**Image read-back attempt 1 (11:15, worktree `d474485` = dev `2354af3` + overlays `c740087`).** Overlay 112/112, hashes equal to the manifest, every fix present — superseded before use by the 15 s PIN-hold recheck (`800ecb2`).

**Image read-back attempt 2 (11:58, worktree `91d1bb9`) — REJECTED, not shipped.** Overlay 111/112: `usr/lib/kitluy/lib/firstboot-agent/edge-bridge.js` DIFFERED from the commit. Cause: the shared build worktree `wt-t1-face-release` is no longer mine alone — a parallel session was implementing slice 2 in it and rebuilt the agent dist two seconds after my build started (their `edge-bridge.ts`, committed there afterwards as `6cee466`), and `build-rpi-image.sh` runs `package-bootstrap-runtime.sh` itself, so the image took their compiled file. Nothing was wrong with their code; an image that matches no commit on this branch is simply not shippable. **Convention from now on: an image build gets a worktree nobody else is in** — `worktrees/kitluy-ecosystem/wt-pin-image`, detached at the exact commit, `pnpm install`, `pnpm --filter @kitluy-apps/kitluy-device-shell... build` (the shell needs `@kitluy/localization` built first in a fresh tree), then packaging must leave `git status` CLEAN before the build is allowed to start.

**Image read-back (2026-09-21 12:23, worktree `wt-pin-image` detached at `54c123d` = dev `2354af3` + `800ecb2` + overlays `c740087`/`54c123d`) — IMAGE VERIFIED, not boot-tested. THIS is the image to flash.** `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` sha256 `260db65c43d6116d021cc5681a99458af00594f875dcdabed18d72cf6f2c1f20`; `.img.sparse.zst` `74117a0e8870aff1534051161a6b07a6d3f2e8fddfcf22edda81a158da50d870`; raw `.img` `6fee32fc85f74ffe46310b1984a5794212517e586da3a49230a1f5f142737c69`; tarball `01d62642…` — all equal to `kitluy-pi-terminal-dev-manifest.json`. Overlay **112/112** (100 files + 12 links) hashed equal to the commit; `edge-bridge.js` byte-identical to `git show 54c123d:` (the check attempt 2 failed). Read out of the final erofs with the builder's `dump.erofs`: `device-config-broker.js` carries `shareSocketWithGroup`; `device-pin.js` sends `idempotency-key`; `update-bootstrap.js` carries `terminalPinSetupPending` and `PIN_HOLD_RECHECK_SECONDS = 15`; Shell `main.js` asks `update.check` after the PIN; the broker unit has `After=kitluy-terminal-edge.service`, `ReadWritePaths=-/var/lib/kitluy` and no `ReadWritePaths=/run`. Suites: rpi-image-gen 23/0/1, build-gates 67/0, environment-gating 20/0, systemd-runtime 245/0, image-contents 117/0/0, secret+binding scan 17/0. **Supersedes `7d0a5e9e…` (and the unshipped `4a49860a…`, `9c47ced4…`).** Expected on a fresh card: register → approve → pair → (the Hub provisions the terminal by itself) → Shell PIN screen → the PIN twice → "Installing KitLuy" (seconds, not minutes) → T1 → the same PIN.
