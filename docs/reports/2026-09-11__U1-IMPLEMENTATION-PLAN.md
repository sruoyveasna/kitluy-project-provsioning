# U1 — implementation plan, under owner rulings of 2026-09-11

| Field        | Value                                                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date         | 2026-09-11 · Asia/Phnom_Penh                                                                                                                                                                             |
| Repository   | `het-kitluy-project` @ `bde3490` + uncommitted tree on `claude/fix-firstboot-esm-and-ssh-hostkeys`                                                                                                       |
| Type         | **IMPLEMENTATION PLAN — NOT IMPLEMENTATION.** No code, migration, image or documentation changed this turn. Nothing committed or pushed.                                                                 |
| Authorises   | Nothing on its own. This is the plan the owner asked for before build begins.                                                                                                                            |
| Predecessors | [`…FEASIBILITY-ASSESSMENT.md`](2026-09-11__DEVICE-UPDATE-WORKFLOW-FEASIBILITY-ASSESSMENT.md) · [`…U1-DEVICE-SHELL-DEVELOPMENT-OTA-PROPOSAL.md`](2026-09-11__U1-DEVICE-SHELL-DEVELOPMENT-OTA-PROPOSAL.md) |

## Rulings recorded

| ID              | Ruling                                                                                                                                                                                                                                                                                           | Effect on this plan                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **OD-U1-1 = A** | Device Shell application payload may execute from the governed slot-shared persistent release store. Immutable image copy remains the fallback. `/usr` stays read-only; EROFS/dm-verity not weakened.                                                                                            | §3 store design proceeds. No `/usr` write, no overlayfs, no sysext, no EROFS or verity change anywhere in U1.  |
| **OD-U1-2 = C** | **For U1 only**, the graphical Device Shell application payload is a governed updatable application. Not to be used to reclassify `terminal-edge`, firstboot identity, cloud registration, `update-agent` or any other bootstrap/runtime component. Broader boundary returns to the owner at U3. | §9 scope fence. Exactly one product key is updatable in U1. The fence is enforced by a test, not by intention. |
| **OD-U1-3 = A** | Keep the owner-locked health-gate timings. No development-specific timing behaviour.                                                                                                                                                                                                             | 20 s probes, 3 consecutive, 5-minute window, one automatic rollback. One code path, no environment branch.     |

## The four additional requirements, and what each changes

| #     | Requirement                                                                                                                                                                                                       | Status against the proposal                                                                                                                                                                                 | Change                                                                                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | Release **assignment** determines what a Terminal may install. Artifact storage/source transports bytes only and is not deployment authority.                                                                     | **The proposal was wrong here.** Piece 7 was "a static signed-artifact server on your workstation LAN" — a file server that offers releases _is_ acting as deployment authority, which this ruling forbids. | **Redesigned.** Two separate sources with different trust weight (§2). The device asks a governed authority "what am I assigned?", learns the release id and digest **first**, and only then fetches bytes. A byte source cannot offer it anything else, because the device already knows what it is looking for. |
| **2** | Prevent arbitrary signed downgrade. Normal activation corresponds to the governed assigned release. Rollback is an explicit controlled recovery path.                                                             | Partially covered (the acceptance gate) but **downgrade was not addressed at all**.                                                                                                                         | **Added** (§4): install-what-is-assigned as the only normal path, a monotonic assignment sequence that refuses replay of a stale assignment, and rollback as a distinct local operation that never fetches.                                                                                                       |
| **3** | Activation metadata durable across **real power loss**, not merely atomic in-process. Sync/durability behaviour in implementation **and tests**.                                                                  | The proposal said "atomic" and named `rename(2)`. That is **not sufficient** — a rename is atomic but is not durable until the containing directory is fsynced.                                             | **Redesigned** (§5): an explicit intent-then-act journal with fsync ordering, boot-time reconciliation, and a shared durable-write module. Power-loss is now a test class, not a sentence.                                                                                                                        |
| **4** | Hardware acceptance must prove A (A→B OTA), B (unhealthy C → automatic rollback), **C (real power interruption leaves a bootable valid release)**, **D (tampered artifact refused while current keeps running)**. | A and B were planned. **C and D were not.**                                                                                                                                                                 | **Added** (§8) with an actual bench procedure for each, including where to pull power and how many times.                                                                                                                                                                                                         |

