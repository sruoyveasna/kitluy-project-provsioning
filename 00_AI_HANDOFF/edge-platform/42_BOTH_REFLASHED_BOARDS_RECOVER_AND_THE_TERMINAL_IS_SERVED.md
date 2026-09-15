# Both re-flashed boards recover their credentials, and the Terminal is served again

**Date:** 2026-09-15
**Status:** **HARDWARE VERIFIED — Phase 0 baseline reached, with workarounds.**
Store Hub and Pi Terminal, both re-flashed with the handoff 40 images, recovered
their operational credentials through the governed path, kept their permanent
identities, and the Terminal reached `SERVING` against the Hub.

Getting there took one cloud fix (migration **0225**, committed `ef0727d`) and
several development-only workarounds for defects found on the boards. Each
defect is listed in §6, and each is still open unless marked fixed.

Previous records: handoff 40 (images), handoff 41 (topology audit, defect D1).

---

## 1. Result

```text
Store Hub  KL-CFADA8C75001  device 549a41c6…  active  assignment gen 3
  certificate gen 1 (old card, enrollment 7f31d248)  superseded
  certificate gen 2 DEV-95D5467A59BB9732 (enrollment a1a1d734)  active, adopted on the board
  Hub agent: "Store Hub is serving terminals" 172.16.13.203:7443, hubDeviceId 549a41c6…

Pi Terminal KL-1CB3577C26A7  device 7a6f1e26…  active  assignment gen 2  seat "Pi HEllo" (T1 first)
  certificate gen 1 (enrollment 10c7bd6f)  superseded
  certificate gen 2 DEV-C0FC0A69782D75E6 (enrollment ebc8c6d9)  active, adopted on the board

Terminal edge status 2026-09-15T07:20:33Z:
  phase SERVING, hub 549a41c6… at 172.16.13.203:7443
  reads: authorityTime ok, eligibility ok, configuration ok
  pairing: PAIRED as laundry.t1.intake_cashier   (Hub receipt: generation 2, T1)
  signature "unverified", scopeChecked false — BY DESIGN (handoff 37 §2, BLK-006);
  the anchor is the record's certificate fingerprint matching the connection
```

The permanent identity was preserved on both boards: same device record, same
asset tag, and the credential head advanced (never replaced). No table reset,
no device deleted.

| Item                                                                                                         | Label                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Re-flash credential recovery, Store Hub                                                                      | **HARDWARE VERIFIED** (after 0225; board generation override and governed abandon workarounds)      |
| Re-flash credential recovery, Pi Terminal                                                                    | **HARDWARE VERIFIED** — first attempt, no workaround                                                |
| 0225 activation requires current-enrollment certificate                                                      | IMPLEMENTED · TESTED · **HARDWARE VERIFIED** (both boards rested at `awaiting_trust` after re-pair) |
| Hub identity selection (`selectOperationalHubIdentity`) with a stale revoked identity beside the current one | **HARDWARE VERIFIED** (Hub DB holds `c00ce1a3` revoked + `549a41c6` trusted; eligibility ok)        |
| Terminal ↔ Hub bootstrap (discovery, mTLS, pairing, authority time, eligibility, configuration)              | **HARDWARE VERIFIED** again on the new images                                                       |
| Any POS business workflow                                                                                    | not attempted                                                                                       |

## 2. Starting point

- **Images:** both flashed from handoff 40 (commit `c158dfc`):
  - Store Hub `kitluy-storehub-os-arm64.img.zst` `1aee48ff…e882c2b3`;
  - Pi Terminal `kitluy-pos-terminal-wayland-arm64.img.zst` `d198e129…4766d028`.
- **Registration:** at about 13:12 (+07:00) both boards registered and were
  approved. Each created a new enrollment superseding the previous one:
  Hub #2 over #1, Terminal #3 over #2. That is the strict-ancestor evidence
  recovery needs.
- **Cloud (`kitluy-fresh`):** both devices still `active` at assignment
  generation 1.
