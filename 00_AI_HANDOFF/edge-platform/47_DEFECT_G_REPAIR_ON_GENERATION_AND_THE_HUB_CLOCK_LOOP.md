# DEVICE-RECOVERY-E2E-CONTINUATION-001 — Defect G: a re-assigned Terminal is asked to pair again; the Store Hub clock loop is a systemd ordering cycle

**Date:** 2026-09-16
**Status:**

| Item                            | IMPLEMENTED | TESTED | INTEGRATED | PORTAL VERIFIED | IMAGE VERIFIED  | HARDWARE VERIFIED | END-TO-END VERIFIED |
| ------------------------------- | ----------- | ------ | ---------- | --------------- | --------------- | ----------------- | ------------------- |
| Defect G (Hub eligibility)      | yes         | yes    | no         | n/a             | yes (Store Hub) | **no**            | **no**              |
| Hub clock loop (ordering cycle) | yes         | yes    | n/a        | n/a             | yes (Store Hub) | **no**            | **no**              |

`INTEGRATED` is **no** for G: nothing was deployed to a running Hub. The fixes reach the
board only in the new Store Hub image (§3), which has not been flashed.

| Fact                  | Value                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Starting commit       | `86a44b065d642ca909c06b3fdce730a28cea8671`                                                                    |
| Documentation commit  | `5b79eba` — handoff 46 (control plan) and index                                                               |
| Implementation commit | `fe97e56854f46bb2f4e11745accdbeea8026289a`                                                                    |
| Ending commit         | this handoff's commit (see §9)                                                                                |
| Control plan          | handoff 46                                                                                                    |
| Register              | `KLREC-2026-09-16-HUB-RECEIPT-GENERATION-DIRECTION-001`, `KLREC-2026-09-16-HUB-DATA-MOUNT-ORDERING-CYCLE-001` |

## 1. Defect G

**Root cause.** `services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts`,
`deriveEligibility`:

- **Old behaviour:** it took the newest receipt **by `paired_at`**. It answered
  `ASSIGNMENT_GENERATION_STALE` for **any** mismatch between the receipt's generation
  and `terminal_device.assignment_generation`.
- **The Terminal** (`edge-session.ts`) pairs only on `PAIRING_REQUIRED`. A Terminal
  recovered at generation 3, facing its generation-2 receipt, waited for ever. That is
  the live state recorded in handoff 46 §2.

**New behaviour.**

| Receipt vs Terminal generation | Answer                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------- |
| none                           | `PAIRING_REQUIRED` (unchanged)                                                           |
| receipt < terminal (N−1, N−2…) | a blocking containment directive → `CONTAINMENT_PROHIBITS`; otherwise `PAIRING_REQUIRED` |
| equal                          | unchanged: grant, T1, receipt-profile match, containment                                 |
| receipt > terminal             | `ASSIGNMENT_GENERATION_STALE`; nothing lowers what a receipt proved                      |

Two refinements, each forced by a test:

1. **The receipt consulted is the highest-generation one**
   (`order by terminal_assignment_generation desc, paired_at desc`). The pairing door
   (hub migrations 0031/0042) does not read receipts, so a handshake at a _lower_
   generation completes and appends a receipt. Under the old ordering that receipt
   restored eligibility at the lower generation. The regression test proved this
   before the fix: `200 ELIGIBLE` at generation 1 after a generation-2 receipt. This was
   a **pre-existing authority-downgrade gap**. It also removes the re-pair loop that a
   slow Hub clock would cause, where a current receipt sorts behind a superseded one.
2. **Containment is checked before inviting a re-pair**, because the pairing door does
   not read `effective_containment`. The no-receipt path was deliberately left as it
   was; see the register entry.

**Terminal:** no code change. The existing automatic pairing path is the one exercised.

**Files.**

- `services/kitluy-hub-agent/src/hub/edge/runtime-bootstrap.ts` (fix; containment read
  factored into three small helpers).
