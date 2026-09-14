# U1 — release-assignment ordering, Phase 5 completion, and the end-to-end chain

| Field      | Value                                                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-11 · Asia/Phnom_Penh                                                                                               |
| Status     | **SOURCE IMPLEMENTED + TESTED-IN-DEV + CHAIN-PROVEN FROM THE WORKSTATION.** Not `IMAGE VERIFIED`, not `HARDWARE VERIFIED`. |
| Committed  | **No.** Nothing committed or pushed.                                                                                       |
| Stop point | Phase 4 image integration and the reflash have **not** begun.                                                              |
| Rulings    | OD-U1-1 = A · OD-U1-2 = C · OD-U1-3 = A, all unchanged                                                                     |

---

## 1. The release-assignment ordering solution

### What was searched, and what was found

Every column of every `kitluy_releases` table, the hub migration set, and
`@kitluy/release-manifests`:

| Table                  | Ordering available                                |
| ---------------------- | ------------------------------------------------- |
| `release_artifacts`    | none — uuid id + timestamps                       |
| `rollout_campaigns`    | none — uuid id + `idempotency_key` + `started_at` |
| `device_installations` | none — uuid id, unique `(campaign_id, device_id)` |
| `release_events`       | none — uuid id + `occurred_at`                    |

Group `0182` is called **"assignment identity"** and is not this: it corrected
`assign_release_v1` so an idempotency key identifies ONE request, after a
reviewer found a key reused across devices silently dropped every device after
the first. It adds no ordering.

**Confirmed: no authoritative release-assignment sequence existed.**

`kitluy_devices.device_assignments.assignment_generation` was re-examined and
**rejected for this job**, exactly as you said: it orders the device's _Store
binding_, so two release assignments to one device in one Store carry the same
generation.

### What was implemented — cloud group 0221

```sql
alter table kitluy_releases.device_installations
  add column if not exists assignment_sequence bigint generated always as identity;
```

on `device_installations` — the authoritative per-device release-assignment row.
Plus an index on `(device_id, assignment_sequence desc)` and one governed reader:

```sql
kitluy_releases.current_device_assignment_v1(p_device_id uuid) returns jsonb
```

which returns the highest-sequence eligible assignment together with the **signed
manifest columns and the signature envelope**, so the transport carrying the
answer is never trusted for its content. It excludes revoked, paused and draft
artifacts and cancelled campaigns.

**Why an identity column:** a database sequence is strictly increasing, never
reused, and `always` means no caller can supply one — so a replay cannot mint a
high sequence for an old assignment. No timestamp is involved. It is the
repository's own existing idiom (`sequence_no bigint generated always as
identity` appears in groups 0133, 0134, 0136, 0138, 0152).

**The governed downgrade still works, and is tested.** Assigning an older
release creates a NEW `device_installations` row, which takes a HIGHER sequence.
Nothing anywhere compares version strings. Chain check step 11–12 proves both
halves: the newer-sequence/older-version assignment installs, and replaying the
earlier one is refused `ASSIGNMENT_STALE`.

**The device field was renamed** from `assignmentGeneration` to
`assignmentSequence` (and `lastAssignmentGeneration` → `lastAssignmentSequence`).
Keeping the old name would have left two different things called a "generation"
one line apart.

**`supersededReleaseIds` / `failedRolledBackReleaseIds` were kept**, no longer as
the primary mechanism but as a second independent line: they cost one array
lookup and they hold even if a stack were restored from a backup that rewound the
sequence, because the device's own journal remembers what it installed.

**Two notes worth recording:**

1. Writing this migration, `pnpm migrations:validate` refused it — the validator
   matches `ALTER TABLE … <destructive verb>` across the whole file, and my
   comment _promising_ the absence of those verbs was what made it read as
   destructive. The comment now says so.
2. `device_installations` is owned by `kitluy_release_governor`, so the migration
   borrows that role exactly as group 0180 does rather than inventing a second
   mechanism.

---

## 2. The development environment used — one, explicitly

**`127.0.0.1:54372` — the `kitluy-fresh` local stack (API `:54371`).**

Chosen because **that is where the two physical boards live**:

```
KL-1054DD1CCC8E   terminal    active
KL-97A30575BCB7   store_hub   active
```

Using anything else would have meant switching stacks between workstation
testing and hardware acceptance — the mixing you ruled out.

**What was rejected, and why it matters:**

| Stack                       | Why not                                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:54392`                    | The canonical `LOCAL_DSN` in `dev-target.mjs`, but it holds **9 821 synthetic `WS11-T001-*` fixtures** and neither real board. It is a test-fixture stack. It is also 10 migrations behind, including `0189`, which the BRINGUP-001 handoff records as **unappliable on this image**. |
| `:54322`, `:54332`          | Not KitLuy — no `kitluy_releases` schema. `:54322` is the stack recorded as defect D-04.                                                                                                                                                                                              |
| hosted `kitluy-project-pos` | A hosted **write**, which needs `pnpm db:deploy:hosted-dev` and explicit authorisation. Not done.                                                                                                                                                                                     |

