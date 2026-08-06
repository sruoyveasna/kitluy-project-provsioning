# WS-11-T008 — Initial independent review (Reviewer A)

| Field           | Value                                                                                                                                                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Date            | 2026-08-06                                                                                                                                                                                                                                                                                                                   |
| Reviewer        | Independent detached-worktree agent (Reviewer A). Did not implement any WS-11 work. No prior agent's prose was treated as evidence.                                                                                                                                                                                          |
| HEAD reviewed   | `5612b50` — `docs(ws-11): close device security verification`                                                                                                                                                                                                                                                                |
| Worktree        | `C:/kl-rev-a` — clean detached worktree, committed state only                                                                                                                                                                                                                                                                |
| Scope           | WS-11 T001–T007 evidence matrix; migration integrity; pin strictness; T007 corrections; over-claiming census; broad execution sanity                                                                                                                                                                                         |
| Method          | Every `APPROVED` rests on a migration read, code read, or a test **executed in this worktree**. Workspace packages were rebuilt with `pnpm build --force` (72/72, **0 cached**) after the shared Turbo cache was found to replay logs from the main checkout — no build artefact from the implementing checkout was trusted. |
| Databases       | Shared local Docker Postgres (`supabase_db_kitluy-local`). Cloud journal **80/80 applied**, Hub journal **40/40 applied** — both exactly matching the committed migration set. No reset was run (forbidden this stage).                                                                                                      |
| Toolchain       | Node 22.23.0 (ACTIVE-BASELINE) · pnpm 9.15.9 · `pnpm install --frozen-lockfile` clean                                                                                                                                                                                                                                        |
| Initial verdict | **APPROVED WITH NON-BLOCKING DEBT** — zero BLOCKING findings                                                                                                                                                                                                                                                                 |

---

## 1. Executive summary

The WS-11 T004–T007 body of work holds up under independent adversarial review. The two
concurrency defects that T007 claims to have found and fixed forward in cloud `0181` are
**real defects that I independently reproduced in the pre-0181 source**, and both fixes are
**structurally correct rather than test-shaped**. The race-A pairing fix does **not** convert
an error into a success in any case where the session is not authoritatively paired. The
three checksum pins were each **proven strict by mutation probe**, and Hub `0038` is
**byte-identical to its introducing commit**.

Eight findings are recorded, all NON-BLOCKING. The two most substantive concern the Hub
migration **immutability control itself** (F-1, F-2) — not the shipped schema, whose bytes
I verified are unmodified, but the guard charged with protecting it, which is line-ending
sensitive and sits outside the canonical `pnpm verify` gate. That combination is the
structural reason the T006 `0038` edit was not caught by routine verification.

---

## 2. Per-task evidence matrix

### WS-11-T001 — Device enrollment and identity foundation

| Field            | Evidence                                                                                                                                                                                                                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud migrations | `0120` (device identity, `pki_trust_configuration`, `assert_pki_configuration_approved`)                                                                                                                                                                                                                          |
| Runtime          | `packages/device-identity` (abstract PKI interfaces, fail-closed default)                                                                                                                                                                                                                                         |
| Tests EXECUTED   | `db:test` sections `ws11-lifecycle-fsm`, `ws11-evidence-immutable`, `ws11-tamper-quarantines`, `ws11-governed-reenrollment`, `ws11-replacement-order`, `ws11-pki-governance`, `ws11-duplicate-detected`, `ws11-blk005-gate` — **all PASS in my own run**. `@kitluy/device-identity` **872/872 passed (38 files)** |
| Register status  | `SCAFFOLDED / IN PROGRESS` — _deliberately_ not advanced: "BLK-005 is OPEN, so this row cannot advance and deliberately does not."                                                                                                                                                                                |
| Blocker posture  | BLK-005 OPEN; gate proven fail-closed in my run                                                                                                                                                                                                                                                                   |
| Debt             | None new                                                                                                                                                                                                                                                                                                          |
| **Verdict**      | **APPROVED**                                                                                                                                                                                                                                                                                                      |

The register status is _below_ what the evidence would support. That is the correct
direction of error and I note it approvingly.

### WS-11-T002 — Claim, scope and assignment

| Field            | Evidence                                                                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud migrations | `0121` (claim/assignment, `assignment_generation`)                                                                                     |
| Tests EXECUTED   | `assignment-capability-census.integration.test.ts` and the full `kitluy-device-registry-service` suite — **371/371 passed (35 files)** |
| Register status  | `SCAFFOLDED / IN PROGRESS` under the same explicit BLK-005 hold                                                                        |
| Debt             | T002 concurrency debt discharged by T007 D2 with executed races (F12/D6 verified below)                                                |
| **Verdict**      | **APPROVED**                                                                                                                           |

### WS-11-T003 — Trusted time and runtime enforcement (Steps 1–4)

| Field            | Evidence                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud migrations | `0123`–`0161` (trusted time, credential persistence, governed revocation, emergency lifecycle, lapse sweeper, scoped Hub snapshots, `0161` KLRISK-DEVICE-012 repair) |
| Runtime          | `packages/device-identity` (`pg-revocation-lookup.ts`), `kitluy-device-registry-service`                                                                             |
| Tests EXECUTED   | `@kitluy/device-identity` 872/872 including the true-concurrency and revocation-containment suites; `kitluy-device-registry-service` 371/371                         |
| Register status  | Overall `COMPLETED-IN-DEV`; Step 4 `IMPLEMENTED-IN-DEV WITH RECORDED ENVIRONMENT CONDITION`                                                                          |
| Debt             | KLRISK-DEVICE-012 closed by `0161`; environment condition recorded, not hidden                                                                                       |
| **Verdict**      | **APPROVED WITH NON-BLOCKING DEBT**                                                                                                                                  |

