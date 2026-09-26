# 58 — SAME-PI Cycle B on hardware, two Hub defects, and the fixed Hub image (KITLUY-HARDWARE-ACCEPTANCE-001)

**Date** 2026-09-25 · **Area** edge-platform / hardware acceptance · **Source** `dev` `d1806e1` · **Owner task** "KITLUY-HARDWARE-ACCEPTANCE-001", then an owner-authorized defect-fix task

| Gate                | State                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED         | **YES** — two Hub defects fixed (`42b3c6f`), overlay repackaged (`d1806e1`)                             |
| TESTED              | **YES** — new regression case red→green; terminal-sync 20/20, pairing 20/20, systemd-runtime 184/0      |
| INTEGRATED          | **YES** for Cycle B up to Terminal↔Hub pairing (§2–§4)                                                  |
| IMAGE VERIFIED      | **YES** — new Hub image `317ca56a…`, overlay read-back 126/126, image-contents 62/0/0, secret scan PASS |
| HARDWARE VERIFIED   | **Store Hub: YES, with the two defects below** · Terminal↔Hub pairing: **NO — blocked by defect 2**     |
| END-TO-END VERIFIED | **NO** — PIN, Booking, payment, receipt and replay were not reached                                     |

---

## 1. Artifacts

| Artifact                  | Value                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hub image under test      | `f3810ab69d3fdf2c004d75f7662290339afa17df4206e1ca8df9ae9858aa3715` — **superseded by §6**                                                                                          |
| Terminal image            | `0db42539a44ddf5e949ebb2c8e2b0533547fa94451fcf906f89f9766bd6ae712` — **still valid**, unaffected by both defects                                                                   |
| T1 release                | `kitluy-terminal` `0.1.0-booking-202609231531`, id `1cac5454-…`, artifact `aaa3e3d7…` — assigned (seq 28) to `KL-C33197FAE9EA`                                                     |
| **Image path correction** | handoff 56 gives a RELATIVE path; the `f3810ab6…` file is in `worktrees/kitluy-ecosystem/wt-vertical-feeder/…`. The main tree's copy at that path is an older build (`7f887229…`). |

The Terminal image lives in `worktrees/kitluy-ecosystem/wt-t1-booking-release/infra/edge/raspberry-pi/pi-terminal-image/build/work/deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst`.

## 2. Store Hub — Cycle B (same Pi, new SD card, same NVMe)

Hub `KL-9830994458E0`, `172.16.13.203`, board serial `334a2a7bcc3dba2a`.

| Fact               | Cycle A (before)                            | Cycle B (after)                                                                                                   |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `device_record_id` | `4cfc40b4-da47-4578-8219-42d54468f028`      | **same**                                                                                                          |
| installation       | gen 1 `20064f77-…`                          | gen 2 `ac08171f-…` (gen 1 `superseded`)                                                                           |
| enrollment         | seq 1 `e476cae5-…`, key `9830994458e0…`     | seq 2 `88271da0-…`, key `c8bfbe8c…` (seq 1 `superseded`)                                                          |
| credential         | gen 1 `6c9226e4-…`, cert `531d4772` active  | gen 2 `e149a5e7-…`, cert `8aaeaba8` active; `531d4772` **superseded**; head previous_generation null (no overlap) |
| cloud assignment   | `fb32036e` gen 1 active                     | `fb32036e` **revoked automatically** (no SQL); `d6c33458` gen 2 active                                            |
| Hub assignment     | `fb32036e` gen 1, vertical NULL             | `fb32036e` **ended** by reconciliation; `d6c33458` gen 2 **`laundry`**                                            |
| Cycle-A probe      | `edge_ops.reflash_continuity_probe` cycle A | **present**                                                                                                       |
| Hub migrations     | 44                                          | 46 (0044, 0045 applied at boot)                                                                                   |

- **Storage:** `/dev/nvme0n1 already carries a LUKS container` → unlocked automatically; DEVELOPMENT-UNBOUND authorized by the image; no reformat, no manual step.
- **Boot classification:** `NEEDS-RELEASE` → `NEEDS-PAIRING` → `READY` — automatically.
- **Pairing:** ONE Hub pairing code (Partner Portal). Adopted `e149a5e7…` at 13:21:43 +07.
- **Vertical, written by sync:** producer log `KL-9830994458E0: 1 terminal(s) · catalog 31 services 6707ae28d74d · money published`; the `laundry` row was created 98 ms after `terminal sync started`. No manual UPDATE.
- **:7443:** `Store Hub is serving terminals` on `172.16.13.203:7443` — **only after a power cycle** (defect 1).
- **Previous credential:** superseded in the cloud with no overlap; **not** tested by presentation (the Cycle-A key is on the old card; booting it would be a new reflash).

