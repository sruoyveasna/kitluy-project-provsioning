# 56 — The Digital Store's primary vertical reaches the Store Hub (PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001)

**Date** 2026-09-25 · **Area** edge-platform / cloud control plane · **Source** `dev` `fcd87963c932` · **Owner task** "PRIMARY-VERTICAL-CLOUD-TO-HUB-FEEDER-001"

| Gate                | State                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| IMPLEMENTED         | **YES** — the whole path, no manual SQL (§2)                                                                             |
| TESTED              | **YES** — hub-agent 523 passed / 1 pre-existing failure; 24 new tests — 18 in hub-agent, 6 in digital-store-context (§3) |
| INTEGRATED          | **YES** — proven on the live development stack: `null` → `laundry` written by the sync itself (§4)                       |
| IMAGE VERIFIED      | **YES** — `f3810ab6…`, overlay read-back 140/140, image-contents 62/0/0, secret scan PASS. **NOT boot-tested** (§5)      |
| TERMINAL IMAGE      | **`0db42539…` remains valid** — no Terminal-image-owned source changed (§6)                                              |
| HARDWARE VERIFIED   | **NO — not attempted.** No board was used                                                                                |
| END-TO-END VERIFIED | **NO** — awaiting the owner's hardware acceptance (§7)                                                                   |

---

## 1. What was broken, and why it mattered

Handoff 55 §6 recorded the blocker precisely: hub migration `0044` added
`edge_identity.hub_assignment.primary_vertical_code` and made
`deriveEligibility` **fail closed** (`VERTICAL_UNAVAILABLE`) when it is NULL —
but **nothing ever wrote it**. Two whole tracks were parked behind it:
SAME-PI reflash continuity and the T1 real Booking hardware acceptance.

The gap started at the very first step. The cloud projection door a Store Hub
reads about itself built its `hub` object from the device and the assignment
alone and **never looked at the Digital Store** — so the vertical was absent
from the door, absent from the hub-sync contract, absent from the envelope, and
never written by `apply.ts` on insert or on conflict.

