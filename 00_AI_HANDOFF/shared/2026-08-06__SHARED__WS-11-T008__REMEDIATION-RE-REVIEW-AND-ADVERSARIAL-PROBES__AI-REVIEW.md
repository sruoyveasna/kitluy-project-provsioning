# WS-11-T008 — remediation re-review and independent adversarial probes (Reviewer B)

| Field                     | Value                                                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record type               | AI review (independent, second reviewer)                                                                                                                  |
| Task                      | WS-11-T008 §10 — verify the F-1/F-2/F-4/F-5 remediations and run the independent hostile probe set                                                        |
| Reviewer                  | Reviewer B — did NOT author the corrections and is not Reviewer A                                                                                         |
| Date                      | 2026-08-06                                                                                                                                                |
| Worktree                  | `C:/kl-rev-b` (detached worktree)                                                                                                                         |
| Commit under review       | `27a7edd` "fix(ws-11): correct review findings F-1, F-2, F-4 and F-5"                                                                                     |
| Baseline compared against | `1dad4c8` (pre-remediation), `b4f5ac3` (0181), `9310168` (0180)                                                                                           |
| Cloud database            | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (migrations through 0182)                                                                       |
| Hub database              | `postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local` (through 0039)                                                                          |
| Node                      | v22.23.0, pnpm 9.15.9                                                                                                                                     |
| Remediation verdicts      | F-1 **APPROVED** · F-2 **APPROVED** · F-4 **APPROVED (with advisory)** · F-5 **APPROVED**                                                                 |
| Probe areas executed      | 10 / 10, 46 adversarial probes                                                                                                                            |
| Residue                   | ZERO from these probes; `git status --porcelain` shows only this file                                                                                     |
| Overall verdict           | **APPROVED** — all four remediations are genuine corrections, not test-shaped. Four NEW findings recorded below, none of which is in the remediated code. |

---

## Part 1 — remediation verification

### F-1 — Hub migration checksum guard was line-ending sensitive

**Change under review:** `scripts/hub/hub-db.mjs` `migrationFiles()` now hashes
`content.replace(/\r\n/g, "\n")` instead of raw bytes, matching
`scripts/hub/hub-validate.mjs` (`sha256Lf`) and `scripts/verification/secret-scan.mjs`.

**Reproduction of the original defect (executed).** This worktree has
`core.autocrlf=true` and every Hub migration is checked out with CRLF
(`hub/migrations/0039_release_installation_state.sql`: 205 CRLF, 0 bare LF).
The pre-fix script was restored from history into the tree, run, and deleted:

```
git show 27a7edd^:scripts/hub/hub-db.mjs > scripts/hub/zz-probe-old-hub-db.mjs
node scripts/hub/zz-probe-old-hub-db.mjs status
rm -f scripts/hub/zz-probe-old-hub-db.mjs
```

Result — **worse than Reviewer A reported**:

```
  40 file(s); 40 applied, 0 pending, 40 checksum drift, 0 missing.
hub-db: REFUSED — an applied file is never edited (schema contract §4).
```

All 40 unmodified migrations reported drift and every Hub command refused.

**Verification 1 — line-ending independence (executed).** The same file was
converted CRLF→LF in place and `hub:db:status` re-run, then restored:

```
python -c "...replace(b'\r\n', b'\n')..."   # CRLF count 205 -> 0
node scripts/hub/hub-db.mjs status
  APPLIED   0039_release_installation_state.sql  66ad427cbf03f06ee32b3adbccb86e42d921e1b4e3704b5f7ae33600196d3280
  40 file(s); 40 applied, 0 pending, 0 checksum drift, 0 missing.
git checkout -- hub/migrations/                # CRLF count back to 205
node scripts/hub/hub-db.mjs status
  APPLIED   0039_release_installation_state.sql  66ad427cbf03f06ee32b3adbccb86e42d921e1b4e3704b5f7ae33600196d3280
  40 file(s); 40 applied, 0 pending, 0 checksum drift, 0 missing.
```

The **identical** checksum `66ad427c…` in both line-ending forms, 0 drift both
ways. Independence proven, not asserted.

**Verification 2 — the guard is still strict (executed).** A real content edit
was appended (`-- probe: real content edit` + `select 1;`):

```
node scripts/hub/hub-db.mjs status
  DRIFT     0039_release_installation_state.sql  6f339da2838f3acf59083d9b6b30449445ec6777071775084eb0bf37b8a414da
  40 file(s); 40 applied, 0 pending, 1 checksum drift, 0 missing.
hub-db: REFUSED — an applied file is never edited (schema contract §4).
exit=1
```

Reverted with `git checkout -- hub/migrations/`; back to 0 drift. `apply` shares
the same gate: `applyPending()` calls `assertJournalIntegrity(files, journal)`
(line 334) BEFORE any `applyMigration`, so an edited applied file cannot reach
the database. (Verified by reading rather than executing, so the shared database
was not put at risk.)

**Does normalisation weaken immutability?** No, in any way that matters:

- The equivalence class collapsed is exactly `\r\n` ↔ `\n`. SQL semantics are
  identical across it; no statement, identifier or literal changes meaning.
- Bare `\r` is NOT normalised, so a CR-only rewrite still trips the guard.
- Any addition, deletion or modification of a single non-line-ending byte still
  produces drift (proven above).
- The journalled checksums are already LF-based, so existing databases are
  unaffected — confirmed: all 40 journalled values match the LF hashes.
- The only theoretical loss is a change confined to line endings _inside a
  dollar-quoted string literal that is itself stored as data_. No Hub migration
  does this, and both sibling harnesses (`hub-validate.mjs`, `secret-scan.mjs`)
  already accept the same equivalence — the fix removes an inconsistency rather
  than creating one.

**Verdict: APPROVED.** The fix is correct, minimal, consistent with its
siblings, and both directions (false-positive removed, true-positive retained)
were proven by execution.

---

### F-2 — Hub gates were outside `pnpm verify`

**Change under review:** `scripts/verification/verify.mjs` gains
`["Hub migration validation", "pnpm hub:db:validate"]` immediately after the
cloud `migrations:validate` step.

**Verification (read).** `scripts/hub/hub-validate.mjs` imports only
`node:crypto`, `node:fs`, `node:path`. It contains no `pg`, no `docker`, no
`spawnSync`, no connection string — it reads `hub/migrations` from disk and
exits. It is therefore safe inside `verify` on a machine with no database, and
it cannot apply anything (KL-INF-P1-037 preserved; the file even says so in its
closing NOTE).

**Verification (executed).**