## 3. Pi Terminal — same Pi, new SD card

Terminal `KL-C33197FAE9EA` (`d5ad30c5-778c-428b-a64d-bf1f323e5ce1`), `172.16.29.72`, hostname `pi5-ekllqf`.

- Same `device_record_id`; installation gen 2; enrollment `51947154-…`; assignment `6cb99a6a` revoked automatically (`SD_CARD_REFLASH`) at 07:01:05Z.
- ONE seat pairing code (Partner Portal, after §5.2). Assignment `68826ae9` gen 2 active; credential `26c5a587-…` gen 2, cert `d6d62c4d` (x509 `26c5a587ad840092`) active; gen 1 superseded.
- Update agent: `kitluy-terminal running=RELEASE 0.1.0-booking-202609231531 installed=0.1.0-booking-202609231531` (`rel-1cac5454-… is already running`). **Installed on the board**, not inferred from assignment. The partition hash could not be read back (the Terminal image asks for a sudo password over SSH).
- Hub pairing then **failed** — defect 2.

## 4. The two defects (both Hub-only)

### Defect 1 — TRANSPORT: the paired Hub served nobody until a power cycle

On a fresh card the agent started before a certificate existed, refused `KLUY-HUB-TLS-MISSING` and **exited 0** (a designed resting state). `kitluy-hub-agent.service` has `Restart=on-failure`, which a clean exit never triggers; `kitluy-operational-tls` adopted the certificate at 13:21:43 and exited; nothing started the agent. A power cycle (operator action, no SSH) brought it up with every check passing.

**Fix:** `OnSuccess=kitluy-hub-agent.service` on `kitluy-operational-tls.service` (systemd 252 on the image). A waiting Hub loops and never exits, so a clean exit means ADOPTED.

### Defect 2 — IDENTITY: the Hub bound terminal pairing to its PREVIOUS identity

Hub log: `edge:pairing-proof 200 TERMINAL_PROOF_RECORDED` → `produceHubProofAndComplete PAIR_CERT_INVALID` (403), then `PAIR_SESSION_OUTSTANDING` (409) every 32 s until the session expired.

Root cause, read from the Hub database: both Hub identities were `active` at `rotation_generation` 1 — `9830994458e0…` (Cycle A) and `c8bfbe8c…` (Cycle B) — and both operational credentials (`6c9226e4…`, `e149a5e7…`). `projectHubSelf` (`terminal-sync/apply.ts`) wrote the Hub's own rows at a hard-coded generation 1 and never superseded the previous installation's rows, which survive on the NVMe. Hub migration 0042's `begin_terminal_pairing_v1` picks the signing identity with `order by rotation_generation desc limit 1`; the tie picked Cycle A (session `42b57b9c…` recorded `hub_credential_id` → `9830994458e0…`). The agent signed with its real key, and `complete_terminal_pairing_v1` (0031) refused `KLUY-EDGE-PAIRING-CERT-INVALID: the receipt signer is not this session's Hub credential`. The Terminal's own old rows were correctly superseded; only the Hub's were not.

**Fix:** `projectHubSelf` supersedes every other active credential of the same kind for this Hub before upserting its own (mirrors `projectTerminal`) and records the pairing generation. It runs on every sync, so **this Hub's NVMe heals on the first sync** of the new image — no manual SQL, no wipe.

Not changed: migration 0042's selection (no longer ambiguous once only one identity is active).

## 5. Environment findings during acceptance (development stack only)

1. **`:8790` refused every browser origin** (`allowedOrigins: 0`): `pnpm dev:stack:up` (handoff 57) starts the management API without `MANAGEMENT_API_ALLOWED_ORIGINS`. Restarted with `http://127.0.0.1:5173,http://127.0.0.1:5174,http://localhost:5173,http://localhost:5174`. **Open:** add those to `dev-stack.mjs` and a CORS preflight to `health` (not done — needs a separate authorization).
2. **Cloud migration `0231` had never been applied to `kitluy-fresh`** while the committed management API queries its table: the Partner Portal's Terminals page failed (`relation kitluy_devices.physical_terminal_allowed_surfaces does not exist`). Applied with the owner's explicit approval at 07:07:31Z (`psql -1 -v ON_ERROR_STOP=1`, file `cd0645b4…`, ledger row only after exit 0). Checked first: the live `evaluate_terminal_pairing_session_v1` was byte-identical to 0220's, and 0231 only changes `context_version` v1→v2 and adds `allowed_surfaces`. Row counts unchanged (1 terminal, 4 events, 2 roles, 1 session).
3. **Local stack drift:** four KitLuy stacks run side by side. Everything under test uses `kitluy-fresh` (`:54371`/`:54372`); `CLAUDE.md` and the scripts' `--local` still name `kitluy-repo17` (`:54392`). The Supabase ledger on `kitluy-fresh` was also missing `0234`–`0237` although their objects exist. **Recommended (not done):** declare `kitluy-fresh` canonical for hardware and have `dev:stack:health` compare migrations present vs repository.
4. Portals were not running; started as dev servers on `127.0.0.1:5173` (Admin) and `:5174` (Partner).

