# KitLuy device update workflow — feasibility assessment

| Field | Value |
| --- | --- |
| Date | 2026-09-11 · Asia/Phnom_Penh |
| Repository | `het-kitluy-project` @ `bde3490` + uncommitted working tree on `claude/fix-firstboot-esm-and-ssh-hostkeys` |
| Type | **READ-ONLY ARCHITECTURE AND FEASIBILITY ASSESSMENT.** No code, migration, image or documentation was changed. Nothing was committed, deployed or published. No GAP ID was created. No owner decision was made. |
| Status of this file | **ASSESSMENT — NOT AUTHORITY.** It is evidence-gathering and recommendation. It advances no register status and binds nothing. |
| Method | Repository inspection (sources, manifests, migrations, units, the pinned upstream builder checkout, a built rootfs) plus external research. Every claim is labelled. |

**Label key used throughout**

- **REPOSITORY FACT** — read directly from this repository or the pinned upstream tree.
- **EXTERNAL RESEARCH** — from primary documentation outside this repository.
- **RECOMMENDATION** — my proposal, not a decision.

**Status language (as required)**

`SOURCE IMPLEMENTED` · `TESTED-IN-DEV` · `IMAGE VERIFIED` · `HARDWARE VERIFIED` · `PILOT-PROVEN` · `PRODUCTION-PROVEN` · `LAYOUT ONLY` · `ABSENT`

---

# Executive Verdict

## 1. Is the workflow you want technically possible?

**YES — but requires architectural changes.**

Not "yes, just wire it up", and not "no". The honest split is this:

> **The governance half of an update platform is built and tested. The delivery half does not exist at all. And one structural fact in the image — every KitLuy executable runs from a read-only filesystem — currently makes the delivery half impossible to add without an explicit design decision.**

What already exists is better than you probably expect. What is missing is more than the word "update-agent" suggests.

**Built and tested (TESTED-IN-DEV):**

- A complete **signed release manifest v1 contract** — Ed25519, canonical bytes with a separator-injection guard, key id **and** key version matched, revoked keys refused even with a valid signature, and a fifteen-field body that already carries product, version, build id, architecture, hardware profile, environment, channel, SHA-256 artifact digest, size, min/max schema version, configuration prerequisite and rollback target (`packages/device-identity/src/release-manifest.ts`).
- A complete **cloud release authority** — schema `kitluy_releases`, immutable-after-signing manifests, `draft → signed → internal → pilot → stable` with no skips, four-eyes on Pilot/Stable, revocation as a new fact, rollout campaigns scoped to Tenant/Store/Location, and a per-device installation projection (migration `0180`).
- A complete **Hub-side install state machine** with the owner-locked health gate — 5-minute window, 20-second probes, 3 consecutive successes, **exactly one** automatic rollback, `failed_rolled_back` terminal, every state persisted before the externally visible step so a crash resumes from the database and never from process memory (`services/kitluy-hub-agent/src/hub/release-agent.ts`, Hub migrations `0038`/`0039`).
- A **verified artifact cache** on the Hub that re-proves digest and size over the downloaded bytes, resumes from a durable offset, and treats object-storage metadata as never authoritative (`release-cache.ts`).

**Absent (ABSENT — not partial):**

- Any **production caller** of any of it. `beginInstallation`, `resumeAfterRestart`, `applyReleaseAssignment`, `create_release_draft_v1`, `sign_release_v1`, `promote_release_v1`, `assign_release_v1` are invoked **only from test files**. The Hub agent's entrypoint (`src/bin/hub-agent.ts`) does not import the release agent at all.
- Any **real device adapter**. `SlotAdapter` (`bootedSlot`, `stage`, `verifyStaged`, `restartInto`, `availableDiskBytes`) has exactly one implementation in the repository: `class FakeDevice` in a test.
- Any **artifact transport**. `ArtifactFetcher` has only test fakes. There is no object storage: `kitluy-file-service` is SCAFFOLDED (91 lines, health/version kernel only).
- Any **operator surface**. The Management API has no release route. Neither portal has any release or update screen. There is no CLI, no signing tool, and nothing anywhere produces a `signature_b64`.
- Any **LAN release route**. `packages/edge-contracts` defines no release or artifact path, so a Store Hub cannot serve a release to a terminal today.

**The structural blocker:**

Every KitLuy component on both images executes from `/usr/lib/kitluy/…` — firstboot-identity, cloud-registration, health-reporter, update-agent, operational-tls, terminal-edge, device-shell, device-config-broker, hub-agent, hub-storage-provision, hub-database-provision, hub-pairing-ui. The root filesystem is **EROFS, which is read-only by construction**. Nothing can be installed there at runtime.

The image already contains the POS application's systemd unit with this comment:

> *"The governed release package installs `/usr/lib/kitluy/terminal-client` and runs `systemctl enable --now kitluy-terminal-client.service`."*

**That is not achievable as written.** The designed install target is a read-only filesystem. This is the single design question that has to be answered before any application update can work, and it is §P-1 below.

## 2. How much of the foundation already exists?

| Layer | State |
| --- | --- |
| Trust contract (signed manifest, verifier, acceptance gate) | **TESTED-IN-DEV** — complete, and genuinely good |
| Cloud release authority (channels, promotion, revocation, campaigns) | **TESTED-IN-DEV** — complete |
| Hub install state machine + health gate + one-rollback | **TESTED-IN-DEV** — complete |
| Hub verified artifact cache | **TESTED-IN-DEV** — complete |
| Device-side update runtime | **ABSENT** — a 91-line status logger (§B) |
| Device slot/install adapters | **ABSENT** — one test fake |
| Artifact storage and transport | **ABSENT** |
| Operator surface (publish/sign/promote/assign) | **ABSENT** |
| Writable install target on the device | **ABSENT** |
| A/B system OTA | **LAYOUT ONLY** (§G) |

Roughly: **the hard, subtle, security-critical half is done. The plumbing half is not started.** That is an unusual and favourable position — the part that is expensive to get right is the part you already have.

## 3. Can you stop reflashing for normal application changes?

**Yes — and this is the first thing to build.** It needs a writable, signature-verified release store and an atomic activation, plus a development publish path. No new trust model, no new channel, no weakening of anything. Slice 1 in §N.

## 4. Can you stop reflashing for runtime/service changes?

**Technically yes, by the same mechanism** — `terminal-edge`, `health-reporter`, `hub-agent` and the firstboot library are all Node closures packaged by the same script and would ride the same artifact format.

**But there is a LOCKED owner decision in the way.** `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` §4.2 reads:

> *"Bootstrap-agent changes ride an image rebuild; application changes must not."*

That decision deliberately bakes the bootstrap set into the image, because *an updater cannot depend on itself being downloaded first*. That reasoning is correct and should not be discarded. But it currently covers `firstboot-identity`, `cloud-registration`, `health-reporter`, `update-agent` and the shared library — which is most of what you change day to day.

Two components are **not** classified by that decision at all, because they did not exist when it was written (2026-08-11): **`terminal-edge`** (created 2026-09-10) and the **graphical Device Shell** (created 2026-09-04, which replaced `terminal-bootstrap-ui` — a component the decision *does* list). Their classification is genuinely open. This is §P-2, and it is your decision, not engineering's.

## 5. Can you eventually stop reflashing for OS/system changes?

**Yes — the hardware and the image already support it, and the mechanism is proven upstream.** But there is a **hard prerequisite that would break devices if skipped**, and it is not small:

> **REPOSITORY FACT — every piece of device identity lives on a per-slot path.** `/var` is bind-mounted from `/persistent/slots/system_{a,b}/var`. Under it: `identity/device-identity.key.pem`, `operational/operational-tls.key.pem`, `registration-state.json`, `pairing-state.json`, `installation.json`, `terminal/assignment.json`, `terminal/edge-status.json`, `terminal/last-hub-endpoint.json`.
>
> **An A/B system update today would boot a device with no identity key, no operational certificate, no registration state and no Hub pairing. It would present itself to the cloud as a brand-new board.**

The repository is already half-aware of this — `installation.js` argues correctly that the *installation id* being per-slot is the definition of a new install, and then records in a parenthesis: *"The device KEY living under the same per-slot path is a separate matter and is recorded as a finding, not silently changed here."* That finding is now on the critical path for system OTA.

The fix is cheap and uses an existing, upstream-supported mechanism (§G). But it must land **before** the first A/B OTA, not after.

## 6. What would still require a physical reflash?

After the full proposed architecture, genuinely:

- GPT partition table or partition size changes (boot/system/persistent);
- the LUKS2 layout on the Hub's NVMe;
- `autoboot.txt` / bootconfig partition structure changes (the A/B scheme itself);
- Raspberry Pi bootloader/EEPROM changes;
- first manufacturing, and clean-slate/Factory Enrollment acceptance testing;
- disaster recovery from an unbootable board (both slots dead);
- a change to the slot-shared path set that must apply before first boot;
- deliberate re-certification of a device.

**Not** on that list, after the architecture lands: kernel, Debian packages, systemd units, `/usr` contents, Electron runtime, Device Shell, terminal-edge, hub-agent, POS application. Those all live inside a system slot or an application release. See the full matrix in §O.

## 7. What is the fastest safe development workflow achievable?

```text
change Device Shell
  → pnpm build + pack artifact (tar.zst + SHA-256)
  → sign with the DEVELOPMENT release_signing key (already authorized)
  → create_release_draft_v1 → sign_release_v1 → promote_release_v1(…,'internal')
  → assign_release_v1 to your dev terminal
  → the terminal's update runtime polls, verifies, unpacks beside the running
    version, flips a pointer atomically, restarts the unit
  → you test on the touchscreen
```

Elapsed: **seconds to a couple of minutes**, versus the current cross-build → flash → boot → re-enroll cycle.

Crucially, **this requires no new channel and no new trust environment.** REPOSITORY FACT: `promote_release_v1` applies the BLK-005 PKI gate and the independent-approver rule **only** to `pilot` and `stable`. Promotion to `internal` needs neither. And `environment='development'` is a first-class value of `release_artifacts_env_chk`. BLK-005's own decision record states development certificate implementation is **AUTHORIZED** and permits a software-backed development signer.

**So the fast development path is already legally open. It is unbuilt, not blocked.**

## 8. What should you build first?

