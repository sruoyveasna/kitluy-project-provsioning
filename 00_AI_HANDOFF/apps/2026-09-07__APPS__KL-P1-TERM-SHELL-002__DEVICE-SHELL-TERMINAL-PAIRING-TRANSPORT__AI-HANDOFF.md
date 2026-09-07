# KitLuy Task Handoff

## 0. Identity

| Field              | Value                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| Task ID            | `KL-P1-TERM-SHELL-002`                                                    |
| Task title         | Device Shell terminal pairing transport (Phase 3 of Slice 1B)             |
| Product/build      | `kitluy-device-shell`, `kitluy-device-firstboot-agent`, `kitluy-os-image` |
| Primary agent      | Claude Opus 5 (1M context)                                                |
| Status             | `PARTIAL` — transport built and tested; not yet shipped in the image      |
| Branch             | `claude/fix-firstboot-esm-and-ssh-hostkeys`                               |
| Worktree           | `repos/het-kitluy-project` (no worktree)                                  |
| Base commit        | `0a30a74`                                                                 |
| Final commit       | `8f16cc3`                                                                 |
| Handoff date       | `2026-09-07`                                                              |
| Requested reviewer | Owner (Veasna) — independent review before any hardware run               |

## 1. Outcome

A Pi Terminal can now present a pairing code. The cloud half has been complete
since Slice 2B; the evidence register recorded the missing half as **"no Pi has
typed a code"**, and that is the gap this closes at the source level.

Three commits, in order:

| Commit    | What                                                                             |
| --------- | -------------------------------------------------------------------------------- |
| `68e0249` | Baseline: the 312-entry working tree committed, build-critical files tracked     |
| `3198a37` | Two verification gates that were not guarding what they claimed                  |
| `8f16cc3` | The terminal pairing transport, the shell wiring, and a blocker found on the way |

**Not claimed:** the Device Shell is still not in the flashable image, and no
hardware ran any of this.

## 2. Source-of-truth checked

| Source                               | Version/commit | Section/path                   | Result                             |
| ------------------------------------ | -------------- | ------------------------------ | ---------------------------------- |
| `terminal-pairing-routes.ts`         | working tree   | request/response contract      | aligned (drift-tested)             |
| `terminal-pairing-composition.ts`    | working tree   | `TerminalPairingContext`       | aligned                            |
| migration 0191 / 0213                | working tree   | `hub_claim_code_alphabet_v1()` | aligned — identical alphabet       |
| `kitluy-terminal-session.service`    | working tree   | `User=`, `ReadWritePaths=`     | aligned                            |
| `sysusers.d/60-kitluy-terminal.conf` | working tree   | kiosk user home                | aligned                            |
| evidence register                    | v1.0.0         | Slice 2B row                   | aligned — "no Pi has typed a code" |

## 3. Files inspected

- `services/kitluy-device-registry-service/src/terminal-pairing-{routes,composition}.ts`
- `services/kitluy-device-firstboot-agent/src/{pairing-state,registration-state,bootstrap-state}.ts`
- `services/kitluy-device-firstboot-agent/src/adapters/http-registration-client.ts`
- `apps/kitluy-device-shell/electron/*`, `src/model/*`
- `infra/kitluy-os-image/rpi-image-gen/layer/kitluy-{base,pi-terminal}.yaml` and both overlays

## 4. Files changed