- `services/kitluy-hub-agent/test/t1-bootstrap-routes.integration.test.ts`. The existing
  "stale generation" case moved the terminal **forward** and expected `STALE`: it had
  encoded the defect. It now asserts the receipt-**ahead** case.
- `services/kitluy-device-firstboot-agent/test/terminal-edge.test.ts` (Terminal side).
- Store Hub overlay `usr/lib/kitluy/lib/hub-agent/main.mjs`, re-packaged. The bundle
  diff is exactly this change.

### Tests

Real Hub database (`kitluy-hub-local`, 43 migrations), real TLS 1.3 mTLS transport,
receipts from the **real four-step handshake** (none hand-crafted).

| Required (handoff 46 §4)                                   | Test                                                                                                                                                                                                                                                                       | Result |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1 receipt N−1 → `PAIRING_REQUIRED`                         | "a receipt one generation behind asks for pairing…" (eligibility **and** configuration)                                                                                                                                                                                    | pass   |
| 2 receipt N → normal                                       | "derives full eligibility…" (existing), and the re-paired terminal serving at N                                                                                                                                                                                            | pass   |
| 3 receipt N+1 → refuse, never downgrade                    | "a receipt AHEAD… not even by pairing again lower" (a lower handshake completes; eligibility still 409; back at N the N receipt serves)                                                                                                                                    | pass   |
| 4 receipt N−2 → `PAIRING_REQUIRED`                         | "two generations behind…" then re-pair serves at N                                                                                                                                                                                                                         | pass   |
| 5 historical receipt unchanged                             | the row's `md5(to_jsonb(r))` and `paired_at` are identical after the re-pair                                                                                                                                                                                               | pass   |
| 6 re-pair appends a new receipt                            | receipts `[1, 2]` and `[1, 3]`; eligibility's `pairedAt` is the new receipt's                                                                                                                                                                                              | pass   |
| 7 Terminal reacts to `PAIRING_REQUIRED`                    | firstboot "a recovered terminal told PAIRING_REQUIRED pairs once, by itself, and reaches SERVING" (real Ed25519 proof verified by the scripted Hub; exact call sequence; second cycle does not re-pair) + "ASSIGNMENT_GENERATION_STALE is not an instruction" (no pairing) | pass   |
| 8 scope/credential/containment/replacement take precedence | "scope, credential, containment and Hub replacement refusals still win over re-pairing" (all with a receipt behind)                                                                                                                                                        | pass   |
| 9 profile-mismatch semantics unchanged                     | "equal generations keep the profile check…" (passed before and after the fix)                                                                                                                                                                                              | pass   |
| 10 reading mutates nothing                                 | digest of receipts, sessions, terminal row, credentials, grants and staff sessions identical before and after eligibility + configuration reads (behind and ahead)                                                                                                         | pass   |

**Reproduced before the fix.** 4 of the new tests failed on the unfixed code:
`409 ASSIGNMENT_GENERATION_STALE` where `403 PAIRING_REQUIRED` was required; `200 ELIGIBLE`
after the lower handshake; `STALE` instead of `CONTAINMENT_PROHIBITS`.

**Mutation evidence.** Each mutation was run on the bootstrap routes file, and the source
was restored byte-identical (`cmp`) after each.

| Mutation                                           | Caught              |
| -------------------------------------------------- | ------------------- |
| M1 comparison direction swapped                    | 5 tests fail        |
| M2 receipt ordered by `paired_at` again            | 1 fails (downgrade) |
| M3 containment check before the invitation removed | 1 fails             |
| M4 equal generation also invites pairing           | 20 fail             |
| M5 receipt-ahead refusal removed                   | 2 fail              |

**Suites.**