**Slice 1: one Device Shell version reaches one development Pi Terminal over the LAN, verified and atomically activated, with a working rollback — and no SD card is touched.**

Everything else — runtime/service updates, Hub distribution, A/B system OTA, portal UI, store orchestration — is the *same* architecture extended. Do not build a second one for development (§17 of your brief is right, and §N respects it).

---

# A. Current update capability

All rows are REPOSITORY FACT.

| Target | Current capability | Evidence | Missing pieces | Reflash today? | Reflash after proposed architecture? |
| --- | --- | --- | --- | --- | --- |
| **Pi Terminal application** (Device Shell; future POS) | **ABSENT.** No install path exists. The Shell runs from `/usr/lib/kitluy/device-shell` on read-only EROFS. The POS unit `kitluy-terminal-client.service` ships **defined but not enabled**, with `ConditionPathExists=/usr/lib/kitluy/terminal-client` — a path a release package cannot write to. | `kitluy-device-shell.service:106`; `kitluy-terminal-client.service:1-31`; `image: layer: image-rota` with `rootfs_type: erofs` | writable release store; download; verify; atomic switch; restart; rollback; publish path | **YES** | **No** |
| **Pi Terminal runtime/services** (`terminal-edge`, `health-reporter`, `cloud-registration`, `firstboot` lib, config broker) | **ABSENT.** Same read-only path. Packaged into the image overlay by `package-bootstrap-runtime.sh` from the agent's `dist/`. | `runtime-manifest.json`; `package-bootstrap-runtime.sh` | as above, **plus** an owner ruling on the bootstrap boundary (§P-2) | **YES** | **No**, for the components the owner reclassifies; **yes** for whatever stays bootstrap-set |
| **Pi Terminal OS/system** | **LAYOUT ONLY.** A/B partitions, by-slot udev links and `autoboot.txt` with `tryboot_a_b=1` all exist. Nothing writes a slot, sets tryboot, or commits. | upstream `image/gpt/ab_userdata/pre-image.sh:33-40`; `layer/rpi/device/ab-slots.adoc`; `SlotAdapter` has only `FakeDevice` | slot adapter; artifact→slot writer; tryboot invocation; commit; **and the per-slot identity fix (§G)** | **YES** | **No** (after §G prerequisite) |
| **Store Hub runtime** (`hub-agent`, provisioning scripts) | **ABSENT** on the device. The Hub *has* the install state machine and cache in its own database (migrations `0038`/`0039` are in the image) but `hub-agent.ts` never calls them. | `src/bin/hub-agent.ts` imports no release module; `hub-migrations/0038,0039` present in overlay | wiring; adapters; transport; as above | **YES** | **No** |
| **Store Hub OS/system** | **LAYOUT ONLY**, same as the terminal. The Hub's *database* survives a slot switch (it is a separate LUKS2 mount at `/var/lib/kitluy/hub`), but its **identity key does not** — same per-slot `/var` problem. | `var-lib-kitluy-hub.mount`; identity paths under `/var/lib/kitluy/identity` | as terminal, plus Hub self-update source (§H) | **YES** | **No** |
| **POS application** (`apps/kitluy-pos-desktop-app`) | **SCAFFOLDED** as an application; **ABSENT** as a deliverable. Correctly excluded from the golden image by `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` §3 — but with no delivery path, it currently cannot reach a device by any means. | app README "SCAFFOLDED"; decision §3 | the whole application update class | n/a (never shipped) | **No** — it becomes the first true application release |

---

# B. Current update-agent analysis

**Do not infer from the name. Here is what it does.**

REPOSITORY FACT — `services/kitluy-device-firstboot-agent/src/bin/update-bootstrap.ts` is **91 lines**. Its entire runtime behaviour:

```
every 300 seconds:
    if   /etc/kitluy/trust contains no *.pub or *.pem   → log "no_trust_anchor"
    elif /etc/kitluy/release.env has no KITLUY_RELEASE_SOURCE → log "no_release_source"
    else → log "up_to_date" with KITLUY_IMAGE_VERSION
```

That is all. It writes one journal line and sleeps.

| Aspect | Verdict |
| --- | --- |
| Checks for an available update | **NO.** `up_to_date` is returned unconditionally once the two preconditions exist. Nothing is ever queried. |
| Downloads anything | **NO.** No network code of any kind. |
| Verifies a signature | **NO.** It checks that anchors *exist*; it never verifies anything. (Its own comment says it "verifies signatures with PUBLIC trust material only" — the function body does not.) |
| Installs anything | **NO.** Its own header is explicit and honest: *"it never reports an update as installed — installation is the release agent's job, not this one's."* |
| Reports state to the cloud | **NO.** Journal only. |

**Its actual behaviour on your two physical boards right now:**

> REPOSITORY FACT — `/etc/kitluy/trust/` in the terminal overlay is an **empty directory**. The Store Hub overlay has **no trust directory at all**. Nothing anywhere in `infra/` writes `/etc/kitluy/release.env` or `KITLUY_RELEASE_SOURCE`.
>
> Therefore both boards log `state=no_trust_anchor` every five minutes, and have done since they were flashed. The agent has never reached even its second precondition.

| Classification | |
| --- | --- |
| SOURCE IMPLEMENTED | as a **precondition reporter** — yes, and it is correct at that job |
| TESTED-IN-DEV | yes, for what it does |
| IMAGE VERIFIED | yes — present and enabled in both manifests |
| HARDWARE VERIFIED | yes — as a no-op that logs `no_trust_anchor` |
| **As an updater** | **ABSENT** |

**RECOMMENDATION.** Do not delete or rewrite it. Its bootstrap-ordering rationale is sound and its fail-closed posture (refuse to *look* for a payload without trust material, rather than fetch-then-fail-to-verify) is the right instinct. It should **grow** into the device update runtime, keeping that posture, and keeping its name.

---

# C. Recommended architecture

Your proposed diagram is close to correct. Two corrections from repository evidence.

**Correction 1 — the Hub's install authority is already device-local, not cloud-local.** Hub migration `0039` holds the durable installation state and enforces the one-rollback rule *in the schema*. The cloud's `device_installations` is explicitly commented as a **projection**. So the arrow from cloud to device is *assignment and eligibility*, not control.

**Correction 2 — the Hub cannot be in the terminal's trust path, and the code already guarantees this.** `release-manifest.ts` says it outright: *"the Hub cannot make an invalid release trustworthy for a terminal, because the terminal runs the same closed verifier over its own trust registry."* Your §7 requirement is already architecturally enforced.

```text
                    ┌──────────────────────────────────────────┐
                    │        KitLuy Release Control            │
                    │  kitluy_releases (cloud, migration 0180) │
                    │  draft → signed → internal → pilot →     │
                    │  stable · revoke · campaigns             │
                    │  BLK-005 gate applies to pilot/stable    │
                    └────────────────┬─────────────────────────┘
                                     │ signed manifest (Ed25519)
                                     │ + artifact digest/size
                                     │   ── the manifest is authority,
                                     │      never the URL or the channel label
                    ┌────────────────┴─────────────────────────┐
                    │                                          │
            ┌───────▼────────┐                        ┌────────▼────────┐
            │   Store Hub    │                        │   Hub self-OTA  │
            │ verifies       │                        │  Hub pulls its  │
            │ INDEPENDENTLY  │                        │  own release    │
            │ (0038 cache)   │                        │  from cloud —   │
            │ caches bytes   │                        │  never from     │
            └───────┬────────┘                        │  itself (§H)    │
                    │ LAN, mTLS :7443                 └─────────────────┘
                    │ ── transport + cache ONLY
                    │ ── manifest travels WITH the bytes
       ┌────────────┼────────────┬────────────┐
       │            │            │            │
   ┌───▼───┐    ┌───▼───┐    ┌───▼───┐    ┌───▼───┐
   │  T1   │    │  T2   │    │  T3   │    │  T4   │
   │ each terminal re-verifies the Ed25519 manifest against its OWN
   │ trust registry, re-proves the SHA-256 over the bytes it received,
   │ and runs findReleaseAcceptanceRefusal() against its own image.env
   └───────────────────────────────────────────────┘
```

**What each device already has to make this work (REPOSITORY FACT):** `/etc/kitluy/image.env` on every image already carries `KITLUY_IMAGE_VERSION`, `KITLUY_IMAGE_SCHEMA_VERSION`, `KITLUY_RELEASE_CHANNEL`, `KITLUY_DEVICE_CLASS`, `KITLUY_HARDWARE_PROFILE_KEY` and `KITLUY_ENVIRONMENT`. Those are, field for field, the inputs `ReleaseAcceptanceContext` needs. The acceptance gate can be populated on a real device today without inventing a single new value.

---

# D. Update classes

**RECOMMENDATION** — four classes, matching your §5, with the boundaries repository evidence actually supports.

| Class | Contents | Delivery | Activation | Rollback | Requires reboot |
| --- | --- | --- | --- | --- | --- |
| **A — Application** | Device Shell, POS Desktop, vertical modules, Electron *app* code | signed artifact → persistent release store | atomic pointer flip + `systemctl restart` | flip pointer back, restart | **no** |
| **B — Device runtime/service** | `terminal-edge`, `health-reporter`, `hub-agent`, `cloud-registration`, firstboot lib, config broker | **same** artifact format and store | same, per unit | same | **no** |
| **C — System/OS** | kernel, Debian packages, system libraries, Electron *runtime*, systemd units, boot configuration, `/usr` contents | signed system-slot image → inactive A/B slot | `reboot "0 tryboot"` → health gate → commit `autoboot.txt` | tryboot is one-shot: a power cycle returns to the old slot automatically | **yes** |
| **D — Factory/recovery** | the full `.img` | SD card / NVMe writer | flash | reflash the other image | n/a |

**On your §2 question — is separating "factory image" from "normal update" architecturally correct for KitLuy?**

**Yes, and the repository already committed to it before you asked.** `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` is exactly this separation, recorded as LOCKED: the image carries *the minimum trusted bootstrap runtime required to establish and manage a device before normal application releases are available*, and applications are governed release artifacts. The bootstrap-ordering argument behind it — an updater cannot be delivered by itself — is sound and is the reason the separation is not arbitrary.

