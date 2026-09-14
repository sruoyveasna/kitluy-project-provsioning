# U1 hardware acceptance — bench runbook

| Field | Value |
| --- | --- |
| Date prepared | 2026-09-11 · Asia/Phnom_Penh |
| Status | **NOT EXECUTED.** Prepared for the bench; every step below needs physical access. |
| Claim | **HARDWARE VERIFIED is NOT claimed** and must not be until A/B/C/D all pass on the board. |

---

## 0. Why this is a runbook and not a result

The reflash and acceptance were authorised, and I could not execute them from this
session. Verified, not assumed:

```
lsblk        only nvme0n1 (system) and sr0 (DVD). No /dev/sd*, no /dev/mmcblk*.
sudo -n      "a password is required" — a raw block write cannot be performed.
```

And A/B/C/D each need a person regardless of the above: inserting a card, powering
the board, typing an 8-character code on the touchscreen, **looking** at the screen,
and **physically removing power** at five defined moments.

Nothing here was simulated and no substitute was performed. SSH file placement
would have produced a green report and a false `HARDWARE VERIFIED`.

---

## 1. The artifact — verify before writing

```
infra/kitluy-os-image/build/work/image-kitluy-pos-terminal-wayland-arm64/
  kitluy-pos-terminal-wayland-arm64.img

size    8,900,333,568 bytes
sha256  ca78cef6fdf374043c6382de2a5250b4a22ae82dc52b4f03a98bcb18d9b22a4e
```

> **This supersedes the first build (`e06e3c62…`). Do not flash that one.**
> It booted, registered, paired and reported `ready` for ever — and installed
> nothing, because the agent's poll loop never called the install pass. Found
> before the card was written; corrected, rebuilt, and gated so it cannot recur.

Confirm immediately before flashing:

```bash
cd ~/Development/HET_VEASNA_WORKSPACE/repos/het-kitluy-project
sha256sum infra/kitluy-os-image/build/work/image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img
# must print ca78cef6fdf374043c6382de2a5250b4a22ae82dc52b4f03a98bcb18d9b22a4e
```

A compressed copy is beside it (`.img.zst`, 998,664,882 B, sha256
`a307ab6093ef54d05d4df99c6c355d00e76c86a126cef7d2f30936fd3518047b`) if the
flashing tool prefers it.

---

## 2. Flash — onto a NEW card

**Keep the current card untouched.** It is the only physical recovery path if this
image does not boot, and every OTA test below depends on being able to fall back.
Label the old card with its date and set it aside; do not overwrite it.

```bash
lsblk -o NAME,SIZE,TYPE,TRAN,MODEL          # identify the card. CHECK THE SIZE.
sudo dd if=…/kitluy-pos-terminal-wayland-arm64.img of=/dev/sdX bs=4M status=progress conv=fsync
sync
```

`of=` is the whole device, not a partition. Read it twice.

---

## 3. Bring the board up

1. Card in, power on.
2. The screen shows the Device Shell: *"Waiting for approval"*, with the board's
   `KL-…` asset tag.
3. Approve it in the Admin Portal (`#/pending`) — the same tag.
4. Partner Portal → the Store → Provisioning → Terminals → issue a code; type it on
   the touchscreen.
5. Wait for activation.

**Target stack — the same one throughout, and the only one:**

```
database  127.0.0.1:54372     (kitluy-fresh; container supabase_db_kitluy-fresh)
API       172.16.21.17:54371
```

Both are baked into this image (`KITLUY_REGISTRATION_URL`, profile `KL-PI5-TERMINAL-DEV`).

**Note the Store Hub has moved.** Handoff 38 recorded it at `172.16.13.203`; it is
now advertising at **`172.16.13.204:7443`** (`pi5-jdeeeo.local`). This should not
matter — the terminal finds its Hub by mDNS `_kitluy-edge._tcp`, not by address, and
that is the design being relied on. If the terminal fails to find it, that is itself
a finding worth recording.

### Confirm SERVING before starting acceptance

```bash
export KITLUY_DEV_FLEET_DSN="postgresql://postgres:postgres@127.0.0.1:54372/postgres"
pnpm release:verify:terminal --target <ASSET-TAG> --ssh pi@<terminal-ip>
```

Expect `edge-status.json` phase `SERVING`. Also expect, at this point:

- running source `IMAGE_FALLBACK` (nothing installed yet) — **correct, not a failure**;
- the screen carries no software caption (a board that has never had a release says
  nothing, by design).

That is the **baseline**: image Device Shell, no release, terminal paired and serving.

---

## 4. Start the release source

```bash
export KITLUY_DEV_FLEET_DSN="postgresql://postgres:postgres@127.0.0.1:54372/postgres"
export KITLUY_DEV_PKI_DIR=~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki
pnpm release:serve        # defaults to 8791
```

It prints the exact `KITLUY_RELEASE_SOURCE=` line it is reachable on. The image bakes
`http://172.16.21.17:8791`; if the printed address differs, use §8 rather than rebuilding.

> **8791, not 8790.** The management API owns `PORT=8790` and the Admin Portal depends
> on it. A terminal pointed at 8790 reaches that service and gets its scaffold 404 —
> reachable, and wrong. `release:serve` now refuses a busy port by name.

---

