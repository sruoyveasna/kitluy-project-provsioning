# TERMINAL-PIN-AND-REAL-POS-AUTH-001 — the Terminal PIN is built; a Pi Terminal's credential is its device certificate plus one PIN, with no staff login

**Date:** 2026-09-17 · Asia/Phnom_Penh

| Item                                                                       | IMPLEMENTED | TESTED                                 | INTEGRATED                                       | PORTAL VERIFIED         | IMAGE VERIFIED                                                                         | HARDWARE VERIFIED | END-TO-END VERIFIED |
| -------------------------------------------------------------------------- | ----------- | -------------------------------------- | ------------------------------------------------ | ----------------------- | -------------------------------------------------------------------------------------- | ----------------- | ------------------- |
| Store Hub Terminal PIN (hub 0043, verifier, lock, reset, five routes)      | yes         | yes (5 live-mTLS cases + 4 unit)       | yes (real Hub DB, real router)                   | n/a                     | overlay re-packaged; bundle + Argon2id run on image Node 18 (QEMU); **no image built** | **no**            | **no**              |
| PIN session authorizes T1 intake from the terminal's own grant             | yes         | yes                                    | yes (real-parts e2e: Booking Draft under a PIN)  | n/a                     | as above                                                                               | **no**            | **no**              |
| POS: PIN setup twice / unlock / lock / change; no staff, email or password | yes         | yes (5 runtime, 23 boundary)           | yes (real-parts e2e)                             | n/a                     | n/a (release payload)                                                                  | **no**            | **no**              |
| Terminal: bridge PIN routes, staff routes gone, PIN state in edge-status   | yes         | yes (40 bridge, 25 edge/report)        | yes (real-parts e2e)                             | n/a                     | Terminal overlay re-packaged; **no image built**                                       | **no**            | **no**              |
| Runtime report v2 (PIN evidence) → cloud 0230 → Management API → Portal    | yes         | yes (30 contract, 9 registry, 183 API) | yes (0230 on `kitluy-fresh` and `kitluy-repo17`) | **no** (no browser run) | n/a                                                                                    | **no**            | **no**              |
| Partner ladder: **PIN set** real, **Operational** the conjunction          | yes         | yes (68/68)                            | n/a                                              | **no** (no browser run) | n/a                                                                                    | **no**            | **no**              |
| Decision record KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001          | yes         | —                                      | —                                                | —                       | —                                                                                      | —                 | —                   |

**Not reached:** hardware. No board was changed. **Both images were then built from `4a8bdc6` and read back (§11): IMAGE VERIFIED, NOT BOOT-TESTED.** The handoff 47 Store Hub image `cd1c77ca…` and the handoff 48 Pi Terminal image `ef4594e7…` do NOT contain the PIN and are superseded for this milestone (preserved under `build/preserved-20260917-h47-image/` and `build/preserved-20260917-h48-image/`).

| Fact                   | Value                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Starting commit        | `a0662d68bcb57c6ea97a5841a1b9b7ad7dc327df` (`provisioning/dev`, fetched and verified)                                                                                                    |
| Ending commit          | this handoff's commit (§10)                                                                                                                                                              |
| Previous edge handoff  | 48 (T1-STORE-OPERATIONS-001)                                                                                                                                                             |
| Decision               | `docs/decisions/kitluy-terminal-pin-device-credential-owner-decision-v1.0.0.md` (KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001)                                                      |
| Register               | KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001, KLREC-2026-09-17-RUNTIME-REPORT-V2-PIN-EVIDENCE-001; items 1–2 of KLREC-2026-09-17-T1-HARDWARE-STORE-OPERATION-DECISIONS-001 resolved |
| Uncommitted, preserved | `scripts/development/issue-dev-pairing-code.mjs` (pre-existing; not this task)                                                                                                           |

## 1. What was inspected first (source-backed)