**The one place I will push back on your framing:** you described the split as image = *how a blank Pi becomes a KitLuy device*, update = *how it evolves afterward*. That is right for classes A and B. It is **not quite right for class C**, because a system update *is* a new image — the same artifact, delivered differently. Keeping class C conceptually inside "IMAGE" rather than inside "UPDATE" is what keeps the reproducibility and signing story coherent: one build, two delivery routes (flash, or write-to-inactive-slot). I recommend you think of it as **three delivery routes for two artifact kinds**, not two worlds.

---

# E. Developer workflow

**Today (REPOSITORY FACT, from the 2026-09-03 → 2026-09-11 handoffs):**

```text
change code
  → pnpm build
  → package-bootstrap-runtime.sh
  → build-rpi-image.sh (QEMU cross-build; the 2026-09-07 terminal build
     produced 8.9 GB raw / 734 MB compressed)
  → write SD card
  → carry card to the Pi, reseat, boot
  → re-register / re-approve / re-pair where identity was lost
  → test
```

**After Slice 1 (RECOMMENDATION):**

```text
change Device Shell
  → pnpm --filter kitluy-device-shell build && pnpm test
  → kitluy-release pack   --product device-shell --version 0.4.12
  → kitluy-release sign   --environment development --key dev-release-signing
  → kitluy-release publish --channel internal --assign KL-TERM-001
        (create_release_draft_v1 → sign_release_v1
         → promote_release_v1(…,'internal') → assign_release_v1)
  → the terminal's update runtime (next poll, or a LAN nudge):
        download → SHA-256 re-proven over received bytes
                 → Ed25519 manifest verified against its own trust registry
                 → findReleaseAcceptanceRefusal() against its own image.env
                 → unpack beside the running version
                 → preflight
                 → atomic pointer flip
                 → systemctl restart kitluy-device-shell
                 → health gate; unhealthy ⇒ flip back, restart, report
  → you look at the touchscreen
```

**Eliminated:** the cross-build (minutes to tens of minutes), the card write, the physical handling, the reboot, and every re-enrolment caused by a fresh card. **Retained:** artifact identity, version, signature, compatibility gate, audit trail, rollback, reproducibility.

**Kept deliberately:** the poll. A push channel is a later optimisation; for a development board a 15–30 s poll interval is indistinguishable from push and adds no new protocol.

---

# F. Application update design

## F.1 The read-only rootfs problem, and the two honest options

Your §10 is the crux. Here are the two real options, compared against KitLuy evidence.

### Option A — versioned release store on persistent storage + atomic pointer

```text
/persistent/shared/kitluy/releases/          ← SLOT-SHARED, not per-slot /var
   device-shell/
      rel-01J.../        unpacked payload + its verified manifest
      rel-01K.../
      current  →  rel-01K...      (symlink; switch by rename(2), atomic)
      previous →  rel-01J...
```

The unit's `ExecStart` points at `…/current/bin/device-shell`.

- **Pros:** simple; no overlayfs; no kernel modules; no disturbance to `/usr`; per-component independent; rollback is a symlink flip; works with the sandboxing the units already carry.
- **Cons:** executables sit on a writable partition, which is a small step away from appliance purity. Mitigated by: the payload is Ed25519-verified before the pointer moves, the directory is root-owned and not writable by the service user, and the unit keeps `NoNewPrivileges`, `ProtectSystem=strict` and its `CapabilityBoundingSet`.

### Option B — `systemd-sysext`

**REPOSITORY FACT — this is already available on your image and unused.** The built Pi Terminal rootfs contains `/usr/bin/systemd-sysext` and `usr/lib/systemd/system/systemd-sysext.service` (systemd **252.39-1~deb12u2**, Debian 12 bookworm). The kernel (`6.12.96+rpt-rpi-2712`) has `CONFIG_OVERLAY_FS=m`, `CONFIG_SQUASHFS=m`, `CONFIG_EROFS_FS=m`, `CONFIG_BLK_DEV_LOOP=y` and `CONFIG_DM_VERITY=m` — every module sysext needs.

**EXTERNAL RESEARCH** — sysext overlays signed, image-based extensions onto `/usr/` and `/opt/` via overlayfs, which is exactly where KitLuy's components live. Each extension carries `/usr/lib/extension-release.d/extension-release.NAME` declaring `ID=`, `VERSION_ID=`/`SYSEXT_LEVEL=` and `ARCHITECTURE=`, and the host refuses a non-matching extension — a **built-in compatibility gate**. Search paths include `/var/lib/extensions/` and `/etc/extensions/`.

- **Pros:** standard, image-based, read-only payload, `/usr` stays canonical, free compatibility metadata, can carry dm-verity.
- **Cons, and one is decisive for your trust model:**
  - **REPOSITORY FACT — `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG is not set` in the Raspberry Pi kernel.** The kernel therefore **cannot enforce a signature on a verity roothash.** sysext's own signature enforcement is not available to you.
  - `systemd-sysext refresh` unmounts and remounts the `/usr` overlay, which disturbs *everything* running from `/usr`, not just the component being updated.
  - Debian 252 predates several sysext ergonomics (`systemd-sysupdate` is absent from the image entirely).

### RECOMMENDATION

**Take Option A for Slices 1–2, and design the artifact so Option B remains reachable without changing the manifest contract.**

Reasoning, in order of weight:

1. **The kernel finding settles the security argument.** Since dm-verity roothash signatures cannot be kernel-enforced, sysext's signature verification would have to be done in userspace anyway — by exactly the verifier KitLuy already owns. Option B therefore buys *no* security you do not already have, while adding an overlay remount you do not need.
2. **One verifier, one trust registry.** `verifyReleaseManifestSignature` + `findReleaseAcceptanceRefusal` is already the closed, fail-closed, tested gate. Routing trust through systemd instead would create a second trust path — precisely what KLD-2026-07-28-002 §1 forbids for signing purposes.
3. **Option A does not foreclose Option B.** A sysext image is just a different *packaging* of the same signed manifest and digest. If you later want `/usr`-shadowing, the artifact contract does not change.

> **RECOMMENDATION, stated separately because it matters more than the choice above:** whichever option you take, the release store **must be slot-shared**, i.e. under `/persistent/shared/…` declared through `/etc/rpi-image-gen/slot-shared.d/*.conf`. If it lives under `/var`, every installed application silently disappears on the first A/B system update, because `/var` is per-slot. KitLuy already uses this exact mechanism correctly for `/etc/ssh` and `/etc/wpa_supplicant`, and the comments in those files give the reasoning verbatim.

## F.2 Artifact structure

**REPOSITORY FACT — the manifest contract already exists and should not be redesigned.** `SignedReleaseManifestBody` covers thirteen of the fifteen fields you listed in §13:

`manifestVersion` · `releaseId` · `productKey` · `version` · `buildId` · `architecture` · `hardwareProfile` · `environment` · `channel` · `artifactDigestSha256` · `artifactSizeBytes` · `minSchemaVersion` · `maxSchemaVersion` · `configPrerequisiteVersion` · `rollbackReleaseId`

plus the envelope: `keyId` · `keyVersion` · `algorithm` · `signature`.

**What your §13 list has that the contract does not:**

| You listed | Status | Comment |
| --- | --- | --- |
| device class | **not a manifest field** — but `hardwareProfile` + `productKey` already discriminate. `KITLUY_DEVICE_CLASS` is in `image.env`. | **RECOMMENDATION:** do not add a field; bind class through `productKey` (e.g. `kitluy.device-shell.terminal`) so the existing signature covers it. |
| **signing purpose** | **ABSENT from the manifest.** `SigningPurpose` exists as a type (six purposes, separation required by KLD-2026-07-28-002 §1/§7) but the release manifest body does not carry it and the verifier does not check it. | **This is a real gap, and it is exactly the case you raised:** today a valid Ed25519 signature from a key that happens to be in `release_trust_key` is accepted regardless of the purpose it was minted for. The separation is currently enforced by *key registry discipline*, not by the signed bytes. See §P-3. |
| created_at | absent, deliberately — the canonical bytes contain **no clock read**, which is what makes them deterministic. Timestamps live in `release_artifacts.signed_at`. | leave as is |
| revocation metadata | not in the manifest (correctly — a signed artifact cannot carry its own future revocation). Handled by `release_artifacts.state='revoked'` + the device-side `revokedReleaseIds` set. | leave as is |

## F.3 Download, verify, install, switch — the required order

**REPOSITORY FACT — `release-cache.ts` already states and implements the correct discipline:** *"verification precedes ANY download byte; the digest and size are re-proven over the DOWNLOADED bytes (object-storage metadata is never authority); downloads resume from the durable offset."*

The device-side sequence should mirror it exactly:

```text
 1. receive manifest + envelope          (small, cheap to reject)
 2. verifyReleaseManifestSignature()     ← BEFORE any artifact byte
 3. findReleaseAcceptanceRefusal()       ← product/arch/profile/env/channel/schema/config
 4. check releaseId ∉ revokedReleaseIds
 5. check free space ≥ 2 × artifactSizeBytes   (the Hub agent already does this)
 6. download to a temp path, resumable from a durable offset
 7. re-prove SHA-256 and size over the RECEIVED bytes
 8. unpack to  releases/<product>/<releaseId>.incoming/
 9. preflight  (it starts, it answers a version probe, its own manifest is present)
10. fsync, rename to  <releaseId>/
11. record `previous` = current releaseId          ← durable, BEFORE the flip
12. atomic pointer flip  (symlink to temp name, rename(2) over `current`)
13. systemctl restart <unit>
14. health gate
15. healthy → commit and record;  unhealthy → flip back, restart, mark
    failed_rolled_back, and refuse automatic retry of the SAME releaseId
```

Steps 11–15 are the shape `release-agent.ts` already implements for slots. **RECOMMENDATION: reuse that module rather than writing a second state machine.** Generalise `SlotAdapter` into an activation adapter with two implementations (pointer-flip, and A/B slot) instead of duplicating the walk. That also means Slice 1 inherits the owner-locked health gate and the one-rollback rule for free, instead of inventing weaker ones.

---

# G. System A/B OTA design

## G.1 Current status — the factual answer you asked for

**Classification: LAYOUT ONLY.**

Not "partial". Every *mechanism* exists; no KitLuy *code* touches any of it.