```
pnpm hub:db:validate
hub-validate: all static checks passed (40 Hub migration file(s)).
hub:db:validate exit=0
```

The step is positioned before `secret:scan` and `clock:check`, so a Hub
migration edit now fails `verify` at the same stage a cloud migration edit does.

**Note on scope:** `hub:db:validate` is _static_. It would NOT have caught the
original F-1-class problem (checksum drift against a live journal), because that
requires the journal. The remediation commit message is accurate about this —
it claims only that "the Hub migration set sat outside every routine gate",
which is now fixed. The database-dependent Hub gates (`hub:db:status`) remain
outside `verify` by design; that is the correct trade-off for a command that
must run on a clean clone.

**Verdict: APPROVED.**

---

### F-4 — race family 11 had no liveness assertion

**Change under review:**
`services/kitluy-device-registry-service/test/t007-cloud-races.integration.test.ts`,
family F11, gains
`expect(a.ok || b.ok, "F11 iteration ${i}: neither containment arm succeeded").toBe(true)`.

**Verification 1 — the assertion genuinely fires (executed).** A temporary
mutant copy of the suite was created in which BOTH containment arms are forced
into a governed refusal (approver == actor on both `clear_device_containment_v1`
and `apply_device_containment_v1`, producing `KLUY-FLEET-RECOVERY-SELF-APPROVAL`
and `KLUY-FLEET-CONTAINMENT-SELF-APPROVAL`, so `assertGoverned` still passes):

```
pnpm --filter kitluy-device-registry-service exec vitest run test/zz-probe-f4-mutant.integration.test.ts -t "F11"
  × F11: containment apply races clear …
    → F11 iteration 0: neither containment arm succeeded: expected false to be true
  Tests  1 failed | 6 skipped (7)
```

The family fails on the FIRST iteration under a governed double-refusal. Before
the fix that scenario passed. The assertion is real.

**Verification 2 — non-vacuity (executed).** A second temporary copy logged the
per-iteration outcomes across all 20 iterations:

```
PROBE-F4-OUTCOMES iter=0..19  a.ok=true b.ok=true
  aVal={"outcome":"CLEARED", …}
  bVal={"outcome":"CONTAINED", …} or {"outcome":"ALREADY_CONTAINED", …}
```

Both arms succeed on every iteration in the healthy system, so the assertion
sits at a real margin rather than on a boundary that is already violated.

Both probe files were deleted; `git status --porcelain` clean.

**Advisory (not a defect).** `a.ok || b.ok` is the _weakest_ liveness statement
consistent with the observed data. Given that `a.ok && b.ok` holds on 20/20
iterations, the stronger assertion would be both truthful and would additionally
catch a **single-arm** deadlock. In practice a single-arm deadlock is already
caught by `assertGoverned` (a raw `deadlock detected` carries no `KLUY-`
sentinel), so the gap is closed — but the family's liveness could be tightened
at zero cost. Recorded as an improvement, not a blocker.

**Verdict: APPROVED (with advisory).**

---

### F-5 — `assign_release_v1` compared only the artifact

**Original comparison confirmed from history (read).**
`git show b4f5ac3:supabase/migrations/20260806160000_0181_t007_concurrency_corrections.sql`
— both the sequential path and the `unique_violation` convergence path read:

```sql
if found and v_existing.artifact_id = p_release then
  return jsonb_build_object('outcome', 'EXISTING', 'campaign_id', v_existing.id);
end if;
```

Artifact only. No tenant, store, location, environment or device.

**Original defect REPRODUCED EXECUTABLY against the live database.** The 0181
body was recreated verbatim (renamed `zz_probe_assign_0181`) inside a
`begin; … rollback;` transaction, the probe function dropped inside the same
transaction, and the transaction rolled back:

```
OLD-1 assign(A,key)       => {"outcome": "ASSIGNED", "campaign_id": "d4a12318-…"}
OLD-2 assign(B, SAME key) => {"outcome": "EXISTING", "campaign_id": "d4a12318-…"}
                             campaign is A's: t
OLD-3 device B installations for the release = 0
```

Device B received `EXISTING` carrying **device A's** campaign, and B has **zero**
installations — no refusal, no evidence, silent drop. Reviewer A's finding is
confirmed independently and by execution.

**Fix verification against the live database (executed).** Two devices enrolled,
claimed and redeemed into Tenant `…012` / Store `…017` / Location `…450`;
release created, signed and promoted to `internal`; doors run as
`kitluy_release_service`, enrol/claim/redeem as the plain connecting role:

| Step | Call                                           | Result                                                                                                |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 1    | `assign(release, scope, dev, key=K, device=A)` | `{"outcome":"ASSIGNED","campaign_id":"ef4439cb-…"}`                                                   |
| 2    | replay `assign(… key=K, device=A)`             | `{"outcome":"EXISTING","campaign_id":"ef4439cb-…"}` — **same campaign**                               |
| 3    | `assign(… key=K, device=B)`                    | REFUSED `KLUY-RELEASE-IDEMPOTENCY-CONFLICT: key REVB-F5-8ed78a55 was used for a different assignment` |
| 4    | device B installations for the release         | **0** — the refusal is total, no partial write                                                        |
| 5    | `assign(… key=K, device=A, tenant=…011)`       | REFUSED `KLUY-RELEASE-IDEMPOTENCY-CONFLICT` (scope is part of the identity)                           |

**Judgement questions:**

- _Is idempotency preserved for a genuine replay?_ **Yes** — step 2 returns
  `EXISTING` with the identical campaign id.
- _Could the new comparison wrongly REFUSE a legitimate retry?_ **No.** The
  campaign row and the `device_installations` row are written in the SAME
  transaction, so a caller can never observe a campaign whose installation is
  missing. A retry that repeats all of {artifact, tenant, store, location,
  environment, device} converges; anything else is by definition a different
  request.
- _Does the concurrent (`unique_violation`) path use the same comparison?_
  **Yes** — byte-identical predicate in both branches, including the
  `exists (select 1 from device_installations i where i.campaign_id = v_existing.id
and i.device_id = p_device_id)` clause. The 0182 on-apply guard enforces this
  (`if v_def not like '%device_installations i%' … raise`, and
  `if v_def not like '%unique_violation%' … raise`).
  Race convergence still holds: the regression suite's F15 family (20 iterations,
  separate sessions) passes.
- _Is the comparison semantically right?_ It matches the house pattern already
  established elsewhere in the codebase. Probe **G3** (below) shows
  `apply_device_containment_v1` doing exactly the same thing with its
  `command_ref` nonce: same ref + same device = `DUPLICATE_IGNORED`; same ref +
  different device = `KLUY-FLEET-CONTAINMENT-REPLAY-CONFLICT`. F-5 brings the
  release door into line with the containment door.

