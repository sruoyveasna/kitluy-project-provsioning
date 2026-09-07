# KitLuy Task Handoff — the governed trusted-time door was being called seven times, and the Hub image has no Wi-Fi at all

## 0. Identity

| Field              | Value                                                              |
| ------------------ | ------------------------------------------------------------------ |
| Task ID            | `KL-DEV-HUB-UX-0200-A`                                             |
| Task title         | Store Hub network/provisioning UX baseline; trusted-time call-multiplication repair |
| Product/build      | KitLuy Suite — Store Hub / Pi fleet, Phase 1                       |
| Primary agent      | Claude Opus 5 (1M context)                                         |
| Status             | `PARTIAL` — inspection complete, one repair landed, implementation BLOCKED |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                        |
| Base commit        | `0a30a74`                                                          |
| Final commit       | `UNCOMMITTED` — 1 modified, 1 new test, 1 new handoff              |
| Handoff date       | 2026-08-24 · Asia/Phnom_Penh                                       |
| Predecessor        | `2026-08-20__SHARED__STORE-HUB-HARDWARE-PROOF__…`                  |
| Authority          | Owner clarification "KitLuy Store Hub boot, networking and provisioning UX" (2026-08-24) |
| Requested reviewer | Owner (Veasna)                                                     |

## 1. The blocking ambiguity, stated first

**`R-1` is not recorded anywhere in this repository.** The owner instruction says
to continue "the trusted-time vulnerability already identified as R-1" under an
existing instruction. That instruction is not in this session, and an exhaustive
search found no such record:

| Searched                                              | Result             |
| ----------------------------------------------------- | ------------------ |
| `00_AI_HANDOFF/**` (state files, handoffs, reviews)   | no `R-1` finding   |
| `docs/authority/**` incl. the decision register        | no `R-1` finding   |
| `git log`, all branches, all commit bodies             | no `R-1` finding   |
| Prior session scratchpads on this workstation          | no `R-1` finding   |

The only `R1` hits are the WS-11-T003-Step-4 **reviewer** slots from 2026-08-01
(`R1`/`R2`/`R3` = three reviewers), all APPROVED and unrelated to trusted time.

Rather than guess, the trusted-time chain was audited directly. **Two defects
were found, both with reproduced evidence.** One is repaired here; the other
cannot be repaired without changing trusted-time semantics, which the same
instruction forbids (§12). The owner must say which of these is `R-1`, or supply
the missing record.

## 2. DEFECT A — repaired: a governed door executed 7x per pairing

`services/kitluy-device-registry-service/src/device-trust-advance.ts` called both
governed doors through `select (fn(...)).*`. PostgreSQL expands a composite in
the **SELECT list** by re-evaluating the function **once per field**:

| Door                                | Return type              | Fields | Executions per pairing |
| ----------------------------------- | ------------------------ | -----: | ---------------------: |
| `establish_device_trusted_time_v1`  | `trusted_time_outcome`   |      7 | **7**                  |
| `attempt_activate_device_v1`        | `activation_outcome`     |      6 | **6**                  |

Measured on this schema, not inferred:

```text
SELECT-list form  `select (f()).*`  -> function bodies executed: 7
FROM-clause form  `from f()`        -> function bodies executed: 1
```

Consequences, all inside the security chain:

- **Seven trusted-time evaluations** per pairing, each writing its own
  `device_trusted_time_events` row, and each re-evaluating `gen_random_uuid()`
  — so one event carried **seven different correlation ids**.
- The reported `status` came from a *later* call that had already seen the floor
  its own earlier call advanced, so `floor_advanced` was structurally unreliable.
- **Six activation attempts** per pairing through "THE ONLY reachable activation
  path", each committing its own evidence event; the returned `outcome` and
  `lifecycle_state` were read from two different attempts.

An audit trail that multiplies a security decision by seven cannot be reconciled
against what actually happened. This is the exact hazard
`services/kitluy-device-firstboot-agent/src/trusted-time-gateway.ts` already
documents for the *same function* and avoids by using the FROM form — the cloud
caller was written later and did not.

**Why nothing caught it:** the router suite injects `advanceTrust` and never
reaches the SQL, and live runs looked correct because the last evaluation still
returns a plausible row.

**Repair:** both call sites moved to the FROM-clause form, selecting the named
columns. No semantics changed, no gate weakened, no migration touched.

**Regression test:** `test/device-trust-advance-sql.test.ts` (4 tests) asserts the
statement text uses the FROM form, that each door appears exactly once, and that
the two identities still take separate transactions. Proven real by reverting to
`HEAD` and re-running: **2 of the 4 fail against the old code, all 4 pass against
the fix.**

## 3. DEFECT B — NOT repaired: trusted time locks a Hub out permanently after 1 hour offline

Development policy (`kitluy_devices.trust_policy`, read live):