| Element | Status | Evidence |
| --- | --- | --- |
| A/B partitions (`boot_a`,`boot_b`,`system_a`,`system_b`,`persistent`) | **IMAGE VERIFIED** | upstream `genimage.cfg.in.erofs`; both slots are flashed with the *same* image at build time |
| Inactive slot identification | **IMAGE VERIFIED** | `/dev/disk/by-slot/{active,other}/{boot,system}`, created by udev from GPT PARTLABELs, with a static-map fallback |
| tryboot configuration | **IMAGE VERIFIED** | `autoboot.txt` generated with `tryboot_a_b=1`, `[all] boot_partition=2`, `[tryboot] boot_partition=3` |
| tryboot helper | **IMAGE VERIFIED** | `/usr/bin/rpi-slot-tryboot` prints the config fragment |
| **Writing an image to the inactive slot** | **ABSENT** | no code anywhere |
| **Invoking tryboot** | **ABSENT** | nothing calls `reboot "0 tryboot"` or the mailbox tag |
| **Boot-attempt counter** | **ABSENT — and unavailable** (see G.2) | |
| **Health confirmation** | **SOURCE IMPLEMENTED, TESTED-IN-DEV** | `resumeAfterRestart` + `createHubHealthProbe`, Hub-only, never called in production |
| **Commit** | **ABSENT** | nothing rewrites `autoboot.txt` |
| **Automatic rollback** | **partly free** (see G.2), **partly ABSENT** | |
| **Both slots updated over time** | **ABSENT** | |

The upstream layer is explicit about the boundary: *"it makes no assumptions about partitioning scheme, filesystem, encryption/device-mapper layout, or update mechanism; it simply exposes stable by-slot device links leaving policy to higher layers."* **KitLuy is that higher layer, and that layer is unwritten.**

## G.2 Rollback — the good news and the trap

**EXTERNAL RESEARCH (Raspberry Pi official documentation).** The tryboot flag is **one-shot and cleared automatically**. The documented flow: boot normally to the default partition; write the new OS to the other; `reboot "0 tryboot"` to test it once; if it validates, swap `boot_partition` in `autoboot.txt`; if not, *"partition 2 is still the default boot partition because the tryboot flag is automatically cleared."*

**This means the single most dangerous failure — a new system slot that does not boot at all — is handled by the firmware for free.** A power cycle returns to the known-good slot. No counter, no watchdog, no bootloader scripting.

**EXTERNAL RESEARCH (Bootlin, RAUC on Raspberry Pi 5) — the trap.** *"The Raspberry Pi firmware does not keep track of boot attempts. This means that there is no way for the system once booted to know whether there was an attempt to boot the other slot, and whether that attempt failed."*

So:

- **"candidate never boots"** → free rollback, but **the old slot cannot tell that an attempt happened.** The durable installation row in Hub `0039` is what makes it visible, and `resumeAfterRestart` already handles exactly this case (`booted !== row.candidate_slot` → `candidate slot did not boot`). This is a case where KitLuy's design is *ahead* of the off-the-shelf tools.
- **"candidate boots but is unhealthy"** → not free. This needs the health gate, which exists (5 min / 20 s / 3 consecutive / one rollback) and is owner-locked.
- **"candidate boots, commits, then degrades"** → not covered by tryboot at all; this is a forward-fix or an operator-initiated rollback to the previous release.

## G.3 The blocking prerequisite

Stated again because it is the one thing that would break real devices:

> **Before any A/B system update is attempted, device identity must stop being per-slot.**
>
> `/var` is bind-mounted from `/persistent/slots/system_{a,b}/var`. Under it live `identity/device-identity.key.pem`, `operational/operational-tls.key.pem`, `registration-state.json`, `pairing-state.json`, `terminal/assignment.json` and `terminal/edge-status.json`.
>
> **RECOMMENDATION:** declare the identity and credential paths slot-shared through `/etc/rpi-image-gen/slot-shared.d/*.conf`, the same mechanism already used for `/etc/ssh` and `/etc/wpa_supplicant` — whose own comments give the identical reasoning: *"If they lived per-slot, an A/B update would silently present a different identity."* Keep `installation.json` **per-slot**, because its current comment is right: a new system slot genuinely is a new installation generation.
>
> Note the known upstream hazard recorded in `kitluy-ssh-hostkeys.service`: the `slot-shared-generator` creates the `local-fs.target.wants` symlink **once, after both loops**, using the leftover variable — so with two paths declared, only the last one was actually enabled. KitLuy worked around it with its own unit. Adding a third and fourth declared path walks straight back into that bug, so the workaround has to be generalised at the same time.

## G.4 Recommended mechanism

**RECOMMENDATION** — no third-party engine. Implement a `SlotAdapter` against what the image already provides:

| Method | Implementation |
| --- | --- |
| `bootedSlot()` | read `/proc/device-tree/chosen/bootloader/partition`, or resolve `/dev/disk/by-slot/active/boot` |
| `stage(slot, releaseId)` | write the verified system image to `/dev/disk/by-slot/other/system`, and the boot payload to `…/other/boot` |
| `verifyStaged()` | re-read the written device and compare against the manifest digest — **this is where the build-time verity roothash finally earns its keep** (§I.4) |
| `restartInto(candidate)` | `systemctl reboot "0 tryboot"` (per EXTERNAL RESEARCH, `systemctl reboot` is required on Pi 5 so the parameter reaches the firmware; RAUC writes `/run/systemd/reboot-param` for the same reason) |
| commit | rewrite `boot_partition` in `autoboot.txt` on the `bootconfig` partition, fsync, then a normal reboot is no longer needed — the next boot is already correct |
| `availableDiskBytes()` | `statfs` — already sketched in `hub-agent.ts` |

---

# H. Store Hub release cache

**Your §7 proposal fits, and it is already the approved operating target — not a new idea needing approval.**

**REPOSITORY FACT** — `kitluy-release-channel-and-promotion-policy-v1.0.0.md` §9 reads:

> 1. Hub retrieves the approved manifest once. 2. Hub verifies signature, digest, channel eligibility and compatibility. 3. Hub stages release in inactive A/B slot or equivalent safe target. 4. **Hub distributes terminal packages over LAN.** 5. Health checks run after activation. 6. Failure reverts to last-known-good version. 7. Hub reports staged, active, failed, rolled-back and rejected states.

And the Hub half of it is built: `release_cache` (migration `0038`) with durable verified state, resumable offset-addressed fetch, and digest/size re-proven over downloaded bytes.

**What is missing is the LAN leg.** REPOSITORY FACT: `packages/edge-contracts` defines **no** release or artifact route. The Hub's `/edge/v1` router serves discovery, activation, pairing, heartbeats, runtime authority-time/eligibility/configuration, staff sessions, customers and booking drafts — and nothing else. A terminal cannot ask its Hub for a release today.

**RECOMMENDATION — two new `/edge/v1` routes, no more:**

```text
GET /edge/v1/releases/current        → the signed manifest + envelope for this
                                       terminal's productKey set (authorization
                                       and Store scope decided by the Hub as for
                                       every other edge route)
GET /edge/v1/releases/{id}/artifact  → the bytes, Range-capable so an
                                       interrupted download resumes
```

**Trust boundary, explicitly.** The Hub is transport and cache. The manifest travels *with* the bytes and the terminal re-verifies both independently. This is not a rule to be written — `release-manifest.ts` already guarantees it, and `loadTrustedReleaseKeys` reads each device's **own** `release_trust_key` table. The Hub literally cannot launder an artifact.

**Hub self-update source.** You are right that a Hub cannot depend on itself.

**RECOMMENDATION:** the Hub pulls its own release directly from the cloud over its existing authenticated Hub→cloud path — the same channel that already carries assignments. This is not a special case: it is the ordinary "device fetches from upstream" path, and the Hub's LAN cache is simply a *second* distribution hop that the Hub itself does not use. Do not build a second Hub for Hubs.

> **Recorded, not resolved:** the Hub→cloud authenticated bridge is part of **BLK-006** (the cloud producer side). Handoff records note the shipped gateway fails closed as a retryable 503 and that nothing in the Hub sync layer performs network I/O. So Hub self-update over the cloud path inherits BLK-006's timing. For development this is sidesteppable (§N Slice 1 uses a LAN source), and I flag it rather than resolving it.

---

# I. Security model

## I.1 There is no "Development channel" — and you do not need one

**REPOSITORY FACT.** KitLuy has **two orthogonal axes**, and your §8/§9 conflate them:

| Axis | Values | Defined in |
| --- | --- | --- |
| **Trust environment** | `development` · `pilot` · `production` | `packages/device-identity/src/environments.ts`; `release_artifacts_env_chk` |
| **Release channel** | `internal` · `pilot` · `stable` | `RELEASE_CHANNELS`; `release_channels_key_chk`; policy §1 |
| **Signing purpose** | six, incl. `release_signing` | `SIGNING_PURPOSES`, separation required by KLD-2026-07-28-002 §1/§7 |

Your fast development workflow is **`environment = development`, `channel = internal`** — not a fourth channel. Adding one would contradict the LOCKED `Internal → Pilot → Stable` decision and the no-skips promotion order in `promote_release_v1`, for no benefit.

**RECOMMENDATION: do not invent a Development channel. Use `internal` + `development`.** In the UI, label it "Development" if that reads better to operators — the stored values stay canonical.

## I.2 Why the fast path does not weaken Pilot or Production

REPOSITORY FACT, from `promote_release_v1` in migration `0180`:

- promotion to `internal` requires **no approver** and **does not call** `assert_pki_configuration_approved`;
- promotion to `pilot` or `stable` requires a **non-empty approver ref**, refuses **self-approval**, and calls `assert_pki_configuration_approved('pilot'|'production')` — the BLK-005 fail-closed gate;
- the order is exact: `signed → internal → pilot → stable`, no skips;
- `assign_release_v1` refuses `KLUY-RELEASE-WRONG-ENVIRONMENT` when the release environment does not match the target environment;
- the device-side `findReleaseAcceptanceRefusal` independently refuses `RELEASE_WRONG_ENVIRONMENT` and `RELEASE_CHANNEL_INELIGIBLE`.

So **a development artifact is refused at four independent points** before it could reach a pilot device: cloud promotion order, cloud assignment environment check, device acceptance environment check, device channel eligibility check. Your §8 requirement is already satisfied by construction.

## I.3 BLK-005 — what is and is not blocked