## 6. The fixed Hub image — flash this for Cycle C

Built from the clean worktree `worktrees/kitluy-ecosystem/wt-hub-reflash-fix` at **`d1806e1`**, same flags as `f3810ab6…` (baked `/etc/kitluy` **identical** to it), builder `rpi-image-gen v2.7.0` / `a7b6d480…` (not dirty), 07:39→08:01Z.

|                         |                                                                                                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compressed (flash this) | `/home/veasna/Development/HET_VEASNA_WORKSPACE/worktrees/kitluy-ecosystem/wt-hub-reflash-fix/infra/edge/raspberry-pi/store-hub-image/build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` |
| compressed size         | **660 366 935 bytes**                                                                                                                                                                           |
| **compressed sha256**   | **`317ca56a1d1ebbde7782248340ac578e9485b10dea36432411c6c5d50e884335`**                                                                                                                          |
| raw `.img` sha256       | `a204319e3b828324b6ecafa77b0340ddd03e633e254548d696c33a72793517bd` (17 490 268 160 bytes)                                                                                                       |
| classification          | DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED                                                                                                                                 |

Verification: hashes match the manifest; overlay read back from the final erofs **126/126** regular files identical to the commit; `OnSuccess=kitluy-hub-agent.service` and agent bundle `5e311383…` (with `supersedeHubCredentials`) read from `system_a`; image-contents 62/0/0; secret scan PASS; build-gates 34/0, environment-gating 19/0, rpi-image-gen 22/0/1, storage-posture 46/0, systemd-runtime 184/0.

## 7. Tests

| Check                                            | Result                                                                                                                                                                                                                                    |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| new case "supersedes the Hub's own credentials…" | **fails without the fix** (`expected 'active' to be 'superseded'`), passes with it                                                                                                                                                        |
| terminal-sync integration / unit                 | 20/20 · 33/33                                                                                                                                                                                                                             |
| hub-terminal-pairing integration                 | 20/20                                                                                                                                                                                                                                     |
| hub-agent full suite (local Hub DB)              | 523 passed, 2 failed, 2 skipped — both failures in `t1-bootstrap-routes`: "still fails closed" (pre-existing, handoff 56) and the Terminal PIN lockout case, which **times out at 5 s without this change too** (run in isolation, twice) |
| typecheck / eslint / prettier (changed)          | clean                                                                                                                                                                                                                                     |

## 8. Cycle C — the owner's steps

1. Verify: `sha256sum <path above>` = `317ca56a…`.
2. Flash a **fresh** SD card; same Hub, same NVMe. Keep the Cycle-A and Cycle-B cards unchanged.
3. Power on. Expect: same device id, installation gen 3, automatic release, `NEEDS-PAIRING`.
4. Enter **ONE** Hub pairing code. Expect the agent to start **without** a power cycle, `:7443` serving, and on the first sync the Cycle-A and Cycle-B Hub credentials `superseded`.
5. **The Terminal is NOT reflashed.** It keeps its card and credential and re-pairs with the Hub over the LAN.
6. Then PIN → first KHR Booking → replay.