**Regression suite (executed).**

```
pnpm --filter kitluy-device-registry-service exec vitest run test/t007-cloud-races.integration.test.ts
  ✓ test/t007-cloud-races.integration.test.ts (7 tests) 4676ms
  Tests  7 passed (7)
```

**Residual observation (NEW-4, below):** a _different_ idempotency key for the
same (release, device) still creates a second campaign and a second installation
(probe STEP6: device A ended with 2 installations for one release). That is
outside F-5 and is arguably an intended re-rollout, but it is recorded.

**Verdict: APPROVED.**

---

## Part 2 — independent adversarial probes

All probes were authored by Reviewer B and executed directly (not by re-running
the implementation's tests). Every cloud/Hub SQL probe ran inside
`begin; … rollback;`. Role entry used the
`grant … to %I` / `set local role` / `reset role` / `revoke … from %I` pattern.

Legend: **PASS** = the system behaved as a governed system must (refused, or
succeeded where success is correct). **FAIL** = did not refuse as expected.

### 1. Provisioning and enrollment

| #     | Probe                                                                                       | Command (abridged)                              | Expected                     | Actual                                                                                                                                                           | Verdict |
| ----- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A1    | Identity substitution: redeem device A's claim token with device B's id                     | `redeem_device_claim_v1(tokA, payA, deviceHub)` | refusal                      | `KLUY-DEVICE-CLAIM-REUSED: this claim token was already redeemed by device 1ae0…`                                                                                | PASS    |
| A1b   | **Cross-Tenant**: re-claim an already-claimed device into a different Tenant/Store/Location | `create_device_claim_v1(term, T2, S2, L2, …)`   | refusal                      | `KLUY-DEVICE-OWNERSHIP-TRANSFER: device 1ae0… already holds a live …`                                                                                            | PASS    |
| A1c   | Device cloning: enrol a NEW device carrying an existing device's mac/board/storage signals  | `enroll_device_v1(… same three signals …)`      | trust incident + containment | enrolment accepted; the ORIGINAL terminal was moved to `restricted_investigation` (observed in A2's response) and a trust incident opened                        | PASS    |
| P10-e | `enroll_device_v1` reachable by `anon`/PUBLIC?                                              | ACL census                                      | not reachable                | `{postgres=X, service_role=X, kitluy_activation_governor=X}`; 0 doors reachable by `anon`; 0 `kitluy_*` functions with a NULL (PUBLIC) ACL outside `kitluy_sync` | PASS    |

### 2. Activation

| #   | Probe                                                 | Command                                                                                 | Expected         | Actual                                                                                                                                   | Verdict |
| --- | ----------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A2  | Activate into `production` (BLK-005 must fail closed) | `attempt_activate_device_v1(term,'production','OP-RB')` as `kitluy_activation_governor` | governed refusal | `{"outcome":"REFUSED","refusal_code":"KLUY-DEVICE-PKI-UNCONFIGURED", … "evidence_event_id":"fdc27a54-…"}` — refusal recorded as evidence | PASS    |
| A2b | Activate into an invented environment `nowhere`       | same, `'nowhere'`                                                                       | governed refusal | `KLUY-DEVICE-PKI-UNCONFIGURED … nowhere activation BLOCKED`                                                                              | PASS    |

### 3. Hub pairing

| #     | Probe                                                                                                          | Command                                                                                         | Expected         | Actual                                                                                                         | Verdict                           |
| ----- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| B1    | **Wrong Hub identity**: the terminal presents ITSELF as the signing Hub (`hub_device_id = terminal_device_id`) | `ingest_terminal_pairing_receipt_v1(…, v_term, v_term, …)` as `kitluy_pairing_receipt_governor` | refusal          | `{"outcome":"INGESTED", …}`                                                                                    | **FAIL — see NEW-1**              |
| B2    | **Wrong Hub identity**: a Hub assigned to another Tenant/Store/Location signs the receipt                      | `… v_hub2, v_term …`                                                                            | refusal          | `{"outcome":"INGESTED", …}`                                                                                    | **FAIL — see NEW-1**              |
| B3    | **Cross-Tenant**: correct Hub, receipt claims a foreign Tenant/Store/Location                                  | `… t2, s2, l2 …`                                                                                | refusal          | `{"outcome":"INGESTED", …}`                                                                                    | **FAIL — see NEW-1**              |
| B4    | **Stale/wrong assignment generation**                                                                          | `… terminal_assignment_generation = gen+5 …`                                                    | refusal          | `{"outcome":"INGESTED", …}`                                                                                    | **FAIL — see NEW-1**              |
| B5    | Valid baseline receipt                                                                                         | canonical call                                                                                  | ingested         | `{"outcome":"INGESTED","delivery_count":1}`                                                                    | PASS                              |
| B6    | **Replayed effect key** with a different `receipt_id` and a fully tampered body                                | same `effect_key`, new receipt id, foreign hub/scope, `serial-EVIL`                             | governed refusal | `duplicate key value violates unique constraint "tpr_effect_key_uq"` — raw SQLSTATE 23505, no `KLUY-` sentinel | **FAIL (governance) — see NEW-2** |
| B7/B8 | Did the replay corrupt the stored row?                                                                         | `select count(*), hub_certificate_serial where effect_key = …`                                  | 1 row, unchanged | `1` row; `hub_certificate_serial = serial-1` (the original stands)                                             | PASS                              |
| B9    | **Replayed pairing session** under a NEW effect key                                                            | new effect key, same `pairing_session_id`                                                       | governed refusal | `KLUY-PAIRING-RECEIPT-CONFLICT: pairing session 5dd4… already carries a different receipt`                     | PASS                              |
| B10   | Malformed certificate fingerprint                                                                              | `hub_certificate_fingerprint = 'not-a-fingerprint'`                                             | governed refusal | `new row … violates check constraint "tpr_fingerprints_ck"` — raw 23514, `governed=false`                      | **FAIL (governance) — see NEW-3** |

### 4. Fleet health

