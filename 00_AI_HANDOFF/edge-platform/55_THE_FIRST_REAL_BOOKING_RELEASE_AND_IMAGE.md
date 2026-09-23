# 55 — T1 real operations: the governed release, the Terminal image, and what still blocks the first real Booking (T1-REAL-OPERATIONS-001, slice 2 → hardware)

**Date** 2026-09-23 · **Area** edge-platform / laundry · **Source** `dev` (local) `5917b10a8b5a` for the image, `5d32b86e189e` for the release payload · **Owner task** "T1 REAL OPERATIONS — RELEASE + TERMINAL IMAGE + HARDWARE READINESS"

| Gate                | State                                                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTED         | YES (slice 2, handoff 53)                                                                                             |
| TESTED              | YES — re-run at this HEAD, see §1                                                                                     |
| INTEGRATED          | YES — real-parts Pi e2e passes at this HEAD                                                                           |
| **RELEASED**        | **YES** — `kitluy-terminal 0.1.0-booking-202609231531`, signed, promoted `internal`, assigned, and **served** (§2)    |
| **IMAGE VERIFIED**  | **YES** — overlay read-back 113/113, 0 mismatches; image-contents 117/0/0; secret scan PASS. **NOT boot-tested** (§4) |
| HARDWARE VERIFIED   | **NO — not attempted.** The Store Hub and the Pi Terminal are both offline (§6)                                       |
| END-TO-END VERIFIED | **NO — blocked.** See §6 `VERTICAL_UNAVAILABLE`                                                                       |

---

## 1. Inspection at the current HEAD, and the regressions

`dev` advanced past slice 2 while this work ran (three sessions active). Slice 2 coexists intact with everything after it — verified marker by marker, not assumed: the Hub's `drafts-quote` / `bookings-confirm` / `bookings-recent` routes, `confirm-from-draft.ts`, `t1-operations.ts`, `nextClientSequence` **and** the seat work's `primaryVertical` in the same eligibility payload, the edge bridge's three forwarded routes, the POS adapters, the vertical's `intake-quote.ts` / `catalog-section.ts`, and hub migrations `0044` + `0045`.

**Build 77/77 · typecheck 105/105.** Suites: vertical **89**, edge-contracts **45**, hub-agent **504 passed**, firstboot **920 passed**, POS app **190 passed** including the real-parts Pi e2e (`quote → PRICE_MISMATCH → confirm 10 000 ៛ + $10 → KLB-DEMO-PP-01-… → change 14 000 → receipt → rows and facts on the Hub`).

### Two failures, both environment — with the cause found, not waved away

1. **The shared local Hub fixture had no live assignment.** `PAIR_HUB_NOT_ACTIVE` / `HUB_ASSIGNMENT_MISSING` across the bootstrap suite and the Pi e2e. Cause: `terminal-sync.integration.test.ts`'s `afterAll` ends _its own_ Hub assignment, and `applyEnvelope` (correctly, by production design — "a Hub database serves exactly one board") ends **every other active assignment** when it projects itself. Net effect on the shared `kitluy_hub_local`: after that suite runs, **zero** live assignments and nothing restores the fixture. Restoring `status='active', ended_at=null` on the fixture row makes the bootstrap suite and the e2e pass. This is also the true cause of the "pre-existing" bootstrap failure carried since handoff 53.
2. **`Terminal PIN: failures are counted…` times out at 5 000 ms** while doing ~10 s of real Argon2id work (m=19456, t=2, five counted attempts) on this loaded workstation. It passed earlier the same day. A budget, not a defect.

Neither touches slice 2. **Recorded so the next session does not re-diagnose them.**

---

## 2. RELEASED — `kitluy-terminal 0.1.0-booking-202609231531`

Built and published from an **isolated clean worktree** (`git status --porcelain` empty) so the provenance carries no dirty flag.

|                       |                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- |
| product               | `kitluy-terminal`                                                                                  |
| version               | `0.1.0-booking-202609231531`                                                                       |
| release id            | `1cac5454-2477-4d91-a356-7b3e60ff89ac`                                                             |
| buildId               | **`git-5d32b86e189e`** (clean)                                                                     |
| artifact sha256       | `aaa3e3d71f571d54d117adcfeb8c63c563de1fc316ad68d59ec1e140a6fabef7`                                 |
| size                  | 327 365 bytes                                                                                      |
| signature             | **signed** — key `bfccb44e…` v1 (`release_signing`, development), `signed_at 2026-09-23 08:31:03Z` |
| state / channel / env | `internal` / `internal` / `development`                                                            |
| assignment            | `KL-C33197FAE9EA`, campaign `5368c4a0-…`, **assignment_sequence 28**, assignment signature present |
| served                | `GET /release/v1/artifact/1cac5454-…` → **HTTP 200, 327 365 bytes, sha256 identical**              |

