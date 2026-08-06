# WS-11-T008 — presence gate final re-review (Reviewer C)

| Field              | Value                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Task               | WS-11-T008 — independently verify the NEW-6 remediation (group 0185), the last before WS-11 closure                                          |
| Reviewer           | Reviewer C — did not author the fix, did not find the defect (Reviewer B found it while verifying the 0184 I approved)                       |
| Subject commit     | `828e850` "fix(ws-11): complete the receipt presence gate"                                                                                   |
| Principal artefact | `supabase/migrations/20260807000000_0185_t008_receipt_presence_gate_complete.sql`                                                            |
| Compared against   | `git show 09f93e9:supabase/migrations/20260806220000_0184_t008_receipt_null_and_class_guards.sql`                                            |
| Secondary artefact | `services/kitluy-device-registry-service/test/pairing-receipt-ingestion.integration.test.ts`                                                 |
| Worktree           | `C:/kl-rev-c`, detached at `828e850`                                                                                                         |
| Probes executed    | 41 baseline (0184 door) + 41 fix-verification (0185 door) + 15 escape-surface hunt = **97**                                                  |
| New defects        | **NONE.** The escape class is closed; four pre-existing observations recorded (O-1…O-4), none introduced or claimed closed by 0183/0184/0185 |
| Probe residue      | **ZERO** — census in §8                                                                                                                      |
| Verdict            | **APPROVED**                                                                                                                                 |

---

## 1. NEW-6 baseline reproduction — against the pre-0185 (0184) door

The 0184 door body was extracted verbatim from history and recreated as a throwaway
function inside a rolled-back transaction, owned by the governor exactly as the real door
is:

```bash
git show 09f93e9:supabase/migrations/20260806220000_0184_t008_receipt_null_and_class_guards.sql \
  | awk '/^create or replace function kitluy_devices.ingest_terminal_pairing_receipt_v1\(/,/^\$ingest\$;/' \
  | sed 's/ingest_terminal_pairing_receipt_v1(/zz_probe_ingest_0184_v1(/'
```

**The shared cloud database had been reset since my previous review** (0 receipts, my old
fixtures gone), so all fixtures were created fresh **inside the same rolled-back
transaction** through the governed doors (`enroll_device_v1` → `create_device_claim_v1` →
`redeem_device_claim_v1`): `ZZRC-HUB-A`, `ZZRC-TERM-A`, `ZZRC-HUB-A2` in Tenant `…011` /
Store `…015` / Location `…018`, and `ZZRC-HUB-B`, `ZZRC-TERM-B` in Tenant `…012` / Store
`…017` / Location `…450`. All five enrolled as the correct device class with a live
`pending_trust` assignment at generation 1.

### The three fields 0184 omitted — reproduced

| Probe  | Delivery                  | 0184 behaviour                                                                                                           | Governed? |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | --------- |
| **N1** | `p_effect_key = NULL`     | **raw 23502** — `null value in column "effect_key" of relation "terminal_pairing_receipts" violates not-null constraint` | **NO**    |
| **N2** | `p_environment = NULL`    | **raw 23502** — `null value in column "environment" …`                                                                   | **NO**    |
| **N3** | `p_correlation_id = NULL` | **raw 23502** — `null value in column "correlation_id" …`                                                                | **NO**    |

**Reviewer B's NEW-6 is real and independently reproduced.** `mapSentinel` has no `23502`
case, so all three would be reported as `INTERNAL_ERROR` — the retryable-looking
classification — for a delivery that can never succeed. That is the same escape class as
NEW-2, NEW-3 and NEW-4, and amendment `KLD-2026-07-28-001-A01 §2` calls it out by name
("a durable rejection is a cloud verdict, never a transport failure").

### The rest of 0184 was already sound — and NEW-6 is exactly three fields, no more

Driving the full 41-probe set at the 0184 door confirmed the boundary of the defect: every
other absent field (`receipt_id`, `pairing_session_id`, `receipt_version`,
`terminal_profile_code`, `hub_certificate_serial`, `hub_receipt_signature`, `paired_at`,
`tenant_id`, `digital_store_id`, `location_id`, `terminal_assignment_generation`,
`hub_device_id`, `terminal_device_id`) already produced
`KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA`, the three digest fields produced their own
governed sentinels, and every identity/scope/generation/replay rule was intact. An
**empty-string** effect key was also already governed in 0184 (`'' !~ pattern` is `true`);
only `NULL` escaped. So NEW-6 is precisely three fields and 0185's scope is correct.