**How the tools are pinned to it:** every release tool resolves through the
existing `dev-target.mjs` (`KITLUY_DEV_FLEET_DSN` first), so the fleet service
and the release service cannot disagree — that is defect D-22 one layer up.
`assertReleaseCapable` then refuses a target that does not carry group 0221, and
every tool **prints the target label before it acts**.

```bash
export KITLUY_DEV_FLEET_DSN="postgresql://postgres:postgres@127.0.0.1:54372/postgres"
export KITLUY_DEV_PKI_DIR="../../local-config/het-kitluy-project/dev-pki"
export KITLUY_DEV_TERMINAL_ASSET_TAG="KL-1054DD1CCC8E"
```

> **Drift recorded, not fixed:** `:54372` is missing repo migrations
> `0217`–`0220`. Group 0221 is purely additive and depends on none of them, so
> only 0221 was applied. Applying the other four would have touched device
> approval and pairing on a stack whose terminal is **already active and
> paired**, for zero U1 benefit. Flagged rather than silently done.

---

## 3. Does publish / assign / serve work end to end?

**Yes — 23/23, against the real database, the real signing key, the real HTTP
service and the BUILT device closure.**

```
pnpm release:chain:check

 1. pack                     ok  artifact + sha256
 2. create release           ok  the DATABASE minted the release id
 3. sign                     ok  the manifest carries the database's id
 4. promote internal         ok  no approver, no PKI gate
    pilot refused            ok  KLUY-RELEASE-UNAPPROVED
 5. assign                   ok  one device, governed idempotency key
 6. governed assignment read ok  returns this release, monotonic sequence
 7. retrieve over HTTP       ok  the DEVICE's own client; sequence matches
 8. verify manifest          ok  the device's verifier accepts the signature
    acceptance gate          ok  accepted for this device class
 9. retrieve bytes           ok  whole; digest re-proven against the SIGNED manifest
10. extract                  ok  the device's safe extractor; payload intact
11. second assignment        ok  strictly higher sequence
12. replay refused           ok  ASSIGNMENT_STALE; newer-but-older-version installs

release chain: 23/23 passed
```

### The integration defect this found, which no unit test could

**The database mints the release id; the packer was inventing one and signing
it.** `create_release_draft_v1` generates `release_artifacts.id` as a uuid, and
`current_device_assignment_v1` hands that uuid to the device _as the manifest's
`releaseId`_. A locally invented id would have been covered by the signature
while the device checked a different one — **every genuine release refused
`ASSIGNMENT_RELEASE_ID_MISMATCH`**, on hardware, with the signature looking
perfectly valid.

The packer was restructured: `packRelease()` now describes the artifact without
an id, and `buildManifest(packed, releaseId)` joins the two halves after the
draft exists. The forced order is now written into `release-publish.mjs`.

### Cleanup

