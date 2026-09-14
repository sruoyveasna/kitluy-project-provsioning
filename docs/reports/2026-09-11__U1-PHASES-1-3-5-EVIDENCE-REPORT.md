# U1 phases 1–3 and 5 — evidence report, stop point before image integration

| Field                 | Value                                                                                   |
| --------------------- | --------------------------------------------------------------------------------------- |
| Date                  | 2026-09-11 · Asia/Phnom_Penh                                                            |
| Repository            | `het-kitluy-project`, branch `claude/fix-firstboot-esm-and-ssh-hostkeys`                |
| Status                | **SOURCE IMPLEMENTED + TESTED-IN-DEV.** Not `IMAGE VERIFIED`, not `HARDWARE VERIFIED`.  |
| Committed             | **No.** Nothing committed or pushed.                                                    |
| Owner rulings applied | OD-U1-1 = A · OD-U1-2 = C · OD-U1-3 = A                                                 |
| Stop point            | Phase 4 (image integration) and the physical reflash have **not** begun, as instructed. |

---

## 1. Verification baseline vs regression (requirement 3)

`pnpm verify` was run **before** any change and **after**. The failure set is **identical**.

### Baseline — recorded before U1 touched anything

| Step                                                                                                                             | Result   | Cause                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Format check                                                                                                                     | **FAIL** | `EACCES: permission denied, scandir …/build/work/chroot-v2.7.0/filesystem/persistent/home/pi` — an unreadable rootless build artifact. Prettier's own verdict on everything it _could_ read: _"All matched files use Prettier code style!"_                                                                                                              |
| Lint                                                                                                                             | **FAIL** | 2 errors: `test/terminal-edge.test.ts:310` `prefer-const`; `src/hub/dev-configuration.ts:40` `consistent-type-imports`. Both in the pre-existing uncommitted edge work.                                                                                                                                                                                  |
| Typecheck                                                                                                                        | PASS     |                                                                                                                                                                                                                                                                                                                                                          |
| Unit tests                                                                                                                       | **FAIL** | `@kitluy/device-identity` — 2 suites fail **in setup**: `kitluy_credential_issuer is ALREADY granted to this login, so another session has borrowed it`. A leaked role grant from an earlier session. **899 passed, 23 skipped, 0 test assertions failed.** The suite's own message says _"do not revoke the membership by hand"_, so it was left alone. |
| Contract tests · Offline harness · Build · OpenAPI · Migration validation · Hub migration validation · Secret scan · Clock usage | PASS     |                                                                                                                                                                                                                                                                                                                                                          |
| Docs link check                                                                                                                  | **FAIL** | 4 broken links in `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`                                                                                                                                                                                                                                     |

### After U1 phases 1–3 and 5

**Identical.** Compared field by field:

| Check                  | Baseline                                                              | After                               | Verdict    |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------- | ---------- |
| Lint errors            | 2, at `terminal-edge.test.ts:310` and `dev-configuration.ts:40`       | the same 2, same files, same lines  | **no new** |
| Format                 | EACCES on the same path; "All matched files use Prettier code style!" | identical                           | **no new** |
| Broken doc links       | 4                                                                     | 4                                   | **no new** |
| Failing turbo task     | `@kitluy/device-identity#test` only                                   | `@kitluy/device-identity#test` only | **no new** |
| device-identity totals | 899 passed / 23 skipped                                               | 899 passed / 23 skipped             | unchanged  |

> **BASELINE FAILURES: 4, all pre-existing, none touched.**
> **NEW U1 REGRESSIONS: 0.**
>
> None of the four is represented as passing. Two are environmental (a rootless
> build tree prettier cannot read; a leaked database role grant from another
> session), and two are pre-existing repository debt in files U1 did not modify.
> Per the ruling, none was cleaned up as part of this slice.

### U1's own suites — all pass

