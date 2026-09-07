# BRINGUP-003 — Store Hub Edge Runtime Foundation (Gate A)

| Field     | Value                                         |
| --------- | --------------------------------------------- |
| Date      | 2026-09-01                                    |
| Area      | edge-platform                                 |
| Branch    | `claude/fix-firstboot-esm-and-ssh-hostkeys`   |
| Baseline  | `0a30a74`                                     |
| Board     | `pi5-jwwudf` @ 172.16.13.206 (Raspberry Pi 5) |
| Status    | **GATE A ACHIEVED**                           |
| Committed | **No.** Worktree left dirty by instruction.   |

---

## 1. What this session was for

BRINGUP-002 proved a Store Hub reaches `ACTIVE` on hardware. It did not produce
a Store Hub: the device was trusted and the appliance did not exist.

Three independent reasons, all now closed:

1. **The Hub agent was in no flashable image.** Its unit was defined in
   `scripts/profiles/store-hub.sh`, sourced only by `build-image.sh` — the
   legacy path that refuses to emit an `.img` (exit 3). The real builder never
   sourced it. Meanwhile `kitluy-store-hub.yaml` published an avahi
   `_kitluy-edge._tcp` advert on 7443, so every card advertised a service that
   could not exist.
2. **Nothing could listen on 7443.** `bin/hub-agent.ts` deliberately withheld
   the listener pending BLK-005 signer custody. It was a one-shot startup
   _decision_, not a daemon.
3. **The Hub database could not start.** `hub-storage-provision` refuses without
   a programmed OTP key, and burning fuses is irreversible and unapproved.

## 2. Owner decisions taken during the session

- **Listener: wired, development-only.** Refuses outside
  `KITLUY_ENVIRONMENT=development`; BLK-005 stays unanswered for pilot and
  production. Flagged for independent review (§9).
- **D-27: unit and enable symlink removed.** This is what the repository already
  demanded — two suites asserted the ticket enrollment agent was absent and both
  were failing.
- **NVMe wipe authorised.** The drive carried an empty ext4 (only `lost+found`,
  2.1 MB of 458 G, created 2026-08-05, never written since). Verified empty by
  read-only mount before asking.

## 3. Evidence levels — never merged

### SOURCE IMPLEMENTED

| Check                                         | Result                                                   |
| --------------------------------------------- | -------------------------------------------------------- |
| `kitluy-hub-agent` typecheck                  | pass                                                     |
| `kitluy-hub-agent` tests (live Hub DB)        | **435 passed, 2 skipped** (was 141 passed / 271 skipped) |
| `hub-backup-restore` (destructive, run alone) | 2 passed                                                 |
| `kitluy-device-firstboot-agent` tests         | 416 passed, 9 skipped                                    |
| `build-gates.test.sh`                         | 32 passed, 0 failed                                      |
| `systemd-runtime.test.sh`                     | 150 passed, 0 failed                                     |
| `storage-posture.test.sh` (new)               | 17 passed, 0 failed                                      |
| `pnpm secret:scan`                            | pass, 1882 files                                         |
| `pnpm pki:assert-no-dev`                      | pass                                                     |
| `scan-image-secrets.sh` on the BUILT rootfs   | 17 passed, 0 failed (was FAIL on the bundled DSN)        |
| `pnpm docs:registry-check`                    | pass, 60 rows                                            |

### IMAGE VERIFIED

`image-contents.test.sh` (new) inspects the rootfs the builder produced, against
`runtime-manifest.json`. Against the **BRINGUP-002** rootfs it reported **7
failures** — hub-agent absent, unit absent, not enabled, no bundle, advert
unbacked, D-27 present. Against the **BRINGUP-003** rootfs: **46 passed, 0
failed.**

### HARDWARE VERIFIED — `pi5-jwwudf`, 2026-09-01

