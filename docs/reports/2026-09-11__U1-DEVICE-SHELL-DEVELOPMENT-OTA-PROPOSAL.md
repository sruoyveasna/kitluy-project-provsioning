# U1 — Device Shell development OTA · proposal for owner approval

| Field               | Value                                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date                | 2026-09-11 · Asia/Phnom_Penh                                                                                                                                                                                                 |
| Repository          | `het-kitluy-project` @ `bde3490` + uncommitted tree on `claude/fix-firstboot-esm-and-ssh-hostkeys`                                                                                                                           |
| Type                | **PROPOSAL — NOT IMPLEMENTATION.** No code, migration, image or documentation changed. Nothing committed. No owner decision made.                                                                                            |
| Status of this file | ASSESSMENT + PLAN. Advances no register status, creates no GAP ID, binds nothing.                                                                                                                                            |
| Companion           | [`2026-09-11__DEVICE-UPDATE-WORKFLOW-FEASIBILITY-ASSESSMENT.md`](2026-09-11__DEVICE-UPDATE-WORKFLOW-FEASIBILITY-ASSESSMENT.md) — the full architecture survey. This file answers your eleven questions and proposes U1 only. |

**Labels:** **REPOSITORY FACT** · **EXTERNAL RESEARCH** · **RECOMMENDATION**
**Status language:** `SOURCE IMPLEMENTED` · `TESTED-IN-DEV` · `IMAGE VERIFIED` · `HARDWARE VERIFIED` · `PILOT-PROVEN` · `PRODUCTION-PROVEN` · `LAYOUT ONLY` · `ABSENT`

---

## Headline

Re-reading the repository against your direction turned up **three facts that make U1 much smaller than my previous assessment implied.** They are worth stating before anything else, because they change the size of the ask:

1. **The Device Shell payload is 280 KB, and its launcher is a 26-line shell script with a single `APP=` variable.** `/usr/lib/kitluy/device-shell` is not a binary — it is a script that runs `cage -- electron --ozone-platform=wayland "$APP"` where `APP=/usr/lib/kitluy/lib/device-shell`. **Electron itself (289 MB, pinned, checksum-verified) stays in the image and U1 never touches it.** U1 ships ~100 KB compressed.

2. **The development PKI you need already exists and is already owner-authorized.** `pnpm pki:bootstrap-dev` (`scripts/pki/bootstrap-dev-pki.mjs`) creates a persistent development CA outside the repository — and it already mints an **Ed25519 canonical chain** alongside the X.509 TLS chain. Authority: owner Decision 3 (2026-08-24) plus BLK-005's development authorization. U1 adds one purpose-scoped key to a governed generator that already refuses to overwrite, refuses to write inside the repo, and stamps everything `NON-PRODUCTION`.

3. **The pattern for getting development trust material into an image already exists and is proven.** `IGconf_kitluy_development_root_sha256` → `/etc/kitluy/development-root.sha256`, with explicit _"absent is safe"_ semantics: a Hub with no pin **refuses** to adopt a certificate rather than adopting an unverified one. Both images carry the injection point. U1 follows this pattern exactly rather than inventing one.

Together: **U1 is roughly a launcher indirection, a release store, a payload fetch-verify-activate loop, one signing key, and a CLI.** It is not an update platform.

---

# 1. Your workflow, in my own words

You want the Raspberry Pi to stop being a thing you _reprogram_ and start being a thing you _deploy to_.

Concretely: when you change the Device Shell, the only step that should involve you is the change itself. Building, packaging, signing, publishing, delivering, verifying, installing and restarting should be one operation you trigger and then stop thinking about — and the board on your desk should be running the new code a minute later, still enrolled, still paired with its Hub, still activated, with no card touched and nobody walking to the bench.

But you were specific about four things that are **constraints, not conveniences**, and I read them as the real substance of the direction:

- **Speed must not cost reproducibility.** Every version running on a Pi must be traceable back to source, artifact hash, release id, install result and health result. A development release is still a _release_ — it is not a file copy that happens to work.
- **Development must not become a second architecture.** Whatever makes development fast has to be the same machinery that later carries Pilot and Stable, differing in authorization, signing and rollout policy — not in kind. You do not want to throw anything away in six months.
- **The factory lane stays.** Fast OTA must not quietly erode clean-slate testing. Two lanes, used deliberately: daily OTA, and image/factory acceptance when image-level behaviour actually changes.
- **Failure is part of the workflow, not an exception to it.** The running version must survive an unproven replacement. Interrupted downloads, bad signatures, wrong-purpose keys, checksum mismatches, full disks, power cuts, crashes and failed health checks all have to land somewhere defined, and a bad release must put the good one back by itself.

And one thing I want to reflect back because it shapes the design more than it might look: **you also want to stop needing SSH to understand what happened.** That is not a UI wish — it means the update runtime has to _report_, in a form something other than a human tail-ing a journal can read. I have treated that as part of U1's definition of done, not as a later nicety, because Test A and Test B in your §14 cannot honestly be judged without it.