```
test/release-archive.test.ts        32 passed   safe extraction (requirement 2)
test/release-store.test.ts          30 passed   journal, activation, power loss (requirement 3)
test/release-verify-drift.test.ts   31 passed   mirror vs canonical package
test/release-trust.test.ts          20 passed   wrong-purpose and environment refusals
test/release-install.test.ts        19 passed   end to end, incl. scenarios B and D
test/durable-write.test.ts          14 passed   durable primitives
test/release-assignment.test.ts     15 passed   replay and downgrade (requirements 1, 2)
test/release-status.test.ts         11 passed   fallback visibility (requirement 4)
                                   ---
                                   172 passed, 0 failed

pnpm release:pack:check              9/9 passed  workstation packer vs BUILT device closure
@kitluy-services/kitluy-device-firstboot-agent
                                   711 passed | 9 skipped | 0 failed  (whole package)
```

---

## 2. Requirement 1 — the assignment generation

**Instruction:** do not derive a monotonic sequence from `updated_at` + campaign ids; first inspect whether KitLuy already has an authoritative generation and reuse it; do not create a migration unnecessarily.

### What was found — and it is authoritative

**`kitluy_devices.device_assignments.assignment_generation`** (migration `0121`):

```sql
-- Monotonic per device. This is the value WS-10 carries in every batch and
-- every configuration snapshot; a stale generation is refused, not tolerated.
assignment_generation integer not null,
...
unique (device_id, assignment_generation),
constraint device_assignments_generation_chk check (assignment_generation >= 1),
```

Monotonic, unique per device, integer, **not a timestamp**, and already used for exactly this purpose elsewhere in the system. **It is reused, and no migration was created.**

### Its honest limit, stated rather than papered over

`assignment_generation` orders a device's **Store binding**. It does **not** order two _release_ assignments issued inside one binding — `kitluy_releases.device_installations` has no generation or sequence column, and its identity is `(campaign_id, device_id)` with a uuid primary key.

So the generation alone leaves a gap: a replay of an earlier release assignment made under the _same_ device-assignment generation would not be refused by generation.

### How the gap is closed without a schema change

A second, independent check in the device's durable journal. A replay can only ever name a release the device has **already seen**, so:

| Condition                                   | Refusal                                |
| ------------------------------------------- | -------------------------------------- |
| generation lower than the highest accepted  | `ASSIGNMENT_STALE`                     |
| release id already installed and moved past | `ASSIGNMENT_SUPERSEDED`                |
| release id already rolled back from         | `INSTALL_RETRY_BLOCKED_AFTER_ROLLBACK` |

The device persists `lastAssignmentGeneration` as a high-water mark that never lowers, plus `supersededReleaseIds` and `failedRolledBackReleaseIds`. All three are in `journal.json` on the slot-shared store, written durably.

**A governed downgrade still works**, which was the point of the ruling: the owner assigning an older _version_ arrives with a **higher generation** and a release id the device has not superseded, so it installs normally. Version strings are never compared anywhere. Test: `ALLOWS a governed downgrade — an older VERSION under a newer generation`.

### The smallest explicit mechanism, if you want the gap closed in the cloud

**Proposed, not built:** add `sequence_no bigint generated always as identity` to
`kitluy_releases.device_installations`. One column, additive, forward-only, and
the repo's own existing idiom (the same pattern appears on several tables). The
device side already consumes an explicit `assignmentGeneration` integer, so
adopting it is a one-line change to the assignment source's `SELECT` — no device
change at all.

**I did not create that migration.** It is not needed for U1's correctness given
the two-check design above, and you said not to create one unnecessarily.

---

## 3. Requirement 2 — safe extraction

A tar reader was written rather than shelling out to `/usr/bin/tar` (which the device has). The reader **contains no code that creates a symlink, a hard link, a device node or a setuid file** — the type checks name the refusal, but the first line of defence is that the dangerous operation is unimplemented.

Every refusal the ruling listed, with a test that **builds the malicious archive**:

| Required refusal                    | Code                                                 | Test                                                    |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| absolute paths                      | `ENTRY_NAME_ABSOLUTE`                                | ✓                                                       |
| `..` traversal                      | `ENTRY_NAME_TRAVERSAL`                               | ✓ (plain, buried, **and via the ustar `prefix` field**) |
| symlink escape                      | `ENTRY_TYPE_SYMLINK`                                 | ✓ (refused even when the target looks harmless)         |
| hard-link escape                    | `ENTRY_TYPE_HARDLINK`                                | ✓                                                       |
| device nodes                        | `ENTRY_TYPE_DEVICE`                                  | ✓ (char and block)                                      |
| unexpected ownership                | `ENTRY_OWNERSHIP_NOT_ROOT`                           | ✓                                                       |
| setuid/setgid                       | `ENTRY_MODE_SETUID_SETGID`                           | ✓ (setuid, setgid, sticky)                              |
| extraction outside the release root | `ENTRY_ESCAPES_ROOT`                                 | ✓ (independent resolved-prefix check)                   |
| unreasonable decompressed size      | `ARCHIVE_TOO_LARGE` / `ARCHIVE_DECOMPRESSION_FAILED` | ✓ (a real decompression bomb)                           |
| unreasonable file count             | `ARCHIVE_TOO_MANY_ENTRIES`                           | ✓                                                       |

Also refused: fifos, pax/GNU extended headers (`x`,`g`,`L`,`K` — the classic
indirection escape), unknown typeflags, corrupt header checksums, control
characters and backslashes in names, over-long paths, truncated archives, and
data appended after the end-of-archive marker.

**After every refusal the suite asserts the destination is still empty.** A refusal that has already written half a payload is not a refusal.

**Verification order is preserved and tested:** signature → acceptance gate → disk → bytes → digest re-proof → **safe extraction** → preflight → activation. The test `refuses an archive that tries to escape, after the digest verifies` is the one that proves a valid signature does not waive extraction safety.

### One deviation from the plan, for a hard device reason

The plan said `.tar.zst`. **The device cannot do that in-process:**

```
workstation   node 22.23.0   zlib.zstdDecompressSync  present
Pi Terminal   node 18.20.4   zlib.zstdDecompressSync  ABSENT
```

`nodejs` on the image is Debian bookworm's **18.20.4**; Node gained zstd in 22.15. An extractor written against zstd would have passed every test on this workstation and failed on the board. **Releases are `.tar.gz`**, which is a Node built-in everywhere; at a 280 KB payload the ratio difference is meaningless. A zstd archive is detected by magic bytes and refused **by name** (`ARCHIVE_COMPRESSION_UNSUPPORTED`) so a future codec change gets a sentence, not a parse error.

---

## 4. Requirement 3 — durability across real power loss

The plan's "atomic switch by `rename(2)`" was **not sufficient**, and this was corrected: a rename is atomic for a concurrent reader but is not durable until the containing **directory** is fsynced.

`src/durable-write.ts` extracts the discipline already used by hand in
`pairing-state.ts`, `bootstrap-state.ts`, `installation.ts` and
`operational-credential-state.ts`: _write temp → fsync file → rename → fsync dir_.
It adds `swapSymlinkDurable` (symlink to a temp name → fsync dir → rename → fsync dir)
and `fsyncTree` (files first, then directories bottom-up, so a directory entry
can never become durable ahead of the contents it names).

The nine-step sequence and the boot-time reconciliation table are implemented as planned. **Every step boundary has a test** that builds the exact on-disk state a cut at that instant would leave, then reconciles:

| Boundary                                    | Resolution                                  | Test |
| ------------------------------------------- | ------------------------------------------- | ---- |
| interrupted unpack                          | `.incoming` discarded, nothing else changed | ✓    |
| promoted, not activated                     | release exists, `current` unchanged         | ✓    |
| journal `ACTIVATING`, switch never happened | discard; keep previous                      | ✓    |
| switch landed, journal never advanced       | adopt; enter the gate                       | ✓    |
| gate never finished                         | re-run from zero                            | ✓    |
| `current` payload gone                      | restore previous                            | ✓    |
| nothing usable remains                      | remove `current`; image copy runs           | ✓    |
| reconcile run twice                         | idempotent                                  | ✓    |

Plus the **invariant itself**, asserted over 24 combinations of journal phase × filesystem state:

> after reconcile, the store resolves a **valid** release or **nothing at all** — never a dangling link, never a half-installed payload.

That is the property acceptance test C will check on hardware, where the power actually goes away.

---

## 5. Requirement 4 — fallback visibility

`src/release-status.ts` composes one answer from two sources and **does not infer the running source from the store**:

- the **launcher** writes `/var/lib/kitluy/terminal/running-source.json` immediately before `exec` — it is the only thing that knows what it actually started;
- the **journal** supplies installed/previous/last-result/rollback reason.

Reported: `runningSource` (`RELEASE` / `IMAGE_FALLBACK` / `UNKNOWN`), running release id and version, installed release id and version, **`stale`** (a restart would change what is running), last update result, and a `fallbackReason` that is never null when the image copy is running.

The case that matters — _a release is installed but the shell started before it_ — reports `IMAGE_FALLBACK`, `runningVersion: null`, `stale: true`, and "a release is installed but the shell started before it; a restart picks it up". **The image copy is never presented as the assigned release.**

`formatReleaseStatusLine` emits one greppable journal line, so
`journalctl -u kitluy-update-agent` answers "what is running and why" **without SSH**.

---

## 6. What was built

### Phase 1 — signing and trust

- `scripts/pki/bootstrap-dev-pki.mjs` — adds a purpose-scoped Ed25519 **release-signing** key: `dev-release-signing.key.pem` (0600), `.pub.pem` (0644), and a public `dev-release-signing.json` trust record carrying `purpose: "release_signing"`. Deliberately **not** chained to the canonical root: release manifests are verified against a key **registry** matched by (keyId, keyVersion), not a chain, and implying a validation path the verifier does not have would be worse than none. Executed against a scratch directory; modes verified.

### Phase 2 — durable store

- `src/durable-write.ts`, `src/release-store.ts` — layout, journal, staging, promotion, activation, rollback, reconciliation, pruning. The **U1 scope fence is code**: `assertProductPermitted` refuses every product but `device-shell`, and a test names `terminal-edge`, `firstboot-identity`, `cloud-registration`, `update-agent`, `health-reporter`, `operational-tls`, `hub-agent` and `terminal-client` as refused.

### Phase 3 — the update runtime

- `src/release-verify.ts` — a **mirror** of the canonical verifier. The agent's `src/` imports no workspace package at runtime (the device closure is Node built-ins only), so the contract is duplicated and guarded by `release-verify-drift.test.ts`, which imports the real `@kitluy/device-identity` and compares **canonical bytes**, digests and verdicts across 31 cases. This follows the pattern already used for registration bytes, the operational CSR and the Hub claim.
- `src/release-trust.ts` — loads `/etc/kitluy/trust`, refuses wrong purpose, wrong environment, private-key material (checked on the raw text before parsing), and malformed records. Absent is safe.
- `src/release-assignment.ts` — the authority/transport split and the replay logic (§2).
- `src/release-artifact.ts` — resumable, size-bounded fetch with the digest re-proven over received bytes.
- `src/release-install.ts` — the sequence, with the owner-locked gate (20 s / 3 consecutive / 5 min / one rollback), unchanged and with no environment branch.
- `src/release-status.ts` — §5.
- `src/bin/update-bootstrap.ts` — **grown, not replaced**. `evaluateUpdate` → `evaluatePreconditions` with identical behaviour; the misleading `up_to_date` state is now `ready` (it never meant "up to date"); a new `no_usable_trust_anchor` distinguishes "anchors present but all refused" from "no anchors", which is a different fault and a different fix.

