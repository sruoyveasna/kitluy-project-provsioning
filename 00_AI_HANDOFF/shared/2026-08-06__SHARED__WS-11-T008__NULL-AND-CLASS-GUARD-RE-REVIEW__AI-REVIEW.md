# WS-11-T008 — NULL and device-class guard re-review (Reviewer B, independent)

| Field                     | Value                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Record type               | AI review (independent third check)                                                                                                            |
| Task                      | Verify cloud migration 0184 closes Reviewer C's NEW-4 and NEW-5 without losing group 0183                                                      |
| Reviewer                  | Reviewer B — did NOT author 0183 or 0184 and did NOT find NEW-4/NEW-5 (Reviewer C did)                                                         |
| Date                      | 2026-08-06                                                                                                                                     |
| Worktree                  | `C:/kl-rev-b`, detached at `09f93e9`                                                                                                           |
| Commit under review       | `09f93e9` "fix(ws-11): close receipt null and device-class gaps"                                                                               |
| Baseline compared against | `99af1b5` (group 0183)                                                                                                                         |
| Cloud database            | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` — 83 migrations, head `20260806220000` (0184)                                        |
| Hub database              | `postgresql://postgres:postgres@127.0.0.1:54322/kitluy_hub_local` — 40 migrations, head `0039`                                                 |
| Node                      | v22.23.0, pnpm 9.15.9                                                                                                                          |
| Verdict                   | **APPROVED** — both defects reproduced against 0183 and both closed by 0184; all six group-0183 protections survive intact                     |
| New finding               | **NEW-6 (LOW)** — the presence gate omits `p_effect_key`, `p_environment` and `p_correlation_id`; all three still escape as raw SQLSTATE 23502 |
| Residue                   | ZERO from these probes; `git status --porcelain` empty                                                                                         |

---

## 0. Checkout and environment

```
cd /c/kl-rev-b && git fetch --all -q; git checkout --detach 09f93e9
HEAD is now at 09f93e9 fix(ws-11): close receipt null and device-class gaps
git status --porcelain -> (empty)
git log --oneline 27a7edd..09f93e9
  09f93e9 fix(ws-11): close receipt null and device-class gaps
  99af1b5 fix(ws-11): bind pairing receipt identity in the door
  b276166 docs(ws-11): record remediation re-review and adversarial probes
```

**Two things were unexpected and are recorded honestly.**

**(a) The checkout initially aborted.** My previous review file existed as an
untracked file and is now a TRACKED file at the same path (committed as
`b276166`). I diffed the committed blob against my local copy before deleting
mine: the only differences are Prettier reformatting (`*` bullets rewritten to
`-`, `*emphasis*` to `_emphasis_`, markdown table column padding). Normalised
for whitespace and bullet style the two are byte-identical apart from those
markers — my content was committed verbatim, nothing was edited or dropped.

**(b) The shared local database was reset by another session while I was
working.** Mid-run the `supabase_db_kitluy-local` container restarted; a
subsequent query returned `relation "kitluy_devices.devices" does not exist`,
then the schemas reappeared one by one. When it settled:
`supabase_migrations.schema_migrations` = 83 rows, head `20260806220000`; the
cloud is freshly reset 0000→0184 and re-seeded; `kitluy_devices.devices` = 0
rows; the two fixture hardware profiles and all three fixture Store Locations
are present; no concurrent active sessions. I did **not** run `db:reset` or
`hub:db:reset` at any point. This is almost certainly the WS-11 closeout run.

The restart caught one of my probe scripts mid-flight. That script had a
template-substitution bug that spilled SQL into a comment, which aborted the
enclosing transaction, so three probe devices (`OP-NB`) were **committed**
rather than rolled back. I detected this immediately and was preparing the
governed clean-up when the concurrent reset removed them. Verified after the
reset: `manufacturing_enrollments where enrollment_operator_ref in
('OP-LV','OP-NB','OP-RB','OP-REVB')` = **0**. The residue is gone; I am
recording that it briefly existed rather than claiming a perfect run. The
script was fixed (`__BODY__` no longer appears inside a comment) and every
subsequent probe ran inside an intact `begin; … rollback;`.