**REPOSITORY FACT.** BLK-005 is *not* "open and blocking everything". Its status is **DECISION VALUES RESOLVED 2026-07-28 (KLD-2026-07-28-002); IMPLEMENTATION PENDING**, and the decision explicitly records:

- **development certificate implementation: AUTHORIZED**;
- *"Development issuing keys may use a software-backed development signer, provided they are unmistakably marked non-production"*;
- STILL BLOCKED: pilot activation, production activation, and the WS-10 production signer;
- two sub-gates survive and are **not agent-closable**: §4 hardware certification pending a specific TPM 2.0 / secure-element SKU in the production BOM, and §10 KLRISK-DEVICE-002.

**Therefore:** a development `release_signing` key, software-backed and marked non-production, is within existing authority. **This assessment claims no pilot or production readiness of any kind**, and §N's plan reaches `internal`/`development` only.

## I.4 Two security findings worth recording

**Finding 1 — dm-verity is claimed but not enforced at runtime.**

REPOSITORY FACT. `infra/kitluy-os-image/README.md` describes *"A/B system slots behind dm-verity"*, and both `build-rpi-image.sh` scripts carry the comment *"the rootfs is read-only and dm-verity protected"*. The evidence does not support the second half:

- the build **does** generate a hash tree and emit `system.roothash` (`genimage.cfg.in.erofs` → `image system.verity`);
- the GPT partition table contains `system_a`/`system_b` populated from **`system.erofs`**, not from a verity-protected device;
- the boot path (`initramfs-tools/scripts/local-premount/90-rpi-ab-root` and the dracut equivalent) sets `ROOT=/dev/disk/by-slot/active/system` and does **nothing else** — no `veritysetup`, no roothash check;
- `veritysetup` occurs in the pinned upstream tree only as a **build-time** dependency and in genimage patches;
- and `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG is not set` in the device kernel, so even an enforced roothash could not be signature-checked by the kernel.

**Accurate statement: the root filesystem is read-only (EROFS by construction), A/B, and has a build-time verity hash tree available as an artifact. Runtime verity enforcement is ABSENT.** I am recording this, not fixing it; it is out of scope. It does not block anything in §N — but it means "we are protected by dm-verity" should not be said until something activates it, and the `verifyStaged()` step in §G.4 is the natural place for the roothash to start doing real work.

**Finding 2 — signing purpose is not covered by the release signature.** See §F.2 and §P-3. A key registered in `release_trust_key` is trusted for release manifests regardless of the purpose it was issued for; separation currently rests on registry discipline rather than on the signed bytes. Your §13 sentence — *"a valid cryptographic signature from the WRONG signing purpose must still be rejected"* — is **not** enforced today.

---

# J. Compatibility model

**Your §14 scenario (new Device Shell + old terminal-edge + old Hub API = broken terminal) is real, and the contract already covers most of it.**

**REPOSITORY FACT — already in the signed manifest and checked by `findReleaseAcceptanceRefusal`:**

| Guard | Field | Refusal code |
| --- | --- | --- |
| right product | `productKey` | `RELEASE_WRONG_PRODUCT` |
| right CPU | `architecture` | `RELEASE_WRONG_ARCHITECTURE` |
| right board | `hardwareProfile` | `RELEASE_WRONG_HARDWARE_PROFILE` |
| right trust environment | `environment` | `RELEASE_WRONG_ENVIRONMENT` |
| device eligible for the channel | `channel` | `RELEASE_CHANNEL_INELIGIBLE` |
| **database schema in range** | `minSchemaVersion`/`maxSchemaVersion` | `RELEASE_SCHEMA_INCOMPATIBLE` |
| **configuration new enough** | `configPrerequisiteVersion` | `RELEASE_CONFIGURATION_PREREQUISITE_MISSING` |
| bytes are the right size | `artifactSizeBytes` | `RELEASE_ARTIFACT_SIZE_MISMATCH` |

**What is missing for your scenario specifically:** the manifest bounds a release against the **schema** and the **configuration**, but not against **sibling components on the same device** or against the **Hub's edge protocol**.

**RECOMMENDATION — the minimum mechanism, not a package manager.** Two additions, no new infrastructure:

1. **Reuse `minSchemaVersion`/`maxSchemaVersion` as declared, and add one peer bound** — a `requiresEdgeProtocol` range, or (cheaper) treat the existing `configPrerequisiteVersion` as the single monotonic "platform level" that every component declares a minimum of. The second costs nothing new in the signature and no new field.
2. **Ship components in coherent sets, not individually, for anything but development.** A "platform release" that names the exact versions of Device Shell + terminal-edge + POS is one manifest with one `productKey`, and mixed versions become impossible by construction rather than by validation. For **development**, allow single-component releases — that is the whole point of the fast path — and accept that a developer can create a mismatch on their own board.

**EXTERNAL RESEARCH, worth knowing if you later pick sysext:** the `extension-release` file gives exactly this gate for free — `ID=`, `SYSEXT_LEVEL=`/`VERSION_ID=`, `ARCHITECTURE=`, and the host refuses a mismatched extension. If you ever adopt Option B, that is the compatibility mechanism, and it aligns with the model above.

**RECOMMENDATION — do not build:** dependency resolution, version ranges across arbitrary component graphs, or a transaction/solver. A monotonic platform level plus coherent sets solves your stated problem at a fraction of the cost.

---

# K. Portal / UX changes

**REPOSITORY FACT — nothing exists today.** The Management API has six modules (`fleet`, `device-approval`, `partner-authorization`, `digital-stores`, `hub-pairing-issuance`, `terminal-provisioning`) and no release route. Neither portal has an update screen. The only version surface anywhere is a read-only `imageRelease` (`image_release_ref`) on the Admin device detail. The health reporter's `HealthSummary` does carry `imageVersion` and `agentVersion` — but it writes **locally only** ("it does not open a socket"), so the cloud never learns a component version.

**RECOMMENDATION — build in this order, and not before the thing each surfaces actually exists.**

| Stage | Surface | Who | Why this order |
| --- | --- | --- | --- |
| **1 (with Slice 1)** | **No UI at all** — a repo CLI (`kitluy-release pack/sign/publish/assign`) | you, on your workstation | A development loop does not need a portal, and building one first delays the thing you actually want |
| **2 (with Slice 2)** | **Admin → device detail: installed component versions** | HET Admin | Requires the health reporter to actually report versions to the cloud — a small, independently useful change. This also finally makes the `hubPaired` rung reportable, which the Partner Portal has been rendering as *unbuildable* since 2026-09-11 |
| **3** | **Admin → Releases**: list, publish, promote (`internal` only without an approver; `pilot`/`stable` show the BLK-005 refusal as the reason, not as an error), revoke, assign to a device/campaign | **HET Admin only** | Publishing and promotion are HET-internal control-plane actions. The Admin Portal's own boundary says it is *"never exposed as a Partner, Chain, Store staff or customer application"* |
| **4** | **Admin → device: rollout status, install/rollback** | HET Admin | needs §L states to exist first |
| **5** | **Partner → Store Technology → Updates**: current version, available version, and an **[Install now]** / **[Defer until close]** choice per terminal | Partner | **Partners choose WHEN, never WHAT.** A Partner must never be able to select, promote or pin a release — that is the §16 line and it matches the existing authorization architecture, where every Partner action is re-decided server-side against Store scope |
| **6** | **Device Shell**: an "Updating… / Restarting… / Running 0.4.12" state | the person at the Pi | The Shell already renders a fail-closed state machine from a snapshot file; an update phase is one more state in `shell-state.ts`, guarded by the existing drift test |

**On your §8 "Auto-install Development Updates: ON" toggle — RECOMMENDATION: yes, but scope it to the device, not the user.** Make it a property of a device whose `environment` is `development`, settable by Admin. A device in `pilot` or `production` should not have the toggle at all, so there is no control to mis-set. That keeps the convenience out of the production code path entirely rather than guarding it with a flag.

---

# L. Failure matrix

Statuses below are **target behaviour under the proposed architecture** unless marked *(today)*. "Audit" names the durable record.