- **Stack health:** fleet service `:8787` ready; registration `{}` returned 400.
- **Store Hub:** registered and approved; pairing console waiting;
  `kitluy-hub-storage` **failed** (expected after every Hub re-flash);
  Hub database and agent down.
- **Pi Terminal:** registered and approved; not paired; `NOT_ACTIVATED`.

## 3. What was done, in order

Times are local (+07:00) where a log recorded them.

### Store Hub

1. **Storage.** `sudo /usr/lib/kitluy/hub-storage-provision --authorize-development-unbound`,
   then reboot. The existing LUKS container unlocked and the Hub database came
   back intact. The Hub agent then exited `KLUY-HUB-TLS-MISSING`, which is
   expected with no certificate.
2. **Released the cloud assignment** (generation 1):
   `revoke_device_assignment_v1('549a41c6…', 'SD_CARD_REFLASH', 'OP-VEASNA')` as
   `kitluy_fleet_governor`. The Hub moved to `enrolled`.
3. **Pairing code.** The owner issued it in their own terminal:
   `KITLUY_DEV_FLEET_DSN=…:54372 pnpm dev:pairing:code --local …`.
   **`--local` alone targets `:54392`, the wrong stack.** The code never passed
   through the agent session.
4. **13:41:29 — paired (generation 2), then DEFECT A.** The route's trust
   advance **activated** the Hub on the old card's generation-1 certificate.
   Recovery then refused every request: `KLUY-RECOVERY-DEVICE-STATE: device is active`.
5. **Migration 0225** (owner chose "fix activation, not loosen recovery"):
   - `activate_device_v1` now requires `c.enrollment_id = current_enrollment_id`.
   - The regression test was proven by mutation (§5).
   - Applied to `kitluy-repo17` and `kitluy-fresh` after backups
     (`2026-09-15__kitluy-repo17__before-0225.dump`,
     `2026-09-15__kitluy-fresh__before-0225.dump`). Ledger 124.
   - No service restart was needed; it is a database function.
6. **Released generation 2.** On the board, moved
   `/var/lib/kitluy/pairing-state.json` to `…superseded-20260915-gen2`: the
   console never prompts again while that file says PAIRED (defect E).
7. **13:56:29 — paired (generation 3).** The trust advance was **blocked**, so
   the Hub stayed `awaiting_trust` (0225 confirmed on hardware).
8. **13:56:39 — recovery admitted, then DEFECTS B and C.** Issuance refused:
   `KLUY-CRED-STALE-ASSIGNMENT: request carries generation 1, device is at 3`.
   That left an open `rotate_key` reservation (`pop_pending`) and a generated
   key, which block any corrected request.
9. **Unblock:**
   - Stopped `kitluy-operational-tls`.
   - `abandon_generation_key_v1('549a41c6…', 'development', 'device_identity', 2,
'STALE_ASSIGNMENT_GENERATION_REQUEST_HUB_REFLASH_20260915')` as
     `kitluy_issuance_service`: key and reservation abandoned; no certificate
     involved.
   - Added a runtime drop-in
     `/run/systemd/system/kitluy-operational-tls.service.d/assignment-generation.conf`
     (`KITLUY_ASSIGNMENT_GENERATION=3`; removed at reboot and unnecessary after
     adoption).
   - Moved `/var/lib/kitluy/operational` aside to
     `…superseded-20260915-stale-gen1-request`, because key fingerprints are
     unique for ever. It held no certificate.
   - Restarted the service.
10. **Recovered:**
    `ADOPTED: credential 95d5467a-… generation 2 serial DEV-95D5467A59BB9732`.
    **14:01:55** post-issuance trust advance → **`active`**.
11. **14:02:49** — started `kitluy-hub-agent`; it was not restarted
    automatically after adoption. Output: "Store Hub is serving terminals".

### Pi Terminal

12. **Released** its assignment (generation 1). **Reordered the "Pi HEllo" seat** to
    T1 first through `set_physical_terminal_roles_v1` as
    `kitluy_terminal_issuance_service`: first `[T1]`, then `[T1, T2, T3, T4]`.
    Kept keys keep their ordinal, so T2 had to be removed and re-added (handoff
    41 D1).