---

## 1. Baseline — both defects reproduced against the PRE-0184 door

Method: the group-0183 door body was extracted verbatim from
`git show 99af1b5:supabase/migrations/20260806200000_0183_t008_receipt_ingestion_authority.sql`
(lines 60–241, the whole `create or replace function … $ingest$;`), renamed to
`kitluy_devices.zz_probe_ingest_0183`, created under
`set local role kitluy_pairing_receipt_governor` (so its `security definer`
owner matches the real door), exercised, dropped, and the whole transaction
rolled back.

| #      | Probe                                            | Expected (defect) | Actual                                                                                            | Confirms         |
| ------ | ------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------- | ---------------- |
| BASE-0 | Fully legitimate receipt                         | INGESTED          | `{"outcome":"INGESTED","delivery_count":1}`                                                       | fixture is valid |
| BASE-1 | NULL `p_tenant_id`                               | raw 23502         | `sqlstate=23502 governed=false` `null value in column "tenant_id" … violates not-null constraint` | **NEW-4**        |
| BASE-2 | NULL `p_digital_store_id`                        | raw 23502         | `sqlstate=23502 governed=false` `null value in column "digital_store_id" …`                       | **NEW-4**        |
| BASE-3 | NULL `p_location_id`                             | raw 23502         | `sqlstate=23502 governed=false` `null value in column "location_id" …`                            | **NEW-4**        |
| BASE-4 | NULL `p_terminal_assignment_generation`          | raw 23502         | `sqlstate=23502 governed=false` `null value in column "terminal_assignment_generation" …`         | **NEW-4**        |
| BASE-5 | A `store_hub` supplied as `p_terminal_device_id` | INGESTED          | `{"outcome":"INGESTED","receipt_id":"e4edd2c3-…","delivery_count":1}`                             | **NEW-5**        |

Reviewer C's two findings are reproduced exactly: NULL scope/generation walked
past the 0183 authority through three-valued logic and died on NOT NULL as a
raw 23502; a Store Hub was ingested as the paired terminal.

**Extension (mine).** I also asked whether the same three-valued class exists on
fields Reviewer C did not name. Against the same 0183 body:

| #      | Probe                   | Actual under 0183                                                         |
| ------ | ----------------------- | ------------------------------------------------------------------------- |
| BASE-6 | NULL `p_effect_key`     | `sqlstate=23502 governed=false` `null value in column "effect_key" …`     |
| BASE-7 | NULL `p_environment`    | `sqlstate=23502 governed=false` `null value in column "environment" …`    |
| BASE-8 | NULL `p_correlation_id` | `sqlstate=23502 governed=false` `null value in column "correlation_id" …` |

Three more fields of the same class. Whether 0184 closes them is answered in
§2 and §4.

---

## 2. Fix verification on the LIVE 0184 door

All probes executed against `kitluy_devices.ingest_terminal_pairing_receipt_v1`
as it stands in the database (`md5(pg_get_functiondef) = 523ad1d3…`, owner
`kitluy_pairing_receipt_governor`), inside `begin; … rollback;`.

### 2a. The presence gate does not over-refuse

This is the more important half of the question — a gate that refuses too much
is worse than one that refuses too little.

| #   | Probe                                                                                                                                          | Expected                     | Actual                                                                 | Verdict |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------- | ------- |
| L0  | Fully legitimate receipt                                                                                                                       | INGESTED                     | `{"outcome":"INGESTED","receipt_id":"200949ce-…","delivery_count":1}`  | PASS    |
| L0b | **Identical redelivery**                                                                                                                       | `DUPLICATE_IGNORED`, count 2 | `{"outcome":"DUPLICATE_IGNORED","delivery_count":2}`                   | PASS    |
| L0c | Identical redelivery again                                                                                                                     | `DUPLICATE_IGNORED`, count 3 | `{"outcome":"DUPLICATE_IGNORED","delivery_count":3}`                   | PASS    |
| L0d | Rows stored for the redelivered receipt                                                                                                        | exactly 1                    | `1`; final `delivery_count` = `3`                                      | PASS    |
| L0e | Legitimate variant: UPPERCASE fingerprints and transcript hash, `hub_certificate_serial = '0'`, `paired_at` three days old, different terminal | INGESTED                     | `{"outcome":"INGESTED","paired_at":"2026-08-03T…","delivery_count":1}` | PASS    |

