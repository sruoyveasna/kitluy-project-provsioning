# The hardware stack and both images carry credential recovery

**Date:** 2026-09-15
**Status:** **IMPLEMENTED · TESTED · IMAGE VERIFIED. NOT HARDWARE VERIFIED.**
No board flashed, no U1 hardware test run, no hosted write, `main` not moved.

Authority: owner instruction 2026-09-15 ("bring the hardware-facing development
environment and both image artifacts up to the current `dev` source state"),
continuing `KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001` and
`KLREC-2026-09-14-HUB-IDENTITY-SELECTION-001`. Previous record:
[`39_A_REFLASHED_DEVICE_RECOVERS_ITS_CREDENTIAL.md`](39_A_REFLASHED_DEVICE_RECOVERS_ITS_CREDENTIAL.md)
§8 steps 1–3, which this record closes.

---

## 1. Status by classification

| Item                                                                           | IMPLEMENTED | TESTED | IMAGE VERIFIED | HARDWARE VERIFIED |
| ------------------------------------------------------------------------------ | ----------- | ------ | -------------- | ----------------- |
| Migration 0224 on `kitluy-fresh` (the hardware stack)                          | yes         | yes    | n/a            | **no**            |
| Fleet service `:8787` on the 0224-aware registry build                         | yes         | yes    | n/a            | **no**            |
| Re-flash recovery client (identity proof) in the Store Hub image               | yes         | yes    | **yes**        | **no**            |
| Re-flash recovery client (identity proof) in the Pi Terminal image             | yes         | yes    | **yes**        | **no**            |
| Hub identity selection (`selectOperationalHubIdentity`) in the Store Hub image | yes         | yes    | **yes**        | **no**            |

"IMAGE VERIFIED" here means the file was read back out of the built image's
erofs system partition and its SHA-256 equals the committed overlay file — not
that the build command exited 0.

## 2. Starting state

| Fact                               | Value                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------- |
| Branch / starting commit           | `dev` @ `9ad92ec` = `provisioning/dev` (fetched and fast-forward checked)                     |
| Machine                            | rebooted before the session (uptime 46 min): fleet service, Hub DB and edge runtime were down |
| `kitluy-fresh` (`:54372`, PG 15.8) | 122 ledger rows, newest `0223`; **0224 absent** (ledger; none of its 3 objects in the backup) |
| Overlay JS in both image trees     | did NOT contain the recovery proof or the Hub fix (handoff 39 §8.3)                           |

## 3. Database — `kitluy-fresh`

Backup first:
`~/Development/HET_VEASNA_WORKSPACE/backups/het-kitluy-project/2026-09-15__kitluy-fresh__before-0224.dump`
(3.8 MB, `pg_dump -Fc`).

Applied **unchanged** (file SHA-256 prefix `abf3aba96de85083`, equal to the
committed file), with the established mechanism (never `pnpm db:apply` — it
targets `:54322`, the HSA database):

```bash
F=supabase/migrations/20260914120000_0224_reflash_operational_credential_recovery.sql
docker exec -i supabase_db_kitluy-fresh psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f - < "$F"
docker exec supabase_db_kitluy-fresh psql -U postgres -d postgres -c \
  "insert into supabase_migrations.schema_migrations(version, name)
   values ('20260914120000', '0224_reflash_operational_credential_recovery')
   on conflict (version) do nothing;"
```

Apply log: 0 `ERROR`, 0 `WARNING`; the migration's own hostile assertions passed.

| Check                                                 | Before                 | After                                                                                                                        |
| ----------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Ledger rows / newest                                  | 122 / 0223             | **123 / `20260914120000`**                                                                                                   |
| `classify_operational_certificate_request_v1`         | absent                 | `SECURITY DEFINER`, owner `kitluy_credential_issuer`, EXECUTE `kitluy_credential_issuer`, `kitluy_issuance_service`          |
| `reserve_device_credential_recovery_v1`               | absent                 | same owner and ACL                                                                                                           |
| `device_credential_recovery_evidence`                 | absent                 | exists, RLS **forced**, both triggers enabled                                                                                |
| `renewal_policy` (development)                        | `allow_key_rotation=f` | `allow_key_rotation=f`, `allow_reflash_credential_recovery=t`, decision ref `KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001` |
| Classify as `kitluy_issuance_service`, unknown device | —                      | `FIRST_ISSUANCE`                                                                                                             |

**Existing data intact.** 16 fingerprints (row count + MD5 over ids and state
columns) of devices, enrollments, installations, assignments, terminal
assignments, claims, credentials, credential heads, generation keys,
certificates, renewal reservations, physical terminals, release artifacts,
release installations, release events and renewal policy were taken before and
after: **byte-identical**. No TRUNCATE, DROP, reset or device mutation.

Devices on the stack (unchanged): Store Hub `KL-CFADA8C75001` `active`;
terminals `KL-1CB3577C26A7`, `KL-C2B02C760E41` `active`.

**One expected side effect:** `postgres` no longer holds a standing membership
in `kitluy_credential_issuer` (0224 hands the borrowed grant back, per the
0155 convention). The other four governor memberships are unchanged.

## 4. Fleet service `:8787`

Started only after §3, on a fresh `dist` (registry service rebuilt 09:10):

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
export KITLUY_DEV_FLEET_DSN=postgresql://postgres:<local-password>@127.0.0.1:54372/postgres
export KITLUY_DEV_PKI_DIR=~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki
setsid nohup pnpm dev:fleet > ~/Development/HET_VEASNA_WORKSPACE/scratch/2026-09-15__fleet-service-kitluy-fresh.log 2>&1 < /dev/null &
```

| Probe                                                                      | Result                                                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /health/live`, `GET /health/ready`                                    | 200, 200                                                                                                                           |
| `POST /v1/operational-certificate {}`                                      | 422 (validation — route loaded)                                                                                                    |
| `POST /v1/device-enrollment/challenges {}`                                 | 422                                                                                                                                |
| `/v1/hub-pairing`, `/v1/terminal-pairing`                                  | validation errors (routes loaded)                                                                                                  |
| `/v1/terminal-provisioning/challenges`                                     | refuses without `Idempotency-Key` (route loaded)                                                                                   |
| Live recovery-path probe: unknown device, valid PoP + valid identity proof | **422 `OPCERT_KEY_REGISTRATION_REFUSED` / `KLUY-KEY-NO-DEVICE`** — `classify_operational_certificate_request_v1` executed on PG 15 |
| Log: `does not exist` / undefined function / error level                   | none                                                                                                                               |
| keys / requests / reservations / evidence / devices                        | `3/3/0/0/3` before and after the probes                                                                                            |

No real device credential was mutated.

**Edge runtime repaired (not a code change).** `supabase_edge_runtime_kitluy-fresh`
had exited (137) and its functions bind-mount lives under a previous session's
`/tmp/claude-1000/.../87481d20.../scratchpad/fresh-stack/supabase/functions`,
which the reboot wiped. The directory was recreated from repo `supabase/functions`
at `9ad92ec` and the container started: `POST /functions/v1/device-registration {}`
→ 400 `KLUY-REG-MALFORMED` (was 500). **This breaks on every reboot** — see §9.

`kitluy-hub-local` (`:54330`) was started with `docker start` for the Hub tests.
The release service (`:8791`) and management API (`:8790`) were NOT restarted.

## 5. Tests

Environment: `kitluy-repo17` (`:54392`, PG 17.6) for the registry suites,
`kitluy-hub-local` for the Hub suites.

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.0/bin:$PATH"
export KITLUY_DEV_PKI_DIR=~/Development/HET_VEASNA_WORKSPACE/local-config/het-kitluy-project/dev-pki
export KITLUY_DEV_DB_URL=postgresql://postgres:<local-password>@127.0.0.1:54392/postgres
export KITLUY_HUB_DB_CONTAINER=kitluy-hub-local
export KITLUY_HUB_DB_URL=postgresql://postgres:<local-password>@127.0.0.1:54330/kitluy_hub_local
```

| Suite                                                                                                                                                         | Result                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Registry: `reflash-credential-recovery.adversarial`                                                                                                           | **14/14**                           |
| Registry opcert issuance (7 files: first issuance, first-issuance recovery, key binding, generation serial, validity, serial canonicalization, firstboot e2e) | **53/54** — 1 pre-existing (below)  |
| Firstboot opcert + recovery identity (8 files)                                                                                                                | **93/93**                           |
| `packages/device-identity` recovery identity                                                                                                                  | **6/6**                             |
| Hub T1 bootstrap routes (stale + current identity)                                                                                                            | **22/22**                           |
| Hub agent full suite with the Hub database                                                                                                                    | **447 passed, 2 skipped, 0 failed** |
| `pnpm migrations:validate`                                                                                                                                    | pass (123)                          |
| `pnpm hub:db:validate`                                                                                                                                        | pass (43)                           |
| `pnpm secret:scan`                                                                                                                                            | pass                                |

**The one failure is pre-existing, not new:** `firstboot-operational-tls.e2e`
"ACTIVATES the Hub through the existing governed path" — the route has activated
the Hub itself since `68e0249`, then the test activates again. Recorded in
handoff 39 §7 before this session.

**`pnpm verify`** (10:23–10:25, after both builds, on the final tree):
Lint, Typecheck, Contract tests, Offline harness, Build, OpenAPI validation,
Migration validation, Hub migration validation, Secret scan and Clock usage
**PASS**. Three steps **FAIL, identical to the handoff 39 baseline**:

- Format check: Prettier `EACCES` on the rootless build tree
  (`build/work/chroot-v2.7.0/filesystem/persistent/home/pi`); the files this
  session changed pass `prettier --check`.
- Unit tests: `@kitluy/device-identity` 905 passed / 23 skipped, and two
  concurrency suites (`governed-emergency-concurrency`,
  `scope-consumption-concurrency`) refuse to start because
  `kitluy_credential_issuer` is already granted to the test login on the local
  stack. This is their guard against handing back another session's borrow.
- Docs link check: the same 4 broken links in the 2026-07-30 WS-11 handoff.

Static image gates, run after re-packaging:

| Tree        | build-gates | systemd-runtime | environment-gating | rpi-image-gen   |
| ----------- | ----------- | --------------- | ------------------ | --------------- |
| Pi Terminal | 62 / 0      | 224 / 0         | 20 / 0             | 23 / 0 (1 skip) |
| Store Hub   | 34 / 0      | 170 / 0         | 19 / 0             | 22 / 0 (1 skip) |

## 6. Packaging — two real refusals, both fixed in the packaging lists

```bash
pnpm --filter @kitluy-services/kitluy-device-firstboot-agent build
pnpm --filter @kitluy-apps/kitluy-device-shell build
pnpm --filter "@kitluy-services/kitluy-hub-agent..." build
pnpm --filter @kitluy-services/kitluy-hub-agent build:bundle
bash infra/kitluy-os-image/scripts/package-bootstrap-runtime.sh
bash infra/kitluy-store-hub-image/scripts/package-bootstrap-runtime.sh
```

1. **Both trees: `REFUSED: unpackaged imports` — `operational-recovery-identity-bytes.js`.**
   Handoff 39 added the module but not to either `DEVICE_MODULES` list. The
   guard did its job. Added after `paired-identity` in both scripts.
2. **Store Hub: `REFUSED: unpackaged imports` — `release-install`, `release-runtime`,
   `release-status`, `release-store`, `release-trust` from `bin/update-bootstrap.js`.**
   The Hub overlay had never been re-packaged since U1 turned `update-bootstrap`
   into the release runtime. The release closure was added: `durable-write`,
   `release-store`, `release-verify`, `release-trust`, `release-archive`,
   `release-artifact`, `release-assignment`, `release-install`,
   `release-status`, `adapters/http-release-source`, `release-runtime`.
   **On a Store Hub the agent stays inert:** the Hub
   builder bakes no release trust anchor and no release source, so
   `evaluatePreconditions` stops at `no_trust_anchor` before any install is
   composed — the old reporter's behaviour. Hub release distribution is still U4.

A refused run leaves the overlay partially written (the Hub `package.json` was
deleted); the successful re-run restored it byte-identical to HEAD. **Generated
files were never edited by hand.** Re-packaged files are byte-identical to the
fresh `dist` and `dist-bundle/hub-agent.mjs`. On the Terminal, `bin/terminal-edge.js`
and `edge-session.js` changed in layout only (whitespace/trailing-comma
normalised comparison equal).

Committed as `c158dfc` — `build(images): package the recovery identity proof,
and re-package both overlays from source` (25 files, +2916/−55).

## 7. Images

Both built from `c158dfc71f97fb68269f591d20eda0c941486ea8` with a clean tree,
the existing `build-rpi-image.sh` pipeline and approved profiles, no
architecture change. Previous outputs were moved (not deleted) to
`build/preserved-20260915-0935/` in each tree first, because the manifest
collects every `deploy-*` / `image-*` directory.

Builder: rpi-image-gen `v2.7.0` (`a7b6d4806183195f3efadb533f58c8e46393d057`),
rootless podman, QEMU cross-build. Classification of both:
**DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED.**

### 7a. Store Hub

```bash
KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub KITLUY_DEV_PKI_DIR=<dev-pki> \
bash infra/kitluy-store-hub-image/scripts/build-rpi-image.sh --profile store-hub \
  --environment development \
  --registration-url http://172.16.21.17:54371/functions/v1/device-registration \
  --enrollment-url http://172.16.21.17:8787 --hardware-profile-key KL-PI5-STORE-HUB-DEV
```

Result: **exit 0**, 09:36:05 → 09:57:55 (+07:00). Profile `store-hub`, device
class `store_hub`, environment `development`, image version `0.2.0-dev`,
password-less recovery sudo (development only).
Manifest: `infra/kitluy-store-hub-image/build/work/kitluy-store-hub-dev-manifest.json`.

| Artifact (under `infra/kitluy-store-hub-image/build/work/`)          | Bytes       | SHA-256                                                            |
| -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` **(flash this)**    | 660018740   | `1aee48ffe4194088bead041e8e1f0b3637f760ebcdcc83927cef45f5e882c2b3` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.sparse.zst`              | 660022534   | `bc629a82321a46e98e3af5e5a7bd73af200b981a4712f0c13598d35bed87eff3` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst`              | 996058426   | `7457b64ce177ee42c5ec34a72f83ab63e7c4effa03144311eb44e137d66951f2` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img`        | 17490268160 | `83c63b234fea2331d65c040099b118372ea7978f6b9678dce282590b910fdb24` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img.sparse` | 837144856   | `0c7cf6b87778ba31032b3754081e9d0ea89ab5d53371cc5fb935d4defb042cdb` |

The first four were hashed independently with `sha256sum` and equal the
manifest; the last is the manifest's value.

### 7b. Pi Terminal

```bash
KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub KITLUY_DEV_SUDO=1 KITLUY_DEV_PKI_DIR=<dev-pki> \
bash infra/kitluy-os-image/scripts/build-rpi-image.sh --profile pi-terminal \
  --environment development \
  --registration-url http://172.16.21.17:54371/functions/v1/device-registration \
  --enrollment-url http://172.16.21.17:8787 --release-source http://172.16.21.17:8791 \
  --hardware-profile-key KL-PI5-TERMINAL-DEV
```

Result: **exit 0**, 09:58:31 → 10:19:03 (+07:00). Profile `pi-terminal`
(`kitluy-pi-terminal.yaml`), device class `terminal`, channel `internal`,
environment `development`, image version `0.2.0-dev`, development release trust
anchor (`release_signing`) and release source `http://172.16.21.17:8791` baked,
password-less `pi` sudo (development only, `KITLUY_DEV_SUDO=1`). No refusal
fired (the `REFUSED` strings in the log are script source, not events).
Manifest: `infra/kitluy-os-image/build/work/kitluy-pi-terminal-dev-manifest.json`.

| Artifact (under `infra/kitluy-os-image/build/work/`)                                   | Bytes      | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` **(flash this)**             | 998645068  | `d198e129f668128061521cae2abe7c5447e85a1c3df8bf6705a75b284766d028` |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.sparse.zst`                       | 999217693  | `d80c44db72cc1cfef1b561320820336cd2ecbfc2d6afe0dc3bf2aeaba2e69bb8` |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64-v2.7.0.tar.zst`                       | 1501039349 | `7d7781a652120922ef00cc9b92ba1c258cb4067159a8e91c11a26076b3c225a2` |
| `image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img`        | 8900333568 | `43f3684a89e6ab37b06e5985ee15259b5fa50a45efe5464b595b5fd4b322f2a7` |
| `image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img.sparse` | 1144294904 | `160baa6736aaa00b812714f93909d92860de7d060b00e73b79104d6a6a90bca3` |

The first four were hashed independently and equal the manifest; the last is
the manifest's value.

## 8. Image verification — the new code is inside the artifacts

Checks run against the build output: Store Hub `image-contents.test.sh`
**52/0**, `storage-posture.test.sh` **33/0**; Pi Terminal `image-contents.test.sh`
**107/0/0 skipped**. (`image-contents.test.sh` inspects the chroot tree, so it is
not by itself proof that the final `.img` carries a file.)

**Whole-overlay comparison.** Every file committed at `c158dfc` under each
overlay's `usr/lib/kitluy/` was read back from the image and hashed
(`overlay-vs-image`): **Pi Terminal 55/55 MATCH, Store Hub 100/100 MATCH, 0
DIFFERS, 0 MISSING.** The Terminal's extracted `system_a` is also byte-identical
to the build's own `system.erofs` (first 521584640 bytes).

**Proof from the final image.** The raw `.img` is GPT with A/B slots; `system_a`
is erofs with 16 KiB blocks and zstd-3 compression. It was extracted with `dd`
from the partition table's offsets and every file below was read back with the
**builder's own** erofs-utils 1.9
(`build/work/x86_64-linux-gnu/usr/bin/dump.erofs`, `LD_LIBRARY_PATH` into that
tree). Alpine's erofs-utils cannot read this filesystem (amd64 refuses 16 KiB
blocks; arm64 under emulation fails on zstd), so do not trust a MISSING from it.
Each hash is compared with the committed overlay file at `c158dfc`.

Store Hub (`/usr/lib/kitluy/lib/…` inside `system_a`):

| File                                                              | Image = overlay | SHA-256 prefix     |
| ----------------------------------------------------------------- | --------------- | ------------------ |
| `firstboot-agent/operational-recovery-identity-bytes.js`          | MATCH           | `e7b22dafb6087f2a` |
| `firstboot-agent/operational-tls-client.js`                       | MATCH           | `64e12e4ac844d683` |
| `firstboot-agent/bin/operational-tls.js`                          | MATCH           | `bd88be71cf1fbd08` |
| `firstboot-agent/adapters/http-operational-certificate-client.js` | MATCH           | `af29cff9d3f169ee` |
| `firstboot-agent/bin/update-bootstrap.js`                         | MATCH           | `d68ddc71f6e42467` |
| `firstboot-agent/release-runtime.js`                              | MATCH           | `fd6199468db80543` |
| `hub-agent/main.mjs`                                              | MATCH           | `da3e208895c2283b` |

Markers read from the image itself: `selectOperationalHubIdentity` in
`hub-agent/main.mjs` (2 occurrences); `identitySigner` in
`operational-tls-client.js` (2). `/etc/kitluy/image.env` in the image:
`KITLUY_IMAGE_VERSION=0.2.0-dev`, `KITLUY_DEVICE_CLASS=store_hub`,
`KITLUY_ENVIRONMENT=development`,
`KITLUY_REGISTRATION_URL=http://172.16.21.17:54371/functions/v1/device-registration`,
`KITLUY_ENROLLMENT_BASE_URL=http://172.16.21.17:8787`,
`KITLUY_HARDWARE_PROFILE_KEY=KL-PI5-STORE-HUB-DEV`.

Store Hub units read back from the image and equal to the overlay:
`/etc/systemd/system/kitluy-operational-tls.service`, `kitluy-hub-agent.service`.

Pi Terminal (`system_a` at sector 606208, 6291456 sectors; `/usr/lib/kitluy/lib/…`):

| File                                                              | Image = overlay | SHA-256 prefix     |
| ----------------------------------------------------------------- | --------------- | ------------------ |
| `firstboot-agent/operational-recovery-identity-bytes.js`          | MATCH           | `e7b22dafb6087f2a` |
| `firstboot-agent/operational-tls-client.js`                       | MATCH           | `64e12e4ac844d683` |
| `firstboot-agent/bin/operational-tls.js`                          | MATCH           | `bd88be71cf1fbd08` |
| `firstboot-agent/adapters/http-operational-certificate-client.js` | MATCH           | `af29cff9d3f169ee` |
| `firstboot-agent/release-runtime.js`                              | MATCH           | `fd6199468db80543` |
| `firstboot-agent/bin/update-bootstrap.js`                         | MATCH           | `d68ddc71f6e42467` |
| `firstboot-agent/edge-session.js`                                 | MATCH           | `5ec72b9503944e7b` |
| `firstboot-agent/bin/terminal-edge.js`                            | MATCH           | `307836c8c81d4eed` |

The firstboot files the two images share have the same hashes in both.
Markers read from the image: `identitySigner` in `operational-tls-client.js`
(2); the `kitluy.opcert-recovery-identity.v1` domain in the bytes module (1).
Units read back and equal to the overlay:
`/etc/systemd/system/kitluy-operational-tls.service` and
`kitluy-terminal-edge.service`, each enabled by a `multi-user.target.wants`
symlink present in the image. `/etc/kitluy/image.env`:
`KITLUY_IMAGE_VERSION=0.2.0-dev`, `KITLUY_DEVICE_CLASS=terminal`,
`KITLUY_ENVIRONMENT=development`, same registration and enrollment URLs as the
Hub, `KITLUY_HARDWARE_PROFILE_KEY=KL-PI5-TERMINAL-DEV`;
`/etc/kitluy/release.env`: `KITLUY_RELEASE_SOURCE=http://172.16.21.17:8791`.

## 9. Blockers and hazards carried forward

1. **The `kitluy-fresh` edge runtime dies on every reboot.** Its functions
   mount is a `/tmp` scratchpad path of an old session. Until an owner-approved
   durable mount exists, after any reboot re-create it from repo
   `supabase/functions` and `docker start supabase_edge_runtime_kitluy-fresh`,
   then expect `POST /functions/v1/device-registration {}` → 400. A board
   registering against a 500 looks like a device defect.
2. **The fleet service is a `setsid nohup` process, not a unit.** A reboot stops
   it; restart with the §4 command (0224 is applied, so this is now safe).
3. **The PG 15 runtime recovery path** (a real generation-2 issuance on
   `kitluy-fresh`) is covered only by 0224's own assertions and the live classify
   probe; the full recovery suite ran on PG 17 (`kitluy-repo17`). The first real
   recovery will be on hardware.
4. Pre-existing and unchanged: the `firstboot-operational-tls.e2e` ACTIVATES
   test; 0189 not applied on `kitluy-repo17` (segfault); the stale registry
   failures listed in handoff 39 §7.
5. The release service (`:8791`) is not running; the Terminal image bakes it as
   its release source. Not needed for the recovery step; needed before any
   release-assignment work.
6. **No local operator script releases an assignment on `kitluy-fresh`**
   (`pnpm dev:device:unassign` is hosted-only by design; §10.4). Not built here
   — out of scope.
7. Open owner questions from handoff 39 §9 (revoke the incumbent on recovery?
   pilot/production recovery? re-pairing an ACTIVE Pi Terminal) remain open.

## 10. The exact next hardware step (NOT executed)

**Store Hub re-flash recovery, on a spare card, nothing else:**

1. Confirm the stack is up: fleet `GET :8787/health/ready` 200; registration
   `POST :54371/functions/v1/device-registration {}` → 400 (not 500).
2. Verify the card image before flashing:
   `sha256sum deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` =
   `1aee48ffe4194088bead041e8e1f0b3637f760ebcdcc83927cef45f5e882c2b3`.
3. Flash it to a **spare** card (the current Hub card is the only fallback),
   boot the Hub and confirm it registered (a new enrollment superseding its old
   one — the strict-ancestor evidence recovery requires).
4. Return the `active` Hub `KL-CFADA8C75001` to `enrolled` through the governed
   door, then issue a new pairing code and re-pair. **Correction to handoff 39
   §8.4:** `pnpm dev:device:unassign` cannot do this here — its
   `assertHostedDevTarget` guard refuses `localhost`/`127.0.0.1` and accepts only
   the allowlisted hosted development project. On `kitluy-fresh` the same door
   is `kitluy_devices.revoke_device_assignment_v1`, run as
   `kitluy_fleet_governor` (which `postgres` still holds). It closes the
   assignment and spends the generation number, so it is an owner-confirmed
   step, not a script default:

   ```sql
   select kitluy_devices.revoke_device_assignment_v1(
     '<hub device id>', 'SD_CARD_REFLASH', 'OP-<operator>');
   ```

5. Expect `POST /v1/operational-certificate` → 200 `ISSUED`, `recovered: true`,
   generation 2, same device record and asset tag; Hub eligibility then 200 with
   the current `hubDeviceId`.

Still excluded until the owner asks: U1 Tests A–D, the Pi Terminal flash,
`release:chain:check` on the acceptance Terminal, release sequence 5, and any
synthetic assignment on the real device.

## 11. Git

| Commit      | What                                                                           |
| ----------- | ------------------------------------------------------------------------------ |
| `c158dfc`   | packaging lists + both overlays re-packaged from source (images built from it) |
| next commit | this handoff, the index entry and the two evidence register rows               |

Pushed to `provisioning` `dev` only. `main` unchanged (`9ad92ec`).