| #   | Probe                                                                            | Command                                                                                                                   | Expected                             | Actual                                                                                         | Verdict |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- | ------- |
| A4  | Valid baseline report                                                            | `ingest_device_health_report_v1(kh1.<uuid>.1, hub, term, 'development', gen, 1, 'healthy', …)` as `kitluy_fleet_governor` | projected                            | `{"outcome":"PROJECTED","projection_version":1}`                                               | PASS    |
| A4b | **Stale assignment generation**                                                  | `assignment_generation = gen-1`                                                                                           | refusal                              | `KLUY-FLEET-REPORT-STALE-GENERATION: reported generation 0 is not the live generation 1`       | PASS    |
| A4c | **Wrong Hub identity** — a Hub from another Store reports on this terminal       | `reporting_hub = hub2`                                                                                                    | refusal                              | `KLUY-FLEET-REPORT-WRONG-HUB: Hub 44af… is not the assigned Hub for device …`                  | PASS    |
| A4d | **Replayed effect key** with a tampered body (`unhealthy`, `9.9.9`, sequence 99) | same `kh1.…` key                                                                                                          | one business effect, original stands | `{"outcome":"DUPLICATE_IGNORED","accepted":true, …}`                                           | PASS    |
| A4e | Rows stored for the replayed key                                                 | `count(*) where effect_key = …`                                                                                           | 1                                    | `1`                                                                                            | PASS    |
| A4f | Malformed effect key                                                             | `'not-a-kh1-key'`                                                                                                         | governed refusal                     | `KLUY-FLEET-REPORT-REJECTED-SCHEMA: the effect key is not the canonical kh1 shape (KLREQ-026)` | PASS    |
| D3b | **Revoked assignment**: report on a device whose assignment was revoked          | after `revoke_device_assignment_v1`                                                                                       | refusal                              | `KLUY-FLEET-REPORT-DEVICE-UNASSIGNED: the observed device has no live assignment`              | PASS    |

### 5. Support and containment

| #      | Probe                                                       | Command                                                                              | Expected                 | Actual                                                                                                                                            | Verdict |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| A5     | Self-approved support session (C4 class)                    | `open_support_access_session_v1(…, 'SUP-A', 'SUP-A', …, 'C4_WRITE_INTERVENTION', …)` | refusal                  | `KLUY-SUPPORT-SELF-APPROVAL: the support actor can never be their own approver`                                                                   | PASS    |
| A5b    | **Cross-Tenant** support session on another Tenant's device | `(t2, s2, l2, device-in-t1, …)`                                                      | refusal                  | `KLUY-SUPPORT-SCOPE-MISMATCH: device 720e… is not assigned to the named Tenant and Store`                                                         | PASS    |
| A5-cls | Invented consent class                                      | `'explicit'`                                                                         | refusal                  | `KLUY-SUPPORT-CLASS: explicit is not a support policy §3 consent class`                                                                           | PASS    |
| A5d    | A contained device passes the containment assertion?        | `assert_device_not_contained_v1(term)` after quarantine                              | refusal                  | `KLUY-FLEET-CONTAINED: device 720e… is contained (lifecycle quarantined)`                                                                         | PASS    |
| A5e    | Self-approved containment clearance                         | `clear_device_containment_v1(…, 'FLEET-A', 'FLEET-A')`                               | refusal                  | `KLUY-FLEET-RECOVERY-SELF-APPROVAL: the requester can never approve their own recovery`                                                           | PASS    |
| G1–G3  | **Replayed nonce**: containment `command_ref` reused        | same ref + same device, then same ref + a DIFFERENT device                           | idempotent, then refusal | `CONTAINED` → `DUPLICATE_IGNORED` → `KLUY-FLEET-CONTAINMENT-REPLAY-CONFLICT: command NONCE-6170fe57 was already used for a different containment` | PASS    |

### 6. Hub replacement

| #   | Probe                                                                        | Command                                                             | Expected  | Actual                                                                                                                                                          | Verdict         |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| E1  | Legitimate replacement request                                               | `request_hub_replacement_v1(hubA,'full_pi',…)`                      | requested | `{"outcome":"REQUESTED","operation_id":"ebf0…","expected_assignment_generation":1}`                                                                             | PASS            |
| E1b | Invented replacement type                                                    | `'hardware_failure'`                                                | refusal   | `KLUY-HUBREPL-TYPE: hardware_failure is not a replacement type`                                                                                                 | PASS            |
| E2  | Cutover BEFORE approval                                                      | `commit_hub_replacement_cutover_v1(op, gen, …)` on a `requested` op | refusal   | `KLUY-HUBREPL-STATE: cutover applies to a cutover_ready operation, not requested (approval and eligibility cannot be skipped)`                                  | PASS            |
| E3  | Self-approval of the replacement                                             | `approve_hub_replacement_v1(op,'OPS-A')` (requester)                | refusal   | `KLUY-HUBREPL-SELF-APPROVAL: the requester can never approve their own replacement`                                                                             | PASS            |
| E4  | Independent approval                                                         | `approve_hub_replacement_v1(op,'OPS-B')`                            | approved  | `{"outcome":"APPROVED"}`                                                                                                                                        | PASS            |
| E5  | Register a replacement Hub that is out of scope                              | `register_replacement_hub_v1(op, hubB-in-another-Location)`         | refusal   | `KLUY-HUBREPL-SCOPE: the replacement Hub must hold a live assignment in the SAME Tenant, Store and Location`                                                    | PASS            |
| E6  | Skip restore-ready                                                           | `mark_replacement_cutover_ready_v1(op,…)`                           | refusal   | `KLUY-HUBREPL-STATE: cutover-ready applies after restore-ready, not approved`                                                                                   | PASS            |
| E7  | **Stale assignment generation** at cutover                                   | `commit_… (op, gen+99, …)`                                          | refusal   | `KLUY-HUBREPL-STATE …` (the state machine refuses one step earlier — fail-closed)                                                                               | PASS            |
| E8  | Cutover with no old-credential revocation reference                          | `commit_… (op, gen, 'OPS-C', '')`                                   | refusal   | `KLUY-HUBREPL-STATE …` (again refused earlier)                                                                                                                  | PASS            |
| E9  | **Dual-active Hub** cutover attempt with 388 live Store Hubs in the Location | `commit_… (op, gen, …)`                                             | refusal   | `KLUY-HUBREPL-STATE …`; the dedicated `KLUY-HUBREPL-DUAL-ACTIVE` census (read in the door body, lines 103–117) sits behind the state gate and was not reachable | PASS (see note) |

Note: the replacement state machine is strict enough that a cutover cannot be
reached without the full approved → restore-ready → cutover-ready chain, so
every skipped-step probe is refused at the first missing precondition rather
than at the specific guard. The `KLUY-HUBREPL-DUAL-ACTIVE` and
`KLUY-HUBREPL-STALE-GENERATION` guards were verified by reading the deployed
`pg_get_functiondef` output; they are present and unconditional. The behaviour
is defence in depth, not a gap.