---

# 1. What U1 delivers

One sentence: **you change the Device Shell, run one command, and your existing Pi Terminal is running it about a minute later — assigned by governed authority, signature- and digest-verified, atomically and durably activated, automatically rolled back if unhealthy, and reported without SSH — with no SD card touched and the terminal still enrolled, paired and `SERVING`.**

---

# 2. Assignment authority vs byte transport (requirement 1)

**The rule this encodes:** a device installs what it has been _assigned_, not what it has been _offered_.

```text
  ┌──────────────────────────────────────────────────────────────┐
  │  GOVERNED AUTHORITY  —  cloud kitluy_releases (migration 0180)│
  │    create_release_draft_v1 → sign_release_v1                  │
  │    → promote_release_v1(…,'internal') → assign_release_v1     │
  │  assign_release_v1 already refuses: non-eligible state,       │
  │  wrong environment, device not assigned to the named          │
  │  Tenant/Store/Location, idempotency conflict                  │
  └───────────────────────────┬──────────────────────────────────┘
                              │  ASSIGNMENT (authority)
                              │  device-scoped · authenticated · sequenced
                              │  carries: releaseId, the SIGNED manifest,
                              │           the signature envelope, digest, size
                              ▼
                    ┌───────────────────────┐
                    │   Pi Terminal          │
                    │   update runtime       │
                    │                        │
                    │  knows releaseId AND   │
                    │  digest BEFORE any     │
                    │  byte is fetched       │
                    └───────────┬───────────┘
                                │  ARTIFACT (bytes only)
                                │  "give me the bytes for THIS release id"
                                ▼
                    ┌───────────────────────┐
                    │  byte source           │
                    │  dumb, resumable       │
                    │  NOT authority         │
                    └───────────────────────┘
```

**Why this satisfies the ruling structurally rather than by policy.** The device derives nothing from the byte source: not what to install, not whether to install, not which version. It arrives already knowing the release id, the expected SHA-256 and the expected size, all covered by an Ed25519 signature it verified before opening a connection. A byte source that substitutes, downgrades, truncates or corrupts produces a digest mismatch and is refused. A byte source that offers a _different, validly signed_ release is ignored, because nothing asks it what it has.

**Two sources, two interfaces, one implementation each in U1:**

| Interface          | U1 implementation                                                                                                                                                                                                                     | U4 implementation (not built now)                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `AssignmentSource` | `pnpm dev:release:serve` — a development service that **reads the governed cloud rows** (`device_installations` ⋈ `release_artifacts`), scoped to the calling device, over mTLS using the terminal's existing operational certificate | the Store Hub over `/edge/v1`                     |
| `ArtifactSource`   | the same service, Range-capable, serving bytes by release id                                                                                                                                                                          | the Store Hub's `release-cache.ts`, already built |

**REPOSITORY FACT — the precedent for this service already exists.** `scripts/development/fleet-service.mjs` (`pnpm dev:fleet`) runs a real service bound to the workstation LAN, restricted to a loopback stack or the one allowlisted hosted development project, with every precondition checked before it starts and a refusal that names which one failed. The release service is the same shape, the same target restriction, and the same refusal discipline. It is **not** a file server: it answers from the governed tables, so the authority stays in the database where `assign_release_v1` put it.

---

# 3. The release store (OD-U1-1)

```text
/persistent/shared/kitluy/releases/            ← slot-shared; NEVER under per-slot /var
  device-shell/
    rel-<releaseId>/                           unpacked payload
      payload/                                 ← what the launcher points at
      manifest.json                            the signed manifest that admitted it
      envelope.json                            keyId · keyVersion · algorithm · signature
    current    → rel-<releaseId>               symlink, swapped by rename(2) + dir fsync
    previous   → rel-<releaseId>               the last release proven healthy
    journal.json                               intent + outcome (§5)
```

Root-owned, `0755`; payload files `0644`; **not writable by `kitluy-terminal`**, which is the user the Shell runs as. The update runtime is the only writer.