Measured, not assumed: of 33 `hub_assignment` rows in `kitluy_hub_local`,
exactly one carried a vertical (set by hand for handoff 55's work); all 32
written by the sync were NULL. Re-verified at the start of this task: **33 rows,
1 with a vertical.**

**No manual `UPDATE` was used as the fix.** The owner asked for the durable
feeder and that is what is built.

---

## 2. IMPLEMENTED — the feeder, step by step

```
kitluy_core.digital_stores.primary_vertical_code        'LAUNDRY'   (cloud registry)
  └─ group 0237 door: read_hub_terminal_projections_v1  → hub.primaryVerticalCode
      └─ hub-sync producer                              → INSIDE the signed envelope
          └─ Store Hub verifies signature, THEN converts once
              └─ verticalKeyFromCloudCode('LAUNDRY')    → 'laundry'   (registry key)
                  └─ hub_assignment.primary_vertical_code = 'laundry'
                      └─ deriveEligibility → payload.primaryVertical
                          └─ signed terminal configuration: primaryVertical = 'laundry'
```

### 2.1 Cloud projection — `supabase/migrations/20260923190000_0237_…sql`

The door is grown **additively** with the same signature (the group 0233
pattern), so 0232's and 0233's behaviour is untouched. It reads the Digital
Store named by **the Hub's own active assignment** — never a terminal profile
prefix, an application id, an asset tag, a pairing code or anything the caller
sends.

Three new refusals, each refusing the **whole** projection (terminals, catalog
and money included) rather than answering without a vertical:

| Code                         | When                                               |
| ---------------------------- | -------------------------------------------------- |
| `STORE_UNKNOWN`              | the assignment names a Store row that is not there |
| `STORE_TENANT_MISMATCH`      | the Store's Tenant contradicts the assignment      |
| `STORE_VERTICAL_UNAVAILABLE` | the Store's vertical is blank                      |

`kitluy_core.digital_stores` **forces** RLS, so a grant alone reads zero rows;
the migration adds the `SELECT` grant **and** a read policy for the door owner,
and asserts both (the trap group 0233 had already paid for).

### 2.2 The one canonical mapping — `@kitluy/shared-types`

There was **no** existing cloud→registry mapper. What existed was three
independent ad-hoc `.toLowerCase()` calls at unrelated boundaries (§8). So one
explicit, centrally owned table was added beside the `VERTICAL_PHASES` registry
it must track:

```ts
VERTICAL_CLOUD_CODES = {
  laundry: "LAUNDRY",
  cafe_restaurant: "CAFE_RESTAURANT",
  ecommerce: "ECOMMERCE",
  convenience: "CONVENIENCE",
  pharmacy: "PHARMACY",
  department_store: "DEPARTMENT_STORE",
  grocery: "GROCERY",
  supermarket: "SUPERMARKET",
} as const satisfies Record<VerticalKey, string>;
```

**Why not `.toLowerCase()`.** A case transform accepts `LAUNDRY_V2`, `Laundry`
and any future cloud code whose registry key is _not_ simply its lower case, and
mints a vertical the registry never locked. The table answers `null` for
everything it does not name — including `laundry`, `Laundry`, `" LAUNDRY"` and
`BAKERY` — and every caller refuses on `null`. `VERTICAL_CLOUD_CODE_COVERS_REGISTRY`
fails the suite if a ninth vertical is added without a decision about its cloud
code, so the table cannot silently drift from the registry.

**Café is mapped, not implemented.** `CAFE_RESTAURANT → cafe_restaurant` is one
table row. No Café workflow, terminal behaviour or application exists.

### 2.3 The envelope carries the CLOUD value, verbatim

The door emits `LAUNDRY` unchanged and the producer passes it through without
transforming it. The conversion happens **once**, at the Hub, **after** the
signature is verified — the only place with the registry to validate the result
against. A lower-cased value arriving on the wire is refused, because the cloud
vocabulary is the cloud's.

`primaryVerticalCode` lives inside `envelope.hub`, which the existing signature
covers (`sha256` over the canonical envelope), so it is signed by construction.
**No unsigned side channel, no new signing step, no contract-drift risk** — the
request signing, response signing, nonce binding, Hub identity binding,
Store/Location scope binding and freshness validation are all unchanged.

The producer **refuses to sign** an answer that carries no vertical
(`KLUY-HUB-SYNC-VERTICAL-ABSENT`): a missing envelope is easier to diagnose than
a signed Hub that silently serves nobody.

### 2.4 The Hub applies it

`ApplyInput.primaryVertical` is a required `VerticalKey` taken from the
**verified envelope** — deliberately _not_ a field of `HubSelfFacts`, because
`HubSelfFacts` is what the board holds and the board must not be the authority
on which vertical its Store trades in.

Written on **INSERT and on CONFLICT**. Insert-only would have left every Hub
already in the field NULL for ever, since those rows exist and take the update
path — which is exactly the state all 32 measured rows were in. The update is
unconditional, so a legitimate authoritative change lands on the next sync, and
identical, so a repeated envelope is idempotent. Only the row the envelope names
is touched: an **ended** assignment keeps the vertical it was serving under.

### 2.5 Eligibility — shape is not membership

`deriveEligibility` already refused a blank vertical. It now also refuses one
outside the locked registry. `0044`'s CHECK constrains the column to
`^[a-z][a-z0-9_]*$`, which `bakery` and `laundry_v2` satisfy as happily as
`laundry`; the refusal belongs where the Hub still has a code to name rather
than in a delivery the terminal would fail to resolve. **Migration 0044 was not
weakened** — no constraint was relaxed anywhere to make a test pass.

---

## 3. TESTED

`services/kitluy-hub-agent` — **523 passed, 2 skipped, 1 failed**. The single
failure (`still fails closed: a stale identity alone is HUB_NOT_OPERATIONAL`)
**fails identically at `d1748da` without this change** — a measured baseline,
not a claim.

24 new tests (10 + 8 in hub-agent, 6 in `digital-store-context`). The contract half needs no database:

| #   | Proof                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | a Laundry Store projects its vertical into the signed envelope, inside `envelope`, not beside it                                                                                             |
| 2   | cloud `LAUNDRY` maps explicitly to `laundry`; every registry key round-trips through its cloud code                                                                                          |
| 3   | the table is not a case transform — `laundry`, `Laundry`, `LaUnDrY`, padded, `LAUNDRY_V2`, `BAKERY`, `""` all refuse                                                                         |
| 4   | an unknown vertical refuses `ENVELOPE_VERTICAL_UNKNOWN`; a pre-lowered one refuses too                                                                                                       |
| 5   | a missing vertical refuses `ENVELOPE_VERTICAL_MISSING` (re-signed, so it tests the absence and not a broken signature)                                                                       |
| 6   | the producer refuses to sign an answer with no vertical, and with a blank one                                                                                                                |
| 7   | a **tampered** vertical refuses `ENVELOPE_SIGNATURE_INVALID` — including a swap for a value that would have resolved                                                                         |
| 8   | a foreign Store and a foreign Tenant are refused `ENVELOPE_WRONG_SCOPE` before the vertical is read                                                                                          |
| 9   | the profile prefix is never the authority: `laundry.*` profiles under a `CAFE_RESTAURANT` Store resolve `cafe_restaurant`, and a Laundry Store with **no** profiles still resolves `laundry` |
| 10  | terminal deliveries, grants, catalog, money, seat label and certificate serial are unchanged, and the delivery shape gained no vertical field                                                |

Against the **real** local Hub database (`kitluy_hub_local`):

| #   | Proof                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| 11  | the first projection writes `primary_vertical_code`                                                                            |
| 12  | an existing **NULL** row becomes `laundry` on the next valid sync (the `on conflict` path — the state of all 32 measured rows) |
| 13  | the same envelope again leaves the same value (idempotent)                                                                     |
| 14  | a legitimate authoritative change is applied; `'LAUNDRY'` is rejected by 0044's CHECK itself                                   |
| 15  | an **ended** assignment the envelope does not name keeps its own vertical                                                      |
| 16  | eligibility no longer returns `VERTICAL_UNAVAILABLE`                                                                           |
| 17  | eligibility still refuses NULL, and refuses `bakery` (registry, not shape)                                                     |

The eligibility tests run in a transaction that is **always rolled back**,
because `selectOperationalHubIdentity` picks the oldest trusted+deployed Hub in
the database and the shared local database holds every Hub every suite ever
projected. Nothing they do is committed.

`packages/digital-store-context` — **27 passed** (6 new, for the mapping table;
shared-types is types-only with no runner, so its consumer tests it).

**Workspace:** build 77/77 · typecheck 105/105 · `turbo run test` 75/78 packages
· secret scan PASS (2495 tracked files) · lint and format at exact baseline
parity (§9).

### 3.1 A defect this work found and fixed — 40 failures that were never ours

The hub-agent suite failed **41** tests at `d1748da`, and the shared-fixture
cause was diagnosed in handoff 55 §1 but not repaired. `applyEnvelope` ends
every other active assignment when it projects itself (production design — a
Hub database serves exactly one board), and the shared development fixture is
one of them; `terminal-sync.integration`'s `afterAll` ended only _its own_ row,
so the database was left with **zero** live assignments and nothing put the
fixture back. Every command suite scheduled afterwards then refused
`EDGE_DEVICE_NOT_ASSIGNED` against a perfectly healthy Hub.

Adding the vertical tests made it worse before it made it better — a longer
suite displaced the fixture earlier and took 21 more suites down with it (63
failures). The suite now **restores the fixture row it displaced**. Result:
**41 → 1**. Verified by running the affected suites alone with the fixture
intact (50/50 pass) and by comparing failure-name sets against the baseline run,
not by counting.

---

## 4. INTEGRATED — proven on the live development stack

Migration 0237 applied to the canonical development cloud **`kitluy-fresh`**
(`127.0.0.1:54372`, the project the boards register against and the one the
`:8792` producer reads), assertions passing.

The real door, called as `kitluy_edge_sync_service` for the **real** Store Hub
`KL-9830994458E0` (`4cfc40b4-da47-4578-8219-42d54468f028`):

```
"digitalStoreId": "00000000-0000-4000-8000-000000000015",
"primaryVerticalCode": "LAUNDRY",
```

read from Digital Store `DEMO-LAUNDRY-001` "KitLuy Demo Laundry" → `LAUNDRY`.

Then the whole feeder, against the real material:

| Step                 | Result                                                                            |
| -------------------- | --------------------------------------------------------------------------------- |
| 1. cloud door        | `OK`, `primaryVerticalCode = "LAUNDRY"` from the real Digital Store               |
| 2. producer envelope | signed by the real key `3c4a5cea…`, 1 terminal, vertical **inside the signature** |
| 3. Hub verification  | signature ok, nonce ok, this Hub, this Store → resolved `"laundry"`               |
| 4. **BEFORE**        | `hub_assignment fb32036e-…` `primary_vertical_code = null`                        |
| 5. apply             | `["KL-C33197FAE9EA:unchanged"]`                                                   |
| 6. **AFTER**         | `primary_vertical_code = "laundry"`                                               |
| 7. second sync       | `primary_vertical_code = "laundry"` — idempotent                                  |
| 8. eligibility       | `PAIRING_REQUIRED` — **`VERTICAL_UNAVAILABLE` is gone**                           |

The `null` in step 4 was set to create the **before** state — the state every
Hub written by the old sync is in. **The value in step 6 was written by the
sync, not by hand**, which is the whole point.

Step 8 landing on `PAIRING_REQUIRED` is the correct next gate: the terminal
pairs on the board at boot. The vertical gate is passed.

> **One step was stood in for, and it is not about the vertical.** The Hub's
> signed _request_ needs its Ed25519 device identity private key, which exists
> only on the board (by design) and the board is offline. So the producer's own
> `readProjections` + `buildSignedEnvelope` were called directly — which is what
> the HTTP handler does _after_ verifying that request signature. Everything
> else was real: real cloud, real door, real Store, real envelope signature,
> real trust record, real Hub consumer, real Hub database, real
> `deriveEligibility`.

The `:8792` producer has been **restarted from the main tree at `fcd8796`**, so
it now serves the vertical. This matters: the previous process was running the
old code, and a Hub syncing against it would refuse `ENVELOPE_VERTICAL_MISSING`
— fail-closed and correct, but it would block the board.

---

## 5. The Store Hub image — IMAGE VERIFIED

The feeder lives in the bundled hub-agent, which is image-owned, so the Hub
overlay was repackaged (`fcd8796`) and a new image must supersede the Cycle-B
Hub image `7f887229c1e3dda8a46f6751257b6cc4ff152fad68300816761115fd2d6ac17c`.

**Do not flash the Cycle-B Hub image after this change.** Its agent never writes
`primary_vertical_code`, so that board would sync, look healthy and refuse every
terminal.

### 5.1 The overlay reaches the image — verified

Verified on the first build of this commit, and these facts do not depend on
which build finishes:

|                                                |                                                                                                                  |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Overlay read-back                              | **140 entries (126 files + 14 links) · 140 identical · 0 DIFFERS · 0 MISSING**                                   |
| Committed `main.mjs` vs a freshly built bundle | **byte-identical**, `9179f36e43f09a07…` — regenerated, never hand-edited                                         |
| Feeder present in the packaged bytes           | `primaryVerticalCode`, `verticalKeyFromCloudCode`, `ENVELOPE_VERTICAL_UNKNOWN`                                   |
| Image secret scan                              | **17 passed, 0 failed — PASS**                                                                                   |
| Static suites                                  | build-gates 34/0 · environment-gating 19/0 · systemd-runtime 183/0 · rpi-image-gen 22/0/1 · storage-posture 46/0 |

The overlay count is **unchanged at 140**, the same as Cycle B: this change
modified one existing overlay file and added none.

### 5.2 A regression caught by diffing the baked config, not by reading a log

The first build of this commit completed and every digest matched its manifest —
and it was **discarded anyway**. Diffing its `/etc/kitluy` against the Cycle-B
rootfs showed two settings the Cycle-B image had and it did not:

| Setting                                  | Cycle B                    | first build |
| ---------------------------------------- | -------------------------- | ----------- |
| `KITLUY_RELEASE_SOURCE`                  | `http://172.16.21.17:8791` | _empty_     |
| `KITLUY_HUB_STORAGE_DEVELOPMENT_UNBOUND` | `authorized`               | _empty_     |

The second is handoff 54's **GAP 1** fix. Without it a fresh Hub card needs a
hand-made storage marker at boot — exactly the manual step Cycle B exists to
remove. `image-contents` had flagged the first gap as its one SKIP (61/0/**1**,
against Cycle B's 62/0/0); the storage one no suite would have caught.

The cause was mine: the build takes its endpoints as flags with **no defaults**,
and the documented Cycle-B invocation was reconstructed from handoff 40 §7a,
which predates both flags. Recorded so the next session does not repeat it —
**the Store Hub build needs all six**: `--environment`, `--registration-url`,
`--enrollment-url`, `--hub-sync-url`, `--release-source`,
`--development-unbound-storage`, plus `--hardware-profile-key`.

No shortcut was taken. Hand-patching two text files inside a built rootfs would
have produced an artifact whose contents did not match its own build log, so the
image is rebuilt from the same commit with the correct flags.

### 5.3 Then the power went out

The rebuild was interrupted mid-flight when the workstation lost mains power. It
had reached image assembly and produced **no flashable artifact**; its chroot
carries `dpkg` locks from the moment of the cut, so it is not reusable and was
**not** reused.

Nothing was lost: both commits were already pushed, `git fsck` reports only
dangling objects (no corruption), the working tree is exactly `fcd8796` with no
dirty image input, and the overlay bundle still hashes to `9179f36e43f09a07…`.
The partial trees are parked, not deleted, under
`build/work/preserved-20260925-powercut-partial/` and
`build/work/preserved-20260925-incomplete-flags/` — safe to reclaim for disk
space at any time.

### 5.4 The image — IMAGE VERIFIED

Built from the isolated worktree `wt-vertical-feeder` on branch
`feat/primary-vertical-feeder`, with **no dirty image input** — the only
uncommitted file during the build was this handoff.

|                          |                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| source commit            | **`e491fd1ee62d`** (overlay content unchanged since `fcd8796`)                                                      |
| compressed (flash this)  | `infra/edge/raspberry-pi/store-hub-image/build/work/deploy-v2.7.0/kitluy-storehub-os-arm64.img.zst`                 |
| compressed size          | **660 431 102 bytes**                                                                                               |
| **compressed sha256**    | **`f3810ab69d3fdf2c004d75f7662290339afa17df4206e1ca8df9ae9858aa3715`**                                              |
| raw `.img` size / sha256 | 17 490 268 160 · **`3d32bdab3ff73006cc036355d1e945619719ab80d8949f9e8ee6d17c4cb7915e`**                             |
| `.img.sparse.zst`        | 660 288 508 · `68391ba40f90068d5faacd34b59098c1688e52ad1eb0e261f7c3a5fc68965931`                                    |
| `.img.sparse`            | 837 783 944 · `bdcb1d53ac77b60ba9c2209de40726f1bc8c339323529918ea7ed3ce63984b95`                                    |
| IDP archive              | 997 325 928 · `640704779e31dea49f1d67201b1c06064647527874eaf17f835dd9f9b01c6229`                                    |
| manifest                 | `build/work/kitluy-store-hub-dev-manifest.json` — `rpi-image-gen v2.7.0` / `a7b6d4806183…`, DEVELOPMENT-CROSS-BUILD |
| classification           | **DEVELOPMENT / UNSIGNED / NOT RELEASE-ELIGIBLE / NOT BOOT-TESTED**                                                 |

**All five digests AND sizes were recomputed independently** with `sha256sum`
and equal the manifest; the manifest lists exactly its own five artifacts. Zero
build refusals.

**Supersedes** the Cycle-B Hub image
`7f887229c1e3dda8a46f6751257b6cc4ff152fad68300816761115fd2d6ac17c`.

#### Read-back

| Check                                                                                | Result                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Overlay read-back                                                                    | **140 entries (126 files + 14 links) · 140 identical · 0 DIFFERS · 0 MISSING**                                       |
| `image-contents.test.sh` (absolute path)                                             | **62 passed, 0 failed, 0 skipped** — Cycle B's exact score; the earlier SKIP is gone now the release source is baked |
| `scan-image-secrets.sh`                                                              | **17 passed, 0 failed — RESULT: PASS**                                                                               |
| build-gates / environment-gating / systemd-runtime / rpi-image-gen / storage-posture | 34/0 · 19/0 · 183/0 · 22/0/1 · 46/0                                                                                  |

#### The feeder, read out of the IMAGE's own agent bundle

Not inferred from a build log — grepped from
`usr/lib/kitluy/lib/hub-agent/main.mjs` inside the built rootfs:
`primaryVerticalCode`, `verticalKeyFromCloudCode`, `VERTICAL_CLOUD_CODES`,
`ENVELOPE_VERTICAL_UNKNOWN` and `ENVELOPE_VERTICAL_MISSING` are all present, and
hub migration `0044` is in `usr/lib/kitluy/hub-migrations/` — so a Store Hub
taking this image gets the column and the writer for it together.

#### The baked configuration is byte-identical to Cycle B

Every file under `/etc/kitluy` was diffed against the Cycle-B rootfs:
`image.env`, `hub.env`, `release.env`, `development-root.sha256`,
`hub-sync-trust.json` and `trust/release-signing.json` are **identical**,
including the two settings §5.2's build had dropped —
`KITLUY_RELEASE_SOURCE=http://172.16.21.17:8791` and
`KITLUY_HUB_STORAGE_DEVELOPMENT_UNBOUND=authorized`.

So this image differs from Cycle B in exactly one intended way: **its agent
writes the Store's primary vertical.**

**NOT boot-tested.** No board has run it.

## 5.5 Bringing the development stack back after a power cut — the exact recipe

> **Superseded 2026-09-25 by [handoff 57](57_DEV_STACK_DURABILITY.md).** The
> edge runtime now mounts the repository's `supabase/functions` and restarts by
> itself; the whole stack comes back with `pnpm dev:stack:up`. The `/tmp`
> repopulation below is kept as history and is no longer the procedure.

The mains cut took down every host service and one container. Docker's own
containers came back by restart policy; nothing else did. Recorded as a recipe
because the next outage will look identical.

### What dies, and what brings it back

| Piece                                | After a power cut          | Command                                                                                                            |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `kitluy-hub-local` (Hub DB)          | container `Exited`         | `docker start kitluy-hub-local`                                                                                    |
| `supabase_edge_runtime_kitluy-fresh` | `Exited (255)` → see below | `docker start …` **plus the fix below**                                                                            |
| `:8787` fleet/registry               | gone (plain `node`)        | `KITLUY_DEV_FLEET_DSN=…:54372 KITLUY_DEV_PKI_DIR=<dev-pki> node scripts/development/fleet-service.mjs --port 8787` |
| `:8791` release source               | gone                       | same env, `scripts/development/release-service.mjs --port 8791`                                                    |
| `:8792` hub-sync producer            | gone                       | same env, `scripts/development/hub-sync-service.mjs --port 8792`                                                   |
| `:8790` management API               | gone                       | see §5.5.2                                                                                                         |

Start them with `setsid nohup … < /dev/null &` so they outlive the shell that
launched them. Health: `:8787` 200, `:8790` 200, `:8791` 404 (it serves
`/release/v1/…`), `:8792` 403 (an unsigned request is refused), `:54371` 400
(`KLUY-REG-MALFORMED` — the function's own validation). **Those 404/403/400 are
healthy answers, not faults.**

### 5.5.1 The trap: the edge function lives in an ephemeral `/tmp` path

`:54371` came back answering **500**, then `BOOT_ERROR` / "failed to determine
entrypoint". The cause is structural, not transient:

`supabase_edge_runtime_kitluy-fresh` bind-mounts its function source from
**a previous Claude session's scratchpad** —
`/tmp/claude-1000/…/87481d20-…/scratchpad/fresh-stack/supabase/functions` — and
its `WORKDIR` and `SUPABASE_INTERNAL_FUNCTIONS_CONFIG` both point at that same
dead path. The reboot cleared `/tmp`, Docker recreated the mount source **empty
and root-owned**, and the runtime had nothing to boot. The stack's own project
directory (`fresh-stack`) is gone too, so `supabase stop/start` cannot be run
for it at all.

**The fix needs no `sudo`**, though it looks like it does: the mount is
read-only (so `docker cp` is refused) and the path is root-owned (so a plain
`cp` is refused) — but the Docker daemon already runs as root, so a throwaway
container can write there:

```bash
docker run --rm \
  -v /tmp/claude-1000/…/87481d20-…/scratchpad/fresh-stack/supabase/functions:/target \
  -v <repo>/supabase/functions:/src:ro \
  alpine:3 sh -c 'cp -a /src/device-registration /src/_shared /target/'
docker restart supabase_edge_runtime_kitluy-fresh
```

The repository is the canonical source (`supabase/functions/device-registration`,
committed at `00b3dd2`), so this restores the real function, not a copy of a
copy.

> **This recurs on every reboot.** `/tmp` is cleared, the mount empties, and
> `:54371` — the registration endpoint baked into BOTH device images — stops
> booting. The durable fix is to relocate the stack's function source out of
> `/tmp` (it means recreating the container with a mount under the workspace),
> which is an owner decision and was **not** taken here.

### 5.5.2 The management API's two non-obvious requirements

`:8790` refuses to start without `MANAGEMENT_API_AUTH_PUBLISHABLE_KEY`, and
then refuses again with _"must be an https base URL with no path"_. Both have
answers in the code rather than in a credential store:

- the key is the **local stack's** publishable key, not the hosted project's —
  read it from the running stack, `grep -oE "sb_publishable_[A-Za-z0-9_-]+"
/home/kong/kong.yml` inside `supabase_kong_kitluy-fresh`;
- the loopback exemption (`composition.ts`, `isLoopbackDevelopmentAuthUrl`)
  needs **`KITLUY_ENV=local`**, not `development`, and the URL must be the bare
  origin `http://127.0.0.1:54371` with **no `/auth/v1` path**.

Started correctly it logs `environment: local, authHost 127.0.0.1:54371`, which
matches handoff 48's record.

## 6. TERMINAL IMAGE — `0db42539…` remains valid

**Existing Pi Terminal image remains valid.** No Terminal-image-owned source
changed. The diff touches the cloud migration, the producer script, the
hub-agent (Store Hub) source, `@kitluy/shared-types`, tests, and the **Store
Hub** overlay only. The Pi Terminal overlay is untouched, and the terminal
already consumed `primaryVertical` from its signed configuration — the value was
simply never populated upstream.

Terminal hardware candidate, unchanged:
`0db42539a44ddf5e949ebb2c8e2b0533547fa94451fcf906f89f9766bd6ae712`

---

## 7. Hardware acceptance — NOT RUN

No board was powered, flashed or paired. **HARDWARE VERIFIED: NO. END-TO-END
VERIFIED: NO.** Nothing in this handoff is a hardware claim.

The feeder is proven in software and on the live development cloud (§4). What
hardware still has to show is the part only a board can: the Hub boots, unlocks
its volume, pairs on one code, syncs, writes the vertical **by itself**, and
brings a terminal to SERVING for a real KHR Booking.

## 8. Recorded, not fixed — out of scope

1. **Three pre-existing ad-hoc `.toLowerCase()` vertical conversions** remain at
   `services/kitluy-management-api/src/terminal-provisioning.ts:446`,
   `services/kitluy-device-registry-service/src/terminal-pairing-composition.ts:316`
   and `apps/kitluy-partner-pwa-portal/src/terminal-roles.ts:49`. They are not on
   the feeder path this task implements and were left alone rather than changed
   silently. Each should become `verticalKeyFromCloudCode`.
2. **`kitluy_credential_issuer` is granted to `postgres` on `kitluy-repo17`** — a
   leftover role borrow from another session. `device-identity` and
   `device-registry-service` concurrency suites refuse to start because of it
   (identically at `d1748da`). Their own guard says _do not revoke the
   membership by hand_, so it was not touched.
3. **`t1-bootstrap-routes` "still fails closed"** fails at `d1748da` too.
4. **`device-registration-continuity.db.test.ts` "refuses to reclaim a device
   from a MAC address alone"** flips non-deterministically in **both** trees
   (baseline failed, this tree passed on a later run) — a stateful cloud-DB
   flake, recorded so it is not re-diagnosed.
5. **`khr_per_usd` still unset** — untouched, as instructed. KHR-only T1 Booking
   is sufficient.

---

## 9. Verification parity with the baseline

Every gate was measured at `d1748da` **and** at `fcd8796`, because "pre-existing"
is a claim that has to be paid for:

| Gate                  | `d1748da`                                         | `fcd8796`                                                          |
| --------------------- | ------------------------------------------------- | ------------------------------------------------------------------ |
| build                 | 77/77                                             | 77/77                                                              |
| typecheck             | 105/105                                           | 105/105                                                            |
| hub-agent tests       | 423 passed / **41 failed**                        | 523 passed / **1 failed**                                          |
| lint                  | 3 errors, 8 warnings                              | 3 errors, 8 warnings (identical, all in `terminal-seat-contracts`) |
| `migrations:validate` | fails on **0232** only                            | fails on **0232** only — 0237 is clean                             |
| `docs:check`          | 4 broken links (a July handoff)                   | same 4                                                             |
| `format:check`        | crashes on a rootless build tree before finishing | 137 pre-existing unformatted files, **none of them ours**          |
| secret scan           | PASS                                              | PASS (2495 files)                                                  |

`pnpm verify` therefore does **not** pass end to end, and did not before this
change either. The failing steps are the four rows above; none is introduced
here.
