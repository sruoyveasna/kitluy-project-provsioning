# REFLASH-HARDENING-001 — a re-paired Store Hub requests at its real generation, and a stale request blocks nothing

**Date:** 2026-09-15
**Status:** **IMPLEMENTED · TESTED · IMAGE VERIFIED · HARDWARE VERIFICATION PENDING.**
No board flashed. Hardware verification waits for the owner's GPT audit of the
pushed commit.

| Fact                                         | Value                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Starting commit                              | `577cfcb`                                                                               |
| Implementation commit (images built from it) | `0dd3e1c`                                                                               |
| Migration                                    | **0226** `20260915150000_0226_recovery_stale_assignment_and_hub_pairing_generation.sql` |
| Previous records                             | handoff 42 (the hardware run, defects B and C), handoff 41 (topology, D1)               |

Authority: owner task REFLASH-HARDENING-001 (2026-09-15);
`KLREC-2026-09-15-RECOVERY-RESERVES-BEFORE-GENERATION-CHECK-001` (C),
`KLREC-2026-09-15-HUB-REQUEST-ASSIGNMENT-GENERATION-001` (B);
`KLD-2026-09-14-REFLASH-CREDENTIAL-RECOVERY-001` (unchanged).

---

## 1. What the hardware run needed, and what this removes

On 2026-09-15 the re-flashed Store Hub recovered only after two workarounds
(handoff 42 §3 steps 8–9):

1. a runtime drop-in `KITLUY_ASSIGNMENT_GENERATION=3` — **defect B**;
2. `abandon_generation_key_v1` plus moving the operational key aside —
   **defect C**.

After this change neither should be needed. That is what §8 must prove on the
boards.

## 2. Defect C — root cause and fix

**Root cause.** In `services/kitluy-device-registry-service/src/reflash-credential-recovery.ts`,
recovery ran:

1. step 4 — `reserve_device_credential_recovery_v1`, a `rotate_key`
   reservation;
2. step 5 — `register_generation_key_v2`, the key;
3. step 6 — issuance, where group 0204 compares the request's assignment
   generation.

The door was never given the request's generation. A stale request therefore
wrote a `pop_pending` reservation and a key row before issuance refused it
`KLUY-CRED-STALE-ASSIGNMENT`. The corrected request was then refused
`KLUY-RECOVERY-ALREADY-RESERVED`, and the key's fingerprint was spent forever
(`device_generation_keys_fingerprint_key` is unique per environment).

**Fix.** `reserve_device_credential_recovery_v2(…, p_request_assignment_generation integer)`:

- reads `devices.assignment_generation`, the value 0204 compares;
- refuses a mismatch or a null generation as **`KLUY-RECOVERY-STALE-ASSIGNMENT`
  before anything else runs** — before v1's idempotent replay, before
  eligibility, before any write;
- then returns `reserve_device_credential_recovery_v1(…)` **unchanged**, so every
  0224 check still runs in its order;
- the registry service calls v2 with `request.assignmentGeneration`.

Design points:

- **Plain read, not `FOR UPDATE`.** The owner `kitluy_credential_issuer` holds
  SELECT only on `devices` (row security forced, read policy). v1 also takes the
  credential-head lock first, in the order the renewal and issuance doors share;
  an earlier device lock would invert it. A re-pair racing the check by
  milliseconds is still refused by issuance's own stale check.
- **Replay.** A legitimate lost-response replay still passes, because recovery
  never changes the assignment generation. A request made before a re-pair no
  longer matches, and is refused instead of replayed.
- **v1.** Owner, ACL and search path are exactly as group 0224 left them.
- **v2.** Security definer, owned by `kitluy_credential_issuer`, v1's search
  path, EXECUTE for `kitluy_issuance_service` only.

## 3. Defect B — root cause and fix

**Root cause.** The generation was lost at every layer:

| Layer           | Before                                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| cloud           | `redeem_hub_claim_v1` returns a bare uuid; `kitluy_hub_pairing_service` cannot read `device_assignments`; `/v1/hub-pairing` returned no generation |
| board, pairing  | `PairingAttempt` and `PairingState` had no generation field                                                                                        |
| board, identity | `paired-identity.ts` returned `assignmentGeneration: 1` for every Hub                                                                              |
| board, request  | the certificate request is persisted before sending and replayed forever, so even a correct generation later would not have replaced it            |

**Fix.**

| Layer           | After                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| cloud (0226)    | `hub_pairing_assignment_generation_v1(assignment_id)`: security definer, owned like `redeem_hub_claim_v1` (`postgres`), returns one integer for one **Store Hub** assignment in **`pending_trust`**, EXECUTE for `kitluy_hub_pairing_service` only                                                                                                                                                                                           |
| cloud (service) | `HubPairingComposition` reads it in the same transaction right after redemption; if unavailable, the transaction rolls back (`INTERNAL_ERROR`) rather than answering without it. `PairedHubMaterial` and the route body carry `assignmentGeneration`                                                                                                                                                                                         |
| board, pairing  | `createPairingTransport` parses a positive integer (anything else dropped, never guessed); `interpret` records it in `pairing-state.json` when PAIRED                                                                                                                                                                                                                                                                                        |
| board, identity | `paired-identity.ts` returns the stated generation with `assignmentGenerationSource: "stated"`. A legacy file falls back to 1 as `"assumed-legacy-default"`, and `operational-tls` logs `ASSUMED`. The `KITLUY_ASSIGNMENT_GENERATION` override still wins and is logged as an override                                                                                                                                                       |
| board, request  | `ensureOperationalCertificate`: when a saved request's generation differs from the paired generation and nothing is adopted, the request is rebuilt — **same key**, new request id, nonce and time — and persisted **before** the call, so the stale request is overwritten and never sent again. `onStaleRequestReplaced` reports it and `operational-tls` logs it. A lost response at the same generation is still a byte-identical replay |

## 4. Migration 0226

- Forward-only and additive. 0224 and 0225 are not edited.
- Borrows `kitluy_credential_issuer` through `execute` (a top-level GRANT
  crashes the local image), sets owners, revokes PUBLIC, anon, authenticated and
  service_role, grants the two services, and hands the membership back.
- **Apply-time assertions:**
  - v2 is a definer, owned by `kitluy_credential_issuer`, with v1's search path;
  - in v2's source, the stale refusal precedes the v1 call;
  - v1's owner, security and grant are unchanged;
  - the generation read is a definer owned like `redeem_hub_claim_v1`,
    executable by the pairing service and not by the issuance service;
  - no PUBLIC, anon or authenticated EXECUTE;
  - no DIRECT grant to any platform role;
  - no grantee other than the intended service and the owner.
- **The first apply attempt failed its own assertion.** It had used
  `has_function_privilege('service_role', …)`, but `service_role` is a _member_
  of the service roles on the local stacks and inherits their EXECUTE, as it
  does for 0224's functions. The transaction rolled back, nothing was created,
  and the assertion was changed to inspect the explicit ACL (`aclexplode`).
  - A ledger row had been inserted by a non-gated command after that failed
    apply. It was deleted, conditional on v2 not existing, before the corrected
    apply.
  - Every later apply wrote the ledger only after `rc=0`.

## 5. Tests and mutation evidence

Environment: `kitluy-repo17` (`:54392`) with 0226 applied; `KITLUY_DEV_PKI_DIR`
set.