**Launcher indirection** — `/usr/lib/kitluy/device-shell` today sets `APP=/usr/lib/kitluy/lib/device-shell`. It becomes, in effect:

```sh
APP=/usr/lib/kitluy/lib/device-shell                      # the image's own copy
STORE=/persistent/shared/kitluy/releases/device-shell/current/payload
[ -f "$STORE/package.json" ] && APP="$STORE"
```

`-f …/package.json` rather than `-d …` deliberately: a half-unpacked directory must not be selected. The image copy is never modified and never removed, so **a bad release cannot brick the board** — the fallback is structural, not a recovery step.

**Slot-shared declaration** — `etc/rpi-image-gen/slot-shared.d/62-kitluy-releases.conf`, `Version=1`, `Path=/persistent/shared/kitluy/releases`.

> **Inherited hazard, designed for.** `kitluy-ssh-hostkeys.service` records that upstream's `slot-shared-generator` creates its `local-fs.target.wants` symlink **once, after both loops**, using the leftover `unit_name` — so with two paths declared only the last is enabled. KitLuy worked around it for `/etc/ssh` with its own unit. Declaring a third path re-enters that bug. U1 generalises the workaround (a `kitluy-slot-shared.target` requiring every KitLuy slot-shared mount) rather than adding a third special case, and a systemd-runtime test asserts all three mounts are actually enabled.

---

# 4. Downgrade prevention (requirement 2)

Three mechanisms, none of which relies on comparing version strings.

**4.1 Install only what is assigned.** The runtime's only normal activation path is `activate(assignment.releaseId)`. There is no "scan the source for something newer", no version comparison, and no local choice. A governed downgrade — the owner assigning an older release — therefore works correctly and deliberately, while an _arbitrary_ downgrade has no code path to travel.

**4.2 Monotonic assignment sequence — replay refusal.** Every assignment response carries a sequence number derived from the governed row (`device_installations.updated_at` plus campaign id, exposed as a monotonic integer). The device records `lastAssignmentSeq` in the journal. **An assignment whose sequence is lower than the recorded one is refused** and recorded as `ASSIGNMENT_STALE`.

Without this, a replayed or rolled-back assignment response could pin a device to an old release indefinitely — the freeze/rollback class of attack. It costs one integer and one comparison.

**4.3 Rollback is local recovery, not an install.** Rollback restores `previous`, which is already unpacked on disk and was signature- and digest-verified when it was installed. It performs **no fetch, no assignment query and no version choice**. It is reached only from a failed health gate, and afterwards the failed release id is recorded as `failed_rolled_back`, which — matching the existing owner-locked rule — **blocks automatic retry of that same release**. Re-attempting requires either an operator action or a newer assignment.

---

# 5. Durability across real power loss (requirement 3)

**The correction.** `rename(2)` is atomic with respect to concurrent readers, but the rename is **not durable** until the containing directory is fsynced. A plan that says only "atomic switch" leaves a window in which a power cut loses the switch while the payload appears installed. The proposal said "atomic"; that was not enough, and this section is the fix.

