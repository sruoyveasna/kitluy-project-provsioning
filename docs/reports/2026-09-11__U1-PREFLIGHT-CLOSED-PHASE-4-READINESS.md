# U1 preflight closed — assignment integrity, stack schema, and Phase 4 readiness

| Field      | Value                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| Date       | 2026-09-11 · Asia/Phnom_Penh                                                                          |
| Status     | **SOURCE IMPLEMENTED + TESTED-IN-DEV + CHAIN-PROVEN.** Not `IMAGE VERIFIED`, not `HARDWARE VERIFIED`. |
| Committed  | **No.** Nothing committed or pushed.                                                                  |
| Stop point | Phase 4 and the reflash have **not** begun.                                                           |

---

## 1. Assignment response integrity — you were right, and it was exploitable

### The exact answer to "what authenticates what"

**Before this turn**, the only signature in the response was over the release manifest. Its canonical bytes are:

```
kitluy.release-manifest.v1 ⟨RS⟩ releaseId ⟨RS⟩ productKey ⟨RS⟩ version ⟨RS⟩
buildId ⟨RS⟩ architecture ⟨RS⟩ hardwareProfile ⟨RS⟩ environment ⟨RS⟩ channel ⟨RS⟩
artifactDigestSha256 ⟨RS⟩ artifactSizeBytes ⟨RS⟩ minSchemaVersion ⟨RS⟩
maxSchemaVersion ⟨RS⟩ configPrerequisiteVersion ⟨RS⟩ rollbackReleaseId ⟨RS⟩
```

| What you asked about  | Authenticated before?                                        |
| --------------------- | ------------------------------------------------------------ |
| `releaseId`           | **yes** — field 2 of the manifest                            |
| `assignment_sequence` | **NO** — plain JSON, plain HTTP                              |
| target device         | **NO** — nothing in the signed bytes names a device          |
| assignment identity   | **NO** — the `device_installations` row was not named at all |

**So the sequence was transport-trusted.** My earlier "the transport is powerless" was true of the _artifact_ and false of the _assignment_, exactly as you said not to assume.

### Both attacks were real

1. **Poisoning.** Serve a _genuine, validly signed_ old release with `assignmentSequence: 999999`. Every check passed — real signature, releaseId matching its manifest, sequence higher than accepted. The device installed the old release **and wrote 999999 to its durable journal**. Every subsequent genuine assignment is then `ASSIGNMENT_STALE` for ever: a permanent, reboot-surviving denial of update, because the journal is designed to survive reboots.
2. **Misdirection.** An assignment minted for device A was accepted by device B, since nothing signed named a device.

### The correction — cloud group 0222, smallest and non-throwaway

A **second signed statement**, with its own domain tag, verified by the device against the **same trust registry and same key** it already carries:

```
kitluy.release-assignment.v1 ⟨RS⟩ assignmentId ⟨RS⟩ deviceId ⟨RS⟩
releaseId ⟨RS⟩ assignmentSequence ⟨RS⟩ environment ⟨RS⟩
```

That binds all four things you listed. Implementation:

| Piece                            | What                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device_installations`           | `assignment_signature_b64`, `assignment_signing_key_id`, `assignment_signing_key_version`                                                               |
| `record_assignment_signature_v1` | write-once; a second, different signature is refused — two statements about one assignment is a state no device could resolve                           |
| `current_device_assignment_v1`   | returns the binding + envelope, and **fails closed: an unsigned assignment is never returned at all**, so a device never sees one it is about to refuse |
| `release-verify.ts`              | `canonicalReleaseAssignmentBytes` + `verifyReleaseAssignmentSignature(binding, envelope, keys, expectedDeviceId)`                                       |
| `evaluateAssignment`             | the signature gate runs **before** the sequence is believed; `trust` is a required parameter, not optional                                              |
| `release-publish.mjs`            | signs the assignment after `assign_release_v1`                                                                                                          |

**Why not mTLS:** it is deliberately _not_ transport security. A signed assignment survives the transport entirely, so when the Store Hub becomes the source at U4 it caches and forwards the same bytes and **the device code does not change**. Securing the channel instead would have to be redone. No U4 work was done.

**Why one key is safe for two message types:** the leading domain tag. `kitluy.release-manifest.v1` bytes can never be read as `kitluy.release-assignment.v1` bytes, so neither signature can be replayed as the other — the discipline already used by `kitluy.cert.v1`. There is a test for exactly this.

### Proven, not asserted

```
test/release-assignment.test.ts                 25 passed  (was 15)
  POISONING: forged high sequence on a genuine release   -> ASSIGNMENT_SIGNATURE_INVALID
  MISDIRECTION: assignment for another device            -> ASSIGNMENT_NOT_FOR_THIS_DEVICE
  no signature at all                                    -> ASSIGNMENT_UNSIGNED
  untrusted key / revoked key / swapped assignmentId
  swapped releaseId even when the manifest agrees
  signed environment disagreeing with signed manifest    -> ASSIGNMENT_ENVIRONMENT_MISMATCH
  DOMAIN SEPARATION: a manifest signature replayed as an assignment one -> refused
  and a genuine assignment still installs

pnpm release:pack:check   14/14  (was 9/9) — publisher↔device assignment bytes agree
pnpm release:chain:check  27/27  (was 23/23) — incl. step 5b and step 13
```

Step **5b** proves the fail-closed reader: between `assign_release_v1` and the signature, the governed door returns nothing for that release.

> **One deliberate behaviour change recorded:** the assignment gate now runs before the manifest gate, so an untrusted or revoked key surfaces as `ASSIGNMENT_SIGNATURE_INVALID` rather than `SIGNING_KEY_UNKNOWN`/`SIGNING_KEY_REVOKED`. Four tests were updated to the new order. One of them — "a pilot release offered to a development device" — was rewritten to sign the assignment as `pilot` too, so both signed statements agree and the **acceptance** gate is what refuses it. That keeps the test about the layer it was written for instead of silently moving it.

---

## 2. Development database schema — `:54372` is now current

Done in the order you asked.

### Backup

```
~/Development/HET_VEASNA_WORKSPACE/backups/kitluy-fresh/kitluy-fresh-54372-20260911-160247.sql   6.0 MB
```

Taken with the container's own `pg_dump` (`supabase_db_kitluy-fresh`, postgres 15.8.1.085), verified to contain the real device rows before anything was touched.

### Proved on a disposable copy first

Restored into `kitluy_migration_trial` on the same server. The restore logged 835 errors — **all** from the `--clean` DROP phase against a fresh database (453 × "schema does not exist") and role-grant noise (344 × "must be member of role"). Fidelity was verified empirically rather than assumed:

|                  | real `postgres` | `kitluy_migration_trial` |
| ---------------- | --------------- | ------------------------ |
| migrations       | 117             | 117                      |
| devices          | 2               | 2                        |
| assignments      | 3               | 3                        |
| kitluy tables    | 199             | 199                      |
| kitluy functions | 322             | 322                      |
| lifecycle        | both `active`   | both `active`            |

**0217, 0218, 0219, 0220 each applied cleanly** on the trial, one transaction per migration, `ON_ERROR_STOP=1`. Trial afterwards: 121 migrations, both devices `active`, 3 assignments with 2 live.

### Then the real stack

```
BEFORE:  KL-1054DD1CCC8E:active  KL-97A30575BCB7:active
APPLIED 0217 / 0218 / 0219 / 0220
AFTER:   121 migrations | both active | live_assignments=2
```

**Verification:**

| Check                            | Result                                                    |
| -------------------------------- | --------------------------------------------------------- |
| repo migrations vs applied       | **121 / 121, MISSING = 0**                                |
| real Terminal `KL-1054DD1CCC8E`  | **active**                                                |
| real Store Hub `KL-97A30575BCB7` | **active**                                                |
| Store bindings                   | terminal generation 1 `active`; hub generation 2 `active` |
| release chain                    | **27/27 passed** on the now-current stack                 |

No migration threatened the proven device state, so none was forced and nothing was skipped. The trial database was removed afterwards.

### And the real publisher, end to end with the real payload

```
pnpm release:publish --version 0.4.12-u1proof --target KL-1054DD1CCC8E