| # | Scenario | What should happen | What remains usable | Rollback | User-visible state | Audit/evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Download interrupted | resume from durable offset; never restart from zero | everything — the running version is untouched | none needed | "Downloading — paused" | `release_cache.state='downloading'` + offset |
| 2 | WAN disappears | Hub keeps serving from cache; terminal continues | full Store operation (the Hub is the authority offline by design) | none | "Update deferred — no connection" | installation row unchanged |
| 3 | Terminal reaches Hub, not Cloud | **normal case, not a failure** — Hub serves the cached artifact and manifest | everything | none | silent | Hub records the LAN fetch |
| 4 | Hub reaches Cloud, terminal cannot | Hub caches; terminal picks up on its next LAN poll | everything | none | "Update available" | cache `cached`, terminal `assigned` |
| 5 | Signature invalid | refuse **before any artifact byte**; durable rejection, final by trigger | everything | n/a — nothing was staged | "Update rejected" + reason | `release_cache.state='rejected'`, code `SIGNATURE_INVALID` |
| 6 | **Signed by wrong-purpose key** | **must refuse** | everything | n/a | "Update rejected" | **NOT ENFORCED TODAY — see §I.4 Finding 2 and §P-3** |
| 7 | Checksum mismatch | refuse after re-proving over received bytes; discard | everything | n/a | "Update rejected" | rejection + code |
| 8 | Disk full | refuse **before** touching the active version; the Hub agent already requires `free ≥ 2 × artifactSize` | everything | n/a | "Not enough space" | `INSUFFICIENT_DISK` |
| 9 | Power dies during download | temp file discarded or resumed; nothing activated | everything | none | resumes | durable offset |
| 10 | Power dies during install | `.incoming` directory is never the pointer target; an unfinished unpack is discarded on next boot | everything | automatic (pointer never moved) | resumes or restarts | state persisted before each visible step |
| 11 | **Power dies during A/B slot write** | candidate slot is invalid, but **`autoboot.txt` still names the old slot** and tryboot was never set | everything, on the old slot | automatic and free | "Update failed, retrying" | installation row still `staged` |
| 12 | New application crashes immediately | health gate fails; flip pointer back; restart; mark `failed_rolled_back`; refuse automatic retry of the same release | previous version, within the gate window | automatic, one only | "Update failed — previous version restored" | `failure_reason` + `INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK` |
| 13 | **New system slot does not boot** | tryboot is one-shot and self-clearing → the next power cycle returns to the old slot | everything, on the old slot | **automatic, by firmware** | "Update failed" once the old slot reports | `resumeAfterRestart` sees `booted ≠ candidate` → `candidate slot did not boot` |
| 14 | Health never becomes healthy | window expires (5 min); the one automatic rollback fires | previous version | automatic, one only | "Update failed — reverted" | `state='failed_rolled_back'`, reason recorded |
| 15 | Device reboots repeatedly | tryboot cannot persist, so reboots land on the committed slot; repeated app crashes hit the one-rollback ceiling and stop | previous version; the device stays enrolled and reachable | after one attempt, no further automatic retry | "Update blocked — needs attention" | terminal state; operator action required |
| 16 | User power-cycles mid-update | identical to 9/10/11 by construction — every externally visible step is preceded by a durable write | everything | automatic | resumes | durable state is the only source on resume |
| 17 | Hub offers an older release than the terminal has | **the terminal must refuse a downgrade unless the release is explicitly marked a rollback target.** `rollbackReleaseId` exists for exactly this. | everything | n/a | silent | refusal recorded |
| 18 | Wrong vertical application offered | `RELEASE_WRONG_PRODUCT` (and `RELEASE_WRONG_HARDWARE_PROFILE` where the board differs) | everything | n/a | "Update rejected" | acceptance refusal code |
| 19 | **Development artifact offered to a Pilot device** | refused at **four** independent points (§I.2) | everything | n/a | "Update rejected" | `RELEASE_WRONG_ENVIRONMENT` on device; `KLUY-RELEASE-WRONG-ENVIRONMENT` in cloud |
| 20 | Update requires an incompatible Hub | `RELEASE_SCHEMA_INCOMPATIBLE` / configuration prerequisite refusal — **this is the §14 gap; today only schema and config are bounded** | everything | n/a | "Update not applicable yet" | refusal code |
| 21 | **Four terminals would all go down at once** | **not solved by anything today.** Needs a Store-level rollout policy — see the staging note below | — | — | — | — |
| 22 | Rollback artifact no longer trusted | **the install must be refused before it starts.** `beginInstallation` already refuses `ROLLBACK_ARTIFACT_UNAVAILABLE` when the rollback release is not `cached` | everything | n/a — never started | "Update blocked — no safe rollback" | refusal code |
| 23 | Device offline for weeks, then reconnects | it re-evaluates from durable state, sees the *current* assignment (not a queue of stale ones), and refuses any release now revoked | everything | n/a | "Updating to latest" | `revokedReleaseIds` consulted at install time |

**Scenario 21 — what is needed when.**

| Now, for development | Before Pilot | Before Production |
| --- | --- | --- |
| **Nothing.** One dev Hub, one dev terminal. Update whatever you like, whenever. | **Serialise per Store**: never update two terminals concurrently; require the previous one healthy first. Plus a "Store closed" or Partner-deferred window. | Cohort/canary expansion with automatic pause on health-gate failure (policy §8 already specifies this), mandatory-minimum-version enforcement, and emergency release handling (policy §12). |

**RECOMMENDATION: do not build Pilot or Production orchestration now.** Your §15 instinct is right. The *only* thing worth doing early is making the per-Store serialisation **possible** — i.e. do not design the device-side runtime in a way that assumes it is the only device. Concretely: put the "may I install now?" decision behind a Hub-answered predicate from day one, even if in development that predicate always returns yes. Retrofitting that later is the expensive version.

---

# M. Build-vs-buy — technology research

Each candidate is judged against **what KitLuy has already built**, not against a greenfield project. That matters enormously here, because KitLuy has already paid for the expensive half.

| Candidate | What it solves | ARM64 / Raspberry Pi | Immutable + A/B | Signing | Rollback | Integration cost | Fit with KitLuy | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **RAUC** (LGPL-2.1) | Full A/B system update engine: bundle format, slot handling, bootloader backends, D-Bus service | **EXTERNAL RESEARCH:** no official Raspberry Pi firmware backend; needs a custom backend implementing `get-primary`/`set-primary`/`get-state`/`set-state` against `autoboot.txt` and the tryboot mailbox tag. A community backend and an open PR exist. | yes | **enforces signature verification unconditionally** (one of only two that do) — but **X.509/CMS**, not KitLuy's Ed25519 manifest | yes, slot-level | **high**: a second bundle format, a second signing hierarchy, a second trust store, plus a custom Pi backend you would own anyway | **Poor.** You would run two artifact formats and two trust models side by side, or discard the one you have already tested. RAUC's strongest selling point (mandatory signature verification) is something KitLuy already does — with a verifier that additionally matches key **version**, refuses `revoked`, and guards separator injection. | **Not recommended** |
| **SWUpdate** (GPL-2.0) | Framework with a handler pipeline; maximum flexibility | works, via `meta-swupdate-boards`; Yocto-oriented | yes | configurable, **not on by default** | yes | **high**, and Yocto-shaped — KitLuy builds with `rpi-image-gen` + `bdebstrap`, not Yocto | **Poor.** *"SWUpdate does not step in and handle system setup details… you work out the low-level A/B implementation yourself."* That is precisely the part KitLuy must write regardless. You would take on a framework and still write the adapter. | **Not recommended** |
| **Mender** (Apache-2.0 + commercial) | End-to-end: client, server, deployment management, UI | yes | yes | yes | yes | **very high**, and it brings its **own server and fleet model** | **Very poor.** KitLuy already has the fleet authority, device identity, Tenant/Store/Location scoping, RBAC, audit and four-eyes. Mender would duplicate or fight all of it. Delta updates are Enterprise-licensed. | **Not recommended** |
| **OSTree** (LGPL-2.0+) | Git-like versioned filesystem trees; atomic deploy + rollback on one partition | yes | A/B-*like* via dual deployments on one partition | via ostree signing | yes | **high**, and it replaces the image model | **Poor fit, one idea worth stealing.** Its deployment/rollback model is close to §F.1 Option A, and its content-addressed store is elegant. But adopting it means abandoning `rpi-image-gen`'s EROFS A/B layout you have already proven on hardware. | **Not recommended** — borrow the *pattern*, not the tool |
| **Rugix Ctrl** (MIT/Apache-2.0) | A/B update engine | **EXTERNAL RESEARCH: the only surveyed tool with built-in Raspberry Pi tryboot support**, and it explicitly supports read-only root with ephemeral runtime writes | yes | enforced | yes | **medium** | **The closest fit of any off-the-shelf option**, and the only one that would genuinely save you the tryboot adapter work. Still brings its own bundle format and trust model, and it is the youngest and least widely deployed of the five. | **Worth a look for class C only** — see recommendation below |
| **TUF / Uptane** | Metadata *framework* for repository compromise resistance: role separation, key rotation, freeze/rollback attack protection | n/a (metadata layer) | n/a | yes — this is its subject | protects *against* rollback attacks | medium–high | **Not a replacement — a checklist.** KitLuy's manifest already does key-id+version matching, revocation and a rollback target. What TUF would add: explicit freeze-attack protection (an expiry on the *assignment*, not just the certificate) and formal key-rotation roles. | **Not recommended as a dependency; recommended as a review lens** |
| **systemd-sysext** | Signed, image-based extension of `/usr` and `/opt` on a read-only root | **already present in the built image** (systemd 252.39) | complements A/B | verity + signature — **but requires `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG`, which the Pi kernel does not set** | n/a (you unmerge) | **low** | **The best technical fit for class A/B packaging**, and free. Its signature enforcement is unavailable to you, so trust stays with KitLuy's verifier either way. | **Recommended as a future packaging format; not needed for Slice 1** |
| **electron-updater / Electron `autoUpdater`** | In-app self-update for desktop Electron apps | **EXTERNAL RESEARCH: Linux support is essentially AppImage-only**; electron-builder's scheme is incompatible with standard AppImage update tools | n/a | its own | limited | medium | **Wrong model entirely.** The Device Shell is a systemd-managed kiosk on a read-only appliance, not a user-installed desktop app. It must not update itself; it must be *replaced* by the platform and restarted. | **Not recommended — actively avoid** |

## M.1 Verdict

**RECOMMENDATION: build, do not buy — with one narrow exception to revisit later.**

The reasoning is not "not invented here". It is that **the buy decision is normally justified by the cost of getting signing, atomicity and rollback right, and KitLuy has already paid that cost and has the tests to show it.** What remains — write a slot, set a flag, flip a symlink, restart a unit — is the cheap part, and it is the part every one of these tools would still require you to adapt to the Raspberry Pi firmware.

Concretely:

- **Classes A and B (application, runtime): build.** No tool on the list targets this well, the artifact contract exists, and the total new code is small.
- **Class C (system A/B): build the adapter** against `rpi-slot-tryboot` and `autoboot.txt`. It is roughly five functions, and the Bootlin RAUC write-up is an excellent map of the traps.
- **The one exception:** if class C turns out to be materially harder than §G.4 estimates — particularly around `cmdline.txt` per-slot maintenance, which the Bootlin work flags as a real hazard — **re-evaluate Rugix Ctrl for class C only**, because it is the single tool with native tryboot support. Keep KitLuy's manifest as the trust authority above it either way.
- **Use TUF/Uptane as a review checklist** before Pilot, not as a dependency. The one gap it would flag today is **freeze protection**: nothing currently expires an *assignment*, so a device kept offline could in principle be held on a stale release indefinitely without anything noticing.

---

# N. Smallest implementation plan

**Constraint honoured: no six-month update-platform detour.** Each slice is independently useful and independently abandonable. Slices 2 and 3 reuse Slice 1's artifact contract, verifier, store and state machine — no second architecture, and no throwaway development path.

## Slice 1 — a Device Shell version reaches a development Pi Terminal, no SD card

**Outcome.** You change the Device Shell, run one command, and within a minute the running Pi shows the new version — verified, atomically switched, and revertible.