| Path                                                            | Change summary                             | Why                             | Generated? |
| --------------------------------------------------------------- | ------------------------------------------ | ------------------------------- | ---------- |
| `…firstboot-agent/src/adapters/http-terminal-pairing-client.ts` | NEW — the pairing transport                | the device had none             | no         |
| `…firstboot-agent/test/http-terminal-pairing-client.test.ts`    | NEW — 17 tests incl. registry drift        | contract must not drift         | no         |
| `…firstboot-agent/src/{registration,pairing}-state.ts`          | 0640 → 0644 write mode                     | the shell could not read them   | no         |
| `…firstboot-agent/test/display-state-readability.test.ts`       | NEW — 4 tests                              | pin readable-not-writable       | no         |
| `…firstboot-agent/test/factory-qa-durability.db.test.ts`        | assertion re-pointed at 0214               | asserted 0188's retired wording | no         |
| `apps/kitluy-device-shell/electron/pairing.ts`                  | NEW — the pairing action                   | decisions around the transport  | no         |
| `apps/kitluy-device-shell/electron/terminal-assignment.ts`      | NEW — the seat on disk                     | survive a reboot                | no         |
| `apps/kitluy-device-shell/electron/main.ts`                     | stub → real transport, loaded from closure | close the gap                   | no         |
| `apps/kitluy-device-shell/electron/device-state-files.ts`       | read the seat into the snapshot            | drive the `assigned` screen     | no         |
| `apps/kitluy-device-shell/src/model/shell-state.ts`             | `AssignmentView`, `assignmentBelongsTo`    | derive `assigned`               | no         |
| `apps/kitluy-device-shell/src/bridge.ts`                        | the status contract is no longer a stub    | comment was false               | no         |
| `apps/kitluy-device-shell/test/pairing.test.ts`                 | NEW — 12 tests                             | cover the decisions             | no         |
| `infra/kitluy-os-image/scripts/package-bootstrap-runtime.sh`    | ship the client + `pairing-state`          | main.ts loads it from there     | no         |
| `infra/kitluy-os-image/.../firstboot-agent/*.js`                | repackaged closure                         | packager output                 | **yes**    |
| `infra/kitluy-{os,store-hub}-image/test/rpi-image-gen.test.sh`  | config-key corpus reads layer META         | gate failed on a correct config | no         |
| `apps/kitluy-{admin,partner}-pwa-portal/test/smoke.test.tsx`    | state the unconfigured premise             | guard was env-dependent         | no         |
| `apps/kitluy-admin-pwa-portal/src/App.tsx`                      | `import.meta.env` read without a cast      | cast escaped Vite's rewrite     | no         |
| `scripts/verification/secret-scan.mjs`                          | 3 checksum-pinned refusal fixtures         | PEM headers in refusal tests    | no         |
| `.gitignore`                                                    | ignore `dist-bundle/`                      | build intermediate              | no         |

### Allowlist verification

`PASS` — changes confined to `apps/kitluy-device-shell`, the two portals'
tests, `services/kitluy-device-firstboot-agent`, both image trees and the
repository-level verification scripts. No standalone repository was touched, no
HSA repository was touched, and no migration was written or applied.

## 5. Implementation details

### Functional behavior

`POST /v1/terminal-pairing` with exactly `{ deviceRecordId, code }`. Store,
Location, Hub, seat, roles and vertical all come **back** — the image stays
byte-identical across the fleet. Pairing does **not** activate: `activated`
is false unless the registry advanced trust in the same call, and no screen may
read the seat as "ready to sell".

Refusals stay distinct because the operator action differs: `CODE_REFUSED` (try
again), `LOCKED` (ask for a new code), `ALREADY_ASSIGNED` (not solvable at this
Pi). `phaseForRefusal` maps them once, beside the vocabulary it translates.

A pairing the cloud accepted but the device failed to persist reports
`PAIRING_NOT_RECORDED`, non-retryable — the seat exists but this board cannot
prove it after a reboot, and reporting success would strand the installer.

### Schema/data/migrations

`NONE`. No migration written, none applied, no database touched.

### APIs/events/jobs/webhooks

Consumes the existing `POST /v1/terminal-pairing`. No new contract.

### Permissions/audit/security

- The pairing code is a live shared secret: sent in one request body, never
  logged, never persisted, never returned. Asserted by test.