## 9. Still open

- Previous-credential rejection was not proven by presenting it (§2).
- The Terminal's system partition hash was not read on the board (sudo password).
- `dev-stack.mjs` origin allowlist, local-stack naming and migration-drift check (§5).
- `t1-bootstrap-routes` PIN lockout test is timing-sensitive at 5 s.

---

## 10. Cycle C on hardware (Hub image `317ca56a…`) — both Hub fixes PROVEN

Same Hub, a fresh card, same NVMe, ONE Hub pairing code. Hub now at `172.16.13.204`.

| Fact                               | Result                                                                                                                                                           |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| device / installation / enrollment | same `4cfc40b4…`; gen 3 `d090cf76…`; seq 3 `37ababb7…`                                                                                                           |
| credential                         | gen 3 `cceb0bda…`, cert `bf88aa9d` active; gens 1 and 2 superseded (cloud)                                                                                       |
| **Fix 1**                          | `ADOPTED … generation 3` 15:56:16 → `Started kitluy-hub-agent.service` the SAME second → `Store Hub is serving terminals`. **No power cycle.**                   |
| **Fix 2**                          | Hub DB: identities `9830…` and `c8bf…`, certs `6c92…` and `e149…` all `superseded`; only gen-3 `e5d113cd…` / `cceb0bda…` active (rotation_generation 3). No SQL. |
| Hub assignment                     | `a6c9d79b` gen 3 active, `laundry`; gen 2 ended by reconciliation                                                                                                |
| probe / migrations                 | cycle A present / 46                                                                                                                                             |
| Terminal                           | NOT reflashed; `terminal-edge SERVING: connected to Store Hub … 172.16.13.204:7443` 10 s after the Hub came up                                                   |
| Hub edge traffic                   | `runtime-eligibility 200 ELIGIBLE`, `configuration-current 200 CONFIGURATION_DELIVERY`, `terminal-pin-status 200`                                                |

Also recorded: under the Cycle-B card, a Terminal pairing session DID complete at 07:28Z after two expired attempts — consistent with defect 2 being an arbitrary tie, not a deterministic refusal.

## 11. Defect 3 — CLOUD: runtime report v3 refused (fixed, `f598089`, group 0238)