| | |
| --- | --- |
| **Existing components reused** | `release-manifest.ts` (verifier + acceptance gate, unchanged) · `kitluy_releases` doors `0180` (unchanged) · `release-agent.ts` state machine and health gate (generalised, not rewritten) · `update-bootstrap.ts` (grown, keeping its fail-closed posture and its name) · `package-bootstrap-runtime.sh` packaging discipline · `/etc/kitluy/image.env` as the acceptance context |
| **New components** | (1) a **slot-shared release store** declared in `slot-shared.d`, plus the generalised fix for the known upstream `.wants` symlink bug; (2) a **pointer-flip activation adapter** implementing the generalised `SlotAdapter`; (3) the **device update runtime** — poll, verify, download, re-prove, unpack, preflight, flip, restart, health-gate, roll back; (4) a **`kitluy-release` CLI** — pack, sign (development key), publish, assign; (5) a **development artifact source** on the LAN; (6) `kitluy-device-shell.service` `ExecStart` repointed at the store's `current` |
| **Tests** | manifest verification already covered · new: acceptance gate against a **real** `image.env` · atomic-flip under simulated power loss (kill between every pair of steps; assert the pointer is always valid) · disk-full refusal · resume-from-offset · a tampered byte is caught by the re-proof · rollback restores the exact previous release · the same release is refused after `failed_rolled_back` |
| **Hardware acceptance** | on the real Pi Terminal: install 0.4.11 → install 0.4.12 → confirm on the touchscreen → confirm the terminal is **still paired and serving** (its identity was untouched) → `SERVING` still reported |
| **Rollback test** | publish a deliberately broken 0.4.13; confirm the health gate fails, 0.4.12 returns automatically, the terminal is usable, and the same release is refused on retry |
| **Security gate** | `pnpm secret:scan` · no signing key on any device (public trust material only) · `environment=development` + `channel=internal` only · both promotion calls asserted to refuse `pilot`/`stable` without an approver and without the PKI configuration |
| **What becomes faster** | **every Device Shell change.** Cross-build, card write, physical handling, reboot and re-enrolment all disappear from the loop. |

> **Note on trust material.** Slice 1 requires populating `/etc/kitluy/trust` — today an **empty directory** on the terminal image and **absent entirely** on the Hub image. That is an image change, so Slice 1 costs you **one** final reflash of each dev board. Worth saying out loud: the last reflash is the price of the first non-reflash.

## Slice 2 — the same mechanism carries device runtime/services

**Outcome.** `terminal-edge`, `health-reporter` and `hub-agent` update the same way. **Gated on owner decision §P-2.**