`'0'` is the sharpest of these: a serial that is falsy in most languages passes
because the gate uses `coalesce(btrim(…),'') = ''`, not a truthiness test. An
old `paired_at` passes because the gate tests presence, not recency — the door
still never authors or moves `paired_at`.

### 2b. NEW-4 — absent identity, scope, generation, instant, signature

Every one of these must be `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA` **and** must
not leak raw not-null text (the consumer maps a SQLSTATE to `INTERNAL_ERROR`,
which reads as retryable).

| #   | Probe                                         | SQLSTATE | Governed sentinel | Raw not-null text present | Verdict |
| --- | --------------------------------------------- | -------- | ----------------- | ------------------------- | ------- |
| L1  | NULL `p_tenant_id`                            | `P0001`  | yes               | **no**                    | PASS    |
| L2  | NULL `p_digital_store_id`                     | `P0001`  | yes               | **no**                    | PASS    |
| L3  | NULL `p_location_id`                          | `P0001`  | yes               | **no**                    | PASS    |
| L4  | NULL `p_terminal_assignment_generation`       | `P0001`  | yes               | **no**                    | PASS    |
| L5  | NULL `p_receipt_id`                           | `P0001`  | yes               | —                         | PASS    |
| L6  | NULL `p_pairing_session_id`                   | `P0001`  | yes               | —                         | PASS    |
| L7  | NULL `p_hub_device_id`                        | `P0001`  | yes               | —                         | PASS    |
| L8  | NULL `p_terminal_device_id`                   | `P0001`  | yes               | —                         | PASS    |
| L9  | NULL `p_paired_at`                            | `P0001`  | yes               | —                         | PASS    |
| L10 | Whitespace-only `p_receipt_version` (`'   '`) | `P0001`  | yes               | —                         | PASS    |
| L11 | Empty `p_hub_receipt_signature` (`''`)        | `P0001`  | yes               | —                         | PASS    |
| X4  | NULL `p_terminal_profile_code`                | `P0001`  | yes               | —                         | PASS    |

The sentinel text is the same in all twelve:
`KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a receipt carries its identity, scope,
generation, instant and signature; one or more were absent`.

### 2c. NEW-5 — the paired side's device class

| #   | Probe                                            | Expected         | Actual                                                                                       | Verdict |
| --- | ------------------------------------------------ | ---------------- | -------------------------------------------------------------------------------------------- | ------- |
| L12 | A `store_hub` supplied as `p_terminal_device_id` | governed refusal | `KLUY-PAIRING-RECEIPT-WRONG-HUB: device a7c94577-… is a store_hub, not a terminal` (`P0001`) | PASS    |
| L13 | A UUID that names no device at all               | governed refusal | `KLUY-PAIRING-RECEIPT-DEVICE-UNASSIGNED: terminal a6a01372-… does not exist` (`P0001`)       | PASS    |

Both refuse, both governed. Two cosmetic remarks, neither a defect:

- L12's sentinel family is `WRONG-HUB` for a problem on the **terminal** side.
  It is the same family the sibling check uses and the consumer maps it to the
  same closed `SCOPE_REFUSED` result, so behaviour is right; only the name
  reads oddly in a log.
- L13 says `DEVICE-UNASSIGNED: … does not exist`. "Unassigned" and "does not
  exist" are different facts sharing one sentinel. Again the consumer maps both
  the same way, and merging them arguably avoids an existence oracle, so this
  may well be deliberate.

---

## 3. Did 0184 lose anything from 0183?

All six original Reviewer B probes plus two more, re-driven against the live
door:

| #   | Probe                                                         | Actual                                                                                                                                                       | Verdict |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| B1  | `hub_device_id == terminal_device_id`                         | `KLUY-PAIRING-RECEIPT-WRONG-HUB: a device cannot pair with itself`                                                                                           | INTACT  |
| B2  | Hub assigned to another Tenant/Store/Location signs           | `KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub a7c94577-… is not the assigned Hub for terminal …`                                                                      | INTACT  |
| B3  | Receipt claims a foreign Tenant/Store/Location                | `KLUY-PAIRING-RECEIPT-WRONG-SCOPE: the receipt claims a Tenant, Store or Location the paired devices do not occupy`                                          | INTACT  |
| B4  | Wrong assignment generation (`gen+5`)                         | `KLUY-PAIRING-RECEIPT-STALE-GENERATION: receipt generation 6 is not the live generation 1`                                                                   | INTACT  |
| B6  | Replayed `effect_key` under a new `receipt_id`, tampered body | `P0001` `KLUY-PAIRING-RECEIPT-CONFLICT: effect key kh1.582c5be9-….1 was already delivered by a different receipt` — **not** the raw 23505 I originally found | INTACT  |
| B10 | Malformed certificate fingerprint                             | `P0001` `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a certificate fingerprint is not a 64-character hex digest` — **not** the raw 23514 I originally found        | INTACT  |
| B9  | Replayed `pairing_session_id` under a new effect key          | `KLUY-PAIRING-RECEIPT-CONFLICT: pairing session c8d69efd-… already carries a different receipt`                                                              | INTACT  |
| B11 | Redelivery of a known `receipt_id` with different facts       | `KLUY-PAIRING-RECEIPT-CONFLICT: receipt 200949ce-… was already ingested with different facts`                                                                | INTACT  |

Nothing regressed. The 0184 on-apply guard asserts three of these structurally
(`p_tenant_id is null`, `v_terminal_class`, `WRONG-SCOPE` + `STALE-GENERATION`
both present) and it fired its success notice on both the downgrade/restore
cycle in §4.

---

## 4. NEW-6 (LOW) — the presence gate is incomplete

**Where:** `kitluy_devices.ingest_terminal_pairing_receipt_v1`, group 0184
presence gate.

**What:** the gate lists thirteen parameters. It does **not** list
`p_effect_key`, `p_environment` or `p_correlation_id`. For the first two the
subsequent shape checks are written with bare operators rather than
`coalesce`, so three-valued logic reproduces the original NEW-4 behaviour
exactly:

- `if p_effect_key !~ '^kh1\.…'` — `NULL !~ pattern` is NULL, so the `if` is
  not taken and a NULL effect key falls through.
- `if p_environment not in ('development','pilot','production')` — `NULL not in
(…)` is NULL, same fall-through. (The error message already calls
  `coalesce(p_environment,'<null>')`, so a NULL was anticipated in the message
  but not in the predicate.)
- `p_correlation_id` is never examined anywhere in the door.

All three columns are `NOT NULL`, so each dies at the INSERT.

**Executed proof, against the live 0184 door (twice — before and after the §4
downgrade/restore cycle, identical both times):**

| #   | Probe                   | SQLSTATE  | Governed | Raw not-null text | Message                                                                                                  |
| --- | ----------------------- | --------- | -------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| X1  | NULL `p_effect_key`     | **23502** | **no**   | **yes**           | `null value in column "effect_key" of relation "terminal_pairing_receipts" violates not-null constraint` |
| X2  | NULL `p_environment`    | **23502** | **no**   | **yes**           | `null value in column "environment" …`                                                                   |
| X3  | NULL `p_correlation_id` | **23502** | **no**   | **yes**           | `null value in column "correlation_id" …`                                                                |

Contrast the twelve rows in §2b, every one of which is `P0001` with the schema
sentinel.

By comparison, the fingerprint and transcript-hash checks were written
`lower(coalesce(p_hub_certificate_fingerprint,''))`, so NULL becomes `''`,
fails the regex and refuses correctly. The same `coalesce` discipline applied to
the effect key and the environment — or simply adding the three names to the
presence gate — closes NEW-6 completely.

**Severity: LOW**, for exactly the reason Reviewer C rated NEW-4 LOW:

- It fails **closed** — nothing hostile is accepted, no row is written.
- The application consumer already blocks all three before the door is reached.
  `validateReceiptEventShape` in
  `services/kitluy-device-registry-service/src/pairing-receipt-ingestion.ts`
  tests `EFFECT_KEY.test(event.effectKey)`, `UUID.test(event.correlationId)`
  and `ENVIRONMENTS.includes(event.environment)`; a null or undefined fails all
  three. Only a direct database caller holding
  `kitluy_pairing_receipt_governor`, `kitluy_edge_sync_service` or
  `kitluy_test_harness` can reach it.

**Why it is worth closing anyway:** it is the _same_ ungoverned escape that
NEW-2, NEW-3 and NEW-4 were each raised for, and the commit message for 0184
states the principle plainly — "that is the same ungoverned escape NEW-2/NEW-3
were raised for, so it is closed rather than carried". Three fields were
carried. A caller hitting X1–X3 gets `INTERNAL_ERROR` from `mapSentinel` and
will retry a delivery that can never succeed.

**Reproduction:**

```
docker exec -i supabase_db_kitluy-local psql -U postgres -d postgres -X -q -f - <<'SQL'
begin;
-- enrol + claim a Store Hub and a terminal into Tenant …011 / Store …015 / Location …018,
-- then, as kitluy_pairing_receipt_governor:
select kitluy_devices.ingest_terminal_pairing_receipt_v1(
  null,                                  -- p_effect_key  (or a valid key with
  gen_random_uuid(),'1',gen_random_uuid(),--                p_environment = null,
  <hub>,<terminal>,<gen>,'WS11-T005-TERM-PROBE',--           or p_correlation_id = null)
  <tenant>,<store>,<location>,'development',
  repeat('a',64),repeat('a',64),'serial-1',repeat('b',64),'sig-1',now(),gen_random_uuid());
rollback;
SQL
-- ERROR 23502: null value in column "effect_key" … violates not-null constraint
```

**Suggested fix (one line):** add
`or p_effect_key is null or p_environment is null or p_correlation_id is null`
to the existing presence gate, or wrap the two shape predicates in `coalesce`
the way the digest checks already are.

---

## 5. Are the new regression tests non-vacuous?

Proven by execution, not asserted. The live door was temporarily replaced with
the group-0183 body (`begin;` + the 0183 migration + `commit;`), the suite run,
and the door restored (`begin;` + the 0184 migration + `commit;`). No data was
touched — only a function definition — and no concurrent session was active
before or during the swap.

**Downgraded to 0183** (`presence-gate ABSENT` confirmed by
`pg_get_functiondef`):

```
pnpm --filter kitluy-device-registry-service exec vitest run test/pairing-receipt-ingestion.integration.test.ts
  × T008 NEW-2/NEW-3: a replayed effect key and a malformed digest are GOVERNED refusals…
    → expected 'null value in column "tenant_id" of r…' to contain 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA'
  Tests  1 failed | 10 passed (11)
```

The NEW-4 assertion fires. Because it fires first, the NEW-5 assertion later in
the same `it` never ran, so it was proven separately with a temporary probe copy
of the file with only the five NEW-4 lines removed (file deleted immediately
after):

```
pnpm --filter kitluy-device-registry-service exec vitest run test/zz-probe-new5.integration.test.ts -t "NEW-2/NEW-3"
  × …
    → a Hub was accepted as the paired terminal: expected false to be true
  Tests  1 failed | 10 skipped (11)
```

**Both new assertions are non-vacuous**: each fails against the exact door body
that shipped before the fix.

**Restored to 0184:**

```
psql … -f restore-0184.sql
NOTICE:  KLUY-MIGRATION-0184: receipt presence gate and paired-side class check installed
presence-gate PRESENT | paired-class PRESENT | 0183-scope PRESENT | 0183-gen PRESENT | owner=kitluy_pairing_receipt_governor
md5(pg_get_functiondef) = 523ad1d35dc8c7f9d7f4dbdb43565824
pnpm --filter kitluy-device-registry-service exec vitest run test/pairing-receipt-ingestion.integration.test.ts
  Tests  11 passed (11)
```

Test-quality remarks (not defects):

- Both new probes live inside an `it` titled "T008 NEW-2/NEW-3 …". Four
  findings now share one test name, and a failure reports the wrong finding.
  Separate `it` blocks would make the failure self-describing and would stop
  NEW-4's assertion masking NEW-5's — which is exactly what happened above and
  is why I needed a probe copy.
