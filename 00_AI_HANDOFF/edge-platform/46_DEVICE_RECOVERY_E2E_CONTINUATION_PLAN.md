# DEVICE-RECOVERY-E2E-CONTINUATION-001 — continue from the current recovery, image, and hardware state

**Date:** 2026-09-16
**Status:** **CONTINUATION CONTROL PLAN · NO IMPLEMENTATION CLAIMED BY THIS FILE**

This file fixes the order of the remaining Device Recovery work and records the
state it starts from. It changes no code, and no status in the evidence register
moves because of it.

| Fact              | Value                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------- |
| Starting commit   | `86a44b065d642ca909c06b3fdce730a28cea8671` (`provisioning/dev`, fetched and verified)   |
| Previous handoff  | 45 — Raspberry Pi image sources moved under `infra/edge/raspberry-pi/` (structure only) |
| Boot classifier   | 44 — BOOT-RECOVERY-CLASSIFICATION-001 (sources packaged, images **not** rebuilt)        |
| Reflash hardening | 43 — REFLASH-HARDENING-001, defects B and C (images built from `0dd3e1c`)               |
| Hardware baseline | 42 — both re-flashed boards recovered, with workarounds; defects A–F, D1                |
| Owner instruction | DEVICE-RECOVERY-E2E-CONTINUATION-001 (2026-09-16)                                       |

Active image sources (never the old paths):
`infra/edge/raspberry-pi/pi-terminal-image/` and
`infra/edge/raspberry-pi/store-hub-image/`.

## 1. Source-of-truth order

When two sources disagree, the higher one wins, and the conflict is recorded:

1. the latest owner instruction;
2. current `dev` code and migrations;
3. executable tests;
4. current hardware evidence;
5. handoffs 42–45 and later;
6. canonical contracts;
7. older plans.

## 2. Latest hardware session (2026-09-16, before this plan)

The run happened in a separate agent session on 2026-09-16, between 15:12 and
15:56 (+07:00). It was **not yet written to the repository**. What follows was
taken from that session's recorded commands and outputs, then **re-checked
read-only at 16:49 (+07:00, 09:49Z)** without restarting or writing anything.

### Images on the boards

Both boards run the **handoff 43 images** (built from `0dd3e1c`). The images carry
no source-commit stamp (`KITLUY_IMAGE_VERSION=0.2.0-dev` only), so this was
confirmed by hashing files against handoff 43 §7c:

- Hub `bin/hub-pairing-ui.js` `b8297e81…`, `hub-agent/main.mjs` `da3e2088…`, `bin/operational-tls.js` `b39304d8…`;
- Terminal `bin/operational-tls.js` `b39304d8…`, `paired-identity.js` `ea86e88c…`.

Neither image contains `boot-classification` (handoff 44 work is not in any image).

### Store Hub `KL-CFADA8C75001` (device `549a41c6…`), now at 172.16.13.205

| Claim                                   | Evidence                                                                                                                                          | Live re-check 09:49Z                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Re-flash credential recovery **passed** | board: pairing stated generation 4 (not assumed); `ADOPTED` certificate generation 3 on the first attempt                                         | pairing-state `PAIRED`, generation 4 |
| Same physical Hub, same device record   | cloud: `active`, enrollment #4 current; certificate 3 active, 2 retired; one completed `rotate_key`; no open reservation                          | cloud `active`, gen 4, cert head 3   |
| B/C workarounds **not** needed          | no `KITLUY_ASSIGNMENT_GENERATION` drop-in, no `abandon_generation_key_v1`, no key moved; fleet log: no stale-assignment or already-reserved error | —                                    |
| Hub serving at 172.16.13.205:7443       | `Store Hub is serving terminals`, `hubDeviceId 549a41c6…`                                                                                         | `kitluy-hub-agent` active            |

### Pi Terminal `KL-1CB3577C26A7` (device `7a6f1e26…`), at 172.16.29.73