### 1a. The standalone Laundry POS (`repos/het-kitluy-standalone-repos/kitluy-laundry-pos-desk-app`, branch `feat/full-app-wiring`, HEAD `d5d1a26`; not modified)

- **Login as checked out:** none — `src/lib/devBypass.ts:18` `AUTH_BYPASS = true`; every launch opens Terminal Select and taps go straight in with fixture ids. The email + password screen (`src/features/auth/LoginScreen.tsx`) was deleted in that commit (readable at `d5d1a26^`).
- **Login when the real backend is on:** two layers. Each staff member signs in with their **own Supabase Auth email + password** (`signInWithPassword`); `pos_api.get_session_bootstrap` resolves membership, branch, access group and `pin_set`. Then, on Terminal Select, T1/T3/T4 ask for a **personal 4-digit PIN** (`src/features/auth/PinModal.tsx`: 4 dots, `[1-9, clear, 0, del]` keypad, auto-submit at 4 digits, no staff picker — the signed-in person's name is shown). First use SETS the PIN with no confirm step (`PinModal.tsx:81-89`). The PIN is sent plaintext to `pos_api.set_operator_pin` / `verify_operator_pin` / `authorize_terminal_session` and, with a device credential, to the `pos-terminal-session` Edge Function (up to three times per entry).
- **Storage/lockout:** server-side, not in the repo; docs point to bcrypt via pgcrypto and "5-fail / 15-min lockout" (`docs/handoffs/2026-07-18…:77`). Client shows "PIN locked — try again in 15 minutes" on `LOCKED_OUT`.
- **Lock screen (`src/features/auth/PinLogin.tsx`):** a fixture — staff tiles from `src/fixtures/staff.ts` with **plaintext PINs compared in the browser**, never wired to a backend; any fixture PIN unlocks as whichever tile is selected.
- **Device identity there:** a `device_uid` from `list_authorized_terminals` plus an optional credential read in the RENDERER from `VITE_KITLUY_DEVICE_CREDENTIAL` or `localStorage` (a `VITE_` variable is built into the bundle); no pairing UI; the terminal JWT lives in memory (900 s). Its own backend handoff says the credential must go through Electron main, which the code does not do.
- **Reusable there:** the 4-digit keypad/dots pattern and its messages (adopted in `src/pin-screen.tsx` as a pattern, not copied); `Step0Customer` (phone-or-name search, 300 ms debounce, `+855` normalisation) and the booking wizard are Supabase-coupled and were not taken.
- **Not there:** idle auto-lock, PIN change/reset in-app, any client-side attempt limit, an offline queue (`online` is never set).

### 1b. The locked documents

- **KLD-2026-09-03-TERMINAL-PROVISIONING-001 (OWNER-LOCKED)** §10–§15: one 4-digit **Terminal PIN per device**, created twice after the app installs, verified by the Store Hub (Argon2id verifier, never raw), Hub-side attempt counting that survives a reboot, governed audited reset; and §11: the PIN "is not a substitute for staff identity", a normal flow being _Terminal PIN → unlock → app → staff login_.
- **POS desktop spec v4 §4.1/§4.3, Partner Portal spec v2 §12.2, cloud schema v1 §81:** a **per-employee "Staff PIN"** (4–6 digits, Owner/Manager managed, cached on the Hub). Not locked.
- **KLREQ-025 (OWNER-APPROVED):** the Hub never authors a grant. **KLD-2026-08-06-WS12-T001-EDGE-BOOTSTRAP-001 (LOCKED):** the staff-session permission keys and that a session alone never authorizes T1.
- **No document** ties the PIN to reflash or hardware replacement, gives Argon2id parameters, or gives lockout numbers (OD-006 open).

### 1c. The repository before this task

Staff ID (UUID) + 4–128-character passcode, scrypt on the Hub, **no throttling at all**, no staff ever deliverable to a real Hub (fixture verifiers were the wrong length; only tests insert staff). Terminal PIN: nothing but the portal's `pinSet` label marked unbuilt.

## 2. The conflict, and the owner's ruling

The locked decision, the target specs, the standalone app and the build disagreed on the human credential (three models, §1). Per mission §7 I stopped and asked four questions. Answers, verbatim: **"One shared Terminal PIN only"** · **"PIN alone"** · **"Just pin no logout login use the device as credentials"** · **"5 failures, 15-minute lock"**. Recorded as KLD-2026-09-17-TERMINAL-PIN-DEVICE-CREDENTIAL-001, which amends §11/§15 of KLD-2026-09-03 (the staff layer under the PIN) and leaves §10, §12, §13, §14, §20 standing.

## 3. The model as built

```text
DEVICE  identity key → enrollment → assignment → operational cert → mTLS → Hub → receipt → eligibility
HUMAN   Terminal PIN (4 digits, one per device) → Store Hub verifies (Argon2id) → T1 session, actor = the terminal
BOTH required. No staff login, no email, no password, no staff ID, no logout: lock / unlock.
```

- **Hub 0043** `edge_identity.terminal_pin` (verifier as an Argon2id PHC string; `failed_attempts`, `first_failed_at`, `locked_until`; `state set|reset_required`; never-removed trigger) and `terminal_session.credential_kind` with a CHECK that a `terminal_pin` session's actor IS the terminal device.
- **Routes** (`/edge/v1/terminal-pin/status|setup|unlock|change|lock`): the mTLS gate maps the peer to a current credential first; setup/unlock/change also demand runtime eligibility. A revoked, unpaired, contained or ungranted terminal never has its PIN read (tested).
- **Verification** under `select … for update` on the terminal row: 5 failures within 15 minutes lock for 15 minutes; a locked PIN is not verified at all; correct entry resets the count; `security_event` rows for each failure, the lock, and attempts while locked; `audit_event` rows for established/unlocked/changed/reset. Nothing logs a PIN (log census test).
- **Authorization**: a PIN session authorizes exactly `pos.t1.use`, `customers.read/create`, `customers.consent.record`, `laundry.bookings.read/create`, and only while the terminal's own T1 profile grant from the ACTIVE snapshot is current and no blocking containment exists — re-read on every intake request. Financial/custody/refund/override actions are not in it (§11 attribution rule stands).
- **Reset**: `hub-agent reset-terminal-pin --terminal <uuid> --operator <ref> --reason <code>` on a development Hub only (refuses elsewhere); operator and reason land in the immutable audit journal; open PIN sessions close; the terminal asks for a new PIN twice. The Partner-Portal reset of §14 waits on BLK-006.
- **Terminal**: the bridge forwards the five PIN routes and **no longer forwards** `/edge/v1/sessions/*`; terminal-edge reads the PIN status each cycle into `edge-status.json`; the runtime report is **v2** with `hubLink.terminalPin` and `pos.terminalUnlocked`.
- **POS**: `PiTerminalRuntime` holds one PIN session (memory only; a restart is locked); `#acquireSession` asks the Hub every run whether the PIN and the held session are still good (a reset elsewhere is let go on the next run); `pin-screen.tsx` has create/confirm/unlock/locked faces from `report.pin`; `pin-ipc.ts` accepts four-digit PINs in named fields and returns only a verdict plus the public posture.
- **Cloud 0230**: `device-runtime-report.v2` accepted beside v1 (terminals in the field keep reporting). Management API `terminalPin` and `terminalUnlocked`. Partner ladder: **PIN set** done only from `terminalPin.state = set` (with "PIN locked" / "a new PIN must be set" notes); **Operational** done only when connected, installed, running, configuration loaded and PIN set are all done from the SAME fresh report and the PIN is not locked.

## 4. Security properties (all tested)

| Mission §15 item                             | Where proven                                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 setup only through the authorized path     | hub e2e: revoked credential → `CREDENTIAL_NOT_CURRENT`, unpaired → `PAIRING_REQUIRED` before any PIN row exists; setup a second time → `PIN_ALREADY_SET`    |
| 2 never plaintext                            | hub e2e: row verifier `^\$argon2id\$…`, row and audit JSON never contain the PIN; `terminal-pin.test.ts`                                                    |
| 3 absent from logs                           | hub e2e census (every PIN and verifier pushed to `censusSecrets`; log lines checked)                                                                        |
| 4 absent from runtime reports                | `runtime-report.test.ts` (a `pin`/`verifier` in edge-status is dropped); contract test refuses a `pin` field                                                |
| 5 absent from Management API                 | `terminal-runtime-dto.test.ts` ("never carries a PIN or a verifier")                                                                                        |
| 6 absent from Partner payload                | same DTO; the portal reads `terminalPin.state/setAt/lockedUntil` only                                                                                       |
| 7 wrong PIN refused                          | hub e2e, POS runtime, POS real-parts e2e                                                                                                                    |
| 8 rate-limited per policy                    | hub e2e: 4 × `PIN_INCORRECT` with counts, 5th `PIN_LOCKED` ~15 min, correct PIN refused while locked across TWO router instances (a restart); window expiry |
| 9 correct PIN opens the right session        | hub e2e: `credentialKind terminal_pin`, actor = device, T1, 8 h                                                                                             |
| 10 Store-scoped                              | the session's scope is the terminal's; another terminal's session → `SESSION_UNKNOWN`; another terminal's PIN is simply wrong                               |
| 11 revoked/disabled cannot authenticate      | revoked credential → refused before the PIN (hub e2e; POS e2e `credential_invalid`)                                                                         |
| 12 expired/invalid grants refuse T1          | T1 grant ended → intake `T1_NOT_AUTHORIZED`, unlock `PROFILE_NOT_GRANTED`                                                                                   |
| 13 device failure blocks regardless of PIN   | as 1 and 11; containment → `CONTAINMENT_PROHIBITS`                                                                                                          |
| 14 untrusted Terminal cannot use a valid PIN | as 1 (the PIN is never read)                                                                                                                                |
| 15 valid device + valid PIN → READY          | POS runtime and real-parts e2e                                                                                                                              |
| 16 lock clears the session                   | POS runtime + e2e: intake refused after lock; Hub `SESSION_CLOSED`                                                                                          |
| 17 reboot re-authenticates                   | the session is memory-only (`PiTerminalRuntime`); a fresh process starts locked (runtime test "no PIN action while checks fail" + design)                   |
| 18 app update keeps the PIN                  | the record lives on the Store Hub, keyed by terminal device; nothing on the terminal holds it                                                               |
| 19 fresh-SD recovery per policy              | **no policy exists** — recorded as `[REQUIRED]` in the decision; as built, the same recovered terminal device row keeps its PIN                             |
| 20 ladder PIN set only from evidence         | portal tests: `terminalPin` absent/null/setup_required → `current`, never done from a running app                                                           |
| 21 Operational needs the PIN                 | portal tests: no PIN, reset required, not running, no configuration, not connected → never done                                                             |
| 22 no email/password on the Pi               | `pi-terminal-boundaries.test.ts` scans the Pi path's code (comments stripped) for `password                                                                 | email | signInWith… | sessions/open | kitluyT1Staff` |

## 5. Tests

| Suite                                                            | Result                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| hub-agent (full, `kitluy-hub-local` with 0043)                   | **461 passed**, 2 skipped (457 + 4 new unit); 5 new PIN cases in `t1-bootstrap-routes.integration`; 3 mutations caught (limit 5→6, grant check, lock bypass)                                                             |
| device-identity contract `device-runtime-report`                 | 30/30 (v1 and v2, kind-bound signature)                                                                                                                                                                                  |
| device-identity (full)                                           | 935 passed, 23 skipped; 2 suites fail at setup — baseline                                                                                                                                                                |
| firstboot agent (full)                                           | **896 passed**, 9 skipped, 1 failed (`hub-provisioning-e2e.db`, baseline)                                                                                                                                                |
| registry `device-runtime-report.integration` (`kitluy-repo17`)   | 9/9 (v1 still accepted, then v2)                                                                                                                                                                                         |
| Management API                                                   | 183/183                                                                                                                                                                                                                  |
| Partner Portal                                                   | 68/68                                                                                                                                                                                                                    |
| POS (full, Hub DB live)                                          | **130 passed**, 1 failed (`t1-startup.e2e`: 2 515 pending outbox rows past the 100 limit — baseline, handoff 48 §7)                                                                                                      |
| POS real-parts e2e `t1-pi-edge`                                  | 1/1: pair → SERVING → **PIN setup twice → READY → customer → Booking Draft (v2, outbox pending) → lock → wrong PIN (4 left) → unlock → reopen**; staff door 404 at the bridge                                            |
| Image suites (both trees, re-packaged overlays)                  | Hub 34/19/22/183/57/33 · Terminal 67/20/23/244/117 — all 0 failed                                                                                                                                                        |
| Hub bundle + Argon2id under the Hub image's Node 18 arm64 (QEMU) | bundle loads, `reset-terminal-pin` refuses on a non-development Hub; Argon2id verifies (1.1 s under emulation)                                                                                                           |
| `pnpm verify`                                                    | exit 1, baseline only: Format (EACCES old build tree), Unit (device-identity concurrency setup), Docs links (4, July); Lint, Typecheck 103/103, Contract, Offline, Build, OpenAPI, Migration ×2, Secret scan, Clock PASS |

## 6. Migrations

- `hub/migrations/0043_terminal_pin.sql` — applied to `kitluy-hub-local` (44/44, no drift); in the Hub overlay's `hub-migrations/` + manifest.
- `supabase/migrations/20260917120000_0230_device_runtime_report_v2.sql` — applied to `kitluy-fresh` and `kitluy-repo17` with exit-code-gated ledger rows (`0230_device_runtime_report_v2`). Constraint widening only, marked `destructive-approved` per the 0191 pattern.

## 7. Files changed

Hub: `hub/migrations/0043_terminal_pin.sql`, `services/kitluy-hub-agent/src/hub/edge/{terminal-pin,routes,runtime-bootstrap}.ts`, `src/bin/hub-agent.ts`, `src/hub-database.ts`, `package.json` (+`hash-wasm` via catalog), tests. Contract: `packages/device-identity/src/device-runtime-report.ts`. Terminal: `services/kitluy-device-firstboot-agent/src/{edge-bridge,edge-session,runtime-report,runtime-report-bytes}.ts`, tests. Cloud: 0230; `services/kitluy-device-registry-service/test`; `services/kitluy-management-api/src/terminal-provisioning.ts`, test. Portal: `apps/kitluy-partner-pwa-portal/src/{terminal-presentation,terminals-client,views,messages}.ts*`, test. POS: `electron/{pi-runtime,pin-ipc,terminal-pin-client,main}.ts`, `preload.cts`, `src/{pin-screen,intake-screen,App}.tsx`, `src/bootstrap/{states,bridge-types}.ts`, tests; **deleted** `electron/staff-ipc.ts`, `src/staff-sign-in.tsx`. Images: both overlays re-packaged (Hub bundle `b1d77c64…`, 48 + 53 agent files, 0043 + manifest). Docs: the decision, two registers, this handoff, the index.

## 8. Image and hardware impact

- **Both images must be rebuilt** before the hardware run: the Hub image carries the agent bundle and migrations (0043 is applied by the Hub's own migration runner on boot); the Terminal image carries the bridge route list, the PIN status read and the v2 reporter. Neither was built this session (the Terminal build takes ~22 min; the Hub the same) — left for the next session so that this one ends with a pushed, tested state rather than a half-verified image. Handoff 47's `cd1c77ca…` and handoff 48's `ef4594e7…` are unchanged and superseded for this milestone.
- The POS reaches the board as a `kitluy-terminal` release (payload rebuilt at publish time), not in the image.
- Local services on the workstation (`:8787`, `:8790`) still run the 10:14 builds without 0230/v2 handling in the Management API DTO; restart them (memory: exact-env relaunch) before the hardware run.

## 9. Remaining blockers and required values

| Item                                                         | State                                                                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Argon2id cost profile                                        | `[REQUIRED: owner-approved]`; provisional m=19456, t=2, p=1                                          |
| PIN session length / idle lock                               | `[REQUIRED: owner session policy]`; provisional 8 h, no idle lock                                    |
| PIN across fresh-SD recovery and hardware replacement        | `[REQUIRED: owner ruling]`; as built, keyed by the Hub's terminal device row                         |
| Partner-Portal PIN reset (§14) and "PIN configured" action   | needs cloud→Hub delivery (BLK-006); development `hub-agent reset-terminal-pin` until then            |
| Human-attributed layer for financial/custody/refund/override | later owner decision (§11 attribution stands; not in the PIN session's surface)                      |
| D1/S42 (the real seat holds T1–T4), consent policy reference | unchanged from handoff 48 §8 items 3–4                                                               |
| Rebuild both images, read them back, flash, hardware ladder  | next session; the sequence is handoff 48 §11 with "PIN setup → PIN unlock" replacing "staff sign-in" |

## 10. Git

| Commit    | What                                                                                                                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `5d4a522` | the Terminal PIN end to end (Hub, bridge, POS, report v2, cloud 0230, Management API, Partner ladder)                                           |
| `fbb8d5d` | decision record, registers, handoff 49, index, handoff 48 §13                                                                                   |
| `4a8bdc6` | both overlays re-packaged from the committed sources (line wrapping only; minified forms identical) — the overlay drift the image build exposed |
| this      | §11 image evidence                                                                                                                              |

Pushed to `provisioning` `dev` (no force); `main` untouched. `scripts/development/issue-dev-pairing-code.mjs` stays uncommitted.

## 11. Both PIN-enabled images — built from `4a8bdc668cbb28d62aabcb12fce5ac5e0bfe598c`, read back (2026-09-17, 14:14–15:00 +07:00)

**Why `4a8bdc6`, not `fbb8d5d`.** Re-running packaging from the committed source before building showed three compiled overlay files (`edge-session.js`, `runtime-report-bytes.js` in both trees) differing from the committed overlay — by line wrapping only (their minified forms are byte-identical): they had been packaged before the last formatting pass. An image build re-runs packaging, so the committed overlay must be the bytes it ships. The re-packaged overlay was committed as `4a8bdc6` and pushed, and both images were built from it. After each build `git status` showed no change under `infra/`: the in-build packaging reproduced the committed overlay exactly.

Both builds: rpi-image-gen `v2.7.0` (`a7b6d480`, checkout clean, mirror `deb.debian.org` at 16 MB/s, nothing `-dirty`), `--environment development`, registration `http://172.16.21.17:54371/functions/v1/device-registration`, enrollment `http://172.16.21.17:8787`, dev PKI root pin `b115609ad754dacf…`, `KITLUY_DEV_SSH_PUBKEY`, `KITLUY_DEV_SUDO=1`. Classification **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED**. The known development warnings only (QEMU cross-build, dev sudo, `o+x`, `/proc` bind-mount, 16 KiB block size on the x86 host); the `REFUSE` strings in the logs are hook source text (the trust anchor and root pin ARE present, below). Every SHA-256 was recomputed with `sha256sum` and equals the manifest; each manifest lists exactly its own five artifacts (the earlier h47/h48 artifacts were moved to `build/preserved-20260917-h47-image/` and `build/preserved-20260917-h48-image/` before building; their hashes `cd1c77ca…` / `ef4594e7…` re-verified after the move).

### 11a. Store Hub — `infra/edge/raspberry-pi/store-hub-image/` — 14:14:24 → 14:36:20, exit 0

| Artifact                                                                       | Bytes                                   | SHA-256                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------ |
| `build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` (**the card**)     | 660 332 939                             | `aac000e9077943aa030fb392f6a60b63bab6f6feaca8512e16bdd7dcade6cc76` |
| `build/work/image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img` (raw) | 17 490 268 160                          | `c81fabf2c2329d66f80447af53b70149e2d8702abdeb6b3769cee7f8fe467d8d` |
| `…-v2.7.0.tar.zst` · `.img.sparse.zst` · `.img.sparse`                         | 996 890 432 · 660 314 424 · 837 595 672 | `112ec81a…` · `79a7c960…` · `6086aeac…`                            |

Suites on this build's rootfs: build-gates 34/0 · environment-gating 19/0 · rpi-image-gen 22/0 (1 skip) · systemd-runtime 183/0 · image-contents 57/0 · storage-posture 33/0 · `scan-image-secrets` 17/0 PASS.

Read back from the FINAL raw image (`system_a` read in place at its GPT offset with the builder's `dump.erofs --offset`; `persistent` copied sparse and read with `debugfs`):

- **All 138 overlay entries committed at `4a8bdc6`** (124 files, 14 links) are **byte-identical** in the image; 0 differ.
- `/usr/lib/kitluy/hub-migrations/`: **44** files ending `0043_terminal_pin.sql`, whose bytes equal the commit (`86875d32…`) and carry the Argon2id verifier CHECK, the never-removed trigger and `credential_kind`; `hub-migration-manifest.json` lists 0043.
- `/usr/lib/kitluy/lib/hub-agent/main.mjs` in the image = committed = freshly bundled from source: **`b1d77c646f38c106…`**. It contains the five `/edge/v1/terminal-pin/*` routes, `argon2id`, `TERMINAL_PIN_FAILURE_LIMIT = 5`, `TERMINAL_PIN_LOCK_MINUTES = 15`, the PIN-session branch (`credential_kind === "terminal_pin"`, `terminalHoldsCurrentT1Grant`), `reset-terminal-pin`, the audit codes, and handoff 47's Defect G ordering (`order by terminal_assignment_generation desc, paired_at desc`) and `hub_replacement_state`.
- Handoff 47's fixes: `var-lib-kitluy-hub.mount` = `ad10e9db0e11786c…` with `DefaultDependencies=no`; `kitluy-boot-classification.service` present and wanted by `multi-user.target`; the boot-classification, runtime-report and edge-bridge modules in the closure.
- `/etc/kitluy/image.env`: `store_hub`, `development`, the two URLs, `KL-PI5-STORE-HUB-DEV`; `development-root.sha256` = `b115609ad754dacf…`.
- **Forbidden state: none.** Persistent partition: 4 750 files, all Debian package state; under `var/lib/kitluy/` only empty `identity`, `operational`, `enrollment`, `hub/{postgresql,outbox}`, `update`, `terminal`, `health` directories in both slots; no file anywhere mentions `kitluy` or `172.16.`; the only credential-like file is the development `pi` user's `authorized_keys` (public key, by `KITLUY_DEV_SSH_PUBKEY`). Root filesystem: no private key, no SSH host key, `/var/lib/kitluy` empty, no Store/Tenant identity in `/etc/kitluy`, no PIN. (The literal `-----BEGIN PRIVATE KEY-----probe` in migration 0038 is that migration's self-test proving the schema REFUSES key material.)
- The image's bundle under the image's own Node 18.20.4 arm64 (QEMU): loads; `reset-terminal-pin` refuses on a non-development Hub; Argon2id verifies (1.0 s under emulation).

**IMAGE VERIFIED: yes. NOT BOOT-TESTED.**

### 11b. Pi Terminal — `infra/edge/raspberry-pi/pi-terminal-image/` — 14:36:41 → 14:57:32, exit 0

Additional inputs: `--release-source http://172.16.21.17:8791`, `--hardware-profile-key KL-PI5-TERMINAL-DEV`.

| Artifact                                                                                         | Bytes                                       | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------ |
| `build/work/deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` (**the card**)              | 998 872 466                                 | `2e7daa35485389f2fda6dcc8a16cb28d9f1673fabf91ecaf92e8192bc547f255` |
| `build/work/image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img` (raw) | 8 900 333 568                               | `7c3ac42b45a93a19ae755255baa1b97f4d1ae3acfb15a9e804e086ba12e782b4` |
| `…-v2.7.0.tar.zst` · `.img.sparse.zst` · `.img.sparse`                                           | 1 501 298 924 · 999 641 944 · 1 144 606 288 | `3082f9df…` · `c2238945…` · `4024aea2…`                            |

Suites on this build's rootfs: build-gates 67/0 · environment-gating 20/0 · rpi-image-gen 23/0 (1 skip) · systemd-runtime 244/0 · image-contents 117/0 · `scan-image-secrets` 17/0 PASS.

Read back from the FINAL raw image:

- **All 111 overlay entries committed at `4a8bdc6`** (99 files, 12 links) are **byte-identical** in the image; 0 differ.
- PIN-capable runtime, read from the image's own files: `edge-bridge.js` forwards `pin.status/setup/unlock/change/lock` and **no** `sessions.open/refresh/close`; `edge-session.js` reads `/edge/v1/terminal-pin/status` and records `terminalPin`; `runtime-report-bytes.js` signs `kitluy.device-runtime-report.v2`; `runtime-report.js` carries `terminalUnlocked` and `terminalPinOf`; the update agent's `startInstalledTerminalClientOnce`, the `kitluy-terminal` release store, boot classification — all present.
- Governed POS delivery: `/usr/lib/kitluy/terminal-client` (STORE `/persistent/shared/kitluy/releases/kitluy-terminal`, `readlink -f current`, witness, `exit 3` with no release), `kitluy-terminal-client.service` (`User=kitluy-terminal`, `Conflicts=` shell/bootstrap/getty, `OnFailure=` Device Shell, `RequiresMountsFor=/persistent/shared`), wanted by no target; `/etc/kitluy/trust/release-signing.json` present; `release.env` = `http://172.16.21.17:8791`.
- **No POS baked:** `/usr/lib/kitluy/lib` holds only `device-shell` and `firstboot-agent`; Electron `38.8.6`; no `/persistent/shared` in the image.
- `image.env`: `terminal`, `development`, the two URLs, `KL-PI5-TERMINAL-DEV`; root pin `b115609ad754dacf…`.
- **Forbidden state: none.** Persistent partition: 4 204 files of Debian package state; under `var/lib/kitluy/` only empty `update`, `terminal`, `health`, `identity` directories in both slots — no release store, no POS payload, no device key, no operational certificate, no Terminal PIN, no Store configuration or data; `authorized_keys` as above. Root filesystem: no private key, no SSH host key, `/var/lib/kitluy` empty.
- The image's agent under the image's own Node 18.20.4 arm64 (QEMU): **53/53 modules load**; the image's edge bridge on a real socket (0660, gid 991 `kitluy-terminal`) forwards eligibility and a draft `PATCH` and refuses a non-allowlisted route.

**IMAGE VERIFIED: yes. NOT BOOT-TESTED.**

**HARDWARE VERIFIED = NO. END-TO-END VERIFIED = NO.** No board was touched; no card was written.
