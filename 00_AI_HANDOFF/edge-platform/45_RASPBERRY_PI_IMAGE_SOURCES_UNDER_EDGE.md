# INFRA-EDGE-STRUCTURE-001 — the two Raspberry Pi image sources move under `infra/edge/raspberry-pi/`

**Date:** 2026-09-16 · Asia/Phnom_Penh
**Status:** **STRUCTURE IMPLEMENTED · TESTED · IMAGE NOT REBUILT (no image verification claimed) · HARDWARE VERIFICATION NOT PERFORMED · END-TO-END NOT VERIFIED.**
Structural refactor only. No intended change to runtime, network, recovery, database, security or release behavior.

| Fact                  | Value                                                                                                     |
| --------------------- | --------------------------------------------------------------------------------------------------------- |
| Starting commit       | `b2d33c6467edf30378cfd34464d7fc78192163ed` (`provisioning/dev`, fetched and verified before editing)      |
| Task brief's HEAD     | `22bfd5c`, two commits behind: `65678a4` and `b2d33c6` (BOOT-RECOVERY-CLASSIFICATION-001) landed after it |
| Implementation commit | `PENDING` (this record's follow-up commit only fills in this SHA)                                         |
| Previous edge handoff | 44 (BOOT-RECOVERY-CLASSIFICATION-001)                                                                     |
| Decision register     | `KLREC-2026-09-16-EDGE-IMAGE-SOURCE-PATHS-001`                                                            |

## 1. Path mapping

| Previous path                  | Current path                                | Tracked files moved |
| ------------------------------ | ------------------------------------------- | ------------------: |
| `infra/kitluy-os-image`        | `infra/edge/raspberry-pi/pi-terminal-image` |                 135 |
| `infra/kitluy-store-hub-image` | `infra/edge/raspberry-pi/store-hub-image`   |                 158 |

New navigation page: `infra/edge/raspberry-pi/README.md`. It covers both images,
the pinned builder, where to change what, where generated output goes, and the
path history. Nothing else under `infra/` moved.

**How the move was made.** Only tracked entries were moved, each with `git mv`:
`README.md`, `config/`, `rpi-image-gen/`, `runtime-manifest.json`, `scripts/`
and `test/`. Before any content edit, all 293 files showed as `R100` renames, and
the mode+blob fingerprint of both trees was identical before and after
(`39345a9e943f940cc13b3c55c22f6233`). No untracked, non-ignored file existed in
either tree, and no tracked file matched an ignore rule, before or after.

## 2. Generated artifacts: left in place, not moved, not committed

Both old directories still exist **locally**. They hold only gitignored build
output, and nothing tracked:

| Left at                                       | Size  | Contents                                                                                                      |
| --------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------- |
| `infra/kitluy-os-image/build/`, `out/`        | 33 GB | `upstream/`, `work/` (`chroot-v2.7.0`, `deploy-v2.7.0`, `image-*`), `work-clean/`, `electron/`, `preserved-*` |
| `infra/kitluy-store-hub-image/build/`, `out/` | 35 GB | `upstream/`, `work/` (`chroot-v2.7.0`, `chroot-v2.7.0-dirty`, `deploy-v2.7.0`), `preserved-*`                 |

Reasons for leaving them in place:

- The task forbids moving many GB of generated output.
- Old artifacts must not look as if the new tree built them.
- `build-rpi-image.sh` collects every `build/work/deploy-*`, so a moved stale deploy dir would pollute the next build's manifest.

**Consequences:**

- The first build from each new path clones the pinned builder into `<project>/build/upstream` (the script verifies the commit), and the Terminal build fetches Electron again into `pi-terminal-image/build/electron` (checksum-verified).
- Until those builds run, `test/image-contents.test.sh` at the new paths reports **SKIP**, which is no evidence (KLD-EVIDENCE-001).
- Deleting the old directories needs owner approval. The rootless build left foreign-uid files under `build/work/chroot-*/filesystem/persistent/home/pi` (and the Hub's PostgreSQL data dirs), which a plain `rm` cannot remove.

## 3. Active references updated

| Kind                                    | Files                                                                                                                                                                                                                                                                   | Why it mattered                                                                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Repo-root depth** (would have broken) | both `scripts/package-bootstrap-runtime.sh` (`REPO`); Terminal `test/systemd-runtime.test.sh` (`REPO_ROOT`, `CONSOLE_SRC`); Hub `test/systemd-runtime.test.sh` (`CONSOLE_SRC`); Terminal and Hub `test/environment-gating.test.sh`                                      | The trees went from depth 2 to depth 4, so `${ROOT}/../..` became `infra/edge`. Changed to `${ROOT}/../../../..`                                           |
| **Ignore rules**                        | `.gitignore` (device-shell `dist/` and `dist-electron/` re-include + comment); `.prettierignore` and `eslint.config.mjs` (added `infra/edge/raspberry-pi/*/out/**`; the one-level `infra/*/out/**` does not reach depth 4 and is kept for the old `out/` still on disk) | Without the `.gitignore` update, the next repackaged Device Shell file would be silently untracked                                                         |
| **Pinned secret-scan exception**        | `scripts/verification/secret-scan.mjs`                                                                                                                                                                                                                                  | Exact-path pin for the packaged Hub migration 0038; the scan would fail otherwise                                                                          |
| **Cross-tree test path**                | `apps/kitluy-device-shell/test/electron-pin.test.ts`                                                                                                                                                                                                                    | The test compares the app's Electron with the image pin by path                                                                                            |
| **Refusal message + its assertion**     | Terminal `scripts/build-rpi-image.sh` (`--profile store-hub` refusal names the Hub path); Terminal `test/environment-gating.test.sh` (asserts it)                                                                                                                       | Same refusal; the message now names the real Hub path                                                                                                      |
| Usage lines, READMEs, comments          | `doctor.sh`, `setup-ubuntu-arm64-builder.sh`, `fetch-electron.sh`, every `test/*.test.sh` usage line, both READMEs (+ location note), both `upstream.pin`, `electron.pin`, `rpi-image-gen/config/*.yaml`, `layer/kitluy-base.yaml`                                      | Text only                                                                                                                                                  |
| Shipped text, no semantic effect        | 4 Hub units' `Documentation=` (`kitluy-hub-agent`, `kitluy-hub-database`, `kitluy-hub-storage`, `var-lib-kitluy-hub.mount`); Terminal `runtime-manifest.json` `$comment[2]`                                                                                             | Neither old nor new `Documentation=` value is a URI, so systemd treats them the same way; the manifest differs from HEAD only at JSON path `$.$comment[2]` |
| Source comments + packaged closures     | `services/kitluy-device-firstboot-agent/src/{index,enrollment-pop-bytes,operational-csr-bytes,adapters/device-identity-store}.ts`; the 5 closure copies regenerated by packaging                                                                                        | Comment lines only                                                                                                                                         |
| Navigation docs                         | `docs/authority/LOCAL_DOCUMENTATION_MAP.md`, `docs/authority/LEGACY_REPOSITORY_TO_MONOREPO_MAP.md` (keeps the old name in brackets)                                                                                                                                     | —                                                                                                                                                          |
| Registers                               | Decision register: new entry; evidence register: path-migration note above the machine-checked table, **no status changed**                                                                                                                                             | —                                                                                                                                                          |

**Not changed, deliberately:** the `[kitluy-os-image]` / `[kitluy-store-hub-image]`
log prefixes in `scripts/lib/common.sh`, `build-image.sh` and `build-rpi-image.sh`.
They are component tags, not paths, and changing them changes build output text.
See §8.

## 4. Stale-path audit after the move

Search `infra/kitluy-os-image|infra/kitluy-store-hub-image` over tracked files,
including this handoff and the index:

| Class                          | Where                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. historical record**       | `00_AI_HANDOFF/**` handoffs 00–44 and the older index entries; `docs/reports/**` (dated); `docs/decisions/**`; `docs/source/**` owner originals (CODEOWNERS copy, rebuild bible, blueprint, imported specs; conflict recorded, not rewritten); dated decision-register entries; evidence-register rows; `infra/IMAGE-CLEANUP-2026-08-19.txt` (its artifacts still sit at those paths) |
| **B. explicit migration note** | `infra/edge/raspberry-pi/README.md` (path history); both image READMEs (location note); the new decision-register entry; the evidence-register note; `LEGACY_REPOSITORY_TO_MONOREPO_MAP.md`; this handoff; its index entry                                                                                                                                                            |
| **C. active stale reference**  | **0**                                                                                                                                                                                                                                                                                                                                                                                 |

Counts, taken from the staged tree before commit: **56 files, 210 occurrences. A = 189, B = 21, C = 0.**
The decision register (5 A + 4 B), the evidence register (5 A + 2 B) and the index (2 A + 2 B) hold both classes.

**Outside this repository (not modified; workspace boundary):**
`workspace-control/repository-registry.json:191` describes `infra/` as
"terraform, digitalocean, kubernetes, kitluy-os-image". It is a description, not a
consumer. No script, CI workflow or package script referenced either old path.
`.github/workflows/infra.yml` triggers on `infra/**`, which still matches.

## 5. Verification

### Baseline first, at the old paths, before any change

Ran every image suite at `b2d33c6`. The results matched handoff 44 §9 exactly.

### Before fixing depth: what a path-only move breaks

After `git mv` and before any path edit, run from the new location:

| Suite / step                   | Result                                                                                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Terminal `systemd-runtime`     | 234 / **1 failed** (Electron pin vs app: `REPO_ROOT` pointed at `infra/edge`)                                                                                                                                            |
| Terminal `environment-gating`  | 19 / **1 failed** (`AGENT_SRC`)                                                                                                                                                                                          |
| Hub `environment-gating`       | 18 / **1 failed** (`hub-agent.ts`)                                                                                                                                                                                       |
| **Hub `systemd-runtime`**      | **179 / 0, a silent pass**: the four "console: no selection step" checks run `grep -r … 2>/dev/null` over a directory that no longer resolved, and an absent directory counts as PASS. Terminal has the same four checks |
| `package-bootstrap-runtime.sh` | **REFUSED**: `infra/edge/services/kitluy-device-firstboot-agent/dist is absent`                                                                                                                                          |

So the depth fixes were checked by resolving each path, not by rerunning suites
until they passed. After the fix, each `CONSOLE_SRC` grep scans **13** real files.

### After the move

| Check                                                                                                                    | Pi Terminal                                                  | Store Hub                                            | vs baseline                     |
| ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------- |
| `test/build-gates.test.sh`                                                                                               | 62 / 0                                                       | 34 / 0                                               | every PASS/FAIL line identical  |
| `test/environment-gating.test.sh`                                                                                        | 20 / 0                                                       | 19 / 0                                               | identical                       |
| `test/systemd-runtime.test.sh`                                                                                           | 235 / 0                                                      | 179 / 0                                              | identical                       |
| `test/storage-posture.test.sh`                                                                                           | —                                                            | 33 / 0                                               | identical                       |
| `test/rpi-image-gen.test.sh`, `KITLUY_RIG_UPSTREAM` = pre-move checkout                                                  | 29 / 0                                                       | 28 / 0                                               | identical                       |
| `test/rpi-image-gen.test.sh`, no upstream at the new path                                                                | 23 / 0 / 1 skipped                                           | 22 / 0 / 1 skipped                                   | the skip is the absent checkout |
| `test/image-contents.test.sh`, auto-discovery                                                                            | **SKIP** (no rootfs under the new path)                      | **SKIP**                                             | no evidence                     |
| `test/image-contents.test.sh <absolute pre-move rootfs>`                                                                 | 108 / 3                                                      | 53 / 3                                               | identical (see note)            |
| `scripts/doctor.sh`                                                                                                      | 12 / 0 / 0 warnings                                          | 12 / 0 / 0 warnings                                  | —                               |
| `scripts/package-bootstrap-runtime.sh`                                                                                   | OK: 50 js + Device Shell; manifest cross-check 12 components | OK: 46 js + 43 migrations + 409 KiB Hub agent bundle | —                               |
| Build-script resolution (`KITLUY_OS_IMAGE_ROOT`, pin, `config/image.conf`, `rpi-image-gen/config/kitluy-<profile>.yaml`) | new project root; `kitluy-pi-terminal.yaml` selected         | new project root; `kitluy-store-hub.yaml` selected   | —                               |
| Upstream pin (non-comment lines vs HEAD)                                                                                 | identical: `v2.7.0` / `a7b6d48…`                             | identical                                            | —                               |
| Runtime manifest vs HEAD                                                                                                 | only `$.$comment[2]` differs                                 | byte-identical                                       | components unchanged            |

- **Packaging is byte-identical.** Re-packaging from the new paths regenerated every committed closure, the Device Shell `dist/` and `dist-electron/`, the Hub agent bundle and all 43 Hub migrations. The only differences were the 5 updated comment lines, and no file mode changed.
- **The 3 `image-contents` failures per tree are pre-existing (handoff 44 §9).** The rootfs was built on 2026-09-15 from the **old** paths, before `65678a4`, so it lacks `boot-classification`. It is used only to show the suite's path handling is unchanged. It is **not** evidence of any build from the new paths.
- **Pass an absolute rootfs path.** A relative path makes a false "device shell: its declared main is in the image" failure, because `node -e 'require(<relative path>)'` resolves it as a module name. That happens at the old path too, so it is pre-existing (§8).

Other checks:

- `pnpm secret:scan`: passed (2306 tracked files).
- `pnpm docs:registry-check`: OK (69 rows).
- `pnpm docs:check`: only the 4 pre-existing broken UUID links; the new links resolve.
- `apps/kitluy-device-shell` `electron-pin.test.ts`: 6/6.
- `prettier --check` on every changed file: clean, except `device-identity-store.ts`, which is already unformatted at HEAD (§6).

### `pnpm verify`

Ran at the final working tree. **Exit 1.** The failures are the same three steps, with the same causes, as handoff 44 §9.

| Step                                                                                                           | Result                                                                                                                                                                                                                                                                     | Pre-existing?                          |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Format check                                                                                                   | FAIL: EACCES on `infra/kitluy-os-image/build/work/chroot-v2.7.0/filesystem/persistent/home/pi`                                                                                                                                                                             | yes (handoff 44: same step, same tree) |
| Lint                                                                                                           | PASS: 0 errors, 8 warnings (unused `eslint-disable` in files this task did not touch)                                                                                                                                                                                      | —                                      |
| Typecheck                                                                                                      | PASS                                                                                                                                                                                                                                                                       | —                                      |
| Unit tests                                                                                                     | FAIL: `@kitluy/device-identity` `governed-emergency-concurrency` and `scope-consumption-concurrency` refuse because `kitluy_credential_issuer is ALREADY granted to this login` (handoff 39 §7, 44 §9). Turbo then stopped; the touched packages were run directly (below) | yes                                    |
| Contract tests, Offline harness, Build, OpenAPI, Migration, Hub migration validation, Secret scan, Clock usage | PASS                                                                                                                                                                                                                                                                       | —                                      |
| Docs link check                                                                                                | FAIL: the same 4 UUID links in `00_AI_HANDOFF/shared/2026-07-30__SHARED__WS-11-T003-STEP4__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`; no new broken link                                                                                                                      | yes                                    |

Touched packages, run directly because turbo stopped first:

- `apps/kitluy-device-shell` full suite: **147/147** (12 files, including `electron-pin.test.ts` at the new path).
- `services/kitluy-device-firstboot-agent` full suite: **804 passed, 2 failed, 9 skipped**. Handoff 44 had 805 passed, 1 failed. Neither failure comes from this change: in this package the task only changed four comment lines, and both failing tests call SQL doors directly.
  - `hub-provisioning-e2e.db` is the pre-existing failure from handoffs 39, 43 and 44.
  - `device-registration-continuity.db` "refuses to reclaim a device from a MAC address alone" is an **intermittent data collision**. The test seeds MAC `02:<one random byte>:00:00:00:01` (256 values) into a local database that keeps devices from earlier runs. A reused MAC correctly yields `TRUST_REVIEW_REQUIRED`. Re-run alone twice, it passed **20/20** both times. Worth widening the random part (§8).

### Images rebuilt: **NO**

What was verified without a build:

- Packaging runs from both new paths and reproduces the committed overlays byte for byte.
- Every build-script root resolves to its own project.
- Profile config selection resolves.
- The pin validates.
- The `rpi-image-gen` config and layer YAML contain no repository-relative paths.

The builder consumes `-S <project>/rpi-image-gen`, which is self-relative. What
remains unexercised is `rpi-image-gen` actually running from the new `-S` path.
The first real build (§9) covers it. There are 61 GB free; two builds add about
35 GB of work trees on top of the 68 GB left at the old paths.

## 6. Pre-existing failures (not caused by this task)

- `pnpm verify` **Format check**: EACCES in `infra/kitluy-os-image/build/work/chroot-v2.7.0/filesystem/persistent/home/pi` (the rootless build tree, still at the old path). Prettier stops expanding `.` there, so "All matched files use Prettier code style" does not cover the repository.
- `services/kitluy-device-firstboot-agent/src/adapters/device-identity-store.ts` is **not** Prettier-formatted **at HEAD** (import and constructor wrapping). It was not reformatted here: only its path comment changed.
- The rest of `pnpm verify` is in §5, compared with handoff 44 §9.

## 7. Hardware

**NOT PERFORMED.** No board was powered, flashed or contacted. Nothing here
changes what a device runs.

## 8. Remaining cleanup opportunities (not done; out of scope)

1. **Old generated trees:** once the owner approves, delete or archive `infra/kitluy-os-image/` and `infra/kitluy-store-hub-image/`, which now hold only `build/` and `out/`. Then drop `infra/*/out/**` from `.prettierignore` and `eslint.config.mjs`, if no other depth-1 `out/` exists.
2. **Log prefixes:** `[kitluy-os-image]` and `[kitluy-store-hub-image]` could become `[pi-terminal-image]` and `[store-hub-image]`. That changes build output text, and anyone grepping logs must be told.
3. **Stale Hub README title:** `store-hub-image/README.md` is still titled "KitLuy OS image (Store Hub / Pi terminals)".
4. **Stale Hub files in the Terminal tree:** `config/profiles/store-hub.conf`, `rpi-image-gen/config/kitluy-store-hub.yaml`, `rpi-image-gen/layer/kitluy-store-hub.yaml`, `scripts/profiles/store-hub.sh`. The Terminal README says they are kept for record and cannot be built; deletion awaits owner approval.
5. **Silent-pass test:** the `CONSOLE_SRC` checks in both `systemd-runtime` suites should FAIL when the source directory is absent.
6. **`image-contents` with a relative path:** resolve the argument to an absolute path before `require`.
7. **Flaky MAC fixture:** `device-registration-continuity.db.test.ts` test E uses one random MAC byte; widen it so reruns on a long-lived local database do not collide.
8. **Prettier and rootless trees:** add `**/build/work/` to `.prettierignore` so `format:check` stops failing on EACCES.
9. **Duplication for a future `shared/`** (measured, not extracted):
   - Byte-identical: `config/image.conf`, and 50 of the 64 files present in both base overlays.
   - Near-identical: `scripts/doctor.sh` (8 differing lines), `scripts/setup-ubuntu-arm64-builder.sh` (6), `scripts/build-image.sh` (6), `scripts/lib/common.sh` (11), `scripts/profiles/base.sh` (2).
   - Far apart: `build-rpi-image.sh`, `package-bootstrap-runtime.sh` and every test suite differ by hundreds of lines.
10. **Owner confirmation:** fold the new location into the next RB §14.2 and monorepo blueprint revision (`KLREC-2026-09-16-EDGE-IMAGE-SOURCE-PATHS-001`).

## 9. Exact next task

Unchanged from handoff 44 §13, and it now also gives this move its image evidence:

1. REFLASH-HARDENING-001 hardware gate (handoff 43 §8 steps 4–7).
2. Rebuild **both** images from `infra/edge/raspberry-pi/{pi-terminal-image,store-hub-image}` at or after this commit, unsandboxed, with the preflight inputs in the image READMEs.
3. Confirm the build clones the pinned builder into the **new** `build/upstream` and writes `build/work` under the new project.
4. Run `test/image-contents.test.sh` with auto-discovery: expect the 3 boot-classification checks per tree to pass.
5. Read `boot-classification` back from each erofs `system_a` (handoff 40 technique).

Only then do both this refactor and `65678a4` become **IMAGE VERIFIED**.

## 10. Git

| Commit      | What                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------- |
| `PENDING`   | 293 renames; path and depth fixes; ignore rules; secret-scan pin; navigation README; registers; this handoff; the index |
| this commit | records the implementation SHA in this handoff and the index                                                            |

Pushed to `provisioning` `dev`. `main` unchanged. Not included:
`scripts/development/issue-dev-pairing-code.mjs`, an uncommitted PG 15 fix that
predates this session (also excluded in handoff 44).