- `registration-state.json` / `pairing-state.json` moved 0640 → **0644**. These
  are display state by construction (phase, public asset tag, server ids, an
  operator sentence). `bootstrap-state.json` has been 0644 since it was written.
  A test asserts world-**readable** and not group/world-**writable** on all
  three — the kiosk user must not be able to forge the state it renders.
- The private key is unaffected and stays 0600 (`firstboot-executable.test.ts`).
- `assignment.json` is 0600 in the kiosk user's own directory: one reader, one
  writer, one user.

### Offline/Store Hub/device impact

The Store Hub is untouched. The terminal writes only inside
`/var/lib/kitluy/terminal`, which `kitluy-terminal-session.service` already
grants and the terminal layer's clone-hygiene hook already deletes from the
golden image.

### UI/localization/accessibility

No new UI. The existing keypad now receives real status codes instead of
`PAIRING_NOT_AVAILABLE_IN_THIS_BUILD`, and `deriveScreen` can reach `assigned`.
No new strings were added, so no new translations are pending.

### Observability/runbooks/docs

This handoff, the index entry, and the evidence-register row.

## 6. Acceptance criteria evidence

| AC ID   | Result    | Evidence reference                              | Notes                                     |
| ------- | --------- | ----------------------------------------------- | ----------------------------------------- |
| `AC-01` | `PASS`    | `http-terminal-pairing-client.test.ts` 17/17    | contract + registry drift                 |
| `AC-02` | `PASS`    | `pairing.test.ts` 12/12                         | the shell's decisions                     |
| `AC-03` | `PASS`    | `display-state-readability.test.ts` 4/4         | the shell can read what it renders        |
| `AC-04` | `PASS`    | packager run; module loads from the device path | `createHttpTerminalPairingClient` present |
| `AC-05` | `NOT RUN` | —                                               | shell not in the image; no hardware run   |

## 7. Validation performed

| Command/check                                | Environment | Result | Evidence                           |
| -------------------------------------------- | ----------- | ------ | ---------------------------------- |
| firstboot-agent `vitest run`                 | local       | `PASS` | 455 passed / 9 skipped             |
| device-shell `vitest run`                    | local       | `PASS` | 66/66                              |
| device-shell `typecheck` + `build`           | local       | `PASS` | tsc clean, vite built              |
| admin portal `test` / `typecheck`            | local       | `PASS` | 107/107                            |
| partner portal `test` / `typecheck`          | local       | `PASS` | 56/56                              |
| terminal image: 5 suites                     | local       | `PASS` | 294 passed / 0 / 1 skip            |
| Store Hub image: 6 suites                    | local       | `PASS` | 291 passed / 0 / 1 skip            |
| `rpi-image-gen.test.sh` **with** upstream    | local       | `PASS` | hub 28/0 (was 27/1), terminal 29/0 |
| `package-bootstrap-runtime.sh`               | local       | `PASS` | 18 js files, manifest cross-check  |
| `pnpm secret:scan`                           | local       | `PASS` | 2089 tracked files                 |
| `scan-image-secrets.sh` (both overlays)      | local       | `PASS` | 16/0 each                          |
| `eslint`, `prettier --check` (changed files) | local       | `PASS` | 0 errors                           |

### `pnpm verify` — the actual result

`FAIL` overall, on **3 steps, all pre-existing and all named in the evidence
register's prior baseline**. The baseline was 4; `Lint` now passes because this
task fixed the one error it reported.

| Step            | Result | Cause                                                                                                                                                                                                              |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Format check    | `FAIL` | `EACCES` scanning `infra/kitluy-os-image/build/work/.../persistent/home/pi`, a rootless build tree. Prettier itself reports "All matched files use Prettier code style!" — there is no formatting defect.          |
| Lint            | `PASS` | **was FAIL** — unused `error` binding in `scripts/database/apply-dev-supautils-hint-workaround.mjs`, fixed here                                                                                                    |
| Unit tests      | `FAIL` | `@kitluy/device-identity` `governed-emergency-concurrency` and `scope-consumption-concurrency` — the two concurrency suites the register already records. `packages/device-identity` was not touched by this task. |
| Docs link check | `FAIL` | 4 broken links in `00_AI_HANDOFF/shared/2026-07-30__…__PHASE-E-PROMOTION-GATE__AI-HANDOFF.md`                                                                                                                      |