---

## 2. Fix verification — the same 41 probes against the live 0185 door

Same fixtures, same call shapes, entering `kitluy_pairing_receipt_governor`, all inside
`begin; … rollback;`.

### 2.1 The three NEW-6 fields

| Probe  | Expected                       | Actual on 0185                                                                                                                                  | Verdict  |
| ------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **N1** | governed, no raw not-null text | `P0001 KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: a receipt carries its identity, scope, generation, instant and signature; one or more were absent` | **PASS** |
| **N2** | same                           | same sentinel                                                                                                                                   | **PASS** |
| **N3** | same                           | same sentinel                                                                                                                                   | **PASS** |

No `null value in column` / `not-null constraint` text in any of the three.

### 2.2 The completed gate does not over-refuse

Every edge-but-legal delivery Reviewer B used still ingests, byte-for-byte as it did under
0184:

| Probe  | Delivery                                               | 0184                         | 0185                                                  | Verdict  |
| ------ | ------------------------------------------------------ | ---------------------------- | ----------------------------------------------------- | -------- |
| **L1** | fully valid receipt                                    | `INGESTED`                   | `INGESTED`, `delivery_count 1`                        | **PASS** |
| **L2** | identical redelivery of L1                             | `DUPLICATE_IGNORED`, count 2 | `DUPLICATE_IGNORED`, count **2**, `paired_at` unmoved | **PASS** |
| **L3** | `hub_certificate_serial = '0'`                         | `INGESTED`                   | `INGESTED`                                            | **PASS** |
| **L4** | UPPERCASE fingerprints and transcript hash             | `INGESTED`                   | `INGESTED`                                            | **PASS** |
| **L5** | old `paired_at` (`2020-01-01`)                         | `INGESTED`                   | `INGESTED`, `paired_at` preserved verbatim            | **PASS** |
| **L6** | `receipt_version = '0'`                                | `INGESTED`                   | `INGESTED`                                            | **PASS** |
| **L7** | effect-key sequence `9999999999` (regex upper bound)   | `INGESTED`                   | `INGESTED`                                            | **PASS** |
| **L8** | fully legitimate ingestion in the **other real scope** | `INGESTED`                   | `INGESTED`                                            | **PASS** |

`btrim`-based gating was the risk here — a value that trims to empty is refused. Probes
L3 and L6 pin the two obvious false positives (`'0'` for the serial and the version),
and both pass. The only inputs the `btrim` clauses catch are `NULL`, `''` and
whitespace-only (W1/W2), none of which is a legitimate receipt field.

### 2.3 Nothing from 0183 or 0184 was lost

| Probe                | Attack                                                       | Actual on 0185                                                                                       | Verdict  |
| -------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------- |
| **B1**               | self-pairing (`hub == terminal`)                             | `KLUY-PAIRING-RECEIPT-WRONG-HUB: a device cannot pair with itself`                                   | **PASS** |
| **B2**               | foreign-scope Hub signs for our terminal                     | `KLUY-PAIRING-RECEIPT-WRONG-HUB: Hub … is not the assigned Hub for terminal …`                       | **PASS** |
| **B3**               | cross-scope: receipt claims a scope the devices don't occupy | `KLUY-PAIRING-RECEIPT-WRONG-SCOPE`                                                                   | **PASS** |
| **B4**               | stale assignment generation                                  | `KLUY-PAIRING-RECEIPT-STALE-GENERATION: receipt generation 6 is not the live generation 1`           | **PASS** |
| **B6**               | effect-key replay under a new receipt id + tampered body     | `KLUY-PAIRING-RECEIPT-CONFLICT: effect key … was already delivered by a different receipt`           | **PASS** |
| **B10**              | malformed certificate fingerprint                            | `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: … not a 64-character hex digest`                              | **PASS** |
| **B11**              | malformed transcript hash                                    | `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA: the transcript hash is not …`                                 | **PASS** |
| **NEW5**             | paired "terminal" is a `store_hub`                           | `KLUY-PAIRING-RECEIPT-WRONG-HUB: device … is a store_hub, not a terminal`                            | **PASS** |
| **N14**              | NEW-4: `p_tenant_id` absent                                  | gate sentinel                                                                                        | **PASS** |
| **N15**              | NEW-4: `p_digital_store_id` absent                           | gate sentinel                                                                                        | **PASS** |
| **N16**              | NEW-4: `p_location_id` absent                                | gate sentinel                                                                                        | **PASS** |
| **N17**              | NEW-4: `p_terminal_assignment_generation` absent             | gate sentinel                                                                                        | **PASS** |
| **N4–N6**            | the three digest fields absent (not named by the gate)       | their own `REJECTED-SCHEMA` sentinels via `lower(coalesce(…,''))`                                    | **PASS** |
| **N7–N13, N18, N19** | every other gate field absent                                | gate sentinel                                                                                        | **PASS** |
| **X1/X2**            | Hub / terminal does not exist                                | `WRONG-HUB: Hub … does not exist` / `DEVICE-UNASSIGNED: terminal … does not exist`                   | **PASS** |
| **X3/X4**            | malformed effect key / unknown environment                   | `REJECTED-SCHEMA` (kh1 shape) / `REJECTED-SCHEMA` (`environment staging is not a trust environment`) | **PASS** |
| **W1/W2**            | whitespace-only serial / empty-string effect key             | `REJECTED-SCHEMA` — correct refusals, not over-refusal                                               | **PASS** |