**One place I will push back, gently.** You framed it as image versus update. That is exactly right for applications and services. It is _not_ quite right for the OS: a system update **is** a new image, delivered to a slot instead of to a card. Keeping that inside the "image" concept rather than the "update" concept is what keeps one build, one signature and one reproducibility story. So I would say: **two artifact kinds, three delivery routes** — flash a card, write a slot, install a release. It changes nothing about what you asked for; it keeps the vocabulary honest when we get to U5.

---

# 2. Does it fit the current architecture?

**Yes.** More cleanly than I expected, and with one genuine obstacle that needs your ruling (§11).

The reason it fits is that **KitLuy already built the expensive half.** The parts that are hard to get right and dangerous to get wrong — the signed manifest contract, the fail-closed verifier, the acceptance gate, the promotion authority, the install state machine, the health gate, the one-rollback rule — exist and are TESTED-IN-DEV. What does not exist is plumbing: download bytes, put them somewhere, flip a pointer, restart a unit, say what happened.

That is an unusual position and a lucky one. It means U1 is mostly _connecting_ things, and it means development speed can be bought without inventing a trust model.

**The obstacle** is that every KitLuy program on both images runs from `/usr/lib/kitluy/…` on a read-only EROFS root, and the POS unit already in the image claims a release package "installs `/usr/lib/kitluy/terminal-client`" — which cannot happen. My previous assessment treated that as a large decision. **Finding 1 above shrinks it dramatically for U1:** because the Shell's launcher already indirects through `APP=`, U1 needs a writable home for a 280 KB _app directory_ only. It does not need to make `/usr` writable, does not need overlayfs, does not need `systemd-sysext`, and does not need to relocate a single executable.

---

# 3. What already exists

All REPOSITORY FACT.

| Component                                                                                                                                                                                                                                                       | Where                                                                                                | State                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Signed release manifest v1** — Ed25519, canonical bytes, separator-injection guard, key id **and** version matched, `revoked` refused even with a good signature                                                                                              | `packages/device-identity/src/release-manifest.ts` (241 lines)                                       | **TESTED-IN-DEV**                                                 |
| **Device-side acceptance gate** — product, architecture, hardware profile, environment, channel, schema range, configuration prerequisite, artifact size                                                                                                        | same file, `findReleaseAcceptanceRefusal`                                                            | **TESTED-IN-DEV**                                                 |
| **Cloud release authority** — `kitluy_releases`, immutable after signing, `draft→signed→internal→pilot→stable` no skips, four-eyes on Pilot/Stable, revocation as a new fact, campaigns, per-device projection                                                  | migration `0180`                                                                                     | **TESTED-IN-DEV**                                                 |
| **`internal` promotion needs no approver and no PKI gate**                                                                                                                                                                                                      | `promote_release_v1`                                                                                 | **TESTED-IN-DEV**                                                 |
| **Hub install state machine + owner-locked health gate** — 5 min window / 20 s probes / 3 consecutive / **one** automatic rollback / `failed_rolled_back` blocks automatic retry; every state persisted before the visible step                                 | `services/kitluy-hub-agent/src/hub/release-agent.ts` (449 lines), hub `0038`/`0039`                  | **TESTED-IN-DEV**                                                 |
| **Verified artifact cache** — digest and size re-proven over _downloaded_ bytes, resumable durable offset, storage metadata never authoritative                                                                                                                 | `services/kitluy-hub-agent/src/hub/release-cache.ts`                                                 | **TESTED-IN-DEV**                                                 |
| **Development PKI bootstrap** — persistent CA outside the repo, X.509 chain **and Ed25519 canonical chain**, refuses overwrite, refuses in-repo paths, stamps `NON-PRODUCTION`                                                                                  | `scripts/pki/bootstrap-dev-pki.mjs`                                                                  | **SOURCE IMPLEMENTED**, owner-authorized (Decision 3, 2026-08-24) |
| **Trust-anchor pinning discipline** — public certificates only, refuses any file carrying a private key block, two-source digest agreement                                                                                                                      | `scripts/pki/trust-anchor-bootstrap.mjs`, `pin-dev-trust-anchors.mjs`, guard `assert-no-dev-pki.mjs` | **SOURCE IMPLEMENTED**                                            |
| **Image trust-material injection pattern** — `IGconf_kitluy_development_root_sha256` → `/etc/kitluy/…`, _absent is safe_                                                                                                                                        | both image trees                                                                                     | **IMAGE VERIFIED**                                                |
| **Device launcher indirection** — `APP=/usr/lib/kitluy/lib/device-shell`, Electron resolved separately                                                                                                                                                          | `…/usr/lib/kitluy/device-shell` (26 lines)                                                           | **HARDWARE VERIFIED** (this is what runs on your board)           |
| **Acceptance context values already on every device** — `KITLUY_IMAGE_VERSION`, `KITLUY_IMAGE_SCHEMA_VERSION`, `KITLUY_RELEASE_CHANNEL`, `KITLUY_DEVICE_CLASS`, `KITLUY_HARDWARE_PROFILE_KEY`, `KITLUY_ENVIRONMENT`                                             | `/etc/kitluy/image.env`                                                                              | **IMAGE VERIFIED**                                                |
| **Version reporting contract** — the Hub's terminal heartbeat route already accepts `releaseVersion`, `softwareVersion`, `configurationVersion`; hub `0036` stores them; cloud `device_health_reports` / `device_health_projections` already have those columns | `hub/edge/routes.ts`, hub `0036`, cloud `0177`                                                       | **TESTED-IN-DEV** (contract + schema)                             |
| **Persistent partition + slot-shared mechanism** — `/persistent`, and `slot-shared.d` declarations already used for `/etc/ssh` and `/etc/wpa_supplicant`                                                                                                        | upstream `image-rota`; KitLuy `slot-shared.d`                                                        | **HARDWARE VERIFIED**                                             |
| **Build evidence discipline** — build manifest records SHA-256 per artifact, builder commit, `signed:false`, `releaseEligible:false`, `promotable:false`                                                                                                        | `kitluy-pi-terminal-dev-manifest.json`                                                               | **IMAGE VERIFIED**                                                |
| **Development tooling conventions** — `scripts/development/*.mjs` behind `pnpm dev:*` scripts                                                                                                                                                                   | `package.json`                                                                                       | **SOURCE IMPLEMENTED**                                            |