| Claim                                             | Evidence                                                                                                         | Live re-check 09:49Z                                               |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Re-flash **credential recovery passed**           | `assignment generation 3 (stated by terminal-assignment)`; `ADOPTED: … generation 3 serial DEV-0C49A716563D4219` | `assignment.json` generation 3                                     |
| Cloud                                             | `active`, assignment 3 active (1, 2 revoked), enrollment #4, certificate 3 active, one completed `rotate_key`    | `active`, gen 3, cert head 3                                       |
| Hub recognises the Terminal; authority time reads | `reads.authorityTime: ok`                                                                                        | `authorityTime: ok`                                                |
| **Terminal NOT back to SERVING**                  | `HUB_REFUSED: eligibility (409 ASSIGNMENT_GENERATION_STALE), configuration (409 ASSIGNMENT_GENERATION_STALE)`    | **still `HUB_REFUSED`**; 200 refusals in this boot's Hub agent log |

**Keep the two claims apart:**

- **CREDENTIAL RECOVERY PASSED** — true for both boards.
- **FULL RECOVERY END-TO-END PASSED** — **not true.** The Terminal does not reach `SERVING` (Defect G, §4).

### Operations performed by hand in that session

These are recorded so no later claim hides them.

| Where                  | Operation                                                                                                                                                                                                                                                                                                          | Class                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Hub board              | `systemctl start systemd-timesyncd`; the clock was about 23.5 h slow (§5)                                                                                                                                                                                                                                          | workaround for the clock loop                                               |
| Hub board              | `hub-storage-provision --authorize-development-unbound`, then storage and mount started                                                                                                                                                                                                                            | known development step after every Hub re-flash                             |
| Cloud (`kitluy-fresh`) | `revoke_device_assignment_v1` for the Terminal, as `kitluy_fleet_governor`, with owner approval                                                                                                                                                                                                                    | no governed release route yet (BOOT-RECOVERY-DEC-001)                       |
| Owner                  | Hub and Terminal pairing codes issued in the Partner Portal and typed on the devices                                                                                                                                                                                                                               | normal product flow                                                         |
| Hub database           | ended Hub assignment gen 3 and revoked its two credentials; ran a `/tmp` copy of `hub-provision-terminal` with generation `1` → `4` (one-line diff) for `--hub-self`; applied the Terminal `--delivery`; revoked the Terminal's two generation-2 credentials; started `kitluy-hub-database` and `kitluy-hub-agent` | development stand-ins for BLK-006; defects D, E2 and the non-starting agent |

**Not done:** no pairing receipt was edited or deleted; no direct SQL touched cloud
recovery; no key or certificate was moved.

## 3. Starting state of the code (verified at `86a44b0`)

- **Hub eligibility.** `services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts`
  reads the newest `edge_identity.pairing_receipt` for the terminal. It answers
  `PAIRING_REQUIRED` only when **no** receipt exists, and `ASSIGNMENT_GENERATION_STALE`
  whenever the receipt generation differs from `terminal_device.assignment_generation`,
  in **either** direction.
- **Terminal.** `services/kitluy-device-firstboot-agent/src/edge-session.ts` starts its
  automatic pairing only when eligibility ends with `PAIRING_REQUIRED`.
- **Receipts.** `edge_identity.pairing_receipt` is guarded by the
  `pairing_receipt_governance` trigger (`BEFORE INSERT OR DELETE OR UPDATE`).
  Receipts are append-only audit evidence.

## 4. Defect G — the immediate implementation task

**Observed chain:**

```text
Terminal holds assignment generation 3
  → Hub's newest receipt for it is generation 2 (2026-09-15)
  → Hub: ASSIGNMENT_GENERATION_STALE
  → Terminal pairs only on PAIRING_REQUIRED, so it never pairs
  → Terminal never reaches SERVING
```

It did not show on 2026-09-15 only because that Hub had no earlier receipt for this
Terminal. Any Terminal re-paired in the cloud and returning to a Hub that already
holds its receipt hits it.

**Forbidden repairs:** updating or deleting the old receipt, inserting receipt rows
by hand, bypassing the governance trigger, or any direct-SQL repair.

**Required semantics** (smallest correct change):

| Hub receipt generation vs Terminal assignment generation | Answer                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------- |
| receipt < terminal (any gap: N−1, N−2, …)                | `PAIRING_REQUIRED`                                                    |
| receipt = terminal                                       | unchanged: continue normal eligibility evaluation                     |
| receipt > terminal                                       | refuse as stale or suspicious; never downgrade or overwrite authority |