## 5. Test A — a release reaches the board

Make a **visibly obvious** change (a heading, a colour — something unmistakable across
a room), then:

```bash
pnpm --filter @kitluy-apps/kitluy-device-shell build
export KITLUY_DEV_PKI_DIR=…/dev-pki
pnpm release:publish --version 0.4.12-a --target <ASSET-TAG>
```

Watch the board (the agent polls; `journalctl -fu kitluy-update-agent` shows it).

**Pass when all of these hold:**

- the visible change is on the touchscreen;
- the footer caption reads `0.4.12-a` with **normal** tone (not "Image software");
- `pnpm release:verify:terminal --target <TAG> --expect 0.4.12-a --ssh pi@<ip>` is green,
  including *the shell is running a RELEASE, not the image fallback*;
- the terminal is **still paired, still activated, still SERVING**.

The commit is after three consecutive healthy probes at 20 s — about a minute. That is
the owner-locked gate, not a delay to work around.

---

## 6. Test B — an unhealthy release rolls itself back

Publish a Shell that exits immediately (e.g. `process.exit(1)` at the top of the
Electron main entry), as `0.4.12-c`.

**Pass when:**

- the gate fails and **`0.4.12-a` is restored automatically** (up to 5 minutes);
- the screen works again and shows `0.4.12-a`;
- the journal records `failed_rolled_back` naming `0.4.12-c`;
- **publishing the same release again does not reinstall it** —
  `INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK`. A *different* release must still install.

---

## 7. Test C — real power removal

**Pull the mains. Not `reboot`, not a clean shutdown.** Five windows; cut during each,
then power on and check:

| # | Window |
| --- | --- |
| 1 | during download |
| 2 | during unpack |
| 3 | **between journal-intent and the symlink swap** |
| 4 | **between the symlink swap and the journal advance** |
| 5 | during the health gate |

Windows 3 and 4 are what the fsync ordering exists to survive — cut each **at least
three times**. `journalctl -fu kitluy-update-agent` shows which step is live.

**After every cut, assert:**

- the board boots to a **working Device Shell** — a release or the image fallback;
- the version on screen is the assigned one **or** the previous one, never a mixture;
- `journal.json` and the filesystem agree after reconciliation;
- the terminal is still paired and `SERVING`.

Never acceptable: a blank screen, a dangling `current`, or a half-unpacked payload
being run.

---

## 8. The release-source override — prove no reflash is needed

Once, on hardware:

```bash
ssh pi@<terminal-ip>
# No mkdir: kitluy-update-agent.service now creates /persistent/shared/kitluy itself
# (ExecStartPre=+, outside the sandbox). If it is absent, the agent is not running.
echo 'KITLUY_RELEASE_SOURCE=http://<new-ip>:8791' | sudo tee /persistent/shared/kitluy/release-source.env
sudo systemctl restart kitluy-update-agent
journalctl -u kitluy-update-agent -n 5     # expect sourceFrom=override
```

Then publish once more and confirm it installs from the new endpoint. Reboot and
confirm the override **survives** — that is the property that makes a moved
workstation cost nothing.

This is configuration, not deployment: nothing is copied in, and the release still
arrives through the governed path.

---

## 9. Test D — tampering is refused while the good release keeps running

With a healthy release running:

**D1 — tampered bytes.** Publish, then flip a byte *inside* the artifact on the
workstation (appending proves nothing — the device reads exactly
`artifactSizeBytes`):

```bash
F=build/releases/<release-id>/artifact.tar.gz
python3 - "$F" <<'PY'
import sys
p=sys.argv[1]; b=bytearray(open(p,'rb').read()); b[len(b)//2]^=0xff
open(p,'wb').write(b)
PY
```

Expect `ARTIFACT_DIGEST_MISMATCH`, **nothing staged or activated**, and the screen
unchanged throughout.

**D2 — tampered manifest.** Alter a manifest field after signing. Expect
`SIGNATURE_INVALID` **before a single artifact byte is fetched**.

Both must leave the running release untouched and be visible without SSH (the
journal line and the screen caption).

---

## 10. Recording the result

`HARDWARE VERIFIED` is claimable only when **A, B, C and D have all passed on the
physical board with no SD-card change between the OTA tests**. Anything less is
`IMAGE VERIFIED` with the failing step named.

If a step fails: stop there, diagnose, make the smallest U1 correction, and record
**whether that correction needs another image build and reflash** — a device-side
JavaScript fix does not; a change to a systemd unit, the launcher, `image.env` or the
trust anchor does.

---

## 11. Current state, for whoever picks this up

- Image built and `IMAGE VERIFIED`: **106/106** built-rootfs, 17/17 secret scan, all
  four image suites green (`build-gates` 57, `systemd-runtime` 215,
  `environment-gating` 20, `rpi-image-gen` 29).
- The shipped agent is confirmed to reach the install pass — checked in the built
  rootfs, not only in the source tree.
- Development stack `:54372` at **122/122** migrations; both boards `active`; **no
  release assigned** (every proof release was withdrawn through `revoke_release_v1`).
- Store Hub `pi5-jdeeeo.local` is **up** at `172.16.13.204:7443` and advertising.
- Nothing committed or pushed. Three migrations created this slice (0221, 0222, 0223),
  applied to the local development stack only.