---

# 4. What is missing

All REPOSITORY FACT. Stated as **ABSENT**, not "partial", where nothing exists.

| Missing piece                                                                                                                                                                                                                                    | Evidence                                            | Needed for                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ---------------------------- |
| **A device update runtime.** The `update-agent` is 91 lines and never checks, downloads, verifies or installs (§5)                                                                                                                               | `src/bin/update-bootstrap.ts`                       | **U1**                       |
| **Any production caller of the release machinery.** `beginInstallation`, `applyReleaseAssignment`, `sign_release_v1`, `promote_release_v1`, `assign_release_v1` are called **only from tests**. `hub-agent.ts` never imports the release modules | grep across the tree                                | U1/U3/U4                     |
| **A writable, slot-shared release store**                                                                                                                                                                                                        | nothing declares one; `/var` is per-slot            | **U1**                       |
| **Any trust material on a device.** `/etc/kitluy/trust/` is an **empty directory** on the terminal image; the Hub image has **no trust directory at all**. Nothing writes `/etc/kitluy/release.env`                                              | both overlays                                       | **U1**                       |
| **A release-signing key.** The dev PKI mints device-identity and TLS chains — **no `release_signing` key**                                                                                                                                       | `bootstrap-dev-pki.mjs` `FILES` map                 | **U1**                       |
| **A publish path.** No CLI, no service, no API route, no portal screen creates or signs a release                                                                                                                                                | Management API has six modules, none about releases | **U1**                       |
| **Artifact storage/transport.** `kitluy-file-service` is SCAFFOLDED (91 lines); `ArtifactFetcher` has only test fakes                                                                                                                            | service `src/`                                      | U1 (dev source), U4 (Hub)    |
| **Signing-purpose binding.** Six purposes are defined and required separate, but the manifest body carries no purpose and the verifier checks none — a key in the trust registry is trusted for releases whatever it was minted for              | `release-manifest.ts` vs `environments.ts`          | **U1** (your §12 lists this) |
| **Source provenance.** The build manifest records the _upstream builder's_ commit, not KitLuy's — no git SHA links an artifact to source                                                                                                         | build manifest                                      | **U1** (your §7)             |
| **Component version reporting from the device.** The terminal writes `edge-status.json` locally and sends **no** heartbeat; the Hub route that would accept one exists and is uncalled                                                           | `terminal-edge`, `edge-session.ts`                  | U1 (local), U3 (cloud)       |
| **Any update UI** in Admin, Partner or the Device Shell                                                                                                                                                                                          | all three trees                                     | U3+                          |
| **A LAN release route.** `edge-contracts` defines none                                                                                                                                                                                           | `registry.ts`, `routes.ts`                          | U4                           |
| **A real `SlotAdapter`.** Only `class FakeDevice` in a test; nothing writes a slot, sets tryboot, or commits `autoboot.txt`                                                                                                                      | `release-agent.integration.test.ts:68`              | U5                           |
| **Slot-shared device identity.** Identity key, operational cert, registration, pairing and assignment all live under per-slot `/var` — an A/B update today would present the board as new                                                        | `pre-image.sh`, `installation.js` header            | **U5 blocker**               |

---

# 5. Extend the update-agent, or replace it?

**RECOMMENDATION: extend it. Keep its name, its unit, its path, and above all its posture.**

**What it actually does (REPOSITORY FACT).** 91 lines. Every 300 seconds it logs one of three states: `no_trust_anchor`, `no_release_source`, or `up_to_date`. It does not query, download, verify or install — `up_to_date` is returned unconditionally once its two preconditions exist. Its own header is honest about the last part: _"it never reports an update as installed — installation is the release agent's job, not this one's."_