**Why RELEASED is a truthful label here:** the bytes were fetched back from the running release service and hashed — not merely written to disk. The service serves from the MAIN tree's `build/releases/<id>/`, so the worktree's artifact was copied there (the documented worktree-publish step).

**What the artifact actually contains** (unpacked and grepped, not inferred): `/quote`, `intake:confirm-intake`, `bookings/recent`, `listRecentBookings`, `PRICE_MISMATCH`, `kl1.` command-key minting, `khrPerUsd`/`usdCentsToKhr`, `Confirm & Print`. The Hub-only pricing authorities (`quoteIntakeLines`, `settleCashTender`, `confirmBookingFromDraft`) are **absent from the terminal artifact** — the terminal asks the Hub for a price and never computes one. The architecture holds in the shipped bytes.

**Release payload vs image commit.** The payload was packed at `5d32b86e189e`; the image is built at `5917b10a8b5a`. The delta between them touches **only image-overlay files** (`git diff --name-only 5d32b86 5917b10` outside the overlay = 0 files), so the POS artifact is byte-identical at both commits. Recorded rather than papered over.

---

## 3. The Pi Terminal runtime repackaged — and a defect it caught

`package-bootstrap-runtime.sh` is the only thing that moves built runtime into the image overlays, and **two commits shipped source without re-running it**:

- **`c95bfe1` (runtime-report v3, "a stuck rung says WHERE the terminal was talking to and HOW it went")** left the committed overlay's `runtime-report.js` / `runtime-report-bytes.js` at `5d4a522`. **An image built from the committed overlay would have carried runtime-report v2** and none of the new stuck-rung evidence.
- The terminal-seat work left the Device Shell's `pairing.js` and `terminal-assignment.js` stale and **never packaged `seat-validation.js` at all**.

Fixed in `5917b10` (5 files). Re-running the packaging in the main tree and in the isolated worktree produced **byte-identical** results, so this is the image catching up with `dev`, not a behaviour change.

### The packaged bridge, verified against §3's requirement

The packaged `edge-bridge.js` is **byte-identical** to `services/kitluy-device-firstboot-agent/dist/edge-bridge.js` (unchanged by repackaging — it was already current). Its allowlist, read out of the **packaged** file:

`authority-time · eligibility · configuration · pin.status · pin.setup · pin.unlock · pin.change · pin.lock · customers.search · customers.read · customers.create · customers.consent · drafts.create · drafts.read · drafts.update · drafts.cancel · **drafts.quote · bookings.confirm · bookings.recent**`

and **no** `payments`, `refunds`, `voids` or `sessions/open` anywhere in it. Suite: `edge-bridge.test.ts` **57 passed** (3 forwarded + 6 refusals for the non-allowlisted Booking/payment verbs). Image static suites: build-gates **67**, environment-gating **20**, systemd-runtime **246**, rpi-image-gen **23** (1 skipped). Secret scan clean (2 493 tracked files).

---

## 4. The Pi Terminal image — IMAGE VERIFIED (not boot-tested)

Built in the **isolated clean worktree** `worktrees/kitluy-ecosystem/wt-t1-booking-release`, detached at **`5917b10a8b5a`**, `git status --porcelain` empty before and after the build.

|                          |                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| source commit            | **`5917b10a8b5a`**                                                                                                                                         |
| compressed (flashable)   | `infra/edge/raspberry-pi/pi-terminal-image/build/work/deploy-v2.7.0/kitluy-pos-terminal-wayland-arm64.img.zst`                                             |
| compressed size          | **998 822 854 bytes**                                                                                                                                      |
| compressed sha256        | **`0db42539a44ddf5e949ebb2c8e2b0533547fa94451fcf906f89f9766bd6ae712`**                                                                                     |
| raw `.img` size / sha256 | 8 900 333 568 · **`6f7063d8a461e738dc64521863dd60fb4dc7e9bcfee0ffc6531e219fc578730e`**                                                                     |
| sparse `.img.sparse.zst` | 999 449 449 · `902b8664b03d987a7ae99c91143a3513e7fcd3130236e7fe238c539f9abd36d7`                                                                           |
| IDP archive              | 1 501 180 487 · `fa6bc36912cc3be26412c9f9a04f9f624bfba5d25092b5496d68df7413a9f516`                                                                         |
| manifest                 | `build/work/kitluy-pi-terminal-dev-manifest.json` — builder `rpi-image-gen v2.7.0` / `a7b6d4806183195f3efadb533f58c8e46393d057`, `DEVELOPMENT-CROSS-BUILD` |
| classification           | **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED**                                                                                        |