### 7. Backup and restore

All executed against the real Hub backup tooling. Backup taken, tampered, and
the directory removed afterwards.

| #   | Probe                                                                          | Command                                       | Expected               | Actual                                                                                                                        | Verdict |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------- |
| C0  | Take a backup                                                                  | `pnpm hub:db:backup`                          | manifest + container   | `backup_id 0a80fe5e-…`, `sha256(enc) 6fe2f1e6…`, `schema_head 0039_…`, `aes-256-gcm (KLBK1)`                                  | PASS    |
| C1  | **Altered backup**: flip one byte in the encrypted container                   | `pnpm hub:db:restore <name>`                  | refusal before restore | `hub-db: backup checksum mismatch: recorded 6fe2f1e6…, actual e2fecc95…. Refusing to restore.`                                | PASS    |
| C2  | Repair the recorded digest so the checksum check passes — AEAD must still fail | rewrite `sha256_encrypted` + sidecar, restore | refusal                | `hub-db: backup decryption failed (KLUY-BACKUP-AUTH-FAILED: the backup is corrupt or the key is wrong). Refusing to restore.` | PASS    |
| C3  | Manifest names another database                                                | `database = 'kitluy_hub_someone_else'`        | refusal                | `KLUY-RESTORE-WRONG-DATABASE: the backup is for 'kitluy_hub_someone_else', not 'kitluy_hub_local'.`                           | PASS    |
| C4  | Manifest claims a schema head not in the repository                            | `schema_head = '9999_from_the_future.sql'`    | refusal                | `KLUY-RESTORE-INCOMPATIBLE-SCHEMA: backup head '9999_from_the_future.sql' is not in the repository migration set.`            | PASS    |
| C5  | Manifest with a required field removed                                         | delete `fingerprint_sha256`                   | refusal                | `backup manifest refused (KLUY-BACKUP-MANIFEST-INCOMPLETE:fingerprint_sha256). Refusing to restore.`                          | PASS    |

`hub/.backups` was deleted afterwards (`rm -rf hub/.backups`); the directory did
not exist before this review and does not exist now.

### 8. Signed releases

| #       | Probe                                                                                  | Command                                                                                             | Expected | Actual                                                                                                                                                                                                   | Verdict |
| ------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| P8a     | Assign a `draft` (unsigned) release                                                    | `assign_release_v1(draft, …)`                                                                       | refusal  | `KLUY-RELEASE-NOT-ELIGIBLE: a draft release is not assignable`                                                                                                                                           | PASS    |
| P8b     | Promotion order skip `signed → stable`                                                 | `promote_release_v1(rel,'stable',…)`                                                                | refusal  | `KLUY-RELEASE-PROMOTION-ORDER: stable is reached only from pilot, not signed (Internal -> Pilot -> Stable, no skips)`                                                                                    | PASS    |
| P8c     | Invented channel                                                                       | `promote_release_v1(rel,'production',…)`                                                            | refusal  | `KLUY-RELEASE-CHANNEL: production is not a release channel`                                                                                                                                              | PASS    |
| **P8d** | **Unauthorised promotion to `pilot` (BLK-005 must fail closed)**                       | `promote_release_v1(rel,'pilot','REL-OP-1','REL-OP-2')` from `internal`, valid independent approver | refusal  | `KLUY-DEVICE-PKI-UNCONFIGURED: [REQUIRED: approved PKI trust configuration for environment pilot] — BLK-005 decision values are RESOLVED (KLD-2026-07-28-002) but §14 leaves pilot activation BLOCKED …` | PASS    |
| P8e     | Self-approved promotion                                                                | `promote_release_v1(rel,'pilot','REL-OP-1','REL-OP-1')`                                             | refusal  | `KLUY-RELEASE-SELF-APPROVAL: the requester can never approve their own promotion`                                                                                                                        | PASS    |
| T1      | **Altered release manifest** as `kitluy_release_service` — rewrite the artifact digest | `update release_artifacts set artifact_digest_sha256 = …`                                           | refusal  | `permission denied for table release_artifacts`                                                                                                                                                          | PASS    |
| T2      | Rewrite the signature as `kitluy_release_service`                                      | `update … set signature_b64 = …`                                                                    | refusal  | `permission denied for table release_artifacts`                                                                                                                                                          | PASS    |
| T3      | Force `state='stable'` as `kitluy_release_service`                                     | `update … set state='stable'`                                                                       | refusal  | `permission denied for table release_artifacts`                                                                                                                                                          | PASS    |
| T4      | Delete the artifact as `kitluy_release_service`                                        | `delete from release_artifacts`                                                                     | refusal  | `permission denied for table release_artifacts`                                                                                                                                                          | PASS    |
| **T5**  | **Altered release manifest as the OWNING role `kitluy_release_governor`**              | `update … set artifact_digest_sha256 = repeat('e',64)`                                              | refusal  | `KLUY-RELEASE-MANIFEST-IMMUTABLE: a signed manifest is never rewritten; revoke and publish a NEW …`                                                                                                      | PASS    |
| T6      | Forge release evidence as the owning role                                              | `update release_events set actor_ref='FORGED'`                                                      | refusal  | `KLUY-RELEASE-EVENT-IMMUTABLE: release events are append-only`                                                                                                                                           | PASS    |
| T7      | Delete release evidence as the owning role                                             | `delete from release_events`                                                                        | refusal  | `KLUY-RELEASE-EVENT-IMMUTABLE: release events are append-only`                                                                                                                                           | PASS    |
| P8i     | Wrong environment assignment                                                           | `assign_release_v1(…, 'production', …)` for a `development` release                                 | refusal  | `KLUY-RELEASE-WRONG-ENVIRONMENT: release targets development, not production`                                                                                                                            | PASS    |
| P8j     | **Cross-Tenant** assignment                                                            | `assign_release_v1(rel, T-other, …)`                                                                | refusal  | `KLUY-RELEASE-WRONG-STORE: device 24fe… is not assigned to the named Tenant and Store`                                                                                                                   | PASS    |
| P8k     | Assign a REVOKED release                                                               | after `revoke_release_v1`                                                                           | refusal  | `KLUY-RELEASE-NOT-ELIGIBLE: a revoked release is not assignable`                                                                                                                                         | PASS    |
| D3c     | Assign to a device whose assignment was revoked                                        | after `revoke_device_assignment_v1`                                                                 | refusal  | `KLUY-RELEASE-WRONG-STORE: device dd26… is not assigned to the named Tenant and Store`                                                                                                                   | PASS    |