On your two boards right now it has been logging `no_trust_anchor` every five minutes since they were flashed, because `/etc/kitluy/trust/` is empty. It has never reached its second precondition.

**Why extend rather than replace:**

1. **Its refusal order is already correct, and it is the order most updaters get wrong.** It refuses to _look for_ a payload when it holds no trust material, rather than fetching first and failing to verify afterwards. That is the right instinct and it is the thing I would otherwise have to argue for from scratch.
2. **Its bootstrap-ordering rationale is sound and still applies.** An updater cannot be delivered by itself, which is exactly why it is baked. Replacing it with something delivered as a release would reintroduce the problem `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` exists to prevent.
3. **It already reads the right inputs** — `/etc/kitluy/image.env` for version, `/etc/kitluy/trust` for anchors, `/etc/kitluy/release.env` for the source — and those are precisely the U1 inputs.
4. **Its unit is already correct and hardened**: `CapabilityBoundingSet=`, `ProtectSystem=strict`, `NoNewPrivileges`, and `ReadWritePaths=/var/lib/kitluy/update` — a writable work directory already reserved and scoped. U1 adds one more `ReadWritePaths` entry for the release store.

**What "extend" concretely means:** keep `evaluateUpdate`'s three states as the _precondition_ stage, and add the stages after it — query, verify, download, re-prove, stage, preflight, activate, restart, health-gate, commit-or-roll-back, report. Nothing is deleted.

---

# 6. How application releases live alongside the read-only rootfs

This is the design question, and Finding 1 makes the answer small.

**The situation (REPOSITORY FACT).** `/usr/lib/kitluy/device-shell` is a launcher script:

```sh
ELECTRON=/usr/lib/kitluy/electron/electron
APP=/usr/lib/kitluy/lib/device-shell
...
exec /usr/bin/cage -- "$ELECTRON" --ozone-platform=wayland "$APP"
```

The Electron _runtime_ and the _app_ are already separate. The app is 280 KB. The launcher already resolves the app through one variable, and already fails with a readable reason when the app is absent.

**RECOMMENDATION — a versioned release store on a slot-shared persistent path, with the launcher resolving through it and falling back to the image.**

```text
/persistent/shared/kitluy/releases/          ← declared slot-shared, NOT per-slot /var
   device-shell/
      rel-<releaseId>/           unpacked payload + the verified manifest that admitted it
      rel-<releaseId>/
      current   → rel-<releaseId>            symlink; switched by rename(2), atomic
      previous  → rel-<releaseId>
      state.json                 installed / previous / last result / health / installed_at
```

and the launcher becomes, in effect:

```sh
APP=/usr/lib/kitluy/lib/device-shell                       # the image's own copy
[ -d /persistent/shared/kitluy/releases/device-shell/current ] \
  && APP=/persistent/shared/kitluy/releases/device-shell/current
```

**Why this shape, specifically:**

- **`/usr` is never written, never made writable, never overlaid.** No EROFS change, no dm-verity question, no `systemd-sysext`, no overlayfs module. Your §16 prohibitions are satisfied by construction rather than by policy.
- **The fallback is a free safety net, and it is the strongest argument for this shape.** If no release is installed, if the store is empty, if a release is removed, or if the persistent partition is unavailable — the board runs the Shell that came in its image. **A Pi cannot be bricked by a bad Device Shell release**, because the image's own copy is always there and is never touched. That property comes from the launcher's existing design; it is not something U1 has to build.
- **Rollback is a symlink rename.** Atomic on POSIX, instant, and survives power loss in a defined state.
- **It must be slot-shared, and this is not optional.** `/var` is bind-mounted per-slot from `/persistent/slots/system_{a,b}/var`. A release store under `/var` would silently vanish on the first A/B system update in U5. The `slot-shared.d` mechanism already exists and KitLuy already uses it correctly for `/etc/ssh` and `/etc/wpa_supplicant` — whose own comments give the identical reasoning.

> **Known hazard, inherited.** `kitluy-ssh-hostkeys.service` documents an upstream bug: the `slot-shared-generator` creates its `local-fs.target.wants` symlink **once, after both loops**, using the leftover variable — so with two paths declared, only the last was actually enabled. KitLuy worked around it with its own unit. Declaring a third path walks back into it, so U1 must generalise that workaround, not re-hit it. Flagged so it is designed for, not discovered on hardware.

**Not chosen, and why.** `systemd-sysext` **is** present in the built image (systemd 252.39) and is the technically elegant answer for shadowing `/usr`. I am not proposing it for U1 because the kernel setting that would make its signature enforcement meaningful — `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG` — **is not set** in the Raspberry Pi kernel, so trust would rest on KitLuy's own verifier either way; and `systemd-sysext refresh` disturbs everything running from `/usr`, not just the component being replaced. It buys no security you do not already have, at the cost of a global remount. The artifact contract below does not foreclose it later.

---

# 7. The smallest U1

**Outcome.** You change the Device Shell, run one command, and your existing Pi Terminal is running the new version within about a minute — verified, atomically switched, revertible, reported, and still enrolled, paired and serving.