| Suite                             | Before (at `5b79eba`)             | After (at `fe97e56`)                                                                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kitluy-hub-agent` (DB live)      | 447 passed, 2 skipped             | **452 passed, 2 skipped** (+5; the 2 skips are the destructive backup suite)                                                                                                                                                                                                                                        |
| `t1-bootstrap-routes.integration` | 22                                | **27/27**                                                                                                                                                                                                                                                                                                           |
| `kitluy-device-firstboot-agent`   | 804 passed, 2 failed (handoff 45) | **806 passed, 2 failed**. `hub-provisioning-e2e.db` is pre-existing (handoffs 39–45). `operational-tls-client` "8. a DUPLICATE response is idempotent" is **intermittent**: its two certificates differ only by one second in `notBefore`/`notAfter`; alone it passed 27/27 three times; no firstboot `src` changed |
| `terminal-edge`                   | 18                                | **20/20**                                                                                                                                                                                                                                                                                                           |

`pnpm typecheck` (hub agent), ESLint and Prettier on every touched file: clean.

### Pairing receipt governance

- **Old receipt preserved?** Yes. Tests assert it is byte-identical after the re-pair.
  On the real Hub, the generation-2 receipt is untouched.
- **New receipt appended?** Yes, by the real completion door, in tests. On hardware:
  **not yet**.
- **Governance intact?** Yes. `pairing_receipt_governance` and hub migrations
  0031/0042 are unchanged; no receipt was written or edited by hand anywhere.

## 2. Store Hub clock loop

**Reproduced?** Yes, three ways:

1. **Live Hub journal, this boot.** systemd names the whole cycle:
   `sysinit.target → systemd-timesyncd → systemd-tmpfiles-setup → local-fs.target →
var-lib-kitluy-hub.mount → kitluy-hub-storage.service → basic.target → sysinit.target`.
   It then deleted the start jobs of `systemd-timesyncd`, `systemd-tmpfiles-setup` and
   `local-fs.target`.
2. **Offline, `systemd-analyze verify` (host systemd 255)** on the handoff 43 Hub rootfs
   (the image the Hub runs): the cycle is found.
3. **Live Pi Terminal and its rootfs:** 0 cycles; `systemd-timesyncd` and
   `systemd-tmpfiles-setup` active.

**Cause.** `var-lib-kitluy-hub.mount` had default dependencies, so systemd ordered it
`Before=local-fs.target`. It is also `After=kitluy-hub-storage.service`, an ordinary
service ordered after `sysinit.target`, which waits for `local-fs.target`. This is an
image-configuration defect, Hub only.

It is **not** any of these:

- trusted-time logic;
- Hub database authority time;
- firstboot ordering;
- certificate validity gating;
- a development-environment issue.

**Effects, per task §5:**

| Area                                | Effect                                                                                                                                                                                                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal boot                         | **every** Hub boot. No NTP, so the clock stays at the fake-hwclock floor (about 23.5 h behind on 2026-09-16; RTC reads 1970). tmpfiles rules are not applied at boot.                                                                                                                    |
| Re-flash recovery                   | a new card starts at the image build time. A certificate stamped by the server's clock is more than the 5-minute `NOT_BEFORE_SKEW_MS` ahead of the board, so the Hub could refuse its own new certificate. The 2026-09-16 run avoided this only by starting `systemd-timesyncd` by hand. |
| Serving                             | the Hub serves once running; authority time comes from the Hub database's `now()`, which follows the wrong clock.                                                                                                                                                                        |
| Certificate issuance and validation | the validity checks use a device-side trusted time that the slow clock skews.                                                                                                                                                                                                            |

**Fix.** `var-lib-kitluy-hub.mount` now sets `DefaultDependencies=no` and restores
`Conflicts=` and `Before=umount.target`. Its `Requires=`/`After=` on the storage unit is
unchanged, `/var` still comes first (`RequiresMountsFor` from `Where=`), and the database
still follows the mount.

**Proof.** `systemd-analyze verify` over the same image units: original **6 cycle
lines**, with only this change **0**.

**Tests.**

- `store-hub-image/test/systemd-runtime.test.sh` (+4, now 183/0):
  - any overlay mount ordered after a service must set `DefaultDependencies=no` and still
    unmount at shutdown;
  - the storage → mount → database ordering must remain.
  - Mutation (line removed): **caught**, 182/1.
- `store-hub-image/test/image-contents.test.sh`: a new check asks
  `systemd-analyze verify` about the **built** rootfs, and SKIPs when the tool is absent.
  On the handoff 43 rootfs it **fails**, listing the real cycle.

**Reconciliation.** The 2026-09-10 index entry attributed `systemd-tmpfiles-setup` not
running on the Hub to a condition skip on the read-only root. The live evidence shows the
cycle deleted it, and the Terminal runs it on the same kind of root. Recorded in the
register; the historical entry is not rewritten.

**To confirm on hardware:** timesyncd synchronised with no manual start, 0 cycle lines,
tmpfiles-setup active.

## 3. Images

**Which images.** Chosen from packaging, not assumed:

- The Defect G fix lives in the Hub agent bundle.
- The clock fix is a Hub overlay unit.
- Re-packaging changed **only** `usr/lib/kitluy/lib/hub-agent/main.mjs` in the Store Hub
  overlay; the unit file was edited in source.
- Both firstboot closures and the whole Pi Terminal overlay stayed byte-identical.

| Image       | Rebuilt? | Why                                                                                                                                             |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Store Hub   | **yes**  | carries both fixes                                                                                                                              |
| Pi Terminal | **no**   | nothing it runs changed. It still lacks handoff 44's boot classification, which no Terminal image carries yet; that rebuild belongs to Phase C3 |

### 3a. Store Hub — the first build from `infra/edge/raspberry-pi/store-hub-image`

**Build.**

```bash
KITLUY_DEV_SSH_PUBKEY=$HOME/.ssh/id_ed25519.pub KITLUY_DEV_PKI_DIR=<workspace>/local-config/het-kitluy-project/dev-pki \
bash infra/edge/raspberry-pi/store-hub-image/scripts/build-rpi-image.sh --profile store-hub \
  --environment development \
  --registration-url http://172.16.21.17:54371/functions/v1/device-registration \
  --enrollment-url http://172.16.21.17:8787 --hardware-profile-key KL-PI5-STORE-HUB-DEV