Must not weaken Store, Tenant or Location scope, credential currency, containment,
Hub trust, Hub replacement state or assignment authority. Profile-mismatch
behaviour is unchanged. The old receipt stays as history; a successful re-pair
**appends** a new receipt.

**Required tests (minimum):**

1. receipt N−1, terminal N → `PAIRING_REQUIRED`;
2. receipt N, terminal N → existing behaviour;
3. receipt N+1, terminal N → refused, never downgraded;
4. receipt N−2, terminal N → `PAIRING_REQUIRED`;
5. the historical receipt is unchanged;
6. a new successful pairing appends a new receipt;
7. the Terminal edge session reacts to `PAIRING_REQUIRED` with its existing automatic pairing;
8. security, containment and scope refusals still take precedence where required;
9. profile-mismatch semantics unchanged;
10. reading eligibility causes no durable mutation.

Mutation-test the comparison direction where practical.

## 5. Hub clock loop — investigate, do not guess

**Evidence so far (Hub only; the Terminal journal shows none of it):**

```text
sysinit.target: Found ordering cycle on systemd-timesyncd.service/start
sysinit.target: Job systemd-timesyncd.service/start deleted to break ordering cycle starting with sysinit.target/start
sysinit.target: Found ordering cycle on systemd-tmpfiles-setup.service/start
sysinit.target: Job systemd-tmpfiles-setup.service/start deleted to break ordering cycle starting with sysinit.target/start
sysinit.target: Found ordering cycle on local-fs.target/start
sysinit.target: Job local-fs.target/start deleted to break ordering cycle starting with sysinit.target/start
```

- These repeat at every boot (18 lines in the current boot).
- `systemd-timesyncd` is enabled, but `ConditionResult=no` and it stays inactive.
- `NTPSynchronized=no`, `RTC time 1970`. The clock sat at the fake-hwclock floor, about 23.5 h behind.
- Units involved: `var-lib-kitluy-hub.mount` (`Requires=` and `After=kitluy-hub-storage.service`) and `kitluy-hub-storage.service` (`After=local-fs.target`).

**Not yet proven:** the exact cycle edges. Implicit mount and service default
dependencies are the leading hypothesis, but it must be reproduced from the unit
files before anything changes.

**Why it matters:**

- certificate validity runs on trusted time;
- the Hub agent logged `clockObservation: unavailable` at start, though whether that relates to this cycle is not established;
- `systemd-tmpfiles-setup` being dropped may explain the earlier `/run/postgresql` finding (index entry for the Hub-serving repair).

This affects normal boot, and it is kept **separate from Defect G** unless evidence
joins them.

## 6. Execution order (locked)

### Phase A — close the active hardware recovery blockers

- **A1.** Fix Defect G (§4), with the tests listed there.
- **A2.** Prove automatic re-pair.
- **A3.** Reproduce the Hub clock loop, identify the cycle, and fix it with regression tests once the root cause is proven.

**Phase A acceptance.** Store Hub recovered, Terminal recovered, the Terminal
re-pairs automatically, and the Terminal reaches `SERVING`. **Without** any of:

- direct SQL recovery repair;
- editing or deleting pairing receipts;
- a `KITLUY_ASSIGNMENT_GENERATION` override;
- `abandon_generation_key_v1`;
- moving or deleting the operational key;
- manual certificate manipulation.

Any development-only step that remains (the BLK-006 projection stand-ins, the storage
authorization, the manual Hub agent start) is recorded, and **END-TO-END VERIFIED is
not claimed** while it remains.

### Phase B — rebuild from the new image paths

After the runtime fixes are committed and tested, choose the images from the actual
packaging dependencies:

- Hub Agent only → Store Hub image;
- shared firstboot runtime → both;
- Hub unit files → Store Hub image.

For each affected image, run this chain:

```text
compile → package-bootstrap-runtime.sh → runtime-manifest validation → image tests
→ rpi-image-gen build → read back the final system slot → compare packaged runtime
with committed source → record artifact SHA-256
```