`c95bfe1` made v3 the device's current report kind without widening the cloud door, which admitted v1/v2 only: `REPORT_INVALID` every minute; the Partner ladder froze at "No recent report" while the Terminal was SERVING. Group **0238** widens the table CHECK and the door's kind test to v1/v2/v3 (0230's door restated; live door verified identical to 0230 first). Registry integration test red before, 10/10 after. Applied to `kitluy-repo17` (test DB) and `kitluy-fresh` (owner-authorized), psql exit 0, ledger after; the real Terminal's next report was **ACCEPTED 18 s later** (v3, SERVING at `172.16.13.204:7443`, PIN set, release `0.1.0-booking-202609231531`).

## 12. Defect 4 — TERMINAL IMAGE: the POS never starts after a reboot (fixed, `6e950ed` + `f2803bc`)

After the Terminal rebooted (16:09 +07) the Device Shell stayed on "Assigned to a Store — it will finish setting up on its own"; `kitluy-terminal-client.service` was `inactive` while the update agent reported the release "already running". Root cause: `800ecb2` (2026-09-21) put `return { heldForPin }` ABOVE the block in `runOnce` that starts an installed POS at boot, making it unreachable; the POS only ever started on its first install. The block runs before the return again. Guard: `services/kitluy-device-firstboot-agent` now builds with `allowUnreachableCode: false` — tsc fails TS7027 at exactly that line on the unfixed source and passes with the fix. firstboot-agent 927 passed; `hub-provisioning-e2e.db` and the intermittent MAC-reclaim case fail without the change too. The Hub image carries an inert copy (no POS product on a Hub) and was deliberately not repackaged, so `317ca56a…` still matches its commit.

### The fixed Pi Terminal image — flash this

Built from `worktrees/kitluy-ecosystem/wt-terminal-pos-start` at **`f2803bc`**, same flags as `0db42539…` (baked `/etc/kitluy` **identical**), builder `v2.7.0`/`a7b6d480…` not dirty, 09:23→09:44Z.

|                         |                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| compressed (flash this) | `/home/veasna/Development/HET_VEASNA_WORKSPACE/worktrees/kitluy-ecosystem/wt-terminal-pos-start/infra/edge/raspberry-pi/pi-terminal-image/build/work/deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` |
| compressed size         | **998 772 201 bytes**                                                                                                                                                                                         |
| **compressed sha256**   | **`4c9a46663c6e4540d3370d7f5f79b3a00dfa7f6c8eb0cd41a5b9ddbf69dd49ef`**                                                                                                                                        |
| raw `.img` sha256       | `f432e838ad4cfe870753596e62272f8acf03cb56abaad8a80f8a72363440291d`                                                                                                                                            |
| classification          | DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED                                                                                                                                               |

Verification: hashes match the manifest; overlay read-back **101/101** identical from the final erofs (the POS start precedes the final return in the image's `update-bootstrap.js`); image-contents 117/0/0; secret scan 17/0 PASS; build-gates 67/0, environment-gating 20/0, rpi-image-gen 23/0/1, systemd-runtime 246/0 — all equal to `0db42539…`. **`0db42539…` is superseded.**

Next: reflash the Terminal (a new identity → ONE seat pairing code), let it install the release, **reboot it once** to prove the POS comes back, then Terminal PIN → first KHR Booking → replay.

## 13. Terminal image `4c9a4666…` on hardware — POS after reboot, PIN and the first real KHR Booking

Terminal `KL-C33197FAE9EA` (`d5ad30c5-…`), `172.16.29.73`, hostname `pi5-vvyuzb`: installation gen 3 (10:14:05Z), assignment gen 2 revoked automatically (`SD_CARD_REFLASH`), ONE seat pairing code, credential gen 3 `f11d4e91-…` adopted 17:16:36 +07, release `0.1.0-booking-202609231531` (`1cac5454-…`) **INSTALLED** 17:16:58 +07. Terminal↔Hub pairing completed on the **first** attempt (`pairing-sessions 201`, `pairing-proof 200`, `pairing-complete 200`) — Hub fix 2 seen from the Terminal side.

**Defect 4 fix proven:** after the owner's reboot, `event=kitluy.update.terminal-client action="STARTED" releaseId="1cac5454-…"` and `kitluy-terminal-client` active, Device Shell inactive (handed over). Cloud runtime report (v3, accepted): `SERVING … 172.16.13.204:7443`, `pos.state staff_authentication_required` before the PIN.

**Terminal PIN:** `edge:terminal-pin-unlock 200` on the Hub — the actor on every T1 record below is the terminal device `d5ad30c5-…` (the terminal_pin path; no email/password).

**First real Booking (KHR only), read from the Hub database:**

| Record        | Value                                                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| draft         | `1966cadd-4a94-4e29-b2f2-5ac53f97af9e`, walk-in, `t1_walkup`, lifecycle `converted` → the booking below                           |
| booking       | `01a0d815-d055-7b60-822d-b2f17aba69b9` · **`KLB-DEMO-PP-01-260925-000001`** · `intake_confirmed` · business date 2026-09-25       |
| line          | Wash & Fold (per kg) `WF-KG`, 9 kg (9000 g weighed = billable) × 4 000 KHR, service version 3, config version 3                   |
| Hub total     | **36 000 KHR** (subtotal 36 000, tax 0, discount 0), paid 36 000, balance 0 — `config_snapshot_id 119fbfa0-…` (priced on the Hub) |
| payment       | `01a0d815-d05f-…` · `KLP-DEMO-PP-01-260925-000001` · cash · confirmed · idempotency key `kl1.d5ad30c5-….1`                        |
| tender leg    | `01a0d815-d068-…` · cash · **888 800 KHR tendered** · settled → change 852 800 KHR                                                |
| receipt       | `01a0d815-d06d-…` · **`KLR-DEMO-PP-01-260925-000001`** · `booking_receipt` · content sha256 `1c6dd318…`                           |
| recent Orders | `edge:bookings-recent 200`                                                                                                        |

Hub row counts at the time: booking 1, line 1, payment 1, tender 1, receipt 1, draft 1 — **no duplicates**. The governed request-replay test (Phase 10) was **not run**; these counts are not a substitute for it. Not yet recorded: the change amount and receipt as displayed on the Pi screen (owner's observation: "the app is working").
