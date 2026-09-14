# The Store Hub serves terminals, and the three image defects that stopped it

**Date:** 2026-09-10
**Status:** **PROVEN ON HARDWARE.** The Store Hub is serving mTLS on
`172.16.13.203:7443`, advertised over mDNS, refusing clients with no certificate.
**Fixed in the image sources; the running board carries runtime drop-ins that do
not survive a reboot.**

---

## 1. Where this started

Both device classes reached `active` yesterday (handoff 35), but the Pi Terminal
still could not talk to the Store Hub. The Hub was not serving at all.

## 2. Three defects, each independently fatal

All three are in `infra/kitluy-store-hub-image`. Each was reproduced on the board
before it was changed, and the fix was verified under a replica of the real
sandbox before any source was edited.

### 2.1 `/run/postgresql` was never created

`kitluy-hub-database.service` failed at every boot with

```text
install: cannot change owner and permissions of '/run/postgresql': No such file or directory
```

Two causes compounded, and the unit's own comment asserted the opposite of both:

1. **postgresql-common's tmpfiles rule never runs.** The rule is present at
   `/usr/lib/tmpfiles.d/postgresql-common.conf`, but the root filesystem is
   read-only erofs, so `systemd-tmpfiles-setup.service` is condition-skipped
   (`ConditionResult=no`). Nothing applies it. The unit and the provision script
   both said "postgresql-common already creates it".
2. **The script's fallback is blocked by the unit's own hardening.**
   `install -d -m 2775` sets the **setgid** bit, and `RestrictSUIDSGID=yes`
   blocks that syscall. The directory is never created, and the error you see is
   the _chown_ step complaining about a directory the blocked `mkdir` never made.

Bisected on the board with three replica units:

| unit    | mode | RestrictSUIDSGID | result                  |
| ------- | ---- | ---------------- | ----------------------- |
| replica | 2775 | yes              | **ENOENT** (reproduced) |
| replica | 0755 | yes              | success                 |
| replica | 2775 | no               | success                 |

**Fix:** the unit declares `RuntimeDirectory=postgresql`,
`RuntimeDirectoryMode=2775`, `RuntimeDirectoryPreserve=yes`, `Group=postgres`.
PID 1 creates the directory before the sandbox exists, so the setgid mode never
meets the unit's seccomp filter. Verified under the real sandbox:
`drwxrwsr-x root postgres`, postgres can write, and it survives a unit restart —
which matters because postgres keeps running and must not lose its socket.

The script keeps a fallback for an older unit, now at mode `0775` so it cannot
hit the same filter.

### 2.2 The agent could not enumerate its own interfaces

```text
uv_interface_addresses returned Unknown system error 97 (EAFNOSUPPORT)
```

`RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX` omitted **`AF_NETLINK`**,
which libuv needs to list local interfaces. The agent died before it could
resolve its own bind host. Netlink talks to the local kernel only; it is not a
route off the device.

### 2.3 The DSN named the wrong user

```text
KITLUY_HUB_DB_URL=postgresql://postgres@localhost/kitluy_hub?host=/run/postgresql
```

The cluster is `initdb --auth=peer`, which demands a database role named after
the connecting **uid**. `kitluy-hub-agent.service` runs as `root`, so this DSN is
refused with `Peer authentication failed for user "postgres"`.

`hub-database-provision` already creates a `root` login role for exactly this
reason — a previous session diagnosed the same failure, wrote the role and the
explanation, **and never corrected the DSN.** The DSN now says `root`.

The `localhost` literal is retained: `hubDatabaseUrl()` refuses any DSN without
`localhost`/`127.0.0.1` (KL-INF-P1-037).

## 3. What made this expensive to find

`isHubDatabaseReachable()` catches **every** error and returns a bare `false`.
A peer-auth rejection, a malformed DSN and a dead server are indistinguishable;
all three surface as `KLUY-HUB-DB-UNREACHABLE`, which reads as a storage or
migration fault and is neither. The database was up, fully migrated (42 applied)
and answering `psql` on the same socket the whole time.

**Recommended:** log the caught error at debug in
`services/kitluy-hub-agent/src/hub/db.ts`. Not done here — it is a source change
outside the image scope of this task.

## 4. Proven state