**41/41 probes behave identically to 0184 except the three NEW-6 fields, which moved from
raw 23502 to a governed sentinel.** That is exactly the intended delta and nothing else.

One observable message change, and it is in scope: an **empty-string** effect key is now
caught by the gate (`… one or more were absent`) rather than by the kh1 regex
(`… not the canonical kh1 shape`). Same sentinel family, same result, same caller
behaviour.

---

## 3. Diff judgement — is the "byte-equivalent apart from the gate" claim true?

`git diff 09f93e9 828e850 -- supabase/migrations/` shows one file, `+275/-0` — 0185 is
additive, it does not edit an applied migration. To test the substantive claim I extracted
both door bodies and diffed them directly:

```bash
diff -u body_0184.sql body_0185.sql     # 199 lines -> 205 lines
```

The **entire** diff is two hunks:

1. a four-line comment plus **three added gate clauses** —
   `or p_correlation_id is null`, `or coalesce(btrim(p_effect_key), '') = ''`,
   `or coalesce(btrim(p_environment), '') = ''`;
2. two predicates made NULL-safe —
   `p_effect_key !~ …` → `coalesce(p_effect_key, '') !~ …`, and
   `p_environment not in (…)` → `coalesce(p_environment, '') not in (…)`.

Nothing else differs: every identity, class, scope, generation, replay, digest, conflict
and idempotence rule is character-for-character identical, as is the `insert` column list,
the `values` list and both return objects. **The claim is TRUE, verified rather than
trusted.**

`git diff 09f93e9 828e850 -- hub/ scripts/ packages/ apps/ verticals/` is **empty** — 0185
is a cloud-only change.

### Privilege posture unchanged

0185 issues no `grant` except the transactional governor borrow it hands back, so nothing
could shift; verified independently anyway:

```
owner = kitluy_pairing_receipt_governor · secdef = true · search_path pinned
EXEC:  public f · anon f · authenticated f · service_role f · postgres f
       kitluy_worker_service f · kitluy_provisioning_service f
       kitluy_edge_sync_service t · kitluy_test_harness t · governor t
governor on kitluy_devices.devices            : sel t · ins f · upd f · del f
governor on kitluy_devices.device_assignments : sel t · ins f · upd f · del f
policies devices_pairing_receipt_governor / da_pairing_receipt_governor : cmd = r (SELECT only)
```

Identical to what I recorded at `99af1b5`. `create or replace function` does not change
ownership, and the owner is still the NOLOGIN governor.

---

## 4. Escape-surface hunt — is the gate now actually complete?

The gate names sixteen parameters; the door takes nineteen. The three it does **not** name
(`p_hub_certificate_fingerprint`, `p_terminal_certificate_fingerprint`,
`p_transcript_hash`) are each covered by their own `lower(coalesce(…, ''))` predicate, so
all nineteen are accounted for. I probed that reasoning rather than accepting it — fifteen
further hostile/boundary deliveries aimed at every remaining table constraint:

| Probe | Input                                      | Result                                                  |
| ----- | ------------------------------------------ | ------------------------------------------------------- |
| P1    | 65-char fingerprint (one over `char(64)`)  | `REJECTED-SCHEMA` — no 22001                            |
| P2    | 64 hex fingerprint + trailing space        | `REJECTED-SCHEMA`                                       |
| P3    | generation `0` (below `tpr_generation_ck`) | `STALE-GENERATION` — the CHECK is never reached         |
| P4    | generation `-1`                            | `STALE-GENERATION`                                      |
| P11   | `environment = ' development '`            | `REJECTED-SCHEMA` — no 23514 from `tpr_environment_ck`  |
| P13   | 64-char non-hex transcript hash            | `REJECTED-SCHEMA` — no 23514 from `tpr_fingerprints_ck` |
| P14   | `hub_receipt_signature = ' '`              | gate sentinel                                           |
| P15   | `terminal_profile_code = ' '`              | gate sentinel                                           |
| P5    | 100 000-char `hub_certificate_serial`      | `INGESTED` — see O-3                                    |
| P6    | effect key `kh1.<36 dashes>.1`             | `INGESTED` — see O-1                                    |
| P7    | `paired_at` = year 3000                    | `INGESTED` — see O-2                                    |
| P8    | `paired_at` = `-infinity`                  | `INGESTED` — see O-2                                    |
| P9    | non-laundry `terminal_profile_code`        | `INGESTED` — see O-3                                    |
| P10   | 100 000-char `receipt_version`             | `INGESTED` — see O-3                                    |
| P12   | effect key with UPPERCASE uuid namespace   | `INGESTED` — see O-1                                    |

**Across all 97 probes not one input produced a raw SQLSTATE.** Every refusal in this
review carried a `KLUY-` sentinel and `P0001`. Every table constraint that could previously
be reached — `tpr_environment_ck`, `tpr_generation_ck`, `tpr_fingerprints_ck`,
`tpr_effect_key_ck`, `tpr_effect_key_uq`, the `pairing_session_id` unique index, the
primary key and all twenty-two `NOT NULL` columns — is now shadowed by a governed check
that fires first. **The escape class NEW-2 / NEW-3 / NEW-4 / NEW-6 is closed.**

### Observations — all pre-existing since group 0176, none introduced by 0183/0184/0185

These are **not** the escape class and none was ever claimed closed by this remediation
chain. Recorded so WS-11 closes on an accurate picture rather than an implied one.

- **O-1 (INFO) — the door does not bind the effect key's namespace to the receipt id.**
  `^kh1\.[0-9a-fA-F-]{36}\.[0-9]{1,10}$` accepts 36 dashes (P6) or an uppercase UUID that
  is not the receipt (P12). The **consumer** enforces
  `effectKey.split(".")[1] === receiptId`. Pre-existing since 0176; not an escape and not
  cross-scope-exploitable, but it is one more rule living only in TypeScript.
- **O-2 (LOW) — no clock sanity on `paired_at`.** A receipt claiming the year 3000 (P7) or
  `-infinity` (P8) is stored verbatim. Because `tpr_terminal_idx` and
  `read_terminal_pairing_state_v1` both order by `paired_at desc`, a far-future
  `paired_at` becomes the terminal's reported pairing state permanently. The sibling
  `ingest_device_health_report_v1` has an explicit clock-anomaly rule; this door has none.
  Pre-existing since 0176 and outside the T008 remediation scope, but it is the most
  substantive gap I found in the door as a whole.
- **O-3 (INFO) — `terminal_profile_code`, `hub_certificate_serial` and `receipt_version`
  are unvalidated and unbounded at the door** (P5/P9/P10 all ingested, including
  100 000-character values). The consumer validates the profile code.
- **O-4 (INFO, test coverage) — see §5.3.**

---

## 5. Test-quality judgement

### 5.1 The restructure fixes exactly what Reviewer B diagnosed

- **Masking removed.** The four findings previously shared one `it`, so NEW-4's assertion
  ran before NEW-5's and a NEW-4 failure aborted the block — which is how NEW-4 masked
  NEW-5. They are now three separate tests (`NEW-2/NEW-3`, `NEW-4/NEW-6`, `NEW-5`), each
  with its own residue assertion.