The chain check creates real governed releases. Release rows are append-only and
**no governed door cancels a rollout campaign** — so the synthetic releases were
withdrawn with `revoke_release_v1` (requester and approver distinct, as the door
demands), which correctly removes them from
`current_device_assignment_v1`. **The terminal is back to no assignment.**

> **Gap recorded:** there is no `cancel_campaign_v1`. Revocation is the only way
> to withdraw an assignment, which is heavier than "stop this rollout". Worth a
> door before U6; not built here.

---

## 4. Phase 5, now complete

| Piece                                      | State                                                                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-pack.mjs`                         | packs a reproducible ustar (fixed mtime, sorted, uid/gid 0, no symlinks by construction), gzip, `buildId` = git SHA + dirty flag                |
| `release-publish.mjs`                      | pack → draft → sign → promote internal → assign, target printed first                                                                           |
| `release-service.mjs`                      | the two routes; assignment answers **only** from the governed function; artifact is Range-capable and refuses any release id that is not a uuid |
| `release-target.mjs`                       | one resolver, wrapping `dev-target.mjs`, plus the group-0221 capability refusal                                                                 |
| `verify-terminal.mjs`                      | DB-side checks always; `--ssh` adds the device-side facts for acceptance                                                                        |
| `http-release-source.ts`                   | the device's client for both interfaces; refuses redirects, bounds every response, verifies nothing                                             |
| Device Shell display                       | `readRelease` + `releaseCaption` + the footer line                                                                                              |
| `bootstrap-dev-pki.mjs --release-key-only` | mints the release key into an **existing** PKI without touching the CA                                                                          |

**The PKI addition mattered more than expected.** The real `dev-pki` predates U1
and the generator correctly refuses to overwrite a CA. Regenerating to get one
new key would have orphaned every certificate chained to the existing root — so
`--release-key-only` adds just the three release files, still refusing if they
already exist. The real development PKI now carries
`bfccb44e…` (v1, `release_signing`, development, non-production).

### Fallback visibility — the case that drove the design

`readRelease` composes the launcher's witness with the journal and **never infers
the running source from the store**. A board with a release installed but the
image copy running reports:

```
source           IMAGE_FALLBACK
runningVersion   null            ← never borrows the installed version
installedVersion 0.4.12
stale            true
caption          "Image software · 0.4.12 is installed and starts on restart"  (attention)
```

A test caught a gap here that I would not have found by reading: a board running
an **older release** than the installed one produced _no caption at all_ — the
worst case, indistinguishable from an image with no release runtime. Fixed:
`"Older release running · … starts on restart"`.

---

## 5. Tests and results — actual

### U1 suites

```
services/kitluy-device-firstboot-agent   711 passed |  9 skipped | 0 failed  (whole package)
  of which U1                            172 passed
apps/kitluy-device-shell                 147 passed | 0 failed   (was 134; +13 for the display)
pnpm release:pack:check                    9/9 passed  packer vs BUILT device closure
pnpm release:chain:check                  23/23 passed  the full delivery path
pnpm migrations:validate                 120 migration files, passed
```

### No-regression baseline

`pnpm verify` was run before any U1 work, and again now. **Identical.**

| Check                                                                                    | Baseline                                                                                                           | Now                               | Verdict    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ---------- |
| Format check                                                                             | FAIL — `EACCES` on `build/work/chroot-v2.7.0/…/persistent/home/pi`; _"All matched files use Prettier code style!"_ | identical, same path              | **no new** |
| Lint                                                                                     | FAIL — 2 errors: `terminal-edge.test.ts:310`, `dev-configuration.ts:40`                                            | the same 2, same lines            | **no new** |
| Typecheck                                                                                | PASS                                                                                                               | **PASS**                          | see below  |
| Unit tests                                                                               | FAIL — `@kitluy/device-identity#test` only; 899 passed / 23 skipped; leaked `kitluy_credential_issuer` grant       | identical, same counts, same task | **no new** |
| Contract · Offline · Build · OpenAPI · Migrations · Hub migrations · Secret scan · Clock | PASS                                                                                                               | PASS                              |            |
| Docs link check                                                                          | FAIL — 4 broken links, one 2026-07-30 handoff                                                                      | 4, same file                      | **no new** |