Everything else passes: Typecheck, Contract tests, Offline harness, Build,
OpenAPI validation, Migration validation, Hub migration validation, Secret scan,
Clock usage.

## 8. Not run / not verified

- **The Device Shell is not in the image.** Shipping it needs the pinned arm64
  Electron, `cage`, a session unit, and the `runtime-manifest.json` `tty1` flip
  (`owner` → `successor`). None of that is done.
- **No hardware run.** No Pi has typed a code. AC-05 stands `NOT RUN`, and the
  register row must not be advanced past that.
- **No live registry call.** The transport is proven against its contract and a
  drift test, not against a running device-registry service.
- `image-contents.test.sh` was run against the **previously built** rootfs; it
  does not yet assert the new module because no image has been rebuilt.

## 9. Risks and known limitations

| Severity | Risk/limitation                                                                 | Impact                                                      | Mitigation/follow-up                                                                                         |
| -------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| MEDIUM   | 0644 widens who can read device display state on the appliance                  | any local account can read phase/asset tag                  | non-secret by construction; writable bit refused by test; review if an untrusted local account is ever added |
| MEDIUM   | The shell loads the transport from an absolute device path                      | a mispackaged image answers `PAIRING_TRANSPORT_UNAVAILABLE` | it fails loudly and refuses rather than pretending; packaged by the same script that owns the closure        |
| LOW      | `assignment.json` and the Hub's `pairing-state.json` are two files, one meaning | a future reader must check both                             | `deriveScreen` checks both; recorded in both file headers                                                    |
| LOW      | `device-registration-continuity.db.test.ts` is flaky in the concurrent full run | noisy verification                                          | pre-existing; passes 20/20 alone; needs DB fixture isolation                                                 |

## 10. Blockers and open decisions

- **BLK-005** (PKI/HSM signer custody) still gates the Store Hub's LAN listener
  outside `development`, so a paired terminal still cannot reach a Hub in pilot
  or production. Unchanged by this work and **not** a coding task.
- **DEC-1** keeps the POS application a governed release outside the image.
- Open decision for the packaging slice: whether the Device Shell replaces
  `kitluy-bootstrap-screen.service` on tty1 or coexists with it. The manifest
  models the flip; nobody has taken the decision.

## 11. Rollback / recovery

- Rollback record: revert `8f16cc3`. It is self-contained; `3198a37` and
  `68e0249` stand alone and need not be reverted with it.
- Recovery caveats: the 0644 mode change is in `8f16cc3`. Reverting it restores
  the condition where the Device Shell cannot read the state it renders — so if
  the shell ever ships, that commit must not be reverted alone.

## 12. Review focus

- **The 0640 → 0644 decision.** It is the one security-posture change here.
- **`PAIRING_NOT_RECORDED`** — is refusing a granted-but-unsaved seat the
  behaviour the owner wants, or should the device retry the write?
- **Two files, one meaning** (`assignment.json` vs `pairing-state.json`).
- The `import.meta.env` cast finding in `3198a37`: the same shape may exist
  elsewhere and would silently disable env substitution there too.

## 13. Next step

Independent review, then the packaging slice: arm64 Electron + `cage`, the
session unit, the `tty1` flip, an image build, and only then a hardware run.

## 14. Truth statement

- Production modified by primary coding agent: `NO`.
- Secrets included in code/handoff/evidence: `NO`.
- Capability claimed `IMPLEMENTED`: `NO`. The transport is
  `IMPLEMENTED-IN-DEV (source and tests)`; end-to-end terminal pairing on
  hardware remains `NOT RUN`.