- **The harness can now absent any field.** `callDoor` was hoisted to `describe` scope and,
  crucially, its override logic changed from
  `over.effectKey ?? e.effectKey` / `over.tenantId === null ? null : e.tenantId`
  to `"effectKey" in over ? over.effectKey : e.effectKey`. Under `??` a `null` override
  falls through to the real value, so the old harness could only ever null the one field
  that had been special-cased; the `in` test honours a `null` override for every supported
  field. This is the right fix and it is what makes the six-field loop possible.
- **The absent-field test is per-field labelled** —
  `expect(outcome.message, \`absent ${field}\`)` — so a failure names which field escaped
  rather than failing anonymously.

### 5.2 Non-vacuity — proven end-to-end, not asserted

I captured the live door (`md5 562815d3d89bbd870737ab0542509ba0`), verified the restore
script round-trips to the identical md5, replaced the body with the pre-fix 0184 body
(`md5 2115e3681dfbd9b837d18186a7ee587b`) and ran the real test binary:

```
$ pnpm --filter kitluy-device-registry-service exec vitest run \
    test/pairing-receipt-ingestion.integration.test.ts -t "NEW-4/NEW-6"

 × T008 NEW-4/NEW-6: EVERY absent field the door depends on is a governed schema refusal,
   never a raw not-null violation
   → absent effectKey: expected 'null value in column "effect_key" of …'
     to contain 'KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA'
 Test Files  1 failed (1)
      Tests  1 failed | 12 skipped (13)
```

This is a **stronger** proof than a bare failure: the loop ran `tenantId`,
`digitalStoreId` and `locationId` first and they **passed** against 0184 (they were NEW-4,
already fixed there), then failed precisely on `effectKey`. The test therefore
discriminates per field, and the NEW-6 portion specifically is non-vacuous.

The door was restored and re-verified byte-for-byte
(`FINAL|562815d3d89bbd870737ab0542509ba0|owner=kitluy_pairing_receipt_governor|secdef=true`),
and the suite re-run: **13 passed (13)**.

This test was safe to run against a reverted door because every one of its calls goes
through `callDoor`, which rolls back its own transaction — **no hostile receipt rows were
created**, which matters because `tpr_integrity` refuses `DELETE` from every identity
including the governor.

### 5.3 Coverage judgement — the absent-field test covers its six, the gate names sixteen

The test genuinely covers the six fields it names — `tenantId`, `digitalStoreId`,
`locationId`, `effectKey`, `environment`, `correlationId` — and asserts both the positive
(`contains KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA`) and the negative
(`not match /null value in column|not-null constraint/`), plus zero residue. That is
exactly the NEW-4 ∪ NEW-6 field set, so the test matches the findings.

**O-4 (INFO):** the gate names **sixteen** fields. The other ten —
`receipt_id`, `pairing_session_id`, `hub_device_id`, `terminal_device_id`,
`terminal_assignment_generation`, `paired_at`, `receipt_version`, `terminal_profile_code`,
`hub_certificate_serial`, `hub_receipt_signature` — are not exercised by the suite, because
`callDoor` still sources them unconditionally from the event and cannot absent them. I
verified all ten at SQL level (probes N7–N13, N17–N19) and every one is governed, so
**there is no defect here** — only a regression net that would not catch a future
regression in those ten. Widening `callDoor` to take the full parameter map would close it.

---

## 6. Regression totals (exact, as executed in `C:/kl-rev-c` at `828e850`)

