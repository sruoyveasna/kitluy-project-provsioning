# KitLuy Task Handoff — R-1 closed twice over, a Hub that was away can come back, and the image can finally join a Wi-Fi network

## 0. Identity

| Field              | Value                                                          |
| ------------------ | -------------------------------------------------------------- |
| Task ID            | `KL-DEV-HUB-UX-0200-B`                                         |
| Task title         | R-1 structural repair; source-aware trusted time; Wi-Fi fallback; timezone |
| Product/build      | KitLuy Suite — Store Hub / Pi fleet, Phase 1                   |
| Primary agent      | Claude Opus 5 (1M context)                                     |
| Status             | `PARTIAL` — steps 1–8 and 10 done, step 9 blocked on evidence   |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                    |
| Base commit        | `0a30a74`                                                      |
| Final commit       | `UNCOMMITTED`                                                  |
| Handoff date       | 2026-08-24 · Asia/Phnom_Penh                                   |
| Predecessor        | `2026-08-24__SHARED__STORE-HUB-NETWORK-UX-BASELINE__…`         |
| Authority          | Owner decisions 2026-08-24 §§1–11 (R-1 identification, Defect A/B, Wi-Fi stack, execution order) |
| Requested reviewer | Independent security reviewer (this session's review was NOT independent — §6) |

## 1. R-1 — the finding, and why the first repair was not enough

The owner supplied the finding: `establish_device_trusted_time_v1` exposed
caller-controlled trusted-time parameters, and an external review passed
`now() + ~3650 days` as authoritative time. The floor is monotonic, so the
device's trusted-time floor advanced ten years and every later observation reads
as `restricted_clock_rollback` — certificate issuance, activation and renewal all
refuse, permanently, because a rollback path is exactly what a monotonic floor
exists to forbid.

**It was still live at the start of this session.** Verified against the local
PG17 development database, not assumed:

```text
establish_device_trusted_time_v1(
  p_device_id uuid, p_environment text,
  p_valid_rtc_time timestamptz, p_authenticated_network_time timestamptz,
  p_valid_signed_token_time timestamptz, p_correlation_id uuid)
  SECURITY DEFINER  owner=postgres
```

### Repair, layer one — the composition boundary (group 0198, repaired in place)

The three timestamps are gone. The bridge takes `(uuid, text, uuid)` and reads
`now()` **inside** the definer body. A caller may REQUEST establishment; it has
no argument through which to PROVIDE the value.

0198 was repaired in place rather than superseded because it has **not** crossed
a shared-environment boundary — evidence in §5.

### Repair, layer two — found by attacking it, not by reading it

Removing the parameters closed the bridge and left the door underneath open.
Four attacks were run against the live database:

| Attack                                                     | Result |
| ---------------------------------------------------------- | ------ |
| exploit signature, as `kitluy_activation_service`           | `does not exist` |
| direct `evaluate_trusted_time_v1`, as `kitluy_activation_service` | `permission denied` |
| direct `evaluate_trusted_time_v1`, **as `service_role`**     | **SUCCEEDED — floor left at 2036-08-21** |
| direct, as `anon`                                           | `permission denied` |

`service_role` is the role `withServiceRole` connects as before it assumes any
composition identity — the exact caller class R-1 is about. It held a **direct**
EXECUTE grant, and it is **not** a member of `kitluy_activation_governor`
(checked), so revoking genuinely removes the reach rather than shadowing it.
Group 0200 revokes it and asserts its absence on apply.

**R-1 status: `FIXED_IN_DEV`.** Proven by signature, privilege matrix, caller
implementation and negative tests, per the owner's §5 requirement — not by the
caller happening to pass `now()`.

## 2. Defect A — preserved

`device-trust-advance.ts` calls both governed doors through the FROM clause.
Measured: `select (f()).*` executes a 7-field composite **7 times**, `from f()`
**once**. The chain suite now asserts the DELTA — one advance adds exactly one
`device_trusted_time_events` row. Classification `FIXED_IN_DEV`, not conflated
with R-1.

## 3. Defect B — root cause and the exact limit of the fix

**Root cause.** `trusted_time_max_forward_jump_seconds` is 3600 and the floor
advances only on a `trusted` evaluation. Those two rules together make any floor
older than an hour permanently unrecoverable: each observation is classified
`restricted_forward_jump`, which refuses to advance the floor, which guarantees
the next one is further ahead. Reproduced on the development fixture — floor
2026-08-10T07:08:05Z, 13.9 days stale, answering `restricted_forward_jump` to the
real current time.

§12.4's rule is about a LOW-ASSURANCE source: a device's own clock is what an
attacker controls. It was never about elapsed wall time.

**Trusted-time source semantics, before and after:**

| Source                  | Forward jump, before | Forward jump, after | Rollback |
| ----------------------- | -------------------- | ------------------- | -------- |
| `rtc`                   | strict               | **strict** (unchanged) | enforced |
| `authenticated_network` | strict               | **strict** (unchanged) | enforced |
| `signed_cloud_token`    | strict               | **strict** (unchanged) | enforced |
| `cloud_authoritative`   | did not exist        | exempt              | **enforced** |

`cloud_authoritative` is `now()` read inside `evaluate_trusted_time_core_v1`. The
caller requests it with a **boolean** and can never supply its value — the same
invariant R-1 established for the bridge, held one layer deeper so a future
caller cannot lose it. `signed_cloud_token` is deliberately NOT exempted: its
assurance rests on a signature this database does not verify, so exempting it
would reopen R-1 through a different parameter.

**Not added:** no reset function, no floor-clearing door, no operator override,
no second subsystem. A device whose floor was pushed into the future by the R-1
attack stays stuck, and a test asserts it stays stuck.

**Shape of the migration.** `evaluate_trusted_time_v1` keeps its EXACT
six-argument signature and becomes a one-line delegate to a new core; nothing
application code calls is dropped, so no backend can hold a cached plan for a
vanished OID when this reaches hosted dev.

## 4. Defect B tests — the owner's ladder, and how a stale floor is built

Every age in §4 of the owner decision, plus the invariants:

| Assertion                                        | Result |
| ------------------------------------------------ | ------ |
| floor + 30 minutes → re-establishes              | `PASS` |
| floor + 2 hours → re-establishes                 | `PASS` |
| floor + 8 hours → re-establishes                 | `PASS` |
| floor + 24 hours → re-establishes                | `PASS` |
| floor + 14 days → re-establishes                 | `PASS` |
| candidate behind the floor → rollback, floor unmoved | `PASS` |
| **device-offered** source, same 14-day gap → REFUSED | `PASS` |
| rtc at `now() + 3650 days` → refused              | `PASS` |
| authoritative source behind a future floor → rollback, no recovery | `PASS` |
| no source offered → `restricted_no_trusted_source` | `PASS` |
| caller-supplied future timestamp → structurally impossible | `PASS` |

The seventh row is the differential that proves this is source-aware rather than
a blanket removal: the SAME device and the SAME 14-day gap, allowed for the
authority and refused for the device.

**No backdoor was used to build a stale floor.** A fresh device's first
observation lands wherever it is (§12 first-boot rule), so offering
`now() - 14 days` to a brand-new device is a legitimate governed establishment
that leaves exactly the state a Hub has after two weeks in a box. An earlier
draft deleted the fixture's `device_trusted_time` row instead, and **the database
refused it**: `KLUY-DEVICE-TIME-IMMUTABLE: trusted-time state is never deleted`.
The refusal was right and the draft was wrong; the suite now asserts on deltas.

The intentionally corrupted R-1 fixture is not touched, not repaired, not read.

## 5. Migration discipline — the boundary, established from evidence

A dry run recorded on 2026-08-22 (97 files on disk) reported
`remote-applied migrations=96` and `would apply 1 migration(s)` — and it was a
dry run. So the hosted development project stands at **0197**, and **0198/0199
have never crossed a shared-environment boundary**.

- **0198** — unreleased → repaired in place, per owner §6.
- **0123** — long since applied to hosted dev → untouched; the change it needs
  arrives in the additive **0200**.
- **0200** — new, additive, idempotent (verified by applying it twice).

`db:deploy:hosted-dev` was NOT run. No cloud write of any kind.

## 6. Independent security re-review — NOT SATISFIED

Step 6 asked for an independent re-review. What happened is an **adversarial
self-review by the implementing agent**, which is not independent and must not be
recorded as if it were. It was still worth doing — it is what found the
`service_role` hole in §1, which the boundary repair alone had left open, and
that finding changed the migration.

**A genuine second-party review is still owed on this change set.**

## 7. A PostgreSQL crash that is NOT ours, and a comment that got it wrong

The local PG17 container segfaults on a class of permission-denied function
calls, taking the database into recovery. It reproduces on functions this work
never touches — `assert_device_not_contained_v1`,
`assert_support_session_active_v1` — and the container's **first** such crash is
dated **2026-08-07**, seventeen days before this session; there are 20 in total.

An earlier revision of a comment in 0200 confidently attributed the crash to that
group's `drop function`. That was wrong, and the comment is corrected in place
rather than quietly deleted. The core/delegate restructure was kept on its own
merits — not dropping what application code calls — not on the false premise.

**Consequence for the tests:** the natural negative test (CALL the evaluation as
`service_role`, expect `42501`) cannot run here without restarting the database
mid-suite. It asserts through `has_function_privilege` on the same catalog
instead, with the reason recorded inline and the call-based form to be restored
when the instance is repaired.

## 8. Wi-Fi — what was actually missing

The image had `02-wlan0.network` with `DHCP=yes` and **nothing that could
associate with an access point**: no `wpa_supplicant`, no `iw`, no NetworkManager.
`wlan0` had always been ready to take a lease it could never reach.

Per owner §7 the activator stays **systemd-networkd**; only the missing
capability is added.

| Change | Why |
| ------ | --- |
| `wpasupplicant`, `iw` | the association capability, and something a technician can diagnose a radio with |
| `RouteMetric=100` / `600` | Ethernet outranks Wi-Fi **in the routing table**, so the answer survives a reboot with nothing running |
| `RequiredForOnline=no` on wlan0 | without it a wired-only Hub waits out `systemd-networkd-wait-online`'s timeout on EVERY boot |
| `/etc/wpa_supplicant` slot-shared | `/etc` is EROFS at runtime; per-slot would lose the shop's Wi-Fi on every A/B update |
| `ReadWritePaths=/etc/wpa_supplicant` | `ProtectSystem=strict` would otherwise let the console prompt for a password and only then fail to save it |

### Secret handling

1. **No shell, ever** — every command through `execFile` with an argv ARRAY. An
   SSID is attacker-chosen text broadcast by anyone with a radio.
2. **The passphrase enters on STDIN** — `wpa_passphrase` accepts it as argv, and
   that would be world-readable in `/proc/<pid>/cmdline`.
3. **The SSID is stored as HEX** — the quoted form has escaping rules; hex has
   none, so a hostile SSID has nothing to break out of.
4. Only the `psk=` line of `wpa_passphrase` output is kept — its other lines
   return the plaintext as a comment.
5. The console echoes asterisks; the image seeds a config with **no** network
   block, so it stays zero-secret and `secret:scan` stays green.

## 9. Timezone

The built artifact carried `/etc/localtime → Europe/London` while
`KITLUY_DEFAULT_TIMEZONE=Asia/Phnom_Penh` sat in `image.env` **read by no code**.
Now baked at build time (`/etc/timezone`, `/etc/localtime`, and the env value
reconciled), defaulting to `Asia/Phnom_Penh` with no installer step. Asserted by
the image-contract tests, including that no timezone-, language-, Store- or
Location-selection step exists in the console.

This is the APPLIANCE/BUSINESS clock. It does not touch trusted time, which
remains UTC/`timestamptz` throughout and server-established.

## 10. Hub LAN runtime — located, NOT packaged, and NOT claimed

It exists and is substantial. Nothing was invented:

| Piece | Where |
| ----- | ----- |
| Production entrypoint | `services/kitluy-hub-agent/src/bin/hub-agent.ts` |
| LAN `/edge/v1` + mDNS | `src/hub/edge/{routes,transport,discovery}.ts` |
| T1 bootstrap, staff sessions | `src/hub/edge/runtime-bootstrap.ts` |
| Local DB, sync outbox/inbox | `src/hub/{db,outbox}.ts`, `src/hub/sync/*` |
| Startup decisions (pure) | `src/hub-runtime.ts` |
| Tests | 141 passing, 271 skipped |

**Why it is not packaged.** `decideStartup` refuses without TLS material, and
`loadTlsMaterial` requires `HUB_TLS_KEY_PATH`, `HUB_TLS_CERT_PATH` and
`HUB_DEVICE_CA_PATH`. A certificate now exists in the CLOUD (0199), and
**nothing delivers it to the device** — no issuance route, no device client;
`services/kitluy-device-firstboot-agent/src/` contains no certificate client at
all. Packaging it today would ship a service that cannot start.

Secondly, `package-bootstrap-runtime.sh` verifies a ZERO-DEPENDENCY import
closure; the Hub agent has 17 workspace dependencies and would need a bundling
step that does not exist.

**The local-server milestone is NOT complete and is not claimed.** Certificate
delivery to the device is the blocking piece.

## 11. Verification — actually executed

| Check | Result |
| ----- | ------ |
| `trusted-time-staleness.integration` (NEW) | `PASS` 16/16 |
| `hub-activation-chain.integration` (NEW) | `PASS` 3/3 |
| `device-trust-advance-sql` (NEW) | `PASS` 5/5 — 2/4 FAIL at `HEAD` before the fix |
| `network.test` (NEW) | `PASS` 15/15 |
| `network-ui.test` (NEW) | `PASS` 15/15 |
| registry service, full | 172 pass / **19 fail** / 267 skip — the 19 are the recorded pre-existing baseline |
| firstboot agent, full | 320 pass / **3 fail** / 9 skip — see below |
| `systemd-runtime.test.sh` | `PASS` **115 / 0** (was 102) |
| `build-gates.test.sh` | `PASS` 32 / 0 |
| `secret:scan` | `PASS` (1,882 files) |
| `migrations:validate` | `PASS` (99 files) |
| typecheck (both services) | `PASS` |
| eslint | 0 errors (4 pre-existing warnings in untouched files) |
| `package-bootstrap-runtime.sh` | `PASS` — 23 modules, zero-dependency closure holds |
| DB suites re-run 3× | identical, no fixture drift |

**The 3 firstboot failures have a compound cause, and one half is new
information.** They target the PG15 database on **54402, whose ledger stops at
0188** — eleven migrations behind, without 0198/0199/0200. They also encode the
*pre-0200* assumption that a device-offered `authenticated_network` reading may
close an arbitrary gap; under the owner-approved source-aware model it may not.
They are left failing rather than rewritten to pass, because rewriting a security
assertion against a database that cannot exercise the new model would prove
nothing.

## 12. Files changed

| Path | Change |
| ---- | ------ |
| `supabase/migrations/…0198_device_activation_service_identity.sql` | R-1: timestamps removed from the bridge; structural assertion on apply |
| `supabase/migrations/…0200_trusted_time_authoritative_source.sql` | NEW — `cloud_authoritative`, core/delegate split, `service_role` revoke, 6 apply-time guards |
| `services/kitluy-device-registry-service/src/device-trust-advance.ts` | FROM-clause calls; three-argument bridge |
| `services/kitluy-device-registry-service/test/{device-trust-advance-sql,trusted-time-staleness,hub-activation-chain}` | NEW — 24 tests |
| `services/kitluy-device-firstboot-agent/src/network.ts` | NEW — link state, scan, injection-safe join |
| `services/kitluy-device-firstboot-agent/src/bin/network-ui.ts` | NEW — the Wi-Fi screen |
| `services/kitluy-device-firstboot-agent/src/bin/hub-pairing-ui.ts` | network stage before pairing; masked secret input |
| `services/kitluy-device-firstboot-agent/src/trusted-time-gateway.ts` | `cloud_authoritative` added to the source union |
| `services/kitluy-device-firstboot-agent/test/{network,network-ui}.test.ts` | NEW — 30 tests |
| `infra/…/layer/kitluy-hub-base.yaml` | Wi-Fi packages, route metrics, credential seed, timezone |
| `infra/…/slot-shared.d/61-kitluy-wifi.conf` | NEW — credential store survives EROFS and A/B |
| `infra/…/kitluy-hub-pairing.service` | `ReadWritePaths=/etc/wpa_supplicant` |
| `infra/…/package-bootstrap-runtime.sh` | ships the two new modules |
| `infra/…/test/systemd-runtime.test.sh` | 13 new image-contract assertions |

## 13. Rollback

Nothing is committed. `git checkout` the modified files and delete the new ones.
The local PG17 database has 0200 applied — re-running the repaired 0198 and 0200
is idempotent, and no data was migrated. The 2026-08-20 image is preserved at
`infra/kitluy-store-hub-image/build/preserved-2026-08-20/` with its SHA-256.

## 14. Truth statement

- Production modified: `NO`. Staging: `NO`. Hosted development: `NO` — no cloud write.
- Local PG17 development database: 0200 applied; fixtures created and parked as
  `retired`; the adversarial probe fixture (`ADV-PROBE-01`, floor left in 2036 by
  the attack that proved the hole) retired.
- Committed or pushed: `NO`. Deployed: `NO`. `0189`: untouched.
- Secrets in code, docs, logs or this handoff: `NO`. `secret:scan` passed.
- Hardware evidence: **NONE**. Nothing here is `HARDWARE_E2E`.
- Capability claimed: R-1 `FIXED_IN_DEV`; Defect A `FIXED_IN_DEV`; Defect B
  `FIXED_IN_DEV` + `TESTED_IN_DEV`; Wi-Fi and timezone `IMAGE_CONTRACT_VERIFIED`.
  The Hub local-server milestone is **not** claimed. Independent review is owed.