```text
environment=development   max_clock_lag_seconds=300   trusted_time_max_forward_jump_seconds=3600
```

`evaluate_trusted_time_v1` classifies `v_best > v_floor + v_jump` as
`restricted_forward_jump`, and the floor advances **only** on a `trusted`
evaluation. So once real time moves more than one hour past a device's floor, no
source can ever offer a time inside the window again, and the device is
restricted **permanently**. Observed live on the development Hub fixture:

```text
floor  2026-08-10T07:08:05.094Z   age 1,197,247 s (~13.9 days)
status restricted_forward_jump
anomaly "selected time is more than 3600 seconds ahead of the trusted floor"
```

This is why three trusted-time tests are red (see §7) — they are reporting a real
product defect, not test rot.

**Operational meaning:** a shop that closes overnight, or a Hub that is shipped,
power-cycled or stored for more than an hour, can never re-establish trusted
time. That directly contradicts owner clarification §7 ("an ACTIVE Hub resumes
local-server operation automatically").

**Deliberately not fixed here.** Every available fix changes trusted-time
semantics (re-anchor the floor, add a governed recovery door, or re-scale the
policy numbers), and owner clarification §12 forbids a new trusted-time
implementation, trusted-time weakening and caller-supplied time. **This needs an
owner decision.** It also interacts with the unresolved 30/10/30 certificate
policy already recorded in the 2026-08-20 handoff §8.

## 4. Store Hub image baseline — verified against the BUILT rootfs

Read from `infra/kitluy-store-hub-image/build/work/chroot-v2.7.0/filesystem`,
not from documentation.

| Question                        | Verified answer                                                     |
| ------------------------------- | ------------------------------------------------------------------- |
| Boot target                     | `multi-user.target` (no graphical target)                            |
| CLI/TUI entrypoint              | `/usr/lib/kitluy/hub-pairing-ui` on **tty1**, `kitluy-hub-pairing.service` |
| Networking stack                | **systemd-networkd + systemd-resolved** (upstream `systemd-net-min`) |
| NetworkManager                  | **NOT installed** — no `/etc/NetworkManager`, no `nmcli`             |
| Ethernet DHCP                   | `/etc/systemd/network/01-eth0.network` → `[Match] Name=eth0` `DHCP=yes` |
| Wi-Fi capability                | **NONE.** No `wpa_supplicant`, no `iw`, no `iwd`, no NetworkManager. `02-wlan0.network` exists with `DHCP=yes` but nothing can associate with an AP |
| Wi-Fi setup UI                  | **Does not exist** — the console has no network surface at all       |
| Pairing-code CLI                | Exists; prompts for a code only, no Store/Location picker            |
| tty ownership                   | tty1 = product; getty on **tty2**; `NAutoVTs=0`; **no root autologin** |
| Local services without WAN      | `kitluy-hub-storage`, `kitluy-hub-database`, `postgresql`, `kitluy-hub-pairing` declare **no** network dependency → they start offline |
| Timezone                        | `/etc/localtime → Europe/London`, `/etc/timezone = Europe/London`    |
| `KITLUY_DEFAULT_TIMEZONE`       | `Asia/Phnom_Penh` in `/etc/kitluy/image.env` and **read by no code**  |
| Hub agent (LAN `/edge/v1`)      | **NOT packaged.** Not in `DEVICE_MODULES`, no unit, no binary. Only named in a layer comment |
| Trusted-time gateway on device  | **NOT packaged** — so no device-clock path exists in the shipped image |

Store Location authority is already correct cloud-side:
`kitluy_devices.hub_pairing_sessions` carries `tenant_id`, `digital_store_id` and
`store_location_id` (0194), and `store_locations.timezone` defaults to
`Asia/Phnom_Penh` (0020). The device presents a code and chooses nothing.

## 5. Gaps against the approved workflow

| # | Clarification | Gap | Severity |
| - | ------------- | --- | -------- |
| G1 | §5, §6, §14-B/C | **No Wi-Fi stack on the image.** Tests B and C cannot pass; they cannot even be attempted | HIGH — needs an owner decision on which stack to add |
| G2 | §4, §14-A/D | No network status surface and no Ethernet/Wi-Fi preference policy. Ethernet DHCP works, but "retry Ethernet" and deterministic preference do not exist | HIGH |
| G3 | §9, §11, §14-E | **Hub agent is not on the image.** After activation nothing serves the LAN API; T1–T4 have nothing to connect to. Local *database* does start offline | HIGH |
| G4 | §3 | OS timezone is `Europe/London`; `KITLUY_DEFAULT_TIMEZONE` is inert; no Location→device timezone projection | MEDIUM |
| G5 | §2 | Pairing returns IDs only — no Location name, address, timezone or vertical. "the Hub receives the authoritative Location configuration" is unimplemented | MEDIUM |
| G6 | §11 | No status surface (Local API / Database / Ethernet / Wi-Fi / Cloud / Sync / Terminals) and no controlled action menu | MEDIUM |
| G7 | §4, §14-F | `systemd-networkd-wait-online` is enabled with upstream defaults while `wlan0` can never come up. Units with `Wants=network-online.target` risk waiting out its timeout on every boot. **Not proven on hardware** — reasoned from the unit configuration | LOW–MEDIUM, needs hardware |

Nothing in §14 A–H has been proven on hardware in this session.

## 6. Why the implementation was not started

Owner clarification §13: *"After the R-1 repair is green, implement only the
minimum missing pieces."* R-1 is unidentified (§1) and the trusted-time suite is
red (§3), so the owner's own gate is not open. In addition §6 requires inspecting
the stack before choosing a mechanism — done, and the answer (**systemd-networkd,
no wireless stack whatsoever**) makes the choice a real decision with image-size,
attack-surface and A/B-update consequences that belongs to the owner:

- **`wpa_supplicant` + a KitLuy TUI writing `/etc/wpa_supplicant/*.conf`** — smallest
  addition, keeps networkd, credentials in a root-only file.
- **NetworkManager (upstream `net-misc/network-manager` layer already vendored)** — matches the
  clarification's own example, gives `nmcli` scanning and protected
  `system-connections` storage at 0600, but replaces the activator and is the
  larger change.

Either way the credential rule is the same: `nmcli`/config written through safe
argv execution, never shell-string concatenation; the PSK never enters KitLuy
JSON, logs, audit records, pairing records or telemetry.

## 7. Verification — actually executed

| Check                                        | Result                              |
| -------------------------------------------- | ----------------------------------- |
| `device-trust-advance-sql` (new)             | `PASS` 4/4 — and 2/4 FAIL at `HEAD` |
| `device-trust-advance` (existing)            | `PASS` 6/6                          |
| registry service, full suite                 | 149 pass / **19 fail** / 267 skip — the 19 are the recorded pre-existing baseline (missing local relations/roles: `kitluy_ops.test_clock_policy`, `kitluy_devices.hardware_profiles`, `kitluy_test_harness`) |
| firstboot agent, full suite                  | 290 pass / **3 fail** / 9 skip — the 3 are DEFECT B |
| `systemd-runtime.test.sh`                    | `PASS` 102 / 0                      |
| `build-gates.test.sh`                        | `PASS` 32 / 0                       |
| `secret:scan`                                | `PASS` (1,882 tracked files)        |
| `migrations:validate`                        | `PASS` (98 files)                   |
| `contracts:validate`                         | `PASS` 4 / 4                        |
| `tsc --noEmit` (registry service)            | `PASS`                              |
| `eslint` + `prettier --check` (changed files)| `PASS`                              |

`pnpm verify` (the aggregate) was **NOT** run to completion in this session.

## 8. Files changed

| Path                                                              | Change |
| ----------------------------------------------------------------- | ------ |
| `services/kitluy-device-registry-service/src/device-trust-advance.ts` | both governed calls moved to the FROM-clause form, with the reasoning inline |
| `services/kitluy-device-registry-service/test/device-trust-advance-sql.test.ts` | NEW — 4 tests |
| `00_AI_HANDOFF/shared/2026-08-24__…__AI-HANDOFF.md`               | NEW — this file |

No migration, no image file, no portal and no unrelated file was touched.

## 9. Rollback

`git checkout services/kitluy-device-registry-service/src/device-trust-advance.ts`
and delete the two new files. Nothing else to undo — no cloud write, no deploy.

## 10. Next step

1. **Owner: identify `R-1`** — Defect A, Defect B, or a record not in this repo.
2. **Owner: decide Defect B**, since it changes trusted-time semantics and §12
   forbids doing that unilaterally. It interacts with the open 30/10/30 policy.
3. **Owner: choose the Wi-Fi stack** (`wpa_supplicant` vs NetworkManager).
4. Then implement G1–G3 as the minimum set, and prove §14 A–H on hardware.

## 11. Truth statement

- Production modified: `NO`.
- Hosted development project modified: `NO`. No cloud write of any kind.
- Local development database: read-only queries, plus one throwaway `kl_probe`
  schema created and **dropped** to measure composite re-evaluation. No device,
  fixture or trusted-time row was written.
- Secrets in code, docs, logs or this handoff: `NO`. `secret:scan` passed.
- Committed or pushed: `NO`.
- Deployed: `NO`.
- Hardware evidence: **NONE.** Nothing here is `HARDWARE_E2E`.
- Capability claimed: the call-multiplication repair is `IMPLEMENTED-IN-DEV` with
  a regression test proven against the defect. Wi-Fi, the network TUI, the Hub
  LAN API and the status surface are **not built and not claimed**.