| Command                                                                                                           | Result                                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`                                                                                  | already up to date                                                           |
| `pnpm build`                                                                                                      | 72 cached, 72 total — FULL TURBO                                             |
| `pnpm --filter kitluy-device-registry-service exec vitest run test/pairing-receipt-ingestion.integration.test.ts` | **Test Files 1 passed (1) · Tests 13 passed (13)** — matches the expected 13 |
| (re-run after the door revert/restore cycle)                                                                      | **13 passed (13)**                                                           |
| `pnpm --filter kitluy-device-registry-service test`                                                               | **Test Files 35 passed (35) · Tests 376 passed (376)**                       |
| `pnpm migrations:validate`                                                                                        | **passed (84 migration files)**                                              |
| `pnpm secret:scan`                                                                                                | **passed (1411 tracked files)**                                              |
| `pnpm db:test`                                                                                                    | **exit 3 — 39 PASS, 1 ASSERT FAIL** → residue class, see §6.1                |
| `pnpm hub:db:test`                                                                                                | **exit 3 — 23 PASS, 1 ASSERT FAIL** → residue class, see §6.2                |

### 6.1 `db:test` — the known residue class, unchanged

`ASSERT FAIL: 37 device(s) report ACTIVE while no PKI configuration is approved`
(`ws11-fleet-honest`, `supabase/tests/assertions.sql:2409`), after the **same 39 PASS
lines** and at the **same assertion** recorded by Reviewer A before 0183 existed and by me
at `99af1b5`.

Evidence it is residue, not a regression:

- Every one of the 37 ACTIVE devices belongs to a `WS11-*-HUB-*` family from the
  device-registry-service replacement/race/recovery tests, which legitimately activate Hubs
  in `development`. Earliest `created_at` `08:27:12Z` — i.e. **after** the clean closeout
  reset, produced by suite runs since.
- **Zero** ACTIVE devices carry my `ZZRC-*` probe tag; my probes created no committed
  device at all.
- The assertion demands `count(*) = 0` on `device_fleet_status.fleet_status = 'ACTIVE'` —
  it is written for a virgin database, which is why the closeout figure of record is
  `db:test` **242 PASS, exit 0** immediately after a reset.
- There is no causal path from 0185: the governor has no write privilege on
  `kitluy_devices.devices` (§3), the door's only write is an `insert` into
  `terminal_pairing_receipts`, and `grep -n "pairing_receipt\|0176\|0183\|0184\|0185"