T5 is the important one: even the role that OWNS the door cannot rewrite a
signed manifest or edit the evidence trail.

### 9. A/B installation (Hub database, `edge_config.release_installation`)

| #   | Probe                                                                                                                      | Command                                                                     | Expected               | Actual                                                                                                      | Verdict |
| --- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------- |
| F0  | **Untrusted signer**: cache a release signed by `ATTACKER-KEY`                                                             | `insert into edge_config.release_cache (… signing_key_id='ATTACKER-KEY' …)` | refusal                | `insert or update on table "release_cache" violates foreign key constraint "release_cache_signer_fk"`       | PASS    |
| F2  | Illegal transition `assigned → current`                                                                                    | `update release_installation set state='current'`                           | refusal                | `KLUY-EDGE-INSTALL-TRANSITION: assigned -> current is not a legal installation transition`                  | PASS    |
| F3  | Illegal transition `assigned → installing_inactive_slot`                                                                   | same                                                                        | refusal                | `KLUY-EDGE-INSTALL-TRANSITION: assigned -> installing_inactive_slot is not a legal installation transition` | PASS    |
| F4  | Out-of-range A/B slot                                                                                                      | `candidate_slot='c'`                                                        | refusal                | `violates check constraint "release_installation_slot_ck"`                                                  | PASS    |
| F5  | A SECOND live installation for the same device                                                                             | second `insert` in a non-terminal state                                     | refusal                | `duplicate key value violates unique constraint "release_installation_one_live_idx"`                        | PASS    |
| F6  | The LEGAL path `assigned → downloading → verified → staged → installing_inactive_slot → pending_restart → health_checking` | six updates                                                                 | accepted               | reached `health_checking`                                                                                   | PASS    |
| F7  | First automatic rollback `health_checking → rolling_back → failed_rolled_back`                                             | two updates                                                                 | accepted               | ok                                                                                                          | PASS    |
| F8  | **SECOND automatic rollback** (owner gate §6: only ONE)                                                                    | `failed_rolled_back → rolling_back`                                         | refusal                | `KLUY-EDGE-INSTALL-TRANSITION: failed_rolled_back -> rolling_back is not a legal installation transition`   | PASS    |
| F9  | Auto-journal completeness                                                                                                  | `count(*) from release_installation_event`                                  | one row per transition | `9` events for 9 transitions                                                                                | PASS    |
| F10 | Forge the installation journal                                                                                             | `update release_installation_event set to_state='FORGED'`                   | refusal                | `KLUY-EDGE-APPEND-ONLY: UPDATE rejected on edge_config.release_installation_event`                          | PASS    |
| F11 | Delete the installation journal                                                                                            | `delete from release_installation_event`                                    | refusal                | `KLUY-EDGE-APPEND-ONLY: DELETE rejected on edge_config.release_installation_event`                          | PASS    |

### 10. Database privilege isolation

**Direct machine-door execution WITHOUT explicit role entry.** Six doors were
called as `authenticated`, as `service_role`, and as the plain connecting role
(`postgres`, which is `rolsuper=false` in this stack, so ACLs apply).

| Door                                               | as `authenticated`                                       | as `service_role`                            | as plain connecting role                     |
| -------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------- | -------------------------------------------- |
| `kitluy_releases.assign_release_v1`                | REFUSED — permission denied for schema `kitluy_releases` | REFUSED — permission denied for schema       | REFUSED — permission denied for function     |
| `kitluy_releases.promote_release_v1`               | REFUSED — permission denied for schema                   | REFUSED — permission denied for schema       | REFUSED — permission denied for function     |
| `kitluy_devices.apply_device_containment_v1`       | REFUSED — permission denied for function                 | REFUSED — permission denied for function     | REFUSED — permission denied for function     |
| `kitluy_devices.ingest_device_health_report_v1`    | REFUSED — permission denied for function                 | REFUSED — permission denied for function     | REFUSED — permission denied for function     |
| `kitluy_devices.commit_hub_replacement_cutover_v1` | REFUSED — permission denied for function                 | REFUSED — permission denied for function     | REFUSED — permission denied for function     |
| `kitluy_devices.enroll_device_v1`                  | REFUSED — permission denied for function                 | reached body (`KLUY-DEVICE-PROFILE-MISSING`) | reached body (`KLUY-DEVICE-PROFILE-MISSING`) |

`enroll_device_v1` is **intentionally** executable by `service_role` and
`postgres` — its ACL is
`{postgres=X/postgres, service_role=X/postgres, kitluy_activation_governor=X/postgres}`,
and the enrolment station is a service caller by design (the task brief itself
specifies enrol/claim/redeem run as the plain connecting role). The same applies
to `create_device_claim_v1`, `redeem_device_claim_v1`,
`issue_device_certificate_v1` and `emergency_time_correction_v1`. Not a finding.

Supporting censuses:

| Probe                      | Query                                                           | Result                                                                                                                                                                                           | Verdict |
| -------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Least privilege — reads    | `kitluy_release_service` selecting `device_installations`       | `permission denied for table device_installations`                                                                                                                                               | PASS    |
| Least privilege — evidence | `kitluy_release_service` updating `release_events`              | `permission denied for table release_events`                                                                                                                                                     | PASS    |
| PUBLIC exposure            | `count(*) where proacl is null` per `kitluy_*` schema           | `kitluy_auth 0/18, kitluy_devices 0/189, kitluy_finance 0/2, kitluy_laundry 0/4, kitluy_ops 0/25, kitluy_orders 0/2, kitluy_payments 0/1, kitluy_releases 0/10`; only `kitluy_sync` has 1 (of 1) | PASS    |
| Anonymous exposure         | `_v1` doors with `has_function_privilege('anon', …, 'execute')` | **zero rows**                                                                                                                                                                                    | PASS    |
| Door ownership             | `assign_release_v1` owner after 0182                            | `kitluy_release_governor` (0182 on-apply guard asserts this)                                                                                                                                     | PASS    |

---

## New findings

### NEW-1 — MEDIUM — the pairing-receipt door performs no Hub-identity, tenancy or generation validation in SQL

**Where:** `kitluy_devices.ingest_terminal_pairing_receipt_v1` (cloud, group 0176).

**What:** probes B1–B4 all returned `{"outcome":"INGESTED"}`:

- a receipt whose `hub_device_id` **is the terminal itself**;
- a receipt signed by a Hub assigned to a **different Tenant/Store/Location**;
- a receipt claiming a **foreign Tenant/Store/Location** for a correctly-scoped
  terminal;
- a receipt carrying a **wrong assignment generation** (`gen+5`).