packed 83 389 bytes (the ACTUAL built Device Shell), sha256 e25426bc…
draft c43c7fc0-… → signed → promoted internal → assigned → assignment signed (sequence 14)

pnpm release:verify:terminal --expect 0.4.12-u1proof   8/8 passed
```

**Cleanup:** every synthetic release created during this turn was withdrawn through `revoke_release_v1` (distinct requester and approver, as the door demands). The terminal is back to **no assignment**; both devices remain `active`.

---

## 3. Tests and results — actual

```
services/kitluy-device-firstboot-agent   724 passed |  9 skipped | 0 failed   (was 711)
apps/kitluy-device-shell                 147 passed | 0 failed
pnpm release:pack:check                   14/14 passed
pnpm release:chain:check                  27/27 passed
pnpm release:publish (real payload)       end to end
pnpm release:verify:terminal               8/8 passed
pnpm migrations:validate                 121 migration files, passed
```

### No-regression baseline — identical

| Check           | Baseline                                                                                   | Now                         | Verdict    |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------- | ---------- |
| Format check    | FAIL — `EACCES` on the rootless build tree; _"All matched files use Prettier code style!"_ | identical                   | **no new** |
| Lint            | FAIL — 2 errors: `terminal-edge.test.ts:310`, `dev-configuration.ts:40`                    | the same 2                  | **no new** |
| Typecheck       | PASS                                                                                       | **PASS**                    |            |
| Unit tests      | FAIL — `@kitluy/device-identity#test` only; 899 passed / 23 skipped                        | identical counts, same task | **no new** |
| Docs link check | FAIL — 4 broken links                                                                      | 4, same file                | **no new** |
| everything else | PASS                                                                                       | PASS                        |            |

> **BASELINE FAILURES: 4, all pre-existing. NEW U1 REGRESSIONS: 0.**

**One defect I introduced and caught before reporting:** the publisher's assignment-signing block failed to apply during an edit (a reformatted anchor), leaving `signAssignment` imported but unused. Lint caught it. Had it shipped, **every published release would have been invisible to every device** — the fail-closed reader would have returned nothing, silently. Now proven by an actual publish run rather than by inspection.

---

## 4. Recorded for later, not built

- **No `cancel_campaign_v1` door.** Revocation is the only way to withdraw an assignment, which is heavier than "stop this rollout". For rollout governance (U6), as you directed.

---

## 5. Phase 4 readiness

| Precondition                                 | State                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Assignment authority cryptographically bound | **closed** — group 0222                                                                     |
| Development stack at the current schema      | **closed** — 121/121, device state proven intact                                            |
| One explicitly identified environment        | `127.0.0.1:54372` (kitluy-fresh), printed by every tool, enforced by `assertReleaseCapable` |
| Publish → assign → serve → verify            | proven with the real Device Shell payload                                                   |
| Device-side runtime                          | 724 agent tests, 0 failures                                                                 |
| No new regressions                           | confirmed against the recorded baseline                                                     |

**Phase 4 remains as planned:** trust-anchor injection (`/etc/kitluy/trust/release-signing.json`), `release.env` with the base URL, the slot-shared store declaration plus the generalised `.wants` workaround, the launcher `APP=` indirection and its `running-source.json` write, `ReadWritePaths`, the runtime manifest, packaging, and the image gates — then the build, the image suites, and **the one reflash**, then acceptance A/B/C/D.

Nothing committed or pushed. Two migrations created; both applied to the local development stack only. No U2–U6 work. No reflash.