```

- **Source:** commit **`fe97e56854f46bb2f4e11745accdbeea8026289a`**. The build re-runs
  packaging, and afterwards `git status` showed no change under `infra/`, so the overlay
  is the committed one.
- **Result:** exit 0, 17:10:53 → 17:33:26 (+07:00).
- **Builder:** rpi-image-gen `v2.7.0` (`a7b6d48…`). The new tree's own
  `build/upstream` was verified against the pin by `doctor.sh` and the build, and had no
  local changes. The Debian mirror template was not touched (deb.debian.org measured
  14.7 MB/s), so nothing is `-dirty`.
- **Baked:** `store_hub`, development, the registration and enrollment URLs above,
  `KL-PI5-STORE-HUB-DEV`, development root pin `b115609ad754dacf…`, recovery SSH key and
  development sudo.
- **No refusal fired.** The `REFUSED` strings in the log are hook source text.
- **Classification:** **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED.**

**Artifacts** (under `infra/edge/raspberry-pi/store-hub-image/build/work/`). Every
SHA-256 below was computed independently with `sha256sum` and equals
`kitluy-store-hub-dev-manifest.json`. The manifest lists only these five: no stale
artifact from the old tree reached it.

| Artifact                                                             | Bytes       | SHA-256                                                            |
| -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` **(flash this)**    | 660136836   | `cd1c77ca45f890e2906acd7b52c1d9f730f58f286854641eb07347e7c2c94e1a` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.sparse.zst`              | 660132899   | `c4bbac016746065c7300eb24dfbab5bc25cba34ebd201a19f578fd2de0cb3f1a` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst`              | 996494911   | `297c0e554c0d2b6f4662d329b922a57a022c00bf17485aa5fb56bb4e7162db1f` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img`        | 17490268160 | `e4ae6abdcda04ddcc2e753194ce557039633fc738a826d2732835a4bc34566a1` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img.sparse` | 837374376   | `fcfa448394d29782ff183d1e0489c6687b7ba033b5a649c1a05ea86a30ddacc0` |