**Scope discipline:** U1 ships the **mechanism generically** (keyed by product) but **proves it with the Device Shell only**. That is a deliberate reading of your §5: building a Device-Shell-shaped one-off and generalising it in U2 would be exactly the throwaway you forbade. U2 then becomes "a second product proves it is reusable", not a rewrite.

## 7.1 The seven pieces

| #     | Piece                                           | Detail                                                                                                                                                                                                                                                                                                                                                                                                           | Size     |
| ----- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **1** | **Release-signing key in the existing dev PKI** | Add `dev-release-signing.key.pem` / `.pub.pem` to `bootstrap-dev-pki.mjs`'s `FILES` map. Ed25519, same refusals (no overwrite, never inside the repo, `NON-PRODUCTION` stamped). **Within existing authority** — BLK-005 authorizes development signing; owner Decision 3 (2026-08-24) authorizes this generator.                                                                                                | small    |
| **2** | **Trust material on the device**                | `IGconf_kitluy_release_trust_pubkey` → `/etc/kitluy/trust/release-signing.pub`, plus a sibling record naming its **purpose** (`release_signing`) and key id/version. Follows the `development-root.sha256` pattern exactly, including _absent is safe_ — no anchor means the agent refuses, which is what it already does today.                                                                                 | small    |
| **3** | **The release store**                           | `/persistent/shared/kitluy/releases/…` declared in `slot-shared.d`, with the generalised `.wants` workaround. Root-owned; not writable by `kitluy-terminal`.                                                                                                                                                                                                                                                     | small    |
| **4** | **Launcher indirection**                        | The `APP=` fallback shown in §6. ~4 lines.                                                                                                                                                                                                                                                                                                                                                                       | trivial  |
| **5** | **The update runtime**                          | Grow `update-bootstrap.ts`: query source → verify manifest (Ed25519 + **purpose** + key id/version + not revoked) → acceptance gate against real `image.env` → disk check → resumable download → **re-prove SHA-256 and size over received bytes** → unpack to `.incoming` → preflight → record `previous` durably → atomic flip → `systemctl restart` → health gate → commit or roll back → write `state.json`. | the bulk |
| **6** | **`pnpm dev:release`**                          | `pack` (tar.zst + digest + **git SHA and dirty flag** as `buildId`) → `sign` → `publish` (`create_release_draft_v1` → `sign_release_v1` → `promote_release_v1(…,'internal')`) → `assign` (`assign_release_v1`). Sits in `scripts/development/` beside `dev:fleet`, `dev:device:approve`, `dev:pairing:code`.                                                                                                     | medium   |
| **7** | **Development artifact source**                 | A static signed-artifact server on your workstation LAN, behind a **`ReleaseSource` interface with one implementation**. U4 adds the Hub implementation; nothing else changes.                                                                                                                                                                                                                                   | small    |

## 7.2 Health gate for an application

The owner-locked gate (`KLD-2026-08-06-WS11-T006-001` §6: 5-minute window, 20-second probes, 3 consecutive successes, **one** automatic rollback) was written for release installations, and U1 should inherit it rather than invent weaker timings.

**RECOMMENDATION:** the Device Shell writes a liveness marker each render tick; the probe requires the unit active **and** a marker newer than the probe interval. Success therefore commits after 3 × 20 s ≈ **60 seconds**; failure rolls back after at most 5 minutes.

> **This is the one place the locked values cost you daily speed**, and it is a genuine owner decision rather than an implementation detail — see **OD-U1-3**.

## 7.3 Failure handling — your §12 list, mapped

| Your scenario                           | U1 behaviour                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Interrupted download                    | resume from a durable offset; the running version is never touched                                                                         |
| Invalid signature                       | refused **before any artifact byte**; recorded with its code                                                                               |
| **Wrong-purpose signing key**           | refused — the on-device trust record names `release_signing` and the verifier checks it (piece 2). **This closes a gap that exists today** |
| Checksum mismatch                       | refused after re-proving over received bytes; payload discarded                                                                            |
| Disk full                               | refused before staging; requires free ≥ 2 × artifact size, as the Hub agent already does                                                   |
| Power failure                           | `.incoming` is never the pointer target; `previous` is recorded durably _before_ the flip; an unfinished unpack is discarded on next boot  |
| Application crash / failed health check | flip back to `previous`, restart, mark `failed_rolled_back`, refuse automatic retry of the same release                                    |
| Service crash                           | same path                                                                                                                                  |
| Incompatible Hub/Terminal versions      | `RELEASE_SCHEMA_INCOMPATIBLE` / configuration prerequisite refusal (already in the acceptance gate)                                        |
| **Everything else fails**               | the launcher falls back to the image's own Shell — the board still boots to a usable screen                                                |

## 7.4 Traceability — your §7

Every install records: `releaseId` · `productKey` · `version` · **`buildId` = git SHA + dirty flag** · `artifactDigestSha256` · `artifactSizeBytes` · signing key id/version/purpose · target device · installed_at · install result · health result · previous version.