> **BASELINE FAILURES: 4, all pre-existing. NEW U1 REGRESSIONS: 0.**

**Two regressions were introduced during this turn and fixed before reporting**,
recorded because a clean final number is not the same as a clean process:

1. **Typecheck went FAIL.** My shell test used `as ShellSnapshot` over an object
   with an invented `network` shape. Vitest transpiles without checking, so the
   suite passed and `pnpm typecheck` failed. Fixed by building a real value.
2. **One new lint error** — an unused import left in the chain check after the
   packer was restructured. Removed.

---

## 6. Image-side changes discovered by completing Phase 5

Phase 4's scope is now better known than it was:

| Discovered                                                                                                              | Effect on Phase 4                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `KITLUY_RELEASE_SOURCE` must carry a **base URL** (`http://<host>:<port>`), not a file path                             | `/etc/kitluy/release.env` injection is a URL; `release-service.mjs` prints the exact line to bake                                 |
| The trust anchor is a **`.json` record**, not a bare `.pub`                                                             | the image writes `/etc/kitluy/trust/release-signing.json`; `evaluatePreconditions` already accepts `.json`                        |
| The Device Shell needs `/persistent/shared/kitluy/releases/device-shell/journal.json` **readable as `kitluy-terminal`** | the store is root-owned; directories 0755 and files 0644 are required, not incidental                                             |
| The launcher must write `running-source.json` into `/var/lib/kitluy/terminal/`                                          | that directory is already chowned to `kitluy-terminal` by `kitluy-device-shell.service`'s `ExecStartPre` — no new permission work |
| `DeviceRoots` gained `releaseStoreDir`                                                                                  | the Electron main process passes it; no unit change                                                                               |
| A release id is a **uuid**                                                                                              | the store's `rel-<uuid>` directories; the launcher's `-f current/payload/package.json` test is unaffected                         |
| The device runs **Node 18.20.4**                                                                                        | already handled: gzip, not zstd                                                                                                   |

**No change to the Phase 4 plan's shape.** The reflash still covers: trust anchor
injection, `release.env`, the slot-shared store declaration plus the generalised
`.wants` workaround, the launcher `APP=` indirection and its witness write,
`ReadWritePaths`, the runtime manifest, packaging and the image gates.

---

## 7. Evidence discipline

| State                                | U1                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------------------------- |
| `SOURCE IMPLEMENTED`                 | **yes** — phases 1–3 and 5 complete                                                |
| `TESTED-IN-DEV`                      | **yes** — 172 U1 + 13 shell + 9 + 23 checks, 0 failures, 0 new regressions         |
| `IMAGE VERIFIED`                     | **no** — Phase 4 has not begun                                                     |
| `HARDWARE VERIFIED`                  | **no** — acceptance A/B/C/D not attempted, no SD card touched, no device contacted |
| `PILOT-PROVEN` / `PRODUCTION-PROVEN` | **not claimable** — BLK-005                                                        |

Nothing committed or pushed. One migration created and applied **to the local
development stack only**. The bootstrap/runtime classification is unchanged and
still asserted by test. No U2–U6 work.

---

## 8. Open, for your decision when you authorise Phase 4

1. **`:54372` is missing migrations 0217–0220.** I applied only 0221. Should the
   other four be applied before hardware acceptance, given they touch device
   approval and pairing on a board that is already active and paired?
2. **No `cancel_campaign_v1` door.** Revocation is currently the only way to
   withdraw an assignment.
3. **`release-service.mjs` is plain HTTP.** Mutual TLS is the Store Hub's job at
   U4; building a second mTLS endpoint now would be the throwaway architecture
   you ruled out. Development only, and the device's verification does not depend
   on the transport.