### Phase 5 — packing and signing (partial, see §7)

- `scripts/development/release-pack.mjs` — collects the payload, writes a **reproducible** ustar (fixed mtime, sorted entries, uid/gid 0, no symlinks by construction), gzips, signs with the dev release key, and records **`buildId` = git short SHA + dirty flag** — the source-provenance link that did not exist before (the image build manifest records only the _upstream builder's_ commit).
- `scripts/development/release-pack.test.mjs` (`pnpm release:pack:check`) — the cross-boundary proof: the packer's canonical bytes equal the **built device closure's**, the device verifies the packer's signature, a tampered manifest is refused, the device extracts what the packer wrote, the dev PKI record shape loads, purpose separation is enforced, and packing twice is byte-identical. **9/9.**
- `package.json` — two script entries added in place (two-line diff).

---

## 7. What is NOT done, stated plainly

Phase 5 is **partial**. These were planned and are **not built**:

| Not built                                                                                                                        | Why it stopped here                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `release-publish.mjs` — `create_release_draft_v1` → `sign_release_v1` → `promote_release_v1(…,'internal')` → `assign_release_v1` | needs a live development database. Writing it now would mean shipping unexercised code and reporting it as such. |
| `release-service.mjs` — the `AssignmentSource` + `ArtifactSource` over mTLS, reading the governed rows                           | same; also the first place the mTLS client-auth posture will be exercised                                        |
| `verify-terminal.mjs` — automated post-update acceptance                                                                         | needs a device                                                                                                   |
| Device Shell rendering its version and last-update state                                                                         | touches `apps/kitluy-device-shell`; small, but not started                                                       |

The device side is complete and tested; **the workstation side can pack and sign but cannot yet publish or serve.** No hardware run has happened and none was attempted.

---

## 8. Evidence discipline

| State                                | U1                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `SOURCE IMPLEMENTED`                 | **yes** — phases 1–3 complete, phase 5 partial                                                                                   |
| `TESTED-IN-DEV`                      | **yes** — 172 U1 tests + 9 cross-boundary checks + 711 agent tests, 0 failures; zero new regressions against a recorded baseline |
| `IMAGE VERIFIED`                     | **no** — Phase 4 has not begun                                                                                                   |
| `HARDWARE VERIFIED`                  | **no** — acceptance A/B/C/D not attempted, no SD card touched, no device contacted                                               |
| `PILOT-PROVEN` / `PRODUCTION-PROVEN` | **not claimable** — BLK-005                                                                                                      |

Nothing was committed or pushed. No migration was created. No owner decision was made or assumed. The bootstrap/runtime classification was not changed: OD-U1-2 = C is enforced in code and asserted by test.

---

## 9. Decisions taken inside existing authority, recorded for review

1. **gzip instead of zstd** — forced by Node 18.20.4 on the device (§3). The only deviation from the approved plan's wording.
2. **A mirrored verifier plus a drift test**, rather than importing `@kitluy/device-identity` on the device — follows the agent's existing architecture and keeps the device closure free of workspace packages.
3. **The wrong-purpose check lives in the trust loader**, not in the shared verifier — no change to a TESTED-IN-DEV contract, no Hub migration, and the refusal happens before crypto.
4. **No cloud migration created** — §2.

## 10. The next step, when you authorise it

Phase 4: image integration (trust anchor injection, the slot-shared store declaration and the generalised `.wants` workaround, the launcher `APP=` indirection plus its `running-source.json` write, `ReadWritePaths`, the runtime manifest, packaging and the image gates) — then the build, the image suites, and **the one reflash**. Then acceptance A, B, C, D.

The remaining Phase 5 items above can be finished before or alongside Phase 4; `release-service.mjs` is needed before acceptance A can run at all.