**REPOSITORY FACT — the correct discipline already exists in this codebase**, in `pairing-state.ts`, `bootstrap-state.ts` and `operational-credential-state.ts`: _write temp → fsync file → rename → fsync directory_. It is duplicated across seven modules with one local `writeAtomic` helper. (Noted, not fixed in U1: `edge-session.ts:121` renames **without** the directory fsync, so `edge-status.json` is atomic but not durable. Recorded as a finding; changing it is outside U1's scope.)

**U1 adds one shared module** — `durable-write.ts` — and uses it everywhere in the release path.

## 5.1 The journal, and the exact ordering

`journal.json` is the single durable record of intent and outcome. Every transition is written **before** the action it describes.

```text
 1. unpack payload → rel-<id>.incoming/
 2. fsync every payload file, then fsync rel-<id>.incoming/
 3. rename rel-<id>.incoming/ → rel-<id>/            ; fsync parent dir
 4. journal: phase=ACTIVATING, target=<id>, previous=<current id>, seq=<n>
    → fsync file, rename, fsync dir                   ← INTENT IS NOW DURABLE
 5. symlink current.tmp → rel-<id>   ; fsync dir
 6. rename current.tmp → current     ; fsync dir      ← SWITCH IS NOW DURABLE
 7. journal: phase=HEALTH_PENDING     ; fsync
 8. restart unit; run the owner-locked gate
 9. journal: phase=COMMITTED (or ROLLED_BACK)         ; fsync
```

## 5.2 Boot-time reconciliation

The runtime's first act on every start is to reconcile the journal against the filesystem. Each state has exactly one defined resolution:

| Journal phase at boot | What the filesystem may show             | Resolution                                                                                                                    |
| --------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| absent / `COMMITTED`  | `current` valid                          | nothing to do                                                                                                                 |
| `ACTIVATING`          | `current` still points at `previous`     | step 5–6 never completed → **discard**; keep running `previous`; record `INTERRUPTED_BEFORE_SWITCH`                           |
| `ACTIVATING`          | `current` points at target               | the switch landed but the journal did not advance → **adopt**, enter `HEALTH_PENDING`                                         |
| `HEALTH_PENDING`      | `current` points at target               | the gate never finished → **re-run the gate from zero**, with the one-rollback budget intact                                  |
| any                   | `current` dangling or payload incomplete | **restore `previous`**; if `previous` is also unusable, remove `current` entirely → the launcher falls back to the image copy |
| any                   | store unreadable/absent                  | launcher falls back to the image copy; runtime reports and retries                                                            |

**The invariant U1 must hold, and that acceptance test C exists to prove:** _at every instant between power-on and power-off, the board boots to a valid Device Shell — the assigned one, the previous one, or the image's own._ There is no interleaving that yields a blank screen.

## 5.3 Why `.incoming` is a sibling, not a subdirectory

`rel-<id>.incoming/` renames to `rel-<id>/` within the same directory, so the rename is atomic on the same filesystem. An interrupted unpack leaves an `.incoming` directory that the launcher's `-f package.json` check can never select and that reconciliation deletes on sight.

---

# 6. Work breakdown

Six phases. Phases 1–3 touch no image and no device; the board keeps running throughout. Phase 4 is the single reflash.

## Phase 1 — signing and trust (workstation only)

| File                                             | Change                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/pki/bootstrap-dev-pki.mjs`              | add `dev-release-signing.key.pem` / `.pub.pem` and a `dev-release-signing.json` record (`keyId`, `keyVersion`, `purpose: "release_signing"`, `algorithm: "ed25519"`). Ed25519, same existing refusals: never overwrite, never inside the repository, `NON-PRODUCTION` stamped, 0600 verified after write |
| `scripts/pki/bootstrap-dev-pki.test.mjs` _(new)_ | refuses overwrite · refuses in-repo path · key modes · purpose recorded                                                                                                                                                                                                                                  |

**Authority:** within existing rulings — BLK-005 authorises development certificate implementation and a software-backed development signer; owner Decision 3 (2026-08-24) authorises this generator. **No new owner decision is consumed.**

**Wrong-purpose refusal — where it lives, and why not in the shared verifier.** The device-side trust loader (`release-trust.ts`, Phase 3) refuses any trust record whose `purpose` is not `release_signing` **before** the key reaches `verifyReleaseManifestSignature`. Putting the check in the loader rather than in `release-manifest.ts` means: no change to a TESTED-IN-DEV contract, no Hub migration (the Hub's `release_trust_key` table has no purpose column), and no U3/U4 scope creep. Binding purpose _cryptographically_ into the manifest body is a manifest-v2 change and stays a pre-Pilot item, as recorded in the feasibility assessment.

## Phase 2 — durable store library (no device change)

| File                                                                  | Change                                                                                                                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/kitluy-device-firstboot-agent/src/durable-write.ts` _(new)_ | `writeDurable()`, `renameDurable()`, `swapSymlinkDurable()`, `fsyncDir()` — the discipline already used in `pairing-state.ts`, extracted once                     |
| `services/kitluy-device-firstboot-agent/src/release-store.ts` _(new)_ | layout constants, `readJournal`/`writeJournal`, `resolveCurrent`/`resolvePrevious`, `stageIncoming`, `promoteIncoming`, `activate`, `rollback`, `reconcileOnBoot` |
| `test/durable-write.test.ts`, `test/release-store.test.ts` _(new)_    | §7                                                                                                                                                                |

## Phase 3 — the update runtime (no device change)

| File                                    | Change                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/release-trust.ts` _(new)_          | load `/etc/kitluy/trust`, **purpose-checked**, → `TrustedReleaseKey[]`. Absent or empty ⇒ refuse, which is what the agent already does today                                            |
| `src/release-assignment.ts` _(new)_     | `AssignmentSource` interface + mTLS HTTP implementation; verifies the signed manifest and the assignment sequence **before returning**                                                  |
| `src/release-artifact.ts` _(new)_       | `ArtifactSource` interface + Range-capable resumable fetch, byte-count bounded by the manifest's `artifactSizeBytes`                                                                    |
| `src/release-install.ts` _(new)_        | the state machine: preconditions → assignment → verify → acceptance gate → disk → fetch → re-prove → stage → preflight → journal → activate → restart → health gate → commit / rollback |
| `src/bin/update-bootstrap.ts` _(grown)_ | keeps `evaluateUpdate`'s three precondition states and its 300 s posture; adds the stages after them. **Nothing deleted**                                                               |
| five new `test/*.test.ts`               | §7                                                                                                                                                                                      |

**Unit restart — known risk, flagged not hidden.** `kitluy-update-agent.service` runs as root but with an **empty `CapabilityBoundingSet`** and `NoNewPrivileges`. Whether it can drive `systemctl restart kitluy-device-shell.service` over systemd's D-Bus under that sandbox is the kind of thing that works on a workstation and fails on the board. Plan: attempt the direct path first; if the sandbox refuses, add a restart verb to the **existing root config broker** (`kitluy-device-config.service`, which already answers a closed verb list on a unix socket for exactly this "the caller must not hold privileges" reason). Either way the Shell's own sandbox is untouched. This is settled in implementation, but it is the most likely source of a surprise at the bench, so it is named here.

## Phase 4 — image integration (**the one reflash**)

| File                                                                            | Change                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/kitluy-os-image/runtime-manifest.json`                                   | declare the release store, the trust anchor and the launcher indirection — the manifest is the authority, so packaging refuses on any disagreement                                                                                                                                             |
| `rpi-image-gen/layer/kitluy-base.yaml`                                          | `IGconf_kitluy_release_trust_pubkey` → `/etc/kitluy/trust/release-signing.pub` + `.json` record; `IGconf_kitluy_release_source` → `/etc/kitluy/release.env`. Both follow `development-root.sha256`'s **absent-is-safe** semantics: no anchor ⇒ the agent refuses, no source ⇒ nothing to check |
| `…/etc/rpi-image-gen/slot-shared.d/62-kitluy-releases.conf` _(new)_             | the store path                                                                                                                                                                                                                                                                                 |
| `…/etc/systemd/system/kitluy-slot-shared.target` _(new)_                        | the generalised `.wants` workaround                                                                                                                                                                                                                                                            |
| `…/usr/lib/kitluy/device-shell`                                                 | the `APP=` indirection (~4 lines)                                                                                                                                                                                                                                                              |
| `…/etc/systemd/system/kitluy-update-agent.service`                              | `ReadWritePaths=` gains the store                                                                                                                                                                                                                                                              |
| `scripts/package-bootstrap-runtime.sh`                                          | package the new modules; extend the import-closure verification                                                                                                                                                                                                                                |
| `test/build-gates.test.sh`, `systemd-runtime.test.sh`, `image-contents.test.sh` | assert the anchor, the store, all three slot-shared mounts **enabled**, the launcher indirection, and that **only `device-shell`** is store-resolvable (§9 fence)                                                                                                                              |

## Phase 5 — publish tooling (workstation only)

| File                                              | Change                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/development/release-pack.mjs` _(new)_    | build → `tar.zst` → SHA-256 → manifest body, with **`buildId` = git SHA + dirty flag** (requirement §7 traceability; today's build manifest records only the _upstream builder's_ commit)     |
| `scripts/development/release-publish.mjs` _(new)_ | sign → `create_release_draft_v1` → `sign_release_v1` → `promote_release_v1(…,'internal')` → `assign_release_v1`. Target restriction and precondition refusals modelled on `fleet-service.mjs` |
| `scripts/development/release-service.mjs` _(new)_ | `AssignmentSource` + `ArtifactSource` over mTLS; answers from the governed rows, **not** from a directory listing                                                                             |
| `scripts/development/verify-terminal.mjs` _(new)_ | automated acceptance: unit active · expected version reported · `edge-status.json` phase `SERVING` · Hub reachable                                                                            |
| `package.json`                                    | `dev:release`, `dev:release:serve`, `dev:verify:terminal`                                                                                                                                     |
| `apps/kitluy-device-shell`                        | render running version + last update result; one field through the existing snapshot path, guarded by the existing drift test                                                                 |

## Phase 6 — hardware acceptance (§8)

---

# 7. Test plan

**Durability (requirement 3) — the class that did not exist before.** A fault-injection harness runs the activation sequence with a forced abort at **every** step boundary in §5.1, then runs `reconcileOnBoot` and asserts the invariant: a valid Shell is always resolvable, the journal and filesystem always agree after reconciliation, and `previous` is always recoverable. Each of the nine steps is a test case, not a comment.

**Downgrade (requirement 2).** Stale assignment sequence refused · an assignment for a release id other than the one fetched is refused · rollback performs no network call (asserted by a source double that fails the test if touched) · after `failed_rolled_back`, the same release id is refused automatically.

**Trust.** Wrong-purpose key refused · revoked key refused · unknown key id refused · correct key with wrong key _version_ refused · missing anchor refuses before any fetch.

**Integrity.** Tampered byte caught by the re-proof over received bytes · truncated artifact refused on size · digest mismatch refused · resume-from-offset produces a byte-identical artifact.

**Refusals.** Disk full (free < 2 × size) refused before staging · acceptance gate refusals against a **real** `image.env` · a `development` artifact refused by a non-development device.

**Store.** Launcher falls back when the store is empty, when `current` dangles, and when the payload lacks `package.json`.

**Security gates.** `pnpm secret:scan` · `pnpm pki:assert-no-dev` still passes · no signing key reaches any device (public material only) · `promote_release_v1` still refuses `pilot`/`stable` without an approver and without PKI configuration.

**Scope fence (OD-U1-2).** A test asserts the store resolves for `device-shell` **only**, and that `terminal-edge`, `firstboot-identity`, `cloud-registration`, `update-agent`, `health-reporter` and `operational-tls` remain image-only and are not store-resolvable.

**Full suites before any hardware run:** `pnpm verify`, both image trees' suites, device-shell suite, firstboot-agent suite — reported with actual numbers, never claimed.

---

# 8. Hardware acceptance — A, B, C, D

On the physical Pi Terminal, after the Phase 4 reflash. **No SD card is touched in any of the four tests.**

### A — successful A→B OTA

Shell at A → make a visible UI change → `pnpm dev:release device-shell --target KL-TERM-001` → observe download, verify, stage, activate, restart → **the change is visible on the touchscreen** → it reports B → **and the terminal is still enrolled, still paired, still activated, `edge-status.json` phase `SERVING`.**

### B — unhealthy C → automatic rollback to B

Publish C whose Shell exits immediately → assigned, fetched, verified, staged, activated → the gate fails → **B is restored automatically**, the Shell works again, the rollback is recorded in the journal and shown on screen → and re-running the loop does **not** silently reinstall C.

### C — real power interruption leaves a bootable valid release _(new)_

**Procedure — physical power removal, not a reboot command**, one cut per window, repeated:

1. during download · 2. during unpack · 3. between journal-intent and symlink swap · 4. between symlink swap and journal advance · 5. during the health gate.

After each cut, power on and assert: **the board boots to a working Device Shell**; the journal and the filesystem agree; the version on screen is either the assigned one or the previous one and never a half-installed mixture; and the terminal is still paired and `SERVING`. Windows 3 and 4 are the ones §5.1's ordering exists to survive, so each is cut **at least three times**.

### D — tampered artifact refused while the current release keeps running _(new)_

With B running and healthy, publish an artifact whose bytes are altered after signing (digest no longer matches the signed manifest). Assert: the fetch completes, the **re-proof over received bytes fails**, the release is refused with its exact code, **nothing is staged or activated**, `current` is untouched, the Shell keeps running B without interruption, and the refusal is recorded and visible without SSH. Repeat with a valid artifact carrying a tampered _manifest_ (signature no longer verifies) — refused **before any byte is fetched**.

**Reporting.** Only after A, B, C and D all pass is U1 `HARDWARE VERIFIED`. Anything less is reported as `TESTED-IN-DEV` or `IMAGE VERIFIED`, with the failing test named. Per the owner's §18: an update runtime existing, a release schema existing and A/B partitions existing are **not** evidence that OTA works.

---

# 9. Scope fence

**In:** exactly what §6 lists.

**Out, and asserted out by tests:**

- any reclassification of `terminal-edge`, `firstboot-identity`, `cloud-registration`, `update-agent`, `health-reporter` or `operational-tls` — **OD-U1-2 is for the Device Shell payload alone**;
- any change to `/usr` writability, EROFS, dm-verity, the partition table, `autoboot.txt`, LUKS, or the A/B slot mechanism;
- any `SlotAdapter`, slot write, tryboot call or system OTA work (U5);
- any Hub-side release route, `release-cache.ts` wiring or LAN distribution (U4);
- any second product through the pipeline (U2);
- any Hub→cloud version reporting, portal screen or Admin/Partner UI (U3, U6);
- any Pilot or Stable promotion, and any change to the BLK-005 gate;
- any change to the owner-locked health-gate timings (OD-U1-3 = A);
- manifest v2 / cryptographic purpose binding (pre-Pilot);
- the six duplicated `writeAtomic` implementations elsewhere in the agent, and `edge-session.ts`'s missing directory fsync — both recorded as findings, neither refactored.

---

# 10. Risks

| Risk                                                                                                         | Likelihood  | Handling                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------ | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The update-agent's empty `CapabilityBoundingSet` blocks `systemctl restart`                                  | **medium**  | try direct, fall back to a restart verb on the existing root config broker (§6 Phase 3)                                                                                |
| The slot-shared `.wants` bug bites on a third declared path                                                  | **medium**  | generalised target + a systemd-runtime test asserting all three mounts enabled, before hardware                                                                        |
| mTLS from the terminal to a workstation service needs SAN/trust work the Hub path already solved differently | medium      | reuse the operational certificate and the dev PKI chain; if the terminal's client-auth posture needs work, it surfaces in Phase 5 on the workstation, not at the bench |
| Power-cut testing is slow and manual                                                                         | **certain** | accepted — it is the requirement; windows 3 and 4 get the repetitions, the rest one pass each                                                                          |
| `pnpm verify` regressions from the shared `durable-write.ts` extraction                                      | low         | U1 _adds_ the module and uses it only in the release path; the six existing copies are untouched                                                                       |
| The Shell version field drifts from the agent's model                                                        | low         | the existing compile-time + runtime drift test already guards this path                                                                                                |

---

# 11. Sequence, and where I stop

1. Phases 1–3 and 5 — workstation only; the board keeps running its current image throughout.
2. Full suites green, reported with real numbers.
3. Phase 4 — image changes; build; image suites; **then the single reflash**.
4. Phase 6 — acceptance A, B, C, D on hardware.
5. Handoff in `00_AI_HANDOFF/edge-platform/`, index updated, evidence register updated **only for what the hardware run actually proved**.

**Nothing is committed or pushed without owner authorization.** I will report state at the end of phase 3 (before any image change) and again after phase 4 (before the reflash), so there is a stop point on either side of the one irreversible bench step.

---

## Stop

This turn produced a plan only. **No code, migration, image or documentation was changed. Nothing was committed or pushed. No new owner decision was made or assumed, and no GAP ID was created.** `pnpm verify` was not run, because nothing in the repository was modified except the addition of this file.

**Ready to begin Phase 1 on your word.**