**Both hashes were recomputed independently** with `sha256sum` and compared to the manifest — the manifest asserts them, this read-back proves them. They match exactly.

### Overlay read-back — the requirement "committed overlay == image overlay"

Every entry of both committed overlays (`kitluy-base.rootfs-overlay`, `kitluy-pi-terminal.rootfs-overlay`) was compared byte for byte (and link target for link target) against the rootfs the builder produced:

**113 entries (101 files + 12 links) · 113 identical · 0 mismatched · 0 missing.**

One more entry than handoff 52's 112, because `seat-validation.js` is now packaged (§3). **The image carries exactly the committed source.**

### Suites against the built rootfs

- `image-contents.test.sh` → **117 passed, 0 failed, 0 skipped**
- `scan-image-secrets.sh` → **17 passed, 0 failed — RESULT: PASS** (no private key material, no pre-seeded SSH host keys, `/etc/machine-id` empty for first-boot regeneration, Store/Location/profile/Hub bindings present)

> **A trap worth recording.** `image-contents.test.sh` first reported `1 failed`: _"device shell: its declared main is in the image — package.json names '', which is absent — Electron exits at startup"_ — alarming, and **false**. The suite reads the field with `node -e 'require(process.argv[1]).main'`; `require()` treats a **bare relative path** as a module specifier, so passing a relative rootfs threw `MODULE_NOT_FOUND`, which `2>/dev/null` swallowed, leaving the field empty. The declared main (`dist-electron/electron/main.js`, 11 773 bytes) is present in the image, and with an **absolute** rootfs path the suite reports 117/0/0. Pass this suite an absolute path.

### What the image will talk to on boot

```
KITLUY_ENVIRONMENT=development          KITLUY_HARDWARE_PROFILE_KEY=KL-PI5-TERMINAL-DEV
KITLUY_REGISTRATION_URL=http://172.16.21.17:54371/functions/v1/device-registration
KITLUY_ENROLLMENT_BASE_URL=http://172.16.21.17:8787
KITLUY_RELEASE_SOURCE=http://172.16.21.17:8791        KITLUY_RELEASE_CHANNEL=internal
```

All four services were confirmed listening on that address before the build. The dev SSH public key is baked (the build refuses to produce a board nobody can inspect); handoff 52 §5's unexplained key rejection on `KL-5CA5F71B726A` is a reason to keep that access, not to drop it.

---

## 5. Money — `OWNER INPUT REQUIRED: khr_per_usd`

The delivered contract, read from the cloud (`kitluy_config.configuration_versions`, `laundry.money.v1`, version 1, `PUBLISHED`, scope `store_location`):

```json
{
  "schema": "kitluy.config.money.v1",
  "currency_code": "KHR",
  "currency_exponent": 0,
  "money_rounding": "round_half_up_minor_unit",
  "location_code": "DEMO-PP-01",
  "weight_rule": { "unit": "kg", "increment": 1, "rounding": "up", "minimum": 1 }
}
```

There is **no `fx` block and no `khr_per_usd`**. No rate was invented — not 4 000, not 4 100, not any other value.

**KHR-only operation is supported and governed today:** `settleCashTender` accepts a riel-only tender, refuses a USD leg with `FX_RATE_UNAVAILABLE`, and the terminal does not render a USD lane when the delivered contract carries no rate (it renders "USD cash needs a Store rate; none is delivered"). So the first real Booking can be taken **in riel** with no further input.

To enable USD: `pnpm dev:catalog:load --khr-per-usd <owner rate>` republishes the money contract; the Hub picks it up on its next sync and the lane appears by itself.

---

## 6. Hardware readiness — and the one thing that blocks the first Booking

### Ready