- `callDoor`'s override plumbing only supports nulling `tenantId`
  (`over.tenantId === null ? null : e.tenantId`). Store, Location and
  generation — the other three fields Reviewer C found — are not covered by any
  test, and neither are the three fields in NEW-6. The SQL-level probes in §2b
  cover them; the suite does not.
- The final `count(*) = 0` residue assertion now covers all four probe receipt
  ids. Good.

---

## 6. Totals

| Command                                                                                                           | Result                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter kitluy-device-registry-service exec vitest run test/pairing-receipt-ingestion.integration.test.ts` | **PASS** — `Test Files 1 passed (1)`, `Tests 11 passed (11)` (the expected 11)                                         |
| `pnpm --filter kitluy-device-registry-service test`                                                               | **PASS** — `Test Files 35 passed (35)`, `Tests 374 passed (374)` (was 372 at `27a7edd`; 0183 added two)                |
| `pnpm migrations:validate`                                                                                        | **PASS** — `Migration validation passed (83 migration file(s)).`                                                       |
| `pnpm secret:scan`                                                                                                | **PASS** — `Secret scan passed (1407 tracked files).`                                                                  |
| `pnpm hub:db:validate`                                                                                            | **PASS** — `hub-validate: all static checks passed (40 Hub migration file(s)).`                                        |
| `pnpm hub:db:status`                                                                                              | **PASS** — `40 file(s); 40 applied, 0 pending, 0 checksum drift, 0 missing.`                                           |
| `pnpm db:test`                                                                                                    | **FAIL** — `ERROR: ASSERT FAIL: 37 device(s) report ACTIVE while no PKI configuration is approved`                     |
| `pnpm hub:db:test`                                                                                                | **FAIL** — `ERROR: ASSERT FAIL: a non-canonical logical profile code is assigned` (23 PASS notices before the failure) |

### Are the two ASSERT FAILs new, or the shared-state residue already characterised?

**Both are the shared-state residue class, and neither is mine.** Attributed by
evidence, not assumption:

**Cloud — 37 ACTIVE devices.** Grouped by enrolling operator:
`OP-RACE 10, OP-PROBE 5, OP-RTE 2, OP-CMP 2, OP-ACT 2, OP-RED 2, OP-TSC 2,
OP-AMB 2, OP-POP 2, OP-RREC 2, OP-XRACE 2, OP-RRX 2, OP-REC 2` — every one a
vitest integration-suite operator. My probe operators
(`OP-LV`, `OP-NB`, `OP-RB`, `OP-REVB`) account for **0** devices, active or
otherwise. The assertion encodes a freshly-reset-database invariant, so it must
run in the canonical order `db:reset → db:seed → db:test` **before** the vitest
suites; I ran the suites first, which is what put 37 activated fixtures in the
way. This is the same class I characterised in the previous review (fixture and
activation residue accumulating in a shared database), not a code defect and
unrelated to 0183/0184.

**Hub — non-canonical logical profile code.** Exactly two offending rows, with
`profile_code` `T2` and `T3` against the canonical `laundry.tN.role` form
(237 `laundry.t1.intake_cashier`, 16 `laundry.t3.ready_scan_in`,
4 `laundry.t4.pickup_scan_out`, 2 `laundry.t2.customer_display` are all
canonical). Both offending rows carry `effective_from = 2026-08-05` — they
**predate this review by a day** and were written by hub-agent test fixtures,
which pass the profile label straight into `profile_code`. My Hub probes left
nothing: `release_trust_key where key_id in ('probe-key','ATTACKER-KEY')` = 0,
`release_installation where candidate_version like '%probe%'` = 0,
`release_cache where signing_key_id in ('probe-key','ATTACKER-KEY')` = 0. (The
one `…-evil` release-cache row belongs to the hub-agent release-cache suite,
signer `dev-release-signer`, not to my probes.)

Neither failure touches the pairing-receipt door, and neither changed across the
0183 → 0184 → 0183 → 0184 cycle.

---

## 7. Residue census

| Check                                                                                                | Result                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manufacturing_enrollments` for `OP-LV` / `OP-NB` / `OP-RB` / `OP-REVB`                              | **0**                                                                                                                                                                                                 |
| `terminal_pairing_receipts` with my serials (`serial-1`, `serial-9`, `serial-X`, `serial-EVIL`, `0`) | **0**                                                                                                                                                                                                 |
| `zz_probe%` functions in any schema                                                                  | **0**                                                                                                                                                                                                 |
| Temporary namespaces holding relations                                                               | **0**                                                                                                                                                                                                 |
| Hub: `release_trust_key` `probe-key` / `ATTACKER-KEY`                                                | **0**                                                                                                                                                                                                 |
| Hub: `release_installation` with a `%probe%` candidate version                                       | **0**                                                                                                                                                                                                 |
| Hub: `release_cache` signed by `probe-key` / `ATTACKER-KEY`                                          | **0**                                                                                                                                                                                                 |
| Temporary probe test file `test/zz-probe-new5.integration.test.ts`                                   | deleted (`No such file or directory`)                                                                                                                                                                 |
| Door left as found                                                                                   | `md5(pg_get_functiondef) = 523ad1d35dc8c7f9d7f4dbdb43565824`, owner `kitluy_pairing_receipt_governor`, presence gate + paired-class + both 0183 refusals present                                      |
| `kitluy_*` roles granted to the connecting role                                                      | `kitluy_hub_runtime, kitluy_sync_worker` — **pre-existing**, same two recorded in the previous review; neither granted by these probes (I granted and revoked only `kitluy_pairing_receipt_governor`) |
| `git status --porcelain` in `C:/kl-rev-b`                                                            | **empty before this file was written; only this review file after**                                                                                                                                   |