supabase/tests/assertions.sql` returns nothing — `db:test` carries no assertion for this
  door at all.

**Same class Reviewer B and I already characterised. Nothing new.**

### 6.2 `hub:db:test` — likewise, and on a database 0185 cannot touch

`ASSERT FAIL: a non-canonical logical profile code is assigned`
(`hub/tests/assertions.sql:1155`), after the **same 23 PASS lines** I recorded at
`99af1b5`. Root cause located directly: `edge_config.terminal_profile_assignment` holds two
rows whose `profile_code` is `T2` and `T3` rather than the canonical
`^laundry\.t[1-4]\.[a-z_]+$` — legacy short codes left by a hub-agent suite run alongside
109 perfectly canonical rows. Group 0185 is a **cloud** migration and
`git diff 09f93e9 828e850 -- hub/` is empty, so it cannot have caused a Hub-database
assertion. **Same residue class. Nothing new.**

---

## 7. Was anything from 0183 / 0184 lost?

No. Stated precisely:

| Protection                                        | Origin    | Status on 0185                                   |
| ------------------------------------------------- | --------- | ------------------------------------------------ |
| Hub must exist and be a `store_hub`               | 0183      | intact (B2, X1, probe against a terminal-as-Hub) |
| Self-pairing refused                              | 0183      | intact (B1)                                      |
| Hub and terminal must share Tenant/Store/Location | 0183      | intact (B2)                                      |
| Asserted scope must match the assignment          | 0183      | intact (B3)                                      |
| Live assignment required, both sides              | 0183      | intact (X2 and the two `*-UNASSIGNED` sentinels) |
| Assignment generation must be live                | 0183      | intact (B4, P3, P4)                              |
| Effect-key replay is a governed conflict          | 0183      | intact (B6)                                      |
| Malformed digests are governed                    | 0183      | intact (B10, B11, N4–N6, P1, P2, P13)            |
| Scope-field presence gate                         | 0184      | intact (N14–N16)                                 |
| Generation presence                               | 0184      | intact (N17)                                     |
| Paired side must be a `terminal`                  | 0184      | intact (NEW5)                                    |
| Idempotence: one business effect per receipt      | 0176      | intact (L1/L2, `delivery_count` 1 → 2)           |
| `paired_at` never moved by a redelivery           | 0176      | intact (L2, L5)                                  |
| Governor read-only, definer, pinned, ungranted    | 0176/0183 | intact (§3)                                      |

---

## 8. Residue census

### 8.1 My probes — ZERO

| Item                                                                  | Found                                                                                                                                      |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `zz_probe*` functions surviving                                       | **0**                                                                                                                                      |
| `ZZRC-*` fixture devices surviving                                    | **0**                                                                                                                                      |
| `kitluy_pairing_receipt_governor` granted to any role                 | **0**                                                                                                                                      |
| Receipts carrying my probe serials (`serial-1`/`serial-EVIL`/`0`)     | **0**                                                                                                                                      |
| Receipts with my probe `paired_at` values (2020 / 3000 / `-infinity`) | **0**                                                                                                                                      |
| `zz*`-named relations in `kitluy_devices`                             | **0**                                                                                                                                      |
| Live door definition                                                  | `md5 562815d3d89bbd870737ab0542509ba0`, owner `kitluy_pairing_receipt_governor`, `secdef = true` — **identical to the pre-review capture** |

Every writing probe ran inside `begin; … rollback;`, including all fixture creation. The
only two committed statements in this review were the temporary door revert and its
restore, both md5-verified.

### 8.2 Suite residue — attributed honestly

24 receipts now exist, **all** carrying the suite's own `P04C3-HUB-*` serial prefix and
none carrying a probe serial; plus 90 `T008-RCPT-%` fixture devices. These come from the
pairing suite (three runs) and the registry suite (one run) behaving as designed against a
non-reset shared database. Pairing-receipt rows cannot be deleted by design
(`tpr_integrity` refuses `DELETE` from every identity).

One honesty note: between two of my read-only measurements the committed receipt count
moved `0 → 6` while I was executing nothing but rolled-back transactions, so **another
session is also writing to this shared database**. I therefore claim only what I can
prove — that none of the 24 came from my probes — rather than claiming exact authorship of
the earliest six.

### 8.3 Worktree

```
$ cd /c/kl-rev-c && git status --porcelain
(empty before writing this file; only this review document afterwards)
$ git log --oneline -1
828e850 fix(ws-11): complete the receipt presence gate
```

No product file under `supabase/`, `hub/`, `services/`, `packages/`, `apps/`, `verticals/`
or `scripts/` was modified. All probe scripts live in the session scratchpad outside the
repository. My earlier review file, now tracked, was restored to its committed form; the
committed version differs from my local copy only in whitespace
(`git diff --ignore-all-space` reduces 99 changed lines to 14 wrap-point differences, all
inside table rows — Prettier reflow, no content change).

---

## 9. Verdict

### **APPROVED**

- **NEW-6 (LOW) — CLOSED.** Reproduced independently against the 0184 door (all three of
  `effect_key`, `environment`, `correlation_id` escaping as raw 23502), and all three are
  now refused by the door's own `KLUY-PAIRING-RECEIPT-REJECTED-SCHEMA` with no raw
  not-null text.
- **The escape class is now genuinely closed, not just for the three named fields.** All
  nineteen parameters are covered — sixteen by the gate, three by their own NULL-safe digest
  predicates — and across 97 probes, including fifteen aimed squarely at every remaining
  table constraint, **not one input produced a raw SQLSTATE**.
- **The gate does not over-refuse.** Every legitimate and edge-but-legal delivery Reviewer B
  used still ingests, with byte-identical outcomes to 0184; idempotence still returns
  `DUPLICATE_IGNORED` with `delivery_count` incrementing and `paired_at` unmoved.
- **Nothing from 0183 or 0184 was lost** — all fourteen protections re-verified individually.
- **The "byte-equivalent apart from the gate" claim is TRUE**, verified by a direct body
  diff: three added gate clauses, one comment, two predicates wrapped in `coalesce`, and
  nothing else. Privilege posture unchanged; no hub, script or package file touched.
- **The restructured tests are sound and non-vacuous**, proven end-to-end against a
  genuinely reverted door, with the failure landing precisely on `effectKey` after the
  three NEW-4 fields passed.
- **No new defect.** Four observations recorded (O-1…O-4), every one of them pre-existing
  since group 0176 and none of them in the class this remediation chain set out to close.
  **O-2 (no clock sanity on `paired_at`) is the one I would carry into the WS-11 debt
  register** — it is the only observation with a real operational consequence, since a
  far-future `paired_at` becomes a terminal's reported pairing state permanently.
- Both `ASSERT FAIL`s are the shared-database residue class already characterised, at the
  same failure points, with no causal path from 0185.