| Suite                                                                                                                                                                                                     | Result                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `reflash-credential-recovery.adversarial`                                                                                                                                                                 | **18/18** (15 existing + 3 new)                                                                           |
| — new: stale generation → `KLUY-RECOVERY-STALE-ASSIGNMENT`; no reservation, key, head advance, artifact or evidence; fingerprint unspent; the **same key** then recovers generation 2                     | pass                                                                                                      |
| — new: the real firstboot client saves and sends a request at generation 1, re-pairs at N, then **rebuilds** with the same key and adopts generation 2 through the real route                             | pass                                                                                                      |
| — new: **Pi Terminal** re-flashed and re-seated through `TerminalPairingComposition`; trust advance blocked (0225); stale generation refused with nothing written; same key recovers generation 2; active | pass                                                                                                      |
| — existing: route recovery, lost-response replay, concurrency, NOT A BACKDOOR ×6, first-issuance retry, 0225 re-pair refusal                                                                              | pass                                                                                                      |
| `hub-pairing.integration` (asserts the returned generation equals the cloud's)                                                                                                                            | 9/9                                                                                                       |
| `hub-pairing-routes` (asserts `assignmentGeneration` in the body)                                                                                                                                         | 17/17                                                                                                     |
| `device-trust-advance`                                                                                                                                                                                    | 6/6                                                                                                       |
| All 25 activation-related registry files + pairing routes/integration/trust advance                                                                                                                       | failing files and tests **identical** to the post-0225 baseline (pre-existing, handoff 39 §7); 103 passed |
| Firstboot, whole suite                                                                                                                                                                                    | **779 passed**, 1 failed — pre-existing `hub-provisioning-e2e.db` (handoff 39 §7), file untouched         |
| Firstboot targeted: `hub-pairing-ui` 29, `paired-identity` 17, `operational-tls-client-stale-generation` 3, `operational-tls-client` 27 (pinned fixture untouched), recovery-identity 3                   | 79/79                                                                                                     |
| Typecheck (registry, firstboot), ESLint on changed files, `migrations:validate` (125), `secret:scan`                                                                                                      | pass                                                                                                      |

**`pnpm verify`** (after the images): Lint, Typecheck, Contract tests, Offline
harness, Build, OpenAPI, Migration validation, Hub migration validation, Secret
scan and Clock usage **PASS**. Format check, Unit tests and Docs link check
**FAIL, identical to the handoff 40 baseline**:

- Prettier `EACCES` on the rootless image build tree;
- the two `@kitluy/device-identity` concurrency guards;
- the 4 old links in the 2026-07-30 WS-11 handoff.

**Mutation proofs** — each regression broken on purpose, then restored
(files byte-identical by `cmp`; database restored by re-applying 0226):

| Mutation                                       | Caught                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| M1 — v2's generation check removed (database)  | **3 fail** (Hub stale, real-device rebuild, Terminal): `OPCERT_GOVERNED_ISSUANCE_REFUSED` and a `pop_pending` reservation — the hardware symptom |
| M2a — composition omits `assignmentGeneration` | 1 fails (`expected undefined to be 2`)                                                                                                           |
| M2b — route omits it                           | 1 fails                                                                                                                                          |
| M3 — `paired-identity.ts` hard-codes 1 again   | 2 fail                                                                                                                                           |
| M4 — stale-request rebuild disabled            | 2 fail (the board replays generation 1 and is refused)                                                                                           |
| M5 — transport drops the field                 | 2 fail                                                                                                                                           |

## 6. Local environment result

**`kitluy-repo17`.** Backup `2026-09-15__kitluy-repo17__before-0226.dump`; 0226
applied; ledger 120.

**`kitluy-fresh` (hardware stack).**

- Backup `2026-09-15__kitluy-fresh__before-0226.dump`.
- 0226 applied; ledger 124 → **125**.
- Data unchanged: 3 devices, 3 reservations, 6 keys, before and after.
- Live probe, rolled back: `reserve_device_credential_recovery_v2` for the real
  Store Hub at generation 1 →
  `KLUY-RECOVERY-STALE-ASSIGNMENT: request carries assignment generation 1, device is at 3; nothing was reserved`.
  Counts unchanged; Hub still `active` at generation 3.

**Fleet service `:8787`.** Rebuilt (`pnpm --filter "@kitluy-services/kitluy-device-registry-service..." build`)
and restarted — the service contract changed. Target `127.0.0.1:54372`; health
live/ready 200; `/v1/operational-certificate`, `/v1/hub-pairing` and
`/v1/terminal-pairing` answer 422 for an empty body. Log
`~/Development/HET_VEASNA_WORKSPACE/scratch/2026-09-15__fleet-service-kitluy-fresh-0226.log`.

## 7. Images

**Which images.** Chosen from the packaging lists, not assumed:

- the Pi Terminal packages `operational-tls-client`, `paired-identity`,
  `pairing-state` and `bin/operational-tls`;
- the Store Hub packages those four and `bin/hub-pairing-ui`.

After re-packaging, the committed overlay diffs were:

| Overlay  | Changed                                                                     |
| -------- | --------------------------------------------------------------------------- |
| Terminal | `bin/operational-tls.js`, `operational-tls-client.js`, `paired-identity.js` |
| Hub      | those three and `bin/hub-pairing-ui.js`                                     |

`pairing-state.js` is byte-identical (a type-only change); the Hub agent bundle
`main.mjs` is unchanged. **Both images were rebuilt.**

The overlay was re-packaged a second time, after Prettier reformatted
`operational-tls-client.ts`. The compiled layout changed, and both overlays were
confirmed equal to the fresh `dist` before commit `0dd3e1c`. Static gates after
packaging:

| Tree      | build-gates | systemd-runtime | environment-gating | rpi-image-gen   |
| --------- | ----------- | --------------- | ------------------ | --------------- |
| Terminal  | 62 / 0      | 224 / 0         | 20 / 0             | 23 / 0 (1 skip) |
| Store Hub | 34 / 0      | 170 / 0         | 19 / 0             | 22 / 0 (1 skip) |

**Build conditions.** Both images were built from
**`0dd3e1c2fd0907ee4b0a0fa51e7610672a2c3289`** with the existing
`build-rpi-image.sh` and approved profiles (flags as handoff 40 §7):

- rpi-image-gen `v2.7.0` (`a7b6d4806183195f3efadb533f58c8e46393d057`);
- **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED**;
- no refusal fired in either log;
- previous outputs preserved in `build/preserved-20260915-1530-handoff40-images/`
  in each tree.

The Hub build started with a clean tree. The Terminal build log reads `clean=1`:
the only untracked file was this handoff's draft. Every image source was
committed at `0dd3e1c`.

### 7a. Store Hub — `store-hub`, `0.2.0-dev`, exit 0, 15:38:11 → 16:00:27 (+07:00)

| Artifact (under `infra/kitluy-store-hub-image/build/work/`)          | Bytes       | SHA-256                                                            |
| -------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst` **(flash this)**    | 660037389   | `898964e1b57faa4997060e05a6260caaad7ae0b35ad3e20d75678425b811894d` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64.img.sparse.zst`              | 660018545   | `9c31f50382f83e1247fdd68a5f1d8c4ceb5d9dd3f2e0a55bab3fe801b5707bab` |
| `deploy-v2.7.0/kitluy-storehub-os-arm64-v2.7.0.tar.zst`              | 996072254   | `2e9d9a79ba373dce911e863598d80f92edb7ff892820d86e9d32a36cb32845a0` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img`        | 17490268160 | `fefd30a11dd96d7f356b1828b6e7d7f112fb74e4b7193ab506c213d6e8bdc2c5` |
| `image-kitluy-storehub-os-arm64/kitluy-storehub-os-arm64.img.sparse` | 837161328   | `f83458ea7c1bb8cb4c83bcfc84437a89fbfea0ccd44598cb170653eb60f70852` |

Baked:

- `KITLUY_DEVICE_CLASS=store_hub`, `KITLUY_ENVIRONMENT=development`;
- registration `http://172.16.21.17:54371/functions/v1/device-registration`;
- enrollment `http://172.16.21.17:8787`;
- `KL-PI5-STORE-HUB-DEV`;
- development recovery SSH key and sudo.

### 7b. Pi Terminal — `pi-terminal`, `0.2.0-dev`, exit 0, 16:00:27 → 16:22:13 (+07:00)

| Artifact (under `infra/kitluy-os-image/build/work/`)                                   | Bytes      | SHA-256                                                            |
| -------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------ |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst` **(flash this)**             | 998655432  | `e1e8ec30e916286962cfde5932ed12d4d117d3768d6e2b736838f9a8adafc0ae` |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.sparse.zst`                       | 999232390  | `41958d5f221ed4e087936839ea90858a7c211a323e36ef1bda4878294394056c` |
| `deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64-v2.7.0.tar.zst`                       | 1500982737 | `19753c603df64d895a839a404312876aa643e41cb399a22ffb17d032dcef80d9` |
| `image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img`        | 8900333568 | `ffbfe13dca02b28782bd4ea986778c4adf1ed955949e0bdf71524d53a77e7171` |
| `image-kitluy-pos-terminal-wayland-arm64/kitluy-pos-terminal-wayland-arm64.img.sparse` | 1144311320 | `a8caae925b46a7f9a363197c0a040c68578c148acab8e910a8d7c622e62db5b9` |

Baked:

- `KITLUY_DEVICE_CLASS=terminal`, development;
- the same registration and enrollment URLs;
- `KL-PI5-TERMINAL-DEV`;
- release trust anchor (`release_signing`, development) and
  `KITLUY_RELEASE_SOURCE=http://172.16.21.17:8791`;
- development sudo.

**Hashes.** For both images the first four hashes above were computed
independently with `sha256sum` and equal the manifests. The sparse image is the
manifest's value.

### 7c. Read back from the final images

Each image's `system_a` was extracted from the GPT offsets (sector 606208) and
confirmed byte-identical to that build's `system.erofs`. Files were read with
the builder's own erofs-utils 1.9, and every file committed at `0dd3e1c` under
`usr/lib/kitluy/` was hashed against its copy in the image:

| Image       | Whole-overlay comparison | Fixed files in the image                                                                                                                                                                                               | Markers read from the image                                                                 | `image-contents`                |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------- |
| Store Hub   | **100/100 MATCH**        | `bin/hub-pairing-ui.js` `b8297e81…`, `bin/operational-tls.js` `b39304d8…`, `operational-tls-client.js` `6e6e9591…`, `paired-identity.js` `ea86e88c…`, `pairing-state.js` `c252fdf1…`, `hub-agent/main.mjs` `da3e2088…` | rebuild (`onStaleRequestReplaced`) ✓, stated/assumed ✓, transport parse ✓, generation log ✓ | 52/0 (+ `storage-posture` 33/0) |
| Pi Terminal | **55/55 MATCH**          | `bin/operational-tls.js` `b39304d8…`, `operational-tls-client.js` `6e6e9591…`, `paired-identity.js` `ea86e88c…`, `pairing-state.js` `c252fdf1…`, `operational-recovery-identity-bytes.js`, `release-runtime.js`        | rebuild ✓, stated/assumed ✓, generation log ✓                                               | 107/0                           |

The shared firstboot files have identical hashes in both images.
`bin/hub-pairing-ui.js` is absent from the Terminal image, as packaged: its
`bin/` listing equals the overlay's.

**A caution for anyone repeating this:** `dump.erofs --cat` exits 0 for a
missing path (it prints `read inode failed`). A missing file therefore shows as
DIFFERS, never MATCH, so the MATCH counts are sound, but the script's "missing"
count cannot detect absence; use `--ls`.

## 8. Exact next hardware verification (NOT executed)

The goal is to prove on the boards that a re-flashed, re-paired Store Hub
recovers with **no generation override, no abandon, and no key moved aside**.

**Before.** Confirm:

- fleet `GET :8787/health/ready` 200;
- `POST :54371/functions/v1/device-registration {}` → 400;
- `kitluy-fresh` ledger newest `20260915150000`;
- the image SHA-256 in §7.

**Store Hub** (`KL-CFADA8C75001`, currently `active`, assignment generation 3,
certificate generation 2).

1. Flash the §7 Store Hub image to a card and boot. Expect registration
   approved, and a new enrollment superseding `a1a1d734`.
2. Storage, still a manual step (not in scope):
   `sudo /usr/lib/kitluy/hub-storage-provision --authorize-development-unbound`,
   then reboot.
3. Release the assignment:
   `revoke_device_assignment_v1('549a41c6-21e9-4838-8b48-34a3878ba290', 'SD_CARD_REFLASH', 'OP-VEASNA')`
   as `kitluy_fleet_governor`.
4. The owner issues a code in their own terminal:
   `KITLUY_DEV_FLEET_DSN=postgresql://postgres:postgres@127.0.0.1:54372/postgres pnpm dev:pairing:code --local --operator OP-VEASNA --store DEMO-LAUNDRY-001 --location DEMO-PP-01`
   — confirm `:54372`. Type the code on the Hub console.
5. **Check on the board**, pass criteria:
   - `sudo cat /var/lib/kitluy/pairing-state.json` contains `"assignmentGeneration": 4`;
   - `journalctl -u kitluy-operational-tls` shows
     `assignment generation 4 (stated by hub-pairing-state)` — **not** `ASSUMED`,
     not an override — then `ADOPTED: … generation 3`.
6. **Check in the cloud:**
   - device `active`, assignment generation 4;
   - certificate generation 3 active under the new enrollment;
   - exactly one new `completed` `rotate_key` reservation;
   - **no** `pop_pending` reservation and no `abandoned` key from this run;
   - fleet log: `post-issuance-trust-advance advanced`, and no
     `KLUY-CRED-STALE-ASSIGNMENT` or `KLUY-RECOVERY-ALREADY-RESERVED`.
7. **Must NOT be needed:** a `KITLUY_ASSIGNMENT_GENERATION` drop-in,
   `abandon_generation_key_v1`, or moving `/var/lib/kitluy/operational`. If any
   is needed, the run fails — record it.

**Terminal SERVING afterwards** still needs the known development projection
steps (handoff 42 §3 steps 15–19; defects D, E, F out of scope):

- start `kitluy-hub-agent`;
- retire the old Hub rows on the Hub database;
- `--hub-self` with the real generation;
- Terminal `--delivery`;
- close old grants and re-publish.

**Pi Terminal (optional).** Flash the §7 Terminal image. Release, re-seat
through the "Pi HEllo" seat (roles already T1 first) and pair. Expect
`assignment generation N (stated by terminal-assignment)` and first-attempt
recovery, as on 2026-09-15.

## 9. Remaining defects (from handoff 42; not in scope)

| #   | Defect                                                                                 | Status                                                                                 |
| --- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| B   | Hub requested at generation 1                                                          | **IMPLEMENTED · TESTED · IMAGE VERIFIED**, hardware pending (this record)              |
| C   | recovery reserved before the generation check                                          | **IMPLEMENTED · TESTED**, applied to both local stacks; hardware pending (this record) |
| D   | `hub-provision-terminal --hub-self` hard-codes generation 1 and retires nothing        | OPEN                                                                                   |
| E   | Hub pairing console never re-prompts after a cloud revocation                          | OPEN                                                                                   |
| E2  | shell command substitution in a SQL comment in `hub-provision-terminal`                | OPEN, cosmetic                                                                         |
| F   | `publishDevelopmentConfiguration` does not close prior grants                          | OPEN                                                                                   |
| D1  | seat role order decides the pairing profile; T1-only eligibility picks one grant       | OPEN, owner decision (handoff 41)                                                      |
| —   | `pnpm dev:pairing:code --local` targets `:54392`                                       | OPEN                                                                                   |
| —   | `kitluy-hub-agent` not started when the certificate appears after boot                 | OPEN                                                                                   |
| —   | `kitluy-hub-storage` needs a manual development authorization after every Hub re-flash | known, by design                                                                       |

## 10. Git

| Commit      | What                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| `0dd3e1c`   | migration 0226; registry service and firstboot agent fixes; tests; both overlays re-packaged |
| this commit | this handoff, the index, register entries, evidence register rows                            |

Both pushed to `provisioning` `dev`. `main` unchanged.