```text
Store Hub  pi5-wzbnes  172.16.13.203
  hub-database : 42 migrations applied, cluster on the encrypted NVMe
  hub-agent    : "Store Hub is serving terminals" port 7443
                 hubDeviceId 75cfc61f-219e-4f1e-8f42-fa46c056a292
                 storeLocationId 00000000-0000-4000-8000-000000000018
  mDNS         : _kitluy-edge._tcp -> pi5-wzbnes.local:7443
  TLS          : presents CN=<hub device uuid>, chained
                 Development Device Issuing CA -> Development Root CA
                 a client with no certificate is refused (certificate required)

Pi Terminal  pi5-wuofvm  172.16.29.74
  operational-tls: ADOPTED credential 3f8bae6e-cd67-5d48-a972-65375fde485f
                   generation 1, serial DEV-3F8BAE6ECD675D48
```

Both hold device certificates from the same CA. The mTLS pair is complete.

## 5. The remaining gap — this is the real next feature

**Nothing on the Pi Terminal image talks to the Store Hub.** The Terminal image
ships only the firstboot-agent family (`cloud-registration`,
`device-config-broker`, `firstboot-identity`, `health-reporter`,
`operational-tls`, `update-agent`) and the Device Shell kiosk. The Device Shell
mentions the Hub only in comments; it has no edge client.

The edge client exists, in `apps/kitluy-pos-desktop-app`
(`electron/mdns.ts`, `electron/t1-runtime.ts`, `electron/t1-intake-client.ts`,
against `packages/edge-contracts`). It is **not packaged into the Pi Terminal
image**. Packaging it is the next feature, and it is a build task, not a
configuration fix.

## 6. Delivery

The running board carries the fixes as drop-ins under `/run/systemd/system`,
which is tmpfs — **they are lost on reboot.** `/` and `/etc` are read-only erofs
(only `/etc/ssh` and `/etc/wpa_supplicant` are persistent bind-mounts), so there
is no way to persist them without a new image.

A/B slot update is not available: `kitluy-update-agent` is a bootstrap stub and
refuses every payload with `no_trust_anchor` (`/etc/kitluy/trust` is empty).

So delivery is rebuild + flash. **The NVMe survives it.** The data-volume key is
`HMAC-SHA256('kitluy.hub-data-volume.development-unbound.v1', board_serial)`,
with no key file anywhere on the board — independently recomputed from the board
serial and matched against `hub-storage-provision --key-fingerprint`
(`60fab5cda5bb02f40de6d50643c970a6`). The Hub database and its 42 migrations come
back after a flash of the same board.

**What a flash does cost:** `/var` is on the SD card
(`mmcblk0p6[/slots/system_a/var]`), so the Hub's `pairing-state.json`, identity
and operational TLS material are erased and the Hub must be re-paired — the same
defect recorded in handoff 35 §2. The Pi Terminal does **not** need reflashing;
none of these defects are on its image.

**Recommendation:** do not flash for this alone. Flash once, when the Terminal
edge client is packaged, so a single re-pair covers both.

## 7. Verification

```text
infra/kitluy-store-hub-image
  systemd-runtime     164 passed, 0 failed
  build-gates          32 passed, 0 failed
  environment-gating   19 passed, 0 failed
  image-contents       52 passed, 0 failed, 0 skipped
  storage-posture      33 passed, 0 failed
  rpi-image-gen        22 passed, 0 failed, 1 skipped
```

Nine new assertions were added to `test/systemd-runtime.test.sh`, replacing a
block that asserted the tmpfiles belief which proved false. They cover the
runtime directory, its mode, its preservation, `Group=postgres`, the absence of a
setgid mode in the script fallback, `AF_NETLINK`, and that the DSN user matches
the unit's own `User=`.

## 8. Security findings

`scan-image-secrets.sh` reports one **pre-existing** failure, unrelated to this
work and present on `main`:

```text
FAIL [SECRET] Private key material
  .../hub-migrations/0038_release_trust_and_cache.sql:177
```

It is a false positive. That migration deliberately inserts a literal PEM
`BEGIN PRIVATE KEY` header followed by `probe` to prove the trust registry's CHECK constraint
**rejects** private key material. Recorded, not fixed — out of scope.

## 9. Recommended next task

1. Package the edge client onto the Pi Terminal image (`kitluy-pos-desktop-app`
   or a terminal-shaped extract of it) so a Terminal discovers
   `_kitluy-edge._tcp` and calls `/edge/v1` with its adopted certificate.
2. Log the swallowed error in `isHubDatabaseReachable()` (§3).
3. Still open from handoff 35: a governed "Release this terminal" action; the
   Management API `pool.on("error")` handler.