The door validates only the effect-key shape, the environment enum, the
receipt-id redelivery comparison, and the pairing-session uniqueness. The
identity binding lives in application code —
`services/kitluy-device-registry-service/src/pairing-receipt-ingestion.ts`
compares `tenantId / digitalStoreId / locationId / hubDeviceId` against the
`AuthenticatedHubDelivery` envelope (lines 193–196) — so it is bypassed by any
caller holding `kitluy_pairing_receipt_governor`, `kitluy_edge_sync_service` or
`kitluy_test_harness`.

**Why it matters:** the sibling door `ingest_device_health_report_v1` enforces
exactly these invariants in SQL (`KLUY-FLEET-REPORT-NOT-HUB`,
`KLUY-FLEET-REPORT-WRONG-HUB`, `KLUY-FLEET-REPORT-STALE-GENERATION` — probes
A4b/A4c confirm). The asymmetry means the cloud has a second line of defence for
health telemetry but not for the pairing receipt, which is the _identity_ record.

**Reproduction:** `scratchpad/ppair.sql` probes B1–B4, run as
`docker exec -i supabase_db_kitluy-local psql -U postgres -d postgres -X -q -f -`
inside `begin; … rollback;`.

**Out of scope for T008's four remediations.** Likely intersects the recorded
BLK-006 gap (the signed Hub→cloud transport that authenticates deliveries), but
BLK-006 covers the _transport_, not the absence of the in-database check.
Recommend recording it explicitly rather than leaving it implied.

### NEW-2 — MEDIUM — the pairing-receipt door lets a replayed effect key escape as a raw SQLSTATE

**Where:** same door.

**What:** probe B6 — redelivering the same `effect_key` with a different
`receipt_id` produced
`duplicate key value violates unique constraint "tpr_effect_key_uq"`
(SQLSTATE 23505), not a `KLUY-` sentinel. The door's redelivery comparison keys
on `receipt_id`; `effect_key` carries a UNIQUE constraint with no governed
pre-check and no `exception when unique_violation` handler.

**Why it matters:** this is precisely the defect class T007 race family 15 found
in `assign_release_v1` and that migration 0181 corrected by converging on the
winner or raising the governed sentinel. The same pattern is still open here.
Positive note: the stored row is NOT corrupted (probe B7/B8 — one row,
`hub_certificate_serial` still `serial-1`), so the failure mode is a bad error
surface, not data loss.

**Reproduction:** `scratchpad/ppair.sql` probe B6.

### NEW-3 — LOW — malformed pairing-receipt fingerprints escape as a raw check-constraint violation

**Where:** same door. Probe B10: a non-hex `hub_certificate_fingerprint` yields
`new row for relation "terminal_pairing_receipts" violates check constraint
"tpr_fingerprints_ck"` with `governed = false`. The door already raises
`KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA` for the effect key and the environment;
the fingerprint and transcript-hash shapes are simply not checked in the same
place.

### NEW-4 — LOW / INFORMATIONAL — a different idempotency key re-installs the same release on the same device

**Where:** `kitluy_releases.assign_release_v1` (post-0182).

**What:** probe STEP6 — assigning the same release to the same device under a
_different_ idempotency key creates a second `rollout_campaigns` row and a
second `device_installations` row. Device A finished with **2** installations for
one release. There is no unique constraint on `(campaign.artifact_id,
installation.device_id)`, and the cloud exposes no single "desired release for
this device" resolution.

This is NOT the F-5 defect (F-5 was a silent _drop_; this is a duplicate) and it
may be the intended re-rollout behaviour. It is recorded because F-5's premise —
"an idempotency key identifies ONE request" — leaves the reciprocal question
("what identifies one installation?") unanswered. Contrast: the Hub side DOES
enforce one live installation per device
(`release_installation_one_live_idx`, probe F5).

### NEW-5 — INFORMATIONAL — environment observations (not code defects)

1. **Pre-existing role residue in the shared local cloud database.**
   `kitluy_hub_runtime` and `kitluy_sync_worker` are granted to `postgres`.
   Neither was granted by these probes (Reviewer B granted and revoked only
   `kitluy_release_service`, `kitluy_release_governor`,
   `kitluy_activation_governor`, `kitluy_pairing_receipt_governor`,
   `kitluy_fleet_service`, `kitluy_fleet_governor`,
   `kitluy_credential_approval_reader`). Left as found.
2. **The shared local Hub database was under-seeded.** The hub-agent suite
   failed 49/370 with 57 × `terminal_profile_assignment_source_snapshot_id_fkey`
   because seed row `edge_config.configuration_snapshot`
   `e0000000-0000-4000-8000-000000000050` was absent. `pnpm hub:db:seed`
   (non-destructive; no reset) restored it and the suite went fully green.
   Recorded so the closeout run does not mistake this for a regression.