```
07:44  storage    --explain refuses with no authorization         (fail-closed)
07:44  storage    --explain -> DEVELOPMENT-UNBOUND, commits nothing
07:45  storage    LUKS2 aes-xts-plain64 / argon2id unlocked as kitluy-hub-data
07:46  database   PostgreSQL 15 cluster on the encrypted volume
07:47  database   42 of 42 Hub migrations applied
07:50  agent      "Store Hub is serving terminals" bindHost 172.16.13.206:7443
07:50  socket     /proc/net/tcp  CE0D10AC:1D13 state 0A  = 172.16.13.206:7443 LISTEN
07:51  tls        TLS 1.3 established; peer cert CN=636b6082-…-79aa84e57329
07:51  mtls       uncertified client -> "tlsv13 alert certificate required"
07:51  endpoint   GET /.well-known/kitluy-edge-discovery/v1 -> signed record
07:52  crypto     ed25519 signature VERIFIES against the board identity key
```

The discovery record's `hubCertificateFingerprint` (`0328847a…955042`) matches
`certificateSha256` in the credential BRINGUP-002 adopted, and its scope matches
`pairing-state.json` exactly. Nothing was re-derived for the test.

**Not hardware-verified:** D-27's fix and the image packaging, because this board
still runs the BRINGUP-002 card. D-27 is confirmed _present_ on it —
`activating`, **750 restarts** — which is the defect exactly as described. The
fix is IMAGE VERIFIED and needs a reflash to become HARDWARE VERIFIED.

## 4. Defects found and fixed

| ID       | Defect                                                                                                                                                                                                    | Where                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **D-05** | Hub agent in no flashable image                                                                                                                                                                           | `runtime-manifest.json`, packaging, unit              |
| **D-27** | Ticket enrollment agent crash-loops (750 restarts, never `failed`)                                                                                                                                        | unit + symlink removed                                |
| **D-32** | `cryptsetup open` given a positional key file, which it does not accept — the volume formatted, then could not be opened in the same run. Never fired before because the OTP gate refused first.          | `hub-storage-provision`                               |
| **D-33** | `postgres` cannot traverse `/var/lib/kitluy` (StateDirectoryMode 0750/0700), so initdb failed on a directory it owned                                                                                     | 6 units -> `0751`, plus a self-heal and assertion     |
| **D-34** | `pg_ctl -l` wrote to the root-owned volume root; "could not start server" that was a permission fault                                                                                                     | log moved into the cluster directory                  |
| **D-35** | Peer auth with no role for the agent's OS user — the agent reported `KLUY-HUB-DB-UNREACHABLE` against a healthy, fully-migrated database                                                                  | provisioner creates the `root` login, membership only |
| **D-36** | `hub/seed/dev-fixtures.sql` hardcoded `offline_valid_until = 2026-08-27`; every authorised actor refused with `EDGE_PERMISSION_DENIED` from 27 Aug. Unnoticed because the suites skip without a database. | made relative                                         |
| **D-37** | `t007-hub-races` hardcoded `127.0.0.1:54322`, ignoring `KITLUY_HUB_DB_URL`. On this workstation that port is **another ecosystem's** database.                                                            | uses `hubDatabaseUrl()`                               |
| **D-38** | The device bundle carried `postgresql://postgres:postgres@127.0.0.1:54322/…` — flagged by `scan-image-secrets.sh` — and gave a misconfigured Hub a silent fallback                                        | no default; fails closed                              |

D-32 through D-35 were only reachable once the OTP gate stopped refusing. They
had been latent since the storage path was written.

## 5. The build-path reconciliation

`infra/kitluy-store-hub-image/runtime-manifest.json` is now the one declaration
of what a flashable image contains. Three consumers read it, which is what stops
them drifting:

1. `package-bootstrap-runtime.sh` packages what it declares
2. `image-contents.test.sh` inspects a **built rootfs** against it
3. `systemd-runtime.test.sh` cross-checks enablement

And `build-rpi-image.sh` now **invokes** the packaging step. It never did: that
was a manual pre-step documented in a README, so a build run straight after a
source change happily shipped the previous overlay. It cost two rebuilds on
2026-08-31 and was the mechanism behind D-05.

## 6. DEVELOPMENT-UNBOUND storage

Named for what is true: the key is **not bound to the board**. A drive carrying
it is readable in any machine that also has the key file — which is the property
OTP binding exists to prevent. It is not weaker production security; it is a
different thing.

Reached only when **all four** hold:

1. no OTP key programmed — OTP always wins when available
2. `KITLUY_ENVIRONMENT` is exactly `development` (`unknown` when unreadable)
3. an operator-created marker exists — never shipped in any image
4. `/var/lib/kitluy` is not group- or world-writable