- Development services **all up**: registry `:8787`, Management API `:8790`, release source `:8791`, hub-sync producer `:8792`.
- Registration/enrollment reachable on the workstation LAN address **`172.16.21.17`** (registration endpoint answers, registry `/health/ready` 200); baked into the image (§4).
- Hardware profile **`KL-PI5-TERMINAL-DEV`** is active on `kitluy-fresh` — the stack the boards register against.
- The release is assigned to **`KL-C33197FAE9EA`** (the only active terminal in the dev cloud, registered 2026-09-23) at sequence 28. If the physical board is a different one, `pnpm release:assign` retargets it without republishing.
- The Store Hub applies its own migrations at boot: `kitluy-hub-database.service` → `hub-database-provision` walks `/usr/lib/kitluy/hub-migrations/*.sql` and applies anything not in the journal by filename + sha256. `c42b7d5` (parallel session) baked **`0044` and `0045`** and the slice-2 `hub-agent/main.mjs` into the Hub overlay, so a Store Hub taking that image gets the Booking command and its schema without a single manual DB write.

### BLOCKER — `VERTICAL_UNAVAILABLE` (CONFLICT / OWNER DECISION REQUIRED)

**A Store Hub running the current `dev` agent will refuse every terminal, and the board will never reach SERVING.**

Hub migration `0044` added `edge_identity.hub_assignment.primary_vertical_code`, and the seat work made `deriveEligibility` **fail closed** when it is NULL (`VERTICAL_UNAVAILABLE`, "nothing can be signed for the terminal"). `0044`'s own header says the feeder is owed: _"The cloud→Hub assignment writer, when built, must populate it from `digital_stores.primary_vertical_code`."_

**That writer does not exist.** Verified end to end:

- the cloud projection door (group 0232) builds its `hub` object with `deviceId, assetTag, assignmentId, assignmentGeneration, tenantId, digitalStoreId, storeLocationId` — **no vertical**;
- the hub-sync contract and producer carry **no** vertical field at all;
- `terminal-sync/apply.ts` inserts `hub_assignment` **without** `primary_vertical_code`, and its `on conflict do update` does not set it either.

**Empirical proof, not inference:** of 33 `hub_assignment` rows in `kitluy_hub_local`, exactly **one** carries a vertical — the fixture row set by hand for this work. All 32 written by `applyEnvelope` are NULL.

**A trap for whoever builds the feeder — found, not guessed.** The cloud stores the vertical **uppercase**: `kitluy_core.digital_stores.primary_vertical_code = 'LAUNDRY'` for `KitLuy Demo Laundry` (the Store both `KL-9830994458E0` and `KL-C33197FAE9EA` are assigned to, at `DEMO-PP-01`). The Hub column constrains it **lowercase**: `CHECK (primary_vertical_code ~ '^[a-z][a-z0-9_]*$')`. Verified in the database: `'LAUNDRY'` matches **false**, `'laundry'` matches **true**. A feeder that copies the cloud value straight through fails on a constraint violation; it must lower-case, or the two vocabularies must be reconciled by decision.

Two ways forward, both the owner's call:

1. **Durable fix** (belongs to TERMINAL-APPLICATION-ASSIGNMENT-001): a cloud migration adding the Store's `primary_vertical_code` to the 0232 `hub` projection, the field carried through the hub-sync contract and producer, `apply.ts` writing it on insert **and** on conflict (lower-cased, per the trap above), plus tests. Touches a governed door owned by another workstream mid-flight — not done unilaterally here.
2. **Development stopgap to unblock today's hardware run**: one `UPDATE edge_identity.hub_assignment SET primary_vertical_code='laundry' WHERE ended_at IS NULL` on the Store Hub. It **survives** later hub-syncs, because `on conflict do update` does not touch that column. A Hub-database write over SSH needs the owner's explicit go, and this is a stopgap to be recorded — not a fix.

### Not done, deliberately

The Store Hub database was **not** wiped, device state was **not** purged, the same-Pi Cycle B reflash acceptance was **not** started, and no Store Hub image was built (§9 of the task).

---

## 7. Hardware acceptance — NOT RUN

Both devices are offline: the Store Hub `KL-9830994458E0` is registered and active in the cloud but answers on no LAN address probed, and the Pi Terminal is being brought up by the owner. **No step of the 17-point acceptance was executed, and none is claimed.**

The expected path once both are up and the §6 blocker is resolved: flash the §4 image → register/recover → pair → Terminal PIN → the governed release installs (assignment sequence 28) → T1 opens → catalog + money load from the Hub's signed configuration → real Booking in riel.

---

## 8. Architecture preserved

No email/password, no staff login, no staff-session dependency was added. The Pi path remains device identity + operational certificate/mTLS + terminal assignment/profile + Terminal PIN, with the **terminal device as the actor**. The boundary test (`pi-terminal-boundaries.test.ts`, 23 passed) still refuses `password|email|sessions/open|kitluyT1Staff` anywhere in Pi-path code, and the shipped release artifact contains none of them.