Build only from `infra/edge/raspberry-pi/{store-hub-image,pi-terminal-image}`. The
pre-restructure build directories are never proof of a new build. Packaging alone is
not IMAGE VERIFIED.

### Phase C — full fresh-SD acceptance

- **C1. Store Hub.** Same physical Hub, a new SD card, the latest Hub image. Boot, resolve to the existing Hub, run governed recovery, reach the correct assignment generation and a current operational credential, keep the legitimate Store binding, then start the Hub runtime and serve on the LAN. No engineering workaround.
- **C2. Existing Terminal reconnect.** Before re-flashing the Terminal, confirm the known Terminal reconnects to the recovered Hub. This isolates Hub recovery from Terminal recovery.
- **C3. Pi Terminal.** Same physical Terminal, a new SD card, the latest Terminal image. Boot, resolve to the existing Terminal, run governed recovery, and get a new operational certificate on the same Store, seat and profile. Then Hub discovery, mTLS, `PAIRING_REQUIRED` when the old receipt is behind, automatic re-pair with a new appended receipt, eligibility and configuration, and `SERVING`.
- **C4. Acceptance.** Full Device Recovery E2E is proven only when all of these hold:
  - both SD cards were replaced;
  - the permanent physical device histories are correct;
  - superseded credentials cannot regain authority;
  - the Hub serves;
  - the Terminal reaches `SERVING`;
  - the normal flow used no engineer-only repair.

Hardware steps are given to the owner **one physical action at a time**.

## 7. Not in this slice

Later slices, after hardware recovery passes:

- **P1.** Management API governed recovery actions (including BOOT-RECOVERY-DEC-001, the release route).
- **P2.** Admin Portal operational controls.
- **P3.** Partner Portal recovery and replace UX.
- **P4.** Pi Terminal Device Shell classification UX (GAP-BOOT-005).
- **P5.** Store Hub local recovery UX.

## 8. Known open gaps: audit, do not redesign

| Gap      | What                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------- |
| D        | `hub-provision-terminal --hub-self` hard-codes assignment generation 1 and retires nothing (used again on 2026-09-16) |
| E        | the Hub pairing console keeps local PAIRED state after a cloud revocation                                             |
| E2       | shell command substitution in a SQL comment (`certificate_serial: not found`, seen again on 2026-09-16)               |
| F        | development republish does not close a terminal's previous grants                                                     |
| D1 / S42 | multi-profile seat and desired-profile semantics (owner decision TOPOLOGY-001); profile sorting is **not** a fix      |
| S43      | governed deliberate role change                                                                                       |
| —        | `kitluy-hub-agent` is not started when the operational certificate appears after boot                                 |

Each stays separate unless current code has already fixed it.

## 9. Operations stay distinct

`RECOVER DEVICE` ≠ `REPLACE PHYSICAL DEVICE` ≠ `REINSTALL MEDIA` ≠ `MOVE DEVICE TO STORE`
≠ `CHANGE TERMINAL ROLE`.

The user sees simple physical and business actions; the backend keeps the security and
domain distinctions.

## 10. Edge architecture: preserved, not redesigned

- a generic Pi Terminal image and a separate Store Hub image;
- pinned `rpi-image-gen` `v2.7.0`;
- Ethernet with DHCP first, Wi-Fi fallback, dynamic Hub LAN addressing;
- mDNS discovery kept separate from trust;
- mTLS between Hub and Terminal;
- Store, seat and profile assigned after boot;
- keys and certificates generated or adopted after boot;
- A/B system slots;
- persistent state kept separate from replaceable OS media.

## 11. Test policy for every fix

```text
reproduce → focused regression test → implementation → affected package tests
→ DB and integration tests → packaging and image tests where relevant → pnpm verify
```

- Compare exact failing files and tests with the recorded baseline.
- A new failure is not called pre-existing without evidence.
- Security-critical comparisons are mutation-tested where practical.

## 12. Status labels

Every implementation handoff reports each label separately and only with evidence:

- IMPLEMENTED
- TESTED
- INTEGRATED
- PORTAL VERIFIED
- IMAGE VERIFIED
- HARDWARE VERIFIED
- END-TO-END VERIFIED

The next implementation record is handoff **47**.