One honest exception, already stated in §0: a template bug plus the concurrent
container restart caused three `OP-NB` probe devices to be committed instead of
rolled back. They were detected immediately and removed by the concurrent
database reset before I could neutralise them; the census above confirms zero
remain. Every probe after that point ran inside an intact transaction.

---

## 8. Verdict

**APPROVED.**

- **NEW-4 reproduced** against the pre-0184 door: NULL Tenant, Store, Location
  and generation each escaped as raw SQLSTATE **23502** with no governed
  sentinel (BASE-1 … BASE-4).
- **NEW-5 reproduced** against the same door: a `store_hub` supplied as the
  paired terminal was **INGESTED** (BASE-5).
- **Both closed by 0184.** Twelve absent-field probes now return `P0001` with
  `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA` and no raw not-null text; a Store Hub
  as the paired terminal and a non-existent paired device are both governed
  refusals.
- **The gate does not over-refuse.** A legitimate receipt still INGESTs; an
  identical redelivery still returns `DUPLICATE_IGNORED` with `delivery_count`
  going 1 → 2 → 3 against exactly one stored row; uppercase digests, a
  `hub_certificate_serial` of `'0'` and a three-day-old `paired_at` all pass.
- **Nothing from 0183 was lost.** All eight identity, scope, generation, replay
  and digest refusals still fire with their sentinels, including the two that
  0183 itself converted from raw 23505/23514.
- **Both new regression assertions are non-vacuous**, proven by swapping the
  door body back to 0183 and watching each fail, then restoring 0184 and
  confirming 11/11 green and a byte-identical function definition.

**One new finding: NEW-6 (LOW)** — the presence gate omits `p_effect_key`,
`p_environment` and `p_correlation_id`, so all three still escape as raw
SQLSTATE 23502 (probes X1–X3, reproduced twice). It fails closed and the
application consumer blocks all three before the door, so it does not block
acceptance of `09f93e9` — but it is the same ungoverned-escape class that
NEW-2, NEW-3 and NEW-4 were each raised for, and closing it is a one-line
change to the gate the migration already added. It should be dispositioned
before WS-11 closure rather than carried.

Two environment conditions are recorded, neither caused by this commit: the
`pnpm db:test` and `pnpm hub:db:test` ASSERT FAILs are both attributable
shared-state residue (§6), and the shared database was reset by another session
mid-review (§0).