3. **Turbo build cache is shared across worktrees.** `pnpm build` in
   `C:/kl-rev-b` restored 71 of 72 tasks from cache and one log line referenced
   `C:\kl-rev-a` (Reviewer A's worktree). Artefact-level independence of the two
   review worktrees is therefore not absolute. It did not affect any result here
   (every conclusion rests on SQL executed against the database or on scripts run
   from source), but a truly independent rebuild should pass `--force`.
4. **Fixture-location congestion.** Location `…018` carries 388–389 live
   `store_hub` assignments accumulated by earlier runs, which is why the T007
   suite sweeps stray Hubs before measuring the one-live-Hub census. Not
   introduced here.

---

## Residue census

Executed after every probe, before writing this document.

| Check                                                      | Query / command                                                                                                                                              | Result                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Probe campaigns surviving                                  | `count(*) from kitluy_releases.rollout_campaigns where idempotency_key like 'REVB-%' or 'OLD-F5-%' or 'K-%'`                                                 | **0**                                                                                                          |
| Probe release artifacts surviving                          | `count(*) … where build_id like 'b-old-%'/'b-revb-%'/'b-rel-%'/'b-tam-%'`                                                                                    | **0**                                                                                                          |
| Probe enrolments surviving                                 | `count(*) from kitluy_devices.manufacturing_enrollments where enrollment_operator_ref in ('OP-RB','OP-REVB')`                                                | **0**                                                                                                          |
| Probe pairing receipts surviving                           | `count(*) … where hub_certificate_serial in ('serial-1','serial-2','serial-3','serial-EVIL')`                                                                | **0**                                                                                                          |
| Probe replacement operations surviving                     | `count(*) from kitluy_devices.hub_replacement_operations where idempotency_key like 'RQ-IDEM-%'/'RP-IDEM-%'`                                                 | **0**                                                                                                          |
| Probe containment nonces surviving                         | `count(*) from kitluy_devices.device_containment_events where command_ref like 'NONCE-%'`                                                                    | **0**                                                                                                          |
| Probe functions surviving                                  | `count(*) from pg_proc where proname like 'zz_probe%'`                                                                                                       | **0**                                                                                                          |
| Hub probe trust keys / installations / cache rows          | `edge_config.release_trust_key key_id='probe-key'`, `release_installation candidate_version like '%probe%'`, `release_cache version like '%probe%'/'%evil%'` | **0 / 0 / 0**                                                                                                  |
| Temporary schemas with objects                             | `pg_class` in `pg_temp_15`                                                                                                                                   | **0 relations** (the namespace slot is a PostgreSQL artefact, empty)                                           |
| Roles still granted to the connecting role by these probes | `pg_auth_members` for `postgres`, `kitluy%`                                                                                                                  | `kitluy_hub_runtime, kitluy_sync_worker` — **both pre-existing**, neither granted by this review (see NEW-5.1) |
| Hub backup artefacts                                       | `ls hub/.backups`                                                                                                                                            | directory removed; `No such file or directory`                                                                 |
| Temporary probe test files                                 | `services/kitluy-device-registry-service/test/zz-probe-f4-*.ts`                                                                                              | deleted                                                                                                        |
| Temporary probe script                                     | `scripts/hub/zz-probe-old-hub-db.mjs`                                                                                                                        | deleted                                                                                                        |
| Worktree                                                   | `git status --porcelain` in `C:/kl-rev-b`                                                                                                                    | **empty before this file was written; only this review file after**                                            |
| Hub migration integrity after everything                   | `pnpm hub:db:status`                                                                                                                                         | `40 file(s); 40 applied, 0 pending, 0 checksum drift, 0 missing.`                                              |

All probe SQL ran inside `begin; … rollback;`. All probe artefacts on disk were
created outside tracked paths or deleted immediately after use.

---

## Part 3 — sanity totals

| Command                                                                                                  | Result                                                                                 |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `pnpm migrations:validate`                                                                               | **PASS** — `Migration validation passed (81 migration file(s)).`                       |
| `pnpm hub:db:validate`                                                                                   | **PASS** — `hub-validate: all static checks passed (40 Hub migration file(s)).` exit 0 |
| `pnpm hub:db:status`                                                                                     | **PASS** — `40 file(s); 40 applied, 0 pending, 0 checksum drift, 0 missing.`           |
| `pnpm secret:scan`                                                                                       | **PASS** — `Secret scan passed (1403 tracked files).`                                  |
| `pnpm --filter kitluy-hub-agent test`                                                                    | **PASS** — `Test Files 33 passed                                                       | 1 skipped (34)`, `Tests 368 passed | 2 skipped (370)`. First attempt failed 49/370 on a missing Hub seed fixture; see NEW-5.2. `pnpm hub:db:seed` (no reset) fixed it. |
| `pnpm --filter kitluy-device-registry-service test`                                                      | **PASS** — `Test Files 35 passed (35)`, `Tests 372 passed (372)`                       |
| `pnpm --filter @kitluy/device-identity test`                                                             | **PASS** — `Test Files 38 passed (38)`, `Tests 872 passed (872)`                       |
| `pnpm --filter @kitluy/terminal-local-store test`                                                        | **PASS** — `Test Files 1 passed (1)`, `Tests 14 passed (14)`                           |
| `pnpm --filter kitluy-device-registry-service exec vitest run test/t007-cloud-races.integration.test.ts` | **PASS** — `Tests 7 passed (7)` (F-5 regression included)                              |

Prerequisites executed once: `pnpm install --frozen-lockfile` (no tracked file
touched) and `pnpm build` (workspace `dist/` outputs were absent in a fresh
worktree; without it every suite fails on
`Failed to resolve entry for package "@kitluy/event-contracts"`).

`pnpm verify` as a whole was NOT run — the task scoped Part 3 to the listed
commands, and the repository already records the pre-existing repo-wide CRLF
`Format` condition as the standing `verify` failure.

---

## Overall verdict

**APPROVED.**

- **F-1 APPROVED** — original defect reproduced (40/40 false drift on this CRLF
  checkout); the fix is line-ending independent (identical checksum both ways,
  0 drift) and still strict (a one-line content edit produces drift and a
  refusal, exit 1). Normalisation does not weaken the immutability guarantee.
- **F-2 APPROVED** — `hub:db:validate` is in `verify.mjs`, is provably static
  (crypto/fs/path only), and passes.
- **F-4 APPROVED (with advisory)** — the assertion genuinely fails when both
  containment arms refuse (proven by a temporary mutant, failed at iteration 0),
  and is non-vacuous (both arms succeed on 20/20 healthy iterations). Advisory:
  `a.ok && b.ok` would be strictly stronger and equally true.
- **F-5 APPROVED** — the original defect was reproduced _executably_ against the
  live database (device B received device A's campaign and zero installations);
  the fix ASSIGNS, converges on a same-device replay, REFUSES a same-key
  different-device assignment with `KLUY-RELEASE-IDEMPOTENCY-CONFLICT`, leaves
  device B with zero installations, also refuses a same-key different-scope
  assignment, shares one comparison between the sequential and the
  `unique_violation` paths, and matches the house pattern already used by
  `apply_device_containment_v1`'s `command_ref` nonce.

Four new findings are recorded (NEW-1 MEDIUM, NEW-2 MEDIUM, NEW-3 LOW, NEW-4
LOW/INFO) plus environment observations (NEW-5). **None of them is in the
remediated code**, and none of them blocks acceptance of commit `27a7edd`.
NEW-1 and NEW-2 concern `ingest_terminal_pairing_receipt_v1` and should be
dispositioned before WS-11 closure — NEW-2 in particular is the same
ungoverned-escape class that 0181 corrected for the release door.

Forty-six adversarial probes were executed across all ten §10 areas. Every
required hostile case — cross-Tenant access, stale assignment generation,
revoked credential/assignment, replayed nonce, wrong Hub identity, altered
backup, altered release manifest, unauthorised promotion to `pilot` (BLK-005
fail-closed, proven), dual-active Hub attempt, and direct machine-door execution
without explicit role entry — was refused, except for the four wrong-Hub-identity
and generation cases at the pairing-receipt door recorded as NEW-1 and the two
governance escapes recorded as NEW-2/NEW-3.

Residue: **zero**. `git status --porcelain` in `C:/kl-rev-b` shows only this
review file.