The cloud half already stores this (`release_artifacts`, `device_installations`, `release_events` — append-only). The device half is `state.json`. **The one genuinely new field is the git SHA**, because the current build manifest records the _upstream builder's_ commit, not KitLuy's.

## 7.5 Local visibility — your §9, minimum viable

U1 does **not** build portal screens. It does make the answers exist and be readable without SSH:

- `state.json` carries installed version, previous version, last result, health result, timestamps;
- the Device Shell renders its own version and last-update state on screen — it already derives its display from a snapshot file and is guarded by a drift test, so this is one more field, not a new mechanism;
- `pnpm dev:verify:terminal` (piece 6's sibling) asserts: unit active · expected version reported · `edge-status.json` phase is `SERVING` · Hub reachable. That is your §10 automated acceptance, at the size U1 can honestly carry.

Full cloud visibility waits for U3 — **the contract and columns already exist** (`releaseVersion` on the heartbeat route; `software_version` / `release_version` / `configuration_version` in cloud `0177`), so U3 is wiring, not design.

## 7.6 Tests

**Unit/integration:** acceptance gate against a real `image.env` · wrong-purpose key refused · revoked key refused · tampered byte caught by the re-proof · resume-from-offset · disk-full refusal · atomic flip under simulated power loss (kill between every pair of steps; assert the pointer is always valid and `previous` always recoverable) · rollback restores the exact previous release · same release refused after `failed_rolled_back` · launcher falls back when the store is empty.

**Security gates:** `pnpm secret:scan` · `pnpm pki:assert-no-dev` still passes · assert no signing key reaches any device (public material only) · assert `promote_release_v1` refuses `pilot`/`stable` without an approver and without PKI configuration · assert a `development` artifact is refused by a non-development device.

## 7.7 Hardware acceptance — your §14, exactly

**Test A.** Shell at version A → make a visible UI change → `pnpm dev:release device-shell --target KL-TERM-001` → terminal receives, verifies, installs, restarts → **the change is visible on the touchscreen** → it reports version B → **and it is still paired, still activated, still `SERVING`.**

**Test B.** Publish a deliberately unhealthy version C → terminal stages and activates it → health gate fails → terminal automatically restores B → Shell works again → rollback is reported in `state.json` and on screen.

**Neither test involves an SD card.** Until both pass on your physical board, U1 is `TESTED-IN-DEV` at best — **not** `HARDWARE VERIFIED`.

## 7.8 The one honest cost

Pieces 2, 3, 4 and 5 are all **image** changes. So:

> **U1 costs you one final reflash of the development Pi Terminal.** After that, Device Shell changes never need one again.

There is no way around it that does not violate your §16 (the alternative is copying files in over SSH, which is the thing you ruled out). The last reflash is the price of the first non-reflash, and it is worth saying plainly rather than discovering at the bench.

---

# 8. What changes in your daily process after U1

**Before**

```text
change Device Shell code
  → pnpm build
  → package-bootstrap-runtime.sh
  → build-rpi-image.sh  (QEMU cross-build; the 2026-09-07 build produced
                         8.9 GB raw / 734 MB compressed)
  → write SD card
  → walk to the bench, power down, swap card, power up
  → wait for boot
  → re-register / re-approve / re-pair wherever a fresh card lost identity
  → test
```

**After**

```text
change Device Shell code
  → pnpm test
  → pnpm dev:release device-shell --target KL-TERM-001
  → (≈60 s later) the touchscreen is running it
  → test
```

**Eliminated:** the cross-build, the SD card, the physical trip, the reboot, the re-enrolment, and the "which version is actually on there?" question.

**Gained, not lost:** artifact identity, a version, a git SHA, a signature, a compatibility gate, an audit trail, automatic rollback, and a readable answer to _what happened_ without SSH.

**Still true after U1:** you keep SSH for engineering diagnosis — it is simply no longer part of the normal loop. And the clean-image lane (§11 of your direction) is untouched: full build → flash blank media → Factory Enrollment → Admin approval → pairing → activation → acceptance, run deliberately when image-level behaviour changes, not for every UI tweak.

---

# 9. What still requires a full image build / reflash after U1

| Change                                                                               | After U1                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Device Shell UI, React, Electron _app_ code                                          | **no reflash**                                                                         |
| Laundry POS and future vertical applications                                         | **no reflash** — U2                                                                    |
| `terminal-edge`, `health-reporter`, `cloud-registration`, Hub agent, sync service    | **reflash until U3**, and subject to **OD-U1-2**                                       |
| The update runtime itself                                                            | reflash — it is the bootstrap, by design                                               |
| Electron **runtime** binary                                                          | reflash until U5                                                                       |
| Kernel, Debian packages, system libraries, systemd units, `/usr` contents            | reflash until U5                                                                       |
| `/etc/kitluy/image.env` values (registration URL, hardware profile key, environment) | reflash until U5 — baked into the read-only rootfs and **not correctable on the card** |
| Trust anchors in `/etc/kitluy/trust`                                                 | reflash until U5 (or a governed configuration delivery)                                |
| `slot-shared.d` declarations                                                         | reflash, first time only                                                               |
| Bootloader / EEPROM                                                                  | **always reflash**                                                                     |
| `autoboot.txt` / bootconfig structure                                                | **always reflash**                                                                     |
| Partition table or sizes                                                             | **always reflash**                                                                     |
| LUKS2 layout on the Hub NVMe                                                         | **always reflash**                                                                     |
| Factory Enrollment _behaviour_                                                       | code: U3. **Testing it: always a blank card**                                          |
| Clean-slate acceptance, manufacturing, disaster recovery                             | **always reflash, by definition**                                                      |

---

# 10. What waits for U2–U6

I am keeping your sequence. One refinement, noted in §7: U1 builds the mechanism generically so U2 is a _second product_, not a generalisation pass — otherwise U1 becomes the throwaway your §5 forbids.

| Slice                                 | Scope                                                                                                                                                                                                                                                                                                  | Why it waits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U2 — reusable application release** | A second product (POS Desktop, or a vertical module) through the same pipeline; whatever generalisation gaps surface; multi-product `state.json`                                                                                                                                                       | Proves reusability with real evidence rather than by assertion. Nothing in U1 needs it.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **U3 — runtime/service release**      | `terminal-edge`, `health-reporter`, `hub-agent`; per-unit activation (stop → flip → start) with unit-specific preflight; **device → Hub → cloud version reporting**, which also finally makes the Partner Portal's `hubPaired` rung reportable; the "may I install now?" predicate answered by the Hub | **Gated on OD-U1-2.** Also riskier than U1: a bad `terminal-edge` costs the Hub connection, where a bad Shell only costs the screen — and the launcher fallback protects the Shell but has no equivalent for a service.                                                                                                                                                                                                                                                                                               |
| **U4 — Store Hub release cache**      | Two `/edge/v1` routes (manifest, Range-capable artifact); terminal prefers Hub, falls back to cloud; calls the **already-built** `release-cache.ts` for the first time; per-Store rollout serialisation                                                                                                | Needs more than one terminal to be worth proving. **Policy §9 already specifies this architecture** — it is implementation, not design.                                                                                                                                                                                                                                                                                                                                                                               |
| **U5 — A/B system OTA**               | Real `SlotAdapter`; system-image artifact; `reboot "0 tryboot"`; `autoboot.txt` commit; per-slot `cmdline.txt`                                                                                                                                                                                         | **Has a hard prerequisite: device identity must stop being per-slot.** Today an A/B switch would boot a board with no identity key, no certificate, no registration and no pairing — it would present as brand new. Cheap to fix (`slot-shared.d`) but must land _before_ the first slot write, with its own hardware test. **EXTERNAL RESEARCH:** the Raspberry Pi firmware keeps no boot-attempt counter, but tryboot is one-shot and self-clearing — so "the new slot does not boot" rolls back by firmware, free. |
| **U6 — Pilot/Stable governance**      | Cohort/canary expansion with automatic pause on health failure; mandatory minimum version; emergency release; Admin Releases screen; Partner "install now / defer until close"                                                                                                                         | **BLK-005 blocks Pilot and Production promotion**, and the policy's `[REQUIRED: channel approvers and permissions]` has never been filled in. Building rollout governance before there is a fleet is the six-month detour you ruled out.                                                                                                                                                                                                                                                                              |

---

# 11. Owner decisions required before U1

Three. Everything else is implementation and I am not asking you about it.

---

### OD-U1-1 — May a Device Shell release run from persistent storage instead of `/usr`?

**Plain language.** Every KitLuy program runs from `/usr/lib/kitluy/`, which is read-only. An update cannot write there. For U1 the question is narrow, because the Shell's launcher already resolves its app through one variable: may the _app payload_ (280 KB of JS/HTML) live on the persistent partition, with the launcher preferring it and falling back to the image's own copy?

|       | Option                                                                     | Consequence                                                                                                                                                           |
| ----- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Yes** — release store on a slot-shared persistent path; `/usr` untouched | U1 proceeds. `/usr` stays read-only, no overlayfs, no sysext, no EROFS change. A bad release cannot brick the board because the image's Shell is always the fallback. |
| **B** | No — application code may only ever live in `/usr`                         | U1 becomes impossible without `systemd-sysext` or making `/usr` writable; both are larger, and sysext's signature enforcement is unavailable on this kernel.          |
| **C** | Applications ship only inside a full system slot                           | Every UI change costs a reboot and a full image build. Close to today; does not solve the problem.                                                                    |

**My recommendation: A.** It is the only option that delivers the loop you asked for, it violates none of your §16 prohibitions, and the fallback property is a genuine safety improvement over today rather than a compromise.

**Blocks U1: YES.**

---

### OD-U1-2 — Is the Device Shell a "bootstrap surface" or a governed application release?

**Plain language.** `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` (LOCKED) §2 lists _"Terminal bootstrap surface — `/usr/lib/kitluy/terminal-bootstrap-ui`"_ among the components baked into the image, and §4.2 says **"bootstrap-agent changes ride an image rebuild."** The graphical Device Shell replaced `terminal-bootstrap-ui` on 2026-09-04, after that decision was written. So on a strict reading, **U1 updates a bootstrap component, which the decision currently forbids.**

The decision's _reason_ is bootstrap ordering: an updater cannot deliver itself. I think that reason does not reach the Shell — but that is your call, not mine.

|       | Option                                                                                                                                                                                                                              | Consequence                                                                                                                                                                                                                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Narrow the bootstrap set to what is needed to obtain and verify an update** — `firstboot-identity`, `cloud-registration`, `update-agent` and its trust material — and classify the Device Shell as a governed application release | U1 proceeds. The ordering argument stays fully intact: a board with a broken Shell can still register, still be approved and still update, because those are separate units. The launcher fallback means it still shows a usable screen. |
| **B** | Keep the boundary as written; the Shell stays image-only                                                                                                                                                                            | **U1 cannot proceed as scoped.** The first product would have to be the POS Desktop application — which is SCAFFOLDED and has no business behaviour, so the fast loop would deliver nothing you can see on the touchscreen.              |
| **C** | Rule on the Shell only now, defer `terminal-edge` and the agents to U3                                                                                                                                                              | U1 proceeds on the narrowest possible ruling; U3 comes back to you.                                                                                                                                                                      |

**My recommendation: C for now, A when U3 is scoped.** C unblocks U1 with the smallest possible change to a LOCKED decision, and keeps the wider boundary question for when you can see U1 working and judge it on evidence rather than on my argument.

**Blocks U1: YES.**

---

### OD-U1-3 — May development use shorter health-gate timings?

**Plain language.** The health gate is owner-locked at 5-minute window / 20-second probes / 3 consecutive successes (`KLD-2026-08-06-WS11-T006-001` §6). Applied to U1, a successful install commits after about **60 seconds**, and a failed one rolls back after up to **5 minutes**. That is safe, and it is slower than the loop you described.

|       | Option                                                                                                                                  | Consequence                                                                                                                                   |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **A** | **Keep the locked timings everywhere**                                                                                                  | One gate, no environment-specific behaviour, nothing to get wrong. ~60 s per successful dev install.                                          |
| **B** | **Development-only timings** (e.g. 5-second probes, 3 consecutive, 60-second window), pilot and production unchanged and unchangeable   | Dev install commits in ~15 s. Introduces one environment-conditional value — small, but it is a second behaviour in a security-adjacent path. |
| **C** | Keep locked timings, but let the runtime commit early on an explicit positive readiness signal from the app rather than on elapsed time | Fast _and_ single-behaviour, but it requires the Shell to assert its own readiness, which is a slightly stronger claim than "it is alive".    |

**My recommendation: A for U1.** Sixty seconds is not the bottleneck you are trying to remove — the cross-build and the card are — and keeping one gate everywhere is worth more than 45 seconds. If it grates in practice once U1 is running, revisit with B or C on evidence.

**Blocks U1: no** — I will implement A unless you say otherwise. Raised because the value is owner-locked and it directly shapes the experience you described.

---

### Not asked, deliberately

Poll interval, artifact compression, on-disk layout inside the release store, CLI flag spelling, how many releases to retain, the liveness-marker format, whether the dev artifact source is a static file server or a small script, and the exact `dev:release` subcommand names. Engineering can settle all of these safely, and I will record the choices in the U1 handoff.

---

# 12. Evidence discipline for U1

Per your §18, U1 will be reported against these states and no looser:

| State                                | Meaning for U1                                                                                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE IMPLEMENTED`                 | the runtime, CLI and store exist and typecheck                                                                                                                  |
| `TESTED-IN-DEV`                      | §7.6 suites pass, including power-loss and rollback                                                                                                             |
| `IMAGE VERIFIED`                     | a built rootfs carries the trust anchor, the store declaration and the launcher indirection, asserted by `image-contents.test.sh` and `systemd-runtime.test.sh` |
| `HARDWARE VERIFIED`                  | **Test A and Test B both pass on your physical Pi Terminal, with no SD card touched, and the terminal still paired and `SERVING` afterwards**                   |
| `PILOT-PROVEN` / `PRODUCTION-PROVEN` | **not claimable** — BLK-005 blocks Pilot and Production promotion                                                                                               |

**U1 is not complete until `HARDWARE VERIFIED`.** An update runtime that exists, a release schema that exists and A/B partitions that exist are not evidence that OTA works, and I will not report them as such.

---

## Stop

This turn was read, inspect, analyse, propose. **Nothing was implemented. No code, migration, image or documentation was changed. Nothing was committed or pushed. No owner decision was made, and no GAP ID was created.** `pnpm verify` was not run, because nothing in the repository was modified except the addition of this file.

**Waiting on: OD-U1-1 and OD-U1-2.** Both are yes/no in substance. OD-U1-3 I will implement as option A unless you say otherwise.