### 3b. Read back from the final image

- **Extraction:** `system_a` was taken from the raw `.img` at its GPT offset (sector
  606208, 8388608 sectors). Its erofs content is **byte-identical** to the build's
  `system.erofs`.
- **Tooling:** files were read with the builder's own erofs-utils. Absence was tested
  with `--ls`, never with the exit code of `--cat`.

| Check                                                                                                                                   | Result                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| every file committed at `fe97e56` under the overlay's `usr/lib/kitluy/` and `etc/systemd/` (symlinks excluded) hashed against the image | **118 MATCH, 0 DIFFERS, 0 MISSING**                                                                                                                                                                |
| `usr/lib/kitluy/lib/hub-agent/main.mjs`                                                                                                 | `145fbb59d58cabb4…`; contains the generation-ordered receipt query and the `PAIRING_REQUIRED` branch                                                                                               |
| `etc/systemd/system/var-lib-kitluy-hub.mount`                                                                                           | `ad10e9db0e11786c…`; `DefaultDependencies=no`, `Conflicts=umount.target`, `Before=umount.target`, storage ordering intact                                                                          |
| `bin/boot-classification.js` (handoff 44)                                                                                               | present, `ac58349213745a33…`: the first image to carry boot classification                                                                                                                         |
| `test/image-contents.test.sh` (auto-discovery, **new** path's rootfs)                                                                   | **57 passed, 0 failed, 0 skipped**, including **"the boot transaction has no ordering cycle (systemd-analyze verify)"** and the four boot-classification checks that failed on every earlier image |
| `systemd-runtime` / `build-gates` / `environment-gating` / `storage-posture` (after packaging)                                          | 183/0, 34/0, 19/0, 33/0                                                                                                                                                                            |

**IMAGE VERIFIED** for the Store Hub image: built from the committed source at the new
path, artifacts hashed, and the final system slot read back against the commit. **Not
boot-tested:** no board has run it.

## 4. Hardware

**Nothing was flashed or changed on either board in this session.** Read-only SSH checks
only (handoff 46 §2 re-check, dependency readout, file hashes).

State at 17:00 (+07:00):

| Board                                | State                                                                                                                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store Hub 172.16.13.205 (h43 image)  | recovered, generation 4, certificate 3, serving; `systemd-timesyncd` active only because it was started by hand (earlier session); 18 cycle lines this boot; `systemd-tmpfiles-setup` never ran |
| Pi Terminal 172.16.29.73 (h43 image) | credential recovered (generation 3); `HUB_REFUSED` `409 ASSIGNMENT_GENERATION_STALE` every cycle; Hub still holds only its generation-2 receipt                                                 |

| Question                               | Answer                                                                                        |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| Automatic re-pair                      | **not yet observed on hardware**                                                              |
| SERVING                                | **no**                                                                                        |
| Manual operations used in this session | none (read-only checks only). The earlier session's manual steps are listed in handoff 46 §2. |

## 5. Hardware proof: the plan (NOT executed)

The fix reaches the Hub only through the new image, so proving G on hardware **is** C1,
followed by C2 (handoff 46 §6). The Terminal is **not** re-flashed for this. It keeps its
generation-3 credential, and the Hub database, which survives on the NVMe, still holds the
generation-2 receipt: exactly Defect G's starting condition.

One physical action at a time:

1. **(owner)** Write `kitluy-storehub-os-arm64.img.zst` (§3a, SHA-256 `cd1c77ca…c94e1a`) to a spare SD card. Do not touch the Hub yet.
2. **(owner)** Power the Hub off, swap in that card, power on.
3. **(agent, read-only)** Clock and boot checks:
   - `NTPSynchronized=yes` with no manual start;
   - `journalctl -b | grep -c "ordering cycle"` is 0;
   - `systemd-tmpfiles-setup` active.

   Then check the registration state, and the recovery state in the cloud.

4. Known development steps, each with owner approval, all recorded:
   - storage `--authorize-development-unbound`;
   - release the Hub assignment (no governed route yet, BOOT-RECOVERY-DEC-001);
   - owner issues a Hub pairing code in the Partner Portal, types it on the Hub.
   - **Pass:** the board records generation 5 as stated, certificate generation 4 adopted on the first attempt.
5. BLK-006 development stand-ins on the Hub database, as handoff 42 §3 steps 15–19
   (defects D, E2, F), then start `kitluy-hub-agent` (it does not start itself after
   adoption).
6. **(agent)** Watch the Terminal with **no action on it**:
   - pass is eligibility `403 PAIRING_REQUIRED`;
   - one automatic pairing;
   - a **new generation-3 receipt appended** beside the untouched generation-2 one;
   - `SERVING`.

Steps 4–5 remain engineer-only, so **END-TO-END VERIFIED cannot be claimed** from this run
even if every check passes.

## 6. Remaining (audited, not redesigned)

| Gap      | State after this session                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D        | open. `hub-provision-terminal --hub-self` still hard-codes generation 1 (needed a `/tmp` copy on 2026-09-16)                                            |
| E        | open. The Hub pairing console keeps local PAIRED state after a cloud revocation                                                                         |
| E2       | open, cosmetic                                                                                                                                          |
| F        | open. Development republish does not close previous grants                                                                                              |
| D1 / S42 | open, owner decision TOPOLOGY-001. The Hub grant query still picks one of several same-version grants with no tie-breaker; not touched                  |
| S43      | open. No governed role change                                                                                                                           |
| —        | `kitluy-hub-agent` is not started when the certificate appears after boot                                                                               |
| —        | BOOT-RECOVERY-DEC-001: no governed release route; releases are governor SQL with owner approval                                                         |
| G-follow | whether the pairing door should itself refuse a lower-generation handshake; whether the no-receipt path should check containment first (register entry) |

## 7. `pnpm verify` (at `fe97e56` content, before commit)

**Exit 1.** The failures are the same three as the handoffs 44 and 45 baseline:

- **Format check:** EACCES in `infra/kitluy-os-image/build/work/chroot-v2.7.0/filesystem/persistent/home/pi`.
- **Unit tests:** the two `@kitluy/device-identity` concurrency guards (`kitluy_credential_issuer is ALREADY granted`); turbo then stops.
- **Docs link check:** the 4 UUID links in the 2026-07-30 WS-11 handoff.

Everything else passed: Lint (0 errors, the same 8 warnings), Typecheck, Contract tests,
Offline harness, Build, OpenAPI, Migration and Hub migration validation, Secret scan and
Clock usage.

## 8. Next

1. The owner performs §5 step 1.
2. Continue §5. On success, record Defect G and the clock fix as HARDWARE VERIFIED.
3. Then Phase C3: rebuild the Pi Terminal image from `infra/edge/raspberry-pi/pi-terminal-image`
   (it carries handoff 44's boot classification, which no image has yet), flash a spare
   card, and run the full Terminal recovery.

## 9. Git

| Commit      | What                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| `5b79eba`   | handoff 46 (control plan) and index                                                                       |
| `fe97e56`   | Defect G fix and tests; Hub mount ordering fix and tests; Store Hub overlay re-packaged; register entries |
| this commit | this handoff, the index                                                                                   |

Pushed to `provisioning` `dev`; `main` unchanged. Not included:
`scripts/development/issue-dev-pairing-code.mjs` (pre-existing uncommitted change, not this task).