| | |
| --- | --- |
| **Reused** | everything from Slice 1, unchanged |
| **New** | per-unit activation (stop → flip → start, with unit-specific preflight) · component version reporting from the health reporter to the cloud (which also makes the Partner Portal's `hubPaired` rung reportable at last) · the **"may I install now?"** predicate, answered by the Hub — always yes in development, but present from day one |
| **Tests** | terminal-edge updates and **re-establishes its Hub session** afterwards · a failed runtime update rolls back and the terminal still reaches its Hub · the bootstrap set stays image-only (asserted, per whatever the owner rules) |
| **Hardware acceptance** | change a line in `terminal-edge`, publish, observe the Pi reconnect to its Hub on the new version, `SERVING`, no reflash |
| **Rollback test** | publish a `terminal-edge` that cannot reach the Hub; confirm automatic revert and that the terminal is serving again |
| **What becomes faster** | the edge/transport work that has dominated 2026-09 |

## Slice 3 — the Store Hub distributes to terminals over the LAN

**Outcome.** One WAN download per Store; terminals fetch from the Hub.

| | |
| --- | --- |
| **Reused** | `release-cache.ts` (already built and tested — this is the slice that finally calls it) · the Hub's existing mTLS `/edge/v1` transport and authorization |
| **New** | two `/edge/v1` routes (§H) · terminal-side "prefer Hub, fall back to cloud" source selection · Hub-side rollout serialisation behind the Slice 2 predicate |
| **Tests** | a terminal with **no** WAN route updates successfully from its Hub · a Hub-served artifact with a tampered manifest is refused **by the terminal** · Range-resume across a dropped LAN connection |
| **Hardware acceptance** | unplug the terminal's WAN path; update it anyway |
| **Security gate** | assert the terminal verifies independently — the Hub cannot launder an unsigned artifact (already guaranteed by construction; the test records it) |
| **What becomes faster** | multi-terminal work, and every future Store rollout |

## Slice 4 — A/B system OTA

**Outcome.** Kernel, Debian packages, systemd units and `/usr` update without a card.

| | |
| --- | --- |
| **Prerequisite, non-negotiable** | **§G.3 — device identity must become slot-shared first**, with its own hardware test proving a slot switch preserves identity, certificate, registration and pairing |
| **Reused** | `release-agent.ts` in its original slot form · the owner-locked health gate · the whole manifest contract |
| **New** | the real `SlotAdapter` (§G.4) · system-image artifact packaging · `autoboot.txt` commit on the bootconfig partition · per-slot `cmdline.txt` handling |
| **Tests** | write-to-inactive-slot is idempotent · a corrupt staged slot is caught by `verifyStaged` before tryboot · commit is atomic across power loss |
| **Hardware acceptance** | A → B → confirm identity, certificate, pairing and `SERVING` all survive → B → A |
| **Rollback test** | stage a deliberately unbootable slot; confirm the **firmware** returns to the old slot on power cycle, and that the old slot records `candidate slot did not boot` |
| **What becomes faster** | OS-level work; and this is the slice that makes a real fleet maintainable |

**Sequencing note.** Slices 1–3 are independent of BLK-005 and of the A/B identity problem. Slice 4 is not. **Do not let Slice 4's prerequisite delay Slice 1** — it is the slice that gives you back your day.

---

# O. Reflash matrix

**Today** = current repository state. **After** = after all four slices in §N.

| Change | OTA? (after) | Restart? | Reboot? | Full image build? | Physical reflash today | Physical reflash after |
| --- | --- | --- | --- | --- | --- | --- |
| Device Shell CSS / copy | **yes** (class A) | app only | no | no | **YES** | **no** |
| Device Shell React / Electron main code | **yes** (class A) | app only | no | no | **YES** | **no** |
| Laundry POS / any vertical module | **yes** (class A) | app only | no | no | n/a — never shipped | **no** |
| `terminal-edge` service | **yes** (class B)¹ | service only | no | no | **YES** | **no**¹ |
| `hub-agent` service | **yes** (class B)¹ | service only | no | no | **YES** | **no**¹ |
| `health-reporter`, `cloud-registration`, firstboot lib | **yes** (class B)¹ | service only | no | no | **YES** | **no**¹ |
| `update-agent` itself | **partly** — the classic bootstrap problem; treat as class C or accept a self-update with a known-good fallback | — | yes | yes | **YES** | **rare** |
| **Electron runtime** (the binary, not the app) | **yes** (class C — it lives in `/usr/lib/kitluy/electron` on the read-only root) | — | **yes** | yes | **YES** | **no** |
| systemd unit file | **yes** (class C) | — | **yes** | yes | **YES** | **no** |
| Debian package / system library | **yes** (class C) | — | **yes** | yes | **YES** | **no** |
| Kernel | **yes** (class C — kernel lives in the per-slot boot partition) | — | **yes** | yes | **YES** | **no** |
| `/etc/kitluy/image.env` values (registration URL, hardware profile key, environment) | **yes** (class C — baked into the read-only rootfs; **cannot be corrected on the card**) | — | **yes** | yes | **YES** | **no** |
| Trust anchors in `/etc/kitluy/trust` | **yes** (class C, or a governed configuration delivery) | — | yes | yes | **YES** | **no** |
| `slot-shared.d` declarations | class C, but **must be applied before it can help** | — | yes | yes | **YES** | **yes, the first time** |
| Bootloader / EEPROM | **no** | — | yes | — | **YES** | **YES** |
| `autoboot.txt` structure / bootconfig partition | **no** | — | yes | yes | **YES** | **YES** |
| Partition table, partition sizes | **no** | — | — | yes | **YES** | **YES** |
| LUKS2 layout on the Hub NVMe | **no** | — | — | yes | **YES** | **YES** |
| dm-verity enforcement (if it is ever turned on) | class C, but it changes the boot path | — | yes | yes | **YES** | **yes, the first time** |
| Factory Enrollment behaviour | **yes** for the code (class B¹); **no** for testing it | — | — | — | **YES** | **only to test a blank device** |
| Clean-slate / first-manufacturing / disaster recovery | **no, by definition** | — | — | yes | **YES** | **YES** |

¹ Subject to owner decision **§P-2**. If the bootstrap boundary stays exactly as `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` §4.2 currently defines it, every row marked ¹ remains **reflash-required**, and your day-to-day speed-up is limited to the Device Shell and the POS application.

**That is why §P-2 is the decision that determines how much of your time this actually gives back.**

---

# P. Owner decisions needed

Only genuine decisions are listed. Implementation details engineering can settle are deliberately excluded.

---

## P-1 — Where does an application release install, on a read-only root?

**Plain language.** Every KitLuy program runs from `/usr/lib/kitluy/`, which is on a read-only filesystem. An update cannot write there. The POS unit already in the image says a release package "installs `/usr/lib/kitluy/terminal-client`" — which cannot happen. Something has to give.

**Options**

| | Option | Consequence |
| --- | --- | --- |
| **A** | Versioned release store on a **slot-shared persistent** path, with an atomic `current` pointer; unit `ExecStart` points there | Programs run from a writable partition. Simple, fast, reversible, no kernel features. |
| **B** | `systemd-sysext` — signed extension images overlaid onto `/usr` | `/usr` stays canonical. But the kernel cannot enforce verity signatures (`CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG` unset), so trust still rests on KitLuy's own verifier, and `refresh` disturbs everything running from `/usr`. |
| **C** | Applications only ever ship inside a full system slot (class C) | Maximum purity; **every** application change costs a reboot and a full image build. This is close to today, and does not solve your problem. |

**My recommendation: A now, with the artifact designed so B remains available later.** The kernel finding removes B's security advantage, and A is the only option that delivers a sub-minute development loop.

**Blocks Development: YES — this is the gate on everything in §N.** Blocks Pilot: no. Blocks Production: no.

---

## P-2 — Is `terminal-edge` (and the Device Shell) bootstrap, or application?

**Plain language.** `KLD-2026-08-11-DEVICE-BOOTSTRAP-RUNTIME-001` §4.2 says **"bootstrap-agent changes ride an image rebuild; application changes must not."** Its reasoning is sound: an updater cannot deliver itself. But two components are unclassified because they were built after that decision — `terminal-edge` (2026-09-10) and the graphical **Device Shell** (2026-09-04, which replaced `terminal-bootstrap-ui`, a component the decision *does* list as bootstrap).

**Options**

| | Option | Consequence |
| --- | --- | --- |
| **A** | Keep the boundary exactly as written | `terminal-edge`, `health-reporter`, `cloud-registration` and the Device Shell all keep requiring a reflash. Your speed-up shrinks to the POS application — which does not exist yet. **This would make §N Slice 1 nearly pointless.** |
| **B** | Narrow the bootstrap set to **only** what is needed to obtain and verify an update — identity, registration, the update runtime and its trust material — and classify everything else, including `terminal-edge` and the Device Shell, as governed releases | Preserves the bootstrap-ordering logic exactly (the narrowed set still cannot depend on itself), and unlocks the components you actually change. |
| **C** | Case by case, per component, recorded each time | Flexible, but invites drift and re-litigation. |

**My recommendation: B.** It keeps the decision's *reason* intact while fixing its *scope*, which has been overtaken by two components that did not exist when it was written. Note that a device would then still always be able to register and update itself even if every governed release on it were broken — which is the property §4.2 was actually protecting.

**Blocks Development: YES, for everything except the Device Shell and POS.** Blocks Pilot: no. Blocks Production: no.

---

## P-3 — Must the release signature be bound to the `release_signing` purpose?

**Plain language.** You wrote: *"a valid cryptographic signature from the WRONG signing purpose must still be rejected."* Today it is not. KitLuy defines six separate signing purposes and requires them kept separate (KLD-2026-07-28-002 §1/§7) — but the release manifest body does not carry a purpose, and the verifier does not check one. Separation currently rests on nothing but discipline in which keys get registered in `release_trust_key`.

**Options**

| | Option | Consequence |
| --- | --- | --- |
| **A** | Leave it; rely on registry discipline | Zero work. A key registered by mistake is silently trusted for releases. |
| **B** | Add a `signingPurpose` column to `release_trust_key` and refuse a key whose purpose is not `release_signing` | Cheap, no change to the signed bytes, no manifest version bump. Catches the registration mistake. Does **not** bind the purpose cryptographically. |
| **C** | Add `signingPurpose` to the signed manifest body (manifest **v2**) | Cryptographically binding, and the strongest answer to your own requirement. Costs a manifest version bump and a verifier that accepts v1 and v2 during transition. |

**My recommendation: B now, C before Pilot.** B removes the realistic failure (a mis-registered key) immediately and cheaply. C is the correct end state but a manifest version bump is not worth doing twice, and it should land alongside whatever else Pilot requires.

**Blocks Development: no.** Blocks Pilot: **arguably yes** — this is exactly the kind of separation a Pilot security review will ask about. Blocks Production: **yes**.

---

## P-4 — Who may publish, and who may promote?

**Plain language.** The machinery exists but has no operator. Someone must be named.

Repository evidence already constrains this: RBAC keys `releases.promote_internal` / `_pilot` / `_stable` exist; `promote_release_v1` refuses self-approval and demands an independent approver for Pilot and Stable; the Admin Portal's boundary is *"never exposed as a Partner, Chain, Store staff or customer application"*; and policy §2 names the approver per channel. The **[REQUIRED: channel approvers and permissions]** value in the policy document has never been filled in.

**Options**

| | Option |
| --- | --- |
| **A** | HET engineering publishes and promotes to **Internal**; a named HET approver for Pilot; a second, different named approver for Stable. Partners choose only **when** an approved update installs, never **what**. |
| **B** | As A, but Partners may also defer indefinitely |
| **C** | As A, plus a mandatory-minimum-version that overrides deferral for security releases |

**My recommendation: A now, C before Production.** Unlimited deferral (B) eventually produces a fleet you cannot support. But the mandatory-minimum mechanism is not worth building before there is a fleet.

**Blocks Development: no** — in development you are all four roles, and `internal` promotion needs no approver. Blocks Pilot: **YES** — the `[REQUIRED]` value must be filled. Blocks Production: **YES**.

---

## P-5 — Should development devices auto-install?

**Plain language.** Your §8 asked for an "Auto-install Development Updates: ON" toggle.

**Options**

| | Option |
| --- | --- |
| **A** | Auto-install available **only** on devices whose `environment` is `development`; no such control exists on pilot/production devices at all |
| **B** | Auto-install available everywhere, off by default |
| **C** | Always manual, even in development |

**My recommendation: A.** It keeps the convenience out of the production code path entirely, rather than guarding it with a flag that could be mis-set — the same posture the repository already takes with `KITLUY_ENVIRONMENT` being deliberately empty rather than defaulting to `development`. C would make your fast loop slower for no security gain, since you control the development signing key anyway.

**Blocks Development: no** (manual install is fine for Slice 1; the toggle is a convenience). Blocks Pilot: no. Blocks Production: no.

---

## Not asked, deliberately

These are engineering's to settle and do **not** need you: poll interval, artifact compression, on-disk layout inside the release store, CLI flag names, how many releases to retain, health-probe implementation details, and whether the development artifact source is a static file server or the Hub.

---

# Appendix — evidence index

Everything material in this assessment, with where to check it.

| Claim | Source |
| --- | --- |
| update-agent is a 91-line status logger | `services/kitluy-device-firstboot-agent/src/bin/update-bootstrap.ts` |
| release/update service is SCAFFOLDED (91 lines total) | `services/kitluy-device-release-and-update-service/src/` |
| Hub release agent, health gate, one-rollback | `services/kitluy-hub-agent/src/hub/release-agent.ts` (449 lines) |
| Verified artifact cache | `services/kitluy-hub-agent/src/hub/release-cache.ts` (299 lines) |
| Signed manifest contract + verifier + acceptance gate | `packages/device-identity/src/release-manifest.ts` (241 lines) |
| Environments and six signing purposes | `packages/device-identity/src/environments.ts` |
| Cloud release authority | `supabase/migrations/20260806140000_0180_release_authority.sql` |
| `internal` promotion needs no approver and no PKI gate | same file, `promote_release_v1` |
| Hub release tables present in the Hub image | `…/usr/lib/kitluy/hub-migrations/0038…,0039…` |
| Only callers are tests | `grep` for `beginInstallation`/`applyReleaseAssignment`/`sign_release_v1` — all hits are `test/` or `supabase/tests/` |
| Only `SlotAdapter` implementation is `FakeDevice` | `services/kitluy-hub-agent/test/release-agent.integration.test.ts:68` |
| Hub agent never imports the release modules | `services/kitluy-hub-agent/src/bin/hub-agent.ts` |
| Every component runs from `/usr/lib/kitluy/…` | `ExecStart=` in every unit in both `rootfs-overlay` trees |
| Root is EROFS, A/B, `tryboot_a_b=1` | upstream `image/gpt/ab_userdata/{image.yaml,pre-image.sh,genimage.cfg.in.erofs}` |
| Both slots flashed with the same image | same `genimage.cfg.in.erofs` |
| Verity hash built but **not enforced at boot** | `pre-image.sh` (roothash emitted) vs `layer/rpi/device/slot-mapper/initramfs-tools/scripts/local-premount/90-rpi-ab-root` (plain `ROOT=`) |
| `CONFIG_DM_VERITY_VERIFY_ROOTHASH_SIG is not set` | `build/work/chroot-v2.7.0/filesystem/boot/config-6.12.96+rpt-rpi-2712` |
| `systemd-sysext` present, systemd 252.39 | `…/filesystem/usr/bin/systemd-sysext`; `usr/share/doc/systemd/changelog.Debian.gz` |
| `/var` is per-slot; identity lives there | upstream `pre-image.sh` (`/persistent/slots/system_{a,b}/var`); `installation.js` header; `/var/lib/kitluy/identity/...` |
| slot-shared mechanism and its known `.wants` bug | `etc/rpi-image-gen/slot-shared.d/*.conf`; `kitluy-ssh-hostkeys.service` |
| Trust dir empty / absent | `…/kitluy-base.rootfs-overlay/etc/kitluy/trust/` (empty); Hub overlay has none |
| No LAN release route | `packages/edge-contracts/src/registry.ts`; `hub/edge/routes.ts` `matchRoute` |
| No release route in Management API or portals | `services/kitluy-management-api/src/`; both portal `src/` trees |
| Hub-distributes-to-terminals is approved policy | `docs/source/infrastructure/kitluy-release-channel-and-promotion-policy-v1.0.0.md` §9 |
| Bootstrap/release boundary, §4.2 | `docs/decisions/kitluy-device-bootstrap-runtime-and-release-boundary-owner-decision-v1.0.0.md` |
| BLK-005 development signing authorized | `00_AI_HANDOFF/000_BLOCKERS.md` BLK-005 row; `docs/decisions/kitluy-blk-005-pki-and-device-trust-owner-decision-v1.0.0.md` §1–§4 |

**External sources**

- [Raspberry Pi — config.txt / autoboot.txt and tryboot](https://www.raspberrypi.com/documentation/computers/config_txt.html)
- [Bootlin — Safe updates using RAUC on Raspberry Pi 5](https://bootlin.com/blog/safe-updates-using-rauc-on-raspberry-pi-5/)
- [Rugix — Comparing open-source OTA update engines (2026)](https://rugix.org/blog/2026-02-28-ota-update-engines-compared/)
- [systemd-sysext(8) manual page](https://man7.org/linux/man-pages/man8/systemd-sysext.8.html)
- [Rtone — Raspberry Pi firmware RAUC bootloader backend](https://github.com/Rtone/raspberrypi-firmware-rauc-bootloader-backend)
- [electron-builder — Linux auto-update support](https://github.com/electron-userland/electron-builder/issues/6330)

---

## Stop condition

This is analysis and research only. **Nothing was implemented, no code, migration, image or documentation was changed, no GAP ID was created, nothing was committed or pushed, and no owner decision was made.** The five decisions in §P are yours.

**`pnpm verify` was not run**, because nothing in the repository was modified except the addition of this file.

**Recommended next step:** rule on **P-1** and **P-2**. Those two together determine whether §N Slice 1 is worth building and how much of your week it gives back. The other three can follow.