Key: 32 random bytes, generated **on the board after boot**, mode 0600, never
shipped, never shared, never logged. Posture recorded in a label file carrying
no key material. `evaluateStoragePosture` refuses to serve when the posture is
DEVELOPMENT-UNBOUND outside development — a second, independent gate in the
runtime.

Both gates are mutation-tested: removing the environment check fails 6
assertions, breaking OTP-first ordering fails 1, weakening the allowlist to a
denylist fails 6.

## 7. What is NOT started

Realtime. First terminal provisioning. T1–T4 business transactions. WAN-offline
Store journey. OTP burning. All out of scope per §13 and untouched.

## 8. Pre-existing failures, reported distinctly

`pnpm verify` fails on four steps. Two were mine and are fixed (lint on the
generated bundle; formatting on two files). Two are **not** mine:

- **Unit tests** — `@kitluy/device-identity` 899 passed, 2 failed. Both refuse
  to run because `kitluy_credential_issuer` is already granted to this login:
  the dev fleet service from BRINGUP-002 is still running and holds the borrow.
  The test says explicitly not to revoke it by hand.
- **Docs link check** — 4 broken links in a 2026-07-30 handoff.

Also pre-existing: one lint error in
`scripts/database/apply-dev-supautils-hint-workaround.mjs`, which is
**untracked** — leftover from the earlier supautils session, not BRINGUP-003.

## 9. Requires independent security review

1. **The development-only listener.** It composes a pairing signer and serves
   mTLS on a LAN port. Adjacent to BLK-005 without answering it. The environment
   gate is the whole safety argument.
2. **DEVELOPMENT-UNBOUND storage.** A storage-encryption key not bound to
   hardware. The four-condition gate and the runtime refusal are the safety
   argument.
3. **`StateDirectoryMode` 0750 -> 0751** across six units. Traverse-only for
   others; every sensitive subdirectory stays 0700. Small, but it is a
   permission widening on the directory holding device identity.

## 10. Recorded, not fixed

- **`IGconf_kitluy_environment` is never passed by `build-rpi-image.sh`**, so
  every image is `KITLUY_ENVIRONMENT=development`. Harmless today because
  `assert_channel_buildable` refuses pilot and stable outright under BLK-005
  (verified this session). It becomes load-bearing the moment BLK-005 is
  answered, and the environment gates in the listener and storage paths both
  key on that value.
- **`runuser` prints `could not change directory to "/home/pi"`** on every
  provisioner call. Cosmetic, but it is noise in a log an operator reads during
  a fault.
- **`hub/repositories/laundry.ts` inside the Hub agent** — vertical-neutrality
  boundary concern, excluded by §13.

## 11. Exact next task

**Flash the BRINGUP-003 image and cold-run it.** That converts D-27 and the
image packaging from IMAGE VERIFIED to HARDWARE VERIFIED, and re-proves the
BRINGUP-002 lifecycle end to end on the new card:

```bash
# 1. reset the dev database so the board starts from `manufactured`
# 2. flash build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst
# 3. boot, then authorise development storage and reboot:
sudo touch /var/lib/kitluy/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED && sudo reboot
# 4. drive manufactured -> enrolled -> awaiting_trust -> ACTIVE through the portals
# 5. verify:
systemctl is-active kitluy-hub-storage kitluy-hub-database kitluy-hub-agent
systemctl --failed                       # kitluy-enrollment-agent must be GONE
cat /var/lib/kitluy/storage-posture       # DEVELOPMENT-UNBOUND
```

The board currently carries a LUKS2 volume, a migrated Hub database and a
manually-started agent. Those survive a reflash of the **SD card**; the NVMe is
not touched by flashing.

## 12. Current board state

- LUKS2 volume live at `/dev/mapper/kitluy-hub-data`, mounted at
  `/var/lib/kitluy/hub`
- PostgreSQL 15 cluster, database `kitluy_hub`, 42 migrations applied
- Hub agent running **manually** (not systemd — this board has the old image).
  Stop with `sudo pkill -f hub-agent.mjs`.
- Staged files at `/var/tmp/hub-{storage,database}-provision`, `/var/tmp/hub-agent.mjs`
- `systemd-hostnamed.service` failed — D-31, pre-existing, unrelated