13. **Pairing code.** The owner opened a session in their own terminal: an
    8-character Crockford code, its SHA-256 passed to
    `open_terminal_pairing_session_v1` as `kitluy_terminal_issuance_service`.
14. **14:09:05 — paired (generation 2).** Trust advance blocked →
    `awaiting_trust`. **14:09:20** — recovered generation 2 and became `active`
    on the **first attempt**. The board adopted `DEV-C0FC0A69782D75E6`. The
    Terminal records its real generation, so defect B does not apply.

### Store Hub local projection (development stand-in for BLK-006)

The Hub database survived on the NVMe and still described the old cards.

15. **Retired the old Hub rows** on the Hub database: ended assignment `957e4635`
    (old serial `1680be99604fd47e`) and revoked the old `operational_tls` and
    `device_identity` credentials (`SUPERSEDED_BY_REFLASH_RECOVERY_GENERATION_2_20260915`).
    Required: `hub_assignment_active_uq` allows one open assignment per Hub, and
    identical `rotation_generation` values would have made the Hub's signing-key
    selection a tie.
16. **`hub-provision-terminal --hub-self` failed.** It hard-codes
    `assignment_generation = 1` and hit `hub_assignment_generation_uq` (defect D).
    Ran a `/tmp` copy with that one literal changed to `3` (verified by `diff`,
    image file untouched): assignment `5f857f6a`, generation 3, serial
    `95d5467a59bb9732`; new credentials active.
17. **Terminal projection:**
    `KITLUY_DEV_FLEET_DSN=…:54372 node scripts/development/hub-terminal-projection.mjs --asset-tag KL-1CB3577C26A7`
    → copied to the Hub → `--delivery`. The Terminal row now has serial
    `c0fc0a69782d75e6` at generation 2. The script printed
    `certificate_serial: not found` (defect E2). Revoked the Terminal's two
    superseded credentials on the Hub for the same tie reason.
18. **`hub-agent publish-development-configuration` refused** with
    `terminal_profile_assignment_active_uq`: the previous snapshot's grants were
    still open (defect F). The existing grants were T2-first, and the Hub's
    eligibility query picked `laundry.t2.customer_display` — handoff 41 D1, live.
    Closed the four old grants (`effective_until = now()`), re-published.
    Snapshot **v3 active**, grants T1, T2, T3, T4. The exact eligibility query
    returns **`laundry.t1.intake_cashier`**.
19. **14:20:33 — restarted `kitluy-terminal-edge` → `SERVING`**, pairing `PAIRED`
    as T1; all three reads ok.

## 4. Commits

| Commit      | What                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| `ef0727d`   | migration 0225, the recovery test change and new test, register entries for defect A (fixed) and B, C, E (open) |
| this commit | this handoff, the index, evidence register rows, register entry for defects D, E2, F                            |

## 5. Tests