### WS-11-T004 — Terminal provisioning, activation, LAN mTLS, discovery, pairing, receipts

| Field            | Evidence                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commits          | `0b45874`, `cd36e90`, `e37be98`, `20bd0e0`, `2336b08`, `ed9265c`, `895cdfe`, `e81da09`, `a853d18`, `d3d97d8`, `61beb43`, `960b36f`, `e4562ad`, `2af94d0`, `399817b`, `70056cb`, `5711466`, `09ea7a1`, `99684aa`, `0081b2a`, `7ef384c` |
| Cloud migrations | `0162`–`0176` — all present, all in the applied journal                                                                                                                                                                               |
| Hub migrations   | `0031`–`0034` — all present, all in the applied journal and in `HUB_MIGRATION_ORDER`                                                                                                                                                  |
| Runtime          | `services/kitluy-hub-agent/src/hub/pairing.ts`, `@kitluy/terminal-local-store`                                                                                                                                                        |
| Tests EXECUTED   | `hub-terminal-pairing.integration.test.ts` **20/20 passed** (incl. race-A determinism × 20 iterations, race B forgery, race C concurrent hellos, restart recovery); `@kitluy/terminal-local-store` **14/14**                          |
| Blocker posture  | BLK-005 gates pilot/production (dev-only certs, minted per run); BLK-006 gates the activation bridge, the credential producer and the receipt transport — all fail closed                                                             |
| **Verdict**      | **APPROVED**                                                                                                                                                                                                                          |

### WS-11-T005 — Device fleet health, support access, incident containment

| Field            | Evidence                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Commits          | `bd608a6`, `8d5b5f2`                                                                                                    |
| Cloud migrations | `0177` (fleet health, support sessions, containment doors), `0178` (owner policy values)                                |
| Hub migrations   | `0035`, `0036`                                                                                                          |
| Key functions    | `apply_device_containment_v1`, `clear_device_containment_v1`, fleet health projection, support-session sweeper          |
| Tests EXECUTED   | `health-report-ingestion.integration.test.ts` and the rest of the device-registry suite (371/371); hub-agent 368 passed |
| Debt             | The `0177` clear/apply lock inversion — **found by T007 and fixed forward in `0181`**, verified below                   |
| **Verdict**      | **APPROVED WITH NON-BLOCKING DEBT**                                                                                     |

### WS-11-T006 — Hub replacement, recovery, signed release lifecycle

| Field            | Evidence                                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commits          | `a8b9b13` (P01), `4803fde` (P02), `9310168` (P03), `b04678a` (P04), `e3ec447` (closeout), `b031cb8` (0038 restore)                                    |
| Cloud migrations | `0179` (replacement authority), `0180` (release authority — BLK-005 gate wired at lines 444–456)                                                      |
| Hub migrations   | `0037`, `0038` (PUBLIC-only trust registry + verified cache), `0039` (A/B installation state)                                                         |
| Runtime          | `services/kitluy-hub-agent/src/hub/release-agent.ts`                                                                                                  |
| Tests EXECUTED   | `t007-hub-races` F13/F16 **2/2**; `release-agent.integration.test.ts` within hub-agent **368 passed / 2 skipped**                                     |
| Debt             | `SlotAdapter` device adapters are development fakes — **honestly recorded** (see §6); P02 destructive round trip is opt-in and I did not run it (F-8) |
| **Verdict**      | **APPROVED WITH NON-BLOCKING DEBT**                                                                                                                   |

### WS-11-T007 — Device security, offline, recovery and concurrency verification

| Field            | Evidence                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commits          | `b031cb8` (0038 restore), `c4145ff` (race-A), `d4431db` (sync-inbox), `85418bd` (legacy marker pins), `b4f5ac3` (0181 fixes), `ec4dd18`, `0829f66`, `5612b50` |
| Cloud migrations | `0181` — containment lock ordering + assignment `unique_violation` convergence                                                                                |
| Tests EXECUTED   | `t007-cloud-races` **6/6**, `t007-hub-races` **2/2**, pairing **20/20**, sync-inbox **15/15 × 3 consecutive runs**                                            |
| Register status  | `COMPLETE — VERIFIED-IN-DEV`                                                                                                                                  |
| Blocker posture  | BLK-005/006 unchanged; BLK-007 correctly still OPEN (KLREQ-008 doc still missing) while §19 carries its first executed subset                                 |
| Debt             | F-1, F-2, F-3, F-4 below                                                                                                                                      |
| **Verdict**      | **APPROVED WITH NON-BLOCKING DEBT**                                                                                                                           |

---

## 3. Migration integrity (independent)

### 3.1 Every migration edited after its introducing commit

Command:

```bash
for f in supabase/migrations/*.sql hub/migrations/*.sql; do
  n=$(git log --format=%h -- "$f" | wc -l)
  if [ "$n" -gt 1 ]; then echo "$f: $(git log --format='%h %s' -- "$f" | tr '\n' '|')"; fi
done
```

Eight files. Judgement on each:

| File                                                           | Commits (newest first)            | Judgement                                                                                                                                                                                                        |
| -------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/.../0125_device_credential_persistence.sql`          | `7f3b036` ← `946cda6`             | LEGITIMATE — T003-era correction ("NOLOGIN was not the guarantee, non-membership is"), pre-dates T004 by a week, recorded                                                                                        |
| `supabase/.../0141_revocation_scope_binding.sql`               | `7f8ff99` ← `9c0c288`             | LEGITIMATE — repository-gate failure corrected in the same session, recorded                                                                                                                                     |
| `supabase/.../0144_destruction_confirmation_null_safety.sql`   | `b71547c` ← `e505620`             | LEGITIMATE — RC-019 closure, recorded                                                                                                                                                                            |
| `supabase/.../0145_single_governed_revocation_entry.sql`       | `2c2b9d3` ← `b71547c`             | LEGITIMATE — re-review correction, recorded                                                                                                                                                                      |
| `supabase/.../0155_production_revocation_composition.sql`      | `56f8e6f` ← `cc6e2cf`             | LEGITIMATE — returned a borrowed governor membership and removed a worker over-grant; caught by `assertions.sql`, recorded                                                                                       |
| `supabase/.../0159_close_environment_wide_revocation_read.sql` | `bbbbf39` ← `5fd9522`             | LEGITIMATE — "make 0159, 0160 and hub 0029 replay from zero"; corrected before first application per the recorded state                                                                                          |
| `supabase/.../0160_repair_job_governor_membership_leak.sql`    | `bbbbf39` ← `9ed400a`             | LEGITIMATE — same commit, same reason                                                                                                                                                                            |
| `hub/migrations/0029_offline_device_record_enforcement.sql`    | `bbbbf39` ← `5fd9522`             | LEGITIMATE — same commit, same reason                                                                                                                                                                            |
| `hub/migrations/0038_release_trust_and_cache.sql`              | `b031cb8` ← `e3ec447` ← `9310168` | **THE ONE REAL BREACH, AND IT IS RECONCILED.** `e3ec447` (a commit labelled `docs(...)`) silently amended the on-apply guard probe of an applied migration. `b031cb8` restored it byte-for-byte. Verified below. |

All seven cloud/hub edits other than `0038` pre-date WS-11-T004 and were dispositioned in
earlier reviews. **Within the T004–T007 window under review, `0038` is the only
post-application migration edit, and it was found and reconciled by T007 Stage 0.**

I note adversarially that the `0038` edit rode in on a commit whose subject line was
`docs(ws-11): close hub recovery and release lifecycle`. The commit body _does_ disclose the
amendment honestly ("the 0038 guard probe amended to the 0027 house style"), so this was not
concealment — but a migration change under a `docs(` prefix is exactly the shape that evades
review attention.

### 3.2 Hub 0038 — exact checksum confirmation

```
$ git rev-parse 9310168:hub/migrations/0038_release_trust_and_cache.sql
9e80c81fb9893833da6b0d38e1e3bd7e1e1ce128          ✅ matches expected
$ git rev-parse e3ec447:hub/migrations/0038_release_trust_and_cache.sql
aeb1d5219356cba65b5fa5cd62e657cbcdb782be          (the breach state)
$ git rev-parse b031cb8:hub/migrations/0038_release_trust_and_cache.sql
9e80c81fb9893833da6b0d38e1e3bd7e1e1ce128          ✅ restored identical
$ git hash-object hub/migrations/0038_release_trust_and_cache.sql
9e80c81fb9893833da6b0d38e1e3bd7e1e1ce128          ✅ matches expected
$ sha256sum hub/migrations/0038_release_trust_and_cache.sql
8be1374c1000013493a29d77901ee99d3afbd08cfc213d3ca25f7d690cbc23c7   ⚠️  DOES NOT match expected
$ git cat-file blob 9e80c81f... | sha256sum
3d571e17e226ded82ab8aaf1e55ad54efac3a959c9de1d45b4d23554b8a2ab78   ✅ matches expected
$ tr -d '\r' < hub/migrations/0038_release_trust_and_cache.sql | sha256sum
3d571e17e226ded82ab8aaf1e55ad54efac3a959c9de1d45b4d23554b8a2ab78   ✅ matches expected
$ git config --get core.autocrlf
true
```

**Resolution: the raw `sha256sum` mismatch is entirely `core.autocrlf=true`.** The file is
`CRLF line terminators` on disk in this Windows checkout; the canonical LF content hashes to
exactly the expected `3d571e17…`. The git blob hash matches the introducing commit exactly.
**Hub 0038 is byte-identical to `9310168`. Confirmed.**

### 3.3 Is the secret-scan exception narrow?

`scripts/verification/secret-scan.mjs` lines 40–46 and 60–69. The exception is a
`pinnedRejectionFixtures` array with **one** entry requiring **all three** of:

- `p.file === file` — exactly `hub/migrations/0038_release_trust_and_cache.sql`
- `p.pattern === name` — exactly `"Private key block"`
- `p.sha256 === sha256Lf(content)` — exactly `3d571e17…` over LF-normalized content

**It cannot hide any other secret.** The `continue` fires inside the per-pattern loop, so the
other five patterns (service-role JWT, DigitalOcean token, AWS key, generic assigned secret,
Telegram token) still scan that same file. No directory, no glob, no other file, no other
pattern is exempted. The LF normalization is deliberate and correct — it makes the pin
survive checkout line-ending conversion, which is the same reason §3.2 above needed it.

### 3.4 Is the hub-validate legacy-marker registry narrow?

`scripts/hub/hub-validate.mjs` lines 44–58 and 194–214. `LEGACY_MARKER_REGISTRY` is a `Map`
of **exactly three** entries — `0028`, `0029`, `0030` — each pinned to an LF-normalized
sha256. Control flow verified by reading:

1. A current `-- kitluy:hub:migration:NNNN` marker matching the filename sequence → PASS.
2. Else, if and only if the filename is one of the three registry keys → the legacy
   `-- kitluy:hub:group:NNNN` form is accepted **only** when the sequence matches **and** the
   checksum matches; a byte mismatch produces the explicit failure
   _"legacy-marker bytes do not match the pinned checksum — applied migrations are immutable"_.
3. Else → FAIL.

**Every other migration faces the current standard unchanged.** A new file using the legacy
form is not in the registry and falls through to the failure branch (proven in Probe 3).

### 3.5 Pin-strictness proofs (the only mutations made; all reverted)

**Probe 1 — mutate Hub 0028, expect `hub:db:validate` to FAIL**

```bash
$ printf -- "-- reviewer-a probe line\n" >> hub/migrations/0028_revocation_reader_least_privilege.sql
$ pnpm hub:db:validate
FAIL  marker:0028_revocation_reader_least_privilege.sql — legacy-marker bytes do not match the pinned checksum — applied migrations are immutable
hub-validate: 1 static check(s) FAILED.
PROBE1_EXIT=1                                  ✅ refused
$ git checkout -- hub/migrations/0028_revocation_reader_least_privilege.sql
$ pnpm hub:db:validate; echo $?
AFTER_REVERT_EXIT=0                            ✅ restored
```

**Probe 2 — mutate Hub 0038, expect `secret:scan` to FAIL**

```bash
$ printf -- "-- reviewer-a probe line\n" >> hub/migrations/0038_release_trust_and_cache.sql
$ pnpm secret:scan
SECRET-SCAN FINDING: Private key block in hub/migrations/0038_release_trust_and_cache.sql
Secret scan failed with 1 finding(s).
PROBE2_EXIT=1                                  ✅ refused
$ git checkout -- hub/migrations/0038_release_trust_and_cache.sql
$ pnpm secret:scan
Secret scan passed (1401 tracked files).       ✅ restored
```

This is the decisive proof that the pin is a _checksum_ and not a _path allowlist_: a single
appended comment line — carrying no secret at all — re-enables the finding. A real secret
added to that file would do the same.

**Probe 3 — new file using the LEGACY marker form, expect `hub:db:validate` to FAIL**

```bash
$ cat > hub/migrations/0040_probe.sql <<'EOF'
-- kitluy:hub:group:0040
select 1;
EOF
$ pnpm hub:db:validate
FAIL  marker:0040_probe.sql — missing '-- kitluy:hub:migration:NNNN' marker
PROBE3_EXIT=1                                  ✅ refused — the legacy form is not extensible
$ rm -f hub/migrations/0040_probe.sql
$ pnpm hub:db:validate; echo $?
AFTER_REMOVE_EXIT=0                            ✅ restored
```

**Post-probe cleanliness**

```bash
$ git status --porcelain
(empty)                                        ✅ all three probes fully reverted
```

---

## 4. T007 corrections — commands, results, verdicts

### 4.1 Executed results

| Command                                                                                                  | Result                                                                                        |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `pnpm --filter kitluy-hub-agent exec vitest run test/hub-terminal-pairing.integration.test.ts`           | **Test Files 1 passed · Tests 20 passed** (incl. race-A determinism × 20 iterations, 7569 ms) |
| `pnpm --filter kitluy-hub-agent exec vitest run test/sync-inbox.test.ts` — run 1                         | **Test Files 1 passed · Tests 15 passed**                                                     |
| — run 2                                                                                                  | **Test Files 1 passed · Tests 15 passed**                                                     |
| — run 3                                                                                                  | **Test Files 1 passed · Tests 15 passed**                                                     |
| `pnpm --filter kitluy-device-registry-service exec vitest run test/t007-cloud-races.integration.test.ts` | **Test Files 1 passed · Tests 6 passed** (F10, F11, F12/D6, F14, F15 + D3)                    |
| `pnpm --filter kitluy-hub-agent exec vitest run test/t007-hub-races.integration.test.ts`                 | **Test Files 1 passed · Tests 2 passed** (F13, F16)                                           |

The sync-inbox flake did not reproduce in three consecutive runs. `d4431db` (fixture identity
collisions) is a plausible and sufficient root cause; three green runs is supporting but not
conclusive evidence for a formerly intermittent failure, and I record it as such.

### 4.2 Fix 1 — containment lock ordering. **VERDICT: genuinely correct.**

I did not take the migration comment's word for the AB/BA inversion. I read `0177` directly:

```
$ grep -n "for update" supabase/migrations/20260806080000_0177_fleet_health_support_and_containment.sql
729:   where id = p_device_id for update;          ← apply: devices FIRST
757:   where device_id = p_device_id for update;   ← apply: containment_states SECOND
927:   where device_id = p_device_id for update;   ← clear: containment_states FIRST
933:   where id = p_device_id for update;          ← clear: devices SECOND
```

**The inversion is real and exactly as described.** `0181` re-creates
`clear_device_containment_v1` taking `kitluy_devices.devices` first (lines 101–105), matching
the apply door. I compared the two function bodies clause by clause: the four-eyes checks,
the self-approval refusal, the `§10` disposition whitelist, the replay/`command_ref`
handling, the lifecycle restore matrix, the incident clearance and the append-only event
insert are all preserved. The only behavioural change is lock acquisition order.

This is a **correct fix to the actual cause**, not a test accommodation. A test-shaped fix
would have caught and retried the deadlock; this one makes the deadlock unreachable.

### 4.3 Fix 2 — `unique_violation` convergence in `assign_release_v1`. **VERDICT: correct.**

`0181` lines 258–274 wrap the `INSERT` in a subtransaction and, on `unique_violation`,
re-read by `idempotency_key`. If the winner's `artifact_id` matches, it returns
`{'outcome':'EXISTING', 'campaign_id': …}`; otherwise it raises the **same**
`KLUY-RELEASE-IDEMPOTENCY-CONFLICT` sentinel the sequential path raises. The `EXISTING`
return skips the `device_installations` insert, so the race produces exactly one business
effect.

This is semantically identical to the sequential path — I compared it against the pre-insert
`if found` block at lines 237–245 and the two agree on both branches. Two caveats are
recorded as F-5 and F-6 below; neither is a regression introduced by `0181`.

### 4.4 Race-A fix in `pairing.ts` — **does it convert error to success unsafely? NO.**

`services/kitluy-hub-agent/src/hub/pairing.ts`, `recoverPairedState` (lines 743–771) and its
call site (lines 719–731).

The recovery is attempted only for `PAIR_SESSION_CONSUMED` or `INTERNAL_ERROR`. That trigger
set is deliberately broad, but the **trigger is not the guard**. `recoverPairedState` returns
non-`null` only when **both** conditions hold against the authoritative database row:

```ts
const row = await readSession(client, pairingSessionId);
if (row === null || row.state !== "paired") return null;   // ← authoritative state gate
…
if (receiptRow === undefined) return null;                  // ← stored-receipt gate
```

It never inspects the error text and never infers success from it. If the session is in any
state other than `paired`, or is `paired` but has no stored receipt, the caller keeps its
mapped refusal. **A session that is not authoritatively paired cannot be reported as
`ALREADY_PAIRED`.** The returned receipt is the _stored_ one, and the Hub proof signature is
recomputed deterministically over the transcript reconstructed from the same row.

I consider this the correct shape for this class of fix: re-read the authority, never trust
the error string.

### 4.5 Non-vacuity — five high-value claims, test bodies read

The hinge for the two `0181` fixes is `assertGoverned`
(`t007-cloud-races.integration.test.ts` lines 90–99):

```ts
function assertGoverned(family, iteration, outcomes) {
  for (const o of outcomes) {
    if (!o.ok) {
      expect(
        o.error.includes("KLUY-"),
        `${family} iteration ${iteration}: ungoverned failure — ${o.error}`,
      ).toBe(true);
    }
  }
}
```

**Every refusal must carry a `KLUY-` sentinel.** A raw `deadlock detected` (40P01) or
`duplicate key value violates unique constraint "rollout_campaigns_idempotency_key_key"`
contains no `KLUY-` and fails the assertion. This is precisely why the matrix _found_ both
defects, and it is why reverting either fix would fail the suite.

| #   | Claim                                          | Test                                                       | Why it would FAIL if the behaviour were broken                                                                                                                                                                                                                                                                           |
| --- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `0181` containment lock order (T005/T007)      | `t007-cloud-races` F11, 20 iterations                      | Races `clear` against `apply` on one device on separate backends. A resurrected AB/BA deadlock surfaces `deadlock detected` — no `KLUY-` → `assertGoverned` fails. Also asserts one containment-state row and ≥ 2×20 append-only events.                                                                                 |
| 2   | `0181` assignment idempotency (T006/T007)      | `t007-cloud-races` F15, 20 iterations                      | Three independent gates: `assertGoverned` (raw unique violation has no `KLUY-`); `expect(a.ok && b.ok)` — **both** arms must succeed, so the loser must return `EXISTING` rather than raise; and `expect(count).toBe(1)` on the joined `device_installations` row, catching a double effect. Strongest test of the five. |
| 3   | race-A determinism (T004/T007 D1)              | `hub-terminal-pairing` "race A determinism", 20 iterations | `expect([r1,r2].sort()).toEqual(["ALREADY_PAIRED","PAIRED"])` — an `INTERNAL_ERROR` or `PAIR_SESSION_CONSUMED` fails immediately. Plus `r1.data.receiptId === r2.data.receiptId` (must be the _original_ receipt) and `receiptCount === 1` (no second receipt). Removing `recoverPairedState` fails all three.           |
| 4   | pairing forgery isolation (T004)               | `hub-terminal-pairing` "race B"                            | Races a valid proof against one forged with a _different_ key over the same transcript. Asserts session state is exactly `terminal_proof_verified` and `receiptCount === 0`. If signature verification were bypassed the forgery would advance state and the assertions fail.                                            |
| 5   | one-live-Hub serialization (T002/T006/T007 D6) | `t007-cloud-races` F12/D6, 20 generations                  | Chains 20 real replacement cutovers, racing two concurrent commits each, and after every iteration asserts the Location census `toBe(1)` live `store_hub`. A dual-active outcome or a lost generation fails on the exact iteration. Preceded by `sweepStrayHubs()` so the census is owned.                               |

**None of the five is vacuous.** Each asserts a specific governed outcome that the broken
behaviour cannot produce.

### 4.6 Skipped-test census

```bash
$ grep -rn "describe\.skip(\|it\.skip(\|test\.skip(\|describe\.todo\|it\.todo" --include=*.ts services/ packages/ verticals/ apps/ tests/
(no matches)
```

**Zero unconditional skips anywhere in the repository.** Every skip is one of:

- `describe.skipIf(!live)` / `describe.skipIf(!available)` — **environment-conditional**, gated
  on a real 2-second DSN reachability probe. The database was reachable in my run and these
  suites **did execute** (t007-cloud-races ran 6 tests, hub races 2, pairing 20).
- `KITLUY_HUB_DESTRUCTIVE_TESTS=1` — **opt-in**, one file
  (`hub-backup-restore.test.ts`), which prints an explicit visible skip notice. This accounts
  for the `1 skipped` file / `2 skipped` tests in the hub-agent run. See F-8.

### 4.7 `HUB_MIGRATION_ORDER` registration

```
order entries: 40 | migration files: 40
files NOT in order: []
order NOT in files: []
order is canonically sorted: true
```

Every Hub migration is registered, in canonical order, with no gaps, extras or duplicates.

---

## 5. Broad execution sanity (no resets)

| Command                                                                                | Result                                                                                                 |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                                                       | clean, 24.4 s                                                                                          |
| `pnpm build --force`                                                                   | **72/72 successful, 0 cached** (forced; the shared Turbo cache was replaying the main checkout's logs) |
| `pnpm migrations:validate`                                                             | **PASS — 80 migration file(s)**, exit 0                                                                |
| `pnpm hub:db:validate`                                                                 | **PASS — all static checks, 40 Hub migration file(s)**, exit 0                                         |
| `pnpm secret:scan`                                                                     | **PASS — 1401 tracked files**, exit 0                                                                  |
| `pnpm typecheck`                                                                       | exit 0 (93/93)                                                                                         |
| `pnpm lint`                                                                            | **0 errors**, 2 pre-existing warnings                                                                  |
| `pnpm db:test`                                                                         | **exit 3 — 39 PASS lines, 1 ASSERT FAIL** → see **F-3**                                                |
| `pnpm hub:db:test`                                                                     | **exit 3 — 23 PASS lines, 1 ASSERT FAIL** → see **F-3**                                                |
| `pnpm hub:db:status`                                                                   | **exit 1 — 40 applied, 0 pending, 7 checksum drift, 0 missing** → see **F-1**                          |
| `pnpm --filter kitluy-hub-agent exec vitest run` (full)                                | **33 files passed / 1 skipped · 368 tests passed / 2 skipped · 0 failed**                              |
| `pnpm --filter @kitluy/device-identity exec vitest run` (full)                         | **38 files passed · 872 tests passed · 0 failed**                                                      |
| `pnpm --filter @kitluy-services/kitluy-device-registry-service exec vitest run` (full) | **35 files passed · 371 tests passed · 0 failed**                                                      |
| `pnpm --filter @kitluy/terminal-local-store exec vitest run`                           | **1 file passed · 14 tests passed**                                                                    |

The hub-agent result is **better than the T006 closeout's recorded 356 passed with race-A
failing** — race-A is genuinely fixed, and the suite is now fully green. `device-identity`
872/872 matches the recorded figure exactly.

---

## 6. Over-claiming census

**No claim of production or pilot capability was found anywhere that should sit behind
BLK-005/BLK-006.** Specifically:

- Register statuses are `SCAFFOLDED / IN PROGRESS`, `IMPLEMENTED-IN-DEV`,
  `COMPLETED-IN-DEV`, or `COMPLETE — VERIFIED-IN-DEV`. Nothing claims `PILOT-READY`.
  `Deployments: NONE`, `Pilot/production: NONE`.
- The T001 and T002 rows carry the explicit sentence _"BLK-005 is OPEN, so this row cannot
  advance and deliberately does not."_ — status held **below** available evidence.
- `0180` wires the BLK-005 gate for real: `assert_pki_configuration_approved` is granted to
  `kitluy_release_governor` (line 69) and invoked for `pilot`/`stable` promotion only (lines
  444–456). My own `db:test` run recorded `PASS ws11-blk005-gate` and
  `PASS ws11-pki-governance`, confirming pilot/production still refuse fail-closed.
- BLK-007 is correctly still OPEN. `COMPLETE — VERIFIED-IN-DEV` for T007 is defensible
  because the accompanying note states plainly that KLREQ-008's document is still missing and
  that §19 carries only its _first executed subset_ — the word `VERIFIED` is qualified
  `-IN-DEV` and is not claimed to close BLK-007.

**`SlotAdapter` — honestly described. No over-claim.** Five independent places label it a
development harness:

1. `release-agent.ts` header: _"ADAPTER HONESTY (§11) … the shipped adapters in the test
   suite are production-SHAPED fakes; the remaining runtime-adapter gap is recorded in the
   P04 handoff and the capability census, **not claimed**."_
2. The only implementation is a class literally named **`FakeDevice`**
   (`release-agent.integration.test.ts:68`).
3. P04 handoff: _"`SlotAdapter` implementations in evidence are production-SHAPED in-memory…"_
4. T006 closeout handoff: same disclosure.
5. `000_CURRENT_STATE.md` and the register row: _"physical slot-adapter gap RECORDED"_.

**Nothing marked COMPLETE has skipped or absent tests**, with the single qualified exception
of the opt-in destructive backup/restore suite (F-8), whose skip is visible and announced.

---

## 7. Findings

### F-1 — Hub migration immutability guard is line-ending sensitive; `hub:db:status` refuses on a healthy database — **NON-BLOCKING**

`scripts/hub/hub-db.mjs` computes the journalled checksum over **raw on-disk bytes**:

```js
checksum: createHash("sha256").update(content, "utf8").digest("hex"),   // ~line 192
```

Its two sibling guards — `hub-validate.mjs` (line 59) and `secret-scan.mjs` (line 47) — both
normalize first via `sha256Lf`. `hub-db.mjs` does not. With `core.autocrlf=true`, whether a
file is CRLF or LF on disk depends on whether git checked it out or a tool wrote it, so the
journalled value depends on the _authoring history of the machine_, not on committed content.

**Reproduction:**

```bash
cd /c/kl-rev-a && pnpm hub:db:status
#   40 file(s); 40 applied, 0 pending, 7 checksum drift, 0 missing.
#   hub-db: REFUSED — an applied file is never edited (schema contract §4)
#   exit 1
# DRIFT: 0029, 0030, 0031, 0035, 0037, 0038, 0039
```

**Proof it is line endings and not a content breach** — for each drifting file, the journalled
checksum is exactly the **LF** sha256 of the current committed bytes:

| File              | Journalled  | On-disk (CRLF)     | LF of committed bytes |
| ----------------- | ----------- | ------------------ | --------------------- |
| `0029`            | `677e8bc7…` | `fd7e8c1d…`        | **`677e8bc7…`** ✅    |
| `0030`            | `9c7146ba…` | `aaf020ca…`        | **`9c7146ba…`** ✅    |
| `0031`            | `8d7be00d…` | `c387ace1…`        | **`8d7be00d…`** ✅    |
| `0038`            | `3d571e17…` | `8be1374c…`        | **`3d571e17…`** ✅    |
| `0032` (no drift) | `477a7679…` | **`477a7679…`** ✅ | `adb12e5f…`           |

`git status` is clean and `git hash-object` matches the introducing commit, so **no shipped
schema byte is modified**. The seven drifting files are those authored directly in the main
working tree (never re-checked-out, so still LF there); the 33 clean ones were checked out by
git in both places.

**Why it matters:** this is the control charged with enforcing _"an applied file is never
edited"_ — the exact rule `0038` broke. A guard that reports 7 false positives out of 40 on a
clean checkout of its own commit is a guard operators will learn to ignore, and it will fail
in CI or on any second machine. **Suggested fix: use `sha256Lf` in `hub-db.mjs`, matching its
two siblings, and re-journal.** (Recorded, not fixed — I am read-only on product code.)

### F-2 — the Hub migration gates are outside `pnpm verify` — **NON-BLOCKING**

`scripts/verification/verify.mjs` lists exactly 12 steps. It includes
`pnpm migrations:validate` (cloud) and `pnpm secret:scan`, but **neither `pnpm
hub:db:validate` nor `pnpm hub:db:status`**.

**Reproduction:** `sed -n '8,22p' scripts/verification/verify.mjs` — the `steps` array
contains no `hub:` entry.

Consequences: (a) the Hub-side migration standard is only enforced when someone runs it by
hand; (b) the applied-file drift guard is never exercised by the canonical gate. **This is
the structural reason the `0038` edit in `e3ec447` was not caught by routine verification** —
and it also means the good work T007 did in `85418bd` (checksum-pinning 0028–0030) still sits
outside the gate that would exercise it. Note also that a reset-from-zero re-journals every
file at its _current_ bytes, erasing the drift signal — so drift detection only ever protects
a database that has not been rebuilt since the edit.

### F-3 — `db:test` and `hub:db:test` cannot be re-verified without a reset; both FAIL on the shared database at HEAD — **NON-BLOCKING (not a defect)**

```bash
cd /c/kl-rev-a && pnpm db:test
#   39 PASS lines, then:
#   ERROR: ASSERT FAIL: 21 device(s) report ACTIVE while no PKI configuration is approved
#   exit 3    (0 other ASSERT FAIL; no other ERROR line)

cd /c/kl-rev-a && pnpm hub:db:test
#   23 PASS lines, then:
#   ERROR: ASSERT FAIL: a non-canonical logical profile code is assigned
#   exit 3
```

**Both are provably shared-state residue, not repository defects.** Evidence gathered:

- _Cloud:_ the 21 `active` devices were each created at **2026-08-06 06:18** — before my
  session — and each traversed the **full governed path**:
  `manufactured → enrolled → awaiting_trust (CLAIM_REDEEMED) → CERTIFICATE_ISSUED → ACTIVATED`,
  every event carrying `"environment": "development"` and
  `"hardware_trust_level": "development_software"`. KLD-2026-07-28-002 authorizes exactly
  this. **The BLK-005 gate was not bypassed** — `PASS ws11-blk005-gate` and
  `PASS ws11-pki-governance` both appear in this same run. Assertion 28k
  (`assertions.sql:2402-2409`) asserts a _post-reset_ floor of zero active devices, which
  only holds immediately after a reset.
- _Hub:_ the offending rows are literally `profile_code = 'T2'` and `'T3'`, four rows dated
  **2026-08-05**. **No code in the committed tree produces them** — every profile constant in
  `services/kitluy-hub-agent/test/` uses the canonical dotted form
  (`laundry.t2.customer_display`, etc.), confirmed across `hub-fixtures.ts`,
  `edge-lan.integration.test.ts`, `hub-terminal-pairing.integration.test.ts` and
  `pairing-replication.integration.test.ts`. They are residue from a pre-canonical fixture
  version.

**Consequence for this review:** the closeout figures **`db:test` 242 PASS** and
**`hub:db:test` 43 PASS** are **INSUFFICIENT EVIDENCE** from my position — verifying them
requires a reset, which this stage forbids. They must be re-proven by the closeout run.

### F-4 — race family F11 has no liveness assertion — **NON-BLOCKING**

`services/kitluy-device-registry-service/test/t007-cloud-races.integration.test.ts`, the F11
body. It calls `assertGoverned(...)` and then checks the containment-state row is not torn,
but — unlike F15 (`expect(a.ok && b.ok)`) and D3 (`expect(a.ok && b.ok)`) — **it never
asserts that at least one arm succeeded.**

**Reproduction:** read the F11 body; there is no `expect(a.ok || b.ok)`.

If a future change made both the apply and the clear door refuse with governed sentinels on
every iteration, F11 would still pass while containment had ceased to function. The omission
is defensible (in a genuine apply/clear race one side legitimately refuses `NOT_CONTAINED`),
but a `expect(a.ok || b.ok)` would close it at no cost.

### F-5 — `assign_release_v1` idempotency compares only `artifact_id` — **NON-BLOCKING (pre-existing in `0180`, not introduced by `0181`)**

Both the sequential branch (`0181` lines 237–245) and the new `unique_violation` handler
(lines 266–273) return `EXISTING` when the idempotency key matches **and `artifact_id`
matches**, without comparing `tenant_id`, `digital_store_id`, `store_location_id`,
`environment` or `p_device_id`.

**Reproduction:** call `assign_release_v1` twice with the same `p_idempotency_key` and the
same `p_release` but a **different** `p_device_id`. The second call returns
`{'outcome':'EXISTING'}` and **no `device_installations` row is created for the second
device** — the assignment is silently dropped rather than refused.

`0181` faithfully preserves `0180`'s contract, so this is not a regression, and the F15 test
does not exercise it (it uses one device). Recorded as a contract gap for the owner: either
the conflict check should compare the full assignment tuple, or the artifact-only semantics
should be stated explicitly.

### F-6 — the `unique_violation` recovery assumes READ COMMITTED — **NON-BLOCKING**

`0181` lines 266–271 re-read `rollout_campaigns` after catching `unique_violation`. Under the
default READ COMMITTED isolation the post-exception statement takes a fresh snapshot and sees
the committed winner, which is what makes the convergence work. Under REPEATABLE READ or
SERIALIZABLE the snapshot is fixed, the re-read would not find the winner, and an _identical_
idempotent replay would raise `KLUY-RELEASE-IDEMPOTENCY-CONFLICT` instead of converging.

**Reproduction:** run the F15 race with both connections at `SET TRANSACTION ISOLATION LEVEL
REPEATABLE READ`. Not exercised — the suite uses default isolation. Worth either documenting
the isolation assumption in the migration comment or asserting it in the door.

### F-7 — the WS-11 row of the workstream matrix is stale by five tasks — **NON-BLOCKING (documentation)**

`00_AI_HANDOFF/000_CURRENT_STATE.md`, workstream matrix row `11`, still reads
`SCAFFOLDED / IN PROGRESS` with _"**T001 and T002 of 8 complete 2026-07-28**"_ and
_"POSITION 2026-07-30: T003 Step 4 Phases A-D are GREEN and NOT PROMOTED … **Next: Phase E**"_.

**Reproduction:** open the file, matrix row `| 11 | Device provisioning & fleet |`.

T004, T005, T006 and T007 have all since closed. The dated refresh notes above the table do
supersede it, but a reader consulting the matrix — which is the file's summary artefact —
gets a materially wrong picture of current truth. The same row also still contains the
now-resolved _"Next: Phase E"_.

### F-8 — the T006-P02 destructive backup round trip is opt-in and was not independently re-run — **NON-BLOCKING (disclosure, not a defect)**

`services/kitluy-hub-agent/test/hub-backup-restore.test.ts` is gated on
`KITLUY_HUB_DESTRUCTIVE_TESTS=1` and must run alone; it accounts for the `1 skipped` file /
`2 skipped` tests in the hub-agent run and prints an explicit skip notice. **I deliberately
did not run it**, because it rebuilds the Hub database and this stage must not disturb shared
state. The recorded claim _"destructive backup round trip 2/2"_ is therefore
**INSUFFICIENT EVIDENCE** from my position and should be re-proven by the closeout run. The
gating itself is honest and correctly disclosed.

---

## 8. Verdict summary

| Task                                                                        | Verdict                             |
| --------------------------------------------------------------------------- | ----------------------------------- |
| WS-11-T001 — enrollment / identity foundation                               | **APPROVED**                        |
| WS-11-T002 — claim, scope and assignment                                    | **APPROVED**                        |
| WS-11-T003 — trusted time + runtime enforcement (Steps 1–4)                 | **APPROVED WITH NON-BLOCKING DEBT** |
| WS-11-T004 — terminal provisioning, activation, LAN mTLS, pairing, receipts | **APPROVED**                        |
| WS-11-T005 — fleet health, support access, incident containment             | **APPROVED WITH NON-BLOCKING DEBT** |
| WS-11-T006 — Hub replacement, recovery, signed release lifecycle            | **APPROVED WITH NON-BLOCKING DEBT** |
| WS-11-T007 — security, offline, recovery and concurrency verification       | **APPROVED WITH NON-BLOCKING DEBT** |

## 9. Initial verdict

**APPROVED WITH NON-BLOCKING DEBT.**

Zero BLOCKING findings. The implementation truth I could reach independently matches what the
records claim, in the direction that matters: statuses are conservative, blockers are
enforced in the database rather than in prose, the `0038` immutability breach was found and
genuinely reconciled, and the two `0181` concurrency fixes address real causes I reproduced
in the pre-fix source rather than merely satisfying assertions. The test suites are not
vacuous and there are no unconditional skips anywhere in the repository.

Required before closeout:

1. **F-3** — re-prove `db:test` (242) and `hub:db:test` (43) on a reset-from-zero. Neither
   figure is independently verified by this review.
2. **F-8** — re-run the destructive backup round trip under
   `KITLUY_HUB_DESTRUCTIVE_TESTS=1`.
3. **F-1 / F-2** — disposition the immutability-guard defects: normalize `hub-db.mjs` to
   `sha256Lf` and decide whether the Hub gates join `pnpm verify`. These are the controls that
   failed to catch the one real breach in this workstream, so a decision should be recorded
   even if the fix is deferred.
4. **F-4, F-5, F-6, F-7** — record in the appropriate register; none blocks closeout.

Nothing was committed. `git status` in this worktree shows only this review file.