| Check                                                                                            | Result                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Recovery security suite **without** 0225 (re-pair helper now runs the route's trust advance)     | **10 of 15 fail** with `{"kind":"advanced","lifecycleState":"active"}` — the hardware failure              |
| Recovery security suite **with** 0225                                                            | **15/15**                                                                                                  |
| All 25 registry files touching activation, before vs after 0225                                  | failing files and failing tests **identical** (pre-existing, handoff 39 §7); passes 62 → 63 (the new test) |
| First issuance 8/8, key binding 9/9, privilege denial 9/9, trust-advance SQL 6/6                 | pass                                                                                                       |
| Firstboot `paired-identity` + `trusted-time-activation.db`                                       | 21/21, before and after                                                                                    |
| `pnpm migrations:validate` (124), typecheck, lint, prettier on changed files, `pnpm secret:scan` | pass                                                                                                       |

## 6. Defects found on hardware

| #   | Defect                                                                                                                                                                                       | Where                      | Status                        | Workaround used                                      |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ----------------------------- | ---------------------------------------------------- |
| A   | Activation accepted a certificate recorded under a superseded enrollment; a re-paired re-flashed board became `active` and recovery refused it                                               | cloud `activate_device_v1` | **FIXED** (0225)              | —                                                    |
| B   | A Store Hub always requests at assignment generation 1 (`paired-identity.ts` default; the Hub pairing state records no generation); the request is persisted and reused                      | board                      | **OPEN**, needs image rebuild | runtime `KITLUY_ASSIGNMENT_GENERATION`, fresh key    |
| C   | Recovery reserves (and registers the key) before the request's assignment generation is checked; the refused request leaves an open reservation that blocks every later one                  | cloud 0224 ordering        | **OPEN**, cloud-only          | `abandon_generation_key_v1`                          |
| D   | `hub-provision-terminal --hub-self` hard-codes `assignment_generation = 1`; after any re-pair it violates `hub_assignment_generation_uq`, and it never ends or revokes the previous Hub rows | Hub image script           | **OPEN**                      | old rows retired by hand; copy with generation 3     |
| E   | The Hub pairing console never prompts again once `pairing-state.json` says PAIRED; nothing clears it on cloud revocation                                                                     | Hub board                  | **OPEN**                      | file moved aside                                     |
| E2  | Backticks inside a double-quoted SQL comment in `hub-provision-terminal` run as shell command substitution (`certificate_serial: not found`)                                                 | Hub image script           | **OPEN**, cosmetic            | none needed                                          |
| F   | `publishDevelopmentConfiguration` activates a new snapshot but does not close the terminal's previous grants, so re-publishing the same terminal fails                                       | Hub agent (dev)            | **OPEN**                      | old grants closed by hand                            |
| D1  | (handoff 41) seat role order decides the pairing profile; eligibility is T1-only and picks one grant without a tie-breaker                                                                   | cloud, Hub, terminal       | **OPEN**, owner decision      | seat reordered T1 first; grants republished T1 first |
| —   | `pnpm dev:pairing:code --local` targets `:54392`, not the hardware stack                                                                                                                     | dev script                 | **OPEN**                      | `KITLUY_DEV_FLEET_DSN`                               |
| —   | `kitluy-hub-agent` is not started when the operational certificate appears after boot                                                                                                        | Hub image                  | **OPEN**                      | `systemctl start`                                    |

## 7. State left behind (development)

- **Hub board:**
  - `/var/lib/kitluy/DEVELOPMENT-UNBOUND-STORAGE-AUTHORIZED`;
  - `pairing-state.json.superseded-20260915-gen2`;
  - `operational.superseded-20260915-stale-gen1-request/` (an unused key, no
    certificate);
  - runtime drop-in under `/run` (gone at reboot);
  - `/tmp/terminal-delivery.json` and `/tmp/hub-provision-terminal-gen3` (tmpfs).
- **Hub database:** old Hub assignment ended, four superseded credentials
  revoked, the previous snapshot's grants closed, snapshot v3 active.
  - **v3 grants only `KL-1CB3577C26A7`.** The un-flashed Terminal
    `KL-C2B02C760E41` has no active Hub grant until it is re-published.
  - `KL-1054DD1CCC8E`, a stale terminal from 09-11, is still listed.
- **Cloud `kitluy-fresh`:**
  - Hub assignments 1 and 2 revoked and 3 active; Terminal assignment 1 revoked
    and 2 active.
  - Two recovery evidence rows for the Hub: the admitted-then-stuck attempt and
    the successful one. The table is append-only, so both are accurate.
  - One abandoned key and one abandoned reservation.
- **Fleet service** `:8787` still runs from `setsid nohup`, and the edge-runtime
  mount still lives in `/tmp` (handoff 40 §9).

## 8. Next

1. **Fix B and C** (small, bounded). B needs a Hub image rebuild; C is cloud-only.
   Both have a proven reproduction on hardware.
2. **Fix D, E, E2, F** in the development tooling before the next Hub re-flash,
   or the same manual Hub database steps are needed again.
3. **Owner decision on D1** (TOPOLOGY-001, handoff 41). Without it, a T2-first
   seat or an unlucky grant tie refuses a working Terminal.
4. **Resume the U1 release track** only when owner-approved. Release sequence
   5 and `release:chain:check` were not touched today.
